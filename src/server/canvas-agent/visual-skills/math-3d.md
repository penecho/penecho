# math-3d scientific Visual Explorer

## Role and boundary

Use this skill for an explanation-first 3-D mathematical visualization: surfaces, parameter domains, gradients, coordinate transforms, space curves, vector fields, slices, or stable spatial relationships. The Widget is a calibrated visual explanation, not a symbolic algebra system, proof assistant, numerical-analysis package, or physics solver.

Perform deterministic derivations before authoring. Clearly separate exact parameterizations from numerical approximations. If a surface equation, transform, gradient, or intersection requires computation the model cannot verify, state the required calculation and uncertainty rather than presenting a rendered shape as proof.

## Spatial evidence and calibration

Before styling, record coordinate type and units, domain bounds, sample grid, parameterization, projection, camera, clipping, normals, scale, rounding, and assumptions. Every projected point must use one documented transform.

For 3-D scenes:

- State the world-to-camera and camera-to-screen transform and preserve it across rotations or transitions.
- Label axis ranges, orientation, units, and any unequal axis scaling; never imply metric distances from an unstretched projection.
- Start from one stable canonical camera with explicit yaw/pitch/roll, field of view, target, and distance. When rotating or zooming the view materially improves spatial understanding, enable bounded user orbit controls around the declared target; otherwise keep the camera fixed. Never use idle drift or automatic wobble, and always provide a direct reset to the canonical camera.
- Keep surfaces stable by fixing the mesh domain/resolution, color scale, normal rule, clipping planes, and draw order; state whether apparent depth is shading, ordering, or true occlusion.
- Mark representative exact points, contours, slices, or parameter curves with coordinates and units.
- Link the surface equation, domain, and transform to visible legend or derivation text.

For coordinate transforms and vector fields:

- Show the source and target coordinates, Jacobian or linear map when material, basis vectors, and determinant/orientation.
- Demonstrate at least one point transform and its inverse where defined.
- For vectors, state formula, grid, units, arrow scale, normalization, and singularities; distinguish a vector at a point from a path tangent or surface normal.
- Use color only as redundant encoding, with numeric legends or labels.

Use Macro → Meso → Micro: one settled spatial overview, one focused surface/transform mechanism, then compact tables of exact points, slices, assumptions, and residuals.

## Explanation and motion design

Motion should explain a coordinate relationship or construction. Preferred Manim-style transitions are a basis change under a declared transform, a surface swept only within its declared domain, a slice or contour moved through fixed camera coordinates, or a gradient/vector attached to points while scales remain constant.

Do not use uncontrolled automatic rotation as content. Establish the stable camera first, transition once to a clearer explanatory orientation, and settle. The final view must preserve calibration and be readable without replay. If manual camera exploration helps, keep it available after the scene settles and show concise visible instructions for pointer/touch rotation, zoom, keyboard access, and resetting the view; never make users guess that the scene is interactive.

## Source and enhancement contract

1. Author one complete responsive HTML/CSS/inline-SVG document. The static first render must show the canonical 3-D state, axis calibration, key equation, assumptions, and accessible data table before any script runs.
2. Keep numerical data deterministic and bounded. Fix camera and mesh parameters in named constants or pure functions.
3. Default to Manim-Web as the primary explanatory rendering/motion language whenever it can present the request at least as clearly as a static alternative. Use an inline `<script type="module">` and import exactly `https://cdn.jsdelivr.net/npm/manim-web@0.3.24/dist/manim-web.browser.js`; never use `<script src>`, `@latest`, an alternate CDN, or a second version. Fall back to static HTML/SVG or another supported renderer only when Manim-Web cannot faithfully, legibly, accessibly, or efficiently improve the requested presentation.
   The packaged surface is limited to the verified ThreeDScene/ThreeDAxes/Surface3D/camera APIs in this contract. Do not use `Tex`, `MathTex`, GIF/video export, audio, or runtime-fetched assets; keep formulas and exact evidence in static HTML/SVG.
