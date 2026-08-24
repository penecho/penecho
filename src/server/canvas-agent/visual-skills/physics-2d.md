# physics-2d scientific Visual Explorer

## Role and boundary

Use this skill for an explanation-first 2-D physics visualization: system boundaries, free-body diagrams, force/velocity/acceleration vectors, trajectories, collisions, energy and momentum states, fields, or before/after comparisons. The Widget visualizes supplied or deterministically derived physics; it is not a physics solver, experiment, sensor, symbolic mechanics engine, or claim that the modeled system is physically complete.

Derive numerical states before authoring when possible. If values or interactions are assumed, label them as assumptions. Never hide a neglected force, idealization, frame, dimensionality, or conservation condition behind polished motion.

## Physical evidence and calibration

Record the model boundary, coordinate frame, sign conventions, dimensions, constants, units, initial/final times, and material assumptions before styling. Show formulas and at least one worked substitution for load-bearing values. Use deterministic calculations and fixed rounding; never sample randomly.

For every diagram or graph:

- Use calibrated axes with units, tick spacing, and an explicit data-to-SVG mapping.
- Keep vectors attached to the represented body or path point, with lengths controlled by one declared scale.
- Show vector components when they matter, and state whether an arrow depicts force, velocity, acceleration, momentum, field direction, or another quantity.
- Distinguish measured, calculated, assumed, and normalized values by label or legend.

For system boundaries and free-body states:

- Draw the selected system boundary and identify what is included and excluded.
- Separate external and internal interactions. Only external interactions belong on that system's free-body diagram.
- Show action/reaction pairs on separate bodies when relevant; do not cancel them within one system.
- Label dimensions, contact idealizations, constraints, equilibrium or acceleration condition, and uncertainty.

For trajectories and before/after states:

- Show initial and final state vectors, positions, energies, momenta, masses, and times in one comparable calibrated frame.
- Expose the equations of motion or conservation statement, assumptions under which it applies, and the arithmetic path.
- Mark losses, external impulses, nonconservative work, changed reference frames, and discarded dimensions.
- Use one time and length scale; do not silently stretch velocity or space.

For conservation and vector fields:

- State whether mass, momentum, energy, charge, or another quantity is conserved, and identify the system and interval.
- Show before/after totals with units and residuals rather than only a qualitative claim.
- For a field, state the formula, grid, sample scale, arrow normalization, singularities, and units; provide a scale legend and one worked component evaluation.

## Explanation and motion design

Begin with the settled final comparison: boundary, key vectors, trajectory, before/after values, assumptions, and conclusion. Motion may then explain causality: draw the system boundary, apply external vectors, advance a trajectory, or move from before to after while totals update. A collision, constraint, or sign change should occur at a visible state boundary, not as an unexplained cut.

Avoid endless motion. One physical narrative should end in a stable canonical comparison suitable for reading and capture.

## Source and enhancement contract

1. Author one complete responsive HTML/CSS/inline-SVG document. The static first render must fully explain the model without interaction or script execution.
2. Show assumptions and load-bearing numerical derivations visibly; use semantic HTML and tables rather than burying them only in code.
3. Default to Manim-Web as the primary explanatory rendering/motion language whenever it can present the request at least as clearly as a static alternative. Use an inline `<script type="module">` and import exactly `https://cdn.jsdelivr.net/npm/manim-web@0.3.24/dist/manim-web.browser.js`; never use `<script src>`, `@latest`, an alternate CDN, or a second version. Fall back to static HTML/SVG or another supported renderer only when Manim-Web cannot faithfully, legibly, accessibly, or efficiently improve the requested presentation.
   The packaged surface is limited to the verified Scene/NumberPlane/vector/geometry/animation APIs in this contract. Do not use `Tex`, `MathTex`, GIF/video export, audio, or runtime-fetched assets; keep formulas and exact evidence in static HTML/SVG.
4. Before enhancement, define initial, event, and final states. Run one automatic sequence, then settle permanently at the canonical final state.
5. Provide replay and pause controls. With `prefers-reduced-motion: reduce`, skip the automatic transition and render the canonical final state immediately.
6. Keep one canonical snapshot state: boundary, vectors, trajectory, state values, assumptions, axes, units, and final arrangement must be reproducible without replay history. No transient arrow, pending force, or mid-flight value may remain.
7. Call `window.penechoWidgetReady()` after the stable first/final render when that function is available.

## Verified Manim-Web 0.3.24 vector-field pattern

Keep the static system boundary, free-body diagram, state table, and assumptions as native HTML/SVG for the mandatory deterministic first render and fallback. By default, use the Manim layer as the explanatory rendering/motion language when it is at least as clear; adapt these verified JavaScript signatures inside the inline module. Do not use Python Manim syntax or TypeScript annotations:

```js
try {
  const { Scene, NumberPlane, ArrowVectorField } = await import("https://cdn.jsdelivr.net/npm/manim-web@0.3.24/dist/manim-web.browser.js");
  const layer = document.querySelector("[data-manim-layer]");
  const box = layer.getBoundingClientRect();
  const scene = new Scene(layer, {
    width: Math.max(320, Math.round(box.width)),
    height: Math.max(240, Math.round(box.height)),
    backgroundOpacity: 0,
  });
  const plane = new NumberPlane({ xRange:[-4, 4, 1], yRange:[-3, 3, 1] });
  const field = new ArrowVectorField({
    func:(x, y) => [-y, x],
    xRange:[-4, 4, 1],
    yRange:[-3, 3, 1],
    lengthScale:0.35,
    maxArrowLength:0.55,
    normalizeArrows:false,
  });
  scene.add(plane, field);
} catch (error) {
  console.error("Scientific enhancement failed; static SVG retained", error);
} finally {
  window.penechoWidgetReady?.();
}
```

The `func`, sampling grid, normalization flag, and arrow cap are scientific inputs and must also appear in the visible legend. For free-body motion, use `Arrow({start,end})` attached to the body and keep one declared pixels-or-scene-units-per-physical-unit scale.

Accessibility requires a descriptive SVG title, text alternatives for states and vectors, keyboard-operable controls, visible focus, contrast, and an exact state table when precision matters.

The source must contain exactly one capability marker, with this exact capitalization and spelling:

```html
<meta name="penecho-visual-skill" content="physics-2d">
```

Do not add another visual-skill marker. The server rejects manim-web imports without this marker and rejects any manim-web import other than the exact pinned URL above.
