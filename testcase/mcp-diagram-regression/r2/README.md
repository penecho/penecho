# 第二轮验收：原生滚动、状态浮层与空视口边界

2026-09-19。正式源码：`/Users/heack/workspace/penecho_071_version`，分支 `codex/update-localization`，HEAD `1fc4ec9a417ab6d1f141445b1a13051cfd2818a9`。修改已通过官方同步部署现有 Cloud UAT；未提交、未推送、未部署生产。保留两个正式仓库的原有改动。

## 确认的修复

- 三类图表共用的视图：移除四个方向箭头，保留总览、100%、缩放和节点定位。缩放通过 SVG 的实际尺寸实现，保留完整 viewBox；固定图表容器外部高度，由浏览器原生横纵滚动访问放大内容。
- 状态浮层：锚定整个侧栏 footer，避免数量和 Retry 按钮组收缩导致窄条。采用 11.5px / 1.35、6×8px 内边距、7px 圆角和短阴影；保留 live region 和 Retry。设计来源为 `penecho_design/penecho-design-language.html#surfaces` 的 tooltip 规范。
- 空视口切换：保存准确的相机位置，允许 `region:null`。
- 新增关联修复：Community/Favorites 导入在空视口下回退到画布范围；Agent 空区域截图返回明确的 `EMPTY_CAPTURE_REGION`，避免 `null.w` 崩溃。原因、失败前证据和部署证据见 [边界检查](boundary-audit.md)。

## 实际 MCP 验收

已从最新三个 Canvas 回读全部 **34 个对象：29 个编号样例 + 5 个探针**。Architecture 12、Sequence 10、Workflow 12；Sequence 原画布缺少 S9，不补造为已存在样例。

每个对象的原始 HTML 与模型保存于 [latest-readback.json](latest-readback.json)，带原 documentId、objectId 和 contentHash。通过 MCP `present_widget(intent:inspect)` 将相同源码放入临时验收视图，使用实际 UAT 浏览器图表运行时逐个渲染和截图。只追加诊断脚本，不改语义 JSON，不写原对象。未使用 computer use。因用户当前 Canvas 上的 Agent 正在运行，未强行中断它或绕过 CANVAS_BUSY 切换保护。

34 张截图均获得 `pixelVerified:true`，已逐张检查图形。各探针检查了：方向按钮移除、容器外部高度不变、100% 缩放稳定、原生滚动可移动、右/下末端可达、所有节点可定位、源码保持不变。没有发现需要新增修改的节点丢失、文字越框、配色不一致、分组遮挡或方向失效。大图总览文字会缩小，100% 可滚动阅读。

- W4：17 节点，完整图形 877 × 2540；100% 下可滚到 Order complete。
- S7：16 参与者、21 消息，完整图形 3140 × 1343；100% 下可访问最右端和最后消息。
- W4 / S7 另在 640px 容器实际复测，截图为 [W4 窄容器](r2-narrow-workflow.webp) 和 [S7 窄容器](r2-narrow-sequence.webp)。
- W5 的 RIGHT 横向布局、W8 的四路并行、W10 的四级升级与回边均通过。
- 浏览器交互脚本通过 scrollBy/scrollLeft/scrollTop 验证原生滚动，并确认合成 wheel 事件未被阻止；不把这表述成操作过用户的实体鼠标。

完整记录见 [acceptance.json](acceptance.json)。图像内绿色区为诊断结果，不属于用户原图。

