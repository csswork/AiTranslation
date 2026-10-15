# VPS 部署说明（草案）

状态：尚未部署。生产环境必须使用 Resend 发信（`MAIL_TRANSPORT=resend`），否则配置校验会拒绝启动。

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
| `MAIL_TRANSPORT` | `resend` | 开发用 `console`（验证码打印在日志里），生产环境不允许 |
| `RESEND_API_KEY` / `MAIL_FROM` | 必填 | Resend API Key 与已验证的发件地址（如 `AI 划词翻译 <no-reply@huaci.app>`）；需在 Resend 为 huaci.app 配置 SPF / DKIM |
| `SUPPORT_EMAIL` | 默认 `support@huaci.app` | 客服邮箱：页脚、套餐页、验证码邮件的回复地址；须能收信，并与 Creem 后台一致 |
| `TRIAL_CREDITS` / `GUEST_CREDITS` | 默认 200.00 / 50.00 | 注册与访客赠送点数的默认值（不过期，最多两位小数）；管理员界面里的设置优先 |
| `REPORT_TIMEZONE` | 默认 `Asia/Shanghai` | 运营报表切分天和小时的时区 |
| `GEO_COUNTRY_HEADER` | 建议 `cf-ipcountry` | 反向代理提供的两位国家代码请求头；用于报表按国家统计，不保存 IP 或更细位置。不经 Cloudflare 时可用 nginx GeoIP2 模块设置类似请求头 |
| `DEV_TRIAL_RESET` | 不得设置 | 本地测试专用：允许扩展开发工具重置本机网络的访客领取记录与浏览器标记；生产环境设置会拒绝启动 |
| `ADMIN_REQUIRE_2FA` | 无需设置 | 生产环境始终要求管理端二步验证；只在本地开发用来打开 |
| `ADMIN_ORIGIN` | 建议 `https://admin.huaci.app` | 管理员界面地址，必须与 `APP_ORIGIN` 主机名不同；不设则不提供管理端。反向代理需把该主机名也转发到本服务 |
| `SESSION_DAYS` | 默认 30 | 会话有效天数（网页与扩展会话相同） |
| `EXTENSION_IDS` | 生产必填 | 允许登录和调用扩展接口的 Chrome 扩展 ID，逗号分隔；生产环境为空时拒绝所有扩展，开发环境为空时接受任意扩展 |
| `HOSTED_DEEPSEEK_API_KEY` | 托管翻译必填 | 托管文字翻译的模型 Key，只在服务端；不设则托管翻译返回 503 |
| `HOSTED_MODEL` / `HOSTED_BASE_URL` | 默认 `deepseek-flash` / `https://api.deepseek.com` | 托管翻译主力模型与接口地址 |
| `HOSTED_FALLBACK_API_KEY` | 建议设置 | 备用模型 Key（OpenAI 兼容，默认 Fireworks）；主力失败或超时时改用 |
| `HOSTED_FALLBACK_MODEL` / `HOSTED_FALLBACK_BASE_URL` | 默认 `accounts/fireworks/routers/deepseek-v4p1-flash-us` / `https://us.api.fireworks.ai/inference/v1` | 备用模型与接口地址 |
| `HOSTED_MAX_CHARS` | 默认 6000 | 单次最多 Unicode 字符数的默认值；管理员界面里的设置优先。500 字符 = 1 点固定换算，不再使用 `CHARS_PER_CREDIT` |
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

迁移 `007_link_extension_sessions.sql` 将扩展会话关联到授权它的网页会话，网页登出会撤销关联扩展。旧版正式扩展会话需重新登录一次，访客会话保留。本地运行 `npm run migrate:backend` 后重启后端，并在 Chrome 重新加载扩展、刷新用户端页面，以启用新增的状态同步内容脚本；生产按上面的迁移和发布顺序更新。两种环境只接受各自的用户端来源（本地 `http://localhost:8787`；生产 `https://app.huaci.app`），不会跨环境同步。