4. Define the initial and final camera/scene states before enhancement. Run one automatic explanatory sequence, then settle permanently at the canonical final state.
5. Provide replay and pause controls for automatic motion. For an inspectable 3-D scene, explicitly enable bounded orbit controls, keep panning off unless it has a declared explanatory purpose, clamp zoom and polar angles, and provide a visible keyboard-operable **Reset view** action plus visible usage text such as “Drag to rotate · Wheel or pinch to zoom · Shift+Arrow keys to rotate · Reset view.” With `prefers-reduced-motion: reduce`, skip automatic transitions but keep useful manual camera controls available.
6. Keep one canonical snapshot state: camera, coordinate transform, surface parameters, mesh, colors, labels, and final arrangement must be reproducible without replay history. Reset the camera to that state before capture and restore the user's prior bounded view afterward. No transient basis, pending slice, or mid-transition camera may remain.
7. Call `window.penechoWidgetReady()` after the stable first/final render when that function is available.

## Verified Manim-Web 0.3.24 3-D pattern

Keep the equation, domain, camera values, representative points, and accessible slice table in static HTML/SVG for the mandatory deterministic first render and fallback. By default, use the WebGL Manim layer as the explanatory rendering/motion language when it is at least as clear; adapt these verified JavaScript signatures. When spatial inspection helps, place a visible instruction beside the focusable layer and a real button such as `<button type="button" data-reset-view>Reset view</button>`; the layer itself should use `data-manim-layer`, `tabindex="0"`, and an explanatory `aria-label`. Do not use Python Manim syntax or TypeScript annotations:

```js
const canonicalCamera = Object.freeze({
  phi:75 * Math.PI / 180,
  theta:-30 * Math.PI / 180,
  distance:20,
});
let scene = null;
let snapshotView = null;
const resetView = () => {
  if (!scene) return;
  scene.orbitControls?.reset();
  scene.render();
};
const restoreView = (view) => {
  if (!scene || !view) return;
  scene.setCameraOrientation(view.phi, view.theta, view.distance);
  scene.orbitControls?.update();
  scene.render();
};
try {
  const { ThreeDScene, ThreeDAxes, Surface3D, ORANGE, BLUE } = await import("https://cdn.jsdelivr.net/npm/manim-web@0.3.24/dist/manim-web.browser.js");
  const layer = document.querySelector("[data-manim-layer]");
  const box = layer.getBoundingClientRect();
  scene = new ThreeDScene(layer, {
    width: Math.max(320, Math.round(box.width)),
    height: Math.max(240, Math.round(box.height)),
    backgroundOpacity: 0,
    ...canonicalCamera,
    fov:30,
    enableOrbitControls:true,
    orbitControlsUp:"z",
    orbitControlsOptions:{
      enableRotate:true,
      enableZoom:true,
      enablePan:false,
      minDistance:10,
      maxDistance:28,
      minPolarAngle:15 * Math.PI / 180,
      maxPolarAngle:165 * Math.PI / 180,
    },
  });
  const axes = new ThreeDAxes({ xRange:[-3, 3, 1], yRange:[-3, 3, 1], zRange:[0, 2, 0.5] });
  const surface = new Surface3D({
    func:(u, v) => [u, v, Math.exp(-(u * u + v * v))],
    uRange:[-2, 2], vRange:[-2, 2],
    uResolution:24, vResolution:24,
    checkerboardColors:[ORANGE, BLUE], opacity:0.85,
  });
  scene.add(axes, surface);
  scene.orbitControls?.getControls()?.listenToKeyEvents(layer);
  document.querySelector("[data-reset-view]")?.addEventListener("click", resetView);
} catch (error) {
  console.error("Scientific enhancement failed; static fallback retained", error);
} finally {
  window.penechoWidgetReady?.({
    beforeSnapshot:() => {
      snapshotView = scene?.getCameraOrientation?.() || null;
      scene?.stopAmbientCameraRotation?.();
      resetView();
    },
    afterSnapshot:() => {
      restoreView(snapshotView);
      snapshotView = null;
    },
  });
}
```

If a single camera explanation is animated, call `beginAmbientCameraRotation(rate)`, wait for a bounded duration, call `stopAmbientCameraRotation()`, then `moveCamera(...)` to the documented final camera before readiness. Never end with an infinite wait or automatic orbit. Manual bounded orbit controls may remain enabled after readiness. If an automatic camera transition changes the canonical final view, save that final view as the orbit controls' reset state before enabling exploration.

Accessibility requires a descriptive SVG title, text description of depth/orientation, exact coordinates for key points, keyboard-operable controls, visible focus, contrast, and a data/slice table when spatial precision matters.

The source must contain exactly one capability marker, with this exact capitalization and spelling:

```html
<meta name="penecho-visual-skill" content="math-3d">
```

Do not add another visual-skill marker. The server rejects manim-web imports without this marker and rejects any manim-web import other than the exact pinned URL above.
