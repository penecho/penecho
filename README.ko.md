<h1 align="center">
  <img src="public/penecho-readme-header.png" alt="PenEcho" width="760">
</h1>

<p align="center">
  <a href="README.md">English</a> |
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

<p align="center">
  <a href="https://discord.gg/3jrPJ3mXdX"><img src="https://img.shields.io/badge/Discord-커뮤니티%20참여-5865F2?style=for-the-badge&amp;logo=discord&amp;logoColor=white" alt="PenEcho Discord 참여"></a>
  <a href="https://github.com/penecho/penecho/stargazers"><img src="https://img.shields.io/github/stars/penecho/penecho?style=for-the-badge&amp;logo=github&amp;logoColor=white&amp;color=f5b301" alt="GitHub에서 PenEcho에 스타 주기"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL%20v3-blue?style=for-the-badge" alt="라이선스: AGPL v3"></a>
</p>

> 이 번역은 프로젝트 개요를 제공합니다. 최신 전체 기술 정보는 공식 원문인 [영문 README](README.md)를 참조하세요.

<p align="center"><img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_plugins_sub_x10.webp" alt="PenEcho 플러그인 데모" width="100%"></p>

<p align="center"><img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_full_demo.webp" alt="PenEcho 전체 데모" width="100%"></p>

## Kimi Open Source Friends

