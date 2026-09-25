<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../public/penecho-readme-header-dark.webp">
    <img src="../../public/penecho-readme-header.webp" alt="PenEcho" width="280">
  </picture>
</p>

<h1 align="center">どんな AI とも、キャンバスで考える。</h1>

<p align="center">手でスケッチ。PenEcho の内蔵 Agent や Codex、Claude Code、あらゆる MCP クライアントが、メモのそばに図、文書、動くウィジェットを作ります。</p>

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
  <a href="#quick-start">クイックスタート</a> ·
  <a href="#connect-your-ai-agent-mcp">AI エージェントを接続（MCP）</a> ·
  <a href="../">ドキュメント</a> ·
  <a href="https://discord.gg/3jrPJ3mXdX">Discord</a>
</p>

<p align="center"><sub><a href="../../README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <strong>日本語</strong> ·
  <a href="README.ko.md">한국어</a> ·
  <a href="README.ru.md">Русский</a> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.pt-BR.md">Português</a> ·
  <a href="README.fr.md">Français</a> ·
  <a href="README.de.md">Deutsch</a></sub></p>

<p align="center">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_full_demo.webp" alt="PenEcho" width="100%">
</p>
<p align="center"><em>手描きのスケッチからインタラクティブな成果まで、ひとつのキャンバスで。</em></p>

## できること

<table width="100%">
  <tr>
    <td width="33%" valign="top">
      <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins_sub_x10.webp" alt="描いてから質問" width="100%"><br>
      <strong>描いてから質問</strong><br>
      無限のキャンバスに手書き、数式、テキスト、画像を配置。手を止めると AI が自動で応答します。
    </td>
    <td width="33%" valign="top">
      <a href="../assets/professional-diagrams/kubernetes.webp"><img src="../assets/professional-diagrams/previews/kubernetes.webp" alt="Kubernetes クラスター" width="100%"></a><br>
      <strong>プロ向けの図</strong><br>
      自動レイアウトのアーキテクチャ図、シーケンス図、ワークフロー図。SVG または PNG で書き出せます。
    </td>
    <td width="33%" valign="top">
      <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/play_patris.webp" alt="動くウィジェット" width="100%"><br>
      <strong>動くウィジェット</strong><br>
      電卓、クイズ、プロトタイプをキャンバスで実行し、お気に入り登録や共有もできます。
    </td>
  </tr>
</table>

<a id="quick-start"></a>
## クイックスタート

