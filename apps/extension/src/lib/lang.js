/**
 * 语言判定：决定「这段选中的文字是否需要翻译成中文」。
 *
 * 这个文件同时被三种环境加载：
 *   - content script（manifest 声明的普通脚本）
 *   - options / popup 页面（<script src>）
 *   - background service worker（`import`，即 ES module）
 * 所以它不能出现 import / export，只能把结果挂到 globalThis 上。
 */
(() => {
  // 汉字（含扩展区）。注意日文汉字也属于 Script=Han，所以要先排除假名。
  const HAN = /\p{Script=Han}/gu;
  const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
  const KANA_ALL = /[\p{Script=Hiragana}\p{Script=Katakana}]/gu;
  const HANGUL = /\p{Script=Hangul}/u;
  const LETTER = /\p{L}/gu;

  /** 单次请求送给模型的最大字符数，超出部分会被截断。 */
  const MAX_TEXT_LENGTH = 6000;

  /** 汉字占全部字母的比例达到这个值，就认为「已经是中文了」。 */
  const CHINESE_RATIO = 0.5;

  /** 整页正文里假名占汉字与假名的比例达到这个值，就认为页面是日文（见 looksJapanese）。 */
  const JAPANESE_KANA_SHARE = 0.2;

  function count(text, re) {
    const matched = text.match(re);
    return matched ? matched.length : 0;
  }

  /**
   * @param {string} raw
   * @returns {{text:string, letters:number, han:number, hasKana:boolean,
   *            hasHangul:boolean, chineseRatio:number, isChinese:boolean}}
   */
  function analyze(raw) {
    const text = String(raw == null ? '' : raw).trim();
    const letters = count(text, LETTER);
    const han = count(text, HAN);
    const hasKana = KANA.test(text);
    const hasHangul = HANGUL.test(text);
    const chineseRatio = letters > 0 ? han / letters : 0;
    // 含假名 → 日文；含谚文 → 韩文；两者都要翻译。
    const isChinese =
      !hasKana && !hasHangul && han > 0 && chineseRatio >= CHINESE_RATIO;
    return { text, letters, han, hasKana, hasHangul, chineseRatio, isChinese };
  }

  /**
   * 一段正文（如整页开头的两千字）是否是日文：假名占汉字与假名合计的比例达到 JAPANESE_KANA_SHARE。
   * 日文正文通常在三成以上（连只有版块名的 2ch 目录也有 0.35），中文网页夹几个日文作品名时低于这个值。
   * 日文页面里只有汉字的短段（如「不倫・浮気」「経済」）不能当成中文跳过。
   */
  function looksJapanese(raw) {
    const text = String(raw == null ? '' : raw);
    const kana = count(text, KANA_ALL);
    const han = count(text, HAN);
    return kana + han >= 20 && kana / (kana + han) >= JAPANESE_KANA_SHARE;
  }

  /** 是否应该在右键菜单里显示「翻译成中文」。 */
  function shouldOffer(raw) {
    const info = analyze(raw);
    if (!info.text) return false;
    if (info.letters === 0) return false; // 纯数字 / 标点 / emoji，没有翻译的意义
    return true; // Preserve explicit translation for every script, including Chinese script conversion.
  }

  globalThis.AITrLang = { analyze, shouldOffer, looksJapanese, MAX_TEXT_LENGTH };
})();
