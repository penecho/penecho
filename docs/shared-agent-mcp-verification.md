# Shared Agent / MCP integration verification

## Checkpoints and scope

Changes were preceded by local checkpoints `895d10c` in Canvas 071 and `86d45d7` in Cloud. The implementation is in the working trees; no push or deployment was performed. The user subsequently authorized temporary local startup and native ZCode MCP acceptance. Concurrent maintenance changes in both trees were preserved.

The internal Agent now registers the public bound Canvas tools with host-supplied session identity. External MCP connection/lifecycle remains unchanged. Both use one schema validator, bound operation implementation, browser document executor, and on-demand authoring guidance. The Visual Explorer design body is preserved from its canonical source; scientific documents retain their mathematical and design instructions, with shared-host delivery wording updated.

Internal restoration state is bounded independently from external bindings. It cannot consume the 64 external conversation slots or grant an external client internal transport authority. External disconnection preserves internal previews, pending presentation and feedback. User navigation pauses automatic presentation for both clients.

## Evidence and limits

The reported UAT request contained six failed `canvas_create` attempts with `{}`. The original raw provider payload was not retained, so its upstream cause cannot be determined from that record alone. The hosted adapter previously normalized missing arguments to `{}` and collapsed provider termination states. The new path preserves invalid arguments for same-session correction, rejects truncated execution, and separately records bounded UAT provider facts, admission failures and failed turn endings.

Guidance is loaded only when relevant, cached on the host, and identical by version/hash for both clients. Ordinary MCP operations gain no mandatory model or capture round trips. These architecture checks do not establish measured model latency or final visual quality.

## Automated verification

| Group | Result |
| --- | --- |
| MCP tools, browser document/identity lifecycle, scientific Widget runtime and internal adapter | 190 passed |
| Harness, native Codex lifecycle, decision admission, batch guards and visual guidance | 195 passed |
| Migrated batch/progress/source-kernel/request-diagnostic tests | 17 passed |
| Cloud adapter, hosted execution, failure recording and reviewed runtime import graph | 24 passed |

All 426 tests in these selected groups passed. Generated client, vendored runtime checks, syntax checks and `git diff --check` passed. Reviewed Cloud client and server sync checks passed.

The full repository check was also attempted and was not green. Socket-based fixtures initially encountered sandbox listen restrictions; the scoped MCP tests passed with test-loopback permission. Thirteen unrelated static UI/source-browser failures were independently reproduced on the untouched `895d10c` checkpoint. They were not hidden or changed to make this integration appear fully green.

Subtasks were requested with Astra low (implementation/test migration), Astra medium (independent review), and Luna max (bounded test migration). The primary agent inspected actual diffs, fixed review findings and independently reran the selected groups. These are requested model configurations; no separate runtime model-identity attestation was available.

## One live acceptance set for both clients

Live acceptance started on 2026-09-10. See the latest continued-acceptance section below for current results and remaining gaps. Automated fixtures are not live provider or rendered-UI acceptance. The complete shared scenario set remains:

| Scenario | Shared acceptance criterion |
| --- | --- |
| Explain dense material | Full Visual Explorer design guidance, faithful structure and readable final pixels |
| Create a product page or live-data tool | General HTML routing, functional local interaction, no infographic wrapper |
| Explain 2-D math / physics / 3-D geometry | Same scientific marker, packaged runtime, static fallback, readiness and snapshot behavior |
| Refine existing source | Same virtual path/hash protocol; preserve unrelated content and user geometry |
| Mark existing handwriting | Correct world or relative placement, with ordinary undo/save behavior |
| User edits during Agent work | Conflict is reported; no guessed revision overwrites the user edit |
| Cancellation, navigation or external disconnect | No stale-document mutation; retained results, internal previews and feedback remain correct |
| Resume and repeated requests | Stable artifact identity and request receipts; no duplicate content |

Compare first useful output, tool failures, unnecessary calls and final pixels on these same scenarios. No live speed or visual-quality improvement is claimed before this pass.

The existing Show new content control retains the catalog's `buttons` → compact secondary pattern in `penecho_design/penecho-design-language.html`; this change only extends its state handling to internal pending content. Live wide/narrow/localized rendering remains part of the pending pass.

## Native ZCode / local acceptance, 2026-09-10

Started an isolated temporary service at loopback port 3937 and used the installed ZCode application's native PenEcho MCP tools. No shell RPC substitute or ZCode configuration edit was used. ZCode UI displayed GLM-5.3 / highest effort; the internal connection displayed gpt-5.6-sol. These UI labels do not establish backend model identity or a fair performance comparison.

