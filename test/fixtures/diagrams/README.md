# Deterministic diagram fixtures

These files contain semantic inputs consumed by the automated diagram tests.
They are self-contained: no running Canvas, model provider, personal directory,
session record, screenshot, or ignored `testcase/` artifact is required.

| Directory | Coverage |
| --- | --- |
| `architecture/` | MCP boundaries, return-edge direction, compound groups, and routing/reflow regressions. `routing-baseline.json` retains only the three numeric thresholds read by the tests. |
| `sequence/` | MCP requests, synthetic payments and background jobs, and nested fragment labels. |
| `workflow/` | Linear, conditional, retry, parallel, grouped, and input-order regressions. |
| `regression/` | Original model sets and 65 later semantic diagrams, with the same tested viewport widths. |

The later diagram inputs were extracted from browser readbacks and HTML source
envelopes. Only `kind`, `title`, `model`, and `widths` remain; object/document/session
IDs, HTML wrappers, capture metadata, and source hashes are not test inputs.
The semantic models and regression assertions are unchanged by this extraction.

Run from the repository root:

```sh
node --test test/architecture-runtime.test.js test/architecture-reflow.test.js test/sequence-runtime.test.js test/workflow-runtime.test.js test/native-diagram-regression.test.js test/latest-canvas-diagrams.test.js
```

Keep new fixtures small, deterministic, and anonymous. Store generated results,
raw requests/responses, screenshots, and traces in ignored `test-results/` or
`testcase/` directories, not beside these fixtures.
