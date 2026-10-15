/**
 * Service worker：管右键菜单的显隐、发起翻译、把结果流式推给页面、开关视频字幕，
 * 以及账户登录、状态与托管翻译（只有这里会请求账户服务）。
 */
import './lib/languages.js';
import './lib/messages.js';
import './lib/i18n.js';
import './lib/env.js';
import './lib/lang.js';
import './lib/settings.js';
import './lib/providers.js';
import './lib/account.js';

const t = (...args) => AITrI18n.t(...args);

const MENU_ID = 'ai-translate-selection';
const ELEMENT_MENU_ID = 'ai-translate-element';
const IMAGE_MENU_ID = 'ai-translate-image';
const VIDEO_MENU_ID = 'ai-translate-video';
const PORT_NAME = 'ai-translate-panel';
const VIDEO_FILE = 'src/content/video.js';
const OFFSCREEN_URL = 'src/offscreen/offscreen.html';
// 必须与 manifest 的 content_scripts 保持一致
const CONTENT_FILES = [
  'src/lib/languages.js',
  'src/lib/messages.js',
  'src/lib/i18n.js',
  'src/lib/settings.js',
  'src/lib/requests.js',
  'src/lib/lang.js',
  'src/lib/rules.js',
  'src/lib/selector.js',
  'src/lib/tiles.js',
  'src/content/content.js',
  'src/content/elements.js',
  'src/content/image.js',
];

/** `${tabId}:${frameId}` -> 该框架最近一次上报的选中文字（保留换行）。 */
const selections = new Map();

/* ------------------------------------------------------------------ 菜单 */

async function menuTitle() {
  const settings = await AITrSettings.loadSettings();
  return t("翻译成$1", [AITrSettings.targetMenu(settings)]);
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
    await AITrI18n.ready;
    await AITrSettings.migrateSettings();
    const settings = await AITrSettings.loadSettings();
    const title = t("翻译成$1", [AITrSettings.targetMenu(settings)]);
    await chrome.contextMenus.removeAll();
    const created = [];
    const create = (props) =>
      new Promise((resolve) => {
        chrome.contextMenus.create(props, () => {
          // 必须读一次 lastError，否则会以 "Unchecked runtime.lastError" 冒到控制台
          const error = chrome.runtime.lastError;
          if (error) console.warn("[AI Translator] Failed to create context menu:", props.id, error.message);
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
      title: t("为这个区域添加翻译按钮"),
      // 只留 'page'。'page' 的含义是「点击处不是链接/图片/视频/音频」，
      // 所以右键图片时这一项一定不出现——图片被 <a> 包着也一样，
      // 那种情况上下文同时是 image 和 link，留着 'link' 就会撞车。
      // 代价：整块是链接的区域（信息流卡片）加不了元素规则，
      // 可以右键它外层的容器。
      contexts: ['page'],
      visible: true,
    });
    await create({
      id: IMAGE_MENU_ID,
      title: t("翻译图片里的文字"),
      contexts: ['image'],
      // 识图只有 LLM 平台能做，一开始就按当前平台决定
      visible: AITrSettings.supportsVision(settings.provider),
    });
    // 'video' 与上面三项都不重叠：'page' 本来就不含视频。
    // 视频实时字幕是默认关闭的实验功能：没打开就根本不建这一项，
    // 免得在视频上右键时看到一个用不了的入口。
    if (settings.videoEnabled) {
      await create({
        id: VIDEO_MENU_ID,
        title: t("视频实时字幕（实验）"),
        contexts: ['video'],
        visible: true,
      });
    }
    console.info("[AI Translator] Context menu ready:", created.join(' + ') || t("（无）"));
  });
  return menuTask;
}

chrome.runtime.onInstalled.addListener((details) => {
  createMenu();
  if (details.reason === 'install') onFirstInstall();
});

/**
 * 新安装：默认使用点数翻译，静默领取访客试用，然后打开用户端欢迎页（由它识别同一浏览器重装后的重复领取）。
 * 账户服务连不上时退回设置页的注册引导（免费试用或使用自己的 API Key）。
 */
async function onFirstInstall() {
  await AITrSettings.patchSettings({ provider: 'hosted' });
  let welcomeUrl = null;
  try {
    welcomeUrl = await AITrAccount.claimGuest();
  } catch {
    /* 离线或服务不可用：下面打开设置页的引导，首次使用点数翻译时还会补领 */
  }
  if (welcomeUrl) {
    await chrome.storage.local.set({ onboarding: 'done' });
    chrome.tabs.create({ url: welcomeUrl });
  } else {
    await chrome.storage.local.set({ onboarding: 'pending' });
    chrome.runtime.openOptionsPage();
  }
}
chrome.runtime.onStartup.addListener(createMenu);
AITrI18n.onChange(createMenu);

