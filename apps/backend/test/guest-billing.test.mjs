import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import { handleCreemEvent } from '../src/billing/creem.js';
import { networkOf } from '../src/guest/index.js';
import { creditBalance } from '../src/credits/ledger.js';
import { browser, buildApp, createTestPool, resetData, signInWithEmail, testConfig } from './helpers.mjs';

let pool;
before(async () => { pool = await createTestPool(); });
after(async () => { await pool?.end(); });
beforeEach(async () => { await resetData(pool); });

const EXT_ID = 'abcdefghijklmnopabcdefghijklmnop';
const ORIGIN = `chrome-extension://${EXT_ID}`;
const REDIRECT = `${ORIGIN}/src/auth/callback.html`;
const config = testConfig({ TRUST_PROXY: '1' });

function api(app, path, { method = 'GET', token, body, ip = '203.0.113.7' } = {}) {
  const headers = { origin: ORIGIN, 'x-forwarded-for': ip };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers['content-type'] = 'application/json';
  return app.request(new URL(`/api/extension${path}`, config.appOrigin), { method, headers, body: body ? JSON.stringify(body) : undefined });
}

const guest = async (app, ip) => (await api(app, '/guest', { method: 'POST', ip })).json();
const linkOf = (welcomeUrl) => new URL(welcomeUrl).search;

function fakeHosted() {
  return async ({ texts, target }) => ({
    translations: texts.map((t) => `[${target}] ${t}`),
    meta: { providerKey: 'primary', provider: 'deepseek', model: 'deepseek-flash', inputTokens: 1_000_000, cachedTokens: 0, outputTokens: 1_000_000, latencyMs: 9, fellBack: false },
  });
}

const PRODUCTS = { monthly: 'prod_month', yearly: 'prod_year' };
function fakeCreem({ secret = 'whsec_test' } = {}) {
  const calls = [];
  return {
    calls,
    secret,
    testMode: true,
    planOf: (id) => Object.entries(PRODUCTS).find(([, p]) => p === id)?.[0] || null,
    async createCheckout(args) { calls.push(['checkout', args]); return 'https://checkout.creem.io/ch_test'; },
    async customerPortal(customerId) { calls.push(['portal', customerId]); return 'https://creem.io/my-orders/login/x'; },
    verifyWebhook(raw, signature) { return signature === createHmac('sha256', secret).update(raw).digest('hex'); },
  };
}

const sign = (secret, raw) => createHmac('sha256', secret).update(raw).digest('hex');
const webhook = (app, creem, event, signature) => {
  const raw = JSON.stringify(event);
  return app.request(new URL('/webhooks/creem', config.appOrigin), {
    method: 'POST', headers: { 'content-type': 'application/json', 'creem-signature': signature ?? sign(creem.secret, raw) }, body: raw,
  });
};

async function extensionLogin(app, mailbox, email, guestToken) {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  await pool.query("UPDATE email_codes SET created_at = now() - interval '2 minutes'");
  const b = await signInWithEmail(app, config, mailbox, email);
  await b.get(`/extension/authorize?redirect_uri=${encodeURIComponent(REDIRECT)}&code_challenge=${challenge}&code_challenge_method=S256&state=s`);
  const res = await b.post('/extension/authorize/confirm', { decision: 'approve' });
  const code = new URL(res.headers.get('location')).searchParams.get('code');
  const token = await api(app, '/token', { method: 'POST', body: { code, code_verifier: verifier, redirect_uri: REDIRECT, guest_token: guestToken } });
  return { ...(await token.json()), browser: b };
}

test('IPv6 按 /64 计数，IPv4 映射地址按 IPv4', () => {
  assert.equal(networkOf('2001:db8:1:2:3:4:5:6'), '2001:db8:1:2::/64');
  assert.equal(networkOf('2001:db8:1:2::9'), '2001:db8:1:2::/64');
  assert.equal(networkOf('::ffff:198.51.100.4'), '198.51.100.4');
});

