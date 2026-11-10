# PenEcho MCP 实现与验收

## 当前默认架构：会话级小型 CLI → HTTPS

PenEcho 启动 HTTPS，优先监听 3922，被占用时回退可用端口并通过 DNS-SD 广播。叶证书包含本机名字及私网地址；发现候选必须通过 CA、hostname/IP、hostId 和授权验证。浏览器独立 opt-in，新对话默认最近启用的浏览器。

AI 的标准 stdio 配置启动 `session-client.js`（打包为 `client.js`）。CLI 先试上次成功的 IP＋端口（首次使用 initialUrl），失败后重读共享 endpoint 缓存，最后按需发现一次；空闲 HTTP 释放后重连也走完整流程。`discovery-client.js` 单独负责导入/发现；重连不改 AI 配置。跨进程锁合并发现，每个登录用户共享 `.penecho/mcp/hosts/<hostId>`，没有 Gateway、开机服务或常驻发现进程。

`http-client-config.js` 原子更新 PenEcho 的 stdio 或兼容 HTTP 条目，保留其他服务/scope，检测并发修改。CLI 自己加载 CA；默认 stdio 不需要修改 AI 全局证书环境。保存配置与真实连接分别验证。

当前 Settings 默认不带进程闲置退出参数。30 分钟只释放 HTTP，保留 stdin，在途工作受保护。EOF/signals 退出并尽力 DELETE。AI host 决定子进程启动/重启，通用协议不保证死进程自动重启。进程内保留的绑定支持 HTTP 重建；跨进程需要 AI 使用原 client/sessionKey/documentId 调用 start_session。64 个打开文档和 64 个注册浏览器上限不变。

Windows 生命周期脚本 `scripts/mcp-codex-session-lifecycle.cjs` 默认测试 40 个真实 Codex 任务、1 分钟 HTTP 空闲释放及原任务自动恢复，不调用模型；使用隔离 CODEX_HOME，不修改日常配置。只有显式 `--idle-exit-ms` 才测试真正退出进程，手动 reload 恢复单独记录，不能计入自动恢复。当前 Windows / 真实 Edge 验收见 [自动验收记录](mcp-acceptance.md)。此前真正退出 CLI 的诊断得到自动恢复 0/2、手动 reload 恢复原模拟文档 2/2，因此默认仅释放 HTTP。

`penecho_start_session` 的 title 必填，instanceId/canvasId 可省。新对话可使用最新注册的授权浏览器；显式目标仍使用准确 ID。稳定 client + sessionKey 保持 documentId；重连恢复原对话，不改投当前最新文档。已关闭的持久文档可后台恢复，restore 默认 true，show 默认 false；仅明确 DOCUMENT_NOT_FOUND 时允许替代新建，restore:false 禁止替代，权限/存储失败不得降级成 missing。

入口仍为设置 → MCP 服务。设置展示配置、信任及重载要求，浏览器授权与服务器运行分开。用法见 [设置文档](mcp-setup.md)、[配置提示词](mcp-agent-instructions.md) 和 [可选工作流](../skills/penecho-mcp/SKILL.md)。页面呈现规则保持不变：新 Widget/plot 默认 page 1200×800，显式 base 480×360，源码更新保留几何。

## 当前轻量 CLI 验证（2026-09-10）

- 344 项 MCP/Canvas 回归通过；随后补充缓存读取 EACCES/EPERM 的回退测试，发现模块 14 项全部通过。缓存权限问题不阻止尝试发现，凭据/CA 权限与 symlink 保护保持严格。
- 隔离真实 HTTPS：同一 CLI 经历空闲释放 → 旧 IP 失效 → 使用其他进程更新的缓存 → 再次空闲 → 缓存失效 → 发现新端点；两次均恢复原文档和客户端可见句柄，未退出 CLI。
- 本机安装的真实 Codex app-server、两个任务、测试 HTTP 空闲 150ms：等待 850ms 后旧 HTTP owner 均释放、两个 CLI PID 不变；同一任务继续调用，无需 reload，恢复两个原始模拟文档 ID，使用新的 HTTP owner。未调用模型或真实浏览器；进程与临时文件已清理。
- Settings 默认命令不带闲置退出参数，自动配置迁移可移除旧参数；Copy setup prompt 和 portable skill 保留旧关键词与 one-shot 示例。隔离 Electron 检查了宽/窄屏和 200% 缩放，手动区自动展开、复制可用、无区域横向溢出；生成文件和 diff 检查通过。
- Windows Codex 0.149.0 的 40 个真实任务通过 SSH 验收：40 个独立真实文档、HTTP 空闲 60 秒后自动恢复 40/40、无需 reload、串线 0、结束残留客户端进程 0。测试页面刷新加载 64 上限；完整 PenEcho 主进程未重启。详细发现/并发/限额结果见自动验收记录。

