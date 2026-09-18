import fs from 'node:fs';
import assert from 'node:assert/strict';
const ROOT = new URL('..', import.meta.url).pathname;
const store = {};
globalThis.chrome = { storage: { local: {
  get: async (k) => (k in store ? { [k]: store[k] } : {}),
  set: async (o) => Object.assign(store, o) }}};
const load = (p) => new Function(fs.readFileSync(`${ROOT}/${p}`, 'utf8'))();
load('src/lib/lang.js'); load('src/lib/settings.js'); load('src/lib/providers.js');
const { AITrSettings: S, AITrProviders: P } = globalThis;
const settings = await S.saveSettings({ ...S.normalize(null),
  provider: 'deepseek', deepseek: { apiKey: 'sk-test', model: '', baseUrl: '' } });

/* ---- 1. 坐标归一化：模型不一定照着 0-1000 输出 ---- */
const D = (boxes, size) => P.detectScale(boxes, size);
const nb = (box, scale) => P.normalizeBox(box, scale);
const near = (a, b) => Math.abs(a - b) < 1e-6;
const ok = (b, x, y, w, h) =>
  assert.ok(near(b.x, x) && near(b.y, y) && near(b.w, w) && near(b.h, h),
    `期望 ${[x,y,w,h]}，实际 ${b && [b.x,b.y,b.w,b.h]}`);

// 制式判定按整份响应来
assert.deepEqual(D([[100,200,300,400]]), { x: 1000, y: 1000 });
assert.deepEqual(D([[0.1,0.2,0.3,0.4]]), { x: 1, y: 1 });
assert.deepEqual(D([[192,384,1800,1600]], {width:1920,height:1920}), { x: 1920, y: 1920 });
// 同一份响应里有大值，所有框都按像素算——不能逐个各判各的
const px = D([[10,10,50,50],[100,200,1800,1600]], {width:1920,height:1920});
assert.deepEqual(px, { x: 1920, y: 1920 });
ok(nb([192,384,576,768], px), 0.1, 0.2, 0.2, 0.2);
console.log('✓ 坐标制式按整份响应统一判定（0-1000 / 0-1 / 像素）');

// 关键回归：模型吐出 1001 这种毛刺，不能把整份响应判成像素
const img2048 = { width: 2048, height: 1152 };
assert.deepEqual(D([[100,200,1001,400]], img2048), { x: 1000, y: 1000 },
  '1001 更接近 1000，应按 0-1000 算，不能按图宽换算导致位置减半');
assert.deepEqual(D([[100,200,1200,400]], img2048), { x: 1000, y: 1000 },
  '1200 仍更接近 1000');
assert.deepEqual(D([[100,200,1900,1100]], img2048), { x: 2048, y: 1152 },
  '1900 更接近 2048，才是真的像素坐标');
// 图片本身不大于 1000 时，永远按 0-1000 算
assert.deepEqual(D([[100,200,1001,400]], { width: 800, height: 600 }), { x: 1000, y: 1000 });
console.log('✓ 单个越界值不会把整份响应误判成像素坐标');

/* ---- 坐标顺序：[x0,y0,x1,y1] 与 [y0,x0,y1,x1] ---- */
// 一个横向的文字条：占宽 60%、占高 3%（长图上典型的一行字）
const wide = [100, 200, 700, 230];
const asXY = nb(wide);
ok(asXY, 0.1, 0.2, 0.6, 0.03);
const asYX = P.normalizeBox(wide, { x: 1000, y: 1000 }, 'yxyx');
ok(asYX, 0.2, 0.1, 0.03, 0.6);
// 顺序搞反的后果：本该宽 60% 高 3% 的框，变成宽 3% 高 60%
assert.ok(asYX.h / asXY.h === 20 && asXY.w / asYX.w === 20,
  '顺序反了会让框「特别高特别窄」——正是长图上看到的症状');
console.log('✓ 坐标顺序可切换，且能解释「框特别高」的症状');


ok(nb([100,200,300,400]), 0.1, 0.2, 0.2, 0.2);
ok(nb([0.1,0.2,0.3,0.4], {x:1,y:1}), 0.1, 0.2, 0.2, 0.2);

