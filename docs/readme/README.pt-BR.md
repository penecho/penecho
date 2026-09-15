<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../public/penecho-readme-header-dark.webp">
    <img src="../../public/penecho-readme-header.webp" alt="PenEcho" width="280">
  </picture>
</h1>

<p align="center">
  <a href="../../README.md">English</a> |
  <a href="README.zh-CN.md">简体中文</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.es.md">Español</a> |
  <strong>Português (Brasil)</strong> |
  <a href="README.fr.md">Français</a> |
  <a href="README.de.md">Deutsch</a>
</p>

<h1 align="center">Um espaço de trabalho visual<br>para pensar com IA.</h1>
<p align="center">Desenhe, explore e crie com o Agent integrado ou seu próprio assistente compatível com MCP.</p>
<p align="center">
  <img src="https://img.shields.io/badge/version-1.3.2-087f83" alt="Versão 1.3.2">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="AGPL-3.0-only"></a>
</p>
<p align="center">
  <a href="https://penecho.ai">Site</a> ·
  <a href="https://github.com/penecho/penecho/releases/latest">Download</a> ·
  <a href="#quick-start">Início rápido</a> ·
  <a href="../mcp-setup.md">Guia MCP</a> ·
  <a href="https://discord.gg/3jrPJ3mXdX">Discord</a>
</p>

<p align="center">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_full_demo.webp" alt="Demonstração completa do PenEcho" width="49%">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins.webp" alt="Demonstração de diagramas profissionais do PenEcho" width="49%">
</p>

<p align="center">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins_sub_x10.webp" alt="Demonstração de plugins do PenEcho" width="49%">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/play_patris.webp" alt="Demonstração do canvas interativo do PenEcho" width="49%">
</p>

<p align="center">
  <a href="https://www.kimi.com/code?aff=penecho">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="../assets/kimi-open-source-friends-dark.svg">
      <img src="../assets/kimi-open-source-friends-light.svg" alt="Kimi Open Source Friends" width="326" height="56">
    </picture>
  </a>
</p>

## Uma extensão espacial da sua conversa com IA

Continue conversando com **Codex, Claude, Kimi ou outros agentes de IA**. Deixe o PenEcho dar um lugar para o seu trabalho.

Com MCP, sua IA pode transformar explicações em diagramas e ideias em prévias interativas. Mantenha referências, raciocínio e resultados lado a lado, anote no canvas e leve seus comentários para a próxima rodada.

| Continue a conversa | Veja o trabalho tomar forma | Envie seus comentários |
| --- | --- | --- |
| Trabalhe com o agente de IA que você já usa. | O servidor MCP do PenEcho traz diagramas, documentos e prévias interativas para o Canvas. | Experimente o resultado, faça anotações e deixe o agente ler seus comentários para a próxima revisão. |

<p align="center">
  <a href="../assets/mcp-spatial-example.webp">
    <img src="../assets/mcp-spatial-example.webp" alt="Uma discussão de arquitetura com IA, com comentários manuscritos ao lado da proposta no PenEcho Canvas" width="760">
  </a>
</p>
<p align="center"><em>Uma discussão de arquitetura com anotações manuscritas no Canvas.</em></p>

**Veja antes de ficar pronto.** Acompanhe o trabalho tomando forma enquanto conversa com a IA. Experimente, dê feedback e avance no projeto em conjunto.

