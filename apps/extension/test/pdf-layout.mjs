import fs from 'node:fs';
import assert from 'node:assert/strict';

const ROOT = new URL('..', import.meta.url).pathname;
new Function(fs.readFileSync(`${ROOT}/src/lib/pdf-layout.js`, 'utf8'))();
const L = globalThis.AITrPdfLayout;

/** 造一行：按词拆成片段，词间不带空格（很多 PDF 就是这样输出的）。 */
function line(text, { x = 72, y, size = 10, eol = true } = {}) {
  const items = [];
  let at = x;
  for (const word of text.split(' ')) {
    const w = word.length * size * 0.5;
    items.push({ str: word, x: at, y, w, size, hasEOL: false });
    at += w + size * 0.25;
  }
  if (eol) items.push({ str: '', x: at, y, w: 0, size, hasEOL: true });
  return items;
}

/* --- 1. 片段拼成行：词间补空格，行尾 hasEOL 断行 --- */
{
  const lines = L.buildLines([...line('Hello brave world', { y: 100 }), ...line('Second line', { y: 112 })]);
  assert.deepEqual(lines.map((l) => l.text), ['Hello brave world', 'Second line']);
  console.log('✓ 片段按基线拼成行，词间补空格');
}

/* --- 2. 同一段的多行合成一块，段间空白分块，连字符接回 --- */
{
  const blocks = L.buildBlocks([
    ...line('Large language models are remark-', { y: 100 }),
    ...line('ably fluent in many languages.', { y: 112 }),
    ...line('A new paragraph after a gap.', { y: 140 }),
  ]);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].text, 'Large language models are remarkably fluent in many languages.');
  assert.equal(blocks[0].lines, 2);
  assert.equal(blocks[1].text, 'A new paragraph after a gap.');
  assert.ok(blocks[0].top < 100 && blocks[0].top + blocks[0].height > 112, '块的范围覆盖两行');
  console.log('✓ 行距内的行合成段落，段间空白分块，行尾连字符接回');
}

/* --- 3. 标题字号不同，单独成块；页码不送去翻译 --- */
{
  const blocks = L.buildBlocks([
    ...line('Chapter One', { y: 60, size: 20 }),
    ...line('Body text starts here.', { y: 90 }),
    ...line('12', { y: 760, x: 300 }),
  ]);
  assert.deepEqual(blocks.map((b) => b.text), ['Chapter One', 'Body text starts here.', '12']);
  assert.deepEqual(blocks.map((b) => b.translatable), [true, true, false]);
  console.log('✓ 字号不同分块，纯数字（页码）原样保留');
}

/* --- 4. 双栏：内容流先左栏后右栏，右栏不并进左栏 --- */
{
  const blocks = L.buildBlocks([
    ...line('Left column first line', { y: 100, x: 50 }),
    ...line('Left column second line', { y: 112, x: 50 }),
    ...line('Right column first line', { y: 100, x: 320 }),
    ...line('Right column second line', { y: 112, x: 320 }),
  ]);
  assert.deepEqual(blocks.map((b) => b.text), [
    'Left column first line Left column second line',
    'Right column first line Right column second line',
  ]);
  console.log('✓ 双栏按栏分块');
}

/* --- 5. 同一行里隔得很远的片段（表格两格）不拼在一起；旋转文字跳过 --- */
{
  const lines = L.buildLines([
    { str: 'Name', x: 50, y: 100, w: 20, size: 10 },
    { str: 'Value', x: 300, y: 100, w: 25, size: 10, hasEOL: true },
    { str: 'Sideways', x: 10, y: 400, w: 40, size: 10, rotated: true },
  ]);
  assert.deepEqual(lines.map((l) => l.text), ['Name', 'Value']);
  console.log('✓ 表格两格分开，旋转文字不参与');
}

/* --- 6. 中日韩文字跨行不补空格 --- */
{
  assert.equal(L.joinLines(['大语言模型的文笔', '非常流畅。']), '大语言模型的文笔非常流畅。');
  assert.equal(L.joinLines(['state-of-the-', 'art']), 'state-of-the-art', '连字符后是小写才去掉……');
  assert.equal(L.joinLines(['pre-', 'Trained']), 'pre- Trained', '……大写开头保留原样');
  console.log('✓ 中日韩跨行不补空格，连字符只在小写断词时接回');
}

/* --- 7. 超长段落在行边界切开，单块不超过上限 --- */
{
  const items = [];
  for (let i = 0; i < 80; i++) items.push(...line('This sentence is long enough to fill a line of text here.', { y: 100 + i * 12 }));
  const blocks = L.buildBlocks(items);
  assert.ok(blocks.length > 1);
  assert.ok(blocks.every((b) => b.text.length <= L.MAX_BLOCK_CHARS + 60));
  console.log('✓ 超长段落按行切块');
}

/* --- 8. 切批：跳过不翻译的块，按条数和字数切 --- */
{
  const blocks = [
    { text: 'a'.repeat(1500), translatable: true },
    { text: '1', translatable: false },
    { text: 'b'.repeat(1000), translatable: true },
    { text: 'c', translatable: true },
  ];
  assert.deepEqual(L.batches(blocks), [[0], [2, 3]]);
  assert.deepEqual(L.batches(blocks, { items: 1, chars: 99999 }), [[0], [2], [3]]);
  console.log('✓ 切批跳过页码等不翻译的块');
}

console.log('\n全部通过');
