/**
 * 把译文画回图上：取相近背景色、选文字颜色、断行定字号，以及合成整张新图。
 *
 * 弹窗预览（DOM 覆盖层）和导出的图片用同一套配色和遮盖范围，
 * 看到的就是下载的。全部在本机完成，图片不会因为导出而上传。
 *
 * 纯计算部分不依赖 DOM，可以单独测；renderImage / toBlob 需要 canvas。
 * 与 tiles.js 一样不能出现 import / export。
 */
(() => {
  /** 背景色选项：自动取相近色、深色半透明（旧样式）、白、黑、自定义。 */
  const FILLS = ['auto', 'dark', 'white', 'black', 'custom'];
  const DARK = { bg: 'rgba(17, 20, 26, 0.82)', fg: '#ffffff' };
  const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", ' +
    '"Hiragino Sans GB", "Microsoft YaHei", "Noto Sans", sans-serif';
  const LINE_HEIGHT = 1.2;
  /** Chrome 画布的单边与总面积上限，超过会画不出来（toBlob 得到 null）。 */
  const MAX_SIDE = 16384;
  const MAX_AREA = 120000000;
  /** 识别框往往贴着笔画，四周放出一点，免得露出原文的边角。 */
  const LINE_PAD = 0.12;
  /** 整段按行高放出的比例：整段译文往往比原文长，要留点地方。 */
  const REGION_PAD = 0.3;

  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const toHex = ({ r, g, b }) =>
    `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

  function parseHex(value) {
    const m = /^#([0-9a-f]{6})$/i.exec(String(value || ''));
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return { r: n >> 16, g: (n >> 8) & 255, b: n & 255 };
  }

  /** WCAG 相对亮度。 */
  function luminance({ r, g, b }) {
    const lin = (v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }

  /** 黑字和白字里对比度更高的那个。 */
  function textColorFor(rgb) {
    const l = luminance(rgb);
    return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? '#111111' : '#ffffff';
  }

  /**
   * 选项 + 采样结果 → 实际的背景色与文字颜色。
   * 「自动」取不到颜色（跨域读不到像素）时退回深色半透明。
   */
  function paint(mode, custom, sampled) {
    if (mode === 'white') return { bg: '#ffffff', fg: '#111111' };
    if (mode === 'black') return { bg: '#000000', fg: '#ffffff' };
    if (mode === 'custom') {
      const c = parseHex(custom) || { r: 255, g: 255, b: 255 };
      return { bg: toHex(c), fg: textColorFor(c) };
    }
    if (mode === 'auto' && sampled) return { bg: toHex(sampled), fg: textColorFor(sampled) };
    return DARK;
  }

  /**
   * 若干条像素带里最常见的颜色，作为「相近色」。
   * 颜色先量化（每通道 16 级）再取众数，桶内取真实平均值：
   * 文字笔画、噪点、轻微渐变都不会把结果拉偏。
   * @param {Array<{data: Uint8ClampedArray}>} strips ImageData 一类的对象
   * @returns {{r:number,g:number,b:number}|null}
   */
  function dominantColor(strips) {
    const buckets = new Map();
    for (const strip of strips) {
      const data = strip?.data;
      if (!data) continue;
      const pixels = data.length >> 2;
      // 大选区的边很长，抽样到一两千个点就足够稳定
      const step = Math.max(1, Math.floor(pixels / 1500));
      for (let i = 0; i < pixels; i += step) {
        const p = i << 2;
        if (data[p + 3] < 16) continue; // 透明像素没有颜色可言
        const key = ((data[p] >> 4) << 8) | ((data[p + 1] >> 4) << 4) | (data[p + 2] >> 4);
        let bucket = buckets.get(key);
        if (!bucket) buckets.set(key, (bucket = { n: 0, r: 0, g: 0, b: 0 }));
        bucket.n += 1;
        bucket.r += data[p];
        bucket.g += data[p + 1];
        bucket.b += data[p + 2];
      }
    }
    let best = null;
    for (const bucket of buckets.values()) if (!best || bucket.n > best.n) best = bucket;
    return best ? { r: best.r / best.n, g: best.g / best.n, b: best.b / best.n } : null;
  }

  /**
   * 文字框外沿四条像素带的位置（像素）。只看外沿不看框内：框内是笔画，
   * 混进来会让背景色偏向文字颜色。框贴着图片边缘时那一侧没有外沿，
   * 四边都没有（选区就是整张图）才退回框内的一圈。
   */
  function ringStrips(rect, width, height, band = 4) {
    const x0 = Math.max(0, Math.floor(rect.x));
    const y0 = Math.max(0, Math.floor(rect.y));
    const x1 = Math.min(width, Math.ceil(rect.x + rect.w));
    const y1 = Math.min(height, Math.ceil(rect.y + rect.h));
    const left = Math.max(0, x0 - band);
    const right = Math.min(width, x1 + band);
    const outside = [
      { x: left, y: Math.max(0, y0 - band), w: right - left, h: y0 - Math.max(0, y0 - band) },
      { x: left, y: y1, w: right - left, h: Math.min(height, y1 + band) - y1 },
      { x: left, y: y0, w: x0 - left, h: y1 - y0 },
      { x: x1, y: y0, w: right - x1, h: y1 - y0 },
    ].filter((s) => s.w > 0 && s.h > 0);
    if (outside.length) return outside;
    const inner = Math.max(1, Math.min(band, Math.floor((x1 - x0) / 4), Math.floor((y1 - y0) / 4)));
    return [
      { x: x0, y: y0, w: x1 - x0, h: inner },
      { x: x0, y: y1 - inner, w: x1 - x0, h: inner },
    ].filter((s) => s.w > 0 && s.h > 0);
  }

  /** 在画布上取一个框的相近色（像素坐标）。画布被跨域污染时返回 null。 */
  function sampleAt(ctx, rect, width, height) {
    try {
      return dominantColor(ringStrips(rect, width, height).map((s) => ctx.getImageData(s.x, s.y, s.w, s.h)));
    } catch {
      return null;
    }
  }

  /**
   * 实际遮盖的范围（0-1 相对坐标）。识别出的单行文字四周放出一点，免得露出原文边角；
   * 合成的整段（选区里的文字、AI 分出的段落）盖住各行的外接框，按行高多放出一些，
   * 整段译文往往比原文长，不至于贴边。选区里的段限制在选区以内；
   * 选区里没有文字坐标可依时铺满选区。
   */
  function coverBox(item, natural) {
    const region = item.region != null;
    const grouped = item.textBox != null;
    if (!natural?.w || !natural?.h || (region && !grouped)) return item.box;
    const base = grouped ? item.textBox : item.box;
    const lineHeight = grouped && item.fontMax ? item.fontMax : base.h;
    const padPx = Math.max(1, lineHeight * natural.h * (grouped ? REGION_PAD : LINE_PAD));
    const px = padPx / natural.w;
    const py = padPx / natural.h;
    const bound = region ? item.box : { x: 0, y: 0, w: 1, h: 1 };
    const x0 = Math.max(bound.x, base.x - px);
    const y0 = Math.max(bound.y, base.y - py);
    const x1 = Math.min(bound.x + bound.w, base.x + base.w + px);
    const y1 = Math.min(bound.y + bound.h, base.y + base.h + py);
    return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
  }

  /* ------------------------------------------------------ 按笔画校正 */

  /** 与底色差多少算笔画（各通道最大差值）。JPEG 噪点一般在 20 以内，灰色网点约 40。 */
  const INK_DIFF = 64;

  /**
   * 在一块像素里找出文字笔画的外接框。
   * 视觉模型给的坐标只是大致位置（竖排漫画上常偏出半个对话框），直接拿来遮盖
   * 会盖歪、露出原文。这里以窗口里最常见的颜色为底色，偏离底色的像素算笔画，
   * 按小格子连成块：
   *   - 很大又很稀疏的块是对话框描边，很大且碰到窗口边缘的是跨进来的画面，都不算；
   *   - 从提示框里的块出发，把离得不远的块逐个并进来（同一段文字的字挨得近）。
   * @param {Uint8ClampedArray} data 窗口的 RGBA 像素
   * @param {{x,y,w,h}} hint 窗口内的提示范围（像素）：模型给的框，或用户画的选区
   * @param {Array<{x,y,w,h}>} [others] 窗口内其他文字块的提示范围：更靠近它们的笔画归它们
   * @returns {{x,y,w,h,glyph:number}|null} 窗口内像素坐标；glyph 是单个字的大致尺寸
   */
  function inkBox(data, width, height, hint, others = []) {
    const bg = dominantColor([{ data }]);
    if (!bg || width < 4 || height < 4) return null;
    // 格子边长：窗口长边分成约 240 格，几百万像素的窗口也只要几毫秒
    const cell = Math.max(1, Math.ceil(Math.max(width, height) / 240));
    const cw = Math.ceil(width / cell);
    const ch = Math.ceil(height / cell);
    const ink = new Uint8Array(cw * ch);
    // 每格笔画像素的颜色总和：文字通常一个颜色，旁边的插画颜色不同
    const color = new Float32Array(cw * ch * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const p = (y * width + x) << 2;
        if (data[p + 3] < 16) continue;
        const diff = Math.max(Math.abs(data[p] - bg.r), Math.abs(data[p + 1] - bg.g), Math.abs(data[p + 2] - bg.b));
        if (diff <= INK_DIFF) continue;
        const i = ((y / cell) | 0) * cw + ((x / cell) | 0);
        ink[i] = 1;
        color[i * 4] += data[p];
        color[i * 4 + 1] += data[p + 1];
        color[i * 4 + 2] += data[p + 2];
        color[i * 4 + 3] += 1;
      }
    }

    // 八连通找块
    const label = new Int32Array(cw * ch).fill(-1);
    const parts = [];
    const stack = [];
    for (let start = 0; start < ink.length; start += 1) {
      if (!ink[start] || label[start] >= 0) continue;
      const part = { x0: cw, y0: ch, x1: -1, y1: -1, cells: 0, edge: false, r: 0, g: 0, b: 0, n: 0 };
      label[start] = parts.length;
      stack.push(start);
      while (stack.length) {
        const i = stack.pop();
        const x = i % cw;
        const y = (i / cw) | 0;
        part.cells += 1;
        part.r += color[i * 4];
        part.g += color[i * 4 + 1];
        part.b += color[i * 4 + 2];
        part.n += color[i * 4 + 3];
        if (x < part.x0) part.x0 = x;
        if (x > part.x1) part.x1 = x;
        if (y < part.y0) part.y0 = y;
        if (y > part.y1) part.y1 = y;
        if (x === 0 || y === 0 || x === cw - 1 || y === ch - 1) part.edge = true;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
            const j = ny * cw + nx;
            if (ink[j] && label[j] < 0) {
              label[j] = parts.length;
              stack.push(j);
            }
          }
        }
      }
      parts.push(part);
    }

    const dims = (p) => [p.x1 - p.x0 + 1, p.y1 - p.y0 + 1];
    // 描边、圆圈是细细的一圈：外接框不小、实际笔画格子很少
    const sparse = (p) => {
      const [pw, ph] = dims(p);
      return Math.max(pw, ph) > 6 && p.cells / (pw * ph) < 0.12;
    };
    let keep = parts.filter((p) => {
      const [pw, ph] = dims(p);
      if ((pw > cw * 0.4 || ph > ch * 0.4) && p.edge) return false; // 从窗口外伸进来的画面
      if ((pw > cw * 0.6 || ph > ch * 0.6) && sparse(p)) return false; // 对话框描边
      return true;
    });
    if (!keep.length) return null;

    // 单个字的大致尺寸：各块长边的四分之三分位（注音假名和笔画断开的汉字会偏小），
    // 不算描边和圆圈
    const sizes = (keep.some((p) => !sparse(p)) ? keep.filter((p) => !sparse(p)) : keep)
      .map((p) => Math.max(...dims(p))).sort((a, b) => a - b);
    const glyph = sizes[Math.floor(sizes.length * 0.75)];
    // 单个字的块不会太大：横竖都比字大得多的是画面、圆圈或描边；
    // 一边比两个字还长、另一边又细的是线条（心里话两侧的波浪线、速度线）
    keep = keep.filter((p) => {
      const [pw, ph] = dims(p);
      if (pw > glyph * 2.5 && ph > glyph * 2.5) return false;
      return !(Math.max(pw, ph) > glyph * 2 && Math.min(pw, ph) < glyph * 0.35);
    });
    if (!keep.length) return null;

    // 模型给的相邻两个框常常互相重叠：笔画中心落在别的框里、又离那个框的中心更近，就归那个框
    const center = (b) => [(b.x + b.w / 2) / cell, (b.y + b.h / 2) / cell];
    const [ox, oy] = center(hint);
    const foreign = others.map((o) => ({ o, c: center(o) }));
    keep = keep.filter((p) => {
      const px = (p.x0 + p.x1 + 1) / 2;
      const py = (p.y0 + p.y1 + 1) / 2;
      const own = Math.hypot(px - ox, py - oy);
      return !foreign.some(({ o, c }) =>
        px >= o.x / cell && px <= (o.x + o.w) / cell && py >= o.y / cell && py <= (o.y + o.h) / cell &&
        Math.hypot(px - c[0], py - c[1]) < own);
    });
    if (!keep.length) return null;

    // 从提示框里的块出发，逐个并进离得不远的块
    const hx0 = hint.x / cell;
    const hy0 = hint.y / cell;
    const hx1 = (hint.x + hint.w) / cell;
    const hy1 = (hint.y + hint.h) / cell;
    // 最多超出提示框一个半字（大框按比例多放一些）：旁边的画面线条离字再近也并不过来
    const reach = Math.max(glyph * 1.5, Math.max(hx1 - hx0, hy1 - hy0) * 0.15);
    const within = (p) => p.x0 >= hx0 - reach && p.x1 <= hx1 + reach && p.y0 >= hy0 - reach && p.y1 <= hy1 + reach;
    const inHint = (p) => p.x1 >= hx0 && p.x0 <= hx1 && p.y1 >= hy0 && p.y0 <= hy1;
    let chosen = keep.filter(inHint);
    if (!chosen.length) return null;
    // 文字的颜色：提示框里「笔画量 × 与底色的反差」最大的那种颜色——文字一般是反差最大的，
    // 旁边的彩色插画（白板上画的河）反差小；颜色差太多的不并进来
    const tone = (p) => ({ r: p.r / p.n, g: p.g / p.n, b: p.b / p.n });
    const gap3 = (a, b) => Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
    const far = (a, b) => gap3(a, b) > 90;
    const weight = (p) => p.n * gap3(tone(p), bg);
    const main = tone(chosen.reduce((m, p) => (weight(p) > weight(m) ? p : m)));
    chosen = chosen.filter((p) => !far(tone(p), main));
    keep = keep.filter((p) => !far(tone(p), main));
    const box = {
      x0: Math.min(...chosen.map((p) => p.x0)), y0: Math.min(...chosen.map((p) => p.y0)),
      x1: Math.max(...chosen.map((p) => p.x1)), y1: Math.max(...chosen.map((p) => p.y1)),
    };
    const gap = glyph * 0.8;
    let rest = keep.filter((p) => !chosen.includes(p));
    for (let grew = true; grew;) {
      grew = false;
      rest = rest.filter((p) => {
        if (!within(p)) return true;
        const near = p.x0 <= box.x1 + gap && p.x1 >= box.x0 - gap && p.y0 <= box.y1 + gap && p.y1 >= box.y0 - gap;
        if (!near) return true;
        box.x0 = Math.min(box.x0, p.x0);
        box.y0 = Math.min(box.y0, p.y0);
        box.x1 = Math.max(box.x1, p.x1);
        box.y1 = Math.max(box.y1, p.y1);
        grew = true;
        return false;
      });
    }
    const x = box.x0 * cell;
    const y = box.y0 * cell;
    return {
      x, y,
      w: Math.min(width, (box.x1 + 1) * cell) - x,
      h: Math.min(height, (box.y1 + 1) * cell) - y,
      glyph: glyph * cell,
    };
  }

  /**
   * 按笔画校正遮盖范围和字号上限（0-1 相对坐标）。
   * 选区：窗口就是选区本身，完全不依赖模型坐标；
   * 识别结果：窗口是模型给的框四周放宽一圈，框偏了也找得到。
   * 读不到像素或找不到笔画时返回 null，调用方退回 coverBox。
   * @param ctx 送检那份画布（未被跨域污染）
   */
  /**
   * @param others 其他文字块（同样的 item 结构），相邻的框互相重叠时用来分清笔画归谁
   */
  function refineCover(ctx, width, height, item, others = []) {
    const region = item.region != null;
    const hint = region ? item.box : item.textBox || item.box;
    if (!ctx || !hint) return null;
    const grow = region ? 0 : 0.35;
    const wx0 = Math.max(0, Math.floor((hint.x - hint.w * grow - 0.01) * width));
    const wy0 = Math.max(0, Math.floor((hint.y - hint.h * grow - 0.01) * height));
    const wx1 = Math.min(width, Math.ceil((hint.x + hint.w * (1 + grow) + 0.01) * width));
    const wy1 = Math.min(height, Math.ceil((hint.y + hint.h * (1 + grow) + 0.01) * height));
    if (wx1 - wx0 < 6 || wy1 - wy0 < 6) return null;
    let data;
    try {
      data = ctx.getImageData(wx0, wy0, wx1 - wx0, wy1 - wy0).data;
    } catch {
      return null;
    }
    const ellipse = ellipseOf(item);
    if (ellipse) {
      // 圆形选区：圆外的像素当透明，既不算底色也不算笔画
      const ww = wx1 - wx0;
      const cx = (ellipse.x + ellipse.w / 2) * width - wx0;
      const cy = (ellipse.y + ellipse.h / 2) * height - wy0;
      const rx = Math.max(1, (ellipse.w / 2) * width);
      const ry = Math.max(1, (ellipse.h / 2) * height);
      for (let y = 0; y < wy1 - wy0; y += 1) {
        for (let x = 0; x < ww; x += 1) {
          const dx = (x + 0.5 - cx) / rx;
          const dy = (y + 0.5 - cy) / ry;
          if (dx * dx + dy * dy > 1) data[((y * ww + x) << 2) + 3] = 0;
        }
      }
    }
    const toWindow = (b) => ({ x: b.x * width - wx0, y: b.y * height - wy0, w: b.w * width, h: b.h * height });
    const otherHints = others
      .map((o) => (o.region != null ? o.box : o.textBox || o.box))
      .filter((b) => b && b !== hint)
      .map(toWindow);
    const found = inkBox(data, wx1 - wx0, wy1 - wy0, toWindow(hint), otherHints);
    if (!found) return null;
    // 四周留出约三分之一个字，盖住笔画的抗锯齿边缘，译文也不贴边
    const pad = Math.max(2, found.glyph * 0.35);
    const bound = region ? item.box : { x: 0, y: 0, w: 1, h: 1 };
    const x0 = Math.max(bound.x, (wx0 + found.x - pad) / width);
    const y0 = Math.max(bound.y, (wy0 + found.y - pad) / height);
    const x1 = Math.min(bound.x + bound.w, (wx0 + found.x + found.w + pad) / width);
    const y1 = Math.min(bound.y + bound.h, (wy0 + found.y + found.h + pad) / height);
    if (x1 <= x0 || y1 <= y0) return null;
    return { cover: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, fontMax: found.glyph / height };
  }

  /** 圆形选区的外接框（0-1）；不是圆形选区时返回 null。 */
  const ellipseOf = (item) => (item?.region != null && item.shape === 'ellipse' ? item.box : null);

  /**
   * 译文的排版范围：圆形选区里取遮盖范围和圆的内接矩形的交集，免得字落到圆外被裁掉；
   * 交集太小（遮盖范围贴着圆边）时仍用遮盖范围。
   */
  function textArea(item, cover) {
    const e = ellipseOf(item);
    if (!e) return cover;
    const k = Math.SQRT1_2;
    const inner = { x: e.x + (e.w * (1 - k)) / 2, y: e.y + (e.h * (1 - k)) / 2, w: e.w * k, h: e.h * k };
    const x0 = Math.max(cover.x, inner.x);
    const y0 = Math.max(cover.y, inner.y);
    const x1 = Math.min(cover.x + cover.w, inner.x + inner.w);
    const y1 = Math.min(cover.y + cover.h, inner.y + inner.h);
    if (x1 <= x0 || y1 <= y0 || (x1 - x0) * (y1 - y0) < cover.w * cover.h * 0.3) return cover;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /**
   * 预览覆盖层（DOM）里圆形选区的样式：clip-path 把铺底裁成圆，padding 把文字收进内接矩形。
   * @param base 覆盖层元素的包含块宽度（0-1）：padding 的百分比都按它的宽度算
   * @returns {{clipPath:string, padding:string}|null}
   */
  function overlayShape(item, cover, natural, base = cover.w) {
    const e = ellipseOf(item);
    if (!e || !cover.w || !cover.h || !natural?.w) return null;
    const pct = (v) => `${(v * 100).toFixed(3)}%`;
    const clipPath = `ellipse(${pct(e.w / 2 / cover.w)} ${pct(e.h / 2 / cover.h)} at ` +
      `${pct((e.x + e.w / 2 - cover.x) / cover.w)} ${pct((e.y + e.h / 2 - cover.y) / cover.h)})`;
    const t = textArea(item, cover);
    const across = base * natural.w;
    const padding = [
      ((t.y - cover.y) * natural.h) / across,
      ((cover.x + cover.w - t.x - t.w) * natural.w) / across,
      ((cover.y + cover.h - t.y - t.h) * natural.h) / across,
      ((t.x - cover.x) * natural.w) / across,
    ].map((v) => pct(Math.max(0, v))).join(' ');
    return { clipPath, padding };
  }

  const toPixels = (box, width, height) => ({
    x: box.x * width, y: box.y * height, w: box.w * width, h: box.h * height,
  });

  /* ---------------------------------------------------------- 排版 */

  const wordSegmenter =
    typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null;
  const graphemeSegmenter =
    typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

  /** 可以断行的最小单位：拉丁文字按词（带上后面的空格），中日文按字。 */
  function pieces(text) {
    if (wordSegmenter) return [...wordSegmenter.segment(text)].map((s) => s.segment);
    return text.split(/(?<=\s)/);
  }
  const graphemes = (text) =>
    graphemeSegmenter ? [...graphemeSegmenter.segment(text)].map((s) => s.segment) : [...text];

  /** 整行只有左引号、左括号。 */
  const OPENERS = /^[“‘「『（【《〈(]+$/;
  /** 中文标点不放在行首：把它挂到上一行末尾。 */
  const NO_LINE_START = /^[，。、；：？！）】」』》〉…”’,.;:?!)\]}%]/;

  function wrap(text, width, size, measure) {
    const lines = [];
    const fits = (s) => measure(s, size) <= width;
    for (const paragraph of String(text).split('\n')) {
      let line = '';
      const push = () => {
        // 左引号、左括号不留在行尾，挪到下一行开头
        const opener = /[“‘「『（【《〈(]+$/.exec(line.trimEnd());
        const head = opener && opener.index > 0 ? line.trimEnd().slice(0, opener.index) : line;
        const done = head.trimEnd();
        if (done) lines.push(done);
        line = head === line ? '' : opener[0];
      };
      // 一个词比整行还宽：按字强行断开
      const breakLong = (piece) => {
        for (const ch of graphemes(piece)) {
          if (line && !fits(line + ch) && !NO_LINE_START.test(ch)) push();
          line += ch;
        }
      };
      for (const piece of pieces(paragraph)) {
        if (fits((line + piece).trimEnd()) || (line && NO_LINE_START.test(piece))) {
          line = line ? line + piece : piece.trimStart();
          continue;
        }
        // 行里只剩挪过来的左引号时不能单独成行，接着按字断开
        if (!OPENERS.test(line)) push();
        // push 之后 line 里可能是从上一行挪过来的左引号
        const head = line ? piece : piece.trimStart();
        if (fits((line + head).trimEnd())) line += head;
        else breakLong(head);
      }
      push();
    }
    return lines;
  }

  /** 挂在行尾的标点允许超出一点，不算放不下。 */
  const HANGING = /[，。、；：？！）】」』》〉…”’,.;:?!)\]}%]+$/;

  /**
   * 在 width×height 里排下文字：二分找能放下的最大字号。
   * @param {(text:string, size:number)=>number} measure 文本宽度（像素）
   * @returns {{size:number, lines:string[], lineHeight:number}}
   */
  function layoutText(text, width, height, measure, { min = 6, max = Infinity } = {}) {
    const fits = (size) => {
      const lines = wrap(text, width, size, measure);
      const ok = lines.length * size * LINE_HEIGHT <= height &&
        lines.every((line) => measure(line.replace(HANGING, ''), size) <= width + 0.5);
      return { ok, lines };
    };
    let lo = min;
    let hi = Math.max(min, Math.min(max, height / LINE_HEIGHT));
    let best = { size: lo, lines: wrap(text, width, lo, measure) };
    const top = fits(hi);
    if (top.ok) return { size: hi, lines: top.lines, lineHeight: hi * LINE_HEIGHT };
    for (let i = 0; i < 14 && hi - lo > 0.25; i += 1) {
      const mid = (lo + hi) / 2;
      const attempt = fits(mid);
      if (attempt.ok) {
        best = { size: mid, lines: attempt.lines };
        lo = mid;
      } else hi = mid;
    }
    return { ...best, lineHeight: best.size * LINE_HEIGHT };
  }

  const RTL = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/;

  /* ---------------------------------------------------------- 导出 */

  /** 导出尺寸：原图分辨率，超过画布上限时等比缩小。 */
  function exportSize(w, h) {
    const scale = Math.min(1, MAX_SIDE / Math.max(w, h), Math.sqrt(MAX_AREA / (w * h)));
    return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
  }

  /**
   * 合成一张带译文的新图。
   * @param {CanvasImageSource} source 原图（不能被跨域污染，否则导出时报错）
   * @param {{w:number,h:number}} natural 原图像素尺寸
   * @param {Array<{box:object, translation:string, region?:number, fontMax?:number}>} blocks
   * @param {{fill:string, custom:string}} options
   */
  function renderImage(source, natural, blocks, { fill = 'auto', custom = '' } = {}) {
    const { width, height } = exportSize(natural.w, natural.h);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    // 先逐框取相近色（多次 getImageData）再画，声明后 Chrome 改用 CPU 画布，读回更快
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, width, height);

    // 先把颜色全部取完再画，免得后画的框采到前面盖上去的颜色
    const jobs = blocks
      .filter((b) => b.box && b.translation)
      .map((b) => {
        // 预览时已按笔画校正过的范围优先，保证下载的和看到的一样
        const rect = toPixels(b.cover || coverBox(b, natural), width, height);
        return { b, rect, color: paint(fill, custom, fill === 'auto' ? sampleAt(ctx, rect, width, height) : null) };
      });

    const fontAt = (size) => `500 ${size}px ${FONT}`;
    const measure = (text, size) => {
      ctx.font = fontAt(size);
      return ctx.measureText(text).width;
    };
    // 按不含行尾挂点的宽度居中：挂在行尾的逗号允许超出行宽，整行居中会把行首挤出框外
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const { b, rect, color } of jobs) {
      ctx.save();
      const ellipse = ellipseOf(b);
      if (ellipse) {
        // 圆形选区：铺底和文字都不出圆
        const e = toPixels(ellipse, width, height);
        ctx.beginPath();
        ctx.ellipse(e.x + e.w / 2, e.y + e.h / 2, e.w / 2, e.h / 2, 0, 0, Math.PI * 2);
        ctx.clip();
      }
      ctx.fillStyle = color.bg;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      // 文字排在圆的内接矩形里（矩形选区就是遮盖范围本身）
      const area = ellipse ? toPixels(textArea(b, b.cover || coverBox(b, natural)), width, height) : rect;
      const padX = Math.min(area.w * 0.06, area.h * 0.2, 12 * (width / 1000 + 1));
      const padY = Math.min(area.h * 0.08, 8 * (width / 1000 + 1));
      const max = b.fontMax ? Math.max(6, b.fontMax * height) : Infinity;
      const layout = layoutText(b.translation, area.w - padX * 2, area.h - padY * 2, measure,
        { min: Math.max(6, height / 400), max });
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.w, rect.h);
      ctx.clip();
      ctx.font = fontAt(layout.size);
      ctx.fillStyle = color.fg;
      ctx.direction = RTL.test(b.translation) ? 'rtl' : 'ltr';
      const first = area.y + area.h / 2 - (layout.lines.length - 1) * layout.lineHeight / 2;
      layout.lines.forEach((line, i) => {
        const w = ctx.measureText(line.replace(HANGING, '')).width;
        ctx.fillText(line, area.x + (area.w - w) / 2, first + i * layout.lineHeight);
      });
      ctx.restore();
    }
    return canvas;
  }

  /** 画布 → 图片文件。剪贴板只认 PNG；下载时大图用 JPEG，免得文件动辄几十 MB。 */
  function toBlob(canvas, { forClipboard = false } = {}) {
    const png = forClipboard || canvas.width * canvas.height <= 4000000;
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('toBlob'))),
        png ? 'image/png' : 'image/jpeg',
        png ? undefined : 0.92
      );
    });
  }

  /** 下载文件名：原文件名（去掉扩展名）加目标语言。 */
  function fileName(src, targetId, blob) {
    let base = 'image';
    try {
      if (!String(src).startsWith('data:')) {
        const last = decodeURIComponent(new URL(src).pathname.split('/').pop() || '');
        base = last.replace(/\.[a-z0-9]{2,5}$/i, '') || base;
      }
    } catch {
      /* 网址不合法时用默认名 */
    }
    base = base.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 80) || 'image';
    const ext = blob?.type === 'image/jpeg' ? 'jpg' : 'png';
    return `${base}-${targetId || 'translated'}.${ext}`;
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function copy(blob) {
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
  }

  globalThis.AITrImageRender = {
    FILLS,
    DARK,
    parseHex,
    luminance,
    textColorFor,
    paint,
    dominantColor,
    ringStrips,
    sampleAt,
    coverBox,
    textArea,
    overlayShape,
    inkBox,
    refineCover,
    wrap,
    layoutText,
    exportSize,
    renderImage,
    toBlob,
    fileName,
    download,
    copy,
  };
})();
