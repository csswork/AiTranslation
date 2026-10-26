# Microsoft Edge Add-ons 发布

状态：Edge 首次发布准备中，已完成开发者注册并创建商店草稿；尚未完成账户验证或提交审核。基于扩展 2.1.0；不能把安装包检查通过表述成 Edge 实机验收通过。

## 安装包与环境

```sh
npm run test:extension
npm run package:edge
# dist/extension/ai-translation-edge-2.1.0.zip
```

Chrome 仍使用 `npm run package:extension`，输出文件名保持不变。两种商店包从相同源码生成，白名单均为 `manifest.json`、`src/`、`icons/`、`_locales/`、`LICENSE`，不包含开发工具、密钥、模型或商店资料。

`scripts/prepare-store-package.mjs` 只在临时目录把 `src/lib/env.js` 中的 `@store-package` 标记设为生产；商店包不依赖 `update_url` 才能连接生产账户服务。源码直接加载继续使用 localhost。生产包移除账户内容脚本与回调页的 localhost 来源；不能因此扩大到任意网页。

商店包已有必需的 `<all_urls>` 权限，因此移除被其覆盖的 `optional_host_permissions`，避免 Chromium 的重复权限警告；不增加任何权限，自定义 HTTPS 接口仍按原逻辑检查访问权限。

Edge 同样使用 `chrome.*` 扩展接口和 `chrome-extension://` 回调。快捷键管理链接依据浏览器选择 `edge://extensions/shortcuts`；认证权限依据固定服务地址和服务端校验，不依赖浏览器 User-Agent。

Edge 内置 PDF 阅读器的右键事件可能返回 `TAB_ID_NONE`（`-1`）。整份 PDF 入口此时只解析当前已由顶层内容脚本确认的 PDF 标签页，再传给翻译页；没有可信来源则打开本地文件选择界面，不读取其他网页，也不把负数 ID 传给 `tabs.create`。

## 账号与后台

1. 在 Partner Center 注册 Microsoft Edge **个人开发者**。国家/地区与账户类型按本人实际情况确认，注册后不能改；自行阅读并确认开发者协议。
2. 创建扩展草稿并上传 Edge ZIP，取得真正的 **32 位 a–p 扩展 ID**。Partner Center 产品 GUID 不是扩展 ID。
3. 在 VPS `/etc/huaci/backend.env` 的 `EXTENSION_IDS` 中保留 Chrome ID，追加新 Edge ID（逗号分隔），重启服务并检查健康状态。不能清空白名单、允许任意 ID，或写入本地测试 ID。此步骤扩大生产认证允许列表，执行前明确确认具体 ID。
4. 若后台初期只显示产品 GUID，按微软提供的测试包或包标识取得实际 ID；不要猜测或由产品 GUID 自行转换。
5. 验证访客试用、邮箱/Google 登录、PKCE 回调、余额及订阅显示，以及同一浏览器内网页和扩展的双向登出。Chrome 和 Edge 的各自会话不能互相退出。

## 商店资料

`apps/extension/store-assets/edge/en.txt` 是本次英文完整说明的源，包含 2.0.0 账户和托管服务、2.1.0 PDF/图片功能、价格与续费、BYOK、隐私及实验功能限制。其余 23 种语言由同目录工具本地生成：

```sh
node apps/extension/store-assets/edge/build-listings.mjs
node apps/extension/store-assets/edge/build-listings.mjs --check
```

已有译文的源哈希未变化时不调用翻译 API。工具只发送公开文案，使用本地 DeepSeek 配置；商店资料不会进入 ZIP。Partner Center 支持的商店语言以页面选项为准，不把扩展语言代码直接当作商店语言代码。每种启用的商店语言填写完整说明。

界面文案构建会拦截孟加拉语目录误用印地语字母；本地刷新器会重译这些错误缓存，并拒绝模型再次返回错误文字体系。

`submission.json` 提供用途、权限理由、数据处理事实、支持网址、审核步骤与更新说明。逐项对照 Partner Center 的实际问题填写，不能勾选“完全不处理数据”或“所有请求都直连平台”。API 响应只作为数据；所有可执行代码均随包提供。

现有 `icons/icon128.png` 可作商店 Logo（128×128）；`store-assets/screenshots/` 五张功能截图为 1280×800，`store-assets/promo/` 为 440×280 与 1400×560。现有截图来自 Chrome 中的真实扩展界面，未经 Edge 实测不要称作 Edge 实机截图；初次可以先只用 Logo，或重新录制 Edge 图。

## 隐私与兼容性验收