## 前一轮原生 HTTPS 验证（2026-09-10；不代表新的 CLI 验收）

- `node --test test/mcp-*.test.js test/canvas-documents.test.js test/canvas-fit-viewport.test.js`：307/307 通过。覆盖 TLS 信任、共享证书、独立协议 owner、发现缓存、配置冲突、重启绑定、关闭 Canvas 恢复、并发隔离、闲置与压力回收，以及 legacy 回归。
- 安装的 Codex 0.153.0 隔离验证：两个 task 独立 owner；同 task 复用；过期 404 后自动 initialize 并重试原调用成功；app-server 正常退出发送 DELETE，服务 session/socket 均清零。未发模型请求，未修改真实客户端配置；`thread/unsubscribe` 没有立即发 DELETE。
- HTTP 协议会话 256；总并发 32、单会话并发 8；TCP 512、空闲 keep-alive 约 5 秒。画布业务句柄总计 4096、每协议 owner 16；两层闲置 30 分钟回收，容量压力仅回收闲置至少 60 秒且无在途工作的候选。浏览器接收 dispose-session 后释放临时句柄，保留文档和作品绑定。完整分层限制见设置文档。
- 客户端生成文件检查与 diff whitespace 检查通过。当前运行的完整 PenEcho 未重启；新建浏览器验证标签页停在访问码页面，未完成本次新增状态的完整视觉验收。Windows 已检查公共启动路径和平台目录处理，尚未运行 Windows 应用验收。
- 主任务负责架构、UI、集成审查；两个子任务请求模型为 Astra / low，分别负责 HTTP 服务和发现/配置。模型分工依据工具调用参数，未另行验证运行时模型身份。

## 历史实现记录与 legacy 兼容

以下按日期保留旧版本设计、验收样本与功能演进记录；其中 stdio 启动、LAN 配对/lease、远端桥接下载和启动命令属于旧配置兼容说明，不是当前默认架构。旧记录中的测试数量和浏览器截图是当时证据，不代表本次 HTTPS 变更已完成视觉验收。当前连接与恢复契约以上文和实时 tools/list 为准。

## 设计来源映射

来源为 `penecho_design/penecho-design-language.html`，通过当前 Canvas 已有组件、样式和行为实现。

| 项目区域 | 目录章节或示例 | 应用规则 |
| --- | --- | --- |
| 设置左栏与 MCP 内容页 | `#complete-settings-pages`；Settings XL / nav-content | 沿用双区设置窗口、单一内容滚动区和选中栏目状态 |
| 配置、复制、检查、定位按钮 | `#buttons` | 复用现有 primary/secondary、compact 控件；只有配置动作使用主按钮 |
| 画布访问开关与客户端选择 | 设置页现有 switch / field 示例 | 原生 switch ARIA、共享 thumb 结构、关联 label，产品代码持有交互 |
| 会话列表 | Settings AI & connections 的行结构 | 标题与辅助状态在左，单个定位动作在右；长标题换行 |
| 手动配置和说明 | 设置内容页 disclosure 示例 | 次要内容按需展开；长路径换行，保持可复制的完整值 |
| 自动配置反馈 | 状态示例 success/error/loading、连接编辑器 footer-status | 紧随动作显示持久结果、下一步与 busy 状态；保留布局与独立复制反馈 |
| 画布 MCP 访问提示 | `.viewer-notice` 可交互页面状态示例、secondary compact 按钮 | 画布右下角持续显示开放、会话、修改中或断开状态，点击进入 MCP 设置；细边框标记画布开放范围，实际修改时短暂柔光；沿用 --pe-accent，避让 Agent/Navigator 和窄屏浮动入口，尊重减少动态效果设置 |

