<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../public/penecho-readme-header-dark.webp">
    <img src="../../public/penecho-readme-header.webp" alt="PenEcho" width="280">
  </picture>
</h1>

<p align="center">
  <a href="../../README.md">English</a> |
  <a href="README.zh-CN.md">简体中文</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.pt-BR.md">Português (Brasil)</a> |
  <a href="README.fr.md">Français</a> |
  <strong>Deutsch</strong>
</p>

<h1 align="center">Ein räumlicher Arbeitsbereich,<br>um mit KI zu denken.</h1>
<p align="center">Zeichnen, erkunden und entwickeln Sie mit dem integrierten Agenten oder Ihrem eigenen MCP-kompatiblen Assistenten.</p>
<p align="center">
  <img src="https://img.shields.io/badge/version-1.3.2-087f83" alt="Version 1.3.2">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="AGPL-3.0-only"></a>
</p>
<p align="center">
  <a href="https://penecho.ai">Website</a> ·
  <a href="https://github.com/penecho/penecho/releases/latest">Herunterladen</a> ·
  <a href="#schnellstart">Schnellstart</a> ·
  <a href="../mcp-setup.md">MCP-Anleitung</a> ·
  <a href="https://discord.gg/3jrPJ3mXdX">Discord</a>
</p>

<p align="center">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_full_demo.webp" alt="Vollständige PenEcho-Demo" width="49%">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins.webp" alt="PenEcho-Demo für professionelle Diagramme" width="49%">
</p>

<p align="center">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins_sub_x10.webp" alt="PenEcho-Plugin-Demo" width="49%">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/play_patris.webp" alt="PenEcho-Demo für interaktive Zeichenflächen" width="49%">
</p>

<p align="center">
  <a href="https://www.kimi.com/code?aff=penecho">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="../assets/kimi-open-source-friends-dark.svg">
      <img src="../assets/kimi-open-source-friends-light.svg" alt="Kimi Open Source Friends" width="326" height="56">
    </picture>
  </a>
</p>

## Eine räumliche Erweiterung Ihres KI-Gesprächs

Sprechen Sie weiter mit **Codex, Claude, Kimi oder anderen KI-Agenten**. PenEcho gibt Ihrer Arbeit einen Platz.

Über MCP kann Ihre KI Erklärungen in Diagramme und Ideen in interaktive Vorschauen verwandeln. Halten Sie Referenzen, Überlegungen und Arbeit nebeneinander fest und kommentieren Sie dann die Zeichenfläche, um Ihr Feedback in die nächste Runde einzubringen.

| Das Gespräch fortsetzen | Die Arbeit nimmt Gestalt an | Feedback zurückgeben |
| --- | --- | --- |
| Arbeiten Sie mit dem KI-Agenten, den Sie bereits verwenden. | Der MCP-Server von PenEcho bringt Diagramme, Dokumente und interaktive Vorschauen auf den Canvas. | Probieren Sie das Ergebnis aus, kommentieren Sie es und lassen Sie Ihren Agenten das Feedback für die nächste Überarbeitung lesen. |

<p align="center">
  <a href="../assets/mcp-spatial-example.webp">
    <img src="../assets/mcp-spatial-example.webp" alt="Eine Architekturdiskussion mit KI und handschriftlichem Feedback neben dem vorgeschlagenen Entwurf auf einem PenEcho Canvas" width="760">
  </a>
</p>
<p align="center"><em>Eine Architekturdiskussion mit handschriftlichen Anmerkungen auf dem Canvas.</em></p>

**Sehen Sie das Ergebnis, bevor es fertig ist.** Verfolgen Sie, wie die Arbeit im Gespräch mit der KI Gestalt annimmt. Probieren Sie sie aus, geben Sie Feedback und bringen Sie Ihr Projekt gemeinsam voran.

