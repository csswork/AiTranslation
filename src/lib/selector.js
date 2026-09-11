/**
 * 为右键选中的元素生成一个可复用的 CSS 选择器。
 *
 * 目标不是「精确定位这一个节点」，而是「下次访问这个站点时还能匹配到同类元素」。
 * 所以要避开框架生成的随机类名，也要避免过于宽泛而匹配到满页元素。
 *
 * 不能出现 import / export（内容脚本与管理页都要用）。
 */
(() => {
  /** 匹配数量超过这个值就认为太宽泛，需要再加限定。 */
  const MAX_MATCHES = 40;
  const MAX_CLASSES = 3;
  /** 固定几级父元素。只靠元素自身太粗，页面别处同类名的元素会被误挂按钮。 */
  const PARENT_LEVELS = 2;

  /**
   * 构建工具生成的类名下次访问就变了，不能拿来记规则。
   * 例如 css-1a2b3c、sc-bdVaJa、Button__root___2xYz。
   */
  const UNSTABLE = [
    // 前缀 + 哈希：css-1a2b3c。后缀必须字母数字混杂才算哈希，
    // 否则会误杀 main-content、post-title 这类最常见的稳定命名。
    /^[a-z]+[-_](?=[a-z0-9]*\d)(?=[a-z0-9]*[a-z])[a-z0-9]{5,}$/i,
    // CSS-in-JS 的固定前缀 + 长后缀：sc-bdVaJa（这种后缀不含数字，上一条抓不到）
    /^(css|sc|jsx|emotion|styled|svelte)-[a-z0-9]{5,}$/i,
    // CSS Modules：Button__root___2xYz
    /__[0-9a-z]{4,}$/i,
    /--[0-9a-z]{5,}$/i,
    // 自动生成的 id：ember1234
    /^[a-z-]*[a-z]\d{3,}$/i,
    // 前缀 + 纯数字序号：radix-3421、item-1024
    /^[a-z]+[-_]\d{3,}$/i,
    /\d{5,}/,
  ];

  const isStable = (name) =>
    typeof name === 'string' &&
    name.length > 1 &&
    name.length <= 40 &&
    !UNSTABLE.some((re) => re.test(name));

  const esc = (value) =>
    globalThis.CSS && typeof CSS.escape === 'function'
      ? CSS.escape(value)
      : String(value).replace(/[^\w-]/g, '\\$&');

  /** 一个元素自身的候选选择器，由具体到宽泛。 */
  function ownCandidates(el) {
    const tag = el.tagName.toLowerCase();
    const list = [];

    const id = el.getAttribute('id');
    if (isStable(id)) list.push(`#${esc(id)}`);

    // 部分站点用 data-testid 之类的稳定属性，比类名更可靠
    for (const attr of ['data-testid', 'data-test', 'data-qa', 'itemprop', 'role']) {
      const value = el.getAttribute(attr);
      if (isStable(value)) list.push(`${tag}[${attr}="${value.replace(/"/g, '\\"')}"]`);
    }

    const classes = [...el.classList].filter(isStable).slice(0, MAX_CLASSES);
    // 多个类名 → 先试全部（较窄），再试首个（较宽，更容易命中同类元素）
    if (classes.length > 1) list.push(tag + classes.map((c) => `.${esc(c)}`).join(''));
    if (classes.length) list.push(`${tag}.${esc(classes[0])}`);

    list.push(tag);
    return list;
  }

  /**
   * 最近的若干级父元素，各取其最具体的选择器。返回顺序是「远 → 近」。
   * 用子代组合器 `>` 串起来，能把匹配牢牢钉在这条 DOM 路径上。
   */
  function parentChain(el, levels) {
    const chain = [];
    const doc = el.ownerDocument;
    let node = el.parentElement;
    while (node && node !== doc.body && node !== doc.documentElement && chain.length < levels) {
      const [best] = ownCandidates(node);
      if (!best) break;
      chain.unshift(best);
      node = node.parentElement;
    }
    return chain;
  }

  /** 兜底：结构化路径。唯一，但页面一改版就失效。 */
  function structuralPath(el) {
    const parts = [];
    let node = el;
    const doc = el.ownerDocument;
    while (node && node.nodeType === 1 && node !== doc.body && parts.length < 6) {
      const tag = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (!parent) {
        parts.unshift(tag);
        break;
      }
      const sameTag = [...parent.children].filter((c) => c.tagName === node.tagName);
      parts.unshift(sameTag.length > 1 ? `${tag}:nth-of-type(${sameTag.indexOf(node) + 1})` : tag);
      node = parent;
    }
    return parts.length ? `body ${parts.join(' > ')}` : null;
  }

  function countMatches(doc, selector) {
    try {
      return doc.querySelectorAll(selector).length;
    } catch {
      return -1; // 选择器不合法
    }
  }

  /** 同一个父节点下有多少兄弟也匹配这个选择器。 */
  function siblingMatches(el, selector) {
    const parent = el.parentElement;
    if (!parent) return 1;
    let count = 0;
    for (const child of parent.children) {
      try {
        if (child.matches(selector)) count += 1;
      } catch {
        return 1;
      }
    }
    return count;
  }

  function matchesSelf(el, selector) {
    try {
      return el.matches(selector);
    } catch {
      return false;
    }
  }

  /**
   * @returns {{selector: string, label: string, matches: number} | null}
   */
  function build(el) {
    if (!el || el.nodeType !== 1) return null;
    const doc = el.ownerDocument;
    if (!doc) return null;

    const owns = ownCandidates(el);
    const parents = parentChain(el, PARENT_LEVELS);

    // 由紧到松：两级父元素 → 一级父元素 → 只看自身。
    // 先试最紧的，够用就不再放宽，避免把别处的同类元素也匹配进来。
    const prefixes = [];
    for (let take = parents.length; take >= 1; take -= 1) {
      prefixes.push(`${parents.slice(parents.length - take).join(' > ')} > `);
    }
    prefixes.push('');

    const candidates = [];
    for (const prefix of prefixes) {
      for (const own of owns) {
        // 裸标签名单独作规则太弱，只在带父元素限定时才用
        if (!prefix && /^[a-z]+$/.test(own)) continue;
        candidates.push(prefix + own);
      }
    }

    const viable = [];
    for (const selector of candidates) {
      if (!matchesSelf(el, selector)) continue;
      const count = countMatches(doc, selector);
      if (count >= 1 && count <= MAX_MATCHES) viable.push({ selector, count });
    }

    if (viable.length) {
      // 信息流、评论列表这类重复结构里，每一条往往有各自不同的 id
      // （#post-abc）。挑中那种 id 的话，AJAX 后续加载的条目就永远匹配不上。
      // 所以优先选「能匹配到同级多个兄弟」的选择器——那才代表重复结构。
      // 注意只看同级：满页不相干的元素共用一个类名不算。
      const repeated = viable.find((item) => siblingMatches(el, item.selector) > 1);
      const picked = repeated || viable[0];
      return { selector: picked.selector, label: describe(el), matches: picked.count };
    }

    const fallback = structuralPath(el);
    if (fallback && matchesSelf(el, fallback)) {
      return { selector: fallback, label: describe(el), matches: countMatches(doc, fallback) };
    }
    return null;
  }

  /** 给管理界面看的简短描述。 */
  function describe(el) {
    const tag = el.tagName.toLowerCase();
    const id = el.getAttribute('id');
    const classes = [...el.classList].filter(isStable).slice(0, 2);
    let label = tag;
    if (isStable(id)) label += `#${id}`;
    else if (classes.length) label += `.${classes.join('.')}`;
    else {
      for (const attr of ['data-testid', 'data-test', 'data-qa', 'itemprop']) {
        const value = el.getAttribute(attr);
        if (isStable(value)) {
          label += `[${value}]`;
          break;
        }
      }
    }
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    return text ? `${label} · ${text}${text.length >= 40 ? '…' : ''}` : label;
  }

  globalThis.AITrSelector = { build, describe, isStable, MAX_MATCHES };
})();
