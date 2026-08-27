<h1 align="center">
  <img src="public/penecho-readme-header.png" alt="PenEcho" width="760">
</h1>

<p align="center">
  <strong>English</strong> |
  <a href="docs/readme/README.zh-CN.md">简体中文</a> |
  <a href="docs/readme/README.ja.md">日本語</a> |
  <a href="docs/readme/README.ko.md">한국어</a> |
  <a href="docs/readme/README.ru.md">Русский</a> |
  <a href="docs/readme/README.es.md">Español</a> |
  <a href="docs/readme/README.pt-BR.md">Português (Brasil)</a> |
  <a href="docs/readme/README.fr.md">Français</a> |
  <a href="docs/readme/README.de.md">Deutsch</a>
</p>

<p align="center"><strong>Think with AI beyond the chat box.</strong></p>

<p align="center">PenEcho is a shared canvas where handwriting, equations, diagrams, and spatial context become part of the conversation.</p>

<h2 align="center">
  <a href="https://penecho.ai">Official Website · penecho.ai</a>
</h2>

<h3 align="center"><a href="https://penecho.ai">Publish ideas · Collaborate through shared canvases · Share your work</a></h3>

<p align="center">
  <a href="https://discord.gg/3jrPJ3mXdX">
    <img src="https://img.shields.io/badge/Discord-Join%20the%20community-5865F2?style=for-the-badge&amp;logo=discord&amp;logoColor=white" alt="Join the PenEcho Discord">
  </a>
  <a href="https://github.com/penecho/penecho/stargazers">
    <img src="https://img.shields.io/github/stars/penecho/penecho?style=for-the-badge&amp;logo=github&amp;logoColor=white&amp;color=f5b301" alt="Star PenEcho on GitHub">
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/License-AGPL%20v3-blue?style=for-the-badge" alt="License: AGPL v3">
  </a>
</p>

<p align="center">
  <a href="https://penecho.ai">Website</a> &bull;
  <a href="#-features">Features</a> &bull;
  <a href="#-quick-start">Quick Start</a> &bull;
  <a href="#penecho-cloud">Cloud</a> &bull;
  <a href="#recommended-model-configurations">Models</a> &bull;
  <a href="#-faq">FAQ</a> &bull;
  <a href="docs/architecture.md">Architecture</a> &bull;
  <a href="https://discord.gg/3jrPJ3mXdX">Discord</a>
</p>

<p align="center">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins.webp" alt="PenEcho professional diagrams demo" width="49%">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_full_demo.webp" alt="PenEcho full demo" width="49%">
</p>

<p align="center">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins_sub_x10.webp" alt="PenEcho plugins demo" width="49%">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/play_patris.webp" alt="PenEcho interactive canvas demo" width="49%">
</p>

## Kimi Open Source Friends

<p align="center">
  <a href="https://www.kimi.com/code?aff=penecho">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="docs/assets/kimi-open-source-friends-dark.svg">
      <img alt="Kimi Open Source Friends" src="docs/assets/kimi-open-source-friends-light.svg">
    </picture>
  </a>
</p>

