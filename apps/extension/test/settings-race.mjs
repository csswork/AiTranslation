// 新安装时启动迁移与「默认用点数翻译」同时读写设置，后写的不能把先设好的平台覆盖回默认值。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const code = (file) => fs.readFileSync(file, 'utf8');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function run(order) {
  let stored;
  // 存取都异步：模拟 chrome.storage 在两次调用之间让出执行权
  const context = vm.createContext({ Intl, console,
    chrome: { i18n: { getUILanguage: () => 'en-US' }, storage: { local: {
      get: async () => { await tick(); return { settings: stored }; },
      set: async (next) => { await tick(); stored = next.settings; },
    } } },
    AITrI18n: { locale: () => 'en', t: (s) => s },
  });
  vm.runInContext(code(new URL('src/lib/languages.js', root)), context);
  vm.runInContext(code(new URL('src/lib/settings.js', root)), context);
  const S = context.AITrSettings;
  const tasks = order.map((name) => (name === 'patch' ? S.patchSettings({ provider: 'hosted' }) : S.migrateSettings()));
  await Promise.all(tasks);
  return stored;
}

for (const order of [['patch', 'migrate'], ['migrate', 'patch']]) {
  const stored = await run(order);
  assert.equal(stored.provider, 'hosted', `${order.join(' → ')} 并发后平台被覆盖成 ${stored.provider}`);
  assert.equal(stored.schemaVersion, 2);
}
console.log('✓ 设置迁移与局部修改并发时不互相覆盖');
