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

<h2 align="center">
  <a href="https://penecho.ai">官方网站 · penecho.ai</a>
</h2>

<h3 align="center"><a href="https://penecho.ai">发布想法 · 协作共创 · 分享作品</a></h3>

<p align="center">
  <a href="https://discord.gg/3jrPJ3mXdX"><img src="https://img.shields.io/badge/Discord-加入社区-5865F2?style=for-the-badge&amp;logo=discord&amp;logoColor=white" alt="加入 PenEcho Discord"></a>
  <a href="https://github.com/penecho/penecho/stargazers"><img src="https://img.shields.io/github/stars/penecho/penecho?style=for-the-badge&amp;logo=github&amp;logoColor=white&amp;color=f5b301" alt="在 GitHub 上为 PenEcho 点亮 Star"></a>
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/License-AGPL%20v3-blue?style=for-the-badge" alt="许可证：AGPL v3"></a>
</p>

> 本译文提供项目概览。最新、最完整的技术信息以[英文 README](../../README.md) 为准。

<p align="center">
  <a href="https://penecho.ai">官网</a> &bull;
  <a href="#-功能特性">功能特性</a> &bull;
  <a href="#-快速开始">快速开始</a> &bull;
  <a href="#penecho-cloud">云端</a> &bull;
  <a href="#-常见问题">常见问题</a> &bull;
  <a href="https://discord.gg/3jrPJ3mXdX">Discord</a>
</p>

<p align="center"><img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins.webp" alt="PenEcho 专业图示演示" width="49%"> <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_full_demo.webp" alt="PenEcho 完整演示" width="49%"></p>

<p align="center"><img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins_sub_x10.webp" alt="PenEcho 插件演示" width="49%"> <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/play_patris.webp" alt="PenEcho 交互画布演示" width="49%"></p>

## Kimi 开源伙伴

<p align="center">
  <a href="https://www.kimi.com/code?aff=penecho">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="../assets/kimi-open-source-friends-dark.svg">
      <img alt="Kimi Open Source Friends" src="../assets/kimi-open-source-friends-light.svg">
    </picture>
  </a>
</p>

