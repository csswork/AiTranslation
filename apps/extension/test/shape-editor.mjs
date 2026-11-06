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

console.log('\n全部通过');
