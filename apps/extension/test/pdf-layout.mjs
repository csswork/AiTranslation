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
    ...line('Left column text runs across this line and', { y: 100, x: 50 }),
    ...line('continues on the next line of the column', { y: 112, x: 50 }),
    ...line('Right column text runs across this line and', { y: 100, x: 320 }),
    ...line('continues on its own next line as well', { y: 112, x: 320 }),
  ]);
  assert.deepEqual(blocks.map((b) => b.text), [
    'Left column text runs across this line and continues on the next line of the column',
    'Right column text runs across this line and continues on its own next line as well',
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

/* --- 5b. 表格：pdf.js 用横跨整格的空格片段把各格连起来，必须拆开，且格子不上下合并 --- */
{
  const row = (y, cells) => cells.flatMap(([str, x, w], i) => [
    ...(i ? [{ str: ' ', x: cells[i - 1][1] + cells[i - 1][2], y, w: x - cells[i - 1][1] - cells[i - 1][2], size: 8.8 }] : []),
    { str, x, y, w, size: 8.8, hasEOL: i === cells.length - 1 },
  ]);
  const blocks = L.buildBlocks([
    ...row(80.8, [['Apr 21', 154.8, 28.6], ['Nov 21', 204, 29.4], ['Dec 21', 254.1, 30.2]]),
    ...row(96.1, [['Belgium', 46.1, 35.7], ['2.1', 165.7, 13], ['7.1', 215.8, 13]]),
    ...row(111.5, [['Germany', 46.1, 40.4], ['2.1', 165.7, 13], ['6.0', 215.8, 13]]),
    ...row(126.1, [['Estonia', 46.1, 32.5], ['1.6', 165.7, 13], ['8.6', 215.8, 13]]),
  ]);
  assert.deepEqual(blocks.map((b) => b.text), [
    'Apr 21', 'Nov 21', 'Dec 21', 'Belgium', '2.1', '7.1', 'Germany', '2.1', '6.0', 'Estonia', '1.6', '8.6',
  ]);
  assert.deepEqual(blocks.filter((b) => b.translatable).map((b) => b.text),
    ['Apr 21', 'Nov 21', 'Dec 21', 'Belgium', 'Germany', 'Estonia'], '数字格原样保留');
  assert.ok(blocks.every((b) => b.width < 60), '每格的覆盖范围只有那一格，不横跨整行');
  // 格距只有一个多字宽时，同样按格拆开
  const tight = L.buildBlocks(row(587.3, [['Apr 21', 248.1, 26.4], ['Nov 21', 284.9, 27.1], ['Dec 21', 320.9, 27.8]]));
  assert.deepEqual(tight.map((b) => b.text), ['Apr 21', 'Nov 21', 'Dec 21']);
  console.log('✓ 表格逐格成块，行列保持不变');
}

/* --- 5c. 小标题和下面的正文分开，段落最后一行之后另起一块 --- */
{
  const body = 'The euro area consists of Belgium, Germany, Estonia, Ireland, Greece and more';
  const blocks = L.buildBlocks([
    ...line('Geographical information', { y: 100, size: 10 }),
    ...line(body, { y: 112, size: 10 }),
    ...line('Luxembourg and Finland.', { y: 124, size: 10 }),
    ...line(body, { y: 136, size: 10 }),
  ]);
  assert.deepEqual(blocks.map((b) => b.text), [
    'Geographical information',
    `${body} Luxembourg and Finland.`,
    body,
  ]);
  console.log('✓ 小标题、段落结尾的短行之后另起一块');
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
