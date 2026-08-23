# Visual Explainer

Visual Explainer creates one responsive Canvas Widget when a user will understand, organize, or plan something better through a coordinated visual composition. It is domain-neutral: model architecture, study notes, handwritten-note restructuring, travel plans, schedules, comparisons, and similar requests use the same pipeline.

## Capability routing

Canvas Agent chooses exactly one primary Widget path before authoring. It does not create candidates in several paths and compare them. An explicit feasible request for Visual Explainer, HTML, or a named professional source format takes priority; otherwise the defining requirement determines the path.

| Primary path | Use when | Do not use merely because | Examples |
| --- | --- | --- | --- |
| Visual Explainer | The outcome is understanding, organizing, or planning through one coordinated responsive visual narrative. | The content contains architecture, process, schedule, route, table, notes, or several panels. Those are supported semantics. | Transformer explanation, restructured handwritten notes, travel itinerary, readable schedule. |
| General HTML Widget | Custom behavior is the deliverable: interaction that changes the view or data, animation, simulation, live data, a browser-native tool, freeform overlay, or a visual outside the plan vocabulary. | Hover, responsive reflow, decorative motion, or hand-authored layout would be convenient. | Attention simulator, draggable live map, interactive scheduler, animated overlay. |
| Professional Diagrams | The artifact needs established notation, a precise quantitative chart with axes and scales, domain-tool compatibility, or reusable editable professional source. | The user says diagram, chart, architecture, model, structure, process, flow, or draw. | C4/PlantUML, BPMN, editable circuit or schema, GeoJSON route, Vega-Lite chart. |

For a mixed request, the dominant deliverable wins. Teaching copy around BPMN remains a Professional Diagram; a conceptual explanation that happens to contain arrows remains a Visual Explainer. A live dashboard is General HTML, while a single reusable Vega-Lite statistical chart is Professional Diagrams. PenEcho does not switch paths after creation solely for cosmetic polishing.

## Contract

The model supplies a versioned `VisualExplainerPlan`, not renderer source. A plan contains:

- `intent`: `explain`, `organize`, or `plan`;
- a title, optional subtitle, takeaways, and annotations;
- one to eight semantic sections;
- section kinds such as `flow`, `timeline`, `hierarchy`, `relationship`, `comparison`, `cards`, `metrics`, `schedule`, `table`, `map`, `notes`, or `matrix`;
- items, optional parent references, and optional links.

The plan cannot contain coordinates, CSS, SVG, AntV syntax, or template names. PenEcho validates string lengths, collection limits, unique identifiers, parent references, links, and a maximum of 64 total items at both the Canvas Agent boundary and the browser boundary.

## Rendering pipeline

1. Canvas Agent selects Visual Explainer when a rich visual composition materially improves comprehension.
2. `canvas_create_visual_explainer` validates the semantic plan.
3. PenEcho creates one General HTML Widget and stores the normalized plan as copyable JSON.
4. The local renderer resolves exact presentation forms. AntV Infographic 0.2.20 renders sequence and hierarchy panels plus directional relationship cards; deterministic native components render schedules, tables, routes, matrices, notes, metrics, and fallback cards.
5. The responsive layout packs sections into one, two, or three columns according to the current Widget width, aspect ratio, importance, and section count. Primary sections stay full-width; supporting sections fill complete rows without dead grid columns. A debounced `ResizeObserver` recomputes the layout and rerenders AntV in horizontal or vertical form when either Widget axis changes.
6. Typography uses a Canvas-readable fluid scale with stable lower bounds. `compact` and `dense` modes first reduce spacing and secondary detail instead of shrinking body text into illegibility. Native cards and matrices center their useful content rather than stretching sparse boxes across an entire panel.
7. The renderer tries `comfortable`, `compact`, then `dense` layout at most once each. It checks Widget overflow, panel bounds, panel size, clipped content, AntV warnings, and AntV errors.
8. Structured diagnostics return a status, score, issue signature, selected density, deterministic attempt count, and whether a semantic replan is justified.
9. Existing `canvas_capture` can provide a detail screenshot for the Widget when diagnostics alone are insufficient.

The AntV browser bundle is generated from the pinned npm dependency into `public/vendor`; it never depends on a CDN. If AntV cannot render a panel, the same Widget displays a native semantic fallback instead of becoming blank.

## Stop policy

The stop policy is enforced by server state per actual user message; model tool calls cannot reset it.

- One Visual Explainer may be created per user message.
- Deterministic layout performs at most three local attempts and consumes no model tokens.
- At most two detail captures are allowed for the affected Widget.
- At most one model-authored plan update is allowed.
- Repeating an identical plan is rejected.
- A passing result, a repeated issue signature, improvement below three score points, or the one-update limit ends automatic refinement.
- Generic Widget patching is rejected for Visual Explainer Widgets; semantic changes must use `canvas_update_visual_explainer`.
- A later explicit user message opens a fresh bounded budget.

Playwright is not part of runtime generation or review. Browser automation may be added later as optional CI coverage, while production review uses structured DOM/SVG diagnostics and PenEcho's existing Widget capture path.
