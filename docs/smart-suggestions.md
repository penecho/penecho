# PenEcho Assist (smart suggestions v2)

Status: working on the Canvas, 2026-09-28 (updated with 3D graphs, animation and drawing help). This replaces the first chip design. The original rationale is in `docs/jevision-smart-suggestions-proposal-2026-09-27.md`.

## Auto AI defaults and Canvas Suggest requests (2026-10-06)

New profiles default to Manual AI; automatic suggestions remain enabled. A saved
Auto AI preference still takes precedence, including an explicit enabled choice.
The welcome copy directs users to suggestions or the AI button.

Auto AI, the AI button and ordinary Agent submissions keep the existing Canvas
Suggest bar visible during preparation and execution. Requests initiated from
the Suggest bar hide it, including Answer's shared Auto AI entry point, Typeset,
Note, Ask and Agent handoff. Origin is carried through capture and submission;
the executor alone does not decide visibility. Draft Keep controls remain usable.
Success dismisses old suggestions and immediately retires the working state.
Existing result ranking determines whether Next appears. Stop and failure retain
the existing input and restore suggestions when their target is still current.

## Agent Suggest (2026-10-04)

Composer focus and clicking the text input are inference triggers. A click
reuses existing suggestions and skips work already settling, checking
availability, capturing or requesting. When there are no suggestions and no
request in progress, clicking can retry without first leaving the input.
Existing text, attachments, references and conversation history do not block
it. Typing, canvas updates,
project changes, completed AI work, opening settings and usage details never
start a request by themselves. Programmatic focus restoration after closing,
selecting or sending is suppressed so those actions cannot reopen Suggest.

On focus or an idle click, PenEchoLLM ranks meaningful context: nonempty Canvas content (including
strokes), attachments or a selected project. Its fingerprint includes the canvas
ID, attachment IDs, project, strokes, Undo history, user revision, object counts,
selection and references. Canvas AI, Agent and MCP content changes count even
when they are not dirty input. Identical contexts reuse nonempty session cache
entries; empty results can retry on the next click or focus. Changed contexts
can run on the next click or focus without a fixed eight-second gate.

- Focus waits 350 ms and then awaits the existing availability check, or checks
  availability under the shared status policy. The original focus continues when
  cold availability resolves. Typing while waiting or ranking never cancels it.
- Agent requests, Canvas AI preparation and requests, selection AI and Assist
  work block ranking. Focus ownership, settings and allowance are checked again
  after availability and screenshot preparation, immediately before inference.
  Busy completion never queues a retry; another click or focus is required.
- Requests in flight are shared. A later focus with changed context can wait for
  the current request and then rank the new context. Close, outside interaction,
  sending and starting AI work invalidate pending focus intent. Already spent
  requests may finish and cache results, but cannot reopen a dismissed panel.
- Loading uses a small composer status indicator. Only successful, nonempty,
  current results open the separate **Suggest** panel. Failure, unavailable
  service, used allowance and empty results stay silent. While showing ranked
  results, the default category tabs and preset rows are hidden. There is no
  Try asking control or Refresh inference button.
- The default welcome view retains main's **Notes**, **Files & Projects** and
  **Diagrams & More** tabs, full preset prompts and descriptions. It appears
  automatically when there is no conversation or draft, independent of LLM
  availability or focus. Closing Suggest restores this default view when
  eligible; in an existing conversation it restores the full chat area instead.
  Clearing a draft restores the presets. Switching categories or choosing a
  preset never triggers inference. All category labels remain visible, wrapping
  in narrow layouts if necessary. The legacy composer help paragraph has been
  removed from the DOM, localization, and runtime; it cannot reappear when
  suggestions are hidden.
- Suggest has an explicit close button. Escape, clicking outside, moving focus
  away, selecting a suggestion and Enter/Send also close it. Typing leaves it
  available. In an existing conversation, it occupies at most 45% of the chat
  area (320 px maximum); messages and their reading position remain intact.
- Choosing a suggestion replaces the input with its full prompt, preserves
  attachments and never sends automatically. Mouse/keyboard activation returns
  to the input without new inference; touch/pen returns to the transcript
  without opening the software keyboard.

The action space combines Canvas Suggest actions, phrased as fuller Agent
requests, with file, project and authoring requests. `canvasAction` in
`CANVAS_AGENT_PROMPT_LIBRARY` maps to the reviewed Canvas criteria in Cloud's
`agent` mode. Requests above 10% appear in descending order. If none exceed 10%,
show the top three valid scored requests instead (or all if fewer than three).
Missing or invalid scores do not create fallback suggestions. Those at or above
`SMART_SUGGEST.POLICY.confident` (0.45) are highlighted as Recommended.
Probabilities remain internal, including tooltips and accessible labels.
The status row retains PenEchoLLM usage, remaining allowance and detail controls.

Requests send at most 40 candidate IDs, a full-contrast image of the current view
or selection when available, and coarse context: file kinds, project kind,
object counts and changed dimensions. They do not use the draft text as a
trigger or replace it with a placeholder.

Implementation: `src/client/app/agent-suggest.js`, `canvas-agent-runtime.js` and
the request-start hook in `smart-suggestions.js`. Verification:
`test/agent-suggest.test.js`, `test/canvas-agent-prompt-suggestions.test.js` and
`scripts/verify-agent-suggest-focus.cjs` (latest output in
`docs/verification/agent-suggest-live-fix-20261004/`). Earlier verification
artifacts describe the interactions at the time they were captured.

## Agent composer (2026-10-04)

The Agent composer uses its ordinary localized placeholder. It does not display
ranked Canvas actions in the input; contextual ranking lives in the Suggest panel
above. Enter and Send
submit the person's text, handwriting or attachments; an empty composer cannot
submit a placeholder. Canvas Suggest ranking and its Agent action routing remain
available through their existing controls. Each Canvas retains its own composer
draft, and loading or switching restores that draft and updates send availability.

Validation: `scripts/verify-agent-composer.cjs` checks clean Canvas loading without
ranking requests, ordinary typing and submission, and independence from Canvas
Suggest results in an isolated rendered runtime. Its model and Agent transports
are synthetic and do not measure provider inference quality or availability.

## Manual text and image input (2026-10-04)

Confirmed text boxes and imported images, including both clipboard entry points,
are user input. Their dirty object sets participate in the complete pending Suggest input
without requiring a new pen stroke. Object identity, text and geometry are part of
ranking validity; changing the input cancels an old request and starts a new quiet
period. Ranking and dismissal leave the dirty object sets unchanged. Only the existing successful Canvas action lifecycle consumes input. Stop and failure preserve it for another action. Clean
objects loaded from a document or produced by AI do not start this process.

The model crop emphasizes dirty text and images at full contrast, like dirty ink.
Open text drafts and image placement defer ranking until confirmation or focus
loss settles the edit. A settled object can show suggestions with Lasso selected.
Auto AI resumes its existing scheduling and mode/refinement rules at that point.
Validation: `test/smart-suggest.test.js` and `scripts/verify-manual-dirty.cjs` exercise
zero-stroke input, deduplication, dismissal, stale replies, real clipboard events,
submitted pixels, and Auto AI enabled/disabled behavior in isolated runtimes.

