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

test('生产环境要求 HTTPS、密钥、正式发信和明确的试用点数', () => {
  assert.throws(() => readConfig({
    NODE_ENV: 'production', DATABASE_URL: 'postgres://db/x', APP_ORIGIN: 'http://app.example',
  }), (e) => {
    for (const text of ['HTTPS', 'AUTH_SECRET', 'console', 'TRIAL_CREDITS']) assert.match(e.message, new RegExp(text));
    return true;
  });
});
