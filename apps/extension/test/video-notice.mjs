/** 整份视频翻译在后台继续：关掉视频所在的标签页不停，进度提示与完成卡片跟着用户换标签页（lib/video-notice.js + video-file.js）。 */
import { installExtensionFixture } from './extension-fixture.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const ROOT = new URL('..', import.meta.url).pathname;
const event = () => {
  const listeners = [];
  return { listeners, addListener: (f) => listeners.push(f), removeListener: (f) => listeners.splice(listeners.indexOf(f), 1) };
};
/** 打桩的长连接：两端各有一份，postMessage 投递到对端。 */
function portPair(name, sender) {
  const a = { name, sender, onMessage: event(), onDisconnect: event(), sent: [] };
  const b = { name, onMessage: event(), onDisconnect: event(), sent: [] };
  a.postMessage = (m) => { a.sent.push(m); b.onMessage.listeners.forEach((f) => f(m)); };
  b.postMessage = (m) => { b.sent.push(m); a.onMessage.listeners.forEach((f) => f(m)); };
  a.disconnect = () => b.onDisconnect.listeners.forEach((f) => f());
  b.disconnect = () => a.onDisconnect.listeners.forEach((f) => f());
  return [a, b];
}

const state = {
  tabs: new Map([[1, { id: 1, active: true, incognito: false, windowId: 1 }], [2, { id: 2, active: false, incognito: false, windowId: 1 }]]),
  injected: [], offscreen: [], badge: [], created: [], platformCalls: 0,
};
const activeTab = () => [...state.tabs.values()].find((tab) => tab.active);
globalThis.chrome = {
  runtime: {
    id: 'test', getURL: (p) => `chrome-extension://test/${p}`, lastError: undefined,
    sendMessage: async (message) => { state.offscreen.push(message); return true; },
    getPlatformInfo: async () => { state.platformCalls += 1; return {}; },
  },
  storage: { local: { get: async () => ({}), set: async () => {} } },
  tabs: {
    get: async (id) => { if (!state.tabs.has(id)) throw new Error('No tab'); return state.tabs.get(id); },
    query: async () => [activeTab()].filter(Boolean),
    sendMessage: async () => true,
    create: async (props) => { state.created.push(props); return { id: 99 }; },
    detectLanguage: async () => 'en',
  },
  windows: { get: async () => ({ focused: true }) },
  scripting: { executeScript: async (details) => { state.injected.push(details); return [{ result: true }]; } },
  action: {
    setBadgeText: async ({ text }) => { state.badge.push(text); },
    setBadgeBackgroundColor: async () => {}, setBadgeTextColor: async () => {},
  },
};
installExtensionFixture(chrome);
const load = (p) => new Function(fs.readFileSync(`${ROOT}/${p}`, 'utf8'))();
for (const p of ['languages', 'lang', 'settings', 'transcript', 'providers', 'video-notice', 'video-file']) load(`src/lib/${p}.js`);
const { AITrSettings: S, AITrVideoFile: V, AITrVideoNotice: N } = globalThis;
globalThis.AITrVideoLibrary = { find: async () => null, put: async () => {}, removeFile: async () => {} };
const settle = () => new Promise((r) => setTimeout(r, 20));

// 平台用 DeepSeek（本机识别）；翻译请求打桩
S.loadSettings = async () => S.normalize({ provider: 'deepseek', target: 'zh-Hans', cache: false, deepseek: { apiKey: 'sk-test' } });
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ lang: 'en', garbled: false, title_tr: '搞笑片段', cues: [{ from: 0, to: 2, text: 'Hi there you.', tr: '你好。' }] }) } }] }) });
V.init({ ensureOffscreen: async () => {} });

/** 提示脚本连回来（注入到哪个标签页就以哪个标签页的身份连）。 */
function noticeIn(tabId) {
  const [bg, page] = portPair(N.PORT_NAME, { id: 'test', frameId: 0, tab: state.tabs.get(tabId) });
  N.onConnect(bg);
  return { bg, page, last: () => page.sent.length ? null : bg.sent.at(-1) };
}
const shown = (conn) => conn.bg.sent.at(-1)?.items || [];

/* ---- 1. 开始翻：视频所在那一页由浮层显示进度，不重复 ---- */
let jobId = '';
chrome.tabs.sendMessage = async (_tab, message) => { jobId = message.jobId; return true; };
await V.open({ tabId: 1, srcUrl: 'https://cdn.example/a.mp4', title: 'Funny clip' });
assert.ok(jobId, '登记了任务');
const [overlayBg, overlayPage] = portPair(V.PORT_NAME, { id: 'test', frameId: 0, tab: state.tabs.get(1) });
V.onConnect(overlayBg);
overlayPage.postMessage({ type: 'start', jobId });
await settle();
assert.equal(N.items()[0].tone, 'work', '开始翻就有一条进度');
assert.equal(N.items()[0].title, 'Funny clip');
const here = noticeIn(1);
assert.deepEqual(shown(here), [], '浮层开着的那一页不重复显示进度');
assert.equal(state.badge.at(-1), '2%', '扩展图标显示进度');