// 光靠上面两个事件不够：重新加载已解压的扩展时它们未必触发，
// 而右键菜单是持久化的——旧菜单会留着，于是新增的菜单项永远建不出来。
// createMenu 是 removeAll + create 且已串行化，每次 service worker 启动跑一次是安全的。
createMenu();

/** 没有可翻译的文字时把菜单藏起来；任何语言都允许手动翻译。 */
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

/** 传统翻译接口识别不了图片，换到这类平台时把「翻译图片」藏起来。 */
async function syncImageMenu(settings) {
  try {
    await chrome.contextMenus.update(IMAGE_MENU_ID, {
      visible: AITrSettings.supportsVision(settings.provider),
    });
  } catch {
    await createMenu();
  }
}

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  const settings = await AITrSettings.loadSettings();
  const wasEnabled = AITrSettings.normalize(changes.settings.oldValue).videoEnabled;
  // 视频字幕总开关变了：菜单项要整块新增或删除，只能重建
  if (wasEnabled !== settings.videoEnabled) {
    await createMenu(); // 重建时已按当前设置决定所有菜单项的显隐
    // 关掉开关时，正在播的字幕也要停掉
    if (!settings.videoEnabled) await stopAllVideoCaptions();
    return;
  }
  try {
    await chrome.contextMenus.update(MENU_ID, { title: await menuTitle() });
  } catch {
    await createMenu();
  }
  await syncImageMenu(settings);
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
    console.warn("[AI Translator] Could not inject scripts:", err?.message);
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

const translationRuns = new Map();
async function startTranslation({ tabId, text, providerId, targetId }) {
  if (!tabId || !text) return;
  translationRuns.get(tabId)?.abort();
  const controller = new AbortController();
  translationRuns.set(tabId, controller);

  const stored = await AITrSettings.loadSettings();
  const settings = AITrSettings.normalize({ ...stored,
    provider: AITrSettings.PROVIDERS[providerId] ? providerId : stored.provider,
    target: AITrSettings.TARGETS[targetId] ? targetId : stored.target,
  });
  const provider = AITrSettings.resolveProvider(settings);

  const truncated = text.length > AITrLang.MAX_TEXT_LENGTH;
  const payload = truncated ? text.slice(0, AITrLang.MAX_TEXT_LENGTH) : text;

  if (!(await ensureContentScript(tabId)) || controller.signal.aborted) return;

  let port;
  try {
    port = chrome.tabs.connect(tabId, { name: PORT_NAME, frameId: 0 });
  } catch {
    return;
  }

  let closed = false;
  const stop = () => {
    closed = true;
    controller.abort();
    if (translationRuns.get(tabId) === controller) translationRuns.delete(tabId);
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
    targetId: settings.target,
    targets: AITrSettings.targetList(),
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
      post({ type: 'error', message: t("模型没有返回任何内容，重试或换个模型试试") });
      return;
    }
    post({ type: 'done', elapsed: Date.now() - startedAt });
  } catch (err) {
    if (closed || controller.signal.aborted || err?.name === 'AbortError') return;
    post({
      type: 'error',
      message: String(err?.message || err) || t("翻译失败"),
      action: err?.action || null,
    });
  }
  // 端口由页面侧关闭：紧跟在 postMessage 后面 disconnect 有丢消息的风险。
}

/* ---------------------------------------------------------------- 视频字幕 */

/**
 * 截取和识别都在 offscreen 文档里做（见 src/offscreen/offscreen.js），
 * 字幕由它经长连接直接推给页面，不经过这里。后台只负责开关。
 */

/** 并发创建会报 "Only a single offscreen document may be created"，所以共用同一个创建任务。 */
let offscreenTask = null;

async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  offscreenTask ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_URL,
      reasons: ['USER_MEDIA'],
      justification: t("截取标签页声音，在本机做语音识别，生成视频字幕"),
    })
    .finally(() => {
      offscreenTask = null;
    });
  await offscreenTask;
}

/** 问 offscreen 文档：这个标签页的字幕是不是正开着。 */
async function videoRunning(tabId) {
  if (!(await hasOffscreen())) return false;
  try {
    return Boolean(await chrome.runtime.sendMessage({ target: 'offscreen', type: 'video-running', tabId }));
  } catch {
    return false;
  }
}

