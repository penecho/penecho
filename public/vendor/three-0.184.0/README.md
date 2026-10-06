# three.js for authored Widgets

Unmodified files from the npm package `three@0.184.0` (https://github.com/mrdoob/three.js, tag `r184`),
copied by `npm run build:visual-explainer-vendor`. They keep their MIT license (`LICENSE`, NOTICE);
PenEcho's own integration stays AGPL-3.0-only.

| File | Upstream path |
| --- | --- |
| build/three.core.min.js | `build/three.core.min.js` |
| build/three.module.min.js | `build/three.module.min.js` |
| examples/jsm/controls/OrbitControls.js | `examples/jsm/controls/OrbitControls.js` |
| examples/jsm/renderers/CSS2DRenderer.js | `examples/jsm/renderers/CSS2DRenderer.js` |

General HTML widgets import these from `https://cdn.jsdelivr.net/npm/three@0.184.0/`, so copied HTML
stays standalone. Inside PenEcho the Widget host points those URLs at this folder, which the local server
(and PenEcho Cloud) serves at `/widget-vendor/three@0.184.0/`; see `docs/three-widget-vendor.md`.
SHA-256 checksums are in `SOURCES.sha256`.
