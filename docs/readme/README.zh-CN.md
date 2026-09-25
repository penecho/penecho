<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../public/penecho-readme-header-dark.webp">
    <img src="../../public/penecho-readme-header.webp" alt="PenEcho" width="280">
  </picture>
</p>

<h1 align="center">在画布上思考，与任何 AI 协作。</h1>

<p align="center">随手画下想法。PenEcho 内置 Agent，或 Codex、Claude Code 及任何 MCP 客户端，都能在笔记旁生成图表、文档和可运行的组件。</p>

<p align="center">
  <a href="https://github.com/penecho/penecho/releases/latest"><img src="https://img.shields.io/badge/release-v1.3.4-087f83" alt="Release v1.3.4"></a>
  <a href="https://www.npmjs.com/package/penecho"><img src="https://img.shields.io/badge/npm-penecho-cb3837" alt="npm penecho"></a>
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="AGPL-3.0-only"></a>
  <a href="https://discord.gg/3jrPJ3mXdX"><img src="https://img.shields.io/badge/discord-join-5865f2" alt="Discord"></a>
  <a href="../mcp-setup.md"><img src="https://img.shields.io/badge/MCP-ready-6f42c1" alt="MCP"></a>
</p>

<p align="center">
  <a href="https://github.com/penecho/penecho/releases/latest"><img src="https://img.shields.io/badge/DOWNLOAD_FOR_MACOS-24292f?style=for-the-badge&amp;logo=apple&amp;logoColor=white" alt="macOS"></a>
  <a href="https://github.com/penecho/penecho/releases/latest"><img src="https://img.shields.io/badge/DOWNLOAD_FOR_WINDOWS-0969da?style=for-the-badge&amp;logo=windows&amp;logoColor=white" alt="Windows"></a>
  <a href="https://penecho.ai"><img src="https://img.shields.io/badge/OPEN_PENECHO.AI-087f83?style=for-the-badge&amp;logo=googlechrome&amp;logoColor=white" alt="penecho.ai"></a>
</p>

<p align="center">
  <a href="#quick-start">快速开始</a> ·
  <a href="#connect-your-ai-agent-mcp">连接你的 AI Agent（MCP）</a> ·
  <a href="../">文档</a> ·
  <a href="https://discord.gg/3jrPJ3mXdX">Discord</a>
</p>

<p align="center"><sub><a href="../../README.md">English</a> ·
  <strong>简体中文</strong> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a> ·
  <a href="README.ru.md">Русский</a> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.pt-BR.md">Português</a> ·
  <a href="README.fr.md">Français</a> ·
  <a href="README.de.md">Deutsch</a></sub></p>

<p align="center">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_full_demo.webp" alt="PenEcho" width="100%">
</p>
<p align="center"><em>从手绘草图到交互成果，都在同一块画布上。</em></p>

## 你可以做什么

<table width="100%">
  <tr>
    <td width="33%" valign="top">
      <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins_sub_x10.webp" alt="画下想法，再向 AI 提问" width="100%"><br>
      <strong>画下想法，再向 AI 提问</strong><br>
      在无限画布上写字、列公式、放置文字和图片。停笔后自动获得 AI 回应。
    </td>
    <td width="33%" valign="top">
      <a href="../assets/professional-diagrams/kubernetes.webp"><img src="../assets/professional-diagrams/previews/kubernetes.webp" alt="Kubernetes 集群" width="100%"></a><br>
      <strong>专业图表</strong><br>
      自动布局的架构图、时序图和工作流图，可导出 SVG 或 PNG。
    </td>
    <td width="33%" valign="top">
      <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/play_patris.webp" alt="可运行的组件" width="100%"><br>
      <strong>可运行的组件</strong><br>
      计算器、测验和原型可直接在画布上运行，也可收藏或分享。
    </td>
  </tr>
</table>

<a id="quick-start"></a>
## 快速开始

