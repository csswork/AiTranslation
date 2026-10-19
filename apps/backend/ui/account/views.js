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
import { creditsToUnits, displayCredits } from '../../src/credits/units.js';

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

// Google 官方四色 “G” 标志（品牌规范要求原样使用，不改颜色或比例）。
const googleLogo = html`<svg class="google-logo" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`;

const globe = html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9s1.3-6.4 3.8-9z"/></svg>`;
const sun = html`<svg class="i-sun only-dark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>`;
const moon = html`<svg class="i-moon only-light" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>`;

/** 账户入口里的圆形首字母：用户名第一个字符（不使用头像）；官网 main.js 用同样的规则。 */
const initial = (username) => (username[0] || '?').toUpperCase();

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
      <a href="${site(ui, '#pricing')}">${t('价格')}</a>
      <a href="${site(ui, '#install')}" class="hide-sm">${t('安装')}</a>
      <a href="${site(ui, 'changelog.html')}" class="hide-sm">${t('更新日志')}</a>
      <a href="${GITHUB}" target="_blank" rel="noopener" data-nav-github>GitHub</a>
      <form class="lang notranslate" translate="no" method="post" action="/preferences/lang" data-lang-form>
        ${globe}
        <input type="hidden" name="next" value="${ui.path}">
        <select name="lang" aria-label="${ui.locale.switchLabel}">${ui.locales.map((l) => html`<option value="${l.code}"${l.code === ui.locale.code ? html` selected` : ''} lang="${l.htmlLang}">${l.label}</option>`)}</select>
        <button class="lang-go" type="submit" data-lang-submit>${t('切换')}</button>
      </form>
      <form class="theme-form" method="post" action="/preferences/theme" data-theme-form data-cookie-domain="${ui.cookieDomain || ''}">
        <input type="hidden" name="theme" value="${nextTheme}">
        <input type="hidden" name="next" value="${ui.path}">
        <button class="theme-toggle" type="submit" aria-label="${t('切换配色')}" title="${t('切换配色')}"
          data-to-light="${t('切换到浅色')}" data-to-dark="${t('切换到深色')}">${sun}${moon}</button>
      </form>
      ${user
        ? html`<a class="account-link is-user" href="/" title="${t('账户总览')}"><span class="account-avatar" aria-hidden="true">${initial(user.username)}</span><span class="account-name">${user.username}</span></a>`
        : html`<a class="account-link is-login" href="/login">${t('登录')}</a>`}
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
        <a href="${site(ui, 'terms.html')}">${t('服务条款')}</a>
        <a href="${site(ui, 'changelog.html')}">${t('更新日志')}</a>
        <a href="${GITHUB}/issues" target="_blank" rel="noopener">${t('反馈问题')}</a>
        <a href="mailto:${ui.links.support}">${ui.links.support}</a>
      </nav>
    </div>
    <p class="foot-note">${t('本项目为独立的开源作品，与 OpenAI、DeepSeek、DeepL 及其关联公司无任何隶属、授权或合作关系。 ChatGPT、DeepSeek、DeepL 等名称为其各自权利人的商标，此处仅用于说明本扩展可以接入的 API。')}</p>
  </div>
