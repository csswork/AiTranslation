# 工程结构与部署边界

## 三个应用

| 应用 | 负责什么 | 发布什么 |
| --- | --- | --- |
| `apps/web` | 宣传、语言页面；后续登录入口和登录状态展示 | Vercel 静态 HTML、CSS、JS 与资源 |
| `apps/backend` | 身份、试用额度、托管翻译、支付订阅与 API；用户管理界面和管理员界面 | VPS 服务、两套界面与数据库迁移；用户管理界面、管理员界面首版、扩展接口、访客试用、托管文字翻译与 Creem 订阅已实现并部署上线 |
| `apps/extension` | Chrome 内翻译；优先实现登录、点数、订阅和托管模式入口 | Chrome 商店扩展 ZIP |

扩展中的 `src/manage` 是现有“区域翻译规则管理”界面，属于扩展本身，不属于 VPS 的用户管理界面或管理员界面。

扩展的整份 PDF 翻译（`src/pdf/`）在本机用原样引入的 pdf.js（`src/vendor/pdfjs/`）解析和渲染，只有提取出的文字走现有翻译链路（自带 Key 或托管文字翻译），文件不上传、后端无需改动。随扩展 2.1.0 打包，待上传商店；实现与限制见 [PDF 翻译](extension/pdf-translation.md)。

扩展的图片翻译在 2.0.0 之后增加了框选（矩形 / 圆形）、相近色背景、按笔画校正遮盖位置、按文字块识别和导出新图片，同样随 2.1.0 打包、待上传商店；送检前补白成正方形、框选拼图、按笔画校正等实现与实测见 [图片翻译](extension/image-translation.md)。

网站目前启用 11 种语言，扩展支持 24 种语言；两套目录独立维护，发布和翻译更新互不依赖。后端目前实现了用户管理界面（邮箱验证码与 Google 登录、账户、会话、点数、订阅与账单）、管理员界面首版（A1–A9，含运营报表）、扩展登录与扩展 API、访客试用、按点数计费的托管文字翻译、托管图片识别与翻译和 Creem 订阅收款，已随扩展 2.0.0 部署上线；音视频托管尚未实现（本机识别出的字幕可使用托管文字翻译）。

## 后续服务关系

```mermaid
flowchart LR
  Web[HTML 网站 · Vercel] -->|登录状态与权益| API
  Web -.->|登录、订阅链接| UserUI
  Extension[Chrome 扩展] -->|托管模式：登录、额度与翻译| API
  Extension -.->|订阅升级与管理| UserUI
  Extension -->|自带 Key 模式| Provider[模型服务商]
  subgraph VPS[VPS · apps/backend]
    UserUI[用户管理界面 · app] -->|本人数据| API[API · api]
    AdminUI[管理员界面 · admin] -->|管理员权限| API
    API --> Database[数据库与额度账本]
  end
  API -->|托管翻译| Provider
  API -->|创建结账| Payment[支付服务商]
  Payment -->|已验签的 Webhook| API
```

此图描述后续收费功能的边界；用户管理界面面向注册用户，管理员界面面向运营者，两者共用 API 和数据但分别验证权限。当前可用的翻译链路仍是扩展直接调用用户选择的服务商。

## 网页与扩展的统一账号（规划）

扩展是收费功能的主要使用入口。它需要登录与退出、用户名与必要的账号状态、试用及剩余点数、套餐及订阅状态、托管与自带 Key 模式选择、订阅升级及管理入口。账号资料只保留必要的 email 和 username，第三方头像、昵称、真实姓名等额外资料不保存或展示。余额与权益以 VPS API 为准；点数用尽后后端拒绝托管请求，自带 Key 模式继续按用户配置运行。

建议的域名划分如下，尚未配置 DNS 或服务：

| 域名 | 部署位置 | 用途 |
| --- | --- | --- |
| `huaci.app` | Vercel | 官网、登录入口、登录状态及简要权益展示 |
| `app.huaci.app` | VPS | 用户管理界面：注册、登录、账户、订阅与账单 |
| `admin.huaci.app` | VPS | 独立管理员界面；管理接口由服务端验证管理员权限 |
| `api.huaci.app` | VPS | 扩展、官网和两套界面共用的认证、用户、额度、翻译、支付及管理 API |

`app`、`admin` 和 `api` 可以由同一台 VPS 和同一个 `apps/backend` 应用提供服务。两套界面的基础功能见 [功能审核稿](backend/ui-scope.md)。

网页使用 HTTPS 与后端 HttpOnly、Secure Cookie 会话；调用跨子域 API 时携带 credentials。Cookie 可只绑定 API 主机，官网通过状态接口读取用户名、登录状态和必要的点数与订阅权益，无需 JavaScript 读取登录 Cookie。跨子域仍是跨来源请求，需要服务端 CORS 来源白名单，修改状态的请求还需 CSRF 防护；网站 CSP 需允许具体 API 来源。

扩展在当前窗口的标签页打开用户端授权页，由用户主动登录，身份验证在 VPS 完成，确认后回到扩展自己的回调页（web_accessible_resources，只对用户端来源开放）返回一次性授权码，再用 PKCE 校验交换会话令牌。会话可撤销，令牌不放入回调 URL 或宿主网页。后台 API 调用由 service worker 发起，不需要 `identity` 权限；API 主机不申请 host 权限，靠服务端对扩展来源的 CORS 白名单放行。

