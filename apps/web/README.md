# Vercel HTML 网站

宣传页、隐私政策、更新日志及后续注册、登录、订阅和账户页面都属于本应用。当前已有页面是原来的 `docs/` 宣传站；保持 HTML、CSS 和浏览器 JavaScript 的实现方式。

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

后续账户页面通过 HTTPS 调用 VPS 后端。支付密钥、OAuth 客户端密钥、模型服务商密钥、额度扣减和支付确认由后端处理。当前网站尚未接入这些服务；接入前需要按实际 API 地址调整 CSP 的 `connect-src`，按登录方案调整 `form-action`，并更新相应测试。
