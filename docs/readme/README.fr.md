<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../public/penecho-readme-header-dark.webp">
    <img src="../../public/penecho-readme-header.webp" alt="PenEcho" width="320">
  </picture>
</p>

<h1 align="center">Pas un agent IA de plus. Une meilleure façon de travailler avec les vôtres.</h1>

<p align="center">Chaque tâche confiée à Claude Code, Codex ou tout autre agent devient une ligne que vous suivez d’un coup d’œil, de votre Ask jusqu’au travail relu.<br>Un long travail coûte environ moitié moins, et quand les mots ne suffisent pas, vous dessinez ce que vous voulez dire sur le Canvas.</p>

<p align="center">
  <a href="https://github.com/penecho/penecho/releases"><img src="https://img.shields.io/badge/release-v1.5.0-475569" alt="Release v1.5.0"></a>
  <a href="https://www.npmjs.com/package/penecho"><img src="https://img.shields.io/badge/npm-penecho-475569" alt="npm penecho"></a>
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-475569" alt="AGPL-3.0-only"></a>
  <a href="https://discord.gg/3jrPJ3mXdX"><img src="https://img.shields.io/badge/discord-join-475569" alt="Join Discord"></a>
  <a href="../mcp-setup.md"><img src="https://img.shields.io/badge/MCP-ready-475569" alt="MCP ready"></a>
</p>

<p align="center">
  <a href="https://github.com/penecho/penecho/releases"><img src="https://img.shields.io/badge/DOWNLOAD_FOR_MACOS-0f172a?style=for-the-badge&amp;logo=apple&amp;logoColor=white" alt="Download for macOS"></a>
  <a href="https://github.com/penecho/penecho/releases"><img src="https://img.shields.io/badge/DOWNLOAD_FOR_WINDOWS-475569?style=for-the-badge&amp;logo=windows&amp;logoColor=white" alt="Download for Windows"></a>
  <a href="https://penecho.ai"><img src="https://img.shields.io/badge/TRY_IN_THE_BROWSER-475569?style=for-the-badge&amp;logo=googlechrome&amp;logoColor=white" alt="Try in the browser at penecho.ai"></a>
  <a href="https://buymeacoffee.com/penecho"><img src="https://img.shields.io/badge/BUY_US_A_COFFEE-475569?style=for-the-badge&amp;logo=buymeacoffee&amp;logoColor=white" alt="Buy us a coffee"></a>
</p>

<p align="center">
  <a href="#why-work-on-lines">Pourquoi des lignes</a> ·
  <a href="#from-ask-to-reviewed">Comment ça marche</a> ·
  <a href="#hand-over-the-whole-job">Orchestrator</a> ·
  <a href="#quick-start">Démarrage rapide</a> ·
  <a href="#connect-your-ai-agent">Connecter votre agent</a> ·
  <a href="#whats-new-in-150">Nouveautés de la 1.5</a> ·
  <a href="#buy-us-a-coffee">Offrez-nous un café</a>
</p>

<p align="center">
  <sub><a href="../../README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a> ·
  <a href="README.ru.md">Русский</a> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.pt-BR.md">Português</a> ·
  <strong>Français</strong> ·
  <a href="README.de.md">Deutsch</a></sub>
</p>

<p align="center">
  <a href="https://penecho.ai/lines.html#film"><img src="../assets/release-1.5/lines-film.webp" alt="PenEcho Lines en deux minutes : chaque tâche est une ligne que vous suivez d’un coup d’œil" width="100%"></a>
</p>
<p align="center"><a href="https://penecho.ai/lines.html#film"><strong>▶ PenEcho Lines en 2 minutes</strong></a> · <a href="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_lines.mp4">Télécharger le MP4</a></p>

<p align="center"><sub>Open source et gratuit sur votre ordinateur. Si PenEcho vous fait gagner du temps, <a href="https://buymeacoffee.com/penecho">un café ☕</a> l’aide à continuer.</sub></p>

<a name="why-work-on-lines"></a>

## Pourquoi travailler sur des lignes

