# Chrome 网上应用店 · 「隐私权规范」标签页填写指引

后台这一页分五块（官方文档：`developer.chrome.com/docs/webstore/cws-dashboard-privacy`）：

1. 说明扩展程序的**单一用途**
2. 列出所有**权限并说明理由**（按 manifest 自动生成）
3. 声明**远程代码**
4. **认证数据使用做法**（数据类型复选框 + 三项声明）
5. 设置**隐私权政策网址**

下面每一块都给了可直接粘贴的文案。**语言怎么选**：官方文档没有规定这两栏必须用英文，
中文提交同样有效；区别只在于读者——「单一用途」和「权限理由」是给审核人看的，
英文能少一层理解成本，「商品详情」是给用户看的，面向中文用户就写中文。
两种语言的可粘贴版本都在下面。所有判断都对着代码核过，依据见文末。

---

## 1. 单一用途说明（Single purpose）

**EN — 直接粘贴：**

```
AI Selection Translator has one purpose: translating text the user selects on a web page into
Chinese. That single purpose covers the four ways a user can pick the text — a text selection,
a page region the user has marked, text inside an image the user right-clicks, or text typed
into the extension's own translation panel. The extension does nothing else: it does not
replace the new tab page, manage bookmarks, block ads, inject its own content, or collect
analytics.
```

**中文 — 直接粘贴：**

```
本扩展只有一个用途：把用户在网页上选中的文字译成中文。这一个用途涵盖用户挑出文字的四种方式——
划选一段文字、标记过的页面区域、右键的一张图片、以及在扩展自带翻译面板里输入的文字。
除此之外它什么都不做：不替换新标签页、不管理书签、不拦截广告、不注入自己的内容、不做任何统计。
```

> 审阅人最在意的是「窄且易懂」。这段刻意用「只有一个用途 + 四种挑字方式 + 明确排除清单」的结构，
> 把「图片识别」「区域翻译」提前归到主用途之下，避免被当成多用途扩展。

---

## 2. 权限理由（每项一个输入框）

> 两种语言任选一种填。英文放在前、中文放在后，按你的后台界面语言择一即可。

### `activeTab`

**EN**

```
Granted only when the user invokes the extension — picking an entry from the right-click menu
or pressing the keyboard shortcut. It gives temporary access to that one tab, which is what
allows chrome.scripting.executeScript to inject the content script into a page that was
already open when the extension was installed or updated. The extension never gains access to
any other tab, and never acts without a user gesture.
```

**中文**

```
只在用户主动触发扩展时授予——点右键菜单里的翻译项，或按快捷键。它给的是当前这一个标签页的临时
权限，用于通过 chrome.scripting.executeScript 给「安装/更新扩展之前就已经打开的页面」补注入内容
脚本。扩展拿不到其他标签页的权限，也不会在没有用户操作的情况下自行运行。
```

### `contextMenus`

**EN**

```
All four entry points are right-click menu entries: "Translate to Chinese" (selection),
"Add a translate button for this region" (page), and "Translate text in this image" (image).
The extension creates these items and updates their labels and visibility to follow the user's
target language and selected provider.
```

**中文**

```
四个入口全部是右键菜单项：「翻译成中文」（划词）、「为这个区域添加翻译按钮」（页面）、
「翻译图片里的文字」（图片）。扩展需要创建这些菜单项，并按用户设置的目标语言和所选平台
更新它们的标题与显隐。
```

### `storage`

**EN**

```
Stores everything on the user's own device through chrome.storage.local: the user's API key,
their preferences (target language, model, feature toggles), and the per-domain element
translation rules they create. Nothing here is synced through a Chrome account and nothing is
uploaded — the extension operates no server.
```

**中文**

```
所有数据都通过 chrome.storage.local 保存在用户自己的设备上：API Key、偏好设置（目标语言、
模型、各项开关），以及用户自己创建的元素翻译规则（按域名）。这些数据不随 Chrome 账号同步、
不会上传——本扩展不运营任何服务器。
```

