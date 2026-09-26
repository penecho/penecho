# Widget 最大化：原生页面视口验收 · 2026-09-24

> Update: the entry-scale requirement is superseded by [width-fit presentation](widget-width-fit-20260924.md). Existing single-scroll and saved-height protections remain applicable.

> 后续修正：本轮接受双滚动条的结论不符合用户要求。当前已改为单一外层页面滚动，并完成实际鼠标滚轮验收，详见 [单一页面滚动验收](widget-single-scroll-20260924.md)。入场比例与保存高度下限继续有效。

本记录按用户最后确认的规则，取代此前两轮最大化实现说明。源码位于正式 `/Users/heack/workspace/penecho_071_version`；未使用外部源码目录。

## 已确认的行为

- 最大化扩大外框，并保留进入时的屏幕显示比例。工具栏 100% 表示进入时的比例；主动选 50% 才变成该比例的一半。不得按整页宽高自动缩放。
- iframe 宽度跟随可用区域；高度为可用高度与保存的 `contentH` 中较大的值。例如保存 1100px，窗口较小时保留 1100px，窗口较高时可扩展到 1328px。
- 页面自身的 CSS、固定尺寸、定位和滚动继续生效。明确指定 320px 的内容保留 320px，额外宽度留白；页面显式要求的宽内容可以横向滚动。
- 最大化不修改已保存 Canvas 几何或笔迹。固定像素布局保留其尺寸和锚点；百分比、vh、响应式布局可按新的浏览器视口正常重排，不能再承诺这些坐标在任意窗口中完全相同。
- 保留同一个 iframe 和页面运行状态。显式 Canvas Fit 是独立操作，退出最大化后恢复其原有行为。

## 原因与实现

此前存在三个相互叠加的问题：

1. 内容依赖视口高度，宿主又将测量出的内容高度写回 iframe，形成尺寸反馈。
2. 宿主把根元素及部分容器改成 `height:auto`，使固定高度 / 百分比定位布局塌缩。
3. 后续整页适配将显示比例绑定到内容宽高，长流程图随之缩小。

本次删除最大化的 ResizeObserver / MutationObserver 测量、尺寸回传和宿主反向改高逻辑，也不再在最大化时注入 Fit CSS。父页面忽略旧宿主的 presentation-size 消息，避免混合缓存版本重新引入循环。

外框使用正常 Grid 布局，iframe 填充可用区域并以保存高度为下限。显示比例仅由进入时的 Canvas 比例和用户主动选择的工具栏比例决定。没有新增布局分类、收敛猜测或特殊 Widget 白名单。

## 浏览器验收

从正式项目启动仅绑定回环地址的临时实例，采用独立测试数据和不可用的测试模型地址。通过 Canvas Library 正常载入样例；UI 操作使用浏览器控件，尺寸检查为只读 DOM 测量。测试没有修改用户提供的原始 UAT 画布。

| 场景 | 实测结果 |
| --- | --- |
| 等比 75% Canvas 样例 → 最大化 | 进入前后比例均为 0.75；字体 CSS 为 28px，未按整页适配；保存高度 1100px 得到保留 |
| 主动选择工具栏 50% | 实际比例变为 0.375；输入值保留 |
| 保存高度 1100px、1440 × 900 窗口 | iframe 高 1100px，外框可纵向滚动，未被压到可用区域的 828px |
| 1440 × 1400 窗口 | iframe 高 1328px，高于保存的 1100px；内部固定 1100px 容器保持不变 |
| 中文 / 125% UI 缩放，等比固定高度样例 | 普通 Canvas 与最大化的字体 28px、标题行高 44.8px、固定容器 1100px、固定锚点文档坐标 978.8px 完全一致 |
| 长流程图 | 标题前后均为 24px / 行高 31.1953125px；iframe 保留 1600px 高度，内容清晰，不自动缩成整页预览 |
| 普通长文档追加 / 移除 600px | iframe 保持 1400 × 828；文档滚动高度 2855 → 3455 → 2855；末尾可达 |
| 390 × 844 窄屏，200vh 样例 | 外框 client/scroll 均为 390 × 844；iframe 374 × 784，文档高 1850px；没有宿主横向溢出或高度反馈，末尾文字完整可见 |
| 原始百分比定位 HTML | 最大化后主容器未塌缩，截图无模块重叠；百分比位置按新视口重排，未将坐标一致性作为本轮结论 |
| 原始 Live Clay，中文 / 125% UI 缩放 | 两次进入的视口和文档均为 2486 × 1449；场景完整，暂停状态保留，未连续增高 |

长流程图使用正式 workflow 渲染器与仓库中的长流程样例，未声称它是用户截图中的同一份文档。Live Clay 与百分比定位 HTML 使用先前只读取回的原件测试副本。可复用新样例位于 `test/fixtures/widget-browser-viewport.cjs`。

固定高度超过屏幕、且页面内容又超过该高度时，可能同时存在外框与页面自身的纵向滚动；验收确认末尾可达。浏览器工具在变换后的嵌套 iframe 中部分滚轮输入未产生滚动，因此未将无效果的滚轮调用记作通过；通过激活末尾元素滚入视口并目视检查末尾。

## 自动化及运行版本

- `node --test test/widget-*.test.js test/science-widget-runtime.test.js test/liveclay-world.test.mjs`：122/122 通过。旧尺寸反馈算法及其专属测试已删除，改为原生视口、无 CSS 改写、旧消息忽略、进入比例、主动缩放和 iframe 状态保持测试。
- `npm run build:client`、`npm run check:client`、`npm run check:playground`、`node --check public/widget-host.js`、`git diff --check` 通过。
- 临时实例实际返回的文件与正式项目逐字节一致：

```text
app.js          8d09ab9f690b0b7a76f834485ff3c60b39c47a4c48352dcde98e1a2cc6b59308
style.css       6250026506e4418984bf53306e3a980acb794bb05e88fedc816211f9648172cf
widget-host.js  bd85603122ec64dd72f555e36f5ccf5eefa0ecee790a1a82612fa1121de92c4d
```

## 交付与边界

071 当前为 `main`，已有 4 个本地领先提交；本次修改保留在正式项目，未提交、推送。既有其他任务改动已保留。Cloud 当前为 `codex/cloud-prod-20260920-legacy-compat`，已有 8 个本地领先提交；本次未同步或部署。

只读核对官方同步工具的 allow-list 确认上述静态文件由 071 管理。实际 UAT 容器 `penecho-uat-local-app-1` 将 Cloud `.local-uat-runtime/public` 挂载到 `/uat/public`；其中 Canvas 文件仍与 Cloud 镜像相同，尚不包含本次修复：

```text
widget-host.js  723fd181f970269e66b96372abf62fa1919ed6880284734f3201797c57d65f74
style.css       ac6cac452a3855b1a2b6bbcc0f229dd7a753c94d2e4977c96c6343e77f74a198
app.js          ec438e894bcfb10ffef07ba9c3d12b41350b9a578f3ef73c9e42405075f9c77f
```

说明图源文件 `docs/testing/widget-height-explainer.html` 同步更新为当前规则。原 MCP 会话已失效，重新查询的连接没有开放画布，本轮未能更新原在线说明画布。

按用户此前明确的通用规则保存授权，更新个人 PenEcho skill 中同一条 Widget 规则，使其符合此次澄清；skill-creator 校验通过。临时测试进程 PID 52172 已结束，56159 端口无监听；测试标签已关闭，浏览器视口覆盖已恢复。