新增 CSS 限于布局、配置文本换行和会话行，未引入新设计 token。Session 状态是可选的紧凑公共投影，不要求在用户 Canvas 上创建内容文档。

## 验收记录

使用隔离状态目录和 Electron 配置，无模型请求，无真实客户端配置修改。

- 63 项针对性测试通过，覆盖 stdio 协议、先于应用启动、多实例发现、身份与会话隔离、取消与关闭、更新合并、截图返回、CLI 入口、Canvas 更新和快照生命周期。
- 桌面 Forge 打包检查通过，确认 MCP 后端、skill、两份设置文档被保留，其余开发文档仍被排除。npm dry-run 包清单也包含这些运行资源。
- 浏览器验收通过：两个并行会话、步骤更新、同一预览原位修改、独立截图、合并呈现截图、inspect、关闭与撤权。表单结构保留，390px 截图通过像素回归，16px authored 字号与响应式视口一致。
- 设置页检查 1440px、700px、中英文、200% 缩放，以及展开手动配置后的长路径。受检区域没有横向溢出，已查看实际截图。
- 简单表单的一次验收样例：进度入队确认约 0–2ms，单独截图 68ms，更新并截图 53ms。计时经过毫秒取整，包含本地桥接往返，不包含外部模型生成或客户端工具调度；不能据此推导所有页面都快于 Playwright。
- 较广的 `test/ui-controls.test.js` 为 112/113。未通过的是现有连接名称正则断言：期望旧的 API/CLI 名称表达式，当前连接实现包含其他任务的变化；本次没有改变该行为或弱化断言。
- Impeccable 静态检测因本机缺少解析依赖降级到正则模式，报告现有样式告警。该结果未替代浏览器视觉检查。
- 验收实例已经关闭，最后使用的监听端口已确认释放。

### 局域网地址访问回归

配置加载曾只接受 loopback，导致同一电脑通过自身 `192.168.x.x` 地址打开时返回 403，三个配置按钮变灰。现在浏览器配置与画布连接接受本机网卡的精确地址，仍检查页面访问授权；其他设备不能管理本机 AI 客户端，私有 RPC 继续仅接受 loopback 和实例凭据。

配置请求沿用页面认证头。加载失败原因独立显示，不会被“已复制”覆盖；检查连接可以重试，旧后端缺少 MCP 路由时提示重启服务。画布访问开关关闭时仍可配置客户端。

- 15 项 MCP 回归测试通过，覆盖本机与其他设备、认证拒绝、私有 RPC 边界、配置加载失败与重试。
- 隔离浏览器通过本机局域网地址验收：开关关闭时配置可用、错误可见、复制后错误保留、重试恢复，以及完整会话、预览、截图和撤权流程。

自动配置另有独立结果区，紧随按钮：立即显示处理中，明确区分已保存、已有配置但未验证、失败及网络结果不确定。已有条目不冒充已验证成功；复制不会覆盖结果。网络中断时提示先检查客户端条目，避免把可能已经写入的配置误报为未保存。该前端反馈由主任务直接实现；使用受控响应验收各状态，不修改真实客户端配置。

当前范围是本机 MCP 与 Widget 预览；没有实现 Cloud MCP 路由、任意网页导航或完整浏览器自动化。协议与 UI 已联合验收，尚未用真实 Codex、Claude、Kimi 或 ZCode 会话逐一完成客户端实测。没有发布或推送。

### 用户画布反馈

`penecho_inbox` 默认 `mode:"read", limit:10, capture:false`，分别返回 messages / feedback 分页。messageAfter 和 feedbackAfter 独立，不自动确认消息。需要像素时显式 capture:true；quality 默认 basic，可选 detail。内部反馈在文字确认、笔画结束、图片导入时记录，保留会话基线与未读游标；失败同游标重试。

截图包含新增 dirty 附近的当前设计和用户层，使用 120 个画布单位的边距；相距过远的标注自动分批，不受用户后来平移视野的影响。当前笔画未结束时拒绝截图，避免读取半截标注；没有反馈或 capture:false 时不截图。它不是历史快照或 OCR。后续修改前先读反馈，不自动唤醒停止工作的客户端。

