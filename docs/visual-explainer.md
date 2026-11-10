# Visual Explainer

Visual Explainer creates one responsive Canvas Widget when a user will understand, organize, or plan something better through a coordinated visual composition. It is domain-neutral: model architecture, study notes, handwritten-note restructuring, travel plans, schedules, comparisons, and similar requests use the same pipeline.

## Capability routing

PenEcho Agent chooses exactly one primary Widget path before authoring. It does not create candidates in several paths and compare them. An explicit feasible request for Visual Explainer, HTML, or a named professional source format takes priority; otherwise the defining requirement determines the path.

| Primary path | Use when | Do not use merely because | Examples |
| --- | --- | --- | --- |
| Visual Explainer | The outcome is understanding, organizing, or planning through one coordinated responsive visual narrative. | The content contains architecture, process, schedule, route, table, notes, or several panels. Those are supported semantics. | Transformer explanation, restructured handwritten notes, travel itinerary, readable schedule. |
| General HTML Widget | Custom behavior is the deliverable: interaction that changes the view or data, animation, simulation, live data, a browser-native tool, freeform overlay, or a visual outside the plan vocabulary. | Hover, responsive reflow, decorative motion, or hand-authored layout would be convenient. | Attention simulator, draggable live map, interactive scheduler, animated overlay. |
| Professional Diagrams | The artifact needs established notation, a precise quantitative chart with axes and scales, domain-tool compatibility, or reusable editable professional source. | The user says diagram, chart, architecture, model, structure, process, flow, or draw. | C4/PlantUML, BPMN, editable circuit or schema, GeoJSON route, Vega-Lite chart. |

For a mixed request, the dominant deliverable wins. Teaching copy around BPMN remains a Professional Diagram; a conceptual explanation that happens to contain arrows remains a Visual Explainer. A live dashboard is General HTML, while a single reusable Vega-Lite statistical chart is Professional Diagrams. PenEcho does not switch paths after creation solely for cosmetic polishing.

## Contract

The model supplies the single current `VisualExplainerPlan` as a JSON object, not a JSON-encoded string and not renderer source. A plan contains:

- `intent`: `explain`, `organize`, or `plan`;
- a title, optional subtitle, takeaways, and annotations;
- one to eight regions placed on a responsive 12-column layout;
- semantic renderers such as `flow`, `timeline`, `hierarchy`, `relationship`, `comparison`, `cards`, `metrics`, `schedule`, `table`, `map`, `notes`, or `matrix`;
- semantic items, optional parent references, and optional local links;
- optional named ports and cross-region relations;
- optional isolated `embedded-html` artifacts when semantic renderers are insufficient;
- explicit typography and theme settings.

Semantic regions cannot contain CSS, SVG, JavaScript, AntV syntax, or template names. Custom source is permitted only inside an `embedded-html` artifact. PenEcho validates string lengths, collection limits, unique identifiers, layout bounds, parent references, ports, relations, artifacts, and a maximum of 64 total semantic items at both the PenEcho Agent boundary and the browser boundary.

## Spatial planning and evidence

Spatial Widget work uses separate evidence for composition and readability:

- On a nonempty Canvas, PenEcho Agent inspects exact object bounds and captures the complete content bounds before it creates, moves, resizes, deletes, or arranges a Widget.
- `canvas_inspect.plannedWidget` accepts the intended width, height, source typography, and placement preference. It returns a collision-aware box, a pinned `createPlacement`, whether the box lies outside the current viewport, the unobscured screen stage beside the Agent panel, the focused scale, predicted screen typography, nearby objects, and a suggested region capture.
- Auto placement searches the current viewport first. If no clear slot fits, it uses the nearest clear location elsewhere inside the 20000×20000 logical Canvas; the created Widget is then automatically framed for the user.
- A complete-Canvas layout capture uses automatic bounded compression: a 1024px long edge, at most 520,000 pixels, initial WebP quality 0.72, and at most 700 KiB. Detail evidence is limited to a 1440px long edge, 1,800,000 pixels, and 1200 KiB. Encoding keeps reducing the raster until the byte cap is met or rejects the capture; the server independently verifies encoded bytes and decoded dimensions before exposing it to the model.
- Logical coordinates and output raster size are independent. Capturing a region at a large `x` or `y` changes only its exact logical/pixel transform; only the region width and height participate in sampling, so even far-away or whole-content captures cannot exceed the policy.
- After Widget creation or a geometry change, another complete-Canvas capture is mandatory before object detail or a further mutation. A viewport capture verifies final user-visible framing; tight object or region evidence verifies local detail.

Meaningful body copy targets about 15 screen pixels in a focused view. Body copy below about 11 screen pixels needs visual evidence, and compact labels may reach 8 screen pixels only when contrast and rendered pixels remain clear. These are role-aware review targets, not instructions to enlarge every label or squeeze a long document into one screen.

## Rendering pipeline

1. PenEcho Agent selects Visual Explainer when a rich visual composition materially improves comprehension.
2. `canvas_create_visual_explainer` validates the semantic plan.
3. PenEcho creates one General HTML Widget and stores the normalized plan as copyable JSON.
4. The local renderer resolves exact presentation forms. AntV Infographic 0.2.20 renders sequence, hierarchy, and directional relationship regions; deterministic native components render schedules, tables, routes, matrices, notes, metrics, and fallback cards. Embedded HTML artifacts run in isolated nested frames.
5. The responsive layout preserves the authored 12-column region composition at wide sizes, condenses it to six columns at medium sizes, and stacks it at narrow sizes. A debounced `ResizeObserver` recomputes the composition and rerenders when the Widget size changes.
6. Explicit typography uses Canvas-readable bounds, while native cards and matrices center their useful content instead of stretching sparse boxes across an entire region.
7. The renderer performs one deterministic composition and checks Widget overflow, region bounds, region size, clipped content, AntV warnings, and AntV errors.
8. Structured diagnostics return a status, score, issue signature, selected density, deterministic attempt count, and whether a semantic replan is justified.
9. Existing `canvas_capture` can provide a detail screenshot for the Widget when diagnostics alone are insufficient.

The AntV browser bundle is generated from the pinned npm dependency into `public/vendor`; it never depends on a CDN. If AntV cannot render a panel, the same Widget displays a native semantic fallback instead of becoming blank.

## Stop policy

The stop policy is enforced by server state per actual user message; model tool calls cannot reset it.

- One Visual Explainer may be created per user message.
- Deterministic layout performs one local composition and consumes no model tokens.
- At most two detail captures are allowed for the affected Widget.
- At most one model-authored plan update is allowed.
- Repeating an identical plan is rejected.
- A passing result, a repeated issue signature, improvement below three score points, or the one-update limit ends automatic refinement.
- Explicit user refinements use a minimal `canvas_patch_widget` diff against `widget.source`; one bounded `canvas_update_visual_explainer` remains available only for a diagnostics-driven semantic replan.
- A later explicit user message opens a fresh bounded budget.

Playwright is not part of runtime generation or review. Browser automation may be added later as optional CI coverage, while production review uses structured DOM/SVG diagnostics and PenEcho's existing Widget capture path.
