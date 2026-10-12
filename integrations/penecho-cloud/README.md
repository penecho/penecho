# PenEcho — A shared spatial workspace for you and Claude

A shared spatial workspace for you and Claude to create diagrams, draw, take notes, and share your work.

Create diagrams, simple drawings and notes with Claude on the same editable Canvas. Sketch or annotate feedback directly alongside the work, then ask Claude to read it and revise the same content. Keep ideas and their revisions visible in one shared workspace as the conversation continues.

Use the browser's Canvas controls to export a PNG without an account. Sign in and save the Canvas to Cloud to create a public view-only link; viewers can open that link without signing in. Export and sharing are browser actions.

## Connect

Attach `penecho-cloud-plugin.zip` (complete plugin) or `penecho-canvas.zip` (standalone Skill) to your local Codex or Claude Code conversation and paste:

> Please install PenEcho from the attached package for the app I am using, complete the supported setup, and verify that its Canvas tools work. After installation, use PenEcho when I ask to show or edit something on a canvas. Involve me only when the app requires a native confirmation or authorization.

The assistant reads [INSTALL.md](INSTALL.md), performs installation and checks the actual host. Local Codex (including Windows Desktop) and Claude Code can install the complete Skill persistently and set up native HTTPS. Native trust and OAuth consent still apply; choose anonymous use to start without an account. Repeated installation reuses existing supported Skill paths and verified connections.

Claude Chat and Cowork use their native account plugin/connector flow. The byte-equivalent `penecho-cloud.plugin` is provided for a host that exposes plugin upload/install. If that action or Connect requires you to click, the assistant identifies the supported step. A CLI or copied Skill inside a Cowork sandbox does not install a claude.ai account plugin. Native install-card behavior has not been tested.

After setup, ask **“On the canvas, create a three-step diagram: Idea → Draft → Done.”** The assistant opens a compact browser Canvas, preferably beside the chat, without a Dashboard visit, MCP switch or token copying. Annotate, undo or fit content in the narrow rail; **Full Canvas** opens the complete interface in the same tab. **Save** signs you in or creates an account in that browser, then returns to the same draft and completes that explicit save once. Canceling keeps the draft. Ordinary sign-in does not save automatically.

Codex can open on the right when its actual browser capability is exposed. Claude desktop uses its supported opener; a terminal-only Claude Code session uses the default browser. After installation, the assistant uses supported reload/reconnect and verifies visible tools with an authenticated read-only call. Files copied or a connection saved alone do not mean the current conversation is ready.

Local plugin installation remains supported. The repository-root catalogs are prepared distribution material; remote marketplace installation depends on publishing those catalogs. This local candidate has not been pushed or published. Claude Code's persistent native marketplace install is available for an accessible local source; `--plugin-dir` is a development loader. The direct complete-Skill/native HTTP installer is the persistent fallback.

The endpoint uses Streamable HTTP and OAuth authorization code with PKCE S256. The host stores and refreshes credentials. MCP operations consume no PenEcho model credits; the external assistant's model usage is separate. Drafts live in the browser until explicitly saved. Keep that browser open while using MCP. A guest connection remains guest-scoped after browser sign-in.

