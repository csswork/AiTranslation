# YouTube listing · AI Selection Translator demo

针对成片 `store-assets/video/ai-selection-translator-demo.mp4`（42.5 秒，无声，字幕已烧进画面）。

---

## Title（选一个，YouTube 上限 100 字符）

**A（推荐，65 字符）**
```
AI Selection Translator — select text, right-click, read Chinese
```

**B（63 字符）**
```
Translate any web page into Chinese — AI Selection Translator
```

**C（67 字符）**
```
AI Selection Translator: text, whole blocks and images, translated
```

**D（78 字符，想带上 Chrome 字样时用；搜索结果里会被截断）**
```
AI Selection Translator — select text, right-click, read Chinese (Chrome demo)
```

挑选理由：YouTube 搜索结果的标题大约 70 字符后截断（按字符硬截，会切在词中间），
所以 A/B/C 都刻意控制在 70 以内，任何位置都不会被切得难看；D 更完整但会被截断。
A 把「选中 → 右键 → 读中文」这个核心动作放在最前面，最贴合视频里演示的东西。

---

## Description

```
Select any foreign text on a web page, right-click, and the Chinese translation streams
into a centered popup. No tab switching, no copy-paste, no leaving the page.

AI Selection Translator is an open-source Chrome extension (Manifest V3) that translates
web page text into Chinese using ChatGPT, DeepSeek, or DeepL.

WHAT YOU SEE IN THIS 43-SECOND DEMO
• Selecting a sentence on an article page — a small translate button appears next to the selection
• The translation streaming in token by token inside a centered, draggable popup
• Expanding the original text for side-by-side reading
• Switching providers (ChatGPT ⇄ DeepSeek) and re-translating in one click
• Translating a whole block in place — hover a paragraph, click, and it turns Chinese
• Translating text inside an image: it reads the text, finds its position, and overlays the
  translation where the original was

FEATURES
• Selection translation — works on any page, including input fields and iframes
• Block translation — mark a region once, and matching elements get a translate button
• Image translation — for photos, screenshots and memes
• Streaming output, light/dark theme, keyboard shortcut (⌘⇧Y on macOS / Alt+Shift+T elsewhere)
• Three providers — ChatGPT (OpenAI), DeepSeek, DeepL — switchable at any time
• Stays out of the way: it skips text that is already Chinese, so the menu only appears
  when translating actually makes sense

PRIVACY
• Your API key is stored locally in chrome.storage.local — never synced, never sent anywhere else
• Requests go only to the provider you picked, with your own key
• No servers, no analytics, no tracking, no account

NOTE
• The extension's UI is in Chinese and it translates into Simplified or Traditional Chinese —
  that is what it was built for.
• The translation output in this demo was pre-recorded so the video is reproducible; the
  extension, its streaming pipeline and every interaction shown are the real thing.

LINKS
• Chrome Web Store: [add the link after publishing]
• Website: https://huaci.app/
• Source code (GPL-3.0): https://github.com/csswork/AiTranslation
• Privacy policy: https://huaci.app/privacy.html
• Issues and feedback: https://github.com/csswork/AiTranslation/issues

CHAPTERS
0:00 Intro
0:10 Streaming translation, side-by-side original, provider switch
0:20 Translating a whole block in place
0:30 Image translation, then where your API key lives

#ChromeExtension #Translation #AI
```

### 章节说明

YouTube 的硬规则是：第一条必须从 `0:00` 开始、每条至少 10 秒、至少 3 条。
42 秒的片子要同时满足「≥3 条」和「每条 ≥10 秒」，只能切成 `0:00 / 0:10 / 0:20 / 0:30` 这四刀——
再细就会出现不足 10 秒的章节，YouTube 会直接忽略整段章节。所以上面这组时间是卡着规则下限来的，
标签也按各时间点实际在演什么来写。如果觉得没必要，**整段 CHAPTERS 删掉即可**，不影响其他内容。

---

## Tags（YouTube 标签框，全部加起来不超过 500 字符）

```
chrome extension, translate to chinese, selection translator, web page translator,
ai translation, chatgpt, deepseek, deepl, browser extension, manifest v3,
image translation, ocr translation, read chinese, learn chinese, productivity,
open source, 划词翻译, 网页翻译, 翻译扩展, 学中文
```

---

## 其余字段

| 字段 | 建议值 |
| --- | --- |
| 可见性 | Public |
| 播放列表 | 可新建 "AI Selection Translator" |
| 语言 | English (video language)，字幕留空即可（画面里已烧中文字幕） |
| 类别 | Science & Technology |
| 儿童内容 | No, it's not made for kids |
| 评论 | 建议开启（Issues 之外的反馈渠道） |
| 缩略图 | 可选：直接截 0:05 那一帧（弹窗 + 流式译文），或另做一张 |
