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

Return exactly one `html_widget` command and no prose with `pluginId:"flowchart"`, `refreshSeconds:86400`, `diagramKind`, `sourceFormat`, `frameworkVersion:"penecho-professional-diagrams-v1"`, complete `html`, complete `copyText`, and a concise `copyLabel`.

`sourceFormat` is open, not an enum or whitelist. Choose any professional format that best serves the user's actual domain and tools. Common verified defaults are Mermaid for general flows, decisions, mind maps, Gantt, timelines, journeys, sequences, states, classes and ER views; BPMN XML for BPMN; and Graphviz DOT for topology, architecture, dependencies, lineage and organizational relationships. PlantUML and DBML remain suitable when explicitly requested or when their matching renderer is known to work. These are suggestions only. Honor explicit requests such as draw.io XML, D2, Structurizr DSL, Excalidraw JSON, or another valid format. Unknown formats must still be returned when appropriate. `copyText` must be a complete reusable document, not a fragment or pseudocode. Use `copyLabel:"Copy <format>"`. The trusted PenEcho toolbar creates the button; do not add a duplicate copy control.

`copyText` is the primary artifact; HTML is its renderer. Before writing HTML, infer the requested domain, notation, standard, and target tool, then choose a real, established, editable semantic source or interchange format and produce its complete source. Select a domain-specific format only when its source syntax and a mature browser renderer are known to be reliable. Render that same source directly when practical. Rendering convenience never justifies SVG, HTML, or Canvas as `sourceFormat`; use them only when no established semantic format exists. Never claim conformance to a notation or standard merely from the user's label: use its actual symbols and semantics. If no reliable domain renderer is known, choose a proven general semantic format or a shared-geometry native SVG and label it honestly as conceptual.

HTML and source must have semantic parity: identical nodes, labels, directions, groups and relationships. Return one complete responsive HTML document. Use semantic HTML/SVG and the injected `penecho-professional-diagrams-v1` CSS classes instead of repeating base CSS or large inline style blocks. The outer document stays transparent and unframed.

## Visual framework

Root: `.pd-root` with `data-pd-palette="standard"` and `data-pd-density="comfortable"`. Preserve palette, density, direction and visual hierarchy during later refinement unless the user asks to change them. Available palettes: `standard`, `cool`, `warm`, `mono`, `high-contrast`; densities: `comfortable`, `compact`.

Structure: `.pd-header`, `.pd-title`, `.pd-subtitle`, `.pd-stage`, `.pd-legend`, `.pd-note`, `.pd-cluster`, `.pd-cluster__title`, `.pd-lane`, `.pd-lane__title`.

Nodes: `.pd-node` plus `--start`, `--end`, `--process`, `--decision`, `--io`, `--event`, `--state`, `--actor`, `--service`, `--component`, `--database`, `--external`, `--neutral`, `--success`, `--warning`, or `--danger`. UML/data: `.pd-class`, `.pd-class__name`, `.pd-class__section`, `.pd-member`, `.pd-member--pk`, `.pd-member--fk`, `.pd-member__type`. Sequence: `.pd-lifeline`, `.pd-lifeline__head`, `.pd-lifeline__line`, `.pd-activation`, `.pd-message`, `.pd-guard`.

Edges and SVG: `.pd-svg`, `.pd-edge`, `--secondary`, `--dashed`, `--success`, `--warning`, `--danger`, `--async`, `--return`; `.pd-edge-label`, `.pd-arrow`, `.pd-shape`, `.pd-fill-*`, `.pd-stroke-*`, `.pd-text-*`. Timeline: `.pd-timeline`, `.pd-milestone`, `.pd-task`, `.pd-phase`. Badges: `.pd-badge` with `--info`, `--success`, `--warning`, `--danger`.

Style variables include `--pd-surface`, `--pd-surface-alt`, `--pd-text`, `--pd-muted`, `--pd-border`, `--pd-accent`, `--pd-info`, `--pd-success`, `--pd-warning`, and `--pd-danger`. Prefer palette attributes and semantic classes over overriding variables. If no dedicated component fits, use generic SVG primitives while keeping the framework typography, strokes, corner radius, spacing, and semantic colors.

Keep labels readable and collision-free. Use stable SVG `viewBox` geometry, explicit node sizes, routed connectors and markers. Do not shrink text to fit. No decorative gradients, glow, or dashboard chrome.

## JavaScript and libraries

After choosing `sourceFormat` and `copyText`, when a matching browser renderer or layout engine exists, the HTML MUST load it inside this widget and render the complete source. Use its layout rather than separately hand-coding coordinates. You may freely use inline JavaScript and any HTTPS third-party JS/CSS or ES module; there is no library whitelist. Use mature fixed documented entries, never `latest`, guessed internals, or invented APIs.

### Verified choices

