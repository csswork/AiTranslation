/**
 * Chrome 扩展使用的接口（/api/extension/*）。由扩展的 service worker 调用：
 *   POST /guest      安装后静默领取访客试用（见 src/guest），返回访客会话令牌与欢迎页地址
 *   POST /token      授权码 + PKCE 换取扩展会话令牌；带上访客令牌时把访客合并进正式账户
 *   GET  /me         当前用户名、用户类型、点数与订阅状态、托管翻译是否可用
 *   POST /logout     撤销当前扩展及其关联的网页登录
 *   GET  /ping       预热连接，不查库、不需要登录
 *   POST /translate  托管文字翻译：订阅用户不扣点，其他用户预扣点数、失败返还；每次记录统计元数据。
 *                    单段文字带 stream: true 时以 SSE 返回：data: {delta} … 最后 data: {done, cost, credits…} 或 data: {error…}
 *   POST /read-image 托管图片识别；文字随后走 /translate，按实际文字扣点
 *
 * 认证用 Authorization: Bearer <扩展会话令牌>，不用 Cookie，所以不受站内表单的同源校验约束；
 * 只接受扩展会话（网页会话不能调用）。跨源请求头只发给允许的扩展来源（chrome-extension://<ID>）。
 */
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { isAllowedExtension, redeemAuthCode } from '../auth/extension.js';
import { createSession, revokeExtensionLogin, validateSession } from '../auth/sessions.js';
import { accountState, activeSubscription } from '../billing/entitlements.js';
import { creditBalance, refundCredits, reserveCredits } from '../credits/ledger.js';
import { countCharacters, creditsToUnits, displayCredits } from '../credits/units.js';
import { transaction } from '../db/index.js';
import { createGuest, ipHash, mergeGuest } from '../guest/index.js';
import { clientAddress, createRateLimiter, limitBody, requestCountry } from '../http/security.js';
import { estimateCostMicros } from '../settings/index.js';
import { LANGUAGES } from '../translation/languages.js';

const MAX_ITEMS = 100;
const MAX_IMAGE_BODY = 8 * 1024 * 1024;

