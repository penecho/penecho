<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../public/penecho-readme-header-dark.webp">
    <img src="../../public/penecho-readme-header.webp" alt="PenEcho" width="280">
  </picture>
</h1>

<p align="center">
  <a href="../../README.md">English</a> |
  <a href="README.zh-CN.md">简体中文</a> |
  <strong>日本語</strong> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.pt-BR.md">Português (Brasil)</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.de.md">Deutsch</a>
</p>

<h1 align="center">AI と考えるための<br>空間ワークスペース。</h1>
<p align="center">内蔵 Agent や MCP 対応の AI アシスタントで、描き、探究し、形にしましょう。</p>
<p align="center">
  <img src="https://img.shields.io/badge/version-1.3.4-087f83" alt="バージョン 1.3.4">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="AGPL-3.0-only"></a>
</p>
<p align="center">
  <a href="https://penecho.ai">ウェブサイト</a> ·
  <a href="https://github.com/penecho/penecho/releases/latest">ダウンロード</a> ·
  <a href="#quick-start">クイックスタート</a> ·
  <a href="../mcp-setup.md">MCP ガイド</a> ·
  <a href="https://discord.gg/3jrPJ3mXdX">Discord</a>
</p>

<p align="center">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_full_demo.webp" alt="PenEcho の全機能デモ" width="49%">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins.webp" alt="PenEcho の専門的な図のデモ" width="49%">
</p>

<p align="center">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins_sub_x10.webp" alt="PenEcho プラグインのデモ" width="49%">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/play_patris.webp" alt="PenEcho のインタラクティブなキャンバスのデモ" width="49%">
</p>

<p align="center">
  <a href="https://www.kimi.com/code?aff=penecho">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="../assets/kimi-open-source-friends-dark.svg">
      <img src="../assets/kimi-open-source-friends-light.svg" alt="Kimi Open Source Friends" width="326" height="56">
    </picture>
  </a>
</p>

## AI との会話を空間へ広げる

**Codex、Claude、Kimi などの AI エージェント**との会話を続けながら、その成果を PenEcho に並べましょう。

MCP を通じて、AI は説明を図に、アイデアをインタラクティブなプレビューに変換できます。資料、考察、成果を並べて確認し、キャンバスに書き込んだフィードバックを次の対話に取り込めます。

| 会話を続ける | 成果が形になるのを見る | フィードバックを届ける |
| --- | --- | --- |
| 使い慣れた AI エージェントで作業できます。 | PenEcho の MCP サーバーが図、ドキュメント、インタラクティブなプレビューを Canvas に配置します。 | 成果を試して注釈を加え、エージェントに読み取らせて次の修正につなげます。 |

<p align="center">
  <a href="../assets/mcp-spatial-example.webp">
    <img src="../assets/mcp-spatial-example.webp" alt="AI とのアーキテクチャ検討。Canvas 上の設計案に手書きでフィードバックを追加。" width="760">
  </a>
</p>
<p align="center"><em>Canvas に手書きで注釈を加えたアーキテクチャの検討。</em></p>

<!-- professional-diagram-gallery -->
<p align="center">さまざまな<strong>専門的な図表</strong>を作成し、見やすく、操作しやすく。</p>

<table width="100%">
  <tr>
    <th colspan="2" align="left">アーキテクチャ図</th>
  </tr>
  <tr>
    <td width="50%" align="center" valign="middle">
      <a href="../assets/professional-diagrams/kubernetes.webp"><img src="../assets/professional-diagrams/previews/kubernetes.webp" alt="Kubernetes 本番クラスタ" width="100%"></a>
    </td>
    <td width="50%" align="center" valign="middle">
      <a href="../assets/professional-diagrams/migration.webp"><img src="../assets/professional-diagrams/previews/migration.webp" alt="モノリスからマイクロサービスへ" width="100%"></a>
    </td>
  </tr>
  <tr>
    <td valign="top"><strong>Kubernetes 本番クラスタ</strong></td>
    <td valign="top"><strong>モノリスからマイクロサービスへ</strong></td>
  </tr>
  <tr>
    <th colspan="2" align="left">シーケンス図</th>
  </tr>
  <tr>
    <td width="50%" align="center" valign="middle">
      <a href="../assets/professional-diagrams/notifications.webp"><img src="../assets/professional-diagrams/previews/notifications.webp" alt="イベント駆動の通知" width="100%"></a>
    </td>
    <td width="50%" align="center" valign="middle">
      <a href="../assets/professional-diagrams/mcp-request.webp"><img src="../assets/professional-diagrams/previews/mcp-request.webp" alt="MCP リクエストが Canvas に届くまで" width="100%"></a>
    </td>
  </tr>
  <tr>
    <td valign="top"><strong>イベント駆動の通知</strong></td>
    <td valign="top"><strong>MCP リクエストが Canvas に届くまで</strong></td>
  </tr>
  <tr>
    <th colspan="2" align="left">ワークフロー</th>
  </tr>
  <tr>
    <td width="50%" align="center" valign="middle">
      <a href="../assets/professional-diagrams/release.webp"><img src="../assets/professional-diagrams/previews/release.webp" alt="リリース準備：並列処理と合流" width="100%"></a>
    </td>
    <td width="50%" align="center" valign="middle">
      <a href="../assets/professional-diagrams/rollout.webp"><img src="../assets/professional-diagrams/previews/rollout.webp" alt="複数リージョンへの展開とロールバック" width="100%"></a>
    </td>
  </tr>
  <tr>
    <td valign="top"><strong>リリース準備：並列処理と合流</strong></td>
    <td valign="top"><strong>複数リージョンへの展開とロールバック</strong></td>
  </tr>
