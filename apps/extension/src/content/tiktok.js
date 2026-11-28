/**
 * TikTok 页面上的「翻译视频」浮动按钮（manifest 只在 https://www.tiktok.com/* 的顶层框架加载）。
 * TikTok 拦掉了视频上的右键，所以在页面上放一个入口：点了请后台翻译这一页正在播放的视频（详情页按地址里的视频），
 * 之后和右键菜单一样，进度与字幕显示在视频上（见 lib/tiktok.js、lib/video-file.js）。
 * 按钮贴在正在播放的视频右上角，跟着视频滚动：TikTok 的播放器铺到窗口右边，页面右下角是它自己的倍速、字幕、
 * 全屏按钮和点赞分享一栏，放那里会挡住（2026-11 在 1200、1440 宽的窗口里实测），视频右上角是空的。
 * 按钮只发「翻译这一页的视频」，不带任何网址；有露出来的视频时才出现；× 收起后这个标签页里不再出现。
 */
(() => {
  if (globalThis.__aitrTikTokButton) return;
  globalThis.__aitrTikTokButton = true;
  const t = (...args) => AITrI18n.t(...args);
  const HIDDEN_KEY = 'aitr-tiktok-button-hidden';
  const life = globalThis.AITrLifecycle;
  let ui = null;
  let timer = 0;

  const hiddenByUser = () => {
    try { return sessionStorage.getItem(HIDDEN_KEY) === '1'; } catch { return false; }
  };

  function send(message) {
    try {
      return chrome.runtime.sendMessage(message).catch(() => null);
    } catch {
      return Promise.resolve(null); // 扩展已更新
    }
  }

  function build() {
    const host = document.createElement('div');
    host.id = 'aitr-tiktok-button';
    host.style.cssText = 'all: initial; position: fixed !important; top: 0; left: 0; z-index: 2147483646 !important; display: block !important;';
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      .wrap { position: relative; display: inline-flex; animation: in 0.2s ease-out; }
      @keyframes in { from { transform: translateY(8px); opacity: 0; } }
      @media (prefers-reduced-motion: reduce) { .wrap { animation: none; } }
      .go { all: unset; display: inline-flex; align-items: center; gap: 6px; padding: 7px 13px 7px 11px; border-radius: 999px; cursor: pointer;
        background: rgba(74, 79, 192, 0.92); color: #fff; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
        font: 600 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
      .go:hover { background: #5a5fd0; }
      .go:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
      .go svg { width: 16px; height: 16px; flex: none; }
      .x { all: unset; position: absolute; top: -7px; right: -7px; width: 18px; height: 18px; display: none; place-items: center;
        border-radius: 50%; background: #26251f; color: #fff; font: 13px/1 sans-serif; cursor: pointer; box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.25); }
      .wrap:hover .x, .x:focus-visible { display: grid; }`;
    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'go';
    go.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 15h4M13 15h4M7 11h10"/></svg>';
    const label = document.createElement('span');
    label.textContent = t("翻译视频");
    go.append(label);
    go.title = t("整份翻译正在播放的视频，字幕显示在视频上");
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'x';
    close.textContent = '×';
    close.title = t("在这个标签页里隐藏");
    close.setAttribute('aria-label', close.title);
    wrap.append(go, close);
    root.append(style, wrap);
    go.addEventListener('click', () => {
      if (life && !life.check()) return;
      send({ type: 'video-file-tiktok-page' });
    });
    close.addEventListener('click', () => {
      try { sessionStorage.setItem(HIDDEN_KEY, '1'); } catch { /* 存不了就只收起这一次 */ }
      remove();
    });
    (document.body || document.documentElement).appendChild(host);
    return { host, wrap };
  }

  function remove() {
    ui?.host.remove();
    ui = null;
  }

  /** 要贴的视频：正在播放、露出最多的那个（与后台取视频的规则一致）；露出太少就不显示。 */
  function target() {
    let best = null;
    let bestScore = 0;
    for (const video of document.querySelectorAll('video')) {
      const r = video.getBoundingClientRect();
      const h = Math.max(0, Math.min(innerHeight, r.bottom) - Math.max(0, r.top));
      const w = Math.max(0, Math.min(innerWidth, r.right) - Math.max(0, r.left));
      if (w < 160 || h < 160) continue;
      const score = w * h + (video.paused ? 0 : 1e9);
      if (score > bestScore) { best = r; bestScore = score; }
    }
    return best;
  }

  /** 贴在视频露出部分的右上角（视频上端滚出窗口时贴窗口上沿），全屏时不挡画面。 */
  function place() {
    if (life && life.signal.aborted) return;
    const rect = !hiddenByUser() && !document.fullscreenElement ? target() : null;
    if (!rect) { if (ui) remove(); return; }
    if (!ui) ui = build();
    const width = ui.wrap.offsetWidth || 110;
    const top = Math.max(8, rect.top + 12);
    const left = Math.max(8, Math.min(innerWidth, rect.right) - width - 12);
    ui.host.style.setProperty('transform', `translate(${Math.round(left)}px, ${Math.round(top)}px)`, 'important');
  }

  async function start() {
    await AITrI18n.ready;
    // Firefox 没有 offscreen 文档，做不了整份视频翻译
    const ready = await send({ type: 'video-file-tiktok-ready' });
    if (!ready?.ok) return;
    place();
    // 推荐流换视频、页面滚动、窗口变化时跟着视频走；另外每秒对一次（TikTok 换视频不一定触发滚动）
    let frame = 0;
    const soon = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; place(); }); };
    const options = { capture: true, passive: true, signal: life?.signal };
    document.addEventListener('scroll', soon, options);
    addEventListener('resize', soon, { passive: true, signal: life?.signal });
    document.addEventListener('fullscreenchange', soon, { signal: life?.signal });
    timer = setInterval(place, 1000);
    life?.onRetire(() => { clearInterval(timer); remove(); });
  }

  start();
})();