网页与扩展登录凭据分别管理，使用同一后台用户 ID、点数账本和订阅权益；Chrome 账号或浏览器同步状态不能代替本产品的登录验证。目前已实现用户管理界面的网页登录与官网状态接口：接口暂由用户端主机提供（`/api/web/session`，CORS 白名单 + credentials），会话 Cookie 只绑定用户端主机；拆分出独立的 `api.huaci.app` 时再调整 Cookie 归属。官网入口在生产用户端上线前保持隐藏。扩展登录与扩展会话已实现（本地），接口同样暂由用户端主机提供（`/api/extension`）。用户端与扩展默认滚动保留一年（`SESSION_DAYS=365`）；有效访问续期服务端会话，网页访问与官网状态查询也刷新用户端 Cookie。令牌值保持不变，过期或被撤销后回到未登录、由用户重新登录。管理端独立固定为 30 天。

参考：[Chrome 登录 API](https://developer.chrome.com/docs/extensions/reference/api/identity)、[扩展跨域请求](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)、[网页携带会话凭据](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch#including_credentials)。

扩展正式会话关联授权网页会话；扩展有效使用时，同时为仍有效的关联网页会话续期，避免只使用扩展时被父会话的旧期限中断。扩展不能读取或刷新网页 Cookie，也不能恢复过期或已撤销的会话。网页或扩展主动登出都会撤销该网页及其关联扩展，其他浏览器保持登录；在会话列表中单独撤销某个扩展仍只影响该扩展。用户端专用内容脚本只通知扩展核对服务端状态，不读取 Cookie、不传递凭据。通知在脚本与 service worker 两端都按 `AITrEnv.accountOrigin` 校验完整来源；开发环境只接受 `http://localhost:8787`，生产只接受 `https://app.huaci.app`。反向同步时，扩展只向同环境的用户端与官网（开发环境 `http://localhost:8788`，生产 `https://huaci.app`）发送无数据的刷新提示；网页自行查询 `/api/web/session`，失效 Cookie 由服务端清除。扩展清单显式声明这些站点的主机权限以查询对应标签页的 URL，运行时仍严格匹配完整来源，不接受其他本地端口或管理端。已登录的用户端刷新页面，官网恢复本地化的登录入口；切回标签页、恢复缓存页面时也会核对，网络失败保留当前显示。生产官网入口仍受 `ACCOUNT_ORIGIN` 与 CSP 的上线配置控制。旧版未关联的正式扩展会话在迁移 `007` 后重新授权一次。

## 精确额度与点数展示

点数只是客户展示单位：文字托管按实际 Unicode 字符数精确计量，内部固定 500 单位 = 1 点，数据库 `bigint` 与代码 `BigInt` 保存整数字符额度。余额、赠送、流水等界面保留两位小数，不用显示数值判断权限；扩展与官网读取服务端的 `credits.available`。转换、预扣、失败返还、迁移及接口约定见 [精确额度记账](backend/credit-accounting.md)。

## 旧目录到新目录

| 原路径 | 当前路径 |
| --- | --- |
| `manifest.json`、`src/`、`icons/`、`_locales/` | `apps/extension/` 下相同路径 |
| `extension-i18n/` | `apps/extension/i18n/` |
| `scripts/` | `apps/extension/scripts/` |
| `store-assets/` | `apps/extension/store-assets/` |
| `docs/` 的网站内容 | `apps/web/public/` |
| `i18n/` | `apps/web/i18n/` |
| `test/csp.mjs`、`test/i18n.mjs`、`test/lang.mjs` | `apps/web/test/` |
| 其余扩展测试 | `apps/extension/test/` |
| `VIDEO-AUDIO-TRANSLATION.md` | `docs/extension/video-audio-translation.md` |

根目录 `test/run.sh`、`package.sh` 保留为统一入口。`LICENSE` 与已有公开链接使用的 `PRIVACY.md` 保留在根目录。`.vercel/`、`.env.local` 与忽略的本地工具不迁入应用发布目录。

## 发布和配置

- Vercel 项目仍使用**仓库根目录**作为 Root Directory。根目录 `vercel.json` 指向 `apps/web/public`，网站访问 URL 保持原样。
- 网站 CI 检查网站多语言、覆盖范围和 CSP，网站相关改动才触发部署。后端后续建立单独的 VPS 发布流程。
- 扩展打包进入临时目录，拷入运行文件及统一 `LICENSE`，产物生成到 `dist/extension/`。不包含网站、后端、环境文件、开发脚本、测试或商店素材。`src/vendor/pdfjs/`（pdf.js 及其字体、字符映射，约 4.7MB）属于运行文件，随 `src/` 打包，ZIP 约 2.8MB。
- 开发期翻译 Key 可继续放在根目录 `.env.local`；扩展生成器优先读取应用自己的 `.env.local`。文件不随发布产物分发，也不执行其中的代码。
- 服务端新增密钥与数据库连接配置应放在 VPS 环境中。浏览器侧只接收需要公开的 API 地址与 OAuth 公共标识。

## 本地迁移

在 `chrome://extensions/` 中加载 **`apps/extension`**。移动已解压扩展的目录可能改变开发版 ID；原扩展的数据属于原 ID，新的开发版可能需要重新填写 Key 和偏好。此目录调整不改变既有 Chrome 商店条目。

本地静态预览的文档根目录为 `apps/web/public`。内部页面路径、图片与脚本 URL 均保持不变。

本次整理先让三个应用各自拥有源码、开发工具、测试与说明。只有出现实际共用的数据结构或接口后，再添加共享包；目前不为后端预装框架或人为拆出第四个应用。
