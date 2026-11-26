<p align="center">
  <a href="https://penecho.ai/lines.html">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="../assets/penecho-lines-logo-dark.svg">
      <img src="../assets/penecho-lines-logo.svg" alt="PenEcho Lines" width="340">
    </picture>
  </a>
</p>

<h3 align="center">Pas un agent IA de plus. Une meilleure façon de travailler avec les vôtres.</h3>

<p align="center">
  Dessinez ce que vous voulez dire, suivez chaque tâche comme une ligne et laissez un agent relire le travail d’un autre.<br>
  Fonctionne avec les agents que vous utilisez déjà. Open source, gratuit sur votre ordinateur, sans compte.
</p>

<p align="center">
  <a href="https://penecho.ai">Site web</a> &nbsp;·&nbsp;
  <a href="#install">Télécharger</a> &nbsp;·&nbsp;
  <a href="https://penecho.ai/try.html">Essayer dans le navigateur</a> &nbsp;·&nbsp;
  <a href="https://penecho.ai/leaderboard">Classement des agents</a> &nbsp;·&nbsp;
  <a href="https://discord.gg/3jrPJ3mXdX">Discord</a> &nbsp;·&nbsp;
  <a href="https://buymeacoffee.com/penecho">Offrir un café</a>
</p>

<p align="center">
  <sub>
    <a href="../../README.md">English</a> ·
    <a href="README.zh-CN.md">简体中文</a> ·
    <a href="README.ja.md">日本語</a> ·
    <a href="README.ko.md">한국어</a> ·
    <a href="README.ru.md">Русский</a> ·
    <a href="README.es.md">Español</a> ·
    <a href="README.pt-BR.md">Português</a> ·
    <strong>Français</strong> ·
    <a href="README.de.md">Deutsch</a>
  </sub>
</p>

---

<a name="quick-start"></a>
<a name="install"></a>

## Installer

<a href="https://github.com/penecho/penecho/releases/latest"><img src="https://img.shields.io/badge/release-v1.5.0-2563eb" alt="Release v1.5.0"></a>
<img src="https://img.shields.io/badge/macOS%20·%20Windows%20·%20Linux-64748b" alt="macOS, Windows, Linux">
<a href="../../LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-64748b" alt="AGPL-3.0"></a>

