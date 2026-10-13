/**
 * 每个请求的界面上下文：语言（Cookie lang，否则按 Accept-Language）、配色（Cookie theme）和当前路径。
 */
import { getCookie } from 'hono/cookie';
import { LOCALES, createI18n, isLocale, negotiateLocale } from '../../src/i18n/index.js';

export const THEMES = ['light', 'dark'];

/** 只接受站内相对路径，防止切换语言或配色后被重定向到外部地址。 */
export const safePath = (value) => (typeof value === 'string' && /^\/(?![/\\])[\w\-./]*$/.test(value) ? value : '/');

export function uiContext(c, config) {
  const cached = c.get('ui');
  if (cached) return cached;
  const saved = getCookie(c, 'lang');
  const code = isLocale(saved) ? saved : negotiateLocale(c.req.header('accept-language'));
  const theme = THEMES.includes(getCookie(c, 'theme')) ? getCookie(c, 'theme') : null;
  // 表单提交后的错误页没有对应的 GET 地址，切换语言或配色时回到可访问的页面。
  const path = c.req.method === 'GET' ? c.req.path : c.req.path.startsWith('/login') ? '/login' : '/';
  const ui = { ...createI18n(code), locales: LOCALES, theme, path, links: config.links };
  c.set('ui', ui);
  return ui;
}