test('访客：安装即得点数，可直接托管翻译；同一网络超过次数、全站当日总量满后不再发放', async () => {
  const { app, settings } = buildApp({ pool, config, hosted: fakeHosted() });
  const first = await guest(app, '198.51.100.1');
  assert.equal(first.outcome, 'granted');
  assert.equal(first.granted, '50.00');
  assert.match(first.welcomeUrl, /^http:\/\/localhost:8787\/welcome\?link=/);

  let me = await (await api(app, '/me', { token: first.token })).json();
  assert.equal(me.kind, 'guest');
  assert.equal(me.username, '', '访客不显示自动生成的用户名');
  assert.equal(me.credits.balance, '50.00');

  const res = await api(app, '/translate', { method: 'POST', token: first.token, body: { texts: ['Hello'], target: 'fr' } });
  assert.equal(res.status, 200);
  me = await res.json();
  assert.equal(me.credits.balance, '49.99');
  const { rows: [event] } = await pool.query('SELECT audience, provider, model, input_tokens, output_tokens, cost_micros, latency_ms FROM usage_events');
  assert.deepEqual(event, { audience: 'guest', provider: 'deepseek', model: 'deepseek-flash', input_tokens: 1_000_000, output_tokens: 1_000_000, cost_micros: '1500000', latency_ms: 9 });

  // 同一网络 30 天内最多 3 次
  await guest(app, '198.51.100.1');
  await guest(app, '198.51.100.1');
  const fourth = await guest(app, '198.51.100.1');
  assert.equal(fourth.outcome, 'ip_limited');
  assert.equal(fourth.granted, '0.00');
  assert.equal((await (await api(app, '/me', { token: fourth.token })).json()).credits.balance, '0.00');

  await settings.set('guest_daily_cap', '3');
  const capped = await guest(app, '198.51.100.99');
  assert.equal(capped.outcome, 'daily_cap');
  await settings.set('guest_daily_cap', '100');
  await settings.set('guest_credits', '80');
  assert.equal((await guest(app, '198.51.100.99')).granted, '80.00', '管理员调整后立即生效');

  const { rows: claims } = await pool.query('SELECT ip_hash FROM guest_claims');
  assert.ok(claims.every((c) => /^[0-9a-f]{64}$/.test(c.ip_hash) && !c.ip_hash.includes('198')), 'IP 只存哈希');
});

test('欢迎页：第一次写入浏览器标记；同一浏览器重装接回旧访客的点数，新访客作废', async () => {
  const { app } = buildApp({ pool, config, hosted: fakeHosted() });
  const b = browser(app, config);
  const first = await guest(app, '198.51.100.2');
  await api(app, '/translate', { method: 'POST', token: first.token, body: { texts: ['x'.repeat(1200)], target: 'fr' } });
  let page = await b.text(`/welcome${linkOf(first.welcomeUrl)}`);
  assert.match(page, /data-outcome="new"/);
  assert.match(page, /已送你 47\.60 点免费点数/);
  assert.ok(b.jar.get('huaci_browser'), '写入浏览器标记');
  assert.match((await b.text(`/welcome${linkOf(first.welcomeUrl)}`)), /data-outcome="invalid"/, '关联码只能用一次');

  // 卸载重装：新访客（换了 IP，照样发放），打开欢迎页时被识别
  const second = await guest(app, '198.51.100.3');
  assert.equal(second.granted, '50.00');
  page = await b.text(`/welcome${linkOf(second.welcomeUrl)}`);
  assert.match(page, /data-outcome="restored"/);
  assert.match(page, /剩余 47\.60 点/);
  const me = await (await api(app, '/me', { token: second.token })).json();
  assert.equal(me.credits.balance, '47.60', '扩展会话接回旧访客，不多发点数');
  const { rows: guests } = await pool.query(`SELECT COUNT(*)::int AS n FROM users WHERE kind = 'guest'`);
  assert.equal(guests[0].n, 1, '新访客已删除');
  const { rows: outcomes } = await pool.query('SELECT outcome, granted_units FROM guest_claims ORDER BY created_at');
  assert.deepEqual(outcomes.map((o) => [o.outcome, o.granted_units]), [['granted', '25000'], ['reinstall', '0']]);
});

