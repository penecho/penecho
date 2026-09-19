# 最新三画布复核 · 2026-09-19

## 范围与结论

通过 PenEcho MCP 读取并逐个截图「测试④ 架构图 Architecture ×10 · 新画布回归」「测试⑤ 时序图 Sequence ×10 · 新画布回归」「测试⑥ 工作流 Workflow ×10 · 新画布回归」。共 30 个编号样例，另有 P12 分组交错复现探针，共 31 个对象。工作流 widget-5 是 W6，widget-6 是 W5，按标题核对。

没有发现加载失败、实体丢失、右侧内容无法到达或旧四向平移按钮。长图的底部内容可滚动到达，但“总览”容器固定最高 1600px，超出了本次 Widget 的 1479px 高度。这是一项实际体验缺陷，已做共享视口高度的最小修复。

原 31 个对象未被修改。浏览器操作、源码读取和截图仅通过 MCP；没有使用 computer use、CDP 或 Playwright。

## 最小修复

正式源码：`src/diagrams/viewport.mjs`。
- 按 iframe 实际高度，扣除图内标题、图例、工具栏及底部留白，限制图表总览区域。
- 缩放保持外部容器高度，使用浏览器原生滚动；完整 SVG viewBox、节点/消息/边和用户源码不变。
- 点击总览或 Home 时重新读取可用高度，支持高度变化后重新适配。
- 极矮视口保留至少 240px 可操作区域，允许外层文档正常滚动。
- 没有添加定时器、观察器或新的缓存；没有调整图形布局算法。

W7 实际 MCP 对照（2011 × 1479 CSS px）：
- 修复前：图表区域高 1600px，底边 y=1797，60% 总览。
- 修复后：区域约 1258px，底边 y=1455，47% 总览，完整图表区域处于首屏内。
- 修复后切换 100%，全部 15 节点可定位，图内滚动能到末端，容器外部高度不变。
- A9 同样从底边 1797 改为 1455；12 节点均可定位，图内和外层滚动到末端，源码不变。

[W7 修复前](screenshots/probe-before-w7.webp) · [W7 修复后](screenshots/probe-after-w7.webp) · [A9 修复前](screenshots/probe-before-a9w.webp) · [A9 修复后](screenshots/probe-after-a9w.webp)

原生滚动验证使用 MCP 临时文档内的 scrollBy / scrollTop / scrollLeft、节点定位和 DOM 边界测量；合成 wheel 事件未被阻止。它不等同于发送真实鼠标滚轮输入，未声称做了 computer use 验证。早期 probe 的 containerHeightStable 比较 clientHeight，会把水平滚动条占用的 15px 记为 false；最终 probe 已改为比较容器外部几何高度，源代码和容器并未因缩放长高。

## 可选改进，未强改

1. A1、S1、W1 的内容较少，仍使用统一 2011 × 1479 的 Widget。图本身清楚，空白主要来自测试对象尺寸。后续新建小图可使用更紧凑的内容尺寸；无需改图形布局。
2. P12 为 g1 → x1 → g2 → x2 → g3，其中 g1/g2/g3 必须属于一个连续分组边框，x1/x2 必须在框外。图中因此存在反向排列和多次出入分组的绕线。所有节点和关系保留、几何检查通过，但连续链路阅读一般。若要按流程严格排序，应明确采用工作流分阶段分组语义；本轮不擅自拆开架构边界或改变业务关系。
3. A7、A9 的长回线由跨区域依赖和回路产生；未见穿过节点，不为缩短连线改动依赖关系。

## 逐个实际截图

