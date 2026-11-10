# Workflow diagrams — workflow/1

Scope: only workflow/process diagrams or workflow regions. Keep other Visual Explorer content and diagram rules independent. Use `penecho_present_widget` with **workflow** instead of html, architecture or sequence. The browser owns layout, measured text, orthogonal routes, interaction and SVG/PNG export. Provide semantic JSON only: no coordinates, SVG/CSS, Mermaid, column numbers or routing code.

Required: `{version:1,title,nodes:[...],edges:[...]}`. Describe one useful process, with concise activities and explicit conditions. Show evidenced alternatives, retries and parallel work; do not invent them. A workflow explains what happens next; use sequence for ordered messages between participants, architecture for system structure.

Fields (`?` optional; unknown fields rejected):
- `description?`: short context. `domains?`: `[{id,label,color?}]`, colors `blue|teal|orange|purple|green|slate`. Reuse domain IDs on nodes, groups and details for consistent colors.
- `nodes` (1–60): `{id,label,type,subtitle?,domain?,group?,details?:string[]}`. **type is required**: `start|process|decision|fork|join|end`. Unique IDs start with a letter, then letters/digits/_/-. Label ≤100 chars, subtitle ≤160. Start/end mark boundaries, process is an action, decision selects a conditional branch, fork starts parallel branches, join waits for them. A plain process can merge alternative incoming branches without implying parallel synchronization.
- `edges` (0–120): `{id?,from,to,label?,kind?}`. Endpoints are node IDs. kind `flow` (default) or `loop` (retry/return, dashed). Every decision needs at least two outgoing edges with distinct condition labels. Every cycle must mark its returning edge `loop` and explain the retry condition in its label. Start has no incoming edge; end has no outgoing edge. Fork has ≥2 outgoing edges; join has ≥2 incoming edges. Other nodes have at most one outgoing edge. Never use an unlabelled branching process to hide a decision.
- `groups?`: `[{id,label,domain?,parent?}]` for real responsibility or process boundaries. A node's group must exist. Use groups only when their boundary matters; they are not compulsory swimlanes or layout rows.
- `details?`: `[{title,domain?,items:string[]}]` below the diagram; `notes?`: string array. Put long evidence and implementation detail here or in node details. `direction?`: `RIGHT|DOWN` only when the user requests orientation; otherwise omit and let available width guide layout.

Minimal content (sessionId/artifactId/title stay OUTSIDE workflow):
```json
{"version":1,"title":"Review","nodes":[{"id":"submit","type":"process","label":"Submit"},{"id":"check","type":"decision","label":"Approved?"},{"id":"done","type":"end","label":"Complete"},{"id":"edit","type":"process","label":"Revise"}],"edges":[{"from":"submit","to":"check"},{"from":"check","to":"done","label":"Yes"},{"from":"check","to":"edit","label":"No"},{"from":"edit","to":"submit","label":"Resubmit","kind":"loop"}]}
```
For a mixed document, ordinary HTML may contain `<section data-penecho-workflow><script type="application/json" data-workflow-source>SEMANTIC_JSON</script></section>`. Escape `<` as `\u003c` in embedded JSON. No nested iframe. Edit the stored widget.html JSON through read/patch, preserving artifact identity and user geometry. This rule does not apply outside workflow regions.
