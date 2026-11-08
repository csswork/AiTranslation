/**
 * 点词换说法（类似 DeepL）：译文按词切开，悬停托起，点一个词或拖选几个词，弹出其他译法；
 * 可以自己改写，替换后提议把全文同样的词一起换掉，并把这次改动记成用词偏好（见 terms.js），之后翻译优先使用。
 *
 * 双语阅读、划词弹窗（内容脚本的 Shadow DOM 里）、翻译面板、整份 PDF 共用这一份。调用方负责：
 *   - 译文单元 unit：{ node, text, out, machine, src? } —— node 放译文，text 是原文，out 当前译文，
 *     machine 平台给的原译文，src 是原文元素（可选，用来标出对应的原文词语）；
 *   - request(args)：取其他译法（扩展页面直接调 AITrProviders.alternatives，内容脚本经 service worker）；
 *   - remember / forget：保存、撤销用词偏好（可选）。
 * 弹窗与提示条用 position: fixed，放在 mount 里（扩展页面是 body，内容脚本是 Shadow DOM 里的一个节点）。
 * 配色取 --wp-* 变量，没有时按系统浅色 / 深色给默认值。与 lang.js 一样不能使用 import / export。
 */
(() => {
  if (globalThis.AITrWordPicker) return;
  const t = (...args) => AITrI18n.t(...args);
  const MAX_SELECTED = 200;
  const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u;

  const STYLE = `
    .wp-w { border-radius: 3px; cursor: pointer; transition: background-color .12s ease, box-shadow .12s ease; }
    .wp-w:hover { background: color-mix(in srgb, var(--wp-accent, #4a4fc0) 13%, transparent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--wp-accent, #4a4fc0) 13%, transparent); }
    .wp-w.wp-picked { background: color-mix(in srgb, var(--wp-accent, #4a4fc0) 22%, transparent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--wp-accent, #4a4fc0) 22%, transparent); }
    .wp-w.wp-changed { animation: wp-changed 1.6s ease; }
    @keyframes wp-changed { from { background: color-mix(in srgb, var(--wp-accent, #4a4fc0) 34%, transparent); } }
    .wp-fresh { animation: wp-fade .45s ease; }
    @keyframes wp-fade { from { opacity: 0; } }
    mark.wp-mark {
      color: inherit; border-radius: 3px;
      background: color-mix(in srgb, var(--wp-accent, #4a4fc0) 16%, transparent);
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--wp-accent, #4a4fc0) 16%, transparent);
    }
    .wp-alt, .wp-toast {
      --_surface: var(--wp-surface, #fdfcf9); --_surface-2: var(--wp-surface-2, #efede7); --_line: var(--wp-line, #e4e1d8);
      --_text: var(--wp-text, #1d1c19); --_muted: var(--wp-text-3, #736f65); --_accent: var(--wp-accent, #4a4fc0);
      --_err: var(--wp-err, #b42318); --_shadow: var(--wp-shadow, rgba(60, 48, 28, .18));
      --_skel: var(--wp-skel, rgba(60, 50, 30, .08)); --_skel-hi: var(--wp-skel-hi, rgba(60, 50, 30, .03));
      box-sizing: border-box; pointer-events: auto; text-align: start;
      font: 14px/1.5 var(--wp-font, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif);
      letter-spacing: normal; text-transform: none; white-space: normal;
    }
    @media (prefers-color-scheme: dark) {
      .wp-alt, .wp-toast {
        --_surface: var(--wp-surface, #191917); --_surface-2: var(--wp-surface-2, #26251f); --_line: var(--wp-line, #2b2a27);
        --_text: var(--wp-text, #ecebe6); --_muted: var(--wp-text-3, #85827a); --_accent: var(--wp-accent, #8b8ef0);
        --_err: var(--wp-err, #fca5a5); --_shadow: var(--wp-shadow, rgba(0, 0, 0, .7));
        --_skel: var(--wp-skel, rgba(255, 255, 255, .07)); --_skel-hi: var(--wp-skel-hi, rgba(255, 255, 255, .02));
      }
    }
    .wp-alt *, .wp-toast * { box-sizing: border-box; }
    .wp-alt[hidden], .wp-toast[hidden], .wp-alt [hidden] { display: none !important; }
    .wp-alt {
      position: fixed; z-index: 2147483647; width: min(320px, calc(100vw - 24px));
      padding: 10px 10px 8px; border-radius: 12px; border: 1px solid var(--_line);
      background: var(--_surface); color: var(--_text);
      box-shadow: 0 16px 44px -12px var(--_shadow), 0 2px 6px -2px var(--_shadow);
      animation: wp-in .14s ease;
    }
    @keyframes wp-in { from { opacity: 0; transform: translateY(-4px); } }
    .wp-head { margin: 0 4px 6px; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; }
    .wp-picked-text { font-weight: 650; }
    .wp-source { font-size: 12px; color: var(--_muted); }
    .wp-list { display: grid; gap: 1px; }
    .wp-opt {
      display: grid; grid-template-columns: auto 1fr; align-items: baseline; gap: 10px;
      width: 100%; margin: 0; padding: 6px 8px; cursor: pointer; text-align: start;
      border: 0; border-radius: 7px; background: transparent; color: inherit; font: inherit;
    }
    .wp-opt:hover, .wp-opt:focus-visible { background: var(--_surface-2); outline: none; }
    .wp-opt b { font-weight: 560; }
    .wp-opt span { font-size: 12px; color: var(--_muted); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .wp-opt.wp-loading { cursor: default; }
    .wp-opt.wp-loading i {
      display: block; height: .8em; border-radius: 4px; grid-column: 1 / -1;
      background: linear-gradient(90deg, var(--_skel) 0%, var(--_skel-hi) 45%, var(--_skel) 90%);
      background-size: 220% 100%; animation: wp-skel 1.3s ease-in-out infinite;
    }
    .wp-opt.wp-loading:nth-child(2) i { width: 72%; }
    .wp-opt.wp-loading:nth-child(3) i { width: 56%; }
    @keyframes wp-skel { from { background-position: 120% 0; } to { background-position: -120% 0; } }
    .wp-msg { margin: 4px 8px 0; font-size: 12.5px; color: var(--_muted); }
    .wp-msg:empty { display: none; }
    .wp-msg.wp-err { color: var(--_err); }
    .wp-own { display: flex; gap: 6px; margin: 8px 0 0; padding-top: 8px; border-top: 1px solid var(--_line); }
    .wp-own input {
      flex: 1; min-width: 0; margin: 0; font: inherit; font-size: 13px; padding: 5px 9px; color: inherit;
      border-radius: 8px; border: 1px solid var(--_line); background: transparent;
    }
    .wp-own input:focus { outline: 2px solid var(--_accent); outline-offset: 0; border-color: transparent; }
    .wp-btn {
      font: inherit; font-size: 13px; font-weight: 550; cursor: pointer; margin: 0;
      padding: 5px 11px; border-radius: 8px; color: var(--_accent); background: transparent; border: 1px solid var(--_line);
    }
    .wp-btn:hover { background: var(--_surface-2); }
    .wp-link {
      border: 0; background: none; padding: 2px 0; margin: 6px 8px 0; cursor: pointer;
      font: inherit; font-size: 12px; color: var(--_accent);
    }
    .wp-link:hover { text-decoration: underline; text-underline-offset: 3px; }
    .wp-toast {
      position: fixed; left: 50%; bottom: 24px; z-index: 2147483647; transform: translateX(-50%);
      display: flex; align-items: center; flex-wrap: wrap; gap: 6px 14px; max-width: min(620px, calc(100vw - 32px));
      padding: 9px 10px 9px 16px; border-radius: 12px;
      background: var(--_text); color: var(--_surface); font-size: 13px;
      box-shadow: 0 12px 32px -10px var(--_shadow);
      animation: wp-in .18s ease;
    }
    .wp-toast-text { flex: 1 1 220px; }
    .wp-toast .wp-link { margin: 0; color: inherit; font-size: 13px; font-weight: 650; text-decoration: underline; text-underline-offset: 3px; white-space: nowrap; }
    .wp-toast-close { border: 0; background: none; color: inherit; opacity: .6; cursor: pointer; font-size: 17px; line-height: 1; padding: 2px 4px; }
    .wp-toast-close:hover { opacity: 1; }
    @media (prefers-reduced-motion: reduce) {
      .wp-alt, .wp-toast, .wp-w.wp-changed, .wp-fresh, .wp-opt.wp-loading i { animation: none; }
    }
  `;

  function make(doc, tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /** 西文按整词匹配，中日韩、泰文等不分词的文字按字面匹配。 */
  function termPattern(term) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (UNSPACED.test(term)) return new RegExp(escaped, 'gu');
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'gu');
  }

  /**
   * @param {object} options
   * @param {Document|ShadowRoot} options.root      监听点击、放样式的根
   * @param {Element} options.mount                 放弹窗与提示条的节点
   * @param {() => object[]} options.units          所有译文单元（全部替换时用）
   * @param {() => string} options.target           目标语言 ID
   * @param {(args) => Promise<{source, options}>} options.request
   * @param {(entry) => Promise<object|null>} [options.remember]
   * @param {(entry) => Promise<void>} [options.forget]
   * @param {(unit) => void} [options.onChange]     译文改动后（同步复制内容、重新排版等）
   * @param {string} [options.cacheKey]             平台等会影响结果的因素，变化时缓存失效
   * @param {() => boolean} [options.enabled]       当前平台支持换说法吗；不支持时译文按纯文字显示，没有可点的词
   */
  function create(options) {
    const { root, mount } = options;
    const doc = root.ownerDocument || root;
    const win = doc.defaultView || globalThis;
    const unitOfNode = new WeakMap();
    /** 同一段、同一位置、同一译文只请求一次：点数翻译每次都扣点。缓存的是请求本身。 */
    const cache = new Map();
    let picking = null;
    let toastTimer = 0;
    let segmenter = null;

    const style = make(doc, 'style');
    style.textContent = STYLE;
    (root.head || root).appendChild(style);

    const alt = make(doc, 'div', 'wp-alt');
    alt.hidden = true;
    alt.setAttribute('role', 'dialog');
    alt.setAttribute('aria-label', t("其他译法"));
    const head = make(doc, 'p', 'wp-head');
    const pickedText = make(doc, 'span', 'wp-picked-text');
    const sourceText = make(doc, 'span', 'wp-source');
    head.append(pickedText, sourceText);
    const list = make(doc, 'div', 'wp-list');
    list.setAttribute('role', 'listbox');
    const message = make(doc, 'p', 'wp-msg');
    message.setAttribute('aria-live', 'polite');
    const own = make(doc, 'form', 'wp-own');
    const input = make(doc, 'input');
    input.type = 'text';
    input.maxLength = MAX_SELECTED;
    input.autocomplete = 'off';
    input.placeholder = t("自己改写…");
    input.setAttribute('aria-label', t("自己改写"));
    const submit = make(doc, 'button', 'wp-btn', t("替换"));
    submit.type = 'submit';
    own.append(input, submit);
    const restore = make(doc, 'button', 'wp-link', t("恢复这一段的原译文"));
    restore.type = 'button';
    alt.append(head, list, message, own, restore);

    const toast = make(doc, 'div', 'wp-toast');
    toast.hidden = true;
    toast.setAttribute('role', 'status');
    const toastText = make(doc, 'span', 'wp-toast-text');
    const toastActions = make(doc, 'span');
    toastActions.style.cssText = 'display:flex;gap:14px;align-items:center';
    const toastClose = make(doc, 'button', 'wp-toast-close', '×');
    toastClose.type = 'button';
    toastClose.setAttribute('aria-label', t("关闭"));
    toast.append(toastText, toastActions, toastClose);
    mount.append(alt, toast);

    const target = () => options.target();
    const langDir = () => globalThis.AITrLanguages?.LANGUAGES?.[target()]?.dir || 'ltr';

    function words(text) {
      const locale = target();
      if (!segmenter || segmenter.locale !== locale) {
        let impl;
        try { impl = new Intl.Segmenter(locale, { granularity: 'word' }); } catch { impl = new Intl.Segmenter(undefined, { granularity: 'word' }); }
        segmenter = { locale, impl };
      }
      return segmenter.impl.segment(text);
    }

    /** 译文按词切开：每个词一个 span（记下在译文里的起止位置），空格与标点保持纯文字。 */
    const enabled = () => !options.enabled || options.enabled();

    function paint(unit, { fresh = false, changed = null } = {}) {
      if (!enabled()) {
        unitOfNode.delete(unit.node);
        if (fresh) {
          const wrap = make(doc, 'span', 'wp-fresh', unit.out);
          unit.node.replaceChildren(wrap);
        } else {
          unit.node.textContent = unit.out;
        }
        return;
      }
      unitOfNode.set(unit.node, unit);
      const fragment = doc.createDocumentFragment();
      for (const { segment, index, isWordLike } of words(unit.out)) {
        if (!isWordLike) { fragment.append(segment); continue; }
        const span = make(doc, 'span', 'wp-w', segment);
        span.dataset.s = String(index);
        span.dataset.e = String(index + segment.length);
        if (changed && index < changed[1] && index + segment.length > changed[0]) span.classList.add('wp-changed');
        fragment.appendChild(span);
      }
      if (fresh) {
        const wrap = make(doc, 'span', 'wp-fresh');
        wrap.appendChild(fragment);
        unit.node.replaceChildren(wrap);
      } else {
        unit.node.replaceChildren(fragment);
      }
    }

    function unitOf(node) {
      let current = node?.nodeType === 1 ? node : node?.parentNode;
      while (current && current !== root) {
        const unit = unitOfNode.get(current);
        if (unit) return unit;
        current = current.parentNode;
      }
      return null;
    }

    function offsetIn(unit, container, offset) {
      const range = doc.createRange();
      range.setStart(unit.node, 0);
      range.setEnd(container, offset);
      return range.toString().length;
    }

    function markSource(unit, term) {
      if (!unit.src || !term) return;
      const text = unit.src.textContent;
      const at = text.toLowerCase().indexOf(term.toLowerCase());
      if (at < 0) return;
      unit.srcText = text;
      unit.src.replaceChildren(text.slice(0, at), make(doc, 'mark', 'wp-mark', text.slice(at, at + term.length)), text.slice(at + term.length));
    }

    function unmarkSource(unit) {
      if (unit?.srcText != null) {
        unit.src.textContent = unit.srcText;
        delete unit.srcText;
      }
    }

    function close() {
      if (!picking) return;
      const { unit } = picking;
      unit.node.querySelectorAll('.wp-picked').forEach((span) => span.classList.remove('wp-picked'));
      unmarkSource(unit);
      picking = null;
      alt.hidden = true;
    }

    /** 弹窗放在选中文字下方，放不下就放上方；页面滚动时跟着锚点走。 */
    function place() {
      if (!picking) return;
      const rect = picking.anchor();
      if (!rect || (!rect.width && !rect.height)) return;
      const width = alt.offsetWidth;
      const height = alt.offsetHeight;
      const left = Math.max(12, Math.min(rect.left, win.innerWidth - width - 12));
      const below = rect.bottom + 8;
      const top = below + height > win.innerHeight - 12 && rect.top - height - 8 > 12 ? rect.top - height - 8 : below;
      alt.style.left = `${left}px`;
      alt.style.top = `${top}px`;
    }

    function setMessage(text, error = false) {
      message.textContent = text || '';
      message.classList.toggle('wp-err', error);
    }

    function renderOptions(items) {
      list.replaceChildren(...items.map((option) => {
        const button = make(doc, 'button', 'wp-opt');
        button.type = 'button';
        button.setAttribute('role', 'option');
        const value = make(doc, 'b', '', option.text);
        value.lang = target();
        value.dir = langDir();
        button.append(value, make(doc, 'span', '', option.note || ''));
        if (option.note) button.title = option.note;
        button.addEventListener('click', () => apply(option.text));
        return button;
      }));
    }

    function renderLoading() {
      list.replaceChildren(...[0, 1, 2].map(() => {
        const row = make(doc, 'div', 'wp-opt wp-loading');
        row.appendChild(make(doc, 'i'));
        return row;
      }));
    }

    async function open(unit, start, end, anchor) {
      while (start < end && /\s/.test(unit.out[start])) start++;
      while (end > start && /\s/.test(unit.out[end - 1])) end--;
      if (end <= start) return;
      // 双击选词会连着触发两次：同一处已经开着就不再请求
      if (picking && picking.unit === unit && picking.start === start && picking.end === end) return;
      close();
      if (end - start > MAX_SELECTED) {
        showToast(t("选中的文字太长，请选一个词或短语。"));
        return;
      }
      const selected = unit.out.slice(start, end);
      const token = {};
      picking = { unit, start, end, selected, anchor, token, source: '' };
      for (const span of unit.node.querySelectorAll('.wp-w')) {
        if (Number(span.dataset.s) < end && Number(span.dataset.e) > start) span.classList.add('wp-picked');
      }
      pickedText.textContent = selected;
      pickedText.lang = target();
      sourceText.textContent = '';
      input.value = selected;
      input.dir = langDir();
      restore.hidden = unit.out === unit.machine;
      setMessage(t("正在找其他译法…"));
      renderLoading();
      alt.hidden = false;
      place();

      const key = JSON.stringify([options.cacheKey?.() || '', target(), unit.text, unit.out, start, end]);
      try {
        let pending = cache.get(key);
        if (!pending) {
          pending = options.request({ source: unit.text, translation: unit.out, start, end });
          cache.set(key, pending);
          pending.catch(() => cache.delete(key));
        }
        const result = await pending;
        if (picking?.token !== token) return;
        picking.source = result.source || '';
        if (result.source) {
          sourceText.textContent = t("原文：$1", [result.source]);
          markSource(unit, result.source);
        }
        renderOptions(result.options || []);
        setMessage(result.options?.length ? '' : t("没有找到更合适的说法，可以在下面自己改写。"));
        place();
        list.querySelector('button')?.focus({ preventScroll: true });
      } catch (err) {
        if (picking?.token !== token || err?.name === 'AbortError') return;
        list.replaceChildren();
        setMessage(String(err?.message || err) || t("翻译失败"), err?.action !== 'unsupported');
        place();
        input.focus({ preventScroll: true });
        input.select();
      }
    }

    async function apply(replacement) {
      if (!picking) return;
      const { unit, start, end, selected, source } = picking;
      const value = String(replacement || '').replace(/\s+/g, ' ').trim();
      close();
      if (!value || value === selected) return;
      unit.out = unit.out.slice(0, start) + value + unit.out.slice(end);
      paint(unit, { changed: [start, start + value.length] });
      options.onChange?.(unit);

      // 记成用词偏好：只有知道对应的原文词语时才记（DeepL 等拿不到对应关系）
      let saved = null;
      if (source && options.remember) {
        try { saved = await options.remember({ source, from: selected, to: value, target: target() }); } catch { saved = null; }
      }

      // 同一个词在别处也这样译的，提议一起换掉（术语前后一致）
      const pattern = termPattern(selected);
      const others = options.units().filter((other) => other.out && other.out.match(pattern));
      const count = others.reduce((sum, other) => sum + other.out.match(pattern).length, 0);
      const parts = [t("已替换为「$1」", [value])];
      if (saved) parts.push(t("以后翻译「$1」会优先用这个译法", [source]));
      if (count) parts.push(t("别处还有 $1 处「$2」", [count, selected]));
      const actions = [];
      if (count) {
        actions.push({ label: t("全部替换"), run: () => {
          for (const other of others) {
            const offsets = [];
            other.out = other.out.replace(pattern, (match, offset) => { offsets.push(offset); return value; });
            paint(other, { changed: [Math.min(...offsets), Math.max(...offsets) + value.length] });
            options.onChange?.(other);
          }
          showToast(t("已替换 $1 处", [count]));
        } });
      }
      if (saved && options.forget) {
        actions.push({ label: t("不要记住"), run: async () => {
          await options.forget(saved);
          showToast(t("已取消这个用词偏好"));
        } });
      }
      showToast(parts.join(' · '), actions);
    }

    function showToast(text, actions = []) {
      clearTimeout(toastTimer);
      toastText.textContent = text;
      toastActions.replaceChildren(...actions.map((action) => {
        const button = make(doc, 'button', 'wp-link', action.label);
        button.type = 'button';
        button.addEventListener('click', () => { action.run(); });
        return button;
      }));
      toastActions.hidden = !actions.length;
      toast.hidden = false;
      toastTimer = setTimeout(() => { toast.hidden = true; }, actions.length ? 9000 : 3200);
    }
    toastClose.addEventListener('click', () => { clearTimeout(toastTimer); toast.hidden = true; });

    own.addEventListener('submit', (event) => {
      event.preventDefault();
      apply(input.value);
    });
    restore.addEventListener('click', () => {
      if (!picking) return;
      const { unit } = picking;
      close();
      unit.out = unit.machine;
      paint(unit, { changed: [0, unit.out.length] });
      options.onChange?.(unit);
    });
    alt.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const buttons = [...list.querySelectorAll('button')];
      if (!buttons.length) return;
      event.preventDefault();
      const active = root.activeElement || doc.activeElement;
      const at = buttons.indexOf(active);
      const next = event.key === 'ArrowDown' ? (at + 1) % buttons.length : (at - 1 + buttons.length) % buttons.length;
      buttons[next].focus();
    });

    // 点一个词，或在一段译文里选中几个词（Shadow DOM 里的选区要从根上取）
    root.addEventListener('click', (event) => {
      if (alt.contains(event.target) || toast.contains(event.target)) return;
      if (!enabled()) return;
      const selection = typeof root.getSelection === 'function' ? root.getSelection() : win.getSelection();
      if (selection && !selection.isCollapsed && selection.rangeCount) {
        const range = selection.getRangeAt(0);
        const unit = unitOf(range.startContainer);
        if (unit && unitOf(range.endContainer) === unit) {
          const start = offsetIn(unit, range.startContainer, range.startOffset);
          const end = offsetIn(unit, range.endContainer, range.endOffset);
          const anchorRange = range.cloneRange();
          selection.removeAllRanges();
          open(unit, start, end, () => anchorRange.getBoundingClientRect());
          return;
        }
      }
      const word = event.target.closest?.('.wp-w');
      const unit = word && unitOf(word);
      if (!unit || event.detail > 1) {
        if (picking && !word) close();
        return;
      }
      event.stopPropagation();
      const start = Number(word.dataset.s);
      const end = Number(word.dataset.e);
      if (picking?.unit === unit && picking.start === start && picking.end === end) { close(); return; }
      open(unit, start, end, () => word.getBoundingClientRect());
    });
    // Esc 只关弹窗，不让外层（划词弹窗、阅读页面板）跟着关
    const onKey = (event) => {
      if (event.key !== 'Escape' || !picking) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      close();
    };
    win.addEventListener('keydown', onKey, true);
    let frame = 0;
    const follow = () => {
      if (!picking || frame) return;
      frame = win.requestAnimationFrame(() => { frame = 0; place(); });
    };
    win.addEventListener('scroll', follow, true);
    win.addEventListener('resize', follow);

    return {
      paint,
      close,
      /** 换了平台或语言、重新翻译：清掉缓存与弹窗。 */
      reset() { close(); cache.clear(); },
      isOpen: () => Boolean(picking),
      destroy() {
        close();
        clearTimeout(toastTimer);
        alt.remove(); toast.remove(); style.remove();
        win.removeEventListener('keydown', onKey, true);
        win.removeEventListener('scroll', follow, true);
        win.removeEventListener('resize', follow);
      },
    };
  }

  globalThis.AITrWordPicker = { create, termPattern };
})();
