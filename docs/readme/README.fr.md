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

<h1 align="center">Un espace de travail spatial<br>pour réfléchir avec l’IA.</h1>
<p align="center">Dessinez, explorez et créez avec l’Agent intégré ou votre propre assistant compatible MCP.</p>
<p align="center">
  <img src="https://img.shields.io/badge/version-1.3.1-087f83" alt="Version 1.3.1">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="AGPL-3.0-only"></a>
</p>
<p align="center">
  <a href="https://penecho.ai">Site web</a> ·
  <a href="https://github.com/penecho/penecho/releases/latest">Télécharger</a> ·
  <a href="#démarrage-rapide">Démarrage rapide</a> ·
  <a href="../mcp-setup.md">Guide MCP</a> ·
  <a href="https://discord.gg/3jrPJ3mXdX">Discord</a>
</p>

<p align="center">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_full_demo.webp" alt="Démonstration complète de PenEcho" width="49%">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins.webp" alt="Démonstration de schémas professionnels PenEcho" width="49%">
</p>

<p align="center">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins_sub_x10.webp" alt="Démonstration des extensions PenEcho" width="49%">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/play_patris.webp" alt="Démonstration du canevas interactif PenEcho" width="49%">
</p>

<p align="center">
  <a href="https://www.kimi.com/code?aff=penecho">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="../assets/kimi-open-source-friends-dark.svg">
      <img src="../assets/kimi-open-source-friends-light.svg" alt="Kimi Open Source Friends" width="326" height="56">
    </picture>
  </a>
</p>

## Une extension spatiale de votre conversation avec l’IA

Continuez à échanger avec **Codex, Claude, Kimi ou d’autres agents IA**. PenEcho donne une place à votre travail.

Grâce à MCP, votre IA peut transformer des explications en schémas et des idées en aperçus interactifs. Gardez vos références, votre raisonnement et votre travail côte à côte, puis annotez le canevas pour intégrer vos retours à l’itération suivante.

| Poursuivez la conversation | Voyez le travail prendre forme | Partagez vos retours |
| --- | --- | --- |
| Travaillez avec l’agent IA que vous utilisez déjà. | Le serveur MCP de PenEcho apporte schémas, documents et aperçus interactifs sur le Canvas. | Essayez le résultat, annotez-le et laissez votre agent lire vos retours pour la prochaine révision. |

<p align="center">
  <a href="../assets/mcp-spatial-example.png">
    <img src="../assets/mcp-spatial-example.png" alt="Une discussion d’architecture avec l’IA, accompagnée de retours manuscrits à côté de la proposition sur un Canvas PenEcho" width="760">
  </a>
</p>
<p align="center"><em>Une discussion d’architecture, annotée à la main sur le Canvas.</em></p>

**Visualisez le résultat avant qu’il soit terminé.** Voyez le travail prendre forme pendant vos échanges avec l’IA. Essayez-le, donnez votre avis et faites avancer votre projet ensemble.

