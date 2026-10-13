/**
 * 用户管理界面的页面。服务端输出 HTML，不需要浏览器脚本；
 * hono/html 会转义所有插值，嵌套的 html`` 片段原样输出。
 */
import { html } from 'hono/html';
import { assetUrl } from './assets.js';

const NAV = [
  { href: '/', label: '账户总览', key: 'overview' },
  { href: '/plans', label: '套餐与订阅', key: 'plans' },
  { href: '/billing', label: '订单与账单', key: 'billing' },
  { href: '/usage', label: '用量与点数', key: 'usage' },
  { href: '/account', label: '邮箱与登录方式', key: 'account' },
  { href: '/sessions', label: '登录会话', key: 'sessions' },
  { href: '/help', label: '扩展与帮助', key: 'help' },
];

// 服务端不知道访问者的时区，统一以 UTC 显示。
const dateTime = (value) => (value ? `${new Date(value).toISOString().slice(0, 16).replace('T', ' ')} UTC` : '—');
const date = (value) => (value ? new Date(value).toISOString().slice(0, 10) : '—');

const noticeBlock = (notice) => (notice
  ? html`<p class="notice notice-${notice.kind}" role="${notice.kind === 'error' ? 'alert' : 'status'}">${notice.text}</p>`
  : '');

export function layout({ title, user = null, active = '', notice = null, body }) {
  return html`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} · 划词翻译账户</title>
<link rel="icon" href="${assetUrl('icon.png')}">
<link rel="stylesheet" href="${assetUrl('account.css')}">
</head>
<body class="${user ? 'signed-in' : 'signed-out'}">
<header class="top">
  <a class="brand" href="/"><img src="${assetUrl('icon.png')}" alt="" width="28" height="28"><span>划词翻译 · 账户</span></a>
  ${user ? html`<div class="who"><span class="who-name">${user.username}</span>
    <form method="post" action="/logout"><button class="link-button" type="submit">退出登录</button></form></div>` : ''}
</header>
<div class="shell">
  ${user ? html`<nav class="side" aria-label="账户导航"><ul>${NAV.map((item) => html`<li><a href="${item.href}"${item.key === active ? html` aria-current="page"` : ''}>${item.label}</a></li>`)}</ul></nav>` : ''}
  <main class="content">
    ${noticeBlock(notice)}
    ${body}
  </main>
</div>
</body>
</html>`;
}

/* ---------- U1 注册与登录 ---------- */

export function loginPage({ googleEnabled, email = '', notice = null }) {
  return layout({
    title: '登录',
    notice,
    body: html`<section class="card auth">
  <h1>登录或注册</h1>
  <p class="muted">输入邮箱获取验证码。未注册的邮箱验证后会自动创建账户并获得试用点数。</p>
  <form method="post" action="/login/email" class="stack">
    <label for="email">邮箱</label>
    <input id="email" name="email" type="email" autocomplete="email" required maxlength="254" value="${email}">
    <button class="button primary" type="submit">发送验证码</button>
  </form>
  ${googleEnabled ? html`<div class="divider"><span>或</span></div>
  <a class="button" href="/auth/google">使用 Google 登录</a>` : ''}
  <p class="fine">账户只保存邮箱和用户名，不保存姓名、头像等资料。</p>
</section>`,
  });
}

export function verifyPage({ title, email, action, resendAction, backHref, notice = null, user = null, active = '' }) {
  return layout({
    title,
    user,
    active,
    notice,
    body: html`<section class="card auth">
  <h1>${title}</h1>
  <p class="muted">验证码已发送到 <strong>${email}</strong>，10 分钟内有效。</p>
  <form method="post" action="${action}" class="stack">
    <label for="code">6 位验证码</label>
    <input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" maxlength="7" required autofocus>
    <button class="button primary" type="submit">验证</button>
  </form>
  <div class="row">
    <form method="post" action="${resendAction}"><button class="link-button" type="submit">重新发送</button></form>
    <a href="${backHref}">更换邮箱</a>
  </div>
</section>`,
  });
}

/* ---------- U2 账户总览 ---------- */

