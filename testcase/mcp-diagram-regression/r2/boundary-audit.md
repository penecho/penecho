# 空视口关联路径检查

2026-09-19。Canvas 是 20000 × 20000 的有限区域；相机允许移出该范围。`viewportRect()` 返回相机与 Canvas 的交集，没有交集时返回 `null`，这是合法状态，不能把它全局伪造成可见区域。

## 确认并修复

1. 文档切换：`canvasDocumentsSavedView()` 无条件读取 `view.x`。先前已通过实际 MCP 在画布外复现，再通过重新框选内容解除卡住；修改为保留准确的相机值，空交集存为 `region:null`。测试覆盖上、下、左、右四侧的保存、切换、恢复和原内容保留。
2. Community / Favorites 导入：`importCommunityWidgetArtifact()` 无条件读取 `visible.w/h/x/y`。新增测试在修复前复现 `Cannot read properties of null (reading 'w')`。采用现有图片导入相同的 Canvas 范围回退，新对象放在画布内；正常视口的尺寸和位置不变。检查原对象和原始 artifact 不被改写，收藏身份只能来自受信任的导入参数。
3. Agent 截图：`canvasAgentCapture()` 在无可捕获区域时读取 `region.w/h`。新增测试在修复前复现 `null.w`。现在在创建位图前返回 `EMPTY_CAPTURE_REGION`，指明可移回画布或指定对象/区域；画布外的已有内容仍可通过 `target:canvas` 捕获。没有用空白图片冒充成功。

## 其余调用点

已逐一检查 `src/client/app` 下的 `viewportRect()` 调用：视图事实和虚拟文件允许 nullable region；AI 视口规划检查空区域；图片/MCP Widget 放置已有 fallback；可见动画播放会拒绝空区域；Widget 修改路径均有可见区域判断；内容导出依据实际内容边界。未发现其他同类空值崩溃。不宣称排除了整个产品的所有边界问题。

## 验证和交付

- `final-tests.tap`：248 项相关测试通过，包括最新三个 Canvas 回读模型在 640 / 1280px 的语义、数量、方向和几何检查。
- 三类图表 runtime 和 client 的生成物一致性检查通过。
- 正式源目录：`/Users/heack/workspace/penecho_071_version`，分支 `codex/update-localization`，HEAD `1fc4ec9a417ab6d1f141445b1a13051cfd2818a9`。
- Cloud：`/Users/heack/workspace/penecho_cloud`，分支 `codex/newsletter-default-20260916`，使用官方 Canvas / Agent runtime 同步检查。
- 已静态部署现有 UAT。服务 `/canvas/app.js` 与正式源码完全相同，SHA-256：`92f6de728412e42b35d4082fdc002b2a33a28d43a6ef8df3451fe56a7ae167cb`。
- 实际挂载：Cloud `.local-uat-runtime/public` → `/uat/public`，Cloud `src` → `/app/src`，Cloud `migrations` → `/app/migrations`。最终部署计划为 `none`。
- 本地修改尚未提交、未推送，未部署生产。保留正式仓库已有改动。
- 导入和空视口截图的新增修复有执行源码的回归证据；未声称通过 MCP 点击过 Community/Favorites UI。浏览器需加载新 app.js 才能应用这两处新增修复。
