# MCP workspace, first version

User task: continue one external conversation on its own Canvas, keep other work available, and recover from a failed operation without losing input or duplicating output. No Git, save-version history, branches or playback is introduced. Bundle V2 carries optional `penechoDocument` and `penechoWorkspace` extensions; V1/V2 documents without them remain readable.

Design-source map (canonical `/Users/heack/workspace/penecho_design`):

| Product region | Catalog source | Applied rule |
| --- | --- | --- |
| Open Canvas selector and New/Close | `penecho-design-language.html`, Canvas Library manager toolbar; controls/select examples | Compact intrinsic actions, one labeled selection, responsive wrapping, stable geometry |
| Agent recipient selection | `penecho-design-language.html`, settings rows with a select and supporting copy | Explicit recipient, bounded selection rail, supporting neutral copy |
| Connection / instruction failure | `penecho-design-language.html`, page-status and Canvas Library error state | Keep content usable, inline explanation, visible Retry next to the failed operation |
| Instruction state | `penecho-design-language.html`, activity-status examples | Distinguish waiting, received, working, done and error; do not claim delivery without acknowledgement |

Only the selected document has live Widget frames. Inactive documents retain source, assets, placement, feedback and conversation bindings. A tool must explicitly show an inactive Canvas before requesting pixel capture; the error includes its documentId and retry guidance. Source edits preserve placement; placement changes are distinct actions and reject new collisions. Existing annotation overlaps remain valid. User navigation never follows background changes implicitly.

External instructions use a pull inbox, with explicit acknowledgement. Ordinary MCP cannot promise to wake a stopped client. Text and Canvas references are supported in the external composer; attachments remain in the composer with guidance to place them on Canvas or choose PenEcho Agent. Canvas Auto AI pauses while an external conversation is selected. Failed external delivery never silently starts a different model.

Save records the present document and view only. Inactive workspace recovery is local IndexedDB data, distinct from the user's selected Server/Cloud save destination. Cross-storage resolution prioritizes open unsaved state and exact locations; offline/authorization failures differ from not-found and ambiguous copies require an exact locator.

## 2026-09-07 第一版交付与验收

已实现稳定画布 ID、多画布与对话绑定、Device / Server / 已连接 Cloud 的保存位置查找、虚拟文件和源码补丁、当前视野与选区、避免新增重叠的布局、外部文字指令收件箱、明确的处理方选择及重试提示。新会话默认避开已有内容的画布；重新连接沿用 documentId。独立另存为生成新 ID，保留原画布内容并清空副本的外部绑定。现有 V1/V2 文件仍可读，本版不包含 Git、保存历史或播放。

画布切换会保留输入草稿。内置 Agent 正在运行、附件尚未发送、存储不可用或当前手势未结束时，提示具体原因和重试入口；用户可以完成或停止原操作后重试。外部任务可继续更新后台画布，但后台画布截图必须先显式显示。外部收件箱不会自动唤醒停止运行的第三方客户端，也不会悄悄改用内置模型。

- 全库 `npm run check`：1,147 项，1,143 通过。4 项失败均核对了未修改 HEAD：Visual Explorer 字体文案、Widget 截图错误表达式、Widget host 超时表达式、连接名称表达式的旧断言不匹配；本次未弱化这些断言。
- 针对 Canvas runtime、身份、源码补丁、MCP 绘图和 Agent 可用性的 61 项检查通过；新增文档集成与身份校验合计 19 项通过。
- Cloud 文档身份测试 3 项通过；Cloud 前端通过官方同步工具同步，源码镜像检查和语法检查通过。Cloud 原有未提交修改保留。
- 使用已运行的 3921 服务的专用浏览器标签页，查看了 1280 × 720 与 390 × 844 截图，检查中文、125% 界面缩放、多画布切换及输入草稿保留；未发现本轮运行错误，恢复了语言、缩放和视口设置。
- 真实 MCP 启用及关闭空白测试画布被自动审批阻止，原因分别是授予外部访问权限、移除本地恢复数据。未绕过；尚未完成这两项真实 UI 验收。旧进程未重启，新服务接口需要加载新代码后才能在该进程中使用。

主任务负责架构、界面和集成验收；两个非 UI 子任务分别请求 `gpt-5.6-sol / high`（协议与集成测试）和 `gpt-5.6-luna / max`（身份、输入校验及 Cloud 元数据）。工具可证明请求参数，未提供独立的实际模型运行元数据。未提交、推送或部署。

## Recent Work workspace integration

- Canvas navigation → `penecho-design-language.html` Workbench architecture: one left navigator and an unobstructed Canvas. Open documents merge into existing Recent Work groups by their saved locator; unsaved documents remain addressable by document ID.
- New/Close and retry → catalog compact toolbar controls and recoverable error state: controls live in the navigator footer, with an inline error and explicit Retry.
- Canvas order uses descending last-save time; an unsaved Canvas uses its persisted creation or first-seen time instead. Selecting a Canvas, following updates, or receiving Agent activity never promotes it or changes that time.
- Unread updates → a small trailing dot and matching navigator-toggle dot; no numeric badge. Only explicit manual Canvas selection acknowledges updates, including selection of the already active Canvas. Automatic Follow, MCP Show, programmatic switching for Close, and opening the sidebar preserve unread state.
- MCP activity → catalog semantic accent and opaque working-surface rules: a temporary one-pixel accent outline only, with no inner shadow, background wash or blur. Reduced motion disables the fade.
- Background updates change indicator state in place; closed navigation does not rebuild lists or decode previews. Structural workspace changes mark the navigator dirty for its next opening.