| | |
| :--- | :--- |
| **Application de bureau** | Téléchargez pour macOS ou Windows sur [penecho.ai](https://penecho.ai/downloads.html). |
| **npm** | `npm install -g penecho`, puis `penecho` (Node.js 22.19 ou plus récent). |
| **Navigateur** | Ouvrez [penecho.ai](https://penecho.ai). Rien à installer. |

Choisissez un code d’accès, ouvrez un dossier de projet et ajoutez vos agents dans **Réglages → Agents**. Utilisez les abonnements d’agents que vous payez déjà, votre propre clé API ou les modèles PenEcho.

Nouveau dans la 1.5.0 : Lines, revue en un clic, Orchestrator avec notes réelles, économies de tokens prouvées et partage de Canvas en direct. Voir le [journal des modifications](../../CHANGELOG.md#150).

### Lancer depuis les sources

Il vous faut Git et Node.js 22.19 ou plus récent. Les pages compilées font déjà partie du dépôt, aucune étape de build n’est nécessaire.

```bash
git clone https://github.com/penecho/penecho.git
cd penecho
npm install
npm start        # PenEcho s’ouvre sur http://localhost:3888
```

Pour lancer l’application de bureau depuis les sources, exécutez `npm run desktop:deps` une fois, puis `npm run desktop`. `npm run check` lance toutes les vérifications et tous les tests.

---

## Voir en 3 minutes

Une vraie tâche de bout en bout : un agent construit, un autre relit, les corrections repartent et vous avez le dernier mot.

<p align="center">
  <a href="https://penecho.ai/lines.html#film">
    <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_lines.gif" alt="Film PenEcho Lines : entourez une capture, choisissez un agent, revue en un clic, envoyez les corrections, prêt 5 sur 5, l’Orchestrator choisit les agents selon leur historique" width="100%">
  </a>
</p>
<p align="center"><a href="https://penecho.ai/lines.html#film">▶ Regarder le film complet</a></p>

<p align="center">
  <img src="../assets/penecho-lines-architecture.svg" alt="Comment une tâche arrive à vos agents : PenEcho envoie une tâche directe à un agent, ou une tâche via l’Orchestrator découpée entre plusieurs agents. Les agents travaillent dans le dossier du projet et partagent le même historique Markdown : MEMORY.md, lines et works." width="880">
</p>

Confiez une tâche directement à un agent, ou passez-la à l’Orchestrator qui la découpe et choisit un agent pour chaque partie. Tous les agents travaillent dans votre dossier et conservent le même historique en Markdown simple.

---

## Ce que vous obtenez

<table width="100%">
  <tr>
    <td width="50%" valign="top">
      <strong>Des agents qui collaborent sur une tâche</strong><br>
      Un agent développe, un autre relit en un clic et <em>Send fixes</em> renvoie les remarques sur la même Line.
    </td>
    <td width="50%" valign="top">
      <strong>Économies de tokens prouvées</strong><br>
      Continue ou repart à zéro selon ce qui coûte le moins, et affiche ce que chaque tâche a économisé.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>Un Orchestrator qui apprend</strong><br>
      Découpe les gros chantiers, choisit les agents d’après leurs résultats réels et note chaque rendu pour s’affiner.
    </td>
    <td width="50%" valign="top">
      <strong>Tous vos agents synchronisés</strong><br>
      Les sessions Claude Code, Codex, Kimi, OpenCode et autres se synchronisent. Reprenez n’importe laquelle avec l’agent de votre choix.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>Des centaines de tâches sur un écran</strong><br>
      Ask, En cours, Besoin de vous, À relire, Terminé. Voyez d’un coup d’œil ce qui vous attend.
    </td>
    <td width="50%" valign="top">
      <strong>Dessinez ce que vous voulez dire</strong><br>
      Entourez une capture, esquissez un prototype, créez diagrammes et diapositives. Les agents voient vos tracés avec vos mots.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>Du Markdown simple qui vous appartient</strong><br>
      Chaque Line est un fichier Markdown dans votre dossier, avec un seul <code>MEMORY.md</code> par projet. Lisible partout.
    </td>
    <td width="50%" valign="top">
      <strong>Partagez avec un seul lien</strong><br>
      Partagez un projet ou un Canvas par lien. Vos collègues l’ouvrent dans leur navigateur pour relire et annoter.
    </td>
  </tr>
</table>

Fonctionne avec Claude Code, Codex, OpenCode, Antigravity, Kimi, Pi, DeepSeek Harness, omp et le moteur intégré de PenEcho.

---

## Canvas AI

Écrivez, esquissez ou entourez un élément, et la réponse apparaît exactement là où vous avez dessiné.

<p align="center">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_full_demo.webp" alt="Équations, exercices de physique, croquis et labyrinthe résolus sur un PenEcho Canvas" width="720">
</p>
<p align="center"><sub><strong>Dessinez et demandez</strong> — écriture manuscrite, équations, croquis et labyrinthes.</sub></p>

---

## Kimi Open Source Friends

<p align="center">
  <a href="https://www.kimi.com/code?aff=penecho">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="../assets/kimi-open-source-friends-dark.svg">
      <img src="../assets/kimi-open-source-friends-light.svg" alt="Kimi Open Source Friends" width="280">
    </picture>
  </a>
</p>

PenEcho fait partie des Kimi Open Source Friends. Kimi Code fonctionne dans PenEcho comme n’importe quel autre agent : ajoutez-le dans **Réglages → Agents** ou [obtenez Kimi Code](https://www.kimi.com/code?aff=penecho).

---

<a name="support-penecho"></a>
<a name="buy-us-a-coffee"></a>

## Plus

- **Communauté :** [Site web](https://penecho.ai) · [Classement](https://penecho.ai/leaderboard) · [Discord](https://discord.gg/3jrPJ3mXdX) · [Discussions](https://github.com/penecho/penecho/discussions) · [Issues](https://github.com/penecho/penecho/issues) · [Contribuer](../../CONTRIBUTING.md)
- **Soutenir :** si PenEcho vous a fait gagner un après-midi, [offrez-nous un café](https://buymeacoffee.com/penecho) ou [soutenez-nous sur GitHub](https://github.com/sponsors/penecho). Une étoile ou un bon rapport de bug aide tout autant.
- **Documentation :** [Architecture](../architecture.md) · [Project Lines](../project-lines.md) · [Configuration MCP](../mcp-setup.md) · [Journal des modifications](../../CHANGELOG.md)
- **Licence :** [AGPL-3.0-only](../../LICENSE), avec une [licence commerciale](../../COMMERCIAL-LICENSE.md) disponible. Voir la [politique de marque](../../TRADEMARKS.md) et le [CLA](../../CONTRIBUTOR-LICENSE-AGREEMENT.md). Les moteurs de rendu de diagrammes adaptent du code d’[Archify](https://github.com/tt-a1i/archify) par tt-a1i (MIT) ; voir [NOTICE](../../NOTICE).

<details>
<summary><strong>Historique des étoiles</strong></summary>
<br>
<p align="center">
  <a href="https://www.star-history.com/?repos=penecho%2Fpenecho&amp;type=date&amp;legend=top-left">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=penecho/penecho&amp;type=date&amp;theme=dark&amp;legend=top-left">
      <img src="https://api.star-history.com/chart?repos=penecho/penecho&amp;type=date&amp;legend=top-left" alt="PenEcho GitHub star history chart" width="760">
    </picture>
  </a>
</p>
</details>
