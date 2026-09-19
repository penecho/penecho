# 架构连线绕路复现（2026-09-18）

来源：用户提供的「PenEcho 项目架构」完整 JSON；`input.json` 保留原文。
本目录保留最初的诊断与实验；正式修复和验收结果见末尾。原始对照文件不作为当前生产规则的输出。

## 原始 Canvas 观测

通过浏览器检查用户原始 Canvas「PenEcho 项目架构图」的实际 Widget DOM：

- `data-layout-mode="wrapped"`，`data-layout-width="1248"`。
- SVG viewBox：`0 0 1639 1974`。
- `.pa-map` clientWidth 1254，scrollWidth 1476，折行后仍横向溢出。
- 从 21 条 SVG 路径还原正交长度：总长 38,376，144 个圆角拐点。
- 外部 AI Agent → Local MCP：长度 2,422，两端曼哈顿距离 469，比值 5.17。
- 外部 AI Agent → Cloud MCP：长度 2,526，两端曼哈顿距离 573，比值 4.41。
- Cloud MCP → Cloud：长度 3,617，两端曼哈顿距离 955，比值 3.79。

曼哈顿距离只是两端距离下界，不等于考虑障碍后的可行最短路径。SVG 圆角按其原正交转角计算。

## 原因

1. RIGHT 布局过宽时启用 MULTI_EDGE 折行，但节点端口固定右出左进；折到下一行的边被迫反复横穿全图。
2. DOWN 候选存在 `Route crosses frame title: e_4/agentrt`，被几何检查淘汰。
3. 没有有效候选能适配宽度时，选择器只比较宽度，忽略连线距离。

## 可重现的受控实验

在项目根目录执行：

```sh
node testcase/architecture-routing/2026-09-18/analyze.mjs
node testcase/architecture-routing/2026-09-18/build-comparison.mjs
```

使用正式 layout/render 模块与项目 ELK 版本，采用一致的 CJK fallback 测量。数字不能与原始浏览器测量混作同一次运行。

| 方案 | 布局宽×高 | 线长 | 拐点 | 几何检查 |
|---|---|---:|---:|---|
| 自动，可用宽 1450 | 1709×2068 | 39492 | 144 | 通过 |
| 自然 RIGHT | 2881×1285 | 15892 | 44 | 通过 |
| 自然 DOWN | 2023×1730 | 16099 | 42 | 分组标题碰撞 |
| DOWN，标题预留 96 | 2023×1858 | 16614 | 42 | 通过 |
| 紧凑 DOWN，标题预留 96 | 1087×3472 | 26936 | 66 | 通过 |

推荐先改善分组标题空间，再让超宽候选的评分考虑连线路程，避免只追求更窄而选中大量回绕的折行图。96 仅为该样例的验证值，不建议直接视作所有图的固定配置。

`comparison.html` 是可独立打开的同源渲染对照；所有节点、连线、分组和说明均保留。

## Canvas 对照交付

用户明确授权 MCP 云端传输后，已写入测试 Canvas「架构图连线路径实测」。
documentId：`doc-02d5046b3aad251a3f9c4907503eea646729e7240b375eb864d3cf13b3fe4546`。
artifactId：`architecture-original`，objectId：`widget-2`，revision：3。
MCP 返回 `applied:true`、`pixelVerified:true`，实际部件视口 1537×900。
另以 2200×3100 inspect 检查长内容；图内仍保留横向滚动，截图不等于把溢出的内容全部展开。
对照为正式渲染器预计算 SVG，不代表已部署新的自动布局策略。

## 正式修复与验收

已在 071 的 `src/architecture/layout.mjs` 实现：DOWN 标题按较窄的侧边空位预留换行高度；候选评分同时考虑阅读高度、线长、拐点和超宽程度。有适配方案时，只有路由成本至少低 25% 的超宽候选可以参与比较。默认方向仍为 RIGHT，按实际宽度自动适配。

构建产物已通过官方 `build:architecture` 更新，Widget Host 的 architecture runtime URL 更新至 v6。

- 不可变的旧规则指标：`baseline-metrics.json`。回归测试使用此文件，不依赖重跑实验脚本后的结果。
- 新规则指标：`implemented-metrics.json`。可用宽 1248/1450/1600 时为 DOWN，2023×1745，总线长 16098，42 个拐点；相对原折行减少 59.2% 的线长和 70.8% 的拐点。
- 3200 宽保持 RIGHT；800/390 宽使用 compact DOWN，所有节点和关系保留。
- 真实 Widget Host + 浏览器 Worker 验收：容器 1450/1248 时为 DOWN，SVG 1887×1646；容器 3200 时为 RIGHT，SVG 2726×1212；390 时为 compact。差异来自浏览器实际字体测量。
- 实际浏览器 DOWN 路由：18 节点、21 边、总正交长度 15103、42 个拐点，没有运行时几何错误。
- 检查了 200% Edge 浏览器缩放；390 容器的标题、说明卡和 notes 未发生横向文本溢出，图形使用既有局部滚动。浏览器比例已恢复 100%。
- 重排后节点详情可打开，原内容与相关关系保留。
- 127 项 architecture/widget/guidance 测试通过，`check:client`、`check:architecture`、`git diff --check` 通过。

浏览器复测可在本项目执行 `node testcase/architecture-routing/2026-09-18/serve.cjs`，访问其输出的本机地址。这个有路由白名单的静态验收服务只加载真实 Widget Host 和测试数据，不启动 PenEcho、不读写应用状态。

交付状态：修改与构建产物在正式 071 项目，未提交、未推送、未同步 Cloud、未部署。原 MCP 对照保留为实验记录。
