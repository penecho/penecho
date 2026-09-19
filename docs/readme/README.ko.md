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
  <strong>한국어</strong> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.pt-BR.md">Português (Brasil)</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.de.md">Deutsch</a>
</p>

<h1 align="center">AI와 함께 생각하는<br>공간형 작업 환경.</h1>
<p align="center">내장 Agent 또는 MCP 호환 AI 어시스턴트로 그리고, 탐색하고, 만들어 보세요.</p>
<p align="center">
  <img src="https://img.shields.io/badge/version-1.3.3-087f83" alt="버전 1.3.3">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="AGPL-3.0-only"></a>
</p>
<p align="center">
  <a href="https://penecho.ai">웹사이트</a> ·
  <a href="https://github.com/penecho/penecho/releases/latest">다운로드</a> ·
  <a href="#quick-start">빠른 시작</a> ·
  <a href="../mcp-setup.md">MCP 가이드</a> ·
  <a href="https://discord.gg/3jrPJ3mXdX">Discord</a>
</p>

<p align="center">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_full_demo.webp" alt="PenEcho 전체 데모" width="49%">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins.webp" alt="PenEcho 전문 다이어그램 데모" width="49%">
</p>

<p align="center">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins_sub_x10.webp" alt="PenEcho 플러그인 데모" width="49%">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/play_patris.webp" alt="PenEcho 대화형 캔버스 데모" width="49%">
</p>

<p align="center">
  <a href="https://www.kimi.com/code?aff=penecho">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="../assets/kimi-open-source-friends-dark.svg">
      <img src="../assets/kimi-open-source-friends-light.svg" alt="Kimi Open Source Friends" width="326" height="56">
    </picture>
  </a>
</p>

## AI 대화를 공간으로 확장하세요

**Codex, Claude, Kimi 등 AI 에이전트**와 대화를 이어 가세요. 작업 결과는 PenEcho에 펼쳐 놓으세요.

MCP를 통해 AI는 설명을 다이어그램으로, 아이디어를 대화형 미리보기로 바꿀 수 있습니다. 참고 자료, 생각, 결과물을 나란히 두고 캔버스에 주석을 달아 다음 대화에 피드백을 반영하세요.

| 대화 이어 가기 | 결과가 만들어지는 과정 보기 | 피드백 전달하기 |
| --- | --- | --- |
| 평소 사용하던 AI 에이전트로 작업합니다. | PenEcho의 MCP 서버가 다이어그램, 문서, 대화형 미리보기를 Canvas에 배치합니다. | 결과를 사용해 보고 주석을 달면 에이전트가 피드백을 읽고 다음 수정에 반영합니다. |

<p align="center">
  <a href="../assets/mcp-spatial-example.webp">
    <img src="../assets/mcp-spatial-example.webp" alt="PenEcho Canvas의 설계안 옆에 손글씨 피드백을 남긴 AI 아키텍처 논의" width="760">
  </a>
</p>
<p align="center"><em>Canvas에 손글씨 주석을 더한 아키텍처 논의.</em></p>

<!-- professional-diagram-gallery -->
<p align="center">다양한 <strong>전문 다이어그램</strong>을 그리고, 편리하게 살펴보며 상호작용하세요.</p>

