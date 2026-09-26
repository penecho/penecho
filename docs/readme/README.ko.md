<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../public/penecho-readme-header-dark.webp">
    <img src="../../public/penecho-readme-header.webp" alt="PenEcho" width="280">
  </picture>
</p>

<h1 align="center">어떤 AI와도 캔버스에서 생각하세요.</h1>

<p align="center">손으로 스케치하세요. PenEcho의 내장 Agent나 Codex, Claude Code, 모든 MCP 클라이언트가 메모 옆에 다이어그램, 문서, 작동하는 위젯을 만듭니다.</p>

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
  <a href="#quick-start">빠른 시작</a> ·
  <a href="#connect-your-ai-agent-mcp">AI 에이전트 연결(MCP)</a> ·
  <a href="../">문서</a> ·
  <a href="https://discord.gg/3jrPJ3mXdX">Discord</a>
</p>

<p align="center"><sub><a href="../../README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <strong>한국어</strong> ·
  <a href="README.ru.md">Русский</a> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.pt-BR.md">Português</a> ·
  <a href="README.fr.md">Français</a> ·
  <a href="README.de.md">Deutsch</a></sub></p>

<p align="center">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_full_demo.webp" alt="PenEcho" width="100%">
</p>
<p align="center"><em>손그림에서 상호작용하는 결과까지, 하나의 캔버스에서.</em></p>

## 할 수 있는 일

<table width="100%">
  <tr>
    <td width="33%" valign="top">
      <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins_sub_x10.webp" alt="스케치하고 질문하기" width="100%"><br>
      <strong>스케치하고 질문하기</strong><br>
      무한 캔버스에 손글씨, 수식, 텍스트, 이미지를 놓으세요. 잠시 멈추면 AI가 자동으로 답합니다.
    </td>
    <td width="33%" valign="top">
      <a href="../assets/professional-diagrams/kubernetes.webp"><img src="../assets/professional-diagrams/previews/kubernetes.webp" alt="Kubernetes 클러스터" width="100%"></a><br>
      <strong>전문 다이어그램</strong><br>
      자동 레이아웃을 지원하는 아키텍처, 시퀀스, 워크플로 다이어그램을 SVG나 PNG로 내보낼 수 있습니다.
    </td>
    <td width="33%" valign="top">
      <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/play_patris.webp" alt="작동하는 위젯" width="100%"><br>
      <strong>작동하는 위젯</strong><br>
      계산기, 퀴즈, 프로토타입을 캔버스에서 실행하고 즐겨찾기에 추가하거나 공유할 수 있습니다.
    </td>
  </tr>
</table>

<a id="quick-start"></a>
## 빠른 시작

