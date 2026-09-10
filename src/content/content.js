/**
 * 页面脚本，两件事：
 *   1. 把当前选中的文字上报给后台，决定右键菜单里要不要出现「翻译成中文」；
 *   2. 在屏幕中央用 Shadow DOM 弹窗，流式显示译文。
 *
 * 上报在所有 iframe 里都跑，弹窗只在顶层框架显示（后台固定 connect frameId: 0）。
 */
(() => {
  if (window.__aiTranslationContentLoaded) return;
  window.__aiTranslationContentLoaded = true;

  const Lang = globalThis.AITrLang;
  const PORT_NAME = 'ai-translate-panel';
  const IS_TOP = (() => {
    try {
      return window.top === window;
    } catch {
      return false;
    }
  })();

  function send(message) {
    try {
      const promise = chrome.runtime.sendMessage(message);
      if (promise && typeof promise.catch === 'function') promise.catch(() => {});
    } catch {
      /* 扩展刚更新时上下文会失效，忽略即可 */
    }
  }

  /* ------------------------------------------------------------ 选区上报 */

  let lastReported = null;
  let reportTimer = 0;

  function currentSelection() {
    let text = '';
    try {
      text = String(window.getSelection() || '');
    } catch {
      /* 忽略：个别页面会禁止读取选区 */
    }
    if (text.trim()) return text;

    // 输入框 / 文本域里的选中内容
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
      try {
        const { selectionStart: start, selectionEnd: end, value } = el;
        if (typeof start === 'number' && typeof end === 'number' && end > start) {
          return value.slice(start, end);
        }
      } catch {
        /* 忽略：type=email 等输入框不支持 selectionStart */
      }
    }
    return '';
  }

  function report() {
    if (panel?.isOpen()) return; // 弹窗自身的选区不参与判断
    const text = currentSelection().trim();
    if (text === lastReported) return;
    lastReported = text;
    send({ type: 'selection', text: text.slice(0, Lang.MAX_TEXT_LENGTH) });
  }

  function scheduleReport() {
    clearTimeout(reportTimer);
    reportTimer = setTimeout(report, 120);
  }

  // 右键前尽早把菜单状态更新好：菜单项是在右键那一刻确定的，
  // 所以主要靠 mouseup / selectionchange 提前上报，contextmenu 只是兜底。
  document.addEventListener('mouseup', scheduleReport, true);
  document.addEventListener('keyup', scheduleReport, true);
  document.addEventListener('selectionchange', scheduleReport, true);
  document.addEventListener(
    'contextmenu',
    () => {
      clearTimeout(reportTimer);
      report();
    },
    true
  );

  /* ---------------------------------------------------------------- 弹窗 */

  const STYLE = `
  /* .skeleton / .error 自带 display，会压过 UA 的 [hidden]{display:none}，必须显式兜住 */
  [hidden] { display: none !important; }
  /* 不加遮罩颜色，只用来接住弹窗外部的点击以关闭 */
  .backdrop {
    position: absolute; inset: 0;
    background: transparent;
    pointer-events: auto;
  }
  .panel {
    position: absolute; left: 50%; top: 50%;
    transform: translate(-50%, -50%);
    box-sizing: border-box;
    width: min(560px, calc(100vw - 40px));
    max-height: min(72vh, 640px);
    display: flex; flex-direction: column;
    pointer-events: auto;
    background: #fff;
    color: #0f172a;
    border-radius: 14px;
    border: 1px solid rgba(15, 23, 42, 0.08);
    box-shadow: 0 24px 64px rgba(15, 23, 42, 0.24), 0 2px 8px rgba(15, 23, 42, 0.12);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
                 "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    font-size: 14px; font-weight: 400; font-style: normal;
    line-height: 1.6; letter-spacing: normal; word-spacing: normal;
    text-align: left; text-indent: 0; text-transform: none;
    animation: pop 0.16s cubic-bezier(0.2, 0.9, 0.3, 1.1);
  }
  .panel.dragging { animation: none; transition: none; }
  @keyframes pop {
    from { opacity: 0; transform: translate(-50%, calc(-50% + 8px)) scale(0.985) }
    to   { opacity: 1 }
  }
  @media (prefers-reduced-motion: reduce) {
    .panel { animation: none }
  }

  .bar {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 10px 10px 14px;
    border-bottom: 1px solid rgba(15, 23, 42, 0.07);
    cursor: grab; user-select: none;
  }
  .bar.dragging { cursor: grabbing; }
  .dot {
    width: 8px; height: 8px; border-radius: 50%; flex: none;
    background: linear-gradient(135deg, #6366f1, #a855f7);
  }
  .dot.busy { animation: pulse 1.1s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }
  .title { font-size: 13px; font-weight: 600; flex: 1 1 auto; }
  select.provider {
    font: inherit; font-size: 12px; color: inherit;
    background: rgba(15, 23, 42, 0.05);
    border: 1px solid rgba(15, 23, 42, 0.08);
    border-radius: 7px; padding: 3px 6px; cursor: pointer; max-width: 130px;
  }
  button.icon {
    flex: none; width: 26px; height: 26px; padding: 0;
    display: grid; place-items: center;
    font: inherit; font-size: 14px; line-height: 1;
    color: rgba(15, 23, 42, 0.55);
    background: transparent; border: 0; border-radius: 7px; cursor: pointer;
  }
  button.icon:hover { background: rgba(15, 23, 42, 0.07); color: inherit; }
  button.icon:disabled { opacity: 0.4; cursor: default; background: transparent; }
  button.icon svg { width: 15px; height: 15px; display: block; }

  .body { padding: 14px; overflow-y: auto; overscroll-behavior: contain; flex: 1 1 auto; }
  .result {
    margin: 0; font-size: 15.5px; line-height: 1.72;
    white-space: pre-wrap; overflow-wrap: break-word; word-break: break-word;
  }
  .result:empty { display: none; }
  .result.streaming::after {
    content: ""; display: inline-block; vertical-align: -2px;
    width: 2px; height: 1.05em; margin-left: 2px;
    background: #6366f1; animation: caret 1s step-end infinite;
  }
  @keyframes caret { 50% { opacity: 0 } }

  .skeleton { display: grid; gap: 9px; }
  .skeleton i {
    display: block; height: 12px; border-radius: 6px;
    background: linear-gradient(90deg, rgba(15,23,42,.07), rgba(15,23,42,.13), rgba(15,23,42,.07));
    background-size: 220% 100%; animation: shimmer 1.2s linear infinite;
  }
  .skeleton i:nth-child(2) { width: 88% }
  .skeleton i:nth-child(3) { width: 62% }
  @keyframes shimmer { from { background-position: 120% 0 } to { background-position: -120% 0 } }

  .note {
    margin-top: 10px; font-size: 12px; color: rgba(15, 23, 42, 0.5);
  }
  .error {
    display: flex; flex-direction: column; align-items: flex-start; gap: 10px;
    padding: 12px; border-radius: 10px;
    background: rgba(220, 38, 38, 0.07);
    border: 1px solid rgba(220, 38, 38, 0.18);
    color: #b42318; font-size: 13.5px; line-height: 1.6;
  }
  .error p { margin: 0; overflow-wrap: break-word; }

  details.original {
    margin-top: 14px; padding-top: 12px;
    border-top: 1px dashed rgba(15, 23, 42, 0.12);
  }
  details.original summary {
    cursor: pointer; font-size: 12px; color: rgba(15, 23, 42, 0.5);
    list-style: none; outline: none; width: fit-content;
  }
  details.original summary::-webkit-details-marker { display: none }
  details.original summary::before { content: "▸ "; }
  details.original[open] summary::before { content: "▾ "; }
  .original-text {
    margin-top: 8px; font-size: 13px; line-height: 1.65;
    color: rgba(15, 23, 42, 0.62);
    white-space: pre-wrap; overflow-wrap: break-word; word-break: break-word;
  }

  footer {
    display: flex; align-items: center; gap: 10px;
    padding: 9px 12px 9px 14px;
    border-top: 1px solid rgba(15, 23, 42, 0.07);
  }
  .meta {
    flex: 1 1 auto; font-size: 11.5px; color: rgba(15, 23, 42, 0.42);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  button.btn {
    flex: none; font: inherit; font-size: 12.5px; font-weight: 500;
    padding: 5px 12px; border-radius: 8px; cursor: pointer;
    color: #fff; background: #4f46e5; border: 1px solid transparent;
  }
  button.btn:hover { background: #4338ca }
  button.btn.ghost {
    color: #4f46e5; background: transparent; border-color: rgba(79, 70, 229, 0.35);
  }
  button.btn.ghost:hover { background: rgba(79, 70, 229, 0.08) }
  button.btn:disabled { opacity: 0.45; cursor: default }
  button:focus-visible, select:focus-visible, summary:focus-visible {
    outline: 2px solid #6366f1; outline-offset: 2px;
  }

  @media (prefers-color-scheme: dark) {
    .panel {
      background: #191b21; color: #e9eaee;
      border-color: rgba(255, 255, 255, 0.09);
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
    }
    .bar, footer { border-color: rgba(255, 255, 255, 0.08) }
    select.provider {
      background: rgba(255, 255, 255, 0.07); border-color: rgba(255, 255, 255, 0.1);
    }
    button.icon { color: rgba(233, 234, 238, 0.6) }
    button.icon:hover { background: rgba(255, 255, 255, 0.09) }
    .skeleton i {
      background: linear-gradient(90deg, rgba(255,255,255,.06), rgba(255,255,255,.13), rgba(255,255,255,.06));
      background-size: 220% 100%;
    }
    .note, .meta, details.original summary { color: rgba(233, 234, 238, 0.45) }
    .original-text { color: rgba(233, 234, 238, 0.6) }
    details.original { border-color: rgba(255, 255, 255, 0.12) }
    .error {
      background: rgba(248, 113, 113, 0.11); border-color: rgba(248, 113, 113, 0.28);
      color: #fca5a5;
    }
    button.btn { background: #6366f1 }
    button.btn:hover { background: #7376f4 }
    button.btn.ghost { color: #a5b4fc; border-color: rgba(165, 180, 252, 0.35) }
    button.btn.ghost:hover { background: rgba(165, 180, 252, 0.12) }
  }`;

  const ICON = {
    retry:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3.2-6.9"/><path d="M21 3v6h-6"/></svg>',
    close:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  };

  /** 弹窗实例，懒创建后复用。 */
  const panel = (() => {
    let dom = null;
    let open = false;
    let port = null;
    let sourceText = '';
    let translation = '';
    let providerLabel = '';
    let providerModel = '';

    function build() {
      const host = document.createElement('div');
      host.style.cssText =
        'all: initial; position: fixed !important; inset: 0 !important;' +
        'z-index: 2147483647 !important; display: block !important;' +
        'pointer-events: none !important; color-scheme: light dark;';

      const root = host.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = STYLE;
      root.appendChild(style);

      const wrap = document.createElement('div');
      wrap.innerHTML = `
        <div class="backdrop" part="backdrop"></div>
        <div class="panel" role="dialog" aria-modal="true" aria-label="AI 翻译结果" tabindex="-1">
          <div class="bar">
            <span class="dot"></span>
            <span class="title">翻译成中文</span>
            <select class="provider" title="切换翻译平台"></select>
            <button class="icon retry" type="button" title="重新翻译" aria-label="重新翻译">${ICON.retry}</button>
            <button class="icon close" type="button" title="关闭（Esc）" aria-label="关闭">${ICON.close}</button>
          </div>
          <div class="body">
            <div class="skeleton" hidden><i></i><i></i><i></i></div>
            <div class="error" hidden><p></p></div>
            <div class="result"></div>
            <div class="note" hidden></div>
            <details class="original" hidden>
              <summary>原文</summary>
              <div class="original-text"></div>
            </details>
          </div>
          <footer>
            <span class="meta"></span>
            <button class="btn copy" type="button">复制译文</button>
          </footer>
        </div>`;
      while (wrap.firstChild) root.appendChild(wrap.firstChild);

      const q = (sel) => root.querySelector(sel);
      dom = {
        host,
        root,
        backdrop: q('.backdrop'),
        panel: q('.panel'),
        bar: q('.bar'),
        dot: q('.dot'),
        title: q('.title'),
        provider: q('.provider'),
        retry: q('.retry'),
        close: q('.close'),
        body: q('.body'),
        skeleton: q('.skeleton'),
        error: q('.error'),
        errorText: q('.error p'),
        result: q('.result'),
        note: q('.note'),
        original: q('.original'),
        originalText: q('.original-text'),
        meta: q('.meta'),
        copy: q('.copy'),
      };

      dom.close.addEventListener('click', () => hide());
      dom.backdrop.addEventListener('mousedown', () => hide());
      dom.retry.addEventListener('click', () => retranslate());
      dom.provider.addEventListener('change', () => retranslate(dom.provider.value));
      dom.copy.addEventListener('click', copyResult);
      enableDrag();

      (document.body || document.documentElement).appendChild(host);
      return dom;
    }

    /** 标题栏拖动；一旦拖过就改用绝对定位，不再居中。 */
    function enableDrag() {
      let origin = null;
      dom.bar.addEventListener('mousedown', (event) => {
        if (event.button !== 0 || event.target.closest('button, select')) return;
        const rect = dom.panel.getBoundingClientRect();
        origin = { x: event.clientX - rect.left, y: event.clientY - rect.top, w: rect.width, h: rect.height };
        dom.panel.classList.add('dragging');
        dom.bar.classList.add('dragging');
        event.preventDefault();
      });
      window.addEventListener('mousemove', (event) => {
        if (!origin) return;
        const maxX = window.innerWidth - origin.w;
        const maxY = window.innerHeight - origin.h;
        const x = Math.min(Math.max(0, event.clientX - origin.x), Math.max(0, maxX));
        const y = Math.min(Math.max(0, event.clientY - origin.y), Math.max(0, maxY));
        dom.panel.style.transform = 'none';
        dom.panel.style.left = `${x}px`;
        dom.panel.style.top = `${y}px`;
      });
      window.addEventListener('mouseup', () => {
        if (!origin) return;
        origin = null;
        dom.bar.classList.remove('dragging');
      });
    }

    function onKeydown(event) {
      if (event.key === 'Escape' && open) {
        event.stopPropagation();
        hide();
      }
    }

    function show() {
      if (!dom) build();
      // 页面可能替换过 body，确保节点还在文档里
      if (!dom.host.isConnected) (document.body || document.documentElement).appendChild(dom.host);
      dom.host.style.setProperty('display', 'block', 'important');
      if (!open) {
        open = true;
        window.addEventListener('keydown', onKeydown, true);
      }
      dom.panel.focus({ preventScroll: true });
    }

    function hide() {
      if (!dom) return;
      open = false;
      window.removeEventListener('keydown', onKeydown, true);
      dom.host.style.setProperty('display', 'none', 'important');
      closePort();
      lastReported = null; // 关闭后重新上报一次选区
      scheduleReport();
    }

    /** 一轮结束（成功或失败）后放掉端口，避免每次翻译都留一个。 */
    function releasePort() {
      if (!port) return;
      try {
        port.disconnect();
      } catch {
        /* 忽略：后台可能已经断开 */
      }
      port = null;
    }

    /** 中途放弃：先告诉后台取消，再断开。 */
    function closePort() {
      if (!port) return;
      try {
        port.postMessage({ type: 'cancel' });
      } catch {
        /* 忽略：后台可能已经断开 */
      }
      releasePort();
    }

    function retranslate(providerId) {
      if (!sourceText) return;
      closePort();
      send({ type: 'retranslate', text: sourceText, providerId: providerId || undefined });
    }

    async function copyResult() {
      const text = translation.trim();
      if (!text) return;
      let ok = false;
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch {
        // 有些页面禁用了异步剪贴板，退回老接口
        try {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
          document.body.appendChild(ta);
          ta.select();
          ok = document.execCommand('copy');
          ta.remove();
        } catch {
          ok = false;
        }
      }
      dom.copy.textContent = ok ? '已复制' : '复制失败';
      setTimeout(() => {
        if (dom) dom.copy.textContent = '复制译文';
      }, 1400);
    }

    function setBusy(busy) {
      dom.dot.classList.toggle('busy', busy);
      dom.result.classList.toggle('streaming', busy);
      dom.retry.disabled = busy;
      dom.copy.disabled = busy || !translation.trim();
    }

    /* ---- 供 port 调用的状态迁移 ---- */

    function begin(message, activePort) {
      if (port && port !== activePort) closePort(); // 掐掉上一轮还在流的请求
      port = activePort;
      sourceText = message.text || '';
      translation = '';
      providerLabel = message.provider?.label || '';
      providerModel = message.provider?.model || '';

      if (!dom) build();
      dom.title.textContent = `翻译成${message.target || '中文'}`;
      dom.result.textContent = '';
      dom.error.hidden = true;
      dom.skeleton.hidden = false;
      dom.meta.textContent = `${providerLabel} · ${providerModel}`;
      dom.copy.textContent = '复制译文';

      dom.note.hidden = !message.truncated;
      if (message.truncated) {
        dom.note.textContent = `选中内容较长，只翻译了前 ${Lang.MAX_TEXT_LENGTH} 个字符。`;
      }

      dom.original.hidden = !message.showOriginal;
      dom.original.open = false;
      dom.originalText.textContent = sourceText;

      const providers = message.providers || [];
      dom.provider.hidden = providers.length < 2;
      dom.provider.replaceChildren(
        ...providers.map((item) => {
          const option = document.createElement('option');
          option.value = item.id;
          option.textContent = item.label;
          option.selected = item.id === message.provider?.id;
          return option;
        })
      );

      dom.body.scrollTop = 0;
      setBusy(true);
      show();
    }

    function append(chunk) {
      if (!dom) return;
      dom.skeleton.hidden = true;
      const atBottom =
        dom.body.scrollHeight - dom.body.scrollTop - dom.body.clientHeight < 24;
      translation += chunk;
      dom.result.textContent = translation;
      if (atBottom) dom.body.scrollTop = dom.body.scrollHeight;
    }

    function finish(elapsed) {
      if (!dom) return;
      dom.skeleton.hidden = true;
      setBusy(false);
      const seconds = elapsed ? ` · ${(elapsed / 1000).toFixed(1)}s` : '';
      dom.meta.textContent = `${providerLabel} · ${providerModel}${seconds}`;
      releasePort();
    }

    function fail(message, action) {
      if (!dom) build();
      dom.skeleton.hidden = true;
      setBusy(false);
      releasePort();
      dom.error.hidden = false;
      dom.errorText.textContent = message || '翻译失败';

      dom.error.querySelectorAll('button').forEach((el) => el.remove());
      if (action === 'open-options') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn ghost';
        button.textContent = '打开设置';
        button.addEventListener('click', () => send({ type: 'open-options' }));
        dom.error.appendChild(button);
      }
      show();
    }

    return { begin, append, finish, fail, hide, isOpen: () => open };
  })();

  /* ------------------------------------------------------------ 结果通道 */

  chrome.runtime.onConnect.addListener((incoming) => {
    if (incoming.name !== PORT_NAME) return;
    if (!IS_TOP) {
      incoming.disconnect(); // 弹窗只在顶层框架显示
      return;
    }
    incoming.onMessage.addListener((message) => {
      switch (message?.type) {
        case 'start':
          panel.begin(message, incoming);
          break;
        case 'delta':
          panel.append(message.chunk || '');
          break;
        case 'done':
          panel.finish(message.elapsed);
          break;
        case 'error':
          panel.fail(message.message, message.action);
          break;
      }
    });
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'ping') {
      sendResponse({ ok: true, top: IS_TOP });
      return false;
    }
    // 快捷键触发时，后台缓存可能已随 service worker 重启清空，就来问页面
    if (message?.type === 'get-selection') {
      sendResponse({ text: currentSelection().trim() });
      return false;
    }
    return false;
  });

  /* --------------------------------------------- 划词浮动按钮（可在设置里关闭） */

  /**
   * 完全独立的一块：自己的 shadow 宿主、自己的事件监听、自己读设置。
   * 刻意不复用上面弹窗的任何代码，也不改动选区上报，
   * 这样即使这里出问题，右键菜单那条链路也不受影响。
   * DOM 全部用 createElement 构建，不走 innerHTML。
   */
  (() => {
    const CHIP_STYLE = `
      .chip {
        all: unset;
        box-sizing: border-box;
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border-radius: 8px;
        cursor: pointer;
        font-family: -apple-system, BlinkMacSystemFont, "PingFang SC",
                     "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
        font-size: 14px;
        font-weight: 600;
        line-height: 1;
        color: #fff;
        background: linear-gradient(135deg, #6366f1, #a855f7);
        box-shadow: 0 4px 14px rgba(15, 23, 42, 0.3);
        transition: transform 0.12s ease;
      }
      .chip:hover { transform: scale(1.08); }
      @media (prefers-reduced-motion: reduce) {
        .chip { transition: none; }
      }`;

    let host = null;
    let chip = null;
    let pending = '';
    let enabled = true;

    function readSetting() {
      try {
        const promise = chrome.storage.local.get('settings');
        if (!promise || typeof promise.then !== 'function') return;
        promise
          .then((stored) => {
            enabled = stored?.settings?.floating !== false;
            if (!enabled) hide();
          })
          .catch(() => {});
      } catch {
        /* 扩展上下文失效，忽略 */
      }
    }

    function build() {
      host = document.createElement('div');
      host.style.cssText =
        'all: initial; position: fixed !important; z-index: 2147483646 !important;' +
        'display: none !important; pointer-events: auto !important;';

      const root = host.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = CHIP_STYLE;

      chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.title = '翻译成中文';
      chip.textContent = '译';

      root.appendChild(style);
      root.appendChild(chip);

      // 按下时别让浏览器清掉选区
      chip.addEventListener('mousedown', (event) => event.preventDefault());
      chip.addEventListener('click', () => {
        const text = pending;
        hide();
        if (text) send({ type: 'retranslate', text });
      });

      (document.body || document.documentElement).appendChild(host);
    }

    function hide() {
      pending = '';
      if (host) host.style.setProperty('display', 'none', 'important');
    }

    function show(text, rect) {
      if (!host) build();
      if (!host.isConnected) (document.body || document.documentElement).appendChild(host);
      pending = text;
      const size = 28;
      const gap = 6;
      // 视口尺寸偶尔取不到（尺寸为 0 的 iframe、布局未就绪等），
      // 这时不要夹取，否则按钮会被甩到左上角而不是贴着选区。
      const vw = window.innerWidth || document.documentElement?.clientWidth || 0;
      const vh = window.innerHeight || document.documentElement?.clientHeight || 0;
      let x = rect.right + gap;
      let y = rect.bottom + gap;
      if (vw > size + gap * 2) x = Math.min(x, vw - size - gap);
      if (vh > size + gap * 2) y = Math.min(y, vh - size - gap);
      host.style.left = `${Math.round(Math.max(gap, x))}px`;
      host.style.top = `${Math.round(Math.max(gap, y))}px`;
      host.style.setProperty('display', 'block', 'important');
    }

    function selectionRect() {
      try {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        if (!rect || (!rect.width && !rect.height)) return null;
        return rect;
      } catch {
        return null;
      }
    }

    function maybeShow() {
      if (!enabled) return;
      // 弹窗开着时收起按钮，别叠在弹窗上
      try {
        if (panel && panel.isOpen()) {
          hide();
          return;
        }
      } catch {
        /* 忽略 */
      }
      const rect = selectionRect();
      if (!rect) {
        hide();
        return;
      }
      const text = currentSelection().trim();
      if (!text || !Lang.shouldOffer(text)) {
        hide();
        return;
      }
      show(text, rect);
    }

    const fromChip = (event) => Boolean(host) && event.target === host;

    document.addEventListener(
      'mouseup',
      (event) => {
        if (fromChip(event)) return;
        setTimeout(maybeShow, 10); // 等选区稳定下来
      },
      true
    );
    document.addEventListener(
      'mousedown',
      (event) => {
        if (fromChip(event)) return;
        hide();
      },
      true
    );
    document.addEventListener('keydown', hide, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);

    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.settings) readSetting();
      });
    } catch {
      /* 忽略 */
    }
    readSetting();
  })();
})();
