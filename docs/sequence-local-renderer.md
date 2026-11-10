# 时序图语义输入与本地渲染

时序图使用 `sequence/1` 语义对象：模型负责参与者、消息顺序、分支及解释，本地渲染器负责坐标、换行、生命线、正交箭头和交互。该功能沿用现有架构图 Widget 的展示体系，只扩展时序图及混合文档中的时序图区块。

## 输入与编辑入口

先通过 `penecho_get_guidance` 读取 `id:"sequence"` 的独立规则，再调用 `penecho_present_widget`。`html`、`architecture`、`sequence` 必须三选一；`sessionId`、`artifactId`、工具级 `title` 和请求标识放在外层，不放入语义对象。

```json
{
  "sessionId": "current-session",
  "artifactId": "request-sequence",
  "title": "请求与响应",
  "sequence": {
    "version": 1,
    "title": "请求与响应",
    "participants": [
      {"id": "client", "label": "客户端"},
      {"id": "api", "label": "API"}
    ],
    "messages": [
      {"id": "request", "from": "client", "to": "api", "label": "读取报告"},
      {"id": "reply", "from": "api", "to": "client", "label": "返回报告", "kind": "return"}
    ]
  }
}
```

完整字段规则位于 `src/server/canvas-agent/visual-rules/sequence.md`；`src/sequence/schema.js` 在 MCP 边界与浏览器布局时验证引用、范围和大小，拒绝未知字段以及 `x/y` 等几何输入。服务端只生成小型 HTML 包装，不运行布局。原始 JSON 保存在现有虚拟文件 `objects/<objectId>/widget.html` 的 `data-sequence-source` 脚本内；修改继续使用现有读取、补丁、版本与幂等机制，保留 `artifactId` 和用户几何位置。

混合报告可通过 `html` 包含以下区块，周围内容按原来的 HTML 方式编写，无需额外 iframe：

```html
<section data-penecho-sequence>
  <script type="application/json" data-sequence-source>
    {"version":1,"title":"请求","participants":[{"id":"a","label":"客户端"},{"id":"b","label":"API"}],"messages":[{"from":"a","to":"b","label":"读取报告"}]}
  </script>
</section>
```

JSON 字符串中的 `<` 必须转义为 `\u003c`，避免提前结束脚本元素。

## 独立加载与实现边界

- 规则注册表仅公开 `sequence` 的目录信息；正文按需读取并按版本/hash 复用。普通 Visual Explorer 内容无需加载时序规则，架构图和时序图规则分别缓存。
- Widget Host 仅检测到 `[data-penecho-sequence]` 下的 `application/json`、`data-sequence-source` 标记时，才加载同源 `sequence-runtime.js` 并开启图表下载权限。普通 HTML 不加载该运行时；只有时序图的文档不加载架构图运行时或 ELK Worker。
- `src/sequence/layout.mjs` 依据参与者数组固定左右顺序，依据消息数组安排上下顺序。不同参与者之间使用水平线，自调用使用直角折返；返回消息为虚线，异步消息为空心箭头。时序图不使用 ELK，也不需要模型生成 Mermaid、SVG 或布局代码。
- Archify 2.17 的边界为本地改编的时序展示思路及既有转义、语义图标辅助函数。没有引入完整上游 CLI、Viewer、动画录制或全部图表格式。许可随 `public/vendor/sequence-LICENSES.txt` 交付。
- 复用 `src/architecture/render.mjs` 的色域与外壳、`interactions.mjs` 的详情和导出、`reflow.mjs` 的宽度调度；公共文本换行位于 `src/diagrams/text.mjs`。这些共享模块变化时须同时验证架构图。

## 宽度、片段与交互

布局读取区块自身的 CSS 内容宽度。参与者框宽度在 136–204 px 之间调整，生命线列距保留可读空间；浏览器实测文本宽度后换行，尽量保留短英文词、路径和括号短语，避免闭合标点单独占行。高度随标签、注释和片段条件增长。窄窗口保持参与者的语义顺序，在主图内部横向滚动；不会为了塞满视口持续缩小字体或把参与者改成多行。

宽度变化复用 180 ms 稳定窗口、16 px 宽度分桶和最近三个宽度缓存；同文档的时序布局串行提交。Canvas 平移、缩放变换或仅高度改变不要求重新布局。重排只替换主图 SVG，并恢复已有详情选择与键盘目标；页面离开时清理观察器和调度。Widget 的 fit-content 测量保留主图滚动容器，避免内容宽度反过来扩大整个 Widget。

`alt`、`opt`、`loop`、`par`、`critical` 使用透明虚线外框，分支间使用虚线分隔。标题文字只有局部白色描边，没有跨越生命线的不透明标题带。消息标签和注释可有局部文字底色。垂直距离表达阅读顺序，不代表耗时；`alt` 分支互斥，`par` 的上下排列不代表并行分支之间存在先后关系。