## Conversation and checking intent (2026-10-04)

Greetings, thanks, acknowledgements and farewells are conversational turns for Answer. An explicit
specialized request takes priority: checking the spelling of a greeting is Check, typesetting it is
Typeset, and creating a new exercise is Practice. Existing vocabulary/handwriting attempts, supplied
numerical answers, complete derivation lines and visible errors remain eligible for Check.

Ink and selection classification include an independent `check_applicable` probability. Below 0.5,
Check stays in More instead of the automatic main bar, even when action ranking or a learned prior
favors it. An independent `conversation` probability of at least 0.8 with negative checking applicability
puts Answer first; explicit tasks and bounded Note preservation retain priority. Answer remains available and ordinary low-confidence suggestions stay usable. Older server
responses without this question retain their existing ranking behavior. Result Next uses its existing
policy and has no new applicability question.

Low-confidence model rankings and raw rankings that contradict confident communication intent do not
update the per-device prior. A confident ranking with negative
checking applicability also excludes Check's secondary probability from learning. User taps remain
explicit feedback; existing personalized data is preserved. Server questions and the Canvas registry
share the same English policy and remain within the complete 1536-token input limit.

## Execution routing (2026-09-29)

Suggestion ranking and execution routing are returned in the same PenEchoLLM analysis. Animation explanation,
prototype and animate-sketch actions always use PenEcho Agent, including lasso selections.
Widget Make interactive, Animate and Fix error also use Agent. Replay, speed controls,
Present and other local actions remain local.

The ordinary ink/selection Suggest bar preserves **Answer** in first or second
place when PenEchoLLM or the calibrated instant order ranks it there, regardless of highlight confidence. Otherwise
it adds Answer in third place, or last when fewer than three actions are available.
It calls `invokeAIAction("auto")`,
the same entry point as manual Canvas AI, including its current-viewport capture,
selection handling and selected connection. Ranking, `none`, cooldowns and executor
verdicts cannot remove or reroute this shortcut. Other ranked actions remain available
in More. Result previews and clean **Next:** follow-ups do not inject this shortcut;
an Answer recommended for a result keeps the result's scope and executor verdict.

Ranking selects the intended operation rather than the appearance of the source.
Make diagram means a structured representation of semantic nodes and relationships:
flowcharts, workflows, sequences, architectures, states, entity relationships and
mind maps. The Canvas and Cloud action definitions and both execution prompts use
identical task text. Ordinary geometric or pictorial content does not qualify merely
because it contains boxes or arrows. Local geometry fitting cannot recommend this
operation before semantic classification.

Content kinds remain descriptions of the input: `diagram` is semantic structure,
`shape` is geometric content, `drawing` is a depicted subject, and `question` is an
expressed request. Meaningful content without a clear specialized operation uses
Answer's general-purpose understanding. The ordinary Answer button retains the
existing manual Canvas AI entry point; no task-specific action or visual-puzzle
routing is introduced. Other actions describe a concrete outcome such as typography,
calculation, correctness checking, a new visual, animation or source completion.

Ask/Explain/Solve, result Answer, diagrams, organizing notes, illustrations, native drawing
completion, Widget layout correction and applying marks use Canvas AI for instant
suggestions. PenEchoLLM/JeVision can upgrade them using its closed `execution` choice:

- Canvas AI: greetings, short questions/explanations, ordinary one-step math,
  a small diagram, a short single-region outline or a focused cosmetic edit; the
  useful answer fits within 3000 delivered tokens and needs one generation.
- Agent: likely output over 3000 delivered tokens, including artifact code/JSON
  but excluding thinking; external research, code/numerical execution, inspecting
  and repairing rendering, multiple source regions/deliverables, interactive
  prototypes or coordinated animation.

Cloud owns these criteria in `src/services/penecho-llm-actions.mjs`; clients cannot
replace them. Ink/selection/widget ranking includes an `execution_<action>` answer
for every eligible conditional action, including actions in the More menu. A
suggestion click immediately uses that action's saved verdict; it never sends a
second classification request or shows a routing wait. Fixed Agent and local
actions keep their known executors. Missing or still-pending verdicts use the
instant local defaults. Ranking received while the bar is hovered updates its
executor decisions without moving the buttons. Older Cloud responses may supply
one `execution` answer, which applies only to their recommended action.

Explain presentation is independent of that executor choice. A purely textual
explanation uses native text and math notation; mathematical notation alone does
not count as graphics. When the source or explanation involves a figure, diagram,
chart, spatial relationship or graphical mechanism, both Canvas AI and Agent
deliver one Widget combining the relevant graphics with explanatory text. This
Explain rule takes precedence over their general native-drawing and Visual
Explorer defaults. PenEchoLLM still selects the executor by task complexity and
counts any delivered Widget HTML/JSON toward the output estimate; graphics or a
Widget alone do not require Agent.
Typed Ask is a new user-authored request that was unavailable during ranking;
it uses bounded `mode:"route"` with an image, action and task text.
Timeout/unavailable Ask classification defaults to Canvas AI. A chosen Agent task
never silently downgrades when Agent itself is unavailable or busy.

Automatically handed-off tasks show a compact top-right progress window. It uses
the real Agent activity/tool labels, can expand to the existing full panel, and
Stop and close cancels the task. It respects the mobile toolbar inset. Agent
tasks retain normal document tool persistence and history, rather than the Canvas
AI Keep/Retry draft flow. Existing unrelated Agent work is never steered; drafts
and draft attachments are retained. Every handoff includes the captured target,
the recent-stroke and dirty bounds within it, and the invocation viewport in world
coordinates. The target defines the work; the viewport provides orientation and
placement context. Dirty bounds never expand the task beyond its target. Clean
follow-ups still use their explicit target. The prompt requires the requested
result, relevant verification (including motion, pause and replay for animation),
then completion without exploring or improving unrelated Canvas content.

Ink and Widget tasks attach a clean target-region capture; lasso tasks retain the
authoritative masked image. Lasso defines a screenshot boundary above Canvas content,
including a partial Widget with no strokes. Moving or resizing it changes only the
capture region. Captures refresh live Widget pixels and mask every pixel outside
the current polygon; the outline and controls are excluded. Internal Typeset and
scratch-out actions retain their separate, undoable ink extraction. All use scoped references and omit the automatic
whole-Canvas initial capture. A tool-required layout overview does not expand the
task scope. All dirty input is consumed only after a Canvas AI result is committed, or an Agent turn completes successfully with an actual Canvas write. Agent text-only and read-only turns preserve dirty input. Submission, ranking, cancellation, rejection and failure do not consume dirty input. Closing, changing
Canvas, changing selection or undoing target strokes invalidates pending work.

Implementation: `src/client/app/assist-agent.js`. Validation:
`test/assist-agent-routing.test.js`, `test/assist-agent-context.test.js` and
`scripts/verify-assist-agent.cjs`.

## Sketch illustrations: Storybook and 3D (2026-10-04)

The drawing suggestion formerly called *Make it vivid* keeps its action id `vivid` and is now named after
the selected style: **Storybook illustration / 绘本插画** (default) or **3D illustration / 立体插画**.
Settings → Canvas → AI on the canvas has two per-device choices (localStorage):

