# Changelog

## 1.3.5

- **UI:** minor interface fixes.
- **Concurrent canvas editing:** support Canvas AI, Agent, and MCP modifying the same canvas simultaneously.
- **Community imports:** imported canvases receive an independent document identity and workspace, preserving newer edits in the original canvas.
- **Save and restore reliability:** keep small images saveable and fractional images at canvas boundaries reopenable; discard superseded text restores and prevent canceled snapshot loads from retaking a new canvas.
- **Canvas names:** preserve the existing name when saving a copy to Device, Server, or Cloud unless a new name is entered.

## 1.3.3

### Professional diagrams on the Canvas

- **Architecture diagrams:** draw services, dependencies, and nested system boundaries. Automatic layout and connection routing keep complex structures readable.
- **Sequence diagrams:** describe participants and ordered messages, including replies, self-calls, activations, and conditional, loop, or parallel fragments.
- **Workflows:** map steps, decisions, labeled branches, loops, and parallel paths with fork/join points.

Create these diagrams with PenEcho Agent or an MCP-connected agent. Inspect details on the Canvas, refine the result through feedback or source edits, and export SVG or PNG. Layout and rendering run locally in the browser.

The README includes two examples of each diagram type, with aligned WebP previews linked to full-resolution WebP images.

Implementation notes: [architecture](docs/architecture-local-renderer.md), [sequences](docs/sequence-local-renderer.md), and [workflows](docs/workflow-local-renderer.md).

### Other improvements and fixes

- **Canvas Library:** browse large libraries with pagination, search, project filters, and sorting; load previews as cards become visible.
- **AI connections:** choose from additional API provider presets, fetch available models, and keep custom endpoints and model IDs editable.
- **Desktop updates:** keep the update window and its menu entry in sync with the Canvas language.
- **Existing diagrams:** restore rendering for saved Mermaid diagrams while retaining their source.
- **Documentation:** refresh multilingual README galleries with aligned WebP examples and document the diagram implementation and attribution.

## 1.3.2

| Update | What it adds |
| --- | --- |
| **MCP workspace** | Canvas discovery, captures, object editing, interactive Widgets, virtual source files, and user feedback for external agents. Supports opted-in local, LAN, and linked-device Cloud browsers. |
| **Cloud MCP** | Connect external AI agents directly to your enabled PenEcho Cloud canvases to read content, create and edit results, and follow handwritten feedback. Cloud MCP and Local MCP are optional connection paths. |
| **PenEcho Cloud Credits API** | Use PenEcho-hosted models with account credits, alongside your own API and CLI connections. View available models, rates, and balance in Settings. |
| **Connection management** | Save multiple AI connections and choose the active connection for each client. |
| **Canvas and workbench** | More responsive drawing and navigation, refined Studio controls, an adaptive Agent panel, and customizable keyboard shortcuts. |