PenEcho is an official member of **Kimi Open Source Friends**, [Moonshot AI](https://www.kimi.com/)'s program supporting outstanding open source projects. The Kimi team backs PenEcho's development with API credits, and Kimi K3 is one of the [recommended models](#recommended-model-configurations) for demanding canvas work — accurate on handwriting, strong on diagrams, and fast in practice.

Using these links directly supports the project:

- **[Kimi Code](https://www.kimi.com/code?aff=penecho)** — Kimi's coding subscription, available worldwide
- **[Kimi Open Platform · China](https://platform.kimi.com?aff=penecho)** — API access for mainland China
- **[Kimi Open Platform · Global](https://platform.kimi.ai?aff=penecho)** — API access for the rest of the world

## ✨ Features

- **PenEcho Agent: from source material to finished visual work.** Bring in read-only folders and files—including PDF, Word, PowerPoint, Excel, images, and code—combine them with web research and the current canvas, then keep the same agent working through analysis, planning, creation, and revision.
- **Visual Explorer for productivity.** Turn dense information into one responsive, editable visual workspace with a clear overview, connected detail, and supporting evidence. It shortens the path from research to a shareable result, reducing copy-paste, tool switching, manual diagramming, and repeated handoffs between chat, documents, and design tools.
- **Think in space, not in chat.** Write a question, equation, diagram, or half-formed idea anywhere on a `20,000 x 20,000` canvas. PenEcho reads your marks and their spatial relationships, then answers beside them.
- **Answers on the canvas.** Get hints, explanations, formulas, plots, and diagrams where you are working. Move, resize, and copy each AI draft, then accept or discard it before it becomes part of your ink.
- **Natural input.** Draw with a stylus or mouse; lasso confirmed ink to move, resize, recolor, or delete it, or send just that selection to Typeset. Editing your own ink never triggers an AI request.
- **Editable AI widgets.** Sandboxed interactive HTML, professional diagrams, animations, and live-data plugins — refinable in place with incremental unified-diff edits instead of full regeneration.
- **Multiple AI connections.** Save up to ten API or CLI connections with one-click switching, including editable Kimi and MiniMax presets, and pick a different active connection per client.
- **Projects and sharing.** Organize server canvases into projects, open them from other authorized devices, and export confirmed ink as a cropped PNG.
- **PenEcho Cloud.** Sign in at [penecho.ai](https://penecho.ai) to continue private projects on other devices, sync favorites, reach this host remotely through a linked device, and share public Crafts through Echoes — API credentials never leave the device.
- **Four themes** to match the problem you are exploring: Arcane, Sci-fi, Research, or Studio.

## 🚀 Quick start

**Desktop app** — [download from GitHub Releases](https://github.com/penecho/penecho/releases/latest).

**npm** — needs [Node.js 22.19+](https://nodejs.org/) and one of: an API key, an authenticated [Kimi Code CLI](https://github.com/MoonshotAI/kimi-code), an authenticated [Codex CLI](https://developers.openai.com/codex/cli), or an authenticated [Claude Code CLI](https://code.claude.com/docs/en/overview).

```bash
npm install -g penecho
penecho configure   # pick your LLM source: API, Kimi, Codex, or Claude CLI
penecho             # then open http://localhost:3888
```

**From source**

```bash
git clone https://github.com/penecho/penecho.git
cd penecho
npm install
npm start
```

On first start, the initial browser session must set a shared six-digit security code or explicitly acknowledge leaving the process open to the local network. Configuration is saved to `~/.penecho/config.env`; API keys never reach browser code. CLI modes require an authenticated CLI on your `PATH` — see the [configuration reference](docs/configuration.md) for CLI setup, effort mapping, and every setting.

<a id="penecho-cloud"></a>
## ☁️ PenEcho Cloud

[PenEcho Cloud](https://penecho.ai) is the companion website and account introduced in 1.0.0. It connects your devices and your work — and it is entirely optional: PenEcho keeps working fully offline with your own API or CLI setup.

On the website you can:

- Sign in with your browser and manage your Cloud account, storage, and credits
- Open **Echoes** and browse public Canvases and Widgets shared by the community
- View any public Craft in a read-only web viewer and share its link with anyone
- Manage project revisions, Trash, and recovery
- Generate pairing keys under **Cloud → Devices** to link your PenEcho hosts

In the app, signing in adds:

- **Cloud projects.** Save private, versioned Canvases into projects and continue them on any signed-in device. Every successful save creates an immutable revision, and a Canvas updated on another device is never silently overwritten — you are asked to load the latest version or save a copy.
- **Linked device.** Pair this host with a one-time key from Cloud → Devices, and your signed-in browsers and apps can reach it from anywhere through Cloud relay. Remote access to your canvas host without exposing it to the internet; API credentials still live only on that device. Pause, resume, or remove the link at any time.
- **Echoes: co-creation and knowledge sharing.** Browse public Canvases and Widgets across twelve categories, favorite them into a personal library that syncs through Cloud, and add community Widgets straight into your own Canvas. Publish a Canvas of your own with a share category so others can learn from it, build on it, and Echo it — with Craft lineage preserved between versions.

## 🔔 What's new in 1.1.4

- **PenEcho Agent.** Start below the canvas and keep one multi-step workflow moving across local files, read-only folder projects, web research, canvas context, visual creation, and direct canvas edits.
- **Visual Explorer.** Convert research, documents, notes, and plans into a responsive visual artifact organized from overview to detail and evidence—not a pile of generic cards or a transcript trapped in chat.
- **A shorter path to useful output.** Research, analyze, structure, visualize, review, and revise in the same workspace. The result stays editable on the canvas, reducing context switching, copy-paste, manual diagramming, and rework.
- **Progressive visual delivery.** PenEcho Agent can place and review complete Visual Explorer revisions as it works, so useful visual results arrive sooner and can be refined in place instead of regenerated from scratch.
- **Broader working context.** Add PDF, Word, PowerPoint, Excel, images, code, or a read-only folder project; reference existing Widgets and handwriting; and use Internet Search when available.

1.0.0 introduced [PenEcho Cloud](https://penecho.ai), private versioned projects, linked-device remote access, Echoes, public Crafts, and synced favorites. 0.9.0 added multiple AI connections with one-click switching, project-based shared canvases, guided in-place Refine, unified-diff incremental edits, SSE streaming, and request progress with cancellation. See [Releases](https://github.com/penecho/penecho/releases) for the full history.

## 📖 How it works

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/how-it-works-dark.svg">
    <img alt="How PenEcho works: canvas ink becomes a visual atlas, the server routes it to the configured executor, and a structured editable draft returns to the canvas" src="docs/assets/how-it-works-light.svg">
  </picture>
</p>

The browser sends only the relevant canvas crop and geometry. The server validates the request, routes it to your selected executor, and returns a movable draft that stays separate from confirmed ink until you accept it. PenEcho allocates `512 x 512` tiles only where ink exists, so the huge logical canvas never becomes a huge bitmap. Implementation details are in the [architecture notes](docs/architecture.md).

## Recommended model configurations

These recommendations balance answer quality against the latency of PenEcho's real canvas workload, based on current hands-on testing; actual response time varies with the provider, canvas complexity, and reasoning behavior.

| Model | Effort | Quality and speed | Recommended use |
| --- | --- | --- | --- |
| Claude Opus 4.8 / 5.0 (`claude-opus-4-8` / `claude-opus-5-0`) | `medium` | Strong quality with a better latency balance | Recommended Opus default for everyday canvas work |
| Claude Opus 4.8 / 5.0 (`claude-opus-4-8` / `claude-opus-5-0`) | `high` | Higher reasoning quality, with longer and more variable waits | Complex handwriting, mathematics, diagrams, or layout decisions where quality matters more than speed |
| Fable 5 (`claude-fable-5` or `fable`) | `medium` | Very good results; in current tests, often around half the response time of `gpt-5.6-sol` at `xhigh` | A fast, high-quality general-purpose choice |
| [Kimi K3](https://platform.kimi.ai?aff=penecho) (`kimi-k3`) | `medium` | Very good quality in the current comparison; `medium` keeps the quality/speed balance practical | Recommended Kimi Open Platform default for demanding canvas work |
| `gpt-5.6-terra` | `low` to `high` | Surprisingly strong and responsive; current PenEcho canvas tests produced better results than `gpt-5.6-sol` with fast response times | Recommended OpenAI option across a flexible range of quality and latency targets |
| `gpt-5.6-luna` | `xhigh` | Very good canvas results with strong response speed | A responsive quality-first option when `xhigh` reasoning is appropriate |
| `gpt-5.6-sol` | `high` | Good enough for most requests and more responsive than `xhigh` | Recommended Sol default when responsiveness matters |
| `gpt-5.6-sol` | `xhigh` | Very good results, but slower and more variable | Quality-first Sol configuration for difficult canvas tasks |

Typical output usage per request, including hidden reasoning tokens, is roughly `1,000` tokens at `low`, `3,000` at `medium`, and `5,000–8,000` at `xhigh`/`max`. At a typical low-effort volume (`10,000` input / `1,000` output tokens), current standard GPT-5.6 API rates work out to about $0.003–$0.08 per request across Luna, Terra, and Sol; higher effort levels cost more because reasoning tokens are billed as output. Check current [OpenAI API pricing](https://developers.openai.com/api/docs/pricing) before budgeting. CLI modes use the plan you are already signed in with rather than API billing. Google models are untested — if you try Gemini, please share the configuration and results in an issue.

## ⚙️ Configuration

`penecho configure` opens an interactive center covering everything: LLM source, model, effort, timeout, response-token limit, image format, request recording, and the listening interface and port. The settings people touch most, also writable in `~/.penecho/config.env`:

| Setting | Purpose |
| --- | --- |
| `AI_PROVIDER` | Executor: `api`, `kimi-cli`, `codex-cli`, or `claude-cli` |
| `AI_API_URL` / `AI_API_KEY` / `AI_API_MODEL` | API endpoint, credential, and model (API mode only) |
| `AI_EFFORT` | Saved reasoning level; the canvas toolbar `Reasoning` menu can override it per request without rewriting the connection |
| `HOST` / `PORT` | Listening interface and port, default `0.0.0.0:3888` |
| `AUTO_AI_DELAY_SECONDS` | Delay before automatic recognition, adjustable from 0 to 10 seconds on the canvas |

Use a different config file for one launch with `--config ./team.env`, or override the model, effort, and port for one process with flags such as `penecho --claude --model opus --effort max`. The full reference — CLI prerequisites, effort mapping, timeouts, tracing, and every setting — lives in [docs/configuration.md](docs/configuration.md).

## 🔒 Security

- Each start requires a shared six-digit code (stored only as a salted in-memory hash, rate-limited) or an explicit acknowledgement. It is a trusted-LAN guard, not Internet-grade authentication.
- CLI modes start local CLI processes on valid requests: keep them on the local machine or a trusted, directly connected LAN, and never expose them to the public internet or an untrusted reverse proxy.
- For public exposure, place PenEcho behind HTTPS, stronger authentication, rate limiting, and request-size controls.
- Credentials stay in the Node.js process and the config file and are never sent to browser code. Do not publish config files, logs, screenshots, or request traces containing private content.

## 🗺️ Roadmap

- [x] Multiple AI connections with one-click switching (0.9.0)
- [x] Project-based shared canvases and versioned bundles (0.9.0)
- [ ] Better handwriting recognition
- [ ] Broader model coverage — Google/Gemini is untested; test reports are especially welcome
- [ ] More natural pen interaction and on-canvas visual tools
- [ ] More UI translations — English and Chinese today, more welcome

## ❓ FAQ

**Do I need an API key?**
No. An authenticated [Kimi Code CLI](https://github.com/MoonshotAI/kimi-code), [Codex CLI](https://developers.openai.com/codex/cli), or [Claude Code CLI](https://code.claude.com/docs/en/overview) works too — PenEcho uses the selected CLI locally and never needs an API key for that source.

**Which model should I start with?**
[Kimi K3](https://platform.kimi.ai?aff=penecho), Claude Opus 4.8 / 5.0, and the `gpt-5.6` family are all good first choices — see [recommended models](#recommended-model-configurations).

**Is PenEcho free?**
The app is free and open source under AGPL v3. Model usage is billed by your provider or included in the Codex/Claude plan you sign in with. A typical low-effort request costs a few cents.

**Do I need a Cloud account?**
No. PenEcho works fully locally with your own API or CLI. Signing in to [penecho.ai](https://penecho.ai) optionally adds private cross-device projects, synced favorites, remote access to this host through a linked device, and public sharing through Echoes.

**Where does my data live?**
Canvases and settings stay on your device or your own PenEcho server. Keys and settings live in `~/.penecho/config.env`, and request recording is disabled by default.

**Can I use it from a tablet on my LAN?**
Yes. Startup prints the machine's LAN URLs; open one on the other device and enter the same six-digit code. If it cannot connect, allow the configured TCP port in the host firewall.

## 🤝 Contributing

PenEcho is young and built in the open, and the problems that matter most — handwriting recognition, on-canvas visual tools, wider model support, and natural pen interaction — are still open. You do not need to write code to help: test a model and report the executor, model ID, effort, latency, and a sample result; share a canvas that worked or fell apart; or report rough edges, however small.

Run `npm run check` before opening a pull request. Start with [CONTRIBUTING.md](CONTRIBUTING.md), and find us on [Discord](https://discord.gg/3jrPJ3mXdX), [GitHub Discussions](https://github.com/penecho/penecho/discussions), and [GitHub Issues](https://github.com/penecho/penecho/issues).

## 📄 License

PenEcho is open source under [GNU AGPL v3.0 only](LICENSE); commercial use is allowed under the AGPL. If you modify PenEcho and serve it over a network, you must offer users the corresponding source code. An alternative [commercial license](COMMERCIAL-LICENSE.md) is available for products that cannot meet AGPL requirements. The PenEcho name and logo are governed by the [trademark policy](TRADEMARKS.md), and contributors keep ownership of their work under the [contributor agreement](CONTRIBUTOR-LICENSE-AGREEMENT.md).
