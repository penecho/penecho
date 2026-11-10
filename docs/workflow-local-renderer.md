# Workflow 本地渲染

新增 workflow 前的架构图与时序图基线：`1fc4ec9`，正式源码为 `penecho_071_version`。Workflow 的 schema、布局策略、SVG 绘制、运行时与交互适配均在独立的 `src/workflow/` 中。架构图和时序图的源码与生成文件保持基线内容。

## 调用与按需加载

1. MCP `penecho_get_guidance({id:"workflow"})` 读取独立规则。Visual Explorer 只列出规则目录，不载入 workflow 正文。
2. `penecho_present_widget` 恰好接受一个 `html / architecture / sequence / workflow` 字段。
3. workflow 是 `{version:1,title,nodes,edges,...}` 语义数据。服务端只做字段、引用和流程约束校验，并封装成 HTML，不计算坐标。
4. `objects/<id>/widget.html` 是实际虚拟源文件，其中 `data-workflow-source` script 保存 JSON。`widget.json` 与几何文件沿用现有 Widget 协议；不存在额外的服务器 JSON 文件或嵌套 iframe。
5. Widget host 只在出现 `data-penecho-workflow` 和相应 JSON 标记时注入 workflow runtime。普通 HTML 与其他图不会因此执行 workflow。布局在浏览器 Blob Worker 中完成，使用已有的本地 ELK worker 资产；无需新增网络依赖或第二份 ELK worker。

## 流程语义与显示

- `start / end` 使用胶囊轮廓；`process` 使用步骤框；`decision` 使用菱形。
- `fork / join` 使用带横条的步骤框表示并行分支与等待汇合。条件分支的普通汇合可以使用 process，不暗示并行等待。
- decision 至少有两条不同条件标签；循环的返回边必须明确 `kind:"loop"` 并提供条件文字。拒绝歧义分支、悬空引用、未声明的循环及坐标字段。
- 文字按实际字体测量，主图不缩小文字。宽度不足时尝试纵向布局；复杂并行图仍放不下时只让图内横向滚动，周围文字和详情不产生整页横向滚动。
- domains 驱动节点与说明区域的对应颜色。节点点击/键盘打开详情，SVG/PNG 单独导出主图，等待当前宽度的重排结束。
- 组框表示职责或流程边界，不是 BPMN 泳道；此版本不是 BPMN 执行引擎，也不提供可拖动的节点编辑器。

## 隔离与构建

复用基线的文本测量、Archify 路径几何、PenEcho 面板与 reflow 控制器，但不修改这些文件。共享改动仅涉及 MCP 输入路由、registry 元数据、host 加载/快照等待、静态资源路由及构建打包。Workflow 自有导出适配器独立等待 workflow settled，不改变基线导出行为。

`npm run build:workflow` 生成 runtime 与第三方许可说明；`npm run check:workflow` 校验生成物。`npm run check` 包含新入口、lazy-load 隔离、流程语义、宽度布局及原有渲染器回归。运行进程需要重新加载后才会发布新 schema；旧对话缓存的工具列表可能还需客户端重新连接。

自动测试输入保留在 `test/fixtures/diagrams/workflow/`；四个独立示例覆盖线性流程、条件退回、有限重试、并行汇合。截图、会话记录和实际画布验收产物仅在本机保留，不作为构建或自动测试的依赖，也不提交到仓库。
