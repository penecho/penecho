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
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#recommended-model-configurations">Recommended Models</a> &bull;
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

## A Kimi Open Source Friend

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

## Contents

- [Quick start](#quick-start)
- [Think on the canvas](#think-on-the-canvas)
- [What's new in 0.9.0](#whats-new-in-090)
- [Earlier release highlights](#earlier-release-highlights)
- [Previous releases](#previous-releases)
- [How it works](#how-it-works)
- [Recommended model configurations](#recommended-model-configurations)
- [Token use and cost](#token-use-and-cost)
- [Safe deployment](#safe-deployment)
- [Useful configuration](#useful-configuration)
- [Build it with us](#build-it-with-us)
- [License and commercial use](#license-and-commercial-use)

## Quick start

### Desktop app

[Download from GitHub Releases](https://github.com/penecho/penecho/releases/latest).

For npm installation, you need [Node.js 20.3+](https://nodejs.org/) and one of the following: an API key, an authenticated [Codex CLI](https://developers.openai.com/codex/cli), or an authenticated [Claude Code CLI](https://code.claude.com/docs/en/overview).

```bash
npm install -g penecho
penecho configure
penecho
```

Interactive starts print the current version immediately. After the server is listening, PenEcho displays `Checking latest PenEcho version...` and queries npm without delaying availability. If a newer version exists, press Enter at the default `Y` prompt to install it globally. The current service then stops without launching a background process; run `penecho` again when you are ready to start the updated version. When the installed version is current, PenEcho says so explicitly. Offline checks and non-interactive starts continue without blocking the running service.

`penecho configure` opens the interactive configuration center. Its main menu contains `LLM source`, `Settings`, and `Exit`. Use the arrow keys and Enter to navigate:

- `LLM source -> Claude CLI` selects a detected, recommended, default, or manually entered model and an effort level. Opus 4.8 or newer is recommended; Sonnet and Opus 4.6 can respond but may produce weaker canvas results.
- `LLM source -> Codex CLI` selects a model and effort. GPT-5.5 or newer is required for good results, and `gpt-5.6-sol` is recommended.
- `LLM source -> API` selects the OpenAI-compatible or Anthropic/Claude-compatible request format, then asks for the URL, model, effort, and hidden key. API model calls use each format's standard SSE stream so response receipt is visible immediately and long generations do not wait for one final buffered JSON body; gateways that ignore streaming and return a normal JSON envelope remain compatible. Every new API or CLI connection starts at PenEcho `medium`; it stays native on Codex and Claude, maps to Kimi `high`, and enables MiniMax adaptive thinking. Existing values are offered as defaults and a blank key keeps the saved key.
- `Settings` controls the unified model timeout, the maximum API response tokens (including thinking tokens), the image format sent to every model executor, request recording and retention, listening interface and port, and initial Auto AI delay. The response-token limit defaults to 20,000 and must be larger than 15,000. WebP is the default; PNG is also available. The delay can also be changed on the canvas.

Every LLM page ends with `Test & Save`, and PenEcho always saves before checking. Codex CLI uses a fast offline check: it verifies the executable and login, then reads `codex debug models --bundled` to confirm the selected model exists. It does not run inference, attach an image, refresh the online catalog, or consume model tokens. Claude CLI and API configuration still send one small real request to verify the selected endpoint/model settings. Whether a check passes or fails, the configuration remains saved and the UI returns to the parent menu with a clear diagnostic.

The canvas toolbar exposes a fixed-width clickable `Reasoning` menu beside Auto AI for frequent per-request changes: `Configured`, `none`, `low`, `medium`, `high`, and the provider's highest practical level. `Configured` uses the selected connection's saved level; a toolbar choice overrides it without rewriting the connection. PenEcho maps this common scale to the selected model's native controls: Kimi's three levels, MiniMax's adaptive/disabled thinking mode, and model-specific Codex/Claude ceilings. PenEcho `medium` is a shared quality/speed intent rather than a promise that the provider has a same-named field: it stays native on Codex and Claude, becomes Kimi `high`, and enables MiniMax adaptive thinking. `none` cannot turn thinking off on Kimi or MiniMax-M2.x. Request records show both the selected and mapped values.

The default configuration is `~/.penecho/config.env`. API credentials are plaintext in this local file, receive owner-only permissions on POSIX systems, and are never sent to browser code. Protect it like any other credential. If `penecho` is started before this file exists, it opens the configuration center automatically in an interactive terminal.

Use a different env-style configuration file for a particular launch when needed:

```bash
penecho configure --config ./team.env
penecho --config ./team.env
```

An explicit `--config` file replaces the default global file for that command. PenEcho does not automatically read a project-directory `.env` or a package-directory `.env`.

### CLI prerequisites

Installing the Codex desktop app alone does not guarantee that a `codex` executable is available on the shell `PATH`. Install and authenticate the CLI separately before selecting Codex:

```bash
npm install -g @openai/codex@latest
hash -r
codex --version
codex login status
```

If needed, run `codex login`. Claude CLI mode similarly requires an installed and authenticated Claude Code CLI, normally through `claude auth login`.

PenEcho uses the selected CLI locally and does not need an API key for that source. Normal startup checks the executable and login without consuming model tokens. Codex `Test & Save` additionally verifies the selected model against the installed CLI's bundled catalog without making a model request; Claude `Test & Save` sends a small real request.

Canvas requests through Codex use `codex exec --json`. PenEcho returns as soon as Codex emits the final agent message and `turn.completed`; if the CLI process remains alive afterward, it is terminated and cleaned up in the background instead of delaying the canvas response.

Claude CLI requests use one isolated `claude -p` turn with tools, agents, MCP, prompt suggestions, session persistence, and other nonessential background traffic disabled. Selecting effort `none` sets `MAX_THINKING_TOKENS=0`, causing Claude Code to send `thinking.type=disabled`; because `none` is not a valid Claude CLI effort value, PenEcho also passes an internal `low` effort and per-process `--settings` override to neutralize any user-level `CLAUDE_CODE_EFFORT_LEVEL=max`. Selecting `low`, `medium`, `high`, or `max` leaves thinking enabled and applies the chosen value through both Claude's `--effort` flag and the same settings override. PenEcho incrementally validates the stream and returns as soon as Claude emits its successful final `result`; any attempted tool use aborts the request, while a CLI process that remains alive after the result is terminated and cleaned up in the background.

Transient launch overrides remain available:

```bash
penecho doctor --codex
penecho --codex --model gpt-5.6-sol --effort xhigh
penecho --claude --model opus --effort max
penecho --port 4000
```

`--model`, `--effort`, and `--port` apply only to that process and take precedence over the selected configuration file. Omit them to use the saved choice or the underlying CLI default. Other model-specific effort strings are accepted and passed through.

### Run from this source directory

Install dependencies and start this checkout through the same production entry point as the installed CLI:

```bash
npm install
npm start
```

The first interactive start opens the configuration center when needed. Arguments after `--` are passed to PenEcho, for example `npm start -- --port 4000`.

To expose this checkout's `penecho` command globally instead, use:

```bash
npm link
penecho configure
penecho
```

`npm link` creates the local command link; it does not publish the package. There is no separate build step.

Open [http://localhost:3888](http://localhost:3888). On each PenEcho start, the first browser must either create a shared six-digit security code or explicitly keep the process open to the local network. The code is stored only as a salted in-memory hash and is cleared when PenEcho restarts; Canvas files and settings are not affected.

With the default `0.0.0.0` listener, startup also prints the machine's concrete LAN URLs on the following lines. Open one of those URLs on another device and enter the same security code; if it cannot connect, allow the configured inbound TCP port in the host operating system's firewall or applicable routing policy.

## Think on the canvas

Put a question, equation, diagram, or half-formed idea anywhere on the canvas and pause. PenEcho reads your marks and their spatial relationships, then answers beside them. You can work through a problem without translating every step into a chat message or rebuilding it with rigid diagram tools.

- Get answers, hints, explanations, continuations, formulas, plots, and diagrams directly on the canvas.
- Drag AI drafts directly on the canvas, resize them by group or axis, copy returned text or formulas, then accept or discard them before they become part of your work.
- Draw naturally with a stylus or mouse, then pan and zoom across a sparse `20,000 x 20,000` canvas.
- Draw a freehand lasso around confirmed ink to move, resize, recolor, delete, or send only that selection to Typeset; ordinary selection edits and cancellation never trigger an AI request.
- Choose Arcane, Sci-fi, Research, or Studio mode to match the kind of problem you are exploring.
- Save lightweight snapshots on this device or on the PenEcho server for access from other authorized devices. Starting a new canvas can overwrite the current snapshot, save a new copy, or continue without saving; unconfirmed AI drafts are never included.
- Export confirmed canvas ink as a cropped PNG with one `512`-pixel tile of paper margin on every side.

PenEcho keeps a small local runtime and only allocates `512 x 512` tiles where ink exists, so the huge logical canvas does not become a huge bitmap.

## What's new in 0.9.0

- **Multiple AI connections with one-click switching.** Save up to ten API or CLI connections, use editable Kimi and MiniMax regional/Coding Plan presets, test a connection before use, and choose a different active connection on each client connected to the same PenEcho host. API and CLI changes apply immediately.
- **Faster, more flexible Refine.** Write instructions anywhere in the visible viewport, then choose which nearby widget to improve. Refine sends the widget's editable source when available and uses a standard unified diff instead of regenerating the full widget, substantially reducing tokens and turnaround time while preserving confirmation and undo. Hand stays visually clean until an object is tapped to reveal its controls.
- **True streaming API requests.** OpenAI- and Anthropic-compatible APIs now use end-to-end SSE streaming, so PenEcho can show response receipt immediately, avoid long buffered waits through gateways, and handle lengthy requests more reliably.
- **Clear request progress and cancellation.** The top status area reports preparation, connection, waiting, streaming, validation, retries, and long-wait timeouts without shifting the canvas. During a request, the magic button becomes a stop control that cancels active work while preserving unsent Refine instructions.

## Earlier release highlights

- **0.8.1.** Added live public-data access for General HTML widgets and SVG-first animation and complex graphics.
- **0.8.0.** Added editable professional diagrams, direct widget refinement, server-backed canvas storage, richer clipboard and text workflows, and smaller plugin prompts.
- **0.7.2.** Added sourced web photos and professional flowcharts, more reliable editing, persistence and PNG export, protected local/LAN access, and stronger desktop integration.

## Previous releases

- **0.7.1.** Added local images and photos, Hand-based object editing, snapshots and PNG export, copyable Mermaid flowcharts, and sourced online image results.
- **0.7.0.** Introduced sandboxed interactive HTML, focused live-data plugins, local plugin creation, and canvas-native widget persistence.
- **0.6.0 and earlier.** Added declarative animation scenes, improved Markdown/LaTeX rendering and model reliability, selection tools, and the sparse large-canvas foundation.

## How it works

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/how-it-works-dark.svg">
    <img alt="How PenEcho works: canvas ink becomes a visual atlas, the server routes it to the configured executor, and a structured editable draft returns to the canvas" src="docs/assets/how-it-works-light.svg">
  </picture>
</p>

The browser sends only the relevant canvas crop and geometry. The server validates the request, uses the selected executor, and returns a movable draft that stays separate from confirmed ink until you accept it.

## Recommended model configurations

These recommendations balance answer quality against the latency of PenEcho's real canvas workload. They are based on current hands-on testing rather than synthetic benchmarks; actual response time still varies with the provider, canvas complexity, image size, and reasoning behavior.

| Model | Effort | Quality and speed | Recommended use |
| --- | --- | --- | --- |
| `claude-opus-4-8` | `medium` | Strong quality with a better latency balance | Recommended Opus default for everyday canvas work |
| `claude-opus-4-8` | `high` | Higher reasoning quality, with longer and more variable waits | Complex handwriting, mathematics, diagrams, or layout decisions where quality matters more than speed |
| Fable 5 (`claude-fable-5` or `fable`) | `medium` | Very good results; in current tests, often around half the response time of `gpt-5.6-sol` at `xhigh` | A fast, high-quality general-purpose choice |
| [Kimi K3](https://platform.kimi.ai?aff=penecho) (`kimi-k3`) | `medium` | Very good quality in the current comparison; `medium` keeps the quality/speed balance practical | Recommended Kimi Open Platform default for demanding canvas work |
| `gpt-5.6-terra` | `low` to `high` | Surprisingly strong and responsive; current PenEcho canvas tests produced better results than `gpt-5.6-sol` with fast response times | Recommended OpenAI option across a flexible range of quality and latency targets |
| `gpt-5.6-luna` | `xhigh` | Very good canvas results with strong response speed | A responsive quality-first option when `xhigh` reasoning is appropriate |
| `gpt-5.6-sol` | `high` | Good enough for most requests and more responsive than `xhigh` | Recommended Sol default when responsiveness matters |
| `gpt-5.6-sol` | `xhigh` | Very good results, but slower and more variable | Quality-first Sol configuration for difficult canvas tasks |

Google models have not been tested yet. Contributions are welcome: if you try Gemini or another Google model, please share the model ID, provider or executor, reasoning configuration, approximate latency, and a representative canvas example in an issue.

## Token use and cost

For a typical PenEcho canvas request, total output usage—including hidden reasoning tokens when the provider reports them—roughly follows the selected effort level:

| Effort | Typical output usage | Practical guidance |
| --- | --- | --- |
| `low` | Around `1,000` tokens | Usually enough for most everyday canvas requests |
| `medium` | Around `3,000` tokens | More reasoning headroom for recognition, mathematics, diagrams, and layout |
| `xhigh` or `max` | Around `5,000–8,000` tokens | Common for quality-first `gpt-5.6-sol` and other maximum-effort requests; expect higher latency and cost |

These are practical estimates rather than enforced PenEcho limits. Actual usage can vary substantially by model, provider, canvas complexity, and reasoning behavior. The cost example below continues to use the typical `low` case: `10,000` input tokens and `1,000` output tokens. At standard short-context API rates, that would be:

- `gpt-5.6-sol`: `10,000 x $5.00 / 1M + 1,000 x $30.00 / 1M = $0.080`
- `gpt-5.6-terra`: `10,000 x $2.50 / 1M + 1,000 x $15.00 / 1M = $0.040`
- `gpt-5.6-luna`: `10,000 x $1.00 / 1M + 1,000 x $6.00 / 1M = $0.016`

At those example quantities, that is about 1.6 to 8 cents per request. Medium, `xhigh`, and `max` requests can cost more because their reasoning tokens are billed as output. Prices can change, so check the [OpenAI API pricing](https://developers.openai.com/api/docs/pricing) page for current rates.

If you sign in to Codex with ChatGPT, PenEcho uses the Codex usage included with your plan instead of an API key. Included limits vary by plan, and additional usage may require ChatGPT credits. See [Codex pricing](https://learn.chatgpt.com/docs/pricing) for current plans and limits. Claude CLI mode similarly uses the account authenticated by Claude Code; it is distinct from Anthropic API billing.

## Safe deployment

PenEcho listens on `0.0.0.0:3888` by default so localhost and trusted-LAN access work immediately. Each process starts in an undecided local-access state: choose a shared six-digit code to protect the Canvas, or explicitly acknowledge the risk and continue without one. A browser receives an `HttpOnly`, same-site process-lifetime session only after setting or entering the code. Repeated failures are rate-limited. This code is a practical trusted-LAN guard, not Internet-grade authentication.

- **Kimi CLI, Codex CLI, and Claude CLI modes:** use them only on the local machine or a trusted, directly connected LAN. A valid request starts a local CLI process, so do not expose these modes directly to the public internet or an untrusted reverse proxy. PenEcho checks the Host, client network, exact Origin, process-lifetime session cookie, and JSON content type before launching the selected CLI. Each valid new request immediately supersedes the prior request; it never waits in a queue or returns a busy response.
- **API mode:** the six-digit-code choice protects browser access and AI requests while it is active. If the operator explicitly continues without a code, API requests retain the previous unrestricted remote behavior. For any public exposure, place PenEcho behind HTTPS, stronger authentication, rate limiting, and request-size controls. Keep the selected configuration file and provider keys private; credentials remain in the Node.js process and are never sent to browser code.

For either mode, keep debug artifacts and request tracing disabled in production unless you are actively diagnosing a problem, and never publish configuration files, logs, screenshots, or saved requests containing private content. When request recording is enabled in `Settings`, each valid AI request is stored under `~/.penecho/logs/requests` by default, including the source `atlas.png`, the outbound image, credential-redacted request body, raw and parsed responses, fallback details, and final status. The UI also displays this path and configures retention.

## Useful configuration

The configuration center writes these settings to `~/.penecho/config.env`, or to the file selected with `--config`:

| Setting | Purpose |
| --- | --- |
| `AI_PROVIDER` | Executor: `api`, `codex-cli`, or `claude-cli` |
| `AI_API_FORMAT` | API request format: `openai` (default example) or `anthropic` |
| `AI_API_URL` / `AI_API_KEY` | API endpoint and credential; used only in API mode |
| `AI_API_MODEL` | Model used in API mode |
| `AI_EFFORT` | Saved PenEcho reasoning level; new configurations default to `medium`, the toolbar can override it per request, and the server maps it to each selected provider/model's supported native control |
| `AI_TIMEOUT_SECONDS` | Unified timeout for API and CLI model attempts; default 180, allowed range 10–600. `xhigh` and `max` attempts use twice this value. Once the total timeout is reached, an active stream may continue until no data has arrived for 10 seconds. |
| `MAX_TOKENS` | Maximum API response-token allowance, including thinking tokens; default 20,000 and must be larger than 15,000. Low values may be exhausted during reasoning. Restart PenEcho after changing it. |
| `PENECHO_AI_IMAGE_FORMAT` | Image format sent to API, Codex CLI, and Claude CLI: `webp` (default) or `png` |
| `CODEX_CLI_MODEL` | Optional model override for Codex CLI mode |
| `CLAUDE_CLI_MODEL` | Optional alias or model-ID override for Claude CLI mode |
| `AUTO_AI_DELAY_SECONDS` | Initial delay before automatic recognition; the browser control can override it from 0 to 10 seconds |
| `PENECHO_REQUEST_TRACE` | Save local per-request image, outbound request, response, and outcome traces; disabled by default |
| `PENECHO_REQUEST_TRACE_LIMIT` | Number of local request traces retained, default 100 and maximum 1000 |
| `HOST` / `PORT` | Listening interface and port, default `0.0.0.0:3888` |

For installed CLI starts, `--model` overrides the selected executor's model setting and `--effort` overrides `AI_EFFORT` for that process only. Command-line options and process environment variables take precedence over the selected configuration file.

Run the checks before submitting a change:

```bash
npm run check
```

For implementation details, see the [architecture notes](docs/architecture.md).

## Build it with us

PenEcho is young and built in the open. The problems that matter most — handwriting recognition, on-canvas visual tools, wider model support, and natural pen interaction — are still open, and you do not need to write code to help move them forward.

Ways to help:

- **Use it and share what happened.** A canvas that worked well, or one that fell apart, tells us more than any benchmark. A screenshot with secrets removed is enough.
- **Test a model.** PenEcho supports model selection independently for API, Codex CLI, and Claude CLI execution, and behavior still varies by model. Report the executor, model ID, effort, rough latency, and a sample result. Google/Gemini models are still untested and especially welcome.
- **Report rough edges.** Recognition misses, layout glitches, and awkward pen behavior are all worth an issue, however small. For model-specific issues, include a reproducible canvas example and expected and actual results.
- **Write code.** Recognition, visual tools, model adapters, and pen input each have room to grow. `npm run check` runs the full suite before you open a pull request.
- **Help more people read it.** The UI ships English and Chinese today; more translations and clearer docs are welcome.

Where to talk:

- [Discord](https://discord.gg/3jrPJ3mXdX) — real-time discussion, model-testing notes, and shared canvas workflows. New faces and works-in-progress are always welcome.
- [GitHub Discussions](https://github.com/penecho/penecho/discussions) — ideas and questions worth keeping searchable.
- [GitHub Issues](https://github.com/penecho/penecho/issues) — reproducible bugs and confirmed work.

New contributors start with [CONTRIBUTING.md](CONTRIBUTING.md). If PenEcho clicks for you, star the repo and share the demo — that visibility is what brings the next person in.

## License and commercial use

PenEcho is open source under [GNU AGPL v3.0 only](LICENSE). Commercial use is allowed under the AGPL. If you modify PenEcho and provide that version to users over a network, you must offer those users the corresponding source code as required by the license.

An alternative [commercial license](COMMERCIAL-LICENSE.md) is available for proprietary products and hosted services that cannot meet the AGPL requirements. The PenEcho name and logo are governed separately by the [PenEcho trademark policy](TRADEMARKS.md).

Contributors keep ownership of their work and grant the project the rights needed to offer both AGPL and commercial editions. See the [contributor agreement](CONTRIBUTOR-LICENSE-AGREEMENT.md).
