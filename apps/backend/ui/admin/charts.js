/**
 * 管理端报表的图表：服务端生成 SVG，以本站脚本增强提示；无图表依赖、不放宽 CSP。
 * 颜色由 admin.css 的 .c1–.c6 控制，未加载脚本时保留 SVG <title>。
 */
import { html } from 'hono/html';
import { chartPointAttributes } from '../charts.js';
export { timeChart } from '../charts.js';

const fmt = (n) => Number(n || 0).toLocaleString('zh-CN');
const round = (n) => Math.round(n * 10) / 10;

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
export function donut(parts, { center = '', format = fmt, valueLabel = '数量' } = {}) {
  const total = parts.reduce((n, p) => n + p.value, 0);
  if (!total) return '';
  const r = 42;
  const c = 2 * Math.PI * r;
  const share = (value) => value / total < .001 ? '<0.1%' : `${Number(((value / total) * 100).toFixed(1))}%`;
  let offset = 0;
  const arcs = parts.filter((p) => p.value > 0).map((p, i) => {
    const len = (p.value / total) * c;
    const items = [{ label: valueLabel, value: String(format(p.value)), tone: p.cls }, { label: '占比', value: share(p.value), total: true }];
    const arc = html`<circle class="arc ${p.cls}" cx="60" cy="60" r="${r}" stroke-dasharray="${round(len)} ${round(c - len)}" stroke-dashoffset="${round(-offset)}"${chartPointAttributes(p.label, items, i)}><title>${p.label}：${format(p.value)}（${share(p.value)}）</title></circle>`;
    offset += len;
    return arc;
  });
  return html`<div class="donut chart-interactive" data-chart-interactive><svg viewBox="0 0 120 120" role="group" aria-label="${parts.map((p) => `${p.label} ${format(p.value)}`).join('，')}">
  <circle class="arc-track" cx="60" cy="60" r="${r}"></circle>
  <g transform="rotate(-90 60 60)">${arcs}</g>
  <text class="donut-total" x="60" y="58" text-anchor="middle">${center || shortNumber(total)}</text>
  <text class="donut-sub" x="60" y="74" text-anchor="middle">合计</text>
</svg>
<ul class="legend vertical">${parts.filter((p) => p.value > 0).map((p) => html`<li><i class="${p.cls}"></i>${p.label}<b>${format(p.value)}</b><small>${share(p.value)}</small></li>`)}</ul></div>`;
}

/** 转化漏斗：steps: [{ label, value }]，每一步显示数量与相对上一步、相对首步的转化率。 */
export function funnel(steps) {
  const first = steps[0]?.value || 0;
  if (!first) return '';
  return html`<ol class="funnel-steps" aria-label="转化漏斗">
  ${steps.map((s, i) => {
    const prev = i ? steps[i - 1].value : null;
    return html`<li><span><small>${String(i + 1).padStart(2, '0')}</small>${s.label}</span><strong>${fmt(s.value)}</strong>
    <svg viewBox="0 0 100 5" preserveAspectRatio="none" aria-hidden="true"><rect class="track" width="100" height="5" rx="2.5"></rect><rect class="fill c${i + 1}" width="${round(Math.min(100, (s.value / first) * 100))}" height="5" rx="2.5"></rect></svg>
    <p>${i ? `上步 ${prev ? `${Math.round((s.value / prev) * 100)}%` : '—'} · 总 ${Math.round((s.value / first) * 100)}%` : '本期安装用户'}</p></li>`;
  })}
</ol>`;
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
  return html`<div class="chart-interactive" data-chart-interactive><svg class="chart heat" viewBox="0 0 ${left + 24 * cw} ${7 * ch + 22}" role="group" aria-label="请求时段分布（${timeZone}）">
  ${days.map((d, r) => html`<text class="tick" x="${left - 8}" y="${r * ch + 15}" text-anchor="end">周${d}</text>
  ${Array.from({ length: 24 }, (_, hour) => {
    const n = grid.get(`${r + 1}-${hour}`) || 0;
    const level = n ? Math.max(0.12, n / max) : 0;
    return html`<rect class="cell${n ? ' on' : ''}" x="${left + hour * cw}" y="${r * ch}" width="${cw - 3}" height="${ch - 3}" rx="2" fill-opacity="${n ? round(level) : 1}"${chartPointAttributes(`周${d} ${hour}:00–${hour + 1}:00 · ${timeZone}`, [{ label: '请求次数', value: fmt(n), tone: 'c1' }], r * 24 + hour)}><title>周${d} ${hour}:00–${hour + 1}:00：${fmt(n)} 次</title></rect>`;
  })}`)}
  ${[0, 6, 12, 18, 23].map((hour) => html`<text class="tick" x="${left + hour * cw + cw / 2 - 1}" y="${7 * ch + 15}" text-anchor="middle">${hour}时</text>`)}
</svg></div><div class="heat-legend"><span>少</span>${[0, 1, 2, 3, 4].map((level) => html`<i class="heat-level-${level}"></i>`)}<span>多</span></div>`;
}

/** 分布直方图：buckets: [{ label, value }]。 */
export function histogram(buckets, { cls = 'c1' } = {}) {
  const max = Math.max(0, ...buckets.map((b) => b.value));
  if (!max) return '';
  const w = 360;
  const h = 150;
  const bw = w / buckets.length;
  return html`<div class="chart-interactive" data-chart-interactive><svg class="chart hist" viewBox="0 0 ${w} ${h}" role="group" aria-label="请求分布">
  ${buckets.map((b, i) => {
    const bh = (b.value / max) * (h - 44);
    return html`<rect class="bar ${cls}" x="${round(i * bw + 8)}" y="${round(h - 24 - bh)}" width="${round(bw - 16)}" height="${round(Math.max(bh, b.value ? 2 : 0))}" rx="2"></rect>
    <text class="tick" x="${round(i * bw + bw / 2)}" y="${h - 8}" text-anchor="middle">${b.label}</text>
    ${b.value ? html`<text class="bar-num" x="${round(i * bw + bw / 2)}" y="${round(h - 30 - bh)}" text-anchor="middle">${fmt(b.value)}</text>` : ''}
    <rect class="hover" x="${round(i * bw)}" y="0" width="${round(bw)}" height="${h - 24}"${chartPointAttributes(b.label, [{ label: '请求次数', value: fmt(b.value), tone: cls }], i)}><title>${b.label}：${fmt(b.value)}</title></rect>`;
  })}
</svg></div>`;
}
