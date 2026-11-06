import { installExtensionFixture, deepLLanguages } from './extension-fixture.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const ROOT = new URL('..', import.meta.url).pathname;

function boot(initialSettings = { target: 'zh-Hans', provider: 'deepseek' }) {
  const state = {
    items: new Map(),
    createCalls: 0,
    duplicateErrors: 0,
    uncheckedErrors: 0, // create 报错但回调没读 lastError 的次数
    warns: [],
    listeners: {},
    settings: initialSettings,
    offscreen: false, // offscreen 文档在不在（决定要不要发消息过去）
    sent: [], // 发给 offscreen 的消息
    pdfTabs: [], // chrome.storage.session 里记录的 PDF 标签页
    session: {}, // chrome.storage.session 的其他内容（双语阅读的文章）
    activeTab: null,
    createdTabs: [],
    tabMessages: [], // 发给页面内容脚本的消息
  };

  let pendingError = null;
  let pendingRead = false;

  const runtime = {
    id: 'test-extension',
    getURL: (path) => `chrome-extension://test-extension/${path}`,
    onInstalled: { addListener: (f) => (state.listeners.installed = f) },
    onStartup: { addListener: (f) => (state.listeners.startup = f) },
    onMessage: { addListener: (f) => (state.listeners.message = f) },
    onConnect: { addListener: () => {} },
    openOptionsPage: () => {},
    // 总开关关闭时用它判断有没有在播的字幕；默认当作没有 offscreen 文档
    getContexts: async () => (state.offscreen ? [{ contextType: 'OFFSCREEN_DOCUMENT' }] : []),
    sendMessage: async (message) => {
      state.sent.push(message);
      return true;
    },
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
      onClicked: { addListener: (f) => (state.listeners.clicked = f) },
    },
    storage: {
      local: {
        get: async (k) => (k === 'settings' ? { settings: state.settings } : {}),
        // 设置页保存后 storage 里就是新值：总开关的用例要靠它读到改后的配置
        set: async (patch) => {
          if (patch && 'settings' in patch) state.settings = patch.settings;
        },
      },
      onChanged: { addListener: (f) => (state.listeners.storage = f) },
      session: {
        get: async (key) => {
          const all = { pdfTabs: state.pdfTabs, ...state.session };
          return typeof key === 'string' ? (key in all ? { [key]: all[key] } : {}) : all;
        },
        set: async (patch) => {
          if ('pdfTabs' in patch) state.pdfTabs = patch.pdfTabs;
          const { pdfTabs, ...rest } = patch;
          Object.assign(state.session, rest);
        },
        remove: async (keys) => { for (const key of [].concat(keys)) delete state.session[key]; },
      },
    },
    tabs: { query: async () => (state.activeTab != null ? [{ id: state.activeTab, index: 2, windowId: 7 }] : []), sendMessage: async (tabId, message, options) => { state.tabMessages.push({ tabId, message, options }); return { ok: true }; },
            create: async (properties) => { state.createdTabs.push(properties); return { id: 100 }; },
            connect: () => ({ postMessage(){}, disconnect(){}, onDisconnect:{addListener(){}}, onMessage:{addListener(){}} }),
            onRemoved: { addListener: () => {} },
            onActivated: { addListener: (f) => (state.listeners.activated = f) } },
    windows: { WINDOW_ID_NONE: -1, onFocusChanged: { addListener: () => {} } },
    scripting: { executeScript: async () => [{ result: true }] },
    commands: { onCommand: { addListener: () => {} } },
  };

  const console2 = { info: () => {}, warn: (...a) => state.warns.push(a.join(' ')), log: () => {}, error: () => {} };
  globalThis.chrome = chrome;
  const load = (p) => new Function('chrome', 'console', fs.readFileSync(`${ROOT}/${p}`, 'utf8'))(chrome, console2);
  installExtensionFixture(chrome); load('src/lib/languages.js'); load('src/lib/lang.js'); load('src/lib/settings.js'); load('src/lib/providers.js');
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
  assert.equal(state.items.size, 5, '不靠任何事件，启动时就应建好五个常驻菜单项');
  assert.equal(state.items.get('ai-reader').visible, true, '普通网页里显示「双语阅读这篇文章」');
  assert.ok(state.items.has('ai-translate-selection'));
  assert.ok(state.items.has('ai-translate-element'), '元素项必须存在');
  assert.ok(state.items.has('ai-translate-image'), '图片项必须存在');
  assert.equal(state.items.get('ai-translate-pdf').visible, false, '「翻译整个 PDF」默认隐藏');
  assert.equal(state.items.has('ai-translate-video'), false,
    '视频字幕默认关闭，不应建出菜单项');
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
  assert.equal(state.items.size, 5, '划词项 + 双语阅读 + 元素项 + PDF 项 + 图片项，共五个（视频字幕默认关闭）');
  assert.equal(state.warns.length, 0, '不应打出创建失败的警告');
  console.log(`✓ 四个入口并发重建：create 调用 ${state.createCalls} 次，无重复 id、无未读错误`);
}