<p align="center"><img src="../assets/release-1.5/lines-benefits.webp" alt="Un long travail, environ un tiers moins cher : une nouvelle tâche part du petit fichier de la ligne, pas d’une longue conversation. Montrez-le sur un Canvas : dessinez un prototype, annotez une image ou demandez un schéma ou des diapositives. Confiez tout le travail : l’Orchestrator découpe un gros travail, met le bon agent sur chaque partie, vérifie chaque résultat et rend compte une seule fois. En dessous : chaque tâche est une ligne, de l’Ask à Relu, les Topics, une mémoire de projet partagée, n’importe quel agent poursuit la même ligne, du Markdown simple lisible partout." width="100%"></p>

<sub>Les économies sont comparées à la reprise de la même conversation : les longs travaux économisent le plus, les tâches courtes moins.</sub>

<a name="from-ask-to-reviewed"></a>

## De l’Ask à Relu

<table width="100%">
  <tr>
    <td width="33%" valign="top">
      <img src="../assets/release-1.5/lines-step-ask.webp" alt="La zone de saisie de la page Home d’un projet, avec une question tapée et Schéma choisi" width="100%"><br>
      <strong>1 · Demandez</strong><br>
      Écrivez ce que vous voulez. Choisissez un schéma, un Explorer ou des diapositives si vous voulez une réponse en image.
    </td>
    <td width="33%" valign="top">
      <img src="../assets/release-1.5/lines-step-work.webp" alt="La page de la ligne pendant que Claude Code travaille sur l’Ask" width="100%"><br>
      <strong>2 · Un agent travaille</strong><br>
      Lancez-le avec l’agent de votre choix. La ligne montre ce qu’il fait, et vous pouvez l’arrêter à tout moment.
    </td>
    <td width="33%" valign="top">
      <img src="../assets/release-1.5/lines-step-review.webp" alt="La même ligne marquée Terminée, avec le schéma dessiné par l’agent" width="100%"><br>
      <strong>3 · Vous relisez</strong><br>
      Le résultat attend avec le statut À relire. Marquez-le comme relu, ou ajoutez l’Ask suivant sur la même ligne.
    </td>
  </tr>
</table>

### Dessinez ce que vous voulez dire

<table width="100%">
  <tr>
    <td width="50%" valign="top">
      <img src="../assets/release-1.5/lines-canvas-feedback.webp" alt="Un schéma d’architecture sur le Canvas avec une boîte entourée en rouge et une flèche vers une autre" width="100%"><br>
      <strong>Vous entourez une boîte</strong> et écrivez : « Déplace ce que j’ai entouré dans la boîte docs folder. »
    </td>
    <td width="50%" valign="top">
      <img src="../assets/release-1.5/lines-canvas-result.webp" alt="Le même Canvas après le passage de l’agent : la boîte entourée est maintenant dans la boîte docs folder" width="100%"><br>
      <strong>L’agent le voit avec vos mots</strong> et déplace cette boîte. La ligne reste à côté du Canvas tout du long.
    </td>
  </tr>
</table>

### Les Topics gardent ce que le projet sait

<p align="center"><img src="../assets/release-1.5/lines-topics.webp" alt="L’onglet Topics : un arbre des sujets du projet à côté d’une carte qui relie chaque Topic au projet" width="860"></p>

Après chaque tâche, l’agent classe ce qu’il a appris sous le sujet concerné. Un Topic se lit comme une page : ce qui est voulu, ce qui est fait et ce qui reste. Chaque agent lit la mémoire du projet avant de commencer.

<a name="hand-over-the-whole-job"></a>

## Confiez tout le travail

<p align="center"><img src="../assets/release-1.5/lines-orchestrator.webp" alt="L’onglet Orchestrator : confiez tout le travail, avec six raisons : découpe les gros travaux, le bon agent pour chaque partie, note chaque travail terminé, surveille et vérifie, rien de caché, utilise les agents que vous avez" width="860"></p>

Confiez un gros travail à un agent dans l’onglet **Orchestrator** d’un projet. Il découpe le travail, met le bon agent sur chaque partie, vérifie chaque résultat au regard de votre objectif et rend compte une seule fois.

- **Le bon agent pour chaque partie :** des modèles puissants sur les parties difficiles, moins chers sur les parties simples, pour le meilleur résultat au prix payé.
- **Il apprend qui est bon en quoi :** chaque travail terminé est noté, et ces notes choisissent les agents du prochain travail du même type.
- **Rien de caché :** chaque partie est une ligne ordinaire que vous pouvez ouvrir, réorienter ou arrêter, avec ce qu’elle a coûté.
- **Les agents que vous avez déjà :** Claude Code, Codex, OpenCode, Kimi et d’autres, sur votre propre ordinateur.

