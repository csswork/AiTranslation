/**
 * Chrome 扩展使用的接口（/api/extension/*）。由扩展的 service worker 调用：
 *   POST /guest      安装后静默领取访客试用（见 src/guest），返回访客会话令牌与欢迎页地址
 *   POST /token      授权码 + PKCE 换取扩展会话令牌；带上访客令牌时把访客合并进正式账户
 *   GET  /me         当前用户名、用户类型、点数与订阅状态、托管翻译是否可用
 *   POST /logout     撤销当前扩展会话
 *   POST /translate  托管文字翻译：订阅用户不扣点，其他用户预扣点数、失败返还；每次记录统计元数据
 *
 * 认证用 Authorization: Bearer <扩展会话令牌>，不用 Cookie，所以不受站内表单的同源校验约束；
 * 只接受扩展会话（网页会话不能调用）。跨源请求头只发给允许的扩展来源（chrome-extension://<ID>）。
 */
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { isAllowedExtension, redeemAuthCode } from '../auth/extension.js';
import { createSession, revokeSession, validateSession } from '../auth/sessions.js';
import { accountState, activeSubscription } from '../billing/entitlements.js';
import { refundCredits, reserveCredits } from '../credits/ledger.js';
import { transaction } from '../db/index.js';
import { createGuest, mergeGuest } from '../guest/index.js';
import { clientAddress, createRateLimiter, limitBody } from '../http/security.js';
import { estimateCostMicros } from '../settings/index.js';
import { LANGUAGES } from '../translation/languages.js';

const MAX_ITEMS = 100;

