# GLM Canvas Agent output exhaustion — 2026-09-15

## Confirmed incident

The screenshot's request asked for a visual 15-day UK travel map with daily routes, transport, stays and highlights. It matches local request `cfb34035-3be7-42a0-b47e-baf21044fb9f`, recorded in the existing `~/.penecho/logs/requests` directory.

- Start: 2026-09-15 17:13:56.900 Asia/Shanghai.
- End: 17:37:58.619; elapsed approximately 1,442 seconds.
- One model call, one reasoning block (165,639 characters), no visible text blocks and no tool calls.
- Requested effort: `xhigh`. Requested and reported output: 64,000 tokens.
- Provider finish: `max-tokens`, correctly surfaced as `MODEL_OUTPUT_EXHAUSTED`.
- The matching persisted UAT provider record reports GLM-5.3-Flash over the Anthropic-compatible endpoint, with 64,000 reserved and consumed output tokens.

The previous output-limit fix was present and effective. The model exhausted the entire response on internal planning before invoking any Canvas tool. Its lack of a Canvas result is not a failed Canvas write. Increasing the response cap alone does not resolve this behavior. The request trace's `reasoningTokens: 0` aggregate is an absent provider breakdown; the actual response block type confirms that all returned content was reasoning.

The request used extra-high effort and exhausted its response on internal planning. Whether changing effort or prompt guidance would prevent this behavior requires a model experiment; neither has been isolated as a proven root cause. GLM's officially supported effort levels are `low`, `high`, and `max`; unsupported generic levels must not be forwarded blindly. This compatibility defect is separate from the confirmed high-effort planning exhaustion.

Sources: [Z.ai core parameters](https://docs.z.ai/guides/overview/concept-param), [GLM model owner's compatibility notes](https://github.com/zai-org/GLM-5#note).

## Changes

- The shared Agent persona asks for reasoning proportionate to the task, preserving accuracy, completeness and necessary verification while avoiding repetition that adds no information. It gives a soft upper target of about 20,000 reasoning tokens per model response, with much less for simple tasks; the number is not a quota to fill. This replaces the earlier action-first, no-prewriting and post-render-only-checking instructions at the user's request. There is no new programmatic cutoff or automatic reduction of the user's selected reasoning effort.
- Public progress is one short initial sentence, with another only for a blocker or material change of approach. Final text normally contains one or two short outcome sentences, preserving essential limitations and requested explanations.
- GLM-5.3/Flash map `none/minimal/low` to `low`, `medium/high` to `high`, and `xhigh/max` to `max`. Explicit high/max selections retain their meaning. Custom identifiers and other model families retain existing behavior.
- Both direct Canvas API and Cloud forwarding apply the appropriate mapping. Cloud resolves opaque hosted IDs at the actual provider boundary. GLM OpenAI-compatible requests use `max_tokens`; this is an equivalent-path correction, not the cause of the screenshot's Anthropic request.
- UAT records content-free output-exhaustion diagnostics even when the provider returns HTTP 200. Token accounting and native stop reasons are preserved. No prompt, generated reasoning, or response text is stored by this additional observer.

## Verification and delivery

- 071: 118 focused tests passed, covering API effort forwarding, Agent behavior, public progress, decision admission and hosted protocol contracts.
- Cloud: 35 focused tests passed, covering native effort mapping, stream behavior, output exhaustion diagnostics, reservation/settlement and runtime sync.
- After the user replaced the action-first instruction with a 20,000-token soft reasoning target, syntax validation and the official scoped runtime sync check passed. No new real-provider experiment was run.
- The two changed shared runtime files were copied through `tools/sync-canvas-agent-runtime.mjs --only=src/providers/reasoning-effort.js,src/server/canvas-agent/runtime.mjs`.
- A bounded live first-action probe is retained in the formal Cloud project at `tools/uat-agent-first-action-probe.mjs`. It does not execute returned Canvas tools. Real-provider execution has not occurred: automatic approval rejected replaying the trace-derived input without explicit consent.
- No production deployment, push, commit, or service restart was performed by this task. The source changes are local. Existing processes do not automatically acquire the new in-memory persona.

## Next acceptance

Future real-provider verification requires explicit consent. The retained first-action probe is bounded to 2,048 output tokens and 90 seconds; it cannot validate the 20,000-token soft reasoning target or full delivery quality. A relevant comparison must preserve the user's selected effort, measure reasoning/output use and full delivery time, and verify the complete requested map's quality. Regenerate any diagnostic input from the current source before testing. Apply the reviewed source through the normal UAT workflow and restart the local host only after restart/deployment approval.