/** 只把图片输入交给模型，不在 VPS 上抓取用户提供的 URL。拒绝本地文件、SVG 与非图片数据。 */
function validImage(image) {
  if (typeof image !== 'string') return false;
  if (/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) {
    const data = image.slice(image.indexOf(',') + 1);
    return data.length % 4 === 0 && image.length < MAX_IMAGE_BODY;
  }
  if (image.length > 8192) return false;
  try {
    const url = new URL(image);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      && !/^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|\[|.*\.localhost$)/i.test(url.hostname);
  } catch { return false; }
}

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
  app.use('*', (c, next) => limitBody(c.req.path === '/api/extension/read-image' ? MAX_IMAGE_BODY : 64 * 1024,
    (c) => c.json({ error: 'too_large' }, 413))(c, next));

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
    // 扩展可以带上自己的界面语言（24 种语言 ID 之一），只用于报表。
    const body = await readJson(c);
    const uiLang = LANGUAGES[body.uiLanguage] ? body.uiLanguage : null;
    const result = await createGuest(pool, config, await settings.all(), address, { country: requestCountry(c, config), uiLang });
    return c.json({
      token: result.token,
      tokenType: 'Bearer',
      outcome: result.outcome,
      granted: displayCredits(result.grantedUnits),
      welcomeUrl: `${config.appOrigin}/welcome?link=${encodeURIComponent(result.linkCode)}`,
    });
  });

  // 本地测试专用，必须显式设置 DEV_TRIAL_RESET=1 才挂载（生产环境设置会拒绝启动）。不接受任何参数：
  // 删除本机这个网络的访客领取记录（领取次数重新计算），以及与这些访客、转成的账户关联的浏览器标记和已无主的标记；
  // 浏览器里旧的标记 Cookie 在库里找不到对应记录，欢迎页就会当成新浏览器。
  if (config.devTrialReset) {
    app.post('/dev/reset-trial', async (c) => {
      const hash = ipHash(config, clientAddress(c, config));
      const removed = await transaction(pool, async (client) => {
        const marks = await client.query(
          `DELETE FROM browser_marks WHERE user_id IS NULL OR user_id IN (
             SELECT user_id FROM guest_claims WHERE ip_hash = $1 AND user_id IS NOT NULL
             UNION SELECT merged_user_id FROM guest_claims WHERE ip_hash = $1 AND merged_user_id IS NOT NULL)`,
          [hash],
        );
        const claims = await client.query('DELETE FROM guest_claims WHERE ip_hash = $1', [hash]);
        return { claims: claims.rowCount, marks: marks.rowCount };
      });
      return c.json({ ok: true, removed });
    });
  } else {
    // 未开启时明确返回 404，不落到站内其他路由（扩展据此提示需要开启 DEV_TRIAL_RESET）。
    app.post('/dev/reset-trial', (c) => c.json({ error: 'not_found' }, 404));
  }

  app.post('/token', async (c) => {
    const body = await readJson(c);
    const grant = await redeemAuthCode(pool, { code: body.code, codeVerifier: body.code_verifier, redirectUri: body.redirect_uri });
    if (!grant) return c.json({ error: 'invalid_grant' }, 400);
    const { userId, webSessionId } = grant;
    // 扩展原来是访客：合并进刚登录的正式账户（剩余点数转入），访客会话随访客账户删除。
    const guest = typeof body.guest_token === 'string' && await validateSession(pool, config, body.guest_token);
    let transferred = 0n;
    if (guest && guest.user.kind === 'guest' && guest.session.client === 'extension') {
      transferred = await transaction(pool, (client) => mergeGuest(client, guest.user.id, userId));
    }
    const token = await createSession(pool, config, userId, 'extension', { webSessionId });
    return c.json({ token, tokenType: 'Bearer', transferred: displayCredits(transferred) });
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
        maxChars: s.hosted_max_chars,
        images: Boolean(hosted?.readImageText) && s.hosted_enabled && s.hosted_image_hourly_requests > 0 && !user.hosted_frozen_at,
      },
      // 引导文案用：注册可得的点数（访客显示「注册再送 N 点」）。
      offers: { signupCredits: displayCredits(creditsToUnits(s.signup_credits)) },
    });
  });

  // 预热连接：扩展在用户选中文字或右键时先请求一次，翻译请求就能复用已建好的 TLS 连接。不查库、不需要登录。
  app.get('/ping', (c) => c.body(null, 204));

  app.post('/logout', requireExtension, async (c) => {
    const { user, session } = c.get('auth');
    await revokeExtensionLogin(pool, user.id, session.id);
    return c.json({ ok: true });
  });

  /** 订阅用户本月已用字数（隐藏上限用）。 */
  const monthChars = async (userId) => (await pool.query(
    `SELECT COALESCE(SUM(chars), 0)::int AS chars FROM usage_events
     WHERE user_id = $1 AND status <> 'failed' AND created_at >= date_trunc('month', now())`,
    [userId],
  )).rows[0].chars;

  // 被拒绝的请求也记录（usage_rejections），但每个用户每种原因每分钟最多记 10 条，避免被刷写库。
  const rejectionLogLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

  app.post('/read-image', requireExtension, async (c) => {
    const s = await settings.all();
    const { user } = c.get('auth');
    if (!hosted?.readImageText || !s.hosted_enabled || !s.hosted_image_hourly_requests) return c.json({ error: 'hosted_unavailable' }, 503);
    if (user.hosted_frozen_at) return c.json({ error: 'frozen' }, 403);
    const body = await readJson(c);
    if (!validImage(body.image)) return c.json({ error: 'invalid_image' }, 400);
    const subscribed = user.kind === 'member' && Boolean(await activeSubscription(pool, user.id));
    if (!subscribed && (await creditBalance(pool, user.id)) <= 0n) {
      return c.json({ error: 'insufficient_credits', ...(await status(user)) }, 402);
    }
    if (subscribed && s.subscriber_monthly_chars && (await monthChars(user.id)) >= s.subscriber_monthly_chars) {
      return c.json({ error: 'fair_use' }, 429);
    }
    if (!translateLimiter(user.id)) return c.json({ error: 'rate_limited' }, 429);
    const eventId = randomUUID();
    const accepted = await transaction(pool, async (client) => {
      // 包括 pending 与 failed；并发与连续失败不能绕过图片次数上限。
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`images:${user.id}`]);
      const { rows: [row] } = await client.query(
        "SELECT COUNT(*)::int AS requests FROM usage_events WHERE user_id = $1 AND kind = 'image' AND created_at >= now() - interval '1 hour'", [user.id]);
      if (row.requests >= s.hosted_image_hourly_requests) return false;
      await client.query(
        `INSERT INTO usage_events (id, user_id, kind, chars, cost_units, status, audience, country)
         VALUES ($1, $2, 'image', 0, 0, 'pending', $3, $4)`,
        [eventId, user.id, subscribed ? 'subscriber' : user.kind, requestCountry(c, config)]);
      return true;
    });
    if (!accepted) return c.json({ error: 'rate_limited' }, 429);
    const record = (meta, state, error = null) => pool.query(
      `UPDATE usage_events SET status = $2, provider = $3, model = $4, input_tokens = $5, cached_tokens = $6,
       output_tokens = $7, cost_micros = $8, latency_ms = $9, error = $10 WHERE id = $1`,
      [eventId, state, meta?.provider ?? null, meta?.model ?? null, meta?.inputTokens ?? null, meta?.cachedTokens ?? null,
        meta?.outputTokens ?? null, meta?.inputTokens != null ? estimateCostMicros(s, meta.providerKey, meta) : null,
        meta?.latencyMs ?? null, error]);
    let result;
    try {
      result = await hosted.readImageText({ image: body.image });
    } catch (err) {
      // 不把模型响应或请求内容写进日志；识别没有扣点，不需要写返还流水。
      await record(err.meta, 'failed', /^[a-z_\d]{1,60}$/.test(err.code) ? err.code : 'image_failed');
      return c.json({ error: 'translation_failed', ...(await status(user)) }, 502);
    }
    await record(result.meta, 'ok');
    return c.json({ raw: result.raw, ...(await status(user)) });
  });

  app.post('/translate', requireExtension, async (c) => {
    const s = await settings.all();
    const { user } = c.get('auth');
    const body = await readJson(c);
    const texts = Array.isArray(body.texts) ? body.texts : [];
    if (!texts.length || texts.length > MAX_ITEMS || texts.some((t) => typeof t !== 'string')) return c.json({ error: 'invalid_texts' }, 400);
    if (!LANGUAGES[body.target] || (body.source && !LANGUAGES[body.source])) return c.json({ error: 'invalid_language' }, 400);
    const chars = countCharacters(texts);
    if (!chars) return c.json({ error: 'invalid_texts' }, 400);

    const subscribed = user.kind === 'member' && Boolean(await activeSubscription(pool, user.id));
    const audience = subscribed ? 'subscriber' : user.kind;
    /** 记录一次被拒绝的请求并返回对应的响应（不调用模型、不扣点、不保存原文）。 */
    const reject = async (reason, status, extra = {}, cost = null) => {
      if (rejectionLogLimiter(`${user.id}:${reason}`)) {
        await pool.query(
          `INSERT INTO usage_rejections (user_id, reason, audience, chars, cost_units, target_lang, country) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [user.id, reason, audience, chars, cost, body.target, requestCountry(c, config)],
        );
      }
      return c.json({ error: reason, ...extra }, status);
    };

    if (!hosted || !s.hosted_enabled) return reject('hosted_unavailable', 503);
    if (user.hosted_frozen_at) return reject('frozen', 403);
    if (chars > s.hosted_max_chars) return reject('too_long', 413, { maxChars: s.hosted_max_chars });
    if (!translateLimiter(user.id)) return reject('rate_limited', 429);
    if (subscribed && s.subscriber_monthly_chars && (await monthChars(user.id)) + chars > s.subscriber_monthly_chars) {
      return reject('fair_use', 429);
    }
    const cost = subscribed ? 0n : BigInt(chars);
    const eventId = randomUUID();
    const reserved = await transaction(pool, async (client) => {
      await client.query(
        `INSERT INTO usage_events (id, user_id, kind, chars, cost_units, status, audience, country, target_lang, source_lang)
         VALUES ($1, $2, 'text', $3, $4, 'pending', $5, $6, $7, $8)`,
        [eventId, user.id, chars, cost, audience, requestCountry(c, config), body.target, body.source || null],
      );
      if (await reserveCredits(client, user.id, cost, eventId)) return true;
      await client.query('DELETE FROM usage_events WHERE id = $1', [eventId]);
      return false;
    });
    if (!reserved) return reject('insufficient_credits', 402, { cost: displayCredits(cost), ...(await status(user)) }, cost);

    const record = (meta, fields) => pool.query(
      `UPDATE usage_events SET status = $2, provider = $3, model = $4, input_tokens = $5, cached_tokens = $6,
         output_tokens = $7, cost_micros = $8, latency_ms = $9, error = $10 WHERE id = $1`,
      [eventId, fields.status, meta?.provider ?? null, meta?.model ?? null, meta?.inputTokens ?? null, meta?.cachedTokens ?? null,
        meta?.outputTokens ?? null, meta?.inputTokens != null ? estimateCostMicros(s, meta.providerKey, meta) : null,
        meta?.latencyMs ?? null, fields.error ?? null],
    );

    // 单段文字可以流式返回（划词弹窗、翻译面板），边生成边显示；扣点、返还与记录和一次性返回相同。
    // 客户端中途断开时继续读完模型输出并照常结算，与一次性返回的行为一致。
    if (body.stream === true && texts.length === 1 && hosted.stream) {
      const encoder = new TextEncoder();
      let sink, open = true;
      const send = (payload) => {
        if (!open) return;
        try { sink.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)); } catch { open = false; }
      };
      const run = async () => {
        try {
          const result = await hosted.stream({ text: texts[0], target: body.target, source: body.source || null }, (delta) => send({ delta }));
          await record(result.meta, { status: 'ok', error: result.meta.fellBack ? 'primary_failed' : null });
          send({ done: true, cost: displayCredits(cost), ...(await status(user)) });
        } catch (err) {
          try {
            await refundCredits(pool, eventId);
            await record(err.meta, { status: 'failed', error: String(err.code || 'error').slice(0, 60) });
            log.warn(`托管翻译失败：${err.code || err.message}`);
            send({ error: 'translation_failed', ...(await status(user)) });
          } catch (inner) {
            log.error(`托管翻译结算失败：${inner.message}`);
            send({ error: 'translation_failed' });
          }
        } finally {
          if (open) try { sink.close(); } catch { /* 已关闭 */ }
        }
      };
      const stream = new ReadableStream({
        start(controller) { sink = controller; run(); },
        cancel() { open = false; },
      });
      return new Response(stream, {
        headers: { 'content-type': 'text/event-stream; charset=utf-8', 'x-accel-buffering': 'no' },
      });
    }

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
    return c.json({ translations: result.translations, cost: displayCredits(cost), ...(await status(user)) });
  });

  return app;
}
