import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { LANGUAGES } from '../src/translation/languages.js';
import { browser, buildApp, createTestPool, resetData, signInWithEmail, testConfig } from './helpers.mjs';

let pool;
before(async () => { pool = await createTestPool(); });
after(async () => { await pool?.end(); });
beforeEach(async () => { await resetData(pool); });

const EXT_ID = 'abcdefghijklmnopabcdefghijklmnop';
const ORIGIN = `chrome-extension://${EXT_ID}`;
const REDIRECT = `${ORIGIN}/src/auth/callback.html`;
const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};
const authorizeUrl = (challenge, redirect = REDIRECT) =>
  `/extension/authorize?redirect_uri=${encodeURIComponent(redirect)}&code_challenge=${challenge}&code_challenge_method=S256&state=s-1`;

/** 走完扩展登录：网页登录 → 授权确认 → 用授权码换令牌。返回令牌。 */
async function extensionLogin(app, config, mailbox, email) {
  const { verifier, challenge } = pkce();
  // 同一邮箱 60 秒内只能发一次验证码；测试里重复登录时把旧验证码挪到更早
  await pool.query("UPDATE email_codes SET created_at = now() - interval '2 minutes'");
  const b = await signInWithEmail(app, config, mailbox, email);
  await b.get(authorizeUrl(challenge));
  const res = await b.post('/extension/authorize/confirm', { decision: 'approve' });
  const code = new URL(res.headers.get('location')).searchParams.get('code');
  const token = await api(app, config, '/token', { method: 'POST', body: { code, code_verifier: verifier, redirect_uri: REDIRECT } });
  return { token: (await token.json()).token, browser: b };
}

function api(app, config, path, { method = 'GET', token, body, origin = ORIGIN } = {}) {
  const headers = { origin };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers['content-type'] = 'application/json';
  return app.request(new URL(`/api/extension${path}`, config.appOrigin), { method, headers, body: body ? JSON.stringify(body) : undefined });
}

test('扩展登录：未登录先去登录页，确认后带一次性授权码回到扩展，PKCE 换取扩展会话', async () => {
  const { app, config, mailbox } = buildApp({ pool });
  const { verifier, challenge } = pkce();
  const b = browser(app, config);
  let res = await b.get(authorizeUrl(challenge));
  assert.equal(res.headers.get('location'), '/login');
  await b.post('/login/email', { email: 'ext@example.com' });
  res = await b.post('/login/verify', { code: mailbox.last() });
  assert.equal(res.headers.get('location'), '/extension/authorize/confirm');

  res = await b.get('/extension/authorize/confirm');
  const page = await res.text();
  assert.match(page, /允许 AI 划词翻译扩展登录/);
  assert.match(res.headers.get('content-security-policy'), new RegExp(`form-action 'self' ${ORIGIN}(;|$)`));

  res = await b.post('/extension/authorize/confirm', { decision: 'approve' });
  const back = new URL(res.headers.get('location'));
  assert.equal(`${back.protocol}//${back.host}${back.pathname}`, REDIRECT);
  assert.equal(back.searchParams.get('state'), 's-1');
  const code = back.searchParams.get('code');
  assert.ok(code && !back.searchParams.has('token'), '回调里只有授权码');

  const wrong = await api(app, config, '/token', { method: 'POST', body: { code, code_verifier: pkce().verifier, redirect_uri: REDIRECT } });
  assert.equal(wrong.status, 400, 'verifier 不符');
  // 授权码已被上面那次尝试消耗：只能用一次
  const reused = await api(app, config, '/token', { method: 'POST', body: { code, code_verifier: verifier, redirect_uri: REDIRECT } });
  assert.equal(reused.status, 400);

  const { token } = await extensionLogin(app, config, mailbox, 'ext@example.com');
  const me = await api(app, config, '/me', { token });
  assert.equal(me.status, 200);
  const body = await me.json();
  assert.match(body.username, /^user_/);
  assert.deepEqual(body.credits, { balance: '100.00', available: true });
  assert.equal(body.kind, 'member');
  assert.equal(body.subscription, null);
  assert.equal(body.hosted.available, false);
  assert.equal(Object.hasOwn(body.hosted, 'charsPerCredit'), false, '公开接口不暴露点数换算规则');
  assert.doesNotMatch(JSON.stringify(body), /ext@example\.com/);
  const { rows } = await pool.query("SELECT client FROM sessions WHERE client = 'extension'");
  assert.equal(rows.length, 1);
});