已参考主 Canvas AI 的 planViewportImage/prepareOutboundAtlas（有界画幅、服务端无损 WebP）；MCP 直接复用已有 Canvas Agent 的 canvasAgentCapture/canvasAgentCompressedCanvas，有明确传输预算，避免重复服务端编码。basic 策略为最长边 1024、总像素 520000、WebP 初始质量 .72、编码图像最多 700 KiB（base64 前）；超限继续降采样，PNG 回退也受同一上限约束。服务端再次检查字节与尺寸。

本轮 32 项针对性测试通过，覆盖浏览器、传输、独立游标、呈现后基线、PNG 回退和超限失败。隔离局域网 Electron 验收实际文字、笔画、图片输入及默认截图，文字样本 856×606、14620 字节；这些是单次样本，不是性能保证。截图位于 `/var/folders/wq/vmfzmn0j33199mp1lzkmgs080000gn/T/penecho-mcp-browser-eRn8Hb`，已人工查看；全部测试端口已释放。

MCP 状态入口上移，避让新缩放工具条；宽、窄、200% 缩放和 Agent 展开时已检查可见性。技能补充主动提供有用预览、方案选择与图文解释，稳定更新作品，普通呈现不截图；选择仍通过聊天或原生 Canvas 标注表达，Widget 按钮尚无 MCP 回传事件。自动任务排版与成组视野已实现，见下节。

主任务负责架构、UI、集成与最终 review；后端/CLI/打包委派请求使用 Sol/high，文档/便携 skill 委派请求使用 Luna/max。已检查实际代码和验证结果，运行工具未独立提供子代理实际模型身份证据。

## MCP request logging

Local MCP uses the same Settings request-recording switch (`PENECHO_REQUEST_TRACE`)
and retention count (`PENECHO_REQUEST_TRACE_LIMIT`) as PenEcho Agent. Settings changes
follow the existing system-settings restart behavior. Disabled logging creates no
trace files and does not serialize payloads. Logging failures never change tool results.

Both directories are under the running host's state directory, not the bridge's
connection-discovery directory. Desktop uses Electron `userData`: on macOS normally
`~/Library/Application Support/PenEcho/logs/`, on Windows `%APPDATA%/PenEcho/logs/`.
Web/npm uses `PENECHO_STATE_DIR/logs/`, or the repository's `logs/` without a state override.

```text
logs/
  requests/                         PenEcho Agent requests
  mcp-requests/                      local external MCP requests
    request-<timestamp>-<hash>/      one logical request, multiple tool calls
      trace.json                    ordered tool index, status, session IDs and grouping boundary
      tool-0001-<hash>/
        trace.json                  tool arguments summary, outcome, timings, browser RPCs
        request.json / request.txt  full credential-redacted input
        response.json / .txt        full output, or error.json / .txt
        browser-N-request.json      forwarded Canvas RPC; response/error alongside
        *-source-*.html / .txt       complete source bodies
        *-image-*.png / jpg / webp   decoded image bytes
        *-images.json               image manifest
        queued-outcome.json         asynchronous application result, when applicable
      tool-0002-<hash>/
```

Grouping reuses owner-scoped sessionKey/sessionId bindings across reconnects.
An existing `completion.status` (done/waiting/error), applied final update_session,
or successful close_session seals a request. Subsequent authoring starts a new
folder; validation failures and repair calls stay together. Immediate capture/read
verification remains with the completed request. Sessionless guidance/discovery is
attached only when the active request is unambiguous for that owner.

MCP has no guaranteed external chat-turn identifier, so this is protocol-based
logical grouping, not an assertion that the host can observe every user message.
Clients omitting completion fall back to a new folder after 30 minutes of inactivity
or 1024 tool calls. No new model-output field or mandatory extra tool call is required.
Full payload/source/image files retain content omitted from the compact summary,
while credentials are redacted. Historical truncated logs cannot be reconstructed.
Retention applies to request folders, protects running/queued calls, and leaves
legacy session folders and unrelated files untouched. Files/directories are private
to the local user. UAT web deployment does not update an installed desktop host.

## Canvas live access indicator (2026-09-07)

The bottom-right control distinguishes opted-in waiting, bound sessions (client names/count), actual browser mutation, and unexpected disconnect. Clicking opens MCP Settings, where session rows include the last applied update time and access can be closed. The subtle boundary follows the available Canvas area; only start/update/present/close mutations trigger a short glow. Read, feedback and capture calls do not. The working label ends immediately on completion; the glow fades after 650 ms, without continuous animation or model calls.