test('注册：扩展登录时访客剩余点数转入正式账户；网页登录时同一浏览器的访客自动合并，扩展随之登录', async () => {
  const { app, mailbox } = buildApp({ pool, config, hosted: fakeHosted() });
  // 扩展里点登录：带上访客令牌
  const g1 = await guest(app, '198.51.100.4');
  await api(app, '/translate', { method: 'POST', token: g1.token, body: { texts: ['Hello'], target: 'fr' } });
  const login = await extensionLogin(app, mailbox, 'convert@example.com', g1.token);
  assert.equal(login.transferred, '49.99');
  const me = await (await api(app, '/me', { token: login.token })).json();
  assert.equal(me.kind, 'member');
  assert.equal(me.credits.balance, '149.99');
  assert.equal((await api(app, '/me', { token: g1.token })).status, 401, '访客会话随访客账户删除');
  const { rows: [usage] } = await pool.query('SELECT u.kind FROM usage_events e JOIN users u ON u.id = e.user_id');
  assert.equal(usage.kind, 'member', '用量记录转到正式账户');
  const { rows: [claim] } = await pool.query('SELECT merged_user_id FROM guest_claims');
  assert.ok(claim.merged_user_id, '转化记录保留');

  // 欢迎页上点「注册 / 登录」：网页登录后访客合并，扩展的访客令牌变成正式账户
  const g2 = await guest(app, '198.51.100.5');
  const b = browser(app, config);
  await b.get(`/welcome${linkOf(g2.welcomeUrl)}`);
  await b.post('/login/email', { email: 'web@example.com' });
  await b.post('/login/verify', { code: mailbox.last('web@example.com') });
  const after = await (await api(app, '/me', { token: g2.token })).json();
  assert.equal(after.kind, 'member');
  assert.equal(after.credits.balance, '150.00');

  // 这个浏览器已注册：再装一次扩展，欢迎页作废新访客的点数，不自动登录
  const g3 = await guest(app, '198.51.100.6');
  const page = await b.text(`/welcome${linkOf(g3.welcomeUrl)}`);
  assert.match(page, /data-outcome="already_member"/);
  assert.equal((await (await api(app, '/me', { token: g3.token })).json()).credits.balance, '0.00');
  await b.post('/logout');
  assert.equal((await api(app, '/me', { token: g2.token })).status, 401, '网页登录合并的访客扩展也随网页登出');
  assert.equal((await api(app, '/me', { token: g3.token })).status, 200, '没有登录的访客会话保持独立');
});

test('不足展示精度的访客余额，经扩展或网页登录均完整转入并可继续使用', async () => {
  const { app, settings, mailbox } = buildApp({ pool, config, hosted: fakeHosted() });
  await settings.set('guest_credits', '0.01');
  await settings.set('signup_credits', '0');
  for (const method of ['extension', 'web']) {
    const g = await guest(app, method === 'web' ? '198.51.100.50' : '198.51.100.51');
    assert.equal(g.granted, '0.01');
    const translated = await api(app, '/translate', { method: 'POST', token: g.token, body: { texts: ['abcd'], target: 'en' } });
    assert.deepEqual((await translated.json()).credits, { balance: '0.00', available: true });
    let token = g.token;
    const email = `${method}@precision.example`;
    if (method === 'extension') {
      const login = await extensionLogin(app, mailbox, email, g.token);
      token = login.token;
      assert.equal(login.transferred, '0.00');
    } else {
      const b = browser(app, config);
      await b.get(`/welcome${linkOf(g.welcomeUrl)}`);
      await b.post('/login/email', { email });
      await b.post('/login/verify', { code: mailbox.last(email) });
    }
    const { rows: [user] } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    assert.equal(await creditBalance(pool, user.id), 1n);
    const { rows: [transfer] } = await pool.query("SELECT amount_units FROM credit_ledger WHERE user_id = $1 AND entry_type = 'transfer'", [user.id]);
    assert.equal(transfer.amount_units, '1', '0.002 点不因展示为 0.00 而丢弃');
    const last = await api(app, '/translate', { method: 'POST', token, body: { texts: ['x'], target: 'en' } });
    assert.equal(last.status, 200);
    assert.deepEqual((await last.json()).credits, { balance: '0.00', available: false });
    assert.equal(await creditBalance(pool, user.id), 0n);
  }
});

test('访客令牌不能当网页会话用；访客不能在用户端登录', async () => {
  const { app } = buildApp({ pool, config });
  const g = await guest(app, '198.51.100.7');
  const res = await app.request(new URL('/', config.appOrigin), { headers: { cookie: `huaci_session=${g.token}` } });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/login');
});

