/**
 * 用词偏好：用户在译文里把某个词换成别的说法后记下来（例如「功能」译成 feature 而不是 function），
 * 之后翻译含有同一原文词语的文字时优先使用。
 *
 *   存储：chrome.storage.local 的 termPrefs（只在本机，不经 Chrome 账号同步，也不上传保存）。
 *         每条 { id, source, from, to, target, at }：source 原文词语，from 原来的译法，to 偏好的译法。
 *   应用：大模型平台与点数翻译把相关条目作为术语表放进请求（见 providers.js、后台 hosted.js）；
 *         DeepL 没有这种入口，在译文里把 from 换成 to。
 *
 * 只在 service worker 与扩展页面里使用（内容脚本经 service worker 翻译）。与 lang.js 一样不能使用 import / export。
 */
(() => {
  if (globalThis.AITrTerms) return;

  const KEY = 'termPrefs';
  const MAX_ENTRIES = 500;
  /** 每次请求最多带多少条：太多会稀释提示词，也拖长请求。 */
  const MAX_RELEVANT = 20;
  const MAX_TERM = 100;

  const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TERM);
  /** 中日韩、泰文等不用空格分词的文字按字面匹配，其余按整词匹配。 */
  const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u;
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function pattern(term, flags = 'giu') {
    const body = escape(term);
    if (UNSPACED.test(term)) return new RegExp(body, flags);
    return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, flags);
  }

  function valid(entry) {
    return entry && typeof entry === 'object' && entry.source && entry.to && entry.target
      && typeof entry.source === 'string' && typeof entry.to === 'string' && typeof entry.target === 'string';
  }

  async function list() {
    try {
      const stored = await chrome.storage.local.get(KEY);
      return (Array.isArray(stored[KEY]) ? stored[KEY] : []).filter(valid);
    } catch {
      return [];
    }
  }

  async function save(entries) {
    await chrome.storage.local.set({ [KEY]: entries.slice(0, MAX_ENTRIES) });
  }

  /**
   * 记住一条偏好；同一目标语言、同一原文词语只留最新一条。返回记下的条目，信息不全时返回 null。
   */
  async function remember({ source, from, to, target }) {
    const entry = { source: clean(source), from: clean(from), to: clean(to), target: String(target || '') };
    if (!entry.source || !entry.to || !entry.target || entry.from === entry.to) return null;
    const entries = await list();
    const key = entry.source.toLowerCase();
    const rest = entries.filter((item) => !(item.target === entry.target && item.source.toLowerCase() === key));
    const saved = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, ...entry, at: Date.now() };
    await save([saved, ...rest]);
    return saved;
  }

  async function forget(id) {
    const entries = await list();
    await save(entries.filter((item) => item.id !== id));
  }

  async function clear() {
    await chrome.storage.local.remove(KEY);
  }

  /** 原文里出现了哪些偏好的原文词语（同一目标语言），最新的优先，最多 MAX_RELEVANT 条。 */
  function match(entries, texts, target) {
    const joined = (Array.isArray(texts) ? texts : [texts]).join('\n');
    if (!joined || !target) return [];
    const out = [];
    for (const entry of entries) {
      if (entry.target !== target) continue;
      if (!pattern(entry.source, 'iu').test(joined)) continue;
      out.push(entry);
      if (out.length >= MAX_RELEVANT) break;
    }
    return out;
  }

  async function relevant(texts, target) {
    return match(await list(), texts, target);
  }

  /** 发给模型的术语表：[{ source, target }]。 */
  function glossary(entries) {
    return entries.map((entry) => ({ source: entry.source, target: entry.to }));
  }

  /** 放进系统提示词的一行（大模型平台）。 */
  function promptLine(entries) {
    if (!entries.length) return '';
    const map = Object.fromEntries(entries.map((entry) => [entry.source, entry.to]));
    return `The reader prefers these renderings (JSON, source term → translation). Whenever a source term appears, translate it this way, adjusting only case or inflection: ${JSON.stringify(map)}`;
  }

  /** 传统翻译接口：原文里有这个词、译文里还是原来的译法时，把它换成偏好的译法。 */
  function applyTo(source, translation, entries) {
    let out = String(translation ?? '');
    for (const entry of entries) {
      if (!entry.from || !pattern(entry.source, 'iu').test(source)) continue;
      out = out.replace(pattern(entry.from, 'gu'), entry.to);
    }
    return out;
  }

  globalThis.AITrTerms = { KEY, list, remember, forget, clear, match, relevant, glossary, promptLine, applyTo, pattern, MAX_RELEVANT };
})();
