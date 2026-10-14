import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { browser, buildApp, createTestPool, resetData, signInWithEmail } from './helpers.mjs';

let pool;
before(async () => { pool = await createTestPool(); });
after(async () => { await pool?.end(); });
beforeEach(async () => { await resetData(pool); });

const WEB = 'http://localhost:8788';

test('官网状态接口：未登录只返回登录地址，带 CORS 白名单头', async () => {
  const { app, config } = buildApp({ pool });
  const res = await browser(app, config).request('/api/web/session', { headers: { origin: WEB } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), WEB);
  assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
  assert.match(res.headers.get('vary'), /Origin/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await res.json(), { signedIn: false, loginUrl: 'http://localhost:8787/login' });
});

test('官网状态接口：已登录返回用户名和点数，不返回邮箱；其他来源不给 CORS 头', async () => {
  const { app, config, mailbox } = buildApp({ pool });
  const b = await signInWithEmail(app, config, mailbox, 'web@example.com');
  const res = await b.request('/api/web/session', { headers: { origin: WEB } });
  const body = await res.json();
  assert.equal(body.signedIn, true);
  assert.match(body.username, /^user_/);
  assert.deepEqual(body.credits, { balance: 100 });
  assert.equal(body.accountUrl, 'http://localhost:8787/');
  assert.doesNotMatch(JSON.stringify(body), /web@example\.com|"id"/);

  const evil = await b.request('/api/web/session', { headers: { origin: 'https://evil.example' } });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
});

test('从官网进入登录：完成后回到官网原页面；白名单外的地址被忽略', async () => {
  const { app, config, mailbox } = buildApp({ pool });
  const b = browser(app, config);
  await b.get(`/login?return=${encodeURIComponent(`${WEB}/en/#install`)}`);
  await b.post('/login/email', { email: 'back@example.com' });
  const res = await b.post('/login/verify', { code: mailbox.last() });
  assert.equal(res.headers.get('location'), `${WEB}/en/#install`);
  // 已登录再从官网点“登录”，直接返回。
  const again = await b.get(`/login?return=${encodeURIComponent(`${WEB}/ja/`)}`);
  assert.equal(again.headers.get('location'), `${WEB}/ja/`);

  const other = browser(app, config);
  await other.get('/login?return=https%3A%2F%2Fevil.example%2F');
  assert.equal(other.jar.has('return_to'), false);
  await other.post('/login/email', { email: 'stay@example.com' });
  assert.equal((await other.post('/login/verify', { code: mailbox.last() })).headers.get('location'), '/');
});

test('页头与页脚的链接与官网首页一致', async () => {
  const { app, config } = buildApp({ pool });
  const page = await browser(app, config).text('/login');
  const web = fs.readFileSync(new URL('../../web/public/index.html', import.meta.url), 'utf8');
  const section = (html, open, close) => html.slice(html.indexOf(open), html.indexOf(close, html.indexOf(open)));
  // 账户入口（class="account-link"）两边都有但地址不同，单独测试，这里不比较。
  const hrefs = (html) => [...html.matchAll(/<a ([^>]*)>/g)]
    .filter((m) => !/class="account-link[ "]/.test(m[1]))
    .map((m) => m[1].match(/href="([^"]+)"/)[1]);
  const absolute = (href) => (/^https?:/.test(href) ? href : `https://huaci.app/${href}`);

  const webNav = hrefs(section(web, '<nav class="nav-links">', '</nav>')).map(absolute);
  const ourNav = hrefs(section(page, '<nav class="nav-links">', '</nav>'));
  assert.match(web, /<a class="account-link is-login" href="[^"]+" data-account hidden>/, '官网页头有账户入口（未登录样式）');
  assert.match(page, /<a class="account-link is-login" href="\/login">/, '用户端未登录时同样是登录按钮');
  assert.deepEqual(ourNav, webNav);

  const webFoot = hrefs(section(web, '<nav class="foot-links">', '</nav>')).map(absolute);
  const ourFoot = hrefs(section(page, '<nav class="foot-links">', '</nav>'));
  assert.deepEqual(ourFoot, webFoot);
});
