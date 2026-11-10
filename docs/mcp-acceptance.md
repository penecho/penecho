# MCP 自动验收 · 2026-09-10

本次已通过 SSH 自动执行 Windows 验收，无需手工开启 40 个聊天或修改日常配置。Windows 为 `DESKTOP-L25PJSB`、Node 22.15.1、实际 Codex CLI 0.149.0；PenEcho 主机为 macOS `192.168.3.158`，真实 Edge 测试页面为 `http://192.168.3.158:3921/`。

## 已验证结果

| 验证 | 结果 | 范围 |
| --- | --- | --- |
| 40 个真实 Codex 任务，8 路调用并发 | 40 个不同真实文档 | 通过 Codex app-server 的 MCP 调用接口，无模型请求 |
| HTTP 空闲 60 秒后，同任务继续调用 | 原文档恢复 40/40，串线 0 | CLI 启动数仍为 40，空闲期间退出 0，无 MCP reload |
| Codex 验收退出 | 残留客户端进程 0 | 独立 CODEX_HOME 自动删除；测试画布随后通过 UI 关闭，释放打开容量 |
| Windows 发现故障矩阵 | 10/10 | 有效 IP、坏 IP→缓存、缺失/失效/损坏/不可读缓存→真实 DNS-SD、TLS 卡住→缓存/发现、模拟无广播失败及后续真实发现恢复 |
| 40 个 Windows 进程同时冷启动发现 | 40/40 成功，仅执行 1 次真实发现 | 同一隔离共享缓存、统一开始屏障、40 个进程均验证主机；约 4.40 秒全部完成，进程/临时文件已清理 |
| 同一 Windows CLI，隔离服务真实换端口 | 两阶段通过 | 空闲→更新缓存恢复；再次空闲→旧地址与缓存失效→真实 DNS-SD 恢复；PID、模拟文档及对外句柄不变 |
| 协议会话上限 | 256 接受，第 257 个拒绝；释放后可重建 | 主机上隔离的实际 HTTPS 服务实现 |
| 请求并发上限 | 单会话 8 / 第 9 个拒绝；全局 32 / 第 33 个拒绝 | 在途请求被有意挂起以真正达到并发上限；释放后新请求成功 |
| 空闲容量回收 | 空闲 owner 释放，在途 owner 保留 | 隔离服务推进测试时钟，不等待真实 30 分钟 |
| 工作区恢复容量 | 64 上限及超过 32 个文档恢复通过 | 修复遗留 `.slice(-31)`；42 项画布测试通过 |
| CLI / 发现回归 | 29/29 | 含更新缓存、真实 HTTPS 换端口、状态读取权限、超时、取消、EOF、主机身份与证书拒绝 |

发现测试使用 Windows 上的真实 UDP DNS-SD 与主机 HTTPS，临时复制现有信任到隔离目录，不改真实凭据或 AI 配置。不可读缓存用精确的 EACCES 故障注入；无广播停机用显式空结果模拟，不声称断掉了用户真实网络。换端口测试则真实重启隔离 HTTPS 服务，使用独立证书与模拟文档，不重启 PenEcho 应用。

本轮 10 项矩阵中，TLS 无响应在约 506–512ms 后回退；真实发现阶段约 317–1504ms。此前首轮完整准备/发现总耗时曾到 6.27 秒，因此不能承诺所有网络环境都在 1 秒内完成。换端口后的整次工具恢复分别为 859ms（缓存）和 3048ms（真实发现），包含重新初始化与绑定恢复。

## 验收中发现并处理的问题

- 最初旧浏览器连接不响应画布创建。明确选中用户指定的 Edge 页面并启用 MCP 后，实际创建成功；不能以 `list_canvases` 能看到注册记录代替浏览器响应验证。
- 打开很久的页面仍执行旧的 32 上限，第一轮只创建 8 个文档并返回 `DOCUMENT_LIMIT`。刷新加载新页面后 40/40 通过。刷新会生成新 browser canvasId，验收脚本支持 `--canvas-id` 明确选择当前连接。
- 工作区加载仍硬编码恢复 31 个后台文档。现改为按 64 上限、扣除已存在文档后恢复有效记录，排除关闭、重复、无效记录，并增加回归测试。
- Windows 临时目录删除可能短暂返回 EBUSY。验收清理增加有限重试；进程记录器改为同进程加载真实 CLI，避免额外包装子进程影响生命周期观察，并验证结束后 PID 已消失。

## 自动运行入口

日常配置保留默认 30 分钟 HTTP 空闲释放。以下 60 秒参数仅写入验收的临时 CODEX_HOME，不应写进日常配置；不要使用 `--idle-exit-ms`。

Windows 上已有验收文件目录：`C:\Users\msi\.penecho\mcp\acceptance-current`。其中 `client.js` 是当前源码生成的完整轻量 CLI，`lib` 是发现测试所需的四个独立模块。导入的正式信任仍在 `%USERPROFILE%\.penecho\mcp`。

```powershell
node C:/Users/msi/.penecho/mcp/acceptance-current/lifecycle.cjs --codex C:/Users/msi/AppData/Roaming/PenEcho/tools/codex/bin/codex.exe --client C:/Users/msi/.penecho/mcp/acceptance-current/client.js --host-id <hostId> --canvas-id <当前已启用的浏览器ID> --count 40 --concurrency 8 --idle-timeout-ms 60000 --output lifecycle.json

node C:/Users/msi/.penecho/mcp/acceptance-current/discovery.cjs --module-dir C:/Users/msi/.penecho/mcp/acceptance-current/lib --host-id <hostId> --state-directory C:/Users/msi/.penecho/mcp --endpoint <当前有效HTTPS地址> --output discovery.json
```

并发冷启动测试入口是 `scripts/mcp-discovery-concurrency.cjs`（Windows 对应 `acceptance-current/discovery-concurrency.cjs`），使用与发现矩阵相同的 `--module-dir`、`--host-id`、`--state-directory`，加 `--count 40 --output discovery-concurrency.json`。

生命周期脚本会创建测试画布。预先留出 40 个打开名额；测试后可关闭这些带批次名的画布。它只会结束自己创建的 Codex/CLI，不操作日常任务。

主机仓库中的隔离服务测试：

```sh
node scripts/mcp-capacity-acceptance.cjs --output capacity.json
node scripts/mcp-lan-recovery-acceptance.cjs --address 192.168.3.158 --output lan-recovery.json
```

第二条命令通过已有的 `penecho-windows` SSH 别名驱动 Windows peer，peer 路径可用 `--peer` 覆盖。信任仅通过加密 SSH stdin 传递；结果不包含 token 或证书。

Windows 通过报告：`acceptance-current/lifecycle-40-verified.json`、`acceptance-current/discovery-full.json`、`acceptance-current/discovery-concurrency.json`。主机本轮结果目录：`/tmp/penecho-win-acceptance.p1vimg/`，包含上述报告副本、`capacity.json`、`lan-idle-recovery.json`。报告均以 `passed` 和各检查项判定，失败退出码非零；手动 reload 不计入自动恢复成功。

主任务负责 Windows/Edge 执行、集成修复和结果核查；发现、限额、LAN 恢复脚本由请求的 Astra / low 子任务实现，主任务逐一审查并真实运行。模型说明依据委派参数，未另行核实提供商运行时模型身份。
