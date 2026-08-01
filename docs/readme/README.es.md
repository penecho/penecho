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

## Novedades de la versión 0.8.1

- **Datos públicos en vivo en widgets de General HTML.** Cuando una API HTTPS pública, un canal RSS o una imagen queda bloqueada por CORS del navegador, el widget puede recurrir al puente local de solo lectura de PenEcho para mostrar noticias, paneles y otros contenidos actualizados sin exponer credenciales.
- **SVG como opción predeterminada para animaciones y gráficos complejos.** Las animaciones y los elementos visuales personalizados complejos ahora priorizan SVG adaptable dentro de General HTML, con movimientos, superposiciones y gráficos escalables más expresivos y una salida del modelo compacta y eficiente en tokens.

## Novedades de la versión 0.8.0

- **Diagramas profesionales más allá de los diagramas de flujo.** Crea diagramas de arquitectura, UML, secuencia, BPMN, datos, ingeniería, ciencia, medicina, finanzas y geografía con código profesional editable. Los formatos compatibles se renderizan localmente bajo demanda; los especializados pueden seguir mostrándose como HTML completo.
- **Valores predeterminados de plugins con un prompt más ligero.** **General HTML** está siempre activado y no se puede desmarcar. **Professional Diagrams** empieza activado y puede desactivarse; todos los demás plugins integrados o privados empiezan desactivados. Las opciones guardadas explícitamente se conservan tras las actualizaciones. Solo se envían al modelo las guías compactas de los plugins activados; el CSS completo y los renderizadores permanecen locales y se cargan bajo demanda.
- **Perfecciona widgets de plugins dibujando sobre ellos.** Usa el lápiz para dibujar o escribir los cambios directamente sobre un widget devuelto por un plugin y pulsa el botón **AI Refine** que aparece para generar una versión mejorada. Este flujo solo se aplica a widgets devueltos por plugins.
- **Almacenamiento en este dispositivo o en el servidor PenEcho.** Guarda el lienzo solo en el navegador actual o en el equipo que ejecuta PenEcho para que otros dispositivos autorizados del mismo servidor puedan abrirlo. Al guardar se confirman primero los controles pendientes.
- **Portapapeles, texto y plugins ampliables.** Inserta texto o imágenes desde el portapapeles del sistema, copia texto, fórmulas y código profesional devueltos por la IA y vuelve a editar cuadros de texto con Hand. También puedes copiar un plugin integrado o privado como plugin personalizado con CSS opcional cargado solo al usarlo.

## Novedades de la versión 0.7.2

- **Fotos reales y diagramas de flujo profesionales integrados.** Real Photo Search muestra imágenes web con su fuente directamente en el lienzo, un resultado de forma predeterminada y una fuente alternativa si falla la principal. Flowchart crea diagramas de procesos, decisiones, arquitectura, secuencia y estados con código Mermaid copiable.
- **Edición, guardado y exportación más fiables.** Hand mueve directamente imágenes, animaciones y widgets devueltos por la IA, y permite redimensionarlos sin un máximo artificial. Guardar actualiza de forma predeterminada la instantánea cargada, Guardar como nuevo sigue disponible y las imágenes remotas se conservan en miniaturas y exportaciones PNG.
- **Acceso local y mejor integración de escritorio.** Un código compartido de seis dígitos puede proteger la entrada desde navegadores locales y de la red sin alterar las solicitudes al modelo después del desbloqueo. La configuración de escritorio admite Kimi API y Kimi CLI, además de API genérica, Codex CLI y Claude CLI, con mejoras en actualizaciones y empaquetado.

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
