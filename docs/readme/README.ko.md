<h1 align="center">
  <img src="../../public/penecho-readme-header.png" alt="PenEcho" width="760">
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

<p align="center"><strong>채팅창을 넘어 AI와 함께 생각하세요.</strong></p>

<p align="center">PenEcho는 손글씨, 수식, 다이어그램, 공간적 맥락을 대화의 일부로 만드는 공유 캔버스입니다.</p>

<h2 align="center">
  <a href="https://penecho.ai">공식 웹사이트 · penecho.ai</a>
</h2>

<h3 align="center"><a href="https://penecho.ai">아이디어 게시 · 공동 작업 · 결과 공유</a></h3>

<p align="center">
  <a href="https://discord.gg/3jrPJ3mXdX"><img src="https://img.shields.io/badge/Discord-커뮤니티%20참여-5865F2?style=for-the-badge&amp;logo=discord&amp;logoColor=white" alt="PenEcho Discord 참여"></a>
  <a href="https://github.com/penecho/penecho/stargazers"><img src="https://img.shields.io/github/stars/penecho/penecho?style=for-the-badge&amp;logo=github&amp;logoColor=white&amp;color=f5b301" alt="GitHub에서 PenEcho에 스타 주기"></a>
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/License-AGPL%20v3-blue?style=for-the-badge" alt="라이선스: AGPL v3"></a>
</p>

> 이 번역은 프로젝트 개요를 제공합니다. 최신 전체 기술 정보는 공식 원문인 [영문 README](../../README.md)를 참조하세요.

<p align="center"><img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins.webp" alt="PenEcho 전문 다이어그램 데모" width="49%"> <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_full_demo.webp" alt="PenEcho 전체 데모" width="49%"></p>

<p align="center"><img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins_sub_x10.webp" alt="PenEcho 플러그인 데모" width="49%"> <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/play_patris.webp" alt="PenEcho 대화형 캔버스 데모" width="49%"></p>

## Kimi Open Source Friends

