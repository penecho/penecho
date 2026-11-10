# Architecture · local renderer / 1

Scope: architecture diagrams only. Other visual types and mixed-document regions retain their own rules. The browser owns layout, routes, wrapping and styling. Do not generate diagram SVG, coordinates, CSS or rendering code.

Call `penecho_present_widget` with `architecture:{...}` instead of `html`, plus the normal sessionId, artifactId, title and requestId. Existing HTML widgets remain supported.

Choose the viewpoint and abstraction level before extracting entities:
- Default to no more than 20 entity nodes in the main architecture view. This is a soft ceiling, never a target; use fewer when sufficient. Count nodes across all groups, not separately per group. Frames, labels and detail text are not entity nodes.
- Keep nodes at a consistent level of responsibility: major actors, applications, services, data stores and external systems relevant to the user's question. A file, class, function, endpoint, helper or configuration item is not automatically a node; fold subordinate implementation facts into the owning node's `details` or a shared detail card unless that item is essential to the requested viewpoint.
- Preserve the main control/data paths and meaningful responsibility, deployment and trust boundaries. Keep distinct components when merging would misrepresent those relationships. Show relevant dependencies and branches; omit repetitive incidental calls and explain material omissions once in `notes`. Do not replace a dense graph with a vague chain or merely hide dozens of small nodes inside groups.
- Exceed 20 only when the user explicitly requests that level of detail or when additional entities are necessary to answer accurately. First try coherent aggregation; if more nodes remain necessary, briefly state why in `notes`. Professional appearance alone does not require exhaustive extraction. Do not split one topic into extra diagrams merely to meet the count, or remove required entities from an existing diagram during an unrelated edit.

Required fields inside architecture:
- `version:1`, `title:string`, `nodes:Node[]`, `edges:Edge[]`.
- Node: `{id,label}`; optional `subtitle`, `domain`, `group`, `type`, `details:string[]`. Types: `frontend|backend|database|cloud|security|messagebus|external`; default backend. Use a short name and role line; put mechanics and evidence in details.
- Edge: `{from,to}` referencing node IDs; optional `id`, short `label`, `kind:call|data|config|optional|return` (default call), `bidirectional:boolean`.

Optional top-level fields:
- `description:string`; `direction:RIGHT|DOWN` when the subject warrants one.
- `domains:[{id,label,color?}]`, color `blue|teal|orange|purple|green|slate`. Reuse domain IDs in nodes, groups and detail cards for matching color.
- `groups:[{id,label,domain?,parent?}]`: actual process, responsibility, deployment or trust boundaries. Nodes refer through group; nested groups through parent. A frame does not imply a separate server.
- `details:[{title,domain?,items:string[]}]`: explanation cards below the map. Avoid copying their text into every node.
- `notes:string[]`: whole-diagram qualifications, e.g. omitted return traffic or optional scope.

IDs start with a letter and use letters/digits/_/-. Node and group IDs must be unique, references must exist, and groups cannot be empty or cyclic. Limits: 60 nodes, 120 edges, 20 groups, 20 detail cards, 60,000 characters. These are safety limits, not targets: choose the smallest meaningful view and put secondary facts in details.

Model discretion governs viewpoint, abstraction and topology. Show actual relationships, including branches and independent paths; a feature list or stack of layer boxes is insufficient. If A calls B and B reads S, show A→B and B→S, not A→S→B. Frames are not endpoints. Semantic domain colors identify responsibility and link the map to details; color is not arbitrary position.

Example:
```json
{"version":1,"title":"Request path","domains":[{"id":"app","label":"Application","color":"blue"},{"id":"data","label":"Storage","color":"purple"}],"groups":[{"id":"service","label":"Service process","domain":"app"}],"nodes":[{"id":"client","label":"Client","domain":"app"},{"id":"api","label":"API","group":"service","domain":"app"},{"id":"db","label":"Database","domain":"data","type":"database"}],"edges":[{"from":"client","to":"api","label":"Request"},{"from":"api","to":"db","label":"Read/write","kind":"data"}],"details":[{"title":"Storage","domain":"data","items":["Durable state."]}]}
```

For mixed content in one widget, embed the same JSON in `<section data-penecho-architecture><script type="application/json" data-architecture-source>…</script></section>` within HTML. Escape `<` inside JSON strings as `\u003c`. Other content surrounds the section in the same document; no nested iframe. Do not load CDN or Archify scripts yourself.

Source stays in the widget's existing virtual `widget.html`. Read and patch its JSON block with the current contentHash. Add/remove nodes and their incident edges together; local layout reruns after the patch. Click a node for details and related edges. SVG/PNG export includes only the main diagram. Verify the canonical capture when visual evidence is needed and retain historical comparison canvases.
