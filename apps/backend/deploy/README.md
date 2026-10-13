# VPS 部署说明（草案）

状态：尚未部署。正式发信服务接入前，生产配置校验会拒绝启动（见下文“上线前必须完成”）。

## 运行方式

- Node.js 22+ 进程监听 `127.0.0.1:8787`，由反向代理（Caddy 或 Nginx）终止 HTTPS 后转发；设置 `TRUST_PROXY=1`，限流按 `X-Forwarded-For` 区分来源。
- PostgreSQL 与服务在同一台 VPS 或内网，数据库账号只授予本应用库的权限。
- 配置全部来自进程环境（systemd `EnvironmentFile`，文件权限 600，不放进仓库），不使用 `.env.local`。

## 环境变量

| 变量 | 生产环境 | 说明 |
| --- | --- | --- |
| `NODE_ENV` | `production` | 打开生产配置校验 |
| `APP_ORIGIN` | 必填，HTTPS | 用户管理界面地址，如 `https://app.huaci.app` |
| `HOST` / `PORT` | 默认 `127.0.0.1` / `8787` | 只监听本机，由反向代理转发 |
| `TRUST_PROXY` | `1` | 反向代理之后使用 |
| `DATABASE_URL` | 必填 | PostgreSQL 连接串 |
| `AUTH_SECRET` | 必填，≥32 字符 | 验证码 HMAC 密钥；更换后未完成的验证码失效 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | 可选，成对 | 回调地址 `<APP_ORIGIN>/auth/google/callback` |
| `MAIL_TRANSPORT` | 待定 | 目前只有 `console`，生产环境不允许 |
| `TRIAL_CREDITS` / `TRIAL_DAYS` | `TRIAL_CREDITS` 必填 | 实测托管成本后确定 |
| `SESSION_DAYS` | 默认 30 | 会话有效天数 |
| `WEBSITE_URL` / `EXTENSION_URL` / `FEEDBACK_URL` | 可选 | 帮助页链接 |

## 发布步骤

```sh
cd apps/backend
npm ci --omit=dev
NODE_ENV=production npm run migrate   # 服务启动时若有未执行的迁移会拒绝启动
systemctl restart huaci-backend
curl -fsS http://127.0.0.1:8787/healthz
```

systemd 单元示例：

```ini
[Service]
WorkingDirectory=/srv/huaci/apps/backend
EnvironmentFile=/etc/huaci/backend.env
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
User=huaci
NoNewPrivileges=true
```

## 上线前必须完成

1. 选定并接入发信服务，替换 `console` 发信。
2. 配置 `app.huaci.app` 的 DNS 与 HTTPS 证书。
3. 数据库备份与恢复演练。
4. 按实际处理的账号数据更新隐私政策（`PRIVACY.md` 与官网隐私页）。
5. 确定试用点数与有效期。
