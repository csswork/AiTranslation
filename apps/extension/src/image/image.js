/**
 * 图片翻译页（验证阶段）。
 *
 * 目的有两个：既是最终功能的界面，也是「视觉模型给的坐标到底准不准」的
 * 验证工具——所以方框会直接画在原图上，并保留模型的原始回复。
 *
 * 和翻译面板一样直接在本页调接口，不经过 service worker。
 */
(async () => {
  await AITrI18n.ready;
  const t = (...args) => AITrI18n.t(...args);
  const S = globalThis.AITrSettings;
  const P = globalThis.AITrProviders;
  const L = globalThis.AITrLang;
  const R = globalThis.AITrImageRender;
  const Regions = globalThis.AITrRegions;

  /**
   * 送检尺寸限制。按「总像素」而不是「最长边」来限——
   * 长图按最长边缩会把宽度压没，文字就糊了。
   * 例：700×4400 按最长边 2048 会缩成 326×2048（宽度只剩 326）。
   */
  const MAX_PIXELS = 4000000;
  const MAX_SIDE = 8000;
  const sendScale = (w, h) =>
    Math.min(1, Math.sqrt(MAX_PIXELS / (w * h)), MAX_SIDE / Math.max(w, h));

  const $ = (id) => document.getElementById(id);
  const el = {
    target: $('target'),
    provider: $('provider'), model: $('model'), models: $('visionModels'),
    mode: $('mode'), scale: $('scale'), order: $('order'), status: $('status'), run: $('run'),
    stage: $('stage'), drop: $('drop'), file: $('file'), url: $('url'),
    canvas: $('canvas'), preview: $('preview'), overlay: $('overlay'),
    imageNote: $('imageNote'), clear: $('clear'),
    regions: $('regions'), clearRegions: $('clearRegions'), picker: $('picker'),
    fill: $('fill'), fillColor: $('fillColor'),
    blocks: $('blocks'), meta: $('meta'), copy: $('copy'),
    save: $('save'), copyImage: $('copyImage'),
    error: $('error'), errorText: $('errorText'),
    raw: $('raw'), rawWrap: $('rawWrap'),
    settings: $('settings'),
  };

  let settings = S.normalize(null);
  let controller = null;
  /** 当前图片：displaySrc 用于显示，sendSrc 用于送检，size 是送检时的尺寸 */
  let image = null;
  let blocks = [];
  /** 最近一次识别的原始结果，切换坐标制式时在本地重算，不用重新请求。 */
  let lastResult = null;

  const setStatus = (text, busy) => {
    el.status.textContent = text || '';
    el.status.className = busy ? 'status busy' : 'status';
  };

  function showError(message, action, raw) {
    el.error.hidden = false;
    el.errorText.textContent = message || t("出错了");
    el.error.querySelectorAll('button').forEach((n) => n.remove());
    if (action === 'open-options') {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ghost small';
      b.textContent = t("打开设置");
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
      reader.onerror = () => reject(new Error(t("读取文件失败")));
      reader.readAsDataURL(file);
    });

  const loadImage = (src) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      // http(s) 图片可能跨域；显示不需要 CORS，但要读像素就需要。
      // 读不到就退回「把网址交给接口自己去取」。
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(t("图片加载失败")));
      img.src = src;
    });

  /**
   * 超过上限就等比缩小；顺便把跨域图片转成 data URL（失败则保留原网址）。
   * 画好的送检画布留着，给译文取相近背景色。
   */
  function prepare(img, src) {
    const { naturalWidth: w, naturalHeight: h } = img;
    const scale = sendScale(w, h);
    const needResize = scale < 1;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      // 之后要逐框取相近色（多次 getImageData），声明后 Chrome 改用 CPU 画布，读回更快
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      ctx.getImageData(0, 0, 1, 1); // 被跨域污染时这里就会抛错
      return {
        // 本来就是 data URL 又不用缩时原样送检，不重新编码一遍
        sendSrc: !needResize && src.startsWith('data:') ? src : canvas.toDataURL('image/jpeg', 0.9),
        size: { width: canvas.width, height: canvas.height },
        resized: needResize,
        natural: { w, h },
        ctx,
      };
    } catch {
      // 跨域图片会污染画布，读不出像素。直接把网址交给接口去取。
      return {
        sendSrc: src, size: { width: w, height: h },
        resized: false, byUrl: true, natural: { w, h },
      };
    }
  }

  let imageLoad = 0;
  async function useImage(src, label) {
    const token = ++imageLoad;
    controller?.abort();
    controller = null;
    lastResult = null;
    el.target.disabled = el.provider.disabled = el.model.disabled = false;
    clearError();
    setStatus(t("正在载入图片…"), true);
    try {
      const img = await loadImage(src);
      if (token !== imageLoad) return;
      const prepared = prepare(img, src);
      image = { displaySrc: src, el: img, ...prepared };
      picker.set([]);
      setPicking(false);
      onRegions([]);
      // 坐标是相对值，显示一律用原图，不用送检那份缩过的
      el.preview.src = src;
      // 长图若按高度缩进窗口，宽度会小到看不清，改成按宽度铺开并纵向滚动
      el.canvas.classList.toggle(
        'tall',
        img.naturalHeight / Math.max(1, img.naturalWidth) > 1.6
      );
      el.drop.hidden = true;
      el.canvas.hidden = false;
      el.clear.hidden = false;
      el.regions.hidden = false;
      el.run.disabled = false;
      renderBlocks([]);
      el.rawWrap.hidden = true;
      el.meta.textContent = '';
      const note = [
        label,
        `${img.naturalWidth}×${img.naturalHeight}`,
        prepared.resized ? t("送检缩至 $1×$2", [prepared.size.width, prepared.size.height]) : '',
        prepared.byUrl ? t("跨域，改由接口按网址取图") : '',
      ].filter(Boolean);
      el.imageNote.textContent = note.join(' · ');
      setStatus('');
    } catch (err) {
      if (token !== imageLoad) return;
      setStatus('');
      showError(String(err?.message || err));
    }
  }

  function reset() {
    imageLoad += 1;
    el.target.disabled = el.provider.disabled = el.model.disabled = false;
    image = null;
    blocks = [];
    lastResult = null;
    controller?.abort();
    controller = null;
    el.preview.removeAttribute('src');
    el.canvas.hidden = true;
    el.drop.hidden = false;
    el.clear.hidden = true;
    el.regions.hidden = true;
    picker.set([]);
    setPicking(false);
    onRegions([]);
    el.run.disabled = true;
    el.copy.disabled = true;
    el.save.disabled = el.copyImage.disabled = true;
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
        // 不盖在图上的三种情况：没有坐标、纯数字符号无需翻译、
        // 以及译文和原文一模一样（盖上去等于什么也没做，只是挡住原图）
        if (!item.box || item.skipped || item.sameAsSource) {
          return document.createComment('skip');
        }
        const node = document.createElement('div');
        node.className = 'box';
        node.dataset.index = String(index);
        // 用百分比定位：图片怎么缩放都不用重算
        node.style.left = `${item.box.x * 100}%`;
        node.style.top = `${item.box.y * 100}%`;
        node.style.width = `${item.box.w * 100}%`;
        node.style.height = `${item.box.h * 100}%`;
        if (item.fontMax) node.dataset.fontMax = String(item.fontMax);
        const fill = document.createElement('div');
        fill.className = 'fill';
        // 方框按识别坐标画（「只看方框」要如实反映坐标准不准），
        // 译文的遮盖范围和导出图片一样往外放一点，免得露出原文边角
        const cover = R.coverBox(item, image?.natural);
        if (cover !== item.box && item.box.w && item.box.h) {
          const px = ((item.box.x - cover.x) / item.box.w) * 100;
          const py = ((item.box.y - cover.y) / item.box.h) * 100;
          const pr = ((cover.x + cover.w - item.box.x - item.box.w) / item.box.w) * 100;
          const pb = ((cover.y + cover.h - item.box.y - item.box.h) / item.box.h) * 100;
          fill.style.inset = `${-py}% ${-pr}% ${-pb}% ${-px}%`;
        }
        if (image?.ctx && item.sample === undefined) {
          const { width, height } = image.size;
          item.sample = R.sampleAt(image.ctx, {
            x: cover.x * width, y: cover.y * height, w: cover.w * width, h: cover.h * height,
          }, width, height);
        }
        fill.textContent = item.translation || item.text;
        fill.dir = 'auto';
        // 小框放不下时会裁切，鼠标悬停能看到完整内容
        node.title = item.translation || item.text;
        node.appendChild(fill);
        node.addEventListener('mouseenter', () => highlight(index, true));
        node.addEventListener('mouseleave', () => highlight(index, false));
        return node;
      })
    );

    el.blocks.replaceChildren(
      ...list.map((item, index) => {
        // 无需翻译的不进列表。数量仍在结果栏计数里，
        // 完整内容在「模型原始回复」里，排查时不会丢信息。
        // 注意 index 取自原数组，这样和覆盖层的联动高亮仍对得上。
        if (item.skipped || item.sameAsSource) return null;
        const row = document.createElement('div');
        row.className = 'block';
        row.dataset.index = String(index);
        const src = document.createElement('div');
        src.className = 'block-src';
        src.textContent = item.text;
        src.dir = 'auto';
        row.appendChild(src);
        if (item.translation) {
          const dst = document.createElement('div');
          dst.className = 'block-dst';
          dst.textContent = item.translation;
          dst.dir = 'auto';
          row.appendChild(dst);
        }
        if (!item.box) {
          const note = document.createElement('div');
          note.className = 'block-note';
          note.textContent = t("模型没给这一段的坐标");
          row.appendChild(note);
        }
        row.addEventListener('mouseenter', () => highlight(index, true));
        row.addEventListener('mouseleave', () => highlight(index, false));
        return row;
      }).filter(Boolean)
    );
    el.copy.disabled = !list.some((b) => b.translation);
    // 跨域读不到像素时合成不了新图
    el.save.disabled = el.copyImage.disabled = !image?.ctx || !exportable().length;
    applyFill();
    requestAnimationFrame(fitAll);
  }

  /** 要画进新图的条目：和覆盖层一样，跳过没坐标、无需翻译和译文与原文相同的。 */
  const exportable = () =>
    blocks.filter((b) => b.box && b.translation && !b.skipped && !b.sameAsSource);

  /** 按背景选项给覆盖层上色。相近色在渲染时已采样，切换选项不用重新取像素。 */
  function applyFill() {
    for (const node of el.overlay.querySelectorAll('.box')) {
      const item = blocks[Number(node.dataset.index)];
      const color = R.paint(el.fill.value, el.fillColor.value, item?.sample);
      const fill = node.querySelector('.fill');
      fill.style.background = color.bg;
      fill.style.color = color.fg;
    }
  }

  /**
   * 按框的大小自适应字号。
   * 图上的文字区域往往很小，固定字号会被裁掉一半。
   * 先按框高估一个字号，放不下再按溢出比例缩一次——两次测量就够，
   * 不用循环逼近（每次测量都会触发一次强制布局）。
   */
  const FONT_MAX = 14;
  const FONT_MIN = 8;

  function fitOne(node) {
    const fill = node.querySelector('.fill');
    if (!fill) return;
    const w = fill.clientWidth;
    const h = fill.clientHeight;
    if (!w || !h) return;

    // 选区按原文的大致字号封顶，译文不会比原文还大
    const hint = Number(node.dataset.fontMax || 0) * el.canvas.clientHeight;
    const top = hint > 0 ? Math.max(FONT_MIN, hint) : FONT_MAX;
    const clamp = (v) => Math.min(top, Math.max(FONT_MIN, v));
    let size = clamp(h * 0.62);
    fill.style.fontSize = `${size.toFixed(1)}px`;

    const overflowing = () => fill.scrollWidth > w + 1 || fill.scrollHeight > h + 1;
    if (overflowing()) {
      const ratio = Math.min(w / Math.max(1, fill.scrollWidth), h / Math.max(1, fill.scrollHeight));
      size = clamp(size * ratio * 0.95);
      fill.style.fontSize = `${size.toFixed(1)}px`;
    }
  }

  function fitAll() {
    for (const node of el.overlay.querySelectorAll('.box')) fitOne(node);
  }

  // 图片随窗口缩放后，框的像素尺寸变了，字号要重算
  let fitTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(fitAll, 150);
  });

  function highlight(index, on) {
    for (const node of el.overlay.querySelectorAll('.box')) {
      if (node.dataset.index === String(index)) node.classList.toggle('active', on);
    }
    for (const node of el.blocks.querySelectorAll('.block')) {
      if (node.dataset.index === String(index)) node.classList.toggle('active', on);
    }
  }

  /* -------------------------------------------------------------- 主流程 */

  async function run(reuse = false) {
    if (!image) return;
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;
    const requestSettings = S.normalize({ ...settings, target: el.target.value });
    const requestImage = image;
    el.target.disabled = true;
    el.provider.disabled = true;
    el.model.disabled = true;

    clearError();
    el.run.disabled = true;
    // 框选完直接点识别：退出框选，结果才看得见
    if (!el.picker.hidden) setPicking(false);
    const started = Date.now();

    try {
      setStatus(t("正在识别图中文字…"), true);
      const regions = picker.regions;
      // 换目标语言时复用上次的识别结果；选区变了就得重新识别
      const same = lastResult &&
        JSON.stringify(lastResult.regions || []) === JSON.stringify(regions);
      const read = (src, imageSize) => P.readImageText({
        image: src,
        imageSize,
        settings: requestSettings,
        model: el.model.value.trim() || undefined,
        order: el.order.value,
        signal,
      });
      const result = reuse && same ? lastResult
        : regions.length ? await readRegionText(regions, read)
        : await read(image.sendSrc, image.size);
      if (signal.aborted) return;

      lastResult = result;
      el.raw.textContent = result.raw;
      el.rawWrap.hidden = false;
      const withBox = result.blocks.filter((b) => b.box).length;
      el.meta.textContent = result.regions
        ? t("$1 个选区，识别出 $2 段", [result.regions.length, result.blocks.length])
        : t("识别 $1 段，$2 段带坐标 · 坐标制式 $3×$4", [result.blocks.length, withBox, result.scale.x, result.scale.y]);

      // AI 智能分段：同一段的各行合成一整段（选区结果已经按选区合并过）
      const units = result.regions ? result.blocks : Regions.groupParagraphs(result.blocks);
      if (units.length < result.blocks.length) el.meta.textContent += t("，AI 分成 $1 段", [units.length]);

      if (!units.length) {
        renderBlocks([]);
        setStatus(result.regions ? t("选区里没有识别到文字") : t("图中没有识别到文字"));
        return;
      }

      // 星级、价格、尺码这类纯数字符号没有翻译的意义，
      // 送去翻译只会原样返回，白花 token 还会盖住原图。
      // 这里复用划词菜单同一套判断。
      const translatable = units.filter((b) => L.shouldOffer(b.text));
      const skipped = units.length - translatable.length;
      const tagSkipped = (list, done) =>
        list.map((b) => {
          const translation = done.get(b) || '';
          return {
            ...b,
            skipped: !done.has(b),
            translation,
            sameAsSource: Boolean(translation) && translation.trim() === b.text.trim(),
          };
        });

      // 先把识别结果画出来，翻译失败也能看到方框准不准
      renderBlocks(tagSkipped(units, new Map(translatable.map((b) => [b, '']))));

      if (!translatable.length) {
        setStatus(t("识别到 $1 段，都无需翻译", [units.length]));
        return;
      }

      setStatus(t("正在翻译 $1 段…", [translatable.length]), true);
      const translations = await P.translateBatch({
        texts: translatable.map((b) => b.text),
        settings: requestSettings,
        signal,
      });
      if (signal.aborted) return;

      const done = new Map(translatable.map((b, i) => [b, translations[i] || '']));
      const tagged = tagSkipped(units, done);
      renderBlocks(tagged);
      // 列表里不显示被跳过的条目，所以在状态里把数量说清楚
      const hidden = tagged.filter((b) => b.skipped || b.sameAsSource).length;
      const tail = hidden ? t("，隐藏 $1 段无需翻译的", [hidden]) : '';
      setStatus(t("完成$1 · 用时 $2s", [tail, ((Date.now() - started) / 1000).toFixed(1)]));
    } catch (err) {
      if (signal.aborted || err?.name === 'AbortError') return;
      setStatus('');
      showError(String(err?.message || err), err?.action, err?.raw);
    } finally {
      if (controller?.signal === signal && image === requestImage) {
        controller = null;
        el.target.disabled = false;
        el.provider.disabled = false;
        el.model.disabled = S.isHosted(settings.provider);
        el.run.disabled = !image;
      }
    }
  }

  /**
   * 只识别框出的区域：从原图裁下来拼成一张图识别（更准，也只发一次请求）；
   * 跨域读不到像素时退回整图识别，再挑出落在选区内的。
   * 每个选区合成一整段，框就是选区本身。
   */
  async function readRegionText(regions, read) {
    const raws = [];
    const readOne = async (src, size) => {
      const result = await read(src, size);
      raws.push(result.raw);
      return result.blocks;
    };
    const found = image.ctx
      ? await Regions.readRegions({
        source: image.el, natural: image.natural, regions, scaleFor: sendScale, read: readOne,
        onProgress: (i, total) => {
          if (total > 1) setStatus(t("正在识别选区 $1/$2…", [i + 1, total]), true);
        },
      })
      : Regions.filterByRegions(await readOne(image.sendSrc, image.size), regions);
    const groups = Regions.groupByRegion(found, regions);
    return {
      regions,
      raw: raws.join('\n\n'),
      blocks: groups.map((g) => ({
        text: g.text, box: g.box, textBox: g.textBox, rawBox: null, region: g.region, fontMax: g.fontMax,
      })),
    };
  }

  /* ------------------------------------------------------------ 框选与背景 */

  function setPicking(on) {
    el.canvas.classList.toggle('picking', on);
    el.picker.hidden = !on;
    el.regions.textContent = on ? t("完成框选") : t("框选区域");
    if (on) setStatus(t("拖动鼠标框出要翻译的区域，可以框多个"));
    // 框选时覆盖层是隐藏的，量不出尺寸；露出来以后重新排字号
    else requestAnimationFrame(fitAll);
  }

  function onRegions(list) {
    el.clearRegions.hidden = !list.length;
    // 识别过的方框和选区对不上了，按选区调整的坐标制式也就没意义
    el.scale.disabled = el.order.disabled = list.length > 0;
    if (list.length) setStatus(t("已框选 $1 个区域，点「识别并翻译」只处理这些位置", [list.length]));
    else if (!el.picker.hidden) setStatus(t("拖动鼠标框出要翻译的区域，可以框多个"));
  }

  const picker = globalThis.AITrRegionPicker.create(el.picker, {
    max: Regions.MAX_REGIONS,
    deleteLabel: t("删除这个选区"),
    onChange: onRegions,
    onLimit: () => setStatus(t("最多框选 $1 个区域", [Regions.MAX_REGIONS])),
  });
  document.head.append(Object.assign(document.createElement('style'), {
    textContent: globalThis.AITrRegionPicker.STYLE,
  }));

  el.regions.addEventListener('click', () => setPicking(el.picker.hidden));
  el.clearRegions.addEventListener('click', () => picker.clear());

  el.fill.addEventListener('change', () => {
    el.fillColor.hidden = el.fill.value !== 'custom';
    applyFill();
    saveFill();
  });
  el.fillColor.addEventListener('input', applyFill);
  el.fillColor.addEventListener('change', saveFill);
  function saveFill() {
    S.patchSettings({ imageFill: el.fill.value, imageFillColor: el.fillColor.value })
      .then((next) => { settings = next; })
      .catch(() => {});
  }

  /** 合成带译文的新图，下载或复制到剪贴板。全部在本机完成，不上传。 */
  async function exportImage(toClipboard) {
    const list = exportable();
    if (!image?.ctx || !list.length) return;
    const button = toClipboard ? el.copyImage : el.save;
    const label = button.textContent;
    button.disabled = true;
    let text;
    try {
      const canvas = R.renderImage(image.el, image.natural, list,
        { fill: el.fill.value, custom: el.fillColor.value });
      const blob = await R.toBlob(canvas, { forClipboard: toClipboard });
      if (toClipboard) await R.copy(blob);
      else R.download(blob, R.fileName(image.displaySrc, el.target.value, blob));
      text = toClipboard ? t("已复制") : t("已下载");
    } catch {
      text = toClipboard ? t("复制失败") : t("生成图片失败");
    }
    button.textContent = text;
    setTimeout(() => {
      button.textContent = label;
      button.disabled = false;
    }, 1400);
  }
  el.save.addEventListener('click', () => exportImage(false));
  el.copyImage.addEventListener('click', () => exportImage(true));

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
        await useImage(await readFile(file), t("剪贴板图片"));
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
  el.run.addEventListener('click', () => run());
  el.target.addEventListener('change', () => {
    if (lastResult) run(true);
  });
  el.mode.addEventListener('change', () => {
    el.overlay.className = `overlay mode-${el.mode.value}`;
    requestAnimationFrame(fitAll);
  });

  /** 按当前选择算出换算系数；选「自动」就用识别时判定的那个。 */
  function currentScale() {
    const choice = el.scale.value;
    if (choice === 'ratio') return { x: 1, y: 1 };
    if (choice === '1000') return { x: 1000, y: 1000 };
    if (choice === 'pixel' && image?.size) {
      return { x: image.size.width, y: image.size.height };
    }
    return lastResult?.scale || { x: 1000, y: 1000 };
  }

  // 自动判定偶尔会错（模型坐标带毛刺时）。这里在本地重算重画，
  // 不重新请求接口，切换是免费的。
  /** 换一种换算方式重画。都在本地算，不重新请求接口，切换是免费的。 */
  function requantize() {
    // 选区结果的框就是选区本身、AI 分出的段是多行合并的框，都不是模型的单个坐标
    if (!lastResult || lastResult.regions || blocks.some((b) => b.lines)) return;
    const scale = currentScale();
    const order = el.order.value;
    blocks = blocks.map((b) => ({ ...b, box: P.normalizeBox(b.rawBox, scale, order) }));
    renderBlocks(blocks);
    el.meta.textContent = t("$1 段 · 制式 $2×$3 · 顺序 $4", [blocks.length, scale.x, scale.y, order]);
  }

  // 自动判定偶尔会错（模型坐标带毛刺、或顺序与提示词不一致时）
  el.scale.addEventListener('change', requantize);
  el.order.addEventListener('change', requantize);
  el.copy.addEventListener('click', async () => {
    const text = blocks.map((b) => b.translation).filter(Boolean).join('\n');
    if (!text) return;
    let ok = true;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      ok = false;
    }
    el.copy.textContent = ok ? t("已复制") : t("复制失败");
    setTimeout(() => {
      el.copy.textContent = t("复制译文");
    }, 1400);
  });
  el.settings.addEventListener('click', () => chrome.runtime.openOptionsPage());

  function renderModelOptions() {
    const hosted = S.isHosted(el.provider.value);
    $('modelPicker').hidden = hosted;
    el.model.disabled = hosted;
    const list = S.VISION_MODELS[el.provider.value] || [];
    el.models.replaceChildren(
      ...list.map((name) => {
        const option = document.createElement('option');
        option.value = name;
        return option;
      })
    );
    el.model.value = list[0] || '';
    el.model.placeholder = list[0] || t("支持视觉的模型名");
  }

  el.provider.addEventListener('change', async () => {
    settings = await S.patchSettings({ provider: el.provider.value });
    renderModelOptions();
  });

  /* -------------------------------------------------------------- 初始化 */

  (async () => {
    settings = await S.loadSettings();
    el.target.replaceChildren(...S.targetList().map((item) => {
      const option = document.createElement('option');
      option.value = item.id; option.textContent = item.label;
      option.selected = item.id === settings.target;
      return option;
    }));
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
    el.fill.value = settings.imageFill;
    el.fillColor.value = settings.imageFillColor;
    el.fillColor.hidden = settings.imageFill !== 'custom';
  })();
})();