- **Illustration style** (`penecho-illustration-style`): Storybook = cute picture-book art with soft pastel
  flat colour and thin warm outlines; 3D = glossy soft volumes like a vinyl toy or clay figure (the look users
  preferred from the old *Make it vivid* output, now with the fidelity and background rules below).
- **Illustration background** (`penecho-illustration-background`): Auto adds a simple fitting scene only when
  nothing around the subjects was drawn; None adds no scenery (a plain card). In both modes a background the
  user drew (ground, sky, sun, plants, water, buildings) is kept and restyled.

One English policy per style/background lives in `src/shared/illustration-style.js` and is used by Canvas AI
(`SUGGESTION_FOCUS.vivid`), the Agent route (`ASSIST_AGENT_TASKS.vivid`) and Widget Refine (label and
instruction). It asks the model to render the subjects as drawn: every drawn subject, part and detail in its
drawn number, place, size, pose, facing and expression, with no invented parts, hair, ears, clothing,
accessories or held props; drawn colours other than the default dark ink become colour families (skin may stay
natural); shapes are organic silhouettes rather than sticks, tubes or stacked circles (3D gradients fill closed
shapes, never strokes); the result is one html_widget with a 4:3 (3:4 for very tall subjects) SVG card. The client sends `illustrationStyle` and
`illustrationBackground` only with `suggestion:"vivid"`; the server rejects other values and uses
Storybook/Auto for older clients. Prompts were chosen from seven rounds (about 150 rendered generations) with
the hosted model on real drawings (`docs/verification/storybook-illustration-20261004/report.md`).

**Ranking.** The reported caterpillar (`jevision-requests/1791115403947-…`) showed Organize as Note · Answer ·
Create visual with the illustration fifth. Three causes compounded:

1. The tall caterpillar falls outside the local drawing aspect range (text rows), and its overlapping body loops
   were treated as a note enclosure: `assistNoteScope` probed raster ink that included strokes drawn *after* an
   earlier loop. The request therefore carried `noteScope:"enclosed"`, and the local ranking forced Note first.
