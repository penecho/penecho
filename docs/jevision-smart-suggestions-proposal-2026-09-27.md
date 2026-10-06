# Smart Suggestions with JeVision — design proposal

Date: 2026-09-27 · Status: discussion draft, nothing implemented yet · Scope: Canvas (071), with a Cloud proxy

> Credentials are intentionally not in this file. This repository is AGPL and public; the JeVision key must live only in local env / Cloud Admin (see §10).

## TL;DR

1. After every pause in writing, the client silently sends a small, specially rendered crop of the **new ink** plus a few lines of **local facts** to JeVision, together with a **closed menu of actions that are actually possible right here**. JeVision returns a probability for every option. If the top option is confident, one (at most two) small chips appear beside the ink: *Plot*, *Typeset*, *Check step*, *Clean up shapes*, *Build prototype*… Tap it and the result lands in the right place as a normal pending draft.
2. JeVision **only decides**. It never transcribes and never generates. Every action has its own executor: local geometry, local CAS/plotting, the existing model pipeline, or an existing renderer. That split is why JeVision stays fast and why a wrong answer costs nothing.
3. The state space is the product. It has three parts: **what JeVision sees** (an attention-rendered crop where new ink is dark and context is faded), **what it is told** (compact facts computed locally), and **what it may choose** (a dynamically filtered menu of ≤ 12–16 options per question, with `none` as a strong first-class option). The rest of this document mostly designs these three parts.
4. It is invisible when it fails. There is a hard timeout, a revision guard, a circuit breaker, no spinner, no status text, no log in the UI, and nothing in undo history until the user taps.
5. Plotting becomes a live **Graph object** (multiple curves, implicit/parametric/polar, sliders, 3D), built on MIT-licensed engines. We already vendor `manim-web` (MIT, a 3Blue1Brown-style browser port) for animations. Shapes get manual tools, hold-to-snap, and JeVision "clean up" suggestions.

---

## 1. The experience

```
   y = a·sin(kx) + 1          ⟵ user writes, lifts pen
                               ~0.8 s later, nothing else moves:
   y = a·sin(kx) + 1   ( ∿ Plot with sliders )  ( ∑ Typeset )
```

- A chip is a small pill in screen space, anchored just outside the top-right of the ink cluster, in the AI colour, with an icon and a verb of at most three words. Its placement uses the existing blank-area search, so it never covers ink.
- **At most two chips.** A small `⋯` expands to the next 2–3 options from the same probability distribution, so no extra call is needed.
- A chip disappears when the user starts writing elsewhere, after about 6 s untouched, on zoom or pan beyond the anchor, or when the user taps ×. If the user keeps writing *in the same cluster*, the chip hides and the cluster is re-evaluated at the next pause.
- Tapping runs the action. The output goes through the existing pending/draft path (`preparePendingItem` → accept/adjust), so placement, dragging, undo and persistence already work.
- The chip is never exported, persisted or added to undo, and it takes no keyboard focus. There is one optional shortcut to accept the first chip (to be decided; must not collide with `keyboard-shortcuts.js`).
- **Selections are a second surface.** When the user lasso-selects, the selection toolbar (today: Typeset / Delete / Cancel, `public/index.html:656`) gets JeVision-ranked actions right away. A selection is explicit intent, so the threshold can be lower.

## 2. What already exists (grounding)

| Fact in the codebase | Consequence for the design |
| --- | --- |
| Ink is a **raster** layer. `state.dirty` is a union box and `state.hotspotTrail` holds recent points (`canvas-runtime.js:5347`). Strokes are not kept as vectors after commit. | Shape fitting needs a small **recent-stroke ring buffer** (vectors of the last ~64 strokes since the last evaluation), captured at pen-up. |
| Auto AI already fires on pause (`schedule()` / `launchAutomaticAI`, `ai-runtime.js:178–207`) with revision and generation guards, and `restoreDirty` handles superseding. | Reuse the same trigger point and guard pattern. Suggestions run on a shorter, independent timer. |
| `plot_function` exists, but it is a single-variable ASCII expression rendered by a hand-written canvas plotter into a **static image** (`ai-runtime.js:2587–2800`). | Replace it with a live Graph object. Keep `plot_function` as a compatibility input that creates a Graph. |
| Typeset = `userAction:"normalize"` with a selection context, which already works for isolated regions. | This is the transcription path for math actions (see §7). |
| `manim-web@0.3.24` (MIT) is vendored for Visual Explorer. `three.js` is used by LiveClay. Architecture, sequence and workflow renderers exist. | 3B1B-style animations, 3D and diagram actions can mostly be wired up; they do not need to be built. |
| Cloud already speaks JEV SystemOne (`penecho_cloud/src/services/provider-http.mjs`, protocol `jev-systemone`, pool routing, health checks, circuit breaking). Request `{model, state, questions}`. Question types: `choice` (with `probabilities` and `confidence`), `noul` (0–1), and scaled `score`. | JeVision should be added as a sibling protocol (`jev-vision`) in the same Admin pool machinery. The question design below uses exactly these three types. |

