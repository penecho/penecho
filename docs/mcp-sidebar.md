# MCP sidebar

When MCP discovery is enabled (including connection setup), Recent work opens on the MCP tab and PenEcho Agent closes without automatic restoration. Repeated connection status updates do not reopen the sidebar. The MCP tab follows All and is hidden when discovery is off; disconnecting from the selected MCP tab returns to All.

The MCP list reuses the Canvas group row, thumbnail, selection, search and opening behavior. Only documents with external bindings, retained MCP sessions or live MCP sessions appear. Opening the sidebar does not acknowledge updates. Background changes update existing unread dots without regenerating thumbnails; opening the corresponding Canvas clears its marker.

Design sources:

- Tab strip → `penecho_design/penecho-design-language.html`, “Switch / Tab / Segmented”: existing `data-pe-control="tab"`, selected state and keyboard navigation.
- Canvas rows → existing Recent work / Canvases group rows and canonical content-list hierarchy; preserve preview, title and metadata geometry.
- Update state → existing workspace unread dot and sidebar launcher indicator; no new visual component.

Scope: the 071 Canvas client, generated through `node scripts/build-client.js`. Existing `mcpLocal()` capability gating remains authoritative; Cloud/viewer runtimes do not expose local discovery. No Cloud mirror sync or deployment is included.

Validation (2026-09-08): 60 targeted navigator, MCP settings/runtime, workspace and build-structure tests pass. The already-running 071 runtime at port 3921 was inspected in the in-app browser at 1280px and 390px widths, in English and Chinese, and at the supported 125% interface scale. Opening MCP closed Agent and selected MCP; disabling it removed the tab. Rendered inspection found and fixed clipped Canvases text (equal-width tabs) and overlapping footer actions (inherited horizontal footer layout). Tabs now size to content and footer groups stack; the checked regions have no horizontal overflow. The temporary MCP connection was disabled, language/scale restored, and test tab closed. No PenEcho process was started.

Creating a persistent test Canvas/session for live unread-dot inspection was rejected by automatic approval review as outside the explicit temporary-discovery authorization. No test Canvas/session was created. Unread update, isolation, persistence and clearing behavior is covered by automated tests; populated-list live MCP visual inspection remains pending authorization for those test records. Safari/iPad and Electron-specific rendering were not verified by the in-app-browser pass.

## Docked MCP selection

Only an open sidebar with MCP selected occupies layout space. The sidebar is an opaque flex sibling of the Canvas viewport, which is resized by its existing ResizeObserver. MCP selection removes the narrow-screen scrim and inert state; workspace focus and Canvas selection retain the dock. Selecting All, Canvases or Agent restores the existing overlay behavior, and closing the sidebar releases its space. Canvas changes consult this exact predicate before automatically opening PenEcho Agent; the saved auto-open preference remains unchanged. Explicit Agent opening is still available.

Runtime inspection confirms 1280px width → 248px sidebar + 1032px Canvas, and 390px width → 248px sidebar + 142px Canvas, without overlapping bounds. All restores Canvas x=0. Narrow MCP does not inert the Canvas or show a scrim.

Dock verification: 63 focused tests pass, plus the existing Agent auto-open preference test with MCP/ordinary-tab cases. English/Chinese and supported 125% scale were rendered. The narrow viewport notice now wraps instead of clipping. Five unrelated appearance/preset assertions remain failing in the broader UI/Agent suite; this task does not claim that entire suite passes. Temporary discovery was disabled and browser settings restored after inspection.

MCP persistence: while discovery is open and MCP is selected, opening Agent or the Canvas Library must not automatically collapse the dock, including at compact widths. Workspace focus, Canvas selection and background status updates also retain it. Manual close remains available; reopening keeps the MCP selection and the same persistence behavior. Switching to another tab restores that tab's existing collapse rules. The focused suite now passes 65 tests, including Library/Agent auto-collapse exceptions and manual close/reopen persistence.

Open state: Canvas rows in All, Canvases and MCP share metadata that starts with Current / 当前 for the active Canvas and Open / 已打开 for other workspace records. Closed saved Canvases have no open label. The status precedes location/time and the full metadata is available on hover; unread dots remain independent. Sidebar base and MCP dock widths are now 248px (16px narrower). Validation: 66 focused tests pass, client rebuilt, and rendered inspection checked the current label and 248px dock at 1280px/390px, plus English and Chinese at 125% scale. Background-open labeling is verified by tests; no persistent test Canvas was created. Temporary discovery was disabled and locale/scale/viewport restored.


## Canvas naming and close behavior

- An external session's existing structured title names only an untitled, unsaved
  Canvas, using the standard generated-name path. No additional model request or
  chat-text parser is used; explicit names, saved names and reconnect identity win.
- Close uses the same transition dialog as New/Load when the active Canvas is dirty:
  save, save as, discard, or cancel. Inbox status is not a close prerequisite.
  A failed save leaves the Canvas open. Save as retains the saved library copy while
  closing both transient workspace handles. Closing the last Canvas leaves a blank one.
- Closed sessions reject late mutations instead of falling back to the active Canvas.
- Sidebar metadata explicitly distinguishes Current, Open, and Not open (当前、已打开、未打开).

Design-source map: sidebar metadata → `penecho_design/penecho-design-language.html`
list copy/state examples, retaining existing row geometry; close confirmation →
`#dialogs` single-column modal, reusing the existing New/Load dialog and save controls.
Rendered checks used the existing local runtime, English desktop and 390px width,
and Chinese with the supported 125% interface scale; the dialog and sidebar stayed
within their containers. Cancel and discard were exercised on a temporary test Canvas.
