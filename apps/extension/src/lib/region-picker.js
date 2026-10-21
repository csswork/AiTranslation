/**
 * 在图片上拖出若干选区：矩形，或椭圆（shape: 'ellipse'，按拖出的范围内切；
 * 按住 Shift 拖出正方形 / 正圆）。画好后按住选区里面拖动是移动，按住边框拖动是调整大小。
 * 坐标用 0-1 的相对值，图片怎么缩放都不用重算。
 *
 * 右键图片的弹窗（closed shadow DOM）和图片翻译页共用，
 * 样式随 STYLE 一起由调用方注入。
 */
(() => {
  const STYLE = `
    .pick-layer {
      position: absolute; inset: 0; z-index: 2;
      cursor: crosshair; touch-action: none; user-select: none;
    }
    .pick-layer[hidden] { display: none; }
    .pick-rect {
      position: absolute; box-sizing: border-box;
      border: 2px solid #f59e0b; background: rgba(245, 158, 11, 0.12);
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
    }
    .pick-rect.draft { border-style: dashed; }
    .pick-rect.ellipse { border-radius: 50%; }
    .pick-rect.active { background: rgba(245, 158, 11, 0.2); }
    /* 调整大小的把手：悬停或拖动时才出现，免得框一多就满屏小方块 */
    .pick-handle {
      position: absolute; width: 9px; height: 9px; margin: -5px 0 0 -5px; box-sizing: border-box;
      border: 1.5px solid #f59e0b; background: #fff; border-radius: 2px;
      opacity: 0; transition: opacity 0.12s;
    }
    .pick-rect:hover .pick-handle, .pick-rect.active .pick-handle { opacity: 1; }
    @media (prefers-reduced-motion: reduce) { .pick-handle { transition: none; } }
    .pick-num {
      position: absolute; left: -2px; top: -2px;
      padding: 1px 5px; border-radius: 0 0 4px 0;
      font: 600 11px/1.4 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
      color: #111; background: #f59e0b;
    }
    .pick-del {
      all: unset; box-sizing: border-box; position: absolute; right: -9px; top: -9px;
      width: 18px; height: 18px; border-radius: 50%; cursor: pointer;
      display: grid; place-items: center;
      font: 700 13px/1 -apple-system, sans-serif; color: #111; background: #f59e0b;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
    }
    .pick-del:focus-visible { outline: 2px solid #818cf8; outline-offset: 1px; }`;

  /** 小于这个像素尺寸的框多半是误点。 */
  const MIN_PX = 8;
  /** 边框的感应宽度（屏幕像素）：按在这一圈里是调整大小，按在里面是移动。 */
  const EDGE_PX = 8;
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const CURSORS = {
    move: 'move', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
    nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
  };
  /** 把手的位置（相对外接框的比例）：矩形在四角和四边中点，椭圆在圆周上。 */
  const DIAG = 0.5 - Math.SQRT1_2 / 2;
  const HANDLES = {
    rect: { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] },
    ellipse: { nw: [DIAG, DIAG], n: [0.5, 0], ne: [1 - DIAG, DIAG], e: [1, 0.5], se: [1 - DIAG, 1 - DIAG],
      s: [0.5, 1], sw: [DIAG, 1 - DIAG], w: [0, 0.5] },
  };

  /**
   * 按下的位置落在选区的哪一部分（选区内的屏幕像素坐标）：边框一圈返回调整方向
   * （n/s/e/w 及其组合），里面返回 'move'。椭圆按离圆周的远近判断，沿圆周哪里都能拖。
   */
  function hitMode(px, py, w, h, ellipse = false, edge = EDGE_PX) {
    const e = Math.min(edge, w / 4, h / 4);
    if (ellipse) {
      const nx = (px - w / 2) / (w / 2 || 1);
      const ny = (py - h / 2) / (h / 2 || 1);
      // 离圆周不到 e 个像素才算按在边上（按长短轴分别折算成比例）
      if (Math.hypot(nx, ny) < 1 - e / Math.min(w / 2, h / 2)) return 'move';
      return (ny < -0.38 ? 'n' : ny > 0.38 ? 's' : '') + (nx < -0.38 ? 'w' : nx > 0.38 ? 'e' : '') || 'move';
    }
    const mode = (py <= e ? 'n' : py >= h - e ? 's' : '') + (px <= e ? 'w' : px >= w - e ? 'e' : '');
    return mode || 'move';
  }

  /**
   * 拖动后的选区（0-1 相对坐标）：移动时整体平移、不出图；调整时只动拖着的边，
   * 不小于 min，也不越过对边。
   */
  function adjust(box, mode, dx, dy, min = { w: 0, h: 0 }) {
    if (mode === 'move') {
      return { ...box, x: clamp(box.x + dx, 0, 1 - box.w), y: clamp(box.y + dy, 0, 1 - box.h) };
    }
    let x0 = box.x;
    let y0 = box.y;
    let x1 = box.x + box.w;
    let y1 = box.y + box.h;
    if (mode.includes('w')) x0 = clamp(x0 + dx, 0, x1 - min.w);
    if (mode.includes('e')) x1 = clamp(x1 + dx, x0 + min.w, 1);
    if (mode.includes('n')) y0 = clamp(y0 + dy, 0, y1 - min.h);
    if (mode.includes('s')) y1 = clamp(y1 + dy, y0 + min.h, 1);
    return { ...box, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /**
   * @param {HTMLElement} layer 盖在图片上、与图片同尺寸的容器
   * @param {{max?:number, onChange?:(regions:Array)=>void, onLimit?:()=>void, deleteLabel?:string,
   *   shape?:()=>'rect'|'ellipse'}} options shape 在每次开始拖拽时读取
   */
  function create(layer, { max = 12, onChange, onLimit, deleteLabel = '', shape = () => 'rect' } = {}) {
    let regions = [];
    let draft = null;
    /** 正在移动或调整的选区 */
    let edit = null;

    const point = (event, bounded = true) => {
      const r = layer.getBoundingClientRect();
      const x = (event.clientX - r.left) / Math.max(1, r.width);
      const y = (event.clientY - r.top) / Math.max(1, r.height);
      return bounded ? { x: clamp01(x), y: clamp01(y) } : { x, y };
    };
    /** 按在选区节点上的哪一部分 */
    const modeAt = (node, event) => {
      const r = node.getBoundingClientRect();
      return hitMode(event.clientX - r.left, event.clientY - r.top, r.width, r.height, node.classList.contains('ellipse'));
    };
    const place = (node, box) => {
      node.style.left = `${box.x * 100}%`;
      node.style.top = `${box.y * 100}%`;
      node.style.width = `${box.w * 100}%`;
      node.style.height = `${box.h * 100}%`;
    };

    function render() {
      layer.replaceChildren(
        ...regions.map((box, index) => {
          const node = document.createElement('div');
          node.className = box.shape === 'ellipse' ? 'pick-rect ellipse' : 'pick-rect';
          node.dataset.index = String(index);
          place(node, box);
          for (const [mode, [hx, hy]] of Object.entries(HANDLES[box.shape === 'ellipse' ? 'ellipse' : 'rect'])) {
            const handle = document.createElement('span');
            handle.className = 'pick-handle';
            handle.dataset.mode = mode;
            handle.style.left = `${hx * 100}%`;
            handle.style.top = `${hy * 100}%`;
            handle.style.cursor = CURSORS[mode];
            node.appendChild(handle);
          }
          const num = document.createElement('span');
          num.className = 'pick-num';
          num.textContent = String(index + 1);
          const del = document.createElement('button');
          del.type = 'button';
          del.className = 'pick-del';
          del.textContent = '×';
          del.title = deleteLabel;
          del.setAttribute('aria-label', deleteLabel);
          del.addEventListener('click', (event) => {
            event.stopPropagation();
            regions.splice(index, 1);
            render();
            onChange?.(list());
          });
          node.append(num, del);
          return node;
        })
      );
    }

    const list = () => regions.map((r) => ({ ...r }));

    layer.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest?.('.pick-del')) return;
      event.preventDefault();
      // 按在已有选区上：把手或边框是调整大小，里面是移动
      const hit = event.target.closest?.('.pick-rect:not(.draft)');
      if (hit) {
        const index = Number(hit.dataset.index);
        layer.setPointerCapture?.(event.pointerId);
        hit.classList.add('active');
        edit = {
          id: event.pointerId, index, node: hit, box: { ...regions[index] }, start: point(event, false),
          mode: event.target.closest('.pick-handle')?.dataset.mode || modeAt(hit, event),
        };
        return;
      }
      if (regions.length >= max) {
        onLimit?.();
        return;
      }
      layer.setPointerCapture?.(event.pointerId);
      const node = document.createElement('div');
      const ellipse = shape() === 'ellipse';
      node.className = ellipse ? 'pick-rect draft ellipse' : 'pick-rect draft';
      layer.appendChild(node);
      draft = { id: event.pointerId, start: point(event), node, box: null, ellipse };
    });
    layer.addEventListener('pointermove', (event) => {
      if (edit && event.pointerId === edit.id) {
        const now = point(event, false);
        const r = layer.getBoundingClientRect();
        const min = { w: MIN_PX / Math.max(1, r.width), h: MIN_PX / Math.max(1, r.height) };
        regions[edit.index] = adjust(edit.box, edit.mode, now.x - edit.start.x, now.y - edit.start.y, min);
        place(edit.node, regions[edit.index]);
        return;
      }
      if (!draft) {
        // 没在拖动：光标提示按下去会移动还是调整大小
        const node = event.target.closest?.('.pick-rect:not(.draft)');
        if (node && !event.target.closest('.pick-handle, .pick-del')) node.style.cursor = CURSORS[modeAt(node, event)];
        return;
      }
      if (event.pointerId !== draft.id) return;
      let end = point(event);
      if (event.shiftKey) {
        // 按住 Shift：按屏幕像素取等长的两边，拖出正方形 / 正圆
        const r = layer.getBoundingClientRect();
        const dx = (end.x - draft.start.x) * r.width;
        const dy = (end.y - draft.start.y) * r.height;
        const side = Math.min(Math.abs(dx), Math.abs(dy));
        end = {
          x: clamp01(draft.start.x + (Math.sign(dx) * side) / Math.max(1, r.width)),
          y: clamp01(draft.start.y + (Math.sign(dy) * side) / Math.max(1, r.height)),
        };
      }
      draft.box = globalThis.AITrRegions.rectFrom(draft.start, end);
      if (draft.ellipse) draft.box.shape = 'ellipse';
      place(draft.node, draft.box);
    });
    const finish = (event, keep) => {
      if (edit && event.pointerId === edit.id) {
        const { node, index, box } = edit;
        edit = null;
        node.classList.remove('active');
        // 取消（比如被系统手势打断）就回到拖动前
        if (!keep) {
          regions[index] = box;
          place(node, box);
        }
        onChange?.(list());
        return;
      }
      if (!draft || event.pointerId !== draft.id) return;
      const { box, node } = draft;
      draft = null;
      node.remove();
      const r = layer.getBoundingClientRect();
      if (keep && box && box.w * r.width >= MIN_PX && box.h * r.height >= MIN_PX) {
        regions.push(box);
        render();
        onChange?.(list());
      }
    };
    layer.addEventListener('pointerup', (event) => finish(event, true));
    layer.addEventListener('pointercancel', (event) => finish(event, false));

    return {
      get regions() {
        return list();
      },
      set(next) {
        regions = (next || []).slice(0, max).map((r) => ({ ...r }));
        render();
      },
      clear() {
        regions = [];
        render();
        onChange?.([]);
      },
    };
  }

  globalThis.AITrRegionPicker = { STYLE, create, hitMode, adjust };
})();