The backend sends native WebSocket ping every 15 seconds, terminating connections with no pong for 45 seconds at the next interval. Browser JSON heartbeat is negotiated with `ready.heartbeat:true`; legacy servers remain compatible. Visible tabs detect stale responses, with visibility-resume grace for throttled background timers. Disconnect, canvas changes and service close clear timers and revoke session bindings.

Astra implemented and reviewed UI/integration; the backend worker was requested as Sol/high. 24 focused tests cover status semantics, heartbeat failure/cleanup and legacy compatibility. The isolated LAN Electron harness additionally verifies real in-flight mutation, session return, unexpected socket close, narrow/zoom/Agent-panel layouts and user-feedback capture. In-flight capture briefly holds the test browser's hash dependency to photograph the real pending operation. No production instance was restarted. Screenshots: `/var/folders/wq/vmfzmn0j33199mp1lzkmgs080000gn/T/penecho-mcp-browser-axEOFu`.

## PenEcho-owned task layout and camera

New MCP sessions reserve placement state without requiring a session board. New artifacts occupy stable rows in their task area. Placement checks other task areas, existing objects and ink; previous objects and user positions are never repacked. Existing preview updates retain location. Exhausted space returns an actionable error instead of overlapping content. Camera batching waits for a short quiet interval and the mutation queue to finish; only new objects trigger it. Large distant batches are offered one task at a time; very small automatic fitting is deferred for explicit inspection. Pointer/wheel interaction, active editing, hidden pages and navigation lock preserve user camera ownership. The Show new content action frames pending items, and Settings Show frames the whole task. Disconnect clears the owned timer and pending targets.

Design-source map: pending-content control → penecho-design-language.html compact secondary button / status examples → reuse existing Canvas MCP status area and wrap at narrow widths; no new panel. Work areas use session placement metadata and existing Canvas placement/framing primitives. Preplanned absolute creation avoids a duplicate global occupancy scan. No extra model calls or automatic screenshots are needed.

Root implemented and reviewed this UI work without delegation. Focused browser/runtime/compression tests pass (24 tests); isolated LAN acceptance covers three-preview placement, user camera pause, explicit resume, two sessions, narrow/zoom button usability and existing feedback capture. Existing saved canvases are not retroactively reorganized; newly started sessions use this layout. Reopen the updated Canvas and reconnect after preserving current work.

## Lightweight native MCP artifacts

At that stage, adding `penecho_draw` and `penecho_plot` brought the bridge to ten
public tools. The browser-owned
`mcp-primitives.js` prepares bounded native text/image records, lays out nodes and
resolves connector IDs, then commits one history transaction after checking the
current Canvas revision and execution. Shape/path images are not Widgets or user
ink tiles; they have no vector handles. Text remains directly editable. Plotting
reuses `compileExpression` and `plotObjectImage`; only MCP provides the internal
view override, leaving existing Main Canvas AI plot defaults unchanged.

Draw batches are complete snapshots of one session-owned artifact. Stable item
IDs preserve identities; omitted owned elements are removed, and unrelated Canvas
objects remain intact. User-moved node frames persist through source updates.
Connectors resolve at application time, not continuously during user drags.
Cached unchanged text and image content avoids redundant rendering/encoding.
Artifacts remain ordinary saved Canvas records; session source/update bindings
have the same connection lifetime as other MCP artifacts.

Both new tools optionally use `capture:true`, calling the existing basic Canvas
capture/compression path with a bounded region around owned objects. The image
can contain overlapping user material; capture does not consume feedback. Output
application succeeds before a separate optional capture, so a capture error can
leave the artifact applied; retry the same stable artifact IDs. No model calls
or automatic screenshots occur during ordinary drawing.

Design mapping: Canvas-generated content → existing native text/image/plot
primitives; Settings guidance → existing MCP settings help paragraph in the
canonical settings page pattern. No new workbench controls or style system were
introduced. Automatic grouping and camera ownership reuse the existing MCP queue.

