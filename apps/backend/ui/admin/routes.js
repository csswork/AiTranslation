/**
 * 管理员界面（管理端，ADMIN_ORIGIN，规划 admin.huaci.app）：A1–A9。
 * 独立的入口、会话 Cookie 与同源校验；普通用户会话在这里无效。每个修改操作都写审计（A9）。
 */
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import {
  ADMIN_PENDING_SESSION_MAX_AGE, ADMIN_SESSION_MAX_AGE,
  audit, createAdminSession, findAdminByEmail, markVerified, revokeAdminSession, validateAdminSession,
} from '../../src/admin/auth.js';
import { dayLabels, listExpenses, parseExpense } from '../../src/admin/finance.js';
import { apiUsageByUser, apiUsageForUser, overview } from '../../src/admin/reports.js';
import { newTotpSecret, openSecret, otpauthUrl, sealSecret, verifyTotp } from '../../src/admin/totp.js';
import { deleteUser, deletionSummary } from '../../src/admin/users.js';
import { isValidEmail, normalizeEmail } from '../../src/auth/users.js';
import { issueCode, verifyCode } from '../../src/auth/email-codes.js';
import { accountState } from '../../src/billing/entitlements.js';
import { adjustCredits } from '../../src/credits/ledger.js';
import { creditsToUnits, displayCredits } from '../../src/credits/units.js';
import { clearPreference, setPreference } from '../../src/http/cookies.js';
import { clientAddress, createRateLimiter, limitBody } from '../../src/http/security.js';
import { SETTINGS } from '../../src/settings/index.js';
import { creditActivity } from '../../src/usage/activity.js';
import { THEMES, safePath } from '../account/context.js';
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
  // 数据库与浏览器同时保留 30 天，只有完整登录成功后才写入长期 Cookie。
  const completeLogin = async (c, sessionId, token) => {
    if (!await markVerified(pool, sessionId)) return false;
    setCookie(c, cookieName, token, { ...cookieBase, maxAge: ADMIN_SESSION_MAX_AGE });
    return true;
  };

  app.use('*', async (c, next) => {
    const token = getCookie(c, cookieName);
    let auth = await validateAdminSession(pool, token);
    // 本地开发不要求二步验证：之前（例如打开二步验证时）留下的未验证会话直接视为已验证。
    if (auth && !auth.session.verified && !config.adminRequire2fa) {
      if (await completeLogin(c, auth.session.id, token)) auth.session.verified = true;
      else auth = null;
    }
    c.set('adminAuth', auth);
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

  /** 渲染管理端页面：带上与用户端共用的配色（theme Cookie）和当前路径。 */
  const page = (c, render, status = 200) => {
    const theme = THEMES.includes(getCookie(c, 'theme')) ? getCookie(c, 'theme') : null;
    const path = c.req.method === 'GET' ? c.req.path : '/';
    return c.html(views.withPage({ theme, cookieDomain: config.sharedCookieDomain, path }, render), status);
  };

  /* ---------- 配色：与用户端、官网共用 theme Cookie ---------- */

  app.post('/preferences/theme', async (c) => {
    const body = await c.req.parseBody();
    if (THEMES.includes(body.theme)) setPreference(c, config, 'theme', body.theme);
    else clearPreference(c, config, 'theme');
    return c.redirect(safePath(body.next), 303);
  });

  /* ---------- A1 登录：邮箱验证码 + TOTP ---------- */

  app.get('/login', (c) => (c.get('adminAuth')?.session.verified ? c.redirect('/', 303) : page(c, () => views.loginPage({ note: takeNote(c) }))));

  app.post('/login', async (c) => {
    const body = await c.req.parseBody();
    const email = normalizeEmail(body.email);
    if (!isValidEmail(email)) return page(c, () => views.loginPage({ email, note: fail('请输入有效的邮箱地址。') }), 400);
    if (!sendLimiter(clientAddress(c, config))) return page(c, () => views.loginPage({ email, note: fail('请求过于频繁，请稍后再试。') }), 429);
    // 不论是否是管理员都显示同样的下一步，避免借此判断哪些邮箱是管理员。
    const found = await findAdminByEmail(pool, email);
    if (found) {
      const result = await issueCode(pool, config, { email, purpose: 'admin_login' });
      if (result.ok) {
        await mailer.sendCode({ to: email, code: result.code, purpose: 'admin_login', locale: 'zh-Hans' })
          .catch((err) => log.warn(`管理端验证码邮件发送失败：${err.message}`));
      }
      if (result.ok && devCodes) setCookie(c, 'admin_dev_code', result.code, tempOpts);
    }
    setCookie(c, 'admin_pending', email, tempOpts);
    return c.redirect('/login/verify', 303);
  });

  app.get('/login/verify', (c) => {
    const email = getCookie(c, 'admin_pending');
    if (!email) return c.redirect('/login', 303);
    return page(c, () => views.verifyPage({ email, note: takeNote(c), devCode: devCodes ? getCookie(c, 'admin_dev_code') : null }));
  });

  app.post('/login/verify', async (c) => {
    const email = getCookie(c, 'admin_pending');
    if (!email) return c.redirect('/login', 303);
    const body = await c.req.parseBody();
    const found = await findAdminByEmail(pool, email);
    const result = found ? await verifyCode(pool, config, { email, purpose: 'admin_login', code: body.code }) : { ok: false };
    if (!result.ok) return page(c, () => views.verifyPage({ email, note: fail('验证码不正确或已失效。') }), 400);
    deleteCookie(c, 'admin_pending', cookieBase);
    deleteCookie(c, 'admin_dev_code', cookieBase);
    const token = await createAdminSession(pool, found.id);
    if (!config.adminRequire2fa) {
      // 本地开发不做二步验证（生产环境始终要求）。
      const auth = await validateAdminSession(pool, token);
      if (!auth || !await completeLogin(c, auth.session.id, token)) return c.redirect('/login', 303);
      await audit(pool, { adminId: found.id, action: 'admin.login', detail: { twoFactor: 'skipped_dev' } });
      return c.redirect('/', 303);
    }
    setCookie(c, cookieName, token, { ...cookieBase, maxAge: ADMIN_PENDING_SESSION_MAX_AGE });
    return c.redirect('/2fa', 303);
  });

  app.get('/2fa', async (c) => {
    const auth = c.get('adminAuth');
    if (!auth) return c.redirect('/login', 303);
    if (auth.session.verified) return c.redirect('/', 303);
    if (auth.admin.totp_enabled_at) return page(c, () => views.totpPage({ note: takeNote(c) }));
    // 首次登录：生成新密钥（加密保存，完成验证后才启用）。
    let secret = auth.admin.totp_secret ? openSecret(config.authSecret, auth.admin.totp_secret) : null;
    if (!secret) {
      secret = newTotpSecret();
      await pool.query('UPDATE admins SET totp_secret = $2 WHERE user_id = $1', [auth.admin.id, sealSecret(config.authSecret, secret)]);
    }
    return page(c, () => views.totpPage({ setup: { secret, url: otpauthUrl(secret, auth.admin.email) }, note: takeNote(c) }));
  });

  app.post('/2fa', async (c) => {
    const auth = c.get('adminAuth');
    if (!auth) return c.redirect('/login', 303);
    if (auth.session.verified) return c.redirect('/', 303);
    if (!totpLimiter(auth.admin.id)) return back(c, '/2fa', fail('尝试次数过多，请 10 分钟后再试。'));
    const body = await c.req.parseBody();
    const secret = auth.admin.totp_secret && openSecret(config.authSecret, auth.admin.totp_secret);
    const step = secret && verifyTotp(secret, body.code, { lastStep: auth.admin.totp_last_step });
    if (!step) return back(c, '/2fa', fail('验证码不正确。'));
    await pool.query(
      'UPDATE admins SET totp_last_step = $2, totp_enabled_at = COALESCE(totp_enabled_at, now()) WHERE user_id = $1',
      [auth.admin.id, step],
    );
    if (!await completeLogin(c, auth.session.id, getCookie(c, cookieName))) return c.redirect('/login', 303);
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
    const r = await overview(pool, days, { settings: await settings.all(), timeZone: config.reportTimeZone });
    return page(c, () => views.overviewPage({ admin: admin(c), r, geoConfigured: Boolean(config.geoCountryHeader), mapMode: c.req.query('map') }));
  });

  /* ---------- API 用量：每位用户 ---------- */

  app.get('/api-usage', requireAdmin, async (c) => {
    const raw = c.req.query('days');
    const days = raw === 'all' ? null : [7, 30, 90].includes(Number(raw)) ? Number(raw) : 30;
    const sort = ['cost', 'requests', 'chars', 'tokens', 'rejected', 'last'].includes(c.req.query('sort')) ? c.req.query('sort') : 'cost';
    const q = String(c.req.query('q') || '').trim().slice(0, 254);
    const data = await apiUsageByUser(pool, { days, q, sort });
    return page(c, () => views.apiUsagePage({ admin: admin(c), days, q, sort, data }));
  });

  /* ---------- 收支：录入支出（写审计） ---------- */

  app.get('/expenses', requireAdmin, async (c) => {
    const expenses = await listExpenses(pool);
    const today = dayLabels(1, config.reportTimeZone)[0];
    return page(c, () => views.expensesPage({ admin: admin(c), expenses, today, note: takeNote(c) }));
  });

  app.post('/expenses', requireAdmin, async (c) => {
    const expense = parseExpense(await c.req.parseBody());
    if (!expense) return back(c, '/expenses', fail('请检查类别、金额和日期。'));
    const { rows: [row] } = await pool.query(
      `INSERT INTO expenses (category, amount_cents, recurring, start_date, end_date, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [expense.category, expense.amountCents, expense.recurring, expense.startDate, expense.endDate, expense.note, admin(c).id],
    );
    await audit(pool, { adminId: admin(c).id, action: 'expense.create', targetType: 'expense', targetId: row.id, detail: expense });
    return back(c, '/expenses', ok('已添加。'));
  });

  app.post('/expenses/:id/delete', requireAdmin, async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.notFound();
    const reason = reasonOf(await c.req.parseBody());
    if (!reason) return back(c, '/expenses', fail('请填写删除原因。'));
    const { rowCount } = await pool.query('UPDATE expenses SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (rowCount) await audit(pool, { adminId: admin(c).id, action: 'expense.delete', targetType: 'expense', targetId: id, reason });
    return back(c, '/expenses', ok('已删除。'));
  });

  /* ---------- A3 用户 ---------- */

  app.get('/users', requireAdmin, async (c) => {
    const q = String(c.req.query('q') || '').trim().toLowerCase().slice(0, 254);
    const { rows: users } = await pool.query(
      `SELECT u.id, u.kind, u.email, u.username, u.created_at, u.hosted_frozen_at,
              (SELECT status FROM subscriptions s WHERE s.user_id = u.id ORDER BY updated_at DESC LIMIT 1) AS sub_status,
              (SELECT COALESCE(SUM(g.amount_units + COALESCE((SELECT SUM(x.amount_units) FROM credit_ledger x WHERE x.grant_id = g.id), 0)), 0)
                 FROM credit_ledger g WHERE g.user_id = u.id AND g.grant_id IS NULL AND g.amount_units > 0
                   AND (g.expires_at IS NULL OR g.expires_at > now()))::text AS balance_units
       FROM users u
       WHERE ($1 = '' AND u.kind = 'member') OR u.email = $1 OR u.username LIKE $2 OR u.id::text = $1
       ORDER BY u.created_at DESC LIMIT 100`,
      [q, `%${q.replace(/[%_\\]/g, '\\$&')}%`],
    );
    return page(c, () => views.usersPage({ admin: admin(c), q, users }));
  });

  const loadUser = async (id) => (UUID.test(id)
    ? (await pool.query('SELECT id, kind, email, username, email_verified_at, hosted_frozen_at, created_at FROM users WHERE id = $1', [id])).rows[0]
    : null);

  app.get('/users/:id', requireAdmin, async (c) => {
    const u = await loadUser(c.req.param('id'));
    if (!u) return page(c, () => views.errorPage({ admin: admin(c), status: 404, message: '找不到这个用户。' }), 404);
    const [state, subs, activity, sessions, api] = await Promise.all([
      accountState(pool, u),
      pool.query('SELECT plan, status, current_period_end, provider_subscription_id, updated_at FROM subscriptions WHERE user_id = $1 ORDER BY updated_at DESC', [u.id]),
      creditActivity(pool, u.id, { period: c.req.query('period') }),
      pool.query('SELECT COUNT(*)::int AS n FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()', [u.id]),
      apiUsageForUser(pool, u.id, 30),
    ]);
    return page(c, () => views.userPage({
      admin: admin(c), u, state, subs: subs.rows, activity, sessions: sessions.rows[0].n, api, note: takeNote(c),
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
    let units;
    try { units = creditsToUnits(body.amount); } catch { return false; }
    if (units <= 0n || units > creditsToUnits('100000')) return false;
    const amount = displayCredits(units);
    await adjustCredits(pool, { userId: u.id, amount, reason, requestId: randomUUID() });
    return { amount, units: units.toString() };
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

  /**
   * 删除用户（二次确认）：先打开确认页查看将删除和保留的数据，再输入该用户的邮箱（访客输入用户名）并填写原因提交。
   * 审计只记录用户 ID、类型与删除的数量，不保存邮箱或用户名。
   */
  const confirmationOf = (u) => u.email || u.username;
  const deletePage = async (c, u, note = null, status = 200) => {
    const summary = await deletionSummary(pool, u);
    return page(c, () => views.deleteUserPage({ admin: admin(c), u, summary, confirmation: confirmationOf(u), note }), status);
  };

  app.get('/users/:id/delete', requireAdmin, async (c) => {
    const u = await loadUser(c.req.param('id'));
    if (!u) return page(c, () => views.errorPage({ admin: admin(c), status: 404, message: '找不到这个用户。' }), 404);
    return deletePage(c, u);
  });

  app.post('/users/:id/delete', requireAdmin, async (c) => {
    const u = await loadUser(c.req.param('id'));
    if (!u) return c.notFound();
    const body = await c.req.parseBody();
    const reason = reasonOf(body);
    if (!reason) return deletePage(c, u, fail('请填写删除原因。'), 400);
    if (String(body.confirm || '').trim().toLowerCase() !== confirmationOf(u).toLowerCase()) {
      return deletePage(c, u, fail(`确认内容不一致，请输入 ${confirmationOf(u)}。`), 400);
    }
    const result = await deleteUser(pool, u.id);
    if (result.blocked) return deletePage(c, u, fail(result.blocked === 'admin' ? '管理员账号不能删除。' : '该用户仍有有效订阅，请先在 Creem 取消订阅。'), 409);
    await audit(pool, {
      adminId: admin(c).id, action: 'user.delete', targetType: 'user', targetId: u.id, reason,
      detail: { kind: result.kind, removed: result.removed, kept: result.kept },
    });
    return back(c, '/users', ok('用户及其数据已删除。'));
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
    return page(c, () => views.subscriptionsPage({ admin: admin(c), subs: subs.rows, orders: orders.rows, status }));
  });

  /* ---------- A6 点数账本 ---------- */

  app.get('/ledger', requireAdmin, async (c) => {
    const activity = await creditActivity(pool, null, { period: c.req.query('period'), incomeType: c.req.query('type'), limit: 300 });
    return page(c, () => views.ledgerPage({ admin: admin(c), activity }));
  });

  /* ---------- A4 / A7 规则与服务配置 ---------- */

  const services = () => [
    { label: '主力模型', ok: Boolean(config.hosted.apiKey), value: config.hosted.apiKey ? `${config.hosted.model} · ${new URL(config.hosted.baseUrl).host}` : '未配置' },
    { label: '备用模型', ok: Boolean(config.hosted.fallback), value: config.hosted.fallback ? `${config.hosted.fallback.model} · ${new URL(config.hosted.fallback.baseUrl).host}` : '未配置' },
    { label: 'Creem 收款', ok: Boolean(creem), value: creem ? (creem.testMode ? '测试模式' : '正式') : '未配置' },
    { label: '发信服务', ok: config.mailTransport !== 'console', value: config.mailTransport },
  ];

  app.get('/settings', requireAdmin, async (c) => {
    const values = await settings.all();
    return page(c, () => views.settingsPage({ admin: admin(c), values, defaults: settings.defaults(), services: services(), note: takeNote(c) }));
  });

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
    return page(c, () => views.eventsPage({ admin: admin(c), failures: failures.rows, errorCounts: errorCounts.rows, payments: payments.rows }));
  });

  /* ---------- A9 操作审计 ---------- */

  app.get('/audit', requireAdmin, async (c) => {
    const { rows } = await pool.query(
      `SELECT a.*, u.email AS admin_email FROM admin_audit a LEFT JOIN users u ON u.id = a.admin_id ORDER BY a.created_at DESC LIMIT 300`,
    );
    return page(c, () => views.auditPage({ admin: admin(c), rows }));
  });

  app.notFound((c) => page(c, () => views.errorPage({ admin: c.get('adminAuth')?.session.verified ? admin(c) : null, status: 404, message: '找不到这个页面。' }), 404));
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    log.error(err);
    return page(c, () => views.errorPage({ status: 500, message: '服务暂时不可用。' }), 500);
  });

  return app;
}
