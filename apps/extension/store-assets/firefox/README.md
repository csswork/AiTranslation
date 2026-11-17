# Firefox Add-ons 商店资料

2026-11-17 已补齐 AMO 当前可选的 18 种对应语言的名称、短介绍与完整长介绍。扩展包本身仍提供 24 种界面语言。商店版本为 2.3.0.1，状态为等待审核。

## 文字资料

- `en.txt` 是 Firefox 专用长介绍源文；其余 23 个 `.txt` 为对应译文，`source-hashes.json` 记录源文版本。
- 名称与短介绍沿用扩展 `i18n/` 生成的 `extensionName`、`extensionDescription`；默认英文短介绍采用 `submission.json` 中的商店文案。
- `submission.json` 保留支持方式、隐私说明、版本说明和审核步骤。
- 介绍说明本机 PDF 选择入口、托管收费、自带 Key、隐私及 Firefox 功能限制；不要以 Chrome/Edge 介绍替代。
- 在 AMO 粘贴长介绍时，标题与 `- ` 列表之间加一个空行，使列表正确渲染。

从仓库根目录生成或检查（复用已有译文时不调用翻译服务）：

```sh
node apps/extension/store-assets/edge/build-listings.mjs --firefox
node apps/extension/store-assets/edge/build-listings.mjs --firefox --check
```

已填写的 AMO 语言代码：`en-US`、`zh-CN`、`zh-TW`、`es-ES`、`pt-BR`、`fr`、`de`、`it`、`nl`、`ru`、`uk`、`pl`、`tr`、`he`、`fa`、`vi`、`ja`、`ko`。

当前商店编辑器没有阿拉伯语、印地语、孟加拉语、乌尔都语、印尼语和泰语选项；对应长介绍已保留在此目录，尚未上传为独立商店语言。这不影响扩展内使用这些界面语言。

## 图标与截图

图标使用 `../../icons/icon128.png`。商店共享以下 4 张 1280×800 的功能图，顺序如下：

1. `../screenshots/01-selection-translate.png`：划词翻译与流式输出。
2. `../screenshots/02-image-translate.png`：图片文字区域调整与导出。
3. `../screenshots/04-block-translate.png`：网页区域翻译与原文切换。
4. `../screenshots/05-translate-panel.png`：翻译面板、平台选择与复制。

这些是既有 Chrome for Testing 拍摄的共用扩展界面宣传图，不是 Firefox 实机验证截图；拍摄与预置译文说明见[素材说明](../README.md)。未使用 `03-pdf-translate.png`，因为图上写的是 Chrome 内置 PDF 的右键入口，与 Firefox 的本机文件选择入口不同。

当前 AMO 产品页面的媒体表单只有图标和截图，没有视频字段。现有宣传片包含 Firefox 不支持的本机翻译及 Chrome/Edge 信息，未作为 Firefox 宣传视频上传或链接。

[编辑产品页面](https://addons.mozilla.org/zh-CN/developers/addon/huaci-ai-translator/edit) · [审核状态](https://addons.mozilla.org/zh-CN/developers/addon/huaci-ai-translator/versions)（需开发者登录）。
