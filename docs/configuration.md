# Configuration reference

Detailed setup and configuration notes for PenEcho. For a project overview, see the [README](../README.md); for internals, see the [architecture notes](architecture.md).

## Config files and precedence

The default configuration is `~/.penecho/config.env`. API credentials are plaintext in this local file, receive owner-only permissions on POSIX systems, and are never sent to browser code. Protect it like any other credential. If `penecho` is started before this file exists, it opens the configuration center automatically in an interactive terminal.

Use a different env-style configuration file for a particular launch when needed:

```bash
penecho configure --config ./team.env
penecho --config ./team.env
```

An explicit `--config` file replaces the default global file for that command. PenEcho does not automatically read a project-directory `.env` or a package-directory `.env`. Command-line options and process environment variables take precedence over the selected configuration file.

## The configuration center

`penecho configure` opens the interactive configuration center. Its main menu contains `LLM source`, `Settings`, and `Exit`. Use the arrow keys and Enter to navigate:

- `LLM source -> Claude CLI` selects a detected, recommended, default, or manually entered model and an effort level. Opus 4.8 or newer is recommended; Sonnet and Opus 4.6 can respond but may produce weaker canvas results.
- `LLM source -> Codex CLI` selects a model and effort. GPT-5.5 or newer is required for good results, and `gpt-5.6-sol` is recommended.
- `LLM source -> API` selects the OpenAI-compatible or Anthropic/Claude-compatible request format, then asks for the URL, model, effort, and hidden key. API model calls use each format's standard SSE stream so response receipt is visible immediately and long generations do not wait for one final buffered JSON body; gateways that ignore streaming and return a normal JSON envelope remain compatible. Every new API or CLI connection starts at PenEcho `medium`; it stays native on Codex and Claude, maps to Kimi `high`, and enables MiniMax adaptive thinking. Existing values are offered as defaults and a blank key keeps the saved key.
- `Settings` controls the unified model timeout, the maximum API response tokens (including thinking tokens), the image format sent to every model executor, request recording and retention, listening interface and port, and initial Auto AI delay. The response-token limit defaults to 20,000 and must be larger than 15,000. WebP is the default; PNG is also available. The delay can also be changed on the canvas.

Every LLM page ends with `Test & Save`, and PenEcho always saves before checking. Codex CLI uses a fast offline check: it verifies the executable and login, then reads `codex debug models --bundled` to confirm the selected model exists. It does not run inference, attach an image, refresh the online catalog, or consume model tokens. Claude CLI and API configuration still send one small real request to verify the selected endpoint/model settings. Whether a check passes or fails, the configuration remains saved and the UI returns to the parent menu with a clear diagnostic.

## The Reasoning toolbar menu

The canvas toolbar exposes a fixed-width clickable `Reasoning` menu beside Auto AI for frequent per-request changes: `Configured`, `none`, `low`, `medium`, `high`, and the provider's highest practical level. `Configured` uses the selected connection's saved level; a toolbar choice overrides it without rewriting the connection.

The Canvas connection editor uses a separate editable Reasoning field. It suggests the literal lowercase values `none`, `low`, `medium`, `high`, `xhigh`, and `max`, but also accepts provider-native strings; a custom value keeps its exact spelling when saved, shown again, and passed through to the provider.

PenEcho maps this common scale to the selected model's native controls: Kimi's three levels, MiniMax's adaptive/disabled thinking mode, and model-specific Codex/Claude ceilings. PenEcho `medium` is a shared quality/speed intent rather than a promise that the provider has a same-named field: it stays native on Codex and Claude, becomes Kimi `high`, and enables MiniMax adaptive thinking. `none` cannot turn thinking off on Kimi or MiniMax-M2.x. Request records show both the selected and mapped values.

## CLI prerequisites

Installing the Codex desktop app alone does not guarantee that a `codex` executable is available on the shell `PATH`. Install and authenticate the CLI separately before selecting Codex:

```bash
npm install -g @openai/codex@latest
hash -r
codex --version
codex login status
```

If needed, run `codex login`. Claude CLI mode similarly requires an installed and authenticated Claude Code CLI, normally through `claude auth login`.

PenEcho uses the selected CLI locally and does not need an API key for that source. Normal startup checks the executable and login without consuming model tokens. Codex `Test & Save` additionally verifies the selected model against the installed CLI's bundled catalog without making a model request; Claude `Test & Save` sends a small real request.

## How CLI requests run

