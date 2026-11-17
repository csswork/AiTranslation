import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTranslationCache } from '../src/translation/cache.js';
import { createHostedTranslator } from '../src/translation/hosted.js';

const MB = 1024 * 1024;
const baseConfig = { hosted: { apiKey: 'server-only-test-key', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash',
  fallback: { apiKey: 'fallback-test-key', baseUrl: 'https://fallback.example', model: 'text-model' } } };
const withCache = (cache = { maxBytes: MB, ttlMs: 60_000 }) => ({ hosted: { ...baseConfig.hosted, cache } });

/** 模拟模型：把每段原文加上前缀；单段直接回文字，多段回 JSON 数组。 */
function fakeModel() {
  const state = { calls: 0, fail: false };
  state.fetchImpl = async (url, init) => {
    state.calls++;
    if (state.fail) return new Response(null, { status: 500 });
    const body = JSON.parse(init.body);
    const user = body.messages[1].content;
    const translate = (t) => `T(${t})`;
    if (body.stream) {
      const encoder = new TextEncoder();
      const lines = `data: ${JSON.stringify({ choices: [{ delta: { content: translate(user) } }] })}\n\n`
        + `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 9, completion_tokens: 3 } })}\n\ndata: [DONE]\n\n`;
      return new Response(new ReadableStream({ start(c) { c.enqueue(encoder.encode(lines)); c.close(); } }));
    }
    const content = user.startsWith('[') ? JSON.stringify(JSON.parse(user).map(translate)) : translate(user);
    return Response.json({ choices: [{ message: { content } }], usage: { prompt_tokens: 9, completion_tokens: 3 } });
  };
  return state;
}

test('缓存：未配置时不启用；关闭时每次都调用模型', async () => {
  assert.equal(createTranslationCache({ maxBytes: 0, ttlMs: 1000 }), null);
  assert.equal(createTranslationCache({ maxBytes: MB, ttlMs: 0 }), null);
  const model = fakeModel();
  const hosted = createHostedTranslator(baseConfig, { fetchImpl: model.fetchImpl });
  assert.equal(hosted.cache, null);
  await hosted({ texts: ['Hello'], target: 'fr' });
  await hosted({ texts: ['Hello'], target: 'fr' });
  assert.equal(model.calls, 2);
});

test('缓存：相同请求不再调用模型，元数据记为 cache 且 token 为 0；任何影响译文的输入不同都不命中', async () => {
  const model = fakeModel();
  const hosted = createHostedTranslator(withCache(), { fetchImpl: model.fetchImpl });
  const first = await hosted({ texts: ['Hello', 'World'], target: 'fr' });
  assert.equal(first.meta.provider, 'deepseek');
  const again = await hosted({ texts: ['Hello', 'World'], target: 'fr' });
  assert.deepEqual(again.translations, first.translations);
  assert.equal(model.calls, 1);
  assert.equal(again.meta.provider, 'cache');
  assert.equal(again.meta.providerKey, 'cache');
  assert.equal(again.meta.inputTokens, 0);
  assert.equal(again.meta.outputTokens, 0);
  assert.equal(again.meta.fellBack, false);
  assert.ok(again.meta.latencyMs < 50);

  const variants = [
    { texts: ['Hello', 'World'], target: 'de' },
    { texts: ['Hello', 'World'], target: 'fr', source: 'en' },
    { texts: ['Hello', 'World'], target: 'fr', glossary: [{ source: 'World', target: 'Terre' }] },
    { texts: ['World', 'Hello'], target: 'fr' },
    { texts: ['Hello'], target: 'fr' },
    { texts: ['Hello World'], target: 'fr' },
  ];
  for (const request of variants) await hosted(request);
  assert.equal(model.calls, 1 + variants.length, '目标语言、源语言、用词偏好、顺序或分段不同都重新翻译');
  for (const request of variants) await hosted(request);
  assert.equal(model.calls, 1 + variants.length);
});

test('缓存：流式与一次性返回共用；命中时流式一次给出整段译文', async () => {
  const model = fakeModel();
  const hosted = createHostedTranslator(withCache(), { fetchImpl: model.fetchImpl });
  const deltas = [];
  const streamed = await hosted.stream({ text: 'Hello', target: 'fr' }, (d) => deltas.push(d));
  assert.equal(streamed.translation, 'T(Hello)');
  assert.equal(model.calls, 1);

  const plain = await hosted({ texts: ['Hello'], target: 'fr' });
  assert.deepEqual(plain.translations, ['T(Hello)']);
  assert.equal(plain.meta.provider, 'cache');

  await hosted({ texts: ['Bye'], target: 'fr' });
  const hitDeltas = [];
  const hit = await hosted.stream({ text: 'Bye', target: 'fr' }, (d) => hitDeltas.push(d));
  assert.deepEqual(hitDeltas, ['T(Bye)']);
  assert.equal(hit.translation, 'T(Bye)');
  assert.equal(hit.meta.provider, 'cache');
  assert.equal(model.calls, 2);
});

test('缓存：失败不缓存，下次照常调用模型；备用模型的结果可缓存', async () => {
  const model = fakeModel();
  const hosted = createHostedTranslator(withCache(), { fetchImpl: model.fetchImpl });
  model.fail = true;
  await assert.rejects(hosted({ texts: ['Hello'], target: 'fr' }));
  assert.equal(hosted.cache.size, 0);
  model.fail = false;
  const ok = await hosted({ texts: ['Hello'], target: 'fr' });
  assert.equal(ok.meta.provider, 'deepseek');
  assert.equal((await hosted({ texts: ['Hello'], target: 'fr' })).meta.provider, 'cache');
});

test('缓存：到期删除（命中不延长）；超过内存上限时淘汰最久未用的', async () => {
  let t = 1_000;
  const cache = createTranslationCache({ maxBytes: MB, ttlMs: 100, now: () => t });
  cache.set('a', ['A']);
  t += 60;
  assert.deepEqual(cache.get('a'), ['A']);
  t += 50;
  assert.equal(cache.get('a'), null, '从写入算起 100ms 后过期');
  cache.set('b', ['B']);
  t += 200;
  cache.sweep();
  assert.equal(cache.size, 0, '定时清理删除过期条目');
  assert.equal(cache.bytes, 0);
  cache.close();

  const small = createTranslationCache({ maxBytes: 1300, ttlMs: 60_000 }); // 每条约 400 字节，放得下三条
  const value = ['x'.repeat(200)];
  small.set('1', value);
  small.set('2', value);
  small.set('3', value);
  assert.ok(small.get('1'), '读一次，变成最近使用');
  small.set('4', value);
  assert.ok(small.bytes <= 1300);
  assert.equal(small.get('2'), null, '淘汰最久未用的条目');
  assert.ok(small.get('1'));
  assert.ok(small.get('4'));
  small.set('huge', ['y'.repeat(5000)]);
  assert.equal(small.get('huge'), null, '超过上限的单条不缓存');
  assert.ok(small.get('4'), '也不会把已有条目挤掉');
  small.close();
});
