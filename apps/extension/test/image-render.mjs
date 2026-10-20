import fs from 'node:fs';
import assert from 'node:assert/strict';
new Function(fs.readFileSync(new URL('../src/lib/image-render.js', import.meta.url).pathname, 'utf8'))();
const R = globalThis.AITrImageRender;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

/* ---- 1. 文字颜色随背景取对比度高的那个 ---- */
assert.equal(R.textColorFor({ r: 255, g: 255, b: 255 }), '#111111');
assert.equal(R.textColorFor({ r: 250, g: 230, b: 120 }), '#111111', '浅黄底用黑字');
assert.equal(R.textColorFor({ r: 20, g: 30, b: 60 }), '#ffffff');
assert.equal(R.textColorFor({ r: 200, g: 30, b: 30 }), '#ffffff', '红底用白字');
console.log('✓ 文字颜色按 WCAG 对比度在黑白里选');

/* ---- 2. 背景选项 ---- */
const sky = { r: 120, g: 180, b: 230 };
assert.deepEqual(R.paint('auto', '', sky), { bg: '#78b4e6', fg: '#111111' }, '自动用采到的相近色');
assert.deepEqual(R.paint('auto', '', null), R.DARK, '采不到颜色（跨域）退回深色半透明');
assert.deepEqual(R.paint('dark', '', sky), R.DARK);
assert.deepEqual(R.paint('white', '', sky), { bg: '#ffffff', fg: '#111111' });
assert.deepEqual(R.paint('black', '', sky), { bg: '#000000', fg: '#ffffff' });
assert.deepEqual(R.paint('custom', '#FFCC00', sky), { bg: '#ffcc00', fg: '#111111' });
assert.deepEqual(R.paint('custom', 'nonsense', sky).bg, '#ffffff', '自定义颜色不合法时用白色');
console.log('✓ 背景选项：相近色 / 深色半透明 / 白 / 黑 / 自定义');

/* ---- 3. 相近色：取外沿像素的众数，不被文字笔画和噪点带偏 ---- */
const strip = (pixels) => {
  const data = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([r, g, b, a = 255], i) => data.set([r, g, b, a], i * 4));
  return { data };
};
const bg = [245, 240, 230];
const noisy = [];
for (let i = 0; i < 200; i += 1) {
  if (i % 10 === 0) noisy.push([20, 20, 20]);          // 压到外沿的笔画
  else if (i % 7 === 0) noisy.push([bg[0] - 6, bg[1] - 3, bg[2] + 4]); // 轻微噪点
  else noisy.push(bg);
}
const c = R.dominantColor([strip(noisy)]);
assert.ok(Math.abs(c.r - bg[0]) < 4 && Math.abs(c.g - bg[1]) < 4 && Math.abs(c.b - bg[2]) < 4,
  `相近色应接近背景 ${bg}，实际 ${[c.r, c.g, c.b].map(Math.round)}`);
assert.equal(R.dominantColor([strip([[0, 0, 0, 0], [9, 9, 9, 5]])]), null, '全透明没有颜色');
assert.equal(R.dominantColor([]), null);
console.log('✓ 相近色取外沿众数，笔画和噪点不会把颜色带偏');

/* ---- 4. 外沿像素带：只看框外，贴边时退回框内 ---- */
const strips = R.ringStrips({ x: 100, y: 50, w: 200, h: 40 }, 1000, 500);
assert.equal(strips.length, 4);
for (const s of strips) {
  const inside = s.x >= 100 && s.x + s.w <= 300 && s.y >= 50 && s.y + s.h <= 90;
  assert.ok(!inside, '采样带不能落在框内（那里是文字笔画）');
}
const edge = R.ringStrips({ x: 0, y: 0, w: 1000, h: 30 }, 1000, 500);
assert.ok(edge.length >= 1 && edge.every((s) => s.y >= 30), '贴着上边和左右边时只剩下边的外沿');
const whole = R.ringStrips({ x: 0, y: 0, w: 1000, h: 500 }, 1000, 500);
assert.ok(whole.length > 0, '选区就是整张图时退回框内一圈');
for (const s of [...strips, ...edge, ...whole]) {
  assert.ok(s.x >= 0 && s.y >= 0 && s.x + s.w <= 1000 && s.y + s.h <= 500 && s.w > 0 && s.h > 0, '不越界');
}
console.log('✓ 采样带只取框外沿，贴边时自动调整、不越界');