| 样例 | 对象 | MCP 证据 | 观察 |
|---|---|---|---|
| A1 · Web Request Path (Simple) | widget-1 | [实际截图](screenshots/architecture-widget-1.webp) | 清楚；统一大尺寸 Widget 留白较多，可选紧凑尺寸 |
| A3 · CI/CD Delivery Platform (EN) | widget-3 | [实际截图](screenshots/architecture-widget-3.webp) | 正常渲染，未见节点或连线遮挡 |
| A4 · 数据平台 Lakehouse（中文·复杂 15 节点） | widget-4 | [实际截图](screenshots/architecture-widget-4.webp) | 正常渲染，未见节点或连线遮挡 |
| A10 · 可观测性平台（中文·8 详情卡） | widget-10 | [实际截图](screenshots/architecture-widget-10.webp) | 正常渲染，未见节点或连线遮挡 |
| A8 · 迁移过渡期·嵌套分组（中文） | widget-8 | [实际截图](screenshots/architecture-widget-8.webp) | 正常渲染，未见节点或连线遮挡 |
| A9 · Multi-Region DR (EN, DOWN, long labels) | widget-9 | [实际截图](screenshots/architecture-widget-9.webp) | 长图总览超出首屏，已修复高度适配并在 MCP 复验 |
| A7 · RAG Assistant Platform (EN) | widget-7 | [实际截图](screenshots/architecture-widget-7.webp) | 正常渲染，未见节点或连线遮挡 |
| P12 · arch 分组被非成员节点隔断（A4 复现探针） | widget-11 | [实际截图](screenshots/architecture-widget-11.webp) | 分组交错导致往返绕线；可读性优化项，语义与几何有效 |
| A5 · Mobile BFF (EN, bidirectional edges) | widget-5 | [实际截图](screenshots/architecture-widget-5.webp) | 正常渲染，未见节点或连线遮挡 |
| A2 · 电商下单系统（中文·中等） | widget-2 | [实际截图](screenshots/architecture-widget-2.webp) | 正常渲染，未见节点或连线遮挡 |
| A6 · 零信任安全架构（中文） | widget-6 | [实际截图](screenshots/architecture-widget-6.webp) | 正常渲染，未见节点或连线遮挡 |
| S1 · Simple API Request (EN, minimal) | widget-1 | [实际截图](screenshots/sequence-widget-1.webp) | 清楚；统一大尺寸 Widget 留白较多，可选紧凑尺寸 |
| S2 · 用户登录与令牌刷新（中文·self-call+activation） | widget-2 | [实际截图](screenshots/sequence-widget-2.webp) | 正常渲染，未见节点或连线遮挡 |
| S4 · 支付下单（中文·opt+loop） | widget-4 | [实际截图](screenshots/sequence-widget-4.webp) | 正常渲染，未见节点或连线遮挡 |
| S3 · OAuth 2.0 + PKCE (EN, alt 分支) | widget-3 | [实际截图](screenshots/sequence-widget-3.webp) | 正常渲染，未见节点或连线遮挡 |
| S6 · 订单 Saga 分布式事务（中文·16 消息） | widget-6 | [实际截图](screenshots/sequence-widget-6.webp) | 正常渲染，未见节点或连线遮挡 |
| S7 · Event-Driven Notifications (EN·async+self-call) | widget-7 | [实际截图](screenshots/sequence-widget-7.webp) | 正常渲染，未见节点或连线遮挡 |
| S8 · 库存扣减·三层嵌套片段（中文） | widget-8 | [实际截图](screenshots/sequence-widget-8.webp) | 正常渲染，未见节点或连线遮挡 |
| S9 · K8s Pod Startup（EN·13 参与者） | widget-9 | [实际截图](screenshots/sequence-widget-9.webp) | 13 参与者全部保留；修复前宽窄视口滚动/节点定位通过 |
| S10 · CDN 回源与预热（中文·嵌套 opt+loop） | widget-10 | [实际截图](screenshots/sequence-widget-10.webp) | 正常渲染，未见节点或连线遮挡 |
| S5 · Batch Job（EN·par+loop+async） | widget-5 | [实际截图](screenshots/sequence-widget-5.webp) | 正常渲染，未见节点或连线遮挡 |
| W1 · Document Approval (EN, minimal) | widget-1 | [实际截图](screenshots/workflow-widget-1.webp) | 清楚；统一大尺寸 Widget 留白较多，可选紧凑尺寸 |
| W2 · 员工入职流程（中文·fork/join+回环） | widget-2 | [实际截图](screenshots/workflow-widget-2.webp) | 首次截图为长图首屏；共享高度适配已修复，W7 代表复验通过 |
| W4 · 线上故障应急响应（中文·多回环） | widget-4 | [实际截图](screenshots/workflow-widget-4.webp) | 首次截图为长图首屏；共享高度适配已修复，W7 代表复验通过 |
| W6 · 贷款审批（中文·多决策） | widget-5 | [实际截图](screenshots/workflow-widget-5.webp) | 首次截图为长图首屏；共享高度适配已修复，W7 代表复验通过 |
| W7 · Content Moderation (EN, 4 groups) | widget-7 | [实际截图](screenshots/workflow-widget-7.webp) | 首次截图为长图首屏；共享高度适配已修复，W7 代表复验通过 |
| W8 · 电商订单履约（中文·21 节点） | widget-8 | [实际截图](screenshots/workflow-widget-8.webp) | 首次截图为长图首屏；共享高度适配已修复，W7 代表复验通过 |
| W10 · 报销审批（中文·多级决策） | widget-10 | [实际截图](screenshots/workflow-widget-10.webp) | 首次截图为长图首屏；共享高度适配已修复，W7 代表复验通过 |
| W9 · Data Quality Gate (EN, long labels) | widget-9 | [实际截图](screenshots/workflow-widget-9.webp) | 首次截图为长图首屏；共享高度适配已修复，W7 代表复验通过 |
| W3 · Release Pipeline (EN, fork/join) | widget-3 | [实际截图](screenshots/workflow-widget-3.webp) | 首次截图为长图首屏；共享高度适配已修复，W7 代表复验通过 |
| W5 · Payment Retry & Dunning (EN, groups) | widget-6 | [实际截图](screenshots/workflow-widget-6.webp) | 首次截图为长图首屏；共享高度适配已修复，W7 代表复验通过 |

