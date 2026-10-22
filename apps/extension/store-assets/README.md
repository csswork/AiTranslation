# Chrome 网上应用店 · 上架素材

1.1.0 的完整商店长介绍提供 24 种语言，见 [语言索引](listings/README.md)。每种语言一个可直接复制的文本文件；生成和检查方式见索引说明。

截图和视频都是真跑出来的：在装了本扩展的 Chrome for Testing 里自动操作真实页面，
只有「大模型的回复」换成了本地假接口（内容写死在 `tools/capture/lib/content.mjs`），
所以画面 100% 可复现，也没有消耗任何 API 额度。

## 文件与上传位置对照

| 文件 | 规格 | 商店后台位置 |
| --- | --- | --- |
| `listings/*.txt` | 24 种语言的完整长介绍 | 商品详情 → 对应语言 → 详细说明 |
| `screenshots/01-selection-translate.png` | 1280×800 PNG | 商品详情 → 截图（第 1 张） |
| `screenshots/02-image-translate.png` | 1280×800 PNG | 商品详情 → 截图（第 2 张） |
| `screenshots/03-pdf-translate.png` | 1280×800 PNG | 商品详情 → 截图（第 3 张） |
| `screenshots/04-block-translate.png` | 1280×800 PNG | 商品详情 → 截图（第 4 张） |
| `screenshots/05-translate-panel.png` | 1280×800 PNG | 商品详情 → 截图（第 5 张） |
| `promo/promo-440x280.png` | 440×280 PNG | 商品详情 → 宣传图 → 小图（**必填**，没有它排序会靠后） |
| `promo/promo-1400x560.png` | 1400×560 PNG | 商品详情 → 宣传图 → 横幅（可选，用于首页精选位） |
| `video/ai-selection-translator-demo.mp4` | 1280×800 · 30fps · H.264 · 42.5s · 无音轨 | 先传到 YouTube，再把链接填进「商品详情 → 视频」 |

官方规格见 <https://developer.chrome.com/docs/webstore/images>：
截图要求 1280×800 或 640×400、直角、无留白，24 位 PNG 不带透明通道（这五张均满足）；
宣传图同样要求 JPEG 或 24 位 PNG（不带透明通道）。官方建议宣传图以品牌为主、少放文字，所以两张只放了名称、
一句标语（横幅另有五个入口的小标签），其余用真实界面拼成的浮动卡片表达功能。

## 各张截图在演示什么

2.1.0 起的五张功能截图（2026-10-21）对应首页的「五个入口」，按同一版式套好：左边是编号、主题、大标题、
一句说明和三个功能小标签，右边是装在浏览器窗口里的真实界面，再把最关键的那块界面放大浮出来。每张一个主题色。

| 张 | 主题 | 主题色 | 大标题 | 浮出的界面 |
| --- | --- | --- | --- | --- |
| 1 | 划词翻译 | 靛紫 | 选中就翻 / 译文逐字就到 | 翻译弹窗：流式译文与展开的原文对照 |
| 2 | 图片翻译 | 橙粉 | 图里的字 / 也能翻 | 主画面是整张拉面店海报译好的结果（相近色底、竖排招牌）；圆形浮层是圈住角标的框选 |
| 3 | 整份 PDF 翻译（标 NEW） | 青绿 | 整份 PDF / 版面不走样 | 对照模式里的译文页 |
| 4 | 网页区域翻译 | 蓝青 | 一整块网页 / 一点就中文 | 上下对比：英文段落带「译」按钮 → 就地换成中文 |
| 5 | 翻译面板 | 紫红 | 整段贴进来 / 马上有译文 | 译文区 |

## 视频内容（42.5 秒，无声，靠字幕叙事）

`开头品牌卡 → 划词翻译（拖动选词 / 浮动按钮 / 弹窗流式输出 / 展开原文对照）→ 切换到 ChatGPT 重译 →
整块元素就地翻译 → 图片翻译 → 设置页 → 片尾卡`

字幕与轻微推拉镜头是录制之后合成上去的，鼠标光标也是合成画的
（无头录屏里没有系统光标）。

## 重新生成

前提：本机有 Chrome for Testing（`~/.cache/puppeteer/chrome/`）与系统代理（脚本按 `127.0.0.1:7897` 直连例外处理假接口）。

```bash
cd tools/capture
node capture-features.mjs        # 5 个功能的真实界面 → out/features/（8788 被占用时加 CAPTURE_PORT=8790）
node compose-features.mjs        # 套版 → apps/extension/store-assets/screenshots/（可只做某几张：node compose-features.mjs 02 04）
node record-video.mjs            # 录一遍流程 → out/video-raw/ + out/timeline.json
/Users/haibo/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3 scripts/compose_video.py
./scripts/encode out/video-frames 30 out/video/demo.mp4
```

标题、说明、标签、主题色和浮出的范围都写在 `compose-features.mjs` 顶部的 `CARDS` 里，改文案只需改那里再重跑套版。
图片翻译用的拉面店海报由 `node make-ramen.mjs` 生成（见 `apps/web/public/assets/README.md`）。

宣传图（2026-10-21 起与功能截图同一套视觉，也用 `out/features/` 里的原始界面）：

```bash
node compose-promo.mjs           # promo-440x280.png 与 promo-1400x560.png → apps/extension/store-assets/promo/
```

素材图片（文章页示意图、旧版图片翻译样例）与旧版宣传图：

```bash
/Users/haibo/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3 scripts/make_assets.py
/Users/haibo/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3 scripts/make_promo.py
```

`scripts/encode.swift`（帧序列 → H.264 MP4，用系统 AVFoundation，不依赖 ffmpeg）、
`scripts/grab.swift`（从成片抽帧自检）、`scripts/probe.swift`（查成片规格）需要先编译：

```bash
TMPDIR=$PWD/.tmp swiftc -O -module-cache-path $PWD/build/modulecache scripts/encode.swift -o scripts/encode
```

## 两点提醒

- 截图和视频里的译文是**预置的演示译文**，不是真实模型当时的输出；界面、交互、请求链路都是真的。
- 以后如果改了界面或文案，这三张带扩展 UI 的截图（1、2、4、5）和视频都需要重跑上面几条命令。

> 附：`tools/capture/node_modules/ffmpeg-static/ffmpeg` 里另有一份可用的 ffmpeg 6.0
> （当初装它是为了编码，后来发现系统 AVFoundation 就够用，所以成片没有经过它）。
> 之后想给视频配背景音乐、剪掉片段或重新压码率，可以直接用这个二进制。
