/**
 * 双语阅读：页面上的「扫描」动画与正文识别。不常驻：右键「双语阅读这篇文章」时由后台注入
 * （连同 src/vendor/readability/ 与 src/lib/article.js），只在顶层框架运行。
 *
 *   1. 盖一层扫描动画：一道光带自上而下扫过页面，识别出的标题、段落随光带经过逐个点亮；
 *   2. Readability 在页面副本上识别正文（不改动原页面），article.js 整理成结构化段落；
 *   3. 像一篇完整的文章就直接交给后台，在右侧新标签页打开阅读页；
 *      不太像（首页、列表页、短帖）时让用户决定是否仍然打开。
 *
 * 只把整理后的纯文字与 http(s) 图片地址交给后台，不传网页 HTML。
 */
(() => {
  if (globalThis.AITrReaderScan) return;
  const t = (...args) => AITrI18n.t(...args);
  const A = globalThis.AITrArticle;
  const { onRetire } = globalThis.AITrLifecycle || { onRetire: () => {} };

  /** 动画至少播这么久：识别通常几十毫秒就完成，太快一闪而过反而像出错。 */
  const MIN_SCAN_MS = 1500;
  const MAX_MARKS = 80;

  let session = null;

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

  const CSS = `
    :host { all: initial; }
    .layer {
      position: fixed; inset: 0; z-index: 2147483646; pointer-events: none;
      font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      --accent: #4a4fc0; --ink: #1d1c19; --paper: #fdfcf9; --muted: #57544c; --line: #e4e1d8;
      opacity: 0; transition: opacity .28s ease;
    }
    @media (prefers-color-scheme: dark) {
      .layer { --accent: #8b8ef0; --ink: #ecebe6; --paper: #191917; --muted: #a8a59c; --line: #2b2a27; }
    }
    .layer.on { opacity: 1; }
    .veil {
      position: absolute; inset: 0;
      background: color-mix(in srgb, var(--paper) 22%, transparent);
      backdrop-filter: saturate(.6);
    }
    .beam {
      position: absolute; left: 0; right: 0; top: 0; height: 38vh;
      transform: translateY(-40vh);
      background:
        repeating-linear-gradient(0deg, color-mix(in srgb, var(--accent) 9%, transparent) 0 1px, transparent 1px 5px),
        linear-gradient(180deg, transparent, color-mix(in srgb, var(--accent) 16%, transparent) 75%, color-mix(in srgb, var(--accent) 38%, transparent));
      -webkit-mask-image: linear-gradient(180deg, transparent, #000 65%);
      mask-image: linear-gradient(180deg, transparent, #000 65%);
      animation: sweep 1.5s cubic-bezier(.45, .05, .35, 1) infinite;
    }
    .beam::after {
      content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 2px;
      background: linear-gradient(90deg, transparent, var(--accent) 18%, #fff 50%, var(--accent) 82%, transparent);
      box-shadow: 0 0 14px 2px color-mix(in srgb, var(--accent) 65%, transparent);
    }
    .layer.done .beam { animation-iteration-count: 1; animation-duration: .9s; }
    @keyframes sweep { to { transform: translateY(102vh); } }
    .mark {
      position: absolute; border-radius: 6px;
      border: 1.5px solid color-mix(in srgb, var(--accent) 70%, transparent);
      background: color-mix(in srgb, var(--accent) 7%, transparent);
      opacity: 0; transform: scale(.985);
      animation: light .45s ease forwards;
    }
    .mark.title { border-width: 2px; background: color-mix(in srgb, var(--accent) 11%, transparent); }
    .mark .tag {
      position: absolute; left: -2px; top: -22px; padding: 1px 8px; border-radius: 5px;
      font-size: 11px; font-weight: 600; letter-spacing: .02em; color: #fff; background: var(--accent);
      white-space: nowrap;
    }
    @keyframes light { to { opacity: 1; transform: none; } }
    .pill {
      position: absolute; left: 50%; bottom: 28px; transform: translate(-50%, 12px);
      display: flex; align-items: center; gap: 10px; max-width: min(560px, calc(100vw - 32px));
      padding: 10px 16px; border-radius: 999px;
      color: var(--ink); background: var(--paper); border: 1px solid var(--line);
      box-shadow: 0 10px 30px rgba(30, 24, 12, .18), 0 1px 3px rgba(30, 24, 12, .12);
      pointer-events: auto; opacity: 0; transition: opacity .25s ease, transform .25s ease;
    }
    .layer.on .pill { opacity: 1; transform: translate(-50%, 0); }
    .pill.card { border-radius: 14px; flex-wrap: wrap; }
    .dot { width: 9px; height: 9px; flex: none; border-radius: 50%; background: var(--accent); animation: pulse 1s ease-in-out infinite; }
    .pill.ok .dot { animation: none; }
    .pill.warn .dot { animation: none; background: #c27c1a; }
    @keyframes pulse { 50% { transform: scale(.55); opacity: .5; } }
    .text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pill.card .text { white-space: normal; flex: 1 1 260px; }
    .text b { font-weight: 600; }
    .actions { display: flex; gap: 8px; margin-left: auto; }
    button {
      font: inherit; font-size: 12.5px; font-weight: 550; cursor: pointer;
      padding: 5px 13px; border-radius: 8px; border: 1px solid var(--line);
      color: var(--ink); background: transparent;
    }
    button.primary { color: #fff; background: var(--accent); border-color: transparent; }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    @media (prefers-reduced-motion: reduce) {
      .beam { animation: none; transform: none; opacity: .5; }
      .mark { animation: none; opacity: 1; transform: none; }
      .dot { animation: none; }
    }
  `;

  function createOverlay() {
    const host = document.createElement('div');
    host.setAttribute('data-aitr-reader', '');
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = CSS;
    const layer = document.createElement('div');
    layer.className = 'layer';
    const veil = document.createElement('div');
    veil.className = 'veil';
    const marks = document.createElement('div');
    const beam = document.createElement('div');
    beam.className = 'beam';
    const pill = document.createElement('div');
    pill.className = 'pill';
    pill.setAttribute('role', 'status');
    pill.setAttribute('aria-live', 'polite');
    const dot = document.createElement('span');
    dot.className = 'dot';
    const text = document.createElement('span');
    text.className = 'text';
    pill.append(dot, text);
    layer.append(veil, marks, beam, pill);
    root.append(style, layer);
    (document.body || document.documentElement).appendChild(host);
    AITrI18n.localize?.(root);
    return { host, layer, marks, pill, text };
  }

  function close(current, { fast = false } = {}) {
    if (!current || current.closed) return;
    current.closed = true;
    document.removeEventListener('keydown', current.onKey, true);
    current.overlay.layer.classList.remove('on');
    setTimeout(() => current.overlay.host.remove(), fast ? 0 : 320);
    if (session === current) session = null;
  }

  /* ---------------------------------------------------------------- 识别 */

  function parse() {
    let readerable = true;
    try {
      readerable = typeof isProbablyReaderable !== 'function' || isProbablyReaderable(document, { minContentLength: 120, minScore: 20 });
    } catch {
      /* 判断失败不影响识别 */
    }
    // Readability 会改动传入的文档，只在副本上跑
    const copy = document.cloneNode(true);
    // 先去掉广告容器、广告标签和推荐联盟模块，免得混进正文
    A.stripAds(copy.body || copy);
    const result = new Readability(copy, { charThreshold: 300, serializer: (node) => node }).parse();
    if (!result?.content) return { readerable, article: null };
    const siteName = A.clean(result.siteName || '');
    const title = pickTitle(A.clean(result.title || document.title || ''), siteName);
    const byline = A.clean(result.byline || '');
    const { blocks, truncated } = A.toBlocks(result.content, { base: document.baseURI, title, byline });
    const article = {
      url: location.href,
      title,
      byline: byline.slice(0, 200),
      siteName: (siteName || location.hostname).slice(0, 120),
      publishedTime: String(result.publishedTime || '').slice(0, 40),
      lang: String(result.lang || document.documentElement.lang || '').slice(0, 20),
      dir: result.dir === 'rtl' ? 'rtl' : 'ltr',
      excerpt: A.clean(result.excerpt || '').slice(0, 400),
      blocks,
      truncated,
    };
    return { readerable, article };
  }

  /**
   * 标题去掉站点名后缀（「标题 — 站点」「标题 | 站点」）。Readability 不认「—」等分隔符，
   * 页面上的 h1 与它相符时直接用 h1。
   */
  function pickTitle(title, siteName) {
    for (const h1 of document.querySelectorAll('h1')) {
      const text = A.clean(h1.textContent || '');
      if (text.length >= 4 && text.length < title.length && title.toLowerCase().includes(text.toLowerCase())) return text;
    }
    if (siteName) {
      const parts = title.split(/\s+[|\-–—»·:]\s+/);
      const rest = parts.filter((part) => part.toLowerCase() !== siteName.toLowerCase());
      if (rest.length && rest.length < parts.length) return rest.join(' – ');
    }
    return title;
  }

  /** 在当前看得见的页面上找到被识别为正文的元素，画出点亮框。 */
  function findMarks(article) {
    const keyOf = (text) => A.clean(text).toLowerCase().slice(0, 48);
    const wanted = new Set();
    for (const block of article.blocks) {
      if (block.text && block.type !== 'img') wanted.add(keyOf(block.text));
    }
    const titleKey = keyOf(article.title);
    const images = new Set(article.blocks.filter((block) => block.type === 'img').map((block) => block.src));
    const height = innerHeight;
    const width = innerWidth;
    const found = [];
    let title = null;
    const nodes = document.body?.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, figure img, img, td') || [];
    for (const node of nodes) {
      if (found.length >= MAX_MARKS) break;
      const rect = node.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > height || rect.width < 24 || rect.height < 8 || rect.right < 0 || rect.left > width) continue;
      if (node.tagName === 'IMG') {
        if (images.has(node.currentSrc) || images.has(node.src)) found.push({ rect, kind: 'img' });
        continue;
      }
      const key = keyOf(node.textContent || '');
      if (!key) continue;
      if (!title && /^H[12]$/.test(node.tagName) && key === titleKey) { title = rect; continue; }
      if (wanted.has(key)) found.push({ rect, kind: 'text' });
    }
    // 外层元素与里面的元素都命中时（li 里的 p），只留里面那个
    const marks = found.filter((item, i) => !found.some((other, j) => j !== i
      && other.rect.top >= item.rect.top && other.rect.bottom <= item.rect.bottom
      && other.rect.left >= item.rect.left && other.rect.right <= item.rect.right
      && (other.rect.width * other.rect.height) < (item.rect.width * item.rect.height)));
    return { title, marks: merge(marks) };
  }

  /** 紧挨着、左右对齐的几块（列表项、连续短段）合成一个框，免得框线叠成一片。 */
  function merge(marks) {
    const boxes = marks
      .map(({ rect, kind }) => ({ kind, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }))
      .sort((a, b) => a.top - b.top);
    const out = [];
    for (const box of boxes) {
      const last = out[out.length - 1];
      if (last && box.kind === 'text' && last.kind === 'text' && box.top - last.bottom < 10
        && Math.abs(box.left - last.left) < 8 && Math.abs(box.right - last.right) < 60) {
        last.bottom = Math.max(last.bottom, box.bottom);
        last.right = Math.max(last.right, box.right);
      } else {
        out.push({ ...box });
      }
    }
    return out.map((box) => ({ kind: box.kind, rect: { ...box, width: box.right - box.left, height: box.bottom - box.top } }));
  }

  function paintMarks(overlay, { title, marks }) {
    const height = innerHeight || 1;
    const add = (rect, extra) => {
      const box = document.createElement('div');
      box.className = `mark${extra ? ` ${extra}` : ''}`;
      const pad = 4;
      box.style.left = `${rect.left - pad}px`;
      box.style.top = `${rect.top - pad}px`;
      box.style.width = `${rect.width + pad * 2}px`;
      box.style.height = `${rect.height + pad * 2}px`;
      // 光带扫到哪里，哪里亮起来
      box.style.animationDelay = `${Math.round(Math.max(0, Math.min(1, rect.top / height)) * 900)}ms`;
      overlay.marks.appendChild(box);
      return box;
    };
    if (title) {
      const box = add(title, 'title');
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = t("标题");
      box.appendChild(tag);
    }
    for (const mark of marks) add(mark.rect);
  }

  /* ---------------------------------------------------------------- 流程 */

  function setPill(overlay, { kind = '', message, strong = '', actions = [] }) {
    overlay.pill.className = `pill ${kind}${actions.length ? ' card' : ''}`;
    overlay.text.replaceChildren(document.createTextNode(message));
    if (strong) {
      const b = document.createElement('b');
      b.textContent = strong;
      overlay.text.append(' · ', b);
    }
    overlay.pill.querySelector('.actions')?.remove();
    if (!actions.length) return;
    const row = document.createElement('div');
    row.className = 'actions';
    for (const action of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = action.label;
      if (action.primary) button.className = 'primary';
      button.addEventListener('click', action.run);
      row.appendChild(button);
    }
    overlay.pill.appendChild(row);
    row.querySelector('button.primary')?.focus();
  }

  async function openReader(current, article) {
    setPill(current.overlay, { kind: 'ok', message: t("正在打开双语阅读…") });
    let reply = null;
    try {
      reply = await chrome.runtime.sendMessage({ type: 'reader-open', article });
    } catch {
      /* 扩展刚更新，联系不上后台 */
    }
    if (current.closed) return;
    if (!reply?.ok) {
      setPill(current.overlay, {
        kind: 'warn',
        message: t("打不开阅读页，请刷新页面后重试。"),
        actions: [{ label: t("关闭"), run: () => close(current) }],
      });
      return;
    }
    await wait(250);
    close(current);
  }

  async function run(current) {
    const { overlay } = current;
    const startedAt = Date.now();
    setPill(overlay, { message: t("正在识别这篇文章的标题与正文…") });
    await frame();
    overlay.layer.classList.add('on');
    // 先让动画跑起来再识别：识别是同步的，大页面会占住主线程几百毫秒（光带动画在合成线程上，不受影响）
    await frame();
    await wait(60);
    let parsed;
    try {
      parsed = parse();
    } catch (err) {
      console.warn('[AI Translator] Reader parse failed:', err?.message || err);
      parsed = { readerable: false, article: null };
    }
    if (current.closed) return;
    const { article, readerable } = parsed;
    const judgement = article ? A.assess(article, { readerable }) : { verdict: 'none' };
    if (article && judgement.verdict !== 'none') paintMarks(overlay, findMarks(article));

    await wait(Math.max(0, MIN_SCAN_MS - (Date.now() - startedAt)));
    if (current.closed) return;
    overlay.layer.classList.add('done');

    if (judgement.verdict === 'none') {
      setPill(overlay, {
        kind: 'warn',
        message: t("这个页面里没有找到可以阅读的正文。"),
        actions: [{ label: t("关闭"), primary: true, run: () => close(current) }],
      });
      return;
    }
    const count = article.blocks.filter((block) => A.parts(block).length).length;
    if (judgement.verdict === 'weak') {
      setPill(overlay, {
        kind: 'warn',
        message: t("这个页面不太像一篇完整的文章（识别到 $1 段文字）。仍然打开吗？", [count]),
        actions: [
          { label: t("取消"), run: () => close(current) },
          { label: t("仍然打开"), primary: true, run: () => openReader(current, article) },
        ],
      });
      return;
    }
    setPill(overlay, { kind: 'ok', message: t("已识别 $1 段正文", [count]), strong: article.title });
    await wait(650);
    if (!current.closed) openReader(current, article);
  }

  function start() {
    if (window.top !== window) return { ok: false };
    if (session && !session.closed) return { ok: true, busy: true };
    const current = { overlay: createOverlay(), closed: false };
    current.onKey = (event) => {
      if (event.key === 'Escape') { event.stopPropagation(); close(current); }
    };
    document.addEventListener('keydown', current.onKey, true);
    session = current;
    onRetire(() => close(current, { fast: true }));
    run(current).catch((err) => {
      console.warn('[AI Translator] Reader failed:', err?.message || err);
      close(current);
    });
    return { ok: true };
  }

  globalThis.AITrReaderScan = { start };
})();
