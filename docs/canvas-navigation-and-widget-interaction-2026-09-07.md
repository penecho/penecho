# 画布导航与 Widget 交互

实现日期：2026-09-07。由主代理亲自实现和验证，未委派子代理。

## 操作约定

| 状态 | 鼠标 / Pencil | 手指 | Widget |
| --- | --- | --- | --- |
| Hand | 在画布内容区域拖动，包括 Widget 上方 | 单指平移；双指平移、缩放 | 继续运行，内部输入暂时关闭；轻点显示工具栏，右键列出工具栏，双击进入内部交互 |
| 笔 | 书写、批注，保留原来的笔迹和 AI 关联 | 单指平移；双指平移、缩放；落笔期间忽略新增触摸 | 不触发内部按钮；右键列出工具栏（双击仍属于书写） |
| 选择 | 选择、移动对象及操作尺寸手柄；空白处保留笔迹套索 | 选择、移动对象；双指导航 | 通过“交互”按钮、右键菜单或双击进入内部交互 |
| View · Hand（默认） | 任意内容处拖动画布 | 单指平移；双指平移、缩放 | 不误触内部内容；双击进入内部交互 |
| View · 选择 | 第一次点击只激活命中的 Widget | 第一次轻点只激活；未激活时双指仍导航 | 激活后原生鼠标、键盘、滚轮和多指事件全部交给 Widget |

Widget 交互不重放选中它的那次点击。激活后，地图等内容负责自己的拖动、捏合、内部滚动与浏览器默认行为；外层画布不再接管该区域内的手势。交互能力仍受 Widget 自身实现及现有 iframe 沙箱权限约束。

重叠区域通过实际 DOM 层叠命中最前面的 Widget。未激活的前景 Widget 也会阻挡后方已经激活的 Widget。View 中切换交互对象不改变对象顺序。

固定的“退出控件交互”、View Hand、缩放和适应全部内容按钮提供导航出口。Escape 优先退出控件交互；Widget 自己处理并取消的 Escape 保留其原生含义。输入框内的字符不触发画布工具快捷键。

## 桌面导航

- 触控板双指滚动默认按 X/Y 两轴平移；捏合围绕指针位置缩放。
- 普通鼠标滚轮默认平移；Shift + 滚轮横向平移；Ctrl/Cmd + 滚轮缩放。
- 设置中的“使用滚动缩放”提供原来的偏好，开启后也会影响触控板滚动。
- Space 临时切换 Hand，松开恢复原工具；输入框、按钮和 Widget 内部键盘输入遵循自身行为。
- 保留中键 / Alt 的现有临时平移入口。H / V / P 分别选择 Hand / 选择 / 笔；View 仅使用 H / V。
- 固定缩放条提供缩小、100%、放大、适应全部内容。

## 实现与设计对应

- `src/client/app/canvas-navigation.js` 集中管理导航、滚轮与 Safari 手势、View 子工具和 Widget 激活状态。
- `ui-bootstrap.js` 负责 Pointer Events、手指导航和工具切换；`canvas-runtime.js` 负责对象编辑、iframe 输入权限及层叠命中。
- `widget-host.js` 向内部文档传递交互状态，交互中不拦截原生手势；保留现有消息来源校验。
- 切换模式保留 iframe 身份，不通过重新加载 Widget 来改变输入策略。
- 界面沿用 `penecho_design` 的 context-toolbar 和 settings-switch 模式；中英文提示同步更新。移动端触控按钮至少 44px，导航条避开安全区。
- `public/app.js` 由 `scripts/build-client.js` 生成。

## 验证

- 新增 `test/canvas-navigation.test.js`：8 项通过，覆盖双轴平移、修饰键、缩放锚点、View 选择、层叠命中、临时 Hand 和 Safari 累积捏合。
- `npm run check`：共 1,093 项，1,087 通过，6 项失败。6 项均已在本次修改前的源文件快照上复现：Codex Native 2 项、Visual Explorer 文案 1 项、Widget 快照旧断言 2 项、连接编辑器旧断言 1 项。
- `scripts/canvas-navigation-smoke.cjs` 使用隔离 Electron 配置和测试服务，加载两层真实 iframe Widget；7 组验收通过，运行时错误为空。覆盖画布拖动、首次点击隔离、原生按钮/滚轮/双指/文本输入、Escape 退出交互、重叠遮挡、对象移动、Space 恢复与 iframe 身份保持；检查桌面、平板和手机尺寸的控制条可见性。
- 视觉静态检测器缺少解析依赖，以降级模式运行；报告的样式项位于已有样式，不代表完整静态检测通过。
- 尚未使用实体 iPad、Apple Pencil 或 Safari 浏览器进行真机验收；浏览器触摸注入和 Safari 手势单元测试不能代替硬件手感验证。

