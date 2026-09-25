# PenEcho 自动 MCP 浏览器草稿：实现与发布交接

日期：2026-09-23。状态：已写入正式 Canvas / Cloud 项目并完成本机验证；未提交 Git、未推送、未部署、未申请市场审核。本文件取代早期建议方案，以下以当前实现为准。

## 已实现的使用流程

Scope correction (2026-09-25): this document records plugin development work only. It does not define the general MCP connection workflow. General MCP instructions and the Canvas skill have been restored to the Canvas 1.3.3 contract. Design any future plugin onboarding separately; do not inject this document's browser-workspace or guest flow into general MCP instructions.

- 不输入配对码；OAuth 后不再要求复制 Access Token。授权页面保留明确的同意/取消操作。
- 页面复用完整 Canvas。外部 Agent 可渲染、编辑、读取反馈；PenEcho Agent 和 Cloud 保存按现有登录、权限和计费规则执行。
- 草稿及其附件保存在当前浏览器的独立 IndexedDB 命名空间。创建草稿和登录都不会自动创建 Cloud 项目或文档；用户点击保存才写入 Cloud。内容仍经过 MCP 服务中转，不声称完全不经过服务器。
- 登录前持久化草稿，返回相同草稿地址。刷新可恢复文档、内容和 MCP artifact；首次进入不会出现挡住画布的新手引导/更新弹窗。
- 启动链接使用 120 秒有效的一次性票据，放 URL fragment，页面立即移除；兑换为仅该 workspace API 路径可用的 HttpOnly Cookie。永久凭证不放启动 URL。
- `sessionKey` 绑定 workspace，workspace 绑定第一次确认的 documentId。新窗口、重试、活动画布切换都不改变旧会话目标。同草稿重复窗口通过浏览器锁避免并发写入。
- 浏览器渲染仍要求页面在线。此版没有无人浏览器的服务端渲染器。是否打开侧栏由宿主能力决定，MCP 本身不能强制侧栏。

## 身份与凭证

| 类型 | 当前规则 |
| --- | --- |
| 注册账户 PAT | 沿用既有永久 Token；登录、打开草稿、重试不会轮换。用户显式重置/撤销才改变。多个客户端可以使用同一 PAT。 |
| 注册账户 OAuth | 账户授权无固定到期，Access Token 短期有效并由客户端刷新；Dashboard 可按 grant 撤销。每个客户端独立保管刷新凭证。 |
| 匿名 OAuth | 独立 guest principal，不伪造注册账户。只能使用该来宾可见的草稿运行时；受在线租约和匿名额度限制。 |
| 浏览器启动权限 | 只能连接明确的 workspace，不等于账户网页登录，也不能读取 PAT。 |

已有 PAT 的已登录网页入口复用对应 grant；无 PAT 时创建网页专用授权，不为了打开网页额外生成或替换 PAT。读取历史不可恢复 Token 时不会偷偷重置。

网页登录和外部客户端授权是两条独立身份通道。登录后原匿名连接继续修改原草稿，用户可以手动保存；匿名连接不会因此得到账号的 Cloud 库、永久 Token 或内置模型权限。若外部客户端需要账户 MCP 权限，使用其正式账户 OAuth 连接流程，仍自动保存凭证。不能把网页登录宣传成可以静默修改所有第三方客户端凭证库。

## 安全边界和正常使用

- OAuth 延用 authorization code、PKCE S256、resource 校验和精确 redirect URI；同源表单有 CSRF 防护，并行授权页复用有效 CSRF cookie。
- guest / account 的 principal 同时用于集群路由、工具调用、图片上传、撤销和工作区所有权验证。
- 浏览器 WebSocket 必须提供该 workspace 的 Cookie，hello canvasId 必须完全匹配。账号 A 的 workspace 在账号 B 的登录浏览器中被阻止。
- 自动打开的草稿 MCP 不能借用浏览器登录状态搜索/打开其他 Cloud 存储文档，也不通过重命名修改已保存的 Cloud 副本。显式用户保存和手动打开仍保留。
- 同一个会话反复打开复用已有 workspace，不计新建额度。匿名新建起始额度为每个 principal 每小时 60 份；新 guest 身份有每个来源网络每小时 300 次兜底。达到上限提示稍后重试或登录，不撤销已存在连接，也不轮换 Token。
- 服务端执行仍保留并发、队列、上传尺寸、WebSocket 帧和耗时边界；登录取消的是匿名新建限制，并非无限资源许可。
- 在线浏览器每 30 秒续租；网页每 5 分钟续期浏览器连接 Cookie。匿名轻量工作区断开约 24 小时后失效；注册工作区连接记录为可续期 30 天。凭证与连接记录生命周期分开，注册 PAT 不因此过期。
- 临时连接回收不删除本地 IndexedDB。长时间断网/系统休眠无法等同于在线；失效后需重新打开连接，旧地址仍可恢复本地内容。清空浏览器数据会删除本地草稿。
- 废弃授权记录定期清理；撤销 grant 后不允许续租复活。

