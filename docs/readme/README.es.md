<p align="center">
  <a href="https://penecho.ai/lines.html">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="../assets/penecho-lines-logo-dark.svg">
      <img src="../assets/penecho-lines-logo.svg" alt="PenEcho Lines" width="340">
    </picture>
  </a>
</p>

<h3 align="center">No es otro agente de IA. Es una mejor forma de trabajar con los tuyos.</h3>

<p align="center">
  Dibuja lo que quieres decir, sigue cada tarea como una línea y deja que un agente revise el trabajo de otro.<br>
  Funciona con los agentes que ya usas. Código abierto, gratis en tu ordenador, sin necesidad de cuenta.
</p>

<p align="center">
  <a href="https://penecho.ai">Sitio web</a> &nbsp;·&nbsp;
  <a href="#install">Descargar</a> &nbsp;·&nbsp;
  <a href="https://penecho.ai/try.html">Probar en el navegador</a> &nbsp;·&nbsp;
  <a href="https://penecho.ai/leaderboard">Clasificación de agentes</a> &nbsp;·&nbsp;
  <a href="https://discord.gg/3jrPJ3mXdX">Discord</a> &nbsp;·&nbsp;
  <a href="https://buymeacoffee.com/penecho">Invítame a un café</a>
</p>

<p align="center">
  <sub>
    <a href="../../README.md">English</a> ·
    <a href="README.zh-CN.md">简体中文</a> ·
    <a href="README.ja.md">日本語</a> ·
    <a href="README.ko.md">한국어</a> ·
    <a href="README.ru.md">Русский</a> ·
    <strong>Español</strong> ·
    <a href="README.pt-BR.md">Português</a> ·
    <a href="README.fr.md">Français</a> ·
    <a href="README.de.md">Deutsch</a>
  </sub>
</p>

---

<a name="quick-start"></a>
<a name="install"></a>

## Instalar

<a href="https://github.com/penecho/penecho/releases/latest"><img src="https://img.shields.io/badge/release-v1.5.0-2563eb" alt="Release v1.5.0"></a>
<img src="https://img.shields.io/badge/macOS%20·%20Windows%20·%20Linux-64748b" alt="macOS, Windows, Linux">
<a href="../../LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-64748b" alt="AGPL-3.0"></a>

