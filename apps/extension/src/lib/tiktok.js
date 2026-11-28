/**
 * TikTok 视频的整份翻译入口（见 docs/extension/video-file-translation.md「TikTok」）。
 *
 * TikTok 拦掉了视频上的右键（弹它自己的菜单），播放器的地址又是 blob:（分段串流），右键菜单这条路走不通。
 * 视频详情页（/@用户/video/数字）的页面数据里有这个视频的 MP4 直链（playAddr），但它要同时带 TikTok 自己的
 * Cookie 和来自 tiktok.com 的 Referer 才给（2026-11 实测：少一样就 403，扩展后台怎么取都 403）。所以从扩展图标弹窗进入：
 *   详情页的视频 ID 取浏览器给的标签页地址；直链从页面数据里按这个 ID 找，只认 TikTok 自己的视频服务器；
 *   文件由注入那一页的脚本用页面自己的身份取（和 TikTok 播放器的请求一样，Cookie 只发给 TikTok），
 *   分块送给 offscreen 文档（src/offscreen/file.js 的 receive）。这是「取文件不带 Cookie 与 Referer」的唯一例外。
 * 推荐流（For You、探索等不是详情页的页面）：视频是滚动时另外加载的，标签页地址里也没有 ID。这时取窗口里正在播放、
 * 露出最多的那个视频，从它的播放器容器（id 为 xgwrapper-序号-视频ID）读出 ID，再在页面里取 /@/video/ID 的网页找直链。
 * ID 只当作一串数字用，直链照样只认 TikTok 的视频服务器：页面就算给错 ID，也只会翻到另一个 TikTok 视频。
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

  /** TikTok 的网页（从扩展图标进入时：详情页按地址里的 ID，其余页面取正在播放的视频）。 */
  function isPage(url) {
    try {
      const parsed = new URL(String(url || ''));
      return parsed.protocol === 'https:' && /^(www\.|m\.)?tiktok\.com$/i.test(parsed.hostname);
    } catch {
      return false;
    }
  }

  /**
   * 同一个视频的固定地址（直链带签名、会过期，不能拿来认「翻过没有」），也是「打开原网页」的链接。
   * 只由视频 ID 和作者用户名拼成，推荐流和详情页里翻的同一个视频对得上。
   */
  function canonicalUrl(id, author = '') {
    if (!/^\d{6,25}$/.test(String(id || ''))) return '';
    const user = /^[\w.]{1,40}$/.test(String(author || '')) ? author : '';
    return `https://www.tiktok.com/@${user}/video/${id}`;
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
   * 注入到 TikTok 标签页顶层框架（隔离环境）运行，返回 { id, url, title, author }，找不到视频返回 null。
   * id 给了（详情页，取自标签页地址）就找这个视频；没给（推荐流）就取窗口里正在播放、露出最多的那个，
   * 从它的播放器容器（xgwrapper-序号-视频ID）读出 ID。先在本页的页面数据里找，找不到（推荐流、站内跳转过来）
   * 就在页面里取 /@/video/ID 的网页再找。必须自成一体（会被序列化后注入），结果由后台再核对。
   */
  async function readPage(id = '') {
    if (!id) {
      const shown = (video) => {
        const r = video.getBoundingClientRect();
        const h = Math.max(0, Math.min(innerHeight, r.bottom) - Math.max(0, r.top));
        const w = Math.max(0, Math.min(innerWidth, r.right) - Math.max(0, r.left));
        return h * w;
      };
      const idOf = (video) => {
        for (let node = video; node && node !== document.body; node = node.parentElement) {
          const match = String(node.id || '').match(/^xgwrapper-\d+-(\d{6,25})$/);
          if (match) return match[1];
        }
        return '';
      };
      const best = [...document.querySelectorAll('video')]
        .map((video) => ({ id: idOf(video), score: shown(video) + (video.paused ? 0 : 1e9) }))
        .filter((item) => item.id && item.score > 0)
        .sort((a, b) => b.score - a.score)[0];
      if (!best) return null;
      id = best.id;
    }
    const pick = (text) => {
      let data;
      try { data = JSON.parse(text || ''); } catch { return null; }
      const stack = [[data, 0]];
      while (stack.length) {
        const [node, depth] = stack.pop();
        if (!node || typeof node !== 'object' || depth > 12) continue;
        if (String(node.id) === id && node.video && typeof node.video === 'object') {
          return {
            id, url: String(node.video.playAddr || node.video.downloadAddr || ''), title: String(node.desc || ''),
            author: String(node.author?.uniqueId || ''),
          };
        }
        for (const value of Object.values(node)) if (value && typeof value === 'object') stack.push([value, depth + 1]);
      }
      return null;
    };
    const SCRIPT = '__UNIVERSAL_DATA_FOR_REHYDRATION__';
    let hit = pick(document.getElementById(SCRIPT)?.textContent);
    if (!hit) {
      try {
        const html = await (await fetch(`https://www.tiktok.com/@/video/${id}`, { credentials: 'include' })).text();
        hit = pick(new DOMParser().parseFromString(html, 'text/html').getElementById(SCRIPT)?.textContent);
      } catch {
        /* 取不到就当作没找到 */
      }
    }
    return hit || { id, url: '', title: '', author: '', missing: true };
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

  globalThis.AITrTikTok = { videoId, isPage, canonicalUrl, isMediaUrl, readPage, sendFile };
})();
