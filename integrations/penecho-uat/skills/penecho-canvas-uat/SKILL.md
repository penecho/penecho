---
name: penecho-canvas-uat
description: Draw on a UAT canvas beside the chat, including "draw this on canvas" or "画在画布上", when the user explicitly selects PenEcho UAT testing. Set up diagrams, interactive demonstrations, and handwritten feedback with a missing native UAT MCP connection. Preserve explicit local/production targets and already-bound documents. An installed UAT skill alone does not override production.
---

# PenEcho Canvas UAT

Use only the MCP connection named `penecho-uat`, targeting `https://internaltest.penecho.ai/mcp`. Verify its configured endpoint before using similarly named tools. Never substitute the production PenEcho connector or overwrite its configuration. All instructions below concern UAT.

## How users invoke this skill

Explicit invocation: `$penecho-canvas-uat` followed by the desired canvas task. An explicit request to install/use this skill for UAT testing selects UAT for that testing workflow, including follow-up demonstrations without repeated environment names. Honor that current selection with the generic `penecho-mcp` skill as well. An old installed UAT copy alone must not override ordinary new production requests. Resolve explicit destinations and already-bound workspaces first; absent a current testing selection, use production for new untargeted demonstrations. Follow-up phrases such as "draw this on the canvas", "update the current canvas", and "follow my annotations" reuse the conversation's existing workspace. An explicit local app, production, saved Canvas, or already-bound document keeps its actual target; do not move that work to UAT.

### First-use example

User: "Use $penecho-canvas-uat to draw a request flow from the browser through the API to storage, beside this chat."

Expected behavior: automatically configure a missing UAT connection for the current host, complete normal OAuth if needed, open or reuse one companion tab, read workspace status, and attach to its exact document. Create a readable diagram with those three labeled stages and arrows. Inspect the rendered result when needed, leave it visible, and briefly tell the user they can annotate it or ask for changes. Do not require the user to know tool names, document IDs, or connection parameters.

### Follow-up examples in the same UAT conversation

| User request | Expected behavior |
| --- | --- |
| "Put this implementation plan on the canvas as an interactive checklist." | Resolve the current target, use the supplied plan, create one interactive Widget, and test a checkbox. Do not invent project progress. |
| "Create a new canvas for an alternative; keep the current version." | Create a second document using the advertised capability or the visible New Canvas control, explicitly select it, and bind its own session. Preserve the first document and its session. |
| "Change the API box on the current canvas to a queue." | Re-read the selected target, inspect the relevant source, and update the existing artifact rather than duplicating the diagram. |
| "Follow the arrows I drew and rearrange these steps." | Inspect the relevant current annotations if their meaning is not already known, then update that document while preserving unrelated content. |

These are invocation and routing examples, not mandatory templates or extra tasks. Match the user's requested content and scope, and reply in their language.

## Automatic installation and connection

When the user gives you this package and requests installation or canvas use, complete the required setup. That request includes adding the missing UAT connection for the current host. Do not stop at a command suggestion or ask an extra conversational question such as "Do you want me to add MCP?". Reading the package for review alone does not authorize installation.

Install the complete directory, including `scripts/`, in the current host's supported skills location: `~/.claude/skills/penecho-canvas-uat/` for Claude Code, or `~/.agents/skills/penecho-canvas-uat/` for Codex. Reuse an existing supported installation path when updating a copy. Configure only the host handling this request; do not also configure another installed agent.

If the user pasted only `SKILL.md`, install that file and use the equivalent native commands below. Do not require them to fetch missing helper files just to configure the connection.

When installing alongside an older generic `penecho-mcp` skill, preserve its instructions and apply the same routing precedence: explicit targets and already-bound workspaces first, then the user’s current UAT testing selection, then production for ordinary new untargeted demonstrations. Do not rewrite unrelated installed skills merely because this package exists. This avoids the older broad "canvas" trigger silently starting a local `client.js --host-id` connection. Do not remove or reconfigure the local MCP connection. For this UAT workflow, a local app or local port is not a dependency; report UAT connection failures without substituting the local server.

Run the bundled helper with the actual skill directory as the working directory:

```bash
# Codex
node scripts/setup-mcp.mjs --host codex
# Claude Code
node scripts/setup-mcp.mjs --host claude
```

