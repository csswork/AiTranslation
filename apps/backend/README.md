# VPS 后端：账号、托管翻译、订阅与管理

本应用在 VPS 上提供三部分：共用 API 和两套独立界面。

| 部分 | 建议域名 | 使用者 | 内容 | 状态 |
| --- | --- | --- | --- | --- |
| 用户管理界面（用户端） | `app.huaci.app` | 注册用户 | 注册登录、账户总览、订阅、账单、用量与会话，只操作本人数据（U1–U8） | 第一批已实现，本地可运行，尚未部署 |
| API | `api.huaci.app` | 扩展、官网、两套界面 | 认证、用户、额度、托管翻译、支付与管理接口 | 扩展接口（登录、状态、托管文字翻译）与官网登录状态接口已实现，暂由用户端主机提供；支付与管理接口未实现 |
| 管理员界面（管理端） | `admin.huaci.app` | 运营管理员 | 用户、套餐、订单、点数账本、托管服务配置、异常与审计（A1–A9） | 未实现 |

两套界面共用后台数据，但入口、登录和接口权限分别验证。功能范围见 [两套界面的审核稿](../../docs/backend/ui-scope.md)。

技术栈：Node.js 22、[Hono](https://hono.dev/)（服务端渲染 HTML，界面不需要浏览器脚本）、PostgreSQL（`pg`），Google 登录使用 [Arctic](https://arcticjs.dev/)。会话、验证码和账号模型由本应用自行实现，以满足资料最小化要求。

## 用户管理界面：第一批

| 编号 | 已实现 | 尚未实现 |
| --- | --- | --- |
| U1 注册与登录 | 邮箱验证码注册/登录（新邮箱验证后自动建号）、Google 登录、Google One Tap 自动弹出、退出 | X 登录；正式发信服务（目前验证码只打印到开发日志） |
| U2 账户总览 | 用户名、邮箱、点数余额、试用状态与到期时间 | 套餐与续费信息（等支付接入） |
| U3 套餐与订阅 | 说明页 | 全部功能（等支付服务商确定） |
| U4 订单与账单 | 说明页 | 全部功能（等支付服务商确定） |
| U5 用量与点数 | 点数账本（试用、扣点、返还）与托管翻译请求记录（只记字数、点数和结果，不存原文译文） | 图片、视频用量（等对应托管功能） |
| U6 邮箱、用户名与登录方式 | 修改用户名、验证码更换邮箱、绑定/解除 Google | X 绑定 |
| U7 登录会话 | 列出有效会话（含扩展会话）、退出指定会话、退出其他全部会话 | — |
| U8 扩展与帮助 | 两种模式说明、安装/说明/反馈链接 | 商店链接需配置 `EXTENSION_URL` |

## 扩展接口与托管翻译

扩展接口挂在 `/api/extension`，只接受 `chrome-extension://<EXTENSION_IDS>` 来源的跨域请求，凭 `Authorization: Bearer` 扩展会话令牌认证，不使用 Cookie。

- **登录**：扩展在当前窗口的新标签页打开 `/extension/authorize`（带 `redirect_uri`、S256 `code_challenge`、`state`）。用户在用户端登录并在确认页同意后，回到扩展的回调页 `chrome-extension://<扩展 ID>/src/auth/callback.html`，只带一次性授权码（2 分钟、只能用一次）；确认页的 CSP `form-action` 只放行这次请求的扩展来源。扩展用 `POST /api/extension/token` 提交授权码与 `code_verifier` 换取扩展会话令牌。令牌在库里只存哈希，会话出现在 U7，可在网页端退出。
- **状态**：`GET /api/extension/me` 返回用户名、点数余额与试用、订阅状态（目前为空）、托管是否可用和用户端链接；`POST /api/extension/logout` 撤销当前扩展会话。
- **托管文字翻译**：`POST /api/extension/translate` 接收一段或多段文字。按字符计费，`max(1, ceil(字数 / CHARS_PER_CREDIT))` 点（默认每 500 字 1 点），单次最多 `HOSTED_MAX_CHARS` 字。先在事务里按到期先后从有效的点数发放中预扣，模型调用失败则全额返还。余额不足返回 402，超长 413，过频 429，模型失败 502（已返还），未配置模型 Key 503。每次响应都带最新余额。
- **账本**：`credit_ledger` 只追加。扣点与返还行都关联到具体的点数发放（`grant_id`），余额只统计未过期发放的剩余部分，过期试用不会被扣成负数。`usage_events` 只记录类型、语言、字数、点数和状态，不保存原文或译文。

### Google One Tap

- 登录页在浏览器已登录 Google 时自动弹出“以某账号继续”（Chrome 走 FedCM），选中后组件把 Google 签名的 ID token 交给页面，隐藏表单提交到 `POST /auth/google/one-tap`。
- 服务端用 Google 公钥（JWKS，按 Cache-Control 缓存）验证 RS256 签名，并检查 `iss`、`aud`（本应用客户端 ID）、有效期，以及登录页为本次显示生成、存在短期 Cookie 里的一次性 nonce；同一凭证不能重放。只读取 `sub`、`email`、`email_verified`。账号判断与授权码流程共用（`googleSignIn`），从官网进入时同样返回官网。
- CSP 只在登录页放开 Google 组件需要的 `https://accounts.google.com/gsi/`（script、frame、connect、style，样式另含 `'unsafe-inline'` 供不支持 FedCM 的浏览器定位弹窗）；其他页面保持严格策略。
- 需要 Google OAuth 客户端的“已获授权的 JavaScript 来源”包含用户端地址（本地 `http://localhost:8787`，生产 `https://app.huaci.app`）。

### 多语言、配色与页头页脚

- 界面支持与官网相同的 11 种语言（`i18n/locales.json`），阿拉伯语为从右到左排版。语言按与官网共用的 `lang` Cookie、浏览器 `Accept-Language` 的顺序确定，页头下拉切换后记住。时间以 UTC 显示。
- 中文文案本身就是翻译键，写在 `t('…')` 或 `k('…')` 里；译文在 `i18n/<code>.json`。`npm run i18n` 提取文案，优先沿用官网已有的同一句译文，其余用 DeepSeek 补齐（Key 读 `apps/backend/.env.local` 或根目录 `.env.local` 的 `DEEPSEEK_API_KEY`）；`npm run check:i18n` 与测试检查缺失、多余、占位符和译文错乱。
- 配色与官网一致：默认跟随系统，页头按钮切换后写入 `theme` Cookie，服务端直接输出 `<html data-theme>`，不会闪烁。页面只有一个本站脚本 `account.js` 负责即时切换与语言下拉自动提交；没有脚本时两个表单照常提交。
- 语言与配色和官网同步：两边都读写同名的 `lang`、`theme` Cookie（不设 HttpOnly，只是显示偏好）。生产环境设置 `SHARED_COOKIE_DOMAIN=huaci.app`，偏好写在父域，任一站点切换后另一站点下次打开即跟随；官网选「自动」会清掉 `lang`，两边都回到按浏览器语言。会话 Cookie 不受影响，仍只属于用户端主机。本地开发时 Cookie 不区分端口，localhost 上的两个站点天然共用。
- 账户入口：未登录是实心「登录」按钮，已登录是首字母圆标 + 用户名（首字母取用户名第一个字符，不使用头像），窄屏只显示圆标；官网页头使用相同的样式。
- 页头、页脚与官网首页使用相同的结构、类名、样式和链接（链接指向官网当前语言的页面），只是最右侧多出账户入口。`test/web.test.mjs` 对照 `apps/web/public/index.html` 检查链接一致；改动任何一边的页头或页脚时同步另一边。

### 官网登录状态

- `GET /api/web/session`：官网带 credentials 读取，返回 `signedIn`、用户名、点数余额与账户地址（未登录时返回登录地址），不含邮箱或内部 ID。只读，`Cache-Control: no-store`。
- 只对 `WEB_ORIGINS` 白名单里的来源返回 `Access-Control-Allow-Origin` 与 `Allow-Credentials`。官网与用户端同属 `*.huaci.app`，属于同站跨源请求，用户端只绑定自身主机的 `SameSite=Lax` 会话 Cookie 会被附上，不需要把 Cookie 放宽到父域。
- `/login?return=<官网地址>`：登录完成后回到该地址；只接受 `WEB_ORIGINS` 里的来源，已登录时直接返回。

### 账号与数据

- `users` 只有 email、username、邮箱验证时间和创建/更新时间；用户名默认生成 `user_xxxxxxxx`，用户可改为 3–24 位小写字母、数字、`_` 或 `-`。
- Google 只申请 `openid email`，只读取 `sub`、`email`、`email_verified`；姓名、头像等不读取、不保存。Google 已验证的邮箱与已有账号一致时直接绑定到该账号；邮箱未验证时拒绝，请用户改用邮箱验证码。
- 验证码 6 位数字、10 分钟有效、最多尝试 5 次，数据库只存 HMAC；同一邮箱 60 秒内只能发一次、每小时最多 5 次，同一来源地址每小时最多 20 次（内存计数，不落库）。超过一天的验证码记录在发新码时删除。
- 会话令牌为 32 字节随机数，数据库只存 SHA-256；只记录类型（网站/扩展）和时间，不记录 IP、User-Agent、设备或位置。会话 30 天有效，使用中自动顺延；退出或过期的会话在下次登录时删除。
- 试用点数通过只追加的 `credit_ledger` 发放，每个账号一条 `trial:<user_id>`，绑定新的登录方式不会重复发放。余额由服务端按账本汇总。试用点数与有效期（默认 100 点、30 天）是占位值。

### 安全

- 会话 Cookie：HttpOnly、SameSite=Lax；HTTPS 下为 Secure 并使用 `__Host-` 前缀，只属于用户端主机。
- 所有 POST 必须来自本站（Origin 等于 `APP_ORIGIN`，或浏览器标记 `Sec-Fetch-Site: same-origin`），否则 403。
- CSP：`default-src 'none'`，脚本只允许本站（`script-src 'self'`，无内联脚本）；页面带 `noindex`、`no-store`、`X-Frame-Options: DENY`，HTTPS 下加 HSTS。静态资源地址带内容哈希，可长期缓存。
- 生产环境配置校验：`APP_ORIGIN` 必须是 HTTPS，必须设置 `AUTH_SECRET` 与 `TRIAL_CREDITS`，且不能使用 console 发信，所以**接入正式发信服务前无法在生产环境启动**。

## 本地开发

需要 Node.js 22+ 和本机 PostgreSQL（例如 Postgres.app）。

```sh
cd apps/backend
npm ci
cp .env.example .env.local        # 按需填写；AUTH_SECRET 可用 openssl rand -hex 32 生成
createdb huaci_dev                 # Postgres.app 的命令位于 /Applications/Postgres.app/Contents/Versions/latest/bin
npm run migrate
npm run dev                        # http://localhost:8787，修改 src/、ui/ 后自动重启
```

仓库根目录也可以运行 `npm run migrate:backend`、`npm run dev:backend`、`npm run test:backend`。

登录时验证码打印在服务日志里，形如 `[开发发信] 登录验证码 → you@example.com：123456`。

### Google 登录（可选）

在 Google Cloud Console 创建“Web 应用”类型的 OAuth 客户端，授权回调地址填 `http://localhost:8787/auth/google/callback`（生产环境为 `<APP_ORIGIN>/auth/google/callback`），把客户端 ID 和密钥写入 `.env.local` 的 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`。未配置时登录页和账户页不显示 Google 入口。

服务端要直接请求 Google 令牌端点。本机如需经代理访问 Google，在 `.env.local` 设置 `HTTPS_PROXY`（支持 `http://` 与 `socks5://`，如 `socks5://127.0.0.1:7898`）：Node 自带的 `fetch` 不读系统代理，否则浏览器能打开 Google、回调时却会提示“Google 登录没有完成”。

### 测试

```sh
createdb huaci_test
npm test
```

测试使用 `postgres://localhost:5432/huaci_test`（可用 `TEST_DATABASE_URL` 覆盖），每个测试文件开始时会**清空并重建**该库；为防误删，数据库名必须以 `_test` 结尾。Google 登录用替身测试，不访问 Google。

## 目录

```text
src/
  server.js         服务入口：读取配置、检查迁移、启动 HTTP 服务
  app.js            组装中间件、静态资源与各界面路由
  config/           环境变量与生产环境校验
  db/               连接池、事务、迁移执行器
  auth/             用户与登录方式、邮箱验证码、会话、Google OAuth、扩展授权码
  credits/          点数账本
  mail/             发信（目前只有开发用 console）
  http/             Cookie、安全响应头、同源校验、限流
  i18n/             界面语言协商、翻译与日期格式
  api/              官网登录状态接口、扩展接口（登录换令牌、状态、托管翻译）
  translation/      托管翻译：语言名表与 DeepSeek 调用
ui/
  account/          用户管理界面：路由、页面、请求上下文、样式、脚本与图标
i18n/               语言列表与各语言译文（中文为源）
scripts/            开发期译文工具（不随服务运行）
migrations/         SQL 迁移，按文件名顺序执行
test/               服务端测试（node:test）
deploy/             VPS 部署说明
```

后续按需新增：`src/billing/` 与 `src/webhooks/`（支付适配器与已验签的 Webhook）、`src/admin/` 与 `ui/admin/`（管理员接口与界面）。

## 后续顺序

1. ~~确定运行栈与数据库，建立服务与迁移入口~~；~~用户管理界面第一批~~。
2. 选定发信服务并接入；~~扩展登录与扩展可读的用户、点数状态 API~~；~~官网登录状态接口~~。
3. ~~点数预扣、结算与返还；托管文字翻译与限额~~；托管图片和视频。
4. 支付结账、订阅、Webhook，以及用户管理界面的订阅与账单。
5. 管理员界面（建议管理员登录、用户查询与点数账本 A1、A3、A6 随托管翻译一起提供）、成本观察、备份与上线验证。

托管模式上线前，要补充相应的数据处理和隐私说明（含账号数据），并实测各类翻译成本，再确定点数换算与价格。
