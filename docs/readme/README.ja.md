<p align="center">
  <a href="https://penecho.ai/lines.html">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="../assets/penecho-lines-logo-dark.svg">
      <img src="../assets/penecho-lines-logo.svg" alt="PenEcho Lines" width="340">
    </picture>
  </a>
</p>

<h3 align="center">もうひとつの AI Agent ではなく、あなたの Agent と働くためのより良い方法。</h3>

<p align="center">
  伝えたいことを描き、すべてのタスクを 1 本のラインで追い、ある Agent の仕事を別の Agent にレビューさせる。<br>
  今使っている Agent がそのまま使えます。オープンソース、ローカルで無料、アカウント不要。
</p>

<p align="center">
  <a href="https://penecho.ai">公式サイト</a> &nbsp;·&nbsp;
  <a href="#install">ダウンロード</a> &nbsp;·&nbsp;
  <a href="https://penecho.ai/try.html">ブラウザーで試す</a> &nbsp;·&nbsp;
  <a href="https://penecho.ai/leaderboard">Agent リーダーボード</a> &nbsp;·&nbsp;
  <a href="https://discord.gg/3jrPJ3mXdX">Discord</a> &nbsp;·&nbsp;
  <a href="https://buymeacoffee.com/penecho">コーヒーをおごる</a>
</p>

<p align="center">
  <sub>
    <a href="../../README.md">English</a> ·
    <a href="README.zh-CN.md">简体中文</a> ·
    <strong>日本語</strong> ·
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

## インストール

<a href="https://github.com/penecho/penecho/releases/latest"><img src="https://img.shields.io/badge/release-v1.5.0-2563eb" alt="Release v1.5.0"></a>
<img src="https://img.shields.io/badge/macOS%20·%20Windows%20·%20Linux-64748b" alt="macOS, Windows, Linux">
<a href="../../LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-64748b" alt="AGPL-3.0"></a>