</footer>`;
}

const noticeBlock = (ui, notice) => (notice
  ? html`<p class="notice notice-${notice.kind}" role="${notice.kind === 'error' ? 'alert' : 'status'}">${ui.t(notice.key, notice.params)}</p>`
  : '');

export function layout(ui, { title, user = null, active = '', notice = null, body, head = '' }) {
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
${head}
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

// Google 登录组件的界面语言代码（与本站语言代码大多相同，中文需要地区）。
const GSI_LANGUAGES = { 'zh-Hans': 'zh-CN', 'zh-Hant': 'zh-TW' };

/**
 * Google One Tap：浏览器里已登录 Google 时自动弹出“以某账号继续”。
 * 组件把签名的 ID token 交给 one-tap.js，再由这个隐藏表单提交到服务端校验；nonce 由服务端为本次页面生成。
 */
const oneTapHead = (ui) => html`<script src="https://accounts.google.com/gsi/client?hl=${GSI_LANGUAGES[ui.locale.code] || ui.locale.code}" async defer></script>
<script src="${assetUrl('one-tap.js')}" defer></script>`;
const oneTapForm = (ui, oneTap) => html`<form method="post" action="/auth/google/one-tap" data-one-tap data-client-id="${oneTap.clientId}" data-nonce="${oneTap.nonce}" data-auth-form hidden><input type="hidden" name="credential"><p class="auth-progress" role="status">${ui.t('处理中')}…</p></form>`;

export function loginPage(ui, { googleEnabled, oneTap = null, email = '', notice = null }) {
  const { t } = ui;
  return layout(ui, {
    title: t('登录'),
    notice,
    head: oneTap ? oneTapHead(ui) : '',
    body: html`<section class="card auth">
  <h1>${t('登录或注册')}</h1>
  <p class="muted">${t('输入邮箱获取验证码。未注册的邮箱验证后会自动创建账户并获得试用点数。')}</p>
  <form method="post" action="/login/email" class="stack" data-auth-form>
    <label for="email">${t('邮箱')}</label>
    <input id="email" name="email" type="email" autocomplete="email" required maxlength="254" value="${email}">
    <button class="button primary" type="submit">${t('发送验证码')}</button>
  </form>
  ${googleEnabled ? html`<div class="divider"><span>${t('或')}</span></div>
  <a class="button google-button" href="/auth/google" data-auth-link>${googleLogo}<span>${t('使用 Google 登录')}</span></a>` : ''}
  <p class="fine">${t('账户只保存邮箱和用户名，不保存姓名、头像等资料。')}</p>
  ${oneTap ? oneTapForm(ui, oneTap) : ''}
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
  <form method="post" action="${action}" class="stack" data-auth-form>
    <label for="code">${t('6 位验证码')}</label>
    <input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" maxlength="7" required autofocus>
    <button class="button primary" type="submit">${t('验证')}</button>
  </form>
  <div class="row">
    <form method="post" action="${resendAction}" data-auth-form><button class="link-button" type="submit">${t('重新发送')}</button></form>
    <a href="${backHref}">${t('更换邮箱')}</a>
  </div>
</section>`,
  });
}

/* ---------- U2 账户总览 ---------- */

/** 按当前界面语言显示金额，例如 $3.99。amount 是十进制字符串。 */
const money = (ui, amount, currency) => new Intl.NumberFormat(ui.locale.htmlLang, { style: 'currency', currency }).format(Number(amount));
/** 订单金额是最小货币单位的整数。 */
const minorMoney = (ui, minor, currency) => money(ui, (minor / 100).toFixed(2), currency || 'USD');

const PLAN_LABELS = { monthly: k('月付'), yearly: k('年付') };
const SUB_STATUS_LABELS = {
  active: k('生效中'),
  trialing: k('生效中'),
  paid: k('生效中'),
  scheduled_cancel: k('已取消续订，本期结束前仍可使用'),
  past_due: k('扣款失败，正在重试'),
  unpaid: k('扣款失败'),
  paused: k('已暂停'),
  canceled: k('已取消'),
  expired: k('已到期'),
};
const subStatus = (ui, status) => (SUB_STATUS_LABELS[status] ? ui.t(SUB_STATUS_LABELS[status]) : status);

export function overviewPage(ui, { user, state, notice }) {
  const { t } = ui;
  const sub = state.subscription;
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
  ${sub
    ? html`<section class="card">
    <h2>${t('托管翻译')}</h2>
    <p class="big small" data-unlimited>${t('无限使用')}</p>
    <p class="muted">${t('订阅期间托管翻译不限次数，不消耗点数。')}</p>
    <a href="/usage">${t('查看用量')}</a>
  </section>`
    : html`<section class="card">
    <h2>${t('点数')}</h2>
    <p class="big" data-balance>${state.credits.balance}<span class="unit">${t('点')}</span></p>
    <p class="muted">${t('赠送点数不会过期。点数用完后可以订阅，无限使用。')}</p>
    <a href="/usage">${t('查看点数记录')}</a>
  </section>`}
  <section class="card">
    <h2>${t('订阅')}</h2>
    ${sub
      ? html`<p class="big small">${t(PLAN_LABELS[sub.plan] || k('订阅'))}</p>
    <dl class="facts">
      <dt>${t('状态')}</dt><dd>${subStatus(ui, sub.status)}</dd>
      ${sub.periodEnd ? html`<dt>${sub.renews ? t('下次续费') : t('有效期至')}</dt><dd>${ui.date(sub.periodEnd)}</dd>` : ''}
    </dl>
    <a href="/billing">${t('管理订阅与账单')}</a>`
      : html`<p class="big small">${t('暂无订阅')}</p>
    <p class="muted">${t('订阅后托管翻译无限使用。扩展里的自带 Key 模式始终免费可用。')}</p>
    <a href="/plans">${t('查看订阅方案')}</a>`}
  </section>
</div>`,
  });
}