迁移 `008_exact_credit_units.sql` 将旧整数点数等值转换为 `bigint` 整数字符额度，保留当前余额和历史扣费，不追溯重新计费。发布前备份数据库，停止旧进程后迁移，再启动新版；迁移后旧代码不能继续运行。删除旧的 `CHARS_PER_CREDIT` 环境配置；迁移会删除 `chars_per_credit` 运营设置。同步发布新版扩展和官网：点数接口改为两位小数展示字符串并新增 `credits.available`，旧版扩展不能正确识别显示为 `0.00` 的剩余额度。恢复旧版须恢复备份并回滚代码，不能只回退代码。详见 [精确额度记账](../../../docs/backend/credit-accounting.md)。

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

1. 开通 `support@huaci.app` 收信（例如 Cloudflare Email Routing 转发到个人邮箱），在 Resend 验证 huaci.app 并设置 `MAIL_TRANSPORT=resend`、`RESEND_API_KEY`、`MAIL_FROM`。
2. 配置 `app.huaci.app` 与 `admin.huaci.app` 的 DNS 与 HTTPS 证书，反向代理把两个主机名都转发到本服务。
3. 数据库备份与恢复演练。
4. 隐私政策与服务条款已按托管翻译、账户、付款与统计数据更新（官网 `privacy.html`、`terms.html`）；同步更新根目录 `PRIVACY.md` 与 Chrome 商店的数据披露。
5. 设置 `EXTENSION_IDS` 为商店扩展 ID，并把带账户功能的扩展发布到 Chrome 商店（官网安装说明随之改为商店链接）。
6. 指定管理员：`npm run admin -- grant <email>`，首次登录管理端时绑定二步验证。
7. 官网启用账户入口：在 `apps/web/public/main.js` 的 `ACCOUNT_ORIGIN` 填入 `https://app.huaci.app`，并把它加入 `vercel.json` CSP 的 `connect-src`。

## Creem 审核

Creem 在审核通过前不会真正收款，所以不需要「假收费」：把正式模式（live）完整接好并上线，审核员能看到价格、走通结账即可。审核员可能用 100% 折扣码下一笔 0 元订单来验证购买流程和产品功能。

提交前确认：

1. **产品已上线**：官网可访问；`app.huaci.app` 已部署，能注册登录；扩展可安装并能用免费点数翻译。
2. **价格公开可见**：官网首页「价格」板块（`huaci.app/#pricing`）与用户端套餐页的价格一致，并与 Creem 商品价格一致（月付 $3.99、年付 $29.99）。
3. **法律页面不需登录即可访问**：`huaci.app/privacy.html` 与 `huaci.app/terms.html`（含退款政策：首次付款 7 天内全额退款）。
4. **客服邮箱**：网站页脚显示 `support@huaci.app`，能正常收信；Creem 后台 Business Details 填写同一个地址（收据上会显示）。
5. **没有虚假信息**：不放编造的评价、用户数；划线原价默认关闭，只有确实按原价卖过才能在管理员界面打开。
6. **Creem 后台**：
   - 切到 live 模式，建立月付、年付两个订阅商品，把商品 ID 填入 `CREEM_PRODUCT_MONTHLY`、`CREEM_PRODUCT_YEARLY`。
   - 创建 live API Key 填入 `CREEM_API_KEY`（不设 `CREEM_TEST_MODE`）。
   - 注册 Webhook `https://app.huaci.app/webhooks/creem`，签名密钥填入 `CREEM_WEBHOOK_SECRET`。
7. **提交审核**：Creem 后台 Balance → Payout Account → Set up Payout Account，填写姓名或主体、产品名、产品网址 `https://huaci.app`、业务与产品说明、税务居住国家。通常 1–2 个工作日出结果；要求修改时改完点 Request re-review。

审核通过前用户点「立即订阅」时 Creem 可能拒绝创建结账，用户端会提示「暂时无法打开结账页面」，不会出错或扣款。
