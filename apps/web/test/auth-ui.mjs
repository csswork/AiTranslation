import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const script = fs.readFileSync(new URL('../public/main.js', import.meta.url), 'utf8');
const start = script.indexOf('  const ACCOUNT_ORIGIN =');
const end = script.indexOf('/* ------------------------------------------------------------ 配色切换 */', start);
assert.ok(start > 0 && end > start);
const events = {};
const attributes = new Map();
let signedIn = false;
const link = {
  classList: { contains: () => !signedIn },
  getAttribute: (key) => attributes.get(key) ?? null,
  setAttribute: (key, value) => attributes.set(key, value),
  removeAttribute: (key) => attributes.delete(key),
  addEventListener: (type, handler) => { events[type] = handler; },
};
vm.runInNewContext(script.slice(start, end), {
  location: { hostname: 'huaci.app' },
  document: { querySelector: () => link },
  window: { addEventListener: (type, handler) => { events[type] = handler; } },
});
const click = (options = {}) => {
  const event = { button: 0, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...options };
  events.click(event);
  return event;
};
for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey']) {
  assert.equal(click({ [modifier]: true }).defaultPrevented, false);
  assert.equal(attributes.has('aria-busy'), false);
}
assert.equal(click().defaultPrevented, false);
assert.equal(attributes.get('aria-busy'), 'true');
assert.equal(click().defaultPrevented, true, '重复点击不会重复跳转');
events.pageshow();
assert.equal(attributes.size, 0, '从登录页返回后恢复入口');
signedIn = true;
click();
assert.equal(attributes.size, 0, '账户链接不进入登录等待状态');

// 同一页面在扩展退出后必须恢复本地化的登录文案，而不只修改链接。
const windowEvents = {}, documentEvents = {}, requests = [];
const classes = new Set(['is-login']);
const stateLink = {
  textContent: 'ログイン', hidden: true, attributes: new Map(),
  classList: {
    contains: (name) => classes.has(name),
    replace: (from, to) => { if (classes.delete(from)) classes.add(to); },
  },
  getAttribute(key) { return this.attributes.get(key) ?? null; },
  setAttribute(key, value) { this.attributes.set(key, value); },
  removeAttribute(key) { this.attributes.delete(key); },
  addEventListener() {},
  replaceChildren(...children) { this.textContent = children.map((node) => node.textContent).join(''); },
};
const context = vm.createContext({ URL,
  location: { hostname: 'localhost', href: 'http://localhost:8788/ja/' },
  document: { hidden: false, querySelector: () => stateLink,
    createElement: () => ({ setAttribute() {} }),
    addEventListener: (name, fn) => { documentEvents[name] = fn; },
  },
  window: { fetch: true, addEventListener: (name, fn) => { (windowEvents[name] ||= []).push(fn); } },
  fetch: (url, options) => new Promise((resolve, reject) => { requests.push({ url, options, resolve, reject }); }),
});
vm.runInContext(script.slice(start, end), context);
const fire = (name, event = {}) => windowEvents[name]?.forEach((fn) => fn(event));
const settle = () => new Promise((resolve) => setImmediate(resolve));
const response = (signedIn) => ({ ok: true, json: async () => signedIn
  ? { signedIn: true, username: 'member', accountUrl: 'http://localhost:8787/' }
  : { signedIn: false, loginUrl: 'http://localhost:8787/login' } });
assert.equal(requests[0].url, 'http://localhost:8787/api/web/session');
assert.deepEqual(JSON.parse(JSON.stringify(requests[0].options)), { credentials: 'include', cache: 'no-store' });
requests[0].resolve(response(true));
await settle();
assert.ok(classes.has('is-user'));
assert.equal(stateLink.hidden, false);
fire('focus');
fire('aitr:account-changed', { detail: { signedIn: true, url: 'https://evil.example/' } });
assert.equal(requests.length, 3);
requests[2].resolve(response(false));
await settle();
assert.equal(stateLink.textContent, 'ログイン');
assert.ok(classes.has('is-login'));
assert.equal(new URL(stateLink.href).searchParams.get('return'), context.location.href);
requests[1].resolve(response(true));
await settle();
assert.equal(stateLink.textContent, 'ログイン', '晚到的旧响应不会恢复已退出状态');
fire('pageshow', { persisted: true });
requests.at(-1).reject(new Error('offline'));
await settle();
assert.equal(stateLink.textContent, 'ログイン', '网络异常保留当前显示');
documentEvents.visibilitychange();
requests.at(-1).resolve(response(true));
await settle();
assert.ok(classes.has('is-user'));
context.document.hidden = true;
documentEvents.visibilitychange();
assert.equal(requests.length, 5);
console.log('官网登录入口：等待反馈、双向退出同步、本地化恢复与旧响应隔离通过');