<table width="100%">
  <tr>
    <th colspan="2" align="left">아키텍처 다이어그램</th>
  </tr>
  <tr>
    <td width="50%" align="center" valign="middle">
      <a href="../assets/professional-diagrams/kubernetes.webp"><img src="../assets/professional-diagrams/previews/kubernetes.webp" alt="Kubernetes 프로덕션 클러스터" width="100%"></a>
    </td>
    <td width="50%" align="center" valign="middle">
      <a href="../assets/professional-diagrams/migration.webp"><img src="../assets/professional-diagrams/previews/migration.webp" alt="모놀리스에서 마이크로서비스로" width="100%"></a>
    </td>
  </tr>
  <tr>
    <td valign="top"><strong>Kubernetes 프로덕션 클러스터</strong></td>
    <td valign="top"><strong>모놀리스에서 마이크로서비스로</strong></td>
  </tr>
  <tr>
    <th colspan="2" align="left">시퀀스 다이어그램</th>
  </tr>
  <tr>
    <td width="50%" align="center" valign="middle">
      <a href="../assets/professional-diagrams/notifications.webp"><img src="../assets/professional-diagrams/previews/notifications.webp" alt="이벤트 기반 알림" width="100%"></a>
    </td>
    <td width="50%" align="center" valign="middle">
      <a href="../assets/professional-diagrams/mcp-request.webp"><img src="../assets/professional-diagrams/previews/mcp-request.webp" alt="MCP 요청이 Canvas에 도달하는 과정" width="100%"></a>
    </td>
  </tr>
  <tr>
    <td valign="top"><strong>이벤트 기반 알림</strong></td>
    <td valign="top"><strong>MCP 요청이 Canvas에 도달하는 과정</strong></td>
  </tr>
  <tr>
    <th colspan="2" align="left">워크플로</th>
  </tr>
  <tr>
    <td width="50%" align="center" valign="middle">
      <a href="../assets/professional-diagrams/release.webp"><img src="../assets/professional-diagrams/previews/release.webp" alt="릴리스 준비: 병렬 작업과 합류" width="100%"></a>
    </td>
    <td width="50%" align="center" valign="middle">
      <a href="../assets/professional-diagrams/rollout.webp"><img src="../assets/professional-diagrams/previews/rollout.webp" alt="다중 리전 배포와 롤백" width="100%"></a>
    </td>
  </tr>
  <tr>
    <td valign="top"><strong>릴리스 준비: 병렬 작업과 합류</strong></td>
    <td valign="top"><strong>다중 리전 배포와 롤백</strong></td>
  </tr>
</table>

<p align="center"><sub>이미지를 클릭하면 원본 크기로 볼 수 있습니다.</sub></p>
<!-- /professional-diagram-gallery -->

**완성되기 전부터 확인하세요.** AI와 대화하며 결과가 만들어지는 과정을 보고, 직접 사용해 보고, 피드백을 주며 함께 프로젝트를 진행하세요.

