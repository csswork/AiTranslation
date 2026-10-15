/**
 * 官网（huaci.app）读取登录状态的接口。只读，不修改任何数据。
 *
 * 官网与用户端是同一站点（*.huaci.app）的不同来源：浏览器带 credentials 跨源请求时会附上
 * 用户端的会话 Cookie（SameSite=Lax 对同站请求有效），服务端只对 WEB_ORIGINS 白名单返回 CORS 头。
 * 响应只含显示所需的用户名、点数、是否订阅和账户地址，不含邮箱或内部 ID。
 */
import { Hono } from 'hono';
import { validateWebSession } from '../auth/sessions.js';
import { accountState } from '../billing/entitlements.js';
import { getSessionToken } from '../http/cookies.js';

export function webApi({ config, pool }) {
  const app = new Hono();

  app.use('*', async (c, next) => {
    await next();
    const origin = c.req.header('origin');
    c.res.headers.set('Vary', 'Origin');
    c.res.headers.set('Cache-Control', 'no-store');
    if (origin && config.webOrigins.includes(origin)) {
      c.res.headers.set('Access-Control-Allow-Origin', origin);
      c.res.headers.set('Access-Control-Allow-Credentials', 'true');
    }
  });

  app.get('/session', async (c) => {
    const loginUrl = `${config.appOrigin}/login`;
    const auth = await validateWebSession(pool, config, getSessionToken(c, config));
    if (!auth) return c.json({ signedIn: false, loginUrl });
    const state = await accountState(pool, auth.user);
    return c.json({
      signedIn: true,
      username: auth.user.username,
      credits: state.credits,
      subscription: state.subscription ? { unlimited: true } : null,
      accountUrl: `${config.appOrigin}/`,
    });
  });

  return app;
}
