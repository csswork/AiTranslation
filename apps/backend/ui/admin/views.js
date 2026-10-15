/**
 * 管理员界面（管理端）的页面。只有中文；服务端渲染，没有浏览器脚本。
 * 样式沿用用户端的 account.css，另加 admin.css（报表与表格）。
 */
import { html } from 'hono/html';
import { SETTING_GROUPS, SETTINGS } from '../../src/settings/index.js';
import { assetUrl } from '../account/assets.js';
import { barList, donut, funnel, heatmap, histogram, sparkline, timeChart } from './charts.js';

const NAV = [
  { href: '/', label: '运营概览', key: 'overview' },
  { href: '/users', label: '用户', key: 'users' },
  { href: '/subscriptions', label: '订阅与订单', key: 'subscriptions' },
  { href: '/ledger', label: '点数账本', key: 'ledger' },
  { href: '/settings', label: '规则与服务配置', key: 'settings' },
  { href: '/events', label: '异常', key: 'events' },
  { href: '/audit', label: '操作审计', key: 'audit' },
];

const dt = (value) => (value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—');
const d = (value) => (value ? new Date(value).toLocaleDateString('zh-CN') : '—');
const num = (value) => Number(value || 0).toLocaleString('zh-CN');
const minor = (amount, currency) => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: currency || 'USD' }).format(Number(amount || 0) / 100);
const usd = (micros) => {
  const n = Number(micros || 0);
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
  <form method="post" action="/login" class="stack">
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
  <form method="post" action="/login/verify" class="stack">
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
    ? html`<p>用身份验证器 App（如 1Password、Google Authenticator、Authy）添加账户，手动输入下面的密钥，然后填入 App 显示的 6 位验证码。</p>
  <p class="secret" dir="ltr"><code>${setup.secret.match(/.{1,4}/g).join(' ')}</code></p>
  <p class="fine">也可以在支持的 App 中打开：<a href="${setup.url}" dir="ltr">otpauth 链接</a>。密钥只显示在这次绑定过程中。</p>`
    : html`<p class="muted">输入身份验证器 App 显示的 6 位验证码。</p>`}
  <form method="post" action="/2fa" class="stack">
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
  if (!prev) return html`<span class="delta up">新增</span>`;
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

const panel = (title, body, { note = '', wide = false } = {}) => (body
  ? html`<section class="card panel${wide ? ' wide' : ''}"><div class="panel-head"><h2>${title}</h2>${note ? html`<span class="muted">${note}</span>` : ''}</div>${body}</section>`
  : '');