## Le Canvas intégré

<table width="100%">
  <tr>
    <td width="33%" valign="top">
      <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins_sub_x10.webp" alt="PenEcho répond aux notes et croquis sur une toile" width="100%"><br>
      <strong>Esquissez, puis demandez</strong><br>
      Écriture manuscrite, équations, texte et images sur une toile infinie. PenEchoLLM suggère l’étape suivante quand vous faites une pause.
    </td>
    <td width="33%" valign="top">
      <a href="../assets/professional-diagrams/kubernetes.webp"><img src="../assets/professional-diagrams/previews/kubernetes.webp" alt="Kubernetes architecture diagram" width="100%"></a><br>
      <strong>Schémas professionnels</strong><br>
      Schémas d’architecture, de séquence et de flux avec mise en page automatique. Export en SVG ou PNG.
    </td>
    <td width="33%" valign="top">
      <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/play_patris.webp" alt="Widget interactif qui tourne sur une toile PenEcho" width="100%"><br>
      <strong>Des widgets qui marchent</strong><br>
      Calculatrices, quiz et prototypes qui tournent sur la toile et peuvent être mis en favoris ou partagés.
    </td>
  </tr>
</table>

**Nouveau dans la 1.5 : dessinez ensemble.** Un clic crée un lien où chacun peut dessiner avec vous et votre agent, en direct, sans compte. Les liens en lecture seule se mettent à jour pendant que vous travaillez, et tout Canvas se télécharge en PDF.

<a name="quick-start"></a>

## Démarrage rapide

