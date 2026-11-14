# Screenshots und GIFs für die README

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [Français](README.fr.md) · **Deutsch** · [Español](README.es.md) · [العربية](README.ar.md)

Aufgenommen am 2026-11-13. Erweiterungsversion: **Entwicklungsversion 2.2.0** aus dem Quellcode. Dies bedeutet nicht, dass diese Version bereits in den Stores verfügbar ist.

Aufgenommen unter macOS in Chrome for Testing 150. `apps/extension` aus diesem Repository wurde in ein separates Browserprofil geladen. Die Oberfläche ist auf vereinfachtem Chinesisch. Für Übersetzungen wird DeepSeek (`deepseek-flash`) verwendet. Bilderkennung, Artikelübersetzung und alternative Formulierungen verwenden den tatsächlichen Anfrageweg der Erweiterung und die Antworten des Modells aus diesem Durchlauf.

PNGs sind direkte Browser-Screenshots mit 1280 × 800 Pixeln. GIFs bestehen aus tatsächlich von Chrome aufgenommenen Bildern, anhand ihrer Zeitstempel mit 1000 × 625 Pixeln und 10 Bildern/s codiert und endlos wiederholt. Nur Auflösung und Farbpalette werden komprimiert. Die Automatisierung löst dieselben Nachrichten oder Skriptinjektionen wie die Kontextmenüaktionen aus; das native Kontextmenü des Browsers ist in den GIFs nicht enthalten.

## Animierte Demos

| Datei | Aktionen |
| --- | --- |
| [image-recognition.gif](image-recognition.gif) | Japanisches Menü erkennen → chinesische Übersetzung einblenden → Original vergleichen → einzelne Übersetzung bearbeiten → Bereich auswählen |
| [bilingual-reader.gif](bilingual-reader.gif) | Artikel scannen → Werbung entfernen und zweisprachig anzeigen → alternative Formulierung wählen → untereinander / nebeneinander wechseln → speichern → Dunkelmodus aktivieren |

## Screenshots

| Datei | Szene |
| --- | --- |
| [01-bilingual-reader.png](01-bilingual-reader.png) | Original und Übersetzung absatzweise nebeneinander |
| [02-word-alternatives.png](02-word-alternatives.png) | Ausgewählte Formulierung, Originaltext, Alternativen und eigene Ersetzung |
| [03-reader-library.png](03-reader-library.png) | Dunkelmodus und auf dem Gerät gespeicherte Artikel |
| [04-image-translation.png](04-image-translation.png) | Japanisches Menü erkennen und Übersetzung entlang der Textformen anzeigen |
| [05-image-editing.png](05-image-editing.png) | Einzelne Bildübersetzung bearbeiten, Schriftgröße ändern oder erneut übersetzen |
| [06-selection-translation.png](06-selection-translation.png) | Übersetzungsdialog für markierten Text mit aufgeklapptem Original |
| [07-translation-panel.png](07-translation-panel.png) | Separates Übersetzungsfenster |
| [08-pdf-translation.png](08-pdf-translation.png) | Original und übersetztes PDF nebeneinander; lokal verarbeitet, zwei Seiten |
| [09-region-translation.png](09-region-translation.png) | Direkte Übersetzung eines Seitenbereichs mit Schaltfläche beim Darüberfahren |

## Beispielmaterial

Artikel, japanisches Menübild und PDF sind bereits vorhandene lokale Beispiele aus dem Repository. Mediennamen, Autoren, Daten und Testwerte im PDF dienen der Veranschaulichung; sie stellen keine echten Nachrichten oder Leistungsmessungen dar. Der Beispielartikel enthält Werbeplatzhalter. Die Leseansicht zeigt den von der Erweiterung nach der Werbeentfernung extrahierten Text. Das Modell erkennt und übersetzt das Menü, anschließend zeichnet die Erweiterung die chinesische Übersetzung darüber.

Aufnahmeskripte, Zwischenbilder und Browserprofile liegen im ignorierten lokalen Verzeichnis `tools/capture/` und sind nicht Teil der Erweiterungspakete. Dieses Verzeichnis enthält ausschließlich fertige Medien und deren Dokumentation.