[MCP로 에이전트 연결 →](#connect-your-agent-with-mcp)

## 할 수 있는 일

- **시각적으로 작업하세요.** 넓은 캔버스에 손글씨, 수식, 텍스트, 이미지, 다이어그램, 대화형 HTML Widgets를 함께 배치합니다.
- **AI와 창작하세요.** 내장 Agent로 조사하고, 파일을 다루고, 아이디어를 설명하고, 편집 가능한 시각적 결과물을 만듭니다.
- **자신의 에이전트를 연결하세요.** Codex, Claude Code 등 MCP 호환 클라이언트를 연결해 명시적으로 활성화한 Canvas를 읽고 편집합니다.
- **작업을 보관하고 공유하세요.** Canvas를 프로젝트로 정리하고, Cloud 버전을 저장하고, 즐겨찾기를 동기화하고, Echoes로 게시합니다.

## 1.3.3의 새로운 기능

| 다이어그램 | 그릴 수 있는 내용 |
| --- | --- |
| **아키텍처 다이어그램** | 서비스, 의존 관계, 중첩된 시스템 경계를 자동 배치하고 연결선 경로를 계산합니다. |
| **시퀀스 다이어그램** | 참여자와 메시지 순서를 표현하며 응답, 자기 호출, 조건·반복·병렬 구간을 지원합니다. |
| **워크플로** | 단계, 판단, 조건이 표시된 분기, 반복, 분기와 합류가 있는 병렬 흐름을 그립니다. |

PenEcho Agent 또는 MCP로 연결한 에이전트에 요구 사항을 설명하세요. Canvas에서 세부 내용을 확인하고 피드백으로 수정한 뒤 SVG / PNG로 내보낼 수 있습니다.

[전체 변경 기록](../../CHANGELOG.md#133)

## 작동 방식

<p align="center">
  <img src="../../public/penecho-architecture.webp" alt="PenEcho 구조: 브라우저가 PenEcho Cloud 또는 로컬 PC에 연결됩니다. Cloud는 호스팅 모델을 제공하고 연결된 기기에도 연결할 수 있습니다. PC는 자신의 LLM API 또는 에이전트와 함께 PenEcho CLI나 앱을 실행합니다. 외부 AI 에이전트의 Cloud MCP 및 Local MCP 연결은 모두 선택 사항입니다." width="1483">
</p>

PenEcho Cloud 또는 CLI나 데스크톱 앱을 실행하는 로컬 PC를 통해 브라우저에서 PenEcho를 엽니다. Cloud는 호스팅 모델을 제공하고 연결된 기기에도 접근할 수 있습니다. PC에서는 자신의 모델 API나 에이전트를 사용할 수 있습니다. Codex, Claude 등 외부 AI 에이전트는 Cloud MCP 또는 Local MCP로 연결할 수 있으며, 두 연결 모두 선택 사항입니다.

구현 세부 사항은 [아키텍처 설명](../architecture.md)을 참고하세요.

<a id="quick-start"></a>

## 빠른 시작

**데스크톱:** [GitHub Releases](https://github.com/penecho/penecho/releases/latest)에서 Windows 또는 macOS 앱을 다운로드하세요.

**npm:** Node.js **22.19 이상**이 필요합니다.

```bash
npm install -g penecho
penecho
```

`http://localhost:3888`을 엽니다. **설정 → 연결**에서 자신의 모델 API 또는 인증된 Codex, Claude Code, Kimi CLI를 추가합니다. 연결은 `~/.penecho/connections.json`에 저장되며 일반 설정은 `~/.penecho/config.env`에 유지됩니다. PenEcho 호스팅 모델은 로그인 후 설정에서 사용 가능한 모델을 선택하세요.

시작할 때 6자리 접근 코드를 설정하거나 신뢰하는 네트워크에서 공개 접근을 명시적으로 활성화하세요. 다른 기기가 접속할 수 있는 LAN 주소도 시작 시 표시됩니다.

<details>
<summary>소스에서 실행</summary>

```bash
git clone https://github.com/penecho/penecho.git
cd penecho
npm install
npm start
```

</details>

<a id="connect-your-agent-with-mcp"></a>

## MCP로 에이전트 연결

**Local MCP**의 경우:

1. PenEcho를 시작하고 **설정 → MCP 서비스**에서 현재 Canvas를 활성화합니다.
2. 설정에서 지원되는 로컬 클라이언트를 구성하거나 생성된 실행 설정을 복사합니다. npm 전역 설치의 경우 `mcpServers` JSON을 지원하는 클라이언트는 다음 설정을 사용할 수 있습니다.

   ```json
   {
     "mcpServers": {
       "penecho": { "command": "penecho", "args": ["mcp"] }
     }
   }
   ```

3. 에이전트에게 요청하세요: **“우리가 논의한 아키텍처를 내 PenEcho Canvas에 보여 줘.”**

에이전트는 관련 콘텐츠를 캡처하고, 객체를 편집하고, 시각적 결과를 만들고, 문서 소스 파일을 패치하고, 피드백을 받을 수 있습니다. 활성화되어 연결된 Canvas만 검색됩니다. Local MCP에서는 MCP 클라이언트가 PenEcho 호스트에서 실행됩니다. LAN 및 연결된 기기의 브라우저 지원은 로컬 MCP 엔드포인트를 공개적으로 노출하지 않습니다. Cloud MCP는 활성화된 PenEcho Cloud 캔버스를 위한 별도의 인증된 HTTPS 연결입니다.

데스크톱 설치에서는 올바른 번들 런타임이 포함된 생성 설정을 사용하세요. [MCP 설정](../mcp-setup.md)과 선택 사항인 [에이전트 워크플로 스킬](../../skills/penecho-mcp/SKILL.md)을 참고하세요.

## PenEcho Cloud와 AI 연결

[PenEcho Cloud](https://penecho.ai)는 비공개 프로젝트 버전 관리, 즐겨찾기 동기화, Echoes를 통한 공개 공유, 연결된 컴퓨터 원격 접근을 제공합니다.

| 연결 | 작동 방식 |
| --- | --- |
| **PenEcho 모델** | 로그인하고 사용 가능한 호스팅 모델을 선택해 계정 크레딧으로 사용합니다. 설정에 현재 요금과 잔액이 표시됩니다. |
| **자신의 모델 API** | OpenAI 또는 Anthropic 호환 엔드포인트, 모델, API 키를 구성합니다. 사용량은 제공업체가 처리합니다. |
| **자신의 CLI** | 로컬에 설치하고 인증한 Codex, Claude Code, Kimi CLI를 사용합니다. 이용 가능 여부와 사용량은 해당 제공업체의 요금제에 따릅니다. |

컴퓨터에서 호스팅 모델을 사용하려면 Cloud 로그인이 필요하지만 기기 페어링이나 별도 Credits API 키는 필요하지 않습니다. Cloud MCP는 활성화된 Cloud 캔버스에 직접 접근할 수 있습니다. 컴퓨터에서 호스팅하는 Canvas에 Cloud를 통해 접근하려면 연결된 기기가 온라인 상태여야 하고 필요한 릴레이 기능을 지원해야 합니다.

자신의 API 및 CLI 연결은 PenEcho 크레딧을 소비하지 않습니다. 자신의 연결로 로컬에서 사용할 때 Cloud 계정은 선택 사항입니다. AI 기능에는 선택한 제공업체에 대한 접근이 필요하며, PenEcho를 로컬에서 실행해도 원격 모델을 오프라인으로 사용할 수는 없습니다.

## 권장 모델 설정

현재의 실제 테스트를 바탕으로 PenEcho의 실제 캔버스 작업에서 답변 품질과 지연 시간의 균형을 고려한 권장 설정입니다. 실제 응답 시간은 제공업체, 캔버스 복잡도, 추론 동작에 따라 달라집니다.

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

## 커뮤니티와 라이선스

기여하려면 [CONTRIBUTING.md](../../CONTRIBUTING.md)를 읽고 풀 리퀘스트 전에 `npm run check`를 실행하세요. 버그는 [Issues](https://github.com/penecho/penecho/issues), 아이디어는 [Discussions](https://github.com/penecho/penecho/discussions), 커뮤니티 참여는 [Discord](https://discord.gg/3jrPJ3mXdX)를 이용하세요.

[AGPL-3.0-only](../../LICENSE) 라이선스가 적용됩니다. 별도의 [상용 라이선스](../../COMMERCIAL-LICENSE.md)도 이용할 수 있습니다. [상표 정책](../../TRADEMARKS.md)과 [기여자 계약](../../CONTRIBUTOR-LICENSE-AGREEMENT.md)을 확인하세요.

## 감사의 말

tt-a1i의 [Archify](https://github.com/tt-a1i/archify) 프로젝트에 감사드립니다. PenEcho의 전문 다이어그램 렌더러는 이 MIT 라이선스 프로젝트의 SVG 및 기하 처리 보조 코드를 수정해 사용합니다. [MIT 라이선스와 저작권 고지](../../src/architecture/vendor/archify/LICENSE)를 보존하고 있으며, 제3자 출처는 [NOTICE](../../NOTICE)에서 확인할 수 있습니다.

## 스타 기록

<p align="center">
  <a href="https://www.star-history.com/?repos=penecho%2Fpenecho&amp;type=date&amp;legend=top-left">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=penecho/penecho&amp;type=date&amp;theme=dark&amp;legend=top-left">
      <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=penecho/penecho&amp;type=date&amp;legend=top-left">
      <img src="https://api.star-history.com/chart?repos=penecho/penecho&amp;type=date&amp;legend=top-left" alt="PenEcho GitHub 스타 증가 기록 차트" width="800">
    </picture>
  </a>
</p>
