/**
 * 整份视频翻译的右下角提示与扩展图标角标（只在 service worker 用，见 docs/extension/video-file-translation.md）。
 *
 * 翻译不跟着网页走：关掉视频所在的标签页、换到别的网页，翻译照常在后台做完。为了让用户知道还在翻：
 * - 正在翻时，用户正在看的网页右下角有一条进度提示（content/video-notice.js），切到哪个标签页就跟到哪；
 *   点它打开「视频翻译」页，× 收起这一条的进度提示（翻好后照样提醒）。视频旁的浮层还开着的那个标签页里不重复显示。
 * - 翻好、失败或要用户选语言时，同一个位置换成卡片，跨标签页跟着用户，直到点开、关掉或过了 KEEP_MS。
 * - 扩展图标的角标：正在翻显示进度（几个同时翻显示个数），翻好显示 ✓、失败显示 !，看过就清掉。
 *   受保护的页面（新标签页、扩展商店）注入不了提示，角标兜底。
 *
 * 提示只用这里传过去的文字（标题、状态），网页拿不到任务的网址；无痕窗口的任务只在无痕窗口里提示，反之亦然。
 * 不自己注册扩展事件：由后台的 onConnect、tabs / windows 事件转来。
 */
(() => {
  const t = (...args) => AITrI18n.t(...args);

  const PORT_NAME = 'ai-video-notice';
  const CONTENT_FILE = 'src/content/video-notice.js';
  /** 翻好、失败的卡片最多留这么久（用户一直没看）。 */
  const KEEP_MS = 30 * 60_000;
  const COLORS = { work: '#4a4fc0', done: '#16a34a', fail: '#dc2626', ask: '#d97706' };

  /** id → { id, tone: 'work' | 'done' | 'fail' | 'ask', title, heading, detail, progress, incognito, muted, at } */
  const items = new Map();
  /** 已注入提示的标签页连回来的长连接：port → { tabId, incognito } */
  const ports = new Map();
  /** 视频旁的浮层开在哪个标签页（由 video-file.js 提供）：那里不重复显示进度。 */
  let overlayTab = () => null;
  let expiry = 0;

  function init(options = {}) {
    if (typeof options.overlayTab === 'function') overlayTab = options.overlayTab;
  }

  const seconds = (ms) => Math.round((Number(ms) || 0) / 1000);

  /** 进度说明（与浮层的说法一致）。 */
  function progressText(p) {
    switch (p?.phase) {
      case 'download':
        return p.total ? t("正在读取视频… $1%", [Math.min(99, Math.round((p.loaded / p.total) * 100))]) : t("正在读取视频…");
      case 'decode':
        return t("正在提取声音…");
      case 'recognize':
        return p.mode === 'audio'
          ? t("正在由 OpenAI 识别语音…")
          : t("正在按$1识别语音（$2 / $3 秒）…", [p.lang || '', seconds(p.done), seconds(p.total)]);
      case 'detect':
        return t("正在判断视频说的是什么语言（试听：$1）…", [(p.langs || []).join('、')]);
      case 'translate':
        return t("正在翻译字幕…");
      default:
        return t("正在读取视频…");
    }
  }

  /** 整体进度 0–1：读取视频占一成，识别占八成（本机识别按 1 倍速，最花时间），翻译在最后。 */
  function progressOf(p) {
    switch (p?.phase) {
      case 'download':
        return p.total ? 0.1 * Math.min(1, p.loaded / p.total) : 0.02;
      case 'decode':
        return 0.1;
      case 'detect':
      case 'recognize':
        return p.total ? 0.1 + 0.8 * Math.min(1, (Number(p.done) || 0) / p.total) : 0.1;
      case 'translate':
        return 0.92;
      default:
        return 0;
    }
  }

  /** 这个标签页该显示哪些（无痕与否要一致；浮层开在这一页时进度不重复显示）。 */
  function visibleFor({ tabId, incognito }) {
    return [...items.values()].filter((item) => item.incognito === incognito
      && !((item.tone === 'work' || item.tone === 'ask') && (item.muted || overlayTab(item.id) === tabId)));
  }

  const view = (item) => ({
    id: item.id, tone: item.tone, title: item.title, heading: item.heading, detail: item.detail,
    progress: item.tone === 'work' ? item.progress : null,
  });

  function labels() {
    return { close: t("关闭"), open: t("打开「视频翻译」页") };
  }

  function send(port, info) {
    try {
      port.postMessage({ type: 'state', items: visibleFor(info).map(view), labels: labels() });
    } catch {
      ports.delete(port);
    }
  }

  function broadcast() {
    for (const [port, info] of ports) send(port, info);
    badge();
  }

  /** 扩展图标的角标：所有窗口共用，所以只显示个数与进度，不显示标题。 */
  function badge() {
    const action = chrome.action;
    if (!action?.setBadgeText) return;
    const list = [...items.values()];
    const work = list.filter((item) => item.tone === 'work' || item.tone === 'ask');
    let text = '';
    let tone = 'work';
    if (work.length === 1) {
      tone = work[0].tone;
      text = tone === 'ask' ? '?' : `${Math.min(99, Math.round((work[0].progress || 0) * 100))}%`;
    } else if (work.length > 1) {
      text = String(work.length);
    } else if (list.some((item) => item.tone === 'fail')) {
      tone = 'fail';
      text = '!';
    } else if (list.length) {
      tone = 'done';
      text = '✓';
    }
    action.setBadgeText({ text }).catch?.(() => {});
    if (text) action.setBadgeBackgroundColor?.({ color: COLORS[tone] })?.catch?.(() => {});
    action.setBadgeTextColor?.({ color: '#ffffff' })?.catch?.(() => {});
  }

  /** 在当前窗口正在看的网页注入提示（已经注入过、连着的就不再注入）。受保护的页面注入不了，靠角标。 */
  async function showInActiveTab() {
    if (!items.size) return;
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
    if (tab?.id == null) return;
    const info = { tabId: tab.id, incognito: tab.incognito === true };
    if (!visibleFor(info).length) return;
    if ([...ports.values()].some((p) => p.tabId === tab.id)) return;
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [CONTENT_FILE] }).catch(() => {});
  }

  /** 过期的卡片清掉（用户一直没看）。 */
  function scheduleExpiry() {
    clearTimeout(expiry);
    const ended = [...items.values()].filter((item) => item.tone === 'done' || item.tone === 'fail');
    if (!ended.length) return;
    const next = Math.min(...ended.map((item) => item.at + KEEP_MS));
    expiry = setTimeout(() => {
      const now = Date.now();
      let changed = false;
      for (const item of ended) {
        if (item.at + KEEP_MS <= now && items.get(item.id) === item) { items.delete(item.id); changed = true; }
      }
      if (changed) broadcast();
      scheduleExpiry();
    }, Math.max(1000, next - Date.now()));
  }

  /** 开始翻一个视频：进度提示出现在用户正在看的网页上（视频所在那一页由浮层显示）。 */
  function start(id, { title = '', incognito = false } = {}) {
    items.set(id, { id, tone: 'work', title, heading: t("正在翻译视频"), detail: t("正在读取视频…"), progress: 0, incognito, muted: false, at: Date.now() });
    broadcast();
    showInActiveTab();
  }

  /** 进度更新：已经显示提示的标签页实时更新；不另外注入（切换标签页时才跟过去）。 */
  function progress(id, p) {
    const item = items.get(id);
    if (!item) return;
    const wasAsk = item.tone === 'ask';
    Object.assign(item, { tone: 'work', heading: t("正在翻译视频"), detail: progressText(p), progress: progressOf(p) });
    broadcast();
    if (wasAsk) showInActiveTab();
  }

  /**
   * 翻好、失败或要用户选语言：换成卡片，出现在用户正在看的网页上。
   * 用户正看着视频所在那一页（浮层开着）时浮层自己会说，翻好、失败就不另弹。
   */
  async function finish(id, { tone, heading, detail = '' }) {
    const item = items.get(id);
    if (!item) return;
    if (tone !== 'ask') {
      const tabId = overlayTab(id);
      const tab = tabId == null ? null : await chrome.tabs.get(tabId).catch(() => null);
      const focused = tab?.active ? await chrome.windows?.get?.(tab.windowId).then((w) => w.focused, () => true) : false;
      if (tab?.active && focused !== false) { remove(id); return; }
    }
    Object.assign(item, { tone, heading, detail, progress: null, at: Date.now() });
    broadcast();
    scheduleExpiry();
    showInActiveTab();
  }

  function remove(id) {
    if (!items.delete(id)) return;
    broadcast();
  }

  /** 切到了别的标签页、窗口，或当前页刷新了：提示跟过去。翻好的卡片在视频所在那一页（浮层开着）被看到就算看过了。 */
  function onTabActivated(tabId) {
    let changed = false;
    for (const item of [...items.values()]) {
      if ((item.tone === 'done' || item.tone === 'fail') && overlayTab(item.id) === tabId) { items.delete(item.id); changed = true; }
    }
    if (changed) broadcast();
    showInActiveTab();
  }

  function onTabUpdated(tabId, changeInfo, tab) {
    if (changeInfo.status === 'complete' && tab?.active) showInActiveTab();
  }

  /** 提示连回来（content/video-notice.js）：只认顶层框架；点击打开「视频翻译」页、× 收起。 */
  function onConnect(port) {
    if (port.name !== PORT_NAME) return;
    const tab = port.sender?.tab;
    if (port.sender?.id !== chrome.runtime.id || tab?.id == null || (port.sender.frameId ?? 0) !== 0) {
      port.disconnect();
      return;
    }
    const info = { tabId: tab.id, incognito: tab.incognito === true };
    ports.set(port, info);
    port.onMessage.addListener((message) => {
      const item = items.get(String(message?.id || ''));
      if (message?.type === 'open') {
        AITrVideoFile.openViewer(item && item.tone !== 'fail' ? item.id : '').catch(() => {});
        if (item && (item.tone === 'done' || item.tone === 'fail')) remove(item.id);
      } else if (message?.type === 'dismiss' && item) {
        // 进度、选语言的提示只收起（翻好后照样提醒）；翻好、失败的卡片关掉就算看过了
        if (item.tone === 'work' || item.tone === 'ask') { item.muted = true; broadcast(); } else remove(item.id);
      }
    });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      ports.delete(port);
    });
    send(port, info);
  }

  /** 视频所在那一页的浮层接上、断开时：重新决定各页显示什么（浮层关了，当前页就要显示进度）。 */
  function refresh() {
    broadcast();
    showInActiveTab();
  }

  globalThis.AITrVideoNotice = {
    init, start, progress, finish, remove, refresh, onConnect, onTabActivated, onTabUpdated, onWindowFocused: showInActiveTab, progressOf, PORT_NAME,
    /** 测试用 */
    items: () => [...items.values()].map((item) => ({ ...item })),
  };
})();