export function overviewPage({ user, credits, notice }) {
  const trialActive = credits.trialGranted && (!credits.trialExpiresAt || new Date(credits.trialExpiresAt) > new Date());
  return layout({
    title: '账户总览',
    user,
    active: 'overview',
    notice,
    body: html`<h1>账户总览</h1>
<div class="grid">
  <section class="card">
    <h2>账户</h2>
    <dl class="facts">
      <dt>用户名</dt><dd>${user.username}</dd>
      <dt>邮箱</dt><dd>${user.email}</dd>
      <dt>注册时间</dt><dd>${date(user.created_at)}</dd>
    </dl>
    <a href="/account">管理邮箱与登录方式</a>
  </section>
  <section class="card">
    <h2>点数</h2>
    <p class="big">${credits.balance}<span class="unit">点</span></p>
    <dl class="facts">
      <dt>状态</dt><dd>${trialActive ? '试用中' : credits.trialGranted ? '试用已结束' : '未获得试用'}</dd>
      ${credits.trialExpiresAt ? html`<dt>试用到期</dt><dd>${dateTime(credits.trialExpiresAt)}</dd>` : ''}
    </dl>
    <a href="/usage">查看点数记录</a>
  </section>
  <section class="card">
    <h2>套餐</h2>
    <p class="big small">暂无订阅</p>
    <p class="muted">付费套餐尚未开放。点数用尽后托管翻译会停止，扩展里的自带 Key 模式不受影响。</p>
    <a href="/plans">了解套餐</a>
  </section>
</div>`,
  });
}

/* ---------- U3 / U4：支付服务接入前只显示说明 ---------- */

export function plansPage({ user }) {
  return layout({
    title: '套餐与订阅',
    user,
    active: 'plans',
    body: html`<h1>套餐与订阅</h1>
<section class="card empty">
  <h2>付费套餐尚未开放</h2>
  <p>支付服务接入后，可以在这里查看套餐权益，开通、升级或取消自动续订。订阅是否生效以服务端核验的支付结果为准。</p>
  <p class="muted">目前可以使用注册赠送的试用点数，或在扩展里继续使用自己的 API Key。</p>
</section>`,
  });
}

export function billingPage({ user }) {
  return layout({
    title: '订单与账单',
    user,
    active: 'billing',
    body: html`<h1>订单与账单</h1>
<section class="card empty">
  <h2>暂无订单</h2>
  <p>开通付费套餐后，支付时间、金额、币种、退款状态和收据会显示在这里。</p>
</section>`,
  });
}

/* ---------- U5 用量与点数记录 ---------- */

const ENTRY_LABELS = { trial_grant: '注册试用赠送' };

export function usagePage({ user, entries }) {
  return layout({
    title: '用量与点数',
    user,
    active: 'usage',
    body: html`<h1>用量与点数</h1>
<section class="card">
  <h2>点数记录</h2>
  ${entries.length ? html`<div class="table-wrap"><table>
    <thead><tr><th>时间</th><th>类型</th><th class="num">点数</th><th>到期</th></tr></thead>
    <tbody>${entries.map((e) => html`<tr>
      <td>${dateTime(e.created_at)}</td>
      <td>${ENTRY_LABELS[e.entry_type] || e.entry_type}</td>
      <td class="num">${e.amount > 0 ? `+${e.amount}` : e.amount}</td>
      <td>${e.expires_at ? dateTime(e.expires_at) : '不过期'}</td>
    </tr>`)}</tbody>
  </table></div>` : html`<p class="muted">暂无点数记录。</p>`}
</section>
<section class="card empty">
  <h2>翻译请求</h2>
  <p class="muted">托管翻译尚未开放，暂无请求记录。开放后按文字、图片、视频分别显示请求数量、成功或失败状态与扣点，默认只保留计费元数据。</p>
</section>`,
  });
}

/* ---------- U6 邮箱、用户名与登录方式 ---------- */