Run only the matching command. The helper checks the existing named connection, reuses a matching UAT endpoint, and adds a missing connection through native Streamable HTTP support. Claude uses user scope; Codex uses its native global MCP configuration. It preserves unrelated connections and credentials, including production `penecho`/`penecho-cloud`. A conflicting or disabled `penecho-uat` is reported without overwriting it. `--check` inspects without adding. Node's standard library is sufficient; no bridge package is downloaded.

The equivalent native add commands, if the helper cannot run, are `codex mcp add penecho-uat --url https://internaltest.penecho.ai/mcp` and `claude mcp add --transport http --scope user penecho-uat https://internaltest.penecho.ai/mcp`. Inspect the named connection first, add only if missing, and verify the endpoint afterward. [references/mcp.json](references/mcp.json) is a native HTTP configuration example for hosts that support this format; it is not Codex's TOML configuration. If the current host has no local CLI, use its actual plugin/connector UI or exposed setup capability with that UAT endpoint and normal OAuth; otherwise supply the endpoint and precise supported manual step. Do not assume a common Settings path across hosts.

Host-enforced configuration permissions and OAuth consent still apply. Use the host's required approval mechanism when necessary; do not weaken its permission settings. If a native operation is unavailable or rejected, report that specific blocker. A configuration entry alone is not proof of a working MCP connection.

Native `mcp get` inspects configuration and may also report connection health. `status: "existing"` from the helper confirms only a matching entry. If the host reports "Needs authentication", continue normal OAuth. If a shell health check fails with DNS/network errors inside a restricted sandbox, use the host's authorized network permission mechanism and check again before concluding the UAT service is unavailable. A successful shell check does not replace live MCP tool discovery in the conversation.

Codex's add command may start OAuth immediately; keep it running until the normal browser authorization completes. Reuse the consent page already opened by the host or CLI. A printed authorization URL does not mean automatic opening failed: do not open that same URL through a second tool. Only when automatic opening is unavailable, use one browser-opening capability once and retain its tab. After OAuth succeeds, continue with live tools and never reopen the old authorization URL. If setup returns `authorization: "pending"`, the connection has already been saved: resume normal login rather than re-adding it. When authentication is required, use the host's supported flow (`codex mcp login penecho-uat` or, when supported by the installed version, `claude mcp login penecho-uat`). Select anonymous use for the guest workflow; do not request account registration or a Dashboard token. Reuse valid existing UAT authorization instead of logging it out. Let the host store and refresh OAuth credentials. Never mint credentials through a database or copy website cookies, account tokens, or another agent's credentials into local MCP settings.

Continue to opening and editing the canvas as soon as the tools are available. If reconnect/reload is needed, prefer supported live reload and continue this task. Use Codex `config/mcpServer/reload` only if its actual app-server integration exposes it; use Claude’s actual supported plugin/MCP reload capability. If unavailable, state only the required manual step. Do not create a new chat or claim a canvas was opened when the host cannot do it.

UAT may show a separate environment access page at `/__uat/access`. Use the existing UAT credentials through that page if available through the user's authorized secure setup; otherwise explain the missing access requirement. This gate is separate from a PenEcho account. Do not embed gate credentials in URLs, this package, or screenshots.

## Open one workspace beside the chat

