import { installExtensionFixture, deepLLanguages } from './extension-fixture.mjs';
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
installExtensionFixture(chrome);
for (const file of ['languages', 'lang', 'settings', 'terms', 'cache', 'providers']) load(`src/lib/${file}.js`);
const { AITrSettings: S, AITrProviders: P, AITrTerms: T } = globalThis;
const { create, memoryBackend } = globalThis.AITrCache;

/* 1. 存取、加密、淘汰（内存存储，语义与 IndexedDB 存储一致） */
{
  assert.equal(globalThis.AITrCache.usable({}), false, 'node 里没有 IndexedDB：默认实例不可用');
  let clock = 1_000_000;
  const backend = memoryBackend();
  const cache = create({ backend, now: () => clock, maxEntries: 10, idleMs: 1000 });
  const m = cache.material('llm', 'openai', 'Hello, world');
  assert.deepEqual(await cache.getMany([m]), [undefined]);
  await cache.setMany([[m, '你好，世界'], [cache.material('x'), { options: [1] }]]);
  assert.deepEqual(await cache.getMany([m, cache.material('x'), cache.material('y')]), ['你好，世界', { options: [1] }, undefined]);
  const dump = JSON.stringify([...backend.entries.values()].map((r) => [r.id, Buffer.from(r.data).toString('latin1')]));
  assert.ok(!dump.includes('Hello') && !dump.includes('你好') && !dump.includes('openai'), '库里既没有原文也没有明文译文');
  assert.equal(cache.usable({ cache: false }), false, '设置里关掉就不用');
  assert.equal(cache.usable({ cache: true }), true);

  // 篡改的条目当作没命中
  const [first] = backend.entries.values();
  backend.entries.set(first.id, { ...first, data: new Uint8Array(first.data.byteLength) });
  assert.deepEqual(await cache.getMany([m]), [undefined]);

  // 闲置过期、超过条数删最久没用的；命中超过一天才更新使用时间
  await cache.clear();
  for (let i = 0; i < 12; i += 1) { clock += 1; await cache.setMany([[cache.material(i), i]]); }
  await cache.prune();
  assert.equal(await cache.count(), 9, '超过上限时删到九成');
  assert.deepEqual(await cache.getMany([cache.material(0), cache.material(11)]), [undefined, 11], '先删最久没用的');
  clock += 2000;
  await cache.prune();
  assert.equal(await cache.count(), 0, '闲置过期的删掉');
  console.log('✓ 加密存取、篡改不命中、闲置过期与条数上限');
}

// 之后的测试用一个可用的缓存实例
const backend = memoryBackend();
globalThis.AITrCache = create({ backend });
const C = globalThis.AITrCache;

let calls = [];
const llmReply = (content, finish = 'stop') => ({ ok: true, json: async () => ({ choices: [{ message: { content }, finish_reason: finish }] }) });
const sse = (parts, finish = 'stop') => {
  const lines = parts.map((content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n`);
  if (finish) lines.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] })}\n`, 'data: [DONE]\n');
  const chunks = lines.map((line) => new TextEncoder().encode(line));
  return { ok: true, body: { getReader: () => ({ read: async () => (chunks.length ? { done: false, value: chunks.shift() } : { done: true }), cancel: async () => {} }) } };
};
const mock = (handler) => {
  calls = [];
  globalThis.fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ url, body });
    return handler(url, body);
  };
};
const collect = async (iter) => { let out = ''; for await (const chunk of iter) out += chunk; return out; };
const base = S.normalize({ provider: 'openai', target: 'zh-Hans', openai: { apiKey: 'sk-test' }, deepl: { apiKey: 'k:fx' } });

