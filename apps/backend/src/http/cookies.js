/**
 * Cookie 约定：全部 HttpOnly、SameSite=Lax；HTTPS 下加 Secure，会话 Cookie 使用 __Host- 前缀，
 * 只属于用户管理界面的主机，不设置 Domain。
 */
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

const sessionName = (config) => (config.secureCookies ? '__Host-huaci_session' : 'huaci_session');
const base = (config) => ({ httpOnly: true, secure: config.secureCookies, sameSite: 'Lax', path: '/' });

export const getSessionToken = (c, config) => getCookie(c, sessionName(config));

export function setSessionCookie(c, config, token) {
  setCookie(c, sessionName(config), token, { ...base(config), maxAge: config.sessionDays * 86400 });
}

export function clearSessionCookie(c, config) {
  deleteCookie(c, sessionName(config), base(config));
}

/**
 * 界面偏好（语言、配色），保存一年。配色 Cookie 需由页面脚本直接改写，所以不设 HttpOnly；
 * 两者都只是显示偏好，不含身份信息。
 */
export function setPreference(c, config, name, value, { httpOnly = true } = {}) {
  setCookie(c, name, value, { ...base(config), httpOnly, maxAge: 365 * 86400 });
}

export function clearPreference(c, config, name, { httpOnly = true } = {}) {
  deleteCookie(c, name, { ...base(config), httpOnly });
}

/** 流程中的短期数据，例如待验证的邮箱、OAuth state 与 PKCE verifier。 */
export const getTemp = (c, name) => getCookie(c, name);

export function setTemp(c, config, name, value, maxAgeSeconds = 600) {
  setCookie(c, name, value, { ...base(config), maxAge: maxAgeSeconds });
}

export function clearTemp(c, config, name) {
  deleteCookie(c, name, base(config));
}