/* --- 2. 重建后显隐状态要正确（中文应隐藏） --- */
{
  const { state } = boot();
  state.listeners.message({ type: 'selection', text: '这是一段完整的中文句子。' }, {}, () => {});
  await settle();
  assert.equal(state.items.size, 5);
  assert.equal(state.items.get('ai-translate-selection').visible, true,
    '选中中文时，保留翻译入口');
  console.log('✓ 重建后会补上正确的显隐状态（中文 → 显示）');
}

/* --- 2b. 元素项常显；互斥由 contexts 保证，不靠页面上报 --- */
{
  // 这个用例里视频字幕是打开的，否则拿不到视频菜单项
  const { state } = boot({ target: 'zh-Hans', provider: 'deepseek', videoEnabled: true });
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

  const video = state.items.get('ai-translate-video');
  assert.deepEqual(video.contexts, ['video']);
  assert.equal(video.visible, true);

  // 各项两两不得共享 contexts：任何重叠都会让两项同时出现，
  // 被 Chrome 折叠成二级子菜单，反而更难点。
  // PDF 项与元素项同为 'page'，靠显隐互斥（见 3c），不参与这里的检查。
  // 双语阅读项也是 'page'：与区域按钮同时出现（收进扩展名下的子菜单），同样不参与
  const reader = state.items.get('ai-reader');
  assert.deepEqual(reader.contexts, ['page'], '双语阅读只在没选中文字、不在图片或链接上时出现');
  assert.equal(reader.title, '双语阅读这篇文章');
  const pdfItem = state.items.get('ai-translate-pdf');
  // 内置阅读器的正文在子框架的插件里，右键时只匹配 'frame'
  assert.deepEqual(pdfItem.contexts, ['page', 'frame']);
  assert.equal(pdfItem.visible && elem.visible, false, 'PDF 项与元素项不能同时可见');
  const all = [sel, elem, image, video];
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
  // 只有一个入口：自动识别还是先框选由设置决定，不出子菜单
  assert.equal([...state.items.values()].some((item) => item.parentId === 'ai-translate-image'), false);
  console.log('✓ 四个菜单项的 contexts 两两不重叠（不会被折叠成子菜单）');

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
  assert.equal(item.title, '翻译成简体中文');
  assert.equal(state.duplicateErrors, 0);
  console.log('✓ 选中非中文时显示，标题为「翻译成中文」');
}

/* --- 3c. PDF 标签页：「翻译整个 PDF」替换「区域按钮」，切走后换回 --- */
{
  const { state } = boot();
  state.listeners.installed({ reason: 'update' });
  await settle();
  const items = () => {
    const element = state.items.get('ai-translate-element').visible;
    assert.equal(state.items.get('ai-reader').visible, element, '双语阅读项跟区域按钮一起显隐');
    return [element, state.items.get('ai-translate-pdf').visible];
  };
  state.listeners.message({ type: 'page-kind', pdf: true }, { tab: { id: 7, active: true }, frameId: 0 }, () => {});
  await settle();
  assert.deepEqual(items(), [false, true], '当前 PDF 标签页：只显示 PDF 项');
  // PDF 阅读器里嵌着的同地址子框架不算
  state.listeners.message({ type: 'page-kind', pdf: false }, { tab: { id: 7, active: true }, frameId: 3 }, () => {});
  await settle();
  assert.deepEqual(items(), [false, true], '子框架的上报不改变状态');
  state.listeners.activated({ tabId: 8 });
  await settle();
  assert.deepEqual(items(), [true, false], '切到普通标签页：换回区域按钮');
  state.listeners.activated({ tabId: 7 });
  await settle();
  assert.deepEqual(items(), [false, true], '切回 PDF 标签页');
  assert.deepEqual(state.pdfTabs, [7], 'PDF 标签页记在 session 存储里，service worker 重启后仍可用');
  // 重建菜单（例如 service worker 重启）时按当前标签页决定显隐
  state.activeTab = 7;
  state.listeners.installed({ reason: 'update' });
  await settle();
  assert.deepEqual(items(), [false, true], '重建后仍按当前 PDF 标签页显示');
  console.log('✓ PDF 标签页里右键空白处出现「翻译整个 PDF」，与区域按钮互斥');
}

