# huaci.app 宣传站的多语言

中文页面（`docs/*.html`）是**唯一的源**。改完中文跑一次构建，英文页、`sitemap.xml`、`lang.js`
会一起重新生成；忘了跑也不会漏到线上——`test/i18n.mjs` 会把「产物落后于中文源」判成测试失败。

## 命令

```bash
node i18n/build.mjs                 # 抽取中文段 + 生成所有启用的语言 + sitemap.xml + robots.txt + lang.js
node i18n/build.mjs --check         # 只检查：缺译、译文过期、产物没同步（CI / 提交前跑）
node i18n/build.mjs --coverage      # 检查中文页里有没有漏抽的段（新写的中文没被任何段覆盖时会报出来）
node i18n/build.mjs --locale en     # 只重新生成某一个语言
node i18n/build.mjs --extract       # 只把中文段抽到 i18n/zh-Hans.json
```

## 目录

```
i18n/
  locales.json        语言清单：code、路径前缀、label、hreflang、浏览器语言匹配、是否启用
  build.mjs           工具本体（无第三方依赖）
  lang.template.js    docs/lang.js 的模板（含语言数据后生成）
  zh-Hans.json        中文段 = 源文，由 --extract 维护，不要手改
  _index.json         每条中文段出现在哪些页 / 什么标签里（翻译时的上下文）
  en.json             英文译文：键 = 中文原文，值 = 同结构的目标语言 HTML
```

## 段的约定

- **文本段**：叶子级元素的 innerHTML 整段翻译。行内标签（`<a>`、`<span class="mono">`）留在字符串里，
  这样译文可以调整语序而链接不丢；`class`/`href` 不要改。
- **属性段**：以 `@` 开头，白名单是 `title`、`aria-label`、`alt` 与几个 meta（description、og:*）。
- **不翻译**：`<svg>` 子树（首屏示意图是产品截图，保持产品原貌）、HTML 注释、`class`/`href`/`style` 等属性。
- 中文改一个字，旧键消失、新键出现，`--check` 会点名要重译哪几段；孤儿译文也要清（`--check` 会报）。

## 加一种语言

1. 在 `i18n/locales.json` 里补一条（`code`、`path`、`label`、`htmlLang`、`ogLocale`、`match`、`auto`、`switchLabel`），先留 `enabled: false`。
2. 生成译文：`node i18n/build.mjs --translate ja`（需要 `HUACI_TRANSLATE_KEY`，或 `OPENAI_API_KEY` / `DEEPSEEK_API_KEY`；
   也可以用任何方式把 `zh-Hans.json` 的键填进 `i18n/ja.json`）。
3. 把 `enabled` 改成 `true`，跑 `node i18n/build.mjs`，再跑 `bash test/run.sh`。

`--translate` 只补缺失的段，已译的不会覆盖；批次间随时中断也不会丢（每批写完即落盘）。

## 访客怎么看到自己语言的版本

`docs/lang.js`（由 `lang.template.js` 生成）在 `<head>` 里同步加载：

1. `localStorage.lang` 里选过 → **以选择为准**；没选过 → 按 `navigator.languages` 猜（认不出落到 `en`）。
2. 发现语言不一致就 `location.replace` 到同一页的对应语言（路径保留，`/privacy.html` → `/en/privacy.html`）。
3. 导航右上角的下拉里可以手动选；选「自动」= 清掉记录，回到跟随浏览器。
4. **爬虫与无头浏览器不跳转**：Googlebot 的 `Accept-Language` 是 en-US，跟着跳会让中文原文（`x-default`）
   在索引里消失。404 页带 `data-lang-home`，按语言把访客送回该语言首页。

`hreflang`（含 `x-default` → 中文）写在每个页面的 head 里，由构建维护；`sitemap.xml` 里也带一份。

## 还没做的

- 扩展本体（`src/`）仍然是中文单语；商店列表、隐私政策 Markdown、README 的英文版也另说。
- `i18n/locales.json` 里已列出的 zh-Hant / ja / ko / es / pt / fr / de / ru / ar 尚未翻译（`enabled: false`）。
  阿拉伯语是 RTL，启用前要先过一遍 `[dir="rtl"]` 的样式。
