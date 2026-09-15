/**
 * 页面内图片翻译：右键图片 →「翻译图片」→ 图上盖遮罩转圈 →
 * 完成后弹出大窗口，译文按识别到的位置盖在图上。
 *
 * 独立于 content.js（划词）和 elements.js（元素翻译）：自己的事件、
 * 自己的 shadow 宿主，互不引用。
 */
(() => {
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
    try {
      canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      canvas.getContext('2d').drawImage(img, 0, 0, sw, sh);
      // 探测画布有没有被跨域图片污染。读一个像素就够，
      // 用 toDataURL 试探会把整张大图白编码一遍。
      canvas.getContext('2d').getImageData(0, 0, 1, 1);
    } catch {
      canvas = null;
    }
    if (!canvas) {
      const fresh = await reloadWithCors(url);
      if (fresh) {
        try {
          canvas = document.createElement('canvas');
          canvas.width = sw;
          canvas.height = sh;
          canvas.getContext('2d').drawImage(fresh, 0, 0, sw, sh);
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
    if (!Tiles.needsTiling(sw, sh)) {
      return {
        parts: [{ image: canvas.toDataURL('image/jpeg', 0.9), size: { width: sw, height: sh } }],
        plan: [{ top: 0, height: sh }],
        fullHeight: sh,
        display: url,
        natural,
      };
    }

    // 长图：先扫每行墨水量，把切缝挪到空白处，再切
    const plan = Tiles.refinePlan(
      Tiles.planTiles(sw, sh),
      Tiles.rowDarkness(ctx, sw, sh),
      sh
    );
    const images = Tiles.cutTiles(canvas, sw, sh, plan);
    if (!images) {
      return {
        parts: [{ image: canvas.toDataURL('image/jpeg', 0.9), size: { width: sw, height: sh } }],
        plan: [{ top: 0, height: sh }],
        fullHeight: sh,
        display: url,
        natural,
      };
    }
    return {
      parts: images.map((image, i) => ({
        image,
        size: { width: sw, height: plan[i].height },
      })),
      plan,
      fullHeight: sh,
      display: url,
      natural,
      tiled: true,
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
      font-size: 14px; line-height: 1.6; letter-spacing: normal; text-align: left;
      animation: pop 0.16s cubic-bezier(0.2, 0.9, 0.3, 1.1);
    }
    @keyframes pop { from { opacity: 0 } }
    @media (prefers-reduced-motion: reduce) { .panel { animation: none } }

    .bar {
      display: flex; align-items: center; gap: 10px;
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
    .panel.tall { width: min(94vw, 860px); }
    .panel.tall .body { align-items: flex-start; }
    .panel.tall .canvas { width: 100%; }
    .panel.tall .canvas img { width: 100%; }
    .layer { position: absolute; inset: 0; }
    .hide-translation .layer { display: none; }

    .box { position: absolute; box-sizing: border-box; min-width: 22px; min-height: 17px; }
    .box .fill {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      padding: 1px 3px; overflow: hidden;
      font: 500 12.5px/1.2 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
      color: #fff; text-align: center;
      background: rgba(17, 20, 26, 0.82);
      border-radius: 2px;
    }`;

  const CLOSE_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
    'stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  let panel = null;

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
          <button class="act toggle" type="button">显示原图</button>
          <button class="act icon close" type="button" title="关闭（Esc）" aria-label="关闭">
            ${CLOSE_ICON}
          </button>
        </div>
        <div class="body">
          <div class="canvas"><img alt="" /><div class="layer"></div></div>
        </div>
      </div>`;
    root.append(style);
    while (wrap.firstChild) root.appendChild(wrap.firstChild);

    const q = (sel) => root.querySelector(sel);
    panel = {
      host,
      backdrop: q('.backdrop'),
      panel: q('.panel'),
      canvas: q('.canvas'),
      img: q('.canvas img'),
      layer: q('.layer'),
      meta: q('.meta'),
      toggle: q('.toggle'),
      close: q('.close'),
      open: false,
    };

    panel.close.addEventListener('click', closePanel);
    panel.backdrop.addEventListener('mousedown', closePanel);
    panel.toggle.addEventListener('click', () => {
      const hidden = panel.canvas.classList.toggle('hide-translation');
      panel.toggle.textContent = hidden ? '显示译文' : '显示原图';
    });

    (document.body || document.documentElement).appendChild(host);
    return panel;
  }

  function onKeydown(event) {
    if (event.key === 'Escape' && panel?.open) {
      event.stopPropagation();
      closePanel();
    }
  }

  function closePanel() {
    if (!panel) return;
    panel.open = false;
    panel.host.style.setProperty('display', 'none', 'important');
    window.removeEventListener('keydown', onKeydown, true);
  }

  /** 按框大小自适应字号：两次测量，不循环逼近。 */
  function fitText(node) {
    const fill = node.querySelector('.fill');
    const w = node.clientWidth;
    const h = node.clientHeight;
    if (!fill || !w || !h) return;
    const clamp = (v) => Math.min(FONT_MAX, Math.max(FONT_MIN, v));
    let size = clamp(h * 0.62);
    fill.style.fontSize = `${size.toFixed(1)}px`;
    if (fill.scrollWidth > w + 1 || fill.scrollHeight > h + 1) {
      const ratio = Math.min(w / Math.max(1, fill.scrollWidth), h / Math.max(1, fill.scrollHeight));
      fill.style.fontSize = `${clamp(size * ratio * 0.95).toFixed(1)}px`;
    }
  }

  /** 高宽比超过这个值就按长图处理。 */
  const TALL_RATIO = 1.6;

  function openPanel({ display, blocks, meta, natural }) {
    if (!panel) buildPanel();
    if (!panel.host.isConnected) {
      (document.body || document.documentElement).appendChild(panel.host);
    }
    panel.img.src = display;
    panel.meta.textContent = meta;
    const tall = Boolean(natural && natural.h / Math.max(1, natural.w) > TALL_RATIO);
    panel.canvas.classList.toggle('tall', tall);
    panel.panel.classList.toggle('tall', tall);
    panel.canvas.classList.remove('hide-translation');
    panel.toggle.textContent = '显示原图';

    panel.layer.replaceChildren(
      ...blocks.map((item) => {
        const node = document.createElement('div');
        node.className = 'box';
        node.style.left = `${item.box.x * 100}%`;
        node.style.top = `${item.box.y * 100}%`;
        node.style.width = `${item.box.w * 100}%`;
        node.style.height = `${item.box.h * 100}%`;
        node.title = item.translation;
        const fill = document.createElement('div');
        fill.className = 'fill';
        fill.textContent = item.translation;
        node.appendChild(fill);
        return node;
      })
    );

    panel.host.style.setProperty('display', 'block', 'important');
    panel.open = true;
    window.addEventListener('keydown', onKeydown, true);
    panel.panel.focus({ preventScroll: true });

    // 图片要先完成布局，框的像素尺寸才是真的
    const fitAll = () => panel.layer.querySelectorAll('.box').forEach(fitText);
    if (panel.img.complete) requestAnimationFrame(fitAll);
    else panel.img.addEventListener('load', () => requestAnimationFrame(fitAll), { once: true });
  }

  function showFailure(message) {
    if (!mask) return;
    mask.label.textContent = message;
    setTimeout(hideMask, 4500); // 提示可能较长，留够阅读时间
  }

  /* ---------------------------------------------------------- 主流程 */

  async function translateImage(srcUrl) {
    const img = findImage(srcUrl);
    if (!img) return;

    showMask(img, '正在读取图片…');
    try {
      const grabbed = await grabImage(img);
      if (!grabbed) {
        showFailure('这张图还没加载完');
        return;
      }

      // 逐块识别。长图切成多块后每块比例正常，定位更准，
      // 也各自独享接口的单图 token 预算，小字更清楚。
      const total = grabbed.parts.length;
      const perTile = [];
      for (let i = 0; i < total; i += 1) {
        mask.label.textContent =
          total > 1 ? `正在识别 ${i + 1}/${total}…` : '正在识别图中文字…';
        const reply = await chrome.runtime.sendMessage({
          type: 'read-image',
          image: grabbed.parts[i].image,
          imageSize: grabbed.parts[i].size,
        });
        if (!reply?.ok) {
          // 读不到像素只能把网址交给接口去取，这时若站点有防盗链就会失败。
          // 后台代取需要 <all_urls> 权限，代价太大；复制图片再粘贴到
          // 翻译面板可以绕开，所以把这条出路直接告诉用户。
          showFailure(
            grabbed.byUrl
              ? '这张图取不到（可能是站点防盗链）。可以复制图片后粘贴到「图片翻译」面板'
              : reply?.error || '识别失败'
          );
          return;
        }
        perTile.push(reply.blocks);
      }

      const merged = Tiles.mergeBlocks(perTile, grabbed.plan, grabbed.fullHeight);
      // 星级、价格、尺码这类纯数字符号翻了也是原样返回，白花 token
      const worth = merged.filter((b) => Lang.shouldOffer(b.text));
      if (!worth.length) {
        showFailure(merged.length ? '图中没有需要翻译的文字' : '图中没有识别到文字');
        return;
      }

      mask.label.textContent = `正在翻译 ${worth.length} 段…`;
      const reply = await chrome.runtime.sendMessage({
        type: 'translate-batch',
        texts: worth.map((b) => b.text),
      });
      if (!reply?.ok) {
        showFailure(reply?.error || '翻译失败');
        return;
      }

      const blocks = worth
        .map((b, i) => ({ ...b, translation: reply.texts[i] || '' }))
        // 译文和原文一模一样的，盖上去只是挡住原图
        .filter((b) => b.translation && b.translation.trim() !== b.text.trim());
      if (!blocks.length) {
        showFailure('图中没有需要翻译的文字');
        return;
      }

      hideMask();
      openPanel({
        display: grabbed.display,
        natural: grabbed.natural,
        blocks,
        meta: [
          `${blocks.length} 段`,
          grabbed.tiled ? `分 ${total} 块识别` : '',
          grabbed.byUrl ? '按网址取图' : '',
        ].filter(Boolean).join(' · '),
      });
    } catch (err) {
      showFailure(String(err?.message || err));
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'translate-image') return false;
    translateImage(message.srcUrl);
    return false;
  });
})();
