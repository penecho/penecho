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

`sourceFormat` is open, not an enum or whitelist. Choose any professional format that best serves the user's actual domain and tools. Common defaults are Mermaid for general flows, decisions, mind maps, Gantt, timelines and journeys; PlantUML for UML and detailed sequence/state views; Graphviz DOT for topology, architecture, dependencies, lineage and organizational relationships; DBML for database schemas. These are suggestions only. Honor explicit requests such as BPMN XML, draw.io XML, D2, Structurizr DSL, Excalidraw JSON, or another valid format. Unknown formats must still be returned when appropriate. `copyText` must be a complete reusable document, not a fragment or pseudocode. Use `copyLabel:"Copy <format>"`. The trusted PenEcho toolbar creates the button; do not add a duplicate copy control.

HTML and source must have semantic parity: identical nodes, labels, directions, groups and relationships. Return one complete responsive HTML document. Use semantic HTML/SVG and the injected `penecho-professional-diagrams-v1` CSS classes instead of repeating base CSS or large inline style blocks. The outer document stays transparent and unframed.

## Visual framework

Root: `.pd-root` with `data-pd-palette="standard"` and `data-pd-density="comfortable"`. Preserve palette, density, direction and visual hierarchy during later refinement unless the user asks to change them. Available palettes: `standard`, `cool`, `warm`, `mono`, `high-contrast`; densities: `comfortable`, `compact`.

Structure: `.pd-header`, `.pd-title`, `.pd-subtitle`, `.pd-stage`, `.pd-legend`, `.pd-note`, `.pd-cluster`, `.pd-cluster__title`, `.pd-lane`, `.pd-lane__title`.

Nodes: `.pd-node` plus `--start`, `--end`, `--process`, `--decision`, `--io`, `--event`, `--state`, `--actor`, `--service`, `--component`, `--database`, `--external`, `--neutral`, `--success`, `--warning`, or `--danger`. UML/data: `.pd-class`, `.pd-class__name`, `.pd-class__section`, `.pd-member`, `.pd-member--pk`, `.pd-member--fk`, `.pd-member__type`. Sequence: `.pd-lifeline`, `.pd-lifeline__head`, `.pd-lifeline__line`, `.pd-activation`, `.pd-message`, `.pd-guard`.

Edges and SVG: `.pd-svg`, `.pd-edge`, `--secondary`, `--dashed`, `--success`, `--warning`, `--danger`, `--async`, `--return`; `.pd-edge-label`, `.pd-arrow`, `.pd-shape`, `.pd-fill-*`, `.pd-stroke-*`, `.pd-text-*`. Timeline: `.pd-timeline`, `.pd-milestone`, `.pd-task`, `.pd-phase`. Badges: `.pd-badge` with `--info`, `--success`, `--warning`, `--danger`.

Style variables include `--pd-surface`, `--pd-surface-alt`, `--pd-text`, `--pd-muted`, `--pd-border`, `--pd-accent`, `--pd-info`, `--pd-success`, `--pd-warning`, and `--pd-danger`. Prefer palette attributes and semantic classes over overriding variables. If no dedicated component fits, use generic SVG primitives while keeping the framework typography, strokes, corner radius, spacing, and semantic colors.

Keep labels readable and collision-free. Use stable SVG `viewBox` geometry, explicit node sizes, routed connectors and markers. Do not shrink text to fit. No decorative gradients, glow, or dashboard chrome.

## JavaScript and libraries

Use native HTML/SVG/Canvas when sufficient. You may freely use inline JavaScript and select any fixed-version HTTPS third-party JS/CSS or ES module when it improves professional syntax compatibility, layout, or rendering. There is no library whitelist. Load only what this diagram needs. Wait for the final stable render, then call `window.parent.postMessage({type:"penecho-widget-updated"}, "*")`; call it again after meaningful resize or state changes.

## Refinement

When widget edit context is present, return one complete replacement widget, never a patch or explanation. Preserve existing content, professional source format, library, palette, density, layout and terminology unless the instruction explicitly or implicitly requires a change. Apply the smallest complete modification. Source remains authoritative for semantics and the viewport shows visual/layout context.

## One-shot example

User sketches Client -> API -> Database and asks for an architecture diagram. Return one `html_widget` using the framework classes, with `diagramKind:"architecture"`, a suitable open `sourceFormat` such as `dot`, complete equivalent source in `copyText`, and `copyLabel:"Copy DOT"`.