Verification: 35 frontend/primitive/compression/settings/build-structure checks
and 13 backend/schema/stdio checks passed. Isolated LAN Electron E2E covered
labeled rectangles/ellipses, native text, arrows and paths, stable replacement,
restricted expression rejection, function capture, Undo/Redo, zero new iframes,
user feedback isolation and existing responsive/settings behavior. Evidence:
`/var/folders/wq/vmfzmn0j33199mp1lzkmgs080000gn/T/penecho-mcp-browser-okBxLN`.
Single-run measured update after content reuse: 16 ms (prior diagnostic run
2032 ms); drawing plus capture 232 ms; plot plus capture 35 ms. These samples
are not general performance guarantees. The isolated test instance was closed.
Root handled UI, native integration and acceptance. Backend was delegated with
requested Sol/high; actual provider/model identity was not independently verified.

## Persistent multi-document MCP server v1 (2026-09-07)

The public server now separates the opted-in bridge connection (`canvasId`) from
the persistent work document (`documentId`). `penecho_open_canvas` and
`penecho_find_canvases` are routed only through the exact active connection named
by `instanceId` and `canvasId`; the server does not search another host.
`penecho_open_canvas` requires an idempotency key and defaults `show` to false, so
opening or creating a document does not steal the current view. Provider
ambiguity, availability, and cross-storage errors can return bounded structured
details through HTTP and stdio error results.

`penecho_start_session` accepts optional `documentId` and `takeover`, and forwards
the exact optional client and session key. The browser-issued session ID remains
the routing authority for every later tool call. The server snapshot stores the
actual `documentId` only when the browser returns one, preserving compatibility
with older runtimes. Server session-key isolation remains owner-scoped; the
browser persists reconnect bindings for the exact client/key pair.

Virtual source tools never touch Node's filesystem APIs. Listing and reading are
browser operations over public Canvas virtual files. Patch requests are limited
to 800,000 bytes, reject traversal/backslash/NUL paths, and parse exactly one
existing-file unified diff whose headers match the requested virtual path.
The shared `src/shared/canvas-file-patch.js` parser validates the same strict diff on both server and browser. The server sends exactly one `mcp_patch_file` RPC with `{sessionId,path,patch,expectedHash,requestId,completion?}`. The browser checks the current source hash and applies the patch atomically using fuzz factor zero, retaining a receipt before returning. Completed retries return the cached result; unknown outcomes resend identical arguments and requestId. `SOURCE_CONFLICT` requires a fresh read and new requestId. No source is transferred back for a preparatory round trip.

Canvas edits use strict action-specific arguments. Image replacement accepts a
bounded PNG/JPEG/WebP data URL or `penecho-ref:objects/<encoded-id>/image`, which
the browser resolves only inside the bound document. Source replacement and
geometry edits are distinct operations. Move, resize, delete, erase, and replace
also require a current base revision, preventing a stale client from overwriting
newer user work. The inbox is pull-based:
`penecho_inbox` mode:read never means receipt; mode:ack explicitly records received/working/done/error for named IDs. There is no push wake,
automatic polling, Git integration, history API, or playback API in this version.

`penecho_capture_canvas` is the explicit bounded screenshot path for existing
Canvas content. It supports canvas, viewport, selection, region, object, and artifact (artifactId required)
targets with basic/detail quality, validates the returned image MIME type,
dimensions, encoded byte count, and revision, and reports `pixelVerified:true`
only after an actual image result. A background document returns structured
`CANVAS_NOT_VISIBLE` retry details and is never shown as a capture side effect.
The stdio adapter emits the image as MCP image content.

The browser's opt-in Widget choice contract uses only buttons carrying
`data-penecho-action="choose"` plus bounded `data-penecho-prompt`. A trusted
click queues text, `source:"widget"`, and the exact object/session/client/key in
the pull inbox. It does not invoke a model, serialize arbitrary forms or
passwords, or authorize an external action. Status still moves only through
explicit received/working/done/error acknowledgements. The virtual `context.md`
is user-editable document context and is appended to the internal PenEcho
Agent's local user turn.

The stdio server advertises four user-selected prompts through `prompts/list`
and `prompts/get`: Visual Explorer, explain selection, revise feedback, and resume document.
Initialization guidance states that cursors remain independent, visible document
changes require explicit show, read-before-patch is mandatory, and the primary
task continues when the optional bridge is unavailable.

## Presentation protocol

