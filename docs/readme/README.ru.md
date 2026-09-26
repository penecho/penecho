<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../public/penecho-readme-header-dark.webp">
    <img src="../../public/penecho-readme-header.webp" alt="PenEcho" width="280">
  </picture>
</p>

<h1 align="center">Думайте на холсте вместе с любым ИИ.</h1>

<p align="center">Рисуйте от руки. Встроенный агент PenEcho, Codex, Claude Code или любой MCP-клиент создаст рядом с заметками схемы, документы и работающие виджеты.</p>

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
  <a href="#quick-start">Быстрый старт</a> ·
  <a href="#connect-your-ai-agent-mcp">Подключение ИИ-агента (MCP)</a> ·
  <a href="../">Документация</a> ·
  <a href="https://discord.gg/3jrPJ3mXdX">Discord</a>
</p>

<p align="center"><sub><a href="../../README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a> ·
  <strong>Русский</strong> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.pt-BR.md">Português</a> ·
  <a href="README.fr.md">Français</a> ·
  <a href="README.de.md">Deutsch</a></sub></p>

<p align="center">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_full_demo.webp" alt="PenEcho" width="100%">
</p>
<p align="center"><em>От наброска до интерактивного результата на одном холсте.</em></p>

## Возможности

<table width="100%">
  <tr>
    <td width="33%" valign="top">
      <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins_sub_x10.webp" alt="Нарисуйте и спросите" width="100%"><br>
      <strong>Нарисуйте и спросите</strong><br>
      Рукописные заметки, формулы, текст и изображения на бесконечном холсте. ИИ автоматически отвечает, когда вы делаете паузу.
    </td>
    <td width="33%" valign="top">
      <a href="../assets/professional-diagrams/kubernetes.webp"><img src="../assets/professional-diagrams/previews/kubernetes.webp" alt="Кластер Kubernetes" width="100%"></a><br>
      <strong>Профессиональные схемы</strong><br>
      Архитектурные схемы, диаграммы последовательностей и процессов с автоматической компоновкой. Экспорт в SVG или PNG.
    </td>
    <td width="33%" valign="top">
      <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/play_patris.webp" alt="Работающие виджеты" width="100%"><br>
      <strong>Работающие виджеты</strong><br>
      Калькуляторы, викторины и прототипы работают прямо на холсте; их можно добавить в избранное или поделиться ими.
    </td>
  </tr>
</table>

<a id="quick-start"></a>
## Быстрый старт