test('订阅：验签的回调开通订阅，托管翻译不扣点并显示无限使用；重复事件幂等；取消后恢复扣点', async () => {
  const creem = fakeCreem();
  const { app, mailbox } = buildApp({ pool, config, hosted: fakeHosted(), creem });
  const { token, browser: web } = await extensionLogin(app, mailbox, 'sub@example.com');
  const { rows: [{ id: userId }] } = await pool.query(`SELECT id FROM users WHERE email = 'sub@example.com'`);

  // 结账：跳到 Creem，元数据只带内部用户 ID
  let res = await web.post('/billing/checkout', { plan: 'yearly' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), 'https://checkout.creem.io/ch_test');
  assert.equal(creem.calls[0][1].plan, 'yearly');
  assert.equal(creem.calls[0][1].userId, userId);
  assert.match((await web.get('/plans')).headers.get('content-security-policy'), /form-action 'self'[^;]*https:\/\/\*\.creem\.io/);

  const subscription = {
    id: 'sub_1', object: 'subscription', product: { id: PRODUCTS.yearly, price: 2999, currency: 'USD' }, customer: { id: 'cust_1', email: 'x@y', name: 'Real Name' },
    status: 'active', current_period_end_date: new Date(Date.now() + 365 * 86400_000).toISOString(), metadata: { userId },
    last_transaction_id: 'tran_1', last_transaction_date: new Date().toISOString(),
  };
  assert.equal((await webhook(app, creem, { id: 'evt_x', eventType: 'subscription.paid', object: subscription }, 'bad')).status, 401);
  res = await webhook(app, creem, { id: 'evt_1', eventType: 'checkout.completed', created_at: Date.now(), object: { id: 'ch_1', metadata: { userId }, order: { id: 'ord_1', type: 'recurring', amount: 2999, currency: 'USD' }, subscription: { ...subscription, product: PRODUCTS.yearly, metadata: undefined }, customer: { id: 'cust_1' } } });
  assert.equal(res.status, 200);
  res = await webhook(app, creem, { id: 'evt_2', eventType: 'subscription.paid', created_at: Date.now() + 1, object: subscription });
  assert.equal((await res.json()).result, 'processed');
  res = await webhook(app, creem, { id: 'evt_2', eventType: 'subscription.paid', created_at: Date.now() + 1, object: subscription });
  assert.equal((await res.json()).result, 'duplicate');

  const { rows: orders } = await pool.query('SELECT plan, amount, currency, status FROM orders');
  assert.deepEqual(orders, [{ plan: 'yearly', amount: 2999, currency: 'USD', status: 'paid' }], '首期只按 subscription.paid 记一次');
  const { rows: [sub] } = await pool.query('SELECT * FROM subscriptions');
  assert.equal(sub.plan, 'yearly');
  assert.equal(sub.provider_customer_id, 'cust_1');
  assert.ok(!JSON.stringify(sub).includes('Real Name'), '不保存姓名');

  let me = await (await api(app, '/me', { token })).json();
  assert.equal(me.subscription.unlimited, true);
  res = await api(app, '/translate', { method: 'POST', token, body: { texts: ['x'.repeat(3000)], target: 'de' } });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).cost, '0.00');
  me = await (await api(app, '/me', { token })).json();
  assert.equal(me.credits.balance, '100.00', '订阅期间不扣点');
  const { rows: [usage] } = await pool.query('SELECT audience, cost_units FROM usage_events');
  assert.deepEqual(usage, { audience: 'subscriber', cost_units: '0' });
  assert.match(await web.text('/'), /data-unlimited/);
  assert.match(await web.text('/billing'), /年付[\s\S]*管理订阅、付款方式与发票/);
  res = await web.post('/billing/portal');
  assert.equal(res.headers.get('location'), 'https://creem.io/my-orders/login/x');

  // 退款与取消
  await webhook(app, creem, {
    id: 'evt_3', eventType: 'refund.created', created_at: Date.now() + 2,
    object: { id: 'ref_1', refund_amount: 3629, transaction: { id: 'tran_1', amount: 2999, amount_paid: 3629, refunded_amount: 3629, currency: 'USD', subscription: 'sub_1' }, subscription: { ...subscription, status: 'canceled' } },
  });
  const { rows: [refunded] } = await pool.query('SELECT refunded_amount, status FROM orders');
  assert.deepEqual(refunded, { refunded_amount: 2999, status: 'refunded' }, '退款按税前折算');
  me = await (await api(app, '/me', { token })).json();
  assert.equal(me.subscription, null);
  assert.equal((await (await api(app, '/translate', { method: 'POST', token, body: { texts: ['x'], target: 'de' } })).json()).cost, '0.00');

  // 较早的事件不会覆盖较新的状态
  await handleCreemEvent(pool, creem, { id: 'evt_old', eventType: 'subscription.active', created_at: Date.now() - 86400_000, object: subscription });
  assert.equal((await pool.query('SELECT status FROM subscriptions')).rows[0].status, 'canceled');
});

