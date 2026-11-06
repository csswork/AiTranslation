/**
 * 双语阅读：把正文（Readability 识别出的文章节点）整理成结构化段落，并切成翻译批次。
 *
 * 这里只读节点的 nodeType / tagName / childNodes / nodeValue / getAttribute，
 * 内容脚本里传真实 DOM，测试里传一个最小的假 DOM。产出的是纯 JSON：
 * 阅读页只按类型重建元素、用 textContent 写文字，绝不把网页的 HTML 带进扩展页面。
 *
 * 块类型：
 *   { type: 'h2' | 'h3' | 'h4', text }       小标题（文章里的 h1 降成 h2，大标题另存在 title）
 *   { type: 'p', text }                        段落
 *   { type: 'li', text, depth, ordered, index } 列表项（嵌套列表逐层加 depth）
 *   { type: 'quote', text }                    引用
 *   { type: 'code', text }                     代码，原样显示，不翻译
 *   { type: 'img', src, alt, text }            图片；text 是图注（可空）
 *   { type: 'table', rows: string[][] }        表格，按单元格翻译
 *   { type: 'hr' }
 *
 * 与 lang.js 一样不能使用 import / export。
 */
(() => {
  if (globalThis.AITrArticle) return;

  const ELEMENT = 1;
  const TEXT = 3;
  /** 正文总字数上限：再长的页面也只取前面这些，避免一次翻译过多、撑爆会话存储。 */
  const MAX_CHARS = 200_000;
  const MAX_BLOCKS = 2000;
  /** 单段过长时在句子边界切开，免得一段占满一个翻译批次。 */
  const MAX_BLOCK_CHARS = 1800;
  const BATCH_ITEMS = 20;
  const BATCH_CHARS = 2000;

  const INLINE = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'code', 'data', 'del', 'dfn', 'em', 'font',
    'i', 'ins', 'kbd', 'label', 'mark', 'q', 's', 'samp', 'small', 'span', 'strike', 'strong', 'sub', 'sup',
    'time', 'tt', 'u', 'var', 'wbr', 'nobr', 'big', 'ruby', 'rb', 'rt', 'rp', 'math']);
  const SKIP = new Set(['script', 'style', 'noscript', 'template', 'button', 'input', 'select', 'textarea',
    'form', 'nav', 'iframe', 'object', 'embed', 'svg', 'canvas', 'video', 'audio', 'source', 'track', 'link', 'meta']);
  const HEADINGS = { h1: 'h2', h2: 'h2', h3: 'h3', h4: 'h4', h5: 'h4', h6: 'h4' };

  /* ---------------------------------------------------------------- 广告 */

  /** class / id 里的广告词：整个词是广告词，或以 ad- / -ad 等形式出现（不误伤 head、load、shadow、add-to-cart）。 */
  const AD_TOKEN = new RegExp([
    '^(?:ad|ads|adv|advert|adverts|advertisement|advertisements|advertising|adslot|adslots|adunit|adunits|adbox|adwrap|adblock|adsense|adsbygoogle|dfp|sponsor|sponsors|sponsored|sponsorship|promoted|taboola|outbrain|mgid|revcontent|zergnet|teads)$',
    '^(?:ad|ads|advert|adslot|adunit|dfp|gpt|google[-_]?ad|sponsor|sponsored|taboola|outbrain|teads)[-_]',
    '[-_](?:ad|ads|advert|advertisement|adslot|adunit|dfp|sponsor|sponsored|taboola|outbrain)$',
    '[-_](?:ad|ads)[-_]',
  ].join('|'), 'i');
  /** 广告与推荐联盟的图片地址。 */
  const AD_HOSTS = /(?:^|\.)(?:doubleclick\.net|googlesyndication\.com|googleadservices\.com|adservice\.google\.[a-z.]+|adnxs\.com|amazon-adsystem\.com|criteo\.(?:com|net)|pubmatic\.com|rubiconproject\.com|taboola\.com|outbrain\.com|mgid\.com|revcontent\.com|teads\.tv|moatads\.com|scorecardresearch\.com)$/i;
  /** 广告标签里会出现的词（各语言），以及这类标签里常见的填充词。 */
  const AD_WORDS = new Set(['advertisement', 'advertisements', 'advert', 'adverts', 'advertising', 'ad', 'ads', 'sponsored', 'sponsor',
    'promoted', 'promotion', 'anzeige', 'werbung', 'publicité', 'publicite', 'publicidad', 'pubblicità', 'pubblicita', 'реклама', 'reklama',
    'annonce', 'advertentie', 'iklan', 'โฆษณา']);
  const AD_FILLER = new Set(['continue', 'continues', 'continued', 'reading', 'read', 'below', 'story', 'article', 'scroll', 'to', 'skip',
    'the', 'with', 'content', 'feedback', 'by', 'our', 'partner', 'partners', 'from', 'report', 'this', 'after', 'and', 'main', 'for',
    'more', 'paid', 'post', 'video', 'here', 'close', 'x', 'weiter', 'nach', 'der', 'unter', 'suite', 'après', 'la', 'continúa', 'sigue']);
  const AD_LABEL_CJK = /^(?:广告|廣告|推广|推廣|赞助|贊助|广告位|廣告位|赞助内容|贊助內容|赞助商|商业推广|广告推荐|広告|スポンサー|スポンサーリンク|광고|pr)$/i;

  /** 这段文字整个就是广告标签（「Advertisement」「Story continues below advertisement」「广告」），而不是提到广告的正文。 */
  function isAdLabel(text) {
    const value = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!value || value.length > 80) return false;
    if (AD_LABEL_CJK.test(value.replace(/[\s:：·•\-—–|()（）[\]【】「」]/g, ''))) return true;
    const tokens = value.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    return tokens.some((token) => AD_WORDS.has(token)) && tokens.every((token) => AD_WORDS.has(token) || AD_FILLER.has(token));
  }

  function isAdElement(node) {
    const tag = String(node?.tagName || '').toLowerCase();
    if (!tag || ['html', 'body', 'main', 'article', 'h1'].includes(tag)) return false;
    const attr = (name) => node.getAttribute?.(name) || '';
    if (attr('data-ad') || attr('data-ad-slot') || attr('data-ad-unit') || attr('data-ad-client') || attr('data-google-query-id')
      || attr('data-adunit') || attr('data-ad-name')) return true;
    const tokens = `${attr('class')} ${attr('id')}`.split(/\s+/).filter(Boolean);
    if (tokens.some((token) => AD_TOKEN.test(token))) return true;
    const label = attr('aria-label') || attr('data-label');
    if (label && isAdLabel(label)) return true;
    if (tag === 'iframe' || tag === 'img') {
      try {
        if (AD_HOSTS.test(new URL(attr('src'), 'https://x.invalid/').hostname)) return true;
      } catch { /* 无效地址 */ }
    }
    return false;
  }

  /**
   * 在页面副本上去掉广告容器（Readability 识别之前）。为免误删正文，文字很多或含大标题的元素保留。
   * 返回去掉了几个。
   */
  function stripAds(root) {
    let removed = 0;
    const visit = (node) => {
      for (const child of Array.from(node?.childNodes || [])) {
        if (child.nodeType !== 1) continue;
        if (isAdElement(child)) {
          const text = String(child.textContent || '');
          const hasTitle = Array.from(child.querySelectorAll?.('h1') || []).length > 0;
          if (text.replace(/\s+/g, '').length <= 400 && !hasTitle) {
            child.parentNode.removeChild(child);
            removed += 1;
            continue;
          }
        }
        visit(child);
      }
    };
    visit(root);
    return removed;
  }

  const tagOf = (node) => String(node?.tagName || '').toLowerCase();
  const kids = (node) => Array.from(node?.childNodes || []);

  /** 合并空白，保留 <br> 带来的换行。 */
  function clean(text) {
    return String(text || '')
      .replace(/[\t\f\v\r  ​]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{2,}/g, '\n')
      .trim();
  }

  /** 至少有两个字母（任意文字）才值得翻译：页码、编号、纯符号原样保留。 */
  function translatable(text) {
    const letters = String(text || '').match(/\p{L}/gu);
    return Boolean(letters && letters.length >= 2);
  }

  /** 安全的图片地址：只接受 http(s)，相对地址按页面地址补全。 */
  function imageUrl(node, base) {
    const candidates = [node.getAttribute?.('src'), node.getAttribute?.('data-src'), node.getAttribute?.('data-original')];
    const srcset = node.getAttribute?.('srcset') || node.getAttribute?.('data-srcset');
    if (srcset) {
      // 取最后一项（通常是最大的那张）
      const last = srcset.split(',').map((part) => part.trim().split(/\s+/)[0]).filter(Boolean).pop();
      candidates.push(last);
    }
    // 统计像素与广告图：宽或高只有几个像素，或来自广告服务器
    const width = Number(node.getAttribute?.('width'));
    const height = Number(node.getAttribute?.('height'));
    if ((width && width <= 3) || (height && height <= 3)) return '';
    for (const raw of candidates) {
      if (!raw || /^data:/i.test(raw)) continue;
      try {
        const url = new URL(raw, base || undefined);
        if (AD_HOSTS.test(url.hostname)) return '';
        if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
      } catch {
        /* 下一个候选 */
      }
    }
    return '';
  }

  /** 行内文字（未整理空白）：子元素里的文字连起来，<br> 换行，跳过图片和表单控件。 */
  function rawText(node) {
    let out = '';
    const visit = (current) => {
      for (const child of kids(current)) {
        if (child.nodeType === TEXT) {
          out += child.nodeValue || '';
          continue;
        }
        if (child.nodeType !== ELEMENT) continue;
        const tag = tagOf(child);
        if (tag === 'br') out += '\n';
        else if (tag === 'img' || SKIP.has(tag)) continue;
        else {
          const block = !INLINE.has(tag);
          if (block && out && !/\s$/.test(out)) out += ' ';
          visit(child);
          if (block && out && !/\s$/.test(out)) out += ' ';
        }
      }
    };
    visit(node);
    return out;
  }

  const inlineText = (node) => clean(rawText(node));

  /** 行内元素里夹着块级元素（<a><div>…</div></a>）时要当容器展开。 */
  function hasBlock(node) {
    return kids(node).some((child) => child.nodeType === ELEMENT
      && ((!INLINE.has(tagOf(child)) && tagOf(child) !== 'br' && tagOf(child) !== 'img' && !SKIP.has(tagOf(child))) || hasBlock(child)));
  }

  /** 段落太长时按句末标点切开；切不开就按长度硬切。 */
  function split(text, max = MAX_BLOCK_CHARS) {
    if (text.length <= max) return [text];
    const sentences = text.match(/[^.!?。！？；;]+[.!?。！？；;]*["'”’」』)]*\s*/gu) || [text];
    const parts = [];
    let current = '';
    for (const sentence of sentences) {
      if (current && current.length + sentence.length > max) {
        parts.push(current.trim());
        current = '';
      }
      if (sentence.length > max) {
        for (let at = 0; at < sentence.length; at += max) parts.push(sentence.slice(at, at + max).trim());
        continue;
      }
      current += sentence;
    }
    if (current.trim()) parts.push(current.trim());
    return parts.filter(Boolean);
  }

  /**
   * 文章节点 → 块列表。
   * @param {Node} root  Readability 返回的正文节点
   * @param {{ base?: string, title?: string }} options
   */
  function toBlocks(root, { base = '', title = '', byline = '' } = {}) {
    const blocks = [];
    let chars = 0;
    let full = false;
    const titleKey = clean(title).toLowerCase();
    const bylineKey = clean(byline).toLowerCase();

    const push = (block) => {
      if (full) return;
      if (blocks.length >= MAX_BLOCKS || chars >= MAX_CHARS) { full = true; return; }
      if (block.text != null) chars += block.text.length;
      blocks.push(block);
    };
    const pushText = (type, text, extra = {}) => {
      const value = clean(text);
      if (!value || isAdLabel(value)) return;
      // 正文开头的署名行（「By 某某 · 日期」）跳过：阅读页顶部已经单独显示作者
      if (type === 'p' && blocks.length < 2 && bylineKey && value.length < 160 && value.toLowerCase().includes(bylineKey)) return;
      for (const part of type === 'code' ? [value] : split(value)) push({ type, text: part, ...extra });
    };

    let buffer = '';
    const flush = () => {
      const text = clean(buffer);
      buffer = '';
      if (text) pushText('p', text);
    };

    const image = (node) => {
      const src = imageUrl(node, base);
      if (!src) return null;
      return { type: 'img', src, alt: clean(node.getAttribute?.('alt') || ''), text: '' };
    };
    const findImages = (node, out = []) => {
      for (const child of kids(node)) {
        if (child.nodeType !== ELEMENT) continue;
        if (tagOf(child) === 'img') out.push(child);
        else findImages(child, out);
      }
      return out;
    };

    const list = (node, depth) => {
      const ordered = tagOf(node) === 'ol';
      let index = Number(node.getAttribute?.('start')) || 1;
      for (const item of kids(node)) {
        if (item.nodeType !== ELEMENT) continue;
        const tag = tagOf(item);
        if (tag === 'ul' || tag === 'ol') { list(item, depth + 1); continue; }
        if (tag !== 'li') { visit(item, depth); continue; }
        // 列表项自己的文字，不含嵌套列表
        let own = '';
        const nested = [];
        const collect = (current) => {
          for (const child of kids(current)) {
            if (child.nodeType === TEXT) { own += child.nodeValue || ''; continue; }
            if (child.nodeType !== ELEMENT) continue;
            const childTag = tagOf(child);
            if (childTag === 'ul' || childTag === 'ol') nested.push(child);
            else if (childTag === 'br') own += '\n';
            else if (SKIP.has(childTag) || childTag === 'img') continue;
            else if (INLINE.has(childTag) && !hasBlock(child)) own += rawText(child);
            else { own += ' '; collect(child); own += ' '; }
          }
        };
        collect(item);
        const text = clean(own);
        if (text) pushText('li', text, { depth: Math.min(depth, 4), ordered, index });
        index += 1;
        for (const child of nested) list(child, depth + 1);
      }
    };

    const table = (node) => {
      const rows = [];
      const walkRows = (current) => {
        for (const child of kids(current)) {
          if (child.nodeType !== ELEMENT) continue;
          const tag = tagOf(child);
          if (tag === 'tr') {
            const cells = kids(child).filter((cell) => cell.nodeType === ELEMENT && /^t[dh]$/.test(tagOf(cell)))
              .map((cell) => inlineText(cell).slice(0, MAX_BLOCK_CHARS));
            if (cells.some(Boolean)) rows.push(cells);
          } else if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot') {
            walkRows(child);
          }
        }
      };
      walkRows(node);
      if (!rows.length) return;
      // 只有一列、或一行的「表格」多半是排版用的：当作普通段落
      const width = Math.max(...rows.map((row) => row.length));
      if (width < 2) { for (const [cell] of rows) pushText('p', cell); return; }
      chars += rows.flat().join('').length;
      push({ type: 'table', rows: rows.slice(0, 200) });
    };

    function visit(node, depth = 0) {
      for (const child of kids(node)) {
        if (full) return;
        if (child.nodeType === TEXT) { buffer += child.nodeValue || ''; continue; }
        if (child.nodeType !== ELEMENT) continue;
        const tag = tagOf(child);
        if (SKIP.has(tag)) continue;
        if (INLINE.has(tag) && !hasBlock(child)) {
          buffer += rawText(child);
          const images = findImages(child);
          if (images.length) {
            flush();
            for (const img of images) { const block = image(img); if (block) push(block); }
          }
          continue;
        }
        if (tag === 'br') { buffer += '\n'; continue; }
        flush();
        if (HEADINGS[tag]) {
          const text = inlineText(child);
          // 正文开头重复的大标题跳过：阅读页顶部已经单独显示
          if (!blocks.length && text.toLowerCase() === titleKey) continue;
          if (text && !isAdLabel(text)) push({ type: HEADINGS[tag], text: text.slice(0, MAX_BLOCK_CHARS) });
        } else if (tag === 'p') {
          pushText('p', inlineText(child));
          for (const img of findImages(child)) { const block = image(img); if (block) push(block); }
        } else if (tag === 'ul' || tag === 'ol') {
          list(child, depth);
        } else if (tag === 'blockquote') {
          const inner = kids(child).some((node2) => node2.nodeType === ELEMENT && !INLINE.has(tagOf(node2)) && tagOf(node2) !== 'br');
          if (inner) {
            const start = blocks.length;
            visit(child, depth);
            for (let i = start; i < blocks.length; i++) if (blocks[i].type === 'p') blocks[i].type = 'quote';
          } else {
            pushText('quote', inlineText(child));
          }
        } else if (tag === 'pre') {
          const text = String(child.textContent ?? inlineText(child)).replace(/\s+$/, '');
          if (text.trim()) push({ type: 'code', text: text.slice(0, 20_000) });
        } else if (tag === 'img') {
          const block = image(child);
          if (block) push(block);
        } else if (tag === 'figure' || tag === 'picture') {
          const images = findImages(child).map(image).filter(Boolean);
          const caption = kids(child).find((node2) => tagOf(node2) === 'figcaption');
          const captionText = caption ? inlineText(caption) : '';
          if (images.length) {
            images.forEach((block, i) => push(i === images.length - 1 ? { ...block, text: captionText.slice(0, MAX_BLOCK_CHARS) } : block));
          } else {
            // 没有图片的 figure（引言卡片、代码示例等）照常展开
            visit(child, depth);
          }
        } else if (tag === 'figcaption') {
          pushText('p', inlineText(child));
        } else if (tag === 'table') {
          table(child);
        } else if (tag === 'hr') {
          if (blocks.length && blocks[blocks.length - 1].type !== 'hr') push({ type: 'hr' });
        } else if (tag === 'dl') {
          for (const item of kids(child)) {
            if (item.nodeType !== ELEMENT) continue;
            const itemTag = tagOf(item);
            if (itemTag === 'dt') pushText('h4', inlineText(item));
            else if (itemTag === 'dd') pushText('p', inlineText(item));
          }
        } else {
          // div / section / article / main / header / aside / details …：当容器展开
          visit(child, depth);
        }
      }
      flush();
    }

    visit(root);
    flush();
    while (blocks.length && blocks[blocks.length - 1].type === 'hr') blocks.pop();
    return { blocks, truncated: full };
  }

  /** 块里要翻译的文字，按固定顺序展开（表格逐格）。 */
  function parts(block) {
    if (!block) return [];
    if (block.type === 'code' || block.type === 'hr') return [];
    if (block.type === 'table') return block.rows.flat();
    if (block.type === 'img') return block.text ? [block.text] : [];
    return [block.text];
  }

  /**
   * 文章字数估算：中日韩一个字顶西文 2.5 个字符，用来判断「是不是一篇完整的文章」。
   */
  function weight(text) {
    const value = String(text || '');
    const cjk = (value.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) || []).length;
    return value.length - cjk + cjk * 2.5;
  }

  /**
   * 判断识别结果：
   *   'article' 有标题、正文够长、段落够多，直接打开；
   *   'weak'    有些文字，但不像一篇完整的文章（首页、列表页、短帖），让用户决定；
   *   'none'    几乎没有正文。
   */
  function assess({ title = '', blocks = [] }, { readerable = true } = {}) {
    const textBlocks = blocks.filter((block) => block.type === 'p' || block.type === 'li' || block.type === 'quote');
    const paragraphs = blocks.filter((block) => block.type === 'p' && weight(block.text) >= 60).length;
    const total = textBlocks.reduce((sum, block) => sum + weight(block.text), 0);
    if (total < 140) return { verdict: 'none', paragraphs, total };
    const article = Boolean(clean(title)) && total >= 700 && paragraphs >= 3;
    return { verdict: article && readerable ? 'article' : 'weak', paragraphs, total };
  }

  /**
   * 把翻译单元切成批次：每批最多 items 段、chars 字。
   * @param {{ text: string }[]} units
   * @returns {number[][]} 每批是 units 的下标
   */
  function batches(units, { items = BATCH_ITEMS, chars = BATCH_CHARS } = {}) {
    const out = [];
    let current = [];
    let size = 0;
    units.forEach((unit, index) => {
      const length = String(unit.text || '').length;
      if (current.length && (current.length >= items || size + length > chars)) {
        out.push(current);
        current = [];
        size = 0;
      }
      current.push(index);
      size += length;
    });
    if (current.length) out.push(current);
    return out;
  }

  globalThis.AITrArticle = { toBlocks, parts, assess, batches, translatable, clean, split, weight, stripAds, isAdLabel, isAdElement, MAX_CHARS };
})();