test('扩展登录：拒绝、无效回调地址、未列入名单的扩展都不会签发授权码', async () => {
  const { app, config, mailbox } = buildApp({ pool });
  const b = await signInWithEmail(app, config, mailbox, 'deny@example.com');
  await b.get(authorizeUrl(pkce().challenge));
  let res = await b.post('/extension/authorize/confirm', { decision: 'deny' });
  const back = new URL(res.headers.get('location'));
  assert.equal(back.searchParams.get('error'), 'access_denied');
  assert.equal(back.searchParams.has('code'), false);

  for (const redirect of ['https://evil.example/', `https://${EXT_ID}.chromiumapp.org/`, `${ORIGIN}/src/options/options.html`, `${REDIRECT}?x=1`, `chrome-extension://not-an-id/src/auth/callback.html`]) {
    res = await b.get(authorizeUrl(pkce().challenge, redirect));
    assert.equal(res.status, 400, redirect);
  }
  res = await b.get(authorizeUrl('short'));
  assert.equal(res.status, 400);

  const listed = buildApp({ pool, config: testConfig({ EXTENSION_IDS: 'ppppppppppppppppppppppppppppppppp'.slice(0, 32) }) });
  res = await browser(listed.app, listed.config).get(authorizeUrl(pkce().challenge));
  assert.equal(res.status, 400, '名单外的扩展');
  const preflight = await api(listed.app, listed.config, '/me', { method: 'OPTIONS' });
  assert.equal(preflight.status, 403);
});

test('扩展接口：只接受扩展会话；CORS 只给扩展来源；退出或在网页端撤销后立即失效', async () => {
  const { app, config, mailbox } = buildApp({ pool });
  const { token, browser: web } = await extensionLogin(app, config, mailbox, 'cors@example.com');

  const preflight = await api(app, config, '/me', { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), ORIGIN);
  assert.match(preflight.headers.get('access-control-allow-headers'), /authorization/);
  const evil = await api(app, config, '/me', { token, origin: 'https://evil.example' });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);

  assert.equal((await api(app, config, '/me')).status, 401);
  assert.equal((await api(app, config, '/me', { token: web.jar.get('huaci_session') })).status, 401, '网页会话不能当扩展令牌用');

  // 网页端「登录会话」里能看到并退出扩展会话
  assert.match(await web.text('/sessions'), /<tr data-client="extension">/);
  const { rows: [ext] } = await pool.query("SELECT id FROM sessions WHERE client = 'extension'");
  await web.post(`/sessions/${ext.id}/revoke`);
  assert.equal((await api(app, config, '/me', { token })).status, 401);

  const second = await extensionLogin(app, config, mailbox, 'cors@example.com');
  assert.equal((await api(app, config, '/logout', { method: 'POST', token: second.token })).status, 200);
  assert.equal((await api(app, config, '/me', { token: second.token })).status, 401);
  assert.equal((await second.browser.get('/')).status, 200, '单独退出扩展不会退出网页');
});

