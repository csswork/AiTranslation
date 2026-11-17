# Chrome 网上应用店 · 上架素材

2.3.0 的完整商店长介绍提供 24 种语言，见 [语言索引](listings/README.md)；Edge 加载项商店的说明与提交资料在 [`edge/`](edge/)，Firefox Add-ons 的专用说明、语言范围与已用素材见 [`firefox/`](firefox/README.md)。每种语言一个可直接复制的文本文件；生成和检查方式见索引说明。

截图和视频都是真跑出来的：在装了本扩展的 Chrome for Testing 里自动操作真实页面，
只有「大模型的回复」换成了本地假接口（内容写死在 `tools/capture/lib/content.mjs`），
所以画面 100% 可复现，也没有消耗任何 API 额度。例外是宣传片里的图片翻译一段：识别和译文是真实模型（DeepSeek）当次返回的结果。

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
| `video/huaci-promo-zh.mp4` | 1920×1200 · 30fps · H.264 · 约 103s · AAC 立体声配乐 · 中文版 | 先传到 YouTube，再把链接填进「商品详情 → 视频」（中文商店语言） |
| `video/huaci-promo-en.mp4` | 同上 · 全球版 | 同上，给其他商店语言和 YouTube 主视频用 |
| `video/ai-selection-translator-demo.mp4` | 1280×800 · 42.5s · 无音轨 | 2026-09 的旧版宣传片（只有划词、区域、图片、设置页），留作存档 |

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

## 视频内容（约 103 秒，字幕叙事，带合成配乐）

2026-11-15 按 2.3.0 的界面重拍，重点是图片自动翻译和双语阅读，其余入口各一小段。两个版本结构相同：

- **中文版**：中文界面，日文图片和英文网页译成简体中文，中文字幕；
- **全球版**：英文界面，日文图片和中文网页（`make-zh-pages.mjs` 由英文演示页生成）译成英文，英文字幕。

配乐是 `film/make_music.py` 用 numpy 现场合成的（铺底、电钢、琶音、合成鼓与音效，没有采样），按片中的节点对齐：
章节卡前有上扬音效、出现时有重音；图片段扫描时有上行音，译文盖上时有一串铃音；双语阅读段收着，其余入口段鼓点最满，本机翻译段回落，片尾在 Cmaj9 上收住。
音乐总响度归一到 −16 LUFS。

| 段落 | 内容 | 画面来源 |
| --- | --- | --- |
| 片头 | 标识、名称、八个功能标签 | 合成 |
| 01 图片自动翻译（约 34 秒） | 右键 → 扫描并按笔画勾出文字形状 → 推近看竖排招牌与标题 → 译文按原位置排回 → 与原图对照 → 三页漫画连翻 → 弹窗里改单段译文、框选区域、复制或下载 | 拉面店海报与 Pepper&Carrot 第 1 话（CC BY 4.0）；形状、译文、弹窗截图都是真实模型跑出来的，右键菜单和镜头是合成的。全球版译成英文后竖排招牌变成横排，挤出红色窄条，这是扩展当前的真实效果 |
| 02 双语阅读（约 21 秒） | 认出正文、去广告 → 逐段对照 → 点词换说法 → 深色 → 保存到本机 | 真实扩展录屏，预置译文 |
| 03 其余入口（约 38 秒） | 划词翻译、整份 PDF、网页区域、整站翻译、翻译面板各一段录屏；本机翻译是一张文字卡 | 真实扩展录屏，预置译文。划词在真实的维基百科上（全球版用中文维基）。整站翻译用写入名单代替右键勾选（无头模式录不到原生菜单）；拍摄用的 Chrome for Testing 不带内置翻译模型，所以本机翻译没有录屏。全球版 PDF 里扩展把每段最后一行单独分块，演示译文按字数比例切给前后两块，引文处衔接略生硬 |
| 片尾 | 名称、huaci.app、功能标签、翻译方式与浏览器、素材说明与署名 | 合成 |

字幕、章节卡、画框和进度线是 `tools/capture/film/promo.html` 里用 Web Animations 排好、逐帧截图渲染的；
录屏片段里的鼠标光标是合成画的（无头录屏里没有系统光标）。

