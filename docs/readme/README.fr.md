<h1 align="center">
  <img src="../../public/penecho-readme-header.png" alt="PenEcho" width="760">
</h1>

<p align="center">
  <a href="../../README.md">English</a> |
  <a href="README.zh-CN.md">简体中文</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.pt-BR.md">Português (Brasil)</a> |
  <strong>Français</strong> |
  <a href="README.de.md">Deutsch</a>
</p>

<p align="center"><strong>Pensez avec l'IA, au-delà de la fenêtre de discussion.</strong></p>

<p align="center">PenEcho est un canevas partagé où l'écriture manuscrite, les équations, les schémas et le contexte spatial font partie de la conversation.</p>

<h2 align="center">
  <a href="https://penecho.ai">Site officiel · penecho.ai</a>
</h2>

<h3 align="center"><a href="https://penecho.ai">Publiez vos idées · Collaborez · Partagez vos créations</a></h3>

<p align="center">
  <a href="https://discord.gg/3jrPJ3mXdX"><img src="https://img.shields.io/badge/Discord-Rejoindre%20la%20communauté-5865F2?style=for-the-badge&amp;logo=discord&amp;logoColor=white" alt="Rejoindre le Discord de PenEcho"></a>
  <a href="https://github.com/penecho/penecho/stargazers"><img src="https://img.shields.io/github/stars/penecho/penecho?style=for-the-badge&amp;logo=github&amp;logoColor=white&amp;color=f5b301" alt="Ajouter une étoile à PenEcho sur GitHub"></a>
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/License-AGPL%20v3-blue?style=for-the-badge" alt="Licence : AGPL v3"></a>
</p>

> Cette traduction présente une vue d'ensemble du projet. Le [README anglais](../../README.md) reste la source officielle pour les informations techniques les plus récentes et les plus complètes.

<p align="center"><img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins.webp" alt="Démonstration des diagrammes professionnels PenEcho" width="49%"> <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_full_demo.webp" alt="Démonstration complète de PenEcho" width="49%"></p>

<p align="center"><img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins_sub_x10.webp" alt="Démonstration des plugins PenEcho" width="49%"> <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/play_patris.webp" alt="Démonstration interactive du canevas PenEcho" width="49%"></p>

## Kimi Open Source Friends

