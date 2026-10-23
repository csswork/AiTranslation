/**
 * 管理员界面（管理端）的页面。只有中文；服务端渲染，本站脚本增强配色与图表提示。
 * 样式沿用用户端的 account.css，另加 admin.css（报表与表格）。
 */
import { html, raw } from 'hono/html';
import { renderSVG } from 'uqr';
import { displayCredits } from '../../src/credits/units.js';
import { createI18n } from '../../src/i18n/index.js';
import { INCOME_TYPES } from '../../src/usage/activity.js';
import { SETTING_GROUPS, SETTINGS } from '../../src/settings/index.js';
import { assetUrl } from '../account/assets.js';
import { EXPENSE_CATEGORIES, RECURRING } from '../../src/admin/finance.js';
import { barList, donut, funnel, heatmap, histogram, sparkline, timeChart as renderTimeChart } from './charts.js';
import { MAP_MODES, mapMode as normalizeMapMode, worldMap } from './world-map.js';
import { activityCharts } from '../credit-activity.js';

const NAV = [
  { href: '/', label: '运营概览', key: 'overview' },
  { href: '/api-usage', label: 'API 用量', key: 'api' },
  { href: '/expenses', label: '收支', key: 'expenses' },
  { href: '/users', label: '用户', key: 'users' },
  { href: '/subscriptions', label: '订阅与订单', key: 'subscriptions' },
  { href: '/ledger', label: '点数账本', key: 'ledger' },
  { href: '/settings', label: '规则与服务配置', key: 'settings' },
  { href: '/events', label: '异常', key: 'events' },
  { href: '/audit', label: '操作审计', key: 'audit' },
];

// 管理端所有时间按 REPORT_TIMEZONE 显示，与运营报表的日期切分一致（adminRoutes 启动时设置）。
let timeZone = 'Asia/Shanghai';
export const setTimeZone = (zone) => { timeZone = zone; };
const dt = (value) => (value ? new Date(value).toLocaleString('zh-CN', { hour12: false, timeZone }) : '—');
const d = (value) => (value ? new Date(value).toLocaleDateString('zh-CN', { timeZone }) : '—');
const num = (value) => Number(value || 0).toLocaleString('zh-CN');
const minor = (amount, currency) => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: currency || 'USD' }).format(Number(amount || 0) / 100);
const usd = (micros) => {
  const n = Number(micros || 0);
  if (n > 0 && n < 50) return '<$0.0001';
  // 单次请求的成本很小，不足 1 美分时多显示两位。
  return `$${(n / 1_000_000).toFixed(n > 0 && n < 10_000 ? 4 : 2)}`;
};
const pct = (part, whole) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : '—');

const KIND = { guest: '访客', member: '注册', subscriber: '订阅' };
const ENTRY = { trial_grant: '注册赠送', guest_grant: '访客赠送', transfer: '访客转入', adjust: '管理员补发', usage: '托管扣点', refund: '失败返还', void: '作废' };
const OUTCOME = { granted: '已发放', ip_limited: '同网络超限', daily_cap: '当日总量已满', reinstall: '重装接回', claimed_member: '浏览器已注册' };

// 配色切换与用户端相同：图标表示「点了会变成什么」，脚本（account.js）负责不刷新切换，没有脚本时提交给服务端。
const sun = html`<svg class="i-sun only-dark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>`;
const moon = html`<svg class="i-moon only-light" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>`;

/**
 * 当前请求的配色与路径，由路由在渲染前设置（withPage）。渲染是同步的，不会与其他请求交错。
 */
let pageContext = { theme: null, cookieDomain: '', path: '/' };
export function withPage(context, render) {
  pageContext = context;
  try {
    return render();
  } finally {
    pageContext = { theme: null, cookieDomain: '', path: '/' };
  }
}

const notice = (n) => (n ? html`<p class="notice notice-${n.kind}" role="${n.kind === 'error' ? 'alert' : 'status'}">${n.text}</p>` : '');

/** theme 来自与用户端、官网共用的 theme Cookie（light / dark，未设置时跟随系统）。 */
export function layout({ title, admin = null, active = '', note = null, body, head = '' }) {
  const { theme, cookieDomain, path } = pageContext;
  return html`<!doctype html>
<html lang="zh-CN"${theme ? html` data-theme="${theme}"` : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} · 管理端</title>
<link rel="icon" href="${assetUrl('icon.png')}">
<link rel="stylesheet" href="${assetUrl('account.css')}">
<link rel="stylesheet" href="${assetUrl('admin.css')}">
<script src="${assetUrl('account.js')}" defer></script>
${head}
</head>
<body class="admin ${admin ? 'signed-in' : 'signed-out'}">
<header class="admin-bar">
  <strong><img src="${assetUrl('icon.png')}" alt="" width="22" height="22"> AI 划词翻译 · 管理端</strong>
  <form class="theme-form" method="post" action="/preferences/theme" data-theme-form data-cookie-domain="${cookieDomain || ''}">
    <input type="hidden" name="theme" value="${theme === 'dark' ? 'light' : 'dark'}">
    <input type="hidden" name="next" value="${path}">
    <button class="theme-toggle" type="submit" aria-label="切换配色" title="切换配色" data-to-light="切换到浅色" data-to-dark="切换到深色">${sun}${moon}</button>
  </form>
  ${admin ? html`<span class="muted admin-email">${admin.email}</span><form method="post" action="/logout"><button class="link-button" type="submit">退出</button></form>` : ''}
</header>
<div class="shell">
  ${admin ? html`<nav class="side" aria-label="管理导航"><ul>${NAV.map((item) => html`<li><a href="${item.href}"${item.key === active ? html` aria-current="page"` : ''}>${item.label}</a></li>`)}</ul></nav>` : ''}
  <main class="content">
    ${notice(note)}
    ${body}
    ${admin ? html`<p class="fine admin-timezone" data-timezone="${timeZone}">页面时间均按 ${timeZone} 显示。</p>` : ''}
  </main>
</div>
</body>
</html>`;
}

/* ---------- A1 登录与二步验证 ---------- */

export const loginPage = ({ note = null, email = '' } = {}) => layout({
  title: '管理员登录',
  note,
  body: html`<section class="card auth">
  <h1>管理员登录</h1>
  <p class="muted">只有被指定为管理员的账户能登录。验证码发送到管理员邮箱，随后需要二步验证。</p>
  <p class="muted">登录成功后，此浏览器保留登录 30 天。退出登录或清除 Cookie 后需重新登录。</p>
  <form method="post" action="/login" class="stack" data-auth-form>
    <label for="email">邮箱</label>
    <input id="email" name="email" type="email" required autocomplete="email" value="${email}" dir="ltr">
    <button class="button primary" type="submit">发送验证码</button>
  </form>
</section>`,
});

export const verifyPage = ({ email, note = null, devCode = null }) => layout({
  title: '输入验证码',
  note,
  head: devCode ? html`<script src="${assetUrl('dev-code.js')}" defer></script>` : '',
  body: html`<section class="card auth">
  <h1>输入邮箱验证码</h1>
  ${devCode ? html`<p class="notice notice-ok" role="alert" data-dev-code="${devCode}">开发环境没有发信服务，验证码：<strong dir="ltr">${devCode}</strong></p>` : ''}
  <p class="muted">如果 ${email} 是管理员账户，验证码已发送。</p>
  <form method="post" action="/login/verify" class="stack" data-auth-form>
    <label for="code">6 位验证码</label>
    <input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" required maxlength="6" dir="ltr">
    <button class="button primary" type="submit">继续</button>
  </form>
  <a href="/login">重新输入邮箱</a>
</section>`,
});

export const totpPage = ({ setup = null, note = null }) => layout({
  title: '二步验证',
  note,
  body: html`<section class="card auth">
  <h1>${setup ? '绑定二步验证' : '二步验证'}</h1>
  ${setup
    ? html`<p>用身份验证器 App（如 1Password、Google Authenticator、Authy）扫描下面的二维码添加账户，然后填入 App 显示的 6 位验证码。</p>
  <figure class="totp-qr" aria-label="二步验证二维码">${raw(renderSVG(setup.url, { ecc: 'M', border: 2 }))}</figure>
  <p class="fine">无法扫码时手动输入密钥：</p>
  <p class="secret" dir="ltr"><code>${setup.secret.match(/.{1,4}/g).join(' ')}</code></p>
  <p class="fine">也可以在支持的 App 中打开：<a href="${setup.url}" dir="ltr">otpauth 链接</a>。二维码与密钥只显示在这次绑定过程中。</p>`
    : html`<p class="muted">输入身份验证器 App 显示的 6 位验证码。</p>`}
  <form method="post" action="/2fa" class="stack" data-auth-form>
    <label for="code">验证码</label>
    <input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" required maxlength="6" dir="ltr">
    <button class="button primary" type="submit">${setup ? '完成绑定' : '验证'}</button>
  </form>
</section>`,
});

/* ---------- A2 运营概览 ---------- */

