/** TikTok 视频详情页的整份翻译入口（lib/tiktok.js + video-file.js 的 openTikTok）。 */
import { installExtensionFixture } from './extension-fixture.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const ROOT = new URL('..', import.meta.url).pathname;
const PAGE = 'https://www.tiktok.com/@leijun/video/7707162841757027604';
const CDN = 'https://v16-webapp-prime.tiktok.com/video/tos/alisg/abc/?mime_type=video_mp4&expire=1795958827&signature=x&tk=tt_chain_token';

const state = { tab: { id: 7, url: PAGE, title: 'Roasted milk tea | TikTok', incognito: false }, found: null, sent: [], offscreen: [], injectedFuncs: [] };
globalThis.chrome = {
  runtime: { id: 'test', getURL: (p) => `chrome-extension://test/${p}`, sendMessage: async (m) => { state.offscreen.push(m); return true; } },
  storage: { local: { get: async () => ({}), set: async () => {} } },
  tabs: {
    get: async (id) => (id === state.tab.id ? state.tab : Promise.reject(new Error('No tab'))),
    sendMessage: async (_tab, message) => { state.sent.push(message); return true; },
    detectLanguage: async () => 'en',
  },
  scripting: {
    executeScript: async (details) => {
      if (details.func) {
        state.injectedFuncs.push(details);
        if (details.func !== globalThis.AITrTikTok.readPage) return [{ result: true }];
        return [{ result: typeof state.found === 'function' ? await state.found(details) : state.found }];
      }
      return [{ result: true }];
    },
  },
};
installExtensionFixture(chrome);
const load = (p) => new Function(fs.readFileSync(`${ROOT}/${p}`, 'utf8'))();
for (const p of ['languages', 'lang', 'settings', 'transcript', 'providers', 'tiktok', 'video-file']) load(`src/lib/${p}.js`);
const { AITrTikTok: T, AITrVideoFile: V, AITrSettings: S } = globalThis;
globalThis.AITrVideoLibrary = { find: async () => null, put: async () => {}, removeFile: async () => {} };
S.loadSettings = async () => S.normalize({ provider: 'deepseek', deepseek: { apiKey: 'sk-test' } });

/* ---- 1. 只认视频详情页与 TikTok 自己的视频服务器 ---- */
{
  assert.equal(T.videoId(PAGE), '7707162841757027604');
  assert.equal(T.videoId(`${PAGE}?is_from_webapp=1`), '7707162841757027604', '带参数也认');
  assert.equal(T.videoId('https://www.tiktok.com/foryou'), '', '推荐流不支持');
  assert.equal(T.videoId('https://www.tiktok.com/@leijun'), '');
  assert.equal(T.videoId('http://www.tiktok.com/@a/video/7707162841757027604'), '', '只认 https');
  assert.equal(T.videoId('https://tiktok.com.evil.example/@a/video/7707162841757027604'), '', '不认冒名的域名');
  assert.equal(T.canonicalUrl(`${PAGE}/?is_from_webapp=1#x`), PAGE, '固定地址去掉参数');
  assert.equal(T.isMediaUrl(CDN), true);
  assert.equal(T.isMediaUrl('https://v19.tiktokcdn-us.com/video/x.mp4'), true);
  for (const bad of [PAGE, 'http://v16-webapp-prime.tiktok.com/video/x', 'https://example.com/v.mp4', 'https://evil-tiktok.com/v.mp4',
    'https://user:pw@v16.tiktok.com/v', 'blob:https://www.tiktok.com/abc', 'javascript:alert(1)', '']) {
    assert.equal(T.isMediaUrl(bad), false, bad);
  }
  console.log('✓ 只认视频详情页，直链只认 TikTok 的视频服务器');
}

/* ---- 2. 在页面数据里按视频 ID 找直链 ---- */
{
  const data = { __DEFAULT_SCOPE__: { 'webapp.video-detail': { itemInfo: { itemStruct: {
    id: '7707162841757027604', desc: 'Made a fall drink', video: { playAddr: CDN, downloadAddr: 'https://v16.tiktok.com/dl' },
  } } } } };
  const other = { id: '1', video: { playAddr: 'https://v16.tiktok.com/other' } };
  globalThis.document = { getElementById: () => ({ textContent: JSON.stringify({ list: [other], ...data }) }) };
  assert.deepEqual(await T.readPage('7707162841757027604'), { url: CDN, title: 'Made a fall drink' }, '按 ID 找，不拿别的视频');
  // 站内跳转过来：页面数据是别的视频，重新取当前网址的网页再找
  globalThis.document = { getElementById: () => ({ textContent: JSON.stringify({ list: [other] }) }) };
  globalThis.location = { href: PAGE };
  globalThis.fetch = async (url, init) => {
    assert.equal(url, PAGE);
    assert.equal(init.credentials, 'include');
    return { text: async () => 'html' };
  };
  globalThis.DOMParser = class { parseFromString() { return { getElementById: () => ({ textContent: JSON.stringify(data) }) }; } };
  assert.equal((await T.readPage('7707162841757027604')).url, CDN, '站内跳转时重新取网页');
  globalThis.DOMParser = class { parseFromString() { return { getElementById: () => null }; } };
  assert.equal(await T.readPage('7707162841757027604'), null, '找不到就是 null');
  console.log('✓ 页面数据里按视频 ID 找直链，站内跳转时重新取网页');
}

