/** 运营统计世界地图：本地轮廓、服务端着色与提示；不按语言推断国家。 */
import fs from 'node:fs';
import { html } from 'hono/html';
import { chartPointAttributes } from '../charts.js';

const map = JSON.parse(fs.readFileSync(new URL('./data/world-map.json', import.meta.url), 'utf8'));
const names = new Intl.DisplayNames(['zh-CN'], { type: 'region' });
const number = (value) => Number(value || 0).toLocaleString('zh-CN');
const money = (value) => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'USD' }).format(Number(value || 0) / 100);
export const MAP_MODES = { usage: '使用分布', installs: '安装分布', revenue: '收入分布' };
export const mapMode = (value) => Object.hasOwn(MAP_MODES, value) ? value : 'usage';

export function worldMap(countries, { mode = 'usage' } = {}) {
  mode = mapMode(mode);
  const stats = new Map();
  const row = (code) => {
    if (!stats.has(code)) stats.set(code, { code, installs: 0, registered: 0, requests: 0, users: 0, revenue: 0, orders: 0 });
    return stats.get(code);
  };
  for (const item of countries.installs) if (/^[A-Z]{2}$/.test(item.key)) Object.assign(row(item.key), { installs: item.installs, registered: item.registered });
  for (const item of countries.usage) if (/^[A-Z]{2}$/.test(item.key)) Object.assign(row(item.key), { requests: item.requests, users: item.users });
  for (const item of countries.revenue) if (/^[A-Z]{2}$/.test(item.key)) Object.assign(row(item.key), { revenue: Number(item.revenue), orders: item.orders });
  const field = { usage: 'requests', installs: 'installs', revenue: 'revenue' }[mode];
  const values = [...stats.values()].map((r) => r[field]).filter((v) => v > 0).sort((a, b) => a - b);
  const level = (value) => value > 0 ? Math.min(5, Math.ceil(values.filter((v) => v <= value).length / values.length * 5)) : 0;
  const description = { usage: '按托管请求数量着色', installs: '按扩展安装数量着色', revenue: '按 USD 税前净收入着色' }[mode];
  const known = new Set(map.regions.map((r) => r.code));
  const unmapped = [...stats.values()].filter((r) => !known.has(r.code));
  let point = 0;
  const title = (code) => `${names.of(code) || code} · ${code}`;
  const shape = (region) => {
    const data = stats.get(region.code);
    const active = data && (data.installs || data.requests || data.revenue || data.orders);
    const items = active ? [
      { label: '扩展安装', value: number(data.installs), tone: 'c3' },
      { label: '安装后注册', value: number(data.registered), tone: 'c1' },
      { label: '托管请求', value: number(data.requests), tone: 'c1' },
      { label: '使用人数', value: number(data.users), tone: 'c4' },
      { label: 'USD 税前净收入', value: money(data.revenue), total: true },
    ] : [];
    const attributes = active ? chartPointAttributes(title(region.code), items, point++) : html` aria-hidden="true"`;
    const cls = `world-region map-level-${level(data?.[field] || 0)}${active ? ' has-data' : ''}`;
    if (!region.path && !active) return '';
    return region.path
      ? html`<path class="${cls}" d="${region.path}" data-country="${region.code}"${attributes}><title>${title(region.code)}${active ? '' : '：暂无记录'}</title></path>`
      : html`<circle class="${cls} world-marker" cx="${region.x}" cy="${region.y}" r="4" data-country="${region.code}"${attributes}><title>${title(region.code)}</title></circle>`;
  };
  return html`<div class="world-map-wrap">
  <div class="world-map-summary"><span>${description}</span><strong>${number(values.length)}<small> 个地区有记录</small></strong></div>
  <div class="chart-interactive world-map" data-chart-interactive>
    <svg viewBox="0 0 ${map.width} ${map.height}" role="group" aria-label="世界地图 · ${MAP_MODES[mode]}">
      <path class="world-ocean" d="${map.ocean}" aria-hidden="true"></path>
      ${map.graticule.map((d) => html`<path class="world-graticule" d="${d}" aria-hidden="true"></path>`)}
      ${map.regions.filter((r) => r.path).map(shape)}
      ${map.regions.filter((r) => !r.path).map(shape)}
    </svg>
  </div>
  <div class="world-map-footer"><div class="world-scale"><span>无记录</span>${[0, 1, 2, 3, 4, 5].map((n) => html`<i class="map-level-${n}"></i>`)}<span>高</span></div><a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener">Natural Earth</a></div>
  <p class="world-map-mobile-hint">左右滑动查看地图</p>
  ${!values.length ? html`<p class="world-map-empty">所选范围内暂无${MAP_MODES[mode]}数据</p>` : ''}
  ${unmapped.length ? html`<details class="world-unmapped"><summary>其他地区记录</summary><ul>${unmapped.map((r) => html`<li>${title(r.code)}：安装 ${number(r.installs)} · 请求 ${number(r.requests)} · ${money(r.revenue)}</li>`)}</ul></details>` : ''}
</div>`;
}
