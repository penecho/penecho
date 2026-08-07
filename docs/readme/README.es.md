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

<p align="center"><strong>Piensa con IA más allá del chat.</strong></p>

<p align="center">PenEcho es un lienzo compartido donde la escritura a mano, las ecuaciones, los diagramas y el contexto espacial forman parte de la conversación.</p>

<p align="center">
  <a href="https://discord.gg/3jrPJ3mXdX"><img src="https://img.shields.io/badge/Discord-Únete%20a%20la%20comunidad-5865F2?style=for-the-badge&amp;logo=discord&amp;logoColor=white" alt="Únete al Discord de PenEcho"></a>
  <a href="https://github.com/penecho/penecho/stargazers"><img src="https://img.shields.io/github/stars/penecho/penecho?style=for-the-badge&amp;logo=github&amp;logoColor=white&amp;color=f5b301" alt="Da una estrella a PenEcho en GitHub"></a>
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/License-AGPL%20v3-blue?style=for-the-badge" alt="Licencia: AGPL v3"></a>
</p>

> Esta traducción ofrece una visión general del proyecto. El [README en inglés](../../README.md) es la fuente canónica para la información técnica más reciente y completa.

<p align="center"><img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins.webp" alt="Demostración de diagramas profesionales de PenEcho" width="49%"> <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_full_demo.webp" alt="Demostración completa de PenEcho" width="49%"></p>

<p align="center"><img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins_sub_x10.webp" alt="Demostración de plugins de PenEcho" width="49%"> <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/play_patris.webp" alt="Demostración interactiva del lienzo de PenEcho" width="49%"></p>

## Kimi Open Source Friends

