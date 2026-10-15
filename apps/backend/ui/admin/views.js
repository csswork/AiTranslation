/**
 * 管理员界面（管理端）的页面。只有中文；服务端渲染，没有浏览器脚本。
 * 样式沿用用户端的 account.css，另加 admin.css（报表与表格）。
 */
import { html } from 'hono/html';
import { SETTING_GROUPS, SETTINGS } from '../../src/settings/index.js';
import { assetUrl } from '../account/assets.js';

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

const notice = (n) => (n ? html`<p class="notice notice-${n.kind}" role="${n.kind === 'error' ? 'alert' : 'status'}">${n.text}</p>` : '');

export function layout({ title, admin = null, active = '', note = null, body }) {
  return html`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} · 管理端</title>
<link rel="icon" href="${assetUrl('icon.png')}">
<link rel="stylesheet" href="${assetUrl('account.css')}">
<link rel="stylesheet" href="${assetUrl('admin.css')}">
</head>
<body class="admin ${admin ? 'signed-in' : 'signed-out'}">
<header class="admin-bar">
  <strong><img src="${assetUrl('icon.png')}" alt="" width="22" height="22"> AI 划词翻译 · 管理端</strong>
  ${admin ? html`<span class="muted">${admin.email}</span><form method="post" action="/logout"><button class="link-button" type="submit">退出</button></form>` : ''}
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

export const verifyPage = ({ email, note = null }) => layout({
  title: '输入验证码',
  note,
  body: html`<section class="card auth">
  <h1>输入邮箱验证码</h1>
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

const kpi = (label, value, sub = '') => html`<div class="kpi"><span class="kpi-label">${label}</span><strong>${value}</strong>${sub ? html`<span class="kpi-sub">${sub}</span>` : ''}</div>`;

export function overviewPage({ admin, r }) {
  const maxChars = Math.max(1, ...r.daily.map((row) => Number(row.chars)));
  const revenueLines = r.revenue.length
    ? r.revenue.map((x) => html`<li dir="ltr">${minor(x.gross - x.refunded, x.currency)} <span class="muted">（毛 ${minor(x.gross, x.currency)}，退 ${minor(x.refunded, x.currency)}，${x.orders} 笔）</span></li>`)
    : html`<li class="muted">暂无</li>`;
  return layout({
    title: '运营概览',
    admin,
    active: 'overview',
    body: html`<div class="head-row"><h1>运营概览</h1>
  <nav class="seg">${[7, 30, 90].map((n) => html`<a href="/?days=${n}"${n === r.days ? html` aria-current="page"` : ''}>${n} 天</a>`)}</nav></div>

<section class="kpis">
  ${kpi('扩展安装（访客）', num(r.guests.installs), `发放 ${num(r.guests.granted)} · 转注册 ${num(r.guests.converted)}（${pct(r.guests.converted, r.guests.granted)}）`)}
  ${kpi('新注册', num(r.users.new_members), `累计注册 ${num(r.totals.members)}`)}
  ${kpi('有效订阅', num(r.subs.active), `月付 ${num(r.subs.active_monthly)} · 年付 ${num(r.subs.active_yearly)}`)}
  ${kpi('新订阅 / 流失', `${num(r.subs.new_subs)} / ${num(r.subs.churned)}`, r.subs.payment_issues ? `扣款异常 ${num(r.subs.payment_issues)}` : '')}
  ${kpi('托管请求', num(r.usage.requests), `失败 ${pct(r.usage.failed, r.usage.requests)} · 走备用 ${pct(r.usage.fallback, r.usage.requests)}`)}
  ${kpi('翻译字数', num(r.usage.chars), `扣点 ${num(r.usage.credits_used)}`)}
  ${kpi('模型成本（估算）', usd(r.usage.cost_micros), `输入 ${num(r.usage.input_tokens)} · 输出 ${num(r.usage.output_tokens)} token`)}
  ${kpi('响应耗时', r.usage.avg_latency != null ? `${num(r.usage.avg_latency)} ms` : '—', r.usage.p95_latency != null ? `P95 ${num(r.usage.p95_latency)} ms` : '')}
</section>

<div class="grid">
  <section class="card">
    <h2>收入（税前）</h2>
    <ul class="plain">${revenueLines}</ul>
    <p class="fine">按订单税前金额统计，未扣 Creem 费用、未计折扣；退款按税前比例折算。</p>
  </section>
  <section class="card">
    <h2>成本按用户类型</h2>
    <table><thead><tr><th>类型</th><th class="num">用户</th><th class="num">请求</th><th class="num">字数</th><th class="num">成本（估算）</th></tr></thead>
    <tbody>${r.audiences.map((a) => html`<tr><td>${KIND[a.audience] || a.audience}</td><td class="num">${num(a.users)}</td><td class="num">${num(a.requests)}</td><td class="num">${num(a.chars)}</td><td class="num">${usd(a.cost_micros)}</td></tr>`)}</tbody></table>
    ${r.costPerSubscriberMicros != null ? html`<p class="fine">每位有效订阅用户这段时间的平均成本：<strong>${usd(r.costPerSubscriberMicros)}</strong></p>` : ''}
  </section>
  <section class="card">
    <h2>访客领取</h2>
    <dl class="facts">
      <dt>已发放</dt><dd>${num(r.guests.granted)}（共 ${num(r.guests.credits_granted)} 点）</dd>
      <dt>同网络超限</dt><dd>${num(r.guests.ip_limited)}</dd>
      <dt>当日总量已满</dt><dd>${num(r.guests.daily_cap)}</dd>
      <dt>重装接回</dt><dd>${num(r.guests.reinstall)}</dd>
      <dt>浏览器已注册</dt><dd>${num(r.guests.claimed_member)}</dd>
    </dl>
  </section>
</div>

<section class="card">
  <h2>每日明细</h2>
  <div class="table-wrap"><table>
    <thead><tr><th>日期</th><th class="num">安装</th><th class="num">注册</th><th class="num">订阅</th><th class="num">收入 USD</th><th class="num">请求</th><th>字数</th><th class="num">成本</th><th class="num">失败</th></tr></thead>
    <tbody>${r.daily.map((row) => html`<tr>
      <td>${d(row.day)}</td><td class="num">${num(row.installs)}</td><td class="num">${num(row.members)}</td><td class="num">${num(row.subs)}</td>
      <td class="num">${minor(row.revenue_usd, 'USD')}</td><td class="num">${num(row.requests)}</td>
      <td class="bar-cell"><progress max="${maxChars}" value="${Number(row.chars)}"></progress> <span>${num(row.chars)}</span></td>
      <td class="num">${usd(row.cost_micros)}</td><td class="num">${num(row.failed)}</td>
    </tr>`)}</tbody>
  </table></div>
</section>

<section class="card">
  <h2>用量最高的用户</h2>
  <div class="table-wrap"><table>
    <thead><tr><th>用户</th><th>类型</th><th class="num">请求</th><th class="num">字数</th><th class="num">成本（估算）</th></tr></thead>
    <tbody>${r.topUsers.map((u) => html`<tr><td><a href="/users/${u.user_id}">${u.username}</a></td><td>${KIND[u.audience] || u.kind}</td><td class="num">${num(u.requests)}</td><td class="num">${num(u.chars)}</td><td class="num">${usd(u.cost_micros)}</td></tr>`)}</tbody>
  </table></div>
  <p class="fine">订阅用户界面显示无限使用；如需限制个别高用量账户，可在「规则与服务配置」设置每月隐藏上限，或在用户详情里冻结托管服务。</p>
</section>`,
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
