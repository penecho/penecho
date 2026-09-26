<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../public/penecho-readme-header-dark.webp">
    <img src="../../public/penecho-readme-header.webp" alt="PenEcho" width="280">
  </picture>
</p>

<h1 align="center">Piensa en un lienzo con cualquier IA.</h1>

<p align="center">Dibuja a mano. El Agent integrado de PenEcho, Codex, Claude Code o cualquier cliente MCP convierte tus ideas en diagramas, documentos y widgets funcionales junto a tus notas.</p>

<p align="center">
  <a href="https://github.com/penecho/penecho/releases/latest"><img src="https://img.shields.io/badge/release-v1.3.5-087f83" alt="Release v1.3.5"></a>
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
  <a href="#quick-start">Inicio rápido</a> ·
  <a href="#connect-your-ai-agent-mcp">Conecta tu agente de IA (MCP)</a> ·
  <a href="../">Documentación</a> ·
  <a href="https://discord.gg/3jrPJ3mXdX">Discord</a>
</p>

<p align="center"><sub><a href="../../README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a> ·
  <a href="README.ru.md">Русский</a> ·
  <strong>Español</strong> ·
  <a href="README.pt-BR.md">Português</a> ·
  <a href="README.fr.md">Français</a> ·
  <a href="README.de.md">Deutsch</a></sub></p>

<p align="center">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_full_demo.webp" alt="PenEcho" width="100%">
</p>
<p align="center"><em>De un boceto a un resultado interactivo en un solo lienzo.</em></p>

## Qué puedes hacer

<table width="100%">
  <tr>
    <td width="33%" valign="top">
      <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins_sub_x10.webp" alt="Dibuja y pregunta" width="100%"><br>
      <strong>Dibuja y pregunta</strong><br>
      Escritura a mano, ecuaciones, texto e imágenes en un lienzo infinito. La IA responde automáticamente cuando haces una pausa.
    </td>
    <td width="33%" valign="top">
      <a href="../assets/professional-diagrams/kubernetes.webp"><img src="../assets/professional-diagrams/previews/kubernetes.webp" alt="Clúster de Kubernetes" width="100%"></a><br>
      <strong>Diagramas profesionales</strong><br>
      Diagramas de arquitectura, secuencia y flujo con diseño automático. Exporta a SVG o PNG.
    </td>
    <td width="33%" valign="top">
      <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/play_patris.webp" alt="Widgets funcionales" width="100%"><br>
      <strong>Widgets funcionales</strong><br>
      Calculadoras, cuestionarios y prototipos que funcionan en el lienzo y se pueden guardar como favoritos o compartir.
    </td>
  </tr>
</table>

<a id="quick-start"></a>
## Inicio rápido

