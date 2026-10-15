import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const source = (file) => fs.readFileSync(new URL(file, root), 'utf8');
const ID = 'abcdefghijklmnopabcdefghijklmnop';
const extensionOrigin = `chrome-extension://${ID}`;
const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
const signedIn = { signedIn: true, kind: 'member', username: 'member', credits: { balance: 20 } };

function boot(production = false) {
  const store = { accountSession: { token: 'original-token' }, accountStatus: { ...signedIn }, guestClaimed: true };
  const changes = event();
  const area = (data) => ({
    get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((k) => [k, data[k]])),
    set: async (patch) => {
      const delta = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, { oldValue: data[k], newValue: v }]));
      Object.assign(data, patch);
      if (data === store) for (const fn of changes.listeners) fn(delta, 'local');
    },
    remove: async (key) => { delete data[key]; },
  });
  const runtime = {
    id: ID, getManifest: () => production ? { update_url: 'https://clients2.google.com/service/update2/crx' } : {},
    getURL: (path) => `${extensionOrigin}/${path}`,
    onInstalled: event(), onStartup: event(), onMessage: event(), onConnect: event(),
  };
  const calls = [];
  const context = vm.createContext({ console: { info() {}, warn() {} }, URL, Date, setTimeout,
    AITrI18n: { ready: Promise.resolve(), t: (s) => s, onChange() {} },
    AITrSettings: { migrateSettings: async () => {}, loadSettings: async () => ({}), targetMenu: () => 'English', supportsVision: () => false },
    chrome: { runtime, storage: { local: area(store), session: area({}), onChanged: changes },
      contextMenus: { removeAll: async () => {}, create: (_props, cb) => cb(), onClicked: event() },
      tabs: { onRemoved: event() }, commands: { onCommand: event() },
    },
    fetch: async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ ...signedIn }) }; },
  });
  vm.runInContext(source('src/lib/env.js'), context);
  vm.runInContext(source('src/lib/account.js'), context);
  vm.runInContext(source('src/background.js').replace(/^import .*$/gm, ''), context);
  const accountOrigin = production ? 'https://app.huaci.app' : 'http://localhost:8787';
  const sender = { id: ID, frameId: 0, tab: { id: 1 }, url: `${accountOrigin}/login` };
  const message = (overrides = {}, payload = {}) => new Promise((resolve) => {
    const wait = runtime.onMessage.listeners[0]({ type: 'account-web-changed', ...payload }, { ...sender, ...overrides }, resolve);
    if (!wait) resolve(null);
  });
  return { context, store, calls, message, sender, accountOrigin };
}

