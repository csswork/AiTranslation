import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readConfig } from '../src/config/index.js';

const base = { DATABASE_URL: 'postgres://localhost/x', AUTH_SECRET: 'x'.repeat(64) };

test('开发环境默认值', () => {
  const config = readConfig({ DATABASE_URL: 'postgres://localhost/x' });
  assert.equal(config.appOrigin, 'http://localhost:8787');
  assert.equal(config.secureCookies, false);
  assert.equal(config.google, null);
  assert.ok(config.authSecret.length >= 32, '开发环境自动生成密钥');
});

test('缺少数据库地址时拒绝启动', () => {
  assert.throws(() => readConfig({}), /缺少 DATABASE_URL/);
});

test('Google 客户端 ID 与密钥必须成对配置', () => {
  assert.throws(() => readConfig({ ...base, GOOGLE_CLIENT_ID: 'id' }), /缺少 GOOGLE_CLIENT_SECRET/);
  assert.deepEqual(readConfig({ ...base, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's' }).google,
    { clientId: 'id', clientSecret: 's' });
});

test('生产环境要求 HTTPS、密钥和正式发信；Creem 需成对配置且不能用测试模式', () => {
  assert.throws(() => readConfig({
    NODE_ENV: 'production', DATABASE_URL: 'postgres://db/x', APP_ORIGIN: 'http://app.example',
  }), (e) => {
    for (const text of ['HTTPS', 'AUTH_SECRET', 'console']) assert.match(e.message, new RegExp(text));
    return true;
  });
  assert.throws(() => readConfig({ ...base, CREEM_API_KEY: 'k' }), /CREEM_WEBHOOK_SECRET[\s\S]*CREEM_PRODUCT_MONTHLY[\s\S]*CREEM_PRODUCT_YEARLY/);
  const creem = readConfig({ ...base, CREEM_API_KEY: 'k', CREEM_WEBHOOK_SECRET: 'w', CREEM_PRODUCT_MONTHLY: 'pm', CREEM_PRODUCT_YEARLY: 'py', CREEM_TEST_MODE: '1' }).creem;
  assert.deepEqual(creem.products, { monthly: 'pm', yearly: 'py' });
  assert.equal(creem.testMode, true);
  assert.equal(readConfig(base).adminOrigin, 'http://admin.localhost:8787', '开发环境默认的管理端地址');
  assert.equal(readConfig({ ...base, HOSTED_FALLBACK_API_KEY: 'f' }).hosted.fallback.model, 'accounts/fireworks/routers/deepseek-v4p1-flash-us');
});

test('SHARED_COOKIE_DOMAIN 必须覆盖用户端与官网的主机名', () => {
  const config = readConfig({ ...base, APP_ORIGIN: 'https://app.huaci.app', WEB_ORIGINS: 'https://huaci.app', SHARED_COOKIE_DOMAIN: '.huaci.app' });
  assert.equal(config.sharedCookieDomain, 'huaci.app');
  assert.throws(() => readConfig({ ...base, APP_ORIGIN: 'https://app.huaci.app', WEB_ORIGINS: 'https://other.example', SHARED_COOKIE_DOMAIN: 'huaci.app' }), /SHARED_COOKIE_DOMAIN/);
  assert.throws(() => readConfig({ ...base, WEB_ORIGINS: 'huaci.app' }), /WEB_ORIGINS/);
});

test('发信：生产环境用 Resend，需要 API Key 与发件地址', async () => {
  assert.throws(() => readConfig({ ...base, MAIL_TRANSPORT: 'resend' }), /缺少 RESEND_API_KEY[\s\S]*缺少 MAIL_FROM/);
  const config = readConfig({ ...base, MAIL_TRANSPORT: 'resend', RESEND_API_KEY: 're_x', MAIL_FROM: 'AI 划词翻译 <no-reply@huaci.app>' });
  assert.equal(config.links.support, 'support@huaci.app');
  const { createMailer, codeEmail } = await import('../src/mail/index.js');
  const calls = [];
  const mailer = createMailer(config, { fetchImpl: async (url, init) => { calls.push([url, init]); return new Response('{}', { status: 200 }); } });
  await mailer.sendCode({ to: 'a@example.com', code: '123456', purpose: 'login', locale: 'en' });
  const [url, init] = calls[0];
  assert.equal(url, 'https://api.resend.com/emails');
  assert.equal(init.headers.authorization, 'Bearer re_x');
  const body = JSON.parse(init.body);
  assert.deepEqual(body.to, ['a@example.com']);
  assert.equal(body.reply_to, 'support@huaci.app');
  assert.match(body.subject, /123456/);
  assert.match(body.text, /123456/);
  const zh = codeEmail({ code: '654321', purpose: 'change_email', locale: 'zh-Hans', support: 'support@huaci.app' });
  assert.match(zh.subject, /654321 是你的 AI 划词翻译验证码/);
  assert.match(zh.html, /更换为这个地址[\s\S]*654321[\s\S]*10 分钟/);
  const failing = createMailer(config, { fetchImpl: async () => new Response('{}', { status: 422 }) });
  await assert.rejects(failing.sendCode({ to: 'a@example.com', code: '1', purpose: 'login' }), /resend_422/);
});
