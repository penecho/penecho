# three.js for authored Widgets

Create visual draws 3D subjects as General HTML widgets built with three.js. The model writes the
pinned jsDelivr URLs, so "Copy HTML" stays a standalone page. Inside PenEcho, the Widget host points
those URLs at the same files served by the current PenEcho server. Widgets therefore work offline on
the desktop and never depend on jsDelivr.

## How it works

- **Files.** `public/vendor/three-0.184.0/` holds four files from `three@0.184.0`, unmodified:
  - `build/three.core.min.js`
  - `build/three.module.min.js`
  - `examples/jsm/controls/OrbitControls.js`
  - `examples/jsm/renderers/CSS2DRenderer.js`

  It also holds the MIT `LICENSE`, `README.md` and `SOURCES.sha256`. `npm run build:visual-explainer-vendor`
  copies them from `node_modules` and `--check` keeps them in sync.
- **Local server.** It serves the files at `/widget-vendor/three@0.184.0/<file>` with these headers:
  - `Cache-Control: public, max-age=31536000, immutable`
  - `Access-Control-Allow-Origin: *`
  - `Cross-Origin-Resource-Policy: cross-origin`

  Sandboxed widget frames load modules in CORS mode, which is why the last two are needed.
- **Widget host.** `public/widget-host.js` acts only when the widget HTML contains
  `https://cdn.jsdelivr.net/npm/three@0.184.0/`:
  - It rewrites the widget's import map so `three` and the matching URLs of the two addons point at
    `widget-vendor/three@0.184.0/…` next to `widget-host.html`.
  - The module build loads `./three.core.min.js` relatively from the same folder.
  - Other addons under `three/addons/` stay on the CDN.
  - A widget that maps `three` to another build is left unchanged.
  - The widget's script policy allows those four URLs.
  - Saved widget HTML is never changed; only the displayed document links to the local files.
- **Prompt.** The Create visual prompt pins `three@0.184.0` (`CREATE_VISUAL_POLICY` in
  `src/server/main.js`).

Browsers do not reuse their HTTP cache inside sandboxed (opaque-origin) frames. Each three.js widget
therefore downloads about 200 KB gzipped when it is shown, the same as the existing scene libraries.
The cost is negligible from a local server. On Cloud, the immutable headers let Cloudflare serve the
repeats from its edge.

## Verification (2026-10-06)

Setup: headless Edge with `cdn.jsdelivr.net` mapped to a closed port, driven over DevTools protocol,
against an isolated test server.

- A Create visual DNA widget drew the helix with its 3′/5′, base-pair and backbone labels and legend.
- It auto-rotated, and a mouse drag rotated the model.
- No widget runtime errors.
- All four files loaded from `/widget-vendor/three@0.184.0/`.
- Three widgets on one page downloaded each file three times, as expected for sandboxed frames.

Tests: `test/widget-three-vendor.test.js`.

## Cloud release (penecho_cloud)

Cloud synchronizes the seven files below through `tools/sync-public-canvas.mjs`. Its
`src/routes/plugins.mjs` exposes exactly the four JavaScript files with immutable cross-origin
headers, and NOTICE retains the upstream license. Ship these together with the synced
`widget-host.js`; the route regression test is `test/plugins-route.test.mjs`.

1. **Sync the files.** Add them to the file list in `tools/sync-public-canvas.mjs`:

   ```
   vendor/three-0.184.0/build/three.core.min.js
   vendor/three-0.184.0/build/three.module.min.js
   vendor/three-0.184.0/examples/jsm/controls/OrbitControls.js
   vendor/three-0.184.0/examples/jsm/renderers/CSS2DRenderer.js
   vendor/three-0.184.0/LICENSE
   vendor/three-0.184.0/README.md
   vendor/three-0.184.0/SOURCES.sha256
   ```

2. **Add the route.** In `src/routes/plugins.mjs`, serve
   `/canvas/widget-vendor/three@0.184.0/<file>` from `public/canvas/vendor/three-0.184.0/<file>` for
   exactly the four JavaScript files. Use these headers:
   - `Content-Type: application/javascript; charset=utf-8`
   - `Cache-Control: public, max-age=31536000, immutable`
   - `CDN-Cache-Control: public, max-age=31536000, immutable`
   - `Access-Control-Allow-Origin: *`
   - `Cross-Origin-Resource-Policy: cross-origin`

   `sendCrossOriginCanvasScript` uses a one-day cache, so it needs an immutable variant. Keep
   `rateLimit:false` and `authContext:false` like the other canvas assets. Return 404 for any other
   path under the prefix.
3. **Update NOTICE.** Add the three.js entry, as in this repository's NOTICE.
4. **Check before release** with `tools/verify-three-widget-vendor.mjs` in Cloud:
   - On UAT, open a Canvas with a three.js widget while jsDelivr is blocked. It must draw, rotate and
     show labels.
   - The four files must return the headers above.
   - A repeated request must be a Cloudflare cache hit (`cf-cache-status: HIT`).