### `scripting`

**EN**

```
Used to inject the content script on demand into the current tab, for pages that were already
open before the extension was installed or updated. Injection only happens after the user
triggers a translation or adds an element rule; the extension never injects into pages the user
is not acting on.
```

**中文**

```
用于按需向当前标签页注入内容脚本，服务对象是「安装或更新扩展之前就已打开」的页面。注入只在
用户触发翻译或添加元素规则之后发生；扩展不会向用户没有操作的页面注入任何脚本。
```

### Host permissions: `https://api.openai.com/*`, `https://api.deepseek.com/*`, `https://api-free.deepl.com/*`, `https://api.deepl.com/*`

**EN**

```
Needed to send the translation request to the AI provider the user selected in the settings.
The extension ships with ChatGPT (OpenAI), DeepSeek and DeepL; only the selected provider is
ever contacted, requests carry the user's own API key, and no request is made unless the user
triggers a translation. DeepL has two hostnames because its free and paid keys use different
endpoints.
```

**中文**

```
用于把翻译请求发往用户在设置里选定的 AI 平台。扩展内置 ChatGPT（OpenAI）、DeepSeek、DeepL
三家；任何时候只会访问用户选中的那一家，请求携带用户自己的 API Key，且只有用户主动触发翻译时
才会发出。DeepL 占两个域名，是因为它的免费版与付费版端点不同。
```

### Host permission（来自内容脚本的 `<all_urls>`，后台通常显示为 "Read and change all your data on all websites"）

**EN**

```
Three reasons. (1) The user may select text on any page they read, so the extension has to be
present on any page. (2) Chrome decides which context menu items to show at the moment of the
right-click, so the selection must be evaluated before it — to know whether the text is already
Chinese and hide the menu item when it is. (3) Element translation rules are stored per domain
and can point at any site the user chooses. The content script only reads the current selection
or the text of an element the user explicitly marked, sends it to the extension's own service
worker, and does nothing else — it never scans, uploads or reports page content on its own.
```

**中文**

```
三个原因。(1) 用户可能在任何他正在阅读的网页上划词，所以内容脚本必须存在于任意页面。
(2) Chrome 是在右键按下的那一刻决定菜单项显隐的，因此必须在右键之前判断选区内容是不是中文，
是中文时隐藏该菜单项。(3) 元素翻译规则按域名保存，可以指向用户选择的任意站点。内容脚本只读取
当前选区、或用户明确标记过的元素内的文字，并把它交给扩展自己的 service worker，此外不做任何事
——它不会自行扫描、上传或上报页面内容。
```

### Optional host permission `https://*/*`

**EN**

```
Only requested if the user enters a custom API base URL (a proxy or relay) in the advanced
settings; Chrome shows the permission prompt when they click "Test connection". The extension
requests that one specific origin — not all sites — and users behind a corporate relay could
not use the extension without it.
```

**中文**

```
仅当用户在高级设置里填写自定义接口地址（代理或中转）时才会申请；授权弹窗在用户点击
「测试连接」时出现。扩展申请的是那一个具体域名，而不是所有网站；没有它，处在企业代理后面的
用户无法使用本扩展。
```

## 3. 远程代码（Remote code）

**选 "No, I am not using remote code."** —— 这一条对本扩展是明确成立的。

**Justification 输入框（截图里带 `*`、上限 1,000 字符）：**

EN — 直接粘贴（约 460 字符）：

```
All of the extension's code is included in the uploaded package and runs under the default
Manifest V3 content security policy (script-src 'self'). The package contains no eval(), no
new Function(), no dynamic import(), no remotely hosted script, and no external script
references. The only thing fetched at runtime is the selected AI provider's response body —
plain text or JSON carrying the translation — which is parsed as data and rendered into the
DOM. It is never evaluated as code.
```

中文 — 直接粘贴：

