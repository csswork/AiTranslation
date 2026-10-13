/** 测试工具：独立的测试数据库、带 Cookie 的请求客户端、记录验证码的发信替身和 Google 替身。 */
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config/index.js';
import { createPool } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://localhost:5432/huaci_test';

/** 重建测试库的 public schema 并执行全部迁移。只允许名字以 _test 结尾的数据库。 */
export async function createTestPool() {
  const name = new URL(TEST_DATABASE_URL).pathname.slice(1);
  if (!name.endsWith('_test')) throw new Error(`拒绝清空非测试数据库：${name}`);
  const pool = createPool(TEST_DATABASE_URL);
  try {
    await pool.query('SELECT 1');
  } catch (error) {
    await pool.end();
    throw new Error(`无法连接测试数据库 ${TEST_DATABASE_URL}：${error.message}`);
  }
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool);
  return pool;
}

export const resetData = (pool) => pool.query('TRUNCATE users, email_codes CASCADE');

export function testConfig(overrides = {}) {
  return readConfig({
    APP_ORIGIN: 'http://localhost:8787',
    DATABASE_URL: TEST_DATABASE_URL,
    AUTH_SECRET: 'x'.repeat(64),
    TRIAL_CREDITS: '100',
    TRIAL_DAYS: '30',
    ...overrides,
  });
}

export function createMailbox() {
  const sent = [];
  return {
    sent,
    mailer: { sendCode: async (message) => { sent.push(message); } },
    last: (to) => [...sent].reverse().find((m) => !to || m.to === to)?.code,
  };
}

const unsignedJwt = (payload) => `${[{ alg: 'none' }, payload]
  .map((part) => Buffer.from(JSON.stringify(part)).toString('base64url')).join('.')}.sig`;

/** 模拟 Google：授权码 good-<name> 对应 accounts[name] 的 ID token 声明。 */
export function fakeGoogle(accounts) {
  return {
    requests: [],
    createAuthorizationURL(state, codeVerifier, scopes) {
      this.requests.push({ state, codeVerifier, scopes });
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.searchParams.set('state', state);
      url.searchParams.set('scope', scopes.join(' '));
      return url;
    },
    async validateAuthorizationCode(code) {
      const claims = accounts[code.replace(/^good-/, '')];
      if (!code.startsWith('good-') || !claims) throw new Error('invalid_grant');
      return { idToken: () => unsignedJwt(claims) };
    },
  };
}

export function buildApp({ pool, config = testConfig(), google = null } = {}) {
  const mailbox = createMailbox();
  const silent = { log() {}, warn() {}, error() {} };
  const app = createApp({ config, pool, mailer: mailbox.mailer, google, log: silent });
  return { app, config, mailbox };
}

/** 模拟浏览器：保存 Cookie，修改状态的请求默认带本站 Origin。 */
export function browser(app, config) {
  const jar = new Map();
  async function request(path, { method = 'GET', form, headers = {} } = {}) {
    // 现有断言使用中文界面；需要其他语言的测试自己传 accept-language 或 lang Cookie。
    const h = new Headers({ 'accept-language': 'zh-CN', ...headers });
    if (jar.size) h.set('cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
    let body;
    if (form) {
      body = new URLSearchParams(form).toString();
      h.set('content-type', 'application/x-www-form-urlencoded');
    }
    if (method !== 'GET' && !h.has('origin')) h.set('origin', config.appOrigin);
    const res = await app.request(new URL(path, config.appOrigin), { method, headers: h, body });
    for (const cookie of res.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const index = pair.indexOf('=');
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1);
      if (!value || /max-age=0/i.test(cookie)) jar.delete(name);
      else jar.set(name, value);
    }
    return res;
  }
  return {
    jar,
    request,
    get: (path) => request(path),
    post: (path, form = {}, headers) => request(path, { method: 'POST', form, headers }),
    text: async (path) => (await request(path)).text(),
  };
}

/** 走完邮箱验证码登录，返回已登录的浏览器。 */
export async function signInWithEmail(app, config, mailbox, email) {
  const b = browser(app, config);
  await b.post('/login/email', { email });
  const res = await b.post('/login/verify', { code: mailbox.last(email) });
  if (res.status !== 303 || res.headers.get('location') !== '/') throw new Error(`登录失败：${res.status}`);
  return b;
}
