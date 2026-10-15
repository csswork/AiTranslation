/** VPS 服务入口：npm start（开发时 npm run dev）。 */
import { serve } from '@hono/node-server';
import * as undici from 'undici';
import { createApp } from './app.js';
import { createGoogleClient } from './auth/google.js';
import { googleJwks, verifyGoogleIdToken } from './auth/google-id-token.js';
import { loadLocalEnv, readConfig } from './config/index.js';
import { createPool } from './db/index.js';
import { pendingMigrations } from './db/migrate.js';
import { createMailer } from './mail/index.js';
import { createCreemClient } from './billing/creem.js';
import { createHostedTranslator } from './translation/hosted.js';

loadLocalEnv();
let config;
try {
  config = readConfig();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

// Node 自带的 fetch 不读代理环境变量。设置了 HTTPS_PROXY / HTTP_PROXY 时（例如本机经代理访问 Google），
// 出站请求（OAuth 令牌交换等）改走代理；支持 http:// 与 socks5://。VPS 上不设置即直连。
// 内置 fetch 与 undici 包的版本不同，混用会出错（UND_ERR_INVALID_ARG），所以一并换成 undici 的实现。
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
if (proxy) {
  const { fetch, Request, Response, Headers, FormData } = undici;
  Object.assign(globalThis, { fetch, Request, Response, Headers, FormData });
  const socks = /^socks5h?:\/\//i.test(proxy);
  undici.setGlobalDispatcher(socks ? new undici.Socks5ProxyAgent(proxy) : new undici.EnvHttpProxyAgent());
  console.log(`出站请求经${socks ? ' SOCKS5' : ' HTTP'} 代理 ${new URL(proxy).host}`);
}

const pool = createPool(config.databaseUrl);
const pending = await pendingMigrations(pool);
if (pending.length) {
  console.error(`有未执行的数据库迁移：${pending.join('、')}。请先运行 npm run migrate。`);
  await pool.end();
  process.exit(1);
}

const getKey = config.google ? googleJwks() : null;
const googleIdToken = config.google
  ? (token, nonce) => verifyGoogleIdToken(token, { clientId: config.google.clientId, nonce, getKey })
  : null;
const hosted = createHostedTranslator(config);
const creem = createCreemClient(config);
const app = createApp({ config, pool, mailer: createMailer(config), google: createGoogleClient(config), googleIdToken, hosted, creem });
// 启用代理时不让 @hono/node-server 替换全局 Request，否则又会与 undici 的 fetch 混用。
const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port, overrideGlobalObjects: !proxy }, (info) => {
  console.log(`用户管理界面：${config.appOrigin}（监听 ${info.address}:${info.port}）`);
  if (!config.google) console.log('未配置 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET，Google 登录不显示。');
  if (!hosted) console.log('未配置 HOSTED_DEEPSEEK_API_KEY，托管翻译不可用。');
  for (const warning of config.warnings) console.log(warning);
  if (!creem && !config.warnings.length) console.log('未配置 Creem，订阅结账不可用。');
  if (config.adminOrigin) console.log(`管理员界面：${config.adminOrigin}`);
});

const shutdown = () => {
  server.close(() => pool.end().finally(() => process.exit(0)));
  // 浏览器的 keep-alive 空闲连接会拖住 close()，主动断开；进行中的请求仍可完成。
  server.closeIdleConnections?.();
  setTimeout(() => process.exit(1), 5_000);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
