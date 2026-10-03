/**
 * 视频实时字幕：在视频上叠一层字幕。
 *
 * 不随页面常驻：用户点「视频实时字幕」时，后台才把它注入到视频所在的框架。
 * 识别在 offscreen 文档里做，这里只负责连过去、收字幕、画出来。
 * 连接一断（页面跳走、标签页关闭、用户点关闭），offscreen 那边就停止截取。
 */
(() => {
  if (window.__aiTranslationVideoLoaded) return;
  window.__aiTranslationVideoLoaded = true;

  const PORT_NAME = 'ai-video';
  /** 多久没有新字幕就收起字幕，免得一句话一直挂在没人说话的画面上。 */
  const IDLE_HIDE_MS = 6000;
  /** 视频比这还小（或露在窗口里的部分比这还小）就不贴着它，改贴窗口底部。 */
  const MIN_WIDTH = 120;
  const MIN_HEIGHT = 40;

  // 字幕惯例是黑底白字，不跟随深浅色模式
  const STYLE = `
  [hidden] { display: none !important; }
  .box {
    position: absolute; left: 50%; bottom: 9%;
    transform: translateX(-50%);
    box-sizing: border-box;
    width: max-content; max-width: 90%;
    padding: 0.3em 0.75em 0.36em;
    border-radius: 0.4em;
    background: rgba(10, 10, 12, 0.74);
    color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
                 "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    font-size: var(--fs, 18px); font-weight: 500; font-style: normal;
    line-height: 1.42; letter-spacing: normal; text-align: center;
    text-transform: none; white-space: normal; overflow-wrap: anywhere;
    pointer-events: auto;
  }
  .prev { font-size: 0.8em; opacity: 0.62; }
  .status {
    display: flex; align-items: center; justify-content: center; gap: 7px;
    font-size: 13px; font-weight: 400; color: rgba(255, 255, 255, 0.86);
  }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: #a5b4fc; flex: none; }
  .status.listening .dot { background: #4ade80; animation: pulse 1.4s ease-in-out infinite; }
  .status.error .dot { background: #f87171; }
  @keyframes pulse { 50% { opacity: 0.3 } }
  .act {
    font: inherit; font-size: 12px; color: #a5b4fc; cursor: pointer;
    background: none; border: 0; padding: 0; text-decoration: underline;
  }
  .close {
    position: absolute; top: -10px; right: -10px;
    width: 22px; height: 22px; padding: 0; box-sizing: border-box;
    display: grid; place-items: center;
    border-radius: 50%; border: 1px solid rgba(255, 255, 255, 0.25);
    background: rgba(10, 10, 12, 0.92); color: #fff; cursor: pointer;
    opacity: 0; transition: opacity 0.15s;
  }
  .close svg { width: 10px; height: 10px; }
  .box:hover .close, .box.has-status .close, .close:focus-visible { opacity: 1; }
  .act:focus-visible, .close:focus-visible { outline: 2px solid #a5b4fc; outline-offset: 1px; }`;

  const CLOSE_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  let ui = null;
  let state = null;
  let port = null;
  let video = null;
  let raf = 0;

  function send(message) {
    try {
      const promise = chrome.runtime.sendMessage(message);
      if (promise && typeof promise.catch === 'function') promise.catch(() => {});
    } catch {
      /* 扩展刚更新时上下文会失效，忽略即可 */
    }
  }

  /** 右键点的是哪个视频：优先按地址精确匹配，否则取正在播放的、画面最大的那个。 */
  function findVideo(srcUrl) {
    const videos = [...document.querySelectorAll('video')];
    if (srcUrl) {
      const hit = videos.find((v) => v.currentSrc === srcUrl || v.src === srcUrl);
      if (hit) return hit;
    }
    const area = (v) => {
      const r = v.getBoundingClientRect();
      return r.width * r.height;
    };
    const score = (v) => (v.paused ? 0 : 1e9) + area(v);
    return videos.filter((v) => area(v) > 0).sort((a, b) => score(b) - score(a))[0] || null;
  }

  /** 字幕贴着视频露在窗口里的部分；找不到视频、或视频滚出了窗口，就贴窗口底部。 */
  function anchorRect() {
    if (video?.isConnected) {
      const r = video.getBoundingClientRect();
      const left = Math.max(r.left, 0);
      const top = Math.max(r.top, 0);
      const right = Math.min(r.right, innerWidth);
      const bottom = Math.min(r.bottom, innerHeight);
      if (right - left >= MIN_WIDTH && bottom - top >= MIN_HEIGHT) {
        return { left, top, width: right - left, height: bottom - top };
      }
    }
    return { left: 0, top: 0, width: innerWidth, height: innerHeight };
  }

  function build() {
    const host = document.createElement('div');
    host.style.cssText =
      'all: initial; position: fixed !important; z-index: 2147483647 !important;' +
      'display: block !important; pointer-events: none !important; margin: 0 !important;';
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    const box = document.createElement('div');
    box.className = 'box';
    box.innerHTML = `
      <div class="prev" hidden></div>
      <div class="cur" hidden></div>
      <div class="status"><span class="dot"></span><span class="label"></span><button class="act" type="button" hidden>去设置</button></div>
      <button class="close" type="button" title="关闭字幕" aria-label="关闭字幕">${CLOSE_ICON}</button>`;
    root.append(style, box);
    (document.body || document.documentElement).appendChild(host);

    ui = {
      host,
      box,
      prev: box.querySelector('.prev'),
      cur: box.querySelector('.cur'),
      status: box.querySelector('.status'),
      label: box.querySelector('.label'),
      act: box.querySelector('.act'),
      key: '',
      fresh: null,
    };
    box.querySelector('.close').addEventListener('click', close);
    ui.act.addEventListener('click', () => send({ type: 'open-options' }));
    raf = requestAnimationFrame(follow);
  }

  const isFresh = () =>
    Boolean(state.partial) || (state.lines.length > 0 && Date.now() - state.activeAt < IDLE_HIDE_MS);

  function render() {
    if (!ui || !state) return;
    const showCaption = !state.error && isFresh();
    ui.fresh = showCaption;
    const last = state.lines.at(-1) || '';
    const before = state.lines.at(-2) || '';
    const curText = showCaption ? state.partial || last : '';
    const prevText = showCaption ? (state.partial ? last : before) : '';
    ui.prev.textContent = prevText;
    ui.prev.hidden = !prevText;
    ui.cur.textContent = curText;
    ui.cur.hidden = !curText;

    ui.status.hidden = Boolean(curText);
    ui.box.classList.toggle('has-status', !ui.status.hidden);
    ui.status.className = `status ${state.error ? 'error' : state.phase}`;
    ui.label.textContent =
      state.error || (state.phase === 'listening' ? `正在听${state.langLabel}…` : '正在连接…');
    ui.act.hidden = !(state.error && state.action === 'open-options');
  }

  /** 每帧跟着视频走：位置、大小、全屏切换、字幕过期收起。 */
  function follow() {
    raf = requestAnimationFrame(follow);
    // 全屏时只渲染全屏元素的子树，浮层要跟着搬进去。
    // 全屏的是 <video> 本身（原生控件的全屏按钮）时没法叠加任何东西，只能留在原处。
    const full = document.fullscreenElement;
    const parent = full && full.tagName !== 'VIDEO' ? full : document.body || document.documentElement;
    if (ui.host.parentNode !== parent) parent.appendChild(ui.host);

    const r = anchorRect();
    const key = `${r.left}|${r.top}|${r.width}|${r.height}`;
    if (key !== ui.key) {
      ui.key = key;
      const css = ui.host.style;
      css.setProperty('left', `${r.left}px`, 'important');
      css.setProperty('top', `${r.top}px`, 'important');
      css.setProperty('width', `${r.width}px`, 'important');
      css.setProperty('height', `${r.height}px`, 'important');
      ui.box.style.setProperty('--fs', `${Math.round(Math.min(30, Math.max(14, r.width * 0.03)))}px`);
    }
    if (ui.fresh !== (!state.error && isFresh())) render();
  }

  function teardown() {
    cancelAnimationFrame(raf);
    ui?.host.remove();
    ui = null;
    state = null;
    video = null;
  }

  function close() {
    const current = port;
    port = null;
    try {
      current?.disconnect();
    } catch {
      /* 已经断开 */
    }
    teardown();
  }

  function open({ srcUrl, langLabel }) {
    close(); // 同一个页面只保留一路
    video = findVideo(srcUrl);
    state = { phase: 'connecting', langLabel: langLabel || '', lines: [], partial: '', activeAt: 0, error: null, action: null };
    build();
    render();
  }

  function fail(message, action = null) {
    if (!state) return;
    state.error = message || '视频字幕出错';
    state.action = action;
    render();
  }

  function onPortMessage(message) {
    if (!state) return;
    switch (message?.type) {
      case 'state':
        state.phase = message.state;
        break;
      case 'partial':
        state.partial = message.text || '';
        if (state.partial) state.activeAt = Date.now();
        break;
      case 'line':
        // 停顿提交时后面不会再跟一条 partial，这里先清掉，免得同一句显示两遍
        state.partial = '';
        state.lines = [...state.lines, message.text].slice(-2);
        state.activeAt = Date.now();
        break;
      case 'error':
        fail(message.message, message.action);
        return;
    }
    render();
  }

  function start(message) {
    open(message);
    let current;
    try {
      current = chrome.runtime.connect({ name: PORT_NAME });
    } catch {
      fail('扩展已更新，请刷新页面后再试');
      return;
    }
    port = current;
    current.onMessage.addListener(onPortMessage);
    current.onDisconnect.addListener(() => {
      void chrome.runtime.lastError; // 读一次，免得控制台报 Unchecked runtime.lastError
      if (port !== current) return;
      port = null;
      if (!state || state.error) return; // 错误留着给用户看，由用户关闭
      if (state.phase === 'connecting') {
        fail('没有连上识别服务，再试一次');
        return;
      }
      teardown(); // 后台让停的（再点一次菜单）
    });
    current.postMessage({ type: 'start', streamId: message.streamId, lang: message.lang });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'video-start') {
      start(message);
      sendResponse({ ok: true });
    } else if (message?.type === 'video-error') {
      open(message);
      fail(message.message, message.action);
      sendResponse({ ok: true });
    }
    return false;
  });
})();