| 样例 | 原对象 | 实际 MCP 截图 | 结果 |
|---|---|---|---|
| A1 简单·中文｜博客系统请求链路 | widget-1 | [截图](r2-actual-architecture-widget-1.webp) | 通过 |
| A2 Simple·EN｜CI/CD Delivery Path | widget-2 | [截图](r2-actual-architecture-widget-2.webp) | 通过 |
| A3 中等·中文｜电商下单链路（微服务） | widget-3 | [截图](r2-actual-architecture-widget-3.webp) | 通过 |
| A4 复杂·英文｜Production Platform on Kubernetes | widget-4 | [截图](r2-actual-architecture-widget-4.webp) | 通过 |
| A5 真实项目·中文｜本机 PenEcho 图形工具链 | widget-5 | [截图](r2-actual-architecture-widget-5.webp) | 通过 |
| A6 混合文档·中文｜HTML 讲解 + 内嵌架构图 | widget-6 | [截图](r2-actual-architecture-widget-6.webp) | 通过 |
| A7 全类型/全连线·英文｜Support Ticket Triage | widget-7 | [截图](r2-actual-architecture-widget-7.webp) | 通过 |
| A9 结构边界·英文｜嵌套分组/孤立节点/无标签连线 | widget-8 | [截图](r2-actual-architecture-widget-8.webp) | 通过 |
| A8 配色自检·中文｜domain 配色与默认值 | widget-9 | [截图](r2-actual-architecture-widget-9.webp) | 通过 |
| A10 长文本/特殊字符/上限·中英混排 | widget-11 | [截图](r2-actual-architecture-widget-11.webp) | 通过 |
| S1 简单·中文｜登录请求时序 | widget-1 | [截图](r2-actual-sequence-widget-1.webp) | 通过 |
| S2 Simple·EN｜Webhook Delivery | widget-2 | [截图](r2-actual-sequence-widget-2.webp) | 通过 |
| S3 中等·中文｜登录鉴权（alt 分支） | widget-3 | [截图](r2-actual-sequence-widget-3.webp) | 通过 |
| S4 复杂·英文｜Card Payment（嵌套片段+激活） | widget-4 | [截图](r2-actual-sequence-widget-4.webp) | 通过 |
| S5 中等·中文｜定时对账（自调用+note） | widget-5 | [截图](r2-actual-sequence-widget-5.webp) | 通过 |
| S6 真实项目·中文｜present_widget 端到端时序 | widget-6 | [截图](r2-actual-sequence-widget-6.webp) | 通过 |
| S7 极限·英文｜Release Train（16 参与者/21 消息） | widget-7 | [截图](r2-actual-sequence-widget-7.webp) | 通过 |
| S8 长标签极限·中英混排 | widget-8 | [截图](r2-actual-sequence-widget-8.webp) | 通过 |
| S10 混合文档·中文｜HTML 讲解 + 内嵌时序图 | widget-9 | [截图](r2-actual-sequence-widget-9.webp) | 通过 |
| SP1 探针·中文｜跨生命线长标签 | widget-10 | [截图](r2-actual-sequence-widget-10.webp) | 通过 |
| W2 Simple·EN｜Nightly Data Export | widget-1 | [截图](r2-actual-workflow-widget-1.webp) | 通过 |
| W3 中等·中文｜Pull Request 评审流程 | widget-2 | [截图](r2-actual-workflow-widget-2.webp) | 通过 |
| W1 简单·中文｜报销单审批 | widget-3 | [截图](r2-actual-workflow-widget-3.webp) | 通过 |
| W5 多级分组·中文｜值班响应（RIGHT） | widget-5 | [截图](r2-actual-workflow-widget-5.webp) | 通过 |
| W6 真实项目·中文｜本工作区幻灯片生产流程 | widget-7 | [截图](r2-actual-workflow-widget-7.webp) | 通过 |
| W9 混合文档·中文｜HTML 讲解 + 内嵌工作流 | widget-10 | [截图](r2-actual-workflow-widget-10.webp) | 通过 |
| W10 四级升级·中文｜客服工单升级（4 分组 + 环路） | widget-11 | [截图](r2-actual-workflow-widget-11.webp) | 通过 |
| W8 并行极限·英文｜Multi-Region Rollout（fork×4） | widget-8 | [截图](r2-actual-workflow-widget-8.webp) | 通过 |
| W7 长文本/特殊字符/emoji·中英混排 | widget-6 | [截图](r2-actual-workflow-widget-6.webp) | 通过 |
| W4 复杂·英文｜Order Fulfillment（fork/join） | widget-4 | [截图](r2-actual-workflow-widget-4.webp) | 通过 |
| P1 探针·中文｜domain id 保留字排查 | widget-10 | [截图](r2-actual-architecture-widget-10.webp) | 通过 |
| P2 探针·中文｜A4 配色结构复现 | widget-12 | [截图](r2-actual-architecture-widget-12.webp) | 通过 |
| WP1 探针·中文｜同域配色一致性 | widget-9 | [截图](r2-actual-workflow-widget-9.webp) | 通过 |
| WP2 补丁流程测试样本（初始版） | widget-12 | [截图](r2-actual-workflow-widget-12.webp) | 通过 |

## 浮层验收范围

[浮层组件截图](r2StatusInline.webp) 使用真实 footer 结构及正式相关样式，检查字体为 11.5px、位于按钮上方、宽度在 footer 内、文本无水平溢出。完整应用样式表的隔离截图被 MCP DOM 截图器不支持的 `oklab` 颜色语法阻止，完整样式实验没有计入通过结果；`status-preview.html` 保留这一实验以便复查。未据此修改产品配色或扩大到截图器重写，也不声称截图了用户当前整个侧栏。产品浮层修改本身已同步部署。

## 自动检查与交付

- [final-tests.tap](final-tests.tap)：248 项相关回归通过。
- [latest-layout-tests.tap](latest-layout-tests.tap)：扩展为全部 34 个回读模型后，640 / 1280px 的语义、实体数量、方向和几何检查通过。
- client / architecture / sequence / workflow 构建生成物一致性通过。
- 官方 Canvas mirror / Agent runtime mirror 检查通过；UAT 最终部署计划为 none。
- 实际 app.js 服务哈希及挂载详见 [边界检查](boundary-audit.md)。
- 新增导入和空视口截图修复通过执行源码的测试验收，未声称用 MCP 点击过 Community/Favorites UI；浏览器加载新版 app.js 后生效。
