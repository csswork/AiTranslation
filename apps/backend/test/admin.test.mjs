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
  // 核心指标始终显示（没有数据时为 0）；没有数据的图表与排行不显示
  assert.match(overview, /API 消耗[\s\S]*输入 token[\s\S]*经营[\s\S]*净收入[\s\S]*US\$0\.00[\s\S]*收入[\s\S]*支出[\s\S]*用户与使用[\s\S]*托管请求[\s\S]*有效订阅[\s\S]*增长趋势/);
  assert.doesNotMatch(overview, /转化漏斗|使用时段|每日 token|每日收入|每日支出|按服务商与模型|累计收入、支出与利润/);
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
  assert.equal((await settings.all()).guest_credits, '60.00');
  assert.equal((await settings.all()).signup_credits, '250.00');
  await a.post('/settings', { price_monthly: 'abc', reason: 'x' });
  assert.equal((await settings.all()).price_monthly, '3.99', '无效值不保存');

  // 新注册用户按新的赠送点数
  await signInWithEmail(app, config, mailbox, 'new@example.com');
  const { rows: [newUser] } = await pool.query(`SELECT id FROM users WHERE email = 'new@example.com'`);
  const { rows: [grant] } = await pool.query(`SELECT amount_units FROM credit_ledger WHERE user_id = $1`, [newUser.id]);
  assert.equal(grant.amount_units, '125000');

  assert.match(await a.text(`/users?q=new@example.com`), /new@example\.com/);
  assert.match(await a.text(`/users/${newUser.id}`), /250\.00<span class="unit">点/);
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
  assert.doesNotMatch(page, /每日收入|收入按方案/, '没有收入时不显示收入图表');
  assert.match(page, /毛收入[\s\S]*US\$0\.00/, '收入指标显示为 0');
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

test('支出分摊：一次性记在当天，每月按年 / 365 天分摊，结束日之后不再计入', async () => {
  const { allocateExpenses, dayLabels, parseExpense } = await import('../src/admin/finance.js');
  const labels = ['2026-10-01', '2026-10-02', '2026-10-03'];
  const byDay = allocateExpenses([
    { category: 'domain', amount_cents: 1200, recurring: 'none', start_date: '2026-10-02', end_date: null },
    { category: 'server', amount_cents: 3650, recurring: 'monthly', start_date: '2026-09-01', end_date: '2026-10-02' },
    { category: 'tools', amount_cents: 36500, recurring: 'yearly', start_date: '2026-10-03', end_date: null },
  ], labels);
  assert.deepEqual(byDay['2026-10-01'], { server: 120 });
  assert.deepEqual(byDay['2026-10-02'], { domain: 1200, server: 120 });
  assert.deepEqual(byDay['2026-10-03'], { tools: 100 });
  assert.equal(dayLabels(3, 'UTC', 0, new Date('2026-10-15T12:00:00Z')).join(), '2026-10-13,2026-10-14,2026-10-15');
  assert.equal(dayLabels(2, 'UTC', 2, new Date('2026-10-15T12:00:00Z')).join(), '2026-10-12,2026-10-13');
  assert.equal(parseExpense({ category: 'server', amount: '-1', start_date: '2026-10-01' }), null);
  assert.equal(parseExpense({ category: 'server', amount: '9.99', recurring: 'monthly', start_date: '2026-10-02', end_date: '2026-10-01' }), null);
  assert.deepEqual(parseExpense({ category: 'server', amount: '9.99', recurring: 'monthly', start_date: '2026-10-01', note: ' VPS ' }),
    { category: 'server', recurring: 'monthly', amountCents: 999, startDate: '2026-10-01', endDate: null, note: 'VPS' });
});

