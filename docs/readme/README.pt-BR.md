<p align="center">
  <a href="https://penecho.ai/lines.html">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="../assets/penecho-lines-logo-dark.svg">
      <img src="../assets/penecho-lines-logo.svg" alt="PenEcho Lines" width="340">
    </picture>
  </a>
</p>

<h3 align="center">Não é mais um agente de IA. É um jeito melhor de trabalhar com os seus.</h3>

<p align="center">
  Desenhe o que você quer dizer, acompanhe cada tarefa como uma linha e deixe um agente revisar o trabalho do outro.<br>
  Funciona com os agentes que você já usa. Código aberto, grátis no seu computador, sem precisar de conta.
</p>

<p align="center">
  <a href="https://penecho.ai">Site</a> &nbsp;·&nbsp;
  <a href="#install">Download</a> &nbsp;·&nbsp;
  <a href="https://penecho.ai/try.html">Testar no navegador</a> &nbsp;·&nbsp;
  <a href="https://penecho.ai/leaderboard">Ranking de agentes</a> &nbsp;·&nbsp;
  <a href="https://discord.gg/3jrPJ3mXdX">Discord</a> &nbsp;·&nbsp;
  <a href="https://buymeacoffee.com/penecho">Pague um café</a>
</p>

<p align="center">
  <sub>
    <a href="../../README.md">English</a> ·
    <a href="README.zh-CN.md">简体中文</a> ·
    <a href="README.ja.md">日本語</a> ·
    <a href="README.ko.md">한국어</a> ·
    <a href="README.ru.md">Русский</a> ·
    <a href="README.es.md">Español</a> ·
    <strong>Português</strong> ·
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
| **App desktop** | Baixe para macOS ou Windows em [penecho.ai](https://penecho.ai/downloads.html). |
| **npm** | `npm install -g penecho`, depois `penecho` (Node.js 22.19 ou mais recente). |
| **Navegador** | Abra [penecho.ai](https://penecho.ai). Nada para instalar. |

Escolha um código de acesso, abra a pasta de um projeto e adicione seus agentes em **Configurações → Agents**. Use os planos de agentes que você já paga, sua própria chave de API ou os modelos do PenEcho.

Novidades na 1.5.0: Lines, revisão em um clique, Orchestrator com avaliações reais, economia de tokens comprovada e compartilhamento de Canvas ao vivo. Veja o [changelog](../../CHANGELOG.md#150).

### Executar a partir do código-fonte

Você precisa de Git e Node.js 22.19 ou mais recente. As páginas prontas já estão no repositório, então não há etapa de build.

```bash
git clone https://github.com/penecho/penecho.git
cd penecho
npm install
npm start        # PenEcho abre em http://localhost:3888
```

Para rodar o app desktop a partir do código-fonte, execute `npm run desktop:deps` uma vez e depois `npm run desktop`. `npm run check` roda todas as verificações e testes.

---

## Veja em 3 minutos

Uma tarefa real do começo ao fim: um agente constrói, outro revisa, os ajustes voltam para correção e a palavra final é sua.

<p align="center">
  <a href="https://penecho.ai/lines.html#film">
    <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_lines.gif" alt="Vídeo do PenEcho Lines: circule uma captura de tela, escolha um agente, revisão em um clique, enviar ajustes, pronto 5 de 5, o Orchestrator escolhe agentes pelo histórico real" width="100%">
  </a>
</p>
<p align="center"><a href="https://penecho.ai/lines.html#film">▶ Assistir ao vídeo completo</a></p>

<p align="center">
  <img src="../assets/penecho-lines-architecture.svg" alt="Como uma tarefa chega aos seus agentes: o PenEcho envia uma tarefa direta para um agente ou uma tarefa do Orchestrator dividida em partes para vários agentes. Os agentes trabalham na pasta do projeto e mantêm o mesmo registro em Markdown: MEMORY.md, lines e works." width="880">
</p>

Envie uma tarefa direto para um agente ou entregue ao Orchestrator, que divide o trabalho e escolhe o agente certo para cada parte. Todo agente trabalha na sua pasta e mantém o mesmo registro em Markdown simples.

---

## O que você ganha

<table width="100%">
  <tr>
    <td width="50%" valign="top">
      <strong>Agentes trabalham juntos numa tarefa</strong><br>
      Um agente cria, outro revisa em um clique e <em>Send fixes</em> devolve os pontos encontrados na mesma Line.
    </td>
    <td width="50%" valign="top">
      <strong>Economia de tokens comprovada</strong><br>
      Continua ou começa do zero — o que sair mais barato — e mostra o que cada tarefa economizou.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>Um Orchestrator que aprende</strong><br>
      Divide tarefas grandes, escolhe agentes pelo histórico real e avalia cada resultado para melhorar as escolhas.
    </td>
    <td width="50%" valign="top">
      <strong>Todos os agentes sincronizados</strong><br>
      Sessões do Claude Code, Codex, Kimi, OpenCode e outros entram automaticamente. Continue qualquer uma com qualquer agente.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>Centenas de tarefas em uma tela</strong><br>
      Ask, Trabalhando, Precisa de você, Para revisar, Concluído. Veja num relance o que espera por você.
    </td>
    <td width="50%" valign="top">
      <strong>Desenhe o que você quer dizer</strong><br>
      Circule uma captura, rascunhe um protótipo, crie diagramas e slides. Os agentes veem seus traços junto com suas palavras.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>Markdown simples que é seu</strong><br>
      Cada Line é um arquivo Markdown na sua pasta, com um <code>MEMORY.md</code> para o projeto. Leia em qualquer lugar.
    </td>
    <td width="50%" valign="top">
      <strong>Compartilhe com um link</strong><br>
      Compartilhe um projeto ou Canvas por link. Sua equipe abre no navegador para revisar e desenhar anotações.
    </td>
  </tr>
</table>

Funciona com Claude Code, Codex, OpenCode, Antigravity, Kimi, Pi, DeepSeek Harness, omp e o executor integrado do PenEcho.

---

## Canvas AI

Escreva, desenhe ou circule algo e a resposta aparece exatamente onde você desenhou.

<p align="center">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_full_demo.webp" alt="Equações, problemas de física, esboços e um labirinto resolvidos em um PenEcho Canvas" width="720">
</p>
<p align="center"><sub><strong>Desenhe e pergunte</strong> — escrita à mão, equações, desenhos e labirintos.</sub></p>

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

O PenEcho faz parte do Kimi Open Source Friends. O Kimi Code roda no PenEcho como qualquer outro agente: adicione em **Configurações → Agents** ou [obtenha o Kimi Code](https://www.kimi.com/code?aff=penecho).

---

<a name="support-penecho"></a>
<a name="buy-us-a-coffee"></a>

## Mais

- **Comunidade:** [Site](https://penecho.ai) · [Ranking](https://penecho.ai/leaderboard) · [Discord](https://discord.gg/3jrPJ3mXdX) · [Discussions](https://github.com/penecho/penecho/discussions) · [Issues](https://github.com/penecho/penecho/issues) · [Contribuir](../../CONTRIBUTING.md)
- **Apoie:** se o PenEcho salvou sua tarde, [pague um café](https://buymeacoffee.com/penecho) ou [patrocine no GitHub](https://github.com/sponsors/penecho). Uma estrela ou um bom relato de bug ajuda na mesma medida.
- **Documentação:** [Arquitetura](../architecture.md) · [Project Lines](../project-lines.md) · [Configuração MCP](../mcp-setup.md) · [Changelog](../../CHANGELOG.md)
- **Licença:** [AGPL-3.0-only](../../LICENSE), com [licença comercial](../../COMMERCIAL-LICENSE.md) disponível. Veja a [política de marcas](../../TRADEMARKS.md) e o [CLA](../../CONTRIBUTOR-LICENSE-AGREEMENT.md). Os renderizadores de diagramas adaptam código do [Archify](https://github.com/tt-a1i/archify) de tt-a1i (MIT); veja [NOTICE](../../NOTICE).

<details>
<summary><strong>Histórico de estrelas</strong></summary>
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
