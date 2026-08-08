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

Pour une installation avec npm, vous avez besoin de [Node.js 20.3 ou version ultérieure](https://nodejs.org/) et de l'une des options suivantes : une clé d'API, un [Codex CLI](https://developers.openai.com/codex/cli) authentifié ou un [Claude Code CLI](https://code.claude.com/docs/en/overview) authentifié.

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

- Dessinez naturellement au stylet ou à la souris et parcourez un canevas de `20 000 x 20 000`.
- Obtenez des réponses, indices, explications, formules, graphiques et schémas directement sur le canevas.
- Déplacez et redimensionnez les brouillons de l'IA, puis acceptez-les ou rejetez-les avant de les intégrer à votre travail.
- Sélectionnez des traits au lasso pour les déplacer, redimensionner, recolorer, supprimer ou les mettre au propre avec Typeset.
- Enregistrez les instantanés sur cet appareil ou sur le serveur PenEcho et exportez le contenu confirmé au format PNG.
- Choisissez parmi les thèmes Arcane, Sci-fi, Research et Studio.

## Nouveautés de la version 0.9.0

- **Plusieurs connexions IA, sélectionnables en un clic.** Enregistrez jusqu'à dix connexions API ou CLI, utilisez les préréglages Kimi et MiniMax modifiables, testez-les dans le canevas et choisissez une connexion active propre à chaque client d'un même hôte PenEcho. Les changements s'appliquent immédiatement.
- **Canevas partagés organisés par projets.** Classez les canevas du serveur dans des projets, déplacez le travail entre eux et parcourez de plus grands aperçus triés par dernière modification. Le bundle v2 versionné regroupe tuiles, widgets, images placées, ressources et métadonnées d'aperçu ; les canevas v1 restent lisibles et sont mis à niveau lors de leur prochain enregistrement.
- **Refine guidé et appliqué sur place.** Écrivez ou placez de nouvelles consignes n'importe où dans la zone visible, puis choisissez le widget à mettre à jour. PenEcho relie clairement la zone d'instructions à sa cible et demande confirmation ; une annulation ou un échec conserve les consignes, et une modification réussie reste confirmable et annulable.
- **Modifications incrémentales plus petites avec un unified diff standard.** Refine envoie les fichiers modifiables complets du widget, mais le modèle ne renvoie que les blocs modifiés au lieu de régénérer tout le widget. Cela réduit fortement les tokens de sortie et le délai, tout en appliquant atomiquement HTML, source et métadonnées du widget.
- **Vrai streaming API.** Les API compatibles OpenAI et Anthropic utilisent maintenant SSE de bout en bout afin de signaler immédiatement les données reçues et de stabiliser les requêtes longues via les passerelles compatibles.
- **Progression et annulation claires.** L'état supérieur indique préparation, connexion, attente, réception, validation, nouvelles tentatives et délais. Pendant une requête, le bouton magique arrête immédiatement le travail actif.

## Points forts précédents

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

- **Codex CLI et Claude CLI :** utilisez-les uniquement sur la machine locale ou un réseau de confiance. Chaque requête valide lance un processus CLI local ; n'exposez donc pas directement ces modes à Internet.
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
