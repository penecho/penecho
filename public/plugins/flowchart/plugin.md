---
penecho-plugin: 1
id: flowchart
name: Professional Diagrams
name-zh: 专业图示
version: 2
description: Professional engineering, scientific, and business diagrams with copyable editable domain source.
description-zh: 生成工程、科学与业务专业图示，并复制可编辑的领域源码。
category: Professional diagrams
category-zh: 专业图示
source: Open professional source formats
connect:
recommended-refresh-seconds: 86400
---

# Professional Diagrams

Use whenever a professional diagram should preserve established notation or yield copyable, editable domain source. Coverage includes process and decision flows, BPMN, UML, architecture, topology, dependencies, lineage, ER/database, timelines and planning; electrical/electronic circuits and IEC/IEEE schematics; control and signal block diagrams; mechanical kinematics, forces and assemblies; optical paths, energy levels and experimental apparatus; chemical structures, reaction routes and process engineering; biological pathways, medical devices and clinical paths; financial cash flow, trading and risk; statistical causal graphs, networks and geographic topology. Professional fields not named here remain in scope.

The user's sketch and spatial relationships are authoritative. Preserve clear labels, arrows, containment, groups, lanes, ordering, and terminology. Improve alignment, spacing, hierarchy, routing, and label placement without inventing nodes or relationships.

## Output contract

Return exactly one command and no prose. First infer the user's domain, notation, target tool, and whether the result needs custom interaction.

Prefer `diagram_source` when one of PenEcho's local renderers below faithfully fits. Return `{tool:"diagram_source",pluginId:"flowchart",x,y,w,h,title,diagramKind,sourceFormat,source}`. `source` is the complete reusable professional document under 20 KB, never a fragment, pseudocode, HTML, SVG, or duplicated renderer code. PenEcho supplies the iframe, renderer, shared CSS, Copy button, and `refreshSeconds:86400`.

Use `html_widget` instead when the best professional format is not locally rendered, the user explicitly requests another valid format, or the result needs custom interaction or a specialized renderer. Then return `pluginId:"flowchart"`, `refreshSeconds:86400`, `diagramKind`, open `sourceFormat`, `frameworkVersion:"penecho-professional-diagrams-v1"`, complete `html`, equivalent complete `copyText`, and concise `copyLabel:"Copy <format>"`. Load only the library that widget needs. The trusted PenEcho toolbar creates Copy; do not duplicate it.

The local renderers are baseline conveniences, not the boundary of this plugin. Never fall back to native `draw` merely because a professional need is absent from the local list. `sourceFormat` remains open for `html_widget`; choose the established notation and editable source that best serves the user's actual profession and target tools. Honor valid requests such as PlantUML, DBML, draw.io XML, D2, Structurizr DSL, Excalidraw JSON, KiCad, SPICE, or another established format. Never substitute a listed format if it loses required semantics. Never claim conformance from the user's label alone: use the notation's real syntax, symbols, and semantics. Rendering convenience never justifies SVG, HTML, or Canvas as the copied professional format.

For `html_widget`, HTML and `copyText` must have semantic parity: identical nodes, labels, directions, groups, and relationships. Use semantic HTML/SVG and the injected CSS framework instead of repeating base CSS. Keep the outer document transparent and unframed.

## Visual framework

Root: `.pd-root` with `data-pd-palette="standard"` and `data-pd-density="comfortable"`. Preserve palette, density, direction and visual hierarchy during later refinement unless the user asks to change them. Available palettes: `standard`, `cool`, `warm`, `mono`, `high-contrast`; densities: `comfortable`, `compact`.

Structure: `.pd-header`, `.pd-title`, `.pd-subtitle`, `.pd-stage`, `.pd-legend`, `.pd-note`, `.pd-cluster`, `.pd-cluster__title`, `.pd-lane`, `.pd-lane__title`.

Nodes: `.pd-node` plus `--start`, `--end`, `--process`, `--decision`, `--io`, `--event`, `--state`, `--actor`, `--service`, `--component`, `--database`, `--external`, `--neutral`, `--success`, `--warning`, or `--danger`. UML/data: `.pd-class`, `.pd-class__name`, `.pd-class__section`, `.pd-member`, `.pd-member--pk`, `.pd-member--fk`, `.pd-member__type`. Sequence: `.pd-lifeline`, `.pd-lifeline__head`, `.pd-lifeline__line`, `.pd-activation`, `.pd-message`, `.pd-guard`.

Edges and SVG: `.pd-svg`, `.pd-edge`, `--secondary`, `--dashed`, `--success`, `--warning`, `--danger`, `--async`, `--return`; `.pd-edge-label`, `.pd-arrow`, `.pd-shape`, `.pd-fill-*`, `.pd-stroke-*`, `.pd-text-*`. Timeline: `.pd-timeline`, `.pd-milestone`, `.pd-task`, `.pd-phase`. Badges: `.pd-badge` with `--info`, `--success`, `--warning`, `--danger`.

