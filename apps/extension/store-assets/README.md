# Chrome 网上应用店 · 上架素材

2.3.0 的完整商店长介绍提供 24 种语言，见 [语言索引](listings/README.md)；Edge 加载项商店的说明与提交资料在 [`edge/`](edge/)，Firefox Add-ons 的专用说明、语言范围与已用素材见 [`firefox/`](firefox/README.md)。每种语言一个可直接复制的文本文件；生成和检查方式见索引说明。

## 功能截图（2026-11-23）

英文主套与简体中文套各五张，均为 1280×800 的 RGB PNG。两套使用相同的功能顺序。英文套使用英文界面和英文译文，简体中文套使用简体中文界面和译文。图片用日文咖啡菜单演示，其余场景在中英文之间翻译。

| 顺序 | 功能 | 英文 | 简体中文 |
| --- | --- | --- | --- |
| 1 | 划词翻译 | [英文](screenshots/en/01-selection-translate.png) | [简中](screenshots/zh-Hans/01-selection-translate.png) |
| 2 | 图片翻译 | [英文](screenshots/en/02-image-translate.png) | [简中](screenshots/zh-Hans/02-image-translate.png) |
| 3 | 双语阅读 | [英文](screenshots/en/03-bilingual-reader.png) | [简中](screenshots/zh-Hans/03-bilingual-reader.png) |
| 4 | 整份 PDF 翻译 | [英文](screenshots/en/04-pdf-translate.png) | [简中](screenshots/zh-Hans/04-pdf-translate.png) |
| 5 | 整站翻译 | [英文](screenshots/en/05-site-translate.png) | [简中](screenshots/zh-Hans/05-site-translate.png) |

每张只有一个功能名作标题，其余全是界面：界面按 2 倍分辨率拍摄后缩进画面；整站翻译左图带扩展自己的「正在翻译这个网站」状态条。真实扩展界面在独立的 Chrome for Testing 配置中拍摄。示例网页、图片、PDF 与预置识图和译文均由本机提供。使用现有 `tools/capture/` 环境时，从仓库根目录运行 `node tools/capture/store-shots.mjs` 可重新拍摄，传入 `en` 或 `zh-Hans` 可单独更新一套。

### 各商店用哪套

| 商店 | 默认 / 其他语言 | 简体中文商品页 | 说明 |
| --- | --- | --- | --- |
| Chrome 网上应用店 | `en/` 五张 | `zh-Hans/` 五张 | 截图按商店语言分别上传；没有单独上传的语言显示默认语言的截图 |
| Edge 加载项 | `en/` 五张 | `zh-Hans/` 五张 | 每种商店语言各有截图栏，宣传图也按语言分别设置（都用同一套）；图中是 Chrome 里的扩展界面，不称作 Edge 实机截图 |
| Firefox Add-ons | `en/` 五张 | 同左 | AMO 截图不分语言；五个功能 Firefox 版都有，PDF 图里没有 Chrome 专有入口 |

繁体中文商品页暂用英文套，没有单独制作繁体截图。

## 宣传图和视频

截图、宣传图和视频都是真跑出来的：在装了本扩展的 Chrome for Testing 里自动操作真实页面，
只有「大模型的回复」换成了本地假接口（功能截图与宣传片的示例页面和译文在 `tools/capture/store-shot-scenes.mjs`，宣传图的在 `tools/capture/lib/content.mjs`），
所以画面可复现，也没有消耗任何 API 额度。

## 文件与上传位置对照