[Ihren Agenten über MCP verbinden →](#ihren-agenten-über-mcp-verbinden)

## Was Sie tun können

- **Visuell arbeiten.** Kombinieren Sie Handschrift, Gleichungen, Text, Bilder, Diagramme und interaktive HTML-Widgets auf einer großzügigen Zeichenfläche.
- **Mit KI erstellen.** Nutzen Sie den integrierten Agenten zum Recherchieren, zur Arbeit mit Dateien, zum Erklären von Ideen und zum Erstellen bearbeitbarer visueller Ergebnisse.
- **Den eigenen Agenten nutzen.** Verbinden Sie Codex, Claude Code oder einen anderen MCP-kompatiblen Client, um einen ausdrücklich freigegebenen Canvas zu lesen und zu bearbeiten.
- **Arbeit aufbewahren und teilen.** Organisieren Sie Canvases in Projekten, speichern Sie Cloud-Versionen, synchronisieren Sie Favoriten und veröffentlichen Sie über Echoes.

## Neu in 1.3.2

| Neuerung | Nutzen |
| --- | --- |
| **MCP-Arbeitsbereich** | Canvas-Erkennung, Aufnahmen, Objektbearbeitung, interaktive Widgets, virtuelle Quelldateien und Benutzerfeedback für externe Agenten. Unterstützt ausdrücklich freigegebene lokale Browser, LAN-Browser und Cloud-Browser über verknüpfte Geräte. |
| **Cloud MCP** | Verbinden Sie externe KI-Agenten direkt mit Ihren aktivierten PenEcho-Cloud-Canvases, um Inhalte zu lesen, Ergebnisse zu erstellen und zu bearbeiten sowie handschriftliches Feedback zu berücksichtigen. Cloud MCP und Local MCP sind optionale Verbindungswege. |
| **PenEcho Cloud Credits API** | Nutzen Sie von PenEcho gehostete Modelle mit Kontoguthaben neben Ihren eigenen API- und CLI-Verbindungen. Verfügbare Modelle, Preise und Guthaben sehen Sie in den Einstellungen. |
| **Verbindungsverwaltung** | Speichern Sie mehrere KI-Verbindungen und wählen Sie die aktive Verbindung für jeden Client. |
| **Canvas und Arbeitsumgebung** | Reaktionsschnelleres Zeichnen und Navigieren, verfeinerte Studio-Steuerung, ein anpassungsfähiges Agent-Panel und konfigurierbare Tastenkürzel. |

## So funktioniert es

<p align="center">
  <img src="../../public/penecho-architecture.webp" alt="PenEcho-Architektur: Ein Browser verbindet sich mit PenEcho Cloud oder Ihrem lokalen PC. Die Cloud bietet gehostete Modelle und verbindet sich mit Ihrem verknüpften Gerät. Auf Ihrem PC läuft PenEcho CLI oder App mit Ihrer Modell-API oder Ihren Agenten. Externe KI-Agenten können Cloud MCP oder Local MCP nutzen; beide Verbindungen sind optional." width="1483">
</p>

Öffnen Sie PenEcho im Browser über PenEcho Cloud oder Ihren lokalen PC, auf dem die CLI oder Desktop-App läuft. Die Cloud bietet gehostete Modelle und kann sich mit Ihrem verknüpften Gerät verbinden; Ihr PC kann Ihre eigene Modell-API oder Ihre Agenten nutzen. Externe KI-Agenten wie Codex und Claude können sich über Cloud MCP oder Local MCP verbinden. Beide MCP-Verbindungen sind optional.

Implementierungsdetails finden Sie in den [Architekturnotizen](../architecture.md).

## Schnellstart

**Desktop:** Laden Sie die Windows- oder macOS-App von [GitHub Releases](https://github.com/penecho/penecho/releases/latest) herunter.

**npm:** erfordert Node.js **22.19 oder neuer**.

```bash
npm install -g penecho
penecho
```

Öffnen Sie `http://localhost:3888`. Fügen Sie unter **Einstellungen → Verbindungen** Ihre eigene Modell-API oder eine authentifizierte Codex-, Claude-Code- oder Kimi-CLI hinzu. Verbindungen werden in `~/.penecho/connections.json` gespeichert; allgemeine Einstellungen bleiben in `~/.penecho/config.env`. Für von PenEcho gehostete Modelle melden Sie sich an und wählen ein verfügbares Modell in den Einstellungen.

Legen Sie beim Start einen sechsstelligen Zugangscode fest oder aktivieren Sie ausdrücklich den offenen Zugang in Ihrem vertrauenswürdigen Netzwerk. Beim Start werden außerdem LAN-Adressen für andere Geräte ausgegeben.

<details>
<summary>Aus dem Quellcode ausführen</summary>

```bash
git clone https://github.com/penecho/penecho.git
cd penecho
npm install
npm start
```

</details>

## Ihren Agenten über MCP verbinden

Für **Local MCP**:

1. Starten Sie PenEcho und aktivieren Sie den aktuellen Canvas unter **Einstellungen → MCP-Dienst**.
2. Konfigurieren Sie über die Einstellungen einen unterstützten lokalen Client oder kopieren Sie dessen generierte Startkonfiguration. Bei einer globalen npm-Installation können Clients, die `mcpServers`-JSON akzeptieren, Folgendes verwenden:

   ```json
   {
     "mcpServers": {
       "penecho": { "command": "penecho", "args": ["mcp"] }
     }
   }
   ```

3. Bitten Sie Ihren Agenten: **„Zeige die besprochene Architektur auf meinem PenEcho Canvas.“**

Der Agent kann relevante Inhalte aufnehmen, Objekte bearbeiten, visuelle Ergebnisse erstellen, Dokumentquelldateien ändern und Ihr Feedback erhalten. Nur aktivierte, verbundene Canvases sind auffindbar. Bei Local MCP läuft der MCP-Client auf dem PenEcho-Host; die Unterstützung für LAN-Browser und Browser verknüpfter Geräte macht den lokalen MCP-Endpunkt nicht öffentlich zugänglich. Cloud MCP ist eine separate authentifizierte HTTPS-Verbindung für Ihre aktivierten PenEcho-Cloud-Canvases.

Desktop-Installationen sollten die generierte Konfiguration verwenden, die die richtige mitgelieferte Laufzeitumgebung enthält. Siehe [MCP-Einrichtung](../mcp-setup.md) und den optionalen [Agent-Workflow-Skill](../../skills/penecho-mcp/SKILL.md).

## PenEcho Cloud und KI-Verbindungen

[PenEcho Cloud](https://penecho.ai) ergänzt private Projekte mit Versionsverlauf, synchronisierte Favoriten, öffentliches Teilen über Echoes und Fernzugriff auf einen verknüpften Computer.

| Verbindung | Funktionsweise |
| --- | --- |
| **PenEcho-Modelle** | Melden Sie sich an, wählen Sie ein verfügbares gehostetes Modell und nutzen Sie Ihr Kontoguthaben. Die Einstellungen zeigen aktuelle Preise und Guthaben. |
| **Ihre Modell-API** | Konfigurieren Sie einen OpenAI- oder Anthropic-kompatiblen Endpunkt, ein Modell und einen API-Schlüssel. Die Nutzung wird von Ihrem Anbieter verwaltet. |
| **Ihre CLI** | Nutzen Sie eine lokal installierte und authentifizierte Codex-, Claude-Code- oder Kimi-CLI. Verfügbarkeit und Nutzung hängen vom Tarif des Anbieters ab. |

Gehostete Modelle auf Ihrem Computer erfordern eine Cloud-Anmeldung, aber keine Gerätekopplung und keinen separaten Credits-API-Schlüssel. Cloud MCP kann direkt auf aktivierte Cloud-Canvases zugreifen. Der Zugriff über die Cloud auf einen Canvas, der auf Ihrem Computer gehostet wird, erfordert ein online verfügbares verknüpftes Gerät und die notwendige Relay-Unterstützung.

Ihre eigenen API- und CLI-Verbindungen verbrauchen kein PenEcho-Guthaben. Für die lokale Nutzung mit Ihrer eigenen Verbindung ist ein Cloud-Konto optional. KI-Funktionen benötigen Zugriff auf den ausgewählten Anbieter; ein lokaler PenEcho-Betrieb macht ein entferntes Modell nicht offline verfügbar.

## Empfohlene Modellkonfigurationen

Diese Empfehlungen wägen Antwortqualität und Latenz bei tatsächlichen PenEcho-Canvas-Aufgaben anhand aktueller Praxistests ab. Die tatsächliche Antwortzeit hängt vom Anbieter, der Komplexität des Canvas und dem Schlussfolgerungsverhalten ab.

| Modell | Effort | Hinweise | Empfohlene Verwendung |
| --- | --- | --- | --- |
| Claude Opus 4.8 / 5.0 (`claude-opus-4-8` / `claude-opus-5-0`) | `medium` | Hohe Qualität bei besserem Latenzgleichgewicht | Tägliche Canvas-Arbeit |
| Claude Opus 4.8 / 5.0 (`claude-opus-4-8` / `claude-opus-5-0`) | `high` | Höhere Schlussfolgerungsqualität, längere und variablere Wartezeiten | Komplexe Handschrift, Mathematik, Diagramme oder Layouts |
| Fable 5 (`claude-fable-5` oder `fable`) | `medium` | Häufig etwa halb so lange Antwortzeit wie `gpt-5.6-sol` mit `xhigh` | Schnelle allgemeine Nutzung mit hoher Qualität |
| [Kimi K3](https://platform.kimi.ai?aff=penecho) (`kimi-k3`) | `medium` | Sehr gute Qualität; `medium` hält das Verhältnis praxistauglich | Empfohlener Kimi-Standard |
| `gpt-5.6-terra` | `low` bis `high` | Überraschend leistungsfähig und reaktionsschnell | Flexible Qualitäts- und Latenzziele |
| `gpt-5.6-luna` | `xhigh` | Sehr gute Canvas-Ergebnisse bei hoher Geschwindigkeit | Qualität im Vordergrund, weiterhin reaktionsschnell |
| `gpt-5.6-sol` | `high` | Für die meisten Anfragen ausreichend, reaktionsschneller als `xhigh` | Standard, wenn Reaktionszeit wichtig ist |
| `gpt-5.6-sol` | `xhigh` | Sehr gut, aber langsamer und variabler | Schwierige Canvas-Aufgaben |
| `deepseek-v4-flash-vision-exp` | `medium` | Gut | Aufgaben mit Bildverständnis über die DeepSeek-API |
| `glm-5.3-flash` | `medium` | Gut | Schnelle Arbeit über die Anthropic-kompatible GLM-API |

## Community und Lizenz

Lesen Sie [CONTRIBUTING.md](../../CONTRIBUTING.md), um beizutragen; führen Sie `npm run check` aus, bevor Sie einen Pull Request öffnen. Melden Sie Fehler in den [Issues](https://github.com/penecho/penecho/issues), diskutieren Sie Ideen in den [Discussions](https://github.com/penecho/penecho/discussions) oder kommen Sie zu [Discord](https://discord.gg/3jrPJ3mXdX).

Lizenziert unter [AGPL-3.0-only](../../LICENSE). Eine alternative [kommerzielle Lizenz](../../COMMERCIAL-LICENSE.md) ist verfügbar. Siehe [Markenrichtlinie](../../TRADEMARKS.md) und [Beitragsvereinbarung](../../CONTRIBUTOR-LICENSE-AGREEMENT.md).