| | |
| :--- | :--- |
| **App de escritorio** | Descarga para macOS o Windows desde [penecho.ai](https://penecho.ai/downloads.html). |
| **npm** | `npm install -g penecho` y luego `penecho` (Node.js 22.19 o superior). |
| **Navegador** | Abre [penecho.ai](https://penecho.ai). Sin instalar nada. |

Elige un código de acceso, abre una carpeta de proyecto y añade tus agentes en **Ajustes → Agents**. Usa los planes de agentes que ya pagas, tu propia clave de API o los modelos de PenEcho.

Novedades en 1.5.0: Lines, revisión en un clic, Orchestrator con puntuaciones reales, ahorro de tokens demostrado y Canvas compartido en directo. Consulta el [registro de cambios](../../CHANGELOG.md#150).

### Ejecutar desde el código fuente

Necesitas Git y Node.js 22.19 o superior. Las páginas compiladas ya forman parte del repositorio, así que no hay paso de compilación.

```bash
git clone https://github.com/penecho/penecho.git
cd penecho
npm install
npm start        # PenEcho se abre en http://localhost:3888
```

Para la app de escritorio desde el código fuente, ejecuta `npm run desktop:deps` una vez y luego `npm run desktop`. `npm run check` ejecuta todas las comprobaciones y pruebas.

---

## Míralo en 3 minutos

Un trabajo real de principio a fin: un agente construye, otro revisa, las correcciones vuelven atrás y tú tomas la última decisión.

<p align="center">
  <a href="https://penecho.ai/lines.html#film">
    <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_lines.gif" alt="Vídeo de PenEcho Lines: rodea una captura, elige un agente, revisión en un clic, enviar correcciones, listo 5 de 5, el Orchestrator elige agentes según su historial" width="100%">
  </a>
</p>
<p align="center"><a href="https://penecho.ai/lines.html#film">▶ Ver el vídeo completo</a></p>

<p align="center">
  <img src="../assets/penecho-lines-architecture.svg" alt="Cómo llega un trabajo a tus agentes: PenEcho envía una tarea directa a un agente o una tarea del Orchestrator dividida en partes para varios agentes. Los agentes trabajan en la carpeta del proyecto y comparten el mismo registro Markdown: MEMORY.md, lines y works." width="880">
</p>

Envía un trabajo directamente a un agente o pásaselo al Orchestrator, que lo divide y elige un agente para cada parte. Todos los agentes trabajan en tu carpeta y mantienen el mismo registro en Markdown plano.

---

## Qué obtienes

<table width="100%">
  <tr>
    <td width="50%" valign="top">
      <strong>Agentes colaborando en una tarea</strong><br>
      Un agente construye, otro revisa en un clic y <em>Send fixes</em> devuelve los hallazgos en la misma Line.
    </td>
    <td width="50%" valign="top">
      <strong>Ahorro de tokens demostrado</strong><br>
      Continúa o empieza de cero según lo que cueste menos, y muestra cuánto ahorró cada tarea.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>Un Orchestrator que aprende</strong><br>
      Divide trabajos grandes, elige agentes por su historial real y puntúa cada resultado para afinar sus decisiones.
    </td>
    <td width="50%" valign="top">
      <strong>Todos tus agentes, sincronizados</strong><br>
      Las sesiones de Claude Code, Codex, Kimi, OpenCode y más se sincronizan. Continúa cualquiera con cualquier agente.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>Cientos de tareas en una pantalla</strong><br>
      Ask, En marcha, Te necesita, Para revisar, Hecho. Ve de un vistazo qué está esperando por ti.
    </td>
    <td width="50%" valign="top">
      <strong>Dibuja lo que quieres decir</strong><br>
      Rodea una captura, boceta un prototipo, crea diagramas y diapositivas. Los agentes ven tus trazos junto con tus palabras.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>Markdown plano que es tuyo</strong><br>
      Cada Line es un archivo Markdown en tu carpeta, con un único <code>MEMORY.md</code> para el proyecto. Léelo donde quieras.
    </td>
    <td width="50%" valign="top">
      <strong>Comparte con un enlace</strong><br>
      Comparte un proyecto o un Canvas con un enlace. Tu equipo lo abre en el navegador para revisar y dibujar notas.
    </td>
  </tr>
</table>

Funciona con Claude Code, Codex, OpenCode, Antigravity, Kimi, Pi, DeepSeek Harness, omp y el ejecutor integrado de PenEcho.

---

## Canvas AI

Escribe, boceta o rodea algo, y la respuesta aparece justo donde dibujaste.

<p align="center">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_full_demo.webp" alt="Ecuaciones, problemas de física, bocetos y un laberinto resueltos en un PenEcho Canvas" width="720">
</p>
<p align="center"><sub><strong>Dibuja y pregunta</strong> — escritura a mano, ecuaciones, dibujos y laberintos.</sub></p>

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

PenEcho forma parte de Kimi Open Source Friends. Kimi Code funciona en PenEcho como cualquier otro agente: añádelo en **Ajustes → Agents** o [consigue Kimi Code](https://www.kimi.com/code?aff=penecho).

---

<a name="support-penecho"></a>
<a name="buy-us-a-coffee"></a>

## Más

- **Comunidad:** [Sitio web](https://penecho.ai) · [Clasificación](https://penecho.ai/leaderboard) · [Discord](https://discord.gg/3jrPJ3mXdX) · [Discussions](https://github.com/penecho/penecho/discussions) · [Issues](https://github.com/penecho/penecho/issues) · [Contribuir](../../CONTRIBUTING.md)
- **Apoyo:** si PenEcho te ahorró una tarde, [invítanos a un café](https://buymeacoffee.com/penecho) o [patrocina en GitHub](https://github.com/sponsors/penecho). Una estrella o un buen informe de error ayuda igual.
- **Documentación:** [Arquitectura](../architecture.md) · [Project Lines](../project-lines.md) · [Configuración MCP](../mcp-setup.md) · [Registro de cambios](../../CHANGELOG.md)
- **Licencia:** [AGPL-3.0-only](../../LICENSE), con [licencia comercial](../../COMMERCIAL-LICENSE.md) disponible. Consulta la [política de marcas](../../TRADEMARKS.md) y el [CLA](../../CONTRIBUTOR-LICENSE-AGREEMENT.md). Los renderizadores de diagramas adaptan código de [Archify](https://github.com/tt-a1i/archify) de tt-a1i (MIT); consulta [NOTICE](../../NOTICE).

<details>
<summary><strong>Historial de estrellas</strong></summary>
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
