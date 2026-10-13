/**
 * 用户管理界面的页面。服务端输出 HTML；hono/html 会转义所有插值，嵌套的 html`` 片段原样输出。
 * 每个页面接收 ui（当前语言的 t/date/dateTime、配色、当前路径、链接配置）。
 *
 * 页头与页脚和官网（apps/web/public/index.html）使用相同的结构、类名和链接，
 * 只多出最右侧的账户入口；test/chrome.test.mjs 会对照官网检查链接是否一致。
 */
import { html } from 'hono/html';
import { k } from '../../src/i18n/index.js';
import { assetUrl } from './assets.js';

const GITHUB = 'https://github.com/csswork/AiTranslation';

const NAV = [
  { href: '/', label: k('账户总览'), key: 'overview' },
  { href: '/plans', label: k('套餐与订阅'), key: 'plans' },
  { href: '/billing', label: k('订单与账单'), key: 'billing' },
  { href: '/usage', label: k('用量与点数'), key: 'usage' },
  { href: '/account', label: k('邮箱与登录方式'), key: 'account' },
  { href: '/sessions', label: k('登录会话'), key: 'sessions' },
  { href: '/help', label: k('扩展与帮助'), key: 'help' },
];

/** 官网当前语言下的地址，例如 https://huaci.app/en/#features。 */
const site = (ui, page = '') => `${ui.links.website.replace(/\/?$/, '/')}${ui.locale.path ? `${ui.locale.path}/` : ''}${page}`;

const globe = html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9s1.3-6.4 3.8-9z"/></svg>`;
const sun = html`<svg class="i-sun only-dark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>`;
const moon = html`<svg class="i-moon only-light" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>`;

function header(ui, user) {
  const { t } = ui;
  // 没有脚本时，配色按钮提交到服务端：已手动选择则切到另一套，否则切到深色。
  const nextTheme = ui.theme === 'dark' ? 'light' : 'dark';
  return html`<header class="nav">
  <div class="nav-in">
    <a class="brand" href="${site(ui)}"><img src="${assetUrl('icon.png')}" alt="" width="26" height="26"><span>${t('AI 划词翻译')}</span></a>
    <nav class="nav-links">
      <a href="${site(ui, '#features')}">${t('功能')}</a>
      <a href="${site(ui, '#privacy')}">${t('隐私')}</a>
      <a href="${site(ui, '#install')}" class="hide-sm">${t('安装')}</a>
      <a href="${site(ui, 'changelog.html')}" class="hide-sm">${t('更新日志')}</a>
      <a href="${GITHUB}" target="_blank" rel="noopener" data-nav-github>GitHub</a>
      <form class="lang notranslate" translate="no" method="post" action="/preferences/lang" data-lang-form>
        ${globe}
        <input type="hidden" name="next" value="${ui.path}">
        <select name="lang" aria-label="${ui.locale.switchLabel}">${ui.locales.map((l) => html`<option value="${l.code}"${l.code === ui.locale.code ? html` selected` : ''} lang="${l.htmlLang}">${l.label}</option>`)}</select>
        <button class="lang-go" type="submit" data-lang-submit>${t('切换')}</button>
      </form>
      <form class="theme-form" method="post" action="/preferences/theme" data-theme-form>
        <input type="hidden" name="theme" value="${nextTheme}">
        <input type="hidden" name="next" value="${ui.path}">
        <button class="theme-toggle" type="submit" aria-label="${t('切换配色')}" title="${t('切换配色')}"
          data-to-light="${t('切换到浅色')}" data-to-dark="${t('切换到深色')}">${sun}${moon}</button>
      </form>
      ${user
        ? html`<a class="account-link" href="/" title="${t('账户总览')}">${user.username}</a>`
        : html`<a class="account-link" href="/login">${t('登录')}</a>`}
    </nav>
  </div>
</header>`;
}

function footer(ui) {
  const { t } = ui;
  return html`<footer class="foot">
  <div class="wrap">
    <div class="foot-in">
      <p>${t('© 2026 Haibo · 以 GPL-3.0 发布')}</p>
      <nav class="foot-links">
        <a href="${GITHUB}" target="_blank" rel="noopener">GitHub</a>
        <a href="${site(ui, 'privacy.html')}">${t('隐私政策')}</a>
        <a href="${site(ui, 'changelog.html')}">${t('更新日志')}</a>
        <a href="${GITHUB}/issues" target="_blank" rel="noopener">${t('反馈问题')}</a>
      </nav>
    </div>
    <p class="foot-note">${t('本项目为独立的开源作品，与 OpenAI、DeepSeek、DeepL 及其关联公司无任何隶属、授权或合作关系。 ChatGPT、DeepSeek、DeepL 等名称为其各自权利人的商标，此处仅用于说明本扩展可以接入的 API。')}</p>
  </div>
</footer>`;
}

