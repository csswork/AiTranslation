/**
 * 整份视频翻译的右下角提示（由 service worker 的 lib/video-notice.js 注入到用户正在看的网页顶层框架）。
 * 正在翻时显示进度，翻好、失败或要选语言时显示卡片；点一条打开「视频翻译」页，× 收起。
 * 只显示后台传来的文字（closed shadow root，textContent 写入），不读网页内容，也不向后台提交任何网址。
 * 长连接断了（扩展更新、后台重启）就整个收起。重复注入时只在断开后重新连回去。
 */
(() => {
  const PORT_NAME = 'ai-video-notice';
  const existing = globalThis.__aitrVideoNotice;
  if (existing) {
    existing.connect();
    return;
  }

  let port = null;
  let ui = null;

  function build() {
    const host = document.createElement('div');
    host.id = 'aitr-video-notice';
    host.style.cssText = 'all: initial; position: fixed !important; right: 16px !important; bottom: 16px !important;'
      + 'z-index: 2147483647 !important; display: block !important;';
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      .stack { display: grid; gap: 8px; width: 300px; max-width: calc(100vw - 32px); }
      .card { position: relative; box-sizing: border-box; border-radius: 12px; background: #fff; color: #1d1c19;
        box-shadow: 0 8px 30px rgba(20, 16, 8, 0.22), 0 0 0 1px rgba(20, 16, 8, 0.08);
        font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        animation: in 0.22s ease-out; overflow: hidden; }
      @keyframes in { from { transform: translateY(12px); opacity: 0; } }
      .body { all: unset; display: flex; gap: 10px; padding: 12px 34px 12px 14px; cursor: pointer; width: 100%; box-sizing: border-box; }
      .body:hover { background: rgba(74, 79, 192, 0.05); }
      .body:focus-visible { outline: 2px solid #4a4fc0; outline-offset: -2px; }
      .dot { flex: none; width: 8px; height: 8px; margin-top: 6px; border-radius: 50%; background: #22c55e; }
      .work .dot { background: #4a4fc0; animation: pulse 1.4s ease-in-out infinite; }
      .fail .dot { background: #ef4444; }
      .ask .dot { background: #f59e0b; }
      @keyframes pulse { 50% { opacity: 0.35; } }
      @media (prefers-reduced-motion: reduce) { .card, .work .dot { animation: none; } }
      .text { display: grid; gap: 2px; min-width: 0; }
      b { font-weight: 600; font-size: 14px; }
      .title { color: #57544c; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
      .detail { color: #4a4fc0; font-weight: 600; margin-top: 2px; }
      .work .detail { color: #736f65; font-weight: 400; font-size: 12px; }
      .bar { height: 3px; background: rgba(74, 79, 192, 0.12); }
      .fill { height: 100%; width: 0; background: #4a4fc0; transition: width 0.6s linear; }
      .x { all: unset; position: absolute; top: 8px; right: 8px; width: 22px; height: 22px; display: grid; place-items: center;
        border-radius: 50%; color: #736f65; cursor: pointer; font-size: 16px; line-height: 1; }
      .x:hover { background: rgba(0, 0, 0, 0.06); color: #1d1c19; }
      .x:focus-visible { outline: 2px solid #4a4fc0; }
      @media (prefers-color-scheme: dark) {
        .card { background: #26251f; color: #f1efe8; box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.08); }
        .title { color: #c9c5b9; } .detail { color: #a5a9ff; } .work .detail { color: #b3aea2; }
        .x { color: #b3aea2; } .x:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
        .body:hover { background: rgba(165, 169, 255, 0.08); }
        .bar { background: rgba(165, 169, 255, 0.16); } .fill, .work .dot { background: #a5a9ff; }
      }`;
    const stack = document.createElement('div');
    stack.className = 'stack';
    stack.setAttribute('role', 'status');
    root.append(style, stack);
    (document.body || document.documentElement).appendChild(host);
    return { host, stack, cards: new Map() };
  }

  function post(message) {
    try { port?.postMessage(message); } catch { /* 已断开 */ }
  }

  function line(tag, cls) {
    const el = document.createElement(tag);
    el.className = cls;
    el.dir = 'auto';
    return el;
  }

  /** 一条提示：同一个任务复用同一张卡片，只改文字和进度，免得每秒重画闪烁。 */
  function card(item, labels) {
    let entry = ui.cards.get(item.id);
    if (!entry) {
      const box = document.createElement('div');
      const body = document.createElement('button');
      body.type = 'button';
      body.className = 'body';
      body.title = labels.open;
      const dot = document.createElement('span');
      dot.className = 'dot';
      const text = document.createElement('span');
      text.className = 'text';
      const heading = line('b', '');
      const title = line('span', 'title');
      const detail = line('span', 'detail');
      text.append(heading, title, detail);
      body.append(dot, text);
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'x';
      close.textContent = '×';
      const bar = document.createElement('div');
      bar.className = 'bar';
      const fill = document.createElement('div');
      fill.className = 'fill';
      bar.append(fill);
      box.append(body, close, bar);
      body.addEventListener('click', () => post({ type: 'open', id: item.id }));
      close.addEventListener('click', () => post({ type: 'dismiss', id: item.id }));
      entry = { box, heading, title, detail, close, bar, fill };
      ui.cards.set(item.id, entry);
    }
    entry.box.className = `card ${item.tone}`;
    entry.heading.textContent = item.heading || '';
    entry.title.textContent = item.title || '';
    entry.title.hidden = !item.title;
    entry.detail.textContent = item.detail || '';
    entry.detail.hidden = !item.detail;
    entry.close.title = labels.close;
    entry.close.setAttribute('aria-label', labels.close);
    entry.bar.hidden = item.progress == null;
    if (item.progress != null) entry.fill.style.width = `${Math.round(Math.min(1, Math.max(0, item.progress)) * 100)}%`;
    return entry.box;
  }

  function render({ items = [], labels = {} }) {
    if (!items.length) {
      ui?.host.remove();
      ui = null;
      return;
    }
    if (!ui || !ui.host.isConnected) ui = build();
    const keep = new Set(items.map((item) => item.id));
    for (const id of [...ui.cards.keys()]) if (!keep.has(id)) ui.cards.delete(id);
    const boxes = items.map((item) => card(item, labels));
    if (boxes.length !== ui.stack.children.length || boxes.some((box, i) => ui.stack.children[i] !== box)) ui.stack.replaceChildren(...boxes);
  }

  function connect() {
    if (port) return;
    try {
      port = chrome.runtime.connect({ name: PORT_NAME });
    } catch {
      return; // 扩展已更新或停用
    }
    port.onMessage.addListener((message) => {
      if (message?.type === 'state') render(message);
    });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      port = null;
      render({});
    });
  }

  globalThis.__aitrVideoNotice = { connect };
  connect();
})();