PenEcho는 [Moonshot AI](https://www.kimi.com/)가 뛰어난 오픈 소스 프로젝트를 지원하는 **Kimi Open Source Friends**의 공식 멤버입니다. Kimi 팀은 API 크레딧으로 개발을 지원하며, Kimi K3는 손글씨와 다이어그램을 다루는 복잡한 캔버스 작업에 권장되는 모델 중 하나입니다.

- [Kimi Code](https://www.kimi.com/code?aff=penecho) - 전 세계에서 이용할 수 있는 코딩 구독
- [Kimi Open Platform 중국](https://platform.kimi.com?aff=penecho) - 중국 본토용 API
- [Kimi Open Platform 글로벌](https://platform.kimi.ai?aff=penecho) - 기타 지역용 API

## 빠른 시작

### 데스크톱 앱

[GitHub Releases에서 다운로드](https://github.com/penecho/penecho/releases/latest).

npm으로 설치하려면 [Node.js 22.19 이상](https://nodejs.org/)과 API 키, 로그인된 [Kimi Code CLI](https://github.com/MoonshotAI/kimi-code), [Codex CLI](https://developers.openai.com/codex/cli), 또는 [Claude Code CLI](https://code.claude.com/docs/en/overview) 중 하나가 필요합니다.

```bash
npm install -g penecho
penecho configure
penecho
```

브라우저에서 [http://localhost:3888](http://localhost:3888)을 여세요. `penecho configure`에서 LLM 소스, 모델, 추론 수준, 제한 시간, 이미지 형식, 수신 주소를 대화형으로 설정할 수 있습니다. 설정은 기본적으로 `~/.penecho/config.env`에 저장되며 API 자격 증명은 브라우저로 전송되지 않습니다.

소스에서 실행하려면:

```bash
git clone https://github.com/penecho/penecho.git
cd penecho
npm install
npm start
```

## 캔버스에서 생각하기

질문, 수식, 다이어그램 또는 아직 다듬어지지 않은 아이디어를 캔버스 어디에나 쓰고 잠시 기다리세요. PenEcho는 획과 공간적 관계를 읽고 관련 위치에 답을 배치합니다.

- **PenEcho Agent: 자료에서 시각적 결과물까지.** PDF, Word, PowerPoint, Excel, 이미지, 코드 같은 읽기 전용 폴더와 파일을 추가하고 웹 조사 및 현재 캔버스와 결합해, 같은 Agent가 분석·계획·제작·수정을 이어가게 할 수 있습니다.
- **Visual Explorer로 생산성 향상.** 밀도 높은 정보를 명확한 전체 보기, 연결된 세부 정보와 근거가 있는 반응형·편집 가능한 시각 작업 공간으로 바꿉니다. 조사에서 공유 가능한 결과까지의 경로를 줄이고 복사·붙여넣기, 도구 전환, 수동 다이어그램 작성과 재작업을 줄입니다.
- 스타일러스나 마우스로 자연스럽게 그리고 `20,000 x 20,000` 캔버스를 이동하고 확대·축소합니다.
- 답변, 힌트, 설명, 수식, 그래프, 다이어그램을 캔버스에서 바로 받습니다.
- AI 초안을 이동하거나 크기를 조정한 뒤 작업에 포함하기 전에 개별적으로 승인하거나 폐기합니다.
- 올가미로 필기를 선택해 이동, 크기 조정, 색상 변경, 삭제 또는 Typeset 정리를 수행합니다.
- 대화형 위젯, 전문 다이어그램, 애니메이션과 실시간 데이터 플러그인을 증분 수정으로 제자리에서 다듬습니다.
- API 또는 CLI 연결을 최대 10개 저장하고 한 번의 클릭으로 전환합니다.
- 캔버스를 프로젝트로 정리하고 PenEcho Cloud를 통해 다른 기기에서 비공개 프로젝트를 이어가며 확정된 콘텐츠를 PNG로 내보냅니다.
- Arcane, Sci-fi, Research, Studio 테마를 선택할 수 있습니다.

## PenEcho Cloud

1.0.0에서 도입된 [PenEcho Cloud](https://penecho.ai)는 완전히 선택 사항입니다. 자체 API 또는 CLI를 사용하면 PenEcho는 계속 로컬에서 온전히 작동합니다. 로그인하면 비공개 버전 캔버스를 프로젝트에 저장하고 즐겨찾기를 동기화하며, 연결된 기기를 통해 이 호스트에 원격으로 접근할 수 있습니다. API 자격 증명은 기기 밖으로 나가지 않습니다.

**Echoes**에서는 12개 카테고리의 공개 캔버스와 위젯을 탐색하고 즐겨찾기에 추가하거나 재사용할 수 있습니다. 자신의 Craft를 게시하고 읽기 전용 웹 뷰어로 공유하며 버전 간 계보를 유지할 수도 있습니다.

## 1.1.0의 새로운 기능

- **PenEcho Agent.** 로컬 파일, 읽기 전용 폴더 프로젝트, 웹 조사, 캔버스 맥락, 시각 제작과 직접 편집을 하나의 다단계 작업 흐름에서 처리합니다.
- **Visual Explorer.** 조사, 문서, 메모와 계획을 전체 보기에서 세부 정보와 근거로 이어지는 반응형 시각 결과물로 변환합니다.
- **맥락 전환과 재작업 감소.** 조사, 분석, 구조화, 시각화, 검토와 수정을 같은 작업 공간에서 수행하고 결과를 캔버스에서 계속 편집할 수 있습니다.
- **점진적 시각 결과 제공.** 완전한 Visual Explorer 버전을 더 일찍 받아 그 자리에서 다듬을 수 있어 매번 처음부터 다시 생성할 필요가 없습니다.
- **더 넓은 작업 맥락.** PDF, Word, PowerPoint, Excel, 이미지, 코드, 읽기 전용 폴더, 기존 Widget과 필기를 추가하고 가능할 때 인터넷 검색을 사용합니다.

## 이전 주요 업데이트

- **1.0.0.** PenEcho Cloud, 비공개 버전 프로젝트, 연결된 기기, Echoes, 공개 Craft와 즐겨찾기 동기화를 도입했습니다.
- **0.9.0.** 여러 AI 연결, 프로젝트 기반 공유 캔버스, 제자리 Refine, unified diff 증분 수정, SSE 스트리밍과 진행 상태 및 취소를 추가했습니다.
- **0.8.1.** General HTML의 실시간 공개 데이터와 애니메이션 및 복잡한 그래픽용 SVG 우선 표시를 추가했습니다.
- **0.8.0 및 0.7.2.** 편집 가능한 전문 다이어그램, 서버 저장, 클립보드 워크플로, 출처가 있는 웹 사진과 더 안정적인 편집 및 내보내기를 추가했습니다.

## 이전 릴리스

- **0.7.1.** 로컬 이미지와 사진, Hand 개체 편집, 스냅샷, PNG 내보내기, 복사 가능한 Mermaid 다이어그램과 출처가 있는 웹 이미지를 추가했습니다.
- **0.7.0.** 격리된 대화형 HTML, 실시간 데이터 플러그인, 로컬 플러그인 생성과 위젯 저장을 도입했습니다.
- **0.6.0 이전.** 선언형 애니메이션, Markdown/LaTeX 개선, 선택 도구와 대형 희소 캔버스 기반을 추가했습니다.

## 작동 방식

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="../assets/how-it-works-dark.svg"><img alt="PenEcho 작동 방식" src="../assets/how-it-works-light.svg"></picture></p>

브라우저는 관련 캔버스 영역과 기하 정보만 전송합니다. 서버는 요청을 검증해 선택한 실행기로 전달하고 이동 가능한 구조화 초안을 반환합니다. 최신 모델 권장 사항과 비용 예시는 [영문 README](../../README.md#recommended-model-configurations)를 참조하세요.

## 안전한 배포

- **Kimi Code CLI, Codex CLI 및 Claude CLI:** 로컬 컴퓨터나 신뢰할 수 있는 LAN에서만 사용하세요. 유효한 요청은 로컬 CLI 프로세스를 시작하므로 이 모드를 인터넷에 직접 공개하지 마세요.
- **API 모드:** 공개할 경우 HTTPS, 인증, 요청 빈도와 크기 제한을 적용한 리버스 프록시 뒤에 배치하세요.
- 설정 파일, API 키, 요청 추적, 로그 또는 비공개 캔버스 이미지를 공개하지 마세요.

## 개발 참여

변경 사항을 제출하기 전에 다음을 실행하세요.

```bash
npm run check
```

구현 정보는 [아키텍처 문서](../architecture.md), 기여 절차는 [CONTRIBUTING.md](../../CONTRIBUTING.md)를 참조하세요. 질문과 사용 사례는 [Discord](https://discord.gg/3jrPJ3mXdX) 또는 [GitHub Discussions](https://github.com/penecho/penecho/discussions)에 공유하고, 재현 가능한 문제는 [GitHub Issues](https://github.com/penecho/penecho/issues)에 등록해 주세요.

## 라이선스 및 상업적 이용

PenEcho는 [GNU AGPL v3.0 only](../../LICENSE)로 공개됩니다. 상업적 이용은 허용되지만, 수정한 버전을 네트워크를 통해 사용자에게 제공하는 경우 AGPL에 따라 해당 소스 코드를 제공해야 합니다. AGPL을 준수할 수 없는 독점 제품과 호스팅 서비스에는 별도의 [상업용 라이선스](../../COMMERCIAL-LICENSE.md)가 제공됩니다. 이름과 로고에는 [상표 정책](../../TRADEMARKS.md)이 별도로 적용됩니다.