/** 关掉总开关时，把所有标签页正在播的字幕一起停掉。 */
async function stopAllVideoCaptions() {
  try {
    if (!(await hasOffscreen())) return;
    await chrome.runtime.sendMessage({ target: 'offscreen', type: 'video-stop-all' });
  } catch {
    /* offscreen 文档已经不在了，那就没有在播的字幕 */
  }
}

/** tabCapture 的报错是英文，换成用户看得懂的说法。 */
function captureErrorText(err) {
  const raw = String(err?.message || err);
  if (/not been invoked/i.test(raw)) {
    return t("没有拿到截取这个标签页的授权，请从视频的右键菜单或扩展图标重新打开");
  }
  if (/active stream/i.test(raw)) return t("这个标签页的声音正被别的程序截取（比如录屏或其他扩展）");
  return t("无法截取这个标签页的声音：$1", [raw]);
}

/**
 * 开关某个标签页的视频字幕：开着就关，关着就开。
 * 只能由用户操作触发（右键菜单、扩展图标弹窗）：tabCapture 要求扩展在这个页面上
 * 「被调用过」，也就是拿到了 activeTab 授权。
 */
async function toggleVideoCaptions({ tabId, frameId = 0, srcUrl = '' }) {
  // 「再点一次就关」不受总开关影响：关掉开关时也要能把正在播的停下
  if (await videoRunning(tabId)) {
    await chrome.runtime.sendMessage({ target: 'offscreen', type: 'video-stop', tabId }).catch(() => {});
    return;
  }
  const settings = await AITrSettings.loadSettings();
  // 总开关关着时入口本来就不该出现，这里再兜一层，挡住旧页面里残留的入口
  if (!settings.videoEnabled) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: ['src/lib/languages.js', 'src/lib/messages.js', 'src/lib/i18n.js', 'src/lib/requests.js', VIDEO_FILE] });
  } catch (err) {
    console.warn("[AI Translator] Could not show captions:", err?.message);
    return;
  }

  const lang = AITrSettings.videoLang(settings);
  const cloud = settings.videoCloud;
  const langLabel = cloud ? t("$1（云端识别）", [lang.label]) : lang.label;
  const show = (message) =>
    chrome.tabs
      .sendMessage(tabId, { srcUrl, langLabel, langName: lang.label, ...message }, { frameId })
      .catch((err) => {
        console.warn("[AI Translator] Caption message failed:", err?.message);
      });

  try {
    await ensureOffscreen();
  } catch (err) {
    await show({ type: 'video-error', message: t("无法启动语音识别：$1", [err?.message || err]) });
    return;
  }
  // 流 ID 放到最后拿：它有有效期，拿到后要尽快交给 offscreen 去用
  let streamId;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  } catch (err) {
    console.warn("[AI Translator] Tab capture failed:", err?.message);
    await show({ type: 'video-error', message: captureErrorText(err) });
    return;
  }
  await show({
    type: 'video-start',
    streamId,
    lang: lang.id,
    cloud,
    translate: settings.videoTranslate,
    targetId: settings.target,
    providerId: settings.provider,
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === VIDEO_MENU_ID && tab?.id) {
    await toggleVideoCaptions({ tabId: tab.id, frameId: info.frameId ?? 0, srcUrl: info.srcUrl || '' });
    return;
  }
  if (info.menuItemId === IMAGE_MENU_ID && tab?.id) {
    if (!(await ensureContentScript(tab.id))) return;
    try {
      await chrome.tabs.sendMessage(
        tab.id,
        { type: 'translate-image', srcUrl: info.srcUrl },
        { frameId: info.frameId ?? 0 }
      );
    } catch (err) {
      console.warn("[AI Translator] Could not translate image:", err?.message);
    }
    return;
  }
  if (info.menuItemId === ELEMENT_MENU_ID && tab?.id) {
    if (!(await ensureContentScript(tab.id))) return;
    try {
      const reply = await chrome.tabs.sendMessage(tab.id, { type: 'add-element-rule' }, { frameId: 0 });
      if (!reply?.ok) console.warn("[AI Translator] Could not add region rule:", reply?.error);
    } catch (err) {
      console.warn("[AI Translator] Could not add region rule:", err?.message);
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

// One port owns one request. Closing an overlay or replacing an image aborts the fetch.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ai-translation-request') return;
  const controller = new AbortController();
  let started = false;
  port.onDisconnect.addListener(() => controller.abort());
  port.onMessage.addListener(async (message) => {
    if (started) return;
    started = true;
    let reply;
    try {
      const stored = await AITrSettings.loadSettings();
      const settings = AITrSettings.normalize({ ...stored, provider: message.providerId || stored.provider, target: message.targetId || stored.target });
      const options = { settings, signal: controller.signal };
      if (message.type === 'read-image') {
        const result = await AITrProviders.readImageText({ ...options, image: message.image, imageSize: message.imageSize, model: AITrSettings.visionModel(settings.provider) });
        reply = { ok: true, blocks: result.blocks };
      } else if (message.type === 'translate-batch') {
        reply = { ok: true, texts: await AITrProviders.translateBatch({ ...options, texts: message.texts }) };
      } else if (message.type === 'translate-caption') {
        const start = Date.now();
        const text = await AITrProviders.translateCaption({ ...options, text: message.text, context: message.context });
        reply = { ok: true, text, elapsed: Date.now() - start };
      } else { throw new Error('Unknown translation request'); }
    } catch (error) {
      reply = { ok: false, error: String(error?.message || error), action: error?.action || null };
    }
    if (!controller.signal.aborted) {
      try { port.postMessage(reply); } catch { controller.abort(); }
    }
  });
});

/**
 * 扩展登录完成后的收尾：引导结束；还没配置任何 API Key 时直接切到点数翻译。
 * 然后回到发起登录的页面并关掉回调页；发起页已关闭（或从弹窗发起）时把回调页换成设置页。
 */
async function finishLogin(callbackUrl, callbackTab) {
  const { returnTabId } = await AITrAccount.completeLogin(callbackUrl);
  await chrome.storage.local.set({ onboarding: 'done' });
  const settings = await AITrSettings.loadSettings();
  if (!AITrSettings.isHosted(settings.provider) && !AITrSettings.KEY_PROVIDERS.some((id) => settings[id]?.apiKey)) {
    await AITrSettings.patchSettings({ provider: 'hosted' });
  }
  const returnTab = returnTabId != null ? await chrome.tabs.get(returnTabId).catch(() => null) : null;
  if (returnTab) {
    await chrome.tabs.update(returnTab.id, { active: true });
    await chrome.tabs.remove(callbackTab.id).catch(() => {});
  } else {
    await chrome.tabs.update(callbackTab.id, { url: chrome.runtime.getURL('src/options/options.html') });
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = message?.type;
  if (type === 'get-ui-messages') {
    AITrI18n.ready.then(() => sendResponse(AITrI18n.snapshot()));
    return true;
  }
  if (type === 'set-default-target') {
    if (!AITrSettings.TARGETS[message.targetId]) { sendResponse({ ok: false }); return false; }
    AITrSettings.patchSettings({ target: message.targetId }).then(() => sendResponse({ ok: true }));
    return true;
  }

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

  // 识图 + 翻译一次做完，内容脚本只负责显示
  // 只做识别，不翻译。长图会切成多块分别识别，
  // 合并去重之后再统一翻译，避免同一段话被翻两次。
  if (type === 'read-image') {
    (async () => {
      try {
        const stored = await AITrSettings.loadSettings();
        const settings = AITrSettings.normalize({ ...stored, provider: message.providerId || stored.provider });
        const result = await AITrProviders.readImageText({
          image: message.image,
          imageSize: message.imageSize,
          settings,
          model: AITrSettings.visionModel(settings.provider),
        });
        sendResponse({ ok: true, blocks: result.blocks });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err), action: err?.action || null });
      }
    })();
    return true; // 异步回复
  }

  // 内容脚本不能直接请求接口（会受页面 CORS 限制），统一由这里代发
  if (type === 'translate-batch') {
    (async () => {
      try {
        const stored = await AITrSettings.loadSettings();
        const settings = AITrSettings.normalize({ ...stored, provider: message.providerId || stored.provider, target: message.targetId || stored.target });
        const texts = await AITrProviders.translateBatch({ texts: message.texts, settings });
        sendResponse({ ok: true, texts });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true; // 异步回复
  }

  // 视频字幕逐行翻译。和 translate-batch 一样，内容脚本不能直接请求接口，由这里代发
  if (type === 'translate-caption') {
    (async () => {
      const startedAt = Date.now();
      try {
        const stored = await AITrSettings.loadSettings();
        const settings = AITrSettings.normalize({ ...stored, provider: message.providerId || stored.provider, target: message.targetId || stored.target });
        const text = await AITrProviders.translateCaption({
          text: message.text,
          context: message.context,
          settings,
        });
        const elapsed = Date.now() - startedAt;
        // 翻译延迟只能用真实 Key 量，留一条日志方便对照
        const provider = AITrSettings.resolveProvider(settings);
        console.info(t("[AI 划词翻译] 字幕翻译 $1ms（$2 $3）", [elapsed, provider.label, provider.model]));
        sendResponse({ ok: true, text, elapsed });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err), action: err?.action || null });
      }
    })();
    return true; // 异步回复
  }

  if (type === 'retranslate') {
    startTranslation({
      tabId: sender.tab?.id,
      text: message.text,
      providerId: message.providerId,
      targetId: message.targetId,
    });
    return false;
  }

  if (type === 'open-options') {
    chrome.runtime.openOptionsPage();
    return false;
  }

  // 扩展图标弹窗里的入口：播放器拦掉右键、点不到视频菜单项时用它
  if (type === 'video-toggle') {
    if (message.tabId != null) toggleVideoCaptions({ tabId: message.tabId });
    return false;
  }

  /* ---------------------------------------------------------- 账户与托管翻译 */

  // 用户端页面只能通知核对状态；完整来源（含本地端口）与顶层框架均由后台核验。
  // 页面不能直接设置登录状态，也拿不到刷新返回的账户数据。
  if (type === 'account-web-changed') {
    if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.tab || !AITrEnv.isAccountPage(sender.url)) return false;
    AITrAccount.refresh()
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  // 账户操作只接受扩展自己的页面（设置页、弹窗、翻译面板）发来的消息，网页内容脚本不能调用。
  const fromExtensionPage = sender.id === chrome.runtime.id && String(sender.url || '').startsWith(chrome.runtime.getURL(''));
  const accountReply = (task) => {
    task.then((status) => sendResponse({ ok: true, status }))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err), code: err?.code || null }));
    return true;
  };
  // 授权页开在发起页所在的窗口；弹窗没有标签页，落到当前窗口
  if (type === 'account-login' && fromExtensionPage) {
    return accountReply(AITrAccount.login({ windowId: sender.tab?.windowId, tabId: sender.tab?.id }));
  }
  // 回调页（src/auth/callback.html）交回授权结果：换取令牌后回到发起登录的页面
  if (type === 'account-callback' && fromExtensionPage && sender.tab) {
    finishLogin(String(message.url || ''), sender.tab)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err), code: err?.code || null }));
    return true;
  }
  if (type === 'account-logout' && fromExtensionPage) return accountReply(AITrAccount.logout());
  // 设置页引导里的「免费试用」：安装时没领到（离线）时手动领取，并打开欢迎页
  if (type === 'account-guest' && fromExtensionPage) {
    return accountReply(AITrAccount.claimGuest().then((url) => {
      if (url) chrome.tabs.create({ url, windowId: sender.tab?.windowId });
      return AITrAccount.refresh();
    }));
  }
  if (type === 'account-refresh' && fromExtensionPage) return accountReply(AITrAccount.refresh());
  if (type === 'hosted-translate' && fromExtensionPage) {
    AITrAccount.translate({ texts: message.texts, target: message.target, source: message.source })
      .then((texts) => sendResponse({ ok: true, texts }))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err), action: err?.action || null }));
    return true;
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
  translationRuns.get(tabId)?.abort();
  translationRuns.delete(tabId);
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
const shortcutLog = (reason) => console.info(t("[AI 划词翻译] 快捷键未触发翻译：$1", [reason]));

async function onShortcut(command, tab) {
  if (command !== 'translate-selection') return;

  const settings = await AITrSettings.loadSettings();
  if (!settings.shortcut) {
    shortcutLog(t("设置里已关闭「快捷键翻译」"));
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
    shortcutLog(t("拿不到当前标签页"));
    return;
  }

  // 先确保页面脚本在位，否则问不到选区（刚重载扩展、或标签页是旧的）
  if (!(await ensureContentScript(tabId))) {
    shortcutLog(t("这个页面不允许注入脚本（例如 chrome:// 开头的页面）"));
    return;
  }

  const text = await selectionForTab(tabId);
  if (!text) {
    shortcutLog(t("当前没有选中任何文字"));
    return;
  }
  // 与右键菜单同一套规则
  if (!AITrLang.shouldOffer(text)) {
    shortcutLog(t("选中的内容没有可翻译的文字"));
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
  console.warn("[AI Translator] chrome.commands is unavailable. Reload the extension to enable keyboard shortcuts.");
}
