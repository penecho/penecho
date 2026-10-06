# Ink Lab (existing widgets)

As of 2026-09-29, Canvas no longer exposes Ink Lab creation tools or “Make objects interactive” suggestions. Existing saved widgets retain editing, Undo, persistence and export support. The creation walkthroughs below document the retired feature for historical reference.

Ink Lab turns hand-drawn strokes into editable objects and gives them local, deterministic behaviors. It is an ordinary persistent PenEcho Widget, opened from the **Ink Lab / 手绘实验室** toolbar button. The source of truth is structured JSON embedded in the Widget HTML. Editing a scene updates the normal Canvas history and save/export pipeline.

## Start an isolated test

From the canonical Canvas project:

```sh
cd /Users/heack/workspace/penecho_071_version
npm run preview:ink-lab
```

Open `http://127.0.0.1:3922`. The preview uses disposable state and does not read or change the user's saved Canvas library or API settings. Turn **Auto AI** off before drawing on the outer Canvas; the test instance intentionally has no AI credentials. Stop with Ctrl+C. Its temporary state is removed on exit, so export anything worth keeping before stopping. If 3922 is occupied, use `INK_LAB_PORT=3923 npm run preview:ink-lab`.

For everyday work in the normal app, run the canonical source through the normal PenEcho launcher. Use the regular **Save Canvas** action to retain scenes across app reloads; the editor's save acknowledgment means its data was committed to the current Canvas, not that an unsaved Canvas was written to disk.

## Reproduction checklist

| Capability | Actions | Expected result |
| --- | --- | --- |
| Handwritten entities | Open Ink Lab → Blank sketch. Choose Draw. Draw a triangle in three strokes and a rectangle in four strokes. Click Recognize strokes. | Two independent entities; original vectors remain available under Original strokes. Unrecognized strokes remain editable ink. |
| Import real Canvas strokes | On the outer Canvas, draw two closed shapes with Auto AI off. Click the local “Make objects interactive” chip, or Ink Lab → Use my recent strokes. | Copies of the current session's strokes enter a scene. The outer raster ink remains intact. Erased and undone strokes are excluded. |
| Connections and grouping | Select two objects in the list, or enable Multi-select and click them in order. Connect, then drag either object. Group, drag again, then Undo. | Arrow endpoints follow the shape boundary. Grouped objects move together. Undo restores the preceding state. Disconnect removes the selected pair's links. |
| Geometry | Select the triangle under Geometry. Drag vertices. Enable Right angle at B, then drag another vertex. Use Mirror copy and the point-on-edge slider. | Live angles and area; B stays at 90°. The mirrored copy has equal area; the amber point stays on the first edge. Measurements are scene units, not calibrated centimeters. |
| Formula plots | Open Math & charts. Enter `a*sin(x)+b; cos(x)` and Plot. Move a and b. Change x min/max, then Plot. | Up to three curves update locally. Discontinuities are broken rather than connected across large jumps. The displayed y range is -6 to 6. |
| Symbolic math | Enter `x^3`, choose Derivative, Calculate first expression. Try `2*x` with Antiderivative and `x^2-4` with Solve for x. | `3*x^2`, an antiderivative plus C, and roots 2 and -2. Results come from the pinned local Nerdamer engine. A 3-second worker timeout bounds symbolic operations. |
| Data charts | Select Daily data chart, or switch the Math source to Data. Paste rows such as `A,12`, `B,-5`, `C,21`; choose Bars or Line and Update chart. | A labeled chart with numeric values; negative bars extend below zero. The inspector shows count, total, and mean. Up to 50 rows, two columns each, separated by comma or tab. |
| Incline | Load Incline + block. Run. Set friction to 0.7 at 30° and Run again. | The first block travels; the higher-friction case stays still. Simulation stops at the end of the finite ramp. |
| Other physics | Load Pendulum, Two-body spring, or Lever. Change length, stiffness or masses, then Run. | Pendulum period scales with square root of length; the spring conserves its center of mass; equal lever masses balance. |
| Bind your own shapes | Recognize your shapes, open Physics, choose an experiment and Bind objects. Select the intended objects first if the scene has extras. | Incline requires triangle + rectangle; pendulum requires line + circle; spring requires two bodies; lever requires triangle + two bodies. Incompatible choices show a concrete explanation. |
| Clickable prototype | Load Two-screen prototype, Run prototype. Open details and Back. Toggle Notifications and adjust Volume. | Real local page navigation and persistent control values. In edit mode, assign Screen/Button/Toggle/Slider behavior and target pages to your own objects. |
| Flow | Load Conditional flow. Step three times with yes, then switch to no and repeat. Load Breadth-first tree and step through it. | Current node reaches Continue or Retry. The inspector shows visited nodes and the BFS queue. Path traversal is limited to 100 steps; BFS does not revisit cycles. |
| Slides | On any scene choose Add scene to slides. Open Slides. Edit title/notes, reorder, delete, and present. Use arrow keys to move and Escape to exit. | Independent scene snapshots retain their parameters. Up to 12 slides within the scene size limit. Loading non-slide examples keeps existing slides; loading the slide lesson replaces the deck and is undoable. |
| PowerPoint | Load Three-slide lesson and Export PPTX. If automatic download does not start, click the download link shown by Canvas. | A real `.pptx` with three slides, editable titles and speaker notes. Scene illustrations are raster images; simulations are not executable in PowerPoint. |
| Figures and webpage | Use SVG or PNG on any scene. Export webpage Demo for a self-contained interactive HTML file. | SVG and PNG use the current scene view. HTML includes local libraries, data and editor controls; no AI server/CDN is required. Browser download policies still apply. |
| Save and reopen | Exit Widget interaction, Save Canvas, refresh, then open the saved Canvas from Recent work. | The scene and slide deck return. Enter Widget interaction to continue editing. Editor undo is session-local; Canvas history records each committed scene edit. |