| 文件 | 规格 | 商店后台位置 |
| --- | --- | --- |
| `listings/*.txt` | 24 种语言的完整长介绍 | 商品详情 → 对应语言 → 详细说明 |
| `screenshots/en/01-selection-translate.png` … `05-site-translate.png` | 1280×800 PNG × 5，英文 | 商品详情 → 截图（按文件编号排第 1–5 张；英文与其他商店语言） |
| `screenshots/zh-Hans/01-selection-translate.png` … `05-site-translate.png` | 1280×800 PNG × 5，简体中文 | 商品详情 → 简体中文 → 截图（第 1–5 张） |
| `promo/promo-440x280.png` | 440×280 PNG | 商品详情 → 宣传图 → 小图（**必填**，没有它排序会靠后） |
| `promo/promo-1400x560.png` | 1400×560 PNG | 商品详情 → 宣传图 → 横幅（可选，用于首页精选位） |
| `video/huaci-promo-en.mp4` | 1920×1200 · 30fps · H.264 · 约 83s · AAC 立体声配乐 · 英文 | 已上传 YouTube：<https://youtu.be/r2J_NAdy2ME>，链接填进「商品详情 → 视频」（所有商店语言共用） |
| `video/youtube-thumbnail.png` | 1280×720 PNG · 约 0.4 MB | YouTube 上传页 → Thumbnail → Upload file（YouTube 要求 16:9、不超过 2 MB） |
| `video/ai-selection-translator-demo.mp4` | 1280×800 · 42.5s · 无音轨 | 2026-09 的旧版宣传片（只有划词、区域、图片、设置页），留作存档 |

官方规格见 <https://developer.chrome.com/docs/webstore/images>：
截图要求 1280×800 或 640×400、直角、无留白，24 位 PNG 不带透明通道（两套十张均满足）；
宣传图同样要求 JPEG 或 24 位 PNG（不带透明通道）。宣传图不分商店语言，官方建议以品牌为主、少放文字、颜色饱和、少用白色和浅灰、铺满画面。2026-11-23 起两张与 YouTube 缩略图同一视觉：
靛蓝渐变底、白底图标、名称（横幅另有一句英文标语），其余是各种语言的「你好」气泡，没有界面截图。

## 视频内容（约 83 秒，英文，2026-11-23）

与功能截图同一风格：浅色底，每段是「图标 + 功能名」和右侧一行入口说明（如 “Right-click an article → Read this article bilingually”），
画面是真实扩展的录屏，没有字幕、章节卡和功能标签。英文界面，把中文网页、日文菜单和中文 PDF 译成英文。只做英文一版。

| 段落 | 入口 | 内容 |
| --- | --- | --- |
| 片头 | | 图标、名称、一句标语 |
| 划词翻译 | 选中文字 → 浮动按钮 | 拖选一句话 → 点浮动按钮 → 译文逐词出现 → 把弹窗拖到句子下方 |
| 图片翻译 | 图片上右键 → Translate text in image | 识别时的扫描效果 → 译文排回菜单 → 切到原图 → 切回译文 |
| 双语阅读 | 文章页右键 → Huaci 子菜单 → Read this article bilingually | 在一篇真实的 Medium 中文文章上右键 → 扩展标出识别到的正文 → 阅读页逐段填入英文 → 切到上下对照 → 切回并排 |
| PDF 翻译 | Chrome 内置 PDF 阅读器里右键 → Translate entire PDF | 对照页逐块翻译 → 滚动查看 → 只看译文 → 切回对照 |
| 整站翻译 | 页面右键 → Huaci 子菜单 → Translate this website | 首页自动翻译（右下角状态条）→ 点导航进入「门票」页，新页面也自动翻译 |
| 片尾 | | 图标、名称、huaci.app，一行说明：真实扩展界面、演示译文、示例文章作者 |

双语阅读用的文章是 Medium 上 李帅的地球Online 的《在Medium上写技术文章的几个经验》（2022-02-16）。在浏览器里正常打开后保存成去掉脚本的本机快照
`tools/capture/pages/medium/article.html`，录制时从本机加载，图片与样式经代理从 Medium CDN 取；英文译文是 `pages/medium/translations-en.json` 里的预置文案。
无头 Chrome 直接打开 Medium 会停在 Cloudflare 验证页，所以不直接访问线上页面。片尾注明了作者，这篇文章没有取得作者授权。

Chrome 的右键菜单是原生菜单，无头录屏拍不到，所以按 Chrome（macOS）的样子画在画面上：菜单项与扩展实际注册的一致
（页面上扩展的三项收在扩展名子菜单里，图片和 PDF 上只有一项，直接显示在顶层）；选中后由脚本触发扩展的同一动作。
录屏用 CDP screencast，鼠标光标与点击圈按录制时的真实鼠标轨迹合成。划词弹窗获得焦点时浏览器默认的焦点框在示例页上去掉了，扩展本身没有改动。

