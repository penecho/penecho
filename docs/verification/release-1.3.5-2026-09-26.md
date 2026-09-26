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
