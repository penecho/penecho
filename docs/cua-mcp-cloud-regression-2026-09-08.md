# 071 / Cloud computer-use regression — 2026-09-08

## Scope and baseline

- Canvas workspace: `<repository-root>`, HEAD `e4b87f1`.
- Verified remote Canvas main: `84d4f8dc45cf5970193895f7d8b084d172f2dd7b`.
- Cloud workspace: `<cloud-root>`; fetched remote main `2a5cb52ac88775f9f6dbb568e701acbc61512220`.
- Both repositories already contained substantial changes. Existing changes were preserved. Diff totals against main include those changes and are not this task's patch size.
- Reused existing 071 services on ports 3921/3922 and the signed-in Cloud UAT at `internaltest.penecho.ai`. No production deployment or push was performed. Existing services were not restarted.
- UI interactions used computer use through Edge, native ZCode/Edge accessibility, and the in-app browser. No shell-based browser automation was substituted.

## Confirmed bugs and fixes

| ID | Reproduction / impact | Root cause and fix | Validation |
| --- | --- | --- | --- |
| CUA-01 | New blank Canvas → rename → confirm: stays in rename editor, reports empty Canvas. | Rename called the same empty-content rejection as ordinary Save. `renameCurrentCanvasFromTitle` now explicitly permits a metadata-only snapshot; ordinary unnamed empty Save still rejects. Existing storage identity and error handling remain intact. | Real in-app browser showed the chosen title and Saved; Device Library contained the blank document. Four behavioral tests cover persistence, identity, default rejection and failed-write recovery. |
| MCP-01 | Two MCP owners call `open_canvas` using the same request ID; second owner receives another owner's cached result. | Both service open cache and browser receipt ID used the raw request ID. Namespace the forwarded and cached ID with a deterministic SHA-256 of owner and request ID. | Failing-before test; verifies separate owners, same-owner retry, conflicting arguments, and stable ID after Canvas WebSocket reconnect. |
| AGENT-01 | Cloud Agent creating a simple result first omits `frameworkVersion`, then placement, needing two corrections. | General create schema allowed these fields to be absent even when Visual Explorer required them. Separate mutually exclusive ordinary General HTML, Visual Explorer and private-plugin creation branches; require VE markers, dimensions, refresh policy and placement mode. Numeric positivity remains enforced by the existing execution validator because Harness schema does not support numeric-bound keywords. | Actual UAT observed both rejections before successful creation. Schema validation tests check supported valid paths, single-branch matching, missing fields and invalid markers. Post-fix live model retry is pending. |
| AGENT-02 | Those failed Cloud create calls all appeared as Done. | Public projection considered only top-level Harness error info, missing ordinary errors represented by matching `tool-result.isError`. Project that error with existing redaction and preserve call identity. | Tests use actual Harness result messages: ordinary error, structured error, success, and mismatched call IDs. Post-fix live UI replay is pending. |

Canonical edits: `src/client/app/persistence.js`, `src/server/mcp/service.js`, `src/server/canvas-agent/runtime.mjs` and focused tests. Built `public/app.js` with `scripts/build-client.js`. Synced Cloud's `app.js` using `tools/sync-public-canvas.mjs --only=app.js`; synced its approved server runtime with `tools/sync-canvas-agent-runtime.mjs`. Cloud mirrors were not hand-edited. These are local code fixes; backend fixes require the next service start/deployment to become active.

Design source: existing Canvas document-title editor and busy/error states retained. The mapped canonical sources are `penecho_design/penecho-design-language.html` Input/Select, Compact/Icon/Toolbar controls and form states, plus its README hard baseline. No new geometry, typography or component variant was introduced. The narrow/200% rendered matrix remains incomplete due to computer-use failure.

## Actual ZCode interoperability evidence

