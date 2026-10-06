"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../src/client/app/canvas-runtime.js"), "utf8");
function functionSource(name) {
  const start = source.indexOf(`function ${name}(`), body = source.indexOf("{", start);
  assert.ok(start >= 0, `missing function ${name}`);
  let depth = 0;
  for (let i = body; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  assert.fail(`unterminated function ${name}`);
}

test("interaction refreshes keep lasso content in the preview camera until navigation settles", () => {
  const state = { panX:85, panY:60, scale:1.25, selection:{ phase:"active", box:{ x:300, y:220 } } },
    baseline = { x:20, y:30, scale:1 }, draws = [];
  let preview = true, x = 0, y = 0, scale = 1;
  const context = {
    setTransform() { x = y = 0; scale = 1; },
    translate(tx, ty) { x += tx; y += ty; },
    scale(sx) { scale *= sx; },
    clearRect() {}, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
  };
  const environment = {
    state, interactionCtx:context, devicePixelRatio:2, SIZE:20000,
    view:{ classList:{ contains:() => preview } },
    canvasViewportMetrics:() => ({ width:1000, height:800 }),
    canvasNavigationPreviewPanX:baseline.x, canvasNavigationPreviewPanY:baseline.y, canvasNavigationPreviewScale:baseline.scale,
    drawSelection:selection => draws.push({ x:x + selection.box.x * scale, y:y + selection.box.y * scale }),
    drawSelectionContent:selection => draws.push({ x:x + selection.box.x * scale, y:y + selection.box.y * scale }),
  };
  for (const name of ["drawPointerPreview", "drawAreaEraseSelection", "drawDirtyMaskDebugBounds", "drawWidgetRefineButtonHoverOutline", "drawWidgetRefineClickPulse", "drawWidgetRefineConfirmation", "drawHandObjectToolbarOutlines", "drawSelectedAnimation", "drawWidgetChrome", "drawImageChrome", "positionAnimationControls", "positionImageSelectionMaterial", "syncObjectChrome", "syncWidgetInteractionStatus"]) environment[name] = () => {};
  const renderInteraction = vm.runInNewContext(functionSource("renderInteractionLayer") + "\nrenderInteractionLayer", environment);
  for (const viewMode of [false, true]) {
    state.viewMode = viewMode;
    preview = true;
    renderInteraction();
    const bitmap = draws.at(-1), ratio = state.scale / baseline.scale;
    assert.deepEqual(bitmap, { x:320, y:250 }, "refresh retains the bitmap's original camera");
    assert.deepEqual({ x:bitmap.x * ratio + state.panX - baseline.x * ratio, y:bitmap.y * ratio + state.panY - baseline.y * ratio },
      { x:state.panX + state.selection.box.x * state.scale, y:state.panY + state.selection.box.y * state.scale }, "the compositor applies the current camera once");
    preview = false;
    renderInteraction();
    assert.deepEqual(draws.at(-1), { x:460, y:335 }, "settling redraws directly in the current camera");
  }
});
