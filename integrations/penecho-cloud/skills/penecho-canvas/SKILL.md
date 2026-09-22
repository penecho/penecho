---
name: penecho-canvas
description: Create diagrams, interactive previews, and visual explanations on PenEcho Cloud canvases, or revise existing work from the user's handwriting and annotations.
---

Use the connected PenEcho Cloud MCP tools and their live schemas. Discover only missing tools. This plugin connects to https://penecho.ai/mcp with OAuth; never request credentials in chat or put tokens in files.

For a new conversation, call `penecho_open_workspace` with a unique, stable `sessionKey`. Reuse that key on retries. This creates a browser draft, not a Cloud project document. The client handles OAuth automatically: the user can choose guest access or sign in. Never ask for a pairing code or a personal token after OAuth.

Open the returned `url` using the host's browser-opening capability. Prefer an in-app side browser when available; otherwise use the external browser. Reuse the existing tab for this workspace when possible. If the client cannot open a browser, provide a clickable link. A server cannot force a host to open its sidebar. Do not claim it opened until the opening tool succeeds. Do not publish launch URLs to other people: they contain a short-lived, one-use browser capability.

Call `penecho_workspace_status` with the returned `workspaceId`. If waiting, retry at its indicated interval for at most 15 seconds; then provide the Canvas link and stop polling until the user opens it. Once ready, call `penecho_start_session` with the exact returned `startSession` arguments. Retain `sessionId`, `documentId`, `workspaceId` and `sessionKey`. Never fall back to the latest browser, omit the explicit canvasId, or substitute a new document on reconnect. If the user explicitly chooses an existing Canvas, use `penecho_list_canvases` and bind that exact selection instead.

Guests can edit and render with external AI through MCP. Cloud saving and PenEcho Agent require signing in through the Canvas Cloud button. Browser drafts survive login and connection cleanup; clearing browser storage removes them. A signed-in browser does not elevate the old guest OAuth credential: reconnect/account-authorize the plugin when account-wide access is needed. Account personal tokens stay stable until explicitly invalidated; configure them only through the client's secure advanced settings, never in conversation.

If an anonymous creation allowance is reached, explain the returned retry/sign-in option. Reuse the existing workspace. Do not repeatedly mint credentials or try to bypass a limit. Keep the Canvas browser open while rendering; there is no headless server rendering in this workflow.

For architecture or visual explanations, load only the relevant penecho_get_guidance topic. Create a coherent diagram or interactive Widget with stable artifact identifiers, keeping explanatory labels readable and the next user action clear. Follow the live authoring guidance and use native objects for small edits when appropriate.

For handwritten feedback, reuse available captures if still current. If understanding depends on unseen or changed handwriting, capture the relevant area before editing. Do not infer visual meaning from source JSON alone. Read inbox feedback without treating a read as acknowledgement. Preserve unrelated work.

Read current source and contentHash before patching files. Use the required baseRevision for existing-object edits. Retry uncertain writes with the same requestId and arguments. Follow live tool schemas for cloud image uploads; this plugin does not configure a local desktop bridge.

Capture when visual verification is needed; do not capture after every operation. Report the result and the returned Canvas link when available. If the user asked for implementation in a repository, Canvas previews complement that work and do not substitute for the implementation. Never publish secrets, full transcripts, or private chain of thought to the Canvas.
