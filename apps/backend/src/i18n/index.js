/**
 * 用户界面多语言。中文文案本身就是翻译键（写在 t('…') 或 k('…') 里），
 * 译文在 i18n/<code>.json；语言列表与官网一致（i18n/locales.json，两边各自维护）。
 * 缺失、过期译文由 scripts/i18n.mjs 检查和补齐，测试保证每种语言完整。
 */
import fs from 'node:fs';
import path from 'node:path';
import { raw } from 'hono/html';
import { APP_ROOT } from '../config/index.js';

const DIR = path.join(APP_ROOT, 'i18n');
const read = (name) => JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8'));

export const SOURCE_LOCALE = 'zh-Hans';
export const FALLBACK_LOCALE = 'en';
export const LOCALES = read('locales.json');
const catalogs = new Map(LOCALES.filter((l) => l.code !== SOURCE_LOCALE).map((l) => [l.code, read(`${l.code}.json`)]));

/** 只标记需要翻译的文案，供提取脚本识别；运行时原样返回中文键，渲染时再用 t() 翻译。 */
export const k = (key) => key;

export const isLocale = (code) => LOCALES.some((l) => l.code === code);

function matchTag(tag) {
  if (tag.startsWith('zh')) return /hant|-tw|-hk|-mo/.test(tag) ? 'zh-Hant' : 'zh-Hans';
  const primary = tag.split('-')[0];
  return LOCALES.find((l) => l.code.toLowerCase() === primary)?.code || null;
}

/** 按 Accept-Language 的权重选择最合适的界面语言，都不支持时使用英文。 */
export function negotiateLocale(acceptLanguage) {
  const ranges = String(acceptLanguage || '').split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().toLowerCase().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return { tag: tag.trim(), q: q ? Number(q.slice(2)) : 1, index };
    })
    .filter((r) => r.tag && r.tag !== '*' && r.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const { tag } of ranges) {
    const code = matchTag(tag);
    if (code) return code;
  }
  return FALLBACK_LOCALE;
}

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (ch) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const isHtml = (value) => value instanceof String && value.isEscaped === true;

/**
 * 返回某个语言的翻译与格式化函数。t(key, params) 输出已转义的 HTML：
 * 译文本身会被转义；{name} 占位符替换为参数，参数是 html`` 片段时原样插入，否则转义。
 */
export function createI18n(code) {
  const locale = LOCALES.find((l) => l.code === code) || LOCALES.find((l) => l.code === FALLBACK_LOCALE);
  const catalog = catalogs.get(locale.code);
  const t = (key, params = {}) => raw(escapeHtml(catalog?.[key] || key).replace(/\{(\w+)\}/g, (match, name) => {
    if (!(name in params)) return match;
    return isHtml(params[name]) ? String(params[name]) : escapeHtml(params[name]);
  }));
  // 服务端不知道访问者的时区，统一以 UTC 显示并注明。
  const dateTimeFormat = new Intl.DateTimeFormat(locale.htmlLang, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  const dateFormat = new Intl.DateTimeFormat(locale.htmlLang, { dateStyle: 'medium', timeZone: 'UTC' });
  return {
    locale,
    t,
    dateTime: (value) => (value ? `${dateTimeFormat.format(new Date(value))} UTC` : '—'),
    date: (value) => (value ? dateFormat.format(new Date(value)) : '—'),
  };
}
