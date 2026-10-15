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
