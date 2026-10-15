# AI Selection Translator

A Chrome extension for translating selected text, page regions, images and experimental video captions into your chosen language. Bring your own ChatGPT (OpenAI), DeepSeek or DeepL API key.

- **24 language choices throughout the extension:** Simplified Chinese, Traditional Chinese, English, Spanish, Portuguese (Brazil), French, German, Italian, Dutch, Russian, Ukrainian, Polish, Turkish, Arabic, Hebrew, Persian, Hindi, Bengali, Urdu, Indonesian, Vietnamese, Thai, Japanese and Korean.
- **Independent preferences:** interface language, default translation target, and source language are separate. A new installation chooses its default target from Chrome's language; upgrades preserve the existing target and API configuration.
- **Translate any script**, including Chinese and mixed-language text. Only selections containing no letters are filtered out. Simplified ↔ Traditional conversion remains available.
- **Temporary target changes:** the selection popup retranslates the original text. Its star button explicitly saves the current target as the default. The text panel remembers its own source/target choices, and swaps only when a source has been selected.
- **Images:** changing the target reuses recognized source text; changing the image clears that cache.
- **Regions:** translation uses a fixed target for all batches, preserves originals, and supports restoring the source. Failed batches restore completed portions rather than leaving mixed languages.
- **RTL:** Arabic, Hebrew, Persian and Urdu interfaces use right-to-left layout. Original and translated text have independent direction; opening an overlay does not change the host page's direction.
- **Provider capabilities:** DeepL language support is checked against the configured API. Unsupported pairs return an error without switching to a different language. Vision requires a vision-capable provider/model.

## Install

1. Open `chrome://extensions/`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and select `apps/extension` inside the repository

The options page opens automatically on first install.

## Configure

Pick a provider on the options page and paste in an API key:

| Provider | Get a key | Default model | Base URL |
| --- | --- | --- | --- |
| ChatGPT | <https://platform.openai.com/api-keys> | `gpt-5.6-luna` | `https://api.openai.com/v1` |
| DeepSeek | <https://platform.deepseek.com/api_keys> | `deepseek-flash` | `https://api.deepseek.com` |
| DeepL | <https://www.deepl.com/pro-api> | — (no model choice) | Chosen from the key: `https://api-free.deepl.com` for Free keys ending in `:fx`, otherwise `https://api.deepl.com` |

ChatGPT and DeepSeek default to the cheapest tier available, since translation is a high-frequency, short-input task. The model field also suggests `gpt-5.6-terra` / `gpt-5.6-sol` / `gpt-6-astra` and `deepseek-v4-pro`, and accepts any model name the provider supports. Hit **测试连接** ("Test connection") to verify.

Choose your interface language and default translation target independently, then configure streaming and source-text visibility. Video speech recognition has its own source-language setting and checks device support; the experimental feature remains off by default.

### Account and credits (hosted mode)

Besides bring-your-own-key, the first provider is **点数翻译** (credit translation), which needs no API key. New installs use it by default.

- **Guest trial**: right after install, the service worker silently claims a guest session with free credits (`POST /api/extension/guest`). It then opens the account site's welcome page, which recognizes a reinstall in the same browser. Translation works immediately, with no sign-up. If the account service is unreachable at install time, the options page shows the old welcome with both paths, and the first credit translation claims the guest session later.
- **Credits and subscription**: when the free credits run out, guests are asked to register, which gives more credits and moves the remaining guest credits over. Registered users are asked to subscribe. Subscribers see **Unlimited** instead of a balance.

