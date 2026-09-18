# Architecture prompt experiment — 2026-09-17

Goal: test whether a reusable architecture-only prompt produces simple entities,
meaningful boundary frames, explicit component relationships and separate detail.
The layout remains the model's choice. No target coordinates or finished HTML are
provided to the model. The supervisor must not manually repair model output and
then count the repaired artifact as a successful generation.

## Method

- User-selected endpoint: `https://open.bigmodel.cn/api/anthropic/v1/messages`.
- User-selected model: `glm-5.3-flash`; record the returned model separately.
- Use the formal project's full Visual Explorer guidance. Baseline and candidate
  differ only in the architecture section; the case facts and output contract
  remain identical for the PenEcho comparison.
- Candidate transfer cases cover a branching commerce system and a RAG system
  with separate offline/online workloads and shared storage.
- Credentials are entered without terminal echo and kept in the evaluator's
  memory only. Requests/reports never include authorization headers. Reasoning
  deltas are discarded; only final HTML, hashes, usage and timing are retained.
- Preserve each original generated HTML. Render it unchanged via PenEcho MCP,
  inspect returned pixels, and record shortcomings before revising the prompt.
- A fresh generation after prompt revision does not receive the earlier HTML or
  case-specific geometry fixes. This tests the rule, not hand-corrected output.

## Review criteria (declared before looking at output)

Score each dimension 0 (missing/broken), 1 (partial), or 2 (clear and usable):

1. **Entities:** compact names/roles, with implementation prose outside the map.
2. **Boundaries:** frames express meaningful grouping/nesting, without false
   process, trust or deployment claims.
3. **Relationships:** important endpoints and directions can be traced; relevant
   branches/shared dependencies are represented without fabricated chains.
4. **Hierarchy:** the topology is visually primary; details support rather than
   compete with it, and essential labels are readable at the actual viewport.
5. **Geometry:** alignment is deliberate; ports, arrows and labels remain
   attached, legible, and free of material overlap/clipping.

A promising sample scores at least 8/10 with no critical wrong relationship or
unreadable essential content. These are human screenshot reviews, not an
automated aesthetic benchmark. A few samples establish feasibility, not a
statistical guarantee of model reliability.

## Reproduction

Run `python3 scripts/evaluate-architecture-prompt.py` from the project root in an
interactive terminal, enter an authorized API key, and send one JSON command:

```json
{"job":"testcase/architecture-prompt-eval/2026-09-17/baseline-penecho.job.json"}
```

Output directories must be new; choose a new `outputDir` to repeat an experiment.
For a pair of independent jobs, send `{"jobs":["path/to/a.job.json","path/to/b.job.json"]}`;
the runner caps concurrency at two. The initial max/high jobs recorded long or
incomplete generations; use a specific later job when reproducing that condition,
and do not treat prepared but unrun jobs as measurements.

Send `{"quit":true}` when finished. Job JSON files contain full non-secret model
inputs. The test does not publish, deploy, restart PenEcho, or change saved user
canvases outside the dedicated experiment documents. MCP examples are placed on
separate test canvases and versioned artifacts. See `canvas-index.json`.

## Later experimental conditions

- v4 full vs isolated compares the same architecture rules within the full guide
  versus an architecture-only context. It is a small context ablation, not proof
  of causation.
- v4 reviewed is a model repair with real screenshot feedback; it is not a fresh
  one-shot sample. The call timed out without visible HTML.
- v5 adds the user's explicit color-correspondence, orthogonal-routing and
  zero-text-overlap criteria; see `user-feedback-v5.md`.
- v5 low adds requested `output_config.effort=low` as a separate parameter probe.
  Both calls hit the output limit before completing HTML.
- v6 derives route bends from ports and labels from route segments. It also adds
  the actual host viewport to the user facts, so compare it as an environment-aware
  workflow improvement, not as a single-variable prompt experiment.

Read `REPORT.md`, `results.json`, and each run's `review.md` for the actual outcome.

## Model-authored repairs

The two `candidate-v6-penecho-patch-review*` jobs are repair trials, not fresh
generations. They send the current HTML and observed defects to the same model.
With `outputFormat: "replace-patches"` and `sourceHtml` set to the retained base,
the evaluator accepts JSON `{"replacements":[{"old":"exact text","new":"replacement"}]}`.
Each old string must match exactly once; the base file is never overwritten.
The replacement JSON, source/result hashes and new HTML are retained, and the
new HTML is published as a separate artifact. Human-authored HTML corrections
are not part of this process.

The final recorded review is a local repair improvement, not a validated final
production prompt. Candidate rules remain experimental and architecture-only.
