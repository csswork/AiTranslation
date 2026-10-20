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
  const encoded = body ? JSON.stringify(body) : undefined;
  if (encoded) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = String(Buffer.byteLength(encoded));
  }
  return app.request(new URL(`/api/extension${path}`, config.appOrigin), { method, headers, body: encoded });
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
  assert.equal((await web.get('/')).status, 200, '会话列表中单独撤销扩展仍保留网页');

  const second = await extensionLogin(app, config, mailbox, 'cors@example.com');
  assert.equal((await api(app, config, '/logout', { method: 'POST', token: second.token })).status, 200);
  assert.equal((await api(app, config, '/me', { token: second.token })).status, 401);
  assert.equal((await second.browser.get('/')).headers.get('location'), '/login', '扩展主动退出同时退出关联网页');
});

for (const production of [false, true]) {
  test(`扩展使用同时续期一年及关联网页会话，不续其他浏览器；过期或撤销不恢复（${production ? '生产 HTTPS' : '本地 localhost'}）`, async () => {
    const config = testConfig(production ? {
      NODE_ENV: 'production', APP_ORIGIN: 'https://app.huaci.app', EXTENSION_IDS: EXT_ID,
      MAIL_TRANSPORT: 'resend', RESEND_API_KEY: 'test', MAIL_FROM: 'no-reply@huaci.app',
    } : {});
    const { hosted } = fakeHosted();
    const { app, mailbox } = buildApp({ pool, config, hosted });
    const first = await extensionLogin(app, config, mailbox, 'active@example.com');
    await extensionLogin(app, config, mailbox, 'active@example.com');
    const { rows: [ext] } = await pool.query('SELECT id, web_session_id FROM sessions WHERE token_hash = $1',
      [createHash('sha256').update(first.token).digest('hex')]);
    const ids = [ext.id, ext.web_session_id];
    const unrelated = (await pool.query('SELECT id, last_used_at, expires_at FROM sessions WHERE NOT (id = ANY($1::uuid[])) ORDER BY id', [ids])).rows;
    // 模拟旧版 30 天会话：即使刚访问过，也会升级到一年，无需用户重新授权。
    await pool.query("UPDATE sessions SET expires_at = now() + interval '30 days' WHERE id = ANY($1::uuid[])", [ids]);
    const res = await api(app, config, '/translate', { method: 'POST', token: first.token, body: { texts: ['Hello'], target: 'fr' } });
    assert.equal(res.status, 200, '托管翻译在续期期间正常可用');
    assert.deepEqual((await res.json()).translations, ['[fr] Hello']);
    let sessions = (await pool.query('SELECT id, last_used_at, expires_at FROM sessions WHERE id = ANY($1::uuid[]) ORDER BY id', [ids])).rows;
    assert.equal(sessions.length, 2);
    for (const session of sessions) assert.equal(session.expires_at - session.last_used_at, 365 * 86400_000);
    assert.deepEqual((await pool.query('SELECT id, last_used_at, expires_at FROM sessions WHERE NOT (id = ANY($1::uuid[])) ORDER BY id', [ids])).rows, unrelated);
    assert.equal((await api(app, config, '/me', { token: first.token })).status, 200);
    assert.deepEqual((await pool.query('SELECT id, last_used_at, expires_at FROM sessions WHERE id = ANY($1::uuid[]) ORDER BY id', [ids])).rows, sessions, '一小时内不重复写库');

    // 扩展刚续期过，网页会话却即将过期：必须独立续期父会话。
    await pool.query("UPDATE sessions SET last_used_at = now() - interval '2 hours', expires_at = now() + interval '2 minutes' WHERE id = $1", [ext.web_session_id]);
    assert.equal((await api(app, config, '/me', { token: first.token })).status, 200);
    const { rows: [parent] } = await pool.query('SELECT last_used_at, expires_at FROM sessions WHERE id = $1', [ext.web_session_id]);
    assert.equal(parent.expires_at - parent.last_used_at, 365 * 86400_000);

    const webRes = await first.browser.get('/');
    const name = config.secureCookies ? '__Host-huaci_session' : 'huaci_session';
    const cookie = webRes.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));
    assert.match(cookie, /Max-Age=31536000(?:;|$)/);
    assert.match(cookie, /HttpOnly/);
    assert.doesNotMatch(cookie, /Domain=/i);
    if (production) assert.match(cookie, /Secure/);

    // 不访问网页，只使用扩展也能持续保留；已经过期的凭据则不能复活。
    for (const id of ids) {
      await pool.query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE id = $1", [id]);
      assert.equal((await api(app, config, '/me', { token: first.token })).status, 401);
      assert.ok((await pool.query('SELECT expires_at FROM sessions WHERE id = $1', [id])).rows[0].expires_at < new Date());
      await pool.query("UPDATE sessions SET expires_at = now() + interval '1 day' WHERE id = $1", [id]);
    }
    await first.browser.post('/logout');
    assert.equal((await api(app, config, '/me', { token: first.token })).status, 401, '主动退出仍撤销关联扩展');
  });

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

  test(`扩展登出同步退出授权网页及关联扩展，保留其他浏览器和账户（${production ? '生产 HTTPS' : '本地 localhost'}）`, async () => {
    const config = testConfig(production ? {
      NODE_ENV: 'production', APP_ORIGIN: 'https://app.huaci.app', EXTENSION_IDS: EXT_ID,
      MAIL_TRANSPORT: 'resend', RESEND_API_KEY: 'test', MAIL_FROM: 'no-reply@huaci.app',
    } : {});
    const { app, mailbox } = buildApp({ pool, config });
    const first = await extensionLogin(app, config, mailbox, 'reverse@example.com');
    const otherBrowser = await extensionLogin(app, config, mailbox, 'reverse@example.com');
    const otherUser = await extensionLogin(app, config, mailbox, 'other@example.com');
    // 同一网页再次授权的扩展，以及尚未兑换的授权码，都受同一个网页会话约束。
    const sibling = pkce();
    await first.browser.get(authorizeUrl(sibling.challenge));
    let approved = await first.browser.post('/extension/authorize/confirm', { decision: 'approve' });
    const siblingToken = (await (await api(app, config, '/token', { method: 'POST', body: {
      code: new URL(approved.headers.get('location')).searchParams.get('code'),
      code_verifier: sibling.verifier, redirect_uri: REDIRECT,
    } })).json()).token;
    const pending = pkce();
    await first.browser.get(authorizeUrl(pending.challenge));
    approved = await first.browser.post('/extension/authorize/confirm', { decision: 'approve' });
    const code = new URL(approved.headers.get('location')).searchParams.get('code');
    const cookieName = config.secureCookies ? '__Host-huaci_session' : 'huaci_session';
    assert.equal((await api(app, config, '/logout', { method: 'POST', token: first.browser.jar.get(cookieName) })).status, 401,
      '网页令牌不能调用扩展退出接口');
    assert.equal((await first.browser.get('/')).status, 200);

    assert.equal((await api(app, config, '/logout', { method: 'POST', token: first.token })).status, 200);
    assert.equal((await api(app, config, '/me', { token: first.token })).status, 401);
    assert.equal((await api(app, config, '/me', { token: siblingToken })).status, 401);
    const state = await first.browser.get('/api/web/session');
    assert.equal((await state.json()).signedIn, false);
    const cleared = state.headers.getSetCookie().find((cookie) => cookie.startsWith(`${cookieName}=`));
    assert.match(cleared, /Max-Age=0(?:;|$)/);
    assert.match(cleared, /HttpOnly/);
    assert.doesNotMatch(cleared, /Domain=/i);
    if (production) assert.match(cleared, /Secure/);
    assert.equal(first.browser.jar.has(cookieName), false);
    assert.equal((await first.browser.get('/')).headers.get('location'), '/login');
    assert.equal((await api(app, config, '/token', { method: 'POST', body: {
      code, code_verifier: pending.verifier, redirect_uri: REDIRECT,
    } })).status, 400, '退出后不能再用尚未兑换的授权码建立会话');
    assert.equal((await otherBrowser.browser.get('/')).status, 200);
    assert.equal((await api(app, config, '/me', { token: otherBrowser.token })).status, 200);
    assert.equal((await otherUser.browser.get('/')).status, 200);
    assert.equal((await api(app, config, '/me', { token: otherUser.token })).status, 200);

    const guest = await (await api(app, config, '/guest', { method: 'POST' })).json();
    assert.ok(guest.token);
    assert.equal((await api(app, config, '/logout', { method: 'POST', token: guest.token })).status, 200);
    assert.equal((await api(app, config, '/me', { token: guest.token })).status, 401);
    assert.equal((await otherBrowser.browser.get('/')).status, 200, '未关联网页的访客退出不影响正式用户');
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
  // 流式：按两段吐出译文；failAfter 表示输出第一段后失败。
  hosted.stream = async ({ text, target }, onDelta) => {
    calls.push({ texts: [text], target, stream: true });
    const meta = { providerKey: 'primary', provider: 'deepseek', model: 'deepseek-flash', latencyMs: 5 };
    if (fail === 'before') throw Object.assign(new Error('model_500'), { code: 'http_500', meta });
    onDelta(`[${target}] `);
    if (fail === 'after') throw Object.assign(new Error('timeout'), { code: 'timeout', started: true, meta });
    onDelta(text);
    return { translation: `[${target}] ${text}`, meta: { ...meta, inputTokens: 10, cachedTokens: 0, outputTokens: 10, fellBack: false } };
  };
  return { hosted, calls };
}

/** 读完 SSE 响应，返回每个 data 事件解析后的对象。 */
async function sseEvents(res) {
  const text = await res.text();
  return text.split('\n\n').filter((block) => block.startsWith('data: ')).map((block) => JSON.parse(block.slice(6)));
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

test('托管翻译流式返回：逐段输出、结束时带余额；失败返还点数；多段或未要求时仍一次性返回', async () => {
  const { hosted, calls } = fakeHosted();
  const { app, config, mailbox } = buildApp({ pool, hosted });
  const { token } = await extensionLogin(app, config, mailbox, 'stream@example.com');
  let res = await api(app, config, '/translate', { method: 'POST', token, body: { texts: ['Hello world'], target: 'fr', stream: true } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/event-stream/);
  assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
  let events = await sseEvents(res);
  assert.deepEqual(events.slice(0, 2), [{ delta: '[fr] ' }, { delta: 'Hello world' }]);
  assert.equal(events[2].done, true);
  assert.equal(events[2].cost, '0.02');
  assert.equal(events[2].credits.balance, '99.98');
  assert.equal(calls.at(-1).stream, true);

  // 多段文字（区域翻译）不走流式
  res = await api(app, config, '/translate', { method: 'POST', token, body: { texts: ['a', 'b'], target: 'fr', stream: true } });
  assert.deepEqual((await res.json()).translations, ['[fr] a', '[fr] b']);
  assert.equal(calls.at(-1).stream, undefined);

  // 余额不足等前置检查仍是普通 JSON 错误
  await pool.query("UPDATE credit_ledger SET amount_units = 0 WHERE entry_type = 'trial_grant'");
  res = await api(app, config, '/translate', { method: 'POST', token, body: { texts: ['Hello'], target: 'fr', stream: true } });
  assert.equal(res.status, 402);

  for (const fail of ['before', 'after']) {
    const failing = fakeHosted({ fail });
    const built = buildApp({ pool, hosted: failing.hosted });
    const login = await extensionLogin(built.app, built.config, built.mailbox, `stream-${fail}@example.com`);
    res = await api(built.app, built.config, '/translate', { method: 'POST', token: login.token, body: { texts: ['Hello'], target: 'de', stream: true } });
    events = await sseEvents(res);
    assert.equal(events.at(-1).error, 'translation_failed');
    assert.equal(events.at(-1).credits.balance, '100.00', `${fail}：失败返还点数`);
    const { rows: [event] } = await pool.query('SELECT status, error FROM usage_events WHERE user_id = (SELECT id FROM users WHERE email = $1)', [`stream-${fail}@example.com`]);
    assert.equal(event.status, 'failed');
  }
});

test('预热接口不需要登录、不返回内容', async () => {
  const { app, config } = buildApp({ pool });
  const res = await api(app, config, '/ping');
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
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

const IMAGE = 'data:image/png;base64,' + 'A'.repeat(100_000);
function fakeVision() {
  const { hosted } = fakeHosted();
  const images = [];
  const layouts = [];
  hosted.readImageText = async ({ image, layout }) => {
    images.push(image);
    layouts.push(layout);
    return { raw: '[{"text":"Hello 🌍","box":[100,200,800,400]}]',
      meta: { providerKey: 'primary', provider: 'deepseek', model: 'deepseek-flash', inputTokens: 100, cachedTokens: 0, outputTokens: 20, latencyMs: 5 } };
  };
  return { hosted, images, layouts };
}

test('图片托管：识图后按识别文字精确扣点，记录识图成本且不保存图片、原文或译文', async () => {
  const { hosted, images, layouts } = fakeVision();
  const { app, config, mailbox } = buildApp({ pool, hosted });
  const { token, browser: web } = await extensionLogin(app, config, mailbox, 'vision@example.com');
  const me = await (await api(app, config, '/me', { token })).json();
  assert.equal(me.hosted.images, true);
  let res = await api(app, config, '/read-image', { method: 'POST', token, body: { image: IMAGE, model: 'ignored', url: 'https://ignored.example' } });
  assert.equal(res.status, 200, '>64KB 图片可用');
  const recognized = await res.json();
  assert.equal(recognized.credits.balance, '100.00', '识图不重复扣点');
  assert.deepEqual(images, [IMAGE]);
  assert.deepEqual(layouts, ['lines'], '默认逐行识别');
  for (const layout of ['paragraphs', 'evil']) {
    assert.equal((await api(app, config, '/read-image', { method: 'POST', token, body: { image: IMAGE, layout } })).status, 200);
  }
  assert.deepEqual(layouts, ['lines', 'paragraphs', 'lines'], 'AI 智能分段只认 paragraphs，其他值按逐行');
  const texts = JSON.parse(recognized.raw).map(b => b.text);
  res = await api(app, config, '/translate', { method: 'POST', token, body: { texts, target: 'ja' } });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).credits.balance, '99.99');
  const { rows } = await pool.query('SELECT * FROM usage_events ORDER BY created_at');
  assert.deepEqual(rows.map(e => [e.kind, e.status, e.chars, e.cost_units]),
    [['image', 'ok', 0, '0'], ['image', 'ok', 0, '0'], ['image', 'ok', 0, '0'], ['text', 'ok', 7, '7']], '分段识图同样不扣点');
  assert.equal(rows[0].input_tokens, 100);
  assert.ok(rows[0].cost_micros > 0);
  assert.doesNotMatch(JSON.stringify(rows), /Hello|data:image|こんにちは/);
  assert.match(await web.text('/usage'), /图片识别/);
});

test('图片托管：未登录、网页凭据、空余额、冻结、暂停与非法图片均不调用模型', async () => {
  const { hosted, images } = fakeVision();
  const { app, config, mailbox, settings } = buildApp({ pool, hosted });
  const { token, browser: web } = await extensionLogin(app, config, mailbox, 'vision-gates@example.com');
  const read = (body = { image: IMAGE }, auth = token) => api(app, config, '/read-image', { method: 'POST', token: auth, body });
  assert.equal((await read({}, '')).status, 401);
  assert.equal((await read({}, web.jar.get('huaci_session'))).status, 401);
  for (const image of ['file:///etc/passwd', 'https://user:password@example.com/a.png', 'http://127.0.0.1/a.png', 'data:image/svg+xml;base64,AAAA', {}, null]) {
    assert.equal((await read({ image })).status, 400);
  }
  const large = JSON.stringify({ image: 'data:image/png;base64,' + 'A'.repeat(8 * 1024 * 1024) });
  assert.equal((await app.request(`${config.appOrigin}/api/extension/read-image`, { method: 'POST', headers: {
    authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(large)) }, body: large })).status, 413);
  await pool.query('DELETE FROM credit_ledger');
  assert.equal((await read()).status, 402);
  await pool.query('UPDATE users SET hosted_frozen_at = now()');
  assert.equal((await read()).status, 403);
  await settings.set('hosted_enabled', false);
  assert.equal((await read()).status, 503);
  assert.equal(images.length, 0);
});

test('图片托管：模型失败不扣点，失败及并发请求也受可配置的小时上限约束', async () => {
  const { hosted, images } = fakeVision();
  const original = hosted.readImageText;
  hosted.readImageText = async (request) => {
    await original(request);
    throw Object.assign(new Error('sensitive model output'), { code: 'http_500' });
  };
  const { app, config, mailbox, settings } = buildApp({ pool, hosted });
  const { token } = await extensionLogin(app, config, mailbox, 'vision-fail@example.com');
  await settings.set('hosted_image_hourly_requests', 1);
  const results = await Promise.all([1, 2].map(() => api(app, config, '/read-image', { method: 'POST', token, body: { image: IMAGE } })));
  assert.deepEqual(results.map(r => r.status).sort(), [429, 502]);
  assert.equal(images.length, 1);
  const failed = await results.find(r => r.status === 502).json();
  assert.equal(failed.credits.balance, '100.00');
  assert.doesNotMatch(JSON.stringify(failed), /sensitive/);
  assert.equal((await pool.query("SELECT status FROM usage_events WHERE kind = 'image'")).rows[0].status, 'failed');
  assert.equal((await pool.query("SELECT 1 FROM credit_ledger WHERE entry_type IN ('usage', 'refund')")).rowCount, 0);
});

test('图片托管：访客不足显示精度的正余额可识图；订阅用户零余额也可识图且仍受隐藏上限约束', async () => {
  const { hosted, images } = fakeVision();
  const { app, config, mailbox, settings } = buildApp({ pool, hosted });
  const guest = await (await api(app, config, '/guest', { method: 'POST', body: {} })).json();
  await pool.query("UPDATE credit_ledger SET amount_units = 1 WHERE entry_type = 'guest_grant'");
  let res = await api(app, config, '/read-image', { method: 'POST', token: guest.token, body: { image: IMAGE } });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).credits, { balance: '0.00', available: true });
  const { token } = await extensionLogin(app, config, mailbox, 'vision-sub@example.com');
  const { rows: [user] } = await pool.query("SELECT id FROM users WHERE email = 'vision-sub@example.com'");
  await pool.query('DELETE FROM credit_ledger WHERE user_id = $1', [user.id]);
  await pool.query(`INSERT INTO subscriptions (user_id, provider, provider_subscription_id, plan, status, last_event_at)
    VALUES ($1, 'creem', 'sub_vision_test', 'monthly', 'active', now())`, [user.id]);
  res = await api(app, config, '/read-image', { method: 'POST', token, body: { image: IMAGE } });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).subscription.unlimited, true);
  res = await api(app, config, '/translate', { method: 'POST', token, body: { texts: ['Hello'], target: 'ja' } });
  assert.equal((await res.json()).cost, '0.00');
  await settings.set('subscriber_monthly_chars', 5);
  res = await api(app, config, '/read-image', { method: 'POST', token, body: { image: IMAGE } });
  assert.equal(res.status, 429);
  assert.equal((await res.json()).error, 'fair_use');
  assert.equal(images.length, 2);
});