const noticeBlock = (ui, notice) => (notice
  ? html`<p class="notice notice-${notice.kind}" role="${notice.kind === 'error' ? 'alert' : 'status'}">${ui.t(notice.key, notice.params)}</p>`
  : '');

export function layout(ui, { title, user = null, active = '', notice = null, body }) {
  const { t } = ui;
  return html`<!doctype html>
<html lang="${ui.locale.htmlLang}" dir="${ui.locale.dir}"${ui.theme ? html` data-theme="${ui.theme}"` : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} · ${t('AI 划词翻译')}</title>
<link rel="icon" href="${assetUrl('icon.png')}">
<link rel="stylesheet" href="${assetUrl('account.css')}">
<script src="${assetUrl('account.js')}" defer></script>
</head>
<body class="${user ? 'signed-in' : 'signed-out'}">
${header(ui, user)}
<div class="shell">
  ${user ? html`<nav class="side" aria-label="${t('账户导航')}"><ul>${NAV.map((item) => html`<li><a href="${item.href}"${item.key === active ? html` aria-current="page"` : ''}>${t(item.label)}</a></li>`)}</ul>
    <form method="post" action="/logout"><button class="link-button" type="submit">${t('退出登录')}</button></form></nav>` : ''}
  <main class="content">
    ${noticeBlock(ui, notice)}
    ${body}
  </main>
</div>
${footer(ui)}
</body>
</html>`;
}

/* ---------- U1 注册与登录 ---------- */

export function loginPage(ui, { googleEnabled, email = '', notice = null }) {
  const { t } = ui;
  return layout(ui, {
    title: t('登录'),
    notice,
    body: html`<section class="card auth">
  <h1>${t('登录或注册')}</h1>
  <p class="muted">${t('输入邮箱获取验证码。未注册的邮箱验证后会自动创建账户并获得试用点数。')}</p>
  <form method="post" action="/login/email" class="stack">
    <label for="email">${t('邮箱')}</label>
    <input id="email" name="email" type="email" autocomplete="email" required maxlength="254" value="${email}">
    <button class="button primary" type="submit">${t('发送验证码')}</button>
  </form>
  ${googleEnabled ? html`<div class="divider"><span>${t('或')}</span></div>
  <a class="button" href="/auth/google">${t('使用 Google 登录')}</a>` : ''}
  <p class="fine">${t('账户只保存邮箱和用户名，不保存姓名、头像等资料。')}</p>
</section>`,
  });
}

export function verifyPage(ui, { title, email, action, resendAction, backHref, notice = null, user = null, active = '' }) {
  const { t } = ui;
  return layout(ui, {
    title,
    user,
    active,
    notice,
    body: html`<section class="card auth">
  <h1>${title}</h1>
  <p class="muted">${t('验证码已发送到 {email}，10 分钟内有效。', { email: html`<strong>${email}</strong>` })}</p>
  <form method="post" action="${action}" class="stack">
    <label for="code">${t('6 位验证码')}</label>
    <input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" maxlength="7" required autofocus>
    <button class="button primary" type="submit">${t('验证')}</button>
  </form>
  <div class="row">
    <form method="post" action="${resendAction}"><button class="link-button" type="submit">${t('重新发送')}</button></form>
    <a href="${backHref}">${t('更换邮箱')}</a>
  </div>
</section>`,
  });
}

/* ---------- U2 账户总览 ---------- */

export function overviewPage(ui, { user, credits, notice }) {
  const { t } = ui;
  const trialActive = credits.trialGranted && (!credits.trialExpiresAt || new Date(credits.trialExpiresAt) > new Date());
  const status = trialActive ? t('试用中') : credits.trialGranted ? t('试用已结束') : t('未获得试用');
  return layout(ui, {
    title: t('账户总览'),
    user,
    active: 'overview',
    notice,
    body: html`<h1>${t('账户总览')}</h1>
<div class="grid">
  <section class="card">
    <h2>${t('账户')}</h2>
    <dl class="facts">
      <dt>${t('用户名')}</dt><dd>${user.username}</dd>
      <dt>${t('邮箱')}</dt><dd>${user.email}</dd>
      <dt>${t('注册时间')}</dt><dd>${ui.date(user.created_at)}</dd>
    </dl>
    <a href="/account">${t('管理邮箱与登录方式')}</a>
  </section>
  <section class="card">
    <h2>${t('点数')}</h2>
    <p class="big" data-balance>${credits.balance}<span class="unit">${t('点')}</span></p>
    <dl class="facts">
      <dt>${t('状态')}</dt><dd>${status}</dd>
      ${credits.trialExpiresAt ? html`<dt>${t('试用到期')}</dt><dd>${ui.dateTime(credits.trialExpiresAt)}</dd>` : ''}
    </dl>
    <a href="/usage">${t('查看点数记录')}</a>
  </section>
  <section class="card">
    <h2>${t('套餐')}</h2>
    <p class="big small">${t('暂无订阅')}</p>
    <p class="muted">${t('付费套餐尚未开放。点数用尽后托管翻译会停止，扩展里的自带 Key 模式不受影响。')}</p>
    <a href="/plans">${t('了解套餐')}</a>
  </section>
</div>`,
  });
}

