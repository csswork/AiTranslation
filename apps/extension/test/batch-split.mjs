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
let bodies = [];
const reply = (content, finish = 'stop') => ({ ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: finish, message: { content } }] }) });
// 批量请求发的是 JSON 字符串数组；单段兜底发的是纯文字，list 是 [文字] 且 plain 为真
const mock = (handler) => {
  calls = [];
  bodies = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    const content = body.messages[1].content;
    let list;
    let plain = false;
    try {
      list = JSON.parse(content);
    } catch {
      list = [content];
      plain = true;
    }
    calls.push(list);
    return handler(list, plain);
  };
};
const translated = (list) => JSON.stringify(list.map((text) => `译:${text}`));
const expected = (texts) => texts.map((text) => `译:${text}`);

/* 1. 条数对不上：拆成两半各自重发，结果按原顺序拼回 */
{
  const texts = ['a', 'b', 'c', 'd', 'e'];
  mock((list) => reply(list.length === 5 ? JSON.stringify(['只回了一条']) : translated(list)));
  assert.deepEqual(await P.translateBatch({ texts, settings, targetId: 'zh-Hans' }), expected(texts));
  assert.deepEqual(calls, [texts, ['a', 'b', 'c'], ['d', 'e']]);
  console.log('✓ 条数对不上时拆成两半重发，按原顺序拼回');
}

/* 2. 不是合法 JSON（如输出被截断）也拆；拆到某一半仍不对就继续拆，直到单段 */
{
  const texts = ['a', 'b', 'c', 'd'];
  mock((list) => reply(list.includes('a') && list.length > 1 ? '["译:a", "译:b"' : translated(list)));
  assert.deepEqual(await P.translateBatch({ texts, settings, targetId: 'zh-Hans' }), expected(texts));
  assert.deepEqual(calls.map((list) => list.join('')).sort(), ['a', 'abcd', 'ab', 'b', 'cd'].sort());
  console.log('✓ 回复不是合法数组也拆，逐层拆到单段');
}

/* 3. 合法数组后面多了尾巴、包在代码块里：照常取出，不多发请求 */
{
  mock((list) => reply(`${translated(list)}</br>}`));
  assert.deepEqual(await P.translateBatch({ texts: ['a', 'b'], settings, targetId: 'zh-Hans' }), expected(['a', 'b']));
  mock((list) => reply('```json\n' + translated(list) + '\n```'));
  assert.deepEqual(await P.translateBatch({ texts: ['a', 'b'], settings, targetId: 'zh-Hans' }), expected(['a', 'b']));
  assert.equal(calls.length, 1);
  console.log('✓ 容忍数组后面的尾巴与代码块');
}

/* 4. 单段仍不对：改用普通文字翻译兜底，不报格式错误；兜底也是空回复才报错；网络、额度等错误不拆 */
{
  mock((list, plain) => reply(plain ? ` 译:${list[0]}\n` : '不是数组'));
  assert.deepEqual(await P.translateBatch({ texts: ['a', 'b'], settings, targetId: 'zh-Hans' }), expected(['a', 'b']));
  assert.equal(calls.length, 5, '整批 1 次，两个单段各 1 次 JSON、1 次纯文字');

  mock(() => reply(''));
  await assert.rejects(P.translateBatch({ texts: ['a'], settings, targetId: 'zh-Hans' }), /没有返回任何内容/);

  mock(() => ({ ok: false, status: 429, json: async () => ({}), text: async () => 'rate limited' }));
  await assert.rejects(P.translateBatch({ texts: ['a', 'b', 'c'], settings, targetId: 'zh-Hans' }), /请求太频繁/);
  assert.equal(calls.length, 1, '额度、网络等错误不拆');
  console.log('✓ 单段改用普通翻译兜底；网络、额度错误不拆');
}

/* 5. 正常回复只请求一次 */
{
  mock((list) => reply(translated(list)));
  await P.translateBatch({ texts: ['a', 'b', 'c'], settings, targetId: 'zh-Hans' });
  assert.equal(calls.length, 1);
  console.log('✓ 正常回复不多花请求');
}

/* 6. 平台拒绝处理（DeepSeek 对政治敏感内容：finish_reason 为 content_filter、内容为空）：
      拆半隔离被拦的段落，这些段落保留原文、不发纯文字请求，其余照常翻译，不报错 */
{
  const texts = ['a', 'b', 'bad', 'd'];
  mock((list) => (list.includes('bad') ? reply('', 'content_filter') : reply(translated(list))));
  assert.deepEqual(await P.translateBatch({ texts, settings, targetId: 'zh-Hans' }), ['译:a', '译:b', 'bad', '译:d']);
  assert.deepEqual(calls.map((list) => list.join('')).sort(), ['abbadd', 'ab', 'badd', 'bad', 'd'].sort());
  console.log('✓ 被平台拦下的段落保留原文，其余照常翻译');
}

/* 7. 区域翻译与整站翻译每批最多 50 段、2200 字 */
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