let b = nb([300, 400, 100, 200]);              // 坐标顺序颠倒
ok(b, 0.1, 0.2, 0.2, 0.2);
b = nb([-50, -50, 1200, 1200]);                // 越界
ok(b, 0, 0, 1, 1);
assert.equal(nb([1, 2, 3]), null);
assert.equal(nb('nonsense'), null);
assert.equal(nb([1, 2, 'x', 4]), null);
console.log('✓ 颠倒 / 越界 / 残缺坐标都能兜住');

/* ---- 2. 识图请求与解析 ---- */
let captured;
const reply = (content) => {
  globalThis.fetch = async (url, init) => {
    captured = { url, body: JSON.parse(init.body) };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) };
  };
};

reply(JSON.stringify([
  { text: 'Hello world', box: [100, 100, 500, 200] },
  { text: 'Second line', box: [100, 300, 700, 400] },
]));
let out = await P.readImageText({
  image: 'data:image/png;base64,AAAA', settings, model: 'deepseek-flash' });
assert.equal(out.blocks.length, 2);
assert.equal(out.blocks[0].text, 'Hello world');
assert.ok(near(out.blocks[0].box.x, 0.1));
console.log('✓ 识图返回解析为 {text, box}');

// 请求体必须是 OpenAI 兼容的图文数组，且图片只在 user 消息里
const msgs = captured.body.messages;
assert.equal(msgs[0].role, 'system');
assert.equal(typeof msgs[0].content, 'string', 'system 里不能带图');
assert.ok(Array.isArray(msgs[1].content), 'user 内容应为数组');
assert.equal(msgs[1].content[0].type, 'text');
assert.equal(msgs[1].content[1].type, 'image_url');
assert.equal(msgs[1].content[1].image_url.url, 'data:image/png;base64,AAAA');
assert.equal(captured.body.model, 'deepseek-flash', '模型可被调用方覆盖');
assert.equal(captured.body.stream, false);
console.log('✓ 请求体符合 OpenAI 兼容的图片格式，模型可覆盖');

// 容忍代码块包裹和多余说明
reply('好的：\n```json\n[{"text":"A","box":[0,0,100,100]}]\n```\n以上。');
out = await P.readImageText({ image: 'x', settings, model: 'm' });
assert.equal(out.blocks.length, 1);
console.log('✓ 容忍代码块与多余说明');

// 无文字
reply('[]');
out = await P.readImageText({ image: 'x', settings, model: 'm' });
assert.deepEqual(out.blocks, []);
console.log('✓ 图中无文字返回空数组');

// 缺 box 的条目仍保留文字（坐标为 null），不能整批丢掉
reply(JSON.stringify([{ text: 'no box' }, { text: 'ok', box: [0, 0, 10, 10] }]));
out = await P.readImageText({ image: 'x', settings, model: 'm' });
assert.equal(out.blocks.length, 2);
assert.equal(out.blocks[0].box, null);
assert.ok(out.blocks[1].box);
console.log('✓ 个别条目缺坐标不影响其余结果');

// 非法回复要带上原始内容，便于排查
reply('抱歉，我看不清这张图。');
await assert.rejects(
  () => P.readImageText({ image: 'x', settings, model: 'm' }),
  (err) => { assert.match(err.message, /JSON/); assert.match(err.raw, /看不清/); return true; });
console.log('✓ 解析失败时保留模型原始回复');

/* ---- 3. 不能影响已有的文字翻译路径 ---- */
reply(JSON.stringify(['译文一', '译文二']));
const t = await P.translateBatch({ texts: ['a', 'b'], settings });
assert.deepEqual(t, ['译文一', '译文二']);
assert.equal(typeof captured.body.messages[1].content, 'string', '不带图时仍是纯字符串');
console.log('✓ 纯文字请求的格式未受影响');

// 顺序参数要能贯穿到 readImageText
reply(JSON.stringify([{ text: 'A', box: [100, 200, 700, 230] }]));
let od = await P.readImageText({ image: 'x', settings, model: 'm', order: 'yxyx' });
ok(od.blocks[0].box, 0.2, 0.1, 0.03, 0.6);
od = await P.readImageText({ image: 'x', settings, model: 'm' });
ok(od.blocks[0].box, 0.1, 0.2, 0.6, 0.03);
console.log('✓ readImageText 默认 xyxy，可显式指定 yxyx');

console.log('\n全部通过');
