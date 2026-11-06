import { installExtensionFixture } from './extension-fixture.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const ROOT = new URL('..', import.meta.url).pathname;
const store = {};
globalThis.chrome = { storage: { local: {
  get: async (k) => (k in store ? { [k]: structuredClone(store[k]) } : {}),
  set: async (o) => Object.assign(store, structuredClone(o)),
  remove: async (k) => { delete store[k]; },
} } };
const load = (p) => new Function(fs.readFileSync(`${ROOT}/${p}`, 'utf8'))();
installExtensionFixture(chrome); load('src/lib/languages.js'); load('src/lib/lang.js'); load('src/lib/settings.js'); load('src/lib/terms.js'); load('src/lib/providers.js');
const { AITrTerms: T, AITrProviders: P, AITrSettings: S } = globalThis;

/* 1. 记住、同词覆盖、删除、清空 */
{
  assert.equal(await T.remember({ source: '', from: 'a', to: 'b', target: 'en' }), null, '没有原文词语不记');
  assert.equal(await T.remember({ source: '功能', from: 'feature', to: 'feature', target: 'en' }), null, '没改不记');
  const first = await T.remember({ source: ' 功能 ', from: 'function', to: 'feature', target: 'en' });
  assert.equal(first.source, '功能');
  await T.remember({ source: 'Feature', from: '功能', to: '特性', target: 'zh-Hans' });
  await T.remember({ source: '功能', from: 'feature', to: 'capability', target: 'en' });
  let list = await T.list();
  assert.deepEqual(list.map((e) => [e.source, e.to, e.target]), [['功能', 'capability', 'en'], ['Feature', '特性', 'zh-Hans']], '同一目标语言同一原文词语只留最新');
  await T.forget(list[0].id);
  assert.equal((await T.list()).length, 1);
  await T.clear();
  assert.deepEqual(await T.list(), []);
  console.log('✓ 记住、覆盖、删除与清空');
}

/* 2. 匹配：目标语言一致；中日韩按字面、西文按整词且不分大小写 */
{
  await T.remember({ source: '功能', from: 'function', to: 'feature', target: 'en' });
  await T.remember({ source: 'feature', from: '功能', to: '特性', target: 'zh-Hans' });
  await T.remember({ source: 'app', from: '应用', to: '应用程序', target: 'zh-Hans' });
  assert.deepEqual((await T.relevant(['这个新功能很好用'], 'en')).map((e) => e.to), ['feature']);
  assert.deepEqual(await T.relevant(['这个新功能很好用'], 'ja'), [], '目标语言不同不用');
  assert.deepEqual((await T.relevant(['The new Feature ships', 'Our app'], 'zh-Hans')).map((e) => e.to).sort(), ['应用程序', '特性']);
  assert.deepEqual((await T.relevant(['Featured stories and apps'], 'zh-Hans')).map((e) => e.to), [], '西文按整词：featured、apps 不算');
  assert.match(T.promptLine(await T.relevant(['新功能'], 'en')), /\{"功能":"feature"\}/);
  assert.equal(T.promptLine([]), '');
  console.log('✓ 按目标语言与原文词语匹配（中日韩字面、西文整词）');
}

/* 3. 传统翻译接口：原文有这个词时，把原来的译法换成偏好的译法 */
{
  const entries = await T.relevant(['新功能'], 'en');
  assert.equal(T.applyTo('新功能', 'The new function and functional tests', entries), 'The new feature and functional tests');
  assert.equal(T.applyTo('没有这个词', 'The new function', entries), 'The new function', '原文里没有就不改');
  console.log('✓ DeepL 结果按偏好替换（整词）');
}

/* 4. 请求里带上偏好：大模型写进提示词；DeepL 事后替换；点数翻译随请求转给 service worker */
{
  let body;
  globalThis.fetch = async (url, init) => {
    if (url.includes('/v3/languages')) return { ok: true, json: async () => [{ lang: 'EN-US', usable_as_target: true }, { lang: 'ZH', usable_as_source: true }] };
    body = JSON.parse(init.body);
    if (url.includes('deepl')) return { ok: true, status: 200, json: async () => ({ translations: [{ text: 'The new function' }, { text: 'Old' }] }) };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '["The new feature","Old"]' } }] }) };
  };
  const llm = S.normalize({ provider: 'deepseek', target: 'en', deepseek: { apiKey: 'sk', model: '', baseUrl: '' } });
  await P.translateBatch({ texts: ['新功能', '旧的'], settings: llm, targetId: 'en' });
  assert.match(body.messages[0].content, /\{"功能":"feature"\}/, '批量翻译的提示词带上偏好');
  await P.translateBatch({ texts: ['旧的', '别的'], settings: llm, targetId: 'en' });
  assert.doesNotMatch(body.messages[0].content, /prefers these renderings/, '原文里没有就不带');
  const stream = S.normalize({ ...llm, stream: false });
  for await (const _ of P.translate({ text: '新功能', settings: stream, targetId: 'en' })) { /* 读完 */ }
  assert.match(body.messages[0].content, /\{"功能":"feature"\}/, '单段翻译的提示词带上偏好');

  const deepl = S.normalize({ provider: 'deepl', target: 'en', deepl: { apiKey: 'k:fx', model: '', baseUrl: '' } });
  assert.deepEqual(await P.translateBatch({ texts: ['新功能', '旧的'], settings: deepl, targetId: 'en' }), ['The new feature', 'Old']);

  const sent = [];
  chrome.runtime = { sendMessage: async (m) => { sent.push(m); return { ok: true, texts: m.texts }; } };
  await P.translateBatch({ texts: ['新功能'], settings: S.normalize({ provider: 'hosted', target: 'en' }), targetId: 'en' });
  assert.deepEqual(sent.at(-1).glossary, [{ source: '功能', target: 'feature' }]);
  await P.translateBatch({ texts: ['别的'], settings: S.normalize({ provider: 'hosted', target: 'en' }), targetId: 'en' });
  assert.equal(sent.at(-1).glossary, undefined);
  console.log('✓ 大模型提示词、DeepL 替换、点数翻译转发都带上相关偏好');
}

console.log('\n全部通过');
