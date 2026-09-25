<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../public/penecho-readme-header-dark.webp">
    <img src="../../public/penecho-readme-header.webp" alt="PenEcho" width="280">
  </picture>
</p>

<h1 align="center">Réfléchissez sur un canevas avec n’importe quelle IA.</h1>

<p align="center">Dessinez à la main. L’Agent intégré de PenEcho, Codex, Claude Code ou tout client MCP transforme vos idées en schémas, documents et widgets fonctionnels à côté de vos notes.</p>

<p align="center">
  <a href="https://github.com/penecho/penecho/releases/latest"><img src="https://img.shields.io/badge/release-v1.3.4-087f83" alt="Release v1.3.4"></a>
  <a href="https://www.npmjs.com/package/penecho"><img src="https://img.shields.io/badge/npm-penecho-cb3837" alt="npm penecho"></a>
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="AGPL-3.0-only"></a>
  <a href="https://discord.gg/3jrPJ3mXdX"><img src="https://img.shields.io/badge/discord-join-5865f2" alt="Discord"></a>
  <a href="../mcp-setup.md"><img src="https://img.shields.io/badge/MCP-ready-6f42c1" alt="MCP"></a>
</p>

<p align="center">
  <a href="https://github.com/penecho/penecho/releases/latest"><img src="https://img.shields.io/badge/DOWNLOAD_FOR_MACOS-24292f?style=for-the-badge&amp;logo=apple&amp;logoColor=white" alt="macOS"></a>
  <a href="https://github.com/penecho/penecho/releases/latest"><img src="https://img.shields.io/badge/DOWNLOAD_FOR_WINDOWS-0969da?style=for-the-badge&amp;logo=windows&amp;logoColor=white" alt="Windows"></a>
  <a href="https://penecho.ai"><img src="https://img.shields.io/badge/OPEN_PENECHO.AI-087f83?style=for-the-badge&amp;logo=googlechrome&amp;logoColor=white" alt="penecho.ai"></a>
</p>

<p align="center">
  <a href="#quick-start">Démarrage rapide</a> ·
  <a href="#connect-your-ai-agent-mcp">Connecter votre agent IA (MCP)</a> ·
  <a href="../">Documentation</a> ·
  <a href="https://discord.gg/3jrPJ3mXdX">Discord</a>
</p>

<p align="center"><sub><a href="../../README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a> ·
  <a href="README.ru.md">Русский</a> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.pt-BR.md">Português</a> ·
  <strong>Français</strong> ·
  <a href="README.de.md">Deutsch</a></sub></p>

<p align="center">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_full_demo.webp" alt="PenEcho" width="100%">
</p>
<p align="center"><em>Du croquis au résultat interactif sur un même canevas.</em></p>

## Ce que vous pouvez faire

<table width="100%">
  <tr>
    <td width="33%" valign="top">
      <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins_sub_x10.webp" alt="Dessiner, puis demander" width="100%"><br>
      <strong>Dessiner, puis demander</strong><br>
      Écriture manuscrite, équations, texte et images sur un canevas infini. L’IA répond automatiquement lorsque vous faites une pause.
    </td>
    <td width="33%" valign="top">
      <a href="../assets/professional-diagrams/kubernetes.webp"><img src="../assets/professional-diagrams/previews/kubernetes.webp" alt="Cluster Kubernetes" width="100%"></a><br>
      <strong>Schémas professionnels</strong><br>
      Schémas d’architecture, de séquence et de flux avec disposition automatique. Export en SVG ou PNG.
    </td>
    <td width="33%" valign="top">
      <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/play_patris.webp" alt="Widgets fonctionnels" width="100%"><br>
      <strong>Widgets fonctionnels</strong><br>
      Calculatrices, quiz et prototypes utilisables sur le canevas, à ajouter aux favoris ou à partager.
    </td>
  </tr>
</table>

<a id="quick-start"></a>
## Démarrage rapide