Explicit destinations and already-bound workspaces take precedence, followed by a current user-selected UAT workflow. An old installed UAT Skill alone does not choose UAT. An explicitly selected existing Canvas retains its current MCP connection. Local desktop MCP is available separately. See the [MCP setup guide](https://github.com/penecho/penecho/blob/main/docs/mcp-setup.md).

## Try it

- “On the canvas, create a three-step diagram: Idea → Draft → Done.”
- “On the canvas, draw a house with a sun beside it.”
- “Create a note on the canvas titled Today with three bullets: Plan, Build, Review.”

Only the connected workspace or explicitly selected, opted-in canvases are available. Authorization does not grant access to another account or general Dashboard administration. Review edits before relying on their content. Revoke a client from PenEcho's MCP settings when no longer needed.

## Data and optional local setup

The assistant sends the arguments for requested Canvas operations to the declared PenEcho endpoint, `https://penecho.ai/mcp`. Depending on your request, those arguments can include drawing content, widget source, uploaded images, handwritten feedback and the connected Canvas context needed to read or revise the work. Canvas reads return that requested context to your assistant. Choose the material you want to work with and avoid supplying secrets or private transcripts. Browser drafts and explicit Cloud saves are separate from processing these MCP requests; a draft remaining in the browser does not mean its MCP content never reaches PenEcho. See the [privacy policy](https://penecho.ai/privacy.html).

The native plugin's HTTPS connection does not start a local server. If a local host needs the standalone Skill fallback, the optional `skills/penecho-canvas/scripts/install.mjs` helper runs on Node.js using its standard library. It copies the complete Skill into a supported persistent user Skill directory and calls the already-installed Codex or Claude CLI to inspect and, when missing, add this production MCP connection. It preserves unrelated configuration and reuses a verified existing connection. For Codex, it can start a temporary native app-server to discover the exact installed Skill and enable that Skill if disabled. The companion `setup-mcp.mjs` helper handles the bounded native MCP inspection and setup. These helpers do not install the host CLI or require a package-manager download. Read [INSTALL.md](INSTALL.md) for the actual host's supported installation and verification steps.

The native connection uses host-managed OAuth with the `canvas:access` scope and resource `https://penecho.ai/mcp`. The host handles authorization, credential storage and refresh; anonymous access remains guest-scoped, while account access is limited to the authorized Canvas workflow. Native trust and OAuth consent may require your interaction. Installation and saved configuration alone do not establish authenticated access or current-conversation tool availability.

## Distribution files

- `penecho-cloud-plugin.zip` contains the native plugin, including root Streamable HTTP `mcp.json` using endpoint OAuth discovery, native HTTP `.mcp.json`, host manifests and Skill. Extract before a host requiring a plugin directory loads it.
- `penecho-canvas.zip` contains the standalone `penecho-canvas/` Skill, helper, metadata and native HTTP example. Its bundled installer copies the complete folder and attempts native Codex activation verification.
- `penecho-cloud.plugin` is byte-identical to the complete plugin ZIP, provided as a native upload artifact where the host supports it.
- `penecho-hermes-plugin.zip` contains the separate generated Hermes compatibility plugin from `hermes/portable/`, including its pinned stdio bridge and an identical copy of the canonical Skill.
- Rebuild all archives and the `.plugin` artifact from canonical source with `python3 scripts/package-penecho-cloud.py`. The main plugin excludes Hermes artifacts and historical submission material; all archives exclude UAT, credentials, cache files and nested ZIPs.

Native HTTP is the Codex/Claude/Cursor/connector path. Root `mcp.json` declares only the standard `streamable-http` transport and URL `https://penecho.ai/mcp`. The endpoint advertises OAuth discovery and dynamic client registration; normal host authorization uses that discovery. For an OpenAI submission portal, select OAuth and dynamic client registration there, with resource `https://penecho.ai/mcp` and scope `canvas:access`. `.mcp.json` uses native `http` for hosts using that format. Neither main connection file launches a command or embeds credentials. Keep unsupported server extensions out of the native manifest. Loader acceptance does not prove completed OAuth or a working Canvas session. The pinned `mcp-remote@0.1.38` stdio bridge lives only in `hermes/portable/mcp.json` and its separate compatibility archive. Reuse a verified existing alias and refuse to overwrite conflicting/disabled configurations.

Anonymous identity and refresh retention must align at ten years in the matching server release. These files cannot change or prove deployed retention, and initial OAuth does not prove ten-year host reconnection. Expired 120-second launch tickets are renewed automatically with the same key and tab, with bounded retries.

The native host manifests share the Canvas workflow Skill; Codex resolves root `mcp.json`, while Claude/Cursor can use `.mcp.json`. The Codex catalog requests authentication on installation. The separate Hermes catalog entry points to `integrations/penecho-cloud/hermes/portable`; its generated Skill copies must match canonical source. `server.json` describes the cloud service for the official MCP Registry under the verified GitHub organization namespace. These files alone do not mean any marketplace has approved or published the listing.

[Website](https://penecho.ai) · [Privacy](https://penecho.ai/privacy.html) · [Terms](https://penecho.ai/terms.html) · [Support](https://penecho.ai/contact.html)

The original plugin configuration, workflow skill, and documentation are licensed under MIT; see LICENSE. This does not change the PenEcho application license. The logo and trademarks are excluded from the MIT grant and remain subject to the main repository's trademark policy.
