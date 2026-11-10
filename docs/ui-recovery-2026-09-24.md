# Studio UI recovery audit — 2026-09-24

Baseline: `97a9795` (`v1.3.4 before UI changes`). Recovery checkpoint requested by the user: `fcee996`.

The audit compared the 17 subsequent UI tasks and their attached references with the canonical Canvas source. Later requests take precedence where they refine earlier designs. Historical commands were treated as evidence, not instructions to execute. User documents and existing work were preserved.

## Findings

Most runtime behavior remained in the working tree, but the Studio presentation files had lost later layout and component rules. The missing rules explain the flattened welcome cards, extra save button, lost dock layout, and obsolete visual styling. Restoring the actual space-reserving sidebar while retaining an older viewport margin also reserved the left sidebar twice. The redundant margin was removed. The exact operation that replaced the earlier presentation files was not established.

## Requirement audit

| Original task | Accepted behavior and final verification |
| --- | --- |
| 优化工具栏紧凑布局 | Compact edge-anchored zoom and AI groups; merged AI run/stop; no duplicate favorite/orb; horizontal, vertical, then two rows; centered vertically; geometry and real click forwarding checked. |
| 重设计颜色转盘与合格页面 | Eight radial presets, custom spectrum/hue, HEX/RGB, draft/apply/cancel; pointer and keyboard tested; both current-color buttons have visible swatches. |
| 移除 maxwidget 外层灰框 | Maximized widget has zero outer border, padding and shadow; widget-owned inner HTML remains intact. |
| 按设计稿重做首页界面 | Dotted empty canvas, Agent closed initially, three aligned welcome cards; both sidebars reserve space without shadows; inline save and keyboard save; Settings Canvas groups; inline Agent suggestions and tint selection; grouped widget actions and four resize corners. Narrow cards respond to the actual remaining canvas width. |
| 优化 Library 页面交互 | Desktop three-column grid, single select, double-click/Enter/Open now opens; selected-only dots remain in place; current canvas opens without unnecessary reload/save; list, narrow Chinese and system-dark tested. |
| 修复分享页并重设计右上角 | Retained viewer-specific green primary action and account chip; validated actual local Cloud share import and temporary-error/retry recovery. Canonical viewer JS/CSS match the already synchronized Cloud copies. |
| 修复弹出页面和字体颜色 | S 440/M 560/L 1080 dialog frames, opaque bodies, consistent headers, body scrolling, readable text and narrow/short layouts; dialog acceptance and contrast checks passed. |
| 修复画布交互与视觉细节 | Header icons/type, joined 0.3-second sidebar motion and reversals, 250-unit lighter line grid, enabled/disabled Undo/Redo, merged bottom-left controls, global Tab behavior and manual paused-AI action verified. |
| 统一下方内容并精简文字 | More entries share icons and concise labels; real menu rendering checked. |
| 调整元素到最右侧 | Switch thumb position derives from actual track width; checked and unchecked endpoints verified after the transition. |
| 修复三点菜单被遮挡 | Top-layer Library menu, bounded placement, first/last rows, grouped actions and red delete; list/grid, scaling, narrow, short, dark, Escape/focus, scrolling, outside-click and action dispatch checked. |
| 添加绘字确认按钮 | Empty ink disables send; first pointer stroke enables it; clear disables it; real form submission encodes an image, creates the user message and clears the draft. Only the transport is replaced in the browser test; no paid model is invoked. |
| 取消无意义提示 | Retained the requested ordinary Agent-open pause message while requests are active; redundant longer bottom status is removed. |
| 优化提示布局与可移动面板 | Center toolbar yields toward available horizontal space, then changes layout; MCP activity notice clears all bottom controls. Wrapped pause controls cannot intersect the second row. Contextual MCP status suppresses the generic pan/zoom hint to prevent overlapping text. |
| 设计右上角 Share 按钮 | Purple editor Share button with white icon/text and compact radius; existing sharing flow retained. |
| 设计MCP操作界面 | Status popover, channels/sessions, follow control, connect/configuration/power, contextual activity and sidebar badges; opening status does not disconnect. Sidebar uses the same 320px desktop geometry as ordinary navigation. |
| 设计左侧栏并评估折叠功能 | Default desktop expansion, remembered full collapse, search/new/destinations/Open/Recent/groups/chats and genuine save status; no thumbnail rail. In compact windows an explicit Agent opening folds navigation, retaining the MCP connection and selected tab, so both panels cannot squeeze the canvas to near zero. |

Existing additional Agent suggestions remain reachable; they were not deleted merely because the reference screenshot displayed fewer rows.

## Reproducible acceptance

Canonical browser scripts live in `scripts/verify-*.cjs`. Outputs and screenshots are under `test-results/ui-recovery` or the script's printed temporary evidence directory. Fixtures use isolated browser profiles and local test storage.

- `verify-ui-recovery.cjs`: 20 width/sidebar combinations (701–1440px), 125% page scale, welcome alignment, color swatches, switch endpoints, More/Share, MCP notice clearance, handwriting submission and maximized widget.
- `verify-reference-shell.cjs`: home, Settings, inline save, widget selection/actions/resize and MCP retry.
- `verify-shell-refinements.cjs`: joined animation frames, rapid reversal, Tab, paused action, Undo/Redo and grid spacing.
- `verify-color-picker.cjs`: wheel/custom picker interactions and responsive bounds.
- `verify-dialog-design.cjs`: modal geometry, scrolling, opacity, contrast and short/narrow/system-dark environments.
- `verify-sidebar-reference.cjs`: search/filter/groups, expansion persistence, source failure and narrow layout.
- `verify-mcp-status.cjs`: statuses, follow, update acknowledgment, retry/sign-in, narrow Chinese and idle suppression.
- `verify-library-design.cjs` and `verify-library-menu.cjs`: Library appearance and real interaction dispatch.
- `verify-compact-dock.cjs`: edge anchoring, merged AI run/stop and popover placement.
- `verify-share-viewer.cjs`: real local Cloud share content and retry. Start Cloud's `tools/preview-live-share.mjs` with `scripts/fixtures/ui-recovery-share.json` from this repository and `--signed-in`, then pass its URL through `PENECHO_SHARE_TEST_URL`. The fixture contains no user data.

The related 563-test Canvas suite passed. Cloud's two live-share tests also passed. The generated client is checked with `npm run check:client`; no hand edits to `public/app.js` are required.

## Delivery boundary

This is canonical source recovery and local verification. It does not reinstall the separately installed `/Applications/PenEcho.app`, push the repository, or deploy Cloud/UAT. A live environment protected by external authentication was not changed by these UI fixes. Temporary services created for the audit are stopped after verification.
