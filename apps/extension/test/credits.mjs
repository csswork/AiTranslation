import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const source = (file) => fs.readFileSync(new URL(file, root), 'utf8');
let locale = 'en';
const i18n = { ready: Promise.resolve(), locale: () => locale, onChange() {},
  t: (key, values = []) => key.replace(/\$(\d+)/g, (_, n) => values[n - 1]),
};
const context = vm.createContext({ Intl, AITrI18n: i18n });
vm.runInContext(source('src/lib/credits.js'), context);
const credits = context.AITrCredits;
assert.equal(credits.format('20'), '20.00');
assert.equal(credits.format('0.00'), '0.00');
assert.equal(credits.format(1.2), '1.20', '旧数字缓存也保留两位小数');
locale = 'de';
assert.equal(credits.format('1.20'), '1,20');
for (const language of JSON.parse(source('i18n/locales.json'))) {
  locale = language.id;
  const fraction = credits.format('1.20').match(/\p{Decimal_Number}{2}$/u);
  assert.ok(fraction, `${locale} 的点数保留两位本地化数字`);
}
assert.equal(credits.available({ balance: '0.00', available: true }), true);
assert.equal(credits.available({ balance: '1.00', available: false }), false, '以服务端额度状态为准');
assert.equal(credits.available({ balance: 20 }), true, '兼容旧缓存');
assert.equal(credits.available(undefined), false);

// 执行真实 popup 渲染，账户卡片跟随 storage 更新，托管模式不重复显示余额行。
locale = 'en';
const nodes = new Map();
const allNodes = new Set();
const node = () => {
  const attributes = new Map();
  const events = {};
  const n = { className: '', hidden: false, textContent: '', disabled: false, events,
    replaceChildren(...children) { this.children = children; }, addEventListener(type, handler) { events[type] = handler; },
    setAttribute: (name, value) => attributes.set(name, value), removeAttribute: (name) => attributes.delete(name),
    getAttribute: (name) => attributes.get(name) ?? null,
    toggleAttribute: (name, value) => value ? attributes.set(name, '') : attributes.delete(name),
    classList: { toggle() {} },
  };
  allNodes.add(n);
  return n;
};
const element = (id) => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
let changed;
Object.assign(context, {
  document: { getElementById: element, createElement: node,
    querySelectorAll: () => [...allNodes].filter((n) => n.getAttribute('data-login') !== null),
  },
  AITrSettings: {
    normalize: () => ({ provider: 'hosted' }), loadSettings: async () => ({ provider: 'hosted' }),
    providerList: () => [{ id: 'hosted', label: 'Hosted' }], resolveProvider: () => ({}),
    isHosted: () => true, targetMenu: () => 'English',
  },
  chrome: { storage: {
    local: { get: async () => ({ accountStatus: { signedIn: true, username: 'member', credits: { balance: '0.00', available: true } } }) },
    onChanged: { addListener: (fn) => { changed = fn; } },
  }, runtime: { sendMessage: async () => ({}) } },
});
vm.runInContext(source('src/lib/auth-ui.js'), context);
vm.runInContext(source('src/popup/popup.js'), context);
await new Promise(setImmediate);
assert.equal(element('keyState').hidden, true, '托管模式不显示 API Key 状态');
assert.match(element('amount').textContent, /0\.00/);
assert.doesNotMatch(element('balance').className, /empty/, '显示为 0.00 但服务端仍有额度时不算用完');
const update = (account) => changed({ accountStatus: { newValue: account } }, 'local');
update({ signedIn: true, username: 'member', credits: { balance: '0.00', available: false } });
assert.match(element('balance').className, /empty/);
assert.equal(element('cta').hidden, false, '点数用完时给出订阅按钮');
assert.doesNotMatch(element('cta').className, /soft/, '用完时订阅是主要按钮');
update({ signedIn: true, username: 'member', credits: { balance: '180.00', available: true } });
assert.match(element('cta').className, /soft/, '余额充足时订阅只是温和提示');
update({ guest: true, credits: { balance: '0.01', available: true }, offers: { signupCredits: '200.00' } });
assert.match(element('cta').textContent, /200\.00/, '访客的主要按钮是注册再送点数');
assert.match(element('amount').textContent, /0\.01/);
update({ signedIn: true, username: 'member', subscription: { unlimited: true } });
assert.equal(element('amount').textContent, '无限使用');
assert.equal(element('cta').hidden, true, '订阅用户没有主要按钮');
assert.equal(element('keyState').hidden, true);
update({ signedIn: false });
assert.equal(element('balance').hidden, true, '未登录不显示余额');
assert.match(element('cta').textContent, /登录/);

// 登录请求未返回时，所有入口与动态重新渲染的按钮都保持等待状态；失败可重试。
let resolveLogin;
let loginCalls = 0;
let closed = 0;
context.window = { close: () => { closed += 1; } };
context.chrome.runtime.sendMessage = () => { loginCalls += 1; return new Promise((resolve) => { resolveLogin = resolve; }); };
element('cta').events.click();
element('cta').events.click();
assert.equal(loginCalls, 1);
assert.equal(element('cta').getAttribute('aria-busy'), 'true');
assert.equal(element('cta').disabled, true);
update({ guest: true, credits: { balance: '1.00', available: true } });
const alternate = element('links').children[0];
assert.equal(alternate.disabled, true, '渲染期间新建的登录按钮也禁用');
assert.equal(alternate.getAttribute('aria-busy'), 'true');
alternate.events.click();
assert.equal(loginCalls, 1);
resolveLogin({ ok: false, error: 'Network unavailable' });
await new Promise(setImmediate);
assert.equal(element('cta').disabled, false);
assert.equal(element('cta').getAttribute('aria-busy'), null);
assert.equal(element('accountError').textContent, 'Network unavailable');
assert.equal(element('accountError').hidden, false);
assert.equal(closed, 0, '失败时保留弹窗和错误提示');
alternate.events.click();
resolveLogin({ ok: true });
await new Promise(setImmediate);
assert.equal(loginCalls, 2);
assert.equal(closed, 1);
console.log('✓ 24 种语言点数与账户卡片，登录等待、防重复提交、失败恢复和动态入口');