## 重新生成

前提：本机有 Chrome for Testing（`~/.cache/puppeteer/chrome/`）与系统代理（脚本按 `127.0.0.1:7897` 直连例外处理假接口）。

```bash
cd tools/capture
node capture-features.mjs        # 5 个功能的真实界面 → out/features/（8788 被占用时加 CAPTURE_PORT=8790）
node compose-features.mjs        # 套版 → apps/extension/store-assets/screenshots/（可只做某几张：node compose-features.mjs 02 04）
```

宣传片（图片那段会调用真实的 DeepSeek 识图与翻译，读根目录 `.env.local` 里的 Key；每个版本四张图）：

```bash
cd tools/capture
# 中文版素材
FILM_LANG=zh-Hans FILM_TAG=ramenzh node film/capture.mjs ramen   # 主角图：拉面店海报
FILM_LANG=zh-Hans FILM_TAG=pczh node film/capture.mjs pc         # 三页漫画
node record-demos.mjs reader selection element pdf panel         # 五段录屏（假接口）
node record-site.mjs                                             # 整站翻译
PY=/Users/haibo/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3
$PY scripts/compose_demos.py reader selection element pdf panel site
# 全球版素材
FILM_LANG=en FILM_TAG=ramenen node film/capture.mjs ramen
FILM_LANG=en node film/capture.mjs pc
node make-zh-pages.mjs                                           # 中文源页面与 report-zh.pdf
DEMO_LANG=en node record-demos.mjs reader selection element pdf panel
DEMO_LANG=en node record-site.mjs
DEMO_LANG=en $PY scripts/compose_demos.py reader selection element pdf panel site
# 渲染、配乐、合成（render-promo.mjs 同时写出 out/film/promo-<lang>-cues.json，配乐按它对齐）
node film/render-promo.mjs still en 5 20 60                      # 先抽几帧看画面
node film/render-promo.mjs                                       # 两版 → out/film/promo-<zh|en>.mp4（无声）
for l in zh en; do
  $PY film/make_music.py $l                                      # → out/film/music-<lang>.wav
  ffmpeg -y -i out/film/promo-$l.mp4 -i out/film/music-$l.wav -map 0:v -map 1:a -c:v copy \
    -af loudnorm=I=-16:TP=-1.5:LRA=7 -c:a aac -b:a 192k -ar 48000 -shortest -movflags +faststart \
    ../../apps/extension/store-assets/video/huaci-promo-$l.mp4
done
```

`record-demos.mjs` 不带参数时会清空整个 `out/demo-raw`（全球版是 `out/demo-raw-en`），整站那段要在它之后录；带参数时只清对应的几段。
同一时间只能跑一个 `render-promo.mjs`（共用 8796 端口和浏览器配置目录）。

字幕和各段时长都在 `film/promo.html` 里（`S.zh` / `S.en` 两份文案），两个版本的素材与片段倍速在 `film/render-promo.mjs` 的 `VERSIONS` 里。翻译面板那段合成前去掉了推镜（清空 `out/demo-raw/panel/timeline.json` 的 `beats`），
否则放大后左边会被裁掉。旧版宣传片的流程（`record-video.mjs` → `scripts/compose_video.py` → `scripts/encode`）还在，不再使用。

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

- 截图和视频里的译文是**预置的演示译文**，不是真实模型当时的输出；界面、交互、请求链路都是真的。宣传片的图片翻译一段例外，是真实模型的结果，片尾有说明。全球版中文源页面里的中文就是这些演示译文本身。
- 以后如果改了界面或文案，这三张带扩展 UI 的截图（1、2、4、5）和视频都需要重跑上面几条命令。

> 附：`tools/capture/node_modules/ffmpeg-static/ffmpeg` 里另有一份可用的 ffmpeg 6.0
> （当初装它是为了编码，后来发现系统 AVFoundation 就够用，所以成片没有经过它）。
> 之后想给视频配背景音乐、剪掉片段或重新压码率，可以直接用这个二进制。
