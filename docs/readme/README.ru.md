<p align="center">
  <a href="https://penecho.ai/lines.html">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="../assets/penecho-lines-logo-dark.svg">
      <img src="../assets/penecho-lines-logo.svg" alt="PenEcho Lines" width="340">
    </picture>
  </a>
</p>

<h3 align="center">Не очередной ИИ-агент. Лучший способ работать с вашими.</h3>

<p align="center">
  Нарисуйте, что имеете в виду, отслеживайте каждую задачу как линию и позвольте одному агенту проверять работу другого.<br>
  Работает с агентами, которыми вы уже пользуетесь. Открытый код, бесплатно на вашем компьютере, без аккаунта.
</p>

<p align="center">
  <a href="https://penecho.ai">Сайт</a> &nbsp;·&nbsp;
  <a href="#install">Скачать</a> &nbsp;·&nbsp;
  <a href="https://penecho.ai/try.html">Попробовать в браузере</a> &nbsp;·&nbsp;
  <a href="https://penecho.ai/leaderboard">Рейтинг агентов</a> &nbsp;·&nbsp;
  <a href="https://discord.gg/3jrPJ3mXdX">Discord</a> &nbsp;·&nbsp;
  <a href="https://buymeacoffee.com/penecho">Угостить кофе</a>
</p>

<p align="center">
  <sub>
    <a href="../../README.md">English</a> ·
    <a href="README.zh-CN.md">简体中文</a> ·
    <a href="README.ja.md">日本語</a> ·
    <a href="README.ko.md">한국어</a> ·
    <strong>Русский</strong> ·
    <a href="README.es.md">Español</a> ·
    <a href="README.pt-BR.md">Português</a> ·
    <a href="README.fr.md">Français</a> ·
    <a href="README.de.md">Deutsch</a>
  </sub>
</p>

---

<a name="quick-start"></a>
<a name="install"></a>

## Установка

<a href="https://github.com/penecho/penecho/releases/latest"><img src="https://img.shields.io/badge/release-v1.5.0-2563eb" alt="Release v1.5.0"></a>
<img src="https://img.shields.io/badge/macOS%20·%20Windows%20·%20Linux-64748b" alt="macOS, Windows, Linux">
<a href="../../LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-64748b" alt="AGPL-3.0"></a>

