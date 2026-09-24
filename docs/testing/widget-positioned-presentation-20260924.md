# Widget 固定坐标布局回归验收 · 2026-09-24

> 历史记录：下述固定视口与自动适配方案已被用户后续明确的“保持入场比例、原始高度作为下限、原生页面布局”规则取代。当前实现与验收见 [原生页面视口验收](widget-browser-viewport-20260924.md)。

## 问题与原始证据

用户报告 UAT 画布 `ecafe987-0892-4a87-9792-6938df1c0cda` 在最大化 Interact 后发生内容重叠，并明确：模型设定的 Widget 高度可能用于维持内容与 Canvas 笔迹的相对位置，最大化不得破坏这个坐标基准。

只读取得该画布当前版本中的原始 HTML；没有修改 UAT 画布或笔迹。原始 HTML 保存在 `test/fixtures/widget-presentation-positioned.html`，通过正式 Canvas Library API 载入本机临时验收实例。源码及构建产物来自正式 `/Users/heack/workspace/penecho_071_version`。

复现时，iframe 仍为 1939 × 1134，但最大化样式将 html/body 高度改成 auto，并清除了普通容器的视口高度约束。main 从 1134px 塌缩到 572.327px：

- `.repair` 使用 `top:54.7%`，从约 620.30px 移到 313.05px。
- `.current-status` 使用 `top:62.6%`，从约 709.88px 移到 358.27px。
- 根元素的 overflow clip 又把下半部分裁在塌缩后的高度内。

这说明此前“没有继续变高”的验收不足以证明排版正确。首次局部调整虽然消除重叠，却把布局自动展开到约 1200px，依然移动百分比锚点，未作为最终方案保留。

## 最终实现

1. 最大化不再统一覆盖 html/body 的 height、min-height、max-height；取消凭“高度等于视口”就将普通容器改为 auto 的推断。旧版明确 Fit 操作保持兼容。
2. 在既有布局分类流程内识别以视口、完整高度容器或即将展开的滚动容器为坐标基准的绝对/固定定位内容，保留保存时的 contentW/contentH 及原始滚动。普通局部定位卡片和按钮图标不因此锁住整个流式文档。
3. 固定坐标模式使用现有外层 host 承载缩放，内层 iframe 始终按原始宽高布局，通过 transform 整体缩放。避免 CSS zoom 改变滚动条逻辑宽度及文字换行。没有重新创建、克隆或重新挂载 iframe。
4. 普通流式长文档继续测量自然尺寸，既有不收敛反馈保护仍然生效。固定坐标模式和反馈恢复复用同一清理路径。

## 浏览器结果

本机 Chromium，宽屏 1440 × 900、窄屏 390 × 844，英文和中文，界面缩放 100% / 125%，Widget 显示比例 100% / 90%。滚动输入另在 955 × 800 的整数比例视口核验。

| 场景 | 最终结果 |
| --- | --- |
| 原始百分比定位 Widget | 最大化仍为 1939 × 1134；没有塌缩或自动扩大坐标基准 |
| 同一 125% 界面缩放下的画布与最大化对照 | html、body、main、content、evidence、footer、repair、current-status 的坐标、宽高和样式测量完全一致 |
| Widget 从 100% 调到 90% | 上述完整测量结果仍与同一界面缩放下的画布基准完全一致 |
| 窄屏 | 逻辑视口仍为 1939 × 1134；main 宽 1924、repair top 620.296875、current-status top 709.8828125，与 100% 界面缩放下的普通画布一致 |
| 退出最大化 | 恢复普通画布布局，原始尺寸和定位未被写回修改 |
| 长文档动态追加 600px / 移除 | 125% 界面缩放下 iframe 高度 2856 → 3456 → 2856；宽度保持 900 |
| 嵌套内容区和 textarea | 普通内容区仍能展开，textarea 保留独立滚动；早期同一高度保留实现已浏览器核验 |
| 固定坐标输入交互 | 输入“固定坐标与输入均保留”后退出并重新进入，输入值保留，视口 900 × 600 |
| 无绝对定位的 200vh 流式循环 | 经既有反馈保护恢复到 900 × 600；原始内部滚动可达，末尾文字已目视完整显示 |
| 原始 Live Clay | 2012 × 899，body 高及 scrollHeight 均为 899；暂停后退出并重新进入，暂停状态保留 |

UI 125% 与 UI 100% 之间的浏览器字体和像素取整差异仍可能存在；位置一致性按相同界面缩放下的普通画布作基准。窄屏停用界面页级缩放，因此使用对应的 100% 基准。

浏览器工具对经过变换的嵌套 iframe 部分坐标输入存在限制；未将无效果的滚轮或键盘调用记为通过。通过定位并激活末尾内容，实际将末尾滚入原生视口，截图确认完整可见。最终普通回归页面没有警告或错误；Live Clay 使用其原有运行时。

## 自动化与构建

- `npm run build:client`（包含官方 Playground 构建）成功。
- `npm run check:client`、`npm run check:playground`、`node --check public/widget-host.js`、`git diff --check` 通过。
- `node --test test/widget-*.test.js test/science-widget-runtime.test.js test/liveclay-world.test.mjs`：156/156 通过。
- 新增验证涵盖根及完整高度容器坐标保护、滚动容器定位、局部卡片和按钮图标、模式切换、原始宽高消息、宿主缩放及内层 iframe 身份保持。
- 实际测试实例返回的三个文件与正式项目逐字节一致：

```text
widget-host.js  560b3f9cecedb2ac0da3d2686154a98bc1eadabb6955daf427c8638c257949da
app.js          edf9faee16e9d1c028063335e5f95cd9dcd7b862e3bec1d18ab5ba182c959497
style.css       3cbe35dc5b3713940ce7f8d027c04ada7ae4f1b18574e8fd247b33ce7ac00a83
```

可复用样例在 `test/fixtures/widget-presentation.cjs`。生成该画布的测试快照时，应把场景对象的 contentW/contentH 一并传给 snapshot，不能只传 html。

## 交付状态

正式 071 分支为 main（已有 4 个本地领先提交），本次修复未提交或推送；保留原有工作区改动，并通过官方生成器更新 public/app.js。Cloud 分支为 codex/cloud-prod-20260920-legacy-compat（已有 8 个本地领先提交），本次未修改 Cloud 源码、运行同步或部署。

已只读确认 UAT 应用实际挂载 Cloud 的 `.local-uat-runtime/public` 到 `/uat/public`。Cloud 镜像及 UAT 运行文件 widget-host.js 仍为 `8d4f41138c05627ea3a311f07fc30bc1647acd7377e283fa777555757559b054`，尚未包含本次修复。线上验证须在获准按官方流程同步和部署后另行完成。

临时验收进程已关闭，并确认 51267 端口无监听；本次测试标签已关闭，临时浏览器视口设置已恢复。用户明确批准后，固定布局须保留与笔迹相对位置的要求已加入个人 PenEcho skill 的现有 Widget 规则。
