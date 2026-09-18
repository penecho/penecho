# Candidate v6 — PenEcho with actual viewport

Unchanged model HTML rendered at 1939 × 1134 CSS px. **Rejected; improvement worth retaining.**

Positive: main routes are now horizontal/vertical; main graph uses the available width; simple entities and named frames remain; blue/green/purple detail accents match the associated main groups. This iteration also supplied the actual viewport, so its improvement cannot be attributed solely to the prompt wording.

Remaining defects:

- Model-call and return arrows at y=179/206 attach to HTTP API, while the specified caller is Canvas AI at y=257..307.
- The return label is too long for the routing gap and intrudes into adjacent component/frame space.
- Canvas Agent's own model connection is missing.
- MCP's browser endpoint stops at x=426 instead of the intended Canvas entity's right outline x=400.
- Orange external/model nodes have no corresponding orange detail card.

The generated source uses static SVG despite comments describing table-driven nodes/edges; do not mistake these comments for an implemented data-driven renderer.

See `review-feedback-penecho-v6.md` for the bounded feedback used in the separately labeled model-authored patch test. That repair is not a one-shot generation sample.
