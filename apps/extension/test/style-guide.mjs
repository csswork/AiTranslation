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

/* 1. 目标是中文时用中文写的风格指南；片段翻译多一条连读要求 */
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
  console.log('✓ 中文目标用中文写的风格指南（简体、繁体各一份），片段翻译多一条连读要求');
}

/* 2. 其他目标语言用通用指南：代入语言名；日语、英语各多一条专属说明；片段翻译不许返回空项 */
{
  const expect = { en: ['English', /- English: prefer verbs/], ja: ['Japanese', /- Japanese: choose one style/], es: ['Spanish', null], ko: ['Korean', null] };
  for (const [targetId, [name, extra]] of Object.entries(expect)) {
    const one = await single(targetId);
    assert.doesNotMatch(one, /译文风格|譯文風格/);
    assert.ok(one.includes(`Write what a native speaker of ${name} would write`));
    assert.match(one, /Translate everything: no sentence/);
    assert.equal(/- English: prefer verbs/.test(one), targetId === 'en');
    assert.equal(/- Japanese: choose one style/.test(one), targetId === 'ja');
    if (extra) assert.match(one, extra);
    assert.doesNotMatch(one, /pieces of one sentence/, '整段翻译不需要片段那一条');
    const many = await batch(targetId);
    assert.match(many, /pieces of one sentence/);
    assert.match(many, /Never return an empty string for a non-empty item/);
  }
  console.log('✓ 其他目标语言用通用指南，日语、英语多一条专属说明');
}

/* 3. 两份风格指南都与后台一致 */
{
  const extension = fs.readFileSync(`${ROOT}/src/lib/providers.js`, 'utf8');
  const backend = fs.readFileSync(`${ROOT}/../backend/src/translation/hosted.js`, 'utf8');
  // 取函数头到下一个函数之前（注释与缩进两边不同，只比代码行）
  const body = (source, name, next) => {
    const start = source.indexOf(`function ${name}(`);
    const end = source.indexOf(`function ${next}(`, start);
    assert.ok(start >= 0 && end > start, `找不到 ${name}`);
    return source.slice(start, end).split('\n').map((line) => line.trim())
      .filter((line) => line && !/^(\/\*\*|\*|\*\/|export$)/.test(line)).join('\n').replace(/\nexport$/, '');
  };
  for (const [name, next] of [['generalStyleGuide', 'styleGuide'], ['styleGuide', 'senseHints'], ['senseHints', 'systemPrompt']]) {
    assert.equal(body(extension, name, next), body(backend, name, next), `扩展与后台的 ${name} 保持一致`);
    assert.ok(body(extension, name, next).length > (name === 'senseHints' ? 300 : 500));
  }
  console.log('✓ 风格指南、义项提示与后台 hosted.js 一致');
}

/* 4. 义项提示：只对简体中文目标、只在原文命中时出现，放在风格指南之前；没命中时提示词不变 */
{
  const { systemPrompt: hosted } = await import('../../backend/src/translation/hosted.js');
  const run = async (text, targetId) => { for await (const piece of P.translate({ text, settings, targetId })) void piece; return system(); };
  const plain = await run('バッグです。', 'zh-Hans');
  assert.doesNotMatch(plain, /根据上下文理解以下表达/);
  assert.equal(plain, await run('普通の文です。', 'zh-Hans'), '没命中时提示词与原来相同');

  const hit = await run('撥水加工の生地です。来年度も販売します。', 'zh-Hans');
  assert.match(hit, /根据上下文理解以下表达，仅在对应原文处参考：\n商品说明要区分撥水（防泼水）和防水/);
  assert.match(hit, /来年度 指下一个年度/);
  assert.ok(hit.indexOf('根据上下文') < hit.indexOf('译文风格：'), '提示在风格指南之前');
  for (const targetId of ['zh-Hant', 'en']) assert.doesNotMatch(await run('撥水加工の生地です。', targetId), /撥水（防泼水）/);

  // 批量：按整批原文挑提示
  await P.translateBatch({ texts: ['表地は撥水仕様です。', '縫い目'], settings, targetId: 'zh-Hans' });
  assert.match(system(), /撥水（防泼水）/);
  assert.doesNotMatch(system(), /来年度 指/);
  await P.translateBatch({ texts: ['表地です。', '縫い目'], settings, targetId: 'zh-Hans' });
  assert.doesNotMatch(system(), /根据上下文理解以下表达/);

  // 后台：同样的位置与条件
  const back = hosted('Simplified Chinese', undefined, false, undefined, ['撥水加工']);
  assert.match(back, /撥水（防泼水）/);
  assert.ok(back.indexOf('根据上下文') < back.indexOf('译文风格：'));
  assert.equal(hosted('Simplified Chinese', undefined, false, undefined, ['普通']), hosted('Simplified Chinese', undefined, false));
  assert.doesNotMatch(hosted('Traditional Chinese (Taiwan)', undefined, false, undefined, ['撥水加工']), /撥水（防泼水）/);
  console.log('✓ 义项提示只在简中目标、原文命中时出现，扩展与后台位置一致');
}
