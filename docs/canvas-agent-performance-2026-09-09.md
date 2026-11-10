# PenEcho Agent 编排与性能改进（2026-09-09）

## 实测范围与结论

只读统计本机最近 **40 条 PenEcho Agent 请求**，范围为
2026-09-03 15:49:39 UTC 至 2026-09-08 12:06:06 UTC。
手写暂停触发的 Main Canvas AI 与 Agent 分开统计，本次未修改 Main Canvas AI。
明细见 [脱敏元数据](canvas-agent-performance-2026-09-09.json)。

| 指标 | 结果 |
|---|---:|
| 完成 / 失败 / 取消 / abandoned | 25 / 8 / 5 / 2 |
| 工具调用 | 171 |
| 截图 / 源码读取 / 补丁 | 46 / 33 / 39 |
| 工具错误 / 模型重试事件 | 26 / 3 |
| 完成的 Harness 请求 | 12 |
| 上述请求总时间 | 2845.471 秒 |
| 上述请求模型步骤时间 | 2793.731 秒（98.18%） |
| 上述步骤以外时间 | 51.740 秒 |

模型步骤时间包括上游等待、生成和重试，不能等同于纯推理时间。
另有 13 条完成的 Codex Native 请求，共 4081.686 秒；这些历史日志的
单个 step 覆盖整轮工具循环，不能据此计算模型与工具的耗时占比。
Native 的 `usage.last` 也不是整轮输出，统计器不会误当作总输出或累加
跨会话 `usage.total`。

两个慢 Native 样本分别用了 1618.382 秒 / 26 次工具调用和
1197.686 秒 / 20 次工具调用，均包含反复读取、修改和截图。
GLM Flash 的 983.901 秒样本用了 15 个模型步骤，其中第 2 步
532.478 秒、输出 25716 tokens，含一次连接重试；该请求实际是
**6 次截图**，修正初步人工分析中的 7 次计数。

因此优先减少模型往返、无变化复查和历史遍历，而不是优化毫秒级 RPC。
本次没有同任务、同模型、同输入的第三方 Agent 对照，不能声称总体快了几倍。

## 本次实现

- API / Harness CLI 支持一次模型决策最多 16 个已知调用；保留完整
  JSON、工具可用性、唯一 ID、截断检查与 provider replay 元数据。
- Harness 复用现有调度器：最多 4 个明确安全的读取并发，写入独占。
  `canvas_read` 已声明安全；截图、布局规划和 mutation 不声明并发安全。
- Codex Native 的直接 JSON 调用按 raw response 中的模型顺序执行，
  请求乱序到达也不改变顺序；等待发生在加入宿主队列之前，避免死锁。
  动态工具名称、参数必须匹配已准入的模型决策。
- 同批 `baseRevision` 仅衔接本批成功写入的连续回执。浏览器继续做
  精确版本校验；用户/其他任务的变更、旧版本和无法证明归属的 revision
  跳跃不被自动覆盖。`sourceHash` 不改写，尤其不绕过同一对象的源码冲突。
- 写入失败后停止本批后续写入，保留此前成功结果，允许诊断读取。
  这是顺序执行的多个原子工具，不是假装具备跨工具事务。
- 成功写入立即清除旧截图缓存，避免回执先于 digest 到达时复用旧图。
- 可在同一模型决策中提交“已知修改 + 完整 Canvas 截图”，省掉单独
  决定截图的一次模型往返；仍保留空间布局检查与截图证据要求。
- 压缩重复的 persona / 工具描述；原有冷提示词与 schema 合计
  **32 KB** 的测试预算恢复通过，没有提高预算。

历史 Native 日志发现 68 个 `exec` wrapper。兼容这条实际路径：单 wrapper
先校验工具名称和调用数量，再校验实际 JSON 回调，按回调顺序串行提交，
同样保护 revision；宿主不执行 JavaScript，不允许混合 wrapper/直接批次。
已有布局复查门槛仍有效：连续空间变更应使用一个原子 `canvas_edit`，
或在需要的位置安排完整 Canvas 截图；不能为了批次吞吐跳过布局验证。

## DeepSeek Harness 上游与许可

核对官方 master `5dda764ed`（0.1.5-alpha.1）及 MIT LICENSE。
最新版同时引入 Session V3，未整体升级会话存储与 provider API。
独立回移两项兼容当前 0.1.1-rc.2 的改动：

1. [73edce1ae：复用已证明深冻结的消息身份](https://github.com/deepseek-ai/deepseek-harness/commit/73edce1ae7ad0cbf8813d4d65b288317a16a7f5c)。
   WeakSet 由 Harness agent 所有；新消息与每次 header 仍深冻结，signal 保持可取消。
   不建立 PenEcho 层模型上下文缓存，也不改写历史。
2. [7bab91d24：保留 Anthropic 实际返回的模型信息](https://github.com/deepseek-ai/deepseek-harness/commit/7bab91d247e4a7a2e84c68e1883359f5dc718e6a)。
   请求模型身份与上游解析后的模型分开保存，避免别名导致 replay 验证失败、
   丢失原生签名或退化回放；Completions 的模型语义不变。

完整来源、许可证与移除条件位于
[`src/server/canvas-agent/vendor/README.md`](../src/server/canvas-agent/vendor/README.md)。
生成器校验锁定包的 SHA-256，离线生成两个 MIT 模块，不改 node_modules、
不增加第三方依赖。NOTICE 明确保留 MIT 原文及本地改编许可；PenEcho 集成
代码仍按项目 AGPL-3.0-only。

## 验证与实际限制

- 本次专用测试 23 项通过，包括真实 Harness 插件装配：两个读取重叠执行，
  两个写入依次收到 revision 10 / 11，四个工具与最终回答仅需 **两次模型调用**。
- Native RPC 测试验证乱序请求、直接与 wrapper 两条路径的连续回执、用户中途编辑及非法工具名批次整步拒绝。
- 最新一次完整 Agent 测试集为 **337 项，328 通过，9 失败**。没有新功能失败被删掉或放宽断言。
- 9 项遗留失败均在隔离的修改前核心代码上复现：Professional 创建 schema
  的旧断言（2 项）、Visual Explorer 创建/渐进交付旧断言（2 项）、默认
  工具 schema 旧断言（1 项）、字体/渲染契约旧断言（1 项）、Widget Undo
  顺序（1 项）、输入提示和 pointer 契约（2 项）。保留失败供后续处理。
  修改前还存在冷提示词预算失败，本次已修复。
- 生成产物一致性、模块导入、语法与 diff 空白检查通过；npm pack dry-run
  确认运行模块、生成器和 MIT 许可/来源文件均进入发布包。
- 未启动或重启 PenEcho，未发出真实付费模型请求，未部署或同步 Cloud。
  运行中旧进程不会自动采用代码；真实耗时改善尚需加载新代码后用同任务复测。
  服务端改动覆盖该宿主的本地与 Linked Device 调用；未做 Cloud 线上联调。

复现命令：

```sh
node scripts/audit-canvas-agent-performance.cjs <requests-directory> 40
node scripts/build-harness-backports.cjs --check
node --test test/canvas-agent-decision-admission.test.js test/canvas-agent-tool-batch.test.js test/canvas-agent-harness-backports.test.js test/canvas-agent-batch-integration.test.js
node --test test/canvas-agent*.test.js
```
