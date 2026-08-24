# Canvas Agent Professional Diagrams

This optional contract exists only when the Professional Diagrams plugin is enabled. Use it when established notation, faithful quantitative axes and scales, domain-tool compatibility, or reusable editable professional source defines the requested artifact. An explicit feasible professional format wins. Do not choose it merely because the request contains words such as diagram, chart, architecture, model, process, flow, or draw.

Preserve user-supplied labels, arrows, containment, groups, lanes, order, terminology, and spatial relationships. Improve alignment, spacing, hierarchy, and routing without inventing content.

## Choose one output path

### Locally rendered source

Prefer a `diagram_source` Widget when a built-in renderer faithfully fits:

* `mermaid` — flowcharts, decision trees, sequence, state, class, ER, mind map, Gantt, and timelines
* `dot` — architecture, topology, dependencies, lineage, causal and directed graphs
* `bpmn-xml` — complete BPMN 2.0 including diagram geometry
* `vega-lite` — faithful statistical, scientific, financial, and comparative charts
* `geojson` — complete WGS84 maps, routes, regions, and spatial topology
* `smiles` — valid locally rendered 2D molecular structures
* `cytoscape-json` — complete biological, clinical, causal, dependency, or other node-link networks

Call `canvas_create` with one Widget item using `pluginId:"flowchart"`, `widgetType:"diagram_source"`, a concise title, the exact `sourceFormat`, and complete reusable `source`. Include `diagramKind` when useful and use `refreshSeconds:0`. The source must be real syntax, semantically complete, and under the tool limit—not pseudocode, HTML, SVG, or renderer code. PenEcho owns the HTML, renderer, Copy action, and refresh behavior.

Do not return HTML alongside a supported local format. Keep the diagram background transparent unless a contained surface materially improves legibility.

### Direct HTML with professional source

Use an `html_widget` with `pluginId:"flowchart"` when the requested professional source has no local renderer, the user names another valid domain format, or specialized symbols or interaction are required.

The HTML must be a faithful human-readable rendering, not a source viewer. Put the complete reusable professional source in `copyText`, use a concise `copyLabel:"Copy <format>"`, set the real `sourceFormat`, `diagramKind` when useful, `frameworkVersion:"penecho-professional-diagrams-v1"`, and `refreshSeconds:0`. The HTML and `copyText` must describe identical nodes, labels, directions, groups, and relationships.

Suitable source formats include PlantUML, D2, Structurizr DSL, DBML or SQL DDL, draw.io XML, Excalidraw JSON, KiCad, SPICE, WaveDrom, and other established professional formats. This is not a whitelist. Infer the domain and target tool, then use real documented syntax; never invent or relabel a substitute format.

Use semantic HTML/SVG and keep the outer document transparent. A necessary fixed-version HTTPS renderer may be loaded, but never use `latest`, guessed paths, secrets, or private endpoints. Keep a semantic native fallback or a specific visible error so the stage is not blank. Notify the parent with `penecho-widget-updated` after stable rendering and meaningful changes.

## Composition and refinement

Group dense diagrams only where grouping clarifies the domain logic. Keep exceptions and return paths near the decision that creates them. Avoid long backward edges across the whole diagram when a clearly labeled local return/reference preserves the relationship more legibly.

For an existing Professional Widget, preserve its source format, renderer, terminology, direction, grouping, and unaffected content. Read the authoritative virtual resource and apply the smallest complete `canvas_patch_widget` diff with canonical `a/` and `b/` headers.
