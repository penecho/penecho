# Sequence diagrams — sequence/1

Scope: only sequence diagrams/regions. Other Visual Explorer content keeps its own rules. Use `penecho_present_widget` with **sequence** instead of html or architecture. The local renderer owns coordinates, wrapping, lifelines, arrow styles, interaction and SVG/PNG export. Do not generate CSS/SVG, x/y, Mermaid or layout code.

Required: `{version:1,title,participants:[...],messages:[...]}`. Participants are left-to-right; messages are in logical time order. Keep one scenario readable; move implementation detail into details. Do not invent a return, async operation or parallel branch absent from the evidence. Vertical distance is not elapsed time.

Fields (`?` = optional; unknown fields rejected):
- `description?`: short context. `domains?`: `[{id,label,color?}]`; colors `blue|teal|orange|purple|green|slate`. Reuse domain IDs on participants and detail cards so colors correspond.
- `participants` (1–16): `{id,label,subtitle?,type?,domain?,details?:string[]}`. Unique IDs start with a letter, then letters/digits/_/-. `type`: `frontend|backend|database|cloud|security|messagebus|external`. Label ≤100 chars, subtitle ≤160; no geometry. Use concise role names, renderer wraps long labels.
- `messages` (1–120): `{id?,from,to,label,kind?,note?,details?:string[]}`. Endpoints reference participant IDs. `from===to` is a self-call. `kind`: `call` (default, solid filled arrow), `return` (dashed), `async` (solid open arrow). Label ≤120 chars; note ≤400. IDs are unique and needed only when a range references a message. Numbers are automatic.
- `activations?`: `[{participant,from,to}]`; from/to are explicit message IDs bounding active execution. Optional; do not infer activity merely because a participant exists.
- `fragments?`: `[{kind,label,from,to,branches?:[{from,label}]}]`; kind `alt|opt|loop|par|critical`. Range endpoints are inclusive message IDs. Label is the first condition/branch. For alt/par only, branches name subsequent operands starting at explicit message IDs, strictly ordered inside the range. alt operands are alternatives; par operands can overlap in time. Ranges must be disjoint or strictly nested (max depth 4); nested fragments cannot cross a parent's branch boundary.
- `details?`: `[{title,domain?,items:string[]}]` for explanations below the diagram. `notes?`: string array for assumptions or scope. Keep main labels short, put paths and long evidence here.

Minimal tool content (sessionId/artifactId/title remain OUTSIDE sequence):
```json
{"version":1,"title":"Request","participants":[{"id":"ui","label":"Client"},{"id":"api","label":"API"}],"messages":[{"from":"ui","to":"api","label":"Get report"},{"from":"api","to":"ui","label":"Report","kind":"return"}]}
```
For mixed documents only: ordinary HTML may contain `<section data-penecho-sequence><script type="application/json" data-sequence-source>SEMANTIC_JSON</script></section>`. Escape `<` as `\u003c` inside JSON. Keep surrounding content independent; do not load this rule for unrelated content. Read/patch the stored widget.html JSON source for edits, retaining artifact identity and user geometry.
