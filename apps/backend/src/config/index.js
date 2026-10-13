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
  const webOrigins = (env.WEB_ORIGINS || (production ? 'https://huaci.app' : 'http://localhost:8080'))
    .split(',').map((s) => s.trim()).filter(Boolean);
  for (const origin of webOrigins) {
    let valid = false;
    try { valid = new URL(origin).origin === origin; } catch { /* 下面报告 */ }
    if (!valid) problems.push(`WEB_ORIGINS 中的来源无效：${origin}`);
    else if (production && !origin.startsWith('https://')) problems.push(`生产环境 WEB_ORIGINS 必须使用 HTTPS：${origin}`);
  }

  const mailTransport = env.MAIL_TRANSPORT || 'console';
  if (mailTransport !== 'console') problems.push(`不支持的 MAIL_TRANSPORT：${mailTransport}`);

  if (production) {
    if (!appOrigin.startsWith('https://')) problems.push('生产环境 APP_ORIGIN 必须使用 HTTPS');
    // 正式发信服务尚未接入；控制台输出验证码只能用于本地开发。
    if (mailTransport === 'console') problems.push('生产环境不能使用 console 发信，需先接入发信服务');
    if (!env.TRIAL_CREDITS) problems.push('生产环境需明确设置 TRIAL_CREDITS');
  }

  if (problems.length) throw new Error(`配置无效：\n- ${problems.join('\n- ')}`);

  return {
    production,
    host: env.HOST || '127.0.0.1',
    port: int(env.PORT, 8787, 'PORT'),
    // 部署在反向代理之后时设为 1，限流才按 X-Forwarded-For 区分来源。
    trustProxy: env.TRUST_PROXY === '1',
    appOrigin,
    webOrigins,
    secureCookies: appOrigin.startsWith('https://'),
    databaseUrl,
    authSecret,
    google,
    mailTransport,
    // 试用点数和有效期是占位值，实测托管成本后再定；以后改由管理员界面（A4）配置。
    trialCredits: int(env.TRIAL_CREDITS, 100, 'TRIAL_CREDITS'),
    trialDays: int(env.TRIAL_DAYS, 30, 'TRIAL_DAYS'),
    sessionDays: int(env.SESSION_DAYS, 30, 'SESSION_DAYS'),
    links: {
      website: env.WEBSITE_URL || 'https://huaci.app/',
      extension: env.EXTENSION_URL || '',
      feedback: env.FEEDBACK_URL || 'https://github.com/csswork/AiTranslation/issues',
    },
  };
}