1. ZCode already had a PenEcho stdio entry from an earlier configuration task. This run did not rewrite unrelated configuration.
2. Created a new ZCode task named **PenEcho MCP 工具列表与画布枚举验收**, explicitly requiring native MCP tools and forbidding shell-simulated JSON-RPC.
3. Native `penecho_list_canvases` returned both local instances. Matched instance to the actual 3921 service using local instance records, without logging credentials.
4. ZCode started a session and created `uat-card`; its result reported object `widget-1`, 480 × 360 and applied=true. Its capture result reported pixelVerified=true and a WebP image. Separately inspected the actual browser screenshot showing “MCP 联动测试”, “版本 A” and “改成蓝色”.
5. Initial presentation used both preset size and explicit dimensions; validation correctly rejected it. ZCode removed the conflicting preset and succeeded. This rejection is not recorded as a product failure.
6. First computer-use click did not produce an inbox message; ZCode's one native `read_messages` call returned an empty array and cursor 0. It did not falsely update the card. Later inspection established that the Widget must enter Interact mode first.
7. Saved the test document to Server Library, reopened it in the in-app browser, and verified its content and external ZCode binding were retained. Entered Interact using semantic controls; the nested iframe exposed the expected button.
8. Attempting to send the recovery instruction to ZCode timed out, followed by repeated native app read timeouts and unavailable browser connection. There is no evidence of successful recovery or of a completed button-message-update loop.

Test identity for continuation (non-secret):

- Document title: `MCP ZCode 回归 2026-09-08`
- Document ID: `36b62853-8569-4a03-8489-d72143ee6c40`
- Server snapshot ID: `1788844372652-p2jinm6bhx`
- Session key: `zcode-cua-uat-20260908-a`
- Previous session ID: `355e49ea-9ea7-4493-a370-bef18b32bf0d`
- Do fresh instance/Canvas discovery before resuming; never assume the previous connection is still valid.

## Actual Cloud UI evidence

- Opened Dashboard and Cloud Projects with no linked device online.
- Created isolated project `CUA 回归 2026-09-08` with its first Canvas, and opened that native Cloud Canvas successfully.
- Submitted a synthetic request to create one “Cloud 回归 A” result. Hosted Agent reached a real Canvas tool loop, recovered from the two schema omissions, created one result and issued a Canvas capture.
- Project ID: `4de99401-d3c2-4657-81ec-805a2f2b1d9f`; Canvas ID: `d97d26b0-258d-43d1-98c7-e0aac029fd65`.
- Final Cloud save/reload and model final message were not observed before browser automation became unavailable. Do not describe them as passed. Test artifacts were retained, not purged.

## Verification

- Initial MCP suite: 67/67 passed.
- Final sequential MCP service/schema/stdio: **19/19 passed**.
- Final empty rename/create schema/public progress tests: **10/10 passed**.
- Final Cloud native Canvas, hosted Agent, adapter/store, document identity and usage contract: **26/26 passed**.
- Therefore **55 final targeted tests passed**, with no skipped tests in these final groups.
- Client generator check, selected Cloud client mirror check, Cloud runtime mirror check and both repository diff whitespace checks passed. Impeccable detector for changed persistence source returned no findings.
- A wider concurrent run hit a service test timeout under heavy system load and left the test worker alive. Only that run's confirmed processes were stopped. Its complete pass is not claimed; the affected MCP suite subsequently passed sequentially.
- Wider UI group: 123/131 passed. The isolated `ui-controls` file has 105/113 passed and 8 failures. An in-memory baseline restoring only this task's changes reproduced exactly the same eight failed tests. No failing assertions were weakened or removed.
- The existing visual-skills documentation assertion also fails because the current contract does not contain its expected phrase `final review, patch one concrete composition-wide typography mismatch`; this task did not edit that contract or assertion.

## Remaining acceptance

This was not a completed all-new-features acceptance pass. Resume when computer use is available:

1. Restore the same ZCode session key/document in a freshly discovered connection; click the Widget action after Interact, read once, acknowledge received/working/done, update stable artifact and verify pixels.
2. Exercise virtual-file list/read/patch, stale contentHash rejection, idempotent retry, Canvas inbox and annotation feedback through real ZCode tools.
3. Validate post-fix ordinary tool failure UI and first-attempt Visual Explorer creation on a fresh patched runtime.
4. Finish Cloud save/reload, two-tab revision conflict, rename/star/trash/restore, cancellation, usage pagination/filtering, and linked-device transition UI flows.
5. Finish wide/narrow/localized/200% rendered acceptance. Chromium-only success would not establish Safari/iPad acceptance.
6. Investigate the eight pre-existing UI contract failures and visual-skills assertion separately from the four confirmed product defects.

Model work split: primary Astra performed computer use, integration and review. Non-UI implementation/review workers were requested as `gpt-6-astra/low`; the bounded rename test worker was requested as `gpt-5.6-luna/max`. Tool output did not independently expose the workers' actual serving model. ZCode's UI displayed GLM-5.3 for the real interoperability task; no claim is made that it served as a native Codex delegated worker.

## Continuation after access recovered