PenEcho 是 **Kimi Open Source Friends** 的正式成员。该计划由 [Moonshot AI](https://www.kimi.com/) 发起，用于支持优秀的开源项目。Kimi 团队通过 API 额度支持 PenEcho 的开发；Kimi K3 也是处理手写内容、图表等复杂画布任务时的推荐模型之一。

- [Kimi Code](https://www.kimi.com/code?aff=penecho) - 面向全球用户的编程订阅服务
- [Kimi 开放平台（中国）](https://platform.kimi.com?aff=penecho) - 中国大陆 API 服务
- [Kimi 开放平台（全球）](https://platform.kimi.ai?aff=penecho) - 其他地区 API 服务

## ✨ 功能特性

- **在空间中思考，而不是在聊天框里。** 在 `20,000 x 20,000` 的大画布任意位置写下问题、公式、图表或尚未成形的想法，PenEcho 会理解笔迹及其空间关系，并把回答放在相关内容旁边。
- **回答直接呈现在画布上。** 在工作位置直接获得提示、解释、公式、函数图像和图表；AI 草稿可移动、缩放、复制，并在成为正式内容前逐项接受或丢弃。
- **自然的输入方式。** 使用手写笔或鼠标书写；用套索选择已确认的笔迹进行移动、缩放、改色或删除，或只将选中部分交给 Typeset 排版。编辑自己的笔迹不会触发 AI 请求。
- **可编辑的 AI 控件。** 隔离的交互式 HTML、专业图示、动画和实时数据插件，支持基于 unified diff 的原地增量修改，无需重新生成整个控件。
- **多套 AI 连接。** 最多保存十套 API 或 CLI 连接并一键切换，内置可编辑的 Kimi 与 MiniMax 预设，连接同一主机的每个客户端都能独立选择当前连接。
- **项目与共享。** 在服务器上按项目管理画布，从其他授权设备打开，并将确认后的画布内容导出为 PNG。
- **PenEcho 云端。** 登录 [penecho.ai](https://penecho.ai) 即可在其他设备上继续私人项目、同步收藏、通过已连接设备远程访问本机，并在 Echoes 中分享公开作品 — API 凭据永远不会离开本机。
- **四种主题**：Arcane、Sci-fi、Research、Studio，匹配你在探索的问题类型。

## 🚀 快速开始

**桌面应用** — [前往 GitHub Releases 下载](https://github.com/penecho/penecho/releases/latest)。

**npm 安装** — 需要 [Node.js 20.3 或更高版本](https://nodejs.org/)，并准备以下任意一种：API Key、已登录的 [Kimi Code CLI](https://github.com/MoonshotAI/kimi-code)、已登录的 [Codex CLI](https://developers.openai.com/codex/cli)，或已登录的 [Claude Code CLI](https://code.claude.com/docs/en/overview)。

```bash
npm install -g penecho
penecho configure   # 选择 LLM 来源：API、Kimi、Codex 或 Claude CLI
penecho             # 然后打开 http://localhost:3888
```

**从源码运行**

```bash
git clone https://github.com/penecho/penecho.git
cd penecho
npm install
npm start
```

首次启动时，最先打开的浏览器会话必须设置一个共用的 6 位安全码，或明确确认将进程保持为局域网开放状态。配置保存在 `~/.penecho/config.env`，API 凭据不会发送到浏览器。CLI 模式要求对应的 CLI 已安装、登录并位于 `PATH` 中，详见[配置参考](../configuration.md)。

<a id="penecho-cloud"></a>
## ☁️ PenEcho 云端

[PenEcho 云端](https://penecho.ai) 是 1.0.0 推出的配套网站与账户体系，把你的设备和作品连接起来 — 它完全可选：不登录云端时，PenEcho 依然可以用你自己的 API 或 CLI 完整运行。

在官网上你可以：

- 用浏览器登录并管理云端账户、存储空间和额度
- 打开 **Echoes**，浏览社区分享的公开画布和组件
- 以只读网页视图打开任意公开作品，并把链接分享给任何人
- 管理项目的修订版本、回收站与恢复
- 在 **云端 → 设备** 中生成配对密钥，连接你的 PenEcho 主机

在应用中登录后，还可以：

- **云端项目。** 把私有的、带版本的画布保存到项目中，在任何已登录设备上继续。每次成功保存都会生成一个不可变的修订版本；画布在其他设备上更新时不会被静默覆盖 — 你可以选择读取最新版本或另存一份。
- **已连接设备（Linked device）。** 用云端 → 设备生成的一次性密钥配对这台主机后，你已登录的浏览器和应用就能通过云端中继从任何地方访问它。无需把主机暴露到公网即可远程访问画布；API 凭据仍然只保存在这台设备上。链接随时可以暂停、恢复或移除。
- **Echoes：共同创作与知识分享。** 在 12 个分类下浏览公开画布和组件，收藏到通过云端同步的个人收藏夹，并把社区组件直接加入自己的画布。你也可以为自己的画布选择分享分类并公开发布，让其他人学习、在其基础上 Echo — 作品谱系（Craft lineage）会在版本之间保留。

## 🔔 1.0.0 新功能

- **[PenEcho 云端](https://penecho.ai) 上线。** 用浏览器登录即可获得私人云端项目、同步收藏和远程访问 — API 密钥始终保存在本机。
- **云端项目。** 按项目组织的私有版本化画布，每次保存生成不可变修订，并安全处理来自其他设备的并发编辑。
- **已连接设备。** 用一次性密钥配对这台主机，已登录的浏览器和应用即可从任何地方访问；链接随时可暂停、恢复或移除。
- **Echoes 与公开作品。** 在 12 个分类下浏览、收藏和复用公开画布与组件，为自己的作品选择分享分类发布，并在只读网页视图中打开任意公开作品。
- **个人收藏夹。** 组件收藏升级为支持云端同步的个人收藏库 — 未登录时保存在本机，登录后自动合并到云端。

0.9.0 带来了多套 AI 连接与一键切换、按项目管理的共享画布、有明确目标的原地完善、基于 unified diff 的增量修改、SSE 流式请求以及清晰的请求进度与取消。完整历史请查看 [Releases](https://github.com/penecho/penecho/releases)。

## 📖 工作原理

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="../assets/how-it-works-dark.svg"><img alt="PenEcho 工作原理" src="../assets/how-it-works-light.svg"></picture></p>

浏览器只会发送与当前任务相关的画布区域及其几何信息。服务器验证请求并交给选定的执行器，然后返回可移动的草稿；草稿在接受之前始终与已确认笔迹分开。PenEcho 只在有笔迹的地方分配 `512 x 512` 分块，巨大的逻辑画布不会变成巨大的位图。当前模型推荐和费用示例请参阅[英文 README](../../README.md#recommended-model-configurations)。

## ⚙️ 配置

`penecho configure` 会打开交互式配置中心，涵盖 LLM 来源、模型、推理等级、超时、响应 token 上限、图片格式、请求记录和监听地址端口。最常用的设置（也可直接写在 `~/.penecho/config.env`）：

| 设置 | 用途 |
| --- | --- |
| `AI_PROVIDER` | 执行器：`api`、`kimi-cli`、`codex-cli` 或 `claude-cli` |
| `AI_API_URL` / `AI_API_KEY` / `AI_API_MODEL` | API 端点、凭据和模型（仅 API 模式） |
| `AI_EFFORT` | 保存的推理等级；画布工具栏的 `Reasoning` 菜单可按请求覆盖，不会改写连接配置 |
| `HOST` / `PORT` | 监听地址和端口，默认 `0.0.0.0:3888` |
| `AUTO_AI_DELAY_SECONDS` | 自动识别前的延迟，可在画布上调整 0–10 秒 |

单次启动可使用 `--config ./team.env` 指定其他配置文件，或用参数临时覆盖，如 `penecho --claude --model opus --effort max`。CLI 准备工作、推理等级映射、超时、请求追踪等完整说明见 [docs/configuration.md](../configuration.md)。

## 🔒 安全

- 每次启动必须设置共用的 6 位安全码（仅以加盐哈希保存在进程内存中，并有频率限制），或明确确认风险。它是可信局域网的日常防护，不能替代公网级身份验证。
- CLI 模式在有效请求时会启动本地 CLI 进程：请仅在本机或可信局域网内使用，不要直接暴露到公网。
- 如需公网访问，请将 PenEcho 部署在具备 HTTPS、更强身份验证、频率限制和请求大小限制的反向代理之后。
- 凭据只保存在 Node.js 进程和配置文件中，不会发送到浏览器代码。不要公开配置文件、日志、截图或包含隐私内容的请求记录。

## 🗺️ 路线图

- [x] 多套 AI 连接与一键切换（0.9.0）
- [x] 按项目管理的共享画布与版本化 Bundle（0.9.0）
- [ ] 更好的手写识别
- [ ] 更广的模型覆盖 — Google/Gemini 尚未测试，特别欢迎测试反馈
- [ ] 更自然的笔交互与更多画布视觉工具
- [ ] 更多 UI 语言 — 目前支持英文和中文

## ❓ 常见问题

**必须有 API Key 吗？**
不是。已登录的 [Kimi Code CLI](https://github.com/MoonshotAI/kimi-code)、[Codex CLI](https://developers.openai.com/codex/cli) 或 [Claude Code CLI](https://code.claude.com/docs/en/overview) 都可以 — PenEcho 在本地调用所选 CLI，该来源不需要 API Key。

**应该从哪个模型开始？**
[Kimi K3](https://platform.kimi.ai?aff=penecho)、Claude Opus 4.8 / 5.0 和 `gpt-5.6` 系列都是不错的起点，详见[英文 README 的模型推荐](../../README.md#recommended-model-configurations)。

**PenEcho 免费吗？**
应用本身采用 AGPL v3 开源、免费使用。模型用量由你的服务商计费，或包含在你登录的 Codex/Claude 订阅中。典型的低推理等级请求每次只要几美分。

**必须有云端账户吗？**
不是。PenEcho 用你自己的 API 或 CLI 就能完整运行。登录 [penecho.ai](https://penecho.ai) 是可选增强：跨设备的私人项目、同步收藏、通过已连接设备远程访问本机，以及在 Echoes 中公开发布作品。

**我的数据存在哪里？**
画布和设置保存在你的设备或你自己的 PenEcho 服务器上；密钥和设置保存在 `~/.penecho/config.env`，请求记录默认关闭。

**能在局域网内用平板访问吗？**
可以。启动时会打印本机的局域网地址，在其他设备上打开并输入同一个 6 位安全码即可。如果无法连接，请在主机防火墙中放行相应 TCP 端口。

## 🤝 参与贡献

PenEcho 还很年轻，最重要的问题 — 手写识别、画布视觉工具、更广的模型支持和自然的笔交互 — 仍然开放，而且不写代码也能帮忙：测试一个模型并报告执行器、模型 ID、推理等级、延迟和示例结果；分享一个效果好（或不好）的画布；或者报告任何粗糙的细节，再小也值得提。

提交 Pull Request 前请运行 `npm run check`。从 [CONTRIBUTING.md](../../CONTRIBUTING.md) 开始，也可以在 [Discord](https://discord.gg/3jrPJ3mXdX)、[GitHub Discussions](https://github.com/penecho/penecho/discussions) 和 [GitHub Issues](https://github.com/penecho/penecho/issues) 找到我们。

## 📄 许可证

PenEcho 采用 [GNU AGPL v3.0 only](../../LICENSE) 开源许可证，允许商业使用；如果你修改 PenEcho 并通过网络提供给用户，必须按 AGPL 要求提供对应源代码。无法满足 AGPL 要求的产品可选择单独的[商业许可证](../../COMMERCIAL-LICENSE.md)。名称与标志受[商标政策](../../TRADEMARKS.md)约束；贡献者保留其成果的所有权，见[贡献者协议](../../CONTRIBUTOR-LICENSE-AGREEMENT.md)。
