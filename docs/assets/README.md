# docs/assets —— 需要你自己放进来的东西

站点已经能正常打开，下面这些是「放进来就自动生效」的素材。
**不需要改 HTML**：`main.js` 会在对应的展示框滚到视口附近时去找同名文件，
找到就用，找不到就静静留着占位层——不会出现破图或红色报错。

## 演示视频（已就位）

五段都已录好放在这里，`main.js` 会自动接管，不需要改 HTML：

| 文件名 | 出现在哪 | 内容 | 时长 |
| --- | --- | --- | --- |
| `demo-hero.mp4` | 首屏右侧的大框 | 划词 → 浮动按钮 → 弹窗里译文逐字出现 | 9.6s |
| `demo-selection.mp4` | 功能 01 划词翻译 | 同样一遍操作，但跑在真实的维基百科页面上 | 9.7s |
| `demo-element.mp4` | 功能 02 元素翻译 | 悬停区域出现按钮 → 点击就地变中文 | 8.2s |
| `demo-image.mp4` | 功能 03 图片翻译 | 载入图片 → 识别并翻译 → 译文盖回原位、鼠标划过联动高亮 | 8.0s |
| `demo-panel.mp4` | 功能 04 翻译面板 | 输入原文 → 右侧逐字出译文 | 10.6s |

全部 1280×800（16:10）、30fps、约 4 Mbps、H.264 + faststart、**无音轨**，单文件 0.36–1.01 MB。
首尾各有一段淡出到页面底色的过渡，循环播放时不会跳。

重新生成走仓库外的拍摄工具链（`tools/capture/`，不进 git）：

```bash
cd tools/capture
node record-demos.mjs                    # 录 5 段（可只录某几段：node record-demos.mjs hero panel）
/Users/haibo/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3 scripts/compose_demos.py
for c in hero selection element image panel; do
  node_modules/ffmpeg-static/ffmpeg -y -framerate 30 -i out/demo-frames/$c/frame_%06d.png \
    -c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p -an -movflags +faststart \
    ../../docs/assets/demo-$c.mp4
done
```

录制环境、假接口与文案都在那套工具里，改完重跑即可；细节见 `tools/capture/lib/content.mjs` 的注释。

> 注意：示例里的译文是**预先写好的演示文案**（真实模型调用会消耗额度、且不可复现），
> 界面、交互、请求与流式链路都是真的。

## 静态图

| 文件名 | 用途 | 现在是什么 |
| --- | --- | --- |
| `preview.svg` | 首屏大框在视频到位前显示的图 | 手画的效果示意图，可以直接用 |
| `og.png` | 分享到社交媒体 / IM 时的预览图（1200×630） | 已生成 |
| `icon128.png` | favicon 和导航栏图标 | 从仓库根目录 `icons/` 复制来的 |

想把 `preview.svg` 换成真实截图：放一张 16:10 的 `preview.png` 进来，
然后改 `docs/index.html` 里首屏那一处 `<img src="assets/preview.svg">` 的文件名。

`og.png` 若要重做，可以用无头 Chrome 截一张 1200×630：

```
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless \
  --window-size=1200,630 --screenshot=og.png file:///绝对路径/og-source.html
```

## 换掉图标

根目录的 `icons/icon128.png` 若有更新，记得同步过来：

```
cp icons/icon128.png docs/assets/icon128.png
```