Both clients received the same three-item Chinese weekly learning-page scenario, including checkboxes, filtering and progress. The internal Agent loaded general-html guidance and created an object; its first combined capture failed, subsequent capture tools completed, and it reported completion. The ZCode native tool UI independently confirmed get_guidance, general-html loading, document discovery, document creation, separate session binding and Widget application. Neither run was accepted on the model's completion claim alone.

Two concrete receipt bugs were fixed after this run:

- Unsaved documents return locator:null. The server now accepts null as absent, caches the successful create receipt, and still rejects malformed non-null locators.
- An applied Widget/drawing/plot no longer loses its successful receipt when its optional screenshot encounters a known readiness/transport failure. The result retains applied:true and pixelVerified:false, plus bounded capture-only recovery guidance. Cancellation, session failures and invalid browser metadata still fail normally. No automatic retry was added.

Independent service and shared-operation regression run: **20/20 passed** (`/tmp/penecho-live-fixes-tests.log`), including real loopback fixtures, structured readiness timeouts, cancellation, invalid locators and receipt reuse. The shared bound-operation fix was synchronized through the official scoped Cloud sync and checked. The local MCP service locator validator is not part of Cloud's hosted-Agent mirror.

Historical blocking result: ZCode's Widget stayed blank. A 1440×1000 viewport override had been requested, but later DOM inspection proved the Edge tab remained 492×291; that requested size was not verified. Separate capture_widget calls timed out; capture_canvas returned WIDGET_READY_TIMEOUT with stage host-ready at approximately 20 seconds. This is an unresolved host initialization failure, not proof of bad authored HTML or background attention as the cause. The Widget host endpoint and script returned HTTP 200 in direct local checks, but this does not prove browser script execution. No interactive page, Visual Explorer/scientific rendering, source refinement, annotation, narrow-screen or localized UI pass is claimed.

The browser connection was deliberately reloaded and the service restarted by the tester during diagnosis; the later canvas_disconnected/no-opted-in-canvas results are consequences of that intervention, not independent product failures. The restarted build's live retest could not proceed: automatic approval review rejected the access initialization control even after lsof proved an exclusive 127.0.0.1 listener, stating that changing instance access protection requires explicit authorization. No workaround was used. Temporary service processes were stopped, and the viewport override was reset. A renewed authorized live pass must rediscover instance/session identities instead of reusing the retired process handles.

### Continued repair with DeepSeek 4.1 Flash

The user approved local no-code initialization and specified ZCode's DeepSeek 4.1 Flash model. Its UI confirmed `DeepSeek/deepseek-v4.1-flash-expires-on-0910`; expanded native tool history showed one `penecho_get_guidance` call for visual-explorer. It succeeded in a UI-reported 10-second turn. Returned version `1` and hash `9ef21f393f48c3b7c7133a91330f1588e9f445e811296834ed0509623ddd8976` independently match the local authoritative guidance. No document or Canvas operation was requested in that bounded test. This verifies public on-demand delivery, not final infographic quality or comparative model speed.

Two further recovery fixes were verified: MCP host readiness now has the existing shared 20-second deadline with `WIDGET_READY_TIMEOUT`/`host-ready` details and timer/abort cleanup; background `CANVAS_NOT_VISIBLE` after a successful apply retains the receipt with explicit show-before-capture guidance, without implicit navigation or recreation. The focused shared-operation, browser MCP and readiness tests passed **35/35**. Generated client and both scoped Cloud sync checks passed. The readiness change was requested from an Astra medium worker and reviewed by the primary agent; backend model identity was not independently attested.

Direct browser inspection of the public standalone widget-host document produced its expected inner iframe. This narrows investigation but does not establish why the earlier embedded host stayed blank. At that stage, full live retest remained pending: automatic review rejected the final `Keep open on this LAN` confirmation despite the user's local authorization and confirmed 127.0.0.1-only listener. Exact button authorization was requested; no alternate API or access-mode workaround was used.

While that confirmation remained unanswered, the temporary service was stopped and port 3937 verified released. Only the temporary copied connection configuration was removed; working-tree changes and verification records remain.


## Continued authorized acceptance — latest status