| | Cómo empezar |
| --- | --- |
| **Aplicación de escritorio** | Descarga la versión para macOS o Windows de [GitHub Releases](https://github.com/penecho/penecho/releases/latest). Incluye todo y se actualiza sola. |
| **npm** | Requiere Node.js 22.19 o posterior. Ejecuta `npm i -g penecho`, luego `penecho` y abre `localhost:3888`. |
| **Navegador** | Inicia sesión en [penecho.ai](https://penecho.ai) para usar modelos alojados y lienzos Cloud. No necesitas instalar nada. |

```bash
npm install -g penecho
penecho             # http://localhost:3888
```

> [!TIP]
> Al iniciar por primera vez, elige un código de acceso de seis dígitos o acceso abierto en una red de confianza. En **Ajustes → IA y conexiones**, añade tu clave API, una CLI autenticada de Codex / Claude Code / Kimi o los modelos de PenEcho.

<details>
<summary>Ejecutar desde el código fuente</summary>

```bash
git clone https://github.com/penecho/penecho.git
cd penecho
npm install
npm start
```

</details>

<a id="connect-your-ai-agent-mcp"></a>
## Conecta tu agente de IA (MCP)

Sigue conversando en el agente que ya utilizas. Tu agente dibuja en el lienzo, tú lo anotas y en el siguiente turno lee tus comentarios.

1. En PenEcho, abre **Ajustes → Servicio MCP** y activa el lienzo actual.
2. Usa **Configuración automática** para un cliente compatible o copia las instrucciones generadas en Codex, Claude Code, Kimi, Cursor, etc. Si instalaste npm de forma global, los clientes que admiten JSON `mcpServers` también pueden usar esta configuración compatible:

   ```json
   {
     "mcpServers": {
       "penecho": { "command": "penecho", "args": ["mcp"] }
     }
   }
   ```

3. Pide: *«Muestra la arquitectura que comentamos en mi lienzo de PenEcho».*

<p align="center"><a href="../assets/mcp-spatial-example.webp"><img src="../assets/mcp-spatial-example.webp" alt="Una conversación de arquitectura con IA, con comentarios manuscritos junto al diseño propuesto en un Canvas de PenEcho" width="760"></a></p>
<p align="center"><em>Una conversación de arquitectura en Claude Code, anotada a mano en el lienzo.</em></p>

> [!NOTE]
> Los agentes solo ven los lienzos que activas. Local MCP permanece en tu ordenador; Cloud MCP es una conexión autenticada e independiente para lienzos Cloud. [Guía de MCP →](../mcp-setup.md)

## Galería de diagramas

<table width="100%">
  <tr>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/kubernetes.webp"><img src="../assets/professional-diagrams/previews/kubernetes.webp" alt="Clúster de Kubernetes" width="100%"></a><br><strong>Clúster de Kubernetes</strong></td>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/migration.webp"><img src="../assets/professional-diagrams/previews/migration.webp" alt="Monolito → microservicios" width="100%"></a><br><strong>Monolito → microservicios</strong></td>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/notifications.webp"><img src="../assets/professional-diagrams/previews/notifications.webp" alt="Notificaciones por eventos" width="100%"></a><br><strong>Notificaciones por eventos</strong></td>
  </tr>
  <tr>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/mcp-request.webp"><img src="../assets/professional-diagrams/previews/mcp-request.webp" alt="Cómo llega MCP al lienzo" width="100%"></a><br><strong>Cómo llega MCP al lienzo</strong></td>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/release.webp"><img src="../assets/professional-diagrams/previews/release.webp" alt="Lanzamiento: tareas en paralelo" width="100%"></a><br><strong>Lanzamiento: tareas en paralelo</strong></td>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/rollout.webp"><img src="../assets/professional-diagrams/previews/rollout.webp" alt="Despliegue multirregión" width="100%"></a><br><strong>Despliegue multirregión</strong></td>
  </tr>
</table>

<p align="center"><sub>Haz clic en un diagrama para verlo a tamaño completo.</sub></p>

## Cómo funciona

<p align="center"><img src="../../public/penecho-architecture.webp" alt="Arquitectura de PenEcho: un navegador se conecta a PenEcho Cloud o a tu PC local. Cloud incluye modelos alojados y se conecta a tu dispositivo vinculado. Tu PC ejecuta PenEcho CLI o App con tu API de modelos o tus agentes. Los agentes de IA externos pueden usar Cloud MCP o Local MCP; ambas conexiones son opcionales." width="100%"></p>

- **En tu ordenador** — La aplicación de escritorio o CLI sirve el lienzo y utiliza tu propia API de modelos o Agent CLI.
- **En la nube** — penecho.ai añade modelos alojados, proyectos y favoritos sincronizados, y puede acceder a tu ordenador vinculado.
- **Tu agente** — Se conecta mediante Local o Cloud MCP. Ambas opciones son opcionales.

Detalles: [notas de arquitectura](../architecture.md).

## Elige tu IA

| Conexión | Coste | Ideal para |
| --- | --- | --- |
| **Modelos de PenEcho** — inicia sesión y elige un modelo | Créditos de la cuenta | Empezar sin claves |
| **Tu API de modelos** — OpenAI / Anthropic | Tu proveedor | Control total del modelo y el coste |
| **Tu CLI** — Codex, Claude Code, Kimi | Tu plan | Reutilizar una suscripción existente |

Qué modelo y nivel de esfuerzo elegir: [Modelos recomendados](#recommended-models) (actualizado en cada versión).

<a name="recommended-models"></a>
<details>
<summary>Modelos recomendados</summary>

Estas recomendaciones equilibran la calidad y la latencia en tareas reales del lienzo de PenEcho según pruebas recientes; el tiempo de respuesta varía con el proveedor, la complejidad del lienzo y el razonamiento.

| Modelo | Esfuerzo | Notas | Uso recomendado |
| --- | --- | --- | --- |
| Claude Opus 4.8 / 5.0 (`claude-opus-4-8` / `claude-opus-5-0`) | `medium` | Gran calidad con un mejor equilibrio de latencia | Trabajo cotidiano en el lienzo |
| Claude Opus 4.8 / 5.0 (`claude-opus-4-8` / `claude-opus-5-0`) | `high` | Mayor calidad de razonamiento, esperas más largas y variables | Escritura a mano, matemáticas, diagramas o diseños complejos |
| Fable 5 (`claude-fable-5` o `fable`) | `medium` | A menudo tarda aproximadamente la mitad que `gpt-5.6-sol` con `xhigh` | Uso general rápido y de alta calidad |
| [Kimi K3](https://platform.kimi.ai?aff=penecho) (`kimi-k3`) | `medium` | Muy buena calidad; `medium` mantiene un equilibrio práctico | Configuración predeterminada recomendada para Kimi |
| `gpt-5.6-terra` | `low` a `high` | Sorprendentemente potente y ágil | Objetivos flexibles de calidad y latencia |
| `gpt-5.6-luna` | `xhigh` | Muy buenos resultados en el lienzo con gran velocidad | Prioridad a la calidad sin perder agilidad |
| `gpt-5.6-sol` | `high` | Suficiente para la mayoría de solicitudes, más ágil que `xhigh` | Predeterminado cuando importa la rapidez |
| `gpt-5.6-sol` | `xhigh` | Muy bueno, pero más lento y variable | Tareas difíciles en el lienzo |
| `deepseek-v4-flash-vision-exp` | `medium` | Bueno | Trabajo con visión a través de la API de DeepSeek |
| `glm-5.3-flash` | `medium` | Bueno | Trabajo rápido mediante la API de GLM compatible con Anthropic |

</details>

## Novedades de la versión 1.3.5

- **UI:** pequeñas correcciones en la interfaz.
- **Edición simultánea del lienzo:** Canvas AI, Agent y MCP pueden modificar el mismo lienzo al mismo tiempo.

[Registro completo de cambios →](../../CHANGELOG.md#135)

## Comunidad

| [Discord](https://discord.gg/3jrPJ3mXdX) | [Discussions](https://github.com/penecho/penecho/discussions) | [Issues](https://github.com/penecho/penecho/issues) | [Contributing](../../CONTRIBUTING.md) |
| --- | --- | --- | --- |
| Habla con el equipo | Ideas y preguntas | Informa de un error | Ejecuta primero `npm run check` |

Se distribuye bajo la licencia [AGPL-3.0-only](../../LICENSE); también hay una [licencia comercial](../../COMMERCIAL-LICENSE.md). Consulta la [política de marcas](../../TRADEMARKS.md) y el [acuerdo de contribución](../../CONTRIBUTOR-LICENSE-AGREEMENT.md).

Los renderizadores de diagramas adaptan funciones auxiliares de SVG y geometría de [Archify](https://github.com/tt-a1i/archify) de tt-a1i (MIT). Consulta [NOTICE](../../NOTICE).

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