/* ---------- U3 / U4 订阅与账单（Creem） ---------- */

const planCard = (ui, { plan, price, original, currency, period, note, featured, checkoutEnabled }) => {
  const { t } = ui;
  return html`<section class="card plan${featured ? ' featured' : ''}" data-plan="${plan}">
  ${featured ? html`<span class="plan-flag">${t('更划算')}</span>` : ''}
  <h2>${t(PLAN_LABELS[plan])}</h2>
  <p class="price"><span class="now" dir="ltr">${money(ui, price, currency)}</span><span class="per">${period}</span></p>
  ${(original && Number(original) > Number(price)) || note
    ? html`<p class="was">${original && Number(original) > Number(price) ? html`<s dir="ltr">${money(ui, original, currency)}</s> ` : ''}${note ? html`<span class="tag">${note}</span>` : ''}</p>`
    : ''}
  <ul class="perks">
    <li>${t('托管翻译无限使用')}</li>
    <li>${t('无需自己的 API Key')}</li>
    <li>${t('划词、整段、网页区域和字幕翻译')}</li>
    <li>${t('随时取消，本期结束前仍可使用')}</li>
    <li>${t('首次付款 7 天内可申请全额退款')}</li>
  </ul>
  ${checkoutEnabled
    ? html`<form method="post" action="/billing/checkout"><input type="hidden" name="plan" value="${plan}"><button class="button primary wide" type="submit">${t('立即订阅')}</button></form>`
    : html`<button class="button primary wide" type="button" disabled>${t('即将开放')}</button>`}
</section>`;
};

export function plansPage(ui, { user, state, pricing, checkoutEnabled, notice }) {
  const { t } = ui;
  const sub = state.subscription;
  const save = Math.round((1 - Number(pricing.yearly.price) / (Number(pricing.monthly.price) * 12)) * 100);
  return layout(ui, {
    title: t('套餐与订阅'),
    user,
    active: 'plans',
    notice,
    body: html`<h1>${t('套餐与订阅')}</h1>
${sub
  ? html`<section class="card">
  <h2>${t('你已订阅')}</h2>
  <p>${t('当前方案：{plan}，{status}。', { plan: t(PLAN_LABELS[sub.plan] || k('订阅')), status: subStatus(ui, sub.status) })}</p>
  <a href="/billing">${t('管理订阅与账单')}</a>
</section>`
  : html`<p class="lead">${t('一个方案，托管翻译无限使用。赠送点数用完后订阅即可，扩展里的自带 Key 模式始终免费。')}</p>
<div class="plans">
  ${planCard(ui, { plan: 'monthly', ...pricing.monthly, currency: pricing.currency, period: t('每月'), checkoutEnabled })}
  ${planCard(ui, { plan: 'yearly', ...pricing.yearly, currency: pricing.currency, period: t('每年'), note: save > 0 ? t('比月付省 {n}%', { n: save }) : '', featured: true, checkoutEnabled })}
</div>
<p class="fine">${t('付款由 Creem 处理并开具收据，价格可能另加所在地区的税费。本站不接触你的银行卡信息。')}</p>
<p class="fine">${t('「无限使用」指个人日常使用，按合理使用原则不限次数。订阅自动续订，可随时取消。')} <a href="${site(ui, 'terms.html')}">${t('服务条款')}</a> · <a href="mailto:${ui.links.support}">${ui.links.support}</a></p>`}`,
  });
}

const ORDER_STATUS_LABELS = { paid: k('已付款'), refunded: k('已退款'), partially_refunded: k('部分退款'), disputed: k('争议处理中') };

