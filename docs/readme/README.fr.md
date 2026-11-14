# Huaci · 划词

[English](../../README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · **Français** · [Deutsch](README.de.md) · [Español](README.es.md) · [العربية](README.ar.md)

**Huaci — Traducteur IA et lecteur bilingue.** Anciennement « AI 划词翻译 / AI Translator » ; renommé en 2.2.0, sans changement des identifiants de l’extension ni de ses fiches dans les boutiques.

Lisez des articles en langue étrangère et traduisez des images et des PDF dans votre navigateur. Les paragraphes originaux et traduits restent alignés. Cliquez sur un mot traduit pour choisir une autre formulation, puis enregistrez l’article et sa traduction sur votre appareil. Huaci propose aussi la traduction du texte sélectionné, de zones de page et un panneau de traduction indépendant. Utilisez votre propre clé API ou la traduction hébergée à crédits, sans clé.

[Site officiel](https://huaci.app/) · [Chrome Web Store](https://chromewebstore.google.com/detail/ai-translator/hogimafgjmlpdlnepojgigjkhaccbcbj) · [Modules complémentaires Edge](https://microsoftedge.microsoft.com/addons/detail/mojcgjimlkkbohomcijkmoefpeekmohe) · [Guide de l’extension](../../apps/extension/README.md)

## Aperçu

Ces captures et enregistrements montrent la **version de développement 2.2.0** actuelle chargée dans Chrome, avec de vrais modèles pour la reconnaissance et la traduction. La lecture bilingue, les formulations alternatives et la traduction d’images suivant la forme du texte sont en préparation. Consultez le [Guide de l’extension](../../apps/extension/README.md#account-and-credits-hosted-mode) pour connaître la disponibilité dans les boutiques.

**Reconnaissance et traduction d’images :** Détectez le texte, superposez la traduction en suivant sa forme, comparez avec l’original, modifiez une traduction ou sélectionnez des zones manuellement.

![Reconnaissance d’image : détection, traduction, comparaison, modification et sélection de zones](../screenshots/image-recognition.gif)

**Lecture bilingue :** Extrayez le corps de l’article, retirez les publicités et alignez chaque paragraphe avec sa traduction. Choisissez une autre formulation, changez de disposition et enregistrez l’article avec sa traduction sur votre appareil.

![Lecture bilingue : extraction, traduction, reformulation, disposition et enregistrement](../screenshots/bilingual-reader.gif)

| Lecture bilingue | Formulations alternatives |
| --- | --- |
| [![Lecture bilingue](../screenshots/01-bilingual-reader.png)](../screenshots/01-bilingual-reader.png) | [![Formulations alternatives](../screenshots/02-word-alternatives.png)](../screenshots/02-word-alternatives.png) |
| **Traduction d’images** | **Mode sombre et articles enregistrés** |
| [![Traduction d’images](../screenshots/04-image-translation.png)](../screenshots/04-image-translation.png) | [![Mode sombre et articles enregistrés](../screenshots/03-reader-library.png)](../screenshots/03-reader-library.png) |
| **Traduction de la sélection** | **Traduction d’une zone de page** |
| [![Traduction de la sélection](../screenshots/06-selection-translation.png)](../screenshots/06-selection-translation.png) | [![Traduction d’une zone de page](../screenshots/09-region-translation.png)](../screenshots/09-region-translation.png) |
| **Traduction intégrale de PDF côte à côte** | **Panneau de traduction** |
| [![Traduction intégrale de PDF côte à côte](../screenshots/08-pdf-translation.png)](../screenshots/08-pdf-translation.png) | [![Panneau de traduction](../screenshots/07-translation-panel.png)](../screenshots/07-translation-panel.png) |

Consultez les [notes de capture](../screenshots/README.fr.md) pour l’environnement de capture et les exemples utilisés. L’interface capturée est en chinois simplifié ; toutes les langues de la documentation partagent ces images et GIF.

## Projet

Un dépôt, trois applications : un site HTML sur Vercel, un serveur backend sur VPS et une extension de navigateur.

| Application | Répertoire | Environnement | État |
| --- | --- | --- | --- |
| Site | [apps/web](../../apps/web/README.md) | Vercel | Présentation, confidentialité, conditions et historique des versions en 11 langues ; l’en-tête récupère l’état de connexion auprès de app.huaci.app |
| Backend | [apps/backend](../../apps/backend/README.md) | VPS | Authentification, espaces utilisateur et administrateur, API de l’extension, essai invité, comptabilité précise des crédits, traduction hébergée de textes et d’images et abonnements Creem ; première version déployée |
| Extension | [apps/extension](../../apps/extension/README.md) | Chrome / Edge | Version en boutique : 2.1.0. Code source : 2.2.0, avec lecture bilingue, reformulations, préférences terminologiques et traduction suivant la forme du texte ; publication en préparation |

## Arborescence

```text
apps/
  web/
    public/          HTML, CSS, JS, ressources et pages multilingues générées
    i18n/            Traductions du site et génération des pages
    test/            Tests du site, du changement de langue et de la CSP
  backend/
    src/             Hono : configuration, base, authentification, crédits, e-mail
    ui/account/      Espace utilisateur rendu côté serveur
    migrations/      Migrations PostgreSQL
    test/  deploy/   Tests backend et instructions de déploiement VPS
  extension/
    manifest.json    Manifeste de l’extension Chrome
    src/             Code et interface ; src/vendor/pdfjs reprend pdf.js sans modification
    icons/           Icônes de l’extension
    _locales/        Fichiers de localisation Chrome générés
    i18n/            Traductions de l’interface, registre des langues et modèles
    scripts/         Outils locaux d’extraction, traduction et compilation
    test/            Tests de l’extension
    store-assets/    Fiches de boutique, captures et visuels promotionnels
    package.sh       Outil de création des paquets de l’extension
docs/                Architecture, notes techniques et README multilingues
test/run.sh          Point d’entrée des tests du dépôt
package.sh           Point d’entrée de création des paquets
vercel.json          Déploiement Vercel et en-têtes de sécurité
dist/extension/      ZIP générés de l’extension, non versionnés
tools/               Outils locaux de capture et d’expérimentation, non versionnés
LICENSE              Licence du dépôt
PRIVACY.md           Chemin public historique de la politique de confidentialité
```

## Développement local

Les outils de développement nécessitent Node.js 22 ou ultérieur. L’aperçu du site et la création des paquets nécessitent aussi Python 3. L’extension elle-même requiert Chrome 116 ou ultérieur. Le site et l’extension utilisent les bibliothèques standard pour la compilation et les tests, sans dépendances npm. Le backend possède ses propres dépendances (`cd apps/backend && npm ci`) et nécessite PostgreSQL en local. `npm test` ignore le backend si ses dépendances ne sont pas installées.

```sh
npm run dev                   # Démarrer les services locaux ; Ctrl+C les arrête ensemble
npm test                      # Tester le site et l’extension
npm run test:web              # Tester uniquement le site
npm run test:extension        # Tester uniquement l’extension
npm run dev:web               # http://localhost:8788
npm run build:web             # Générer les pages multilingues du site
npm run check:web             # Vérifier les traductions générées du site
npm run i18n:extension        # Actualiser localement les traductions de l’extension
npm run check:extension       # Vérifier les traductions générées de l’extension
npm run package:extension     # dist/extension/ai-translation-<version>.zip
npm run package:edge          # dist/extension/ai-translation-edge-<version>.zip
npm run test:backend          # Nécessite la base PostgreSQL huaci_test
npm run migrate:backend       # Appliquer les migrations du backend
npm run dev:backend           # http://localhost:8787 — espace utilisateur
```

`npm run dev` démarre les services suivants :

| Service | Adresse |
| --- | --- |
| Backend : espace utilisateur, API de l’extension et callbacks Creem ; migrations en attente appliquées avant le démarrage | `http://localhost:8787` |
| Espace administrateur : même processus backend, sélection selon le nom d’hôte | `http://admin.localhost:8787` |
| Aperçu du site | `http://localhost:8788` |
| Surveillance des traductions de l’interface ; charger ce répertoire décompressé dans Chrome | `apps/extension` |

Les services dont le port est déjà occupé sont ignorés avec une explication. Avant de démarrer le backend, exécutez `npm ci` dans `apps/backend`, puis configurez PostgreSQL en local et `apps/backend/.env.local`.

Les points d’entrée de compatibilité `bash test/run.sh` et `bash package.sh` fonctionnent toujours depuis la racine du dépôt. Les scripts de chaque application peuvent également être exécutés depuis son propre répertoire.

Dans le mode développeur de Chrome, **Charger l’extension non empaquetée** doit cibler **`apps/extension`**, pas la racine du dépôt. Changer le chemin de l’extension de développement peut lui attribuer un nouvel identifiant et nécessiter une nouvelle configuration. Les mises à jour en boutique conservent la même fiche.

Le générateur de traductions de l’interface utilise en priorité `apps/extension/.env.local`, puis le fichier `.env.local` à la racine s’il est absent. Il accepte aussi les variables d’environnement du processus. Les clés déjà présentes à la racine peuvent y rester. Les clés API utilisées à l’exécution sont conservées uniquement dans `chrome.storage.local`. Les fichiers d’environnement et les outils de traduction de développement sont exclus des paquets.

## Déploiement

- **Site Vercel :** Gardez la racine du dépôt comme racine du projet Vercel. `vercel.json` compile `apps/web` et ne publie que `apps/web/public`. Le workflow GitHub se déclenche lors de modifications du site, de la configuration Vercel ou des points d’entrée de compilation associés.

- **Backend VPS :** `apps/backend` est déployé séparément ; le service de comptes est en ligne sur `app.huaci.app`. La transcription audio/vidéo hébergée n’est pas implémentée. Les sous-titres déjà reconnus peuvent utiliser la traduction de texte hébergée. Consultez les [instructions de déploiement](../../apps/backend/deploy/README.md).

- **Extension de navigateur :** Les paquets sont créés et publiés séparément dans les boutiques. Les ZIP contiennent uniquement `manifest.json`, `src/`, `icons/`, `_locales/` et le fichier `LICENSE` à la racine.

Consultez la [documentation d’architecture](../architecture.md) pour les responsabilités, la correspondance avec les anciens répertoires et les priorités de développement. Les conventions du dépôt se trouvent dans [AGENTS.md](../../AGENTS.md).

[Site officiel](https://huaci.app/) · [Code source](https://github.com/csswork/AiTranslation)

Publié sous licence [GPL-3.0](../../LICENSE).