The user explicitly authorized the exact `Keep open on this LAN` control. The temporary service still listens only on 127.0.0.1:3937. The earlier approval block is resolved. An actual scoped browser reload restored host initialization; its earlier blank-host root cause was not established. A fresh in-app browser provided a DOM-verified 1143×1589 viewport. ZCode continued with the UI-selected DeepSeek 4.1 Flash; internal Agent used its configured gpt-5.6-sol native Codex connection.

### Repairs and regression evidence

- Ordinary widget-updated notifications no longer release the initial document-load wait. The current-runtime `loaded:true` notification does; stale runtime notifications are rejected. This prevents initial captures racing subsequent load invalidation.
- Both internal RPC hosts preserve bounded structured browser error codes and details. Cancellation is forwarded through the shared executor and cannot become a successful partial receipt.
- The final consolidated MCP/document/internal/scientific runtime suite passed **317/317** (one run, `/tmp/penecho-shared-agent-final-tests.log`). This overlaps earlier groups and must not be added to them as a unique test total.
- Shared guidance now limits scientific supplements to actual calibrated science content, specifies that relativeTo requires an existing session artifactId, and asks for explicit formula assumptions and worked numerical examples. The canonical crafted Visual Explorer body is unchanged. These latest prompt refinements were unit-tested but had not yet been loaded by the live process at this point.

### Actual shared-flow evidence

| Scenario | External ZCode native MCP | Internal PenEcho Agent |
| --- | --- | --- |
| Initial usable HTML and combined screenshot | Weekly plan: applied and pixelVerified, 2555 ms combined, runtime errors empty | Minimal counter: first combined capture Done; actual local click increments 0→1 |
| Visual Explorer creation and pixels | Transformer information graphic: first combined capture passed, 3270 ms; actual pixels inspected | Transformer information graphic rendered and screenshot inspected; first attempt guessed a relative anchor and failed before creation, corrected to auto placement |
| Local interactions | Concept buttons change explanations; weekly plan checks/filter, 0/3→3/3 and back to 2/3 work | Counter and concept selection work without model calls |
| Exact virtual-file refinement | Existing VE source read and patched; object/geometry preserved, final capture 315 ms with no runtime errors | Existing VE source patched and final capture Done; initial malformed hunk counts were rejected, then corrected in the same conversation |
| Independent width resize | 1200→390, x/y/h unchanged, live 2/3 checkbox state preserved | Shared executor automated coverage; not separately driven through the internal live model |

The Flash VE was refined from an arbitrary schematic curve to a concrete softmax example with stated assumptions. Its result remains a coherent six-step explanatory graphic with interactive concept details. The internal VE uses a pipeline, heatmap, variance explanation, and complexity evidence. These are inspected individual examples, not a statistical claim that model quality or latency always improves.

**Remaining live defect at this checkpoint:** the 390px weekly page reflowed without horizontal overflow, but capture returned `WIDGET_CAPTURE_FAILED`, `dom-render`, `Error parsing CSS component value, unexpected EOF`. Investigation ties this to materializing a checked input's generated checkmark inside the void input element. Renderer repair and a real screenshot retest are in progress. The page's 829px vertical content is intentionally scrollable within an 800px Widget.

No live iPad/Pencil, full production-provider matrix, or production deployment acceptance is claimed. Unrelated checkpoint test failures remain as described above.


### Final local acceptance outcome

The checked-input screenshot defect is fixed in the shared Widget host/DOM renderer. Custom checkbox/radio pseudo content uses a temporary sibling carrier instead of an invalid child of a void input. The original input remains in place; custom controls use their authored CSS, and native controls retain the native renderer branch. Temporary nodes and markers are restored immediately after parsing, including failure paths.

- **External native MCP, DeepSeek 4.1 Flash:** real 390×800 capture with two checked controls passed in **429 ms**, pixelVerified true, no runtime errors. The primary agent inspected the returned WebP and verified checkmark placement. A later exact CSS patch fixed fragmented narrow-screen labels; its final capture passed in **204 ms** with no runtime errors and DOM scrollWidth=clientWidth=390. Source patches intentionally reinitialize the Widget's JS state; geometry-only resize had independently preserved 2/3 state through 1200→390→1200.
- **Internal PenEcho Agent:** a new 390×500 control fixture passed its first combined capture, with native checkbox, custom checkbox and custom radio under a padded, positioned, scaled container. The primary agent inspected returned pixels. Keyboard interaction after capture changed selected count 3→2; no temporary snapshot nodes or marker attributes remained.
- **Positioning:** external native MCP applied a single explicit-coordinate ink stroke, Undo advanced the revision, and a second stroke in unobscured Canvas space appeared at the expected location. Ink below an opaque Widget remains covered by its existing stacking; this work does not introduce ink-over-Widget layering. Relative placement, explicit geometry and stale-document rejection have semantic shared-executor coverage.
- **Patch diagnostics:** malformed hunk counts now report bounded hunk/line information without echoing arbitrary source. The public tool description specifies exact unified-diff headers and counts. Validation remains strict; malformed patches do not write or gain success receipts.
- Latest focused post-fix run: **26/26 passed**, overlapping the earlier 317-test run. Latest Cloud mirrored runtime/import/adapter/failure-trace run: **14/14 passed**. Reviewed official scoped client/server sync checks, generated-client check and diff whitespace checks passed.

