<p align="center">
  <a href="https://penecho.ai/lines.html">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="../assets/penecho-lines-logo-dark.svg">
      <img src="../assets/penecho-lines-logo.svg" alt="PenEcho Lines" width="340">
    </picture>
  </a>
</p>

<h3 align="center">Kein weiterer KI-Agent. Ein besserer Weg, mit Ihren zu arbeiten.</h3>

<p align="center">
  Zeichnen Sie, was Sie meinen, verfolgen Sie jede Aufgabe als Linie und lassen Sie einen Agenten die Arbeit eines anderen prüfen.<br>
  Funktioniert mit den Agenten, die Sie schon nutzen. Open Source, kostenlos auf Ihrem Computer, ohne Konto.
</p>

<p align="center">
  <a href="https://penecho.ai">Website</a> &nbsp;·&nbsp;
  <a href="#install">Download</a> &nbsp;·&nbsp;
  <a href="https://penecho.ai/try.html">Im Browser testen</a> &nbsp;·&nbsp;
  <a href="https://penecho.ai/leaderboard">Agenten-Rangliste</a> &nbsp;·&nbsp;
  <a href="https://discord.gg/3jrPJ3mXdX">Discord</a> &nbsp;·&nbsp;
  <a href="https://buymeacoffee.com/penecho">Einen Kaffee spendieren</a>
</p>

<p align="center">
  <sub>
    <a href="../../README.md">English</a> ·
    <a href="README.zh-CN.md">简体中文</a> ·
    <a href="README.ja.md">日本語</a> ·
    <a href="README.ko.md">한국어</a> ·
    <a href="README.ru.md">Русский</a> ·
    <a href="README.es.md">Español</a> ·
    <a href="README.pt-BR.md">Português</a> ·
    <a href="README.fr.md">Français</a> ·
    <strong>Deutsch</strong>
  </sub>
</p>

---

<a name="quick-start"></a>
<a name="install"></a>

## Installation

<a href="https://github.com/penecho/penecho/releases/latest"><img src="https://img.shields.io/badge/release-v1.5.0-2563eb" alt="Release v1.5.0"></a>
<img src="https://img.shields.io/badge/macOS%20·%20Windows%20·%20Linux-64748b" alt="macOS, Windows, Linux">
<a href="../../LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-64748b" alt="AGPL-3.0"></a>

