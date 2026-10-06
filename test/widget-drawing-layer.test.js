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
const runtimeFunctions = [
  "syncWidgetLayerOrder",
  "syncCanvasObjectLayerOrder",
  "setCanvasObjectFrontKind",
  "clearHandToolbarTargets",
  "syncSelectedWidgetMaterial",
  "releaseWidgetsForDrawing",
].map((name) => functionSource(canvasRuntime, name));
const beginCanvasPointerAction = functionSource(uiBootstrap, "beginCanvasPointerAction");

function style() {
  return {
    zIndex: "",
    properties: new Map(),
    setProperty(name, value) { this.properties.set(name, value); },
  };
}

function widget(id) {
  return { id, styleRule: { style: style() } };
}

function createHarness({ frontPlacedCanvasObjectKind = "image", selected = true } = {}) {
  const calls = [];
  const widgetObject = widget(selected ? "selected-widget" : "front-widget");
  const otherWidget = widget("other-widget");
  const state = {
    widgets: [widgetObject, otherWidget],
    pendingWidget: null,
    selectedWidgetId: selected ? widgetObject.id : null,
    widgetEdit: selected ? { id: widgetObject.id, changed: true } : null,
    widgetHistoryBefore: selected ? { before: "widget" } : null,
    interactingWidgetId: selected ? widgetObject.id : null,
    handToolbarTargets: new Map([
      [`widget:${widgetObject.id}`, { kind: "widget", id: widgetObject.id }],
      ["image:image-1", { kind: "image", id: "image-1" }],
      ["text-box:text-1", { kind: "text-box", id: "text-1" }],
    ]),
    handToolbarActiveKey: `widget:${widgetObject.id}`,
    handHoverKey: `widget:${widgetObject.id}`,
    handPointerFocusKeys: new Map([[1, { key: `widget:${widgetObject.id}` }]]),
    handToolbarOperationPointers: new Map([[1, { key: `widget:${widgetObject.id}` }]]),
    handToolbarTimer: 0,
    frontCanvasObjectKind: "widget",
    frontPlacedCanvasObjectKind,
    mode: "pen",
    spacePan: false,
    selectedAnimationId: null,
    timer: 0,
    drawing: null,
    latestTypedInput: "old-input",
    userRevision: 10,
    inkColor: "#111827",
    pen: 4,
    eraser: 12,
    historyBefore: new Map(),
    pointerPreview: null,
    interactionRenderQueued: false,
  };
  const selectedWidgetMaterial = {
    hidden: false,
    classList: { remove(name) { calls.push(["material-class-remove", name]); } },
  };
  const layers = {
    widgetLayer: { style: style() },
    imageMaterialLayer: { style: style() },
    placedContentLayer: { style: style() },
    textEditorLayer: { style: style() },
  };
  const viewClasses = new Set();
  const context = {
    state,
    selectedWidgetMaterial,
    ...layers,
    runtimeElementStyle: (element) => element?.style || null,
    scheduleHandObjectToolbarTick: () => calls.push(["toolbar-tick"]),
    acceptWidgetEdit: () => {
      calls.push(["accept-widget-edit"]);
      state.widgetEdit = null;
      state.selectedWidgetId = null;
      state.widgetHistoryBefore = null;
    },
    setWidgetInteraction: (next, options) => {
      calls.push(["clear-widget-interaction", next, options]);
      state.interactingWidgetId = next?.id || null;
      return true;
    },
    requestInteractionLayerRender: () => calls.push(["interaction-render"]),
    view: { classList: {
      add(name) { viewClasses.add(name); },
      remove(name) { viewClasses.delete(name); },
      contains(name) { return viewClasses.has(name); },
    } },
    valid: (point) => point.x >= 0 && point.y >= 0 && point.x <= 20000 && point.y <= 20000,
    supersedeActiveAI: (reason) => calls.push(["supersede", reason]),
    hideWidgetRefineHint: () => calls.push(["hide-refine-hint"]),
    clearWidgetRefineCandidate: () => calls.push(["clear-refine-candidate"]),
    pressureWidth: () => state.pen,
    logicalWidth: (value) => value,
    captureDrawingTransform: () => ({ scale: 1 }),
    noteCanvasChromeInteraction: () => calls.push(["chrome-interaction"]),
    noteInkForLassoNudge: () => {},
    updateCanvasPointerPreview: () => calls.push(["pointer-preview"]),
    clearTimeout: () => {},
    setCanvasCursor: () => {},
    setNavigating: () => {},
    setStatusKey: () => {},
    appendLiveInkSample: (drawing, point, size) => {
      calls.push(["first-sample", {
        widgetEdit: state.widgetEdit,
        selectedWidgetId: state.selectedWidgetId,
        widgetHistoryBefore: state.widgetHistoryBefore,
        widgetToolbarPresent: state.handToolbarTargets.has(`widget:${widgetObject.id}`),
        interactingWidgetId: state.interactingWidgetId,
        frontCanvasObjectKind: state.frontCanvasObjectKind,
        frontPlacedCanvasObjectKind: state.frontPlacedCanvasObjectKind,
        widgetLayerZ: layers.widgetLayer.style.zIndex,
        placedLayerZ: layers.placedContentLayer.style.zIndex,
        selectedMaterialHidden: selectedWidgetMaterial.hidden,
      }]);
      calls.push(["stroke-history-start"]);
      state.historyBefore.set("stroke", true);
      drawing.samples.push({ point: { ...point }, size });
    },
  };
  const functions = vm.runInNewContext(`(() => {
    ${runtimeFunctions.join("\n")}
    ${beginCanvasPointerAction}
    return { releaseWidgetsForDrawing, beginCanvasPointerAction, syncCanvasObjectLayerOrder, syncSelectedWidgetMaterial };
  })()`, context);
  return { calls, context, functions, layers, selectedWidgetMaterial, state, widgetObject };
}

