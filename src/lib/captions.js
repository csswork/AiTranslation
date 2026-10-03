/**
 * 视频字幕的断句。与 lang.js 一样，不能使用 import / export。
 *
 * 设备端识别在连续模式下基本不给 isFinal：一段话会一直以「中间结果」的形式变长，
 * 等不到「最终句」；英文实测也不带标点。所以这里自己切，三条规则：
 *   1. 太长：没提交的部分超过一行的长度，在句末标点或空格处切，找不到就硬切；
 *   2. 说完一句：句末标点后面已经有新内容，提交到标点为止，不等停顿；
 *   3. 停顿：全文超过 pauseMs 没有变化，把没提交的部分整段提交。
 *
 * 已提交的部分按字符数记。识别器回头改写已提交的内容时（云端识别常见，实测连已出现的词都会整个撤掉），
 * 退回到新旧全文一致的位置重新计数：改动不大时宁可重复显示几个字，也不把新说的话吞掉。
 */
(() => {
  /** 不用空格分词的语言：拼接分段时不补空格。 */
  const UNSPACED = /^(ja|zh)\b/i;
  /** 全角字符的语言：一行要短一些。 */
  const WIDE = /^(ja|zh|ko)\b/i;
  const SENTENCE_END = /[.!?。！？…]/;
  /** 改写退回超过这么多字就不退了，只按长度截齐：再往回退会把一大段旧字幕重放一遍。 */
  const REWRITE_MAX = 12;
  /** 全角句末标点后面不跟空格也算一句结束；半角的必须跟空格，免得把 3.5、U.S. 切开。 */
  const WIDE_SENTENCE_END = /[。！？…]/;
  /** 汉字、假名、长音符、全角标点之间的空白。 */
  const CJK_GAP =
    /([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3000-\u303F\u30FC\uFF00-\uFFEF])\s+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3000-\u303F\u30FC\uFF00-\uFFEF])/gu;

  /**
   * 把识别结果的各段拼成全文。英文等语言分段之间可能没有空格，要补上。
   * 日文的中间结果时而按词加空格（「この 拡張 機能 は」）、时而不加（实测），
   * 统一去掉汉字假名之间的空格，否则字幕会来回跳，按字符数记的提交位置也会错开。
   */
  function joinParts(parts, lang) {
    const spaced = !UNSPACED.test(lang || '');
    let out = '';
    for (const raw of parts) {
      const part = String(raw || '');
      if (!part) continue;
      if (spaced && out && !/\s$/.test(out) && !/^\s/.test(part)) out += ' ';
      out += part;
    }
    return spaced ? out : out.replace(CJK_GAP, '$1');
  }

  /** 在 text[from, from + max) 里找切点（返回绝对位置）：优先句末标点，其次空白，都没有就硬切。 */
  function cutPoint(text, from, max) {
    const window = text.slice(from, from + max);
    const min = Math.floor(max * 0.3); // 切点太靠前会切出很短的一行
    for (let i = window.length - 1; i >= min; i -= 1) {
      if (SENTENCE_END.test(window[i])) return from + i + 1;
    }
    for (let i = window.length - 1; i >= min; i -= 1) {
      if (/\s/.test(window[i])) return from + i + 1;
    }
    return from + max;
  }

  /** a 与 b 的公共前缀长度。 */
  function commonPrefix(a, b) {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
    return i;
  }

  /** from 之后最后一个「后面已经有新内容」的句末位置；没有则返回 -1。 */
  function lastSentenceEnd(text, from) {
    for (let i = text.length - 2; i >= from; i -= 1) {
      const ch = text[i];
      if (!SENTENCE_END.test(ch)) continue;
      if (!WIDE_SENTENCE_END.test(ch) && !/\s/.test(text[i + 1])) continue;
      if (text.slice(i + 1).trim()) return i + 1;
    }
    return -1;
  }

  /**
   * @param {{lang?: string, pauseMs?: number, maxChars?: number}} [options]
   */
  function createSegmenter({ lang = '', pauseMs = 900, maxChars } = {}) {
    // 字号约为视频宽度的 3%，这个长度在视频上大约折成一行半
    const max = maxChars || (WIDE.test(lang) ? 40 : 80);
    let text = '';
    let committed = 0; // 已提交到第几个字符（相对于当前这次识别的全文）
    let changedAt = 0;

    function take(end, lines) {
      const line = text.slice(committed, end).trim();
      committed = end;
      if (line) lines.push(line);
    }

    /** 喂入识别器的最新全文。返回新提交的行，以及还在变化的那一段。 */
    function update(full, now) {
      const lines = [];
      const next = String(full || '');
      if (next !== text) {
        const agreed = commonPrefix(text.slice(0, committed), next);
        if (agreed < committed) {
          committed = committed - agreed <= REWRITE_MAX ? agreed : Math.min(committed, next.length);
        }
        text = next;
        changedAt = now;
      }
      while (text.length - committed > max) take(cutPoint(text, committed, max), lines);
      const end = lastSentenceEnd(text, committed);
      if (end > committed) take(end, lines);
      return { lines, partial: text.slice(committed).trim() };
    }

    /** 定时调用：停顿够久就把剩下的整段提交。 */
    function tick(now) {
      const lines = [];
      if (now - changedAt >= pauseMs) take(text.length, lines);
      return lines;
    }

    /** 识别器重启时调用：没提交的部分直接提交，然后从头计数。 */
    function reset() {
      const lines = [];
      take(text.length, lines);
      text = '';
      committed = 0;
      return lines;
    }

    return { update, tick, reset };
  }

  globalThis.AITrCaptions = { createSegmenter, joinParts, cutPoint };
})();
