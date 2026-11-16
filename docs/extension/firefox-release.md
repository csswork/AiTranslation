# Firefox Add-ons 发布

**2026-11-16 已提交 Firefox 2.3.0.1，Mozilla 后台显示「等待审核」；尚未获审核通过。** [状态和版本](https://addons.mozilla.org/zh-CN/developers/addon/huaci-ai-translator/versions)（需开发者登录），最终版本记录为 `6717101`。Firefox 使用 manifest 基础版本加商店修订号 `.1`；初始 2.3.0 草稿由我们在发布前取消，由包含 PDF 入口的最终包替代。Chrome/Edge 的版本号保持不变。只提交桌面 Firefox，不宣称支持 Android。

## 打包

```sh
npm run test:extension
npm run package:firefox
# dist/extension/ai-translation-firefox-2.3.0.1.zip
```

打包器只在临时目录转换 manifest：后台使用 module 类型的 `background.scripts`，移除 Chrome 的最低版本和 `offscreen`、`tabCapture` 权限；生产服务地址仍由现有 `@store-package` 标记决定。Firefox 最低版本为 142，固定 add-on ID 为 `huaci@huaci.app`。这是扩展的公开标识，不是邮箱，不要求创建对应邮箱。Chrome/Edge manifest 与包名保持原样。

按 Firefox 内置数据同意机制声明 `authenticationInfo`（扩展会话和用户自带 Key）与 `websiteContent`（用户请求翻译的文字和图片）。没有遥测。安装包只包含 manifest、src、icons、_locales 与 LICENSE，不含环境文件、开发工具、商店资料或模型。

## 功能边界

账户、试用、点数、订阅、托管文字/图片翻译与自带 Key 模式共用原有后台和账本。保留划词、区域、图片、双语阅读、用词偏好和整站翻译。Firefox 没有内置 Translator，平台列表按已有能力检测隐藏本机翻译。

Firefox 不提供现用的 Chrome 视频捕获接口，因此隐藏视频字幕设置与入口，并在设置规范化时禁止启用。Firefox 内置 PDF 阅读器不允许内容脚本进入；工具栏弹窗提供「翻译整个 PDF」，选择本机 PDF 后沿用本机解析流程，只有提取出的文字发送给翻译平台。

## 登录与部署

Firefox 的 `moz-extension://` 主机名随安装变化，不把任意 UUID 加入服务端白名单。使用固定的用户端 HTTPS 回调 `/extension/firefox/callback`；后台验证该回调与配置的 `APP_ORIGIN` 完全一致，并要求 `EXTENSION_IDS` 包含 `huaci@huaci.app`。生产配置须保留现有 Chrome/Edge ID，只追加此 ID。

授权仍在当前窗口的标签页中进行。扩展后台观察浏览器给出的标签页 URL，只接受同环境、精确路径的 HTTPS 回调，随后转到自己的私有 `src/auth/callback.html`。回调页不通过 web_accessible_resources 公开。state、一次性授权码和 PKCE 校验沿用原流程；令牌不进 URL。服务端回调不反射查询参数、不加载资源，使用 `Referrer-Policy: no-referrer`。

Firefox 后台根据既有 host_permissions 调用固定 API，不要求 CORS 放开随机来源。网页来源仍没有扩展 API 的 CORS 权限；托管请求依然验证扩展 Bearer 会话与服务端额度。Firefox 上报的 add-on ID 仅作访客渠道统计，不作身份认证。授权成功后的来源记录取自经验证的回调。

上线需追加执行 `014_firefox_extension_source.sql`，在数据库原有渠道约束中仅增加这个固定 Firefox ID。网页/扩展双向登出与其他浏览器会话隔离沿用既有服务端逻辑。

## 校验与审核说明

2026-11-16：扩展测试、网站测试与后端全部 139 项测试通过；Mozilla web-ext 10.8.0 本地检查及 AMO 最终包上传检查均为 0 个错误、17 条警告。Chrome/Edge 的独立 ZIP 也重新生成并通过完整性检查。尚未完成 Firefox 安装后的端到端实测；不能把单元测试或包验证说成实机验证。

警告包括静态界面模板的 innerHTML、固定扩展本地路径的 pdf.js import，以及未启用的视频 API。Readability 与 pdf.js 均为原样引入的上游文件；PDF 页明确设置 `isEvalSupported: false`、`useWasm: false`，未放开 unsafe-eval，模型响应只当数据处理。审核时提供第三方版本/来源和可重建的扩展源码。

后端提交 `830268a212f304d62c60e80fff47460fc4705a72` 已通过[生产部署](https://github.com/csswork/AiTranslation/actions/runs/43869594258)，迁移 014 已执行。生产配置备份为 `/etc/huaci/backend.env.bak-firefox-20261116`，保留 Chrome/Edge ID 并追加 `huaci@huaci.app` 后重启；外部健康检查及固定回调均返回 200，回调使用 no-store 和 no-referrer。

商店已填写英文名称/说明、语言工具分类、收费提示、GPLv3、隐私说明和审核步骤。按用户要求不建立审核账号、不分享任何凭据；审核人员使用访客试用或自行注册/登录。初次访客按网络限频，共享审核网络可能没有剩余试用点数，此限制已在审核备注说明。没有修改现有发放、价格或限流规则。

可重建的源码包已准备为 `dist/extension/ai-translation-firefox-source-2.3.0.1.zip`（没有上传到 AMO 的源码附件字段）；审核备注提供公开仓库、构建步骤及第三方原始来源。最终安装包为 `dist/extension/ai-translation-firefox-2.3.0.1.zip`。审核通过并取得公开页面后再增加官网安装链接。

官方资料：[后台脚本](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background)、[扩展 ID 与数据声明](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings)、[Firefox 数据同意](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)。