**Not verified:** from this session I could not reach `api.penecho.ai` (the proxy blocked it in both the cloud sandbox and the local VM). The *vision* request shape (the image field name, format and size limit) is an open question in §14. Everything else below assumes only the SystemOne semantics shown above.

## 3. JeVision as a state-space action selector

The model of the problem:

```
state s  = render(new ink, faded context) + facts(local features, canvas profile, history)
actions A(s) = eligible(registry, s)            // closed, filtered, ≤ 12–16 per question
JeVision: P(a | s) for a ∈ A(s) ∪ {none}, plus P(kind | s), P(finished | s)
policy:  show top-1 (maybe top-2) iff gates pass; else show nothing
executor(a) produces the content; JeVision never does
```

The design follows directly from this. **Everything JeVision needs to decide must be visible in the crop or stated in the facts. Everything it could get wrong must be removable by local gates.**

## 4. Designing the state: what JeVision sees

### 4.1 The image: attention rendering

We do not send a screenshot. We send a crop rendered specifically for classification:

- **Region:** the ink cluster (dirty box merged with strokes within ~1.5 line heights), padded by 25%, then expanded to include any object it overlaps or touches (a plot, formula, widget or image).
- **Emphasis:** the new ink is drawn at full contrast. Older ink and objects in the crop are drawn at about 30% opacity. This tells JeVision *what is new* and *what is context* without any extra text. For example, the user writes `f'(x)=` under an existing derivation, and JeVision sees one dark line under faded lines, which is exactly the "next step / check step" situation.
- **Normalisation:** white background, no grid or theme colours, and the long side at ≤ 512 px (≤ 768 px if the cluster is dense text). Encode as WebP/JPEG at q≈0.8, about 20–50 KB. Render with `OffscreenCanvas` / `createImageBitmap` off the input path. Budget: ≤ 15 ms of main-thread time.
- **Optional (evaluate in phase 0):** a second tiny thumbnail of the whole viewport at about 256 px for domain context, if JeVision accepts multiple images.

### 4.2 The facts: compact, local, cheap

These are plain text lines computed in under 5 ms. They are things the pixels do not show well.

```
new_ink: strokes=7 closed=1 bbox=412x96 aspect=4.3 text_rows=1 density=med
shape_fit: best=ellipse residual=0.06 | rect=0.31 | line=0.9            (only if ≤3 strokes)
overlaps: formula#12 (LaTeX "x^2+y^2=1") | none
near: plot#3 below 40px; text-box "Lemma 2" above                      (≤3 neighbours)
typed_text_in_region: ""                                               (verbatim if typed)
canvas_profile: math 0.62, physics 0.21, code 0.05, design 0.02, notes 0.10
persona: research | locale: zh-CN
recent: accepted plot 2m ago; dismissed typeset ×2 in last 10m
```

- `canvas_profile` is an exponential moving average of past `kind` answers on this canvas, persisted with the canvas. It is the cheapest strong prior we have. A physics notebook stays a physics notebook.
- `recent` lets JeVision (and the local gate) stop nagging. If the user dismissed *Typeset* twice, offer it less.
- **Excluded:** anything personal, file names, other canvases, or any user text outside the crop.

## 5. Designing the action space: what JeVision may choose

### 5.1 Principles