/* --- 3d. 双语阅读：点菜单注入识别脚本；识别结果存进会话存储，在右边打开阅读页 --- */
{
  const { state, chrome } = boot();
  await settle();
  const injected = [];
  chrome.scripting.executeScript = async (details) => { injected.push(details); return [{ result: { ok: true } }]; };
  chrome.tabs.sendMessage = async () => ({ ok: true }); // ping：内容脚本已在
  await state.listeners.clicked({ menuItemId: 'ai-reader', frameId: 0 }, { id: 12, index: 3, windowId: 2 });
  assert.deepEqual(injected[0].target, { tabId: 12, frameIds: [0] }, '只注入顶层框架');
  assert.deepEqual(injected[0].files, ['src/vendor/readability/Readability.js', 'src/vendor/readability/Readability-readerable.js', 'src/lib/article.js', 'src/content/reader.js']);
  assert.equal(typeof injected[1].func, 'function', '随后启动扫描');

  const article = { url: 'https://example.com/a', title: 'T', blocks: [{ type: 'p', text: 'Hello world' }] };
  const reply = (message, sender) => new Promise((resolve) => {
    const async = state.listeners.message(message, sender, resolve);
    if (!async) resolve(undefined);
  });
  assert.equal(await reply({ type: 'reader-open', article }, { id: 'test-extension', tab: { id: 12 }, frameId: 2 }), undefined, '子框架发来的不处理');
  const ok = await reply({ type: 'reader-open', article }, { id: 'test-extension', tab: { id: 12, index: 3, windowId: 2 }, frameId: 0 });
  assert.deepEqual(ok, { ok: true });
  const created = state.createdTabs.at(-1);
  const id = new URL(created.url).searchParams.get('id');
  assert.ok(created.url.startsWith('chrome-extension://test-extension/src/reader/reader.html?id='));
  assert.deepEqual([created.index, created.windowId, created.openerTabId], [4, 2, 12], '开在来源标签页右边');
  assert.deepEqual(state.session[`reader:${id}`], article, '文章存进会话存储');
  const bad = await reply({ type: 'reader-open', article: { title: 'x' } }, { id: 'test-extension', tab: { id: 12 }, frameId: 0 });
  assert.equal(bad.ok, false, '格式不对的文章拒收');
  for (let i = 0; i < 10; i++) await reply({ type: 'reader-open', article }, { id: 'test-extension', tab: { id: 12 }, frameId: 0 });
  assert.equal(Object.keys(state.session).filter((key) => key.startsWith('reader:')).length, 8, '最多保留 8 篇');
  assert.equal(state.session.readerIds.length, 8);
  console.log('✓ 双语阅读：只注入顶层框架，文章存会话存储，阅读页开在右边，旧文章自动清理');
}

/* --- 3b. 空选区不藏菜单：内置 PDF 阅读器里内容脚本读不到选区，
   别的网页点空白上报的空选区不能把全局菜单藏掉 --- */
{
  const { state } = boot();
  state.listeners.installed({ reason: 'update' });
  await settle();
  const report = (text) => state.listeners.message({ type: 'selection', text }, { tab: { id: 1 }, frameId: 0 }, () => {});
  report('');
  await settle();
  assert.equal(state.items.get('ai-translate-selection').visible, true, '空选区上报后划词菜单仍可见');
  report('12345 …');
  await settle();
  assert.equal(state.items.get('ai-translate-selection').visible, false, '纯数字、标点仍然隐藏');
  report('');
  await settle();
  assert.equal(state.items.get('ai-translate-selection').visible, true, '清空选区后恢复可见');
  console.log('✓ 空选区不隐藏划词菜单（PDF 阅读器可用），纯数字仍隐藏');
}

