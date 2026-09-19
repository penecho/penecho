# Canvas Library pagination and cache

Canvas sources live in `/Users/heack/workspace/penecho_071_version`. Cloud-owned routes and repositories live in `/Users/heack/workspace/penecho_cloud`; generated Canvas assets reach Cloud only through `tools/sync-public-canvas.mjs`.

## Behavior

- Server no longer imposes the former 200-Canvas save limit. Cloud's Canvas creation paths already have no count limit. Page sizes bound individual reads, not the number of saved documents.
- Server and Cloud Library request 24 metadata entries per page. Project selection, name search, and sorting apply to the entire selected library scope before pagination. PostgreSQL performs these operations before returning rows; previews are loaded only as cards become visible.
- Library supports automatic loading near the bottom, a persistent auto-load preference, a manual Load more button, and an end-of-results status. Device Library also renders in 24-entry increments while retaining its existing IndexedDB reader and full-library search.
- Appending pages preserves existing card DOM and deduplicates IDs. An error retains already loaded rows and exposes one retry action. Search changes invalidate older requests immediately.
- List refresh does not disable Canvas Load, project browsing, or other independent document actions. The ordinary document save/load lock remains in place.
- Memory caches are separated by storage owner, account/device identity, project, query, sort, and language. A tab-session cache holds only the first metadata page; Canvas payloads and image blobs are excluded. Account changes and explicit session invalidation revoke old cached rows. Cache storage limits do not cap the Canvas library.
- Navigator must not treat a partial Library page as an exhaustive catalog or interpret absence from that page as deletion.
- Both local and Cloud Linked Device HTTP allow-lists explicitly permit bounded, read-only pagination parameters; unknown and duplicate parameters remain rejected.

## Design source

The existing manager shell, project rail, list/grid cards, and scroll ownership are preserved. Sources in `/Users/heack/workspace/penecho_design/penecho-design-language.html`:

| Library region | Catalog source | Applied rule |
| --- | --- | --- |
| List/grid body | `#lists`, shared `media-list` and `grid` card patterns | Existing preview/copy/action structure; append inside the existing scroll owner |
| Load more and automatic-loading controls | `#buttons`, compact secondary button | Shared `peButton` geometry, regular/medium labels, neutral treatment; pressed state for the actual toggle |
| Count, end, and recoverable failure | `#typography`, metadata; `#lists`, loading/error example | One status at the relevant operation; cached content remains usable |

## Verification

- `test/library-pagination.test.js`: more than 200 saved Server Canvases, page traversal, search outside the first page, cached loading, stale responses, append deduplication, errors, auth invalidation, and bounded identity-scoped persistence.
- `test/server-library-state.test.js`, `test/server-canvas-preview.test.js`, `test/remote-canvas-http.test.js`, and the focused Cloud connector test cover existing behavior and transport boundaries.
- Cloud tests cover native and device-sync Library routes, 245-Canvas traversal, ownership isolation, literal search, validation, and PostgreSQL query parameters.
- `scripts/library-pagination-smoke.cjs` uses a fresh Electron browser profile against an already-running server. It substitutes synthetic, read-only Library responses and verifies real UI rendering, manual/automatic pagination, cached Load dispatch, reload, Cloud switching, localized narrow layouts, list/grid modes, and 200% zoom. It does not start/restart the PenEcho backend or modify real saved Canvases.

Browser data is synthetic. Route tests use the memory repository and a PostgreSQL query-contract test; they are not a deployment or a live PostgreSQL acceptance test. Apply matching Server and Cloud backend updates together with the generated client before treating the feature as live.