export function billingPage(ui, { user, subscription, orders, portalEnabled, notice }) {
  const { t } = ui;
  return layout(ui, {
    title: t('订单与账单'),
    user,
    active: 'billing',
    notice,
    body: html`<h1>${t('订单与账单')}</h1>
<section class="card">
  <h2>${t('订阅')}</h2>
  ${subscription
    ? html`<dl class="facts">
      <dt>${t('方案')}</dt><dd>${t(PLAN_LABELS[subscription.plan] || k('订阅'))}</dd>
      <dt>${t('状态')}</dt><dd>${subStatus(ui, subscription.status)}</dd>
      ${subscription.current_period_end ? html`<dt>${t('本期结束')}</dt><dd>${ui.date(subscription.current_period_end)}</dd>` : ''}
    </dl>
    ${portalEnabled && subscription.provider_customer_id
      ? html`<form method="post" action="/billing/portal"><button class="button" type="submit">${t('管理订阅、付款方式与发票')}</button></form>
    <p class="fine">${t('将打开 Creem 的订阅管理页面，可以取消续订、更换付款方式和下载发票。')}</p>`
      : ''}`
    : html`<p class="muted">${t('暂无订阅。')}</p><a href="/plans">${t('查看订阅方案')}</a>`}
</section>
<section class="card">
  <h2>${t('付款记录')}</h2>
  ${orders.length ? html`<div class="table-wrap"><table>
    <thead><tr><th>${t('时间')}</th><th>${t('方案')}</th><th class="num">${t('金额（税前）')}</th><th>${t('状态')}</th></tr></thead>
    <tbody>${orders.map((o) => html`<tr>
      <td>${ui.dateTime(o.created_at)}</td>
      <td>${o.plan ? t(PLAN_LABELS[o.plan]) : '—'}</td>
      <td class="num" dir="ltr">${minorMoney(ui, o.amount, o.currency)}</td>
      <td>${ORDER_STATUS_LABELS[o.status] ? t(ORDER_STATUS_LABELS[o.status]) : o.status}</td>
    </tr>`)}</tbody>
  </table></div>` : html`<p class="muted">${t('还没有付款记录。')}</p>`}
</section>`,
  });
}

/* ---------- U5 用量与点数记录 ---------- */

const ENTRY_LABELS = {
  trial_grant: k('注册赠送'),
  guest_grant: k('试用赠送'),
  transfer: k('试用点数转入'),
  adjust: k('客服补发'),
  usage: k('托管翻译扣点'),
  refund: k('失败返还'),
  void: k('点数作废'),
};
const KIND_LABELS = { text: k('文字'), image: k('图片识别') };
const STATUS_LABELS = { ok: k('成功'), failed: k('失败（已返还）'), pending: k('处理中') };