| | 开始使用 |
| --- | --- |
| **桌面应用** | 从 [GitHub Releases](https://github.com/penecho/penecho/releases/latest) 下载 macOS 或 Windows 版。功能齐全，并可自动更新。 |
| **npm** | 需要 Node.js 22.19+。运行 `npm i -g penecho`，再运行 `penecho` 并打开 `localhost:3888`。 |
| **浏览器** | 登录 [penecho.ai](https://penecho.ai)，使用托管模型和云端画布，无需安装。 |

```bash
npm install -g penecho
penecho             # http://localhost:3888
```

> [!TIP]
> 首次启动时设置六位访问码，或在可信网络上选择开放访问。在**设置 → AI 与连接**中添加模型：自己的 API Key、已登录的 Codex / Claude Code / Kimi CLI，或 PenEcho 模型。

<details>
<summary>从源码运行</summary>

```bash
git clone https://github.com/penecho/penecho.git
cd penecho
npm install
npm start
```

</details>

<a id="connect-your-ai-agent-mcp"></a>
## 连接你的 AI Agent（MCP）

继续在熟悉的 Agent 中对话。PenEcho 为成果提供画布：Agent 绘制内容，你批注反馈，它在下一轮读取批注。

1. 在 PenEcho 中打开**设置 → MCP 服务**，启用当前画布。
2. 为受支持的客户端使用**自动配置**，或把生成的配置提示复制到 Codex、Claude Code、Kimi、Cursor 等客户端。全局 npm 安装也可在接受 `mcpServers` JSON 的客户端中使用以下兼容配置：

   ```json
   {
     "mcpServers": {
       "penecho": { "command": "penecho", "args": ["mcp"] }
     }
   }
   ```

3. 试着说：*“把刚才讨论的架构展示到我的 PenEcho 画布上。”*

<p align="center"><a href="../assets/mcp-spatial-example.webp"><img src="../assets/mcp-spatial-example.webp" alt="与 AI 讨论架构，在 PenEcho 画布上并排查看方案并用手写标注提出反馈" width="760"></a></p>
<p align="center"><em>Claude Code 讨论的架构，可在画布上直接手写批注。</em></p>

> [!NOTE]
> Agent 只能看到你启用的画布。Local MCP 留在你的电脑上；Cloud MCP 是访问云端画布的独立登录连接。 [MCP 指南 →](../mcp-setup.md)

## 图表展示

<table width="100%">
  <tr>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/kubernetes.webp"><img src="../assets/professional-diagrams/previews/kubernetes.webp" alt="Kubernetes 集群" width="100%"></a><br><strong>Kubernetes 集群</strong></td>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/migration.webp"><img src="../assets/professional-diagrams/previews/migration.webp" alt="单体架构 → 微服务" width="100%"></a><br><strong>单体架构 → 微服务</strong></td>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/notifications.webp"><img src="../assets/professional-diagrams/previews/notifications.webp" alt="事件驱动通知" width="100%"></a><br><strong>事件驱动通知</strong></td>
  </tr>
  <tr>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/mcp-request.webp"><img src="../assets/professional-diagrams/previews/mcp-request.webp" alt="MCP 如何连接画布" width="100%"></a><br><strong>MCP 如何连接画布</strong></td>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/release.webp"><img src="../assets/professional-diagrams/previews/release.webp" alt="发布：并行任务" width="100%"></a><br><strong>发布：并行任务</strong></td>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/rollout.webp"><img src="../assets/professional-diagrams/previews/rollout.webp" alt="多区域发布" width="100%"></a><br><strong>多区域发布</strong></td>
  </tr>
</table>

<p align="center"><sub>点击任意图表查看完整大图。</sub></p>

## 工作原理

<p align="center"><img src="../../public/penecho-architecture.webp" alt="PenEcho 架构：浏览器连接 PenEcho Cloud 或本机；Cloud 提供云端模型并连接关联设备，本机运行 PenEcho CLI 或 App，使用自有 LLM API 或 Agent。外部 AI Agent 可通过 Cloud MCP 或 Local MCP 连接，两条 MCP 连接均为可选。" width="100%"></p>

- **在你的电脑上** — 桌面应用或 CLI 提供画布，并使用你自己的模型 API 或 Agent CLI。
- **在云端** — penecho.ai 提供托管模型、同步的项目和收藏，并可连接已关联的电脑。
- **你的 Agent** — 通过 Local 或 Cloud MCP 连接，两者均为可选。

详情: [架构文档](../architecture.md).

## 选择你的 AI

| 连接方式 | 费用 | 适合 |
| --- | --- | --- |
| **PenEcho 模型** — 登录并选择模型 | 账号积分 | 无需密钥，快速开始 |
| **自己的模型 API** — OpenAI / Anthropic | 由服务商收费 | 自主控制模型和费用 |
| **自己的 CLI** — Codex, Claude Code, Kimi | 现有套餐 | 复用已有订阅 |

如何选择模型与推理强度： [推荐模型](#recommended-models) (随每次发布更新).

<a name="recommended-models"></a>
<details>
<summary>推荐模型</summary>

以下推荐基于 PenEcho 画布任务的近期实测，兼顾回答质量和延迟；实际响应时间会随服务商、画布复杂度及推理行为而变化。

| 模型 | 推理强度 | 说明 | 推荐用途 |
| --- | --- | --- | --- |
| Claude Opus 4.8 / 5.0 (`claude-opus-4-8` / `claude-opus-5-0`) | `medium` | 质量强，延迟更均衡 | 日常画布任务 |
| Claude Opus 4.8 / 5.0 (`claude-opus-4-8` / `claude-opus-5-0`) | `high` | 推理质量更高，等待更长且波动更大 | 复杂手写、数学、图表或布局 |
| Fable 5 (`claude-fable-5` 或 `fable`) | `medium` | 响应时间通常约为 `gpt-5.6-sol` 在 `xhigh` 下的一半 | 快速、高质量的通用任务 |
| [Kimi K3](https://platform.kimi.ai?aff=penecho) (`kimi-k3`) | `medium` | 质量很好，`medium` 保持实用的平衡 | Kimi 推荐默认配置 |
| `gpt-5.6-terra` | `low` 至 `high` | 质量与响应速度表现出色 | 灵活兼顾质量与延迟 |
| `gpt-5.6-luna` | `xhigh` | 画布效果很好，速度快 | 质量优先，同时兼顾响应 |
| `gpt-5.6-sol` | `high` | 满足多数请求，比 `xhigh` 响应更快 | 重视响应速度时的默认配置 |
| `gpt-5.6-sol` | `xhigh` | 质量很好，但更慢且波动更大 | 高难度画布任务 |
| `deepseek-v4-flash-vision-exp` | `medium` | 良好 | 通过 DeepSeek API 完成视觉任务 |
| `glm-5.3-flash` | `medium` | 良好 | 通过 GLM Anthropic 兼容 API 快速完成任务 |

</details>

## 1.3.3 新内容

- **架构图、时序图和工作流图** 支持自动布局、连线路径规划，以及 SVG / PNG 导出。
- **画布库** 支持分页、搜索、项目筛选和排序。
- **更多 API 服务商预设** 自动获取模型列表。

[完整更新记录 →](../../CHANGELOG.md#133)

## 社区

| [Discord](https://discord.gg/3jrPJ3mXdX) | [Discussions](https://github.com/penecho/penecho/discussions) | [Issues](https://github.com/penecho/penecho/issues) | [Contributing](../../CONTRIBUTING.md) |
| --- | --- | --- | --- |
| 与团队交流 | 分享想法和问题 | 报告问题 | 先运行 `npm run check` |

项目采用 [AGPL-3.0-only](../../LICENSE) 许可；也提供[商业许可](../../COMMERCIAL-LICENSE.md)。另见[商标政策](../../TRADEMARKS.md)与[贡献者协议](../../CONTRIBUTOR-LICENSE-AGREEMENT.md)。

图表渲染器使用了 tt-a1i 的 [Archify](https://github.com/tt-a1i/archify) 中经适配的 SVG 和几何辅助代码（MIT）。详见 [NOTICE](../../NOTICE).

<p align="center">
  <a href="https://www.kimi.com/code?aff=penecho">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="../assets/kimi-open-source-friends-dark.svg">
      <img src="../assets/kimi-open-source-friends-light.svg" alt="Kimi Open Source Friends" width="326" height="56">
    </picture>
  </a>
</p>

<p align="center">
  <a href="https://www.star-history.com/?repos=penecho%2Fpenecho&amp;type=date&amp;legend=top-left">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=penecho/penecho&amp;type=date&amp;theme=dark&amp;legend=top-left">
      <img src="https://api.star-history.com/chart?repos=penecho/penecho&amp;type=date&amp;legend=top-left" alt="PenEcho GitHub stars" width="800">
    </picture>
  </a>
</p>
