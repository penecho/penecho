<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../public/penecho-readme-header-dark.webp">
    <img src="../../public/penecho-readme-header.webp" alt="PenEcho" width="280">
  </picture>
</p>

<h1 align="center">Pense em um canvas com qualquer IA.</h1>

<p align="center">Desenhe à mão. O Agent integrado do PenEcho, o Codex, o Claude Code ou qualquer cliente MCP transforma suas ideias em diagramas, documentos e widgets funcionais ao lado das suas notas.</p>

<p align="center">
  <a href="https://github.com/penecho/penecho/releases/latest"><img src="https://img.shields.io/badge/release-v1.3.4-087f83" alt="Release v1.3.4"></a>
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
  <a href="#quick-start">Início rápido</a> ·
  <a href="#connect-your-ai-agent-mcp">Conecte seu agente de IA (MCP)</a> ·
  <a href="../">Documentação</a> ·
  <a href="https://discord.gg/3jrPJ3mXdX">Discord</a>
</p>

<p align="center"><sub><a href="../../README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a> ·
  <a href="README.ru.md">Русский</a> ·
  <a href="README.es.md">Español</a> ·
  <strong>Português</strong> ·
  <a href="README.fr.md">Français</a> ·
  <a href="README.de.md">Deutsch</a></sub></p>

<p align="center">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_full_demo.webp" alt="PenEcho" width="100%">
</p>
<p align="center"><em>De um esboço a um resultado interativo no mesmo canvas.</em></p>

## O que você pode fazer

<table width="100%">
  <tr>
    <td width="33%" valign="top">
      <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins_sub_x10.webp" alt="Desenhe e pergunte" width="100%"><br>
      <strong>Desenhe e pergunte</strong><br>
      Escrita à mão, equações, texto e imagens em um canvas infinito. A IA responde automaticamente quando você faz uma pausa.
    </td>
    <td width="33%" valign="top">
      <a href="../assets/professional-diagrams/kubernetes.webp"><img src="../assets/professional-diagrams/previews/kubernetes.webp" alt="Cluster Kubernetes" width="100%"></a><br>
      <strong>Diagramas profissionais</strong><br>
      Diagramas de arquitetura, sequência e fluxo com layout automático. Exporte em SVG ou PNG.
    </td>
    <td width="33%" valign="top">
      <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/play_patris.webp" alt="Widgets funcionais" width="100%"><br>
      <strong>Widgets funcionais</strong><br>
      Calculadoras, quizzes e protótipos que rodam no canvas e podem ser favoritados ou compartilhados.
    </td>
  </tr>
</table>

<a id="quick-start"></a>
## Início rápido