| | Как начать |
| --- | --- |
| **Приложение** | Версии для macOS и Windows доступны в [GitHub Releases](https://github.com/penecho/penecho/releases/latest). Всё необходимое включено, обновления автоматические. |
| **npm** | Требуется Node.js 22.19 или новее. Выполните `npm i -g penecho`, затем `penecho` и откройте `localhost:3888`. |
| **Браузер** | Войдите на [penecho.ai](https://penecho.ai) для доступа к облачным моделям и холстам. Установка не нужна. |

```bash
npm install -g penecho
penecho             # http://localhost:3888
```

> [!TIP]
> При первом запуске задайте шестизначный код доступа или разрешите открытый доступ в доверенной сети. В **Настройки → ИИ и подключения** добавьте свой API-ключ, авторизованный CLI Codex / Claude Code / Kimi либо модели PenEcho.

<details>
<summary>Запуск из исходного кода</summary>

```bash
git clone https://github.com/penecho/penecho.git
cd penecho
npm install
npm start
```

</details>

<a id="connect-your-ai-agent-mcp"></a>
## Подключение ИИ-агента (MCP)

Продолжайте общаться в привычном агенте. Он рисует на холсте, вы оставляете пометки, а в следующем ходе он читает ваши замечания.

1. В PenEcho откройте **Настройки → Служба MCP** и включите текущий холст.
2. Для поддерживаемого клиента используйте **Автонастройку** или скопируйте созданную инструкцию в Codex, Claude Code, Kimi, Cursor и т. д. При глобальной установке npm клиенты с поддержкой JSON `mcpServers` могут использовать следующую совместимую конфигурацию:

   ```json
   {
     "mcpServers": {
       "penecho": { "command": "penecho", "args": ["mcp"] }
     }
   }
   ```

3. Попросите: *«Покажи обсуждённую архитектуру на моём холсте PenEcho».*

<p align="center"><a href="../assets/mcp-spatial-example.webp"><img src="../assets/mcp-spatial-example.webp" alt="Обсуждение архитектуры с ИИ: рукописные комментарии рядом с предложенным решением на PenEcho Canvas" width="760"></a></p>
<p align="center"><em>Обсуждение архитектуры в Claude Code с рукописными пометками на холсте.</em></p>

> [!NOTE]
> Агент видит только включённые вами холсты. Local MCP остаётся на вашем компьютере; Cloud MCP — отдельное авторизованное подключение к облачным холстам. [Руководство по MCP →](../mcp-setup.md)

## Галерея схем

<table width="100%">
  <tr>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/kubernetes.webp"><img src="../assets/professional-diagrams/previews/kubernetes.webp" alt="Кластер Kubernetes" width="100%"></a><br><strong>Кластер Kubernetes</strong></td>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/migration.webp"><img src="../assets/professional-diagrams/previews/migration.webp" alt="Монолит → микросервисы" width="100%"></a><br><strong>Монолит → микросервисы</strong></td>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/notifications.webp"><img src="../assets/professional-diagrams/previews/notifications.webp" alt="Уведомления на основе событий" width="100%"></a><br><strong>Уведомления на основе событий</strong></td>
  </tr>
  <tr>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/mcp-request.webp"><img src="../assets/professional-diagrams/previews/mcp-request.webp" alt="Как MCP обращается к холсту" width="100%"></a><br><strong>Как MCP обращается к холсту</strong></td>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/release.webp"><img src="../assets/professional-diagrams/previews/release.webp" alt="Релиз: параллельные задачи" width="100%"></a><br><strong>Релиз: параллельные задачи</strong></td>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/rollout.webp"><img src="../assets/professional-diagrams/previews/rollout.webp" alt="Развёртывание в нескольких регионах" width="100%"></a><br><strong>Развёртывание в нескольких регионах</strong></td>
  </tr>
</table>

<p align="center"><sub>Нажмите на схему, чтобы открыть её в полном размере.</sub></p>

## Как это работает

<p align="center"><img src="../../public/penecho-architecture.webp" alt="Архитектура PenEcho: браузер подключается к PenEcho Cloud или локальному ПК. Cloud предоставляет размещённые модели и подключение к привязанному устройству. На ПК работают PenEcho CLI или приложение с вашим LLM API или агентами. Внешние ИИ-агенты могут использовать Cloud MCP или Local MCP; оба подключения необязательны." width="100%"></p>

- **На компьютере** — Приложение или CLI предоставляет холст и использует ваш API модели либо Agent CLI.
- **В облаке** — penecho.ai добавляет облачные модели, синхронизацию проектов и избранного, а также доступ к связанному компьютеру.
- **Ваш агент** — Подключается через Local или Cloud MCP. Оба варианта необязательны.

Подробности: [описание архитектуры](../architecture.md).

## Выберите свой ИИ

| Подключение | Оплата | Для чего подходит |
| --- | --- | --- |
| **Модели PenEcho** — вход и выбор модели | Кредиты аккаунта | Быстрый старт без ключей |
| **Собственный API модели** — OpenAI / Anthropic | Оплата провайдеру | Контроль модели и расходов |
| **Собственный CLI** — Codex, Claude Code, Kimi | Ваш тариф | Использование существующей подписки |

Как выбрать модель и уровень усилий: [Рекомендуемые модели](#recommended-models) (обновляется с каждым релизом).

<a name="recommended-models"></a>
<details>
<summary>Рекомендуемые модели</summary>

Рекомендации основаны на актуальных практических испытаниях задач PenEcho и учитывают качество ответа и задержку. Реальное время ответа зависит от провайдера, сложности холста и особенностей рассуждения.

| Модель | Уровень рассуждения | Примечания | Рекомендуемое применение |
| --- | --- | --- | --- |
| Claude Opus 4.8 / 5.0 (`claude-opus-4-8` / `claude-opus-5-0`) | `medium` | Высокое качество при хорошем балансе задержки | Повседневная работа с холстом |
| Claude Opus 4.8 / 5.0 (`claude-opus-4-8` / `claude-opus-5-0`) | `high` | Более качественное рассуждение, более долгое и менее предсказуемое ожидание | Сложные рукописные записи, математика, схемы и компоновка |
| Fable 5 (`claude-fable-5` или `fable`) | `medium` | Часто отвечает примерно вдвое быстрее, чем `gpt-5.6-sol` с `xhigh` | Быстрая и качественная универсальная работа |
| [Kimi K3](https://platform.kimi.ai?aff=penecho) (`kimi-k3`) | `medium` | Очень хорошее качество; `medium` сохраняет практичный баланс | Рекомендуемый вариант Kimi по умолчанию |
| `gpt-5.6-terra` | `low` — `high` | Неожиданно высокое качество и хорошая отзывчивость | Гибкие требования к качеству и задержке |
| `gpt-5.6-luna` | `xhigh` | Очень хорошие результаты на холсте при высокой скорости | Приоритет качества с сохранением отзывчивости |
| `gpt-5.6-sol` | `high` | Достаточно для большинства запросов, быстрее `xhigh` | По умолчанию, когда важна отзывчивость |
| `gpt-5.6-sol` | `xhigh` | Очень хорошее качество, но медленнее и менее предсказуемо | Сложные задачи на холсте |
| `deepseek-v4-flash-vision-exp` | `medium` | Хорошо | Задачи с визуальным вводом через DeepSeek API |
| `glm-5.3-flash` | `medium` | Хорошо | Быстрая работа через Anthropic-совместимый API GLM |

</details>

## Новое в 1.3.5

- **UI:** небольшие исправления интерфейса.
- **Одновременное редактирование холста:** Canvas AI, Agent и MCP могут одновременно изменять один и тот же холст.

[Полный список изменений →](../../CHANGELOG.md#135)

## Сообщество

| [Discord](https://discord.gg/3jrPJ3mXdX) | [Discussions](https://github.com/penecho/penecho/discussions) | [Issues](https://github.com/penecho/penecho/issues) | [Contributing](../../CONTRIBUTING.md) |
| --- | --- | --- | --- |
| Общение с командой | Идеи и вопросы | Сообщить об ошибке | Сначала выполните `npm run check` |

Проект распространяется по лицензии [AGPL-3.0-only](../../LICENSE); также доступна [коммерческая лицензия](../../COMMERCIAL-LICENSE.md). См. [правила использования товарных знаков](../../TRADEMARKS.md) и [соглашение с участниками](../../CONTRIBUTOR-LICENSE-AGREEMENT.md).

Для отрисовки схем адаптированы SVG- и геометрические вспомогательные функции проекта [Archify](https://github.com/tt-a1i/archify) автора tt-a1i (MIT). Подробнее: [NOTICE](../../NOTICE).

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
