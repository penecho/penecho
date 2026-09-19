# API provider presets

The AI connection editor adds opt-in service presets on top of the existing
OpenAI-compatible, Anthropic-compatible, Kimi and MiniMax entries. Select a
service, paste its API key, and either enter a model ID or load models to choose
one, then save. The model field stays editable after fetching, including IDs
absent from the fetched catalog. Existing saved connections and custom endpoints
are not migrated.

The shared registry is `src/providers/api-presets.js`. The official client
generator includes it in `public/app.js`; Node imports the same registry.
`src/providers/preset-discovery.js` owns discovery for the added entries. The
existing discovery path retains its original bounds and behavior.

| Service | Default base URL |
| --- | --- |
| OpenRouter | `https://openrouter.ai/api/v1` |
| OpenCode Go | `https://opencode.ai/zen/go/v1` |
| OpenCode Zen | `https://opencode.ai/zen/v1` |
| Zhipu, China | `https://open.bigmodel.cn/api/paas/v4` |
| Z.AI, global | `https://api.z.ai/api/paas/v4` |
| Zhipu Coding Plan, China | `https://open.bigmodel.cn/api/coding/paas/v4` |
| Z.AI Coding Plan, global | `https://api.z.ai/api/coding/paas/v4` |
| Qwen, Beijing | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| Qwen, Singapore | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` |
| Qwen, Virginia | `https://dashscope-us.aliyuncs.com/compatible-mode/v1` |
| DeepSeek | `https://api.deepseek.com/v1` |
| SiliconFlow, China | `https://api.siliconflow.cn/v1` |
| SiliconFlow, global | `https://api.siliconflow.com/v1` |
| Groq | `https://api.groq.com/openai/v1` |
| Mistral | `https://api.mistral.ai/v1` |
| xAI | `https://api.x.ai/v1` |

Qwen keys are regional. Some accounts require a workspace-specific endpoint;
the editor keeps the base URL editable for that case. Model lists come from the
selected endpoint, not from a hard-coded default model or a silent fallback.
Credential or endpoint changes clear fetched suggestions and preserve the model
field. Fetching also preserves a model entered before or during the request.
Changing the service/endpoint requires entering its key instead of reusing a
different saved service's key.

## OpenCode scope

OpenCode publishes different protocols for different model families. The new
entries list only the currently supported Chat Completions and Messages model
families. Selecting a Messages model persists an explicit `/v1/messages`
endpoint; reopening the editor displays the service base URL again. Models
requiring Responses or Gemini, and unrecognized new model families, are omitted
rather than assigned a guessed protocol. The UI explains this restriction.

OpenCode Go is intended for coding-agent traffic and requires a Go subscription.
Zen uses an API balance. The dedicated headers are emitted only for an explicit
OpenCode preset at its canonical endpoint. Agent conversations use their own
stable `x-opencode-session`, including reasoning changes and both adapters;
one-shot Canvas/connection-test operations get a new request session. The
direct client identifies as PenEcho, while the installed Agent adapter keeps
its mandatory DeepSeek Harness attribution. No global headers, vendor adapter,
old connection migration or existing protocol parser changes are introduced.

## Validation and limits

- `node --test test/api-presets.test.js`: UI field behavior, persistence and
  protocol routing, legacy isolation, large catalogs, errors/timeouts, and actual
  Harness Chat/Messages requests against an in-memory upstream fixture.
- Added discovery accepts up to 4,096 IDs / 8 MiB, checks JSON and identifiers,
  filters non-chat metadata, rejects redirects, and times out after 15 seconds.
  The old custom discovery limits stay at 256 IDs / 512 KiB.
- Public-catalog verification on 2026-09-18 returned 445 OpenRouter chat entries,
  31 compatible OpenCode Go entries and 32 compatible OpenCode Zen entries.
  Counts are observations, not pinned product constants.
- `scripts/verify-api-presets-ui.cjs` renders the actual editor markup, CSS and
  functions in a browser with a mocked model-list response. It checks English,
  Chinese, narrow width and a 640×480 CSS viewport rendered at 2× device scale
  (the layout equivalent of a 1280×960 window at 200% browser zoom). It uses an
  installed `playwright` package or `PENECHO_PLAYWRIGHT` module path and writes
  local screenshots/results to ignored `test-results/api-presets/`.
- No paid provider inference was performed. A listed model may still require
  account access and model-specific vision, tools or parameter support. These
  presets do not claim to add every provider's optional capability.

Design mapping: existing connection dialog → `penecho_design` catalog **Form
Controls / Provider** and settings form patterns; retain existing native select,
compact input, model combobox, Load action, focus and disabled states. This
change adds options and one contextual note without introducing a new layout.

## Primary references

- [OpenCode Go endpoints and client requirements](https://opencode.ai/docs/go/)
- [OpenCode Zen endpoints](https://opencode.ai/docs/zen/)
- [OpenRouter quick start and catalog](https://openrouter.ai/docs/quickstart)
- [Z.AI API quick start](https://docs.z.ai/guides/overview/quick-start)
- [Z.AI official SDK, including China endpoint](https://github.com/zai-org/z-ai-sdk-python)
- [Qwen OpenAI compatibility and regional endpoints](https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope)
- [Groq OpenAI compatibility](https://console.groq.com/docs/openai)
- [Mistral model listing](https://docs.mistral.ai/api/endpoint/models)
