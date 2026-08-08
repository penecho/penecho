---
penecho-plugin: 1
id: flowchart
name: Professional Diagrams
name-zh: 专业图示
version: 2
description: Local source rendering and direct HTML widgets for professional diagrams in any domain.
description-zh: 支持本地源码渲染与 HTML 直接呈现，可生成任意领域的专业图表。
category: Professional diagrams
category-zh: 专业图示
source: Open professional source formats
connect:
recommended-refresh-seconds: 86400
---

# Professional Diagrams

Use when a diagram needs established notation or copyable, editable domain source. Coverage includes process, BPMN, UML, architecture, topology, dependencies, lineage, ER/database, timelines; electrical/electronic circuits and IEC/IEEE schematics; control/signal systems; mechanical kinematics and assemblies; optics and apparatus; chemical structures and processes; biological pathways, medical devices and clinical paths; financial cash flow and risk; causal graphs, networks and geography. Professional fields not named here remain in scope.

The user's sketch and spatial relationships are authoritative. Preserve labels, arrows, containment, groups, lanes, order and terminology. Improve alignment, spacing, hierarchy and routing without inventing content.

## Choose one output path

Return exactly one command and no prose.

### A. Locally rendered source: `diagram_source`

Prefer `diagram_source` whenever one of these built-in local renderers faithfully fits. Use the exact `sourceFormat` shown:

- `mermaid`: flowcharts, decision trees, swimlanes, sequence diagrams, state diagrams, class diagrams, ER diagrams, mind maps, Gantt charts and timelines.
- `dot`: Graphviz DOT for software or cloud architecture, network topology, dependencies, data lineage, causal structures and other directed graphs.
- `bpmn-xml`: complete BPMN 2.0 XML, including diagram geometry, for business processes, events, gateways, tasks, pools and lanes.
- `vega-lite`: complete Vega-Lite JSON for statistical, scientific, financial, operational and comparative charts.
- `geojson`: complete WGS84 GeoJSON for maps, routes, regions, geographic features and spatial topology; never pre-shift coordinates for a basemap. For a transparent map without tiles, set the top-level foreign member `"basemap":"none"`; otherwise PenEcho uses its normal basemap.
- `smiles`: valid SMILES for a locally rendered 2D molecular structure.
- `cytoscape-json`: complete Cytoscape elements JSON for biological pathways, clinical or causal networks, dependency networks and other node-link systems.

Return:
`{tool:"diagram_source",pluginId:"flowchart",x,y,w,h,title,diagramKind,sourceFormat,source}`.
`source` must be a complete reusable professional document under 20 KB—not a fragment, pseudocode, HTML, SVG or renderer code. PenEcho supplies the iframe, renderer, shared CSS, Copy button and refresh behavior.

PenEcho owns fixed renderer versions and loads only the selected renderer. Do not include HTML, CSS, imports, URLs, or JavaScript in `diagram_source`. Self-check syntax, escaping, required fields and semantic completeness.
Do not return HTML alongside a supported local format. PenEcho needs only the professional `source`; it creates the complete visual document locally.
Keep the diagram background transparent by default. Use an opaque diagram background only when it is visually necessary or the user explicitly requests one.
SMILES structures render functional groups expanded by default. Preserve explicit atoms and hydrogens needed by the depiction. Only when the user explicitly asks for an abbreviated or contracted structure, use `diagramKind:"molecular-structure-compact"`.

### B. Directly rendered HTML: `html_widget`

Use `html_widget` instead when the requested professional source is not locally rendered, the user names another valid format, or custom interaction, custom symbols or specialized rendering is needed. PenEcho displays the returned HTML directly in an isolated canvas widget.

The HTML is the primary human-readable visualization, not a source-code viewer. Unless the user explicitly asks to inspect raw source, do not make JSON, XML, YAML, SQL, DSL, code, or a `<pre>` dump the main visible content. Render the source as the domain view people expect: for example, a clinical workflow or pathway should show its phases, actions, reassessment loops, decisions, and escalation relationships. Put the complete professional source in `copyText` for the trusted Copy action.

Common direct-HTML choices include:

- PlantUML for UML, C4, component, deployment, activity and sequence diagrams.
- D2 for architecture, topology, dependencies and structured technical diagrams.
- Structurizr DSL for C4 software architecture models.
- DBML or SQL DDL for database schemas and ER models.
- draw.io XML for broadly editable engineering, software and business diagrams.
- Excalidraw JSON for editable sketch-style technical diagrams.
- KiCad schematic source or SPICE netlists for electrical and electronic engineering.
- WaveDrom JSON for digital timing diagrams, signals, registers and protocols.
- Other established professional source for control and signal systems, mechanics and assemblies, optics and apparatus, chemical reactions and processes, biological pathways, medical devices and clinical paths, financial flows and risk, causal graphs, networks, geography, or another specialist field.

