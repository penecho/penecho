# PenEcho 1.1.4 distribution release checklist

Production MCP at `https://penecho.ai/mcp` already exists. This checklist describes a local distribution candidate, not a claim that this change is deployed, pushed, approved or published. Canonical Canvas source is `penecho_071_version`; Cloud mirrors must use the official synchronization process.

## Expected workflow

The plugin bundles native HTTPS MCP configuration and the Canvas Skill. Standalone Skill installation/first use also authorizes automatic setup of its missing connection, without an extra conversational permission question; host approvals and OAuth consent still apply. Explicit destinations/current workspaces take precedence, then a current user-selected UAT testing workflow, then production for ordinary untargeted work. An installed UAT copy alone does not choose UAT.

Anonymous OAuth opens a companion browser draft without a Dashboard visit, toggle or copied token. Reuse the same workspace, document and browser. Renew an expired 120-second launch ticket automatically with the same key and tab, at most twice per opening attempt. Browser sign-in retains the guest MCP grant and companion layout. Save-triggered sign-in resumes the explicit save once; ordinary sign-in does not save. Website AI/saving unlock independently of guest MCP authorization.

Prefer supported live reload/reconnect after setup and continue the task. Codex opens beside the chat through exposed `open_in_codex` with `placement: "right"`. Claude desktop uses `preview_start` only when actually exposed with existing-URL support; other hosts use their actual opener. Do not invent browser/reload capabilities or universally require a new chat.

## Release gates

1. Preserve canonical uncommitted work. For runtime changes, build/test canonical Canvas and synchronize official generated outputs into Cloud; verify synchronization with its supported check mode.
2. Anonymous identity and refresh retention must both be ten years in the matching server release. Verify configured/deployed policy and expiry boundaries; do not keep the earlier one-day identity / thirty-day refresh mismatch. Long-duration fresh-host reconnection is a separate acceptance item.
3. Preserve existing OAuth storage, signing/encryption keys, PostgreSQL/Redis routing, grants and revocation. Website login must not upgrade guest grants or transfer account credentials to the agent.
4. Run focused Skill setup and packaging tests. Validate Claude plugin and root marketplace with `--strict`; validate the Skill metadata. Check the effective root portable `mcp.json` uses standard Streamable HTTP and its production URL, contains no command/args/unsupported server extensions, and is the same in the GitHub directory and main archive. Rebuild `penecho-canvas.zip`, `penecho-cloud-plugin.zip`, its byte-equivalent `penecho-cloud.plugin`, and separate `penecho-hermes-plugin.zip` from canonical source using `python3 scripts/package-penecho-cloud.py`.
5. On fresh Codex and Claude hosts, install the complete plugin and the standalone Skill separately; verify configuration, OAuth, live tool discovery, one-tab opening and supported reload. Also verify pasted-Skill and non-CLI connector setup using that host’s actual UI.
6. Test anonymous and account OAuth, handwritten feedback, ordinary login, explicit Save, two documents/windows, refresh/reconnect, expired launch renewal and revocation against each selected environment. Local tests do not prove deployed or marketplace acceptance.
7. Publish only a matching verified release and stay within the current user authorization. The current request authorizes official Codex directory submission; it does not by itself authorize pushing source, deploying runtime changes, or other production operations. Complete the required review materials and portal checks before claiming a submission.

## Submission paths

