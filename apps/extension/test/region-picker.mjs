import fs from 'node:fs';
import assert from 'node:assert/strict';
new Function(fs.readFileSync(new URL('../src/lib/region-picker.js', import.meta.url).pathname, 'utf8'))();
const P = globalThis.AITrRegionPicker;
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const same = (box, x, y, w, h) =>
  assert.ok(near(box.x, x) && near(box.y, y) && near(box.w, w) && near(box.h, h), `期望 ${[x, y, w, h]}，实际 ${[box.x, box.y, box.w, box.h]}`);

/* ---- 1. 按在哪：矩形的边框一圈调整大小，里面移动 ---- */
assert.equal(P.hitMode(100, 60, 200, 120), 'move', '中间是移动');
assert.equal(P.hitMode(2, 60, 200, 120), 'w');
assert.equal(P.hitMode(198, 60, 200, 120), 'e');
assert.equal(P.hitMode(100, 3, 200, 120), 'n');
assert.equal(P.hitMode(100, 117, 200, 120), 's');
assert.equal(P.hitMode(3, 3, 200, 120), 'nw', '四角同时调两个方向');
assert.equal(P.hitMode(197, 117, 200, 120), 'se');
// 很小的框：感应宽度跟着缩，中间仍然能按住移动
assert.equal(P.hitMode(10, 10, 20, 20), 'move');
console.log('✓ 矩形：边框一圈调整大小（四角调两个方向），里面移动，小框也能移动');

/* ---- 2. 椭圆按离圆周的远近判断，沿圆周哪里都能拖 ---- */
assert.equal(P.hitMode(100, 60, 200, 120, true), 'move');
assert.equal(P.hitMode(100, 2, 200, 120, true), 'n', '顶端');
assert.equal(P.hitMode(198, 60, 200, 120, true), 'e', '右端');
// 45° 方向的圆周上：外接框的边离得远，按矩形算会当成移动
const ex = 100 + 100 * Math.SQRT1_2 - 1;
const ey = 60 + 60 * Math.SQRT1_2 - 1;
assert.equal(P.hitMode(ex, ey, 200, 120), 'move', '按矩形算是里面');
assert.equal(P.hitMode(ex, ey, 200, 120, true), 'se', '按椭圆算是圆周上，往右下调');
console.log('✓ 椭圆：沿圆周任何位置都能调整大小，方向按所在的位置');

/* ---- 3. 拖动后的位置 ---- */
const box = { x: 0.2, y: 0.3, w: 0.4, h: 0.2, shape: 'ellipse' };
same(P.adjust(box, 'move', 0.1, -0.1), 0.3, 0.2, 0.4, 0.2);
assert.equal(P.adjust(box, 'move', 0.1, 0).shape, 'ellipse', '形状不丢');
same(P.adjust(box, 'move', 0.9, 0.9), 0.6, 0.8, 0.4, 0.2, '移动不出图');
same(P.adjust(box, 'move', -0.9, -0.9), 0, 0, 0.4, 0.2);
same(P.adjust(box, 'e', 0.1, 0.5), 0.2, 0.3, 0.5, 0.2, '只动拖着的边');
same(P.adjust(box, 'nw', -0.1, -0.1), 0.1, 0.2, 0.5, 0.3);
same(P.adjust(box, 'w', 0.5, 0, { w: 0.05, h: 0.05 }), 0.55, 0.3, 0.05, 0.2, '不越过对边，留出最小尺寸');
same(P.adjust(box, 's', 0, 0.9), 0.2, 0.3, 0.4, 0.7, '调整不出图');
console.log('✓ 移动不出图、形状不丢；调整只动拖着的边，不越过对边');

console.log('全部通过');
