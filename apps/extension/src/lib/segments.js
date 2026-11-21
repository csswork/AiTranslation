/**
 * 文本节点是不是「独立成段」：区域翻译与整站翻译按文本节点送去翻译，同一句话常被行内标签切成几段
 * （<p>Read the <a>docs</a> first.</p>），这些片段的译法依赖整句，不能单独缓存；
 * 导航链接、按钮、标题、没有行内标记的段落这类节点本身就是完整的一段，可以逐段命中本机缓存（见 providers.js 的 cachedBatch）。
 *
 * 判断：从节点往上走过行内元素（计算后的 display 为 inline / contents），到最近的块级容器；容器里的全部文字（压缩空白后）就是这个节点自己，才算完整。
 * 拿不准时一律当片段：最多少命中一些，不会把片段的译法套到别的句子里。要在译文写回之前判断，写回的兄弟节点会让容器文字变掉。
 * 与 lang.js 等一样不能使用 import / export。
 */
(() => {
  if (globalThis.AITrSegments) return;

  const INLINE = new Set([
    'a', 'abbr', 'b', 'bdi', 'bdo', 'big', 'cite', 'data', 'del', 'dfn', 'em', 'font', 'i', 'ins', 'kbd',
    'mark', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'small', 'span', 'strike', 'strong', 'sub', 'sup', 'time',
    'tt', 'u', 'var',
  ]);
  const INLINE_DISPLAY = /^(inline|contents|ruby|ruby-base|ruby-text)$/;
  const flat = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  /**
   * 优先看计算后的 display：导航里常见 <nav style="display:flex"><a>…</a><a>…</a></nav>，
   * flex / grid 子项的 display 会被算成 block，这些链接各自是一段。拿不到样式时按标签名。
   */
  function inline(element) {
    const display = element.ownerDocument?.defaultView?.getComputedStyle?.(element)?.display;
    if (display) return INLINE_DISPLAY.test(display);
    return INLINE.has(element.localName) || element.localName.includes('-');
  }

  function isWhole(node) {
    const core = flat(node?.nodeValue);
    let box = node?.parentElement;
    if (!core || !box) return false;
    let open = inline(box);
    while (open && box.parentElement) {
      box = box.parentElement;
      open = inline(box);
    }
    // 行内元素一路走到了 shadow root 顶上：容器就是这个 shadow root
    const scope = open ? box.parentNode : box;
    const text = scope?.textContent || '';
    // 容器里明显还有别的文字时不用再压空白比较
    if (text.length > core.length * 3 + 200) return false;
    return flat(text) === core;
  }

  globalThis.AITrSegments = { isWhole };
})();
