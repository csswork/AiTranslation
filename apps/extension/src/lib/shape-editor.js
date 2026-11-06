/**
 * 自动识别的文字形状编辑器：翻译前让用户检查、调整识别出的形状。
 *   - 按住形状拖动是移动；选中后拖动顶点改形状；
 *   - 双击边线加一个顶点，双击顶点删掉它（至少留三个）；
 *   - 在空白处拖出新形状（矩形或椭圆，按住 Shift 是正方形 / 正圆）；
 *   - 选中后点右上角的 × 或按 Delete 删除。
 * 动过的形状标为 dirty，翻译前要按新形状重新识别文字；新画的形状同样如此。
 * 坐标用 0-1 的相对值，图片怎么缩放都不用重算。
 *
 * 右键图片的弹窗（closed shadow DOM）里使用，样式随 STYLE 一起由调用方注入。
 * 纯计算部分（移动、加删顶点、矩形与椭圆的点列）不依赖 DOM，可以单独测。
 */
(() => {
  const STYLE = `
    .edit-layer {
      position: absolute; inset: 0; z-index: 2;
      cursor: crosshair; touch-action: none; user-select: none;
    }
    .edit-layer[hidden] { display: none; }
    .edit-layer svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
    .edit-layer polygon {
      fill: rgba(245, 158, 11, 0.14); stroke: #f59e0b; stroke-width: 2px; stroke-linejoin: round;
      cursor: move;
    }
    .edit-layer g.dirty polygon { stroke-dasharray: 6 3; }
    .edit-layer g.active polygon { fill: rgba(245, 158, 11, 0.28); stroke: #fbbf24; }
    .edit-layer polygon.draft { fill: rgba(245, 158, 11, 0.1); stroke-dasharray: 5 4; pointer-events: none; }
    .edit-handle {
      position: absolute; width: 10px; height: 10px; margin: -5px 0 0 -5px; box-sizing: border-box;
      border: 1.5px solid #f59e0b; background: #fff; border-radius: 50%; cursor: grab;
    }
    .edit-num {
      position: absolute; transform: translate(-70%, -70%); pointer-events: none;
      padding: 1px 5px; border-radius: 4px;
      font: 600 11px/1.4 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
      color: #111; background: #f59e0b;
    }
    .edit-del {
      all: unset; box-sizing: border-box; position: absolute; transform: translate(-30%, -70%);
      width: 18px; height: 18px; border-radius: 50%; cursor: pointer;
      display: grid; place-items: center;
      font: 600 13px/1 -apple-system, sans-serif; color: #fff; background: #ef4444;
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
    }
    .edit-del:focus-visible { outline: 2px solid #818cf8; outline-offset: 1px; }`;

  const NS = 'http://www.w3.org/2000/svg';
  /** 新画的形状至少要有这么大（屏幕像素），点一下不算。 */
  const MIN_PX = 8;
  /** 椭圆用多少个点近似。 */
  const ELLIPSE_POINTS = 32;

  const clamp01 = (v) => Math.min(1, Math.max(0, v));

  function boundsOf(polygons) {
    const xs = polygons.flat().map((p) => p[0]);
    const ys = polygons.flat().map((p) => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }

  /** 整体平移，限制在图片以内。 */
  function movePolygons(polygons, dx, dy) {
    const b = boundsOf(polygons);
    const mx = Math.min(Math.max(dx, -b.x), 1 - b.x - b.w);
    const my = Math.min(Math.max(dy, -b.y), 1 - b.y - b.h);
    return polygons.map((poly) => poly.map(([x, y]) => [x + mx, y + my]));
  }

  /** 在离 point 最近的那条边上插一个顶点（插在投影点上）。 */
  function insertVertex(poly, [px, py]) {
    let best = 0;
    let bestDist = Infinity;
    let at = null;
    for (let i = 0; i < poly.length; i += 1) {
      const [ax, ay] = poly[i];
      const [bx, by] = poly[(i + 1) % poly.length];
      const dx = bx - ax;
      const dy = by - ay;
      const len = dx * dx + dy * dy;
      const t = len ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
      const qx = ax + t * dx;
      const qy = ay + t * dy;
      const d = Math.hypot(px - qx, py - qy);
      if (d < bestDist) { bestDist = d; best = i; at = [qx, qy]; }
    }
    return [...poly.slice(0, best + 1), at, ...poly.slice(best + 1)];
  }

  /** 删掉一个顶点；少于三个点就不是多边形了，原样返回。 */
  function removeVertex(poly, index) {
    return poly.length > 3 ? poly.filter((_, i) => i !== index) : poly;
  }

  const rectPoints = (r) => [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];

  function ellipsePoints(r, n = ELLIPSE_POINTS) {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return [cx + (Math.cos(a) * r.w) / 2, cy + (Math.sin(a) * r.h) / 2];
    });
  }

  /**
   * @param {HTMLElement} layer 盖在图片上的一层（.edit-layer）
   * @param {object} options
   * @param {() => 'rect'|'ellipse'} options.shape 新画形状的类型
   * @param {string} [options.deleteLabel]
   * @param {(shapes:object[]) => void} [options.onChange]
   */
  function create(layer, { shape = () => 'rect', deleteLabel = 'Delete', onChange } = {}) {
    let shapes = [];
    let active = -1;
    let drag = null;
    let nextId = 1;

    const point = (event) => {
      const r = layer.getBoundingClientRect();
      return [clamp01((event.clientX - r.left) / Math.max(1, r.width)), clamp01((event.clientY - r.top) / Math.max(1, r.height))];
    };
    const changed = () => onChange?.(list());
    const list = () => shapes.map((s) => ({ ...s, polygons: s.polygons.map((poly) => poly.map((p) => [...p])) }));

    function render() {
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 1 1');
      svg.setAttribute('preserveAspectRatio', 'none');
      const extras = [];
      shapes.forEach((s, i) => {
        const g = document.createElementNS(NS, 'g');
        g.classList.toggle('active', i === active);
        g.classList.toggle('dirty', Boolean(s.dirty));
        s.polygons.forEach((poly, k) => {
          const polygon = document.createElementNS(NS, 'polygon');
          polygon.setAttribute('points', poly.map(([x, y]) => `${x},${y}`).join(' '));
          polygon.setAttribute('vector-effect', 'non-scaling-stroke');
          polygon.dataset.shape = String(i);
          polygon.dataset.poly = String(k);
          if (s.text) {
            const title = document.createElementNS(NS, 'title');
            title.textContent = s.text;
            polygon.appendChild(title);
          }
          g.appendChild(polygon);
        });
        svg.appendChild(g);
        const b = boundsOf(s.polygons);
        const num = document.createElement('div');
        num.className = 'edit-num';
        num.textContent = String(i + 1);
        num.style.left = `${b.x * 100}%`;
        num.style.top = `${b.y * 100}%`;
        extras.push(num);
        if (i !== active) return;
        s.polygons.forEach((poly, k) => poly.forEach(([x, y], v) => {
          const handle = document.createElement('div');
          handle.className = 'edit-handle';
          handle.style.left = `${x * 100}%`;
          handle.style.top = `${y * 100}%`;
          Object.assign(handle.dataset, { shape: String(i), poly: String(k), vertex: String(v) });
          extras.push(handle);
        }));
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'edit-del';
        del.textContent = '×';
        del.title = deleteLabel;
        del.setAttribute('aria-label', deleteLabel);
        del.style.left = `${(b.x + b.w) * 100}%`;
        del.style.top = `${b.y * 100}%`;
        del.addEventListener('pointerdown', (event) => event.stopPropagation());
        del.addEventListener('click', () => remove(i));
        extras.push(del);
      });
      if (drag?.draft) {
        const polygon = document.createElementNS(NS, 'polygon');
        polygon.setAttribute('class', 'draft');
        polygon.setAttribute('vector-effect', 'non-scaling-stroke');
        polygon.setAttribute('points', drag.draft.map(([x, y]) => `${x},${y}`).join(' '));
        svg.appendChild(polygon);
      }
      layer.replaceChildren(svg, ...extras);
    }

    function remove(index) {
      if (index < 0 || index >= shapes.length) return;
      shapes.splice(index, 1);
      active = -1;
      render();
      changed();
    }

    function draftFrom(start, end, square) {
      let w = end[0] - start[0];
      let h = end[1] - start[1];
      if (square) {
        // 正方形 / 正圆按屏幕像素算，相对坐标的宽高比例跟着图片走
        const r = layer.getBoundingClientRect();
        const side = Math.max(Math.abs(w) * r.width, Math.abs(h) * r.height);
        w = Math.sign(w || 1) * (side / Math.max(1, r.width));
        h = Math.sign(h || 1) * (side / Math.max(1, r.height));
      }
      const rect = {
        x: clamp01(Math.min(start[0], start[0] + w)), y: clamp01(Math.min(start[1], start[1] + h)),
      };
      rect.w = clamp01(Math.max(start[0], start[0] + w)) - rect.x;
      rect.h = clamp01(Math.max(start[1], start[1] + h)) - rect.y;
      return { rect, points: shape() === 'ellipse' ? ellipsePoints(rect) : rectPoints(rect) };
    }

    layer.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const target = event.target;
      const at = point(event);
      const index = Number(target?.dataset?.shape ?? -1);
      if (target.classList?.contains('edit-handle')) {
        drag = { mode: 'vertex', index, poly: Number(target.dataset.poly), vertex: Number(target.dataset.vertex) };
      } else if (index >= 0) {
        active = index;
        drag = { mode: 'move', index, start: at, origin: shapes[index].polygons };
      } else {
        active = -1;
        drag = { mode: 'draw', start: at, draft: null };
      }
      layer.setPointerCapture(event.pointerId);
      drag.id = event.pointerId;
      drag.moved = false;
      render();
      event.preventDefault();
    });

    layer.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      const at = point(event);
      if (drag.mode === 'move') {
        const s = shapes[drag.index];
        s.polygons = movePolygons(drag.origin, at[0] - drag.start[0], at[1] - drag.start[1]);
        s.dirty = true;
      } else if (drag.mode === 'vertex') {
        const s = shapes[drag.index];
        s.polygons[drag.poly][drag.vertex] = at;
        s.dirty = true;
      } else {
        const { rect, points } = draftFrom(drag.start, at, event.shiftKey);
        drag.rect = rect;
        drag.draft = points;
      }
      drag.moved = true;
      render();
    });

    const finish = (event, keep) => {
      if (!drag || event.pointerId !== drag.id) return;
      const done = drag;
      drag = null;
      if (done.mode === 'draw') {
        const r = layer.getBoundingClientRect();
        if (keep && done.rect && done.rect.w * r.width >= MIN_PX && done.rect.h * r.height >= MIN_PX) {
          shapes.push({ id: `new-${nextId++}`, polygons: [done.draft], dirty: true, created: true });
          active = shapes.length - 1;
        }
        render();
        if (keep) changed();
        return;
      }
      render();
      if (done.moved) changed();
    };
    layer.addEventListener('pointerup', (event) => finish(event, true));
    layer.addEventListener('pointercancel', (event) => finish(event, false));

    layer.addEventListener('dblclick', (event) => {
      const target = event.target;
      const index = Number(target?.dataset?.shape ?? -1);
      if (index < 0) return;
      const s = shapes[index];
      const k = Number(target.dataset.poly);
      if (target.classList?.contains('edit-handle')) {
        s.polygons[k] = removeVertex(s.polygons[k], Number(target.dataset.vertex));
      } else {
        s.polygons[k] = insertVertex(s.polygons[k], point(event));
      }
      s.dirty = true;
      active = index;
      render();
      changed();
    });

    return {
      get shapes() {
        return list();
      },
      get active() {
        return active;
      },
      set(next) {
        shapes = (next || []).map((s, i) => ({
          ...s, id: s.id ?? `shape-${i}`, dirty: Boolean(s.dirty),
          polygons: s.polygons.map((poly) => poly.map((p) => [...p])),
        }));
        active = -1;
        render();
      },
      /** 删掉选中的形状；没有选中时返回 false。 */
      removeActive() {
        if (active < 0) return false;
        remove(active);
        return true;
      },
    };
  }

  globalThis.AITrShapeEditor = {
    STYLE, create, boundsOf, movePolygons, insertVertex, removeVertex, rectPoints, ellipsePoints,
  };
})();
