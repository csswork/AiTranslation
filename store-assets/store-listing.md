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
- 你的四个功能（划词、整块、图片、面板）本质都是「读网页时少一步」的效率工具，而不是开发者工具或娱乐内容。

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

```
选中网页上的外文，右键，译文就在屏幕中央逐字浮现——不用切标签页，不用复制粘贴。

AI 划词翻译是一个开源的 Chrome 扩展（Manifest V3），把网页里的文字就地译成中文。译文由你自己配置的大模型 API 生成，支持 ChatGPT（OpenAI）、DeepSeek 与 DeepL，随时切换。


▍四个入口，都在右键菜单里

· 划词翻译
选中一段非中文文字，右键点「翻译成中文」，译文在居中弹窗里流式出现，可展开原文对照阅读。
选中的本来就是中文时菜单不会出现，纯数字、标点、表情同理——不打扰是最基本的设计。

· 元素翻译
给页面上的某个区域挂一个翻译按钮。点一下，区域里的文字就地换成中文。规则按域名记住，下次再访问同一个网站，按钮自动挂上；长内容分批送出，边译边替换，不用等整块跑完。

· 图片翻译
右键一张图片，识别图里的文字，再把译文按识别到的位置盖回原图。长图先切块再识别，切缝落在文字之间的空白行上，不会把一句话劈成两半。

· 翻译面板
一个独立页面，左边原文右边译文，用来处理成段的、不在网页上的文字。14 种目标语言可选（英文、日文、韩文、法文、德文、西班牙文、俄文、阿拉伯文……），并会自动判断输入语言：中文默认译成英文，其他语言默认译成中文。


▍为什么值得装

· 不离开页面：翻译就发生在你正在读的那一段旁边。
· 流式输出：译文逐字出现，不用等整段生成完。
· 跟随系统深浅色；弹窗可拖动、Esc 关闭；支持快捷键 ⌘⇧Y（macOS）/ Alt+Shift+T。
· 划词、元素、图片三种方式默认译成简体或繁体中文，可在设置里切换。


▍关于隐私

· 没有服务器。全部网络请求都集中在 src/lib/providers.js 这一个文件里，只发往你在设置中选定的那家平台。
· 没有统计、没有埋点、没有广告、没有第三方 SDK。
· API Key 只存在本机 chrome.storage.local，不随 Chrome 账号同步，卸载扩展即一并清除。
· 只有你主动触发翻译时，内容才会发出去。你翻译过什么，作者这边无从知道。
· 全部源码以 GPL-3.0 公开，上面这些话都可以照着源码逐行核对。


▍开始使用

1. 首次安装会自动打开设置页：选一个平台，粘贴你自己的 API Key，点「测试连接」确认能通。
2. 之后在任意网页选中外文 → 右键 → 点「翻译成中文」。
需要 Chrome 116 或更高版本。


▍已知限制

· 受浏览器限制，chrome:// 页面、Chrome 应用商店等受保护页面无法注入脚本，因而不能使用。
· 单次翻译上限 6000 字符，超出会截断，弹窗里会说明。
· 自定义接口地址（代理/中转）需要单独授权该域名的访问权限，且只支持 https。


▍关于本项目

独立开源作品，与 OpenAI、DeepSeek、DeepL 及其关联公司无任何隶属、授权或合作关系；ChatGPT、DeepSeek、DeepL 等名称为其各自权利人的商标，此处仅用于说明本扩展可以接入的 API。

官网：https://huaci.app/
源码与问题反馈：https://github.com/csswork/AiTranslation
隐私政策：https://huaci.app/privacy.html
```

---

## 三、English description（备用）

**先说清一件事**：官方文档写明「每个语言区域对应于扩展程序中包含的一个 `_locales/LOCALE_CODE` 目录」，
而你的仓库里**没有 `_locales` 目录、manifest 里也没有 `default_locale`**，
所以现在后台大概率只能维护一份（默认）商品详情，无法单独添加英文语言区域的说明。
要真正做英文区上架，得先给扩展加上 `_locales/en/messages.json` 并在 manifest 里声明 `default_locale`。

如果之后要做，直接用下面这份：

