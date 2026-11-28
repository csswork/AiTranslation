/**
 * TikTok 视频的整份翻译入口（见 docs/extension/video-file-translation.md「TikTok」）。
 *
 * TikTok 拦掉了视频上的右键（弹它自己的菜单），播放器的地址又是 blob:（分段串流），右键菜单这条路走不通。
 * 视频详情页（/@用户/video/数字）的页面数据里有这个视频的 MP4 直链（playAddr），但它要同时带 TikTok 自己的
 * Cookie 和来自 tiktok.com 的 Referer 才给（2026-11 实测：少一样就 403，扩展后台怎么取都 403）。所以从扩展图标弹窗进入：
 *   视频 ID 只取浏览器给的标签页地址；直链从该页的页面数据里按这个 ID 找，只认 TikTok 自己的视频服务器；
 *   文件由注入那一页的脚本用页面自己的身份取（和 TikTok 播放器的请求一样，Cookie 只发给 TikTok），
 *   分块送给 offscreen 文档（src/offscreen/file.js 的 receive）。这是「取文件不带 Cookie 与 Referer」的唯一例外。
 * 推荐流（For You）里的视频是滚动时另外加载的，页面数据里没有，暂不支持。
 * 与 lang.js 等一样不能使用 import / export；service worker 与弹窗共用。
 */
(() => {
  if (globalThis.AITrTikTok) return;

  /** 视频详情页：https://www.tiktok.com/@用户/video/数字 → 视频 ID；不是就返回空字符串。 */
  function videoId(url) {
    let parsed;
    try { parsed = new URL(String(url || '')); } catch { return ''; }
    if (parsed.protocol !== 'https:' || !/^(www\.|m\.)?tiktok\.com$/i.test(parsed.hostname)) return '';
    return parsed.pathname.match(/^\/@[^/]+\/video\/(\d{6,25})\/?$/)?.[1] || '';
  }

  /** 同一个视频的固定地址（直链带签名、会过期，不能拿来认「翻过没有」）。 */
  function canonicalUrl(url) {
    const id = videoId(url);
    if (!id) return '';
    const parsed = new URL(url);
    return `https://www.tiktok.com${parsed.pathname.replace(/\/$/, '')}`;
  }

  /** 只认 TikTok 自己的视频服务器（如 v16-webapp-prime.tiktok.com），不认网页本身和别的网站。 */
  const MEDIA_HOSTS = /(^|\.)(tiktok\.com|tiktokcdn\.com|tiktokcdn-us\.com)$/i;
  function isMediaUrl(url) {
    let parsed;
    try { parsed = new URL(String(url || '')); } catch { return false; }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || String(url).length > 4096) return false;
    if (/^(www\.|m\.)?tiktok\.com$/i.test(parsed.hostname)) return false;
    return MEDIA_HOSTS.test(parsed.hostname);
  }

  /**
   * 注入到 TikTok 标签页顶层框架（隔离环境）运行：在页面数据里找 ID 为 id 的视频，返回 { url, title }。
   * 页面是站内跳转过来的时候，页面数据还是最初那个视频的，这时重新取一次当前网址的网页再找。
   * 必须自成一体（会被序列化后注入），结果由后台再核对。
   */
  async function readPage(id) {
    const pick = (text) => {
      let data;
      try { data = JSON.parse(text || ''); } catch { return null; }
      const stack = [[data, 0]];
      while (stack.length) {
        const [node, depth] = stack.pop();
        if (!node || typeof node !== 'object' || depth > 12) continue;
        if (String(node.id) === id && node.video && typeof node.video === 'object') {
          return { url: String(node.video.playAddr || node.video.downloadAddr || ''), title: String(node.desc || '') };
        }
        for (const value of Object.values(node)) if (value && typeof value === 'object') stack.push([value, depth + 1]);
      }
      return null;
    };
    const SCRIPT = '__UNIVERSAL_DATA_FOR_REHYDRATION__';
    let hit = pick(document.getElementById(SCRIPT)?.textContent);
    if (!hit) {
      try {
        const html = await (await fetch(location.href, { credentials: 'include' })).text();
        hit = pick(new DOMParser().parseFromString(html, 'text/html').getElementById(SCRIPT)?.textContent);
      } catch {
        /* 取不到就当作没找到 */
      }
    }
    return hit;
  }

  /**
   * 注入到 TikTok 标签页顶层框架（隔离环境）运行：用页面自己的身份取视频文件，分块（base64）经长连接送给 offscreen。
   * 只取后台核对过的地址；超过 max 字节就停。offscreen 断开（取消、出错）时停止下载。必须自成一体。
   */
  async function sendFile(url, jobId, max) {
    const CHUNK = 512 * 1024;
    const controller = new AbortController();
    let port;
    try {
      port = chrome.runtime.connect({ name: 'ai-video-bytes' });
    } catch {
      return false;
    }
    port.onDisconnect.addListener(() => controller.abort());
    const post = (message) => { try { port.postMessage(message); return true; } catch { return false; } };
    const encode = (bytes) => {
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return btoa(binary);
    };
    post({ type: 'hello', jobId });
    try {
      const response = await fetch(url, { credentials: 'include', cache: 'no-store', signal: controller.signal });
      if (!response.ok) { post({ type: 'error', status: response.status }); return false; }
      post({ type: 'meta', total: Number(response.headers.get('content-length')) || 0 });
      const reader = response.body.getReader();
      let buffer = [];
      let size = 0;
      let loaded = 0;
      const flush = () => {
        if (!size) return true;
        const bytes = new Uint8Array(size);
        let at = 0;
        for (const part of buffer) { bytes.set(part, at); at += part.length; }
        buffer = [];
        size = 0;
        return post({ type: 'chunk', data: encode(bytes) });
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        loaded += value.length;
        if (loaded > max) { reader.cancel().catch(() => {}); post({ type: 'error', status: 'too-large' }); return false; }
        buffer.push(value);
        size += value.length;
        if (size >= CHUNK && !flush()) { reader.cancel().catch(() => {}); return false; }
      }
      flush();
      post({ type: 'end' });
      return true;
    } catch (err) {
      if (!controller.signal.aborted) post({ type: 'error', status: String(err?.message || err).slice(0, 80) });
      return false;
    }
  }

  globalThis.AITrTikTok = { videoId, canonicalUrl, isMediaUrl, readPage, sendFile };
})();