| | |
| :--- | :--- |
| **デスクトップアプリ** | [penecho.ai](https://penecho.ai/downloads.html) から macOS 版または Windows 版をダウンロード。 |
| **npm** | `npm install -g penecho` のあと `penecho` を実行（Node.js 22.19 以上）。 |
| **ブラウザー** | [penecho.ai](https://penecho.ai) を開くだけ。インストール不要。 |

アクセスコードを設定し、プロジェクトフォルダーを開いて、**設定 → Agents** からお使いの Agent を追加します。すでに契約中の Agent プラン、ご自身の API キー、または PenEcho モデルを利用できます。

1.5.0 の新機能：Lines、ワンクリックレビュー、実績に基づく評価付き Orchestrator、根拠付きのトークン節約、ライブ Canvas 共有。詳しくは [変更履歴](../../CHANGELOG.md#150) をご覧ください。

### ソースから実行する

Git と Node.js 22.19 以上が必要です。ビルド済みのページがリポジトリに含まれているため、ビルド手順は不要です。

```bash
git clone https://github.com/penecho/penecho.git
cd penecho
npm install
npm start        # PenEcho が http://localhost:3888 で開きます
```

ソースからデスクトップアプリを実行する場合は、最初に一度 `npm run desktop:deps` を実行し、その後 `npm run desktop` を実行します。`npm run check` で全チェックとテストを実行できます。

---

## 3 分でわかる PenEcho Lines

ひとつの実タスクを最初から最後まで：ある Agent が実装し、別の Agent がレビューし、修正を差し戻し、最後にあなたが判断します。

<p align="center">
  <a href="https://penecho.ai/lines.html#film">
    <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_lines.gif" alt="PenEcho Lines の紹介映像：スクリーンショットを丸で囲み、Agent を選び、ワンクリックでレビュー、修正を送信、5/5 で完了、Orchestrator が実績で Agent を選定" width="100%">
  </a>
</p>
<p align="center"><a href="https://penecho.ai/lines.html#film">▶ 本編を見る</a></p>

<p align="center">
  <img src="../assets/penecho-lines-architecture.svg" alt="タスクが Agent に届く仕組み：PenEcho は単一の Agent に直接タスクを送るか、Orchestrator がタスクを分割して複数の Agent に割り当てます。各 Agent はプロジェクトフォルダー内で作業し、同じ Markdown 記録（MEMORY.md、lines、works）を共有します。" width="880">
</p>

タスクを 1 つの Agent に直接渡すことも、Orchestrator に任せて分割し各パートに最適な Agent を選ばせることもできます。どの Agent も同じフォルダーで作業し、同じプレーンな Markdown 記録を保ちます。

---

## できること

<table width="100%">
  <tr>
    <td width="50%" valign="top">
      <strong>ひとつの仕事を複数 Agent で連携</strong><br>
      ある Agent が作り、別がワンクリックでレビュー。<em>Send fixes</em> で同じ Line 上に修正を戻せます。
    </td>
    <td width="50%" valign="top">
      <strong>根拠のあるトークン節約</strong><br>
      続行か新規開始かを安価な方で自動判断し、各タスクの節約量を可視化します。
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>学び続ける Orchestrator</strong><br>
      大きな仕事を分割し、実績をもとに Agent を選定。結果を評価するほど精度が上がります。
    </td>
    <td width="50%" valign="top">
      <strong>あらゆる Agent を同期</strong><br>
      Claude Code、Codex、Kimi、OpenCode などのセッションを取り込み、別の Agent でそのまま続行できます。
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>数百のタスクを 1 画面で把握</strong><br>
      Ask、作業中、確認待ち、レビュー待ち、完了。今あなたを待っている仕事が一目でわかります。
    </td>
    <td width="50%" valign="top">
      <strong>伝えたいことを描く</strong><br>
      スクリーンショットを囲み、プロトタイプや図・スライドを描く。Agent は言葉と一緒に描き込みも理解します。
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>自分の手元に残る Markdown</strong><br>
      すべての Line はフォルダー内の Markdown ファイル。プロジェクト共通の <code>MEMORY.md</code> とともにどこでも読めます。
    </td>
    <td width="50%" valign="top">
      <strong>リンク 1 つで共有</strong><br>
      プロジェクトや Canvas をリンクで共有。チームメンバーはブラウザーからレビューや書き込みができます。
    </td>
  </tr>
</table>

Claude Code、Codex、OpenCode、Antigravity、Kimi、Pi、DeepSeek Harness、omp、および PenEcho 組み込みランナーに対応しています。

---

## Canvas AI

書く、描く、丸で囲むだけで、答えがそのまま描いた場所に返ってきます。

<p align="center">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_full_demo.webp" alt="PenEcho Canvas 上で数式、物理の問題、スケッチ、迷路を解くデモ" width="720">
</p>
<p align="center"><sub><strong>描いて尋ねる</strong> — 手書き文字、数式、スケッチ、迷路。</sub></p>

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

PenEcho は Kimi Open Source Friends の一員です。Kimi Code も他の Agent と同様に PenEcho 上で動作します。**設定 → Agents** から追加するか、[Kimi Code を入手](https://www.kimi.com/code?aff=penecho) してください。

---

<a name="support-penecho"></a>
<a name="buy-us-a-coffee"></a>

## その他

- **コミュニティ：** [公式サイト](https://penecho.ai) · [リーダーボード](https://penecho.ai/leaderboard) · [Discord](https://discord.gg/3jrPJ3mXdX) · [Discussions](https://github.com/penecho/penecho/discussions) · [Issues](https://github.com/penecho/penecho/issues) · [コントリビュート](../../CONTRIBUTING.md)
- **支援する：** PenEcho が午後の時間を節約してくれたなら、[コーヒーをおごる](https://buymeacoffee.com/penecho) か [GitHub Sponsors](https://github.com/sponsors/penecho) で応援していただけると嬉しいです。スターや丁寧なバグ報告も同じくらい力になります。
- **ドキュメント：** [アーキテクチャ](../architecture.md) · [Project Lines](../project-lines.md) · [MCP セットアップ](../mcp-setup.md) · [変更履歴](../../CHANGELOG.md)
- **ライセンス：** [AGPL-3.0-only](../../LICENSE)（[商用ライセンス](../../COMMERCIAL-LICENSE.md) もあります）。[商標ポリシー](../../TRADEMARKS.md) と [CLA](../../CONTRIBUTOR-LICENSE-AGREEMENT.md) をご覧ください。図表レンダラーは tt-a1i による [Archify](https://github.com/tt-a1i/archify)（MIT）のコードを改変しています。詳しくは [NOTICE](../../NOTICE) をご覧ください。

<details>
<summary><strong>Star の推移</strong></summary>
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