for (const production of [false, true]) {
  test(`网页登出同步撤销本次授权的扩展，保留其他浏览器登录（${production ? '生产 HTTPS' : '本地 localhost'}）`, async () => {
    const config = testConfig(production ? {
      NODE_ENV: 'production', APP_ORIGIN: 'https://app.huaci.app', EXTENSION_IDS: EXT_ID,
      MAIL_TRANSPORT: 'resend', RESEND_API_KEY: 'test', MAIL_FROM: 'no-reply@huaci.app',
    } : {});
    const { app, mailbox } = buildApp({ pool, config });
    const first = await extensionLogin(app, config, mailbox, 'sync@example.com');
    const otherBrowser = await extensionLogin(app, config, mailbox, 'sync@example.com');
    const otherUser = await extensionLogin(app, config, mailbox, 'else@example.com');

    const invalid = await first.browser.post('/logout', {}, { origin: 'https://evil.example' });
    assert.equal(invalid.status, 403);
    assert.equal((await api(app, config, '/me', { token: first.token })).status, 200);

    assert.equal((await first.browser.post('/logout')).status, 303);
    assert.equal((await api(app, config, '/me', { token: first.token })).status, 401);
    assert.equal((await api(app, config, '/translate', { method: 'POST', token: first.token,
      body: { texts: ['Hello'], target: 'fr' } })).status, 401, '已退出的扩展不能继续托管翻译');
    assert.equal((await (await first.browser.get('/api/web/session')).json()).signedIn, false);
    assert.equal((await api(app, config, '/me', { token: otherBrowser.token })).status, 200);
    assert.equal((await otherBrowser.browser.get('/')).status, 200);
    assert.equal((await api(app, config, '/me', { token: otherUser.token })).status, 200);
  });
}

test('网页登出后，尚未兑换的扩展授权码也不能建立新会话', async () => {
  const { app, config, mailbox } = buildApp({ pool });
  const b = await signInWithEmail(app, config, mailbox, 'pending@example.com');
  const { verifier, challenge } = pkce();
  await b.get(authorizeUrl(challenge));
  const approved = await b.post('/extension/authorize/confirm', { decision: 'approve' });
  const code = new URL(approved.headers.get('location')).searchParams.get('code');
  await b.post('/logout');
  const res = await api(app, config, '/token', { method: 'POST', body: { code, code_verifier: verifier, redirect_uri: REDIRECT } });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_grant');
});

function fakeHosted({ fail = false } = {}) {
  const calls = [];
  const hosted = async ({ texts, target }) => {
    calls.push({ texts, target });
    const meta = { providerKey: 'primary', provider: 'deepseek', model: 'deepseek-flash', latencyMs: 5 };
    if (fail) throw Object.assign(new Error('model_500'), { code: 'http_500', meta });
    return {
      translations: texts.map((text) => `[${target}] ${text}`),
      meta: { ...meta, inputTokens: 1_000_000, cachedTokens: 0, outputTokens: 1_000_000, fellBack: false },
    };
  };
  return { hosted, calls };
}

test('托管翻译：按每 500 字 1 点扣费，记录用量；余额不足拒绝且不扣点', async () => {
  const { hosted, calls } = fakeHosted();
  const { app, config, mailbox } = buildApp({ pool, hosted });
  const { token, browser: web } = await extensionLogin(app, config, mailbox, 'hosted@example.com');

  let res = await api(app, config, '/translate', { method: 'POST', token, body: { texts: ['Hello world'], target: 'zh-Hans' } });
  assert.equal(res.status, 200);
  let body = await res.json();
  assert.deepEqual(body.translations, ['[zh-Hans] Hello world']);
  assert.equal(body.cost, '0.02');
  assert.equal(body.credits.balance, '99.98');

  res = await api(app, config, '/translate', { method: 'POST', token, body: { texts: ['a'.repeat(600), 'b'.repeat(500)], target: 'ja' } });
  body = await res.json();
  assert.equal(body.cost, '2.20', '1100 字精确扣 2.2 点');
  assert.equal(body.credits.balance, '97.78');
  assert.equal(calls.length, 2);

  const usage = await web.text('/usage');
  assert.match(usage, /托管翻译扣点/);
  assert.match(usage, /<tr data-status="ok">[\s\S]*1100/);
  const { rows: events } = await pool.query("SELECT status, chars, cost_units FROM usage_events ORDER BY created_at");
  assert.deepEqual(events.map((e) => [e.status, e.chars, e.cost_units]), [['ok', 11, '11'], ['ok', 1100, '1100']]);

  await pool.query("UPDATE credit_ledger SET amount_units = 2000 WHERE entry_type = 'trial_grant'");
  res = await api(app, config, '/translate', { method: 'POST', token, body: { texts: ['x'.repeat(3000)], target: 'en' } });
  assert.equal(res.status, 402);
  body = await res.json();
  assert.equal(body.error, 'insufficient_credits');
  assert.equal(body.credits.balance, '1.78', '余额精确保留 889 单位，不足时不继续扣款');
  assert.equal(calls.length, 2, '余额不足时不调用模型');
  assert.equal((await pool.query('SELECT 1 FROM usage_events')).rowCount, 2);
});

