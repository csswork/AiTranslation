/**
 * pdf.js 标准构建的兼容补丁。
 *
 * src/vendor/pdfjs/ 用的是 pdf.js 标准构建（不带 legacy 构建打包的兼容垫片），它会直接调用几项
 * 比扩展最低版本（Chrome 128）更新的内置 API。这里只在浏览器缺少时补上这几项，
 * 已有原生实现就不动。翻译页（pdf.html）先于 pdf.js 加载本文件，worker 由
 * src/pdf/worker.mjs 先导入本文件再导入 pdf.worker.mjs。
 *
 * 本文件不用 import / export，既能当普通脚本加载，也能被模块导入。
 * 升级 pdf.js 时按 docs/extension/pdf-translation.md 重新核对需要补的 API。
 */
(() => {
  'use strict';

  function define(target, name, value) {
    if (!target || typeof target[name] === 'function') return;
    Object.defineProperty(target, name, { value, writable: true, configurable: true, enumerable: false });
  }

  /* Map / WeakMap：getOrInsert、getOrInsertComputed（Chrome 145 起原生支持） */
  for (const Ctor of [globalThis.Map, globalThis.WeakMap]) {
    if (!Ctor) continue;
    define(Ctor.prototype, 'getOrInsert', function getOrInsert(key, value) {
      if (!this.has(key)) this.set(key, value);
      return this.get(key);
    });
    define(Ctor.prototype, 'getOrInsertComputed', function getOrInsertComputed(key, callback) {
      if (typeof callback !== 'function') throw new TypeError('callback is not a function');
      if (!this.has(key)) this.set(key, callback(key));
      return this.get(key);
    });
  }

  /*
   * Math.sumPrecise：pdf.js 只用它对长度、字节数这类整数求和。这里用 Neumaier
   * 补偿求和，结果与规范的精确求和在这些场景下一致；空列表按规范返回 -0。
   */
  define(Math, 'sumPrecise', function sumPrecise(items) {
    let sum = -0;
    let compensation = 0;
    let empty = true;
    for (const value of items) {
      if (typeof value !== 'number') throw new TypeError('Math.sumPrecise only accepts numbers');
      if (empty) {
        sum = value;
        empty = false;
        continue;
      }
      const next = sum + value;
      compensation += Math.abs(sum) >= Math.abs(value) ? (sum - next) + value : (value - next) + sum;
      sum = next;
    }
    return empty ? -0 : sum + compensation;
  });

  /* Uint8Array 的 Base64 / 十六进制转换（Chrome 140 起原生支持） */
  const BYTE_CHUNK = 0x8000;

  define(Uint8Array, 'fromBase64', function fromBase64(string, options = {}) {
    if (typeof string !== 'string') throw new TypeError('fromBase64 expects a string');
    let text = string.replace(/[\t\n\f\r ]/g, '');
    if (options.alphabet === 'base64url') text = text.replace(/-/g, '+').replace(/_/g, '/');
    if (/[^A-Za-z0-9+/=]/.test(text)) throw new SyntaxError('Invalid base64 string');
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  });

  define(Uint8Array.prototype, 'toBase64', function toBase64(options = {}) {
    let binary = '';
    for (let i = 0; i < this.length; i += BYTE_CHUNK) {
      binary += String.fromCharCode.apply(null, this.subarray(i, i + BYTE_CHUNK));
    }
    let text = btoa(binary);
    if (options.alphabet === 'base64url') text = text.replace(/\+/g, '-').replace(/\//g, '_');
    if (options.omitPadding) text = text.replace(/=+$/, '');
    return text;
  });

  define(Uint8Array.prototype, 'toHex', function toHex() {
    let hex = '';
    for (const byte of this) hex += byte.toString(16).padStart(2, '0');
    return hex;
  });

  /* Response / Blob 的 bytes()（Chrome 132 起原生支持），pdf.js 用它读字体与字符映射表 */
  for (const Ctor of [globalThis.Response, globalThis.Blob]) {
    if (!Ctor) continue;
    define(Ctor.prototype, 'bytes', async function bytes() {
      return new Uint8Array(await this.arrayBuffer());
    });
  }
})();
