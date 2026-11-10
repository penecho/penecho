# Widget header, specific Refine and host-rendered scenes

## Widget header (all editing tools)

- A new AI Widget commits immediately and shows this header without a separate
  confirmation step or a tool change. Undo removes it; Redo restores the object.
  Text, formulas and drawings that merge into the Canvas retain draft controls.
- Hovering a Widget for about 0.16 s shows its header toolbar in Pen, Hand and
  Select. Hover never runs AI. Leaving hides it after about 0.9 s unless the
  pointer rests on the header.
- The header retains its 10 px visual gap above the Widget. An invisible pointer
  bridge covers the gap where header and body overlap horizontally. The header,
  bridge and raised Widget body share hover ownership, including when other
  Widgets sit behind them or the header wraps/clamps at the viewport edge.
  Pointer presses in the bridge use the header's existing move behavior.
  Leaving that combined area resumes normal hit testing.
- Header items: grip (drag to move, including in Pen), **Interact**, up to two
  **suggestion chips**, **Refine**, then Favorite, Copy, Echo, Share, Download and Delete.
- **Interact** makes the Widget live in place: the tool does not change. The first
  press outside ends interaction without leaving a stroke (Esc also works).
  The Canvas setting "penecho.widgetInteractionPresentation" still decides
  inline or maximized.
- In Pen, a mouse press on a Widget still draws. Marks near a Widget show its
  header with an amber dot on Refine and an "Apply my marks" chip.

Code: `src/client/app/canvas-runtime.js` (`updateWidgetRefinePointer`,
`showWidgetHeader`, `addWidgetToolSpecs`) and `canvas-navigation.js`
(`enterWidgetInteraction`, `widgetInteractionInPlace`).

Hover regression coverage: `test/widget-header-hover.test.js` and
`scripts/verify-widget-header-hover.cjs` (real Chromium mouse input, overlapping
Widgets, zoom, wrapped headers, dragging and native iframe interaction).

## Plot viewport

`public/smart-suggest.js` keeps the graph canvas out of intrinsic grid sizing.
Its backing store uses CSS dimensions and pixel density; resize preserves the
mathematical window and the user's pan/zoom. The graph owns its control font size
so the host's document typography does not enlarge the sidebar.

The generated `penecho-widget-layout=viewport` meta tag lets presentation fit the
graph into the available height below the toolbar, including short windows.
Ordinary document widgets retain their saved minimum height and scrolling.
Loading an older native Plot repairs its exact legacy resize block and layout
without replacing its expressions or other authored content.

Browser coverage: `scripts/graph-widget-smoke.cjs` (also `--legacy`).

## Refine panel and Widget Assist

`src/client/app/widget-assist.js` owns the closed Widget action registry:

| ID | Visible action | Effect |
| --- | --- | --- |
| `apply_marks` | Refine with my marks | Apply the marks in place; preserve its existing position in the panel. |
| `vivid` | Selected illustration style | Create a separate illustrated Widget beside the source; preserve the original. Always available as the existing fixed shortcut. |
| `simplify` | Simplify | Reduce secondary content and clutter in place. |
| `animate` | Explain with animation / 动画讲解 | Create a separate animated explanation Widget beside the source, preserving the original concept, notes or diagram. |
| `animate_sketch` | Animate sketch / 让画动起来 | Create a separate animated Widget beside the source, preserving its depicted subject and composition. |
| `note` | Make notes | Create a separate note beside the source; preserve the original Widget. Excluded from native Note Widgets. |

Opening Refine requests PenEchoLLM ranking. Hover never calls the model. The
panel shows up to three ranked recommendations, the unchanged marks/Vivid
shortcuts, More and Ask. More exposes remaining manual actions, including Make
notes after a zero/none ranking. Manual availability does not promote an action
into the top three. Main Suggest likewise keeps Make notes in More if absent
from its leading items; Answer remains its only guaranteed top-three action.

Removed from both the Widget registry and Cloud Widget classifier whitelist:
`fix_error`, `fix_layout`, `match_theme`, `add_controls`, `scene_replay`,
`scene_slower`, `scene_faster`, `present`. Scene playback controls and header
Interact continue through their existing interfaces.