const regionNames = new Intl.DisplayNames(['zh-CN'], { type: 'region' });
const languageNames = new Intl.DisplayNames(['zh-CN'], { type: 'language' });
// 不用旗帜表情：不同系统的显示不一致，有的地区没有对应字形。
const country = (code) => `${regionNames.of(code) || code} · ${code}`;
const language = (code) => (code === 'auto' ? '自动检测' : (() => { try { return languageNames.of(code); } catch { return code; } })());

const AUDIENCE = { guest: ['访客', 'c3'], member: ['注册用户', 'c1'], subscriber: ['订阅用户', 'c2'] };
const PROVIDER = { primary: ['主力模型', 'c1'], fallback: ['主力失败 · 备用成功', 'c4'], failed: ['失败（已返还）', 'c5'] };
const ERRORS = { primary_failed: '主力失败、备用成功', timeout: '超时', network: '网络错误', empty: '模型无内容', batch_parse: '批量结果解析失败', batch_shape: '批量条数不符' };

/** 环比：上一周期为 0 时只在有增长时显示「新」。 */
function delta(cur, prev, { inverse = false } = {}) {
  if (!cur && !prev) return '';
  if (!prev) return html`<span class="delta ${inverse ? 'down' : 'up'}">新增</span>`;
  const change = (cur - prev) / prev;
  if (Math.abs(change) < 0.005) return html`<span class="delta flat">持平</span>`;
  const good = inverse ? change < 0 : change > 0;
  return html`<span class="delta ${good ? 'up' : 'down'}">${change > 0 ? '▲' : '▼'} ${Math.abs(Math.round(change * 100))}%</span>`;
}

function kpiCard({ label, value, sub = '', cur, prev, inverse = false, spark = [], cls = 'c1' }) {
  return html`<section class="kpi">
  <div class="kpi-head"><span class="kpi-label">${label}</span>${cur != null ? delta(cur, prev, { inverse }) : ''}</div>
  <strong>${value}</strong>
  ${sub ? html`<span class="kpi-sub">${sub}</span>` : ''}
  ${sparkline(spark, cls)}
</section>`;
}

const panel = (title, body, { note = '', wide = false, span = '', value = '' } = {}) => (body
  ? html`<section class="card panel${wide ? ' wide' : ''}${span ? ` dashboard-${span}` : ''}"><div class="panel-head"><div><h2>${title}</h2>${note ? html`<p class="muted">${note}</p>` : ''}</div>${value ? html`<strong class="panel-value">${value}</strong>` : ''}</div>${body}</section>`
  : '');

const emptyChart = (text = '所选范围内暂无可展示的数据') => html`<div class="dashboard-empty">${text}</div>`;
// 日期已经按报表时区切分；不要在浏览器把 YYYY-MM-DD 再换算成另一时区。
const timeChart = ({ timeZone, ...options }) => renderTimeChart({
  width: 760, height: 260, interactive: true, labelFormat: (day) => day.slice(5).replace('-', '/'),
  tooltipDateFormat: (day) => `${day}${timeZone ? ` ${timeZone}` : ''}`, ...options,
});

export function overviewPage({ admin, r, geoConfigured, mapMode = 'usage' }) {
  mapMode = normalizeMapMode(mapMode);
  const cur = r.current;
  const prev = r.previous;
  const col = (key) => r.daily.map((d) => d[key]);
  const labels = r.daily.map((d) => d.day);
  const failRate = cur.requests ? cur.failed / cur.requests : 0;
  const hasUsage = cur.requests > 0;

  // 核心指标始终显示（没有数据时为 0）；图表与排行只在有数据时显示。
  const cards = [
    kpiCard({ label: '扩展安装', value: num(cur.installs), cur: cur.installs, prev: prev.installs, spark: col('installs'), cls: 'c3' }),
    kpiCard({ label: '新注册', value: num(cur.members), cur: cur.members, prev: prev.members, spark: col('members'), cls: 'c1',
      sub: r.funnel.installs ? `安装转注册 ${pct(r.funnel.registered, r.funnel.installs)}` : '' }),
    kpiCard({ label: '活跃用户', value: num(cur.active_users), cur: cur.active_users, prev: prev.active_users, spark: col('active_users'), cls: 'c2', sub: '这段时间用过托管翻译' }),
    kpiCard({ label: '托管请求', value: num(cur.requests), cur: cur.requests, prev: prev.requests, spark: col('requests'), cls: 'c1',
      sub: cur.failed ? `失败 ${(failRate * 100).toFixed(1)}%` : '' }),
    kpiCard({ label: '翻译字数', value: num(cur.chars), cur: cur.chars, prev: prev.chars, spark: col('chars'), cls: 'c4' }),
    kpiCard({ label: '有效订阅', value: num(r.subs.active), sub: r.subs.active ? `月付 ${num(r.subs.plans.monthly || 0)} · 年付 ${num(r.subs.plans.yearly || 0)}` : '' }),
  ];

  const growth = ['installs', 'members', 'active_users', 'subs'].some((k) => col(k).some((v) => v > 0))
    ? timeChart({ labels, timeZone: r.timeZone, width: 660, series: [
      { name: '扩展安装', values: col('installs'), cls: 'c3' },
      { name: '新注册', values: col('members'), cls: 'c1' },
      { name: '活跃用户', values: col('active_users'), cls: 'c2' },
      { name: '新订阅', values: col('subs'), cls: 'c4' },
    ].filter((s) => s.values.some((v) => v > 0)) })
    : '';
  const money = financeSections(r);

  const funnelSteps = [
    { label: '安装', value: r.funnel.installs },
    { label: '用过翻译', value: r.funnel.used },
    { label: '注册', value: r.funnel.registered },
    { label: '订阅', value: r.funnel.subscribed },
  ];

  const audienceDonut = donut(r.audiences.map((a) => ({ label: AUDIENCE[a.key]?.[0] || a.key, value: a.requests, cls: AUDIENCE[a.key]?.[1] || 'c6' })));
  const planDonut = r.subs.active ? donut([
    { label: '月付', value: r.subs.plans.monthly || 0, cls: 'c1' },
    { label: '年付', value: r.subs.plans.yearly || 0, cls: 'c2' },
  ]) : '';

  const langs = [
    { title: '目标语言', rows: r.targetLangs.map((l) => ({ label: language(l.key), value: l.requests, note: `${num(l.users)} 人` })), cls: 'c1' },
    { title: '源语言', rows: r.sourceLangs.map((l) => ({ label: language(l.key), value: l.requests })), cls: 'c4' },
    { title: '扩展界面语言', rows: r.uiLangs.map((l) => ({ label: language(l.key), value: l.installs })), cls: 'c3' },
  ];

  const latencyBuckets = r.latency && r.latency.p50 != null ? [
    { label: '<1s', value: r.latency.b1 }, { label: '1–2s', value: r.latency.b2 }, { label: '2–4s', value: r.latency.b3 },
    { label: '4–8s', value: r.latency.b4 }, { label: '≥8s', value: r.latency.b5 },
  ] : [];
  const sizeBuckets = r.sizes ? [
    { label: '≤50', value: r.sizes.b1 }, { label: '≤200', value: r.sizes.b2 }, { label: '≤500', value: r.sizes.b3 },
    { label: '≤2000', value: r.sizes.b4 }, { label: '>2000', value: r.sizes.b5 },
  ] : [];

  return layout({
    title: '运营概览',
    admin,
    active: 'overview',
    head: html`<script src="${assetUrl('chart-tooltip.js')}" defer></script>`,
    body: html`<div class="admin-dashboard">
<div class="dashboard-heading"><div><p class="dashboard-eyebrow">HUACI / OVERVIEW</p><h1>运营概览</h1><p class="muted">用量、收支与用户增长，一处掌握。</p></div>
  <div class="dashboard-period"><nav class="seg" aria-label="统计时间范围">${[7, 30, 90].map((n) => html`<a href="/?days=${n}&map=${mapMode}"${n === r.days ? html` aria-current="page"` : ''}>近 ${n} 天</a>`)}</nav><span>${labels[0]} — ${labels.at(-1)}</span></div>
</div>
<div class="dashboard-toolbar"><nav aria-label="概览分区"><a href="#api">API 消耗</a><a href="#business">经营收支</a><a href="#growth">用户增长</a><a href="#audience">语言与地区</a><a href="#performance">性能与异常</a></nav><span>环比上期 · ${r.timeZone}</span></div>
${money.api}
<section class="dashboard-section" id="business">
${money.profit}
${money.revenue}
${money.expenses}
</section>
<section class="dashboard-section" id="growth">
<div class="dashboard-section-head"><div><h2 class="section-title">用户与使用</h2><p>从安装到订阅，观察用户的增长与留存信号。</p></div><a href="/users">管理用户 ↗</a></div>
<section class="kpis dashboard-user-kpis">${cards}</section>
<div class="panels dashboard-grid">
  ${panel('增长趋势', growth || emptyChart(), { span: 'main', note: '安装 · 注册 · 活跃 · 新订阅' })}
  ${panel('请求来自', audienceDonut || emptyChart('暂无托管请求'), { span: 'side', note: '按请求时的用户类型' })}
  ${panel('转化漏斗', r.funnel.installs ? funnel(funnelSteps) : '', { wide: true, note: '这段时间安装的用户后来做了什么' })}
</div>
${planDonut || r.outcomes.length ? html`<details class="dashboard-details"><summary>订阅与访客领取<span>查看构成与领取结果</span></summary><div class="panels dashboard-grid">
  ${panel('订阅方案', planDonut, { note: '当前有效订阅' })}
  ${panel('访客领取', r.outcomes.length ? barList(r.outcomes.map((o) => ({ label: OUTCOME[o.key] || o.key, value: o.n, note: `${displayCredits(o.credit_units)} 点` })), { cls: 'c3' }) : '')}
</div></details>` : ''}
</section>
<section class="dashboard-section" id="audience">
<div class="dashboard-section-head"><div><h2 class="section-title">语言与地区</h2><p>从世界地图了解服务的使用范围，查看全局语言偏好。</p></div></div>
<div class="panels dashboard-grid">
  <section class="card panel wide world-panel"><div class="panel-head"><div><h2>全球分布</h2><p class="muted">悬停或点击有记录的地区查看数据</p></div><nav class="world-modes" aria-label="地图统计指标">${Object.entries(MAP_MODES).map(([key, label]) => html`<a href="/?days=${r.days}&map=${key}#audience"${key === mapMode ? html` aria-current="page"` : ''}>${label}</a>`)}</nav></div>
  <div class="world-layout">${worldMap(r.countries, { mode: mapMode })}<aside class="world-languages" aria-label="全局语言偏好"><h3>语言偏好 <span>全部地区</span></h3>${langs.map((group, index) => html`<details${index === 0 ? html` open` : ''}><summary>${group.title}</summary>${group.rows.length ? barList(group.rows, { cls: group.cls }) : html`<p class="muted">暂无记录</p>`}</details>`)}</aside></div>
  </section>
</div>
${!r.countries.installs.length && !r.countries.usage.length && !geoConfigured && hasUsage ? html`<p class="dashboard-note">地区统计尚未配置。设置 GEO_COUNTRY_HEADER（例如 Cloudflare 的 cf-ipcountry）后按国家汇总，不记录具体位置。</p>` : ''}
</section>
<section class="dashboard-section" id="performance">
<div class="dashboard-section-head"><div><h2 class="section-title">性能与异常</h2><p>查看高峰时段、响应表现与需要处理的问题。</p></div><a href="/events">查看异常 ↗</a></div>
<div class="panels dashboard-grid">
  ${panel('使用时段', hasUsage ? heatmap(r.heat, { timeZone: r.timeZone }) : emptyChart('暂无请求时段数据'), { wide: true, note: `星期 × 小时 · ${r.timeZone}` })}
  ${panel('响应耗时', latencyBuckets.length ? html`<dl class="stats"><div><dt>P50</dt><dd>${num(r.latency.p50)} ms</dd></div><div><dt>P90</dt><dd>${num(r.latency.p90)} ms</dd></div><div><dt>P95</dt><dd>${num(r.latency.p95)} ms</dd></div><div><dt>P99</dt><dd>${num(r.latency.p99)} ms</dd></div></dl>${histogram(latencyBuckets, { cls: 'c4' })}` : '')}
  ${panel('请求字数', hasUsage ? histogram(sizeBuckets, { cls: 'c1' }) : '', { note: '每次请求的字符数' })}
  ${panel('异常与降级', r.errors.length ? barList(r.errors.map((e) => ({ label: ERRORS[e.key] || e.key, value: e.n })), { cls: 'c5' }) : '')}
</div>
${r.topUsers.length ? html`<details class="dashboard-details"><summary>用量最高的用户<span>按翻译字数排序 · 前 10 位</span></summary><div class="table-wrap"><table>
    <thead><tr><th>用户</th><th>类型</th><th class="num">请求</th><th class="num">字数</th><th class="num">成本</th></tr></thead>
    <tbody>${r.topUsers.map((u) => html`<tr><td><a href="/users/${u.user_id}">${u.kind === 'guest' ? '访客' : u.username}</a></td><td>${KIND[u.audience] || KIND[u.kind]}</td><td class="num">${num(u.requests)}</td><td class="num">${num(u.chars)}</td><td class="num">${usd(u.cost_micros)}</td></tr>`)}</tbody>
  </table></div></details>` : ''}
</section>
<p class="dashboard-note">日期与时段均按 ${r.timeZone} 统计；环比为上一个等长周期。模型成本与手续费为估算，收入为 USD 税前金额，其他币种单列。</p>
</div>
`,
  });
}

