# Reproduced P1 PR integration — 2026-09-26

Only PRs #57, #59, #64, #66, and #68 are in scope. Each was gated on a failing local regression against the user's committed production source before any merge, followed by the same regression passing after the merge. These are bug fixes, not feature additions.

## Baseline and delivery boundaries

- Canonical checkout: `/Users/heack/workspace/penecho_071_version`.
- Baseline: `84972557965b3976707302a8ae8efcde850dc346` (`main`, already committed and clean at the start).
- Backup: `codex/pre-p1-20260926` at the same baseline.
- Integration branch: `codex/p1-reproduced-fixes`, created in the existing checkout. No clone or worktree was created.
- The five original contributor commits are retained through individual merge commits. No squash or cherry-pick was used.
- Final verified source commit: `d7c2cc483efd5e7aa5b1ad46cd30520dc54d33fe`. Local merge commits are `6b6d960` (#59), `9f88763` (#64), `f1dcdae` (#66), `de2c0d2` (#57), and `d7c2cc4` (#68); original author Divyam Talwar is preserved for all five PR commits.
- Excluded: #55, #56, #58, #65, #67, #69 and all other PRs. Previously fetched refs do not mean those changes are merged.
- Local implementation and verification only. No push, GitHub merge, Cloud synchronization, deployment, or restart of an existing service.
- Runtime for the recorded tests: Node.js `v24.19.0`, macOS. The local Homebrew Node 22 binary cannot start because its `libsimdutf.35.dylib` dependency is missing; Node 22 was not verified.

## Before / after evidence

Before merging, the five regression files were placed in the canonical checkout while production files remained at the baseline. After collecting failures, those temporary test-file changes were removed before merging the original PR branches. The exact same assertions were run after integration.

These tests execute the actual source functions in a controlled VM harness. Async completions are deliberately paused and resumed to reproduce race conditions deterministically. Server image tests write and reopen actual files in isolated temporary directories, which are cleaned up. Client DOM, rasterization, and IndexedDB dependencies are controlled test doubles; this is not a claim of manual browser, Electron, mobile, or deployed Cloud verification.

| PR | Original commit | Before | After: same original cases | Observed failure |
| --- | --- | --- | --- | --- |
| [#57](https://github.com/penecho/penecho/pull/57) | `8e10ad15d2859f4d10760f537c15e9a653189789` | 9 pass, 3 fail | 12 pass | A late text render repopulates a cleared canvas; overlapping restores retain stale work; a rejected stale render continues processing later items. |
| [#59](https://github.com/penecho/penecho/pull/59) | `48aa86891be8aaa41fc14fdb52debf4acdcdedf6` | 3 pass, 6 fail | 9 pass | V1 and V2 saves reject valid 1-, 40-, and 79-unit image frames with `Invalid shared canvas snapshot.` |
| [#64](https://github.com/penecho/penecho/pull/64) | `0ec0fd59927da4c2b54acfbbae30be012d0d2f47` | 4 pass, 5 fail | 9 pass | Fractional images at the right/bottom boundary save but reopen with `Stored canvas is invalid.`; client rounding also places accepted frames beyond the canvas boundary. |
| [#66](https://github.com/penecho/penecho/pull/66) | `df67ba1033a8609980ad03cc011fad798f912d7b` | 0 pass, 2 fail | 2 pass | Parking a current-format community import replaces the original document's `<p>Newer local edits</p>` with `<p>Published source</p>`. Legacy import also incorrectly inherits workspace feedback sequence 7. |
| [#68](https://github.com/penecho/penecho/pull/68) | `d2ed38c264995e565e42b845183aa112401b4a87` | 1 pass, 3 fail | 4 pass | Creating a new canvas during read leaves the load lock set; doing so during text rendering or legacy identity lookup allows stale loading to adopt the old document identity. |

Baseline total: **36 tests, 17 passed, 19 failed**. Final targeted total: **38 passed, 0 failed**, including the same original 36 cases and two added conflict-integration cases.

- [Raw baseline failures](before.tap)
- [Raw final targeted results](after.tap)
- [Test-file integrity hashes](test-integrity.json): four files are byte-identical before/after; the text test file only gains the two integration cases after its unchanged original content.

Trailing whitespace in the committed TAP transcripts is normalized; test results and assertion details are unchanged.

## Integration decisions

PR #57 and PR #68 conflict in `restoreTextBoxes`. The resolved code retains both independent cancellation conditions: the text list has been replaced, or the snapshot load is no longer current. Either condition returns `false`, releases a newly rendered stale raster, and avoids consuming the next text ID. Both checks also apply to rejected rendering promises. Successful restoration returns `true`.

Two extra regression cases cancel a load without replacing its text list, covering both successful and rejected raster promises. They ensure the #68 callback guard is independently necessary, while #57's existing overlapping-restore tests exercise list ownership with the default callback.

The existing UI source assertion was updated to expect the new `loadIsApplying` callback. `public/app.js` was regenerated from canonical sources with the official `npm run build:client` command, resolving the generated-file conflict.

For #66, the original PR test checked workspace metadata before reaching its data-loss assertion. The assertion order was strengthened before the baseline run: park the imported document and verify the original content first. This exact strengthened test is retained after merging; the original PR commit remains in history.

## Verification commands

Use Node 24 on `PATH`. The recorded runtime is available at `/Users/heack/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`.

```sh
node --test --test-reporter=tap \
  test/mcp-text-viewport.test.js \
  test/server-canvas-images.test.js \
  test/server-canvas-image-boundary.test.js \
  test/community-import-identity.test.js \
  test/snapshot-load-ownership.test.js
```

Individual merge gates also passed:

- #59: 9 image save/reopen cases.
- #64: 18 combined image save/reopen and boundary cases.
- #66: 101 community-import and canvas-document cases.
- #57: 133 text-viewport and UI-contract cases.
- #68: 256 combined targeted, canvas-document, and UI-contract cases before adding the two independent callback-cancellation cases; the final focused run covers both new cases.

```sh
npm run build:client
BROWSER=/usr/bin/true PHONE_HARNESS_TELEMETRY=0 npm run check
git diff --check
```

Full `npm run check` is **not green**. Canonical build-consistency and syntax checks passed, followed by 2,188 tests: **2,178 passed and 10 failed**. An exact baseline source archive was then tested with the same Node 24 runtime and dependency versions: 2,159 tests, **2,148 passed, the same 10 failed, and 1 skipped**. The temporary baseline test copy was removed afterwards.

The baseline-only skip is the Cloud sibling-checkout allow-list test, because the temporary test directory has no adjacent Cloud checkout; that test passes in the canonical checkout. The extra 29 tests in the integration branch account for the other increase in passing cases. The build embeds dependency-relative paths, so the baseline fixture copied the installed `diff` package locally instead of symlinking that package; no dependency installation or source regeneration was needed for the comparison.

All ten failure names, source locations, and first error messages match between baseline and integration. [The comparison record](full-check-comparison.json) includes both counts, all failure identities, and hashes of the full raw logs. The failures cover existing agreement-checkbox CSS expectations, three rename/save tests (including a missing `Event` test global), two MCP Follow tests, the pen test's missing helper, widget wheel expectations, selection-toolbar markup, and a static-style assertion. They are left outside this narrowly selected PR integration; no failing test was disabled or its assertion relaxed to obtain a pass.

The full raw logs are retained for this local session at `/tmp/penecho-p1-reproduced-20260926/check.log` and `/tmp/penecho-p1-reproduced-20260926/baseline-check.log`. The durable comparison record and targeted raw logs above are committed with this report. No new full-suite failure was observed; that is different from claiming that the repository's full suite passes.

## Impact and further release acceptance

The following manual scenarios are recommended before release; they are not represented as already performed browser tests.

| PR | Scope and relative regression risk | Manual acceptance scenario |
| --- | --- | --- |
| #57 | Medium: shared text restoration, including snapshot restore and history restoration. Text layout and normal quality refreshes remain covered by automated tests. | Open a text-heavy canvas, immediately clear or switch to another canvas, and wait. Old text must not reappear. Then test Undo/Redo and zooming to check text placement and clarity. |
| #59 | Low: server image frame validation for V1/V2 persistence. Existing raster size, format, coordinate, and payload limits remain enforced. | Save/reopen 1-, 40-, 79-, and 80-unit images; compare position and content. Invalid zero/negative/out-of-bounds frames must still be rejected. |
| #64 | Low to medium: image coordinate normalization in both client and server; touches persisted geometry. | Use fractional image width/height at the right edge, bottom edge, and corner. Save and reopen twice. Images must remain within bounds and reopen successfully. |
| #66 | Medium to high: community import document identity and workspace metadata. The consequence of regression is source-data overwrite. | Publish a canvas, make further local edits, import its published community copy while the source is still open, then switch/park/save both. The source must retain its newer edits; the import must have a different document ID and empty agent bindings/workspace while preserving community lineage. Repeat with a legacy bundle. |
| #68 | Medium to high: the shared snapshot-load/new-canvas lifecycle and document adoption, used by device/server/cloud locations. | Under slow loading, create a new canvas during read, text rendering, and identity lookup. It must remain blank with its own identity, the loading lock must clear, and a subsequent normal load must succeed. Check rapid repeated transitions as well. |

These changes prevent the reproduced failures prospectively. They do not reconstruct content previously overwritten by #66 or repair existing invalid image snapshots automatically.