| | Pour commencer |
| --- | --- |
| **Application de bureau** | Téléchargez la version macOS ou Windows depuis [GitHub Releases](https://github.com/penecho/penecho/releases/latest). Tout est inclus et les mises à jour sont automatiques. |
| **npm** | Nécessite Node.js 22.19 ou plus récent. Lancez `npm i -g penecho`, puis `penecho` et ouvrez `localhost:3888`. |
| **Navigateur** | Connectez-vous à [penecho.ai](https://penecho.ai) pour les modèles hébergés et les canevas Cloud. Aucune installation requise. |

```bash
npm install -g penecho
penecho             # http://localhost:3888
```

> [!TIP]
> Au premier démarrage, choisissez un code d’accès à six chiffres ou un accès ouvert sur un réseau de confiance. Dans **Paramètres → IA et connexions**, ajoutez votre clé API, un CLI Codex / Claude Code / Kimi connecté ou les modèles PenEcho.

<details>
<summary>Exécuter depuis les sources</summary>

```bash
git clone https://github.com/penecho/penecho.git
cd penecho
npm install
npm start
```

</details>

<a id="connect-your-ai-agent-mcp"></a>
## Connecter votre agent IA (MCP)

Continuez à discuter dans l’agent que vous utilisez déjà. Il dessine sur le canevas, vous annotez le résultat et il lit vos remarques au tour suivant.

1. Dans PenEcho, ouvrez **Paramètres → Service MCP** et activez le canevas actuel.
2. Utilisez la **Configuration automatique** pour un client compatible ou copiez les instructions générées dans Codex, Claude Code, Kimi, Cursor, etc. Avec une installation npm globale, les clients acceptant le JSON `mcpServers` peuvent aussi utiliser cette configuration compatible :

   ```json
   {
     "mcpServers": {
       "penecho": { "command": "penecho", "args": ["mcp"] }
     }
   }
   ```

3. Demandez : *« Affiche l’architecture dont nous avons parlé sur mon canevas PenEcho. »*

<p align="center"><a href="../assets/mcp-spatial-example.webp"><img src="../assets/mcp-spatial-example.webp" alt="Une discussion d’architecture avec l’IA, accompagnée de retours manuscrits à côté de la proposition sur un Canvas PenEcho" width="760"></a></p>
<p align="center"><em>Une discussion d’architecture dans Claude Code, annotée à la main sur le canevas.</em></p>

> [!NOTE]
> Les agents ne voient que les canevas que vous activez. Local MCP reste sur votre ordinateur ; Cloud MCP est une connexion authentifiée distincte pour les canevas Cloud. [Guide MCP →](../mcp-setup.md)

## Galerie de schémas

<table width="100%">
  <tr>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/kubernetes.webp"><img src="../assets/professional-diagrams/previews/kubernetes.webp" alt="Cluster Kubernetes" width="100%"></a><br><strong>Cluster Kubernetes</strong></td>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/migration.webp"><img src="../assets/professional-diagrams/previews/migration.webp" alt="Monolithe → microservices" width="100%"></a><br><strong>Monolithe → microservices</strong></td>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/notifications.webp"><img src="../assets/professional-diagrams/previews/notifications.webp" alt="Notifications événementielles" width="100%"></a><br><strong>Notifications événementielles</strong></td>
  </tr>
  <tr>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/mcp-request.webp"><img src="../assets/professional-diagrams/previews/mcp-request.webp" alt="Comment MCP atteint le canevas" width="100%"></a><br><strong>Comment MCP atteint le canevas</strong></td>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/release.webp"><img src="../assets/professional-diagrams/previews/release.webp" alt="Publication : tâches parallèles" width="100%"></a><br><strong>Publication : tâches parallèles</strong></td>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/rollout.webp"><img src="../assets/professional-diagrams/previews/rollout.webp" alt="Déploiement multirégion" width="100%"></a><br><strong>Déploiement multirégion</strong></td>
  </tr>
</table>

<p align="center"><sub>Cliquez sur un schéma pour l’ouvrir en grand.</sub></p>

## Fonctionnement

<p align="center"><img src="../../public/penecho-architecture.webp" alt="Architecture PenEcho : un navigateur se connecte à PenEcho Cloud ou à votre PC local. Le Cloud propose des modèles hébergés et se connecte à votre appareil lié. Votre PC exécute PenEcho CLI ou App avec votre API de modèle ou vos agents. Les agents IA externes peuvent utiliser Cloud MCP ou Local MCP ; les deux connexions sont facultatives." width="100%"></p>

- **Sur votre ordinateur** — L’application de bureau ou le CLI sert le canevas et utilise votre API de modèle ou votre Agent CLI.
- **Dans le cloud** — penecho.ai propose des modèles hébergés, des projets et favoris synchronisés et peut accéder à votre ordinateur lié.
- **Votre agent** — Il se connecte par Local ou Cloud MCP. Les deux sont facultatifs.

Détails: [notes d’architecture](../architecture.md).

## Choisir votre IA

| Connexion | Coût | Idéal pour |
| --- | --- | --- |
| **Modèles PenEcho** — connectez-vous et choisissez un modèle | Crédits du compte | Démarrer sans clé |
| **Votre API de modèle** — OpenAI / Anthropic | Votre fournisseur | Maîtrise du modèle et des coûts |
| **Votre CLI** — Codex, Claude Code, Kimi | Votre abonnement | Réutiliser un abonnement existant |

Quel modèle et quel niveau d’effort choisir : [Modèles recommandés](#recommended-models) (mis à jour à chaque version).

<a name="recommended-models"></a>
<details>
<summary>Modèles recommandés</summary>

Ces recommandations équilibrent qualité et latence pour de vraies tâches sur le canevas PenEcho d’après des essais récents ; le temps de réponse dépend du fournisseur, de la complexité du canevas et du raisonnement.

| Modèle | Effort | Remarques | Usage recommandé |
| --- | --- | --- | --- |
| Claude Opus 4.8 / 5.0 (`claude-opus-4-8` / `claude-opus-5-0`) | `medium` | Très bonne qualité et meilleur équilibre de latence | Travail quotidien sur le canevas |
| Claude Opus 4.8 / 5.0 (`claude-opus-4-8` / `claude-opus-5-0`) | `high` | Meilleure qualité de raisonnement, attentes plus longues et variables | Écriture manuscrite, mathématiques, schémas ou mises en page complexes |
| Fable 5 (`claude-fable-5` ou `fable`) | `medium` | Temps de réponse souvent proche de la moitié de celui de `gpt-5.6-sol` à `xhigh` | Usage général rapide et de haute qualité |
| [Kimi K3](https://platform.kimi.ai?aff=penecho) (`kimi-k3`) | `medium` | Très bonne qualité ; `medium` conserve un équilibre pratique | Réglage Kimi recommandé par défaut |
| `gpt-5.6-terra` | `low` à `high` | Étonnamment performant et réactif | Objectifs flexibles de qualité et de latence |
| `gpt-5.6-luna` | `xhigh` | Très bons résultats sur le canevas et grande rapidité | Priorité à la qualité tout en restant réactif |
| `gpt-5.6-sol` | `high` | Suffisant pour la plupart des demandes, plus réactif que `xhigh` | Réglage par défaut lorsque la réactivité compte |
| `gpt-5.6-sol` | `xhigh` | Très bon, mais plus lent et variable | Tâches de canevas difficiles |
| `deepseek-v4-flash-vision-exp` | `medium` | Bon | Travail avec vision via l’API DeepSeek |
| `glm-5.3-flash` | `medium` | Bon | Travail rapide via l’API GLM compatible Anthropic |

</details>

## Nouveautés de la version 1.3.3

- **Schémas d’architecture, de séquence et de flux** Avec disposition automatique, connexions acheminées et export SVG / PNG.
- **Bibliothèque de canevas** Avec pagination, recherche, filtres de projets et tri.
- **Davantage de préréglages de fournisseurs API** Les listes de modèles sont récupérées automatiquement.

[Journal complet des modifications →](../../CHANGELOG.md#133)

## Communauté

| [Discord](https://discord.gg/3jrPJ3mXdX) | [Discussions](https://github.com/penecho/penecho/discussions) | [Issues](https://github.com/penecho/penecho/issues) | [Contributing](../../CONTRIBUTING.md) |
| --- | --- | --- | --- |
| Échanger avec l’équipe | Idées et questions | Signaler un bogue | Exécuter d’abord `npm run check` |

Distribué sous licence [AGPL-3.0-only](../../LICENSE) ; une [licence commerciale](../../COMMERCIAL-LICENSE.md) est également disponible. Consultez la [politique de marque](../../TRADEMARKS.md) et l’[accord de contribution](../../CONTRIBUTOR-LICENSE-AGREEMENT.md).

Les moteurs de schémas adaptent des fonctions SVG et géométriques de [Archify](https://github.com/tt-a1i/archify) par tt-a1i (MIT). Voir [NOTICE](../../NOTICE).

<p align="center">
  <a href="https://www.kimi.com/code?aff=penecho">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="../assets/kimi-open-source-friends-dark.svg">
      <img src="../assets/kimi-open-source-friends-light.svg" alt="Kimi Open Source Friends" width="326" height="56">
    </picture>
  </a>
</p>

<p align="center">
  <a href="https://www.star-history.com/?repos=penecho%2Fpenecho&amp;type=date&amp;legend=top-left">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=penecho/penecho&amp;type=date&amp;theme=dark&amp;legend=top-left">
      <img src="https://api.star-history.com/chart?repos=penecho/penecho&amp;type=date&amp;legend=top-left" alt="PenEcho GitHub stars" width="800">
    </picture>
  </a>
</p>