- **Environment**: `src/lib/env.js` decides it from the manifest. Store builds have `update_url` and use `https://app.huaci.app` and `https://huaci.app`. Unpacked builds use the local dev servers, `http://localhost:8787` (`npm run dev:backend`) and `http://localhost:8788` (`npm run dev:web`), for the API, account links and privacy link. The options footer then shows a `DEV · localhost:8787` badge. All external addresses come from this file.
- **Dev tools**: unpacked builds show a dashed “开发工具” panel at the bottom of the options page (`src/options/dev-tools.js`; store builds render nothing). It shows the locally stored account state: session type, whether a guest trial was already claimed (`guestClaimed`, which is kept permanently so the extension never re-claims on its own), onboarding state, and the cached balance. It can clear that state, or clear it and simulate a fresh install, which claims a guest trial and opens the welcome page. The server still applies its own per-network limit and the welcome page's browser marker.
- **Sign-in** opens the account site's authorization page in a new tab in the current window. It does not use `launchWebAuthFlow`, which opens a separate window. After approval the site redirects to the extension's own `src/auth/callback.html` with a one-time code. That page is the only web-accessible resource, and only for the account origins. It hands its URL to the service worker. The worker checks `state` and exchanges the code with the PKCE verifier for an extension session token, stored in `chrome.storage.local` only. The verifier waits in `chrome.storage.session`. The worker then switches back to the tab that started sign-in and closes the callback tab; started from the popup, the callback tab becomes the options page.
- **Status**: account type (guest or registered), username, credit balance, subscription and the sign-up bonus are cached as `accountStatus`. The options page and toolbar popup listen for storage changes, so balance updates after every hosted translation; the options page also refreshes when it is opened or becomes visible. An expired or revoked session returns to signed-out.
- **Web sign-out**: the backend links each member extension session to the web session that authorized it (including a guest converted during web sign-in). Signing out of that web session revokes its extension sessions, while other browsers stay signed in. A dedicated content script requests a status refresh after navigation, restored pages, or returning to the account page. Both the script and worker check the full origin: unpacked builds accept only `http://localhost:8787`, store builds only `https://app.huaci.app`; the website port, admin origin, subframes, and the other environment are ignored. Pages send no tokens or account data; the worker reads the actual status from the backend.
- **Billing** is enforced by the server: exactly 1 credit per 500 Unicode code points, with no minimum per request or rounding during billing; failed translations are refunded exactly, and subscribers are not charged. The server stores integer units (1 character = 1 unit), while balances, bonuses and usage display two decimal places. API credit values are display strings; use `credits.available` to determine whether any quota remains, even if the displayed balance is `0.00`. The client never computes charges or quota. The conversion rate is internal and no longer included in `/me`. Hosted mode currently covers text (selection, text panel, regions, captions); image translation still needs a vision provider with your own key. See [credit accounting](../../docs/backend/credit-accounting.md).
- All account and hosted requests are sent by the service worker to the fixed account origin. Page translations reach it through the usual translation port; the account messages (guest claim, login, logout, refresh, hosted translate) are accepted only from extension pages. Signing in while a guest sends the guest token along, so the server merges the guest into the account.

## Usage

Select text → right-click → **Translate to your target language**. You can also use the floating selection button or keyboard shortcut.

## Layout

```
manifest.json              Manifest V3 declaration
src/
  background.js            Service worker: menus, translation requests, streaming to the page, video captions
  auth/callback.*           Sign-in callback: hands the one-time code to the service worker
  content/
    content.js             Selection reporting + the Shadow DOM popup
    elements.js            Region (element) translation buttons from saved rules
    image.js               In-page image translation overlay
    video.js               Experimental video caption overlay, injected on demand
  lib/
    providers.js           OpenAI-compatible, DeepL and hosted requests, SSE parsing, error mapping
    env.js                 Store vs. unpacked build: account, API and website origins
    account.js             Account login (PKCE), status cache and hosted translation; service worker only
    settings.js            Provider definitions and settings storage
    languages.js           Shared 24-language registry (generated from i18n/)
    i18n.js, messages.js   Extension UI localization (messages.js is generated)
    lang.js                Language heuristics (does this text need translating?)
    requests.js            Cancels provider fetches when a request port disconnects
    rules.js, selector.js  Region translation rules and reusable CSS selectors
    tiles.js               Long-image tiling for vision models
    captions.js, speech.js Caption segmentation and on-device speech language packs
  options/                 Options page
  popup/                   Toolbar popup (status at a glance + quick provider switch)
  translate/               Standalone text translation panel
  image/                   Image translation page
  manage/                  Region translation rule management (not the VPS admin interface)
  offscreen/               Offscreen document for tab audio capture and speech recognition
icons/                     Icons
_locales/                  Generated Chrome native locale catalogs
```

