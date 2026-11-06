/**
 * 双语阅读页。
 *
 *   来源：网页右键「双语阅读这篇文章」，src/content/reader.js 识别出正文，
 *         后台存进 chrome.storage.session（reader:<id>），本页按 ?id= 读取。
 *   排版：每段原文与译文放在同一行（.pair）里，左右并排时顶端对齐，也可上下对照、只看一边。
 *   翻译：按批调用当前平台（含点数翻译），从上往下逐批填入译文；换目标语言或平台会重翻。
 *   换说法：译文按词切开（Intl.Segmenter），点一个词或选中一段，请当前平台给出几种可以直接替换的说法，
 *         也可以自己改写；换完可以把全文其他相同的地方一起替换。
 *   样式：主题、字体、字号、行距、版心、淡化存进 chrome.storage.local 的 readerStyle，
 *         所有阅读页共用，默认取 huaci.app 的外观。
 *
 * 文章内容只用 textContent 写入；图片只接受 http(s) 地址。
 */
(async () => {
  await AITrI18n.ready;
  const t = (...args) => AITrI18n.t(...args);
  const S = globalThis.AITrSettings;
  const P = globalThis.AITrProviders;
  const A = globalThis.AITrArticle;

  const STYLE_KEY = 'readerStyle';
  const DEFAULTS = Object.freeze({
    theme: 'auto', font: 'sans', size: 16, leading: 1.75, width: 'medium', dim: 'none', mode: 'side',
  });
  const CHOICES = {
    theme: ['auto', 'paper', 'white', 'sepia', 'green', 'night'],
    font: ['sans', 'serif', 'kai'],
    width: ['narrow', 'medium', 'wide'],
    dim: ['none', 'original', 'translated'],
    mode: ['side', 'stack', 'translated', 'original'],
  };
  const RANGES = { size: [13, 26], leading: [1.4, 2.4] };
  /** 同时翻译几批。 */
  const CONCURRENCY = 2;

  const $ = (id) => document.getElementById(id);
  const el = {
    bar: $('bar'), source: $('source'), site: $('site'), status: $('status'),
    progressWrap: $('progressWrap'), progress: $('progress'),
    modes: $('modes'), target: $('target'), provider: $('provider'), run: $('run'),
    styleButton: $('styleButton'), panel: $('panel'), themes: $('themes'),
    size: $('size'), sizeOut: $('sizeOut'), leading: $('leading'), leadingOut: $('leadingOut'),
    reset: $('reset'), settingsLink: $('settings'),
    error: $('error'), errorText: $('errorText'),
    doc: $('doc'), meta: $('meta'), titlePair: $('titlePair'), body: $('body'), endNote: $('endNote'),
    empty: $('empty'),
  };
  const label = (id) => AITrLanguages.label(id);
  const langInfo = (id) => AITrLanguages.LANGUAGES[id] || { dir: 'ltr' };

  let style = { ...DEFAULTS };
  let settings = S.normalize(null);
  let target = settings.target;
  let article = null;
  /** 翻译单元：{ text, node, src, done, out, machine } —— node 放译文，src 是对应的原文元素，machine 是平台给的原译文。 */
  let units = [];
  let runController = null;
  let started = false;

  /* ---------------------------------------------------------------- 样式 */

  function normalizeStyle(value) {
    const next = { ...DEFAULTS };
    for (const [key, list] of Object.entries(CHOICES)) {
      if (list.includes(value?.[key])) next[key] = value[key];
    }
    for (const [key, [min, max]] of Object.entries(RANGES)) {
      const number = Number(value?.[key]);
      if (Number.isFinite(number)) next[key] = Math.min(max, Math.max(min, number));
    }
    return next;
  }

  function applyStyle() {
    const root = document.documentElement;
    root.dataset.theme = style.theme;
    root.dataset.font = style.font;
    root.dataset.width = style.width;
    root.dataset.dim = style.dim;
    root.style.setProperty('--size', `${style.size}px`);
    root.style.setProperty('--leading', String(style.leading));
    for (const mode of CHOICES.mode) document.body.classList.toggle(`mode-${mode}`, style.mode === mode);

    for (const button of el.modes.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.mode === style.mode));
    }
    for (const button of el.themes.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.value === style.theme));
    }
    for (const group of el.panel.querySelectorAll('[data-pref]')) {
      for (const button of group.querySelectorAll('button')) {
        button.setAttribute('aria-pressed', String(button.dataset.value === style[group.dataset.pref]));
      }
    }
    el.size.value = String(style.size);
    el.sizeOut.textContent = `${style.size}px`;
    el.leading.value = String(style.leading);
    el.leadingOut.textContent = style.leading.toFixed(2);
  }

  function setStyle(patch) {
    style = normalizeStyle({ ...style, ...patch });
    applyStyle();
    // 立即保存：改完马上关掉或刷新页面也不会丢
    chrome.storage.local.set({ [STYLE_KEY]: style }).catch(() => {});
  }

  async function loadStyle() {
    try {
      const stored = await chrome.storage.local.get(STYLE_KEY);
      style = normalizeStyle(stored[STYLE_KEY]);
    } catch {
      style = { ...DEFAULTS };
    }
    applyStyle();
  }

  // 别的阅读页改了样式，这里跟着变
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STYLE_KEY]) return;
    const next = normalizeStyle(changes[STYLE_KEY].newValue);
    if (JSON.stringify(next) === JSON.stringify(style)) return;
    style = next;
    applyStyle();
  });

  /* ---------------------------------------------------------------- 状态 */

  function setStatus(text) {
    el.status.textContent = text || '';
  }

  function setProgress(ratio) {
    el.progressWrap.hidden = ratio == null;
    if (ratio != null) el.progress.style.width = `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
  }

  function showError(message, action) {
    el.error.hidden = false;
    el.errorText.textContent = message || t("翻译失败");
    el.error.querySelectorAll('button').forEach((node) => node.remove());
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'link';
    if (action === 'open-options') {
      button.textContent = t("打开设置");
      button.addEventListener('click', () => chrome.runtime.openOptionsPage());
    } else {
      button.textContent = t("重试");
      button.addEventListener('click', () => runAll());
    }
    el.error.appendChild(button);
  }

  function hideError() {
    el.error.hidden = true;
  }

  const doneCount = () => units.filter((unit) => unit.done).length;

  function renderProgress() {
    if (!article) return;
    const done = doneCount();
    const total = units.length;
    if (runController) {
      setStatus(t("正在翻译 $1/$2 段 · $3", [done, total, label(target)]));
      setProgress(total ? done / total : 0);
    } else if (done === total) {
      setStatus(t("已译完 · $1 · 点译文里的词可以换一种说法", [label(target)]));
      setProgress(null);
    } else if (started) {
      setStatus(t("已停止：$1/$2 段已翻译", [done, total]));
      setProgress(null);
    } else {
      setStatus('');
      setProgress(null);
    }
    const busy = Boolean(runController);
    el.run.hidden = !busy && (done === total || !started);
    el.run.textContent = busy ? t("停止") : t("继续翻译");
  }

  /* ---------------------------------------------------------------- 排版 */

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /** 原文元素：标上网页的语言与方向，字体回退与断词才正确。 */
  function source(node) {
    node.classList.add('src');
    if (article.lang) node.lang = article.lang;
    node.dir = article.dir || 'auto';
    return node;
  }

  /** 译文元素：按目标语言标 lang / dir。 */
  function translated(node) {
    node.classList.add('dst');
    node.lang = target;
    node.dir = langInfo(target).dir || 'ltr';
    return node;
  }

  /** 骨架行数大致跟原文长度走：一眼能看出哪段还在翻。 */
  function skeleton(node, text) {
    const lines = Math.max(1, Math.min(6, Math.ceil(String(text).length / 85)));
    const box = make('span', 'skel');
    box.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < lines; i++) box.appendChild(make('i'));
    node.replaceChildren(box);
  }

  /** 登记一个翻译单元；没有可翻译文字（编号、符号）的直接照抄原文。 */
  function unit(node, text, src = null) {
    const item = { text, node, src, done: false, out: '', machine: '' };
    if (!A.translatable(text)) {
      item.done = true;
      item.out = item.machine = text;
      node.textContent = text;
    } else {
      skeleton(node, text);
    }
    units.push(item);
    return item;
  }

  function paint(item) {
    if (!item.done) {
      skeleton(item.node, item.text);
      return;
    }
    picker.paint(item, { fresh: true });
  }

  function renderHead() {
    const parts = [article.siteName, article.byline, formatDate(article.publishedTime)].filter(Boolean);
    el.meta.replaceChildren(...parts.map((part) => make('span', '', part)));
    el.titlePair.replaceChildren();
    const title = article.title || article.siteName || '';
    el.titlePair.append(source(make('div')), translated(make('div')));
    const srcTitle = make('h1', '', title);
    el.titlePair.firstChild.appendChild(srcTitle);
    const h1 = make('h1');
    el.titlePair.lastChild.appendChild(h1);
    unit(h1, title, srcTitle);
  }

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    try {
      return new Intl.DateTimeFormat(AITrI18n.locale(), { dateStyle: 'medium' }).format(date);
    } catch {
      return '';
    }
  }

  function textPair(type, tag, text, extra) {
    const pair = make('div', 'pair');
    pair.dataset.type = type;
    const src = source(make(tag, extra?.className, text));
    const dst = translated(make(tag, extra?.className));
    for (const node of [src, dst]) extra?.decorate?.(node);
    pair.append(src, dst);
    unit(dst, text, src);
    return pair;
  }

  function imagePair(block) {
    const pair = make('figure', 'pair wide figure');
    pair.dataset.type = 'img';
    const media = make('div', 'media');
    const img = document.createElement('img');
    img.alt = block.alt || '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => {
      // 防盗链或失效的图片：没有图注就整块去掉，有图注只去掉图片
      if (block.text) media.remove();
      else pair.remove();
    }, { once: true });
    img.src = block.src;
    media.appendChild(img);
    pair.appendChild(media);
    if (block.text) {
      const src = source(make('figcaption', 'cap', block.text));
      pair.append(src);
      const dst = translated(make('figcaption', 'cap'));
      pair.appendChild(dst);
      unit(dst, block.text, src);
    }
    return pair;
  }

  function tablePair(block) {
    const pair = make('div', 'pair table');
    pair.dataset.type = 'table';
    const srcCells = [];
    const build = (side) => {
      const wrap = make('div', 'table-wrap');
      const table = make('table');
      const body = make('tbody');
      block.rows.forEach((row, r) => {
        const tr = make('tr');
        if (side === 'src') srcCells[r] = [];
        row.forEach((cell, col) => {
          const td = make(r === 0 ? 'th' : 'td');
          if (side === 'src') { td.textContent = cell; srcCells[r][col] = td; }
          else if (cell) unit(td, cell, srcCells[r]?.[col] || null);
          tr.appendChild(td);
        });
        body.appendChild(tr);
      });
      table.appendChild(body);
      wrap.appendChild(table);
      return side === 'src' ? source(wrap) : translated(wrap);
    };
    pair.append(build('src'), build('dst'));
    return pair;
  }

  function renderBlock(block) {
    switch (block.type) {
      case 'h2':
      case 'h3':
      case 'h4':
        return textPair(block.type, block.type, block.text);
      case 'p':
        return textPair('p', 'p', block.text);
      case 'quote':
        return textPair('quote', 'blockquote', block.text);
      case 'li':
        return textPair('li', 'div', block.text, {
          className: 'li',
          decorate: (node) => {
            node.style.setProperty('--depth', String(Number(block.depth) || 0));
            node.dataset.marker = block.ordered ? `${Number(block.index) || 1}.` : (block.depth ? '◦' : '•');
          },
        });
      case 'code': {
        const pair = make('div', 'pair wide code');
        pair.dataset.type = 'code';
        const pre = make('pre', 'full');
        pre.textContent = block.text;
        pre.dir = 'ltr';
        pair.appendChild(pre);
        return pair;
      }
      case 'img':
        return /^https?:\/\//i.test(String(block.src || '')) ? imagePair(block) : null;
      case 'table':
        return Array.isArray(block.rows) ? tablePair(block) : null;
      case 'hr': {
        const pair = make('div', 'pair wide');
        pair.dataset.type = 'hr';
        pair.appendChild(make('hr', 'full'));
        return pair;
      }
      default:
        return null;
    }
  }

  function renderArticle() {
    units = [];
    renderHead();
    const fragment = document.createDocumentFragment();
    for (const block of article.blocks) {
      if (!block || typeof block !== 'object') continue;
      const node = renderBlock({ ...block, text: String(block.text ?? '') });
      if (node) fragment.appendChild(node);
    }
    el.body.replaceChildren(fragment);

    const url = safeUrl(article.url);
    el.endNote.replaceChildren();
    if (url) {
      el.endNote.append(t("原文："), ' ');
      const link = make('a', '', url.length > 90 ? `${url.slice(0, 87)}…` : url);
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      el.endNote.appendChild(link);
    }
    if (article.truncated) {
      el.endNote.append(make('br'), t("文章太长，只显示了前面的部分。"));
    }
  }

  function safeUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
    } catch {
      return '';
    }
  }

  /* ---------------------------------------------------------------- 翻译 */

  /** 从当前看到的位置开始翻：先翻屏幕上和下面的，再回头翻上面的。 */
  function orderedPending() {
    const pending = units.filter((item) => !item.done);
    const firstVisible = pending.findIndex((item) => item.node.getBoundingClientRect().bottom > 0);
    if (firstVisible <= 0) return pending;
    return [...pending.slice(firstVisible), ...pending.slice(0, firstVisible)];
  }

  async function runAll() {
    if (!article || runController) return;
    const controller = new AbortController();
    runController = controller;
    started = true;
    hideError();
    renderProgress();
    const requestSettings = S.normalize({ ...settings, target });
    const requestTarget = target;
    const pending = orderedPending();
    const queue = A.batches(pending).map((group) => group.map((index) => pending[index]));
    let failure = null;

    const worker = async () => {
      while (queue.length && !controller.signal.aborted && !failure) {
        const group = queue.shift();
        try {
          const texts = group.map((item) => item.text);
          const result = await P.translateBatch({ texts, settings: requestSettings, targetId: requestTarget, signal: controller.signal });
          if (controller.signal.aborted) return;
          if (!Array.isArray(result) || result.length !== texts.length) {
            throw new Error(t("翻译结果的段数不对，重试或换个模型试试"));
          }
          group.forEach((item, k) => {
            item.out = String(result[k] ?? '').trim() || item.text;
            item.machine = item.out;
            item.done = true;
            paint(item);
          });
        } catch (err) {
          if (controller.signal.aborted || err?.name === 'AbortError') return;
          // 缺 Key、点数不足、限频会让每一批都失败：整体停下，已翻好的保留
          failure = err;
        }
        if (runController === controller) renderProgress();
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (runController !== controller) return;
    runController = null;
    if (failure) showError(String(failure?.message || failure) || t("翻译失败"), failure?.action);
    renderProgress();
  }

  function stop() {
    picker.close();
    runController?.abort();
    runController = null;
    renderProgress();
  }

  /** 换了目标语言或平台：清掉译文，重新排版再翻。 */
  function restart() {
    if (!article) return;
    stop();
    picker.reset();
    started = false;
    renderArticle();
    runAll();
  }

  /* ---------------------------------------------------------------- 换说法 */

  // 点译文里的词换说法，换过的记成用词偏好（见 lib/word-picker.js、lib/terms.js）
  const picker = AITrWordPicker.create({
    root: document,
    mount: document.body,
    units: () => units.filter((item) => item.done),
    target: () => target,
    cacheKey: () => settings.provider,
    request: (args) => P.alternatives({
      ...args, settings: S.normalize({ ...settings, target }), targetId: target, noteId: AITrI18n.locale(),
    }),
    remember: (entry) => AITrTerms.remember(entry),
    forget: (entry) => AITrTerms.forget(entry.id),
  });

  /* ---------------------------------------------------------------- 控件 */

  function renderTargetOptions() {
    el.target.replaceChildren(...S.targetList().map((item) => {
      const option = make('option', '', label(item.id));
      option.value = item.id;
      return option;
    }));
    el.target.value = target;
  }

  function renderProviderOptions() {
    el.provider.replaceChildren(...S.providerList().map((item) => {
      const option = make('option', '', item.label);
      option.value = item.id;
      return option;
    }));
    el.provider.value = settings.provider;
  }

  function togglePanel(open = el.panel.hidden) {
    el.panel.hidden = !open;
    el.styleButton.setAttribute('aria-expanded', String(open));
  }

  for (const button of el.modes.querySelectorAll('button')) {
    button.addEventListener('click', () => setStyle({ mode: button.dataset.mode }));
  }
  for (const button of el.themes.querySelectorAll('button')) {
    button.addEventListener('click', () => setStyle({ theme: button.dataset.value }));
  }
  for (const group of el.panel.querySelectorAll('[data-pref]')) {
    for (const button of group.querySelectorAll('button')) {
      button.addEventListener('click', () => setStyle({ [group.dataset.pref]: button.dataset.value }));
    }
  }
  el.size.addEventListener('input', () => setStyle({ size: Number(el.size.value) }));
  el.leading.addEventListener('input', () => setStyle({ leading: Number(el.leading.value) }));
  for (const button of el.panel.querySelectorAll('.step')) {
    button.addEventListener('click', () => {
      const key = button.dataset.target;
      const next = Math.round((style[key] + Number(button.dataset.step)) * 100) / 100;
      setStyle({ [key]: next });
    });
  }
  el.reset.addEventListener('click', () => setStyle({ ...DEFAULTS, mode: style.mode }));
  el.settingsLink.addEventListener('click', () => chrome.runtime.openOptionsPage());
  el.styleButton.addEventListener('click', (event) => {
    event.stopPropagation();
    togglePanel();
  });
  document.addEventListener('click', (event) => {
    if (!el.panel.hidden && !el.panel.contains(event.target)) togglePanel(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !el.panel.hidden) {
      togglePanel(false);
      el.styleButton.focus();
    }
  });
  el.run.addEventListener('click', () => (runController ? stop() : runAll()));
  el.target.addEventListener('change', () => {
    target = el.target.value;
    restart();
  });
  el.provider.addEventListener('change', async () => {
    settings = await S.patchSettings({ provider: el.provider.value });
    restart();
  });

  // 滚动后顶栏加一道底边
  const sentinel = make('div');
  sentinel.style.cssText = 'position:absolute;top:0;height:1px;width:1px';
  document.body.prepend(sentinel);
  new IntersectionObserver(([entry]) => el.bar.classList.toggle('stuck', !entry.isIntersecting)).observe(sentinel);

  AITrI18n.onChange(() => {
    renderTargetOptions();
    renderProviderOptions();
    renderProgress();
  });

  /* -------------------------------------------------------------- 初始化 */

  await loadStyle();
  settings = await S.loadSettings();
  target = settings.target;
  renderTargetOptions();
  renderProviderOptions();

  const id = new URLSearchParams(location.search).get('id') || '';
  let stored = null;
  if (/^[\w-]{8,64}$/.test(id)) {
    try {
      stored = (await chrome.storage.session.get(`reader:${id}`))[`reader:${id}`] || null;
    } catch {
      stored = null;
    }
  }
  if (!stored || !Array.isArray(stored.blocks)) {
    el.empty.hidden = false;
    el.modes.hidden = true;
    return;
  }

  article = {
    url: safeUrl(stored.url),
    title: String(stored.title || ''),
    byline: String(stored.byline || ''),
    siteName: String(stored.siteName || ''),
    publishedTime: String(stored.publishedTime || ''),
    lang: /^[a-z]{2,3}(-[\w]{2,8})*$/i.test(String(stored.lang || '')) ? stored.lang : '',
    dir: stored.dir === 'rtl' ? 'rtl' : 'ltr',
    blocks: stored.blocks,
    truncated: Boolean(stored.truncated),
  };
  document.title = `${article.title || article.siteName} · ${t("双语阅读")}`;
  el.site.textContent = article.siteName || (article.url ? new URL(article.url).hostname : t("双语阅读"));
  if (article.url) el.source.href = article.url;
  el.doc.hidden = false;
  renderArticle();
  runAll();
})();