/* ---------- U3 / U4：支付服务接入前只显示说明 ---------- */

export function plansPage(ui, { user }) {
  const { t } = ui;
  return layout(ui, {
    title: t('套餐与订阅'),
    user,
    active: 'plans',
    body: html`<h1>${t('套餐与订阅')}</h1>
<section class="card empty">
  <h2>${t('付费套餐尚未开放')}</h2>
  <p>${t('支付服务接入后，可以在这里查看套餐权益，开通、升级或取消自动续订。订阅是否生效以服务端核验的支付结果为准。')}</p>
  <p class="muted">${t('目前可以使用注册赠送的试用点数，或在扩展里继续使用自己的 API Key。')}</p>
</section>`,
  });
}

export function billingPage(ui, { user }) {
  const { t } = ui;
  return layout(ui, {
    title: t('订单与账单'),
    user,
    active: 'billing',
    body: html`<h1>${t('订单与账单')}</h1>
<section class="card empty">
  <h2>${t('暂无订单')}</h2>
  <p>${t('开通付费套餐后，支付时间、金额、币种、退款状态和收据会显示在这里。')}</p>
</section>`,
  });
}

/* ---------- U5 用量与点数记录 ---------- */

const ENTRY_LABELS = { trial_grant: k('注册试用赠送') };

export function usagePage(ui, { user, entries }) {
  const { t } = ui;
  return layout(ui, {
    title: t('用量与点数'),
    user,
    active: 'usage',
    body: html`<h1>${t('用量与点数')}</h1>
<section class="card">
  <h2>${t('点数记录')}</h2>
  ${entries.length ? html`<div class="table-wrap"><table>
    <thead><tr><th>${t('时间')}</th><th>${t('类型')}</th><th class="num">${t('点数')}</th><th>${t('到期')}</th></tr></thead>
    <tbody>${entries.map((e) => html`<tr>
      <td>${ui.dateTime(e.created_at)}</td>
      <td>${ENTRY_LABELS[e.entry_type] ? t(ENTRY_LABELS[e.entry_type]) : e.entry_type}</td>
      <td class="num" dir="ltr">${e.amount > 0 ? `+${e.amount}` : e.amount}</td>
      <td>${e.expires_at ? ui.dateTime(e.expires_at) : t('不过期')}</td>
    </tr>`)}</tbody>
  </table></div>` : html`<p class="muted">${t('暂无点数记录。')}</p>`}
</section>
<section class="card empty">
  <h2>${t('翻译请求')}</h2>
  <p class="muted">${t('托管翻译尚未开放，暂无请求记录。开放后按文字、图片、视频分别显示请求数量、成功或失败状态与扣点，默认只保留计费元数据。')}</p>
</section>`,
  });
}

/* ---------- U6 邮箱、用户名与登录方式 ---------- */