/* ---- 3. openTikTok：ID 取自标签页地址，直链核对后整份翻译 ---- */
{
  state.found = { url: CDN, title: '  Made a fall drink\n#tea ' };
  await V.openTikTok(7);
  const opened = state.sent.at(-1);
  assert.equal(opened.type, 'video-file-open');
  assert.ok(opened.jobId, '登记了任务');
  assert.equal(opened.srcUrl, PAGE, '用详情页的固定地址认视频（直链会过期）');
  assert.equal(V.running().length, 0, '浮层认领前还没开始');

  // 页面数据被改成别的网站：不翻
  state.found = { url: 'https://evil.example/steal', title: 'x' };
  await V.openTikTok(7);
  assert.equal(state.sent.at(-1).jobId, '');
  assert.match(state.sent.at(-1).error, /没在这一页找到/);
  // 图片帖：没有视频地址
  state.found = { url: '', title: 'photos' };
  await V.openTikTok(7);
  assert.match(state.sent.at(-1).error, /图片帖/);
  // 不是视频详情页：什么都不做
  const before = state.sent.length;
  state.tab = { ...state.tab, url: 'https://www.tiktok.com/foryou' };
  assert.equal(await V.openTikTok(7), false);
  assert.equal(state.sent.length, before);
  console.log('✓ openTikTok：只按标签页地址的视频 ID，直链不对或是图片帖时说明原因');
}

/* ---- 4. 认领后去取的是直链 ---- */
{
  state.tab = { ...state.tab, url: PAGE };
  state.found = { url: CDN, title: 'Made a fall drink' };
  state.sent = [];
  await V.openTikTok(7);
  const { jobId } = state.sent.at(-1);
  const listeners = [];
  const port = {
    name: V.PORT_NAME, sender: { tab: { id: 7 }, frameId: 0 },
    onMessage: { addListener: (f) => listeners.push(f) }, onDisconnect: { addListener() {} }, postMessage() {},
  };
  V.init({ ensureOffscreen: async () => {} });
  V.onConnect(port);
  listeners.forEach((f) => f({ type: 'start', jobId }));
  await new Promise((r) => setTimeout(r, 20));
  const start = state.offscreen.find((m) => m.type === 'video-file-start' && m.jobId === jobId);
  assert.equal(start?.url, CDN);
  assert.deepEqual(start.fromPage, { tabId: 7, frameId: 0 }, '文件由那一页送来');
  assert.ok(state.injectedFuncs.some((d) => d.func === T.sendFile && d.args[0] === CDN && d.args[1] === jobId && d.target.tabId === 7),
    'offscreen 登记后注入页面脚本取文件');
  V.cancel(jobId);
  console.log('✓ 认领后由 TikTok 页面里的脚本取直链');
}

/* ---- 5. 页面脚本：用页面自己的身份取，分块送给 offscreen ---- */
{
  const mp4 = new Uint8Array(1300 * 1024);
  mp4.set([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]);
  const sent = [];
  globalThis.chrome.runtime.connect = ({ name }) => {
    assert.equal(name, 'ai-video-bytes');
    return { postMessage: (m) => sent.push(m), onDisconnect: { addListener() {} } };
  };
  let init = null;
  globalThis.fetch = async (url, options) => {
    init = options;
    const parts = [mp4.subarray(0, 700 * 1024), mp4.subarray(700 * 1024)];
    return { ok: true, status: 200, headers: { get: () => String(mp4.length) }, body: { getReader: () => ({ read: async () => (parts.length ? { done: false, value: parts.shift() } : { done: true }), cancel: async () => {} }) } };
  };
  assert.equal(await T.sendFile(CDN, 'job-1', 100 * 1024 * 1024), true);
  assert.equal(init.credentials, 'include', '带页面自己的 Cookie（和 TikTok 播放器一样）');
  assert.deepEqual(sent[0], { type: 'hello', jobId: 'job-1' });
  assert.equal(sent[1].type, 'meta');
  const chunks = sent.filter((m) => m.type === 'chunk');
  assert.equal(chunks.reduce((n, m) => n + Buffer.from(m.data, 'base64').length, 0), mp4.length, '分块送完整个文件');
  assert.equal(sent.at(-1).type, 'end');
  sent.length = 0;
  assert.equal(await T.sendFile(CDN, 'job-2', 1024), false);
  assert.deepEqual(sent.at(-1), { type: 'error', status: 'too-large' }, '超过上限就停');
  globalThis.fetch = async () => ({ ok: false, status: 403 });
  sent.length = 0;
  await T.sendFile(CDN, 'job-3', 1024);
  assert.deepEqual(sent.at(-1), { type: 'error', status: 403 });
  console.log('✓ 页面脚本带 Cookie 取文件，分块送出，超限、出错时报给 offscreen');
}
process.exit(0);
