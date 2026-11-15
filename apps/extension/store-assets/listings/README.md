# 2.2.0 商店长介绍 · 24 种语言

每个 `.txt` 文件都是完整长介绍，可直接复制到商店后台对应语言的“详细说明”字段。包含英文原稿及其余 23 种语言的译文。

这些是商店上架文案，与扩展安装包内的名称、简短描述和界面语言文件分别维护。本目录不会进入扩展 ZIP。

## 语言索引

| 语言 | 文件 | 扩展语言标识 |
| --- | --- | --- |
| 简体中文 | [zh-Hans.txt](zh-Hans.txt) | zh-Hans |
| 繁體中文 | [zh-Hant.txt](zh-Hant.txt) | zh-Hant |
| English · 英语 | [en.txt](en.txt) | en |
| Español · 西班牙语 | [es.txt](es.txt) | es |
| Português · 葡萄牙语（巴西） | [pt.txt](pt.txt) | pt |
| Français · 法语 | [fr.txt](fr.txt) | fr |
| Deutsch · 德语 | [de.txt](de.txt) | de |
| Italiano · 意大利语 | [it.txt](it.txt) | it |
| Nederlands · 荷兰语 | [nl.txt](nl.txt) | nl |
| Русский · 俄语 | [ru.txt](ru.txt) | ru |
| Українська · 乌克兰语 | [uk.txt](uk.txt) | uk |
| Polski · 波兰语 | [pl.txt](pl.txt) | pl |
| Türkçe · 土耳其语 | [tr.txt](tr.txt) | tr |
| العربية · 阿拉伯语 | [ar.txt](ar.txt) | ar |
| עברית · 希伯来语 | [he.txt](he.txt) | he |
| فارسی · 波斯语 | [fa.txt](fa.txt) | fa |
| हिन्दी · 印地语 | [hi.txt](hi.txt) | hi |
| বাংলা · 孟加拉语 | [bn.txt](bn.txt) | bn |
| اردو · 乌尔都语 | [ur.txt](ur.txt) | ur |
| Bahasa Indonesia · 印度尼西亚语 | [id.txt](id.txt) | id |
| Tiếng Việt · 越南语 | [vi.txt](vi.txt) | vi |
| ไทย · 泰语 | [th.txt](th.txt) | th |
| 日本語 · 日语 | [ja.txt](ja.txt) | ja |
| 한국어 · 韩语 | [ko.txt](ko.txt) | ko |

这里的语言标识与扩展一致，不代表商店后台接受同名代码；在后台选择对应的语言即可。如果后台未提供某种语言的选项（例如乌尔都语），可将对应文案用于官网或其他发布渠道。

## 文案口径

- 产品名：划词 – AI 翻译与双语阅读（简体）、劃詞 – AI 翻譯與雙語閱讀（繁体）、其他语言为 Huaci – 加后半句译文；品牌 Huaci 不翻译，与扩展 `_locales` 的名称一致。
- 双语阅读作为重点放在最前（2.2.0 新功能），其后是点词换说法与用词偏好、六种翻译方式、24 种语言。
- 两种用法：免 Key 的点数翻译（安装即可试用、注册再送、点数不过期、每 500 个字符 1 点、失败不扣点、订阅无限使用）与自带 OpenAI / DeepSeek / DeepL Key。不写具体的试用额度和价格（可在管理端调整），以官网与用户中心为准。
- 隐私：只在主动触发时发送；自带 Key 直连平台；点数翻译经我们的服务器转给模型服务商、不保存内容；Key、用词偏好、保存的文章只在本机。
- 菜单项、按钮名称用扩展各语言界面里的实际文案（翻译时从 `i18n/<语言>.json` 取）。
- 视频字幕仍是默认关闭的实验功能；不承诺扫描版 PDF、托管音视频转写等未实现的功能。

Microsoft Edge 加载项商店另有一套带价格、支持邮箱等披露的说明，放在 [`../edge/`](../edge/)：英文原稿 `edge/en.txt`，其余语言由 `node edge/build-listings.mjs` 生成（`--check` 校验链接、价格与长度），提交资料见 `edge/submission.json`。

英文原稿为 `en.txt`，简体中文 `zh-Hans.txt` 同时作为对照。其余 22 种语言用 DeepSeek `deepseek-flash` 从英文翻译（附中文对照、扩展界面译名与品牌规则），逐个检查了段落标记、列表条数、链接、品牌名、旧名残留和非中日文里的汉字；未经过母语人工审校。繁体中文另外人工改正了两处简体字。
