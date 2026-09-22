# Live Clay Playground

入口 `/play/liveclay`（071 本地入口转到 `/?playground=liveclay`），普通画布 Agent 旁边的 Playground 按钮也可以打开。

源代码在 `src/playground/liveclay/`；`scripts/build-playground.cjs` 用项目自己的 Three.js 与 esbuild 打包为 `public/playground/liveclay-v1.js`。构建不读取 Demo 项目。客户端接入在 `src/client/app/playground.js`，Cloud 从本仓库官方同步公开资源和经审查的场景规划代码。

场景是普通 HTML Widget，`sourceFormat=penecho-liveclay+json`，`copyText` 保存版本为 1 的描述与场景 JSON。沿用画布历史、草稿、Cloud 保存和实时分享。入口只改变展示状态；响应式 iframe 大小不会修改原始画布几何。动态更新保留 iframe 实例，离屏和后台暂停渲染。画布工具按钮回到完整画布。

未登录用户在 Cloud 入口中使用 IndexedDB 草稿。保存/分享前等待最新生成完成，登录返回同一路径并恢复草稿及待执行动作。分享读者可查看并交互，复制后进入自己的画布。

生成只请求 Cloud `/api/playground/liveclay`；071 桌面通过已登录的 Cloud Connector 转发。Admin 管理 JEV endpoint、模型、加密凭据、连接健康与选择池，客户端没有凭据。当前只支持文字生成；手绘转 3D 尚未实现。

## 设计来源

沿用 `/Users/heack/workspace/penecho_design` 的 workbench 与 Agent 浮层模式，以及项目既有 `data-pe-button`、颜色和输入样式。依据用户确定的布局：左上品牌、右上保存与分享、中心 3D、底部可收起输入框；侧栏隐藏。保留键盘焦点、Escape 收起、状态播报及减少动画偏好。

## 验证

- `npm run build:client`
- `npm run check:playground`
- `node --test test/liveclay-world.test.mjs test/widget-import-viewport.test.js test/widget-public-fetch-routing.test.js`
- Cloud `tools/verify-playground.mjs` 验证游客、登录返回、保存、分享与手机视图（确定性场景，不调用外部模型）。