</table>

<p align="center"><sub>画像をクリックすると、元のサイズで表示できます。</sub></p>
<!-- /professional-diagram-gallery -->

**完成する前から確認できます。** AI と話しながら成果が形になる様子を確認し、試してフィードバックを伝え、一緒にプロジェクトを進めましょう。

[MCP でエージェントを接続 →](#connect-your-agent-with-mcp)

## できること

- **視覚的に作業。** 広いキャンバスに手書き、数式、テキスト、画像、図、インタラクティブな HTML Widgets を組み合わせられます。
- **AI と制作。** 内蔵 Agent で調査、ファイル操作、アイデアの説明、編集可能な視覚的成果の作成ができます。
- **自分のエージェントを接続。** Codex、Claude Code などの MCP 対応クライアントで、明示的に有効化した Canvas を読み取り、編集できます。
- **成果を保存・共有。** Canvas をプロジェクトに整理し、Cloud のリビジョンを保存、お気に入りを同期し、Echoes で公開できます。

## 1.3.3 の新機能

| 図の種類 | 描画できる内容 |
| --- | --- |
| **アーキテクチャ図** | サービス、依存関係、入れ子のシステム境界を、自動レイアウトと接続線の経路計算で表現します。 |
| **シーケンス図** | 参加者とメッセージの順序を、応答、自己呼び出し、条件分岐・ループ・並列のフラグメントで表現します。 |
| **ワークフロー** | 手順、判断、条件付き分岐、ループ、分岐・合流を伴う並列処理を描画します。 |

PenEcho Agent または MCP 接続のエージェントに要件を伝え、Canvas 上で詳細を確認し、フィードバックで修正して SVG / PNG に書き出せます。

[更新履歴](../../CHANGELOG.md#133)

## 仕組み

<p align="center">
  <img src="../../public/penecho-architecture.webp" alt="PenEcho の構成：ブラウザーは PenEcho Cloud またはローカル PC に接続します。Cloud はホストモデルを提供し、リンク済みデバイスにも接続できます。PC は独自の LLM API やエージェントとともに PenEcho CLI またはアプリを実行します。外部 AI エージェントは Cloud MCP または Local MCP を任意で利用できます。" width="1483">
</p>

PenEcho Cloud、または CLI・デスクトップアプリを実行するローカル PC を通じて、ブラウザーで PenEcho を開きます。Cloud はホストモデルを提供し、リンク済みデバイスにも接続できます。PC では独自のモデル API やエージェントを使用できます。Codex、Claude などの外部 AI エージェントは Cloud MCP または Local MCP で接続できます。どちらの MCP 接続も任意です。

実装の詳細は[アーキテクチャの説明](../architecture.md)をご覧ください。

<a id="quick-start"></a>

## クイックスタート

**デスクトップ：** [GitHub Releases](https://github.com/penecho/penecho/releases/latest) から Windows または macOS アプリをダウンロードします。

**npm：** Node.js **22.19 以降**が必要です。

```bash
npm install -g penecho
penecho
```

`http://localhost:3888` を開きます。**設定 → 接続**で独自のモデル API、または認証済みの Codex、Claude Code、Kimi CLI を追加します。接続は `~/.penecho/connections.json` に保存され、一般設定は `~/.penecho/config.env` に保存されます。PenEcho がホストするモデルを使うには、サインインして設定で利用可能なモデルを選択します。

起動時に 6 桁のアクセスコードを設定するか、信頼できるネットワークでオープンアクセスを明示的に有効にします。他のデバイスから接続できる LAN アドレスも起動時に表示されます。

<details>
<summary>ソースから実行</summary>

```bash
git clone https://github.com/penecho/penecho.git
cd penecho
npm install
npm start
```

</details>

<a id="connect-your-agent-with-mcp"></a>

## MCP でエージェントを接続

**Local MCP** の場合：

1. PenEcho を起動し、**設定 → MCP サービス**で現在の Canvas を有効にします。
2. 設定から対応するローカルクライアントを構成するか、生成された起動設定をコピーします。npm のグローバルインストールでは、`mcpServers` JSON に対応するクライアントは次の設定を使用できます。

   ```json
   {
     "mcpServers": {
       "penecho": { "command": "penecho", "args": ["mcp"] }
     }
   }
   ```

3. エージェントに依頼します：**「話し合ったアーキテクチャを私の PenEcho Canvas に表示して。」**

エージェントは関連する内容のキャプチャ、オブジェクト編集、視覚的成果の作成、ドキュメントのソースファイルへのパッチ適用、フィードバックの受信ができます。検出できるのは有効化され、接続中の Canvas のみです。Local MCP では MCP クライアントを PenEcho ホスト上で実行します。LAN やリンク済みデバイスのブラウザーへの対応によって、ローカル MCP エンドポイントが公開されるわけではありません。Cloud MCP は、有効化済みの PenEcho Cloud キャンバス向けの、独立した認証付き HTTPS 接続です。

デスクトップ版では、適切な同梱ランタイムを含む生成済みの設定を使用してください。[MCP セットアップ](../mcp-setup.md)と任意の[エージェントワークフロースキル](../../skills/penecho-mcp/SKILL.md)をご覧ください。

## PenEcho Cloud と AI 接続

[PenEcho Cloud](https://penecho.ai) は、非公開プロジェクトのバージョン管理、お気に入りの同期、Echoes による公開共有、リンク済みコンピューターへのリモートアクセスを提供します。

| 接続 | 仕組み |
| --- | --- |
| **PenEcho のモデル** | サインインして利用可能なホストモデルを選び、アカウントのクレジットで使用します。現在の料金と残高は設定に表示されます。 |
| **独自のモデル API** | OpenAI または Anthropic 互換のエンドポイント、モデル、API キーを設定します。利用量はプロバイダー側で処理されます。 |
| **独自の CLI** | ローカルにインストールして認証済みの Codex、Claude Code、Kimi CLI を使用します。利用可否と利用量は各プロバイダーのプランに依存します。 |

コンピューターでホストモデルを使用するには Cloud へのサインインが必要ですが、デバイスのペアリングや別の Credits API キーは不要です。Cloud MCP は有効化された Cloud キャンバスに直接アクセスできます。コンピューター上でホストする Canvas に Cloud 経由でアクセスするには、リンク済みデバイスがオンラインで、必要なリレー機能に対応している必要があります。

独自の API・CLI 接続では PenEcho クレジットを消費しません。独自の接続を使うローカル利用では Cloud アカウントは任意です。AI 機能には選択したプロバイダーへのアクセスが必要であり、PenEcho をローカルで実行してもリモートモデルがオフラインで使えるようにはなりません。

## 推奨モデル設定

現在の実機検証を基に、PenEcho の実際のキャンバス作業における回答品質と待ち時間のバランスを考慮した推奨設定です。実際の応答時間はプロバイダー、キャンバスの複雑さ、推論動作によって変わります。

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

## コミュニティとライセンス

貢献するには [CONTRIBUTING.md](../../CONTRIBUTING.md) を読み、プルリクエストを作成する前に `npm run check` を実行してください。不具合は [Issues](https://github.com/penecho/penecho/issues)、アイデアは [Discussions](https://github.com/penecho/penecho/discussions)、交流は [Discord](https://discord.gg/3jrPJ3mXdX) へ。

[AGPL-3.0-only](../../LICENSE) ライセンスで提供しています。別途[商用ライセンス](../../COMMERCIAL-LICENSE.md)も利用できます。[商標ポリシー](../../TRADEMARKS.md)と[貢献者契約](../../CONTRIBUTOR-LICENSE-AGREEMENT.md)をご覧ください。

## 謝辞

tt-a1i による [Archify](https://github.com/tt-a1i/archify) に感謝します。PenEcho の専門図レンダラーは、この MIT ライセンスのプロジェクトから SVG・幾何処理の補助コードを適用しています。[MIT ライセンスと著作権表示](../../src/architecture/vendor/archify/LICENSE) を保持しています。第三者への帰属は [NOTICE](../../NOTICE) を参照してください。

## スター履歴

<p align="center">
  <a href="https://www.star-history.com/?repos=penecho%2Fpenecho&amp;type=date&amp;legend=top-left">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=penecho/penecho&amp;type=date&amp;theme=dark&amp;legend=top-left">
      <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=penecho/penecho&amp;type=date&amp;legend=top-left">
      <img src="https://api.star-history.com/chart?repos=penecho/penecho&amp;type=date&amp;legend=top-left" alt="PenEcho の GitHub スター数の推移" width="800">
    </picture>
  </a>
</p>
