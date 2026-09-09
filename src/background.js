/**
 * Service worker：管右键菜单的显隐、发起翻译、把结果流式推给页面。
 */
import './lib/lang.js';
import './lib/settings.js';
import './lib/providers.js';

const MENU_ID = 'ai-translate-selection';
const PORT_NAME = 'ai-translate-panel';
const CONTENT_FILES = ['src/lib/lang.js', 'src/content/content.js'];

/** `${tabId}:${frameId}` -> 该框架最近一次上报的选中文字（保留换行）。 */
const selections = new Map();

/* ------------------------------------------------------------------ 菜单 */

async function menuTitle() {
  const settings = await AITrSettings.loadSettings();
  return `翻译成${AITrSettings.targetMenu(settings)}`;
}

async function createMenu() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: MENU_ID,
    title: await menuTitle(),
    contexts: ['selection'],
    // 默认可见：万一选区上报没跑起来，菜单也不至于消失
    visible: true,
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  createMenu();
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(createMenu);

/** 选中的是中文（或没有可翻译的字母）时把菜单藏起来。 */
async function updateMenuVisibility(text) {
  const visible = AITrLang.shouldOffer(text);
  try {
    await chrome.contextMenus.update(MENU_ID, { visible });
  } catch {
    // service worker 重启后菜单可能已经不在了，重建一次
    await createMenu();
  }
}

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  try {
    await chrome.contextMenus.update(MENU_ID, { title: await menuTitle() });
  } catch {
    await createMenu();
  }
});

/* -------------------------------------------------------------- 页面脚本 */

async function ping(tabId) {
  try {
    const reply = await chrome.tabs.sendMessage(tabId, { type: 'ping' }, { frameId: 0 });
    return Boolean(reply?.ok);
  } catch {
    return false;
  }
}

/** 刚安装、或脚本还没注入的老标签页，按需注入一次。 */
async function ensureContentScript(tabId) {
  if (await ping(tabId)) return true;
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      files: CONTENT_FILES,
    });
  } catch (err) {
    console.warn('[AI 划词翻译] 无法在该页面注入脚本：', err?.message);
    return false;
  }
  return ping(tabId);
}

/* ---------------------------------------------------------------- 翻译流 */

/**
 * info.selectionText 会把换行压成空格，所以优先用 content script 上报的原始文本，
 * 只有在两者「压平后」一致时才敢用，避免用到过期的选区。
 */
function pickText(cached, fromMenu) {
  const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  if (cached && flat(cached) === flat(fromMenu)) return cached;
  return String(fromMenu || '').trim();
}

async function startTranslation({ tabId, text, providerId }) {
  if (!tabId || !text) return;

  if (providerId) await AITrSettings.patchSettings({ provider: providerId });
  const settings = await AITrSettings.loadSettings();
  const provider = AITrSettings.resolveProvider(settings);

  const truncated = text.length > AITrLang.MAX_TEXT_LENGTH;
  const payload = truncated ? text.slice(0, AITrLang.MAX_TEXT_LENGTH) : text;

  if (!(await ensureContentScript(tabId))) return;

  let port;
  try {
    port = chrome.tabs.connect(tabId, { name: PORT_NAME, frameId: 0 });
  } catch {
    return;
  }

  const controller = new AbortController();
  let closed = false;
  const stop = () => {
    closed = true;
    controller.abort();
  };
  port.onDisconnect.addListener(stop);
  port.onMessage.addListener((message) => {
    if (message?.type === 'cancel') stop();
  });

  const post = (message) => {
    if (closed) return;
    try {
      port.postMessage(message);
    } catch {
      closed = true;
    }
  };

  post({
    type: 'start',
    text: payload,
    truncated,
    target: AITrSettings.targetMenu(settings),
    provider: { id: provider.id, label: provider.label, model: provider.model },
    providers: AITrSettings.providerList(),
    showOriginal: settings.showOriginal,
  });

  const startedAt = Date.now();
  try {
    let received = false;
    for await (const chunk of AITrProviders.translate({ text: payload, settings, signal: controller.signal })) {
      if (closed) return;
      received = true;
      post({ type: 'delta', chunk });
    }
    if (!received) {
      post({ type: 'error', message: '模型没有返回任何内容，重试或换个模型试试' });
      return;
    }
    post({ type: 'done', elapsed: Date.now() - startedAt });
  } catch (err) {
    if (closed || controller.signal.aborted || err?.name === 'AbortError') return;
    post({
      type: 'error',
      message: String(err?.message || err) || '翻译失败',
      action: err?.action || null,
    });
  }
  // 端口由页面侧关闭：紧跟在 postMessage 后面 disconnect 有丢消息的风险。
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) return;
  const frameId = info.frameId ?? 0;
  const cached = selections.get(`${tab.id}:${frameId}`)?.text;
  const text = pickText(cached, info.selectionText);
  await startTranslation({ tabId: tab.id, text });
});

/* ---------------------------------------------------------------- 消息 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = message?.type;

  if (type === 'ping') {
    sendResponse({ ok: true });
    return false;
  }

  if (type === 'selection') {
    const tabId = sender.tab?.id;
    if (tabId != null) {
      const key = `${tabId}:${sender.frameId ?? 0}`;
      if (message.text) selections.set(key, { text: message.text, at: Date.now() });
      else selections.delete(key);
    }
    updateMenuVisibility(message.text);
    return false;
  }

  if (type === 'retranslate') {
    startTranslation({
      tabId: sender.tab?.id,
      text: message.text,
      providerId: message.providerId,
    });
    return false;
  }

  if (type === 'open-options') {
    chrome.runtime.openOptionsPage();
    return false;
  }

  if (type === 'test-provider') {
    (async () => {
      try {
        const settings = await AITrSettings.loadSettings();
        const result = await AITrProviders.testConnection({
          settings,
          providerId: message.providerId,
        });
        sendResponse({ ok: true, ...result });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true; // 异步回复
  }

  return false;
});

/* 标签页关掉后清掉它的选区缓存 */
chrome.tabs.onRemoved.addListener((tabId) => {
  for (const key of selections.keys()) {
    if (key.startsWith(`${tabId}:`)) selections.delete(key);
  }
});
