/**
 * 管理端报表的图表：服务端生成的 SVG，不需要浏览器脚本，也不需要放宽 CSP（不用内联样式，
 * 颜色由 admin.css 里的 .c1–.c6 等类控制，随明暗模式变化）。悬停提示用 SVG 的 <title>。
 */
import { html, raw } from 'hono/html';

const fmt = (n) => Number(n || 0).toLocaleString('zh-CN');
const round = (n) => Math.round(n * 10) / 10;

/** 坐标轴的整齐刻度：返回 [0, step, 2·step, …] 覆盖 max。 */
function ticks(max, count = 4) {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw);
  const out = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(v);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}

const shortNumber = (v) => {
  if (Math.abs(v) >= 1e6) return `${round(v / 1e6)}M`;
  if (Math.abs(v) >= 1e3) return `${round(v / 1e3)}k`;
  return String(round(v));
};

/** 指标卡片里的迷你趋势线。 */
export function sparkline(values, cls = 'c1') {
  if (values.length < 2 || !values.some((v) => v > 0)) return '';
  const w = 120;
  const h = 32;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => [round((i / (values.length - 1)) * w), round(h - 2 - (v / max) * (h - 4))]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join('');
  return html`<svg class="spark ${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
  <path class="area" d="${line}L${w},${h}L0,${h}Z"></path><path class="line" d="${line}"></path></svg>`;
}

/** 覆盖 [lo, hi] 的整齐刻度（lo ≤ 0 ≤ hi）。 */
function rangeTicks(lo, hi, count = 4) {
  if (lo === 0) return ticks(hi, count);
  const raw = (hi - lo) / count || 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw);
  const out = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 0.001; v += step) out.push(Math.round(v * 1e6) / 1e6);
  if (out[out.length - 1] < hi) out.push(out[out.length - 1] + step);
  return out;
}

/**
 * 时间序列图：折线（kind 省略）与柱状（kind: 'bar'）可以混用，共用横轴日期；stacked 时柱状堆叠。
 * 数值可以为负（例如利润），纵轴自动包含 0。series: [{ name, values, cls, kind }]。
 */
