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
  /** 选区按行高放出的比例：整段译文往往比原文长，要留点地方。 */
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
   * 选区盖住其中文字所在的范围（多放出一些，译文不至于贴边），并限制在选区以内。
   * 选区里没有文字坐标可依时铺满选区。
   */
  function coverBox(item, natural) {
    const region = item.region != null;
    if (!natural?.w || !natural?.h || (region && !item.textBox)) return item.box;
    const base = region ? item.textBox : item.box;
    const lineHeight = region && item.fontMax ? item.fontMax : base.h;
    const padPx = Math.max(1, lineHeight * natural.h * (region ? REGION_PAD : LINE_PAD));
    const px = padPx / natural.w;
    const py = padPx / natural.h;
    const bound = region ? item.box : { x: 0, y: 0, w: 1, h: 1 };
    const x0 = Math.max(bound.x, base.x - px);
    const y0 = Math.max(bound.y, base.y - py);
    const x1 = Math.min(bound.x + bound.w, base.x + base.w + px);
    const y1 = Math.min(bound.y + bound.h, base.y + base.h + py);
    return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
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

  /** 中文标点不放在行首：把它挂到上一行末尾。 */
  const NO_LINE_START = /^[，。、；：？！）】」』》〉…,.;:?!)\]}%]/;

  function wrap(text, width, size, measure) {
    const lines = [];
    const fits = (s) => measure(s, size) <= width;
    for (const paragraph of String(text).split('\n')) {
      let line = '';
      const push = () => {
        const done = line.trimEnd();
        if (done) lines.push(done);
        line = '';
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
        push();
        const head = piece.trimStart();
        if (fits(head.trimEnd())) line = head;
        else breakLong(head);
      }
      push();
    }
    return lines;
  }

  /** 挂在行尾的标点允许超出一点，不算放不下。 */
  const HANGING = /[，。、；：？！）】」』》〉…,.;:?!)\]}%]+$/;

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
    const ctx = canvas.getContext('2d');
    ctx.drawImage(source, 0, 0, width, height);

    // 先把颜色全部取完再画，免得后画的框采到前面盖上去的颜色
    const jobs = blocks
      .filter((b) => b.box && b.translation)
      .map((b) => {
        const rect = toPixels(coverBox(b, natural), width, height);
        return { b, rect, color: paint(fill, custom, fill === 'auto' ? sampleAt(ctx, rect, width, height) : null) };
      });

    const fontAt = (size) => `500 ${size}px ${FONT}`;
    const measure = (text, size) => {
      ctx.font = fontAt(size);
      return ctx.measureText(text).width;
    };
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const { b, rect, color } of jobs) {
      ctx.fillStyle = color.bg;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      const padX = Math.min(rect.w * 0.06, rect.h * 0.2, 12 * (width / 1000 + 1));
      const padY = Math.min(rect.h * 0.08, 8 * (width / 1000 + 1));
      const max = b.fontMax ? Math.max(6, b.fontMax * height) : Infinity;
      const layout = layoutText(b.translation, rect.w - padX * 2, rect.h - padY * 2, measure,
        { min: Math.max(6, height / 400), max });
      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.w, rect.h);
      ctx.clip();
      ctx.font = fontAt(layout.size);
      ctx.fillStyle = color.fg;
      ctx.direction = RTL.test(b.translation) ? 'rtl' : 'ltr';
      const first = rect.y + rect.h / 2 - (layout.lines.length - 1) * layout.lineHeight / 2;
      layout.lines.forEach((line, i) => ctx.fillText(line, rect.x + rect.w / 2, first + i * layout.lineHeight));
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
