import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import { timeChart } from '../ui/charts.js';
import { donut, funnel, heatmap, histogram } from '../ui/admin/charts.js';

// 轻量事件环境：测试实际浏览器脚本的显示、隐藏和导航行为；布局另用浏览器核对。
class Element {
  constructor(tag = 'div') {
    this.tag = tag; this.attributes = new Map(); this.listeners = new Map();
    this.children = []; this.dataset = {}; this.style = {}; this.text = ''; this.hidden = false;
    this.offsetWidth = 180; this.offsetHeight = 100;
    this.bounds = { left: 100, top: 50, width: 410, height: 230 };
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(''); }
  appendChild(node) { node.parent = this; this.children.push(node); return node; }
  append(...nodes) { nodes.forEach((node) => this.appendChild(node)); }
  replaceChildren(...nodes) { this.text = ''; this.children = []; this.append(...nodes); }
  remove() { this.parent.children = this.parent.children.filter((child) => child !== this); }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  closest(selector) { return selector === '[data-chart-point]' && this.attributes.has('data-chart-point') ? this : this.parent?.closest(selector); }
  matches(selector) { return selector === ':focus-visible' && Boolean(this.focusVisible); }
  querySelector(selector) { return this.children.find((child) => child.tag === selector) || null; }
  querySelectorAll() { return this.points || []; }
  getBoundingClientRect() { return this.bounds; }
  addEventListener(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) || []), fn]); }
  fire(type, props = {}) {
    const event = { target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...props };
    for (const fn of this.listeners.get(type) || []) fn(event);
    return event;
  }
  focus() { this.focusVisible = true; this.parent.focused = this; this.parent.fire('focusin', { target: this }); }
}

function setup() {
  const root = new Element();
  root.points = [12, 0, 7].map((value, i) => {
    const point = new Element('rect');
    point.setAttribute('data-chart-point', ''); point.setAttribute('tabindex', i === 0 ? '0' : '-1');
    point.dataset = { chartDate: `2026-10-${17 + i} UTC`, chartValues: JSON.stringify([{ label: '请求次数', value: String(value), tone: 'usage-primary' }]) };
    point.bounds = { left: 148 + i * 100, top: 62, width: 100, height: 192 };
    point.appendChild(new Element('title'));
    root.appendChild(point);
    return point;
  });
  const document = new Element();
  document.querySelectorAll = () => [root];
  document.createElement = (tag) => new Element(tag);
  const window = Object.assign(new Element(), { innerWidth: 1280, innerHeight: 720 });
  vm.runInNewContext(fs.readFileSync(new URL('../ui/account/assets/chart-tooltip.js', import.meta.url), 'utf8'), { document, window });
  return { root, points: root.points, tip: root.children.at(-1), document, window };
}

test('日期悬停立即显示精确文本，移动到零值日期更新，移出及滚动后关闭', () => {
  const { root, points, tip, window } = setup();
  assert.equal(tip.hidden, true);
  assert.equal(points[0].querySelector('title'), null, '增强后不叠加原生延迟提示');
  root.fire('pointermove', { target: points[0], pointerType: 'mouse', clientX: 180, clientY: 170 });
  assert.equal(tip.hidden, false);
  assert.match(tip.textContent, /2026-10-17 UTC请求次数12/);
  assert.equal(points[0].getAttribute('aria-describedby'), tip.id);
  root.fire('pointermove', { target: points[1], pointerType: 'mouse', clientX: 280, clientY: 180 });
  assert.match(tip.textContent, /2026-10-18 UTC请求次数0/);
  assert.equal(points[0].getAttribute('data-active'), null);
  assert.equal(points[1].getAttribute('data-active'), 'true');
  root.fire('pointerleave');
  assert.equal(tip.hidden, true);
  root.fire('pointermove', { target: points[1], pointerType: 'mouse', clientX: 280, clientY: 180 });
  window.fire('scroll');
  assert.equal(tip.hidden, true);
});

test('提示框贴边时保持在视口内，展示文本不执行 HTML，并保留服务端小数和大整数', () => {
  const { root, points, tip } = setup();
  points[2].dataset.chartValues = JSON.stringify([
    { label: '<img src=x onerror=alert(1)>', value: '0.01 点' },
    { label: '合计', value: '9,007,199,254,740,993', total: true },
  ]);
  root.fire('pointermove', { target: points[2], pointerType: 'mouse', clientX: 1279, clientY: 4 });
  assert.equal(tip.style.transform, 'translate(1092px, 20px)');
  assert.match(tip.textContent, /<img src=x onerror=alert\(1\)>0\.01 点合计9,007,199,254,740,993/);
  assert.equal(tip.children[1].children[0].children.at(-1).tag, 'span');
  assert.match(tip.children[2].className, /chart-tooltip-total/);
});

