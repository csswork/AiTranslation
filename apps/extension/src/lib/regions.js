/**
 * 图片选区：用户在图上框出若干区域，只识别、翻译、覆盖这些位置。
 *
 * 多个选区拼成一张图一起识别——每个选区单独发请求的话，托管模式的
 * 每小时识图次数很快就会用完。拼图时选区之间留白，识别结果按落在
 * 哪一块还原回原图坐标；落在留白里的丢掉。
 *
 * 每个选区的文字合成一整段翻译：漫画对话框、海报标题这类内容逐行翻译
 * 会丢上下文。译文盖在选区内文字所在的范围，并限制在选区以内：
 * 模型坐标偏了也不会盖到选区外面去。
 *
 * 纯计算部分不依赖 DOM，可以单独测；stitch / readRegions 需要 canvas。
 * 与 tiles.js 一样不能出现 import / export。
 */
(() => {
  /** 选区数量上限，免得拼图过大、识别变糊。 */
  const MAX_REGIONS = 12;
  /** 选区之间的留白（原图像素），避免相邻选区的文字被识别成同一行。 */
  const GAP = 24;
  /**
   * 一张拼图的原图像素预算。拼图送检前还会按送检上限（约 400 万像素）缩小，
   * 预算放到两倍：再多就缩得太狠，小字会糊。
   */
  const MAX_PIXELS = 8000000;

  const clamp01 = (v) => Math.min(1, Math.max(0, v));

  /** 两个点（0-1 相对坐标）围成的矩形。 */
  function rectFrom(a, b) {
    const x0 = clamp01(Math.min(a.x, b.x));
    const y0 = clamp01(Math.min(a.y, b.y));
    const x1 = clamp01(Math.max(a.x, b.x));
    const y1 = clamp01(Math.max(a.y, b.y));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /**
   * 把选区按行排成拼图（从左到右排，排满一行换行），尽量凑成接近方形的一张图：
   * 太扁太长模型都定位不准。总像素超出预算才另起一批，免得缩得太小看不清字。
   * 单个选区本身就很长时，交给长图分块处理。
   * @param {Array<{x:number,y:number,w:number,h:number}>} regions 0-1 相对坐标
   * @param {number} width 原图像素宽
   * @param {number} height 原图像素高
   * @returns {Array<{width:number,height:number,items:Array<{index:number,sx:number,sy:number,sw:number,sh:number,left:number,top:number}>}>}
   */
  function packRegions(regions, width, height, options = {}) {
    const gap = options.gap ?? GAP;
    const maxPixels = options.maxPixels ?? MAX_PIXELS;
    const items = regions
      .map((r, index) => {
        const sx = Math.round(r.x * width);
        const sy = Math.round(r.y * height);
        return {
          index, sx, sy,
          sw: Math.max(1, Math.min(width - sx, Math.round(r.w * width))),
          sh: Math.max(1, Math.min(height - sy, Math.round(r.h * height))),
        };
      })
      // 按阅读顺序排，识别结果的顺序也就自然是从上到下
      .sort((a, b) => a.sy - b.sy || a.sx - b.sx);

    // 先按像素预算分批
    const groups = [];
    let area = Infinity;
    for (const item of items) {
      const cost = (item.sw + gap) * (item.sh + gap);
      if (area + cost > maxPixels) {
        groups.push([]);
        area = 0;
      }
      groups.at(-1).push(item);
      area += cost;
    }

    return groups.map((group) => {
      const total = group.reduce((sum, p) => sum + (p.sw + gap) * (p.sh + gap), 0);
      // 行宽取「面积开方」，排出来接近方形；至少容得下最宽的那个
      const rowWidth = Math.max(...group.map((p) => p.sw), Math.round(Math.sqrt(total) * 1.15));
      const placed = [];
      let x = 0;
      let top = 0;
      let rowHeight = 0;
      let width = 0;
      for (const p of group) {
        if (x > 0 && x + p.sw > rowWidth) {
          top += rowHeight + gap;
          x = 0;
          rowHeight = 0;
        }
        placed.push({ ...p, left: x, top });
        width = Math.max(width, x + p.sw);
        x += p.sw + gap;
        rowHeight = Math.max(rowHeight, p.sh);
      }
      return { width, height: top + rowHeight, items: placed };
    });
  }

  /**
   * 拼图上的识别结果还原到整图坐标，并标上属于哪个选区。
   * @param {Array<{text:string,box:object|null}>} blocks 拼图内 0-1 坐标
   */
  function unpackBlocks(blocks, batch, regions) {
    const out = [];
    for (const item of blocks || []) {
      if (!item?.box) continue;
      const px0 = item.box.x * batch.width;
      const px1 = (item.box.x + item.box.w) * batch.width;
      const py0 = item.box.y * batch.height;
      const py1 = (item.box.y + item.box.h) * batch.height;
      const cx = (px0 + px1) / 2;
      const cy = (py0 + py1) / 2;
      // 以中心点判断归属；落在留白里的是模型的毛刺
      const part = batch.items.find((p) =>
        cx >= p.left && cx <= p.left + p.sw && cy >= p.top && cy <= p.top + p.sh);
      if (!part) continue;
      const r = regions[part.index];
      const x0 = clamp01((px0 - part.left) / part.sw);
      const x1 = clamp01((px1 - part.left) / part.sw);
      const y0 = clamp01((py0 - part.top) / part.sh);
      const y1 = clamp01((py1 - part.top) / part.sh);
      out.push({
        ...item,
        region: part.index,
        box: { x: r.x + x0 * r.w, y: r.y + y0 * r.h, w: (x1 - x0) * r.w, h: (y1 - y0) * r.h },
      });
    }
    return out;
  }

  /**
   * 读不到像素（跨域）时没法裁图，只能从整图识别结果里挑出中心落在选区内的，
   * 并把框裁到选区以内。
   */
  function filterByRegions(blocks, regions) {
    const out = [];
    for (const item of blocks || []) {
      if (!item?.box) continue;
      const cx = item.box.x + item.box.w / 2;
      const cy = item.box.y + item.box.h / 2;
      const index = regions.findIndex((r) => cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h);
      if (index < 0) continue;
      const r = regions[index];
      const x0 = Math.max(r.x, item.box.x);
      const y0 = Math.max(r.y, item.box.y);
      const x1 = Math.min(r.x + r.w, item.box.x + item.box.w);
      const y1 = Math.min(r.y + r.h, item.box.y + item.box.h);
      out.push({ ...item, region: index, box: { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) } });
    }
    return out;
  }

  /** 中日文之间不加空格；韩文按词分写，和拉丁文字一样用空格连。 */
  const CJK_EDGE = /[\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;
  function joinText(head, tail) {
    if (!head) return tail;
    if (!tail) return head;
    return CJK_EDGE.test(head.at(-1)) && CJK_EDGE.test(tail[0]) ? head + tail : `${head} ${tail}`;
  }

  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };

  /**
   * 每个选区合成一段：保持模型给的顺序（竖排日文是从右往左读，不能按坐标重排）。
   * box 是选区本身；textBox 是选区内文字的外接框，遮盖只盖这一块——
   * 选区往往比文字大（框住整个对话框），整块盖上会把对话框的描边也盖掉。
   * fontMax 是原文的大致字号（相对整图高），译文不会比原文还大。
   * @returns {Array<{region:number,text:string,box:object,textBox:object|null,fontMax:number}>}
   */
  function groupByRegion(blocks, regions) {
    return regions
      .map((box, region) => {
        const parts = blocks.filter((b) => b.region === region && String(b.text || '').trim());
        const text = parts.reduce((acc, b) => joinText(acc, String(b.text).trim()), '');
        const boxes = parts.map((b) => b.box).filter((b) => b && b.w > 0 && b.h > 0);
        // 识别框高度约等于字形高度：拉丁大写字母只占字号的七成左右，中文接近满格，
        // 直接拿框高当字号上限，两头都不至于差太多
        const fontMax = boxes.length ? median(boxes.map((b) => b.h)) : box.h * 0.5;
        let textBox = null;
        if (boxes.length) {
          const x0 = Math.max(box.x, Math.min(...boxes.map((b) => b.x)));
          const y0 = Math.max(box.y, Math.min(...boxes.map((b) => b.y)));
          const x1 = Math.min(box.x + box.w, Math.max(...boxes.map((b) => b.x + b.w)));
          const y1 = Math.min(box.y + box.h, Math.max(...boxes.map((b) => b.y + b.h)));
          if (x1 > x0 && y1 > y0) textBox = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
        }
        return { region, text, box, textBox, fontMax };
      })
      .filter((g) => g.text);
  }

  /**
   * 按排好的位置把各选区从原图上裁下来拼在一起，白底留白。
   * @param {CanvasImageSource} source 原始分辨率的原图（不能被跨域污染）
   * @param {number} scale 拼图相对原图的缩放（送检尺寸限制）
   */
  function stitch(source, batch, scale = 1) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(batch.width * scale));
    canvas.height = Math.max(1, Math.round(batch.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const p of batch.items) {
      ctx.drawImage(source, p.sx, p.sy, p.sw, p.sh, p.left * scale, p.top * scale, p.sw * scale, p.sh * scale);
    }
    return canvas;
  }

  /**
   * 识别各选区里的文字，坐标还原到整图。
   * @param {object} args
   * @param {CanvasImageSource} args.source 原始分辨率的原图
   * @param {{w:number,h:number}} args.natural 原图像素尺寸
   * @param {(w:number,h:number)=>number} args.scaleFor 送检缩放系数
   * @param {(image:string, size:{width:number,height:number})=>Promise<Array>} args.read
   *   识别一张图，返回 0-1 坐标的 blocks
   * @param {(done:number,total:number)=>void} [args.onProgress]
   */
  async function readRegions({ source, natural, regions, scaleFor, read, onProgress }) {
    const T = globalThis.AITrTiles;
    const batches = packRegions(regions, natural.w, natural.h);
    const out = [];
    for (let i = 0; i < batches.length; i += 1) {
      onProgress?.(i, batches.length);
      const batch = batches[i];
      const canvas = stitch(source, batch, scaleFor(batch.width, batch.height));
      const { width: w, height: h } = canvas;
      let blocks;
      if (T?.needsTiling(w, h)) {
        // 单个选区本身就是长条：和长图一样切块，切缝挪到空白处
        const plan = T.refinePlan(T.planTiles(w, h), T.rowDarkness(canvas.getContext('2d'), w, h), h);
        const images = T.cutTiles(canvas, w, h, plan) || [];
        const perTile = [];
        for (let j = 0; j < images.length; j += 1) {
          perTile.push(await read(images[j], { width: w, height: plan[j].height }));
        }
        blocks = T.mergeBlocks(perTile, plan, h);
      } else {
        blocks = await read(canvas.toDataURL('image/jpeg', 0.9), { width: w, height: h });
      }
      out.push(...unpackBlocks(blocks, batch, regions));
    }
    return out;
  }

  globalThis.AITrRegions = {
    MAX_REGIONS,
    GAP,
    rectFrom,
    packRegions,
    unpackBlocks,
    filterByRegions,
    joinText,
    groupByRegion,
    stitch,
    readRegions,
  };
})();
