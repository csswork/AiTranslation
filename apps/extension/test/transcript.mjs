/** 整份视频翻译的文稿工具（src/lib/transcript.js）：词时间、切句、模型回复校验、Whisper 过滤、WAV、容器识别。 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
new Function(fs.readFileSync(new URL('../src/lib/transcript.js', import.meta.url).pathname, 'utf8'))();
const T = globalThis.AITrTranscript;

/* ---- 1. 由中间结果还原词时间 ---- */
{
  // 第 0 轮：结果 0 逐步变长；识别器重启后第 1 轮从头计数
  const log = [
    [0, 0, 1000, 'theft'],
    [0, 0, 1500, 'theft detected'],
    [0, 0, 2600, 'theft detected autonomous security'],
    [0, 1, 4000, 'please'],
    [1, 0, 9000, 'remain seated'],
  ];
  const tokens = T.timedTokens(log, { lang: 'en-US' });
  assert.deepEqual(tokens.map((t) => t.text), ['theft', 'detected', 'autonomous', 'security', 'please', 'remain', 'seated']);
  assert.deepEqual(tokens.map((t) => t.start), [300, 800, 1900, 1900, 3300, 8300, 8300], '每个词取第一次出现的时间减 0.7 秒');
  // 改口：词数先多后少，时间不倒退
  const revised = T.timedTokens([[0, 0, 1000, 'a b c'], [0, 0, 1200, 'a b'], [0, 0, 2000, 'a b c d']], { lang: 'en' });
  assert.deepEqual(revised.map((t) => t.start), [300, 300, 300, 1300], '改口少掉的词再出现时沿用原来的时间，新词取新时间');
  // 中文按词切，不按空格
  const zh = T.timedTokens([[0, 0, 1000, '今天天气很好'], [0, 0, 2000, '今天天气很好我们出去玩']], { lang: 'zh-CN' });
  assert.ok(zh.length >= 4, '中文要切成多个词');
  assert.equal(T.joinTokens(zh, 'zh-CN'), '今天天气很好我们出去玩', '中文拼回时不加空格');
  console.log('✓ 中间结果还原词时间（含改口、重启轮次、中文分词）');
}

/* ---- 2. 不靠模型的切句与显示时间 ---- */
{
  const words = 'what is the shittiest thing a guy has done to you and you were just like it is fine um he proposed'.split(' ');
  const tokens = words.map((text, i) => ({ text, start: i * 300 + (i >= 18 ? 2000 : 0) }));
  const cues = T.splitCues(tokens, { lang: 'en' });
  assert.equal(cues[0].from, 0);
  assert.equal(cues.at(-1).to, tokens.length - 1);
  for (let i = 1; i < cues.length; i += 1) assert.equal(cues[i].from, cues[i - 1].to + 1, '切句连续覆盖每个词');
  assert.ok(cues.every((c) => c.to - c.from + 1 <= 15), '每句不超过上限（尾巴合并后最多多 3 个）');
  assert.ok(cues.some((c) => c.from === 18), '长停顿处要切开');
  const timed = T.cueTimes(tokens, cues, 20000);
  for (let i = 0; i < timed.length; i += 1) {
    assert.ok(timed[i].end > timed[i].start);
    if (timed[i + 1]) assert.ok(timed[i].end <= timed[i + 1].start, '不越过下一句');
  }
  // 片尾之后才吐出的词：挪回片尾前，仍按顺序、不重叠
  const late = [{ text: 'a', start: 1000 }, { text: 'b', start: 24000 }, { text: 'c', start: 29600 }, { text: 'd', start: 30000 }];
  const lateCues = T.cueTimes(late, [{ from: 0, to: 0 }, { from: 1, to: 1 }, { from: 2, to: 2 }, { from: 3, to: 3 }], 26600);
  assert.ok(lateCues.every((c) => c.start < 26600 && c.end <= 26600), '每句都要在片子里播得到');
  for (let i = 1; i < lateCues.length; i += 1) assert.ok(lateCues[i].start > lateCues[i - 1].start && lateCues[i - 1].end <= lateCues[i].start);
  // 句末标点也切（Whisper 的词带标点）
  const punct = T.splitCues([{ text: 'Hi.', start: 0 }, { text: 'Who', start: 200 }, { text: 'are', start: 400 }, { text: 'you?', start: 600 }, { text: 'Me', start: 800 }, { text: 'again', start: 1000 }, { text: 'now', start: 1200 }], { lang: 'en' });
  assert.deepEqual(punct.map((c) => [c.from, c.to]), [[0, 0], [1, 3], [4, 6]], '句末标点处切开');
  // 到长度上限切开后只剩一个词：并进前一句，不单独闪一下
  const run = Array.from({ length: 13 }, (_, i) => ({ text: `w${i}`, start: i * 300 }));
  assert.deepEqual(T.splitCues(run, { lang: 'en' }).map((c) => [c.from, c.to]), [[0, 12]], '一个词的尾巴并进前一句');
  console.log('✓ 停顿、标点、长度切句，时间不重叠');
}

