import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { usageOverview } from '../src/usage/overview.js';
import { displayCredits } from '../src/credits/units.js';
import { browser, buildApp, createTestPool, resetData, signInWithEmail } from './helpers.mjs';

let pool;
before(async () => { pool = await createTestPool(); });
after(async () => { await pool?.end(); });
beforeEach(async () => { await resetData(pool); });

async function member(email) {
  return (await pool.query('INSERT INTO users (email, username) VALUES ($1, $2) RETURNING id', [email, email.split('@')[0]])).rows[0].id;
}
async function event(userId, { at, kind = 'text', status = 'ok', units = '7', chars = 7, input = 100, output = 50, cached = 0 } = {}) {
  await pool.query(`INSERT INTO usage_events (user_id, kind, status, cost_units, chars, input_tokens, output_tokens, created_at, cached_tokens)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [userId, kind, status, units, chars, input, output, at, cached]);
}

test('用户总览：UTC 日统计跨年补零，只读本人用量；精确扣点排除失败与处理中请求', async () => {
  const userId = await member('owner@example.com');
  const otherId = await member('other@example.com');
  await event(userId, { at: '2025-12-31T23:59:59Z', cached: 40 });
  await event(userId, { at: '2026-01-01T00:00:00Z', status: 'failed', units: '500', input: 20, output: 5 });
  await event(userId, { at: '2026-01-02T11:00:00Z', kind: 'image', units: '0', chars: 0, input: 200, output: 30 });
  await event(userId, { at: '2026-01-02T11:00:00Z', status: 'pending', units: '900' });
  await event(userId, { at: '2025-12-01T00:00:00Z', units: '10000' });
  await event(userId, { at: '2026-01-02T13:00:00Z', units: '10000' });
  await event(otherId, { at: '2026-01-01T00:00:00Z', units: '99999' });
  const report = await usageOverview(pool, userId, { period: '7d', now: new Date('2026-01-02T12:00:00Z') });
  assert.equal(report.days.length, 7);
  assert.equal(report.days[0].day, '2025-12-27');
  assert.equal(report.days.at(-1).day, '2026-01-02');
  assert.deepEqual(report.totals, { requests: 3n, credits_units: 7n, chars: 7n, input: 320n, output: 85n });
  assert.equal(report.totals.input, 320n, '缓存词元已包含在输入中，不再次累计');
  assert.equal(displayCredits(report.totals.credits_units), '0.01');
  assert.equal(report.days[0].requests, 0n);
  assert.equal(report.days[4].credits_units, 7n);

  const image = await usageOverview(pool, userId, { period: '7d', kind: 'image', now: new Date('2026-01-02T12:00:00Z') });
  assert.equal(image.totals.requests, 1n);
  assert.equal(image.totals.credits_units, 0n);
  const month = await usageOverview(pool, userId, { now: new Date('2026-01-02T12:00:00Z') });
  assert.equal(month.days.length, 2);
  assert.equal(month.totals.requests, 2n);
  assert.equal(month.totals.credits_units, 0n);
  const invalid = await usageOverview(pool, userId, { period: 'invalid', kind: "text' OR true", now: new Date('2026-01-02T12:00:00Z') });
  assert.equal(invalid.period, 'month');
  assert.equal(invalid.kind, 'all');
  assert.deepEqual(invalid.totals, month.totals);
});

test('用户总览：筛选、空状态、本人数据和真实趋势；不展示模型成本或金钱', async () => {
  const { app, config, mailbox } = buildApp({ pool });
  assert.equal((await browser(app, config).get('/')).headers.get('location'), '/login');
  const b = await signInWithEmail(app, config, mailbox, 'overview@example.com');
  const userId = (await pool.query("SELECT id FROM users WHERE email = 'overview@example.com'")).rows[0].id;
  const otherId = await member('private@example.com');
  const at = new Date();
  at.setUTCDate(1); at.setUTCHours(0, 0, 0, 0);
  let page = await b.text('/');
  assert.match(page, /data-metric="requests">0</);
  assert.match(page, /所选范围内暂无可展示的数据/);
  await event(userId, { at });
  await event(userId, { at, kind: 'image', units: '0', chars: 0 });
  await event(otherId, { at, units: '999999' });
  page = await b.text(`/?user_id=${otherId}`);
  assert.match(page, /data-metric="requests">2</);
  assert.match(page, /data-metric="consumed">0\.01/);
  assert.match(page, /data-chart="consumed"[\s\S]*<svg class="chart"/);
  assert.match(page, /data-chart="requests"[\s\S]*<path class="area/);
  assert.match(page, /data-chart="tokens"[\s\S]*<rect class="bar/);
  assert.match(page, /<script src="\/assets\/chart-tooltip\.js\?v=[a-f0-9]+" defer><\/script>/);
  assert.match(page, /data-chart-point[^>]*data-chart-date="[^"]+ UTC"/);
  assert.match(page, /data-chart-values="[^"<]*0\.01 点/);
  assert.match(page, /输入词元[^<]*200[^<]*输出词元[^<]*100[^<]*模型用量[^<]*300/);
  const tooltipAsset = await b.get('/assets/chart-tooltip.js');
  assert.equal(tooltipAsset.status, 200);
  assert.match(tooltipAsset.headers.get('content-type'), /javascript/);
  const csp = (await b.get('/')).headers.get('content-security-policy');
  assert.match(csp, /script-src 'self';/);
  assert.match(csp, /style-src 'self';/);
  assert.doesNotMatch(await b.text('/account'), /chart-tooltip\.js/);
  assert.match(page, /100\.00<span class="unit">点/);
  assert.doesNotMatch(page, /private@example\.com|cost_micros|credits_units|US\$|CNY|模型成本/);
  page = await b.text('/?kind=image');
  assert.match(page, /value="image" selected/);
  assert.match(page, /data-metric="requests">1</);
  assert.match(page, /data-metric="consumed">0\.00/);
  assert.match(page, /清除筛选条件/);
  const ar = await b.request('/?period=30d', { headers: { 'accept-language': 'ar' } });
  assert.match(await ar.text(), /dir="rtl"/);
});

test('用户总览：订阅用户显示无限使用与字数，不展示点数；历史用量仍保留', async () => {
  const { app, config, mailbox } = buildApp({ pool });
  const b = await signInWithEmail(app, config, mailbox, 'subscriber@example.com');
  const userId = (await pool.query("SELECT id FROM users WHERE email = 'subscriber@example.com'")).rows[0].id;
  await pool.query(`INSERT INTO subscriptions (user_id, provider, provider_subscription_id, plan, status, current_period_end, last_event_at)
    VALUES ($1, 'creem', 'sub_overview', 'monthly', 'active', now() + interval '1 month', now())`, [userId]);
  const at = new Date(); at.setUTCDate(1); at.setUTCHours(0, 0, 0, 0);
  await event(userId, { at, chars: 25 });
  const page = await b.text('/');
  assert.match(page, /data-unlimited>无限使用/);
  assert.match(page, /翻译字符数/);
  assert.match(page, /data-metric="consumed">25</);
  assert.doesNotMatch(page, /data-balance|点数消耗|剩余点数/);
});