1. **Closed and executable.** Only options with a working executor for this object, on this client, right now. Examples: no *Run* without a sandbox; no *Plot in this graph* without an overlapping Graph; no *Copy LaTeX* before a formula exists.
2. **Criteria describe visual evidence, not benefits.** Write "an equation relating x and y, e.g. y=…, f(x)=…, x²+y²=…, r=…θ", not "user wants to visualise". Add **negative examples** where classes collide:
   - *circle* vs letter *O* vs digit *0*
   - *arrow* vs *→* in a formula
   - `3+4=` (compute) vs `y=3x+4` (plot)
   - a table grid vs a UI wireframe
3. **`none` is a strong, well-described option.** Its description covers: still writing, scribble, plain notes that need nothing, crossed-out work, a signature or doodle, or content that already has the proposed treatment (for example, it is already typeset). Precision matters far more than recall, because a wrong chip is the thing the user notices.
4. **Keep menus small:** ≤ 12–16 options per question, so the probabilities stay meaningful. The menu is **core ∪ domain pack(s) ∪ object-context actions**, and the domain packs are picked from `canvas_profile`.
5. **Factorise the decision.** Ask separately *what is this* (`kind`), *what to offer* (`action`) and *is the user done* (`finished`), then cross-check them locally.
6. **Use the whole distribution.** We get probabilities for every option, so the number of chips (0, 1 or 2) and the `⋯` list come from the same call.

### 5.2 The per-call question set (one request)

```jsonc
{
  "model": "penecho/jevision",
  "state": { /* image(s) + facts text — exact shape TBD with JeVision, §14 */ },
  "questions": {
    "kind": { "type": "choice",
      "instructions": "What is the NEW dark ink (faded ink is context)?",
      "criteria": {
        "none": "Unfinished, scribble, crossed out, signature/doodle, or nothing new",
        "math_expr": "A formula/expression/equation in math notation (includes y=f(x), ∫, Σ, lim, matrices)",
        "math_step": "One line continuing a multi-line derivation shown faded above",
        "geometry": "A geometric figure with labelled points/angles/lengths",
        "shape": "One or a few plain shapes (circle, box, line, arrow, triangle) without math labels",
        "axes_curve": "Coordinate axes, possibly with a hand-sketched curve or points",
        "physics_diagram": "Free-body, spring/pendulum, circuit, optics or field sketch",
        "code": "Program code or pseudo-code lines",
        "data_structure": "Array/tree/linked list/graph of nodes drawn for an algorithm",
        "ui_wireframe": "Screen/page layout: boxes as header, buttons, inputs, cards",
        "diagram": "Boxes/labels connected by arrows (flow, architecture, sequence)",
        "table": "Grid of rows/columns or aligned parallel data",
        "notes": "Words/bullets/ideas in natural language",
        "question": "A natural-language question or request addressed to the assistant"
      } },
    "action": { "type": "choice",
      "instructions": "Which single follow-up would most help with the NEW ink right now? Choose none unless clearly useful.",
      "criteria": { /* ≤ 16, built from the registry for this state — see §6 */ } },
    "finished": { "type": "noul",
      "instructions": "Probability that the user has completed this unit (not mid-expression/mid-shape)." }
  }
}
```

### 5.3 Local gates (policy)

A chip is shown only if **all** of the following hold. The starting values are shown and get tuned in phase 0.

- `P(action=top) ≥ τ_top(action)`, starting at 0.55. Each action has its own threshold, because a costly or odd suggestion needs more confidence.
- `P(none) ≤ 0.30` and `finished ≥ 0.6`.
- **Agreement gate:** `top action ∈ compatible(argmax kind)`, using a static compatibility matrix in the registry. When the two independent questions disagree, show nothing. This one rule removes most false positives cheaply.
- Not dismissed ≥ 2 times on this canvas in the last 10 minutes (per-action cooldown).
- The second chip is shown only if `P(second) ≥ 0.25` and it is compatible too.

### 5.4 Adaptive cascade

One call is the normal path. Sometimes the `kind` answer falls outside the domain packs we offered, for example the first code snippet on a math-heavy canvas. In that case, fire **one** follow-up call with only that kind's pack. That costs about one extra round trip in rare cases, and it is invisible because nothing was shown yet. Phase 0 decides whether the flat single call is accurate enough, or whether the two-step `kind → action` cascade should be the default.

## 6. Action catalogue

Legend for **Exec** (see §7): **L0** local instant · **L1** local compute (CAS/plot, after transcription) · **L2** model via `/api/ai/command` with a forced action · **L3** existing renderer/widget.