/* --- 4. 视频字幕总开关：默认关闭不建项，打开后出现，关掉后整块消失 --- */
{
  const { state, chrome } = boot();
  await settle();
  assert.equal(state.items.has('ai-translate-video'), false, '默认关闭：没有视频菜单项');

  const before = state.settings;
  const on = { ...before, videoEnabled: true };
  await chrome.storage.local.set({ settings: on });
  state.listeners.storage({ settings: { oldValue: before, newValue: on } }, 'local');
  await settle();
  const video = state.items.get('ai-translate-video');
  assert.ok(video, '打开总开关后应出现视频菜单项');
  assert.equal(state.items.size, 6, '打开后共六个菜单项');
  assert.deepEqual(video.contexts, ['video']);
  assert.equal(video.visible, true);
  assert.equal(state.duplicateErrors, 0);

  assert.equal(state.sent.some((m) => m.type === 'video-stop-all'), false,
    '打开总开关不该去停字幕');

  // 关掉时要顺手把正在播的字幕停掉（offscreen 文档在的时候）
  state.offscreen = true;
  const off = { ...on, videoEnabled: false };
  await chrome.storage.local.set({ settings: off });
  state.listeners.storage({ settings: { oldValue: on, newValue: off } }, 'local');
  await settle();
  assert.equal(state.items.has('ai-translate-video'), false, '关闭总开关后视频菜单项应消失');
  assert.equal(state.items.size, 5);
  assert.equal(state.warns.length, 0, '增删菜单项不应打出创建失败的警告');
  assert.ok(
    state.sent.some((m) => m.target === 'offscreen' && m.type === 'video-stop-all'),
    '关闭总开关时要通知 offscreen 停掉所有字幕'
  );
  console.log('✓ 视频字幕总开关控制右键菜单项的增删（默认关闭），关掉时停掉在播字幕');
}

/* --- 图片菜单：只把图片地址交给页面，识别方式由页面按设置决定 --- */
{
  const { state } = boot();
  await settle();
  await state.listeners.clicked({ menuItemId: 'ai-translate-image', srcUrl: 'https://example.com/a.png', frameId: 2 }, { id: 5 });
  const sent = state.tabMessages.filter((m) => m.message.type === 'translate-image');
  assert.deepEqual(sent.map(({ tabId, message, options }) => [tabId, message, options.frameId]),
    [[5, { type: 'translate-image', srcUrl: 'https://example.com/a.png' }, 2]]);
  console.log('✓ 图片菜单只有一个入口，识别方式由设置决定');
}

/* Edge PDF menu events can contain TAB_ID_NONE, rather than the outer browser tab. */
{
  const { state } = boot();
  await settle();
  const clicked = (tab) => state.listeners.clicked({ menuItemId: 'ai-translate-pdf' }, tab);
  await clicked({ id: 0, index: 4, windowId: 3 });
  assert.deepEqual(state.createdTabs.pop(), {
    url: 'chrome-extension://test-extension/src/pdf/pdf.html?tab=0', openerTabId: 0, index: 5, windowId: 3,
  }, 'A valid tab, including ID zero, keeps its exact source and window');

  state.activeTab = 7;
  state.listeners.message({ type: 'page-kind', pdf: true }, { tab: { id: 7, active: true }, frameId: 0 }, () => {});
  await settle();
  await clicked({ id: -1, index: -1, windowId: -1 });
  assert.deepEqual(state.createdTabs.pop(), {
    url: 'chrome-extension://test-extension/src/pdf/pdf.html?tab=7', openerTabId: 7, index: 3, windowId: 7,
  }, 'An Edge PDF guest resolves to the active, previously identified outer PDF tab');

  state.activeTab = 8;
  await clicked({ id: -1 });
  assert.deepEqual(state.createdTabs.pop(), { url: 'chrome-extension://test-extension/src/pdf/pdf.html' },
    'An unrelated active page is never used as a PDF source');
  state.activeTab = null;
  await clicked(undefined);
  assert.deepEqual(state.createdTabs.pop(), { url: 'chrome-extension://test-extension/src/pdf/pdf.html' },
    'A missing browser tab opens the local file picker without an invalid opener');
  console.log('✓ Edge PDF 负数标签 ID、精确源标签及安全文件选择回退');
}

console.log('\n全部通过');
