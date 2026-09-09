# AI Selection Translator

A Chrome extension: **select non-Chinese text → right-click "翻译成中文" → the translation streams into a popup at the center of the screen**. Translation is done by an LLM, with support for **ChatGPT (OpenAI)** and **DeepSeek**, switchable at any time.

> The extension translates *into* Chinese, and its own UI is in Chinese. The context menu item reads 翻译成中文 ("Translate to Chinese").

## Features

- **Only shows up when it makes sense.** If the selected text is already Chinese, the context menu item does not appear. Neither does it for selections that are only digits, punctuation, or emoji. Japanese and Korean are offered normally.
- **Centered popup.** Not a small bubble chasing the cursor, but a centered modal with a draggable title bar. Close with `Esc` or by clicking the backdrop.
- **Streaming output.** The translation appears token by token instead of making you wait for the whole thing.
- **Two providers.** ChatGPT / DeepSeek, switchable straight from the popup's header to re-translate.
- **Copy**, **re-translate**, and a collapsible **source text** panel for side-by-side reading.
- Follows the system light / dark theme.

## Install

1. Open `chrome://extensions/`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and select this directory (`AiTranslation`)

The options page opens automatically on first install.

## Configure

Pick a provider on the options page and paste in an API key:

| Provider | Get a key | Default model | Base URL |
| --- | --- | --- | --- |
| ChatGPT | <https://platform.openai.com/api-keys> | `gpt-5.6-luna` | `https://api.openai.com/v1` |
| DeepSeek | <https://platform.deepseek.com/api_keys> | `deepseek-v4-flash` | `https://api.deepseek.com` |

Both default to the cheapest tier available, since translation is a high-frequency, short-input task. The model field also suggests `gpt-5.6-terra` / `gpt-5.6-sol` / `gpt-6-astra` and `deepseek-v4-pro`, and accepts any model name the provider supports. Hit **测试连接** ("Test connection") to verify.

Other settings: target language (Simplified / Traditional Chinese — the context menu title follows it), streaming on/off, and whether to keep the source text in the popup.

## Usage

Select some foreign-language text → right-click → **翻译成中文**.

## Layout

```
manifest.json              Manifest V3 declaration
src/
  background.js            Service worker: menu visibility, translation requests, streaming to the page
  lib/
    lang.js                Language heuristics (does this text need translating?)
    settings.js            Provider definitions and settings storage
    providers.js           OpenAI-compatible requests, SSE parsing, error mapping
  content/content.js       Selection reporting + the Shadow DOM popup
  options/                 Options page
  popup/                   Toolbar popup (status at a glance + quick provider switch)
icons/                     Icons
```

## Design notes

- **Timing of menu visibility.** Chrome decides which context menu items to show at the moment of the right-click, while `contextMenus.update()` is asynchronous. So the content script reports the selection to the background and updates the menu on `mouseup` / `selectionchange` — i.e. *before* the right-click — and treats the `contextmenu` event only as a fallback. The item defaults to visible, so even if reporting fails the feature never silently disappears.

- **How "is this Chinese?" is decided.** Kana (Japanese) and Hangul (Korean) are excluded first, then the ratio of Han characters to all letters is measured; at 50% or above the text counts as Chinese and no translation is offered. So "这个 API 很好用" is not offered, while "ChatGPT is 很 good" is.

- **Why the popup uses Shadow DOM.** Page-wide rules like `* { font-family: ... !important }` are extremely common, and Shadow DOM is what keeps the popup looking identical on every site. The host node starts from `all: initial`, and every inheritable property is declared explicitly on the panel.

- **The popup only renders in the top frame.** Selection reporting runs in every iframe (otherwise selections inside frames could not be evaluated), but the background always connects with `frameId: 0`, so the popup is centered on the whole page rather than inside some small iframe.

- **The page side closes the port.** Calling `disconnect()` immediately after `postMessage('done')` in the background risks dropping that message, so the page disconnects itself once it receives `done`.

- **Both providers need "thinking" turned off explicitly.** DeepSeek v4 defaults to `thinking.type: enabled` (with `reasoning_effort` defaulting to high), and OpenAI's gpt-5.x / gpt-6 default to `reasoning.effort: medium`. Translation does not benefit from reasoning — it only adds latency and token cost — so requests turn it down explicitly: `thinking: {type: 'disabled'}` for DeepSeek, `reasoning_effort: 'low'` for OpenAI (`gpt-6-astra` rejects `none` with a 400, and the official guidance for latency-sensitive work is to start at `low` anyway).

- **`temperature` is per-provider.** `0.2` for OpenAI's non-reasoning models; `1.3` for DeepSeek — that is the value their own parameter docs recommend for translation, and the semantics differ from OpenAI's, so it cannot be copied across. Reasoning models get no `temperature` at all.

- **Rejected parameters fall back gracefully.** Both providers keep changing their model lineups and parameters, and users can type in any model name. So when a request comes back 400 complaining about a parameter, it is retried once with a minimal body (`model` / `messages` / `stream` only), rather than failing outright over one unsupported field. Non-parameter 400s are not retried.

- **Where the API key lives.** `chrome.storage.local` — on this machine only. It is not synced through the Chrome account and never sent to any third party. Requests only go to the base URL of the provider you selected.

## Known limitations

- Protected pages (`chrome://`, the Chrome Web Store, and similar) do not allow script injection, so the extension does not work there.
- At most 6000 characters per translation; anything beyond that is truncated, and the popup says so.
- A custom base URL (proxy or relay) needs its origin authorized separately — the permission prompt appears when you click **测试连接** — and only https is supported.

## License

Released under the [GNU General Public License v3.0](LICENSE).

    AI Selection Translator — a Chrome extension that translates selected text into Chinese with an LLM
    Copyright (C) 2026  Haibo

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