export function extensionApi({ config, pool, settings, hosted = null, log = console }) {
  const app = new Hono();
  // 每个用户每分钟最多 60 次托管请求；每个来源地址每小时最多新建 10 个访客（内存计数，不落库）。
  const translateLimiter = createRateLimiter({ limit: 60, windowMs: 60_000 });
  const guestLimiter = createRateLimiter({ limit: 10, windowMs: 60 * 60_000 });

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
  app.use('*', limitBody(64 * 1024, (c) => c.json({ error: 'too_large' }, 413)));

  const readJson = async (c) => {
    try {
      return await c.req.json();
    } catch {
      return {};
    }
  };

  app.post('/guest', async (c) => {
    const address = clientAddress(c, config);
    if (!guestLimiter(address)) return c.json({ error: 'rate_limited' }, 429);
    const result = await createGuest(pool, config, await settings.all(), address);
    return c.json({
      token: result.token,
      tokenType: 'Bearer',
      outcome: result.outcome,
      granted: result.granted,
      welcomeUrl: `${config.appOrigin}/welcome?link=${encodeURIComponent(result.linkCode)}`,
    });
  });

  app.post('/token', async (c) => {
    const body = await readJson(c);
    const userId = await redeemAuthCode(pool, { code: body.code, codeVerifier: body.code_verifier, redirectUri: body.redirect_uri });
    if (!userId) return c.json({ error: 'invalid_grant' }, 400);
    // 扩展原来是访客：合并进刚登录的正式账户（剩余点数转入），访客会话随访客账户删除。
    const guest = typeof body.guest_token === 'string' && await validateSession(pool, config, body.guest_token);
    let transferred = 0;
    if (guest && guest.user.kind === 'guest' && guest.session.client === 'extension') {
      transferred = await transaction(pool, (client) => mergeGuest(client, guest.user.id, userId));
    }
    const token = await createSession(pool, config, userId, 'extension');
    return c.json({ token, tokenType: 'Bearer', transferred });
  });

  /** 只接受扩展会话；令牌无效、过期或已在用户端被退出时返回 401，扩展据此回到未登录状态。 */
  const requireExtension = async (c, next) => {
    const token = (c.req.header('authorization') || '').match(/^Bearer ([\w-]{20,100})$/)?.[1];
    const auth = token && await validateSession(pool, config, token);
    if (!auth || auth.session.client !== 'extension') return c.json({ error: 'unauthorized' }, 401);
    c.set('auth', auth);
    await next();
  };

  const status = async (user) => {
    const { kind, credits, subscription } = await accountState(pool, user);
    return { kind, credits, subscription };
  };

  app.get('/me', requireExtension, async (c) => {
    const { user } = c.get('auth');
    const s = await settings.all();
    return c.json({
      username: user.kind === 'guest' ? '' : user.username,
      ...(await status(user)),
      hosted: {
        available: Boolean(hosted) && s.hosted_enabled && !user.hosted_frozen_at,
        charsPerCredit: s.chars_per_credit,
        maxChars: s.hosted_max_chars,
      },
      // 引导文案用：注册可得的点数（访客显示「注册再送 N 点」）。
      offers: { signupCredits: s.signup_credits },
    });
  });

  app.post('/logout', requireExtension, async (c) => {
    const { user, session } = c.get('auth');
    await revokeSession(pool, user.id, session.id);
    return c.json({ ok: true });
  });

  /** 订阅用户本月已用字数（隐藏上限用）。 */
  const monthChars = async (userId) => (await pool.query(
    `SELECT COALESCE(SUM(chars), 0)::int AS chars FROM usage_events
     WHERE user_id = $1 AND status <> 'failed' AND created_at >= date_trunc('month', now())`,
    [userId],
  )).rows[0].chars;

  app.post('/translate', requireExtension, async (c) => {
    const s = await settings.all();
    if (!hosted || !s.hosted_enabled) return c.json({ error: 'hosted_unavailable' }, 503);
    const { user } = c.get('auth');
    if (user.hosted_frozen_at) return c.json({ error: 'frozen' }, 403);
    const body = await readJson(c);
    const texts = Array.isArray(body.texts) ? body.texts : [];
    if (!texts.length || texts.length > MAX_ITEMS || texts.some((t) => typeof t !== 'string')) return c.json({ error: 'invalid_texts' }, 400);
    if (!LANGUAGES[body.target] || (body.source && !LANGUAGES[body.source])) return c.json({ error: 'invalid_language' }, 400);
    const chars = texts.reduce((sum, text) => sum + text.length, 0);
    if (!chars) return c.json({ error: 'invalid_texts' }, 400);
    if (chars > s.hosted_max_chars) return c.json({ error: 'too_long', maxChars: s.hosted_max_chars }, 413);
    if (!translateLimiter(user.id)) return c.json({ error: 'rate_limited' }, 429);

    const subscribed = user.kind === 'member' && Boolean(await activeSubscription(pool, user.id));
    if (subscribed && s.subscriber_monthly_chars && (await monthChars(user.id)) + chars > s.subscriber_monthly_chars) {
      return c.json({ error: 'fair_use' }, 429);
    }
    const audience = subscribed ? 'subscriber' : user.kind;
    const cost = subscribed ? 0 : Math.max(1, Math.ceil(chars / s.chars_per_credit));
    const eventId = randomUUID();
    const reserved = await transaction(pool, async (client) => {
      await client.query(
        `INSERT INTO usage_events (id, user_id, kind, chars, cost, status, audience) VALUES ($1, $2, 'text', $3, $4, 'pending', $5)`,
        [eventId, user.id, chars, cost, audience],
      );
      if (await reserveCredits(client, user.id, cost, eventId)) return true;
      await client.query('DELETE FROM usage_events WHERE id = $1', [eventId]);
      return false;
    });
    if (!reserved) return c.json({ error: 'insufficient_credits', cost, ...(await status(user)) }, 402);

    const record = (meta, fields) => pool.query(
      `UPDATE usage_events SET status = $2, provider = $3, model = $4, input_tokens = $5, cached_tokens = $6,
         output_tokens = $7, cost_micros = $8, latency_ms = $9, error = $10 WHERE id = $1`,
      [eventId, fields.status, meta?.provider ?? null, meta?.model ?? null, meta?.inputTokens ?? null, meta?.cachedTokens ?? null,
        meta?.outputTokens ?? null, meta?.inputTokens != null ? estimateCostMicros(s, meta.providerKey, meta) : null,
        meta?.latencyMs ?? null, fields.error ?? null],
    );

    let result;
    try {
      result = await hosted({ texts, target: body.target, source: body.source || null });
    } catch (err) {
      await refundCredits(pool, eventId);
      await record(err.meta, { status: 'failed', error: String(err.code || 'error').slice(0, 60) });
      log.warn(`托管翻译失败：${err.code || err.message}`);
      return c.json({ error: 'translation_failed', ...(await status(user)) }, 502);
    }
    await record(result.meta, { status: 'ok', error: result.meta.fellBack ? 'primary_failed' : null });
    return c.json({ translations: result.translations, cost, ...(await status(user)) });
  });

  return app;
}
