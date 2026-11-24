/** 图片翻译取图（src/lib/image-fetch.js）：只交出公开的位图，不带 Cookie 与 Referer。 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
new Function(fs.readFileSync(new URL('../src/lib/image-fetch.js', import.meta.url).pathname, 'utf8'))();
const F = globalThis.AITrImageFetch;

const bytes = (...parts) => new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));
const WEBP = bytes('RIFF', [1, 2, 3, 4], 'WEBPVP8 ', [9, 9]);
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0], 'JFIF');

/* ---- 1. 按文件头认格式 ---- */
assert.equal(F.sniff(JPEG), 'image/jpeg');
assert.equal(F.sniff(bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a])), 'image/png');
assert.equal(F.sniff(bytes('GIF89a')), 'image/gif');
assert.equal(F.sniff(WEBP), 'image/webp');
assert.equal(F.sniff(bytes([0, 0, 0, 0x1c], 'ftypavif')), 'image/avif');
assert.equal(F.sniff(bytes('<!doctype html>')), null);
assert.equal(F.sniff(bytes('{"user":1}')), null);
assert.equal(F.sniff(bytes('<svg xmlns="http://www.w3.org/2000/svg"/>')), null, 'SVG 不交出（可能带脚本，也解不成位图）');
console.log('✓ 只认常见位图的文件头');

/* ---- 2. 请求方式：不带 Cookie、不带 Referer ---- */
function fakeFetch(body, { status = 200, headers = {} } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name) => headers[name.toLowerCase()] ?? null },
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    };
  };
  fn.calls = calls;
  return fn;
}

const ok = fakeFetch(WEBP, { headers: { 'content-type': 'image/webp' } });
const got = await F.fetchImage('https://img-9gag-fun.9cache.com/photo/a_460swp.webp', { fetch: ok });
assert.equal(got.type, 'image/webp');
assert.deepEqual(new Uint8Array(Buffer.from(got.data, 'base64')), WEBP);
assert.equal(ok.calls[0].init.credentials, 'omit');
assert.equal(ok.calls[0].init.referrerPolicy, 'no-referrer');
console.log('✓ 取回字节转成 base64，请求不带 Cookie 与 Referer');

/* ---- 3. 拒绝的情况 ---- */
const never = fakeFetch(JPEG);
for (const url of ['file:///etc/passwd', 'chrome://settings', 'javascript:alert(1)', 'data:image/png;base64,AA', 'not a url']) {
  await assert.rejects(F.fetchImage(url, { fetch: never }), /Bad image URL/, url);
}
assert.equal(never.calls.length, 0, '非 http(s) 地址不发请求');
await assert.rejects(F.fetchImage('https://a.example/x', { fetch: fakeFetch(bytes('<html>'), { headers: { 'content-type': 'image/png' } }) }), /Not an image/,
  '声明是图片但内容不是，也不交出');
await assert.rejects(F.fetchImage('https://a.example/x', { fetch: fakeFetch(JPEG, { status: 403 }) }), /403/);
await assert.rejects(F.fetchImage('https://a.example/x', { fetch: fakeFetch(JPEG, { headers: { 'content-length': String(F.MAX_BYTES + 1) } }) }), /too large/);
console.log('✓ 非 http(s)、非位图、请求失败、过大都拒绝');
