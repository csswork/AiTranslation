/**
 * POST /webhooks/creem：Creem 的支付与订阅回调。先用原始请求体验签（creem-signature，HMAC-SHA256），
 * 验签失败返回 401；处理失败返回 500 让 Creem 重试。挂在站内同源校验之前（回调来自 Creem 服务器）。
 */
import { Hono } from 'hono';
import { handleCreemEvent } from '../billing/creem.js';
import { limitBody } from '../http/security.js';

export function creemWebhook({ pool, creem, log = console }) {
  const app = new Hono();
  app.use('*', limitBody(256 * 1024, (c) => c.text('too large', 413)));
  app.post('/', async (c) => {
    if (!creem) return c.text('not configured', 404);
    const raw = await c.req.text();
    if (!creem.verifyWebhook(raw, c.req.header('creem-signature'))) return c.text('invalid signature', 401);
    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      return c.text('invalid json', 400);
    }
    try {
      const result = await handleCreemEvent(pool, creem, event);
      return c.json({ ok: true, result });
    } catch (err) {
      // 只记录事件类型与错误类别，不记录回调内容（含客户资料）。
      log.error(`Creem 回调处理失败：${event?.eventType} ${err.code || err.message}`);
      return c.text('error', 500);
    }
  });
  return app;
}
