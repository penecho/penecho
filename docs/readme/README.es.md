<h1 align="center">
  <img src="../../public/penecho-readme-header.png" alt="PenEcho" width="760">
</h1>

<p align="center">
  <a href="../../README.md">English</a> |
  <a href="README.zh-CN.md">简体中文</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.ru.md">Русский</a> |
  <strong>Español</strong> |
  <a href="README.pt-BR.md">Português (Brasil)</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.de.md">Deutsch</a>
</p>

<h1 align="center">Un espacio de trabajo espacial<br>para pensar con IA.</h1>
<p align="center">Dibuja, explora y crea con el Agente integrado o tu propio asistente compatible con MCP.</p>
<p align="center">
  <img src="https://img.shields.io/badge/version-1.3.1-087f83" alt="Version 1.3.1">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="AGPL-3.0-only"></a>
</p>
<p align="center">
  <a href="https://penecho.ai">Sitio web</a> ·
  <a href="https://github.com/penecho/penecho/releases/latest">Descargar</a> ·
  <a href="#inicio-rápido">Inicio rápido</a> ·
  <a href="../mcp-setup.md">Guía MCP</a> ·
  <a href="https://discord.gg/3jrPJ3mXdX">Discord</a>
</p>

<p align="center">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_full_demo.webp" alt="Demostración completa de PenEcho" width="49%">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins.webp" alt="Demostración de diagramas profesionales de PenEcho" width="49%">
</p>

<p align="center">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins_sub_x10.webp" alt="Demostración de extensiones de PenEcho" width="49%">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/play_patris.webp" alt="Demostración del lienzo interactivo de PenEcho" width="49%">
</p>

<p align="center">
  <a href="https://www.kimi.com/code?aff=penecho">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="../assets/kimi-open-source-friends-dark.svg">
      <img src="../assets/kimi-open-source-friends-light.svg" alt="Kimi Open Source Friends" width="326" height="56">
    </picture>
  </a>
</p>

## Una extensión espacial de tu conversación con la IA

Sigue conversando con **Codex, Claude, Kimi u otros agentes de IA**. Deja que PenEcho le dé un lugar a tu trabajo.

A través de MCP, tu IA puede convertir explicaciones en diagramas e ideas en vistas previas interactivas. Mantén las referencias, el razonamiento y el trabajo uno al lado del otro; después, anota el lienzo para incorporar tus comentarios a la siguiente ronda.

| Continúa la conversación | Mira cómo toma forma el trabajo | Devuelve tus comentarios |
| --- | --- | --- |
| Trabaja con el agente de IA que ya utilizas. | El servidor MCP de PenEcho lleva diagramas, documentos y vistas previas interactivas al Canvas. | Prueba el resultado, anótalo y deja que tu agente lea tus comentarios para la siguiente revisión. |

<p align="center">
  <a href="../assets/mcp-spatial-example.png">
    <img src="../assets/mcp-spatial-example.png" alt="Una conversación de arquitectura con IA, con comentarios manuscritos junto al diseño propuesto en un Canvas de PenEcho" width="760">
  </a>
</p>
<p align="center"><em>Una conversación de arquitectura, anotada a mano en el Canvas.</em></p>

**Míralo antes de que esté terminado.** Observa cómo toma forma el trabajo mientras hablas con la IA. Pruébalo, aporta comentarios y haz avanzar tu proyecto en colaboración.

