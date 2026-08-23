# Canvas Agent Visual Explorer

Canvas Agent Visual Explorer creates one responsive, source-authored General HTML Widget for understanding-, organizing-, or planning-first work. It is an isolated Canvas Agent extension: Main Canvas AI, Canvas Pen AI Refine, the shared General HTML contract, personal plugins, and existing General HTML behavior are unchanged.

## Output contract

The canonical artifact is one complete, readable HTML document built from semantic HTML, inline CSS, and inline SVG. JavaScript is used only when it adds useful behavior. CSS Grid or Flexbox owns the overall composition; local SVG owns relationships such as arrows, brackets, routes, networks, and compact drawings. The first render must already be complete and useful without interaction, and `widget.html` is the sole reusable source.

Visual Explorer plans information before styling and uses a `Macro → Meso → Micro` reading hierarchy: a 3–5 second global model, roughly 30-second anchored drill-downs, and up to three minutes of high-value numbers, rules, constraints, exceptions, and evidence. It compresses repetition into shared annotations, legends, axes, or tables and prioritizes relationships and structure over completeness.

The topic selects the dominant grammar instead of inheriting one fixed layout. Supported choices include pipeline, layered system, causal or relationship map, hub-and-spoke, timeline or schedule lanes, comparison or matrix, hierarchy, feedback loop, route or spatial map, visual notes, and meaningful combinations. A pipeline is used only for real sequence or transformation. Importance determines area, related details stay close, metrics stay beside what they explain, and connectors represent real relationships.

References provide composition evidence only. Their reading order, density, proportions, typography, grouping, whitespace, color roles, and connector language may guide the design, but labels, values, and claims must come from the user's factual material.

The protected prompt includes one complete dense pipeline HTML example only as an implementation anchor for responsive Grid, local SVG, typography, and semantic color. It explicitly forbids copying that DOM or layout when another grammar fits, and includes non-pipeline company-landscape and technology-history counterexamples.

Every newly authored Visual Explorer uses exactly these markers:

```json
{
  "pluginId": "general",
  "widgetType": "html_widget",
  "sourceFormat": "penecho-visual-explorer+html",
  "frameworkVersion": "penecho-visual-explorer/1",
  "refreshSeconds": 0
}
```

`copyText` and `copyLabel` are omitted, and `widget.source` remains empty.

## Canvas Agent workflow

1. Inspect the Canvas. On a nonempty Canvas, capture the complete Canvas with `target:"canvas"`, `quality:"basic"`, and `coordinates:"none"` before requesting placement.
2. Call `canvas_inspect` with `plannedWidget.sourceFormat:"penecho-visual-explorer+html"`, the intended dimensions, and source typography. Treat its width, height, and absolute `createPlacement` as authoritative.
3. Call `canvas_create` once with exactly one `general/html_widget`, the complete HTML, both exact markers, and the exact proposed dimensions and placement.
4. Capture the complete Canvas with `target:"canvas"`, `quality:"basic"`, and `coordinates:"none"` to verify scale, placement, and overlap.
5. Capture the created Widget with `target:"object"`, `quality:"detail"`, and `coordinates:"none"` to review hierarchy, typography, clipping, connectors, density, and visual-grammar fidelity.
6. If one concrete defect remains, read `widget.json` and only the needed lines of `widget.html`, then make one bounded, minimal `canvas_patch_widget` unified diff that changes only `widget.html`.
7. After a patch, take one final clean object-detail capture and stop. If no patch is needed, stop after the first detail capture.

The server enforces one newly created Visual Explorer, at most one successful automatic `widget.html` patch, and at most two successful clean detail captures per actual user message. A failed or rejected operation does not justify additional polishing.

## Legacy compatibility

The legacy `VisualExplainerPlan` and AntV authoring tools are hidden from new Canvas Agent authoring. Their implementation remains in the codebase, and saved Canvas content keeps its existing read, render, patch, and compatibility paths. No legacy format or component is deleted by this integration.