test('托管翻译：模型失败时返还点数并记为失败；参数校验与未配置时的返回', async () => {
  const failing = fakeHosted({ fail: true });
  const { app, config, mailbox } = buildApp({ pool, hosted: failing.hosted });
  const { token } = await extensionLogin(app, config, mailbox, 'fail@example.com');
  let res = await api(app, config, '/translate', { method: 'POST', token, body: { texts: ['Hello'], target: 'fr' } });
  assert.equal(res.status, 502);
  assert.equal((await res.json()).credits.balance, '100.00', '失败不扣点');
  const { rows: [event] } = await pool.query('SELECT status FROM usage_events');
  assert.equal(event.status, 'failed');
  const { rows: ledger } = await pool.query("SELECT entry_type, amount_units FROM credit_ledger WHERE entry_type <> 'trial_grant' ORDER BY entry_type DESC");
  assert.deepEqual(ledger.map((r) => [r.entry_type, r.amount_units]), [['usage', '-5'], ['refund', '5']]);

  const bad = [
    [{ texts: [], target: 'fr' }, 400],
    [{ texts: ['x'], target: 'xx' }, 400],
    [{ texts: ['x'], target: 'fr', source: 'xx' }, 400],
    [{ texts: [42], target: 'fr' }, 400],
    [{ texts: ['x'.repeat(6001)], target: 'fr' }, 413],
  ];
  for (const [payload, status] of bad) {
    assert.equal((await api(app, config, '/translate', { method: 'POST', token, body: payload })).status, status, JSON.stringify(payload).slice(0, 40));
  }

  const plain = buildApp({ pool });
  const other = await extensionLogin(plain.app, plain.config, plain.mailbox, 'nohost@example.com');
  assert.equal((await api(plain.app, plain.config, '/translate', { method: 'POST', token: other.token, body: { texts: ['x'], target: 'fr' } })).status, 503);
});

test('试用点数默认不过期；带到期时间的发放过期后剩余点数失效，余额不会因扣点变成负数', async () => {
  const { hosted } = fakeHosted();
  const { app, config, mailbox } = buildApp({ pool, hosted });
  const { token } = await extensionLogin(app, config, mailbox, 'expire@example.com');
  await api(app, config, '/translate', { method: 'POST', token, body: { texts: ['Hello'], target: 'de' } });
  const { rows: [trial] } = await pool.query("SELECT expires_at FROM credit_ledger WHERE entry_type = 'trial_grant'");
  assert.equal(trial.expires_at, null, '注册赠送不过期');
  await pool.query("UPDATE credit_ledger SET expires_at = now() - interval '1 second' WHERE entry_type = 'trial_grant'");
  const body = await (await api(app, config, '/me', { token })).json();
  assert.equal(body.credits.balance, '0.00');
  assert.equal((await api(app, config, '/translate', { method: 'POST', token, body: { texts: ['Hello'], target: 'de' } })).status, 402);
});

test('托管翻译的语言表与扩展的 24 种语言注册表一致', () => {
  const registry = JSON.parse(fs.readFileSync(new URL('../../extension/i18n/locales.json', import.meta.url), 'utf8'));
  assert.deepEqual(LANGUAGES, Object.fromEntries(registry.map((l) => [l.id, l.prompt])));
});