Development-only files live beside the runtime: `i18n/` (UI catalogs and language registry), `scripts/` (catalog extraction, translation and build), `test/`, `store-assets/` and `package.sh`. They are not included in the extension ZIP.

## Design notes

- **Timing of menu visibility.** Chrome decides which context menu items to show at the moment of the right-click, while `contextMenus.update()` is asynchronous. So the content script reports the selection to the background and updates the menu on `mouseup` / `selectionchange` — i.e. *before* the right-click — and treats the `contextmenu` event only as a fallback. The item defaults to visible, so even if reporting fails the feature never silently disappears.

- **Language detection never hides an explicit translation request.** Short, mixed, and same-language selections remain translatable. The provider detects the source unless the text panel explicitly specifies it.

- **Why the popup uses Shadow DOM.** Page-wide rules like `* { font-family: ... !important }` are extremely common, and Shadow DOM is what keeps the popup looking identical on every site. The host node starts from `all: initial`, and every inheritable property is declared explicitly on the panel.

- **The popup only renders in the top frame.** Selection reporting runs in every iframe (otherwise selections inside frames could not be evaluated), but the background always connects with `frameId: 0`, so the popup is centered on the whole page rather than inside some small iframe.

- **The page side closes the port.** Calling `disconnect()` immediately after `postMessage('done')` in the background risks dropping that message, so the page disconnects itself once it receives `done`.

- **Both providers need "thinking" turned off explicitly.** DeepSeek v4 defaults to `thinking.type: enabled` (with `reasoning_effort` defaulting to high), and OpenAI's gpt-5.x / gpt-6 default to `reasoning.effort: medium`. Translation does not benefit from reasoning — it only adds latency and token cost — so requests turn it down explicitly: `thinking: {type: 'disabled'}` for DeepSeek, `reasoning_effort: 'low'` for OpenAI (`gpt-6-astra` rejects `none` with a 400, and the official guidance for latency-sensitive work is to start at `low` anyway).

- **`temperature` is per-provider.** `0.2` for OpenAI's non-reasoning models; `1.3` for DeepSeek — that is the value their own parameter docs recommend for translation, and the semantics differ from OpenAI's, so it cannot be copied across. Reasoning models get no `temperature` at all.

- **Rejected parameters fall back gracefully.** Both providers keep changing their model lineups and parameters, and users can type in any model name. So when a request comes back 400 complaining about a parameter, it is retried once with a minimal body (`model` / `messages` / `stream` only), rather than failing outright over one unsupported field. Non-parameter 400s are not retried.

- **Where the API key lives.** `chrome.storage.local` — on this machine only. It is not synced through the Chrome account. The key is sent only to the configured provider endpoint to authenticate requests.

## Known limitations

- Protected pages (`chrome://`, the Chrome Web Store, and similar) do not allow script injection, so the extension does not work there.
- At most 6000 characters per translation; anything beyond that is truncated, and the popup says so.
- A custom base URL (proxy or relay) needs its origin authorized separately — the permission prompt appears when you click **测试连接** — and only https is supported.

## Development

Run these commands from `apps/extension`:

```sh
node scripts/sync-extension-i18n.mjs
node scripts/sync-extension-i18n.mjs --watch  # optional local auto-refresh
node scripts/build-extension-i18n.mjs --check
bash test/run.sh
```

`i18n/` contains the extension catalogs and language registry. Native Chrome `_locales/` catalogs and `src/lib/messages.js` are generated files. The website in `../web/public/` has its own independent build in `../web/i18n/`.

Run `bash package.sh` to refresh changed messages locally and build `../../dist/extension/ai-translation-<version>.zip`. Put `DEEPSEEK_API_KEY` in this application's `.env.local` or the repository's existing `.env.local`; unchanged catalogs need no API call. See [i18n/README.md](i18n/README.md).

Catalog generation tools are development-only; the shipped extension does not download a model or contact a translation service to localize its interface.

## License

Released under the [GNU General Public License v3.0](../../LICENSE).

    AI Selection Translator — a Chrome extension that translates selected text into your chosen language
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
