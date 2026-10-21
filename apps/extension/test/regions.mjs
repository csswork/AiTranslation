import fs from 'node:fs';
import assert from 'node:assert/strict';
new Function(fs.readFileSync(new URL('../src/lib/regions.js', import.meta.url).pathname, 'utf8'))();
const G = globalThis.AITrRegions;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

/* ---- 1. 拖拽两个点得到矩形：方向无关、越界裁掉 ---- */
const r = G.rectFrom({ x: 0.6, y: 0.8 }, { x: 0.2, y: 0.3 });
assert.ok(near(r.x, 0.2) && near(r.y, 0.3) && near(r.w, 0.4) && near(r.h, 0.5));
const out = G.rectFrom({ x: -0.5, y: 0.5 }, { x: 1.5, y: 2 });
assert.deepEqual(out, { x: 0, y: 0.5, w: 1, h: 0.5 });
console.log('✓ 选区矩形与拖拽方向无关，越界部分裁掉');

/* ---- 2. 拼图：按阅读顺序排，放得下就拼在一起，太长另起一批 ---- */
const W = 1000, H = 1000;
const regions = [
  { x: 0.5, y: 0.6, w: 0.3, h: 0.1 },  // 下面的那个先画
  { x: 0.1, y: 0.1, w: 0.4, h: 0.1 },
];
let batches = G.packRegions(regions, W, H);
assert.equal(batches.length, 1, '两个扁的选区应拼成一张图，只发一次识图请求');
const [batch] = batches;
assert.deepEqual(batch.items.map((p) => p.index), [1, 0], '按从上到下的阅读顺序排');
assert.equal(batch.width, 400, '拼图宽度取最宽的选区');
assert.equal(batch.items[1].top, 100 + G.GAP, '选区之间留白');
assert.equal(batch.height, 100 + G.GAP + 100);

// 竖长的选区（漫画对话框）按行并排，而不是一个摞一个拉成长条
const tall = [0, 1, 2].map((i) => ({ x: i * 0.3, y: 0.1, w: 0.2, h: 0.25 }));
batches = G.packRegions(tall, W, H);
assert.equal(batches.length, 1, '三个对话框应拼进一张图');
const [grid] = batches;
assert.ok(grid.height <= grid.width * 1.6, `拼图不能拉成长条：${grid.width}×${grid.height}`);
assert.ok(grid.items.some((p) => p.left > 0), '应该有选区并排放在右边');
for (const a of grid.items) {
  for (const b of grid.items) {
    if (a === b) continue;
    const apart = a.left + a.sw + G.GAP <= b.left || b.left + b.sw + G.GAP <= a.left ||
      a.top + a.sh + G.GAP <= b.top || b.top + b.sh + G.GAP <= a.top;
    assert.ok(apart, '选区之间不能重叠，且要留白');
  }
}
// 总像素超出预算才另起一批
const split = G.packRegions(tall, W, H, { maxPixels: 120000 });
assert.ok(split.length >= 2, '超出像素预算另起一批');
assert.equal(split.flatMap((b) => b.items).length, 3, '分批后一个选区都不能少');
const right = grid.items.find((p) => p.left > 0);
const hit = G.unpackBlocks([{ text: 'R', box: {
  x: (right.left + 10) / grid.width, y: (right.top + 10) / grid.height,
  w: 50 / grid.width, h: 20 / grid.height } }], grid, tall);
assert.equal(hit[0].region, right.index, '并排的选区也能按位置还原');
assert.ok(near(hit[0].box.x, tall[right.index].x + 10 / W) && near(hit[0].box.y, 0.1 + 10 / H));
console.log(`✓ 选区按行拼成接近方形的一张图（3 个对话框 → ${grid.width}×${grid.height}），超预算才分批`);

