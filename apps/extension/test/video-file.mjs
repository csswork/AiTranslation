/** 整份视频翻译：OpenAI 转写、整篇切句翻译（providers.js）与报错文案（video-file.js）。 */
import { installExtensionFixture, deepLLanguages } from './extension-fixture.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const ROOT = new URL('..', import.meta.url).pathname;
globalThis.chrome = {
  storage: { local: { get: async () => ({}), set: async () => {} } },
  runtime: { id: 'test', sendMessage: async () => ({}), getURL: (p) => `chrome-extension://test/${p}` },
};
const load = (p) => new Function(fs.readFileSync(`${ROOT}/${p}`, 'utf8'))();
installExtensionFixture(chrome);
for (const p of ['languages', 'lang', 'settings', 'transcript', 'providers', 'video-file']) load(`src/lib/${p}.js`);
const { AITrSettings: S, AITrProviders: P, AITrTranscript: T, AITrVideoFile: V } = globalThis;

const words = 'theft detected autonomous security system activated please remain seated'.split(' ');
const tokens = words.map((text, i) => ({ text, start: 1000 + i * 400 }));
let calls = [];
const mock = (handler) => {
  calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init, calls.length);
  };
};
const chat = (content) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) });

/* ---- 1. 大模型：一次请求按词序号切句并翻译 ---- */
{
  const settings = S.normalize({ provider: 'deepseek', target: 'zh-Hans', cache: false, deepseek: { apiKey: 'sk-test' } });
  mock(() => chat(JSON.stringify({ cues: [
    { from: 0, to: 5, text: 'Theft detected. Autonomous security system activated.', tr: '检测到盗窃。自动安全系统已启动。' },
    { from: 6, to: 8, text: 'Please remain seated.', tr: '请坐好。' },
  ] })));
  const cues = await P.translateTranscript({ tokens, lang: 'en-US', duration: 9000, title: 'Teslas in GTA 6', settings });
  assert.equal(calls.length, 1, '整篇一次请求');
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.deepEqual(body.thinking, { type: 'disabled' }, '沿用 DeepSeek 的翻译调参');
  const user = JSON.parse(body.messages[1].content);
  assert.equal(user.title, 'Teslas in GTA 6');
  assert.deepEqual(user.tokens[0], [0, 'theft', 1], '每个词带出现的秒数，模型看得出停顿');
  assert.match(body.messages[0].content, /from、to/);
  assert.deepEqual(cues.map((c) => [c.start, c.tr]), [[1000, '检测到盗窃。自动安全系统已启动。'], [3400, '请坐好。']]);
  assert.equal(cues[0].end, 3400, '前一句显示到下一句开始');
  assert.ok(cues[1].end <= 9000);
  console.log('✓ 大模型整篇一次切句 + 翻译，按词序号对回时间');

  // 回复不合格（序号越界）：退回按停顿切句、整批翻译
  mock((_url, init, n) => n === 1
    ? chat('{"cues":[{"from":0,"to":99,"tr":"x"}]}')
    : chat(JSON.stringify(JSON.parse(JSON.parse(init.body).messages[1].content).map((s) => `译:${s}`))));
  const fallback = await P.translateTranscript({ tokens, lang: 'en-US', duration: 9000, settings });
  assert.equal(calls.length, 2, '格式不对时退回一次整批翻译');
  assert.ok(fallback.length >= 1 && fallback.every((c) => c.tr.startsWith('译:')));
  assert.equal(T.joinTokens(tokens, 'en'), fallback.map((c) => c.text).join(' '), '按停顿切出的句子覆盖全部词');
  console.log('✓ 模型回复不合格时退回按停顿切句');
}

/* ---- 2. DeepL：按停顿切句，再整批翻译 ---- */
{
  const settings = S.normalize({ provider: 'deepl', target: 'zh-Hans', cache: false, deepl: { apiKey: 'key:fx' } });
  mock((url, init) => {
    if (String(url).includes('/languages')) return { ok: true, status: 200, json: async () => deepLLanguages };
    const texts = JSON.parse(init.body).text;
    return { ok: true, status: 200, json: async () => ({ translations: texts.map((text) => ({ text: `德:${text}` })) }) };
  });
  const gap = tokens.map((tk, i) => ({ ...tk, start: tk.start + (i >= 6 ? 3000 : 0) }));
  const cues = await P.translateTranscript({ tokens: gap, lang: 'en-US', duration: 15000, settings });
  assert.deepEqual(cues.map((c) => c.text), ['theft detected autonomous security system activated', 'please remain seated']);
  assert.ok(cues.every((c) => c.tr.startsWith('德:')));
  console.log('✓ DeepL：按停顿切句后整批翻译');
}

/* ---- 3. OpenAI 转写：词级时间、语种、发往同一个 Base URL ---- */
{
  const settings = S.normalize({ provider: 'openai', cache: false, openai: { apiKey: 'sk-test', baseUrl: 'https://proxy.example/v1/' } });
  mock(() => ({ ok: true, status: 200, json: async () => ({
    language: 'japanese', text: 'まだ聞いてないよ',
    segments: [{ start: 0, end: 2, avg_logprob: -0.2, no_speech_prob: 0.02, compression_ratio: 1 }],
    words: [{ word: 'まだ', start: 0.2, end: 0.5 }, { word: '聞いてない', start: 0.5, end: 1.1 }, { word: 'よ', start: 1.1, end: 1.3 }],
  }) }));
  const audio = Buffer.from(T.encodeWav(new Float32Array(1600), 16000)).toString('base64');
  const { tokens: got, lang } = await P.transcribe({ audio, settings });
  assert.equal(calls[0].url, 'https://proxy.example/v1/audio/transcriptions');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-test');
  const form = calls[0].init.body;
  assert.equal(form.get('model'), 'whisper-1');
  assert.equal(form.get('response_format'), 'verbose_json');
  assert.deepEqual(form.getAll('timestamp_granularities[]'), ['word', 'segment']);
  assert.equal(form.get('file').type, 'audio/wav');
  assert.equal(lang, 'ja');
  assert.deepEqual(got.map((t) => [t.text, t.start]), [['まだ', 200], ['聞いてない', 500], ['よ', 1100]]);
  assert.equal(T.joinTokens(got, lang), 'まだ聞いてないよ');

  mock(() => ({ ok: false, status: 401, json: async () => ({ error: { message: 'bad key' } }) }));
  await assert.rejects(P.transcribe({ audio, settings }), (err) => /API Key/.test(err.message) && err.action === 'open-options');
  console.log('✓ OpenAI 转写：词级时间、语种判断、Key 错误提示去设置');
}

/* ---- 4. offscreen 错误代码 → 文案；只认直链 ---- */
{
  assert.equal(V.isFileUrl('https://img-9gag-fun.9cache.com/photo/a_460sv.mp4'), true);
  assert.equal(V.isFileUrl('blob:https://www.youtube.com/abc'), false);
  assert.equal(V.isFileUrl('data:video/mp4;base64,AAAA'), false);
  const pack = V.offscreenError({ code: 'pack-downloadable' }, '英语');
  assert.match(pack.message, /英语/);
  assert.equal(pack.action, 'open-video-options', '语言包没装：去设置页的视频卡片');
  assert.match(V.offscreenError({ code: 'too-long', detail: 600 }).message, /10 分钟/);
  assert.match(V.offscreenError({ code: 'too-large', detail: 100 * 1024 * 1024 }).message, /100 MB/);
  assert.match(V.offscreenError({ code: 'fetch-failed', detail: 403 }).message, /403/);
  console.log('✓ offscreen 错误代码换成界面文案');
}
