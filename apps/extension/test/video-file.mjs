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
  mock(() => chat(JSON.stringify({ lang: 'en', garbled: false, cues: [
    { from: 0, to: 5, text: 'Theft detected. Autonomous security system activated.', tr: '检测到盗窃。自动安全系统已启动。' },
    { from: 6, to: 8, text: 'Please remain seated.', tr: '请坐好。' },
  ] })));
  const { cues, check } = await P.translateTranscript({ tokens, lang: 'en-US', heard: 'en-US', duration: 9000, title: 'Teslas in GTA 6', settings });
  assert.deepEqual(check, { lang: 'en', garbled: false }, '模型顺带判断说话语言、识别结果是否读不通');
  assert.equal(calls.length, 1, '整篇一次请求');
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.deepEqual(body.thinking, { type: 'disabled' }, '沿用 DeepSeek 的翻译调参');
  const user = JSON.parse(body.messages[1].content);
  assert.equal(user.title, 'Teslas in GTA 6');
  assert.deepEqual(user.lines[0][0], [0, 'theft'], '逐词结果按明确停顿分行');
  assert.equal(user.heard, 'en-US', '告诉模型识别器按什么语言听的');
  assert.match(body.messages[0].content, /from、to/);
  assert.deepEqual(cues.map((c) => [c.start, c.tr]), [[1000, '检测到盗窃。自动安全系统已启动。'], [3400, '请坐好。']]);
  assert.equal(cues[0].end, 3400, '前一句显示到下一句开始');
  assert.ok(cues[1].end <= 9000);
  console.log('✓ 大模型整篇一次切句 + 翻译，按词序号对回时间');

  // 第一次回复不合格、第二次合格：用第二次的，不退回
  mock((_url, _init, n) => chat(n === 1 ? '{"cues":[{"from":3,"to":1,"tr":"x"}]}' : JSON.stringify({ lang: 'en', garbled: false, cues: [{ from: 0, to: 8, text: 'All.', tr: '全部。' }] })));
  const { cues: retried } = await P.translateTranscript({ tokens, lang: 'en-US', duration: 9000, settings });
  assert.equal(calls.length, 2);
  assert.deepEqual(retried.map((c) => c.tr), ['全部。'], '重试成功就用模型的切句');

  // 回复不合格（序号越界）：再请求一次；还不对才退回按停顿切句、整批翻译
  mock((_url, init, n) => n <= 2
    ? chat('{"cues":[{"from":0,"to":99,"tr":"x"}]}')
    : chat(JSON.stringify(JSON.parse(JSON.parse(init.body).messages[1].content).map((s) => `译:${s}`))));
  const { cues: fallback } = await P.translateTranscript({ tokens, lang: 'en-US', duration: 9000, settings });
  assert.equal(calls.length, 3, '格式不对时重试一次，再退回一次整批翻译');
  assert.ok(fallback.length >= 1 && fallback.every((c) => c.tr.startsWith('译:')));
  assert.equal(T.joinTokens(tokens, 'en'), fallback.map((c) => c.text).join(' '), '按停顿切出的句子覆盖全部词');
  console.log('✓ 模型回复不合格时退回按停顿切句');

  // 太长、跨过明确停顿的条：带前后文单独再请模型切一次
  const talk = [...'yo jack your ex wife called she wants a new boyfriend in your dreams axel'.split(' '), 'shut', 'up'].map((text, i) => ({
    text, start: i * 300 + (i >= 15 ? 2000 : 0),
  }));
  mock((_url, init, n) => {
    const user = JSON.parse(JSON.parse(init.body).messages[1].content);
    if (n === 1) {
      assert.equal(user.lines.length, 2, '明确停顿处分行');
      return chat(JSON.stringify({ lang: 'en', garbled: false, cues: [{ from: 0, to: 16, text: 'Too long.', tr: '太长了。' }] }));
    }
    assert.ok(user.context, '重切时带上前后文');
    return chat(JSON.stringify({ cues: [
      { from: 0, to: 5, text: 'Yo Jack, your ex-wife called.', tr: '杰克，你前妻来电话了。' },
      { from: 6, to: 10, text: 'She wants a new boyfriend.', tr: '她想找个新男友。' },
      { from: 11, to: 14, text: 'In your dreams, Axel.', tr: '做梦吧，阿克塞尔。' },
      { from: 15, to: 16, text: 'Shut up.', tr: '闭嘴。' },
    ] }));
  });
  const { cues: split } = await P.translateTranscript({ tokens: talk, lang: 'en-US', duration: 9000, settings });
  assert.equal(calls.length, 2);
  assert.deepEqual(split.map((c) => c.tr), ['杰克，你前妻来电话了。', '她想找个新男友。', '做梦吧，阿克塞尔。', '闭嘴。']);
  assert.deepEqual(split.map((c) => c.start), [0, 1800, 3300, 6500], '按各自第一个词的时间显示');

  // 重切还是不合格：这一条按停顿和长度切开、整批翻译，其余照用模型的
  mock((_url, init, n) => {
    if (n === 1) return chat(JSON.stringify({ cues: [{ from: 0, to: 14, text: 'Long.', tr: '长。' }, { from: 15, to: 16, text: 'Shut up.', tr: '闭嘴。' }] }));
    if (n === 2) return chat(JSON.stringify({ cues: [{ from: 0, to: 14, text: 'Still long.', tr: '还是长。' }] }));
    return chat(JSON.stringify(JSON.parse(JSON.parse(init.body).messages[1].content).map((s) => `译:${s}`)));
  });
  const { cues: ruled } = await P.translateTranscript({ tokens: talk, lang: 'en-US', duration: 9000, settings });
  assert.ok(ruled.length >= 3 && ruled.slice(0, -1).every((c) => c.tr.startsWith('译:')), '过长的一条按规则切开');
  assert.equal(ruled.at(-1).tr, '闭嘴。', '合格的条照用模型的');
  console.log('✓ 太长、跨过停顿的条单独重切，还不行按规则切');
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
  const { cues, check } = await P.translateTranscript({ tokens: gap, lang: 'en-US', duration: 15000, settings });
  assert.deepEqual(check, { lang: '', garbled: false }, 'DeepL 判断不了语言，不提醒');
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

  // 识别语言选错的提醒：读不通，或模型判断的说话语言与识别语言不同
  globalThis.AITrLanguages = globalThis.AITrLanguages || {};
  const en = S.videoLang({ videoLang: 'en-US' });
  const zh = S.videoLang({ videoLang: 'zh-CN' });
  assert.equal(V.languageWarning({ lang: 'en', garbled: false }, en), '', '语言对、读得通：不提醒');
  assert.match(V.languageWarning({ lang: 'en', garbled: true }, zh), /读不通/, '按中文听英语视频：提醒读不通');
  assert.doesNotMatch(V.languageWarning({ lang: 'es', garbled: true }, en), /西班牙|Spanish/, '读不通时不报模型从乱码里猜的语言');
  assert.match(V.languageWarning({ lang: 'ja', garbled: false }, en), /日语|日本語|Japanese/, '模型说是日语：提醒');
  assert.match(V.languageWarning({ lang: '', garbled: true }, en), /读不通/, '读不通但看不出语言：也提醒');
  assert.equal(V.languageWarning({ lang: 'zh', garbled: false }, S.videoLang({ videoLang: 'zh-TW' })), '', '简繁不算选错');
  console.log('✓ 识别语言像是选错时提醒去设置');

  // 自动：按网页的语言选识别语言，选不出来用英语
  assert.equal(S.normalize({}).videoLang, 'auto', '新安装默认自动');
  assert.equal(S.videoLang({ videoLang: 'auto' }, 'en').id, 'en-US');
  assert.equal(S.videoLang({ videoLang: 'auto' }, 'ja').id, 'ja');
  assert.equal(S.videoLang({ videoLang: 'auto' }, 'zh-TW').id, 'zh-TW');
  assert.equal(S.videoLang({ videoLang: 'auto' }, '').id, 'en-US');
  assert.equal(S.videoLang({ videoLang: 'auto' }, 'en').auto, true);
  assert.equal(S.videoLang({ videoLang: 'ja' }, 'en').id, 'ja', '固定的语言不看网页');
  assert.equal(S.videoLangList()[0].id, 'auto');
  console.log('✓ 识别语言「自动」按网页语言选');

  // 判断语言的候选：网页的语言在前，然后实时字幕里固定的语言、界面语言、英语，其余在后，不重复
  globalThis.chrome.i18n.getUILanguage = () => 'zh-CN';
  const order = V.candidatesFor({ pageLang: 'ja' }, S.normalize({ videoLang: 'es' }));
  assert.deepEqual(order.slice(0, 4), ['ja', 'es', 'zh-CN', 'en-US']);
  assert.equal(new Set(order).size, order.length);
  assert.ok(!order.includes('auto'));
  assert.deepEqual(V.candidatesFor({ pageLang: '' }, S.normalize({})).slice(0, 2), ['zh-CN', 'en-US'], '网页语言判断不了就从界面语言、英语开始');
  assert.equal(V.chooseLanguage('no-such-job', 'en-US'), false, '没有在等选语言的任务');
  console.log('✓ 判断语言的候选顺序');
}