### Core (every canvas)

| id | Chip | Visual evidence (criteria sketch) | Exec | Output placement |
| --- | --- | --- | --- | --- |
| `typeset` | Typeset | Handwritten math or text that is not already typeset | L2 (existing normalize) | In place over the ink; accepting hides the ink |
| `snap_shapes` | Clean up shapes | Rough circles, boxes, lines or arrows meant to be exact | L0 (fit on stroke buffer) | In place |
| `answer` | Answer | A natural-language question addressed to the assistant | L2 | Beside, in reading flow |
| `none` | — | see §5.1 | — | — |

### Mathematics (students → PhD)

| id | Chip | Evidence | Exec | Notes |
| --- | --- | --- | --- | --- |
| `plot_2d` | Plot | y=f(x), f(x)=, implicit F(x,y)=0, r=f(θ), parametric, inequality region | L1 Graph | Right of the formula; same baseline |
| `plot_sliders` | Plot with sliders | Expression with free parameters (a, k, ω, μ, σ…) | L1 Graph + sliders | The flagship "explore" moment |
| `plot_3d` | 3D surface | z=f(x,y), f(x,y)=…, level sets | L1 (three.js) | |
| `plot_into` | Add to graph | New expression written near or onto an existing Graph | L1 | Adds a curve to that Graph |
| `solve` | Solve | Equation or system with unknowns, not solved yet | L1 CAS → L2 fallback | Below, aligned to `=` |
| `compute` | Evaluate / d/dx / ∫ | An unevaluated ∫, d/dx, lim, Σ, or `3+4=` | L1 CAS → L2 | After `=` or below |
| `simplify` | Simplify / factor | A long expression with obvious structure | L1 CAS | |
| `next_step` | Next step | The last line of a derivation that is not final | L2 (existing *continue*) | Next line, same indent |
| `check_step` | Check step | New line derived from the faded lines above | L1 numeric check + L2 | A ✓, or a small mark at the wrong term with a one-line note |
| `numeric_check` | Test numerically | An identity or inequality claim (∀x…) | L1: random-point test | For PhDs: "holds at 1000 samples / fails at x=…" |
| `matrix_ops` | det · inverse · eigen | A drawn matrix | L1 | Small result panel |
| `geometry_live` | Make interactive | A geometric figure with labelled points | L1 (JSXGraph construction) | Replaces the sketch as a draft |
| `fit_curve` | Find equation | A hand-sketched curve or points on axes | L2 + L1 verify | Overlay the fitted curve |
| `proof_sketch` | Proof outline | "Prove / show that …" statement | L2 | Beside |
| `copy_latex` | Copy LaTeX | Selected or new formula object | L0 | Clipboard toast only |
| `animate` | Animate | A transformation, limit, or area/sum concept that is clearer with motion | L3 manim-web | Animation object |

### Physics

| id | Chip | Evidence | Exec |
| --- | --- | --- | --- |
| `units_check` | Check units | Formula with physical symbols or units | L1 (dimension table) + L2 |
| `simulate` | Simulate | Pendulum, spring, projectile, orbit or collision sketch | L3 (LiveClay physics / widget) |
| `field_plot` | Plot field | Vector field, potential, E/B expressions | L1 Graph (quiver / field lines) |
| `phase_portrait` | Phase portrait | ODE or system of ODEs | L1 (RK4 + Graph) |
| `clean_diagram` | Clean diagram | Free-body, circuit or optics sketch | L2 → native draw / SVG |
| `animate` | Animate | as above | L3 manim-web |

### Learning (students)

`hint` (Hint, without the answer) · `check_answer` (Check my answer: worked solution, then ✓/✗ on their final line) · `practice` (Similar problem) · `explain` (Explain step). All of these map to existing intents (L2). **Persona decides the default order:** the *studio* and *arcane* themes rank `hint` above `answer`, and *research* ranks `check_step` and `numeric_check` higher.

### Thinking process / notes

`organize` (Organize: scattered notes → outline) · `mind_map` (Mind map: cluster ideas → connected nodes, using the workflow renderer) · `make_table` (Make table: aligned parallel facts or a drawn grid) · `checklist` (To-do list: tasks → checkable list) · `pros_cons` · `summarize` (dense region only) · `stress_test` (Stress-test: a claim or hypothesis → assumptions, counterexamples, the missing case; valuable for PhD thinking) · `timeline` (dated items). Exec: L2 for content, L3 for layout.

