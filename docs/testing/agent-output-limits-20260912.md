# Agent 输出额度遗漏核查 · 2026-09-12

用户已要求主生成额度统一为 64,000；此前漏掉本地 Agent、部分 UAT 模型记录及默认值。

## 两次请求的不同结束点

| 本地请求记录 | 模型入口 | 模型调用 / 工具调用 | 分轮 output tokens | 实际结束 |
|---|---|---|---|---|
| 1789210450612-ed901a81-00a9-43e9-a42a-fa05f101d679 | DeepSeek OpenAI | 1 / 0 | 32,767 | 本地请求32,768，max-tokens，无正文/工具 |
| 1789210766622-9ec7e9d6-7be5-4fb7-8fdd-75829e4496de | DeepSeek Anthropic | 2 / 1 | 6,028 + 16,384 | 读取VE brief成功；第二轮max-tokens，无绘图调用 |

第二次耗时98.779秒。UAT hosted_model_requests两行（10:59:27、10:59:56 UTC）reserved_output_tokens均16,384，output_tokens分别6,028与16,384；对应模型配置max_output_tokens=16,384。本地日志请求32,768，Cloud取较小值，因此本次在16,384就触顶，不能说超过32,000。HTTP200/usage succeeded只表示供应商成功返回并计费，不能代表用户任务完成。以上只检查公开事件、配置和usage，没有读取或保存隐藏推理文本。

## 修复与验证

- 071 `9107c4f`：Agent API profile由32,768改为64,000；真实Harness构造的OpenAI/DeepSeek HTTP请求参数断言为64,000，多种profile包括Anthropic额度断言。Agent主文件88/88通过。
- 071 `4809658`：Main Canvas API默认63,000改为64,000；API/security测试76/76通过。
- Cloud统一服务、配置及管理API的新模型默认64,000；069迁移更新非审核模型的历史16,384/32,768/63,000值，保留独立审核预算及其他显式额度；UAT已执行迁移。
- Cloud额度转发、计价与provider pool测试48/48通过。执行端仍尊重显式模型能力上限，不移除额度验证。
- MCP本身不发起外部客户端的模型请求，不能替外部客户端设置输出预算；这里修改PenEcho自己负责的生成链路。

未声称64000可以保证模型及时执行工具。现有应用/Agent会话可能仍保留旧profile，之前47b安装包不含这次修复；需在更新运行时后检查新的实际outbound参数。没有操作production、没有推送代码。

## 深层原因补查（不是只提高额度）

- DeepSeek 官方思考模式文档明确 medium→high，low→low；Anthropic兼容接口支持output_config.effort，忽略thinking.budget_tokens。不能把界面medium解释成上游独立的中等档位。来源：https://api-docs.deepseek.com/guides/thinking_mode/ 、https://api-docs.deepseek.com/guides/anthropic_api/ 。此映射是已知行为，尚不能单独证明原请求的全部生成原因。
- 后端publicSessionEvent原样转发max-tokens，客户端turn_end只在reason.kind=error时建立错误提示，因而输出耗尽可能表现为停止后没有解释。dd44e64通过既有错误路径投影MODEL_OUTPUT_EXHAUSTED并保留terminationReason，不销毁会话、不删除已应用Canvas内容、不自动重复请求；94项测试通过。该修复改善故障反馈，不等于减少生成量。
- 1.2.0 PERSONA明确对较大Widget先交付可用版本再补全；当前brief仅要求完整HTML文档，缺少原有大型产物分步交付提示。此为已确认行为差异，正在单变量测试其实际影响，不能先断言它是原请求的唯一原因。

真实供应商第二轮重放（同模型deepseek-v4-flash-vision-exp、相同失败前上下文、相同21工具、64000上限；用规范转换构造Anthropic消息，非原始HTTP字节重放）：

| 推理设置 | 耗时 | output tokens | 下一步输出 |
|---|---:|---:|---|
| low | 70.137秒 | 19,147 | 2个present_widget调用 |
| medium | 187.693秒 | 47,960 | 1个present_widget调用 |
| medium + 大型Widget先可用再补全指导 | 106.001秒 | 27,889 | 2个present_widget调用 |

此对照每组仅一个成功样本，不能据此承诺固定加速比例。只验证生成到工具调用的阶段，未执行这批Widget，不代表地图内容/可读性/全流程成功。首次两组请求返回TypeError，初始记录未保留message，不能精确归因；low随后重试成功，medium改用产品的ProviderHttpClient后成功。传输实现不同、缓存命中不同，因此耗时差异不能全部归因于effort；output与工具结果表明额度增加后能继续，仍不足以将产品整体标记修复完成。实验只保存事件类型、字段名、耗时和usage，不保存或分析隐藏思考文本。

单变量追加大型Widget渐进交付指导的样本，比同HTTP客户端的medium基线较早进入工具调用；缓存仍不同，且每组仅1个样本，不能视为稳定速度保证。已将本次试验的原文作为有条件的大型Widget指导恢复到Agent/MCP共享规则，要求完成全部剩余内容，禁止停在占位符。与1.2.0的渐进交付方向一致，不恢复任意时间/轮数硬限。

本轮建议：保持64000主输出额度；日常强调交互速度的DeepSeek任务可显式选择low；大型产物先交付有用内容再补齐；触顶明确显示未完成并保留会话/已应用结果。完整15天地图的内容与像素验收及多次稳定性对照尚未完成，不宣称上述三个单轮探针等同全流程验收。


核查分工：主任务负责实际日志/数据库、供应商对照、修复与集成；Luna/max只读核查参数传递和结束原因（按工具声明的luna角色请求）。其代码证据确认medium在本地与Cloud转发时未被丢弃，DeepSeek的medium→high发生于供应商映射；max-tokens原始Harness停止原因保留，公开错误转换不会进入Harness自动重试。Luna窄测试本地11/11、Cloud17/17通过；主任务94项结束事件/Agent测试、19项最终共享指导/公开事件/adapter测试、6项Cloud镜像及adapter测试通过。

全局 ~/.codex/AGENTS.md 已按用户要求写入通用回答规则：说明当前情况、深层原因及具体解决方式；要求证据和继续执行已授权的核查修复。临时供应商探针进程均已结束，重放上下文临时文件已删除，只保留脱敏统计。没有修改用户原有应用或部署production。
