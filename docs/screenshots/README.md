# README screenshots and GIFs

**English** · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Español](README.es.md) · [العربية](README.ar.md)

Captured on 2026-11-13. Extension version: **2.2.0 development build** from source; this does not mean that version is available in the stores.

Captured on macOS in Chrome for Testing 150, with this repository’s `apps/extension` loaded in a separate browser profile. The interface is in Simplified Chinese. DeepSeek (`deepseek-flash`) handles translation. Image recognition, article translation, and alternative wording use the extension’s actual request flow and the model’s responses from that run.

PNGs are direct browser screenshots at 1280 × 800. GIFs use actual Chrome screencast frames, encoded from their timestamps at 1000 × 625 and 10 fps, looping indefinitely. Only resolution and palette are compressed. Capture automation triggers the messages or script injection used by the context-menu actions; the browser’s native context menu is not included in the GIFs.

## Animated demos

| File | Actions |
| --- | --- |
| [image-recognition.gif](image-recognition.gif) | Recognize a Japanese menu → overlay Chinese translations → compare with the original → open an individual translation editor → select a region |
| [bilingual-reader.gif](bilingual-reader.gif) | Scan an article → remove ads and show bilingual text → choose alternative wording → switch stacked / side-by-side layouts → save → switch to dark mode |

## Screenshots

| File | Scene |
| --- | --- |
| [01-bilingual-reader.png](01-bilingual-reader.png) | Original and translated paragraphs aligned side by side |
| [02-word-alternatives.png](02-word-alternatives.png) | Selected wording, its source text, alternatives, and custom replacement |
| [03-reader-library.png](03-reader-library.png) | Dark reading mode and articles saved on the device |
| [04-image-translation.png](04-image-translation.png) | Japanese menu recognition with translations following text shapes |
| [05-image-editing.png](05-image-editing.png) | Edit a single image translation, adjust its font size, or translate it again |
| [06-selection-translation.png](06-selection-translation.png) | Selection translation popup with the original expanded |
| [07-translation-panel.png](07-translation-panel.png) | Standalone translation panel |
| [08-pdf-translation.png](08-pdf-translation.png) | Original and translated PDF side by side; parsed locally, two pages |
| [09-region-translation.png](09-region-translation.png) | In-place page region translation with a button shown on hover |

## Sample materials

The article, Japanese menu image, and PDF are existing local sample materials from this repository. Publication names, authors, dates, and PDF benchmark data are illustrative; they do not represent real news or performance results. The sample article contains ad placeholders. The reading page shows the body extracted by the extension after ad removal. The model recognizes and translates the menu text, and the extension renders the Chinese overlay.

Capture scripts, intermediate frames, and browser profiles are kept in the ignored local `tools/capture/` directory and are excluded from extension packages. This directory contains only the finished media and their documentation.
