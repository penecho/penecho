# Shared Canvas authoring and Visual Explorer

PenEcho Agent and third-party MCP agents use the same document operations, validation, source-editing protocol, and authoring guidance. The built-in host binds its current Canvas conversation automatically; external MCP clients retain their existing explicit connection and document lifecycle. Neither path is a host-filesystem view: the files are virtual Canvas sources.

## Routing and design guidance

Understanding, learning, analysis, and organization use Visual Explorer. Product pages, UI previews, ordinary HTML tools, live data, and interaction-first simulations use General HTML. Creating a new page does not automatically activate Visual Explorer. Bare function graphs use `penecho_plot`.

`penecho_get_guidance` loads `visual-explorer`, `general-html`, `math-2d`, `physics-2d`, or `math-3d` on demand. Both clients receive the same version, hash, and document. The default prompt contains only routing and execution rules; full design/scientific documents do not inflate every request. Existing MCP prompt templates remain available.

The Visual Explorer design body is sourced directly from `src/server/canvas-agent/visual-explorer-contract.md`. Its semantic grammar, Macro/Meso/Micro hierarchy, typography, information density, and visual quality requirements remain authoritative. Only delivery instructions are adapted to the shared tools. Scientific guidance retains its deterministic equations, calibrated evidence, static fallback, and verified rendering examples.

## Shared operations

- `penecho_present_widget` creates or updates responsive HTML using a stable `artifactId`. The host supplies automatic or requested relative placement. Existing updates retain geometry.
- `penecho_list_files` and `penecho_read_file` discover exact virtual paths and raw source. `penecho_patch_file` applies strict unified diffs with the returned `contentHash` and a request receipt.
- A source conflict requires a fresh read and a new `requestId`. An uncertain outcome is retried with identical arguments and the same ID. Neither client substitutes a guessed revision.
- `penecho_edit_canvas` supports guarded geometry actions and `draw_ink` at world coordinates, including annotation over handwriting. Existing MCP actions and placement semantics remain unchanged.
- Creation can combine `capture:true` with one tool call. Ordinary edits need no intermediate screenshot. Returned application receipts and pixel evidence remain distinct; a failed capture can leave successfully applied content and must not trigger duplicate creation.

Internal calls use the same bound operation module and browser document executor as MCP, with the current host session supplied automatically. They cannot open or switch documents or opt the Canvas into an external processor. Navigation invalidates stale internal execution.

Professional Diagram and private-plugin authoring/source editing are not advertised. Existing saved content remains readable and renderable. Geometry remains part of ordinary document operations. Historical low-level Canvas kernels remain for saved behavior and regression tests, but are not registered as a second model-facing creation API.

## Scientific rendering

Manim-Web is the default explanatory rendering/motion language whenever it can present the request at least as clearly as a static alternative. Use deterministic calibration and complete static HTML/SVG evidence; fallback is appropriate when animation cannot faithfully, legibly, accessibly, or efficiently improve the explanation. This is a renderer, not a symbolic solver or a substitute for checked mathematics.

HTML declares exactly one supported marker, for example:

```html
<meta name="penecho-visual-skill" content="math-2d">
```

Both shared `penecho-mcp+html` documents and the legacy Visual Explorer source/framework pair activate the same lazy scientific Widget runtime. Unknown, duplicated, or absent markers do not activate it. Ordinary HTML keeps its existing runtime.

Only exact pinned Manim-Web module imports are rewritten to the packaged mirror. The static HTML/SVG remains complete before JavaScript runs and survives enhancement failure. Scientific readiness, bounded replay/orbit controls, reduced motion, and canonical snapshot hooks use the existing Widget host; there is no second renderer for MCP.

## Validation and rollout

The common operation tests and document-executor parity tests cover both clients together: files, source conflicts, idempotency, placement, captures, retired source protection, and binding. Native/Harness tests additionally cover provider lifecycle, cancellation, budget limits, and invalid-decision correction.

Cloud consumes the reviewed server dependency graph through `tools/sync-canvas-agent-runtime.mjs` and browser artifacts through `tools/sync-public-canvas.mjs`. Sync the client and server together before live acceptance. UAT records bounded provider argument facts, admission failures, and failed turn endings; production detailed recording stays disabled. Missing/invalid arguments are not silently normalized to `{}`, and truncated tool responses never execute.

Automated contract tests do not establish live model latency or visual quality. UAT acceptance must run the same page creation, explanation, scientific rendering, source refinement, annotation, and cancellation scenarios for both clients, comparing tool failures, unnecessary calls, first useful output, and final pixels.
