"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const ui = read("src/client/app/ui-bootstrap.js"), core = read("src/client/app/core.js"), zh = read("public/locales/zh.js");
const html = read("public/index.html"), css = read("public/style.css");
const functionSource = (source, name) => {
  const match = source.match(new RegExp(`function ${name}\\([^]*?\\n  \\}`));
  assert.ok(match, name);
  return match[0];
};

test("the Lasso icon shows a marquee loop capturing AI sparkles", () => {
  const button = /<button id="lassoToolBtn"[^]*?<\/button>/.exec(html)?.[0] || "";
  assert.match(button, /class="icon-button lasso-tool-button"/);
  assert.match(button, /class="lasso-loop"/);
  assert.equal((button.match(/class="lasso-spark/g) || []).length, 2);
  assert.match(css, /#lassoToolBtn \.lasso-loop \{ stroke-dasharray/);
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\) \{\n  #lassoToolBtn\.lasso-preview:not\(\.active\) \.lasso-loop \{ animation: lasso-march \.9s linear 1;/);
  assert.match(css, /#lassoToolBtn\.active \.lasso-loop \{ animation: lasso-march 2\.4s linear infinite;/);
  // The button contract owns ::after as the hit area; the discovery dot uses ::before.
  assert.match(css, /#lassoToolBtn\[data-lasso-discovery="new"\]:not\(\[aria-busy="true"\]\)::before/);
  assert.doesNotMatch(css, /#lassoToolBtn[^{]*::after/);
});

test("only a pen side-button press starts the temporary Lasso", () => {
  const isPenButton = vm.runInNewContext(`(${functionSource(ui, "canvasPenButtonLasso")})`);
  assert.equal(isPenButton({ pointerType:"pen", button:2, buttons:2 }), true);
  assert.equal(isPenButton({ pointerType:"pen", button:-1, buttons:3 }), true);
  assert.equal(isPenButton({ pointerType:"pen", button:0, buttons:1 }), false);
  assert.equal(isPenButton({ pointerType:"pen", button:5, buttons:32 }), false, "the eraser end keeps erasing");
  assert.equal(isPenButton({ pointerType:"mouse", button:2, buttons:2 }), false);
  assert.match(ui, /if \(canvasPenButtonLasso\(e\) && beginPenButtonLasso\(e\)\) return;\n    finishPenButtonLassoOutside\(e\);/);
});

test("the pen side-button Lasso returns to the previous writing tool", () => {
  const state = { mode:"pen", viewMode:false }, calls = [];
  const api = vm.runInNewContext(`let lassoPenButtonReturn = null, lassoPenButtonContextUntil = 0;
    ${functionSource(ui, "canvasPenButtonLasso")}
    ${functionSource(ui, "beginPenButtonLasso")}
    ${functionSource(ui, "finishPenButtonLassoOutside")}
    ({ beginPenButtonLasso, finishPenButtonLassoOutside, pending:() => lassoPenButtonReturn })`, {
    state, performance:{ now:() => 0 },
    canvasToolMode:mode => ["hand", "pen", "select", "text", "eraser", "area-eraser"].includes(mode) ? mode : "",
    captureDrawingInput:() => ({ point:{ x:10, y:10 } }), valid:() => true,
    selectCanvasToolMode:mode => { calls.push(mode); state.mode = mode; return true; },
    deselectAnimation(){}, watchPenButtonLasso(){},
    handleSelectionPointerDown:() => { calls.push("lasso"); state.selection = { phase:"active" }; },
    selectionAIBusy:() => false, selectionHit:() => null, commitSelection:() => { calls.push("commit"); state.selection = null; },
  });
  assert.equal(api.beginPenButtonLasso({ pointerType:"pen", button:2, buttons:2 }), true);
  assert.equal(api.pending(), "pen");
  assert.equal(api.finishPenButtonLassoOutside({ pointerType:"touch", button:0, buttons:1 }), false, "touch panning keeps the selection");
  assert.equal(api.finishPenButtonLassoOutside({ pointerType:"pen", button:0, buttons:1 }), true);
  assert.deepEqual(calls, ["select", "lasso", "commit", "pen"]);
  assert.equal(api.pending(), null);
  state.mode = "hand";
  assert.equal(api.beginPenButtonLasso({ pointerType:"pen", button:2, buttons:2 }), false, "Hand keeps its own pen gestures");
});

test("Lasso discovery copy is bilingual and short", () => {
  for (const key of ["canvasHintLassoNudge", "canvasHintLassoNudgeCompact", "canvasHintLassoCaptured", "canvasHintLassoCapturedCompact", "canvasHintLassoDiscover", "canvasHintLassoDiscoverCompact"]) {
    const english = new RegExp(`${key}: "([^"]+)"`).exec(core)?.[1] || "";
    assert.ok(english && english.split(/\s+/).length <= 20, key);
    assert.match(zh, new RegExp(`${key}: "`));
  }
  assert.match(core, /canvasHintLassoNudge: "[^"]*\{shortcut\}/);
  assert.match(core, /\{ id: "core-lasso-v3", targets: \["#lassoToolBtn"\]/, "returning users see the updated Lasso tour step once");
  assert.match(ui, /LASSO_DISCOVERY_KEY = "penecho-lasso-discovery-v1", LASSO_NUDGE_STROKES = 10, LASSO_NUDGE_MAX = 3/);
});
