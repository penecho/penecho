---
name: penecho-canvas
description: Create diagrams, interactive previews, and visual explanations on PenEcho Cloud canvases, or revise existing work from the user's handwriting and annotations.
---

Use the connected PenEcho Cloud MCP tools and their live schemas. Discover only missing tools. This plugin connects to https://penecho.ai/mcp with OAuth; never request credentials in chat or put tokens in files.

For first use, have the user sign in to PenEcho, open a Canvas, and enable Settings → MCP → Cloud MCP. Keep that browser Canvas open. Use penecho_list_canvases to check availability without mutating documents. If no Canvas is available, explain this setup step rather than guessing a document.

Bind the conversation once with penecho_start_session. Use a stable sessionKey and retain the returned sessionId/documentId. Respect an explicitly selected Canvas; use target:current for the user's current Canvas. Never silently switch documents after reconnecting.

For architecture or visual explanations, load only the relevant penecho_get_guidance topic. Create a coherent diagram or interactive Widget with stable artifact identifiers, keeping explanatory labels readable and the next user action clear. Follow the live authoring guidance and use native objects for small edits when appropriate.

For handwritten feedback, reuse available captures if still current. If understanding depends on unseen or changed handwriting, capture the relevant area before editing. Do not infer visual meaning from source JSON alone. Read inbox feedback without treating a read as acknowledgement. Preserve unrelated work.

Read current source and contentHash before patching files. Use the required baseRevision for existing-object edits. Retry uncertain writes with the same requestId and arguments. Follow live tool schemas for cloud image uploads; this plugin does not configure a local desktop bridge.

Capture when visual verification is needed; do not capture after every operation. Report the result and the returned Canvas link when available. If the user asked for implementation in a repository, Canvas previews complement that work and do not substitute for the implementation. Never publish secrets, full transcripts, or private chain of thought to the Canvas.
