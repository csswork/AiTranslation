/**
 * Chrome 内置 PDF 阅读器的外层文档：
 *   1. 告诉后台「这个标签页是不是 PDF」，右键空白处时据此切换「翻译整个 PDF」菜单项；
 *   2. 把当前 PDF 的字节交给扩展自己的翻译页（src/pdf/pdf.html）。
 *
 * 字节在这里同源取：带着页面自己的 Cookie，也优先复用浏览器刚下载过的缓存，
 * 扩展不需要额外的站点权限。只有扩展页面能用 chrome.tabs.connect 连进来，网页连不到这里。
 *
 * 独立于 content.js / elements.js / image.js：自己的事件，互不引用。
 */
(() => {
  if (window.__aiTranslationPdfLoaded) return;
  window.__aiTranslationPdfLoaded = true;

  const IS_TOP = (() => {
    try {
      return window.top === window;
    } catch {
      return false;
    }
  })();
  if (!IS_TOP) return;

  const PORT_NAME = 'ai-pdf-source';
  /** 每条消息带多少原始字节（base64 后约 1.33 倍），远低于扩展消息的 64MB 上限。 */
  const CHUNK = 4 * 1024 * 1024;
  /** 再大的文件逐页翻译也不现实，直接拒绝，让用户自己下载后拆分。 */
  const MAX_BYTES = 200 * 1024 * 1024;

  const isPdf = () => document.contentType === 'application/pdf';

  function report() {
    try {
      const promise = chrome.runtime.sendMessage({ type: 'page-kind', pdf: isPdf() });
      if (promise && typeof promise.catch === 'function') promise.catch(() => {});
    } catch {
      /* 扩展刚更新时上下文会失效，忽略即可 */
    }
  }

  report();
  // 从往返缓存恢复的页面不会重跑内容脚本，后台那边的状态要补一次
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) report();
  });

  function fileName() {
    try {
      const last = decodeURIComponent(new URL(location.href).pathname.split('/').pop() || '');
      return last || document.title || 'document.pdf';
    } catch {
      return document.title || 'document.pdf';
    }
  }

  function toBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }

  async function send(port) {
    if (!isPdf()) {
      port.postMessage({ type: 'error', code: 'not_pdf' });
      return;
    }
    const meta = { url: location.href, name: fileName() };
    let bytes;
    try {
      const response = await fetch(location.href, { credentials: 'include', cache: 'force-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch (err) {
      // file:// 等地址内容脚本取不到，交给翻译页自己再试
      port.postMessage({ type: 'error', code: 'fetch_failed', message: String(err?.message || err), ...meta });
      return;
    }
    if (bytes.length > MAX_BYTES) {
      port.postMessage({ type: 'error', code: 'too_large', size: bytes.length, ...meta });
      return;
    }
    port.postMessage({ type: 'meta', size: bytes.length, ...meta });
    for (let at = 0; at < bytes.length; at += CHUNK) {
      port.postMessage({ type: 'chunk', data: toBase64(bytes.subarray(at, at + CHUNK)) });
    }
    port.postMessage({ type: 'done' });
  }

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_NAME) return;
    let started = false;
    port.onMessage.addListener((message) => {
      if (message?.type !== 'get' || started) return;
      started = true;
      send(port).catch(() => {
        try { port.postMessage({ type: 'error', code: 'fetch_failed' }); } catch { /* 对方已关闭 */ }
      });
    });
  });
})();
