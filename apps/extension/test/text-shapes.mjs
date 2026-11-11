import fs from 'node:fs';
import assert from 'node:assert/strict';
const load = (path) => new Function(fs.readFileSync(new URL(path, import.meta.url).pathname, 'utf8'))();
load('../src/lib/image-render.js');
load('../src/lib/text-shapes.js');
const S = globalThis.AITrTextShapes;

/** 白底画布：rects 是黑色笔画（像素坐标），返回只实现 getImageData 的假 ctx。 */
function canvas(width, height, rects) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const [x, y, w, h] of rects) {
    for (let yy = y; yy < y + h; yy += 1) {
      for (let xx = x; xx < x + w; xx += 1) data.set([0, 0, 0, 255], (yy * width + xx) * 4);
    }
  }
  return {
    getImageData(x, y, w, h) {
      const out = new Uint8ClampedArray(w * h * 4);
      for (let row = 0; row < h; row += 1) out.set(data.subarray(((y + row) * width + x) * 4, ((y + row) * width + x + w) * 4), row * w * 4);
      return { data: out };
    },
  };
}

/** 一行「字」：每个字 size×size，字间距 gap。 */
const line = (x, y, count, size = 20, gap = 6) => Array.from({ length: count }, (_, i) => [x + i * (size + gap), y, size, size]);

function inside(poly, x, y) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
const inShape = (shape, x, y) => shape.polygons.some((poly) => inside(poly, x, y));

const W = 600;
const H = 400;
// 第一块：三行，长短不一（左对齐的段落），右下角空着——矩形会把空角也盖进去
const first = [...line(40, 40, 8), ...line(40, 70, 5), ...line(40, 100, 2)];
// 第二块紧挨着第一块的空角，模型给的框和第一块的框互相压住
const second = [...line(160, 105, 6), ...line(160, 135, 6)];
const ctx = canvas(W, H, [...first, ...second]);
const rel = (x, y, w, h) => ({ x: x / W, y: y / H, w: w / W, h: h / H });
const blocks = [
  // 原文的字数与图上的字数一致：字号的估计值按它算
  { text: '第'.repeat(15), box: rel(35, 35, 215, 95) },
  { text: '二'.repeat(12), box: rel(150, 95, 170, 70) },
];
const { shapes, small } = S.findShapes(ctx, W, H, blocks);
assert.equal(small, 0);
assert.equal(shapes.length, 2);
assert.deepEqual(shapes.map((s) => s.text[0]), ['第', '二']);
for (const shape of shapes) {
  assert.equal(shape.fallback, false, '读得到像素时按笔画勾形状');
  assert.equal(shape.polygons.length, 1, '同一块的几行连成一片');
  assert.ok(shape.polygons[0].length > 4, '不是矩形');
}
// 每个字的中心都在自己那块的形状里
for (const [x, y, w, h] of first) assert.ok(inShape(shapes[0], (x + w / 2) / W, (y + h / 2) / H));
for (const [x, y, w, h] of second) assert.ok(inShape(shapes[1], (x + w / 2) / W, (y + h / 2) / H));
// 两块没有重叠
for (let y = 0; y < H; y += 2) {
  for (let x = 0; x < W; x += 2) {
    assert.ok(!(inShape(shapes[0], x / W, y / H) && inShape(shapes[1], x / W, y / H)), `(${x},${y}) 同时落在两块里`);
  }
}
// 第一块右下角的空白不在形状里（矩形就会盖住）
assert.ok(!inShape(shapes[0], 140 / W, 115 / H));
console.log('✓ 按笔画勾出不规则多边形，相互压住的两块分开、不重叠');

/* ---- 小字丢掉 ---- */
const tiny = canvas(W, H, [...first, ...line(400, 300, 6, 4, 2)]);
const withTiny = S.findShapes(tiny, W, H, [blocks[0], { text: 'tiny©', box: rel(398, 298, 40, 8) }]);
assert.equal(withTiny.small, 1);
assert.deepEqual(withTiny.shapes.map((s) => s.text[0]), ['第']);
console.log('✓ 字不到图片短边 1.5% 的小字丢掉');

/* ---- 周围满是细碎纹理（树林、星空）时，字号不被拉小，正常大小的字不当小字丢掉 ---- */
{
  const specks = [];
  for (let y = 0; y < H - 2; y += 7) for (let x = 0; x < W - 2; x += 7) {
    if (x > 30 && x < 260 && y > 30 && y < 130) continue; // 对话框里是白的
    specks.push([x, y, 2, 2]);
  }
  const noisy = canvas(W, H, [...first, ...specks]);
  const found = S.findShapes(noisy, W, H, [blocks[0]]);
  assert.equal(found.small, 0, '正常大小的字不能因为周围的纹理被当成小字');
  assert.equal(found.shapes.length, 1);
  assert.equal(found.shapes[0].fallback, false, '按笔画勾形状，不退回模型的矩形');
  assert.ok(found.shapes[0].glyph * H >= 15, `字号按框里的字量：${found.shapes[0].glyph * H}`);
  for (const [x, y, w, h] of first) assert.ok(inShape(found.shapes[0], (x + w / 2) / W, (y + h / 2) / H));
  console.log('✓ 周围有细碎纹理时字号仍按框里的字量，不误判成小字');
}

