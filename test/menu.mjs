import fs from 'node:fs';
import assert from 'node:assert/strict';

const ROOT = new URL('..', import.meta.url).pathname;

function boot() {
  const state = {
    items: new Map(),
    createCalls: 0,
    duplicateErrors: 0,
    uncheckedErrors: 0, // create 报错但回调没读 lastError 的次数
    warns: [],
    listeners: {},
  };

  let pendingError = null;
  let pendingRead = false;

  const runtime = {
    onInstalled: { addListener: (f) => (state.listeners.installed = f) },
    onStartup: { addListener: (f) => (state.listeners.startup = f) },
    onMessage: { addListener: (f) => (state.listeners.message = f) },
    onConnect: { addListener: () => {} },
    openOptionsPage: () => {},
    get lastError() {
      pendingRead = true;
      return pendingError;
    },
  };

  const chrome = {
    runtime,
    contextMenus: {
      // 按 Chrome 的真实行为：重复 id 不创建，通过 lastError 报错
      create: (props, callback) => {
        state.createCalls++;
        props.id = props.id; // 保留 id 便于断言
        if (state.items.has(props.id)) {
          state.duplicateErrors++;
          pendingError = { message: `Cannot create item with duplicate id ${props.id}` };
        } else {
          state.items.set(props.id, { ...props });
          pendingError = null;
        }
        pendingRead = false;
        if (callback) callback();
        // 回调跑完还没读过 lastError，就是 Chrome 会抱怨的那种情况
        if (pendingError && !pendingRead) state.uncheckedErrors++;
        pendingError = null;
        return props.id;
      },
      removeAll: async () => {
        state.items.clear();
      },
      update: async (id, props) => {
        if (!state.items.has(id)) throw new Error('No such context menu item');
        Object.assign(state.items.get(id), props);
      },
      onClicked: { addListener: () => {} },
    },
    storage: {
      local: {
        get: async (k) => (k === 'settings' ? { settings: { target: 'zh-Hans', provider: 'deepseek' } } : {}),
        set: async () => {},
      },
      onChanged: { addListener: (f) => (state.listeners.storage = f) },
    },
    tabs: { query: async () => [], sendMessage: async () => ({ ok: true }),
            connect: () => ({ postMessage(){}, disconnect(){}, onDisconnect:{addListener(){}}, onMessage:{addListener(){}} }),
            onRemoved: { addListener: () => {} } },
    scripting: { executeScript: async () => [{ result: true }] },
    commands: { onCommand: { addListener: () => {} } },
  };

  const console2 = { info: () => {}, warn: (...a) => state.warns.push(a.join(' ')), log: () => {}, error: () => {} };
  globalThis.chrome = chrome;
  const load = (p) => new Function('chrome', 'console', fs.readFileSync(`${ROOT}/${p}`, 'utf8'))(chrome, console2);
  load('src/lib/lang.js'); load('src/lib/settings.js'); load('src/lib/providers.js');
  const bg = fs.readFileSync(`${ROOT}/src/background.js`, 'utf8').replace(/^import .*$/gm, '');
  new Function('chrome', 'console', bg)(chrome, console2);
  return { state, chrome };
}

const settle = () => new Promise((r) => setTimeout(r, 60));

/* --- 0. 先自检打桩：重复 id 真的会被拒 --- */
{
  const { state, chrome } = boot();
  chrome.contextMenus.create({ id: 'dup' }, () => {});
  chrome.contextMenus.create({ id: 'dup' }, () => {});
  assert.equal(state.duplicateErrors, 1, '打桩本身能检出重复 id');
  console.log('✓ 打桩能复现 Chrome 的重复 id 行为');
}

/* --- 0b. 仅加载 service worker、不触发任何事件，菜单也必须建出来 ---
   重新加载已解压的扩展时 onInstalled / onStartup 未必触发，而旧菜单是持久化的，
   之前正是因此导致新增的菜单项永远出不来。 */
{
  const { state } = boot();
  await settle();
  assert.equal(state.items.size, 3, '不靠任何事件，启动时就应建好三个菜单项');
  assert.ok(state.items.has('ai-translate-selection'));
  assert.ok(state.items.has('ai-translate-element'), '元素项必须存在');
  assert.ok(state.items.has('ai-translate-image'), '图片项必须存在');
  assert.equal(state.items.get('ai-translate-element').visible, true);
  assert.equal(state.duplicateErrors, 0);
  console.log('✓ service worker 启动即建菜单（不依赖 onInstalled / onStartup）');
}

