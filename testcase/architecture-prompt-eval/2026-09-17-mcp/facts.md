# PenEcho MCP 架构：本目录证据资料

资料范围：`/Users/heack/workspace/penecho_071_version` 当前工作树。依据可执行代码整理，包含尚未提交的当前改动。只描述本仓库能确认的事实；Cloud 自身内部实现不在本轮调查范围。

## 核心角色与边界

1. 外部 AI 客户端（例如 Codex、Claude）负责调用 MCP 工具、生成 HTML 等内容。MCP 服务执行画布工具，不需要再调用 PenEcho 的模型执行器来渲染该 HTML。
2. 外部客户端可以经一个轻量 stdio 桥接进程连接本地/LAN PenEcho HTTPS MCP。桥接源码是 `src/server/mcp/session-client.js`，分发后的文件名是 `client.js`；它不是完整 PenEcho 应用。桥接读共享主机凭据和发现缓存，校验 TLS，使用 HTTPS `/mcp`，复用连接。支持直接 HTTPS 的 MCP 客户端也能直接连该端点。
3. PenEcho Node 宿主里的 HTTPS MCP 接入、RPC/schema、会话与工具分派、浏览器通道是同一宿主内的不同职责，不是各自一台服务器。`direct-http-service.js` 拥有 HTTPS listener、认证和传输会话；`rpc.js` 处理 JSON-RPC；`schema.js` 定义和校验工具输入。
4. `service.js` 持有已授权浏览器连接、打开文档目录和画布会话，将工具调用绑定到明确浏览器与文档。`conversation-bindings.js` 持久化 client/sessionKey → canvasId/documentId 的绑定；浏览器连接 ID、文档 ID、业务 sessionId 与 HTTPS 传输 session ID 不同。
5. `bound-operations.js` 实现共用画布工具操作，负责版本/hash、幂等 requestId、虚拟文件读写和 Widget 交付等协调。浏览器执行具体文档动作，Node 端不是 HTML 排版渲染器。
6. 已 opt-in 的浏览器通过 WebSocket `/api/mcp/canvas` 连接本地 Node 宿主。`src/client/app/mcp-runtime.js` 发送 hello/打开文档 catalog，接收 call 并返回 result；心跳、断线和取消有处理。浏览器关闭授权不应继续接受外部画布操作。
7. `src/client/app/canvas-documents.js` 管理具体文档与执行上下文；浏览器里的 Widget host 以沙箱 iframe 展示 HTML/CSS/SVG。画布文档与快照由浏览器持有，不能把它们画成 Node 文件存储。工具的虚拟 source path（如 objects/<id>/widget.html）不是模型电脑上的真实文件路径。
8. 按需 authoring guidance 是 RPC 的独立只读分支：`penecho_get_guidance` 从 `authoring-guidance.js` 读取对应文档并返回 id/hash/document；该调用不需要进入浏览器画布队列或调用模型。本轮新增 `architecture` 独立规则，通用 `visual-explorer` 只列规则目录，不包含架构规则正文。

## 必须能辨认的关系

- 外部 AI 客户端 → stdio 桥 → HTTPS MCP 接入 → RPC/schema → 会话与工具分派 → 共用画布操作 → 浏览器文档运行时 → Widget 展示。结果/错误/截图沿实际请求通道返回。
- 直接 HTTPS 客户端绕过 stdio 桥，进入同一个 HTTPS MCP 接入，不经过另一个模型服务。
- RPC 的 guidance 读取分支 → 按需规则文件；此分支不经过浏览器渲染。
- 会话分派读取/更新持久会话绑定；浏览器持有文档/快照。两种存储的所有者不同。
- 外部 AI 给 `penecho_present_widget` 传 HTML，Widget 在浏览器内渲染；后续 `read_file` / `patch_file` 围绕同一文档的虚拟源文件工作。

## 可放入详情的实现事实

- 主宿主由 `src/server/main.js` 创建 MCP service；主 Web 服务默认 3888。MCP HTTPS 优先 3922、13922、23922，冲突后可选空闲端口；不要把这些候选端口画成多个服务器。
- `discovery-client.js` / `lan-discovery.js` 提供已认证端点发现、共享缓存和 LAN 广播；客户端先尝试已知地址和缓存，再按需发现，不需要常驻发现守护进程。
- 本地主机认证资料在主机 MCP 状态目录；桥接端有自己的信任/凭据资料。图中只画职责，不写凭据内容。
- 默认 HTTP 空闲清理不会终止仍打开 stdin 的轻量桥；下一次调用重连并恢复原文档，不能将可能已提交的写请求盲目重放。
- 设置开启请求日志时，`request-trace.js` 记录多轮 MCP tool/browser 交互；MCP 日志目录与 Agent 日志目录平行。日志不是实际画布源文件。
- 图片上传 `/mcp/images` 复用同一个 HTTPS 接入及认证，经服务端有界图片处理交给指定文档；不是额外独立上传服务器。
- PenEcho 内置 Agent 的 `document-tools.mjs` 也复用共用画布操作和 authoring guidance，它有自己的会话绑定；不要把内置 Agent 画成外部 MCP 的必经环节。

## Cloud 扩展：仅画已证实边界

本仓库还提供可选 Cloud MCP 画布通道。用户开启 Cloud MCP 后，浏览器经本地 `/api/mcp/cloud-canvas` 接入 `CloudMcpBridge`，它带宿主设备凭据连接 Cloud 的 WSS `/api/v1/mcp/device-canvas` 并双向转发画布帧。该路径由 Cloud 的 MCP 运行时发起画布操作，不表示云端请求必须串过本地 HTTPS MCP 工具分派。`remote.js` 另提供可复用的远端浏览器通道适配。无需把所有兼容入口放进主图；若展示 Cloud，明确“可选通道 / 云端内部未展开”，不得臆造 Cloud 数据库、队列或内部部署。

## 代码证据索引

| 文件 | 已核查位置 / 职责 |
| --- | --- |
| src/server/main.js:4146 | 创建 MCP service，复用本地宿主和配置 |
| src/server/mcp/session-client.js:30 | HTTPS 请求、TLS、传输会话与连接池 |
| src/server/mcp/session-client.js:44 | stdio 生命周期、会话恢复和有界并发 |
| src/server/mcp/direct-http-service.js:81 | HTTPS server 所有权与认证/会话 |
| src/server/mcp/rpc.js:8 | 协议分发及 guidance 独立只读分支 |
| src/server/mcp/schema.js:327 | guidance 输入验证；工具 schema 同源 |
| src/server/mcp/service.js:123 | 浏览器目录、会话绑定与工具分派 |
| src/server/mcp/service.js:365 | 浏览器 hello/catalog/result |
| src/server/mcp/service.js:420 | browser canvasCall |
| src/server/mcp/bound-operations.js:290 | 共用画布操作与虚拟源文件 |
| src/client/app/mcp-runtime.js:758 | opt-in socket 与浏览器执行 |
| src/server/mcp/conversation-bindings.js:7 | 持久绑定存储 |
| src/server/mcp/authoring-guidance.js | 独立规则 registry、惰性正文加载 |
| src/server/mcp/request-trace.js:74 | 按需 MCP 请求日志 |
| src/server/cloud-mcp-bridge.js:7 | 本地浏览器 ↔ Cloud WSS 透明通道 |
| src/server/canvas-agent/document-tools.mjs:32 | 内置 Agent 复用共用操作 |

这些是事实和证据，不是布局模板；主图选择、节点合并、视图数和方向由绘图模型按阅读任务决定。
