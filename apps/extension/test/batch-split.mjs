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

// 关掉本机缓存，只看请求本身
const settings = S.normalize({ provider: 'deepseek', stream: false, cache: false, deepseek: { apiKey: 'sk-test' } });
let calls = [];
const reply = (content) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) });
const mock = (handler) => {
  calls = [];
  globalThis.fetch = async (url, init) => {
    const list = JSON.parse(JSON.parse(init.body).messages[1].content);
    calls.push(list);
    return handler(list);
  };
};
const translated = (list) => JSON.stringify(list.map((text) => `译:${text}`));

/* 1. 条数对不上：拆成两半各自重发，结果按原顺序拼回 */
{
  const texts = ['a', 'b', 'c', 'd', 'e'];
  mock((list) => reply(list.length === 5 ? JSON.stringify(['只回了一条']) : translated(list)));
  assert.deepEqual(await P.translateBatch({ texts, settings, targetId: 'zh-Hans' }), texts.map((text) => `译:${text}`));
  assert.deepEqual(calls, [texts, ['a', 'b', 'c'], ['d', 'e']]);
  console.log('✓ 条数对不上时拆成两半重发，按原顺序拼回');
}

/* 2. 不是合法 JSON（如输出被截断）也拆；拆到某一半仍不对就继续拆，直到单段 */
{
  const texts = ['a', 'b', 'c', 'd'];
  mock((list) => reply(list.includes('a') && list.length > 1 ? '["译:a", "译:b"' : translated(list)));
  assert.deepEqual(await P.translateBatch({ texts, settings, targetId: 'zh-Hans' }), texts.map((text) => `译:${text}`));
  assert.deepEqual(calls.map((list) => list.join('')).sort(), ['a', 'abcd', 'ab', 'b', 'cd'].sort());
  console.log('✓ 回复不是合法数组也拆，逐层拆到单段');
}

/* 3. 单段仍不对就照常报错；网络、额度等其他错误不拆，直接抛出 */
{
  mock(() => reply('不是数组'));
  await assert.rejects(P.translateBatch({ texts: ['a', 'b'], settings, targetId: 'zh-Hans' }), /合法的 JSON 数组/);
  assert.equal(calls.length, 3, '两段拆成两个单段后仍失败，不再重试');

  mock(() => ({ ok: false, status: 429, json: async () => ({}), text: async () => 'rate limited' }));
  await assert.rejects(P.translateBatch({ texts: ['a', 'b', 'c'], settings, targetId: 'zh-Hans' }), /请求太频繁/);
  assert.equal(calls.length, 1, '额度、网络等错误不拆');
  console.log('✓ 单段仍不对照常报错；网络、额度错误不拆');
}

/* 4. 正常回复只请求一次 */
{
  mock((list) => reply(translated(list)));
  await P.translateBatch({ texts: ['a', 'b', 'c'], settings, targetId: 'zh-Hans' });
  assert.equal(calls.length, 1);
  console.log('✓ 正常回复不多花请求');
}

/* 5. 区域翻译与整站翻译每批最多 50 段、2200 字 */
{
  for (const file of ['src/content/elements.js', 'src/content/site.js']) {
    const source = fs.readFileSync(`${ROOT}/${file}`, 'utf8');
    assert.match(source, /const CHUNK_NODES = 50;/, file);
    assert.match(source, /const CHUNK_CHARS = 2200;/, file);
  }
  console.log('✓ 区域翻译与整站翻译每批最多 50 段、2200 字');
  // 整站翻译：日文页面（声明或正文假名多）里只有汉字的短段不当成中文跳过
  const site = fs.readFileSync(`${ROOT}/src/content/site.js`, 'utf8');
  assert.match(site, /if \(Lang\.looksJapanese\(sample\)\) return 'ja';/);
  assert.match(site, /CHINESE\.has\(session\.targetId\) && session\.pageLang !== 'ja' && Lang\.analyze\(core\)\.isChinese/);
}

console.log('\n全部通过');