1. Use one unique, stable `sessionKey` for this conversation. Call `penecho_open_workspace`, then retain its `workspaceId`, `url`, `canvasUrl`, and the browser tool/tab identity.
2. If `alreadyConnected` is true, reuse the existing tab. If `launchState` is `opening`, `nextAction` is `wait`, or `url` is null, poll this same workspace according to `retryAfterMs`: a redeemed launch may still be initializing its browser draft. Otherwise open the returned single-use launch URL once through one capability. Prefer the host's embedded side browser. In Codex, when exposed, use `open_in_codex` with `{target:{type:"browser",url},placement:"right"}`. A `queued` response means that opening was accepted: inspect and reuse that pending tab instead of invoking an independent second opener. Use a fallback opener only after the first capability explicitly reports failure or is unavailable. On Claude desktop, use `preview_start` only when the actual toolset exposes it with a schema supporting an existing URL. Otherwise use the host’s actual native opener; never invent a Claude sidebar API. If no embedded browser exists, open the default browser or provide the launch link.
3. Preserve `mode=companion`. This parameter enables the narrow rail and Compact/Full Canvas switch; ordinary website URLs keep the normal interface. Never send a launch URL containing a ticket to search tools or external fetch services.
4. Call `penecho_workspace_status`. When ready, call `penecho_start_session` with its exact `startSession` arguments, plus any required `client`/`title` from the live schema. Wait for that call to succeed and retain its `sessionId` and `documentId` before drawing, presenting, uploading, or editing. Loading status alone never authorizes a mutation or supplies a usable session.
5. Respect `retryAfterMs` while the initial `launchState` is `opening`, for up to its 30-second initialization window, then use at most five further bounded status checks. Do not reopen a page merely because status is loading. Follow `nextAction`. Launch tickets expire after 120 seconds. For `launch_expired`, automatically call `penecho_open_workspace` with the same conversation key and navigate the retained tab, using the same browser tool, to its renewed URL without another user question. Limit launch renewals to two within this opening attempt, then report a concrete blocker. `open_original_draft` means the retained document is missing from this browser's storage; use its original browser profile for recovery. Opening the same workspace in another page is supported: the latest connected page takes over, and the older page disconnects. Continue in the latest page with the exact ready binding; do not require a return to the older tab. Do not pick an unrelated canvas or create a replacement workspace to conceal a connection failure.

No Dashboard visit, MCP toggle, pairing code, or account registration is required for anonymous MCP editing.

## Multiple canvases

The companion rail can create and switch documents within the same tab. Before editing the user's current Canvas, re-read `penecho_workspace_status` and use its exact selected `startSession` target. Keep a separate stable session handle for each document. Selection never redirects an existing session; an explicit request about an older document uses that document's handle.

To select a different existing document when the user requests it, read status for its document ID and selection revision, then call `penecho_select_workspace_canvas` with `expectedRevision` and a unique `requestId`. On a conflict, read fresh status; do not force a stale selection. Reuse an identical request ID only for an identical retry. Keep the selected document visible when delivering work.

## Edit, inspect, and save

Use the live schemas and load only the needed `penecho_get_guidance` topic. Use `penecho_present_widget` for interactive HTML, `penecho_draw` for native marks, and `penecho_plot` for functions when these tools are advertised. Preserve artifact IDs. Read source and `contentHash` before patching; use the required revision for geometry edits. Retry uncertain mutations with identical arguments rather than creating duplicate artifacts.

Inspect rendered output when visual evidence is needed, and test at least one meaningful interaction for interactive deliverables. For handwritten feedback, inspect the relevant drawing if its meaning is not already known. Preserve unrelated content; do not publish secrets or private reasoning to the canvas.

Anonymous users can edit through external MCP and draw manually. PenEcho's own AI requires sign-in, and guest Suggest is hidden. Save prompts sign-in/registration in the same browser, preserves the draft and companion URL, and resumes the user's explicit save once. Ordinary sign-in must not save automatically. Signing in must not expand the narrow rail. The external MCP connection remains anonymous after website sign-in: keep its existing workspace and sessions, without copying account credentials into the agent, migrating authorization, or asking for another MCP setup. Website sign-in unlocks website AI and account saving independently. Normal website/Dashboard MCP flows retain their existing interface and authorization. Do not register an account or save to Cloud just to demonstrate a preview.

## Expiry and reconnect testing

Access tokens currently expire after one hour. Use the host's normal OAuth refresh support, retaining rotated refresh tokens through its credential store. Serialize refreshes where the host exposes that control. Never replay a consumed refresh token blindly: the server currently revokes the grant on refresh-token reuse. If a refresh result is lost, use the host's supported recovery flow and report the outcome.

The matching server release must align anonymous identity and refresh retention at ten years. This Skill does not alter or prove deployed retention: verify the selected UAT release before reporting that requirement satisfied. Initial connection does not prove long-duration Codex/Claude reconnection. Keep credential expiry, revoked grants, session-handle expiry, and browser-local draft loss distinct.

For a fresh-agent smoke test: complete anonymous OAuth, open a companion canvas, create one useful interactive artifact, use the rail to create a second document, edit it through its own session, then switch back and verify the first is intact. Confirm both survive a reload. Check ordinary URLs hide companion controls. Report actual results and unresolved reconnect/login checks without silently moving to production or another workspace.