Native Edge and ZCode computer use worked. Browser debugger attachment still failed once; native app interaction completed the following checks. A stale AX-index action was rejected by automatic review; a fresh full AX tree established the correct test tab before retrying successfully.

### Verified end-to-end

- Cloud Agent final answer was present. Saved the single test result, refreshed, and verified Saved plus the same Widget. Sessions on this Canvas restored the full conversation; the initially empty composer was not lost history.
- ZCode freshly discovered the original 3921 test document, verified its documentId through `find_canvases`, and resumed using the same conversation key. Current session at that point was `0880ce70-7265-48b8-a118-d1712b4b70c6`; connection IDs remain ephemeral.
- Entered Widget Interact mode and clicked the actual nested button. ZCode's native `read_messages` returned instruction `70320a5d-f31d-4b98-b157-904822358a0a`, action `change-blue`, source `widget`, object `widget-1` and the intended prompt. Native acknowledgements succeeded for received → working → done.
- The same `uat-card` updated in place, object `widget-1`, 480×360, revision 4→5. Native capture reported pixelVerified=true, no runtime errors. Independently inspected the Edge screenshot: blue card and “版本 B” rendered correctly. The earlier empty inbox result was not a proven message-delivery defect.
- ZCode listed 13 virtual files, read the Widget HTML and empty `context.md`, then patched only context.md. Same request ID retry returned reused=true; old hash with a new request ID returned SOURCE_CONFLICT. Final read contained exactly `验收：MCP 虚拟文件版本 A\n`, with no STALE text. Viewport and selection virtual reads succeeded.
- Cloud test Canvas was starred, appeared in Starred, moved to recoverable Trash, then restored to its original test project with its star retained. No permanent deletion occurred.
- Saved the local blue-card/context test document after these checks; UI confirmed Saved / Current snapshot overwritten. Browser background sleeping caused another MCP disconnect; this run does not claim automatic wake/reconnect passed.

### Additional confirmed defects and local fixes

| ID | Evidence | Fix / validation |
| --- | --- | --- |
| MCP-02 | Same document/key resume returned empty public summary/steps/events although the browser persistence layer retained them. | Start now includes restored progress; service validates bounded fields and initializes its snapshot from them. Start and inspect agree. A new sessionId after connection loss remains expected. |
| MCP-03 | Code-backed reproduction: persist bindings A/B, reload, resume only A, persist again; old serializer discarded unresumed B. | Merge saved and live records by sessionKey/client, live records replace their binding, explicit closed bindings do not revive. Tests restore B again and verify artifact identity and progress; keyless compatibility covered. |
| CLOUD-01 | Rename in Canvas to “Cloud 保存与恢复回归” showed Saved, but returning to Cloud project and Starred still showed “Main canvas”. | Native existing-save validates top-level bundle.name and carries it into revision completion. Metadata name and revision advance in the same PostgreSQL CAS transaction; failed/stale saves cannot rename. Memory repository follows the same successful-save boundary. |

Reviewed actual changes in Canvas serialization, service validation, native-save flow and both repository completion paths. Generated Canvas client and synced Cloud app/runtime using canonical tools again; checks passed. Cloud fix files: `src/routes/native-canvas.mjs`, `src/routes/canvas-bundle-flow.mjs`, `src/repositories/memory.mjs`, `src/repositories/postgres.mjs`, and `test/native-canvas.test.mjs`. Existing unrelated Cloud changes were preserved.

Continuation tests: Canvas documents/identity/MCP runtime **55/55**, MCP service **10/10**, native Cloud **11/11**, shared bundle/revision expiration/trash **11/11**: **87 passes** in these groups. They overlap earlier suites and must not be added as unique test counts. Failure-before probes confirmed the two MCP regressions. Real PostgreSQL integration was not run. No backend restart, UAT deployment or push occurred, so the three new fixes and the earlier Agent fixes still require live verification on a patched runtime.

Remaining acceptance supersedes the earlier list: annotation feedback and Canvas inbox text entry; patched-runtime recovery and Agent failure rendering; real two-tab Cloud conflict UI; move/cancel/usage filters/device transitions; wide/narrow/200% browser layout (Canvas zoom 200% is not browser zoom); Safari/iPad. This continuation is a completed focused regression batch, not all-new-features certification.

This continuation used primary Astra for CUA/integration/review and two non-UI workers requested as `gpt-6-astra/low`; actual worker serving-model metadata was not exposed.
