# Example canvases

New users learn PenEcho by trying it. Each example opens a canvas with
handwritten ink (or a photo) already on it, highlights the one suggestion to
tap or fills the Agent composer, and explains the result in a sentence. The
canvas is the user's own: they can keep, edit or close it.

Examples are grouped into four categories. Each example belongs to exactly one
(`category`), and a category only ever shows its own examples.

**Studying** (children to university)

| Example | Ink on the canvas | Action | Route |
| --- | --- | --- | --- |
| Graph a function | `f(x) = a·sin x` | Plot graph | Instant: the known graph, no model call |
| Check a child's homework | Three sums, `12 - 7 = 6` wrong | Check (`check_step`) | Canvas AI |
| See it in 3D | `z = sin x · cos y` | Plot graph | Instant: a 3D surface |
| Check a proof step by step | (a+b)² expansion that drops 2ab | Check (`check_step`) | Canvas AI |
| Photo to study notes (featured) | A lecture blackboard photo | Organize as Note | Canvas AI |
| Keep what matters | The chain rule | Organize as Note (knowledge card) | Canvas AI |
| Understand a topic | Transformer notes with question marks | Agent: one visual explanation | Agent |

**Coding**

| Example | Ink on the canvas | Action | Route |
| --- | --- | --- | --- |
| Sketch to diagram | Browser, API, Postgres, Cache boxes | Make diagram | Instant: local architecture diagram |
| Find the bug in a screenshot | An editor screenshot of `average()` with `i <= scores.length` | Check (`check_step`): the fix is written beside the bug | Canvas AI |
| Diagrams with PenEcho Agent | Notes for a login system | Agent: architecture, sequence and workflow, at most 4 boxes each | Agent |
| Wireframe to working prototype | A focus-timer wireframe | Agent: a working timer widget | Agent |

**Working**

| Example | Ink on the canvas | Action | Route |
| --- | --- | --- | --- |
| Show a class in 3D | A water molecule sketch | Agent: a 3D H2O model to rotate | Agent |
| Explain to a patient in 3D | A heart with its four chambers | Agent: a 3D heart to rotate | Agent |
| Meeting notes to a work note | Team sync to-dos | Organize as Note (work note) | Canvas AI |
| From an idea to the next step | Launch to-dos and an open decision | Agent: a plan view | Agent |
| Numbers to a chart | Quarterly sales | Agent: a bar chart and the trend | Agent |

**Playing**

| Example | Ink on the canvas | Action | Route |
| --- | --- | --- | --- |
| Doodle to illustration | A rocket doodle | Storybook / 3D illustration (`vivid`) | Canvas AI |
| Bring a sketch to life | A bird with speed lines | Animate sketch | Canvas AI |
| Draw cleaner, finish faster | Half a cat | Finish drawing (tip: hold to snap) | Canvas AI |
| Sketch a game, then play it | A tic-tac-toe grid | Agent: a playable game | Agent |

Studying and Coding each open with an instant example, so a new user sees a
result before any model is set up.

## Where people find them

- **Empty canvas.** The welcome leads with a category picker (Studying, Coding,
  Working, Playing). With no category chosen it shows one lead example from
  each; with a category, only that category's examples: the first for it,
  then (in Studying) the featured photo example (always, marked "Tried" once used), then the
  rest, with untried examples first (`EXAMPLES.welcome`). If a host does not
  serve the photo, its card hides itself. The three start actions stay below as a compact row.
- **Examples dialog.** All examples with progress, from the welcome's
  "All examples", the title bar ⋯ menu, the Studio navigator footer, and the
  coachmark.
- `window.PenEchoExamples.open(id)` and `.openDialog()` for other entry points.

## How an example runs

1. An empty, unsaved canvas is reused; otherwise a new canvas opens through the
   normal transition (the current one stays in the workspace). It is named
   "Example · <title>".
2. `drawExampleInk` paints the strokes as user ink in **one** history entry and
   records each as a Suggest stroke (`exact:true`), so Undo removes the example
   and Finish drawing / Animate sketch receive real vectors. Drawn ink never
   goes through delete or gesture detection.
3. `exampleCanvasesAssistView` (called from `assistView`) puts the example's
   action first and marks the view confident, so the chip is highlighted. It
   only applies to the example's own canvas while the example is waiting.
4. A non-modal coachmark (`#exampleCoach`) points at the chip, positioned with
   `TOUR.placeCoachmark`. It hides while the feature tour or the dialog is open.
5. `exampleCanvasesActionStarted` (called from `executeAssistAction`) records
   the try. For the instant examples it inserts the known result (a graph, or
   for Diagrams the `architecture` object rendered by the local architecture
   renderer) and consumes the ink; otherwise the normal executor runs and the result bar appears once the
   canvas changes and nothing is still running. Example taps are excluded from
   the instant-order prior (`target.example`).
6. When the result lands the canvas switches to Hand, so the new graph, card or
   widget responds to the pointer straight away (in Pen a press on a Widget draws).
7. The result bar (`#exampleDone`) shows what was learned, the next untried
   example and "Start my own canvas".

Examples that need a model (Canvas AI or Agent) check for one first. Without
a connection the coachmark says so and offers **Set up AI**, and tapping the
step (or sending the Agent prompt) opens Settings → AI & connections instead of
running. This matters for notes: with no model, Organize as Note falls back to
a local card that only holds the captured photo or ink, which would not show
what the feature does. Instant examples always run.

The Agent example opens the panel before laying out the ink, keeps it open
(first ink would otherwise auto-hide it), fills the composer and points the
coachmark at Send. It does not record Suggest strokes.

## Files

- `public/example-ink.js`: a small single-stroke handwriting font and an SVG
  path sampler. Deterministic (seeded), UMD, tested in Node.
- `public/example-scenarios.js`: the catalog, goal ordering and progress
  parsing. Copy is inline in English and Chinese; coachmarks quote the real
  Suggest labels (tested).
- `src/client/app/example-canvases.js`: the client module (bundled after
  `note-cards.js`).
- `public/example-canvases.css`: loaded before `studio-shell.css`.
- Tests: `test/example-scenarios.test.js`, `test/example-canvases-ui.test.js`.

Photo examples (`image` in the catalog) are fetched from `public/examples/` and
added through the normal image import (`addImageFile`), so the photo is new
input for Suggest. Example photos are re-encoded without EXIF/XMP metadata and
kept under 300 KB (tested); never add a camera original, which carries GPS.
Hosts that mirror the client file by file (PenEcho Cloud's
`tools/sync-public-canvas.mjs` allow-list) must include every file in `public/examples/` (`qed-blackboard.jpg`, `average-bug.jpg`).

Progress lives in `localStorage["penecho-examples-v1"]`:
`{schema:1, goal, goalAsked, tried:[ids]}`. Examples are hidden in
the viewer, on guest canvases and in companion mode.

Suggestions are not shown while the page is in the background, so the bar and
coachmark only appear in a visible window.
