# PenEcho 标识替换与残留清单

核查日期：2026-09-15。修改范围为当前 071 正式源码目录中的 README、Windows/macOS 应用图标、Windows 安装动画，以及桌面更新窗口。用户随后确认追加 Canvas 页签和 Cloud 网站/下载页/Admin 的 favicon 与应用图标；其余位置及字体拼出的文字标保持原样。最终素材采用用户最后提供的透明 PNG（1441 × 1092，右上角为黑色圆点）；原生透明度、渐变和边缘直接保留，未进行去白底或重新绘制。

## 本次替换

| 位置 | 素材及行为 |
| --- | --- |
| 主 README 与 8 个译本 | `public/penecho-readme-header.webp`，完整图形和 PenEcho 字样；透明、无损 WebP，浅/深色页面自动适配；显示宽度从 760 px 改为 280 px |
| Windows EXE、任务栏和 Setup 图标 | `build/icons/penecho.ico`、`build/icons/penecho.png`；只有渐变图形；透明底 |
| macOS 应用、Dock 和 DMG 图标 | `build/icons/penecho.icns`；只有渐变图形；保留现有白色圆角底板 |
| Windows 安装/更新动画 | `build/icons/penecho-install.gif`；完整标识和加载点 |
| 桌面更新窗口 | `desktop/update-window.html`；页头采用完整标识 |
| Canvas 浏览器页签 | 071 `public/penecho-favicon.png`；Cloud 通过官方 Canvas 同步获取同名文件，页签独立引用新素材，白色圆角底板、外角透明 |
| 局域网访问/密码解锁页 | 用户随后补充要求替换；`public/access.html` 的页头图标与 favicon 均引用新版 `penecho-favicon.png`；页头按 30 px 显示素材自带的白色圆角底板 |
| Cloud 网站、下载页、Admin | `public/media/brand-app-icon.png`；14 个页面中的 favicon 和应用图标引用新素材，白色圆角底板、外角透明；下载页去除原有灰绿滤镜和混合效果，保留原图颜色 |
| Cloud 默认 favicon 入口 | `src/routes/public-message.mjs` 中 `/favicon.ico` 重定向到 `/media/brand-app-icon.png`；复查发现该兜底入口仍指向旧图后，已补齐 |

原附件、透明母版和裁切范围保留在 `build/brand/`；`scripts/prepare-brand-logo.js` 校验透明 PNG 并逐字节复制为母版，直接保留用户提供的透明通道与边缘；执行 `npm run icons` 可重新生成本次全部派生素材，不依赖会话临时文件或构建主机字体。

## 用户明确保留

| 范围 | 已核实位置 | 保留内容 |
| --- | --- | --- |
| 公开分享查看页 | 071 `public/viewer.js:69`、Cloud 同名镜像 | 顶部品牌仍为旧图形加文字；按用户要求保留 |
| 移动端 | `tools/mobile/build-mobile.js:13`、`tools/mobile/web/index.html:13` | Android/iOS 图标、原生启动图和移动连接页由 `build/icons/penecho-1024.png` 生成，仍是旧图形；本次保留该源图，桌面生成器改为独立输出，避免下次移动构建被连带改变 |
| Cloud 网站文字标 | 首页、登录、下载、Echoes、联系、赞助、条款、隐私和 404 页中的 `Pen<strong>Echo</strong>`；公共生成入口为 `public/js/site-header.js` | 当前是网页字体的旧文字处理，没有采用附件字形；按用户要求保留字体拼出的文字标 |
| Cloud 客户端活动图片响应 | `src/routes/client-activity.mjs:12` | 返回 `public/media/brand-icon.png`；保留旧图与接口行为，新页面图标使用独立文件 |
| 旧静态素材 | 071 `public/penecho-readme-header.png`；Cloud `public/media/brand-logo.png` | 旧文件仍保留，前者已经退出 README 与 npm 清单；按用户要求保留旧文件 |

