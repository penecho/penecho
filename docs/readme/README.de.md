<h1 align="center">
  <img src="../../public/penecho-readme-header.png" alt="PenEcho" width="760">
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

<p align="center"><strong>Denke mit KI über das Chatfenster hinaus.</strong></p>

<p align="center">PenEcho ist eine gemeinsame Leinwand, auf der Handschrift, Gleichungen, Diagramme und räumlicher Kontext Teil des Gesprächs werden.</p>

<p align="center">
  <a href="https://discord.gg/3jrPJ3mXdX"><img src="https://img.shields.io/badge/Discord-Community%20beitreten-5865F2?style=for-the-badge&amp;logo=discord&amp;logoColor=white" alt="PenEcho auf Discord beitreten"></a>
  <a href="https://github.com/penecho/penecho/stargazers"><img src="https://img.shields.io/github/stars/penecho/penecho?style=for-the-badge&amp;logo=github&amp;logoColor=white&amp;color=f5b301" alt="PenEcho auf GitHub einen Stern geben"></a>
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/License-AGPL%20v3-blue?style=for-the-badge" alt="Lizenz: AGPL v3"></a>
</p>

> Diese Übersetzung bietet einen Projektüberblick. Die aktuelle und vollständige technische Referenz ist die [englische README](../../README.md).

<p align="center"><img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins.webp" alt="Demo professioneller PenEcho-Diagramme" width="49%"> <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_full_demo.webp" alt="Vollständige PenEcho-Demo" width="49%"></p>

<p align="center"><img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins_sub_x10.webp" alt="PenEcho-Plugin-Demo" width="49%"> <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/play_patris.webp" alt="Interaktive PenEcho-Canvas-Demo" width="49%"></p>

## Kimi Open Source Friends