完整检查日志：`/tmp/penecho-navigation-final-check.log`。浏览器验收日志：`/tmp/penecho-navigation-browser.log`。没有提交、推送或部署。

## 同日操作反馈修正

- Hand 轻点 Widget 显示原有工具栏，保持 Hand；超过 6px 的拖动、多指或取消不触发工具栏。内部交互仍须明确点击“交互”。
- 选择工具使用箭头图标，保留空白处的笔迹套索能力。沿用现有 context-toolbar 结构和样式。
- 缩放按钮使用 3%、5%、10%、15%、25%、33%、50%、67%、100%、150%、200% 档位，围绕画布视口中心缩放。
- 滚轮导航期间使用系统原生箭头，复用导航状态的结束计时恢复工具光标；Pointer Down 立即恢复工具显示。没有修改缩放锚点或默认平移手势。用户报告的是指针消失，真实 macOS 光标消失尚未复现，不能宣称系统层问题已解决。
- 本轮针对性测试 129 项中 128 项通过，剩余 1 项是已确认的连接编辑器旧断言；真实浏览器 9 组验收通过，包括新增的 Hand 工具栏、倍率档位和原生 cursor 样式检查。

## AI Refine 只在笔模式出现（2026-09-08）

- 自动出现条件收窄为笔模式：桌面鼠标悬停在 Widget 上、iPad 手指轻点 Widget（笔模式下）才会出现 AI Refine。
- Hand、选择、View、控件内部交互一律不自动出现；Hand 工具栏也没有 AI Refine 入口，避免按钮过多。切出笔模式时按钮立即隐藏。
- 实现：`updateWidgetRefinePointer` 仅在 `state.mode === "pen"` 时命中 Widget；`widgetAtRefinePoint` 不再有 Hand 模式的外扩 12px；`objectChromeSpecs` 不再为 Hand 渲染 Refine；`selectCanvasToolMode` 只在笔模式刷新悬停候选。笔迹批注与 Widget 的关联（写完抬笔后提示）保持原有行为。
- 进行中的 AI 修改任务不受 pen↔hand 切换影响（`staysInWidgetRefineModes` 保留）。
- 另修复：角落“适应全部内容”按钮被共享按钮契约覆盖尺寸导致图标溢出，恢复其 30px/19px 设计；浏览器布局检查改为断言图标在按钮内（契约的 ::after 触控热区圆环会撑大 scrollWidth，属预期绘制）。
- 验证：真实浏览器 10 组验收全部通过，含新增“AI Refine 只在笔模式出现”用例；单元测试 126/129，3 项失败均为既有问题（连接编辑器旧断言 1 项、Studio Agent 样式断言 2 项，与本次改动无关）。

## 右键菜单、双击进入交互与交互状态条（2026-09-09）

- Widget 工具栏不再显示对勾（保留组件）与叉（删除组件）两个决定按钮；已存在的 Widget 只保留拖动面、交互、复制、收藏/分享与下载。Delete / Backspace 仍删除选中的 Widget，Escape 仍取消移动与缩放，待确认的 AI 草稿仍保留接受与丢弃。
- 右键点击 Widget 会在 Widget 上方列出同一工具栏，供选择“交互”等动作；笔、Hand、选择三种工具下都可用，View、临时 Space 平移和正在交互时不响应，Widget 上的浏览器原生菜单不再弹出。命中层级仍以实际 DOM 绘制顺序为准。
- 左键双击 Widget 直接进入内部交互：Hand 与 View·Hand 会先切到拥有交互能力的选择工具，View·选择保持原来的首次点击激活行为。笔模式的双击继续属于书写，不进入交互。
- 交互中 Widget 上方显示状态条（“正在交互中” / “Interacting”），带强调色圆点与描边，位置随平移缩放预览同步移动；退出交互后隐藏。View 模式下同样显示，作为唯一的交互状态提示。
- 实现：`canvas-navigation.js` 新增 `enterWidgetInteraction`、`showWidgetContextToolbar` 与 `dblclick`/`contextmenu` 监听，`ui-bootstrap.js` 不再单独拦截 `#screen` 的右键；`canvas-runtime.js` 的 `addObjectToolbarSpecs` 支持 `decisions:false`，`objectChromeSpecs` 允许笔模式渲染 Widget 工具栏并保持 Refine 只在笔模式出现，`syncWidgetInteractionStatus` 负责状态条。
- 验证：单元测试覆盖右键列工具栏、Hand/View 双击进入交互、笔模式双击不进入、待确认 Widget 与交互中不响应、无决定按钮的工具栏宽度与交互居中布局；`scripts/canvas-navigation-smoke.cjs` 增加右键、双击、状态条位置与 View 模式状态条用例，10 组验收全部通过，运行时错误为空。