export function usagePage(ui, { user, entries, events = [] }) {
  const { t } = ui;
  return layout(ui, {
    title: t('用量与点数'),
    user,
    active: 'usage',
    body: html`<h1>${t('用量与点数')}</h1>
<section class="card">
  <h2>${t('点数记录')}</h2>
  <p class="fine">${t('点数按实际用量扣减，显示保留两位小数，实际余额以服务端精确记录为准。')}</p>
  ${entries.length ? html`<div class="table-wrap"><table>
    <thead><tr><th>${t('时间')}</th><th>${t('类型')}</th><th class="num">${t('点数')}</th><th>${t('到期')}</th></tr></thead>
    <tbody>${entries.map((e) => html`<tr>
      <td>${ui.dateTime(e.created_at)}</td>
      <td>${ENTRY_LABELS[e.entry_type] ? t(ENTRY_LABELS[e.entry_type]) : e.entry_type}</td>
      <td class="num" dir="ltr">${displayCredits(e.amount_units, { signed: true })}</td>
      <td>${e.expires_at ? ui.dateTime(e.expires_at) : t('不过期')}</td>
    </tr>`)}</tbody>
  </table></div>` : html`<p class="muted">${t('暂无点数记录。')}</p>`}
</section>
<section class="card">
  <h2>${t('翻译请求')}</h2>
  ${events.length ? html`<div class="table-wrap"><table>
    <thead><tr><th>${t('时间')}</th><th>${t('类型')}</th><th class="num">${t('字数')}</th><th class="num">${t('点数')}</th><th>${t('结果')}</th></tr></thead>
    <tbody>${events.map((e) => html`<tr data-status="${e.status}">
      <td>${ui.dateTime(e.created_at)}</td>
      <td>${KIND_LABELS[e.kind] ? t(KIND_LABELS[e.kind]) : e.kind}</td>
      <td class="num">${e.chars}</td>
      <td class="num" dir="ltr">${e.audience === 'subscriber' ? t('订阅') : displayCredits(e.status === 'failed' ? 0n : -BigInt(e.cost_units))}</td>
      <td>${STATUS_LABELS[e.status] ? t(STATUS_LABELS[e.status]) : e.status}</td>
    </tr>`)}</tbody>
  </table></div>` : html`<p class="muted">${t('还没有托管翻译请求。在扩展里选择「点数翻译」后，每次请求会显示在这里。')}</p>`}
  <p class="fine">${t('只记录类型、字数、扣点和结果，不保存原文或译文。')}</p>
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
      : html`<form method="post" action="/auth/google/link" data-auth-form><button class="button google-button compact" type="submit">${googleLogo}<span>${t('绑定 Google')}</span></button></form>`}</li>` : ''}
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
    <dt>${t('托管翻译')}</dt><dd>${t('由我们的服务完成翻译，无需自己的 API Key：用赠送点数，或订阅后无限使用。')}</dd>
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

/* ---------- 扩展安装后的欢迎页 ---------- */

export function welcomePage(ui, { user, outcome, claimOutcome, balance, signupCredits }) {
  const { t } = ui;
  const balanceDisplay = displayCredits(balance ?? 0n);
  signupCredits = displayCredits(creditsToUnits(signupCredits));
  let heading = t('欢迎使用 AI 划词翻译');
  let message;
  if (outcome === 'restored') {
    heading = t('欢迎回来');
    message = t('已恢复你之前的免费点数，剩余 {n} 点。', { n: balanceDisplay });
  } else if (outcome === 'already_member') {
    message = t('这个浏览器已经领取过免费点数。登录你的账户即可继续使用。');
  } else if (outcome === 'invalid') {
    message = t('选中网页上的文字，点击翻译按钮或右键「翻译」即可使用。');
  } else if (claimOutcome === 'ip_limited' || claimOutcome === 'daily_cap') {
    message = t('这次没有领到免费点数（同一网络领取次数已满或今日名额已发完）。注册即送 {n} 点。', { n: signupCredits });
  } else {
    message = t('已送你 {n} 点免费点数，不用注册，选中网页上的文字即可翻译。', { n: balanceDisplay });
  }
  return layout(ui, {
    title: heading,
    user,
    body: html`<section class="card auth welcome" data-outcome="${outcome}">
  <img class="consent-mark" src="${assetUrl('icon.png')}" alt="" width="56" height="56">
  <h1>${heading}</h1>
  <p class="lead">${message}</p>
  <ol class="steps">
    <li>${t('在任意网页选中文字')}</li>
    <li>${t('点击出现的翻译按钮，或右键选择「翻译」')}</li>
    <li>${t('点数用完后注册即送 {n} 点，订阅可无限使用', { n: signupCredits })}</li>
  </ol>
  ${user
    ? html`<a class="button" href="/">${t('查看我的账户')}</a>`
    : html`<a class="button primary" href="/login">${outcome === 'already_member' ? t('登录') : t('注册 / 登录，再送 {n} 点', { n: signupCredits })}</a>
  <p class="fine">${t('在这个浏览器登录后，扩展会自动切换到你的账户，剩余的免费点数一并转入。')}</p>`}
</section>`,
  });
}

/* ---------- 扩展登录授权 ---------- */

export function extensionConsentPage(ui, { user }) {
  const { t } = ui;
  return layout(ui, {
    title: t('允许扩展登录'),
    user,
    body: html`<section class="card auth consent">
  <img class="consent-mark" src="${assetUrl('icon.png')}" alt="" width="48" height="48">
  <h1>${t('允许 AI 划词翻译扩展登录？')}</h1>
  <p>${t('扩展将以 {username} 的身份查看点数、试用与订阅状态，并在你选择「点数翻译」时使用点数。', { username: html`<strong>${user.username}</strong>` })}</p>
  <p class="fine">${t('扩展只获得自己的登录会话，不会读取你的网站登录状态；随时可以在「登录会话」里退出。')}</p>
  <form method="post" action="/extension/authorize/confirm" class="stack" data-auth-form>
    <button class="button primary" type="submit" name="decision" value="approve">${t('允许并返回扩展')}</button>
    <button class="button" type="submit" name="decision" value="deny">${t('取消')}</button>
  </form>
</section>`,
  });
}

export function errorPage(ui, { status, user = null, message: messageKey = null }) {
  const { t } = ui;
  const title = status === 404 ? t('页面不存在') : t('出错了');
  const message = messageKey ? t(messageKey) : status === 404 ? t('找不到这个页面。') : t('服务暂时不可用，请稍后再试。');
  return layout(ui, {
    title,
    user,
    body: html`<section class="card empty"><h1>${title}</h1><p>${message}</p><a href="/">${t('返回首页')}</a></section>`,
  });
}
