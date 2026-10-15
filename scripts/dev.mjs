/**
 * 本地开发：一条命令启动全部服务（npm run dev），日志按服务加前缀，Ctrl+C 一起停止。
 *
 *   后端      http://localhost:8787        用户端、扩展 API、支付回调（先自动执行未完成的迁移）
 *   管理端    http://admin.localhost:8787  同一后端进程，按主机名区分
 *   官网      http://localhost:8788        apps/web/public 静态预览
 *   官网生成  监听中文页面与译文目录，修改后重新生成各语言页面、lang.js 与站点地图
 *   扩展文案  监听 apps/extension 的界面文案，修改后在本地刷新译文
 *
 * 端口已被占用的服务会跳过并说明；后端缺少依赖时提示先运行 npm ci。只用 Node 标准库。
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backend = path.join(root, 'apps/backend');
// 终端里中文占两格，对齐时按显示宽度补空格。
const displayWidth = (text) => [...text].reduce((n, ch) => n + (/[\u2E80-\uFFEF]/.test(ch) ? 2 : 1), 0);
const pad = (text, width) => text + ' '.repeat(Math.max(0, width - displayWidth(text)));
const color = process.stdout.isTTY ? (code, text) => `\x1b[${code}m${text}\x1b[0m` : (_code, text) => text;

const SERVICES = [
  {
    name: '后端', code: 35, port: 8787, cmd: 'npm', args: ['--prefix', 'apps/backend', 'run', 'dev'],
    links: [['用户端', 'http://localhost:8787'], ['管理端', 'http://admin.localhost:8787'], ['扩展 API', 'http://localhost:8787/api/extension'], ['Creem 回调', 'http://localhost:8787/webhooks/creem']],
    check: () => (fs.existsSync(path.join(backend, 'node_modules')) ? null : '缺少依赖，先运行 cd apps/backend && npm ci'),
  },
  {
    name: '官网', code: 36, port: 8788, cmd: 'python3', args: ['-m', 'http.server', '8788', '--bind', '127.0.0.1', '--directory', 'apps/web/public'],
    links: [['官网预览', 'http://localhost:8788']],
  },
  {
    name: '官网生成', code: 32, watch: 'web',
    links: [['监听', 'apps/web/public/*.html、apps/web/i18n/<语言>.json → 重新生成']],
  },
  {
    name: '扩展文案', code: 33, cmd: process.execPath, args: ['apps/extension/scripts/sync-extension-i18n.mjs', '--watch'],
    links: [['加载扩展', 'chrome://extensions → 加载已解压的扩展 → apps/extension']],
  },
];

const portFree = (port) => new Promise((resolve) => {
  const server = net.createServer().once('error', () => resolve(false)).once('listening', () => server.close(() => resolve(true)));
  server.listen(port, '127.0.0.1');
});

/** 把子进程输出逐行加上服务名前缀。 */
function pipe(stream, label) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    for (const line of lines) process.stdout.write(`${label} ${line}\n`);
  });
  stream.on('end', () => { if (buffer) process.stdout.write(`${label} ${buffer}\n`); });
}

/**
 * 官网多语言产物的监听：中文源页面（public/*.html）或某语言译文（i18n/<code>.json）变化后运行一次构建。
 * 构建本身会改写 public/*.html 的语言链接与 i18n/zh-Hans.json、_index.json，构建期间和刚结束时的变化忽略，避免循环。
 * 只生成页面，不调用翻译接口：未译的段落在页面上退回中文，用 node apps/web/i18n/build.mjs --translate <语言> 补译。
 */
function watchWeb(label) {
  const web = path.join(root, 'apps/web');
  let timer = null;
  let building = false;
  let quietUntil = 0;
  const build = () => {
    building = true;
    const child = spawn(process.execPath, ['apps/web/i18n/build.mjs'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    pipe(child.stdout, label);
    pipe(child.stderr, label);
    child.on('exit', () => { building = false; quietUntil = Date.now() + 800; });
    return child;
  };
  const schedule = (file) => {
    if (building || Date.now() < quietUntil) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      process.stdout.write(`${label} ${file} 已修改，重新生成\n`);
      build();
    }, 400);
  };
  const watchers = [
    fs.watch(path.join(web, 'public'), (_event, name) => { if (/^[\w-]+\.html$/.test(String(name || ''))) schedule(`public/${name}`); }),
    fs.watch(path.join(web, 'i18n'), (_event, name) => {
      const file = String(name || '');
      if (/\.json$/.test(file) && !['zh-Hans.json', '_index.json', 'locales.json'].includes(file)) schedule(`i18n/${file}`);
    }),
  ];
  process.stdout.write(`${label} 监听官网中文页面与译文，修改后自动重新生成。\n`);
  return { exitCode: null, kill: () => watchers.forEach((w) => w.close()), on() {} };
}

const width = Math.max(...SERVICES.map((s) => displayWidth(s.name)));
const children = [];
const summary = [];
let stopping = false;

for (const service of SERVICES) {
  const label = color(service.code, pad(`[${service.name}]`, width + 2));
  const problem = service.check?.() || (service.port && !(await portFree(service.port)) ? `端口 ${service.port} 已被占用（可能已在运行），跳过` : null);
  if (problem) {
    summary.push({ service, status: color(31, problem) });
    continue;
  }
  if (service.name === '后端') {
    // 有未执行的迁移时后端会拒绝启动，开发时先自动执行（只作用于 .env.local 里的开发库）。
    const migrate = spawnSync('npm', ['--prefix', 'apps/backend', 'run', '--silent', 'migrate'], { cwd: root, encoding: 'utf8' });
    const out = `${migrate.stdout || ''}${migrate.stderr || ''}`.trim();
    if (out) for (const line of out.split('\n')) process.stdout.write(`${label} ${line}\n`);
    if (migrate.status !== 0) {
      summary.push({ service, status: color(31, '数据库迁移失败，未启动（检查 PostgreSQL 与 apps/backend/.env.local）') });
      continue;
    }
  }
  if (service.watch === 'web') {
    children.push(watchWeb(label));
    summary.push({ service, status: color(32, '已启动') });
    continue;
  }
  const child = spawn(service.cmd, service.args, { cwd: root, env: { ...process.env, FORCE_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  pipe(child.stdout, label);
  pipe(child.stderr, label);
  child.on('exit', (code, signal) => {
    if (!stopping) process.stdout.write(`${label} ${color(31, `已退出（${signal || code}）`)}\n`);
  });
  children.push(child);
  summary.push({ service, status: color(32, '已启动') });
}

console.log(`\n${color(1, '本地开发服务')}`);
for (const { service, status } of summary) {
  console.log(`  ${color(service.code, pad(service.name, width))}  ${status}`);
  for (const [name, url] of service.links) console.log(`    ${pad(name, 12)} ${url}`);
}
console.log(`\n按 Ctrl+C 停止全部服务。\n`);

function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
if (!children.length) process.exit(1);
