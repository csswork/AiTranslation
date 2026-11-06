/**
 * 自动识别图片时，把文字块勾成贴着笔画的不规则多边形，而且各块互不重叠。
 *
 * 视觉模型只给每个文字块一个大致的矩形，文字密集时这些矩形常常互相压住，
 * 矩形也盖不准形状不规则的文字（对话框里长短不一的几列、斜排的标题）。这里：
 *   1. 在模型框四周放宽的窗口里按笔画找出这一块的字（image-render.js 的 inkBox），
 *      落在网格上作为种子；同一格被两块认领时归框更合适的那块；
 *   2. 各块从自己的笔画同时向外扩约 0.6 个字，把同一块里的行、列连成一片——
 *      两块相遇时各占到中间为止，所以每一格最多属于一块，多边形不会重叠；
 *   3. 再往回收，只在笔画外留约 0.3 个字，相邻两块之间因此留出空隙；补上中间的洞；
 *   4. 沿格子边缘勾出轮廓，简化成多边形。
 * 读不到像素（跨域图）或找不到笔画时退回模型的矩形，同样按格子分清归属。
 *
 * 纯计算，不依赖 DOM；只用到 ctx.getImageData。与 tiles.js 一样不能出现 import / export。
 */
(() => {
  /** 网格长边的格数：几百万像素的图也只要几十毫秒。 */
  const GRID = 600;
  /** 小字门槛：单个字不到图片短边的 1.5%（至少 8 个原图像素）。 */
  const SMALL_TEXT = 0.015;
  const SMALL_TEXT_PX = 8;
  /** 模型框的短边不到门槛的这么多倍才可能是小字：多行的块再小也不丢。 */
  const SMALL_BOX = 1.5;
  /** 向外扩多少个字，把同一块里的行、列连起来。 */
  const REACH = 0.6;
  /** 最后在笔画外留多少个字的边。 */
  const PAD = 0.3;
  /** 模型框四周放宽多少再找笔画（与 refineCover 一致）。 */
  const GROW = 0.35;
  /** 笔画相距不到多少个字就算同一行（或同一块）。 */
  const LINK = 0.35;
  /** 一行被几块的框同时盖住时，框住最多的比第二多出这么多才整行归它。 */
  const CLEAR = 0.2;
  /** 一片至少要有这么多落在模型框里才算这一块的字。 */
  const INSIDE = 0.4;
  /** 同一块里比最大一片小这么多的碎片丢掉。 */
  const KEEP_PART = 0.1;
  /** 轮廓简化的容差（格）。 */
  const SIMPLIFY = 0.8;

  const DIAG = Math.SQRT2;

  /**
   * 带归属的倒角距离变换（两遍，近似欧氏距离）。
   * dist 里 0 是种子，其余为 Infinity；label 里是种子的归属，跟着最近的种子一起传开。
   */
  function propagate(dist, label, gw, gh) {
    const step = (i, j, w) => {
      const d = dist[j] + w;
      if (d < dist[i]) { dist[i] = d; label[i] = label[j]; }
    };
    for (let y = 0; y < gh; y += 1) {
      for (let x = 0; x < gw; x += 1) {
        const i = y * gw + x;
        if (x > 0) step(i, i - 1, 1);
        if (y > 0) {
          step(i, i - gw, 1);
          if (x > 0) step(i, i - gw - 1, DIAG);
          if (x < gw - 1) step(i, i - gw + 1, DIAG);
        }
      }
    }
    for (let y = gh - 1; y >= 0; y -= 1) {
      for (let x = gw - 1; x >= 0; x -= 1) {
        const i = y * gw + x;
        if (x < gw - 1) step(i, i + 1, 1);
        if (y < gh - 1) {
          step(i, i + gw, 1);
          if (x < gw - 1) step(i, i + gw + 1, DIAG);
          if (x > 0) step(i, i + gw - 1, DIAG);
        }
      }
    }
  }

  /** 每个归属格到「不属于同一块」的格子的距离；图片边缘不算边界。 */
  function inner(own, gw, gh) {
    const dist = new Float32Array(gw * gh);
    for (let i = 0; i < dist.length; i += 1) dist[i] = own[i] < 0 ? 0 : Infinity;
    const step = (i, j, w) => {
      const d = own[j] === own[i] ? dist[j] + w : w;
      if (d < dist[i]) dist[i] = d;
    };
    for (let y = 0; y < gh; y += 1) {
      for (let x = 0; x < gw; x += 1) {
        const i = y * gw + x;
        if (own[i] < 0) continue;
        if (x > 0) step(i, i - 1, 1);
        if (y > 0) {
          step(i, i - gw, 1);
          if (x > 0) step(i, i - gw - 1, DIAG);
          if (x < gw - 1) step(i, i - gw + 1, DIAG);
        }
      }
    }
    for (let y = gh - 1; y >= 0; y -= 1) {
      for (let x = gw - 1; x >= 0; x -= 1) {
        const i = y * gw + x;
        if (own[i] < 0) continue;
        if (x < gw - 1) step(i, i + 1, 1);
        if (y < gh - 1) {
          step(i, i + gw, 1);
          if (x < gw - 1) step(i, i + gw + 1, DIAG);
          if (x > 0) step(i, i + gw - 1, DIAG);
        }
      }
    }
    return dist;
  }

  /** 一块的格子：补上被它围住的空格（别的块的格子不动），再分成四连通的几片，返回保留的片。 */
  function pieces(final, id, gw, gh, bounds) {
    const x0 = Math.max(0, bounds.x0 - 1);
    const y0 = Math.max(0, bounds.y0 - 1);
    const x1 = Math.min(gw - 1, bounds.x1 + 1);
    const y1 = Math.min(gh - 1, bounds.y1 + 1);
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    const local = (x, y) => (y - y0) * bw + (x - x0);
    // 从外框往里灌，灌不到的空格就是洞
    const outside = new Uint8Array(bw * bh);
    const stack = [];
    const push = (x, y) => {
      if (x < x0 || y < y0 || x > x1 || y > y1) return;
      const k = local(x, y);
      if (outside[k] || final[y * gw + x] === id) return;
      outside[k] = 1;
      stack.push(x, y);
    };
    for (let x = x0; x <= x1; x += 1) { push(x, y0); push(x, y1); }
    for (let y = y0; y <= y1; y += 1) { push(x0, y); push(x1, y); }
    while (stack.length) {
      const y = stack.pop();
      const x = stack.pop();
      push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
    }
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const i = y * gw + x;
        if (!outside[local(x, y)] && final[i] < 0) final[i] = id;
      }
    }

    const seen = new Uint8Array(bw * bh);
    const parts = [];
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        if (final[y * gw + x] !== id || seen[local(x, y)]) continue;
        const cells = [];
        seen[local(x, y)] = 1;
        stack.push(x, y);
        while (stack.length) {
          const cy = stack.pop();
          const cx = stack.pop();
          cells.push(cx, cy);
          for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
            if (nx < x0 || ny < y0 || nx > x1 || ny > y1) continue;
            const k = local(nx, ny);
            if (seen[k] || final[ny * gw + nx] !== id) continue;
            seen[k] = 1;
            stack.push(nx, ny);
          }
        }
        parts.push(cells);
      }
    }
    const largest = Math.max(0, ...parts.map((cells) => cells.length));
    return parts.filter((cells) => cells.length >= largest * KEEP_PART);
  }

  /**
   * 沿一片格子的外缘勾出轮廓（格子角点坐标，顺时针）。
   * 每格露在外面的边都记成有向边（里面在右手边），首尾相接成环，取面积最大的那个环。
   */
  function outline(cells) {
    const inside = new Set();
    for (let i = 0; i < cells.length; i += 2) inside.add(`${cells[i]},${cells[i + 1]}`);
    const has = (x, y) => inside.has(`${x},${y}`);
    const edges = new Map();
    const add = (ax, ay, bx, by) => {
      const key = `${ax},${ay}`;
      if (!edges.has(key)) edges.set(key, []);
      edges.get(key).push([bx, by]);
    };
    for (let i = 0; i < cells.length; i += 2) {
      const x = cells[i];
      const y = cells[i + 1];
      if (!has(x, y - 1)) add(x, y, x + 1, y);
      if (!has(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!has(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!has(x - 1, y)) add(x, y + 1, x, y);
    }
    const loops = [];
    for (const [start, list] of edges) {
      while (list.length) {
        const [sx, sy] = start.split(',').map(Number);
        const loop = [[sx, sy]];
        let [px, py] = [sx, sy];
        let [cx, cy] = list.pop();
        for (let guard = 0; guard < 1e6 && !(cx === sx && cy === sy); guard += 1) {
          loop.push([cx, cy]);
          const next = edges.get(`${cx},${cy}`);
          if (!next?.length) break;
          // 两片只在一个角上相碰时这里有两条出路：优先右转，环就不会在角上交叉
          const dx = cx - px;
          const dy = cy - py;
          let pick = 0;
          if (next.length > 1) {
            const right = next.findIndex(([nx, ny]) => nx - cx === -dy && ny - cy === dx);
            pick = right >= 0 ? right : 0;
          }
          [px, py] = [cx, cy];
          [cx, cy] = next.splice(pick, 1)[0];
        }
        loops.push(loop);
      }
    }
    const area = (loop) => Math.abs(loop.reduce((sum, [x, y], i) => {
      const [nx, ny] = loop[(i + 1) % loop.length];
      return sum + x * ny - nx * y;
    }, 0)) / 2;
    return loops.reduce((best, loop) => (!best || area(loop) > area(best) ? loop : best), null);
  }

  /** 去掉共线的点，再用 Douglas-Peucker 把台阶简化成斜边（闭合多边形）。 */
  function simplify(points, tolerance = SIMPLIFY) {
    if (points.length < 4) return points;
    const n = points.length;
    const straight = points.filter((p, i) => {
      const a = points[(i - 1 + n) % n];
      const b = points[(i + 1) % n];
      return (p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0]) !== 0;
    });
    if (straight.length < 4) return straight;
    const far = (a, b, p) => {
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (!len) return Math.hypot(p[0] - a[0], p[1] - a[1]);
      return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
    };
    const dp = (list) => {
      let index = -1;
      let max = 0;
      for (let i = 1; i < list.length - 1; i += 1) {
        const d = far(list[0], list[list.length - 1], list[i]);
        if (d > max) { max = d; index = i; }
      }
      if (max <= tolerance) return [list[0], list[list.length - 1]];
      return [...dp(list.slice(0, index + 1)).slice(0, -1), ...dp(list.slice(index))];
    };
    // 从离起点最远的点切成两段，各自简化
    let split = 0;
    let best = -1;
    straight.forEach((p, i) => {
      const d = Math.hypot(p[0] - straight[0][0], p[1] - straight[0][1]);
      if (d > best) { best = d; split = i; }
    });
    const first = dp(straight.slice(0, split + 1));
    const second = dp([...straight.slice(split), straight[0]]);
    const out = [...first.slice(0, -1), ...second.slice(0, -1)];
    return out.length >= 3 ? out : straight;
  }

  /**
   * 把笔画格子按距离连成组：相距不超过 link 格（切比雪夫距离）的算同一组。
   * 只扫笔画格子周围，不必对整张网格做膨胀。
   */
  function strokeGroups(claims, gw, gh, link) {
    const seen = new Set();
    const groups = [];
    for (const start of claims.keys()) {
      if (seen.has(start)) continue;
      seen.add(start);
      const cells = [];
      const stack = [start];
      while (stack.length) {
        const gi = stack.pop();
        cells.push(gi);
        const x = gi % gw;
        const y = (gi / gw) | 0;
        for (let ny = Math.max(0, y - link); ny <= Math.min(gh - 1, y + link); ny += 1) {
          for (let nx = Math.max(0, x - link); nx <= Math.min(gw - 1, x + link); nx += 1) {
            const ni = ny * gw + nx;
            if (!claims.has(ni) || seen.has(ni)) continue;
            seen.add(ni);
            stack.push(ni);
          }
        }
      }
      groups.push(cells);
    }
    return groups;
  }

  /** 两个框都含这一点时，归离中心更近（按框的大小折算）的那个；都不含时同样比。 */
  function closer(a, b, x, y) {
    const inside = (r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    const ia = inside(a);
    const ib = inside(b);
    if (ia !== ib) return ia ? a : b;
    const d = (r) => Math.hypot((x - r.x - r.w / 2) / Math.max(1, r.w), (y - r.y - r.h / 2) / Math.max(1, r.h));
    return d(a) <= d(b) ? a : b;
  }

  /**
   * 把识别出的文字块勾成互不重叠的多边形。
   * @param ctx 送检那份画布（读不到像素时传 null，退回矩形）
   * @param {number} width 画布宽（ctx 为 null 时用原图尺寸）
   * @param {number} height 画布高
   * @param {Array<{text:string, box:{x,y,w,h}}>} blocks 0-1 相对坐标
   * @param {{w:number,h:number}} [natural] 原图尺寸：小字门槛按原图像素算
   * @returns {{shapes: Array<{index, text, box, polygons: number[][][], bounds, glyph, vertical, fallback}>, small: number}}
   *   polygons 是 0-1 相对坐标的点列；glyph 是单个字的高度（相对图高）
   */
  function findShapes(ctx, width, height, blocks, natural = { w: width, h: height }) {
    const g = Math.max(1, Math.ceil(Math.max(width, height) / GRID));
    const gw = Math.ceil(width / g);
    const gh = Math.ceil(height / g);
    const floor = Math.max(SMALL_TEXT_PX * (width / Math.max(1, natural.w)), SMALL_TEXT * Math.min(width, height));
    const items = [];
    let small = 0;
    const boxes = blocks.map((block) => block?.box && block.box.w > 0 && block.box.h > 0
      ? { x: block.box.x * width, y: block.box.y * height, w: block.box.w * width, h: block.box.h * height }
      : null);

    // 1. 每块在自己的窗口里找笔画（不在这里分归属），记下哪些格子被哪几块认作笔画
    const claims = new Map(); // 格子 -> 认领它的 item id 列表
    const claim = (gi, id) => {
      const list = claims.get(gi);
      if (!list) claims.set(gi, [id]);
      else if (!list.includes(id)) list.push(id);
    };
    const fallbacks = [];
    blocks.forEach((block, index) => {
      const px = boxes[index];
      if (!px) return;
      let found = null;
      let wx0 = 0;
      let wy0 = 0;
      if (ctx) {
        wx0 = Math.max(0, Math.floor(px.x - px.w * GROW - 0.01 * width));
        wy0 = Math.max(0, Math.floor(px.y - px.h * GROW - 0.01 * height));
        const wx1 = Math.min(width, Math.ceil(px.x + px.w * (1 + GROW) + 0.01 * width));
        const wy1 = Math.min(height, Math.ceil(px.y + px.h * (1 + GROW) + 0.01 * height));
        if (wx1 - wx0 >= 6 && wy1 - wy0 >= 6) {
          try {
            const { data } = ctx.getImageData(wx0, wy0, wx1 - wx0, wy1 - wy0);
            const hint = { x: px.x - wx0, y: px.y - wy0, w: px.w, h: px.h };
            found = globalThis.AITrImageRender.inkBox(data, wx1 - wx0, wy1 - wy0, hint, [], true);
          } catch {
            found = null;
          }
        }
      }
      // 字高按选中笔画的短边量（字挨在一起时长边量的是整个词）；排版字号、扩张距离都按它
      const glyph = found ? Math.min(found.glyph, found.textSize || found.glyph) : Math.min(px.w, px.h);
      // 只丢真正的小字：模型框本身很小（单行小字），而且量出来的字也小。
      // 字号可能量偏（画面纹理、笔画粘连），所以不单凭它判断
      const boxSide = Math.min(px.w, px.h);
      const size = found ? Math.min(glyph, found.w, found.h) : boxSide;
      if (boxSide < floor * SMALL_BOX && size < floor) { small += 1; return; }
      const item = { id: items.length, index, block, px, glyph, fallback: !found };
      items.push(item);
      if (!found) { fallbacks.push(item); return; }
      const { cell, cw, mask } = found;
      for (let k = 0; k < mask.length; k += 1) {
        if (!mask[k]) continue;
        const x = wx0 + (k % cw) * cell;
        const y = wy0 + ((k / cw) | 0) * cell;
        for (let gy = Math.floor(y / g); gy <= Math.min(gh - 1, Math.floor((y + cell - 1) / g)); gy += 1) {
          for (let gx = Math.floor(x / g); gx <= Math.min(gw - 1, Math.floor((x + cell - 1) / g)); gx += 1) {
            claim(gy * gw + gx, item.id);
          }
        }
      }
    });

    // 2. 笔画按字距连成行（或一整块），整行归框住它最多的那块：
    //    模型的框互相压住时，按单个笔画就近分会把一行字拆给两块
    const owner = new Int32Array(gw * gh).fill(-1);
    const glyphs = items.filter((item) => !item.fallback).map((item) => item.glyph).sort((a, b) => a - b);
    const link = glyphs.length ? Math.max(1, Math.round((glyphs[glyphs.length >> 1] * LINK) / g)) : 1;
    const groups = strokeGroups(claims, gw, gh, link);
    const contains = (r, gi) => {
      const x = ((gi % gw) + 0.5) * g;
      const y = (((gi / gw) | 0) + 0.5) * g;
      return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    };
    for (const cells of groups) {
      const ids = [...new Set(cells.flatMap((gi) => claims.get(gi)))];
      let pick = ids.length === 1 ? ids[0] : -1;
      if (pick < 0) {
        const share = ids.map((id) => cells.filter((gi) => contains(items[id].px, gi)).length / cells.length);
        const order = ids.map((id, k) => k).sort((a, b) => share[b] - share[a]);
        if (share[order[0]] - share[order[1]] >= CLEAR) pick = ids[order[0]];
      }
      for (const gi of cells) {
        if (pick >= 0) { owner[gi] = pick; continue; }
        // 分不清整行归谁：逐格归框更合适的那块
        const x = ((gi % gw) + 0.5) * g;
        const y = (((gi / gw) | 0) + 0.5) * g;
        owner[gi] = claims.get(gi).reduce((best, id) =>
          (best < 0 || closer(items[best].px, items[id].px, x, y) === items[id].px ? id : best), -1);
      }
    }
    // 没有笔画可依的块：整个模型框都当种子，与别的块重叠的部分照样分清归属
    for (const item of fallbacks) {
      const { px } = item;
      for (let gy = Math.floor(px.y / g); gy < Math.min(gh, Math.ceil((px.y + px.h) / g)); gy += 1) {
        for (let gx = Math.floor(px.x / g); gx < Math.min(gw, Math.ceil((px.x + px.w) / g)); gx += 1) {
          const gi = gy * gw + gx;
          const current = owner[gi];
          if (current >= 0 && (!items[current].fallback ||
            closer(items[current].px, px, (gx + 0.5) * g, (gy + 0.5) * g) !== px)) continue;
          owner[gi] = item.id;
        }
      }
    }

    // 各块同时向外扩：谁先到归谁
    const dist = new Float32Array(gw * gh);
    const label = new Int32Array(owner);
    for (let i = 0; i < dist.length; i += 1) dist[i] = owner[i] >= 0 ? 0 : Infinity;
    propagate(dist, label, gw, gh);
    const reach = items.map((item) => (item.fallback ? 0 : (item.glyph * REACH) / g));
    const pad = items.map((item) => (item.fallback ? 0 : (item.glyph * PAD) / g));
    const own = new Int32Array(gw * gh).fill(-1);
    for (let i = 0; i < own.length; i += 1) if (label[i] >= 0 && dist[i] <= reach[label[i]]) own[i] = label[i];

    // 往回收：只在笔画外留一圈边，扩出来连接行列的部分保留
    const depth = inner(own, gw, gh);
    const final = new Int32Array(gw * gh).fill(-1);
    const bounds = items.map(() => ({ x0: gw, y0: gh, x1: -1, y1: -1 }));
    for (let i = 0; i < final.length; i += 1) {
      const id = own[i];
      if (id < 0) continue;
      if (depth[i] > reach[id] - pad[id] || dist[i] <= pad[id]) {
        final[i] = id;
        const b = bounds[id];
        const x = i % gw;
        const y = (i / gw) | 0;
        if (x < b.x0) b.x0 = x;
        if (x > b.x1) b.x1 = x;
        if (y < b.y0) b.y0 = y;
        if (y > b.y1) b.y1 = y;
      }
    }

    // 不同块的格子挨在一起时两边各退一格：轮廓简化会偏出不到一格，留出两格就不会压到对方
    const touching = [];
    for (let i = 0; i < final.length; i += 1) {
      const id = final[i];
      if (id < 0) continue;
      const x = i % gw;
      const y = (i / gw) | 0;
      outer: for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const other = final[ny * gw + nx];
          if (other >= 0 && other !== id) { touching.push(i); break outer; }
        }
      }
    }
    for (const i of touching) final[i] = -1;

    const shapes = [];
    for (const item of items) {
      if (bounds[item.id].x1 < 0) continue;
      // 大半落在模型框外的碎片多半是旁边的画面线条，丢掉（至少留下框住最多的一片）
      const all = pieces(final, item.id, gw, gh, bounds[item.id]);
      const share = (cells) => {
        let hit = 0;
        for (let k = 0; k < cells.length; k += 2) {
          const x = (cells[k] + 0.5) * g;
          const y = (cells[k + 1] + 0.5) * g;
          if (x >= item.px.x && x <= item.px.x + item.px.w && y >= item.px.y && y <= item.px.y + item.px.h) hit += 1;
        }
        return hit / Math.max(1, cells.length / 2);
      };
      const shares = all.map(share);
      const best = Math.max(0, ...shares);
      const polygons = all.filter((cells, k) => shares[k] >= INSIDE || shares[k] === best)
        .map(outline)
        .filter(Boolean)
        .map((loop) => simplify(loop).map(([x, y]) => [Math.min(1, (x * g) / width), Math.min(1, (y * g) / height)]));
      if (!polygons.length) continue;
      const xs = polygons.flat().map((p) => p[0]);
      const ys = polygons.flat().map((p) => p[1]);
      const x0 = Math.min(...xs);
      const y0 = Math.min(...ys);
      shapes.push({
        index: item.index,
        text: item.block.text,
        box: item.block.box,
        polygons,
        bounds: { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 },
        glyph: item.glyph / height,
        vertical: item.block.vertical === true,
        fallback: item.fallback,
      });
    }
    return { shapes, small };
  }

  /**
   * 量一块范围里单个字的大小（相对图高）：用户新画或改过的形状没有模型给的字号。
   * 读不到像素或找不到笔画时返回 0。
   */
  function measureGlyph(ctx, width, height, box) {
    if (!ctx || !box) return 0;
    const x0 = Math.max(0, Math.floor(box.x * width));
    const y0 = Math.max(0, Math.floor(box.y * height));
    const x1 = Math.min(width, Math.ceil((box.x + box.w) * width));
    const y1 = Math.min(height, Math.ceil((box.y + box.h) * height));
    if (x1 - x0 < 6 || y1 - y0 < 6) return 0;
    try {
      const { data } = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
      const found = globalThis.AITrImageRender.inkBox(data, x1 - x0, y1 - y0, { x: 0, y: 0, w: x1 - x0, h: y1 - y0 });
      return found ? found.glyph / height : 0;
    } catch {
      return 0;
    }
  }

  globalThis.AITrTextShapes = { GRID, findShapes, measureGlyph, outline, simplify };
})();
