# MCP 展示收益、交互与可读性回归（2026-09-08）

## 范围与基线

本轮沿用 Computer Use 操作 ZCode 的原生 PenEcho MCP 工具和 Edge 中的 071 画布。测试文档：`MCP ZCode 回归 2026-09-08`，documentId `36b62853-8569-4a03-8489-d72143ee6c40`，原 3921 实例。仅测试文档有内容修改；不发布生产版本。

071 本地 HEAD `e4b87f1aa8b6f81feeb4e3b908926136419a8237`，前轮记录的远端 main `84d4f8dc45cf5970193895f7d8b084d172f2dd7b`。本轮改进是基于已经有未提交修复的工作区，不把工作区全部 diff 算作本轮修改。Cloud 原有业务修改保留，仅同步允许列表中的 `public/canvas/app.js`、配套 `style.css` 及其来源清单（保留并检查同期侧栏任务的配套变更）。

ZCode 界面显示 GLM-5.3、最高推理；未独立核实其后端服务模型。主任务负责实际 UI 验收、提示词/运行时修复和最终 review；独立只读 UI 审查请求 Astra/medium，合同与定向测试请求 Luna/max。子代理服务端模型元数据不可见，不以代理自述当作证明。

## 实际场景

| 场景 | 观察结果 | 改进/判定 |
|---|---|---|
| 请求设计可筛选、可勾选的本周学习计划 | ZCode 自行选择 HTML Widget，540×640，同一 `learning-plan` / `widget-2`；6 次原生调用含恢复和截图 | 可交互 UI 确实比纯文字更便于试用。该会话已有 MCP 测试历史，不能当作无提示的冷启动采用率实验 |
| 浏览器勾选第一项、切“未完成” | 立即改变进度和可见任务 | 本地 UI 交互不需模型回合 |
| 点击“采用紧凑布局” | 一条 `prefer-compact` 指令入队；read_messages(after=1) 仅这一条，勾选/筛选无消息 | 只有显式 AI 请求进入 pull inbox；点击和读消息均不会唤醒已停止的第三方客户端 |
| 原始任务勾选 | 普通 div，没有原生 checkbox/键盘语义 | 修订成有名称的原生 checkbox；主任务在真实浏览器按 Space 验证 1/3→2/3、未完成列表减少，再恢复测试状态 |
| 原始预览在整幅适配后 | 画布 83%，预览约447×530屏幕像素，部分小字偏小 | 改正文约16px/元信息14px、可换行、明确筛选选中态；按钮改名“请求 AI 调整布局”，收间距而非缩字体 |
| 简单修订完成确认 | 同一对象/尺寸保留；一次 present+capture/basic；直接 ack done | 实际完成6次调用（读消息、反馈、HTML、合并呈现截图、done确认、最终状态），无需机械 received→working→done |
| 概览下“Show new content” | 旧实现判定已可见后只消 pending，83%概览没有聚焦；退出 Widget 交互后按钮可消费 pending | 修复显式 Show 始终 frame 聚焦，自动展示仍遵循已有可见性/编辑保护。后续解锁后单次inspect实测 active-gesture，定位为普通pointermove也写入state.pointers。已改用既有实际按下指针集合canvasAgentNavigationPointerIds，避免把悬停误判为手势 |

ZCode 修订报告：revision 8，pixelVerified=true，runtime errors=[]。主任务另以真实浏览器截图和键盘操作验收；截图结果字段本身不能代替主任务对可读性的判断。

窄屏检查：ZCode 对相同 HTML 做390×844、intent=inspect 的临时basic截图，返回ephemeral=true、pixelVerified=true，无脚本错误/截断；其报告工具栏和任务文本换行、无横向溢出。随后review原位更新仍为widget-2、540×640，无新增Widget。本轮包含恢复/读取/检查/原位呈现/诊断共7次调用。主任务没有把此报告误标为亲自操作390宽移动设备的验收。

新增diagnostic在真实第三方结果中观察到 navigation-locked→active-gesture，帮助定位无响应原因，无需再索取截图或完整画布内容。

## 产品规则与成本

- 已选定并开放的 Canvas 上，UI 设计/评审默认优先可操作预览。比较、计划、关系、模拟按帮助用户试用、决策或理解的实际收益选择最小有效展示。
- 短事实、普通代码改动、未变化状态不生成视觉内容。进度按有意义的发现/阻碍/完成合并，避免每工具更新、轮询和装饰性进度板。
- 保留19个工具；简单节点/关系使用 draw，函数使用 plot，真正交互页面使用 present_widget。明确 desktop page 1200×800、mobile 显式尺寸、base 仅紧凑内容，尺寸预设与显式尺寸互斥。
- 本地筛选/切换不触发 AI。按钮仅在确实需要 AI 时带 action/prompt，并明确是请求而不是立即执行。
- 首次 UI 或显著布局变化可合并 present+capture/basic；复用像素证据，具体问题未解决时才增加截图/精度。简单工作直接 done/error，长等待才显示 received/working。
- 新增 inspect 的 bounded attention（pendingObjects、paused、blockedBy、canvasScale），供具体故障诊断，无截图、DOM扫描或新增轮询。
- 完整设计提示词仍按需由 MCP prompts 暴露；只支持 tools 的第三方不依赖 prompts/get。已有会话是否热加载新 instructions 不受技能文件更新保证。

