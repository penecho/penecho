# Architecture width adaptation — 2026-09-18

Source: `/Users/heack/workspace/penecho_071_version`, branch
`codex/update-localization`, working changes after `baseline1` (`816ff07c`).
The baseline tag and prior experiment files were not replaced. This experiment
does not represent a Cloud sync, release, or deployment.

## Reproduce

From the repository root, run the existing static preview server:

```sh
node testcase/archify-local/2026-09-18/preview-server.cjs
```

Open `http://127.0.0.1:8767/testcase/archify-responsive/2026-09-18/index.html`.
The page loads the real `public/widget-host.html`, with its normal sandbox and
generated architecture runtime. It is not a replacement renderer. Stop the test
server when finished. `?plain=1` loads an ordinary HTML Widget.

## Browser observations

| Container width | Layout width bucket | SVG viewBox | Selected layout |
|---|---|---|---|
| 2200 px | 2128 px | 2030 × 465 | right |
| 1000 px | 928 px | 764 × 1226 | down |
| 640 px | 560 px | 460 × 1846 | compact |

The graph preserves all 13 nodes and 12 edges of `mcp.semantic.json`. The model
input is identical at every width. Map scrollWidth equals clientWidth at the
tested sizes. Local Worker plus DOM render was approximately 0.3–0.4 seconds per
uncached reflow in Edge on this machine. These are single-run observations.

- CSS canvas scale simulation and height-only resize did not increment layoutCount.
- Keyboard-opened RPC node details and selection survived width reflow.
- Changing width and immediately requesting a snapshot succeeded (1000×2300).
- Downloaded SVG has viewBox 764×1226; PNG is 1528×2452. Both contain the current
  narrow layout, not the original wide graph.
- The plain HTML control has zero architecture roots and zero architecture
  script elements; its normal header/footer still render.
- The reviewed model graph's long Chinese text, nested groups and return edges
  were visually inspected at narrow width and native 200% browser zoom. Zoom was
  restored to 100% afterward.
- `wide-widget.png` and `narrow-widget.png` retain the mixed-document browser
  captures. `narrow-export.svg` / `.png` are the actual downloaded map exports.
- `model-graph-zoom200.png` records the model-authored fixture at 200% zoom.

## Automated validation

`node --test test/architecture-runtime.test.js test/architecture-reflow.test.js
test/widget-host-presentation-size.test.js` passes 24 tests.
`npm run check` passes all 2,008 tests, including generated asset consistency.
The new cases cover semantic preservation, three compound fixtures, wrapped long
chains, impossible-width fallback, resize coalescing, stale work cancellation,
layout cache, serialization and fit-content ownership.

Impeccable's detector identified the existing colored top border on rounded detail
cards; it is retained because it maps details to their graph domain and changing
that established styling is outside this width-layout refinement.

Extremely narrow or dense graphs may still need local horizontal scrolling. The
renderer does not promise that every arbitrary topology can fit every width.