/* 2. 大模型单段：非流式、流式、截断与取消不存、fresh 绕过、关掉开关 */
{
  const settings = { ...base, stream: false };
  mock(() => llmReply('你好'));
  assert.equal(await collect(P.translate({ text: 'Hello', settings })), '你好');
  await C.flush();
  assert.equal(await collect(P.translate({ text: 'Hello', settings })), '你好');
  assert.equal(calls.length, 1, '第二次直接用缓存');
  assert.equal(await collect(P.translate({ text: 'Hello', settings: { ...settings, stream: true } })), '你好', '流式与非流式共用缓存');
  assert.equal(calls.length, 1);

  await collect(P.translate({ text: 'Hello', settings, targetId: 'ja' }));
  assert.equal(calls.length, 2, '目标语言不同不命中');
  await collect(P.translate({ text: 'Hello', settings: { ...settings, openai: { ...settings.openai, model: 'gpt-6-astra' } } }));
  assert.equal(calls.length, 3, '模型不同不命中');

  mock(() => llmReply('新译文'));
  assert.equal(await collect(P.translate({ text: 'Hello', settings, fresh: true })), '新译文', 'fresh 不查缓存');
  await C.flush();
  assert.equal(await collect(P.translate({ text: 'Hello', settings })), '新译文', '新结果覆盖旧的');
  assert.equal(calls.length, 1);

  mock(() => llmReply('半截', 'length'));
  await collect(P.translate({ text: 'Long text', settings }));
  await C.flush();
  await collect(P.translate({ text: 'Long text', settings }));
  assert.equal(calls.length, 2, '被截断的译文不存');

  const streaming = { ...base, stream: true };
  mock(() => sse(['流', '式']));
  assert.equal(await collect(P.translate({ text: 'Stream', settings: streaming })), '流式');
  await C.flush();
  assert.equal(await collect(P.translate({ text: 'Stream', settings: streaming })), '流式');
  assert.equal(calls.length, 1, '流式正常收尾后存下');

  mock(() => sse(['断'], null));
  await collect(P.translate({ text: 'Broken', settings: streaming }));
  await C.flush();
  await collect(P.translate({ text: 'Broken', settings: streaming }));
  assert.equal(calls.length, 2, '没有 finish_reason: stop 的断流不存');

  mock(() => sse(['一', '二']));
  for await (const _ of P.translate({ text: 'Cancel', settings: streaming })) break; // 读到一半不读了
  await C.flush();
  await collect(P.translate({ text: 'Cancel', settings: streaming }));
  assert.equal(calls.length, 2, '中途停止读取的不存');

  mock(() => llmReply('关'));
  const off = { ...settings, cache: false };
  await collect(P.translate({ text: 'Off', settings: off }));
  await C.flush();
  await collect(P.translate({ text: 'Off', settings: off }));
  assert.equal(calls.length, 2, '关掉开关时不读不写');

  // 改了用词偏好：完整提示词在键里，旧译文不再命中
  mock(() => llmReply('功能'));
  await collect(P.translate({ text: 'feature', settings }));
  await T.remember({ source: 'feature', from: '功能', to: '特性', target: 'zh-Hans' });
  await collect(P.translate({ text: 'feature', settings }));
  assert.equal(calls.length, 2, '用词偏好变化后重新请求');
  await T.clear();
  console.log('✓ 单段：命中、目标语言与模型隔离、fresh、截断 / 断流 / 中止不存、开关、用词偏好');
}

