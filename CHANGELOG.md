# Changelog

## 1.3.3

### Professional diagrams on the Canvas

- **Architecture diagrams:** draw services, dependencies, and nested system boundaries. Automatic layout and connection routing keep complex structures readable.
- **Sequence diagrams:** describe participants and ordered messages, including replies, self-calls, activations, and conditional, loop, or parallel fragments.
- **Workflows:** map steps, decisions, labeled branches, loops, and parallel paths with fork/join points.

Create these diagrams with PenEcho Agent or an MCP-connected agent. Inspect details on the Canvas, refine the result through feedback or source edits, and export SVG or PNG. Layout and rendering run locally in the browser.

The README includes two examples of each diagram type, with aligned WebP previews linked to full-resolution WebP images.

Implementation notes: [architecture](docs/architecture-local-renderer.md), [sequences](docs/sequence-local-renderer.md), and [workflows](docs/workflow-local-renderer.md).

## 1.3.2

| Update | What it adds |
| --- | --- |
| **MCP workspace** | Canvas discovery, captures, object editing, interactive Widgets, virtual source files, and user feedback for external agents. Supports opted-in local, LAN, and linked-device Cloud browsers. |
| **Cloud MCP** | Connect external AI agents directly to your enabled PenEcho Cloud canvases to read content, create and edit results, and follow handwritten feedback. Cloud MCP and Local MCP are optional connection paths. |
| **PenEcho Cloud Credits API** | Use PenEcho-hosted models with account credits, alongside your own API and CLI connections. View available models, rates, and balance in Settings. |
| **Connection management** | Save multiple AI connections and choose the active connection for each client. |
| **Canvas and workbench** | More responsive drawing and navigation, refined Studio controls, an adaptive Agent panel, and customizable keyboard shortcuts. |
