# Candidate v4 — full Visual Explorer context

Unchanged HTML rendered through MCP at 1939 × 1134 CSS px. **Rejected**.

This sample uses shared node helpers, but its edge data still includes malformed call arguments and independently invented endpoints. The CLI-startup edge passes numbers where waypoint pairs are required. A bounded Node VM execution with inert DOM stubs reproduced `TypeError: p.join is not a function`, consistent with the rendered partial graph after the Electron startup edge. No manual repair was applied.

Other defects: a local CLI is in an external-model boundary; Canvas data is drawn in the Node service; user confirmation and source paths remain separate main nodes; arrow routes pass through model/store boxes; no separate readable detail region. More graph structure in the source does not itself ensure a correct graph or valid rendering code.
