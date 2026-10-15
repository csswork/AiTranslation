/**
 * 用户界面译文工具（仅开发期使用）。
 *
 *   node scripts/i18n.mjs --check       检查每种语言是否覆盖全部文案、占位符是否一致
 *   node scripts/i18n.mjs --translate   用 DeepSeek 补齐缺失译文，并删除不再使用的条目
 *
 * 文案来源：src/ 与 ui/ 中 t('…') 或 k('…') 的中文字面量。官网已有同一句时沿用官网译文；
 * 已有译文不变时复用，不调用 API。
 * Key 依次读取 apps/backend/.env.local、仓库根目录 .env.local 中的 DEEPSEEK_API_KEY（按文本解析，不执行）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const I18N = path.join(ROOT, 'i18n');
const SOURCE = 'zh-Hans';
const PATTERN = /\b[tk]\(\s*'((?:[^'\\\n]|\\.)*)'/g;

// 产品名与官网各语言页面保持一致。
const PRODUCT_NAMES = { 'zh-Hant': 'AI 劃詞翻譯' };
const DEFAULT_PRODUCT_NAME = 'AI Selection Translator';

const listFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return listFiles(full);
  return entry.name.endsWith('.js') ? [full] : [];
});

export function extractKeys() {
  const keys = new Set();
  for (const file of [...listFiles(path.join(ROOT, 'src')), ...listFiles(path.join(ROOT, 'ui'))]) {
    for (const [, literal] of fs.readFileSync(file, 'utf8').matchAll(PATTERN)) keys.add(literal.replace(/\\(.)/g, '$1'));
  }
  return [...keys].sort();
}

export const locales = () => JSON.parse(fs.readFileSync(path.join(I18N, 'locales.json'), 'utf8'));
const catalogPath = (code) => path.join(I18N, `${code}.json`);
const readCatalog = (code) => (fs.existsSync(catalogPath(code)) ? JSON.parse(fs.readFileSync(catalogPath(code), 'utf8')) : {});
const placeholders = (text) => [...new Set(text.match(/\{\w+\}/g) || [])].sort().join(',');

// 非拉丁文字的语言里，拉丁字母只应出现在专有名词与占位符中；用来发现「الحسAB」这类模型输出错乱。
const NON_LATIN = new Set(['zh-Hant', 'ja', 'ko', 'ar']);
const LATIN_ALLOWED = /AI Selection Translator|ChatGPT|OpenAI|DeepSeek|DeepL|Google|Chrome|GitHub|Haibo|GPL-3\.0|API|Key|UTC|AI|Creem|\{\w+\}/g;
const strayLatin = (code, text) => NON_LATIN.has(code) && /[A-Za-z]/.test(text.replace(LATIN_ALLOWED, ''));

/** 返回问题列表；空数组表示所有语言完整。 */
export function checkCatalogs() {
  const keys = extractKeys();
  const problems = [];
  for (const { code } of locales()) {
    if (code === SOURCE) continue;
    const catalog = readCatalog(code);
    for (const key of keys) {
      if (typeof catalog[key] !== 'string' || !catalog[key].trim()) problems.push(`${code}: 缺少译文「${key}」`);
      else if (placeholders(catalog[key]) !== placeholders(key)) problems.push(`${code}: 占位符不一致「${key}」`);
      else if (strayLatin(code, catalog[key])) problems.push(`${code}: 译文混入拉丁字母「${key}」→「${catalog[key]}」`);
    }
    for (const extra of Object.keys(catalog).filter((key) => !keys.includes(key))) problems.push(`${code}: 多余条目「${extra}」`);
  }
  return problems;
}

function loadKey() {
  for (const file of [path.join(ROOT, '.env.local'), path.resolve(ROOT, '../..', '.env.local')]) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?(DEEPSEEK_API_KEY|DEEPSEEK_MODEL)\s*=\s*(.*?)\s*$/);
      if (match && match[2] && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  if (!process.env.DEEPSEEK_API_KEY) throw new Error('缺少 DEEPSEEK_API_KEY（apps/backend/.env.local 或根目录 .env.local）');
  return { key: process.env.DEEPSEEK_API_KEY, model: process.env.DEEPSEEK_MODEL || 'deepseek-flash' };
}

