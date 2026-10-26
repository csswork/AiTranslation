import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import { provisionReviewAccess, revokeReviewAccess, verifyReviewAccess } from '../src/auth/review.js';
import { createSession, validateSession } from '../src/auth/sessions.js';
import { creditBalance } from '../src/credits/ledger.js';
import { findOrCreateUserByEmail } from '../src/auth/users.js';
import { browser, buildApp, createTestPool, resetData, testConfig } from './helpers.mjs';

let pool;
before(async () => { pool = await createTestPool(); });
after(async () => { await pool?.end(); });
beforeEach(async () => { await resetData(pool); });
const params = { email: 'edge-review@example.com', username: 'review_msedge' };
const provision = (overrides = {}) => provisionReviewAccess(pool, { ...params, ...overrides });

test('审核账号只保存凭据哈希，普通权限、限期 30 天、额度发放和审计幂等', async () => {
  const first = await provision();
  assert.match(first.credential, /^[A-Za-z0-9_-]{43}$/);
  const { rows: [stored] } = await pool.query('SELECT * FROM review_access WHERE user_id = $1', [first.userId]);
  assert.equal(stored.credential_hash, createHash('sha256').update(first.credential).digest('hex'));
  assert.ok(stored.expires_at > new Date(Date.now() + 29 * 86400_000));
  assert.ok(stored.expires_at <= new Date(Date.now() + 30 * 86400_000));
  assert.equal((await pool.query('SELECT 1 FROM admins WHERE user_id = $1', [first.userId])).rowCount, 0);
  assert.equal((await pool.query('SELECT email_verified_at FROM users WHERE id = $1', [first.userId])).rows[0].email_verified_at, null);
  assert.equal(await creditBalance(pool, first.userId), 500000n);
  assert.equal((await pool.query('SELECT 1 FROM subscriptions')).rowCount, 0);
  const token = await createSession(pool, testConfig(), first.userId);
  const rotated = await provision();
  assert.equal(rotated.userId, first.userId);
  assert.notEqual(rotated.credential, first.credential);
  assert.equal(await verifyReviewAccess(pool, params.email, first.credential), null);
  assert.equal(await validateSession(pool, testConfig(), token), null);
  assert.equal(await creditBalance(pool, first.userId), 500000n);
  const audit = JSON.stringify((await pool.query('SELECT * FROM admin_audit')).rows);
  assert.match(audit, /review.create/);
  assert.match(audit, /review.rotate/);
  assert.ok(!audit.includes(first.credential) && !audit.includes(rotated.credential));
});

test('不能将既有普通账户或管理员转换成审核免邮箱登录账户，拒绝超长有效期', async () => {
  await findOrCreateUserByEmail(pool, '100.00', params.email);
  await assert.rejects(provision(), /Existing account/);
  await pool.query('INSERT INTO admins(user_id) SELECT id FROM users WHERE email = $1', [params.email]);
  await assert.rejects(provision(), /Existing account/);
  await assert.rejects(provision({ email: 'other@example.com', days: 31 }), /Invalid/);
  await assert.rejects(provision({ email: 'other@example.com', username: 'normal_user' }), /Invalid/);
  assert.equal((await pool.query('SELECT 1 FROM review_access')).rowCount, 0);
});

test('审核登录使用同源 POST 和标准用户会话；失败不回显凭据，不改变邮箱验证码登录', async () => {
  const access = await provision();
  const { app, config, mailbox } = buildApp({ pool, config: testConfig({ ADMIN_ORIGIN: 'http://admin.localhost:8787' }) });
  const b = browser(app, config);
  const page = await b.get('/review-login');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /type="password".*autocomplete="current-password"/);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.match(page.headers.get('content-security-policy'), /form-action 'self'/);
  const form = { email: params.email, credential: access.credential };
  assert.equal((await b.post('/review-login', form, { origin: 'https://evil.example' })).status, 403);
  const bad = await b.post('/review-login', { ...form, credential: 'A'.repeat(43) });
  assert.equal(bad.status, 401);
  assert.ok(!(await bad.text()).includes('A'.repeat(43)));
  assert.equal((await b.post('/review-login', form)).status, 303);
  const session = await validateSession(pool, config, b.jar.get('huaci_session'));
  assert.equal(session.user.id, access.userId);
  assert.equal(Object.hasOwn(session.user, 'review_expires_at'), false);
  assert.equal((await b.get('/')).status, 200);
  const admin = browser(app, config, config.adminOrigin);
  for (const [key, value] of b.jar) admin.jar.set(key, value);
  assert.equal((await admin.post('/review-login', form)).status, 404);
  assert.equal((await admin.get('/')).headers.get('location'), '/login');
  const normal = browser(app, config);
  assert.equal((await normal.post('/review-login', { ...form, email: 'normal@example.com' })).status, 401);
  await normal.post('/login/email', { email: 'normal@example.com' });
  assert.equal((await normal.post('/login/verify', { code: mailbox.last('normal@example.com') })).status, 303);
});

