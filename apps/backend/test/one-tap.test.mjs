import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import { googleJwks, verifyGoogleIdToken } from '../src/auth/google-id-token.js';
import { browser, buildApp, createTestPool, fakeGoogle, resetData, testConfig } from './helpers.mjs';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const getKey = async (kid) => (kid === 'k1' ? publicKey : null);

function idToken(claims = {}, { key = privateKey, kid = 'k1', alg = 'RS256' } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = { iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: 'g-1', email: 'One@Gmail.com', email_verified: true, iat: now, exp: now + 3600, nonce: 'n-1', name: 'Real Name', picture: 'https://x/p.png', ...claims };
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const input = `${enc({ alg, kid, typ: 'JWT' })}.${enc(body)}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), key).toString('base64url')}`;
}
const verifyWith = (token, nonce = 'n-1') => verifyGoogleIdToken(token, { clientId: CLIENT_ID, nonce, getKey });

test('ID token 校验：签名、签发方、客户端 ID、有效期与 nonce', async () => {
  assert.deepEqual(await verifyWith(idToken()), { subject: 'g-1', email: 'one@gmail.com', emailVerified: true });
  const cases = {
    signature: idToken({}, { key: other.privateKey }),
    kid: idToken({}, { kid: 'unknown' }),
    alg: idToken({}, { alg: 'none' }),
    iss: idToken({ iss: 'https://evil.example' }),
    aud: idToken({ aud: 'someone-else' }),
    exp: idToken({ exp: Math.floor(Date.now() / 1000) - 3600 }),
    nonce: idToken({ nonce: 'other' }),
  };
  for (const [reason, token] of Object.entries(cases)) {
    await assert.rejects(verifyWith(token), (e) => e.message === reason, reason);
  }
  await assert.rejects(verifyWith(idToken(), ''), /nonce/, '缺少 nonce 时拒绝');
  await assert.rejects(verifyWith('not-a-token'), /format/);
});

test('JWKS 按 Cache-Control 缓存，遇到新 kid 时重新拉取', async () => {
  let calls = 0;
  const jwk = publicKey.export({ format: 'jwk' });
  const fetchImpl = async () => {
    calls += 1;
    return new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'k1', alg: 'RS256', use: 'sig' }] }), { headers: { 'cache-control': 'public, max-age=600' } });
  };
  const keys = googleJwks({ fetchImpl });
  assert.ok(await keys('k1'));
  assert.ok(await keys('k1'));
  assert.equal(calls, 1, '缓存期内不重复拉取');
  assert.equal(await keys('k2'), null);
  assert.equal(calls, 1, '未知 kid 一分钟内只重拉一次（首次拉取刚发生）');
});

let pool;
before(async () => { pool = await createTestPool(); });
after(async () => { await pool?.end(); });
beforeEach(async () => { await resetData(pool); });

const setup = () => buildApp({
  pool,
  google: fakeGoogle({}),
  googleIdToken: (token, nonce) => verifyGoogleIdToken(token, { clientId: CLIENT_ID, nonce, getKey }),
  config: testConfig({ GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: 's' }),
});

test('登录页显示 One Tap，并只在这一页放开 Google 组件的 CSP', async () => {
  const { app, config } = setup();
  const b = browser(app, config);
  const res = await b.get('/login');
  const page = await res.text();
  assert.match(page, /<script src="https:\/\/accounts\.google\.com\/gsi\/client\?hl=zh-CN" async defer>/);
  assert.match(page, new RegExp(`data-one-tap data-client-id="${CLIENT_ID.replace(/\./g, '\\.')}" data-nonce="[\\w-]{32}"`));
  assert.ok(b.jar.get('onetap_nonce'));
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self' https:\/\/accounts\.google\.com\/gsi\/client/);
  assert.match(csp, /frame-src https:\/\/accounts\.google\.com\/gsi\//);
  assert.match(csp, /connect-src https:\/\/accounts\.google\.com\/gsi\//);

  const strict = (await b.get('/login/verify')).headers.get('content-security-policy') || (await b.get('/nope')).headers.get('content-security-policy');
  assert.doesNotMatch(strict, /gsi/);

  const { app: plain, config: plainConfig } = buildApp({ pool });
  assert.doesNotMatch(await browser(plain, plainConfig).text('/login'), /gsi\/client|data-one-tap/);
});

test('One Tap 登录：校验通过后建号并登录，不保存姓名头像；同一凭证不能再用', async () => {
  const { app, config } = setup();
  const b = browser(app, config);
  await b.get('/login');
  const nonce = b.jar.get('onetap_nonce');
  const credential = idToken({ nonce });
  const res = await b.post('/auth/google/one-tap', { credential });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/');
  assert.equal((await b.get('/')).status, 200);
  const { rows: [user] } = await pool.query('SELECT * FROM users');
  assert.equal(user.email, 'one@gmail.com');
  assert.doesNotMatch(JSON.stringify(user), /Real Name|p\.png/);
  assert.equal((await pool.query('SELECT 1 FROM credit_ledger')).rowCount, 1);

  // 另一个浏览器重放同一凭证：没有对应的 nonce
  const replay = browser(app, config);
  await replay.get('/login');
  const again = await replay.post('/auth/google/one-tap', { credential });
  assert.equal(again.headers.get('location'), '/login');
  assert.match(await replay.text('/login'), /Google 登录没有完成/);
});

test('One Tap 登录：nonce 不符、未登录页面直接提交都会被拒；从官网进入时登录后返回官网', async () => {
  const { app, config } = setup();
  const b = browser(app, config);
  await b.get('/login');
  let res = await b.post('/auth/google/one-tap', { credential: idToken({ nonce: 'forged' }) });
  assert.equal(res.headers.get('location'), '/login');
  res = await browser(app, config).post('/auth/google/one-tap', { credential: idToken() });
  assert.equal(res.headers.get('location'), '/login');
  assert.equal((await pool.query('SELECT 1 FROM users')).rowCount, 0);

  const web = browser(app, config);
  await web.get(`/login?return=${encodeURIComponent('http://localhost:8080/en/')}`);
  res = await web.post('/auth/google/one-tap', { credential: idToken({ nonce: web.jar.get('onetap_nonce') }) });
  assert.equal(res.headers.get('location'), 'http://localhost:8080/en/');
});
