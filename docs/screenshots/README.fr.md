# Captures et GIF du README

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · **Français** · [Deutsch](README.de.md) · [Español](README.es.md) · [العربية](README.ar.md)

Capture réalisée le 2026-11-13. Version de l’extension : **2.2.0 de développement**, chargée depuis les sources ; cela ne signifie pas qu’elle est disponible dans les boutiques.

Captures réalisées sous macOS dans Chrome for Testing 150, avec `apps/extension` chargé depuis ce dépôt dans un profil de navigateur distinct. L’interface est en chinois simplifié. DeepSeek (`deepseek-flash`) assure la traduction. La reconnaissance d’image, la traduction des articles et les reformulations utilisent les vraies requêtes de l’extension et les réponses renvoyées par le modèle pendant cette exécution.

Les PNG sont des captures directes du navigateur en 1280 × 800. Les GIF proviennent des images réellement enregistrées par Chrome, encodées selon leurs horodatages en 1000 × 625, à 10 images/s, en boucle infinie. Seules la résolution et la palette sont compressées. L’automatisation déclenche les messages ou l’injection de scripts utilisés par les actions du menu contextuel ; le menu natif du navigateur n’apparaît pas dans les GIF.

## Démonstrations animées

| Fichier | Actions |
| --- | --- |
| [image-recognition.gif](image-recognition.gif) | Reconnaître un menu japonais → superposer la traduction chinoise → comparer avec l’original → ouvrir l’éditeur d’une traduction → sélectionner une zone |
| [bilingual-reader.gif](bilingual-reader.gif) | Analyser un article → retirer les publicités et afficher le texte bilingue → choisir une reformulation → passer de la disposition verticale au côte à côte → enregistrer → activer le mode sombre |

## Captures statiques

| Fichier | Scène |
| --- | --- |
| [01-bilingual-reader.png](01-bilingual-reader.png) | Paragraphes originaux et traduits alignés côte à côte |
| [02-word-alternatives.png](02-word-alternatives.png) | Texte sélectionné, original correspondant, alternatives et remplacement personnalisé |
| [03-reader-library.png](03-reader-library.png) | Mode sombre et articles enregistrés sur l’appareil |
| [04-image-translation.png](04-image-translation.png) | Reconnaissance d’un menu japonais et traduction suivant la forme du texte |
| [05-image-editing.png](05-image-editing.png) | Modification d’une traduction d’image, taille du texte et retraduction |
| [06-selection-translation.png](06-selection-translation.png) | Fenêtre de traduction de la sélection avec l’original déplié |
| [07-translation-panel.png](07-translation-panel.png) | Panneau de traduction indépendant |
| [08-pdf-translation.png](08-pdf-translation.png) | PDF original et traduit côte à côte ; analyse locale, deux pages |
| [09-region-translation.png](09-region-translation.png) | Traduction sur place d’une zone de page avec bouton au survol |

## Exemples utilisés

L’article, l’image du menu japonais et le PDF sont des exemples locaux déjà présents dans le dépôt. Les noms de médias, auteurs, dates et données de test du PDF sont fictifs ou illustratifs : ils ne représentent ni de vraies actualités ni des mesures de performance réelles. L’article contient des emplacements publicitaires. La page de lecture montre le corps extrait par l’extension après suppression des publicités. Le modèle reconnaît et traduit le menu, puis l’extension dessine la traduction chinoise.

Les scripts de capture, images intermédiaires et profils de navigateur restent dans le répertoire local ignoré `tools/capture/` et sont exclus des paquets de l’extension. Ce répertoire ne contient que les médias finalisés et leur documentation.