/* ---------- 收入、支出、利润与 API 消耗 ---------- */

const cents = (v) => minor(Math.round(v), 'USD');
const REJECTIONS = {
  insufficient_credits: '点数不足',
  frozen: '托管服务已冻结',
  too_long: '超过单次字数上限',
  rate_limited: '请求过频',
  fair_use: '超过订阅月度上限',
  hosted_unavailable: '托管服务停用',
};
const PROVIDER_NAMES = { deepseek: 'DeepSeek 官方', fireworks: 'Fireworks' };
const sumBy = (rows, f) => rows.reduce((n, r) => n + f(r), 0);
const cumulativeOf = (values) => values.reduce((out, v) => [...out, (out[out.length - 1] || 0) + v], []);

/**
 * API 与经营保留零值指标和主要图表的空状态；收入、支出与模型明细可折叠。
 */
function financeSections(r) {
  const f = r.finance;
  const cur = f.current;
  const prev = f.previous;
  const labels = f.daily.map((d) => d.day);
  const col = (key) => f.daily.map((d) => d[key]);
  const money = (v) => usd(Number(v) * 10_000);
  const models = f.api.models;
  const tokens = f.api.tokens;
  const hasApi = models.length > 0;
  const chart = (options) => timeChart({ timeZone: r.timeZone, ...options });
  const parts = [
    { label: f.useBills ? '模型 API（账单）' : '模型 API（估算）', value: cur.api, cls: 'c5' },
    { label: '支付手续费（估算）', value: cur.fees, cls: 'c3' },
    ...Object.entries(f.byCategory).map(([k, v], i) => ({ label: EXPENSE_CATEGORIES[k] || k, value: v, cls: ['c1', 'c4', 'c6', 'c2'][i % 4] })),
  ].filter((p) => p.value > 0);

  // 经营：净收入 − 支出 = 利润
  const profit = html`<div class="dashboard-section-head"><div><h2 class="section-title">经营</h2><p>收入、成本与利润，按相同币种比较。</p></div><a href="/expenses">管理收支 ↗</a></div>
<section class="kpis">
  ${kpiCard({ label: '净收入', value: cents(cur.net), cur: cur.net, prev: prev.net, spark: col('net'), cls: 'c2', sub: cur.refunded ? `毛收入 ${cents(cur.gross)} · 退款 ${cents(cur.refunded)}` : '' })}
  ${kpiCard({ label: '总支出', value: cents(cur.expenses), cur: cur.expenses, prev: prev.expenses, inverse: true, spark: col('expenses'), cls: 'c5', sub: f.useBills ? '模型成本按账单' : '模型成本按估算' })}
  ${kpiCard({ label: cur.profit >= 0 ? '利润' : '亏损', value: cents(cur.profit), cur: Math.max(cur.profit, 0), prev: Math.max(prev.profit, 0), spark: col('net').map((v, i) => v - f.daily[i].expenses), cls: cur.profit >= 0 ? 'c2' : 'c5' })}
  ${kpiCard({ label: '利润率', value: cur.margin != null ? `${(cur.margin * 100).toFixed(1)}%` : '—', sub: cur.margin == null ? '还没有收入' : prev.margin != null ? `上期 ${(prev.margin * 100).toFixed(1)}%` : '' })}
</section>
<div class="panels dashboard-grid">
  ${panel('每日收支与利润', chart({
    labels, width: 660,
    series: [
      { name: '净收入', values: col('net').map((v) => v / 100), cls: 'c2', kind: 'bar' },
      { name: '支出', values: col('expenses').map((v) => v / 100), cls: 'c5', kind: 'bar' },
      { name: '利润', values: f.daily.map((d) => (d.net - d.expenses) / 100), cls: 'c1' },
    ], format: (v) => `$${Number(v).toFixed(2)}`,
    axisFormat: (v) => `$${Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}k` : Math.round(v * 100) / 100}`,
  }) || emptyChart('暂无收支记录，录入支出或产生订单后显示趋势'), { span: 'main', note: '每日净收入与支出 · 折线为利润，支持负值' })}
  ${panel('支出构成', donut(parts, { format: money, valueLabel: '金额', center: cents(cur.expenses).replace('US', '') }) || emptyChart('暂无支出记录'), { span: 'side', note: f.useBills ? '模型成本按账单' : '模型成本按估算' })}
