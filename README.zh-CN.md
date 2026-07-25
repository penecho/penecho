<h1 align="center">
  <img src="public/penecho-readme-header.png" alt="PenEcho" width="760">
</h1>

<p align="center">
  <a href="README.md">English</a> |
  <strong>简体中文</strong> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.pt-BR.md">Português (Brasil)</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.de.md">Deutsch</a>
</p>

<p align="center"><strong>跳出聊天框，与 AI 一起思考。</strong></p>

<p align="center">PenEcho 是一块共享画布，让手写内容、公式、图表和空间关系都成为对话的一部分。</p>

<p align="center">
  <a href="https://discord.gg/3jrPJ3mXdX"><img src="https://img.shields.io/badge/Discord-加入社区-5865F2?style=for-the-badge&amp;logo=discord&amp;logoColor=white" alt="加入 PenEcho Discord"></a>
  <a href="https://github.com/penecho/penecho/stargazers"><img src="https://img.shields.io/github/stars/penecho/penecho?style=for-the-badge&amp;logo=github&amp;logoColor=white&amp;color=f5b301" alt="在 GitHub 上为 PenEcho 点亮 Star"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL%20v3-blue?style=for-the-badge" alt="许可证：AGPL v3"></a>
</p>

> 本译文提供项目概览。最新、最完整的技术信息以[英文 README](README.md) 为准。

<p align="center"><img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins_sub_x10.webp" alt="PenEcho 插件演示" width="100%"></p>

<p align="center"><img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_full_demo.webp" alt="PenEcho 完整演示" width="100%"></p>

## Kimi 开源伙伴