test('订阅用户的隐藏每月字数上限；冻结托管服务后拒绝请求', async () => {
  const creem = fakeCreem();
  const { app, mailbox, settings } = buildApp({ pool, config, hosted: fakeHosted(), creem });
  const { token } = await extensionLogin(app, mailbox, 'heavy@example.com');
  const { rows: [{ id: userId }] } = await pool.query(`SELECT id FROM users WHERE email = 'heavy@example.com'`);
  await webhook(app, creem, { id: 'e1', eventType: 'subscription.active', created_at: Date.now(), object: { id: 'sub_h', product: PRODUCTS.monthly, customer: 'cust_h', status: 'active', metadata: { userId } } });
  await settings.set('subscriber_monthly_chars', '5000');
  assert.equal((await api(app, '/translate', { method: 'POST', token, body: { texts: ['x'.repeat(4000)], target: 'de' } })).status, 200);
  const res = await api(app, '/translate', { method: 'POST', token, body: { texts: ['x'.repeat(2000)], target: 'de' } });
  assert.equal(res.status, 429);
  assert.equal((await res.json()).error, 'fair_use');

  await pool.query('UPDATE users SET hosted_frozen_at = now() WHERE id = $1', [userId]);
  assert.equal((await api(app, '/translate', { method: 'POST', token, body: { texts: ['x'], target: 'de' } })).status, 403);
  assert.equal((await (await api(app, '/me', { token })).json()).hosted.available, false);
});

test('DEV_TRIAL_RESET=1 时可重置本机网络的领取记录与浏览器标记，能再领完整访客点数；默认没有此接口，生产环境不能开启', async () => {
  const ip = '198.51.100.50';
  const reset = (app, cfg) => app.request(new URL('/api/extension/dev/reset-trial', cfg.appOrigin), {
    method: 'POST', headers: { origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop', 'x-forwarded-for': ip },
  });

  // 默认（未设置开关）：没有这个接口
  const plain = buildApp({ pool, config });
  assert.equal((await reset(plain.app, config)).status, 404);

  const devConfig = testConfig({ TRUST_PROXY: '1', DEV_TRIAL_RESET: '1' });
  const { app } = buildApp({ pool, config: devConfig });
  const b = browser(app, devConfig);
  const first = await guest(app, ip);
  await b.get(`/welcome${linkOf(first.welcomeUrl)}`);
  await guest(app, ip);
  await guest(app, ip);
  assert.equal((await guest(app, ip)).outcome, 'ip_limited', '同一网络超过次数');

  const body = await (await reset(app, devConfig)).json();
  assert.equal(body.removed.claims, 4);
  assert.ok(body.removed.marks >= 1, '浏览器标记一并删除');
  const again = await guest(app, ip);
  assert.equal(again.outcome, 'granted');
  // 浏览器里还带着旧的标记 Cookie，但库里已没有对应记录：当成新浏览器，发放完整访客点数
  assert.match(await b.text(`/welcome${linkOf(again.welcomeUrl)}`), /data-outcome="new"[\s\S]*已送你 50\.00 点/);

  assert.throws(() => testConfig({ NODE_ENV: 'production', APP_ORIGIN: 'https://app.example', MAIL_TRANSPORT: 'resend', RESEND_API_KEY: 'r', MAIL_FROM: 'a@b.c', DEV_TRIAL_RESET: '1' }),
    /生产环境不能设置 DEV_TRIAL_RESET/);
});