export function accountPage(ui, { user, identities, googleEnabled, notice, username = user.username, newEmail = '' }) {
  const { t } = ui;
  const google = identities.find((i) => i.provider === 'google');
  return layout(ui, {
    title: t('邮箱与登录方式'),
    user,
    active: 'account',
    notice,
    body: html`<h1>${t('邮箱、用户名与登录方式')}</h1>
<section class="card">
  <h2>${t('用户名')}</h2>
  <form method="post" action="/account/username" class="stack narrow">
    <label for="username">${t('新用户名')}</label>
    <input id="username" name="username" required minlength="3" maxlength="24" pattern="[A-Za-z0-9_\\-]{3,24}" value="${username}" autocomplete="username" dir="ltr">
    <p class="fine">${t('3–24 位，小写字母、数字、下划线或短横线。')}</p>
    <button class="button" type="submit">${t('保存用户名')}</button>
  </form>
</section>
<section class="card">
  <h2>${t('邮箱')}</h2>
  <p>${t('当前邮箱：{email}（已验证）', { email: html`<strong>${user.email}</strong>` })}</p>
  <form method="post" action="/account/email" class="stack narrow">
    <label for="new-email">${t('新邮箱')}</label>
    <input id="new-email" name="email" type="email" required maxlength="254" value="${newEmail}" autocomplete="email" dir="ltr">
    <button class="button" type="submit">${t('发送验证码到新邮箱')}</button>
  </form>
</section>
<section class="card">
  <h2>${t('登录方式')}</h2>
  <ul class="methods">
    <li><span>${t('邮箱验证码')}</span><span class="muted">${t('始终可用')}</span></li>
    ${googleEnabled || google ? html`<li><span>Google</span>${google
      ? html`<span class="muted">${t('已绑定 · {date}', { date: ui.date(google.created_at) })}</span>
        <form method="post" action="/account/google/unlink"><button class="link-button" type="submit">${t('解除绑定')}</button></form>`
      : html`<form method="post" action="/auth/google/link"><button class="button" type="submit">${t('绑定 Google')}</button></form>`}</li>` : ''}
  </ul>
  <p class="fine">${t('绑定新的登录方式不会重复发放试用点数。Google 只用于验证身份，不保存姓名或头像。')}</p>
</section>`,
  });
}

/* ---------- U7 登录会话 ---------- */

const CLIENT_LABELS = { web: k('网站'), extension: k('Chrome 扩展') };

export function sessionsPage(ui, { user, sessions, currentId, notice }) {
  const { t } = ui;
  return layout(ui, {
    title: t('登录会话'),
    user,
    active: 'sessions',
    notice,
    body: html`<h1>${t('登录会话')}</h1>
<section class="card">
  <p class="muted">${t('这里列出仍然有效的网站和扩展登录。会话只记录类型和时间，不记录设备型号或位置。')}</p>
  <div class="table-wrap"><table>
    <thead><tr><th>${t('类型')}</th><th>${t('登录时间')}</th><th>${t('最近使用')}</th><th>${t('到期')}</th><th></th></tr></thead>
    <tbody>${sessions.map((s) => html`<tr data-client="${s.client}">
      <td>${CLIENT_LABELS[s.client] ? t(CLIENT_LABELS[s.client]) : s.client}${s.id === currentId ? html` <span class="tag">${t('当前')}</span>` : ''}</td>
      <td>${ui.dateTime(s.created_at)}</td>
      <td>${ui.dateTime(s.last_used_at)}</td>
      <td>${ui.dateTime(s.expires_at)}</td>
      <td>${s.id === currentId ? '' : html`<form method="post" action="/sessions/${s.id}/revoke"><button class="link-button" type="submit">${t('退出')}</button></form>`}</td>
    </tr>`)}</tbody>
  </table></div>
  ${sessions.length > 1 ? html`<form method="post" action="/sessions/revoke-others"><button class="button" type="submit">${t('退出其他全部会话')}</button></form>` : ''}
</section>`,
  });
}

/* ---------- U8 扩展与帮助 ---------- */

export function helpPage(ui, { user }) {
  const { t } = ui;
  return layout(ui, {
    title: t('扩展与帮助'),
    user,
    active: 'help',
    body: html`<h1>${t('扩展与帮助')}</h1>
<section class="card">
  <h2>${t('两种翻译模式')}</h2>
  <dl class="facts wide">
    <dt>${t('托管翻译')}</dt><dd>${t('登录后由我们的服务完成翻译并扣除点数，无需自己的 API Key。即将开放。')}</dd>
    <dt>${t('自带 Key')}</dt><dd>${t('在扩展设置里填写 OpenAI、DeepSeek 或 DeepL 的 API Key，请求直接发给你选择的服务商。Key 只保存在你的浏览器里，本网站不接收也无法读取。')}</dd>
  </dl>
</section>
<section class="card">
  <h2>${t('链接')}</h2>
  <ul class="links">
    ${ui.links.extension ? html`<li><a href="${ui.links.extension}">${t('安装 Chrome 扩展')}</a></li>` : ''}
    <li><a href="${site(ui)}">${t('使用说明与产品介绍')}</a></li>
    <li><a href="${ui.links.feedback}">${t('问题反馈')}</a></li>
  </ul>
</section>`,
  });
}

export function errorPage(ui, { status, user = null }) {
  const { t } = ui;
  const title = status === 404 ? t('页面不存在') : t('出错了');
  const message = status === 404 ? t('找不到这个页面。') : t('服务暂时不可用，请稍后再试。');
  return layout(ui, {
    title,
    user,
    body: html`<section class="card empty"><h1>${title}</h1><p>${message}</p><a href="/">${t('返回首页')}</a></section>`,
  });
}
