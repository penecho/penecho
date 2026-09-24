<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../public/penecho-readme-header-dark.webp">
    <img src="../../public/penecho-readme-header.webp" alt="PenEcho" width="280">
  </picture>
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

<h1 align="center">与 AI 一起思考的<br>空间工作台。</h1>
<p align="center">手写、探索、创作，让内置 Agent 或你自己的 MCP 助手加入同一块画布。</p>
<p align="center">
  <img src="https://img.shields.io/badge/version-1.3.4-087f83" alt="版本 1.3.4">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="AGPL-3.0-only"></a>
</p>
<p align="center">
  <a href="https://penecho.ai">官网</a> ·
  <a href="https://github.com/penecho/penecho/releases/latest">下载</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="../mcp-setup.md">MCP 指南</a> ·
  <a href="https://discord.gg/3jrPJ3mXdX">Discord</a>
</p>

<p align="center">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_full_demo.webp" alt="PenEcho 完整演示" width="49%">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins.webp" alt="PenEcho 专业图表演示" width="49%">
</p>

<p align="center">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins_sub_x10.webp" alt="PenEcho 插件演示" width="49%">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/play_patris.webp" alt="PenEcho 交互画布演示" width="49%">
</p>

<p align="center">
  <a href="https://www.kimi.com/code?aff=penecho">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="../assets/kimi-open-source-friends-dark.svg">
      <img src="../assets/kimi-open-source-friends-light.svg" alt="Kimi Open Source Friends" width="326" height="56">
    </picture>
  </a>
</p>

## 让 AI 对话在空间中展开

继续使用你熟悉的 **Codex、Claude、Kimi 或其他 AI Agent**，让 PenEcho 为对话中的成果提供一个工作空间。

通过 MCP，让 AI 把解释变成图解，把方案变成可操作的预览。资料、推理和作品并排展开；你在画布上的圈画、批注与反馈，可以被 AI 客户端读取，接着推进下一轮修改。

| 继续熟悉的对话 | 看见成果逐步成形 | 让反馈回到对话 |
| --- | --- | --- |
| 使用你已有的 AI Agent 讨论问题、推进任务。 | 通过 PenEcho MCP 服务，把图解、文档和交互预览放到画布上。 | 试用结果、圈画批注，让 Agent 读取反馈并继续修改。 |

<p align="center">
  <a href="../assets/mcp-spatial-example.webp">
    <img src="../assets/mcp-spatial-example.webp" alt="与 AI 讨论架构，在 PenEcho 画布上并排查看方案并用手写标注提出反馈" width="760">
  </a>
</p>
<p align="center"><em>在画布上讨论架构，并用手写标注提出反馈。</em></p>

<!-- professional-diagram-gallery -->
<p align="center">支持各种<strong>专业图表</strong>的绘制，方便查看和交互。</p>

<table width="100%">
  <tr>
    <th colspan="2" align="left">架构图</th>
  </tr>
  <tr>
    <td width="50%" align="center" valign="middle">
      <a href="../assets/professional-diagrams/kubernetes.webp"><img src="../assets/professional-diagrams/previews/kubernetes.webp" alt="Kubernetes 生产集群拓扑" width="100%"></a>
    </td>
    <td width="50%" align="center" valign="middle">
      <a href="../assets/professional-diagrams/migration.webp"><img src="../assets/professional-diagrams/previews/migration.webp" alt="单体到微服务迁移架构" width="100%"></a>
    </td>
  </tr>
  <tr>
    <td valign="top"><strong>Kubernetes 生产集群拓扑</strong></td>
    <td valign="top"><strong>单体到微服务迁移架构</strong></td>
  </tr>
  <tr>
    <th colspan="2" align="left">时序图</th>
  </tr>
  <tr>
    <td width="50%" align="center" valign="middle">
      <a href="../assets/professional-diagrams/notifications.webp"><img src="../assets/professional-diagrams/previews/notifications.webp" alt="事件驱动通知" width="100%"></a>
    </td>
    <td width="50%" align="center" valign="middle">
      <a href="../assets/professional-diagrams/mcp-request.webp"><img src="../assets/professional-diagrams/previews/mcp-request.webp" alt="MCP 请求如何到达画布" width="100%"></a>
    </td>
  </tr>
  <tr>
    <td valign="top"><strong>事件驱动通知</strong></td>
    <td valign="top"><strong>MCP 请求如何到达画布</strong></td>
  </tr>
  <tr>
    <th colspan="2" align="left">工作流</th>
  </tr>
  <tr>
    <td width="50%" align="center" valign="middle">
      <a href="../assets/professional-diagrams/release.webp"><img src="../assets/professional-diagrams/previews/release.webp" alt="发布准备：并行与汇合" width="100%"></a>
    </td>
    <td width="50%" align="center" valign="middle">
      <a href="../assets/professional-diagrams/rollout.webp"><img src="../assets/professional-diagrams/previews/rollout.webp" alt="多区域发布与回滚" width="100%"></a>
    </td>
  </tr>
  <tr>
    <td valign="top"><strong>发布准备：并行与汇合</strong></td>
    <td valign="top"><strong>多区域发布与回滚</strong></td>
  </tr>
