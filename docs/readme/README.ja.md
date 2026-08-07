<h1 align="center">
  <img src="../../public/penecho-readme-header.png" alt="PenEcho" width="760">
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

<p align="center"><strong>チャットボックスを越えて、AI と考える。</strong></p>

<p align="center">PenEcho は、手書き、数式、図、空間的な文脈を対話の一部として扱える共有キャンバスです。</p>

<p align="center">
  <a href="https://discord.gg/3jrPJ3mXdX"><img src="https://img.shields.io/badge/Discord-コミュニティに参加-5865F2?style=for-the-badge&amp;logo=discord&amp;logoColor=white" alt="PenEcho Discord に参加"></a>
  <a href="https://github.com/penecho/penecho/stargazers"><img src="https://img.shields.io/github/stars/penecho/penecho?style=for-the-badge&amp;logo=github&amp;logoColor=white&amp;color=f5b301" alt="GitHub で PenEcho にスターを付ける"></a>
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/License-AGPL%20v3-blue?style=for-the-badge" alt="ライセンス: AGPL v3"></a>
</p>

> この翻訳はプロジェクトの概要を提供します。最新かつ完全な技術情報については、正本である [英語版 README](../../README.md) を参照してください。

<p align="center"><img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins.webp" alt="PenEcho プロ向け図表のデモ" width="49%"> <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_full_demo.webp" alt="PenEcho の全体デモ" width="49%"></p>

<p align="center"><img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins_sub_x10.webp" alt="PenEcho プラグインのデモ" width="49%"> <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/play_patris.webp" alt="PenEcho インタラクティブキャンバスのデモ" width="49%"></p>

## Kimi Open Source Friends