| | |
| :--- | :--- |
| **Десктопное приложение** | Скачайте версию для macOS или Windows на [penecho.ai](https://penecho.ai/downloads.html). |
| **npm** | `npm install -g penecho`, затем `penecho` (Node.js 22.19 или новее). |
| **Браузер** | Откройте [penecho.ai](https://penecho.ai). Ничего не нужно устанавливать. |

Задайте код доступа, откройте папку проекта и добавьте своих агентов в **Настройки → Agents**. Используйте подписки агентов, за которые уже платите, свой API-ключ или модели PenEcho.

Новое в 1.5.0: Lines, ревью в один клик, Orchestrator с реальными оценками, подтверждённая экономия токенов и совместный Canvas в реальном времени. См. [список изменений](../../CHANGELOG.md#150).

### Запуск из исходников

Понадобятся Git и Node.js 22.19 или новее. Собранные страницы уже есть в репозитории, поэтому шаг сборки не нужен.

```bash
git clone https://github.com/penecho/penecho.git
cd penecho
npm install
npm start        # PenEcho откроется на http://localhost:3888
```

Для запуска десктопного приложения из исходников выполните один раз `npm run desktop:deps`, затем `npm run desktop`. Команда `npm run check` запускает все проверки и тесты.

---

## За 3 минуты

Одна реальная задача от начала до конца: один агент пишет, другой проверяет, правки возвращаются обратно, а финальное решение за вами.

<p align="center">
  <a href="https://penecho.ai/lines.html#film">
    <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_lines.gif" alt="Демо PenEcho Lines: обведите скриншот, выберите агента, ревью в один клик, отправка правок, готово 5 из 5, Orchestrator выбирает агентов по их реальным результатам" width="100%">
  </a>
</p>
<p align="center"><a href="https://penecho.ai/lines.html#film">▶ Смотреть ролик целиком</a></p>

<p align="center">
  <img src="../assets/penecho-lines-architecture.svg" alt="Как задача попадает к вашим агентам: PenEcho отправляет задачу напрямую одному агенту или через Orchestrator, который делит её на части между несколькими агентами. Агенты работают в папке проекта и ведут единую запись в Markdown: MEMORY.md, lines и works." width="880">
</p>

Отправьте задачу напрямую одному агенту или передайте её Orchestrator, который разобьёт её на части и подберёт агента для каждой. Все агенты работают в вашей папке и ведут общую запись в обычном Markdown.

---

## Что вы получаете

<table width="100%">
  <tr>
    <td width="50%" valign="top">
      <strong>Агенты вместе работают над одной задачей</strong><br>
      Один агент строит, другой проверяет в один клик, а <em>Send fixes</em> возвращает замечания на ту же Line.
    </td>
    <td width="50%" valign="top">
      <strong>Экономия токенов с доказательствами</strong><br>
      Продолжает сессию или начинает заново — как дешевле — и показывает экономию по каждой задаче.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>Orchestrator, который учится</strong><br>
      Делит большие задачи, выбирает агентов по реальным результатам и оценивает итог, чтобы выбор становился точнее.
    </td>
    <td width="50%" valign="top">
      <strong>Все агенты синхронизированы</strong><br>
      Сессии из Claude Code, Codex, Kimi, OpenCode и других подтягиваются сами. Продолжайте любую из них любым агентом.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>Сотни задач на одном экране</strong><br>
      Ask, В работе, Нужны вы, На ревью, Готово. Сразу видно, что ждёт вашего внимания.
    </td>
    <td width="50%" valign="top">
      <strong>Рисуйте, что имеете в виду</strong><br>
      Обводите скриншоты, набрасывайте прототипы, делайте схемы и слайды. Агенты видят ваши пометки вместе со словами.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>Обычный Markdown, который принадлежит вам</strong><br>
      Каждая Line — это файл Markdown в вашей папке, плюс один <code>MEMORY.md</code> на проект. Читайте где угодно.
    </td>
    <td width="50%" valign="top">
      <strong>Делитесь одной ссылкой</strong><br>
      Отправьте ссылку на проект или Canvas. Коллеги откроют её в браузере, чтобы провести ревью и оставить пометки.
    </td>
  </tr>
</table>

Работает с Claude Code, Codex, OpenCode, Antigravity, Kimi, Pi, DeepSeek Harness, omp и встроенным раннером PenEcho.

---

## Canvas AI

Напишите, набросайте схему или обведите фрагмент — ответ появится прямо там, где вы рисовали.

<p align="center">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_full_demo.webp" alt="Решение уравнений, задач по физике, набросков и лабиринта на PenEcho Canvas" width="720">
</p>
<p align="center"><sub><strong>Нарисуй и спроси</strong> — рукописный ввод, уравнения, наброски и лабиринты.</sub></p>

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

PenEcho входит в Kimi Open Source Friends. Kimi Code работает в PenEcho как любой другой агент: добавьте его в **Настройки → Agents** или [получите Kimi Code](https://www.kimi.com/code?aff=penecho).

---

<a name="support-penecho"></a>
<a name="buy-us-a-coffee"></a>

## Ещё

- **Сообщество:** [Сайт](https://penecho.ai) · [Рейтинг](https://penecho.ai/leaderboard) · [Discord](https://discord.gg/3jrPJ3mXdX) · [Discussions](https://github.com/penecho/penecho/discussions) · [Issues](https://github.com/penecho/penecho/issues) · [Участие в разработке](../../CONTRIBUTING.md)
- **Поддержка:** если PenEcho сэкономил вам полдня, [угостите нас кофе](https://buymeacoffee.com/penecho) или поддержите на [GitHub Sponsors](https://github.com/sponsors/penecho). Звезда или хороший баг-репорт помогают не меньше.
- **Документация:** [Архитектура](../architecture.md) · [Project Lines](../project-lines.md) · [Настройка MCP](../mcp-setup.md) · [Список изменений](../../CHANGELOG.md)
- **Лицензия:** [AGPL-3.0-only](../../LICENSE), доступна [коммерческая лицензия](../../COMMERCIAL-LICENSE.md). См. [политику товарных знаков](../../TRADEMARKS.md) и [CLA](../../CONTRIBUTOR-LICENSE-AGREEMENT.md). Рендереры схем адаптируют код из [Archify](https://github.com/tt-a1i/archify) от tt-a1i (MIT); см. [NOTICE](../../NOTICE).

<details>
<summary><strong>История звёзд</strong></summary>
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
