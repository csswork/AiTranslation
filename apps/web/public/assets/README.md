# apps/web/public/assets —— 需要你自己放进来的东西

站点已经能正常打开，下面这些是「放进来就自动生效」的素材。
**不需要改 HTML**：`main.js` 会在对应的展示框滚到视口附近时去找同名文件，
找到就用，找不到就静静留着占位层——不会出现破图或红色报错。

## 演示视频（已就位）

**首屏刻意不放视频**：那里用静态示意图（直接内联在 `index.html` 里的 SVG），第一眼就完整可读，
也不和下面「02 划词翻译」那段视频重复。六个功能区块各放一段，`main.js` 自动接管，不需要改 HTML。

**视频里不放任何语言的说明文字**：官网有 11 种语言，没法每种语言各做一版，所以视频只有画面、
功能序号、数字、图标和 `huaci.app`，说明靠视频旁边已经按语言翻译好的功能文案。每段的结构相同：
片头（标识 + 与官网区块一致的功能序号）→ 正片 → 片尾。

| 文件名 | 出现在哪 | 正片内容 | 时长 |
| --- | --- | --- | --- |
| `demo-reader.mp4` | 功能 01 双语阅读 | 新闻页上右键 → 光带扫过、标题与正文点亮 → 阅读页逐段对照译文 → 点词换说法 → 切到深色 → 保存 | 26.3s |
| `demo-selection.mp4` | 功能 02 划词翻译 | 在维基百科页面上划词 → 浮动按钮 → 弹窗里译文逐字出现 | 14.9s |
| `demo-image.mp4` | 功能 03 图片翻译 | 单独编排：右键漫画页 → 扫描识字（计数、用时）→ 推近看按笔画勾出的文字形状 → 盖上译文 → 译文与原图对照 → 换页 → 弹窗的四个功能（对照、改单段、框选、导出） | 43.5s |
| `demo-pdf.mp4` | 功能 04 整份 PDF 翻译 | 内置 PDF 阅读器里右键 → 翻译页骨架扫光 → 译文盖回原位 → 切到只看译文 | 21.0s |
| `demo-element.mp4` | 功能 05 元素翻译 | 悬停区域出现按钮 → 点击就地翻译 | 13.4s |
| `demo-panel.mp4` | 功能 06 翻译面板 | 输入原文 → 右侧逐字出译文 | 15.8s |

全部 1280×800（16:10）、30fps、H.264 + faststart、**无音轨**，单文件 0.4–2.6 MB。首尾都淡入淡出，循环播放不会跳。

- **图片翻译那段**是真实结果：图上的文字形状和译文由真实内容脚本加真实模型跑出来（日文译英文、英文界面），
  弹窗画面是真实界面截图；右键菜单和镜头是后期编排的。漫画是 Pepper&Carrot 第 1 话日文版
  （David Revoy，日文翻译 guruguru，CC BY 4.0），署名标在用到它的每个画面左下角和片尾，换素材时署名要跟着换。
- **其余五段**的正片是原有的屏幕录制（界面和译文是中文，译文是预先写好的演示文案，界面、交互和请求链路是真的），
  放进画框，下面一条进度线。原片留在 `tools/capture/film/source/`；要更新画面，先按旧流程重录
  （`record-demos.mjs` → `compose_demos.py` → ffmpeg，见该目录里的脚本），把成片放进 `source/`，
  删掉 `film/assets/clips/<名字>/` 再渲染。

重新生成走仓库外的拍摄工具链（`tools/capture/film/`，不进 git）：

```bash
cd tools/capture
node film/capture.mjs pc                 # 图片翻译：用真实模型跑漫画页，抓形状、译文和界面截图
node film/render.mjs                     # 渲染图片翻译那段 → out/film/image-film-1280.mp4
node film/render.mjs clip reader selection pdf element panel   # 其余五段 → out/film/<名字>-film-1280.mp4
for c in reader selection image pdf element panel; do
  cp out/film/$c-film-1280.mp4 ../../apps/web/public/assets/demo-$c.mp4
done
```

视频是滚到视口附近才开始拉的。**空窗期由 `main.js` 压一层转圈**（`.frame-loading`），
就绪后视频淡入、转圈淡出再移除；加载失败则摘掉 video，占位层原样留着。切到「减少动态效果」时
不转圈、不自动播放，改为显示播放控件。

重新生成走仓库外的拍摄工具链（`tools/capture/`，不进 git）：

```bash
cd tools/capture
node make-report-pdf.mjs                 # 只在改了 pages/report.html 时需要
node make-ramen.mjs                      # 只在改了 pages/ramen-source.html 时需要
node record-demos.mjs                    # 全部重录（可只录某几段：node record-demos.mjs pdf）
# 8788 被本机官网预览占用时：CAPTURE_PORT=8790 node record-demos.mjs pdf
/Users/haibo/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3 scripts/compose_demos.py
for c in reader selection element pdf panel; do   # image 那段是单独的介绍短片，见上
  node_modules/ffmpeg-static/ffmpeg -y -framerate 30 -i out/demo-frames/$c/frame_%06d.png \
    -c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p -an -movflags +faststart \
    ../../apps/web/public/assets/demo-$c.mp4
done
```

录制环境、假接口与文案都在那套工具里，改完重跑即可；细节见 `tools/capture/lib/content.mjs` 的注释。

> 注意：除 `demo-image.mp4` 外，示例里的译文是**预先写好的演示文案**（真实模型调用会消耗额度、且不可复现），
> 界面、交互、请求与流式链路都是真的。

## 静态图

| 文件名 | 用途 | 现在是什么 |
| --- | --- | --- |
| `og.png` | 分享到社交媒体 / IM 时的预览图（1200×630） | 已生成（划词 – AI 翻译与双语阅读，右侧为双语阅读页） |
| `icon128.png` | favicon 和导航栏图标 | 从 `apps/extension/icons/` 复制来的 |

首屏右侧大框的正式配图**不是文件**，是 `apps/web/public/index.html` 里内联的 SVG（`<div class="pv">`），
拆成「背后的网页」和「译文弹窗」两层：鼠标移上去两层反向错开，颜色随深浅配色切换。

想换成真实截图：把整个 `<div class="pv">…</div>` 换成 `<img src="assets/preview.png" alt="…">`
（16:10）即可，但悬停错开的效果会跟着消失——它靠的是两层分开。要保留效果，
得准备两张图：一张网页截图，一张抠出来的透明底弹窗 PNG，分别替换两个 `<svg class="pv-layer">`。

`og.png` 由拍摄工具链生成（2.2.0 改名后重做）：页面源是 `tools/capture/pages/og-source.html`（右侧截图取自双语阅读演示的一帧 `og-reader.jpg`），在 `tools/capture` 里运行 `node make-og.mjs` 截成 1200×630 并写到这里。

## 换掉图标

扩展的 `apps/extension/icons/icon128.png` 若有更新，在仓库根目录运行以下命令同步过来：

```
cp apps/extension/icons/icon128.png apps/web/public/assets/icon128.png
```
