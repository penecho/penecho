<p align="center">
  <a href="https://penecho.ai/lines.html">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="../assets/penecho-lines-logo-dark.svg">
      <img src="../assets/penecho-lines-logo.svg" alt="PenEcho Lines" width="340">
    </picture>
  </a>
</p>

<h3 align="center">또 하나의 AI 에이전트가 아닙니다. 내 에이전트와 일하는 더 나은 방식입니다.</h3>

<p align="center">
  뜻하는 바를 그리고, 모든 작업을 하나의 라인으로 추적하며, 한 에이전트가 다른 에이전트의 작업을 검토하게 하세요.<br>
  이미 사용 중인 에이전트와 함께 동작합니다. 오픈소스, 내 컴퓨터에서 무료, 계정 불필요.
</p>

<p align="center">
  <a href="https://penecho.ai">웹사이트</a> &nbsp;·&nbsp;
  <a href="#install">다운로드</a> &nbsp;·&nbsp;
  <a href="https://penecho.ai/try.html">브라우저에서 체험</a> &nbsp;·&nbsp;
  <a href="https://penecho.ai/leaderboard">에이전트 리더보드</a> &nbsp;·&nbsp;
  <a href="https://discord.gg/3jrPJ3mXdX">Discord</a> &nbsp;·&nbsp;
  <a href="https://buymeacoffee.com/penecho">커피 한 잔 사주기</a>
</p>

<p align="center">
  <sub>
    <a href="../../README.md">English</a> ·
    <a href="README.zh-CN.md">简体中文</a> ·
    <a href="README.ja.md">日本語</a> ·
    <strong>한국어</strong> ·
    <a href="README.ru.md">Русский</a> ·
    <a href="README.es.md">Español</a> ·
    <a href="README.pt-BR.md">Português</a> ·
    <a href="README.fr.md">Français</a> ·
    <a href="README.de.md">Deutsch</a>
  </sub>
</p>

---

<a name="quick-start"></a>
<a name="install"></a>

## 설치

<a href="https://github.com/penecho/penecho/releases/latest"><img src="https://img.shields.io/badge/release-v1.5.0-2563eb" alt="Release v1.5.0"></a>
<img src="https://img.shields.io/badge/macOS%20·%20Windows%20·%20Linux-64748b" alt="macOS, Windows, Linux">
<a href="../../LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-64748b" alt="AGPL-3.0"></a>

