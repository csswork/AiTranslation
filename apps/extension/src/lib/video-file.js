/**
 * 整份视频翻译的调度（只在 service worker 用，见 docs/extension/video-file-translation.md）。
 *
 * 右键视频 →（后台）open：把字幕浮层注入视频所在框架，发给它一个 jobId →
 * 浮层用长连接带着 jobId 连回来 → 这里请 offscreen 文档取文件、解码、识别（src/offscreen/file.js）→
 * ChatGPT（自带 Key）时由 OpenAI 转写，其余在本机识别 → 整篇一次翻译 → 带时间的字幕推给浮层，
 * 并存进视频翻译记录（lib/video-library.js，「视频翻译」页 src/videos/ 读它）。
 *
 * 本机识别要花和视频一样长的时间，所以任务不跟着浮层走：浮层关了、标签页关了、页面换了，翻译照常在后台做完。
 * 进行中和做完的提示由 lib/video-notice.js 显示在用户正在看的网页右下角（跨标签页跟着用户）和扩展图标的角标上，
 * 点开就是「视频翻译」页。只有点「取消」才停。
 * 本机识别前先判断视频说的是什么语言（不直接用设置里的语言）：判断不了就请用户选。
 * 视频地址只用右键菜单给的（用户点的那个视频），浮层只能凭 jobId 认领，不能自己提交网址。
 * 不自己注册扩展事件：由后台的 onConnect / onMessage 转来（init、onConnect、onOffscreenEvent）。
 */
