# Readability（第三方，勿手改）

来源：npm `@mozilla/readability@0.6.0`（Mozilla，Apache-2.0，见 `LICENSE.md`；Firefox 阅读模式所用的正文识别库）。只供双语阅读使用：右键「双语阅读这篇文章」时由后台注入网页顶层框架，在页面副本上识别正文。

保留的文件：`Readability.js`、`Readability-readerable.js`、`LICENSE.md`。不需要包里的 `JSDOMParser.js`（只在 Node 里用）。

升级：`npm pack @mozilla/readability@<版本>` 到临时目录（不进仓库），确认许可证不变后整体替换上述文件，同步本说明里的版本号，跑扩展测试与 `tools/capture/reader-e2e.mjs`。