2. The deployed PenEchoLLM criterion required an explicit request ("as requested by colour, beautify or
   render"), so the model gave the illustration 9% and spread "make a visual" intent onto `create_visual` (20%).
3. The local 30% blend used a text-row prior.

Fixes: only the newest loop may count raster ink as enclosed content; a confident PenEchoLLM picture verdict
(`kind` drawing ≥ 0.8, finished) uses the drawing prior, disables enclosure note priority and credits
`create_visual` to the illustration (typed words keep Create visual); and the shared criterion now says a
finished picture without written instructions invites the illustration (Cloud `penecho-llm-actions.mjs` and
`public/smart-suggest.js` stay identical; selection worst case 1533/1536 tokens). Replaying the three recorded
drawing answers gives Illustration · Finish drawing · Answer for each; the 98-sample instant-order calibration
is unchanged (first chip 45.9%, previously 44.9%).

## Finish drawing completion (2026-10-03)

Canvas AI and Agent share the completion policy in `src/shared/finish-drawing.js`.
It identifies the whole subject, its missing silhouette and repeated parts before
choosing anchors, and asks for only missing native ink/shapes in place. It keeps
the original composition and avoids decorative additions or a separate HTML
illustration. Each executor receives instructions matching its actual tool schema.

For ordinary ink targets, available current stroke records supply `sourceInk` in
Canvas world coordinates, independent of capture scale. This is a bounded hint:
at most 32 strokes, 32 points per stroke and 512 points total. Sampling preserves
endpoints, adjacent distinct samples and major corners. Stroke widths remain in
the record; the common native width uses the median rounded to the renderer's
supported integer range. The image remains authoritative for all visible content.
Records removed by Undo, strokes crossing the target, and out-of-capture geometry
are omitted. Masked lasso selections and drawings without vector history use the
image alone. The server accepts geometry only for Finish drawing, rejects unknown
fields and checks every point against the actual attention region.

The prompt and geometry policy are based on the 32 UAT model examples in
`docs/verification/finish-drawing-20261002/report.md`; that experiment does not
establish an end-to-end latency improvement or reliable completion of every
repeated pattern. Validation: `test/finish-drawing.test.js`, the Finish drawing API
case in `test/server-security.test.js`, and `scripts/verify-finish-drawing.cjs`.

## Instant order (2026-10-03)

The bar that appears before PenEchoLLM answers is calibrated against 98 real PenEchoLLM rankings
(`docs/verification/suggest-instant-order-20261003/report.md`). `inkCues` reads cheap glyph cues
from the stroke vectors: open or complete `=` pairs and rectilinear line art. Stacked or crossed
Chinese bars (三, 王, 元) and a lone 二 are not `=`. `instantBucket` maps the cues to a bucket,
and each bucket has its own score table:

| Bucket | Instant bar |
| --- | --- |
| `open_equation`: an `=` with nothing to its right, including stacked exercises | Solve · Typeset · Answer (Solve highlighted) |
| `formula`: an `=` with a right-hand side | Plot · Solve · Answer |
| `derivation`: a complete equation written under earlier ink | Check · Next step · Answer |
| `line_art`: mazes, flows and other long horizontal/vertical runs | Answer · Make diagram · Explain |
| `drawing`: compact freehand ink | Storybook/3D illustration · Finish drawing · Answer |
| `text_rows`: several written lines | Typeset · Answer · Check |
| `text_line`: one line of words | Answer · Typeset · Create visual |
| `single_mark`: a single stroke | Answer · Typeset · Finish drawing |

Some ink keeps its previous path: fitted shapes (Clean up shapes), selections, Widget Refine, Delete
and callers without stroke vectors. A ranked Answer from the local order also keeps first/second place.

**Learning on this device.** Two signals update a per-bucket running average, which becomes an EMA after
40 samples:

- each ink ranking whose winning action has at least 45% raw probability, whose reported confidence is at least 45% when present, and whose `none` is below 40%; Check additionally requires a positive applicability verdict when available;
- each tap on an ordinary ink chip, which counts twice.

The average is blended into the bucket's table with a weight of at most 55%. It is stored in
`localStorage` as `penecho-smart-suggestions-instant-prior` and is never sent. Results, follow-ups,
selections, Delete and Refine do not learn.

Validation: `test/suggest-instant-order.test.js` and
`node docs/verification/suggest-instant-order-20261003/evaluate.cjs`. The first instant chip matches
PenEchoLLM's in 45% of samples (17% before). Top-3 overlap is 69% (57% before). On average, 1.3 of 3 chips
change when the ranking arrives (2.1 before).

## Why the first version was hard to see

The first version showed a chip only when all of these held:

- PenEchoLLM was confident
- the ink was "finished"
- PenEchoLLM's `kind` and `action` answers agreed
- nothing else was happening

In practice that window almost never opened:

| Cause | Effect |
| --- | --- |
| PenEchoLLM takes 2–3 s live, plus a 0.65 s idle delay | The first chip could appear only about 3.5 s after the pen lifted. |
| Every new pen-down aborted the in-flight request and hid the chip | During normal writing, where pauses are shorter than 3 s, requests almost never completed. |
| Auto AI fires 5 s after the pen lifts and hides chips | Where a chip did appear, it lived for about 1.5 s. |
| Strict policy: `none` ≤ 0.35, `finished` ≥ 0.5, agreement gate, per-action thresholds | Many real answers (`none`, "unfinished", low confidence) produced nothing at all. |
| Tapping ran a model call with no visible progress, and gave no next step | Even a successful tap felt slow and ended the conversation. |

## What Assist does instead

**Always offer, rank by prediction.** The bar is never gated. Confidence only decides whether the first action is highlighted.

1. **Local help after 500 ms of pen-up quiet (no network).** Stroke cues, geometry and a per-device learned prior predict the first actions (see *Instant order*); Answer keeps a ranked first/second slot or defaults to third; PenEchoLLM may rank Answer first or second once it responds. Additional ranked actions stay in More:
   - rough shapes → *Clean up shapes*; semantic process/relationship sketches → *Make diagram*
   - an open `=` → *Solve*; `f(x)=…` → *Plot graph*; a new equation under earlier lines → *Check step*, *Next step*
   - plain words → *Answer*, *Typeset*; several lines → *Typeset*, *Answer*
   - mazes and other line art → *Answer*, *Make diagram*
   - without stroke vectors (selections), the geometric fallback and canvas profile still apply
2. **PenEchoLLM ranking after a quiet period.** Every pen-up starts a 500 ms display delay; continued writing resets it. Writing amount is the sum of actual pen-down durations in the current writing cycle: short ≤3 s, medium >3 s and ≤10 s, long >10 s. Pauses, zoom and classification requests do not affect this count; full input consumption, erasure or a document change starts a fresh count. After the bar appears, short writing waits another 100 ms before requesting ranking; medium and long writing wait another 500 ms (600 ms and 1000 ms total from pen-up). Each pause sends one analysis according to its writing tier. Pen-down restarts that quiet period and aborts/detaches the current request, so the next request never waits for its completion. Every successful current answer immediately ranks the stopped ink, including medium/long writing; no additional stroke is required. Ranking never consumes dirty input, including when the model answers `none` or wins a pen-down cancellation race. All unprocessed strokes, text and images remain one complete input scope, without time or proximity grouping. New input refreshes the complete scope; an older verdict may supply a display default but cannot route execution for newer input. Manual AI, Auto AI and suggestion actions continue to use the existing dirty lifecycle. Stop and failure preserve input; successful Canvas actions clear all dirty input. Lasso requests still send only their masked selection; their successful completion clears all dirty input too. A final successful reply updates the visible Suggest bar even while it is hovered; an open Ask input keeps its draft. Document changes, dismissal, erasure, Undo, selection changes and disabling suggestions invalidate obsolete replies. Pending and refreshing bars both show the loading line, refreshed when scheduling or starting a request. A PenEchoLLM `none` or low confidence only removes the highlight. If PenEchoLLM fails, the local help stays.
3. **Visible progress, then a next step.** Tapping an action turns the bar into a progress state with **Stop**.
   - When a draft result arrives, the bar shows **Keep / Retry** and requests PenEchoLLM ranking from the rendered result. Widgets commit immediately and use the same result analysis. A suggested action accepts a pending draft first, waits for input consumption, then continues. Next actions are never inferred from a fixed previous-action table.
   - After Keep, **Next:** appears only when a result action has at least 80% raw probability and the reported action confidence is at least 80%. Pending, failed, `none` and low-confidence result ranking leave the entire Next bar hidden, including Ask and the ranking badge. Ordinary Suggest retains its local actions after the display delay and its low-confidence behavior.
4. **Ask about this.** An inline field sends a typed question scoped to the ink. It goes to the model as typed input with the `ask` focus.
5. **Tools in the same place:**
   - The **⋯** menu and a new toolbar button hold shape tools (drag to draw): rectangle, ellipse, line, arrow, triangle and axes. Shift keeps proportions or snaps lines to 45°; Esc finishes.
   - **Graph** and **3D graph** insert an instant graph widget: no model call, type a function, letters become sliders.
     - The first view always shows both axes. The y-range comes from robust percentiles and includes y = 0; the x-range stretches (up to |x| ≤ 100, keeping the origin) when the curve has no root or turning point in [-10, 10], so `(x-30)^2+50` opens on its vertex.
     - A formula in x and y (`z = sin(x)*cos(y)`, `f(x,y) = x^2 - y^2`) becomes a shaded 3D surface with a box, grid and labelled z-axis. Drag to rotate, scroll to zoom.
     - The parser has no `eval`. It accepts implicit multiplication, `sin^2(x)`, `√`, `π`, unicode superscripts, `arcsin`, `log2` and `cbrt`.
6. **Hold to snap:** finish a rough line, circle, ellipse or polygon, hold the pen about 0.5 s, and release to apply the recognized shape. A pause tolerates 8 screen pixels of tremor; once recognized, the result remains fixed within 18 screen pixels of the pause anchor. Only deliberate movement beyond that anchor restarts recognition. Stationary tail samples do not distort the fit, and sparse pointer streams can still recognize lines and polygon corners. Shape fitting tolerates small closure gaps and rough edges while rejecting open arcs, pronounced waves, figure eights and repeated loops. Automatic snapping follows the Suggest setting and ignores strokes smaller than 12 screen pixels.
7. **Creative help for drawings.** Compact freehand ink that is neither a line of text nor clean shapes counts as a drawing. It is offered:
   - *Storybook illustration* or *3D illustration* (Settings → Illustration style): a finished SVG scene of the same subjects beside the sketch (see "Sketch illustrations" above).
   - *Finish drawing*: native strokes in the same hand-drawn style that complete the picture (for example the rest of a cat), without redrawing anything.
   - *Animate sketch*: the user's own strokes come alive as a rigged puppet (see below), with Replay, Pause and speed.
8. **Explain with animation (3Blue1Brown style).** Offered for formulas, derivations, diagrams and questions. It opens the Canvas Agent with its Manim-Web visual skills (math-2d, math-3d, physics-2d) and a prompt that includes the region, so the result is a step-by-step animated explanation placed beside the ink. Without the Agent it falls back to one self-contained General HTML animation (dark background, inline SVG, Replay).

   `animate` teaches an idea, problem, proof or process through meaningful motion and timed visual stages. `animate_sketch` moves the subject of an existing drawing while keeping its identity and composition. Both are independent PenEchoLLM choices; sketch animation no longer borrows the score for static illustration rendering. Explicit motion requests and play or motion cues beside a recognizable picture are evaluated alongside static explanation, graphing, illustration and completion contrasts. The criteria (2026-10-03) state the three-way contrast directly: movement of the drawn subject, including "bring it to life", is `animate_sketch`; a still colourful rendering is `vivid`; teaching an idea through motion is `animate`. Locally, a small play triangle or two or more short parallel speed lines outside the picture's body mark a motion cue: local ranking leads with Animate sketch, and with a PenEchoLLM verdict the cue adds a fixed bonus that keeps it visible without overriding a confident model. Shading inside the body is not a cue. `animate` keeps the PenEcho Agent route.

   **Animate sketch puppet (2026-10-03).** The bar sends the target's vector strokes (`sketchInk`, ≤64 strokes, drawing order, colour and width) with one Canvas AI `plot` request. The model sees a compact view (≤16 anchors per stroke) and returns only a rig: `scene {engine:"puppet", subject, parts:[{id, ink:[i | "i:a-b"], parent, pivot:[x,y], motion:[{type, amp, period, phase}]}], effects:{shadow}}`. `"i:a-b"` splits one stroke, such as a single Λ drawn for both legs. PenEcho builds the stored scene from the user's full-resolution ink: every sample belongs to exactly one part, unlisted ink stays on the first root, adjacent parts share their joint sample, cycles are broken, missing pivots are inferred (ground contact for a root, nearest point to the parent for a limb), amplitudes are clamped and the stage reserves room for hops and travel. Motions: swing, flap, sway, wiggle, spin, bob, float, hop (with squash and stretch), travel, shake, orbit, breathe, stretch, blink and flicker; all are periodic, so the loop never jumps. The widget first redraws the sketch stroke by stroke in the original order, then eases into motion; travel adds speed lines, a hop lands with a dust puff and grounded subjects get a soft shadow. A root without motion breathes slightly. Scenes render with plain SVG inside the existing scene runtime (engine `puppet`, no vendor script). If the model returns a redrawn scene or an invalid rig, PenEcho retries once with the rig contract; if that fails, the user's ink still hops with squash and stretch. A moved or region-only lasso, or older raster ink with no vector strokes, uses the previous PenEcho Agent path.

9. **Independent Delete gesture.** A strike-through or cancellation scribble offers **Delete? / Keep as ink** through pen gestures, even when Suggest is disabled. Delete is absent from the Suggest action registry, local ranking and Cloud action question. It never runs from gesture recognition alone. Tapping Delete immediately erases the identified whole Canvas strokes and their cancellation marks locally, without a Canvas AI request, model selection or draft confirmation. Loaded raster ink uses a bounded mask of the crossed connected components, preserving unrelated ink even inside their combined bounds. A confirmed mark over one Widget removes that Widget directly, rather than asking AI to edit its source. Both paths are one Undo/Redo step that also restores the cancellation marks; remaining dirty input stays available for ranking. Stale or ambiguous targets keep their content and marks. Strong local crossings can offer Delete without network classification; ambiguous object targets require confident visual confirmation before the offer appears. While the independent offer is visible, the Suggest bar is suppressed. Continuing to write dismisses the old offer. Cancellation marks never offer shape cleanup, and the closed model menu includes at most twenty choices and stays within the complete 1536-token input budget.

Ink Lab creation entries and its “Make objects interactive” suggestions were removed on 2026-09-29. Existing saved Ink Lab widgets retain editing, Undo and export support.

The bar stays out of the way:

- **Agent requests:** opening the Agent panel keeps Canvas suggestions available. Starting a request, including preparing a Suggest-to-Agent handoff, hides the suggestion bar and makes it inert until the request ends. Stop or failure restores suggestions for the current valid input; successful completion dismisses the old suggestions. New input remains eligible, and result follow-ups retain their own ranking rules. Keep/Reject controls for an existing Canvas AI draft remain usable.
- **While you write:** the actionable bar is immediately hidden and inert, whether a request is pending, finished, or absent. A late ranking/result render cannot reveal it before pen-up. Hold-to-snap keeps its non-actionable stroke feedback.
- **At every pen-up:** it stays hidden and inert for 500 ms, then reappears with local help independently of remote classification, after recalculating a safe position against the completed stroke. Late replies and other refresh paths cannot bypass this delay. Starting a stroke clears stale hover/deferred placement. Gesture candidates share the remote debounce and do not hide local actions.
- **Placement:** first display, reappearance, ranking/size changes and viewport changes check all visible raster ink (including loaded, consumed and older strokes) and Widgets. Images, text, animations and pending results are also avoided. The preferred position retains the 64 px writing gap and bottom-toolbar clearance; an available content-free position always wins. Only when no full bar-sized free position exists within the usable viewport may the bar overlap content, choosing the least occupied area. An 8 px content margin and proximity to the existing anchor break ties. Unchanged frames reuse the occupancy table and placement. During dragging, wheel panning and zooming, the bar follows its previous world position with viewport clamping; these frames do no pixel readback or placement search. After navigation has been quiet for 120 ms, one full placement pass restores content avoidance and toolbar clearance.
- **Auto AI:** hovering the bar pauses Auto AI; leaving it resumes Auto AI.
- **Hiding:** suggestions and follow-ups have no idle timeout. Reading, switching tabs, changing tools, and panning or zooming keep the bar. A click or finger tap on blank canvas, **×**, or **Escape** dismisses it and cancels ranking; late replies cannot reopen it. New ink restores automatic offers. Hovering pending input with a mouse, clicking it with Hand, or tapping it with a finger also restores suggestions. A completed PenEchoLLM verdict for the current ink is reused; otherwise the bar displays local suggestions and starts a ranking request immediately, including in Hand mode, without the writing delay. Dismissal keeps the ink available; accepting an action consumes it. Drawing, dragging, and multi-touch navigation neither dismiss nor reopen help. Taps on ink or objects do not count as blank taps. An in-flight Canvas AI request leaves suggestions enabled. Clicking an action or submitting Ask cancels the old Canvas request before starting the selected executor; unaccepted drafts retain their Keep/Retry interaction. Switching documents, disabling suggestions, or invalidating the target still clears it. An action dismissed twice with **×** is skipped for 45 s.

| Action | Runs as |
| --- | --- |
| Plot graph | `plot` → `plot_function` (with `parameters`) → interactive graph widget |
| Typeset | lifts the complete pending input into a selection and runs the existing Typeset |
| Solve | `answer` for every unsolved problem in the target region; complete missing values or expressions in place, including integrals and equations, without recopying the source; steps only when needed and no answer boxes unless requested |
| Check step | `explain`, focused on the newest line only; ✓ or the exact error |
| Next step | `continue`, one line only |
| Hint | `hint`, without revealing the answer |
| Try a problem / 练一题 | `answer` → `practice`: exactly one new, related, solvable question at a similar level; no answer, solution or hint |
| Clean up shapes | local shape fitting, one undoable step |
| Make diagram | `plot` → available renderer for the requested semantic diagram |
| Build prototype | `plot` → General HTML prototype |
| Organize notes | `answer` → outline |
| Answer | manual Canvas AI from ordinary Suggest; a classified result Answer retains its scoped action |
| Explain | existing action |
| Ask | `answer` + typed question (`ask` focus) |
| Explain with animation | Canvas Agent (Manim-Web skills); fallback `plot` → `animate` focus |
| Finish drawing | `continue` → `finish_drawing`: one native `draw` command, adding only missing strokes in place |
| Storybook / 3D illustration | `plot` → `vivid` with `illustrationStyle` and `illustrationBackground`: one General HTML SVG scene card |
| Animate sketch | `plot` → `animate_sketch`: a puppet rig of the user's own strokes (`penecho-scene+json`, engine `puppet`); Agent only without vector ink |

Drawing routes prefer native brush strokes, line segments and shapes, including completions with more than 10 marks. The 48-item completion budget sits within the native renderer's 64-item / 2048-value limits; curve points do not trigger an HTML fallback. Function surfaces use `plot_function` with `surface:true`; supported 3D, animation and physics use compact `penecho-scene+json` input rendered by PenEcho. These scenes retain the `html_widget` envelope but do not require the model to write HTML. Hand-written HTML remains a fallback for requirements the built-in renderers cannot express.

**Practice (2026-10-02).** Formulas offer **Try a problem** in More immediately;
PenEchoLLM can rank it first for formulas, study notes, vocabulary, code or worked
examples when learning or review is useful. Ordinary memos alone do not imply
study. Clicking creates one new question from the scoped content, preserving its
topic, language and apparent difficulty while varying the values or situation.
The executor checks solvability privately and delivers only the question as
native text/math beside or below the source, with space for the learner's work.
It never includes an answer key, solution or hint, including in hidden widget
content. Keep/Retry remain available. A fresh practice result offers no automatic
Next actions that could immediately solve it; subsequent learner handwriting
uses the ordinary Suggest actions. Ink, lasso and previous-result clicks retain
their existing scope, Undo and input-consumption behavior. Both Canvas AI and
Agent follow the same question-only instructions.

## Configure

Canvas uses the fixed Cloud endpoint `/api/v1/apps/penecho-llm/suggest`, publicly named **PenEchoLLM**. The local 071 host forwards the user's account session or a scoped anonymous trial capability. LAN pages never receive these Cloud credentials. Cloud Canvas uses a same-origin browser cookie and request protection. Sign-in changes cancel pending ranking and refresh availability.

The UAT policy is 200 successful new analyses per anonymous trial identity per UTC day; signed-in free accounts receive 500 total including linked trial usage. After 500, users may explicitly enable continuation at 0.1 credit per successful analysis, with an editable daily spending limit. Subscribers pay no Suggest fee and have no daily count allowance. Cached responses and failures are free. Local suggestions remain available when the Cloud allowance is exhausted. Executing a suggested action with another model follows that action's separate billing rules.

Quotas and request limits apply to accounts or trial capabilities, never a shared school/company egress IP. Anonymous installations can be reset, so they are not verified unique people. Cloud applies additional fleet cost and concurrency limits; a whitelist alone is not proof that a request came from an official binary.

The only network payload is `{version:1,mode:"ink"|"selection"|"result"|"widget",image,context}`. Cloud owns the fixed instructions, action descriptions and output validation. Clients cannot provide questions, arbitrary facts, a model name, an endpoint or new actions. See the canonical Cloud document `docs/jevision-application-pool.md` for the complete server-owned contract and deployment policy.

The Canvas runtime contains no direct upstream transport, endpoint or model configuration. Legacy `PENECHO_JEVISION_KEY`, `PENECHO_JEVISION_URL`, `PENECHO_JEVISION_MODEL` and `PENECHO_JEVISION_STATE_FORMAT` values are ignored. `PENECHO_JEVISION_ENABLED=false` remains a local off switch and `PENECHO_JEVISION_MOCK` is only a deterministic offline fixture. The legacy `npm run jevision:probe` command now probes the running local Cloud gateway (`PENECHO_PROBE_ORIGIN`, default loopback port 3921), without upstream credentials.

**Image scope.** PenEchoLLM ink ranking and its action target use all pending dirty input together, without dividing it by stroke age, pause duration or proximity. The crop adds only 8 Canvas units of edge padding. Ranking responses leave every dirty contribution unchanged. All pending input, including earlier ranked input and input added during a ranking request, remains in the complete scope until a Canvas action processes it. Stop and failure preserve the input. Nearby clean Widgets, images, text and animations never enlarge the crop. Results and gesture targets remain complete, including offscreen portions, with the same small margin. Explicit lasso selections retain only their masked pixels. Widget Assist captures its target and relevant marks with 8 Canvas units of padding. These classification crops do not change the separate context used to execute an action.

**Image limits and compression.** All PenEchoLLM image modes share a 512-pixel longest-side limit (width and height at most 512, at most 262,144 pixels), preserving aspect ratio without upscaling small ink crops. A 256 KiB limit applies on the entire image data URL, including base64 overhead (roughly 192 KiB of image bytes). WebP is preferred at quality 0.90, then 0.78 if needed. If WebP is unavailable or still over budget, small PNGs up to 64 KiB remain lossless; larger images use JPEG at quality 0.86 only when it is at least 15% smaller, then try quality 0.74. If no format fits, reduce both dimensions by 25% and retry. Encoding is bounded to eight sizes, always resampling from the original crop. An image that cannot fit is not sent. Cloud additionally bounds decoding to 2048 × 2048 pixels and a 700 KiB encoded image. The versioned action contract is required.

**Complete classification capture.** A PenEchoLLM image request is sent only when every Widget inside the image has current pixels. Lasso selections, gestures, execution routing and Widget ranking capture the Widgets they contain as they look now; automatic ink and result ranking may reuse a same-version image captured within the last two seconds. For a lasso, only Widgets that touch the polygon itself are required, and everything outside the polygon stays white. Widget preparation has its own 8-second deadline and runs before the queue-aware request deadline starts; cancelling the selection, switching documents or new input aborts it immediately. If a required Widget cannot be captured, no image is sent: the local suggestions stay, the pending state ends with `snapshot-unavailable`, and one retry runs when the background capture completes. Widget Assist renders its target independently of overlapping canvas objects and preserves snapshot detail when the widget has been scaled down. Only relevant marks requests include current dirty ink; unrelated old marks are excluded.

**Development configuration.** Use a trial or account session and a configured Cloud application pool for integration tests. Cloud admits at most two primary execution requests across replicas; excess requests enter a FIFO queue before upstream dispatch. Queue wait is bounded at 30 seconds, followed by a separate 12-second execution budget. With the official backup enabled, the primary attempt uses at most six seconds and leaves the remainder for one backup call. Queue expiry and upstream busy responses do not mark the primary unavailable. A primary outage routes all requests, including waiting work, to DeepSeek until a valid 30-second recovery probe restores it. Without a backup, a fast transient failure may retry once within the remaining execution budget and same allowance reservation. The browser and local relay permit 44 seconds, including transport and trial initialization. Widget preparation retains its own deadline; pen-down, scope changes and cancellation abort immediately. Legacy local timeout settings cannot extend these budgets. Unchanged input automatically retries at most once, then retains local/manual tools until changed input or explicit new intent. Windows needs a separate shared entrance gate to retain native GPU permits after HTTP disconnects. Start canonical source with `npm start -- --port 3921`.

**Offline demo.** `PENECHO_JEVISION_MOCK=auto` answers locally: shapes → *Clean up shapes*, otherwise *Typeset*. You can also set an action id to force it, for example `PENECHO_JEVISION_MOCK=plot`. The mock is for demos and tests only.

Users can turn automatic offers off in **Settings → Canvas → AI on the canvas → Automatic suggestions**. The switch appears next to Auto AI and persists on this device. Turning it off hides new-ink suggestions and Widget header suggestions and cancels background ranking requests. Explicit ink selections, Refine, and manual tools remain available. Re-enabling also restores local suggestions when no PenEchoLLM relay is configured.

## How it works

- **Stroke log and units.** Vectors are kept only for recent strokes, because Canvas ink is raster.
  - An 8-second gap starts a new local writing unit, and one unit spans at most 30 s. These limits and the 64-stroke cache affect local tools, not the mandatory dirty input in a PenEchoLLM image.
  - The log follows the current Canvas and excludes undone or erased strokes.
  - Snapped and tool-drawn strokes are marked exact: they still count as diagram context, but are never offered for clean-up again.
- **Local prediction.** `localPredict` in `public/smart-suggest.js` works from:
  - rows (merged vertical bands)
  - aspect ratio
  - shape coverage (closed shapes, arrows, rectangles)
  - whether the new strokes sit below earlier ones
  - typed text
  - the PenEchoLLM canvas profile

  It returns a distribution, not a verdict.
- **PenEchoLLM request.** An attention-rendered WebP crop (PNG/JPEG fallback) is sent as `{version:1, mode, image, context}`. Automatic ink, gesture and step images must include the complete current Canvas dirty bounds, including pending lines outside the latest writing unit, vector cache or viewport. Clean pixels inside the tight crop remain context at 55% opacity; adjacent objects do not enlarge it. Pending handwriting is composited from the actual raster through the dirty mask at full contrast; a successful classification only advances classification bookkeeping and never clears or fades dirty input. Encoding rechecks dirty bounds immediately before capturing available pixels. Existing input-consumption, erasure and Undo behavior determines when dirty contributions disappear. One request is in flight at a time; newer ink queues exactly one follow-up request. Explicit action-routing targets, Widget requests and masked lasso selections retain their own scope and do not acquire unrelated dirty content.
- **Result ranking.** Normal Canvas AI requests and Assist requests analyze the actual returned native ink/text or Widget using `mode:"result"`. The full result is captured at full contrast even outside the viewport; surrounding content is faded to 55%. Context padding is 8 Canvas units, without expanding to neighbouring objects or adding unrelated dirty input. The shared 512-pixel / 256 KiB data-URL encoding limits still apply. Cloud interprets the result as rendered output, not new handwriting, and validates each recommended action's executor in the same request. Next actions require at least 80% raw action probability and, when supplied, at least 80% reported confidence. Empty, pending, failed, `none` and low-confidence rankings hide the entire Next bar; preview Keep/Retry controls remain available without Next controls or a ranking placeholder. Erasure drafts are classified only after Keep: their red masks still show the old source, so their preview cannot supply a verdict for the committed result. Moving/resizing drafts, partial acceptance, rejection, Undo, new input and document switches invalidate obsolete results. Result classification never advances ink bookkeeping or marks output dirty. Suggestions handed to Agent collect the bounds of successful Canvas mutations and enter the same result analysis on successful completion; read-only tools, errors, cancellation and stale conversations do not create next actions.
- **Dirty input and result context.** AI output never becomes new user dirty input. A committed Canvas Widget consumes its input synchronously, so stopping or superseding the asynchronous request cannot restore old dirt. Every successful Canvas AI action, and every Agent turn that successfully writes to the current Canvas, clears all dirty markers across the Canvas, including input outside a masked lasso or explicit target. Widget Refine uses all pending handwriting, text and images as instructions for the referenced Widget, including distant and offscreen content. Nearby marks choose the Widget; they do not restrict its refinement input. Failed, cancelled, rejected, empty or stale tasks do not consume dirty input. A Note card created by the local fallback after an unsuccessful AI request also preserves dirty input. Agent turns that only read Canvas content or return chat text preserve all dirty input, even when the turn completes successfully. Main AI screenshots include all visible content layers when calculating their bounds, including widgets. Follow-up actions retain the original input and the actual committed result bounds, including moved or resized drafts and individually accepted batch items. A follow-up that accepts a draft waits for that request to finish consuming its input before starting the next request. Rejected or empty results do not create a follow-up target.
- **Ask.** The typed question belongs to that request and is sent with its captured attention region. Clipping the original target to the viewport must not discard the question. Lasso Ask continues to use only the masked selection.
- **Undo and dirty input.** Canvas history records input ownership alongside content: dirty ink masks, manual text/image IDs, attention hints and stroke consumption. Undoing an AI result restores the input state from before its commit; redoing it restores the consumed state without making AI output new input. Unrelated pending input remains available. History invalidates old requests and rankings before restoring input, then resumes the ordinary Suggest/Auto AI scheduling rules. Mask snapshots keep their original dimensions and remain independent of live masks; stroke ownership uses history IDs rather than retaining evicted history entries.
- **Ranking.** `rankActions` combines the two sources:
  - Combined score = 0.7 × PenEchoLLM (renormalised without `none`) + 0.3 × local.
  - Actions that don't fit the answered `kind` are halved.
  - Actions dismissed twice are skipped for 45 s.
  - The first action is highlighted when PenEchoLLM gives it ≥ 0.45 with `none` < 0.4, or when there is no PenEchoLLM answer and the local score is ≥ 0.45.
- **Failures.**
  - Transient browser failures retry unchanged input or an explicitly requested Widget ranking at most once. The existing backoff and `Retry-After` handling still apply. A second failure stops automatic analysis for that input; new input or an explicit new manual request starts a new attempt. Dismissal, consumption, document changes and disabling suggestions stop obsolete work.
  - Configuration/allowance status runs once on visible initialization and then only on relevant input, focus, online, visibility or explicit settings/account actions. Each due Suggest for eligible input rechecks unavailable status before ranking, bypassing previous failure, authentication and unconfigured-status cooldowns in both the page and local relay. New input does not inherit an older input's inference backoff. Checks wait for the normal pen-up debounce; exhausted unchanged input does not restart. Concurrent demand shares one check, and server `Retry-After` still applies. No idle retry timer is created. Passive focus/online/visibility checks reuse success for 30 seconds, unconfigured/unsupported status for five minutes, and transient cooldowns of 5–60 seconds with jitter. Hidden/off pages suppress passive checks; initialization and explicit controls still support manual features when automatic suggestions are off.
  - A page coalesces concurrent status demand. Account changes invalidate and abort pending checks, and late old-account responses cannot restore availability or allowance. Desktop windows additionally share one status request/cache per Cloud origin and local account session; the local status route preserves upstream HTTP failures, `Retry-After`, and `Cache-Control: no-store`. Spending changes invalidate cached status, and actual suggestion replies update cached allowance.
  - Rate limits use a 30-second delay. Invalid requests and exhausted allowances do not enter the recovery loop.
  - Local help is unaffected by any of these.
- **Relay.**
  - The server allows 40 requests per minute.
  - The key never reaches the browser.
  - `PENECHO_JEVISION_MOCK_DELAY_MS` reproduces the live 2–3 s round trip in demos.

## What the Canvas should offer next (roadmap)

**Selection = explicit intent.** Lasso selections already share ranked actions and a masked PenEchoLLM crop.

**Math:**
- local CAS for instant Solve, derivative and integral once LaTeX is known (Nerdamer is already bundled for Ink Lab)
- graph from a typeset formula without a second model call
- implicit, parametric and polar plots
- units check
- numeric identity test

**Thinking:**
- turn several notes into a mind map (workflow renderer)
- pros/cons table
- timeline
- "stress-test this claim"

**Coding:**
- handwritten code → highlighted code block → run (JS now, Python via Pyodide later)
- data-structure sketch → step-through animation

**Design:**
- wireframe → clickable prototype (already an action)
- clean up a wireframe with the shape tools
- palette from swatches

**Speed:**
- optional speculative preparation of a very confident top action (PenEchoLLM ≥ 0.85) so the tap is instant; this costs model tokens, so keep it behind a setting
- a fast handwriting→LaTeX recogniser would make the math actions local

**Auto AI:** when Assist is on, consider defaulting Auto AI to manual, or letting PenEchoLLM's `none` skip needless Auto AI calls.

## Files

- `public/smart-suggest.js`: action registry, questions, facts, local prediction, ranking, follow-ups, shape fitting, shape-tool geometry, graph widget. It is pure code and unit-tested.
- `src/client/app/smart-suggestions.js`:
  - stroke log, clustering, crop and the non-cancelling PenEchoLLM lifecycle
  - the Assist bar, including its progress, result and follow-up states
  - executors, Ask, the instant graph, shape tools and hold-to-snap
- `src/client/app/living-ink.js`: preserves editing, Undo and export for existing saved Ink Lab widgets; it offers no creation tools or suggestions.
- `src/client/app/ui-bootstrap.js`: pointer hooks for the shape tools.
- `src/server/jevision.js` and `src/server/main.js`: the relay and the `suggestion` focus, including `ask`.
- `public/index.html`: the toolbar button `#assistToolsBtn`.
- `public/style.css`: `.assist-*` styles.
- `test/smart-suggest.test.js`: pure model, VM lifecycle (non-cancelling, retries, documents, undo, erase) and wiring.
- `test/assist-context.test.js`: widget capture bounds, nearby context and committed result geometry.
- `scripts/verify-result-suggestions.cjs`: isolated Electron acceptance for Widget and native result capture, next-action requests, `none`, rejection, Undo and image budgets in local and synchronized Cloud clients.
- `scripts/verify-assist-context.cjs`: isolated browser acceptance with intercepted model payloads and pixel checks for complete widget capture, follow-up attention, adjacent handwriting and clipped Ask questions.
- `scripts/verify-suggest-dirty.cjs`: isolated Electron acceptance proving that request images retain earlier dirty lines after ranking, pauses, cache/history pruning and viewport changes, without redrawing erased pixels or expanding explicit selections and routing targets.

## Known limits

- The instant graph and Plot use fully editable equation rows and explicit 2D/3D controls. They support equations solved for x, y or z, numerical implicit curves/surfaces, and parameter definitions such as `a = 2` (including dependent parameters). In 3D, equations without z extend along z; changing dimension never changes an existing equation's meaning. Formula edits, mode, parameters and the current view persist in the widget document and participate in Canvas history. Saved native height plots migrate to complete equations preserving their original meaning.
- Graphs use bounded numerical sampling, so small features and zero sets without a sign change can be missed. Parametric/polar plots, inequalities, restrictions and calls to user-defined functions are not supported yet; unsupported syntax gets an inline error. Input accepts plain mathematical notation, implicit multiplication, common functions and Unicode powers. The editor is not a symbolic algebra system.
- The reviewed question includes at most twenty choices, including independent sketch animation and Practice; Cloud enforces the complete 1536-token per-question input budget.
- The shape tools draw raster ink.
- The Cloud (penecho.ai) needs the same `/api/suggest` relay before hosted canvases get PenEchoLLM ranking. Local help works everywhere.

## Showing who ranked the actions, and the allowance

Assist shows local predictions at once, and PenEchoLLM re-ranks them a moment later. The bar says which of these the person is looking at. Its `data-rank` attribute has one of these values:

| `data-rank` | Meaning | Look |
| --- | --- | --- |
| `pending` | Instant local order; PenEchoLLM is on its way | Grey spark that spins, a shimmering "PenEchoLLM…" label and a scan line under the bar; no primary chip |
| `ranked` | PenEchoLLM ordered the chips | An accent "✦ PenEchoLLM" pill and a primary chip; chips update in place, the spark pops and the bar glows once |
| `refreshing` | Ranked, and newer strokes are being analysed | Accent pill with a breathing spark |
| `local` | Local order only: suggestions off, PenEchoLLM unavailable, allowance used, or no answer | A plain spark |

**Compact by default.** In the bar the status is a single spark (about 26 px wide). Its colour and motion carry the state. The full words "PenEchoLLM" and the allowance slide out on hover, on keyboard focus or while the detail row is open, without shrinking under pressure from neighbouring buttons. Ranking completion highlights the spark and chips but keeps the words hidden until interaction. Suggested actions update directly in the bar without moving from their previous screen positions or dropping in from above. A low or used-up allowance adds a small amber dot to the spark. On touch devices, tapping the spark opens the detail row.

**The allowance next to the pill.** Beside the pill the bar shows only what needs attention:

- "9 left" in amber when the guest or free allowance is at or below max(10, 10 %) of the daily limit;
- "0.1 credit" while continuing on credits;
- "limit reached" when the allowance is used up.

Subscribers see no count.

**The detail row.** Tapping the pill opens a row with:

- how the order was produced, the latency, and whether the analysis was charged or served from cache;
- the tier line: guest trial "N of 200 left", free account "N of 500 left", credit continuation "0.1 each · spent/limit", or "Unlimited with your subscription";
- the reset time;
- the next step for the tier: Sign in, Spending settings, or Plans & credits.

**Other places.** The same badge appears in the Widget Refine panel ("PenEchoLLM is ranking…" / "Ranked by PenEchoLLM"). Widget header chips ranked by PenEchoLLM carry a small ✦ and glow once when their order changes. Settings shows the allowance line under Automatic suggestions for every tier. The blocked notice uses the real limits and reset time from Cloud's `access`.

Tests are in `test/penecho-llm-status.test.js`. Cloud sends `access` as `{signedIn, subscribed, freeLimit, used, remaining, price, paidEnabled, dailyCreditLimit, spentToday, resetsAt, reason}`, plus `chargedCredits` and `cached` on each analysis.

### Cancellation recognition and performance

Straight marks must cross the interior of older ink, with ink on both sides of the mark; mere proximity is insufficient. The detector rejects oversized dividers, limits completion to overlapping parts of the same glyph, accepts sparse fast strokes and reversed/slanted marks, and keeps the 700 ms separation from fresh writing. A lone straight crossbar needs model confirmation.

Ordinary strokes fail a cheap shape gate. Geometry uses at most 96 samples per polyline and the existing 64-stroke cache. Saved raster ink is checked only after 400 ms of quiet, using an idle callback, the pre-mark history snapshot, and at most 32,768 pixels / 36 tiles. Connected components must actually intersect the mark; two separate components above and below are not evidence of deletion. No pixel scan runs on pointermove or pen-up. New input cancels the pending raster task; stale history, document changes, or an active AI edit invalidate it. Gesture screenshots emphasize only the gesture's strokes, leaving other unprocessed ink faded.
