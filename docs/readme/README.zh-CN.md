<p align="center">
  <a href="https://penecho.ai/lines.html">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="../assets/penecho-lines-logo-dark.svg">
      <img src="../assets/penecho-lines-logo.svg" alt="PenEcho Lines" width="340">
    </picture>
  </a>
</p>

<h3 align="center">不是又一个 AI Agent，而是与你的 Agent 协作的更好方式。</h3>

<p align="center">
  把意思画出来，用一条线跟进每个任务，让一个 Agent 审阅另一个 Agent 的工作。<br>
  直接接入你正在用的 Agent。开源、在你的电脑上免费使用、无需账号。
</p>

<p align="center">
  <a href="https://penecho.ai">官网</a> &nbsp;·&nbsp;
  <a href="#install">下载</a> &nbsp;·&nbsp;
  <a href="https://penecho.ai/try.html">浏览器试用</a> &nbsp;·&nbsp;
  <a href="https://penecho.ai/leaderboard">Agent 排行榜</a> &nbsp;·&nbsp;
  <a href="https://discord.gg/3jrPJ3mXdX">Discord</a> &nbsp;·&nbsp;
  <a href="https://buymeacoffee.com/penecho">请我喝杯咖啡</a>
</p>

<p align="center">
  <sub>
    <a href="../../README.md">English</a> ·
    <strong>简体中文</strong> ·
    <a href="README.ja.md">日本語</a> ·
    <a href="README.ko.md">한국어</a> ·
    <a href="README.ru.md">Русский</a> ·
    <a href="README.es.md">Español</a> ·
    <a href="README.pt-BR.md">Português</a> ·
    <a href="README.fr.md">Français</a> ·
    <a href="README.de.md">Deutsch</a>
  </sub>
</p>

---

<a name="quick-start"></a>
<a name="install"></a>

## 安装

<a href="https://github.com/penecho/penecho/releases/latest"><img src="https://img.shields.io/badge/release-v1.5.0-2563eb" alt="Release v1.5.0"></a>
<img src="https://img.shields.io/badge/macOS%20·%20Windows%20·%20Linux-64748b" alt="macOS, Windows, Linux">
<a href="../../LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-64748b" alt="AGPL-3.0"></a>