| | 시작 방법 |
| --- | --- |
| **데스크톱 앱** | [GitHub Releases](https://github.com/penecho/penecho/releases/latest)에서 macOS 또는 Windows 버전을 받으세요. 모든 기능을 포함하며 자동으로 업데이트됩니다. |
| **npm** | Node.js 22.19 이상이 필요합니다. `npm i -g penecho` 다음 `penecho`를 실행하고 `localhost:3888`을 여세요. |
| **브라우저** | [penecho.ai](https://penecho.ai)에 로그인하면 설치 없이 호스팅 모델과 Cloud 캔버스를 사용할 수 있습니다. |

```bash
npm install -g penecho
penecho             # http://localhost:3888
```

> [!TIP]
> 처음 시작할 때 6자리 접근 코드를 설정하거나 신뢰할 수 있는 네트워크에서 공개 접근을 선택하세요. **설정 → AI 및 연결**에서 API 키, 로그인된 Codex / Claude Code / Kimi CLI 또는 PenEcho 모델을 추가합니다.

<details>
<summary>소스에서 실행</summary>

```bash
git clone https://github.com/penecho/penecho.git
cd penecho
npm install
npm start
```

</details>

<a id="connect-your-ai-agent-mcp"></a>
## AI 에이전트 연결(MCP)

익숙한 에이전트에서 대화를 이어가세요. 에이전트가 캔버스에 그리면 주석을 달 수 있고, 다음 턴에 에이전트가 그 피드백을 읽습니다.

1. PenEcho에서 **설정 → MCP 서비스**를 열고 현재 캔버스를 활성화합니다.
2. 지원되는 클라이언트는 **자동 설정**을 사용하거나 생성된 설정 프롬프트를 Codex, Claude Code, Kimi, Cursor 등에 붙여 넣으세요. npm 전역 설치에서는 `mcpServers` JSON을 받는 클라이언트에 아래 호환 설정도 사용할 수 있습니다.

   ```json
   {
     "mcpServers": {
       "penecho": { "command": "penecho", "args": ["mcp"] }
     }
   }
   ```

3. *“방금 이야기한 아키텍처를 내 PenEcho 캔버스에 보여줘.”*라고 요청하세요.

<p align="center"><a href="../assets/mcp-spatial-example.webp"><img src="../assets/mcp-spatial-example.webp" alt="PenEcho Canvas의 설계안 옆에 손글씨 피드백을 남긴 AI 아키텍처 논의" width="760"></a></p>
<p align="center"><em>Claude Code와 논의한 아키텍처에 캔버스에서 손글씨 주석을 더한 모습.</em></p>

> [!NOTE]
> 에이전트는 사용자가 활성화한 캔버스만 볼 수 있습니다. Local MCP는 컴퓨터에서 실행되고, Cloud MCP는 Cloud 캔버스를 위한 별도의 로그인 연결입니다. [MCP 가이드 →](../mcp-setup.md)

## 다이어그램 갤러리

<table width="100%">
  <tr>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/kubernetes.webp"><img src="../assets/professional-diagrams/previews/kubernetes.webp" alt="Kubernetes 클러스터" width="100%"></a><br><strong>Kubernetes 클러스터</strong></td>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/migration.webp"><img src="../assets/professional-diagrams/previews/migration.webp" alt="모놀리스 → 마이크로서비스" width="100%"></a><br><strong>모놀리스 → 마이크로서비스</strong></td>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/notifications.webp"><img src="../assets/professional-diagrams/previews/notifications.webp" alt="이벤트 기반 알림" width="100%"></a><br><strong>이벤트 기반 알림</strong></td>
  </tr>
  <tr>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/mcp-request.webp"><img src="../assets/professional-diagrams/previews/mcp-request.webp" alt="MCP가 캔버스에 연결되는 방식" width="100%"></a><br><strong>MCP가 캔버스에 연결되는 방식</strong></td>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/release.webp"><img src="../assets/professional-diagrams/previews/release.webp" alt="릴리스: 병렬 작업" width="100%"></a><br><strong>릴리스: 병렬 작업</strong></td>
    <td width="33%" valign="top"><a href="../assets/professional-diagrams/rollout.webp"><img src="../assets/professional-diagrams/previews/rollout.webp" alt="다중 리전 배포" width="100%"></a><br><strong>다중 리전 배포</strong></td>
  </tr>
</table>

<p align="center"><sub>다이어그램을 클릭하면 전체 크기로 볼 수 있습니다.</sub></p>

## 작동 방식

<p align="center"><img src="../../public/penecho-architecture.webp" alt="PenEcho 구조: 브라우저가 PenEcho Cloud 또는 로컬 PC에 연결됩니다. Cloud는 호스팅 모델을 제공하고 연결된 기기에도 연결할 수 있습니다. PC는 자신의 LLM API 또는 에이전트와 함께 PenEcho CLI나 앱을 실행합니다. 외부 AI 에이전트의 Cloud MCP 및 Local MCP 연결은 모두 선택 사항입니다." width="100%"></p>

- **내 컴퓨터에서** — 데스크톱 앱 또는 CLI가 캔버스를 제공하고 자체 모델 API나 Agent CLI를 사용합니다.
- **클라우드에서** — penecho.ai는 호스팅 모델과 동기화되는 프로젝트 및 즐겨찾기를 제공하며 연결된 컴퓨터에 접근할 수 있습니다.
- **내 에이전트** — Local 또는 Cloud MCP로 연결하며 둘 다 선택 사항입니다.

자세한 내용: [아키텍처 문서](../architecture.md).

## AI 선택하기

| 연결 | 비용 | 적합한 용도 |
| --- | --- | --- |
| **PenEcho 모델** — 로그인 후 모델 선택 | 계정 크레딧 | 키 없이 빠르게 시작 |
| **자체 모델 API** — OpenAI / Anthropic | 제공업체 요금 | 모델과 비용을 직접 관리 |
| **자체 CLI** — Codex, Claude Code, Kimi | 기존 요금제 | 기존 구독 활용 |

모델과 추론 강도 선택 방법: [권장 모델](#recommended-models) (릴리스마다 업데이트).

<a name="recommended-models"></a>
<details>
<summary>권장 모델</summary>

현재 실사용 테스트를 바탕으로 PenEcho 캔버스 작업의 답변 품질과 지연 시간 간 균형을 고려했습니다. 실제 응답 시간은 제공업체, 캔버스 복잡도, 추론 방식에 따라 달라집니다.

| 모델 | 추론 강도 | 설명 | 권장 용도 |
| --- | --- | --- | --- |
| Claude Opus 4.8 / 5.0 (`claude-opus-4-8` / `claude-opus-5-0`) | `medium` | 우수한 품질과 더 나은 지연 시간 균형 | 일상적인 캔버스 작업 |
| Claude Opus 4.8 / 5.0 (`claude-opus-4-8` / `claude-opus-5-0`) | `high` | 더 높은 추론 품질, 더 길고 변동이 큰 대기 시간 | 복잡한 손글씨, 수학, 다이어그램, 레이아웃 |
| Fable 5 (`claude-fable-5` 또는 `fable`) | `medium` | 응답 시간이 `gpt-5.6-sol`의 `xhigh` 설정 대비 약 절반인 경우가 많음 | 빠르고 품질 높은 범용 작업 |
| [Kimi K3](https://platform.kimi.ai?aff=penecho) (`kimi-k3`) | `medium` | 매우 좋은 품질, `medium`에서 실용적인 균형 유지 | Kimi 권장 기본값 |
| `gpt-5.6-terra` | `low` ~ `high` | 기대 이상으로 강력하고 반응성이 좋음 | 다양한 품질 및 지연 시간 목표 |
| `gpt-5.6-luna` | `xhigh` | 매우 좋은 캔버스 결과와 빠른 속도 | 품질을 우선하면서 반응성도 유지 |
| `gpt-5.6-sol` | `high` | 대부분의 요청에 충분하며 `xhigh`보다 빠르게 반응 | 반응성이 중요할 때의 기본값 |
| `gpt-5.6-sol` | `xhigh` | 매우 좋지만 더 느리고 변동이 큼 | 어려운 캔버스 작업 |
| `deepseek-v4-flash-vision-exp` | `medium` | 좋음 | DeepSeek API를 통한 시각 인식 작업 |
| `glm-5.3-flash` | `medium` | 좋음 | GLM Anthropic 호환 API를 통한 빠른 작업 |

</details>

## 1.3.5의 새로운 기능

- **UI:** 인터페이스의 사소한 문제를 수정했습니다.
- **캔버스 동시 편집:** Canvas AI, Agent, MCP가 같은 캔버스를 동시에 수정할 수 있도록 지원합니다.

[전체 변경 기록 →](../../CHANGELOG.md#135)

## 커뮤니티

| [Discord](https://discord.gg/3jrPJ3mXdX) | [Discussions](https://github.com/penecho/penecho/discussions) | [Issues](https://github.com/penecho/penecho/issues) | [Contributing](../../CONTRIBUTING.md) |
| --- | --- | --- | --- |
| 팀과 대화 | 아이디어와 질문 | 버그 신고 | 먼저 실행: `npm run check` |

[AGPL-3.0-only](../../LICENSE) 라이선스로 제공하며 [상용 라이선스](../../COMMERCIAL-LICENSE.md)도 이용할 수 있습니다. [상표 정책](../../TRADEMARKS.md)과 [기여자 계약](../../CONTRIBUTOR-LICENSE-AGREEMENT.md)도 확인하세요.

다이어그램 렌더러는 tt-a1i의 [Archify](https://github.com/tt-a1i/archify) 에서 SVG와 기하 도우미 코드를 수정해 사용합니다(MIT). 자세한 내용은 [NOTICE](../../NOTICE).

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
