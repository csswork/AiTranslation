import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import {
  browser, buildApp, createTestPool, fakeGoogle, resetData, signInWithEmail, testConfig,
} from './helpers.mjs';

let pool;
before(async () => { pool = await createTestPool(); });
after(async () => { await pool?.end(); });
beforeEach(async () => { await resetData(pool); });

const location = (res) => res.headers.get('location');

test('未登录访问用户界面会跳到登录页，并带安全响应头', async () => {
  const { app, config } = buildApp({ pool });
  const res = await browser(app, config).get('/');
  assert.equal(res.status, 303);
  assert.equal(location(res), '/login');
  const login = await browser(app, config).get('/login');
  assert.match(login.headers.get('content-security-policy'), /script-src 'self'(;|$)/);
  assert.equal(login.headers.get('cache-control'), 'no-store');
  assert.equal(login.headers.get('x-frame-options'), 'DENY');
});

test('邮箱验证码注册：创建账号、发放一次试用点数、只保存令牌哈希', async () => {
  const { app, config, mailbox } = buildApp({ pool });
  const b = browser(app, config);
  let res = await b.post('/login/email', { email: '  Alice@Example.COM ' });
  assert.equal(res.status, 303);
  assert.equal(location(res), '/login/verify');
  assert.equal(mailbox.sent.length, 1);
  assert.equal(mailbox.sent[0].to, 'alice@example.com');
  assert.match(mailbox.sent[0].code, /^\d{6}$/);
  assert.match(await b.text('/login/verify'), /alice@example\.com/);

  const { rows: [stored] } = await pool.query('SELECT code_hash FROM email_codes');
  assert.notEqual(stored.code_hash, mailbox.sent[0].code, '验证码不以明文保存');

  res = await b.post('/login/verify', { code: mailbox.sent[0].code });
  assert.equal(res.status, 303);
  assert.equal(location(res), '/');
  assert.equal(config.sessionDays, 365, '用户端默认保留一年');
  assert.match(res.headers.getSetCookie().find((cookie) => cookie.startsWith('huaci_session=')), /Max-Age=31536000(?:;|$)/);

  const overview = await b.text('/');
  assert.match(overview, /alice@example\.com/);
  assert.match(overview, /user_[a-z0-9]{8}/);
  assert.match(overview, /100\.00<span class="unit">点/);
  assert.match(overview, /暂无订阅/);

  const { rows: users } = await pool.query('SELECT * FROM users');
  assert.equal(users.length, 1);
  assert.deepEqual(Object.keys(users[0]).sort(), ['created_at', 'email', 'email_verified_at', 'hosted_frozen_at', 'id', 'kind', 'updated_at', 'username']);
  assert.ok(users[0].email_verified_at);

  const { rows: ledger } = await pool.query('SELECT entry_type, amount_units, expires_at FROM credit_ledger');
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].entry_type, 'trial_grant');
  assert.equal(ledger[0].amount_units, '50000');
  assert.equal(ledger[0].expires_at, null, '注册赠送不过期');

  const token = b.jar.get('huaci_session');
  const { rows: sessions } = await pool.query('SELECT token_hash, client, created_at, expires_at FROM sessions');
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].client, 'web');
  assert.notEqual(sessions[0].token_hash, token);
  assert.equal(sessions[0].expires_at - sessions[0].created_at, 365 * 86400 * 1000);
  // 网页访问同时续期服务端会话与浏览器 Cookie。
  await pool.query("UPDATE sessions SET last_used_at = now() - interval '2 hours', expires_at = now() + interval '1 day'");
  const visit = await b.get('/');
  assert.equal(visit.status, 200);
  assert.match(visit.headers.getSetCookie().find((cookie) => cookie.startsWith('huaci_session=')), /Max-Age=31536000(?:;|$)/);
  const { rows: [renewed] } = await pool.query('SELECT last_used_at, expires_at FROM sessions');
  assert.equal(renewed.expires_at - renewed.last_used_at, 365 * 86400 * 1000);
});

