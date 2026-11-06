import { installExtensionFixture } from './extension-fixture.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const ROOT = new URL('..', import.meta.url).pathname;
const sent = [];
globalThis.chrome = {
  storage: { local: { get: async () => ({}), set: async () => {} } },
  runtime: { sendMessage: async (message) => { sent.push(message); return { ok: true, source: '功能', options: [{ text: 'feature', note: '特性' }] }; } },
};
const load = (p) => new Function(fs.readFileSync(`${ROOT}/${p}`, 'utf8'))();
installExtensionFixture(chrome); load('src/lib/languages.js'); load('src/lib/lang.js'); load('src/lib/settings.js'); load('src/lib/providers.js');
const { AITrSettings: S, AITrProviders: P } = globalThis;

const translation = 'The new function ships today.';
const request = { source: '新功能今天上线。', translation, start: 8, end: 16, targetId: 'en', noteId: 'zh-Hans' };

/* 1. 大模型平台：原文、选中前后的译文分开发；说明用界面语言；只回传文字与说明 */
{
  let body;
  globalThis.fetch = async (url, init) => {
    body = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content:
      '```json\n{"source":"功能","options":[{"text":"feature","note":"产品特性"},{"text":"function"},"capability",{"text":"feature"}]}\n```' } }] }) };
  };
  const settings = S.normalize({ provider: 'deepseek', deepseek: { apiKey: 'sk-test', model: '', baseUrl: '' } });
  const result = await P.alternatives({ ...request, settings });
  assert.match(body.messages[0].content, /refine one part of a translation into English/);
  assert.match(body.messages[0].content, /a few words in Simplified Chinese/);
  assert.deepEqual(JSON.parse(body.messages[1].content), { source: '新功能今天上线。', before: 'The new ', selected: 'function', after: ' ships today.' });
  assert.equal(body.stream, false);
  assert.deepEqual(result, { source: '功能', options: [{ text: 'feature', note: '产品特性' }, { text: 'capability', note: '' }] });
  console.log('✓ 大模型平台：分开发送原文与选中前后的译文，去掉重复与当前选中');
}

/* 2. 提示词与后台一致 */
{
  const backend = fs.readFileSync(`${ROOT}/../backend/src/translation/hosted.js`, 'utf8');
  const prompt = (source) => {
    const start = source.indexOf('function alternativesPrompt');
    return source.slice(start, source.indexOf("].join(", start)).split('\n').map((line) => line.trim()).join('\n');
  };
  assert.equal(prompt(fs.readFileSync(`${ROOT}/src/lib/providers.js`, 'utf8')), prompt(backend),
    '扩展与后台的其他译法提示词保持一致');
  console.log('✓ 提示词与后台 hosted.js 一致');
}

/* 3. DeepL 不支持；没有 Key 时引导去设置；托管经 service worker 转发 */
{
  await assert.rejects(P.alternatives({ ...request, settings: S.normalize({ provider: 'deepl', deepl: { apiKey: 'k:fx', model: '', baseUrl: '' } }) }),
    (err) => err.action === 'unsupported' && /DeepL/.test(err.message));
  await assert.rejects(P.alternatives({ ...request, settings: S.normalize({ provider: 'openai' }) }), (err) => err.action === 'open-options');
  const hosted = await P.alternatives({ ...request, settings: S.normalize({ provider: 'hosted' }) });
  assert.deepEqual(sent.at(-1), { type: 'hosted-alternatives', source: request.source, translation, start: 8, end: 16, target: 'en', note: 'zh-Hans' });
  assert.deepEqual(hosted.options, [{ text: 'feature', note: '特性' }]);
  assert.throws(() => P.parseAlternatives('no json', 'x'));
  console.log('✓ DeepL 明确不支持，缺 Key 引导设置，点数翻译经 service worker 转发');
}

/* 4. 长文只取选中位置附近：不超过 3600 字，选中部分仍然完整 */
{
  const before = 'a'.repeat(5000);
  const translation = `${before}function${'b'.repeat(5000)}`;
  const source = '原'.repeat(9000);
  await P.alternatives({ source, translation, start: 5000, end: 5008, targetId: 'en', noteId: 'en', settings: S.normalize({ provider: 'hosted' }) });
  const m = sent.at(-1);
  assert.ok(m.translation.length <= 3600 && m.source.length <= 3600);
  assert.equal(m.translation.slice(m.start, m.end), 'function');
  console.log('✓ 长文按选中位置截取上下文，选中部分不变');
}

console.log('\n全部通过');
