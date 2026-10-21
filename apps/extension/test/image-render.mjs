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
// AI 分出的段（不在选区里）：按行高放宽，但不越出图片
const para = { box: { x: 0, y: 0.2, w: 0.4, h: 0.1 }, textBox: { x: 0, y: 0.2, w: 0.4, h: 0.1 }, fontMax: 0.04 };
const pc = R.coverBox(para, natural);
assert.ok(pc.x === 0 && pc.y < 0.2 && pc.y + pc.h > 0.3 && pc.x + pc.w > 0.4);
assert.ok(near(0.2 - pc.y, 0.04 * 0.3), '段按行高的三成放宽');
console.log('✓ 遮盖范围：识别行放出一圈，选区只盖文字所在范围且不越出选区，AI 段按行高放宽');

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
layout = R.layoutText('苹果是“一个”，胡萝卜是“一根”', 80, 300, measure);
for (const l of layout.lines) assert.ok(!/^[”，]/.test(l), `右引号不能出现在行首：${l}`);
for (const l of layout.lines) assert.ok(!/“$/.test(l), `左引号不能留在行尾：${l}`);
assert.equal(layout.lines.join(''), '苹果是“一个”，胡萝卜是“一根”', '挪动引号不丢字');

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

/* ---- 8. 按笔画校正：找出真实的文字范围，不被描边、画面和偏掉的框带歪 ---- */
const canvasOf = (w, h) => {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  const dot = (x, y, c = 0) => { if (x >= 0 && y >= 0 && x < w && y < h) data.set([c, c, c, 255], (y * w + x) * 4); };
  const rect = (x0, y0, rw, rh, c = 0) => { for (let y = y0; y < y0 + rh; y += 1) for (let x = x0; x < x0 + rw; x += 1) dot(x, y, c); };
  return { data, dot, rect };
};
// 220×220 的窗口：一圈对话框描边，里面两列竖排的字，每个字 14×14、行距 6
const bubble = canvasOf(220, 220);
for (let a = 0; a < Math.PI * 2; a += 0.002) {
  for (let r = 98; r < 101; r += 1) bubble.dot(Math.round(110 + r * Math.cos(a)), Math.round(110 + r * Math.sin(a)));
}
for (const x of [116, 90]) for (let y = 60; y < 150; y += 20) bubble.rect(x, y, 14, 14);
// 模型给的框偏左上，只罩住大半的字（补成正方形送检后常见的误差）
let found = R.inkBox(bubble.data, 220, 220, { x: 80, y: 55, w: 45, h: 85 });
assert.ok(found, '应找到文字');
assert.ok(Math.abs(found.x - 90) <= 2 && Math.abs(found.x + found.w - 130) <= 2, `横向应正好包住两列：${found.x}..${found.x + found.w}`);
assert.ok(Math.abs(found.y - 60) <= 2 && Math.abs(found.y + found.h - 154) <= 2, `纵向应包住整列：${found.y}..${found.y + found.h}`);
assert.ok(Math.abs(found.glyph - 14) <= 2, '估出单个字的尺寸');

// 画面从窗口边上伸进来（人物的头发）：不算文字
const art = canvasOf(220, 220);
for (const x of [116, 90]) for (let y = 60; y < 150; y += 20) art.rect(x, y, 14, 14);
art.rect(170, 0, 50, 220, 40);
found = R.inkBox(art.data, 220, 220, { x: 80, y: 50, w: 140, h: 120 });
assert.ok(found.x + found.w <= 134, '碰到窗口边缘的大块画面不算进来');

// 用户贴着字画的框：碰边的小字照样算
const tight = canvasOf(60, 40);
tight.rect(0, 5, 12, 12); tight.rect(16, 5, 12, 12); tight.rect(32, 5, 12, 12); tight.rect(48, 5, 12, 12);
found = R.inkBox(tight.data, 60, 40, { x: 0, y: 0, w: 60, h: 40 });
assert.ok(found && found.x === 0 && found.x + found.w >= 59, '贴边的字不能被当成画面丢掉');

// 离得很远的别的文字不并进来
const two = canvasOf(300, 120);
two.rect(20, 20, 14, 14); two.rect(40, 20, 14, 14);
two.rect(250, 90, 14, 14);
found = R.inkBox(two.data, 300, 120, { x: 15, y: 15, w: 45, h: 25 });
assert.ok(found.x + found.w < 100, '远处的另一段文字不并进来');

assert.equal(R.inkBox(canvasOf(100, 100).data, 100, 100, { x: 10, y: 10, w: 50, h: 50 }), null, '空白处没有笔画');