test('再次登录同一邮箱使用原账号，不重复发放试用', async () => {
  const { app, config, mailbox } = buildApp({ pool });
  await signInWithEmail(app, config, mailbox, 'bob@example.com');
  await pool.query("UPDATE email_codes SET created_at = now() - interval '2 minutes'");
  await signInWithEmail(app, config, mailbox, 'bob@example.com');
  assert.equal((await pool.query('SELECT 1 FROM users')).rowCount, 1);
  assert.equal((await pool.query('SELECT 1 FROM credit_ledger')).rowCount, 1);
});

test('验证码错误次数用尽后失效，正确验证码也不再接受', async () => {
  const { app, config, mailbox } = buildApp({ pool });
  const b = browser(app, config);
  await b.post('/login/email', { email: 'carol@example.com' });
  const code = mailbox.last();
  const wrong = code === '000000' ? '111111' : '000000';
  let res = await b.post('/login/verify', { code: wrong });
  assert.equal(res.status, 400);
  assert.match(await res.text(), /还可以尝试 4 次/);
  for (let i = 0; i < 4; i += 1) res = await b.post('/login/verify', { code: wrong });
  assert.match(await res.text(), /尝试次数过多/);
  res = await b.post('/login/verify', { code });
  assert.equal(res.status, 400);
  assert.equal((await pool.query('SELECT 1 FROM users')).rowCount, 0);
});

test('过期验证码不能使用', async () => {
  const { app, config, mailbox } = buildApp({ pool });
  const b = browser(app, config);
  await b.post('/login/email', { email: 'dave@example.com' });
  await pool.query("UPDATE email_codes SET expires_at = now() - interval '1 second'");
  const res = await b.post('/login/verify', { code: mailbox.last() });
  assert.equal(res.status, 400);
  assert.match(await res.text(), /已过期/);
});

test('同一邮箱 60 秒内不能重复发送验证码，新验证码使旧的失效', async () => {
  const { app, config, mailbox } = buildApp({ pool });
  const b = browser(app, config);
  await b.post('/login/email', { email: 'erin@example.com' });
  const first = mailbox.last();
  const res = await b.post('/login/email', { email: 'erin@example.com' });
  assert.equal(res.status, 429);
  assert.match(await res.text(), /60 秒/);

  await pool.query("UPDATE email_codes SET created_at = now() - interval '2 minutes'");
  await b.post('/login/resend');
  const second = mailbox.last();
  assert.equal(mailbox.sent.length, 2);
  if (first !== second) {
    const stale = await b.post('/login/verify', { code: first });
    assert.equal(stale.status, 400);
  }
  assert.equal(location(await b.post('/login/verify', { code: second })), '/');
});

test('无效邮箱被拒绝且不发信', async () => {
  const { app, config, mailbox } = buildApp({ pool });
  const res = await browser(app, config).post('/login/email', { email: 'not-an-email' });
  assert.equal(res.status, 400);
  assert.equal(mailbox.sent.length, 0);
});

test('修改状态的请求必须来自本站', async () => {
  const { app, config, mailbox } = buildApp({ pool });
  const b = browser(app, config);
  for (const headers of [{ origin: 'https://evil.example' }, { origin: 'null' }]) {
    const res = await b.post('/login/email', { email: 'x@example.com' }, headers);
    assert.equal(res.status, 403);
  }
  const res = await b.request('/login/email', {
    method: 'POST', form: { email: 'x@example.com' }, headers: { origin: '', 'sec-fetch-site': 'same-origin' },
  });
  assert.equal(res.status, 303);
  assert.equal(mailbox.sent.length, 1);
});