[Conecta tu agente con MCP →](#conecta-tu-agente-con-mcp)

## Qué puedes hacer

- **Trabaja visualmente.** Combina escritura a mano, ecuaciones, texto, imágenes, diagramas y Widgets HTML interactivos en un lienzo amplio.
- **Crea con IA.** Usa el Agente integrado para investigar, trabajar con archivos, explicar ideas y crear resultados visuales editables.
- **Usa tu propio agente.** Conecta Codex, Claude Code u otro cliente compatible con MCP para leer y editar un Canvas habilitado explícitamente.
- **Conserva y comparte tu trabajo.** Organiza los Canvas en proyectos, guarda revisiones en Cloud, sincroniza favoritos y publica a través de Echoes.

## Novedades de la versión 1.3.0

| Actualización | Qué aporta |
| --- | --- |
| **Espacio de trabajo MCP** | Descubrimiento de Canvas, capturas, edición de objetos, Widgets interactivos, archivos fuente virtuales y comentarios del usuario para agentes externos. Admite navegadores locales, de red local y de Cloud mediante dispositivos vinculados, con activación explícita. |
| **Cloud MCP** | Conecta agentes de IA externos directamente a tus Canvas de PenEcho Cloud habilitados para leer contenido, crear y editar resultados y seguir tus comentarios manuscritos. Cloud MCP y Local MCP son vías de conexión opcionales. |
| **API PenEcho Cloud Credits** | Usa modelos alojados por PenEcho con créditos de tu cuenta, junto con tus propias conexiones API y CLI. Consulta los modelos disponibles, las tarifas y el saldo en Ajustes. |
| **Gestión de conexiones** | Guarda varias conexiones de IA y elige la conexión activa para cada cliente. |
| **Canvas y entorno de trabajo** | Dibujo y navegación más ágiles, controles de Studio refinados, un panel de Agente adaptable y atajos de teclado personalizables. |

## Cómo funciona

<p align="center">
  <img src="../../public/penecho-architecture.webp" alt="Arquitectura de PenEcho: un navegador se conecta a PenEcho Cloud o a tu PC local. Cloud incluye modelos alojados y se conecta a tu dispositivo vinculado. Tu PC ejecuta PenEcho CLI o App con tu API de modelos o tus agentes. Los agentes de IA externos pueden usar Cloud MCP o Local MCP; ambas conexiones son opcionales." width="1483">
</p>

Abre PenEcho en un navegador a través de PenEcho Cloud o de tu PC local con la CLI o la aplicación de escritorio en ejecución. Cloud ofrece modelos alojados y puede conectarse a tu dispositivo vinculado; tu PC puede usar tu propia API de modelos o tus agentes. Los agentes de IA externos, como Codex y Claude, pueden conectarse mediante Cloud MCP o Local MCP. Ambas conexiones MCP son opcionales.

Consulta las [notas de arquitectura](../architecture.md) para conocer los detalles de implementación.

## Inicio rápido

**Escritorio:** descarga la aplicación para Windows o macOS desde [GitHub Releases](https://github.com/penecho/penecho/releases/latest).

**npm:** requiere Node.js **22.19 o posterior**.

```bash
npm install -g penecho
penecho
```

Abre `http://localhost:3888`. Añade tu propia API de modelos o una CLI de Codex, Claude Code o Kimi autenticada en **Ajustes → Conexiones**. Las conexiones se guardan en `~/.penecho/connections.json`; los ajustes generales permanecen en `~/.penecho/config.env`. Para los modelos alojados por PenEcho, inicia sesión y selecciona un modelo disponible en Ajustes.

Al iniciar, establece un código de acceso de seis dígitos o habilita explícitamente el acceso abierto en tu red de confianza. El inicio también muestra las direcciones de la red local para otros dispositivos.

<details>
<summary>Ejecutar desde el código fuente</summary>

```bash
git clone https://github.com/penecho/penecho.git
cd penecho
npm install
npm start
```

</details>

## Conecta tu agente con MCP

Para **Local MCP**:

1. Inicia PenEcho y habilita el Canvas actual en **Ajustes → Servicio MCP**.
2. Usa Ajustes para configurar un cliente local compatible o copiar su configuración de inicio generada. Con una instalación global de npm, los clientes que aceptan JSON `mcpServers` pueden usar:

   ```json
   {
     "mcpServers": {
       "penecho": { "command": "penecho", "args": ["mcp"] }
     }
   }
   ```

3. Pide a tu agente: **«Muestra la arquitectura que comentamos en mi Canvas de PenEcho».**

El agente puede capturar contenido relevante, editar objetos, crear resultados visuales, modificar archivos fuente de documentos y recibir tus comentarios. Solo se pueden descubrir los Canvas habilitados y conectados. Con Local MCP, el cliente MCP se ejecuta en el host de PenEcho; la compatibilidad con navegadores de red local y de dispositivos vinculados no expone públicamente el punto de acceso MCP local. Cloud MCP es una conexión HTTPS autenticada independiente para tus Canvas habilitados de PenEcho Cloud.

Las instalaciones de escritorio deben usar la configuración generada, que incluye el entorno de ejecución integrado correcto. Consulta la [configuración de MCP](../mcp-setup.md) y la [habilidad de flujo de trabajo para agentes](../../skills/penecho-mcp/SKILL.md), opcional.

## PenEcho Cloud y conexiones de IA

[PenEcho Cloud](https://penecho.ai) añade proyectos privados con historial de versiones, favoritos sincronizados, publicación mediante Echoes y acceso remoto a un ordenador vinculado.

| Conexión | Cómo funciona |
| --- | --- |
| **Modelos de PenEcho** | Inicia sesión, selecciona un modelo alojado disponible y usa los créditos de tu cuenta. Ajustes muestra las tarifas y el saldo actuales. |
| **Tu API de modelos** | Configura un punto de acceso compatible con OpenAI o Anthropic, un modelo y una clave API. Tu proveedor gestiona el consumo. |
| **Tu CLI** | Usa una CLI de Codex, Claude Code o Kimi instalada y autenticada localmente. La disponibilidad y el uso dependen del plan de ese proveedor. |

Los modelos alojados usados en tu ordenador requieren iniciar sesión en Cloud, sin emparejar el dispositivo ni una clave independiente de la API Credits. Cloud MCP puede acceder directamente a los Canvas de Cloud habilitados. Para acceder a través de Cloud a un Canvas alojado en tu ordenador, el dispositivo vinculado debe estar en línea y disponer del soporte de relé necesario.

Tus propias conexiones API y CLI no consumen créditos de PenEcho. La cuenta de Cloud es opcional para el uso local con tu propia conexión. Las funciones de IA requieren acceso al proveedor seleccionado; ejecutar PenEcho localmente no permite usar sin conexión un modelo remoto.

## Configuraciones de modelos recomendadas

Estas recomendaciones equilibran la calidad de respuesta y la latencia de las tareas reales del lienzo de PenEcho, según pruebas prácticas actuales; el tiempo de respuesta real varía según el proveedor, la complejidad del lienzo y el comportamiento de razonamiento.

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

## Comunidad y licencia

Lee [CONTRIBUTING.md](../../CONTRIBUTING.md) para contribuir; ejecuta `npm run check` antes de abrir una pull request. Informa de errores en [Issues](https://github.com/penecho/penecho/issues), comenta ideas en [Discussions](https://github.com/penecho/penecho/discussions) o únete a [Discord](https://discord.gg/3jrPJ3mXdX).

Bajo licencia [AGPL-3.0-only](../../LICENSE). Hay una [licencia comercial](../../COMMERCIAL-LICENSE.md) alternativa disponible. Consulta la [política de marcas](../../TRADEMARKS.md) y el [acuerdo de contribución](../../CONTRIBUTOR-LICENSE-AGREEMENT.md).
