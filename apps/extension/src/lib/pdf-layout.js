/**
 * 把 pdf.js 的文字片段拼成「可以整体翻译、再盖回原位」的段落块。
 *
 * PDF 里没有段落，只有一串带坐标的文字片段（常常一个词、甚至半个词一段），
 * 顺序大体是内容流顺序——对多数排版器来说就是阅读顺序，双栏也是先左栏再右栏。
 * 所以这里不重新排序，只按顺序做两步合并：
 *   片段 → 行：基线接近、从左往右接着排、中间没有大空隙；
 *   行   → 块：字号接近、上下挨着、水平方向有重叠。
 *
 * 坐标约定：输入已换算到「页面左上角为原点、向下为正」的 CSS 像素（缩放 1），
 * y 是基线，size 是字号。纯函数、无 DOM，可以在 node 里测。
 *
 * 和 lang.js 一样不能用 import / export，结果挂在 globalThis 上。
 */
(() => {
  /** 单个块最多多少字。再长就在行边界切开：既控制单次请求大小，也让译文的字号更容易排下。 */
  const MAX_BLOCK_CHARS = 1200;
  /** 每批送多少块、最多多少字（与区域翻译同一量级，托管接口单次上限 6000 字、100 段）。 */
  const BATCH_ITEMS = 25;
  const BATCH_CHARS = 2200;

  const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}　-〿＀-￯]/u;
  const LETTER = /\p{L}/gu;

  /** 两段文字之间要不要补空格：中日韩文字之间不补。 */
  function glue(before, after) {
    if (!before || !after) return '';
    if (/\s$/.test(before) || /^\s/.test(after)) return '';
    if (CJK.test(before.at(-1)) || CJK.test(after[0])) return '';
    return ' ';
  }

  /** 片段 → 行。 */
  function buildLines(items) {
    const lines = [];
    let line = null;
    for (const item of items) {
      if (!item || item.rotated) {
        line = null;
        continue;
      }
      const str = String(item.str || '');
      if (!str) {
        if (item.hasEOL && line) line.ended = true;
        continue;
      }
      const size = item.size > 0 ? item.size : 10;
      const right = item.x + Math.max(0, item.w || 0);
      const fresh =
        !line ||
        line.ended ||
        Math.abs(item.y - line.y) > Math.min(size, line.size) * 0.5 ||
        item.x < line.right - Math.max(size, line.size) * 0.6 || // 回到左边：换行了
        item.x - line.right > Math.max(size, line.size) * 2.2; // 中间空得太远：分栏或表格的另一格
      if (fresh) {
        if (!str.trim()) continue; // 行首空白没有意义
        line = { text: str, left: item.x, right, y: item.y, size, ended: false };
        lines.push(line);
      } else {
        const gap = item.x - line.right;
        if (gap > Math.min(size, line.size) * 0.12) line.text += glue(line.text, str);
        line.text += str;
        line.right = Math.max(line.right, right);
        line.size = Math.max(line.size, size);
      }
      if (item.hasEOL) line.ended = true;
    }
    return lines
      .map((l) => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() }))
      .filter((l) => l.text)
      .map(({ ended, ...l }) => ({ ...l, top: l.y - l.size * 0.9, bottom: l.y + l.size * 0.28 }));
  }

  /** 把多行合成一段：英文行尾连字符断开的词接回去。 */
  function joinLines(texts) {
    let out = '';
    for (const raw of texts) {
      const text = raw.trim();
      if (!text) continue;
      if (!out) {
        out = text;
      } else if (/\p{Ll}-$/u.test(out) && /^\p{Ll}/u.test(text)) {
        // 本来就带连字符的复合词（state-of-the-）保留连字符，只是不补空格
        const word = out.slice(out.lastIndexOf(' ') + 1, -1);
        out = (word.includes('-') ? out : out.slice(0, -1)) + text;
      } else {
        out += glue(out, text) + text;
      }
    }
    return out;
  }

  /** 行 → 块。 */
  function buildBlocks(items) {
    const blocks = [];
    let block = null;
    for (const line of buildLines(items)) {
      const last = block?.lines.at(-1);
      const join =
        block &&
        line.size / block.size < 1.3 &&
        block.size / line.size < 1.3 &&
        line.top >= last.top + last.size * 0.3 && // 在上一行下面
        line.top - last.bottom < block.size * 0.75 && // 行距以内，没有段间空白
        line.left < block.right + block.size && // 水平方向有重叠
        line.right > block.left - block.size &&
        block.chars + line.text.length <= MAX_BLOCK_CHARS;
      if (!join) {
        block = { lines: [], left: line.left, right: line.right, top: line.top, bottom: line.bottom, size: line.size, chars: 0 };
        blocks.push(block);
      }
      block.lines.push(line);
      block.left = Math.min(block.left, line.left);
      block.right = Math.max(block.right, line.right);
      block.bottom = Math.max(block.bottom, line.bottom);
      block.chars += line.text.length;
    }
    return blocks.map((b) => {
      const text = joinLines(b.lines.map((l) => l.text));
      const letters = (text.match(LETTER) || []).length;
      // 外扩一点再盖：PDF 记录的字宽常比实际渲染的字形略窄，不扩的话右边会露出原文的残笔
      const pad = b.size * 0.12;
      return {
        text,
        left: b.left - pad,
        top: b.top - pad,
        width: b.right - b.left + pad + b.size * 0.6,
        height: b.bottom - b.top + pad * 2,
        size: b.size,
        lines: b.lines.length,
        // 页码、公式编号、纯数字表格格子不送去翻译，原样保留
        translatable: letters >= 2,
      };
    });
  }

  /** 按条数和字数切批；返回块下标的数组。 */
  function batches(blocks, { items = BATCH_ITEMS, chars = BATCH_CHARS } = {}) {
    const out = [];
    let current = [];
    let size = 0;
    blocks.forEach((block, index) => {
      if (!block.translatable) return;
      const length = block.text.length;
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

  globalThis.AITrPdfLayout = { buildLines, buildBlocks, joinLines, batches, MAX_BLOCK_CHARS };
})();