export function timeChart({ labels, series, format = fmt, height = 220, stacked = false, axisFormat = shortNumber }) {
  // 没有任何数据的序列时不画图，所在面板随之隐藏。
  if (!series.length || !series.some((s) => s.values.some((v) => v))) return '';
  const w = 760;
  const h = height;
  const pad = { l: 48, r: 12, t: 12, b: 26 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const n = labels.length;
  const bars = series.filter((s) => s.kind === 'bar');
  const lines = series.filter((s) => s.kind !== 'bar');
  const stackTotals = stacked ? labels.map((_, i) => bars.reduce((t, s) => t + Math.max(0, s.values[i]), 0)) : [];
  const all = [...lines.flatMap((s) => s.values), ...(stacked ? stackTotals : bars.flatMap((s) => s.values))];
  const lo = Math.min(0, ...all);
  const hi = Math.max(lo === 0 ? 1 : 0, ...all);
  const axis = rangeTicks(lo, hi);
  const bottom = axis[0];
  const top = axis[axis.length - 1];
  const x = (i) => pad.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v) => pad.t + ih - ((v - bottom) / (top - bottom || 1)) * ih;
  const slot = iw / Math.max(n, 1);
  const groups = stacked ? 1 : Math.max(bars.length, 1);
  const barW = Math.max(2, Math.min(18, (slot * 0.7) / groups));
  const every = Math.ceil(n / 8);
  const zero = y(0);

  const barRects = stacked
    ? labels.map((_, i) => {
      let acc = 0;
      return bars.map((s) => {
        const v = Math.max(0, s.values[i]);
        if (!v) return '';
        const y1 = y(acc + v);
        const y0 = y(acc);
        acc += v;
        return html`<rect class="bar ${s.cls}" x="${round(x(i) - barW / 2)}" y="${round(y1)}" width="${round(barW - 1)}" height="${round(Math.max(0.5, y0 - y1))}"></rect>`;
      });
    })
    : bars.map((s, b) => s.values.map((v, i) => (v
      ? html`<rect class="bar ${s.cls}" x="${round(x(i) - (barW * bars.length) / 2 + b * barW)}" y="${round(Math.min(y(v), zero))}" width="${round(barW - 1)}" height="${round(Math.abs(zero - y(v)))}" rx="1"></rect>` : '')));

  return html`<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${series.map((s) => s.name).join('、')}">
  ${axis.map((v) => html`<line class="grid${v === 0 && lo < 0 ? ' zero' : ''}" x1="${pad.l}" x2="${w - pad.r}" y1="${round(y(v))}" y2="${round(y(v))}"></line>
  <text class="tick" x="${pad.l - 6}" y="${round(y(v)) + 4}" text-anchor="end">${axisFormat(v)}</text>`)}
  ${labels.map((label, i) => ((i % every === 0 && n - 1 - i >= every / 2) || i === n - 1
    ? html`<text class="tick" x="${round(x(i))}" y="${h - 6}" text-anchor="${i === n - 1 && n > 1 ? 'end' : 'middle'}">${label.slice(5)}</text>` : ''))}
  ${barRects}
  ${lines.map((s, k) => {
    const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${round(x(i))},${round(y(v))}`).join('');
    return html`${k === 0 && lo === 0 ? html`<path class="area ${s.cls}" d="${d}L${round(x(n - 1))},${round(zero)}L${round(x(0))},${round(zero)}Z"></path>` : ''}
  <path class="line ${s.cls}" d="${d}"></path>
  ${n <= 31 ? s.values.map((v, i) => (v ? html`<circle class="dot ${s.cls}" cx="${round(x(i))}" cy="${round(y(v))}" r="2.2"></circle>` : '')) : ''}`;
  })}
  ${labels.map((label, i) => html`<rect class="hover" x="${round(x(i) - slot / 2)}" y="${pad.t}" width="${round(slot)}" height="${ih}"><title>${label}
${series.map((s) => `${s.name}：${format(s.values[i], s)}`).join('\n')}</title></rect>`)}
</svg>
<ul class="legend">${series.map((s) => html`<li><i class="${s.cls}"></i>${s.name}</li>`)}</ul>`;
}

/** 横向条形排行：items: [{ label, value, note }]。 */
export function barList(items, { format = fmt, cls = 'c1' } = {}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return html`<ul class="bars">${items.map((item) => html`<li>
  <span class="bar-label">${item.label}</span>
  <svg class="bar-track" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><rect class="track" width="100" height="8" rx="4"></rect><rect class="fill ${item.cls || cls}" width="${Math.max(1.5, round((item.value / max) * 100))}" height="8" rx="4"></rect></svg>
  <span class="bar-value">${format(item.value)}${item.note ? html`<small>${item.note}</small>` : ''}</span>
</li>`)}</ul>`;
}

/** 环形图：parts: [{ label, value, cls }]，中间显示总数。 */
export function donut(parts, { center = '', format = fmt } = {}) {
  const total = parts.reduce((n, p) => n + p.value, 0);
  if (!total) return '';
  const r = 42;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const arcs = parts.filter((p) => p.value > 0).map((p) => {
    const len = (p.value / total) * c;
    const arc = html`<circle class="arc ${p.cls}" cx="60" cy="60" r="${r}" stroke-dasharray="${round(len)} ${round(c - len)}" stroke-dashoffset="${round(-offset)}"><title>${p.label}：${format(p.value)}（${Math.round((p.value / total) * 100)}%）</title></circle>`;
    offset += len;
    return arc;
  });
  return html`<div class="donut"><svg viewBox="0 0 120 120" role="img" aria-label="${parts.map((p) => `${p.label} ${p.value}`).join('，')}">
  <circle class="arc-track" cx="60" cy="60" r="${r}"></circle>
  <g transform="rotate(-90 60 60)">${arcs}</g>
  <text class="donut-total" x="60" y="58" text-anchor="middle">${center || shortNumber(total)}</text>
  <text class="donut-sub" x="60" y="74" text-anchor="middle">合计</text>
