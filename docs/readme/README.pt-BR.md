<h1 align="center">
  <img src="../../public/penecho-readme-header.png" alt="PenEcho" width="760">
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

<p align="center"><strong>Pense com IA além da caixa de chat.</strong></p>

<p align="center">PenEcho é uma tela compartilhada onde escrita à mão, equações, diagramas e contexto espacial fazem parte da conversa.</p>

<p align="center">
  <a href="https://discord.gg/3jrPJ3mXdX"><img src="https://img.shields.io/badge/Discord-Participe%20da%20comunidade-5865F2?style=for-the-badge&amp;logo=discord&amp;logoColor=white" alt="Participe do Discord do PenEcho"></a>
  <a href="https://github.com/penecho/penecho/stargazers"><img src="https://img.shields.io/github/stars/penecho/penecho?style=for-the-badge&amp;logo=github&amp;logoColor=white&amp;color=f5b301" alt="Dê uma estrela ao PenEcho no GitHub"></a>
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/License-AGPL%20v3-blue?style=for-the-badge" alt="Licença: AGPL v3"></a>
</p>

> Esta tradução oferece uma visão geral do projeto. O [README em inglês](../../README.md) é a fonte oficial para as informações técnicas mais recentes e completas.

<p align="center"><img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins.webp" alt="Demonstração de diagramas profissionais do PenEcho" width="49%"> <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_full_demo.webp" alt="Demonstração completa do PenEcho" width="49%"></p>

<p align="center"><img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins_sub_x10.webp" alt="Demonstração dos plugins do PenEcho" width="49%"> <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/play_patris.webp" alt="Demonstração interativa da tela do PenEcho" width="49%"></p>

## Kimi Open Source Friends