/* ---- 3. 拼图上的识别结果还原回原图，留白里的丢掉 ---- */
// 拼图 400×224：上面是选区 1（0..100），下面是选区 0（124..224，宽 300）
const bw = batch.width, bh = batch.height;
const toRel = (x, y, w, h) => ({ x: x / bw, y: y / bh, w: w / bw, h: h / bh });
const blocks = G.unpackBlocks([
  { text: 'Top', box: toRel(40, 20, 200, 40) },     // 选区 1 内
  { text: 'Bottom', box: toRel(30, 150, 150, 30) },  // 选区 0 内
  { text: 'gap', box: toRel(10, 104, 50, 12) },      // 中心落在留白里
  { text: 'right', box: toRel(330, 160, 60, 20) },   // 选区 0 只有 300 宽，右侧是空白
  { text: 'nobox', box: null },
], batch, regions);
assert.deepEqual(blocks.map((b) => b.text), ['Top', 'Bottom']);
const top = blocks[0];
assert.equal(top.region, 1);
// 选区 1 在原图 (100,100) 起、400×100：拼图里 (40,20) → 原图 (140,120)
assert.ok(near(top.box.x, 0.14) && near(top.box.y, 0.12) && near(top.box.w, 0.2) && near(top.box.h, 0.04));
const bottom = blocks[1];
assert.equal(bottom.region, 0);
// 选区 0 在原图 (500,600) 起：拼图里 (30, 150-124=26) → 原图 (530, 626)
assert.ok(near(bottom.box.x, 0.53) && near(bottom.box.y, 0.626));
console.log('✓ 拼图坐标还原到原图，落在留白里的毛刺被丢掉');

/* ---- 4. 跨域退回：从整图结果里挑出落在选区里的，并裁到选区内 ---- */
const filtered = G.filterByRegions([
  { text: 'in', box: { x: 0.15, y: 0.12, w: 0.5, h: 0.05 } },  // 中心 (0.4, 0.145) 在选区 1 内，右边超出
  { text: 'out', box: { x: 0.8, y: 0.9, w: 0.1, h: 0.05 } },
], regions);
assert.deepEqual(filtered.map((b) => b.text), ['in']);
assert.equal(filtered[0].region, 1);
assert.ok(near(filtered[0].box.x + filtered[0].box.w, 0.5), '框被裁到选区右边界');
console.log('✓ 读不到像素时按中心点从整图结果里挑，框裁到选区以内');

/* ---- 5. 每个选区合成一段，保持模型给的顺序 ---- */
assert.equal(G.joinText('你好', '世界'), '你好世界', '中文之间不加空格');
assert.equal(G.joinText('Hello', 'world'), 'Hello world');
assert.equal(G.joinText('こんにちは', '世界'), 'こんにちは世界');
assert.equal(G.joinText('안녕', '하세요'), '안녕 하세요', '韩文按词分写，用空格连');
const groups = G.groupByRegion([
  // 竖排日文从右往左：模型先给右边那列，不能按 x 重排
  { text: '右の列', region: 0, box: { x: 0.7, y: 0.6, w: 0.05, h: 0.02 } },
  { text: '左の列', region: 0, box: { x: 0.6, y: 0.6, w: 0.05, h: 0.04 } },
  { text: 'HELLO', region: 1, box: { x: 0.1, y: 0.1, w: 0.2, h: 0.03 } },
  { text: 'THERE', region: 1, box: { x: 0.1, y: 0.15, w: 0.2, h: 0.03 } },
], [...regions, { x: 0.9, y: 0.9, w: 0.05, h: 0.05 }]);
assert.equal(groups.length, 2, '没有文字的选区不出现');
assert.equal(groups[0].text, '右の列左の列', '保持模型给的阅读顺序');
assert.equal(groups[1].text, 'HELLO THERE');
assert.deepEqual(groups[1].box, regions[1]);
const tb = groups[1].textBox;
assert.ok(near(tb.x, 0.1) && near(tb.y, 0.1) && near(tb.w, 0.2) && near(tb.h, 0.08), '文字范围是选区内各行的外接框');
assert.ok(near(groups[1].fontMax, 0.03), '字号上限按原文行高估算');
console.log('✓ 每个选区合成一整段翻译，顺序与模型一致');

console.log('全部通过');
