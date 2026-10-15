/**
 * 管理员界面（管理端，ADMIN_ORIGIN，规划 admin.huaci.app）：A1–A9。
 * 独立的入口、会话 Cookie 与同源校验；普通用户会话在这里无效。每个修改操作都写审计（A9）。
 */
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import {
  audit, createAdminSession, findAdminByEmail, markVerified, revokeAdminSession, validateAdminSession,
} from '../../src/admin/auth.js';
import { overview } from '../../src/admin/reports.js';
import { newTotpSecret, openSecret, otpauthUrl, sealSecret, verifyTotp } from '../../src/admin/totp.js';
import { isValidEmail, normalizeEmail } from '../../src/auth/users.js';
import { issueCode, verifyCode } from '../../src/auth/email-codes.js';
import { accountState } from '../../src/billing/entitlements.js';
import { adjustCredits } from '../../src/credits/ledger.js';
import { clientAddress, createRateLimiter, limitBody } from '../../src/http/security.js';
import { SETTINGS } from '../../src/settings/index.js';
import * as views from './views.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ok = (text) => ({ kind: 'ok', text });
const fail = (text) => ({ kind: 'error', text });

export function adminRoutes({ config, pool, mailer, settings, creem = null, log = console }) {
  const app = new Hono();
  const secure = config.adminOrigin.startsWith('https://');
  const cookieName = secure ? '__Host-huaci_admin' : 'huaci_admin';
  const cookieBase = { httpOnly: true, secure, sameSite: 'Strict', path: '/' };
  const sendLimiter = createRateLimiter({ limit: 10, windowMs: 60 * 60 * 1000 });
  const totpLimiter = createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 });

  app.use('*', limitBody(16 * 1024, (c) => c.text('请求内容过大', 413)));
  // 修改状态的请求必须来自管理端自己的页面。
  app.use('*', async (c, next) => {
    if (!/^(GET|HEAD|OPTIONS)$/.test(c.req.method)) {
      if (c.req.header('origin') !== config.adminOrigin && c.req.header('sec-fetch-site') !== 'same-origin') return c.text('Forbidden', 403);
    }
    await next();
  });

  const tempOpts = { ...cookieBase, maxAge: 600 };
  // 开发环境没有发信服务（console）时，验证码直接显示在验证页上；生产环境不允许 console 发信，不会走到这里。
  const devCodes = !config.production && config.mailTransport === 'console';
  const flashNote = (c, note) => setCookie(c, 'admin_flash', JSON.stringify(note), { ...cookieBase, maxAge: 60 });
  const takeNote = (c) => {
    const raw = getCookie(c, 'admin_flash');
    if (!raw) return null;
    deleteCookie(c, 'admin_flash', cookieBase);
    try { return JSON.parse(raw); } catch { return null; }
  };
  const back = (c, path, note) => {
    if (note) flashNote(c, note);
    return c.redirect(path, 303);
  };

  app.use('*', async (c, next) => {
    c.set('adminAuth', await validateAdminSession(pool, getCookie(c, cookieName)));
    await next();
  });

  /** 只有通过二步验证的管理员会话可以进入。 */
  const requireAdmin = async (c, next) => {
    const auth = c.get('adminAuth');
    if (!auth) return c.redirect('/login', 303);
    if (!auth.session.verified) return c.redirect('/2fa', 303);
    await next();
  };
  const admin = (c) => c.get('adminAuth').admin;
  const reasonOf = (body) => String(body.reason || '').trim().slice(0, 200);

  /* ---------- A1 登录：邮箱验证码 + TOTP ---------- */

  app.get('/login', (c) => (c.get('adminAuth')?.session.verified ? c.redirect('/', 303) : c.html(views.loginPage({ note: takeNote(c) }))));

  app.post('/login', async (c) => {
    const body = await c.req.parseBody();
    const email = normalizeEmail(body.email);
    if (!isValidEmail(email)) return c.html(views.loginPage({ email, note: fail('请输入有效的邮箱地址。') }), 400);
    if (!sendLimiter(clientAddress(c, config))) return c.html(views.loginPage({ email, note: fail('请求过于频繁，请稍后再试。') }), 429);
    // 不论是否是管理员都显示同样的下一步，避免借此判断哪些邮箱是管理员。
    const found = await findAdminByEmail(pool, email);
    if (found) {
      const result = await issueCode(pool, config, { email, purpose: 'admin_login' });
      if (result.ok) await mailer.sendCode({ to: email, code: result.code, purpose: 'admin_login' });
      if (result.ok && devCodes) setCookie(c, 'admin_dev_code', result.code, tempOpts);
    }
    setCookie(c, 'admin_pending', email, tempOpts);
    return c.redirect('/login/verify', 303);
  });

  app.get('/login/verify', (c) => {
    const email = getCookie(c, 'admin_pending');
    if (!email) return c.redirect('/login', 303);
    return c.html(views.verifyPage({ email, note: takeNote(c), devCode: devCodes ? getCookie(c, 'admin_dev_code') : null }));
  });

  app.post('/login/verify', async (c) => {
    const email = getCookie(c, 'admin_pending');
    if (!email) return c.redirect('/login', 303);
    const body = await c.req.parseBody();
    const found = await findAdminByEmail(pool, email);
    const result = found ? await verifyCode(pool, config, { email, purpose: 'admin_login', code: body.code }) : { ok: false };
    if (!result.ok) return c.html(views.verifyPage({ email, note: fail('验证码不正确或已失效。') }), 400);
    deleteCookie(c, 'admin_pending', cookieBase);
    deleteCookie(c, 'admin_dev_code', cookieBase);
    const token = await createAdminSession(pool, found.id);
    setCookie(c, cookieName, token, { ...cookieBase, maxAge: 12 * 3600 });
    if (!config.adminRequire2fa) {
      // 本地开发不做二步验证（生产环境始终要求）。
      const auth = await validateAdminSession(pool, token);
      await markVerified(pool, auth.session.id);
      await audit(pool, { adminId: found.id, action: 'admin.login', detail: { twoFactor: 'skipped_dev' } });
      return c.redirect('/', 303);
    }
    return c.redirect('/2fa', 303);
  });

  app.get('/2fa', async (c) => {
    const auth = c.get('adminAuth');
    if (!auth) return c.redirect('/login', 303);
    if (auth.session.verified) return c.redirect('/', 303);
    if (auth.admin.totp_enabled_at) return c.html(views.totpPage({ note: takeNote(c) }));
    // 首次登录：生成新密钥（加密保存，完成验证后才启用）。
    let secret = auth.admin.totp_secret ? openSecret(config.authSecret, auth.admin.totp_secret) : null;
    if (!secret) {
      secret = newTotpSecret();
      await pool.query('UPDATE admins SET totp_secret = $2 WHERE user_id = $1', [auth.admin.id, sealSecret(config.authSecret, secret)]);
    }
    return c.html(views.totpPage({ setup: { secret, url: otpauthUrl(secret, auth.admin.email) }, note: takeNote(c) }));
  });

  app.post('/2fa', async (c) => {
    const auth = c.get('adminAuth');
    if (!auth) return c.redirect('/login', 303);
    if (!totpLimiter(auth.admin.id)) return back(c, '/2fa', fail('尝试次数过多，请 10 分钟后再试。'));
    const body = await c.req.parseBody();
    const secret = auth.admin.totp_secret && openSecret(config.authSecret, auth.admin.totp_secret);
    const step = secret && verifyTotp(secret, body.code, { lastStep: auth.admin.totp_last_step });
    if (!step) return back(c, '/2fa', fail('验证码不正确。'));
    await pool.query(
      'UPDATE admins SET totp_last_step = $2, totp_enabled_at = COALESCE(totp_enabled_at, now()) WHERE user_id = $1',
      [auth.admin.id, step],
    );
    await markVerified(pool, auth.session.id);
    await audit(pool, { adminId: auth.admin.id, action: auth.admin.totp_enabled_at ? 'admin.login' : 'admin.totp_enabled' });
    return c.redirect('/', 303);
  });

  app.post('/logout', async (c) => {
    const auth = c.get('adminAuth');
    if (auth) await revokeAdminSession(pool, auth.session.id);
    deleteCookie(c, cookieName, cookieBase);
    return c.redirect('/login', 303);
  });

  /* ---------- A2 运营概览 ---------- */

  app.get('/', requireAdmin, async (c) => {
    const days = [7, 30, 90].includes(Number(c.req.query('days'))) ? Number(c.req.query('days')) : 30;
    return c.html(views.overviewPage({ admin: admin(c), r: await overview(pool, days) }));
  });

  /* ---------- A3 用户 ---------- */

  app.get('/users', requireAdmin, async (c) => {
    const q = String(c.req.query('q') || '').trim().toLowerCase().slice(0, 254);
    const { rows: users } = await pool.query(
      `SELECT u.id, u.kind, u.email, u.username, u.created_at, u.hosted_frozen_at,
              (SELECT status FROM subscriptions s WHERE s.user_id = u.id ORDER BY updated_at DESC LIMIT 1) AS sub_status,
              (SELECT COALESCE(SUM(g.amount + COALESCE((SELECT SUM(x.amount) FROM credit_ledger x WHERE x.grant_id = g.id), 0)), 0)
                 FROM credit_ledger g WHERE g.user_id = u.id AND g.grant_id IS NULL AND g.amount > 0
                   AND (g.expires_at IS NULL OR g.expires_at > now()))::int AS balance
       FROM users u
       WHERE ($1 = '' AND u.kind = 'member') OR u.email = $1 OR u.username LIKE $2 OR u.id::text = $1
       ORDER BY u.created_at DESC LIMIT 100`,
      [q, `%${q.replace(/[%_\\]/g, '\\$&')}%`],
    );
    return c.html(views.usersPage({ admin: admin(c), q, users }));
  });

  const loadUser = async (id) => (UUID.test(id)
    ? (await pool.query('SELECT id, kind, email, username, email_verified_at, hosted_frozen_at, created_at FROM users WHERE id = $1', [id])).rows[0]
    : null);

  app.get('/users/:id', requireAdmin, async (c) => {
    const u = await loadUser(c.req.param('id'));
    if (!u) return c.html(views.errorPage({ admin: admin(c), status: 404, message: '找不到这个用户。' }), 404);
    const [state, subs, ledger, events, sessions] = await Promise.all([
      accountState(pool, u),
      pool.query('SELECT plan, status, current_period_end, provider_subscription_id, updated_at FROM subscriptions WHERE user_id = $1 ORDER BY updated_at DESC', [u.id]),
      pool.query('SELECT entry_type, amount, reason, created_at FROM credit_ledger WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100', [u.id]),
      pool.query('SELECT audience, chars, cost, model, cost_micros, latency_ms, status, error, created_at FROM usage_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [u.id]),
      pool.query('SELECT COUNT(*)::int AS n FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()', [u.id]),
    ]);
    return c.html(views.userPage({
      admin: admin(c), u, state, subs: subs.rows, ledger: ledger.rows, events: events.rows, sessions: sessions.rows[0].n, note: takeNote(c),
    }));
  });

  /** 用户操作：必须填写原因，写审计。 */
  const userAction = (path, action, run) => app.post(`/users/:id/${path}`, requireAdmin, async (c) => {
    const u = await loadUser(c.req.param('id'));
    if (!u) return c.notFound();
    const body = await c.req.parseBody();
    const reason = reasonOf(body);
    if (!reason) return back(c, `/users/${u.id}`, fail('请填写原因。'));
    const detail = await run(u, body, reason, c);
    if (detail === false) return back(c, `/users/${u.id}`, fail('输入无效。'));
    await audit(pool, { adminId: admin(c).id, action, targetType: 'user', targetId: u.id, reason, detail });
    return back(c, `/users/${u.id}`, ok('已完成。'));
  });

  userAction('credits', 'credits.adjust', async (u, body, reason) => {
    const amount = Number(body.amount);
    if (!Number.isInteger(amount) || amount <= 0 || amount > 100_000) return false;
    await adjustCredits(pool, { userId: u.id, amount, reason, requestId: randomUUID() });
    return { amount };
  });
  userAction('freeze', 'user.freeze_hosted', async (u) => {
    await pool.query('UPDATE users SET hosted_frozen_at = COALESCE(hosted_frozen_at, now()) WHERE id = $1', [u.id]);
  });
  userAction('unfreeze', 'user.unfreeze_hosted', async (u) => {
    await pool.query('UPDATE users SET hosted_frozen_at = NULL WHERE id = $1', [u.id]);
  });
  userAction('revoke-sessions', 'user.revoke_sessions', async (u) => {
    const { rowCount } = await pool.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [u.id]);
    return { revoked: rowCount };
  });

  /* ---------- A5 订阅与订单 ---------- */

  app.get('/subscriptions', requireAdmin, async (c) => {
    const status = ['active', 'scheduled_cancel', 'past_due', 'canceled', 'expired'].includes(c.req.query('status')) ? c.req.query('status') : '';
    const [subs, orders] = await Promise.all([
      pool.query(
        `SELECT s.*, u.username FROM subscriptions s LEFT JOIN users u ON u.id = s.user_id
         WHERE $1 = '' OR s.status = $1 ORDER BY s.updated_at DESC LIMIT 200`,
        [status],
      ),
      pool.query('SELECT o.*, u.username FROM orders o LEFT JOIN users u ON u.id = o.user_id ORDER BY o.created_at DESC LIMIT 200'),
    ]);
    return c.html(views.subscriptionsPage({ admin: admin(c), subs: subs.rows, orders: orders.rows, status }));
  });

  /* ---------- A6 点数账本 ---------- */

  app.get('/ledger', requireAdmin, async (c) => {
    const types = ['trial_grant', 'guest_grant', 'transfer', 'adjust', 'usage', 'refund', 'void'];
    const type = types.includes(c.req.query('type')) ? c.req.query('type') : '';
    const { rows } = await pool.query(
      `SELECT l.user_id, u.username, l.entry_type, l.amount, l.reason, l.created_at
       FROM credit_ledger l JOIN users u ON u.id = l.user_id
       WHERE $1 = '' OR l.entry_type = $1 ORDER BY l.created_at DESC LIMIT 300`,
      [type],
    );
    return c.html(views.ledgerPage({ admin: admin(c), entries: rows, type }));
  });

  /* ---------- A4 / A7 规则与服务配置 ---------- */

  const services = () => [
    { label: '主力模型', ok: Boolean(config.hosted.apiKey), value: config.hosted.apiKey ? `${config.hosted.model} · ${new URL(config.hosted.baseUrl).host}` : '未配置' },
    { label: '备用模型', ok: Boolean(config.hosted.fallback), value: config.hosted.fallback ? `${config.hosted.fallback.model} · ${new URL(config.hosted.fallback.baseUrl).host}` : '未配置' },
    { label: 'Creem 收款', ok: Boolean(creem), value: creem ? (creem.testMode ? '测试模式' : '正式') : '未配置' },
    { label: '发信服务', ok: config.mailTransport !== 'console', value: config.mailTransport },
  ];

  app.get('/settings', requireAdmin, async (c) => c.html(views.settingsPage({
    admin: admin(c), values: await settings.all(), defaults: settings.defaults(), services: services(), note: takeNote(c),
  })));

  app.post('/settings', requireAdmin, async (c) => {
    const body = await c.req.parseBody();
    const reason = reasonOf(body);
    if (!reason) return back(c, '/settings', fail('请填写修改原因。'));
    const changes = {};
    for (const def of SETTINGS) {
      if (!(def.key in body)) continue;
      try {
        const { before, after } = await settings.set(def.key, body[def.key], admin(c).id);
        if (String(before) !== String(after)) changes[def.key] = { before, after };
      } catch {
        return back(c, '/settings', fail(`「${def.label}」的值无效，没有保存这一组。`));
      }
    }
    if (Object.keys(changes).length) await audit(pool, { adminId: admin(c).id, action: 'settings.update', targetType: 'settings', reason, detail: changes });
    return back(c, '/settings', ok(Object.keys(changes).length ? '已保存。' : '没有变化。'));
  });

  /* ---------- A8 异常 ---------- */

  app.get('/events', requireAdmin, async (c) => {
    const [failures, errorCounts, payments] = await Promise.all([
      pool.query(
        `SELECT e.user_id, u.username, e.provider, e.model, e.chars, e.latency_ms, e.error, e.created_at
         FROM usage_events e JOIN users u ON u.id = e.user_id WHERE e.status = 'failed' ORDER BY e.created_at DESC LIMIT 100`,
      ),
      pool.query(
        `SELECT error, COUNT(*)::int AS n FROM usage_events
         WHERE error IS NOT NULL AND created_at > now() - interval '7 days' GROUP BY error ORDER BY n DESC`,
      ),
      pool.query('SELECT event_type, object_id, received_at, processed_at, error FROM payment_events ORDER BY received_at DESC LIMIT 100'),
    ]);
    return c.html(views.eventsPage({ admin: admin(c), failures: failures.rows, errorCounts: errorCounts.rows, payments: payments.rows }));
  });

  /* ---------- A9 操作审计 ---------- */

  app.get('/audit', requireAdmin, async (c) => {
    const { rows } = await pool.query(
      `SELECT a.*, u.email AS admin_email FROM admin_audit a LEFT JOIN users u ON u.id = a.admin_id ORDER BY a.created_at DESC LIMIT 300`,
    );
    return c.html(views.auditPage({ admin: admin(c), rows }));
  });

  app.notFound((c) => c.html(views.errorPage({ admin: c.get('adminAuth')?.session.verified ? admin(c) : null, status: 404, message: '找不到这个页面。' }), 404));
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    log.error(err);
    return c.html(views.errorPage({ status: 500, message: '服务暂时不可用。' }), 500);
  });

  return app;
}