test('审核登录源地址限流；未知、过期和已撤销账号返回相同错误', async () => {
  const access = await provision();
  const { app, config } = buildApp({ pool });
  const b = browser(app, config);
  const form = { email: params.email, credential: access.credential };
  await revokeReviewAccess(pool, params.email);
  const revoked = await b.post('/review-login', form);
  assert.equal(revoked.status, 401);
  const text = await revoked.text();
  assert.match(text, /Invalid or expired/);
  for (let i = 1; i < 10; i++) assert.equal((await b.post('/review-login', form)).status, 401);
  assert.equal((await b.post('/review-login', form)).status, 429);
});

test('审核硬到期约束网页和扩展，滚动续期不能越过审核截止时间', async () => {
  const access = await provision();
  const config = testConfig();
  const webToken = await createSession(pool, config, access.userId);
  const web = await validateSession(pool, config, webToken);
  const extToken = await createSession(pool, config, access.userId, 'extension', { webSessionId: web.session.id });
  const before = (await pool.query('SELECT last_used_at FROM sessions WHERE id = $1', [web.session.id])).rows[0].last_used_at;
  await validateSession(pool, config, webToken);
  assert.deepEqual((await pool.query('SELECT last_used_at FROM sessions WHERE id = $1', [web.session.id])).rows[0].last_used_at, before, '不会为 30 天账号每次请求写入一年续期');
  await pool.query("UPDATE sessions SET last_used_at = now() - interval '2 hours' WHERE user_id = $1", [access.userId]);
  assert.ok(await validateSession(pool, config, extToken));
  for (const row of (await pool.query('SELECT expires_at FROM sessions WHERE user_id = $1', [access.userId])).rows) {
    assert.deepEqual(row.expires_at, access.expiresAt);
  }
  await pool.query("UPDATE review_access SET expires_at = now() - interval '1 second' WHERE user_id = $1", [access.userId]);
  assert.equal(await verifyReviewAccess(pool, params.email, access.credential), null);
  assert.equal(await validateSession(pool, config, webToken), null);
  assert.equal(await validateSession(pool, config, extToken), null);
});

test('审核账号可走完整 PKCE 扩展授权；撤销同时停用网页与扩展令牌', async () => {
  const access = await provision();
  const id = 'abcdefghijklmnopabcdefghijklmnop';
  const config = testConfig({ EXTENSION_IDS: id });
  const { app } = buildApp({ pool, config });
  const b = browser(app, config);
  const verifier = randomBytes(32).toString('base64url');
  const redirect = `chrome-extension://${id}/src/auth/callback.html`;
  const query = new URLSearchParams({ redirect_uri: redirect, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', state: 'review-test' });
  assert.equal((await b.get(`/extension/authorize?${query}`)).headers.get('location'), '/login');
  await b.get('/review-login');
  const login = await b.post('/review-login', { email: params.email, credential: access.credential });
  assert.equal(login.headers.get('location'), '/extension/authorize/confirm');
  const consent = await b.post('/extension/authorize/confirm', { decision: 'approve' });
  const code = new URL(consent.headers.get('location')).searchParams.get('code');
  const res = await app.request(`${config.appOrigin}/api/extension/token`, {
    method: 'POST', headers: { origin: `chrome-extension://${id}`, 'content-type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: redirect }),
  });
  assert.equal(res.status, 200);
  const { token } = await res.json();
  assert.equal((await validateSession(pool, config, token)).user.id, access.userId);
  await revokeReviewAccess(pool, params.email);
  assert.equal(await validateSession(pool, config, token), null);
  assert.equal((await b.get('/')).headers.get('location'), '/login');
});