/* ---- 文字框的边框不算字：铺底色不能把边框盖掉 ---- */
{
  const frame = [[30, 30, 260, 2], [30, 128, 260, 2], [30, 30, 2, 100], [288, 30, 2, 100]];
  const framed = canvas(W, H, [...first.filter(([, y]) => y < 100), ...frame]);
  const found = S.findShapes(framed, W, H, [{ text: '框'.repeat(13), box: rel(38, 38, 200, 60) }]);
  assert.equal(found.shapes.length, 1);
  const bounds = found.shapes[0].bounds;
  assert.ok(bounds.x * W > 31 && (bounds.x + bounds.w) * W < 289, `形状不含边框：${bounds.x * W}-${(bounds.x + bounds.w) * W}`);
  console.log('✓ 文字框的边框不勾进形状');
}

/* ---- 字号按行高量，对齐方式按各行的起止位置判断 ---- */
{
  // 三行左对齐、长短不一的「字」（20 像素见方），外加一列很细的注音
  const ruby = Array.from({ length: 4 }, (_, i) => [262, 40 + i * 8, 5, 5]);
  const page = canvas(W, H, [...first, ...ruby]);
  const text = '第'.repeat(15);
  const [shape] = S.findShapes(page, W, H, [{ text, box: rel(35, 35, 215, 95) }]).shapes;
  const em = shape.glyph * H;
  assert.ok(em > 18 && em < 26, `字号接近 20/0.92：${em}`);
  assert.equal(shape.lines, 3);
  assert.equal(shape.align, 'left', '各行起点对齐、终点参差：左对齐');
  assert.ok(shape.background && shape.background.r > 240, '底色取文字自己的底色');
  // 估计值：15 个字、215×95 的框
  const prior = S.priorEm(text, { x: 0, y: 0, w: 215, h: 95 });
  assert.ok(prior.em > 25 && prior.em < 40 && prior.chars === 15);
  assert.equal(S.isCjk('明日の試験'), true);
  assert.equal(S.isCjk('NOT SINCE THE STORM'), false);
  console.log('✓ 字号按行高量、对齐方式按行的起止判断、底色取文字自己的');
}

/* ---- 文字的气泡跨在两种底色上：气泡外面的色块不勾进形状 ---- */
{
  const data = (() => {
    const c = canvas(W, H, []);
    return c;
  })();
  // 下半张图是深色的「草地」，白色气泡（矩形）压在分界线上，字在气泡里
  const raw = new Uint8ClampedArray(W * H * 4).fill(255);
  const paint = (x0, y0, w, h, v) => { for (let y = y0; y < y0 + h; y += 1) for (let x = x0; x < x0 + w; x += 1) raw.set([v[0], v[1], v[2], 255], (y * W + x) * 4); };
  paint(0, 200, W, 200, [90, 140, 80]);
  paint(100, 150, 300, 110, [255, 255, 255]);
  for (const [x, y, w, h] of line(130, 180, 9)) paint(x, y, w, h, [0, 0, 0]);
  for (const [x, y, w, h] of line(130, 212, 6)) paint(x, y, w, h, [0, 0, 0]);
  const ctx2 = { getImageData(x, y, w, h) { const out = new Uint8ClampedArray(w * h * 4); for (let r = 0; r < h; r += 1) out.set(raw.subarray(((y + r) * W + x) * 4, ((y + r) * W + x + w) * 4), r * w * 4); return { data: out }; } };
  const [shape] = S.findShapes(ctx2, W, H, [{ text: '字'.repeat(15), box: rel(120, 170, 250, 70) }]).shapes;
  assert.equal(shape.fallback, false);
  const b = shape.bounds;
  assert.ok(b.x * W >= 100 && (b.x + b.w) * W <= 400 && b.y * H >= 150 && (b.y + b.h) * H <= 260, `形状留在气泡里：${[b.x * W, b.y * H, b.w * W, b.h * H].map(Math.round)}`);
  assert.ok(shape.background.r > 240 && shape.background.g > 240, '底色是气泡的白色，不是草地的颜色');
  console.log('✓ 气泡跨在两种底色上时形状不漏到气泡外，底色取气泡里的');
}

/* ---- 读不到像素：退回模型的矩形，重叠部分仍然分清归属 ---- */
const blind = S.findShapes(null, W, H, blocks);
assert.equal(blind.shapes.length, 2);
assert.ok(blind.shapes.every((s) => s.fallback));
for (let y = 0; y < H; y += 2) {
  for (let x = 0; x < W; x += 2) {
    assert.ok(!(inShape(blind.shapes[0], x / W, y / H) && inShape(blind.shapes[1], x / W, y / H)));
  }
}
console.log('✓ 跨域读不到像素时退回矩形，重叠部分按就近归属');

/* ---- 轮廓：L 形的格子勾出六个角 ---- */
const loop = S.outline([0, 0, 1, 0, 0, 1]);
assert.equal(S.simplify(loop, 0).length, 6);
console.log('✓ 格子轮廓与简化');

console.log('\n全部通过');