async function translate(items, locale, { key, model }) {
  const product = PRODUCT_NAMES[locale.code] || DEFAULT_PRODUCT_NAME;
  const prompt = [
    `Translate the UI strings of a web account center from Simplified Chinese into ${locale.label} (${locale.htmlLang}).`,
    'Return only JSON {"translations":[{"id":0,"text":"translation"}]}, with exactly one item for each input id.',
    'Keep {placeholders} exactly unchanged. Keep "Google", "Chrome", "API Key", "OpenAI", "DeepSeek", "DeepL", "Creem", "UTC" unchanged.',
    `The product name "AI 划词翻译" must be rendered as "${product}". "点" / "点数" means service credits.`,
    'Use a concise, neutral tone suitable for buttons, labels and short notices.',
  ].join('\n');
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST', signal: AbortSignal.timeout(180_000),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model, temperature: 0.2,
        thinking: { type: 'disabled' }, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: prompt }, { role: 'user', content: JSON.stringify(items.map((source, id) => ({ id, source }))) }],
      }),
    });
    if (!response.ok) throw new Error(`${locale.code}: 翻译接口返回 ${response.status}`);
    const data = await response.json();
    // 用数字 id 对齐，避免模型复制长中文键时破坏 JSON；无效响应不写入目录。
    try {
      const result = JSON.parse(data.choices?.[0]?.message?.content || '');
      const byId = new Map(result.translations.map(({ id, text }) => [id, text]));
      const entries = items.map((item, id) => [item, byId.get(id)]);
      if (entries.every(([item, text]) => typeof text === 'string' && text.trim()
        && placeholders(text) === placeholders(item) && !strayLatin(locale.code, text))) return Object.fromEntries(entries);
    } catch { /* 下次重试，无效译文不会覆盖已有目录。 */ }
  }
  throw new Error(`${locale.code}: 翻译响应格式或占位符无效（已重试 3 次）`);
}

/** 官网已有的同一句中文（页头、页脚等）直接沿用官网译文，保证两边一致。 */
function webTranslations(code) {
  const file = path.resolve(ROOT, '../web/i18n', `${code}.json`);
  if (!fs.existsSync(file)) return {};
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  return data.entries || data;
}
const fromWeb = (web, key) => [key, `@aria-label|${key}`, `@title|${key}`].map((k) => web[k]).find((v) => typeof v === 'string');

async function translateAll() {
  const keys = extractKeys();
  let credentials = null;
  for (const locale of locales()) {
    if (locale.code === SOURCE) continue;
    const old = readCatalog(locale.code);
    const web = webTranslations(locale.code);
    let reused = 0;
    for (const key of keys) {
      const value = fromWeb(web, key);
      if (value && old[key] !== value && placeholders(value) === placeholders(key)) {
        old[key] = value;
        reused += 1;
      }
    }
    if (reused) console.log(`${locale.code}: 沿用官网译文 ${reused} 条`);
    const missing = keys.filter((key) => typeof old[key] !== 'string' || placeholders(old[key]) !== placeholders(key)
      || strayLatin(locale.code, old[key]));
    if (missing.length) {
      credentials ||= loadKey();
      Object.assign(old, await translate(missing, locale, credentials));
      console.log(`${locale.code}: 补齐 ${missing.length} 条`);
    }
    const next = Object.fromEntries(keys.map((key) => [key, old[key]]));
    fs.writeFileSync(catalogPath(locale.code), `${JSON.stringify(next, null, 2)}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.includes('--translate')) await translateAll();
    const problems = checkCatalogs();
    if (problems.length) {
      console.error(problems.join('\n'));
      process.exit(1);
    }
    console.log(`${locales().length} 种语言，${extractKeys().length} 条文案，全部完整`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
