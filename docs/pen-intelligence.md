# Pen intelligence: gestures, step checker and Canvas search

These three features read the Canvas the same way Assist does. Each one asks PenEchoLLM a closed question through `/api/suggest`. The questions belong to Cloud (`penecho-llm-actions.mjs`); the Canvas sends only `{version:1, mode, image, context}`. The pure decision logic lives in `public/pen-intel.js`, which is UMD and tested in Node. The Canvas code lives in:

- `src/client/app/pen-intelligence.js`
- `src/client/app/canvas-index.js`

| Feature | Cloud mode | Local part | Runs by itself? |
| --- | --- | --- | --- |
| Pen gestures | `gesture` `{shape}` | Shape fit proposes a command mark: enclosure, underline, double underline, strike, scribble or small axes | Only when Auto AI is off and PenEchoLLM is confident (command ≥ 0.7, gesture ≥ 0.6). Otherwise it offers a chip. **Delete is always an offer.** Without PenEchoLLM, a few clear shapes are offered and nothing runs. |
| Step checker | `step` | Candidate when ink is `math_step`, or a new line below math | **Never.** It shows a wavy underline and a "check it?" chip, and the focused check runs only on tap. |
| Canvas search | `index` (Scan, and the sketch query) | Labels from Assist, objects, sketch signature, ranking | Scan runs only when asked, in the background, one request at a time. |

## Pen gestures

Settings → **Pen gestures** turns this on or off.

A mark is only a candidate when:

- it follows a pause (earlier content is at least 0.7 s old);
- it surrounds, underlines or strikes earlier content;
- a loop does not run through its own middle, so letters such as e, @ and spirals are ignored;
- an underline with content right below it is treated as a fraction bar.

The stroke is held for 0.9 s so that a second underline, a "?" or an arrow can join it. The command marks are lifted off the Canvas before the model runs. Everything is one Undo step.

| Mark | Command | Executor |
| --- | --- | --- |
| Circle or box (+ ?) | explain | Assist `explain` |
| Double underline | typeset | Assist `typeset` (selection normalize) |
| Underline or = after an expression | solve | Assist `solve` |
| Small L axes beside a formula | plot | Assist `plot` → interactive graph |
| Circle + arrow out, or ▷ | animate | Assist `animate` (scene or Agent) |
| Lasso around numbers or a table + arrow | chart | `requestAI("plot", …, suggestion:"chart")` |
| Strike or zigzag over content | delete | Offer only. A dashed box previews what goes. It removes the whole strokes the mark crosses, plus a limited one-step expansion to the rest of the same letters (not beyond the mark's span, not tall dividers), as one Undo step. For ink loaded without vectors, it grows from the touched pixels to the connected letters inside a small window, then deletes that box. |

While a gesture is pending, remote Assist classification waits. Local help remains available.

## Auto AI timing

Auto AI runs after the pause configured by the user. PenEchoLLM results never delay, skip or route that request. There is no Smart Auto setting.

With Auto AI enabled, recognized pen gestures offer actions for the user to tap instead of running automatically. Gesture analysis and dismissal never clear or restart the Auto AI timer. When the deadline fires, Auto AI cancels any outstanding gesture analysis and dismisses its offer. Existing explicit editing, pending draft and active-request guards still apply.

## Step checker (suggestion only)

Settings → **Step checker** turns this on or off. It works only while automatic suggestions are on.

When Assist classifies new ink as a derivation line, the same image is sent in `step` mode. A line is flagged when `step` is `doubtful` and the error probability is at least 0.55. The flag is a wavy red underline plus a chip placed beside the line, never under it, so it does not block the next line. `stepCheckerConsider` never calls the model. Tapping the chip runs the existing Assist `check_step` action.

## Canvas search

Open it from **Tools → Search canvases**, or with the configurable shortcut **Mod+Shift+K** ("Search canvas content"). The index is stored in this browser's IndexedDB (`penecho-canvas-index`), holds up to 800 entries and spans all Canvases.

Entries come from four sources:

- Assist's ink classification, at no extra cost;
- widgets, typed text and images, with no model call;
- **Scan this canvas**, which finds inked regions from the raster tiles and labels up to 24 of them in `index` mode;
- the sketch pad: the sketch is labelled in `index` mode and matched by kind, by subject and by a 12×12 ink-density signature.

A text query matches kind names and synonyms in English and Chinese, subjects, titles and text. Opening a result switches to that Canvas: an open one is shown, and a saved one is loaded through `requestCanvasTransition`. The view then frames the region and highlights it.

## Cost and limits

Cloud allows two concurrent analyses per account and 40 per minute. These features wait for a free slot, and background scanning waits until nothing else is running. Identical images are cached by Cloud and not charged again.

## Testing

- **Canvas unit tests:** `test/pen-intelligence.test.js`. The local mock (`PENECHO_JEVISION_MOCK=auto`) answers every mode; `PENECHO_JEVISION_MOCK_<MODE>` forces a choice.
- **Cloud contract tests:** `test/penecho-llm-access.test.mjs` in penecho_cloud.