```
扩展的全部代码都随包一起提交，运行在 Manifest V3 默认的内容安全策略（script-src 'self'）之下。
包内没有 eval()、没有 new Function()、没有动态 import()，没有任何远程托管的脚本，也没有对站外
脚本的引用。运行时唯一从网络取回的是所选模型接口的响应体——承载译文的纯文本或 JSON——它只作为
数据被解析并渲染进 DOM，绝不会作为代码执行。
```

**关于那个 `*`**：选中 "No" 之后这个框是否仍然强制填写，后台各个版本表现不一致——
有的会把它变灰，有的仍要求填。反正上限 1,000 字符，上面这段 460 字符，**直接填上最稳**，
不会因为一个空框卡住提交。

**为什么可以理直气壮选 No（都已核对）：**

| 核对项 | 结果 |
| --- | --- |
| `eval(` / `new Function(` / 动态 `import(` | `grep -rn` 全项目无结果 |
| 远程托管的 JS、CDN 脚本、外链 `<script>` | 无；`manifest.json` 里没有 `web_accessible_resources`，也没有任何外部脚本引用 |
| 内容安全策略 | 未自定义，走 MV3 默认的 `script-src 'self'`，浏览器层面就不允许执行远程代码 |
| 运行时从网络取回的东西 | 只有模型接口的响应体（译文文本），走 `JSON.parse` / SSE 解析后渲染，不进入执行路径 |
| 第三方 SDK | 无，`src/` 内无 `XMLHttpRequest` / `WebSocket` / `sendBeacon` / `EventSource` |

---

## 4. 数据使用（Data usage）

### 4.1 数据类型复选框

> 后台那组复选框的措辞偶有调整，以后台实际显示为准；判定原则不变：**「handle」= 收集、传输、使用或共享**，
> 而且官方 FAQ 第 3 条明确——**只在本机处理/存储的数据同样必须披露**。

| 复选框 | 勾选 | 依据 |
| --- | --- | --- |
| **Website content**（网站内容） | ✅ **必勾** | 用户划选的文字、区域内的文字、右键的图片，会被抓取并通过 HTTPS 发往用户选定的大模型平台。官方 FAQ 把「从用户访问的网站上剪取/抓取内容，例如截图或从网页抓取数据」列为典型的 handle 行为 |
| **Authentication information**（身份验证信息） | ✅ **建议勾** | API Key 是用户的凭据：存在 `chrome.storage.local`，并放进 `Authorization` 请求头发往用户选定的平台。官方 FAQ 第 3 条要求「仅本机存储也要披露」，勾上更稳妥 |
| Personally identifiable information | ❌ | 不读姓名、邮箱、账号等任何身份字段；不要求注册登录 |
| Health information | ❌ | 不涉及 |
| Financial and payment information | ❌ | 不涉及；扩展自身不收费、不接触支付信息 |
| Location | ❌ | 不请求定位权限，也不推断位置 |
| Web history | ❌ | 不调用 `chrome.history`，不读取标签页列表或访问过的网址。域名只出现在用户自己创建的元素规则里，属于本机设置 |
| User activity | ❌ | 不记录点击、滚动、停留等行为，没有埋点 |
| Personal communications | ❌（边界项，见下） | 产品不针对邮件/聊天做任何处理；用户若恰好在邮件页面上划词，那属于「网站内容」的范畴，已在隐私政策里说明「只有你主动触发翻译时内容才会发出」 |

**关于 Personal communications 这个边界项**：如果审阅人就「用户可能在 webmail 页面上划词」提出质疑，
回答的口径是——扩展不区分页面类型、不解析邮箱或联系人、不读取会话列表，只在用户主动选中某段文字并要求翻译时，
把那段文字原样转交给用户自己配置的平台；这属于单一用途内的、由用户明示触发的处理，而不是「收集个人通信」。
不勾的理由是：按设计它不采集通信数据，勾了反而与隐私政策描述不符。

### 4.2 三项声明（全部可以勾选）

