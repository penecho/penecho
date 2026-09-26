# Combined 1.3.5 release verification

The release candidate includes the existing 16 local commits beyond remote `main` (`1ea981cae61576712b965939360038944107dbdb`), plus the reproduction-gated merges of PRs #57, #59, #64, #66, and #68. Package and desktop versions remain `1.3.5`. The original contributor commits and merge ancestry are preserved.

The previous [PR integration report](p1-pr-2026-09-26/README.md) records the state before this release-preparation step, including ten pre-existing test failures. Those failures are addressed here through test maintenance; no additional product source changes were needed.

## Test maintenance and evidence

- Supply the browser `Event` and `window.dispatchEvent` APIs to the save/rename VM harness. The real save, identity, failure, and preview-fallback assertions remain intact.
- Supply the MCP tab's `dataset` to the workspace harness. The Follow preference and canvas-switch assertions remain intact.
- Supply the Agent send-availability presentation helper to the pen harness. Pointer ownership, palm rejection, ink preservation, and capture release are still asserted.
- Match the consent panel's symmetric padding introduced in existing local commit `b5a826f`, preserving the single-consent, external-link, accessibility, and preview assertions.
- Parse nested sections when locating the selection toolbar inside the viewport. The old regular expression stopped at the welcome panel's inner closing section. Toolbar accessibility and layer ordering assertions remain intact.
- Retain the prohibition on regular canvas wheel forwarding while allowing the existing maximized presentation handler. `widget-host-presentation-size.test.js` verifies native scrolling outside presentation, nested scrollers, modified wheel events, and document-scroll forwarding.
- Correct the CSP assertion to prohibit inline style attributes, whole-style assignment, and `cssText`, rather than all individual CSSOM property changes. Individual properties are allowed under strict CSP, as documented by [MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/style-src-attr#violation_cases). The server's strict policy and prohibition on `unsafe-inline` remain asserted.

## Completed local verification

Runtime: bundled Node.js `v24.19.0` on macOS.

- Related test suites: **169 passed, 0 failed**.
- Full canonical `npm run check`: **2,188 passed, 0 failed, 0 skipped**; generated assets and syntax checks also passed.
- `git diff --check`: passed.
- The five PR reproduction suites and both conflict-integration cases remain part of the complete passing test run.
- No package version bump and no changes to the release workflows, runtime code, Cloud checkout, or existing services were made in this release-preparation step.

Commands:

```sh
node --test test/empty-canvas-rename.test.js test/mcp-workspace-actions.test.js \
  test/pencil-writing-lifecycle.test.js test/cloud-connect-ui.test.js \
  test/plugin.test.js test/selection-ui.test.js test/widget-host-presentation-size.test.js
node --test --test-name-pattern='static page keeps strict styles' test/server-security.test.js
BROWSER=/usr/bin/true PHONE_HARNESS_TELEMETRY=0 npm run check
git diff --check
```

Local raw logs: `/tmp/penecho-p1-reproduced-20260926/release-test-adapters.log` and `/tmp/penecho-p1-reproduced-20260926/release-check.log`.

GitHub publication must use this combined source history. Node 22/24 CI and installer build/signing results are separate from the local test result above. These tests do not claim manual browser, packaged-app, mobile-device, or deployed Cloud acceptance.

## Save-copy name follow-up (2026-09-27)

The user reported that saving a named Device canvas to Server or Cloud lost its name. The history Save copy action calls `saveSnapshot()` without an explicit name. When creating a storage record, its fallback ignored `currentSnapshotName`, producing an empty Server/Device name or `Untitled Canvas` on Cloud. The same fallback exists in the pre-PR baseline `8497255`; it was not introduced by the five P1 merges.

The canonical persistence code now retains an explicitly named canvas's existing name for a new storage record. An entered name still takes priority, generated suggestions still work, and genuinely unnamed canvases retain their original fallback. Existing long imported names are retained without truncation. The client bundle was regenerated with `npm run build:client`; versions remain `1.3.5`.

The save/rename harness now executes the production history action, save function, bundle serialization, and Server/Cloud request builders. Storage/network responses and preview encoding are isolated test doubles. Nine additional cases cover the three save destinations, name priority, unnamed fallbacks, and long existing names, including the outbound Cloud name and bundle name, current title, original record preservation, and copy identity request.

- Before the production fix: **14 tests, 10 passed, 4 failed**, including the reported Cloud `Untitled Canvas` result and empty Server/Device names.
- After the fix, with the same tests: **14 passed, 0 failed**.
- Full canonical `npm run check` on Node.js `v24.19.0`: **2,197 passed, 0 failed, 0 skipped**, including generated-asset and syntax checks. Log: `/tmp/penecho-save-name-check-unrestricted.log`.
- Focused command: `node --test test/empty-canvas-rename.test.js`.
- Local before/after logs: `/tmp/penecho-save-name-before.tap` and `/tmp/penecho-save-name-after.tap`.

The initial full check was blocked by sandbox `listen EPERM` errors in local service tests. The full check was rerun with permission to start those isolated test services. No live Cloud writes, existing-service restarts, or deployments were performed during local verification. The user subsequently confirmed successful testing and authorized committing and pushing this fix to the existing `codex/p1-reproduced-fixes` branch and PR #71.

Manual release acceptance: save a named Device canvas to Server and Cloud with the optional name field empty, then close/reopen each copy and verify its title and content. Confirm the Device original remains available. Repeat once with an explicit new copy name and verify that the new name takes priority.
