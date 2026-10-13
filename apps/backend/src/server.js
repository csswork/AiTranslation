/** VPS 服务入口：npm start（开发时 npm run dev）。 */
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { createGoogleClient } from './auth/google.js';
import { loadLocalEnv, readConfig } from './config/index.js';
import { createPool } from './db/index.js';
import { pendingMigrations } from './db/migrate.js';
import { createMailer } from './mail/index.js';

loadLocalEnv();
let config;
try {
  config = readConfig();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const pool = createPool(config.databaseUrl);
const pending = await pendingMigrations(pool);
if (pending.length) {
  console.error(`有未执行的数据库迁移：${pending.join('、')}。请先运行 npm run migrate。`);
  await pool.end();
  process.exit(1);
}

const app = createApp({ config, pool, mailer: createMailer(config), google: createGoogleClient(config) });
const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`用户管理界面：${config.appOrigin}（监听 ${info.address}:${info.port}）`);
  if (!config.google) console.log('未配置 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET，Google 登录不显示。');
});

const shutdown = () => {
  server.close(() => pool.end().finally(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