/* ---- 2. 关掉视频所在的标签页：翻译不停，进度提示出现在用户换到的网页上 ---- */
state.tabs.delete(1);
state.tabs.get(2).active = true;
overlayPage.disconnect();
await settle();
assert.ok(!state.offscreen.some((m) => m.type === 'video-file-stop'), '关掉标签页不停止识别');
N.onTabActivated(2);
await settle();
assert.ok(state.injected.some((d) => d.target.tabId === 2 && d.files?.[0] === 'src/content/video-notice.js'), '提示注入到正在看的网页');
const there = noticeIn(2);
assert.equal(shown(there).length, 1);
V.onOffscreenEvent({ jobId, event: { type: 'progress', phase: 'recognize', lang: 'en-US', done: 45000, total: 100000 } }, { id: 'test', url: 'chrome-extension://test/src/offscreen/offscreen.html' });
const item = shown(there)[0];
assert.match(item.detail, /45 \/ 100 秒/, '进度实时更新');
assert.ok(Math.abs(item.progress - 0.46) < 0.01, '识别占八成进度');
assert.equal(state.badge.at(-1), '46%');

// × 收起进度提示：之后不再显示进度，但翻好照样提醒
there.page.postMessage({ type: 'dismiss', id: jobId });
assert.deepEqual(shown(there), [], '收起进度提示');

/* ---- 3. 翻完：卡片跨标签页提醒，点开打开「视频翻译」页并算看过 ---- */
V.onOffscreenEvent({ jobId, event: { type: 'done', tokens: [{ text: 'hi', start: 0 }, { text: 'there', start: 300 }, { text: 'you', start: 600 }], lang: 'en-US', duration: 5000, size: 1 } },
  { id: 'test', url: 'chrome-extension://test/src/offscreen/offscreen.html' });
await settle();
await settle();
const done = shown(there)[0];
assert.equal(done?.tone, 'done', '翻好后显示完成卡片（之前收起的是进度）');
assert.match(done.detail, /共 1 句/);
assert.equal(done.title, '搞笑片段', '翻好后标题换成译文');
assert.equal(state.badge.at(-1), '✓');
// 换到第三个标签页：卡片跟过去
state.tabs.get(2).active = false;
state.tabs.set(3, { id: 3, active: true, incognito: false, windowId: 1 });
N.onTabActivated(3);
await settle();
assert.ok(state.injected.some((d) => d.target.tabId === 3), '换标签页后卡片跟过去');
const third = noticeIn(3);
assert.equal(shown(third)[0]?.tone, 'done');
// 无痕窗口里看不到普通窗口的任务
state.tabs.set(4, { id: 4, active: false, incognito: true, windowId: 2 });
assert.deepEqual(shown(noticeIn(4)), [], '无痕窗口不显示普通窗口的任务');
third.page.postMessage({ type: 'open', id: jobId });
await settle();
assert.ok(state.created.at(-1).url.endsWith(`videos.html#${jobId}`), '点开就是视频翻译页的那一条');
assert.deepEqual(shown(third), [], '看过就收起');
assert.deepEqual(shown(there), [], '其他标签页里的也一起收起');
assert.equal(state.badge.at(-1), '', '角标清掉');
console.log('✓ 关掉视频所在的标签页翻译不停；进度提示与完成卡片跟着用户换标签页，看过一起收起');

/* ---- 4. 用户正看着浮层时翻完：浮层自己会说，不另弹卡片 ---- */
{
  state.tabs.get(3).active = false;
  state.tabs.set(5, { id: 5, active: true, incognito: false, windowId: 1 });
  let id = '';
  chrome.tabs.sendMessage = async (_tab, message) => { id = message.jobId; return true; };
  await V.open({ tabId: 5, srcUrl: 'https://cdn.example/b.mp4', title: 'B' });
  const [bg, page] = portPair(V.PORT_NAME, { id: 'test', frameId: 0, tab: state.tabs.get(5) });
  V.onConnect(bg);
  page.postMessage({ type: 'start', jobId: id });
  await settle();
  V.onOffscreenEvent({ jobId: id, event: { type: 'done', tokens: [{ text: 'hi', start: 0 }, { text: 'there', start: 300 }, { text: 'you', start: 600 }], lang: 'en-US', duration: 5000 } },
    { id: 'test', url: 'chrome-extension://test/src/offscreen/offscreen.html' });
  await settle();
  await settle();
  assert.deepEqual(N.items(), [], '浮层那一页正看着：不弹卡片');
  assert.ok(bg.sent.some((m) => m.type === 'done'), '字幕交给浮层');
  console.log('✓ 用户正看着浮层时翻完不另弹卡片');
}

/* ---- 5. 取消：提示一起收起 ---- */
{
  let id = '';
  chrome.tabs.sendMessage = async (_tab, message) => { id = message.jobId; return true; };
  await V.open({ tabId: 5, srcUrl: 'https://cdn.example/c.mp4', title: 'C' });
  const [bg, page] = portPair(V.PORT_NAME, { id: 'test', frameId: 0, tab: state.tabs.get(5) });
  V.onConnect(bg);
  page.postMessage({ type: 'start', jobId: id });
  await settle();
  assert.equal(N.items().length, 1);
  page.postMessage({ type: 'cancel' });
  await settle();
  assert.deepEqual(N.items(), [], '取消后提示收起');
  assert.ok(state.offscreen.some((m) => m.type === 'video-file-stop' && m.jobId === id));
  console.log('✓ 取消后提示一起收起');
}
process.exit(0);