| | |
| :--- | :--- |
| **桌面应用** | 前往 [penecho.ai](https://penecho.ai/downloads.html) 下载 macOS 或 Windows 版。 |
| **npm** | 运行 `npm install -g penecho`，再运行 `penecho`（需要 Node.js 22.19 或更高版本）。 |
| **浏览器** | 打开 [penecho.ai](https://penecho.ai)，无需安装。 |

设置一个访问码，打开项目文件夹，并在 **设置 → Agents** 中添加你的 Agent。可直接使用你已订阅的 Agent 套餐、你自己的 API key，或 PenEcho 模型。

1.5.0 新内容：Lines、一键审阅、带真实评分的 Orchestrator、可验证的 token 节省，以及实时画布共享。查看 [更新日志](../../CHANGELOG.md#150)。

### 从源码运行

需要 Git 和 Node.js 22.19 或更高版本。构建好的页面已包含在仓库中，无需构建步骤。

```bash
git clone https://github.com/penecho/penecho.git
cd penecho
npm install
npm start        # PenEcho 会在 http://localhost:3888 打开
```

如需从源码运行桌面应用，先运行一次 `npm run desktop:deps`，再运行 `npm run desktop`。运行 `npm run check` 可执行全部检查和测试。

---

## 3 分钟看懂

一个真实任务从头到尾：一个 Agent 编写，另一个审阅，修改意见原路发回，最后由你把关。

<p align="center">
  <a href="https://penecho.ai/lines.html#film">
    <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_lines.gif" alt="PenEcho Lines 演示：圈出截图、选择 Agent、一键审阅、发送修复、5/5 通过、Orchestrator 按真实记录挑选 Agent" width="100%">
  </a>
</p>
<p align="center"><a href="https://penecho.ai/lines.html#film">▶ 观看完整影片</a></p>

<p align="center">
  <img src="../assets/penecho-lines-architecture.svg" alt="任务如何交给 Agent：PenEcho 可直接发给单个 Agent，或由 Orchestrator 拆分为多部分交给多个 Agent。各 Agent 在项目文件夹中工作，并共同维护同一份 Markdown 记录：MEMORY.md、lines 和 works。" width="880">
</p>

既可以把任务直接交给单个 Agent，也可以交给 Orchestrator 拆分任务并为每一部分挑选合适的 Agent。所有 Agent 都在你的文件夹里工作，共用同一份纯 Markdown 记录。

---

## 核心特性

<table width="100%">
  <tr>
    <td width="50%" valign="top">
      <strong>多个 Agent 协作完成同一任务</strong><br>
      一个 Agent 实现，另一个一键审阅，点一下<em>发送修复</em>即可在同一条 Line 上把问题交回修改。
    </td>
    <td width="50%" valign="top">
      <strong>省 token，有据可查</strong><br>
      自动决定续接会话还是重新开始，哪种更省就用哪种，并展示每个任务省下的用量。
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>越用越懂的 Orchestrator</strong><br>
      拆分大任务，按真实战绩挑选 Agent，并为每次结果评分，让派单越来越准。
    </td>
    <td width="50%" valign="top">
      <strong>所有 Agent 会话同步</strong><br>
      Claude Code、Codex、Kimi、OpenCode 等会话自动同步进来，随时可换任意 Agent 接着做。
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>一屏总览上百个任务</strong><br>
      Ask、进行中、需要你、待审阅、已完成。一眼看清哪些正等着你处理。
    </td>
    <td width="50%" valign="top">
      <strong>把意思画出来</strong><br>
      圈出截图、画原型、做图表和幻灯片，Agent 会连同你的文字一起看到你的标注。
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>完全属于你的纯 Markdown</strong><br>
      每条 Line 都是文件夹里的一个 Markdown 文件，整个项目共用一份 <code>MEMORY.md</code>，随处可读。
    </td>
    <td width="50%" valign="top">
      <strong>一个链接即可分享</strong><br>
      通过链接分享整个项目或单张画布，队友在浏览器里就能直接审阅和画图标注。
    </td>
  </tr>
</table>

支持 Claude Code、Codex、OpenCode、Antigravity、Kimi、Pi、DeepSeek Harness、omp，以及 PenEcho 内置运行器。

---

## Canvas AI

写下想法、画个草图或随手圈一下，答案就会直接落在你落笔的地方。

<p align="center">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_full_demo.webp" alt="在 PenEcho 画布上手写解题、物理题、草图与走迷宫" width="720">
</p>
<p align="center"><sub><strong>边画边问</strong> — 手写内容、公式方程、草图与迷宫。</sub></p>

---

## Kimi Open Source Friends

<p align="center">
  <a href="https://www.kimi.com/code?aff=penecho">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="../assets/kimi-open-source-friends-dark.svg">
      <img src="../assets/kimi-open-source-friends-light.svg" alt="Kimi Open Source Friends" width="280">
    </picture>
  </a>
</p>

PenEcho 是 Kimi Open Source Friends 成员之一。Kimi Code 与其他 Agent 一样可在 PenEcho 中直接运行：在 **设置 → Agents** 中添加，或 [获取 Kimi Code](https://www.kimi.com/code?aff=penecho)。

---

<a name="support-penecho"></a>
<a name="buy-us-a-coffee"></a>

## 更多

- **社区：** [官网](https://penecho.ai) · [排行榜](https://penecho.ai/leaderboard) · [Discord](https://discord.gg/3jrPJ3mXdX) · [Discussions](https://github.com/penecho/penecho/discussions) · [Issues](https://github.com/penecho/penecho/issues) · [参与贡献](../../CONTRIBUTING.md)
- **支持我们：** 如果 PenEcho 帮你省下了一个下午，欢迎 [请我们喝杯咖啡](https://buymeacoffee.com/penecho) 或在 [GitHub Sponsors](https://github.com/sponsors/penecho) 赞助我们。点一颗星或提交一个清晰的 bug 报告也同样珍贵。
- **文档：** [架构说明](../architecture.md) · [Project Lines](../project-lines.md) · [MCP 配置](../mcp-setup.md) · [更新日志](../../CHANGELOG.md)
- **许可协议：** 采用 [AGPL-3.0-only](../../LICENSE) 许可，同时提供 [商业许可](../../COMMERCIAL-LICENSE.md)。详见 [商标政策](../../TRADEMARKS.md) 和 [贡献者协议](../../CONTRIBUTOR-LICENSE-AGREEMENT.md)。图表渲染器改编自 tt-a1i 的 [Archify](https://github.com/tt-a1i/archify)（MIT），详见 [NOTICE](../../NOTICE)。

<details>
<summary><strong>Star 趋势</strong></summary>
<br>
<p align="center">
  <a href="https://www.star-history.com/?repos=penecho%2Fpenecho&amp;type=date&amp;legend=top-left">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=penecho/penecho&amp;type=date&amp;theme=dark&amp;legend=top-left">
      <img src="https://api.star-history.com/chart?repos=penecho/penecho&amp;type=date&amp;legend=top-left" alt="PenEcho GitHub star history chart" width="760">
    </picture>
  </a>
</p>
</details>
