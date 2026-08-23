---
penecho-plugin: 1
id: general
name: General HTML
name-zh: 通用 HTML
version: 1
description: Self-contained HTML for SVG drawing, transparent overlays, live visuals, and interactive browser-native experiences.
description-zh: 为 SVG 绘图、透明叠加、实时视觉和交互式浏览器体验生成自包含 HTML。
category: Creative
category-zh: 创作
source: Public HTTPS web
connect:
recommended-refresh-seconds: 60
---

# General HTML

Use native `draw` for a very simple static sketch or annotation with about 10 or fewer basic primitives or line segments. Ordinary General HTML is the behavior-first Widget path: use it for interaction that changes the view or data, animation, simulation, illustration, live displays, small browser-native tools, freeform overlays, or a visual that the semantic Visual Explainer vocabulary cannot faithfully represent. It is not the default path for a static explanation merely because HTML offers more layout control. Prefer a compact inline SVG inside generated HTML; SVG is the default static and animated visual format, and canvas is appropriate only when SVG is materially unsuitable. For requested motion, prefer SVG animation with CSS, SMIL, or JavaScript as appropriate. Use ordinary `write_text`, `draw_formula`, or `plot_function` for simple prose, formulas, and single-variable function plots that do not need a custom visual.

## Capability router

Choose exactly one primary Widget path before authoring. Never make Visual Explainer, ordinary General HTML, and Professional Diagrams compete by producing speculative alternatives. Honor an explicit feasible request for one of these artifacts or a named source format first; otherwise choose by the dominant deliverable:

- Use Visual Explainer when the result is primarily meant to help someone understand, organize, or plan through one coordinated, responsive visual narrative. Static architecture explanations, restructured notes, travel itineraries, readable schedules, comparisons, and multi-panel educational material belong there.
- Use ordinary General HTML when custom behavior is primary: interaction that changes data or views, animation, simulation, live or refreshing data, a browser-native tool, a freeform overlay, or a custom illustration outside the VisualExplainerPlan vocabulary. Simple hover, responsive reflow, decorative motion, or wanting manual layout control is not enough.
- Use Professional Diagrams when the artifact requires established professional notation, an exact quantitative chart with axes and scales, compatibility with another domain tool, or reusable editable professional source. C4, BPMN, UML, KiCad, database schemas, GeoJSON deliverables, and Vega-Lite statistical charts are examples. Merely using words such as diagram, chart, architecture, model, structure, process, flow, or draw is not enough.

For mixed requests, preserve the defining artifact rather than the amount of explanatory copy around it. A Transformer explanation is Visual Explainer; an interactive attention simulator is General HTML; an editable C4 model is Professional Diagrams. A travel plan is Visual Explainer; a draggable live map is General HTML; a reusable GeoJSON route is Professional Diagrams. Do not switch paths after creation solely for cosmetic polishing.

## Visual Explainer path

When the router selects Visual Explainer and `canvas_create_visual_explainer` is available, use it for one coordinated composition. Pass `plan` as a JSON object, never as a JSON-encoded string. The single current contract uses `regions` in a compact 12-column layout. Each region chooses a semantic renderer such as `flow`, `hierarchy`, `relationship`, `cards`, `metrics`, `table`, or `matrix`; it may instead reference one isolated `embedded-html` artifact when custom behavior or presentation is materially necessary. Use named region ports and parent relations only for meaningful cross-region relationships. PenEcho constructs the responsive parent layout, isolated artifact lifecycle, and cross-region SVG overlay. Do not invent legacy `sections`, `order`, or `emphasis` fields, and do not place CSS, SVG, JavaScript, renderer syntax, or template names in semantic regions.

Aim for 4–6 coherent regions when the content warrants them; a straightforward hierarchy or flow may use fewer semantic regions. Keep dense internal relationships inside one region or artifact, and expose only meaningful cross-region ports with `data-penecho-port="port-id"`. Use available area for legible information, not ornamental voids.

After creation, explicit user refinements should be incremental. Read and patch `widget.source` for parent typography, content, regions, layout, or relations. To edit one embedded area, read `visual.artifacts`, then read that artifact's `artifact.widget.json` / `artifact.widget.html`, and call `canvas_patch_widget` with its `artifactId`. This uses the ordinary General HTML patch contract for that artifact and preserves all unrelated artifact HTML.

The direct Canvas Pen `AI Refine` path is incremental too. When its protected `widgetEdit` target is a Visual Explainer, return one `widget_patch` that changes only the necessary lines of `widget.source`; PenEcho validates and recompiles the visual before showing the replacement. A change inside one artifact should touch only that artifact's HTML string in the source diff, not recreate the parent HTML or unrelated artifacts.