/* ---- 5. 遮盖范围：识别行四周放出一点，选区原样 ---- */
const natural = { w: 1000, h: 1000 };
const line = { box: { x: 0.1, y: 0.1, w: 0.3, h: 0.05 } };
const cover = R.coverBox(line, natural);
assert.ok(cover.x < 0.1 && cover.y < 0.1 && cover.x + cover.w > 0.4 && cover.y + cover.h > 0.15);
// 选区：盖住其中文字的范围，放宽一些，但不越出选区
const region = { region: 0, box: { x: 0.1, y: 0.5, w: 0.4, h: 0.3 },
  textBox: { x: 0.2, y: 0.6, w: 0.2, h: 0.08 }, fontMax: 0.034 };
const rc = R.coverBox(region, natural);
assert.ok(rc.x < 0.2 && rc.y < 0.6 && rc.x + rc.w > 0.4 && rc.y + rc.h > 0.68, '文字范围四周放宽');
assert.ok(rc.x >= 0.1 && rc.y >= 0.5 && rc.x + rc.w <= 0.5 && rc.y + rc.h <= 0.8, '不越出选区');
assert.ok(rc.w < region.box.w && rc.h < region.box.h, '不铺满整个选区（会盖住对话框描边）');
assert.equal(R.coverBox({ ...region, textBox: null }, natural), region.box, '没有文字坐标时铺满选区');
const corner = R.coverBox({ box: { x: 0, y: 0, w: 0.2, h: 0.1 } }, natural);
assert.ok(corner.x === 0 && corner.y === 0, '放大后不越过图片边缘');
console.log('✓ 遮盖范围：识别行放出一圈，选区只盖文字所在范围且不越出选区');

/* ---- 6. 排版：断行、字号二分、CJK 标点不放行首 ---- */
// 等宽假测量：每个字符宽 = 0.6 × 字号，中日文宽 = 1 × 字号
const measure = (text, size) =>
  [...text].reduce((sum, ch) => sum + (/[　-鿿＀-￯]/.test(ch) ? 1 : 0.6) * size, 0);

let layout = R.layoutText('Hello world', 1000, 40, measure);
assert.equal(layout.lines.length, 1);
assert.ok(near(layout.size, 40 / 1.2, 0.3), '一行放得下时字号只受高度限制');

layout = R.layoutText('Hello world', 1000, 40, measure, { max: 20 });
assert.equal(layout.size, 20, '字号不超过上限（选区按原文字号封顶）');

layout = R.layoutText('The quick brown fox jumps over the lazy dog', 200, 200, measure);
assert.ok(layout.lines.length > 1, '放不下时要断行');
for (const l of layout.lines) assert.ok(measure(l, layout.size) <= 200.5, `行宽超出：${l}`);
assert.ok(layout.lines.length * layout.lineHeight <= 200.5, '总高度不能超出框');
assert.equal(layout.lines.join(' '), 'The quick brown fox jumps over the lazy dog', '按词断行，不丢字');

layout = R.layoutText('这是一段比较长的中文译文，需要换行显示。', 100, 300, measure);
assert.ok(layout.lines.length > 1);
assert.equal(layout.lines.join(''), '这是一段比较长的中文译文，需要换行显示。', '中文按字断行，不丢字');
for (const l of layout.lines) assert.ok(!/^[，。]/.test(l), `标点不能出现在行首：${l}`);

layout = R.layoutText('Supercalifragilisticexpialidocious', 60, 400, measure);
assert.ok(layout.lines.length > 1, '一个词比整行还宽时按字断开');
assert.equal(layout.lines.join(''), 'Supercalifragilisticexpialidocious');

layout = R.layoutText('Way too much text for a tiny box', 10, 5, measure, { min: 6 });
assert.equal(layout.size, 6, '怎么都放不下时用最小字号（超出部分由画布裁掉）');
console.log('✓ 排版：按词/按字断行，二分字号，标点不放行首，有上下限');

/* ---- 7. 导出尺寸与文件名 ---- */
assert.deepEqual(R.exportSize(1920, 1080), { width: 1920, height: 1080 }, '正常尺寸按原图导出');
const huge = R.exportSize(800, 40000);
assert.ok(huge.height <= 16384 && near(huge.width / huge.height, 800 / 40000, 1e-3), '超长图等比缩到画布上限内');
assert.equal(R.fileName('https://cdn.example.com/a/b/poster%20v2.final.jpg?x=1', 'zh-Hans', { type: 'image/jpeg' }),
  'poster_v2.final-zh-Hans.jpg');
assert.equal(R.fileName('data:image/png;base64,AAAA', 'en', { type: 'image/png' }), 'image-en.png');
assert.equal(R.fileName('not a url', 'ja', null), 'image-ja.png');
console.log('✓ 导出尺寸有上限，文件名取原图名加目标语言');

console.log('全部通过');
