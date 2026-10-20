import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import { createAdminSession, markVerified, validateAdminSession } from '../src/admin/auth.js';
import { creditActivity } from '../src/usage/activity.js';
import { displayCredits } from '../src/credits/units.js';
import { browser, buildApp, createTestPool, resetData, signInWithEmail } from './helpers.mjs';

let pool;
before(async () => { pool = await createTestPool(); });
after(async () => { await pool?.end(); });
beforeEach(async () => { await resetData(pool); });

const member = async (name) => (await pool.query(
  'INSERT INTO users (email, username) VALUES ($1, $2) RETURNING id', [`${name}@example.com`, name],
)).rows[0].id;
const entry = async (userId, type, amount, at, grant = null, usage = null, reason = null) => (await pool.query(
  `INSERT INTO credit_ledger (user_id, entry_type, amount_units, created_at, grant_id, usage_event_id, idempotency_key, reason)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
  [userId, type, String(amount), at, grant, usage, randomUUID(), reason],
)).rows[0].id;
const request = async (userId, at, { status = 'ok', units = 1, chars = 1, kind = 'text', audience = 'member' } = {}) => (await pool.query(
  `INSERT INTO usage_events (user_id, created_at, kind, status, cost_units, chars, audience)
   VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`, [userId, at, kind, status, String(units), chars, audience],
)).rows[0].id;
const table = (page, direction) => page.match(new RegExp(`<table data-ledger="${direction}">([\\s\\S]*?)</table>`))?.[1] || '';

test('点数收支：UTC 跨年补零，收入支出分别统计；预扣拆分不重复计算请求，返还不冲减支出', async () => {
  const owner = await member('owner'), other = await member('other');
  const grant = await entry(owner, 'trial_grant', 50000, '2025-12-01T00:00:00Z');
  const secondGrant = await entry(owner, 'adjust', 5000, '2025-12-02T00:00:00Z');
  const foreignGrant = await entry(other, 'trial_grant', 50000, '2025-12-01T00:00:00Z');
  const ok = await request(owner, '2025-12-31T23:59:59Z', { units: 503, chars: 503 });
  await entry(owner, 'usage', -2, '2025-12-31T23:59:59Z', grant, ok);
  await entry(owner, 'usage', -501, '2025-12-31T23:59:59Z', secondGrant, ok);
  const failed = await request(owner, '2026-01-01T00:00:00Z', { status: 'failed' });
  await entry(owner, 'usage', -1, '2026-01-01T00:00:00Z', grant, failed);
  await entry(owner, 'refund', 1, '2026-01-02T01:00:00Z', grant, failed);
  const pending = await request(owner, '2026-01-02T11:00:00Z', { status: 'pending' });
  await entry(owner, 'usage', -1, '2026-01-02T11:00:00Z', grant, pending);
  await request(owner, '2026-01-01T11:00:00Z', { units: 0, chars: 30, kind: 'image', audience: 'subscriber' });
  await entry(owner, 'void', -3, '2026-01-02T11:00:00Z', grant);
  for (const [userId, parent, at] of [[owner, grant, '2025-12-01T00:00:00Z'], [owner, grant, '2026-01-02T13:00:00Z'], [other, foreignGrant, '2026-01-01T00:00:00Z']]) {
    const event = await request(userId, at, { units: 999 });
    await entry(userId, 'usage', -999, at, parent, event);
  }
  const options = { period: '7d', now: new Date('2026-01-02T12:00:00Z') };
  const report = await creditActivity(pool, owner, options);
  assert.deepEqual(report.totals, { spent_units: 508n, usage_units: 505n, void_units: 3n, requests: 4n, ok: 2n, failed: 1n, pending: 1n, chars: 535n });
  assert.equal(report.days.length, 7);
  assert.equal(report.days[0].day, '2025-12-27');
  assert.equal(report.days[0].spent_units, 0n);
  assert.equal(report.days[4].spent_units, 503n);
  assert.equal(report.days.at(-1).spent_units, 4n);
  assert.ok(report.income.every((e) => BigInt(e.amount_units) > 0n && e.user_id === owner));
  assert.ok(report.expenses.every((e) => BigInt(e.amount_units) < 0n && e.user_id === owner));
  assert.equal(report.income.find((e) => e.entry_type === 'refund').amount_units, '1');
  assert.equal(report.income.length, 3, '旧赠送仍在收入记录中，不受图表时间范围限制');
  assert.equal(report.events.length, 4);
  const global = await creditActivity(pool, null, options);
  assert.equal(global.totals.requests, 5n);
  assert.equal(global.totals.spent_units, 1507n);
  const filtered = await creditActivity(pool, null, { ...options, incomeType: 'refund' });
  assert.deepEqual(filtered.totals, global.totals, '收入类型筛选不改变支出与请求图表');
  assert.equal(filtered.income.length, 1);
  await assert.rejects(creditActivity(pool, undefined), /missing_activity_user/);
});

test('点数收支：完整聚合超过明细上限的请求，支出不会挤掉赠送；大整数与微小额度准确', async () => {
  const userId = await member('busy');
  const at = new Date();
  const grant = await entry(userId, 'trial_grant', '900719925474099500', at);
  const events = (await pool.query(`INSERT INTO usage_events (user_id, kind, status, cost_units, chars, created_at)
    SELECT $1, 'text', 'ok', 1, 1, $2 FROM generate_series(1, 120) RETURNING id`, [userId, at])).rows;
  await pool.query(`INSERT INTO credit_ledger (user_id, entry_type, amount_units, grant_id, usage_event_id, idempotency_key, created_at)
    SELECT $1, 'usage', -1, $2, id, 'busy:' || id, $3 FROM usage_events WHERE user_id = $1`, [userId, grant, at]);
  let report = await creditActivity(pool, userId, { limit: 5, now: at });
  assert.equal(report.income.length, 1);
  assert.equal(report.expenses.length, 5);
  assert.equal(report.events.length, 5);
  assert.equal(report.totals.requests, 120n);
  assert.equal(report.totals.spent_units, 120n);
  assert.equal(displayCredits(report.totals.spent_units), '0.24', '逐笔显示 0.00 仍按精确总额度汇总');
  assert.equal(events.length, 120);
  const huge = 9007199254740995n;
  await entry(userId, 'void', -huge, at, grant);
  report = await creditActivity(pool, userId, { period: 'invalid', incomeType: "refund' OR true", now: at });
  assert.equal(report.period, 'month');
  assert.equal(report.incomeType, '');
  assert.equal(report.totals.spent_units, huge + 120n);
  assert.equal(report.totals.void_units, huge);
});

test('用户与管理端：收入保持表格、支出和请求有日期图表及折叠明细，用户不能查询其他账户', async () => {
  const { app, config, mailbox } = buildApp({ pool });
  const web = await signInWithEmail(app, config, mailbox, 'viewer@example.com');
  const userId = (await pool.query("SELECT id FROM users WHERE email = 'viewer@example.com'")).rows[0].id;
  const grant = (await pool.query('SELECT id FROM credit_ledger WHERE user_id = $1', [userId])).rows[0].id;
  const at = new Date();
  const usage = await request(userId, at, { units: 7, chars: 7 });
  await entry(userId, 'usage', -7, at, grant, usage);
  const other = await member('private_user');
  const foreignGrant = await entry(other, 'adjust', 123456, at, null, null, '<img src=x onerror=alert(1)>');
  await entry(other, 'void', -500, at, foreignGrant);
  await request(other, at, { status: 'failed' });
  const page = await web.text(`/usage?period=7d&user_id=${other}`);
  assert.match(page, /value="7d" selected/);
  assert.match(page, /data-spent>0\.01 点/);
  assert.match(page, /data-requests>1</);
  assert.match(page, /data-chart="credit-expenses"[\s\S]*data-chart-point/);
  assert.match(page, /data-chart="translation-requests"[\s\S]*data-chart-values/);
  assert.match(page, /<details class="card activity-details">[\s\S]*请求明细/);
  assert.match(table(page, 'income'), /注册赠送[\s\S]*\+100\.00[\s\S]*不过期/);
  assert.doesNotMatch(table(page, 'income'), /托管翻译扣点|点数作废/);
  assert.match(table(page, 'expense'), /托管翻译扣点[\s\S]*-0\.01/);
  assert.doesNotMatch(page, /private_user|123456|onerror|模型成本|cost_units/);
  assert.equal((await browser(app, config).get('/usage')).headers.get('location'), '/login');
  assert.equal((await browser(app, config, config.adminOrigin).get('/ledger')).headers.get('location'), '/login');
  const ar = await web.request('/usage?period=30d', { headers: { 'accept-language': 'ar' } });
  assert.match(await ar.text(), /dir="rtl"/);

  await pool.query('INSERT INTO admins (user_id) VALUES ($1)', [userId]);
  const token = await createAdminSession(pool, userId);
  await markVerified(pool, (await validateAdminSession(pool, token)).session.id);
  const admin = browser(app, config, config.adminOrigin);
  admin.jar.set('huaci_admin', token);
  const detail = await admin.text(`/users/${userId}?period=7d`);
  assert.match(detail, /data-spent>0\.01 点/);
  assert.match(detail, /data-requests>1</);
  assert.doesNotMatch(table(detail, 'income'), /托管扣点|作废/);
  assert.match(table(detail, 'expense'), /托管扣点/);
  const global = await admin.text('/ledger?period=7d&type=adjust');
  assert.match(global, /data-spent>1\.01 点/);
  assert.match(global, /data-requests>2</);
  assert.match(global, /name="type" value="adjust"/);
  assert.match(global, /href="\/ledger\?type=refund&amp;period=7d"/);
  assert.match(table(global, 'income'), /管理员补发/);
  assert.doesNotMatch(table(global, 'income'), /注册赠送|托管扣点|作废/);
  assert.match(global, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(global, /<img src=x onerror/);
});