PenEcho ist offizielles Mitglied der **Kimi Open Source Friends**, einem Programm von [Moonshot AI](https://www.kimi.com/) zur Unterstützung herausragender Open-Source-Projekte. Das Kimi-Team unterstützt die Entwicklung mit API-Guthaben. Kimi K3 gehört zu den empfohlenen Modellen für anspruchsvolle Aufgaben mit Handschrift und Diagrammen.

- [Kimi Code](https://www.kimi.com/code?aff=penecho) - weltweit verfügbares Coding-Abonnement
- [Kimi Open Platform, China](https://platform.kimi.com?aff=penecho) - API-Zugang für Festlandchina
- [Kimi Open Platform, international](https://platform.kimi.ai?aff=penecho) - API-Zugang für alle anderen Regionen

## Schnellstart

### Desktop-App

[Von GitHub Releases herunterladen](https://github.com/penecho/penecho/releases/latest).

Für die Installation über npm benötigst du [Node.js 20.3 oder neuer](https://nodejs.org/) und eine der folgenden Optionen: einen API-Schlüssel, eine authentifizierte [Codex CLI](https://developers.openai.com/codex/cli) oder eine authentifizierte [Claude Code CLI](https://code.claude.com/docs/en/overview).

```bash
npm install -g penecho
penecho configure
penecho
```

Öffne [http://localhost:3888](http://localhost:3888). Mit `penecho configure` lassen sich LLM-Quelle, Modell, Reasoning-Stufe, Zeitlimit, Bildformat und Netzwerkschnittstelle interaktiv festlegen. Die Konfiguration wird standardmäßig unter `~/.penecho/config.env` gespeichert; API-Zugangsdaten werden niemals an den Browser gesendet.

Aus dem Quellcode starten:

```bash
git clone https://github.com/penecho/penecho.git
cd penecho
npm install
npm start
```

## Auf der Leinwand denken

Schreibe eine Frage, Gleichung, Skizze oder unfertige Idee an eine beliebige Stelle der Leinwand und halte kurz inne. PenEcho erkennt die Striche und ihre räumlichen Beziehungen und platziert die Antwort daneben.

- Zeichne natürlich mit Stift oder Maus und navigiere auf einer `20.000 x 20.000` großen Leinwand.
- Erhalte Antworten, Hinweise, Erklärungen, Formeln, Funktionsgraphen und Diagramme direkt auf der Leinwand.
- Verschiebe oder skaliere KI-Entwürfe und bestätige oder verwirf sie einzeln, bevor sie Teil deiner Arbeit werden.
- Wähle Handschrift mit dem Lasso aus, um sie zu verschieben, zu skalieren, umzufärben, zu löschen oder mit Typeset sauber zu setzen.
- Speichere Schnappschüsse auf diesem Gerät oder dem PenEcho-Server und exportiere bestätigte Inhalte als PNG.
- Wähle zwischen den Designs Arcane, Sci-fi, Research und Studio.

## Neu in Version 0.9.0

- **Mehrere KI-Verbindungen mit Ein-Klick-Wechsel.** Speichere bis zu zehn API- oder CLI-Verbindungen, nutze bearbeitbare Kimi- und MiniMax-Voreinstellungen, teste Verbindungen im Canvas und wähle auf jedem Client desselben PenEcho-Hosts eine eigene aktive Verbindung. Änderungen gelten sofort.
- **Gemeinsame Leinwände nach Projekten.** Organisiere Server-Leinwände in Projekten, verschiebe Arbeiten zwischen ihnen und finde die neuesten Speicherstände über größere Vorschauen und Änderungszeiten. Das versionierte v2-Bundle hält Kacheln, Widgets, platzierte Bilder, Ressourcen und Vorschau-Metadaten zusammen; v1-Leinwände bleiben lesbar und werden beim nächsten Speichern aktualisiert.
- **Geführtes Refine direkt am Widget.** Schreibe oder platziere neue Anweisungen an einer beliebigen Stelle des sichtbaren Bereichs und wähle anschließend das zu aktualisierende Widget. PenEcho verbindet Anweisungsbereich und Ziel sichtbar, fragt vor dem Senden nach und bewahrt Anweisungen bei Abbruch oder Fehler; erfolgreiche Änderungen lassen sich weiterhin bestätigen oder rückgängig machen.
- **Kleinere inkrementelle Änderungen mit standardisiertem Unified Diff.** Refine sendet die vollständigen editierbaren Widget-Dateien, das Modell gibt jedoch nur geänderte Hunks statt des ganzen Widgets zurück. Das reduziert Ausgabe-Token und Wartezeit deutlich, während Änderungen an HTML, Quelle und Widget-Metadaten atomar bleiben.
- **Echte API-Streams.** OpenAI- und Anthropic-kompatible APIs verwenden jetzt durchgehend SSE, sodass eingehende Antworten sofort sichtbar werden und lange Anfragen über kompatible Gateways stabiler laufen.
- **Klarer Fortschritt und Abbruch.** Der obere Status zeigt Vorbereitung, Verbindung, Warten, Empfang, Prüfung, Wiederholungen und Zeitüberschreitungen. Während einer Anfrage stoppt die magische Schaltfläche die aktive Arbeit sofort.

## Frühere Höhepunkte

- **0.8.1.** Ergänzte öffentliche Live-Daten für General HTML sowie SVG als Standard für Animationen und komplexe Grafiken.
- **0.8.0 und 0.7.2.** Ergänzten editierbare professionelle Diagramme, Server-Speicherung, Zwischenablage-Workflows, Webfotos mit Quellen sowie zuverlässigere Bearbeitung und Exporte.

## Frühere Versionen

- **0.7.1.** Ergänzte lokale Bilder und Fotos, Objektbearbeitung mit Hand, Schnappschüsse, PNG-Export, kopierbare Mermaid-Diagramme und Webbilder mit Quellenangabe.
- **0.7.0.** Führte isoliertes interaktives HTML, Live-Daten-Plugins, lokale Plugin-Erstellung und Widget-Persistenz ein.
- **0.6.0 und früher.** Ergänzte deklarative Animationen, verbessertes Markdown/LaTeX, Auswahlwerkzeuge und die Grundlage der großen, dünn belegten Leinwand.

## Funktionsweise

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="../assets/how-it-works-dark.svg"><img alt="Funktionsweise von PenEcho" src="../assets/how-it-works-light.svg"></picture></p>

Der Browser sendet nur den relevanten Ausschnitt der Leinwand und dessen Geometrie. Der Server prüft die Anfrage, leitet sie an den gewählten Executor weiter und gibt einen strukturierten, verschiebbaren Entwurf zurück. Aktuelle Modellempfehlungen und Kostenbeispiele stehen in der [englischen README](../../README.md#recommended-model-configurations).

## Sichere Bereitstellung

- **Codex CLI und Claude CLI:** Nur auf dem lokalen Rechner oder in einem vertrauenswürdigen LAN verwenden. Jede gültige Anfrage startet einen lokalen CLI-Prozess; diese Modi dürfen daher nicht direkt im Internet bereitgestellt werden.
- **API-Modus:** Bei öffentlichem Zugriff sollte PenEcho hinter einem HTTPS-Proxy mit Authentifizierung sowie Begrenzungen für Anfragerate und -größe betrieben werden.
- Veröffentliche keine Konfigurationsdateien, API-Schlüssel, Anfrageprotokolle, Logs oder privaten Leinwandbilder.

## Mitwirken

Führe vor dem Einreichen einer Änderung Folgendes aus:

```bash
npm run check
```

Weitere Informationen findest du in den [Architekturhinweisen](../architecture.md) und in [CONTRIBUTING.md](../../CONTRIBUTING.md). Fragen und Beispiele gehören in [Discord](https://discord.gg/3jrPJ3mXdX) oder [GitHub Discussions](https://github.com/penecho/penecho/discussions), reproduzierbare Fehler in [GitHub Issues](https://github.com/penecho/penecho/issues).

## Lizenz und kommerzielle Nutzung

PenEcho wird unter [GNU AGPL v3.0 only](../../LICENSE) veröffentlicht. Kommerzielle Nutzung ist erlaubt. Wenn du eine veränderte Version über ein Netzwerk bereitstellst, musst du den Benutzern gemäß AGPL den zugehörigen Quellcode anbieten. Für proprietäre Produkte und gehostete Dienste, die die AGPL nicht erfüllen können, ist eine separate [kommerzielle Lizenz](../../COMMERCIAL-LICENSE.md) erhältlich. Name und Logo unterliegen zusätzlich der [Markenrichtlinie](../../TRADEMARKS.md).
