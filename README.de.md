<h1 align="center">
  <img src="public/penecho-readme-header.png" alt="PenEcho" width="760">
</h1>

<p align="center">
  <a href="README.md">English</a> |
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
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL%20v3-blue?style=for-the-badge" alt="Lizenz: AGPL v3"></a>
</p>

> Diese Übersetzung bietet einen Projektüberblick. Die aktuelle und vollständige technische Referenz ist die [englische README](README.md).

<p align="center"><img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins_sub_x10.webp" alt="PenEcho-Plugin-Demo" width="100%"></p>

<p align="center"><img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_full_demo.webp" alt="Vollständige PenEcho-Demo" width="100%"></p>

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
- Speichere Schnappschüsse lokal im Browser und exportiere bestätigte Inhalte als PNG.
- Wähle zwischen den Designs Arcane, Sci-fi, Research und Studio.

## Neu in Version 0.7.1

- **Bilder und Fotos auf der Leinwand.** Fügen Sie Bilder über die Systemauswahl hinzu – Foto-Mediathek oder Kamera auf Smartphones und Tablets, Bilddateien auf dem Desktop. Große Bilder werden automatisch verkleinert und komprimiert, damit Leinwände und Schnappschüsse leicht bleiben.
- **Bearbeiten per langem Druck, klare Aktionen.** Drücken Sie lange auf ein Bild, um es erneut zu verschieben oder seine Größe zu ändern, und wählen Sie Platzieren, Verschmelzen oder Löschen. Platzieren hält das Bild frei unter Ihrer Tinte, sodass Sie darüber zeichnen können; Verschmelzen verwandelt es in echte Striche, die sich radieren lassen.
- **Keine unerwarteten KI-Anfragen.** Bilder starten niemals selbst KI-Anfragen; wenn Sie ein Bild bearbeiten, während die KI noch arbeitet, wird das laufende Ergebnis verworfen und die Handschrifterkennung automatisch fortgesetzt. Bilder unterstützen Rückgängig/Wiederholen, lokale Schnappschüsse und PNG-Export.

## Neu in Version 0.7.0

- **Interaktives HTML auf der Leinwand.** Das General-HTML-Plugin erstellt Uhren, Rechner, Dashboards und andere Oberflächen als isolierte, interaktive Widgets.
- **Nützliche Daten ohne PenEcho-Datendienst.** Plugins für Wetter, Aktien, Techniknachrichten, Wechselkurse, Erdbeben, Naturereignisse, Weltraumwetter und GitHub rufen deklarierte APIs direkt aus dem Browser auf.
- **Klare Sicherheitsgrenzen.** Das Netzwerk jedes Plugins ist auf eine Positivliste beschränkt, HTML läuft in einem isolierten iframe und deaktivierte Plugins sind weder an Anfragen noch an der Laufzeit beteiligt.
- **Lokale Plugin-Erstellung.** Ein kompaktes Markdown-Format unterstützt KI-Verbesserungen, automatische Titel, Speichern, Aktivieren und Löschen persönlicher Plugins in einer Preview-Oberfläche.
- **Leinwandeigene Speicherung und Exporte.** Bestätigte Widgets erscheinen in Schnappschüssen und PNG-Dateien und unterstützen Verschieben, Umbruch, Skalierung sowie rückgängig machbares Löschen.
- **Sinnvolle Voreinstellungen.** General HTML, Animation scenes und Weather sind für neue Benutzer aktiviert; weitere Daten-Plugins müssen ausdrücklich eingeschaltet werden.

## Frühere Versionen

- **0.6.0 - Animation scenes.** Ergänzte sichere deklarative Canvas2D-Animationen mit Bearbeitung und Schnappschuss-Persistenz, verbessertes Markdown/LaTeX-Rendering, robustere Modellausgaben und nicht blockierende npm-Updateprüfungen.

## Funktionsweise

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/how-it-works-dark.svg"><img alt="Funktionsweise von PenEcho" src="docs/assets/how-it-works-light.svg"></picture></p>

Der Browser sendet nur den relevanten Ausschnitt der Leinwand und dessen Geometrie. Der Server prüft die Anfrage, leitet sie an den gewählten Executor weiter und gibt einen strukturierten, verschiebbaren Entwurf zurück. Aktuelle Modellempfehlungen und Kostenbeispiele stehen in der [englischen README](README.md#recommended-model-configurations).

## Sichere Bereitstellung

- **Codex CLI und Claude CLI:** Nur auf dem lokalen Rechner oder in einem vertrauenswürdigen LAN verwenden. Jede gültige Anfrage startet einen lokalen CLI-Prozess; diese Modi dürfen daher nicht direkt im Internet bereitgestellt werden.
- **API-Modus:** Bei öffentlichem Zugriff sollte PenEcho hinter einem HTTPS-Proxy mit Authentifizierung sowie Begrenzungen für Anfragerate und -größe betrieben werden.
- Veröffentliche keine Konfigurationsdateien, API-Schlüssel, Anfrageprotokolle, Logs oder privaten Leinwandbilder.

## Mitwirken

Führe vor dem Einreichen einer Änderung Folgendes aus:

```bash
npm run check
```

Weitere Informationen findest du in den [Architekturhinweisen](docs/architecture.md) und in [CONTRIBUTING.md](CONTRIBUTING.md). Fragen und Beispiele gehören in [Discord](https://discord.gg/3jrPJ3mXdX) oder [GitHub Discussions](https://github.com/penecho/penecho/discussions), reproduzierbare Fehler in [GitHub Issues](https://github.com/penecho/penecho/issues).

## Lizenz und kommerzielle Nutzung

PenEcho wird unter [GNU AGPL v3.0 only](LICENSE) veröffentlicht. Kommerzielle Nutzung ist erlaubt. Wenn du eine veränderte Version über ein Netzwerk bereitstellst, musst du den Benutzern gemäß AGPL den zugehörigen Quellcode anbieten. Für proprietäre Produkte und gehostete Dienste, die die AGPL nicht erfüllen können, ist eine separate [kommerzielle Lizenz](COMMERCIAL-LICENSE.md) erhältlich. Name und Logo unterliegen zusätzlich der [Markenrichtlinie](TRADEMARKS.md).
