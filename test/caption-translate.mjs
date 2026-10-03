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

let cap;
const reply = (body, status = 200) => {
  globalThis.fetch = async (url, init) => {
    cap = { url, init, body: init.body ? JSON.parse(init.body) : null };
    return { ok: status < 400, status, json: async () => body };
  };
};
const chat = (content) => ({ choices: [{ message: { content } }] });

/* ---- 1. 设置：字幕翻译默认打开，关掉能存住 ---- */
assert.equal(S.normalize(null).videoTranslate, true, '默认翻译字幕');
assert.equal(S.normalize({ videoTranslate: false }).videoTranslate, false);
assert.equal(S.normalize({ videoTranslate: 'no' }).videoTranslate, true, '非 false 的脏值按默认处理');
console.log('✓ 「翻译字幕」默认打开，关闭能存住');

/* ---- 2. 大模型：字幕专用提示词、前文只作参考、不流式 ---- */
const llm = await S.saveSettings({ ...S.normalize(null), provider: 'deepseek',
  deepseek: { apiKey: 'sk-test', model: '', baseUrl: '' } });
reply(chat('  这是我吃过最奇怪的东西之一  '));
let out = await P.translateCaption({
  text: "this is one of the weirdest things I've",
  context: ['we tried the wildest food in Yunnan', ''],
  settings: llm,
});
assert.equal(out, '这是我吃过最奇怪的东西之一', '去掉首尾空白');
assert.equal(cap.url, 'https://api.deepseek.com/chat/completions');
assert.equal(cap.body.stream, false, '字幕一行很短，不走流式');
const [system, user] = cap.body.messages;
assert.match(system.content, /实时字幕/);
assert.match(system.content, /只翻译「当前行」/);
assert.match(system.content, /简体中文/, '目标语言沿用设置');
assert.equal(user.content,
  "前文：\nwe tried the wildest food in Yunnan\n\n当前行：\nthis is one of the weirdest things I've",
  '前文与当前行分开标注，空的前文行被丢掉');
console.log('✓ 大模型：字幕提示词、前文与当前行分开、不流式');

reply(chat('当前行：你好'));
out = await P.translateCaption({ text: 'hello', settings: llm });
assert.equal(cap.body.messages[1].content, '当前行：\nhello', '没有前文时只发当前行');
assert.equal(out, '你好', '模型照抄的「当前行：」前缀要去掉');
console.log('✓ 没有前文时只发当前行，照抄的前缀会去掉');

/* ---- 3. 没配 Key：报可操作的错误，供字幕退回只显示原文 ---- */
const noKey = await S.saveSettings({ ...S.normalize(null), provider: 'openai' });
await assert.rejects(
  P.translateCaption({ text: 'hello', settings: noKey }),
  (err) => err instanceof P.TranslateError && err.action === 'open-options' && /API Key/.test(err.message),
);
console.log('✓ 没配 Key 时报 open-options 错误');

/* ---- 4. DeepL：前文走 context 参数；没有前文时请求形态与原来一致 ---- */
const deepl = await S.saveSettings({ ...S.normalize(null), provider: 'deepl',
  deepl: { apiKey: 'k:fx', model: '', baseUrl: '' } });
reply({ translations: [{ text: '我们试了' }] });
out = await P.translateCaption({ text: 'we tried', context: ['hello there', 'so today'], settings: deepl });
assert.equal(out, '我们试了');
assert.deepEqual(cap.body, { text: ['we tried'], target_lang: 'ZH-HANS', context: 'hello there\nso today' });
reply({ translations: [{ text: '你好' }] });
await P.translateCaption({ text: 'hello', settings: deepl });
assert.deepEqual(cap.body, { text: ['hello'], target_lang: 'ZH-HANS' }, '没有前文就不带 context');
console.log('✓ DeepL：前文走 context，没有前文时不带');

console.log('\n全部通过');
