import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { base32Decode, base32Encode, currentStep, totpCode, verifyTotp } from '../src/admin/totp.js';
import { browser, buildApp, createTestPool, resetData, signInWithEmail, testConfig } from './helpers.mjs';

let pool;
before(async () => { pool = await createTestPool(); });
after(async () => { await pool?.end(); });
beforeEach(async () => { await resetData(pool); });

const ADMIN = 'http://admin.localhost:8787';

test('TOTP：与 RFC 6238 测试向量一致，同一时间步只能用一次', () => {
  // RFC 6238 附录 B：密钥 "12345678901234567890"，T = 59 秒 → 94287082（取后 6 位 287082）
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(base32Decode(secret).toString(), '12345678901234567890');
  assert.equal(totpCode(secret, 1), '287082');
  const now = Date.now();
  const step = verifyTotp(secret, totpCode(secret, currentStep(now)), { now });
  assert.equal(step, currentStep(now));
  assert.equal(verifyTotp(secret, totpCode(secret, step), { now, lastStep: step }), null, '不能重放');
});

/** 注册账户、设为管理员、在管理端走完验证码与二步验证。 */
async function adminLogin(app, config, mailbox, email = 'boss@example.com') {
  await signInWithEmail(app, config, mailbox, email);
  await pool.query(`INSERT INTO admins (user_id) SELECT id FROM users WHERE email = $1`, [email]);
  const a = browser(app, config, ADMIN);
  await a.post('/login', { email });
  // 开发环境（console 发信）验证页直接给出验证码
  const verify = await a.text('/login/verify');
  assert.match(verify, new RegExp(`data-dev-code="${mailbox.last(email)}"[\\s\\S]*dev-code\\.js|dev-code\\.js[\\s\\S]*data-dev-code="${mailbox.last(email)}"`));
  let res = await a.post('/login/verify', { code: mailbox.last(email) });
  assert.equal(res.headers.get('location'), '/2fa');
  assert.equal((await a.get('/')).headers.get('location'), '/2fa', '二步验证前不能进入');
  const page = await a.text('/2fa');
  const secret = page.match(/<code>([A-Z2-7 ]+)<\/code>/)[1].replace(/ /g, '');
  assert.equal((await a.post('/2fa', { code: '000000' })).headers.get('location'), '/2fa');
  res = await a.post('/2fa', { code: totpCode(secret, currentStep()) });
  assert.equal(res.headers.get('location'), '/');
  return { a, secret };
}

test('管理端：独立入口，只有指定的管理员能登录，必须二步验证；用户端会话无效', async () => {
  const { app, config, mailbox } = buildApp({ pool, config: testConfig({ ADMIN_REQUIRE_2FA: '1' }) });
  // 普通用户：用户端已登录，在管理端仍是未登录；也收不到管理端验证码
  const user = await signInWithEmail(app, config, mailbox, 'user@example.com');
  const sent = mailbox.sent.length;
  const asUser = browser(app, config, ADMIN);
  for (const [k, v] of user.jar) asUser.jar.set(k, v);
  assert.equal((await asUser.get('/')).headers.get('location'), '/login');
  await asUser.post('/login', { email: 'user@example.com' });
  assert.equal(mailbox.sent.length, sent, '非管理员不发验证码');
  assert.equal((await asUser.post('/login/verify', { code: '123456' })).status, 400);

  const { a } = await adminLogin(app, config, mailbox);
  const overview = await a.text('/');
  // 只有两个注册账户（普通用户和管理员）：只显示「新注册」，其余没有数据的指标与图表都不显示
  assert.match(overview, /运营概览[\s\S]*新注册[\s\S]*增长趋势/);
  assert.doesNotMatch(overview, /托管请求|模型成本|有效订阅|转化漏斗|使用时段/);
  const { rows: [adminRow] } = await pool.query('SELECT totp_secret, totp_enabled_at FROM admins');
  assert.ok(adminRow.totp_enabled_at);
  assert.doesNotMatch(adminRow.totp_secret, /^[A-Z2-7]+$/, 'TOTP 密钥加密存储');

  // 同源校验：跨站提交被拒绝
  assert.equal((await a.post('/settings', { reason: 'x' }, { origin: 'https://evil.example' })).status, 403);
  // 管理端的页面在用户端主机上不存在
  assert.equal((await browser(app, config).get('/settings')).status, 404);
});

