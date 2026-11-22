/** 自愿分享的功能使用记录：扩展接口、访客合并、管理端汇总与用户端查看删除。 */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import { readSharedRows, SHARED_MAX_ROWS } from '../src/usage/shared.js';
import { browser, buildApp, createTestPool, resetData, signInWithEmail, testConfig } from './helpers.mjs';

let pool;
before(async () => { pool = await createTestPool(); });
after(async () => { await pool?.end(); });
beforeEach(async () => { await resetData(pool); });

const EXT_ID = 'abcdefghijklmnopabcdefghijklmnop';
const ORIGIN = `chrome-extension://${EXT_ID}`;
const REDIRECT = `${ORIGIN}/src/auth/callback.html`;
const ADMIN = 'http://admin.localhost:8787';
const DAY_MS = 86_400_000;
const daysAgo = (n, now = Date.now()) => new Date(now - n * DAY_MS).toISOString().slice(0, 10);
const row = (extra = {}) => ({ id: randomUUID(), day: daysAgo(1), feature: 'pdf', provider: 'deepseek', requests: 3, failures: 1, ...extra });

function api(app, config, path, { method = 'GET', token, body, headers: extra = {} } = {}) {
  const headers = { origin: ORIGIN, ...extra };
  if (token) headers.authorization = `Bearer ${token}`;
  const encoded = body ? JSON.stringify(body) : undefined;
  if (encoded) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = String(Buffer.byteLength(encoded));
  }
  return app.request(new URL(`/api/extension${path}`, config.appOrigin), { method, headers, body: encoded });
}

const share = (app, config, token, rows, headers) => api(app, config, '/usage-share', { method: 'POST', token, body: { rows }, headers });

async function guestToken(app, config) {
  const res = await api(app, config, '/guest', { method: 'POST', body: { extensionId: EXT_ID }, headers: { 'x-huaci-version': '2.4.0' } });
  return (await res.json()).token;
}

async function extensionLogin(app, config, mailbox, email, guest) {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const b = await signInWithEmail(app, config, mailbox, email);
  await b.get(`/extension/authorize?redirect_uri=${encodeURIComponent(REDIRECT)}&code_challenge=${challenge}&code_challenge_method=S256&state=s`);
  const res = await b.post('/extension/authorize/confirm', { decision: 'approve' });
  const code = new URL(res.headers.get('location')).searchParams.get('code');
  const token = await api(app, config, '/token', { method: 'POST', body: { code, code_verifier: verifier, redirect_uri: REDIRECT, guest_token: guest } });
  return { token: (await token.json()).token, browser: b };
}

test('分享记录校验：枚举、计数范围、只收已结束且 35 天内的日子，任一条不合格整批拒绝', () => {
  const now = Date.parse('2026-11-21T03:00:00Z');
  const ok = row({ day: '2026-11-20' });
  assert.deepEqual(readSharedRows([ok], now), [ok]);
  assert.equal(readSharedRows([row({ day: '2026-11-21' })], now).length, 1, 'UTC+14 的昨天可能等于 UTC 今天');
  for (const bad of [
    { day: '2026-11-22' }, { day: '2026-10-16' }, { day: '2026-02-30' }, { day: '20261120' },
    { feature: 'bogus' }, { feature: 'unknown' }, { provider: 'hosted' }, { provider: 'custom' },
    { requests: 0 }, { requests: 10_001 }, { requests: 1.5 }, { failures: -1 }, { requests: 2, failures: 3 },
    { id: 'not-a-uuid' },
  ]) {
    assert.equal(readSharedRows([ok, row({ day: '2026-11-20', ...bad })], now), null, JSON.stringify(bad));
  }
  assert.equal(readSharedRows([], now), null);
  assert.equal(readSharedRows('x', now), null);
  assert.equal(readSharedRows(Array.from({ length: SHARED_MAX_ROWS + 1 }, () => row({ day: '2026-11-20' })), now), null);
  assert.equal(readSharedRows([{ ...ok, day: '2026-10-17' }], now).length, 1, '35 天前当天仍可收');
});