## 检查与交付边界

- [sources.json](sources.json)：31 份完整 MCP 回读 HTML 和内容哈希。
- [captures.json](captures.json)：31 次实际对象截图的 revision、映射和 pixelVerified 记录。
- [layout-audit.json](layout-audit.json)：全部 31 个模型在 640 / 1960px 下的 62 次布局检查，均无错误或几何 issues。
- `test/latest-canvas-diagrams.test.js` 已将这 31 个源模型加入回归，同时保留 r2 的全部样例与原测试宽度；验证语义、对象数量、显式方向和源数据不可变。
- 7 个相关测试文件共 32 项通过（viewport、latest samples、native diagrams、workflow、architecture reflow、sequence、full content snapshot）。
- 新增的总览适配测试修复前失败、修复后通过；三个图表构建产物一致性检查通过。
- Canvas 正式目录 `/Users/heack/workspace/penecho_071_version`，分支 `codex/update-localization`，HEAD `1fc4ec9a417ab6d1f141445b1a13051cfd2818a9`。
- Cloud 正式目录 `/Users/heack/workspace/penecho_cloud`，分支 `codex/newsletter-default-20260916`，HEAD `f42d275d1677d8bf8ecc98815241f235271aaea0`。
- 通过官方 `sync-public-canvas.mjs --only=widget-host.js,vendor/architecture-runtime.js,vendor/sequence-runtime.js,vendor/workflow-runtime.js` 同步并检查通过；Agent runtime mirror 检查通过。
- 全量镜像检查存在同期其他修改的 app.js / index.html / locales/zh.js 差异，本次没有覆盖或部署这些文件。不能将四文件同步通过表述为全仓库干净或全量同步一致。
- UAT 静态部署仅更新上述四文件和 UPSTREAM.json，后续 deploy plan 为 none。[served-assets.json](served-assets.json) 记录实际 HTTP 返回的四文件 SHA-256，全部与正式源码构建产物一致。
- UAT 实际挂载：Cloud `.local-uat-runtime/public` → `/uat/public`，Cloud `src` → `/app/src`，Cloud `migrations` → `/app/migrations`。应用容器健康。
- 状态：已写入本地正式项目，已官方同步并部署 UAT；未提交、未推送、未部署生产。

## 复验中断记录

A9、W7 的修复后 MCP 实验已通过。S9 宽/窄和 W8 窄视口的修复前滚动与定位实验通过；修复后补充请求遇到 request_cancelled / canvas_timeout，未记为通过。当前等待浏览器保持前台后补齐这一组检查。没有将 MCP 临时 inspect 误报为保存了新的 Canvas 对象。
