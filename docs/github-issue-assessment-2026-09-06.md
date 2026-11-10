# PenEcho 六个公开 issue 评估与回复草稿

核查日期：2026-09-06。以下为建议，尚未在 GitHub 发布回复或关闭 issue。

公开版本依据：GitHub main `84d4f8dc45cf5970193895f7d8b084d172f2dd7b`；[v1.2.0](https://github.com/penecho/penecho/releases/tag/v1.2.0) 标签指向 `bd8115cd5f672ca0ebbfa046c7bf3622e0427663`。两者提交不同，但 Git tree 完全相同。评估从干净的公开源码副本进行，没有把工作区未发布修改当成已发布修复。

| Issue | 评估 | 建议 |
| --- | --- | --- |
| [#33 桌面端找不到地方修改 api](https://github.com/penecho/penecho/issues/33) | 公开版本已有完整连接编辑入口 | 回复操作路径后 Close as completed |
| [#27 魔法风格加载特效](https://github.com/penecho/penecho/issues/27) | 已有等待动画，但未按原要求交付强烈魔法特效与截图 | 建议按现行设计方向 Close as not planned，不标记已实现 |
| [#20 Windows 长时间真实使用反馈](https://github.com/penecho/penecho/issues/20) | 部分实现，旧排版路径仍可覆盖已有内容，对象锁定等尚缺 | 保持打开；拆分剩余需求并建立链接后再关闭汇总帖 |
| [#5 图片导入与拍照](https://github.com/penecho/penecho/issues/5) | 图片导入已实现，独立相机工作流未完成 | 保持打开，收窄标题和验收范围到相机工作流 |
| [#2 分享画布使用案例](https://github.com/penecho/penecho/issues/2) | 社区征集，不是待修复故障 | 保持打开；若改用 Discussions，实际迁移后再关闭 |
| [#1 帮助测试 Claude](https://github.com/penecho/penecho/issues/1) | 测试征集；旧反馈者已自行恢复，但不能代表整体兼容性通过 | 保持打开，继续收集 Claude CLI/API 实测 |

## #33：建议关闭，原因选择 completed

公开 1.2.0 已有“设置 → AI 与连接 → AI 连接 → 管理 → 编辑”，可修改 Base URL、API key 和模型，保存原连接。不是只提供了桌面系统菜单入口。

证据：[设置表单](https://github.com/penecho/penecho/blob/84d4f8dc45cf5970193895f7d8b084d172f2dd7b/public/index.html#L989)、[编辑及保存逻辑](https://github.com/penecho/penecho/blob/84d4f8dc45cf5970193895f7d8b084d172f2dd7b/src/client/app/core.js#L2705)。静态入口、编辑处理与相关契约测试已核查；未进行桌面点击实测。

可直接回复：

```text
这个问题在当前 1.2.0 版本中已有对应入口。升级后，可在画布内打开“设置 → AI 与连接”，点击“AI 连接”旁的“管理”，再点击原连接的“编辑”，修改 API 地址、密钥或模型并保存。

如果更换了服务商，请同时检查 API 格式和模型名称；密钥留空会保留原密钥，因此需要换密钥时请填写新的值。

这条先按已解决关闭。如果升级后仍找不到入口，请补充操作系统、PenEcho 版本和当前设置页面截图，我们再继续排查。
```

## #27：建议关闭，原因选择 not planned

现有实现是围绕当前输入区域的双轮廓空间回声、简短状态文案和工作中的 AI 按钮环形动画。它实现了等待反馈，但与原帖要求的撕裂画布、传送门或发光符文等强烈效果不同，原帖要求的截图也未在讨论中交付。因此不能声称原验收已经完成。

证据：[动画实现](https://github.com/penecho/penecho/blob/84d4f8dc45cf5970193895f7d8b084d172f2dd7b/public/summon.js)、[6 项相关测试](https://github.com/penecho/penecho/blob/84d4f8dc45cf5970193895f7d8b084d172f2dd7b/test/summon.test.js#L12)。测试已通过；本次未做视觉截图验收。

下述回复包含“采用当前克制设计、放弃旧强特效方向”的产品决定；建议你认可此方向后使用。如果仍想做强特效，则保留 issue。

```text
The current release includes an AI thinking indicator around the active canvas region, with a subtle animated outline and a short status message.

We have decided to keep this feedback restrained so it remains comfortable during longer sessions and does not compete with the canvas content. We are therefore closing the original request for a dramatic portal, tearing-canvas, or rune effect as not planned. The current indicator is an alternative design, rather than completion of the original visual specification.
```

## #20：保持打开，部分需求已完成

| 原建议 | 当前证据与边界 |
| --- | --- |
| 自动排版、避免重叠 | 仍有明确缺口。传统 Canvas AI 的 `resolvePendingItemOverlaps` 只对本批草稿排版，没有将已有图片或笔迹作为固定障碍物。函数级复现：已有图片位于 `(100,100,300,200)`，同位置的新文本依然停在 `(100,100)`；对照用例中，两段同批新文本会正确错开。 |
| 利用更大空间 | PenEcho Agent 的自动放置已经检查现有对象和笔迹，并搜索当前视口之外的空位；不能把这条新路径的能力等同于传统 Canvas AI 的所有排版问题都已修复。 |
| 区分 AI 与用户内容 | 有 AI 墨色和待确认草稿；未发现贯穿所有对象、保存与后续编辑的统一来源标识。 |
| 专门的思维导图模式 | 已有专业图表插件和 Mermaid mind map 支持；这不等于原先承诺的专用 MindNote 模式已经完整交付。 |
| Clean Layout 按钮 | 未发现一键重排全部已有内容的正式操作。 |
| 更好的图表生成 | 已有专业图表及 Visual Explorer 路径；实际复杂案例的质量仍需用户复测，不能据此宣称图表质量问题全部消失。 |
| 图片支持 | 已有本地导入、移动、缩放及合并等能力，反馈者也在后续评论确认了改善；没有找到拖放导入画布的对应事件处理。 |
| 对象锁定 | 未发现阻止指定对象被移动或覆盖的对象级锁定；现有画布导航锁只冻结视角。 |
| Windows 安装体验 | 1.2.0 Release 已提供 Windows x64 安装包及 macOS 安装包。 |

证据：[旧排版函数](https://github.com/penecho/penecho/blob/84d4f8dc45cf5970193895f7d8b084d172f2dd7b/src/client/app/ai-runtime.js#L1114)、[Agent 自动放置](https://github.com/penecho/penecho/blob/84d4f8dc45cf5970193895f7d8b084d172f2dd7b/src/client/app/canvas-agent-runtime.js#L3901)、[图表插件](https://github.com/penecho/penecho/blob/84d4f8dc45cf5970193895f7d8b084d172f2dd7b/public/plugins/flowchart/plugin.md#L32)、[导航锁](https://github.com/penecho/penecho/blob/84d4f8dc45cf5970193895f7d8b084d172f2dd7b/src/client/app/core.js#L4471)。

建议后续至少拆出“传统 Canvas AI 避让已有内容”“对象级锁定”“整理已有画布布局”三个可独立验收的需求。本次没有创建这些 issue。

可直接回复：

```text
Hi Agostino, thank you again for the detailed testing and the follow-up after v0.7.2. Here is an update for v1.2.0.

Image import and editable image objects are available, and we now provide Windows and macOS installers. Diagram capabilities have also expanded, including mind maps through the diagram plugin and the newer Visual Explorer workflow.

Your layout feedback is still relevant. PenEcho Agent now has placement logic that considers existing content and can look beyond the current viewport. However, the traditional Canvas AI draft layout still has a gap in avoiding existing content, so we should not consider the overlap problem fully resolved.

Object-level locking and a one-click Clean Layout action are also still outstanding. The current view lock only locks navigation; it does not protect individual objects. AI ink color and draft controls provide some visual distinction, but do not cover the full provenance feature you described.

We will keep this feedback issue open while the remaining items are tracked more precisely. If you try the current version, a small example showing overlapping content, together with the model and whether you used PenEcho Agent or the canvas AI actions, would help us verify the remaining layout problems.
```

## #5：保持打开，收窄到相机工作流

已有 `accept="image/*"` 的文件选择入口、图片解码与尺寸限制、按比例放置、图片对象编辑和参与 AI 上下文。代码会重新栅格化图片，但这不是完整元数据隐私审计。当前没有发现独立 `getUserMedia`、拍照按钮、拍摄预览／重拍／确认或权限拒绝处理；普通手机文件选择器可能提供系统拍照入口，但不能替代完整验收。

特别注意：[PR #13](https://github.com/penecho/penecho/pull/13) 当前仍为 OPEN、未合并，不能按评论中的“已完成”认定功能已发布。

此外，图片被加入自动 AI 的候选脏内容，启用 Auto AI 后，结束图片编辑可进入自动请求调度。因此原要求“直到用户明确发起 AI 请求前保持本地”的含义仍需与 Auto AI 行为一起明确，回复中不要作绝对隐私承诺。

证据：[文件选择入口](https://github.com/penecho/penecho/blob/84d4f8dc45cf5970193895f7d8b084d172f2dd7b/public/index.html#L151)、[导入处理](https://github.com/penecho/penecho/blob/84d4f8dc45cf5970193895f7d8b084d172f2dd7b/src/client/app/canvas-runtime.js#L1075)、[图片结束编辑后调度](https://github.com/penecho/penecho/blob/84d4f8dc45cf5970193895f7d8b084d172f2dd7b/src/client/app/canvas-runtime.js#L864)。

建议标题：`Camera capture: preview, retake, confirmation, and permission handling`。

可直接回复：

```text
Image import is available in the current release: you can add local images to the canvas and move, resize, or delete them. Visible images can also be included in AI requests.

The dedicated camera workflow is not complete yet. We still need an explicit capture flow with preview, retake, confirmation/cancellation, and clear handling of unsupported devices and denied permissions. A camera option offered by a mobile file picker does not cover all of these requirements. PR #13 has not been merged.

We are keeping this issue open for the remaining camera work, its tests and documentation, and clarification of how image submission should interact with Auto AI.
```

## #2：保持打开，继续征集案例

这是维护者发起的长期社区案例征集，目前没有回复；不是“问题还没修好”，也没有可供判定完成的功能验收。没有必要为了清空 issue 数量而关闭。若希望全部社区交流迁至 Discussions，应先完成迁移并提供真实链接。

可直接回复（也可不回复，直接保留）：

```text
This remains open as a place to share real PenEcho workflows. Examples from the current release are welcome, including a screenshot or short recording, the PenEcho version, the model and connection type, and what worked or felt limited.

For a reproducible bug, please open a separate issue so it can be tracked individually. Please remove private content and credentials before sharing.
```

## #1：保持打开，继续 Claude 实测

这是 Claude 测试征集，不是一条单独的登录故障。原反馈者已确认旧问题与登录过期有关，重新登录后恢复，不能由此推断所有 Claude CLI 或 API 工作流都通过验收。现有自动化大多以模拟 CLI 输出验证协议与进程行为，不能替代真实 Windows、图片输入、实际模型及不同错误场景的回归。

公开版的结果解析已经能识别空结果、缺失结果事件和部分 API 错误；但本次进一步核查发现，它仍会把 `subtype: "success"` 且 `is_error: true` 的某些错误结果当成答案。另有结构化未登录状态的诊断分类缺口。用户随后要求统一处理 Claude/Kimi CLI，这些本地修复与验证应单独记录，不能在发布前写成“升级即可全部解决”。

可直接回复：

```text
We are keeping this testing request open because real-world Claude coverage is still limited, particularly for Claude CLI on Windows and image-based canvas tasks.

The earlier report was resolved after signing in again, but that does not establish that every Claude workflow is working correctly. An authentication status check also does not verify that a model request will succeed.

We are reviewing CLI error handling and adding regression coverage. We would still appreciate reports from the current release covering Claude API and Claude CLI separately, with the PenEcho version, operating system, CLI version where applicable, model, and exact error text. Please include whether you used PenEcho Agent or the canvas AI actions, and remove credentials and private content from any shared material.
```

## 验证边界

- 六条 issue 的正文和已有讨论均已读取，公开 main、发布标签与安装包已查询。
- 在与公开发布版本同 tree 的干净副本上，6 个等待动画测试、1 个专业图表样例测试、5 个筛选后的 UI 契约测试通过。
- 对旧排版函数做了“已有图片覆盖”复现及“本批文本互相避让”对照验证。
- 本次 issue 评估未启动 PenEcho、未执行桌面或摄像头端到端测试，也未发送 GitHub 评论、关闭 issue 或合并 PR。

## 后续追加：Claude CLI 与 Kimi CLI 本地修复

用户在本次评估中追加要求统一检查和处理 Claude CLI / Kimi CLI。已完成以下确认问题的修复，但尚未发布，不影响上面对公开版本的判断：

1. **Claude 错误结果被误当答案。** `is_error:true` 现在优先于成功子类型及结构化输出处理，保留有长度限制的错误原因，并作为上游错误返回；不再把错误终结结果报告成完成文本。
2. **Claude 未登录被误判为需要升级。** `auth status` 的 JSON `loggedIn:false` 现在归类为认证问题，给出登录恢复命令。未知命令执行失败仍保持执行错误分类。[Claude 官方 CLI 文档](https://code.claude.com/docs/en/cli-usage)说明此命令默认输出 JSON，登录／未登录分别以 0／1 退出。
3. **Kimi 失败退出后仍返回部分答案。** disposable CLI 的文本与 stream-json 共用路径现在先检查退出码或终止信号，再允许返回答案。保留 stderr 与诊断信息。该路径用于 PenEcho Agent，也用于传统 Kimi 调用的进程回退路径；没有把它误称为 ACP 的普遍问题。

新增跨 provider 集成回归覆盖：模拟 CLI 输出看似合法的 Harness 答案但报告失败时，不能生成最终答案或工具调用，也不能触发一次错误的 JSON 修复重试。未修改 UI、没有发布或推送代码。

统一验证：`test/claude-cli.test.js`、`test/kimi-cli.test.js`、`test/kimi-acp.test.js`、`test/cli.test.js`、`test/canvas-agent-cli-progress.test.js`、`test/canvas-agent-cli-failures.test.js` 合计 **88/88 通过**；修改源码的语法检查及 `git diff --check` 通过。

只读检查了本机 Claude Code 2.1.223、Kimi Code CLI 0.35.0 的命令兼容性。Claude 本机认证状态报告已登录，但没有进行真实模型请求；Kimi ACP 协议检查未发现需要改动的确定问题。真实账号、Windows 运行环境与用户所遇具体症状仍未完成端到端验证，因此不能写成“Claude / Kimi 全面修复”或“所有平台已验证”。

分工：主任务负责六条 issue 评估、跨 provider 集成测试和最终实际差异审查；委派参数为 Luna/max 负责 Claude 局部修复与测试、Sol/high 负责 Kimi 排查与修复。模型信息依据工具调用参数，未另行取得实际运行模型元数据。
