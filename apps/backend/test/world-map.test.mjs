import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { mapMode, worldMap } from '../ui/admin/world-map.js';

const countries = {
  installs: [{ key: 'JP', installs: 8, registered: 3 }],
  usage: [{ key: 'JP', requests: 20, users: 4 }, { key: 'SG', requests: 7, users: 2 }],
  revenue: [{ key: 'JP', revenue: '399', orders: 1 }],
};
test('世界地图：同一地区的安装、请求与收入合并；小地区使用准确定位点，切换指标不混合着色', async () => {
  const page = String(await worldMap(countries));
  assert.match(page, /世界地图 · 使用分布/);
  assert.match(page, /data-country="JP"[^>]*data-chart-values="[^>]*扩展安装[^>]*8[^>]*托管请求[^>]*20[^>]*\$3\.99/);
  assert.match(page, /<circle class="[^"<]*world-marker"[^>]*data-country="SG"/);
  assert.doesNotMatch(page, /NaN|Infinity|https:\/\/(?:api|tile)/);
  const installed = String(await worldMap(countries, { mode: 'installs' }));
  assert.match(installed, /世界地图 · 安装分布/);
  assert.match(installed, /class="world-region map-level-5 has-data"[^>]*data-country="JP"/);
  assert.match(installed, /class="world-region map-level-0 has-data world-marker"[^>]*data-country="SG"/);
  const revenue = String(await worldMap(countries, { mode: 'revenue' }));
  assert.match(revenue, /按 USD 税前净收入着色/);
});

test('世界地图：空数据保留底图，非法指标回退；未知地区保留在文字记录里', async () => {
  assert.equal(mapMode('__proto__'), 'usage');
  assert.equal(mapMode('constructor'), 'usage');
  const empty = String(await worldMap({ installs: [], usage: [], revenue: [] }));
  assert.match(empty, /暂无使用分布数据/);
  assert.match(empty, /data-country="CN"/);
  assert.doesNotMatch(empty, /data-chart-point|NaN|Infinity/);
  const unknown = String(await worldMap({ installs: [], usage: [{ key: 'ZZ', requests: 6, users: 1 }, { key: '<script>', requests: 1 }], revenue: [] }));
  assert.match(unknown, /其他地区记录[\s\S]*ZZ：安装 0 · 请求 6/);
  assert.doesNotMatch(unknown, /<script>/);
});

test('地图几何：本地数据有来源、国家路径与新加坡定位；投影坐标有限且未混入用户统计', () => {
  const data = JSON.parse(fs.readFileSync(new URL('../ui/admin/data/world-map.json', import.meta.url), 'utf8'));
  assert.equal(data.projection, 'Equal Earth');
  assert.ok(data.regions.length > 230);
  assert.equal(data.regions.find((r) => r.code === 'SG').path, '');
  assert.ok(data.regions.find((r) => r.code === 'JP').path.startsWith('M'));
  for (const region of data.regions) {
    assert.ok(Number.isFinite(region.x) && Number.isFinite(region.y));
    assert.ok(region.x >= 0 && region.x <= data.width);
    assert.ok(region.y >= 0 && region.y <= data.height);
    assert.match(region.path, /^[MLZ\d.,]*$/);
    assert.deepEqual(Object.keys(region).sort(), ['code', 'path', 'x', 'y']);
  }
});