Use a matching choice below when it covers the request; these are preferred working contracts, not restrictions. Load only the choice needed by this widget. General flow, sequence, UML, ER, timeline and Gantt: default-import Mermaid from `https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.esm.min.mjs`, initialize `{startOnLoad:false,securityLevel:"strict"}`, then await `render(id, source)`. BPMN: load `https://cdn.jsdelivr.net/npm/bpmn-js@17.11.1/dist/bpmn-viewer.development.js`, `https://cdn.jsdelivr.net/npm/bpmn-js@17.11.1/dist/assets/diagram-js.css`, and `https://cdn.jsdelivr.net/npm/bpmn-js@17.11.1/dist/assets/bpmn-font/css/bpmn.css`; create global `BpmnJS` with the stage, await `importXML(xml)`, then fit the canvas. Architecture, topology, dependencies and lineage: import named `instance` from `https://cdn.jsdelivr.net/npm/@viz-js/viz@3.9.0/lib/viz-standalone.mjs`, await `instance()`, then use `renderSVGElement(dot)`.

For control and signal block diagrams requiring automatic layout, load `https://cdn.jsdelivr.net/npm/elkjs@0.9.3/lib/elk.bundled.js`, create `new ELK()`, and await `layout(graph)`. ELK only returns positions and routed edge sections: render nodes, ports, and edges yourself from that result (or pass its coordinates to Cytoscape); never expect ELK to paint a diagram. Keep the complete ELK graph JSON as `copyText` when it is the selected source. For force, optical, energy-level, and mathematical geometry, load `https://cdn.jsdelivr.net/npm/jsxgraph@1.10.1/distrib/jsxgraphcore.js` and its `https://cdn.jsdelivr.net/npm/jsxgraph@1.10.1/distrib/jsxgraph.css`, then use `JXG.JSXGraph.initBoard`. For molecular structures, load `https://cdn.jsdelivr.net/npm/smiles-drawer@2.1.7/dist/smiles-drawer.min.js`, keep complete SMILES as `copyText`, and use `SmilesDrawer.parse` then `new SmilesDrawer.Drawer(...).draw(...)`. For biological pathways, clinical networks, causal graphs and general network topology, load `https://cdn.jsdelivr.net/npm/cytoscape@3.30.4/dist/cytoscape.min.js` and use `cytoscape({container,elements,layout})`. For finance and statistical charts, load `https://cdn.jsdelivr.net/npm/vega@5.30.0/build/vega.min.js`, `https://cdn.jsdelivr.net/npm/vega-lite@5.20.1/build/vega-lite.min.js`, and `https://cdn.jsdelivr.net/npm/vega-embed@6.26.0/build/vega-embed.min.js`, keep complete Vega-Lite JSON as `copyText`, and call `vegaEmbed(target,spec,{actions:false,renderer:"svg"})`. For geographic topology, load `https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js` and `https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css`, keep complete GeoJSON as `copyText`, and render with `L.geoJSON`; a useful GeoJSON-only view may intentionally have no tile layer, so do not assume an unverified map-tile provider.

For small or teaching electrical schematics, `https://cdn.jsdelivr.net/npm/@runiq/renderer-schematic@1.3.0/+esm` optionally renders ElectricalProfile JSON with IEEE/IEC-style symbols. It is ESM: use `<script type="module">`, dynamically import it, call `renderSchematic(profile, options)`, and insert its `svg`; the module resolves `@runiq/core`. Its placement is simple horizontal or vertical sequencing with basic wire routing, so do not default to it for EDA-grade schematics. Its JSON is not KiCad, SPICE, or another general interchange standard: label and copy it honestly, and return a requested real standard only when its syntax is known and valid. Use native SVG only when no suitable semantic renderer is known; it is a display fallback, never a claimed professional source format.

For a diagram outside these examples, do not force an unrelated listed library. Infer its notation, tool, and editable source, then use any established format and documented renderer whose syntax/API you know. Use a general verified format only if it preserves semantics; otherwise return valid domain source and render the same model with a faithful native fallback. Never invent a format, renderer URL, or library API.

Do not add unverified mirrors or fallback paths. Before output, self-check source syntax, escaping, renderer API, dependency URL, and render lifecycle; do not guess. Load only needed resources. A native fallback must derive nodes, edges, and labels from one geometry model, connect edges to node boundaries, and wrap labels inside containers. External loads can stall: never leave the stage empty. Render a complete native semantic fallback first, or show it after a short timeout; replace it only after verified renderer success. A title or status line is not a fallback. Preserve a successful render if font waiting, resize observation, or parent notification fails: those follow-up steps are non-fatal. On renderer failure, retain the last valid render or show a usable semantic fallback, never a blank stage or generic unavailable message. After the final stable render, call `window.parent.postMessage({type:"penecho-widget-updated"}, "*")`; call it again after meaningful resize or state changes.

## Refinement

When widget edit context is present, return one complete replacement widget, never a patch or explanation. The supplied `source`/`copyText` and complete `html` renderer are authoritative baselines. Preserve existing content, professional source format, renderer/library, palette, density, layout and terminology unless the instruction explicitly or implicitly requires a change. Reuse the supplied renderer and apply the smallest complete modification. If the supplied HTML or viewport is blank, clipped, misaligned, or renderer-failed, repair its source, import, API use, and lifecycle before applying the user's instruction; preserve only a working renderer. Keep `source`, `copyText`, and HTML semantically identical; the viewport is additional visual context.

## One-shot example

User sketches Client -> API -> Database and asks for an architecture diagram. Return one `html_widget` using the framework classes, with `diagramKind:"architecture"`, a suitable open `sourceFormat` such as `dot`, complete equivalent source in `copyText`, and `copyLabel:"Copy DOT"`.
