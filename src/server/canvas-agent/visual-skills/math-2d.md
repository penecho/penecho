# math-2d scientific Visual Explorer

## Role and boundary

Use this skill for an explanation-first 2-D mathematical visualization: calibrated curves and axes, points, derivatives, extrema, curvature, equation-geometry links, proof states, transformations, or a 2-D vector field. The deliverable is a source-authored Visual Explorer that makes supplied or independently checked mathematics easier to inspect. It is not a symbolic algebra system, proof assistant, solver, or replacement for the user's authoritative calculation.

When a symbolic result is needed, derive it before authoring with deterministic arithmetic or state that the request needs an external calculation. Never present visualization code as proof of symbolic truth. Preserve the user's notation and uncertainty.

## Numerical and mathematical evidence

Before styling, record the domain, units, tick spacing, coordinate bounds, formulas, parameter values, rounding rule, special points, and assumptions. Every plotted value must come from a pure deterministic function with fixed constants. Use stable sampling, show the sample count/step, and avoid random values.

For each graph:

- Define one explicit data-to-SVG transform, including the inverse mapping, and use it for every point, gridline, label, and arrow.
- Label quantities, units, scales, origin, orientation, and any aspect distortion.
- Plot or tabulate control points needed to verify calibration; do not let decoration move a point.
- Link each curve to its formula in a visible legend or adjacent derivation panel.

For derivatives and extrema:

- Show the original function and the derivative or finite-difference definition used.
- Identify critical candidates, endpoints, domain exclusions, sign intervals, second-derivative or boundary evidence, and whether each result is exact or approximate.
- Use a linked sign table or state sequence, and mark extrema/inflection candidates with their coordinates and units.
- Explain numerical sensitivity when a root is nearly flat or the step is material.

For geometry and proofs:

- Separate **given**, **construction**, **claim**, **used**, and **derived**; the visible proof state must show which claims are unused.
- Keep congruence, orientation, angle, and length marks consistent with their labels.
- Preserve construction order and dependencies. Do not promote a diagram's appearance to an equality.
- Mark the final reached state (for example, QED or the exact proposition proved), and clearly distinguish a theorem statement from a numerical example.

For vector fields:

- State the vector formula, grid, domain, scale, normalization, arrow-length rule, and units.
- Provide a vector-scale legend and at least one worked component evaluation.
- Label divergence, curl, potential, flow direction, or singularities only after showing their formula or marking them as assumptions.
- Use uniform geometric arrow construction; do not let overlap hide direction.

## Explanation and motion design

Start with the settled final mathematical picture. Establish the coordinate system before adding curves, points, transformations, proof marks, or vector-field samples. Use Manim-style explanatory transitions that preserve coordinates: axes establish units, a curve is derived from points, a tangent follows a selected point, an area/region corresponds to its formula, or a proof mark appears only after its dependency state.

Prefer a compact overview, one focused mechanism, and a small evidence table. Animate only a causal or construction sequence; do not spin, wobble, or repeatedly replay decoration.

## Source and enhancement contract

1. Author one complete responsive HTML/CSS/inline-SVG document. The static first render must be complete, accessible, and independently understandable before any script runs.
2. Keep deterministic values in named constants or pure functions and expose the material numerical evidence in a compact visible table or accessible details region.
3. Default to Manim-Web as the primary explanatory rendering/motion language whenever it can present the request at least as clearly as a static alternative. Use an inline `<script type="module">` and import exactly `https://cdn.jsdelivr.net/npm/manim-web@0.3.24/dist/manim-web.browser.js`; never use `<script src>`, `@latest`, an alternate CDN, or a second version. Fall back to static HTML/SVG or another supported renderer only when Manim-Web cannot faithfully, legibly, accessibly, or efficiently improve the requested presentation.
   The packaged surface is limited to the verified Scene/Axes/geometry/animation APIs in this contract. Do not use `Tex`, `MathTex`, GIF/video export, audio, or runtime-fetched assets; keep formulas and exact evidence in static HTML/SVG.
4. Before enhancement, define the initial and final scene states. Run one automatic explanatory sequence, then settle permanently at the canonical final state.
5. Provide replay and pause controls. With `prefers-reduced-motion: reduce`, skip the automatic transition and render the canonical final state immediately.
6. Keep one canonical snapshot state: the same axes, formulas, points, labels, parameters, and final arrangement must be reproducible without replay history. Do not leave transient helper objects, pending transforms, or mid-transition values in the final capture.
7. Call `window.penechoWidgetReady()` after the stable first/final render when that function is available.

## Verified Manim-Web 0.3.24 pattern

The calibrated inline SVG remains the mandatory deterministic first render, readable evidence, and fallback. By default, use the Manim layer as the explanatory rendering/motion language when it is at least as clear; adapt these verified JavaScript signatures inside the inline module. Do not translate Python Manim syntax or add TypeScript annotations. Use a literal dynamic import so failure leaves the static SVG intact and can still release readiness:

```js
let scienceError = null;
try {
  const { Scene, Axes, BLUE } = await import("https://cdn.jsdelivr.net/npm/manim-web@0.3.24/dist/manim-web.browser.js");
  const layer = document.querySelector("[data-manim-layer]");
  const box = layer.getBoundingClientRect();
  const scene = new Scene(layer, {
    width: Math.max(320, Math.round(box.width)),
    height: Math.max(240, Math.round(box.height)),
    backgroundOpacity: 0,
  });
  const f = (x) => x * x - 2 * x - 1;
  const axes = new Axes({ xRange:[-4, 5, 1], yRange:[-3, 8, 1], xLength:8, yLength:5, tips:false });
  const curve = axes.plot(f, { xRange:[-4, 5], color:BLUE, numSamples:320 });
  scene.add(axes, curve);
} catch (error) {
  scienceError = error;
  console.error("Scientific enhancement failed; static SVG retained", error);
} finally {
  window.penechoWidgetReady?.();
}
```

For an extremum or derivative animation, add a `ValueTracker`, update a dot/tangent through `axes.coordsToPoint(x, f(x))`, play exactly once, remove its updater, and settle at the stated critical point before readiness. Build replay from fresh scene objects; Manim animations are stateful.

Accessibility requires a descriptive SVG title, text alternatives for every non-decorative visual state, keyboard-operable controls, visible focus, contrast, and an exact data table when graphical precision matters.

The source must contain exactly one capability marker, with this exact capitalization and spelling:

```html
<meta name="penecho-visual-skill" content="math-2d">
```

Do not add another visual-skill marker. The server rejects manim-web imports without this marker and rejects any manim-web import other than the exact pinned URL above.
