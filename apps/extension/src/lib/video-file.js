/**
 * 整份视频翻译的调度（只在 service worker 用，见 docs/extension/video-file-translation.md）。
 *
 * 右键视频 →（后台）open：把字幕浮层注入视频所在框架，发给它一个 jobId →
 * 浮层用长连接带着 jobId 连回来 → 这里请 offscreen 文档取文件、解码、识别（src/offscreen/file.js）→
 * ChatGPT（自带 Key）时由 OpenAI 转写，其余在本机识别 → 整篇一次翻译 → 带时间的字幕推给浮层。
 *
 * 视频地址只用右键菜单给的（用户点的那个视频），浮层只能凭 jobId 认领，不能自己提交网址。
 * 浮层断开（关闭、刷新、跳走）就取消这一路，连同 offscreen 里的下载与识别。
 * 不自己注册扩展事件：由后台的 onConnect / onMessage 转来（init、onConnect、onOffscreenEvent）。
 */
(() => {
  const t = (...args) => AITrI18n.t(...args);

  const PORT_NAME = 'ai-video-file';
  const OFFSCREEN_PATH = 'src/offscreen/offscreen.html';
  const CONTENT_FILES = ['src/lib/languages.js', 'src/lib/messages.js', 'src/lib/i18n.js', 'src/content/video-file.js'];
  /** 浮层注入后要在这么久内连回来认领，否则作废。 */
  const CLAIM_MS = 60_000;

  /** jobId → { jobId, tabId, frameId, srcUrl, title, incognito, port, controller, onEvent } */
  const jobs = new Map();
  let deps = { ensureOffscreen: async () => {} };

  class VideoFileError extends Error {
    constructor(message, action = null) {
      super(message);
      this.action = action;
    }
  }

  /** 能整份取下来的地址：http(s) 直链。blob:（YouTube、X 这类分段串流）、data: 等都不行。 */
  const isFileUrl = (url) => /^https?:\/\//i.test(String(url || ''));

  function init(options) {
    deps = { ...deps, ...options };
  }

  function cancel(jobId) {
    const job = jobs.get(jobId);
    if (!job) return;
    jobs.delete(jobId);
    job.controller.abort();
    chrome.runtime.sendMessage({ target: 'offscreen', type: 'video-file-stop', jobId }).catch(() => {});
  }

  /** 右键菜单「翻译这个视频」：注入浮层并登记这一路。返回 false 表示注入不了（受保护的页面等）。 */
  async function open({ tabId, frameId = 0, srcUrl = '', title = '', incognito = false }) {
    for (const job of [...jobs.values()]) if (job.tabId === tabId) cancel(job.jobId);
    try {
      await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: CONTENT_FILES });
    } catch (err) {
      console.warn("[Huaci] Could not show video translation:", err?.message);
      return false;
    }
    const jobId = crypto.randomUUID();
    const error = isFileUrl(srcUrl) ? '' : t("这个视频是分段串流播放的（如 YouTube），没法整份翻译");
    // 浮层按它记住本页已经翻好的视频：平台、目标语言或识别语言变了就重新翻
    const settings = await AITrSettings.loadSettings();
    const resultKey = [settings.provider, settings.target, settings.videoLang].join('|');
    if (!error) {
      jobs.set(jobId, { jobId, tabId, frameId, srcUrl, title: String(title || ''), incognito, port: null, controller: new AbortController(), onEvent: null });
      setTimeout(() => { if (jobs.get(jobId) && !jobs.get(jobId).port) jobs.delete(jobId); }, CLAIM_MS);
    }
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'video-file-open', jobId, srcUrl, error, resultKey }, { frameId });
    } catch (err) {
      console.warn("[Huaci] Could not reach the video overlay:", err?.message);
      jobs.delete(jobId);
      return false;
    }
    return true;
  }

  /** offscreen 报的错误代码 → 界面文案。 */
  function offscreenError({ code, detail }, langName) {
    switch (code) {
      case 'fetch-failed':
        return new VideoFileError(t("取不到这个视频文件（$1）", [detail || '?']));
      case 'too-large':
        return new VideoFileError(t("视频文件超过 $1 MB，整份翻译只支持短视频", [Math.round(Number(detail) / 1048576) || 100]));
      case 'too-long':
        return new VideoFileError(t("视频超过 $1 分钟，整份翻译只支持短视频", [Math.round(Number(detail) / 60) || 10]));
      case 'not-media':
        return new VideoFileError(t("这不是能直接下载的视频文件，没法整份翻译"));
      case 'no-audio':
        return new VideoFileError(t("这个视频没有声音"));
      case 'sr-unsupported':
        return new VideoFileError(t("当前浏览器不支持设备端语音识别。翻译平台选 ChatGPT（自带 Key）时改由 OpenAI 识别"), 'open-video-options');
      case 'pack-downloadable':
        return new VideoFileError(t("还没有下载$1的离线语言包", [langName]), 'open-video-options');
      case 'pack-downloading':
        return new VideoFileError(t("$1的离线语言包还在下载，稍后再试", [langName]), 'open-video-options');
      case 'pack-unavailable':
        return new VideoFileError(t("这台设备不支持$1的离线识别", [langName]), 'open-video-options');
      case 'sr-error':
        return new VideoFileError(t("语音识别出错（$1）", [detail || code]));
      default:
        return new VideoFileError(t("视频翻译出错：$1", [detail || code]));
    }
  }

  /** 请 offscreen 取文件、解码、识别；进度转给浮层，返回 done 事件。 */
  async function recognize(job, { mode, lang, post }) {
    await deps.ensureOffscreen();
    const { signal } = job.controller;
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      job.onEvent = (event) => {
        if (event?.type === 'progress') post({ ...event, mode });
        else if (event?.type === 'done') resolve(event);
        else if (event?.type === 'error') reject(offscreenError(event, lang.label));
      };
      chrome.runtime.sendMessage({ target: 'offscreen', type: 'video-file-start', jobId: job.jobId, url: job.srcUrl, lang: lang.id, mode })
        .catch((err) => reject(new VideoFileError(t("视频翻译出错：$1", [err?.message || err]))));
    });
  }

  async function run(job) {
    const post = (message) => {
      try { job.port?.postMessage(message); } catch { /* 浮层已经关了 */ }
    };
    const { signal } = job.controller;
    try {
      const settings = await AITrSettings.loadSettings();
      const provider = AITrSettings.resolveProvider(settings);
      // 翻译平台是 ChatGPT 时声音交给 OpenAI 识别（自动判断语种、几秒出结果）；其余平台一律在本机识别，声音不出浏览器
      const mode = provider.id === 'openai' && provider.apiKey ? 'audio' : 'local';
      const lang = AITrSettings.videoLang(settings);
      post({ type: 'progress', phase: 'download', loaded: 0, total: 0, mode });
      const result = await recognize(job, { mode, lang, post });
      if (result.silent) { post({ type: 'done', cues: [], reason: 'silent' }); return; }

      let tokens = result.tokens || [];
      let tokensLang = result.lang || lang.id;
      if (mode === 'audio') {
        post({ type: 'progress', phase: 'recognize', mode });
        ({ tokens, lang: tokensLang } = await AITrProviders.transcribe({ audio: result.audio, settings, signal }));
      }
      if (!tokens.length) { post({ type: 'done', cues: [], reason: 'no-speech' }); return; }

      post({ type: 'progress', phase: 'translate', mode });
      const cues = await AITrProviders.translateTranscript({
        tokens, lang: tokensLang, duration: result.duration, title: job.title, settings, signal, incognito: job.incognito,
      });
      post({ type: 'done', cues });
    } catch (err) {
      if (signal.aborted || err?.name === 'AbortError') return;
      post({ type: 'error', message: String(err?.message || err) || t("视频翻译出错：$1", ['?']), action: err?.action || null });
    } finally {
      if (jobs.get(job.jobId) === job) jobs.delete(job.jobId);
    }
  }

  /** 浮层连回来认领（由后台的 onConnect 转来）：只认同一标签页、同一框架、还没被认领的 jobId。 */
  function onConnect(port) {
    if (port.name !== PORT_NAME) return;
    const tabId = port.sender?.tab?.id;
    const frameId = port.sender?.frameId ?? 0;
    let claimed = null;
    port.onMessage.addListener((message) => {
      if (claimed || message?.type !== 'start') return;
      const job = jobs.get(message.jobId);
      if (!job || job.port || job.tabId !== tabId || job.frameId !== frameId) {
        try { port.postMessage({ type: 'error', message: t("视频翻译已失效，请重新右键视频") }); } catch { /* 已断开 */ }
        return;
      }
      claimed = job;
      job.port = port;
      run(job);
    });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      if (claimed) cancel(claimed.jobId);
    });
  }

  /** offscreen 的进度与结果（由后台的 onMessage 转来）：只认扩展自己的 offscreen 文档。 */
  function onOffscreenEvent(message, sender) {
    if (sender.id !== chrome.runtime.id || sender.tab || !String(sender.url || '').startsWith(chrome.runtime.getURL(OFFSCREEN_PATH))) return;
    jobs.get(message.jobId)?.onEvent?.(message.event);
  }

  globalThis.AITrVideoFile = { init, open, cancel, onConnect, onOffscreenEvent, isFileUrl, offscreenError, PORT_NAME };
})();