### Coding

`code_block` (Format as code: handwritten code → highlighted code object) · `run` (Run: JS sandbox now, Python via Pyodide later, both in a widget) · `trace_algo` (Visualize: drawn array/tree/graph plus an algorithm name → stepping animation widget) · `complexity` (Big-O) · `flow_to_code` / `code_to_flow` · `explain_regex_sql` · `write_tests`. Exec: L2 + L3 (`html_widget`).

### Web and UI design

`build_prototype` (Build prototype: wireframe → working `html_widget`) · `clean_wireframe` (snap boxes, align, rough.js style optional) · `make_diagram` (boxes + arrows → architecture, sequence or workflow renderer, which already exists) · `palette` (swatches or hex codes → design-token card) · `responsive_preview` (on an existing prototype widget).

### Parked for later

Chemistry: `balance` and `structure` (SMILES via smiles-drawer, MIT). Also `translate` and `define term`.

## 7. Executing a suggestion

**The transcription problem.** JeVision picks *Plot*, but the executor needs the formula as LaTeX. Options, in order of preference:

1. **On tap:** run the existing isolated typeset (`normalize` with a selection context) on the cluster to get LaTeX. Then do everything else locally: CortexJS Compute Engine parses LaTeX into MathJSON, which compiles to a JS function. The plot kind (explicit, implicit, parametric, polar, 3D) and the free parameters (which become sliders) are also derived locally from the MathJSON. No second model call is needed.
2. **Prefetch:** when a math chip is shown with `P ≥ 0.8`, or when the pointer hovers over it, start the typeset in the background, so the tap feels instant. This spends model tokens only on high-confidence chips.
3. **Future:** a JeVision-class fast handwriting→LaTeX transcriber would make L1 actions complete in under 1 s. This is worth asking the JeVision team about (§14).

**Action registry.** One file defines everything. Plugins can contribute entries later, reusing the existing plugin descriptor path.

```js
registerSuggestion({
  id: "plot_sliders",
  kinds: ["math_expr"],                 // agreement gate
  pack: "math",
  criteria: "Expression in x (or x,y) with extra letter parameters such as a, k, ω, μ that a user would vary",
  threshold: 0.6,
  eligible: (ctx) => ctx.capabilities.graph && !ctx.overlaps.graph,
  label: { en: "Plot with sliders", "zh-CN": "带滑块绘图" }, icon: "wave",
  prefetch: "typeset",                  // optional
  run: async (ctx) => graphFromLatex(await ctx.transcribe(), { sliders: true }),
  place: "right-of-cluster",
});
```

Placement reuses `normalizeCommandPlacements` and the blank-area logic. Each action declares one of `in-place`, `right-of-cluster`, `below-cluster`, `into-object` or `clipboard`.

## 8. Plotting, geometry and shapes engine

### 8.1 A live Graph object (replaces the static plot image)

The Graph object stores a JSON spec in the canvas file: `{viewport, items:[{latex, mathjson, kind, style}], sliders:[{name,min,max,value}], points:[…]}`. It re-renders crisply at every zoom level, can be edited on double-click, can receive new curves (`plot_into`), and can be exported as SVG or PNG. Old `plot_function` commands convert to a one-item Graph.

Candidate open-source pieces. **Every licence must be re-verified at vendoring time and recorded in `NOTICE`.**

| Need | Candidate | Licence | Why |
| --- | --- | --- | --- |
| LaTeX → evaluable function, simplify, derivative | **CortexJS Compute Engine** | MIT | Bridges typeset output to plotting with no model call |
| Editable formula objects | **MathLive** | MIT | Tap a typeset formula to edit it like Desmos |
| 2D interactive plots + geometry + sliders | **JSXGraph** | LGPL-3.0 / MIT dual | One engine for plots, draggable constructions and sliders |
| 2D function plots (lighter alternative) | **function-plot** (d3) | MIT | Implicit, parametric and polar; interval arithmetic gets asymptotes right |
| 3D surfaces | **three.js** (already in repo), optionally MathBox | MIT | Surface mesh plus orbit controls |
| 3B1B-style animation | **manim-web** (already vendored, v0.3.24) | MIT (verified in `public/vendor/manim-web.LICENSE`) | `animate` action |
| Heavier CAS (integrals, solve) | Algebrite / nerdamer | MIT | Local `solve`/`compute`, with the model as fallback |
| Hand-drawn look | rough.js / perfect-freehand | MIT | Optional styling for cleaned shapes and wireframes |

