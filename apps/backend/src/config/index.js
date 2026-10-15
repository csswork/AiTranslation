/**
 * 服务端配置。只从进程环境读取；本地开发可放在 apps/backend/.env.local，
 * 由 Node 按文本解析（不执行其中的代码），已有的进程环境变量优先。
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function loadLocalEnv(file = path.join(APP_ROOT, '.env.local')) {
  if (fs.existsSync(file)) process.loadEnvFile(file);
}

const int = (value, fallback, name) => {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} 必须是非负整数`);
  return n;
};

export function readConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const problems = [];
  const need = (name) => {
    if (!env[name]) problems.push(`缺少 ${name}`);
    return env[name] || '';
  };

  const appOrigin = new URL(env.APP_ORIGIN || 'http://localhost:8787').origin;
  const databaseUrl = need('DATABASE_URL');

  // 邮箱验证码哈希使用的服务端密钥。开发环境未配置时每次启动随机生成，
  // 重启后未完成的验证码随之失效。
  let authSecret = env.AUTH_SECRET || '';
  if (!authSecret && !production) authSecret = randomBytes(32).toString('hex');
  if (authSecret.length < 32) problems.push('AUTH_SECRET 至少 32 个字符');

  const google = env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_SECRET
    ? { clientId: need('GOOGLE_CLIENT_ID'), clientSecret: need('GOOGLE_CLIENT_SECRET') }
    : null;

  // 允许读取登录状态、并可作为登录后返回地址的官网来源（逗号分隔，必须是完整来源）。
  const webOrigins = (env.WEB_ORIGINS || (production ? 'https://huaci.app' : 'http://localhost:8788'))
    .split(',').map((s) => s.trim()).filter(Boolean);
  for (const origin of webOrigins) {
    let valid = false;
    try { valid = new URL(origin).origin === origin; } catch { /* 下面报告 */ }
    if (!valid) problems.push(`WEB_ORIGINS 中的来源无效：${origin}`);
    else if (production && !origin.startsWith('https://')) problems.push(`生产环境 WEB_ORIGINS 必须使用 HTTPS：${origin}`);
  }

  const adminOriginEnv = env.ADMIN_ORIGIN ? new URL(env.ADMIN_ORIGIN).origin : '';
  // 与官网共用 lang / theme 偏好 Cookie 的父域（如 huaci.app）；必须同时包含用户端、官网与管理端的主机名。
  const sharedCookieDomain = (env.SHARED_COOKIE_DOMAIN || '').replace(/^\./, '').toLowerCase();
  if (sharedCookieDomain) {
    const covers = (host) => host === sharedCookieDomain || host.endsWith(`.${sharedCookieDomain}`);
    const hosts = [appOrigin, ...webOrigins, ...(adminOriginEnv ? [adminOriginEnv] : [])].map((o) => { try { return new URL(o).hostname; } catch { return ''; } });
    if (!hosts.every(covers)) problems.push(`SHARED_COOKIE_DOMAIN（${sharedCookieDomain}）必须覆盖 APP_ORIGIN、WEB_ORIGINS 与 ADMIN_ORIGIN 的主机名`);
  }

  // 允许登录的 Chrome 扩展 ID（逗号分隔）。生产环境未配置时扩展无法登录；开发环境未配置时接受任意扩展。
  const extensionIds = (env.EXTENSION_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const id of extensionIds) if (!/^[a-p]{32}$/.test(id)) problems.push(`EXTENSION_IDS 中的扩展 ID 无效：${id}`);

  // 管理员界面（管理端）的独立地址。开发环境默认 http://admin.localhost:8787（*.localhost 指向本机），
  // 与用户端同一进程、按主机名区分；生产环境未配置时不提供管理端。
  const adminOrigin = env.ADMIN_ORIGIN
    ? new URL(env.ADMIN_ORIGIN).origin
    : production ? '' : `${new URL(appOrigin).protocol}//admin.${new URL(appOrigin).host}`;
  if (adminOrigin && new URL(adminOrigin).host === new URL(appOrigin).host) problems.push('ADMIN_ORIGIN 必须与 APP_ORIGIN 使用不同的主机名');

  // 托管翻译的备用模型（OpenAI 兼容接口，默认 Fireworks 美国节点上的 DeepSeek V4.1 Flash）：主力失败或超时时改用它。
  const fallbackKey = env.HOSTED_FALLBACK_API_KEY || '';

  // Creem 收款与订阅：API Key、Webhook 密钥和两个商品 ID 都配置后才开放结账。
  // 生产环境配了一部分视为配置错误；开发环境只提示（warnings），照常启动、暂不开放结账。
  const warnings = [];
  const creemKeys = ['CREEM_API_KEY', 'CREEM_WEBHOOK_SECRET', 'CREEM_PRODUCT_MONTHLY', 'CREEM_PRODUCT_YEARLY'];
  const creemMissing = creemKeys.filter((name) => !env[name]);
  let creem = null;
  if (!creemMissing.length) {
    creem = {
      apiKey: env.CREEM_API_KEY,
      webhookSecret: env.CREEM_WEBHOOK_SECRET,
      testMode: env.CREEM_TEST_MODE === '1',
      products: { monthly: env.CREEM_PRODUCT_MONTHLY, yearly: env.CREEM_PRODUCT_YEARLY },
    };
  } else if (creemMissing.length < creemKeys.length) {
    const message = `Creem 配置不完整，缺少 ${creemMissing.join('、')}，订阅结账暂不开放`;
    if (production) problems.push(message);
    else warnings.push(message);
  }
  if (creem && production && creem.testMode) problems.push('生产环境不能启用 CREEM_TEST_MODE');

  // 运营报表按这个时区切分天和小时。
  const reportTimeZone = env.REPORT_TIMEZONE || 'Asia/Shanghai';
  try { new Intl.DateTimeFormat('en', { timeZone: reportTimeZone }); } catch { problems.push(`REPORT_TIMEZONE 无效：${reportTimeZone}`); }

  // 发信：开发环境用 console（验证码打印在日志里）；生产环境用 Resend。
  const mailTransport = env.MAIL_TRANSPORT || 'console';
  if (!['console', 'resend'].includes(mailTransport)) problems.push(`不支持的 MAIL_TRANSPORT：${mailTransport}`);
  const resend = mailTransport === 'resend' ? { apiKey: need('RESEND_API_KEY'), from: need('MAIL_FROM') } : null;
  const supportEmail = env.SUPPORT_EMAIL || 'support@huaci.app';

  if (production) {
    if (!appOrigin.startsWith('https://')) problems.push('生产环境 APP_ORIGIN 必须使用 HTTPS');
    // 正式发信服务尚未接入；控制台输出验证码只能用于本地开发。
    if (mailTransport === 'console') problems.push('生产环境不能使用 console 发信，需设置 MAIL_TRANSPORT=resend 并配置 RESEND_API_KEY 与 MAIL_FROM');
    if (adminOrigin && !adminOrigin.startsWith('https://')) problems.push('生产环境 ADMIN_ORIGIN 必须使用 HTTPS');
  }

  if (problems.length) throw new Error(`配置无效：\n- ${problems.join('\n- ')}`);

  return {
    warnings,
    production,
    host: env.HOST || '127.0.0.1',
    port: int(env.PORT, 8787, 'PORT'),
    // 部署在反向代理之后时设为 1，限流才按 X-Forwarded-For 区分来源。
    trustProxy: env.TRUST_PROXY === '1',
    appOrigin,
    webOrigins,
    sharedCookieDomain,
    secureCookies: appOrigin.startsWith('https://'),
    databaseUrl,
    authSecret,
    google,
    mailTransport,
    resend,
    adminOrigin,
    // 反向代理提供的两位国家代码请求头（如 Cloudflare 的 cf-ipcountry），用于运营报表按国家统计；不设则不记录国家。
    reportTimeZone,
    geoCountryHeader: (env.GEO_COUNTRY_HEADER || '').trim().toLowerCase(),
    // 管理端二步验证：生产环境始终开启；本地开发默认跳过，设 ADMIN_REQUIRE_2FA=1 可在本地测试完整流程。
    adminRequire2fa: production || env.ADMIN_REQUIRE_2FA === '1',
    // 以下点数与限额是默认值，管理员界面（A4、A7）里的设置优先，见 src/settings。试用点数不过期。
    trialCredits: int(env.TRIAL_CREDITS, 200, 'TRIAL_CREDITS'),
    guestCredits: int(env.GUEST_CREDITS, 50, 'GUEST_CREDITS'),
    extensionIds,
    // 托管文字翻译：模型 Key 只在服务端。未配置 HOSTED_DEEPSEEK_API_KEY 时托管翻译不可用。
    hosted: {
      apiKey: env.HOSTED_DEEPSEEK_API_KEY || '',
      model: env.HOSTED_MODEL || 'deepseek-flash',
      baseUrl: (env.HOSTED_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, ''),
      fallback: fallbackKey
        ? {
          apiKey: fallbackKey,
          model: env.HOSTED_FALLBACK_MODEL || 'accounts/fireworks/routers/deepseek-v4p1-flash-us',
          baseUrl: (env.HOSTED_FALLBACK_BASE_URL || 'https://us.api.fireworks.ai/inference/v1').replace(/\/+$/, ''),
        }
        : null,
    },
    creem,
    charsPerCredit: Math.max(1, int(env.CHARS_PER_CREDIT, 500, 'CHARS_PER_CREDIT')),
    hostedMaxChars: Math.max(1, int(env.HOSTED_MAX_CHARS, 6000, 'HOSTED_MAX_CHARS')),
    sessionDays: int(env.SESSION_DAYS, 30, 'SESSION_DAYS'),
    links: {
      website: env.WEBSITE_URL || 'https://huaci.app/',
      extension: env.EXTENSION_URL || '',
      feedback: env.FEEDBACK_URL || 'https://github.com/csswork/AiTranslation/issues',
      // 客服邮箱：显示在页脚、套餐页与验证码邮件里，需与 Creem 后台填写的一致。
      support: supportEmail,
    },
  };
}
