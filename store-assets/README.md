# Chrome 网上应用店 · 上架素材

全部素材都是真跑出来的：在装了本扩展的 Chrome for Testing 里自动操作真实页面，
只有「大模型的回复」换成了本地假接口（内容写死在 `tools/capture/lib/content.mjs`），
所以画面 100% 可复现，也没有消耗任何 API 额度。

## 文件与上传位置对照

| 文件 | 规格 | 商店后台位置 |
| --- | --- | --- |
| `screenshots/01-selection-translate.png` | 1280×800 PNG | 商品详情 → 截图（第 1 张） |
| `screenshots/02-block-translate.png` | 1280×800 PNG | 商品详情 → 截图（第 2 张） |
| `screenshots/03-image-translate.png` | 1280×800 PNG | 商品详情 → 截图（第 3 张） |
| `screenshots/04-translate-panel.png` | 1280×800 PNG | 商品详情 → 截图（第 4 张） |
| `screenshots/05-options.png` | 1280×800 PNG | 商品详情 → 截图（第 5 张） |
| `promo/promo-440x280.png` | 440×280 PNG | 商品详情 → 宣传图 → 小图（**必填**，没有它排序会靠后） |
| `promo/promo-1400x560.png` | 1400×560 PNG | 商品详情 → 宣传图 → 横幅（可选，用于首页精选位） |
| `video/ai-selection-translator-demo.mp4` | 1280×800 · 30fps · H.264 · 42.5s · 无音轨 | 先传到 YouTube，再把链接填进「商品详情 → 视频」 |

官方规格见 <https://developer.chrome.com/docs/webstore/images>：
截图要求 1280×800 或 640×400、直角、无留白（这五张是原始截图，均满足）；
宣传图官方建议「以品牌图形为主、避免文字」，因此两张宣传图不含任何文案，只用了品牌色与图标。

## 各张截图在演示什么

1. **划词翻译** — 真实拖动选中英文句子 → 浮动「译」按钮 → 居中弹窗流式出译文，并展开了原文对照
2. **整块元素翻译** — 为某个区域添加规则后，鼠标移上去点「译」，整块就地变成中文
3. **图片翻译** — 上传一张英文告示牌照片，识别出 9 段文字并按住原位覆盖中文
4. **翻译面板** — 独立页面里整段翻译，带字数、用时、目标语言
5. **设置页** — 三个平台、API Key（本地存储）、模型、测试连接

## 视频内容（42.5 秒，无声，靠字幕叙事）

`开头品牌卡 → 划词翻译（拖动选词 / 浮动按钮 / 弹窗流式输出 / 展开原文对照）→ 切换到 ChatGPT 重译 →
整块元素就地翻译 → 图片翻译 → 设置页 → 片尾卡`

字幕与轻微推拉镜头是录制之后合成上去的，鼠标光标也是合成画的
（无头录屏里没有系统光标）。

## 重新生成

前提：本机有 Chrome for Testing（`~/.cache/puppeteer/chrome/`）与系统代理（脚本按 `127.0.0.1:7897` 直连例外处理假接口）。

```bash
cd tools/capture
node capture-screenshots.mjs     # 5 张截图 → out/shots/
node record-video.mjs            # 录一遍流程 → out/video-raw/ + out/timeline.json
/Users/haibo/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3 scripts/compose_video.py
./scripts/encode out/video-frames 30 out/video/demo.mp4
```

素材图片（文章页示意图、图片翻译样例）与宣传图：

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
