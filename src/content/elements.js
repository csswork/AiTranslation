/**
 * 元素翻译：右键某个元素 → 给它挂一个翻译按钮 → 点击把元素内的文字就地换成中文。
 * 规则按域名记住，下次访问自动挂上按钮。
 *
 * 独立于 content.js（划词翻译那套）：自己的事件监听、自己的 shadow 宿主，
 * 互不引用，一边出问题不影响另一边。
 */
(() => {
  if (window.__aiTranslationElementsLoaded) return;
  window.__aiTranslationElementsLoaded = true;

  // 只在顶层框架工作：iframe 里挂按钮意义不大，也容易错位
  try {
    if (window.top !== window) return;
  } catch {
    return;
  }

  const Lang = globalThis.AITrLang;
  const Rules = globalThis.AITrRules;
  const Selector = globalThis.AITrSelector;
  if (!Lang || !Rules || !Selector) return;

  /** 不该翻译、也不该计入语言判定的标签。 */
  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION',
    'CODE', 'PRE', 'KBD', 'SAMP', 'SVG', 'CANVAS', 'IFRAME',
  ]);

  const MAX_OBSERVED_PER_RULE = 300; // 一条规则最多盯多少个元素（按钮按需懒挂）
  const MAX_NODES = 300;            // 单个元素最多翻译多少段
  const MAX_CHARS = 20000;          // 单个元素最多翻译多少字
  const CHUNK_NODES = 25;           // 每批送多少段
  const CHUNK_CHARS = 2200;         // 每批最多多少字

  const HOST = location.hostname;

  async function ask(message) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }

  /* ------------------------------------------------------- 右键目标追踪 */

  /**
   * 只需要记住右键点的是哪个元素。
   * 菜单项是否出现完全交给 Chrome 的 contexts 规则（见 background.js），
   * 这里不做任何判断，也不用上报——省掉了一条会出时序问题的链路。
   */
  let lastTarget = null;

  document.addEventListener(
    'contextmenu',
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      // 右键点在我们自己的按钮上时不算
      if (layer && layer.contains(target)) return;
      lastTarget = target;
    },
    true
  );

  /* ----------------------------------------------------------- 按钮 UI */

  /**
   * 低调优先：默认半透明的中性色，悬停才显现。
   * 明暗两套由元素背后的实际背景色决定——站点是白底还是黑底，
   * 比系统的 prefers-color-scheme 更贴近它真正的长相。
   */
  /**
   * 低调优先，但颜色一律用不透明的 rgb。
   * 教训：rgba 的 alpha 会和 opacity 相乘（0.05 × 0.38 ≈ 0.019），叠起来等于隐形。
   * 现在只由 opacity 单独控制淡入淡出，颜色本身是实的，效果可预期。
   */
  const BUTTON_STYLE = `
    .btn {
      all: unset;
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 22px;
      height: 20px;
      padding: 0 6px;
      border-radius: 5px;
      cursor: pointer;
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC",
                   "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      font-size: 11px;
      font-weight: 500;
      line-height: 1;
      white-space: nowrap;
      opacity: 0.6;
      transition: opacity 0.12s ease;
      /* 浅色底（默认） */
      color: rgb(90, 100, 118);
      background: rgb(238, 240, 244);
      border: 1px solid rgb(219, 223, 230);
    }
    .btn:hover { opacity: 1; }

    /* 深色底 */
    .btn[data-theme="dark"] {
      color: rgb(168, 177, 190);
      background: rgb(42, 47, 56);
      border-color: rgb(62, 69, 80);
    }

    /* 进行中：显眼一点，让人知道在跑 */
    .btn[data-state="busy"] { cursor: progress; opacity: 1; }
    /* 已翻译：更淡，别干扰阅读 */
    .btn[data-state="done"] { opacity: 0.45; }
    .btn[data-state="error"] {
      opacity: 1;
      color: rgb(180, 35, 24);
      background: rgb(253, 235, 233);
      border-color: rgb(240, 200, 196);
    }
    .btn[data-theme="dark"][data-state="error"] {
      color: rgb(252, 165, 165);
      background: rgb(60, 32, 32);
      border-color: rgb(90, 48, 48);
    }
    @media (prefers-reduced-motion: reduce) {
      .btn { transition: none; }
    }`;

  /* ------------------------------------------------------- 明暗判定 */

  /** 解析 getComputedStyle 给出的 rgb()/rgba() 颜色。 */
  function parseColor(value) {
    const match = /^rgba?\(([^)]+)\)$/.exec(String(value).trim());
    if (!match) return null;
    const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null;
    const alpha = parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 1;
    return { r: parts[0], g: parts[1], b: parts[2], a: alpha };
  }

  /**
   * 从元素往上找第一层不透明的背景色，据此判断深浅。
   * 站点可能系统是深色但自己是白底，所以不看 prefers-color-scheme。
   */
  function detectTheme(element) {
    let node = element;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 12) {
      let color = null;
      try {
        color = parseColor(getComputedStyle(node).backgroundColor);
      } catch {
        color = null;
      }
      if (color && color.a > 0.5) {
        const brightness = (color.r * 299 + color.g * 587 + color.b * 114) / 1000;
        return brightness < 140 ? 'dark' : 'light';
      }
      node = node.parentElement;
      depth += 1;
    }
    return 'light'; // 一路透明到顶，浏览器默认是白底
  }

  /** element -> { host, button, state, originals } */
  const attached = new WeakMap();
  let layer = null;

  function ensureLayer() {
    if (layer && layer.isConnected) return layer;
    layer = document.createElement('div');
    layer.style.cssText =
      'all: initial; position: absolute !important; top: 0 !important; left: 0 !important;' +
      'width: 0 !important; height: 0 !important; pointer-events: none !important;' +
      'z-index: 2147483645 !important;';
    (document.body || document.documentElement).appendChild(layer);
    return layer;
  }

  function position(entry) {
    if (!entry.element.isConnected) {
      entry.host.remove();
      trackedElements.delete(entry.element);
      return;
    }
    // 页面整块重建时宿主可能被一起移走，重新挂回去
    if (!entry.host.isConnected) ensureLayer().appendChild(entry.host);
    const rect = entry.element.getBoundingClientRect();
    if (!rect.width && !rect.height) {
      entry.host.style.display = 'none';
      return;
    }
    entry.host.style.display = 'block';
    // 用文档坐标，这样按钮会跟着页面一起滚，不必监听 scroll
    const top = rect.top + window.scrollY;
    const left = rect.right + window.scrollX;
    entry.host.style.top = `${Math.round(Math.max(0, top + 2))}px`;
    entry.host.style.left = `${Math.round(Math.max(0, left - 8))}px`;
  }

  function setState(entry, state, text) {
    entry.state = state;
    entry.button.dataset.state = state;
    entry.button.textContent = text;
  }

  function attach(element) {
    if (!(element instanceof Element) || attached.has(element)) return;

    const host = document.createElement('div');
    host.style.cssText =
      'all: initial; position: absolute !important; pointer-events: auto !important;' +
      'transform: translateX(-100%) !important;';
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = BUTTON_STYLE;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn';
    button.title = '把这个区域的文字翻译成中文';
    button.textContent = '译';
    button.dataset.state = 'idle';
    button.dataset.theme = detectTheme(element);
    root.appendChild(style);
    root.appendChild(button);

    const entry = { element, host, button, state: 'idle', originals: null };
    attached.set(element, entry);
    ensureLayer().appendChild(host);
    position(entry);

    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onButtonClick(entry);
    });

    // 元素尺寸变化时跟着挪
    try {
      const observer = new ResizeObserver(() => position(entry));
      observer.observe(element);
      entry.observer = observer;
    } catch {
      /* 老浏览器没有 ResizeObserver，靠 resize 事件兜底 */
    }
    return entry;
  }

  let repositionTimer = 0;
  function scheduleReposition(delay = 150) {
    clearTimeout(repositionTimer);
    repositionTimer = setTimeout(() => repositionAll(), delay);
  }
  window.addEventListener('resize', () => scheduleReposition());

  /** WeakMap 不能遍历，另外留一份普通集合用于重新定位。 */
  const trackedElements = new Set();

  /* ------------------------------------------------------- 收集与替换 */

  function collectTextNodes(element) {
    const nodes = [];
    let chars = 0;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        const value = node.nodeValue || '';
        if (!value.trim()) return NodeFilter.FILTER_REJECT;
        // 没有字母的（纯数字、符号）不值得送去翻译
        return /\p{L}/u.test(value) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const value = node.nodeValue;
      if (nodes.length >= MAX_NODES || chars + value.length > MAX_CHARS) break;
      nodes.push(node);
      chars += value.length;
    }
    return nodes;
  }

  /** 按字数和条数切批。 */
  function chunk(nodes) {
    const batches = [];
    let current = [];
    let chars = 0;
    for (const node of nodes) {
      const length = node.nodeValue.length;
      if (current.length && (current.length >= CHUNK_NODES || chars + length > CHUNK_CHARS)) {
        batches.push(current);
        current = [];
        chars = 0;
      }
      current.push(node);
      chars += length;
    }
    if (current.length) batches.push(current);
    return batches;
  }

  async function translateElement(entry) {
    const nodes = collectTextNodes(entry.element);
    if (!nodes.length) {
      setState(entry, 'error', '无文字');
      setTimeout(() => setState(entry, 'idle', '译'), 1600);
      return;
    }

    const originals = nodes.map((node) => ({ node, text: node.nodeValue }));
    const batches = chunk(nodes);
    let done = 0;

    setState(entry, 'busy', `0/${batches.length}`);

    for (const batch of batches) {
      const texts = batch.map((node) => node.nodeValue);
      const reply = await ask({ type: 'translate-batch', texts });
      if (!reply?.ok) {
        // 已经换掉的部分保留，按钮上给出错误
        entry.originals = originals;
        setState(entry, 'error', '失败');
        entry.button.title = reply?.error || '翻译失败';
        return;
      }
      batch.forEach((node, index) => {
        const translated = reply.texts[index];
        if (typeof translated === 'string' && translated) node.nodeValue = translated;
      });
      done += 1;
      setState(entry, 'busy', `${done}/${batches.length}`);
      position(entry);
    }

    entry.originals = originals;
    entry.button.title = '恢复原文';
    setState(entry, 'done', '原文');
    position(entry);
  }

  function restoreElement(entry) {
    if (entry.originals) {
      for (const item of entry.originals) {
        // 节点可能已被页面自身替换掉
        if (item.node.isConnected) item.node.nodeValue = item.text;
      }
    }
    entry.originals = null;
    entry.button.title = '把这个区域的文字翻译成中文';
    setState(entry, 'idle', '译');
    position(entry);
  }

  function onButtonClick(entry) {
    if (entry.state === 'busy') return;
    if (entry.state === 'done') {
      restoreElement(entry);
      return;
    }
    translateElement(entry).catch((err) => {
      setState(entry, 'error', '失败');
      entry.button.title = String(err?.message || err);
    });
  }

  /* --------------------------------------------------------- 规则应用 */

  let activeRules = [];
  const observed = new WeakSet();

  /** 进入视口附近才挂按钮，这样不必给「最多挂几个」设一个武断的上限。 */
  let viewObserver = null;
  function ensureViewObserver() {
    if (viewObserver) return viewObserver;
    try {
      viewObserver = new IntersectionObserver(
        (entries) => {
          for (const item of entries) {
            if (!item.isIntersecting) continue;
            const element = item.target;
            viewObserver.unobserve(element);
            if (attached.has(element)) continue;
            if (attach(element)) trackedElements.add(element);
          }
        },
        { rootMargin: '400px' } // 提前一屏挂好，滚到时按钮已经在
      );
    } catch {
      viewObserver = null; // 老浏览器没有 IntersectionObserver，回落到直接挂
    }
    return viewObserver;
  }

  /** AJAX 插入的内容会把已有元素挤动，已挂的按钮要跟着重新定位。 */
  function repositionAll() {
    for (const element of [...trackedElements]) {
      const entry = attached.get(element);
      if (entry) position(entry);
      else trackedElements.delete(element);
    }
  }

  function applyRules() {
    for (const rule of activeRules) {
      let matched;
      try {
        matched = document.querySelectorAll(rule.selector);
      } catch {
        continue; // 选择器失效（站点改版）就跳过
      }
      let seen = 0;
      for (const element of matched) {
        if (seen >= MAX_OBSERVED_PER_RULE) break;
        seen += 1;
        if (attached.has(element) || observed.has(element)) continue;
        const io = ensureViewObserver();
        if (io) {
          observed.add(element);
          io.observe(element);
        } else if (attach(element)) {
          trackedElements.add(element);
        }
      }
    }
    repositionAll();
  }

  async function reloadRules() {
    try {
      activeRules = await Rules.rulesFor(HOST);
    } catch {
      activeRules = [];
    }
    applyRules();
  }

  /* 站点在运行时切换明暗（通常是改 <html>/<body> 的 class）时，按钮要跟着换 */
  let themeTimer = 0;
  function refreshThemes() {
    for (const element of [...trackedElements]) {
      const entry = attached.get(element);
      if (entry && element.isConnected) entry.button.dataset.theme = detectTheme(element);
    }
  }

  function watchTheme() {
    const schedule = () => {
      clearTimeout(themeTimer);
      themeTimer = setTimeout(refreshThemes, 200);
    };
    try {
      const observer = new MutationObserver(schedule);
      const filter = ['class', 'style', 'data-theme', 'data-color-mode', 'theme', 'dark'];
      observer.observe(document.documentElement, { attributes: true, attributeFilter: filter });
      if (document.body) {
        observer.observe(document.body, { attributes: true, attributeFilter: filter });
      }
    } catch {
      /* 忽略 */
    }
    try {
      window
        .matchMedia('(prefers-color-scheme: dark)')
        .addEventListener('change', schedule);
    } catch {
      /* 忽略 */
    }
  }

  /* 页面高度变化（图片加载完、内容展开）会让已挂按钮错位 */
  function watchLayout() {
    try {
      const observer = new ResizeObserver(() => scheduleReposition(120));
      observer.observe(document.body);
    } catch {
      /* 忽略 */
    }
  }

  /* 页面内容是后加载的（SPA、无限滚动）时也要能挂上按钮 */
  let observerTimer = 0;
  function watchDom() {
    try {
      const observer = new MutationObserver(() => {
        if (!activeRules.length || observerTimer) return;
        observerTimer = setTimeout(() => {
          observerTimer = 0;
          applyRules();
        }, 800);
      });
      observer.observe(document.body, { childList: true, subtree: true });
    } catch {
      /* 忽略 */
    }
  }

  /* ----------------------------------------------------------- 消息 */

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'add-element-rule') return false;
    (async () => {
      if (!lastTarget || !lastTarget.isConnected) {
        sendResponse({ ok: false, error: '没有记录到右键的元素' });
        return;
      }
      const built = Selector.build(lastTarget);
      if (!built) {
        sendResponse({ ok: false, error: '无法为这个元素生成可复用的选择器' });
        return;
      }
      const result = await Rules.addRule(HOST, built.selector, built.label);
      // 拿不到域名（file://、about:blank 等）时无法记录规则，
      // 这里必须如实报错，不能假装成功让用户以为没生效是别的原因
      if (!result) {
        sendResponse({ ok: false, error: '这个页面没有有效域名，无法记录规则' });
        return;
      }
      if (result.full) {
        sendResponse({ ok: false, error: '这个网站的规则已达上限' });
        return;
      }
      await reloadRules();
      sendResponse({ ok: true, selector: built.selector, matches: built.matches });
    })();
    return true; // 异步回复
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[Rules.STORE_KEY]) reloadRules();
  });

  /* ---------------------------------------------------------- 启动 */

  reloadRules();
  watchDom();
  watchLayout();
  watchTheme();
})();