PenEcho has two deliberately separate CLI execution paths. Existing direct Canvas AI requests keep the behavior described below: each request is an isolated one-shot CLI invocation, and this path is not changed by Canvas Agent. DeepSeek Harness Canvas Agent uses a Harness-only persistent transport instead: one active Harness conversation owns one disposable upstream CLI conversation and process, Codex through `app-server`, Claude through a long-lived `stream-json` process, and Kimi through ACP. Clicking **New**, switching connection, Harness compaction, cancellation, timeout, process failure, or session expiry creates or rebuilds that upstream conversation from the authoritative Harness history. The upstream conversation is only a performance mirror identified by Harness replay metadata; it is never a second PenEcho history or a source of truth.

Canvas requests through Codex use `codex exec --json`. PenEcho returns as soon as Codex emits the final agent message and `turn.completed`; if the CLI process remains alive afterward, it is terminated and cleaned up in the background instead of delaying the canvas response.

Claude CLI requests use one isolated `claude -p` turn with tools, agents, MCP, prompt suggestions, session persistence, and other nonessential background traffic disabled. Selecting effort `none` sets `MAX_THINKING_TOKENS=0`, causing Claude Code to send `thinking.type=disabled`; because `none` is not a valid Claude CLI effort value, PenEcho also passes an internal `low` effort and per-process `--settings` override to neutralize any user-level `CLAUDE_CODE_EFFORT_LEVEL=max`. Selecting `low`, `medium`, `high`, or `max` leaves thinking enabled and applies the chosen value through both Claude's `--effort` flag and the same settings override. PenEcho incrementally validates the stream and returns as soon as Claude emits its successful final `result`; any attempted tool use aborts the request, while a CLI process that remains alive after the result is terminated and cleaned up in the background.

## Canvas Agent local resources

Canvas Agent can run without a resource, against one selected folder, or against one selected file. The selection belongs to the PenEcho host that executes the Agent, not necessarily the browser displaying the Canvas:

- Local, LAN, and desktop Canvas pages choose project folders in PenEcho's built-in host-folder browser. The local browser starts at the PenEcho host user's Home, hides private dot directories and platform application-data folders, and requires choosing a child folder rather than the whole Home directory.
- A Cloud Canvas can select an already registered resource or use the same built-in browser only within the allowed roots configured on its currently pinned PenEcho host. Cloud receives opaque root IDs, safe labels, and relative folder names; it cannot submit a raw absolute host path or access the implicit local Home root.
- An iPad or other browser cannot expose its local filesystem path or run Bash locally. It can attach any non-empty file, up to 32 MiB, as a private PenEcho-managed copy. The file remains a removable composer attachment until the user adds instructions and sends; after sending, its safe file card remains in the conversation. Removing a pending attachment deletes only the managed copy without a confirmation dialog. In the PenEcho desktop app, double-clicking either file card asks the desktop host to revalidate the registered exact file and open it with the system default application; browser clients never receive the absolute path.

Configure the folders that Cloud clients may browse with a JSON array in `~/.penecho/config.env`:

```dotenv
PENECHO_CANVAS_AGENT_ALLOWED_ROOTS='[{"name":"Projects","path":"/srv/projects"},{"name":"Research","path":"/data/research"}]'
```

Windows paths inside the JSON value need JSON escaping, for example `C:\\Users\\me\\Projects`. PenEcho resolves every configured root and every selected child again on the host, rejects symlink/junction escapes and `.penecho`, and never returns the canonical absolute path to Cloud. An empty or omitted array disables Cloud folder browsing without affecting the local built-in Home browser or native single-file selection.

Folder resources are currently read-only. They expose bounded `glob`, `grep`, `list_directory`, `read`, and `read_image`, plus lazy document and SQLite readers. `glob` and `grep` use PenEcho's packaged ripgrep binary with fixed arguments, no shell layer, project-root path validation, and bounded output. PenEcho does not register `write`, `edit`, Bash, or command execution, and the former `Read & Write` and `Full Access` controls are hidden. Legacy clients that still send `full` are normalized to the same read-only session.

A single-file resource is always read-only and exact-file scoped. It exposes only the matching text, image, document, or SQLite reader; any other format receives a bounded hexadecimal/ASCII reader that never executes the file. No parent directory, sibling files, Bash, write, or edit capability is available. PDF/DOCX/XLSX/CSV/PPTX and SQLite readers are loaded on demand for folder projects; selecting one such valid file directly mounts only its matching reader. Text, extracted document text, and spreadsheet windows follow the Harness `read` contract: at most 2,000 lines or rows and 50 KiB of selected content per call, with an explicit continuation offset. PDF text can be extracted or one bounded page can be rendered for visual inspection, DOCX returns bounded text, PPTX returns bounded slide text and notes, XLSX/CSV returns bounded table rows, and SQLite accepts one bounded read-only `SELECT`, `WITH`, or `EXPLAIN` query.

The five most recent UI conversation projections are stored in `<folder>/.penecho` for folder resources, in private PenEcho state for single-file resources, and in browser storage when no resource is selected. These projections are for history display only and do not restore Harness model context after a server restart.

