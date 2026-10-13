import fs from 'node:fs';
import assert from 'node:assert/strict';
new Function(fs.readFileSync(new URL('../src/lib/captions.js', import.meta.url).pathname, 'utf8'))();
const C = globalThis.AITrCaptions;

/* ---- 1. 识别结果分段拼接 ---- */
assert.equal(C.joinParts(['hello', 'world'], 'en-US'), 'hello world', '英文分段之间要补空格');
assert.equal(C.joinParts(['hello', ' world'], 'en-US'), 'hello world', '自带空格时不重复补');
assert.equal(C.joinParts(['こんにちは', '世界'], 'ja-JP'), 'こんにちは世界', '日文不补空格');
assert.equal(C.joinParts(['', undefined, 'ok'], 'en-US'), 'ok', '空段跳过');
// 设备端日文中间结果实测会按词加空格，要与不加空格的版本归一成同一串
assert.equal(
  C.joinParts(['この 拡張 機能 は 翻訳 を 頼ん だ テキスト だけ を 送信 し ます API が この パソコン から'], 'ja-JP'),
  C.joinParts(['この拡張機能は翻訳を頼んだテキストだけを送信します API がこのパソコンから'], 'ja-JP'),
  '日文按词加空格的版本与不加空格的版本一致');
assert.equal(C.joinParts(['ご視聴 ありがとう ござい ました 。'], 'ja-JP'), 'ご視聴ありがとうございました。', '标点前的空格也去掉');
assert.equal(C.joinParts(['API がこの'], 'ja-JP'), 'API がこの', '与英文单词之间的空格保留');
console.log('✓ 分段拼接：英文补空格，日文不补');

/* ---- 2. 停顿提交 ---- */
{
  const seg = C.createSegmenter({ lang: 'en-US', pauseMs: 900 });
  assert.deepEqual(seg.update('the quick', 0), { lines: [], partial: 'the quick' });
  assert.deepEqual(seg.update('the quick brown fox', 300), { lines: [], partial: 'the quick brown fox' });
  assert.deepEqual(seg.tick(1000), [], '距最后一次变化不到 900ms，不提交');
  const quick = C.createSegmenter({ lang: 'en-US', translate: true });
  quick.update('hello there', 0);
  assert.deepEqual(quick.tick(700), ['hello there'], '要翻译时停顿 700ms 就提交');
  assert.deepEqual(seg.tick(1200), ['the quick brown fox'], '停顿够久，整段提交');
  assert.deepEqual(seg.tick(5000), [], '已提交的不会再提交一次');
  assert.deepEqual(seg.update('the quick brown fox jumps over', 5100), { lines: [], partial: 'jumps over' },
    '接着说的话只显示新的部分');
  console.log('✓ 停顿够久才提交，不重复提交');
}

/* ---- 3. 太长：按句末 / 空格切，没有就硬切 ---- */
{
  const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
  const seg = C.createSegmenter({ lang: 'en-US' });
  const { lines, partial } = seg.update(words, 0);
  assert.ok(lines.length >= 3, '超长的一段要切成多行');
  for (const line of lines) {
    assert.ok(line.length <= 80, `英文一行不超过 80 字符：${line.length}`);
    assert.match(line, /^word\d+( word\d+)*$/, '在空格处切，不把单词切断');
  }
  assert.equal([...lines, partial].join(' '), words, '切完拼回去与原文一致');

  const ja = 'あ'.repeat(100);
  const jaSeg = C.createSegmenter({ lang: 'ja-JP' });
  const r = jaSeg.update(ja, 0);
  assert.deepEqual(r.lines.map((l) => l.length), [40, 40], '日文没有标点和空格时按 40 字硬切');
  assert.equal(r.partial.length, 20);
  // 要翻译时切得更短：每提交一行才翻译一次，行越长译文越晚
  const tr = C.createSegmenter({ lang: 'en-US', translate: true }).update(words, 0);
  for (const line of tr.lines) assert.ok(line.length <= 56, `翻译时英文一行不超过 56 字符：${line.length}`);
  assert.equal([...tr.lines, tr.partial].join(' '), words);
  const trJa = C.createSegmenter({ lang: 'ja-JP', translate: true }).update(ja, 0);
  assert.deepEqual(trJa.lines.map((l) => l.length), [24, 24, 24, 24], '翻译时日文按 24 字切');
  console.log('✓ 太长按句末或空格切，日文一行更短；要翻译时切得更短');
}

