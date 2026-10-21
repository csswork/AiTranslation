/**
 * 页面内图片翻译：右键图片 →「翻译图片」→ 图上盖遮罩转圈 →
 * 完成后弹出大窗口，译文按识别到的位置盖在图上。
 * 弹窗里可以框选若干区域只翻译这些位置，选背景色，并把结果下载或复制成新图片。
 *
 * 独立于 content.js（划词）和 elements.js（元素翻译）：自己的事件、
 * 自己的 shadow 宿主，互不引用。
 */
(() => {
  const t = (...args) => AITrI18n.t(...args);
  if (window.__aiTranslationImageLoaded) return;
  window.__aiTranslationImageLoaded = true;

  /**
   * 送检尺寸限制。按「总像素」而不是「最长边」来限——
   * 长图按最长边缩会把宽度压没，文字就糊了。
   * 例：700×4400 的长图，按最长边 2048 会缩成 326×2048（宽度只剩 326），
   * 按总像素则 3.08M < 4M，完全不用缩。
   * 单边上限取 8000，贴着接口 8192 的硬限制留点余量。
   */
  const MAX_PIXELS = 4000000;
  const MAX_SIDE = 8000;
  const Lang = globalThis.AITrLang;
  const Tiles = globalThis.AITrTiles;
  const Regions = globalThis.AITrRegions;
  const Render = globalThis.AITrImageRender;
  const Picker = globalThis.AITrRegionPicker;

  /** 返回不超过上述限制的缩放系数（不放大）。 */
  function sendScale(w, h) {
    return Math.min(1, Math.sqrt(MAX_PIXELS / (w * h)), MAX_SIDE / Math.max(w, h));
  }
  const FONT_MAX = 16;
  const FONT_MIN = 8;

  /* --------------------------------------------------------- 取图 */

  function findImage(srcUrl) {
    if (!srcUrl) return null;
    const list = [...document.querySelectorAll('img')];
    return (
      list.find((img) => img.currentSrc === srcUrl) ||
      list.find((img) => img.src === srcUrl) ||
      null
    );
  }

  /** 把 <img> 画进 canvas 取 data URL；跨域被污染时返回 null。 */
  function toDataUrl(source, width, height) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(source, 0, 0, width, height);
      return canvas.toDataURL('image/jpeg', 0.9);
    } catch {
      return null; // 画布被跨域图片污染，读不出像素
    }
  }

  const reloadWithCors = (src) =>
    new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });

  /**
   * 拿到可以送检的图。三级回退：
   * 直接读像素 → 带 CORS 重新加载后读 → 都不行就把网址交给接口自己取。
   */
  async function grabImage(img) {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return null;

    const scale = sendScale(w, h);
    const sw = Math.round(w * scale);
    const sh = Math.round(h * scale);
    // 坐标是相对值，显示一律用原图——送检那份缩过，清晰度不如原图
    const url = img.currentSrc || img.src;
    const natural = { w, h };

    // 先把图画进画布：既是缩放，也是后面切块和扫描墨水的基础
    let canvas = null;
    // 能画进画布、又没被跨域污染的那份原图：框选裁图和导出新图都要用原始分辨率
    let source = img;
    try {
      canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      // 这块画布之后要逐框取相近色（多次 getImageData），第一次取上下文时就要声明，
      // 否则 Chrome 会提示 GPU 画布反复读回很慢
      canvas.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, sw, sh);
      // 探测画布有没有被跨域图片污染。读一个像素就够，
      // 用 toDataURL 试探会把整张大图白编码一遍。
      canvas.getContext('2d').getImageData(0, 0, 1, 1);
    } catch {
      canvas = null;
    }
    if (!canvas) {
      const fresh = await reloadWithCors(url);
      source = fresh;
      if (fresh) {
        try {
          canvas = document.createElement('canvas');
          canvas.width = sw;
          canvas.height = sh;
          canvas.getContext('2d', { willReadFrequently: true }).drawImage(fresh, 0, 0, sw, sh);
          canvas.getContext('2d').getImageData(0, 0, 1, 1);
        } catch {
          canvas = null;
        }
      }
    }

    // 读不到像素，只能整张交给接口按网址取图（长图也就没法分块了）
    if (!canvas) {
      return {
        parts: [{ image: url, size: { width: w, height: h } }],
        plan: [{ top: 0, height: h }],
        fullHeight: h,
        display: url,
        natural,
        byUrl: true,
      };
    }

    const ctx = canvas.getContext('2d');
    // 送检那份画布顺便用来给预览取相近背景色、按像素校正遮盖位置
    const pixels = { source, ctx, width: sw, height: sh };
    // 每块补白成正方形送检（长图先切块），坐标识别回来后再换算
    const { parts, plan } = Tiles.squareParts(canvas, sw, sh);
    return {
      parts,
      plan,
      fullHeight: sh,
      display: url,
      natural,
      tiled: plan.length > 1,
      ...pixels,
    };
  }

  /* ------------------------------------------------------- 加载遮罩 */

  const MASK_STYLE = `
    .mask {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center; gap: 8px;
      padding: 10px; text-align: center;
      background: rgba(15, 23, 42, 0.55);
      color: #fff; border-radius: inherit;
      font: 500 13px/1.45 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
    }
    .spin {
      width: 15px; height: 15px; flex: none;
      border: 2px solid rgba(255, 255, 255, 0.35);
      border-top-color: #fff; border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg) } }
    @media (prefers-reduced-motion: reduce) { .spin { animation-duration: 2s } }`;

  let mask = null;
  let maskTarget = null;

  function showMask(img, text) {
    hideMask();
    const host = document.createElement('div');
    host.style.cssText =
      'all: initial; position: fixed !important; z-index: 2147483646 !important;' +
      'pointer-events: none !important;';
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = MASK_STYLE;
    const box = document.createElement('div');
    box.className = 'mask';
    const spin = document.createElement('div');
    spin.className = 'spin';
    const label = document.createElement('span');
    label.textContent = text;
    box.append(spin, label);
    root.append(style, box);
    (document.body || document.documentElement).appendChild(host);

    mask = { host, label };
    maskTarget = img;
    positionMask();
  }

  function positionMask() {
    if (!mask || !maskTarget?.isConnected) return;
    const rect = maskTarget.getBoundingClientRect();
    mask.host.style.top = `${rect.top}px`;
    mask.host.style.left = `${rect.left}px`;
    mask.host.style.width = `${rect.width}px`;
    mask.host.style.height = `${rect.height}px`;
  }

  function hideMask() {
    mask?.host.remove();
    mask = null;
    maskTarget = null;
  }

  window.addEventListener('scroll', positionMask, { capture: true, passive: true });
  window.addEventListener('resize', positionMask);

  /* ----------------------------------------------------------- 弹窗 */

  const PANEL_STYLE = `
    /* 按钮用了 all: unset，会把 hidden 的隐藏效果也重置掉 */
    [hidden] { display: none !important; }
    .backdrop {
      position: absolute; inset: 0;
      background: rgba(10, 13, 20, 0.72);
      pointer-events: auto;
    }
    .panel {
      position: absolute; left: 50%; top: 50%;
      transform: translate(-50%, -50%);
      box-sizing: border-box;
      display: flex; flex-direction: column;
      max-width: 94vw; max-height: 94vh;
      pointer-events: auto;
      background: #16181d; color: #e9eaee;
      border-radius: 14px; overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.1);
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
                   "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      font-size: 14px; line-height: 1.6; letter-spacing: normal; text-align: start;
      animation: pop 0.16s cubic-bezier(0.2, 0.9, 0.3, 1.1);
    }
    @keyframes pop { from { opacity: 0 } }
    @media (prefers-reduced-motion: reduce) { .panel { animation: none } }

    .bar {
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap; row-gap: 6px;
      padding: 9px 10px 9px 14px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      flex: none;
    }
    .title { font-size: 13px; font-weight: 600; flex: 1 1 auto; white-space: nowrap; }
    .meta {
      font-size: 11.5px; color: rgba(233, 234, 238, 0.45);
      flex: none; white-space: nowrap;
    }
    button.act {
      all: unset; box-sizing: border-box; cursor: pointer; flex: none;
      padding: 4px 10px; border-radius: 7px;
      font-size: 12px; font-weight: 500; color: rgba(233, 234, 238, 0.85);
      background: rgba(255, 255, 255, 0.08);
    }
    button.act:hover { background: rgba(255, 255, 255, 0.15); }
    button.act:disabled { opacity: 0.45; cursor: default; background: rgba(255, 255, 255, 0.08); }
    button.act.primary { color: #111; background: #f59e0b; }
    button.act.primary:hover { background: #fbbf24; }
    button.act.icon { padding: 0; width: 26px; height: 26px; display: grid; place-items: center; }
    button.act:focus-visible { outline: 2px solid #818cf8; outline-offset: 1px; }

    .body {
      flex: 1 1 auto; min-height: 0; overflow: auto;
      display: flex; align-items: center; justify-content: center;
      padding: 14px; background: #0e1014;
    }
    .canvas { position: relative; line-height: 0; }
    .canvas img { display: block; max-width: 100%; height: auto; }
    /* 普通图片缩到窗口内；长图只按宽度显示、纵向滚动，
       否则会被高度压成一条，宽度小到看不清 */
    .canvas:not(.tall) img { max-height: calc(94vh - 80px); }
    /* 长图必须给面板一个明确宽度：面板本来按内容收缩，
       长图的收缩计算会把它挤到很窄（实测只剩 186px）。 */
    select.target, select.fill { font: inherit; max-width: 160px; color: inherit; background: #20232c; border: 1px solid #555; border-radius: 6px; padding: 3px; }
    .panel.tall { width: min(94vw, 860px); }
    .panel.tall .body { align-items: flex-start; }
    .panel.tall .canvas { width: 100%; }
    .panel.tall .canvas img { width: 100%; }
    input.fill-color {
      width: 26px; height: 24px; padding: 0; flex: none; cursor: pointer;
      border: 1px solid #555; border-radius: 6px; background: none;
    }
    .layer { position: absolute; inset: 0; }
    .hide-translation .layer, .picking .layer { display: none; }

    .box { position: absolute; box-sizing: border-box; min-width: 22px; min-height: 17px; }
    .box .fill {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      padding: 1px 3px; overflow: hidden;
      font: 500 12.5px/1.2 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
      color: #fff; text-align: center;
      background: rgba(17, 20, 26, 0.82);
      border-radius: 2px;
    }
    ${Picker.STYLE}`;

  const CLOSE_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
    'stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';


  let panel = null;
  let imageResult = null;
  let generation = 0;
  let controller = null;

  function buildPanel() {
    const host = document.createElement('div');
    host.style.cssText =
      'all: initial; position: fixed !important; inset: 0 !important;' +
      'z-index: 2147483647 !important; display: block !important;' +
      'pointer-events: none !important; color-scheme: dark;';
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = PANEL_STYLE;

    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="backdrop"></div>
      <div class="panel" role="dialog" aria-modal="true" aria-label="图片翻译" tabindex="-1">
        <div class="bar">
          <span class="title">图片翻译</span>
          <span class="meta"></span>
          <select class="target" title="目标语言"></select>
          <select class="fill" title="译文背景">
            <option value="auto">背景：相近色</option>
            <option value="dark">背景：深色半透明</option>
            <option value="white">背景：白色</option>
            <option value="black">背景：黑色</option>
            <option value="custom">背景：自定义</option>
          </select>
          <input class="fill-color" type="color" title="自定义背景色" hidden />
          <button class="act pick" type="button" title="只翻译框出的区域">框选区域</button>
          <button class="act primary done-pick" type="button" hidden>翻译选区</button>
          <button class="act cancel-pick" type="button" hidden>取消</button>
          <button class="act toggle" type="button">显示原图</button>
          <button class="act save" type="button" title="下载带译文的图片">下载</button>
          <button class="act copy" type="button" title="复制带译文的图片">复制图片</button>
          <button class="act icon close" type="button" title="关闭（Esc）" aria-label="关闭">
            ${CLOSE_ICON}
          </button>
        </div>
        <div class="body">
          <div class="canvas"><img alt="" /><div class="layer"></div><div class="pick-layer" hidden></div></div>
        </div>
      </div>`;
    root.append(style);
    while (wrap.firstChild) root.appendChild(wrap.firstChild);
      AITrI18n.localize(root);

    const q = (sel) => root.querySelector(sel);
    panel = {
      host,
      backdrop: q('.backdrop'),
      panel: q('.panel'),
      canvas: q('.canvas'),
      img: q('.canvas img'),
      layer: q('.layer'),
      pickLayer: q('.pick-layer'),
      meta: q('.meta'),
      target: q('.target'),
      fill: q('.fill'),
      fillColor: q('.fill-color'),
      pick: q('.pick'),
      donePick: q('.done-pick'),
      cancelPick: q('.cancel-pick'),
      toggle: q('.toggle'),
      save: q('.save'),
      copy: q('.copy'),
      close: q('.close'),
      open: false,
      picking: false,
      blocks: [],
      metaText: '',
    };
    // 原图跨域时下载、复制按钮的提示会换掉，留一份原来的
    for (const node of [panel.save, panel.copy]) node.dataset.title = node.title;
    panel.picker = Picker.create(panel.pickLayer, {
      max: Regions.MAX_REGIONS,
      deleteLabel: t('删除这个选区'),
      onLimit: () => { panel.meta.textContent = t('最多框选 $1 个区域', [Regions.MAX_REGIONS]); },
    });

    panel.target.addEventListener('change', () => {
      if (imageResult) translateBlocks(imageResult, panel.target.value);
    });
    panel.fill.addEventListener('change', () => {
      panel.fillColor.hidden = panel.fill.value !== 'custom';
      applyFill();
      saveFill();
    });
    panel.fillColor.addEventListener('input', applyFill);
    panel.fillColor.addEventListener('change', saveFill);
    panel.pick.addEventListener('click', () => setPicking(true));
    panel.cancelPick.addEventListener('click', () => {
      // 「先框选」打开的窗口还没有任何译文，取消就是关掉
      if (!panel.blocks.length) { closePanel(); return; }
      generation += 1;
      controller?.abort();
      setBusy(false);
      setPicking(false);
    });
    panel.donePick.addEventListener('click', () => {
      if (!imageResult) return;
      const regions = panel.picker.regions;
      if (regions.length) { translateRegions(imageResult, regions); return; }
      // 选区全删掉了，或者「先框选」时一个没框：翻译整张图
      if (imageResult.groups || !imageResult.merged) {
        translateWhole(imageResult);
        return;
      }
      panel.meta.textContent = t('先在图上拖动鼠标框出要翻译的区域');
    });
    panel.save.addEventListener('click', () => exportImage(false));
    panel.copy.addEventListener('click', () => exportImage(true));
    panel.close.addEventListener('click', closePanel);
    panel.backdrop.addEventListener('mousedown', closePanel);
    panel.toggle.addEventListener('click', () => {
      const hidden = panel.canvas.classList.toggle('hide-translation');
      panel.toggle.textContent = hidden ? t("显示译文") : t("显示原图");
    });

    (document.body || document.documentElement).appendChild(host);
    return panel;
  }

  function onKeydown(event) {
    if (event.key === 'Escape' && panel?.open) {
      event.stopPropagation();
      // 框选时 Esc 只退出框选，不关掉整个窗口
      if (panel.picking) panel.cancelPick.click();
      else closePanel();
    }
  }

  function closePanel() {
    if (!panel) return;
    generation += 1;
    controller?.abort();
    hideMask();
    setPicking(false);
    setBusy(false);
    panel.open = false;
    panel.host.style.setProperty('display', 'none', 'important');
    window.removeEventListener('keydown', onKeydown, true);
  }

  /** 框选模式：藏起译文露出原图，换成「翻译选区 / 取消」两个按钮。 */
  function setPicking(on) {
    if (!panel) return;
    panel.picking = on;
    panel.canvas.classList.toggle('picking', on);
    panel.pickLayer.hidden = !on;
    for (const node of [panel.pick, panel.toggle, panel.save, panel.copy]) node.hidden = on;
    panel.donePick.hidden = !on;
    panel.cancelPick.hidden = !on;
    panel.target.disabled = on;
    if (on) {
      panel.picker.set(imageResult?.regions || []);
      panel.meta.textContent = panel.blocks.length
        ? t('拖动鼠标框出要翻译的区域，可以框多个')
        : t('框出要翻译的区域，可以框多个；不框直接点「翻译选区」就翻译整张图');
    } else panel.meta.textContent = panel.metaText;
  }

  function setBusy(on) {
    if (!panel) return;
    panel.donePick.disabled = on;
    panel.pickLayer.style.pointerEvents = on ? 'none' : '';
  }

  /** 预览的背景色：按选项和每个框采到的相近色重新上色，不用重新采样。 */
  function applyFill() {
    if (!panel) return;
    const mode = panel.fill.value;
    const custom = panel.fillColor.value;
    panel.layer.querySelectorAll('.box').forEach((node, i) => {
      const color = Render.paint(mode, custom, panel.blocks[i]?.sample);
      const fill = node.querySelector('.fill');
      fill.style.background = color.bg;
      fill.style.color = color.fg;
    });
  }

  function saveFill() {
    if (!imageResult) return;
    const patch = { imageFill: panel.fill.value, imageFillColor: panel.fillColor.value };
    Object.assign(imageResult.settings, patch);
    AITrSettings.patchSettings(patch).catch(() => {});
  }

  /** 按框大小自适应字号：两次测量，不循环逼近。选区按原文字号封顶，不会比原文还大。 */
  function fitText(node) {
    const fill = node.querySelector('.fill');
    const w = node.clientWidth;
    const h = node.clientHeight;
    if (!fill || !w || !h) return;
    const hint = Number(node.dataset.fontMax || 0) * panel.canvas.clientHeight;
    const top = hint > 0 ? Math.max(FONT_MIN, hint) : FONT_MAX;
    const clamp = (v) => Math.min(top, Math.max(FONT_MIN, v));
    let size = clamp(h * 0.62);
    fill.style.fontSize = `${size.toFixed(1)}px`;
    if (fill.scrollWidth > w + 1 || fill.scrollHeight > h + 1) {
      const ratio = Math.min(w / Math.max(1, fill.scrollWidth), h / Math.max(1, fill.scrollHeight));
      fill.style.fontSize = `${clamp(size * ratio * 0.95).toFixed(1)}px`;
    }
  }

  /** 高宽比超过这个值就按长图处理。 */
  const TALL_RATIO = 1.6;

  function openPanel({ grabbed, blocks, meta, targetId, settings }) {
    if (!panel) buildPanel();
    if (!panel.host.isConnected) {
      (document.body || document.documentElement).appendChild(panel.host);
    }
    panel.target.replaceChildren(...AITrSettings.targetList().map((item) => {
      const option = document.createElement('option');
      option.value = item.id; option.textContent = item.label;
      option.selected = item.id === targetId;
      return option;
    }));
    const { natural } = grabbed;
    panel.img.src = grabbed.display;
    panel.metaText = meta;
    setPicking(false);
    setBusy(false);
    const tall = Boolean(natural && natural.h / Math.max(1, natural.w) > TALL_RATIO);
    panel.canvas.classList.toggle('tall', tall);
    panel.panel.classList.toggle('tall', tall);
    panel.canvas.classList.remove('hide-translation');
    panel.toggle.textContent = t("显示原图");
    panel.fill.value = settings.imageFill;
    panel.fillColor.value = settings.imageFillColor;
    panel.fillColor.hidden = settings.imageFill !== 'custom';
    // 读不到像素就没法合成新图
    for (const node of [panel.save, panel.copy]) {
      node.disabled = !grabbed.ctx;
      node.title = grabbed.ctx ? node.dataset.title : t('这张图跨域读不到像素，生成不了新图片');
    }

    panel.blocks = blocks.map((item, i) => {
      // 按笔画校正遮盖范围和字号；读不到像素或找不到笔画时退回按框放宽
      const others = blocks.filter((_, j) => j !== i);
      const refined = Render.refineCover(grabbed.ctx, grabbed.width, grabbed.height, item, others);
      const cover = refined?.cover || Render.coverBox(item, natural);
      const sample = grabbed.ctx
        ? Render.sampleAt(grabbed.ctx, {
          x: cover.x * grabbed.width, y: cover.y * grabbed.height,
          w: cover.w * grabbed.width, h: cover.h * grabbed.height,
        }, grabbed.width, grabbed.height)
        : null;
      return { ...item, cover, sample, fontMax: refined?.fontMax ?? item.fontMax };
    });
    panel.layer.replaceChildren(
      ...panel.blocks.map((item) => {
        const node = document.createElement('div');
        node.className = 'box';
        node.style.left = `${item.cover.x * 100}%`;
        node.style.top = `${item.cover.y * 100}%`;
        node.style.width = `${item.cover.w * 100}%`;
        node.style.height = `${item.cover.h * 100}%`;
        if (item.fontMax) node.dataset.fontMax = String(item.fontMax);
        node.title = item.translation;
        const fill = document.createElement('div');
        fill.className = 'fill';
        fill.textContent = item.translation;
        fill.dir = 'auto';
        node.appendChild(fill);
        return node;
      })
    );
    applyFill();

    panel.host.style.setProperty('display', 'block', 'important');
    panel.open = true;
    window.addEventListener('keydown', onKeydown, true);
    panel.panel.focus({ preventScroll: true });

    // 图片要先完成布局，框的像素尺寸才是真的
    const fitAll = () => panel.layer.querySelectorAll('.box').forEach(fitText);
    if (panel.img.complete) requestAnimationFrame(fitAll);
    else panel.img.addEventListener('load', () => requestAnimationFrame(fitAll), { once: true });
  }

  /** 合成带译文的新图，下载或复制到剪贴板。全部在本机完成。 */
  async function exportImage(toClipboard) {
    if (!imageResult || !panel?.blocks.length) return;
    const { grabbed, targetId } = imageResult;
    const button = toClipboard ? panel.copy : panel.save;
    const label = button.textContent;
    const flash = (text) => {
      button.textContent = text;
      setTimeout(() => { button.textContent = label; }, 1400);
    };
    button.disabled = true;
    try {
      const canvas = Render.renderImage(grabbed.source, grabbed.natural, panel.blocks,
        { fill: panel.fill.value, custom: panel.fillColor.value });
      const blob = await Render.toBlob(canvas, { forClipboard: toClipboard });
      if (toClipboard) {
        await Render.copy(blob);
        flash(t('已复制'));
      } else {
        Render.download(blob, Render.fileName(grabbed.display, targetId, blob));
        flash(t('已下载'));
      }
    } catch {
      flash(toClipboard ? t('复制失败') : t('生成图片失败'));
    } finally {
      button.disabled = false;
    }
  }

  function showFailure(message) {
    if (!mask) return;
    mask.label.textContent = message;
    const current = mask;
    setTimeout(() => { if (mask === current) hideMask(); }, 4500); // 提示可能较长，留够阅读时间
  }

  /** 弹窗开着时提示写在标题栏，否则写在图上的遮罩里。 */
  function report(message) {
    if (panel?.open) panel.meta.textContent = message;
    else showFailure(message);
  }

  /* ---------------------------------------------------------- 主流程 */

  /**
   * 翻译当前条目：框选过就是各选区合成的整段，否则是整图识别出的每一行。
   * 成功后才把 result 记为当前结果，失败时弹窗保持原样。
   */
  async function translateBlocks(result, targetId, token = ++generation) {
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;
    const { grabbed, settings } = result;
    const items = result.groups || result.merged;
    const worth = items.filter((b) => Lang.shouldOffer(b.text));
    if (!worth.length) {
      report(result.groups ? t("选区里没有需要翻译的文字")
        : items.length ? t("图中没有需要翻译的文字") : t("图中没有识别到文字"));
      return;
    }
    if (panel) panel.target.disabled = true;
    const busy = t('正在翻译 $1 段…', [worth.length]);
    if (mask) mask.label.textContent = busy;
    if (panel?.open) panel.meta.textContent = busy;
    try {
      const reply = await AITrRequests.request({
        type: 'translate-batch', texts: worth.map((b) => b.text),
        targetId, providerId: settings.provider,
      }, { signal });
      if (token !== generation) return;
      if (!reply?.ok) throw new Error(reply?.error || t('翻译失败'));
      const blocks = worth.map((b, i) => ({ ...b, translation: reply.texts[i] || '' }))
        .filter((b) => b.translation && b.translation.trim() !== b.text.trim());
      hideMask();
      result.targetId = targetId;
      imageResult = result;
      const scope = result.groups ? t('$1 个选区', [result.regions.length]) : '';
      openPanel({ grabbed, blocks, targetId, settings,
        meta: [AITrLanguages.label(targetId), scope, String(blocks.length)].filter(Boolean).join(' · ') });
    } catch (err) {
      if (token !== generation) return;
      if (panel?.open) {
        panel.meta.textContent = String(err?.message || err);
        panel.target.value = imageResult?.targetId || settings.target;
      }
      showFailure(String(err?.message || err));
    } finally {
      if (token === generation && panel && !panel.picking) panel.target.disabled = false;
    }
  }

  /**
   * 只识别框出的区域：读得到像素就从原图裁下来拼成一张图识别（更准，也只发一次请求），
   * 读不到就从整图识别结果里挑出落在选区内的。
   */
  async function translateRegions(result, regions) {
    const token = ++generation;
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;
    const { grabbed, settings } = result;
    setBusy(true);
    panel.meta.textContent = t('正在识别选区…');
    try {
      const found = grabbed.ctx
        ? await Regions.readRegions({
          source: grabbed.source, natural: grabbed.natural, regions, scaleFor: sendScale,
          onProgress: (i, total) => {
            if (total > 1) panel.meta.textContent = t('正在识别选区 $1/$2…', [i + 1, total]);
          },
          read: async (image, imageSize) => {
            const reply = await AITrRequests.request({ type: 'read-image', image, imageSize,
              providerId: settings.provider }, { signal });
            if (!reply?.ok) throw new Error(reply?.error || t('识别失败'));
            return reply.blocks;
          },
        })
        // 读不到像素：先识别整张图（「先框选」时还没识别过），再挑出选区里的
        : Regions.filterByRegions(result.merged || await recognizeWhole(result, signal, token), regions);
      if (token !== generation) return;
      const groups = Regions.groupByRegion(found, regions);
      const merged = result.merged || (grabbed.ctx ? null : lastLines);
      await translateBlocks({ ...result, merged, regions, groups }, panel.target.value, token);
    } catch (err) {
      if (token === generation && err?.name !== 'AbortError') panel.meta.textContent = String(err?.message || err);
    } finally {
      if (token === generation) setBusy(false);
    }
  }

  /** 最近一次整图识别的结果，读不到像素时框选要从这里挑。 */
  let lastLines = null;

  /**
   * 识别整张图（长图分块逐块识别再合并）。进度写在遮罩上，弹窗开着时写在标题栏。
   * 被新的操作打断时返回 null。
   */
  async function recognizeWhole(result, signal, token) {
    const { grabbed, settings } = result;
    const progress = (text) => {
      if (mask) mask.label.textContent = text;
      if (panel?.open) panel.meta.textContent = text;
    };
    const total = grabbed.parts.length;
    const perTile = [];
    for (let i = 0; i < total; i += 1) {
      progress(total > 1 ? t('正在识别 $1/$2…', [i + 1, total]) : t('正在识别图中文字…'));
      const reply = await AITrRequests.request({ type: 'read-image',
        image: grabbed.parts[i].image, imageSize: grabbed.parts[i].size, providerId: settings.provider }, { signal });
      if (token !== generation) return null;
      if (!reply?.ok) {
        throw new Error(grabbed.byUrl
          ? t("这张图取不到（可能是站点防盗链）。可以复制图片后粘贴到「图片翻译」面板")
          : reply?.error || t('识别失败'));
      }
      perTile.push(Tiles.fromSquare(reply.blocks, grabbed.parts[i].frame));
    }
    lastLines = Tiles.mergeBlocks(perTile, grabbed.plan, grabbed.fullHeight);
    return lastLines;
  }

  /** 弹窗里翻译整张图：识别过就直接用，「先框选」时还没识别就先识别。 */
  async function translateWhole(result) {
    const base = { ...result, regions: null, groups: null };
    if (base.merged) {
      translateBlocks(base, panel.target.value);
      return;
    }
    const token = ++generation;
    controller?.abort();
    controller = new AbortController();
    setBusy(true);
    try {
      const merged = await recognizeWhole(base, controller.signal, token);
      if (!merged || token !== generation) return;
      await translateBlocks({ ...base, merged }, panel.target.value, token);
    } catch (err) {
      if (token === generation && err?.name !== 'AbortError') panel.meta.textContent = String(err?.message || err);
    } finally {
      if (token === generation) setBusy(false);
    }
  }

  async function translateImage(srcUrl) {
    const img = findImage(srcUrl);
    if (!img) return;
    const token = ++generation;
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;
    const settings = await AITrSettings.loadSettings();
    if (token !== generation) return;
    showMask(img, t("正在读取图片…"));
    lastLines = null;
    try {
      const grabbed = await grabImage(img);
      if (token !== generation) return;
      if (!grabbed) { showFailure(t("这张图还没加载完")); return; }
      const result = { grabbed, merged: null, settings, regions: null, groups: null, targetId: settings.target };
      if (settings.imageMode === 'select') {
        // 先框选：直接打开窗口露出原图，用户框完再识别，不白识别整张图
        hideMask();
        imageResult = result;
        openPanel({ grabbed, blocks: [], targetId: settings.target, settings, meta: '' });
        setPicking(true);
        return;
      }
      const merged = await recognizeWhole(result, signal, token);
      if (!merged) return;
      await translateBlocks({ ...result, merged }, settings.target, token);
    } catch (err) {
      if (token === generation) showFailure(String(err?.message || err));
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'translate-image') return false;
    translateImage(message.srcUrl);
    return false;
  });
})();
