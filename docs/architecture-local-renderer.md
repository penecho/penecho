# Architecture JSON and local rendering

Architecture diagrams use a semantic `architecture/1` object. The model chooses
entities, ownership, boundaries, relationships and explanatory text. It does not
write node coordinates, routing points, SVG, CSS or a viewer. This integration is
scoped to architecture; other Visual Explorer rules and professional formats keep
their existing paths.

## Delivery and editable source

`penecho_present_widget` accepts exactly one of `html` and `architecture`.
The latter requires `version:1`, `title`, `nodes` and `edges`; the lazy
`architecture` guidance documents optional domains, groups, details and notes.
`src/architecture/schema.js` checks references, nesting, types and bounded sizes.
It converts the semantic object into a small HTML envelope. It does **not** load
ELK or run layout on the server.

The envelope is persisted as the existing virtual
`objects/<objectId>/widget.html`. Its `application/json` script marked
`data-architecture-source` is the editable canonical source; it is not a physical
file on the model's computer. Existing version/hash/idempotency and `read_file` /
`patch_file` operations continue to apply. Adding/removing nodes and incident
edges causes local layout on the next Widget document load.

Mixed content uses the same Widget document:

```html
<h1>Report</h1>
<p>Ordinary explanatory content.</p>
<section data-penecho-architecture>
  <script type="application/json" data-architecture-source>
    {"version":1,"title":"Request","nodes":[{"id":"a","label":"Client"},{"id":"b","label":"API"}],"edges":[{"from":"a","to":"b"}]}
  </script>
</section>
<footer>Ordinary report notes.</footer>
```

Escape `<` inside JSON strings as `\u003c`. The graph does not add another iframe
inside the existing Widget sandbox. Several marked architecture sections can be
rendered serially in one document. Ordinary HTML contains no architecture marker
and therefore receives no architecture scripts or additional download permission.

## Minimal renderer composition

- Archify 2.17: adapted SVG/geometry helpers, semantic sigils, rounded orthogonal
  path painting and frame/routes/nodes/labels layering. License/source hashes are
  retained under `src/architecture/vendor/archify/`.
- ELK/elkjs 0.12.0: automatic placement of entities and compound boundaries, edge
  labels and orthogonal routing. This is an addition: Archify's original grid
  renderer expects authored placement and is not an automatic layout engine.
- PenEcho: the semantic contract, light domain palette, matching detail cards,
  floating node inspector, keyboard activation and SVG/PNG export.

This is **not the complete upstream Archify renderer or Viewer**. Its CLI, complete
IR validators, brand registry, recording/animation and other chart formats are
not imported. Direct node drag editing and a comprehensive visual editor are not
part of this increment; semantic edits use the existing virtual source mechanism.

`npm run build:architecture` produces the runtime, worker source asset and license
file under `public/vendor/`. `npm run check:architecture` verifies generated files.
Both are part of the normal package build/check flow. ELK and esbuild are build/test development dependencies; production uses the generated assets. The ordinary server serves
the two same-origin assets, with a one-day cache. Runtime changes require a cache
version bump in `public/widget-host.js`; Worker changes require its version bump.

The Widget host loads these assets only for the explicit marker. The worker asset
is a quoted source string loaded via a trusted local script, because opaque iframe
origins cannot reliably `importScripts` from an HTTP loopback origin. ELK executes
in a Blob Worker, not on the UI thread. Workers have a 12-second deadline and are
terminated on completion/error/page exit. Layout is not repeated on canvas pan or
zoom. Text is measured in the browser; placement stays outside the model.

The longest call/data path receives direction/straightness priority. Return and
optional edges cannot override the main path merely because they form a cycle.
Actual geometry is checked for diagonal segments, entity overlap, edge/entity
intersection, label collision and routes through boundary titles. A detected
failure is visible; the capture readiness barrier waits for layout success/error
rather than capturing an unfinished placeholder. There is no guarantee that every
arbitrary dense topology will be readable; split genuinely separate subjects into
views rather than shrinking labels indefinitely. Narrow widgets scroll the map
instead of reducing text below the local minimum scale.