</svg>
<ul class="legend vertical">${parts.filter((p) => p.value > 0).map((p) => html`<li><i class="${p.cls}"></i>${p.label}<b>${format(p.value)}</b><small>${Math.round((p.value / total) * 100)}%</small></li>`)}</ul></div>`;
}

/** 转化漏斗：steps: [{ label, value }]，每一步显示数量与相对上一步、相对首步的转化率。 */
export function funnel(steps) {
  const first = steps[0]?.value || 0;
  if (!first) return '';
  const w = 760;
  const rowH = 46;
  const h = steps.length * rowH;
  return html`<svg class="chart funnel" viewBox="0 0 ${w} ${h}" role="img" aria-label="转化漏斗">
  ${steps.map((s, i) => {
    const width = Math.max(4, (s.value / first) * (w - 300));
    const prev = i ? steps[i - 1].value : null;
    const rate = prev ? `${Math.round((s.value / prev) * 100)}%` : '';
    return html`<g transform="translate(0 ${i * rowH})">
    <text class="funnel-label" x="0" y="27">${s.label}</text>
    <rect class="bar c${i + 1}" x="110" y="8" width="${round(width)}" height="24" rx="3"><title>${s.label}：${fmt(s.value)}</title></rect>
    <text class="funnel-value" x="${round(118 + width)}" y="28">${fmt(s.value)}${i ? raw(` <tspan class="muted">${rate} · 总 ${Math.round((s.value / first) * 100)}%</tspan>`) : ''}</text>
  </g>`;
  })}
</svg>`;
}

/** 星期 × 小时热力图：cells: [{ dow: 1–7, hour: 0–23, n }]。 */
export function heatmap(cells, { timeZone }) {
  const max = Math.max(0, ...cells.map((c) => c.n));
  if (!max) return '';
  const grid = new Map(cells.map((c) => [`${c.dow}-${c.hour}`, c.n]));
  const days = ['一', '二', '三', '四', '五', '六', '日'];
  const cw = 26;
  const ch = 22;
  const left = 34;
  return html`<svg class="chart heat" viewBox="0 0 ${left + 24 * cw} ${7 * ch + 22}" role="img" aria-label="请求时段分布（${timeZone}）">
  ${days.map((d, r) => html`<text class="tick" x="${left - 8}" y="${r * ch + 15}" text-anchor="end">周${d}</text>
  ${Array.from({ length: 24 }, (_, hour) => {
    const n = grid.get(`${r + 1}-${hour}`) || 0;
    const level = n ? Math.max(0.12, n / max) : 0;
    return html`<rect class="cell${n ? ' on' : ''}" x="${left + hour * cw}" y="${r * ch}" width="${cw - 3}" height="${ch - 3}" rx="2" fill-opacity="${n ? round(level) : 1}"><title>周${d} ${hour}:00–${hour + 1}:00：${fmt(n)} 次</title></rect>`;
  })}`)}
  ${[0, 6, 12, 18, 23].map((hour) => html`<text class="tick" x="${left + hour * cw + cw / 2 - 1}" y="${7 * ch + 15}" text-anchor="middle">${hour}时</text>`)}
</svg>`;
}

/** 分布直方图：buckets: [{ label, value }]。 */
export function histogram(buckets, { cls = 'c1' } = {}) {
  const max = Math.max(0, ...buckets.map((b) => b.value));
  if (!max) return '';
  const w = 360;
  const h = 150;
  const bw = w / buckets.length;
  return html`<svg class="chart hist" viewBox="0 0 ${w} ${h}" role="img">
  ${buckets.map((b, i) => {
    const bh = (b.value / max) * (h - 44);
    return html`<rect class="bar ${cls}" x="${round(i * bw + 8)}" y="${round(h - 24 - bh)}" width="${round(bw - 16)}" height="${round(Math.max(bh, b.value ? 2 : 0))}" rx="2"><title>${b.label}：${fmt(b.value)}</title></rect>
    <text class="tick" x="${round(i * bw + bw / 2)}" y="${h - 8}" text-anchor="middle">${b.label}</text>
    ${b.value ? html`<text class="bar-num" x="${round(i * bw + bw / 2)}" y="${round(h - 30 - bh)}" text-anchor="middle">${fmt(b.value)}</text>` : ''}`;
  })}
</svg>`;
}
