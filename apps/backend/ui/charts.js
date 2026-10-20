/** 用户端与管理端共用的服务端 SVG 时间图；颜色由各自 CSS 定义，无浏览器图表依赖。 */
import { html } from 'hono/html';
const fmt = (n) => Number(n || 0).toLocaleString('zh-CN');
const round = (n) => Math.round(n * 10) / 10;
const shortNumber = (v) => {
  if (Math.abs(v) >= 1e6) return `${round(v / 1e6)}M`;
  if (Math.abs(v) >= 1e3) return `${round(v / 1e3)}k`;
  return String(round(v));
};

/** 供时间图、构成图与分布图共用的纯文本提示数据；插值统一由 Hono 转义。 */
export function chartPointAttributes(label, items, index) {
  const description = `${label}\n${items.map((item) => `${item.label}：${item.value}`).join('\n')}`;
  return html` data-chart-point data-chart-date="${label}" data-chart-values="${JSON.stringify(items)}" tabindex="${index === 0 ? '0' : '-1'}" role="button" aria-label="${description}"`;
}

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
export function timeChart({ labels, series, format = fmt, width = 760, height = 220, stacked = false, axisFormat = shortNumber, labelFormat = (label) => label.slice(5), showLegend = true, interactive = false, tooltipDateFormat = (label) => label, tooltipItems = null }) {
  // 没有任何数据的序列时不画图，所在面板随之隐藏。
  if (!series.length || !series.some((s) => s.values.some((v) => v))) return '';
  const w = width;
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

  const svg = html`<svg class="chart" viewBox="0 0 ${w} ${h}" role="${interactive ? 'group' : 'img'}" aria-label="${series.map((s) => s.name).join('、')}">
  ${axis.map((v) => html`<line class="grid${v === 0 && lo < 0 ? ' zero' : ''}" x1="${pad.l}" x2="${w - pad.r}" y1="${round(y(v))}" y2="${round(y(v))}"></line>
  <text class="tick" x="${pad.l - 6}" y="${round(y(v)) + 4}" text-anchor="end">${axisFormat(v)}</text>`)}
  ${labels.map((label, i) => ((i % every === 0 && n - 1 - i >= every / 2) || i === n - 1
    ? html`<text class="tick" x="${round(x(i))}" y="${h - 6}" text-anchor="${i === n - 1 && n > 1 ? 'end' : 'middle'}">${labelFormat(label)}</text>` : ''))}
  ${barRects}
  ${lines.map((s, k) => {
    const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${round(x(i))},${round(y(v))}`).join('');
    return html`${k === 0 && lo === 0 ? html`<path class="area ${s.cls}" d="${d}L${round(x(n - 1))},${round(zero)}L${round(x(0))},${round(zero)}Z"></path>` : ''}
  <path class="line ${s.cls}" d="${d}"></path>
  ${n <= 31 ? s.values.map((v, i) => (v ? html`<circle class="dot ${s.cls}" cx="${round(x(i))}" cy="${round(y(v))}" r="2.2"></circle>` : '')) : ''}`;
  })}
  ${labels.map((label, i) => {
    const items = tooltipItems ? tooltipItems(i) : series.map((s) => ({ label: s.name, value: String(format(s.values[i], s, i)), tone: s.cls }));
    const date = tooltipDateFormat(label);
    const description = `${date}\n${items.map((item) => `${item.label}：${item.value}`).join('\n')}`;
    // 交互图的日期命中区连续覆盖整个绘图区，零值日期也能查看，首尾不越过坐标轴。
    const left = i === 0 ? pad.l : (x(i - 1) + x(i)) / 2;
    const right = i === n - 1 ? w - pad.r : (x(i) + x(i + 1)) / 2;
    return html`<rect class="hover" x="${round(interactive ? left : x(i) - slot / 2)}" y="${pad.t}" width="${round(interactive ? right - left : slot)}" height="${ih}"${interactive ? chartPointAttributes(date, items, i) : ''}><title>${description}</title></rect>`;
  })}
</svg>`;
  return html`${interactive ? html`<div class="chart-interactive" data-chart-interactive>${svg}</div>` : svg}
${showLegend ? html`<ul class="legend">${series.map((s) => html`<li><i class="${s.cls}"></i>${s.name}</li>`)}</ul>` : ''}`;
}