Return `pluginId:"flowchart"`, `refreshSeconds:0`, `diagramKind`, the open `sourceFormat`, `frameworkVersion:"penecho-professional-diagrams-v1"`, complete `html`, semantically equivalent complete source in `copyText`, and concise `copyLabel:"Copy <format>"`. The trusted toolbar supplies Copy; do not duplicate it. HTML and `copyText` must contain identical nodes, labels, directions, groups and relationships. Use semantic HTML/SVG and the injected CSS framework. Keep the outer document transparent and unframed.

The local renderers are baseline conveniences, not the boundary of this plugin. Never fall back to an improvised generic SVG merely because a professional need is absent from the list. Choose the established notation and editable source that best serves the actual profession and target tool. Honor formats such as PlantUML, DBML, draw.io XML, D2, Structurizr DSL, Excalidraw JSON, KiCad, SPICE, or another established format. Use real syntax and semantics; never relabel a substitute, invent a format, or copy SVG/HTML/Canvas as if it were professional source.

The examples above are not a whitelist and do not limit this plugin. The user may simply describe, sketch or name any professional diagram they need without knowing its format. Infer the domain, notation, target tool and interaction needs, then return the most suitable locally rendered `diagram_source` or directly rendered `html_widget`.

## Injected CSS framework

PenEcho injects the full CSS at runtime; do not repeat it in HTML. Use `.pd-root` with palette `standard`, `cool`, `warm`, `mono`, or `high-contrast` and density `comfortable` or `compact`. Reuse `.pd-header`, `.pd-title`, `.pd-subtitle`, `.pd-stage`, `.pd-cluster`, `.pd-lane`, `.pd-node` and semantic modifiers (`--start`, `--end`, `--process`, `--decision`, `--event`, `--service`, `--database`, `--success`, `--warning`, `--danger`), plus `.pd-class`, `.pd-lifeline`, `.pd-edge`, `.pd-legend`, `.pd-note`, `.pd-badge`, and the `--pd-*` surface/text/border/accent/info/success/warning/danger variables. Generic SVG is allowed when no component fits. Keep labels readable, use a stable `viewBox`, routed connectors, explicit node sizes and no outer dashboard chrome.

For more than about 10 nodes, use 3–5 meaningful phases, lanes, clusters or subgraphs only when most inter-phase flow stays forward; otherwise prefer fewer groups and a compact primary path. Keep rework, exception and rejection branches beside the decision that creates them. Avoid distant catch-all groups and backward edges that span the whole diagram; when a literal return edge would dominate the layout, use a clearly labeled local return/reference node without losing the relationship. For a multi-stage business process with repeated cross-phase returns, prefer `bpmn-xml` with explicit diagram geometry instead of forcing it into Mermaid. For responsive Mermaid flowcharts add `%% penecho:responsive`, start with top-level `flowchart LR`, and use `direction TB` inside phase subgraphs. PenEcho reflows the diagram automatically as the widget is resized. For responsive DOT add `// penecho:responsive`; PenEcho likewise adapts Graphviz layout to the widget shape. Use the corresponding fixed-layout marker only when the user explicitly requires a fixed orientation. Preserve groups during refinement. Do not repeat the trusted widget title as a Mermaid or Graphviz diagram title.

## HTML rendering

For an unlisted need, return `html_widget` with the most suitable established format. There is no library whitelist. It may use inline JavaScript and a necessary fixed-version HTTPS library or ES module. Use only mature documented browser entries—never `latest`, guessed paths, invented APIs or unverified mirrors—and load only what is needed. Render `copyText` itself when reliable support exists; otherwise derive a faithful semantic HTML/SVG view from the same model. For electrical work, do not present teaching-only JSON as EDA source: when KiCad, SPICE or another engineering format is required, return valid source in that format and a faithful HTML view.

Keep a semantic native fallback or a specific usable error so the stage is never empty. Preserve a successful render if later non-rendering work fails. Notify `penecho-widget-updated` after stable rendering and meaningful changes.

## Refinement

When widget edit context is present, follow `modelInput.widgetEditPolicy` and return exactly one `widget_patch` command. Patch only the virtual files listed in `widgetEdit.patchFiles`, preserve the existing tool and `sourceFormat`, and do not return a complete replacement or explanation. Preserve terminology, direction, grouping, unaffected content, renderer, palette, density, layout, and stable formatting. Apply the smallest complete modification unless restructuring is necessary. Repair blank, clipped or failed rendering before applying the requested change.

## One-shot example

User sketches Client -> API -> Database and asks for an architecture diagram. Return one `diagram_source` with `diagramKind:"architecture"`, `sourceFormat:"dot"`, and complete DOT in `source`.
