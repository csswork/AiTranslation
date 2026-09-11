/**
 * Service worker：管右键菜单的显隐、发起翻译、把结果流式推给页面。
 */
import './lib/lang.js';
import './lib/settings.js';
import './lib/providers.js';

const MENU_ID = 'ai-translate-selection';
const ELEMENT_MENU_ID = 'ai-translate-element';
const PORT_NAME = 'ai-translate-panel';
// 必须与 manifest 的 content_scripts 保持一致
const CONTENT_FILES = [
  'src/lib/lang.js',
  'src/lib/rules.js',
  'src/lib/selector.js',
  'src/content/content.js',
  'src/content/elements.js',
];

/** `${tabId}:${frameId}` -> 该框架最近一次上报的选中文字（保留换行）。 */
const selections = new Map();

/* ------------------------------------------------------------------ 菜单 */

async function menuTitle() {
  const settings = await AITrSettings.loadSettings();
  return `翻译成${AITrSettings.targetMenu(settings)}`;
}

/**
 * 菜单重建要串起来做。onInstalled / onStartup / update 失败后的重建，
 * 这几个入口可能并发触发；各自 removeAll 完再各自 create，
 * 第二个就会失败于 "Cannot create item with duplicate id"。
 */
let menuTask = Promise.resolve();

function createMenu() {
  menuTask = menuTask.catch(() => {}).then(async () => {
    // 标题先算好：removeAll 与 create 之间不能再有 await，
    // 否则又给别的调用留出插进来的空隙
    const title = await menuTitle();
    await chrome.contextMenus.removeAll();
    const created = [];
    const create = (props) =>
      new Promise((resolve) => {
        chrome.contextMenus.create(props, () => {
          // 必须读一次 lastError，否则会以 "Unchecked runtime.lastError" 冒到控制台
          const error = chrome.runtime.lastError;
          if (error) console.warn('[AI 划词翻译] 创建右键菜单失败：', props.id, error.message);
          else created.push(props.id);
          resolve();
        });
      });

    await create({
      id: MENU_ID,
      title,
      contexts: ['selection'],
      // 默认可见：万一选区上报没跑起来，菜单也不至于消失
      visible: true,
    });
    // 始终可见，不做任何判断。
    // 与划词项的互斥交给 Chrome：contexts 里 'selection' 与 'page' 天然互斥
    // ——有选中文字时只出划词项，没有时只出这一项。
    // 这样任何时刻都只有一项可见（不会被折叠成二级子菜单），
    // 而且不依赖内容脚本上报，没有时序问题。
    await create({
      id: ELEMENT_MENU_ID,
      title: '为这个区域添加翻译按钮',
      contexts: ['page', 'link', 'image', 'video', 'audio'],
      visible: true,
    });
    console.info('[AI 划词翻译] 右键菜单已就绪：', created.join(' + ') || '（无）');
  });
  return menuTask;
}

chrome.runtime.onInstalled.addListener((details) => {
  createMenu();
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(createMenu);

// 光靠上面两个事件不够：重新加载已解压的扩展时它们未必触发，
// 而右键菜单是持久化的——旧菜单会留着，于是新增的菜单项永远建不出来。
// createMenu 是 removeAll + create 且已串行化，每次 service worker 启动跑一次是安全的。
createMenu();

/** 选中的是中文（或没有可翻译的字母）时把菜单藏起来。 */
async function updateMenuVisibility(text) {
  const visible = AITrLang.shouldOffer(text);
  try {
    await chrome.contextMenus.update(MENU_ID, { visible });
  } catch {
    // service worker 重启后菜单可能已经不在了，重建一次再补上显隐状态
    await createMenu();
    try {
      await chrome.contextMenus.update(MENU_ID, { visible });
    } catch {
      /* 忽略：菜单确实建不起来时，日志已在 createMenu 里打过 */
    }
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
  if (info.menuItemId === ELEMENT_MENU_ID && tab?.id) {
    if (!(await ensureContentScript(tab.id))) return;
    try {
      const reply = await chrome.tabs.sendMessage(tab.id, { type: 'add-element-rule' }, { frameId: 0 });
      if (!reply?.ok) console.warn('[AI 划词翻译] 添加元素规则失败：', reply?.error);
    } catch (err) {
      console.warn('[AI 划词翻译] 添加元素规则失败：', err?.message);
    }
    return;
  }
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

  // 内容脚本不能直接请求接口（会受页面 CORS 限制），统一由这里代发
  if (type === 'translate-batch') {
    (async () => {
      try {
        const settings = await AITrSettings.loadSettings();
        const texts = await AITrProviders.translateBatch({ texts: message.texts, settings });
        sendResponse({ ok: true, texts });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true; // 异步回复
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

/* ------------------------------------------------------------ 快捷键翻译 */

/** 取某个标签页最近一次上报的选中文字；缓存空了就直接问页面。 */
async function selectionForTab(tabId) {
  let best = null;
  for (const [key, value] of selections) {
    if (!key.startsWith(`${tabId}:`)) continue;
    if (!best || value.at > best.at) best = value;
  }
  if (best?.text) return best.text;
  // service worker 重启过，缓存就空了
  try {
    const reply = await chrome.tabs.sendMessage(tabId, { type: 'get-selection' }, { frameId: 0 });
    return reply?.text || '';
  } catch {
    return '';
  }
}

/** 快捷键没生效时，这里是唯一的线索来源，所以每个提前退出都要说明原因。 */
const shortcutLog = (reason) => console.info(`[AI 划词翻译] 快捷键未触发翻译：${reason}`);

async function onShortcut(command, tab) {
  if (command !== 'translate-selection') return;

  const settings = await AITrSettings.loadSettings();
  if (!settings.shortcut) {
    shortcutLog('设置里已关闭「快捷键翻译」');
    return;
  }

  // onCommand 会直接带上触发时的标签页，优先用它。
  // 不要用 tabs.query({ currentWindow: true })：service worker 没有所属窗口，
  // 那个筛选条件在这里不可靠，会查不到任何标签页。
  let tabId = tab?.id;
  if (tabId == null) {
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    tabId = active?.id;
  }
  if (tabId == null) {
    shortcutLog('拿不到当前标签页');
    return;
  }

  // 先确保页面脚本在位，否则问不到选区（刚重载扩展、或标签页是旧的）
  if (!(await ensureContentScript(tabId))) {
    shortcutLog('这个页面不允许注入脚本（例如 chrome:// 开头的页面）');
    return;
  }

  const text = await selectionForTab(tabId);
  if (!text) {
    shortcutLog('当前没有选中任何文字');
    return;
  }
  // 与右键菜单同一套规则
  if (!AITrLang.shouldOffer(text)) {
    shortcutLog('选中的内容本身是中文，或没有可翻译的文字');
    return;
  }

  await startTranslation({ tabId, text });
}

// 加一层保护：万一代码已更新而 Chrome 仍在用缓存的旧 manifest，
// chrome.commands 会是 undefined。直接在顶层访问会抛错并让整个
// service worker 加载失败，连右键菜单一起挂掉。
if (chrome.commands?.onCommand) {
  chrome.commands.onCommand.addListener((command, tab) => {
    onShortcut(command, tab).catch((err) => shortcutLog(String(err?.message || err)));
  });
} else {
  console.warn('[AI 划词翻译] chrome.commands 不可用，快捷键功能已跳过；请重新加载扩展。');
}