PenEcho est membre officiel de **Kimi Open Source Friends**, le programme de [Moonshot AI](https://www.kimi.com/) qui soutient des projets open source remarquables. L'équipe Kimi contribue au développement avec des crédits d'API, et Kimi K3 fait partie des modèles recommandés pour les travaux exigeants mêlant écriture manuscrite et schémas.

- [Kimi Code](https://www.kimi.com/code?aff=penecho) - abonnement de programmation disponible dans le monde entier
- [Kimi Open Platform, Chine](https://platform.kimi.com?aff=penecho) - accès à l'API depuis la Chine continentale
- [Kimi Open Platform, international](https://platform.kimi.ai?aff=penecho) - accès à l'API dans les autres régions

## Démarrage rapide

### Application de bureau

[Télécharger depuis GitHub Releases](https://github.com/penecho/penecho/releases/latest).

Pour une installation avec npm, vous avez besoin de [Node.js 22.19 ou version ultérieure](https://nodejs.org/) et de l'une des options suivantes : une clé d'API, ou [Kimi Code CLI](https://github.com/MoonshotAI/kimi-code), [Codex CLI](https://developers.openai.com/codex/cli) ou [Claude Code CLI](https://code.claude.com/docs/en/overview) avec une session authentifiée.

```bash
npm install -g penecho
penecho configure
penecho
```

Ouvrez [http://localhost:3888](http://localhost:3888). `penecho configure` permet de choisir de façon interactive la source LLM, le modèle, le niveau de raisonnement, le délai d'attente, le format d'image et l'interface réseau. La configuration est enregistrée par défaut dans `~/.penecho/config.env` ; les identifiants d'API ne sont jamais envoyés au navigateur.

Pour exécuter le code source :

```bash
git clone https://github.com/penecho/penecho.git
cd penecho
npm install
npm start
```

## Pensez sur le canevas

Écrivez une question, une équation, un schéma ou une idée inachevée n'importe où sur le canevas, puis marquez une pause. PenEcho interprète les traits et leurs relations spatiales avant de placer la réponse à proximité.

- **PenEcho Agent : des sources au résultat visuel.** Ajoutez des dossiers et fichiers en lecture seule — PDF, Word, PowerPoint, Excel, images ou code —, combinez-les à la recherche Web et au canevas actuel, puis laissez le même agent poursuivre l'analyse, la planification, la création et la révision.
- **Productivité avec Visual Explorer.** Transformez des informations denses en un espace visuel adaptatif et modifiable, avec une vue d'ensemble claire, des détails reliés et des preuves. Le chemin de la recherche au résultat partageable raccourcit, avec moins de copier-coller, de changements d'outil, de schémas manuels et de reprises.
- Dessinez naturellement au stylet ou à la souris et parcourez un canevas de `20 000 x 20 000`.
- Obtenez des réponses, indices, explications, formules, graphiques et schémas directement sur le canevas.
- Déplacez et redimensionnez les brouillons de l'IA, puis acceptez-les ou rejetez-les avant de les intégrer à votre travail.
- Sélectionnez des traits au lasso pour les déplacer, redimensionner, recolorer, supprimer ou les mettre au propre avec Typeset.
- Affinez des widgets interactifs, diagrammes professionnels, animations et plugins de données en direct par modifications incrémentales.
- Enregistrez jusqu'à dix connexions API ou CLI et passez de l'une à l'autre en un clic.
- Organisez les canevas en projets, poursuivez vos projets privés sur d'autres appareils avec PenEcho Cloud et exportez le contenu confirmé au format PNG.
- Choisissez parmi les thèmes Arcane, Sci-fi, Research et Studio.

## PenEcho Cloud

[PenEcho Cloud](https://penecho.ai), lancé avec la version 1.0.0, reste entièrement facultatif : PenEcho continue de fonctionner en local avec votre propre API ou CLI. Une fois connecté, vous pouvez enregistrer des canevas privés et versionnés dans des projets, synchroniser vos favoris et accéder à distance à cet hôte via un appareil lié, sans que les identifiants d'API quittent l'appareil.

**Echoes** permet d'explorer, de mettre en favoris et de réutiliser des canevas et widgets publics dans douze catégories. Vous pouvez publier vos propres Crafts, les ouvrir dans un visualiseur Web en lecture seule et conserver leur filiation entre les versions.

## Nouveautés de la version 1.1.7

- **PenEcho Agent.** Enchaînez fichiers locaux, projets de dossiers en lecture seule, recherche Web, contexte du canevas, création visuelle et édition directe dans un seul flux en plusieurs étapes.
- **Visual Explorer.** Transformez recherches, documents, notes et plans en un résultat visuel adaptatif qui relie vue d'ensemble, détails et preuves.
- **Moins de changements de contexte et de reprises.** Recherchez, analysez, structurez, visualisez, vérifiez et révisez dans le même espace ; le résultat reste modifiable sur le canevas.
- **Livraison visuelle progressive.** Obtenez plus tôt des versions complètes de Visual Explorer et affinez-les sur place au lieu de tout régénérer.
- **Un contexte de travail plus riche.** Ajoutez PDF, Word, PowerPoint, Excel, images, code ou dossiers en lecture seule ; référencez widgets et écriture existants et utilisez la recherche Internet lorsqu'elle est disponible.

## Points forts précédents

- **1.0.0.** Introduction de PenEcho Cloud, des projets privés versionnés, des appareils liés, d'Echoes, des Crafts publics et des favoris synchronisés.
- **0.9.0.** Ajout de plusieurs connexions IA, des canevas partagés par projet, de Refine guidé sur place, des modifications incrémentales par unified diff, du streaming SSE et d'une progression annulable.
- **0.8.1.** Ajout des données publiques en direct pour General HTML et de SVG par défaut pour les animations et graphismes complexes.
- **0.8.0 et 0.7.2.** Ajout des diagrammes professionnels modifiables, du stockage serveur, des flux de presse-papiers, des photos Web sourcées et d'une édition et d'un export plus fiables.

## Versions précédentes

- **0.7.1.** Ajout des images et photos locales, de l'édition d'objets avec Hand, des instantanés, de l'export PNG, des diagrammes Mermaid copiables et des images Web sourcées.
- **0.7.0.** Introduction du HTML interactif isolé, des plugins de données en direct, de la création locale de plugins et de la persistance des widgets.
- **0.6.0 et versions antérieures.** Ajout des animations déclaratives, amélioration de Markdown/LaTeX, outils de sélection et fondation du grand canevas clairsemé.

## Fonctionnement

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="../assets/how-it-works-dark.svg"><img alt="Fonctionnement de PenEcho" src="../assets/how-it-works-light.svg"></picture></p>

Le navigateur n'envoie que la zone pertinente du canevas et sa géométrie. Le serveur valide la requête, la transmet à l'exécuteur choisi et renvoie un brouillon structuré et déplaçable. Les recommandations actuelles de modèles et les exemples de coûts figurent dans le [README anglais](../../README.md#recommended-model-configurations).

## Déploiement sécurisé

- **Kimi Code CLI, Codex CLI et Claude CLI :** utilisez-les uniquement sur la machine locale ou un réseau de confiance. Chaque requête valide lance un processus CLI local ; n'exposez donc pas directement ces modes à Internet.
- **Mode API :** en cas d'accès public, placez PenEcho derrière un proxy HTTPS avec authentification et limites de fréquence et de taille des requêtes.
- Ne publiez pas les fichiers de configuration, clés d'API, traces de requêtes, journaux ou images privées du canevas.

## Contribuer au projet

Avant de proposer une modification, exécutez :

```bash
npm run check
```

Consultez les [notes d'architecture](../architecture.md) et [CONTRIBUTING.md](../../CONTRIBUTING.md). Partagez vos questions et exemples sur [Discord](https://discord.gg/3jrPJ3mXdX) ou [GitHub Discussions](https://github.com/penecho/penecho/discussions), et signalez les problèmes reproductibles dans [GitHub Issues](https://github.com/penecho/penecho/issues).

## Licence et utilisation commerciale

PenEcho est publié sous [GNU AGPL v3.0 only](../../LICENSE). L'utilisation commerciale est autorisée, mais si vous proposez une version modifiée à des utilisateurs via un réseau, vous devez leur fournir le code source correspondant conformément à l'AGPL. Une [licence commerciale](../../COMMERCIAL-LICENSE.md) distincte est disponible pour les produits propriétaires et services hébergés qui ne peuvent pas respecter l'AGPL. Le nom et le logo sont régis séparément par la [politique relative aux marques](../../TRADEMARKS.md).