/* 3. 批量：双语阅读等逐段命中，网页片段整批命中 */
{
  const settings = base;
  mock((url, body) => {
    const list = JSON.parse(body.messages[1].content);
    return llmReply(JSON.stringify(list.map((text) => `译:${text}`)));
  });
  assert.deepEqual(await P.translateBatch({ texts: ['a', 'b'], settings, surface: 'reader' }), ['译:a', '译:b']);
  await C.flush();
  assert.deepEqual(await P.translateBatch({ texts: ['b', 'c', 'a'], settings, surface: 'pdf' }), ['译:b', '译:c', '译:a']);
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(calls[1].body.messages[1].content), ['c'], '只请求没命中的段落');
  await C.flush();
  await P.translateBatch({ texts: ['a', 'b', 'c'], settings, surface: 'image' });
  assert.equal(calls.length, 2, '全部命中时不发请求');

  await P.translateBatch({ texts: ['x', 'y'], settings, surface: 'page' });
  await C.flush();
  await P.translateBatch({ texts: ['x', 'y'], settings, surface: 'site' });
  assert.equal(calls.length, 3, '网页片段：同样的一批整批命中');
  await P.translateBatch({ texts: ['x', 'z'], settings, surface: 'site' });
  assert.equal(calls.length, 4, '网页片段：不逐段命中');
  assert.deepEqual(JSON.parse(calls[3].body.messages[1].content), ['x', 'z'], '整批发出，保留前后文');

  // 区域 / 整站翻译带 whole 标记：独立成段的逐段命中，片段总是随没命中的一起发出、不单独缓存
  mock((url, body) => llmReply(JSON.stringify(JSON.parse(body.messages[1].content).map((text) => `译:${text}`))));
  await P.translateBatch({ texts: ['Home', 'Read the', 'docs', 'About'], whole: [true, false, false, true], settings, surface: 'site' });
  await C.flush();
  assert.deepEqual(await P.translateBatch({ texts: ['About', 'Pricing', 'Home'], whole: [true, true, true], settings, surface: 'page' }),
    ['译:About', '译:Pricing', '译:Home']);
  assert.deepEqual(JSON.parse(calls[1].body.messages[1].content), ['Pricing'], '完整段跨页面、跨功能逐段命中');
  await C.flush();
  await P.translateBatch({ texts: ['Home', 'Read the', 'manual'], whole: [true, false, false], settings, surface: 'site' });
  assert.deepEqual(JSON.parse(calls[2].body.messages[1].content), ['Read the', 'manual'], '片段不逐段命中，和同句的其他片段一起发出');
  await C.flush();
  await P.translateBatch({ texts: ['Home', 'Read the', 'manual'], whole: [true, false, false], settings, surface: 'site' });
  assert.equal(calls.length, 3, '同样的一批（含片段）整批命中');
  await P.translateBatch({ texts: ['Read the', 'About'], whole: [true], settings, surface: 'site' });
  assert.deepEqual(JSON.parse(calls[3].body.messages[1].content), ['Read the', 'About'], 'whole 长度不对时全部按片段处理');
  calls.length = 0;

  await P.translateBatch({ texts: ['q'], settings, surface: 'reader', fresh: true });
  await P.translateBatch({ texts: ['a'], settings, surface: 'reader', fresh: true });
  assert.equal(calls.length, 2, 'fresh 时逐段也不查缓存');
  console.log('✓ 批量：逐段命中只请求缺的段落；网页片段整批命中，标为完整段的逐段命中');
}

/* 义项提示只影响命中它的段落：其余段落的键不变，可以和不带提示的批次互相命中 */
{
  const settings = { ...base, target: 'zh-Hans' };
  const texts = ['表地は撥水仕様です。', '縫い目は普通です。'];
  mock((url, body) => {
    const tag = body.messages[0].content.includes('撥水（防泼水）') ? '提示' : '原样';
    return llmReply(JSON.stringify(JSON.parse(body.messages[1].content).map((text) => tag + text)));
  });
  await P.translateBatch({ texts: [texts[1]], settings, surface: 'reader' });
  await C.flush();
  assert.deepEqual(await P.lookupBatch({ texts, settings, surface: 'pdf' }), [null, '原样' + texts[1]]);
  const out = await P.translateBatch({ texts, settings, surface: 'reader' });
  assert.deepEqual(out, ['提示' + texts[0], '原样' + texts[1]]);
  assert.deepEqual(JSON.parse(calls.at(-1).body.messages[1].content), [texts[0]], '只请求命中提示的那段');
  await C.flush();
  assert.deepEqual(await P.lookupBatch({ texts, settings, surface: 'pdf' }), out);
  console.log('✓ 义项提示只改变命中段落的缓存键');
}

/* 4. DeepL：缓存替换用词偏好之前的译文 */
{
  const settings = { ...base, provider: 'deepl' };
  mock((url, body) => {
    if (url.includes('/v3/languages')) return { ok: true, json: async () => deepLLanguages };
    return { ok: true, json: async () => ({ translations: body.text.map((text) => ({ text: text === 'new feature' ? '新功能' : `D:${text}` })) }) };
  });
  assert.equal(await collect(P.translate({ text: 'new feature', settings })), '新功能');
  await C.flush();
  await T.remember({ source: 'feature', from: '功能', to: '特性', target: 'zh-Hans' });
  assert.equal(await collect(P.translate({ text: 'new feature', settings })), '新特性', '命中后照样套用新偏好');
  assert.equal(calls.filter((c) => c.url.endsWith('/v2/translate')).length, 1);
  await T.clear();
  await P.translateBatch({ texts: ['p1', 'p2'], settings, surface: 'reader' });
  await C.flush();
  assert.deepEqual(await P.translateBatch({ texts: ['p2', 'p3'], settings, surface: 'reader' }), ['D:p2', 'D:p3']);
  assert.deepEqual(calls.filter((c) => c.url.endsWith('/v2/translate')).at(-1).body.text, ['p3']);
  console.log('✓ DeepL：单段与批量缓存，用词偏好在取回后套用');
}

