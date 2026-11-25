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
  const NOTICE_MS = 6000;

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
  .act:focus-visible, .close:focus-visible { outline: 2px solid #a5b4fc; outline-offset: 1px; }
  /* 字幕准备好以后常驻在视频左上角：说明字幕开着，可以看全部、播放或关掉 */
  .chip, .list {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
                 "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    color: #fff; pointer-events: auto; text-align: left; letter-spacing: normal; text-transform: none;
  }
  .chip {
    position: absolute; top: 8px; left: 8px; max-width: calc(100% - 16px); box-sizing: border-box;
    display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
    padding: 4px 5px 4px 10px; border-radius: 999px;
    background: rgba(10, 10, 12, 0.8);
    font-size: 12px; font-weight: 500; line-height: 1.3;
  }
  .chip .dot { background: #4ade80; }
  .pill {
    font: inherit; color: #fff; cursor: pointer; white-space: nowrap;
    background: rgba(255, 255, 255, 0.16); border: 0; border-radius: 999px; padding: 3px 10px;
  }
  .pill:hover { background: rgba(255, 255, 255, 0.28); }
  .pill.primary { background: #6d4aff; }
  .pill.primary:hover { background: #7d5dff; }
  .x {
    width: 20px; height: 20px; padding: 0; display: grid; place-items: center; flex: none;
    border: 0; border-radius: 50%; background: none; color: #fff; cursor: pointer; opacity: 0.8;
  }
  .x:hover { opacity: 1; background: rgba(255, 255, 255, 0.16); }
  .x svg { width: 10px; height: 10px; }
  .list {
    position: absolute; inset: 8px; box-sizing: border-box;
    display: flex; flex-direction: column; overflow: hidden;
    border-radius: 10px; background: rgba(10, 10, 12, 0.9);
  }
  .list header {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 9px 10px 9px 14px; font-size: 13px; font-weight: 600;
    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  }
  .list ol { margin: 0; padding: 6px; list-style: none; overflow: auto; flex: 1; }
  .list li button {
    display: block; width: 100%; box-sizing: border-box; padding: 7px 9px; border: 0; border-radius: 6px;
    background: none; color: inherit; font: inherit; text-align: left; cursor: pointer;
  }
  .list li button:hover, .list li.on button { background: rgba(255, 255, 255, 0.1); }
  .list .time { font-size: 11px; opacity: 0.55; }
  .list .ltr { font-size: 15px; font-weight: 500; line-height: 1.45; }
  .list .lorig { font-size: 12px; opacity: 0.72; line-height: 1.4; }
  .pill:focus-visible, .x:focus-visible, .list li button:focus-visible { outline: 2px solid #a5b4fc; outline-offset: 1px; }`;

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
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.hidden = true;
    chip.innerHTML = `
      <span class="dot"></span><span>双语字幕</span>
      <button class="pill primary play" type="button" hidden>播放</button>
      <button class="pill all" type="button">全部字幕</button>
      <button class="x" type="button" title="关闭字幕" aria-label="关闭字幕">${CLOSE_ICON}</button>`;
    const list = document.createElement('div');
    list.className = 'list';
    list.hidden = true;
    list.innerHTML = `
      <header><span class="list-title"></span><button class="pill fold" type="button">收起</button></header>
      <ol></ol>`;
    root.append(style, box, chip, list);
    AITrI18n.localize(root);
    (document.body || document.documentElement).appendChild(host);

    ui = {
      host,
      box,
      chip,
      list,
      tr: box.querySelector('.tr'),
      orig: box.querySelector('.orig'),
      status: box.querySelector('.status'),
      label: box.querySelector('.label'),
      act: box.querySelector('.act'),
      bar: box.querySelector('.bar'),
      fill: box.querySelector('.bar i'),
      play: chip.querySelector('.play'),
      listTitle: list.querySelector('.list-title'),
      items: list.querySelector('ol'),
      key: '',
      sig: '',
    };
    box.querySelector('.close').addEventListener('click', close);
    chip.querySelector('.x').addEventListener('click', close);
    ui.act.addEventListener('click', () => send({ type: 'open-options', section: 'video' }));
    ui.play.addEventListener('click', () => play(video?.ended ? 0 : null));
    chip.querySelector('.all').addEventListener('click', () => toggleList(true));
    list.querySelector('.fold').addEventListener('click', () => toggleList(false));
    raf = requestAnimationFrame(follow);
  }

  /** 播放视频；from 给了就先跳到那里（秒）。站点不让播（比如要先点一下页面）时停在原处，「播放」按钮还在。 */
  function play(from = null) {
    if (!video) return;
    try {
      if (from != null) video.currentTime = from;
      const task = video.play();
      if (task && typeof task.catch === 'function') task.catch(() => render());
    } catch {
      /* 播放器不让操作：留给用户自己点 */
    }
    render();
  }

  const clock = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  /** 「全部字幕」：整篇双语对照，点一句就跳到那里播放。 */
  function toggleList(open) {
    if (!state?.cues) return;
    state.listOpen = open;
    if (open) {
      ui.listTitle.textContent = t("全部字幕（$1 句）", [state.cues.length]);
      ui.items.replaceChildren(...state.cues.map((cue) => {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        const time = document.createElement('div');
        time.className = 'time';
        time.textContent = clock(cue.start);
        const tr = document.createElement('div');
        tr.className = 'ltr';
        tr.dir = 'auto';
        tr.textContent = cue.tr;
        button.append(time, tr);
        if (cue.text && cue.text !== cue.tr) {
          const orig = document.createElement('div');
          orig.className = 'lorig';
          orig.dir = 'auto';
          orig.textContent = cue.text;
          button.append(orig);
        }
        button.addEventListener('click', () => {
          state.listOpen = false;
          play(cue.start / 1000);
        });
        li.append(button);
        return li;
      }));
    }
    render();
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
  const signature = () => `${state.cues ? state.cues.indexOf(currentCue()) : -2}|${noticeOn()}|${state.status}|${state.error}|${state.listOpen}|${Boolean(video?.paused || video?.ended)}`;

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
    ui.box.hidden = state.listOpen || (!cue && !label);

    // 字幕准备好以后：左上角常驻一条，说明字幕开着；停着时给「播放」，随时能看全部或关掉
    const ready = Boolean(state.cues?.length);
    ui.chip.hidden = !ready || state.listOpen;
    ui.play.hidden = !(video && (video.paused || video.ended));
    ui.list.hidden = !(ready && state.listOpen);
    if (state.listOpen) {
      const index = state.cues.indexOf(cue);
      [...ui.items.children].forEach((li, i) => li.classList.toggle('on', i === index));
    }
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
    notice(t("字幕已准备好：边播边显示，也可以点「全部字幕」直接看"));
    // 视频停着（帖子页常见）或已经播完：从头播放，马上就能看到字幕；正在播的不打断
    if (video && (video.paused || video.ended)) play(0);
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
      listOpen: false,
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
