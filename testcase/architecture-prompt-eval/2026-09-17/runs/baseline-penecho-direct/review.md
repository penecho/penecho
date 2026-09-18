# Baseline — original model output

Rendered unchanged through PenEcho MCP. Viewport: 1939×1134 CSS px; returned
capture: 1440×842, `pixelVerified:true`. Canvas artifact: `eval-a-baseline`.

Scores: entities 1, boundaries 1, relationships 0, hierarchy 1, geometry 0.
Total: 3/10; not acceptable.

Observed defects:
- Connector text and arrowheads are visibly stretched horizontally. Source uses
  `preserveAspectRatio="none"` for a narrow SVG expanded into a wide grid cell.
- The map has three grid columns but four top-level children. The external
  group falls onto a separate row with no entity-level connections.
- Main relationships stop near whole group regions rather than named entities;
  essential external model and external MCP links are only described in prose.
- Compact entity labels are mixed with implementation inventories; the large
  map does not make productive use of its whitespace.
- The frame named external services also contains a local CLI subprocess,
  mixing external-service and process boundaries without explanation.

The model completed in 59.76 seconds, with reported input/output usage 4559/4826
tokens. `thinking.type=disabled` was requested, but the provider still returned
191 thinking deltas. No hidden reasoning content was persisted.
