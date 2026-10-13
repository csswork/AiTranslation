# AI 划词翻译 · Huaci

一个仓库，三个应用：Vercel 上的 HTML 网站、VPS 上的后端服务、Chrome 扩展。

| 应用 | 目录 | 运行位置 | 当前状态 |
| --- | --- | --- | --- |
| 网站 | [apps/web](apps/web/README.md) | Vercel | 已有宣传站、隐私页、更新日志和 11 种语言页面；登录入口及状态展示待实现 |
| 后端 | [apps/backend](apps/backend/README.md) | VPS | 用户管理界面第一批已可本地运行（邮箱验证码与 Google 登录、账户、会话），尚未部署；API 与管理员界面待实现 |
| 扩展 | [apps/extension](apps/extension/README.md) | 用户的 Chrome | 已有 24 语言翻译；优先实现登录、点数与订阅入口，保留自带 Key |

## 目录

```text
apps/
  web/
    public/          HTML、CSS、JS、静态资源和生成的各语言页面
    i18n/            网站语言目录与页面构建工具
    test/            网站、语言切换与 CSP 检查
  backend/
    src/             Hono 服务：配置、数据库、认证、点数账本、发信
    ui/account/      用户管理界面（服务端渲染）
    migrations/      PostgreSQL 迁移
    test/  deploy/   服务端测试与 VPS 部署说明
  extension/
    manifest.json    Chrome 扩展声明
    src/             扩展运行代码与界面
    icons/           扩展图标
    _locales/        Chrome 原生本地化产物
    i18n/            开发期界面译文、语言注册表和模板
    scripts/         本地多语言提取、翻译与构建
    test/            扩展测试
    store-assets/    商店文案、截图和宣传素材
    package.sh       扩展专用打包工具
docs/                架构、后端界面审核稿与技术研究
test/run.sh          全项目测试入口
package.sh           扩展打包入口
vercel.json          Vercel 部署与安全响应头配置
dist/extension/      生成的扩展 ZIP（不提交）
tools/               本地拍摄与实验工具（不提交）
LICENSE              仓库统一许可证
PRIVACY.md           保留既有公开隐私政策路径
```

## 本地开发

开发工具使用 Node.js 22 或更高版本；网站预览和扩展打包需要 Python 3。扩展运行仍要求 Chrome 116 或更高版本。网站与扩展的构建和测试使用标准库，不需要安装 npm 依赖；后端有自己的依赖（`cd apps/backend && npm ci`）并需要本机 PostgreSQL，未安装依赖时 `npm test` 会跳过后端。

```sh
npm test                      # 网站与扩展全部测试
npm run test:web              # 只检查网站
npm run test:extension        # 只检查扩展
npm run dev:web               # http://localhost:8080
npm run build:web             # 生成网站各语言页面
npm run check:web             # 检查网站多语言产物
npm run i18n:extension        # 本地刷新扩展文案
npm run check:extension       # 检查扩展多语言产物
npm run package:extension     # dist/extension/ai-translation-<version>.zip
npm run test:backend          # 后端测试（需要 PostgreSQL 的 huaci_test 库）
npm run migrate:backend       # 执行后端数据库迁移
npm run dev:backend           # http://localhost:8787 用户管理界面
```

原来的 `bash test/run.sh`、`bash package.sh` 仍可从仓库根目录运行。各应用的脚本也可以进入应用目录单独运行。

Chrome 开发者模式“加载已解压的扩展”应选择 **`apps/extension`**，不再选择仓库根目录。开发版改变加载路径可能获得新的扩展 ID，需要重新配置；商店版更新继续使用同一个商店条目。

扩展界面翻译生成器依次使用 `apps/extension/.env.local`、仓库根目录 `.env.local` 或进程环境中的配置；保留现有根目录 Key 即可。运行时的用户 API Key 仍只保存在 `chrome.storage.local`。环境文件与开发期翻译工具不进入安装包。

## 部署

- **Vercel 网站**：保留仓库根目录作为 Vercel 项目根目录，`vercel.json` 构建 `apps/web`，仅发布 `apps/web/public`。GitHub 工作流在网站、Vercel 配置或相关构建入口发生变化时触发。
- **VPS 后端**：`apps/backend` 独立部署，目前用户管理界面第一批可在本地运行；接入正式发信服务前生产配置会拒绝启动。部署草案见 [deploy/README.md](apps/backend/deploy/README.md)。托管翻译、支付、扩展 API 与管理员界面待实现。
- **Chrome 扩展**：单独打包发布到 Chrome 商店。ZIP 白名单为扩展 `manifest.json`、`src/`、`icons/`、`_locales/` 和根目录 `LICENSE`。

职责、旧目录映射和后续顺序见 [架构说明](docs/architecture.md)。

后续开发约定见根目录 [AGENTS.md](AGENTS.md)。

官网：<https://huaci.app/> · 源码：<https://github.com/csswork/AiTranslation>

以 [GPL-3.0](LICENSE) 发布。