## 实现文件

Canvas 正式来源：`/Users/heack/workspace/penecho_071_version`。

- `src/client/app/canvas-documents.js`：独立草稿存储、刷新恢复、登录前 flush、同草稿窗口锁、MCP 本地作用域。
- `src/client/app/core.js`、`persistence.js`、`canvas-agent-runtime.js`：默认设备草稿、登录保存、来宾 Agent 入口和首次启动状态。
- `src/client/app/mcp-runtime.js`：稳定草稿 canvasId、重复窗口连接处理。
- `public/remote-canvas.js`、`mcp-cloud-transport.js`、`cloud-connect.js`：草稿打开、受限 WebSocket、续租、登录返回。
- `src/server/mcp/service.js`：浏览器 hello 精确目标校验。
- `public/app.js`：正式源码构建产物，不手改。

Cloud 正式服务：`/Users/heack/workspace/penecho_cloud`。

- `src/services/mcp-workspaces.mjs`：guest、workspace、租约、原子创建、票据、额度与目标绑定。
- `src/routes/mcp-workspaces.mjs`：授权 bootstrap、匿名同意、网页打开/兑换/续租/状态/配置接口。
- `src/services/mcp-authorization.mjs`：guest 授权接入和原子记录操作，保持账户永久凭证语义。
- `src/services/cloud-mcp.mjs`：`penecho_open_workspace`、`penecho_workspace_status`、`penecho_get_profile` 与 OAuth 工具 metadata。
- `src/services/mcp-cluster.mjs`、`src/routes/mcp.mjs`、`mcp-images.mjs`：guest principal 路由与权限。
- `src/app.mjs`、`public/js/mcp-connect.js`、`public/mcp-connect.html`：公开草稿壳和一次授权/自动打开页面。

Canvas 资源和 runtime 已通过 Cloud 官方同步脚本同步；上述镜像不作为另一个源码来源。

## 插件与发布

正式插件目录为 `integrations/penecho-cloud`，版本 1.1.0。包含 Codex、Cursor、Hermes portable、Hermes 原生 MCP 目录和 MCP Registry 配置，以及共享 Canvas Skill。完整部署步骤和市场提交入口见 [RELEASE-CHECKLIST.md](../integrations/penecho-cloud/RELEASE-CHECKLIST.md)。

Codex / Cursor 走原生远程 MCP OAuth。当前安装的 Hermes portable HTTP 翻译没有传递 OAuth 开关，因此 portable 包使用固定 `mcp-remote@0.1.38`（Node.js 20+）；其实际发布版本已完成 PKCE + 自动凭证持久化 + 工具调用验证。Hermes 原生 MCP 目录采用直接 HTTP OAuth，不需要这层兼容桥。两者选一，避免重复 MCP。

市场提交的固定 SHA 必须来自真正提交并推送的版本。`scripts/prepare-penecho-marketplaces.cjs --sha=<40位发布SHA>` 校验版本和包完整性，生成 Hermes 目录与 pack 文件，不伪造提交、不自动发布。

## 本机验证与待验收

- Canvas：1,019 项相关回归测试通过；`build:client` 与 `check:client` 通过。
- Cloud：45 项 MCP 授权、图片、集群、匿名工作区与账号隔离测试通过。
- 真实 Chromium：匿名 OAuth、自动打开/连接、Widget 渲染、两个会话独立窗口、刷新恢复、登录保留草稿、不自动上传、显式保存、PAT 不变、匿名登录后禁止访问其他 Cloud 文档。
- 发布版 `mcp-remote@0.1.38`：服务发现、PKCE、浏览器授权、自动保存凭证、已认证工具调用通过。测试仅将打开外部浏览器的动作替换为测试浏览器导航，OAuth 由实际发布包执行。
- Codex manifest 校验、当前 Hermes doctor / validate / portable loader 校验通过。
- 渲染截图和可重复执行脚本在 Cloud 的 `docs/testing/mcp-workspace/`、`tools/mcp-workspace-smoke.mjs`；服务端测试为 `test/mcp-workspaces.test.mjs`。

待发布候选环境验证：真实 PostgreSQL / Redis 多节点、原生 Codex/Hermes 的授权窗口及自动打开行为、生产域名与代理配置、市场审核。现有本机内存/模拟集群测试不替代这些验收。旧生产端点不支持新工具，必须先部署本次服务端和同步客户端，再发布插件。