| | 始め方 |
| --- | --- |
| **デスクトップアプリ** | macOS 版と Windows 版を [GitHub Releases](https://github.com/penecho/penecho/releases/latest) から入手。必要な機能が揃い、自動更新されます。 |
| **npm** | Node.js 22.19 以降が必要です。`npm i -g penecho`、続いて `penecho` を実行し、`localhost:3888` を開きます。 |
| **ブラウザー** | [penecho.ai](https://penecho.ai) にサインインして、ホストモデルとクラウドのキャンバスを使用。インストール不要です。 |

```bash
npm install -g penecho
penecho             # http://localhost:3888
```

> [!TIP]
> 初回起動時に 6 桁のアクセスコードを設定します。信頼できるネットワークではオープンアクセスも選べます。**設定 → AI と接続**で独自の API キー、サインイン済みの Codex / Claude Code / Kimi CLI、または PenEcho モデルを追加します。

<details>
<summary>ソースから実行</summary>

```bash
git clone https://github.com/penecho/penecho.git
cd penecho
npm install
npm start
```

</details>

<a id="connect-your-ai-agent-mcp"></a>
## AI エージェントを接続（MCP）

使い慣れたエージェントで会話を続けられます。エージェントがキャンバスに描き、あなたが注釈を付けると、次のターンでその内容を読み取ります。

1. PenEcho の**設定 → MCP サービス**を開き、現在のキャンバスを有効にします。
2. 対応クライアントには**自動設定**を使うか、生成された設定プロンプトを Codex、Claude Code、Kimi、Cursor などに貼り付けます。npm のグローバルインストールでは、`mcpServers` JSON に対応するクライアントに次の互換設定も使えます。

   ```json
   {
     "mcpServers": {
       "penecho": { "command": "penecho", "args": ["mcp"] }
     }
   }
   ```

3. *「話し合ったアーキテクチャを PenEcho のキャンバスに表示して」*と頼みます。

<p align="center"><a href="../assets/mcp-spatial-example.webp"><img src="../assets/mcp-spatial-example.webp" alt="AI とのアーキテクチャ検討。Canvas 上の設計案に手書きでフィードバックを追加。" width="760"></a></p>
<p align="center"><em>Claude Code とのアーキテクチャ検討に、キャンバス上で手書きの注釈を追加。</em></p>

> [!NOTE]
> エージェントに見えるのは有効化したキャンバスだけです。Local MCP はコンピューター内で動作し、Cloud MCP はクラウドのキャンバス用の独立した認証接続です。 [MCP ガイド →](../mcp-setup.md)

## 図のギャラリー

<table width="100%">
  <tr>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/kubernetes.webp"><img src="../assets/professional-diagrams/previews/kubernetes.webp" alt="Kubernetes クラスター" width="100%"></a><br><strong>Kubernetes クラスター</strong></td>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/migration.webp"><img src="../assets/professional-diagrams/previews/migration.webp" alt="モノリス → マイクロサービス" width="100%"></a><br><strong>モノリス → マイクロサービス</strong></td>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/notifications.webp"><img src="../assets/professional-diagrams/previews/notifications.webp" alt="イベント駆動の通知" width="100%"></a><br><strong>イベント駆動の通知</strong></td>
  </tr>
  <tr>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/mcp-request.webp"><img src="../assets/professional-diagrams/previews/mcp-request.webp" alt="MCP からキャンバスへの経路" width="100%"></a><br><strong>MCP からキャンバスへの経路</strong></td>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/release.webp"><img src="../assets/professional-diagrams/previews/release.webp" alt="リリース：並列タスク" width="100%"></a><br><strong>リリース：並列タスク</strong></td>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/rollout.webp"><img src="../assets/professional-diagrams/previews/rollout.webp" alt="複数リージョンへの展開" width="100%"></a><br><strong>複数リージョンへの展開</strong></td>
  </tr>
</table>

<p align="center"><sub>図をクリックするとフルサイズで表示します。</sub></p>

## 仕組み

<p align="center"><img src="../../public/penecho-architecture.webp" alt="PenEcho の構成：ブラウザーは PenEcho Cloud またはローカル PC に接続します。Cloud はホストモデルを提供し、リンク済みデバイスにも接続できます。PC は独自の LLM API やエージェントとともに PenEcho CLI またはアプリを実行します。外部 AI エージェントは Cloud MCP または Local MCP を任意で利用できます。" width="100%"></p>

- **コンピューター上** — デスクトップアプリまたは CLI がキャンバスを提供し、独自のモデル API や Agent CLI を使用します。
- **クラウド上** — penecho.ai にはホストモデル、同期するプロジェクトとお気に入りがあり、リンク済みコンピューターにも接続できます。
- **あなたのエージェント** — Local または Cloud MCP で接続します。どちらも任意です。

詳細: [アーキテクチャ資料](../architecture.md).

## AI の選び方

| 接続 | 費用 | 適した用途 |
| --- | --- | --- |
| **PenEcho モデル** — サインインして選択 | アカウントのクレジット | キーなしで始められる |
| **独自のモデル API** — OpenAI / Anthropic | プロバイダーの料金 | モデルと費用を自分で管理 |
| **独自の CLI** — Codex, Claude Code, Kimi | 契約中のプラン | 既存のサブスクリプションを活用 |

モデルと推論強度の選び方： [推奨モデル](#recommended-models) (リリースごとに更新).

<a name="recommended-models"></a>
<details>
<summary>推奨モデル</summary>

現在の実測を基に、PenEcho のキャンバス作業での回答品質と待ち時間のバランスを考慮しました。実際の応答時間はプロバイダー、キャンバスの複雑さ、推論動作によって変わります。

| モデル | 推論強度 | 備考 | 推奨用途 |
| --- | --- | --- | --- |
| Claude Opus 4.8 / 5.0 (`claude-opus-4-8` / `claude-opus-5-0`) | `medium` | 高い品質と待ち時間のバランス | 日常的なキャンバス作業 |
| Claude Opus 4.8 / 5.0 (`claude-opus-4-8` / `claude-opus-5-0`) | `high` | 推論品質が高く、待ち時間は長めで変動も大きい | 複雑な手書き、数学、図、レイアウト |
| Fable 5 (`claude-fable-5` または `fable`) | `medium` | 応答時間は `gpt-5.6-sol` の `xhigh` 設定の約半分になることが多い | 高速で高品質な汎用作業 |
| [Kimi K3](https://platform.kimi.ai?aff=penecho) (`kimi-k3`) | `medium` | 非常に良い品質。`medium` で実用的なバランスを維持 | Kimi の推奨デフォルト |
| `gpt-5.6-terra` | `low` ～ `high` | 予想以上に高性能で応答性も良い | 品質と待ち時間の柔軟な調整 |
| `gpt-5.6-luna` | `xhigh` | キャンバスで非常に良い成果と高い速度 | 品質を重視しつつ応答性も確保 |
| `gpt-5.6-sol` | `high` | 大半の依頼に十分な品質で、`xhigh` より応答性が高い | 応答性を重視する場合のデフォルト |
| `gpt-5.6-sol` | `xhigh` | 非常に良い品質だが、遅めで変動が大きい | 難しいキャンバス作業 |
| `deepseek-v4-flash-vision-exp` | `medium` | 良好 | DeepSeek API を使う視覚対応の作業 |
| `glm-5.3-flash` | `medium` | 良好 | GLM の Anthropic 互換 API を使う高速な作業 |

</details>

## 1.3.3 の新機能

- **アーキテクチャ図、シーケンス図、ワークフロー図** 自動レイアウト、接続線の経路設定、SVG / PNG 書き出しに対応。
- **キャンバスライブラリー** ページ分け、検索、プロジェクト別の絞り込み、並べ替えに対応。
- **モデル API のプリセットを追加** モデル一覧を自動取得します。

[変更履歴の全文 →](../../CHANGELOG.md#133)

## コミュニティー

| [Discord](https://discord.gg/3jrPJ3mXdX) | [Discussions](https://github.com/penecho/penecho/discussions) | [Issues](https://github.com/penecho/penecho/issues) | [Contributing](../../CONTRIBUTING.md) |
| --- | --- | --- | --- |
| チームと交流 | アイデアや質問 | バグを報告 | 先に実行： `npm run check` |

[AGPL-3.0-only](../../LICENSE) ライセンスで提供しています。[商用ライセンス](../../COMMERCIAL-LICENSE.md)も利用できます。[商標ポリシー](../../TRADEMARKS.md)と[貢献者契約](../../CONTRIBUTOR-LICENSE-AGREEMENT.md)もご覧ください。

図のレンダラーには、tt-a1i の [Archify](https://github.com/tt-a1i/archify) に由来する SVG・幾何処理の補助コードを適用しています（MIT）。詳細は [NOTICE](../../NOTICE).

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
