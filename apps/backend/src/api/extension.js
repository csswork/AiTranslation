/**
 * Chrome 扩展使用的接口（/api/extension/*）。由扩展的 service worker 调用：
 *   POST /token      授权码 + PKCE 换取扩展会话令牌
 *   GET  /me         当前用户名、点数、试用与订阅状态、托管翻译是否可用
 *   POST /logout     撤销当前扩展会话
 *   POST /translate  托管文字翻译：预扣点数，失败返还
 *
 * 认证用 Authorization: Bearer <扩展会话令牌>，不用 Cookie，所以不受站内表单的同源校验约束；
 * 只接受扩展会话（网页会话不能调用）。跨源请求头只发给允许的扩展来源（chrome-extension://<ID>）。
 */
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { isAllowedExtension, redeemAuthCode } from '../auth/extension.js';
import { createSession, revokeSession, validateSession } from '../auth/sessions.js';
import { creditSummary, refundCredits, reserveCredits } from '../credits/ledger.js';
import { transaction } from '../db/index.js';
import { createRateLimiter } from '../http/security.js';
import { LANGUAGES } from '../translation/languages.js';

const MAX_ITEMS = 100;

export function extensionApi({ config, pool, hosted = null, log = console }) {
  const app = new Hono();
  // 每个用户每分钟最多 60 次托管请求（内存计数，不落库）。
  const translateLimiter = createRateLimiter({ limit: 60, windowMs: 60_000 });

  app.use('*', async (c, next) => {
    const origin = c.req.header('origin') || '';
    const id = origin.match(/^chrome-extension:\/\/([a-p]{32})$/)?.[1];
    const allowed = id && isAllowedExtension(id, config);
    if (c.req.method === 'OPTIONS') {
      if (!allowed) return c.body(null, 403);
      return c.body(null, 204, {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': 'authorization, content-type',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
      });
    }
    await next();
    c.res.headers.set('Cache-Control', 'no-store');
    c.res.headers.set('Vary', 'Origin');
    if (allowed) c.res.headers.set('Access-Control-Allow-Origin', origin);
  });
  app.use('*', bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: 'too_large' }, 413) }));

  const readJson = async (c) => {
    try {
      return await c.req.json();
    } catch {
      return {};
    }
  };

  app.post('/token', async (c) => {
    const body = await readJson(c);
    const userId = await redeemAuthCode(pool, { code: body.code, codeVerifier: body.code_verifier, redirectUri: body.redirect_uri });
    if (!userId) return c.json({ error: 'invalid_grant' }, 400);
    const token = await createSession(pool, config, userId, 'extension');
    return c.json({ token, tokenType: 'Bearer' });
  });

  /** 只接受扩展会话；令牌无效、过期或已在用户端被退出时返回 401，扩展据此回到未登录状态。 */
  const requireExtension = async (c, next) => {
    const token = (c.req.header('authorization') || '').match(/^Bearer ([\w-]{20,100})$/)?.[1];
    const auth = token && await validateSession(pool, config, token);
    if (!auth || auth.session.client !== 'extension') return c.json({ error: 'unauthorized' }, 401);
    c.set('auth', auth);
    await next();
  };

  const status = async (userId) => {
    const credits = await creditSummary(pool, userId);
    const trialActive = credits.trialGranted && (!credits.trialExpiresAt || new Date(credits.trialExpiresAt) > new Date());
    return {
      credits: { balance: credits.balance, trialActive, trialExpiresAt: credits.trialExpiresAt },
      // 支付尚未接入：没有订阅时为 null，接入后返回套餐与有效期。
      subscription: null,
    };
  };

  app.get('/me', requireExtension, async (c) => {
    const { user } = c.get('auth');
    return c.json({
      username: user.username,
      ...(await status(user.id)),
      hosted: { available: Boolean(hosted), charsPerCredit: config.charsPerCredit, maxChars: config.hostedMaxChars },
      links: { account: `${config.appOrigin}/`, plans: `${config.appOrigin}/plans`, usage: `${config.appOrigin}/usage` },
    });
  });

  app.post('/logout', requireExtension, async (c) => {
    const { user, session } = c.get('auth');
    await revokeSession(pool, user.id, session.id);
    return c.json({ ok: true });
  });

  app.post('/translate', requireExtension, async (c) => {
    if (!hosted) return c.json({ error: 'hosted_unavailable' }, 503);
    const { user } = c.get('auth');
    const body = await readJson(c);
    const texts = Array.isArray(body.texts) ? body.texts : [];
    if (!texts.length || texts.length > MAX_ITEMS || texts.some((t) => typeof t !== 'string')) return c.json({ error: 'invalid_texts' }, 400);
    if (!LANGUAGES[body.target] || (body.source && !LANGUAGES[body.source])) return c.json({ error: 'invalid_language' }, 400);
    const chars = texts.reduce((sum, text) => sum + text.length, 0);
    if (!chars) return c.json({ error: 'invalid_texts' }, 400);
    if (chars > config.hostedMaxChars) return c.json({ error: 'too_long', maxChars: config.hostedMaxChars }, 413);
    if (!translateLimiter(user.id)) return c.json({ error: 'rate_limited' }, 429);

    const cost = Math.max(1, Math.ceil(chars / config.charsPerCredit));
    const eventId = randomUUID();
    const reserved = await transaction(pool, async (client) => {
      await client.query(
        `INSERT INTO usage_events (id, user_id, kind, chars, cost, status) VALUES ($1, $2, 'text', $3, $4, 'pending')`,
        [eventId, user.id, chars, cost],
      );
      if (await reserveCredits(client, user.id, cost, eventId)) return true;
      await client.query('DELETE FROM usage_events WHERE id = $1', [eventId]);
      return false;
    });
    if (!reserved) return c.json({ error: 'insufficient_credits', cost, ...(await status(user.id)) }, 402);

    let translations;
    try {
      translations = await hosted({ texts, target: body.target, source: body.source || null });
    } catch (err) {
      await refundCredits(pool, eventId);
      await pool.query(`UPDATE usage_events SET status = 'failed' WHERE id = $1`, [eventId]);
      log.warn(`托管翻译失败：${err.name === 'TimeoutError' ? 'timeout' : err.message}`);
      return c.json({ error: 'translation_failed', ...(await status(user.id)) }, 502);
    }
    await pool.query(`UPDATE usage_events SET status = 'ok' WHERE id = $1`, [eventId]);
    return c.json({ translations, cost, ...(await status(user.id)) });
  });

  return app;
}