[Conecte seu agente com MCP →](#connect-your-agent-with-mcp)

## O que você pode fazer

- **Trabalhe visualmente.** Combine escrita à mão, equações, texto, imagens, diagramas e HTML Widgets interativos em um canvas amplo.
- **Crie com IA.** Use o Agent integrado para pesquisar, trabalhar com arquivos, explicar ideias e criar resultados visuais editáveis.
- **Traga seu próprio agente.** Conecte Codex, Claude Code ou outro cliente compatível com MCP para ler e editar um Canvas explicitamente habilitado.
- **Guarde e compartilhe seu trabalho.** Organize Canvases em projetos, salve revisões na Cloud, sincronize favoritos e publique pelo Echoes.

## Novidades da versão 1.3.2

| Atualização | O que acrescenta |
| --- | --- |
| **Espaço de trabalho MCP** | Descoberta de Canvases, capturas, edição de objetos, Widgets interativos, arquivos-fonte virtuais e feedback do usuário para agentes externos. Suporta navegadores locais, na LAN e na Cloud por um dispositivo vinculado, com autorização explícita. |
| **Cloud MCP** | Conecte agentes de IA externos diretamente aos seus canvases habilitados no PenEcho Cloud para ler conteúdo, criar e editar resultados e acompanhar comentários manuscritos. Cloud MCP e Local MCP são formas opcionais de conexão. |
| **PenEcho Cloud Credits API** | Use modelos hospedados pelo PenEcho com créditos da conta, além de suas próprias conexões de API e CLI. Consulte modelos disponíveis, preços e saldo nas configurações. |
| **Gerenciamento de conexões** | Salve várias conexões de IA e escolha a conexão ativa de cada cliente. |
| **Canvas e ambiente de trabalho** | Desenho e navegação mais responsivos, controles refinados do Studio, painel adaptável do Agent e atalhos de teclado personalizáveis. |

## Como funciona

<p align="center">
  <img src="../../public/penecho-architecture.webp" alt="Arquitetura do PenEcho: um navegador se conecta ao PenEcho Cloud ou ao PC local. A Cloud inclui modelos hospedados e se conecta ao dispositivo vinculado. O PC executa o PenEcho CLI ou App com sua API de LLM ou seus agentes. Agentes externos podem usar Cloud MCP ou Local MCP; ambas as conexões são opcionais." width="1483">
</p>

Abra o PenEcho no navegador pelo PenEcho Cloud ou pelo PC local executando o CLI ou o aplicativo desktop. A Cloud oferece modelos hospedados e pode se conectar ao dispositivo vinculado; seu PC pode usar sua própria API de modelos ou seus agentes. Agentes de IA externos, como Codex e Claude, podem se conectar por Cloud MCP ou Local MCP. Ambas as conexões MCP são opcionais.

Consulte as [notas de arquitetura](../architecture.md) para detalhes de implementação.

<a id="quick-start"></a>

## Início rápido

**Desktop:** baixe o aplicativo para Windows ou macOS em [GitHub Releases](https://github.com/penecho/penecho/releases/latest).

**npm:** requer Node.js **22.19 ou mais recente**.

```bash
npm install -g penecho
penecho
```

Abra `http://localhost:3888`. Adicione sua API de modelos ou um Codex, Claude Code ou Kimi CLI autenticado em **Configurações → Conexões**. As conexões são salvas em `~/.penecho/connections.json`; as configurações gerais continuam em `~/.penecho/config.env`. Para modelos hospedados pelo PenEcho, entre na conta e selecione um modelo disponível nas configurações.

Na inicialização, defina um código de acesso de seis dígitos ou habilite explicitamente o acesso aberto na sua rede confiável. A inicialização também mostra os endereços LAN para outros dispositivos.

<details>
<summary>Executar a partir do código-fonte</summary>

```bash
git clone https://github.com/penecho/penecho.git
cd penecho
npm install
npm start
```

</details>

<a id="connect-your-agent-with-mcp"></a>

## Conecte seu agente com MCP

Para **Local MCP**:

1. Inicie o PenEcho e habilite o Canvas atual em **Configurações → Serviço MCP**.
2. Use as configurações para configurar um cliente local compatível ou copie a configuração de inicialização gerada. Em uma instalação global via npm, clientes que aceitam JSON `mcpServers` podem usar:

   ```json
   {
     "mcpServers": {
       "penecho": { "command": "penecho", "args": ["mcp"] }
     }
   }
   ```

3. Peça ao agente: **“Mostre a arquitetura que discutimos no meu PenEcho Canvas.”**

O agente pode capturar conteúdo relevante, editar objetos, criar resultados visuais, aplicar alterações aos arquivos-fonte de documentos e receber seus comentários. Apenas Canvases habilitados e conectados podem ser descobertos. Com Local MCP, o cliente MCP é executado no host do PenEcho; o suporte a navegadores na LAN e em dispositivos vinculados não expõe publicamente o endpoint MCP local. Cloud MCP é uma conexão HTTPS autenticada separada para seus canvases habilitados no PenEcho Cloud.

Instalações desktop devem usar a configuração gerada, que inclui o runtime correto distribuído com o aplicativo. Consulte a [configuração MCP](../mcp-setup.md) e a [skill opcional de fluxo de trabalho do agente](../../skills/penecho-mcp/SKILL.md).

## PenEcho Cloud e conexões de IA

O [PenEcho Cloud](https://penecho.ai) acrescenta projetos privados com histórico de versões, favoritos sincronizados, compartilhamento público pelo Echoes e acesso remoto a um computador vinculado.

| Conexão | Como funciona |
| --- | --- |
| **Modelos PenEcho** | Entre na conta, selecione um modelo hospedado disponível e use créditos da conta. As configurações mostram preços atuais e saldo. |
| **Sua API de modelos** | Configure um endpoint compatível com OpenAI ou Anthropic, um modelo e uma chave de API. O uso é gerenciado pelo seu provedor. |
| **Seu CLI** | Use Codex, Claude Code ou Kimi CLI instalado e autenticado localmente. A disponibilidade e o uso dependem do plano do provedor. |

Os modelos hospedados usados no seu computador exigem login na Cloud, sem pareamento de dispositivo nem chave separada da Credits API. Cloud MCP pode acessar diretamente os canvases habilitados na Cloud. Para acessar pela Cloud um Canvas hospedado no seu computador, o dispositivo vinculado precisa estar online e contar com o suporte de retransmissão necessário.

Suas próprias conexões de API e CLI não gastam créditos PenEcho. A conta Cloud é opcional para uso local com sua própria conexão. Os recursos de IA exigem acesso ao provedor selecionado; executar o PenEcho localmente não torna um modelo remoto disponível offline.

## Configurações de modelos recomendadas

Estas recomendações equilibram a qualidade das respostas e a latência em tarefas reais de canvas do PenEcho, com base nos testes práticos atuais. O tempo de resposta varia conforme o provedor, a complexidade do canvas e o comportamento de raciocínio.

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

## Comunidade e licença

Leia [CONTRIBUTING.md](../../CONTRIBUTING.md) para contribuir e execute `npm run check` antes de abrir um pull request. Relate bugs em [Issues](https://github.com/penecho/penecho/issues), discuta ideias em [Discussions](https://github.com/penecho/penecho/discussions) ou participe do [Discord](https://discord.gg/3jrPJ3mXdX).

Licenciado sob [AGPL-3.0-only](../../LICENSE). Há também uma [licença comercial](../../COMMERCIAL-LICENSE.md) alternativa. Consulte a [política de marcas](../../TRADEMARKS.md) e o [acordo de contribuição](../../CONTRIBUTOR-LICENSE-AGREEMENT.md).
