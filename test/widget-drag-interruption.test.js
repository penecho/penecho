"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const functionSource = (source, name) => {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const body = source.indexOf("{", start);
  let depth = 0;
  for (let index = body; index < source.length; index++) {
    if (source[index] === "{") depth++;
    else if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`unterminated function ${name}`);
};

const canvasRuntime = read("src/client/app/canvas-runtime.js");
const uiBootstrap = read("src/client/app/ui-bootstrap.js");
const finishWidgetGesture = functionSource(canvasRuntime, "finishWidgetGesture");
const finishReleasedWidgetGesture = functionSource(canvasRuntime, "finishReleasedWidgetGesture");
const finishInterruptedWidgetGesture = functionSource(canvasRuntime, "finishInterruptedWidgetGesture");

function createHarness(gesture, hidden = false) {
  const calls = {
    cursorReset: 0,
    handToolbarFinish: [],
    positioned: [],
    toolbarRefresh: 0,
    interactionRender: 0,
  };
  const state = {
    widgetGesture: gesture,
    widgetEdit: { id:gesture.widget.id, before:{x:gesture.widget.x-(gesture.changed?1:0),y:gesture.widget.y,w:gesture.widget.w,h:gesture.widget.h}, changed:false },
  };
  const document = { hidden };
  const functions = vm.runInNewContext(`(() => {
    ${finishWidgetGesture}
    ${finishReleasedWidgetGesture}
    ${finishInterruptedWidgetGesture}
    return { finishWidgetGesture, finishReleasedWidgetGesture, finishInterruptedWidgetGesture };
  })()`, {
    document,
    widgetLayout:widget=>({x:widget.x,y:widget.y,w:widget.w,h:widget.h}),
    finishHandToolbarOperation: (id) => calls.handToolbarFinish.push(id),
    positionWidget: (widget) => calls.positioned.push(widget),
    refreshHandObjectToolbar: () => calls.toolbarRefresh++,
    requestInteractionLayerRender: () => calls.interactionRender++,
    resetCanvasCursor: () => calls.cursorReset++,
    state,
  });
  return { calls, document, functions, state };
}

function widgetGesture(overrides = {}) {
  return {
    id:17,
    pointerType:"mouse",
    widget:{ id:"widget-1", x:100, y:200, w:360, h:240 },
    pending:false,
    changed:false,
    ...overrides,
  };
}

test("pointerup, pointercancel, and lostpointercapture finish only the matching Canvas gesture", () => {
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    const matching = createHarness(widgetGesture());
    assert.equal(matching.functions.finishInterruptedWidgetGesture({ type, pointerId:17 }), true, type);
    assert.equal(matching.state.widgetGesture, null, type);

    const unrelated = createHarness(widgetGesture());
    assert.equal(unrelated.functions.finishInterruptedWidgetGesture({ type, pointerId:99 }), false, type);
    assert.ok(unrelated.state.widgetGesture, `${type} with another pointer must preserve the gesture`);
  }
});

test("blur and hidden-document interruptions finish while a visible visibilitychange does not", () => {
  const blurred = createHarness(widgetGesture());
  assert.equal(blurred.functions.finishInterruptedWidgetGesture({ type:"blur" }), true);
  assert.equal(blurred.state.widgetGesture, null);

  const hidden = createHarness(widgetGesture(), true);
  assert.equal(hidden.functions.finishInterruptedWidgetGesture({ type:"visibilitychange" }), true);
  assert.equal(hidden.state.widgetGesture, null);

  const visible = createHarness(widgetGesture(), false);
  assert.equal(visible.functions.finishInterruptedWidgetGesture({ type:"visibilitychange" }), false);
  assert.ok(visible.state.widgetGesture);
});

test("a mouse release with buttons=0 ends the gesture, while active buttons and unrelated pointer types do not", () => {
  const released = createHarness(widgetGesture());
  assert.equal(released.functions.finishReleasedWidgetGesture({
    pointerId:17,
    pointerType:"mouse",
    buttons:0,
  }), true);
  assert.equal(released.state.widgetGesture, null);

  const active = createHarness(widgetGesture());
  assert.equal(active.functions.finishReleasedWidgetGesture({
    pointerId:17,
    pointerType:"mouse",
    buttons:1,
  }), false);
  assert.ok(active.state.widgetGesture);

  for (const pointerType of ["touch", "pen"]) {
    const unrelatedMouse = createHarness(widgetGesture({ pointerType }));
    assert.equal(unrelatedMouse.functions.finishReleasedWidgetGesture({
      pointerId:99,
      pointerType:"mouse",
      buttons:0,
    }), false, `${pointerType} must not be interrupted by an unrelated mouse event`);
    assert.ok(unrelatedMouse.state.widgetGesture);
  }
});