| | Como começar |
| --- | --- |
| **Aplicativo para desktop** | Baixe a versão para macOS ou Windows no [GitHub Releases](https://github.com/penecho/penecho/releases/latest). Ela inclui tudo e se atualiza automaticamente. |
| **npm** | Requer Node.js 22.19 ou superior. Execute `npm i -g penecho`, depois `penecho` e abra `localhost:3888`. |
| **Navegador** | Entre em [penecho.ai](https://penecho.ai) para usar modelos hospedados e canvases na nuvem. Não precisa instalar nada. |

```bash
npm install -g penecho
penecho             # http://localhost:3888
```

> [!TIP]
> Na primeira inicialização, escolha um código de acesso de seis dígitos ou acesso aberto em uma rede confiável. Em **Configurações → IA e conexões**, adicione sua chave de API, uma CLI autenticada do Codex / Claude Code / Kimi ou modelos PenEcho.

<details>
<summary>Executar a partir do código-fonte</summary>

```bash
git clone https://github.com/penecho/penecho.git
cd penecho
npm install
npm start
```

</details>

<a id="connect-your-ai-agent-mcp"></a>
## Conecte seu agente de IA (MCP)

Continue conversando no agente que você já usa. Ele desenha no canvas, você faz anotações e, no próximo turno, ele lê seu feedback.

1. No PenEcho, abra **Configurações → Serviço MCP** e habilite o canvas atual.
2. Use a **Configuração automática** em um cliente compatível ou copie as instruções geradas para Codex, Claude Code, Kimi, Cursor etc. Com a instalação global via npm, clientes que aceitam JSON `mcpServers` também podem usar esta configuração compatível:

   ```json
   {
     "mcpServers": {
       "penecho": { "command": "penecho", "args": ["mcp"] }
     }
   }
   ```

3. Peça: *“Mostre a arquitetura que discutimos no meu canvas do PenEcho.”*

<p align="center"><a href="../assets/mcp-spatial-example.webp"><img src="../assets/mcp-spatial-example.webp" alt="Uma discussão de arquitetura com IA, com comentários manuscritos ao lado da proposta no PenEcho Canvas" width="760"></a></p>
<p align="center"><em>Uma discussão de arquitetura no Claude Code, anotada à mão no canvas.</em></p>

> [!NOTE]
> Os agentes só veem os canvases que você habilitar. O Local MCP permanece no computador; o Cloud MCP é uma conexão autenticada separada para canvases na nuvem. [Guia de MCP →](../mcp-setup.md)

## Galeria de diagramas

<table width="100%">
  <tr>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/kubernetes.webp"><img src="../assets/professional-diagrams/previews/kubernetes.webp" alt="Cluster Kubernetes" width="100%"></a><br><strong>Cluster Kubernetes</strong></td>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/migration.webp"><img src="../assets/professional-diagrams/previews/migration.webp" alt="Monólito → microsserviços" width="100%"></a><br><strong>Monólito → microsserviços</strong></td>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/notifications.webp"><img src="../assets/professional-diagrams/previews/notifications.webp" alt="Notificações orientadas a eventos" width="100%"></a><br><strong>Notificações orientadas a eventos</strong></td>
  </tr>
  <tr>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/mcp-request.webp"><img src="../assets/professional-diagrams/previews/mcp-request.webp" alt="Como o MCP chega ao canvas" width="100%"></a><br><strong>Como o MCP chega ao canvas</strong></td>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/release.webp"><img src="../assets/professional-diagrams/previews/release.webp" alt="Lançamento: tarefas em paralelo" width="100%"></a><br><strong>Lançamento: tarefas em paralelo</strong></td>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/rollout.webp"><img src="../assets/professional-diagrams/previews/rollout.webp" alt="Implantação em várias regiões" width="100%"></a><br><strong>Implantação em várias regiões</strong></td>
  </tr>
</table>

<p align="center"><sub>Clique em um diagrama para vê-lo em tamanho completo.</sub></p>

## Como funciona

<p align="center"><img src="../../public/penecho-architecture.webp" alt="Arquitetura do PenEcho: um navegador se conecta ao PenEcho Cloud ou ao PC local. A Cloud inclui modelos hospedados e se conecta ao dispositivo vinculado. O PC executa o PenEcho CLI ou App com sua API de LLM ou seus agentes. Agentes externos podem usar Cloud MCP ou Local MCP; ambas as conexões são opcionais." width="100%"></p>

- **No seu computador** — O aplicativo para desktop ou a CLI oferece o canvas e usa sua própria API de modelos ou Agent CLI.
- **Na nuvem** — penecho.ai adiciona modelos hospedados, projetos e favoritos sincronizados e pode acessar seu computador vinculado.
- **Seu agente** — Conecta-se por Local ou Cloud MCP. Ambos são opcionais.

Detalhes: [notas de arquitetura](../architecture.md).

## Escolha sua IA

| Conexão | Custo | Melhor para |
| --- | --- | --- |
| **Modelos PenEcho** — entre e escolha um modelo | Créditos da conta | Começar sem chaves |
| **Sua API de modelos** — OpenAI / Anthropic | Seu provedor | Controle total do modelo e dos custos |
| **Sua CLI** — Codex, Claude Code, Kimi | Seu plano | Reutilizar uma assinatura existente |

Como escolher modelo e nível de esforço: [Modelos recomendados](#recommended-models) (atualizado a cada versão).

<a name="recommended-models"></a>
<details>
<summary>Modelos recomendados</summary>

Estas recomendações equilibram qualidade e latência em tarefas reais do canvas do PenEcho com base em testes recentes; o tempo de resposta varia com o provedor, a complexidade do canvas e o raciocínio.

| Modelo | Esforço | Observações | Uso recomendado |
| --- | --- | --- | --- |
| Claude Opus 4.8 / 5.0 (`claude-opus-4-8` / `claude-opus-5-0`) | `medium` | Ótima qualidade com melhor equilíbrio de latência | Trabalho cotidiano no canvas |
| Claude Opus 4.8 / 5.0 (`claude-opus-4-8` / `claude-opus-5-0`) | `high` | Maior qualidade de raciocínio, esperas mais longas e variáveis | Escrita à mão, matemática, diagramas ou layouts complexos |
| Fable 5 (`claude-fable-5` ou `fable`) | `medium` | Frequentemente responde em cerca de metade do tempo de `gpt-5.6-sol` com `xhigh` | Uso geral rápido e de alta qualidade |
| [Kimi K3](https://platform.kimi.ai?aff=penecho) (`kimi-k3`) | `medium` | Qualidade muito boa; `medium` mantém um equilíbrio prático | Padrão recomendado para Kimi |
| `gpt-5.6-terra` | `low` a `high` | Surpreendentemente capaz e responsivo | Metas flexíveis de qualidade e latência |
| `gpt-5.6-luna` | `xhigh` | Resultados muito bons no canvas com ótima velocidade | Prioridade à qualidade, mantendo a responsividade |
| `gpt-5.6-sol` | `high` | Suficiente para a maioria dos pedidos, mais responsivo que `xhigh` | Padrão quando a responsividade é importante |
| `gpt-5.6-sol` | `xhigh` | Muito bom, mas mais lento e variável | Tarefas difíceis no canvas |
| `deepseek-v4-flash-vision-exp` | `medium` | Bom | Trabalho com capacidade visual pela API DeepSeek |
| `glm-5.3-flash` | `medium` | Bom | Trabalho rápido pela API GLM compatível com Anthropic |

</details>

## Novidades da versão 1.3.3

- **Diagramas de arquitetura, sequência e fluxo de trabalho** Com layout automático, conexões roteadas e exportação SVG / PNG.
- **Biblioteca de canvases** Com paginação, pesquisa, filtros de projeto e ordenação.
- **Mais predefinições de provedores de API** As listas de modelos são buscadas automaticamente.

[Histórico completo de alterações →](../../CHANGELOG.md#133)

## Comunidade

| [Discord](https://discord.gg/3jrPJ3mXdX) | [Discussions](https://github.com/penecho/penecho/discussions) | [Issues](https://github.com/penecho/penecho/issues) | [Contributing](../../CONTRIBUTING.md) |
| --- | --- | --- | --- |
| Converse com a equipe | Ideias e dúvidas | Relate um problema | Execute antes `npm run check` |

Distribuído sob a licença [AGPL-3.0-only](../../LICENSE); há também uma [licença comercial](../../COMMERCIAL-LICENSE.md). Consulte a [política de marcas](../../TRADEMARKS.md) e o [acordo de contribuição](../../CONTRIBUTOR-LICENSE-AGREEMENT.md).

Os renderizadores de diagramas adaptam recursos auxiliares de SVG e geometria do [Archify](https://github.com/tt-a1i/archify) de tt-a1i (MIT). Consulte [NOTICE](../../NOTICE).

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
