import fs from 'node:fs';
import assert from 'node:assert/strict';
const ROOT = new URL('..', import.meta.url).pathname;
const store = {};
globalThis.chrome = { storage: { local: {
  get: async (k) => (k in store ? { [k]: store[k] } : {}),
  set: async (o) => Object.assign(store, o) }}};
const load = (p) => new Function(fs.readFileSync(`${ROOT}/${p}`, 'utf8'))();
load('src/lib/lang.js'); load('src/lib/settings.js'); load('src/lib/providers.js');
const { AITrSettings: S, AITrProviders: P } = globalThis;

const base = S.normalize(null);
const withKey = (key) => S.saveSettings({ ...base, provider: 'deepl',
  deepl: { apiKey: key, model: '', baseUrl: '' } });

let cap;
const reply = (body, status = 200) => {
  globalThis.fetch = async (url, init) => {
    cap = { url, init, body: init.body ? JSON.parse(init.body) : null };
    return { ok: status < 400, status, json: async () => body };
  };
};

/* 1. 请求形态 */
let st = await withKey('key-123:fx');
reply({ translations: [{ text: '你好，世界' }] });
let out = '';
for await (const c of P.translate({ text: 'Hello, world', settings: st })) out += c;
assert.equal(out, '你好，世界');
assert.equal(cap.url, 'https://api-free.deepl.com/v2/translate', '免费 key 用 api-free 域名');
assert.equal(cap.init.headers.Authorization, 'DeepL-Auth-Key key-123:fx');
assert.deepEqual(cap.body, { text: ['Hello, world'], target_lang: 'ZH-HANS' });
assert.equal('messages' in cap.body, false, 'DeepL 不该带对话接口的字段');
assert.equal('stream' in cap.body, false);
console.log('✓ 请求形态正确（无 messages / 无 stream，文本数组进）');

/* 2. 付费 key 自动切域名 */
st = await withKey('key-456');
reply({ translations: [{ text: 'x' }] });
for await (const _ of P.translate({ text: 'a', settings: st })) void _;
assert.equal(cap.url, 'https://api.deepl.com/v2/translate', '付费 key 用正式域名');
console.log('✓ 免费 / 付费 key 自动选对域名');

/* 3. 繁體与面板的任意语言 */
st = await withKey('k:fx');
st = await S.saveSettings({ ...st, target: 'zh-Hant' });
reply({ translations: [{ text: '繁體' }] });
for await (const _ of P.translate({ text: 'a', settings: st })) void _;
assert.equal(cap.body.target_lang, 'ZH-HANT');
reply({ translations: [{ text: 'Hello' }] });
for await (const _ of P.translate({ text: '你好', settings: st, targetId: 'en' })) void _;
assert.equal(cap.body.target_lang, 'EN-US', '面板指定的语言要能覆盖设置里的目标');
for (const id of Object.keys(S.DEEPL_CODES)) assert.ok(S.deeplCode(id), id + ' 必须有代码');
console.log(`✓ 目标语言映射正确（${Object.keys(S.DEEPL_CODES).length} 种全覆盖）`);

/* 4. 批量：原生支持，比让模型吐 JSON 可靠 */
st = await withKey('k:fx');
reply({ translations: [{ text: '一' }, { text: '二' }, { text: '三' }] });
const batch = await P.translateBatch({ texts: ['one', 'two', 'three'], settings: st });
assert.deepEqual(batch, ['一', '二', '三']);
assert.deepEqual(cap.body.text, ['one', 'two', 'three']);
console.log('✓ 批量翻译走原生数组');

/* 5. 条数对不上要报错，不能错位写入 */
reply({ translations: [{ text: '只有一条' }] });
await assert.rejects(() => P.translateBatch({ texts: ['a', 'b'], settings: st }),
  /返回 1 条，与原文 2 条对不上/);
console.log('✓ 条数不符时报错');

/* 6. DeepL 特有的错误码 */
reply({ message: 'Quota exceeded' }, 456);
await assert.rejects(() => P.translateBatch({ texts: ['a'], settings: st }), /额度已用完/);
reply({ message: 'Wrong key' }, 403);
await assert.rejects(() => P.translateBatch({ texts: ['a'], settings: st }),
  (e) => { assert.match(e.message, /API Key 无效/); assert.equal(e.action, 'open-options'); return true; });
console.log('✓ 456 额度用完 / 403 鉴权失败都有对应提示');

/* 7. 缺 key */
const noKey = await withKey('');
await assert.rejects(() => P.translateBatch({ texts: ['a'], settings: noKey }), /API Key/);
console.log('✓ 缺 Key 时引导去设置');

/* 8. 识图要明确拒绝，而不是发一个必然失败的请求 */
st = await withKey('k:fx');
await assert.rejects(
  () => P.readImageText({ image: 'data:x', settings: st }),
  (e) => { assert.match(e.message, /只能翻译文本/); assert.match(e.message, /ChatGPT 或 DeepSeek/); return true; });
assert.equal(S.supportsVision('deepl'), false);
assert.equal(S.supportsStreaming('deepl'), false);
assert.equal(S.needsModel('deepl'), false);
console.log('✓ 识图被明确拒绝并指出替代方案');

/* 9. LLM 两家完全不受影响 */
const llm = await S.saveSettings({ ...base, provider: 'deepseek', stream: false,
  deepseek: { apiKey: 'sk-test', model: '', baseUrl: '' } });
globalThis.fetch = async (url, init) => {
  cap = { url, body: JSON.parse(init.body) };
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '译文' } }] }) };
};
out = '';
for await (const c of P.translate({ text: 'Hello', settings: llm })) out += c;
assert.equal(out, '译文');
assert.equal(cap.url, 'https://api.deepseek.com/chat/completions');
assert.ok(Array.isArray(cap.body.messages), '对话接口仍走 messages');
assert.deepEqual(S.resolveProvider(llm).kind, 'llm');
console.log('✓ ChatGPT / DeepSeek 的请求路径未受影响');

console.log('\n全部通过');
