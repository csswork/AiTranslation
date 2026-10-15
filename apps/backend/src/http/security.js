/** 通用安全响应头与修改状态请求的来源校验。 */
import { bodyLimit } from 'hono/body-limit';

const SAFE_METHODS = /^(GET|HEAD|OPTIONS)$/;

// Google One Tap 组件要求放开的来源（https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid#content_security_policy）。
const GSI = 'https://accounts.google.com/gsi/';

export function securityHeaders(config, { checkout = Boolean(config.creem) } = {}) {
  // 只允许本站脚本（配色切换与语言下拉的增强）；表单提交到 Google 登录会经过重定向，form-action 需要放行。
  // 显示 One Tap 的页面（路由里 c.set('oneTap', true)）额外放开 Google 组件，其他页面保持严格策略。
  const policy = (oneTap, extensionAuth) => [
    "default-src 'none'",
    // Google 组件在不支持 FedCM 的浏览器里会向页面注入定位弹窗的内联样式，只在 One Tap 页放开样式（脚本仍严格限制）。
    `style-src 'self'${oneTap ? ` ${GSI}style 'unsafe-inline'` : ''}`,
    "img-src 'self'",
    `script-src 'self'${oneTap ? ` ${GSI}client` : ''}`,
    ...(oneTap ? [`frame-src ${GSI}`, `connect-src ${GSI}`] : []),
    // 扩展授权页确认后重定向回扩展的回调页，只放行这一次请求的扩展来源（chrome-extension://<扩展 ID>）。
    // 结账与订阅管理表单提交到本站后重定向到 Creem 的结账页和客户门户。
    `form-action 'self'${config.google ? ' https://accounts.google.com' : ''}${checkout ? ' https://creem.io https://*.creem.io' : ''}${extensionAuth ? ` ${extensionAuth}` : ''}`,
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
  const strict = policy(false, false);
  const withOneTap = policy(true, false);

  return async (c, next) => {
    await next();
    const headers = c.res.headers;
    headers.set('Content-Security-Policy', c.get('oneTap') ? withOneTap : c.get('extensionAuth') ? policy(false, c.get('extensionAuth')) : strict);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'same-origin');
    headers.set('X-Frame-Options', 'DENY');
    if (config.secureCookies) headers.set('Strict-Transport-Security', 'max-age=31536000');
    if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-store');
  };
}

/**
 * 所有修改状态的请求必须来自本站页面：Origin 与 APP_ORIGIN 一致，或浏览器标记为同源。
 * 与 SameSite=Lax 会话 Cookie 一起防止跨站请求伪造；不按内容类型放行。
 */
export function sameOriginWrites(config) {
  return async (c, next) => {
    if (!SAFE_METHODS.test(c.req.method)) {
      const origin = c.req.header('origin');
      const site = c.req.header('sec-fetch-site');
      if (origin !== config.appOrigin && site !== 'same-origin') return c.text('Forbidden', 403);
    }
    await next();
  };
}

/** 进程内滑动窗口限流，只在内存里保存短时计数，不落库。 */
export function createRateLimiter({ limit, windowMs }) {
  const hits = new Map();
  return (key, now = Date.now()) => {
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 10_000) {
      for (const [k, list] of hits) if (!list.some((t) => now - t < windowMs)) hits.delete(k);
    }
    return true;
  };
}

/** 反向代理之后使用 X-Forwarded-For 的第一个地址，需显式开启 TRUST_PROXY。 */
export function clientAddress(c, config) {
  if (config.trustProxy) {
    const forwarded = c.req.header('x-forwarded-for');
    if (forwarded) return forwarded.split(',')[0].trim();
  }
  return c.env?.incoming?.socket?.remoteAddress || 'unknown';
}

/**
 * 请求体大小限制。没有请求体的请求（既无 Content-Length 也无 Transfer-Encoding）直接放行：
 * hono 的 bodyLimit 会为它们重新包装 Request，本机经代理运行时（全局 Request 换成 undici 的实现）会因此出错。
 */
export function limitBody(maxSize, onError) {
  const limit = bodyLimit({ maxSize, onError });
  return (c, next) => (c.req.header('content-length') || c.req.header('transfer-encoding') ? limit(c, next) : next());
}

/**
 * 请求所在国家（两位代码），来自反向代理的地理请求头（GEO_COUNTRY_HEADER，如 Cloudflare 的 cf-ipcountry）。
 * 只用于运营报表；未配置或无法识别（XX、T1 等）时返回 null。不读取也不保存 IP 对应的更细位置。
 */
export function requestCountry(c, config) {
  if (!config.geoCountryHeader) return null;
  const value = String(c.req.header(config.geoCountryHeader) || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(value) && !['XX', 'T1', 'ZZ'].includes(value) ? value : null;
}