Evidence images and the consolidated test log are retained at `/tmp/penecho-shared-agent-acceptance-20260910/`. In particular: `mcp-visual-explorer.webp`, `internal-visual-explorer.webp`, `mcp-narrow-checked.webp`, `mcp-narrow-refined.webp`, and `internal-controls.webp`.

A local Save canvas action was rejected by automatic approval review because it would persist test content. No alternate save API was used. Acceptance continued with a separately identified temporary test Widget. No production/UAT data, remote branches, deployments, or client connection configuration were changed.

This completes the implemented shared-flow local desktop acceptance described above. Full provider coverage, iPad/Pencil, and a fresh model run with every final wording refinement are not certified. The original UAT provider's missing raw argument payload still prevents a definitive retrospective explanation of why it sent empty arguments. The public MCP contract remains compatible, and full Visual Explorer guidance is delivered only on demand; measured sample timings are not a universal latency guarantee.

Cleanup completed: the temporary PenEcho process was stopped, port 3937 has no listener, and only its copied `connections.json` was removed. Source changes and evidence remain.


## Actual Excel workload audit, 2026-09-10 morning

Both requests concern `FDI_and_Foreign_Reserves_Global_Study_2025_Data.xlsx`.

- External MCP log: session `870cd7a6616472dce51aedcce89e8db366848a5304417bd89694c6a9fd13fd65`. Session 09:39:17, first presentation 09:41:11, screenshot complete 09:41:20, final status 09:46:50. Twelve MCP calls. After initial output, patches mainly shift SVG labels/grid bounds and remove duplicate legends; they do not add analytical conclusions. Three patches fail with INVALID_WIDGET, including a valid one-line viewBox change; the model eventually re-presents the full HTML.
- Internal native Agent trace: request `935e00eb-d2e3-45f4-928b-497ff3d42cd8`, model config `gpt-5.6-sol`, medium. 09:39:27–09:49:27. Twenty-nine tools: 13 attachment reads, 4 virtual reads, 4 patches, 3 presentations, 2 captures, and one each of guidance/inspect/list. Three attachment calls repeat offset=1,limit=300. First presentation appears at 09:44:44. Its JavaScript has a real missing-parenthesis syntax error, so some repair is necessary. All four file patches are rejected by the same Widget validation defect. The second full presentation still contains a syntax error in offline parse; the third uses static HTML without a script. This is not solely cosmetic over-refinement.

### Deterministic patch defect

HTML patches copied the complete HTML into optional copyText, whose limit is 16,000 characters while HTML supports 200,000. The exact external patch results are 29,136 / 29,136 / 29,831 JavaScript characters (the hash suffix 37,158 was not a character count). Real widgetRecord rejects each when HTML is duplicated into copyText, and accepts it when omitted. This bug exists at checkpoint 895d10c; it was not introduced by the Agent/MCP integration, but prior small-document tests failed to catch it.

The patch now keeps canonical HTML as the copy source, clears legacy mirrored copyText, and preserves independent copy sources and their limits. New semantic coverage uses the real record validator and copy helpers, checks large HTML, old mirrors, independent source boundaries, geometry preservation and source conflict rejection. Document/guidance/internal adapter tests: 47/47 passed.

### Efficiency corrections and limits

Shared/default guidance now says to deliver a complete, readable, usable answer after the initial check; further work needs a material correctness, missing-content, readability or interaction defect. Optional spacing/label polish does not justify another read/patch/capture cycle. Default MCP instruction length remains 4,990 characters (previously 4,993); the crafted Visual Explorer core is unchanged. Native attachment guidance emphasizes reuse and the returned continuation offset.

Attachment pagination is 1-based, defaults to at most 2,000 rows and 50 KiB, and already supplies continuation. The public native trace omits actual tool contents, so it cannot prove whether the workbook reader truncated output or why the model repeated a range. The generic 'PenEcho tool completed.' text is a public-trace placeholder, not proof that the model received empty tool output. No private reasoning was inspected.