- 发布前先让官网新的隐私政策公开可访问：Chrome 云端语音识别使用 Google；Edge 使用 Microsoft Azure。根目录 `PRIVACY.md` 与 11 语言官网同时维护。扩展默认本机识别，不因 Edge 不支持本机识别而自动上传音频。
- 在当前稳定版 Edge 实测划词、区域、图片、整份 PDF、语言/RTL、快捷键、设置保存与恢复、BYOK 和托管请求。PDF 必须测试内置阅读器、同源读取、对照展示与打印导出。
- 视频字幕只作可选实验功能，不承诺稳定版均支持本机识别。微软文档目前把本机识别列为 Canary/Dev 150.0.4076+ 并需启用实验开关；根据实际浏览器能力显示错误，不偷偷切云端。云端识别也需实际验证当前标签页音轨接口。
- 检查 ZIP 完整性、白名单、所有本地化目录和第三方许可证；不要修改 pdf.js 原始供应商文件。
- 审核资料写明邮箱验证码登录与访客试用步骤；不存在共享密码，不编造测试账号或付费权限。
- 商店通过并取得公开安装链接后，再同步官网 Edge 入口和后端安装链接；未发布时不制造无效商店 URL。

## 2026-10-25 本机实测记录

环境为 macOS、Microsoft Edge 156.0.4314.42，以本次商店 ZIP 解压目录加载。开发包产生的本地 ID 不属于商店正式 ID，不加入生产白名单。

已验证：

- 生产访客试用发放 50.00 点，翻译后账户余额更新。
- 浏览器中文自动识别，英文、孟加拉语切换，以及阿拉伯语从右向左排版。
- 目标改为日语后，网页右键菜单显示 `Translate to Japanese`；划词翻译、原文展开与 Esc 关闭通过。
- 托管翻译面板、网页区域规则、日语区域翻译与原文恢复通过。
- 托管图片识别返回 10 个文字框，覆盖日语译文并下载 PNG。
- Edge 内置阅读器的整份 PDF 入口、两页日语翻译、对照与只看译文通过；打印导出的两页 PDF 可提取日语标题和正文。
- 翻译面板不再把平台显示为内部 ID `hosted`；图片空白提示改用已有本地化文案。
- 扩展测试、负数 PDF 标签 ID 回归测试、语法检查及商店包白名单检查通过；Chrome 与 Edge ZIP 均已重新生成。

图片位置仍受模型坐标准确度影响：本次导出样本的标题框出现裁切，必要时需手动校正，不能把实验功能描述成所有图片均能准确排版。

尚未验证或完成：

- 正式 Edge ID 的账户授权、PKCE 回调及网页/扩展双向登出（2026-10-26 已在服务端补齐，见下）。本地测试 ID 的授权请求被后台拒绝，未为测试放开生产白名单。
- 使用真实用户 Key 的 BYOK 请求，以及实验语音识别。
- Partner Center 仍被浏览器工具的已保存权限或管理策略拦截；新版 ZIP、23 种商店语言和截图尚未补交，未提交审核。
- 微软开发者身份验证及正式 ID 配置。

官网说明已移除过期的「整份 PDF 尚未在 Chrome 商店发布」提示，并补齐 11 种语言。[PR #1](https://github.com/csswork/AiTranslation/pull/1) 已于 2026-10-25 合并，官网与 VPS 两条生产部署均通过；[正式隐私页](https://www.huaci.app/privacy.html) 已更新。线上中英文隐私页、用户端及管理端 `/healthz`、官网读取登录状态的 CORS 响应均核验通过。没有修改正式扩展 ID 白名单。

Chrome 商店虽已显示 2.1.0，但公开完整说明仍沿用早期自带 Key 版本（包含「没有开发者服务器」）；需要另行更新 Chrome 商店文案和数据披露，本次没有操作 Chrome 开发者后台。

`dist/extension/edge-store-materials-2.1.0.zip` 包含公开文案、Logo、审核说明及两张来自 Edge 的功能截图，供后续填写商店使用；它是商店资料包，不能作为扩展安装包上传。扩展 ZIP 仍为 `ai-translation-edge-2.1.0.zip`。

## 2026-10-26 正式 Edge ID

Partner Center 的扩展 CRX ID 为 `mojcgjimlkkbohomcijkmoefpeekmohe`（产品 GUID `16469f92-…` 不是扩展 ID）。VPS `EXTENSION_IDS` 已在 Chrome ID 之后追加该 ID（修改前备份为 `/etc/huaci/backend.env.bak-20261026095352`），服务重启后健康检查正常。

从外部核验：Edge 与 Chrome 来源的预检返回 204，授权页带着上下文跳到登录；未列入的 ID 预检 403、授权页 400。以审核账号对 Edge ID 走完 `/review-login` → 授权确认 → 回调 `chrome-extension://mojcgjimlkkbohomcijkmoefpeekmohe/src/auth/callback.html` → PKCE 换取扩展令牌 → `/me`（正式账户、1000.00 点）→ 扩展退出后关联网页会话一并退出。这是服务端接口验证，Edge 商店安装后的实机登录仍需在审核通过后复核。

审核说明（Notes for certification）选择 “Yes”，内容为 `submission.json` 的 `testingNotes` 填入审核账号与访问密钥；凭据只在 Partner Center 填写，不进入仓库。

## 官方参考

- [移植 Chrome 扩展](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/port-chrome-extension)
- [注册开发者](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account)
- [商店提交](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension)
- [Edge 本机语音识别](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/speech-recognition-api)
- [Edge 云端语音服务](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/speechrecognitionenabled)