参与者和消息支持点击、Enter/空格打开详情；Escape 或关闭按钮收起详情并返回原目标。消息详情展示发送方、接收方、注释和补充说明，颜色随发送方的色域。底部详情卡沿用相同色域，主图标签保持简短。

SVG/PNG 按钮导出当前主图，不包含外层标题、详情卡或报告正文。导出和 Widget 截图等待当前宽度的待处理布局；混合架构图/时序图文档的就绪屏障等待两类运行时完成或明确报错。PNG 以最多 2 倍编码，受单边 4096 px 和 1200 万像素预算约束；导出失败在区块状态行显示。

## 输入上限与兼容性

参与者 1–16 个，消息 1–120 条，激活区间最多 80 个，片段最多 24 个、嵌套最多 4 层。片段和激活区间引用显式消息 ID，范围只能严格嵌套或相离；子片段不能跨父片段分支。仅 `alt/par` 支持后续分支，每个片段最多 12 个。整个语义对象序列化后最多 60000 字符。标签与详情另有长度限制，见规则及验证器。

布局不判断业务事实，不自动补造返回、异步消息、并行关系或激活区间；也不提供拖动参与者重排、直接拖线编辑、时间比例轴、完整 UML 编辑器或动画播放。复杂场景应拆分为多个可读视图。

旧 HTML Widget 保持原入口。新增语义入口需要配套服务端、Widget Host 与生成资产；旧版 Canvas 不能仅靠服务端接受 JSON 获得本地渲染能力。验收目录中的自包含 `*.preview.html` 内联已布局 SVG 和交互，用于现有旧 Canvas 的兼容展示；它们保留 `data-preview-source`，不是正式运行时的 `data-sequence-source`，也不证明新运行时已部署。预览固定生成宽度，不能代替正式运行时的动态重排验收。

## 构建与验证

在本仓库根目录执行：

```sh
npm run build:sequence
npm run check:sequence
npm run build:architecture
npm run check:architecture
node --test test/sequence-runtime.test.js test/architecture-runtime.test.js test/architecture-reflow.test.js
node --test test/mcp-scoped-guidance.test.js test/widget-host-presentation-size.test.js
npm run check
```

共享文本、外壳或交互变更后同时重建两个运行时。`prepack` 已包含时序构建，`check` 已包含生成资产一致性检查。服务端以一天缓存提供资产；已发布运行时变化时须更新 `public/widget-host.js` 中对应资产的缓存版本。浏览器运行不依赖联网获取上游包。

## 2026-09-18 验收证据与交付状态

自动测试输入保存在 `test/fixtures/diagrams/sequence/`：

| 证据 | 用途 |
| --- | --- |
| `mcp.json` | MCP 请求路径：规则读取、文档执行、可选截图 |
| `payment.json` | 合成支付场景：自调用、返回、loop、alt、激活区间 |
| `async.json` | 合成后台任务：异步消息、par 与完成通知 |
| `nested-fragments.json` | 嵌套片段标题与生命线、激活区间的间距回归 |

原始预览、浏览器截图、导出和会话记录仅在本机保留，不提交到仓库，也不作为构建或自动测试的依赖。README 使用的精选示例单独保存在 `docs/assets/professional-diagrams/`。

本轮验收记录：全量 `npm run check` 通过 2013 项测试；最后一次文本换行调整后，时序、架构与重排的 16 项针对性测试通过。测试覆盖语义输入互斥、非法引用与范围、不同宽度的正交线路与换行、透明片段标题、混合就绪屏障、独立规则加载和内部滚动保留。全量结果早于最后一次换行调整，不将其表述为调整后再次全量执行。

文档核对已检查实现、三份语义样例、预览生成入口和证据文件清单，并查看 `desktop.png`、`canvas-payment-v2.webp` 的设计延续；不据此声称所有导出格式、全部浏览器或远端环境均已独立验证。

正式源码位于当前 071 项目，记录时分支为 `codex/update-localization`。`base1` 标签解引用为提交 `22a89c4ea676044ea2df4dc5b997c3a08aed2a62`，代表本次时序扩展前的架构图基线。本次时序增量处于本地未提交状态，尚未推送或部署；旧 Canvas 预览不是运行时发布。后续 Cloud 交付须从正式 071 目录走官方同步并核对实际运行挂载。

## 设计延续

此增量复用既有浅色六色域、白色外壳、标题/说明/图例/主图/详情卡的文本层级，以及色域匹配的详情弹层和导出入口。透明片段框补充时序语义，同时保留生命线连续可见；没有建立新的全局设计系统。`DESIGN.md`、`PRODUCT.md` 和 `.impeccable` 设计文件均不在此次文档交付范围。

架构图文档的输入说明已同步为 `html/architecture/sequence` 三选一，与当前工具契约一致。
