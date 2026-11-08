# 本机翻译（浏览器内置 Translator API）

> 状态：已接入扩展源码，**未发布**。只在 Chrome 156 上用临时探测扩展实测过 API 本身（2026-11-07，见第四节）；扩展里的整条链路还没有在浏览器里跑过。

## 一、用户能做什么

翻译平台多了一项「本机翻译」：用浏览器内置的翻译模型在本机翻译，免费，不需要 API Key，不消耗点数，原文不发给任何服务器。

- 可用于划词、区域翻译、翻译面板、整份 PDF、双语阅读和视频字幕。
- 不支持图片翻译（不能识图）、点词换说法（Translator 只给一个译文），也没有逐字流式输出。这几项与 DeepL 的处理相同：明确报错，不悄悄换平台。
- 用词偏好与 DeepL 一样，在译文里替换（`AITrTerms.applyTo`）。
- 语言包按「原文语言 → 目标语言」下载，下载一次后断网也能用。设置页选中本机翻译时出现「本机翻译」卡片，可以选原文语言下载到当前目标语言的语言包，并显示状态与进度。
- 浏览器不提供 `Translator`（Firefox、Safari、旧版 Chrome、手机）时，平台列表里不出现本机翻译；已经选了它的用户仍保留这一项，翻译时提示原因。

## 二、实现

| 文件 | 内容 |
| --- | --- |
| `src/lib/local.js` | `AITrLocal`：语言代码换算、原文语言识别、翻译器缓存、批量翻译、设置页下载 |
| `src/lib/settings.js` | `PROVIDERS.local`（`kind: 'local'`），`isLocal`、`localSupported`；`KEY_PROVIDERS` 不含它；`providerList(current)` 在不支持时隐藏它 |
| `src/lib/providers.js` | `translate`、`translateBatch`、`translateCaption`、`testConnection` 走 `local` 分支；`alternatives`、`readImageText` 与 DeepL 同样拒绝 |
| `src/options/` | 「本机翻译」卡片与下载按钮 |
| `src/popup/popup.js` | 选中本机翻译时的状态文字 |
| `test/local.mjs` | 用假的 `Translator` / `LanguageDetector` 覆盖上述行为 |

`local.js` 与 `providers.js` 一起被 service worker（`import`）和扩展页面（`<script>`）加载；设置页单独加载它，用于下载。

### 语言代码

项目语言 id → Translator 代码：简体中文 `zh-Hans` → `zh`，繁体 `zh-Hant` 不变，其余去掉地区后缀（`pt-BR` → `pt`）。识别结果按同样规则换算；原文与目标代码相同时照原样返回，所以简体 ↔ 繁体仍会转换。

### 原文语言识别

Translator 不接受「自动」，原文语言没选时：

1. `LanguageDetector`，置信度 ≥ 0.5 且不是 `und` 才用；
2. 否则 `chrome.i18n.detectLanguage`（`isReliable` 为真才用）；
3. 批量翻译里单段识别不出时，用全部段落合起来再识别一次；
4. 都识别不出时报错，提示在翻译面板里手动选原文语言。

实测 `LanguageDetector` 能区分简繁体，短词（`hello`）也比 `chrome.i18n.detectLanguage` 准；但中文里夹较多英文术语的句子（`React 的 useEffect hook 在 render 之后执行。`）会被认成英文，`chrome.i18n` 反而认成中文。目前接受这个误差。

### 下载与用户手势

还没下载的语言对，`Translator.create()` 需要页面里的用户点击（瞬时激活）。所以：

- 设置页的下载按钮在点击处理里**第一步**就调用 `AITrLocal.prepare()`，前面不能有 `await`。
- service worker 和内容脚本里没有点击可用，失败（`NotAllowedError`）时提示「到设置页的本机翻译里下载」，带 `open-options`。
- `create()` 失败后再查 `availability()`，为 `unavailable` 时说明这个语言对不支持。

## 三、运行环境

- Chrome 138+ 桌面版、Edge 148+ 提供这两个 API（官方文档的支持表）；Firefox、Safari 都没有，手机版 Chrome 也没有。
- 官方文档说 Translator 和 LanguageDetector 在 Web Worker 里不可用，但实测扩展的 service worker 里两者都是 `function`。扩展直接在 service worker 里调用，**还没有实测在那里能创建翻译器**，见下节。

## 四、探测结果（Chrome 156，macOS，2026-11-07）

探测扩展在本机 `tools/translator-probe/`（不入库）。第一步（不点击）的结果：

| 上下文 | `Translator` | 已安装语言对不点击直接翻译 |
| --- | --- | --- |
| 扩展页面 | 有 | — |
| service worker | 有 | 未测 |
| offscreen 文档 | 有 | 成功（en→zh 330ms，之后约 150ms） |
| 内容脚本（隔离环境） | 有 | 成功（约 110ms） |

- 项目 24 种语言里，`fa`（波斯语）和 `ur`（乌尔都语）的语言对都是 `unavailable`，其余可下载；`zh-Hant` 是独立的语言对。
- 隐私设计：别的网站下载过的语言对，在新来源里也可能报 `downloadable`。
- 译文是直译风格（`快速的棕色狐狸在城市睡觉时跳过懒惰的狗。`）。

还没验证、上线前要在真实扩展里确认：

1. service worker 里能否 `create()` 并翻译（划词、整页翻译都走这里）。不行就改由 offscreen 文档执行；offscreen 文档全扩展只能有一个，要与视频字幕共用 `src/offscreen/`。
2. 没下载过的语言对不点击时是报 `NotAllowedError` 还是直接开始下载。
3. 翻译面板、PDF、双语阅读页点按钮翻译时能否直接下载（取决于 `create()` 时点击是否仍然有效）。
