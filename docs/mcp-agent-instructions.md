# Instructions for configuring PenEcho MCP / 让 AI 配置 PenEcho MCP

Give the following prompt to the AI responsible for setup. Supply the private trust bundle through a secure file, not the conversation transcript. The current tool schemas and live guidance remain the authority for operations; detailed presentation and feedback contracts are in [MCP setup](mcp-setup.md).

## Copy-paste prompt

```text
Configure this user's PenEcho connection using the small per-session stdio CLI, directly connected to PenEcho HTTPS.

PenEcho starts HTTPS with the application; browsers opt in separately. Do not add a gateway, daemon, startup service or background discovery loop. Do not start PenEcho incidentally.

1. Download and verify the supplied discover.js and client.js SHA-256 hashes. Store them below ~/.penecho/mcp (Windows %USERPROFILE%\.penecho\mcp); use Node >=18 and absolute script paths.
2. Import the private trust bundle once with: node /absolute/path/discover.js --import /absolute/path/trust.json. Do not add --client: this operation imports/discovers without touching AI settings. Delete only the temporary trust file after success.
3. Configure this AI's supported stdio MCP entry with command Node and args [absolute client.js, --host-id, hostId]. Preserve unrelated settings; replace only PenEcho's old transport fields. Remove old --idle-exit-ms arguments. The process stays on stdin and drops only its HTTP session after 30-minute idle, protecting in-flight requests. Report whether the running AI needs a reload and verify actual tools.
4. The CLI tries the last known numeric IP:port (or imported initialUrl), freshly read shared cache, then one-shot discovery. This complete fallback also runs after idle release: an old IP failure must check cache and discovery before failing. Verified discovered endpoints update the shared cache. Shared credentials/cache live below .penecho/mcp/hosts/<hostId>. Reconnection changes the cache, never AI configuration. The CLI loads the CA directly, so global AI trust changes are unnecessary for this transport. Never disable TLS or print credentials.
5. The AI host owns the stdio child lifecycle. A dead CLI cannot receive stdin; actual automatic respawn must be tested. Preserve client/sessionKey/documentId across process changes and explicitly restore the same binding with start_session. Distinguish automatic recovery from a manual MCP reload in test reports. Never replay a mutation with unknown outcome blindly.

Conversation routing:
- Call penecho_start_session with required title, stable client and a unique stable sessionKey per conversation. instanceId/canvasId are optional: a new direct-HTTP conversation defaults to the latest registered opted-in browser. For an explicit connection target, use the exact instanceId, canvasId and documentId from penecho_list_canvases. It mirrors the browser's open MCP workspace; manually created and loaded Canvases remain present until the user closes them.
- Retain sessionId and documentId. Reuse client/sessionKey across turns/reconnects. Existing conversations restore the original document, including closed saved documents in the background. restore defaults true; only DOCUMENT_NOT_FOUND permits a replacement. Permission/storage/provider errors are not absence. restore:false disables replacement; show defaults false.
- For an explicitly requested current Canvas, use target:"current" without documentId and read files/revision before editing. If already bound elsewhere, create a distinct stable attachment key and retain both handles. Never silently redirect existing work.
- HTTP initialization/session IDs are transport state, not conversation identity. Restore the same document after transport restart. Browser opt-out/disconnection revokes its live connection, not the saved document.

Work and visual contracts:
- Read live tools/list and guidance; do not cache guessed schemas. Virtual files do not grant host filesystem access. Preserve requestId for identical unknown-outcome retries; source conflicts require a new read and requestId.
- Keep artifactId stable. New Widgets/plots default to page 1200×800; explicit base remains 480×360. Presets wide/tall/large are 992×360, 480×752, 992×752. Do not combine size presets with explicit dimensions. Use explicit mobile dimensions when appropriate.
- Keep a complete page in one scrollable Widget, preserving the product UI and interactions. Use local buttons/filters without model calls. Only explicit data-penecho-action/data-penecho-prompt requests enter the pull inbox; they do not immediately invoke an AI or grant external approval.
- Ordinary presentation uses capture:false. Initial UI review or meaningful layout changes may combine capture:true at basic quality; inspect returned pixels before claiming visual verification. Inspect intent is ephemeral and requires capture:true. Preserve artifact IDs after capture errors.
- Preserve independent feedback/inbox cursors. Read and explicitly acknowledge messages; no idle polling or automatic wake-up of a stopped client. Publish concise public findings/results, never hidden reasoning, secrets or raw transcripts.

Existing penecho mcp / stdio.js and LAN pairing configurations are legacy compatibility only. Migrate the existing entry to client.js without adding duplicate transports. Report only what changed, actual verification, and remaining trust/reload/user opt-in requirements.
```

## 中文交付要求

按上述提示词配置轻量 stdio CLI，直连主机 HTTPS。发现与 AI 配置分开；共享 .penecho 缓存，重连不改 AI 配置。去掉旧的 --idle-exit-ms 参数；空闲 30 分钟只释放 HTTP，保留 stdin。闲置后旧地址重连失败，也继续读取新缓存和自动发现。必须分别验证 AI 是否重启子进程、是否恢复同一 Canvas，不能把手动重载算成自动恢复。

对话使用稳定的 `client + sessionKey`，保留 `documentId`；只有新对话默认选择最近注册浏览器。旧对话恢复原文档，关闭的文档可以后台打开。`title` 必填，`instanceId/canvasId` 可省，`restore` 默认 true；仅 `DOCUMENT_NOT_FOUND` 可以新建替代文档，权限/存储错误必须保留。需要查看当前画布时使用 `target:"current"` 并保持原有句柄隔离。

验收应区分“配置已写入”“CLI 已加载正确 CA”“实际工具连接成功”和“浏览器已授权”。不要把任何一项当成其他项的证明。保留所有无关服务、项目配置、现有作品与反馈游标。
