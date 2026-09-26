<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/penecho-readme-header-dark.webp">
    <img src="public/penecho-readme-header.webp" alt="PenEcho" width="280">
  </picture>
</p>

<h1 align="center">Think on a canvas, with any AI.</h1>

<p align="center">Sketch by hand. PenEcho's built-in Agent — or Codex, Claude Code and any MCP<br>client — turns it into diagrams, documents and working widgets right beside your<br>notes.</p>

<p align="center">
  <a href="https://github.com/penecho/penecho/releases/latest"><img src="https://img.shields.io/badge/release-v1.3.5-087f83" alt="Release v1.3.5"></a>
  <a href="https://www.npmjs.com/package/penecho"><img src="https://img.shields.io/badge/npm-penecho-cb3837" alt="npm penecho"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="AGPL-3.0-only"></a>
  <a href="https://discord.gg/3jrPJ3mXdX"><img src="https://img.shields.io/badge/discord-join-5865f2" alt="Join Discord"></a>
  <a href="docs/mcp-setup.md"><img src="https://img.shields.io/badge/MCP-ready-6f42c1" alt="MCP ready"></a>
</p>

<p align="center">
  <a href="https://github.com/penecho/penecho/releases/latest"><img src="https://img.shields.io/badge/DOWNLOAD_FOR_MACOS-24292f?style=for-the-badge&amp;logo=apple&amp;logoColor=white" alt="Download for macOS"></a>
  <a href="https://github.com/penecho/penecho/releases/latest"><img src="https://img.shields.io/badge/DOWNLOAD_FOR_WINDOWS-0969da?style=for-the-badge&amp;logo=windows&amp;logoColor=white" alt="Download for Windows"></a>
  <a href="https://penecho.ai"><img src="https://img.shields.io/badge/OPEN_PENECHO.AI-087f83?style=for-the-badge&amp;logo=googlechrome&amp;logoColor=white" alt="Open penecho.ai"></a>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#connect-your-ai-agent-mcp">Connect your AI (MCP)</a> ·
  <a href="docs/">Docs</a> ·
  <a href="https://discord.gg/3jrPJ3mXdX">Discord</a>
</p>

<p align="center">
  <sub><strong>English</strong> ·
  <a href="docs/readme/README.zh-CN.md">简体中文</a> ·
  <a href="docs/readme/README.ja.md">日本語</a> ·
  <a href="docs/readme/README.ko.md">한국어</a> ·
  <a href="docs/readme/README.ru.md">Русский</a> ·
  <a href="docs/readme/README.es.md">Español</a> ·
  <a href="docs/readme/README.pt-BR.md">Português</a> ·
  <a href="docs/readme/README.fr.md">Français</a> ·
  <a href="docs/readme/README.de.md">Deutsch</a></sub>
</p>

<p align="center">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_full_demo.webp" alt="From a hand sketch to a diagram and working widget on one PenEcho canvas" width="100%">
</p>
<p align="center"><em>From a hand sketch to an interactive result in one canvas.</em></p>

## What you can do

<table width="100%">
  <tr>
    <td width="33%" valign="top">
      <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins_sub_x10.webp" alt="PenEcho responding to notes and sketches on a canvas" width="100%"><br>
      <strong>Sketch, then ask</strong><br>
      Handwriting, equations, text and images on an endless canvas. Auto AI answers when you pause.
    </td>
    <td width="33%" valign="top">
      <a href="docs/assets/professional-diagrams/kubernetes.webp"><img src="docs/assets/professional-diagrams/previews/kubernetes.webp" alt="Kubernetes architecture diagram" width="100%"></a><br>
      <strong>Professional diagrams</strong><br>
      Architecture, sequence and workflow diagrams with automatic layout. Export SVG or PNG.
    </td>
    <td width="33%" valign="top">
      <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/play_patris.webp" alt="Interactive widget running on a PenEcho canvas" width="100%"><br>
      <strong>Working widgets</strong><br>
      Calculators, quizzes and prototypes that run on the canvas and can be favourited or shared.
    </td>
  </tr>
</table>

