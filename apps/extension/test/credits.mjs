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
const node = () => ({ className: '', hidden: false, textContent: '', replaceChildren() {}, addEventListener() {},
  classList: { toggle() {} } });
const element = (id) => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
let changed;
Object.assign(context, {
  document: { getElementById: element, createElement: node },
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
vm.runInContext(source('src/popup/popup.js'), context);
await new Promise(setImmediate);
assert.equal(element('keyRow').hidden, true);
assert.match(element('credits').textContent, /0\.00/);
assert.doesNotMatch(element('credits').className, /empty/);
const update = (account) => changed({ accountStatus: { newValue: account } }, 'local');
update({ signedIn: true, username: 'member', credits: { balance: '0.00', available: false } });
assert.equal(element('keyRow').hidden, true);
assert.match(element('credits').className, /empty/);
update({ guest: true, credits: { balance: '0.01', available: true }, offers: { signupCredits: '200.00' } });
assert.match(element('accountMeta').textContent, /200\.00/);
assert.match(element('credits').textContent, /0\.01/);
update({ signedIn: true, username: 'member', subscription: { unlimited: true } });
assert.equal(element('credits').textContent, '无限使用');
assert.equal(element('keyRow').hidden, true);
console.log('✓ 24 种语言两位小数、旧缓存和弹窗精确额度状态更新');