test('退出登录会撤销会话', async () => {
  const { app, config, mailbox } = buildApp({ pool });
  const b = await signInWithEmail(app, config, mailbox, 'fay@example.com');
  const token = b.jar.get('huaci_session');
  const res = await b.post('/logout');
  assert.equal(location(res), '/login');
  assert.match(await b.text('/login'), /已退出登录/);
  // 旧令牌即使被留存也不能再用。
  const replay = await app.request(`${config.appOrigin}/`, { headers: { cookie: `huaci_session=${token}` } });
  assert.equal(replay.status, 303);
});

/* ---------- Google ---------- */

const googleAccounts = {
  gina: { sub: 'g-gina', email: 'Gina@Gmail.com', email_verified: true, name: 'Gina Real', picture: 'https://x/p.png' },
  hank: { sub: 'g-hank', email: 'hank@example.com', email_verified: true },
  unverified: { sub: 'g-unv', email: 'unv@example.com', email_verified: false },
};

async function googleLogin(b, code) {
  const start = await b.get('/auth/google');
  assert.equal(start.status, 302);
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  return b.get(`/auth/google/callback?code=${code}&state=${state}`);
}

test('Google 登录只申请 openid 和 email，新账号不保存姓名或头像', async () => {
  const google = fakeGoogle(googleAccounts);
  const { app, config } = buildApp({ pool, google, config: testConfig({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's' }) });
  const b = browser(app, config);
  assert.match(await b.text('/login'), /使用 Google 登录/);
  const res = await googleLogin(b, 'good-gina');
  assert.equal(location(res), '/');
  assert.deepEqual(google.requests[0].scopes, ['openid', 'email']);

  const { rows: [user] } = await pool.query('SELECT * FROM users');
  assert.equal(user.email, 'gina@gmail.com');
  assert.doesNotMatch(JSON.stringify(user), /Gina Real|p\.png/);
  const { rows: identities } = await pool.query('SELECT provider, subject FROM identities');
  assert.deepEqual(identities, [{ provider: 'google', subject: 'g-gina' }]);
  assert.equal((await pool.query('SELECT 1 FROM credit_ledger')).rowCount, 1);

  // 再次 Google 登录进入同一账号。
  await googleLogin(browser(app, config), 'good-gina');
  assert.equal((await pool.query('SELECT 1 FROM users')).rowCount, 1);
});

test('Google 邮箱与已有账号一致时绑定到原账号，不再发放试用', async () => {
  const google = fakeGoogle(googleAccounts);
  const { app, config, mailbox } = buildApp({ pool, google, config: testConfig({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's' }) });
  await signInWithEmail(app, config, mailbox, 'hank@example.com');
  const res = await googleLogin(browser(app, config), 'good-hank');
  assert.equal(location(res), '/');
  assert.equal((await pool.query('SELECT 1 FROM users')).rowCount, 1);
  assert.equal((await pool.query('SELECT 1 FROM identities')).rowCount, 1);
  assert.equal((await pool.query('SELECT 1 FROM credit_ledger')).rowCount, 1);
});

test('Google 未验证的邮箱、错误的 state 或授权码都不能登录', async () => {
  const google = fakeGoogle(googleAccounts);
  const { app, config } = buildApp({ pool, google, config: testConfig({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's' }) });

  let b = browser(app, config);
  let res = await googleLogin(b, 'good-unverified');
  assert.equal(location(res), '/login');
  assert.match(await b.text('/login'), /没有已验证的邮箱/);

  b = browser(app, config);
  await b.get('/auth/google');
  res = await b.get('/auth/google/callback?code=good-gina&state=forged');
  assert.equal(location(res), '/login');

  b = browser(app, config);
  res = await googleLogin(b, 'bad-code');
  assert.equal(location(res), '/login');
  assert.match(await b.text('/login'), /Google 登录没有完成/);
  assert.equal((await pool.query('SELECT 1 FROM users')).rowCount, 0);
});

test('未配置 Google 时不显示入口，回调也不可用', async () => {
  const { app, config } = buildApp({ pool });
  const b = browser(app, config);
  assert.doesNotMatch(await b.text('/login'), /Google/);
  assert.equal((await b.get('/auth/google')).status, 404);
});