/* 5. 点数翻译与本机翻译不走本机缓存 */
{
  let hosted = 0;
  globalThis.AITrAccount = { translate: async ({ texts }) => { hosted += 1; return texts.map((text) => `H:${text}`); } };
  const settings = { ...base, provider: 'hosted', stream: false };
  await collect(P.translate({ text: 'same', settings }));
  await P.translateBatch({ texts: ['same'], settings, surface: 'reader' });
  await C.flush();
  await collect(P.translate({ text: 'same', settings }));
  await P.translateBatch({ texts: ['same'], settings, surface: 'reader' });
  assert.equal(hosted, 4, '点数翻译每次都交给服务端');
  delete globalThis.AITrAccount;

  let local = 0;
  globalThis.AITrLocal = { translate: async ({ texts }) => { local += 1; return texts; } };
  const localSettings = { ...base, provider: 'local' };
  await P.translateBatch({ texts: ['same'], settings: localSettings, surface: 'reader' });
  await C.flush();
  await P.translateBatch({ texts: ['same'], settings: localSettings, surface: 'reader' });
  assert.equal(local, 2, '本机翻译不缓存');
  console.log('✓ 点数翻译、本机翻译不走本机缓存');
}

/* 6. 识图与换说法 */
{
  const settings = base;
  mock(() => llmReply('[{"text":"字","box":[0,0,500,500]}]'));
  const image = 'data:image/png;base64,AAAA';
  const first = await P.readImageText({ image, settings, model: 'gpt-5.6-luna', purpose: 'regions' });
  await C.flush();
  const second = await P.readImageText({ image, settings, model: 'gpt-5.6-luna', purpose: 'regions' });
  assert.deepEqual(second.blocks, first.blocks);
  assert.equal(calls.length, 1, '同一张图同一用途命中');
  await P.readImageText({ image, settings, model: 'gpt-5.6-luna', purpose: 'text' });
  assert.equal(calls.length, 2, '用途不同不命中');
  await P.readImageText({ image, settings, model: 'gpt-5.6-luna', purpose: 'regions', fresh: true });
  assert.equal(calls.length, 3, '「重新识别」不查缓存');
  await P.readImageText({ image: 'https://example.com/a.png', settings, model: 'gpt-5.6-luna' });
  await C.flush();
  await P.readImageText({ image: 'https://example.com/a.png', settings, model: 'gpt-5.6-luna' });
  assert.equal(calls.length, 5, '图片地址不缓存（背后的图可能会变）');
  mock(() => llmReply('不是 JSON'));
  await assert.rejects(() => P.readImageText({ image: 'data:image/png;base64,BBBB', settings, model: 'gpt-5.6-luna' }));
  await C.flush();
  await assert.rejects(() => P.readImageText({ image: 'data:image/png;base64,BBBB', settings, model: 'gpt-5.6-luna' }));
  assert.equal(calls.length, 2, '解析失败的回复不存');

  mock(() => llmReply('{"source":"word","options":[{"text":"说法","note":"n"}]}'));
  const args = { source: 'A word here', translation: '这里有个词', start: 4, end: 5, settings, targetId: 'zh-Hans', noteId: 'en' };
  const alt = await P.alternatives(args);
  await C.flush();
  assert.deepEqual(await P.alternatives(args), alt);
  assert.equal(calls.length, 1, '换说法命中');
  console.log('✓ 识图（只缓存 data: 图片、按用途区分）与换说法');
}

