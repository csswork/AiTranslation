/**
 * 图片翻译取图（只在 service worker 用）：网页上的图没有 CORS 头时，页面里读不到像素，
 * 由这里凭扩展的主机权限把图片字节取回来，交给内容脚本在本机解码。
 *
 * 内容脚本能让这里取任意网址，所以只做到「任何人在外面也能取到的公开图片」为止：
 * 不带 Cookie 与 Referer、只认常见位图格式的文件头、限制大小，不是通用代请求。
 */
(function () {
  const MAX_BYTES = 20 * 1024 * 1024;
  const TIMEOUT_MS = 20000;

  /** 按文件头认出浏览器能解码的位图格式；认不出就不交出去（HTML、JSON 等都在这里挡掉）。 */
  function sniff(bytes) {
    const at = (i, list) => list.every((b, k) => bytes[i + k] === b);
    const ascii = (i, s) => at(i, [...s].map((c) => c.charCodeAt(0)));
    if (at(0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
    if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
    if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return 'image/gif';
    if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
    if (ascii(4, 'ftyp') && (ascii(8, 'avif') || ascii(8, 'avis'))) return 'image/avif';
    if (ascii(0, 'BM')) return 'image/bmp';
    return null;
  }

  function toBase64(bytes) {
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }

  /**
   * 取回一张公开图片。成功返回 { type, data }（data 为 base64），失败抛错。
   * @param {string} url
   * @param {{fetch?: typeof fetch}} [deps] 测试时注入
   */
  async function fetchImage(url, { fetch: doFetch = globalThis.fetch } = {}) {
    let parsed;
    try { parsed = new URL(String(url)); } catch { throw new Error('Bad image URL'); }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Bad image URL');

    const response = await doFetch(parsed.href, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'force-cache',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Image request failed (${response.status})`);
    const declared = Number(response.headers.get('content-length'));
    if (declared > MAX_BYTES) throw new Error('Image too large');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > MAX_BYTES) throw new Error('Image too large');
    const type = sniff(bytes);
    if (!type) throw new Error('Not an image');
    return { type, data: toBase64(bytes) };
  }

  globalThis.AITrImageFetch = { fetchImage, sniff, MAX_BYTES };
})();
