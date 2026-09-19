# Scoped visual authoring rules

Visual Explorer's base contract stays independent of specialized diagram rules.
MCP and the built-in PenEcho Agent use the same `penecho_get_guidance` loader.

The current architecture body is R9, evaluated with real GLM-5.3-Flash outputs
and PenEcho MCP captures. The tested MCP diagram passed after model repairs
guided by rendered evidence; independent first-pass reliability is not proven.
Use the rule together with its render/review step. Raw model runs, failed versions
and captures are local-only evaluation evidence. Deterministic semantic inputs
for renderer regressions live in `test/fixtures/diagrams/`; automated tests do not
require the original model requests or browser sessions.

## Authoring flow

1. Read `penecho_get_guidance({"id":"visual-explorer"})` when the task selects
   Visual Explorer. It returns the complete base contract plus a compact rule
   catalog, never all rule bodies.
2. Read only a matching rule, currently
   `penecho_get_guidance({"id":"architecture"})`, for that visual region.
3. Apply the rule to the matching region of the current artifact. Other regions
   and later unrelated tasks retain their own contracts. Reuse a rule already
   read at the same hash; do not infer a permanent global mode from that read.

Rules are prompt documents, not renderers or permission grants. They introduce
no Widget type, required metadata marker, schema for diagram data, or runtime
dependency. Existing HTML/CSS/SVG rendering and saved artifacts are unchanged.

## Add one rule

Register its unique ID, title, scope and base in
`src/server/canvas-agent/visual-rules/registry.json`, and put the body in
`src/server/canvas-agent/visual-rules/<id>.md`. Do not embed its body or detailed
layout constraints in the general Visual Explorer contract or global tool
instructions. Sequence, Gantt and slide rules can each be added this way; they
are not advertised until implemented.

The registry is metadata only. The loader reads and caches a body only when its
ID is requested; each body has its own content hash and a 16 KB limit. Brief and
full requests for a compact rule return the same complete body. Unknown IDs are
rejected rather than mapped to a different rule. Registering a rule changes the
discovery catalog, not another rule's content or cache.

Loading returns tool-result context; it does not rewrite an Agent system prompt
or add a persistent session-wide rule. An external model can still retain a
previous tool result in its conversation history, so the documented scope must
remain explicit. Isolation of the loader is testable; perfect obedience by every
external model is not guaranteed by a file boundary.

## Validation

```sh
node --test test/mcp-scoped-guidance.test.js test/mcp-guidance.test.js \
  test/canvas-agent-visual-contract.test.js test/canvas-agent-visual-skills.test.js
```

This checks lazy body reads, unchanged unrelated guidance, shared MCP/Agent results,
and existing scientific runtime gates. Diagram quality also requires real model
outputs and browser pixel review. Keep original outputs and distinguish fresh
generations from model repairs.

New files are part of the formal `src` tree and included by the existing desktop
packaging rules. Cloud delivery still requires the official Canvas-to-Cloud
sync and deployment; a local rule edit does not update an already-running Cloud
MCP connection.
