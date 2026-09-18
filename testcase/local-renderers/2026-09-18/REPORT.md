# Visual authoring / local rendering acceptance — 2026-09-18

Source: `/Users/heack/workspace/penecho_071_version`, branch `codex/update-localization`.
Runtime: existing user-started `node cli.js --port 3921 --uat`; selected instance `4f97dde8-4842-420d-871e-d2905d2c1c27` and opted-in browser `c8b49c3c-b5dc-450d-a9c8-8d9f79e5e7cc`.
No server restart, deployment, push or commit was performed. This acceptance work adds fixtures and evidence only; it does not change product prompts or renderers.

## What the current guidance means

- `visual-explorer` selects explanation/comprehension-oriented composition: hierarchy, diagram/table choice, evidence and detail. Current selection text includes architecture and sequence explanations.
- `general-html` selects real product pages, ordinary HTML tools and interaction-first experiences. Existing edits preserve the current source/style; bare function graphs use the native plot route.
- `architecture` and `sequence` are independently fetched regional contracts and deterministic browser renderers, not alternative page composition modes. They may coexist with ordinary HTML in one Widget.
- `math-2d`, `physics-2d`, `math-3d` are subject/runtime authoring supplements. Their presence in the same guidance ID list does not make every ID an equivalent semantic-JSON renderer.
- Guidance documents are lazy-loaded by ID. Architecture/sequence runtime bundles are injected only for their respective source markers. The three tests in `test/mcp-scoped-guidance.test.js` passed during this audit.

The current flat guidance catalog mixes composition, subject supplements and specialized diagram contracts. A clearer future dispatcher can categorize these responsibilities without merging their bodies or adding them to every prompt.

## Browser results

| Type | Source / engine | Result and evidence |
| --- | --- | --- |
| DOT | DOT / production Graphviz adapter | Rendered 5 nodes, grouped service boundary, branch and labeled edges. `dot.webp`; actual browser screenshot inspected. |
| BPMN | BPMN 2 XML with DI / production bpmn-js adapter | Start, task, exclusive gateway, two branches and end rendered. `bpmn-xml.webp`. XML contains authored diagram geometry; this adapter does not infer it from semantic-only BPMN. |
| Vega-Lite | JSON / production Vega adapter | Initial unspecified dimensions produced a narrow chart; preserved in `vega-lite.initial.*` and `vega-lite.webp`. Explicit container width/height, fit autosize and horizontal category labels render correctly. Final source and screenshot: `vega-lite-responsive.*`. Data is synthetic. |
| GeoJSON | WGS84 GeoJSON / production Leaflet adapter | Polygon, 3 points and connecting route rendered with zoom controls. `geojson.browser.png`, `geojson.webp`. Explicit `basemap:none`; online tiles/provider fallback were not tested. |
| SMILES | SMILES string / production SmilesDrawer | Ring, bonds and expanded oxygen/hydroxyl groups rendered. `smiles.browser.png`, `smiles.webp`. |
| Cytoscape | Elements JSON / production Cytoscape adapter | 6 nodes and 6 labeled directed edges rendered. `cytoscape-json.browser.png`, `cytoscape-json.webp`. Uses existing force-directed layout and default styling; this is a rendering check, not an architecture-style presentation quality certification. |
| Architecture | `architecture` MCP field, architecture/1 JSON / bundled engine | Typed MCP inspection succeeded and returned actual pixels. `architecture.typed.json`, `architecture.typed.webp`. Also rendered in the mixed Widget. |
| Sequence | `sequence` MCP field, sequence/1 JSON / bundled engine | Typed MCP inspection succeeded; 3 lifelines, 4 messages, return arrows, activation and transparent dashed opt frame rendered. `sequence.typed.*`. Also rendered in the mixed Widget. |

For the six existing professional formats, fixtures call the **actual** `public/plugins/flowchart/runtime.js` `documentFor()` function. Its generated HTML is delivered through the public MCP HTML Widget route. These are live browser engine tests, not hand-drawn substitutes. They do **not** establish that public MCP has a native `diagram_source` creation field; it currently does not. The built-in Agent professional-diagram contract is edit-only, while the main Canvas plugin has its own `diagram_source` route.

All six adapters compute/draw in the browser, but currently obtain selected dependencies from jsDelivr. Browser-local rendering is not an offline guarantee. The architecture and sequence runtimes are served from the project.

## Seven new canvases retained

1. 本地渲染验收 · DOT 结构图
2. 本地渲染验收 · BPMN 业务流程
3. 本地渲染验收 · Vega-Lite 数据图
4. 本地渲染验收 · GeoJSON 地理数据
5. 本地渲染验收 · SMILES 分子结构
6. 本地渲染验收 · Cytoscape 关系网络
7. 展示规则与本地渲染 · 共存验收

Exact session/document mappings are saved in the corresponding `*.session.json`. Historical user canvases were not deleted or replaced. The Vega fixture was refined in its own newly created artifact; initial source and pixels remain in this directory.

## Mixed-content acceptance

`composition.html` contains ordinary explanatory HTML, one architecture JSON source block and one sequence JSON source block. It contains no authored diagram SVG, diagram coordinates or nested iframe. Widget Host provides its existing sandbox and independently loads both renderers. The live DOM exposed both completed SVG diagrams; `composition.inspect.webp` is a real PenEcho full-height inspection capture at 1280 × 1500 CSS pixels. The delivered Widget is 1280 × 900 and scrolls vertically.

`composition.virtual-files.json` confirms the browser's actual virtual files:

```
objects/widget-1/widget.html   # HTML + both semantic JSON blocks
objects/widget-1/widget.json   # Widget metadata
objects/widget-1/geometry.json # Canvas geometry
```

These are Canvas virtual resources, not matching physical project paths. The model need not output generated SVG or renderer scripts. Existing native Professional Diagram source widgets instead use `widget.source` for their notation.

## Reproduction

The helper selects only the explicitly authorized existing 071 / 3921 instance; it does not start a service. The authentication record is consumed in memory by the repository's own `bridgeRequest` helper and is never saved in these fixtures.

`fixtures.cjs` generates the six source/HTML fixtures using the production renderer. `publish.cjs <format>` addresses only this audit's stable session/artifact. `publish-composition.cjs` generates and publishes the mixed-content case. `inspect.cjs <session-format> <html-basename> [height] [width]` captures an ephemeral native inspection without changing the viewed Canvas. Use a new requestId for changed presentation arguments; retain the audit's existing artifact IDs when refining.

Verification scope: successful browser rendering of the supplied fixtures and native typed inputs, not exhaustive renderer conformance, offline availability, export formats or all responsive edge cases.