</div>
<details class="dashboard-details"><summary>累计收入、支出与利润<span>展开累计趋势</span></summary>
  ${chart({
    labels,
    series: [
      { name: '累计净收入', values: cumulativeOf(col('net')).map((v) => v / 100), cls: 'c2' },
      { name: '累计支出', values: cumulativeOf(col('expenses')).map((v) => v / 100), cls: 'c5' },
      { name: '累计利润', values: cumulativeOf(col('net').map((v, i) => v - f.daily[i].expenses)).map((v) => v / 100), cls: 'c1' },
    ].filter((s) => s.values.some((v) => v !== 0)),
    format: (v) => `$${Number(v).toFixed(2)}`,
    axisFormat: (v) => `$${Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}k` : Math.round(v * 100) / 100}`,
  }) || emptyChart()}
</details>`;

  // 收入
  const revenueCountries = r.countries.revenue;
  const revenueOther = r.revenue.filter((x) => x.currency !== 'USD');
  const revenue = html`<details class="dashboard-details"><summary>收入明细<span>${num(cur.orders)} 笔订单 · MRR ${cents(r.subs.mrrCents)}</span></summary><div class="dashboard-detail-body"><h2 class="section-title">收入</h2>
<section class="kpis">
  ${kpiCard({ label: '毛收入', value: cents(cur.gross), cur: cur.gross, prev: prev.gross, spark: col('gross'), cls: 'c2', sub: `${num(cur.orders)} 笔订单` })}
  ${kpiCard({ label: '退款', value: cents(cur.refunded), cur: cur.refunded, prev: prev.refunded, inverse: true, sub: cur.gross ? `退款率 ${pct(cur.refunded, cur.gross)}` : '' })}
  ${kpiCard({ label: '续费收入', value: cents(cur.renewalNet), cur: cur.renewalNet, prev: prev.renewalNet, cls: 'c4', sub: cur.net ? `占净收入 ${pct(cur.renewalNet, cur.net)}` : '' })}
  ${kpiCard({ label: '付费用户人均（ARPPU）', value: cents(f.payers ? cur.net / f.payers : 0), sub: `${num(f.payers)} 位付费用户` })}
  ${kpiCard({ label: '月经常性收入（MRR）', value: cents(r.subs.mrrCents), sub: r.subs.active ? `年化 ${cents(r.subs.mrrCents * 12)} · 按价格展示估算` : '' })}
</section>
<div class="panels dashboard-grid">
  ${panel('每日收入', chart({
    labels,
    stacked: true,
    series: [
      { name: '新购', values: col('newNet').map((v) => v / 100), cls: 'c2', kind: 'bar' },
      { name: '续费', values: col('renewalNet').map((v) => v / 100), cls: 'c4', kind: 'bar' },
    ].filter((s) => s.values.some((v) => v > 0)),
    format: (v) => `$${Number(v).toFixed(2)}`,
  }), { wide: true, note: '净额，USD 税前' })}
  ${panel('收入按方案', f.byPlan.length ? donut(f.byPlan.map((p) => ({ label: p.plan === 'yearly' ? `年付 · ${p.orders} 笔` : `月付 · ${p.orders} 笔`, value: Math.round(p.net), cls: p.plan === 'yearly' ? 'c2' : 'c1' })), { format: money, center: cents(sumBy(f.byPlan, (p) => p.net)).replace('US', '') }) : '')}
  ${panel('收入地区', revenueCountries.length ? barList(revenueCountries.map((c) => ({ label: country(c.key), value: Number(c.revenue), note: `${c.orders} 笔` })), { format: (v) => minor(v, 'USD'), cls: 'c2' }) : '', { note: 'Creem 账单国家' })}
  ${panel('其他币种收入', revenueOther.length ? html`<ul class="plain">${revenueOther.map((x) => html`<li dir="ltr">${minor(x.gross - x.refunded, x.currency)} <span class="muted">（${x.orders} 笔，不计入上面的 USD 合计）</span></li>`)}</ul>` : '')}
</div></div></details>`;

  // 支出
  const expenses = html`<details class="dashboard-details"><summary>支出明细<span>${f.useBills ? '模型成本按账单' : '模型成本按估算'} · 手续费按设置估算</span></summary><div class="dashboard-detail-body"><h2 class="section-title">支出 <a class="section-link" href="/expenses">录入支出</a></h2>
<section class="kpis">
  ${kpiCard({ label: '总支出', value: cents(cur.expenses), cur: cur.expenses, prev: prev.expenses, inverse: true, spark: col('expenses'), cls: 'c5' })}
  ${kpiCard({ label: f.useBills ? '模型 API（账单）' : '模型 API（估算）', value: cents(cur.api), cur: cur.api, prev: prev.api, inverse: true, spark: col('api'), cls: 'c5',
    sub: cur.net ? `占收入 ${pct(cur.api, cur.net)}` : '' })}
  ${kpiCard({ label: '手续费（估算）', value: cents(cur.fees), cur: cur.fees, prev: prev.fees, inverse: true, cls: 'c3' })}
  ${kpiCard({ label: '其他支出', value: cents(cur.other), cur: cur.other, prev: prev.other, inverse: true, cls: 'c1', sub: '服务器、域名等，按天分摊' })}
</section>
<div class="panels dashboard-grid">
  ${panel('每日支出', chart({
    labels,
    stacked: true,
    series: [
      { name: f.useBills ? '模型 API（账单）' : '模型 API（估算）', values: col('api').map((v) => v / 100), cls: 'c5', kind: 'bar' },
      { name: '支付手续费', values: col('fees').map((v) => v / 100), cls: 'c3', kind: 'bar' },
      { name: '其他支出', values: col('other').map((v) => v / 100), cls: 'c1', kind: 'bar' },
    ].filter((s) => s.values.some((v) => v > 0)),
    format: (v) => `$${Number(v).toFixed(v > 0 && v < 1 ? 4 : 2)}`,
  }), { wide: true })}
  ${Object.keys(f.byCategory).length ? '' : html`<section class="card panel hint"><h2>固定支出</h2><p class="muted">服务器、域名、发信等固定支出还没有录入，利润只扣除了模型与支付手续费。<a href="/expenses">去录入</a></p></section>`}
</div></div></details>`;

  // API 消耗
  // 每日序列包含缺少服务商标记的历史记录；卡片与图表共用它，缓存只算一次。
  const totalInput = sumBy(tokens, (t) => t.input + t.cached);
  const totalCached = sumBy(tokens, (t) => t.cached);
  const totalOutput = sumBy(tokens, (t) => t.output);
  const totalCost = Math.round(cur.apiEstimate * 10_000);
  const totalChars = r.current.chars;
  const totalRequests = r.current.requests;
  const rejected = r.rejections.reduce((n, x) => n + x.n, 0);
  const api = html`<section class="dashboard-section" id="api"><div class="dashboard-section-head"><div><h2 class="section-title">API 消耗 <a class="section-link" href="/api-usage?days=${r.days}">查看每位用户 ↗</a></h2><p>先看消耗，再看请求质量与模型成本。</p></div><span class="dashboard-status${r.current.failed ? ' warn' : ''}">${r.current.requests ? `失败率 ${pct(r.current.failed, r.current.requests)}` : '暂无请求'}</span></div>
<section class="kpis dashboard-api-kpis">
  ${kpiCard({ label: '输入 token', value: num(totalInput), sub: totalCached ? `缓存命中 ${pct(totalCached, totalInput)}` : '', spark: tokens.map((t) => t.input + t.cached), cls: 'c1' })}
  ${kpiCard({ label: '输出 token', value: num(totalOutput), spark: tokens.map((t) => t.output), cls: 'c4' })}
  ${kpiCard({ label: '模型成本（估算）', value: usd(totalCost), sub: totalChars ? `每万字 ${usd((totalCost / totalChars) * 10000)}` : '', cls: 'c5' })}
  ${kpiCard({ label: '被拒绝的请求', value: num(rejected), cur: rejected, prev: r.prevRejectionCount, inverse: true, cls: 'c5',
    sub: rejected ? `${num(new Set(r.rejections.map((x) => x.key)).size)} 种原因 · 最多：${REJECTIONS[r.rejections[0].key] || r.rejections[0].key}` : '' })}
</section>
<div class="dashboard-statline"><span>模型请求 <strong>${num(totalRequests)}</strong></span><span>每次请求平均 <strong>${num(Math.round((totalInput + totalOutput) / Math.max(totalRequests, 1)))} token</strong></span><span>输入 ${num(Math.round(totalInput / Math.max(totalRequests, 1)))} · 输出 ${num(Math.round(totalOutput / Math.max(totalRequests, 1)))}</span>${cur.apiBills ? html`<span>模型 API 账单（录入） <strong>${cents(cur.apiBills)}</strong> · 估算 ${cents(cur.apiEstimate)}</span>` : ''}</div>
<div class="panels dashboard-grid">
  ${panel('每日 token', chart({
    labels,
    width: 660, stacked: true,
    series: [
      { name: '输入（未命中缓存）', values: tokens.map((t) => t.input), cls: 'c1', kind: 'bar' },
      { name: '输入（缓存命中）', values: tokens.map((t) => t.cached), cls: 'c6', kind: 'bar' },
      { name: '输出', values: tokens.map((t) => t.output), cls: 'c4', kind: 'bar' },
    ].filter((s) => s.values.some((v) => v > 0)),
    tooltipItems: (i) => [
      { label: '输入（未命中缓存）', value: num(tokens[i].input), tone: 'c1' },
      { label: '输入（缓存命中）', value: num(tokens[i].cached), tone: 'c6' },
      { label: '输出', value: num(tokens[i].output), tone: 'c4' },
      { label: '合计', value: num(tokens[i].input + tokens[i].cached + tokens[i].output), total: true },
    ],
  }) || emptyChart('模型返回用量数据后，将在这里展示每日消耗'), { span: 'main', note: '输入含缓存命中 · 按天堆叠', value: `${num(totalInput + totalOutput)} token` })}
  ${panel('模型路由', donut(r.providers.map((p) => ({ label: PROVIDER[p.key]?.[0] || p.key, value: p.requests, cls: PROVIDER[p.key]?.[1] || 'c1' }))) || emptyChart('暂无模型调用'), { span: 'side', note: '主力、备用与失败请求' })}
  ${panel('托管请求', chart({ labels: r.daily.map((d) => d.day), width: 460, height: 230, stacked: true, series: [
    { name: '成功请求', values: r.daily.map((d) => d.requests - d.failed), cls: 'c1', kind: 'bar' },
    { name: '失败请求', values: r.daily.map((d) => d.failed), cls: 'c5', kind: 'bar' },
  ] }) || emptyChart('暂无托管请求'), { note: '成功与失败请求 · 被拒绝的请求另计', value: num(r.current.requests) })}
  ${panel('每日模型成本', chart({ labels, width: 460, height: 230, series: [{ name: '模型成本（估算）', values: col('apiEstimate').map((v) => v / 100), cls: 'c6' }], format: (v) => usd(v * 1_000_000), axisFormat: (v) => `$${Number(v).toFixed(2)}` }) || emptyChart('暂无模型成本数据'), { note: '按模型单价估算 · 不包含固定支出与手续费', value: usd(totalCost) })}
</div>
${hasApi || rejected ? html`<details class="dashboard-details"><summary>消耗与异常明细<span>模型、被拒原因及用户成本</span></summary><div class="panels dashboard-grid">
  ${panel('按服务商与模型', hasApi && html`<div class="table-wrap"><table>
    <thead><tr><th>服务商</th><th>模型</th><th class="num">请求</th><th class="num">失败</th><th class="num">输入 token</th><th class="num">缓存命中</th><th class="num">输出 token</th><th class="num">平均耗时</th><th class="num">成本（估算）</th><th class="num">每万字</th></tr></thead>
    <tbody>${models.map((m) => html`<tr>
      <td>${PROVIDER_NAMES[m.provider] || m.provider}</td><td dir="ltr"><code>${m.model}</code></td>
      <td class="num">${num(m.requests)}</td><td class="num">${m.failed ? num(m.failed) : '—'}</td>
      <td class="num">${num(m.input_tokens)}</td><td class="num">${m.cached_tokens ? pct(m.cached_tokens, m.input_tokens) : '—'}</td>
      <td class="num">${num(m.output_tokens)}</td><td class="num">${m.latency != null ? `${num(m.latency)} ms` : '—'}</td>
      <td class="num">${usd(m.cost_micros)}</td><td class="num">${m.chars ? usd((m.cost_micros / m.chars) * 10000) : '—'}</td>
    </tr>`)}</tbody>
  </table></div>`, { wide: true, note: '成本按「规则与服务配置」里的单价估算' })}
  ${panel('被拒绝的请求', rejected ? barList(r.rejections.map((x) => ({ label: REJECTIONS[x.key] || x.key, value: x.n, note: `${num(x.users)} 人` })), { cls: 'c5' }) : '', { note: '没有调用模型、不扣点' })}
  ${panel('成本按用户类型', r.audiences.some((a) => Number(a.cost_micros) > 0)
    ? barList(r.audiences.filter((a) => Number(a.cost_micros) > 0).map((a) => ({ label: AUDIENCE[a.key]?.[0] || a.key, value: Number(a.cost_micros), cls: AUDIENCE[a.key]?.[1], note: `${num(a.users)} 人` })), { format: usd })
    : '', { note: r.costPerSubscriberMicros != null ? `每位订阅用户 ${usd(r.costPerSubscriberMicros)}` : '' })}
</div></details>` : ''}
</section>`;

  return { profit, revenue, expenses, api };
}

/* ---------- API 用量：每位用户 ---------- */

export function apiUsagePage({ admin, days, q, sort, data }) {
  const t = data.totals;
  const link = (params) => `/api-usage?${new URLSearchParams({ days: days ?? 'all', ...(q ? { q } : {}), sort, ...params })}`;
  const head = (key, label) => html`<th class="num"><a href="${link({ sort: key })}"${sort === key ? html` aria-current="true"` : ''}>${label}${sort === key ? ' ↓' : ''}</a></th>`;
  return layout({
    title: 'API 用量',
    admin,
    active: 'api',
    body: html`<div class="head-row"><div><h1>API 用量</h1><p class="muted">每位使用托管翻译（我们的服务器 API）的用户；成功与失败来自请求记录，被拒指点数不足、过频等未调用模型的请求。</p></div>
  <nav class="seg">${[[7, '7 天'], [30, '30 天'], [90, '90 天'], ['all', '全部']].map(([d, label]) => html`<a href="${link({ days: d })}"${String(days ?? 'all') === String(d) ? html` aria-current="page"` : ''}>${label}</a>`)}</nav></div>
<form method="get" action="/api-usage" class="search"><input type="hidden" name="days" value="${days ?? 'all'}"><input type="hidden" name="sort" value="${sort}"><input name="q" value="${q}" placeholder="邮箱、用户名或用户 ID" dir="ltr"><button class="button" type="submit">搜索</button></form>
${data.users.length ? html`<section class="kpis">
  ${kpiCard({ label: '使用的用户', value: num(t.users), sub: t.users >= 200 ? '只列出前 200 位' : '' })}
  ${kpiCard({ label: '请求', value: num(t.ok + t.failed), sub: `失败 ${num(t.failed)} · 被拒 ${num(t.rejected)}` })}
  ${kpiCard({ label: 'token', value: num(t.input_tokens + t.output_tokens), sub: `输入 ${num(t.input_tokens)} · 输出 ${num(t.output_tokens)}` })}
  ${kpiCard({ label: '成本（估算）', value: usd(t.cost_micros), sub: t.users ? `人均 ${usd(t.cost_micros / t.users)}` : '' })}
</section>
<section class="card"><div class="table-wrap"><table>
  <thead><tr><th>用户</th><th>类型</th>${head('requests', '请求')}<th class="num">失败</th>${head('rejected', '被拒')}${head('chars', '字数')}${head('tokens', 'token（入 / 出）')}<th class="num">扣点</th>${head('cost', '成本（估算）')}${head('last', '最近使用')}</tr></thead>
  <tbody>${data.users.map((u) => html`<tr>
    <td><a href="/users/${u.user_id}">${u.kind === 'guest' ? '访客' : u.username}</a>${u.kind === 'member' ? html` <span class="muted" dir="ltr">${u.email}</span>` : ''}${u.hosted_frozen_at ? html` <span class="tag warn">已冻结</span>` : ''}</td>
    <td>${KIND[u.audience] || KIND[u.kind]}</td>
    <td class="num">${num(u.ok + u.failed)}</td><td class="num">${u.failed ? num(u.failed) : '—'}</td><td class="num">${u.rejected ? num(u.rejected) : '—'}</td>
    <td class="num">${num(u.chars)}</td><td class="num">${num(u.input_tokens)} / ${num(u.output_tokens)}</td><td class="num">${u.audience === 'subscriber' ? '订阅' : displayCredits(u.credit_units)}</td>
    <td class="num">${usd(u.cost_micros)}</td><td class="num">${dt(u.last_used)}</td>
  </tr>`)}</tbody>
</table></div></section>` : html`<section class="card empty-state"><h2>${q ? '没有匹配的用户' : '这段时间没有用户使用托管翻译'}</h2></section>`}`,
  });
}

/* ---------- 收支：录入支出 ---------- */

export function expensesPage({ admin, expenses, today, note }) {
  const monthly = expenses.filter((e) => e.recurring === 'monthly' && (!e.end_date || e.end_date >= today));
  const yearly = expenses.filter((e) => e.recurring === 'yearly' && (!e.end_date || e.end_date >= today));
  const fixedPerMonth = sumBy(monthly, (e) => e.amount_cents) + sumBy(yearly, (e) => e.amount_cents) / 12;
  return layout({
    title: '收支',
    admin,
    active: 'expenses',
    note,
    body: html`<h1>收支</h1>
<p class="muted">收入来自 Creem 回调，自动统计；模型 API 成本按用量估算，支付手续费按费率估算（口径在「规则与服务配置 · 收支口径」里修改）。这里录入其余支出：服务器、域名、发信、推广等，按月或按年循环的支出会按天分摊到报表。</p>
${fixedPerMonth ? html`<section class="kpis">${kpiCard({ label: '当前固定支出', value: `${cents(fixedPerMonth)} / 月`, sub: `每月 ${monthly.length} 项 · 每年 ${yearly.length} 项（折月）` })}</section>` : ''}
<section class="card">
  <h2>录入支出</h2>
  <form method="post" action="/expenses" class="expense-form">
    <label>类别<select name="category" required>${Object.entries(EXPENSE_CATEGORIES).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select></label>
    <label>金额（USD）<input name="amount" inputmode="decimal" required placeholder="10.00" dir="ltr"></label>
    <label>周期<select name="recurring">${Object.entries(RECURRING).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select></label>
    <label>日期 / 开始<input name="start_date" type="date" required value="${today}"></label>
    <label>结束（循环支出可选）<input name="end_date" type="date"></label>
    <label class="span">备注<input name="note" maxlength="200" placeholder="例如 Hetzner CX22、huaci.app 续费"></label>
    <button class="button primary" type="submit">添加</button>
  </form>
  <p class="fine">金额按美元记录；其他币种请换算成美元。录入「模型 API 账单」后，可在收支口径里改为按账单计算模型成本。</p>
</section>
${expenses.length ? html`<section class="card">
  <h2>已录入</h2>
  <div class="table-wrap"><table>
    <thead><tr><th>类别</th><th class="num">金额</th><th>周期</th><th>开始</th><th>结束</th><th>备注</th><th>录入</th><th></th></tr></thead>
    <tbody>${expenses.map((e) => html`<tr>
      <td>${EXPENSE_CATEGORIES[e.category] || e.category}</td><td class="num" dir="ltr">${cents(e.amount_cents)}</td><td>${RECURRING[e.recurring]}</td>
      <td>${e.start_date}</td><td>${e.end_date || (e.recurring === 'none' ? '—' : '持续')}</td><td>${e.note || ''}</td><td class="muted">${e.created_by || ''}</td>
      <td><form method="post" action="/expenses/${e.id}/delete" class="inline"><input name="reason" required maxlength="200" placeholder="删除原因"><button class="link-button" type="submit">删除</button></form></td>
    </tr>`)}</tbody>
  </table></div>
</section>` : ''}`,
  });
}

/* ---------- A3 / A6 用户 ---------- */

export function usersPage({ admin, q, users }) {
  return layout({
    title: '用户',
    admin,
    active: 'users',
    body: html`<h1>用户</h1>
<form method="get" action="/users" class="search"><input name="q" value="${q}" placeholder="邮箱、用户名或用户 ID" dir="ltr"><button class="button" type="submit">搜索</button></form>
<div class="table-wrap"><table>
  <thead><tr><th>用户名</th><th>邮箱</th><th>类型</th><th class="num">点数</th><th class="num">安装</th><th>订阅</th><th>注册时间</th><th>托管</th></tr></thead>
  <tbody>${users.map((u) => html`<tr>
    <td><a href="/users/${u.id}">${u.username}</a></td><td dir="ltr">${u.email || '—'}</td><td>${KIND[u.kind]}</td>
    <td class="num">${displayCredits(u.balance_units)}</td><td class="num">${u.installs ? num(u.installs) : '—'}</td><td>${u.sub_status || '—'}</td><td>${d(u.created_at)}</td><td>${u.hosted_frozen_at ? html`<span class="tag warn">已冻结</span>` : '正常'}</td>
  </tr>`)}</tbody>
</table></div>
${users.length ? '' : html`<p class="muted">没有匹配的用户。</p>`}`,
  });
}

const reasonField = html`<input name="reason" required maxlength="200" placeholder="原因（必填，记入审计）">`;

const activityUI = createI18n('zh-Hans');
const ledgerTable = (entries, direction, showUser = false) => html`<div class="table-wrap"><table data-ledger="${direction}">
  <thead><tr><th>时间</th>${showUser ? html`<th>用户</th>` : ''}<th>类型</th><th class="num">点数</th><th>原因</th></tr></thead>
  <tbody>${entries.map((e) => html`<tr><td>${dt(e.created_at)}</td>${showUser ? html`<td><a href="/users/${e.user_id}">${e.username}</a></td>` : ''}
    <td>${ENTRY[e.entry_type] || e.entry_type}</td><td class="num" dir="ltr">${displayCredits(e.amount_units, { signed: true })}</td><td>${e.reason || ''}</td></tr>`)}</tbody>
</table></div>`;
const expenseDetails = (activity, showUser = false) => html`<details class="card activity-details">
  <summary>支出明细<span>${activity.expenses.length}</span></summary>
  ${activity.expenses.length ? ledgerTable(activity.expenses, 'expense', showUser) : html`<p class="muted">暂无点数记录。</p>`}
</details>`;
const requestDetails = (events, showUser = false) => html`<details class="card activity-details">
  <summary>请求明细<span>${events.length}</span></summary>
  ${events.length ? html`<div class="table-wrap"><table>
    <thead><tr><th>时间</th>${showUser ? html`<th>用户</th>` : ''}<th>类型</th><th class="num">字数</th><th class="num">点数</th><th>模型</th><th class="num">输入</th><th class="num">输出</th><th class="num">成本</th><th class="num">耗时</th><th>语言</th><th>结果</th></tr></thead>
    <tbody>${events.map((e) => html`<tr data-status="${e.status}"><td>${dt(e.created_at)}</td>${showUser ? html`<td><a href="/users/${e.user_id}">${e.username}</a></td>` : ''}
      <td>${KIND[e.audience] || '—'}</td><td class="num">${num(e.chars)}</td><td class="num">${e.audience === 'subscriber' ? '订阅' : displayCredits(e.status === 'failed' ? 0n : e.cost_units)}</td><td>${e.model || '—'}</td>
      <td class="num">${e.input_tokens != null ? num(e.input_tokens) : '—'}</td><td class="num">${e.output_tokens != null ? num(e.output_tokens) : '—'}</td>
      <td class="num">${e.cost_micros != null ? usd(e.cost_micros) : '—'}</td><td class="num">${e.latency_ms ?? '—'}</td><td>${e.target_lang ? language(e.target_lang) : '—'}</td>
      <td>${e.status === 'ok' ? '成功' : e.status === 'failed' ? '失败（已返还）' : e.status}${e.error ? html` <span class="muted">${ERRORS[e.error] || e.error}</span>` : ''}</td></tr>`)}</tbody>
  </table></div>` : html`<p class="muted">暂无托管请求。</p>`}
</details>`;

const shortId = (id) => (id ? String(id).slice(0, 8) : '');
const installRelation = (r, u) => {
  const merged = r.merged_username ? html`<a href="/users/${r.merged_user_id}">${r.merged_username}</a>` : '本账户';
  if (r.relation === 'merged') return html`合并到${merged}${r.merged_at ? html` <span class="muted">${dt(r.merged_at)}</span>` : ''}`;
  if (r.relation === 'via_merged') return html`重装接回访客 <code>${shortId(r.linked_user_id)}</code>，该访客已合并到本账户`;
  if (r.relation === 'linked') {
    return r.outcome === 'claimed_member' ? '同一浏览器已注册本账户，新访客点数作废' : html`重装后接回本访客`;
  }
  // own：访客自己的安装
  if (r.outcome === 'reinstall') return html`重装，接回访客 ${r.linked_username ? html`<a href="/users/${r.linked_user_id}">${r.linked_username}</a>` : html`<code>${shortId(r.linked_user_id)}</code>`}`;
  if (r.outcome === 'claimed_member') {
    return html`浏览器已注册${r.linked_username ? html` <a href="/users/${r.linked_user_id}">${r.linked_username}</a>` : ''}，点数作废`;
  }
  return u.kind === 'guest' ? '当前访客' : '—';
};
const installsSection = (installs, u) => {
  const { rows, summary } = installs;
  return html`<section class="card" data-installs="${summary.installs}">
  <h2>安装与访客记录</h2>
  ${rows.length ? html`<p class="fine">共 ${summary.installs} 次安装${summary.merged ? html`；合并访客 ${summary.merged} 个，转入 ${displayCredits(summary.transferredUnits)} 点${summary.notTransferred ? html`（${summary.notTransferred} 个未转入：每个账户只接收一个访客的点数，或点数已用完）` : ''}` : ''}。网络是 IP 带密钥哈希的前 8 位，相同即同一网络。</p>
  <div class="table-wrap"><table>
    <thead><tr><th>安装时间</th><th>访客</th><th>领取结果</th><th class="num">赠送</th><th class="num">转入</th><th>关系</th><th>网络</th><th>国家</th><th>界面语言</th></tr></thead>
    <tbody>${rows.map((r) => html`<tr data-relation="${r.relation}">
      <td>${dt(r.created_at)}</td>
      <td dir="ltr">${r.guest_id ? html`<code>${shortId(r.guest_id)}</code>` : '—'}${r.guest_alive && r.guest_id !== u.id ? html` <a href="/users/${r.guest_id}">查看</a>` : ''}</td>
      <td>${OUTCOME[r.outcome] || r.outcome}</td>
      <td class="num">${displayCredits(r.granted_units)}</td>
      <td class="num">${r.relation === 'merged' ? (r.transferred_units == null ? '—' : displayCredits(r.transferred_units)) : ''}</td>
      <td>${installRelation(r, u)}</td>
      <td dir="ltr"><code>${r.network}</code></td>
      <td>${r.country ? country(r.country) : '—'}</td>
      <td>${r.ui_lang ? language(r.ui_lang) : '—'}</td>
    </tr>`)}</tbody>
  </table></div>` : html`<p class="muted">没有扩展安装记录${u.kind === 'member' ? '（只在网页注册，或在记录安装之前合并）' : ''}。</p>`}
</section>`;
};

export function userPage({ admin, u, state, subs, activity, sessions, api, installs, note }) {
  return layout({
    title: u.username,
    admin,
    active: 'users',
    note,
    head: html`<script src="${assetUrl('chart-tooltip.js')}" defer></script>`,
    body: html`<p><a href="/users">← 用户</a></p>
<h1>${u.username}</h1>
<div class="grid">
  <section class="card">
    <h2>账户</h2>
    <dl class="facts">
      <dt>ID</dt><dd dir="ltr"><code>${u.id}</code></dd>
      <dt>类型</dt><dd>${KIND[u.kind]}</dd>
      <dt>邮箱</dt><dd dir="ltr">${u.email || '—'}${u.email_verified_at ? '（已验证）' : ''}</dd>
      <dt>注册时间</dt><dd>${dt(u.created_at)}</dd>
      <dt>有效会话</dt><dd>${sessions}</dd>
      <dt>托管服务</dt><dd>${u.hosted_frozen_at ? html`<span class="tag warn">已冻结 · ${dt(u.hosted_frozen_at)}</span>` : '正常'}</dd>
    </dl>
  </section>
  <section class="card">
    <h2>点数与订阅</h2>
    <p class="big">${state.credits.balance}<span class="unit">点</span></p>
    <p>${state.subscription ? html`订阅中：${state.subscription.plan === 'yearly' ? '年付' : '月付'}（${state.subscription.status}），至 ${d(state.subscription.periodEnd)}` : '没有有效订阅'}</p>
  </section>
</div>

<section class="card">
  <h2>操作</h2>
  <div class="actions">
    <form method="post" action="/users/${u.id}/credits" class="inline">
      <input name="amount" type="number" min="0.01" step="0.01" max="100000" required placeholder="补发点数">${reasonField}
      <button class="button" type="submit">补发点数</button>
    </form>
    <form method="post" action="/users/${u.id}/${u.hosted_frozen_at ? 'unfreeze' : 'freeze'}" class="inline">
      ${reasonField}<button class="button" type="submit">${u.hosted_frozen_at ? '恢复托管服务' : '冻结托管服务'}</button>
    </form>
    <form method="post" action="/users/${u.id}/revoke-sessions" class="inline">
      ${reasonField}<button class="button" type="submit">撤销全部会话</button>
    </form>
    <a class="button danger" href="/users/${u.id}/delete">删除用户…</a>
  </div>
</section>

<section class="card">
  <h2>订阅记录</h2>
  ${subs.length ? html`<div class="table-wrap"><table><thead><tr><th>方案</th><th>状态</th><th>本期结束</th><th>Creem 订阅</th><th>更新</th></tr></thead>
  <tbody>${subs.map((s) => html`<tr><td>${s.plan || '—'}</td><td>${s.status}</td><td>${d(s.current_period_end)}</td><td dir="ltr"><code>${s.provider_subscription_id}</code></td><td>${dt(s.updated_at)}</td></tr>`)}</tbody></table></div>` : html`<p class="muted">无</p>`}
</section>

${installsSection(installs, u)}

${activityCharts(activityUI, activity, { action: `/users/${u.id}` })}
<section class="card">
  <h2>点数收入</h2>
  <p class="fine">点数收入列出最近 ${activity.limit} 条记录，不受图表时间范围影响。</p>
  ${activity.income.length ? ledgerTable(activity.income, 'income') : html`<p class="muted">暂无点数记录。</p>`}
</section>
${expenseDetails(activity)}

${api.all.ok || api.all.failed || api.all.rejected ? html`<h2 class="section-title">API 消耗 <span class="muted section-link">首次 ${dt(api.all.first_used)} · 最近 ${dt(api.all.last_used)}</span></h2>
<div class="table-wrap card"><table>
  <thead><tr><th>范围</th><th class="num">成功</th><th class="num">失败</th><th class="num">被拒</th><th class="num">字数</th><th class="num">输入 token</th><th class="num">缓存命中</th><th class="num">输出 token</th><th class="num">成本（估算）</th></tr></thead>
  <tbody>${[[`近 ${api.days} 天`, api.recent], ['全部', api.all]].map(([label, x]) => html`<tr>
    <td>${label}</td><td class="num">${num(x.ok)}</td><td class="num">${num(x.failed)}</td><td class="num">${num(x.rejected)}</td><td class="num">${num(x.chars)}</td>
    <td class="num">${num(x.input_tokens)}</td><td class="num">${x.cached_tokens ? pct(x.cached_tokens, x.input_tokens) : '—'}</td><td class="num">${num(x.output_tokens)}</td><td class="num">${usd(x.cost_micros)}</td>
  </tr>`)}</tbody>
</table></div>
${api.models.length ? html`<section class="card"><h2>用过的模型</h2><div class="table-wrap"><table>
  <thead><tr><th>服务商</th><th>模型</th><th class="num">请求</th><th class="num">输入 token</th><th class="num">输出 token</th><th class="num">成本（估算）</th></tr></thead>
  <tbody>${api.models.map((m) => html`<tr><td>${PROVIDER_NAMES[m.provider] || m.provider}</td><td dir="ltr"><code>${m.model}</code></td><td class="num">${num(m.requests)}</td><td class="num">${num(m.input_tokens)}</td><td class="num">${num(m.output_tokens)}</td><td class="num">${usd(m.cost_micros)}</td></tr>`)}</tbody>
</table></div></section>` : ''}` : ''}

${requestDetails(activity.events)}

${api.rejections.length ? html`<section class="card">
  <h2>被拒绝的请求</h2>
  <div class="table-wrap"><table><thead><tr><th>时间</th><th>原因</th><th class="num">字数</th><th class="num">需要点数</th><th>目标语言</th></tr></thead>
  <tbody>${api.rejections.map((x) => html`<tr><td>${dt(x.created_at)}</td><td>${REJECTIONS[x.reason] || x.reason}</td><td class="num">${num(x.chars)}</td><td class="num">${x.cost_units == null ? '—' : displayCredits(x.cost_units)}</td><td>${x.target_lang ? language(x.target_lang) : '—'}</td></tr>`)}</tbody></table></div>
</section>` : ''}`,
  });
}

/** 删除用户的确认页：列出将删除与保留的数据，输入邮箱（访客为用户名）并填写原因后才能提交。 */
export function deleteUserPage({ admin, u, summary, confirmation, note }) {
  const { removed, kept } = summary;
  const rows = (items) => items.map(([label, n]) => html`<dt>${label}</dt><dd>${num(n)}</dd>`);
  return layout({
    title: `删除 ${u.username}`,
    admin,
    active: 'users',
    note,
    body: html`<p><a href="/users/${u.id}">← ${u.username}</a></p>
<h1>删除用户</h1>
<section class="card danger-zone">
  <h2>${u.username}<span class="muted"> · ${KIND[u.kind]}${u.email ? html` · <span dir="ltr">${u.email}</span>` : ''}</span></h2>
  <p>删除后无法恢复。该用户的网页与扩展登录立即失效，剩余点数作废；之后用同一邮箱登录会成为新用户。</p>
  <div class="grid">
    <div>
      <h3>将删除</h3>
      <dl class="facts">${rows([['账户资料（邮箱、用户名）', 1], ['登录方式绑定', removed.identities], ['网页与扩展会话', removed.sessions],
        ['点数流水', removed.ledger], ['托管请求记录', removed.usage], ['被拒请求记录', removed.rejections]])}</dl>
      <p class="fine">另外删除该邮箱尚未使用的验证码、扩展授权码与访客关联码。</p>
    </div>
    <div>
      <h3>保留但解除关联</h3>
      <dl class="facts">${rows([['订阅记录', kept.subscriptions], ['订单', kept.orders], ['访客领取记录', kept.guestClaims], ['浏览器标记', kept.browserMarks]])}</dl>
      <p class="fine">订阅与订单只含支付平台对象 ID 和金额，用于收入统计与对账；访客领取记录与浏览器标记只有哈希，用于防止重复领取试用。</p>
    </div>
  </div>
  ${summary.blocked
    ? html`<p class="tag warn">${summary.blocked === 'admin' ? '管理员账号不能在这里删除，请先用命令行取消管理员。' : '该用户仍有有效订阅，请先在 Creem 取消订阅，待订阅结束后再删除。'}</p>`
    : html`<form method="post" action="/users/${u.id}/delete" class="stack">
    <label>请输入 <code dir="ltr">${confirmation}</code> 确认删除
      <input name="confirm" required autocomplete="off" spellcheck="false" dir="ltr"></label>
    <label>删除原因（必填，记入审计）
      <input name="reason" required maxlength="200"></label>
    <div class="confirm-actions">
      <button class="button danger" type="submit">永久删除该用户及其数据</button>
      <a class="button" href="/users/${u.id}">取消</a>
    </div>
  </form>`}
</section>`,
  });
}

/* ---------- A5 订阅与订单 ---------- */

export function subscriptionsPage({ admin, subs, orders, status }) {
  const statuses = ['', 'active', 'scheduled_cancel', 'past_due', 'canceled', 'expired'];
  return layout({
    title: '订阅与订单',
    admin,
    active: 'subscriptions',
    body: html`<h1>订阅与订单</h1>
<nav class="seg">${statuses.map((s) => html`<a href="/subscriptions${s ? `?status=${s}` : ''}"${s === status ? html` aria-current="page"` : ''}>${s || '全部'}</a>`)}</nav>
<section class="card">
  <h2>订阅</h2>
  <div class="table-wrap"><table><thead><tr><th>用户</th><th>方案</th><th>状态</th><th>本期结束</th><th>Creem 订阅</th><th>更新</th></tr></thead>
  <tbody>${subs.map((s) => html`<tr><td>${s.user_id ? html`<a href="/users/${s.user_id}">${s.username || s.user_id}</a>` : '—'}</td><td>${s.plan || '—'}</td><td>${s.status}</td><td>${d(s.current_period_end)}</td><td dir="ltr"><code>${s.provider_subscription_id}</code></td><td>${dt(s.updated_at)}</td></tr>`)}</tbody></table></div>
</section>
<section class="card">
  <h2>订单</h2>
  <div class="table-wrap"><table><thead><tr><th>时间</th><th>用户</th><th>方案</th><th class="num">金额（税前）</th><th class="num">已退款</th><th>状态</th><th>Creem 交易</th></tr></thead>
  <tbody>${orders.map((o) => html`<tr><td>${dt(o.created_at)}</td><td>${o.user_id ? html`<a href="/users/${o.user_id}">${o.username || o.user_id}</a>` : '—'}</td><td>${o.plan || '—'}</td><td class="num" dir="ltr">${minor(o.amount, o.currency)}</td><td class="num" dir="ltr">${o.refunded_amount ? minor(o.refunded_amount, o.currency) : '—'}</td><td>${o.status}</td><td dir="ltr"><code>${o.provider_order_id}</code></td></tr>`)}</tbody></table></div>
  <p class="fine">退款在 Creem 后台发起，结果通过回调写回这里。</p>
</section>`,
  });
}

/* ---------- A6 点数账本 ---------- */

export function ledgerPage({ admin, activity }) {
  const type = activity.incomeType;
  const periodQuery = activity.period === 'month' ? '' : `period=${activity.period}`;
  return layout({
    title: '点数账本',
    admin,
    active: 'ledger',
    head: html`<script src="${assetUrl('chart-tooltip.js')}" defer></script>`,
    body: html`<h1>点数账本</h1>
${activityCharts(activityUI, activity, { action: '/ledger', incomeType: type })}
<section class="card">
  <h2>点数收入</h2>
  <p class="fine">点数收入列出最近 ${activity.limit} 条记录，不受图表时间范围影响。</p>
  <nav class="seg">${['', ...INCOME_TYPES].map((k) => html`<a href="/ledger${k || periodQuery ? `?${[k ? `type=${k}` : '', periodQuery].filter(Boolean).join('&')}` : ''}"${k === type ? html` aria-current="page"` : ''}>${k ? ENTRY[k] : '全部'}</a>`)}</nav>
  ${activity.income.length ? ledgerTable(activity.income, 'income', true) : html`<p class="muted">暂无点数记录。</p>`}
</section>
${expenseDetails(activity, true)}
${requestDetails(activity.events, true)}`,
  });
}

/* ---------- A4 / A7 规则与服务配置 ---------- */

export function settingsPage({ admin, values, defaults, services, note }) {
  return layout({
    title: '规则与服务配置',
    admin,
    active: 'settings',
    note,
    body: html`<h1>规则与服务配置</h1>
<section class="card">
  <h2>服务状态</h2>
  <dl class="facts wide">${services.map((s) => html`<dt>${s.label}</dt><dd>${s.ok ? html`<span class="tag ok">${s.value}</span>` : html`<span class="tag warn">${s.value}</span>`}</dd>`)}</dl>
  <p class="fine">模型 Key、Creem 密钥由 VPS 环境变量配置，这里只显示是否已配置。</p>
</section>
${SETTING_GROUPS.map((group) => html`<section class="card">
  <h2>${group.label}</h2>
  <form method="post" action="/settings" class="settings-form">
    ${SETTINGS.filter((s) => s.group === group.key).map((s) => html`<div class="setting">
      <label for="${s.key}">${s.label}</label>
      ${s.type === 'bool'
        ? html`<select id="${s.key}" name="${s.key}"><option value="true"${values[s.key] ? html` selected` : ''}>启用</option><option value="false"${values[s.key] ? '' : html` selected`}>停用</option></select>`
        : s.type === 'choice'
          ? html`<select id="${s.key}" name="${s.key}">${s.options.map(([value, label]) => html`<option value="${value}"${values[s.key] === value ? html` selected` : ''}>${label}</option>`)}</select>`
          : html`<input id="${s.key}" name="${s.key}" value="${values[s.key]}" dir="ltr"${s.optional ? '' : html` required`}>`}
      <span class="fine">${s.help || ''}${String(values[s.key]) !== String(defaults[s.key]) ? html` 默认 ${String(defaults[s.key])}` : ''}</span>
    </div>`)}
    <div class="setting"><label>修改原因</label>${reasonField}<span></span></div>
    <button class="button primary" type="submit">保存${group.label}</button>
  </form>
</section>`)}`,
  });
}

/* ---------- A8 异常 ---------- */

export function eventsPage({ admin, failures, errorCounts, payments }) {
  return layout({
    title: '异常',
    admin,
    active: 'events',
    body: html`<h1>异常</h1>
<div class="grid">
  <section class="card">
    <h2>7 天内托管错误</h2>
    <table><thead><tr><th>错误</th><th class="num">次数</th></tr></thead>
    <tbody>${errorCounts.map((e) => html`<tr><td>${e.error === 'primary_failed' ? '主力失败、备用成功' : e.error}</td><td class="num">${num(e.n)}</td></tr>`)}</tbody></table>
  </section>
</div>
<section class="card">
  <h2>最近失败的托管请求</h2>
  <div class="table-wrap"><table><thead><tr><th>时间</th><th>用户</th><th>服务商</th><th>模型</th><th class="num">字数</th><th class="num">耗时</th><th>错误</th></tr></thead>
  <tbody>${failures.map((e) => html`<tr><td>${dt(e.created_at)}</td><td><a href="/users/${e.user_id}">${e.username}</a></td><td>${e.provider || '—'}</td><td>${e.model || '—'}</td><td class="num">${num(e.chars)}</td><td class="num">${e.latency_ms ?? '—'}</td><td>${e.error || ''}</td></tr>`)}</tbody></table></div>
  <p class="fine">失败的请求已自动返还点数。</p>
</section>
<section class="card">
  <h2>支付回调</h2>
  <div class="table-wrap"><table><thead><tr><th>收到</th><th>事件</th><th>对象</th><th>状态</th></tr></thead>
  <tbody>${payments.map((p) => html`<tr><td>${dt(p.received_at)}</td><td>${p.event_type}</td><td dir="ltr"><code>${p.object_id || ''}</code></td><td>${p.processed_at ? '已处理' : html`<span class="tag warn">${p.error || '未处理'}</span>`}</td></tr>`)}</tbody></table></div>
  <p class="fine">处理失败的回调会由 Creem 自动重试；重试成功后状态变为已处理。</p>
</section>`,
  });
}

/* ---------- A9 操作审计 ---------- */

export function auditPage({ admin, rows }) {
  return layout({
    title: '操作审计',
    admin,
    active: 'audit',
    body: html`<h1>操作审计</h1>
<div class="table-wrap"><table><thead><tr><th>时间</th><th>管理员</th><th>操作</th><th>对象</th><th>原因</th><th>详情</th></tr></thead>
<tbody>${rows.map((a) => html`<tr><td>${dt(a.created_at)}</td><td>${a.admin_email || '—'}</td><td>${a.action}</td><td dir="ltr">${a.target_type ? html`${a.target_type} <code>${a.target_id}</code>` : '—'}</td><td>${a.reason || ''}</td><td class="detail" dir="ltr">${a.detail ? html`<code>${JSON.stringify(a.detail)}</code>` : ''}</td></tr>`)}</tbody></table></div>`,
  });
}

export const errorPage = ({ admin = null, status, message }) => layout({
  title: status === 404 ? '页面不存在' : '出错了',
  admin,
  body: html`<section class="card empty"><h1>${status === 404 ? '页面不存在' : '出错了'}</h1><p>${message}</p><a href="/">返回概览</a></section>`,
});