```
Select foreign text on a web page, right-click, and the translation appears in the middle of
the screen, word by word. No switching tabs, no copy-paste.

AI Selection Translator is an open-source Chrome extension (Manifest V3) that translates web
page text into Chinese, using your own ChatGPT (OpenAI), DeepSeek or DeepL API key.


FOUR ENTRY POINTS, ALL IN THE RIGHT-CLICK MENU

· Selection translation
Select a passage, right-click "Translate to Chinese", and the translation streams into a
centered popup with a collapsible original-text panel. If the selection is already Chinese —
or only digits, punctuation or emoji — the menu item simply does not appear.

· Block translation
Attach a translate button to any region of a page. One click replaces the text inside it with
Chinese, in place. Rules are remembered per domain, and long content is translated in batches
so the page updates as it goes.

· Image translation
Right-click an image: the text is read, and the translation is overlaid where the original was.
Long images are split into tiles along blank lines first, so a sentence is never cut in half.

· Translation panel
A standalone page, source on the left and translation on the right, for paragraphs that are not
on a web page. 14 target languages (English, Japanese, Korean, French, German, Spanish, Russian,
Arabic and more), with automatic source-language detection: Chinese translates to English by
default, everything else to Chinese.


WHY INSTALL IT

· Translation happens next to the paragraph you are reading — you never leave the page.
· Streaming output, so you are not waiting for the whole answer.
· Follows your system light/dark theme. Draggable popup, Esc to close, keyboard shortcut
  ⌘⇧Y on macOS / Alt+Shift+T elsewhere.
· Selection, block and image translation all target Simplified or Traditional Chinese.


PRIVACY

· No servers. Every network request lives in a single file (src/lib/providers.js) and goes only
  to the provider you selected in the settings.
· No analytics, no tracking, no ads, no third-party SDKs.
· Your API key is stored locally in chrome.storage.local — never synced through your Chrome
  account, and removed when you uninstall the extension.
· Nothing is sent anywhere until you explicitly trigger a translation.
· The whole source is public under GPL-3.0, so all of the above can be verified line by line.

GETTING STARTED

1. The settings page opens on first install: pick a provider, paste your own API key, and hit
   "Test connection".
2. Then select foreign text on any page → right-click → "Translate to Chinese".
Requires Chrome 116 or later.

KNOWN LIMITATIONS

· Protected pages (chrome://, the Chrome Web Store and similar) do not allow script injection.
· 6000 characters per translation; longer text is truncated and the popup says so.
· A custom API base URL (proxy or relay) needs its origin authorized separately, https only.

ABOUT

An independent open-source project, not affiliated with, authorized by, or partnered with
OpenAI, DeepSeek or DeepL. Their names are trademarks of their respective owners and are used
here only to describe which APIs this extension can call.

Website: https://huaci.app/
Source and issues: https://github.com/csswork/AiTranslation
Privacy policy: https://huaci.app/privacy.html
```

---

## 四、写这些文案时核对过的产品事实

文案里每一句都对着代码核过，避免商店审核和用户预期出现落差：

| 说法 | 依据 |
| --- | --- |
| Manifest V3、Chrome 116+ | `manifest.json` 的 `manifest_version` / `minimum_chrome_version` |
| 三个平台：ChatGPT / DeepSeek / DeepL | `src/lib/settings.js` 的 `PROVIDERS`，`src/lib/providers.js` 里 DeepL 走 `/v2/translate` |
| 面板 14 种目标语言 | `src/translate/translate.js` 的 `LANGUAGES` 数组，实为 14 项 |
| 划词/元素/图片默认译成简繁中文 | `src/lib/settings.js` 的 `TARGETS` 只有 `zh-Hans`、`zh-Hant` |
| 单次 6000 字符 | `src/lib/lang.js` 的 `MAX_TEXT_LENGTH = 6000` |
| 快捷键 ⌘⇧Y / Alt+Shift+T | `manifest.json` 的 `commands` |
| 网络请求只发往选定平台 | `grep -rn "fetch(" src/` 只有 `providers.js` 两处（OpenAI 兼容接口 + DeepL），全项目再无其他网络调用 |
| Key 存 `chrome.storage.local` | `src/lib/settings.js` 的读写实现 |

> **和落地页口径不一致的两处，建议顺手改掉**（我按代码为准写的商店文案）：
> 1. 落地页写「整个项目只有一处 `fetch` 调用」，实际是 **两处**，都在 `src/lib/providers.js`（加了 DeepL 之后多出来的）。商店文案我写成了「全部网络请求都集中在这一个文件里」，既准确又不减分。
> 2. 落地页的「支持接入 ChatGPT（OpenAI）与 DeepSeek」漏了 **DeepL**，但设置页和弹窗里都摆着三张平台卡。

---

## 五、后台字段核对

| 后台字段 | 要求（官方文档） | 你手上有的 |
| --- | --- | --- |
| 详细说明 | 开头先说清用途，避免关键词堆砌 | 见上，中文约 1,400 字 |
| 类别 | 主要类别，一个 | 建议 `Productivity` |
| 语言 | 商品的语言，影响用户用什么语言搜到 | 建议 Chinese (Simplified) |
| 商店图标 | 128×128 | `icons/icon128.png` ✓ |
| 截图 | 至少一张 1280×800，最多 5 张 | `screenshots/` 5 张 ✓ |
| 宣传视频 | 一个 YouTube 链接 | `video/*.mp4` 需先传 YouTube |
| 小宣传图块 | 440×280 PNG/JPEG，**必填** | `promo/promo-440x280.png` ✓ |
| 横幅宣传图块 | 1400×560 PNG/JPEG，可选 | `promo/promo-1400x560.png` ✓ |