/* 7. 先显示：只查缓存的 lookupBatch，与内容脚本里先查再请求的 AITrRequests.translateBatch */
{
  await C.clear();
  const settings = base;
  mock((url, body) => llmReply(JSON.stringify(JSON.parse(body.messages[1].content).map((text) => `译:${text}`))));
  await P.translateBatch({ texts: ['Home', 'Read the', 'docs'], whole: [true, false, false], settings, surface: 'site' });
  await C.flush();
  assert.deepEqual(await P.lookupBatch({ texts: ['Home', 'Read the', 'Blog'], whole: [true, false, true], settings, surface: 'site' }),
    ['译:Home', null, null], '只查缓存：完整段命中，片段与没缓存的是 null');
  assert.deepEqual(await P.lookupBatch({ texts: ['Home', 'Read the', 'docs'], whole: [true, false, false], settings, surface: 'site' }),
    ['译:Home', '译:Read the', '译:docs'], '同样的一批整批命中，片段也有');
  assert.equal(calls.length, 1, 'lookupBatch 不发请求');
  assert.deepEqual(await P.lookupBatch({ texts: ['Home'], whole: [true], settings: { ...settings, provider: 'hosted' }, surface: 'site' }), [null], '点数翻译不查本机缓存');
  assert.deepEqual(await P.lookupBatch({ texts: ['Home'], whole: [true], settings: { ...settings, cache: false }, surface: 'site' }), [null]);
  assert.deepEqual(await P.lookupBatch({ texts: ['Home'], whole: [true], settings: { ...settings, openai: { apiKey: '' } }, surface: 'site' }), [null], '缺 Key 时不先显示，交给翻译请求报错');

  // DeepL 命中后照样套用用词偏好
  const deepl = { ...base, provider: 'deepl' };
  mock((url, body) => (url.includes('/v3/languages') ? { ok: true, json: async () => deepLLanguages }
    : { ok: true, json: async () => ({ translations: body.text.map(() => ({ text: '新功能' })) }) }));
  await P.translateBatch({ texts: ['new feature'], whole: [true], settings: deepl, surface: 'site' });
  await C.flush();
  await T.remember({ source: 'feature', from: '功能', to: '特性', target: 'zh-Hans' });
  assert.deepEqual(await P.lookupBatch({ texts: ['new feature'], whole: [true], settings: deepl, surface: 'site' }), ['新特性']);
  await T.clear();

  // 内容脚本一侧：命中的先交回，剩下的单独请求后按原顺序合并
  mock((url, body) => llmReply(JSON.stringify(JSON.parse(body.messages[1].content).map((text) => `译:${text}`))));
  const sent = [];
  chrome.runtime = { connect: () => {
    const listeners = [];
    return {
      onMessage: { addListener: (fn) => listeners.push(fn) },
      onDisconnect: { addListener() {} },
      disconnect() {},
      postMessage: async (message) => {
        sent.push(message);
        const options = { settings, texts: message.texts, whole: message.whole, surface: message.surface };
        const reply = message.type === 'cache-lookup' ? { ok: true, texts: await P.lookupBatch(options) }
          : { ok: true, texts: await P.translateBatch(options) };
        listeners.forEach((fn) => fn(reply));
      },
    };
  } };
  load('src/lib/requests.js');
  const R = globalThis.AITrRequests;
  let early = null;
  const reply = await R.translateBatch({ type: 'translate-batch', texts: ['Home', 'Read the', 'manual'], whole: [true, false, false], providerId: 'openai', surface: 'site' },
    { settings, onHits: (found) => { early = found; } });
  assert.deepEqual(early, ['译:Home', null, null], '命中的段落先交回');
  assert.deepEqual(reply.texts, ['译:Home', '译:Read the', '译:manual']);
  assert.deepEqual(sent.map((m) => [m.type, m.texts]), [['cache-lookup', ['Home', 'Read the', 'manual']], ['translate-batch', ['Read the', 'manual']]],
    '剩下的单独请求（片段仍在一起）');
  assert.deepEqual(sent[1].whole, [false, false]);

  sent.length = 0;
  await R.translateBatch({ type: 'translate-batch', texts: ['x'], whole: [true], providerId: 'hosted', surface: 'site' }, { settings });
  assert.deepEqual(sent.map((m) => m.type), ['translate-batch'], '点数翻译不先查缓存');
  sent.length = 0;
  await R.translateBatch({ type: 'translate-batch', texts: ['y'], whole: [true], providerId: 'openai', surface: 'page' }, { settings, found: [null] });
  assert.deepEqual(sent.map((m) => m.type), ['translate-batch'], '传了查询结果就不再查一次');
  console.log('✓ 先显示：lookupBatch 只查不请求；内容脚本先交回命中的段落、剩下的单独请求');
}

console.log('本机缓存测试全部通过');
