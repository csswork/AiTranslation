import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHostedTranslator } from '../src/translation/hosted.js';

const config = { hosted: { apiKey: 'server-only-test-key', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-pro',
  fallback: { apiKey: 'fallback-test-key', baseUrl: 'https://fallback.example', model: 'text-model' } } };
const image = 'data:image/png;base64,AAAA';

test('托管识图使用服务端 Flash 模型与 Key，图片只放 user 消息，返回坐标及计费元数据', async () => {
  let request;
  const hosted = createHostedTranslator(config, { fetchImpl: async (url, init) => {
    request = { url, ...init, body: JSON.parse(init.body) };
    return Response.json({ choices: [{ message: { content: '```json\n[{"text":"Hello 🌍","box":[100,200,800,400],"extra":"discard"}]\n```' } }],
      usage: { prompt_tokens: 120, prompt_cache_hit_tokens: 10, completion_tokens: 20 } });
  } });
  const result = await hosted.readImageText({ image, model: 'untrusted-model', baseUrl: 'https://evil.example' });
  assert.equal(request.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(request.headers.authorization, 'Bearer server-only-test-key');
  assert.equal(request.body.model, 'deepseek-flash', '文字配置用 Pro 时，识图仍选择支持视觉的 Flash');
  assert.equal(typeof request.body.messages[0].content, 'string');
  assert.equal(request.body.messages[1].content[1].image_url.url, image);
  assert.deepEqual(JSON.parse(result.raw), [{ text: 'Hello 🌍', box: [100, 200, 800, 400] }]);
  assert.equal(result.meta.inputTokens, 120);
  assert.equal(result.meta.cachedTokens, 10);
  assert.equal(result.meta.outputTokens, 20);
});

test('空图、错误坐标与非 JSON 回复；错误不包含识别内容，不向未验证视觉能力的备用服务商发送图片', async () => {
  let content = '[]', status = 200, calls = 0;
  const hosted = createHostedTranslator(config, { fetchImpl: async () => {
    calls++;
    return Response.json({ choices: [{ message: { content } }] }, { status });
  } });
  assert.deepEqual(JSON.parse((await hosted.readImageText({ image })).raw), []);
  for (content of ['sensitive text', '{}', '[{"text":"secret","box":[1,2,"bad",4]}]']) {
    await assert.rejects(hosted.readImageText({ image }), (err) => err.code === 'image_parse' && !/sensitive|secret/.test(err.message));
  }
  status = 500;
  const before = calls;
  await assert.rejects(hosted.readImageText({ image }), { code: 'http_500' });
  assert.equal(calls - before, 1);
});

test('托管文字仍可在主力失败后改用备用模型', async () => {
  const hosted = createHostedTranslator(config, { fetchImpl: async (url) => url.startsWith('https://api.deepseek.com')
    ? new Response(null, { status: 500 })
    : Response.json({ choices: [{ message: { content: '["こんにちは","世界"]' } }], usage: {} }) });
  const result = await hosted({ texts: ['Hello', 'World'], target: 'ja' });
  assert.deepEqual(result.translations, ['こんにちは', '世界']);
  assert.equal(result.meta.fellBack, true);
});

/** 模拟 OpenAI 兼容的流式响应；chunks 是 delta.content 列表，可故意在中间切断行。 */
function sseResponse(chunks, { usage = { prompt_tokens: 50, completion_tokens: 7 }, split = true } = {}) {
  const lines = chunks.map((content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`)
    .concat(`data: ${JSON.stringify({ choices: [], usage })}\n\n`, 'data: [DONE]\n\n').join('');
  const encoder = new TextEncoder();
  const parts = split ? [lines.slice(0, 17), lines.slice(17, 60), lines.slice(60)] : [lines];
  return new Response(new ReadableStream({
    start(controller) { for (const part of parts) controller.enqueue(encoder.encode(part)); controller.close(); },
  }), { headers: { 'content-type': 'text/event-stream' } });
}

test('流式翻译：逐段回调、跨包断行可拼接、去掉开头空白并统计 token', async () => {
  let request;
  const hosted = createHostedTranslator(config, { fetchImpl: async (url, init) => {
    request = JSON.parse(init.body);
    return sseResponse(['\n', 'Bon', 'jour', ' le monde', '\n']);
  } });
  const deltas = [];
  const result = await hosted.stream({ text: 'Hello world', target: 'fr' }, (delta) => deltas.push(delta));
  assert.equal(request.stream, true);
  assert.deepEqual(request.stream_options, { include_usage: true });
  assert.equal(request.messages[1].content, 'Hello world');
  assert.deepEqual(deltas, ['Bon', 'jour', ' le monde', '\n']);
  assert.equal(result.translation, 'Bonjour le monde');
  assert.equal(result.meta.inputTokens, 50);
  assert.equal(result.meta.outputTokens, 7);
  assert.equal(result.meta.fellBack, false);
});

test('流式翻译：主力未输出就失败时改用备用；已输出后失败不再重试', async () => {
  let calls = 0;
  const before = createHostedTranslator(config, { fetchImpl: async (url) => {
    calls++;
    return url.startsWith('https://api.deepseek.com') ? new Response(null, { status: 503 }) : sseResponse(['Hallo']);
  } });
  const result = await before.stream({ text: 'Hello', target: 'de' }, () => {});
  assert.equal(result.translation, 'Hallo');
  assert.equal(result.meta.fellBack, true);
  assert.equal(calls, 2);

  calls = 0;
  const after = createHostedTranslator(config, { fetchImpl: async () => {
    calls++;
    const encoder = new TextEncoder();
    return new Response(new ReadableStream({
      // error() 会丢掉队列里尚未读取的数据，所以在第一段被读走后（下一次 pull）再断开。
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Hal' } }] })}\n\n`));
      },
      pull(controller) { controller.error(new Error('reset')); },
    }));
  } });
  const deltas = [];
  await assert.rejects(after.stream({ text: 'Hello', target: 'de' }, (d) => deltas.push(d)), (err) => err.code === 'network' && err.started === true);
  assert.deepEqual(deltas, ['Hal']);
  assert.equal(calls, 1, '已经输出过译文，不能换备用模型重来');

  const empty = createHostedTranslator({ hosted: { ...config.hosted, fallback: null } }, { fetchImpl: async () => sseResponse(['  ']) });
  await assert.rejects(empty.stream({ text: 'Hello', target: 'de' }, () => {}), { code: 'empty' });
});
