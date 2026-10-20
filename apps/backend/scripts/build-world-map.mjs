/** 从固定版本的 Natural Earth GeoJSON 生成本地 SVG 路径；仅构建时运行，无运行依赖或网络请求。
 * node scripts/build-world-map.mjs /path/ne_110m_admin_0_countries.geojson /path/ne_50m_admin_0_countries.geojson
 * 数据来源与许可见 ui/admin/data/README.md。投影采用 Equal Earth 的公开数学公式。
 */
import fs from 'node:fs';
const [outlineFile, regionsFile] = process.argv.slice(2);
if (!outlineFile || !regionsFile) throw new Error('需要 110m 国家轮廓与 50m 地区定位的 GeoJSON 路径');
const features = (file) => {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (data.type !== 'FeatureCollection') throw new Error('地图源必须为 GeoJSON FeatureCollection');
  return data.features;
};
const round = (v) => Math.round(v * 10) / 10;
function project([longitude, latitude]) {
  const lon = longitude * Math.PI / 180;
  const lat = latitude * Math.PI / 180;
  const theta = Math.asin(Math.sqrt(3) / 2 * Math.sin(lat));
  const theta2 = theta ** 2;
  const denominator = Math.sqrt(3) / 2 * (1.340264 - 3 * .081106 * theta2 + theta ** 6 * (7 * .000893 + 9 * .003796 * theta2));
  const x = lon * Math.cos(theta) / denominator;
  const y = theta * (1.340264 - .081106 * theta2 + theta ** 6 * (.000893 + .003796 * theta2));
  return [round(450 + x * 158), round(220 - y * 158)];
}
function path(points, close = false) {
  const projected = points.map(project).filter((p, i, all) => !i || p[0] !== all[i - 1][0] || p[1] !== all[i - 1][1]);
  return projected.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join('') + (close ? 'Z' : '');
}
const regions = new Map();
for (const { properties: p } of features(regionsFile)) {
  const code = p.ISO_A2_EH;
  if (!/^[A-Z]{2}$/.test(code) || code === 'AQ' || !Number.isFinite(p.LABEL_X) || !Number.isFinite(p.LABEL_Y)) continue;
  const [x, y] = project([p.LABEL_X, p.LABEL_Y]);
  regions.set(code, { code, x, y, path: '' });
}
for (const { properties: p, geometry } of features(outlineFile)) {
  const code = p.ISO_A2_EH;
  if (!/^[A-Z]{2}$/.test(code) || code === 'AQ') continue;
  if (!regions.has(code)) {
    const [x, y] = project([p.LABEL_X, p.LABEL_Y]);
    regions.set(code, { code, x, y, path: '' });
  }
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  regions.get(code).path += polygons.flatMap((polygon) => polygon.map((ring) => path(ring, true))).join('');
}
const meridian = (lon) => Array.from({ length: 181 }, (_, i) => [lon, i - 90]);
const parallels = [-60, -30, 0, 30, 60].map((lat) => path(Array.from({ length: 181 }, (_, i) => [i * 2 - 180, lat])));
const data = {
  source: 'Natural Earth, public domain', revision: 'ca96624a56bd078437bca8184e78163e5039ad19',
  projection: 'Equal Earth', width: 900, height: 435,
  ocean: path([...meridian(-180), ...meridian(180).reverse()], true),
  graticule: [...parallels, ...[-120, -60, 0, 60, 120].map((lon) => path(meridian(lon)))],
  regions: [...regions.values()].sort((a, b) => a.code.localeCompare(b.code)),
};
fs.writeFileSync(new URL('../ui/admin/data/world-map.json', import.meta.url), `${JSON.stringify(data)}\n`);
console.log(`已生成 ${data.regions.length} 个国家与地区的地图数据`);
