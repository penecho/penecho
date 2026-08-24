# Canvas Agent Visual Explorer

Canvas Agent Visual Explorer creates one responsive, source-authored General HTML Widget for understanding-, organizing-, or planning-first work. It is an isolated Canvas Agent extension: Main Canvas AI, Canvas Pen AI Refine, the shared General HTML contract, personal plugins, and existing General HTML behavior are unchanged.

It is the Canvas Agent default for substantial pasted text and requests to explain, learn, analyze, or organize equations, projects, documents, and other material, even when the user does not explicitly ask for an infographic. It yields to direct edits or supplements to existing Canvas/page elements and to requests whose defining result is interaction, simulation, live data, a small ordinary HTML tool, or another enabled artifact.

## Output contract

The canonical artifact is one complete, readable HTML document built from semantic HTML, inline CSS, inline SVG, and only the JavaScript that materially improves the result. The first render must already be complete and useful without interaction, and `widget.html` is the sole reusable source.

Visual Explorer plans information before styling and uses a `Macro → Meso → Micro` reading hierarchy: a 3–5 second global model, roughly 30-second anchored drill-downs, and up to three minutes of high-value numbers, rules, constraints, exceptions, and evidence. It compresses repetition into shared annotations, legends, axes, or tables and prioritizes relationships and structure over completeness.

Concise document mode is selected directly, without a confirmation question, when the user asks for something simple, concise, clear, direct, intuitive, visual-first, at-a-glance, lower-text, or easier to understand; asks to simplify or visually clarify an existing result; requests a one-page, one-slide, presentation-ready, executive-summary, or quick-overview visual; targets Word, PowerPoint/PPT, slides, decks, reports, documents, handouts, export, download, print, or embedding; or supplies a straightforward concept that does not need dense analysis. Words such as explain, analyze, summarize, learn, document, or infographic do not trigger it by themselves when the request actually calls for comprehensive technical depth.

The mode preserves the 3–5 second overview but favors diagrams, arrows, comparisons, small tables, and short labels; each module is normally a title plus one very short introduction or 1–3 labels. It omits nonessential prose and micro-detail so exported text remains readable and unclipped. When compact format and technical depth conflict, required facts, relationships, numbers, and conclusions remain, but are compressed into visual structure instead of paragraphs.

The topic selects the dominant grammar instead of inheriting one fixed layout. Supported choices include pipeline, layered system, causal or relationship map, hub-and-spoke, timeline or schedule lanes, comparison or matrix, hierarchy, feedback loop, route or spatial map, visual notes, and meaningful combinations. A pipeline is used only for real sequence or transformation. Importance determines area, related details stay close, metrics stay beside what they explain, and connectors represent real relationships.

References provide composition evidence only. Their reading order, density, proportions, typography, grouping, whitespace, color roles, and connector language may guide the design, but labels, values, and claims must come from the user's factual material. There is no mandatory orientation or panel arrangement: the information hierarchy chooses the layout, and connectors represent only real relationships.

Typography is planned against the focused Canvas display rather than raw Widget coordinates. The model supplies its actual body, caption, and title source sizes to `canvas_inspect`; when its prediction is too small, the model simplifies content, increases typography, changes the aspect ratio, or uses more Canvas space before creating the Widget.

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

1. Use the host-supplied authoritative initial Canvas state. On a nonempty Canvas, capture the complete Canvas with `target:"canvas"`, `quality:"basic"`, and `coordinates:"none"` before requesting placement if that overview was not already supplied.
2. If the host-supplied initial state explicitly declares an empty Canvas at the current revision, skip the unchanged inspect/capture and create directly with finite dimensions and `placement.mode:"auto"`. Otherwise call `canvas_inspect` with `plannedWidget.sourceFormat:"penecho-visual-explorer+html"`, the intended dimensions, and source typography. Treat its width, height, and absolute `createPlacement` as authoritative.
3. Call `canvas_create` once with exactly one `general/html_widget`, the complete HTML, both exact markers, and either the empty-Canvas auto placement or the exact nonempty-Canvas proposal.
4. Capture the complete Canvas with `target:"canvas"`, `quality:"basic"`, and `coordinates:"none"` to verify scale, placement, and overlap.
5. Capture the created Widget with `target:"object"`, `quality:"detail"`, and `coordinates:"none"` to review hierarchy, typography, clipping, connectors, density, and visual-grammar fidelity.
6. If one concrete defect remains, read `widget.json` and only the needed lines of `widget.html`, then make one bounded, minimal `canvas_patch_widget` unified diff that changes only `widget.html`.
7. After a patch, take one final clean object-detail capture and stop. If no patch is needed, stop after the first detail capture.