Use the returned structured diagnostics before requesting pixels. The renderer performs one deterministic responsive composition. Only a remaining semantic-density or hierarchy issue may justify one `canvas_update_visual_explainer` call. Never perform repeated cosmetic self-polishing; after one model update, a repeated issue signature, less than three quality-score points of improvement, or a passing result, stop and present the best current result. A later explicit user request opens a fresh bounded update budget. When the Visual Explainer tools are not available, follow the ordinary HTML output contract below.

## Output contract

Return exactly one `html_widget` command and no prose, with `pluginId:"general"`. Generate one complete responsive HTML document yourself with inline CSS and JavaScript. Choose dimensions for the actual request; a useful standalone default is `w:2400`, `h:1400`, `refreshSeconds:0`.

HTML is the sole reusable source for this plugin. Omit `copyText` and `copyLabel`; PenEcho derives its trusted Copy HTML action directly from `html`. Do not minify. Keep stable multiline formatting for later refinement: put major HTML elements, CSS declarations, and JavaScript statements on separate lines, and prefer ordinary lines below 160 characters. Never hard-wrap strings, URLs, data, or other literals where a newline could change behavior.

The visible widget must answer visually. Unless the user explicitly asks to inspect raw data or code, never use a JSON, XML, YAML, source-code, or `<pre>` dump as the primary view. Use Professional Diagrams instead when the request materially needs established notation, an exact quantitative chart, compatibility with a domain tool, or copyable and editable professional source. Merely asking to draw, explain, or show an architecture, model, structure, process, flow, diagram, or chart is not enough; keep static explanation-first visuals in Visual Explainer when available, otherwise use General HTML. PenEcho locally renders its supported `diagram_source` formats from source alone, while unsupported formats require a faithful visual HTML view plus the professional source in `copyText`.

Placement is semantic, not a search for unused canvas space. Put the widget where it most directly solves the user's problem. When the answer annotates existing canvas content, align a transparent SVG overlay with the referenced region and draw only the new information without reproducing what is underneath—for example, overlay only the solution path on an existing maze. If existing figures or objects are the actors or targets of a requested animation, position the transparent widget over their actual locations and draw only the new motion, projectile, path, or effect; never redraw the figures or build a duplicate standalone scene. Use nearby blank space only for standalone visuals or when overlap would hide information the user still needs.

Transparency is the default. Keep `html`, `body`, the outermost layout, and the SVG root transparent. Match the current PenEcho theme and nearby visual language when host context exposes them; when refining an existing widget, preserve its established style unless the user asks to change it. Use a contained opaque or translucent surface only when it materially improves contrast, legibility, semantic grouping, or media presentation, or when the user explicitly requests one. Prefer the smallest necessary local surface and do not default to an enclosing card, border, corner radius, or shadow. For an overlay, draw only the new answer or annotation and let the existing canvas remain visible beneath it. Make requested content prominent and readable.

## Runtime rules

The generated HTML may directly access public HTTPS APIs and load HTTPS scripts, modules, styles, fonts, images, media, or other resources when they materially improve the result. Choose data endpoints that need no OAuth or API key because the local channel solves browser CORS, not source authentication. Use ordinary `fetch(url,{credentials:"omit"})` for public HTTPS data. PenEcho automatically falls back through its server when an eligible GET encounters browser CORS or a direct network failure, so generated widgets need no CORS workaround and may use public HTTPS URLs directly. Treat the result as a standard `Response`: check `response.ok`, then consume it with `response.json()`, `response.text()`, `response.blob()`, or `response.arrayBuffer()` as appropriate.

Use stable version-pinned library URLs, encode user-derived URL parameters, use `credentials:"omit"` for direct resource requests, and show useful loading and error states. Never include secrets, authorization headers, cookies, private endpoints, or user data that was not explicitly provided for that destination. Do not use forms, storage, `sendBeacon`, or current-frame navigation. Make useful public HTTPS source URLs from fetched news and other records clickable with `<a target="_blank" rel="noopener noreferrer">`. Native HTML, CSS, JavaScript, timers, SVG, and canvas remain preferred when no dependency is needed. Dynamic SVG fully supports inline scripts, CSS animation, SMIL animation, filters, gradients, masks, and event-driven interaction. For a multi-part SVG visual, use a wrapping CSS layout with tight-viewBox panels or rebuild coordinates from a `ResizeObserver`; never make the whole widget one fixed-size viewBox that only scales to `width:100%;height:100%`. In 3D scenes, explicitly aim the camera at the subject and keep it centered after resize. Redraw canvas, SVG, and 3D visuals after viewport changes when needed. After the initial render and meaningful layout/state changes, call `window.parent.postMessage({type:"penecho-widget-updated"}, "*")`; do not send it on every animation frame or clock tick.

## One-shot example

User writes `我需要一个五颜六色的钟，显示当前时间` and points right. Produce one `html_widget` there with a large colorful clock, local date and seconds, an internal one-second timer, responsive layout, no network requests, and no prose outside the command.
