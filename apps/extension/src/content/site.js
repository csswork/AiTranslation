/**
 * 整站翻译：右键「翻译这个网站」打开后，这个网站（按域名）的页面都自动翻译成目标语言，直到再次关闭。
 * 见 docs/extension/site-translation.md。
 *
 * - 只在顶层框架工作；名单在 chrome.storage.local（lib/sites.js），各标签页监听变化自行开始或恢复原文。
 * - 与区域翻译一样按文字节点原地替换，恢复时换回原文；页面后来改过的文字不动。
 * - 为了省用量：只翻译滚动到视口附近的内容，相同文字只请求一次，已经是目标语言的页面不翻译。
 * - 平台用设置里「整站翻译」单独选的（AITrSettings.siteProvider），请求经 service worker 代发。
 * - 第一次用会花钱的平台开启时，由后台让这里弹出确认框（site-confirm），可以改用本机翻译。
 *
 * 独立于 content.js / elements.js：自己的事件和 shadow 宿主，互不引用。
 */
(() => {
  const t = (...args) => AITrI18n.t(...args);
  if (window.__aiTranslationSiteLoaded) return;
  window.__aiTranslationSiteLoaded = true;

  try {
    if (window.top !== window) return;
  } catch {
    return;
  }

  const Sites = globalThis.AITrSites;
  const S = globalThis.AITrSettings;
  const Requests = globalThis.AITrRequests;
  const Lang = globalThis.AITrLang;
  if (!Sites || !S || !Requests || !Lang) return;
  const { signal: lifeSignal, onRetire } = globalThis.AITrLifecycle;

  const HOST = Sites.hostOf(location.href);

  /** 文字在这些元素里面时不翻译：代码、输入框、明确标了不翻译的区域。 */
  const SKIP = [
    'script', 'style', 'noscript', 'template', 'textarea', 'input', 'select', 'option',
    'code', 'pre', 'kbd', 'samp', 'var', 'svg', 'math', 'canvas', 'iframe',
    '[translate="no"]', '.notranslate', '[contenteditable=""]', '[contenteditable="true"]',
  ].join(',');

  const CHUNK_NODES = 25;     // 每批送多少段
  const CHUNK_CHARS = 2200;   // 每批最多多少字
  const MAX_ACTIVE = 2;       // 同时在途的请求数
  const MAX_TEXT = 1500;      // 单段文字超过这个长度就截断不翻（多半是数据而不是正文）
  const CACHE_LIMIT = 3000;   // 同一页面里缓存多少条译文
  const LETTER = /\p{L}/u;

  function send(message) {
    try {
      const promise = chrome.runtime.sendMessage(message);
      if (promise && typeof promise.catch === 'function') promise.catch(() => {});
    } catch {
      /* 扩展刚更新时上下文会失效，忽略即可 */
    }
  }

  /* ------------------------------------------------------------ 页面语言 */

  const CHINESE = new Set(['zh-Hans', 'zh-Hant']);

  /** 声明的页面语言；没有声明时取一段正文让浏览器识别。返回项目语言 id，判断不出返回空字符串。 */
  async function pageLanguage() {
    const declared = AITrLanguages.match(document.documentElement.lang || '');
    if (declared) return declared;
    const sample = String(document.body?.innerText || '').slice(0, 2000);
    if (!sample.trim()) return '';
    try {
      const result = await chrome.i18n.detectLanguage(sample);
      const top = result?.languages?.[0];
      return result?.isReliable && top?.language ? AITrLanguages.match(top.language) || '' : '';
    } catch {
      return '';
    }
  }

  /* -------------------------------------------------------------- 翻译会话 */

  /** 当前会话；null 表示没有在翻译。 */
  let session = null;

  function createSession(settings, pageLang) {
    const providerId = S.siteProvider(settings);
    return {
      controller: new AbortController(),
      settings,
      providerId,
      targetId: settings.target,
      pageLang,
      /** 文字节点 -> { original, translated }：译文写进去之后用来识别「是我们改的」和恢复原文 */
      info: new WeakMap(),
      changed: new Set(),
      queue: [],
      queued: new WeakSet(),
      cache: new Map(),
      active: 0,
      failed: null,
      /** 首屏翻完后不再显示「正在翻译」，滚动时陆续翻译不打扰；出错仍会提示 */
      quiet: false,
      timer: 0,
      io: null,
      mo: null,
      pendingRoots: new Set(),
      mutationTimer: 0,
      /** 已经在监听的开放 shadow root */
      shadows: new WeakSet(),
    };
  }

  /** 去掉首尾空白再送去翻译，写回时保留原来的空白，缓存命中率也更高。 */
  function split(value) {
    const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(value);
    return { lead: match[1], core: match[2], trail: match[3] };
  }

  function eligible(node) {
    if (!session || node.nodeType !== Node.TEXT_NODE) return false;
    const parent = node.parentElement;
    if (!parent || parent.closest(SKIP)) return false;
    const value = node.nodeValue || '';
    const { core } = split(value);
    if (!core || core.length > MAX_TEXT || !LETTER.test(core)) return false;
    const record = session.info.get(node);
    if (record && record.translated === value) return false; // 已经是译文
    // 目标是中文时，本来就是中文的文字不翻译；页面是另一种中文（简繁转换）时照常翻译
    if (CHINESE.has(session.targetId) && Lang.analyze(core).isChinese
      && !(CHINESE.has(session.pageLang) && session.pageLang !== session.targetId)) return false;
    return true;
  }

  /**
   * 把 root 里可以翻译的文字所在元素交给 IntersectionObserver，滚到附近时再翻。
   * 也进入网页组件的开放 shadow root（很多现代网站的正文在里面），并监听它们的变化；
   * 封闭的 shadow root（包括扩展自己的界面）进不去。返回找到的元素数。
   */
  function scan(root) {
    if (!session || !root) return 0;
    if (root.nodeType === Node.TEXT_NODE) {
      if (!eligible(root)) return 0;
      session.io.observe(root.parentElement);
      return 1;
    }
    const types = [Node.ELEMENT_NODE, Node.DOCUMENT_NODE, Node.DOCUMENT_FRAGMENT_NODE];
    if (!types.includes(root.nodeType)) return 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    const parents = new Set();
    const shadows = [];
    if (root.nodeType === Node.ELEMENT_NODE && root.shadowRoot) shadows.push(root.shadowRoot);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.shadowRoot) shadows.push(node.shadowRoot);
      } else if (node.parentElement && !parents.has(node.parentElement) && eligible(node)) {
        parents.add(node.parentElement);
      }
    }
    for (const parent of parents) session.io.observe(parent);
    let found = parents.size;
    for (const shadow of shadows) {
      if (!session.shadows.has(shadow)) {
        session.shadows.add(shadow);
        session.mo.observe(shadow, { childList: true, subtree: true, characterData: true });
      }
      found += scan(shadow);
    }
    return found;
  }

  function onVisible(entries) {
    if (!session) return;
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      session.io.unobserve(entry.target);
      for (const child of entry.target.childNodes) {
        if (child.nodeType === Node.TEXT_NODE && !session.queued.has(child) && eligible(child)) {
          session.queued.add(child);
          session.queue.push(child);
        }
      }
    }
    schedule();
  }

  function schedule() {
    if (!session || session.timer || session.failed) return;
    session.timer = setTimeout(() => {
      if (!session) return;
      session.timer = 0;
      pump();
    }, 120);
  }

  function apply(node, original, translated) {
    if (!session || !node.isConnected || node.nodeValue !== original || typeof translated !== 'string' || !translated.trim()) return;
    const { lead, trail } = split(original);
    const value = lead + translated.trim() + trail;
    if (value === original) return;
    session.info.set(node, { original, translated: value });
    session.changed.add(node);
    node.nodeValue = value;
  }

  function remember(core, translated) {
    if (!session || typeof translated !== 'string') return;
    if (session.cache.size >= CACHE_LIMIT) session.cache.delete(session.cache.keys().next().value);
    session.cache.set(core, translated);
  }

  /** 从队列取一批：缓存命中的直接写回，其余去重后发请求。 */
  function takeBatch() {
    const current = session;
    const batch = [];
    let chars = 0;
    while (current.queue.length && batch.length < CHUNK_NODES) {
      const node = current.queue.shift();
      current.queued.delete(node);
      if (!node.isConnected || !eligible(node)) continue;
      const original = node.nodeValue;
      const { core } = split(original);
      if (current.cache.has(core)) {
        apply(node, original, current.cache.get(core));
        continue;
      }
      if (batch.length && chars + core.length > CHUNK_CHARS) {
        current.queue.unshift(node);
        current.queued.add(node);
        break;
      }
      batch.push({ node, original, core });
      chars += core.length;
    }
    return batch;
  }

  function pump() {
    const current = session;
    if (!current || current.failed) return;
    while (current.active < MAX_ACTIVE && current.queue.length) {
      const batch = takeBatch();
      if (!batch.length) continue;
      run(current, batch);
    }
    status.update();
  }

  async function run(current, batch) {
    current.active++;
    status.update();
    const texts = [...new Set(batch.map((item) => item.core))];
    try {
      const reply = await Requests.request({
        type: 'translate-batch', texts, targetId: current.targetId, providerId: current.providerId,
      }, { signal: current.controller.signal });
      if (session !== current) return;
      if (!reply?.ok) throw Object.assign(new Error(reply?.error || t("翻译失败")), { action: reply?.action || null });
      const out = new Map(texts.map((text, i) => [text, reply.texts?.[i]]));
      for (const [text, translated] of out) remember(text, translated);
      for (const item of batch) apply(item.node, item.original, out.get(item.core));
    } catch (error) {
      if (session !== current || error?.name === 'AbortError') return;
      current.failed = error;
      current.queue.length = 0;
    } finally {
      current.active--;
    }
    if (session !== current) return;
    if (current.failed) status.error(current.failed);
    else pump();
  }

  /** 页面后来加进来的内容（无限滚动、单页应用切换页面）同样翻译；页面改回的文字重新排队。 */
  function onMutations(mutations) {
    const current = session;
    if (!current) return;
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') {
        const node = mutation.target;
        const record = current.info.get(node);
        if (record && node.nodeValue === record.translated) continue; // 我们自己写的译文
        if (record) {
          current.info.delete(node);
          current.changed.delete(node);
        }
        current.pendingRoots.add(node);
      } else {
        for (const added of mutation.addedNodes) current.pendingRoots.add(added);
      }
    }
    if (current.mutationTimer || !current.pendingRoots.size) return;
    current.mutationTimer = setTimeout(() => {
      if (session !== current) return;
      current.mutationTimer = 0;
      const roots = [...current.pendingRoots];
      current.pendingRoots.clear();
      for (const root of roots) if (root.isConnected) scan(root);
    }, 200);
  }

  /**
   * announce：用户刚在这个网站上打开整站翻译（不是普通的页面加载），
   * 这时每种结果都要在页面上说一声，包括「已经是目标语言」「没有要翻的文字」。
   */
  async function start(announce = false) {
    if (session || !HOST || !document.body) return;
    const settings = await S.loadSettings();
    const pageLang = await pageLanguage();
    // 两次 await 之间可能已经被关闭或重复启动
    if (session || !(await Sites.has(HOST))) return;
    if (pageLang && pageLang === settings.target) {
      // 已经是目标语言，不花用量
      if (announce) status.note(t("这个页面已经是$1，不用翻译；这个网站上其他语言的页面会自动翻译。", [AITrLanguages.label(settings.target)]));
      return;
    }
    const current = createSession(settings, pageLang);
    session = current;
    current.io = new IntersectionObserver(onVisible, { rootMargin: '600px 0px' });
    current.mo = new MutationObserver(onMutations);
    current.mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    if (announce) status.busy();
    const found = scan(document.body);
    if (announce && !found) status.note(t("这个页面上没有找到需要翻译的文字；之后加载的内容和这个网站的其他页面会自动翻译。"));
  }

  /** 停止翻译并恢复原文；页面后来改过的文字保持页面的值。 */
  function stop() {
    const current = session;
    if (!current) return;
    session = null;
    current.controller.abort();
    clearTimeout(current.timer);
    clearTimeout(current.mutationTimer);
    current.io?.disconnect();
    current.mo?.disconnect();
    for (const node of current.changed) {
      const record = current.info.get(node);
      if (record && node.isConnected && node.nodeValue === record.translated) node.nodeValue = record.original;
    }
    current.changed.clear();
    status.hide();
  }

  function retry() {
    const current = session;
    if (!current) return;
    current.failed = null;
    current.quiet = false;
    status.hide();
    scan(document.body);
  }

  async function sync(sites, announce = false) {
    const enabled = Boolean(HOST) && (sites || (await Sites.list())).includes(HOST);
    if (enabled) await start(announce);
    else stop();
  }

  /* -------------------------------------------------------------- 界面 */

  /**
   * 宿主的样式写在 shadow root 的 :host 里并加 !important，不写进 style 属性，标签也不用 div。
   * 广告拦截扩展会注入类似 `head ~ div[style*="z-index"] { display: none !important }` 的规则
   * （Stands AdBlocker 实测如此），按标签名和 style 属性把挂在 <html> 下的浮层整个藏掉；
   * 而 shadow root 里的 !important 声明在层叠中胜过外部文档的 !important，网页和拦截器都盖不过。
   */
  const STYLE = `
    :host {
      all: initial !important;
      position: fixed !important; inset: 0 !important;
      z-index: 2147483647 !important;
      display: block !important; visibility: visible !important; opacity: 1 !important;
      pointer-events: none !important;
      color-scheme: light dark !important;
    }
    * { box-sizing: border-box }
    .ui {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
                   "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      font-size: 13px; line-height: 1.5; color: #0f172a;
      letter-spacing: normal; text-align: start; text-transform: none;
    }
    .pill {
      position: fixed; inset-inline-end: 16px; bottom: 16px;
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      max-width: min(420px, calc(100vw - 32px));
      padding: 8px 12px; border-radius: 12px;
      background: #fff; border: 1px solid rgba(15, 23, 42, 0.1);
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.16);
      pointer-events: auto;
    }
    .pill[hidden] { display: none }
    .pill .dot {
      width: 8px; height: 8px; border-radius: 50%; background: #4f46e5; flex: none;
      animation: pulse 1s ease-in-out infinite alternate;
    }
    .pill.error .dot { background: #dc2626; animation: none }
    .pill.note .dot { animation: none }
    .pill .text { flex: 1 1 160px; min-width: 0; overflow-wrap: anywhere }
    @keyframes pulse { from { opacity: 0.35 } to { opacity: 1 } }
    @media (prefers-reduced-motion: reduce) { .pill .dot { animation: none } }
    button {
      font: inherit; border-radius: 8px; padding: 4px 10px; cursor: pointer;
      border: 1px solid rgba(79, 70, 229, 0.35); background: transparent; color: #4338ca;
    }
    button.primary { background: #4f46e5; border-color: #4f46e5; color: #fff }
    button:hover { background: rgba(79, 70, 229, 0.08) }
    button.primary:hover { background: #4338ca }
    button:focus-visible { outline: 2px solid #6366f1; outline-offset: 2px }
    .backdrop {
      position: fixed; inset: 0; background: rgba(15, 23, 42, 0.32);
      display: grid; place-items: center; padding: 16px; pointer-events: auto;
    }
    .dialog {
      width: min(440px, 100%); padding: 20px; border-radius: 14px;
      background: #fff; border: 1px solid rgba(15, 23, 42, 0.08);
      box-shadow: 0 24px 64px rgba(15, 23, 42, 0.24);
      font-size: 14px; line-height: 1.6;
    }
    .dialog h2 { margin: 0 0 8px; font-size: 16px; font-weight: 600 }
    .dialog p { margin: 0 0 10px }
    .dialog .hint { color: rgba(15, 23, 42, 0.6); font-size: 13px }
    .dialog .actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; margin-top: 16px }
    .dialog button { padding: 7px 14px }
    @media (prefers-color-scheme: dark) {
      .ui { color: #e9eaee }
      .pill, .dialog { background: #191b21; border-color: rgba(255, 255, 255, 0.1); box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5) }
      .dialog .hint { color: rgba(233, 234, 238, 0.6) }
      button { color: #a5b4fc; border-color: rgba(165, 180, 252, 0.4) }
      button.primary { color: #fff }
      .backdrop { background: rgba(0, 0, 0, 0.5) }
    }
  `;

  let ui = null;
  function mount() {
    if (ui?.host.isConnected) return ui;
    const host = document.createElement('huaci-site-ui');
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    const wrap = document.createElement('div');
    wrap.className = 'ui';
    root.append(style, wrap);
    document.documentElement.appendChild(host);
    ui = { host, wrap };
    return ui;
  }

  function button(label, onClick, primary = false) {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = label;
    if (primary) el.className = 'primary';
    el.addEventListener('click', onClick);
    return el;
  }

  /** 右下角的小状态条：翻译中显示，空闲后收起；出错时留着，可以重试、去设置或关闭整站翻译。 */
  const status = (() => {
    let pill = null;
    let hideTimer = 0;
    function ensure() {
      const { wrap } = mount();
      if (!pill || !pill.isConnected) {
        pill = document.createElement('div');
        pill.className = 'pill';
        pill.setAttribute('role', 'status');
        wrap.appendChild(pill);
      }
      return pill;
    }
    function render(kind, text, actions = []) {
      const el = ensure();
      clearTimeout(hideTimer);
      el.hidden = false;
      el.classList.toggle('error', kind === 'error');
      el.classList.toggle('note', kind === 'note');
      const dot = document.createElement('span');
      dot.className = 'dot';
      const label = document.createElement('span');
      label.className = 'text';
      label.textContent = text;
      el.replaceChildren(dot, label, ...actions);
    }
    function hide() {
      clearTimeout(hideTimer);
      if (pill) pill.hidden = true;
    }
    const showBusy = () => render('busy', t("正在翻译这个网站…"), [button(t("关闭整站翻译"), turnOff)]);
    /** 刚开启时先亮出来：第一批请求要等滚动检测和 120ms 的合批，不能让人以为没反应 */
    function busy() {
      showBusy();
      hideTimer = setTimeout(() => {
        if (session && !session.active && !session.queue.length) hide();
      }, 3000);
    }
    /** 一句说明，几秒后自动收起。 */
    function note(text) {
      render('note', text, [button(t("关闭整站翻译"), turnOff)]);
      hideTimer = setTimeout(hide, 6000);
    }
    function update() {
      if (!session || session.failed) return;
      if (session.active > 0 || session.queue.length) {
        if (session.quiet) return;
        if (!pill || pill.hidden || pill.classList.contains('error') || pill.classList.contains('note')) {
          showBusy();
        }
      } else {
        session.quiet = true;
        clearTimeout(hideTimer);
        hideTimer = setTimeout(hide, 1200);
      }
    }
    function error(err) {
      const actions = [button(t("重试"), retry, true)];
      if (err?.action === 'open-options') {
        actions.push(button(t("打开设置"), () => {
          if (session && S.isLocal(session.providerId)) send({ type: 'open-local-download' });
          else send({ type: 'open-options' });
        }));
      }
      actions.push(button(t("关闭整站翻译"), turnOff));
      render('error', t("整站翻译失败：$1", [String(err?.message || err || t("翻译失败"))]), actions);
    }
    return { update, error, hide, busy, note };
  })();

  function turnOff() {
    stop();
    status.hide(); // 页面已是目标语言时没有会话，提示条要单独收起
    Sites.set(HOST, false).catch(() => {});
  }

  /**
   * 第一次用会花钱的平台整站翻译前的确认。返回 'local'（改用本机翻译）、'continue' 或 'cancel'。
   * 浏览器不支持本机翻译时不出现那个按钮。
   */
  function confirmCost({ providerLabel, localAvailable }) {
    return new Promise((resolve) => {
      const { wrap } = mount();
      const backdrop = document.createElement('div');
      backdrop.className = 'backdrop';
      const dialog = document.createElement('div');
      dialog.className = 'dialog';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      const title = document.createElement('h2');
      title.id = 'huaci-site-title';
      title.textContent = t("翻译整个网站会消耗较多用量");
      dialog.setAttribute('aria-labelledby', title.id);
      const body = document.createElement('p');
      body.textContent = t("开启后，这个网站的页面都会自动翻译，直到你关闭。当前使用「$1」，网页文字多，会消耗较多点数或 API 用量。", [providerLabel]);
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = localAvailable
        ? t("改用本机翻译免费，文字也不离开本机，但译文较直白。以后可以在设置里为整站翻译单独选择平台。")
        : t("以后可以在设置里为整站翻译单独选择平台。");
      const actions = document.createElement('div');
      actions.className = 'actions';
      let done = false;
      const finish = (choice) => {
        if (done) return;
        done = true;
        document.removeEventListener('keydown', onKey, true);
        backdrop.remove();
        resolve(choice);
      };
      const onKey = (event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          finish('cancel');
        }
      };
      document.addEventListener('keydown', onKey, true);
      actions.append(button(t("取消"), () => finish('cancel')));
      const keep = button(t("继续使用$1", [providerLabel]), () => finish('continue'), !localAvailable);
      actions.append(keep);
      let first = keep;
      if (localAvailable) {
        first = button(t("改用本机翻译"), () => finish('local'), true);
        actions.append(first);
      }
      backdrop.addEventListener('click', (event) => {
        if (event.target === backdrop) finish('cancel');
      });
      dialog.append(title, body, hint, actions);
      backdrop.appendChild(dialog);
      wrap.appendChild(backdrop);
      first.focus();
    });
  }

  /* -------------------------------------------------------------- 接线 */

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || message?.type !== 'site-confirm') return false;
    confirmCost({ providerLabel: String(message.providerLabel || ''), localAvailable: Boolean(message.localAvailable) })
      .then((choice) => sendResponse({ choice }));
    return true;
  });

  // 名单变化来自用户刚开或刚关，开启时要在页面上给出反馈
  Sites.onChange((sites) => {
    if (!lifeSignal.aborted) sync(sites, true);
  });

  // 目标语言或整站翻译用的平台变了：恢复原文后按新设置重新翻译
  chrome.storage.onChanged.addListener((changes, area) => {
    if (lifeSignal.aborted || area !== 'local' || !changes.settings || !session) return;
    const next = S.normalize(changes.settings.newValue);
    if (next.target === session.targetId && S.siteProvider(next) === session.providerId) return;
    stop();
    start();
  });

  onRetire(() => {
    stop();
    ui?.host.remove();
  });

  if (HOST) sync();
})();