以上 Cloud 路径均相对 `/Users/heack/workspace/penecho_cloud`；Canvas 的 `index.html` 和新增 `penecho-favicon.png` 通过官方 `tools/sync-public-canvas.mjs --only=index.html,penecho-favicon.png` 从 071 同步。Cloud 网站图标从同步后的 `public/canvas/penecho-favicon.png` 复制为 `public/media/brand-app-icon.png`；旧的 `brand-icon.png` 和 `penecho-mark.png` 均保留。

## 边界

- 仓库之外的 GitHub 组织头像、社交账号、线上旧安装包及历史演示截图/视频，没有通过本次本地引用扫描验证，不能列为已确认完成的替换。
- 旧的安装包和已安装应用不会随源码修改自动变更；需要重新打包并安装，才能在系统 Dock/任务栏中看到新图标。
- 本次仅修改本地正式项目，不代表已提交、推送、发布、安装或启动完整 PenEcho 应用。

## 背景选择与验证

- README：保持透明；深色页面使用相同字形/轮廓的浅色文字与圆点版本，避免黑色文字消失。
- Windows：ICO 和窗口图标使用透明底，符合 [Microsoft 的透明图标建议](https://learn.microsoft.com/en-us/windows/apps/design/style/iconography/app-icon-construction)。已生成多个尺寸供 Win32 任务栏与桌面缩放使用。
- macOS：当前 Electron 使用经典 ICNS 交付，保留平台圆角方形视觉，使用白色底板和透明外角；没有把当前项目改造为 Apple Icon Composer 分层图标管线。[Apple 图标规范](https://developer.apple.com/design/human-interface-guidelines/app-icons)提供平台形状与居中内容原则，白色底板为针对本 Logo 的设计选择。
- 浏览器页签与 Cloud 应用图标：白色圆角底板维持小尺寸图形/黑色圆点在浅深色背景上的可见性，外角透明。
- 安装动画、更新窗口：在白色窗口上显示完整 Logo，不把桌面壁纸透进加载状态。

浏览器实际渲染预览位于 `docs/design-previews/brand-20260915/`。其中启动页为历史预览，独立启动窗口已按用户要求移除，应用直接进入 Canvas。中英文更新页已检查最小窗口；这不等同于已安装 macOS/Windows 包的系统 Dock/任务栏验收。

最新版透明素材验证：071 桌面打包相关测试 32/32 通过，Cloud 镜像与静态服务相关测试 29/29 通过；官方 Canvas 全量同步检查通过。透明母版与最后附件逐字节一致，Cloud 两处图标与 071 favicon 一致，当时 13 个保留文件与 HEAD 一致（密码页随后追加替换，默认 favicon 入口随后补齐；其余保留位置保持原样）。预览已重新生成，检查了浅深色背景、宽窄视口以及中英文更新窗口，图像均正常加载且无页面横向溢出；两个正式仓库的 `git diff --check` 均通过。

密码页追加替换验证：页头与 favicon 共用 `public/penecho-favicon.png`，保持 PenEcho / Local Canvas 字体文字；去除页头重复底板并以 30 px 显示图标。现有访问页测试 3/3 通过，中英文、1000 px / 400 px 视口及 200% CSS 缩放预览通过。已只读核实本机 3921 开发服务从 071 源码返回新版引用；3888 已安装 PenEcho 仍返回旧素材引用，需要重新打包安装后更新。

旧图引用复查：仍用于本地/Cloud 分享查看页、移动连接页及移动端原生图标/启动图；Cloud `/a/p.png` 活动上报接口也返回旧图，但客户端以隐藏的 1 × 1 图片加载，不作为可见品牌展示。旧 `public/penecho-readme-header.png` 和 Cloud `public/media/brand-logo.png` 未发现当前页面运行引用；Cloud `tools/make_brand_assets.py` 仍定义旧素材输出，本次未执行。默认 `/favicon.ico` 的旧重定向已修正，并通过应用内请求验证 302 → 新图路径 → 200 和响应字节一致；Cloud 静态服务相关测试 20/20 通过，未部署。
