# PenEcho 1.1.0 自动 MCP 画布：发布与市场提交

本次交付是源代码和提交材料；未部署生产、未推送、未提交市场审核。正式 Canvas 源码来自 `penecho_071_version`，Cloud 中的 Canvas 客户端和 MCP runtime 必须用官方同步脚本更新。

## 用户流程与边界

安装启用包含 MCP + Skill 的插件 → 客户端触发 OAuth → 用户选择匿名试用或登录授权 → 客户端自动保存凭证 → Agent 调用 `penecho_open_workspace` → 打开返回的网页 → 查询 `penecho_workspace_status` → 使用返回的精确参数开始会话。

无需输入配对码、无需 OAuth 后再填 Token。手动 PAT 是高级替代配置，不是默认流程。画布内容在浏览器中渲染和保留；浏览器关闭时无法继续渲染。侧栏或外部浏览器由宿主决定。注册账户的 PAT 不因这些操作变化；主动重置/撤销才失效。

匿名浏览器登录后原草稿不变，可以手动保存到 Cloud；不会自动在项目中创建文档。匿名 OAuth 凭证不被提升为账户权限。需要账户 MCP 权限时由客户端再次启动账户授权，自动保存新凭证，不让用户复制 Token。

## 上线前

1. 保留并核对正式仓库已有改动。Canvas 执行 `npm run build:client`、相关测试和 `npm run check:client`。
2. Cloud 执行官方同步，至少包含本次改动的 `app.js,cloud-connect.js,mcp-cloud-transport.js,remote-canvas.js` 和 `src/server/mcp/service.js`，用对应 `--check --only=...` 确认无漂移。不能手改镜像。
3. Cloud 需要既有 MCP 授权表及 070 永久 Token 迁移；本次复用该表，没有新表。生产使用持久 PostgreSQL、Redis 集群路由以及稳定的 `PROVIDER_ENCRYPTION_KEY_BASE64`，不得因部署重置密钥。
4. 开启 `CLOUD_NATIVE_CANVAS_ENABLED=true`；内置 Agent 是否开启遵循已有生产配置和账户计费规则。反向代理允许 `/api/v1/mcp/workspaces/:id/canvas` WebSocket。不要把 `/canvas/draft/*` 或 workspace config/redeem API 做公开缓存。
5. Cloud 执行 `node --test test/cloud-mcp.test.mjs test/mcp-workspaces.test.mjs test/mcp-cluster.test.mjs test/mcp-images.test.mjs`；浏览器验收执行 `PLAYWRIGHT_MODULE=/absolute/path/to/playwright node tools/mcp-workspace-smoke.mjs`。后者只启动本机内存测试站点。
6. 先部署服务端和同步后的客户端，再发布插件 1.1.0。旧版生产没有 open_workspace 工具，不能提前向用户发布新 Skill。
7. 在 UAT/prod 分别实际完成一次匿名和账户 OAuth、生成图形、登录保存、关闭后重连、多窗口绑定和撤销。当前本机测试不等于生产或客户端市场验收。

## 提交文件

| 目标 | 文件与入口 | 额外要求 |
| --- | --- | --- |
| Codex / OpenAI | `.codex-plugin/plugin.json` + `.mcp.json` + `skills/penecho-canvas/SKILL.md`；服务 `https://penecho.ai/mcp` | 官方 With MCP 提交流程；开发者身份、域名验证、隐私/条款、功能测试与审核 |
| Cursor | `.cursor-plugin/plugin.json` + 共享 `.mcp.json`、Skill；仓库已有 `.cursor-plugin/marketplace.json` | 推送可访问源码后填写 Publisher 申请；审核不自动完成 |
| Hermes MCP 目录 | `hermes/optional-mcps/penecho/manifest.yaml` | PR 到 NousResearch/hermes-agent 对应目录；原生 HTTP + OAuth，不依赖 Node 代理；该目录不自动安装独立 Skill |
| Hermes 插件目录 | 根 `plugin.json` + `mcp.json` + `skills/`，以及 `hermes/catalog-entry.json` 生成的提交条目 | Portable 包包括 Skill 和 MCP；本机 Hermes 原生 portable HTTP 缺少 OAuth 开关，所以包中固定使用 `mcp-remote@0.1.38`（Node.js 20+ / npx）。说明依赖，不承诺零本地依赖 |
| MCP Registry | `server.json` | 使用 `io.github.penecho/cloud`，验证 GitHub namespace，再用官方发布工具；Registry 收录不等于其他市场收录 |