PenEcho は、[Moonshot AI](https://www.kimi.com/) が優れたオープンソースプロジェクトを支援する **Kimi Open Source Friends** の公式メンバーです。Kimi チームは API クレジットで開発を支援しており、Kimi K3 は手書きや図を扱う高負荷なキャンバス作業に推奨されるモデルの一つです。

- [Kimi Code](https://www.kimi.com/code?aff=penecho) - 世界各地で利用できるコーディングサブスクリプション
- [Kimi Open Platform（中国）](https://platform.kimi.com?aff=penecho) - 中国本土向け API
- [Kimi Open Platform（グローバル）](https://platform.kimi.ai?aff=penecho) - その他の地域向け API

## クイックスタート

### デスクトップアプリ

[GitHub Releases からダウンロード](https://github.com/penecho/penecho/releases/latest)。

npm でインストールする場合は、[Node.js 20.3 以降](https://nodejs.org/)と、API キー、認証済みの [Codex CLI](https://developers.openai.com/codex/cli)、または認証済みの [Claude Code CLI](https://code.claude.com/docs/en/overview) のいずれかが必要です。

```bash
npm install -g penecho
penecho configure
penecho
```

ブラウザーで [http://localhost:3888](http://localhost:3888) を開きます。`penecho configure` では LLM ソース、モデル、推論レベル、タイムアウト、画像形式、待受アドレスなどを対話形式で設定できます。設定は既定で `~/.penecho/config.env` に保存され、API 認証情報がブラウザーへ送られることはありません。

ソースから実行する場合:

```bash
git clone https://github.com/penecho/penecho.git
cd penecho
npm install
npm start
```

## キャンバスで考える

質問、数式、図、まだ形になっていないアイデアをキャンバスの好きな場所に書き、少し待つだけです。PenEcho は筆跡と空間的な関係を読み取り、その場に回答を配置します。

- スタイラスまたはマウスで自然に描き、`20,000 x 20,000` のキャンバスをパン、ズームできます。
- 回答、ヒント、説明、数式、プロット、図をキャンバス上に直接生成します。
- AI の下書きは移動、サイズ変更、承認、破棄ができ、確定するまで元の内容とは分離されます。
- 投げ縄で選択した手書きを移動、変形、色変更、削除、または Typeset で清書できます。
- スナップショットをこの端末または PenEcho サーバーに保存し、確定済みの内容を PNG として書き出せます。
- Arcane、Sci-fi、Research、Studio のテーマを選べます。

## 0.9.0 の新機能

- **複数の AI 接続をワンクリックで切り替え。** API または CLI 接続を最大 10 件保存し、編集可能な Kimi・MiniMax プリセットから設定してキャンバス内でテストできます。同じ PenEcho ホストに接続する各クライアントが別々の接続を選べ、変更はすぐに反映されます。
- **より速く柔軟な Refine。** 表示中の領域のどこにでも指示を書き、変更するウィジェットを選択できます。標準 unified diff で全体ではなく変更だけを送り、確認と取り消しを維持しながらトークンと待ち時間を減らします。
- **真の API ストリーミング。** OpenAI・Anthropic 互換 API はエンドツーエンドの SSE を使用し、受信開始をすぐに表示して、互換ゲートウェイ経由の長いリクエストを安定させます。
- **明確な進行状況と停止。** 上部に準備、接続、待機、受信、検証、再試行、タイムアウトを表示します。リクエスト中は魔法ボタンで実行中の処理を即座に停止できます。

## 以前の主な更新

- **0.8.1。** General HTML のリアルタイム公開データと、アニメーション・複雑なグラフィック向けの SVG 優先表示を追加しました。
- **0.8.0 と 0.7.2。** 編集可能な専門図表、サーバー保存、クリップボード操作、出典付き Web 写真、より信頼性の高い編集と書き出しを追加しました。

## 過去のリリース

- **0.7.1。** ローカル画像と写真、Hand によるオブジェクト編集、スナップショット、PNG 出力、コピー可能な Mermaid 図表、出典付き Web 画像を追加しました。
- **0.7.0。** 隔離された対話型 HTML、ライブデータプラグイン、ローカルプラグイン作成、ウィジェット保存を導入しました。
- **0.6.0 以前。** 宣言型アニメーション、Markdown/LaTeX 改善、選択ツール、大規模な疎キャンバス基盤を追加しました。

## 仕組み

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="../assets/how-it-works-dark.svg"><img alt="PenEcho の仕組み" src="../assets/how-it-works-light.svg"></picture></p>

ブラウザーは関連するキャンバス領域と位置情報だけをサーバーへ送信します。サーバーがリクエストを検証して選択済みの実行系へ渡し、移動可能な構造化下書きを返します。現在の推奨モデルと料金例は [英語版 README](../../README.md#recommended-model-configurations) に掲載しています。

## 安全な運用

- **Codex CLI / Claude CLI:** ローカルマシンまたは信頼できる LAN だけで使用してください。有効なリクエストはローカル CLI プロセスを起動するため、公開インターネットへ直接公開しないでください。
- **API モード:** 公開する場合は HTTPS、認証、レート制限、リクエストサイズ制限を備えたリバースプロキシの背後に配置してください。
- 設定ファイル、API キー、リクエスト記録、ログ、非公開のキャンバス画像を公開しないでください。

## 開発への参加

変更を提出する前に次を実行してください。

```bash
npm run check
```

実装の概要は [アーキテクチャ資料](../architecture.md)、貢献方法は [CONTRIBUTING.md](../../CONTRIBUTING.md) を参照してください。質問や事例共有は [Discord](https://discord.gg/3jrPJ3mXdX) と [GitHub Discussions](https://github.com/penecho/penecho/discussions)、再現可能な不具合は [GitHub Issues](https://github.com/penecho/penecho/issues) へお願いします。

## ライセンスと商用利用

PenEcho は [GNU AGPL v3.0 only](../../LICENSE) で公開されています。商用利用は可能ですが、ネットワーク越しに変更版を提供する場合は、AGPL の条件に従って対応するソースコードを利用者へ提供する必要があります。AGPL に適合できないプロプライエタリ製品やホステッドサービス向けには、別途 [商用ライセンス](../../COMMERCIAL-LICENSE.md) があります。名称とロゴには [商標ポリシー](../../TRADEMARKS.md) が適用されます。
