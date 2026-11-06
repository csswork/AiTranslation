import fs from 'node:fs';
import assert from 'node:assert/strict';
new Function(fs.readFileSync(new URL('../src/lib/shape-editor.js', import.meta.url).pathname, 'utf8'))();
const E = globalThis.AITrShapeEditor;
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

/* ---- 移动：整体平移，挪不出图片 ---- */
const square = [[[0.1, 0.1], [0.3, 0.1], [0.3, 0.3], [0.1, 0.3]]];
let moved = E.movePolygons(square, 0.2, 0.1);
assert.deepEqual(moved[0][0].map((v) => Math.round(v * 100) / 100), [0.3, 0.2]);
moved = E.movePolygons(square, 2, -2);
const b = E.boundsOf(moved);
assert.ok(near(b.x + b.w, 1) && near(b.y, 0), '拖到边上就停住');
console.log('✓ 形状整体移动，限制在图片以内');

/* ---- 顶点：双击边线加在最近的边上，删到三个点为止 ---- */
const poly = square[0];
const added = E.insertVertex(poly, [0.2, 0.09]);
assert.equal(added.length, 5);
assert.deepEqual(added[1].map((v) => Math.round(v * 100) / 100), [0.2, 0.1], '插在上边的投影点上');
const triangle = E.removeVertex(E.removeVertex(added, 1), 0);
assert.equal(triangle.length, 3);
assert.equal(E.removeVertex(triangle, 0).length, 3, '至少留三个点');
console.log('✓ 加顶点落在最近的边上，删顶点至少留三个');

/* ---- 新画的形状：矩形四个点，椭圆一圈点 ---- */
const rect = { x: 0.2, y: 0.2, w: 0.4, h: 0.2 };
assert.equal(E.rectPoints(rect).length, 4);
const ellipse = E.ellipsePoints(rect);
assert.equal(ellipse.length, 32);
const eb = E.boundsOf([ellipse]);
assert.ok(near(eb.x, 0.2, 1e-6) && near(eb.w, 0.4, 1e-6), '椭圆内切于拖出的范围');
console.log('✓ 新画的矩形与椭圆');

/* ---- 拖动顶点：附近的点按距离跟着动，远处不动；半径为 0 时只动一个点 ---- */
{
  // 一条横边上等距排开的点（图层 1000×1000 像素，点距 50 像素）
  const line = Array.from({ length: 9 }, (_, i) => [0.1 + i * 0.05, 0.5]);
  const out = E.dragVertex(line, 4, 0, -0.1, 120, { w: 1000, h: 1000 });
  const lift = out.map(([, y]) => Math.round((0.5 - y) * 1000) / 1000);
  assert.equal(lift[4], 0.1, '拖的那个点跟着鼠标走');
  assert.ok(lift[3] > 0 && lift[3] < 0.1 && lift[5] === lift[3], '相邻的点动一部分，左右对称');
  assert.ok(lift[3] > lift[2], '越近动得越多');
  assert.deepEqual([lift[0], lift[1], lift[7], lift[8]], [0, 0, 0, 0], '影响半径以外不动');
  const single = E.dragVertex(line, 4, 0, -0.1, 0, { w: 1000, h: 1000 });
  assert.equal(single.filter(([, y]) => y !== 0.5).length, 1, '半径为 0 只动一个点');
  assert.ok(E.dragVertex([[0.99, 0.5], [0.98, 0.5]], 0, 0.5, 0, 100, { w: 1000, h: 1000 }).every(([x]) => x <= 1), '不出图片');
  const r = E.reachFor([[0, 0], [0.4, 0], [0.4, 0.2]], { w: 1000, h: 1000 });
  assert.equal(r, 120, '半径取外接框长边的三成');
  assert.equal(E.reachFor([[0, 0], [0.01, 0], [0.01, 0.01]], { w: 1000, h: 1000 }), 24, '小形状至少 24 像素');
  console.log('✓ 拖动顶点时附近的点按距离跟着动，Alt 只动一个点');
}

console.log('\n全部通过');
