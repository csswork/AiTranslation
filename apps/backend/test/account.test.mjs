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

test('U2–U5、U8 页面需要登录并显示当前用户的数据', async () => {
  const { app, config, mailbox } = buildApp({ pool });
  const b = await signInWithEmail(app, config, mailbox, 'ivy@example.com');
  const pages = {
    '/plans': /付费套餐尚未开放/,
    '/billing': /暂无订单/,
    '/usage': /注册试用赠送[\s\S]*\+100/,
    '/help': /自带 Key/,
  };
  for (const [path, pattern] of Object.entries(pages)) {
    const res = await b.get(path);
    assert.equal(res.status, 200, path);
    const body = await res.text();
    assert.match(body, pattern, path);
    assert.match(body, new RegExp(`href="${path}" aria-current="page"`), path);
    const anonymous = await browser(app, config).get(path);
    assert.equal(location(anonymous), '/login', path);
  }
});

test('U6 修改用户名：校验格式、拒绝重复', async () => {
  const { app, config, mailbox } = buildApp({ pool });
  const jack = await signInWithEmail(app, config, mailbox, 'jack@example.com');
  await signInWithEmail(app, config, mailbox, 'kate@example.com');

  let res = await jack.post('/account/username', { username: 'Jack_01' });
  assert.equal(location(res), '/account');
  assert.match(await jack.text('/account'), /用户名已更新/);
  assert.equal((await pool.query("SELECT username FROM users WHERE email = 'jack@example.com'")).rows[0].username, 'jack_01');

  res = await jack.post('/account/username', { username: 'a b' });
  assert.equal(res.status, 400);
  assert.match(await res.text(), /3–24 位/);

  const kate = (await pool.query("SELECT username FROM users WHERE email = 'kate@example.com'")).rows[0].username;
  res = await jack.post('/account/username', { username: kate });
  assert.equal(res.status, 400);
  assert.match(await res.text(), /已被使用/);
});

test('U6 更换邮箱：验证码发到新邮箱，验证后生效；已被占用的邮箱被拒绝', async () => {
  const { app, config, mailbox } = buildApp({ pool });
  const b = await signInWithEmail(app, config, mailbox, 'leo@example.com');
  await signInWithEmail(app, config, mailbox, 'mia@example.com');

  let res = await b.post('/account/email', { email: 'mia@example.com' });
  assert.equal(res.status, 400);
  assert.match(await res.text(), /已被其他账户使用/);

  res = await b.post('/account/email', { email: 'leo@example.com' });
  assert.match(await res.text(), /已经是当前邮箱/);

  res = await b.post('/account/email', { email: 'leo.new@example.com' });
  assert.equal(location(res), '/account/email/verify');
  const code = mailbox.last('leo.new@example.com');
  assert.equal(mailbox.sent.at(-1).purpose, 'change_email');

  // 别的账号拿到这个验证码也不能使用。
  const mia = await (async () => {
    await pool.query("UPDATE email_codes SET created_at = now() - interval '2 minutes' WHERE email = 'mia@example.com'");
    return signInWithEmail(app, config, mailbox, 'mia@example.com');
  })();
  mia.jar.set('pending_email', 'leo.new@example.com');
  res = await mia.post('/account/email/verify', { code });
  assert.equal(res.status, 400);

  res = await b.post('/account/email/verify', { code });
  assert.equal(location(res), '/account');
  assert.match(await b.text('/account'), /leo\.new@example\.com/);
  assert.equal((await pool.query("SELECT 1 FROM users WHERE email = 'leo@example.com'")).rowCount, 0);
});