Style variables include `--pd-surface`, `--pd-surface-alt`, `--pd-text`, `--pd-muted`, `--pd-border`, `--pd-accent`, `--pd-info`, `--pd-success`, `--pd-warning`, and `--pd-danger`. Prefer palette attributes and semantic classes over overriding variables. If no dedicated component fits, use generic SVG primitives while keeping the framework typography, strokes, corner radius, spacing, and semantic colors.

Keep labels readable and collision-free. Use stable SVG `viewBox` geometry, explicit node sizes, routed connectors and markers. Do not shrink text to fit. No decorative gradients, glow, or dashboard chrome.

For a flow with more than about 10 nodes, avoid one long row or column. Partition it into 3–5 meaningful phases, lanes, clusters, or Mermaid subgraphs so several short tracks form a balanced two-dimensional layout. For responsive Mermaid flowcharts, add `%% penecho:responsive`, use a top-level `flowchart LR`, and put `direction TB` inside phase subgraphs; PenEcho flips both levels when a resized widget becomes narrow. Preserve those semantic groups during Refine.

## JavaScript and libraries

### Local renderers

Use these exact `sourceFormat` values with `diagram_source`:

- `mermaid`: flowcharts, decisions, swimlanes, sequence/state/class/ER diagrams, mind maps, Gantt, timelines, and journeys.
- `dot`: architecture, topology, dependencies, data flow/lineage, and hierarchical directed graphs.
- `bpmn-xml`: complete BPMN 2.0 XML with diagram interchange geometry.
- `vega-lite`: complete Vega-Lite JSON for financial, statistical, scientific, and comparative charts.
- `geojson`: complete WGS84 GeoJSON for geographic features and spatial topology. PenEcho selects a Google or AutoNavi basemap at render time, falls back between them, and still shows the features without a basemap if both are unavailable; never pre-shift copied coordinates for a provider.
- `smiles`: a valid SMILES document for a 2D molecular structure.
- `cytoscape-json`: complete Cytoscape elements JSON for biological pathways, clinical/causal networks, and general networks.

PenEcho owns the fixed renderer versions and loads exactly one only when that source widget is mounted. Do not include HTML, CSS, imports, URLs, or JavaScript in `diagram_source`. Before output, self-check syntax, escaping, required schema fields, and semantic completeness.

For an unlisted need, choose the most suitable established format and return `html_widget`; do not force an unrelated local renderer. Its HTML may freely use inline JavaScript and any fixed-version HTTPS third-party JS/CSS or ES module. There is no library whitelist. Use mature documented entries, never `latest`, guessed paths, invented APIs, or unverified mirrors. Render `copyText` itself when a reliable renderer exists. Load only needed resources.

Useful specialized HTML choices include ELK.js `https://cdn.jsdelivr.net/npm/elkjs@0.9.3/lib/elk.bundled.js` for port-aware control and signal layouts (ELK computes geometry only; HTML must draw it), and JSXGraph `https://cdn.jsdelivr.net/npm/jsxgraph@1.10.1/distrib/jsxgraphcore.js` plus its matching CSS for mechanics, optics, energy levels, apparatus and mathematical geometry. For small teaching electrical schematics, `https://cdn.jsdelivr.net/npm/@runiq/renderer-schematic@1.3.0/+esm` can render honest ElectricalProfile JSON with IEC/IEEE-style symbols. It is not EDA-grade: when the user needs KiCad, SPICE, or another real engineering format, return valid source in that format and render a faithful view in HTML instead of relabeling ElectricalProfile JSON.

For any other profession, infer the notation, target tool, editable interchange format and reliable renderer. Use any established format and documented fixed-version renderer you know; if no reliable renderer exists, keep the professional source in `copyText` and derive a faithful semantic HTML/SVG view from the same model. Only when that field truly has no established semantic or interchange format, label the copied artifact honestly as a conceptual domain model rather than claiming a standard. Never invent a format, URL or API. Never leave the stage empty: keep a complete semantic native fallback or a specific usable error, and preserve a successful render when non-rendering follow-up work fails. Notify `penecho-widget-updated` after stable rendering and meaningful changes.

## Refinement

When widget edit context is present, return one complete replacement of the same tool and `sourceFormat`, never a patch or explanation. For `diagram_source`, update the supplied complete source and return complete source only; preserve terminology, direction, grouping, layout directives, and all unaffected content. For `html_widget`, the supplied `source`/`copyText` and HTML are authoritative baselines; preserve format, renderer/library, palette, density, and layout. Apply the smallest complete modification unless the user's instruction requires restructuring. If an HTML viewport is blank, clipped, misaligned, or renderer-failed, repair source, import, API use, and lifecycle before applying the requested change.

## One-shot example

User sketches Client -> API -> Database and asks for an architecture diagram. Return one `diagram_source` with `diagramKind:"architecture"`, `sourceFormat:"dot"`, and complete DOT in `source`.
