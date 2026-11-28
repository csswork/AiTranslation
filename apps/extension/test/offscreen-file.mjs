/** offscreen 收网页脚本送来的视频文件（TikTok，src/offscreen/file.js 的 receive）：只认登记的标签页与 jobId，限大小，页面关了算失败。 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const ROOT = new URL('..', import.meta.url).pathname;
const event = () => { const listeners = []; return { listeners, addListener: (f) => listeners.push(f), removeListener: (f) => listeners.splice(listeners.indexOf(f), 1) }; };
const emitted = [];
const onMessage = event();
const onConnect = event();
globalThis.chrome = {
  runtime: { id: 'test', onMessage, onConnect, sendMessage: (m) => { emitted.push(m); return Promise.resolve(); } },
};
globalThis.AITrSpeech = { supported: () => true, packStatus: async () => 'available' };
// 解码打桩：收到的字节能交到解码这一步就算收对了（再往后是音频处理，不在这里测）
const decoded = [];
globalThis.OfflineAudioContext = class { decodeAudioData(buffer) { decoded.push(buffer.byteLength); return Promise.reject(new Error('stub')); } };
for (const p of ['src/lib/transcript.js', 'src/offscreen/file.js']) new Function(fs.readFileSync(`${ROOT}/${p}`, 'utf8'))();
const settle = () => new Promise((r) => setTimeout(r, 10));

const start = (jobId) => onMessage.listeners[0]({ target: 'offscreen', type: 'video-file-start', jobId, url: 'https://v16.tiktok.com/v', fromPage: { tabId: 7, frameId: 0 }, mode: 'local' },
  { id: 'test' }, () => {});
/** 页面脚本那一端的长连接。 */
function connect(tabId, frameId = 0) {
  const toOffscreen = event();
  const disconnect = event();
  const port = {
    name: 'ai-video-bytes', sender: { id: 'test', tab: { id: tabId }, frameId },
    onMessage: toOffscreen, onDisconnect: disconnect, disconnected: false,
    disconnect() { port.disconnected = true; }, postMessage() {},
  };
  onConnect.listeners.forEach((f) => f(port));
  return { port, send: (m) => [...toOffscreen.listeners].forEach((f) => f(m)), close: () => disconnect.listeners.forEach((f) => f()) };
}
const header = Buffer.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 1, 2, 3, 4]);
const lastError = (jobId) => emitted.filter((m) => m.jobId === jobId && m.event.type === 'error').at(-1)?.event;

/* ---- 1. 只认登记的标签页、框架和 jobId ---- */
start('job-a');
const stranger = connect(9);
stranger.send({ type: 'hello', jobId: 'job-a' });
assert.equal(stranger.port.disconnected, true, '别的标签页连来：断开');
const frame = connect(7, 3);
frame.send({ type: 'hello', jobId: 'job-a' });
assert.equal(frame.port.disconnected, true, '子框架连来：断开');
const wrong = connect(7);
wrong.send({ type: 'hello', jobId: 'job-x' });
assert.equal(wrong.port.disconnected, true, '没登记的 jobId：断开');

/* ---- 2. 收齐分块交给解码 ---- */
const page = connect(7);
page.send({ type: 'hello', jobId: 'job-a' });
assert.equal(page.port.disconnected, false);
page.send({ type: 'meta', total: header.length * 2 });
page.send({ type: 'chunk', data: header.toString('base64') });
page.send({ type: 'chunk', data: header.toString('base64') });
page.send({ type: 'end' });
await settle();
assert.deepEqual(decoded, [header.length * 2], '分块拼成完整文件交给解码');
assert.equal(lastError('job-a').code, 'no-audio', '（解码打桩失败）');
console.log('✓ 只收登记的标签页、框架和 jobId 送来的文件，收齐后交给解码');

/* ---- 3. 不是音视频、太大、页面关了 ---- */
start('job-b');
const b = connect(7);
b.send({ type: 'hello', jobId: 'job-b' });
b.send({ type: 'chunk', data: Buffer.from('<!doctype html>').toString('base64') });
await settle();
assert.equal(lastError('job-b').code, 'not-media', '第一块就按文件头认');

start('job-c');
const c = connect(7);
c.send({ type: 'hello', jobId: 'job-c' });
c.send({ type: 'meta', total: 200 * 1024 * 1024 });
await settle();
assert.equal(lastError('job-c').code, 'too-large');

start('job-d');
const d = connect(7);
d.send({ type: 'hello', jobId: 'job-d' });
d.send({ type: 'chunk', data: header.toString('base64') });
d.close();
await settle();
assert.equal(lastError('job-d').code, 'page-closed', '没送完页面就关了');

start('job-e');
const e = connect(7);
e.send({ type: 'hello', jobId: 'job-e' });
e.send({ type: 'error', status: 403 });
await settle();
assert.deepEqual([lastError('job-e').code, lastError('job-e').detail], ['fetch-failed', '403']);

// 取消：断开页面脚本，停止下载
start('job-f');
const f = connect(7);
f.send({ type: 'hello', jobId: 'job-f' });
onMessage.listeners[0]({ target: 'offscreen', type: 'video-file-stop', jobId: 'job-f' }, { id: 'test' }, () => {});
await settle();
assert.equal(f.port.disconnected, true, '取消时断开，页面脚本随之停止下载');
console.log('✓ 不是音视频、太大、页面关了、取不到、取消都按原因结束');
process.exit(0);
