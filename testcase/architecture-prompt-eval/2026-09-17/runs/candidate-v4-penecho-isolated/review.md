# Candidate v4 — isolated architecture context

Unchanged HTML rendered through MCP at 1939 × 1134 CSS px. Scores: entities 2, boundaries 1, relationships 0, hierarchy 1, geometry 1 = **5/10, rejected**.

Compared with the full-context sample, this result has simple named entities, a clear browser/Node boundary, compact separate details, and a working node/edge helper. Total API input dropped from 4463 to 1005 tokens. This single pair suggests an interference/over-specification hypothesis; it does not establish causal reliability or prove other prompts cannot work in the full context.

Unresolved defects:

- HTTP API → Canvas AI is missing. Canvas Agent points to Canvas AI rather than its own model connection.
- Widget and IndexedDB are unconnected at the selected abstraction level.
- The Electron → Node route passes through the CLI box, visually implying a false intermediate step.
- MCP and startup labels overlap, and the bidirectional WebSocket marker/port placement is inconsistent.
- Fixed max-width and upper blank space make essential labels small.

This output is the source for a separately labeled model repair. `review-feedback-penecho-v4.md` records the case-specific defects supplied for that repair; those corrections are not added to the generic architecture prompt.
