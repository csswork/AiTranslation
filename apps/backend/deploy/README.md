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
| `WEB_ORIGINS` | 默认 `https://huaci.app` | 可读取登录状态、可作为登录后返回地址的官网来源，逗号分隔，必须是 HTTPS |
| `SHARED_COOKIE_DOMAIN` | `huaci.app` | 与官网共用语言、配色偏好 Cookie 的父域；必须覆盖 `APP_ORIGIN` 与 `WEB_ORIGINS` 的主机名 |
| `DATABASE_URL` | 必填 | PostgreSQL 连接串 |
| `AUTH_SECRET` | 必填，≥32 字符 | 验证码 HMAC 密钥；更换后未完成的验证码失效 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | 可选，成对 | 回调地址 `<APP_ORIGIN>/auth/google/callback`；One Tap 还需把 `<APP_ORIGIN>` 加入“已获授权的 JavaScript 来源” |
| `MAIL_TRANSPORT` | 待定 | 目前只有 `console`，生产环境不允许 |
| `TRIAL_CREDITS` / `GUEST_CREDITS` | 默认 200 / 50 | 注册与访客赠送点数的默认值（不过期）；管理员界面里的设置优先 |
| `ADMIN_ORIGIN` | 建议 `https://admin.huaci.app` | 管理员界面地址，必须与 `APP_ORIGIN` 主机名不同；不设则不提供管理端。反向代理需把该主机名也转发到本服务 |
| `SESSION_DAYS` | 默认 30 | 会话有效天数（网页与扩展会话相同） |
| `EXTENSION_IDS` | 生产必填 | 允许登录和调用扩展接口的 Chrome 扩展 ID，逗号分隔；生产环境为空时拒绝所有扩展，开发环境为空时接受任意扩展 |
| `HOSTED_DEEPSEEK_API_KEY` | 托管翻译必填 | 托管文字翻译的模型 Key，只在服务端；不设则托管翻译返回 503 |
| `HOSTED_MODEL` / `HOSTED_BASE_URL` | 默认 `deepseek-flash` / `https://api.deepseek.com` | 托管翻译主力模型与接口地址 |
| `HOSTED_FALLBACK_API_KEY` | 建议设置 | 备用模型 Key（OpenAI 兼容，默认 Fireworks）；主力失败或超时时改用 |
| `HOSTED_FALLBACK_MODEL` / `HOSTED_FALLBACK_BASE_URL` | 默认 `accounts/fireworks/routers/deepseek-v4p1-flash-us` / `https://us.api.fireworks.ai/inference/v1` | 备用模型与接口地址 |
| `CHARS_PER_CREDIT` / `HOSTED_MAX_CHARS` | 默认 500 / 6000 | 每点字数、单次最多字数的默认值；管理员界面里的设置优先 |
| `CREEM_API_KEY` | 收款必填 | Creem API Key；设置后以下三项必填 |
| `CREEM_WEBHOOK_SECRET` | 收款必填 | Creem Webhook 签名密钥；Webhook 地址填 `<APP_ORIGIN>/webhooks/creem` |
| `CREEM_PRODUCT_MONTHLY` / `CREEM_PRODUCT_YEARLY` | 收款必填 | 月付、年付商品 ID；商品价格需与管理员界面的价格展示一致 |
| `CREEM_TEST_MODE` | 生产不设 | `1` 时使用 Creem 测试环境，生产环境禁止 |
| `WEBSITE_URL` / `EXTENSION_URL` / `FEEDBACK_URL` | 可选 | 官网地址（页头页脚链接）、扩展商店与反馈链接 |
| `HTTPS_PROXY` | 通常不设 | 出站请求（如 Google 令牌交换）需经代理时使用，支持 `http://` 与 `socks5://` |

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
2. 配置 `app.huaci.app` 与 `admin.huaci.app` 的 DNS 与 HTTPS 证书，反向代理把两个主机名都转发到本服务。
3. 数据库备份与恢复演练。
4. 按实际处理的数据更新隐私政策（`PRIVACY.md` 与官网隐私页）与 Chrome 商店的数据披露：账号数据；访客领取时的 IP 哈希与浏览器标记 Cookie；托管翻译把文字发给 VPS 和模型服务商（DeepSeek、Fireworks），服务端不保存原文译文，只记字数、token 与点数；Creem 处理付款。
5. 设置 `EXTENSION_IDS` 为商店扩展 ID。
6. 在 Creem 后台建立月付、年付商品（价格与管理员界面的价格展示一致）并注册 Webhook；先用测试模式走完结账、续费、取消与退款。
7. 指定管理员：`npm run admin -- grant <email>`（先在用户端注册该邮箱），首次登录管理端时绑定二步验证。
8. 官网启用账户入口：在 `apps/web/public/main.js` 的 `ACCOUNT_ORIGIN` 填入 `https://app.huaci.app`，并把它加入 `vercel.json` CSP 的 `connect-src`。
