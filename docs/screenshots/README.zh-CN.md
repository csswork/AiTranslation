# README 实机截图与 GIF

[English](README.md) · **简体中文** · [日本語](README.ja.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Español](README.es.md) · [العربية](README.ar.md)

拍摄日期：2026-11-13。扩展版本：源码 **2.2.0 开发版**，不代表商店已发布该版本。

使用 macOS 上的 Chrome for Testing 150，加载本仓库的 `apps/extension`，在独立浏览器配置中运行。界面语言为简体中文，翻译平台为 DeepSeek（`deepseek-flash`）；图片识别、正文翻译和换说法均走扩展实际请求链路，使用模型当次返回的结果。

PNG 为浏览器直接截取的 1280 × 800 画面。GIF 来自 Chrome 的实际录屏帧，按原始时间戳编码为 1000 × 625、10 fps、无限循环，只压缩分辨率和调色板。自动化拍摄触发右键菜单使用的消息或脚本注入流程，GIF 不包含浏览器原生右键菜单。

## 动态演示

| 文件 | 操作 |
| --- | --- |
| [image-recognition.gif](image-recognition.gif) | 识别日文菜单 → 在图片上覆盖中文译文 → 原图对照 → 打开单段编辑 → 框选区域 |
| [bilingual-reader.gif](bilingual-reader.gif) | 网页正文扫描 → 去广告与双语对照 → 点词换说法 → 上下 / 并排布局 → 保存文章 → 深色阅读 |

## 静态截图

| 文件 | 场景 |
| --- | --- |
| [01-bilingual-reader.png](01-bilingual-reader.png) | 原文与译文逐段并排对齐 |
| [02-word-alternatives.png](02-word-alternatives.png) | 选词对应原文、其他译法与自定义替换 |
| [03-reader-library.png](03-reader-library.png) | 深色阅读与本机保存的文章 |
| [04-image-translation.png](04-image-translation.png) | 日文菜单自动识别、按文字形状覆盖中文译文 |
| [05-image-editing.png](05-image-editing.png) | 图片上单段译文的编辑、字号与重新翻译入口 |
| [06-selection-translation.png](06-selection-translation.png) | 网页划词弹窗，展开原文对照 |
| [07-translation-panel.png](07-translation-panel.png) | 独立翻译面板 |
| [08-pdf-translation.png](08-pdf-translation.png) | PDF 原文与译文并排，本机解析，共两页 |
| [09-region-translation.png](09-region-translation.png) | 网页区域就地翻译与悬停翻译按钮 |

## 演示素材

文章、日文菜单图片及 PDF 使用本仓库已有的本地演示素材。文章里的媒体名、作者与日期，以及 PDF 中的测试数据均为样例，不对应真实新闻或性能基准。文章页包含广告占位，双语阅读页展示的是扩展识别、去广告后得到的正文。菜单的中文文字由模型识别、翻译后交给扩展绘制。

拍摄脚本、中间帧和浏览器配置位于被忽略的本机 `tools/capture/`，不进入扩展安装包；本目录只保存 README 使用的成品及说明。
