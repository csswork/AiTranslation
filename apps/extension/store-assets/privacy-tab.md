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
the user’s chosen language. That single purpose covers the four ways a user can pick the text — a text selection,
a page region the user has marked, text inside an image the user right-clicks, or text typed
into the extension's own translation panel. The extension does nothing else: it does not
replace the new tab page, manage bookmarks, block ads, inject its own content, or collect
analytics.
```

**中文 — 直接粘贴：**

```
本扩展只有一个用途：把用户在网页上选中的文字译成其选择的语言。这一个用途涵盖用户挑出文字的四种方式——
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
The extension's entry points live in the right-click menu: "Translate to …" (selected text),
"Add a translate button for this region" (page element), "Translate text in this image" (image),
"Translate entire PDF" (shown only in Chrome's built-in PDF viewer), and "Live video captions
(experimental)" (shown only after the user turns on that experimental feature). The extension
creates these items and updates their labels and visibility to follow the user's target
language, selected provider and the current page.
```

**中文**

```
扩展的入口都在右键菜单里：「翻译成…」（选中的文字）、「为这个区域添加翻译按钮」（网页元素）、
「翻译图片里的文字」（图片）、「翻译整个 PDF」（只在 Chrome 内置 PDF 阅读器里出现）、
「视频实时字幕（实验）」（只在用户打开这个实验功能后出现）。扩展需要创建这些菜单项，并按用户的
目标语言、所选平台和当前页面更新它们的标题与显隐。
```

### `storage`

**EN**

```
Keeps the extension's state on the user's own device in chrome.storage.local: preferences
(target language, provider, model, feature toggles), the user's own API keys if they use that
mode, the per-domain element translation rules they create, and — for the hosted translation
mode — the sign-in token issued by our account service plus a cached copy of the account status
shown in the popup (username, credits, subscription). chrome.storage.session temporarily holds
the PKCE verifier during sign-in and which tabs are PDF viewers; it is cleared when the browser
closes. Nothing is synced through a Chrome account. API keys never leave the device except in
requests to the provider the user chose; the sign-in token is sent only to our own account API
at app.huaci.app.
```

**中文**

```
扩展的状态都通过 chrome.storage.local 保存在用户自己的设备上：偏好设置（目标语言、平台、模型、
各项开关）；用户选择自带 Key 时的 API Key；用户按域名创建的元素翻译规则；以及托管翻译模式所需的、
由我们账户服务签发的登录令牌，和弹窗里显示的账户状态缓存（用户名、点数、订阅）。
chrome.storage.session 只在登录过程中临时存放 PKCE 校验值，并记录哪些标签页是 PDF 阅读器，
浏览器关闭即清除。这些数据都不随 Chrome 账号同步。API Key 只随请求发往用户选定的平台；
登录令牌只发给我们自己的账户 API（app.huaci.app）。
```

### `scripting`

**EN**

```
Used to inject the extension's own content script (the same files declared in the manifest;
nothing is fetched remotely) in two situations: (1) once, right after the extension is installed
or updated, into tabs that were already open, so the translate button works without reloading
the page; (2) on demand into the current tab when the user triggers a translation or adds an
element rule and the script is missing.
```

**中文**

```
用于注入扩展自己的内容脚本（就是 manifest 里声明的那几份文件，不从远程加载任何代码），
只有两种时机：(1) 扩展安装或更新后立即执行一次，给已经打开的标签页补注入，让用户不用刷新
页面就能看到翻译按钮；(2) 用户触发翻译或添加元素规则、而当前标签页还没有脚本时，按需注入。
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

### Host permissions: `https://app.huaci.app/*`, `https://huaci.app/*`, `https://www.huaci.app/*`, `http://localhost/*`

**EN**

```
app.huaci.app is our own account service, used only for the optional hosted translation mode:
signing in, the guest trial, checking credits and subscription, and sending the text or image
the user chose to translate. huaci.app and www.huaci.app are our website, whose header shows the
sign-in state. On these sites a small content script only tells the extension to re-check the
sign-in state, and after the user signs out of the extension, it uses the tab URLs to find our
own pages and asks them to refresh their sign-in state; no account data or cookies are passed.
http://localhost is used only by the unpacked development build to reach a local backend; the
published extension never contacts it.
```

**中文**

```
app.huaci.app 是我们自己的账户服务，只用于可选的托管翻译模式：登录、访客试用、查询点数与订阅，
以及发送用户选择翻译的文字或图片。huaci.app 与 www.huaci.app 是我们的官网，页头显示登录状态。
在这些站点上，一个小的内容脚本只负责通知扩展重新核对登录状态；用户在扩展里退出后，扩展按标签页
的网址找到我们自己的页面，提示它们刷新登录状态，不传递账号数据或 Cookie。http://localhost 只供
未打包的开发版连接本机后台，商店发布的版本不会访问。
```