PenEcho는 [Moonshot AI](https://www.kimi.com/)가 뛰어난 오픈 소스 프로젝트를 지원하는 **Kimi Open Source Friends**의 공식 멤버입니다. Kimi 팀은 API 크레딧으로 개발을 지원하며, Kimi K3는 손글씨와 다이어그램을 다루는 복잡한 캔버스 작업에 권장되는 모델 중 하나입니다.

- [Kimi Code](https://www.kimi.com/code?aff=penecho) - 전 세계에서 이용할 수 있는 코딩 구독
- [Kimi Open Platform 중국](https://platform.kimi.com?aff=penecho) - 중국 본토용 API
- [Kimi Open Platform 글로벌](https://platform.kimi.ai?aff=penecho) - 기타 지역용 API

## 빠른 시작

[Node.js 18.17 이상](https://nodejs.org/)과 API 키, 인증된 [Codex CLI](https://developers.openai.com/codex/cli), 또는 인증된 [Claude Code CLI](https://code.claude.com/docs/en/overview) 중 하나가 필요합니다.

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

- 스타일러스나 마우스로 자연스럽게 그리고 `20,000 x 20,000` 캔버스를 이동하고 확대·축소합니다.
- 답변, 힌트, 설명, 수식, 그래프, 다이어그램을 캔버스에서 바로 받습니다.
- AI 초안을 이동하거나 크기를 조정한 뒤 작업에 포함하기 전에 개별적으로 승인하거나 폐기합니다.
- 올가미로 필기를 선택해 이동, 크기 조정, 색상 변경, 삭제 또는 Typeset 정리를 수행합니다.
- 브라우저에 스냅샷을 로컬로 저장하고 확정된 콘텐츠를 PNG로 내보냅니다.
- Arcane, Sci-fi, Research, Studio 테마를 선택할 수 있습니다.

## 0.7.1의 새로운 기능

- **캔버스에 이미지와 사진 추가.** 시스템 선택기로 사진을 추가합니다. 모바일과 태블릿에서는 사진첩이나 카메라를, 데스크톱에서는 이미지 파일을 선택할 수 있습니다. 큰 사진은 자동으로 축소·압축되어 캔버스와 스냅샷이 가볍게 유지됩니다.
- **길게 눌러 편집, 명확한 동작.** 이미지를 길게 눌러 다시 이동하거나 크기를 조절하고, 배치, 병합, 삭제를 선택할 수 있습니다. 배치는 이미지를 잉크 아래에 띄워 그 위에 그릴 수 있게 하고, 병합은 이미지를 지울 수 있는 실제 획으로 바꿉니다.
- **예상치 못한 AI 요청 없음.** 이미지는 스스로 AI 요청을 시작하지 않습니다. AI가 처리하는 동안 이미지를 조작하면 진행 중인 결과는 폐기되고 필기 인식은 자동으로 재개됩니다. 이미지는 실행 취소·다시 실행, 로컬 스냅샷, PNG보내기를 지원합니다.

## 0.7.0의 새로운 기능

- **캔버스 위의 대화형 HTML.** General HTML 플러그인은 시계, 계산기, 대시보드 등의 인터페이스를 격리된 대화형 위젯으로 만들 수 있습니다.
- **PenEcho 데이터 서비스 없이 유용한 데이터 사용.** 날씨, 주식, 기술 뉴스, 환율, 지진, 자연 현상, 우주 기상, GitHub 플러그인은 브라우저에서 선언된 API로 직접 요청합니다.
- **명확한 보안 경계.** 각 플러그인의 네트워크는 허용 목록으로 제한되고 HTML은 격리된 iframe에서 실행됩니다. 비활성화된 플러그인은 요청이나 런타임에 관여하지 않습니다.
- **로컬 플러그인 생성.** 간결한 Markdown 형식과 Preview 생성기에서 AI 개선, 자동 제목, 저장, 활성화, 개인 플러그인 삭제를 지원합니다.
- **캔버스 기본 저장 및 내보내기.** 확정된 위젯은 스냅샷과 PNG에 포함되며 이동, 재배치, 전체 크기 조정, 실행 취소 가능한 삭제를 지원합니다.
- **합리적인 기본값.** 새 사용자는 General HTML, Animation scenes, Weather가 기본 활성화되며 다른 데이터 플러그인은 직접 활성화해야 합니다.

## 이전 릴리스

- **0.6.0 - Animation scenes.** 안전한 선언형 Canvas2D 애니메이션, 캔버스 편집과 스냅샷 유지, 향상된 Markdown/LaTeX 렌더링, 더 안정적인 모델 출력, 비차단 npm 업데이트 확인을 추가했습니다.

## 작동 방식

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/how-it-works-dark.svg"><img alt="PenEcho 작동 방식" src="docs/assets/how-it-works-light.svg"></picture></p>

브라우저는 관련 캔버스 영역과 기하 정보만 전송합니다. 서버는 요청을 검증해 선택한 실행기로 전달하고 이동 가능한 구조화 초안을 반환합니다. 최신 모델 권장 사항과 비용 예시는 [영문 README](README.md#recommended-model-configurations)를 참조하세요.

## 안전한 배포

- **Codex CLI 및 Claude CLI:** 로컬 컴퓨터나 신뢰할 수 있는 LAN에서만 사용하세요. 유효한 요청은 로컬 CLI 프로세스를 시작하므로 이 모드를 인터넷에 직접 공개하지 마세요.
- **API 모드:** 공개할 경우 HTTPS, 인증, 요청 빈도와 크기 제한을 적용한 리버스 프록시 뒤에 배치하세요.
- 설정 파일, API 키, 요청 추적, 로그 또는 비공개 캔버스 이미지를 공개하지 마세요.

## 개발 참여

변경 사항을 제출하기 전에 다음을 실행하세요.

```bash
npm run check
```

구현 정보는 [아키텍처 문서](docs/architecture.md), 기여 절차는 [CONTRIBUTING.md](CONTRIBUTING.md)를 참조하세요. 질문과 사용 사례는 [Discord](https://discord.gg/3jrPJ3mXdX) 또는 [GitHub Discussions](https://github.com/penecho/penecho/discussions)에 공유하고, 재현 가능한 문제는 [GitHub Issues](https://github.com/penecho/penecho/issues)에 등록해 주세요.

## 라이선스 및 상업적 이용

PenEcho는 [GNU AGPL v3.0 only](LICENSE)로 공개됩니다. 상업적 이용은 허용되지만, 수정한 버전을 네트워크를 통해 사용자에게 제공하는 경우 AGPL에 따라 해당 소스 코드를 제공해야 합니다. AGPL을 준수할 수 없는 독점 제품과 호스팅 서비스에는 별도의 [상업용 라이선스](COMMERCIAL-LICENSE.md)가 제공됩니다. 이름과 로고에는 [상표 정책](TRADEMARKS.md)이 별도로 적용됩니다.
