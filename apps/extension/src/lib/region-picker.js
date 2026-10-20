/**
 * 在图片上拖出若干矩形选区。坐标用 0-1 的相对值，图片怎么缩放都不用重算。
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
  const clamp01 = (v) => Math.min(1, Math.max(0, v));

  /**
   * @param {HTMLElement} layer 盖在图片上、与图片同尺寸的容器
   * @param {{max?:number, onChange?:(regions:Array)=>void, onLimit?:()=>void, deleteLabel?:string}} options
   */
  function create(layer, { max = 12, onChange, onLimit, deleteLabel = '' } = {}) {
    let regions = [];
    let draft = null;

    const point = (event) => {
      const r = layer.getBoundingClientRect();
      return {
        x: clamp01((event.clientX - r.left) / Math.max(1, r.width)),
        y: clamp01((event.clientY - r.top) / Math.max(1, r.height)),
      };
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
          node.className = 'pick-rect';
          place(node, box);
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
      if (regions.length >= max) {
        onLimit?.();
        return;
      }
      layer.setPointerCapture?.(event.pointerId);
      const node = document.createElement('div');
      node.className = 'pick-rect draft';
      layer.appendChild(node);
      draft = { id: event.pointerId, start: point(event), node, box: null };
    });
    layer.addEventListener('pointermove', (event) => {
      if (!draft || event.pointerId !== draft.id) return;
      draft.box = globalThis.AITrRegions.rectFrom(draft.start, point(event));
      place(draft.node, draft.box);
    });
    const finish = (event, keep) => {
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

  globalThis.AITrRegionPicker = { STYLE, create };
})();