文本体积以 UTF-8 字节计，不是 tokenizer 或账单测量：

| 内容 | 改前 | 改后 |
|---|---:|---:|
| initialize.instructions | 3418 | 2849 |
| tools/list 中 JSON.stringify(TOOLS) | 19873 | 20166 |
| 上述两项合计 | 23291 | 23015 |
| 仓库 MCP SKILL.md | 19842 | 11843 |

工具定义因更明确的尺寸和故障信息略增；初始化说明缩短，总合计减少276字节（约1.2%），完整技能减少约40.3%。不把这些数值声称为实际token费用降幅。初版与修订均6次调用，工作内容不同，也不拿它们宣称整体速度提升。合并截图能少一次调用，简单直接done相对三段确认少两次；实际账单仍取决于第三方模型、上下文缓存和图像计费。

## 代码与验证

修改集中在 `src/server/mcp/{guidance,schema,stdio}.js`、`src/client/app/mcp-runtime.js`、`skills/penecho-mcp/SKILL.md` 和对应回归测试；重建客户端。同步已安装的 MCP 技能，并将用户的可交互预览/收益成本偏好记入既有 PenEcho 工程技能。

- `node --test test/mcp-schema.test.js test/mcp-stdio.test.js test/mcp-canvas-runtime.test.js`：32 passed，0 failed。
- 其中涵盖尺寸互斥、默认不截图、stdio精简结果、直接done/error、attention元数据、显式聚焦/自动不扰动，以及隐页/锁定/活跃手势/文本编辑/Widget交互/设置/队列均不被显式Show绕过。
- 最终悬停修复后重跑20项画布运行时测试全通过，并运行既有“Canvas navigation temporarily hides Agent”真实按下/悬停记账测试通过；加上最终12项schema/stdio，本轮33项独立用例通过。
- `npm run check:client`、`git diff --check` 通过。
- Cloud `sync-public-canvas --only=app.js,style.css --check` 通过；`sync-canvas-agent-runtime --check` 通过（本轮不添加MCP服务器运行时）。

Cloud 的前端镜像不等于 Cloud 获得独立公网 MCP 服务。此次真实第三方联动发生在已开放的本地071实例；新服务说明由之后加载新版stdio的客户端获取，不能把旧ZCode会话的引导修订算作新默认说明自动生效。

## 最终实机与并发验证

修复悬停误判后，ZCode 原生 draw 创建 `mcp-interaction-map`（600×429，11个图元），原两个Widget保留。第一次70px节点高度被80px下限拒绝，修为84px后通过；该约束原本已在工具描述中，不把客户端漏读当成服务端放宽约束的理由。总6次调用，含一次被拒重试。

主任务在真实浏览器解锁后点击 Show：新内容提示消失，镜头移至新机制图并放大，完整两分支清楚可读。说明悬停阻塞修复实机通过。角落旧缩放读数未同步，不能据此报告实际新scale；截图是聚焦验收证据，该显示读数另记后续问题，未在本轮扩大修改通用镜头代码。

用户追问“页面被其他任务占用”为何不按session隔离。读取该任务记录确认其尝试控制同一标签1497370228；这是浏览器控制所有权问题，与MCP文档绑定不同。该任务的旧空列表没有保存可核实的具体失败原因，不猜测是哪一个连接故障。

随后通过本任务真实 Codex MCP 调用验证：

- Codex list_canvases 发现 ZCode 同一071连接。
- Codex unique key 创建 session `e2fab565-7565-43ec-8bd2-c50a1f092e2b`，绑定另一文档 `doc-fallback-c1d98b8b00552499-73`。
- 在独立文档后台 present 成功，inspect `browser.visible=false`、revision2；真实浏览器继续停留于 ZCode 原文档，侧栏出现“Codex 独立文档并发验收 / New updates”。
- Codex 尝试 inspect ZCode session `88ec29b0-cd89-46c2-8261-a6df1db51ac5` 被拒：This MCP connection does not own that PenEcho session。
- Codex 完成状态已入队。独立session/document正常，不等于为每个会话自动创建一个独立浏览器标签。

另修复发现接口吞错：stdio此前把Promise.allSettled失败与无开放画布统一返回空列表。现仅在空/部分失败时返回 bounded discovery，区分 no-local-instance、no-opted-in-canvas、instance-unavailable、partial；最多8项issue，只有实例ID/固定错误码，不输出secret、路径、URL或原始错误。完整成功有画布时保持原返回形状，无新增常规输出负担。正常、空、部分/全部连接失败、非法身份/数组响应、脱敏和上限均有测试。本项请求Astra/low实现子代理，主任务查看代码和测试后验收；实际服务模型元数据不可见。

此诊断改动需客户端下一次加载新版stdio才能生效。本轮不重启用户正在运行的客户端或发布云端。