</table>

<p align="center"><sub>点击图片查看完整大图。</sub></p>
<!-- /professional-diagram-gallery -->

**在完成之前，先看到它的样子。** 在与 AI 的交互中，看见项目逐步成形。先试一试，再给出反馈，一起把项目向前推进。

[通过 MCP 接入你的 Agent →](#通过-mcp-接入你的-agent)

## 你可以做什么

- **用画布思考。** 在同一空间组合手写内容、公式、文字、图片、图表和交互式 HTML Widget。
- **与 AI 创作。** 让内置 Agent 结合文件、网络研究和画布上下文，分析问题并生成可编辑的可视化结果。
- **接入自己的 Agent。** 通过 MCP，让 Codex、Claude Code 或其他兼容客户端读写你明确开放的 Canvas。
- **保存与分享。** 用项目组织画布，保存云端版本、同步收藏，通过 Echoes 发布作品。

## 1.3.3 新内容

| 图表类型 | 支持的画法 |
| --- | --- |
| **架构图** | 绘制服务、依赖关系与多层系统边界，自动布局并规划连线路径。 |
| **时序图** | 展示参与者与消息先后，支持返回、自调用，以及条件、循环和并行片段。 |
| **工作流** | 组织步骤、判断、带条件的分支与循环，通过分叉和汇合表达并行流程。 |

向 PenEcho Agent 或通过 MCP 接入的 Agent 描述需求，即可在画布中查看图表细节、反馈修改，并导出 SVG / PNG。

[完整更新记录](../../CHANGELOG.md#133)

## 工作原理

<p align="center">
  <img src="../../public/penecho-architecture.webp" alt="PenEcho 架构：浏览器连接 PenEcho Cloud 或本机；Cloud 提供云端模型并连接关联设备，本机运行 PenEcho CLI 或 App，使用自有 LLM API 或 Agent。外部 AI Agent 可通过 Cloud MCP 或 Local MCP 连接，两条 MCP 连接均为可选。" width="1483">
</p>

通过浏览器访问 PenEcho Cloud，或访问本机运行的 PenEcho CLI / 桌面应用。Cloud 提供云端模型，并可连接你的关联设备；本机可以使用自有模型 API 或 Agent。Codex、Claude 等外部 AI Agent 可通过 Cloud MCP 或 Local MCP 连接，两条 MCP 连接均为可选。

实现细节见[架构文档](../architecture.md)。

## 快速开始

**桌面应用：** 从 [GitHub Releases](https://github.com/penecho/penecho/releases/latest) 下载 Windows 或 macOS 版本。

**npm：** 需要 Node.js **22.19 或更新版本**。

```bash
npm install -g penecho
penecho
```

打开 `http://localhost:3888`。在**设置 → 连接**中添加自己的模型 API，或已安装并登录的 Codex、Claude Code、Kimi CLI。连接保存在 `~/.penecho/connections.json`，通用设置保存在 `~/.penecho/config.env`。使用 PenEcho 托管模型时，登录账号并在设置中选择可用模型。

启动时设置六位访问码，或明确选择在可信网络开放访问。终端也会显示供其他设备使用的局域网地址。

<details>
<summary>从源码运行</summary>

```bash
git clone https://github.com/penecho/penecho.git
cd penecho
npm install
npm start
```

</details>

## 通过 MCP 接入你的 Agent

使用 **Local MCP**：

1. 启动 PenEcho，在 **设置 → MCP 服务** 中开放当前 Canvas。
2. 在设置中配置受支持的本机客户端，或复制生成的启动配置。全局 npm 安装可在接受 `mcpServers` JSON 的客户端中使用：

   ```json
   {
     "mcpServers": {
       "penecho": { "command": "penecho", "args": ["mcp"] }
     }
   }
   ```

3. 告诉 Agent：**“把刚才讨论的架构展示到我的 PenEcho 画布上。”**

Agent 可以查看相关内容、编辑对象、创建可视化结果、修改文档源文件，并接收你的反馈。只有已开放且连接中的 Canvas 才会被发现。使用 Local MCP 时，MCP 客户端运行在 PenEcho 主机上；支持局域网和关联设备浏览器不会将本地 MCP 接口公开到互联网。Cloud MCP 则通过独立的、经过身份验证的 HTTPS 连接访问已启用的 PenEcho Cloud 画布。

桌面应用请使用设置生成的配置，其中包含正确的内置运行时。详见 [MCP 配置指南](../mcp-setup.md)和可选的 [Agent 工作流 skill](../../skills/penecho-mcp/SKILL.md)。

## PenEcho Cloud 与 AI 连接

[PenEcho Cloud](https://penecho.ai) 提供私有项目与版本保存、收藏同步、Echoes 公开分享，以及关联电脑的远程访问。

| 连接方式 | 使用方法 |
| --- | --- |
| **PenEcho 模型** | 登录账号，选择可用托管模型并使用积分；设置中展示当前费率和余额。 |
| **自己的模型 API** | 配置兼容 OpenAI 或 Anthropic 格式的服务地址、模型和 API Key，用量由对应服务商结算。 |
| **自己的 CLI** | 使用本机已安装并登录的 Codex、Claude Code 或 Kimi CLI，可用性与用量取决于对应服务商套餐。 |

在本机使用托管模型只需登录 Cloud，无需关联设备或另填 Credits API Key。Cloud MCP 可直接访问已启用的云端画布。通过 Cloud 访问电脑上托管的画布时，需要关联设备在线并具备相应中继支持。

自有 API 和 CLI 连接不消耗 PenEcho 积分。使用自己的连接在本地工作，无需 Cloud 账号。AI 功能需要访问所选服务；本地运行 PenEcho 不代表远程模型可以离线使用。

## 模型与效果

以下推荐基于 PenEcho 实际画布任务的实测，在回答质量与延迟之间取得平衡；实际响应时间会随服务商、画布复杂度和推理行为变化。

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

## 社区与许可

参与贡献请阅读 [CONTRIBUTING.md](../../CONTRIBUTING.md)，提交 PR 前运行 `npm run check`。欢迎在 [Issues](https://github.com/penecho/penecho/issues) 报告问题、在 [Discussions](https://github.com/penecho/penecho/discussions) 交流，或加入 [Discord](https://discord.gg/3jrPJ3mXdX)。

采用 [AGPL-3.0-only](../../LICENSE) 许可，同时提供[商业许可](../../COMMERCIAL-LICENSE.md)。另见[商标政策](../../TRADEMARKS.md)和[贡献者协议](../../CONTRIBUTOR-LICENSE-AGREEMENT.md)。

## 致谢

感谢 tt-a1i 的 [Archify](https://github.com/tt-a1i/archify) 项目。PenEcho 的专业图表渲染器使用了该项目经适配的 SVG 与几何辅助代码，并保留完整的 [MIT 许可及版权声明](../../src/architecture/vendor/archify/LICENSE)。第三方署名详见 [NOTICE](../../NOTICE)。

## Star 历史

<p align="center">
  <a href="https://www.star-history.com/?repos=penecho%2Fpenecho&amp;type=date&amp;legend=top-left">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=penecho/penecho&amp;type=date&amp;theme=dark&amp;legend=top-left">
      <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=penecho/penecho&amp;type=date&amp;legend=top-left">
      <img src="https://api.star-history.com/chart?repos=penecho/penecho&amp;type=date&amp;legend=top-left" alt="PenEcho GitHub Star 增长历史图" width="800">
    </picture>
  </a>
</p>