// 字旁边紧挨着人物的头（不碰窗口边缘的大块画面）、白板上圈字的圆：都不算文字
const head = canvasOf(260, 200);
for (const x of [40, 64]) for (let y = 30; y < 130; y += 20) head.rect(x, y, 14, 14);
head.rect(95, 60, 90, 90, 60);
for (let a = 0; a < Math.PI * 2; a += 0.004) head.dot(Math.round(225 + 22 * Math.cos(a)), Math.round(40 + 22 * Math.sin(a)));
found = R.inkBox(head.data, 260, 200, { x: 30, y: 20, w: 60, h: 120 });
assert.ok(found.x + found.w <= 82 && found.y + found.h <= 128, `只包住两列字：${found.x},${found.y} ${found.w}×${found.h}`);
assert.ok(Math.abs(found.glyph - 14) <= 2, '字号按字估，不被圆圈和画面带大');

// 白板上的标签旁边是彩色插画（蓝色的河）：颜色不同，不并进来
const board = canvasOf(200, 120);
const blue = (x, y, w, h) => { for (let yy = y; yy < y + h; yy += 1) for (let xx = x; xx < x + w; xx += 1) board.data.set([60, 140, 230, 255], (yy * 200 + xx) * 4); };
board.rect(20, 40, 14, 14);
for (let i = 0; i < 8; i += 1) blue(44 + i * 12, 30 + (i % 3) * 8, 8, 3);
found = R.inkBox(board.data, 200, 120, { x: 15, y: 35, w: 30, h: 25 });
assert.ok(found.x + found.w <= 40, `只包住黑色的字：${found.x}..${found.x + found.w}`);

// 心里话两侧的波浪线：细长的线条不算文字
const thought = canvasOf(200, 200);
for (const x of [80, 104]) for (let y = 40; y < 140; y += 20) thought.rect(x, y, 14, 14);
for (let y = 20; y < 180; y += 1) thought.rect(Math.round(60 + 4 * Math.sin(y / 8)), y, 3, 1);
found = R.inkBox(thought.data, 200, 200, { x: 70, y: 30, w: 60, h: 120 });
assert.ok(found.x >= 76 && found.y >= 36 && found.y + found.h <= 144, `波浪线不并进来：${found.x},${found.y} ${found.w}×${found.h}`);
console.log('✓ 按笔画校正：偏掉的框也能找回整段文字，描边、画面和远处的字不算进来');

/* ---- 9. 圆形选区：只在圆内找字，文字排进内接矩形，预览也裁成圆 ---- */
const circle = { region: 0, shape: 'ellipse', box: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } };
const inner = R.textArea(circle, circle.box);
assert.ok(near(inner.w, 0.8 * Math.SQRT1_2) && near(inner.x + inner.w / 2, 0.5), '遮盖铺满选区时，文字排在内接矩形里');
assert.deepEqual(R.textArea({ ...circle, shape: undefined }, circle.box), circle.box, '矩形选区就是遮盖范围本身');
const small = { x: 0.45, y: 0.45, w: 0.1, h: 0.1 };
const kept = R.textArea(circle, small);
assert.ok(['x', 'y', 'w', 'h'].every((k) => near(kept[k], small[k])), '遮盖范围已在圆内时不变');
const shaped = R.overlayShape(circle, circle.box, { w: 200, h: 200 });
assert.equal(shaped.clipPath, 'ellipse(50.000% 50.000% at 50.000% 50.000%)');
assert.ok(/^\d/.test(shaped.padding) && shaped.padding.split(' ').length === 4);
assert.equal(R.overlayShape({ ...circle, shape: undefined }, circle.box, { w: 200, h: 200 }), null);

// 圆内两个字、外接框角落里还有一个字（圆外）：只认圆内的
const disk = canvasOf(200, 200);
disk.rect(84, 92, 14, 14); disk.rect(102, 92, 14, 14);
disk.rect(6, 6, 14, 14);
const ctxOf = (img, w) => ({ getImageData: (x, y, gw, gh) => {
  const data = new Uint8ClampedArray(gw * gh * 4);
  for (let row = 0; row < gh; row += 1) data.set(img.data.subarray(((y + row) * w + x) * 4, ((y + row) * w + x + gw) * 4), row * gw * 4);
  return { data };
} });
const diskRegion = { region: 0, shape: 'ellipse', box: { x: 0, y: 0, w: 1, h: 1 } };
const refined = R.refineCover(ctxOf(disk, 200), 200, 200, diskRegion);
assert.ok(refined && refined.cover.x * 200 > 60, `圆外角落里的字不算：从 ${refined && (refined.cover.x * 200).toFixed(0)} 开始`);
const asRect = R.refineCover(ctxOf(disk, 200), 200, 200, { ...diskRegion, shape: undefined });
assert.ok(asRect.cover.x * 200 < 10, '同样的位置换成矩形选区就会算进来');
console.log('✓ 圆形选区：只在圆内找字，文字排进内接矩形，预览裁成圆');

console.log('全部通过');