The server enforces one newly created Visual Explorer, at most one successful automatic `widget.html` patch, and at most two successful clean detail captures per actual user message. A failed or rejected operation does not justify additional polishing.

## Legacy compatibility

The legacy `VisualExplainerPlan` and AntV authoring tools are hidden from new Canvas Agent authoring. Their implementation remains in the codebase, and saved Canvas content keeps its existing read, render, patch, and compatibility paths. No legacy format or component is deleted by this integration.

## Scientific Visual Explorer

Scientific Visual Explorer extends the same General HTML artifact without changing its source or framework markers. The authoring route is selected by the learning goal:

| Goal | Route | Rendering responsibility |
| --- | --- | --- |
| Function concepts, derivatives, extrema, or geometric proof states | Visual Explorer with `math-2d` | Calibrated static-first SVG evidence plus Manim-Web explanatory rendering/motion by default when it is at least as clear |
| Forces, motion, fields, or conservation explanations | Visual Explorer with `physics-2d` | Static-first boundary, vectors, trajectory, and state evidence plus Manim-Web explanatory rendering/motion by default when it is at least as clear |
| 3-D surfaces, cameras, coordinate transforms, or morphs | Visual Explorer with `math-3d` | Static-first canonical 3-D evidence plus Manim-Web rendering/camera motion by default; bounded orbit/zoom interaction with visible instructions and Reset view when inspection helps |
| Open-ended experiments whose controls continuously change data, simulation state, or the view | Custom HTML | Application-owned controls and simulation lifecycle |
| One standalone precision chart | Professional Diagrams | Chart grammar and data encoding |

Every scientific artifact is explanation-first. Its initial static HTML/SVG is complete, deterministic, readable, and retained as fallback before JavaScript runs. Manim-Web is the default explanatory rendering/motion language whenever it can present the request at least as clearly as a static alternative; fall back only when it cannot faithfully, legibly, accessibly, or efficiently improve the presentation. It is not a computer algebra system, numerical solver, or substitute for visible assumptions and deterministic derivations.

### Two-stage lazy loading

Scientific instructions and code are absent from the initial Canvas Agent prompt. The always-visible `load_visual_skill` router selects one bounded local contract: `math-2d`, `physics-2d`, or `math-3d`. Loading appends the full contract to a durable, prefix-stable session system-prompt section; the ordinary tool result contains only its id, hash, and load state. Repeating the call reports `alreadyLoaded` without duplicating the contract.

Authored scientific HTML declares exactly one matching marker:

```html
<meta name="penecho-visual-skill" content="math-2d">
```

The server rejects an unknown, duplicated, or not-yet-loaded marker. It also rejects unmarked or unpinned Manim-Web module imports. This is an authoring gate at `canvas_create`; it is not a general HTML security boundary or a provenance mechanism for later source patches.

The browser runtime is lazy independently of the model instructions. Only an exact Visual Explorer source/framework pair with one supported skill marker receives the scientific CSP, import rewrite, readiness bridge, and snapshot hooks. A pinned authored import of `https://cdn.jsdelivr.net/npm/manim-web@0.3.24/dist/manim-web.browser.js` is rewritten in memory to the local packaged mirror; persisted HTML remains portable and canonical. Ordinary General HTML Widgets keep their prior initialization, CSP, readiness, and snapshot behavior.

The supported packaged surface is deliberately bounded to the verified scene, axes, curve, vector-field, 3-D surface, camera, geometry, and animation APIs named by the loaded skill. MathJax-backed `Tex`/`MathTex`, GIF/video export, audio, and other runtime-fetched assets are outside this release; equations and exact evidence stay in static HTML/SVG.

### Readiness, motion, and snapshots

Scientific HTML calls `window.penechoWidgetReady()` after its static fallback and selected enhancement have settled. The host then waits for the DOM renderer and two presented animation frames before reporting the document ready. There is no success timeout that can hide a failed render.

An artifact provides replay and pause controls when it animates, respects `prefers-reduced-motion`, and defines a stable final state. An inspectable 3-D artifact also exposes bounded pointer/touch/keyboard orbit controls, visible usage instructions, constrained zoom, and a Reset view action; reduced motion disables automatic transitions without removing useful manual exploration. Optional bounded `beforeSnapshot` and `afterSnapshot` hooks reset WebGL content to its canonical capture state and then restore the user's prior bounded view without changing the ordinary Widget snapshot path. If Manim-Web cannot load or initialize, the complete static SVG explanation remains visible.

### Cloud rollout boundary

The 071 repository is the source of truth for this implementation. A Cloud release must explicitly sync both packaged Manim-Web files, expose their two allowlisted routes, and carry the matching Widget host/runtime changes. Treat Cloud as not supporting this feature until that atomic rollout is complete; never deploy a partial mirror containing only the host, skill contracts, routes, or browser assets.
