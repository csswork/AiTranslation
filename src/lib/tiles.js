/**
 * 长图分块。
 *
 * 视觉模型在极端长宽比的图上定位很不准（700×4400 实测纵向位置明显偏移），
 * 且接口按「每张图 1024 token」的预算内部缩放，长图小字会糊掉。
 * 切成比例正常的若干块分别识别，再按各块偏移把坐标合回去。
 *
 * 关键难点是切缝：一块文字被切成两半的话，会变成两段残句分别翻译，
 * 而且靠比对文本的去重发现不了。所以切之前先扫描每一行的「墨水量」，
 * 把切缝挪到附近最空白的一行去（漫画的分格间隙、段落行距都是理想切点），
 * 再留一点重叠作保险。
 *
 * 纯计算部分不依赖 DOM，可以单独测。与 lang.js 一样不能出现 import / export。
 */
(() => {
  /** 高宽比超过这个值才需要分块。 */
  const MAX_RATIO = 1.6;
  /** 相邻块的重叠比例，给切缝没挪好的情况留条后路。 */
  const OVERLAP = 0.08;
  /** 再长也不要切太多块，免得请求数失控。 */
  const MAX_TILES = 8;
  /**
   * 切缝允许在理想位置上下多大范围内挪动（相对块高）。
   * 要够得着最近的空白：漫画分格间隙的间距可能接近半个块高，
   * 取 0.18 时实测有切缝够不到间隙，落在了画面中间。
   * 挪得远会让相邻块高度不均，但仍远好过 6 倍长宽比，值得。
   */
  const SEAM_SEARCH = 0.35;

  const needsTiling = (width, height, maxRatio = MAX_RATIO) =>
    Boolean(width && height && height > width * maxRatio);

  /**
   * 几何切法：只按比例均分，不看图像内容。
   * @returns {Array<{top: number, height: number}>} 像素单位，自上而下
   */
  function planTiles(width, height, options = {}) {
    const maxRatio = options.maxRatio ?? MAX_RATIO;
    const overlap = options.overlap ?? OVERLAP;
    const maxTiles = options.maxTiles ?? MAX_TILES;

    if (!needsTiling(width, height, maxRatio)) {
      return [{ top: 0, height: height || 0 }];
    }

    const ideal = width * maxRatio;
    let count = Math.ceil((height - ideal * overlap) / (ideal * (1 - overlap)));
    count = Math.min(Math.max(count, 2), maxTiles);

    const tileHeight = Math.min(height, Math.ceil(height / (count - (count - 1) * overlap)));
    const step = (height - tileHeight) / (count - 1);

    const tiles = [];
    for (let i = 0; i < count; i += 1) {
      // 最后一块贴着底边，避免出现一条特别矮的尾巴
      const top = i === count - 1 ? height - tileHeight : Math.round(i * step);
      tiles.push({ top: Math.max(0, top), height: tileHeight });
    }
    return tiles;
  }

  /**
   * 每一行的「墨水量」：偏离该行背景色的像素占比，0-1。
   * 横向抽样，不用逐像素扫，几百万像素的图也只要几毫秒。
   */
  function rowDarkness(ctx, width, height, sampleStep = 4) {
    const rows = new Float32Array(height);
    let data;
    try {
      data = ctx.getImageData(0, 0, width, height).data;
    } catch {
      return null; // 画布被跨域图片污染，读不出像素
    }
    const cols = Math.max(1, Math.floor(width / sampleStep));
    for (let y = 0; y < height; y += 1) {
      let sum = 0;
      let sumSq = 0;
      for (let i = 0; i < cols; i += 1) {
        const x = i * sampleStep;
        const p = (y * width + x) * 4;
        // 亮度，忽略透明度差异
        const lum = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
        sum += lum;
        sumSq += lum * lum;
      }
      // 用一行内亮度的标准差衡量「有没有东西」：
      // 纯色行（空白、纯黑背景）方差接近 0，有文字或线条才会大
      const mean = sum / cols;
      rows[y] = Math.sqrt(Math.max(0, sumSq / cols - mean * mean));
    }
    return rows;
  }

  /**
   * 把切缝挪到附近最空白的一行。
   * @param {Array<{top:number,height:number}>} plan 几何切法的结果
   * @param {Float32Array|null} darkness 每行墨水量；为 null 时原样返回
   */
  function refinePlan(plan, darkness, height, options = {}) {
    if (!darkness || plan.length < 2) return plan;
    const search = Math.round((plan[0].height || 0) * (options.search ?? SEAM_SEARCH));
    if (search < 2) return plan;

    // 相邻两块的边界由「下一块的起点」决定，逐个往空白处挪
    const tops = plan.map((t) => t.top);
    for (let i = 1; i < tops.length; i += 1) {
      const ideal = tops[i];
      const from = Math.max(1, ideal - search);
      const to = Math.min(height - 2, ideal + search);
      let best = ideal;
      let bestInk = Infinity;
      for (let y = from; y <= to; y += 1) {
        // 同样空白时更偏向离理想位置近的，避免块高相差太多
        const ink = darkness[y] + Math.abs(y - ideal) * 0.002;
        if (ink < bestInk) {
          bestInk = ink;
          best = y;
        }
      }
      tops[i] = best;
    }

    // 按新的起点重算每块高度，并保留重叠
    const overlap = options.overlap ?? OVERLAP;
    return tops.map((top, i) => {
      const nextTop = i + 1 < tops.length ? tops[i + 1] : height;
      const base = nextTop - top;
      const pad = i + 1 < tops.length ? Math.round(base * overlap) : 0;
      return { top, height: Math.min(height - top, base + pad) };
    });
  }

  /**
   * 把各块的识别结果合回整图坐标。
   * @param {Array<Array<{text: string, box: object|null}>>} perTile 与 plan 一一对应
   */
  function mergeBlocks(perTile, plan, fullHeight) {
    const out = [];
    if (!fullHeight) return out;

    perTile.forEach((blocks, index) => {
      const tile = plan[index];
      if (!tile || !Array.isArray(blocks)) return;
      for (const item of blocks) {
        if (!item?.box) continue;
        // 块内是 0-1 的相对坐标，先还原成像素再除以整图高
        const box = {
          x: item.box.x,
          w: item.box.w,
          y: (tile.top + item.box.y * tile.height) / fullHeight,
          h: (item.box.h * tile.height) / fullHeight,
        };
        const text = String(item.text || '').trim();
        // 重叠区里同一段文字会被相邻两块各识别一次
        const duplicated = out.some(
          (kept) =>
            kept.text.trim() === text &&
            Math.abs(kept.box.y - box.y) < 0.02 &&
            Math.abs(kept.box.x - box.x) < 0.06
        );
        if (duplicated) continue;
        out.push({ ...item, box });
      }
    });

    return out.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  }

  /** 按规划切图。需要 canvas，只能在有 DOM 的地方调用。 */
  function cutTiles(source, width, height, plan) {
    try {
      return plan.map((tile) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = tile.height;
        canvas
          .getContext('2d')
          .drawImage(source, 0, tile.top, width, tile.height, 0, 0, width, tile.height);
        return canvas.toDataURL('image/jpeg', 0.9);
      });
    } catch {
      return null;
    }
  }

  globalThis.AITrTiles = {
    MAX_RATIO,
    OVERLAP,
    MAX_TILES,
    needsTiling,
    planTiles,
    rowDarkness,
    refinePlan,
    mergeBlocks,
    cutTiles,
  };
})();