O PenEcho é membro oficial do **Kimi Open Source Friends**, programa da [Moonshot AI](https://www.kimi.com/) que apoia projetos de código aberto de destaque. A equipe Kimi contribui com créditos de API, e o Kimi K3 é um dos modelos recomendados para trabalhos exigentes com escrita à mão e diagramas.

- [Kimi Code](https://www.kimi.com/code?aff=penecho) - assinatura para programação disponível mundialmente
- [Kimi Open Platform, China](https://platform.kimi.com?aff=penecho) - acesso à API na China continental
- [Kimi Open Platform, global](https://platform.kimi.ai?aff=penecho) - acesso à API nas demais regiões

## Início rápido

### Aplicativo para desktop

[Baixar no GitHub Releases](https://github.com/penecho/penecho/releases/latest).

Para instalar pelo npm, você precisa do [Node.js 20.3 ou mais recente](https://nodejs.org/) e de uma destas opções: uma chave de API, um [Codex CLI](https://developers.openai.com/codex/cli) autenticado ou um [Claude Code CLI](https://code.claude.com/docs/en/overview) autenticado.

```bash
npm install -g penecho
penecho configure
penecho
```

Abra [http://localhost:3888](http://localhost:3888). O comando `penecho configure` permite escolher de forma interativa a fonte de LLM, o modelo, o nível de raciocínio, o tempo limite, o formato de imagem e a interface de rede. Por padrão, as configurações ficam em `~/.penecho/config.env`; as credenciais de API nunca são enviadas ao navegador.

Para executar a partir do código-fonte:

```bash
git clone https://github.com/penecho/penecho.git
cd penecho
npm install
npm start
```

## Pense na tela

Escreva uma pergunta, equação, diagrama ou ideia incompleta em qualquer lugar da tela e faça uma pausa. O PenEcho interpreta os traços e suas relações espaciais e posiciona a resposta ao lado deles.

- Desenhe naturalmente com caneta ou mouse e navegue por uma tela de `20.000 x 20.000`.
- Receba respostas, dicas, explicações, fórmulas, gráficos e diagramas diretamente na tela.
- Mova e redimensione rascunhos da IA; aceite ou descarte cada um antes de incorporá-lo ao trabalho.
- Selecione traços com o laço para mover, redimensionar, recolorir, excluir ou converter com Typeset.
- Salve instantâneos neste dispositivo ou no servidor PenEcho e exporte o conteúdo confirmado como PNG.
- Escolha entre os temas Arcane, Sci-fi, Research e Studio.

## Novidades da versão 0.9.0

- **Várias conexões de IA com troca em um clique.** Salve até dez conexões API ou CLI, use predefinições editáveis de Kimi e MiniMax, teste-as na tela e escolha uma conexão ativa diferente em cada cliente do mesmo host PenEcho. As alterações são aplicadas imediatamente.
- **Telas compartilhadas organizadas por projetos.** Organize as telas do servidor em projetos, mova o trabalho entre eles e navegue por prévias maiores ordenadas pela última modificação. O bundle v2 versionado mantém blocos, widgets, imagens posicionadas, recursos e metadados de prévia juntos; telas v1 continuam compatíveis e são atualizadas quando salvas novamente.
- **Refine guiado e aplicado no próprio widget.** Escreva ou posicione novas instruções em qualquer lugar da área visível e escolha o widget que elas devem atualizar. O PenEcho conecta visualmente a área das instruções ao destino e pede confirmação; cancelamentos ou falhas preservam as instruções, e uma edição concluída ainda pode ser confirmada ou desfeita.
- **Alterações incrementais menores com unified diff padrão.** O Refine envia os arquivos editáveis completos do widget, mas o modelo devolve apenas os hunks alterados, sem regenerar o widget inteiro. Isso reduz bastante os tokens de saída e a espera, mantendo atômicas as alterações de HTML, fonte e metadados do widget.
- **Streaming real da API.** APIs compatíveis com OpenAI e Anthropic agora usam SSE de ponta a ponta para mostrar o recebimento imediatamente e tornar solicitações longas mais estáveis em gateways compatíveis.
- **Progresso e cancelamento claros.** O status superior mostra preparação, conexão, espera, recebimento, validação, novas tentativas e tempo limite. Durante uma solicitação, o botão mágico interrompe o trabalho ativo imediatamente.

## Destaques anteriores

- **0.8.1.** Adicionou dados públicos ao vivo ao General HTML e SVG como padrão para animações e gráficos complexos.
- **0.8.0 e 0.7.2.** Adicionaram diagramas profissionais editáveis, armazenamento no servidor, fluxos da área de transferência, fotos Web com fonte e edição e exportação mais confiáveis.

## Versões anteriores

- **0.7.1.** Adicionou imagens e fotos locais, edição de objetos com Hand, snapshots, exportação PNG, diagramas Mermaid copiáveis e imagens da Web com fonte.
- **0.7.0.** Introduziu HTML interativo isolado, plugins de dados ao vivo, criação local de plugins e persistência de widgets.
- **0.6.0 e anteriores.** Adicionou animações declarativas, melhorias em Markdown/LaTeX, ferramentas de seleção e a base da grande tela esparsa.

## Como funciona

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="../assets/how-it-works-dark.svg"><img alt="Como o PenEcho funciona" src="../assets/how-it-works-light.svg"></picture></p>

O navegador envia apenas o recorte relevante da tela e sua geometria. O servidor valida a solicitação, encaminha ao executor escolhido e devolve um rascunho estruturado e móvel. As recomendações atuais de modelos e os exemplos de custo estão no [README em inglês](../../README.md#recommended-model-configurations).

## Implantação segura

- **Codex CLI e Claude CLI:** use apenas na máquina local ou em uma rede confiável. Cada solicitação válida inicia um processo CLI local, portanto esses modos não devem ficar expostos diretamente à internet.
- **Modo API:** se houver acesso público, coloque o PenEcho atrás de um proxy HTTPS com autenticação e limites de frequência e tamanho de solicitação.
- Não publique arquivos de configuração, chaves de API, rastros de solicitações, logs ou imagens privadas da tela.

## Contribua com o projeto

Antes de enviar uma alteração, execute:

```bash
npm run check
```

Consulte as [notas de arquitetura](../architecture.md) e o [CONTRIBUTING.md](../../CONTRIBUTING.md). Compartilhe dúvidas e exemplos no [Discord](https://discord.gg/3jrPJ3mXdX) ou no [GitHub Discussions](https://github.com/penecho/penecho/discussions), e registre erros reproduzíveis no [GitHub Issues](https://github.com/penecho/penecho/issues).

## Licença e uso comercial

O PenEcho é distribuído sob a [GNU AGPL v3.0 only](../../LICENSE). O uso comercial é permitido, mas, se você oferecer uma versão modificada a usuários pela rede, deverá fornecer a eles o código-fonte correspondente conforme a AGPL. Há uma [licença comercial](../../COMMERCIAL-LICENSE.md) para produtos proprietários e serviços hospedados que não possam cumprir a AGPL. O nome e o logotipo são regidos pela [política de marcas](../../TRADEMARKS.md).
