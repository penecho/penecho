# Workflow, sequence labels, and MCP artifact capture

Fixtures retain only the semantic diagram inputs from the reported W02, W04,
W07, W09 and nested sequence examples. No session IDs or authentication data
are included.

Run `node testcase/mcp-layout-capture/2026-09-18/harness.cjs` from the 071 project,
then open the printed loopback URL. The fixture server serves the production
Widget host and generated diagram runtimes; it does not start PenEcho or open
user documents. “运行宽窄验收” saves full-document and viewport PNGs and dimension
reports for all five fixtures at 2011 × 600 and 390 × 600 CSS pixels.

Verified:

- All 10 real-browser width/fixture combinations rendered and captured.
- Full-document capture includes the lower detail cards and notes. Widget
  geometry remains unchanged. Narrow diagrams retain their intended inner
  horizontal scrolling, explicitly reported by `overflow.x`.
- W02 was additionally scrolled to the bottom before capture. Its saved wide
  full PNG still starts at the title; its paired viewport PNG shows the bottom.
  This confirms capture does not reset the user's scroll position.
- Workflow start placement and main-flow direction, including reversed input
  node ordering, passed geometry tests. Nested sequence titles/branch labels
  avoid lifelines and long-lived activation bars.
- 64 focused tests and 145 related regression tests passed. Generated client,
  workflow and sequence build checks passed, as did `git diff --check`.

The rendered pass covers the widths above. A separate 200% browser-zoom pass
was not completed: the in-app browser shortcut did not change zoom, and the
native Edge check was abandoned when user activity was detected. No user
Canvas or browser zoom setting was changed.

Delivery is local to `/Users/heack/workspace/penecho_071_version` on
`codex/update-localization`. Cloud's official selective `--check` commands
confirm the client and MCP runtime mirrors still differ; no Cloud sync,
application restart, commit, push, or deployment was performed for this change.

Focused test command:

```sh
node --test test/widget-full-content-snapshot.test.js test/mcp-canvas-runtime.test.js test/mcp-bound-operations.test.js test/workflow-runtime.test.js test/sequence-runtime.test.js
```