## Quick start

| | Get started |
| --- | --- |
| **Desktop app** | macOS and Windows from [GitHub Releases](https://github.com/penecho/penecho/releases/latest). Includes everything, updates itself. |
| **npm** | Node.js 22.19+. Run `npm i -g penecho` then `penecho` and open `localhost:3888`. |
| **Browser** | Sign in at [penecho.ai](https://penecho.ai) for hosted models and Cloud canvases. Nothing to install. |

```bash
npm install -g penecho
penecho             # opens http://localhost:3888
```

> [!TIP]
> On first start, choose a six-digit access code (or open access on a trusted network). Add a model in **Settings → AI & connections**: your own API key, a signed-in Codex / Claude Code / Kimi CLI, or PenEcho models.

<details>
<summary>Run from source</summary>

```bash
git clone https://github.com/penecho/penecho.git
cd penecho
npm install
npm start
```

</details>

## Connect your AI agent (MCP)

Keep talking in the agent you already use. PenEcho gives the work a place to live — your agent draws on the canvas, you mark it up, and it reads your feedback on the next turn.

1. In PenEcho, open **Settings → MCP service** and turn on the current canvas.
2. Use **Auto configure** for a supported client, or copy the generated setup prompt into your client (Codex, Claude Code, Kimi, Cursor...). For a global npm installation, clients that accept `mcpServers` JSON can also use the compatibility entry below:

   ```json
   {
     "mcpServers": {
       "penecho": { "command": "penecho", "args": ["mcp"] }
     }
   }
   ```

3. Ask: *“Show the architecture we discussed on my PenEcho canvas.”*

<p align="center">
  <a href="docs/assets/mcp-spatial-example.webp"><img src="docs/assets/mcp-spatial-example.webp" alt="An architecture discussion from Claude Code with handwritten annotations on a PenEcho canvas" width="760"></a>
</p>
<p align="center"><em>An architecture discussion from Claude Code, annotated by hand on the canvas.</em></p>

> [!NOTE]
> Agents only see canvases you turn on. Local MCP stays on your computer; Cloud MCP is a separate signed-in connection for Cloud canvases. [MCP guide →](docs/mcp-setup.md)

## Diagram gallery

<table width="100%">
  <tr>
    <td width="33%" valign="top"><a href="docs/assets/professional-diagrams/kubernetes.webp"><img src="docs/assets/professional-diagrams/previews/kubernetes.webp" alt="Kubernetes cluster diagram" width="100%"></a><br><strong>Kubernetes cluster</strong></td>
    <td width="33%" valign="top"><a href="docs/assets/professional-diagrams/migration.webp"><img src="docs/assets/professional-diagrams/previews/migration.webp" alt="Monolith to microservices diagram" width="100%"></a><br><strong>Monolith → microservices</strong></td>
    <td width="33%" valign="top"><a href="docs/assets/professional-diagrams/notifications.webp"><img src="docs/assets/professional-diagrams/previews/notifications.webp" alt="Event-driven notifications diagram" width="100%"></a><br><strong>Event-driven notifications</strong></td>
  </tr>
  <tr>
    <td valign="top"><a href="docs/assets/professional-diagrams/mcp-request.webp"><img src="docs/assets/professional-diagrams/previews/mcp-request.webp" alt="How MCP reaches the canvas diagram" width="100%"></a><br><strong>How MCP reaches the canvas</strong></td>
    <td valign="top"><a href="docs/assets/professional-diagrams/release.webp"><img src="docs/assets/professional-diagrams/previews/release.webp" alt="Release parallel tasks diagram" width="100%"></a><br><strong>Release: parallel tasks</strong></td>
    <td valign="top"><a href="docs/assets/professional-diagrams/rollout.webp"><img src="docs/assets/professional-diagrams/previews/rollout.webp" alt="Multi-region rollout diagram" width="100%"></a><br><strong>Multi-region rollout</strong></td>
  </tr>
</table>

<p align="center"><sub>Click any diagram for the full-size version.</sub></p>

## How it works

<p align="center"><img src="public/penecho-architecture.webp" alt="A browser connects to PenEcho Cloud or your local PC. An AI agent can connect through optional Cloud MCP or Local MCP." width="100%"></p>

- **On your computer** — the desktop app or CLI serves the canvas and uses your own model API or agent CLI.
- **In the cloud** — penecho.ai adds hosted models, synced projects and favorites, and can reach your linked computer.
- **Your agent** — connects through Local or Cloud MCP. Both are optional.

Details: [architecture notes](docs/architecture.md).

## Choose your AI

| Connection | Cost | Best for |
| --- | --- | --- |
| **PenEcho models** — sign in, pick a model | Account credits | Getting started, no keys |
| **Your model API** — OpenAI- or Anthropic-compatible | Your provider | Full control of model and cost |
| **Your CLI** — Codex, Claude Code or Kimi, signed in | Your plan | Reusing a subscription you have |

Which model and effort to pick: [recommended models](#recommended-models) (updated with each release).

<a name="recommended-models"></a>
<details>
<summary>Recommended models</summary>

These recommendations balance answer quality against the latency of PenEcho's real canvas workload, based on current hands-on testing; actual response time varies with the provider, canvas complexity, and reasoning behavior.

| Model | Effort | Notes | Recommended use |
| --- | --- | --- | --- |
| Claude Opus 4.8 / 5.0 (`claude-opus-4-8` / `claude-opus-5-0`) | `medium` | Strong quality with a better latency balance | Everyday canvas work |
| Claude Opus 4.8 / 5.0 (`claude-opus-4-8` / `claude-opus-5-0`) | `high` | Higher reasoning quality, longer and more variable waits | Complex handwriting, mathematics, diagrams, or layout |
| Fable 5 (`claude-fable-5` or `fable`) | `medium` | Often around half the response time of `gpt-5.6-sol` at `xhigh` | Fast, high-quality general use |
| [Kimi K3](https://platform.kimi.ai?aff=penecho) (`kimi-k3`) | `medium` | Very good quality; `medium` keeps the balance practical | Recommended Kimi default |
| `gpt-5.6-terra` | `low` to `high` | Surprisingly strong and responsive | Flexible quality and latency targets |
| `gpt-5.6-luna` | `xhigh` | Very good canvas results with strong speed | Quality-first, still responsive |
| `gpt-5.6-sol` | `high` | Good enough for most requests, more responsive than `xhigh` | Default when responsiveness matters |
| `gpt-5.6-sol` | `xhigh` | Very good but slower and more variable | Difficult canvas tasks |
| `deepseek-v4-flash-vision-exp` | `medium` | Good | Vision-capable work through the DeepSeek API |
| `glm-5.3-flash` | `medium` | Good | Fast work through the GLM Anthropic-compatible API |

</details>

## What's new in 1.3.5

- **UI:** minor interface fixes.
- **Concurrent canvas editing:** support Canvas AI, Agent, and MCP modifying the same canvas simultaneously.

[Full changelog →](CHANGELOG.md#135)

## Community

| [Discord](https://discord.gg/3jrPJ3mXdX) | [Discussions](https://github.com/penecho/penecho/discussions) | [Issues](https://github.com/penecho/penecho/issues) | [Contributing](CONTRIBUTING.md) |
| --- | --- | --- | --- |
| Chat with the team | Ideas and questions | Report a bug | Run `npm run check` first |

Licensed under [AGPL-3.0-only](LICENSE); [commercial licence](COMMERCIAL-LICENSE.md) available. [Trademark policy](TRADEMARKS.md) · [Contributor agreement](CONTRIBUTOR-LICENSE-AGREEMENT.md).

Diagram renderers adapt SVG and geometry helpers from [Archify](https://github.com/tt-a1i/archify) by tt-a1i (MIT). See [NOTICE](NOTICE).

<p align="center">
  <a href="https://www.kimi.com/code?aff=penecho">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="docs/assets/kimi-open-source-friends-dark.svg">
      <img src="docs/assets/kimi-open-source-friends-light.svg" alt="Kimi Open Source Friends" width="326" height="56">
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
