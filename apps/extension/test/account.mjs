import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const source = (file) => fs.readFileSync(new URL(file, root), 'utf8');
const ID = 'abcdefghijklmnopabcdefghijklmnop';
const extensionOrigin = `chrome-extension://${ID}`;
const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); },
  removeListener(fn) { this.listeners = this.listeners.filter((listener) => listener !== fn); },
});
const signedIn = { signedIn: true, kind: 'member', username: 'member', credits: { balance: 20 } };
// 按 URL 选择接收提示的标签页需要这几个明确的站点权限，不能依赖活动标签页权限或可选权限。
const manifest = JSON.parse(source('manifest.json'));
for (const origin of ['http://localhost', 'https://app.huaci.app', 'https://huaci.app']) {
  assert.ok(manifest.host_permissions.includes(`${origin}/*`), `缺少账户同步站点权限：${origin}`);
  assert.ok(manifest.content_scripts.some((entry) => entry.js.includes('src/content/account.js') && entry.matches.includes(`${origin}/*`)));
}

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
  const tabs = [], notifications = [];
  const context = vm.createContext({ console: { info() {}, warn() {} }, URL, Date, setTimeout,
    AITrI18n: { ready: Promise.resolve(), t: (s) => s, onChange() {} },
    AITrSettings: { migrateSettings: async () => {}, loadSettings: async () => ({}), targetMenu: () => 'English', supportsVision: () => false },
    chrome: { runtime, storage: { local: area(store), session: area({}), onChanged: changes },
      contextMenus: { removeAll: async () => {}, create: (_props, cb) => cb(), onClicked: event() },
      tabs: { onRemoved: event(), query: async () => tabs,
        sendMessage: async (id, message, options) => { notifications.push({ id, message, options }); },
      }, commands: { onCommand: event() },
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
  return { context, store, calls, message, sender, accountOrigin, tabs, notifications };
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
  const windowEvents = {}, documentEvents = {}, sent = [], received = [];
  const window = { addEventListener: (name, fn) => { windowEvents[name] = fn; }, dispatchEvent: (event) => { received.push(event); } };
  window.top = window;
  Object.assign(context, { window, CustomEvent: class { constructor(type) { this.type = type; } }, location: { href: `${accountOrigin}/login` },
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
  const onMessage = context.chrome.runtime.onMessage.listeners.at(-1);
  onMessage({ type: 'account-session-changed', signedIn: false }, { id: 'another-extension' });
  assert.equal(received.length, 0);
  onMessage({ type: 'account-session-changed', signedIn: false, token: 'untrusted' }, { id: ID });
  assert.equal(received.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(received[0])), { type: 'aitr:account-changed' }, '给网页的事件不包含账号数据');
  context.location.href = context.AITrEnv.websiteOrigin;
  vm.runInContext(source('src/content/account.js'), context);
  context.chrome.runtime.onMessage.listeners.at(-1)({ type: 'account-session-changed' }, { id: ID });
  assert.equal(received.length, 2, '官网也能收到重新核对提示');
  assert.equal(sent.length, 3, '官网不能通知后台核对扩展');
  const listeners = context.chrome.runtime.onMessage.listeners.length;
  context.location.href = production ? 'http://localhost:8787/' : 'https://app.huaci.app/';
  vm.runInContext(source('src/content/account.js'), context);
  context.location.href = accountOrigin;
  window.top = {};
  vm.runInContext(source('src/content/account.js'), context);
  assert.equal(sent.length, 3, '另一环境和内嵌框架不发送同步事件');
  assert.equal(context.chrome.runtime.onMessage.listeners.length, listeners, '另一环境和框架也不接收通知');
}

// 扩展重新加载后，旧标签页的 Chrome API 既可能同步抛错，也可能异步拒绝。
function contentBoot() {
  const windowEvents = new Map(), documentEvents = new Map(), sent = [], received = [];
  const surface = (events) => ({
    addEventListener: (name, fn) => { events.set(name, fn); },
    removeEventListener: (name, fn) => { if (events.get(name) === fn) events.delete(name); },
  });
  const window = { ...surface(windowEvents), dispatchEvent: (event) => { received.push(event); } };
  window.top = window;
  const runtime = { id: ID, getManifest: () => ({}), onMessage: event(),
    sendMessage: (message) => { sent.push(message); return Promise.resolve({ ok: true }); },
  };
  const context = vm.createContext({ URL, window, chrome: { runtime },
    location: { href: 'http://localhost:8787/' },
    document: { ...surface(documentEvents), hidden: false },
    CustomEvent: class { constructor(type) { this.type = type; } },
  });
  vm.runInContext(source('src/lib/env.js'), context);
  const start = () => vm.runInContext(source('src/content/account.js'), context);
  return { context, runtime, windowEvents, documentEvents, sent, received, start };
}

for (const mode of ['missing-id', 'throwing-id', 'missing-env', 'failed-env-load', 'invalidated-during-env-check']) {
  const page = contentBoot();
  if (mode === 'missing-id') page.runtime.id = undefined;
  if (mode === 'throwing-id') Object.defineProperty(page.runtime, 'id', { get() { throw new Error('Extension context invalidated.'); } });
  if (mode === 'missing-env') page.context.AITrEnv = undefined;
  if (mode === 'failed-env-load') {
    page.context.AITrEnv = undefined;
    page.runtime.getManifest = () => { throw new Error('Extension context invalidated.'); };
    assert.doesNotThrow(() => vm.runInContext(source('src/lib/env.js'), page.context));
  }
  if (mode === 'invalidated-during-env-check') page.context.AITrEnv = {
    isAccountPage() { throw new Error('Extension context invalidated.'); }, isWebsitePage() { return false; },
  };
  assert.doesNotThrow(page.start, mode);
  assert.equal(page.sent.length, 0, mode);
  assert.equal(page.windowEvents.size, 0);
  assert.equal(page.documentEvents.size, 0);
  assert.equal(page.runtime.onMessage.listeners.length, 0);
}

for (const mode of ['sync-throw', 'promise-rejection', 'lost-runtime-id', 'incoming-message']) {
  const page = contentBoot();
  page.start();
  assert.equal(page.sent.length, 1);
  if (mode === 'sync-throw') page.runtime.sendMessage = () => { throw new Error('Extension context invalidated.'); };
  if (mode === 'promise-rejection') page.runtime.sendMessage = () => Promise.reject(new Error('Extension context invalidated.'));
  if (mode === 'lost-runtime-id' || mode === 'incoming-message') page.runtime.id = undefined;
  if (mode === 'incoming-message') {
    assert.doesNotThrow(() => page.runtime.onMessage.listeners[0]({ type: 'account-session-changed' }, { id: ID }));
    assert.equal(page.received.length, 0);
  } else assert.doesNotThrow(() => page.documentEvents.get('visibilitychange')());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(page.windowEvents.size, 0, `${mode} 清理 pageshow`);
  assert.equal(page.documentEvents.size, 0, `${mode} 清理 visibilitychange`);
  assert.equal(page.runtime.onMessage.listeners.length, 0, `${mode} 清理消息监听`);
}

{
  const page = contentBoot();
  page.runtime.sendMessage = () => Promise.reject(new Error('Could not establish connection. Receiving end does not exist.'));
  page.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(page.documentEvents.size, 1, '后台暂不可用时保留监听，下次切回可重试');
  page.runtime.sendMessage = (message) => { page.sent.push(message); return Promise.resolve(); };
  page.documentEvents.get('visibilitychange')();
  assert.equal(page.sent.length, 1);
}
console.log('✓ 内容脚本上下文失效：初始化、同步异常、异步拒绝与监听清理通过');

for (const production of [false, true]) {
  const { context, store, calls, message, tabs, notifications, accountOrigin } = boot(production);
  tabs.push(...[
    `${accountOrigin}/usage`, `${context.AITrEnv.websiteOrigin}/en/`,
    production ? 'http://localhost:8787/' : 'https://app.huaci.app/',
    production ? 'http://localhost:8788/' : 'https://huaci.app/',
    'http://localhost:9999/', 'http://admin.localhost:8787/', 'https://admin.huaci.app/',
    'https://app.huaci.app.evil.example/', 'https://app.huaci.app:444/', 'https://huaci.app:444/',
    'https://example.com/?next=https://app.huaci.app/', undefined,
  ].map((url, i) => ({ id: i + 1, url })));
  assert.equal(await message({}, { type: 'account-logout' }), null, '网页不能发起扩展主动退出');
  const reply = await message({ url: `${extensionOrigin}/src/popup/popup.html` }, { type: 'account-logout' });
  assert.equal(reply.ok, true);
  assert.equal(store.accountStatus.signedIn, false);
  assert.equal(store.accountSession, undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${accountOrigin}/api/extension/logout`);
  assert.equal(calls[0].init.headers.authorization, 'Bearer original-token');
  assert.equal(calls[0].init.credentials, 'omit');
  assert.deepEqual(notifications.map(({ id }) => id), [1, 2], '只通知同环境用户端与官网，不影响管理端或其他端口');
  assert.ok(notifications.every(({ message, options }) => JSON.stringify(message) === '{"type":"account-session-changed"}' && options.frameId === 0));
  console.log(`✓ ${production ? '生产' : '本地'}扩展主动退出与网页提示来源隔离`);
}

{
  const { context, store } = boot();
  context.fetch = async () => { throw new TypeError('offline'); };
  context.chrome.tabs.query = async () => { throw new Error('tabs unavailable'); };
  await context.AITrAccount.logout();
  assert.equal(store.accountStatus.signedIn, false, '网络失败仍可退出扩展本机登录');
  assert.equal(store.accountSession, undefined);
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
for (const production of [false, true]) {
  const { context, store, accountOrigin, message } = boot(production);
  let request;
  context.fetch = async (url, init) => {
    request = { url, init };
    return { ok: true, status: 200, json: async () => ({ raw: '[]', credits: { balance: '0.00', available: true } }) };
  };
  assert.equal(await context.AITrAccount.readImageText({ image: 'synthetic-image' }), '[]');
  assert.equal(request.url, `${accountOrigin}/api/extension/read-image`);
  assert.deepEqual(JSON.parse(request.init.body), { image: 'synthetic-image' });
  assert.equal(request.init.headers.authorization, 'Bearer original-token');
  assert.equal(store.accountStatus.credits.available, true);
  request = null;
  await message({}, { type: 'hosted-read-image', image: 'from-website' });
  assert.equal(request, null, '网页不能使用扩展页面专用的托管识图消息');
  context.fetch = async () => ({ status: 413, json: async () => ({ error: 'too_large' }) });
  await assert.rejects(context.AITrAccount.readImageText({ image: 'large' }), err => err.code === 'too_large');
}
console.log('✓ 账户同步与托管识图：来源、本地/生产环境、会话及余额检查通过');
