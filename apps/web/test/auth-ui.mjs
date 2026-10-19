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
console.log('官网登录入口：等待反馈、防重复跳转、返回恢复与新标签页行为通过');
