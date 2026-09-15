# docs/assets —— 需要你自己放进来的东西

站点已经能正常打开，下面这些是「放进来就自动生效」的素材。
**不需要改 HTML**：`main.js` 会在对应的展示框滚到视口附近时去找同名文件，
找到就用，找不到就静静留着占位层——不会出现破图或红色报错。

## 演示视频

放这四个文件（名字要一致）：

| 文件名 | 出现在哪 | 拍什么 |
| --- | --- | --- |
| `demo-hero.mp4` | 首屏右侧的大框 | 一段最有代表性的画面，通常就是划词翻译 |
| `demo-selection.mp4` | 功能 01 划词翻译 | 选中外文 → 右键 → 弹窗里译文逐字出现 |
| `demo-element.mp4` | 功能 02 元素翻译 | 右键区域 → 挂上按钮 → 点击就地替换 |
| `demo-image.mp4` | 功能 03 图片翻译 | 右键图片 → 转圈 → 译文盖回原位 |
| `demo-panel.mp4` | 功能 04 翻译面板 | 左边贴原文，右边出译文 |

录制建议：

- **比例 16:10**，展示框就是按这个比例留的。比如 1440×900 或 1280×800。
- **不要带声音**。视频是静音自动循环播放的（浏览器的自动播放策略也要求静音）。
- **短**。8 到 15 秒，能看清一次完整操作就够，会一直循环。
- 单个文件尽量压到 2 MB 以内。GitHub Pages 有 100 MB 单文件上限和 1 GB 仓库软上限，
  但更现实的问题是手机流量。用 H.264 + faststart 即可：

  ```
  ffmpeg -i 原片.mov -vf "scale=1280:-2" -c:v libx264 -crf 26 -preset slow \
         -an -movflags +faststart demo-selection.mp4
  ```

视频只在滚到视口附近时才开始加载，离开视口自动暂停；
访客开了「减少动态效果」时不会自动播放，改为显示播放控件。

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