test("top-level release can finish a namespaced host mouse gesture, but not host touch or pen gestures", () => {
  const hostMouse = createHarness(widgetGesture({
    id:100017,
    source:"widget-host",
    pointerType:"mouse",
  }));
  assert.equal(hostMouse.functions.finishReleasedWidgetGesture({
    pointerId:17,
    pointerType:"mouse",
    buttons:0,
  }), true);
  assert.equal(hostMouse.state.widgetGesture, null);

  for (const pointerType of ["touch", "pen"]) {
    const hostGesture = createHarness(widgetGesture({
      id:100017,
      source:"widget-host",
      pointerType,
    }));
    assert.equal(hostGesture.functions.finishReleasedWidgetGesture({
      pointerId:17,
      pointerType:"mouse",
      buttons:0,
    }), false, `${pointerType} host gesture must ignore an unrelated mouse release`);
    assert.ok(hostGesture.state.widgetGesture);
  }
});

test("host interruption cleanup requires a mouse release and ignores top-level mouse events for touch or pen", () => {
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    const released = createHarness(widgetGesture({
      id:"widget-host:widget-1:17",
      source:"widget-host",
      pointerType:"mouse",
    }));
    assert.equal(released.functions.finishInterruptedWidgetGesture({
      type,
      pointerId:999,
      pointerType:"mouse",
      buttons:0,
    }), true, type);
    assert.equal(released.state.widgetGesture, null, type);

    const active = createHarness(widgetGesture({
      id:"widget-host:widget-1:17",
      source:"widget-host",
      pointerType:"mouse",
    }));
    assert.equal(active.functions.finishInterruptedWidgetGesture({
      type,
      pointerId:999,
      pointerType:"mouse",
      buttons:1,
    }), false, `${type} with active buttons must preserve the host gesture`);
    assert.ok(active.state.widgetGesture);
  }

  for (const pointerType of ["touch", "pen"]) {
    const harness = createHarness(widgetGesture({
      id:"widget-host:widget-1:17",
      source:"widget-host",
      pointerType,
    }));
    assert.equal(harness.functions.finishInterruptedWidgetGesture({
      type:"pointerup",
      pointerId:999,
      pointerType:"mouse",
      buttons:0,
    }), false, `${pointerType} host gesture must ignore a top-level mouse release`);
    assert.ok(harness.state.widgetGesture);
  }
});

test("finishing preserves widget geometry, propagates changed, and is idempotent", () => {
  const harness = createHarness(widgetGesture({
    changed:true,
    widget:{ id:"widget-1", x:123.5, y:456.25, w:512.75, h:321.5 },
  }));
  const widget = harness.state.widgetGesture.widget;
  const geometry = { x:widget.x, y:widget.y, w:widget.w, h:widget.h };

  assert.equal(harness.functions.finishWidgetGesture({ pointerId:17 }), true);
  assert.deepEqual({ x:widget.x, y:widget.y, w:widget.w, h:widget.h }, geometry);
  assert.equal(harness.state.widgetEdit.changed, true);
  assert.equal(harness.calls.positioned.length, 1);
  assert.equal(harness.calls.cursorReset, 1);
  assert.equal(harness.calls.toolbarRefresh, 1);
  assert.equal(harness.calls.interactionRender, 1);

  assert.equal(harness.functions.finishWidgetGesture({ pointerId:17 }), false);
  assert.equal(harness.calls.positioned.length, 1);
  assert.equal(harness.calls.interactionRender, 1);
});

test("global interruption events are registered and tool changes clean up before accepting widget edits", () => {
  assert.match(uiBootstrap, /window\.addEventListener\("pointermove", finishReleasedWidgetGesture, true\)/);
  assert.match(uiBootstrap, /for \(const type of \["pointerup", "pointercancel", "lostpointercapture", "blur"\]\) \{\s*window\.addEventListener\(type, finishInterruptedWidgetGesture, type !== "blur"\);\s*\}/);
  assert.match(uiBootstrap, /document\.addEventListener\("visibilitychange", finishInterruptedWidgetGesture\)/);

  const setCanvasMode = functionSource(uiBootstrap, "setCanvasMode");
  assert.match(setCanvasMode, /if \(state\.widgetGesture\) finishInterruptedWidgetGesture\(\{ type:"tool-change" \}\);[\s\S]*?if \(state\.widgetEdit\) acceptWidgetEdit\(\)/);
});

 test("dragging attached object bars preserves Hand without an implicit selection tool switch", () => {
   for (const target of ["widget", "image", "animation"]) {
     const state = { mode:"hand", viewMode:false, spacePan:false };
     const calls = [];
     const begin = vm.runInNewContext(`(${functionSource(canvasRuntime, "beginObjectChromeMove")})`, {
       state, Number, clientPoint: () => ({x:10,y:20}),
       setCanvasMode: () => assert.fail("dragging must not switch tools"),
       beginWidgetGesture: () => { calls.push("widget"); return true; },
       beginImageGesture: () => { calls.push("image"); return true; },
       beginAnimationGesture: () => { calls.push("animation"); return true; },
       objectChromeLayer: {setPointerCapture() {}},
     });
     assert.equal(begin({button:0,pointerId:1}, {target,object:{id:"object"}}),true);
     assert.deepEqual(calls,[target]);
     assert.equal(state.mode,"hand");
   }
 });
