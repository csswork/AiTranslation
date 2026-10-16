# Privacy Policy / 隐私政策

**AI Selection Translator (AI 划词翻译)**
Last updated / 最后更新：2026-10-16

[English](#english) · [中文](#中文) · Web: <https://huaci.app/privacy.html> · Terms: <https://huaci.app/terms.html>

---

## English

### In one sentence

Accounts, credits and subscriptions are planned for version 2.0.0 and are not yet publicly available. This policy also describes how those services will process data once launched.

AI Selection Translator works in two ways. **Bring your own key**: what you translate goes straight to the AI provider you configured, never through us. **Credit translation**: the text passes through our server to a model provider, and our server **does not store the original or the translation**. For accounts, billing, and abuse prevention we keep only what is needed to run the service; nothing is used for advertising or sold.

### What is sent when you translate

Only when **you actively trigger a translation** (context menu, keyboard shortcut, or a translate button) is the following sent over HTTPS:

| Content | When | With your own key, sent to | With credit translation, sent to |
| --- | --- | --- | --- |
| The text you selected | Selection translation | Your chosen provider | Our server, then a model provider |
| Text in a region you marked | Clicking that region's translate button | Same | Same |
| Text typed into the translation panel | Clicking Translate | Same | Same |
| Recognized video caption text | With video caption translation on | Same | Same |
| The image you choose to translate | Image translation | Your chosen vision provider | Our server, then DeepSeek |

With your own key you can use **OpenAI (ChatGPT)**, **DeepSeek**, or **DeepL**; requests go to `https://api.openai.com`, `https://api.deepseek.com`, and `https://api-free.deepl.com` (or `https://api.deepl.com` for a paid DeepL key).

Credit translation requests go to `https://app.huaci.app`, which forwards them to **DeepSeek**; when DeepSeek is unavailable, text translation uses the same model on **Fireworks AI** (US region) instead. Image recognition uses DeepSeek Flash. Images, recognized text and translations stay in memory only while the request is processed and are never written to a database or log.

How these providers handle what they receive is governed by their own privacy policies:

- OpenAI: [openai.com/policies/privacy-policy](https://openai.com/policies/privacy-policy)
- DeepSeek: [platform.deepseek.com/downloads](https://platform.deepseek.com/downloads/DeepSeek%20Privacy%20Policy.html)
- DeepL: [deepl.com/en/privacy](https://www.deepl.com/en/privacy)
- Fireworks AI: [fireworks.ai/privacy-policy](https://fireworks.ai/privacy-policy)

**Never sent**: page content you did not ask to translate, browsing history, cookies, or form data. Nothing is scanned or uploaded in the background.

### Audio processing for experimental video captions

Video captions are off by default. When enabled, speech from the current tab is recognized on your device by default, which may require a browser language pack. Only if you explicitly select cloud recognition is audio sent to Google's speech recognition service, governed by the [Google Privacy Policy](https://policies.google.com/privacy). Recognized caption text is then sent to your chosen translation provider or our server according to the translation mode. We do not receive or store video or audio, and do not offer hosted audio or video transcription.

### Account data

When you sign up or sign in, we keep:

- **Email and username**, for signing in, recovery, and contacting you. No name, avatar, or other profile data.
- **Sign-in methods**: with Google sign-in, only the Google account identifier and verified email.
- **Sessions**: only the type (website or extension) and times; no device model, location, or fingerprint.
- **Credits and subscription**: credit grants, deductions and refunds, subscription status, and order amount, currency, refund status, and billing country.

### Usage records

Each credit translation records the character count, credits charged, model and provider, input and output token counts, target and source language, latency, the outcome (success, failure, or rejection and why), and the **two-letter country code** supplied by our network provider. These records are used for billing, abuse prevention, and service statistics, and **contain no original text or translation**. You can see your own records under “Usage and credits” in your account.

### Preventing repeated free-trial claims

The extension claims free credits once after installation. To stop the same network or browser from claiming repeatedly, we keep a **one-way keyed hash** of the network address (never the address itself; for IPv6 only the first 64 bits are used), and a **random marker cookie** set on `app.huaci.app` by the welcome page (only its hash is stored). We do not use device fingerprinting.

### Payments

Subscriptions are processed by **Creem** as the Merchant of Record, which handles payment, taxes, and receipts. Card and payment details go directly to Creem; **we never see or store them**. We keep only Creem's subscription and order identifiers, status, amount, currency, and billing country. Creem's handling of your data is governed by its own privacy policy ([creem.io/privacy](https://www.creem.io/privacy)).

### Cookies

- **Session**: an HttpOnly cookie on `app.huaci.app` that keeps you signed in on the web.
- **Preferences**: language and color scheme (`lang`, `theme`), shared by the website and your account.
- **Browser marker**: see “Preventing repeated free-trial claims” above.

No advertising or third-party analytics cookies.

### What stays on your machine

The following is stored on **your device** via `chrome.storage.local` and is not synced through your Chrome account:

- **API key**: used only to authenticate requests to the provider you chose; never sent to us
- **Extension sign-in token**: sent only to `app.huaci.app`, for credit translation and account status
- **Preferences**: target language, model, feature toggles
- **Region translation rules**: the “domain + CSS selector” entries you added

You can clear all of it from the options page at any time, or uninstall the extension (which removes it all).

### Retention and deletion

Account, credit, order, and usage records are kept until you delete your account; transaction records that the law requires us to keep (for example for tax) are kept as required. To export or delete your account and related data, email [support@huaci.app](mailto:support@huaci.app); we will act within 30 days.

### What we do not do

- Store the text you translate or its translation
- Use advertising, telemetry, or third-party analytics SDKs
- Sell or rent your data, or use it for advertising
- Train models on what you translate

All extension and server source code is public under GPL-3.0, so you can verify the above: [github.com/csswork/AiTranslation](https://github.com/csswork/AiTranslation).

### Permissions

| Permission | Why |
| --- | --- |
| `contextMenus` | Provide the translate entries in the right-click menu |
| `storage` | Save the settings and sign-in token above on your machine |
| `scripting` | Inject the needed script into the current page when you trigger a translation |
| `activeTab` | Act only on the tab you are working in |
| `tabCapture`, `offscreen` | Read current-tab audio only when video captions are enabled; recognition is local by default, or sent to Google if you explicitly select cloud recognition |
| Access to `api.openai.com`, `api.deepseek.com`, `api-free.deepl.com`, `api.deepl.com` | Send translation requests to the provider you selected when using your own key |
| Optional access to your own API origin | Only if you enter a custom API base URL (a proxy or relay). Requested for that single origin when you click “Test connection”; never for all sites |
| Content script on all sites | Users may select text or mark a translation region on any page. Content scripts provide the controls and only filter selections containing no letters. |

### Contact

For questions or data requests, email [support@huaci.app](mailto:support@huaci.app), or open an issue at [GitHub Issues](https://github.com/csswork/AiTranslation/issues).

---

## 中文

### 一句话概括

账户、点数与订阅服务计划随 2.0.0 上线，目前尚未向公众开放。以下同时说明这些服务开放后的数据处理方式。

AI 划词翻译有两种用法。**自带 Key**：你要翻译的内容直接发往你自己配置的 AI 平台，不经过我们。 **点数翻译**：内容经我们的服务器转给模型服务商完成翻译，服务器**不保存原文和译文**。 账户、计费与防滥用只保留运行所必需的数据，不用于广告，也不出售。

### 翻译时会发送的内容

只有在你**主动触发翻译**时（右键菜单、快捷键、点击翻译按钮），以下内容才会通过 HTTPS 发送：

| 内容 | 发送时机 | 自带 Key 时发往 | 点数翻译时发往 |
| --- | --- | --- | --- |
| 你选中的文字 | 使用划词翻译时 | 你选择的平台 | 我们的服务器，再转给模型服务商 |
| 你指定区域内的文字 | 点击区域上的翻译按钮时 | 同上 | 同上 |
| 你在翻译面板输入的文字 | 点击翻译时 | 同上 | 同上 |
| 视频字幕的识别文字 | 开启视频字幕翻译时 | 同上 | 同上 |
| 你选择翻译的图片 | 使用图片翻译时 | 你选择的视觉平台 | 我们的服务器，再转给 DeepSeek |

自带 Key 可选 **OpenAI（ChatGPT）**、**DeepSeek** 与 **DeepL**，请求分别发往 `https://api.openai.com`、`https://api.deepseek.com`， 以及 DeepL 的 `https://api-free.deepl.com`（付费 Key 为 `https://api.deepl.com`）。

点数翻译的请求发往 `https://app.huaci.app`，由服务器转给 **DeepSeek**；DeepSeek 暂时不可用时，文字翻译改用 **Fireworks AI**（美国节点）上的同款模型。图片识别使用 DeepSeek Flash。图片、识别文字与译文只在处理请求时短暂停留在内存里，不写入数据库或日志。

这些平台如何处理收到的内容，适用它们各自的隐私政策：

- OpenAI：[openai.com/policies/privacy-policy](https://openai.com/policies/privacy-policy)
- DeepSeek：[platform.deepseek.com/downloads](https://platform.deepseek.com/downloads/DeepSeek%20Privacy%20Policy.html)
- DeepL：[deepl.com/en/privacy](https://www.deepl.com/en/privacy)
- Fireworks AI：[fireworks.ai/privacy-policy](https://fireworks.ai/privacy-policy)

**不会发送**：你没有主动翻译的页面内容、浏览历史、Cookie、表单数据。扩展不会在后台自动扫描或上传任何东西。

### 实验视频字幕的声音处理

视频字幕默认关闭。开启后，默认在本机识别当前标签页的声音，可能需要下载浏览器语言包；只有你主动选择「改用云端识别」时，声音才会发送到 Google 的语音识别服务，适用 [Google 隐私政策](https://policies.google.com/privacy)。识别后的字幕文字再按所选翻译模式发送给翻译平台或我们的服务器。我们不接收或保存视频、音频，不提供托管音视频转写。

### 账户数据

注册或登录后，我们保存：

- **邮箱与用户名**——用于登录、找回和联系你。不保存姓名、头像或其他资料。
- **登录方式**——用 Google 登录时只保存 Google 账户的标识与已验证的邮箱。
- **登录会话**——只记录类型（网站或扩展）和时间，不记录设备型号、位置或设备指纹。
- **点数与订阅**——点数的发放、扣除与返还记录，订阅状态，以及订单的金额、币种、退款状态和账单国家。

### 使用记录

每次点数翻译会记录：字数、扣除的点数、模型与服务商、输入和输出的 token 数、目标语言与源语言、耗时、结果（成功、失败或被拒绝及原因）， 以及由网络服务商提供的**两位国家代码**。这些记录用于计费、防止滥用和服务统计，**不包含原文或译文**。 你可以在用户中心的「用量与点数」里查看自己的记录。

### 免费试用的防重复领取

安装扩展后会自动领取一次免费点数。为防止同一网络或同一浏览器反复领取，我们保存：网络地址经加密处理后的**不可还原摘要**（不保存地址本身，IPv6 只取前 64 位）， 以及欢迎页在 `app.huaci.app` 上写入的一个**随机标记 Cookie**（数据库里只存它的摘要）。我们不使用设备指纹。

### 付款

订阅付款由 **Creem** 作为经销商（Merchant of Record）处理，包括收款、税费与收据。银行卡等支付信息直接提交给 Creem，**我们看不到也不保存**。 我们只保存 Creem 提供的订阅与订单编号、状态、金额、币种和账单国家。Creem 如何处理你的数据，适用其隐私政策（[creem.io/privacy](https://www.creem.io/privacy)）。

### Cookie

- **登录会话**——`app.huaci.app` 上的 HttpOnly Cookie，用于保持网页登录。
- **偏好**——语言与配色（`lang`、`theme`），官网与用户中心共用。
- **浏览器标记**——见上文「免费试用的防重复领取」。

没有广告 Cookie，也没有第三方统计 Cookie。

### 只保存在你本机的内容

以下数据通过 `chrome.storage.local` 保存在**你这台设备上**，不走 Chrome 账号同步：

- **API Key**——仅用于在请求头中向你选择的平台鉴权，不会发给我们
- **扩展的登录令牌**——仅发给 `app.huaci.app`，用于点数翻译与账户状态
- **偏好设置**——目标语言、使用的模型、各项开关
- **区域翻译规则**——你手动添加的「域名 + CSS 选择器」

你可以随时在设置页清空这些数据，或直接卸载扩展（卸载会一并删除）。

### 保存期限与删除

账户、点数、订单与使用记录保存到你删除账户为止；法律要求保留的交易记录（例如税务）会按要求保留。 如需导出或删除你的账户及相关数据，请发邮件到 [support@huaci.app](mailto:support@huaci.app)，我们会在 30 天内处理。

### 我们不做的事

- 不保存你翻译的原文和译文
- 不使用广告、埋点或第三方统计 SDK
- 不出售、不出租你的数据，也不用于广告
- 不用你的翻译内容训练模型

扩展与服务端的全部源代码以 GPL-3.0 公开，可自行核实： [github.com/csswork/AiTranslation](https://github.com/csswork/AiTranslation)。

### 权限说明

| 权限 | 用途 |
| --- | --- |
| `contextMenus` | 在右键菜单提供翻译入口 |
| `storage` | 在本机保存上述设置与登录令牌 |
| `scripting` | 在你触发翻译时向当前页面注入所需脚本 |
| `activeTab` | 仅作用于你当前操作的那个标签页 |
| `tabCapture`、`offscreen` | 仅在你开启视频字幕翻译时读取当前标签页的声音；默认本机识别，主动选择云端识别时发给 Google |
| 访问 `api.openai.com`、`api.deepseek.com`、`api-free.deepl.com`、`api.deepl.com` | 自带 Key 时向你选定的平台发送翻译请求 |
| 可选：访问你自己的接口域名 | 仅当你填写了自定义接口地址（代理或中转）时申请，且只申请那一个域名；在点击「测试连接」时弹出授权，不会申请所有网站 |
| 内容脚本匹配所有网站 | 用户可能在任意网页选中文字或指定翻译区域；内容脚本提供翻译入口，仅过滤不含文字的选区 |

### 联系方式

有任何疑问或数据请求，请发邮件到 [support@huaci.app](mailto:support@huaci.app)， 或在 [GitHub Issues](https://github.com/csswork/AiTranslation/issues) 提出。