test('管理端：修改规则写审计并立即生效；补发点数、冻结与撤销会话需要原因', async () => {
  const { app, config, mailbox, settings } = buildApp({ pool, config: testConfig({ ADMIN_REQUIRE_2FA: '1' }) });
  const { a } = await adminLogin(app, config, mailbox);

  let res = await a.post('/settings', { guest_credits: '60', signup_credits: '200', guest_ip_limit: '3', guest_ip_window_days: '30', guest_daily_cap: '2000' });
  assert.match(decodeURIComponent(a.jar.get('admin_flash') || ''), /请填写修改原因/);
  res = await a.post('/settings', { guest_credits: '60', signup_credits: '250', guest_ip_limit: '3', guest_ip_window_days: '30', guest_daily_cap: '2000', reason: '活动' });
  assert.equal(res.status, 303);
  assert.equal((await settings.all()).guest_credits, 60);
  assert.equal((await settings.all()).signup_credits, 250);
  await a.post('/settings', { price_monthly: 'abc', reason: 'x' });
  assert.equal((await settings.all()).price_monthly, '3.99', '无效值不保存');

  // 新注册用户按新的赠送点数
  await signInWithEmail(app, config, mailbox, 'new@example.com');
  const { rows: [newUser] } = await pool.query(`SELECT id FROM users WHERE email = 'new@example.com'`);
  const { rows: [grant] } = await pool.query(`SELECT amount FROM credit_ledger WHERE user_id = $1`, [newUser.id]);
  assert.equal(grant.amount, 250);

  assert.match(await a.text(`/users?q=new@example.com`), /new@example\.com/);
  assert.match(await a.text(`/users/${newUser.id}`), /250<span class="unit">点/);
  await a.post(`/users/${newUser.id}/credits`, { amount: '30' });
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM credit_ledger WHERE entry_type = 'adjust'`)).rows[0].n, 0, '没有原因不补发');
  await a.post(`/users/${newUser.id}/credits`, { amount: '30', reason: '补偿故障' });
  await a.post(`/users/${newUser.id}/freeze`, { reason: '异常用量' });
  await a.post(`/users/${newUser.id}/revoke-sessions`, { reason: '排查' });
  const { rows: [u] } = await pool.query('SELECT hosted_frozen_at FROM users WHERE id = $1', [newUser.id]);
  assert.ok(u.hosted_frozen_at);
  assert.match(await a.text(`/users/${newUser.id}`), /管理员补发[\s\S]*\+30[\s\S]*补偿故障/);

  const audit = await a.text('/audit');
  for (const action of ['settings.update', 'credits.adjust', 'user.freeze_hosted', 'user.revoke_sessions', 'admin.totp_enabled']) {
    assert.match(audit, new RegExp(action.replace('.', '\\.')), action);
  }
  for (const path of ['/subscriptions', '/ledger', '/events', '/settings', '/?days=7', '/?days=90']) {
    assert.equal((await a.get(path)).status, 200, path);
  }

  await a.post('/logout');
  assert.equal((await a.get('/')).headers.get('location'), '/login');
});

test('本地开发默认跳过二步验证：邮箱验证码通过后直接进入管理端', async () => {
  const { app, config, mailbox } = buildApp({ pool });
  assert.equal(config.adminRequire2fa, false);
  await signInWithEmail(app, config, mailbox, 'dev@example.com');
  await pool.query(`INSERT INTO admins (user_id) SELECT id FROM users WHERE email = 'dev@example.com'`);
  const a = browser(app, config, ADMIN);
  await a.post('/login', { email: 'dev@example.com' });
  const res = await a.post('/login/verify', { code: mailbox.last('dev@example.com') });
  assert.equal(res.headers.get('location'), '/');
  assert.match(await a.text('/'), /运营概览/);
  const { rows: [adminRow] } = await pool.query('SELECT totp_enabled_at FROM admins');
  assert.equal(adminRow.totp_enabled_at, null, '没有绑定 TOTP');

  // 打开二步验证时登录到一半留下的会话：本地关闭后直接可用，不再跳到 /2fa
  await pool.query('UPDATE admin_sessions SET verified_at = NULL');
  assert.equal((await a.get('/')).status, 200);
  assert.equal((await a.get('/2fa')).headers.get('location'), '/');
});

test('运营概览：有数据的指标与图表才显示；按国家、语言、时段统计', async () => {
  const config = testConfig({ GEO_COUNTRY_HEADER: 'cf-ipcountry', TRUST_PROXY: '1', ADMIN_REQUIRE_2FA: '1' });
  const hosted = async ({ texts, target }) => ({
    translations: texts.map((t) => `[${target}] ${t}`),
    meta: { providerKey: 'primary', provider: 'deepseek', model: 'deepseek-flash', inputTokens: 1000, cachedTokens: 0, outputTokens: 800, latencyMs: 1500, fellBack: false },
  });
  const { app, mailbox } = buildApp({ pool, config, hosted });
  const ext = (path, { body, token, ip, country }) => app.request(new URL(`/api/extension${path}`, config.appOrigin), {
    method: 'POST',
    headers: { origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop', 'content-type': 'application/json', 'x-forwarded-for': ip, 'cf-ipcountry': country, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body || {}),
  });
  for (const [ip, country, uiLanguage, target] of [['1.1.1.1', 'JP', 'ja', 'zh-Hans'], ['1.1.1.2', 'US', 'en', 'zh-Hans'], ['1.1.1.3', 'US', 'en', 'ja'], ['1.1.1.4', 'XX', 'de', 'en']]) {
    const { token } = await (await ext('/guest', { body: { uiLanguage }, ip, country })).json();
    assert.equal((await ext('/translate', { token, ip, country, body: { texts: ['Hello world'], target } })).status, 200);
  }
  const { rows: claims } = await pool.query('SELECT country, ui_lang FROM guest_claims ORDER BY created_at');
  assert.deepEqual(claims.map((c) => [c.country, c.ui_lang]), [['JP', 'ja'], ['US', 'en'], ['US', 'en'], [null, 'de']], 'XX 视为未知');
  const { rows: events } = await pool.query('SELECT country, target_lang FROM usage_events ORDER BY created_at');
  assert.deepEqual(events.map((e) => e.target_lang), ['zh-Hans', 'zh-Hans', 'ja', 'en']);

  const { a } = await adminLogin(app, config, mailbox);
  const page = await a.text('/?days=7');
  assert.match(page, /class="kpi"[\s\S]*扩展安装[\s\S]*托管请求/);
  assert.doesNotMatch(page, /有效订阅|收入（USD/, '没有订阅和收入时不显示这两项');
  assert.match(page, /增长趋势[\s\S]*<svg class="chart"/);
  assert.match(page, /转化漏斗/);
  assert.match(page, /目标语言[\s\S]*简体中文[\s\S]*日语/);
  assert.match(page, /安装地区[\s\S]*美国[\s\S]*日本/);
  assert.match(page, /使用时段[\s\S]*class="chart heat"/);
  assert.match(page, /响应耗时[\s\S]*P50/);
  assert.match(page, /data-theme-form/, '页头有配色切换');

  // 配色与用户端共用 theme Cookie
  await a.post('/preferences/theme', { theme: 'dark', next: '/' });
  assert.match(await a.text('/'), /<html lang="zh-CN" data-theme="dark">/);
});
