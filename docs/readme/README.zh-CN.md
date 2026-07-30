<h1 align="center">
  <img src="../../public/penecho-readme-header.png" alt="PenEcho" width="760">
</h1>

<p align="center">
  <a href="../../README.md">English</a> |
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
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/License-AGPL%20v3-blue?style=for-the-badge" alt="许可证：AGPL v3"></a>
</p>

> 本译文提供项目概览。最新、最完整的技术信息以[英文 README](../../README.md) 为准。

<p align="center"><img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins.webp" alt="PenEcho 专业图示演示" width="49%"> <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_full_demo.webp" alt="PenEcho 完整演示" width="49%"></p>

<p align="center"><img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins_sub_x10.webp" alt="PenEcho 插件演示" width="49%"> <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/play_patris.webp" alt="PenEcho 交互画布演示" width="49%"></p>

## Kimi 开源伙伴

PenEcho 是 **Kimi Open Source Friends** 的正式成员。该计划由 [Moonshot AI](https://www.kimi.com/) 发起，用于支持优秀的开源项目。Kimi 团队通过 API 额度支持 PenEcho 的开发；Kimi K3 也是处理手写内容、图表等复杂画布任务时的推荐模型之一。

- [Kimi Code](https://www.kimi.com/code?aff=penecho) - 面向全球用户的编程订阅服务
- [Kimi 开放平台（中国）](https://platform.kimi.com?aff=penecho) - 中国大陆 API 服务
- [Kimi 开放平台（全球）](https://platform.kimi.ai?aff=penecho) - 其他地区 API 服务

## 快速开始

### 桌面应用

[前往 GitHub Releases 下载](https://github.com/penecho/penecho/releases/latest)。

通过 npm 安装时，你需要 [Node.js 20.3 或更高版本](https://nodejs.org/)，并准备以下任意一种方式：API Key、已登录的 [Codex CLI](https://developers.openai.com/codex/cli)，或已登录的 [Claude Code CLI](https://code.claude.com/docs/en/overview)。

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
- 将快照保存到当前设备或 PenEcho 服务器，并将确认后的画布内容导出为 PNG。
- 可选择 Arcane、Sci-fi、Research 或 Studio 主题。

## 0.8.0 新功能

- **不止流程图的专业图示。** 可生成架构、UML、时序、BPMN、数据、工程、科学、医学、金融、地理等专业图示，并保留可编辑的专业源码。已支持的格式按需本地渲染；更专门的格式可继续用完整 HTML 展示。
- **默认开启，同时缩小 Prompt 开销。** **专业图示**默认可用，也可在 **Plugins** 中关闭。只向模型发送精简的能力说明；完整 CSS 与渲染依赖保留在本地并按需加载。
- **直接在插件控件上画出修改要求。** 用画笔在插件返回的控件上画出或写明需要修改的地方，然后点击出现的 **AI 完善（Refine）** 按钮，即可生成升级后的替换版本。此功能仅适用于插件返回的控件。
- **本机或 PenEcho 服务器存储。** 画布可仅保存在当前浏览器，也可保存到运行 PenEcho 的电脑，让使用同一服务且通过验证的其他设备打开。保存前会自动确认未完成控件，确保 Textbox、图示和 Widget 被写入快照。
- **剪贴板、文字与可扩展插件。** 可从系统剪贴板直接加入文字或图片，复制 AI 返回的文字、公式和专业图示源码，并用 Hand 重新选择和编辑 Textbox。内置或私有插件也可复制为自定义插件，并配置仅在使用时加载的 CSS。

## 0.7.2 新功能

- **内置真实照片与专业流程图。** “显示网络真实照片”会把带来源的网络图片直接显示在画布上，默认返回一张，主图片失败时可切换备用来源；“专业流程图”支持流程、决策、架构、时序和状态图，并可复制通用 Mermaid 源码。
- **更可靠的画布编辑、保存与导出。** 小手可以直接移动图片、动画和 AI 返回的控件，图片与控件不再有额外的最大缩放限制。载入画布后，“保存”默认更新当前记录，同时仍可“另存为新画布”；缩略图和 PNG 导出也会保留网络图片。
- **本地访问与桌面集成。** 可用实例共用的 6 位安全码保护本机和局域网浏览器入口，解锁后不改变模型请求流程。桌面设置同时支持 Kimi API、Kimi CLI、通用 API、Codex CLI 和 Claude CLI，并改进自动更新与多平台打包。

## 历史版本

- **0.7.1。** 新增本地图片与照片、Hand 对象编辑、快照和 PNG 导出、可复制 Mermaid 流程图及带来源的网络图片。
- **0.7.0。** 引入隔离的交互式 HTML、实时数据插件、本地插件创建和 Widget 持久化。
- **0.6.0 及更早。** 新增声明式动画、Markdown/LaTeX 改进、选择工具与稀疏大画布基础。

## 工作原理

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="../assets/how-it-works-dark.svg"><img alt="PenEcho 工作原理" src="../assets/how-it-works-light.svg"></picture></p>

浏览器只会发送与当前任务相关的画布区域及其几何信息。服务器验证请求并交给选定的执行器，然后返回可移动的结构化草稿。当前模型推荐和费用示例请参阅[英文 README](../../README.md#recommended-model-configurations)。

## 安全部署

- PenEcho 每次启动时，首个浏览器必须设置一个实例共用的 6 位安全码，或明确确认风险后保持局域网开放。安全码只以加盐哈希保存在进程内存中，重启即清除，不影响画布文件和设置；连续输错会触发频率限制。它适合可信局域网的日常防护，不能替代公网级身份验证。
- **Kimi CLI、Codex CLI 和 Claude CLI：** 仅应在本机或可信局域网内使用。有效请求会启动本地 CLI 进程，因此不要将这些模式直接暴露在公网中。
- **API 模式：** 选择 6 位安全码后，浏览器访问和 AI 请求都需要先解锁；如果操作者明确选择不设置安全码，则会保留原先不限制远程 API 请求的行为。如需提供公网访问，请将 PenEcho 部署在具备 HTTPS、更强身份验证、频率限制和请求大小限制的反向代理之后。
- 不要公开配置文件、API Key、请求记录、日志或包含隐私内容的画布图片。

## 参与开发

提交改动前请运行：

```bash
npm run check
```

实现细节请参阅[架构说明](../architecture.md)，贡献流程请参阅 [CONTRIBUTING.md](../../CONTRIBUTING.md)。问题和使用案例可以发布到 [Discord](https://discord.gg/3jrPJ3mXdX) 或 [GitHub Discussions](https://github.com/penecho/penecho/discussions)，可复现的问题请提交到 [GitHub Issues](https://github.com/penecho/penecho/issues)。

## 许可证与商业使用

PenEcho 采用 [GNU AGPL v3.0 only](../../LICENSE) 开源许可证，允许商业使用。如果你修改 PenEcho 并通过网络向用户提供该版本，则必须按照 AGPL 的要求向这些用户提供对应的源代码。无法满足 AGPL 要求的专有产品或托管服务可以选择单独的[商业许可证](../../COMMERCIAL-LICENSE.md)。PenEcho 的名称和标志另受[商标政策](../../TRADEMARKS.md)约束。
