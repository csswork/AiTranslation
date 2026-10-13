/** 通用安全响应头与修改状态请求的来源校验。 */

const SAFE_METHODS = /^(GET|HEAD|OPTIONS)$/;

export function securityHeaders(config) {
  // 只允许本站脚本（配色切换与语言下拉的增强）；表单提交到 Google 登录会经过重定向，form-action 需要放行。
  const csp = [
    "default-src 'none'",
    "style-src 'self'",
    "img-src 'self'",
    "script-src 'self'",
    `form-action 'self'${config.google ? ' https://accounts.google.com' : ''}`,
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
  return async (c, next) => {
    await next();
    const headers = c.res.headers;
    headers.set('Content-Security-Policy', csp);
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
