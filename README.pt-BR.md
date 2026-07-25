<h1 align="center">
  <img src="public/penecho-readme-header.png" alt="PenEcho" width="760">
</h1>

<p align="center">
  <a href="README.md">English</a> |
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
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL%20v3-blue?style=for-the-badge" alt="Licença: AGPL v3"></a>
</p>

> Esta tradução oferece uma visão geral do projeto. O [README em inglês](README.md) é a fonte oficial para as informações técnicas mais recentes e completas.

<p align="center"><img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins_sub_x10.webp" alt="Demonstração dos plugins do PenEcho" width="100%"></p>

<p align="center"><img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_full_demo.webp" alt="Demonstração completa do PenEcho" width="100%"></p>

## Kimi Open Source Friends

O PenEcho é membro oficial do **Kimi Open Source Friends**, programa da [Moonshot AI](https://www.kimi.com/) que apoia projetos de código aberto de destaque. A equipe Kimi contribui com créditos de API, e o Kimi K3 é um dos modelos recomendados para trabalhos exigentes com escrita à mão e diagramas.

- [Kimi Code](https://www.kimi.com/code?aff=penecho) - assinatura para programação disponível mundialmente
- [Kimi Open Platform, China](https://platform.kimi.com?aff=penecho) - acesso à API na China continental
- [Kimi Open Platform, global](https://platform.kimi.ai?aff=penecho) - acesso à API nas demais regiões

## Início rápido

Você precisa do [Node.js 18.17 ou mais recente](https://nodejs.org/) e de uma destas opções: uma chave de API, um [Codex CLI](https://developers.openai.com/codex/cli) autenticado ou um [Claude Code CLI](https://code.claude.com/docs/en/overview) autenticado.

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
- Salve instantâneos localmente no navegador e exporte o conteúdo confirmado como PNG.
- Escolha entre os temas Arcane, Sci-fi, Research e Studio.

## Novidades da versão 0.7.1

- **Imagens e fotos na tela.** Adicione imagens pelo seletor do sistema — biblioteca de fotos ou câmera em celulares e tablets, arquivos de imagem no desktop. Imagens grandes são reduzidas e compactadas automaticamente, mantendo telas e snapshots leves.
- **Edição com toque longo, ações claras.** Pressione e segure uma imagem para movê-la ou redimensioná-la novamente e escolha Posicionar, Mesclar ou Excluir. Posicionar mantém a imagem flutuando sob a tinta para desenhar por cima; Mesclar a transforma em traços reais que podem ser apagados.
- **Sem solicitações de IA inesperadas.** Imagens nunca iniciam solicitações de IA por conta própria; se você trabalhar com uma imagem enquanto a IA ainda está processando, o resultado em andamento é descartado e o reconhecimento de escrita é retomado automaticamente. Imagens participam de desfazer/refazer, snapshots locais e exportação PNG.

## Novidades da versão 0.7.0

- **HTML interativo na tela.** O plugin General HTML permite criar relógios, calculadoras, painéis e outras interfaces como widgets interativos isolados.
- **Dados úteis sem um serviço do PenEcho.** Plugins de clima, ações, notícias de tecnologia, câmbio, terremotos, eventos naturais, clima espacial e GitHub consultam as APIs declaradas diretamente pelo navegador.
- **Limites de segurança explícitos.** A rede de cada plugin fica restrita a uma lista de origens permitidas, o HTML roda em um iframe isolado e plugins desativados não participam das solicitações nem da execução.
- **Criação local de plugins.** Um formato Markdown compacto permite aprimorar rascunhos com IA, preencher títulos, salvar, ativar e excluir plugins pessoais em uma interface Preview.
- **Persistência e exportação nativas.** Widgets confirmados fazem parte dos instantâneos e do PNG, com suporte a movimento, redistribuição, escala e exclusão reversível.
- **Padrões sensatos.** General HTML, Animation scenes e Weather começam ativados para novos usuários; os outros plugins de dados exigem ativação explícita.

## Versões anteriores

- **0.6.0 - Animation scenes.** Adicionou animações Canvas2D declarativas e seguras, com edição e persistência em instantâneos, renderização aprimorada de Markdown/LaTeX, respostas de modelo mais robustas e verificação não bloqueante de atualizações do npm.

## Como funciona

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/how-it-works-dark.svg"><img alt="Como o PenEcho funciona" src="docs/assets/how-it-works-light.svg"></picture></p>

O navegador envia apenas o recorte relevante da tela e sua geometria. O servidor valida a solicitação, encaminha ao executor escolhido e devolve um rascunho estruturado e móvel. As recomendações atuais de modelos e os exemplos de custo estão no [README em inglês](README.md#recommended-model-configurations).

## Implantação segura

- **Codex CLI e Claude CLI:** use apenas na máquina local ou em uma rede confiável. Cada solicitação válida inicia um processo CLI local, portanto esses modos não devem ficar expostos diretamente à internet.
- **Modo API:** se houver acesso público, coloque o PenEcho atrás de um proxy HTTPS com autenticação e limites de frequência e tamanho de solicitação.
- Não publique arquivos de configuração, chaves de API, rastros de solicitações, logs ou imagens privadas da tela.

## Contribua com o projeto

Antes de enviar uma alteração, execute:

```bash
npm run check
```

Consulte as [notas de arquitetura](docs/architecture.md) e o [CONTRIBUTING.md](CONTRIBUTING.md). Compartilhe dúvidas e exemplos no [Discord](https://discord.gg/3jrPJ3mXdX) ou no [GitHub Discussions](https://github.com/penecho/penecho/discussions), e registre erros reproduzíveis no [GitHub Issues](https://github.com/penecho/penecho/issues).

## Licença e uso comercial

O PenEcho é distribuído sob a [GNU AGPL v3.0 only](LICENSE). O uso comercial é permitido, mas, se você oferecer uma versão modificada a usuários pela rede, deverá fornecer a eles o código-fonte correspondente conforme a AGPL. Há uma [licença comercial](COMMERCIAL-LICENSE.md) para produtos proprietários e serviços hospedados que não possam cumprir a AGPL. O nome e o logotipo são regidos pela [política de marcas](TRADEMARKS.md).
