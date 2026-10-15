/**
 * 发信：开发环境用 console（验证码打印在服务日志里），生产环境用 Resend（MAIL_TRANSPORT=resend）。
 * 邮件按用户当前的界面语言发出，回复地址是客服邮箱（SUPPORT_EMAIL）。验证码不写入日志。
 */
import { createI18n, k } from '../i18n/index.js';

const PURPOSE_LABELS = { login: '登录', change_email: '更换邮箱', admin_login: '管理端登录' };
const PURPOSE_LINES = {
  login: k('你正在登录 AI 划词翻译。'),
  change_email: k('你正在把 AI 划词翻译账户的邮箱更换为这个地址。'),
  admin_login: k('你正在登录 AI 划词翻译的管理端。'),
};

const unescape = (text) => String(text)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** 验证码邮件的标题、纯文本与 HTML（HTML 用内联样式，邮件客户端不加载外部样式）。 */
export function codeEmail({ code, purpose, locale, support }) {
  const { t, locale: active } = createI18n(locale);
  const subject = unescape(t('{code} 是你的 AI 划词翻译验证码', { code }));
  const lines = [
    t(PURPOSE_LINES[purpose] || PURPOSE_LINES.login),
    t('验证码 10 分钟内有效，只能使用一次。'),
    t('如果这不是你本人的操作，请忽略这封邮件，你的账户不会有任何变化。'),
    t('有问题请直接回复这封邮件，或联系 {email}。', { email: support }),
  ];
  const text = `${unescape(lines[0])}\n\n${code}\n\n${lines.slice(1).map(unescape).join('\n')}\n`;
  const html = `<!doctype html><html lang="${active.htmlLang}" dir="${active.dir}"><body style="margin:0;padding:24px;background:#f6f6fb;font-family:system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;color:#16171f">
<div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e2e2ee;border-radius:10px;padding:28px">
<p style="margin:0 0 16px;font-size:15px">${lines[0]}</p>
<p style="margin:0 0 16px;font-size:30px;font-weight:700;letter-spacing:6px;font-family:ui-monospace,Menlo,monospace" dir="ltr">${code}</p>
<p style="margin:0 0 8px;font-size:13px;color:#4e5267">${lines[1]}</p>
<p style="margin:0 0 8px;font-size:13px;color:#4e5267">${lines[2]}</p>
<p style="margin:0;font-size:13px;color:#4e5267">${lines[3]}</p>
</div></body></html>`;
  return { subject, text, html };
}

export function createMailer(config, { log = console.log, fetchImpl = (...args) => fetch(...args) } = {}) {
  const support = config.links.support;
  if (config.mailTransport === 'console') {
    return {
      async sendCode({ to, code, purpose }) {
        log(`[开发发信] ${PURPOSE_LABELS[purpose] || purpose}验证码 → ${to}：${code}`);
      },
    };
  }
  if (config.mailTransport === 'resend') {
    return {
      async sendCode({ to, code, purpose, locale }) {
        const { subject, text, html } = codeEmail({ code, purpose, locale, support });
        const response = await fetchImpl('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${config.resend.apiKey}` },
          body: JSON.stringify({ from: config.resend.from, to: [to], reply_to: support, subject, text, html }),
          signal: AbortSignal.timeout(15_000),
        });
        // 只报告状态码，不记录收件人、验证码或响应内容。
        if (!response.ok) throw Object.assign(new Error(`resend_${response.status}`), { code: 'mail_failed' });
      },
    };
  }
  throw new Error(`不支持的发信方式：${config.mailTransport}`);
}