Hermes 的 OAuth 兼容桥只处理协议和凭证，不运行 PenEcho 桌面。npm 发布包 0.1.38 已核对，完整性为 `sha512-w+JU4U3CfG29TawXR4JLNQ9d1Un5nT8AGI65f/juCaqUdF/V6fS7wE4o7xNPbB8X58o46hRXEJgYglQMAKQs4w==`。不要改用 `@latest`。凭证由桥保存在 `~/.mcp-auth`，文件以 0600 创建，不放进 Skill、仓库或命令行。Hermes MCP 目录与 portable 插件应择一配置 MCP，避免重复连接。

Hermes 插件目录要求真实发布和固定 40 位提交 SHA。完成本次代码提交后执行：

```sh
node scripts/prepare-penecho-marketplaces.cjs --sha=<完整发布提交SHA>
```

脚本确认该提交包含同版本完整插件，输出到 `dist/penecho-marketplaces/1.1.0/`：`penecho.yaml`（提交到 `plugin-catalog/`）、`hermes-pack.yaml`（带 monorepo subdir 的安装包）、`mcp-manifest.yaml`。不伪造 SHA、不自动发布。推送并发布同一 SHA 的 tag/release，再提市场 PR。也可用 `hermes plugins install https://github.com/penecho/penecho#integrations/penecho-cloud --ref <SHA>` 安装已推送的指定版本。

## 审核用例

正向：①匿名首次授权生成图；②已有账户一次授权自动连接；③同一会话重复请求复用草稿；④两会话两窗口各自修改；⑤登录后保留内容并手动保存 Cloud；⑥刷新后恢复同一文档和 artifact；⑦用户明确选择现有画布时继续原有流程。

反向：①跨用户/跨工作区 ticket 与 cookie 不能使用；②过期或重复消费的启动 ticket 失败；③跨站 POST 和未授权 WebSocket 被拒绝；④撤销 grant 后新请求立即失败；⑤匿名新建额度达到阈值提示重试/登录，但既有会话不被撤销；⑥新窗口或活动文档变化不能让旧会话落到另一个文档；⑦匿名画布登录后 MCP 仍不能读取其他 Cloud 文档；⑧账号 A 的工作区不能在登录 B 账号的浏览器中建立连接。

## 验证记录与后续

- Codex Plugin Creator 本地校验通过。
- 当前安装的 Hermes `plugins doctor` / `plugins validate` 通过；其实际 portable loader 识别一个 Skill 和 MCP 配置。它不代表市场审核或远程生产连接已经通过。
- Canvas 相关回归 1,019 项通过，Cloud 相关回归 45 项通过；真实发布版 `mcp-remote@0.1.38` 已完成服务发现、PKCE、自动凭证持久化和工具调用。
- 服务端协议/隔离测试与真实 Chromium 草稿流程见 Cloud `test/mcp-workspaces.test.mjs`、`tools/mcp-workspace-smoke.mjs` 和 `docs/testing/mcp-workspace/`。
- PostgreSQL/Redis 多节点的生产容量、原生 Codex/Hermes 授权窗口、侧栏打开行为仍需在发布候选环境验收。不得在申请中标记未运行的项目为通过。

官方参考（核对日期 2026-09-23）：[OpenAI 提交](https://developers.openai.com/plugins/deploy/submission)、[OpenAI OAuth](https://developers.openai.com/plugins/build/auth)、[Hermes MCP](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp)、[Hermes 插件](https://hermes-agent.nousresearch.com/docs/developer-guide/plugins)、[Hermes 插件目录](https://hermes-agent.nousresearch.com/docs/user-guide/features/plugin-catalog)、[Agent Plugins MCP](https://agent-plugins.org/plugin-authors/mcp-servers)、[MCP Registry](https://modelcontextprotocol.io/registry/quickstart)。
