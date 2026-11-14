import { installExtensionFixture } from './extension-fixture.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const ROOT = new URL('..', import.meta.url).pathname;
globalThis.chrome = {
  storage: { local: { get: async () => ({}), set: async () => {} } },
  runtime: { sendMessage: async () => ({}) },
};
const load = (p) => new Function(fs.readFileSync(`${ROOT}/${p}`, 'utf8'))();
installExtensionFixture(chrome); load('src/lib/languages.js'); load('src/lib/lang.js'); load('src/lib/settings.js'); load('src/lib/providers.js');
const { AITrSettings: S, AITrProviders: P } = globalThis;

const bodies = [];
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  bodies.push(body);
  const content = body.messages[1].content.startsWith('[') ? '["一","二"]' : '译文';
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) };
};
const settings = S.normalize({ provider: 'deepseek', stream: false, deepseek: { apiKey: 'sk-test', model: '', baseUrl: '' } });
const system = () => bodies.at(-1).messages[0].content;
const single = async (targetId) => { for await (const piece of P.translate({ text: 'Hello', settings, targetId })) void piece; return system(); };
const batch = async (targetId) => { await P.translateBatch({ texts: ['a', 'b'], settings, targetId }); return system(); };

/* 1. 目标是中文时带风格指南；片段翻译多一条连读要求；其他目标语言不带 */
{
  for (const targetId of ['zh-Hans', 'zh-Hant']) {
    // 繁体目标用繁体写的指南，避免模型跟着输出简体
    const hant = targetId === 'zh-Hant';
    const one = await single(targetId);
    assert.match(one, hant ? /譯文風格：/ : /译文风格：/);
    assert.match(one, hant ? /改的是說法，不是內容/ : /改的是说法，不是内容/);
    assert.equal(/譯文全部使用繁體中文/.test(one), hant);
    assert.doesNotMatch(one, /同一句[话話]被切[开開]/, '整段翻译不需要片段那一条');
    const many = await batch(targetId);
    assert.match(many, hant ? /同一句話被切開/ : /同一句话被切开/);
  }
  for (const targetId of ['en', 'ja']) {
    assert.doesNotMatch(await single(targetId), /译文风格|譯文風格/);
    assert.doesNotMatch(await batch(targetId), /译文风格|譯文風格/);
  }
  console.log('✓ 中文目标带风格指南，片段翻译多一条连读要求，其他语言不带');
}

/* 2. 风格指南与后台一致 */
{
  const guide = (source) => {
    const start = source.indexOf('function styleGuide');
    assert.ok(start >= 0, '找不到 styleGuide');
    return source.slice(start, source.indexOf('.filter(Boolean).join(', start)).split('\n').map((line) => line.trim()).join('\n');
  };
  assert.equal(guide(fs.readFileSync(`${ROOT}/src/lib/providers.js`, 'utf8')),
    guide(fs.readFileSync(`${ROOT}/../backend/src/translation/hosted.js`, 'utf8')),
    '扩展与后台的译文风格指南保持一致');
  console.log('✓ 风格指南与后台 hosted.js 一致');
}
