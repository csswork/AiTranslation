/**
 * 元素翻译：右键某个元素 → 记成规则 → 鼠标移到这类元素上时出现翻译按钮 →
 * 点击把元素内的文字就地换成中文。规则按域名记住，下次访问照样生效。
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

  /**
   * element -> { element, host, button, state, originals, themeEpoch }
   * 鼠标第一次移到元素上时才建（宿主 + shadow + 按钮），从没碰过的元素零开销。
   */
  const attached = new WeakMap();
  let layer = null;
  /** 滚动期间整层隐藏的状态，与 layer 同生命周期，所以声明在一起。 */
  let hiddenByScroll = false;

  /**
   * 正在显示的按钮：鼠标所在的那一个，加上正在翻译 / 出错的。
   * 滚动、缩放、换主题时只处理这几个。其余按钮不在文档里，
   * 不读 rect、不参与任何重排。
   */
  const shown = new Set();
  /** 鼠标所在的规则元素对应的按钮。嵌套匹配时只取最外层的一个。 */
  let hovered = null;
  /** 站点每切一次明暗就加一；按钮显示时发现自己的版本旧了才重算主题。 */
  let themeEpoch = 0;

  /** 只观察正在显示的元素：悬停中卡片展开、翻译后文字变长，按钮都要跟着挪。 */
  let sizeObserver = null;
  try {
    sizeObserver = new ResizeObserver(() => repositionShown());
  } catch {
    sizeObserver = null; // 老浏览器没有 ResizeObserver，靠 resize 事件兜底
  }

  function ensureLayer() {
    if (layer && layer.isConnected) return layer;
    hiddenByScroll = false; // 新建的层是显示状态
    layer = document.createElement('div');
    // 用 fixed：按钮按视口坐标摆放，页面滚动、内层容器滚动、
    // 元素本身是 sticky/fixed —— 三种情况都能跟住。
    layer.style.cssText =
      'all: initial; position: fixed !important; top: 0 !important; left: 0 !important;' +
      'width: 0 !important; height: 0 !important; pointer-events: none !important;' +
      'z-index: 2147483645 !important;';
    (document.body || document.documentElement).appendChild(layer);
    return layer;
  }

  /** 只写不读，供批量重排复用。 */
  function applyPosition(entry, rect) {
    const host = entry.host;
    if (!rect.width && !rect.height) {
      host.style.display = 'none';
      return;
    }
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    // 滚出视口（也包括被内层滚动容器裁掉）时收起来，
    // 否则按钮会飘在不相干的内容上面
    if (vw && vh && (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw)) {
      host.style.display = 'none';
      return;
    }
    host.style.display = 'block';
    host.style.top = `${Math.round(rect.top + 2)}px`;
    host.style.left = `${Math.round(rect.right - 8)}px`;
  }

  /** 翻译中要一直看得到进度，出错要让人看得到结果；其余只在悬停时出现。 */
  const wantsVisible = (entry) =>
    entry === hovered || entry.state === 'busy' || entry.state === 'error';

  /** 收起：比 display:none 更彻底，直接移出文档。按钮状态留在 entry 里，下次原样接上。 */
  function conceal(entry) {
    shown.delete(entry);
    sizeObserver?.unobserve(entry.element);
    entry.host.remove();
  }

  /** 按悬停与状态决定显示还是收起；显示时顺带摆好位置。 */
  function sync(entry) {
    if (!entry.element.isConnected) {
      if (hovered === entry) hovered = null;
      conceal(entry);
      return;
    }
    if (!wantsVisible(entry)) {
      if (shown.has(entry)) conceal(entry);
      return;
    }
    if (!shown.has(entry)) {
      shown.add(entry);
      sizeObserver?.observe(entry.element);
      if (entry.themeEpoch !== themeEpoch) {
        entry.button.dataset.theme = detectTheme(entry.element);
        entry.themeEpoch = themeEpoch;
      }
    }
    // 页面整块重建时层可能被一起移走，ensureLayer 会重建
    if (!entry.host.isConnected) ensureLayer().appendChild(entry.host);
    applyPosition(entry, entry.element.getBoundingClientRect());
  }

  /** 先集中读 rect、再集中写样式。读写交错会反复触发强制布局。 */
  function repositionShown() {
    if (!shown.size) return;
    const pending = [];
    for (const entry of [...shown]) {
      if (!entry.element.isConnected) {
        if (hovered === entry) hovered = null;
        conceal(entry);
        continue;
      }
      if (!entry.host.isConnected) ensureLayer().appendChild(entry.host);
      pending.push([entry, entry.element.getBoundingClientRect()]);
    }
    for (const [entry, rect] of pending) applyPosition(entry, rect);
  }

  function setState(entry, state, text) {
    entry.state = state;
    entry.button.dataset.state = state;
    entry.button.textContent = text;
    // 显示与否取决于状态：翻译中常驻，翻完鼠标不在上面就收起
    sync(entry);
  }

  /** 取元素的按钮，没有就现建。只建不显示，显示与否交给 sync。 */
  function entryFor(element) {
    let entry = attached.get(element);
    if (entry) return entry;

    const host = document.createElement('div');
    host.style.cssText =
      'all: initial; position: fixed !important; pointer-events: auto !important;' +
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
    root.appendChild(style);
    root.appendChild(button);

    entry = { element, host, button, state: 'idle', originals: null, themeEpoch: -1 };
    attached.set(element, entry);

    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onButtonClick(entry);
    });
    return entry;
  }

  function setHovered(element) {
    const next = element ? entryFor(element) : null;
    if (next === hovered) return;
    const previous = hovered;
    hovered = next;
    if (previous) sync(previous);
    if (next) sync(next);
  }

  let repositionTimer = 0;
  function scheduleReposition(delay = 150) {
    if (!shown.size) return;
    clearTimeout(repositionTimer);
    repositionTimer = setTimeout(repositionShown, delay);
  }
  window.addEventListener('resize', () => scheduleReposition());

  /* ----------------------------------------------------------- 悬停 */

  /** 各条规则的选择器拼成一条，每往上找一层匹配只要一次 closest。 */
  let ruleSelector = '';
  let listening = false;
  /** 滚动中不读布局，停下后统一重判。 */
  let scrolling = false;
  /** 最近一次的鼠标位置。滚动时内容会从静止的鼠标下面滑过，停下后要按它重判。 */
  let pointerX = -1;
  let pointerY = -1;

  /**
   * 鼠标下面属于哪个规则元素。嵌套时取最外层：外层一译就连里层一起译了，
   * 再给里层一个按钮只会造成重复翻译、恢复时对不上原文。
   */
  function ruleElementAt(target) {
    if (!ruleSelector || !(target instanceof Element)) return null;
    try {
      let outermost = null;
      for (let el = target.closest(ruleSelector); el; el = el.parentElement?.closest(ruleSelector)) {
        outermost = el;
      }
      return outermost;
    } catch {
      return null;
    }
  }

  function onMouseOver(event) {
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (scrolling) return;
    // 移到我们自己的按钮上：保持现状，否则鼠标还没够到按钮它就收起来了
    if (layer && layer.contains(event.target)) return;
    setHovered(ruleElementAt(event.target));
  }

  function onMouseMove(event) {
    pointerX = event.clientX;
    pointerY = event.clientY;
  }

  function onMouseOut(event) {
    if (event.relatedTarget) return; // 为空说明鼠标离开了窗口
    pointerX = -1;
    pointerY = -1;
    setHovered(null);
  }

  /** 这个网站没有规则时一个监听都不挂。 */
  function setListening(on) {
    if (on === listening) return;
    listening = on;
    const method = on ? 'addEventListener' : 'removeEventListener';
    const options = { capture: true, passive: true };
    document[method]('mouseover', onMouseOver, options);
    document[method]('mousemove', onMouseMove, options);
    document[method]('mouseout', onMouseOut, options);
  }

  /**
   * 滚动期间把整层藏起来，停下来再摆好显示。
   * 逐帧跟随一来观感上会有拖影，二来每帧都要读 rect。
   * 藏起来只需对 layer 写一次 display，滚动全程零 getBoundingClientRect。
   */
  const SCROLL_SETTLE = 150;
  let scrollTimer = 0;

  function setLayerHidden(hidden) {
    if (!layer || hiddenByScroll === hidden) return;
    hiddenByScroll = hidden;
    // 用 display 而不是 visibility：宿主的 cssText 里有 all: initial，
    // 会把 visibility 重置成 visible，父层的 hidden 盖不住它。
    layer.style.setProperty('display', hidden ? 'none' : 'block', 'important');
  }

  // scroll 事件不冒泡，但在 window 上用捕获能收到内层滚动容器的事件
  window.addEventListener(
    'scroll',
    () => {
      if (!listening && !shown.size) return;
      scrolling = true;
      setLayerHidden(true);
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        scrolling = false;
        // 层还藏着，elementFromPoint 不会命中我们自己的按钮
        if (listening && pointerX >= 0) {
          setHovered(ruleElementAt(document.elementFromPoint(pointerX, pointerY)));
        }
        // 顺序不能反：先摆好位置再显示，否则会闪一下旧位置
        repositionShown();
        setLayerHidden(false);
      }, SCROLL_SETTLE);
    },
    { capture: true, passive: true }
  );

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
    }

    entry.originals = originals;
    entry.button.title = '恢复原文';
    setState(entry, 'done', '原文');
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

  /**
   * 选择器逐条校验后拼成一条。站点改版不会让选择器语法失效，
   * 但存储里的内容不可全信，坏的一条不能拖垮其余的。
   */
  function compileRules(rules) {
    const probe = document.createDocumentFragment();
    const valid = [];
    for (const rule of rules) {
      try {
        probe.querySelector(rule.selector);
        valid.push(rule.selector);
      } catch {
        /* 跳过无效选择器 */
      }
    }
    return valid.join(', ');
  }

  async function reloadRules() {
    let rules = [];
    try {
      rules = await Rules.rulesFor(HOST);
    } catch {
      rules = [];
    }
    ruleSelector = compileRules(rules);
    setListening(Boolean(ruleSelector));
    // 规则删了或改了，鼠标下面那个元素可能已经不算数了
    if (hovered && ruleElementAt(hovered.element) !== hovered.element) setHovered(null);
  }

  /* 站点在运行时切换明暗（通常是改 <html>/<body> 的 class）时，按钮要跟着换 */
  let themeTimer = 0;
  function refreshThemes() {
    for (const entry of shown) {
      entry.button.dataset.theme = detectTheme(entry.element);
      entry.themeEpoch = themeEpoch;
    }
  }

  function watchTheme() {
    const schedule = () => {
      themeEpoch += 1; // 没显示的按钮下次出现时自己重算
      if (!shown.size) return;
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

  /* 页面高度变化（图片加载完、内容展开）会让正在显示的按钮错位 */
  function watchLayout() {
    try {
      const observer = new ResizeObserver(() => scheduleReposition(120));
      observer.observe(document.body);
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
      // 马上亮出刚右键那个元素的按钮，告诉用户规则生效了；鼠标移到别的元素上就回到正常的悬停逻辑
      setHovered(ruleElementAt(lastTarget));
      sendResponse({ ok: true, selector: built.selector, matches: built.matches });
    })();
    return true; // 异步回复
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[Rules.STORE_KEY]) reloadRules();
  });

  /* ---------------------------------------------------------- 启动 */

  reloadRules();
  watchLayout();
  watchTheme();
})();