| | Pour commencer |
| --- | --- |
| **Application de bureau** | macOS et Windows sur [GitHub Releases](https://github.com/penecho/penecho/releases). Tout est inclus, et elle se met à jour toute seule. |
| **npm** | Node.js 22.19+. Lancez `npm i -g penecho`, puis `penecho`, et ouvrez `localhost:3888`. |
| **Navigateur** | Connectez-vous sur [penecho.ai](https://penecho.ai) pour les modèles hébergés et les toiles dans le cloud. Rien à installer. |

```bash
npm install -g penecho
penecho             # ouvre http://localhost:3888
```

> [!TIP]
> Au premier démarrage, choisissez un code d’accès à six chiffres (ou un accès ouvert sur un réseau de confiance). Ajoutez vos agents et modèles dans **Réglages** : Claude Code, Codex ou Kimi connectés, votre propre clé d’API ou les modèles PenEcho.

<details>
<summary>Lancer depuis les sources</summary>

```bash
git clone https://github.com/penecho/penecho.git
cd penecho
npm install
npm start
```

</details>

<a name="connect-your-ai-agent"></a>

## Connectez votre agent IA

**Dans un projet,** PenEcho lance les agents que vous avez déjà : Claude Code, Codex, OpenCode, Pi, Kimi et d’autres. Ajoutez-les dans **Réglages → Agents**, ou continuez à travailler dans leurs propres applications : ce qu’ils disent et modifient apparaît tout seul sur la ligne.

**Pour un Canvas à côté de n’importe quelle conversation,** collez une ligne dans Claude Code, Codex, Cursor ou un autre agent MCP :

```text
Set up PenEcho for me by following https://penecho.ai/agents.md
```

Ensuite, demandez simplement :

- *« Dessine l’architecture de ce projet sur la toile. »*
- *« Transforme notre parcours de connexion en diagramme de séquence sur la toile. »*
- *« Lis mes notes manuscrites sur la toile et révise le schéma. »*

Le Canvas s’ouvre à côté de votre conversation. Aucun compte n’est nécessaire ; si on vous le demande, choisissez **Continuer en tant qu’invité**. MCP n’utilise aucun crédit PenEcho.

<details>
<summary>MCP local pour une installation npm globale</summary>

Activez MCP dans **Réglages → MCP**, puis utilisez **Configuration automatique**, ou ajoutez cette entrée à un client qui accepte le JSON `mcpServers` :

```json
{
  "mcpServers": {
    "penecho": { "command": "penecho", "args": ["mcp"] }
  }
}
```

Les agents ne voient que les toiles que vous activez. Le MCP local reste sur votre ordinateur ; le MCP cloud utilise une autorisation OAuth séparée. [Guide MCP →](../mcp-setup.md) · [Installation du plugin](../../integrations/penecho-cloud/INSTALL.md)

</details>

<details>
<summary>Galerie de schémas</summary>

<table width="100%">
  <tr>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/kubernetes.webp"><img src="../assets/professional-diagrams/previews/kubernetes.webp" alt="Kubernetes cluster diagram" width="100%"></a><br><strong>Kubernetes cluster</strong></td>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/migration.webp"><img src="../assets/professional-diagrams/previews/migration.webp" alt="Monolith to microservices diagram" width="100%"></a><br><strong>Monolith → microservices</strong></td>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/notifications.webp"><img src="../assets/professional-diagrams/previews/notifications.webp" alt="Event-driven notifications diagram" width="100%"></a><br><strong>Event-driven notifications</strong></td>
  </tr>
  <tr>
    <td valign="top"><a href="../assets/professional-diagrams/mcp-request.webp"><img src="../assets/professional-diagrams/previews/mcp-request.webp" alt="How MCP reaches the canvas diagram" width="100%"></a><br><strong>How MCP reaches the canvas</strong></td>
    <td valign="top"><a href="../assets/professional-diagrams/release.webp"><img src="../assets/professional-diagrams/previews/release.webp" alt="Release parallel tasks diagram" width="100%"></a><br><strong>Release: parallel tasks</strong></td>
    <td valign="top"><a href="../assets/professional-diagrams/rollout.webp"><img src="../assets/professional-diagrams/previews/rollout.webp" alt="Multi-region rollout diagram" width="100%"></a><br><strong>Multi-region rollout</strong></td>
  </tr>
</table>

<p align="center"><sub>Cliquez sur un schéma pour le voir en taille réelle.</sub></p>

</details>

## Comment ça marche

<p align="center"><img src="../../public/penecho-architecture.webp" alt="Un navigateur se connecte à PenEcho Cloud ou à votre PC local. Un agent IA peut se connecter via le MCP cloud ou le MCP local, tous deux facultatifs." width="100%"></p>

- **Sur votre ordinateur** — l’application de bureau ou la CLI sert la toile et utilise votre propre API de modèles ou la CLI de votre agent.
- **Dans le cloud** — penecho.ai ajoute des modèles hébergés, des projets synchronisés et partagés, et des liens en direct pour dessiner ensemble.
- **Votre agent** — se connecte via le MCP local ou cloud. Les deux sont facultatifs.

Détails : [notes d’architecture](../architecture.md).

## Choisissez votre IA

| Connexion | Coût | Idéal pour |
| --- | --- | --- |
| **Modèles PenEcho** — connectez-vous, choisissez un modèle | Crédits du compte | Démarrer sans clé |
| **Votre API de modèles** — compatible OpenAI ou Anthropic | Votre fournisseur | Contrôle total du modèle et du coût |
| **Votre CLI** — Codex, Claude Code ou Kimi, connecté | Votre abonnement | Réutiliser un abonnement que vous avez |

Quel modèle et quel niveau de raisonnement choisir : [modèles recommandés](#recommended-models) (mis à jour à chaque version).

<a name="recommended-models"></a>
<details>
<summary>Modèles recommandés</summary>

Ces recommandations équilibrent la qualité des réponses et la latence du vrai travail de PenEcho sur la toile, d’après les tests pratiques actuels ; le temps de réponse réel varie selon le fournisseur, la complexité de la toile et le raisonnement.

| Modèle | Niveau | Remarques | Usage recommandé |
| --- | --- | --- | --- |
| Claude Opus 4.8 / 5.0 (`claude-opus-4-8` / `claude-opus-5-0`) | `medium` | Très bonne qualité avec un meilleur équilibre de latence | Travail quotidien sur la toile |
| Claude Opus 4.8 / 5.0 (`claude-opus-4-8` / `claude-opus-5-0`) | `high` | Raisonnement de meilleure qualité, attentes plus longues et variables | Écriture manuscrite complexe, mathématiques, schémas ou mise en page |
| Fable 5 (`claude-fable-5` or `fable`) | `medium` | Souvent environ deux fois plus rapide que `gpt-5.6-sol` en `xhigh` | Usage général rapide et de qualité |
| [Kimi K3](https://platform.kimi.ai?aff=penecho) (`kimi-k3`) | `medium` | Très bonne qualité ; `medium` garde un équilibre pratique | Réglage Kimi recommandé |
| `gpt-5.6-terra` | de `low` à `high` | Étonnamment puissant et réactif | Objectifs souples de qualité et de latence |
| `gpt-5.6-luna` | `xhigh` | Très bons résultats sur la toile, avec une bonne vitesse | La qualité d’abord, tout en restant réactif |
| `gpt-5.6-sol` | `high` | Suffisant pour la plupart des demandes, plus réactif que `xhigh` | Par défaut quand la réactivité compte |
| `gpt-5.6-sol` | `xhigh` | Très bon mais plus lent et plus variable | Tâches difficiles sur la toile |
| `deepseek-v4-flash-vision-exp` | `medium` | Bon | Travail avec vision via l’API DeepSeek |
| `glm-5.3-flash` | `medium` | Bon | Travail rapide via l’API compatible Anthropic de GLM |

</details>

<a name="whats-new-in-150"></a>

## Nouveautés de la 1.5.0

- **PenEcho Lines :** chaque tâche est une ligne, de votre Ask au travail relu, avec les Topics, les économies de tokens et n’importe quel agent sur la même ligne.
- **Collaborer :** un clic crée un lien où chacun peut dessiner avec vous, en direct, sans compte.
- **Partage et PDF :** les liens en lecture seule se mettent à jour en direct pendant que vous travaillez, et tout Canvas se télécharge en PDF.
- **Projets dossier :** les agents IA qui travaillent dans un même dossier partagent une page ; ses toiles sont des onglets, et chacune s’enregistre toute seule.
- **Configuration d’un agent en une ligne :** « Set up PenEcho for me by following https://penecho.ai/agents.md ».

[Journal complet des modifications →](../../CHANGELOG.md#150)

<a name="buy-us-a-coffee"></a>
<a name="support-penecho"></a>

## Offrez-nous un café

<p align="center">
  <a href="https://buymeacoffee.com/penecho"><img src="../assets/support-penecho.svg" alt="PenEcho est open source et gratuit sur votre ordinateur. S’il vous a fait gagner du temps, offrez-nous un café." width="820"></a>
</p>

PenEcho est gratuit sur votre ordinateur, sans compte. S’il vous a fait gagner un après-midi, ou quelques millions de tokens, un café est la façon la plus rapide de dire merci, et il va directement au développement, aux tests et à la documentation.

<p align="center">
  <a href="https://buymeacoffee.com/penecho"><img src="https://img.shields.io/badge/Buy_us_a_coffee-475569?style=for-the-badge&amp;logo=buymeacoffee&amp;logoColor=white" alt="Buy us a coffee" height="36"></a>
  <a href="https://github.com/sponsors/penecho"><img src="https://img.shields.io/badge/GitHub_Sponsors-monthly_or_one--time-475569?style=for-the-badge&amp;logo=githubsponsors&amp;logoColor=white" alt="Support PenEcho on GitHub Sponsors" height="36"></a>
</p>

Pas d’argent à donner ? Une ⭐ sur ce dépôt, un rapport de bug ou en parler à un ami aide tout autant.

<sub>Les contributions soutiennent la maintenance open source ; elles n’achètent ni licence commerciale, ni support dédié, ni fonctionnalité garantie.</sub>

## Communauté

| [Discord](https://discord.gg/3jrPJ3mXdX) | [Discussions](https://github.com/penecho/penecho/discussions) | [Issues](https://github.com/penecho/penecho/issues) | [Contributing](../../CONTRIBUTING.md) |
| --- | --- | --- | --- |
| Discuter avec l’équipe | Idées et questions | Signaler un bug | Lancez d’abord `npm run check` |

Sous licence [AGPL-3.0-only](../../LICENSE) ; une [licence commerciale](../../COMMERCIAL-LICENSE.md) est disponible. [Politique de marque](../../TRADEMARKS.md) · [Accord de contribution](../../CONTRIBUTOR-LICENSE-AGREEMENT.md).

Les moteurs de rendu de schémas adaptent des utilitaires SVG et géométriques d’[Archify](https://github.com/tt-a1i/archify), de tt-a1i (MIT). Voir [NOTICE](../../NOTICE).

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
      <img src="https://api.star-history.com/chart?repos=penecho/penecho&amp;type=date&amp;legend=top-left" alt="PenEcho GitHub star history chart" width="800">
    </picture>
  </a>
</p>
