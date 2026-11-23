# Firefox Add-ons 商店资料

2026-11-17 已补齐 AMO 当前可选的 18 种对应语言的名称、短介绍与完整长介绍。扩展包本身仍提供 24 种界面语言。商店版本 2.3.0.1 已公开（2026-11-23 核实）：<https://addons.mozilla.org/firefox/addon/huaci-ai-translator/>。

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

图标使用 `../../icons/icon128.png`。2026-11-23 起 AMO 截图换成[素材说明](../README.md)里 `screenshots/en/` 的五张（划词、图片、双语阅读、整份 PDF、整站翻译），每张配一句英文说明（en-US），旧的四张已删除；AMO 截图不分语言。图里是 Chrome 中的扩展界面，不是 Firefox 实机截图，五个功能 Firefox 版都有；PDF 图是对照页，不含 Chrome 内置 PDF 的右键入口。

当前 AMO 产品页面的媒体表单只有图标和截图，没有视频字段。宣传片在 Chrome 中录制（PDF 段是 Chrome 内置阅读器的右键入口），YouTube 简介里注明了 Firefox 的 PDF 入口不同、没有本机翻译，并附上 AMO 链接。

[编辑产品页面](https://addons.mozilla.org/zh-CN/developers/addon/huaci-ai-translator/edit) · [审核状态](https://addons.mozilla.org/zh-CN/developers/addon/huaci-ai-translator/versions)（需开发者登录）。