| | |
| :--- | :--- |
| **데스크톱 앱** | [penecho.ai](https://penecho.ai/downloads.html)에서 macOS 또는 Windows용 앱을 다운로드하세요. |
| **npm** | `npm install -g penecho` 후 `penecho` 실행 (Node.js 22.19 이상). |
| **브라우저** | [penecho.ai](https://penecho.ai)를 여세요. 설치가 필요 없습니다. |

액세스 코드를 정하고 프로젝트 폴더를 연 뒤, **설정 → Agents**에서 에이전트를 추가하세요. 이미 구독 중인 에이전트 플랜, 개인 API 키, 또는 PenEcho 모델을 사용할 수 있습니다.

1.5.0 새 기능: Lines, 원클릭 리뷰, 실제 평점 기반 Orchestrator, 근거가 보이는 토큰 절감, 실시간 Canvas 공유. 자세한 내용은 [변경 로그](../../CHANGELOG.md#150)를 확인하세요.

### 소스에서 실행하기

Git과 Node.js 22.19 이상이 필요합니다. 빌드된 페이지가 저장소에 포함되어 있어 별도 빌드 단계가 없습니다.

```bash
git clone https://github.com/penecho/penecho.git
cd penecho
npm install
npm start        # PenEcho가 http://localhost:3888 에서 열립니다
```

소스에서 데스크톱 앱을 실행하려면 `npm run desktop:deps`를 한 번 실행한 뒤 `npm run desktop`을 실행하세요. `npm run check`로 모든 검사와 테스트를 실행할 수 있습니다.

---

## 3분 만에 보기

실제 작업 하나를 처음부터 끝까지: 한 에이전트가 구현하고, 다른 에이전트가 리뷰하며, 수정 사항이 다시 전달되고, 마지막 결정은 당신이 내립니다.

<p align="center">
  <a href="https://penecho.ai/lines.html#film">
    <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_lines.gif" alt="PenEcho Lines 영상: 스크린샷에 동그라미 표시, 에이전트 선택, 원클릭 리뷰, 수정 요청 전달, 5/5 완료, Orchestrator가 실제 기록으로 에이전트 선택" width="100%">
  </a>
</p>
<p align="center"><a href="https://penecho.ai/lines.html#film">▶ 전체 영상 보기</a></p>

<p align="center">
  <img src="../assets/penecho-lines-architecture.svg" alt="작업이 에이전트에 전달되는 방식: PenEcho는 단일 에이전트에 직접 작업을 보내거나, Orchestrator가 작업을 여러 부분으로 나누어 여러 에이전트에 배정합니다. 모든 에이전트는 프로젝트 폴더에서 작업하며 동일한 Markdown 기록(MEMORY.md, lines, works)을 유지합니다." width="880">
</p>

작업을 하나의 에이전트에 바로 보내거나, Orchestrator에 맡겨 작업을 나누고 각 부분에 알맞은 에이전트를 고르게 할 수 있습니다. 모든 에이전트는 내 폴더에서 작업하며 동일한 일반 Markdown 기록을 유지합니다.

---

## 주요 기능

<table width="100%">
  <tr>
    <td width="50%" valign="top">
      <strong>한 작업에서 협업하는 에이전트</strong><br>
      한 에이전트가 만들고 다른 에이전트가 원클릭으로 리뷰합니다. <em>Send fixes</em>로 같은 Line에 수정 사항을 바로 넘기세요.
    </td>
    <td width="50%" valign="top">
      <strong>근거가 보이는 토큰 절감</strong><br>
      이어서 할지 새로 시작할지 더 저렴한 쪽을 선택하고, 모든 작업에서 절약된 양을 보여줍니다.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>학습하는 Orchestrator</strong><br>
      큰 작업을 나누고 실제 기록으로 에이전트를 고르며, 모든 결과를 평가해 선택 정확도를 높입니다.
    </td>
    <td width="50%" valign="top">
      <strong>모든 에이전트 동기화</strong><br>
      Claude Code, Codex, Kimi, OpenCode 등의 세션이 동기화됩니다. 어떤 세션이든 원하는 에이전트로 이어서 진행하세요.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>수백 개의 작업을 한 화면에서</strong><br>
      Ask, 진행 중, 확인 필요, 리뷰 대기, 완료. 지금 나를 기다리는 일을 한눈에 파악하세요.
    </td>
    <td width="50%" valign="top">
      <strong>뜻하는 바를 그려서 전달</strong><br>
      스크린샷에 표시하고 프로토타입, 다이어그램, 슬라이드를 그리세요. 에이전트가 말과 함께 그림도 봅니다.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>내가 소유하는 순수 Markdown</strong><br>
      모든 Line은 폴더 안의 Markdown 파일이며, 프로젝트마다 하나의 <code>MEMORY.md</code>를 둡니다. 어디서든 읽을 수 있습니다.
    </td>
    <td width="50%" valign="top">
      <strong>링크 하나로 공유</strong><br>
      프로젝트나 Canvas를 링크로 공유하세요. 팀원이 브라우저에서 바로 리뷰하고 메모를 그릴 수 있습니다.
    </td>
  </tr>
</table>

Claude Code, Codex, OpenCode, Antigravity, Kimi, Pi, DeepSeek Harness, omp 및 PenEcho 내장 러너와 함께 동작합니다.

---

## Canvas AI

쓰고, 스케치하고, 동그라미를 그리면 답이 바로 그 자리에 나타납니다.

<p align="center">
  <img src="https://github.com/penecho/penecho/releases/download/v0.1.0/penecho_full_demo.webp" alt="PenEcho Canvas에서 수식, 물리 문제, 스케치, 미로를 푸는 데모" width="720">
</p>
<p align="center"><sub><strong>그리며 묻기</strong> — 손글씨, 수식, 드로잉, 미로.</sub></p>

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

PenEcho는 Kimi Open Source Friends의 일원입니다. Kimi Code도 다른 에이전트처럼 PenEcho에서 바로 실행됩니다. **설정 → Agents**에서 추가하거나 [Kimi Code 받기](https://www.kimi.com/code?aff=penecho)를 이용해 보세요.

---

<a name="support-penecho"></a>
<a name="buy-us-a-coffee"></a>

## 더 보기

- **커뮤니티:** [웹사이트](https://penecho.ai) · [리더보드](https://penecho.ai/leaderboard) · [Discord](https://discord.gg/3jrPJ3mXdX) · [Discussions](https://github.com/penecho/penecho/discussions) · [Issues](https://github.com/penecho/penecho/issues) · [기여하기](../../CONTRIBUTING.md)
- **후원:** PenEcho가 오후 시간을 아껴 주었다면 [커피 한 잔 사주기](https://buymeacoffee.com/penecho)나 [GitHub Sponsors](https://github.com/sponsors/penecho)로 응원해 주세요. 스타나 좋은 버그 제보도 똑같이 큰 힘이 됩니다.
- **문서:** [아키텍처](../architecture.md) · [Project Lines](../project-lines.md) · [MCP 설정](../mcp-setup.md) · [변경 로그](../../CHANGELOG.md)
- **라이선스:** [AGPL-3.0-only](../../LICENSE)이며 [상업용 라이선스](../../COMMERCIAL-LICENSE.md)도 제공됩니다. [상표 정책](../../TRADEMARKS.md)과 [CLA](../../CONTRIBUTOR-LICENSE-AGREEMENT.md)를 확인하세요. 다이어그램 렌더러는 tt-a1i의 [Archify](https://github.com/tt-a1i/archify)(MIT) 코드를 바탕으로 하며 자세한 내용은 [NOTICE](../../NOTICE)를 참조하세요.

<details>
<summary><strong>Star 히스토리</strong></summary>
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