/* ---- 5. 大模型判断视频说的是哪种语言 ---- */
{
  const settings = S.normalize({ provider: 'deepseek', cache: false, deepseek: { apiKey: 'sk-test' } });
  const heard = [{ lang: 'en-US', words: 40, text: 'theft detected autonomous security system activated' }, { lang: 'zh-CN', words: 3, text: 'boyfriend 应 come' }];
  mock(() => chat('{"lang":"en-US","guess":""}'));
  assert.deepEqual(await P.judgeSpokenLanguage({ heard, settings }), { lang: 'en-US', guess: '' });
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.temperature, 0, '判断用确定的温度');
  assert.deepEqual(JSON.parse(body.messages[1].content).heard, heard);
  mock(() => chat('{"lang":null,"guess":"ja"}'));
  assert.deepEqual(await P.judgeSpokenLanguage({ heard, settings }), { lang: '', guess: 'ja' }, '都读不通：给出猜测');
  mock(() => chat('{"lang":"fr-FR","guess":"<script>"}'));
  assert.deepEqual(await P.judgeSpokenLanguage({ heard, settings }), { lang: '', guess: '' }, '不在候选里的、不像语言代码的都不认');
  mock(() => chat('not json'));
  assert.deepEqual(await P.judgeSpokenLanguage({ heard, settings }), { lang: '', guess: '' });
  console.log('✓ 大模型判断说话语言：只认候选里的，读不通时给猜测');
}