export function overviewPage({ admin, r, geoConfigured }) {
  const cur = r.current;
  const prev = r.previous;
  const col = (key) => r.daily.map((d) => d[key]);
  const labels = r.daily.map((d) => d.day);
  const failRate = cur.requests ? cur.failed / cur.requests : 0;
  const revenueOther = r.revenue.filter((x) => x.currency !== 'USD');
  const hasUsage = cur.requests > 0;

  // 只显示有数据的指标：本期和上期都为 0 的不显示。
  const cards = [
    (cur.installs || prev.installs) && kpiCard({ label: '扩展安装', value: num(cur.installs), cur: cur.installs, prev: prev.installs, spark: col('installs'), cls: 'c3' }),
    (cur.members || prev.members) && kpiCard({ label: '新注册', value: num(cur.members), cur: cur.members, prev: prev.members, spark: col('members'), cls: 'c1',
      sub: r.funnel.installs ? `安装转注册 ${pct(r.funnel.registered, r.funnel.installs)}` : '' }),
    (cur.active_users || prev.active_users) && kpiCard({ label: '活跃用户', value: num(cur.active_users), cur: cur.active_users, prev: prev.active_users, spark: col('active_users'), cls: 'c2', sub: '这段时间用过托管翻译' }),
    (cur.requests || prev.requests) && kpiCard({ label: '托管请求', value: num(cur.requests), cur: cur.requests, prev: prev.requests, spark: col('requests'), cls: 'c1',
      sub: cur.failed ? `失败 ${(failRate * 100).toFixed(1)}%` : '' }),
    (cur.chars || prev.chars) && kpiCard({ label: '翻译字数', value: num(cur.chars), cur: cur.chars, prev: prev.chars, spark: col('chars'), cls: 'c4' }),
    (cur.cost_micros || prev.cost_micros) && kpiCard({ label: '模型成本（估算）', value: usd(cur.cost_micros), cur: cur.cost_micros, prev: prev.cost_micros, inverse: true, spark: col('cost_micros'), cls: 'c5',
      sub: cur.chars ? `每万字 ${usd((cur.cost_micros / cur.chars) * 10000)}` : '' }),
    (cur.revenue_usd || prev.revenue_usd) && kpiCard({ label: '收入（USD 税前）', value: minor(cur.revenue_usd, 'USD'), cur: cur.revenue_usd, prev: prev.revenue_usd, spark: col('revenue_usd'), cls: 'c2',
      sub: cur.cost_micros ? `毛利 ${minor(cur.revenue_usd - cur.cost_micros / 10000, 'USD')}` : '' }),
    r.subs.active && kpiCard({ label: '有效订阅', value: num(r.subs.active), sub: `MRR 约 ${minor(r.subs.mrrCents, 'USD')} · 月付 ${num(r.subs.plans.monthly || 0)} · 年付 ${num(r.subs.plans.yearly || 0)}` }),
  ].filter(Boolean);

  const growth = ['installs', 'members', 'active_users', 'subs'].some((k) => col(k).some((v) => v > 0))
    ? timeChart({ labels, series: [
      { name: '扩展安装', values: col('installs'), cls: 'c3' },
      { name: '新注册', values: col('members'), cls: 'c1' },
      { name: '活跃用户', values: col('active_users'), cls: 'c2' },
      { name: '新订阅', values: col('subs'), cls: 'c4' },
    ].filter((s) => s.values.some((v) => v > 0)) })
    : '';
  const usage = hasUsage
    ? timeChart({ labels, series: [
      { name: '成功请求', values: r.daily.map((d) => d.requests - d.failed), cls: 'c1', kind: 'bar' },
      ...(cur.failed ? [{ name: '失败', values: col('failed'), cls: 'c5', kind: 'bar' }] : []),
    ] })
    : '';
  // 订阅收入按笔到账，逐日波动大；用累计值对比收入与成本，更容易看出是否盈利。
  const cumulative = (values) => values.reduce((out, v) => [...out, (out[out.length - 1] || 0) + v], []);
  const money = col('revenue_usd').some((v) => v > 0) || col('cost_micros').some((v) => v > 0)
    ? timeChart({
      labels,
      series: [
        { name: '累计收入', values: cumulative(col('revenue_usd').map((c) => c / 100)), cls: 'c2' },
        { name: '累计模型成本（估算）', values: cumulative(col('cost_micros').map((m) => m / 1_000_000)), cls: 'c5' },
      ].filter((s) => s.values.some((v) => v > 0)),
      format: (v) => `$${Number(v).toFixed(v > 0 && v < 1 ? 4 : 2)}`,
    })
    : '';

  const funnelSteps = [
    { label: '安装', value: r.funnel.installs },
    { label: '用过翻译', value: r.funnel.used },
    { label: '注册', value: r.funnel.registered },
    { label: '订阅', value: r.funnel.subscribed },
  ];

  const audienceDonut = donut(r.audiences.map((a) => ({ label: AUDIENCE[a.key]?.[0] || a.key, value: a.requests, cls: AUDIENCE[a.key]?.[1] || 'c6' })));
  const providerDonut = donut(r.providers.map((p) => ({ label: PROVIDER[p.key][0], value: p.requests, cls: PROVIDER[p.key][1] })));
  const planDonut = r.subs.active ? donut([
    { label: '月付', value: r.subs.plans.monthly || 0, cls: 'c1' },
    { label: '年付', value: r.subs.plans.yearly || 0, cls: 'c2' },
  ]) : '';
  const costByAudience = r.audiences.some((a) => Number(a.cost_micros) > 0)
    ? barList(r.audiences.filter((a) => Number(a.cost_micros) > 0).map((a) => ({ label: AUDIENCE[a.key]?.[0] || a.key, value: Number(a.cost_micros), cls: AUDIENCE[a.key]?.[1], note: `${num(a.users)} 人` })), { format: usd })
    : '';

  const geo = [
    panel('安装地区', r.countries.installs.length ? barList(r.countries.installs.map((c) => ({ label: country(c.key), value: c.installs, note: c.registered ? `注册 ${num(c.registered)}` : '' })), { cls: 'c3' }) : ''),
    panel('使用地区', r.countries.usage.length ? barList(r.countries.usage.map((c) => ({ label: country(c.key), value: c.requests, note: `${num(c.users)} 人` })), { cls: 'c1' }) : ''),
    panel('收入地区（USD）', r.countries.revenue.length ? barList(r.countries.revenue.map((c) => ({ label: country(c.key), value: Number(c.revenue), note: `${c.orders} 笔` })), { format: (v) => minor(v, 'USD'), cls: 'c2' }) : ''),
  ].filter(Boolean);

  const langs = [
    panel('目标语言', r.targetLangs.length ? barList(r.targetLangs.map((l) => ({ label: language(l.key), value: l.requests, note: `${num(l.users)} 人` })), { cls: 'c1' }) : '', { note: '翻译成什么语言' }),
    panel('源语言', r.sourceLangs.length ? barList(r.sourceLangs.map((l) => ({ label: language(l.key), value: l.requests })), { cls: 'c4' }) : '', { note: '用户指定的原文语言' }),
    panel('扩展界面语言', r.uiLangs.length ? barList(r.uiLangs.map((l) => ({ label: language(l.key), value: l.installs })), { cls: 'c3' }) : '', { note: '安装时' }),
  ].filter(Boolean);

  const latencyBuckets = r.latency && r.latency.p50 != null ? [
    { label: '<1s', value: r.latency.b1 }, { label: '1–2s', value: r.latency.b2 }, { label: '2–4s', value: r.latency.b3 },
    { label: '4–8s', value: r.latency.b4 }, { label: '≥8s', value: r.latency.b5 },
  ] : [];
  const sizeBuckets = r.sizes ? [
    { label: '≤50', value: r.sizes.b1 }, { label: '≤200', value: r.sizes.b2 }, { label: '≤500', value: r.sizes.b3 },
    { label: '≤2000', value: r.sizes.b4 }, { label: '>2000', value: r.sizes.b5 },
  ] : [];

  const empty = !cards.length;
  return layout({
    title: '运营概览',
    admin,
    active: 'overview',
    body: html`<div class="head-row"><div><h1>运营概览</h1><p class="muted">最近 ${r.days} 天 · 与之前 ${r.days} 天对比 · 时区 ${r.timeZone}</p></div>
  <nav class="seg">${[7, 30, 90].map((n) => html`<a href="/?days=${n}"${n === r.days ? html` aria-current="page"` : ''}>${n} 天</a>`)}</nav></div>

${empty ? html`<section class="card empty-state"><h2>这段时间还没有数据</h2><p class="muted">有用户安装扩展、注册或使用托管翻译后，这里会显示趋势与分布。</p></section>` : html`
<section class="kpis">${cards}</section>

<div class="panels">
  ${panel('增长趋势', growth, { wide: true })}
  ${panel('托管请求', usage, { wide: true })}
  ${panel('收入与成本（累计）', money, { wide: true, note: '收入为 USD 税前；成本为估算' })}
  ${panel('转化漏斗', r.funnel.installs ? funnel(funnelSteps) : '', { wide: true, note: '这段时间安装的用户后来做了什么' })}
  ${panel('请求来自', audienceDonut)}
  ${panel('模型路由', providerDonut)}
  ${panel('订阅方案', planDonut)}
  ${panel('成本按用户类型', costByAudience, { note: r.costPerSubscriberMicros != null ? `每位订阅用户 ${usd(r.costPerSubscriberMicros)}` : '' })}
  ${langs}
  ${geo}
  ${!geo.length && !geoConfigured && hasUsage ? html`<section class="card panel hint"><h2>地区分布</h2><p class="muted">设置 GEO_COUNTRY_HEADER（例如 Cloudflare 的 cf-ipcountry）后按国家统计安装与使用；付费订单的国家来自 Creem。</p></section>` : ''}
  ${panel('使用时段', hasUsage ? heatmap(r.heat, { timeZone: r.timeZone }) : '', { wide: true, note: r.timeZone })}
  ${panel('响应耗时', latencyBuckets.length ? html`<dl class="stats"><div><dt>P50</dt><dd>${num(r.latency.p50)} ms</dd></div><div><dt>P90</dt><dd>${num(r.latency.p90)} ms</dd></div><div><dt>P95</dt><dd>${num(r.latency.p95)} ms</dd></div><div><dt>P99</dt><dd>${num(r.latency.p99)} ms</dd></div></dl>${histogram(latencyBuckets, { cls: 'c4' })}` : '')}
  ${panel('请求字数', hasUsage ? histogram(sizeBuckets, { cls: 'c1' }) : '', { note: '每次请求的字符数' })}
  ${panel('访客领取', r.outcomes.length ? barList(r.outcomes.map((o) => ({ label: OUTCOME[o.key] || o.key, value: o.n, note: o.credits ? `${num(o.credits)} 点` : '' })), { cls: 'c3' }) : '')}
  ${panel('异常与降级', r.errors.length ? barList(r.errors.map((e) => ({ label: ERRORS[e.key] || e.key, value: e.n })), { cls: 'c5' }) : '')}
  ${panel('其他币种收入', revenueOther.length ? html`<ul class="plain">${revenueOther.map((x) => html`<li dir="ltr">${minor(x.gross - x.refunded, x.currency)} <span class="muted">（${x.orders} 笔）</span></li>`)}</ul>` : '')}
  ${panel('用量最高的用户', r.topUsers.length ? html`<div class="table-wrap"><table>
    <thead><tr><th>用户</th><th>类型</th><th class="num">请求</th><th class="num">字数</th><th class="num">成本</th></tr></thead>
    <tbody>${r.topUsers.map((u) => html`<tr><td><a href="/users/${u.user_id}">${u.kind === 'guest' ? '访客' : u.username}</a></td><td>${KIND[u.audience] || KIND[u.kind]}</td><td class="num">${num(u.requests)}</td><td class="num">${num(u.chars)}</td><td class="num">${usd(u.cost_micros)}</td></tr>`)}</tbody>
  </table></div>` : '', { wide: true })}
</div>
`}`,
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
  <thead><tr><th>用户名</th><th>邮箱</th><th>类型</th><th class="num">点数</th><th>订阅</th><th>注册时间</th><th>托管</th></tr></thead>
  <tbody>${users.map((u) => html`<tr>
    <td><a href="/users/${u.id}">${u.username}</a></td><td dir="ltr">${u.email || '—'}</td><td>${KIND[u.kind]}</td>
    <td class="num">${num(u.balance)}</td><td>${u.sub_status || '—'}</td><td>${d(u.created_at)}</td><td>${u.hosted_frozen_at ? html`<span class="tag warn">已冻结</span>` : '正常'}</td>
  </tr>`)}</tbody>
</table></div>
${users.length ? '' : html`<p class="muted">没有匹配的用户。</p>`}`,
  });
}

const reasonField = html`<input name="reason" required maxlength="200" placeholder="原因（必填，记入审计）">`;

export function userPage({ admin, u, state, subs, ledger, events, sessions, note }) {
  return layout({
    title: u.username,
    admin,
    active: 'users',
    note,
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
    <p class="big">${num(state.credits.balance)}<span class="unit">点</span></p>
    <p>${state.subscription ? html`订阅中：${state.subscription.plan === 'yearly' ? '年付' : '月付'}（${state.subscription.status}），至 ${d(state.subscription.periodEnd)}` : '没有有效订阅'}</p>
  </section>
</div>

<section class="card">
  <h2>操作</h2>
  <div class="actions">
    <form method="post" action="/users/${u.id}/credits" class="inline">
      <input name="amount" type="number" min="1" max="100000" required placeholder="补发点数">${reasonField}
      <button class="button" type="submit">补发点数</button>
    </form>
    <form method="post" action="/users/${u.id}/${u.hosted_frozen_at ? 'unfreeze' : 'freeze'}" class="inline">
      ${reasonField}<button class="button" type="submit">${u.hosted_frozen_at ? '恢复托管服务' : '冻结托管服务'}</button>
    </form>
    <form method="post" action="/users/${u.id}/revoke-sessions" class="inline">
      ${reasonField}<button class="button" type="submit">撤销全部会话</button>
    </form>
  </div>
</section>

<section class="card">
  <h2>订阅记录</h2>
  ${subs.length ? html`<div class="table-wrap"><table><thead><tr><th>方案</th><th>状态</th><th>本期结束</th><th>Creem 订阅</th><th>更新</th></tr></thead>
  <tbody>${subs.map((s) => html`<tr><td>${s.plan || '—'}</td><td>${s.status}</td><td>${d(s.current_period_end)}</td><td dir="ltr"><code>${s.provider_subscription_id}</code></td><td>${dt(s.updated_at)}</td></tr>`)}</tbody></table></div>` : html`<p class="muted">无</p>`}
</section>

<section class="card">
  <h2>点数账本</h2>
  <div class="table-wrap"><table><thead><tr><th>时间</th><th>类型</th><th class="num">点数</th><th>原因</th></tr></thead>
  <tbody>${ledger.map((e) => html`<tr><td>${dt(e.created_at)}</td><td>${ENTRY[e.entry_type] || e.entry_type}</td><td class="num" dir="ltr">${e.amount > 0 ? `+${e.amount}` : e.amount}</td><td>${e.reason || ''}</td></tr>`)}</tbody></table></div>
</section>

<section class="card">
  <h2>最近托管请求</h2>
  <div class="table-wrap"><table><thead><tr><th>时间</th><th>类型</th><th class="num">字数</th><th class="num">点数</th><th>模型</th><th class="num">成本</th><th class="num">耗时</th><th>结果</th></tr></thead>
  <tbody>${events.map((e) => html`<tr><td>${dt(e.created_at)}</td><td>${KIND[e.audience] || '—'}</td><td class="num">${num(e.chars)}</td><td class="num">${e.cost}</td><td>${e.model || '—'}</td><td class="num">${e.cost_micros != null ? usd(e.cost_micros) : '—'}</td><td class="num">${e.latency_ms ?? '—'}</td><td>${e.status}${e.error ? html` <span class="muted">${e.error}</span>` : ''}</td></tr>`)}</tbody></table></div>
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

export function ledgerPage({ admin, entries, type }) {
  return layout({
    title: '点数账本',
    admin,
    active: 'ledger',
    body: html`<h1>点数账本</h1>
<nav class="seg">${['', ...Object.keys(ENTRY)].map((k) => html`<a href="/ledger${k ? `?type=${k}` : ''}"${k === type ? html` aria-current="page"` : ''}>${k ? ENTRY[k] : '全部'}</a>`)}</nav>
<div class="table-wrap"><table><thead><tr><th>时间</th><th>用户</th><th>类型</th><th class="num">点数</th><th>原因</th></tr></thead>
<tbody>${entries.map((e) => html`<tr><td>${dt(e.created_at)}</td><td><a href="/users/${e.user_id}">${e.username}</a></td><td>${ENTRY[e.entry_type] || e.entry_type}</td><td class="num" dir="ltr">${e.amount > 0 ? `+${e.amount}` : e.amount}</td><td>${e.reason || ''}</td></tr>`)}</tbody></table></div>`,
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
        : html`<input id="${s.key}" name="${s.key}" value="${values[s.key]}" dir="ltr" required>`}
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