test('扩展分享接口：只接受扩展会话；重复提交不重复记录；记录版本与客户端；不保存其他字段；按用户限频', async () => {
  const { app, config } = buildApp({ pool });
  const token = await guestToken(app, config);
  const rows = [row(), row({ feature: 'reader', provider: 'local', requests: 7, failures: 0 })];
  assert.equal((await share(app, config, null, rows)).status, 401);
  const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
  assert.equal((await share(app, config, token, [...rows, { ...row(), id: 'x' }])).status, 400);
  assert.equal((await share(app, config, token, rows.map((r) => ({ ...r, url: 'https://example.com', text: 'secret' })), { 'user-agent': ua })).status, 204);
  assert.equal((await share(app, config, token, rows)).status, 204, '重试');
  const { rows: saved } = await pool.query(
    `SELECT feature, provider, requests, failures, ext_version, browser, browser_major, os FROM shared_feature_usage ORDER BY feature`);
  assert.deepEqual(saved, [
    { feature: 'pdf', provider: 'deepseek', requests: 3, failures: 1, ext_version: '2.4.0', browser: 'chrome', browser_major: 142, os: 'macos' },
    { feature: 'reader', provider: 'local', requests: 7, failures: 0, ext_version: '2.4.0', browser: 'chrome', browser_major: 142, os: 'macos' },
  ]);
  const { rows: columns } = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'shared_feature_usage'");
  assert.ok(!columns.some(({ column_name: name }) => /url|text|lang|model|agent|country|ip/.test(name)), '不保存内容、语言、模型或网络信息');
  for (let i = 0; i < 3; i++) assert.equal((await share(app, config, token, [row()])).status, 204);
  assert.equal((await share(app, config, token, [row()])).status, 429, '每小时最多 6 次');
});

test('分享记录：超过 180 天的在接收时清理；访客登录后并入正式账户；删除账户级联删除', async () => {
  const { app, config, mailbox } = buildApp({ pool });
  const guest = await guestToken(app, config);
  const { rows: [{ id: guestId }] } = await pool.query("SELECT id FROM users WHERE kind = 'guest'");
  await pool.query(`INSERT INTO shared_feature_usage (id, user_id, day, feature, provider, requests, failures)
    VALUES ($1, $2, (now() AT TIME ZONE 'UTC')::date - 181, 'page', 'deepl', 1, 0),
           ($3, $2, (now() AT TIME ZONE 'UTC')::date - 179, 'page', 'deepl', 1, 0)`, [randomUUID(), guestId, randomUUID()]);
  assert.equal((await share(app, config, guest, [row()])).status, 204);
  assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM shared_feature_usage')).rows[0].n, 2, '181 天前的那条在接收时被清理');
  const { token } = await extensionLogin(app, config, mailbox, 'merge-share@example.com', guest);
  const { rows: [member] } = await pool.query("SELECT id FROM users WHERE email = 'merge-share@example.com'");
  const { rows: owners } = await pool.query('SELECT DISTINCT user_id FROM shared_feature_usage');
  assert.deepEqual(owners.map((r) => r.user_id), [member.id]);
  assert.notEqual(guestId, member.id);

  assert.equal((await share(app, config, token, [row({ feature: 'site' })])).status, 204, '合并后用正式账户继续分享');
  assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM shared_feature_usage WHERE user_id = $1', [member.id])).rows[0].n, 3);
  await pool.query('DELETE FROM users WHERE id = $1', [member.id]);
  assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM shared_feature_usage')).rows[0].n, 0);
});