(() => {
  const t = (...args) => AITrI18n.t(...args);

  const PORT_NAME = 'ai-video-file';
  const OFFSCREEN_PATH = 'src/offscreen/offscreen.html';
  const VIEWER_PATH = 'src/videos/videos.html';
  const CONTENT_FILES = ['src/lib/languages.js', 'src/lib/messages.js', 'src/lib/i18n.js', 'src/content/video-file.js'];
  /** 浮层注入后要在这么久内连回来认领，否则作废。 */
  const CLAIM_MS = 60_000;
  /** 由网页里的脚本取文件时（TikTok）的大小上限，与 offscreen 的一致。 */
  const MAX_PAGE_BYTES = 100 * 1024 * 1024;
  /** 同时在翻的视频数：设备端识别按 1 倍速跑，太多会拖慢电脑。 */
  const MAX_RUNNING = 3;

  /** jobId → { jobId, tabId, frameId, srcUrl, fileUrl, pageUrl, title, incognito, pageLang, resultKey, port, started, last, controller, onEvent } */
  const jobs = new Map();
  /** jobId → 视频旁浮层的长连接（翻完后浮层还显示字幕，所以单独记，不随任务删掉）。 */
  const overlays = new Map();
  /** 后台翻译时每隔这么久调用一次扩展接口，免得 service worker 在等大模型回复时被当作闲置停掉。 */
  const KEEPALIVE_MS = 20_000;
  const notice = () => globalThis.AITrVideoNotice;
  let deps = { ensureOffscreen: async () => {} };

  class VideoFileError extends Error {
    constructor(message, action = null) {
      super(message);
      this.action = action;
    }
  }

  /** 能整份取下来的地址：http(s) 直链。blob:（YouTube、X 这类分段串流）、data: 等都不行。 */
  const isFileUrl = (url) => /^https?:\/\//i.test(String(url || ''));
  /** 同一个视频换了平台或目标语言就要重新翻（识别语言每次先判断，不看设置）。 */
  const resultKeyOf = (settings) => [settings.provider, settings.target].join('|');
  const library = () => globalThis.AITrVideoLibrary;

  function init(options) {
    deps = { ...deps, ...options };
    notice()?.init({ overlayTab: (jobId) => overlays.get(jobId)?.sender?.tab?.id ?? null });
  }

  /** 取消一路：停掉 offscreen 里的下载与识别，删掉已经存下的视频文件。 */
  function cancel(jobId) {
    const job = jobs.get(jobId);
    if (!job) return;
    jobs.delete(jobId);
    job.controller.abort();
    notice()?.remove(jobId);
    chrome.runtime.sendMessage({ target: 'offscreen', type: 'video-file-stop', jobId }).catch(() => {});
    library()?.removeFile(jobId).catch(() => {});
  }

  /** 「视频翻译」页用：正在翻的视频、进度，以及在等用户选语言的。 */
  const running = () => [...jobs.values()].filter((job) => job.started).map((job) => ({
    id: job.jobId, title: job.title, srcUrl: job.srcUrl, pageUrl: job.pageUrl, progress: job.last, needLang: job.needLang || null,
  }));

  /**
   * 判断语言的候选，按可能性排：网页的语言、实时字幕设置里固定的语言、界面语言、英语，然后是其余语言。
   * offscreen 只取其中装了离线语言包的前几种同时听。
   */
  function candidatesFor(job, settings) {
    const S = AITrSettings;
    const all = S.videoLangList().map((item) => item.id).filter((id) => id !== 'auto');
    const first = [S.videoLangFor(job.pageLang), settings.videoLang !== 'auto' ? settings.videoLang : '',
      S.videoLangFor(chrome.i18n?.getUILanguage?.() || ''), 'en-US'];
    return [...new Set([...first.filter((id) => all.includes(id)), ...all])];
  }

  /** 后台判断 offscreen 听到的几路哪一路是真的：大模型平台请模型看，其余按识别出的词密度。 */
  async function judgeFor(job, { heard = [], at = 0 }, settings) {
    const provider = AITrSettings.resolveProvider(settings);
    if (provider.kind === 'llm' && provider.apiKey) {
      try {
        return await AITrProviders.judgeSpokenLanguage({ heard, settings, signal: job.controller.signal });
      } catch {
        if (job.controller.signal.aborted) return { lang: '', guess: '' };
      }
    }
    return { lang: AITrTranscript.judgeByDensity(heard, at), guess: '' };
  }

  /** 判断不出语言：请用户选。浮层开着就在浮层里选，否则右下角提示去「视频翻译」页选。 */
  function askLanguage(job, { installed = [], guess = '' }, post) {
    const have = new Set(installed);
    const options = AITrSettings.videoLangList().filter((item) => item.id !== 'auto')
      .map((item) => ({ id: item.id, label: item.label, installed: have.has(item.id) }))
      .sort((a, b) => Number(b.installed) - Number(a.installed));
    job.needLang = { options, guess: AITrSettings.videoLangFor(guess) };
    post({ type: 'need-lang', ...job.needLang });
    notice()?.finish(job.jobId, { tone: 'ask', heading: t("听不出视频说的是什么语言"), detail: t("点这里选一个") });
  }

  /** 用户选了语言（浮层或「视频翻译」页）：交给 offscreen 从头按它听。 */
  function chooseLanguage(jobId, lang) {
    const job = jobs.get(jobId);
    const picked = AITrSettings.videoLangById(String(lang || ''));
    if (!job?.needLang || !picked) return false;
    job.needLang = null;
    job.post?.({ type: 'progress', phase: 'recognize', mode: 'local', lang: picked.label, done: 0, total: 0 });
    chrome.runtime.sendMessage({ target: 'offscreen', type: 'video-file-lang', jobId, lang: picked.id }).catch(() => {});
    return true;
  }

  /** 打开「视频翻译」页；id 给了就直接打开那一条。 */
  function openViewer(id = '') {
    const hash = /^[\w-]{1,64}$/.test(String(id)) ? `#${id}` : '';
    return chrome.tabs.create({ url: chrome.runtime.getURL(`${VIEWER_PATH}${hash}`) });
  }

  /**
   * 右键菜单「翻译这个视频」：注入浮层，告诉它这次怎么办——已经翻过就直接给字幕；同一个视频正在翻就接上进度；
   * 否则登记新的一路，等浮层认领后开始。返回 false 表示注入不了（受保护的页面等）。
   * srcUrl 用来认「是不是同一个视频」，fileUrl 是实际去取的文件（默认就是 srcUrl；TikTok 的直链带签名会过期，
   * 所以 srcUrl 用视频详情页的固定地址，见 openTikTok）。error 给了就只在浮层里说明为什么翻不了。
   * fromPage：文件由那一页的脚本用页面自己的身份取（只有 TikTok，它的直链要带自己的 Cookie 和 Referer）。
   */
  async function open({ tabId, frameId = 0, srcUrl = '', fileUrl = '', title = '', pageUrl = '', incognito = false, error = '', fromPage = false }) {
    try {
      await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: CONTENT_FILES });
    } catch (err) {
      console.warn("[Huaci] Could not show video translation:", err?.message);
      return false;
    }
    const send = (payload) => chrome.tabs.sendMessage(tabId, { type: 'video-file-open', srcUrl, ...payload }, { frameId })
      .then(() => true, (err) => { console.warn("[Huaci] Could not reach the video overlay:", err?.message); return false; });

    if (error) return send({ jobId: '', error });
    if (!isFileUrl(srcUrl)) return send({ jobId: '', error: t("这个视频是分段串流播放的（如 YouTube），没法整份翻译") });
    if (fileUrl && !isFileUrl(fileUrl)) return send({ jobId: '', error: t("这个视频是分段串流播放的（如 YouTube），没法整份翻译") });
    const settings = await AITrSettings.loadSettings();
    const resultKey = resultKeyOf(settings);

    const done = incognito ? null : await library()?.find(srcUrl, resultKey).catch(() => null);
    if (done) return send({ jobId: '', resultKey, cues: done.cues, libraryId: done.id, warning: done.warning || '' });

    const same = [...jobs.values()].find((job) => job.srcUrl === srcUrl && job.resultKey === resultKey);
    if (same) {
      Object.assign(same, { tabId, frameId }); // 换了个页面再点：让这一页的浮层接上进度
      return send({ jobId: same.jobId, resultKey });
    }
    if ([...jobs.values()].filter((job) => job.started).length >= MAX_RUNNING) {
      return send({ jobId: '', error: t("同时最多翻译 $1 个视频，等前面的翻好再试", [MAX_RUNNING]) });
    }

    const jobId = crypto.randomUUID();
    // 识别语言选「自动」时按网页的语言（Chrome 按网页正文判断，9GAG 是 en）；判断不了就用英语
    const pageLang = await Promise.resolve().then(() => chrome.tabs.detectLanguage(tabId)).catch(() => '');
    jobs.set(jobId, {
      jobId, tabId, frameId, srcUrl, fileUrl: fileUrl || srcUrl, fromPage: Boolean(fromPage), title: String(title || ''), pageUrl: isFileUrl(pageUrl) ? pageUrl : '', incognito,
      pageLang: pageLang === 'und' ? '' : pageLang, resultKey, port: null, started: false, last: null,
      controller: new AbortController(), onEvent: null,
    });
    setTimeout(() => { if (jobs.get(jobId) && !jobs.get(jobId).started) jobs.delete(jobId); }, CLAIM_MS);
    return send({ jobId, resultKey });
  }

  /**
   * TikTok（从扩展图标弹窗进入，见 lib/tiktok.js）：详情页按标签页地址里的视频 ID，其余页面（推荐流等）取正在播放的那个；
   * 直链从页面数据里按 ID 找，只认 TikTok 自己的视频服务器；文件由那一页的脚本用页面身份取，之后和右键菜单一样整份翻译。
   */
  async function openTikTok(tabId) {
    const T = globalThis.AITrTikTok;
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab || !T?.isPage(tab.url)) return false;
    const fromUrl = T.videoId(tab.url);
    let found = null;
    try {
      [{ result: found } = {}] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func: T.readPage, args: [fromUrl] });
    } catch {
      found = null;
    }
    const id = typeof found?.id === 'string' && /^\d{6,25}$/.test(found.id) && (!fromUrl || found.id === fromUrl) ? found.id : '';
    const canonical = id ? T.canonicalUrl(id, typeof found.author === 'string' ? found.author : '') : '';
    const base = { tabId, frameId: 0, srcUrl: canonical, pageUrl: canonical, incognito: tab.incognito === true };
    if (!id) return open({ ...base, error: t("没找到正在播放的 TikTok 视频：先让要翻译的视频播放起来，或打开它的详情页") });
    const url = typeof found.url === 'string' ? found.url : '';
    const title = typeof found.title === 'string' ? found.title.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
    if (!T.isMediaUrl(url)) {
      // 找到了这个视频却没有地址：多半是图片帖；地址不是 TikTok 的视频服务器就当作没找到
      return open({ ...base, error: !found.missing && !url
        ? t("这个 TikTok 帖子没有可以整份下载的视频（可能是图片帖）")
        : t("没在这一页找到这个 TikTok 视频的文件，刷新页面后再试") });
    }
    return open({ ...base, fileUrl: url, fromPage: true, title: title || (fromUrl ? tab.title : '') || '' });
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
      case 'page-closed':
        return new VideoFileError(t("视频还没下载完，网页就关掉了，请重新打开再试"));
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
      case 'pack-none':
        return new VideoFileError(t("还没有下载任何离线语言包，没法在本机识别。到设置里下载视频常用语言的语言包"), 'open-video-options');
      case 'lang-timeout':
        return new VideoFileError(t("一直没有选视频的语言，已停止"));
      default:
        return new VideoFileError(t("视频翻译出错：$1", [detail || code]));
    }
  }

  /** 识别完翻译时大模型还觉得语言不对（判断语言时按词密度猜错、或判断本身错了）时的提醒；没问题返回空字符串。 */
  function languageWarning(check, lang) {
    const spoken = check?.lang ? AITrLanguages.match(check.lang) : null;
    const same = (a, b) => a === b || (a?.startsWith('zh') && b?.startsWith('zh'));
    const other = spoken && !same(spoken, lang.languageId);
    if (!check?.garbled && !other) return '';
    // 读不通时模型对语言的猜测靠不住（探针：日语按英语听出的乱码被猜成西班牙语），只说可能不是这种语言
    return check?.garbled
      ? t("字幕可能不对：识别结果读不通，视频说的可能不是$1", [lang.label])
      : t("字幕可能不对：视频说的像是$1，却是按$2识别的", [AITrLanguages.label(spoken), lang.label]);
  }

  /**
   * 请 offscreen 取文件、解码、识别；进度转给浮层，返回 done 事件。本机识别先判断语言（offscreen 报 judge，
   * 这里判断后回 video-file-judged）；判断不了就请用户选（need-lang → chooseLanguage → video-file-lang）。
   */
  async function recognize(job, { mode, settings, post }) {
    await deps.ensureOffscreen();
    const { signal } = job.controller;
    const label = (id) => AITrSettings.videoLangById(id)?.label || id || '';
    let heard = '';
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      job.onEvent = (event) => {
        switch (event?.type) {
          case 'progress':
            if (event.lang) heard = event.lang;
            post({ ...event, mode, lang: label(event.lang), langs: (event.langs || []).map(label) });
            break;
          case 'judge':
            judgeFor(job, event, settings).then(({ lang, guess }) => chrome.runtime.sendMessage({
              target: 'offscreen', type: 'video-file-judged', jobId: job.jobId, lang, guess,
            }).catch(() => {}));
            break;
          case 'need-lang':
            askLanguage(job, event, post);
            break;
          case 'done':
            resolve(event);
            break;
          case 'error':
            reject(offscreenError(event, label(heard)));
            break;
        }
      };
      // TikTok：offscreen 先登记等着，再注入那一页的脚本用页面自己的身份取文件、分块送过去
      const fromPage = job.fromPage ? { tabId: job.tabId, frameId: 0 } : null;
      chrome.runtime.sendMessage({
        target: 'offscreen', type: 'video-file-start', jobId: job.jobId, url: job.fileUrl || job.srcUrl, fromPage, mode, store: !job.incognito,
        candidates: candidatesFor(job, settings),
      }).then(() => {
        if (!fromPage || signal.aborted) return;
        chrome.scripting.executeScript({
          target: { tabId: fromPage.tabId, frameIds: [0] }, func: AITrTikTok.sendFile, args: [job.fileUrl, job.jobId, MAX_PAGE_BYTES],
        }).catch(() => {}); // 注入不了（页面关了）时 offscreen 等不到连接，会按取不到报错
      }).catch((err) => reject(new VideoFileError(t("视频翻译出错：$1", [err?.message || err]))));
    });
  }

  async function run(job) {
    const post = (message) => {
      if (message.type === 'progress') {
        job.last = message;
        notice()?.progress(job.jobId, message);
      }
      try { job.port?.postMessage(message); } catch { /* 浮层已经关了 */ }
    };
    job.post = post;
    const { signal } = job.controller;
    let saved = false;
    // 浮层、标签页关了也照常翻完：进度提示跟着用户换到别的网页
    notice()?.start(job.jobId, { title: job.title, incognito: job.incognito });
    const keepalive = setInterval(() => { chrome.runtime.getPlatformInfo?.().catch?.(() => {}); }, KEEPALIVE_MS);
    const finish = (card) => notice()?.finish(job.jobId, card);
    try {
      const settings = await AITrSettings.loadSettings();
      const provider = AITrSettings.resolveProvider(settings);
      // 翻译平台是 ChatGPT 时声音交给 OpenAI 识别（自动判断语种、几秒出结果）；其余平台一律在本机识别，声音不出浏览器
      const mode = provider.id === 'openai' && provider.apiKey ? 'audio' : 'local';
      post({ type: 'progress', phase: 'download', loaded: 0, total: 0, mode });
      const result = await recognize(job, { mode, settings, post });
      // 本机识别时是判断出（或用户选）的语言；OpenAI 转写时由它自己判断
      const lang = AITrSettings.videoLangById(result.lang) || AITrSettings.videoLang(settings, job.pageLang);
      const nothing = (reason, message) => {
        post({ type: 'done', cues: [], reason });
        finish({ tone: 'fail', heading: message });
      };
      if (result.silent) { nothing('silent', t("这个视频没有声音")); return; }

      let tokens = result.tokens || [];
      let tokensLang = lang.id;
      if (mode === 'audio') {
        post({ type: 'progress', phase: 'recognize', mode });
        ({ tokens, lang: tokensLang } = await AITrProviders.transcribe({ audio: result.audio, settings, signal }));
      }
      if (tokens.length < 3) { nothing('no-speech', t("没有识别到人声")); return; } // 零星几个词多半是噪声、歌声

      post({ type: 'progress', phase: 'translate', mode });
      const { cues, check, titleTr = '' } = await AITrProviders.translateTranscript({
        tokens, lang: tokensLang, heard: mode === 'local' ? lang.id : '', duration: result.duration, title: job.title, settings, signal, incognito: job.incognito,
      });
      // 本机识别要事先选对语言：选错了出来的是一串读不通的词。大模型判断出来时提醒去改（OpenAI 自己判断语种，不用提醒）
      const warning = mode === 'local' ? languageWarning(check, lang) : '';
      if (!job.incognito) {
        saved = await library()?.put({
          id: job.jobId, srcUrl: job.srcUrl, pageUrl: job.pageUrl, title: job.title, titleTr, createdAt: Date.now(),
          duration: result.duration, cues, lang: tokensLang, target: settings.target, provider: settings.provider,
          resultKey: job.resultKey, warning, size: result.size || 0,
        }).then(() => true, () => false);
      }
      post({ type: 'done', cues, warning, libraryId: saved ? job.jobId : '' });
      finish({ tone: 'done', heading: t("视频字幕已准备好"), title: titleTr, detail: saved ? t("点击观看（共 $1 句）", [cues.length]) : '' });
    } catch (err) {
      if (signal.aborted || err?.name === 'AbortError') return;
      const message = String(err?.message || err) || t("视频翻译出错：$1", ['?']);
      post({ type: 'error', message, action: err?.action || null });
      finish({ tone: 'fail', heading: t("视频没翻译成"), detail: message });
    } finally {
      clearInterval(keepalive);
      if (!saved) library()?.removeFile(job.jobId).catch(() => {});
      if (jobs.get(job.jobId) === job) jobs.delete(job.jobId);
    }
  }

  /** 浮层连回来认领（由后台的 onConnect 转来）：只认登记时的标签页与框架。浮层断开只是不再显示，翻译继续。 */
  function onConnect(port) {
    if (port.name !== PORT_NAME) return;
    const tabId = port.sender?.tab?.id;
    const frameId = port.sender?.frameId ?? 0;
    let claimed = null;
    port.onMessage.addListener((message) => {
      if (message?.type === 'cancel') {
        if (claimed) cancel(claimed.jobId);
        return;
      }
      if (message?.type === 'choose-lang') {
        if (claimed) chooseLanguage(claimed.jobId, message.lang);
        return;
      }
      if (claimed || message?.type !== 'start') return;
      const job = jobs.get(message.jobId);
      if (!job || job.tabId !== tabId || job.frameId !== frameId) {
        try { port.postMessage({ type: 'error', message: t("视频翻译已失效，请重新右键视频") }); } catch { /* 已断开 */ }
        return;
      }
      claimed = job;
      job.port = port; // 同一页再点一次、换个页面再点：新的浮层接上
      overlays.set(job.jobId, port);
      notice()?.refresh();
      if (job.last) {
        try { port.postMessage(job.last); } catch { /* 已断开 */ }
      }
      if (job.needLang) {
        try { port.postMessage({ type: 'need-lang', ...job.needLang }); } catch { /* 已断开 */ }
      }
      if (!job.started) {
        job.started = true;
        run(job);
      }
    });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      if (claimed && claimed.port === port) claimed.port = null;
      if (claimed && overlays.get(claimed.jobId) === port) {
        overlays.delete(claimed.jobId);
        notice()?.refresh(); // 浮层关了（含关掉标签页）：进度提示改到用户正在看的网页上
      }
    });
  }

  /** offscreen 的进度与结果（由后台的 onMessage 转来）：只认扩展自己的 offscreen 文档。 */
  function onOffscreenEvent(message, sender) {
    if (sender.id !== chrome.runtime.id || sender.tab || !String(sender.url || '').startsWith(chrome.runtime.getURL(OFFSCREEN_PATH))) return;
    jobs.get(message.jobId)?.onEvent?.(message.event);
  }

  globalThis.AITrVideoFile = {
    init, open, openTikTok, cancel, running, openViewer, chooseLanguage, candidatesFor, onConnect, onOffscreenEvent, isFileUrl, offscreenError, languageWarning, PORT_NAME, MAX_RUNNING,
  };
})();