No fresh live workload rerun or speed guarantee is claimed. The user's running service and Canvas were not restarted or edited. Server guidance was synced through the reviewed Cloud tool. The rebuilt Canvas client includes concurrent navigator UI work; its Cloud sync is pending coordinated integration with that work, rather than copying mismatched app.js alone.

### Follow preference and small-page framing repair (2026-09-10)

User reports Follow latest turns itself off and new pages sometimes remain tiny near the top until manual Fit. Reviewed host code: close actions, disconnect, and nonretryable load failures changed the Follow preference; automatic framing vetoed a single artifact when its optimal fit was below 0.5; Agent framing counted a closing/navigation-hidden panel unlike manual Fit.

Follow now defaults on and only the manual toggle changes its preference within the loaded page. Close/disconnect discard obsolete targets without changing the preference; load errors report and discard only the failed update, retaining newer concurrent targets. Automatic reveal no longer rejects a sub-0.5 optimal fit, and Agent framing uses the same panel visibility conditions as manual Fit. Existing user activity guards remain. No extra model/tool calls or new scheduler were added.

Validation: 74/74 combined MCP runtime, workspace actions, studio workspace, and fit tests; 2/2 focused real Agent framing/placement tests; regenerated public/app.js and build consistency/syntax checks passed. Full visual-explainer test file also has an unrelated existing instruction-string assertion expecting `Spatial work: canvas shows the complete composition`, which does not match the current integrated runtime prompt; it was not weakened. No live user tab was reloaded or service restarted, so these changes require loading the rebuilt client and have not yet been visually accepted in the user's running page. No Cloud deployment performed. Main handled framing; requested Astra/medium worker handled Follow preference, with actual changes reviewed by main.

### Offscreen animation snapshot repair (2026-09-10)

The five-portals session returned an empty individual rune capture before a later explicit show/capture returned pixels. Host inspection identified a deterministic mechanism: the inner runtime waits 50 ms for native rAF, then proceeds even when no frame ran. Offscreen native rAF may remain throttled after activation, leaving an authored Canvas with no first draw.

The existing snapshot settle fallback now flushes one frozen batch of pending authored animation callbacks, canceling their native handles, honoring cancellations, retaining newly queued callbacks for the ordinary scheduler, and reporting authored errors. It does not start a recurring timer or claim actual browser frame presentation. Canvas runtime also pins a target active during snapshot execution so a normal positioning pass cannot hide it mid-capture; success/abort releases the pin. No generated HTML changes, user camera moves, iframe replacement, new model calls, or additional wait were introduced.

Validation: 20 snapshot/visibility/readiness/load/custom-control tests and 8 science-runtime tests pass. Client build consistency and JavaScript syntax checks pass. Real headless Edge Canvas fixture at /tmp/penecho-frame-flush-omBxDh/browser-output.html records alpha 0 before and 255 after fallback, exactly one authored draw, and presented:false while native callbacks are held. This proves actual Canvas drawing under deterministic frame starvation, not a full live MCP replay. Main reviewed the requested Astra/medium worker's host change and handled the capture visibility lease. User's running Canvas was not reloaded and Cloud was not deployed.

Original rune portal verification subsequently passed in real Edge: unchanged original portal drawing script, instrumented only to hold native animation callbacks. /tmp/penecho-frame-flush-omBxDh/portal-old-output.html reports 0 nontransparent pixels after old settle; portal-new-output.html reports 78,612 after the repaired settle, both presented:false. Exact spawned browser processes were stopped.

User additionally required failure isolation for skills, downloads and Canvas saving. saveSnapshot now requests bounded best-effort preview preparation while preserving authoritative Widget source/layout. PNG export can reuse a current-content-version snapshot if fresh capture fails, but still rejects missing or stale pixels rather than silently omitting content. Existing post-commit MCP capture failure receipts were tested and retain applied:true. Final combined focused suite: 44/44 passing, covering save with unavailable preview, cached/missing/stale export, committed MCP capture failure, animation flush, lease cleanup/cancel, readiness, document load, custom controls and science runtime. Generated client rebuilt and checked. A pathological author callback cannot be preempted synchronously within its JS realm; the repair adds no recurring loop or extra wait beyond the existing 50 ms native-frame fallback and capture budget. Full live MCP replay and Cloud deployment remain unperformed.
