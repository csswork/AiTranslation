// 图表渐进增强：数值与日期由服务端格式化，只用纯文本展示，不在浏览器重新计算点数。
(() => {
  document.querySelectorAll('[data-chart-interactive]').forEach((root, index) => {
    const points = [...root.querySelectorAll('[data-chart-point]')];
    if (!points.length) return;
    const tip = document.createElement('div');
    tip.className = 'chart-tooltip';
    tip.id = `chart-tooltip-${index}`;
    tip.setAttribute('role', 'tooltip');
    tip.hidden = true;
    root.appendChild(tip);
    let current = null;
    let mode = 'keyboard';
    const hide = () => {
      tip.hidden = true;
      current?.removeAttribute('data-active');
      current?.removeAttribute('aria-describedby');
      current = null;
    };
    const pointOf = (target) => {
      const point = target?.closest?.('[data-chart-point]');
      return points.includes(point) ? point : null;
    };
    const position = (point, event) => {
      const box = root.getBoundingClientRect();
      const bounds = point.getBoundingClientRect();
      const x = event ? event.clientX - box.left : bounds.left + bounds.width / 2 - box.left;
      const y = event ? event.clientY - box.top : bounds.top - box.top + 20;
      const left = Math.max(8, Math.min(x + 14, box.width - tip.offsetWidth - 8));
      const above = y - tip.offsetHeight - 12;
      const top = Math.max(8, Math.min(above >= 8 ? above : y + 16, box.height - tip.offsetHeight - 8));
      tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    };
    const show = (point, event) => {
      if (current !== point) {
        let items;
        try { items = JSON.parse(point.dataset.chartValues); } catch { hide(); return; }
        if (!Array.isArray(items) || !items.every((item) => typeof item?.label === 'string' && typeof item.value === 'string')) { hide(); return; }
        hide();
        const date = document.createElement('div');
        date.className = 'chart-tooltip-date';
        date.textContent = point.dataset.chartDate;
        const rows = items.map((item) => {
          const row = document.createElement('div');
          row.className = `chart-tooltip-row${item.total ? ' chart-tooltip-total' : ''}`;
          const label = document.createElement('span');
          if (!item.total) {
            const swatch = document.createElement('i');
            swatch.className = item.tone === 'usage-secondary' ? 'usage-secondary' : 'usage-primary';
            swatch.setAttribute('aria-hidden', 'true');
            label.appendChild(swatch);
          }
          const text = document.createElement('span');
          text.textContent = item.label;
          label.appendChild(text);
          const value = document.createElement('strong');
          value.textContent = item.value;
          row.append(label, value);
          return row;
        });
        tip.replaceChildren(date, ...rows);
        current = point;
        for (const p of points) p.setAttribute('tabindex', p === point ? '0' : '-1');
        point.setAttribute('data-active', 'true');
        point.setAttribute('aria-describedby', tip.id);
      }
      tip.hidden = false;
      position(point, event);
    };
    // 无脚本时保留原生提示；增强后移除，避免与自定义提示重叠。
    points.forEach((point) => point.querySelector('title')?.remove());
    root.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'touch') return;
      mode = 'mouse';
      const point = pointOf(event.target);
      if (point) show(point, event);
      else hide();
    });
    root.addEventListener('pointerleave', () => { if (mode === 'mouse') hide(); });
    root.addEventListener('pointercancel', hide);
    root.addEventListener('pointerdown', (event) => { mode = event.pointerType === 'touch' ? 'touch' : 'mouse'; });
    root.addEventListener('click', (event) => {
      const point = pointOf(event.target);
      if (point) show(point, event.detail === 0 ? null : event);
    });
    root.addEventListener('focusin', (event) => {
      const point = pointOf(event.target);
      if (point) {
        if (point.matches(':focus-visible')) mode = 'keyboard';
        show(point);
      }
    });
    root.addEventListener('focusout', (event) => { if (!root.contains(event.relatedTarget)) hide(); });
    root.addEventListener('keydown', (event) => {
      const point = pointOf(event.target);
      if (!point) return;
      mode = 'keyboard';
      if (event.key === 'Escape') { event.preventDefault(); hide(); return; }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (tip.hidden) show(point); else hide();
        return;
      }
      const i = points.indexOf(point);
      const next = { ArrowLeft: Math.max(0, i - 1), ArrowRight: Math.min(points.length - 1, i + 1), Home: 0, End: points.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      points[next].focus();
      show(points[next]);
    });
    document.addEventListener('pointerdown', (event) => { if (!root.contains(event.target)) hide(); });
    window.addEventListener('resize', hide);
    window.addEventListener('scroll', hide, { capture: true, passive: true });
  });
})();
