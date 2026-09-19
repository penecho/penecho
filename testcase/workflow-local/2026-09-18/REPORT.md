# Workflow 验收记录 · 2026-09-18

正式项目：`/Users/heack/workspace/penecho_071_version`，分支 `codex/update-localization`。
按用户要求先提交已有代码：`1fc4ec9`（architecture / sequence baseline）。本次 workflow 改动尚未提交或推送；未部署 UAT / Cloud，未执行跨仓库同步。

## 已完成

- 独立 workflow guidance、语义校验、自动布局、SVG 绘制与浏览器 runtime；模型只提供 JSON。
- 只有对应 guidance 正文和带 workflow 标记的 Widget 才加载新能力。普通 HTML 的浏览器脚本实测只有 `widget-renderer.js`，没有任何图表 runtime。
- 架构、时序、流程在同一 Widget 中均完成原生浏览器渲染；共享 ELK worker 资产只注入一次，各自 runtime 与就绪状态独立。
- `src/architecture/`、`src/sequence/`、`src/diagrams/` 及 architecture / sequence 的生成文件与 `1fc4ec9` 无差异。共享修改限于 MCP 路由、规则目录、host 加载与快照等待、静态资源路由及打包。
- 最终完整 `npm run check`：2019 pass / 0 fail。随后给 workflow 快照阶段补充诊断名称，相关 19 项定向回归全部通过。
- `git diff --check` 无错误；Impeccable detector 对改动的渲染、交互、host 文件返回 `[]`。
- npm dry-run 文件清单包含全部 workflow 源码、规则、runtime、许可证和构建脚本；未发布 npm 包。

## 真实画布：四种场景，两轮保留

画布名：**Workflow 流程图 · 四场景验收**。
文档 ID：`doc-fallback-cd3805eb60671758-63`。

| 场景 | 覆盖能力 | R2 像素证据 |
| --- | --- | --- |
| 内容发布 | 顺序流程、开始/结束 | `linear.r2.webp` |
| 费用审批 | 条件判断、退回补充、不同结束状态 | `approval.r2.webp` |
| 任务执行 | 有限重试、成功和失败出口 | `retry.r2.webp` |
| 发布准备 | 并行、等待汇合、职责框 | `parallel.r2.webp` |

R1 对应 widget-1～4，R2 对应 widget-5～8。没有覆盖或删除历史。八个预览都通过真实 MCP 呈现在画布上，两轮四组截图均返回 `pixelVerified:true`。`.capture.json` 保留元数据，`.webp` 保留像素。

**这里是正式布局/渲染模块生成的 HTML 预览，不是旧 3921 进程对 typed workflow 参数的验收。** `preview.mjs` 的 Node 布局仅用于向未重启的旧进程展示结果，产品运行时布局仍在浏览器 Worker。

R2 根据实测修正：短中文判断的折行、菱形内文字安全区、并行步骤统一最低高度、框标题避开入线、长标题换行，以及混排时重复注入 worker 资产。

## 浏览器原生 JSON 渲染验收

使用 `harness.cjs` / `sandbox.html`，只提供正式 Widget host 和正式 vendor 构建产物；未启动第二个 PenEcho 应用或访问应用凭据。浏览器实际执行 `workflowHtml(JSON)` → host 按需加载 → Worker 布局 → SVG / 交互。

- 环境：本机 Microsoft Edge / Chromium。
- 四场景、长中文、三图混排与普通 HTML 对照均通过。
- 1280 / 760 / 390 CSS 宽度：布局随内容宽度重排；390 下正文 clientWidth 与 scrollWidth 同为 374，复杂分支的地图宽度 600 仅在内部 324 宽容器滚动。
- 原生布局小样本约 0.25～0.4 秒；不包含模型生成时间，也不是大型流程的性能保证。自动化布局另测 1230 / 640 / 320 宽度与长组标题，不存在几何碰撞报告。
- 长中文节点文字边界检查 `outside:[]`；实际浏览器 200% 缩放时图表仍 ready、正文无横向溢出，完成后恢复 100%。见 `long.native-r2.jpg`、`long.zoom-200-r2.jpg` 与 `browser-zoom-200.json`。
- 点击及 Enter 打开节点详情；Esc 关闭并恢复节点焦点。
- SVG 下载成功，包含七个语义节点；PNG 下载成功，尺寸 1512×1348。文件保留为 `parallel.export.svg` / `parallel.export.png`。
- `browser-native-report.json` 包含逐轮结果；`mixed-final` 为 worker 去重后的最终结果，早期 `mixed` 保留用于比较。
- 浏览器控制台未发现 error / warning。
- 8768 临时静态验收进程已结束、端口释放，验收标签已关闭。现有 3921 未被重启。

## 当前尚待的端到端步骤

当前 3921 进程仍发布旧工具 schema；实查 `penecho_present_widget` 只有 html / architecture / sequence，服务尚无新的 `/workflow-runtime.js` 路由。源码与构建已就绪，但内存中的 server 模块不会自动更新。

已向用户请求批准重启 3921，尚未收到答复。依据个人 PenEcho skill 的明确限制 “Never start a PenEcho process without the user's explicit approval”，本次保留运行进程。不能把上述预览与浏览器原生测试称为当前 3921 typed MCP 端到端通过。

批准后下一步：在正式 071 目录按原参数重启 → 新 HTTPS tools/list 确认 workflow 字段与 guidance 枚举 → 复用验收文档再追加四组 typed workflow Widget → 截图及节点交互 → 确认旧架构/时序仍正常。客户端缓存旧工具列表时重新连接并开启新对话验证。

复现命令（在正式项目根目录）：

```sh
npm run build:workflow
npm run check
node testcase/workflow-local/2026-09-18/preview.mjs r2
node testcase/workflow-local/2026-09-18/harness.cjs
```

真实画布脚本 `publish.cjs` 与 `capture.cjs` 使用当次会话文件；会话/浏览器连接失效时先重新绑定同一验收文档，不创建无关历史副本。