```
☑ I do not sell or transfer user data to third parties, outside of the approved use cases.
☑ I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
☑ I do not use or transfer user data to determine creditworthiness or for lending purposes.
```

第一条是可勾的，理由要说清楚，免得自己心虚：内容是**由用户主动触发**、发往**用户自己配置并用自己的 Key 鉴权的平台**，
属于「提供或改进单一用途功能」这一 approved use case；扩展本身既不收集也不转售任何数据，
作者没有服务器、拿不到这些内容。这一点隐私政策里写得很直白，两边口径一致。

---

## 5. 隐私权政策网址（Privacy policy URL）

**填这个：**

```
https://www.huaci.app/privacy.html
```

`docs/privacy.html` 已经做好（中英双语，沿用落地页样式），push 之后 Vercel 会自动部署。

为什么是 `www` 开头：`huaci.app` 会 308 永久跳转到 `www.huaci.app`，
而页面本身受同样的路由规则影响，所以带 `www` 的这个地址是**直接返回 200** 的最终地址；
`https://huaci.app/privacy.html` 也能用，只是多一跳。

> 站点没开 `cleanUrls`，`.html` 必须带上——`/privacy` 会 404，这也和站内其他页面
> （`/changelog.html`）保持一致。

**部署后自查两条：**

1. 浏览器打开 `https://www.huaci.app/privacy.html`，确认不是 404；
2. 落地页与更新日志页脚里的「隐私政策」链接，现在都指向站内页面，点一下确认能通。

## 6. 提交前必须先修的 3 处不一致

这三处不改，隐私政策、商店披露和实际行为会对不上：

1. **PRIVACY.md 只写了 OpenAI 与 DeepSeek，漏了 DeepL。**
   但 manifest 里有 `api-free.deepl.com` / `api.deepl.com` 两条 host permission，
   设置页和弹窗里也摆着 DeepL 卡片，后台的权限列表一定会出现这两个域名。
   → 政策里「会发送出去的内容」那句要改成三个平台，并补 DeepL 的隐私政策链接。

2. **落地页和 PRIVACY.md 的权限表都漏了 DeepL 的域名与「自定义接口地址」这一项。**
   → 权限说明表补两行：DeepL 两个域名、以及可选的自定义接口地址授权。

3. **选项页里没有任何隐私政策入口。**
   不违规，但审阅人和用户都会顺手找。
   → 建议在 `src/options/options.html` 底部加一行链接到政策页，改动极小。

（另：落地页「整个项目只有一处 `fetch` 调用」应为两处，都在 `src/lib/providers.js` —— 详见 `store-listing.md`。）

---

## 7. 事实依据（写这份文案时核对过的）

| 结论 | 依据 |
| --- | --- |
| 权限清单就是 activeTab / contextMenus / scripting / storage | `manifest.json` 的 `permissions` |
| 四个 host permission + 可选 `https://*/*` | `manifest.json` 的 `host_permissions` / `optional_host_permissions` |
| 内容脚本跑在所有站点 | `manifest.json` 的 `content_scripts.matches = ["<all_urls>"]` |
| `activeTab` 确实必要（不是多余权限） | `src/background.js` 的 `ensureContentScript()` 用 `chrome.scripting.executeScript` 补注入；只有用户在右键/快捷键触发时拿到该标签页的临时权限才能成功，这也是我们实测时 executeScript 在无授权页面上报「must request permission」的原因 |
| 自定义地址是按具体 origin 申请，不是整站授权 | `src/options/options.js` 的 `chrome.permissions.request({ origins: [origin] })`，在「测试连接」点击里调用 |
| 唯一出网位置 | `grep -rn "fetch(" src/` 只有 `src/lib/providers.js` 两处（OpenAI 兼容接口 + DeepL） |
| 无远程代码 | `src/` 内无 `eval(` / `new Function(`；MV3 亦不允许远程托管脚本 |
| Key 与偏好只在本机 | `src/lib/settings.js` 读写 `chrome.storage.local`；`manifest` 未申请任何同步相关能力 |
