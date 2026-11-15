# Huaci · 划词

**English** · [简体中文](docs/readme/README.zh-CN.md) · [日本語](docs/readme/README.ja.md) · [Français](docs/readme/README.fr.md) · [Deutsch](docs/readme/README.de.md) · [Español](docs/readme/README.es.md) · [العربية](docs/readme/README.ar.md)

**Huaci — AI Translator & Bilingual Reader.** Previously called “AI 划词翻译 / AI Translator”; renamed in 2.2.0 with the same extension IDs and store listings.

Read articles in other languages and translate images and PDFs right in your browser. Keep original and translated paragraphs aligned, click a translated word for alternative wording, and save articles with their translations on your device. Huaci also offers selection translation, translation of individual page regions, and a standalone translation panel. Bring your own API key or use hosted translation with credits, without a key.

[Website](https://huaci.app/) · [Chrome Web Store](https://chromewebstore.google.com/detail/ai-translator/hogimafgjmlpdlnepojgigjkhaccbcbj) · [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/mojcgjimlkkbohomcijkmoefpeekmohe) · [Extension guide](apps/extension/README.md)

## Preview

These screenshots and recordings show the current **2.2.0 development build** loaded in Chrome, using real models for recognition and translation. Bilingual reading, alternative wording, and image translation that follows text shapes are being prepared for release. See the [Extension guide](apps/extension/README.md#account-and-credits-hosted-mode) for store availability.

**Image recognition and translation:** Detect text, overlay translations following the text shapes, compare with the original, edit individual translations, or select regions manually.

![Image recognition: detect, translate, compare, edit, and select regions](docs/screenshots/image-recognition.gif)

**Bilingual reading:** Extract article text, remove ads, and align each paragraph with its translation. Choose alternative wording, switch layouts, and save the article and translation on your device.

![Bilingual reading: extract an article, translate, choose wording, change layouts, and save](docs/screenshots/bilingual-reader.gif)

| Bilingual reading | Alternative wording |
| --- | --- |
| [![Bilingual reading](docs/screenshots/01-bilingual-reader.png)](docs/screenshots/01-bilingual-reader.png) | [![Alternative wording](docs/screenshots/02-word-alternatives.png)](docs/screenshots/02-word-alternatives.png) |
| **Image translation** | **Dark mode and saved articles** |
| [![Image translation](docs/screenshots/04-image-translation.png)](docs/screenshots/04-image-translation.png) | [![Dark mode and saved articles](docs/screenshots/03-reader-library.png)](docs/screenshots/03-reader-library.png) |
| **Selection translation** | **Page region translation** |
| [![Selection translation](docs/screenshots/06-selection-translation.png)](docs/screenshots/06-selection-translation.png) | [![Page region translation](docs/screenshots/09-region-translation.png)](docs/screenshots/09-region-translation.png) |
| **Whole-PDF translation, side by side** | **Translation panel** |
| [![Whole-PDF translation, side by side](docs/screenshots/08-pdf-translation.png)](docs/screenshots/08-pdf-translation.png) | [![Translation panel](docs/screenshots/07-translation-panel.png)](docs/screenshots/07-translation-panel.png) |

See the [capture notes](docs/screenshots/README.md) for the recording environment and sample materials. The captured interface is in Simplified Chinese; all documentation languages share these images and GIFs.

## Project

One repository, three applications: an HTML website on Vercel, a backend on a VPS, and a browser extension.

| Application | Directory | Runs on | Status |
| --- | --- | --- | --- |
| Website | [apps/web](apps/web/README.md) | Vercel | Product pages, privacy, terms, and changelog in 11 languages; the header reads the sign-in state from app.huaci.app |
| Backend | [apps/backend](apps/backend/README.md) | VPS | Authentication, account and admin interfaces, extension API, guest trials, precise credit accounting, hosted text and images, and Creem subscriptions; the first release is deployed |
| Extension | [apps/extension](apps/extension/README.md) | Chrome / Edge | Store version: 2.1.0. Source version: 2.2.0, adding bilingual reading, alternative wording, wording preferences, and image translation following text shapes; release in preparation |

## Layout

```text
apps/
  web/
    public/          HTML, CSS, JS, assets, and generated language pages
    i18n/            Website translations and page builder
    test/            Website, language switching, and CSP checks
  backend/
    src/             Hono: config, database, auth, credits, email
    ui/account/      Account interface (server-rendered)
    migrations/      PostgreSQL migrations
    test/  deploy/   Backend tests and VPS deployment instructions
  extension/
    manifest.json    Chrome extension manifest
    src/             Extension code and UI; src/vendor/pdfjs is upstream pdf.js
    icons/           Extension icons
    _locales/        Generated Chrome localization files
    i18n/            UI translations, language registry, and templates
    scripts/         Local UI extraction, translation, and build tools
    test/            Extension tests
    store-assets/    Store listings, screenshots, and promotional materials
    package.sh       Extension packaging tool
docs/                Architecture, engineering notes, and multilingual READMEs
test/run.sh          Repository-wide test entry point
package.sh           Extension packaging entry point
vercel.json          Vercel deployment and security headers
dist/extension/      Generated extension ZIPs (not committed)
tools/               Local capture and experiment tools (not committed)
LICENSE              Repository license
PRIVACY.md           Preserved public privacy-policy path
```

## Local development

Development tools require Node.js 22 or later. Website preview and extension packaging also require Python 3. The extension itself requires Chrome 116 or later. Website and extension builds and tests use standard libraries, without npm dependencies. The backend has its own dependencies (`cd apps/backend && npm ci`) and requires local PostgreSQL; `npm test` skips the backend if its dependencies are not installed.

```sh
npm run dev                   # Start local services; Ctrl+C stops them together
npm test                      # Website and extension tests
npm run test:web              # Website tests only
npm run test:extension        # Extension tests only
npm run dev:web               # http://localhost:8788
npm run build:web             # Generate website language pages
npm run check:web             # Check generated website translations
npm run i18n:extension        # Refresh extension UI translations locally
npm run check:extension       # Check generated extension translations
npm run package:extension     # dist/extension/ai-translation-<version>.zip
npm run package:edge          # dist/extension/ai-translation-edge-<version>.zip
npm run test:backend          # Requires the PostgreSQL database huaci_test
npm run migrate:backend       # Apply backend database migrations
npm run dev:backend           # http://localhost:8787 — account interface
```

`npm run dev` starts:

| Service | Address |
| --- | --- |
| Backend: account interface, extension API, Creem callbacks; pending migrations run before startup | `http://localhost:8787` |
| Admin interface: same backend process, selected by hostname | `http://admin.localhost:8787` |
| Website preview | `http://localhost:8788` |
| Extension UI translation watcher; load this unpacked directory in Chrome | `apps/extension` |

Services whose ports are already in use are skipped with an explanation. Before starting the backend, run `npm ci` in `apps/backend` and configure local PostgreSQL and `apps/backend/.env.local`.

The compatibility entry points `bash test/run.sh` and `bash package.sh` still work from the repository root. Each application’s scripts can also run from its own directory.

In Chrome developer mode, **Load unpacked** should point to **`apps/extension`**, not the repository root. Changing the development extension’s path may give it a new ID and require reconfiguration; store updates continue using the same listing.

The extension UI translation generator reads `apps/extension/.env.local`, falls back to the root `.env.local`, and also supports process environment variables. Existing keys in the root file can stay there. Runtime API keys are stored only in `chrome.storage.local`. Environment files and development translation tools are excluded from extension packages.

## Deployment

- **Vercel website:** Keep the repository root as the Vercel project root. `vercel.json` builds `apps/web` and publishes only `apps/web/public`. The GitHub workflow runs when website files, Vercel configuration, or related build entry points change.

- **VPS backend:** `apps/backend` is deployed independently; the account service is live at `app.huaci.app`. Hosted audio/video transcription is not implemented. Recognized subtitles can use hosted text translation. See the [deployment instructions](apps/backend/deploy/README.md).

- **Browser extension:** Packaged and released separately to the stores. ZIP contents are limited to `manifest.json`, `src/`, `icons/`, `_locales/`, and the root `LICENSE`.

See [architecture](docs/architecture.md) for responsibilities, old directory mappings, and development priorities. Repository development conventions are in [AGENTS.md](AGENTS.md).

[Website](https://huaci.app/) · [Source](https://github.com/csswork/AiTranslation)

Released under [GPL-3.0](LICENSE).