PenEcho es miembro oficial de **Kimi Open Source Friends**, el programa de [Moonshot AI](https://www.kimi.com/) que apoya proyectos destacados de código abierto. El equipo de Kimi contribuye con créditos de API, y Kimi K3 es uno de los modelos recomendados para trabajo exigente con escritura y diagramas.

- [Kimi Code](https://www.kimi.com/code?aff=penecho) - suscripción de programación disponible en todo el mundo
- [Kimi Open Platform, China](https://platform.kimi.com?aff=penecho) - acceso a la API desde China continental
- [Kimi Open Platform, global](https://platform.kimi.ai?aff=penecho) - acceso a la API desde el resto del mundo

## Inicio rápido

### Aplicación de escritorio

[Descargar desde GitHub Releases](https://github.com/penecho/penecho/releases/latest).

Para instalar mediante npm, necesitas [Node.js 20.3 o posterior](https://nodejs.org/) y una de estas opciones: una clave de API, un [Codex CLI](https://developers.openai.com/codex/cli) autenticado o un [Claude Code CLI](https://code.claude.com/docs/en/overview) autenticado.

```bash
npm install -g penecho
penecho configure
penecho
```

Abre [http://localhost:3888](http://localhost:3888). `penecho configure` permite seleccionar de forma interactiva la fuente LLM, el modelo, el nivel de razonamiento, el tiempo de espera, el formato de imagen y la interfaz de red. La configuración se guarda por defecto en `~/.penecho/config.env`; las credenciales de API nunca se envían al navegador.

Para ejecutar el código fuente:

```bash
git clone https://github.com/penecho/penecho.git
cd penecho
npm install
npm start
```

## Piensa sobre el lienzo

Escribe una pregunta, ecuación, diagrama o idea incompleta en cualquier lugar del lienzo y haz una pausa. PenEcho interpreta los trazos y sus relaciones espaciales y coloca la respuesta junto a ellos.

- Dibuja con lápiz o ratón y desplázate por un lienzo de `20 000 x 20 000`.
- Obtén respuestas, pistas, explicaciones, fórmulas, gráficas y diagramas directamente sobre el lienzo.
- Mueve y redimensiona borradores de IA; acéptalos o descártalos antes de incorporarlos al trabajo.
- Selecciona tinta con el lazo para moverla, escalarla, cambiar su color, eliminarla o pasarla por Typeset.
- Guarda instantáneas en este dispositivo o en el servidor PenEcho y exporta el contenido confirmado como PNG.
- Elige entre los temas Arcane, Sci-fi, Research y Studio.

## Novedades de la versión 0.9.0

- **Varias conexiones de IA con cambio en un clic.** Guarda hasta diez conexiones API o CLI, usa preajustes editables de Kimi y MiniMax, pruébalas en el lienzo y elige una conexión activa distinta en cada cliente del mismo host PenEcho. Los cambios se aplican al instante.
- **Refine más rápido y flexible.** Escribe instrucciones en cualquier lugar del área visible y elige el widget que quieres modificar. Los diffs unificados estándar envían solo los cambios, reduciendo tokens y tiempo sin perder la confirmación ni Deshacer.
- **Streaming real de API.** Las API compatibles con OpenAI y Anthropic ahora usan SSE de extremo a extremo para mostrar enseguida la recepción y mejorar la estabilidad de solicitudes largas a través de gateways compatibles.
- **Progreso y cancelación claros.** El estado superior muestra preparación, conexión, espera, recepción, validación, reintentos y tiempos de espera. Durante una solicitud, el botón mágico detiene inmediatamente el trabajo activo.

## Novedades anteriores

- **0.8.1.** Añadió datos públicos en vivo para General HTML y SVG como opción predeterminada para animaciones y gráficos complejos.
- **0.8.0 y 0.7.2.** Añadieron diagramas profesionales editables, almacenamiento en servidor, flujos de portapapeles, fotos web con fuente y edición y exportación más fiables.

## Versiones anteriores

- **0.7.1.** Añadió imágenes y fotos locales, edición de objetos con Hand, instantáneas, exportación PNG, diagramas Mermaid copiables e imágenes web con fuente.
- **0.7.0.** Introdujo HTML interactivo aislado, plugins de datos en vivo, creación local de plugins y persistencia de widgets.
- **0.6.0 y anteriores.** Añadió animaciones declarativas, mejoras de Markdown/LaTeX, herramientas de selección y la base del gran lienzo disperso.

## Cómo funciona

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="../assets/how-it-works-dark.svg"><img alt="Cómo funciona PenEcho" src="../assets/how-it-works-light.svg"></picture></p>

El navegador solo envía el recorte pertinente del lienzo y su geometría. El servidor valida la solicitud, la dirige al ejecutor elegido y devuelve un borrador estructurado y móvil. Las recomendaciones actuales de modelos y los ejemplos de costes están en el [README en inglés](../../README.md#recommended-model-configurations).

## Despliegue seguro

- **Codex CLI y Claude CLI:** úsalos solo en el equipo local o en una red de confianza. Cada solicitud válida inicia un proceso CLI local, por lo que estos modos no deben exponerse directamente a Internet.
- **Modo API:** si lo publicas, sitúa PenEcho detrás de un proxy HTTPS con autenticación y límites de frecuencia y tamaño de solicitud.
- No publiques archivos de configuración, claves de API, trazas de solicitudes, registros ni imágenes privadas del lienzo.

## Colabora con el proyecto

Antes de enviar un cambio, ejecuta:

```bash
npm run check
```

Consulta las [notas de arquitectura](../architecture.md) y [CONTRIBUTING.md](../../CONTRIBUTING.md). Comparte preguntas y ejemplos en [Discord](https://discord.gg/3jrPJ3mXdX) o [GitHub Discussions](https://github.com/penecho/penecho/discussions), y comunica errores reproducibles en [GitHub Issues](https://github.com/penecho/penecho/issues).

## Licencia y uso comercial

PenEcho se publica bajo [GNU AGPL v3.0 only](../../LICENSE). Se permite el uso comercial, pero si ofreces una versión modificada a usuarios a través de una red, debes proporcionarles el código fuente correspondiente según la AGPL. Existe una [licencia comercial](../../COMMERCIAL-LICENSE.md) para productos propietarios y servicios alojados que no puedan cumplir la AGPL. El nombre y el logotipo están sujetos a la [política de marcas](../../TRADEMARKS.md).