## Local models and limits

- Recognition is geometric and explicit. It does not OCR handwritten labels or equations. Rename entities or enter formulas in the editor.
- Recognition supports individual closed triangles, quadrilaterals, circles/ellipses, straight lines, and closed triangles/rectangles assembled from separate lines. Ambiguous strokes remain ink.
- The current implementation edits objects inside a Canvas Widget. It does not convert the Canvas's entire historical raster layer into native vector objects.
- Scenes support 64 entities, 96 connections, 48 pending strokes, and 90,000 characters of validated scene data. History holds 40 local edits. Limits fail atomically rather than dropping objects silently.
- Physics is illustrative: constant incline friction, small-angle pendulum, ideal two-body spring, and a limited-angle lever model. It is not a general collision/rigid-body solver.
- Symbolic math accepts a bounded set of functions, variables x/a/b/c, and short expressions. It is not a complete proof assistant. Plot values are floating-point samples.
- The preview's raster figure export is 1440 × 800. The original vector scene remains editable in Canvas and HTML. Titles and notes remain editable in PPTX; the scene image does not.
- The standalone HTML must be re-exported to retain changes. Its editor does not silently write back to the file on disk.

## Libraries and build

- Nerdamer **1.1.13**, MIT: https://github.com/jiggzson/nerdamer (the license of this pinned package is used; newer major versions may differ).
- PptxGenJS **4.0.0**, MIT: https://github.com/gitbrent/PptxGenJS.
- JSZip **3.10.1**, used by PptxGenJS; MIT/GPL dual license, used under MIT.
- PptxGenJS's image-size dependency is pinned through a scoped override to patched **2.0.4**. The browser renderer exports known PNG data and does not parse arbitrary image formats.

`npm run build:ink-lab` reproducibly bundles the libraries and licenses into `public/vendor/ink-lab-vendor.js` and `ink-lab-LICENSE.txt`. `npm run build:client` also builds this bundle. `npm run check:ink-lab` checks generated output. The scene itself stays below the existing Widget HTML size limit; the host injects the fixed local library URL only for this scene format.

The host bridge checks frame ownership, source format, interaction state, payload type and size. Only validated scene data updates Widget HTML. File exports use a four-name/MIME allow-list and a 16 MB limit. No arbitrary HTML supplied by a scene message is accepted. These changes are local Canvas source work; Cloud synchronization and deployment are separate operations.
