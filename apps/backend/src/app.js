/**
 * 组装 VPS 服务：用户管理界面与官网登录状态接口；管理员界面和扩展 API 以后在这里按主机名或路径挂载，
 * 各自验证权限。
 */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { webApi } from './api/web.js';
import { sameOriginWrites, securityHeaders } from './http/security.js';
import { assets } from '../ui/account/assets.js';
import { uiContext } from '../ui/account/context.js';
import { accountRoutes } from '../ui/account/routes.js';
import { errorPage } from '../ui/account/views.js';

export function createApp({ config, pool, mailer, google = null, log = console }) {
  const app = new Hono();

  app.use('*', securityHeaders(config));

  app.get('/assets/:name', (c) => {
    const asset = assets.get(c.req.param('name'));
    if (!asset) return c.notFound();
    // 页面引用的地址带内容哈希；版本不符（旧页面）时不长期缓存。
    const cache = c.req.query('v') === asset.version ? 'public, max-age=31536000, immutable' : 'no-cache';
    return c.body(asset.body, 200, { 'Content-Type': asset.type, 'Cache-Control': cache });
  });

  app.get('/healthz', (c) => c.text('ok'));

  app.use('*', sameOriginWrites(config));
  app.use('*', bodyLimit({ maxSize: 16 * 1024, onError: (c) => c.text('请求内容过大', 413) }));

  app.route('/api/web', webApi({ config, pool }));
  app.route('/', accountRoutes({ config, pool, mailer, google, log }));

  app.notFound((c) => c.html(errorPage(uiContext(c, config), { status: 404, user: c.get('auth')?.user }), 404));
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    log.error(err);
    return c.html(errorPage(uiContext(c, config), { status: 500 }), 500);
  });

  return app;
}