test('管理图表提示沿用对应系列的颜色，未知样式名不会注入 DOM', () => {
  const { root, points, tip } = setup();
  points[0].dataset.chartValues = JSON.stringify([
    { label: '缓存命中', value: '100', tone: 'c6' },
    { label: '其他', value: '0', tone: 'unexpected class' },
    { label: '失败', value: '1', tone: 'usage-failed' },
  ]);
  root.fire('pointermove', { target: points[0], clientX: 180, clientY: 170 });
  assert.equal(tip.children[1].children[0].children[0].className, 'c6');
  assert.equal(tip.children[2].children[0].children[0].className, 'usage-primary');
  assert.equal(tip.children[3].children[0].children[0].className, 'usage-failed');
});

test('触摸点击保留提示，点图外或取消后关闭，触摸移动不触发悬停', () => {
  const { root, points, tip, document } = setup();
  root.fire('pointermove', { target: points[0], pointerType: 'touch' });
  assert.equal(tip.hidden, true);
  root.fire('pointerdown', { target: points[0], pointerType: 'touch' });
  root.fire('click', { target: points[0], detail: 1, clientX: 180, clientY: 180 });
  root.fire('pointerleave');
  assert.equal(tip.hidden, false);
  document.fire('pointerdown', { target: new Element() });
  assert.equal(tip.hidden, true);
  root.fire('click', { target: points[0], detail: 1, clientX: 180, clientY: 180 });
  root.fire('pointercancel');
  assert.equal(tip.hidden, true);
});

test('键盘聚焦显示日期，左右与 Home/End 导航保持单个 Tab 入口，Esc 与失焦关闭', () => {
  const { root, points, tip } = setup();
  points[0].focus();
  root.fire('pointerleave');
  assert.equal(tip.hidden, false);
  assert.equal(root.fire('keydown', { target: points[0], key: 'ArrowRight' }).defaultPrevented, true);
  assert.equal(root.focused, points[1]);
  assert.match(tip.textContent, /2026-10-18 UTC请求次数0/);
  assert.deepEqual(points.map((p) => p.getAttribute('tabindex')), ['-1', '0', '-1']);
  root.fire('keydown', { target: points[1], key: 'End' });
  assert.equal(root.focused, points[2]);
  root.fire('keydown', { target: points[2], key: 'Home' });
  assert.equal(root.focused, points[0]);
  root.fire('keydown', { target: points[0], key: 'Escape' });
  assert.equal(tip.hidden, true);
  root.fire('keydown', { target: points[0], key: 'Enter' });
  assert.equal(tip.hidden, false);
  root.fire('focusout', { relatedTarget: new Element() });
  assert.equal(tip.hidden, true);
});

test('SVG 交互仅按需启用，包含零值日期、格式化数值和安全转义，管理图表保留原生提示', async () => {
  const options = { labels: ['2026-10-17', '2026-10-18', '2026-10-19'], series: [{ name: '点数', values: [0.01, 0, 1], cls: 'usage-primary' }], width: 460 };
  const basic = String(await timeChart(options));
  assert.match(basic, /role="img"/);
  assert.match(basic, /<title>2026-10-18\n点数：0<\/title>/);
  assert.doesNotMatch(basic, /data-chart-point|data-chart-interactive|tabindex/);
  const interactive = String(await timeChart({ ...options, interactive: true, tooltipDateFormat: (day) => `${day} UTC`,
    tooltipItems: (i) => [{ label: '<script>', value: i === 1 ? '0.00 点' : '0.01 点' }],
  }));
  assert.equal((interactive.match(/data-chart-point/g) || []).length, 3);
  assert.match(interactive, /data-chart-date="2026-10-18 UTC"/);
  assert.match(interactive, /0\.00 点/);
  assert.doesNotMatch(interactive, /<script>/);
  const bounds = [...interactive.matchAll(/<rect class="hover" x="([\d.]+)" y="12" width="([\d.]+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.deepEqual(bounds, [[48, 100], [148, 200], [348, 100]], '连续覆盖从左轴到右边界，包括零值日期');
});

test('管理构成与分布图：小额支出不因取整消失，零值分布可查看，动态标签安全转义', async () => {
  const ring = String(await donut([{ label: '<script>', value: .1, cls: 'c5' }], { format: (value) => `$${(value / 100).toFixed(4)}` }));
  assert.match(ring, /data-chart-point/);
  assert.match(ring, /\$0\.0010/);
  assert.doesNotMatch(ring, /<script>/);
  assert.equal(donut([]), '');
  const heat = String(await heatmap([{ dow: 1, hour: 8, n: 2 }], { timeZone: 'UTC' }));
  assert.equal((heat.match(/data-chart-point/g) || []).length, 168);
  assert.match(heat, /周一 0:00–1:00 · UTC/);
  assert.match(heat, /&quot;value&quot;:&quot;0&quot;/);
  const buckets = String(await histogram([{ label: '<1s', value: 2 }, { label: '1–2s', value: 0 }]));
  assert.equal((buckets.match(/data-chart-point/g) || []).length, 2);
  assert.match(buckets, /data-chart-date="&lt;1s"/);
  const steps = String(await funnel([{ label: '安装', value: 10 }, { label: '用过', value: 0 }, { label: '注册', value: 0 }]));
  assert.match(steps, /上步 — · 总 0%/);
  assert.doesNotMatch(steps, /NaN|Infinity/);
});