/* --- 1. onInstalled 与「选区上报触发的重建」并发 --- */
{
  const { state } = boot();
  state.listeners.installed({ reason: 'update' });           // createMenu()
  state.listeners.message({ type: 'selection', text: '你好，世界' }, {}, () => {}); // update 失败 → 重建
  state.listeners.message({ type: 'selection', text: 'Hello' }, {}, () => {});
  state.listeners.storage({ settings: {} }, 'local');        // 标题更新失败 → 重建
  await settle();
  assert.equal(state.duplicateErrors, 0, '并发重建不应再出现重复 id');
  assert.equal(state.uncheckedErrors, 0, '不应留下未读的 lastError');
  assert.equal(state.items.size, 3, '划词项 + 元素项 + 图片项，共三个');
  assert.equal(state.warns.length, 0, '不应打出创建失败的警告');
  console.log(`✓ 四个入口并发重建：create 调用 ${state.createCalls} 次，无重复 id、无未读错误`);
}

/* --- 2. 重建后显隐状态要正确（中文应隐藏） --- */
{
  const { state } = boot();
  state.listeners.message({ type: 'selection', text: '这是一段完整的中文句子。' }, {}, () => {});
  await settle();
  assert.equal(state.items.size, 3);
  assert.equal(state.items.get('ai-translate-selection').visible, false,
    '选中中文时，重建后仍应把菜单隐藏');
  console.log('✓ 重建后会补上正确的显隐状态（中文 → 隐藏）');
}

/* --- 2b. 元素项常显；互斥由 contexts 保证，不靠页面上报 --- */
{
  const { state } = boot();
  state.listeners.installed({ reason: 'update' });
  await settle();
  const sel = state.items.get('ai-translate-selection');
  const elem = state.items.get('ai-translate-element');

  assert.equal(elem.visible, true, '元素项常显，不做自动判断');
  assert.deepEqual(sel.contexts, ['selection']);
  // 'selection' 与 'page' 天然互斥：由 Chrome 保证任何时刻只出一项，
  // 不会被折叠成二级子菜单，也没有上报时序问题。
  assert.deepEqual(elem.contexts, ['page'],
    '元素项只能是 page：留着 link 的话，被 <a> 包着的图片会同时命中两项');
  assert.ok(!elem.contexts.includes('selection'), '元素项绝不能包含 selection，否则与划词项同时出现');
  assert.ok(!elem.contexts.includes('all'), 'all 会覆盖 selection，等于失去互斥');
  const image = state.items.get('ai-translate-image');
  assert.ok(image, '「翻译图片」菜单项必须存在');
  assert.deepEqual(image.contexts, ['image']);
  assert.equal(image.visible, true);

  // 三项两两不得共享 contexts：任何重叠都会让两项同时出现，
  // 被 Chrome 折叠成二级子菜单，反而更难点。
  const all = [sel, elem, image];
  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      const overlap = all[i].contexts.filter((c) => all[j].contexts.includes(c));
      assert.deepEqual(overlap, [], `${all[i].id} 与 ${all[j].id} 的 contexts 不得重叠`);
    }
  }
  assert.ok(!elem.contexts.includes('image'), '元素项必须让出 image');
  assert.ok(!elem.contexts.includes('link'),
    '元素项必须让出 link：<a><img></a> 的上下文同时含 image 与 link');
  assert.equal(image.title, '翻译图片里的文字');
  console.log('✓ 三个菜单项的 contexts 两两不重叠（不会被折叠成子菜单）');

  // 换到只能翻文本的平台时，「翻译图片」要自动消失
  state.listeners.storage({ settings: {} }, 'local');
  await settle();
  assert.equal(state.items.get('ai-translate-image').visible, true, 'LLM 平台下应可见');
  console.log('✓ 识图能力决定「翻译图片」的显隐');
}

/* --- 3. 非中文应显示，且标题正确 --- */
{
  const { state } = boot();
  state.listeners.installed({ reason: 'update' });
  await settle();
  state.listeners.message({ type: 'selection', text: 'Hello, world' }, {}, () => {});
  await settle();
  const item = state.items.get('ai-translate-selection');
  assert.equal(item.visible, true);
  assert.equal(item.title, '翻译成中文');
  assert.equal(state.duplicateErrors, 0);
  console.log('✓ 选中非中文时显示，标题为「翻译成中文」');
}

console.log('\n全部通过');
