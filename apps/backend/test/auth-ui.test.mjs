import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const source = (file) => fs.readFileSync(new URL(`../ui/account/assets/${file}`, import.meta.url), 'utf8');
class Element {
  constructor(attributes = {}) { this.attributes = new Map(Object.entries(attributes)); this.listeners = {}; this.children = []; }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  hasAttribute(name) { return this.attributes.has(name); }
  addEventListener(type, handler) { this.listeners[type] = handler; }
  appendChild(node) { node.parent = this; this.children.push(node); }
  remove() { this.parent.children = this.parent.children.filter((node) => node !== this); }
  querySelector() { return this.button || null; }
  fire(type, values = {}) {
    const event = { button: 0, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...values };
    this.listeners[type]?.(event);
    return event;
  }
}
function setup() {
  const button = Object.assign(new Element(), { disabled: false, name: 'decision', value: 'approve' });
  const other = Object.assign(new Element(), { disabled: true });
  const form = Object.assign(new Element(), { button });
  const oneTap = Object.assign(new Element({ 'data-one-tap': '' }), {
    hidden: true, dataset: { clientId: 'client', nonce: 'nonce' }, elements: { credential: { value: '' } },
  });
  const link = new Element();
  const window = new Element();
  const document = {
    documentElement: { dataset: {} },
    createElement: () => new Element(),
    querySelector: (selector) => selector === '[data-one-tap]' ? oneTap : null,
    querySelectorAll: (selector) => selector === '[data-auth-form]' ? [form, oneTap]
      : selector.startsWith('[data-auth-form] button,') ? [button, other, link] : [link],
  };
  const context = vm.createContext({ document, window });
  vm.runInContext(source('account.js'), context);
  return { context, button, other, form, oneTap, link, window };
}

test('登录提交立即显示等待状态并拒绝重复提交，保留授权按钮字段，返回后恢复', () => {
  const { button, other, form, link, window } = setup();
  const event = form.fire('submit', { submitter: button });
  assert.equal(event.defaultPrevented, false, '继续使用原生表单提交');
  assert.equal(button.getAttribute('aria-busy'), 'true');
  assert.equal(button.disabled, true);
  assert.equal(link.getAttribute('aria-disabled'), 'true');
  assert.deepEqual(form.children.map(({ name, value }) => [name, value]), [['decision', 'approve']]);
  assert.equal(form.fire('submit', { submitter: button }).defaultPrevented, true);
  assert.equal(link.fire('click').defaultPrevented, true, '也不能并行启动 Google 登录');
  window.fire('pageshow');
  assert.equal(button.disabled, false);
  assert.equal(button.getAttribute('aria-busy'), null);
  assert.equal(other.disabled, true, '不启用原本不可用的按钮');
  assert.equal(form.children.length, 0);
  assert.equal(form.fire('submit', { submitter: button }).defaultPrevented, false, '允许重试');
});

test('登录链接保留新标签页行为，普通点击显示等待，返回后可以再次点击', () => {
  const { link, window } = setup();
  for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey']) {
    assert.equal(link.fire('click', { [modifier]: true }).defaultPrevented, false);
    assert.equal(link.getAttribute('aria-busy'), null);
  }
  link.fire('click');
  assert.equal(link.getAttribute('aria-busy'), 'true');
  assert.equal(link.fire('click').defaultPrevented, true);
  window.fire('pageshow');
  assert.equal(link.getAttribute('aria-disabled'), null);
});

test('Google One Tap 使用同一提交保护并显示可见进度，不禁用或改写凭证字段', () => {
  const { context, oneTap, window } = setup();
  let callback;
  let sent = 0;
  oneTap.requestSubmit = () => { if (!oneTap.fire('submit').defaultPrevented) sent += 1; };
  window.google = { accounts: { id: { initialize: (options) => { callback = options.callback; }, prompt() {} } } };
  vm.runInContext(source('one-tap.js'), context);
  callback({ credential: 'signed-id-token' });
  assert.equal(oneTap.hidden, false);
  assert.equal(oneTap.getAttribute('aria-busy'), 'true');
  assert.equal(oneTap.elements.credential.value, 'signed-id-token');
  callback({ credential: 'signed-id-token' });
  assert.equal(sent, 1);
  window.fire('pageshow');
  assert.equal(oneTap.hidden, true);
});

function sessionPage(signedIn = true) {
  const windowEvents = {}, documentEvents = {}, requests = [];
  let reloads = 0;
  const context = vm.createContext({
    window: { addEventListener: (name, fn) => { (windowEvents[name] ||= []).push(fn); } },
    document: {
      documentElement: { dataset: {} }, body: { hasAttribute: () => signedIn }, hidden: false,
      querySelector: () => null, querySelectorAll: () => [],
      addEventListener: (name, fn) => { documentEvents[name] = fn; },
    },
    location: { reload: () => { reloads += 1; } },
    fetch: (url, options) => new Promise((resolve, reject) => { requests.push({ url, options, resolve, reject }); }),
  });
  vm.runInContext(source('account.js'), context);
  return { context, requests, reloads: () => reloads,
    fire: (name, event = {}) => windowEvents[name]?.forEach((fn) => fn(event)),
    visibility: () => documentEvents.visibilitychange?.(),
  };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
const sessionResponse = (signedIn) => ({ ok: true, json: async () => ({ signedIn }) });

test('扩展退出提示后网页自己验证会话；仅确认退出后刷新，网络异常不退出', async () => {
  const page = sessionPage();
  page.fire('aitr:account-changed', { detail: { signedIn: false, url: 'https://evil.example/' } });
  assert.equal(page.requests.length, 1);
  assert.equal(page.requests[0].url, '/api/web/session');
  assert.deepEqual(JSON.parse(JSON.stringify(page.requests[0].options)), { credentials: 'same-origin', cache: 'no-store' });
  page.requests[0].resolve(sessionResponse(true));
  await settle();
  assert.equal(page.reloads(), 0, '不能信任事件携带的登录状态');

  page.fire('focus');
  page.requests.at(-1).reject(new Error('offline'));
  await settle();
  assert.equal(page.reloads(), 0);
  page.fire('pageshow', { persisted: true });
  page.requests.at(-1).resolve({ ok: false });
  await settle();
  assert.equal(page.reloads(), 0);
  page.visibility();
  page.requests.at(-1).resolve(sessionResponse(false));
  await settle();
  assert.equal(page.reloads(), 1);
  page.context.document.hidden = true;
  page.visibility();
  assert.equal(page.requests.length, 4, '隐藏标签页不额外查询');
});

test('晚到的会话响应不覆盖新的核对结果；管理端与未登录页不检查用户会话', async () => {
  const page = sessionPage();
  page.fire('focus');
  page.fire('aitr:account-changed');
  page.requests[1].resolve(sessionResponse(true));
  await settle();
  page.requests[0].resolve(sessionResponse(false));
  await settle();
  assert.equal(page.reloads(), 0, '旧的退出响应不影响新登录');
  const admin = sessionPage(false);
  admin.fire('focus');
  admin.fire('aitr:account-changed');
  admin.fire('pageshow', { persisted: true });
  assert.equal(admin.requests.length, 0);
});