/* ---- 4. 说完一句就提交，不等停顿 ---- */
{
  const seg = C.createSegmenter({ lang: 'en-US' });
  assert.deepEqual(seg.update('Hello there.', 0), { lines: [], partial: 'Hello there.' },
    '句号后面还没有新内容，可能只是识别器加的标点，先不提交');
  assert.deepEqual(seg.update('Hello there. How are', 100), { lines: ['Hello there.'], partial: 'How are' });
  assert.deepEqual(seg.update('Hello there. How are you? I am fine', 200),
    { lines: ['How are you?'], partial: 'I am fine' });

  const num = C.createSegmenter({ lang: 'en-US' });
  assert.deepEqual(num.update('It grew 3.5 percent', 0).lines, [], '3.5 里的点不是句末');

  const ja = C.createSegmenter({ lang: 'ja-JP' });
  assert.deepEqual(ja.update('こんにちは。今日は', 0), { lines: ['こんにちは。'], partial: '今日は' },
    '全角句号后面不跟空格也算一句');
  console.log('✓ 句末标点后有新内容就提交');
}

/* ---- 5. 识别器改短了全文、识别器重启 ---- */
{
  const seg = C.createSegmenter({ lang: 'en-US', pauseMs: 100 });
  seg.update('I scream for', 0);
  seg.tick(500);
  assert.deepEqual(seg.update('ice', 600), { lines: [], partial: 'ice' }, '改写幅度小：退回重新显示，不吐出半截');

  // 云端识别实测：已出现的「API」被整个撤掉，接着说的话不能被吞掉开头
  const cloud = C.createSegmenter({ lang: 'ja-JP', pauseMs: 900 });
  cloud.update('送信します', 0);
  cloud.update('送信しますAPI', 100);
  assert.deepEqual(cloud.tick(1200), ['送信しますAPI']);
  assert.deepEqual(cloud.update('送信しますこのパソコンから', 1300), { lines: [], partial: 'このパソコンから' },
    '撤掉的部分之后的新内容完整保留');

  // 很靠前的改写不往回退，免得把一大段旧字幕重放一遍
  const far = C.createSegmenter({ lang: 'en-US', pauseMs: 100 });
  far.update('we went to the store and bought apples', 0);
  far.tick(500);
  assert.deepEqual(far.update('he went to the store and bought apples today', 600), { lines: [], partial: 'today' });

  const restart = C.createSegmenter({ lang: 'en-US' });
  restart.update('first part', 0);
  assert.deepEqual(restart.reset(), ['first part'], '重启前没提交的部分要提交掉');
  assert.deepEqual(restart.update('second', 100), { lines: [], partial: 'second' }, '重启后从头计数');
  assert.deepEqual(restart.reset(), ['second']);
  assert.deepEqual(restart.reset(), [], '空的时候不提交空行');
  console.log('✓ 识别器改写已提交的内容、识别器重启都能接住');
}

/* ---- 6. 模拟识别器逐词吐字：全部切完后不丢字、不重复 ---- */
for (const [lang, text, sep] of [
  ['en-US', 'The extension only sends the text you ask it to translate. Your API key never leaves this computer, and nothing is uploaded to our servers. Thanks for watching and see you next time.', ' '],
  ['ja-JP', 'この拡張機能は、翻訳を頼んだテキストだけを送信します。APIキーがこのパソコンから出ることはありません。ご視聴ありがとうございました。', ''],
]) {
  const tokens = sep ? text.split(' ') : [...text];
  const seg = C.createSegmenter({ lang, pauseMs: 900 });
  const out = [];
  let now = 0;
  for (let i = 1; i <= tokens.length; i += 1) {
    now += 120;
    const r = seg.update(tokens.slice(0, i).join(sep), now);
    out.push(...r.lines);
    out.push(...seg.tick(now));
  }
  out.push(...seg.tick(now + 1000));
  assert.equal(out.join(sep), text, `${lang}：切出来的行拼回去要与原文一致`);
  console.log(`✓ ${lang} 逐词输入切成 ${out.length} 行，拼回去与原文一致`);
}

console.log('\n全部通过');
