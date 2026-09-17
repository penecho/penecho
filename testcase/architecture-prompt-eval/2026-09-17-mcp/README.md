# MCP architecture — scoped-rule evaluation

Task: gather the MCP architecture facts once from the formal repository, expose
the candidate as an isolated MCP rule, then test fresh model generations and
improve only that rule. Preserve every previous output and Canvas.

## Fixed inputs and real guidance

- `facts.md`: code-grounded source material, with source references. This is a
  fact fixture, not a layout template. `evidence-manifest.json` records the
  working tree, branch and source hashes.
- `prepare-job.cjs`: initializes the production `PenEchoStdioServer` handler and
  calls `penecho_get_guidance` for `visual-explorer` and `architecture`. It saves
  exact responses, hashes and complete API inputs before each model request.
- Model: user-specified `glm-5.3-flash`, through the user-specified BigModel
  Anthropic endpoint. The first sandboxed request failed DNS before receiving
  any model response; it remains recorded. The network retry has a new run ID.
- Each new trial receives the same facts and request, plus current MCP guidance.
  No old HTML, screenshot, project-specific coordinates or model repair history
  is injected into a fresh generation.
- The model has no tools in the API call because source collection and guidance
  reads are already complete. This simulates the authoring step after those MCP
  reads. Codex forwards its exact final HTML to PenEcho MCP, checks actual pixels,
  and records any concrete defects. It is not an end-to-end test of autonomous
  tool selection or a deployment of the current Cloud MCP service.

## Acceptance criteria, recorded before the first result

1. The important entity relationships can be traced without reading every
   detail. The diagram must not turn a code/module inventory into the main view.
2. Frames state meaningful boundaries. Modules within one Node host are not
   represented as separate deployed servers. Browser and host storage remain
   distinct. Cloud internals are not invented.
3. The guidance branch is independently readable and does not traverse the
   browser or an additional model. A direct HTTPS client may bypass stdio.
4. Semantic colors/names match the relevant details. Details are outside the
   topology; main entities stay short and simple.
5. Important links are horizontal/vertical or well-spaced orthogonal routes,
   terminate on correct entities, and do not occlude text. Diagonals need a
   concrete benefit. Comparable elements align at the actual host viewport.
6. Essential text is readable, not clipped or reduced to fit a giant figure.
   Scrolling details is allowed. A screenshot only verifies the visible area.

Do not declare success when a critical semantic or visible-text defect remains.
Do not infer universal reliability from a passing single example. Distinguish
rule-driven fresh generations from any separately labeled repair.

## Reproduce

From the formal project root:

```sh
node testcase/architecture-prompt-eval/2026-09-17-mcp/prepare-job.cjs NEW-RUN-ID
python3 -u scripts/evaluate-architecture-prompt.py
```

Enter an authorized API key at the non-echoing prompt, then submit
`{"job":"testcase/architecture-prompt-eval/2026-09-17-mcp/NEW-RUN-ID.job.json"}`.
Every run name/output directory must be new. Send `{"quit":true}` when finished.
The evaluator records final visible output/usage only, not hidden reasoning.

## Runtime distinction

The new rule is in the formal Canvas source. MCP stdio, HTTP RPC and built-in
Agent tests return the same body/hash without Canvas access. The existing live
Cloud MCP connection is used as the rendering surface; this experiment does not
claim that Cloud has received the new rule without official sync/deployment.

The Z.AI [thinking-mode documentation](https://docs.z.ai/guides/capabilities/thinking-mode)
states that GLM-5.3-Flash uses forced thinking. `thinking: disabled` in the initial
matched trial is therefore a recorded request parameter, not proof of disabled
reasoning or a performance improvement. The stream includes thinking events;
their text is discarded. Latency and final usage are measured rather than guessed.
