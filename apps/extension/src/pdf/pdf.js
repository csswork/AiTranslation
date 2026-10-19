/**
 * 整份 PDF 翻译页。
 *
 *   来源：内置 PDF 阅读器里右键「翻译整个 PDF」打开本页（?tab=标签页），
 *         字节向那个标签页的 src/content/pdf.js 要；也可以直接选择或拖入文件。
 *   解析：pdf.js（src/vendor/pdfjs）在本机渲染页面、提取带坐标的文字；
 *         src/lib/pdf-layout.js 把文字片段拼成段落块。
 *   翻译：按页、按批调用当前平台（含点数翻译），译文盖回原位，可与原文并排对照。
 *   下载：用浏览器打印成 PDF（译文是矢量文字，可选中、可搜索）。
 *
 * 和翻译面板一样直接在本页调接口，不经过 service worker。
 * 只有提取出的文字会发给翻译平台；文件本身不上传。
 */
(async () => {
  await AITrI18n.ready;
  const t = (...args) => AITrI18n.t(...args);
  const S = globalThis.AITrSettings;
  const P = globalThis.AITrProviders;
  const Layout = globalThis.AITrPdfLayout;

  const VENDOR = chrome.runtime.getURL('src/vendor/pdfjs/');
  const PORT_NAME = 'ai-pdf-source';
  /** 渲染倍率：屏幕看得清，打印也不糊；再按总像素封顶，免得大幅面页面吃光内存。 */
  const RENDER_SCALE = 2;
  const MAX_PIXELS = 5_000_000;
  /** 同时翻译几页。 */
  const CONCURRENCY = 2;
  /** 译文放不下时最多缩到原字号的多少。 */
  const MIN_FONT_RATIO = 0.45;

  const $ = (id) => document.getElementById(id);
  const el = {
    name: $('name'), status: $('status'), progressWrap: $('progressWrap'), progress: $('progress'),
    target: $('target'), provider: $('provider'), run: $('run'), download: $('download'), settings: $('settings'),
    error: $('error'), errorText: $('errorText'),
    empty: $('empty'), drop: $('drop'), file: $('file'), emptyNote: $('emptyNote'),
    pages: $('pages'), pageSize: $('pageSize'),
  };
  const label = (id) => AITrLanguages.label(id);

  let pdfjs = null;
  let doc = null;
  let fileName = '';
  let pages = [];
  let settings = S.normalize(null);
  let target = settings.target;
  let mode = 'compare';
  let runController = null;
  let started = false;
  let renderChain = Promise.resolve();
  let observer = null;
  let loadToken = 0;

  /* ---------------------------------------------------------------- 状态 */

  function setStatus(text) {
    el.status.textContent = text || '';
  }

  function setProgress(ratio) {
    el.progressWrap.hidden = ratio == null;
    if (ratio != null) el.progress.style.width = `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
  }

  function showError(message, action) {
    el.error.hidden = false;
    el.errorText.textContent = message || t("翻译失败");
    el.error.querySelectorAll('button').forEach((node) => node.remove());
    if (action === 'open-options') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn ghost small';
      button.textContent = t("打开设置");
      button.addEventListener('click', () => chrome.runtime.openOptionsPage());
      el.error.appendChild(button);
    }
  }

  function hideError() {
    el.error.hidden = true;
  }

  const doneCount = () => pages.filter((page) => page.status === 'done').length;

  function renderProgress() {
    if (!doc) return;
    const done = doneCount();
    if (runController) {
      setStatus(t("正在翻译：$1/$2 页", [done, pages.length]));
      setProgress(done / pages.length);
    } else if (done === pages.length) {
      setStatus(t("已翻译全部 $1 页 · $2", [pages.length, label(target)]));
      setProgress(null);
    } else if (started) {
      setStatus(t("已停止：$1/$2 页已翻译", [done, pages.length]));
      setProgress(done / pages.length);
    } else {
      setStatus(t("共 $1 页", [pages.length]));
      setProgress(null);
    }
  }

  function renderButtons() {
    const busy = Boolean(runController);
    el.run.disabled = !doc || (!busy && doneCount() === pages.length); // 全部翻完就没什么可开始的
    el.run.textContent = busy ? t("停止") : started && doneCount() < pages.length ? t("继续翻译") : t("开始翻译");
    el.download.disabled = !doc;
  }

  /* ---------------------------------------------------------------- 读取 */

  function decodeBase64(data) {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  /** 向打开这份 PDF 的标签页要字节（同源取，带着站点 Cookie）。 */
  function fromTab(tabId) {
    return new Promise((resolve, reject) => {
      let port;
      try {
        port = chrome.tabs.connect(tabId, { name: PORT_NAME, frameId: 0 });
      } catch (err) {
        reject(err);
        return;
      }
      const parts = [];
      let meta = null;
      let received = 0;
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        try { port.disconnect(); } catch { /* 已断开 */ }
        fn(value);
      };
      port.onMessage.addListener((message) => {
        if (message?.type === 'meta') {
          meta = message;
        } else if (message?.type === 'chunk') {
          const bytes = decodeBase64(message.data);
          parts.push(bytes);
          received += bytes.length;
          if (meta?.size) setStatus(t("正在读取 PDF… $1%", [Math.round((received / meta.size) * 100)]));
        } else if (message?.type === 'done') {
          const bytes = new Uint8Array(received);
          let at = 0;
          for (const part of parts) { bytes.set(part, at); at += part.length; }
          finish(resolve, { bytes, name: meta?.name || '', url: meta?.url || '' });
        } else if (message?.type === 'error') {
          const err = new Error(message.message || message.code);
          Object.assign(err, { code: message.code, url: message.url, fileName: message.name, size: message.size });
          finish(reject, err);
        }
      });
      port.onDisconnect.addListener(() => {
        void chrome.runtime.lastError; // 标签页已关闭或没有内容脚本
        finish(reject, Object.assign(new Error('disconnected'), { code: 'disconnected' }));
      });
      port.postMessage({ type: 'get' });
    });
  }

  /** 内容脚本取不到时（file:// 等）由本页自己再试一次。 */
  async function fromUrl(url) {
    if (url.startsWith('file:')) {
      // fetch 不支持 file:，扩展页面在用户允许「访问文件网址」后可以用 XHR 读取
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url);
        xhr.responseType = 'arraybuffer';
        xhr.onload = () => (xhr.response?.byteLength ? resolve(new Uint8Array(xhr.response)) : reject(new Error('empty')));
        xhr.onerror = () => reject(new Error('file'));
        xhr.send();
      });
    }
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  function nameFromUrl(url) {
    try {
      return decodeURIComponent(new URL(url).pathname.split('/').pop() || '') || 'document.pdf';
    } catch {
      return 'document.pdf';
    }
  }

  function showEmpty(note) {
    el.empty.hidden = false;
    el.emptyNote.textContent = note || t("文件只在本机解析，只有提取出的文字会发给你选择的翻译平台。");
  }

  /* ---------------------------------------------------------------- 解析 */

  async function loadPdfjs() {
    if (pdfjs) return pdfjs;
    pdfjs = await import(`${VENDOR}pdf.min.mjs`);
    pdfjs.GlobalWorkerOptions.workerSrc = `${VENDOR}pdf.worker.min.mjs`;
    return pdfjs;
  }

  function reset() {
    runController?.abort();
    runController = null;
    started = false;
    observer?.disconnect();
    for (const page of pages) if (page.image) URL.revokeObjectURL(page.image);
    pages = [];
    el.pages.replaceChildren();
    renderChain = Promise.resolve();
    const old = doc;
    doc = null;
    old?.destroy().catch(() => {});
  }

  async function open(bytes, name) {
    const token = ++loadToken;
    reset();
    hideError();
    el.empty.hidden = true;
    fileName = name || 'document.pdf';
    el.name.textContent = fileName;
    document.title = `${fileName} · ${t("翻译 PDF")}`;
    setStatus(t("正在解析 PDF…"));
    renderButtons();
    let loaded;
    try {
      const lib = await loadPdfjs();
      loaded = await lib.getDocument({
        data: bytes,
        cMapUrl: `${VENDOR}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${VENDOR}standard_fonts/`,
        wasmUrl: `${VENDOR}wasm/`,
        useWasm: false,
        isEvalSupported: false,
        enableXfa: false,
      }).promise;
    } catch (err) {
      if (token !== loadToken) return;
      setStatus('');
      showEmpty();
      showError(err?.name === 'PasswordException'
        ? t("这个 PDF 有密码保护，暂不支持翻译。")
        : t("无法打开这个文件：$1", [String(err?.message || err)]));
      return;
    }
    if (token !== loadToken) { loaded.destroy(); return; }
    doc = loaded;

    for (let num = 1; num <= doc.numPages; num++) {
      const proxy = await doc.getPage(num);
      if (token !== loadToken) return;
      const viewport = proxy.getViewport({ scale: 1 });
      pages.push(createPage(num, viewport.width, viewport.height));
    }
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) queueRender(pages[Number(entry.target.dataset.index)]);
      }
    }, { rootMargin: '1200px 0px' });
    for (const page of pages) observer.observe(page.row);
    renderProgress();
    renderButtons();
    runAll();
  }

  function createPage(num, width, height) {
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.index = String(num - 1);
    row.style.setProperty('--ratio', `${width} / ${height}`);
    const sheet = (kind, tag) => {
      const node = document.createElement('div');
      node.className = `sheet ${kind}`;
      const img = document.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      const badge = document.createElement('span');
      badge.className = 'tag';
      badge.textContent = `${tag} · ${num}`;
      node.append(img);
      if (kind === 'translated') {
        const overlay = document.createElement('div');
        overlay.className = 'overlay';
        node.append(overlay);
      }
      node.append(badge);
      return node;
    };
    const original = sheet('original', t("原文"));
    const translated = sheet('translated', t("译文"));
    row.append(original, translated);
    el.pages.append(row);
    return {
      num, width, height, row, original, translated,
      overlay: translated.querySelector('.overlay'),
      blocks: null, status: 'pending', image: null, rendering: null, fitted: true,
    };
  }

  /** 提取文字并拼成段落块。坐标换算到「左上角为原点」的页面像素（缩放 1）。 */
  async function ensureBlocks(page) {
    if (page.blocks) return page.blocks;
    page.blocksTask ||= (async () => {
      const proxy = await doc.getPage(page.num);
      const viewport = proxy.getViewport({ scale: 1 });
      const content = await proxy.getTextContent();
      const items = content.items.map((item) => {
        if (typeof item.str !== 'string') return null; // 标记内容，不是文字
        const tx = pdfjs.Util.transform(viewport.transform, item.transform);
        return {
          str: item.str,
          x: tx[4],
          y: tx[5],
          w: item.width,
          size: Math.hypot(tx[2], tx[3]),
          hasEOL: item.hasEOL,
          // 竖排、旋转的文字不翻译，原样保留
          rotated: tx[0] <= 0 || Math.abs(tx[1]) > Math.abs(tx[0]) * 0.05,
        };
      });
      page.blocks = Layout.buildBlocks(items);
      return page.blocks;
    })();
    return page.blocksTask;
  }

  /* ---------------------------------------------------------------- 渲染 */

  function queueRender(page) {
    if (!page || page.image || page.rendering) return page?.rendering;
    page.rendering = renderChain = renderChain.then(() => renderPage(page)).catch(() => {
      page.rendering = null; // 下次进入视野再试
    });
    return page.rendering;
  }

  async function renderPage(page) {
    if (!doc || page.image) return;
    const proxy = await doc.getPage(page.num);
    const scale = Math.min(RENDER_SCALE, Math.sqrt(MAX_PIXELS / (page.width * page.height)));
    const viewport = proxy.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    await proxy.render({ canvasContext: context, canvas, viewport }).promise;
    const blocks = await ensureBlocks(page);
    sampleColors(blocks, context, scale, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    canvas.width = 0;
    canvas.height = 0;
    if (!blob || !doc) return;
    page.image = URL.createObjectURL(blob);
    for (const img of page.row.querySelectorAll('img')) img.src = page.image;
    paint(page);
  }

  /**
   * 给每个译文块取底色和字色：底色取块边缘一圈像素的中位数，
   * 字色取块内与底色差别最大的像素；差别太小（浅色字、图片上的字）就按底色亮度选黑或白。
   */
  function sampleColors(blocks, context, scale, width, height) {
    for (const block of blocks) {
      if (!block.translatable) continue;
      const x0 = Math.max(0, Math.floor(block.left * scale) - 2);
      const y0 = Math.max(0, Math.floor(block.top * scale) - 2);
      const x1 = Math.min(width, Math.ceil((block.left + block.width) * scale) + 2);
      const y1 = Math.min(height, Math.ceil((block.top + block.height) * scale) + 2);
      const w = x1 - x0;
      const h = y1 - y0;
      if (w < 2 || h < 2) continue;
      const data = context.getImageData(x0, y0, w, h).data;
      const at = (x, y) => {
        const i = (y * w + x) * 4;
        return [data[i], data[i + 1], data[i + 2]];
      };
      const ring = [];
      const step = Math.max(1, Math.floor((w + h) / 120));
      for (let x = 0; x < w; x += step) ring.push(at(x, 0), at(x, h - 1));
      for (let y = 0; y < h; y += step) ring.push(at(0, y), at(w - 1, y));
      const median = (channel) => ring.map((p) => p[channel]).sort((a, b) => a - b)[ring.length >> 1];
      const bg = [median(0), median(1), median(2)];
      let fg = null;
      let best = 0;
      const inner = Math.max(1, Math.floor(Math.sqrt((w * h) / 900)));
      for (let y = 1; y < h - 1; y += inner) {
        for (let x = 1; x < w - 1; x += inner) {
          const p = at(x, y);
          const d = Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]);
          if (d > best) { best = d; fg = p; }
        }
      }
      const light = 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2] > 140;
      if (!fg || best < 120) fg = light ? [17, 17, 17] : [250, 250, 250];
      block.bg = `rgb(${bg.join(',')})`;
      block.fg = `rgb(${fg.join(',')})`;
    }
  }

  /** 把译文块盖到译文页上。 */
  function paint(page) {
    if (!page.blocks) return;
    const dir = AITrLanguages.LANGUAGES[target]?.dir || 'ltr';
    const pct = (value, total) => `${(value / total) * 100}%`;
    page.overlay.replaceChildren(...page.blocks.filter((block) => block.translated).map((block) => {
      const node = document.createElement('div');
      node.className = 'blk';
      node.style.left = pct(block.left, page.width);
      node.style.top = pct(block.top, page.height);
      node.style.width = pct(block.width, page.width);
      node.style.height = pct(block.height, page.height);
      node.style.background = block.bg || '#fff';
      node.style.color = block.fg || '#111';
      node.dataset.size = String((block.size / page.width) * 100);
      node.style.fontSize = `${node.dataset.size}cqw`;
      node.dir = dir;
      node.lang = target;
      node.textContent = block.translated;
      return node;
    }));
    page.fitted = false;
    fit(page);
  }

  /** 译文比原文长时逐步缩小字号，直到放进原文的位置。字号按页宽比例，缩放、打印都不用重算。 */
  function fit(page) {
    if (page.fitted || !page.translated.offsetWidth) return; // 当前视图看不到译文页，切过去时再排
    for (const node of page.overlay.children) {
      const base = Number(node.dataset.size);
      let size = base;
      while (node.scrollHeight > node.clientHeight + 1 && size > base * MIN_FONT_RATIO) {
        size *= 0.9;
        node.style.fontSize = `${size}cqw`;
      }
    }
    page.fitted = true;
  }

  /* ---------------------------------------------------------------- 翻译 */

  async function translatePage(page, signal, requestSettings) {
    page.status = 'busy';
    page.translated.classList.add('busy');
    try {
      const blocks = await ensureBlocks(page);
      for (const group of Layout.batches(blocks)) {
        if (group.every((index) => blocks[index].translated)) continue; // 上次停下前已经翻好
        const texts = group.map((index) => blocks[index].text);
        const result = await P.translateBatch({ texts, settings: requestSettings, targetId: target, signal });
        if (signal.aborted) return;
        if (!Array.isArray(result) || result.length !== texts.length) {
          throw new Error(t("翻译结果的段数不对，重试或换个模型试试"));
        }
        group.forEach((index, k) => {
          blocks[index].translated = String(result[k] ?? '').trim() || blocks[index].text;
        });
        paint(page);
      }
      page.status = 'done';
    } catch (err) {
      page.status = 'pending';
      throw err;
    } finally {
      page.translated.classList.remove('busy');
    }
  }

  async function runAll() {
    if (!doc || runController) return;
    const controller = new AbortController();
    runController = controller;
    started = true;
    hideError();
    renderButtons();
    renderProgress();
    const requestSettings = S.normalize({ ...settings, target });
    // 从当前看到的页开始往后翻，再回头翻前面的
    const first = pages.findIndex((page) => page.row.getBoundingClientRect().bottom > 80);
    const order = first > 0 ? [...pages.slice(first), ...pages.slice(0, first)] : [...pages];
    const queue = order.filter((page) => page.status !== 'done');
    let failure = null;
    const worker = async () => {
      while (queue.length && !controller.signal.aborted && !failure) {
        const page = queue.shift();
        try {
          await translatePage(page, controller.signal, requestSettings);
        } catch (err) {
          if (controller.signal.aborted || err?.name === 'AbortError') return;
          // 任何一页失败都整体停下：缺 Key、点数不足会每页都失败，不能一直重试。已翻好的页保留
          failure = err;
        }
        if (runController === controller) renderProgress();
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (runController !== controller) return;
    runController = null;
    if (failure) {
      showError(String(failure?.message || failure) || t("翻译失败"), failure?.action);
    } else if (!controller.signal.aborted && pages.every((page) => page.blocks && !page.blocks.some((b) => b.translatable))) {
      showError(t("这个 PDF 里没有可提取的文字（可能是扫描件），暂不支持翻译。"));
    }
    renderProgress();
    renderButtons();
  }

  function stop() {
    runController?.abort();
    runController = null;
    for (const page of pages) {
      if (page.status === 'busy') page.status = 'pending';
      page.translated.classList.remove('busy');
    }
    renderProgress();
    renderButtons();
  }

  /** 换了目标语言或平台：清掉已有译文，重新翻译。 */
  function restart() {
    if (!doc) return;
    const wasStarted = started;
    stop();
    for (const page of pages) {
      page.status = 'pending';
      for (const block of page.blocks || []) delete block.translated;
      page.overlay.replaceChildren();
    }
    started = false;
    if (wasStarted) runAll();
    else { renderProgress(); renderButtons(); }
  }

  /* ---------------------------------------------------------------- 视图 */

  function setMode(next) {
    mode = next;
    document.body.classList.remove('mode-compare', 'mode-translated', 'mode-original');
    document.body.classList.add(`mode-${mode}`);
    for (const button of document.querySelectorAll('.seg button')) {
      button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    }
    for (const page of pages) fit(page);
  }

  /* ---------------------------------------------------------------- 下载 */

  /**
   * 用打印另存为 PDF：译文是真正的文字（可选中、可搜索），中日韩等字体由系统提供，
   * 不需要把字体文件打包进扩展。导出的内容跟随当前视图（对照 / 译文 / 原文）。
   */
  async function download() {
    if (!doc) return;
    const missing = pages.length - doneCount();
    if (mode !== 'original' && missing > 0
      && !confirm(t("还有 $1 页没有翻译完，这些页会按原文导出。继续吗？", [missing]))) return;
    el.download.disabled = true;
    try {
      for (let i = 0; i < pages.length; i++) {
        setStatus(t("正在准备导出：$1/$2 页", [i + 1, pages.length]));
        setProgress((i + 1) / pages.length);
        await queueRender(pages[i]);
      }
      await Promise.all(pages.flatMap((page) => [...page.row.querySelectorAll('img')])
        .filter((img) => img.src).map((img) => img.decode().catch(() => {})));
      for (const page of pages) fit(page);
      const first = pages[0];
      const width = mode === 'compare' ? first.width * 2 : first.width;
      el.pageSize.textContent = `@page { size: ${width}pt ${first.height}pt; margin: 0; }`;
      const base = fileName.replace(/\.pdf$/i, '');
      const title = document.title;
      document.title = mode === 'original' ? base : `${base} (${label(target)})`;
      renderProgress();
      // 打印窗口用标题作默认文件名；关掉后再换回来
      window.addEventListener('afterprint', () => { document.title = title; }, { once: true });
      window.print();
    } finally {
      renderProgress();
      renderButtons();
    }
  }

  /* ---------------------------------------------------------------- 控件 */

  function renderTargetOptions() {
    el.target.replaceChildren(...S.targetList().map((item) => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = label(item.id);
      return option;
    }));
    el.target.value = target;
  }

  function renderProviderOptions() {
    el.provider.replaceChildren(...S.providerList().map((item) => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.label;
      return option;
    }));
    el.provider.value = settings.provider;
  }

  el.run.addEventListener('click', () => (runController ? stop() : runAll()));
  el.download.addEventListener('click', download);
  el.settings.addEventListener('click', () => chrome.runtime.openOptionsPage());
  el.target.addEventListener('change', () => {
    target = el.target.value;
    restart();
  });
  el.provider.addEventListener('change', async () => {
    settings = await S.patchSettings({ provider: el.provider.value });
    restart();
  });
  for (const button of document.querySelectorAll('.seg button')) {
    button.addEventListener('click', () => setMode(button.dataset.mode));
  }

  async function openFile(file) {
    if (!file) return;
    if (file.type && file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      showError(t("请选择 PDF 文件。"));
      return;
    }
    open(new Uint8Array(await file.arrayBuffer()), file.name);
  }
  el.file.addEventListener('change', () => openFile(el.file.files?.[0]));
  // 整页都能拖入：已经打开一份时也可以直接换
  window.addEventListener('dragover', (event) => {
    if (![...(event.dataTransfer?.types || [])].includes('Files')) return;
    event.preventDefault();
    el.drop.classList.add('over');
  });
  window.addEventListener('dragleave', (event) => {
    if (!event.relatedTarget) el.drop.classList.remove('over');
  });
  window.addEventListener('drop', (event) => {
    if (!event.dataTransfer?.files?.length) return;
    event.preventDefault();
    el.drop.classList.remove('over');
    openFile(event.dataTransfer.files[0]);
  });

  AITrI18n.onChange(() => {
    renderTargetOptions();
    renderProviderOptions();
    renderProgress();
    renderButtons();
  });

  /* -------------------------------------------------------------- 初始化 */

  settings = await S.loadSettings();
  target = settings.target;
  renderTargetOptions();
  renderProviderOptions();
  renderButtons();

  const params = new URLSearchParams(location.search);
  const tabId = params.has('tab') ? Number(params.get('tab')) : -1;
  let source = params.get('src') || '';
  let name = '';
  let bytes = null;
  let failure = null;
  if (Number.isInteger(tabId) && tabId >= 0) {
    setStatus(t("正在读取 PDF…"));
    try {
      const result = await fromTab(tabId);
      ({ bytes, name } = result);
      source = result.url || source;
    } catch (err) {
      failure = err;
      source = err.url || source;
      name = err.fileName || '';
    }
  }
  if (!bytes && source && failure?.code !== 'too_large') {
    try {
      bytes = await fromUrl(source);
    } catch {
      /* 留给下面的提示 */
    }
  }
  if (bytes) {
    // 记下来源，刷新本页时还能再读一次
    if (source) history.replaceState(null, '', `?${new URLSearchParams({ ...(tabId >= 0 ? { tab: tabId } : {}), src: source })}`);
    open(bytes, name || nameFromUrl(source));
  } else {
    setStatus('');
    if (failure?.code === 'too_large') {
      showError(t("这个 PDF 太大（$1 MB），请拆分后再翻译。", [Math.round(failure.size / 1048576)]));
    } else if (source || tabId >= 0) {
      showError(t("读不到这个 PDF 的内容。可以先下载，再拖到这里翻译。"));
    }
    showEmpty();
  }
})();