Widget, drawing, and plot calls accept an optional exact-key `presentation`
object. The server validates and normalizes intent (`explain|deliver|compare|review|inspect`),
role (`primary|supporting|alternative`), relative artifact placement, and attention.
Widget/plot size presets resolve server-side to base 480×360, wide 992×360, tall
480×752, large 992×752, or page 1200×800 before browser dispatch. Legacy explicit
dimensions remain supported and cannot be combined with an explicitly supplied
size. Drawings reject size and use natural scene bounds. Omitting presentation
leaves it absent so a stable artifact source update preserves prior presentation.

Widget-only inspect requires `capture:true`. The browser renders at the requested
viewport, compresses under the existing basic/detail policies, and returns the
capture in the same `mcp_present_widget` result with `ephemeral:true` and no
`objectId`. The server checks MIME/bytes, quality dimensions and pixels, viewport
metadata when supplied, revision, ephemeral state, and the absence of objectId;
it returns `applied:true`, `pixelVerified:true`, and never issues a second capture.
Normal presentation remains persistent and screenshot-free unless capture is
explicitly requested. Returned presentation and optional viewport metadata make
the result reviewable without changing built-in Agent authoring contracts.

The MCP Visual Explorer prompt slices the shared built-in design prose and adds
only external delivery guidance: meaningful intent and hierarchy, stable updates,
the size matrix, useful interaction, no fake callback controls, and explicit
pull-inbox read/ack behavior. It does not alter the built-in Agent contract or
auto-select a prompt, create a progress board, poll, or wake a stopped client.


### Lightweight spatial progress and visual guidance / 轻量空间进展与视觉指导

Keep the first useful output fast: no required plan, prompt retrieval or capture
before it. Send short public findings, decisions, blockers and completion through
`penecho_update_session` at natural work boundaries only when useful information
changed. There is no timer, tool-count quota or idle heartbeat. Read/ack inbox
messages at these checkpoints when awaiting input or working interactively.
Routine progress requires no generated diagram or screenshot. Reuse existing
useful previews and stable artifact IDs; create spatial explanations when they
help the task. Honor a quieter cadence requested by the user.

`initialize.instructions` and Widget tool guidance include compact Visual
Explorer principles. The optional `penecho_visual_explorer` prompt provides the
full shared design sections with MCP-specific delivery, loaded once when needed
for substantial visual authoring. New/reused session responses repeat only the
short workflow reminder; ordinary updates do not repeat these instructions.
Clients control prompt loading and tool execution. Existing clients need to
refresh/reconnect to receive changed initialization instructions/tool metadata;
this change does not wake stopped conversations or guarantee compliance.

首个有效输出不等待计划、完整规范或截图。只在发现、决策、阻塞、完成等自然节点且确有
新信息时发送简短进展，不设置周期、工具数量配额或空闲心跳。普通进展不
生成图或截图。复用有用的已有成果，必要时再制作空间图解。Visual Explorer 完整设计规范
通过可选 prompt 按需读取一次，默认仅附简短原则。客户端刷新连接后获得新指引；MCP
无法强制客户端执行或唤醒已停止的会话。


### MCP 设置方案 A 与持久局域网身份（2026-09-10）

“连接你的 AI Agent”保留本机自动配置，失败或跨机时展开一个复制入口。指引同时携带
本机配置和远端身份、下载校验、发现参数；要求更新已有配置，禁止重复条目与网络广播
自动替换信任。低强调证书重置按钮经确认执行，完成后提示所有旧远端配置更新。

证书和邀请原子保存于状态目录，正常重启保持身份；DNS-SD 公布当前私网地址和端口，
远端 TLS 校验通过后才发送凭据。断网优先复用授权，失效时凭已保存的连接密钥自动重新认证；不重放结果未知的
修改。Windows 多网卡 UDP 发送必须等回调后切换接口，覆盖 Hyper-V 虚拟网卡场景。

主任务完成 UI、整合和最终检查；两个子代理按 Astra/low 请求承担身份/发现及重连模块。
89 项针对性测试通过；实际 Windows→Mac 验证发现、重启换端口、画布读写、证书重置后
旧配置拒绝；中英文、125% 与窄窗口检查完成。Canvas 镜像通过官方同步脚本更新，未部署。


### 局域网免 Allow 连接