test("drawing release clears selected Widget state before the first pen/eraser sample", () => {
  for (const mode of ["pen", "eraser"]) {
    const harness = createHarness({ frontPlacedCanvasObjectKind: "text-box" });
    harness.state.mode = mode;
    harness.functions.beginCanvasPointerAction(
      { pointerId: 7, pointerType: "pen", button: 0, pressure: 0.5, clientX: 30, clientY: 40 },
      { x: 30, y: 40 },
    );

    const sample = harness.calls.find(([name]) => name === "first-sample");
    assert.ok(sample, `${mode} must reach its first sample`);
    assert.deepEqual(sample[1], {
      widgetEdit: null,
      selectedWidgetId: null,
      widgetHistoryBefore: null,
      widgetToolbarPresent: false,
      interactingWidgetId: null,
      frontCanvasObjectKind: "widget",
      frontPlacedCanvasObjectKind: "text-box",
      widgetLayerZ: "2",
      placedLayerZ: "1",
      selectedMaterialHidden: true,
    }, mode);
    assert.deepEqual(harness.calls.map(([name]) => name).filter((name) => [
      "accept-widget-edit", "clear-widget-interaction", "first-sample", "stroke-history-start",
    ].includes(name)), [
      "accept-widget-edit", "clear-widget-interaction", "first-sample", "stroke-history-start",
    ], `${mode} must seal Widget editing before starting stroke history`);
    assert.equal(harness.state.drawing.erase, mode === "eraser", mode);
  }
});

test("drawing retains the last clicked Widget order below ink and clears only Widget selection", () => {
  for (const frontPlacedCanvasObjectKind of ["image", "text-box"]) {
    const harness = createHarness({ frontPlacedCanvasObjectKind, selected: false });
    harness.functions.releaseWidgetsForDrawing();

    assert.equal(harness.state.frontCanvasObjectKind, "widget");
    assert.equal(harness.state.frontPlacedCanvasObjectKind, frontPlacedCanvasObjectKind);
    assert.equal(harness.layers.widgetLayer.style.zIndex, "2");
    assert.equal(harness.layers.placedContentLayer.style.zIndex, "1");
    assert.equal(harness.state.handToolbarTargets.has("widget:front-widget"), false);
    assert.equal(harness.state.handToolbarTargets.has("image:image-1"), true);
    assert.equal(harness.state.handToolbarTargets.has("text-box:text-1"), true);
    assert.equal(harness.selectedWidgetMaterial.hidden, true);
    assert.equal(harness.calls.some(([name]) => name === "accept-widget-edit"), false);
  }
});

test("selection and inline interaction preserve Widget order below ink", () => {
  const harness = createHarness();
  const order = harness.state.widgets.map((item) => item.id);
  harness.functions.syncCanvasObjectLayerOrder();
  assert.equal(harness.layers.widgetLayer.style.zIndex, "2");
  assert.equal(harness.layers.textEditorLayer.style.properties.get("--text-editor-layer-z"), "3");
  harness.state.selectedWidgetId = null;
  harness.state.interactingWidgetId = null;
  harness.functions.syncSelectedWidgetMaterial(null);
  assert.equal(harness.layers.widgetLayer.style.zIndex, "2");
  assert.equal(harness.state.frontCanvasObjectKind, "widget");
  assert.deepEqual(harness.state.widgets.map((item) => item.id), order);
  const html = read("public/index.html");
  assert.ok(html.indexOf('id="widgetLayer"') < html.indexOf('id="inkLayer"'));
  assert.ok(html.indexOf('id="textContentLayer"') < html.indexOf('id="inkLayer"'));
  assert.match(read("public/style.css"), /\.ink-layer\s*\{[^}]*z-index:\s*2/);
});

test("hover, pending, dragging and resizing never promote Widget content above ink", () => {
  const harness = createHarness({ selected:false });
  for (const front of ["widget", "image", "text-box"]) {
    for (const materialVisible of [false, true]) {
      for (const interacting of [false, true]) {
        harness.state.frontCanvasObjectKind = front;
        harness.selectedWidgetMaterial.hidden = !materialVisible;
        harness.state.interactingWidgetId = interacting ? harness.widgetObject.id : null;
        harness.state.pendingWidget = widget("pending-widget");
        harness.state.widgetGesture = { widget:harness.widgetObject, hit:"resize-se" };
        harness.functions.syncCanvasObjectLayerOrder();
        assert.equal(harness.layers.widgetLayer.style.zIndex, front === "widget" ? "2" : "1");
        assert.equal(harness.layers.textEditorLayer.style.properties.get("--text-editor-layer-z"), "3");
      }
    }
  }
});