配乐由 `film/make_music_clean.py` 合成：沿用 `film/make_music.py` 的音色与混音，片头只有铺底和铃音，各功能段同一套轻节奏，
段落切换处一声轻扫，点击处很轻的提示音，片尾在 Cmaj9 上收住；总响度归一到 −16 LUFS。

## 重新生成

前提：本机有 Chrome for Testing（`~/.cache/puppeteer/chrome/`）与系统代理（脚本按 `127.0.0.1:7897` 直连例外处理假接口）。

功能截图（两套，见上文）：

```bash
node tools/capture/store-shots.mjs            # 从仓库根目录运行；只更新一套时加 en 或 zh-Hans
```

宣传片（假接口，不调用真实模型；Medium 快照的图片与样式走 `127.0.0.1:7897` 代理，可用 `FILM_PROXY` 改）：

```bash
node tools/capture/store-film.mjs still 5 20 40        # 录制后先抽几帧看画面 → tools/capture/out/store-film/still-en-*.png
node tools/capture/store-film.mjs                      # 录制并渲染 → out/store-film/promo-en.mp4（无声）
cd tools/capture
/Users/haibo/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3 film/make_music_clean.py en   # → out/store-film/music-en.wav
node_modules/ffmpeg-static/ffmpeg -y -i out/store-film/promo-en.mp4 -i out/store-film/music-en.wav -map 0:v -map 1:a -c:v copy \
  -af loudnorm=I=-16:TP=-1.5:LRA=7 -c:a aac -b:a 192k -ar 48000 -shortest -movflags +faststart \
  ../../apps/extension/store-assets/video/huaci-promo-en.mp4
```

YouTube 缩略图是画出来的示意图，不是界面截图，配色与截图、宣传片一致。脚本里有四个方案（selection 划词、split 左右对照、hello 多语言问候、menu 右键菜单），默认用 hello：

```bash
node tools/capture/youtube-thumb.mjs                    # 全部方案 → tools/capture/out/thumbs/，默认那张 → apps/extension/store-assets/video/youtube-thumbnail.png
THUMB_PICK=menu node tools/capture/youtube-thumb.mjs    # 换成另一个方案
```

`store-film.mjs` 的其他用法：`rec` 只录不渲染，`render` 不重录只渲染；`FILM_ONLY=selection,reader` 只重录这几段。
标题、入口说明与片头片尾文案在 `store-film.mjs` 的 `COPY` 里，右键菜单项在 `MENU`、`PAGE_MENU` 里，各段操作在同文件的 `selection`、`image`、`reader`、`pdf`、`site` 函数里。
2026-11-15 的字幕版宣传片（`film/promo.html`、`film/render-promo.mjs`、`film/make_music.py`）不再使用，成片可从 git 历史取回。

功能截图的标题在 `store-shots.mjs` 的 `locales` 里，示例网页与译文在 `store-shot-scenes.mjs`。
图片翻译用的拉面店海报由 `node make-ramen.mjs` 生成（见 `apps/web/public/assets/README.md`）。

宣传图（440×280 与 1400×560，画出来的，不需要录屏）：

```bash
node tools/capture/store-promo.mjs     # → apps/extension/store-assets/promo/
```

2026-10-21 的旧版宣传图（真实界面拼成，`capture-features.mjs` + `compose-promo.mjs`）不再使用，成片可从 git 历史取回。

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

- 截图、宣传图和视频里的译文是**预置的演示译文**，不是真实模型当时的输出；界面、交互、请求链路都是真的，宣传片片尾有一行说明。
- 以后如果改了界面或文案，两套功能截图、宣传图和视频都需要重跑上面几条命令。

> 附：`tools/capture/node_modules/ffmpeg-static/ffmpeg` 里另有一份可用的 ffmpeg 6.0
> （当初装它是为了编码，后来发现系统 AVFoundation 就够用，所以成片没有经过它）。
> 之后想给视频配背景音乐、剪掉片段或重新压码率，可以直接用这个二进制。
