# 原始 30 例图表与 MCP 写入完整性验收

日期：2026-09-19。环境：现有 UAT `internaltest.penecho.ai`，用户已授权的浏览器连接。Canvas 读取、写入、截图和交互探针均通过 PenEcho MCP；未使用 computer use。

## 交付与范围

原始三份测试画布保留，原始 30 份语义模型完整保存在 `original-models.json`。修复位于正式 Canvas 项目 `/Users/heack/workspace/penecho_071_version`，分支 `codex/update-localization`；通过官方同步脚本同步至 `/Users/heack/workspace/penecho_cloud`，分支 `codex/newsletter-default-20260916`，已部署现有 UAT。未提交、未推送、未部署生产。两个仓库原有的其他未提交修改均保留，不能把完整工作区 diff 视为本次修改。

新验收画布：

| 画布 | documentId | 内容 |
| --- | --- | --- |
| 测试① Architecture ×10 · 项目修复验收 | `doc-46b7f19c3ec986581290f3593ba7a4853f95d7de1ae5dd2adf62b2bb97ad202a` | A1–A10 |
| 测试② Sequence ×10 · 项目修复验收 | `doc-acc12cd44b40618dfd14a538ba642c411a231ef7241018eaae3687b685ed6059` | B1–B10 |
| 测试③ Workflow ×10 · 项目修复验收 | `doc-66f708a596e7fa8fe98d9e17f4e05e399511ff657b0d8f41bf2e85415ad85761` | C1–C10 |
| MCP 写入完整性 · 项目修复验收 | `doc-d2585aa2c962914f6271e475ced13e3af86aec7b85bbcd1c32e083d8500cd78a` | 隐藏写入、前台新增、再次隐藏写入，共 3 个独立对象 |

`acceptance.json` 保存每个样例的 objectId、sourcePath、写入哈希、源码回读结果与实际 MCP 截图元数据。三个图表画布各有 10 个不同对象，边界不重叠。30/30 原生 Widget 已逐项截图检查，30/30 原文哈希与写入回执一致、语义模型与原始样例一致；没有通过删节点、删边或改模型让测试通过。

## 原因与修复

1. **隐藏文档复用对象 ID。** 文档的 `nextIds` 与前台全局计数器分离，前台新增后没有同步到隐藏文档缓存，后续隐藏写入可能复用已有 ID；旧对象查找与恢复去重进一步造成旧哈希回执或内容丢失。`canvas-documents.js` 现在每次分配都合并文档计数器、活动计数器及已有对象 ID；写前拒绝重复身份/两个 artifact 共用一个对象，成功回执前核对唯一对象及实际原文。真实 Canvas 按故障顺序写入得到 `widget-1/2/3`，重开后三份原文与哈希均正确；同一 requestId 重试第三次写入返回 `reused:true`，仍只有三个对象。
2. **横向裁切。** SVG 最小宽度与 Widget 有限宽度冲突。新增共享 `src/diagrams/viewport.mjs`，使用完整图总览与 SVG viewBox 缩放/平移，提供节点定位、100%、总览和方向控制；保留完整模型，导出恢复完整图范围。30 次截图的 `overflow.x` 全部为 false。B4 的 Async Processor、B5 的 Order Service 均完整出现。大图交互实测 A10 全部 44 个节点、B10 全部 12 个参与者、C5 全部 11 个节点在 100% 下可完整定位。
3. **长回边与错误前进方向。** Architecture 增加保持主流程的布局约束，并比较无几何冲突、少绕路且适合视口的候选；A5 回边回到局部相邻节点，A9 不再是窄长单列。Workflow 的 loop 只影响回路路由，不能迫使正常前向边倒退；必要时按流程阶段拆分同一职责组的视觉边框，保持原始组身份与节点归属。20 个原始 A/C 模型均无检测到的几何冲突，C 类普通前向边均按布局轴前进。
4. **显式 RIGHT 被自动适配覆盖。** 自动方向候选只适用于未指定方向的输入；C5 在真实 Canvas 中确认 `direction:right`，100% 下所有 11 个节点完整可达。实际验收还发现了横图决策节点高度超过视口的问题，视口最低高度现由节点实际尺寸决定，已复测通过。
5. **浏览器继续加载旧图表 runtime。** Widget 原先使用固定 `?v=6` / `?v=2`；改为构建时写入资源内容哈希，并在 check 模式校验版本一致。源码同步后仍需重新挂载旧 Widget 或刷新已打开页面以加载新脚本。
6. **Library 刷新失败。** 截图中的 `cacheIdentity` 访问尚未就绪的 `state.status.account` 导致异常。正式源码已有空状态保护与远端账户身份读取修复，本次核对测试后将它部署至 UAT；没有把已有修复冒充本次新写代码。用户已明确确认：刷新后可以加载。

## 实测限制

- 大型样例总览缩小文字，用于查看全图关系；阅读细节需使用 100%、节点定位和平移。没有宣称 44 节点或 40 步流程在一屏内仍能逐字阅读。
- C10 仍是长流程，底层逻辑布局约 6440 SVG 单位。当前真实全内容截图高度为 1537 CSS px（图视口上限 900 px），末节点在 100% 下实测完整可见。解决了显示无限变高与内容不可达问题，没有将底层长流程压缩成短图。
- 当说明文字与图表总高超过 Widget 高度时仍允许纵向滚动；验收要求的是横向不丢内容及放大后可导航，并非所有样例 `overflow.y=false`。

## 自动化验证与运行一致性

- 125 个图表/文档/快照相关测试通过，0 失败，详见 `unit-tests.tap`。
- Library 相关 94 个测试通过；Cloud 相关 31 个测试通过。
- architecture、sequence、workflow、client 的构建及一致性检查通过。
- 两个官方同步脚本的 `--check` 均通过；最后 UAT 部署计划为 `none`（没有待部署运行文件）。
- 从正在运行的 UAT HTTP 服务读取 architecture-runtime、sequence-runtime、workflow-runtime、cloud-connect、app、widget-host 六份资源，全部 HTTP 200 且逐字节匹配正式 Canvas 文件。
- 现有容器 `penecho-uat-local-app-1` 的正式运行挂载：Cloud `.local-uat-runtime/public` → `/uat/public`，Cloud `src` → `/app/src`，Cloud `migrations` → `/app/migrations`。不依赖外部候选工作区。

重跑本次核心测试：

```sh
node --test --test-reporter=tap \
  test/canvas-documents.test.js test/diagram-viewport.test.js \
  test/native-diagram-regression.test.js test/architecture-reflow.test.js \
  test/architecture-runtime.test.js test/workflow-runtime.test.js \
  test/sequence-runtime.test.js test/widget-full-content-snapshot.test.js
```

原始几何对照：`before.json`、`after-layout.json`。这些是固定测量器的模型布局结果，浏览器字体实测可能选择不同的自动布局候选；实际截图和交互结果以 `acceptance.json` 及新 Canvas 为准。