## Transient launch overrides

```bash
penecho doctor --codex
penecho --codex --model gpt-5.6-sol --effort xhigh
penecho --claude --model opus --effort max
penecho --port 4000
```

`--model`, `--effort`, and `--port` apply only to that process and take precedence over the selected configuration file. Omit them to use the saved choice or the underlying CLI default. Other model-specific effort strings are accepted and passed through.

## Version checks

Interactive starts print the current version immediately. After the server is listening, PenEcho displays `Checking latest PenEcho version...` and queries npm without delaying availability. If a newer version exists, press Enter at the default `Y` prompt to install it globally. The current service then stops without launching a background process; run `penecho` again when you are ready to start the updated version. When the installed version is current, PenEcho says so explicitly. Offline checks and non-interactive starts continue without blocking the running service.

## Full settings reference

| Setting | Purpose |
| --- | --- |
| `AI_PROVIDER` | Executor: `api`, `codex-cli`, or `claude-cli` |
| `AI_API_FORMAT` | API request format: `openai` (default example) or `anthropic` |
| `AI_API_URL` / `AI_API_KEY` | API endpoint and credential; used only in API mode |
| `AI_API_MODEL` | Model used in API mode |
| `TAVILY_API_KEY` | Optional primary Tavily credential for Canvas Agent internet search; saved locally and used only by the server when the per-device search toggle is on. Without it, the Agent still receives built-in Crossref/arXiv research search, GitHub repository search, Yahoo Finance symbol lookup and market history, and DuckDuckGo backup web search directly, without a loader round trip. Yahoo Finance needs no key but exposes an unofficial, rate-limitable interface that yfinance documents for personal research use. |
| `AI_EFFORT` | Saved PenEcho reasoning level; new configurations default to `medium`, the toolbar can override it per request, and the server maps it to each selected provider/model's supported native control |
| `AI_TIMEOUT_SECONDS` | Unified timeout for API and CLI model attempts; default 180, allowed range 10–600. `xhigh` and `max` attempts use twice this value. Once the total timeout is reached, an active stream may continue until no data has arrived for 10 seconds. |
| `MAX_TOKENS` | Maximum API response-token allowance, including thinking tokens; default 20,000 and must be larger than 15,000. Low values may be exhausted during reasoning. Restart PenEcho after changing it. |
| `PENECHO_AI_IMAGE_FORMAT` | Image format sent to API, Codex CLI, and Claude CLI: `webp` (default) or `png` |
| `CODEX_CLI_MODEL` | Optional model override for Codex CLI mode |
| `CLAUDE_CLI_MODEL` | Optional alias or model-ID override for Claude CLI mode |
| `AUTO_AI_DELAY_SECONDS` | Initial delay before automatic recognition; the browser control can override it from 0 to 10 seconds |
| `PENECHO_REQUEST_TRACE` | Save local per-request image, outbound request, response, and outcome traces; disabled by default |
| `PENECHO_REQUEST_TRACE_LIMIT` | Number of local request traces retained, default 100 and maximum 1000 |
| `PENECHO_CANVAS_AGENT_ALLOWED_ROOTS` | JSON array of absolute PenEcho-host folders that Cloud may browse through opaque IDs and relative paths; omitted by default |
| `PENECHO_CLOUD_ENV` | Internal Cloud target switch: `uat` uses the dedicated HTTPS UAT service; every other value uses production |
| `PENECHO_CLOUD_ORIGIN` | Optional explicit Cloud origin override; takes precedence over `PENECHO_CLOUD_ENV` |
| `HOST` / `PORT` | Listening interface and port, default `0.0.0.0:3888` |

For installed CLI starts, `--model` overrides the selected executor's model setting and `--effort` overrides `AI_EFFORT` for that process only.

## Request recording

When request recording is enabled in `Settings`, each valid AI request is stored under `~/.penecho/logs/requests` by default, including the source `atlas.png`, the outbound image, credential-redacted request body, raw and parsed responses, fallback details, and final status. A Canvas Agent turn uses the same server-side request directory: one `trace.json` groups its Harness model steps, user/final assistant messages, tool calls/results, request context, usage, and final state. Every user image or Canvas capture actually supplied as visual model input is copied beside it as a `vision-*` file and referenced by the consuming step; encoded image bytes, credentials, resume capabilities, and internal resumable session IDs are omitted from JSON. Debug artifacts may additionally write a compact projected conversation log to the rotating local service log. The UI displays the request-recording path and configures retention. Keep debug artifacts and request tracing disabled in production unless you are actively diagnosing a problem, and never publish configuration files, logs, screenshots, or saved requests containing private content.