export function accountPage({ user, identities, googleEnabled, notice, username = user.username, newEmail = '' }) {
  const google = identities.find((i) => i.provider === 'google');
  return layout({
    title: '邮箱与登录方式',
    user,
    active: 'account',
    notice,
    body: html`<h1>邮箱、用户名与登录方式</h1>
<section class="card">
  <h2>用户名</h2>
  <form method="post" action="/account/username" class="stack narrow">
    <label for="username">用户名</label>
    <input id="username" name="username" required minlength="3" maxlength="24" pattern="[A-Za-z0-9_\\-]{3,24}" value="${username}" autocomplete="username">
    <p class="fine">3–24 位，小写字母、数字、下划线或短横线。</p>
    <button class="button" type="submit">保存用户名</button>
  </form>
</section>
<section class="card">
  <h2>邮箱</h2>
  <p>当前邮箱：<strong>${user.email}</strong>（已验证）</p>
  <form method="post" action="/account/email" class="stack narrow">
    <label for="new-email">新邮箱</label>
    <input id="new-email" name="email" type="email" required maxlength="254" value="${newEmail}" autocomplete="email">
    <button class="button" type="submit">发送验证码到新邮箱</button>
  </form>
</section>
<section class="card">
  <h2>登录方式</h2>
  <ul class="methods">
    <li><span>邮箱验证码</span><span class="muted">始终可用</span></li>
    ${googleEnabled || google ? html`<li><span>Google</span>${google
      ? html`<span class="muted">已绑定 · ${date(google.created_at)}</span>
        <form method="post" action="/account/google/unlink"><button class="link-button" type="submit">解除绑定</button></form>`
      : html`<form method="post" action="/auth/google/link"><button class="button" type="submit">绑定 Google</button></form>`}</li>` : ''}
  </ul>
  <p class="fine">绑定新的登录方式不会重复发放试用点数。Google 只用于验证身份，不保存姓名或头像。</p>
</section>`,
  });
}

/* ---------- U7 登录会话 ---------- */

const CLIENT_LABELS = { web: '网站', extension: 'Chrome 扩展' };

export function sessionsPage({ user, sessions, currentId, notice }) {
  return layout({
    title: '登录会话',
    user,
    active: 'sessions',
    notice,
    body: html`<h1>登录会话</h1>
<section class="card">
  <p class="muted">这里列出仍然有效的网站和扩展登录。会话只记录类型和时间，不记录设备型号或位置。</p>
  <div class="table-wrap"><table>
    <thead><tr><th>类型</th><th>登录时间</th><th>最近使用</th><th>到期</th><th></th></tr></thead>
    <tbody>${sessions.map((s) => html`<tr>
      <td>${CLIENT_LABELS[s.client] || s.client}${s.id === currentId ? html` <span class="tag">当前</span>` : ''}</td>
      <td>${dateTime(s.created_at)}</td>
      <td>${dateTime(s.last_used_at)}</td>
      <td>${dateTime(s.expires_at)}</td>
      <td>${s.id === currentId ? '' : html`<form method="post" action="/sessions/${s.id}/revoke"><button class="link-button" type="submit">退出</button></form>`}</td>
    </tr>`)}</tbody>
  </table></div>
  ${sessions.length > 1 ? html`<form method="post" action="/sessions/revoke-others"><button class="button" type="submit">退出其他全部会话</button></form>` : ''}
</section>`,
  });
}

/* ---------- U8 扩展与帮助 ---------- */

export function helpPage({ user, links }) {
  return layout({
    title: '扩展与帮助',
    user,
    active: 'help',
    body: html`<h1>扩展与帮助</h1>
<section class="card">
  <h2>两种翻译模式</h2>
  <dl class="facts wide">
    <dt>托管翻译</dt><dd>登录后由我们的服务完成翻译并扣除点数，无需自己的 API Key。即将开放。</dd>
    <dt>自带 Key</dt><dd>在扩展设置里填写 OpenAI、DeepSeek 或 DeepL 的 API Key，请求直接发给你选择的服务商。Key 只保存在你的浏览器里，本网站不接收也无法读取。</dd>
  </dl>
</section>
<section class="card">
  <h2>链接</h2>
  <ul class="links">
    ${links.extension ? html`<li><a href="${links.extension}">安装 Chrome 扩展</a></li>` : ''}
    <li><a href="${links.website}">使用说明与产品介绍</a></li>
    <li><a href="${links.feedback}">问题反馈</a></li>
  </ul>
</section>`,
  });
}

export function errorPage({ status, message, user = null }) {
  return layout({
    title: status === 404 ? '页面不存在' : '出错了',
    user,
    body: html`<section class="card empty"><h1>${status === 404 ? '页面不存在' : '出错了'}</h1><p>${message}</p><a href="/">返回首页</a></section>`,
  });
}
