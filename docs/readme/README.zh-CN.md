# 划词 · Huaci

[English](../../README.md) · **简体中文** · [日本語](README.ja.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Español](README.es.md) · [العربية](README.ar.md)

划词 – AI 翻译与双语阅读（Huaci – AI Translator & Bilingual Reader）。原名「AI 划词翻译」，2.2.0 起改为现名，扩展 ID 与商店条目不变。

在浏览器里读外语文章、翻译图片和 PDF：原文与译文逐段对齐，点译文里的词就能换说法，文章连同译文可以保存在本机。也支持划词翻译、网页区域翻译和独立翻译面板；可自带 API Key，或使用免 Key 的点数翻译。

[官网](https://huaci.app/) · [Chrome 商店](https://chromewebstore.google.com/detail/ai-translator/hogimafgjmlpdlnepojgigjkhaccbcbj) · [Edge 商店](https://microsoftedge.microsoft.com/addons/detail/mojcgjimlkkbohomcijkmoefpeekmohe) · [扩展使用说明](../../apps/extension/README.md)

## 功能预览

以下为当前 **2.2.0 开发版**加载到 Chrome 后的实际截图与操作录屏，识别和翻译均调用真实模型。双语阅读、换说法和图片形状翻译等新功能正在准备发布，商店发布状态见[扩展说明](../../apps/extension/README.md#account-and-credits-hosted-mode)。

**图片识别与翻译**：识别图中文字、按文字形状覆盖译文，切换原图对照，点击单段修改，也能手动框选范围。

![图片识别实机演示：识别、翻译、对照原图、编辑译文与框选区域](../screenshots/image-recognition.gif)

**双语阅读**：从网页识别正文、移除广告，逐段对照翻译；点词换说法，切换阅读布局，并将文章和译文保存在本机。

![双语阅读实机演示：正文识别、对照翻译、换说法、切换布局与保存文章](../screenshots/bilingual-reader.gif)

| 双语对照阅读 | 点词换说法 |
| --- | --- |
| [![双语对照阅读](../screenshots/01-bilingual-reader.png)](../screenshots/01-bilingual-reader.png) | [![点词换说法](../screenshots/02-word-alternatives.png)](../screenshots/02-word-alternatives.png) |
| **图片翻译** | **深色阅读与本机书库** |
| [![图片翻译](../screenshots/04-image-translation.png)](../screenshots/04-image-translation.png) | [![深色阅读与本机书库](../screenshots/03-reader-library.png)](../screenshots/03-reader-library.png) |
| **划词翻译** | **网页区域翻译** |
| [![划词翻译](../screenshots/06-selection-translation.png)](../screenshots/06-selection-translation.png) | [![网页区域翻译](../screenshots/09-region-translation.png)](../screenshots/09-region-translation.png) |
| **整份 PDF 对照翻译** | **翻译面板** |
| [![整份 PDF 对照翻译](../screenshots/08-pdf-translation.png)](../screenshots/08-pdf-translation.png) | [![翻译面板](../screenshots/07-translation-panel.png)](../screenshots/07-translation-panel.png) |

截图界面为简体中文，各语言文档共用这些图片和 GIF。拍摄环境与演示素材见[截图说明](../screenshots/README.zh-CN.md)。

## 项目组成

一个仓库，三个应用：Vercel 上的 HTML 网站、VPS 上的后端服务、Chrome 扩展。

| 应用 | 目录 | 运行位置 | 当前状态 |
| --- | --- | --- | --- |
| 网站 | [apps/web](../../apps/web/README.md) | Vercel | 宣传、隐私、条款、更新日志与 11 种语言页面；页头账户入口读取 app.huaci.app 的登录状态 |
| 后端 | [apps/backend](../../apps/backend/README.md) | VPS | 认证、用户与管理员界面、扩展 API、访客试用、精确点数账本、托管文字与图片、Creem 订阅首版，已部署上线 |
| 扩展 | [apps/extension](../../apps/extension/README.md) | 用户的 Chrome / Edge | 商店版 2.1.0；当前源码 2.2.0 新增双语阅读、换说法与用词偏好、按文字形状翻译图片，正在准备发布 |

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
    src/             扩展运行代码与界面（src/vendor/pdfjs 为原样引入的 pdf.js）
    icons/           扩展图标
    _locales/        Chrome 原生本地化产物
    i18n/            开发期界面译文、语言注册表和模板
    scripts/         本地多语言提取、翻译与构建
    test/            扩展测试
    store-assets/    商店文案、截图和宣传素材
    package.sh       扩展专用打包工具
docs/                架构、技术文档与多语言 README
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
npm run dev                   # 启动全部本地服务并列出地址，Ctrl+C 一起停止（见下）
npm test                      # 网站与扩展全部测试
npm run test:web              # 只检查网站
npm run test:extension        # 只检查扩展
npm run dev:web               # http://localhost:8788
npm run build:web             # 生成网站各语言页面
npm run check:web             # 检查网站多语言产物
npm run i18n:extension        # 本地刷新扩展文案
npm run check:extension       # 检查扩展多语言产物
npm run package:extension     # dist/extension/ai-translation-<version>.zip
npm run package:edge          # dist/extension/ai-translation-edge-<version>.zip（Edge 发布准备）
npm run test:backend          # 后端测试（需要 PostgreSQL 的 huaci_test 库）
npm run migrate:backend       # 执行后端数据库迁移
npm run dev:backend           # http://localhost:8787 用户管理界面
```

`npm run dev` 同时启动：

| 服务 | 地址 |
| --- | --- |
| 后端：用户端、扩展 API、Creem 回调（启动前自动执行未完成的数据库迁移） | `http://localhost:8787` |
| 管理端（同一后端进程，按主机名区分） | `http://admin.localhost:8787` |
| 官网静态预览 | `http://localhost:8788` |
| 扩展界面文案监听（修改后在本地刷新译文） | 在 Chrome 加载已解压的 `apps/extension` |

端口已被占用的服务会跳过并说明；后端需要先在 `apps/backend` 运行 `npm ci`，并配置好本机 PostgreSQL 与 `apps/backend/.env.local`。

原来的 `bash test/run.sh`、`bash package.sh` 仍可从仓库根目录运行。各应用的脚本也可以进入应用目录单独运行。

Chrome 开发者模式“加载已解压的扩展”应选择 **`apps/extension`**，不再选择仓库根目录。开发版改变加载路径可能获得新的扩展 ID，需要重新配置；商店版更新继续使用同一个商店条目。

扩展界面翻译生成器依次使用 `apps/extension/.env.local`、仓库根目录 `.env.local` 或进程环境中的配置；保留现有根目录 Key 即可。运行时的用户 API Key 仍只保存在 `chrome.storage.local`。环境文件与开发期翻译工具不进入安装包。

## 部署

- **Vercel 网站**：保留仓库根目录作为 Vercel 项目根目录，`vercel.json` 构建 `apps/web`，仅发布 `apps/web/public`。GitHub 工作流在网站、Vercel 配置或相关构建入口发生变化时触发。
- **VPS 后端**：`apps/backend` 独立部署，已上线（用户端 `app.huaci.app`）。托管音视频转写尚未实现，已识别字幕可走托管文字翻译。部署说明见 [deploy/README.md](../../apps/backend/deploy/README.md)。
- **Chrome 扩展**：单独打包发布到 Chrome 商店。ZIP 白名单为扩展 `manifest.json`、`src/`、`icons/`、`_locales/` 和根目录 `LICENSE`。

职责、旧目录映射和后续顺序见 [架构说明](../architecture.md)。

后续开发约定见根目录 [AGENTS.md](../../AGENTS.md)。

官网：<https://huaci.app/> · 源码：<https://github.com/csswork/AiTranslation>

以 [GPL-3.0](../../LICENSE) 发布。