### Host permission `<all_urls>`（`host_permissions` 与内容脚本都声明了它，后台通常显示为 "Read and change all your data on all websites"）

**EN**

```
Four reasons. (1) The user may select text on any page they read, so the extension has to be
present on any page. (2) Chrome decides which context menu items to show at the moment of the
right-click, so the selection must be evaluated before it — to filter selections containing no letters while keeping every source language available. (3) Element translation rules are stored per domain
and can point at any site the user chooses. (4) chrome.scripting.executeScript requires host
permission for the tab, so right after an install or update the extension can inject the same
content script into tabs that are already open; without it those pages show no translate button
until reloaded. The content script only reads the current selection
or the text of an element the user explicitly marked, sends it to the extension's own service
worker, and does nothing else — it never scans, uploads or reports page content on its own.
```

**中文**

```
四个原因。(1) 用户可能在任何他正在阅读的网页上划词，所以内容脚本必须存在于任意页面。
(2) Chrome 是在右键按下的那一刻决定菜单项显隐的，因此在右键之前过滤纯数字、标点或表情组成的选区，任意语言的文字都保留翻译入口。(3) 元素翻译规则按域名保存，可以指向用户选择的任意站点。(4) chrome.scripting.executeScript
需要对应站点的主机权限：安装或更新后，扩展靠它给已经打开的标签页补注入同一份内容脚本，否则这些
页面要刷新后才会出现翻译按钮。内容脚本只读取
当前选区、或用户明确标记过的元素内的文字，并把它交给扩展自己的 service worker，此外不做任何事
——它不会自行扫描、上传或上报页面内容。
```

### Optional host permission `https://*/*`

**EN**

```
Kept for the custom API base URL (a proxy or relay) a user may enter in the advanced settings.
Because the host permissions already include <all_urls>, Chrome normally shows no prompt; one
appears only if the user has restricted the extension's site access, and then only for that one
origin, when they click "Test connection".
```

**中文**

```
保留给高级设置里的自定义接口地址（代理或中转）。由于主机权限已经包含 <all_urls>，Chrome
通常不会再弹出授权；只有用户自己限制了扩展的站点访问时，才会在点击「测试连接」时弹出，
而且只申请那一个域名。
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

### 4.3 发布时提示「you must certify that your data usage complies…」

这三个框是**发布的硬性前置条件**，空着就发不出去。报错原文：

> To publish your item, you must certify that your data usage complies with our Developer Program
> Policies. You can certify this on the Privacy practices tab of the item edit page.

处理顺序：

1. 回到这一页拉到底，三个框全勾；
2. **点页面底部的「保存」**——这是最常漏的一步，勾完不保存等于没勾；
3. 再回去点「提交审核」。

保存后仍然报同一句话时，按顺序排查：

- 本页还有别的必填项没填完：单一用途、每一项权限的理由、远程代码那栏的 Justification、
  隐私权政策网址（`https://www.huaci.app/privacy.html`）。上面几节都有现成文案。
- 后台没刷新：退出重进或强制刷新一次，保存结果有时要等一两分钟。
- 该商品是政策更新前创建的：即使以前发过版本，也需要在新版政策下重新认证一次。

---

## 5. 隐私权政策网址（Privacy policy URL）

**填这个：**

```
https://www.huaci.app/privacy.html
```

`../../web/public/privacy.html` 已经做好（中英双语，沿用落地页样式），push 之后 Vercel 会自动部署。

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
| `<all_urls>` 加 8 条具体站点（本机开发、用户端、官网、四个翻译平台）的 host permission，另有可选 `https://*/*` | `manifest.json` 的 `host_permissions` / `optional_host_permissions` |
| 内容脚本跑在所有站点 | `manifest.json` 的 `content_scripts.matches = ["<all_urls>"]` |
| `activeTab` 确实必要（不是多余权限） | `src/background.js` 的 `ensureContentScript()` 用 `chrome.scripting.executeScript` 补注入；安装或更新时给已打开标签页的补注入靠 `host_permissions` 里的 `<all_urls>`（实测只有内容脚本的 `<all_urls>` 时 executeScript 会报「must request permission」）；用户把扩展的站点访问限制为「点击时」后，仍要靠右键/快捷键触发时拿到的临时权限才能补注入 |
| 自定义地址是按具体 origin 申请，不是整站授权 | `src/options/options.js` 的 `chrome.permissions.request({ origins: [origin] })`，在「测试连接」点击里调用 |
| 唯一出网位置 | `grep -rn "fetch(" src/` 只有 `src/lib/providers.js` 两处（OpenAI 兼容接口 + DeepL） |
| 无远程代码 | `src/` 内无 `eval(` / `new Function(`；MV3 亦不允许远程托管脚本 |
| Key 与偏好只在本机 | `src/lib/settings.js` 读写 `chrome.storage.local`；`manifest` 未申请任何同步相关能力 |
