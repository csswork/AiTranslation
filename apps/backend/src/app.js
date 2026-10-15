/**
 * 组装 VPS 服务：用户管理界面、官网登录状态接口、扩展 API、支付回调，以及按主机名区分的管理员界面
 * （ADMIN_ORIGIN）。各部分自己验证权限；管理端与用户端的会话互不通用。
 */
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { adminRoutes } from '../ui/admin/routes.js';
import { extensionApi } from './api/extension.js';
import { webApi } from './api/web.js';
import { createSettings } from './settings/index.js';
import { creemWebhook } from './webhooks/creem.js';
import { limitBody, sameOriginWrites, securityHeaders } from './http/security.js';
import { assets } from '../ui/account/assets.js';
import { uiContext } from '../ui/account/context.js';
import { accountRoutes } from '../ui/account/routes.js';
import { errorPage } from '../ui/account/views.js';

export function createApp({
  config, pool, mailer, google = null, googleIdToken = null, hosted = null, creem = null, settings = createSettings(pool, config), log = console,
}) {
  const app = new Hono();
  const adminHost = config.adminOrigin ? new URL(config.adminOrigin).host : null;
  const isAdminHost = (c) => adminHost && new URL(c.req.url).host === adminHost;

  app.use('*', securityHeaders(config, { checkout: Boolean(creem) }));

  app.get('/assets/:name', (c) => {
    const asset = assets.get(c.req.param('name'));
    if (!asset) return c.notFound();
    // 页面引用的地址带内容哈希；版本不符（旧页面）时不长期缓存。
    const cache = c.req.query('v') === asset.version ? 'public, max-age=31536000, immutable' : 'no-cache';
    return c.body(asset.body, 200, { 'Content-Type': asset.type, 'Cache-Control': cache });
  });

  app.get('/healthz', (c) => c.text('ok'));

  // 管理端：独立主机名，整棵路由交给管理员界面（自带同源校验、管理员会话和二步验证）。
  if (adminHost) {
    const admin = adminRoutes({ config, pool, mailer, settings, creem, log });
    app.use('*', async (c, next) => (isAdminHost(c) ? admin.fetch(c.req.raw, c.env) : next()));
  }

  // 扩展接口用 Bearer 令牌而不是 Cookie，挂在站内同源校验之前（它对扩展来源的请求一律拒绝）。
  app.route('/api/extension', extensionApi({ config, pool, settings, hosted, log }));
  // 支付回调来自 Creem 服务器，凭签名验证。
  app.route('/webhooks/creem', creemWebhook({ pool, creem, log }));

  app.use('*', sameOriginWrites(config));
  app.use('*', limitBody(16 * 1024, (c) => c.text('请求内容过大', 413)));

  app.route('/api/web', webApi({ config, pool }));
  app.route('/', accountRoutes({ config, pool, mailer, google, googleIdToken, settings, creem, log }));

  app.notFound((c) => c.html(errorPage(uiContext(c, config), { status: 404, user: c.get('auth')?.user }), 404));
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    log.error(err);
    return c.html(errorPage(uiContext(c, config), { status: 500 }), 500);
  });

  return app;
}
