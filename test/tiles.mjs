import fs from 'node:fs';
import assert from 'node:assert/strict';
new Function(fs.readFileSync(new URL('../src/lib/tiles.js', import.meta.url).pathname,'utf8'))();
const T = globalThis.AITrTiles;

/* ---- 1. 什么时候才分块 ---- */
assert.equal(T.needsTiling(700, 4400), true);
assert.equal(T.needsTiling(700, 1000), false);
assert.equal(T.needsTiling(1920, 1080), false);
assert.equal(T.planTiles(700, 1000).length, 1, '不长的图不该被切');
console.log('✓ 只有长图才分块');

/* ---- 2. 几何切法：覆盖完整、有重叠、块数可控 ---- */
const plan = T.planTiles(700, 4400);
console.log(`  700×4400 → ${plan.length} 块，块高 ${plan[0].height}`);
assert.ok(plan.length >= 3 && plan.length <= T.MAX_TILES);
assert.equal(plan[0].top, 0, '第一块从顶开始');
assert.equal(plan[plan.length-1].top + plan[plan.length-1].height, 4400, '最后一块到底');
for (let i = 1; i < plan.length; i += 1) {
  const prevEnd = plan[i-1].top + plan[i-1].height;
  assert.ok(prevEnd > plan[i].top, `第 ${i} 块与前一块必须有重叠，否则中间会漏`);
}
// 极端长图也不会切出无数块
assert.ok(T.planTiles(700, 40000).length <= T.MAX_TILES);
console.log('✓ 覆盖完整、相邻有重叠、块数有上限');

/* ---- 3. 切缝要躲开文字（这是分块方案成败的关键） ---- */
// 造一个漫画式的墨水分布：内容带 + 空白间隙
const H = 4400, W = 700;
const ink = new Float32Array(H);
const gutters = [];
// 每 550px 一格内容，格与格之间留 60px 空白
for (let top = 0; top < H; top += 550) {
  const contentEnd = Math.min(H, top + 490);
  for (let y = top; y < contentEnd; y += 1) ink[y] = 40;   // 有内容
  for (let y = contentEnd; y < Math.min(H, top + 550); y += 1) ink[y] = 0.5; // 间隙
  if (contentEnd < H) gutters.push([contentEnd, Math.min(H, top + 550)]);
}
const refined = T.refinePlan(T.planTiles(W, H), ink, H);
const seams = refined.slice(1).map((t) => t.top);
const inGutter = (y) => gutters.some(([a, b]) => y >= a && y < b);
console.log(`  切缝位置: ${seams.join(', ')}`);
console.log(`  落在空白间隙: ${seams.map(inGutter).join(', ')}`);
assert.ok(seams.every(inGutter), '每条切缝都必须落在空白间隙里，否则会把文字拦腰截断');
assert.ok(seams.every((y) => ink[y] < 1), '切缝处墨水量必须接近 0');
console.log('✓ 切缝全部落在空白处，不会切断文字');

// 没有图像信息时原样返回，不会崩
assert.deepEqual(T.refinePlan(plan, null, H), plan);
console.log('✓ 读不到像素时退回几何切法');

/* ---- 4. 坐标合并：偏移换算 + 去重 ---- */
const p2 = [{ top: 0, height: 1000 }, { top: 900, height: 1000 }];
const merged = T.mergeBlocks([
  [{ text: 'A', box: { x: 0.1, y: 0.5, w: 0.3, h: 0.04 } }],      // 第一块正中
  [{ text: 'B', box: { x: 0.2, y: 0.5, w: 0.3, h: 0.04 } }],      // 第二块正中
], p2, 2000);
assert.equal(merged.length, 2);
// 第一块的 y=0.5 → 像素 500 → 整图 500/2000 = 0.25
assert.ok(Math.abs(merged[0].box.y - 0.25) < 1e-6, '块内坐标要按块的偏移换算到整图');
// 第二块的 y=0.5 → 900 + 500 = 1400 → 1400/2000 = 0.7
assert.ok(Math.abs(merged[1].box.y - 0.7) < 1e-6);
// 高度同样要按块高缩放
assert.ok(Math.abs(merged[0].box.h - 0.02) < 1e-6);
// x 方向不分块，原样保留
assert.equal(merged[0].box.x, 0.1);
console.log('✓ 块内坐标正确换算回整图');

// 重叠区里同一段文字被两块各识别一次 → 只保留一份
const dup = T.mergeBlocks([
  [{ text: '重叠里的字', box: { x: 0.1, y: 0.95, w: 0.3, h: 0.03 } }],  // 第一块底部
  [{ text: '重叠里的字', box: { x: 0.1, y: 0.05, w: 0.3, h: 0.03 } }],  // 第二块顶部，同一处
], p2, 2000);
assert.equal(dup.length, 1, '重叠区的重复识别要去掉');
console.log('✓ 重叠区重复识别会去重');

// 文本相同但位置相差很远的，是两处不同的字，不能误删
const far = T.mergeBlocks([
  [{ text: 'Oops!', box: { x: 0.1, y: 0.1, w: 0.2, h: 0.03 } }],
  [{ text: 'Oops!', box: { x: 0.1, y: 0.8, w: 0.2, h: 0.03 } }],
], p2, 2000);
assert.equal(far.length, 2, '不同位置的相同文字是两处，不能当重复删掉');
console.log('✓ 不同位置的相同文字不会被误删');

// 结果按从上到下排序
const sorted = T.mergeBlocks([
  [{ text: '下', box: { x: 0.1, y: 0.9, w: 0.2, h: 0.02 } },
   { text: '上', box: { x: 0.1, y: 0.1, w: 0.2, h: 0.02 } }],
  [],
], p2, 2000);
assert.deepEqual(sorted.map((b) => b.text), ['上', '下']);
console.log('✓ 合并结果按阅读顺序排列');

console.log('\n全部通过');
