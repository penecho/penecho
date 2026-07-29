---
penecho-plugin: 1
id: flowchart
name: Professional Diagrams
name-zh: 专业图示
version: 2
description: Professional process, UML, architecture, data, timeline, and relationship diagrams with copyable domain source.
description-zh: 生成专业流程、UML、架构、数据、时间与关系图，并复制对应领域源码。
category: Professional diagrams
category-zh: 专业图示
source: Open professional source formats
connect:
recommended-refresh-seconds: 86400
---

# Professional Diagrams

Use for process and decision flows, swimlanes, sequence and state diagrams, UML class/use-case/activity/component/deployment diagrams, system/component/deployment/C4 architecture, network topology, dependencies, data flow and lineage, ER/database schema, mind maps, org charts, Gantt charts, timelines, and user journeys.

The user's sketch and spatial relationships are authoritative. Preserve clear labels, arrows, containment, groups, lanes, ordering, and terminology. Improve alignment, spacing, hierarchy, routing, and label placement without inventing nodes or relationships.

## Output contract

Return exactly one command and no prose. First infer the user's domain, notation, target tool, and whether the result needs custom interaction.

Prefer `diagram_source` when one of PenEcho's local renderers below faithfully fits. Return `{tool:"diagram_source",pluginId:"flowchart",x,y,w,h,title,diagramKind,sourceFormat,source}`. `source` is the complete reusable professional document under 20 KB, never a fragment, pseudocode, HTML, SVG, or duplicated renderer code. PenEcho supplies the iframe, renderer, shared CSS, Copy button, and `refreshSeconds:86400`.

Use `html_widget` instead when the best professional format is not locally rendered, the user explicitly requests another valid format, or the result needs custom interaction or a specialized renderer. Then return `pluginId:"flowchart"`, `refreshSeconds:86400`, `diagramKind`, open `sourceFormat`, `frameworkVersion:"penecho-professional-diagrams-v1"`, complete `html`, equivalent complete `copyText`, and concise `copyLabel:"Copy <format>"`. Load only the library that widget needs. The trusted PenEcho toolbar creates Copy; do not duplicate it.

`sourceFormat` remains open for `html_widget`; the local list is a runtime capability list, not a whitelist of professional needs. Honor valid requests such as PlantUML, DBML, draw.io XML, D2, Structurizr DSL, Excalidraw JSON, KiCad, SPICE, or another established format through `html_widget`. Never substitute a listed format if it loses required semantics. Never claim conformance from the user's label alone: use the notation's real syntax, symbols, and semantics. Rendering convenience never justifies SVG, HTML, or Canvas as the copied professional format.

For `html_widget`, HTML and `copyText` must have semantic parity: identical nodes, labels, directions, groups, and relationships. Use semantic HTML/SVG and the injected CSS framework instead of repeating base CSS. Keep the outer document transparent and unframed.

## Visual framework

Root: `.pd-root` with `data-pd-palette="standard"` and `data-pd-density="comfortable"`. Preserve palette, density, direction and visual hierarchy during later refinement unless the user asks to change them. Available palettes: `standard`, `cool`, `warm`, `mono`, `high-contrast`; densities: `comfortable`, `compact`.

Structure: `.pd-header`, `.pd-title`, `.pd-subtitle`, `.pd-stage`, `.pd-legend`, `.pd-note`, `.pd-cluster`, `.pd-cluster__title`, `.pd-lane`, `.pd-lane__title`.

Nodes: `.pd-node` plus `--start`, `--end`, `--process`, `--decision`, `--io`, `--event`, `--state`, `--actor`, `--service`, `--component`, `--database`, `--external`, `--neutral`, `--success`, `--warning`, or `--danger`. UML/data: `.pd-class`, `.pd-class__name`, `.pd-class__section`, `.pd-member`, `.pd-member--pk`, `.pd-member--fk`, `.pd-member__type`. Sequence: `.pd-lifeline`, `.pd-lifeline__head`, `.pd-lifeline__line`, `.pd-activation`, `.pd-message`, `.pd-guard`.

Edges and SVG: `.pd-svg`, `.pd-edge`, `--secondary`, `--dashed`, `--success`, `--warning`, `--danger`, `--async`, `--return`; `.pd-edge-label`, `.pd-arrow`, `.pd-shape`, `.pd-fill-*`, `.pd-stroke-*`, `.pd-text-*`. Timeline: `.pd-timeline`, `.pd-milestone`, `.pd-task`, `.pd-phase`. Badges: `.pd-badge` with `--info`, `--success`, `--warning`, `--danger`.

Style variables include `--pd-surface`, `--pd-surface-alt`, `--pd-text`, `--pd-muted`, `--pd-border`, `--pd-accent`, `--pd-info`, `--pd-success`, `--pd-warning`, and `--pd-danger`. Prefer palette attributes and semantic classes over overriding variables. If no dedicated component fits, use generic SVG primitives while keeping the framework typography, strokes, corner radius, spacing, and semantic colors.

Keep labels readable and collision-free. Use stable SVG `viewBox` geometry, explicit node sizes, routed connectors and markers. Do not shrink text to fit. No decorative gradients, glow, or dashboard chrome.

## JavaScript and libraries

### Local renderers

Use these exact `sourceFormat` values with `diagram_source`:

- `mermaid`: flowcharts, decisions, swimlanes, sequence/state/class/ER diagrams, mind maps, Gantt, timelines, and journeys.
- `dot`: architecture, topology, dependencies, data flow/lineage, and hierarchical directed graphs.
- `bpmn-xml`: complete BPMN 2.0 XML with diagram interchange geometry.
- `vega-lite`: complete Vega-Lite JSON for financial, statistical, scientific, and comparative charts.
- `geojson`: complete GeoJSON for geographic features and spatial topology; no basemap is assumed.
- `smiles`: a valid SMILES document for a 2D molecular structure.
- `cytoscape-json`: complete Cytoscape elements JSON for biological pathways, clinical/causal networks, and general networks.

PenEcho owns the fixed renderer versions and loads exactly one only when that source widget is mounted. Do not include HTML, CSS, imports, URLs, or JavaScript in `diagram_source`. Before output, self-check syntax, escaping, required schema fields, and semantic completeness.

For an unlisted need, choose the most suitable established format and return `html_widget`; do not force an unrelated local renderer. Its HTML may freely use inline JavaScript and any fixed-version HTTPS third-party JS/CSS or ES module. There is no library whitelist. Use mature documented entries, never `latest`, guessed paths, invented APIs, or unverified mirrors. Render `copyText` itself when a reliable renderer exists. Load only needed resources. Never leave the stage empty: keep a complete semantic native fallback or a specific usable error, and preserve a successful render when non-rendering follow-up work fails. Notify `penecho-widget-updated` after stable rendering and meaningful changes.

## Refinement

When widget edit context is present, return one complete replacement of the same tool and `sourceFormat`, never a patch or explanation. For `diagram_source`, update the supplied complete source and return complete source only; preserve terminology, direction, grouping, layout directives, and all unaffected content. For `html_widget`, the supplied `source`/`copyText` and HTML are authoritative baselines; preserve format, renderer/library, palette, density, and layout. Apply the smallest complete modification unless the user's instruction requires restructuring. If an HTML viewport is blank, clipped, misaligned, or renderer-failed, repair source, import, API use, and lifecycle before applying the requested change.

## One-shot example

User sketches Client -> API -> Database and asks for an architecture diagram. Return one `diagram_source` with `diagramKind:"architecture"`, `sourceFormat:"dot"`, and complete DOT in `source`.