/* ---- 3. 模型回复：只认合法的序号范围 ---- */
{
  const ok = T.parseCueReply('```json\n{"lang":"EN","garbled":false,"cues":[{"from":0,"to":3,"text":"Theft detected.","tr":"检测到盗窃。"},{"from":5,"to":6,"text":"Remain seated.","tr":"请坐好。"}]}\n```', 7);
  assert.deepEqual(ok.cues.map((c) => [c.from, c.to, c.tr]), [[0, 3, '检测到盗窃。'], [5, 6, '请坐好。']], '可以跳过语气词');
  assert.equal(ok.lang, 'en');
  assert.equal(ok.garbled, false);
  const bare = T.parseCueReply('{"cues":[{"from":0,"to":1,"tr":"好"}]}', 2);
  assert.equal(bare.lang, '', '没给语言不算错');
  assert.equal(bare.garbled, undefined);
  assert.deepEqual(T.promptTokens([{ text: 'hi', start: 0 }, { text: 'there', start: 900 }]), [[0, 'hi'], [1, 'there']], '交给模型的只有序号和词');
  for (const [reply, why] of [
    ['not json', '不是 JSON'],
    ['{"cues":[]}', '空'],
    ['{"cues":[{"from":0,"to":3,"tr":"a"},{"from":2,"to":4,"tr":"b"}]}', '重叠'],
    ['{"cues":[{"from":0,"to":9,"tr":"a"}]}', '越界'],
    ['{"cues":[{"from":"0","to":1.5,"tr":"a"}]}', '不是整数'],
    ['{"cues":[{"from":0,"to":1,"tr":""}]}', '没有译文'],
  ]) {
    assert.throws(() => T.parseCueReply(reply, 7), (err) => err.shape === true, why);
  }
  console.log('✓ 模型切句回复：重叠、越界、缺译文都退回');
}

/* ---- 4. 长文稿分段请求 ---- */
{
  const tokens = Array.from({ length: 1500 }, (_, i) => ({ text: 'w', start: i * 400 + (i === 500 ? 5000 : 0) }));
  const chunks = T.chunkTokens(tokens, 600);
  assert.equal(chunks[0][0], 0);
  assert.equal(chunks.at(-1)[1], 1500);
  for (let i = 1; i < chunks.length; i += 1) assert.equal(chunks[i][0], chunks[i - 1][1]);
  assert.ok(chunks.every(([a, b]) => b - a <= 600));
  assert.equal(chunks[0][1], 500, '切在最长的停顿处');
  assert.deepEqual(T.chunkTokens(tokens.slice(0, 100), 600), [[0, 100]]);
  console.log('✓ 长文稿按停顿分段');
}

/* ---- 5. Whisper：词级时间，去掉无人声段落里编出来的句子 ---- */
{
  const data = {
    language: 'english',
    segments: [
      { start: 0, end: 4, avg_logprob: -0.3, no_speech_prob: 0.01, compression_ratio: 1.2 },
      { start: 4, end: 9, avg_logprob: -1.2, no_speech_prob: 0.9, compression_ratio: 1.1 },
    ],
    words: [
      { word: 'Is', start: 0.5, end: 0.7 }, { word: 'this', start: 0.7, end: 0.9 }, { word: 'a', start: 0.9, end: 1 }, { word: 'Tesla?', start: 1, end: 1.4 },
      { word: 'Thanks', start: 5, end: 5.3 }, { word: 'for', start: 5.3, end: 5.4 }, { word: 'watching', start: 5.4, end: 6 },
    ],
  };
  const { tokens, lang } = T.fromWhisper(data);
  assert.equal(lang, 'en');
  assert.deepEqual(tokens.map((t) => t.text), ['Is', 'this', 'a', 'Tesla?']);
  assert.deepEqual([tokens[0].start, tokens[0].end], [500, 700]);
  assert.equal(T.fromWhisper({ language: 'japanese', words: [] }).lang, 'ja');
  console.log('✓ Whisper 词级时间；无人声段落的整句丢掉');
}

/* ---- 5b. 不靠模型判断语言：词最密的那一路 ---- */
{
  // abeXRK9（116 秒英语对话）：按英语听 371 个词、按中文听 15 个
  assert.equal(T.judgeByDensity([{ lang: 'en-US', words: 371 }, { lang: 'zh-CN', words: 15 }], 116000), 'en-US');
  assert.equal(T.judgeByDensity([{ lang: 'en-US', words: 60 }], 25000), 'en-US', '只有一路时读得到足够的词就是它');
  assert.equal(T.judgeByDensity([{ lang: 'en-US', words: 5 }], 25000), '', '词太少：判断不了');
  assert.equal(T.judgeByDensity([{ lang: 'en-US', words: 50 }, { lang: 'es', words: 45 }], 25000), '', '两路差不多：判断不了');
  assert.equal(T.judgeByDensity([], 25000), '');
  console.log('✓ 按词密度判断语言，太少或差不多时判断不了');
}

/* ---- 6. WAV、容器识别、静音 ---- */
{
  const wav = T.encodeWav(new Float32Array([0, 1, -1, 0.5]), 16000);
  assert.equal(wav.length, 44 + 8);
  assert.equal(Buffer.from(wav.slice(0, 4)).toString(), 'RIFF');
  assert.equal(T.sniffMedia(wav), 'audio/wav');
  const view = new DataView(wav.buffer);
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getInt16(46, true), 0x7fff);
  assert.equal(view.getInt16(48, true), -0x8000);
  const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
  assert.equal(T.sniffMedia(new Uint8Array([0, 0, 0, 0x20, ...ascii('ftypisom')])), 'video/mp4');
  assert.equal(T.sniffMedia(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f])), 'video/webm');
  assert.equal(T.sniffMedia(new Uint8Array(ascii('<!doctype html>'))), null);
  assert.equal(T.sniffMedia(new Uint8Array(ascii('#EXTM3U\n'))), null, 'HLS 播放列表不是能取音轨的文件');
  assert.equal(T.isSilent(new Float32Array(16000)), true);
  assert.equal(T.isSilent(new Float32Array(16000).map((_, i) => Math.sin(i / 5) * 0.2)), false);
  console.log('✓ WAV 编码、容器识别、静音判断');
}