Recommendation: **Compute Engine + JSXGraph + three.js + manim-web.** Desmos and GeoGebra are excluded because of their licences. Mafs is MIT but depends on React, which does not fit our vanilla client.

### 8.2 Shapes (manual + automatic)

- **Toolbar shape tools:** line, arrow, rectangle (Shift = square), ellipse (Shift = circle), triangle, polygon, axes, grid/table. They produce vector shape objects, or raster ink for now, which is simpler and matches today's model.
- **Hold-to-snap:** when the pen ends a stroke and stays still for about 400 ms, the stroke snaps to its best fit (circle, ellipse, rect, line, arrow, triangle). This is purely local and instant, the same interaction as QuickShape.
- **After-the-fact:** the `snap_shapes` suggestion covers a whole rough sketch. JeVision decides *intent* (a shape or the letter O?). The local fitter produces the geometry.
- Needs: the recent-stroke vector ring buffer (§2).

## 9. Silent, fast, never blocking

**Trigger**
- Fires at pen-up plus a suggestion idle time of about 500 ms, shorter than Auto AI's `autoDelayMs`.
- Evaluates the cluster only if its content hash changed since the last evaluation.
- Skipped for: eraser, move, undo, pending draft on screen, Canvas Agent editing that area, hand or view mode, suggestions off, offline, or circuit open.
- Skipped for tiny input (fewer than 2 strokes, unless it is one closed shape).

**Budget**
- Crop and encode: ≤ 15 ms, off the input path.
- JeVision p50 target ~250 ms, p95 ≤ 700 ms, with a **hard client timeout of 1200 ms**.
- Chip visible about 0.8–1.0 s after pen-up.

**Concurrency**
- At most one request in flight. A new pen-down in the same cluster aborts it through `AbortController`.
- Every result carries `userRevision` and the cluster hash, and is dropped if either changed. This is the same pattern as `checkAI`.
- At most ~20 calls per minute per canvas.

**Failure policy**
- Any error, timeout, invalid JSON, an option outside the offered menu, or a probability sum outside tolerance (the checks mirror `validateAnswers` in `liveclay/server/jev.mjs`) → show nothing, and write debug logging only.
- After 3 consecutive failures, pause suggestions for 60 s, then 5 min.

**Cache:** an LRU keyed by crop hash plus menu hash, so re-visiting unchanged ink costs nothing.

**No coupling:** suggestion code must never touch `state.dirty`, `state.autoEligible` or the Auto AI timer. It reads from them; it does not write to them.

## 10. Configuration, security and privacy

- **Keys never reach the client.** The browser calls `POST /api/suggest` on the PenEcho server, and the server calls JeVision.
  - Local app / npm: `PENECHO_JEVISION_URL`, `PENECHO_JEVISION_MODEL`, `PENECHO_JEVISION_KEY` from env or `~/.penecho` config. Nothing is ever committed.
  - Cloud: a new Admin provider protocol `jev-vision` in the existing provider pool. It gets health checks, priority, retry-once-on-another-connection and the circuit breaker for free, the same as `jev-systemone` for LiveClay.
- The key that was shared in chat should stay out of this repository and its history. Rotating it before production is cheap insurance.
- **Consent:** this silently uploads crops of the user's canvas. It needs a visible *Smart suggestions* setting, with a short disclosure the first time it is enabled. The default for Cloud-signed-in users vs local-only users is an open decision (§14).
- Send only the crop and the facts above. Never the whole canvas, file names or other documents.

## 11. How it relates to Auto AI and the Canvas Agent

- **Suggestions never auto-execute.** Auto AI remains the "just answer" mode.
- **Auto AI gate (bonus):** when Auto AI is on, the same JeVision call can decide whether a full model call is warranted (`kind=none/notes` → skip). That saves model cost and cuts useless answers. If `action` is confidently a specific action, Auto AI can be steered toward it.
- The Canvas Agent can read `canvas_profile` as cheap context about what the canvas is about.

