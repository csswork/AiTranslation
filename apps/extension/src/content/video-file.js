/**
 * 整份视频翻译的字幕浮层（见 docs/extension/video-file-translation.md）。
 *
 * 不随页面常驻：用户右键视频点「翻译这个视频」时，后台才把它注入到视频所在的框架。
 * 取文件、识别、翻译都在扩展里做，这里只凭后台给的 jobId 连回去，显示进度，
 * 拿到带时间的字幕后按视频的播放时间显示「译文大字 + 原文小字」。关掉浮层就取消这一路。
 * 本页已经翻好的视频记在内存里，再点一次直接显示，不重新识别。
 */
(() => {
  const t = (...args) => AITrI18n.t(...args);
  if (window.__aiTranslationVideoFileLoaded) return;
  window.__aiTranslationVideoFileLoaded = true;

  const PORT_NAME = 'ai-video-file';
  /** 视频比这还小（或露在窗口里的部分比这还小）就不贴着它，改贴窗口底部。 */
  const MIN_WIDTH = 120;
  const MIN_HEIGHT = 40;
  /** 「字幕已准备好」「没有识别到人声」这类提示显示多久。 */
  const NOTICE_MS = 4000;

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
  .orig { font-size: 0.7em; font-weight: 400; opacity: 0.78; margin-top: 0.1em; }
  .status {
    display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 4px 7px;
    font-size: 13px; font-weight: 400; color: rgba(255, 255, 255, 0.88);
  }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: #a5b4fc; flex: none; }
  .status.busy .dot { background: #4ade80; animation: pulse 1.4s ease-in-out infinite; }
  .status.error .dot { background: #f87171; }
  .status.notice .dot { background: #fbbf24; }
  @keyframes pulse { 50% { opacity: 0.3 } }
  .bar { width: 100%; height: 3px; border-radius: 2px; background: rgba(255, 255, 255, 0.18); overflow: hidden; margin-top: 5px; }
  .bar i { display: block; height: 100%; width: 0; background: #a5b4fc; transition: width 0.4s linear; }
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

  /** 本页已经翻好的视频：`${resultKey}\n${srcUrl}` → cues */
  const results = new Map();

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

  /** 右键点的是哪个视频：按地址匹配（含 <source>），否则取正在播放的、画面最大的那个。 */
  function findVideo(srcUrl) {
    const videos = [...document.querySelectorAll('video')];
    if (srcUrl) {
      const hit = videos.find((v) => v.currentSrc === srcUrl || v.src === srcUrl
        || [...v.querySelectorAll('source')].some((s) => s.src === srcUrl));
      if (hit) return hit;
    }
    const area = (v) => {
      const r = v.getBoundingClientRect();
      return r.width * r.height;
    };
    const score = (v) => (v.paused ? 0 : 1e9) + area(v);
    return videos.filter((v) => area(v) > 0).sort((a, b) => score(b) - score(a))[0] || null;
  }

  /** 字幕贴着视频露在窗口里的部分；视频滚出了窗口就贴窗口底部。 */
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
      <div class="tr" hidden></div>
      <div class="orig" hidden></div>
      <div class="status"><span class="dot"></span><span class="label"></span><button class="act" type="button" hidden>去设置</button></div>
      <div class="bar" hidden><i></i></div>
      <button class="close" type="button" title="关闭字幕" aria-label="关闭字幕">${CLOSE_ICON}</button>`;
    root.append(style, box);
    AITrI18n.localize(root);
    (document.body || document.documentElement).appendChild(host);

    ui = {
      host,
      box,
      tr: box.querySelector('.tr'),
      orig: box.querySelector('.orig'),
      status: box.querySelector('.status'),
      label: box.querySelector('.label'),
      act: box.querySelector('.act'),
      bar: box.querySelector('.bar'),
      fill: box.querySelector('.bar i'),
      key: '',
      sig: '',
    };
    box.querySelector('.close').addEventListener('click', close);
    ui.act.addEventListener('click', () => send({ type: 'open-options', section: 'video' }));
    raf = requestAnimationFrame(follow);
  }

  const seconds = (ms) => Math.round((Number(ms) || 0) / 1000);

  /** 进度说明。 */
  function progressText(p) {
    switch (p.phase) {
      case 'download':
        return p.total ? t("正在读取视频… $1%", [Math.min(99, Math.round((p.loaded / p.total) * 100))]) : t("正在读取视频…");
      case 'decode':
        return t("正在提取声音…");
      case 'recognize':
        return p.mode === 'audio'
          ? t("正在由 OpenAI 识别语音…")
          : t("正在本机识别语音（$1 / $2 秒）…", [seconds(p.done), seconds(p.total)]);
      case 'translate':
        return t("正在翻译字幕…");
      default:
        return t("正在读取视频…");
    }
  }

  /** 当前播放时间对应的字幕句。 */
  function currentCue() {
    if (!state?.cues?.length || !video) return null;
    const ms = video.currentTime * 1000;
    return state.cues.find((cue) => ms >= cue.start && ms < cue.end) || null;
  }

  const noticeOn = () => Boolean(state?.notice) && Date.now() - state.noticeAt < NOTICE_MS;
  /** 画面该不该变的指纹：换句、提示到点消失都要重画。 */
  const signature = () => `${state.cues ? state.cues.indexOf(currentCue()) : -2}|${noticeOn()}|${state.status}|${state.error}`;

  function fill(el, text) {
    el.dir = 'auto';
    el.textContent = text;
    el.hidden = !text;
  }

  function render() {
    if (!ui || !state) return;
    ui.sig = signature();
    const cue = state.error ? null : currentCue();
    fill(ui.tr, cue?.tr || '');
    fill(ui.orig, cue && cue.text !== cue.tr ? cue.text : '');

    const notice = noticeOn() ? state.notice : '';
    const label = state.error || state.status || notice;
    ui.status.hidden = !label;
    ui.box.classList.toggle('has-status', Boolean(label));
    ui.status.className = `status ${state.error ? 'error' : state.status ? 'busy' : 'notice'}`;
    ui.label.textContent = label;
    ui.act.hidden = !(state.error && state.action);
    const ratio = state.status && state.progress != null ? state.progress : null;
    ui.bar.hidden = ratio == null;
    if (ratio != null) ui.fill.style.width = `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`;
    ui.box.hidden = !cue && !label;
  }

  /** 每帧跟着视频走：位置、大小、全屏切换、按播放时间换句。 */
  function follow() {
    raf = requestAnimationFrame(follow);
    if (video && !video.isConnected) { close(); return; } // 视频被页面换掉了（无限滚动回收等）
    // 全屏时只渲染全屏元素的子树，浮层要跟着搬进去。全屏的是 <video> 本身时没法叠加，只能留在原处
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
      ui.box.style.setProperty('--fs', `${Math.round(Math.min(30, Math.max(14, r.width * 0.035)))}px`);
    }
    if (ui.sig !== signature()) render();
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

  function fail(message, action = null) {
    if (!state) return;
    state.error = message || t("视频翻译出错：$1", ['?']);
    state.action = action === 'open-video-options' || action === 'open-options' ? action : null;
    state.status = '';
    render();
  }

  function notice(text) {
    state.notice = text;
    state.noticeAt = Date.now();
  }

  function finish(message) {
    state.status = '';
    state.progress = null;
    const cues = Array.isArray(message.cues) ? message.cues : [];
    if (!cues.length) {
      notice(message.reason === 'silent' ? t("这个视频没有声音") : t("没有识别到人声"));
      render();
      // 没有可显示的字幕：提示看完就收起
      const current = state;
      setTimeout(() => { if (state === current) close(); }, NOTICE_MS + 200);
      return;
    }
    state.cues = cues;
    results.set(state.cacheKey, cues);
    notice(t("字幕已准备好，共 $1 句", [cues.length]));
    render();
  }

  function onPortMessage(message) {
    if (!state) return;
    switch (message?.type) {
      case 'progress':
        state.status = progressText(message);
        state.progress = message.phase === 'recognize' && message.mode !== 'audio' && message.total
          ? message.done / message.total
          : message.phase === 'download' && message.total ? message.loaded / message.total : null;
        break;
      case 'done':
        finish(message);
        return;
      case 'error':
        fail(message.message, message.action);
        return;
    }
    render();
  }

  async function open({ jobId, srcUrl, error, resultKey }) {
    close(); // 同一个框架只保留一路
    await AITrI18n.ready;
    video = findVideo(srcUrl);
    state = {
      cacheKey: `${resultKey}\n${srcUrl}`,
      cues: null,
      status: t("正在读取视频…"),
      progress: null,
      error: '',
      action: null,
      notice: '',
      noticeAt: 0,
    };
    build();
    render();
    if (error) { fail(error); return; }

    const known = results.get(state.cacheKey);
    if (known) { finish({ cues: known }); return; }

    let current;
    try {
      current = chrome.runtime.connect({ name: PORT_NAME });
    } catch {
      fail(t("扩展已更新，请刷新页面后再试"));
      return;
    }
    port = current;
    current.onMessage.addListener(onPortMessage);
    current.onDisconnect.addListener(() => {
      void chrome.runtime.lastError; // 读一次，免得控制台报 Unchecked runtime.lastError
      if (port !== current) return;
      port = null;
      // 后台重启等意外断开：还没出结果就提示，已经有字幕的照常显示
      if (state && !state.cues && !state.error && !state.notice) fail(t("视频翻译中断了，请重新右键视频再试"));
    });
    current.postMessage({ type: 'start', jobId });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'video-file-open') return false;
    open(message);
    sendResponse({ ok: true });
    return false;
  });
})();
