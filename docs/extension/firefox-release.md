# Firefox Add-ons 发布

首次发布准备中，尚未获 Mozilla 审核通过。安装包版本沿用扩展 manifest；当前为 2.3.0。只提交桌面 Firefox，不宣称支持 Android。

## 打包

```sh
npm run test:extension
npm run package:firefox
# dist/extension/ai-translation-firefox-2.3.0.zip
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

2026-11-16：扩展测试、网站测试与后端全部 139 项测试通过；Mozilla web-ext 10.8.0 本地检查及 AMO 上传检查均为 0 个错误、17 条警告。首次上传后又补充了 Firefox 本机 PDF 入口，最终包需重新上传核验。尚未完成 Firefox 安装后的端到端实测；不能把单元测试或包验证说成实机验证。

警告包括静态界面模板的 innerHTML、固定扩展本地路径的 pdf.js import，以及未启用的视频 API。Readability 与 pdf.js 均为原样引入的上游文件；PDF 页明确设置 `isEvalSupported: false`、`useWasm: false`，未放开 unsafe-eval，模型响应只当数据处理。审核时提供第三方版本/来源和可重建的扩展源码。

上架入口：https://addons.mozilla.org/developers/addon/submit/ 。只有实际提交并观察到待审核状态后，才在本文件记录提交完成；审核通过并取得公开页面后再增加官网安装链接。

官方资料：[后台脚本](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background)、[扩展 ID 与数据声明](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings)、[Firefox 数据同意](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)。
