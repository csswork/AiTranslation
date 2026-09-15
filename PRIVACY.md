# Privacy Policy / 隐私政策

**AI Selection Translator (AI 划词翻译)**
Last updated / 最后更新：2026-09-15

[English](#english) · [中文](#中文)

---

## English

### In one sentence

This extension collects nothing, stores nothing on our servers, and uploads nothing to
us — **we do not operate any server**. What you ask it to translate is sent only to the
AI provider **you** configured.

### What gets sent out

Only when **you actively trigger a translation** (context menu, keyboard shortcut, or
clicking a translate button) is the following sent over HTTPS to the provider you selected
in Settings:

| Content | When | Sent to |
| --- | --- | --- |
| The text you selected | Using selection translation | Your chosen provider |
| The text inside a region you marked | Clicking that region's translate button | Same |
| The image you right-clicked | Using image translation | Same |
| Text you type into the translation panel | Clicking Translate | Same |

The available providers are **OpenAI (ChatGPT)** and **DeepSeek**; requests go to
`https://api.openai.com` and `https://api.deepseek.com` respectively. How they handle
that content is governed by their own privacy policies:

- OpenAI: <https://openai.com/policies/privacy-policy>
- DeepSeek: <https://platform.deepseek.com/downloads/DeepSeek%20Privacy%20Policy.html>

**Never sent**: page content you did not ask to translate, browsing history, cookies, or
form data. The extension does not scan or upload anything in the background.

### What stays on your machine

The following is stored on **your device** via `chrome.storage.local`. It is not synced
through your Chrome account and never leaves your browser:

- **API key** — used only to authenticate your requests to the provider you chose
- **Preferences** — target language, model, feature toggles
- **Element translation rules** — the "domain + CSS selector" entries you added yourself

You can clear all of it from the options page at any time, or simply uninstall the
extension (uninstalling removes it all).

### What we do not do

- No servers, no data collection
- No analytics, telemetry, advertising, or third-party SDKs of any kind
- No selling, renting, or sharing of any data with third parties
- No use for creditworthiness or anything unrelated to the extension's function

The complete source code is public under GPL-3.0, so you can verify all of the above:
<https://github.com/csswork/AiTranslation>

### Permissions

| Permission | Why |
| --- | --- |
| `contextMenus` | Provide the translate entries in the right-click menu |
| `storage` | Save the settings above on your machine |
| `scripting` | Inject the needed script into the current page when you trigger a translation |
| `activeTab` | Act only on the tab you are working in |
| Access to `api.openai.com` / `api.deepseek.com` | Send translation requests |
| Content script on all sites | You may select text on any page; and the extension must know whether the selected text is already Chinese *before* the right-click, to decide whether the menu item appears |

### Contact

Questions? Please open an issue at
<https://github.com/csswork/AiTranslation/issues>.

---

## 中文

### 一句话概括

本扩展不收集、不存储、不上传任何用户数据到我们的服务器——**我们没有服务器**。
你要翻译的内容，只会发送到**你自己配置的那家 AI 平台**。

### 会发送出去的内容

只有在你**主动触发翻译**时（右键菜单、快捷键、点击翻译按钮），
以下内容才会通过 HTTPS 发送到你在设置里选择的平台：

| 内容 | 发送时机 | 发往 |
| --- | --- | --- |
| 你选中的文字 | 使用划词翻译时 | 你选择的平台 |
| 你指定区域内的文字 | 点击元素上的翻译按钮时 | 同上 |
| 你右键的那张图片 | 使用图片翻译时 | 同上 |
| 你在翻译面板输入的文字 | 点击翻译时 | 同上 |

可选的平台为 **OpenAI（ChatGPT）** 与 **DeepSeek**，请求分别发往
`https://api.openai.com` 与 `https://api.deepseek.com`。
这些内容如何被处理，适用该平台自己的隐私政策（链接见英文部分）。

**不会发送**：你没有主动翻译的页面内容、浏览历史、Cookie、表单数据。
扩展不会在后台自动扫描或上传任何东西。

### 只保存在你本机的内容

以下数据通过 `chrome.storage.local` 保存在**你这台设备上**，
不走 Chrome 账号同步，不会离开你的浏览器：

- **API Key** —— 仅用于在请求头中向你选择的平台鉴权
- **偏好设置** —— 目标语言、使用的模型、各项开关
- **元素翻译规则** —— 你手动添加的「域名 + CSS 选择器」

你可以随时在设置页清空这些数据，或直接卸载扩展（卸载会一并删除）。

### 我们不做的事

- 不设任何服务器，不收集任何数据
- 不使用统计、埋点、广告或任何第三方 SDK
- 不出售、不出租、不分享任何数据给第三方
- 不用于信用评估或与扩展功能无关的用途

扩展的全部源代码以 GPL-3.0 公开，可自行核实：
<https://github.com/csswork/AiTranslation>

### 权限说明

| 权限 | 用途 |
| --- | --- |
| `contextMenus` | 在右键菜单提供翻译入口 |
| `storage` | 在本机保存上述设置 |
| `scripting` | 在你触发翻译时向当前页面注入所需脚本 |
| `activeTab` | 仅作用于你当前操作的那个标签页 |
| 访问 `api.openai.com` / `api.deepseek.com` | 发送翻译请求 |
| 内容脚本匹配所有网站 | 你可能在任何网页上划词翻译；且需在右键之前判断选中的文字是否为中文，以决定菜单是否出现 |

### 联系方式

有任何疑问，请在 <https://github.com/csswork/AiTranslation/issues> 提出。