## MCP launcher and ten-second setup

MCP Server sits immediately before the Agent launcher inside the existing responsive launcher owner. It follows the catalog Workbench toolbar and compact button patterns. Clicks explicitly toggle discovery; unknown setup opens Settings → MCP. Setup completion is only a local UI hint, never a live-connection claim. The toolbar reports discoverability only after the bridge ready handshake, with retry after failure. Settings follows the catalog settings-content and disclosure patterns: one value statement, one permission summary, client + setup action, one example prompt. Manual controls, full access scope and sessions are collapsed by default.

Existing Codex/Claude entries can be inspected on demand through authenticated local status (`inspectClients=1`). This reads configuration only; it neither changes the client nor proves a live AI connection. Each client has at most two one-second CLI probes. Normal status requests do not launch a CLI.

Validation: 35 frontend/runtime/navigation checks and 8 MCP service checks passed. The generated client builds and the official Cloud mirror check passes. Browser visual acceptance remains pending because the computer-use service could not start. No product process was restarted; existing-entry inspection requires loading the updated backend. UI and final review were handled by the primary agent; the backend subtask requested Sol/high (independent actual-model runtime metadata was unavailable).

## MCP settings panel: three-step setup card (2026-09-08)

The settings page is one card instead of two loose groups: a header with live status pill and Check again, three numbered steps, a collapsed manual section and a capability footer. The approved visual source is the Canvas design "MCP 设置面板重设计" (documentId `bd323150-3646-4a54-9439-149c68b29d0c`, widget `widget-2`).

| Product region | Catalog source | Applied rule |
| --- | --- | --- |
| Header + status | Workbench page-status examples | One identity block, one semantic status pill (`data-state` on/off/pending) and one quiet refresh action |
| Steps 1–3 | Settings rows with numbered steps | Badge + title + hint; the permission switch stays on step 1, client selection on step 2 |
| Client selection | Catalog radiogroup cards | Three cards replace the select; `:has(input:checked)` tint, keyboard focus ring, Other opens manual details |
| Example prompts | Catalog list rows with trailing icon action | Six full-width rows: icon, title, prompt text, per-row copy with transient done state |
| Manual + footer | Catalog disclosure and quiet footer | Manual follows step 2 and stays collapsed; Config JSON / Skill / Guide hint; three capability notes |

Step 3 examples (EN / ZH), each copied verbatim from its row: Three design options 三个设计方案, Compare architectures 新旧架构对比, Handwriting to Widget 手写内容转 Widget, Show a folder 展示文件夹内容, Echo code changes 改代码并回显重点, Revise from feedback 根据界面反馈修改. Prompt trigger words (PenEcho, echo, canvas, 画布) use bold primary text while copied prompts remain plain text. Remote browsers retain disabled host-only automatic configuration controls and readable manual host instructions; they do not receive local launch paths. Copy feedback uses the shared `mcpExampleStatus` live region and reverts after 2.4 s; the button shows a check for 1.6 s.

Verification: `test/mcp-settings.test.js` covers the radio-card configure request, Other → manual disclosure, localized example copy and the existing configure/status contracts (20/20). Full `node --test` keeps the same 21 pre-existing failures as before the change. Browser acceptance on the running 3921 service covered EN/ZH, 1280 × 800 and 700 × 900 (stacked cards), client-card selection, Other auto-opening manual details, and a real clipboard copy of the Chinese prompt; the test tab's language and viewport were restored. No commit or push was made.


### Rename an open document

`penecho_rename_canvas({instanceId, canvasId, documentId, title, requestId})` updates the exact open document. Obtain all three IDs from `penecho_list_canvases`; the connection ID is not the document ID. `title` must be a nonblank string of at most 48 characters, without control characters; leading/trailing spaces are trimmed. Reuse the same request ID and arguments after an uncertain outcome, and use a new request ID for a new rename.

The tool updates the workspace name without showing the document, capturing content, changing its content revision or resetting an AI conversation. For an existing Device, Server or Cloud saved copy, it updates only that copy's name metadata through the existing storage API. It does not save unsaved drawing changes or create a saved copy. The result contains `documentId`, `title`, `active`, `applied:true`, `saved` and timing; `saved:false` means an unsaved document's workspace name was updated. If the saved name update succeeded but workspace persistence failed, the error includes `details.savedNameUpdated:true`; retry to reconcile.

Browsers advertise `documentRename:true` in their existing hello frame. Older browsers continue to use all existing tools; invoking rename returns an immediate `unsupported_operation` until the Canvas client is upgraded/refreshed. Titles are published through the same open-document catalog used by the browser and MCP list/find. The new endpoint is a tool on the existing MCP transport, not a new HTTP route.