## Lazy prompting

The full semantic contract remains in
`src/server/canvas-agent/visual-rules/architecture.md` (3,702 characters in this
iteration). The general Visual Explorer contract is unchanged. Its catalog links
to the architecture rule; no layout algorithms or renderer code enter the prompt.
The MCP tool schema adds only the small optional `architecture` field and the
mutual-exclusion constraint. The same server schema is used by Agent tools.

A new MCP server must be released with the matching Widget host and assets. Old
HTML widgets continue working. An old client cannot render the new semantic
marker merely because its server accepts JSON. Deploy Canvas source and any Cloud
copy through the official synchronized release process; do not ship this server
schema/rule separately from the browser runtime.

## Actual acceptance, 2026-09-18

This accepted implementation is the `baseline1` reference. The Git tag records
the complete working version, including the existing desktop localization, MCP
logging, professional diagram changes, plugin packaging and historical test
artifacts. It is a local source baseline; it does not represent a pushed release
or a deployment. Later renderer comparisons should retain these fixtures and
captures as the reference rather than overwrite them.

Reproducible input, raw model output, layout iterations and captures live in
`testcase/archify-local/2026-09-18/`. Historical artifacts were retained.

- Reference fixture: 13 entities, 12 edges, Node/browser boundaries, independent
  guidance/binding branches, optional Agent and browser-owned storage. No authored
  coordinates. It is a curated semantic fixture derived from the agreed reference,
  not a claim that a fresh model independently authored it.
- Real `glm-5.3-flash` calls use the previously gathered MCP facts. The default
  reasoning request took 227.25 seconds and 11,181 output tokens. With this test's
  `thinking:{type:"disabled"}` setting, the initial JSON took 32.94 seconds and
  1,808 output tokens. A factual review/correction took another 39.56 seconds and
  2,678 output tokens. All raw requests/responses/usage are retained without keys
  or reasoning text. The speed difference is not attributed solely to JSON: the
  reasoning setting changed. Application-wide model settings were not changed.
- Fast raw JSON confused the optional Cloud bridge's ownership/path and a return
  direction. The reviewed JSON corrects those facts. Rendering cannot repair an
  incorrect semantic graph; the model remains responsible for facts/abstraction.
- The actual 071 application was started on loopback port 8771 with isolated
  state/registry. The repository MCP bridge sent `architecture` (no authored HTML)
  through `present_widget`. Reference creation took 36 ms, and first artifact
  capture including browser readiness took 768 ms. A model-authored graph creation
  took 49 ms and capture 810 ms. These are local single-run measurements, not an SLA.
- Earlier cold browser Worker measurements were 231 ms for layout / 243 ms until
  render; document readiness was 490 ms. Normal Node test layout is about 20–60 ms.
  Browser Worker startup, font measurement and capture account for additional time.
- Node click/keyboard inspector was checked in the actual Widget sandbox. SVG and
  PNG exports downloaded successfully; exported PNG was 4096×863. Only the main
  SVG is exported, not surrounding report content. Exports are bounded to 4096 px
  per edge and 12 megapixels.
- The user's existing connected Canvas receives locally compiled compatibility
  previews, because its installed desktop/Cloud host is still the old version.
  The real JSON/Worker integration is separately verified in the 071 local app.
  Preview source and semantic source are retained; these two test paths must not
  be represented as a deployed update.

Current assets: runtime 30,062 bytes (12,347 gzip); Worker source asset 1,603,643
bytes (467,489 gzip). About 480 KB gzip is a compression measurement, **not a claim
that the local server currently compresses this response**. Local raw transfer is
about 1.63 MB on a cold architecture load and is cached afterward. The main weight
is ELK, not the retained Archify helpers. Ordinary widgets load none of these bytes.

Final checks: `npm run check` passed all 2,002 tests. The actual mixed-document sandbox showed its ordinary header and footer with the graph in the same iframe (298 ms local render, 678 ms document-ready). A plain HTML Widget had zero architecture script elements and remained functional.