Explain with animation, Animate sketch and Vivid use a bounded new-Widget
request through PenEcho Agent: their source is
read-only, and the host places the result in nearby free space. Source patches,
geometry changes, deletion and presentation using a source artifact identity
are rejected. These actions preserve pending Canvas ink.
The established math/physics and sketch task prompts are reused verbatim; only
Widget-specific context is added. Notes explain existing claims and examples in
order. Diagrams trace an evidenced path/message flow with original labels and
relations, identifying illustrative timing and conditional branches. Each
animation result includes meaningful motion, pause and replay.

Ordinary edits patch editable HTML or existing scenes' canonical JSON in place.
Native Note and Professional Diagram HTML remains generated. Existing attached
animations remain supported: a writable
`objects/<id>/widget.animation.json` file holds a validated Scene (initially
`null`). The host shows it above the original content inside the same Widget.
The original Note/diagram source, object ID and geometry are retained. Setting
the animation file to `null` removes it. The attachment participates in source
hashes, persistence, export, Undo/Redo, and Note math/metadata refresh.

Every refinement remains bounded to its target. In-place edits include relevant dirty marks;
derived Widget actions use the source Widget alone and preserve pending ink.
Explicit action/Ask instructions retain priority over unrelated marks. The
screenshot includes the Widget and viewport-clipped dirty input, without
expanding into neighboring objects. Agent reads exact virtual source and its
contentHash before a strict patch. See `docs/smart-suggestions.md` for routing.

## Host-rendered scenes (`sourceFormat: "penecho-scene+json"`)

The model returns `{tool:"html_widget", pluginId:"general",
sourceFormat:"penecho-scene+json", scene:{...}}`. The server validates the
scene (`public/scene-spec.js`) and builds the document. The Widget host loads
`public/scene-runtime.js` plus only the engine the scene needs:

| engine | vendor (MIT, pinned in `public/vendor/scene/`) |
| --- | --- |
| motion | anime.js 4.5.0 |
| physics | matter-js 0.20.0 |
| 3d | Zdog 1.1.3 |

- Contract given to the model: `src/server/scene-contract.md`, appended to the
  plugin system prompt. The General plugin document is size-capped.
- Refine sends only `widget.json` and `widget.source`; the model never sees or
  patches the HTML (`hostCompiledWidget` in `src/server/widget-patch.js`).
- The browser rebuilds a scene's HTML from its source in `widgetRecord`, so
  AI, Agent patches and file loads all render the same way.
- Tests: `test/widget-header-scene.test.js`.

MCP and PenEcho Agent both expose creation/update through the shared
`penecho_present_widget` tool. Read `penecho_get_guidance({id:"scene",detail:"full"})`,
then pass exactly one content field (`scene` instead of `html`):

```js
{
  sessionId: "<bound MCP session; omitted for built-in Agent>",
  artifactId: "falling-ball",
  title: "Falling ball",
  scene: {
    engine: "physics",
    bodies: [{id:"ball",shape:"circle",x:200,y:80,r:24,fill:"blue"}],
    walls: "floor"
  }
}
```

Use the same interface for `motion` actors/beats and `3d` shapes. Presentation
returns `objects/<id>/widget.source` with its content hash. Edit that JSON through
`penecho_patch_file`; generated `widget.html` is read-only. The same validation
and regeneration apply to active/background documents, persistence and patches.
Official public/Agent Cloud mirrors include the scene runtime and contract.

Example requests: "Animate this process step by step with pause and replay"
(`motion`); "Show a ball falling under gravity and bouncing on the floor"
(`physics`); "Create a rotating 3D cube that I can drag to inspect" (`3d`).
These are semantic cues, not hard-coded keyword triggers.

## Not yet done

- The ink Assist bar does not yet offer "Apply to widget". It hides while the
  Refine panel is open.
- Widget suggestion ranking is an internal UI operation. MCP/Agent use the shared
  creation, source patch and diagnostics tools for the corresponding edits.
