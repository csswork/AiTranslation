# Vercel HTML 网站

宣传页、隐私政策、更新日志及后续登录入口和登录状态展示属于本应用。完整注册、账户、订阅和账单页面属于 VPS 用户管理界面（规划 `app.huaci.app`），归 `../backend` 管理；VPS 管理员界面与官网无关。当前已有页面是原来的 `docs/` 宣传站；保持 HTML、CSS 和浏览器 JavaScript 的实现方式。

`public/` 是部署目录，保留原来的 URL 与语言路径，例如 `/en/`、`/privacy.html`。`i18n/` 是网站专用的语言目录与页面生成工具，独立于扩展的 24 语言目录。当前网站启用 11 种语言。

## 开发

从仓库根目录运行：

```sh
npm run dev:web
npm run build:web
npm run test:web
```

也可以在本目录运行：

```sh
python3 -m http.server 8080 --directory public
node i18n/build.mjs
bash test/run.sh
```

中文 `public/*.html` 是页面源文；其他语言页面、`lang.js`、站点地图由构建生成。修改可见文案后检查对应译文，详见 [网站多语言说明](i18n/README.md)。

## 部署边界

Vercel 项目根目录保留为仓库根目录，使用根目录 `vercel.json`。构建命令为 `node apps/web/i18n/build.mjs`，输出目录为 `apps/web/public`；GitHub 工作流位于 `.github/workflows/deploy-site.yml`。

后续官网通过 HTTPS 调用 VPS API，读取当前用户、点数和订阅状态；登录入口跳转到用户管理界面的登录页，完成后返回官网。网页使用后端 HttpOnly Cookie 维持会话，跨域请求携带 credentials，后端配置明确的 CORS 来源与 CSRF 防护。支付密钥、OAuth 客户端密钥、模型服务商密钥、额度扣减和支付确认由后端处理。

页头的账户入口已实现：`main.js` 带 credentials 请求用户端的 `/api/web/session`，未登录显示「登录」（跳到用户端并在登录后返回当前页），已登录显示首字母圆标与用户名并链接到账户页。语言与配色偏好存在与用户端共用的 `lang`、`theme` Cookie 里（在 huaci.app 上写到父域，其他主机只写本主机；旧的 localStorage 选择会迁移一次），任一站点切换后另一站点跟随。`<head>` 的内联配色脚本改动后要同步更新 `vercel.json` 里的 sha256。用户端地址由 `main.js` 的 `ACCOUNT_ORIGIN` 决定：目前只在本地（localhost）指向 `http://localhost:8787`，生产环境留空，入口保持隐藏，避免出现打不开的链接。页头与页脚和用户端各自维护同一套结构，后端测试会对照本站首页检查链接一致。

生产环境用户端上线时，需要填入 `ACCOUNT_ORIGIN`，把该地址加入 `vercel.json` CSP 的 `connect-src`，并更新相应测试；登录在用户端完成，官网不提交登录表单，`form-action` 不需要放开。账号与收费功能先以扩展为主，官网复用同一后台用户与权益接口。