PenEcho 是 **Kimi Open Source Friends** 的正式成员。该计划由 [Moonshot AI](https://www.kimi.com/) 发起，用于支持优秀的开源项目。Kimi 团队通过 API 额度支持 PenEcho 的开发；Kimi K3 也是处理手写内容、图表等复杂画布任务时的推荐模型之一。

- [Kimi Code](https://www.kimi.com/code?aff=penecho) - 面向全球用户的编程订阅服务
- [Kimi 开放平台（中国）](https://platform.kimi.com?aff=penecho) - 中国大陆 API 服务
- [Kimi 开放平台（全球）](https://platform.kimi.ai?aff=penecho) - 其他地区 API 服务

## 快速开始

你需要安装 [Node.js 18.17 或更高版本](https://nodejs.org/)，并准备以下任意一种方式：API Key、已登录的 [Codex CLI](https://developers.openai.com/codex/cli)，或已登录的 [Claude Code CLI](https://code.claude.com/docs/en/overview)。

```bash
npm install -g penecho
penecho configure
penecho
```

在浏览器中打开 [http://localhost:3888](http://localhost:3888)。通过 `penecho configure` 可以交互式设置 LLM 来源、模型、推理等级、超时时间、图片格式和监听地址。配置默认保存在 `~/.penecho/config.env`，API 凭据不会发送到浏览器。

从源码运行：

```bash
git clone https://github.com/penecho/penecho.git
cd penecho
npm install
npm start
```

## 在画布上思考

在画布任意位置写下问题、公式、图表或尚未成形的想法，然后稍作停顿。PenEcho 会理解笔迹及其空间关系，并把回答直接放在相关内容旁边。

- 使用手写笔或鼠标自然书写，在 `20,000 x 20,000` 的大画布上平移和缩放。
- 直接在画布上获得答案、提示、解释、公式、函数图像和图表。
- 移动或缩放 AI 草稿，并在它们成为正式内容前逐项接受或丢弃。
- 用套索选择笔迹，进行移动、缩放、改色、删除，或通过 Typeset 将内容规范排版。
- 在浏览器中保存本地快照，并将确认后的画布内容导出为 PNG。
- 可选择 Arcane、Sci-fi、Research 或 Studio 主题。

## 0.7.1 新功能

- **画布上的图片与照片。** 通过系统选择器添加图片——手机和平板上可调起相册或拍照，桌面上选择图片文件；过大的图片会自动降采样压缩，画布和快照保持轻巧。
- **长按编辑，操作清晰。** 长按图片即可再次移动或缩放，并可选择“放置”“融合”或“删除”。“放置”让图片衬在墨迹下层，可以直接在上面书写；“融合”把图片变成真正的笔触，可以用橡皮擦。
- **不会意外发起 AI 请求。** 图片本身不会发起 AI 请求；如果在 AI 处理期间操作图片，进行中的结果会被丢弃，手写识别随后会自动恢复。图片支持撤销重做、本地快照和 PNG 导出。

## 0.7.0 新功能

- **画布上的交互式 HTML。** General HTML 插件可以生成时钟、计算器、仪表盘等界面，并以隔离的交互式组件直接呈现在画布上。
- **无需 PenEcho 数据服务即可获取实用数据。** 天气、股票、科技新闻、汇率、地震、自然事件、太空天气和 GitHub 插件会由浏览器直接访问各自声明的 API。
- **明确的安全边界。** 每个插件只能连接允许列表中的来源，HTML 在隔离的 iframe 中运行；停用的插件不会参与 AI 请求或运行时处理。
- **创建本地插件。** 使用紧凑的 Markdown 格式定义能力，并可在预览版创建器中通过 AI 改进草稿、自动补全标题、保存启用或删除个人插件。
- **画布原生的持久化与导出。** 确认后的组件可保存到本地快照并导出为 PNG，同时支持移动、重排、整体缩放和可撤销删除。
- **合理的默认配置。** 新用户默认启用 General HTML、Animation scenes 和 Weather，其他数据插件需要手动选择启用。

## 历史版本

- **0.6.0 - Animation scenes。** 增加安全的声明式 Canvas2D 动画、画布编辑和快照持久化，并改进 Markdown/LaTeX 渲染、模型输出可靠性和非阻塞式 npm 更新检查。

## 工作原理

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/how-it-works-dark.svg"><img alt="PenEcho 工作原理" src="docs/assets/how-it-works-light.svg"></picture></p>

浏览器只会发送与当前任务相关的画布区域及其几何信息。服务器验证请求并交给选定的执行器，然后返回可移动的结构化草稿。当前模型推荐和费用示例请参阅[英文 README](README.md#recommended-model-configurations)。

## 安全部署

- **Codex CLI 和 Claude CLI：** 仅应在本机或可信局域网内使用。有效请求会启动本地 CLI 进程，因此不要将这两种模式直接暴露在公网中。
- **API 模式：** 如需提供公网访问，请将 PenEcho 部署在具备 HTTPS、身份验证、频率限制和请求大小限制的反向代理之后。
- 不要公开配置文件、API Key、请求记录、日志或包含隐私内容的画布图片。

## 参与开发

提交改动前请运行：

```bash
npm run check
```

实现细节请参阅[架构说明](docs/architecture.md)，贡献流程请参阅 [CONTRIBUTING.md](CONTRIBUTING.md)。问题和使用案例可以发布到 [Discord](https://discord.gg/3jrPJ3mXdX) 或 [GitHub Discussions](https://github.com/penecho/penecho/discussions)，可复现的问题请提交到 [GitHub Issues](https://github.com/penecho/penecho/issues)。

## 许可证与商业使用

PenEcho 采用 [GNU AGPL v3.0 only](LICENSE) 开源许可证，允许商业使用。如果你修改 PenEcho 并通过网络向用户提供该版本，则必须按照 AGPL 的要求向这些用户提供对应的源代码。无法满足 AGPL 要求的专有产品或托管服务可以选择单独的[商业许可证](COMMERCIAL-LICENSE.md)。PenEcho 的名称和标志另受[商标政策](TRADEMARKS.md)约束。