test('运营概览：收入、支出、利润与 API 消耗；录入支出写审计；模型成本可改按账单', async () => {
  const config = testConfig({ ADMIN_REQUIRE_2FA: '1' });
  const { app, mailbox, settings } = buildApp({ pool, config });
  const { a } = await adminLogin(app, config, mailbox);
  const { rows: [owner] } = await pool.query(`SELECT id FROM users WHERE email = 'boss@example.com'`);
  // 两笔订单：同一订阅的首期与续费，各 $29.99；一个请求的模型成本 $1.00
  await pool.query(
    `INSERT INTO orders (user_id, provider, provider_order_id, provider_subscription_id, plan, amount, currency, status, created_at)
     VALUES ($1, 'creem', 'tran_a', 'sub_x', 'yearly', 2999, 'USD', 'paid', now() - interval '2 days'),
            ($1, 'creem', 'tran_b', 'sub_x', 'yearly', 2999, 'USD', 'paid', now() - interval '1 hour')`, [owner.id]);
  await pool.query(
    `INSERT INTO usage_events (user_id, kind, chars, cost_units, status, audience, provider, model, input_tokens, cached_tokens, output_tokens, cost_micros, latency_ms)
     VALUES ($1, 'text', 1000, 2, 'ok', 'member', 'deepseek', 'deepseek-flash', 400, 100, 300, 1000000, 1200)`, [owner.id]);

  let res = await a.post('/expenses', { category: 'domain', amount: '12.00', recurring: 'none', start_date: new Date().toISOString().slice(0, 10), note: 'huaci.app' });
  assert.equal(res.headers.get('location'), '/expenses');
  await a.post('/expenses', { category: 'server', amount: 'abc', recurring: 'monthly', start_date: '2026-01-01' });
  const { rows: expenseRows } = await pool.query('SELECT category, amount_cents FROM expenses');
  assert.deepEqual(expenseRows, [{ category: 'domain', amount_cents: 1200 }], '无效金额不保存');
  assert.match(await a.text('/expenses'), /域名[\s\S]*US\$12\.00[\s\S]*huaci\.app/);

  const page = await a.text('/?days=7');
  assert.match(page, /经营[\s\S]*净收入[\s\S]*US\$59\.98/);
  // 支出 = 模型 $1.00 + 手续费 2 × $0.40 + 3.9% × $59.98（$2.34）+ 域名 $12.00 = $16.14；利润 = $43.84
  assert.match(page, /总支出[\s\S]*US\$16\.14/);
  assert.match(page, /利润[\s\S]*US\$43\.84/);
  assert.match(page, /收入[\s\S]*续费收入[\s\S]*US\$29\.99/);
  assert.match(page, /API 消耗[\s\S]*输入 token[\s\S]*400[\s\S]*缓存命中 25\.0%/);
  assert.match(page, /按服务商与模型[\s\S]*DeepSeek 官方[\s\S]*deepseek-flash/);

  // 改按账单：没有录入模型 API 账单时，利润表的模型成本为 0
  await settings.set('api_cost_source', 'bills');
  assert.match(await a.text('/?days=7'), /总支出[\s\S]*US\$15\.14[\s\S]*模型成本按账单/);

  const { rows: [expense] } = await pool.query('SELECT id FROM expenses');
  await a.post(`/expenses/${expense.id}/delete`, { reason: '录错' });
  assert.equal((await pool.query('SELECT 1 FROM expenses WHERE deleted_at IS NULL')).rowCount, 0);
  assert.match(await a.text('/audit'), /expense\.delete[\s\S]*录错[\s\S]*expense\.create/);
});

test('每位用户的 API 使用都有记录：成功、失败与被拒（点数不足等），在 API 用量与用户详情里可查', async () => {
  const config = testConfig({ ADMIN_REQUIRE_2FA: '1' });
  let fail = false;
  const hosted = async ({ texts, target }) => {
    const meta = { providerKey: 'primary', provider: 'deepseek', model: 'deepseek-flash', latencyMs: 900 };
    if (fail) throw Object.assign(new Error('x'), { code: 'timeout', meta });
    return { translations: texts.map((t) => `[${target}] ${t}`), meta: { ...meta, inputTokens: 120, cachedTokens: 0, outputTokens: 80, fellBack: false } };
  };
  const { app, mailbox } = buildApp({ pool, config, hosted });
  const ext = (path, { token, body } = {}) => app.request(new URL(`/api/extension${path}`, config.appOrigin), {
    method: 'POST',
    headers: { origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop', 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body || {}),
  });
  const { token } = await (await ext('/guest')).json();
  assert.equal((await ext('/translate', { token, body: { texts: ['Hello'], target: 'fr' } })).status, 200);
  fail = true;
  assert.equal((await ext('/translate', { token, body: { texts: ['Hello'], target: 'fr' } })).status, 502);
  fail = false;
  assert.equal((await ext('/translate', { token, body: { texts: ['x'.repeat(7000)], target: 'fr' } })).status, 413);
  await pool.query(`UPDATE credit_ledger SET amount_units = 500 WHERE entry_type = 'guest_grant'`);
  assert.equal((await ext('/translate', { token, body: { texts: ['x'.repeat(2000)], target: 'ja' } })).status, 402);
  assert.equal((await ext('/translate', { token, body: { texts: [] } })).status, 400, '格式错误的请求不记录');

  const { rows: rejections } = await pool.query('SELECT reason, audience, chars, cost_units, target_lang FROM usage_rejections ORDER BY created_at');
  assert.deepEqual(rejections, [
    { reason: 'too_long', audience: 'guest', chars: 7000, cost_units: null, target_lang: 'fr' },
    { reason: 'insufficient_credits', audience: 'guest', chars: 2000, cost_units: '2000', target_lang: 'ja' },
  ]);
  assert.equal((await pool.query('SELECT 1 FROM usage_events')).rowCount, 2, '成功与失败各一条');

  const { a } = await adminLogin(app, config, mailbox);
  const list = await a.text('/api-usage?days=7');
  assert.match(list, /API 用量[\s\S]*访客[\s\S]*<td class="num">2<\/td><td class="num">1<\/td><td class="num">2<\/td>/, '请求 2（含失败 1）、被拒 2');
  assert.match(await a.text('/api-usage?days=7&sort=rejected'), /被拒 ↓/);
  const { rows: [g] } = await pool.query(`SELECT id FROM users WHERE kind = 'guest'`);
  const detail = await a.text(`/users/${g.id}`);
  assert.match(detail, /API 消耗[\s\S]*近 30 天[\s\S]*全部/);
  assert.match(detail, /用过的模型[\s\S]*deepseek-flash/);
  assert.match(detail, /被拒绝的请求[\s\S]*点数不足[\s\S]*超过单次字数上限/);
  const overview = await a.text('/?days=7');
  assert.match(overview, /<h2 class="section-title">API 消耗[\s\S]*查看每位用户[\s\S]*被拒绝的请求/);
  assert.ok(overview.indexOf('API 消耗') < overview.indexOf('用户与使用'), 'API 消耗在首页最前面');
});
