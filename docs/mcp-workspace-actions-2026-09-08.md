# MCP workspace actions and compact Recent work footer

The MCP tab now has a compact action row: Follow latest (on by default while an MCP connection is live, off after the user turns it off or the connection drops) and Close all. Follow responds only to content-producing MCP operations, coalesces to the latest document and updated content region, and defers during editing, active navigation, navigation lock, modal UI and queued work. It frames same-document updates as well as updates after switching documents; source patches resolve their object bounds and multi-object artifacts use combined bounds. Close all snapshots open MCP documents, uses the existing unsaved transition, stops on cancel/error, and preserves saved library entries.

The footer becomes one action rail: Close / Close all on the left, Library on the right. Full meanings remain in accessible names and tooltips; Chinese uses 关闭 / 关闭其他 / 画布库. Opening/error status expands only when required.

## Design source map

- Fixed sidebar footer → penecho_design/penecho-design-language.html #buttons compact Ghost and popover footer example → one quiet action rail, shared 28px controls, compact 12.5/500 text, native focus and disabled behavior.
- MCP follow → #buttons Toolbar selected state → aria-pressed toggle with existing semantic tint; content-sized label to avoid icon-width clipping.
- MCP Close all → #buttons compact Ghost → secondary action; disabled when no open MCP documents or closing.
- Footer hierarchy → #typography control label and metadata → shortened contextual labels, preserved full accessible names, 8px rail inset, no second oversized library row.

## Verification

Computer Use on a separate localhost origin (not the user's original work): desktop 1667px and narrow 390px. Footer measured 45px high, same-line controls; English and Chinese labels checked. Follow switched A→B after background content update; locked navigation retained B while A updated, unlocking resumed A. Temporary viewport restored.

Found during real follow test: background Widgets disappeared on activation. Runtime records contained empty optional copyText/copyLabel, rejected by validation on restore. Normalize stored records and repair older records during Show. Regression uses real widgetRecord/restoreWidgets rather than identity mocks.

Automated: 24 canvas-documents tests and 6 workspace action tests pass. MCP runtime/schema/stdio relevant suites pass (stdio requires loopback permission). No production deployment. Electron, Safari and Firefox full visual matrix is not claimed.

Final live verification: repaired background Widget mounted and rendered its HTML after switching (Fit all brought its stored geometry into view). Close all closed blank A, paused on dirty B; Cancel preserved B. Repeating Close all → Save as and close completed, left an empty canvas and disabled Close all. Enter on the Library footer action opened the local library with the saved canvas retained. User's original IP-origin work was not closed. That earlier verification covered document switching only. The subsequent Follow latest extension now frames the latest updated content, including background documents after activation; its new browser verification is tracked separately below.

Primary Astra handled UI, integration and Computer Use. Delegated requested Astra/low handled the bounded record-normalization fix, and requested Luna/max added action boundary tests; actual worker backend metadata was not exposed.

## Follow latest content-region extension

Follow now carries the latest update bounds alongside the document ID. After an asynchronous switch it checks interaction guards again, uses the latest pending region, and cancels older automatic reveals for that document. Wheel and trackpad navigation reuse existing completion callbacks to resume pending follow. No new polling or rendering scheduler was added. Missing geometry and context-only patches preserve the document view.

Source changes are in 071 and public/app.js is generated with scripts/build-client.js. This extension is not deployed or synchronized to the Cloud mirror.

Verification for the extension: MCP/document/navigation/follow-region suites pass; the navigation cooldown test also passes. Generated bundle syntax and generator freshness checks pass. The broader ui-controls suite reports 105 passes and 8 failures in existing source/CSS expectation checks (save signature, connection presets, lock styling, save feedback, Studio layout, launcher styling, title bar and navigator metadata); those unrelated contracts were not rewritten for this change. A fresh localhost test page successfully loads the generated client. Live MCP follow verification remains incomplete: automatic approval review rejected enabling the temporary test page's MCP connection as an additional settings change; user authorization was requested and the unconnected test tab was closed.

The primary task implemented and reviewed the behavior. Tests were delegated with requested gpt-5.6-luna / max; the tool exposed the requested configuration, not independent backend model metadata.

## Close all loading footprint

Both Close all controls now overlay the existing busy spinner at the button center while transparent label text preserves intrinsic width and its accessible name. Source map: penecho-design-language.html button state matrix / compact Ghost busy state; explicit user refinement requires loading to occupy the original button rather than append width. The 071 style override retains the existing spinner size and animation, with a text-color fallback when semantic variables are unavailable.

A temporary browser fixture loaded actual public/style.css and the two real button IDs. English wide-state widths stayed 68.703125 px; Chinese at a 390 px viewport and 200% CSS zoom stayed 136 px. Busy transitions preserved button vertical positions; the bounded narrow fixture had scrollWidth = clientWidth = 390. The centered spinner was visually inspected. The fixture and tab were removed. Main task handled this small UI fix directly; no subagent or Cloud deployment.

## Follow-up: remove footer New, quiet reconnect notice, surface the open limit

User refinement after the rail shipped: the footer New is redundant with the top-right New Canvas action, so the shared rail keeps only Close and Close all; the reconnect report ("External connection lost…") no longer injects a footer error and Retry, leaving the existing MCP connection notice as the status surface; and the 32-document workspace limit now shows a close-first hint instead of silently failing or growing past the cap.

The hint (`canvasDocumentsLimitMessage`, English and Chinese) renders in the footer status whenever 32 documents are open, and the same message is thrown for MCP create/open. Creating from the top-right New Canvas is now blocked at the cap in `requestCanvasTransition`, which previously bypassed the check. Tests cover the localized limit message in `canvas-documents.test.js` and the blocked transition in `canvas-close-transition.test.js`; the footer markup contract in `studio-workspace.test.js` now asserts New is absent. `npm run build:client` regenerated `public/app.js`. Not deployed.
