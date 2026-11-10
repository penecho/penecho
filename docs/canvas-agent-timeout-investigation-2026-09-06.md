# 两次 Canvas Agent 超时调查

调查范围：`1788623623151-912c5d08-6265-4f98-bac9-051f0668c1b7` 与 `1788624712596-439a35ff-85b5-4b4f-90b4-a23412a02ed6`。以下时间均为 Asia/Shanghai。

## 已确认

两次都执行成功了 `load_widget_contract` 与 `canvas_inspect`，然后由 PenEcho 的 180 秒事件无活动计时器结束；没有提交 `canvas_create` 或 `canvas_patch_widget`。不能描述为“请求完全没有返回”。

第二次还保留 Codex 隔离运行目录的 `logs_2.sqlite`，可交叉验证 PenEcho trace：

| 时间 | 底层事件 |
| --- | --- |
| 00:12:14.225931 | CLI 收到完整 `canvas_inspect` 结果，revision 31，当前 Widget 为 Steam Boiler P&ID |
| 00:12:14.227025 | Code Mode exec 完成，总耗时 87 ms |
| 00:12:14.232306 | CLI 通过复用 WebSocket 发起下一次 `/responses` 请求 |
| 00:12:15.551643 | 模型 reasoning item 开始 |
| 00:12:25.669030 | reasoning item 完成，随后又开始一个 reasoning item |
| 00:12:28.914370 | 第二个 reasoning item 完成 |
| 00:12:28.914429 | Codex Core 收到新的 `custom_tool_call` item 开始 |
| 00:12:28.914444 | app-server 发出前一项的 `rawResponseItem/completed` |
| 00:15:28.919157 | PenEcho 发出 `turn/interrupt`，与最后上述通知间隔约 180.005 秒 |

这确认第二次超时发生在新工具调用开始后、完成前。它没有卡在 Canvas RPC、工具结果返回或进入下一轮生成的边界。底层运行日志标记 `model=gpt-5.6-sol`、`reasoning_effort=high`；这是实际 CLI 运行参数的交叉证据，不是上游模型内部路由的独立认证。

该时段没有 WARN/ERROR 记录；00:12:28 后到中断之间没有新的数据库日志。日志没有逐个记录上游 WebSocket 数据帧，因此不能据此断言上游零数据，也不能断言工具参数始终在持续生成。新工具调用的完整参数未产出，不能确认它最终准备调用哪个业务工具。

## 明确的可观测性缺口

当前 PenEcho `createInactivityTimeout` 被收到的已识别 app-server 事件重置。普通回复增量、推理通知、已完成 raw item、工具事件等可以重置；计时器没有直接监测 Codex 到模型服务的连接流量。

在本次底层日志中，`custom_tool_call` 开始没有对应的 app-server `item/started`，而是只存在 Codex Core 的 item 日志。安装 CLI 导出的 ServerNotification schema 未列出工具参数生成 delta。因此不能把“事件 180 秒静默”当作“模型 180 秒没有生成 token”。这是一项实际存在的监测边界；不能仅凭它判定上游连续生成而被误杀。

## 第一次的证据边界

第一条 PenEcho trace 仍在，初始 Canvas revision 28；第二条为 revision 31。检查现存 24 个隔离 runtime 的 Codex 日志库及全局日志库，没有找到第一条对应 thread/turn 的底层记录，原隔离 runtime 已不在。不能把其他 thread 的活动归给这条请求，也不能声称两次在相同底层事件上超时。

## 后续处理原则

- 保留每轮最后收包时间、最后有效事件时间、事件种类计数、执行中工具及当前生成阶段的有界诊断；不记录凭证、原始推理或无关正文。
- 在 runtime 清理前保存上述故障摘要，避免只留下通用 timeout 文案。
- 若能取得上游真实生成进度，用它区分模型流量与工具执行。不要通过自造 heartbeat 或定期调用 activity 掩盖真实停滞。
- 若 CLI 无法暴露参数流，应明确这是事件静默超时，并为单次代码/工具参数生成设计单独的有界等待策略。仅增大现有数字只能缓解，不能证明根因已消除。

本轮只做诊断与源码审计，没有据猜测修改超时策略。

## 复测诊断实现

新增诊断直接跟随现有请求日志开关（`PENECHO_REQUEST_TRACE`）；关闭时不创建采集器，不额外计数、计时、缓存事件或添加写入回调。开启时只累计有界元数据，每轮结束或超时前通过现有请求 tracer 写一次 `native-activity-summary`，不添加定时器或逐事件写盘。

摘要包含 stdout/stderr 字节计数、完整 JSON 行数、未解析缓冲区大小、事件分类、实际刷新 inactivity timeout 的事件、工具阶段和待处理工作。未知事件名散列化，不记录正文、源码、工具参数或 stderr 内容。进程复用时每轮重新建立计数基线。

复测需重启当前 PenEcho 服务以加载服务端源码，开启请求日志后发起请求。完成或失败后检查该请求 `trace.json` 的 diagnostics 中 `native-activity-summary`。它观测的是 CLI 与 PenEcho 之间的传输，仍不能证明 CLI 上游没有收到网络帧。现有 180 秒 inactivity 判定保持不变。