## 12. Evaluation and the learning loop

- **Phase-0 eval set:** about 300 labelled crops (reuse `testcase/` canvases plus new ones) across the six audiences: PhD, math, physics, student, thinking/notes, coding, web design. Each crop is labelled with `kind`, acceptable actions, and "should stay silent".
- **Metrics:**
  - precision of shown chips (target ≥ 85%)
  - silence recall on non-actionable ink (≥ 95%)
  - JeVision latency p50/p95
  - accept rate in dogfood (≥ 25% of shown chips)
  - main-thread long tasks introduced (0)
- **Experiments:** flat menu vs `kind → action` cascade; 12 vs 16 options; with vs without attention rendering; with vs without facts text; per-action thresholds.
- **Runtime feedback:** accept/dismiss events adjust per-canvas cooldowns and feed `recent` in the facts. Aggregated telemetry is sent only with consent, and only as action ids and probabilities, never images.

## 13. Phased plan

| Phase | Scope | Exit criterion |
| --- | --- | --- |
| 0 · Contract & eval (≈1 wk) | Confirm the JeVision vision API; build the eval harness; measure latency and accuracy on 300 crops; choose flat vs cascade | Precision ≥ 85% at ≥ 40% coverage on the eval set |
| 1 · Plumbing + 4 actions | `/api/suggest` proxy + env/Admin config; cluster/crop/facts; chip UI; stroke ring buffer; actions `typeset`, `snap_shapes`, `plot_2d`, `compute`; selection-toolbar ranking | Dogfood: no visible failures, chip p95 < 1.2 s |
| 2 · Graph object + math depth | Graph object (Compute Engine + JSXGraph), sliders, `plot_into`, `plot_3d`, `check_step`, `numeric_check`, `solve`, `next_step`; hold-to-snap and shape tools | Graph replaces `plot_function` output |
| 3 · Domain packs | Physics, learning, notes, coding, design packs; `animate` (manim-web); `build_prototype`; `canvas_profile`; Auto AI gate | Accept rate ≥ 25% per pack |
| 4 · Ecosystem | Plugin-contributed actions; personal calibration; optional fast transcriber | — |

## 14. Open questions for you

1. **JeVision vision contract:**
   - How does `state` carry an image (field name, format, max size, multiple images)?
   - Is the response the same `answers{choice, probabilities, confidence}` / `noul` / `score` as SystemOne?
   - What are the real p50/p95 latency, rate limit and price per call?
   - Does accuracy hold up at 16 options?
2. **Local / open-source users:** should suggestions work only when signed in to Cloud (proxy through Cloud), with a bring-your-own key, or not at all without Cloud?
3. **Default on or off?** Consider the privacy disclosure when deciding.
4. **Plot engine:** JSXGraph (plots + geometry + sliders in one) vs function-plot plus a separate geometry engine?
5. **Transcription:** is on-tap typeset plus prefetch acceptable for v1, or is a fast LaTeX transcriber on the JeVision roadmap?
6. Are there actions you want to cut from, or add to, the catalogue before phase 0 labelling starts?

---

## Demo status (2026-09-27)

A working demo of this proposal is on branch `codex/discussion-20260927`. How to configure and try it is in `docs/smart-suggestions.md`. It covers:

- the `/api/suggest` relay (`src/server/jevision.js`)
- attention-rendered crops, facts and the closed action menu (`kind` / `action` / `finished`), with the agreement gate policy
- silent chips
- a live Graph widget with sliders for **Plot graph**
- local **Clean up shapes** and hold-to-snap
- Typeset, Solve, Check step, Next step, Hint, Make diagram, Build prototype and Organize, all mapped onto the existing AI pipeline with a narrow `suggestion` focus

Two deviations from the text above:

- The default endpoint is `https://api.penecho.ai/v1/systemone`, with model `penecho/jevision`.
- Live verification confirmed `{model, state: facts, image: dataUrl, questions}`. The image is a top-level field; nesting it inside `state` can return HTTP 200 without recognizing the image. `npm run jevision:probe` exercises the verified image protocol with the same timeout as the app.

The Graph object is implemented as a self-contained `html_widget` for now. It handles explicit y=f(x) only.
