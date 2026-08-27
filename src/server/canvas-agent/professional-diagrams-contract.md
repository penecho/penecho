# PenEcho Agent Existing Professional Diagram Editing

This optional contract is edit-only and exists only when the Professional Diagrams plugin is enabled. It applies only to a Professional Diagram Widget that is already present on the current Canvas.

Never create a new Professional Diagram. Do not call `canvas_create` with `pluginId:"flowchart"`, `widgetType:"diagram_source"`, `frameworkVersion:"penecho-professional-diagrams-v1"`, or a professional source format. A request for a new Widget must use Visual Explorer or an enabled HTML route instead.

## Identify and read the existing Widget

Use the latest Canvas state to locate the target that the user selected or clearly identified. A Professional Diagram uses `pluginId:"flowchart"` and may be either a locally rendered `diagram_source` Widget or an older/direct `html_widget` with professional source.

Call `canvas_read` for the authoritative virtual resource before changing content:

* Locally rendered `diagram_source` Widgets keep reusable syntax in `widget.source`.
* Direct professional HTML Widgets may use `widget.html` for the rendering and `widget.source` for distinct reusable source. Read every resource that the requested change must keep synchronized.
* Preserve the existing `sourceFormat`, `diagramKind`, renderer, framework version, title, and untouched content unless the user explicitly asks to change them.

Common locally rendered formats are `mermaid`, `dot`, `bpmn-xml`, `vega-lite`, `geojson`, `smiles`, and `cytoscape-json`. Other existing professional Widgets may contain PlantUML, D2, Structurizr DSL, DBML or SQL DDL, draw.io XML, Excalidraw JSON, KiCad, SPICE, WaveDrom, or another established format. Treat the Widget's current format as authoritative; never relabel a substitute syntax.

## Patch in place

Apply the smallest complete `canvas_patch_widget` diff to the existing object. Use canonical `--- a/<virtual-path>` and `+++ b/<virtual-path>` headers. Preserve user-supplied labels, arrows, containment, groups, lanes, order, terminology, directions, quantitative axes, scales, and spatial relationships outside the requested change.

For a direct professional HTML Widget with distinct reusable source, keep `widget.html` and `widget.source` semantically identical after the patch. The rendering must remain human-readable rather than becoming a source viewer. Retain a transparent outer background unless the existing diagram or user request requires a contained surface.

Do not replace the existing Professional Diagram with a newly created Widget merely to make editing easier. Patch the target in place and stop when the requested change is complete.