test('U6 绑定与解除 Google；已绑定其他账户的 Google 账号不能再绑定', async () => {
  const google = fakeGoogle({
    nina: { sub: 'g-nina', email: 'nina.google@gmail.com', email_verified: true },
    owen: { sub: 'g-owen', email: 'owen@example.com', email_verified: true },
  });
  const { app, config, mailbox } = buildApp({ pool, google, config: testConfig({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's' }) });
  const b = await signInWithEmail(app, config, mailbox, 'nina@example.com');
  assert.match(await b.text('/account'), /绑定 Google/);

  const link = async (code) => {
    const start = await b.post('/auth/google/link');
    const state = new URL(location(start)).searchParams.get('state');
    return b.get(`/auth/google/callback?code=${code}&state=${state}`);
  };

  let res = await link('good-nina');
  assert.equal(location(res), '/account');
  let page = await b.text('/account');
  assert.match(page, /已绑定 Google 账号/);
  assert.match(page, /解除绑定/);
  // Google 账号的邮箱与账户邮箱不同也不会覆盖账户邮箱。
  assert.equal((await pool.query('SELECT email FROM users')).rows[0].email, 'nina@example.com');

  res = await b.post('/account/google/unlink');
  assert.match(await b.text('/account'), /已解除 Google 绑定/);
  assert.equal((await pool.query('SELECT 1 FROM identities')).rowCount, 0);

  // owen 先用 Google 注册，nina 再尝试绑定同一个 Google 账号。
  const owen = browser(app, config);
  const start = await owen.get('/auth/google');
  await owen.get(`/auth/google/callback?code=good-owen&state=${new URL(location(start)).searchParams.get('state')}`);
  res = await link('good-owen');
  page = await b.text('/account');
  assert.match(page, /已绑定其他账户/);
  assert.equal((await pool.query('SELECT 1 FROM credit_ledger')).rowCount, 2);
});

test('U7 会话列表、退出指定会话与退出其他全部会话', async () => {
  const { app, config, mailbox } = buildApp({ pool });
  const laptop = await signInWithEmail(app, config, mailbox, 'paul@example.com');
  await pool.query("UPDATE email_codes SET created_at = now() - interval '2 minutes'");
  const phone = await signInWithEmail(app, config, mailbox, 'paul@example.com');
  await pool.query("UPDATE email_codes SET created_at = now() - interval '2 minutes'");
  const tablet = await signInWithEmail(app, config, mailbox, 'paul@example.com');

  let page = await laptop.text('/sessions');
  assert.equal(page.match(/<tr>\s*<td>网站/g).length, 3);
  assert.equal(page.match(/class="tag">当前/g).length, 1);
  assert.doesNotMatch(page, /User-Agent|IP/);

  const { rows } = await pool.query('SELECT id FROM sessions ORDER BY created_at');
  let res = await laptop.post(`/sessions/${rows[1].id}/revoke`);
  assert.equal(location(res), '/sessions');
  assert.equal(location(await phone.get('/')), '/login');

  res = await laptop.post('/sessions/revoke-others');
  assert.match(await laptop.text('/sessions'), /已退出其他全部会话/);
  assert.equal(location(await tablet.get('/')), '/login');
  assert.equal((await laptop.get('/')).status, 200);

  // 不能退出别人的会话。
  const quinn = await signInWithEmail(app, config, mailbox, 'quinn@example.com');
  const { rows: [laptopSession] } = await pool.query(
    "SELECT s.id FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = 'paul@example.com' AND s.revoked_at IS NULL",
  );
  await quinn.post(`/sessions/${laptopSession.id}/revoke`);
  assert.equal((await laptop.get('/')).status, 200);
  assert.equal((await quinn.post('/sessions/not-a-uuid/revoke')).status, 404);
});

test('页面转义用户数据', async () => {
  const { app, config, mailbox } = buildApp({ pool });
  const b = await signInWithEmail(app, config, mailbox, 'rae@example.com');
  await pool.query("UPDATE users SET email = '<b>rae</b>@example.com'");
  const page = await b.text('/');
  assert.doesNotMatch(page, /<b>rae<\/b>/);
  assert.match(page, /&lt;b&gt;rae&lt;\/b&gt;@example\.com/);
});

test('静态资源与 404', async () => {
  const { app, config } = buildApp({ pool });
  const b = browser(app, config);
  const href = (await b.text('/login')).match(/href="(\/assets\/account\.css\?v=[0-9a-f]{12})"/)?.[1];
  assert.ok(href, '页面引用带内容哈希的样式地址');
  const css = await b.get(href);
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);
  assert.match(css.headers.get('cache-control'), /immutable/);
  assert.equal((await b.get('/assets/account.css?v=old')).headers.get('cache-control'), 'no-cache');
  assert.equal((await b.get('/assets/../config/index.js')).status, 404);
  const missing = await b.get('/nope');
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /页面不存在/);
});