| | |
| :--- | :--- |
| **Desktop-App** | Für macOS oder Windows auf [penecho.ai](https://penecho.ai/downloads.html) herunterladen. |
| **npm** | `npm install -g penecho`, dann `penecho` (Node.js 22.19 oder neuer). |
| **Browser** | [penecho.ai](https://penecho.ai) öffnen. Nichts zu installieren. |

Wählen Sie einen Zugangscode, öffnen Sie einen Projektordner und fügen Sie Ihre Agenten unter **Einstellungen → Agents** hinzu. Nutzen Sie die Agenten-Abos, für die Sie bereits zahlen, Ihren eigenen API-Schlüssel oder PenEcho-Modelle.

Neu in 1.5.0: Lines, Ein-Klick-Review, der Orchestrator mit echten Bewertungen, belegte Token-Ersparnisse und Live-Canvas-Sharing. Siehe [Änderungsprotokoll](../../CHANGELOG.md#150).

### Aus dem Quellcode starten

Sie benötigen Git und Node.js 22.19 oder neuer. Die gebauten Seiten liegen bereits im Repository, es gibt also keinen Build-Schritt.

```bash
git clone https://github.com/penecho/penecho.git
cd penecho
npm install
npm start        # PenEcho öffnet sich unter http://localhost:3888
```

Für die Desktop-App aus dem Quellcode führen Sie einmal `npm run desktop:deps` und dann `npm run desktop` aus. `npm run check` führt alle Prüfungen und Tests aus.

---

## In 3 Minuten verstehen

Eine echte Aufgabe von Anfang bis Ende: ein Agent baut, ein anderer prüft, die Korrekturen gehen zurück und Sie treffen die letzte Entscheidung.

<p align="center">
  <a href="https://penecho.ai/lines.html#film">
    <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_lines.gif" alt="PenEcho-Lines-Film: Screenshot einkreisen, Agenten wählen, Ein-Klick-Review, Korrekturen senden, bereit 5 von 5, der Orchestrator wählt Agenten nach ihrer Erfolgsbilanz" width="100%">
  </a>
</p>
<p align="center"><a href="https://penecho.ai/lines.html#film">▶ Vollständigen Film ansehen</a></p>

<p align="center">
  <img src="../assets/penecho-lines-architecture.svg" alt="Wie eine Aufgabe Ihre Agenten erreicht: PenEcho sendet eine Aufgabe direkt an einen Agenten oder über den Orchestrator aufgeteilt an mehrere Agenten. Alle Agenten arbeiten im Projektordner und führen dasselbe Markdown-Protokoll: MEMORY.md, lines und works." width="880">
</p>

Senden Sie eine Aufgabe direkt an einen Agenten oder übergeben Sie sie dem Orchestrator, der sie aufteilt und für jeden Teil einen Agenten wählt. Jeder Agent arbeitet in Ihrem Ordner und pflegt dasselbe schlichte Markdown-Protokoll.

---

## Was Sie bekommen

<table width="100%">
  <tr>
    <td width="50%" valign="top">
      <strong>Agenten arbeiten gemeinsam an einer Aufgabe</strong><br>
      Ein Agent baut, ein anderer prüft mit einem Klick, und <em>Send fixes</em> gibt Befunde auf derselben Line zurück.
    </td>
    <td width="50%" valign="top">
      <strong>Token-Ersparnisse mit Nachweis</strong><br>
      Setzt fort oder startet neu – je nachdem, was günstiger ist – und zeigt für jede Aufgabe die Ersparnis.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>Ein Orchestrator, der dazulernt</strong><br>
      Teilt große Aufgaben auf, wählt Agenten nach echten Ergebnissen und bewertet jeden Abschluss für immer bessere Wahl.
    </td>
    <td width="50%" valign="top">
      <strong>Alle Agenten synchronisiert</strong><br>
      Sitzungen aus Claude Code, Codex, Kimi, OpenCode und mehr werden synchronisiert. Führen Sie jede mit jedem Agenten fort.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>Hunderte Aufgaben auf einem Bildschirm</strong><br>
      Ask, In Arbeit, Braucht Sie, Zur Prüfung, Erledigt. Sehen Sie auf einen Blick, was auf Sie wartet.
    </td>
    <td width="50%" valign="top">
      <strong>Zeichnen Sie, was Sie meinen</strong><br>
      Kreisen Sie Screenshots ein, skizzieren Sie Prototypen, erstellen Sie Diagramme und Folien. Agenten sehen Markierungen und Text zusammen.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>Schlichtes Markdown, das Ihnen gehört</strong><br>
      Jede Line ist eine Markdown-Datei in Ihrem Ordner, mit einer <code>MEMORY.md</code> fürs Projekt. Überall lesbar.
    </td>
    <td width="50%" valign="top">
      <strong>Mit einem Link teilen</strong><br>
      Teilen Sie ein Projekt oder ein Canvas per Link. Teammitglieder öffnen es im Browser zum Prüfen und Einzeichnen.
    </td>
  </tr>
</table>

Funktioniert mit Claude Code, Codex, OpenCode, Antigravity, Kimi, Pi, DeepSeek Harness, omp und dem eingebauten Runner von PenEcho.

---

## Canvas AI

Schreiben, skizzieren oder kreisen Sie etwas ein – die Antwort landet genau dort, wo Sie gezeichnet haben.

<p align="center">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_full_demo.webp" alt="Gleichungen, Physikaufgaben, Skizzen und ein Labyrinth auf einem PenEcho Canvas gelöst" width="720">
</p>
<p align="center"><sub><strong>Skizzieren und fragen</strong> — Handschrift, Gleichungen, Zeichnungen und Labyrinthe.</sub></p>

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

PenEcho gehört zu den Kimi Open Source Friends. Kimi Code läuft in PenEcho wie jeder andere Agent: unter **Einstellungen → Agents** hinzufügen oder [Kimi Code holen](https://www.kimi.com/code?aff=penecho).

---

<a name="support-penecho"></a>
<a name="buy-us-a-coffee"></a>

## Mehr

- **Community:** [Website](https://penecho.ai) · [Rangliste](https://penecho.ai/leaderboard) · [Discord](https://discord.gg/3jrPJ3mXdX) · [Discussions](https://github.com/penecho/penecho/discussions) · [Issues](https://github.com/penecho/penecho/issues) · [Mitwirken](../../CONTRIBUTING.md)
- **Unterstützen:** Wenn PenEcho Ihnen einen Nachmittag gespart hat, [spendieren Sie uns einen Kaffee](https://buymeacoffee.com/penecho) oder [sponsern Sie auf GitHub](https://github.com/sponsors/penecho). Ein Stern oder ein guter Fehlerbericht hilft genauso sehr.
- **Dokumentation:** [Architektur](../architecture.md) · [Project Lines](../project-lines.md) · [MCP-Einrichtung](../mcp-setup.md) · [Änderungsprotokoll](../../CHANGELOG.md)
- **Lizenz:** [AGPL-3.0-only](../../LICENSE), eine [kommerzielle Lizenz](../../COMMERCIAL-LICENSE.md) ist erhältlich. Siehe [Markenrichtlinie](../../TRADEMARKS.md) und [CLA](../../CONTRIBUTOR-LICENSE-AGREEMENT.md). Die Diagramm-Renderer passen Code aus [Archify](https://github.com/tt-a1i/archify) von tt-a1i (MIT) an; siehe [NOTICE](../../NOTICE).

<details>
<summary><strong>Star-Verlauf</strong></summary>
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