for (const production of [false, true]) {
  const { context, store, calls, message, accountOrigin } = boot(production);
  const rejected = [
    production ? 'http://localhost:8787/login' : 'https://app.huaci.app/login',
    'http://localhost:8788/login', 'http://localhost:9999/', 'http://127.0.0.1:8787/',
    'https://app.huaci.app.evil.example/', 'https://app.huaci.app:444/',
    'http://admin.localhost:8787/', 'https://admin.huaci.app/', 'https://huaci.app/',
  ];
  for (const url of rejected) assert.equal(await message({ url }), null, url);
  for (const overrides of [{ frameId: 1 }, { id: 'other-extension' }, { tab: null }, { url: 'invalid' }]) {
    assert.equal(await message(overrides), null);
  }
  assert.equal(calls.length, 0, '错误环境、端口、框架和来源不会触发请求');
  await message({}, { url: 'https://evil.example/', signedIn: false });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${accountOrigin}/api/extension/me`, '页面只能提示刷新，不能指定请求地址');
  assert.equal(store.accountStatus.signedIn, true, '页面不能直接设置登录状态');

  context.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  const reply = await message();
  assert.equal(reply.ok, false);
  assert.equal(store.accountSession, undefined);
  assert.equal(store.accountStatus.signedIn, false);
  assert.equal(store.guestClaimed, true, '登出后不重复领取访客试用');
  console.log(`✓ ${production ? '生产' : '本地'}来源隔离与网页登出状态同步`);
}

// 扩展内容脚本只报告事件，不读取 Cookie 或传播会话、用户名、余额。
for (const production of [false, true]) {
  const { context, accountOrigin } = boot(production);
  const windowEvents = {}, documentEvents = {}, sent = [];
  const window = { addEventListener: (name, fn) => { windowEvents[name] = fn; } };
  window.top = window;
  Object.assign(context, { window, location: { href: `${accountOrigin}/login` },
    document: { hidden: false, addEventListener: (name, fn) => { documentEvents[name] = fn; } },
  });
  context.chrome.runtime.sendMessage = async (msg) => { sent.push(msg); };
  vm.runInContext(source('src/content/account.js'), context);
  windowEvents.pageshow({ persisted: true });
  documentEvents.visibilitychange();
  context.document.hidden = true;
  documentEvents.visibilitychange();
  assert.equal(sent.length, 3);
  assert.ok(sent.every((msg) => JSON.stringify(msg) === '{"type":"account-web-changed"}'));
  context.location.href = production ? 'http://localhost:8787/' : 'https://app.huaci.app/';
  vm.runInContext(source('src/content/account.js'), context);
  context.location.href = accountOrigin;
  window.top = {};
  vm.runInContext(source('src/content/account.js'), context);
  assert.equal(sent.length, 3, '另一环境和内嵌框架不发送同步事件');
}

{
  const { context, store } = boot();
  context.fetch = async () => { throw new TypeError('offline'); };
  await assert.rejects(context.AITrAccount.refresh(), (err) => err.code === 'network');
  assert.equal(store.accountStatus.signedIn, true, '网络失败不当作登出');
  assert.ok(store.accountSession);
}

const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
{
  const { context, store } = boot();
  const first = deferred(), second = deferred();
  let count = 0;
  context.fetch = () => (++count === 1 ? first.promise : second.promise);
  const stale = context.AITrAccount.refresh();
  const logout = assert.rejects(context.AITrAccount.refresh(), (err) => err.code === 'unauthorized');
  await new Promise((r) => setImmediate(r));
  second.resolve({ status: 401 });
  await logout;
  first.resolve({ ok: true, status: 200, json: async () => ({ ...signedIn }) });
  await stale;
  assert.equal(store.accountStatus.signedIn, false, '晚到的刷新结果不能恢复已退出状态');
  assert.equal(store.accountSession, undefined);
}
{
  const { context, store } = boot();
  const request = deferred();
  context.fetch = () => request.promise;
  const old = assert.rejects(context.AITrAccount.refresh(), (err) => err.code === 'unauthorized');
  await new Promise((r) => setImmediate(r));
  store.accountSession = { token: 'new-login' };
  store.accountStatus = { ...signedIn, username: 'new_member' };
  request.resolve({ status: 401 });
  await old;
  assert.equal(store.accountSession.token, 'new-login', '旧令牌的 401 不会退出新登录');
  assert.equal(store.accountStatus.username, 'new_member');
}
{
  const { context, store } = boot();
  const request = deferred();
  context.fetch = () => request.promise;
  const translation = context.AITrAccount.translate({ texts: ['Hello'], target: 'fr' });
  await new Promise((r) => setImmediate(r));
  store.accountSession = { token: 'new-login' };
  store.accountStatus = { ...signedIn, username: 'new_member', credits: { balance: 100 } };
  request.resolve({ ok: true, status: 200, json: async () => ({ translations: ['Bonjour'], credits: { balance: 19 } }) });
  await translation;
  assert.equal(store.accountStatus.username, 'new_member');
  assert.equal(store.accountStatus.credits.balance, 100, '旧登录的翻译响应不能覆盖新账户余额');
}
console.log('✓ 账户同步：来源、环境、服务端撤销、离线与并发刷新检查通过');