| Target | Package/entrypoint | Remaining requirement |
| --- | --- | --- |
| Codex / OpenAI | Root portable `plugin.json` + native `mcp.json` with endpoint OAuth discovery; `.codex-plugin/plugin.json` overlay; repository-root `.agents/plugins/marketplace.json`; `skills/` | Inspect the portal's imported authentication from native `mcp.json` and endpoint discovery (OAuth dynamic client registration, resource `https://penecho.ai/mcp`, scope `canvas:access`); complete developer/domain checks, real demo recording, secure reviewer access and execution of the packaged 5 positive / 3 negative cases. See [SUBMISSION.md](SUBMISSION.md). |
| Claude Code | Repository-root `.claude-plugin/marketplace.json` named `penecho`; entry `penecho-cloud` points to `./integrations/penecho-cloud` | Validate marketplace and plugin locally; include the entry in the published revision before remote install. Local validation is not publication. |
| Cursor | `.cursor-plugin/plugin.json`, shared `.mcp.json`, `skills/`; repository-root `.cursor-plugin/marketplace.json` | Publish accessible source and complete publisher review. |
| Hermes MCP catalog | `hermes/optional-mcps/penecho/manifest.yaml` | Native HTTP/OAuth; catalog entry does not install the standalone Skill. |
| Hermes portable plugin | Generated `hermes/portable/` (`plugin.json`, compatibility `mcp.json`, identical `skills/`); `penecho-hermes-plugin.zip`; `hermes/catalog-entry.json` | Uses pinned `mcp-remote@0.1.38` with Node.js 20+/npx because the reviewed portable loader lacks native OAuth configuration. Keep this compatibility path scoped to Hermes. |
| MCP Registry | `server.json`, namespace `io.github.penecho/cloud` | Verify namespace and use official publishing tools; Registry inclusion is separate from other marketplaces. |

For a future authorized committed release, run `node scripts/prepare-penecho-marketplaces.cjs --sha=<40-character-release-commit>`. It verifies the committed package version and clean package contents, derives the portable subdirectory from the Hermes entry, and emits pinned Hermes material under `dist/penecho-marketplaces/1.1.4/`; it does not publish. Never invent a SHA or approval. Select either Hermes catalog MCP or portable MCP configuration to avoid duplicates; bridge credentials stay in the host credential store, outside this package.

The root portable manifest currently has no `extensions.com.openai`, so the official importer reads listing/review/publication from `.codex-plugin/plugin.json`. A root `com.openai` object would replace the overlay settings rather than merge them. The Codex overlay contains the bounded subtitle, required listing URLs/assets, release notes, and 5 positive / 3 negative planned cases. The required accessible demo recording and secure reviewer setup remain outside this local package; no placeholder recording or credentials are bundled.

## Acceptance evidence

Codex CLI `0.162.0-alpha.2` actual plugin loading rejected server-level `extensions` and dropped that MCP entry. The standard Streamable HTTP transport/URL form loaded `penecho-cloud` successfully. Keep unsupported auth-extension fields out of the delivered native manifest; use endpoint OAuth discovery and verify the portal's actual imported authentication configuration. Do not claim it is configured before inspection. This loader check does not establish authenticated tools or a complete fresh-host Canvas workflow.

Record source, generated outputs, test results, host/version, artifact checksums, committed/pushed revision and each deployed environment separately. Earlier local Plugin Creator/Hermes checks and regression counts are historical evidence, not fresh 1.1.4 or production acceptance. Server/workspace tests live in Cloud `test/mcp-workspaces.test.mjs` and `tools/mcp-workspace-smoke.mjs`; run the appropriate matching-release checks when runtime work is authorized.

Positive checks: anonymous initial diagram; account authorization; repeated request reuses draft; two conversations stay isolated; same-tab ordinary login and explicit Save; reload restores document/artifacts; explicit existing/local/UAT target remains selected; expired ticket automatically renews in the same tab; supported live reload continues the task.

Negative checks: ticket cannot cross workspace/user/profile or be reused; cross-site POST/unauthorized WebSocket fail; revocation blocks new calls; bounded guest admission preserves existing work; document selection cannot redirect old handles; guest MCP cannot read other account documents after browser login; account A cannot bind in account B’s browser; stale installed UAT copy cannot hijack production.

References: [OpenAI Skill building](https://learn.chatgpt.com/docs/build-skills), [OpenAI app-server](https://learn.chatgpt.com/docs/app-server), [Claude MCP](https://code.claude.com/docs/en/mcp), [Hermes plugins](https://hermes-agent.nousresearch.com/docs/developer-guide/plugins), [MCP Registry](https://modelcontextprotocol.io/registry/quickstart).
