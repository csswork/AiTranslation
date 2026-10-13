import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { checkCatalogs } from '../scripts/i18n.mjs';
import { createI18n, negotiateLocale } from '../src/i18n/index.js';
import { browser, buildApp, createTestPool, resetData, signInWithEmail, testConfig } from './helpers.mjs';

let pool;
before(async () => { pool = await createTestPool(); });
after(async () => { await pool?.end(); });
beforeEach(async () => { await resetData(pool); });

test('11 种语言的译文覆盖全部界面文案，占位符一致', () => {
  assert.deepEqual(checkCatalogs(), []);
});

test('按 Accept-Language 选择界面语言', () => {
  assert.equal(negotiateLocale('zh-CN,zh;q=0.9,en;q=0.8'), 'zh-Hans');
  assert.equal(negotiateLocale('zh-TW'), 'zh-Hant');
  assert.equal(negotiateLocale('zh-Hant-HK'), 'zh-Hant');
  assert.equal(negotiateLocale('pt-BR,pt;q=0.9'), 'pt');
  assert.equal(negotiateLocale('it-IT, de;q=0.5'), 'de');
  assert.equal(negotiateLocale('en;q=0.2, ja;q=0.8'), 'ja');
  assert.equal(negotiateLocale('it'), 'en');
  assert.equal(negotiateLocale(''), 'en');
});

test('翻译函数转义译文与参数，html 片段参数原样插入', async () => {
  const { t } = createI18n('en');
  const remaining = String(t('验证码不正确，还可以尝试 {n} 次。', { n: 3 }));
  assert.match(remaining, /3/);
  assert.doesNotMatch(remaining, /\{n\}|验证码/);
  assert.match(String(t('当前邮箱：{email}（已验证）', { email: '<b>x</b>' })), /&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(String(t('不存在的文案 <i>')), /不存在的文案 &lt;i&gt;/);
});

test('页面按语言输出 lang、dir、译文和官网对应语言的链接', async () => {
  const { app, config } = buildApp({ pool });
  const en = await (await browser(app, config).request('/login', { headers: { 'accept-language': 'en-US' } })).text();
  assert.match(en, /<html lang="en" dir="ltr">/);
  assert.match(en, /AI Selection Translator/);
  assert.match(en, /href="https:\/\/huaci\.app\/en\/#features"/);
  assert.match(en, /<option value="en" selected/);
  assert.doesNotMatch(en, /登录或注册/);

  const ar = await (await browser(app, config).request('/login', { headers: { 'accept-language': 'ar' } })).text();
  assert.match(ar, /<html lang="ar" dir="rtl">/);

  const zh = await browser(app, config).text('/login');
  assert.match(zh, /<html lang="zh-Hans" dir="ltr">/);
  assert.match(zh, /href="https:\/\/huaci\.app\/#features"/);
});

test('切换语言写入 Cookie 并回到原页面；只接受站内路径', async () => {
  const { app, config, mailbox } = buildApp({ pool });
  const b = await signInWithEmail(app, config, mailbox, 'lang@example.com');
  let res = await b.post('/preferences/lang', { lang: 'ja', next: '/usage' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/usage');
  assert.equal(b.jar.get('lang'), 'ja');
  const page = await b.text('/usage');
  assert.match(page, /<html lang="ja"/);
  assert.match(page, /<option value="ja" selected/);

  for (const next of ['//evil.example/x', 'https://evil.example/', '/\\evil']) {
    res = await b.post('/preferences/lang', { lang: 'fr', next });
    assert.equal(res.headers.get('location'), '/', next);
  }
  await b.post('/preferences/lang', { lang: 'xx', next: '/' });
  assert.equal(b.jar.get('lang'), 'fr', '无效语言不改变设置');
});

test('提示信息按当前语言显示，含参数', async () => {
  const { app, config, mailbox } = buildApp({ pool });
  const b = browser(app, config);
  b.jar.set('lang', 'en');
  await b.post('/login/email', { email: 'notice@example.com' });
  const code = mailbox.last();
  const res = await b.post('/login/verify', { code: code === '000000' ? '111111' : '000000' });
  const body = await res.text();
  assert.match(body, /4/);
  assert.doesNotMatch(body, /验证码不正确/);
});

test('配色偏好：服务端输出 data-theme，Cookie 可被页面脚本改写', async () => {
  const { app, config } = buildApp({ pool });
  const b = browser(app, config);
  assert.doesNotMatch(await b.text('/login'), /data-theme=/);

  const res = await b.post('/preferences/theme', { theme: 'dark', next: '/login' });
  assert.equal(res.headers.get('location'), '/login');
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('theme='));
  assert.doesNotMatch(cookie, /HttpOnly/i);
  let page = await b.text('/login');
  assert.match(page, /data-theme="dark"/);
  assert.match(page, /name="theme" value="light"/, '无脚本时下一次切到浅色');

  await b.post('/preferences/theme', { theme: 'system', next: '/login' });
  page = await b.text('/login');
  assert.doesNotMatch(page, /data-theme=/);
  b.jar.set('theme', 'purple');
  assert.doesNotMatch(await b.text('/login'), /data-theme=/);
});

test('语言与配色偏好写在与官网共用的 Cookie 里：脚本可读，配置父域时写到父域', async () => {
  const { app, config } = buildApp({ pool });
  let res = await browser(app, config).post('/preferences/lang', { lang: 'de', next: '/' });
  let cookie = res.headers.getSetCookie().find((c) => c.startsWith('lang='));
  assert.doesNotMatch(cookie, /HttpOnly|Domain=/i);

  const shared = buildApp({ pool, config: testConfig({ APP_ORIGIN: 'https://app.huaci.app', WEB_ORIGINS: 'https://huaci.app', SHARED_COOKIE_DOMAIN: 'huaci.app' }) });
  const b = browser(shared.app, shared.config);
  res = await b.request('/preferences/theme', { method: 'POST', form: { theme: 'dark', next: '/' }, headers: { origin: 'https://app.huaci.app' } });
  cookie = res.headers.getSetCookie().find((c) => c.startsWith('theme='));
  assert.match(cookie, /Domain=huaci\.app/);
  assert.match(cookie, /Secure/);
  assert.doesNotMatch(cookie, /HttpOnly/i);
  assert.match(await b.text('/login'), /data-cookie-domain="huaci\.app"/);
  // 会话 Cookie 不受影响，仍只属于用户端主机
  const session = (await b.request('/login', { headers: { origin: 'https://app.huaci.app' } })).headers.getSetCookie().join('\n');
  assert.doesNotMatch(session, /__Host-huaci_session=[^\n]*Domain=/);
});

test('官网选择的语言（共用 lang Cookie）在用户端生效', async () => {
  const { app, config } = buildApp({ pool });
  const b = browser(app, config);
  b.jar.set('lang', 'ko');
  assert.match(await b.text('/login'), /<html lang="ko"/);
});
