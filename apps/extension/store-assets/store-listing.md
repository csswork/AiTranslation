# Chrome 网上应用店 · 商品详情文案

配套素材见同目录 `screenshots/`、`promo/`、`video/`。

---

## 一、类别（Category）该选哪个

**选 `Productivity`（效率）。**

我拉取了商店前台当前在用的类别清单（2026-09-30，`chromewebstore.google.com/category/extensions`）：

```
Productivity  Communication  Developer Tools  Education  Tools
Workflow & Planning  Lifestyle  Art & Design  Entertainment  Games
Household  Just for Fun  News & Weather  Shopping  Social Networking
Travel  Well-being  │  Make Chrome Yours: Accessibility · Functionality & UI · Privacy & Security
```

选 Productivity 的理由：

- 翻译类扩展的传统归属地，同类竞品（Google 翻译、沉浸式翻译、划词翻译类）都在这里；
- 商店前台按类别浏览时，这个分类的流量最大；
- 六种翻译方式（双语阅读、划词、图片、整份 PDF、区域、翻译面板）本质都是「读网页时少一步」的效率工具，而不是开发者工具或娱乐内容。

备选与排除：

| 类别 | 是否合适 | 说明 |
| --- | --- | --- |
| `Tools` 工具 | 次选 | 如果后台下拉里出现这一项、且你更想强调「工具属性」，可以选它；但它的浏览流量明显小于 Productivity |
| `Workflow & Planning` | 不建议 | 面向任务/项目管理类扩展，和「读网页」的即时场景不贴 |
| `Accessibility` / `Privacy & Security` / `Functionality & UI` | 不要选 | 前台把它们归在 "Make Chrome Yours" 分组下，语义是「改造浏览器本身」，选错会影响推荐池 |
| `Education` | 不建议 | 会被当成语言学习工具，但你的产品不做教学、不做背单词 |

> 后台下拉框才是最终依据——它偶尔会与前台清单有出入。以你实际看到的选项为准，原则不变：**优先 Productivity，其次 Tools**。

---

## 二、详细说明（中文，默认上架用）

2.2.0 起详细说明统一放在 [`listings/`](listings/README.md)：简体中文 [`listings/zh-Hans.txt`](listings/zh-Hans.txt)，其余 23 种语言同目录。直接复制到商店后台对应语言的「详细说明」字段即可（Chrome 与 Edge 共用）。

扩展名称与简短说明来自安装包的 `_locales`（`extensionName`、`extensionDescription`），随新版本提交自动更新，不在这里维护：

- 名称：划词 – AI 翻译与双语阅读 / Huaci – AI Translator & Bilingual Reader
- 简短说明：双语阅读整篇文章，翻译选中的文字、图片与 PDF：用你选择的平台，或免 Key 的点数翻译。

---

## 三、English description

见 [`listings/en.txt`](listings/en.txt)（英文原稿，其他语言据此翻译）。

---

## 四、写这些文案时核对过的产品事实

2.2.0 文案里的说法都对着代码和文档核过：

| 说法 | 依据 |
| --- | --- |
| Manifest V3、Chrome / Edge 116+ | `manifest.json` 的 `manifest_version` / `minimum_chrome_version`；Edge 版见 `docs/extension/edge-release.md` |
| 双语阅读：扫描识别、去广告、逐段对齐、明暗 / 跟随系统、保存到本机 | `docs/extension/reader.md`，`src/reader/`、`src/content/reader.js`、`src/lib/article.js` |
| 点词换说法、用词偏好只存本机 | `docs/extension/word-alternatives.md`，`src/lib/word-picker.js`、`src/lib/terms.js` |
| 图片按笔画勾形状、竖排、先看形状再翻译、框选、导出 | `docs/extension/image-translation.md` |
| 整份 PDF：原位覆盖、对照、打印另存为 PDF、扫描件不支持 | `docs/extension/pdf-translation.md` |
| 平台：OpenAI / DeepSeek / DeepL；DeepL 不支持识图与换说法 | `src/lib/settings.js`、`src/lib/providers.js` |
| 点数：每 500 个字符 1 点、失败返还、点数不过期、订阅无限使用（合理使用） | `docs/backend/credit-accounting.md`、官网价格区 |
| 点数翻译经服务器、不保存内容 | 隐私政策、`apps/backend/src/translation/hosted.js` |
| 统一的 24 种语言、从右往左布局 | `i18n/locales.json` |
| 单次 6000 字符 | `src/lib/lang.js` 的 `MAX_TEXT_LENGTH = 6000` |
| 快捷键 ⌘⇧Y / Alt+Shift+T | `manifest.json` 的 `commands` |

---

## 五、后台字段核对

| 后台字段 | 要求（官方文档） | 你手上有的 |
| --- | --- | --- |
| 详细说明 | 开头先说清用途，避免关键词堆砌，最长 16,000 字符 | `listings/`，中文约 2,100 字，英文约 6,500 字符 |
| 类别 | 主要类别，一个 | 建议 `Productivity` |
| 语言 | 商品的语言，影响用户用什么语言搜到 | 建议 Chinese (Simplified) |
| 商店图标 | 128×128 | `icons/icon128.png` ✓ |
| 截图 | 至少一张 1280×800，最多 5 张 | `screenshots/` 5 张 ✓ |
| 宣传视频 | 一个 YouTube 链接 | `video/*.mp4` 需先传 YouTube |
| 小宣传图块 | 440×280 PNG/JPEG，**必填** | `promo/promo-440x280.png` ✓ |
| 横幅宣传图块 | 1400×560 PNG/JPEG，可选 | `promo/promo-1400x560.png` ✓ |