test('管理端分开显示自愿分享的功能使用：账户 × 日去重，按平台拆分；用户详情列出该用户的记录', async () => {
  const config = testConfig();
  const { app, mailbox } = buildApp({ pool, config });
  await signInWithEmail(app, config, mailbox, 'boss@example.com');
  await pool.query(`INSERT INTO admins (user_id) SELECT id FROM users WHERE email = 'boss@example.com'`);
  const a = browser(app, config, ADMIN);
  await a.post('/login', { email: 'boss@example.com' });
  await a.post('/login/verify', { code: mailbox.last('boss@example.com') });

  const empty = await a.text('/features?days=7');
  assert.match(empty, /<h1>功能使用统计<\/h1>/);
  assert.match(empty, /自带 Key \/ 本机翻译（自愿分享）[\s\S]*这段时间没有收到分享的记录/);

  const tokenA = await guestToken(app, config);
  const tokenB = await guestToken(app, config);
  // A：PDF 两天（同一天 DeepSeek 与本机各一条，算 1 天次）；B：PDF 一天、阅读一天。
  assert.equal((await share(app, config, tokenA, [
    row({ day: daysAgo(1), provider: 'deepseek', requests: 4, failures: 1 }),
    row({ day: daysAgo(1), provider: 'local', requests: 2, failures: 0 }),
    row({ day: daysAgo(2), provider: 'local', requests: 1, failures: 0 }),
  ])).status, 204);
  assert.equal((await share(app, config, tokenB, [
    row({ day: daysAgo(1), provider: 'deepl', requests: 3, failures: 0 }),
    row({ day: daysAgo(3), feature: 'reader', provider: 'openai', requests: 5, failures: 5 }),
    row({ day: daysAgo(20), feature: 'site', provider: 'openai', requests: 9, failures: 0 }),
  ])).status, 204);

  const page = await a.text('/features?days=7');
  const table = page.match(/<table data-shared-usage>[\s\S]*?<\/table>/)?.[0];
  assert.ok(table);
  assert.match(page, /样本只含开启分享的 2 个账户/);
  // 列：功能、使用天次、使用人数、覆盖率、请求数、失败率、ChatGPT、DeepSeek、DeepL、本机
  const cells = (label) => [...table.match(new RegExp(`<td>${label}</td>([\\s\\S]*?)</tr>`))[1].matchAll(/<td class="num"[^>]*>([^<]*)<\/td>/g)].map((m) => m[1]);
  assert.deepEqual(cells('整份 PDF 翻译'), ['3', '2', '100.0%', '10', '10.0%', '0', '1', '1', '2']);
  assert.deepEqual(cells('双语阅读'), ['1', '1', '50.0%', '5', '100.0%', '1', '0', '0', '0']);
  assert.deepEqual(cells('整站翻译'), ['0', '0', '0.0%', '0', '—', '0', '0', '0', '0'], '20 天前不在近 7 天内');
  assert.ok(table.indexOf('整份 PDF 翻译') < table.indexOf('双语阅读'), '按使用天次排序');
  const hosted = page.match(/<table data-feature-usage>[\s\S]*?<\/table>/)[0];
  assert.match(hosted, /整份 PDF 翻译<\/td>\s*<td class="num">0<\/td>/, '托管表不混入分享数据');

  const { rows: [{ user_id: userB }] } = await pool.query("SELECT user_id FROM shared_feature_usage WHERE feature = 'reader'");
  const detail = await a.text(`/users/${userB}`);
  const own = detail.match(/<table data-user-shared-usage>[\s\S]*?<\/table>/)?.[0];
  assert.ok(own);
  assert.match(own, /整站翻译<\/td><td>ChatGPT<\/td><td class="num">1<\/td><td class="num">9<\/td><td class="num">0<\/td>/);
  assert.match(own, /双语阅读<\/td><td>ChatGPT<\/td><td class="num">1<\/td><td class="num">5<\/td><td class="num">5<\/td>/);
});

test('用户端：用量页显示本人分享的记录并可全部删除；没有记录时不显示', async () => {
  const { app, config, mailbox } = buildApp({ pool });
  const { token, browser: b } = await extensionLogin(app, config, mailbox, 'sharer@example.com');
  assert.doesNotMatch(await b.text('/usage'), /data-shared-usage|删除全部分享记录/);
  assert.equal((await share(app, config, token, [
    row({ feature: 'selection', provider: 'local', requests: 12, failures: 0 }),
    row({ day: daysAgo(2), feature: 'selection', provider: 'local', requests: 3, failures: 0 }),
  ])).status, 204);
  const other = await guestToken(app, config);
  assert.equal((await share(app, config, other, [row({ feature: 'image', provider: 'openai' })])).status, 204);

  const page = await b.text('/usage');
  const table = page.match(/<table data-shared-usage>[\s\S]*?<\/table>/)?.[0];
  assert.ok(table);
  assert.match(table, /划词翻译<\/td>\s*<td>本机翻译<\/td>\s*<td class="num">2<\/td>\s*<td class="num">15<\/td>/);
  assert.doesNotMatch(table, /图片翻译/, '只显示本人记录');
  assert.match(page, /记录保留 180 天/);

  const res = await b.post('/usage/shared/delete', {});
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/usage');
  const after = await b.text('/usage');
  assert.match(after, /已删除你分享的全部功能使用记录/);
  assert.doesNotMatch(after, /data-shared-usage/);
  assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM shared_feature_usage')).rows[0].n, 1, '别人的记录保留');
  assert.equal((await browser(app, config).post('/usage/shared/delete', {})).headers.get('location')?.startsWith('/login'), true);
});
