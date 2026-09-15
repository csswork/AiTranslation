/**
 * 图片翻译页（验证阶段）。
 *
 * 目的有两个：既是最终功能的界面，也是「视觉模型给的坐标到底准不准」的
 * 验证工具——所以方框会直接画在原图上，并保留模型的原始回复。
 *
 * 和翻译面板一样直接在本页调接口，不经过 service worker。
 */
(() => {
  const S = globalThis.AITrSettings;
  const P = globalThis.AITrProviders;

  /** 各平台支持视觉的模型。识图必须用这些，普通文本模型会报错。 */
  const VISION_MODELS = {
    deepseek: ['deepseek-flash'],
    openai: ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-6-astra'],
  };

  /** 送去识别前的最长边。太大既费流量也费 token，接口那边也会再缩。 */
  const MAX_SEND_SIDE = 2048;

  const $ = (id) => document.getElementById(id);
  const el = {
    provider: $('provider'), model: $('model'), models: $('visionModels'),
    mode: $('mode'), status: $('status'), run: $('run'),
    stage: $('stage'), drop: $('drop'), file: $('file'), url: $('url'),
    canvas: $('canvas'), preview: $('preview'), overlay: $('overlay'),
    imageNote: $('imageNote'), clear: $('clear'),
    blocks: $('blocks'), meta: $('meta'), copy: $('copy'),
    error: $('error'), errorText: $('errorText'),
    raw: $('raw'), rawWrap: $('rawWrap'),
    settings: $('settings'),
  };

  let settings = S.normalize(null);
  let controller = null;
  /** 当前图片：displaySrc 用于显示，sendSrc 用于送检，size 是送检时的尺寸 */
  let image = null;
  let blocks = [];

  const setStatus = (text, busy) => {
    el.status.textContent = text || '';
    el.status.className = busy ? 'status busy' : 'status';
  };

  function showError(message, action, raw) {
    el.error.hidden = false;
    el.errorText.textContent = message || '出错了';
    el.error.querySelectorAll('button').forEach((n) => n.remove());
    if (action === 'open-options') {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ghost small';
      b.textContent = '打开设置';
      b.addEventListener('click', () => chrome.runtime.openOptionsPage());
      el.error.appendChild(b);
    }
    if (raw) {
      el.raw.textContent = raw;
      el.rawWrap.hidden = false;
    }
  }
  const clearError = () => {
    el.error.hidden = true;
  };

  /* ------------------------------------------------------------ 载入图片 */

  const readFile = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('读取文件失败'));
      reader.readAsDataURL(file);
    });

  const loadImage = (src) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      // http(s) 图片可能跨域；显示不需要 CORS，但要读像素就需要。
      // 读不到就退回「把网址交给接口自己去取」。
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = src;
    });

  /** 超过上限就等比缩小；顺便把跨域图片转成 data URL（失败则保留原网址）。 */
  function prepare(img, src) {
    const { naturalWidth: w, naturalHeight: h } = img;
    const scale = Math.min(1, MAX_SEND_SIDE / Math.max(w, h));
    const needResize = scale < 1;
    if (!needResize && src.startsWith('data:')) {
      return { sendSrc: src, size: { width: w, height: h }, resized: false };
    }
    try {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      return {
        sendSrc: canvas.toDataURL('image/jpeg', 0.9),
        size: { width: canvas.width, height: canvas.height },
        resized: needResize,
      };
    } catch {
      // 跨域图片会污染画布，读不出像素。直接把网址交给接口去取。
      return { sendSrc: src, size: { width: w, height: h }, resized: false, byUrl: true };
    }
  }

  async function useImage(src, label) {
    clearError();
    setStatus('正在载入图片…', true);
    try {
      const img = await loadImage(src);
      const prepared = prepare(img, src);
      image = { displaySrc: src, ...prepared };
      el.preview.src = src;
      el.drop.hidden = true;
      el.canvas.hidden = false;
      el.clear.hidden = false;
      el.run.disabled = false;
      renderBlocks([]);
      el.rawWrap.hidden = true;
      el.meta.textContent = '';
      const note = [
        label,
        `${img.naturalWidth}×${img.naturalHeight}`,
        prepared.resized ? `送检缩至 ${prepared.size.width}×${prepared.size.height}` : '',
        prepared.byUrl ? '跨域，改由接口按网址取图' : '',
      ].filter(Boolean);
      el.imageNote.textContent = note.join(' · ');
      setStatus('');
    } catch (err) {
      setStatus('');
      showError(String(err?.message || err));
    }
  }

  function reset() {
    image = null;
    blocks = [];
    controller?.abort();
    controller = null;
    el.preview.removeAttribute('src');
    el.canvas.hidden = true;
    el.drop.hidden = false;
    el.clear.hidden = true;
    el.run.disabled = true;
    el.copy.disabled = true;
    el.imageNote.textContent = '';
    el.meta.textContent = '';
    el.overlay.replaceChildren();
    el.blocks.replaceChildren();
    el.rawWrap.hidden = true;
    el.url.value = '';
    clearError();
    setStatus('');
  }

  /* ------------------------------------------------------------ 渲染结果 */

  function renderBlocks(list) {
    blocks = list;
    el.overlay.className = `overlay mode-${el.mode.value}`;

    el.overlay.replaceChildren(
      ...list.map((item, index) => {
        if (!item.box) return document.createComment('no box');
        const node = document.createElement('div');
        node.className = 'box';
        node.dataset.index = String(index);
        // 用百分比定位：图片怎么缩放都不用重算
        node.style.left = `${item.box.x * 100}%`;
        node.style.top = `${item.box.y * 100}%`;
        node.style.width = `${item.box.w * 100}%`;
        node.style.height = `${item.box.h * 100}%`;
        const fill = document.createElement('div');
        fill.className = 'fill';
        fill.textContent = item.translation || item.text;
        node.appendChild(fill);
        node.addEventListener('mouseenter', () => highlight(index, true));
        node.addEventListener('mouseleave', () => highlight(index, false));
        return node;
      })
    );

    el.blocks.replaceChildren(
      ...list.map((item, index) => {
        const row = document.createElement('div');
        row.className = 'block';
        row.dataset.index = String(index);
        const src = document.createElement('div');
        src.className = 'block-src';
        src.textContent = item.text;
        row.appendChild(src);
        if (item.translation) {
          const dst = document.createElement('div');
          dst.className = 'block-dst';
          dst.textContent = item.translation;
          row.appendChild(dst);
        }
        if (!item.box) {
          const warn = document.createElement('div');
          warn.className = 'block-no-box';
          warn.textContent = '模型没给这一段的坐标';
          row.appendChild(warn);
        }
        row.addEventListener('mouseenter', () => highlight(index, true));
        row.addEventListener('mouseleave', () => highlight(index, false));
        return row;
      })
    );
    el.copy.disabled = !list.some((b) => b.translation);
  }

  function highlight(index, on) {
    for (const node of el.overlay.querySelectorAll('.box')) {
      if (node.dataset.index === String(index)) node.classList.toggle('active', on);
    }
    for (const node of el.blocks.querySelectorAll('.block')) {
      if (node.dataset.index === String(index)) node.classList.toggle('active', on);
    }
  }

  /* -------------------------------------------------------------- 主流程 */

  async function run() {
    if (!image) return;
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;

    clearError();
    el.run.disabled = true;
    const started = Date.now();

    try {
      setStatus('正在识别图中文字…', true);
      const result = await P.readImageText({
        image: image.sendSrc,
        imageSize: image.size,
        settings,
        model: el.model.value.trim() || undefined,
        signal,
      });
      if (signal.aborted) return;

      el.raw.textContent = result.raw;
      el.rawWrap.hidden = false;
      const withBox = result.blocks.filter((b) => b.box).length;
      el.meta.textContent =
        `${result.blocks.length} 段，${withBox} 段带坐标 · 坐标制式 ${result.scale.x}`;

      if (!result.blocks.length) {
        renderBlocks([]);
        setStatus('图中没有识别到文字');
        return;
      }

      // 先把识别结果画出来，翻译失败也能看到方框准不准
      renderBlocks(result.blocks.map((b) => ({ ...b, translation: '' })));

      setStatus(`正在翻译 ${result.blocks.length} 段…`, true);
      const translations = await P.translateBatch({
        texts: result.blocks.map((b) => b.text),
        settings,
        signal,
      });
      if (signal.aborted) return;

      renderBlocks(result.blocks.map((b, i) => ({ ...b, translation: translations[i] || '' })));
      setStatus(`完成 · 用时 ${((Date.now() - started) / 1000).toFixed(1)}s`);
    } catch (err) {
      if (signal.aborted || err?.name === 'AbortError') return;
      setStatus('');
      showError(String(err?.message || err), err?.action, err?.raw);
    } finally {
      if (controller?.signal === signal) controller = null;
      el.run.disabled = !image;
    }
  }

  /* ---------------------------------------------------------------- 事件 */

  el.drop.addEventListener('click', (event) => {
    if (event.target === el.url) return;
    el.file.click();
  });
  el.file.addEventListener('change', async () => {
    const file = el.file.files?.[0];
    if (file) await useImage(await readFile(file), file.name);
    el.file.value = '';
  });

  for (const type of ['dragenter', 'dragover']) {
    el.drop.addEventListener(type, (event) => {
      event.preventDefault();
      el.drop.classList.add('over');
    });
  }
  for (const type of ['dragleave', 'drop']) {
    el.drop.addEventListener(type, () => el.drop.classList.remove('over'));
  }
  el.drop.addEventListener('drop', async (event) => {
    event.preventDefault();
    const file = [...(event.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'));
    if (file) await useImage(await readFile(file), file.name);
  });

  window.addEventListener('paste', async (event) => {
    const items = [...(event.clipboardData?.items || [])];
    const item = items.find((i) => i.type.startsWith('image/'));
    if (item) {
      const file = item.getAsFile();
      if (file) {
        event.preventDefault();
        await useImage(await readFile(file), '剪贴板图片');
      }
      return;
    }
    // 粘贴的是网址
    const text = event.clipboardData?.getData('text')?.trim();
    if (text && /^https?:\/\//i.test(text) && document.activeElement !== el.url) {
      event.preventDefault();
      await useImage(text, text.slice(0, 60));
    }
  });

  el.url.addEventListener('keydown', async (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const value = el.url.value.trim();
    if (value) await useImage(value, value.slice(0, 60));
  });

  el.clear.addEventListener('click', reset);
  el.run.addEventListener('click', run);
  el.mode.addEventListener('change', () => {
    el.overlay.className = `overlay mode-${el.mode.value}`;
  });
  el.copy.addEventListener('click', async () => {
    const text = blocks.map((b) => b.translation).filter(Boolean).join('\n');
    if (!text) return;
    let ok = true;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      ok = false;
    }
    el.copy.textContent = ok ? '已复制' : '复制失败';
    setTimeout(() => {
      el.copy.textContent = '复制译文';
    }, 1400);
  });
  el.settings.addEventListener('click', () => chrome.runtime.openOptionsPage());

  function renderModelOptions() {
    const list = VISION_MODELS[el.provider.value] || [];
    el.models.replaceChildren(
      ...list.map((name) => {
        const option = document.createElement('option');
        option.value = name;
        return option;
      })
    );
    el.model.value = list[0] || '';
    el.model.placeholder = list[0] || '支持视觉的模型名';
  }

  el.provider.addEventListener('change', async () => {
    settings = await S.patchSettings({ provider: el.provider.value });
    renderModelOptions();
  });

  /* -------------------------------------------------------------- 初始化 */

  (async () => {
    settings = await S.loadSettings();
    el.provider.replaceChildren(
      ...S.providerList().map((item) => {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = item.label;
        option.selected = item.id === settings.provider;
        return option;
      })
    );
    renderModelOptions();
  })();
})();