[Connectez votre agent avec MCP →](#connecter-votre-agent-avec-mcp)

## Ce que vous pouvez faire

- **Travaillez visuellement.** Combinez écriture manuscrite, équations, texte, images, schémas et Widgets HTML interactifs sur un vaste canevas.
- **Créez avec l’IA.** Utilisez l’Agent intégré pour effectuer des recherches, travailler avec des fichiers, expliquer des idées et créer des résultats visuels modifiables.
- **Utilisez votre propre agent.** Connectez Codex, Claude Code ou un autre client compatible MCP pour lire et modifier un Canvas explicitement activé.
- **Conservez et partagez votre travail.** Organisez les Canvas en projets, enregistrez des versions Cloud, synchronisez vos favoris et publiez via Echoes.

## Nouveautés de la version 1.3.0

| Mise à jour | Apports |
| --- | --- |
| **Espace de travail MCP** | Découverte des Canvas, captures, modification d’objets, Widgets interactifs, fichiers sources virtuels et retours utilisateur pour les agents externes. Prend en charge les navigateurs locaux, du réseau local et Cloud via un appareil lié, avec activation explicite. |
| **Cloud MCP** | Connectez des agents IA externes directement à vos Canvas PenEcho Cloud activés pour lire le contenu, créer et modifier des résultats et suivre vos retours manuscrits. Cloud MCP et Local MCP sont des modes de connexion facultatifs. |
| **API PenEcho Cloud Credits** | Utilisez les modèles hébergés par PenEcho avec vos crédits de compte, en complément de vos connexions API et CLI. Consultez les modèles disponibles, les tarifs et le solde dans les paramètres. |
| **Gestion des connexions** | Enregistrez plusieurs connexions IA et choisissez la connexion active pour chaque client. |
| **Canvas et espace de travail** | Dessin et navigation plus réactifs, commandes Studio affinées, panneau Agent adaptatif et raccourcis clavier personnalisables. |

## Fonctionnement

<p align="center">
  <img src="../../public/penecho-architecture.webp" alt="Architecture PenEcho : un navigateur se connecte à PenEcho Cloud ou à votre PC local. Le Cloud propose des modèles hébergés et se connecte à votre appareil lié. Votre PC exécute PenEcho CLI ou App avec votre API de modèle ou vos agents. Les agents IA externes peuvent utiliser Cloud MCP ou Local MCP ; les deux connexions sont facultatives." width="1483">
</p>

Ouvrez PenEcho dans un navigateur via PenEcho Cloud ou votre PC local exécutant la CLI ou l’application de bureau. Le Cloud propose des modèles hébergés et peut se connecter à votre appareil lié ; votre PC peut utiliser votre propre API de modèle ou vos agents. Des agents IA externes comme Codex et Claude peuvent se connecter via Cloud MCP ou Local MCP. Les deux connexions MCP sont facultatives.

Consultez les [notes d’architecture](../architecture.md) pour les détails d’implémentation.

## Démarrage rapide

**Application de bureau :** téléchargez l’application Windows ou macOS depuis [GitHub Releases](https://github.com/penecho/penecho/releases/latest).

**npm :** nécessite Node.js **22.19 ou version ultérieure**.

```bash
npm install -g penecho
penecho
```

Ouvrez `http://localhost:3888`. Ajoutez votre propre API de modèle ou une CLI Codex, Claude Code ou Kimi authentifiée dans **Paramètres → Connexions**. Les connexions sont enregistrées dans `~/.penecho/connections.json` ; les paramètres généraux restent dans `~/.penecho/config.env`. Pour les modèles hébergés par PenEcho, connectez-vous et sélectionnez un modèle disponible dans les paramètres.

Au démarrage, définissez un code d’accès à six chiffres ou activez explicitement l’accès libre sur votre réseau de confiance. Le démarrage affiche également les adresses du réseau local pour les autres appareils.

<details>
<summary>Exécuter depuis les sources</summary>

```bash
git clone https://github.com/penecho/penecho.git
cd penecho
npm install
npm start
```

</details>

## Connecter votre agent avec MCP

Pour **Local MCP** :

1. Démarrez PenEcho et activez le Canvas actuel dans **Paramètres → Service MCP**.
2. Utilisez les paramètres pour configurer un client local pris en charge ou copier sa configuration de lancement générée. Avec une installation npm globale, les clients acceptant le JSON `mcpServers` peuvent utiliser :

   ```json
   {
     "mcpServers": {
       "penecho": { "command": "penecho", "args": ["mcp"] }
     }
   }
   ```

3. Demandez à votre agent : **« Montre l’architecture dont nous avons discuté sur mon Canvas PenEcho. »**

L’agent peut capturer le contenu pertinent, modifier des objets, créer des résultats visuels, appliquer des modifications aux fichiers sources des documents et recevoir vos retours. Seuls les Canvas activés et connectés sont détectables. Avec Local MCP, le client MCP s’exécute sur l’hôte PenEcho ; la prise en charge des navigateurs du réseau local et des appareils liés n’expose pas publiquement le point d’accès MCP local. Cloud MCP est une connexion HTTPS authentifiée distincte pour vos Canvas PenEcho Cloud activés.

Les installations de bureau doivent utiliser la configuration générée, qui inclut le bon environnement d’exécution intégré. Consultez la [configuration MCP](../mcp-setup.md) et la [compétence de workflow pour agents](../../skills/penecho-mcp/SKILL.md), facultative.

## PenEcho Cloud et connexions IA

[PenEcho Cloud](https://penecho.ai) ajoute des projets privés avec historique des versions, des favoris synchronisés, le partage public via Echoes et l’accès distant à un ordinateur lié.

| Connexion | Fonctionnement |
| --- | --- |
| **Modèles PenEcho** | Connectez-vous, sélectionnez un modèle hébergé disponible et utilisez les crédits de votre compte. Les paramètres affichent les tarifs et le solde actuels. |
| **Votre API de modèle** | Configurez un point d’accès compatible OpenAI ou Anthropic, un modèle et une clé API. Votre fournisseur gère la consommation. |
| **Votre CLI** | Utilisez une CLI Codex, Claude Code ou Kimi installée et authentifiée localement. La disponibilité et la consommation dépendent de l’offre du fournisseur. |

Les modèles hébergés utilisés sur votre ordinateur nécessitent une connexion au Cloud, sans appairage d’appareil ni clé API Credits distincte. Cloud MCP peut accéder directement aux Canvas Cloud activés. L’accès via le Cloud à un Canvas hébergé sur votre ordinateur nécessite que l’appareil lié soit en ligne et que le relais nécessaire soit pris en charge.

Vos propres connexions API et CLI ne consomment pas de crédits PenEcho. Un compte Cloud est facultatif pour une utilisation locale avec votre propre connexion. Les fonctions IA nécessitent l’accès au fournisseur sélectionné ; exécuter PenEcho localement ne rend pas un modèle distant disponible hors ligne.

## Configurations de modèles recommandées

Ces recommandations équilibrent la qualité des réponses et la latence dans les tâches réelles de canevas PenEcho, à partir de tests pratiques actuels ; le temps de réponse réel varie selon le fournisseur, la complexité du canevas et le comportement de raisonnement.

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

## Communauté et licence

Lisez [CONTRIBUTING.md](../../CONTRIBUTING.md) pour contribuer ; exécutez `npm run check` avant d’ouvrir une pull request. Signalez les bugs dans les [Issues](https://github.com/penecho/penecho/issues), échangez dans les [Discussions](https://github.com/penecho/penecho/discussions) ou rejoignez [Discord](https://discord.gg/3jrPJ3mXdX).

Sous licence [AGPL-3.0-only](../../LICENSE). Une [licence commerciale](../../COMMERCIAL-LICENSE.md) alternative est disponible. Consultez la [politique relative aux marques](../../TRADEMARKS.md) et l’[accord de contribution](../../CONTRIBUTOR-LICENSE-AGREEMENT.md).