按最新交互要求，复制指引中的秘密连接密钥直接授权，证书指纹仅验证主机身份。
删除主机 Allow/拒绝/阻止配对弹窗和队列；有效密钥立即换取运行期令牌，重启自动
重新认证。无效密钥、公有证书指纹不能授权。证书重置同时更换密钥并撤销运行期令牌。

本轮 92 项针对性测试通过。Windows→Mac 下载校验后的桥接无需任何主机确认，完成工具、
指引、画布和 Widget 读写验收；英文长文案在宽/窄窗口与 125% 缩放下无横向溢出。


### Auto configure 更新已有配置

再次点击自动配置时，Codex 通过官方 CLI upsert 写入当前启动信息；Claude 只原子
替换用户配置中的 PenEcho 条目，保留其他服务及项目级配置。更新失败不先删除旧条目。
界面显示“配置已更新”，提示重载 Agent，不将配置保存表述为连接验证成功。
主任务完成 UI 与集成验收，按 Astra/low 调用的子代理负责配置实现并经主任务复核。
真实 Codex/Claude CLI 在隔离配置目录验证新建和覆盖；真实浏览器验证按钮更新、
宽/窄窗口与 125% 英文文案，未修改用户的实际 Agent 配置。


### 第三步：开始使用 Spatial Workspace

第三步给出关闭设置、检查工具栏 MCP 绿灯、发送给外部 Agent 的简短引导。默认突出
一条可直接复制的当前任务提示词，原有六个示例保留在默认折叠的“更多示例”。复用
现有设置步骤、提示词卡片、复制事件与原生 disclosure；主任务直接完成，无额外代理。
设计来源沿用 penecho_design 的 settings-content、prompt surface 与渐进展开规则。
34 项设置回归通过；真实浏览器检查中英文、宽/窄窗口、125% 缩放、一键复制和展开。

### Live MCP discovery resources

Both stdio and LAN expose `resources/list`, `resources/read`, and an empty
`resources/templates/list`. `penecho://guidance/discovery` directs clients to the
current tools, prompts and resource catalogs; `penecho://guidance/skill` supplies
live workspace guidance. The optional setup skill is a small bootstrap pointing
to these resources, with separate PenEcho, echo, canvas and 画布 examples.
Ordinary server catalog upgrades do not require rewriting remote launch settings:
the bridge forwards methods without a catalog allow-list or cached tool schema.
Clients may still need to refresh/reconnect to replace their own tool snapshot.
Reading live guidance does not silently rewrite an installed skill file.

MCP creation default: when size and dimensions are omitted, new Widgets and plots use `page` (1200×800). Explicit `base` remains 480×360; source updates preserve existing geometry.


## Compact MCP contract v2

The registry exposes all 19 tools. The common six are start_session, present_widget, read_file, patch_file, edit_canvas, and inbox; specialized metadata is a hint, never an access restriction or mandatory catalog-loading step. Retired capture_widget/read_messages/read_feedback/ack_messages names are not aliases. The built-in Agent exposes 13 current-document tools, omits external lifecycle tools, and removes sessionId from its input schema.

All content mutations require requestId, including present_widget/draw/plot. Mutations accept output:"concise" (default) or "detailed" and optional completion:{status,summary?,handledMessageIds?}, where status is done/waiting/error. All mutations except upload_image also accept opt-in capture with basic/detail quality. The browser applies content, performs any requested capture, then updates status/explicit acknowledgements in the same RPC. Failed capture preserves applied:true and captureFailure, without marking done. A failed final status/ack stage returns completionFailure rather than repeating the mutation. Source paths/hashes, viewport, identity, revision, image evidence and actionable errors survive concise output; detailed adds diagnostics/timing. An optional inboxSummary is limited to three messages and 600 total text characters, and never acknowledges them.

Session start returns guidanceVersion instead of repeating instructions. penecho_get_guidance defaults to detail:"brief"; detail:"full" retains full source guidance and examples. Reuse returned version/hash. Resources and initialization contain compact operational rules rather than repeated design manuals.

Run `node scripts/check-mcp-contract-budget.js` to report reproducible character/4 estimates (not provider-tokenizer counts). Use `--strict` to fail on all budget targets; validation semantics take priority over the 6000/all and 3000/common targets. The script always checks 19 tools, six common tools, and the 250-token public instruction target. Runtime latency must be measured separately from token estimates.
