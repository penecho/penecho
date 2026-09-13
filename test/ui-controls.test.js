"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const selectionMath = require(path.join(ROOT, "public/selection.js"));
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

test("selected pen width stays at 3-8 px with a 4 px default while pressure follows the main Canvas curve", () => {
  const html = read("public/index.html"), app = read("public/app.js");
  const control = html.match(/<input id="penSize"[^>]*>/)?.[0] || "";
  assert.match(control, /min="3"/);
  assert.match(control, /max="8"/);
  assert.match(control, /step="1"/);
  assert.match(control, /value="4"/);
  assert.match(app, /PEN_SIZE_MIN = 3,[\s\S]*?PEN_SIZE_MAX = 8/);
  assert.doesNotMatch(app, /PEN_STROKE_MIN|PEN_PRESSURE_TIP_RATIO|function clampStrokeWidth/);
  const clampSource = functionSource(app, "clampPenWidth"), pressureSource = functionSource(app, "pressureWidth");
  assert.match(clampSource, /Math\.max\(PEN_SIZE_MIN, Math\.min\(PEN_SIZE_MAX, width\)\)/);
  assert.match(pressureSource, /e\.pressure <= 0[\s\S]*?Math\.max\(3, Math\.min\(16, state\.pen \* \(0\.72 \+ e\.pressure \* 0\.7\)\)\)/);
  assert.match(app, /document\.querySelector\("#penSize"\)\.oninput = \(e\) => \{[\s\S]*?state\.pen = clampPenWidth\(Math\.round\(Number\(e\.target\.value\)\)\)/);
  const clamp = Function("PEN_SIZE_MIN", "PEN_SIZE_MAX", `return (${clampSource});`)(3, 8);
  assert.deepEqual([clamp(2), clamp(6), clamp(12)], [3, 6, 8]);
  const state = { pen:8 }, pressureWidth = Function("state", `return (${pressureSource});`)(state);
  assert.ok(Math.abs(pressureWidth({ pointerType:"pen", pressure:1 }) - 11.36) < 1e-9);
  state.pen = 4;
  assert.equal(pressureWidth({ pointerType:"pen", pressure:0 }), 4);
  assert.ok(Math.abs(pressureWidth({ pointerType:"pen", pressure:0.1 }) - 3.16) < 1e-9);
  assert.equal(pressureWidth({ pointerType:"mouse", pressure:0.1 }), 4);
});

test("active pen drawing paints a live layer before committing authoritative ink on release", () => {
  const app = read("public/app.js");
  const pointerMove = app.slice(app.indexOf('screen.addEventListener("pointermove"'), app.indexOf("function end(e)")),
    activeDrawing = functionSource(app, "updateActiveCanvasDrawing"),
    appendLive = functionSource(app, "appendLiveInkSample"),
    commitProgress = functionSource(app, "commitLiveInkDrawingProgress"),
    commitLive = functionSource(app, "commitLiveInkDrawing"),
    requestCommittedRender = functionSource(app, "requestCommittedInkRender"),
    finishDrawing = functionSource(app, "finishDrawing"),
    warmLive = functionSource(app, "warmLiveInkLayer"),
    scheduleWarm = functionSource(app, "scheduleLiveInkLayerWarmup"),
    captureInput = functionSource(app, "captureDrawingInput"),
    fitCanvas = functionSource(app, "fit"),
    pointerDown = app.slice(app.indexOf('function handleCanvasPointerDown('), app.indexOf('screen.addEventListener("pointermove"'));
  assert.doesNotMatch(app, /function drawingPointerSamples/);
  assert.doesNotMatch(pointerMove, /getCoalescedEvents/);
  assert.match(pointerMove, /if \(updateActiveCanvasDrawing\(e\)\) return;[\s\S]*?updateCanvasWidgetGestureResetTap\(e\)/);
  assert.doesNotMatch(activeDrawing, /clientPoint\(|canvasViewportMetrics\(|calibrateScreenClientRatio\(/);
  assert.match(activeDrawing, /drawingClientPoint\(d, e\)[\s\S]*?appendLiveInkSample\(d, p, size\)[\s\S]*?commitLiveInkDrawingProgress\(d\)/);
  assert.match(appendLive, /drawing\.samples\.push\(sample\)[\s\S]*?paintInkDisplaySegment\([\s\S]*?drawing\.erase \? inkCtx : liveInkCtx/);
  assert.match(commitProgress, /LIVE_INK_COMMIT_SAMPLE_BATCH[\s\S]*?dot\(first\.point, drawing\.erase[\s\S]*?stroke\(previous\.point, current\.point, drawing\.erase[\s\S]*?drawing\.committedSamples = drawing\.samples\.length/);
  assert.match(commitLive, /commitLiveInkDrawingProgress\(drawing, true\)[\s\S]*?requestCommittedInkRender\(\)/);
  assert.match(requestCommittedRender, /requestAnimationFrame[\s\S]*?renderInkLayer\(\)[\s\S]*?state\.drawing\?\.samples\?\.length[\s\S]*?clearLiveInkLayer\(\)/);
  assert.match(warmLive, /fillRect\(0, 0, 1, 1\)[\s\S]*?clearRect\(0, 0, 1, 1\)[\s\S]*?liveInkNeedsWarmup = false/);
  assert.match(scheduleWarm, /requestAnimationFrame[\s\S]*?requestAnimationFrame[\s\S]*?!state\.drawing[\s\S]*?warmLiveInkLayer\(\)/);
  assert.match(fitCanvas, /if \(liveInkResized\) liveInkNeedsWarmup = true[\s\S]*?scheduleLiveInkLayerWarmup\(\)/);
  assert.match(captureInput, /const inputTransform = captureDrawingTransform\(\)[\s\S]*?drawingClientPoint\(\{ inputTransform \}, event\)/);
  assert.match(pointerDown, /const input = captureDrawingInput\(e\)[\s\S]*?beginCanvasPointerAction\(e, input\.point, \{ inputTransform:input\.inputTransform \}\)/);
  assert.doesNotMatch(activeDrawing, /requestAnimationFrame|requestRender\(|renderInkLayer\(|coords\.textContent/);
  assert.doesNotMatch(pointerMove, /requestRender\(\)/);
  assert.match(finishDrawing, /commitLiveInkDrawing\(d\)[\s\S]*?state\.drawing = null[\s\S]*?scheduleLiveInkLayerWarmup\(\)[\s\S]*?saveUserCanvasChange\(\)[\s\S]*?requestInteractionLayerRender\(\)/);
  assert.doesNotMatch(app, /function requestInkLayerRender/);
});

test("hand panning and Canvas zoom preview content on the compositor before the exact redraw", () => {
  const app = read("public/app.js"), css = read("public/style.css"),
    pointerMove = app.slice(app.indexOf('screen.addEventListener("pointermove"'), app.indexOf("function end(e)")),
    moveCanvasSource = functionSource(app, "moveCanvas"),
    zoomCanvasSource = functionSource(app, "zoomCanvasAt"),
    pinchCanvasSource = functionSource(app, "updateTouchGesture"),
    previewTransform = functionSource(app, "canvasNavigationPreviewTransform"),
    previewDisplacement = functionSource(app, "canvasNavigationPreviewDisplacement"),
    applyPreview = functionSource(app, "applyCanvasNavigationPreview"),
    resetPreview = functionSource(app, "resetCanvasNavigationPreview"),
    finishPreview = functionSource(app, "finishCanvasNavigationPreview"),
    requestPreview = functionSource(app, "requestCanvasNavigationPreview"),
    previewStep = functionSource(app, "canvasNavigationPreviewStep"),
    widgetCarrier = functionSource(app, "syncCanvasWidgetCarrier"),
    viewportMetrics = functionSource(app, "canvasViewportMetrics"),
    renderContent = functionSource(app, "renderCanvasContent"),
    endSource = functionSource(app, "end"),
    panFastPath = pointerMove.indexOf('if (state.panGesture?.id === e.pointerId && (e.pointerType !== "touch" || state.touches.size < 2))'),
    handFocusWork = pointerMove.indexOf("updateHandObjectFocus(e)");
  assert.match(moveCanvasSource, /previousPanX = state\.panX[\s\S]*?previousPanY = state\.panY[\s\S]*?requestCanvasNavigationPreview\(previousPanX, previousPanY\)/);
  assert.match(zoomCanvasSource, /previousScale = state\.scale[\s\S]*?requestCanvasNavigationPreview\(previousPanX, previousPanY, previousScale\)/);
  assert.match(pinchCanvasSource, /previousScale = state\.scale[\s\S]*?requestCanvasNavigationPreview\(previousPanX, previousPanY, previousScale\)/);
  assert.match(viewportMetrics, /if \(canvasViewportMetricsCache\) return canvasViewportMetricsCache[\s\S]*?requestAnimationFrame[\s\S]*?canvasViewportMetricsCache = null/);
  assert.doesNotMatch(moveCanvasSource, /requestRender\(|render\(/);
  assert.doesNotMatch(zoomCanvasSource, /requestRender\(|\brender\(/);
  assert.doesNotMatch(pinchCanvasSource, /requestRender\(|\brender\(/);
  assert.doesNotMatch(requestPreview, /applyCanvasNavigationPreview\(\)/);
  assert.match(requestPreview, /noteCanvasChromeInteraction\(\);[\s\S]*?noteCanvasAgentNavigation\(\);/);
  assert.match(requestPreview, /view\.classList\.add\("canvas-navigation-previewing"\)[\s\S]*?setTimeout\(finishCanvasNavigationPreview, CANVAS_NAVIGATION_SETTLE_MS\)[\s\S]*?requestAnimationFrame\(canvasNavigationPreviewStep\)/);
  assert.match(previewTransform, /scale = state\.scale \/ canvasNavigationPreviewScale[\s\S]*?x:state\.panX - canvasNavigationPreviewPanX \* scale[\s\S]*?y:state\.panY - canvasNavigationPreviewPanY \* scale/);
  assert.match(previewDisplacement, /canvasNavigationPreviewViewportWidth \* scaleDelta[\s\S]*?canvasNavigationPreviewViewportHeight \* scaleDelta/);
  assert.match(applyPreview, /canvasNavigationPreviewTransform\(\)[\s\S]*?--canvas-navigation-preview-scale[\s\S]*?--canvas-navigation-preview-paper[\s\S]*?state\.paint\.paper/);
  assert.match(applyPreview, /syncCanvasWidgetCarrier\(scale\)/);
  assert.match(finishPreview, /render\(\)[\s\S]*?refreshVisibleTextBoxQuality\(\)/);
  assert.match(previewStep, /applyCanvasNavigationPreview\(\)[\s\S]*?requestCoordinatesUpdate\(\)[\s\S]*?canvasNavigationPreviewDisplacement\(\)[\s\S]*?displacement\.x[\s\S]*?displacement\.y[\s\S]*?render\(\)[\s\S]*?refreshVisibleTextBoxQuality\(\)/);
  assert.doesNotMatch(previewStep, /state\.panX - canvasNavigationPreviewPanX|state\.panY - canvasNavigationPreviewPanY/);
  assert.match(functionSource(app, "updateCoordinates"), /coords\.textContent !== text[\s\S]*?coords\.textContent = text/);
  assert.doesNotMatch(previewStep, /CANVAS_NAVIGATION_EXACT_FRAME_MS|now\s*-/);
  assert.doesNotMatch(previewStep, /renderCanvasBackground\(|renderCanvasContent\(/);
  assert.match(endSource, /finishCanvasNavigationPreview\(\)/);
  assert.match(renderContent, /resetCanvasNavigationPreview\(\)[\s\S]*?renderPlacedContentLayer\(visible\)[\s\S]*?renderInkLayer\(visible\)[\s\S]*?positionWidgets\(\)/);
  assert.ok(panFastPath >= 0 && panFastPath < handFocusWork, "an active pan must bypass object-focus and hover work");
  assert.match(css, /\.widget-layer\s*\{[^}]*overflow:\s*visible[^}]*translate3d\(var\(--canvas-widget-pan-x[^}]*scale\(var\(--canvas-widget-preview-scale[^}]*transform-origin:\s*0 0/);
  assert.match(css, /#viewport\.canvas-navigation-previewing \.widget-layer\s*\{[^}]*will-change:\s*transform/);
  assert.match(css, /#viewport\.canvas-navigation-previewing :is\(#screen,[^}]*\.placed-content-layer[^}]*\.ink-layer[^}]*\)[^{]*\{[^}]*translate3d\(var\(--canvas-navigation-preview-x[^}]*scale\(var\(--canvas-navigation-preview-scale[^}]*transform-origin:\s*0 0[^}]*will-change:\s*transform/);
  assert.doesNotMatch(css, /#viewport\.canvas-navigation-previewing :is\([^}]*\.widget-layer/);
  assert.match(css, /#coords\s*\{[^}]*contain:\s*layout paint/);
  assert.match(css, /body\[data-theme="studio"\]:has\(#viewport:is\(\.canvas-chrome-lightweight, \.is-drawing\)\) \.toolbar\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--studio-toolbar\) 88%, transparent\)[^}]*backdrop-filter:\s*none/);
  const state = { scale:1, panX:-10000, panY:-8000, navigationLocked:false, renderQueued:false, paint:{ paper:"#fafafa" } }, classes = new Set(), properties = new Map(), frames = [], timers = new Map(), counts = { coordinates:0, animation:0, exact:0, quality:0 },
    harness = vm.runInNewContext(`(() => {
      const CANVAS_NAVIGATION_SETTLE_MS = 80, CANVAS_NAVIGATION_REBASE_VIEWPORT_RATIO = 0.60, CANVAS_NAVIGATION_REBASE_MIN_PX = 192;
      let canvasNavigationPreviewFrame = 0, canvasNavigationPreviewSettleTimer = 0, canvasNavigationPreviewPanX = 0, canvasNavigationPreviewPanY = 0, canvasNavigationPreviewScale = 1, canvasNavigationPreviewViewportWidth = 0, canvasNavigationPreviewViewportHeight = 0;
      let canvasNavigationPreviewRebaseX = CANVAS_NAVIGATION_REBASE_MIN_PX, canvasNavigationPreviewRebaseY = CANVAS_NAVIGATION_REBASE_MIN_PX;
      let canvasWidgetCarrierPanX = Number.NaN, canvasWidgetCarrierPanY = Number.NaN, canvasWidgetCarrierPreviewScale = Number.NaN, canvasTextQualityGeneration = 0;
      ${widgetCarrier}
      ${previewTransform}
      ${previewDisplacement}
      ${applyPreview}
      ${resetPreview}
      function render() { counts.exact++; resetCanvasNavigationPreview(); }
      function refreshVisibleTextBoxQuality() { counts.quality++; return Promise.resolve(true); }
      ${finishPreview}
      ${previewStep}
      ${requestPreview}
      ${moveCanvasSource}
      ${zoomCanvasSource}
      return { moveCanvas, zoomCanvasAt, finishCanvasNavigationPreview };
    })()`, {
      state,
      view:{ clientWidth:1000, clientHeight:800, classList:{ add:value=>classes.add(value), remove:value=>classes.delete(value), contains:value=>classes.has(value) } },
      runtimeElementStyle:()=>({ setProperty:(name,value)=>properties.set(name,value) }),
      requestAnimationFrame:callback=>(frames.push(callback),frames.length),
      cancelAnimationFrame:()=>{},
      setTimeout:callback=>{const id=timers.size+1;timers.set(id,callback);return id;},
      clearTimeout:id=>timers.delete(id),
      canvasClientDelta:(x,y)=>({ x,y }),
      canvasClientPosition:(x,y)=>({ x,y }),
      canvasViewportMetrics:()=>({ width:1000, height:800 }),
      noteCanvasChromeInteraction:()=>{},
      noteCanvasAgentNavigation:()=>{},
      requestCoordinatesUpdate:()=>counts.coordinates++,
      flushCoordinatesUpdate:()=>counts.coordinates++,
      requestAnimationLayerRender:()=>counts.animation++,
      setNavigating:()=>{},
      wheelNavigating:()=>{},
      counts,
    });
  assert.equal(harness.moveCanvas(6,-4),true);
  assert.deepEqual({ panX:state.panX, panY:state.panY },{ panX:-9994, panY:-8004 });
  assert.ok(classes.has("canvas-navigation-previewing"));
  frames.shift()(110);
  assert.equal(properties.get("--canvas-navigation-preview-x"),"6px");
  assert.equal(properties.get("--canvas-navigation-preview-y"),"-4px");
  assert.equal(properties.get("--canvas-navigation-preview-scale"),"1");
  assert.equal(properties.get("--canvas-navigation-preview-paper"),"#fafafa");
  assert.equal(properties.get("--canvas-widget-pan-x"),"-9994px");
  assert.equal(properties.get("--canvas-widget-pan-y"),"-8004px");
  assert.equal(properties.get("--canvas-widget-preview-scale"),"1");
  assert.deepEqual(counts,{ coordinates:1, animation:1, exact:0, quality:0 });
  assert.equal(frames.length,0);
  assert.equal(harness.moveCanvas(700,0),true);
  frames.shift()(140);
  assert.deepEqual(counts,{ coordinates:2, animation:2, exact:1, quality:1 });
  assert.ok(!classes.has("canvas-navigation-previewing"));
  assert.equal(harness.moveCanvas(8,3),true);
  assert.equal(harness.finishCanvasNavigationPreview(),true);
  assert.deepEqual(counts,{ coordinates:3, animation:2, exact:2, quality:2 });
  frames.length = 0;
  assert.equal(harness.zoomCanvasAt(100,100,-Math.log(1.12) / .002),true);
  frames.shift()(180);
  assert.ok(Math.abs(Number.parseFloat(properties.get("--canvas-navigation-preview-x")) + 12) < 1e-9);
  assert.ok(Math.abs(Number.parseFloat(properties.get("--canvas-navigation-preview-y")) + 12) < 1e-9);
  assert.ok(Math.abs(Number(properties.get("--canvas-navigation-preview-scale"))-1.12)<1e-9);
  assert.ok(Math.abs(Number(properties.get("--canvas-widget-preview-scale"))-1.12)<1e-9);
  assert.equal(counts.exact,2,"far-away Canvas origins must not trigger an exact redraw for a small visible zoom step");
  assert.equal(harness.finishCanvasNavigationPreview(),true);
  assert.deepEqual(counts,{ coordinates:6, animation:3, exact:3, quality:3 });
});

test("canvas file actions are in the top-right header and available in History", () => {
  const html = read("public/index.html"), app = read("public/app.js"), css = read("public/style.css");
  const topRow = html.indexOf('class="top-row"'), toolbar = html.indexOf('class="toolbar"'), files = html.indexOf('id="canvasFileActions"');
  assert.ok(topRow < files && files < toolbar);
  assert.ok(html.indexOf('id="newCanvasBtn"') < html.indexOf('id="exportPngBtn"'));
  assert.ok(html.indexOf('id="exportPngBtn"') < html.indexOf('id="historyBtn"'));
  assert.doesNotMatch(html, /id="tourReplayBtn"/);
  assert.match(html, /id="settingsBtn"[^>]*aria-controls="settingsPanel"[\s\S]*?<svg[^>]*viewBox="0 0 24 24"/);
  assert.match(css, /\.canvas-file-actions button,\s*#settingsBtn\s*\{[^}]*display:\s*grid;[^}]*width:\s*29px;[^}]*flex:\s*0 0 29px/);
  assert.match(css, /\.canvas-file-actions button svg,\s*#settingsBtn svg\s*\{[^}]*fill:\s*none;[^}]*stroke:\s*currentColor/);
  assert.match(css, /body\[data-theme="studio"\] :is\(\.top-row, \.toolbar\) \[data-pe-button="toolbar"\]\) > svg\s*\{[^}]*width:\s*16px;[^}]*height:\s*16px;[^}]*flex-basis:\s*16px/);
  assert.match(css, /@media \(pointer: fine\)\s*\{[\s\S]*?body\[data-theme="studio"\] \.top-row \[data-pe-button="toolbar"\]\)\s*\{[^}]*margin-inline:\s*2px;[\s\S]*?body\[data-theme="studio"\] \.top-row \[data-pe-button="toolbar"\]\)::after\s*\{[^}]*inset-inline:\s*-2px/);
  assert.match(css, /--pe-icon-button-h:\s*28px/);
  for (const id of ["historySaveCurrent", "newCanvasDialog", "newDiscard", "newSaveCopy", "newOverwrite", "saveCanvasBtn"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /id="currentSnapshotLabel"[^>]*hidden/);
  assert.match(css, /\.new-canvas-dialog \.current-snapshot\[hidden\]\s*\{\s*display:\s*none/);
  for (const id of ["historyNew", "newCanvasCancel"]) assert.doesNotMatch(html, new RegExp(`id="${id}"`));
  assert.match(html, /class="new-canvas-actions"[\s\S]*?id="newDiscard"[\s\S]*?class="new-canvas-action-group"[\s\S]*?id="newOverwrite"[\s\S]*?id="newSaveCopy"/);
  assert.match(css, /\.new-canvas-actions\s*\{[^}]*align-items:\s*center;[^}]*justify-content:\s*space-between/);
  assert.match(css, /\.new-canvas-action-group\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*flex-end/);
  assert.doesNotMatch(css, /\.new-canvas-actions\s*\{[^}]*grid-template-columns:\s*1fr 1fr/);
  assert.match(app, /currentSnapshotId:\s*null/);
  assert.match(app, /saveSnapshot\(\{\s*overwriteId\s*=\s*null,\s*name\s*=\s*null,\s*location\s*=\s*state\.snapshotLocation,\s*allowEmpty\s*=\s*false\s*\}/);
  assert.match(app, /completeNewCanvas\("overwrite"\)/);
  assert.match(app, /function startBlankCanvas\(\)/);
  assert.match(functionSource(app, "startBlankCanvas"), /clearTextEditors\(\)/);
  assert.match(functionSource(app, "startBlankCanvas"), /state\.aiDraftReturnMode = null[\s\S]*?setCanvasNavigationLocked\(false\)[\s\S]*?resetCanvasDefaultMode\(\)/);
  assert.match(functionSource(app, "loadSnapshot"), /clearTextEditors\(\)/);
  assert.match(functionSource(app, "loadHistorySnapshot"), /runSnapshotLoadAction\(button, \(\) => requestLoadSnapshot\(item\.id, location\)\)/);
  assert.match(functionSource(app, "runSnapshotLoadAction"), /if \(button\.disabled\) return;[\s\S]*?button\.disabled = true[\s\S]*?await runSnapshotAction\(action\)[\s\S]*?button\.disabled = false/);
});

test("canvas connection editor uses editable Kimi and MiniMax presets without connection names", () => {
  const html = read("public/index.html"), app = read("public/app.js"), css = read("public/style.css"), zh = read("public/locales/zh.js");
  assert.doesNotMatch(html, /id="settingsConnectionName"|name="connectionName"/);
  for (const value of ["openai", "anthropic", "kimi", "minimax"]) {
    assert.match(html, new RegExp(`<option value="${value}"`));
  }
  assert.match(html, /id="settingsApiPresetFields"[^>]*hidden/);
  assert.match(html, /id="settingsApiRegion"/);
  assert.match(html, /id="settingsApiService"/);
  assert.match(html, /id="settingsApiModel"[^>]*list="settingsApiModelPresets"/);
  const effortInput = html.match(/<input id="settingsEffort"[^>]*>/)?.[0] || "",
    effortOptions = html.match(/<div id="settingsEffortOptions"[\s\S]*?<\/div>/)?.[0] || "";
  assert.match(effortInput, /role="combobox"/);
  assert.match(effortInput, /aria-controls="settingsEffortOptions"/);
  assert.match(effortInput, /aria-expanded="false"/);
  assert.match(effortInput, /autocomplete="off"/);
  assert.match(effortInput, /spellcheck="false"/);
  assert.match(effortInput, /required/);
  assert.match(html, /id="settingsEffortToggle"[^>]*aria-haspopup="listbox"[^>]*aria-controls="settingsEffortOptions"/);
  assert.match(effortOptions, /role="listbox"[^>]*hidden/);
  assert.doesNotMatch(effortOptions, /Provider default|Extra high|Maximum|>None<|>Low<|>Medium<|>High</);
  for (const effort of ["none", "low", "medium", "high", "xhigh", "max"]) assert.match(effortOptions, new RegExp(`data-effort-value="${effort}"[^>]*>${effort}</button>`));
  assert.match(functionSource(app, "showSettingsEffortOptions"), /hidden = false[\s\S]*aria-expanded/);
  assert.match(functionSource(app, "chooseSettingsEffort"), /settingsEffort\.value = String\(value/);
  assert.match(functionSource(app, "handleSettingsEffortKeydown"), /Escape[\s\S]*ArrowDown/);
  assert.match(html, /data-effort="config"[^>]*>[\s\S]*?Configured/);
  assert.match(html, /id="settingsTestConnection"[^>]*data-i18n="settingsTestConnection"/);
  assert.match(html, /id="settingsInstallCli"[^>]*hidden[^>]*data-i18n="settingsInstallCli"/);
  assert.match(html, /id="settingsCliPath"[^>]*type="hidden"/);
  assert.doesNotMatch(html, /<label><span data-i18n="settingsCliPath"/);
  for (const id of ["settingsCliStatus", "settingsCliStatusTitle", "settingsCliStatusDetail", "settingsCliCommandRow", "settingsCliCommand", "settingsCliCopyCommand"]) assert.match(html, new RegExp(`id="${id}"`));
  for (const endpoint of [
    "https://api.moonshot.ai/v1", "https://api.moonshot.cn/v1", "https://api.kimi.com/coding/v1",
    "https://api.minimax.io/v1", "https://api.minimax.io/anthropic", "https://api.minimaxi.com/v1", "https://api.minimaxi.com/anthropic",
  ]) assert.match(app, new RegExp(endpoint.replaceAll(".", "\\.")));
  for (const model of ["k3", "kimi-k3", "MiniMax-M3", "MiniMax-M2.7"]) assert.match(app, new RegExp(`"${model.replaceAll(".", "\\.")}"`));
  assert.match(app, /function connectionTitle\(connection\)/);
  assert.match(app, /const title = connection\.provider === "api" \? connection\.apiModel \|\| "API" : connection\.cliModel/);
  assert.match(functionSource(app, "renderConnectionLists"), /settings-connection-quick\$\{connection\.active \? " active" : ""\}[\s\S]*?editing = settings\.editingConnectionId === connection\.id[\s\S]*?settings-connection-item\$\{editing \? " editing" : ""\}/);
  assert.match(functionSource(app, "fillConnectionEditor"), /settings\.editingConnectionId = connection\?\.id \|\| null[\s\S]*?renderConnectionLists\(\)/);
  assert.match(functionSource(app, "hideConnectionEditor"), /settings\.editingConnectionId = null[\s\S]*?renderConnectionLists\(\)/);
  assert.match(functionSource(app, "defaultConnectionEffort"), /return "medium"/);
  assert.match(functionSource(app, "fillConnectionEditor"), /connection\?\.effort \|\| defaultConnectionEffort\(provider\)/);
  assert.match(functionSource(app, "testCanvasConnection"), /\/api\/settings\/connections\/test[\s\S]*?settings\.editingConnectionId[\s\S]*?body\?\.installable/);
  assert.match(functionSource(app, "installCanvasCli"), /penechoDesktop\.installCli\(provider\)[\s\S]*?settingsCliPath\.value = result\.executable[\s\S]*?testCanvasConnection\(\)/);
  assert.match(functionSource(app, "updateSettingsProviderFields"), /inspectCanvasCli\(provider\)/);
  assert.match(functionSource(app, "inspectCanvasCli"), /\/api\/settings\/connections\/inspect-cli[\s\S]*?renderCanvasCliStatus\(body\.status\)/);
  assert.match(functionSource(app, "renderCanvasCliStatus"), /status\.state === "missing"[\s\S]*?showCliCommand\(status\.installCommand\)[\s\S]*?showCliInstaller\(status\.provider, true\)/);
  assert.match(functionSource(app, "installCanvasCli"), /settingsCliManualFallback/);
  assert.match(functionSource(app, "copyCanvasCliCommand"), /writeClipboardText\(command\)/);
  assert.match(html, /id="settingsKimiCliRecommendation"[^>]*role="note"[^>]*hidden/);
  assert.match(html, /https:\/\/api\.kimi\.com\/coding\/v1[\s\S]*?https:\/\/www\.kimi\.com\/code\/console/);
  assert.match(functionSource(app, "updateSettingsProviderFields"), /settingsKimiCliRecommendation\.hidden = provider !== "kimi-cli"/);
  assert.match(css, /\.settings-provider-notice\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(css, /\.settings-cli-status\[data-state="missing"\]/);
  assert.match(css, /\.settings-cli-command code\s*\{/);
  for (const key of ["settingsCliChecking", "settingsCliMissing", "settingsCliCopyCommand", "settingsCliManualFallback"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
  for (const key of ["settingsKimiCodingRecommendationTitle", "settingsKimiCodingRecommendationBody", "settingsKimiCodingConsole", "settingsKimiCodingRecommendationReason"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
  assert.match(css, /\.settings-connection-item\.editing\s*\{/);
  assert.match(css, /\.settings-combobox-toggle\s*\{[^}]*position:\s*absolute[^}]*cursor:\s*pointer/);
  assert.match(css, /\.settings-combobox-options\s*\{[^}]*position:\s*absolute[^}]*z-index:\s*12/);
  assert.doesNotMatch(css, /\.settings-connection-item\.active\s*\{/);
  assert.match(css, /\.settings-panel, \.configuration-panel\s*\{[^}]*color-scheme:\s*light[^}]*--panel-raised:\s*var\(--studio-panel/);
  assert.match(css, /\.settings-save\s*\{[^}]*color:\s*#fff;[^}]*background:\s*var\(--gold\)/);
  assert.match(css, /\.connection-manager > header button\s*\{[^}]*height:\s*32px[^}]*color:\s*var\(--ink\)[^}]*background:\s*transparent/);
  assert.match(html, /id="summonToggleLabel"[^>]*data-i18n="settingsSummonSection"/);
  assert.doesNotMatch(html, /settingsSummonEnabled|settingsSummonDescription/);
  assert.equal((html.match(/class="settings-links"/g) || []).length, 1, "web Settings keeps the download and GitHub links");
  assert.match(app, /if \(window\.penechoDesktop\) document\.querySelector\("\.settings-links"\)\?\.remove\(\)/);
  assert.doesNotMatch(css, /body\[data-theme="(?:studio|research|arcane|scifi)"\] \.settings-panel/);
  for (const key of ["settingsApiRegion", "settingsApiService", "settingsApiServiceCoding"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
});

test("API connection models can be fetched into an editable dropdown", () => {
  const html = read("public/index.html"), core = read("src/client/app/core.js"), bootstrap = read("src/client/app/ui-bootstrap.js"), app = read("public/app.js"), css = read("public/style.css"), zh = read("public/locales/zh.js");
  const format = html.indexOf('id="settingsApiFormat"'), url = html.indexOf('id="settingsApiUrl"'), key = html.indexOf('id="settingsApiKey"'), model = html.indexOf('id="settingsApiModel"'), fetchButton = html.indexOf('id="settingsFetchModels"');
  assert.ok(format > -1 && format < url && url < key && key < model && model < fetchButton);
  assert.match(html, /id="settingsApiModel"[^>]*list="settingsApiModelPresets"[^>]*role="combobox"[^>]*aria-controls="settingsApiModelOptions"/);
  assert.match(html, /id="settingsApiModelOptions"[^>]*role="listbox"[^>]*hidden/);
  assert.match(html, /id="settingsFetchModels"[^>]*aria-busy="false/);
  assert.match(html, /<span data-i18n="settingsFetchModels">Fetch models<\/span>/);
  assert.match(functionSource(core, "fetchConnectionModels"), /connectionEditorPayload\(\)[\s\S]*?\/api\/settings\/connections\/models[\s\S]*?id:settings\.editingConnectionId/);
  assert.match(functionSource(core, "fetchConnectionModels"), /settings\.fetchedApiModels = normalizeFetchedApiModels[\s\S]*?if \(!settingsApiModel\.value\.trim\(\)/);
  assert.match(functionSource(core, "fetchConnectionModels"), /requestSignature[\s\S]*?connectionModelDiscoverySignature\(\)[\s\S]*?setSettingsStatus\(\)[\s\S]*?return/);
  assert.match(functionSource(core, "normalizeFetchedApiModels"), /\.sort\(\(a, b\)/);
  assert.match(functionSource(core, "updateConnectionModelFetchState"), /aria-busy[\s\S]*settingsFetchingModels/);
  assert.match(core, /API_DEFAULTS = Object\.freeze\(\{[\s\S]*?openai:[\s\S]*?https:\/\/api\.openai\.com\/v1[\s\S]*?anthropic:[\s\S]*?https:\/\/api\.anthropic\.com/);
  assert.match(functionSource(core, "updateApiPresetFields"), /selectedApiPreset\(\) \|\| API_DEFAULTS\[family\][\s\S]*?settingsApiUrl\.value = defaults\.url/);
  assert.match(functionSource(core, "handleApiModelKeydown"), /Escape[\s\S]*ArrowDown/);
  assert.match(bootstrap, /settingsFetchModels\?\.addEventListener\("click"[^\n]*fetchConnectionModels/);
  assert.match(bootstrap, /settingsApiModelOptions\?\.addEventListener\("click"[\s\S]*?chooseApiModel/);
  assert.match(css, /\.settings-model-control\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto/);
  assert.match(css, /\.settings-fetch-models\s*\{[^}]*height:\s*36px[^}]*white-space:\s*nowrap/);
  assert.match(css, /\.settings-combobox-options\[hidden\]\s*\{\s*display:\s*none/);
  for (const keyName of ["settingsFetchModels", "settingsFetchingModels", "settingsModelsFetched", "settingsModelFetchFailed", "settingsModelSuggestions"]) {
    assert.match(core, new RegExp(`${keyName}:`));
    assert.match(zh, new RegExp(`${keyName}:`));
  }
  assert.equal(app, require("../scripts/build-client.js").compiledSource(), "public/app.js must match client sources");
});

test("System settings number fields hide spinners and enforce their intended precision", () => {
  const html = read("public/index.html"), css = read("public/style.css");
  for (const id of ["settingsMaxTokens", "settingsAgentTurnLimit", "settingsTimeout", "settingsTraceLimit"]) {
    const input = html.match(new RegExp(`<input id="${id}"[^>]*>`))?.[0] || "";
    assert.match(input, /type="number"/);
    assert.match(input, /step="1"/);
  }
  const turnLimit = html.match(/<input id="settingsAgentTurnLimit"[^>]*>/)?.[0] || "";
  assert.match(turnLimit, /min="50"/);
  assert.doesNotMatch(turnLimit, /\bmax=/);
  assert.match(html.match(/<input id="settingsAutoDelay"[^>]*>/)?.[0] || "", /step="0\.1"/);
  assert.match(css, /\.settings-system-group input\[type="number"\]\s*\{[^}]*appearance:\s*textfield;[^}]*-moz-appearance:\s*textfield/);
  assert.match(css, /\.settings-system-group input\[type="number"\]::\-webkit-inner-spin-button,[\s\S]*?::\-webkit-outer-spin-button\s*\{[^}]*-webkit-appearance:\s*none;[^}]*appearance:\s*none/);
});

test("closing Settings moves focus outside before hiding it from accessibility APIs", () => {
  const closeSettings = functionSource(read("public/app.js"), "closeSettings");
  const focusMove = closeSettings.indexOf("settingsLayer.contains(document.activeElement)");
  const hideLayer = closeSettings.indexOf("settingsLayer.hidden = true");
  const hideFromAccessibility = closeSettings.indexOf('settingsLayer.setAttribute("aria-hidden", "true")');
  assert.ok(focusMove >= 0 && focusMove < hideLayer && hideLayer < hideFromAccessibility);
  assert.match(closeSettings, /restoreTarget\?\.focus\(\{ preventScroll:true \}\)/);
});

test("canvas photos and function plots use editable image records, unified top toolbars, and dirty Auto AI", () => {
  const html = read("public/index.html"), app = read("public/app.js"), zh = read("public/locales/zh.js"), css = read("public/style.css"), server = read("src/server/main.js"),
    end = functionSource(app, "end"),
    save = functionSource(app, "save"),
    loadSnapshot = functionSource(app, "loadSnapshot"),
    startBlankCanvas = functionSource(app, "startBlankCanvas"),
    renderExportCanvas = functionSource(app, "renderExportCanvas"),
    snapshotPreview = functionSource(app, "snapshotPreview"),
    prepareImportedImage = functionSource(app, "prepareImportedImage");

  assert.match(html, /id="imagePickerBtn"/);
  assert.match(html, /id="imagePickerInput" type="file" accept="image\/\*" hidden/);
  assert.doesNotMatch(html, /id="imagePickerInput"[^>]*\bcapture\b/);
  assert.match(app, /MAX_VISIBLE_IMAGES = 100/);
  assert.match(app, /MAX_IMAGE_DIMENSION = 2048/);
  assert.match(prepareImportedImage, /scale = Math\.min\(1, MAX_IMAGE_DIMENSION \/ sourceW, MAX_IMAGE_DIMENSION \/ sourceH/);
  assert.match(app, /function canvasIdentityGeneration\(\)/);
  assert.match(app, /function beginCanvasPointerAction\(e, point\)/);
  assert.doesNotMatch(app, /beginImageTouchHold|imageTouchHold|IMAGE_TOUCH_HOLD/);
  assert.match(app, /beginCanvasObjectSelection[\s\S]{0,180}?captureDrawingInput\(e\)[\s\S]{0,180}?beginCanvasPointerAction\(e, input\.point, \{ inputTransform:input\.inputTransform \}\)/);
  assert.match(functionSource(app, "objectChromeSpecs"), /target:"image"/);
  const mergeImage = functionSource(app, "mergeImage"),
    beginImageGesture = functionSource(app, "beginImageGesture"),
    addImageFile = functionSource(app, "addImageFile"),
    imageControlHit = functionSource(app, "imageControlHit"),
    imageRecord = functionSource(app, "imageRecord"),
    imageHistoryRecord = functionSource(app, "imageHistoryRecord"),
    storedImageRecord = functionSource(app, "storedImageRecord"),
    resizeImageBox = functionSource(app, "resizeImageBox"),
    drawImageChrome = functionSource(app, "drawImageChrome"),
    renderInteractionLayer = functionSource(app, "renderInteractionLayer"),
    resizeImage = vm.runInNewContext(`(${resizeImageBox})`, { SIZE:20000 }),
    resizeStart = { x:100, y:200, w:1200, h:800 };
  assert.doesNotMatch(addImageFile, /requestAI|buildViewportImage/);
  assert.match(addImageFile, /state\.dirtyImageIds\.add\(item\.id\)[\s\S]*?recomputeDirtyBounds\(\)[\s\S]*?state\.autoEligible = true/);
  assert.match(functionSource(app, "viewportHasWidgetRefineInput"), /state\.dirty && visible && intersection\(state\.dirty, visible\)/);
  assert.match(functionSource(app, "beginWidgetRefineConfirmation"), /dirtyBox = state\.dirty && visible \? intersection\(state\.dirty, visible\) : null/);
  assert.match(functionSource(app, "requestWidgetRefinement"), /attentionBox:refineInputBox/);
  assert.match(addImageFile, /enterManualImageHandMode\(\)[\s\S]{0,80}?beginImageEdit\(item\)[\s\S]{0,80}?showHandObjectToolbar\("image", item\)/);
  assert.match(functionSource(app, "finishManualImageHandMode"), /imageHandReturnMode/);
  for (const name of ["acceptImageEdit", "cancelImageEdit", "deleteImage", "mergeImage"]) {
    assert.match(functionSource(app, name), /finishManualImageHandMode\(\)/);
  }
  assert.doesNotMatch(beginImageGesture, /result\.hit === "(accept|merge|cancel)"/);
  assert.match(mergeImage, /recordBefore\(tx, ty\)[\s\S]{0,160}?drawImage\(item\.image/);
  assert.match(mergeImage, /extendInkBounds\(key\(tx, ty\)/);
  assert.match(mergeImage, /state\.images\.filter/);
  assert.match(mergeImage, /trackMergedImageAsDirty\(item, box\)[\s\S]*?recomputeDirtyBounds\(\)[\s\S]*?state\.autoEligible\s*=\s*true[\s\S]*?saveUserCanvasChange\(\)[\s\S]*?schedule\(\)/);
  assert.doesNotMatch(imageControlHit, /draftActionPoints|merge/);
  assert.doesNotMatch(drawImageChrome, /drawDraftActions|drawImageMergeAction/);
  assert.deepEqual({ ...resizeImage(resizeStart, { x:15100, y:0 }, "width") }, { ...resizeStart, w:15000 });
  assert.deepEqual({ ...resizeImage(resizeStart, { x:0, y:15200 }, "height") }, { ...resizeStart, h:15000 });
  assert.deepEqual({ ...resizeImage(resizeStart, { x:15100, y:10200 }, "resize") }, { ...resizeStart, w:15000, h:10000 });
  assert.deepEqual({ ...resizeImage(resizeStart, { x:100, y:200 }, "resize") }, { ...resizeStart, w:120, h:80 }, "diagonal shrinking preserves aspect ratio and the minimum height");
  const portraitStart = { x:100, y:200, w:800, h:1200 };
  assert.deepEqual({ ...resizeImage(portraitStart, { x:100, y:200 }, "resize") }, { ...portraitStart, w:80, h:120 }, "portrait shrinking preserves aspect ratio and the minimum width");
  const edgeStart = { x:18800, y:19200, w:600, h:400 };
  assert.deepEqual({ ...resizeImage(edgeStart, { x:22000, y:22000 }, "resize") }, { ...edgeStart, w:1200, h:800 }, "diagonal enlargement stays inside the canvas");
  assert.doesNotMatch(resizeImageBox, /6000|MAX_IMAGE_PIXELS/);
  assert.doesNotMatch(imageRecord, /n\(item\.(?:w|h), 80, 6000\)|item\.w \* item\.h > MAX_IMAGE_PIXELS/);
  assert.match(imageRecord, /plotExpression = typeof item\.plotExpression === "string" \? item\.plotExpression\.trim\(\) : ""/);
  assert.match(imageRecord, /plotExpression\.length > 180/);
  assert.match(imageHistoryRecord, /plotExpression:item\.plotExpression/);
  assert.match(storedImageRecord, /plotExpression:item\.plotExpression/);
  assert.match(functionSource(server, "canonicalSharedCanvasV1"), /image\.plotExpression!==undefined[\s\S]*?plotExpression:image\.plotExpression\.trim\(\)/);
  for (const id of ["imageEditBar", "imageMergeBtn", "imagePlaceBtn", "imageDeleteBtn"]) assert.doesNotMatch(html, new RegExp(`id="${id}"`));
  assert.doesNotMatch(css, /\.image-edit-bar \{|\.image-action-hint \{/);
  assert.match(app, /function positionImageSelectionMaterial\(\)/);
  assert.match(functionSource(app, "positionImageSelectionMaterial"), /imageSelectionMaterial\.hidden = true[\s\S]*?--image-selection-x[\s\S]*?--image-selection-height/);
  assert.match(renderInteractionLayer, /positionImageSelectionMaterial\(\)/);
  const imageChrome = functionSource(app, "objectChromeSpecs");
  assert.match(imageChrome, /record\.kind === "image"[\s\S]*?addObjectToolbarSpecs\(specs, \{[\s\S]*?cancelLabel:t\("imageDelete"\)[\s\S]*?acceptLabel:t\("imagePlace"\)[\s\S]*?acceptTooltip:t\("imagePlaceHint"\)[\s\S]*?deleteImage\(handTarget\)[\s\S]*?acceptImageEdit\(\{ showHint:true \}\)/);
  assert.match(imageChrome, /kind:"merge"[\s\S]*?label:t\("imageMerge"\)[\s\S]*?tooltip:t\("imageMergeHint"\)[\s\S]*?objectToolbarItem:true[\s\S]*?mergeImage\(handTarget, \{ showHint:true \}\)/);
  assert.match(imageChrome, /plotExpression[\s\S]*?kind:"copy"[\s\S]*?copyPlotExpression\(handTarget\)[\s\S]*?else \{[\s\S]*?kind:"merge"/);
  assert.match(functionSource(app, "syncObjectChrome"), /button\.setAttribute\("aria-label", copyConfirmed \? t\("widgetSourceCopied"\) : label\)[\s\S]*?spec\.kind === "refine" \|\| spec\.objectToolbar\) button\.removeAttribute\("title"\)[\s\S]*?button\.title = spec\.tooltip \|\| label/);
  assert.match(app, /images = storedImages\(\)/);
  assert.match(loadSnapshot, /decodeSnapshotImagesInBatches\(item\.images, loadIsCurrent/);
  assert.match(loadSnapshot, /restoreImages\(images\)/);
  assert.match(startBlankCanvas, /restoreImages\(\[\]\)/);
  assert.match(save, /imagesBefore[\s\S]*?imagesAfter[\s\S]*?const entry = \{[^}]*imagesBefore, imagesAfter[^}]*\}[\s\S]*?state\.history\.push\(entry\)/);
  assert.match(renderExportCanvas, /drawImagesToContext\(context, region\)/);
  assert.ok(renderExportCanvas.indexOf("drawWidgetsToContext(context, region)") < renderExportCanvas.indexOf("drawImagesToContext(context, region)"));
  assert.ok(snapshotPreview.indexOf("drawWidgetsToContext(q, bounds)") < snapshotPreview.indexOf("drawImagesToContext(q, bounds)"));
  assert.doesNotMatch(end, /imageTouchHold|cancelImageTouchHold/);
  assert.ok(end.indexOf("state.imageGesture") < end.indexOf("state.pendingGesture"));
  assert.equal((app.match(/imagePickerButton\.addEventListener\("click"/g) || []).length, 1);
  for (const key of ["addImage", "imageAdded", "imageSelected", "imageDeleted", "imagePlaced", "imageMerged", "imagePlace", "imagePlaceHint", "imageMerge", "imageMergeHint", "imageDelete", "imageDeleteHint", "snapshotImages"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
});

test("Select exposes one focused object toolbar, drags from its surface, and expires after inactivity", () => {
  const html = read("public/index.html"),
    app = read("public/app.js"),
    css = read("public/style.css"),
    zh = read("public/locales/zh.js"),
    handIndex = html.indexOf('data-mode="hand"'),
    penIndex = html.indexOf('data-mode="pen"'),
    pointerDown = app.slice(app.indexOf('function handleCanvasPointerDown('), app.indexOf('screen.addEventListener("pointermove"')),
    mode = functionSource(app, "setCanvasMode"),
    modePresentation = functionSource(app, "syncCanvasModePresentation"),
    autoControl = functionSource(app, "updateAutoControl"),
    handStatusHint = functionSource(app, "showHandStatusHint"),
    acceptImageEdit = functionSource(app, "acceptImageEdit"),
    mergeImage = functionSource(app, "mergeImage"),
    acceptWidgetEdit = functionSource(app, "acceptWidgetEdit"),
    acceptPendingWidget = functionSource(app, "acceptPendingWidget"),
    acceptAnimationEdit = functionSource(app, "acceptAnimationEdit"),
    confirmTextEditor = functionSource(app, "confirmTextEditor"),
    acceptPending = functionSource(app, "acceptPending"),
    refineHoverOutline = functionSource(app, "drawWidgetRefineButtonHoverOutline"),
    refineClickPulse = functionSource(app, "drawWidgetRefineClickPulse"),
    createChromeButton = functionSource(app, "createObjectChromeButton"),
    syncChrome = functionSource(app, "syncObjectChrome"),
    chromeSpecs = functionSource(app, "objectChromeSpecs"),
    chromeMove = functionSource(app, "beginObjectChromeMove"),
    focusObject = functionSource(app, "focusHandObject"),
    activateToolbar = functionSource(app, "activateHandObjectToolbar"),
    chromePosition = vm.runInNewContext(`(${functionSource(app, "objectChromePosition")})`, {
      state:{ panX:0, panY:-180, scale:1 },
      view:{ clientWidth:900, clientHeight:600 },
      screenObjectBox:(box) => ({ left:box.x, top:box.y - 180, width:box.w, height:box.h }),
    });

  assert.ok(handIndex >= 0 && handIndex < penIndex);
  assert.match(html, /id="handToolBtn"[^>]*data-mode="hand"[^>]*aria-pressed="false"[^>]*data-i18n-aria="hand"/);
  assert.match(app, /mode:\s*"pen"/);
  assert.match(app, /hand:\s*"Hand: move the canvas \(H\)"/);
  assert.match(zh, /hand:\s*"小手：移动画布（H）"/);
  assert.match(app, /handAutoAIManual:\s*"Hand mode pauses Auto AI · Use the AI button to run it manually\."/);
  assert.match(zh, /handAutoAIManual:\s*"Hand 模式暂停自动 AI · 请点击 AI 按钮手动运行"/);
  for (const key of ["handAutoAIResume", "handWidgetConfirmedHint", "handImageConfirmedHint", "handImageMergedHint", "handAnimationConfirmedHint", "handTextConfirmedHint", "handDraftConfirmedHint"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
  assert.match(autoControl, /disabled = state\.mode === "hand" && state\.auto/);
  assert.match(autoControl, /button\.disabled = disabled/);
  assert.match(autoControl, /button\.setAttribute\("aria-disabled", String\(disabled\)\)/);
  assert.match(handStatusHint, /state\.mode !== "hand" \|\| state\.busy/);
  assert.match(handStatusHint, /statusHintRotation\.get\(action\)[\s\S]*?% candidates\.length/);
  assert.match(handStatusHint, /setStatusKey\(candidates\[index\]\)/);
  assert.match(mode, /if \(mode === "hand"\) \{[\s\S]*?clearTimeout\(state\.timer\);[\s\S]*?state\.timer = 0/);
  assert.match(mode, /state\.mode = mode;[\s\S]*?updateAutoControl\(\)/);
  assert.match(mode, /if \(mode === "hand" && options\.showHint && !state\.busy\)[\s\S]*?showHandStatusHint\("hand-mode", \["handAutoAIManual", "handAutoAIResume"\]\)/);
  assert.doesNotMatch(mode, /setAutoEnabled|state\.autoEligible|supersedeActiveAI|controller\.abort/);
  assert.match(acceptImageEdit, /setStatusKey\(options\.showHint \? "imagePlaced" : "ready"\)/);
  assert.doesNotMatch(acceptImageEdit, /showHandStatusHint/);
  assert.match(mergeImage, /setStatusKey\("imageMerged"\)/);
  assert.doesNotMatch(mergeImage, /showHandStatusHint/);
  assert.match(acceptWidgetEdit, /options\.showHint[\s\S]*?showHandStatusHint\("widget-confirmed"/);
  assert.match(acceptPendingWidget, /options\.showHint[\s\S]*?showHandStatusHint\("widget-draft-confirmed"/);
  assert.match(acceptAnimationEdit, /options\.showHint[\s\S]*?showHandStatusHint\("animation-confirmed"/);
  assert.match(confirmTextEditor, /options\.showHint[\s\S]*?showHandStatusHint\("text-confirmed"/);
  assert.match(acceptPending, /options\.showHint[\s\S]*?showHandStatusHint\("ai-draft-confirmed"/);
  assert.match(chromeSpecs, /record\.kind === "image"[\s\S]*?addObjectToolbarSpecs[\s\S]*?deleteImage\(handTarget\)[\s\S]*?acceptImageEdit\(\{ showHint:true \}\)/);
  assert.match(chromeSpecs, /mergeImage\(handTarget, \{ showHint:true \}\)/);
  assert.match(app, /acceptPending\(\{ showHint:true \}\)/);
  assert.match(app, /acceptPendingWidget\(\{ showHint:true \}\)/);
  assert.match(modePresentation, /view\.classList\.toggle\("hand-mode", mode === "hand"\)/);
  assert.match(mode, /requestInteractionLayerRender\(\)/);
  assert.match(mode, /eraserMode = \["eraser", "area-eraser"\]\.includes\(mode\)[\s\S]*?finalizingPendingWidgetForEraser = eraserMode[\s\S]*?\["hand", "select", "pen"\]\.includes\(state\.mode\)[\s\S]*?acceptPendingWidget\(\{ restoreMode:false, allowRevisionMismatch:true \}\)/);
  assert.match(mode, /leavingDraftHand[\s\S]*?acceptPending\(\{ restoreMode:false \}\)/);
  assert.match(functionSource(app, "beginCanvasPointerAction"), /state\.mode === "hand"[\s\S]*?state\.panGesture[\s\S]*?setCanvasCursor\("grabbing"\)/);
  assert.match(pointerDown, /state\.mode === "select" && beginCanvasObjectSelection/);
  const selectionDispatch = functionSource(app, "beginCanvasObjectSelection");
  assert.match(selectionDispatch, /beginWidgetGesture[\s\S]*?beginImageGesture[\s\S]*?beginAnimationGesture/);
  assert.match(selectionDispatch, /widgetResizeHit/);
  assert.doesNotMatch(pointerDown, /beginImageTouchHold|beginAnimationTouchHold/);
  for (const target of ["image", "animation", "widget", "pending-widget"]) assert.match(chromeSpecs, new RegExp(`target:"${target}"`));
  assert.match(functionSource(app, "pendingChromeSpecs"), /target:"pending"/);
  assert.match(chromeMove, /beginPendingGesture[\s\S]*?beginWidgetGesture[\s\S]*?beginImageGesture[\s\S]*?beginAnimationGesture/);
  assert.deepEqual({ ...chromePosition({ x:100, y:100, w:300, h:260 }, "toolbar", "", { objectToolbar:true, minimumWidth:100, baseHeight:34 }) }, { x:100, y:-114, scale:1, baseWidth:300, baseHeight:34 });
  assert.doesNotMatch(app, /function drawHandModeOutlines\(/);
  const handToolbarOutlines = functionSource(app, "drawHandObjectToolbarOutlines");
  assert.match(handToolbarOutlines, /!\["select", "hand"\]\.includes\(state\.mode\)[\s\S]*?state\.handToolbarTargets\.values\(\)[\s\S]*?if \(!record\.expanded \|\| record\.kind === "widget"\) continue[\s\S]*?imageBox\(object\)[\s\S]*?animationBox\(object\)[\s\S]*?textBoxBox\(object\)[\s\S]*?record\.kind === "image" \? state\.paint\.border \|\| "#d8dbe2" : "rgba\(38, 121, 184, 0\.42\)"[\s\S]*?strokeRect/);
  assert.doesNotMatch(handToolbarOutlines, /widgetBox\(object\)/);
  assert.match(functionSource(app, "renderInteractionLayer"), /drawHandObjectToolbarOutlines\(interactionCtx\)/);
  assert.match(chromeSpecs, /for \(const \[key, record\] of state\.handToolbarTargets\)/);
  assert.doesNotMatch(chromeSpecs, /for \(const item of (?:visibleImages|visibleAnimations|visibleTextBoxes|visibleWidgets)/);
  assert.match(app, /HAND_OBJECT_TOOLBAR_VISIBLE_MS = 10000/);
  assert.match(functionSource(app, "handToolbarHasActiveOperation"), /token\.startsWith\("pointer:"\) \|\| token\.startsWith\("operation:"\)/);
  assert.match(functionSource(app, "scheduleHandObjectToolbarTick"), /handToolbarHasActiveOperation\(record\)\) continue[\s\S]*?record\.hiding \? record\.hideAt : record\.expiresAt/);
  assert.match(functionSource(app, "expireHandObjectToolbars"), /handToolbarHasActiveOperation\(record\)\) continue[\s\S]*?record\.expiresAt <= now[\s\S]*?record\.hiding = true[\s\S]*?HAND_OBJECT_TOOLBAR_FADE_MS/);
  assert.match(functionSource(app, "ensureHandToolbarRecord"), /expanded:false[\s\S]*?holds:new Set\(\)/);
  assert.match(focusObject, /previousKey && previousKey !== ensured\.key\) finishHandToolbarHide\(previousKey\)[\s\S]*?key !== ensured\.key\) finishHandToolbarHide\(key\)[\s\S]*?handToolbarActiveKey = ensured\.key[\s\S]*?record\.expanded = true/);
  assert.match(activateToolbar, /targetKey !== key\) finishHandToolbarHide\(targetKey\)[\s\S]*?handToolbarActiveKey = key[\s\S]*?record\.expanded = true/);
  assert.match(functionSource(app, "updateHandObjectHover"), /handHoverKey = ""[\s\S]*?releaseHandObjectFocus\(previousKey, "canvas-hover"\)[\s\S]*?return false/);
  assert.doesNotMatch(functionSource(app, "updateHandObjectHover"), /handObjectToolbarTargetAtPoint|focusHandObject/);
  assert.doesNotMatch(functionSource(app, "mountWidget"), /pointerenter[\s\S]*?focusHandObject|updateHandObjectHover/);
  assert.match(functionSource(app, "mountWidget"), /frame\.addEventListener\("focus"[\s\S]*?focusHandObject\("widget", widget, "widget-focus"\)/);
  assert.match(functionSource(app, "beginHandObjectFocus"), /handObjectToolbarTargetAtPoint[\s\S]*?handPointerFocusKeys\.set/);
  assert.match(createChromeButton, /dragSurface = kind === "move" \|\| kind === "toolbar"[\s\S]*?if \(dragSurface\) activateHandObjectToolbar[\s\S]*?beginObjectChromeMove/);
  assert.match(createChromeButton, /button\.className = kind === "toolbar" \? "object-chrome-button" : `object-chrome-button \$\{kind\}`/);
  assert.match(selectionDispatch, /hideHandObjectToolbar\(\{ all:true \}\)/);
  assert.match(refineHoverOutline, /state\.widgetRefineButtonHoverId[\s\S]*?state\.mode !== "pen"/);
  assert.match(functionSource(app, "widgetRefineOutlineTarget"), /visibleWidgets\(\)\.find\(\(item\) => item\.id === widgetId\)/);
  assert.doesNotMatch(refineHoverOutline, /widgetRefineHoveredWidgetId|widgetRefineHintHovered/);
  const refineOutline = functionSource(app, "strokeWidgetRefineOutline");
  assert.match(refineOutline, /widgetBox\(widget\)[\s\S]*?strokeStyle = solid \? "#007aff" : "rgba\(0, 122, 255, 0\.34\)"[\s\S]*?lineWidth = \(solid \? 2 : 1\) \* unit[\s\S]*?setLineDash\(solid \? \[\] : \[4 \* unit, 4 \* unit\]\)[\s\S]*?strokeRect/);
  assert.doesNotMatch(refineOutline, /shadowColor|shadowBlur/);
  assert.match(css, /\.object-chrome-button\.refine:hover[^\{]*\{[^}]*box-shadow:\s*none/);
  assert.match(css, /\.widget-refine-hint\s*\{[^}]*box-shadow:\s*none/);
  assert.match(refineClickPulse, /WIDGET_REFINE_CLICK_PULSE_MS[\s\S]*?Math\.sin\(progress \* Math\.PI \* 2\) \*\* 2[\s\S]*?strokeWidgetRefineOutline[\s\S]*?requestInteractionLayerRender\(\)/);
  assert.match(functionSource(app, "renderInteractionLayer"), /drawWidgetRefineButtonHoverOutline\(interactionCtx\)[\s\S]*?drawWidgetRefineClickPulse\(interactionCtx\)/);
  assert.doesNotMatch(functionSource(app, "renderInteractionLayer"), /drawHandModeOutlines/);
  assert.match(createChromeButton, /kind === "refine"\) triggerWidgetRefineClickPulse\(button\.penechoSpec\?\.refineCandidate\?\.widgetId\)[\s\S]*?button\.penechoSpec\?\.activate/);
  assert.match(createChromeButton, /pointerdown[\s\S]*?preventDefault\(\)[\s\S]*?stopPropagation\(\)[\s\S]*?setPointerCapture/);
  assert.match(createChromeButton, /pointerenter[\s\S]*?state\.widgetRefineButtonHoverId = candidate\.widgetId[\s\S]*?requestInteractionLayerRender\(\)/);
  assert.match(createChromeButton, /pointerleave[\s\S]*?state\.widgetRefineButtonHoverId = null[\s\S]*?requestInteractionLayerRender\(\)/);
  assert.match(syncChrome, /button\.penechoSpec\?\.kind === "refine"[\s\S]*?state\.widgetRefineButtonHoverId = null[\s\S]*?removedHoveredRefineButton[\s\S]*?requestInteractionLayerRender\(\)/);
  assert.match(app, /overChromeControl = event\.target\?\.closest\?\.\("\.object-chrome-button, \.widget-refine-confirmation"\)[\s\S]*?!overChromeControl\) updateWidgetRefinePointer/);
  assert.match(html, /id="objectChromeLayer" class="object-chrome-layer"/);
  assert.match(css, /\.canvas-widget-frame\s*\{[^}]*pointer-events:\s*none/);
  assert.match(css, /#viewport\.widget-selection-enabled \.canvas-widget\.is-interacting \.canvas-widget-frame\s*\{[^}]*pointer-events:\s*auto[^}]*cursor:\s*auto/);
  assert.match(css, /\.widget-layer\s*\{[^}]*z-index:\s*1/);
  assert.match(css, /\.object-chrome-layer\s*\{[^}]*z-index:\s*4/);
  assert.match(css, /\.object-chrome-button\.object-toolbar-surface\)[^{]*\{[^}]*width:\s*var\(--object-control-width, 104px\)[^}]*height:\s*var\(--object-control-height, 34px\)[^}]*cursor:\s*grab/);
  assert.match(css, /\.object-chrome-button\.hand-toolbar-hiding\s*\{[^}]*pointer-events:\s*none[^}]*opacity:\s*0/);
  for (const name of ["acceptImageEdit", "cancelImageEdit", "deleteImage", "mergeImage"]) {
    assert.match(functionSource(app, name), /state\.mode !== "hand"/);
  }
  assert.doesNotMatch(functionSource(app, "updateImageGesture"), /schedule|requestAI/);
  assert.doesNotMatch(functionSource(app, "updateWidgetGesturePoint"), /schedule\(\)|requestAI/);
  assert.doesNotMatch(functionSource(app, "updateAnimationGesture"), /schedule|requestAI/);
});

test("AI drafts temporarily enter Select, restore the prior tool, and undo back to an unconfirmed draft", () => {
  const app = read("public/app.js"),
    enter = functionSource(app, "enterAIDraftHandMode"),
    finish = functionSource(app, "finishAIDraftHandMode"),
    mode = functionSource(app, "setCanvasMode"),
    accept = functionSource(app, "acceptPending"),
    acceptItem = functionSource(app, "acceptPendingItem"),
    acceptWidget = functionSource(app, "acceptPendingWidget"),
    restore = functionSource(app, "restorePendingHistoryState"),
    applyHistory = functionSource(app, "applyHistory");
  assert.match(enter, /aiDraftReturnMode === null[\s\S]*?state\.aiDraftReturnMode = state\.mode/);
  assert.match(enter, /setCanvasMode\("select", \{[\s\S]*?preserveSelection:true,[\s\S]*?skipDraftFinalize:true,[\s\S]*?preserveWidgetRefinement:true/);
  assert.match(finish, /returnMode[\s\S]*?setCanvasMode\(returnMode, \{[\s\S]*?preserveSelection:true,[\s\S]*?skipDraftFinalize:true,[\s\S]*?preserveWidgetRefinement:true/);
  assert.match(functionSource(app, "startPending"), /enterAIDraftHandMode\(\)/);
  assert.match(functionSource(app, "startPendingBatch"), /enterAIDraftHandMode\(\)/);
  assert.match(functionSource(app, "startPendingWidget"), /enterAIDraftHandMode\(\)/);
  assert.match(mode, /leavingDraftHand[\s\S]*?acceptPending\(\{ restoreMode:false \}\)[\s\S]*?acceptPendingWidget\(\{ restoreMode:false \}\)/);
  assert.match(accept, /capturePendingHistoryState\(\)[\s\S]*?recordPendingHistory\(historyEntry, pendingBefore/);
  assert.match(acceptItem, /capturePendingHistoryState\(\)[\s\S]*?recordPendingHistory\(historyEntry, pendingBefore/);
  assert.match(acceptWidget, /capturePendingHistoryState\(\)[\s\S]*?recordPendingHistory\(historyEntry, pendingBefore/);
  assert.match(restore, /side === "before" \? entry\.pendingBefore : entry\.pendingAfter/);
  assert.match(restore, /state\.pendingHistoryRestored = Boolean\(state\.pending \|\| state\.pendingWidget\)/);
  assert.match(restore, /setCanvasMode\("select", \{ preserveSelection:true, skipDraftFinalize:true \}\)/);
  assert.match(applyHistory, /restorePendingHistoryState\(entry, side\)/);
  assert.match(app, /state\.pendingHistoryRestored && \(a === "undo" \|\| a === "redo"\)/);
});

test("switching from Pen to Eraser finalizes a pending widget regardless of revision drift", () => {
  const setCanvasMode = functionSource(read("public/app.js"), "setCanvasMode"),
    button = { classList:{ toggle() {} }, setAttribute() {} },
    state = {
      mode:"pen",
      pending:null,
      pendingWidget:{ id:"widget-1", revision:4 },
      pendingWidgetReplacement:null,
      aiDraftReturnMode:"pen",
      pendingHistoryRestored:false,
      selection:null,
      pointerPreview:null,
      areaEraseGesture:null,
      eraserMode:"eraser",
      busy:false,
  };
  let accepted = 0,
    storedEraserMode = null;
  vm.runInNewContext(`(${setCanvasMode})("area-eraser")`, {
    state,
    ERASER_MODE_STORAGE_KEY:"penecho-eraser-mode",
    localStorage:{
      setItem:(key, value) => {
        assert.equal(key, "penecho-eraser-mode");
        storedEraserMode = value;
      },
    },
    eraserToolButton:button,
    document:{
      querySelector:() => button,
      querySelectorAll:() => [button],
    },
    activeWidgetRefinement:() => null,
    acceptPendingWidget:(options) => {
      assert.equal(options.restoreMode, false);
      assert.equal(options.allowRevisionMismatch, true);
      accepted++;
      state.pendingWidget = null;
    },
    updateWidgetRefinePointer() {},
    updateAutoControl() {},
    syncCanvasModePresentation() {},
    setWidgetInteraction() {},
    updateEraserToolUI() {},
    hideEraserToolMenu() {},
    cancelAreaEraseGesture() {},
    deselectAnimation() {},
    view:{ classList:{ toggle() {} } },
    resetCanvasCursor() {},
    requestInteractionLayerRender() {},
  });
  assert.equal(accepted, 1);
  assert.equal(state.mode, "area-eraser");
  assert.equal(storedEraserMode, "area-eraser");
  assert.equal(state.pendingWidget, null);
});

test("contextual Canvas hints share one quiet application-footer line by priority", () => {
  const html = read("public/index.html"), app = read("public/app.js"), css = read("public/style.css"), zh = read("public/locales/zh.js"),
    showHint = functionSource(app, "showCanvasHint"),
    renderHint = functionSource(app, "renderCanvasHint"),
    mode = functionSource(app, "setCanvasMode"),
    startWidget = functionSource(app, "startPendingWidget"),
    acceptWidget = functionSource(app, "acceptPendingWidget");
  assert.match(html, /id="canvasHint" class="canvas-hint" role="status" aria-live="polite" hidden/);
  assert.doesNotMatch(html, /data-i18n="footerTip"|AI drafts: move the whole group/);
  assert.match(renderHint, /Object\.entries\(state\.canvasHintValues \|\| \{\}\)[\s\S]*?replaceAll\(`[\s\S]*?canvasHint\.textContent = `\$\{t\("hintPrefix"\)\}: \$\{message\}`[\s\S]*?canvasHint\.hidden = false/);
  assert.match(app, /hintPrefix:\s*"Hint"/);
  assert.match(zh, /hintPrefix:\s*"提示"/);
  assert.match(zh, /pluginPreview:\s*"预览"/);
  assert.doesNotMatch(showHint, /setTimeout|hidden\s*=\s*true/);
  assert.match(showHint, /Array\.isArray\(keys\)[\s\S]*?candidate\.key !== state\.canvasHintKey[\s\S]*?Math\.random\(\)/);
  const viewportStart = html.indexOf('<section id="viewport"'), viewportEnd = html.indexOf('<section id="debugPanel"'),
    viewport = html.slice(viewportStart, viewportEnd),
    footerStart = html.lastIndexOf("<footer>", html.indexOf('id="coords"')), footerEnd = html.indexOf("</footer>", footerStart), footer = html.slice(footerStart, footerEnd);
  for (const id of ["textInputHint", "canvasNavigationLockHint", "tip", "canvasHint"]) assert.ok(!viewport.includes(`id="${id}"`));
  assert.ok(footer.includes('id="pageHintSlot"'));
  for (const id of ["textInputHint", "canvasNavigationLockHint", "tip", "canvasHint"]) assert.ok(footer.includes(`id="${id}"`));
  assert.match(css, /\.page-hint-slot\s*\{[^}]*position:\s*relative;[^}]*grid-column:\s*2;[^}]*color:\s*var\(--studio-muted, var\(--pe-ink-3, var\(--muted\)\)\);[^}]*font:\s*400 11px\/16px var\(--pe-font-ui,[^}]*text-align:\s*right;[^}]*pointer-events:\s*none/);
  assert.match(css, /\.page-hint-slot > :is\(\.text-input-hint, \.canvas-navigation-lock-hint, #tip, \.canvas-hint\)\s*\{[^}]*position:\s*absolute;[^}]*top:\s*50%;[^}]*right:\s*0;[^}]*bottom:\s*auto;[^}]*transform:\s*translateY\(-50%\);[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;[^}]*text-align:\s*right/);
  assert.match(css, /\.text-input-hint kbd\s*\{[^}]*padding:\s*0;[^}]*color:\s*inherit;[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*font:\s*inherit/);
  assert.match(css, /\.canvas-hint\s*\{[^}]*max-width:\s*min\(440px, 50vw\)[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/);
  assert.match(css, /main:has\(#viewport:is\(\.is-navigating, \.navigation-locked\)\) \.canvas-hint,[\s\S]*?main:has\(\.text-input-hint:not\(\[hidden\]\)\) #pageHintSlot :is\(#tip, \.canvas-navigation-lock-hint, \.canvas-hint\)\s*\{[^}]*visibility:\s*hidden;[^}]*opacity:\s*0/);
  assert.match(css, /main > footer\.penecho-desktop-update-visible \.page-hint-slot\s*\{\s*display:\s*none/);
  assert.doesNotMatch(css, /canvasHintSettle|\.canvas-hint\.is-new\s*\{[^}]*animation|\.page-hint-slot[^}]*text-shadow|\.canvas-hint\.two-line/);
  assert.doesNotMatch(app, /fitCanvasHint|canvasHintResizeScheduled|classList\.(?:add|remove)\("two-line"\)/);
  assert.doesNotMatch(css, /studio-agent-launcher-floating [^{]*(?:\.canvas-hint|#tip|\.canvas-navigation-lock-hint|\.text-input-hint)/);
  assert.match(startWidget, /widget\.widgetType === "html_widget"[\s\S]*?widgetInteractionPresentation\(\) === "maximized" \? "canvasHintWidgetFullscreen" : "canvasHintWidgetInline"/);
  assert.match(acceptWidget, /if \(restoreMode\) finishAIDraftHandMode\(\);[\s\S]*?if \(!replacement && restoreMode\) showCanvasHint\(widgetInteractionPresentation\(\) === "maximized" \? "canvasHintWidgetFullscreen" : "canvasHintWidgetInline"\)/);
  assert.match(mode, /keyboardShortcutCanvasHint\("focus-agent", "canvasHintShortcutAgent"\)/);
  assert.match(mode, /keyboardShortcutCanvasHint\("save-canvas", "canvasHintShortcutSave"\)/);
  assert.match(mode, /keyboardShortcutUndoRedoHint\(\)/);
  assert.match(mode, /keyboardShortcutCanvasHint\("canvas-library", "canvasHintShortcutLibrary"\)/);
  assert.match(mode, /keyboardShortcutCanvasHint\("toggle-fullscreen", "canvasHintShortcutFullscreen"\)/);
  assert.match(mode, /keyboardShortcutCanvasHint\("open-settings", "canvasHintShortcutSettings"\)/);
  assert.match(mode, /pen:\[shortcutHints\.agent, shortcutHints\.save, shortcutHints\.undoRedo, "canvasHintMcp"\]/);
  assert.match(mode, /hand:\["canvasHintHand", "canvasHintHandAlt", shortcutHints\.agent, shortcutHints\.library, shortcutHints\.fullscreen\]/);
  assert.match(mode, /select:\["canvasHintLasso", state\.widgets\.length/);
  assert.match(app, /if\(!reconnecting\)showCanvasHint\("canvasHintMcpConnected"\)/);
  assert.doesNotMatch(app, /canvasHintWidgetAddedAlt|canvasHintRefineInPlace|canvasHintAIAddsOnly/);
  assert.match(app, /button\.onclick = \(\) => selectCanvasToolMode\(button\.dataset\.mode, \{ showHint:true \}\)/);
  assert.match(app, /e\.pointerType === "touch"[\s\S]*?touchWidget = valid\(touchPoint\) \? widgetAtRefinePoint\(touchPoint\) : null[\s\S]*?state\.mode !== "select"\) showCanvasHint\("canvasHintWidgetTouchHand"\)/);
  const hintKeys = [
    "canvasHintWidgetAdded", "canvasHintWidgetFullscreen", "canvasHintWidgetInline", "canvasHintShortcutAgent", "canvasHintShortcutSave", "canvasHintShortcutUndoRedo",
    "canvasHintShortcutLibrary", "canvasHintShortcutFullscreen", "canvasHintShortcutSettings", "canvasHintMcp", "canvasHintMcpConnected", "canvasHintHand", "canvasHintHandAlt", "canvasHintLasso",
    "canvasHintWidgetTouchHand", "canvasHintLassoAlt", "canvasHintText", "canvasHintTextAlt", "canvasHintEraser", "canvasHintEraserAlt",
  ];
  for (const key of hintKeys) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
    const english = new RegExp(`${key}: "([^"]+)"`).exec(app)?.[1] || "";
    assert.ok(english && english.split(/\s+/).length <= 20, `${key} must stay within 20 English words`);
  }
});

test("widget shadows are an optional device display preference", () => {
  const app = read("public/app.js"),
    html = read("public/index.html"),
    css = read("public/style.css"),
    setter = functionSource(app, "setWidgetShadowEnabled"),
    drawImages = functionSource(app, "drawImagesToContext"),
    render = functionSource(app, "render"),
    mergeImage = functionSource(app, "mergeImage");
  assert.match(html, /id="settingsWidgetShadowToggle" class="settings-switch"[^>]*aria-checked="false"/);
  assert.doesNotMatch(html, /id="settingsWidgetShadowToggle" class="settings-switch on"/);
  assert.match(app, /storedWidgetShadowEnabled = localStorage\.getItem\("penecho-widget-shadow"\)[\s\S]*?initialWidgetShadowEnabled = storedWidgetShadowEnabled === "true"/);
  assert.match(setter, /localStorage\.setItem\("penecho-widget-shadow"[\s\S]*?view\.classList\.toggle\("widget-shadows"[\s\S]*?requestRender\(\)/);
  assert.match(css, /#viewport\.widget-shadows \.canvas-widget\s*\{[^}]*box-shadow:[^}]*0 1px 2px[^}]*0 7px 16px[^}]*0 22px 46px/);
  assert.match(drawImages, /withShadow = false[\s\S]*?shadowColor = "rgba\(15, 23, 42, \.24\)"[\s\S]*?shadowBlur = 18[\s\S]*?shadowOffsetY = 7[\s\S]*?drawImage[\s\S]*?restore/);
  assert.match(functionSource(app, "renderPlacedContentLayer"), /drawPlacedCanvasObjectsToContext\(placedContentCtx, visible, state\.widgetShadowEnabled\)/);
  assert.doesNotMatch(mergeImage, /shadow(?:Color|Blur|Offset)|widgetShadowEnabled/);
});

test("PenEcho Agent auto-open is a default-on canvas preference", () => {
  const app = read("public/app.js"),
    html = read("public/index.html"),
    zh = read("public/locales/zh.js"),
    agent = read("src/client/app/canvas-agent-runtime.js"),
    setter = functionSource(app, "setCanvasAgentAutoOpen");
  assert.match(html, /id="settingsCanvasAgentAutoOpenToggle" class="settings-switch on"[^>]*aria-checked="true"/);
  assert.match(html, /id="settingsCanvasAgentAutoOpenLabel"[^>]*data-i18n="settingsCanvasAgentAutoOpen"/);
  assert.match(app, /storedCanvasAgentAutoOpen = localStorage\.getItem\("penecho-canvas-agent-auto-open"\)/);
  assert.match(app, /storedCanvasAgentAutoOpen === null \? configuredCanvasAgentAutoOpen !== false : storedCanvasAgentAutoOpen === "true"/);
  assert.match(setter, /localStorage\.setItem\("penecho-canvas-agent-auto-open"[\s\S]*?aria-checked/);
  assert.match(app, /settingsCanvasAgentAutoOpen: "Open PenEcho Agent with each canvas"/);
  assert.match(zh, /settingsCanvasAgentAutoOpen: "打开画布时自动打开 PenEcho Agent"/);
  let openCount = 0, shellOpen = false, mcpDocked = false;
  const context = {
    window:{PenEchoStudioNavigator:{isMcpDocked:()=>mcpDocked}},
    canvasAgent:{ socket:null, connectPromise:null }, state:{ canvasAgentAutoOpen:false }, canvasAgentPanel:{ hidden:true }, WebSocket:{ OPEN:1 },
    mcpDisconnect:()=>{},
    document:{ body:{ classList:{ contains:() => shellOpen } } },
    canvasAgentCanvasIdentity:() => "draft:test-client", canvasAgentReconcileCloudCanvas:()=>{}, canvasAgentCancelInitialAutoHide:() => {}, canvasAgentPersistCurrentConversation:() => {}, canvasAgentBeginLocalConversation:() => {}, canvasAgentDropSessionIdentity:() => {}, canvasAgentSyncPromptSuggestions:() => {}, openCanvasAgent:() => { openCount++; },
  };
  vm.runInNewContext(functionSource(agent, "canvasAgentCanvasDidChange"), context);
  context.canvasAgentCanvasDidChange();
  assert.equal(openCount, 0);
  context.state.canvasAgentAutoOpen = true;
  context.canvasAgentCanvasDidChange();
  assert.equal(openCount, 1);
  context.canvasAgentPanel.hidden = false;
  shellOpen = true;
  context.canvasAgentCanvasDidChange();
  assert.equal(openCount, 1, "an already-open Agent stays open without a duplicate open call");
  shellOpen = false;
  context.canvasAgentCanvasDidChange();
  assert.equal(openCount, 2, "a stale visible panel without the shell open state is reopened");
  mcpDocked = true;
  context.canvasAgentCanvasDidChange();
  assert.equal(openCount, 2, "MCP dock suppresses automatic opening");
  mcpDocked = false;
  context.canvasAgentCanvasDidChange();
  assert.equal(openCount, 3, "other sidebar tabs preserve the preference");
});

test("pen ink stays above widgets and the eraser exposes a dashed footprint", () => {
  const html = read("public/index.html"),
    app = read("public/app.js"),
    css = read("public/style.css"),
    interaction = functionSource(app, "renderInteractionLayer"),
    preview = functionSource(app, "drawPointerPreview"),
    cursor = functionSource(app, "resetCanvasCursor");
  assert.ok(html.indexOf('id="widgetLayer"') < html.indexOf('id="inkLayer"'));
  assert.ok(html.indexOf('id="widgetLayer"') < html.indexOf('id="placedContentLayer"'));
  assert.ok(html.indexOf('id="placedContentLayer"') < html.indexOf('id="inkLayer"'));
  assert.match(css, /\.widget-layer\s*\{[^}]*z-index:\s*1/);
  assert.match(css, /\.placed-content-layer\s*\{[^}]*z-index:\s*2[^}]*pointer-events:\s*none/);
  assert.match(css, /\.ink-layer\s*\{[^}]*z-index:\s*2/);
  assert.match(css, /#screen\.cursor-pen\s*\{[^}]*data:image\/svg\+xml/);
  assert.match(css, /#screen\.cursor-eraser\s*\{\s*cursor:\s*none/);
  assert.match(cursor, /state\.mode === "pen" \? "pen"[\s\S]*?state\.mode === "eraser" \? "eraser"/);
  assert.match(interaction, /drawPointerPreview\(interactionCtx\)/);
  assert.match(preview, /state\.mode !== "eraser" && !state\.drawing\?\.erase[\s\S]*?context\.setLineDash\(\[3\.5 \* unit, 3 \* unit\]\)[\s\S]*?context\.arc/);
  const updatePreview = functionSource(app, "updateCanvasPointerPreview"),
    beginPointer = functionSource(app, "beginCanvasPointerAction"),
    finishPointer = functionSource(app, "end");
  assert.match(updatePreview, /drawing \? drawing\.erase && drawing\.id === event\.pointerId : state\.mode === "eraser"[\s\S]*?requestInteractionLayerRender\(\)/);
  assert.match(beginPointer, /state\.drawing = \{[\s\S]*?erase: erasing,[\s\S]*?\};[\s\S]*?updateCanvasPointerPreview\(e, p\)/);
  assert.match(finishPointer, /const wasErasing = state\.drawing\.erase;[\s\S]*?finishDrawing\(e\.pointerType\);[\s\S]*?state\.pointerPreview = null;[\s\S]*?requestInteractionLayerRender\(\)/);
  assert.match(app, /screen\.addEventListener\("pointerleave", \(\) => \{[\s\S]*?state\.pointerPreview = null;[\s\S]*?requestInteractionLayerRender\(\)/);
});

test("stylus eraser ends and Apple Pencil bridge actions preserve Canvas tool semantics", () => {
  const app = read("public/app.js"),
    eraserActive = vm.runInNewContext(`(${functionSource(app, "canvasPenEraserActive")})`),
    pointerDown = app.slice(app.indexOf('function handleCanvasPointerDown('), app.indexOf('screen.addEventListener("pointermove"')),
    beginPointer = functionSource(app, "beginCanvasPointerAction"),
    pointerState = { selectedAnimationId:null,mode:"hand",timer:0,eraser:35,userRevision:0,drawing:null },
    pointerCalls = [],
    state = { mode:"pen",previousToolMode:"select",eraserMode:"area-eraser",viewMode:false,drawing:null,areaEraseGesture:null,selectionGesture:null },
    context = {
      state,
      setCanvasMode(mode) { state.mode = mode; },
    };

  assert.equal(eraserActive({ pointerType:"pen",button:5,buttons:32 }), true);
  assert.equal(eraserActive({ pointerType:"pen",button:-1,buttons:32 }), true);
  assert.equal(eraserActive({ pointerType:"pen",button:2,buttons:2 }), false);
  assert.equal(eraserActive({ pointerType:"mouse",button:5,buttons:32 }), false);
  assert.match(beginPointer, /options = arguments\[2\] \|\| \{\}[\s\S]*?forceEraser = options\.forceEraser === true[\s\S]*?!forceEraser && state\.mode === "hand"/);
  assert.match(beginPointer, /const erasing = forceEraser \|\| state\.mode === "eraser"/);
  assert.ok(pointerDown.indexOf("canvasPenEraserActive(e)") < pointerDown.indexOf('if (state.mode === "select"'));
  assert.match(pointerDown, /const input = captureDrawingInput\(e\)[\s\S]*?beginCanvasPointerAction\(e, input\.point, \{ forceEraser:true, inputTransform:input\.inputTransform \}\)/);
  assert.match(app, /window\.addEventListener\("penecho:pencil-action"[\s\S]*?performCanvasPencilAction\(event\.detail\?\.action\)/);
  const beginTemporaryEraser = vm.runInNewContext(`(${beginPointer})`, {
    state:pointerState,
    view:{ classList:{ add() {} } },
    acceptAnimationEdit() {},
    valid:() => true,
    supersedeActiveAI:() => pointerCalls.push("supersede"),
    clearTimeout() {},
    hideWidgetRefineHint() {},
    releaseWidgetsForDrawing() {},
    clearWidgetRefineCandidate:() => pointerCalls.push("clear-refine"),
    noteCanvasChromeInteraction() {},
    logicalWidth:(value) => value,
    captureDrawingTransform:() => ({ scale:1 }),
    updateCanvasPointerPreview:() => pointerCalls.push("preview"),
    appendLiveInkSample:(_drawing, _point, size) => pointerCalls.push(["display", true, size]),
  });
  beginTemporaryEraser({ pointerType:"pen",pointerId:9,clientX:10,clientY:20 }, { x:10,y:20 }, { forceEraser:true });
  assert.equal(pointerState.mode, "hand");
  assert.equal(pointerState.drawing.erase, true);
  assert.equal(pointerState.drawing.size, 35);
  assert.deepEqual(pointerCalls.at(-1), ["display", true, 35]);

  vm.runInNewContext([
    functionSource(app, "canvasToolMode"),
    functionSource(app, "selectCanvasToolMode"),
    functionSource(app, "performCanvasPencilAction"),
    "this.performCanvasPencilAction = performCanvasPencilAction;",
  ].join("\n"), context);
  assert.equal(context.performCanvasPencilAction("switch-previous"), true);
  assert.equal(context.state.mode, "select");
  assert.equal(context.state.previousToolMode, "pen");
  assert.equal(context.performCanvasPencilAction("switch-previous"), true);
  assert.equal(context.state.mode, "pen");
  assert.equal(context.state.previousToolMode, "select");
  assert.equal(context.performCanvasPencilAction("switch-eraser"), true);
  assert.equal(context.state.mode, "area-eraser");
  assert.equal(context.state.previousToolMode, "pen");
  assert.equal(context.performCanvasPencilAction("switch-eraser"), true);
  assert.equal(context.state.mode, "pen");
  assert.equal(context.state.previousToolMode, "area-eraser");
  context.state.viewMode = true;
  assert.equal(context.performCanvasPencilAction("switch-previous"), false);
  assert.equal(context.state.mode, "pen");
});

test("clicking eraser switches its current mode and shows two auto-closing choices", () => {
  const html = read("public/index.html"),
    app = read("public/app.js"),
    css = read("public/style.css"),
    zh = read("public/locales/zh.js"),
    begin = functionSource(app, "beginCanvasPointerAction"),
    move = app.slice(app.indexOf('screen.addEventListener("pointermove"'), app.indexOf("function end(e)")),
    end = functionSource(app, "end"),
    finish = functionSource(app, "finishAreaEraseGesture"),
    erase = functionSource(app, "eraseInkRegion"),
    clearDirty = functionSource(app, "clearDirtyInkRegion"),
    draw = functionSource(app, "drawAreaEraseSelection"),
    startBlankCanvas = functionSource(app, "startBlankCanvas"),
    loadSnapshot = functionSource(app, "loadSnapshot"),
    box = vm.runInNewContext(`(${functionSource(app, "areaEraseBox")})`, { state:{ areaEraseGesture:null } });

  assert.match(html, /id="eraserToolBtn"[^>]*data-mode="eraser"[^>]*aria-haspopup="menu"[^>]*aria-controls="eraserToolMenu"/);
  assert.match(html, /id="eraserToolMenu"[^>]*role="menu"[^>]*hidden[\s\S]*?data-eraser-mode="eraser"[\s\S]*?data-eraser-mode="area-eraser"/);
  assert.equal((html.match(/data-eraser-mode=/g) || []).length, 2);
  assert.equal((html.match(/data-eraser-glyph="stroke"/g) || []).length, 1);
  assert.equal((html.match(/data-eraser-glyph="area"/g) || []).length, 2);
  assert.match(html, /data-eraser-icon="freehand"[^>]*>\s*<path d="m7 20-4-4L14 5/);
  assert.match(html, /data-eraser-glyph="stroke"[^>]*>[\s\S]*?<path d="M3\.5 15\.8c2\.2-4\.5/);
  assert.match(html, /data-eraser-glyph="area"[^>]*>[\s\S]*?<rect class="eraser-area-frame"[^>]*>[\s\S]*?<path class="eraser-area-tool"[^>]*>[\s\S]*?<path class="eraser-area-seam"/);
  assert.match(css, /\[data-eraser-glyph\][^{]*\{[^}]*fill:\s*none;[^}]*stroke:\s*currentColor;[^}]*stroke-linecap:\s*round/);
  assert.match(css, /\.eraser-area-frame\s*\{[^}]*stroke-dasharray:\s*2\.3 2\.3/);
  assert.match(css, /\.eraser-area-tool\s*\{[^}]*fill:\s*currentColor/);
  assert.match(css, /#eraserToolBtn \[data-eraser-icon\]\s*\{\s*display:\s*none/);
  assert.match(css, /data-active-eraser="eraser"\][^\{]*data-eraser-icon="freehand"[\s\S]*?data-active-eraser="area-eraser"\][^\{]*data-eraser-icon="area"[^\{]*\{\s*display:\s*block/);
  assert.match(functionSource(app, "updateEraserToolUI"), /dataset\.activeEraser = state\.eraserMode/);
  assert.doesNotMatch(functionSource(app, "updateEraserToolUI"), /toggleAttribute\("hidden"/);
  assert.match(app, /ERASER_MODE_STORAGE_KEY = "penecho-eraser-mode"[\s\S]*?storedEraserMode = localStorage\.getItem\(ERASER_MODE_STORAGE_KEY\)/);
  assert.match(app, /initialEraserMode = \["eraser", "area-eraser"\]\.includes\(storedEraserMode\) \? storedEraserMode : "eraser"[\s\S]*?eraserMode: initialEraserMode/);
  assert.match(functionSource(app, "setCanvasMode"), /state\.eraserMode = mode;[\s\S]*?localStorage\.setItem\(ERASER_MODE_STORAGE_KEY, mode\)/);
  assert.doesNotMatch(startBlankCanvas, /eraserMode|ERASER_MODE_STORAGE_KEY/);
  assert.doesNotMatch(loadSnapshot, /eraserMode|ERASER_MODE_STORAGE_KEY/);
  assert.match(css, /\.eraser-tool-menu\s*\{[^}]*display:\s*flex[^}]*border-radius:\s*10px[^}]*background:\s*color-mix\(in srgb, var\(--panel-raised\) 72%, transparent\)[^}]*blur\(28px\)/);
  assert.match(css, /\.eraser-tool-option\[aria-checked="true"\]\s*\{[^}]*color:/);
  assert.match(app, /ERASER_TOOL_MENU_MS = 5000/);
  assert.doesNotMatch(app, /ERASER_TOOL_HOLD_MS|eraserToolHold|finishEraserToolHold/);
  assert.match(functionSource(app, "showEraserToolMenu"), /clearTimeout\(eraserToolMenuTimer\)[\s\S]*?hidden = false[\s\S]*?positionToolbarPopover\("#eraserToolControl", "#eraserToolMenu", \{ align:"center", gap:6 \}\)[\s\S]*?setTimeout\(\(\) => hideEraserToolMenu\(\), ERASER_TOOL_MENU_MS\)/);
  assert.match(functionSource(app, "hideEraserToolMenu"), /clearTimeout\(eraserToolMenuTimer\)[\s\S]*?eraserToolMenuTimer = 0/);
  assert.match(functionSource(app, "selectEraserMode"), /state\.eraserMode = mode[\s\S]*?selectCanvasToolMode\(mode, \{ showHint:true \}\)[\s\S]*?options\.keepMenuOpen\) showEraserToolMenu\(\)/);
  assert.match(app, /eraserToolButton\?\.addEventListener\("click", \(\) => selectEraserMode\(state\.eraserMode, \{ keepMenuOpen:true \}\)\)/);
  assert.match(app, /selectEraserMode\(button\.dataset\.eraserMode, \{ keepMenuOpen:true \}\)/);
  assert.match(begin, /state\.mode === "area-eraser"[\s\S]*?beginAreaEraseGesture\(e, point\)/);
  assert.match(move, /state\.areaEraseGesture\?\.id === e\.pointerId[\s\S]*?updateAreaEraseGesture\(e\)/);
  assert.match(end, /state\.areaEraseGesture\?\.id === e\.pointerId[\s\S]*?finishAreaEraseGesture\(e\)/);
  assert.match(finish, /event\.type === "pointercancel"[\s\S]*?box\.w \* state\.scale < 4[\s\S]*?eraseInkRegion\(box\)/);
  assert.deepEqual({ ...box({ start:{ x:9, y:13 }, current:{ x:3, y:4 } }) }, { x:3, y:4,w:6,h:9 });
  assert.match(draw, /rgba\(220, 38, 38, \.1\)[\s\S]*?setLineDash[\s\S]*?fillRect[\s\S]*?strokeRect/);
  assert.match(erase, /save\(\);[\s\S]*?recordBefore\(tx, ty\)[\s\S]*?clearRect\(localPart\.x[\s\S]*?state\.userRevision\+\+[\s\S]*?recomputeDirtyBounds\(\)[\s\S]*?filterErasedDirtyHotspots\(touchedTiles\)[\s\S]*?saveUserCanvasChange\(\)/);
  assert.match(clearDirty, /state\.dirtyInkTiles[\s\S]*?DIRTY_MASK_SCALE[\s\S]*?state\.dirtyInkBounds\.delete\(tileKey\)/);
  assert.doesNotMatch(erase, /requestAI\(/);
  assert.doesNotMatch(erase, /invalidateRecognition\(/);
  for (const key of ["eraserOptions", "areaEraser", "canvasHintAreaEraser", "canvasHintAreaEraserAlt", "areaEraseTooSmall", "areaEraseDeleted"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
});

test("canvas navigation guidance emphasizes middle-mouse panning for at least ten seconds", () => {
  const html = read("public/index.html"),
    app = read("public/app.js"),
    css = read("public/style.css"),
    zh = read("public/locales/zh.js"),
    navigating = functionSource(app, "setNavigating");

  assert.match(html, /id="tip"[^>]*data-i18n="tip"/);
  assert.match(app, /NAVIGATION_HINT_VISIBLE_MS\s*=\s*10000/);
  assert.match(navigating, /view\.classList\.add\("is-navigating"\)[\s\S]*?NAVIGATION_HINT_VISIBLE_MS/);
  assert.match(functionSource(app, "wheelNavigating"), /setNavigating\(true\)/);
  assert.match(app, /fit\(\);\s*setNavigating\(true\)/);
  assert.match(app, /tip:\s*"Pan: two-finger scroll, Hand, or Space \+ drag · Zoom: pinch or Ctrl\/Cmd \+ scroll"/);
  assert.match(zh, /tip:\s*"移动：双指滑动、小手或空格＋拖动 · 缩放：捏合或 Ctrl\/Cmd＋滚动"/);
  assert.match(css, /#tip\s*\{[^}]*max-width:\s*min\(440px, 100%\)[^}]*visibility:\s*hidden[^}]*opacity:\s*0/);
  assert.match(css, /main:has\(#viewport\.is-navigating\) #tip\s*\{[^}]*visibility:\s*visible[^}]*opacity:\s*1/);
  assert.match(css, /\.ink-layer\s*\{[^}]*z-index:\s*2/);
});

test("Canvas navigation temporarily hides Agent and restores its original state 500ms after every pointer is released", () => {
  const app = read("public/app.js"), css = read("public/style.css"),
    restoreSource = functionSource(app, "restoreCanvasAgentAfterNavigation"),
    scheduleSource = functionSource(app, "scheduleCanvasAgentNavigationRestore"),
    noteSource = functionSource(app, "noteCanvasAgentNavigation"),
    pointerEndSource = functionSource(app, "canvasAgentNavigationPointerDidEnd"),
    previewSource = functionSource(app, "requestCanvasNavigationPreview"),
    endSource = functionSource(app, "end"),
    openAgent = app.slice(app.indexOf("function openCanvasAgent"), app.indexOf("function closeCanvasAgent")),
    closeAgent = app.slice(app.indexOf("function closeCanvasAgent"), app.indexOf("canvasAgentToggle.hidden", app.indexOf("function closeCanvasAgent")));

  assert.match(app, /CANVAS_AGENT_NAVIGATION_RESTORE_MS\s*=\s*500/);
  assert.match(previewSource, /noteCanvasAgentNavigation\(\)/);
  assert.match(noteSource, /canvasAgentNavigationWasOpen = !canvasAgentPanel\.hidden && document\.body\.classList\.contains\("canvas-agent-open"\)/);
  assert.match(noteSource, /canvasAgentPanel\.contains\(document\.activeElement\)[\s\S]*?document\.activeElement\.blur\(\)/);
  assert.doesNotMatch(noteSource, /canvasAgentPanel\.hidden\s*=/);
  assert.match(restoreSource, /restoreMaterial = state\.canvasAgentNavigationActive && state\.canvasAgentNavigationWasOpen[\s\S]*?if \(restoreMaterial\) restoreCanvasChromeMaterial\(\)[\s\S]*?classList\.remove\("canvas-agent-navigation-hidden"\)/);
  assert.match(pointerEndSource, /canvasAgentNavigationPointerIds\.delete\(pointerId\)[\s\S]*?canvasAgentNavigationPointerIds\.size[\s\S]*?now \+ CANVAS_AGENT_NAVIGATION_RESTORE_MS/);
  assert.doesNotMatch(pointerEndSource, /state\.pointers\.size/);
  assert.equal((endSource.match(/state\.pointers\.delete\(e\.pointerId\);\s*canvasAgentNavigationPointerDidEnd\(e\.pointerId\);/g) || []).length, 2);
  assert.equal((app.match(/state\.canvasAgentNavigationPointerIds\.add\(e\.pointerId\)/g) || []).length, 2);
  assert.match(app, /window\.addEventListener\("pointerup", finishCanvasAgentNavigationPointer, true\)/);
  assert.match(app, /screen\.addEventListener\("lostpointercapture", finishCanvasAgentNavigationPointer\)/);
  assert.match(openAgent, /restoreCanvasAgentAfterNavigation\(\)[\s\S]*?restoreCanvasChromeMaterial\(\)/);
  assert.match(closeAgent, /restoreCanvasAgentAfterNavigation\(\)[\s\S]*?classList\.remove\("canvas-agent-open"\)/);
  assert.match(css, /canvas-agent-open\.canvas-agent-navigation-hidden \.canvas-frame\s*\{[^}]*--studio-agent-edge-shift:\s*0px/);
  assert.match(css, /canvas-agent-open\.canvas-agent-navigation-hidden \.canvas-frame::after\s*\{[^}]*right:\s*0/);
  assert.match(css, /studio-agent-docked\.canvas-agent-navigation-hidden \.canvas-agent-panel\.canvas-agent-positioned\s*\{[^}]*pointer-events:\s*none[^}]*opacity:\s*0[^}]*translate3d\(100%, 0, 0\)[^}]*visibility:\s*hidden/);
  assert.match(css, /@media \(max-width: 700px\)\s*\{[\s\S]*?canvas-agent-open\.canvas-agent-navigation-hidden \.canvas-agent-panel\s*\{[^}]*pointer-events:\s*none[^}]*opacity:\s*0[^}]*visibility:\s*hidden/);

  let now = 100, timerId = 0, blurred = 0, materialRestores = 0;
  const timers = new Map(), classes = new Set(["canvas-agent-open", "canvas-chrome-lightweight"]), activeElement = { blur:() => blurred++ },
    panel = { hidden:false, contains:(value) => value === activeElement },
    state = {
      canvasAgentNavigationActive:false,
      canvasAgentNavigationWasOpen:false,
      canvasAgentNavigationRestoreTimer:0,
      canvasAgentNavigationRestoreDeadline:0,
      canvasAgentNavigationPointerIds:new Set([1]),
      pointers:new Map(),
    },
    harness = vm.runInNewContext(`(() => {
      ${restoreSource}
      ${scheduleSource}
      ${noteSource}
      ${pointerEndSource}
      return { noteCanvasAgentNavigation, canvasAgentNavigationPointerDidEnd };
    })()`, {
      CANVAS_AGENT_NAVIGATION_RESTORE_MS:500,
      state, canvasAgentPanel:panel,
      document:{ activeElement, body:{ classList:{
        add:(value) => classes.add(value),
        remove:(value) => classes.delete(value),
        contains:(value) => classes.has(value),
      } } },
      performance:{ now:() => now },
      restoreCanvasChromeMaterial:() => {
        materialRestores++;
        classes.delete("canvas-chrome-lightweight");
      },
      setTimeout:(callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
      clearTimeout:(id) => timers.delete(id),
    });
  const runNextTimer = () => {
    const entry = timers.entries().next().value;
    assert.ok(entry, "an Agent visibility restore timer should be pending");
    const [id, timer] = entry;
    timers.delete(id);
    timer.callback();
    return timer.delay;
  };

  harness.noteCanvasAgentNavigation();
  assert.equal(state.canvasAgentNavigationWasOpen, true);
  assert.ok(classes.has("canvas-agent-navigation-hidden"));
  assert.ok(classes.has("canvas-agent-open"), "temporary hiding must preserve the authoritative open state");
  assert.equal(panel.hidden, false, "temporary hiding must not close the panel");
  assert.equal(blurred, 1);
  assert.equal(timers.size, 1);
  assert.equal(timers.values().next().value.delay, 500);

  now = 320;
  harness.noteCanvasAgentNavigation();
  assert.equal(timers.size, 1, "continued navigation should coalesce restore timers");
  now = 600;
  assert.equal(runNextTimer(), 500);
  assert.equal(timers.values().next().value.delay, 220);
  now = 821;
  runNextTimer();
  assert.equal(timers.size, 0);
  assert.ok(classes.has("canvas-agent-navigation-hidden"), "a held mouse, pen, or finger keeps Agent hidden even when motion pauses");

  now = 900;
  assert.equal(harness.canvasAgentNavigationPointerDidEnd(1), true);
  assert.equal(timers.values().next().value.delay, 500);
  state.pointers.set(99, true);
  now = 1401;
  runNextTimer();
  assert.equal(state.canvasAgentNavigationActive, false);
  assert.ok(!classes.has("canvas-agent-navigation-hidden"));
  assert.ok(classes.has("canvas-agent-open"));
  assert.equal(panel.hidden, false);
  assert.equal(materialRestores, 1);
  assert.ok(!classes.has("canvas-chrome-lightweight"), "Agent must return with its full frosted material immediately");
  assert.equal(state.pointers.size, 1, "hover pointer bookkeeping must not block Agent restoration");

  panel.hidden = true;
  classes.delete("canvas-agent-open");
  now = 2000;
  harness.noteCanvasAgentNavigation();
  assert.equal(state.canvasAgentNavigationWasOpen, false);
  assert.ok(!classes.has("canvas-agent-navigation-hidden"));
  now = 2501;
  runNextTimer();
  assert.equal(panel.hidden, true, "an originally hidden Agent must remain hidden");
  assert.ok(!classes.has("canvas-agent-open"));
  assert.equal(materialRestores, 1, "a hidden Agent does not need a material restoration");
});

test("Canvas chrome uses one drawing and navigation cooldown before restoring static glass", () => {
  const app = read("public/app.js"), css = read("public/style.css"),
    material = functionSource(app, "noteCanvasChromeInteraction"),
    restoreMaterial = functionSource(app, "restoreCanvasChromeMaterial"),
    navigating = functionSource(app, "setNavigating"),
    navigationPreview = functionSource(app, "requestCanvasNavigationPreview"),
    beginDrawing = functionSource(app, "beginCanvasPointerAction"),
    finishDrawing = functionSource(app, "finishDrawing"),
    openAgent = app.slice(app.indexOf("function openCanvasAgent"), app.indexOf("function closeCanvasAgent")),
    openNavigator = app.slice(app.indexOf("function setStudioNavigatorOpen"), app.indexOf("function syncStudioNavigatorTheme"));

  assert.match(app, /CANVAS_CHROME_MATERIAL_RESTORE_MS\s*=\s*1000/);
  assert.match(material, /canvasChromeMaterialDeadline = now \+ CANVAS_CHROME_MATERIAL_RESTORE_MS/);
  assert.match(material, /if \(!state\.canvasChromeMaterialActive\)[\s\S]*?classList\.add\("canvas-chrome-lightweight"\)/);
  assert.match(material, /if \(state\.canvasChromeMaterialTimer\) return/);
  assert.match(material, /remaining > 16[\s\S]*?setTimeout\(restore, remaining\)/);
  assert.match(material, /canvasChromeMaterialActive = false[\s\S]*?classList\.remove\("canvas-chrome-lightweight"\)/);
  assert.match(material, /classList\.remove\("canvas-chrome-lightweight"\)/);
  assert.match(restoreMaterial, /clearTimeout\(state\.canvasChromeMaterialTimer\)[\s\S]*?canvasChromeMaterialActive = false[\s\S]*?classList\.remove\("canvas-chrome-lightweight"\)/);
  assert.match(navigationPreview, /noteCanvasChromeInteraction\(\)[\s\S]*?classList\.add\("canvas-navigation-previewing"\)/);
  assert.doesNotMatch(navigating, /noteCanvasChromeInteraction/);
  assert.match(navigating, /navigationDeadline = now \+ NAVIGATION_HINT_VISIBLE_MS/);
  assert.match(navigating, /if \(state\.navigationTimer\) return/);
  assert.match(navigating, /remaining > 16[\s\S]*?setTimeout\(hide, remaining\)/);
  assert.doesNotMatch(navigating, /clearTimeout/);
  assert.match(beginDrawing, /noteCanvasChromeInteraction\(\)[\s\S]*?classList\.add\("is-drawing"\)/);
  assert.match(finishDrawing, /state\.drawing = null[\s\S]*?noteCanvasChromeInteraction\(\)[\s\S]*?classList\.remove\("is-drawing"\)/);
  assert.match(openAgent, /restoreCanvasChromeMaterial\(\)[\s\S]*?classList\.add\("canvas-agent-open"\)/);
  assert.match(openNavigator, /if \(open\) restoreCanvasChromeMaterial\(\)[\s\S]*?classList\.toggle\("studio-navigator-open"/);
  assert.match(css, /body\[data-theme="studio"\]:has\(#viewport:is\(\.canvas-chrome-lightweight, \.is-drawing\)\) \.toolbar\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--studio-toolbar\) 88%, transparent\)[^}]*backdrop-filter:\s*none/);
  assert.match(css, /body\[data-theme="studio"\]:has\(#viewport:is\(\.canvas-chrome-lightweight, \.is-drawing\)\) \.studio-navigator\s*\{[^}]*background:\s*var\(--studio-panel\)[^}]*backdrop-filter:\s*none/);
  assert.match(css, /studio-agent-docked:has\(#viewport:is\(\.canvas-chrome-lightweight, \.is-drawing\)\) \.canvas-agent-panel\s*\{[^}]*background:\s*var\(--studio-panel\)[^}]*backdrop-filter:\s*none/);
  assert.match(css, /@media \(prefers-reduced-transparency: reduce\), \(prefers-contrast: more\)\s*\{[\s\S]*?body\[data-theme="studio"\] \.toolbar\s*\{[^}]*background:\s*var\(--studio-toolbar\) !important[^}]*backdrop-filter:\s*none !important[\s\S]*?studio-agent-docked \.canvas-agent-panel\s*\{[^}]*background:\s*var\(--studio-panel\) !important[^}]*backdrop-filter:\s*none !important/);

  let now = 100, timerId = 0;
  const timers = [], classes = new Set(), state = { canvasChromeMaterialTimer:0, canvasChromeMaterialDeadline:0, canvasChromeMaterialActive:false },
    note = vm.runInNewContext(`(${material})`, {
      CANVAS_CHROME_MATERIAL_RESTORE_MS:1000,
      performance:{ now:() => now }, state,
      view:{ classList:{
        add(value) { classes.add(value); },
        remove(value) { classes.delete(value); },
      } },
      setTimeout(callback, delay) { timers.push({ callback, delay }); return ++timerId; },
    });
  note();
  assert.equal(timers.length, 1, "the first interaction owns one restore timer");
  assert.equal(state.canvasChromeMaterialDeadline, 1100);
  assert.equal(state.canvasChromeMaterialActive, true);
  assert.ok(classes.has("canvas-chrome-lightweight"));
  now = 900;
  note();
  assert.equal(timers.length, 1, "repeated hot-path events only extend the deadline");
  assert.equal(state.canvasChromeMaterialDeadline, 1900);
  now = 1100;
  timers[0].callback();
  assert.equal(timers.length, 2);
  assert.equal(timers[1].delay, 800);
  assert.ok(classes.has("canvas-chrome-lightweight"));
  now = 1901;
  timers[1].callback();
  assert.equal(state.canvasChromeMaterialTimer, 0);
  assert.equal(state.canvasChromeMaterialActive, false);
  assert.ok(!classes.has("canvas-chrome-lightweight"));

  now = 2000;
  note();
  const activeTimer = state.canvasChromeMaterialTimer,
    clearedTimers = [], restore = vm.runInNewContext(`(${restoreMaterial})`, {
    state,
    view:{ classList:{ remove(value) { classes.delete(value); } } },
    clearTimeout(id) { clearedTimers.push(id); },
  });
  restore();
  assert.deepEqual(clearedTimers, [activeTimer]);
  assert.equal(state.canvasChromeMaterialTimer, 0);
  assert.equal(state.canvasChromeMaterialDeadline, 0);
  assert.equal(state.canvasChromeMaterialActive, false);
  assert.ok(!classes.has("canvas-chrome-lightweight"), "opening a sidebar restores true frost immediately");

  let navigationNow = 100, navigationTimerId = 0, followFlushes = 0;
  const navigationTimers = [], navigationClasses = new Set(),
    navigationState = { navigationTimer:0, navigationDeadline:0 },
    runNavigation = vm.runInNewContext(`(${navigating})`, {
      NAVIGATION_HINT_VISIBLE_MS:10000,
      performance:{ now:() => navigationNow }, navigationState,
      state:navigationState,
      noteCanvasChromeInteraction() {},
      window:{PenEchoStudioNavigator:{flushMcpFollow(){followFlushes++;}}},
      view:{ classList:{
        add(value) { navigationClasses.add(value); },
        remove(value) { navigationClasses.delete(value); },
        contains(value) { return navigationClasses.has(value); },
      } },
      setTimeout(callback, delay) { navigationTimers.push({ callback, delay }); return ++navigationTimerId; },
    });
  runNavigation(true);
  assert.equal(navigationTimers.length, 1, "navigation starts one hint timer");
  assert.equal(navigationState.navigationDeadline, 10100);
  assert.ok(navigationClasses.has("is-navigating"));
  navigationNow = 900;
  runNavigation(true);
  assert.equal(navigationTimers.length, 1, "wheel events only extend the navigation deadline");
  assert.equal(navigationState.navigationDeadline, 10900);
  navigationNow = 10100;
  navigationTimers[0].callback();
  assert.equal(navigationTimers.length, 2);
  assert.equal(navigationTimers[1].delay, 800);
  assert.ok(navigationClasses.has("is-navigating"));
  assert.equal(followFlushes, 0, "follow latest waits for the full navigation deadline");
  navigationNow = 10901;
  navigationTimers[1].callback();
  assert.equal(navigationState.navigationTimer, 0);
  assert.equal(navigationState.navigationDeadline, 0);
  assert.ok(!navigationClasses.has("is-navigating"));
  assert.equal(followFlushes, 1, "follow latest resumes once navigation ends");
});

test("canvas navigation lock freezes only the outer view and leaves locked widgets interactive", () => {
  const html = read("public/index.html"),
    app = read("public/app.js"),
    css = read("public/style.css"),
    host = read("public/widget-host.js"),
    zh = read("public/locales/zh.js"),
    toggle = functionSource(app, "setCanvasNavigationLocked"),
    move = functionSource(app, "moveCanvas"),
    zoom = functionSource(app, "zoomCanvasAt"),
    pinch = functionSource(app, "updateTouchGesture"),
    hostState = functionSource(app, "sendWidgetHostState"),
    loadSnapshot = functionSource(app, "loadSnapshot");

  assert.match(html, /id="canvasNavigationLock"[^>]*aria-pressed="false"[^>]*data-i18n-aria="canvasLockNavigation"/);
  assert.match(html, /id="canvasNavigationLockHint"[^>]*data-i18n="canvasNavigationLockedHint"/);
  assert.match(css, /\.canvas-navigation-lock\s*\{[^}]*top:\s*6px[^}]*left:\s*6px[^}]*width:\s*30px[^}]*height:\s*30px[^}]*opacity:\s*\.3/);
  assert.match(css, /#viewport\.is-navigating \.canvas-navigation-lock[^}]*opacity:\s*\.58/);
  assert.match(css, /\.canvas-navigation-lock\.locked[^}]*opacity:\s*\.76/);
  assert.match(css, /body\[data-theme="arcane"\] \.canvas-navigation-lock:not\(\.locked\)\s*\{[^}]*var\(--outside\)[^}]*opacity:\s*\.52/);
  assert.match(css, /body\[data-theme="arcane"\] #viewport\.is-navigating \.canvas-navigation-lock:not\(\.locked\)[\s\S]*?opacity:\s*\.68/);
  assert.match(css, /body\[data-theme="scifi"\] \.canvas-navigation-lock:not\(\.locked\)\s*\{[^}]*var\(--outside\) 78%[^}]*opacity:\s*\.38/);
  assert.match(css, /body\[data-theme="scifi"\] #viewport\.is-navigating \.canvas-navigation-lock:not\(\.locked\)\s*\{[^}]*opacity:\s*\.5/);
  assert.match(css, /body\[data-theme="scifi"\] \.canvas-navigation-lock:not\(\.locked\):hover[\s\S]*?opacity:\s*\.66/);
  assert.match(html, /id="canvasFitContents"[^>]*class="canvas-fit-contents"[^>]*data-i18n-aria="canvasFitContents"/);
  assert.doesNotMatch(html, /id="canvasZoom(?:Out|In|Reset)"/);
  assert.match(css, /\.canvas-fit-contents\s*\{[^}]*bottom:\s*6px[^}]*left:\s*6px[^}]*width:\s*30px[^}]*height:\s*30px[^}]*opacity:\s*\.3/);
  assert.match(css, /#viewport\.is-navigating \.canvas-fit-contents[^}]*opacity:\s*\.58/);
  assert.match(css, /\.canvas-navigation-lock-hint\s*\{[^}]*max-width:\s*min\(440px, 100%\)[^}]*visibility:\s*hidden[^}]*opacity:\s*0[^}]*white-space:\s*nowrap/);
  assert.match(css, /main:has\(#viewport\.navigation-locked\) \.canvas-navigation-lock-hint\s*\{[^}]*visibility:\s*visible[^}]*opacity:\s*1/);
  assert.match(app, /NAVIGATION_HINT_VISIBLE_MS\s*=\s*10000/);
  assert.match(toggle, /state\.navigationLocked = Boolean\(locked\)[\s\S]*?view\.classList\.toggle\("navigation-locked"[\s\S]*?syncWidgetHostStates\(\)[\s\S]*?setNavigating\(true\)/);
  assert.match(move, /if \(state\.navigationLocked\)[\s\S]*?return false[\s\S]*?canvasClientDelta\(dx, dy\)[\s\S]*?state\.panX \+= delta\.x/);
  assert.match(zoom, /if \(state\.navigationLocked\)[\s\S]*?return false[\s\S]*?state\.scale = next/);
  assert.match(pinch, /if \(state\.navigationLocked\)[\s\S]*?return false[\s\S]*?state\.scale = next/);
  assert.match(zoom, /requestCoordinatesUpdate\(\)[\s\S]*?requestCanvasNavigationPreview\(previousPanX, previousPanY, previousScale\)/);
  assert.match(pinch, /requestCoordinatesUpdate\(\)[\s\S]*?requestCanvasNavigationPreview\(previousPanX, previousPanY, previousScale\)/);
  assert.doesNotMatch(zoom, /requestRender\(|\brender\(/);
  assert.doesNotMatch(pinch, /requestRender\(/);
  assert.doesNotMatch(pinch, /\brender\(\)/);
  assert.match(hostState, /navigationLocked:state\.navigationLocked/);
  assert.doesNotMatch(host, /addEventListener\("wheel"|penecho-widget-wheel|penecho-widget-pan-(?:start|move|end)/);
  assert.match(host, /press\.pointerType === "touch"\) pointerMessage\(TOUCH_END/);
  assert.match(host, /press\.pointerType === "touch"\) \{[\s\S]*?pointerMessage\(TOUCH_START/);
  assert.doesNotMatch(host, /press\.pointerType === "touch" && !widgetState\.navigationLocked/);
  assert.match(app, /async function saveSnapshot\([\s\S]*?view:\s*\{[^}]*scale:\s*state\.scale[^}]*panX:\s*state\.panX[^}]*panY:\s*state\.panY[^}]*navigationLocked:\s*state\.navigationLocked/);
  assert.match(loadSnapshot, /setCanvasNavigationLocked\(item\.view\?\.navigationLocked === true\)/);
  assert.match(zh, /canvasLockNavigation:\s*"锁定画布移动和缩放"[\s\S]*?canvasUnlockNavigation:\s*"解锁画布移动和缩放"[\s\S]*?canvasNavigationLockedHint:\s*"当前画布视野已锁定 · 点击左上角锁图标解锁"/);
  assert.doesNotMatch(toggle, /localStorage|save\(/);
});

test("canvas view mode exposes quiet share, download, and exit controls while preserving pan and zoom", () => {
  const html = read("public/index.html"),
    app = read("public/app.js"),
    css = read("public/style.css"),
    zh = read("public/locales/zh.js"),
    viewMode = functionSource(app, "setCanvasViewMode"),
    renderInteraction = functionSource(app, "renderInteractionLayer"),
    pointerDown = app.slice(app.indexOf('function handleCanvasPointerDown('), app.indexOf('screen.addEventListener("pointermove"')),
    pointerMove = app.slice(app.indexOf('screen.addEventListener("pointermove"'), app.indexOf("function end(e)")),
    pointerEnd = functionSource(app, "end"),
    modeTools = html.match(/<div class="mode-tools">[\s\S]*?<\/div>/)?.[0] || "",
    viewTools = html.match(/<span class="view-tools">[\s\S]*?<\/span>/)?.[0] || "";

  assert.ok(modeTools.indexOf('id="canvasViewBtn"') < modeTools.indexOf('id="handToolBtn"'));
  assert.doesNotMatch(viewTools, /id="canvasViewBtn"/);
  assert.ok(viewTools.indexOf('id="fullscreenBtn"') < viewTools.indexOf('id="gridToggle"'));
  assert.match(html, /id="canvasViewBtn"[^>]*aria-pressed="false"[^>]*data-i18n-aria="enterCanvasViewMode"[\s\S]*?<circle cx="12" cy="12" r="2\.8"/);
  assert.match(html, /id="canvasViewActions"[^>]*role="toolbar"[^>]*hidden[\s\S]*?id="canvasViewShareBtn"[\s\S]*?id="canvasViewDownloadBtn"[\s\S]*?id="canvasViewCloseBtn"/);
  for (const key of ["enterCanvasViewMode", "exitCanvasViewMode", "canvasViewModeActions"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
  assert.match(viewMode, /document\.body\.classList\.toggle\("canvas-view-mode", enabled\)/);
  assert.match(viewMode, /view\.classList\.toggle\("view-mode", enabled\)/);
  assert.match(viewMode, /element\.inert = true[\s\S]*?data-canvas-view-inert/);
  assert.match(viewMode, /state\.viewModeNavigationLocked = state\.navigationLocked[\s\S]*?setCanvasNavigationLocked\(false\)/);
  assert.match(viewMode, /closeCanvasAgent\(\)/);
  assert.match(viewMode, /state\.viewModeNavigationLocked[\s\S]*?setCanvasNavigationLocked\(true\)/);
  assert.match(viewMode, /syncCanvasNavigation\(\)/);
  assert.doesNotMatch(viewMode, /"\.widget-layer"/);
  assert.match(pointerDown, /if \(state\.viewMode\)[\s\S]*?state\.panGesture = \{ id:e\.pointerId/);
  assert.match(pointerMove, /if \(state\.viewMode\)[\s\S]*?updateTouchGesture\(\)[\s\S]*?moveCanvas\(/);
  assert.match(pointerEnd, /if \(state\.viewMode\)[\s\S]*?state\.touchGesture = null[\s\S]*?setCanvasCursor\("grab"\)/);
  assert.match(renderInteraction, /if \(state\.viewMode\)[\s\S]*?drawSelectionContent\(state\.selection[\s\S]*?drawPending\(state\.pending, interactionCtx, \{ chrome:false \}\)[\s\S]*?return/);
  assert.match(app, /canvasViewShareButton\.onclick = \(\) => document\.querySelector\("#shareCanvasBtn"\)\?\.click\(\)/);
  assert.match(app, /canvasViewDownloadButton\.onclick = exportCanvasPng/);
  assert.match(css, /\.canvas-view-actions, \.canvas-navigation-actions\s*\{[^}]*z-index:\s*60/);
  assert.match(css, /\.canvas-view-actions button\[aria-pressed="true"\]/);
  assert.match(css, /body\.canvas-view-mode main\s*\{[^}]*height:\s*100dvh[^}]*padding:\s*0/);
  assert.match(css, /body\.canvas-view-mode \.canvas-frame::before,\s*body\.canvas-view-mode \.canvas-frame::after,\s*body\.canvas-view-mode \.frame-corner\s*\{\s*display:\s*none/);
  assert.match(css, /#viewport\.view-mode \.canvas-navigation-lock,[\s\S]*?body\.canvas-view-mode \.page-hint-slot\s*\{\s*display:\s*none !important/);
  assert.match(css, /#viewport\.view-mode:not\(\.widget-selection-enabled\) \.canvas-widget-frame\s*\{\s*pointer-events:\s*none/);
});

test("declarative scenes and widgets render below the dedicated ink and interaction layers", () => {
  const html = read("public/index.html"), app = read("public/app.js"), css = read("public/style.css");
  assert.ok(html.indexOf('src="animation.js"') < html.indexOf('src="app.js"'));
  for (const id of ["animationLayer", "placedContentLayer", "inkLayer", "liveInkLayer", "interactionLayer", "objectChromeLayer", "animationControls", "animationPlayPause", "animationRestart", "animationDelete"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.ok(html.indexOf('id="screen"') < html.indexOf('id="animationLayer"'));
  assert.ok(html.indexOf('id="widgetLayer"') < html.indexOf('id="placedContentLayer"'));
  assert.ok(html.indexOf('id="placedContentLayer"') < html.indexOf('id="inkLayer"'));
  assert.ok(html.indexOf('id="inkLayer"') < html.indexOf('id="liveInkLayer"'));
  assert.ok(html.indexOf('id="liveInkLayer"') < html.indexOf('id="interactionLayer"'));
  assert.ok(html.indexOf('id="inkLayer"') < html.indexOf('id="interactionLayer"'));
  assert.ok(html.indexOf('id="animationLayer"') < html.indexOf('id="interactionLayer"'));
  assert.match(css, /\.animation-layer\s*\{[^}]*z-index:\s*1/);
  assert.match(css, /\.placed-content-layer\s*\{[^}]*z-index:\s*2/);
  assert.match(css, /\.ink-layer\s*\{[^}]*z-index:\s*2/);
  assert.match(css, /\.live-ink-layer\s*\{[^}]*z-index:\s*2[^}]*pointer-events:\s*none[^}]*transform:\s*translateZ\(0\)[^}]*will-change:\s*transform/);
  assert.match(css, /\.interaction-layer\s*\{[^}]*z-index:\s*3/);
  assert.match(functionSource(app, "renderInkLayer"), /forTiles[\s\S]*?drawSharpOverlays/);
  assert.doesNotMatch(functionSource(app, "render"), /forTiles\(l, t/);
  assert.match(app, /acceptedTools\.includes\(c\.tool\)/);
  assert.match(app, /animations = serializedAnimations\(\),[\s\S]*?animationCount: animations\.length,[\s\S]*?animations,/);
  assert.match(app, /captureTime = performance\.now\(\)/);
  assert.match(app, /drawAnimationsToContext\(q, sourceRect, captureTime\)/);
  assert.match(app, /document\.addEventListener\("visibilitychange"[\s\S]*?document\.hidden\) stopAnimationFrames\(\)/);
  assert.match(app, /renderObjectCount = playing\.reduce[\s\S]*?minimumFrameMs = 1000 \/ \(renderObjectCount > 24 \? 30 : 60\)/);
  assert.match(functionSource(app, "renderAnimationLayer"), /mergeAnimationDirtyRects[\s\S]*?clearRect\(region\.x, region\.y, region\.w, region\.h\)/);
  assert.match(functionSource(app, "renderInteractionLayer"), /drawPreview[\s\S]*?drawSelection[\s\S]*?drawSelectedAnimation[\s\S]*?drawPending/);
  assert.match(app, /SNAPSHOT_TILE_DECODE_BATCH_SIZE = 8/);
  const decodeTiles = functionSource(app, "decodeSnapshotTilesInBatches"),
    loadSnapshot = functionSource(app, "loadSnapshot");
  assert.match(decodeTiles, /Promise\.all\(tileEntries\.slice\(start, end\)[\s\S]*?context\.drawImage\(image, 0, 0\)[\s\S]*?batch\.length = 0[\s\S]*?waitForSnapshotTileFrame\(\)/);
  assert.match(loadSnapshot, /decodeSnapshotTilesInBatches\(tileEntries, loadIsCurrent,[\s\S]*?for \(const \[k, canvas\] of decodedTiles\) tiles\.set\(k, canvas\);[\s\S]*?restoreWidgets\(item\.widgets\)/);
  assert.doesNotMatch(loadSnapshot, /Promise\.all\(tileEntries\.map/);

  const end = functionSource(app, "end"),
    captureSelection = functionSource(app, "captureSelection"),
    eraseRect = functionSource(app, "eraseRect"),
    eraseWithMask = functionSource(app, "eraseWithMask");
  assert.ok(end.indexOf("state.animationGesture") < end.indexOf("state.selectionGesture"));
  assert.ok(captureSelection.indexOf("invalidateSharpOverlays(box)") > captureSelection.indexOf("if (!fragments.length)"));
  assert.match(eraseRect, /invalidateSharpOverlays\(\{ x, y, w, h \}\);[\s\S]*?forTiles\(/);
  assert.match(eraseWithMask, /invalidateSharpOverlays\(\{ x, y, w, h \}\);[\s\S]*?forTiles\(/);

  const restoreState = { animations: [{ id:"existing" }], selectedAnimationId: "existing", animationEdit:{ id:"existing" }, nextAnimationId: 1 },
    restore = vm.runInNewContext(`(${functionSource(app, "restoreAnimations")})`, {
      clearHandToolbarTargets: () => {},
      hideAnimationControls: () => {},
      requestAnimationLayerRender: () => {},
      state: restoreState,
    }),
    saved = {
      id: "animation-1",
      scene: { durationMs: 1000 },
      transform: { x: 10, y: 20, w: 300, h: 200 },
      playback: { playheadMs: 250, paused: true },
    };
  restore(Array.from({ length: 102 }, () => saved));
  assert.equal(restoreState.animations.length, 0);
  assert.equal(restoreState.selectedAnimationId, null);
  assert.equal(restoreState.animationEdit, null);
  assert.equal(restoreState.nextAnimationId, 1);
});

test("plugin manager is a centered dynamic catalog with General HTML and bundled local plugins", () => {
  const html = read("public/index.html"), app = read("public/app.js"), zh = read("public/locales/zh.js");
  const css = read("public/style.css");
  for (const id of ["pluginButton", "pluginPopover", "pluginOptions", "pluginClose", "pluginRefresh", "pluginLocalTab", "pluginCreateTab", "pluginServerTab", "pluginLocalPanel", "pluginCreatePanel", "pluginServerPanel"]) assert.match(html, new RegExp(`id="${id}"`));
  const toolbar = html.match(/<nav class="toolbar"[\s\S]*?<\/nav>/)?.[0] || "";
  assert.doesNotMatch(html, /id="pluginControl"/);
  assert.doesNotMatch(toolbar, /id="pluginButton"/);
  assert.match(html, /id="settingsPanel"[\s\S]*?id="pluginButton"[^>]*aria-haspopup="dialog"[^>]*aria-controls="pluginPopover"[\s\S]*?data-i18n="settingsPluginsEntryHelp"/);
  assert.match(app, /pluginButton\.onclick = \(\) => \{[\s\S]*?closeSettings\(false\);[\s\S]*?showPluginControl\(\);/);
  assert.doesNotMatch(html, /id="animationPluginEnabled"/);
  assert.match(app, /BUILTIN_PLUGIN_DEFINITIONS\s*=\s*Object\.freeze\(\[/);
  assert.match(app, /PLUGIN_DEFINITIONS\s*=\s*\[\.\.\.BUILTIN_PLUGIN_DEFINITIONS\]/);
  assert.match(app, /BUILTIN_PLUGIN_DEFINITIONS\s*=\s*Object\.freeze\(\[\]\)/);
  assert.doesNotMatch(app, /documentPath:\s*"plugins\/weather\.md"/);
  const loadPluginDocuments = functionSource(app, "loadPluginDocuments");
  assert.match(loadPluginDocuments, /nativeCloudCanvasReadsEnabled = window\.PENECHO_CONFIG\?\.runtime === "cloud" && window\.PENECHO_CONFIG\?\.remoteCanvasNativeReads === true[\s\S]*?catalogRequests = nativeCloudCanvasReadsEnabled[\s\S]*?path:"\/api\/plugins", cache:"default"[\s\S]*?path:"\/api\/plugins\?scope=private", cache:"no-store"[\s\S]*?optional:true[\s\S]*?: \[\{ path:"\/api\/plugins", cache:"no-store", accept:\(\) => true \}\][\s\S]*?if \(!request\.optional\) throw error[\s\S]*?catalog:\{ plugins:\[\] \}[\s\S]*?defaultEnabled:\["general", "flowchart"\]\.includes\(item\.manifest\.id\)[\s\S]*?professionalDefinitions = definitions\.filter\(\(definition\) => definition\.id === "flowchart"\)[\s\S]*?promotedDefinitions = \["image-search", "weather"\][\s\S]*?PLUGIN_DEFINITIONS\.splice\(0, PLUGIN_DEFINITIONS\.length, \.\.\.generalDefinitions, \.\.\.professionalDefinitions, \.\.\.BUILTIN_PLUGIN_DEFINITIONS, \.\.\.promotedDefinitions, \.\.\.remainingDefinitions\)/);
  const enabledPluginDescriptors = functionSource(app, "enabledPluginDescriptors");
  assert.match(enabledPluginDescriptors, /id === "general" \? 0 : id === "flowchart" \? 1 : 2/);
  assert.doesNotMatch(enabledPluginDescriptors, /styles/);
  assert.match(app, /localStorage\.setItem\(PLUGIN_STORAGE_KEY, JSON\.stringify/);
  assert.match(app, /if \(!state\.pluginCatalogLoaded\) void loadPluginDocuments\(\)/);
  assert.match(app, /applyTheme\(state\.theme\);\s*applyStudioPalette\(state\.studioPalette\);\s*applyPageScale\(state\.pageScale\);\s*resetCanvasCursor\(\);\s*loadPluginDocuments\(\)\.catch/);
  assert.match(app, /function pluginRequestPayload\(\)/);
  assert.match(app, /\.\.\.pluginRequestPayload\(\)/);
  assert.match(app, /function authenticatedApiHeaders\([\s\S]*?X-PenEcho-Session/);
  assert.match(app, /AI_CONNECTION_STORAGE_KEY = "penecho-ai-connection-id"/);
  assert.match(functionSource(app, "canvasClientId"), /crypto\.getRandomValues\(new Uint8Array\(16\)\)/);
  assert.match(app, /AI_CLIENT_ID = canvasClientId\(\)/);
  assert.match(app, /function authenticatedApiHeaders\([\s\S]*?X-PenEcho-Client/);
  assert.match(app, /function aiRequestHeaders\([\s\S]*?X-PenEcho-Connection/);
  assert.match(functionSource(app, "readAiCommandResponse"), /application\/x-ndjson[\s\S]*?response\.body\.getReader\(\)[\s\S]*?event\?\.type\s*===\s*"progress"[\s\S]*?onActivity[\s\S]*?terminal\.type\s*===\s*"result"/);
  assert.match(functionSource(app, "applyAiProgress"), /run\.superseded\|\|state\.activeAI!==run[\s\S]*?setStatus\(text,AI_PROGRESS_STATUS_KEYS\[event\.phase\]\)/);
  assert.match(functionSource(app, "applyAiProgress"), /event\?\.phase==="waiting"[\s\S]*?\["retrying","image-fallback"\]/);
  assert.match(functionSource(app, "requestAI"), /setStatusKey\("aiPreparingCanvas"\)[\s\S]*?setStatusKey\("aiSendingRequest"\)[\s\S]*?Accept:"application\/x-ndjson, application\/json"[\s\S]*?readAiCommandResponse/);
  assert.match(functionSource(app, "activeAiRequestTimeoutMs"), /state\.reasoningEffort === "config"[\s\S]*?aiTimeoutMultiplier/);
  assert.match(functionSource(app, "createActivityAwareAbortTimeout"), /deadline[\s\S]*?lastActivityAt[\s\S]*?idleGraceMs[\s\S]*?controller\.abort/);
  assert.match(functionSource(app, "requestAI"), /requestTimeoutMs=activeAiRequestTimeoutMs\(\)[\s\S]*?slowNoticeDelay[\s\S]*?requestTimeoutMs\/3[\s\S]*?phase:"slow"[\s\S]*?timeoutSeconds:Math\.ceil\(requestTimeoutMs\/1000\)[\s\S]*?timeout\.clear\(\)/);
  assert.match(functionSource(app, "supersedeActiveAI"), /aiCancelledForInput[\s\S]*?aiCancelled/);
  assert.doesNotMatch(functionSource(app, "readAiCommandResponse"), /setTimeout|setInterval|\/api\/ai\/progress|fetch\(/);
  assert.match(app, /MULTILINE_STATUS_KEYS = new Set\(\["widgetRefinePending"\]\)/);
  assert.match(app, /multiline=MULTILINE_STATUS_KEYS\.has\(key\)[\s\S]*?status\.dataset\.multiline=String\(multiline\)[\s\S]*?status\.title=progress\|\|multiline\?text:""/);
  const statusNode = { dataset:{}, textContent:"", title:"" }, statusState = { aiProgressEvent:{ phase:"running" }, statusKey:"ready" },
    statusSourceStart = app.indexOf("const AI_NON_PROGRESS_STATUS_KEYS"),
    statusSourceEnd = app.indexOf("const setStatusKey", statusSourceStart),
    setStatusForTest = Function("status", "state", `${app.slice(statusSourceStart, statusSourceEnd)}; return setStatus;`)(statusNode, statusState);
  setStatusForTest("Widget guidance", "widgetRefinePending");
  assert.deepEqual(statusNode.dataset, { aiProgress:"false", multiline:"true" });
  setStatusForTest("Ready", "ready");
  assert.deepEqual(statusNode.dataset, { aiProgress:"false", multiline:"false" });
  setStatusForTest("Reading response", "aiReadingResponse");
  assert.deepEqual(statusNode.dataset, { aiProgress:"true", multiline:"false" });
  assert.match(css, /#status\[data-ai-progress="true"\],\s*body\[data-theme="studio"\] #status\[data-multiline="true"\]\s*\{[^}]*width:\s*min\(310px, 32vw\)[^}]*min-width:\s*0[^}]*max-height:\s*36px[^}]*display:\s*-webkit-box/);
  assert.match(css, /#status\s*\{[^}]*height:\s*38px[^}]*display:\s*grid[^}]*align-items:\s*center/);
  assert.match(css, /#status\[data-ai-progress="true"\],\s*body\[data-theme="studio"\] #status\[data-multiline="true"\]\s*\{[^}]*font-size:\s*var\(--pe-type-supporting, 12px\)[^}]*overflow-wrap:\s*anywhere[^}]*white-space:\s*normal[^}]*-webkit-line-clamp:\s*2[^}]*line-clamp:\s*2/);
  assert.match(css, /body\[data-theme="studio"\] #aiStatusArea\s*\{[^}]*min-width:\s*0[^}]*margin-left:\s*auto/);
  assert.match(css, /@media \(min-width:\s*901px\)\s*\{\s*body\[data-theme="studio"\] #aiStatusArea\s*\{[^}]*min-width:\s*0[^}]*flex:\s*1 1 auto[^}]*margin-left:\s*0[^}]*\}\s*body\[data-theme="studio"\] #status:is\(\[data-ai-progress="true"\], \[data-multiline="true"\]\)\s*\{[^}]*width:\s*auto[^}]*min-width:\s*0[^}]*max-width:\s*100%[^}]*flex:\s*1 1 auto/);
  assert.match(css, /\.top-row\s*\{[^}]*display:\s*flex[^}]*gap:\s*7px/);
  assert.match(css, /body\[data-theme="studio"\] \.canvas-document-meta\s*\{[^}]*flex:\s*0 0 auto/);
  assert.match(css, /body\[data-theme="studio"\] \.canvas-document-save\s*\{[^}]*flex:\s*0 0 auto/);
  assert.match(css, /@media \(max-width:\s*900px\)[\s\S]*?body\[data-theme="studio"\] #status:is\(\[data-ai-progress="true"\], \[data-multiline="true"\]\)\s*\{[^}]*width:\s*20px[^}]*min-width:\s*20px[^}]*max-width:\s*20px[^}]*height:\s*30px[^}]*overflow:\s*hidden[^}]*font-size:\s*0[^}]*line-height:\s*0[^}]*white-space:\s*nowrap/);
  assert.match(css, /@media \(max-width:\s*620px\)[\s\S]*?#status\s*\{[^}]*width:\s*min\(210px, calc\(100vw - 20px\)\)[^}]*min-width:\s*min\(210px, calc\(100vw - 20px\)\)[^}]*max-width:\s*min\(210px, calc\(100vw - 20px\)\)/);
  assert.match(css, /@media \(max-width:\s*620px\)[\s\S]*?#status\[data-ai-progress="true"\]\s*\{[^}]*min-width:\s*min\(210px, calc\(100vw - 20px\)\)/);
  const handleConnectionAction = functionSource(app, "handleConnectionAction");
  assert.match(handleConnectionAction, /storeAiConnectionSelection\(id\)/);
  assert.match(functionSource(app, "storeAiConnectionSelection"), /key = aiConnectionStorageKey\(hosted\)[\s\S]*?if \(!key\) return false[\s\S]*?localStorage\.setItem\(key, id\)/);
  assert.match(handleConnectionAction, /closeAfterActivation = settingsConnectionQuickList\?\.contains\(button\) === true[\s\S]*?if \(closeAfterActivation\) closeSettings\(\)/);
  assert.doesNotMatch(handleConnectionAction, /updateConnection\("activate"/);
  assert.match(app, /fetch\("\/api\/plugins\/improve"[\s\S]*?headers:aiRequestHeaders/);
  assert.match(app, /fetch\("\/api\/ai\/command"[\s\S]*?headers:\s*aiRequestHeaders/);
  assert.match(functionSource(app, "validate"), /acceptedTools = \["write_text", "draw_formula", "plot_function", "draw", "erase"\]/);
  assert.doesNotMatch(functionSource(app, "validate"), /animate_scene/);
  assert.match(functionSource(app, "renderPluginOptions"), /localizedManifestValue[\s\S]*?pluginPromptEstimate[\s\S]*?copy\.append\(titleRow, help, meta\)/);
  assert.match(functionSource(app, "renderPluginOptions"), /plugin\.id === "general" \? t\("pluginPublicHttps"\)/);
  assert.match(app, /pluginPromptEstimate:\s*"adds about \{tokens\} prompt tokens to each AI request while enabled; once on canvas, display, interaction, refresh, and rendering use no tokens"/);
  assert.match(app, /MAX_VISIBLE_WIDGETS = 100/);
  assert.match(app, /widgetLimitReached:\s*"Live widget limit reached \(100\)/);
  assert.match(zh, /pluginPromptEstimate:\s*"启用时，每次 AI 请求约增加 \{tokens\} 个 prompt token；内容添加到画布后，显示、交互、刷新和重绘都不消耗 token"/);
  assert.match(zh, /widgetLimitReached:\s*"实时组件已达到 100 个上限/);
  assert.match(functionSource(app, "renderPluginOptions"), /plugin\.id === "general"[\s\S]*?pluginRecommended[\s\S]*?generalPluginRecommendedHelp/);
  assert.match(functionSource(app, "renderPluginOptions"), /pluginSourceLabel[\s\S]*?pluginApiLabel[\s\S]*?manifest\.connect\.length[\s\S]*?pluginNoNetwork/);
  assert.match(functionSource(app, "renderPluginOptions"), /pluginPersonalSection[\s\S]*?plugin\.builtIn === false[\s\S]*?pluginBuiltInSection[\s\S]*?plugin\.builtIn !== false/);
  assert.match(functionSource(app, "renderPluginOptions"), /detailDocument[\s\S]*?pluginBuiltInRuntime[\s\S]*?dataset\.pluginDetail[\s\S]*?manifest\?\.document[\s\S]*?dataset\.pluginCopy/);
  assert.match(functionSource(app, "togglePluginDetails"), /detail\.hidden[\s\S]*?aria-expanded/);
  assert.match(functionSource(app, "copyPluginMarkdown"), /writeClipboardText\(document\)[\s\S]*?pluginMarkdownCopied[\s\S]*?pluginMarkdownCopyFailed/);
  assert.match(functionSource(app, "validPluginCatalogPath"), /plugin\\{2}\.md|plugin\\\\\.md/);
  assert.match(functionSource(app, "validPluginCatalogPath"), /styles\\{2}\.css|styles\\\\\.css/);
  assert.match(css, /\.plugin-option-section-title\s*\{/);
  assert.match(css, /\.plugin-option-detail\s*\{[^}]*grid-column:\s*1 \/ -1/);
  assert.match(zh, /pluginDetails:\s*"详情"/);
  assert.match(zh, /copyPluginMarkdown:\s*"复制 Markdown"/);
  assert.match(css, /\.plugin-option-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.plugin-control\s*\{[^}]*height:\s*28px;\s*min-height:\s*28px[^}]*border:\s*0[^}]*background:\s*transparent[^}]*box-shadow:\s*none/);
  const updatePluginControl = functionSource(app, "updatePluginControl");
  assert.match(updatePluginControl, /classList\.toggle\("active", !pluginPopover\.hidden\)/);
  assert.match(updatePluginControl, /removeAttribute\("aria-pressed"\)/);
  assert.doesNotMatch(updatePluginControl, /anyEnabled/);
  assert.match(css, /@media \(pointer: coarse\)[\s\S]*?\[data-pe-button\][^}]*::after\s*\{[^}]*inset-block:\s*-7px/);
  assert.match(css, /\.plugin-modal-layer\s*\{[^}]*position:\s*fixed[^}]*place-items:\s*center/);
  assert.match(css, /\.plugin-modal\s*\{[^}]*color-scheme:\s*light[^}]*--ink:\s*var\(--studio-text, #1c1f27\)[^}]*--panel-raised:\s*var\(--studio-panel, #ffffff\)[^}]*--gold-bright:\s*var\(--studio-accent-strong, #4338ca\)[^}]*width:\s*min\(920px, 100%\)[^}]*max-height/);
  assert.doesNotMatch(css, /body\[data-theme="(?:studio|research|arcane|scifi)"\] \.plugin-modal/);
  assert.match(html, /class="plugin-usage"[\s\S]*?data-i18n="pluginUsageDescription"/);
  assert.match(zh, /pluginUsageDescription:\s*"需要自定义界面时[\s\S]*?数据由你的浏览器直接获取/);
  assert.match(app, /generalPluginRecommendedHelp:\s*"Recommended\.[\s\S]*?interactive and dynamic content/);
  assert.match(zh, /generalPluginRecommendedHelp:\s*"建议开启[\s\S]*?交互内容和动态内容/);
  assert.match(html, /data-i18n="serverPluginsComingTitle"/);
});

test("model timeouts double for maximum effort and wait for ten seconds of stream inactivity", () => {
  const server = read("src/server/main.js"), callModel = functionSource(server,"callModel"), progress = functionSource(server,"aiProgressStream"),
    authoring = functionSource(server,"improvePluginDocument");
  assert.match(callModel,/createActivityAwareTimeout\(controller, provider\.timeoutMs \* reasoningEffortTimeoutMultiplier\(effort\)\)/);
  assert.match(callModel,/onActivity:streamActivity[\s\S]*?readProviderEventStream\([^)]*onActivity:streamActivity/);
  assert.match(authoring,/createActivityAwareTimeout\(controller, provider\.timeoutMs \* reasoningEffortTimeoutMultiplier\(effort\)\)/);
  assert.match(progress,/startHeartbeat[\s\S]*?setInterval[\s\S]*?type:"activity"[\s\S]*?AI_PROGRESS_HEARTBEAT_MS/);
  assert.match(progress,/activity\(\)[\s\S]*?now-lastActivitySentAt<1000[\s\S]*?type:"activity"/);
});

test("plugin creator offers one air-quality template, editable copies, AI title completion, deletion, and local save-and-enable", () => {
  const html = read("public/index.html"), app = read("public/app.js"), css = read("public/style.css"), zh = read("public/locales/zh.js"), server = read("src/server/main.js");
  for (const id of ["pluginCreateForm", "pluginSimpleTemplate", "pluginTitle", "pluginDocumentEditor", "pluginDocumentBytes", "pluginStylesEditor", "pluginStylesUploadButton", "pluginStylesUpload", "pluginStylesBytes", "pluginStylesPreview", "pluginDocumentStatus", "pluginImprove", "pluginSave"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.doesNotMatch(html, /id="pluginApiTemplate"|id="pluginImproveInstructions"/);
  assert.match(html, /data-i18n="sharePluginComing"[^>]*disabled|disabled[^>]*data-i18n="sharePluginComing"/);
  assert.match(html, /id="pluginCreateTab"[\s\S]*?class="plugin-preview"[\s\S]*?data-i18n="pluginPreview"/);
  assert.match(html, /data-i18n="createPluginDescription">Preview: this workflow has limited testing/);
  assert.match(zh, /createPluginDescription:\s*"Preview：此功能测试尚不充分/);
  assert.match(app, /const PLUGIN_TEMPLATE_DOCUMENTS = Object\.freeze\(\{/);
  assert.match(app, /simple: `[\s\S]*?我需要根据地点, 显示空气质量\.[\s\S]*?## One-shot example[\s\S]*?html_widget/);
  assert.doesNotMatch(app, /pluginApiTemplate|pluginImproveInstructions/);
  assert.match(functionSource(app, "pluginDraftValidation"), /PLUGINS\.parse[\s\S]*?pluginIdReserved[\s\S]*?pluginIdExists/);
  assert.match(functionSource(app, "importPluginStylesFile"), /\.css\$[\s\S]*?file\.size > 32000[\s\S]*?file\.text\(\)[\s\S]*?pluginStylesEditor\.value = styles[\s\S]*?pluginStylesImported/);
  assert.match(functionSource(app, "improvePluginDraft"), /body:JSON\.stringify\(\{ document, styles[\s\S]*?pluginDocumentEditor\.value = body\.document[\s\S]*?pluginStylesEditor\.value = body\.styles[\s\S]*?syncPluginTitleFromDocument/);
  assert.match(functionSource(app, "savePluginDraft"), /fetch\("\/api\/plugins"[\s\S]*?loadPluginDocuments\(\)[\s\S]*?setPluginEnabled\(savedId, true\)[\s\S]*?setPluginTab\("local"\)/);
  assert.match(functionSource(app, "createPluginCopy"), /nextPluginCopyId[\s\S]*?manifest\.document[\s\S]*?pluginIdPattern[\s\S]*?pluginDocumentEditor\.value = document[\s\S]*?pluginStylesEditor\.value = manifest\.styles[\s\S]*?setPluginTab\("create"\)/);
  assert.match(functionSource(app, "deleteLocalPlugin"), /plugin\.builtIn !== false[\s\S]*?method:"DELETE"[\s\S]*?forgetPluginSetting[\s\S]*?loadPluginDocuments/);
  assert.match(functionSource(app, "renderPluginOptions"), /manifest\?\.document[\s\S]*?data-plugin-duplicate|manifest\?\.document[\s\S]*?dataset\.pluginDuplicate/);
  assert.match(functionSource(app, "renderPluginOptions"), /plugin\.builtIn === false[\s\S]*?data-plugin-delete|plugin\.builtIn === false[\s\S]*?dataset\.pluginDelete/);
  assert.match(functionSource(app, "setPluginTab"), /\["local", "create", "server"\]/);
  assert.match(functionSource(app, "setPluginTab"), /panel\.hidden = !active[\s\S]*?if \(active\) panel\.scrollTop = 0/);
  assert.match(css, /\.plugin-template-switch\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.match(css, /\.plugin-css-import\s*\{/);
  assert.match(css, /\.plugin-duplicate-button, \.plugin-delete-button\s*\{/);
  assert.match(css, /\.plugin-create-actions\s*\{[^}]*grid-template-columns/);
  for (const key of ["createPlugin", "pluginSimpleTemplate", "pluginTitleLabel", "pluginStylesImport", "pluginStylesImported", "improvePluginWithAi", "saveAndEnablePlugin", "pluginMarketplaceNote", "pluginNoNetwork", "duplicatePlugin", "pluginCopyName", "pluginCopyDraftReady", "deletePlugin"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
  assert.match(server, /const PLUGIN_AUTHORING_SYSTEM = `[\s\S]*?JSON object with exactly two string fields[\s\S]*?under 12000 UTF-8 bytes[\s\S]*?under 32000 UTF-8 bytes/);
  assert.match(functionSource(server, "pluginBundleFromModel"), /matchAll[\s\S]*?JSON\.parse[\s\S]*?PLUGIN_FORMAT\.parse/);
  assert.match(functionSource(server, "improvePluginDocument"), /requestPluginAuthoringModel[\s\S]*?pluginBundleFromModel[\s\S]*?pluginAuthoringRepairPrompt[\s\S]*?requestPluginAuthoringModel[\s\S]*?still failed validation/);
  assert.match(server, /url\.pathname === "\/api\/plugins"[\s\S]*?saveLocalPluginDocument\(body\.document, body\.styles \|\| ""\)/);
  assert.match(server, /url\.pathname === "\/api\/plugins\/improve"[\s\S]*?improvePluginDocument/);
  assert.match(server, /BUILTIN_PLUGIN_IDS[\s\S]*?function deleteLocalPlugin[\s\S]*?Built-in plugins cannot be deleted/);
  assert.match(server, /req\.method === "DELETE"[\s\S]*?deleteLocalPlugin\(id\)/);
});

test("General HTML stays mandatory while optional data plugins can detach widget runtime hooks", () => {
  const app = read("public/app.js"), html = read("public/index.html"), requestPayload = functionSource(app, "pluginRequestPayload"), syncRuntime = functionSource(app, "syncWidgetRuntime"), pointerDown = app.slice(app.indexOf('function handleCanvasPointerDown('), app.indexOf('screen.addEventListener("pointermove"')), validate = functionSource(app, "validate");
  assert.match(html, /id="widgetLayer"[^>]*\shidden(?:\s|>)/);
  assert.match(requestPayload, /if \(plugins\.length\) payload\.plugins = plugins/);
  assert.match(functionSource(app, "enabledPluginDescriptors"), /filter\(\(plugin\) => pluginEnabled\(plugin\.id\)\)/);
  assert.match(functionSource(app, "pluginEnabled"), /pluginId === "general" \|\| state\.plugins\[pluginId\] === true/);
  assert.match(functionSource(app, "setPluginEnabled"), /if \(pluginId === "general"\) enabled = true/);
  assert.match(functionSource(app, "renderPluginOptions"), /input\.disabled = plugin\.id === "general"/);
  assert.match(functionSource(app, "enabledPluginDescriptors"), /sort\(\(a, b\) => \{[\s\S]*?id === "general" \? 0 : id === "flowchart" \? 1 : 2/);
  assert.match(syncRuntime, /dataPluginDefinitions\(\)\.some[\s\S]*?widgetLayer\.hidden = !enabled[\s\S]*?addEventListener[\s\S]*?removeEventListener/);
  assert.doesNotMatch(app, /window\.addEventListener\("message", handleWidgetMessage\)/);
  assert.match(functionSource(app, "visibleWidgets"), /if \(!widgetRuntimeEnabled\(\)\) return \[\]/);
  assert.match(functionSource(app, "positionWidgets"), /if \(!widgetRuntimeEnabled\(\)\) return/);
  assert.match(functionSource(app, "drawWidgetChrome"), /if \(!widgetRuntimeEnabled\(\)\) return/);
  assert.match(functionSource(app, "widgetPointerHit"), /!widgetRuntimeEnabled\(\)/);
  assert.match(validate, /if \(widgetPluginIds\.size\) acceptedTools\.push\("html_widget"\)/);
  assert.match(validate, /allowCopy = c\.pluginId !== "image-search"[\s\S]*?allowCopy && typeof c\.copyText === "string"/);
});

test("simple native draw is loaded and rendered without enabling legacy animation output", () => {
  const app = read("public/app.js"),
    html = read("public/index.html"),
    validate = functionSource(app, "validate"),
    prepare = functionSource(app, "preparePendingItem");
  assert.match(html, /<script src="draw\.js"><\/script>[\s\S]*?<script src="app\.js"><\/script>/);
  assert.match(app, /const DRAW = window\.PENECHO_DRAW/);
  assert.match(validate, /acceptedTools = \["write_text", "draw_formula", "plot_function", "draw", "erase"\]/);
  assert.match(validate, /c\.tool === "draw"[\s\S]*?DRAW\?\.normalize\(c, SIZE\)/);
  assert.match(prepare, /c\.tool === "draw"[\s\S]*?DRAW\.render\(c, offscreen, c\.color\)/);
  assert.doesNotMatch(validate, /animate_scene/);
});

test("AI completion always leaves a user-visible result or diagnostic", () => {
  const app = read("public/app.js"),
    zh = read("public/locales/zh.js"),
    request = functionSource(app, "requestAI");
  assert.match(request, /commands\.length[\s\S]*?typeof data\.message === "string"[\s\S]*?setStatus\(data\.message\.trim\(\)\)[\s\S]*?setStatusKey\("aiNoVisibleResponse"\)/);
  assert.match(app, /aiNoVisibleResponse:\s*"AI returned no displayable content/);
  assert.match(zh, /aiNoVisibleResponse:\s*"AI 没有返回可显示的内容/);
});

test("client widget validation matches the server tolerance boundary", () => {
  const app = read("public/app.js"),
    server = read("src/server/main.js"),
    geometryGuide = vm.runInNewContext(`(${functionSource(app, "widgetGeometryForViewport")})`, { SIZE:20000 }),
    fitGeometry = vm.runInNewContext(`(${functionSource(app, "fitWidgetGeometry")})`, { SIZE:20000, widgetGeometryForViewport:geometryGuide }),
    resizeImage = vm.runInNewContext(`(${functionSource(app, "resizeImageBox")})`, { SIZE:20000 });
  assert.deepEqual({ ...geometryGuide({ w:3000, h:3000 }).max }, { w:1500, h:1500 });
  assert.deepEqual({ ...geometryGuide({ w:3001, h:3001 }).max }, { w:2000, h:2000 });
  assert.deepEqual({ ...fitGeometry({ x:100, y:200, w:10000, h:20000 }, { w:10000, h:10000 }) }, { x:100, y:200, w:2500, h:5000 });
  assert.deepEqual({ ...fitGeometry({ x:100, y:200, w:6800, h:2200 }, { w:10000, h:10000 }) }, { x:100, y:200, w:6800, h:2200 });
  assert.deepEqual({ ...fitGeometry({ x:100, y:200, w:8000, h:6000 }, { w:20000, h:20000 }) }, { x:100, y:200, w:7302, h:5477 });
  assert.deepEqual({ ...fitGeometry({ x:30000, y:-500, w:2, h:3 }, { w:10000, h:10000 }) }, { x:19700, y:0, w:300, h:450 });
  assert.deepEqual({ ...resizeImage({ x:100, y:200, w:1200, h:800 }, { x:15100, y:10200 }, "resize") }, { x:100, y:200, w:15000, h:10000 });
  assert.doesNotMatch(functionSource(app, "resizeImageBox"), /5000|10000|40000000|maximumArea/);
  assert.doesNotMatch(functionSource(app, "resizeWidgetBox"), /5000|10000|40000000|maximumArea/);
  assert.match(server, /MAX_WIDGET_WIDTH = 10000[\s\S]*?MAX_WIDGET_HEIGHT = 10000[\s\S]*?MAX_WIDGET_AREA = 40000000/);
  assert.match(server, /widgetGeometryForViewport[\s\S]*?ceil-to-1000-before-halving/);
});

test("AI waiting effect ends when the response arrives, before draft confirmation", () => {
  const request = functionSource(read("src/client/app/ai-runtime.js"), "requestAI"),
    response = request.indexOf("streamed = await readAiCommandResponse"),
    clearRequestTimeout = request.indexOf("timeout.clear();", response),
    clearSlowNotice = request.indexOf("clearTimeout(run.slowNoticeTimer);", response),
    endBusy = request.indexOf("if (state.activeAI === run) setBusy(false);", response),
    singleDraft = request.indexOf("await animate(", response),
    batchDraft = request.indexOf("await startPendingBatch(", response),
    pendingWidget = functionSource(read("src/client/app/canvas-runtime.js"), "startPendingWidget");
  assert.ok(response >= 0);
  assert.ok(clearRequestTimeout > response);
  assert.ok(clearSlowNotice > response);
  assert.ok(endBusy > response);
  assert.ok(clearRequestTimeout < singleDraft);
  assert.ok(clearSlowNotice < singleDraft);
  assert.ok(endBusy < singleDraft);
  assert.ok(endBusy < batchDraft);
  assert.match(pendingWidget, /setStatusKey\("aiDone"\)/);
  assert.doesNotMatch(pendingWidget, /setStatusKey\("draftReady"\)/);
});

test("AI waiting uses a spatial echo and quiet copy for the real request lifetime", () => {
  const core = read("src/client/app/core.js"),
    bootstrap = read("src/client/app/ui-bootstrap.js"),
    busy = functionSource(core, "setBusy");
  assert.match(core, /summonLayer|fxCanvas:\s*summonLayer|getAiColor:\s*\(\)\s*=>\s*state\.aiColor/);
  assert.match(core, /summonFX\.show\(state\.summonAnchor\)/);
  assert.match(busy, /if \(state\.busy\) \{[\s\S]*?showSummon\(\);[\s\S]*?\} else \{[\s\S]*?hideSummon\(\);/);
  assert.doesNotMatch(core, /summonEffect|setSummonEffect|previewSummon|summonPreviewTimer/);
  assert.doesNotMatch(bootstrap, /summon-effect-option|setSummonEffect|previewSummon/);
});

test("new canvases open at 50% without overriding restored views", () => {
  const core = read("src/client/app/core.js"),
    canvas = read("src/client/app/canvas-runtime.js"),
    persistence = read("src/client/app/persistence.js"),
    fitSource = functionSource(canvas, "fit"),
    state = { scale:0.1, panX:0, panY:0, viewInitialized:false, animationFullRedraw:false },
    screen = {},
    animationLayer = {},
    placedContentLayer = {},
    inkLayer = {},
    liveInkLayer = {},
    interactionLayer = {},
    fit = vm.runInNewContext(`(${fitSource})`, {
      INITIAL_CANVAS_SCALE:0.5,
      SIZE:20000,
      viewerAutoFitWidgetId:null,
      viewerAutoFitCanvas:false,
      devicePixelRatio:1,
      view:{ getBoundingClientRect:() => ({ width:1200, height:800 }) },
      invalidateCanvasViewportMetrics:() => {},
      canvasViewportMetrics:() => ({ width:1200, height:800 }),
      screen,
      animationLayer,
      placedContentLayer,
      inkLayer,
      liveInkLayer,
      interactionLayer,
      state,
      scheduleLiveInkLayerWarmup:() => {},
      updateCoordinates:() => {},
      requestRender:() => {},
    });
  assert.match(core, /INITIAL_CANVAS_SCALE\s*=\s*0\.5,/);
  assert.match(fitSource, /state\.scale = INITIAL_CANVAS_SCALE/);
  fit();
  assert.equal(state.scale, 0.5);
  assert.equal(state.panX + 10000 * state.scale, 600);
  assert.equal(state.panY + 10000 * state.scale, 400);
  assert.match(functionSource(persistence, "startBlankCanvas"), /state\.viewInitialized\s*=\s*false;[\s\S]*?fit\(\)/);
  assert.match(persistence, /state\.scale\s*=\s*Math\.max\(0\.03,\s*Math\.min\(2,\s*item\.view\.scale\)\)/);
});

test("the public Viewer camera fits a Widget in phone portrait and landscape", () => {
  const fitSource = functionSource(read("src/client/app/canvas-runtime.js"), "fit"),
    widget = { id:"viewer-widget", x:2400, y:3600, w:1200, h:800 },
    state = { widgets:[widget], scale:.1, panX:0, panY:0, viewInitialized:true, animationFullRedraw:false },
    screen = {}, animationLayer = {}, placedContentLayer = {}, inkLayer = {}, liveInkLayer = {}, interactionLayer = {};
  let rect = { left:0, top:0, width:375, height:667 };
  const fit = vm.runInNewContext(`(${fitSource})`, {
    INITIAL_CANVAS_SCALE:0.5,
    SIZE:20000,
    viewerAutoFitWidgetId:widget.id,
    viewerAutoFitCanvas:false,
    widgetBox:(item) => ({ x:item.x, y:item.y, w:item.w, h:item.h }),
    devicePixelRatio:1,
    view:{ getBoundingClientRect:() => rect },
    invalidateCanvasViewportMetrics:() => {},
    canvasViewportMetrics:() => ({ width:rect.width, height:rect.height }),
    pageLayoutRect:(element) => element?.getBoundingClientRect?.() || rect,
    document:{ querySelector:() => ({ getBoundingClientRect:() => ({ bottom:62 }) }) },
    screen,
    animationLayer,
    placedContentLayer,
    inkLayer,
    liveInkLayer,
    interactionLayer,
    state,
    scheduleLiveInkLayerWarmup:() => {},
    updateCoordinates:() => {},
    requestRender:() => {},
  });
  const visibleBox = () => ({
    left:state.panX + widget.x * state.scale,
    top:state.panY + widget.y * state.scale,
    right:state.panX + (widget.x + widget.w) * state.scale,
    bottom:state.panY + (widget.y + widget.h) * state.scale,
  });
  for (const size of [{ width:375, height:667 }, { width:667, height:375 }]) {
    rect = { ...rect, ...size };
    fit();
    const box = visibleBox();
    assert.ok(box.left >= 11 && box.right <= size.width - 11);
    assert.ok(box.top >= 63 && box.bottom <= size.height - 11);
    assert.ok(Math.abs((box.right - box.left) / (box.bottom - box.top) - widget.w / widget.h) < 1e-9);
  }
});

test("the public Viewer camera fits every object in a restored Canvas", () => {
  const fitSource = functionSource(read("src/client/app/canvas-runtime.js"), "fit"),
    widgets = [
      { id:"clock", x:6895, y:8757, w:3206, h:1801 },
      { id:"guide", x:9905, y:8922, w:3300, h:2150 },
    ],
    combined = { x:6895, y:8757, w:6310, h:2315 },
    state = { widgets, scale:.1, panX:0, panY:0, viewInitialized:true, animationFullRedraw:false },
    screen = {}, animationLayer = {}, placedContentLayer = {}, inkLayer = {}, liveInkLayer = {}, interactionLayer = {},
    rect = { left:0, top:0, width:1200, height:800 },
    unionLocalBounds = (current, next) => {
      if (!current) return next;
      if (!next) return current;
      const x = Math.min(current.x, next.x), y = Math.min(current.y, next.y),
        right = Math.max(current.x + current.w, next.x + next.w),
        bottom = Math.max(current.y + current.h, next.y + next.h);
      return { x, y, w:right - x, h:bottom - y };
    },
    fit = vm.runInNewContext(`(${fitSource})`, {
      INITIAL_CANVAS_SCALE:0.5,
      SIZE:20000,
      viewerAutoFitWidgetId:null,
      viewerAutoFitCanvas:true,
      visibleInkBounds:() => null,
      imageBounds:() => null,
      textBoxBounds:() => null,
      animationBounds:() => null,
      widgetBounds:() => combined,
      unionLocalBounds,
      devicePixelRatio:1,
      view:{ getBoundingClientRect:() => rect },
      invalidateCanvasViewportMetrics:() => {},
      canvasViewportMetrics:() => ({ width:rect.width, height:rect.height }),
      pageLayoutRect:(element) => element?.getBoundingClientRect?.() || rect,
      document:{ querySelector:() => ({ getBoundingClientRect:() => ({ bottom:62 }) }) },
      screen,
      animationLayer,
      placedContentLayer,
      inkLayer,
      liveInkLayer,
      interactionLayer,
      state,
      scheduleLiveInkLayerWarmup:() => {},
      updateCoordinates:() => {},
      requestRender:() => {},
    });
  fit();
  for (const item of widgets) {
    const left = state.panX + item.x * state.scale,
      top = state.panY + item.y * state.scale,
      right = state.panX + (item.x + item.w) * state.scale,
      bottom = state.panY + (item.y + item.h) * state.scale;
    assert.ok(left >= 39 && right <= rect.width - 39);
    assert.ok(top >= 63 && bottom <= rect.height - 11);
  }
});

test("animation defaults on without overriding an explicitly disabled plugin choice", () => {
  const storedPluginSettings = vm.runInNewContext(`(${functionSource(read("public/app.js"), "storedPluginSettings")})`, {
      PLUGIN_DEFINITIONS: [{ id: "animation", defaultEnabled: true, legacyStorageKey: "penecho-animation-plugin" }],
      PLUGIN_STORAGE_KEY: "penecho-plugins",
      localStorage: { getItem: () => null },
    }),
    explicitlyDisabled = vm.runInNewContext(`(${functionSource(read("public/app.js"), "storedPluginSettings")})`, {
      PLUGIN_DEFINITIONS: [{ id: "animation", defaultEnabled: true, legacyStorageKey: "penecho-animation-plugin" }],
      PLUGIN_STORAGE_KEY: "penecho-plugins",
      localStorage: { getItem: (key) => key === "penecho-plugins" ? '{"animation":false}' : null },
    });

  assert.deepEqual({ ...storedPluginSettings() }, { animation:true });
  assert.deepEqual({ ...explicitlyDisabled() }, { animation:false });
});

test("general HTML defaults on while preserving an explicit user choice", () => {
  const storedPluginSettings = vm.runInNewContext(`(${functionSource(read("public/app.js"), "storedPluginSettings")})`, {
      PLUGIN_DEFINITIONS: [{ id:"general", defaultEnabled:true }],
      PLUGIN_STORAGE_KEY: "penecho-plugins",
      localStorage: { getItem:() => null },
    }),
    explicitlyDisabled = vm.runInNewContext(`(${functionSource(read("public/app.js"), "storedPluginSettings")})`, {
      PLUGIN_DEFINITIONS: [{ id:"general", defaultEnabled:true }],
      PLUGIN_STORAGE_KEY: "penecho-plugins",
      localStorage: { getItem:(key) => key === "penecho-plugins" ? '{"general":false}' : null },
    });
  assert.deepEqual({ ...storedPluginSettings() }, { general:true });
  assert.deepEqual({ ...explicitlyDisabled() }, { general:false });
});

test("professional diagrams default on while preserving an explicit user choice", () => {
  const storedPluginSettings = vm.runInNewContext(`(${functionSource(read("public/app.js"), "storedPluginSettings")})`, {
      PLUGIN_DEFINITIONS: [{ id:"flowchart", defaultEnabled:true }],
      PLUGIN_STORAGE_KEY: "penecho-plugins",
      localStorage: { getItem:() => null },
    }),
    explicitlyDisabled = vm.runInNewContext(`(${functionSource(read("public/app.js"), "storedPluginSettings")})`, {
      PLUGIN_DEFINITIONS: [{ id:"flowchart", defaultEnabled:true }],
      PLUGIN_STORAGE_KEY: "penecho-plugins",
      localStorage: { getItem:(key) => key === "penecho-plugins" ? '{"flowchart":false}' : null },
    });
  assert.deepEqual({ ...storedPluginSettings() }, { flowchart:true });
  assert.deepEqual({ ...explicitlyDisabled() }, { flowchart:false });
});

test("empty animation bounds do not break ink-only capture and controls expire after ten seconds", () => {
  const app = read("public/app.js"),
    union = vm.runInNewContext(`(${functionSource(app, "unionLocalBounds")})`),
    ink = { x: 10, y: 20, w: 30, h: 40 };
  assert.deepEqual(union(ink, null), ink);
  assert.match(functionSource(app, "showAnimationControls"), /ANIMATION_CONTROLS_VISIBLE_MS[\s\S]*?setTimeout\(expireAnimationControls, duration\)/);
  assert.match(functionSource(app, "expireAnimationControls"), /hideAnimationControls\(\)[\s\S]*?selectedAnimation\(\)[\s\S]*?acceptAnimationEdit\(\)/);
  assert.match(functionSource(app, "hideAnimationControls"), /animationControlsUntil = 0[\s\S]*?requestInteractionLayerRender\(\)/);
  assert.match(functionSource(app, "animationControlChromeVisible"), /animationControlsUntil > now/);
  assert.match(functionSource(app, "pendingAnimationChromeVisible"), /pendingAnimationControlTarget\(\)[\s\S]*?animationControlChromeVisible/);
  assert.match(functionSource(app, "animationEditChromeVisible"), /kind === "confirmed"[\s\S]*?state\.animationEdit[\s\S]*?animationControlChromeVisible/);
  assert.match(functionSource(app, "drawSelectedAnimation"), /animationEditChromeVisible\(\)/);
  assert.match(app, /ANIMATION_CONTROLS_VISIBLE_MS\s*=\s*10000/);
  assert.match(functionSource(app, "beginAnimationGesture"), /showAnimationControls\(\)/);
  assert.doesNotMatch(functionSource(app, "addAnimation"), /showAnimationControls|selectedAnimationId\s*=/);
});

test("animation frames do not rewrite unchanged control DOM", () => {
  const app = read("public/app.js"), values = new Map(), writes = { hidden:0, style:0, text:0 };
  let hidden = true, label = "";
  const animationControls = {
      offsetWidth:210,
      offsetHeight:36,
      classList:{ toggle() {}, remove() {} },
      style:{
        getPropertyValue:(name)=>values.get(name)||"",
        setProperty:(name,value)=>{writes.style++;values.set(name,value)},
      },
    },
    animationPlayPause = {};
  Object.defineProperty(animationControls,"hidden",{get:()=>hidden,set:(value)=>{writes.hidden++;hidden=value}});
  Object.defineProperty(animationPlayPause,"textContent",{get:()=>label,set:(value)=>{writes.text++;label=value}});
  const position = vm.runInNewContext(`(${functionSource(app, "positionAnimationControls")})`, {
    animationControlTarget:()=>({kind:"pending",box:{x:100,y:120,w:300,h:180},playback:{paused:false}}),
    pluginEnabled:()=>true,
    animationControls,
    animationPlayPause,
    performance:{now:()=>100},
    state:{animationControlsUntil:1000,panX:10,panY:20,scale:1},
    canvasViewportMetrics:()=>({width:1000,height:700}),
    t:(key)=>key,
    runtimeElementStyle:()=>animationControls.style,
    acceptAnimationEdit:()=>{},
  });
  position();
  assert.deepEqual(writes,{hidden:1,style:2,text:1});
  position();
  assert.deepEqual(writes,{hidden:1,style:2,text:1});
});

test("strict CSP dynamic layout uses stylesheet rules instead of element style attributes", () => {
  const app = read("public/app.js"),
    summon = read("public/summon.js"),
    html = read("public/index.html"),
    widgetHost = read("public/widget-host.js"),
    helper = functionSource(app, "runtimeElementStyle");
  assert.match(helper, /sheet\.insertRule\(`\.\$\{className\} \{\}`/);
  for (const key of ["tour-layer", "tour-highlight", "tour-card", "tour-progress", "animation-controls", "canvas-image-selection", "selection-toolbar", "summon-copy"])
    assert.match(app, new RegExp(`runtimeElementStyle\\([^)]*["']${key}["']`));
  assert.match(functionSource(app,"positionToolbarPopover"),/runtimeElementStyle\(popover, `toolbar-popover-\$\{popover\.id\}`\)[\s\S]*?setProperty\("left"[\s\S]*?setProperty\("top"/);
  assert.doesNotMatch(app,/canvasAgentOpenFeedbackMenu|canvas-agent-feedback-menu/);
  assert.doesNotMatch(app,/\b(?:popover|menu)\.style\./);
  assert.doesNotMatch(app, /Reflect\.get\((?:tourLayer|tourHighlight|tourCard|tourProgressBar|animationControls|selectionToolbar), "style"\)/);
  assert.match(functionSource(app, "ensureObjectChromeStyleRule"), /sheet\.insertRule\(`\.\$\{className\} \{ --object-control-x: 0px; --object-control-y: 0px; z-index: 1; \}`/);
  assert.doesNotMatch(summon, /copyEl\.style\./);
  assert.match(summon, /styleFor = options\.styleFor/);
  assert.doesNotMatch(app, /pluginStylesPreview\.srcdoc|<style>\$\{escaped\}/);
  assert.doesNotMatch(html, /id="pluginStylesPreview"[^>]*\ssandbox(?:\s|>)/);
  assert.match(functionSource(app, "updatePluginStylesPreview"), /widget-host\.html/);
  assert.match(functionSource(app, "handlePluginStylesPreviewMessage"), /penecho-widget-host-ready/);
  assert.doesNotMatch(widgetHost, /if \(initialized \|\| typeof message\.html/);
});

test("animation drafts play immediately and share playback controls with confirmed editing", () => {
  const app = read("public/app.js"),
    playhead = vm.runInNewContext(`(${functionSource(app, "playbackPlayhead")})`),
    drawPending = functionSource(app, "drawPending"),
    drawBatch = functionSource(app, "drawPendingBatch"),
    frame = functionSource(app, "animationFrameStep"),
    start = functionSource(app, "startPending"),
    selected = functionSource(app, "drawSelectedAnimation"),
    hit = functionSource(app, "animationPointerHit");
  assert.equal(playhead({ durationMs: 1000, loop: true }, { playheadMs: 0, paused: false, startedAt: 100 }, 350), 250);
  assert.match(drawPending, /p\.animationScene\) drawPendingAnimation/);
  assert.match(drawBatch, /item\.animationScene\) drawPendingAnimation/);
  assert.match(frame, /pendingAnimations = pendingAnimationEntries\(\)[\s\S]*?renderInteractionLayer\(\)[\s\S]*?pendingPlaying\.length/);
  assert.match(start, /revealProgress:\s*animationScene \? 1 : 0/);
  assert.match(start, /animationScene\)[\s\S]*?showAnimationControls\(\)[\s\S]*?requestAnimationLayerRender\(\)/);
  assert.match(functionSource(app, "animationControlTarget"), /pendingAnimationControlTarget\(\)[\s\S]*?kind:\s*"confirmed"/);
  assert.match(functionSource(app, "toggleSelectedAnimationPlayback"), /animationControlTarget\(\)/);
  assert.doesNotMatch(selected, /drawDraftActions/);
  assert.match(functionSource(app, "objectChromeSpecs"), /animation:\$\{handTarget\.id\}:cancel[\s\S]*?cancelAnimationEdit[\s\S]*?animation:\$\{handTarget\.id\}:accept[\s\S]*?acceptAnimationEdit/);
  assert.match(hit, /draftActionPoints\(box, handle, false, true\)/);
  for (const control of ["width", "height", "resize"]) assert.match(hit, new RegExp(`hit: "${control}"`));
  assert.match(functionSource(app, "beginAnimationGesture"), /result\.hit === "accept"[\s\S]*?acceptAnimationEdit\(\)[\s\S]*?result\.hit === "cancel"[\s\S]*?cancelAnimationEdit\(\)/);
  assert.match(drawPending, /pendingAnimationChromeVisible\(p\)[\s\S]*?if \(!chromeVisible\) return/);
  assert.match(drawBatch, /chromeVisible: !item\.animationScene \|\| pendingAnimationChromeVisible\(p, index\)/);
  assert.match(functionSource(app, "pendingHit"), /p\.animationScene && !pendingAnimationChromeVisible\(p\)/);
  assert.match(functionSource(app, "beginPendingGesture"), /!p\.items && p\.animationScene\) showAnimationControls\(\)/);
});

test("live widgets use native canvas chrome, state-aware iframe gestures, and three resize modes", () => {
  const app = read("public/app.js"),
    widgetHost = read("public/widget-host.js"),
    css = read("public/style.css"),
    resize = vm.runInNewContext(`(${functionSource(app, "resizeWidgetBox")})`, { SIZE:20000 }),
    resizeHit = vm.runInNewContext(`(${functionSource(app, "widgetResizeHit")})`, { state:{scale:1} }),
    hostControlHit = vm.runInNewContext(`(${functionSource(widgetHost, "controlHit")})`, {
      widgetState:{selected:true,scaleX:1,scaleY:1},
      document:{documentElement:{clientWidth:1000,clientHeight:600}},
      CONTROL_RADIUS_PX:26,
      CONTROL_EDGE_PX:7,
      CONTROL_CORNER_PX:16,
    }),
    start = { x:100, y:200, w:1200, h:800, contentW:1200, contentH:800 },
    width = resize(start, { x:2000, y:0 }, "width"),
    height = resize(start, { x:0, y:1300 }, "height"),
    corner = resize(start, { x:2500, y:1800 }, "resize"),
    minimum = resize(start, { x:0, y:0 }, "resize"),
    bounded = resize({ x:18500, y:19000, w:1200, h:800, contentW:1200, contentH:800 }, { x:22000, y:22000 }, "resize"),
    scaledWidth = resize({ x:100, y:200, w:600, h:400, contentW:1200, contentH:800 }, { x:1000, y:0 }, "width"),
    scaledHeight = resize({ x:100, y:200, w:600, h:400, contentW:1200, contentH:800 }, { x:0, y:800 }, "height"),
    unrestrictedWidth = resize(start, { x:15100, y:0 }, "width"),
    unrestrictedHeight = resize(start, { x:0, y:15200 }, "height"),
    unrestrictedCorner = resize(start, { x:15100, y:10200 }, "resize"),
    chrome = functionSource(app, "drawWidgetChrome"),
    hit = functionSource(app, "widgetControlHit"),
    resizeHandle = functionSource(app, "createWidgetResizeHandle"),
    begin = functionSource(app, "beginWidgetGesture"),
    updatePoint = functionSource(app, "updateWidgetGesturePoint"),
    finishReleased = functionSource(app, "finishReleasedWidgetGesture"),
    finishStaleHost = functionSource(app, "finishStaleWidgetHostGesture"),
    pointerHit = functionSource(app, "widgetPointerHit"),
    messageHandler = functionSource(app, "handleWidgetMessage"),
    finishWidgetGesture = functionSource(app, "finishWidgetGesture"),
    chromePosition = vm.runInNewContext(`(${functionSource(app, "objectChromePosition")})`, {
      state:{panX:0,panY:0,scale:1},
      view:{clientWidth:1200,clientHeight:800,getBoundingClientRect:()=>({left:0,top:0})},
      screenObjectBox:box=>({left:box.x,top:box.y,width:box.w,height:box.h}),
    }),
    positionWidget = vm.runInNewContext(`(${functionSource(app, "positionWidget")})`, {
      state:{ panX:10, panY:20, scale:0.2 },
      updateWidgetRenderVisibility() {},
      sendWidgetHostState() {},
    }),
    pointerDown = app.slice(app.indexOf('function handleCanvasPointerDown('), app.indexOf('screen.addEventListener("pointermove"')),
    pointerMove = app.slice(app.indexOf('screen.addEventListener("pointermove"'), app.indexOf("function end(e)")),
    frameRule = /\.canvas-widget-frame\s*\{[^}]*\}/.exec(css)?.[0] || "";
  const declaration = {};
  Object.defineProperty(declaration,"setProperty",{value(name,value){this[name]=value}});
  const
    positionedWidget = { shell:{}, x:100, y:200, w:600, h:400, contentW:1200, contentH:800, styleRule:{ style:declaration } };
  positionWidget(positionedWidget);

  assert.deepEqual({ ...width }, { x:100, y:200, w:1900, h:800, contentW:1900, contentH:800 });
  assert.deepEqual({ ...height }, { x:100, y:200, w:1200, h:1100, contentW:1200, contentH:1100 });
  assert.deepEqual({ ...corner }, { x:100, y:200, w:2400, h:1600, contentW:1200, contentH:800 });
  assert.deepEqual({ ...minimum }, { x:100, y:200, w:300, h:200, contentW:1200, contentH:800 });
  assert.deepEqual({ ...bounded }, { x:18500, y:19000, w:1500, h:1000, contentW:1200, contentH:800 });
  assert.deepEqual({ ...scaledWidth }, { x:100, y:200, w:900, h:400, contentW:1800, contentH:800 });
  assert.deepEqual({ ...scaledHeight }, { x:100, y:200, w:600, h:600, contentW:1200, contentH:1200 });
  assert.deepEqual({ ...unrestrictedWidth }, { x:100, y:200, w:15000, h:800, contentW:15000, contentH:800 });
  assert.deepEqual({ ...unrestrictedHeight }, { x:100, y:200, w:1200, h:15000, contentW:1200, contentH:15000 });
  assert.deepEqual({ ...unrestrictedCorner }, { x:100, y:200, w:15000, h:10000, contentW:1200, contentH:800 });
  assert.equal(width.w / width.contentW, width.h / width.contentH);
  assert.equal(height.w / height.contentW, height.h / height.contentH);
  assert.equal(scaledWidth.w / scaledWidth.contentW, scaledWidth.h / scaledWidth.contentH);
  assert.equal(scaledHeight.w / scaledHeight.contentW, scaledHeight.h / scaledHeight.contentH);
  assert.equal(corner.w / corner.h, start.w / start.h);
  assert.equal(corner.contentW, start.contentW);
  assert.equal(corner.contentH, start.contentH);
  assert.equal(declaration.width, "1200px");
  assert.equal(declaration.height, "800px");
  assert.equal(declaration.transform, "translate3d(20px,40px,0) scale(0.1,0.1)");
  const resizeBox = {x:100,y:200,w:300,h:200};
  assert.equal(resizeHit(resizeBox, {x:400,y:250}, "mouse"), "width");
  assert.equal(resizeHit(resizeBox, {x:180,y:400}, "mouse"), "height");
  assert.equal(resizeHit(resizeBox, {x:390,y:390}, "mouse"), "resize");
  assert.equal(resizeHit(resizeBox, {x:200,y:300}, "mouse"), null);
  assert.equal(resizeHit(resizeBox, {x:414,y:250}, "touch"), "width");
  assert.equal(hostControlHit(995, 50, "mouse"), "width");
  assert.equal(hostControlHit(50, 595, "mouse"), "height");
  assert.equal(hostControlHit(990, 590, "mouse"), "resize");
  assert.equal(hostControlHit(500, 300, "mouse"), null);
  const chromeBox={x:400,y:100,w:300,h:200},
    toolbarSpec={objectToolbar:true,minimumWidth:196,baseHeight:34},
    toolbarPosition=chromePosition(chromeBox,"toolbar","widget:1:toolbar",toolbarSpec),
    toolbarPositions=new Map([["widget:1:toolbar",toolbarPosition]]),
    cancelSpec={objectToolbarItem:true,objectToolbarKey:"widget:1:toolbar",toolbarSlot:"leading",baseWidth:28,baseHeight:28},
    acceptSpec={...cancelSpec,toolbarSlot:"trailing"},
    toolSpec={...cancelSpec,toolbarSlot:"tool",toolbarOrder:0,toolbarItemCount:4};
  assert.deepEqual({x:toolbarPosition.x,y:toolbarPosition.y,baseWidth:toolbarPosition.baseWidth},{x:400,y:66,baseWidth:300});
  assert.deepEqual({x:chromePosition(chromeBox,"cancel","",cancelSpec,toolbarPositions).x,y:chromePosition(chromeBox,"cancel","",cancelSpec,toolbarPositions).y},{x:404,y:69});
  assert.deepEqual({x:chromePosition(chromeBox,"accept","",acceptSpec,toolbarPositions).x,y:chromePosition(chromeBox,"accept","",acceptSpec,toolbarPositions).y},{x:668,y:69});
  assert.deepEqual({x:chromePosition(chromeBox,"copy","",toolSpec,toolbarPositions).x,y:chromePosition(chromeBox,"copy","",toolSpec,toolbarPositions).y},{x:540,y:69});
  assert.match(frameRule, /color-scheme:\s*light/);
  assert.match(frameRule, /background:\s*transparent/);
  assert.match(functionSource(app, "sendWidgetHostState"), /selected = [\s\S]*?classList\.toggle\("is-selected", selected\)[\s\S]*?if \(!widget\.frame\?\.contentWindow/);
  assert.match(functionSource(app, "serializedWidgets"), /contentW:\s*widget\.contentW[\s\S]*?contentH:\s*widget\.contentH/);
  assert.match(functionSource(app, "serializedWidgets"), /widget\.widgetType !== "diagram_source"[\s\S]*?widget\.pluginId !== "image-search"[\s\S]*?copyText:widget\.copyText[\s\S]*?copyLabel:widget\.copyLabel/);
  const widgetRecord = functionSource(app, "widgetRecord");
  assert.match(widgetRecord, /contentW = item\.contentW \?\? item\.w[\s\S]*?contentH = item\.contentH \?\? item\.h/);
  assert.match(widgetRecord, /copyText: widgetType === "diagram_source" \? source[\s\S]*?allowCopy[\s\S]*?copyLabel: widgetType === "diagram_source" \? runtime\?\.copyLabel/);
  assert.match(functionSource(app, "sendWidgetInit"), /html:widget\.html[\s\S]*?pluginStyles:manifest\.styles/);
  assert.doesNotMatch(functionSource(app, "sendWidgetInit"), /copyText|copyLabel/);
  assert.doesNotMatch(functionSource(app, "resizeWidgetBox"), /5000|4000|12000000|maximumArea/);
  assert.doesNotMatch(functionSource(app, "widgetRecord"), /pluginManifests\.has/);
  assert.match(functionSource(app, "requestWidgetSnapshot"), /width:widget\.contentW, height:widget\.contentH, timeoutMs:remaining\(\), highResolution/);
  const requestSnapshot = functionSource(app, "requestWidgetSnapshot"),
    prepareSnapshots = functionSource(app, "prepareVisibleWidgetSnapshots"),
    capturableWidgets = functionSource(app, "capturableWidgets"),
    acceptPendingWidget = functionSource(app, "acceptPendingWidget");
  assert.match(requestSnapshot, /timeoutMs = WIDGET_SNAPSHOT_TIMEOUT_MS[\s\S]*?highResolution = highResolution === true[\s\S]*?if \(widget\.snapshotPromise\)[\s\S]*?widget\.snapshotPromiseHighResolution[\s\S]*?await waitForWidgetSnapshot\(inFlight,signal\)[\s\S]*?widget\.snapshotVersion >= widget\.contentVersion[\s\S]*?widget\.snapshotHighResolution[\s\S]*?widget\.snapshotPromise = snapshotPromise[\s\S]*?widget\.snapshotPromiseHighResolution = highResolution[\s\S]*?widget\.snapshotPromise = null/);
  assert.doesNotMatch(requestSnapshot, /waitForWidgetContent|readyPromise|contentReady|\bfetch\s*\(/);
  assert.match(requestSnapshot, /if \(!widget\.hostReady\)[\s\S]*?widget\.hostReadyPromise[\s\S]*?sendWidgetInit\(widget\)/);
  assert.match(messageHandler, /penecho-widget-updated[\s\S]*?widget\.contentVersion\+\+/);
  assert.doesNotMatch(messageHandler, /penecho-widget-updated[\s\S]*?widget\.favorite = false/);
  assert.doesNotMatch(messageHandler, /removeLocalFavorite|\/api\/favorites|DELETE/);
  const favoriteState = functionSource(app, "setCommunityWidgetFavorite");
  assert.match(favoriteState, /widget\.favorite = favorite[\s\S]*?!favorite[\s\S]*?favoriteArtifactSha256 = ""[\s\S]*?widget\.favoriteBusy = busy === true[\s\S]*?syncObjectChrome\(\)/);
  assert.doesNotMatch(favoriteState, /contentVersion|favoritePendingVersion|changedWhileSaving/);
  assert.match(functionSource(app, "widgetRecord"), /favoriteSourceId:[\s\S]*?favoriteArtifactSha256:[\s\S]*?favoriteBusy: false/);
  assert.match(functionSource(app, "widgetRecord"), /favoriteCloudId:[\s\S]*?favoriteCommunityItemId/);
  assert.match(functionSource(app, "serializedWidgets"), /favoriteSourceId:[\s\S]*?favoriteArtifactSha256[\s\S]*?favoriteCloudId[\s\S]*?favoriteCommunityItemId/);
  assert.match(functionSource(app, "communityWidgetArtifact"), /delete publicWidget\.favorite[\s\S]*?delete publicWidget\.favoriteSourceId[\s\S]*?delete publicWidget\.favoriteArtifactSha256[\s\S]*?delete publicWidget\.favoriteCloudId[\s\S]*?delete publicWidget\.favoriteCommunityItemId/);
  const importWidget = functionSource(app, "importCommunityWidgetArtifact");
  assert.match(importWidget, /delete source\.id[\s\S]*?delete source\.favorite[\s\S]*?favoriteState\?\.selected === true[\s\S]*?source\.favoriteSourceId[\s\S]*?source\.favoriteArtifactSha256[\s\S]*?source\.favoriteCloudId[\s\S]*?source\.favoriteCommunityItemId/);
  assert.match(importWidget, /const widget = widgetRecord\(source\)[\s\S]*?return \{ id:widget\.id, title:widget\.title \}/, "a favorite import keeps its logical source identity but receives a fresh Canvas instance id");
  assert.match(messageHandler, /penecho-widget-snapshot-error[\s\S]*?console\.warn\("PenEcho widget snapshot failed:"/);
  assert.doesNotMatch(messageHandler, /requestWidgetSnapshot/);
  assert.equal((app.match(/requestWidgetSnapshot\(/g) || []).length, 5, "MCP adds one explicit preview-only capture path");
  assert.match(app, /WIDGET_SNAPSHOT_TIMEOUT_MS = 20000,[\s\S]*?WIDGET_HISTORY_SNAPSHOT_WAIT_MS = 3000/);
  assert.doesNotMatch(app, /WIDGET_(?:BACKGROUND_SNAPSHOT_DELAY|SNAPSHOT_CACHE_REFRESH|SNAPSHOT_CACHE_STAGGER)_MS|scheduleWidgetSnapshot|snapshotTimer|snapshotCapturedAt/);
  assert.match(requestSnapshot, /widget\.snapshotPromise = snapshotPromise[\s\S]*?return await snapshotPromise[\s\S]*?widget\.snapshotPromise = null/);
  assert.match(messageHandler, /penecho-widget-capture-ready[\s\S]*?return/);
  assert.doesNotMatch(messageHandler, /penecho-widget-snapshot-ready/);
  assert.match(messageHandler, /const snapshotImage=await decodeWidgetSnapshot[\s\S]*?pending\.signal\?\.aborted[\s\S]*?widget\.contentVersion!==pending\.contentVersion[\s\S]*?widget\.snapshotImage = snapshotImage[\s\S]*?widget\.snapshotHighResolution = pending\.highResolution[\s\S]*?widget\.snapshotVersion = pending\.contentVersion[\s\S]*?pending\.resolve\(widget\.snapshotImage\)/);
  assert.match(capturableWidgets, /visibleWidgets\(region\)[\s\S]*?state\.pendingWidget[\s\S]*?pending\.shell[\s\S]*?return \[\.\.\.widgets, pending\]/);
  assert.match(prepareSnapshots, /highResolution = false[\s\S]*?capturableWidgets\(region\)[\s\S]*?requestWidgetSnapshot\(widget, WIDGET_SNAPSHOT_TIMEOUT_MS, true, signal, highResolution\)[\s\S]*?Promise\.race\([\s\S]*?WIDGET_HISTORY_SNAPSHOT_WAIT_MS[\s\S]*?Boolean\(widget\.snapshotImage\)/);
  assert.match(prepareSnapshots, /bestEffort = true[\s\S]*?if \(bestEffort\) await Promise\.race[\s\S]*?else await request/);
  assert.match(functionSource(app, "widgetBounds"), /capturableWidgets\(region\)/);
  assert.match(functionSource(app, "drawWidgetsToContext"), /capturableWidgets\(region\)/);
  assert.match(functionSource(app, "renderExportCanvas"), /prepareVisibleWidgetSnapshots\(null, false, null, true\)[\s\S]*?scale = Math\.min\(CANVAS_DOWNLOAD_RESOLUTION_SCALE, EXPORT_MAX_DIMENSION \/ region\.w[\s\S]*?Math\.sqrt\(EXPORT_MAX_PIXELS \/ \(region\.w \* region\.h\)\)/);
  assert.match(acceptPendingWidget, /!options\.allowRevisionMismatch && widget\.revision !== state\.userRevision[\s\S]*?rejectPendingWidget\(AI_CANCELLED\)/);
  assert.match(acceptPendingWidget, /if \(replacement\) \{[\s\S]*?unmountWidget\(widget\)[\s\S]*?\} else \{[\s\S]*?state\.widgets\.push\(widget\)[\s\S]*?widget\.shell\.classList\.remove\("pending"\)[\s\S]*?sendWidgetHostState\(widget/);
  assert.doesNotMatch(prepareSnapshots, /snapshotVersion === widget\.contentVersion/);
  assert.doesNotMatch(finishWidgetGesture, /requestWidgetSnapshot|scheduleWidgetSnapshot/);
  assert.match(finishWidgetGesture, /state\.widgetGesture = null[\s\S]*?positionWidget\(gesture\.widget\)/);
  const visibilityState = { scale:1, widgetGesture:null },
    updateWidgetRenderVisibility = vm.runInNewContext(`(${functionSource(app, "updateWidgetRenderVisibility")})`, {
      state:visibilityState,
      view:{ clientWidth:1000, clientHeight:700 },
      sendWidgetInit() {},
    }),
    visibilityClasses = new Set(),
    visibilityWidget = {
      w:300,
      h:200,
      shell:{ classList:{ toggle(name, enabled) { if (enabled) visibilityClasses.add(name); else visibilityClasses.delete(name); } } },
    };
  assert.equal(updateWidgetRenderVisibility(visibilityWidget, 100, 100), true);
  assert.equal(updateWidgetRenderVisibility(visibilityWidget, 1001, 100), false);
  assert.equal(visibilityClasses.has("widget-offscreen"), true);
  visibilityState.widgetGesture = { widget:visibilityWidget };
  assert.equal(updateWidgetRenderVisibility(visibilityWidget, 1001, 100), true);
  visibilityState.widgetGesture = null;
  assert.equal(updateWidgetRenderVisibility(visibilityWidget, 1001, 100), false);
  assert.match(functionSource(app, "sendWidgetHostState"), /active[\s\S]*?penecho-widget-state/);
  assert.match(css, /\.canvas-widget\s*\{[^}]*contain:\s*layout paint style/);
  assert.doesNotMatch(css, /\.canvas-widget\s*\{[^}]*will-change:\s*transform/);
  assert.match(css, /\.canvas-widget\.widget-offscreen\s*\{[^}]*visibility:\s*hidden/);
  assert.doesNotMatch(chrome, /drawDraftActions/);
  assert.match(chrome, /drawResizeHandle\(context, box, handle\)/);
  assert.doesNotMatch(chrome, /box\.h \/ 2|box\.w \/ 2/);
  assert.match(resizeHandle, /canvas-widget-resize-handle[\s\S]*?state\.viewMode[\s\S]*?showHandObjectToolbar\("widget", widget\)[\s\S]*?beginWidgetGesture\(event, clientPoint\(event\), \{ widget, hit, pending \}\)[\s\S]*?setPointerCapture/);
  assert.doesNotMatch(resizeHandle, /state\.widgetEdit\?\.id !== widget\.id/);
  assert.match(resizeHandle, /pointermove[\s\S]*?updateWidgetGesture\(event\)[\s\S]*?pointerup[\s\S]*?pointercancel[\s\S]*?lostpointercapture/);
  assert.match(functionSource(app, "mountWidget"), /createWidgetResizeHandle\(widget, "width"\)[\s\S]*?createWidgetResizeHandle\(widget, "height"\)[\s\S]*?createWidgetResizeHandle\(widget, "resize"\)/);
  assert.match(functionSource(app, "positionWidget"), /--widget-resize-edge-x[\s\S]*?--widget-resize-edge-y[\s\S]*?--widget-resize-corner-x[\s\S]*?--widget-resize-corner-y/);
  assert.match(css, /\.canvas-widget-resize-handle\s*\{[^}]*pointer-events:\s*none;[^}]*touch-action:\s*none;/);
  assert.match(css, /#viewport:is\(\.hand-mode, \.select-mode\):not\(\.view-mode\):not\(\.temporary-hand\) \.canvas-widget:is\(\.is-selected, \.pending, \.is-interacting\) \.canvas-widget-resize-handle\s*\{[^}]*pointer-events:\s*auto;/);
  assert.doesNotMatch(css, /#viewport\.select-mode:not\(\.view-mode\):not\(\.temporary-hand\):not\(\.widget-interacting\) >?\s*\.canvas-widget-resize-handle\s*\{[^}]*pointer-events:\s*auto;/);
  assert.match(css, /\.canvas-widget-resize-handle\.width\s*\{[^}]*cursor:\s*ew-resize;/);
  assert.match(css, /\.canvas-widget-resize-handle\.height\s*\{[^}]*cursor:\s*ns-resize;/);
  assert.match(css, /\.canvas-widget-resize-handle\.corner\s*\{[^}]*cursor:\s*nwse-resize;/);
  assert.match(hit, /draftActionPoints\(box, handle, false, true\)/);
  assert.match(hit, /widgetResizeHit\(box, point, pointerType\)/);
  for (const control of ["width", "height", "resize"]) assert.match(functionSource(app, "widgetResizeHit"), new RegExp(`return "${control}"`));
  assert.match(begin, /result\.hit === "accept"[\s\S]*?acceptPendingWidget[\s\S]*?acceptWidgetEdit/);
  assert.match(begin, /result\.hit === "cancel"[\s\S]*?rejectPendingWidget[\s\S]*?deleteWidget\(result\.widget\)/);
  assert.match(functionSource(app, "deleteWidget"), /recordWidgetsBefore\(\)[\s\S]*?state\.widgets = state\.widgets\.filter[\s\S]*?saveUserCanvasChange\(\)[\s\S]*?setStatusKey\("widgetDeleted"\)/);
  assert.doesNotMatch(functionSource(app, "deleteWidget"), /confirm\(/);
  assert.match(functionSource(app, "applyHistory"), /widgetsBefore[\s\S]*?widgetsAfter[\s\S]*?restoreWidgets/);
  assert.match(begin, /start:widgetLayout\(result\.widget\)/);
  assert.match(updatePoint, /gesture\.hit === "move"[\s\S]*?resizeWidgetBox/);
  assert.match(finishReleased, /event\.pointerType !== "mouse"[\s\S]*?Number\(event\.buttons\) !== 0[\s\S]*?gesture\.source !== "widget-host"[\s\S]*?finishWidgetGesture/);
  assert.match(finishStaleHost, /gesture\.source !== "widget-host"[\s\S]*?Number\(event\.button\) !== 0[\s\S]*?finishWidgetGesture/);
  assert.match(pointerHit, /hit && hit !== "move"/);
  assert.match(messageHandler, /validWidgetHostDrag\(message\)[\s\S]*?beginWidgetHostDrag\(widget, message\)[\s\S]*?updateWidgetHostDrag\(widget, message\)[\s\S]*?finishWidgetHostDrag\(widget, message\)/);
  assert.match(messageHandler, /validWidgetHostTouch\(message\)[\s\S]*?beginWidgetHostTouch\(widget, message\)[\s\S]*?updateWidgetHostTouch\(widget, message\)[\s\S]*?finishWidgetHostTouch\(widget, message\)/);
  assert.doesNotMatch(messageHandler, /validWidgetHostNavigation|handleWidgetHostNavigation/);
  assert.match(messageHandler, /validWidgetHostActivate\(message\)[\s\S]*?handObjectToolbarTargetFromWidgetMessage\(widget, message\)[\s\S]*?showHandObjectToolbar\(target\.kind, target\.object\)/);
  const beginResize = functionSource(app, "beginHandObjectResize");
  assert.match(beginResize, /event\.pointerType === "touch"[\s\S]*?pendingHit[\s\S]*?beginPendingGesture[\s\S]*?widgetPointerHit\(point, event\.pointerType, false\)[\s\S]*?beginWidgetGesture[\s\S]*?imagePointerHit\(point, event\.pointerType, false\)[\s\S]*?beginImageGesture[\s\S]*?animationPointerHit\(point, event\.pointerType\)[\s\S]*?beginAnimationGesture/);
  assert.match(pointerDown, /state\.pointers\.set[\s\S]*?beginHandObjectResize\(e, handPoint\)[\s\S]*?beginHandObjectFocus\(e, handPoint\)/);
  assert.match(pointerMove, /Number\(e\.buttons\) === 0[\s\S]*?syncWidgetResizeCursor\(point, e\.pointerType\)/);
  assert.match(functionSource(widgetHost, "controlHit"), /rightDistance[\s\S]*?bottomDistance[\s\S]*?return "resize"[\s\S]*?return "width"[\s\S]*?return "height"/);
  assert.match(widgetHost, /RESIZE_CURSOR_CLASSES = \["penecho-widget-resize-width", "penecho-widget-resize-height", "penecho-widget-resize-corner"\]/);
  assert.match(functionSource(widgetHost, "setControlCursor"), /classList\.remove\(className\)[\s\S]*?classList\.add\(RESIZE_CURSOR_CLASSES\[0\]\)[\s\S]*?classList\.add\(RESIZE_CURSOR_CLASSES\[1\]\)[\s\S]*?classList\.add\(RESIZE_CURSOR_CLASSES\[2\]\)/);
  assert.match(widgetHost, /penecho-widget-resize-width[^}]*cursor:ew-resize!important[\s\S]*?penecho-widget-resize-height[^}]*cursor:ns-resize!important[\s\S]*?penecho-widget-resize-corner[^}]*cursor:nwse-resize!important/);
  assert.doesNotMatch(messageHandler, /penecho-widget-copy-source/);
  assert.match(functionSource(app, "sendWidgetHostState"), /selected[\s\S]*?penecho-widget-state[\s\S]*?scaleX[\s\S]*?scaleY/);
  assert.match(functionSource(app, "beginWidgetHostDrag"), /state\.handWidgetPointerIds[\s\S]*?source:"widget-host"[\s\S]*?hit:message\.hit[\s\S]*?startPoint:clientPoint/);
  const widgetStackState = {
      widgets:[
        { id:"html-a", widgetType:"html_widget" },
        { id:"diagram", widgetType:"diagram_source" },
        { id:"html-b", widgetType:"html_widget" },
      ],
      widgetEdit:{ id:"html-a", changed:false },
    },
    stackMoves = [],
    frontKinds = [],
    setWidgetStackIndex = vm.runInNewContext(`(${functionSource(app, "setWidgetStackIndex")})`, {
      state:widgetStackState,
      syncWidgetLayerOrder:() => stackMoves.push(widgetStackState.widgets.map(widget => widget.id)),
    }),
    bringHtmlWidgetToFront = vm.runInNewContext(`(${functionSource(app, "bringHtmlWidgetToFront")})`, {
      state:widgetStackState,
      setWidgetStackIndex,
      setCanvasObjectFrontKind:(kind) => (frontKinds.push(kind), true),
    });
  assert.equal(bringHtmlWidgetToFront(widgetStackState.widgets[0]), true);
  assert.deepEqual(widgetStackState.widgets.map(widget => widget.id), ["diagram", "html-b", "html-a"]);
  assert.equal(widgetStackState.widgetEdit.changed, true);
  assert.deepEqual(stackMoves, [["diagram", "html-b", "html-a"]]);
  assert.deepEqual(frontKinds, ["widget"]);
  assert.equal(bringHtmlWidgetToFront(widgetStackState.widgets[0]), true, "every Widget kind shares the click-to-front order");
  assert.deepEqual(widgetStackState.widgets.map(widget => widget.id), ["html-b", "html-a", "diagram"]);
  assert.deepEqual(stackMoves, [["diagram", "html-b", "html-a"], ["html-b", "html-a", "diagram"]]);
  assert.deepEqual(frontKinds, ["widget", "widget"]);
  const stackStyles = [{}, {}, {}],
    syncWidgetLayerOrder = vm.runInNewContext(`(${functionSource(app, "syncWidgetLayerOrder")})`, {
      state:{
        widgets:stackStyles.slice(0, 2).map(style => ({ styleRule:{ style } })),
        pendingWidget:{ styleRule:{ style:stackStyles[2] } },
      },
    });
  syncWidgetLayerOrder();
  assert.deepEqual(stackStyles.map(style => style.zIndex), ["1", "2", "3"]);
  assert.doesNotMatch(functionSource(app, "syncWidgetLayerOrder"), /append|appendChild|insertBefore/, "changing Widget order must not reparent live iframes");
  assert.match(functionSource(app, "mountWidget"), /addWidgetStyleRule\(widget\);[\s\S]*?syncWidgetLayerOrder\(\);[\s\S]*?positionWidget\(widget\)/);
  assert.match(functionSource(app, "mountWidget"), /frame\.addEventListener\("load"[\s\S]*?updateWidgetHostForFrameLoad\(widget, hostLoadState\)[\s\S]*?probeWidgetHost\(widget\)/);
  assert.match(functionSource(app, "updateWidgetHostForFrameLoad"), /loadState\.observed[\s\S]*?if \(!reload\) return false[\s\S]*?widget\.initialized = false[\s\S]*?widget\.hostReady = false[\s\S]*?widget\.hostReadyPromise = new Promise/);
  assert.match(functionSource(app, "beginWidgetGesture"), /beginWidgetEdit\(result\.widget\)/);
  assert.doesNotMatch(functionSource(app, "beginWidgetGesture"), /bringHtmlWidgetToFront/);
  assert.match(functionSource(app, "beginWidgetHostDrag"), /beginWidgetEdit\(widget\)[\s\S]*?bringHtmlWidgetToFront\(widget\)/);
  assert.match(functionSource(app, "beginWidgetEdit"), /beforeIndex:state\.widgets\.indexOf\(widget\)[\s\S]*?beforeFrontCanvasObjectKind:state\.frontCanvasObjectKind/);
  assert.match(functionSource(app, "cancelWidgetEdit"), /setWidgetStackIndex\(widget, edit\.beforeIndex\)[\s\S]*?restoreCanvasObjectFrontKinds\(edit\.beforeFrontCanvasObjectKind, edit\.beforeFrontPlacedCanvasObjectKind\)/);
  assert.match(functionSource(app, "updateWidgetHostDrag"), /widgetHostViewportPoint[\s\S]*?updateWidgetGesturePoint/);
  assert.match(functionSource(app, "finishWidgetHostDrag"), /finishWidgetGesture/);
  const handTarget = functionSource(app, "handObjectToolbarTargetAtPoint");
  assert.match(handTarget, /textBoxAtPoint\(point\)[\s\S]*?imageAtPoint\(point\)[\s\S]*?widgetAtPoint\(point\)[\s\S]*?frontCanvasObjectKind === "widget"[\s\S]*?ordered\.find/);
  assert.ok(handTarget.indexOf("ordered.find") < handTarget.indexOf("animationPointerHit(point)"));
  assert.match(functionSource(app, "handObjectToolbarTargetFromWidgetMessage"), /widgetHostViewportPoint\(widget, message\)[\s\S]*?handObjectToolbarTargetAtPoint\(clientPoint[\s\S]*?kind:"widget"/);
  assert.match(functionSource(app, "beginWidgetHostTouch"), /beginWidgetOwnedHandGesture\(id\)[\s\S]*?handObjectToolbarTargetFromWidgetMessage\(widget, message\)[\s\S]*?focusHandObject\(target\.kind, target\.object, token\)[\s\S]*?handPointerFocusKeys\.set/);
  assert.doesNotMatch(functionSource(app, "beginWidgetHostTouch"), /state\.touches|beginTouchGesture|moveCanvas/);
  assert.match(functionSource(app, "updateWidgetHostTouch"), /handWidgetPointerIds\.has\(id\)[\s\S]*?updateHandObjectFocus/);
  assert.doesNotMatch(functionSource(app, "updateWidgetHostTouch"), /updateTouchGesture|moveCanvas/);
  assert.match(functionSource(app, "finishWidgetHostTouch"), /finishHandObjectFocus[\s\S]*?finishWidgetOwnedHandGesture[\s\S]*?widgetHostPointerAnchors\.delete/);
  assert.match(functionSource(app, "beginWidgetOwnedHandGesture"), /handGestureIncludesWidget = true[\s\S]*?panGesture = null[\s\S]*?touchGesture = null/);
  const clearWidgetOwned = functionSource(app, "clearWidgetOwnedHandGestures"),
    beginResetTap = functionSource(app, "beginCanvasWidgetGestureResetTap"),
    updateResetTap = functionSource(app, "updateCanvasWidgetGestureResetTap"),
    finishResetTap = functionSource(app, "finishCanvasWidgetGestureResetTap");
  assert.match(clearWidgetOwned, /handWidgetPointerIds[\s\S]*?widgetHostPointerAnchors[\s\S]*?finishHandObjectFocus[\s\S]*?finishWidgetRefineTouch[\s\S]*?handWidgetPointerIds\.clear\(\)[\s\S]*?widgetHostPointerAnchors\.clear\(\)[\s\S]*?handGestureIncludesWidget = false/);
  assert.match(clearWidgetOwned, /pointerPrefix[\s\S]*?widget-host:[^\n]*widget\.id[\s\S]*?state\.widgetGesture\?\.widget === widget[\s\S]*?handWidgetPointerIds\.delete[\s\S]*?widgetHostPointerAnchors\.delete[\s\S]*?state\.widgetGesture = null/);
  assert.match(functionSource(app, "unmountWidget"), /clearWidgetOwnedHandGestures\(widget\)[\s\S]*?widget\.shell\?\.remove\(\)/);
  assert.match(beginResetTap, /state\.mode !== "select"[\s\S]*?\["mouse", "touch"\][\s\S]*?event\.isPrimary === false[\s\S]*?state\.pointers\.size[\s\S]*?handObjectToolbarTargetAtPoint\(point\)/);
  assert.match(updateResetTap, /state\.pointers\.size > 1[\s\S]*?Math\.hypot[\s\S]*?HAND_WIDGET_GESTURE_RESET_TAP_PX/);
  assert.match(finishResetTap, /state\.mode !== "select"[\s\S]*?event\.type === "pointercancel"[\s\S]*?state\.pointers\.size[\s\S]*?state\.touches\.size[\s\S]*?clearWidgetOwnedHandGestures\(\)/);
  assert.match(pointerDown, /beginCanvasWidgetGestureResetTap\(e, handPoint\)[\s\S]*?state\.pointers\.set/);
  assert.match(app, /screen\.addEventListener\("pointermove"[\s\S]*?updateCanvasWidgetGestureResetTap\(e\)[\s\S]*?finishReleasedWidgetGesture\(e\)/);
  assert.match(functionSource(app, "end"), /state\.pointers\.delete[\s\S]*?state\.touches\.delete[\s\S]*?finishCanvasWidgetGestureResetTap\(e\)[\s\S]*?handGestureIncludesWidget/);
  const resetState = {
      mode:"select",
      handGestureIncludesWidget:true,
      handWidgetPointerIds:new Set(["widget-touch:1"]),
      pointers:new Map(),
      touches:new Map(),
    },
    resetAnchors = new Map([["widget-touch:1", {}]]),
    resetFinished = [],
    resetHarness = vm.runInNewContext(`(() => {
      const HAND_WIDGET_GESTURE_RESET_TAP_PX = 8;
      let canvasWidgetGestureResetTap = null;
      ${clearWidgetOwned}
      ${beginResetTap}
      ${updateResetTap}
      ${finishResetTap}
      return { beginCanvasWidgetGestureResetTap, updateCanvasWidgetGestureResetTap, finishCanvasWidgetGestureResetTap };
    })()`, {
      state:resetState,
      widgetHostPointerAnchors:resetAnchors,
      valid:() => true,
      handObjectToolbarTargetAtPoint:() => null,
      finishHandObjectFocus:({ pointerId }) => resetFinished.push(`focus:${pointerId}`),
      finishWidgetRefineTouch:(pointerId) => resetFinished.push(`refine:${pointerId}`),
    }),
    resetPointer = { pointerId:7, pointerType:"touch", isPrimary:true, button:0, clientX:100, clientY:120 };
  assert.equal(resetHarness.beginCanvasWidgetGestureResetTap(resetPointer, { x:10, y:20 }), true);
  assert.equal(resetHarness.finishCanvasWidgetGestureResetTap({ ...resetPointer, type:"pointerup" }), true);
  assert.equal(resetState.handGestureIncludesWidget, false);
  assert.equal(resetState.handWidgetPointerIds.size, 0);
  assert.equal(resetAnchors.size, 0);
  assert.deepEqual(resetFinished, ["focus:widget-touch:1", "refine:widget-touch:1"]);
  resetState.mode = "pen";
  resetState.handGestureIncludesWidget = true;
  resetState.handWidgetPointerIds.add("widget-touch:2");
  assert.equal(resetHarness.beginCanvasWidgetGestureResetTap(resetPointer, { x:10, y:20 }), false);
  assert.equal(resetState.handWidgetPointerIds.has("widget-touch:2"), true);
  assert.doesNotMatch(functionSource(app, "mountWidget"), /pointerenter|pointerleave|updateHandObjectHover/);
  assert.match(functionSource(app, "handleWidgetMessage"), /validWidgetHostActivate\(message\)[\s\S]*?state\.mode === "select"[\s\S]*?showHandObjectToolbar\(target\.kind, target\.object\)/);
  const trackedPoint = vm.runInNewContext(`(${functionSource(app, "widgetHostTrackedPoint")})`, { screenClientRatio:0.5 });
  assert.deepEqual({ ...trackedPoint({ clientX:100, clientY:200, screenX:500, screenY:600 }, { screenX:540, screenY:660 }) }, { x:120, y:230 });
  assert.equal(trackedPoint(null, { screenX:0, screenY:0 }), null);
  assert.match(functionSource(app, "updateWidgetHostTouch"), /widgetHostTrackedPoint\(widgetHostPointerAnchors\.get\(id\), message\)/);
  assert.match(functionSource(app, "updateWidgetHostDrag"), /widgetHostTrackedPoint\(gesture\.hostAnchor, message\)/);
  assert.match(functionSource(app, "beginWidgetHostTouch"), /widgetHostPointerAnchors\.set\(id/);
  assert.match(functionSource(app, "beginWidgetHostDrag"), /hostAnchor:\{ clientX:viewportPoint\.x, clientY:viewportPoint\.y, screenX:message\.screenX, screenY:message\.screenY \}/);
  assert.match(functionSource(app, "finishWidgetHostTouch"), /widgetHostPointerAnchors\.delete\(id\)/);
  assert.match(functionSource(app, "validWidgetHostTouch"), /message\.screenX, message\.screenY/);
  assert.match(functionSource(app, "validWidgetHostDrag"), /message\.screenX, message\.screenY/);
  assert.match(functionSource(app, "calibrateScreenClientRatio"), /screenClientRatio/);
  assert.match(functionSource(app, "renderInteractionLayer"), /drawSelectedAnimation[\s\S]*?drawPending[\s\S]*?drawWidgetChrome/);
  const objectSelection = functionSource(app, "beginCanvasObjectSelection");
  assert.ok(objectSelection.indexOf("widgetPointerHit(point") < objectSelection.indexOf("animationPointerHit(point"));
  assert.match(app, /state\.widgetGesture\?\.id === e\.pointerId[\s\S]*?updateWidgetGesture\(e\)/);
  assert.match(app, /state\.widgetGesture\?\.id === e\.pointerId[\s\S]*?finishWidgetGesture\(e\)/);
  assert.match(pointerDown, /finishStaleWidgetHostGesture\(e\)/);
  assert.match(app, /objectChromeLayer\?\.addEventListener\("pointermove"[\s\S]*?finishReleasedWidgetGesture\(event\)/);
  assert.match(css, /\.widget-layer\s*\{[^}]*z-index:\s*1[^}]*pointer-events:\s*none/);
  assert.match(css, /\.canvas-widget\s*\{[^}]*pointer-events:\s*none/);
  assert.match(frameRule, /pointer-events:\s*none/);
  assert.match(css, /#viewport\.widget-selection-enabled \.canvas-widget\.is-interacting \.canvas-widget-frame\s*\{[^}]*pointer-events:\s*auto/);
  assert.match(frameRule, /touch-action:\s*none/);
  assert.match(frameRule, /border:\s*0/);
  assert.match(frameRule, /background:\s*transparent/);
  assert.doesNotMatch(frameRule, /box-shadow|border-radius/);
  assert.doesNotMatch(css, /canvas-widget-toolbar/);
  const downloadWidgetImage = functionSource(app,"downloadWidgetImage");
  assert.match(downloadWidgetImage,/requestWidgetSnapshot\(widget, WIDGET_SNAPSHOT_TIMEOUT_MS, true, null, true, true\)[\s\S]*?link\.download = widgetImageFilename\(widget\)[\s\S]*?link\.click\(\)/);
  assert.doesNotMatch(downloadWidgetImage,/\bfetch\s*\(|XMLHttpRequest|WebSocket|\/api\/|cloud|relay/i);
  assert.match(app,/function addWidgetToolSpecs[\s\S]*?kind:"download"[\s\S]*?widgetToolGroup = `widget-\$\{widget\.id\}-tools`[\s\S]*?objectToolbarItem:Boolean\(options\.objectToolbarKey\)/);
  for (const key of ["downloadWidget","widgetDownloading","widgetDownloaded","widgetDownloadFailed"]) {
    assert.match(app,new RegExp(`${key}:`));
    assert.match(read("public/locales/zh.js"),new RegExp(`${key}:`));
  }
  assert.match(read("src/server/main.js"), /Keep user-facing text natively selectable and do not globally disable text selection/);
});

test("text stays above placed objects while selected Widgets temporarily cover it", () => {
  const app = read("public/app.js"),
    widgetHost = read("public/widget-host.js"),
    imageA = { id:"image-a" },
    imageB = { id:"image-b" },
    imageState = {
      images:[imageA, imageB],
      imageEdit:{ id:imageA.id, changed:false },
      frontCanvasObjectKind:"widget",
      frontPlacedCanvasObjectKind:"text-box",
    },
    frontKinds = [],
    renders = [],
    setImageStackIndex = vm.runInNewContext(`(${functionSource(app, "setImageStackIndex")})`, { state:imageState }),
    bringImageToFront = vm.runInNewContext(`(${functionSource(app, "bringImageToFront")})`, {
      state:imageState,
      setImageStackIndex,
      setCanvasObjectFrontKind:(kind) => (frontKinds.push(kind), imageState.frontCanvasObjectKind = kind, true),
      requestRender:() => renders.push("render"),
    });
  assert.equal(bringImageToFront(imageA), true);
  assert.deepEqual(imageState.images.map(item => item.id), ["image-b", "image-a"]);
  assert.deepEqual(frontKinds, ["image"]);
  assert.equal(imageState.imageEdit.changed, true);
  assert.deepEqual(renders, ["render"]);

  const textA = { id:"text-a" },
    textB = { id:"text-b" },
    textState = { textBoxes:[textA, textB], frontCanvasObjectKind:"image", frontPlacedCanvasObjectKind:"image" },
    textFrontKinds = [],
    textRenders = [],
    setTextBoxStackIndex = vm.runInNewContext(`(${functionSource(app, "setTextBoxStackIndex")})`, { state:textState }),
    bringTextBoxToFront = vm.runInNewContext(`(${functionSource(app, "bringTextBoxToFront")})`, {
      state:textState,
      setTextBoxStackIndex,
      setCanvasObjectFrontKind:(kind) => (textFrontKinds.push(kind), textState.frontCanvasObjectKind = kind, textState.frontPlacedCanvasObjectKind = kind, true),
      requestRender:() => textRenders.push("render"),
    });
  assert.equal(bringTextBoxToFront(textA), true);
  assert.deepEqual(textState.textBoxes.map(item => item.id), ["text-b", "text-a"]);
  assert.deepEqual(textFrontKinds, ["text-box"]);
  assert.deepEqual(textRenders, ["render"]);

  const placedDrawOrder = [],
    placedState = { frontPlacedCanvasObjectKind:"text-box" },
    drawPlacedCanvasObjectsToContext = vm.runInNewContext(`(${functionSource(app, "drawPlacedCanvasObjectsToContext")})`, {
      state:placedState,
      drawImagesToContext:() => placedDrawOrder.push("image"),
      drawTextBoxesToContext:() => placedDrawOrder.push("text-box"),
    });
  drawPlacedCanvasObjectsToContext({}, null, false);
  assert.deepEqual(placedDrawOrder, ["image"]);
  placedDrawOrder.length = 0;
  placedState.frontPlacedCanvasObjectKind = "image";
  drawPlacedCanvasObjectsToContext({}, null, false);
  assert.deepEqual(placedDrawOrder, ["image"]);

  const layerState = { frontCanvasObjectKind:"image", frontPlacedCanvasObjectKind:"image" },
    layerStyles = new Map(),
    selectedLayerMaterial = { hidden:true },
    syncCanvasObjectLayerOrder = vm.runInNewContext(`(${functionSource(app, "syncCanvasObjectLayerOrder")})`, {
      state:layerState,
      widgetLayer:{},
      imageMaterialLayer:{},
      placedContentLayer:{},
      textEditorLayer:{},
      selectedWidgetMaterial:selectedLayerMaterial,
      runtimeElementStyle:(_element, key) => {
        if (!layerStyles.has(key)) layerStyles.set(key, { setProperty(name, value) { this[name] = value; } });
        return layerStyles.get(key);
      },
    });
  syncCanvasObjectLayerOrder();
  assert.deepEqual([
    layerStyles.get("widget-layer-stack").zIndex,
    layerStyles.get("image-material-layer-stack").zIndex,
    layerStyles.get("placed-content-layer-stack").zIndex,
    layerStyles.get("text-editor-layer-stack")["--text-editor-layer-z"],
  ], ["1", "2", "2", "3"]);
  layerState.frontCanvasObjectKind = "widget";
  syncCanvasObjectLayerOrder();
  assert.deepEqual([
    layerStyles.get("widget-layer-stack").zIndex,
    layerStyles.get("image-material-layer-stack").zIndex,
    layerStyles.get("placed-content-layer-stack").zIndex,
    layerStyles.get("text-editor-layer-stack")["--text-editor-layer-z"],
  ], ["2", "1", "1", "3"]);
  layerState.frontCanvasObjectKind = "text-box";
  layerState.frontPlacedCanvasObjectKind = "text-box";
  syncCanvasObjectLayerOrder();
  assert.deepEqual([
    layerStyles.get("widget-layer-stack").zIndex,
    layerStyles.get("image-material-layer-stack").zIndex,
    layerStyles.get("placed-content-layer-stack").zIndex,
    layerStyles.get("text-editor-layer-stack")["--text-editor-layer-z"],
  ], ["1", "2", "2", "3"]);
  selectedLayerMaterial.hidden = false;
  layerState.frontCanvasObjectKind = "image";
  layerState.frontPlacedCanvasObjectKind = "image";
  syncCanvasObjectLayerOrder();
  assert.deepEqual([
    layerStyles.get("widget-layer-stack").zIndex,
    layerStyles.get("image-material-layer-stack").zIndex,
    layerStyles.get("placed-content-layer-stack").zIndex,
    layerStyles.get("text-editor-layer-stack")["--text-editor-layer-z"],
  ], ["3", "2", "2", "2"]);

  const hitState = { frontCanvasObjectKind:"widget", frontPlacedCanvasObjectKind:"text-box" },
    hitImage = { id:"image" },
    hitText = { id:"text-box" },
    hitWidget = { id:"widget" },
    handObjectToolbarTargetAtPoint = vm.runInNewContext(`(${functionSource(app, "handObjectToolbarTargetAtPoint")})`, {
      state:hitState,
      valid:() => true,
      textBoxAtPoint:() => hitText,
      imageAtPoint:() => hitImage,
      widgetAtPoint:() => hitWidget,
      animationPointerHit:() => null,
    });
  assert.equal(handObjectToolbarTargetAtPoint({ x:1, y:1 }).object.id, "text-box");
  hitState.frontCanvasObjectKind = "image";
  hitState.frontPlacedCanvasObjectKind = "image";
  assert.equal(handObjectToolbarTargetAtPoint({ x:1, y:1 }).object.id, "text-box");
  hitState.frontCanvasObjectKind = "text-box";
  hitState.frontPlacedCanvasObjectKind = "text-box";
  assert.equal(handObjectToolbarTargetAtPoint({ x:1, y:1 }).object.id, "text-box");

  hitState.selectedWidgetId = "widget";
  assert.equal(handObjectToolbarTargetAtPoint({ x:1, y:1 }).object.id, "widget");
  hitState.selectedWidgetId = null;
  assert.equal(handObjectToolbarTargetAtPoint({ x:1, y:1 }).object.id, "text-box");

  assert.match(functionSource(app, "setCanvasObjectFrontKind"), /\["image", "widget", "text-box"\][\s\S]*?frontPlacedCanvasObjectKind/);
  assert.doesNotMatch(functionSource(app, "beginHandObjectFocus"), /bringHtmlWidgetToFront/);
  assert.match(functionSource(app, "beginImageGesture"), /beginImageEdit\(result\.image\)[\s\S]*?bringImageToFront\(result\.image\)/);
  assert.match(functionSource(app, "beginImageEdit"), /beforeIndex:state\.images\.indexOf\(item\)[\s\S]*?beforeFrontCanvasObjectKind:state\.frontCanvasObjectKind[\s\S]*?beforeFrontPlacedCanvasObjectKind:state\.frontPlacedCanvasObjectKind/);
  assert.match(functionSource(app, "cancelImageEdit"), /setImageStackIndex\(item, edit\.beforeIndex\)[\s\S]*?restoreCanvasObjectFrontKinds\(edit\.beforeFrontCanvasObjectKind, edit\.beforeFrontPlacedCanvasObjectKind\)/);
  assert.match(functionSource(app, "editTextBox"), /bringTextBoxToFront\(item\)[\s\S]*?state\.selectedTextBoxId = item\.id/);
  assert.match(functionSource(app, "focusTextEditor"), /setCanvasObjectFrontKind\("text-box"\)[\s\S]*?state\.activeTextEditorId/);
  assert.match(widgetHost, /addEventListener\("pointerdown"[\s\S]*?event\.pointerType !== "touch" && !hit[\s\S]*?type:"penecho-widget-activate"[\s\S]*?\{ capture:true, passive:false \}/,
    "captured Widget activation must also see clicks that originate in text inputs");
  assert.doesNotMatch(functionSource(app, "syncCanvasObjectLayerOrder"), /append|appendChild|insertBefore/, "layer changes must not reparent Widget iframes");
});

test("widget AI refinement is discoverable near ink and replaces only its locked target", () => {
  const app = read("public/app.js"),
    css = read("public/style.css"),
    zh = read("public/locales/zh.js"),
    server = read("src/server/main.js"),
    candidate = functionSource(app, "currentWidgetRefineCandidate"),
    latch = functionSource(app, "latchWidgetRefineCandidate"),
    strokeProximity = functionSource(app, "strokeWidgetProximity"),
    context = functionSource(app, "widgetEditContext"),
    request = functionSource(app, "requestWidgetRefinement"),
    validate = functionSource(app, "validate"),
    replacementInput = functionSource(app, "widgetReplacementRecordInput"),
    start = functionSource(app, "startPendingWidgetReplacement"),
    accept = functionSource(app, "acceptPendingWidget"),
    reject = functionSource(app, "rejectPendingWidget"),
    cancel = functionSource(app, "cancelWidgetRefinement"),
    createChromeButton = functionSource(app, "createObjectChromeButton"),
    mode = functionSource(app, "setCanvasMode"),
    snapshot = functionSource(app, "requestWidgetSnapshot"),
    chrome = functionSource(app, "objectChromeSpecs"),
    selectedRefine = functionSource(app, "selectedWidgetRefineCandidate"),
    confirmation = functionSource(app, "syncWidgetRefineConfirmation"),
    record = functionSource(app, "widgetRecord"),
    serialize = functionSource(app, "serializedWidgets");

  assert.match(candidate, /const candidate = state\.widgetRefineCandidate/);
  assert.match(candidate, /if \(!candidate\) return null/);
  assert.doesNotMatch(candidate, /pluginId/);
  assert.match(latch, /if \(state\.widgetRefineCandidate[\s\S]*?return state\.widgetRefineCandidate/);
  assert.match(latch, /for \(const widget of visibleWidgets\(\)\)[\s\S]*?kind === "text-box"[\s\S]*?boxWidgetProximity\(widget, textBoxBox\(input\)\)[\s\S]*?kind === "box"[\s\S]*?boxWidgetProximity\(widget, input\)[\s\S]*?strokeWidgetProximity\(widget, input\)/);
  assert.match(latch, /instructionMode:"nearby-dirty"[\s\S]*?hintKey:"widgetRefineNearbyHint"[\s\S]*?hintUntil:Date\.now\(\) \+ WIDGET_REFINE_HINT_MS/);
  assert.match(app, /const WIDGET_REFINE_PROXIMITY_PX = 24/);
  assert.match(app, /const WIDGET_REFINE_HOVER_GRACE_MS = 5000/);
  assert.match(app, /const WIDGET_REFINE_HINT_MS = 10000/);
  assert.match(strokeProximity, /drawing\.trail[\s\S]*?drawing\.last[\s\S]*?next <= WIDGET_REFINE_PROXIMITY_PX[\s\S]*?distance <= WIDGET_REFINE_PROXIMITY_PX/);
  const nonHandChrome = chrome.slice(0, chrome.indexOf("return specs;"));
  assert.match(nonHandChrome, /persistentCandidate = currentWidgetRefineCandidate\(\)[\s\S]*?hoverCandidate = currentWidgetRefineHoverCandidate\(\)[\s\S]*?!\["select", "hand", "pen"\]\.includes\(state\.mode\)/);
  assert.doesNotMatch(nonHandChrome, /copy:true/);
  assert.doesNotMatch(chrome, /target:"text-box"/);
  assert.match(chrome, /if \(!state\.viewMode && !state\.interactingWidgetId && persistentCandidate\) addWidgetToolSpecs\(specs, persistentCandidate\.widget, \{ refine:persistentCandidate \}\)/);
  assert.match(functionSource(app, "updateWidgetRefinePointer"), /state\.mode === "pen" \? widgetAtRefinePoint[\s\S]*?const hasDirty = viewportHasWidgetRefineInput/);
  assert.match(functionSource(app, "updateWidgetRefinePointer"), /instructionMode:"viewport-dirty"[\s\S]*?hintKey:"widgetRefineViewportHint"/);
  assert.match(selectedRefine, /persistentCandidate\?\.widget === widget[\s\S]*?hoverCandidate\?\.widget === widget/);
  assert.match(selectedRefine, /const hasDirty = viewportHasWidgetRefineInput\(\)[\s\S]*?instructionMode:hasDirty \? "viewport-dirty" : "implicit-polish"[\s\S]*?hintKey:hasDirty \? "widgetRefineViewportHint" : "widgetRefineNoInputHint"/);
  assert.match(functionSource(app, "scheduleWidgetRefineHoverClear"), /WIDGET_REFINE_HOVER_GRACE_MS/);
  assert.match(functionSource(app, "widgetRefineHintVisible"), /widgetRefineHintHovered\(candidate\) \|\| candidate\.hintUntil > Date\.now\(\)/);
  assert.match(functionSource(app, "confirmTextEditor"), /latchWidgetRefineCandidate\(item, "text-box"\)[\s\S]*?!refineCandidate\) schedule/);
  assert.doesNotMatch(app, /function finishTextBoxChromeGesture\(|function updateTextBoxChromeGesture\(|textBoxGesture/);
  assert.doesNotMatch(read("public/widget-host.js"), /penecho-widget-hover/);
  assert.match(functionSource(app, "beginWidgetRefineTouch"), /state\.mode !== "pen"[\s\S]*?setWidgetRefineHoverCandidate\(widget, false\)[\s\S]*?widgetRefineTouchCandidates\.set/);
  assert.doesNotMatch(functionSource(app, "beginWidgetHostTouch"), /beginWidgetRefineTouch/);
  assert.match(app, /state\.mode === "pen"\) beginWidgetRefineTouch\(`canvas-touch:/);
  assert.match(functionSource(app, "beginWidgetRefineConfirmation"), /dirtyBox[\s\S]*?state\.widgetRefineConfirmation/);
  assert.match(functionSource(app, "beginWidgetRefineConfirmation"), /clearTimeout\(state\.timer\)[\s\S]*?state\.timer = 0[\s\S]*?state\.widgetRefineConfirmation/);
  assert.match(functionSource(app, "beginWidgetRefineConfirmation"), /anchor:anchor \? \{ \.\.\.anchor \} : null/);
  assert.match(app, /activate:\(button\) => void beginWidgetRefineConfirmation\(options\.refine, objectChromeAnchor\(button\)\)/);
  assert.match(functionSource(app, "createObjectChromeButton"), /activate\?\.\(button\)/);
  assert.match(functionSource(app, "confirmWidgetRefinement"), /requestWidgetRefinement\(confirmation\.widget, confirmation\.instructionMode\)/);
  assert.match(functionSource(app, "cancelWidgetRefineConfirmation"), /clearWidgetRefineCandidate\(\)[\s\S]*?state\.auto[\s\S]*?state\.dirty[\s\S]*?state\.autoEligible[\s\S]*?schedule\(state\.autoDelayMs\)/);
  assert.match(functionSource(app, "drawWidgetRefineConfirmation"), /strokeWidgetRefineOutline\(context, widget, 1, !confirmation\.hasDirty, true\)[\s\S]*?strokeRect\(box\.x, box\.y, box\.w, box\.h\)[\s\S]*?widgetRefineConnectorPoints\(box, widgetBounds\)[\s\S]*?connector\.slice\(1\)/);
  assert.match(functionSource(app, "drawWidgetRefineConfirmation"), /strokeStyle = "#007aff"[\s\S]*?lineWidth = 2 \* unit[\s\S]*?setLineDash\(\[\]\)[\s\S]*?strokeRect\(box\.x, box\.y, box\.w, box\.h\)[\s\S]*?widgetRefineConnectorPoints/);
  assert.match(functionSource(app, "widgetRefineConnectorPoints"), /widgetRefineEdgeMidpoints\(fromBox\)[\s\S]*?Math\.hypot[\s\S]*?middleX[\s\S]*?middleY/);
  assert.doesNotMatch(functionSource(app, "drawWidgetRefineConfirmation"), /box\.x \+ box\.w \/ 2[\s\S]*?widgetBounds\.x \+ widgetBounds\.w \/ 2/);
  assert.match(css, /\.widget-refine-confirmation-copy\s*\{[^}]*overflow:\s*visible[^}]*overflow-wrap:\s*anywhere[^}]*white-space:\s*normal/);
  assert.doesNotMatch(css, /\.widget-refine-confirmation-copy\s*\{[^}]*text-overflow:\s*ellipsis/);
  assert.match(confirmation, /Math\.min\(560, view\.clientWidth - 24\)[\s\S]*?element\.offsetHeight/);
  assert.match(confirmation, /peButton\(yes, "secondary", "compact"\)[\s\S]*?peButton\(no, "secondary", "compact"\)/);
  assert.doesNotMatch(confirmation, /peButton\(yes, "primary"/);
  assert.match(css, /:is\(#pe-button-contract, \.widget-refine-confirmation-button\.confirm\)\[data-pe-button="secondary"\]\s*\{[^}]*color:\s*var\(--pe-success[^}]*border-color:\s*color-mix[^}]*background:\s*transparent/);
  assert.match(css, /\.widget-refine-confirmation-button\.confirm\)\[data-pe-button="secondary"\][^{]*:is\(:hover, :focus-visible, :active\)\s*\{[^}]*background:\s*transparent/);
  const confirmationPosition = vm.runInNewContext(`(${functionSource(app, "widgetRefineConfirmationPosition")})`);
  assert.deepEqual({ ...confirmationPosition({ x:300, y:220, width:112, height:34 }, 360, 50, 1000, 700) }, { x:176, y:212 });
  assert.deepEqual({ ...confirmationPosition({ x:930, y:220, width:64, height:34 }, 360, 50, 1000, 700) }, { x:632, y:212 });
  assert.deepEqual({ ...confirmationPosition({ x:300, y:670, width:112, height:34 }, 360, 50, 1000, 700) }, { x:176, y:642 });
  const handChrome = chrome.slice(chrome.indexOf("const specs = [];", chrome.indexOf("return specs;") + 1));
  assert.match(handChrome, /if \(state\.mode === "pen"\) \{[\s\S]*?refine:persistentCandidate[\s\S]*?refine:hoverCandidate[\s\S]*?\}/);
  assert.doesNotMatch(handChrome.slice(handChrome.indexOf("for (const [key, record] of state.handToolbarTargets)")), /addWidgetToolSpecs\([^\n]*refine:/);
  assert.match(handChrome, /record\.kind === "widget"[\s\S]*?record\.expanded[\s\S]*?state\.handToolbarActiveKey !== key[\s\S]*?addObjectToolbarSpecs\(specs, \{[\s\S]*?addWidgetToolSpecs\(specs, handTarget, \{[\s\S]*?copy:true,[\s\S]*?community:true,[\s\S]*?download:true,[\s\S]*?objectToolbarKey:toolbarKey/);
  assert.match(chrome, /state\.pendingWidget[\s\S]*?addObjectToolbarSpecs\(specs, \{[\s\S]*?prefix:`pending-widget:\$\{widget\.id\}`[\s\S]*?addWidgetToolSpecs\(specs, widget, \{[\s\S]*?copy:true,[\s\S]*?download:true,[\s\S]*?objectToolbarKey:toolbarKey/);
  assert.match(request, /supersedeActiveAI\("widget-refine"\)[\s\S]*?captureCurrentViewport:true[\s\S]*?widgetEditTarget:widget/);
  assert.match(functionSource(app, "requestAI"), /let attentionBox = dirtySnapshot[\s\S]*?if \(requestedAttentionBox\) attentionBox = requestedAttentionBox/);
  assert.match(request, /clearTimeout\(state\.timer\)[\s\S]*?state\.timer = 0[\s\S]*?supersedeActiveAI\("widget-refine"\)/);
  assert.match(functionSource(app, "schedule"), /activeWidgetRefinement\(\) \|\| state\.widgetRefineConfirmation/);
  assert.match(functionSource(app, "launchAutomaticAI"), /state\.drawing \|\| state\.widgetRefineConfirmation/);
  assert.doesNotMatch(request, /requestWidgetSnapshot|await/);
  assert.match(context, /widget\.widgetType === "diagram_source" \? \{ source:widget\.source \} : \{ html:widget\.html \}/);
  assert.match(context, /sourceMirrorsHtml = widgetUsesHtmlCopySource\(widget\)/);
  assert.match(context, /sourceMirrorsHtml \? \{ sourceMirrorsHtml:true \} : widget\.widgetType !== "diagram_source" && widget\.copyText \? \{ source:widget\.copyText, copyLabel:widget\.copyLabel \}/);
  assert.match(context, /widget\.widgetType === "html_widget" && widget\.runtimeDiagnostics\?\.errors\?\.length[\s\S]*?runtimeDiagnostics:widget\.runtimeDiagnostics/);
  assert.match(context, /refreshSeconds:widget\.refreshSeconds/);
  assert.doesNotMatch(context, /\bid\b|targetId/);
  for (const field of ["communityOriginItemId", "communityRootItemId", "communityOriginName", "communityOriginGeneration"]) assert.doesNotMatch(context, new RegExp(field));
  assert.doesNotMatch(functionSource(app, "serializedWidgets"), /runtimeDiagnostics/);
  assert.match(functionSource(app, "widgetUsesHtmlCopySource"), /widget\.pluginId !== "image-search"[\s\S]*?!widget\.copyText \|\| widgetSourceMirrorsHtml/);
  assert.match(functionSource(app, "widgetCopySource"), /widgetUsesHtmlCopySource\(widget\) \? widget\.html : widget\.copyText/);
  assert.match(functionSource(app, "widgetCopySourceLabel"), /widgetUsesHtmlCopySource\(widget\)\) return "Copy HTML"/);
  assert.match(validate, /widgetEditTarget && c\.pluginId !== widgetEditTarget\.pluginId/);
  assert.match(validate, /sourceFormat \? `Copy \$\{sourceFormat\}` : "Copy source"/);
  assert.match(start, /state\.widgets\.includes\(target\)[\s\S]*?widgetReplacementRecordInput\(command, target\)[\s\S]*?target\.hiddenForReplacement = true/);
  const replacementRecord = vm.runInNewContext(`(${replacementInput})`),
    protectedOrigin = {
      communityOriginItemId:"123e4567-e89b-42d3-a456-426614174000",
      communityRootItemId:"123e4567-e89b-42d3-a456-426614174001",
      communityOriginName:"Original Echo",
      communityOriginGeneration:7,
    },
    replacement = replacementRecord({
      pluginId:"general",
      html:"<main>AI update</main>",
      favorite:true,
      communityOriginItemId:"123e4567-e89b-42d3-a456-426614174099",
      communityRootItemId:"123e4567-e89b-42d3-a456-426614174098",
      communityOriginName:"Forged origin",
      communityOriginGeneration:99,
    }, {
      id:"widget-7", x:10, y:20, w:300, h:200, contentW:600, contentH:400,
      ...protectedOrigin,
    });
  assert.deepEqual({
    communityOriginItemId:replacement.communityOriginItemId,
    communityRootItemId:replacement.communityRootItemId,
    communityOriginName:replacement.communityOriginName,
    communityOriginGeneration:replacement.communityOriginGeneration,
  }, protectedOrigin);
  assert.equal(replacement.favorite, false);
  assert.equal(replacement.html, "<main>AI update</main>");
  assert.match(start, /state\.pendingWidgetReplacement = \{ target[\s\S]*?acceptPendingWidget\(\{ restoreMode:false \}\)[\s\S]*?Promise\.resolve\(state\.widgets\.includes\(widget\)\)/);
  assert.doesNotMatch(start, /enterAIDraftHandMode|widgetReplacementReady/);
  assert.match(accept, /recordWidgetsBefore\(\)[\s\S]*?state\.widgets\.indexOf\(replacement\.target\)[\s\S]*?state\.widgets\.splice\(index, 1, widget\)[\s\S]*?const historyEntry = save\(\)/);
  assert.match(reject, /replacement\.target\.hiddenForReplacement = false[\s\S]*?mountWidget\(replacement\.target\)/);
  assert.match(cancel, /activeWidgetRefinement\(\)[\s\S]*?state\.pendingWidgetReplacement[\s\S]*?rejectPendingWidget/);
  assert.match(mode, /staysInWidgetRefineModes = \["pen", "hand"\]\.includes\(state\.mode\) && \["pen", "hand"\]\.includes\(mode\)/);
  assert.match(mode, /mode !== state\.mode && !staysInWidgetRefineModes[\s\S]*?else cancelWidgetRefinement\("widget-refine-tool-change"/);
  assert.doesNotMatch(mode, /state\.pendingWidgetReplacement\) rejectPendingWidget/);
  assert.match(mode, /!options\.preserveWidgetRefinement/);
  assert.match(functionSource(app, "enterAIDraftHandMode"), /preserveWidgetRefinement:true/);
  assert.match(snapshot, /try \{[\s\S]*?finally \{[\s\S]*?previousActive === false[\s\S]*?widget\.renderActive = false/);
  for (const field of ["diagramKind", "sourceFormat", "frameworkVersion"]) {
    assert.match(record, new RegExp(field));
    assert.match(serialize, new RegExp(field));
  }
  assert.match(server, /widgetEditPolicy:payload\.widgetEdit\.widgetType === "diagram_source"/);
  assert.match(server, /resolveWidgetEditPatchCommands/);
  assert.match(functionSource(server, "filterWidgetEditCommands"), /commands\.length === 1[\s\S]*?widget\?\.tool === widgetEdit\.widgetType[\s\S]*?widget\.pluginId === widgetEdit\.pluginId/);
  assert.match(server, /sourceFormat is an open string, never an enum/);
  assert.doesNotMatch(server, /ALLOWED_(?:SOURCE_)?FORMATS|SOURCE_FORMATS\s*=\s*new Set/);
  assert.match(functionSource(app, "dismissWidgetRefineCandidate"), /clearWidgetRefineCandidate\(\)/);
  assert.match(app, /widgetRefinePointer/);
  assert.match(functionSource(app, "requestAI"), /^function requestAI[\s\S]*?clearWidgetRefineCandidate\(\)/);
  const finishDrawing = functionSource(app, "finishDrawing"),
    launchAutomatic = functionSource(app, "launchAutomaticAI"),
    scheduleAutomatic = functionSource(app, "schedule");
  assert.match(finishDrawing, /refineCandidate = latchWidgetRefineCandidate\(d\)/);
  assert.match(finishDrawing, /state\.dirty && state\.autoEligible && !refineCandidate\) schedule\(\)/);
  assert.match(finishDrawing, /refineCandidate \? "widgetRefinePending"/);
  assert.match(launchAutomatic, /currentWidgetRefineCandidate\(\)[\s\S]*?setStatusKey\("widgetRefinePending"\)[\s\S]*?return/);
  assert.match(scheduleAutomatic, /currentWidgetRefineCandidate\(\)[\s\S]*?setStatusKey\("widgetRefinePending"\)[\s\S]*?return/);
  assert.match(launchAutomatic, /aiPreparation \|\| state\.activeAI[\s\S]*?return[\s\S]*?supersedeActiveAI\(reason\)/);
  assert.match(scheduleAutomatic, /activeWidgetRefinement\(\)[\s\S]*?return[\s\S]*?state\.timer = setTimeout/);
  assert.match(app, /widgetRefinePending:/);
  assert.match(zh, /widgetRefinePending:/);
  const chromePositionSource = functionSource(app, "objectChromePosition");
  assert.match(chromePositionSource, /if \(spec\?\.objectToolbar\)[\s\S]*?Math\.max\(spec\.minimumWidth \|\| 100, screenBox\.width\)[\s\S]*?x:screenBox\.left, y:screenBox\.top - baseHeight/);
  assert.match(chromePositionSource, /if \(spec\?\.objectToolbarItem\)[\s\S]*?knownPositions\?\.get\?\.\(spec\.objectToolbarKey\)[\s\S]*?toolbarSlot === "leading"[\s\S]*?toolbarSlot === "trailing"/);
  assert.doesNotMatch(chromePositionSource, /querySelectorAll|overlapsObstacle|fallbackPosition/);
  assert.match(functionSource(app, "objectToolbarMinimumWidth"), /itemCount = \(decisions \? 2 : 0\) \+ Math\.max[\s\S]*?itemCount \* itemSize \+ \(itemCount - 1\) \* itemGap \+ inset \* 2/);
  const toolbarMinimumWidth = vm.runInNewContext(`(${functionSource(app, "objectToolbarMinimumWidth")})`),
    finalizeToolbarWidths = vm.runInNewContext(`(${functionSource(app, "finalizeObjectToolbarWidths")})`, {
      objectToolbarMinimumWidth:toolbarMinimumWidth,
    }),
    toolbarSpecs = (width, options = {}) => [{
      key:"widget:compact:toolbar", objectToolbar:true, box:{w:width}, target:"widget", object:{id:"compact"}, priority:2,
      toolbarHasDecisions:options.decisions !== false,
    }, ...Array.from({length:4}, (_, index) => ({
      key:`widget:compact:tool-${index}`, objectToolbarItem:true, objectToolbarKey:"widget:compact:toolbar", toolbarSlot:"tool",
    }))],
    narrowToolbarSpecs = finalizeToolbarWidths(toolbarSpecs(180)),
    wideToolbarSpecs = finalizeToolbarWidths(toolbarSpecs(300)),
    decisionlessToolbarSpecs = finalizeToolbarWidths(toolbarSpecs(180, { decisions:false }));
  assert.equal(toolbarMinimumWidth(4), 196);
  assert.equal(toolbarMinimumWidth(5), 228);
  assert.equal(toolbarMinimumWidth(4, false), 132);
  assert.equal(toolbarMinimumWidth(0, false), 8);
  assert.equal(narrowToolbarSpecs[0].minimumWidth, 196);
  assert.equal(wideToolbarSpecs[0].minimumWidth, 196);
  assert.equal(decisionlessToolbarSpecs[0].minimumWidth, 132);
  assert.equal(narrowToolbarSpecs.some((spec) => spec.toolbarSlot === "move"), false);
  assert.equal(wideToolbarSpecs.some((spec) => spec.toolbarSlot === "move"), false);
  assert.doesNotMatch(app, /function objectToolbarNeedsMove|toolbarSlot:"move"/);
  assert.match(functionSource(app, "finalizeObjectToolbarWidths"), /objectToolbarItem \|\| spec\.toolbarSlot !== "tool"[\s\S]*?toolCounts\.set[\s\S]*?const decisions = spec\.toolbarHasDecisions !== false[\s\S]*?spec\.minimumWidth = objectToolbarMinimumWidth\(toolCounts\.get\(spec\.key\) \|\| 0, decisions\)/);
  assert.match(functionSource(app, "objectChromeSpecs"), /prefix:`widget:\$\{handTarget\.id\}`[\s\S]*?objectToolbarKey:toolbarKey[\s\S]*?return finalizeObjectToolbarWidths\(specs\)/);
  assert.match(functionSource(app, "objectChromeSpecs"), /prefix:`image:\$\{handTarget\.id\}`[\s\S]*?kind:"merge"[\s\S]*?objectToolbarKey:toolbarKey/);
  const syncChrome = functionSource(app, "syncObjectChrome");
  assert.match(syncChrome, /knownPositions = new Map\(\)[\s\S]*?objectChromePosition\(spec\.box, spec\.kind, spec\.key, spec, knownPositions\)[\s\S]*?knownPositions\.set\(spec\.key, position\)/);
  assert.match(syncChrome, /spec\.kind === "refine" \|\| spec\.objectToolbar\) button\.removeAttribute\("title"\)/);
  assert.doesNotMatch(syncChrome, /button\.title = spec\.kind === "refine"/);
  assert.doesNotMatch(app, /function widgetToolScale/);
  assert.match(app, /function addWidgetToolSpecs\(specs, widget, options = \{\}\)[\s\S]*?objectToolbarItem:Boolean\(options\.objectToolbarKey\)[\s\S]*?baseHeight:\(options\.objectToolbarKey \|\| item\.kind === "refine"\) \? 28 : 34/);
  assert.match(app, /kind:"refine"[\s\S]*?baseWidth:92,[\s\S]*?iconOnly:false/);
  assert.match(createChromeButton, /kind === "refine" \? "secondary" : "toolbar"[\s\S]*?button\.dataset\.peMaterial = "control-glass"[\s\S]*?button\.dataset\.peState = "default"[\s\S]*?widget-refine-button-label/);
  assert.match(syncChrome, /buttonLabel = button\.querySelector\("\.widget-refine-button-label"\)[\s\S]*?buttonLabel\.textContent = label/);
  assert.match(css, /\.object-chrome-button\.refine\.solo-widget-tool\)\[data-pe-button="secondary"\][^{]*\{[^}]*height:\s*var\(--object-control-height, 28px\)[^}]*box-shadow:\s*none[^}]*font:\s*500 12\.5px\/var\(--object-control-height, 28px\)/);
  assert.match(css, /\.object-chrome-button\.refine\.solo-widget-tool\)\[data-pe-button="secondary"\]\[data-pe-material="control-glass"\]\s*\{[^}]*border-radius:\s*5px[^}]*background:\s*transparent[^}]*backdrop-filter:\s*blur\(14px\) saturate\(1\.12\)[^}]*animation:\s*widget-refine-button-in 180ms/);
  assert.match(css, /@keyframes widget-refine-button-in\s*\{\s*from\s*\{[^}]*opacity:\s*0[^}]*translate:\s*0 3px[^}]*\}\s*to\s*\{[^}]*opacity:\s*1[^}]*translate:\s*0 0/);
  assert.match(css, /\.object-chrome-button\.refine\.solo-widget-tool\)\[data-pe-button="secondary"\]\[data-pe-material="control-glass"\]:is\(:hover, \.refine-hovered\)\s*\{[^}]*background:\s*transparent/);
  assert.match(css, /#viewport:is\(\.is-drawing, \.canvas-navigation-previewing\)[^}]*\.object-chrome-button\.refine\.solo-widget-tool[^}]*\{[^}]*backdrop-filter:\s*none/);
  assert.match(css, /#viewport:is\(\.is-drawing, \.canvas-navigation-previewing\)[^}]*\.object-chrome-button\.refine\.solo-widget-tool[^}]*\{[^}]*animation:\s*none[^}]*translate:\s*none/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.object-chrome-button\.refine\.solo-widget-tool[^}]*\{[^}]*animation:\s*none[^}]*translate:\s*none/);
  assert.match(app, /kind:"favorite"[\s\S]*?baseWidth:28,[\s\S]*?iconOnly:true/);
  assert.match(app, /kind:"share"[\s\S]*?baseWidth:28,[\s\S]*?iconOnly:true/);
  assert.match(syncChrome, /classList\.toggle\("icon-only", Boolean\(spec\.iconOnly \|\| \(spec\.objectToolbarItem && spec\.kind !== "interact"\)\)\)/);
  assert.match(syncChrome, /classList\.toggle\("widget-chrome-control", Boolean\(spec\.widgetTool \|\| spec\.objectToolbar \|\| spec\.objectToolbarItem\)\)/);
  assert.match(syncChrome, /classList\.toggle\("widget-object-toolbar", Boolean\(spec\.objectToolbar && \["widget", "pending-widget"\]\.includes\(spec\.target\)\)\)/);
  assert.match(syncChrome, /attachedWidgetShells = new Set\(\)[\s\S]*?spec\.objectToolbar && spec\.object\?\.shell[\s\S]*?classList\.toggle\("object-toolbar-attached", attachedWidgetShells\.has\(widget\.shell\)\)/);
  assert.match(syncChrome, /selectedWidgetMaterialRecord = \{ spec, position \}[\s\S]*?syncSelectedWidgetMaterial\(selectedWidgetMaterialRecord\)/);
  assert.match(functionSource(app, "syncSelectedWidgetMaterial"), /widgetStackIndex = state\.widgets\.length \+ \(state\.pendingWidget \? 2 : 1\)[\s\S]*?spec\.object\.styleRule\.style\.zIndex = String\(widgetStackIndex\)[\s\S]*?setProperty\("z-index", String\(widgetStackIndex\)\)/);
  assert.match(app, /favoriteLabelKey = widget\.favoriteBusy \? "favoriteWidgetSaving" : widget\.favorite \? "unfavoriteWidget" : "favoriteWidget"/);
  assert.match(app, /kind:"favorite"[\s\S]*?pressed:widget\.favorite === true,[\s\S]*?busy:widget\.favoriteBusy === true/);
  assert.match(functionSource(app, "createObjectChromeButton"), /kind === "move" \|\| kind === "toolbar" \|\| button\.disabled/);
  assert.match(syncChrome, /classList\.toggle\("is-favorite", Boolean\(spec\.kind === "favorite" && spec\.pressed\)\)/);
  assert.match(syncChrome, /button\.disabled = Boolean\(spec\.busy\)/);
  assert.match(syncChrome, /spec\.kind === "favorite"\) button\.setAttribute\("aria-pressed", String\(Boolean\(spec\.pressed\)\)\)/);
  assert.match(syncChrome, /spec\.busy\) button\.setAttribute\("aria-busy", "true"\)/);
  assert.match(app, /move:'<svg[^']*?<path d="M12 9V3M9 6l3-3 3 3[\s\S]*?M15 12h6M18 9l3 3-3 3/);
  assert.match(read("public/style.css"), /\.object-chrome-button\.move \{ width: 34px; height: 34px;/);
  assert.match(read("public/style.css"), /\.object-chrome-button \{[^}]*box-shadow: none;[^}]*backdrop-filter: none;/);
  assert.match(read("public/style.css"), /body\[data-theme="studio"\] \.object-chrome-button\.widget-chrome-control \{[^}]*border-radius: 8px;[^}]*background: color-mix\(in srgb, var\(--studio-panel\) 74%, transparent\);[^}]*box-shadow: 0 2px 8px[^}]*backdrop-filter: saturate\(1\.16\) blur\(16px\)/);
  assert.match(read("public/style.css"), /\.object-toolbar-shell\) \{[^}]*box-shadow: none;/);
  assert.match(read("public/style.css"), /body\[data-theme="studio"\][^{]*\.object-toolbar-shell\) \{[^}]*box-shadow: none;/);
  assert.match(read("public/style.css"), /body\[data-theme="studio"\] \.object-chrome-button\.widget-chrome-control\.widget-tool \{[^}]*border-style: solid;[^}]*border-radius: 8px/);
  assert.match(read("public/style.css"), /#viewport \.canvas-widget:is\(\.is-selected, \.object-toolbar-attached\), #viewport \.canvas-image-selection \{[^}]*border-radius: 0 0 7px 7px;[^}]*background: transparent;[^}]*box-shadow: none;[^}]*backdrop-filter: none/);
  assert.doesNotMatch(read("public/style.css"), /#viewport \.canvas-widget\.is-selected::after[^\{]*\{[^}]*outline:/);
  assert.match(read("public/style.css"), /#viewport \.canvas-image-selection::after,[\s\S]*?#viewport \.canvas-widget\.object-toolbar-attached::after \{[^}]*opacity: 1;[^}]*border: 1px solid var\(--line\);[^}]*border-top-color: transparent;[^}]*background: transparent;/);
  assert.match(read("public/style.css"), /body\[data-theme="studio"\] #viewport \.canvas-image-selection::after,[\s\S]*?body\[data-theme="studio"\] #viewport \.canvas-widget\.object-toolbar-attached::after \{[^}]*border-color: var\(--studio-line\);[^}]*border-top-color: transparent;/);
  assert.doesNotMatch(read("public/style.css").match(/#viewport \.canvas-image-selection::after \{[^}]*\}/)?.[0] || "", /backdrop-filter|filter:/);
  assert.match(read("public/style.css"), /\.object-chrome-button\.widget-tool\.icon-only \{[^}]*gap: 0;[^}]*padding: 0;/);
  assert.doesNotMatch(functionSource(app, "createObjectChromeButton"), /object-chrome-label/);
  assert.match(read("public/style.css"), /\.object-chrome-button\.favorite\.is-favorite svg \{ fill: currentColor; \}/);
  assert.match(read("public/style.css"), /object-chrome-button\.object-toolbar-item\.favorite\)\[data-pe-button\]\[aria-pressed="true"\] \{[^}]*color: var\(--pe-accent-label/);
  assert.match(read("public/style.css"), /body\[data-theme="studio"\][^{]*object-chrome-button\.object-toolbar-item\.favorite\)\[data-pe-button\]\[aria-pressed="true"\] \{[^}]*color: var\(--studio-accent-strong\);/);
  assert.match(read("public/style.css"), /object-chrome-button\.object-toolbar-item\.favorite\)\[data-pe-button\]\[aria-pressed="true"\] > svg \{\s*fill: currentColor;/);
  assert.match(read("public/style.css"), /\.object-chrome-button\.loading::after \{[^}]*animation: history-save-spin \.8s linear infinite;/);
  assert.match(read("public/style.css"), /object-chrome-button[^}]*scale\(var\(--object-control-scale, 1\)\)/);
  const canvasHtml = read("public/index.html"),
    materialLayerIndex = canvasHtml.indexOf('id="imageMaterialLayer"'),
    placedContentIndex = canvasHtml.indexOf('id="placedContentLayer"');
  assert.ok(materialLayerIndex >= 0 && materialLayerIndex < placedContentIndex);
  assert.match(canvasHtml, /id="imageMaterialLayer"[^>]*>[\s\S]*?id="imageSelectionMaterial"[\s\S]*?<\/div>[\s\S]*?id="placedContentLayer"/);
  assert.match(canvasHtml, /id="widgetLayer"[^>]*>[\s\S]*?id="selectedWidgetMaterial"[^>]*hidden[^>]*aria-hidden="true"[^>]*><\/div>[\s\S]*?<\/div>/);
  assert.match(canvasHtml, /id="objectChromeLayer" class="object-chrome-layer"><\/div>/);
  assert.doesNotMatch(canvasHtml, /imagePlaceBtn|imageDeleteBtn|image-place-control/);
  assert.match(read("public/style.css"), /\.image-material-layer \{[^}]*z-index: 1;[^}]*overflow: hidden;[^}]*pointer-events: none;/);
  assert.match(read("public/style.css"), /body\[data-theme="studio"\] \.selected-widget-material \{[^}]*outline: 0;[^}]*background: color-mix\(in srgb, var\(--studio-panel\) 80%, transparent\);[^}]*drop-shadow\(0 4px 8px color-mix\(in srgb, var\(--studio-chrome-shadow-color\) 72%, transparent\)\)/);
  assert.match(read("public/style.css"), /object-toolbar-surface\.widget-object-toolbar\)[^{]*\{[^}]*border-color: var\(--line\);[^}]*border-bottom-color: transparent;[^}]*background: transparent;[^}]*box-shadow: none;[^}]*backdrop-filter: none/);
});

test("widget Refine discovery stays in the parent canvas and leaves iframe events untouched", () => {
  const app = read("public/app.js"),
    widgetHost = read("public/widget-host.js"),
    css = read("public/style.css"),
    pointer = functionSource(app, "updateWidgetRefinePointer"),
    hitTest = functionSource(app, "widgetAtRefinePoint"),
    messageHandler = functionSource(app, "handleWidgetMessage"),
    frameRule = /\.canvas-widget-frame\s*\{[^}]*\}/.exec(css)?.[0] || "",
    handFrameRule = /#viewport\.widget-selection-enabled \.canvas-widget\.is-interacting \.canvas-widget-frame\s*\{[^}]*\}/.exec(css)?.[0] || "";

  assert.match(pointer, /state\.widgetRefinePointer = point && valid\(point\) \? point : null/);
  assert.match(pointer, /state\.mode === "pen" \? widgetAtRefinePoint\(state\.widgetRefinePointer\) : null/);
  assert.match(hitTest, /visibleWidgets\(\)[\s\S]*?widgetBox\(widget\)[\s\S]*?point\.x[\s\S]*?point\.y/);
  assert.doesNotMatch(hitTest, /contentWindow|postMessage|addEventListener/);
  assert.doesNotMatch(functionSource(app, "mountWidget"), /pointerenter|pointerleave|updateHandObjectHover/);
  assert.match(functionSource(app, "mountWidget"), /frame\.addEventListener\("focus"[\s\S]*?focusHandObject\("widget", widget, "widget-focus"\)/);
  assert.doesNotMatch(widgetHost, /penecho-widget-hover|widget-refine/i);
  assert.doesNotMatch(messageHandler, /refine|hover/i);
  assert.match(frameRule, /pointer-events:\s*none/);
  assert.match(frameRule, /touch-action:\s*none/);
  assert.match(handFrameRule, /pointer-events:\s*auto/);
  assert.match(handFrameRule, /cursor:\s*auto/);
});

test("Widget copy swaps its own icon to a matching frameless check for two seconds", () => {
  const app = read("public/app.js"),
    css = read("public/style.css"),
    copy = functionSource(app, "copyWidgetSource"),
    setStateSource = functionSource(app, "setWidgetCopyButtonState"),
    syncChrome = functionSource(app, "syncObjectChrome"),
    acceptIcon = app.match(/accept:'(<svg[^']+)'/)?.[1] || "",
    copyIcon = app.match(/copy:'(<svg[^']+)'/)?.[1] || "";

  assert.match(copy, /button\._copyGeneration === generation[\s\S]*setWidgetCopyButtonState\(button, copied\)/);
  assert.match(app, /kind:"copy"[\s\S]*?activate:\(button\) => void copyWidgetSource\(widget, button\)/);
  assert.match(setStateSource, /OBJECT_CHROME_ICONS\[copied \? "accept" : "copy"\]/);
  assert.match(setStateSource, /WIDGET_COPY_ICON_FEEDBACK_MS/);
  assert.match(syncChrome, /copyConfirmed = spec\.kind === "copy" && button\.dataset\.copyState === "copied"[\s\S]*?copyConfirmed \? t\("widgetSourceCopied"\) : label/);
  assert.match(app, /WIDGET_COPY_ICON_FEEDBACK_MS = 2000/);
  assert.match(acceptIcon, /^<svg viewBox="0 0 24 24"[^>]*><path\b[^>]*\/><\/svg>$/);
  assert.doesNotMatch(acceptIcon, /<(?:rect|circle)\b/);
  assert.match(copyIcon, /^<svg viewBox="0 0 24 24"/);
  assert.match(css, /object-chrome-button\.object-toolbar-item\)\[data-pe-button\] > svg \{\s*width: 16px;\s*height: 16px;/);

  const timers = [], attributes = new Map(), button = {
      dataset:{}, isConnected:true, innerHTML:"", penechoSpec:{label:"Copy HTML"},
      setAttribute(name, value) { attributes.set(name, value); },
    },
    setState = vm.runInNewContext(`(${setStateSource})`, {
      WIDGET_COPY_ICON_FEEDBACK_MS:2000,
      OBJECT_CHROME_ICONS:{accept:"<svg><path></path></svg>",copy:"<svg><rect></rect></svg>"},
      clearTimeout() {},
      objectChromeLabel:() => "Copy HTML",
      setTimeout(callback, delay) { timers.push({callback,delay}); return timers.length; },
      t:() => "Widget source copied",
    });
  setState(button, true);
  assert.equal(button.innerHTML, "<svg><path></path></svg>");
  assert.equal(attributes.get("aria-label"), "Widget source copied");
  assert.equal(timers[0].delay, 2000);
  timers[0].callback();
  assert.equal(button.innerHTML, "<svg><rect></rect></svg>");
  assert.equal(attributes.get("aria-label"), "Copy HTML");
});

test("selected Widget chrome uses one top toolbar and follows Studio glass tokens", () => {
  const app = read("public/app.js"), css = read("public/style.css"),
    chromePosition = vm.runInNewContext(`(${functionSource(app, "objectChromePosition")})`, {
      state:{panX:0,panY:0,scale:1},
      view:{clientWidth:1200,clientHeight:800,getBoundingClientRect:()=>({left:0,top:0})},
      screenObjectBox:box=>({left:box.x,top:box.y,width:box.w,height:box.h}),
    }),
    box = {x:400,y:100,w:300,h:200},
    toolbar = chromePosition(box,"toolbar","widget:1:toolbar",{objectToolbar:true,minimumWidth:196,baseHeight:34}),
    toolbarPositions = new Map([["widget:1:toolbar",toolbar]]),
    cancel = chromePosition(box,"cancel","",{objectToolbarItem:true,objectToolbarKey:"widget:1:toolbar",toolbarSlot:"leading",baseWidth:28,baseHeight:28},toolbarPositions),
    accept = chromePosition(box,"accept","",{objectToolbarItem:true,objectToolbarKey:"widget:1:toolbar",toolbarSlot:"trailing",baseWidth:28,baseHeight:28},toolbarPositions),
    firstTool = chromePosition(box,"copy","",{objectToolbarItem:true,objectToolbarKey:"widget:1:toolbar",toolbarSlot:"tool",toolbarOrder:0,toolbarItemCount:4,baseWidth:28,baseHeight:28},toolbarPositions),
    selectedClasses = [],
    materialProperties = new Map(),
    materialClasses = new Set(),
    selectedWidgetMaterial = {
      hidden:true,
      classList:{
        toggle(name, enabled) { if (enabled) materialClasses.add(name); else materialClasses.delete(name); },
        remove(name) { materialClasses.delete(name); },
      },
    },
    materialWidgetStyle = {},
    syncSelectedWidgetMaterial = vm.runInNewContext(`(${functionSource(app, "syncSelectedWidgetMaterial")})`, {
      selectedWidgetMaterial,
      state:{panX:-6400,panY:-4200,scale:1,widgets:[{}],pendingWidget:null},
      screenObjectBox:() => ({left:100,top:350,width:300,height:200}),
      runtimeElementStyle:() => ({setProperty(name,value){materialProperties.set(name,value);}}),
      syncWidgetLayerOrder() {},
      syncCanvasObjectLayerOrder() {},
    }),
    sendWidgetHostState = vm.runInNewContext(`(${functionSource(app, "sendWidgetHostState")})`, {
      canvasWidgetInteractive:()=>false, canvasWidgetSelectionEnabled:()=>true,
      state:{mode:"select",scale:1,widgetEdit:{id:"widget-1"},selectedWidgetId:"widget-1",navigationLocked:false},
    });
  sendWidgetHostState({
    id:"widget-1", pending:false, w:300, h:200, contentW:300, contentH:200, hostReady:false,
    shell:{classList:{toggle(name,value){selectedClasses.push([name,value]);}}},
  });
  syncSelectedWidgetMaterial({
    spec:{box,object:{styleRule:{style:materialWidgetStyle}},handToolbar:true,handToolbarHiding:false},
    position:{x:100,y:316,baseWidth:300,baseHeight:34},
  });

  assert.deepEqual({x:toolbar.x,y:toolbar.y,baseWidth:toolbar.baseWidth},{x:400,y:66,baseWidth:300});
  assert.deepEqual({x:cancel.x,y:cancel.y},{x:404,y:69});
  assert.deepEqual({x:accept.x,y:accept.y},{x:668,y:69});
  assert.deepEqual({x:firstTool.x,y:firstTool.y},{x:540,y:69});
  assert.deepEqual({ ...chromePosition({x:-40,y:100,w:300,h:200},"toolbar","",{objectToolbar:true,minimumWidth:196,baseHeight:34}) },{x:-40,y:66,scale:1,baseWidth:300,baseHeight:34});
  assert.deepEqual({ ...chromePosition({x:1130,y:100,w:300,h:200},"toolbar","",{objectToolbar:true,minimumWidth:196,baseHeight:34}) },{x:1130,y:66,scale:1,baseWidth:300,baseHeight:34});
  assert.deepEqual({ ...chromePosition({x:400,y:100,w:180,h:200},"toolbar","",{objectToolbar:true,minimumWidth:196,baseHeight:34}) },{x:400,y:66,scale:1,baseWidth:196,baseHeight:34});
  assert.deepEqual(selectedClasses,[["is-interacting",false],["is-selected",true]]);
  assert.equal(selectedWidgetMaterial.hidden,false);
  assert.equal(materialProperties.get("--selected-widget-material-x"),"6500.0px");
  assert.equal(materialProperties.get("--selected-widget-material-y"),"4516.0px");
  assert.equal(materialProperties.get("--selected-widget-material-width"),"300.0px");
  assert.equal(materialProperties.get("--selected-widget-material-height"),"234.0px");
  assert.equal(materialProperties.get("z-index"),"2");
  assert.equal(materialWidgetStyle.zIndex,"2");
  assert.doesNotMatch(functionSource(app, "objectChromePosition"), /querySelectorAll|positions\.find|fallbackPosition/);
  assert.match(functionSource(app, "drawWidgetChrome"), /state\.paint\.accent \|\| "#4f46e5"/);
  assert.match(css, /\.widget-layer \{[^}]*overflow: visible;[^}]*--canvas-widget-pan-x/);
  assert.match(css, /\.selected-widget-material \{[^}]*outline: 0;[^}]*background: color-mix\(in srgb, var\(--panel-raised, #ffffff\) 80%, transparent\);[^}]*backdrop-filter: saturate\(1\.08\) blur\(30px\)[^}]*clip-path: polygon[^}]*drop-shadow\(0 4px 8px color-mix\(in srgb, var\(--studio-chrome-shadow-color/);
  assert.match(css, /\.object-toolbar-shell\) \{[^}]*border: 1px solid var\(--line\);[^}]*border-bottom: 0;/);
  assert.match(css, /body\[data-theme="studio"\] :is\(#pe-button-contract, \.object-toolbar-shell\) \{[^}]*border-color: var\(--studio-line\);/);
  assert.match(css, /object-toolbar-surface\.widget-object-toolbar\)[^{]*\{[^}]*border-color: var\(--line\);[^}]*border-bottom-color: transparent;[^}]*background: transparent;[^}]*box-shadow: none;[^}]*backdrop-filter: none/);
  assert.match(css, /body\[data-theme="studio"\][^{]*object-toolbar-surface\.widget-object-toolbar\)[^{]*\{[^}]*border-color: var\(--studio-line\);[^}]*border-bottom-color: transparent/);
  assert.match(css, /object-toolbar-surface\.widget-object-toolbar\):focus-visible \{[^}]*border-color: var\(--studio-accent, #4f46e5\);[^}]*border-bottom-color: transparent/);
  const selectedWidgetRule = css.match(/#viewport \.canvas-widget:is\(\.is-selected, \.object-toolbar-attached\), #viewport \.canvas-image-selection \{[^}]*\}/)?.[0] || "";
  assert.match(selectedWidgetRule, /border-radius: 0 0 7px 7px;[^}]*background: transparent;[^}]*box-shadow: none;[^}]*backdrop-filter: none/);
  assert.doesNotMatch(selectedWidgetRule, /blur\(/);
  assert.doesNotMatch(css, /#viewport \.canvas-widget\.is-selected::after[^\{]*\{[^}]*outline:/);
  assert.doesNotMatch(css.match(/#viewport \.canvas-image-selection::after \{[^}]*\}/)?.[0] || "", /backdrop-filter|filter:/);
  assert.match(css, /#viewport \.canvas-image-selection::after,[\s\S]*?#viewport \.canvas-widget\.object-toolbar-attached::after \{[^}]*opacity: 1;[^}]*border: 1px solid var\(--line\);[^}]*border-top-color: transparent/);
  assert.match(css, /#viewport \.canvas-widget\.object-toolbar-attached \.canvas-widget-frame \{ opacity: 1; mix-blend-mode: normal; \}/);
  assert.match(functionSource(app, "syncSelectedWidgetMaterial"), /selectedWidgetMaterial\.hidden = true[\s\S]*?syncCanvasObjectLayerOrder\(\)[\s\S]*?widgetStackIndex = state\.widgets\.length[\s\S]*?spec\.object\.styleRule\.style\.zIndex = String\(widgetStackIndex\)[\s\S]*?--selected-widget-material-x[\s\S]*?--selected-widget-material-height[\s\S]*?--selected-widget-body-width/);
});

test("downsampled animation drafts clip against logical rather than raster dimensions", () => {
  const app = read("public/app.js"),
    rects = [],
    context = {
      beginPath() {},
      clip() {},
      rect(...args) {
        rects.push(args);
      },
      restore() {},
      save() {},
    },
    draw = vm.runInNewContext(`(${functionSource(app, "drawPending")})`, {
      createAnimationPlayback: () => ({}),
      ctx: context,
      draftBounds: () => ({ x: 100, y: 200, w: 4000, h: 3000 }),
      drawPendingAnimation: () => {},
      drawPendingBatch: () => {},
      drawTextDraftSurface: () => {},
      pendingAnimationChromeVisible: () => false,
    });

  draw({
    image: { width: 1000, height: 750, logicalWidth: 4000, logicalHeight: 3000 },
    animationScene: { w: 4000, h: 3000 },
    animationPlayback: {},
    revealProgress: 1,
    scaleX: 1,
    scaleY: 1,
  });

  assert.deepEqual(rects, [
    [100, 200, 4000, 3000],
    [100, 200, 4000, 3000],
  ]);
});

test("object editing is routed only through Select while Hand and Pen retain their actions", () => {
  const app = read("public/app.js"), pointerDown = functionSource(app, "handleCanvasPointerDown"), select = functionSource(app, "beginCanvasObjectSelection");
  assert.match(pointerDown, /state\.mode === "select" && beginCanvasObjectSelection/);
  assert.match(pointerDown, /captureDrawingInput\(e\)[\s\S]*?beginCanvasPointerAction/);
  assert.match(select, /beginWidgetGesture[\s\S]*?beginImageGesture[\s\S]*?beginAnimationGesture/);
  assert.doesNotMatch(app, /beginAnimationTouchHold|animationTouchHold|ANIMATION_TOUCH_HOLD|beginImageTouchHold|imageTouchHold|IMAGE_TOUCH_HOLD/);
  assert.match(functionSource(app, "beginObjectChromeMove"), /state\.mode !== "select"/);
  assert.doesNotMatch(read("public/widget-host.js"), /penecho-widget-wheel|penecho-widget-pan-(?:start|move|end)/);
  assert.match(functionSource(app, "acceptAnimationEdit"), /selectedAnimationId = null[\s\S]*?requestInteractionLayerRender\(\)/);
});

test("Save canvas exposes non-blocking progress and completion feedback", () => {
  const html = read("public/index.html"), app = read("public/app.js"), css = read("public/style.css"), zh = read("public/locales/zh.js"),
    saveCurrent = functionSource(app, "saveCurrentCanvas"),
    saveCurrentItem = functionSource(app, "saveCurrentHistoryItem"),
    closeSavePanel = functionSource(app, "closeHistorySavePanel"),
    finalize = functionSource(app, "finalizeCanvasForSnapshot");
  assert.match(html, /id="historyNotice"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(app, /async function saveSnapshotFromHistory\(\)/);
  assert.match(app, /showHistoryNoticeKey\("snapshotSaving", "busy", 0\)/);
  assert.match(app, /selectionBusyKey = selectionAIStatusKey\(\)/);
  assert.match(app, /showHistoryNoticeKey\(id \? "snapshotSaved" : selectionBusy \? selectionBusyKey : "emptyCanvas"/);
  assert.match(app, /historySaveCurrent"\)\.onclick = \(\) => \{[\s\S]*?closeHistorySavePanel\(\)[\s\S]*?saveCurrentCanvas\(\)/);
  assert.match(app, /historySave\"\)\.onclick = \(\) => \{[\s\S]*?closeHistorySavePanel\(\)[\s\S]*?saveSnapshotFromHistory\(\)/);
  assert.match(app, /historyName"\)\.addEventListener\("keydown"[\s\S]*?event\.key === "Enter"[\s\S]*?closeHistorySavePanel\(\)[\s\S]*?saveCurrentCanvas\(\)/);
  assert.match(closeSavePanel, /panel\.open = false[\s\S]*?focusSummary/);
  assert.match(app, /historySavePanel\.addEventListener\("focusout"[\s\S]*?!historySavePanel\.contains\(document\.activeElement\)[\s\S]*?closeHistorySavePanel\(\)/);
  assert.match(app, /historySavePanel\.open[\s\S]*?!historySavePanel\.contains\(event\.target\)[\s\S]*?closeHistorySavePanel\(\)/);
  assert.match(app, /button\.disabled = busy/);
  assert.match(css, /\.history-notice\s*\{[^}]*pointer-events:\s*none/);
  assert.doesNotMatch(css, /#historySaveCurrent\.is-saving::before|#historySave\.is-saving::before/);
  assert.match(zh, /snapshotSaving:/);
  assert.match(html, /id="saveCanvasBtn"/);
  assert.match(html, /id="historySaveCurrent"[^>]*>Save<\/button>/);
  assert.match(html, /id="historySave"[^>]*>Save New<\/button>/);
  assert.match(saveCurrent, /location = state\.currentSnapshotLocation \|\| \(window\.PENECHO_CONFIG\?\.browserCanvasEditing \? "cloud" : state\.snapshotLocation\)/);
  assert.match(saveCurrent, /currentSnapshotLocation === location \? state\.currentSnapshotId : null/);
  assert.match(saveCurrent, /requestedName = document\.querySelector\("#historyName"\)/);
  assert.match(saveCurrent, /saveSnapshot\(\{ overwriteId, name, location \}\)/);
  assert.match(saveCurrentItem, /item\.id !== state\.currentSnapshotId[\s\S]*?location !== state\.currentSnapshotLocation/);
  assert.match(saveCurrentItem, /saveSnapshot\(\{ overwriteId:item\.id, name:currentCanvasDisplayName\(\) \|\| snapshotName\(item\), location \}\)/);
  assert.match(finalize, /state\.pendingWidget[\s\S]*?acceptPendingWidget\(\{ restoreMode:false \}\)/);
  assert.match(finalize, /state\.pending[\s\S]*?acceptPending\(\{ restoreMode:false \}\)/);
  assert.ok(finalize.indexOf("acceptPendingWidget") < finalize.indexOf("confirmTextEditor"));
  for (const edit of ["acceptWidgetEdit", "acceptImageEdit", "acceptAnimationEdit"]) assert.match(finalize, new RegExp(`\\b${edit}\\(\\)`));
  assert.match(finalize, /for \(const editor of \[\.\.\.state\.textEditors\.values\(\)\]\) await confirmTextEditor\(editor\)/);
  assert.match(finalize, /state\.selection[\s\S]*?commitSelection\(\)/);
  assert.match(finalize, /finishAIDraftHandMode\(\)/);
  assert.match(app, /async function saveSnapshot\(\{ overwriteId = null, name = null, location = state\.snapshotLocation, allowEmpty = false \} = \{\}\) \{[\s\S]*?selectionAIBusy\(\)[\s\S]*?await finalizeCanvasForSnapshot\(\)[\s\S]*?if \(!allowEmpty && !tiles\.size/);
  assert.match(app, /async function saveSnapshot\([\s\S]*?prepareVisibleWidgetSnapshots\(null, true\)/);
  assert.match(functionSource(app, "snapshotPreviewBlob"), /canvasBlob\(snapshotPreview\(\), "image\/webp", \.78\)[\s\S]*?fallback thumbnail[\s\S]*?data:image\/png;base64/);
  assert.match(app, /async function saveSnapshot\([\s\S]*?preview = location === "cloud" \? await cloudSnapshotPreviewBlob\(\) : await snapshotPreviewBlob\(\)/);
  assert.match(functionSource(app, "loadSnapshot"), /state\.currentSnapshotId = item\.id/);
  assert.match(functionSource(app, "loadSnapshot"), /state\.currentSnapshotLocation = location/);
  assert.match(app, /async function saveSnapshot\([\s\S]*?state\.currentSnapshotId = storedId/);
  assert.match(app, /querySelector\("#saveCanvasBtn"\)\.onclick = saveCurrentCanvas/);
});

test("canvas history clearly separates device, server, and private cross-device Cloud storage", () => {
  const html = read("public/index.html"), app = read("public/app.js"), css = read("public/style.css"), zh = read("public/locales/zh.js");
  const closeHistory = functionSource(app, "closeHistoryPanel"), openHistory = functionSource(app, "openHistoryPanel");
  assert.match(html, /id="historyPanel"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-hidden="true"[^>]*tabindex="-1"[^>]*\sinert/);
  assert.match(html, /id="historyPanel"[^>]*data-pe-surface="manager"[^>]*data-pe-size="xl"[^>]*data-pe-layout="nav-content"[^>]*data-pe-material="control-glass"/);
  assert.match(html, /class="history-titlebar penecho-workbench-header"[^>]*data-pe-region="header"[\s\S]*?class="penecho-workbench-icon"[^>]*>[\s\S]*?<svg[^>]*viewBox="0 0 24 24"/);
  assert.match(html, /class="history-library-sidebar penecho-workbench-navigation"/);
  assert.match(html, /id="historySearch"[^>]*type="search"/);
  assert.match(html, /id="historySearch"[^>]*placeholder="Search"[^>]*data-i18n-aria="historySearchLabel"[^>]*aria-label="Search Canvas Library"/);
  assert.match(openHistory, /requestAnimationFrame\([\s\S]*panel\.focus\(\{ preventScroll:true \}\)[\s\S]*requestAnimationFrame\([\s\S]*renderSnapshotList\(\)/);
  assert.doesNotMatch(openHistory, /historySearch[^\n]*focus/);
  assert.match(html, /class="history-library-browser"[\s\S]*?class="history-library-sidebar penecho-workbench-navigation"[\s\S]*?<section class="history-library-main"/);
  assert.match(html, /id="historyProjectNav"[^>]*class="history-project-nav"/);
  assert.match(html, /id="historySort"[\s\S]*?value="modified"[\s\S]*?value="name"[\s\S]*?value="created"/);
  assert.match(html, /id="historyViewList"[^>]*data-history-view="list"[\s\S]*?id="historyViewGrid"[^>]*data-history-view="grid"/);
  assert.match(html, /class="history-toolbar"[\s\S]*?id="historyNewCanvas"[^>]*class="history-toolbar-action history-toolbar-new"/);
  assert.match(html, /id="historyNewCanvas"[^>]*data-i18n-aria="historyNewCanvas"[^>]*aria-label="New Canvas"/);
  assert.match(html, /id="historyProjectSelect"[^>]*data-i18n-aria="canvasProject"[^>]*aria-label="Project"/);
  assert.match(html, /id="historyProjectDelete"[^>]*data-i18n-aria="canvasProjectDelete"[^>]*aria-label="Delete project"/);
  assert.match(html, /class="history-content-heading">\s*<h3 id="historySectionTitle"[\s\S]*?<div class="history-content-meta">\s*<p id="historySectionSummary"><\/p>\s*<p id="historyStorageDescription" class="history-content-guidance"><\/p>/);
  assert.match(html, /id="historyStorageDescription"[^>]*class="history-content-guidance"/);
  assert.match(html, /class="history-toolbar"[\s\S]*?id="historySavePanel"[^>]*class="history-toolbar-save"/);
  assert.doesNotMatch(html, /class="history-footer"|id="historySelectionName"|id="historyCancel"|id="historyOpenCanvas"|id="historyGridActions"|id="historyGridSelectionName"|id="historyGridLoad"/);
  assert.match(html, /id="historyDeleteDialog"[^>]*class="studio-session-delete-dialog history-delete-dialog"[^>]*role="alertdialog"[^>]*aria-modal="true"[^>]*data-pe-surface="alert"[^>]*data-pe-size="xs"[^>]*data-pe-layout="single"[^>]*data-pe-presentation="modal"[^>]*data-pe-material="opaque"/);
  assert.doesNotMatch(html, /id="historyPanel"[\s\S]*?<span class="history-kicker">PenEcho<\/span>[\s\S]*?<div class="history-composer">/);
  assert.doesNotMatch(html, /data-i18n="historyDescription"/);
  assert.doesNotMatch(app, /historyDescription:/);
  assert.doesNotMatch(zh, /historyDescription:/);
  assert.match(css, /\.history-panel, \.new-canvas-dialog\s*\{[^}]*color-scheme:\s*light[^}]*--ai-bg:\s*var\(--studio-shell, #f2f3f5\)[^}]*--ai-surface:\s*var\(--studio-panel, #ffffff\)[^}]*--ai-accent:\s*var\(--studio-accent, #4f46e5\)/);
  assert.doesNotMatch(css, /body\[data-theme="(?:studio|research|arcane|scifi)"\] \.history-panel/);
  assert.ok(css.includes("width: min(1080px, calc(100vw - 56px));"));
  assert.ok(css.includes("height: min(720px, calc(100dvh - 56px));"));
  assert.match(css, /\.penecho-workbench-dialog\s*\{[^}]*--penecho-workbench-header-h:\s*68px[^}]*--penecho-workbench-navigation-w:\s*184px[^}]*--penecho-workbench-menu-item-h:\s*30px/);
  assert.match(css, /#historyPanel\s*\{[^}]*--penecho-workbench-title-surface:\s*var\(--penecho-workbench-navigation-surface\)[^}]*--penecho-workbench-title-filter:\s*var\(--penecho-workbench-navigation-filter\)/);
  assert.match(css, /\.history-library-sidebar\s*\{[^}]*--pe-menu-item-h:\s*var\(--penecho-workbench-menu-item-h, 30px\)[^}]*border-right:\s*1px solid var\(--ai-line\)/);
  assert.match(css, /\.history-library-main\s*\{[^}]*grid-template-rows:\s*50px 74px 30px minmax\(0, 1fr\)/);
  assert.match(css, /\.history-panel\.open\s*\{[^}]*opacity:\s*1[^}]*translate\(-50%, -50%\) scale\(1\)[^}]*visibility:\s*visible/);
  assert.match(css, /html\.penecho-web-page-scale \.history-panel\s*\{[^}]*min-height:\s*0/);
  assert.match(css, /\.history-panel\[data-pe-surface="manager"\] \.history-library-main\s*\{[^}]*grid-template-rows:\s*42px 48px minmax\(0, 1fr\)/);
  assert.match(css, /\.history-panel\[data-pe-surface="manager"\] \.history-content-heading\s*\{[^}]*display:\s*grid[^}]*min-height:\s*48px[^}]*align-items:\s*center[^}]*padding:\s*6px 16px/);
  assert.match(css, /\.history-panel\[data-pe-surface="manager"\] \.history-content-meta\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*flex-end/);
  assert.ok(css.includes(".history-list { min-width: 0; min-height: 0; margin: 0; padding: 0 8px 8px; overflow: hidden auto; border: 0; border-radius: 0;"));
  assert.match(css, /\.history-card\.selected\s*\{[^}]*border-color:[^}]*var\(--ai-accent\)[^}]*background:/);
  assert.match(css, /\.history-card \.history-card-select\s*\{[^}]*grid-template-columns:\s*minmax\(240px, 1fr\) 150px 136px/);
  assert.match(openHistory, /panel\.inert = false/);
  assert.match(closeHistory, /panel\.contains\(document\.activeElement\)[\s\S]*?button\.focus\(\{ preventScroll:true \}\)[\s\S]*?panel\.inert = true[\s\S]*?aria-hidden", "true"/);
  for (const name of ["historyStorageLocation", "newCanvasStorageLocation"]) {
    assert.match(html, new RegExp(`name="${name}" value="device"`));
    assert.match(html, new RegExp(`name="${name}" value="server"`));
    assert.match(html, new RegExp(`name="${name}" value="cloud"`));
  }
  for (const key of ["saveLocation", "storageThisDevice", "storagePenEchoServer", "storagePenEchoCloud", "storageThisDeviceDescription", "storagePenEchoServerDescription", "storagePenEchoCloudDescription", "historyLibraryNavigation", "historyCanvasList", "historyLocations", "historyProjects", "historyAllCanvases", "historyCanvasCount", "historySortModified", "historyViewList", "historyViewGrid", "historyNewCanvas", "historyColumnCanvas", "historyColumnContents", "historyColumnModified", "cloudCanvasConflict"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
  assert.match(app, /localStorage\.setItem\("penecho-snapshot-location", location\)/);
  assert.match(app, /currentSnapshotLocation:\s*null/);
  assert.match(app, /state\.currentSnapshotLocation !== state\.snapshotLocation/);
  const serverPayload = functionSource(app, "serverSnapshotPayload"), readServer = functionSource(app, "readServerSnapshot"), readBundle = functionSource(app, "readSnapshotBundle");
  assert.match(serverPayload, /snapshotBundleAsset\("preview"[\s\S]*?snapshotBundleAsset\("tile"[\s\S]*?snapshotBundleAsset\("resource"[\s\S]*?snapshotBundleAsset\("widget"[\s\S]*?version:2[\s\S]*?bundleVersion:2[\s\S]*?mode:"snapshot"[\s\S]*?format:"penecho-raster-tiles"[\s\S]*?canvasSize:[\s\S]*?tileSize:TILE[\s\S]*?assets:\[\.\.\.snapshotPreservedAssets\(item\.preservedAssets\), \.\.\.tileAssets, \.\.\.widgetAssets, \.\.\.imageAssets, previewAsset\]/);
  assert.match(serverPayload, /extensions:snapshotExtensionObject\(item\.bundleExtensions\)[\s\S]*?extensions:snapshotExtensionObject\(item\.manifestExtensions\)/);
  assert.match(readServer, /stored\.version \?\? stored\.bundleVersion \?\? 1[\s\S]*?readSnapshotBundle\(stored\)/);
  assert.match(readBundle, /stored\.manifest\?\.format !== "penecho-raster-tiles"[\s\S]*?snapshotBundleAssetBlob\(previewAsset\)[\s\S]*?widgets,[\s\S]*?images:\[\.\.\.imageById\.values\(\)\]/);
  assert.match(readBundle, /bundleExtensions:snapshotExtensionObject\(stored\.extensions\)[\s\S]*?manifestExtensions:snapshotExtensionObject\(stored\.manifest\.extensions\)/);
  const enableSnapshotPlugins = functionSource(app, "enableSnapshotWidgetPlugins"),
    loadSnapshot = functionSource(app, "loadSnapshot");
  assert.match(enableSnapshotPlugins, /new Set[\s\S]*?item\?\.pluginId[\s\S]*?state\.plugins\[pluginId\] = true/);
  assert.match(enableSnapshotPlugins, /widgetType === "diagram_source"[\s\S]*?ensurePluginRuntime\("flowchart"\)/);
  assert.match(enableSnapshotPlugins, /persistPluginSettings\(\)[\s\S]*?syncWidgetRuntime\(\)[\s\S]*?updatePluginControl\(\)/);
  assert.ok(loadSnapshot.indexOf("await enableSnapshotWidgetPlugins(item.widgets)") < loadSnapshot.indexOf("restoreWidgets(item.widgets)"));
  assert.match(functionSource(app, "serverSnapshotItems"), /fetch\("\/api\/canvases\?metadataOnly=1"/);
  assert.match(functionSource(app, "serverSnapshotItems"), /fetch\("\/api\/canvas-projects"/);
  assert.match(functionSource(app, "saveServerSnapshot"), /method:overwriteId \? "PUT" : "POST"/);
  assert.match(functionSource(app, "deleteServerSnapshot"), /method:"DELETE"/);
  assert.match(functionSource(app, "renameSnapshot"), /method:"PATCH"[\s\S]*?canvasAgentCanvasDidPersist\(location, id\)[\s\S]*?refreshSnapshots\(\)/);
  assert.match(functionSource(app, "beginSnapshotRename"), /history-rename-form[\s\S]*?canvasNameRequired[\s\S]*?renameSnapshot\(item\.id, location, name\)/);
  assert.match(functionSource(app, "renderSnapshotList"), /history-title-row[\s\S]*?history-rename[\s\S]*?beginSnapshotRename/);
  assert.match(functionSource(app, "renderServerProjectUi"), /historyProjectNav[\s\S]*?history-project-nav-item[\s\S]*?aria-current[\s\S]*?rememberSelectedCloudProject[\s\S]*?rememberSelectedServerProject/);
  assert.match(functionSource(app, "renderServerProjectUi"), /projectProtected[\s\S]*?dataset\.projectProtected[\s\S]*?remove\.disabled = historyBusy\(\)/);
  assert.match(functionSource(app, "updateHistoryReadControls"), /historyProjectDelete[\s\S]*?dataset\.projectProtected === "true"/);
  assert.match(functionSource(app, "historySortItems"), /historySort[\s\S]*?localeCompare[\s\S]*?createdAt[\s\S]*?updatedAt/);
  assert.match(functionSource(app, "updateHistoryLibrarySummary"), /historySectionTitle[\s\S]*?historyWindowSummary[\s\S]*?historyCanvasCount[\s\S]*?history-location-count/);
  assert.match(functionSource(app, "updateHistoryLibrarySummary"), /snapshotItemsLocation === location[\s\S]*?snapshotLocationCountCache\.set\(location, scopedCount\)[\s\S]*?snapshotLocationCountCache\.get\(node\.dataset\.location\)/);
  assert.match(functionSource(app, "setHistoryView"), /historyColumnHeader[\s\S]*?history-library-main[\s\S]*?classList\.toggle\("grid-view", grid\)[\s\S]*?dataset\.peList = grid \? "grid" : "media-list"[\s\S]*?header\.hidden = grid[\s\S]*?aria-pressed[\s\S]*?HISTORY_VIEW_STORAGE_KEY/);
  const renderSnapshotList = functionSource(app, "renderSnapshotList");
  const releaseHistoryPreviewUrls = functionSource(app, "releaseHistoryPreviewUrls"),
    revokeHistoryPreviewUrlWhenSettled = functionSource(app, "revokeHistoryPreviewUrlWhenSettled");
  assert.match(releaseHistoryPreviewUrls, /entries = \[\.\.\.historyPreviewUrls\][\s\S]*?historyPreviewUrls\.clear\(\)[\s\S]*?queueMicrotask[\s\S]*?revokeHistoryPreviewUrlWhenSettled\(url, image\)/);
  assert.match(revokeHistoryPreviewUrlWhenSettled, /image\.complete[\s\S]*?addEventListener\("load", revoke\)[\s\S]*?addEventListener\("error", revoke\)/);
  assert.match(renderSnapshotList, /releaseHistoryPreviewUrls\(\)[\s\S]*?historyPreviewUrls\.set\(url, image\)[\s\S]*?image\.onerror/);
  assert.doesNotMatch(renderSnapshotList, /image\.onload\s*=/);
  assert.match(renderSnapshotList, /dataset\.peItem = "card-action"[\s\S]*?history-card-select history-preview[\s\S]*?dataset\.peRegion = "media"[\s\S]*?dataset\.peMedia = "prompt-preview"[\s\S]*?dataset\.peMedia = "prompt-icon"/);
  assert.match(renderSnapshotList, /history-card-content[\s\S]*?dataset\.peRegion = "content"[\s\S]*?dataset\.peRegion = "copy"[\s\S]*?dataset\.peRegion = "title"[\s\S]*?title\.title = title\.textContent[\s\S]*?history-card-description[\s\S]*?dataset\.peRegion = "description"/);
  assert.match(renderSnapshotList, /history-grid-date[\s\S]*?description\.append\(gridDate, stats\)/);
  assert.doesNotMatch(renderSnapshotList, /history-detail|description\.append\(detail/);
  const historyItemContentSummary = functionSource(app, "historyItemContentSummary");
  assert.match(historyItemContentSummary, /historySnapshotTile[\s\S]*?historySnapshotTiles[\s\S]*?historySnapshotWidget[\s\S]*?historySnapshotWidgets/);
  assert.match(historyItemContentSummary, /item\.tileCount === 1[\s\S]*?item\.widgetCount === 1/);
  assert.doesNotMatch(historyItemContentSummary, /snapshotAnimations|snapshotImages/);
  assert.match(renderSnapshotList, /history-current-label[\s\S]*?studioNavigatorCurrent/);
  assert.match(renderSnapshotList, /isCurrent \? "history-item-save history-save-current" : "history-item-load history-load"[\s\S]*?saveCurrentHistoryItem[\s\S]*?loadHistorySnapshot[\s\S]*?footer\.append\(modifiedColumn, load, more\)[\s\S]*?content\.append\(meta, footer\)[\s\S]*?card\.append\(selectButton, content, advancedActions\)/);
  assert.match(css, /\.history-panel\[data-pe-surface="manager"\] \.history-list:not\(\.grid-view\)\s*\{[^}]*grid-auto-rows:\s*max-content[^}]*align-content:\s*start/);
  assert.match(css, /\.history-panel\[data-pe-surface="manager"\]\s*\{[^}]*width:\s*min\(900px,[^}]*background:\s*var\(--penecho-large-dialog-surface\)[^}]*box-shadow:\s*var\(--penecho-large-dialog-shadow\)[^}]*backdrop-filter:\s*var\(--penecho-large-dialog-surface-filter\)[^}]*container:\s*history-library \/ inline-size/);
  assert.match(css, /\.history-panel\[data-pe-surface="manager"\] \.history-library-sidebar\s*\{[^}]*padding:\s*13px 11px[^}]*background:\s*var\(--penecho-workbench-navigation-surface\)[^}]*backdrop-filter:\s*var\(--penecho-workbench-navigation-filter\)/);
  assert.doesNotMatch(css, /\.history-panel\[data-pe-surface="manager"\] \.history-library-sidebar\s*\{[^}]*--pe-font-ui:/);
  assert.match(css, /\.history-panel\[data-pe-surface="manager"\] \.history-library-sidebar\s*\{[^}]*font-family:\s*var\(--pe-font-ui\)/);
  assert.match(css, /\.history-panel\[data-pe-surface="manager"\] \.snapshot-location\.history-sidebar-section legend,[\s\S]*?\.history-sidebar-heading\s*\{[^}]*font:\s*600 11px\/24px var\(--pe-font-ui\)[^}]*letter-spacing:\s*\.04em[^}]*text-transform:\s*uppercase/);
  assert.match(css, /:is\(#pe-button-contract, body\[data-theme="studio"\]\)[\s\S]*?\.history-panel\[data-pe-surface="manager"\][\s\S]*?\.history-project-nav-item\[data-pe-button="menu-item"\][\s\S]*?grid-template-columns:\s*15px minmax\(0, 1fr\) auto[^}]*gap:\s*8px[^}]*color:\s*var\(--pe-ink\)[^}]*font:\s*500 12\.5px\/var\(--pe-menu-item-h, 30px\) var\(--pe-font-ui\)/);
  assert.match(css, /:is\(#pe-button-contract, body\[data-theme="studio"\]\)[\s\S]*?:is\(\.history-location-count, \.history-project-nav-item > small\)\s*\{[^}]*min-width:\s*20px[^}]*height:\s*20px[^}]*border-radius:\s*999px[^}]*background:\s*var\(--pe-surface-raised\)[^}]*font:\s*600 10\.5px\/1 var\(--pe-font-ui\)/);
  assert.match(css, /:is\(#pe-button-contract, body\[data-theme="studio"\]\)[\s\S]*?:is\(\.history-location-count, \.history-project-nav-item > small\)\[hidden\]\s*\{[^}]*display:\s*none/);
  assert.match(css, /\.history-panel\[data-pe-surface="manager"\] \.history-library-main\s*\{[^}]*background:\s*var\(--penecho-workbench-content-surface\)/);
  assert.match(css, /\.history-panel\[data-pe-surface="manager"\] \.history-library-browser\s*\{[^}]*grid-template-columns:\s*var\(--penecho-workbench-navigation-w\) minmax\(0, 1fr\)/);
  assert.match(css, /History Grid follows the catalog card-action skeleton[\s\S]*?\.history-panel\[data-pe-surface="manager"\] \.history-list\.grid-view\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)[^}]*gap:\s*var\(--pe-s6, 12px\)/);
  assert.match(css, /\.history-panel\[data-pe-surface="manager"\] \.history-list\.grid-view \.history-card\s*\{[^}]*grid-template-rows:\s*auto auto[^}]*gap:\s*var\(--pe-s4, 8px\)[^}]*padding:\s*8px[^}]*border-radius:\s*var\(--pe-r-group, 10px\)/);
  assert.match(css, /\.history-panel\[data-pe-surface="manager"\] \.history-list\.grid-view \.history-card\.selected\s*\{[^}]*border-color:\s*color-mix\(in srgb, var\(--pe-accent\) 42%, var\(--pe-line\)\)[^}]*0 6px 14px color-mix\(in srgb, var\(--pe-accent\) 18%, transparent\)/);
  assert.match(css, /\.history-panel\[data-pe-surface="manager"\] \.history-list\.grid-view \.history-meta \.history-card-title\s*\{[^}]*font:\s*500 13px\/1\.3 var\(--pe-font-ui\)[^}]*text-overflow:\s*clip[^}]*white-space:\s*nowrap[^}]*-webkit-mask-image:\s*linear-gradient\(to right, #000 0, #000 calc\(100% - 24px\), transparent 100%\)[^}]*mask-image:\s*linear-gradient\(to right, #000 0, #000 calc\(100% - 24px\), transparent 100%\)/);
  assert.match(css, /@media \(forced-colors: active\)[\s\S]*?\.history-panel\[data-pe-surface="manager"\] \.history-list\.grid-view \.history-meta \.history-card-title\s*\{[^}]*text-overflow:\s*ellipsis[^}]*-webkit-mask-image:\s*none[^}]*mask-image:\s*none/);
  assert.match(css, /\.history-panel\[data-pe-surface="manager"\] \.history-list\.grid-view \.history-card-description\s*\{[^}]*display:\s*flex[^}]*min-height:\s*16px[^}]*font:\s*400 12px\/1\.4 var\(--pe-font-ui\)[^}]*white-space:\s*nowrap/);
  assert.match(css, /\.history-panel\[data-pe-surface="manager"\] \.history-list\.grid-view \.history-grid-date::after\s*\{[^}]*content:\s*"·"/);
  assert.match(css, /\.history-panel\[data-pe-surface="manager"\] \.history-list\.grid-view \.history-card-description \.history-stats\s*\{[^}]*display:\s*flex[^}]*min-width:\s*0[^}]*overflow:\s*hidden/);
  assert.match(css, /:is\(#pe-type-contract, body\[data-theme="studio"\]\)\s*\.history-panel\[data-pe-surface="manager"\]\s*\.history-list\.grid-view\s*\.history-meta\s*\.history-card-title\s*\{[^}]*font-size:\s*13px[^}]*font-weight:\s*500/);
  assert.match(css, /:is\(#pe-type-contract, body\[data-theme="studio"\]\)\s*\.history-panel\[data-pe-surface="manager"\]\s*\.history-list\.grid-view\s*\.history-card-description\s*\{[^}]*font-size:\s*12px[^}]*font-weight:\s*400/);
  assert.match(css, /\.history-panel\[data-pe-surface="manager"\] \.history-list\.grid-view \.history-card \.history-card-select\s*\{[^}]*display:\s*block[^}]*aspect-ratio:\s*16 \/ 10[^}]*overflow:\s*hidden[^}]*border:\s*1px solid var\(--pe-line\)[^}]*border-radius:\s*6px[^}]*background:\s*var\(--pe-surface-muted\)/);
  assert.match(css, /visible preview frame[\s\S]*?:is\(#pe-button-contract, body\[data-theme="studio"\]\)[\s\S]*?\.history-card-select\[data-pe-hit="choice"\]\s*\{[^}]*border:\s*1px solid var\(--pe-line\)[^}]*outline:\s*0[^}]*background:\s*var\(--pe-surface-muted\)[^}]*box-shadow:\s*none/);
  assert.match(css, /\.history-panel\[data-pe-surface="manager"\] \.history-list\.grid-view \.history-card-select > :where\(\[data-pe-media="prompt-preview"\], \[data-pe-media="prompt-icon"\]\)\s*\{[^}]*position:\s*static[^}]*width:\s*100%[^}]*height:\s*100%[^}]*border-radius:\s*inherit/);
  assert.match(css, /\.history-panel\[data-pe-surface="manager"\] \.history-list\.grid-view \.history-card-select > img\[data-pe-media="prompt-preview"\]\s*\{[^}]*background:\s*var\(--pe-surface\)[^}]*object-fit:\s*contain/);
  assert.match(css, /\.history-panel\[data-pe-surface="manager"\] \.history-list\.grid-view \.history-card:has\(\.history-card-select:focus-visible\)\s*\{[^}]*border-color:\s*color-mix\(in srgb, var\(--pe-accent\) 42%, var\(--pe-line\)\)[^}]*box-shadow:\s*0 0 0 1px/);
  assert.match(css, /:is\(#pe-button-contract, body\[data-theme="studio"\]\)[\s\S]*?\.history-panel\[data-pe-surface="manager"\][\s\S]*?\.history-more\s*\{[^}]*inline-size:\s*22px[^}]*block-size:\s*22px[^}]*width:\s*22px[^}]*height:\s*22px[^}]*flex:\s*0 0 22px[^}]*margin:\s*0[^}]*padding:\s*0/);
  assert.match(css, /:is\(#pe-button-contract, body\[data-theme="studio"\]\)[\s\S]*?\.history-panel\[data-pe-surface="manager"\][\s\S]*?\.history-more::before\s*\{[^}]*content:\s*none/);
  assert.match(css, /:is\(#pe-button-contract, body\[data-theme="studio"\]\)[\s\S]*?\.history-panel\[data-pe-surface="manager"\][\s\S]*?\.history-more > svg\s*\{[^}]*width:\s*14px[^}]*height:\s*14px[^}]*fill:\s*currentColor[^}]*stroke:\s*none/);
  assert.match(css, /Catalog History Manager keeps Save and Load progress textual[\s\S]*?\.history-panel\[data-pe-surface="manager"\][\s\S]*?:is\(#historySaveCurrent, #historySave, \.history-save-current, \.history-load\)\[aria-busy="true"\]::before\s*\{[^}]*display:\s*none[^}]*content:\s*none[^}]*animation:\s*none/);
  assert.match(css, /\.history-panel\[data-pe-surface="manager"\] \.history-list\.grid-view \.history-card-footer\s*\{[^}]*display:\s*contents/);
  assert.match(css, /\.history-panel\[data-pe-surface="manager"\] \.history-list\.grid-view \.history-card-content\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 22px[^}]*grid-template-rows:\s*auto auto auto[^}]*column-gap:\s*4px/);
  assert.match(css, /\.history-panel\[data-pe-surface="manager"\] \.history-list\.grid-view \.history-meta\s*\{[^}]*display:\s*contents/);
  assert.match(css, /\.history-panel\[data-pe-surface="manager"\] \.history-list\.grid-view \.history-card-description\s*\{[^}]*grid-column:\s*1 \/ -1[^}]*grid-row:\s*2/);
  assert.match(css, /:is\(#pe-button-contract, body\[data-theme="studio"\]\)[\s\S]*?\.history-list\.grid-view[\s\S]*?:is\(\.history-item-load, \.history-item-save\)\s*\{[^}]*width:\s*100%[^}]*grid-column:\s*1 \/ -1[^}]*grid-row:\s*3/);
  assert.match(css, /:is\(#pe-button-contract, body\[data-theme="studio"\]\)[\s\S]*?\.history-list\.grid-view[\s\S]*?\.history-more\s*\{[^}]*position:\s*relative[^}]*grid-column:\s*2[^}]*grid-row:\s*1[^}]*margin:\s*0[^}]*background:\s*transparent/);
  assert.match(css, /The shared card DOM also follows the catalog media-list skeleton[\s\S]*?\.history-panel\[data-pe-surface="manager"\] \.history-list:not\(\.grid-view\) \.history-card\s*\{[^}]*min-height:\s*80px[^}]*grid-template-columns:\s*96px minmax\(0, 1fr\)[^}]*gap:\s*var\(--pe-s5, 10px\)/);
  assert.match(css, /\.history-panel\[data-pe-surface="manager"\] \.history-list:not\(\.grid-view\)\s*\{[^}]*gap:\s*0[^}]*padding:\s*0[^}]*border:\s*0[^}]*border-radius:\s*0/);
  assert.match(css, /\.history-panel\[data-pe-surface="manager"\] \.history-list:not\(\.grid-view\) \.history-card\s*\{[^}]*border:\s*0[^}]*border-bottom:\s*1px solid var\(--pe-line\)[^}]*border-radius:\s*0/);
  assert.match(css, /\.history-panel\[data-pe-surface="manager"\] \.history-list:not\(\.grid-view\) \.history-card \.history-card-select\s*\{[^}]*display:\s*block[^}]*width:\s*96px[^}]*height:\s*64px/);
  assert.match(css, /\.history-panel\[data-pe-surface="manager"\] \.history-list:not\(\.grid-view\) \.history-modified\s*\{\s*display:\s*none/);
  assert.match(css, /@container history-library \(max-width: 480px\)[\s\S]*?\.history-list:not\(\.grid-view\) \.history-card\s*\{[^}]*grid-template-columns:\s*80px minmax\(0, 1fr\)[^}]*\}[\s\S]*?\.history-card-select\s*\{[^}]*width:\s*80px[^}]*height:\s*56px/);
  assert.match(css, /@media \(max-width: 920px\)[\s\S]*?\.history-panel\[data-pe-surface="manager"\] \.history-list\.grid-view\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@container history-library \(max-width: 700px\)[\s\S]*?\.history-library-browser\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.match(css, /\.history-current-label\s*\{[^}]*position:\s*absolute[^}]*background:/);
  assert.match(css, /\.history-list\.grid-view \.history-item-save\s*\{[^}]*top:\s*auto[^}]*right:\s*10px[^}]*bottom:\s*10px[^}]*height:\s*26px[^}]*padding:\s*0 8px[^}]*font-size:\s*12px/);
  const updateHistorySelectionUi = functionSource(app, "updateHistorySelectionUi");
  assert.match(updateHistorySelectionUi, /history-card[\s\S]*?classList\.toggle\("selected", selected\)[\s\S]*?dataset\.peState = selected \? "selected" : "default"[\s\S]*?aria-pressed/);
  assert.doesNotMatch(updateHistorySelectionUi, /historyGridActions|historyGridSelectionName|historyGridLoad|grid-selection-active/);
  assert.match(app, /function selectHistorySnapshot[\s\S]*?grid-view[\s\S]*?historyGridSelectionActivated = true/);
  assert.match(functionSource(app, "setHistoryView"), /historyGridSelectionActivated = false[\s\S]*?updateHistorySelectionUi\(\)/);
  assert.match(functionSource(app, "closeHistoryRowActions"), /history-row-actions:not\(\[hidden\]\)[\s\S]*?aria-expanded", "false"/);
  assert.match(functionSource(app, "positionHistoryRowActions"), /getBoundingClientRect\(\)[\s\S]*?menuHeight = row\.offsetHeight[\s\S]*?spaceAbove[\s\S]*?spaceBelow[\s\S]*?dataset\.pePlacement/);
  assert.match(renderSnapshotList, /className = "history-row-actions pe-compact-menu"[\s\S]*?dataset\.peSurface = "menu"[\s\S]*?dataset\.peSize = "xs"[\s\S]*?dataset\.peList = "menu"[\s\S]*?dataset\.pePresentation = "anchored"/);
  assert.match(renderSnapshotList, /aria-controls[\s\S]*?aria-labelledby[\s\S]*?className = "menu-separator"[\s\S]*?role", "separator"/);
  assert.match(renderSnapshotList, /more\.addEventListener\("keydown"[\s\S]*?Escape[\s\S]*?stopPropagation\(\)[\s\S]*?advancedActions\.hidden = true/);
  assert.match(renderSnapshotList, /advancedActions\.addEventListener\("keydown"[\s\S]*?Escape[\s\S]*?stopPropagation\(\)[\s\S]*?more\.focus/);
  assert.match(css, /\.history-panel\[data-pe-surface="manager"\] \.history-row-actions\s*\{[^}]*display:\s*grid[^}]*width:\s*min\(200px, calc\(100% - 16px\)\)[^}]*gap:\s*0[^}]*padding:\s*4px/);
  assert.match(css, /\.history-panel\[data-pe-surface="manager"\] \.history-row-actions\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(css, /\.history-list:not\(\.grid-view\) \.history-row-actions\[data-pe-placement="bottom"\]\s*\{[^}]*top:\s*calc\(50% \+ 17px\)[^}]*bottom:\s*auto/);
  assert.match(css, /\.history-list:not\(\.grid-view\) \.history-row-actions\[data-pe-placement="top"\]\s*\{[^}]*top:\s*auto[^}]*bottom:\s*calc\(50% \+ 27px\)/);
  assert.match(app, /querySelector\("#historyPanel"\)\.addEventListener\("pointerdown"[\s\S]*?closest\("\.history-more, \.history-row-actions"\)[\s\S]*?closeHistoryRowActions\(\)/);
  assert.match(functionSource(app, "ensureHistorySelection"), /state\.currentSnapshotId[\s\S]*?items\[0\]/);
  assert.match(functionSource(app, "loadHistorySnapshot"), /button\.disabled[\s\S]*?requestLoadSnapshot\(item\.id, location\)/);
  assert.match(app, /querySelector\("#historyNewCanvas"\)\.onclick[\s\S]*?closeHistoryPanel\(\)[\s\S]*?querySelector\("#newCanvasBtn"\)\?\.click\(\)/);
  assert.match(functionSource(app, "cloudSnapshotItems"), /\/api\/cloud\/library[\s\S]*?bundleVersion !== 2[\s\S]*?conflictPolicy !== "base-revision-required"/);
  assert.match(functionSource(app, "cacheCloudHistory"), /items\.slice\(\)[\s\S]*?cloudCanvasProjects\.slice\(\)/);
  assert.match(functionSource(app, "restoreCloudHistoryCache"), /snapshotItems = cloudHistoryCache\.items\.slice\(\)[\s\S]*?cloudCanvasProjects = cloudHistoryCache\.projects\.slice\(\)[\s\S]*?snapshotItemsLocation = "cloud"/);
  assert.match(functionSource(app, "saveCloudSnapshot"), /baseRevisionId[\s\S]*?\/api\/cloud\/canvases\/[\s\S]*?status === 409[\s\S]*?cloudCanvasConflict[\s\S]*?\/api\/cloud\/projects\//);
  assert.match(functionSource(app, "readCloudSnapshot"), /\/api\/cloud\/canvases\/[\s\S]*?body\?\.revision\?\.id[\s\S]*?readSnapshotBundle/);
  assert.match(functionSource(app, "openCloudProjectHistory"), /setSnapshotLocation\("cloud", \{ refresh:false \}\)[\s\S]*?refreshSnapshots\(\)[\s\S]*?openHistoryPanel\(false\)/);
  assert.match(functionSource(app, "openHistoryPanel"), /if \(refresh\) refreshSnapshots\(\)/);
  for (const key of ["snapshotLibraryLoading", "snapshotLibraryLoadingDetail", "snapshotCloudCacheRefreshing", "snapshotCloudCacheLoadFailed", "snapshotLoading", "snapshotLoadDownloading", "snapshotLoadDecoding", "snapshotLoadApplying"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
  for (const id of ["historyActivity", "historyActivityTitle", "historyActivityDetail", "historyActivityProgress"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(app, /function setSnapshotLocation\([\s\S]*?snapshotItems = \[\][\s\S]*?snapshotItemsLocation = null[\s\S]*?renderSnapshotListLoading\(location\)/);
  assert.match(app, /function setSnapshotLocation\([\s\S]*?restoreCloudHistoryCache\(\)[\s\S]*?renderSnapshotList\(\)/);
  assert.match(app, /function setSnapshotLocation\([\s\S]*?snapshotLoadInProgress[\s\S]*?state\.snapshotLoadGeneration\+\+[\s\S]*?snapshotLoadInProgress = false/);
  assert.match(functionSource(app, "updateHistoryReadControls"), /input\[name="historyStorageLocation"\][\s\S]*?control\.disabled = snapshotSaveInProgress/);
  assert.match(functionSource(app, "refreshSnapshots"), /snapshotItemsLocation !== location[\s\S]*?renderSnapshotListLoading\(location\)[\s\S]*?snapshotItemsLocation = location/);
  assert.match(functionSource(app, "refreshSnapshots"), /showingCloudCache[\s\S]*?snapshotCloudCacheRefreshing[\s\S]*?cacheCloudHistory\(items\)[\s\S]*?clearCloudHistoryCache\(\)[\s\S]*?renderSnapshotListError\(location, retainItems\)/);
  assert.match(functionSource(app, "loadSnapshot"), /setHistoryActivity[\s\S]*?snapshotLoadRequesting[\s\S]*?snapshotLoadDownloading[\s\S]*?snapshotLoadDecoding[\s\S]*?snapshotLoadApplying/);
  assert.match(functionSource(app, "loadSnapshot"), /if \(!loadIsCurrent\(\)\) return;[\s\S]*?loadGeneration !== state\.snapshotLoadGeneration[\s\S]*?return false/);
  for (const id of ["serverProjectManager", "historyProjectSelect", "historyProjectCreate", "historyProjectDelete", "projectDialog", "projectForm", "projectName", "projectDialogCreate", "newCanvasProjectField", "newCanvasProjectSelect"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.doesNotMatch(html, /id="projectDialogCancel"/);
  assert.match(functionSource(app, "openServerProjectDialog"), /projectDialog[\s\S]*?showModal\(\)[\s\S]*?input\.focus\(\)/);
  assert.match(functionSource(app, "createServerProject"), /projectName[\s\S]*?input\.value\.trim\(\)\.slice\(0, 48\)[\s\S]*?fetch\(isCloud \? "\/api\/cloud\/projects" : "\/api\/canvas-projects"[\s\S]*?dialog\.close\("created"\)/);
  assert.doesNotMatch(app, /\bprompt\s*\(/);
  assert.doesNotMatch(functionSource(app, "deleteSelectedServerProject"), /\bconfirm\s*\(/);
  assert.match(functionSource(app, "requestSelectedProjectDelete"), /historyDeletePending = \{ type:"project"[\s\S]*?deleteCloudProjectConfirm[\s\S]*?showModal\(\)[\s\S]*?cancel\.focus/);
  assert.match(functionSource(app, "confirmSnapshotDelete"), /pending\.type === "project"[\s\S]*?deleteSelectedServerProject\(pending\)[\s\S]*?dialog\.close\("deleted"\)/);
  assert.match(app, /querySelector\("#historyProjectDelete"\)\.onclick = requestSelectedProjectDelete/);
  assert.match(css, /\.history-sidebar-heading\s*\{[^}]*width:\s*100%[^}]*justify-content:\s*space-between[^}]*padding:\s*0 0 0 8px/);
  assert.match(css, /\.history-project-create\s*\{[^}]*margin-inline:\s*auto 0/);
  assert.match(functionSource(app, "storedServerProjectId"), /sessionStorage\.getItem\(SERVER_PROJECT_SESSION_KEY\)/);
  assert.match(functionSource(app, "rememberSelectedServerProject"), /sessionStorage\.setItem\(SERVER_PROJECT_SESSION_KEY, selectedServerProjectId\)/);
  assert.match(functionSource(app, "selectedServerSaveProjectId"), /selectedServerProjectId === SERVER_ALL_PROJECTS_ID \? SERVER_DEFAULT_PROJECT_ID/);
  assert.match(app, /async function saveSnapshot\([\s\S]*?projectId:location === "server"[\s\S]*?overwriteId[\s\S]*?selectedServerSaveProjectId\(\)/);
  assert.match(functionSource(app, "deleteSelectedServerProject"), /method:"DELETE"[\s\S]*?rememberSelectedServerProject\(SERVER_DEFAULT_PROJECT_ID\)/);
  assert.match(functionSource(app, "moveServerSnapshot"), /\/api\/canvases\/\$\{encodeURIComponent\(id\)\}\/project[\s\S]*?projectId/);
  const unsavedGuard = functionSource(app, "canvasHasUnsavedChanges"), transitionGuard = functionSource(app, "requestCanvasTransition");
  assert.match(unsavedGuard, /state\.userRevision === state\.snapshotSavedRevision[\s\S]*?return false/);
  assert.match(unsavedGuard, /state\.currentSnapshotId && state\.currentCanvasSuggestedName/);
  assert.match(unsavedGuard, /state\.currentSnapshotId \|\| hasContent/);
  assert.doesNotMatch(unsavedGuard, /state\.dirty/);
  assert.match(transitionGuard, /canvasHasUnsavedChanges\(\)[\s\S]*?performCanvasTransition\(transition\)[\s\S]*?pendingCanvasTransition = transition[\s\S]*?showModal/);
  assert.match(functionSource(app, "openNewCanvasDialog"), /requestCanvasTransition\(\{ type:"new" \}\)/);
  assert.match(functionSource(app, "requestLoadSnapshot"), /requestCanvasTransition\(\{ type:"load", id, location \}\)/);
  assert.match(functionSource(app, "performCanvasTransition"), /transition\?\.type === "load"[\s\S]*?loadSnapshot\(transition\.id, transition\.location\)[\s\S]*?startBlankCanvas\(\)/);
  const hasUnsavedChanges = ({ currentSnapshotId = null, currentCanvasSuggestedName = "", userRevision = 2, snapshotSavedRevision = 1, tileCount = 0, dirty = null } = {}) => vm.runInNewContext(`(${unsavedGuard})()`, {
    state:{ currentSnapshotId, currentCanvasSuggestedName, userRevision, snapshotSavedRevision, dirty, images:[], textBoxes:[], preservedSnapshotAnimations:[], animations:[] },
    tiles:{ size:tileCount },
    pluginEnabled:() => false,
    visibleWidgets:() => [],
  });
  assert.equal(hasUnsavedChanges({ currentSnapshotId:"saved-canvas" }), true, "clearing a saved canvas must remain dirty");
  assert.equal(hasUnsavedChanges(), false, "an empty never-saved canvas has nothing to lose");
  assert.equal(hasUnsavedChanges({ tileCount:1 }), true, "content on a never-saved canvas must be protected");
  assert.equal(hasUnsavedChanges({ currentSnapshotId:"saved-canvas", userRevision:1, snapshotSavedRevision:1, tileCount:1, dirty:{ x:0, y:0, w:1, h:1 } }), false, "AI attention state alone is not an unsaved snapshot revision");
  assert.equal(hasUnsavedChanges({ currentSnapshotId:"saved-canvas", currentCanvasSuggestedName:"Suggested title", userRevision:1, snapshotSavedRevision:1 }), true, "an unsaved suggested name must remain protected");
  assert.ok(css.includes("grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));"));
  assert.match(css, /\.history-library-browser\s*\{[^}]*grid-template-columns:\s*226px minmax\(0, 1fr\)/);
  assert.match(css, /\.history-list\.grid-view \.history-card\s*\{[^}]*min-height:\s*228px/);
  assert.match(css, /\.history-list\.grid-view \.history-card-select\s*\{[^}]*min-height:\s*228px[^}]*padding:\s*10px 10px 44px/);
  assert.match(css, /\.history-preview\s*\{[^}]*width:\s*84px[^}]*height:\s*58px[^}]*flex:\s*0 0 84px/);
  assert.match(css, /\.history-row-actions\s*\{[^}]*position:\s*absolute[^}]*padding:\s*3px[^}]*background:\s*var\(--ai-surface\)/);
  assert.match(css, /\.history-toolbar-save \.history-save-row\s*\{[^}]*position:\s*absolute[^}]*grid-template-columns:\s*minmax\(190px, 1fr\) auto/);
  assert.match(css, /\.history-projects\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*gap:\s*0/);
  assert.match(css, /\.history-project-nav-item\s*\{[^}]*min-height:\s*var\(--pe-menu-item-h, 30px\)[^}]*border-radius:\s*5px/);
  assert.doesNotMatch(css, /Keep compact Library project rows/);
  assert.match(css, /\.history-content-guidance\s*\{[^}]*max-width:\s*44ch[^}]*text-align:\s*right/);
  assert.match(css, /\.history-move\s*\{[^}]*width:\s*min\(196px, 100%\)[^}]*height:\s*30px/);
  assert.match(css, /\.history-sidebar-section \.snapshot-location-options\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.doesNotMatch(html, /class="history-kicker"/);
  assert.match(css, /\.history-list-loading, \.history-empty\s*\{[^}]*min-height:\s*100%[^}]*padding:\s*40px[^}]*border:\s*0/);
  assert.match(css, /\.history-panel \.history-projects \.history-project-delete:hover:not\(:disabled\)\s*\{[^}]*color:\s*var\(--ai-danger\)[^}]*background:\s*transparent/);
  assert.match(css, /\.history-projects \.history-project-delete:disabled\s*\{[^}]*visibility:\s*visible[^}]*opacity:\s*\.48/);
  assert.match(css, /@container history-library \(min-width: 701px\)\s*\{[\s\S]*?\.history-panel\[data-pe-surface="manager"\] \.history-projects\s*\{[^}]*flex-direction:\s*column[^}]*flex-wrap:\s*nowrap[\s\S]*?\.history-projects \.history-project-delete\s*\{[^}]*width:\s*100%[^}]*flex:\s*0 0 30px/);
  assert.match(css, /\.history-sidebar-section \.history-location-label\s*\{[^}]*flex:\s*1 1 auto[^}]*text-align:\s*left/);
  assert.match(css, /\.history-sidebar-section :is\(\.history-location-label, \.history-location-count\)\s*\{[^}]*line-height:\s*var\(--pe-menu-item-h, 30px\)/);
  assert.match(css, /@media \(max-width: 820px\)[\s\S]*?\.history-panel\s*\{[^}]*border-radius:\s*0[^}]*box-shadow:\s*none[^}]*backdrop-filter:\s*none/);
  assert.match(css, /\.history-card \.history-item-load,[\s\S]*?\.history-card \.history-item-save\s*\{[^}]*height:\s*28px[^}]*color:\s*var\(--ai-ink\)[^}]*background:\s*transparent/);
  assert.match(css, /\.history-panel \.history-row-actions \.history-delete\s*\{[^}]*color:\s*var\(--ai-danger\)[^}]*background:\s*transparent/);
  assert.match(css, /\.history-panel \.history-row-actions button,[\s\S]*?\.history-row-actions select\s*\{[^}]*font:\s*500 13px\/1 var\(--ai-font\)/);
  assert.match(css, /\.history-meta \.history-card-title\s*\{[^}]*font:\s*400 14px\/1\.3 var\(--ai-font\)/);
  assert.match(css, /\.history-meta > small\s*\{[^}]*font:\s*400 12\.5px\/1\.4 var\(--ai-font\)/);
  assert.match(css, /\.history-card \.history-item-load,[\s\S]*?\.history-card \.history-item-save\s*\{[^}]*font:\s*500 13px\/1 var\(--ai-font\)/);
  assert.match(css, /\.history-card \.history-item-load:hover:not\(:disabled\),[\s\S]*?\.history-card \.history-item-save:hover:not\(:disabled\)\s*\{[^}]*background:\s*transparent/);
  assert.match(css, /\.history-panel \.history-toolbar-action,[\s\S]*?\.history-toolbar-save > summary\s*\{[^}]*font:\s*500 13px\/1 var\(--ai-font\)[^}]*\}[\s\S]*?\.history-toolbar-save > summary\s*\{[^}]*font-weight:\s*500/);
  assert.match(css, /\.history-panel \.history-toolbar-action\s*\{[^}]*border-color:\s*var\(--ai-line\)[^}]*background:\s*transparent/);
  assert.match(css, /\.history-panel \.history-toolbar-action:hover:not\(:disabled\)\s*\{[^}]*background:\s*transparent/);
  assert.match(css, /\.history-library-main\.grid-view\s*\{[^}]*grid-template-rows:\s*50px 74px minmax\(0, 1fr\)/);
  assert.match(css, /\.history-more::after\s*\{[^}]*inset:\s*-3px/);
  assert.doesNotMatch(css, /\.history-grid-actions|\.history-grid-selection|\.history-grid-load|grid-selection-active/);
  assert.match(css, /\.history-list\.grid-view \.history-item-load\s*\{[^}]*display:\s*none/);
  assert.match(css, /\.history-list\.grid-view \.history-row-actions\s*\{[^}]*width:\s*min\(180px,[^}]*align-items:\s*stretch[^}]*gap:\s*2px/);
  assert.match(css, /\.history-list\.grid-view \.history-row-actions button,[\s\S]*?\.history-list\.grid-view \.history-move\s*\{[^}]*width:\s*100%[^}]*height:\s*32px[^}]*justify-content:\s*flex-start/);
  assert.match(css, /\.history-toolbar-save > summary\s*\{[^}]*color:\s*var\(--ai-primary-ink\)[^}]*background:\s*var\(--ai-primary\)/);
  assert.match(css, /\.history-toolbar-save\[open\] > summary\s*\{[^}]*background:\s*transparent/);
  assert.match(css, /\.history-toolbar-save \.history-save-row input\s*\{[^}]*height:\s*32px[^}]*border-radius:\s*6px[^}]*background:\s*var\(--ai-surface\)[^}]*font:\s*400 13px\/1\.2 var\(--ai-font\)/);
  assert.match(css, /\.history-toolbar-save #historySaveCurrent\s*\{[^}]*font-weight:\s*500[^}]*box-shadow:\s*none/);
  assert.match(css, /\.history-view-switch button\[aria-pressed="true"\]\s*\{[^}]*box-shadow:\s*none/);
  assert.match(css, /\.history-panel \.history-more\s*\{[^}]*background:\s*transparent[^}]*font-weight:\s*500/);
  assert.match(css, /\.history-more:hover:not\(:disabled\),[\s\S]*?\.history-more\[aria-expanded="true"\]\s*\{[^}]*background:\s*transparent/);
  assert.match(css, /\.new-canvas-actions button\s*\{[^}]*height:\s*32px[^}]*border-radius:\s*6px[^}]*background:\s*transparent[^}]*font:\s*500 13px\/1\.1 var\(--ai-font\)/);
  assert.match(css, /\.new-canvas-actions \.new-canvas-primary\s*\{[^}]*font-weight:\s*500[^}]*box-shadow:\s*none/);
  assert.match(css, /#newCanvasDialog \.new-canvas-actions button\s*\{[^}]*font:\s*500 13px\/1\.1 var\(--ai-font\)/);
  assert.match(css, /#newCanvasDialog \.new-canvas-actions \.new-canvas-primary\s*\{[^}]*font-weight:\s*500/);
  assert.match(css, /\.new-canvas-fields\s*\{[^}]*display:\s*grid;[^}]*gap:\s*12px;[^}]*\}/);
  assert.match(html, /class="new-canvas-save-fields"[\s\S]*?id="newCanvasProjectField"[\s\S]*?id="newSnapshotName"/);
  assert.match(css, /\.new-canvas-save-fields\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)[^}]*gap:\s*12px/);
  assert.match(css, /\.new-canvas-dialog\s*\{[^}]*width:\s*min\(540px,[^}]*box-shadow:\s*0 8px 14px/);
  assert.match(css, /#newCanvasDialog \.snapshot-location legend\s*\{[^}]*font:\s*500 13px\/1\.25 var\(--ai-font\)[^}]*letter-spacing:\s*normal[^}]*text-transform:\s*none/);
  assert.match(css, /\.new-canvas-project, \.new-snapshot-name\s*\{[^}]*font:\s*500 13px\/1\.25 var\(--ai-font\)[^}]*letter-spacing:\s*normal[^}]*text-transform:\s*none/);
  assert.match(css, /\.new-canvas-actions \.new-canvas-primary:active:not\(:disabled\)\s*\{[^}]*background:\s*var\(--ai-primary-active\)/);
  assert.match(app, /newCanvasDescription:\s*"Save this canvas if needed\. Unaccepted AI drafts aren't included\."/);
  assert.match(app, /newSnapshotName:\s*"Name"/);
  assert.match(zh, /newCanvasDescription:\s*"需要时先保存当前画布；未确认的 AI 草稿不会保存。"/);
  assert.match(zh, /newSnapshotName:\s*"名称"/);
  assert.match(css, /\.project-dialog\s*\{[^}]*width:\s*min\(336px,[^}]*border-radius:\s*12px/);
  assert.match(css, /\.history-rename-form\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 36px 36px/);
});

test("searchable sidebars and popups open without focusing a text field", () => {
  const html = read("public/index.html"), persistence = read("src/client/app/persistence.js"),
    navigator = read("src/client/app/studio-navigator.js"), agent = read("src/client/app/canvas-agent-runtime.js"),
    openHistory = functionSource(persistence, "openHistoryPanel"), scheduleNavigator = functionSource(navigator, "scheduleStudioNavigatorOpenWork"),
    toggleReferencePicker = functionSource(agent, "canvasAgentToggleReferencePicker");
  for (const id of ["historySearch", "studioNavigatorSearch", "canvasAgentReferenceSearch"]) {
    assert.doesNotMatch(html, new RegExp(`id="${id}"[^>]*\\bautofocus\\b`));
  }
  assert.match(openHistory, /requestAnimationFrame\([\s\S]*panel\.focus\(\{ preventScroll:true \}\)[\s\S]*requestAnimationFrame\([\s\S]*renderSnapshotList\(\)/);
  assert.doesNotMatch(openHistory, /historySearch[^\n]*focus/);
  assert.doesNotMatch(scheduleNavigator, /studioNavigatorSearch\.focus/);
  assert.doesNotMatch(toggleReferencePicker, /canvasAgentReferenceSearch\.focus/);
});

test("text-entry focus stays on the rounded control surface without a nested rectangular outline", () => {
  const css = read("public/style.css");
  assert.ok(css.includes("button:focus-visible, select:focus-visible, a:focus-visible { outline: 2px solid #e3c87e; outline-offset: 2px; }"));
  assert.ok(css.includes('body[data-theme="studio"] button:focus-visible, body[data-theme="studio"] select:focus-visible, body[data-theme="studio"] a:focus-visible { outline: 2px solid var(--studio-accent); outline-offset: 2px; }'));
  assert.match(css, /\.history-search input\s*\{[^}]*outline:\s*0/);
  assert.match(css, /\.studio-navigator-search input\s*\{[^}]*outline:\s*0/);
  assert.match(css, /\.canvas-agent-reference-picker input\s*\{[^}]*outline:\s*0/);
  assert.match(css, /\.plugin-editor-field textarea:focus, \.plugin-editor-field input:focus\s*\{[^}]*outline:\s*none[^}]*box-shadow:/);
  assert.doesNotMatch(css, /(?:^|,)\s*(?:body\[data-theme="studio"\]\s+)?input:focus-visible\s*(?:,|\{)/m);
});

test("local snapshot database upgrades preserve existing canvas records", () => {
  const snapshotDb = functionSource(read("public/app.js"), "snapshotDb");
  assert.match(snapshotDb, /indexedDB\.open\(SNAPSHOT_DB, 2\)/);
  assert.match(snapshotDb, /createObjectStore\(SNAPSHOT_TILE_STORE/);
  assert.doesNotMatch(snapshotDb, /objectStore\(SNAPSHOT_STORE\)\.clear\(\)/);
});

test("Cloud History distinguishes sign-in from failures and protects external Canvas opens", () => {
  const persistence = read("src/client/app/persistence.js"), bootstrap = read("src/client/app/ui-bootstrap.js"), css = read("public/style.css");
  assert.match(functionSource(persistence, "cloudHistoryRequiresSignIn"), /cloud_sign_in_required/);
  assert.doesNotMatch(functionSource(persistence, "cloudHistoryRequiresSignIn"), /status\) === 401|unauthorized/);
  assert.match(functionSource(persistence, "renderCloudHistorySignIn"), /history-cloud-auth[\s\S]*?closeHistoryPanel\(\)[\s\S]*?cloudAccountBtn[\s\S]*?\.click\(\)/);
  assert.match(functionSource(persistence, "renderSnapshotList"), /location === "cloud" && cloudHistorySignInRequired[\s\S]*?renderCloudHistorySignIn/);
  assert.match(functionSource(persistence, "refreshSnapshots"), /authenticationRequired[\s\S]*?renderCloudHistorySignIn[\s\S]*?renderSnapshotListError\(location, retainItems\)[\s\S]*?authenticationRequired \|\| loadFailed/);
  assert.match(functionSource(persistence, "updateHistoryReadControls"), /cloudBlocked[\s\S]*?historyProjectSelect[\s\S]*?historySaveCurrent[\s\S]*?saveCanvasBtn/);
  assert.match(functionSource(persistence, "updateNewCanvasDialog"), /cloudBlocked[\s\S]*?saveCopy\.disabled = cloudBlocked/);
  assert.match(functionSource(persistence, "confirmExternalCanvasOpen"), /!canvasHasUnsavedChanges\(\) \|\| window\.confirm\(cloudHistoryCopy\("confirmExternalOpen"\)\)/);
  assert.match(functionSource(persistence, "cloudHistoryCopy"), /snapshotCloudSignInRequired[\s\S]*?snapshotCloudSignInHint[\s\S]*?openCloudCanvasUnsaved/);
  assert.match(functionSource(persistence, "refreshSnapshots"), /if \(authenticationRequired\) return false;/);
  assert.match(bootstrap, /confirmExternalOpen:confirmExternalCanvasOpen/);
  assert.match(functionSource(persistence, "importCommunityCanvasArtifact"), /requestLoadSnapshot\(id, "device"\)/);
  assert.doesNotMatch(functionSource(persistence, "importCommunityCanvasArtifact"), /loadSnapshot\(id, "device"\)/);
  assert.doesNotMatch(functionSource(persistence, "importCommunityCanvasArtifact"), /refreshSnapshots\(\)/);
  const openCloudCanvas = functionSource(persistence, "openCloudCanvas");
  assert.match(openCloudCanvas, /setSnapshotLocation\("cloud", \{ refresh:false \}\)/);
  assert.match(openCloudCanvas, /requestLoadSnapshot\(canvasId, "cloud"\)/);
  assert.doesNotMatch(openCloudCanvas, /refreshSnapshots\(\)|window\.open|location\./);
  assert.match(css, /\.history-cloud-auth\s*\{/);
  assert.match(css, /\.history-panel \.history-cloud-auth button\s*\{[^}]*min-height:\s*32px[^}]*font:\s*500 13px\/1 var\(--ai-font\)/);
  assert.match(css, /\.history-cloud-auth button:hover:not\(:disabled\), \.history-cloud-auth button:focus-visible\s*\{[^}]*color:\s*var\(--ai-primary-ink\)[^}]*background:\s*var\(--ai-primary-hover\)/);
  assert.match(css, /#historyClose, \.new-canvas-close\s*\{[^}]*width:\s*36px[^}]*height:\s*36px[^}]*flex:\s*0 0 36px/);
  for (const selector of [
    "history-save-row input",
    "history-projects select",
    "history-projects button",
    "history-actions button",
    "history-move",
  ]) assert.match(css, new RegExp(`\\.${selector}\\s*\\{[^}]*min-height:\\s*36px`));
  assert.match(css, /\.new-canvas-project select, \.new-snapshot-name input\s*\{[^}]*height:\s*32px[^}]*min-height:\s*32px/);
  assert.match(css, /\.new-canvas-actions button\s*\{[^}]*height:\s*32px[^}]*min-height:\s*32px/);
  assert.match(css, /\.snapshot-location-options\s*\{[^}]*height:\s*36px/);
  assert.match(css, /\.snapshot-location-options span\s*\{[^}]*height:\s*30px[^}]*min-height:\s*30px/);
  assert.match(css, /#historySaveCurrent, #historySave\s*\{[^}]*height:\s*36px[^}]*min-height:\s*36px/);
  assert.match(css, /\.settings-editor-cancel\s*\{[^}]*height:\s*36px[^}]*min-height:\s*36px/);
  assert.match(css, /@media \(pointer: coarse\)/);
  assert.ok(css.includes("#historyClose, .new-canvas-close { width: 44px; height: 44px; flex-basis: 44px; }"));
  assert.ok(css.includes(".new-canvas-actions button, .new-canvas-project select, .new-snapshot-name input { height: auto; min-height: 44px; }"));
  assert.match(functionSource(persistence, "renderSnapshotListLoading"), /role", "status"/);
  assert.match(functionSource(persistence, "renderSnapshotListError"), /role", "alert"/);
});

test("Cloud History restores a session cache without sharing mutable list containers", () => {
  const persistence = read("src/client/app/persistence.js"), context = {
    snapshotItems:[],
    snapshotItemsLocation:null,
    cloudCanvasProjects:[{ id:"project-one" }],
    cloudHistoryCache:null,
    result:null,
  };
  vm.runInNewContext(`
    ${functionSource(persistence, "cacheCloudHistory")}
    ${functionSource(persistence, "restoreCloudHistoryCache")}
    ${functionSource(persistence, "clearCloudHistoryCache")}
    const fetchedItems = [{ id:"canvas-one" }];
    cacheCloudHistory(fetchedItems);
    fetchedItems.push({ id:"canvas-two" });
    cloudCanvasProjects.push({ id:"project-two" });
    snapshotItems = [];
    cloudCanvasProjects = [];
    const restored = restoreCloudHistoryCache();
    const restoredItemCount = snapshotItems.length;
    const restoredProjectCount = cloudCanvasProjects.length;
    snapshotItems.push({ id:"canvas-three" });
    cloudCanvasProjects.push({ id:"project-three" });
    snapshotItems = [];
    cloudCanvasProjects = [];
    restoreCloudHistoryCache();
    const isolatedItemCount = snapshotItems.length;
    const isolatedProjectCount = cloudCanvasProjects.length;
    clearCloudHistoryCache();
    result = { restored, restoredItemCount, restoredProjectCount, isolatedItemCount, isolatedProjectCount, cleared:cloudHistoryCache === null };
  `, context);
  assert.equal(JSON.stringify(context.result), JSON.stringify({
    restored:true,
    restoredItemCount:1,
    restoredProjectCount:1,
    isolatedItemCount:1,
    isolatedProjectCount:1,
    cleared:true,
  }));
});

test("New and Export remain accessible Studio-aware icon buttons while duplicate Clear and Debug stay out of the toolbar", () => {
  const html = read("public/index.html"), css = read("public/style.css");
  for (const id of ["newCanvasBtn", "exportPngBtn"]) {
    const button = html.match(new RegExp(`<button[^>]*id="${id}"[\\s\\S]*?<\\/button>`))?.[0] || "";
    assert.match(button, /class="[^"]*icon-button[^"]*utility-icon[^"]*"/);
    assert.match(button, /data-i18n-aria=/);
    assert.match(button, /data-i18n-title=/);
    assert.match(button, /<svg /);
    assert.doesNotMatch(button, />\s*(New|Clear|Debug)\s*</);
  }
  assert.doesNotMatch(html, /id="clearCanvasBtn"|data-action="clear"/);
  assert.doesNotMatch(html, /id="debugBtn"/);
  assert.doesNotMatch(html, /id="theme"|value="(?:arcane|scifi|research)"/);
  assert.equal((html.match(/class="studio-palette-option"/g) || []).length, 8);
  assert.match(css, /button\.utility-icon:not\(\.active\).*var\(--ink\)/);
  assert.match(css, /button\.utility-icon\.danger:not\(\.active\).*var\(--danger\)/);
});

test("Canvas grid toolbar icon uses four equal cells", () => {
  const html = read("public/index.html"),
    button = html.match(/<button[^>]*id="gridToggle"[\s\S]*?<\/button>/)?.[0] || "";
  const cells = [...button.matchAll(/<rect x="(4|14)" y="(4|14)" width="6" height="6" rx="1"\/>/g)];
  assert.equal(cells.length, 4);
  assert.equal(new Set(cells.map((cell) => `${cell[1]},${cell[2]}`)).size, 4);
  assert.doesNotMatch(button, /<path/);
});

test("Studio-only palettes are wired through initialization, localization, and snapshots", () => {
  const html = read("public/index.html"), app = read("public/app.js"), css = read("public/style.css"), zh = read("public/locales/zh.js");
  assert.match(html, /<body\b[^>]*\bdata-theme="studio"[^>]*\bdata-studio-palette="teal"/);
  assert.match(html, /<meta\b[^>]*\bname="theme-color"[^>]*\bcontent="#eef0f3"/);
  assert.match(html, /<div\b[^>]*\bid="aiEmbodiment"[^>]*\bdata-theme="studio"/);
  assert.match(app, /DEFAULT_THEME\s*=\s*"studio"/);
  assert.match(app, /DEFAULT_STUDIO_PALETTE\s*=\s*"teal"/);
  assert.match(app, /REMOVED_THEMES\s*=\s*new Set\(\["arcane", "scifi", "research"\]\)/);
  assert.match(app, /SUPPORTED_THEMES\s*=\s*new Set\(\[DEFAULT_THEME\]\)/);
  assert.match(app, /SUPPORTED_STUDIO_PALETTES\s*=\s*new Set\(\["indigo", "graphite", "cobalt", "azure", "teal", "forest", "amber", "burgundy"\]\)/);
  assert.match(app, /function normalizeTheme\(theme\)\s*\{\s*return SUPPORTED_THEMES\.has\(theme\) \? theme : DEFAULT_THEME;/);
  assert.match(app, /function normalizeStudioPalette\(palette\)\s*\{\s*return SUPPORTED_STUDIO_PALETTES\.has\(palette\) \? palette : DEFAULT_STUDIO_PALETTE;/);
  assert.match(app, /function normalizeStudioPaletteForTheme\(theme, palette\)\s*\{\s*return REMOVED_THEMES\.has\(theme\) \? DEFAULT_STUDIO_PALETTE : normalizeStudioPalette\(palette\);/);
  assert.match(app, /initialTheme\s*=\s*normalizeTheme\(storedTheme\)/);
  assert.match(app, /initialStudioPalette\s*=\s*normalizeStudioPaletteForTheme\(storedTheme, storedStudioPalette\)/);

  const appearanceControls = functionSource(app, "updateAppearanceControls"), embodimentCopy = functionSource(app, "updateEmbodimentLabel"), loadSnapshot = functionSource(app, "loadSnapshot");
  assert.match(appearanceControls, /studio-palette-option\[data-studio-palette\][\s\S]*?data-page-scale/);
  assert.match(embodimentCopy, /t\("guideStudio"\)/);
  assert.match(loadSnapshot, /applyTheme\(item\.theme\)/);
  assert.match(functionSource(app, "applyTheme"), /normalizeStudioPaletteForTheme\(theme, state\.studioPalette\)[\s\S]*?theme\s*=\s*normalizeTheme\(theme\)[\s\S]*?penecho-studio-palette/);
  assert.match(functionSource(app, "applyStudioPalette"), /normalizeStudioPalette\(palette\)[\s\S]*?penecho-studio-palette/);

  for (const key of ["guideStudio", "studioPaletteIndigo", "studioPaletteGraphite", "studioPaletteCobalt", "studioPaletteAzure", "studioPaletteTeal", "studioPaletteForest", "studioPaletteAmber", "studioPaletteBurgundy"]) {
    assert.match(app, new RegExp(`\\b${key}:\\s*"`));
    assert.match(zh, new RegExp(`\\b${key}:\\s*"`));
  }
  assert.match(css, /body\[data-theme="studio"\]\s*\{/);
  for (const palette of ["indigo", "graphite", "cobalt", "azure", "teal", "forest", "amber", "burgundy"]) assert.match(css, new RegExp(`\\[data-studio-palette="${palette}"\\]`));
  assert.match(css, /body\[data-theme="studio"\] \.canvas-agent-project-dialog\s*\{[^}]*color:\s*var\(--studio-text\)[^}]*border-color:\s*var\(--studio-line\)[^}]*background:\s*var\(--penecho-dialog-surface\)/);
  assert.match(css, /body\[data-theme="studio"\] \.canvas-agent-project-row\.selected,[\s\S]*?\.canvas-agent-project-row\.selected:hover\s*\{[^}]*background:\s*var\(--pe-selected\)/);
  assert.match(css, /body\[data-theme="studio"\] \.canvas-agent-resource-heading-icon,[\s\S]*?\.canvas-agent-resource-icon\s*\{[^}]*color:\s*var\(--pe-ink-2\)[^}]*background:\s*var\(--pe-surface-muted\)/);
  assert.match(css, /body\[data-theme="studio"\] \.canvas-agent-prompt-popup\s*\{[^}]*border-color:\s*var\(--studio-line\)[^}]*background:\s*var\(--studio-panel-raised\)/);
  assert.match(css, /body\[data-theme="studio"\]\.is-fullscreen\s+#viewport\s*\{[^}]*height:\s*100%[^}]*min-height:\s*0/);
});

test("Studio palette propagates through every Canvas popup surface", () => {
  const css = read("public/style.css"), cloudCss = read("public/cloud-connect.css");
  assert.match(css, /:root\s*\{[^}]*--penecho-dialog-backdrop:\s*rgba\(18, 23, 34, \.2\)[^}]*--penecho-dialog-backdrop-filter:\s*blur\(4px\) saturate\(1\.08\)[^}]*--penecho-dialog-surface:[^}]*70%, transparent\)[^}]*--penecho-dialog-raised-surface:[^}]*78%, transparent\)[^}]*--penecho-dialog-body-surface:[^}]*74%, transparent\)[^}]*--penecho-dialog-surface-filter:\s*blur\(24px\) saturate\(1\.18\)/);
  assert.match(css, /--penecho-large-dialog-radius:\s*18px/);
  assert.match(css, /--penecho-large-dialog-surface:\s*var\(--studio-glass,[^;]+62%, transparent\)\)/);
  assert.match(css, /--penecho-large-dialog-surface-filter:\s*saturate\(1\.15\) blur\(20px\)/);
  assert.match(css, /--penecho-large-dialog-shadow:\s*0 28px 80px rgba\(17, 24, 39, \.28\), 0 2px 8px rgba\(17, 24, 39, \.12\)/);
  assert.match(css, /--penecho-workbench-title-surface:[^;]*70%, transparent\)/);
  assert.match(css, /--penecho-workbench-title-filter:\s*blur\(24px\) saturate\(1\.2\)/);
  assert.match(css, /--penecho-workbench-navigation-surface:[^;]*68%, transparent\)/);
  assert.match(css, /--penecho-workbench-navigation-filter:\s*blur\(24px\) saturate\(1\.14\)/);
  assert.match(css, /--penecho-workbench-content-surface:[^;]*62%, transparent\)/);
  for (const selector of ["plugin-modal", "changelog-dialog", "settings-panel", "configuration-panel", "crafts-modal", "canvas-agent-project-dialog"]) {
    assert.match(css, new RegExp(`\\.${selector}\\s*\\{[^}]*border-radius:\\s*var\\(--penecho-large-dialog-radius\\)`));
  }
  for (const selector of ["settings-panel", "crafts-modal"]) {
    assert.match(css, new RegExp(`\\.${selector}\\s*\\{[^}]*background:\\s*var\\(--penecho-large-dialog-surface\\)[^}]*box-shadow:\\s*var\\(--penecho-large-dialog-shadow\\)[^}]*backdrop-filter:\\s*var\\(--penecho-large-dialog-surface-filter\\)`));
  }
  assert.match(css, /\.history-panel\[data-pe-surface="manager"\]\s*\{[^}]*border-radius:\s*var\(--penecho-large-dialog-radius\)[^}]*background:\s*var\(--penecho-large-dialog-surface\)[^}]*box-shadow:\s*var\(--penecho-large-dialog-shadow\)[^}]*backdrop-filter:\s*var\(--penecho-large-dialog-surface-filter\)/);
  assert.match(cloudCss, /\.penecho-cloud-dialog\s*\{[^}]*border-radius:\s*var\(--penecho-large-dialog-radius, 1\.125rem\)/);
  assert.match(cloudCss, /\.penecho-cloud-dialog\.cloud-center\s*\{[^}]*background:\s*var\(--penecho-large-dialog-surface,[^}]*62%, transparent\)\)[^}]*box-shadow:\s*var\(--penecho-large-dialog-shadow,[^}]*0 28px 80px[^}]*backdrop-filter:\s*var\(--penecho-large-dialog-surface-filter, saturate\(1\.15\) blur\(20px\)\)/);
  assert.match(css, /\.plugin-modal\s*\{[^}]*--ink:\s*var\(--studio-text,[^)]+\)[^}]*--panel-raised:\s*var\(--studio-panel,[^)]+\)[^}]*--gold-bright:\s*var\(--studio-accent-strong,[^)]+\)/);
  assert.match(css, /\.plugin-modal-layer\s*\{[^}]*background:\s*var\(--penecho-dialog-backdrop\)[^}]*backdrop-filter:\s*var\(--penecho-dialog-backdrop-filter\)/);
  assert.match(css, /\.plugin-modal\s*\{[^}]*background:\s*var\(--penecho-dialog-surface\)[^}]*backdrop-filter:\s*var\(--penecho-dialog-surface-filter\)/);
  assert.match(css, /\.history-panel, \.new-canvas-dialog\s*\{[^}]*--ai-surface:\s*var\(--studio-panel,[^)]+\)[^}]*--ai-accent:\s*var\(--studio-accent,[^)]+\)[^}]*--ai-primary:\s*var\(--studio-accent-strong,[^)]+\)/);
  assert.match(css, /body\[data-theme="studio"\] \.tour-card\s*\{[^}]*border-color:\s*var\(--studio-accent-border\)[^}]*background:\s*var\(--studio-panel\)/);
  assert.match(css, /\.settings-panel, \.configuration-panel\s*\{[^}]*--ink:\s*var\(--studio-text,[^)]+\)[^}]*--gold-bright:\s*var\(--studio-accent-strong,[^)]+\)/);
  assert.match(css, /\.configuration-panel\s*\{[^}]*background:\s*var\(--penecho-dialog-surface\)[^}]*backdrop-filter:\s*var\(--penecho-dialog-surface-filter\)/);
  assert.match(css, /\.crafts-modal\s*\{[^}]*--ink:\s*var\(--studio-text,[^)]+\)[^}]*--panel-raised:\s*var\(--studio-panel,[^)]+\)[^}]*background:\s*var\(--penecho-large-dialog-surface\)[^}]*backdrop-filter:\s*var\(--penecho-large-dialog-surface-filter\)/);
  assert.match(css, /body\[data-theme="studio"\] \.canvas-agent-project-dialog\s*\{[^}]*color:\s*var\(--studio-text\)[^}]*border-color:\s*var\(--studio-line\)[^}]*background:\s*var\(--penecho-dialog-surface\)/);
  assert.match(css, /body\[data-theme="studio"\] \.canvas-agent-prompt-popup\s*\{[^}]*border-color:\s*var\(--studio-line\)[^}]*background:\s*var\(--studio-panel-raised\)/);
  assert.match(css, /\.studio-session-delete-dialog\s*\{[^}]*color:\s*var\(--studio-text,[^)]+\)[^}]*background:\s*var\(--penecho-dialog-surface\)[^}]*backdrop-filter:\s*var\(--penecho-dialog-surface-filter\)/);
  assert.match(css, /\.changelog-dialog\s*\{[^}]*color:\s*var\(--ink\)[^}]*background:\s*var\(--penecho-dialog-surface\)[^}]*backdrop-filter:\s*var\(--penecho-dialog-surface-filter\)/);
  for (const selector of ["new-canvas-dialog", "studio-session-delete-dialog", "canvas-agent-project-dialog"]) {
    assert.match(css, new RegExp(`\\.${selector}::backdrop\\s*\\{[^}]*background:\\s*var\\(--penecho-dialog-backdrop\\)[^}]*backdrop-filter:\\s*var\\(--penecho-dialog-backdrop-filter\\)`));
  }
});

test("Settings is a centered frosted workbench with persistent navigation and switchable detail pages", () => {
  const html = read("public/index.html"), css = read("public/style.css"), app = read("public/app.js");
  const panel = html.match(/<section id="settingsPanel"[\s\S]*?<\/section>\s*<\/div>\s*<div id="configurationLayer"/)?.[0] || "";
  assert.match(panel, /role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="settingsTitle"/);
  assert.match(panel, /data-pe-surface="settings"[^>]*data-pe-size="xl"[^>]*data-pe-layout="nav-content"[^>]*data-pe-material="control-glass"/);
  assert.match(panel, /class="settings-window-header penecho-workbench-header"[^>]*data-pe-region="header"[\s\S]*?class="penecho-workbench-icon"[^>]*>[\s\S]*?id="settingsClose"[\s\S]*?<svg/);
  assert.match(panel, /class="settings-navigation penecho-workbench-navigation"[^>]*role="tablist"[^>]*aria-orientation="vertical"/);
  for (const page of ["appearance", "connections", "canvas", "about"]) {
    assert.match(panel, new RegExp(`data-settings-page-target="${page}"`));
    assert.match(panel, new RegExp(`data-settings-page="${page}"`));
  }
  assert.ok(panel.indexOf('class="settings-navigation penecho-workbench-navigation"') < panel.indexOf('class="settings-detail"'));
  assert.equal((panel.match(/class="studio-palette-option"/g) || []).length, 8);
  assert.equal((panel.match(/data-page-scale=/g) || []).length, 4);
  assert.match(panel, /data-page-scale="0\.9" aria-checked="false"[^>]*>90%<\/button>/);
  assert.match(panel, /data-page-scale="1" aria-checked="true"/);
  assert.doesNotMatch(panel, /data-page-scale="1\.(?:5|75)"/);
  assert.match(css, /\.settings-panel\s*\{[^}]*top:\s*50%[^}]*left:\s*50%[^}]*border-radius:\s*var\(--penecho-large-dialog-radius\)[^}]*background:\s*var\(--penecho-large-dialog-surface\)[^}]*box-shadow:\s*var\(--penecho-large-dialog-shadow\)[^}]*backdrop-filter:\s*var\(--penecho-large-dialog-surface-filter\)/);
  assert.match(css, /#settingsPanel\s*\{[^}]*--penecho-workbench-title-surface:\s*var\(--penecho-workbench-navigation-surface\)[^}]*--penecho-workbench-title-filter:\s*var\(--penecho-workbench-navigation-filter\)/);
  assert.match(css, /#historyPanel\s*\{[^}]*--penecho-workbench-title-surface:\s*var\(--penecho-workbench-navigation-surface\)[^}]*--penecho-workbench-title-filter:\s*var\(--penecho-workbench-navigation-filter\)/);
  assert.match(css, /\.settings-workbench\s*\{[^}]*grid-template-columns:\s*var\(--penecho-workbench-navigation-w\) minmax\(0, 1fr\)/);
  assert.match(css, /\.settings-detail\s*\{[^}]*background:\s*var\(--penecho-workbench-content-surface\)/);
  assert.match(css, /\.settings-navigation\s*\{[^}]*background:\s*var\(--penecho-workbench-navigation-surface\)[^}]*backdrop-filter:\s*var\(--penecho-workbench-navigation-filter\)/);
  assert.match(css, /\.settings-page\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(css, /@media \(max-width: 680px\)[\s\S]*?\.settings-workbench\s*\{\s*grid-template-columns:\s*112px minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width: 520px\)[\s\S]*?\.settings-workbench\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width: 520px\)[\s\S]*?\.settings-navigation\s*\{[^}]*flex-direction:\s*row[^}]*overflow-x:\s*auto[^}]*border-bottom:/);
  assert.match(css, /@supports not \(backdrop-filter:\s*blur\(1px\)\)[\s\S]*?\.settings-window-header\s*\{\s*background:\s*var\(--studio-toolbar, #eef0f2\)/);
  assert.match(app, /function selectSettingsPage\(page,[\s\S]*?data-settings-page-target[\s\S]*?node\.hidden = !selected[\s\S]*?return true;\s*\}/);
  assert.match(functionSource(app, "handleSettingsNavigationKeydown"), /ArrowUp[\s\S]*?ArrowDown[\s\S]*?Home[\s\S]*?End/);
  assert.match(html, /<div class="settings-group settings-system-group">\s*<div class="settings-fields two-column">/);
  assert.doesNotMatch(html, /settingsSystemHeading|data-i18n="settingsSystemSection"|data-i18n="settingsSystemDescription"/);
});

test("Canvas grid keeps the original 500-unit lines at main-compatible one-pixel weight in the viewport and PNG export", () => {
  const canvas = read("src/client/app/canvas-runtime.js"), persistence = read("src/client/app/persistence.js"), css = read("public/style.css"),
    draw = functionSource(canvas, "drawCanvasLineGrid"), renderBackground = functionSource(canvas, "renderCanvasBackground"), exportCanvas = functionSource(persistence, "renderExportCanvas");
  assert.match(draw, /step = 500/);
  assert.match(draw, /context\.lineWidth = 1 \/ scale/);
  assert.match(draw, /context\.lineTo\(/);
  assert.doesNotMatch(draw, /context\.arc\(/);
  assert.match(renderBackground, /drawCanvasLineGrid\(ctx,[\s\S]*?state\.scale\)/);
  assert.match(exportCanvas, /drawCanvasLineGrid\(context, region, scale\)/);
  assert.match(css, /--paper-grid:\s*color-mix\(in srgb, var\(--studio-text\) 7%, transparent\)/);
});

test("Studio uses glass workbench overlays, contextual pen properties, and a right-edge Agent inspector", () => {
  const html = read("public/index.html"), css = read("public/style.css"), core = read("src/client/app/core.js"), bootstrap = read("src/client/app/ui-bootstrap.js"), agent = read("src/client/app/canvas-agent-runtime.js");
  const openAgentSource = agent.slice(agent.indexOf("function openCanvasAgent("),agent.indexOf("function closeCanvasAgent("));
  assert.match(html, /<body\b[^>]*data-theme="studio"[^>]*data-canvas-mode="pen"/);
  assert.match(html, /id="penToolProperties"[^>]*class="tool-properties pen-tool-properties"[\s\S]*?id="penSize"[\s\S]*?data-color-control="ink"[\s\S]*?data-color-control="ai"/);
  assert.match(html, /id="canvasAgentHome"[^>]*hidden[\s\S]*?id="canvasAgentPanel"[^>]*hidden[^>]*inert/);
  const syncModePresentation = functionSource(bootstrap, "syncCanvasModePresentation");
  assert.match(syncModePresentation, /document\.body\?\.setAttribute\("data-canvas-mode", mode\)/);
  assert.match(functionSource(bootstrap, "setCanvasMode"), /syncCanvasModePresentation\(\)/);
  assert.match(functionSource(core, "applyTheme"), /syncStudioWorkbench\(theme\)/);
  assert.match(functionSource(agent, "syncStudioWorkbench"), /theme === "studio"[\s\S]*?min-width: 701px[\s\S]*?canvasAgentFrame\.append\(canvasAgentPanel\)[\s\S]*?canvasAgentHome\.after\(canvasAgentPanel\)/);
  assert.match(functionSource(agent, "canvasAgentWorkbenchNeedsSync"), /dockedClass !== docked \|\| canvasAgentPanel\.parentElement !== expectedParent/);
  assert.match(functionSource(agent, "canvasAgentBeginPanelDrag"), /canvasAgentDockedPanel\(\)/);
  assert.match(functionSource(agent, "canvasAgentKeyboardPanelResize"), /canvasAgentFrame\.clientWidth\/CANVAS_AGENT_SIZE_STEPS/);
  assert.match(functionSource(agent, "canvasAgentMaximumPanelWidth"), /Math\.min\(canvasAgentFrame\.clientWidth\*0\.5,canvasAgentFrame\.clientWidth-16-navigatorReserve\)/);
  assert.match(css, /body\[data-theme="studio"\] \.top-row\s*\{[^}]*min-height:\s*42px[^}]*border-bottom:/);
  assert.match(css, /--studio-chrome-shadow-color:\s*rgba\(30, 35, 48, \.07\)/);
  assert.match(css, /body\[data-theme="studio"\] \.toolbar\s*\{[^}]*position:\s*absolute[^}]*top:\s*100%[^}]*min-height:\s*var\(--studio-toolbar-height\)[^}]*background:\s*var\(--studio-glass\)[^}]*box-shadow:\s*none[^}]*backdrop-filter:\s*saturate\(1\.2\) blur\(18px\)/);
  assert.match(css, /body\[data-theme="studio"\] \.canvas-frame::after\s*\{[^}]*z-index:\s*40[^}]*top:\s*var\(--studio-toolbar-height\)[^}]*height:\s*8px[^}]*background:\s*linear-gradient\(to bottom, var\(--studio-chrome-shadow-color\), transparent\)[^}]*box-shadow:\s*none/);
  assert.match(css, /studio-navigator-open \.canvas-frame::after\s*\{[^}]*left:\s*var\(--studio-navigator-width\)/);
  assert.match(css, /studio-agent-docked\.canvas-agent-open \.canvas-frame::after\s*\{[^}]*right:\s*var\(--studio-agent-width\)/);
  assert.match(css, /@media \(max-width: 1100px\)\s*\{[\s\S]*?studio-navigator-open \.canvas-frame::after\s*\{[^}]*left:\s*min\(320px, calc\(100% - 44px\)\)/);
  assert.match(css, /@media \(max-width: 820px\)\s*\{[\s\S]*?studio-navigator-open \.canvas-frame::after\s*\{[^}]*left:\s*min\(360px, calc\(100% - 16px\)\)/);
  assert.match(css, /body\[data-theme="studio"\]\[data-canvas-mode="pen"\] \.pen-tool-properties\s*\{[^}]*display:\s*inline-flex/);
  assert.match(css, /body\[data-theme="studio"\] main > footer\s*\{[^}]*min-height:\s*26px[^}]*border-top:/);
  assert.match(css, /--studio-agent-glass:\s*linear-gradient\(var\(--penecho-workbench-content-surface\), var\(--penecho-workbench-content-surface\)\), var\(--penecho-large-dialog-surface\)/);
  assert.match(css, /@media \(min-width: 701px\)[\s\S]*?studio-agent-docked \.canvas-agent-panel\s*\{[\s\S]*?position:\s*absolute[\s\S]*?inset:\s*var\(--studio-toolbar-height\) 0 0 auto[\s\S]*?flex:\s*none[\s\S]*?background:\s*var\(--studio-agent-glass\)[\s\S]*?box-shadow:\s*-4px 0 8px var\(--studio-chrome-shadow-color\)[\s\S]*?backdrop-filter:\s*var\(--penecho-large-dialog-surface-filter\)/);
  assert.match(css, /studio-agent-docked:not\(\.canvas-agent-open\) \.canvas-agent-panel\s*\{[^}]*pointer-events:\s*none[^}]*opacity:\s*0[^}]*translate3d\(100%, 0, 0\)/);
  assert.match(css, /studio-agent-docked \.canvas-agent-panel\s*\{[^}]*transition:\s*transform \.22s cubic-bezier\(\.2,\.72,\.2,1\), opacity \.16s ease/);
  assert.match(css, /studio-agent-docked:not\(\.canvas-agent-open\) \.canvas-agent-panel\s*\{[^}]*transition-delay:\s*0s, 0s, 0s, \.22s/);
  assert.doesNotMatch(css, /studio-agent-docked:not\(\.canvas-agent-open\) \.canvas-agent-panel\s*\{[^}]*width:\s*0/);
  assert.match(css, /studio-agent-docked\.canvas-agent-open \.canvas-frame\s*\{[^}]*--studio-agent-edge-shift:\s*calc\(var\(--studio-agent-width\) - 4px\)/);
  assert.match(css, /body\[data-theme="studio"\] \.canvas-agent-control\s*\{[^}]*right:\s*calc\(max\(16px, env\(safe-area-inset-right\)\) \+ var\(--studio-agent-edge-shift\)\)[^}]*transition:\s*right \.22s/);
  assert.match(css, /body\[data-theme="studio"\] \.canvas-agent-trigger\s*\{[^}]*border-color:\s*var\(--studio-line\)[^}]*background:\s*var\(--studio-panel\)[^}]*box-shadow:\s*none[^}]*backdrop-filter:\s*none/);
  assert.match(css, /\.canvas-agent-control\) > #canvasAgentToggle\[data-pe-button="toolbar"\]\s*\{[^}]*margin-inline:\s*0[^}]*border:\s*1px solid[^}]*background:\s*transparent/);
  assert.match(css, /body\[data-theme="studio"\] :is\(#pe-button-contract, \.canvas-agent-control\) > #canvasAgentToggle\[data-pe-button="toolbar"\]\s*\{[^}]*border-color:\s*var\(--studio-line\)[^}]*background:\s*transparent[^}]*box-shadow:\s*none/);
  for (const state of ["hover", "active"]) {
    assert.ok(css.includes(`#canvasAgentToggle[data-pe-button="toolbar"]:${state} {\n  background: transparent;`));
  }
  assert.match(css, /#canvasAgentToggle\[data-pe-button="toolbar"\]:hover\s*\{[^}]*color:\s*var\(--studio-accent\)/);
  assert.match(css, /#canvasAgentToggle\[data-pe-button="toolbar"\]:focus-visible\s*\{[^}]*border-color:\s*var\(--pe-accent\)[^}]*box-shadow:\s*0 0 0 2px var\(--pe-accent-focus\)/);
  assert.match(css, /@media \(max-width: 700px\)\s*\{[\s\S]*?body\[data-theme="studio"\] :is\(#pe-button-contract, \.canvas-agent-control\) > #canvasAgentToggle\[data-pe-button="toolbar"\]\s*\{[^}]*height:\s*46px[^}]*min-height:\s*46px[^}]*border-radius:\s*10px/);
  assert.match(agent, /function openCanvasAgent\([\s\S]*?canvasAgentToggle\.setAttribute\("aria-expanded","true"\)/);
  assert.match(functionSource(agent, "canvasAgentPrepareOpenState"), /if\(canvasAgentWorkbenchNeedsSync\(\)\)syncStudioWorkbench\(\)/);
  assert.match(agent, /function openCanvasAgent\(\{focus=false\}=\{\}\)[\s\S]*?document\.body\.classList\.add\("canvas-agent-open"\)[\s\S]*?syncCanvasModePresentation\(\)/);
  assert.match(functionSource(agent, "canvasAgentRunAfterDockedTransition"), /propertyName==="transform"[\s\S]*?addEventListener\("transitionend"[\s\S]*?setTimeout\(finish,CANVAS_AGENT_DOCKED_SETTLE_FALLBACK_MS\)/);
  assert.match(functionSource(agent, "canvasAgentScheduleDockedOpenWork"), /canvasAgentRunAfterDockedTransition\(\(\)=>canvasAgentFinishDockedOpen\(focus,connect\)\)/);
  assert.match(openAgentSource, /document\.body\.classList\.add\("canvas-agent-open"\)[\s\S]*?if\(animate&&docked\)\{[\s\S]*?canvasAgentScheduleDockedOpenWork\(focus,connect\);[\s\S]*?return/);
  assert.match(openAgentSource, /if\(animate&&!docked\)\{[\s\S]*?requestAnimationFrame[\s\S]*?canvasAgentAnimatePanel\(true,[\s\S]*?canvasAgentFinishFloatingOpen\(focus,connect\)/);
  assert.match(functionSource(agent, "canvasAgentFinishDockedOpen"), /canvasAgentPanel\.inert=false[\s\S]*?canvasAgentPrepareOpenState\(\)[\s\S]*?canvasAgentRestorePanelSize\(\)/);
  assert.match(functionSource(agent, "canvasAgentFinishDockedClose"), /canvasAgentPanel\.hidden=true[\s\S]*?canvasAgentPanel\.inert=true[\s\S]*?canvasAgentPersistCurrentConversation\(\)/);
  assert.match(functionSource(agent, "closeCanvasAgent"), /document\.body\.classList\.remove\("canvas-agent-open"\)[\s\S]*?canvasAgentScheduleDockedCloseWork\(\);return/);
  assert.match(functionSource(agent, "closeCanvasAgent"), /canvasAgentAnimatePanel\(false,panelRect,canvasAgentFinishDockedClose\)[\s\S]*?return/);
  assert.match(css, /body\[data-theme="studio"\] \.canvas-agent-trigger\[aria-expanded="true"\]\s*\{[^}]*color:\s*var\(--studio-accent\)/);
  assert.doesNotMatch(css, /\.canvas-agent-control:focus-within/);
  assert.match(agent, /function closeCanvasAgent\([\s\S]*?if\(focus\)canvasAgentToggle\.focus\(\)/);
  assert.match(css, /\.page-hint-slot\s*\{[^}]*grid-column:\s*2/);
  assert.doesNotMatch(css, /studio-agent-launcher-floating [^{]*(?:\.canvas-hint|#tip|\.canvas-navigation-lock-hint|\.text-input-hint)/);
  assert.match(functionSource(agent, "canvasAgentApplyPanelWidth"), /canvasAgentFrame\.classList\.add\(`canvas-agent-width-\$\{step\}`\)/);
  assert.match(agent, /function openCanvasAgent\(\{focus=false\}=\{\}\)[\s\S]*?document\.body\.classList\.add\("canvas-agent-open"\)[\s\S]*?if\(docked\)\{[\s\S]*?canvasAgentRestorePanelSize\(\)/);
  assert.match(css, /html\.penecho-web-page-scale body\[data-theme="studio"\] main\s*\{[^}]*--penecho-canvas-page-dynamic-height/);
});

test("opening PenEcho Agent re-syncs Pen mode presentation without changing the Canvas mode", () => {
  const bootstrap = read("src/client/app/ui-bootstrap.js"), agent = read("src/client/app/canvas-agent-runtime.js"),
    syncModePresentation = functionSource(bootstrap, "syncCanvasModePresentation"),
    makeButton = (active) => ({
      active,
      pressed:String(active),
      classList:{ toggle(name,value) { if (name === "active") this.owner.active = Boolean(value); }, owner:null },
      setAttribute(name,value) { if (name === "aria-pressed") this.pressed = value; },
    }),
    handButton = makeButton(true), penButton = makeButton(false), bodyAttributes = {}, viewClasses = {}, calls = [];
  handButton.classList.owner = handButton;
  penButton.classList.owner = penButton;
  const result = vm.runInNewContext(`${syncModePresentation};syncCanvasModePresentation();`, {
    state:{ mode:"pen" },
    eraserToolButton:null,
    syncCanvasNavigation() {},
    document:{
      body:{ setAttribute:(name,value) => { bodyAttributes[name] = value; } },
      querySelector:(selector) => selector === '[data-mode="pen"]' ? penButton : null,
      querySelectorAll:() => [handButton,penButton],
    },
    view:{ classList:{ toggle:(name,value) => { viewClasses[name] = value; } } },
    updateEraserToolUI:() => calls.push("eraser-ui"),
    resetCanvasCursor:() => calls.push("cursor"),
  });
  assert.equal(result,true);
  assert.equal(bodyAttributes["data-canvas-mode"],"pen");
  assert.equal(viewClasses["hand-mode"],false);
  assert.deepEqual({handActive:handButton.active,handPressed:handButton.pressed,penActive:penButton.active,penPressed:penButton.pressed},{handActive:false,handPressed:"false",penActive:true,penPressed:"true"});
  assert.deepEqual(calls,["eraser-ui","cursor"]);
  const openAgent = agent.slice(agent.indexOf("function openCanvasAgent("),agent.indexOf("function closeCanvasAgent("));
  assert.match(openAgent,/syncCanvasModePresentation\(\)/);
  assert.doesNotMatch(openAgent,/setCanvasMode\(/);
});

test("PenEcho Agent launcher stays clickable while its status shell shows work", () => {
  const html = read("public/index.html"), css = read("public/style.css"), agent = read("src/client/app/canvas-agent-runtime.js");
  const syncTrigger = functionSource(agent, "canvasAgentSyncTriggerState");
  assert.match(syncTrigger, /busy = canvasAgent\.requestPending \|\| canvasAgent\.running[\s\S]*?canvasAgentControl\.classList\.toggle\("is-busy",busy\)[\s\S]*?canvasAgentControl\.setAttribute\("aria-busy",String\(busy\)\)/);
  assert.doesNotMatch(syncTrigger, /canvasAgentToggle\.setAttribute\("aria-busy"/);
  assert.doesNotMatch(syncTrigger, /canvasAgentPanel\.hidden/);
  const triggerState = {};
  vm.runInNewContext(`${syncTrigger};canvasAgentSyncTriggerState();`,{
    canvasAgent:{requestPending:true,running:false}, canvasAgentPanel:{hidden:false},
    canvasAgentControl:{
      classList:{toggle:(name,value)=>{triggerState.className=name;triggerState.busy=value;}},
      setAttribute:(name,value)=>{triggerState.attribute=name;triggerState.ariaBusy=value;},
    },
    canvasAgentSyncPromptSuggestions:()=>{},
  });
  assert.deepEqual(triggerState,{className:"is-busy",busy:true,attribute:"aria-busy",ariaBusy:"true"});
  const toggle = html.match(/<button id="canvasAgentToggle"[^>]*>/)?.[0] || "";
  assert.doesNotMatch(toggle, /(?:disabled|aria-disabled|aria-busy)=/);
  assert.match(agent, /canvasAgentToggle\.addEventListener\("click",\(\)=>canvasAgentPanel\.hidden\|\|!document\.body\.classList\.contains\("canvas-agent-open"\) \? openCanvasAgent\(\{focus:false\}\) : closeCanvasAgent\(\)\)/);
  assert.match(css, /\[data-pe-button\]\)\[aria-busy="true"\][^}]*pointer-events:\s*none/);
  assert.match(css, /@property --canvas-agent-busy-angle\s*\{[^}]*syntax:\s*"<angle>"[^}]*initial-value:\s*0deg/);
  assert.match(css, /\.canvas-agent-control\.is-busy > #canvasAgentToggle::after\s*\{[^}]*inset:\s*0[^}]*padding:\s*2px[^}]*background:\s*conic-gradient\(from var\(--canvas-agent-busy-angle\)[^}]*mask-composite:\s*exclude[^}]*animation:\s*canvas-agent-trigger-busy 1\.4s linear infinite/);
  assert.match(css, /@keyframes canvas-agent-trigger-busy\s*\{\s*to\s*\{\s*--canvas-agent-busy-angle:\s*360deg/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.canvas-agent-control\.is-busy > #canvasAgentToggle::after\s*\{[^}]*animation:\s*none/);
});

test("PenEcho Agent launcher uses ordered toolbar compaction before the toolbar wraps", () => {
  const html = read("public/index.html"), css = read("public/style.css"), core = read("src/client/app/core.js"), agent = read("src/client/app/canvas-agent-runtime.js");
  const toolbar = html.match(/<nav class="toolbar"[\s\S]*?<\/nav>/)?.[0] || "",
    syncLayout = functionSource(agent, "canvasAgentSyncToolbarLayout"),
    positionPopover = functionSource(core, "positionToolbarPopover"),
    updateEffort = functionSource(core, "updateEffortControl");
  assert.ok(toolbar.indexOf('class="tool-group primary-tools"') < toolbar.indexOf('id="canvasAgentToolbarHome"'));
  assert.match(toolbar, /id="canvasAgentToolbarHome"[\s\S]*?id="canvasAgentControl"[\s\S]*?id="canvasAgentToggle"/);
  assert.equal((html.match(/id="canvasAgentControl"/g) || []).length, 1);
  assert.match(updateEffort, /effort-label-full[\s\S]*?effort-label-short[\s\S]*?shortLabel\.textContent = shortLevel[\s\S]*?canvasAgentScheduleToolbarLayout/);
  assert.match(syncLayout, /canvasAgentToolbarHome\.append\(canvasAgentControl\)[\s\S]*?studio-toolbar-effort-compact[\s\S]*?canvasAgentToolbarOverflows\(\)[\s\S]*?studio-toolbar-controls-compact[\s\S]*?canvasAgentToolbarOverflows\(\)[\s\S]*?studio-toolbar-two-row[\s\S]*?return "two-row"/);
  assert.equal(syncLayout.indexOf("canvasAgentFrame.append(canvasAgentControl)", syncLayout.indexOf('body.classList.add("studio-toolbar-controls-compact")')), -1);
  assert.match(css, /studio-toolbar-effort-compact \.effort-label-full\s*\{[^}]*display:\s*none/);
  assert.match(css, /studio-toolbar-effort-compact \.effort-label-short\s*\{[^}]*display:\s*block/);
  assert.match(css, /studio-toolbar-controls-compact \.toolbar \.icon-button\s*\{[^}]*width:\s*27px/);
  assert.match(css, /canvas-agent-toolbar-home\s*\{[^}]*margin-left:\s*auto/);
  assert.match(css, /studio-toolbar-two-row\s*\{[^}]*--studio-toolbar-height:\s*68px/);
  assert.match(css, /studio-toolbar-two-row \.toolbar\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*28px 1px minmax\(0, 1fr\) max-content/);
  assert.match(css, /studio-toolbar-two-row \.tool-group\s*\{[^}]*flex-wrap:\s*wrap[^}]*row-gap:\s*2px/);
  assert.match(css, /studio-toolbar-two-row \.canvas-agent-toolbar-home\s*\{[^}]*grid-column:\s*4[^}]*justify-self:\s*end[^}]*margin-left:\s*0/);
  assert.match(css, /@media \(min-width: 901px\)[\s\S]*?:not\(\.studio-toolbar-two-row\) \.primary-tools\s*\{[^}]*gap:\s*0/);
  assert.match(css, /:not\(\.studio-toolbar-two-row\) \.primary-tools \.ai-tools-section\s*\{[^}]*gap:\s*2px/);
  assert.match(css, /:not\(\.studio-toolbar-two-row\) \.primary-tools \.mode-tools,[\s\S]*?\.primary-tools \.view-tools\s*\{[^}]*gap:\s*0/);
  assert.match(css, /\.primary-tools \.view-tools\s*\{\s*gap:\s*8px/);
  assert.match(css, /@media \(min-width: 901px\) and \(pointer: fine\)[\s\S]*?\.primary-tools \.mode-tools :is/);
  assert.match(css, /\.primary-tools \.mode-tools :is\(#pe-button-contract, button\[data-pe-button="toolbar"\]\)[\s\S]*?margin-inline:\s*2px/);
  assert.match(positionPopover, /studio-toolbar-two-row[\s\S]*?Math\.max\(controlRect\.bottom, toolbarRect\.bottom\)[\s\S]*?anchorBottom/);
});

test("Studio title bar removes only the PenEcho icon and keeps the wordmark", () => {
  const html = read("public/index.html"), css = read("public/style.css");
  const brand = html.indexOf('class="brand"'), documentMeta = html.indexOf('id="canvasDocumentMeta"'), status = html.indexOf('id="aiStatusArea"'),
    toolbar = html.indexOf('class="toolbar"'), navigatorToggle = html.indexOf('id="studioNavigatorToggle"'), divider = html.indexOf('class="toolbar-leading-divider"'), primaryTools = html.indexOf('class="tool-group primary-tools"');
  assert.ok(brand < documentMeta && documentMeta < status && status < toolbar,"wordmark, document, and global status follow the title-row reading order");
  assert.match(html, /class="brand"[\s\S]*?class="brand-copy"[\s\S]*?<h1><span>Pen<\/span><strong>Echo<\/strong><\/h1>/);
  assert.doesNotMatch(html, /class="sigil"|<img src="penecho-mark\.png"/);
  assert.match(css, /body\[data-theme="studio"\] \.brand\s*\{[^}]*flex:\s*0 0 auto[^}]*margin-right:\s*0/);
});

test("Studio title bar exposes document identity, explicit save state, and a blank-canvas next step", () => {
  const html = read("public/index.html"), css = read("public/style.css"), navigator = read("src/client/app/studio-navigator.js"),
    persistence = read("src/client/app/persistence.js"), core = read("src/client/app/core.js"), zh = read("public/locales/zh.js");
  const brand = html.indexOf('class="brand"'), documentMeta = html.indexOf('id="canvasDocumentMeta"'), status = html.indexOf('id="aiStatusArea"'),
    toolbar = html.indexOf('class="toolbar"'), navigatorToggle = html.indexOf('id="studioNavigatorToggle"'), divider = html.indexOf('class="toolbar-leading-divider"'), primaryTools = html.indexOf('class="tool-group primary-tools"');
  assert.ok(brand < documentMeta && documentMeta < status && status < toolbar,"wordmark, document, and global status follow the title-row reading order");
  assert.ok(toolbar < navigatorToggle && navigatorToggle < divider && divider < primaryTools,"navigator and its divider lead the contextual toolbar");
  assert.match(html, /id="canvasDocumentMeta"[\s\S]*?id="canvasDocumentName"[\s\S]*?id="canvasDocumentSaveState"[^>]*data-state="unsaved"[\s\S]*?id="saveCanvasBtn"/);
  assert.match(html, /id="canvasDocumentName"[^>]*type="button"[^>]*data-i18n-aria="canvasRenameCurrent"/);
  assert.match(html, /id="canvasDocumentNameEditor"[^>]*hidden[\s\S]*?id="canvasDocumentNameInput"[^>]*maxlength="48"[^>]*hidden[\s\S]*?id="canvasDocumentNameConfirm"[^>]*type="button"[^>]*data-i18n-aria="canvasRenameConfirm"[^>]*data-pe-button="toolbar"/);
  assert.doesNotMatch(html, /id="canvasFileActions"[\s\S]*?id="saveCanvasBtn"[\s\S]*?<\/span>/);
  assert.match(html, /id="canvasWelcome"[^>]*hidden[\s\S]*?canvasWelcomeKicker[\s\S]*?canvasWelcomeTitle[\s\S]*?canvasWelcomeBody/);
  assert.match(css, /body\[data-theme="studio"\] \.toolbar\s*\{[^}]*column-gap:\s*6px/);
  assert.match(css, /body\[data-theme="studio"\] \.toolbar > \.studio-navigator-toggle::before\s*\{[^}]*inset:\s*-2px/);
  assert.match(css, /body\[data-theme="studio"\] \.toolbar > \.studio-navigator-toggle\.active\s*\{[^}]*background:\s*var\(--studio-accent-soft\)[^}]*box-shadow:\s*none/);
  assert.match(css, /body\[data-theme="studio"\] \.toolbar-leading-divider\s*\{[^}]*width:\s*1px[^}]*height:\s*24px[^}]*background:\s*var\(--studio-line\)/);
  assert.match(css, /\.canvas-document-save-state\[data-state="saved"\][\s\S]*?\.canvas-document-save-state\[data-state="edited"\][\s\S]*?\.canvas-document-save-state\[data-state="saving"\]/);
  assert.match(html, /class="canvas-welcome-kicker"[\s\S]*?<svg viewBox="0 0 24 12" aria-hidden="true"><path d="M1\.5 6h20M16\.5 1\.5 21 6l-4\.5 4\.5"\/>/);
  assert.match(css, /body\[data-theme="studio"\] \.canvas-frame\s*\{[^}]*--studio-navigator-width:\s*248px[^}]*--studio-agent-edge-shift:\s*0px[^}]*--studio-navigator-edge-shift:\s*0px/);
  assert.match(css, /studio-agent-docked\.canvas-agent-open \.canvas-frame\s*\{[^}]*--studio-agent-edge-shift:\s*calc\(var\(--studio-agent-width\) - 4px\)/);
  assert.match(css, /studio-navigator-open \.canvas-frame\s*\{[^}]*--studio-navigator-edge-shift:\s*var\(--studio-navigator-width\)/);
  assert.match(css, /body\[data-theme="studio"\] \.canvas-frame\s*\{[^}]*--studio-agent-width:\s*clamp\(360px, var\(--canvas-agent-width, 390px\), min\(calc\(100% - 16px - var\(--studio-navigator-edge-shift\)\), 50%\)\)/);
  assert.doesNotMatch(css, /studio-navigator-open\.studio-agent-docked\.canvas-agent-open[^}]*--studio-agent-width:\s*336px/);
  assert.match(css, /body\[data-theme="studio"\] \.canvas-welcome\s*\{[^}]*inset:\s*var\(--studio-toolbar-height\) var\(--studio-agent-edge-shift\) 0 var\(--studio-navigator-edge-shift\)[^}]*align-content:\s*center[^}]*pointer-events:\s*none/);
  assert.match(css, /body\[data-theme="studio"\] \.canvas-welcome-kicker\s*\{[^}]*font:\s*600 2rem\/1\.05 var\(--pe-font-hand[^}]*letter-spacing:\s*\.015em[^}]*transform:\s*rotate\(-2deg\)/);
  assert.match(css, /html:lang\(zh\) body\[data-theme="studio"\] \.canvas-welcome-kicker\s*\{[^}]*font-family:\s*var\(--pe-font-ui[^}]*font-weight:\s*500[^}]*letter-spacing:\s*normal[^}]*transform:\s*none/);
  assert.doesNotMatch(css, /\.canvas-welcome-kicker::after/);
  const updateDocument = functionSource(navigator, "updateStudioDocumentState");
  assert.match(updateDocument, /currentCanvasDisplayName\(\) \|\| t\("canvasUntitledName"\)/);
  assert.match(updateDocument, /canvasHasUnsavedChanges\(\) \|\| Boolean\(state\.currentCanvasSuggestedName\)/);
  assert.match(updateDocument, /snapshotSaveInProgress \? "saving" : !saved \? "unsaved" : edited \? "edited" : "saved"/);
  assert.match(updateDocument, /canvasWelcome\.hidden = !active \|\| state\.viewMode \|\| studioCanvasHasContent\(\)/);
  assert.match(css, /\.canvas-document-name-editor\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 28px/);
  assert.match(css, /\.canvas-document-name-confirm\s*\{[^}]*grid-area:\s*1 \/ 2[^}]*margin:\s*0/);
  assert.match(functionSource(navigator, "beginCanvasDocumentRename"), /canvasDocumentName\.hidden = true[\s\S]*?canvasDocumentNameEditor\.hidden = false[\s\S]*?canvasDocumentNameInput\.hidden = false[\s\S]*?select\(\)/);
  assert.match(functionSource(navigator, "commitCanvasDocumentRename"), /trim\(\)\.slice\(0, 48\)[\s\S]*?canvasDocumentNameConfirm\.disabled = true[\s\S]*?renameCurrentCanvasFromTitle\(name\)[\s\S]*?finishCanvasDocumentRename/);
  assert.match(navigator, /canvasDocumentNameEditor\.addEventListener\("focusout",[\s\S]*?contains\(event\.relatedTarget\)[\s\S]*?commitCanvasDocumentRename/);
  assert.match(navigator, /canvasDocumentNameConfirm\.addEventListener\("click",[\s\S]*?commitCanvasDocumentRename/);
  assert.match(navigator, /event\.key === "Enter" && !event\.isComposing[\s\S]*?commitCanvasDocumentRename/);
  assert.match(functionSource(persistence, "renameCurrentCanvasFromTitle"), /saveSnapshot\(\{ overwriteId, name, location, allowEmpty:true \}\)[\s\S]*?canvasRenamed/);
  assert.match(functionSource(persistence, "save"), /PenEchoStudioNavigator\?\.updateDocument/);
  assert.match(persistence, /async function saveSnapshot\([\s\S]*?setStatusKey\(overwriteId \? "snapshotOverwritten" : "snapshotSaved"\);[\s\S]*?PenEchoStudioNavigator\?\.updateDocument/);
  assert.match(persistence, /async function loadSnapshot\([\s\S]*?state\.currentSnapshotName = snapshotName\(item\);[\s\S]*?PenEchoStudioNavigator\?\.updateDocument/);
  assert.match(persistence, /state\.currentSnapshotName = snapshotName\(item\);[\s\S]*?state\.currentSnapshotHasExplicitName = Boolean\(String\(item\.name\|\|""\)\.trim\(\)\);[\s\S]*?state\.currentCanvasSuggestedName = ""/);
  assert.match(functionSource(persistence, "saveCurrentCanvas"), /name = requestedName \|\| currentCanvasDisplayName\(\)/);
  assert.match(functionSource(persistence, "startBlankCanvas"), /PenEchoStudioNavigator\?\.updateDocument/);
  for (const key of ["canvasUntitledName", "canvasRename", "canvasRenameCurrent", "canvasRenameNamed", "canvasRenameConfirm", "canvasNamePlaceholder", "canvasNameRequired", "canvasRenamed", "canvasSaveStateUnsaved", "canvasSaveStateSaved", "canvasSaveStateEdited", "canvasSaveStateSaving", "canvasWelcomeKicker", "canvasWelcomeTitle", "canvasWelcomeBody"]) {
    assert.match(core, new RegExp(`\\b${key}:\\s*"`));
    assert.match(zh, new RegExp(`\\b${key}:\\s*"`));
  }
});

test("Studio navigator groups recent Agent sessions by canvas and opens the bound canvas first", () => {
  const html = read("public/index.html"), css = read("public/style.css"), navigator = read("src/client/app/studio-navigator.js"),
    persistence = read("src/client/app/persistence.js"), agent = read("src/client/app/canvas-agent-runtime.js"),
    build = read("scripts/build-client.js"), app = read("public/app.js"), zh = read("public/locales/zh.js");
  assert.match(html, /id="studioNavigatorToggle"[^>]*aria-controls="studioNavigator"/);
  assert.match(html, /id="studioNavigator"[^>]*aria-labelledby="studioNavigatorTitle"[\s\S]*?id="studioNavigatorAllPanel"[\s\S]*?id="studioNavigatorAgentPanel"[\s\S]*?id="studioNavigatorCanvasPanel"/);
  assert.match(html, /id="studioNavigatorSearch"[^>]*type="search"/);
  assert.match(build, /src\/client\/app\/studio-navigator\.js/);
  assert.match(navigator, /let studioNavigatorOpenPreference = false/);
  assert.doesNotMatch(navigator, /STUDIO_NAVIGATOR_OPEN_KEY|penecho-studio-navigator-open/);
  assert.match(functionSource(navigator, "studioNavigatorWorkGroups"), /canvasAgentStoredHistoryGroups\(\)[\s\S]*?studioNavigatorSnapshots\(\)[\s\S]*?sort\(\(a,b\)=>Number\(b\.current\)-Number\(a\.current\)\|\|studioCanvasOpenedAt\(b\.canvasKey\)-studioCanvasOpenedAt\(a\.canvasKey\)\|\|Number\(Boolean\(b\.documentId\)\)-Number\(Boolean\(a\.documentId\)\)\|\|b\.updatedAt-a\.updatedAt\)/);
  assert.match(navigator, /className="studio-navigator-group"[\s\S]*?className="studio-navigator-group-conversations"/);
  assert.match(functionSource(navigator, "studioNavigatorCanvasGroupSnapshot"), /snapshotItemsLocation===identity\.location[\s\S]*?snapshotItems\.find\(candidate=>candidate\.id===identity\.id\)[\s\S]*?studioNavigatorCanvasGroupSnapshots\.set\(key,item\)/);
  assert.match(functionSource(navigator, "studioNavigatorLoadDraftSnapshot"), /await snapshotPreviewBlob\(\)[\s\S]*?request\.canvasKey===state\.canvasAgentCanvasKey[\s\S]*?studioNavigatorDraftSnapshot\.item=\{id:request\.canvasKey,preview\}/);
  assert.match(functionSource(navigator, "studioNavigatorQueueDraftSnapshot"), /canvasKey\.startsWith\("draft:"\)[\s\S]*?studioNavigatorLoadDraftSnapshot\(request\)/);
  assert.match(functionSource(navigator, "studioNavigatorQueueCanvasGroupSnapshots"), /snapshotListInProgress[\s\S]*?studioNavigatorCanvasGroupSnapshotLoads\.get\(location\)[\s\S]*?studioNavigatorLoadCanvasGroupSnapshots\(location,request\)/);
  assert.match(functionSource(navigator, "studioNavigatorLoadCanvasGroupSnapshots"), /await snapshotsAt\(location\)[\s\S]*?studioNavigatorCanvasGroupSnapshots\.set\(key,item\)[\s\S]*?renderStudioAgentHistory\(\)/);
  const conversationEntry=functionSource(navigator,"studioNavigatorConversationEntry");
  assert.match(conversationEntry, /className="studio-navigator-conversation-name"[\s\S]*?title\.textContent=conversationName[\s\S]*?body\.append\(title\);row\.append\(body\)/);
  assert.doesNotMatch(conversationEntry, /studio-navigator-item-icon agent|studio-navigator-item-summary|studioNavigatorMessageCount|studioNavigatorMetaTime\(conversation/);
  const renderCanvasHistory=functionSource(navigator,"renderStudioCanvasHistory");
  assert.match(navigator, /meta\.textContent = \[current \? t\("studioNavigatorCurrent"\) : "", location \? snapshotLocationLabel\(location\) : "", studioNavigatorMetaTime\(updatedAt\)\]/);
  assert.doesNotMatch(navigator, /studioNavigatorCurrentStateLabel|meta\.textContent=\[[^\n]*studioNavigatorSessionCount/);
  assert.match(renderCanvasHistory, /studioNavigatorRenderCanvasMeta\(meta,current,Boolean\(workspaceDoc\),item\.location,item\.updatedAt \|\| item\.createdAt\)/);
  assert.doesNotMatch(renderCanvasHistory, /canvasAgentHistoryCurrent/);
  const renderAgentHistory=functionSource(navigator, "renderStudioAgentHistory"), renderWorkHistory=functionSource(navigator,"renderStudioWorkHistory");
  assert.match(renderAgentHistory, /studioNavigatorWorkGroups\(\)[\s\S]*?conversations:query\?group\.conversations\.filter/);
  assert.match(renderAgentHistory, /releaseStudioNavigatorPreviewUrls\(studioNavigatorAgentPreviewUrls\)[\s\S]*?studioNavigatorQueueCanvasGroupSnapshots\(groups\)[\s\S]*?studioNavigatorGroupSection\(group,\{previewUrls:studioNavigatorAgentPreviewUrls\}\)/);
  assert.match(renderWorkHistory, /studioNavigatorWorkGroups\(\)[\s\S]*?studioNavigatorSectionLabel\("studioNavigatorCurrent"\)[\s\S]*?studioNavigatorSectionLabel\("studioNavigatorRecent"\)/);
  const navigatorCanvasPreview=functionSource(navigator, "studioNavigatorCanvasPreview");
  assert.match(navigatorCanvasPreview, /item\?\.preview instanceof Blob[\s\S]*?urls\.set\(url, image\)[\s\S]*?image\.onerror[\s\S]*?urls\.delete\(url\)/);
  assert.doesNotMatch(navigatorCanvasPreview, /image\.onload\s*=/);
  const releaseNavigatorPreviewUrls=functionSource(navigator,"releaseStudioNavigatorPreviewUrls"),
    revokeNavigatorPreviewUrlWhenSettled=functionSource(navigator,"revokeStudioNavigatorPreviewUrlWhenSettled");
  assert.match(releaseNavigatorPreviewUrls, /entries = \[\.\.\.urls\][\s\S]*?urls\.clear\(\)[\s\S]*?queueMicrotask[\s\S]*?revokeStudioNavigatorPreviewUrlWhenSettled\(url, image\)/);
  assert.match(revokeNavigatorPreviewUrlWhenSettled, /image\.complete[\s\S]*?addEventListener\("load", revoke\)[\s\S]*?addEventListener\("error", revoke\)/);
  assert.match(navigator, /className="studio-navigator-conversation-entry"[\s\S]*?className="studio-navigator-session-delete"/);
  assert.match(functionSource(navigator, "openStudioSessionDeleteDialog"), /studioSessionDeletePending=[\s\S]*?studioSessionDeleteDialog\.showModal\(\)[\s\S]*?studioSessionDeleteCancel\.focus/);
  assert.match(functionSource(navigator, "confirmStudioSessionDelete"), /canvasAgentDeleteStoredConversation\(studioSessionDeletePending\.canvasKey,studioSessionDeletePending\.conversationId\)/);
  assert.match(functionSource(navigator, "openStudioConversation"), /requestLoadSnapshot\(identity\.id,identity\.location\)/);
  assert.match(functionSource(navigator, "openStudioConversationOnCurrentCanvas"), /canvasAgentHistoryForCanvas\(pending\.canvasKey\)[\s\S]*?openCanvasAgent\(\{focus:false,connect:false\}\)[\s\S]*?canvasAgentViewStoredConversation\(conversation\.id\)/);
  const collapseNavigator = functionSource(navigator, "collapseStudioNavigatorForWorkspaceFocus");
  assert.match(collapseNavigator, /studioNavigatorIsOpen\(\)[\s\S]*?studioNavigator\.contains\(target\)[\s\S]*?studioNavigatorToggle\.contains\(target\)[\s\S]*?setStudioNavigatorOpen\(false\)/);
  assert.doesNotMatch(functionSource(navigator, "collapseStudioNavigatorForWorkspaceFocus"), /studioNavigatorIsCompact\(\)/);
  assert.match(navigator, /document\.addEventListener\("pointerdown", collapseStudioNavigatorForWorkspaceFocus, true\)/);
  assert.match(navigator, /document\.addEventListener\("focusin", collapseStudioNavigatorForWorkspaceFocus\)/);
  assert.doesNotMatch(navigator, /(?:view|canvasAgentPanel)\.addEventListener\("(?:pointerdown|focusin)", collapseStudioNavigatorForWorkspaceFocus/);
  assert.match(functionSource(navigator, "studioNavigatorCanvasDidLoad"), /openStudioConversationOnCurrentCanvas\(studioNavigatorPendingConversation\)/);
  assert.match(functionSource(navigator,"renderStudioCanvasHistory"), /studioNavigatorSnapshots\(\)[\s\S]*?requestLoadSnapshot\(item\.id, item\.location\)/);
  assert.match(navigator, /openHistoryPanel\(\)/);
  assert.match(functionSource(navigator, "updateStudioNavigatorSurfaceInert"), /studioNavigatorIsCompact\(\)[\s\S]*?view\.inert = true[\s\S]*?dataset\.studioNavigatorInert[\s\S]*?view\.inert = false/);
  assert.match(functionSource(navigator,"handleStudioNavigatorCompactChange"), /studioNavigatorIsOpen\(\)[\s\S]*?studioNavigatorIsCompact\(\)\)suspendStudioAgentForNavigator\(\)[\s\S]*?restoreStudioAgentAfterNavigator\(\)/);
  assert.match(functionSource(navigator,"studioNavigatorAgentWillOpen"), /studioNavigatorIsCompact\(\)[\s\S]*?setStudioNavigatorOpen\(false,\{restoreAgent:false\}\)/);
  const setNavigatorOpen=navigator.slice(navigator.indexOf("function setStudioNavigatorOpen("),navigator.indexOf("function syncStudioNavigatorTheme(")), scheduleNavigatorOpen=functionSource(navigator,"scheduleStudioNavigatorOpenWork"), renderNavigator=functionSource(navigator,"renderStudioNavigator"), syncNavigatorTheme=functionSource(navigator,"syncStudioNavigatorTheme");
  assert.match(setNavigatorOpen, /classList\.toggle\("studio-navigator-open"[\s\S]*?updateStudioNavigatorA11y\(\{ deferSurface:studioNavigatorIsStudio\(\) \}\)[\s\S]*?scheduleStudioNavigatorOpenWork\(open, \{ restoreAgent \}\)/);
  assert.doesNotMatch(setNavigatorOpen, /renderStudioNavigator\(|refreshStudioNavigatorSources\(/);
  assert.match(scheduleNavigatorOpen, /property = studioNavigatorIsMcpDocked\(\) \? "opacity" : "transform"[\s\S]*?propertyName === property[\s\S]*?addEventListener\("transitionend"[\s\S]*?setTimeout\(settle, STUDIO_NAVIGATOR_SETTLE_FALLBACK_MS\)/);
  assert.match(scheduleNavigatorOpen, /updateStudioNavigatorA11y\(\)[\s\S]*?renderStudioNavigator\(\)[\s\S]*?refreshStudioNavigatorSources\(\)/);
  assert.doesNotMatch(scheduleNavigatorOpen, /studioNavigatorSearch\.focus/);
  assert.match(renderNavigator, /setStudioNavigatorTab\(studioNavigatorActiveTab, \{ persist:false \}\)/);
  assert.doesNotMatch(renderNavigator, /renderStudioWorkHistory\(|renderStudioAgentHistory\(|renderStudioCanvasHistory\(/);
  assert.match(syncNavigatorTheme, /wasActive = document\.body\.classList\.contains\("studio-navigator-enabled"\)[\s\S]*?if \(active && !wasActive\) renderStudioNavigator\(\)/);
  assert.doesNotMatch(navigator, /canvasAgentBeginLocalConversation|canvasAgentStartNewConversation/);
  assert.match(persistence, /function snapshotItemsForCurrentView\(\)/);
  assert.match(functionSource(persistence, "renderStudioSnapshotLists"), /PenEchoStudioNavigator\?\.render\?\.\(\)/);
  assert.doesNotMatch(functionSource(persistence, "renderStudioSnapshotLists"), /renderWork|renderCanvases|renderAgent/);
  const renderActiveNavigator=functionSource(navigator,"renderActiveStudioNavigatorHistory"),
    refreshNavigatorSource=navigator.slice(navigator.indexOf("async function refreshStudioNavigatorSource("),navigator.indexOf("function refreshStudioNavigatorSources("));
  assert.match(renderActiveNavigator, /studioNavigatorActiveTab==="canvas"[\s\S]*?renderStudioCanvasHistory\(\)[\s\S]*?studioNavigatorActiveTab==="agent"[\s\S]*?renderStudioAgentHistory\(\)[\s\S]*?renderStudioWorkHistory\(\)/);
  assert.doesNotMatch(refreshNavigatorSource, /renderStudioWorkHistory\(\)[\s\S]*?renderStudioCanvasHistory\(\)|renderStudioCanvasHistory\(\)[\s\S]*?renderStudioAgentHistory\(\)/);
  assert.match(functionSource(persistence, "renderSnapshotList"), /renderStudioSnapshotLists\(\)[\s\S]*?renderStudioSnapshotLists\(\)/);
  assert.match(persistence, /wantsConversationForCanvas\?\.\(\{ id:item\.id, location \}\)[\s\S]*?deferConversationStart:restoreStudioConversation/);
  assert.match(functionSource(agent, "canvasAgentCanvasDidChange"), /deferConversationStart[\s\S]*?!deferConversationStart&&/);
  assert.match(agent, /function canvasAgentStoredHistoryGroups\(\)/);
  assert.match(agent, /PenEchoStudioNavigator\?\.renderAgent/);
  assert.match(css, /body\[data-theme="studio"\] \.studio-navigator\s*\{[^}]*position:\s*absolute[^}]*inset:\s*var\(--studio-toolbar-height\) auto 0 0[^}]*width:\s*var\(--studio-navigator-width\)[^}]*flex:\s*0 0 auto[^}]*border-right:\s*0[^}]*background:\s*var\(--studio-glass\)[^}]*box-shadow:\s*4px 0 8px var\(--studio-chrome-shadow-color\)[^}]*backdrop-filter:\s*saturate\(1\.15\) blur\(20px\)/);
  assert.match(css, /@media \(max-width: 1100px\)[\s\S]*?\.studio-navigator\s*\{[^}]*z-index:\s*45[^}]*box-shadow:\s*4px 0 8px var\(--studio-chrome-shadow-color\)/);
  assert.match(css, /@media \(max-width: 1100px\)[\s\S]*?\.studio-navigator-scrim\s*\{[^}]*z-index:\s*44[^}]*background:\s*rgba\(20, 24, 34, \.16\)/);
  assert.match(css, /not\(\.studio-navigator-open\) \.studio-navigator\s*\{[^}]*transform:\s*translateX\(-100%\)/);
  assert.match(css, /\.studio-navigator-group-heading \.studio-navigator-item-icon\.canvas\s*\{[^}]*width:\s*40px[^}]*height:\s*28px[^}]*flex-basis:\s*40px/);
  assert.match(css, /\.studio-navigator-group-heading \.studio-navigator-item-icon\.canvas img\s*\{[^}]*object-fit:\s*contain/);
  assert.match(css, /\.studio-navigator-group-conversations\s*\{[^}]*border-left:\s*1px solid/);
  assert.match(css, /\.studio-navigator-conversation\s*\{[^}]*min-height:\s*36px[^}]*padding:\s*2px 36px 2px 8px/);
  assert.match(css, /\.studio-navigator-foot\s*\{[^}]*width:\s*var\(--studio-navigator-width\)[^}]*min-width:\s*0[^}]*margin:\s*0[^}]*overflow:\s*visible/);
  assert.match(css, /\.studio-navigator-item-body strong\s*\{[^}]*font:\s*500 13px\/1\.25 var\(--studio-ui-font/);
  assert.match(css, /\.studio-navigator-conversation-name\s*\{[^}]*text-overflow:\s*clip !important[^}]*mask-image:\s*linear-gradient\(to right,/);
  assert.match(css, /\.studio-navigator-item-body strong[\s\S]*?color:\s*var\(--pe-ink\)[\s\S]*?\.studio-navigator-item-body small\s*\{[^}]*color:\s*var\(--pe-ink-3\)/);
  assert.match(css, /#studioNavigatorManage\[data-pe-button="ghost"\][^}]*\{[^}]*flex:\s*0 0 auto[^}]*width:\s*auto[^}]*margin-left:\s*auto/);
  assert.match(html, /id="studioNavigatorManage"[^>]*data-pe-button="ghost"/);
  assert.doesNotMatch(css, /\.studio-navigator-item-icon\.agent|\.studio-navigator-item-summary/);
  assert.match(css, /\.studio-navigator-session-delete\s*\{[^}]*width:\s*36px[^}]*height:\s*36px[^}]*opacity:\s*0[^}]*pointer-events:\s*none/);
  assert.match(css, /\.studio-navigator-conversation-entry:focus-within \.studio-navigator-session-delete\s*\{[^}]*opacity:\s*1[^}]*pointer-events:\s*auto/);
  assert.match(css, /\.studio-session-delete-dialog\s*\{[^}]*width:\s*min\(400px,[^}]*border-radius:\s*14px/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*?\.studio-navigator\s*\{\s*transition:\s*none/);
  for (const key of ["studioNavigatorTitle", "studioNavigatorAll", "studioNavigatorAgents", "studioNavigatorCanvases", "studioNavigatorCurrent", "studioNavigatorRecent", "studioNavigatorManageCanvases", "studioNavigatorSessionCount", "studioNavigatorCanvasUnavailable", "studioNavigatorDeleteSession", "studioNavigatorDeleteSessionAction", "studioNavigatorDeleteSessionConfirm"]) {
    assert.match(app, new RegExp(`\\b${key}:\\s*"`));
    assert.match(zh, new RegExp(`\\b${key}:\\s*"`));
  }
});

test("Studio tablet edge swipes open the left and right sidebars without taking mouse or pen input", () => {
  const navigator = read("src/client/app/studio-navigator.js"),
    side = functionSource(navigator, "studioEdgeSwipeSide"),
    move = functionSource(navigator, "moveStudioEdgeSwipe");
  assert.match(navigator, /STUDIO_EDGE_SWIPE_START_PX = 28,[\s\S]*?STUDIO_EDGE_SWIPE_COMMIT_PX = 56,[\s\S]*?STUDIO_EDGE_SWIPE_DIRECTION_RATIO = 1\.25/);
  assert.match(side, /event\.pointerType !== "touch"/);
  assert.match(side, /event\.isPrimary === false/);
  assert.match(side, /state\.viewMode \|\| !studioNavigatorIsStudio\(\)/);
  assert.match(side, /studioEdgeSwipeInteractiveTarget\(event\.target\)/);
  assert.match(side, /leftInset >= 0[\s\S]*?!studioNavigatorIsOpen\(\)[\s\S]*?return "left"/);
  assert.match(side, /rightInset >= 0[\s\S]*?canvasAgentAvailable\(\)[\s\S]*?canvasAgentPanel\.hidden[\s\S]*?canvasAgentDockedPanel\(\)[\s\S]*?return "right"/);
  assert.match(move, /inward < STUDIO_EDGE_SWIPE_COMMIT_PX \|\| inward < deltaY \* STUDIO_EDGE_SWIPE_DIRECTION_RATIO/);
  assert.match(move, /setStudioNavigatorOpen\(true\)[\s\S]*?openCanvasAgent\(\{ focus:false \}\)/);
  assert.match(navigator, /view\.addEventListener\("pointerdown", beginStudioEdgeSwipe, true\)[\s\S]*?view\.addEventListener\("pointercancel", finishStudioEdgeSwipe, true\)/);
  assert.match(navigator, /studioNavigatorToggle\.addEventListener\("click"/);
});

test("stored Agent sessions can be deleted individually without touching sibling sessions", () => {
  const agent = read("src/client/app/canvas-agent-runtime.js"), writes = [], context = {
    canvasAgent:{projectId:"",currentConversation:{id:"keep"},requestPending:false,running:false},
    state:{canvasAgentCanvasKey:"device:canvas-a"},
    canvasAgentReadHistoryStore:() => ({
      version:1,
      canvasMeta:{"device:canvas-a":{name:"Canvas A",updatedAt:30}},
      canvases:{"device:canvas-a":[{id:"delete",updatedAt:30,items:[{}]},{id:"keep",updatedAt:20,items:[{}]}]},
    }),
    canvasAgentNormalizeConversation:(value) => value,
    canvasAgentRememberCanvasMeta:(store,key,value) => { store.canvasMeta[key]={name:value.name,updatedAt:value.updatedAt}; },
    canvasAgentBeginLocalConversation:() => { throw Error("a sibling deletion must not reset the current session"); },
    canvasAgentDropSessionIdentity:() => {},
    canvasAgentSetStatus:() => {},
    canvasAgentRenderHistoryList:() => {},
    t:(key) => key,
    localStorage:{setItem:(key,value) => writes.push([key,JSON.parse(value)])},
    CANVAS_AGENT_HISTORY_KEY:"history",
    result:null,
  };
  vm.runInNewContext(`${functionSource(agent,"canvasAgentDeleteStoredConversation")};result=canvasAgentDeleteStoredConversation("device:canvas-a","delete");`,context);
  assert.equal(context.result.deleted,true);
  assert.deepEqual(writes[0][1].canvases["device:canvas-a"].map(item=>item.id),["keep"]);
  assert.equal(writes[0][1].canvasMeta["device:canvas-a"].updatedAt,20);
});

test("deleting the current stored Agent session is blocked while busy and resets only after deletion", () => {
  const agent = read("src/client/app/canvas-agent-runtime.js"), writes = [], calls = [], context = {
    canvasAgent:{projectId:"",currentConversation:{id:"current"},requestPending:true,running:false},
    state:{canvasAgentCanvasKey:"device:canvas-a"},
    canvasAgentReadHistoryStore:() => ({version:1,canvasMeta:{"device:canvas-a":{name:"Canvas A",updatedAt:30}},canvases:{"device:canvas-a":[{id:"current",updatedAt:30,items:[{}]}]}}),
    canvasAgentNormalizeConversation:(value) => value,
    canvasAgentRememberCanvasMeta:() => {},
    canvasAgentBeginLocalConversation:(options) => calls.push(["begin",options]),
    canvasAgentDropSessionIdentity:() => calls.push(["drop"]),
    canvasAgentSetStatus:(text,status) => calls.push(["status",text,status]),
    canvasAgentRenderHistoryList:() => calls.push(["render"]),
    t:(key) => key,
    localStorage:{setItem:(key,value) => writes.push([key,JSON.parse(value)])},
    CANVAS_AGENT_HISTORY_KEY:"history",
    first:null,
    second:null,
  };
  vm.runInNewContext(`${functionSource(agent,"canvasAgentDeleteStoredConversation")};first=canvasAgentDeleteStoredConversation("device:canvas-a","current");canvasAgent.requestPending=false;second=canvasAgentDeleteStoredConversation("device:canvas-a","current");`,context);
  assert.equal(context.first.reason,"busy");
  assert.equal(context.second.deleted,true);
  assert.equal(writes.length,1);
  assert.equal(writes[0][1].canvases["device:canvas-a"],undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])),["begin",{persistCurrent:false}]);
  assert.deepEqual(calls.slice(1),[["drop"],["status","canvasAgentReadyConnect","ready"]]);
});

test("stored Agent canvas groups and their conversations are newest first", () => {
  const agent = read("src/client/app/canvas-agent-runtime.js"), context = {
    CANVAS_AGENT_HISTORY_LIMIT:5,
    canvasAgentReadHistoryStore:() => ({
      version:1,
      canvasMeta:{"device:older":{name:"Older",updatedAt:20},"device:newer":{name:"Newer",updatedAt:90}},
      canvases:{
        "device:older":[{id:"old",createdAt:10,updatedAt:20,title:"Old",items:[{}]}],
        "device:newer":[{id:"second",createdAt:40,updatedAt:70,title:"Second",items:[{}]},{id:"first",createdAt:50,updatedAt:90,title:"First",items:[{}]}],
      },
    }),
    canvasAgentNormalizeConversation:(value) => value,
    canvasAgentHistoryText:(value,limit) => String(value||"").slice(0,limit),
    result:null,
  };
  vm.runInNewContext(`${functionSource(agent,"canvasAgentStoredHistoryGroups")};result=canvasAgentStoredHistoryGroups();`,context);
  const groups=JSON.parse(JSON.stringify(context.result));
  assert.deepEqual(groups.map(group=>group.canvasKey),["device:newer","device:older"]);
  assert.deepEqual(groups[0].conversations.map(conversation=>conversation.id),["first","second"]);
  assert.equal(groups[0].name,"Newer");
});

test("the canvas fills the available browser viewport consistently across themes", () => {
  const css = read("public/style.css");
  assert.match(css, /main\s*\{[^}]*display:\s*flex;[^}]*width:\s*100%;[^}]*min-height:\s*100dvh;[^}]*flex-direction:\s*column;[^}]*max-width:\s*none/);
  assert.match(css, /\.canvas-frame\s*\{[^}]*display:\s*flex;[^}]*min-height:\s*0;[^}]*flex:\s*1 1 auto/);
  assert.match(css, /#viewport\s*\{[^}]*height:\s*auto;[^}]*min-height:\s*440px;[^}]*flex:\s*1 1 auto/);
  assert.doesNotMatch(css, /#viewport\s*\{[^}]*(?:height:\s*(?:min\([^}]*vh|[0-9]+vh)|900px|960px)/);
  assert.doesNotMatch(css, /body\[data-theme="studio"\]\s+#viewport\s*\{[^}]*height:/);
  assert.match(css, /@media \(max-width:\s*620px\)\s*\{[\s\S]*?#viewport\s*\{\s*min-height:\s*380px;\s*\}/);
});

test("PNG export crops to all ink with one tile of padding at 1.5x browser-local download resolution", () => {
  const html = read("public/index.html"), app = read("public/app.js"), ink = functionSource(app, "exportInkBounds"), region = functionSource(app, "exportRegion"), render = functionSource(app, "renderExportCanvas"), run = functionSource(app, "exportCanvasPng");
  assert.match(ink, /inkBox\(tileCanvas/);
  assert.doesNotMatch(ink, /visibleInkBounds/);
  assert.match(region, /Math\.floor\(ink\.x\) - TILE/);
  assert.match(region, /Math\.ceil\(ink\.x \+ ink\.w\) \+ TILE/);
  assert.match(region, /Math\.ceil\(ink\.y \+ ink\.h\) \+ TILE/);
  assert.match(app, /CANVAS_DOWNLOAD_RESOLUTION_SCALE = 1\.5,[\s\S]*?EXPORT_MAX_DIMENSION = 16384,[\s\S]*?EXPORT_MAX_PIXELS = 64 \* 1024 \* 1024/);
  assert.doesNotMatch(app, /EXPORT_TARGET_SCALE|function exportPixelScale/);
  assert.match(render, /prepareVisibleWidgetSnapshots\(null, false, null, true\)/);
  assert.match(render, /scale = Math\.min\(CANVAS_DOWNLOAD_RESOLUTION_SCALE, EXPORT_MAX_DIMENSION \/ region\.w, EXPORT_MAX_DIMENSION \/ region\.h, Math\.sqrt\(EXPORT_MAX_PIXELS \/ \(region\.w \* region\.h\)\)\)/);
  assert.match(render, /offscreen\(Math\.max\(1, Math\.ceil\(region\.w \* scale\)\), Math\.max\(1, Math\.ceil\(region\.h \* scale\)\)\)/);
  assert.match(render, /imageSmoothingEnabled = true[\s\S]*?imageSmoothingQuality = "high"/);
  assert.match(render, /setTransform\(scale, 0, 0, scale, -region\.x \* scale, -region\.y \* scale\)/);
  assert.match(render, /state\.paint\.paper/);
  assert.match(render, /state\.gridVisible/);
  assert.match(render, /for \(const \[tileKey, tileCanvas\] of tiles\)/);
  assert.match(render, /selection\?\.phase === "active"/);
  assert.match(run, /canvasBlob\(canvas\)/);
  assert.match(run, /URL\.createObjectURL\(blob\)[\s\S]*?link\.click\(\)/);
  assert.doesNotMatch(run,/\bfetch\s*\(|XMLHttpRequest|WebSocket|\/api\/|cloud|relay/i);
  assert.match(run, /link\.download = exportFilename\(\)/);
  assert.match(app, /querySelector\("#exportPngBtn"\)\.onclick = exportCanvasPng/);
  assert.match(html, /id="exportPngBtn"[^>]*data-i18n-aria="exportPng"/);
});

test("Auto AI exposes a persisted zero-to-ten-second delay control", () => {
  const html = read("public/index.html"), app = read("public/app.js"), css = read("public/style.css");
  assert.match(html, /id="autoLabel">Auto \(5s\)<\/span>/);
  assert.match(html, /id="autoDelayRange"[^>]*min="0"[^>]*max="10"[^>]*step="0\.1"[^>]*value="5"/);
  assert.match(app, /DEFAULT_AUTO_DELAY = 5000/);
  assert.match(app, /autoEnabled:\s*"Auto \(\{delay\}s\)"/);
  assert.match(app, /penecho-auto-delay-ms/);
  assert.match(app, /penecho-auto-ai/);
  assert.match(app, /setTimeout\(hideAutoDelayControl,\s*5000\)/);
  assert.match(app, /if\s*\(state\.auto\)\s*setAutoEnabled\(false\)/);
  assert.match(app, /else\s*setAutoEnabled\(true,\s*true\)/);
  assert.match(css, /\.auto-delay-popover\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(css, /\.auto-delay-popover\s*\{[^}]*left:\s*0;[^}]*width:\s*190px/);
});

test("Auto AI waits for unsettled toolboxes while manual actions remain available", () => {
  const app = read("public/app.js"), zh = read("public/locales/zh.js"),
    unsettled = functionSource(app, "hasUnsettledToolbox"),
    launch = functionSource(app, "launchAutomaticAI"),
    schedule = functionSource(app, "schedule"),
    manual = functionSource(app, "invokeAIAction"),
    createText = functionSource(app, "createTextEditor");
  for (const toolbox of ["state.pending", "state.pendingGesture", "state.selection", "state.selectionGesture", "state.textEditors.size"]) assert.match(unsettled, new RegExp(toolbox.replace(".", "\\.")));
  assert.match(launch, /state\.mode === "hand"/);
  assert.match(schedule, /state\.mode === "hand"/);
  assert.match(launch, /if \(hasUnsettledToolbox\(\)\)/);
  assert.match(launch, /state\.statusKey !== "autoToolboxPending"/);
  assert.ok(launch.indexOf("hasUnsettledToolbox()") < launch.indexOf('requestAI("auto")'));
  assert.doesNotMatch(schedule, /textEditors|hasUnsettledToolbox/);
  assert.match(schedule, /setTimeout\(\(\) =>/);
  assert.doesNotMatch(createText, /clearTimeout\(state\.timer\)/);
  assert.match(createText, /if \(!state\.timer && state\.auto && state\.dirty && state\.autoEligible\) schedule\(\)/);
  assert.match(manual, /requestAI\(action,/);
  assert.doesNotMatch(manual, /hasUnsettledToolbox|autoToolboxPending/);
  assert.match(app, /autoToolboxPending:/);
  assert.match(zh, /autoToolboxPending:/);
});

test("toolbar exposes reasoning presets and an editable provider-native value before the drawing tools", () => {
  const html = read("public/index.html"), app = read("public/app.js"), css = read("public/style.css"), zh = read("public/locales/zh.js");
  const section = html.indexOf('id="aiToolsSection"'), auto = html.indexOf('id="autoControl"'), effort = html.indexOf('id="effortControl"'), font = html.indexOf('id="aiFont"'), pen = html.indexOf('data-mode="pen"'), fullscreen = html.indexOf('id="fullscreenBtn"'), grid = html.indexOf('id="gridToggle"');
  assert.ok(section < auto && auto < effort && effort < pen && pen < font);
  assert.ok(pen < fullscreen && fullscreen < grid);
  assert.match(html, /id="aiToolsSection"[^>]*data-i18n-aria="aiTools"[\s\S]*?class="ai-section-label"[^>]*>AI<\/span>/);
  assert.match(html, /<label[^>]*class="settings-row"[^>]*>[\s\S]*?<span data-i18n="aiFont">AI font<\/span>[\s\S]*?id="aiFont"/);
  assert.match(css, /\.ai-tools-section\s*\{/);
  assert.match(css, /\.view-tools\s*\{/);
  assert.match(html, /id="aiEffortButton"[^>]*aria-haspopup="listbox"/);
  const effortButton = html.match(/<button id="aiEffortButton"[\s\S]*?<\/button>/)?.[0] || "";
  assert.match(effortButton, />\s*<span id="aiEffortLabel">/);
  assert.equal((effortButton.match(/<svg/g) || []).length, 1);
  assert.match(html, /id="effortPopover"[^>]*hidden/);
  assert.equal((html.match(/class="effort-option"/g) || []).length, 6);
  assert.match(html, /data-effort="config"/);
  assert.match(html, /id="effortCustomForm"/);
  assert.match(html, /id="aiEffortCustomInput"[^>]*role="combobox"[^>]*aria-controls="effortOptions"[^>]*maxlength="128"[^>]*autocomplete="off"[^>]*autocapitalize="none"/);
  assert.match(html, /id="aiEffortCustomApply"[^>]*type="submit"/);
  for (const mode of ["pen", "eraser", "select"]) {
    const button = html.match(new RegExp(`<button[^>]*data-mode="${mode}"[\\s\\S]*?<\\/button>`))?.[0] || "";
    assert.match(button, /class="[^"]*icon-button[^"]*"/);
    assert.match(button, /data-i18n-aria=/);
    assert.match(button, /data-i18n-title=/);
    assert.doesNotMatch(button, /<span/);
  }
  assert.match(app, /penecho-ai-effort/);
  assert.match(app, /reasoningEffort === "config" \? \{\} : \{ reasoningEffort: state\.reasoningEffort \}/);
  assert.match(functionSource(app, "normalizeToolbarReasoningEffort"), /trim\(\)\.toLowerCase\(\)[\s\S]*?effort\.length <= 128[\s\S]*?\!\/\[\\r\\n\\0\]\//);
  assert.match(functionSource(app, "updateEffortControl"), /customInput\.value = levelKey \? "" : state\.reasoningEffort/);
  assert.match(app, /#effortCustomForm"\)\.onsubmit[\s\S]*?setEffort\(input\.value\)/);
  assert.match(app, /#aiEffortCustomInput"\)\.addEventListener\("input"[\s\S]*?input\.value\.toLowerCase\(\)/);
  assert.match(css, /\.effort-control\s*\{[^}]*width:\s*auto;[^}]*height:\s*var\(--pe-button-compact-h, 28px\);[^}]*flex:\s*0 0 auto/);
  assert.match(css, /\.toolbar \.effort-trigger\s*\{[^}]*width:\s*auto;[^}]*gap:\s*4px/);
  assert.match(css, /\.effort-trigger #aiEffortLabel\s*\{[^}]*min-width:\s*0;[^}]*flex:\s*0 1 auto;[^}]*white-space:\s*nowrap/);
  assert.match(css, /\.effort-label-full, \.effort-label-short\s*\{[^}]*display:\s*block;[^}]*max-width:\s*22ch;[^}]*text-overflow:\s*ellipsis/);
  assert.doesNotMatch(css, /\.effort-trigger > svg:first-child|\.effort-control\[data-effort="config"\] \.effort-trigger > svg:first-child/);
  assert.match(app, /function positionToolbarPopover\(controlSelector, popoverSelector, options\)[\s\S]*?host\.append\(popover\)[\s\S]*?getBoundingClientRect\(\)[\s\S]*?toolbar-anchored-popover/);
  assert.match(app, /showEffortControl\(\)[\s\S]*?positionToolbarPopover\("#effortControl", "#effortPopover"\)/);
  assert.match(app, /!document\.querySelector\("#effortControl"\)\.contains\(event\.target\) && !document\.querySelector\("#effortPopover"\)\.contains\(event\.target\)/);
  assert.match(css, /\.topbar > \.toolbar-anchored-popover\s*\{[^}]*z-index:\s*52/);
  assert.match(css, /\.effort-popover\s*\{[^}]*width:\s*190px[^}]*background:\s*color-mix\(in srgb, var\(--panel-raised\) 72%, transparent\)[^}]*blur\(28px\)/);
  assert.match(css, /\.effort-custom-form\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 30px[^}]*border-bottom:/);
  assert.match(css, /\.effort-custom-form input\s*\{[^}]*height:\s*30px[^}]*font:\s*500 \.72rem\/30px ui-monospace/);
  assert.match(css, /\.effort-option\s*\{[^}]*min-height:\s*28px[^}]*font:\s*550 12\.5px\/1\.2 system-ui[^}]*transition:/);
  assert.match(css, /body\[data-theme="studio"\] \.effort-popover,[^}]*background:\s*color-mix\(in srgb, var\(--studio-panel\) 62%, transparent\)[^}]*blur\(28px\)/);
  assert.match(css, /body\[data-theme="studio"\] \.effort-option\.active\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--studio-accent\) 10%, var\(--studio-panel\)\)/);
  assert.match(css, /@supports not \(\(-webkit-backdrop-filter:[\s\S]*?\.effort-popover,[\s\S]*?background:\s*var\(--panel-raised\)/);
  assert.doesNotMatch(css, /effort-slider-shell|effort-thumb|effort-dots/);
  for (const [type, popover] of [["ink", "inkColorPopover"], ["ai", "aiColorPopover"]]) {
    assert.match(html, new RegExp(`data-color-control="${type}"[\\s\\S]*?aria-haspopup="dialog"[^>]*aria-controls="${popover}"[\\s\\S]*?id="${popover}"[^>]*role="dialog"[^>]*hidden`));
    assert.match(app, new RegExp(`positionToolbarPopover\\('\\[data-color-control="${type}"\\]', "#${popover}", \\{ align:"center", gap:6 \\}\\)`));
  }
  assert.match(functionSource(app, "colorOrbitFor"), /getAttribute\("aria-controls"\)[\s\S]*?document\.getElementById\(id\)/);
  assert.match(css, /\.color-orbit\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(4, 28px\)[^}]*background:\s*color-mix\(in srgb, var\(--panel-raised\) 72%, transparent\)[^}]*blur\(28px\)/);
  assert.match(css, /\.color-orbit\[hidden\]\s*\{\s*display:\s*none/);
  assert.doesNotMatch(css, /\.color-orb-control\.open \.orbit-[1-8]/);
  for (const key of ["reasoningEffort", "reasoningEffortDisplay", "effortCustom", "effortCustomPlaceholder", "effortApplyCustom", "effortConfigured", "effortConfiguredShort", "effortNone", "effortLow", "effortMedium", "effortMediumShort", "effortHigh", "effortMaximum"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
});

test("custom ink and AI colors preserve presets and selection behavior", () => {
  const html = read("public/index.html"), app = read("public/app.js");
  for (const type of ["ink", "ai"]) {
    assert.equal((html.match(new RegExp(`data-${type}-color=`, "g")) || []).length, 8);
    assert.match(html, new RegExp(`type="text" data-custom-color="${type}"[^>]*aria-label="HEX"`));
    const swatches = ["#1f2937", "#2563eb"].map((color) => ({
      dataset: { inkColor: color, aiColor: color },
      classList: { toggle(name, value) { this[name] = value; } },
      setAttribute(name, value) { this[name] = value; },
    }));
    const selected = [], previews = [], style = {}, classes = new Set();
    const context = {
      type, state: { inkColor: "#1f2937", aiColor: "#2563eb", textEditors: new Map([["mixed", { mixedMode: true }]]) },
      COLOR_CLASS: { "#1f2937": "color-black", "#2563eb": "color-blue" },
      trigger: { classList: { remove(...names) { names.forEach((name) => classes.delete(name)); }, add(name) { assert.ok(name); classes.add(name); } }, style: { setProperty(name, value) { style[name] = value; } } },
      runtimeElementStyle:()=>({setProperty(name,value){style[name]=value}}),
      customInput: { value: "" }, orbit: { querySelectorAll() { return swatches; } },
      applySelectionColor(color) { selected.push(color); }, positionTextEditors() {},
      scheduleTextEditorPreview(editor) { previews.push(editor); },
    };
    const selectColor = vm.runInNewContext(`(${functionSource(app, "selectColor")})`, context);
    selectColor("#AA12EF");
    assert.equal(context.state[`${type}Color`], "#aa12ef");
    assert.equal(context.state[type === "ink" ? "aiColor" : "inkColor"], type === "ink" ? "#2563eb" : "#1f2937");
    assert.equal(context.customInput.value, "#aa12ef");
    assert.equal(style["--selected-color"], "#aa12ef");
    assert.ok(swatches.every((swatch) => swatch["aria-pressed"] === "false"));
    assert.equal(selected.length, type === "ink" ? 1 : 0);
    assert.equal(previews.length, type === "ink" ? 1 : 0);
    selectColor("#2563eb");
    assert.equal(swatches[1]["aria-pressed"], "true");
    assert.ok(classes.has("color-blue"));
    selectColor("invalid");
    assert.equal(context.state[`${type}Color`], "#2563eb");
    assert.equal(selected.length, type === "ink" ? 2 : 0);
  }
  assert.doesNotMatch(html, /type="color" data-custom-color/);
  assert.match(app, /customEditor\.onsubmit[\s\S]*?reportValidity\(\)[\s\S]*?selectColor\(customInput\.value\)/);
  const sliders = [0, 1, 2].map(() => ({ value: "0", nextElementSibling: {} }));
  const preview = { style: {} }, input = { value: "" };
  const previewColor = vm.runInNewContext(`(${functionSource(app, "previewCustomColor")})`, {
    customInput: input, channels: sliders, customEditor: { querySelector() { return preview; } },
  });
  previewColor("#AA12EF");
  assert.equal(input.value, "#aa12ef");
  assert.deepEqual(sliders.map(slider => slider.value), ["170", "18", "239"]);
  assert.deepEqual(sliders.map(slider => slider.nextElementSibling.value), ["170", "18", "239"]);
  previewColor("#xyz");
  assert.equal(input.value, "#aa12ef");
  previewColor("#000000");
  assert.deepEqual(sliders.map(slider => slider.value), ["0", "0", "0"]);
  previewColor("#ffffff");
  assert.deepEqual(sliders.map(slider => slider.value), ["255", "255", "255"]);
  assert.match(read("public/locales/zh.js"), /customColor:/);
});

test("text editor corner scales its box and font while edge handles remain single-axis", () => {
  const app = read("public/app.js"),
    resize = vm.runInNewContext(`(${functionSource(app, "resizeTextEditorDimensions")})`),
    gesture = { startWidth: 320, startHeight: 168, startFontCss: 17 };
  const corner = resize(gesture, "corner", 160, 84, 170, 96, 900, 700);
  assert.equal(corner.widthCss, 480);
  assert.equal(corner.heightCss, 252);
  assert.equal(corner.fontCss, 25.5);
  assert.ok(Math.abs(corner.widthCss / gesture.startWidth - corner.heightCss / gesture.startHeight) < 1e-9);
  assert.ok(Math.abs(corner.fontCss / gesture.startFontCss - corner.widthCss / gesture.startWidth) < 1e-9);
  assert.deepEqual({ ...resize(gesture, "width", 90, 50, 170, 96, 900, 700) }, { widthCss: 410, heightCss: 168, fontCss: 17 });
  assert.deepEqual({ ...resize(gesture, "height", 90, 50, 170, 96, 900, 700) }, { widthCss: 320, heightCss: 218, fontCss: 17 });
  const minimum = resize(gesture, "corner", -400, -400, 170, 96, 900, 700);
  assert.equal(minimum.heightCss, 96);
  assert.ok(Math.abs(minimum.widthCss / gesture.startWidth - minimum.fontCss / gesture.startFontCss) < 1e-9);
  const maximum = resize(gesture, "corner", 2000, 2000, 170, 96, 400, 700);
  assert.equal(maximum.widthCss, 400);
  assert.ok(Math.abs(maximum.heightCss / gesture.startHeight - maximum.fontCss / gesture.startFontCss) < 1e-9);
  const resizedFirst = { startWidth: 500, startHeight: 120, startFontCss: 17 },
    resizedCorner = resize(resizedFirst, "corner", 250, 60, 170, 96, 1000, 700);
  assert.deepEqual({ ...resizedCorner }, { widthCss: 750, heightCss: 180, fontCss: 25.5 });
});

test("text editor and final raster share one visible content origin across canvas scales", () => {
  const app = read("public/app.js"),
    place = vm.runInNewContext(`(${functionSource(app, "textBoxOriginFromEditor")})`),
    reopen = vm.runInNewContext(`(${functionSource(app, "textEditorOriginFromTextBox")})`),
    editor = { x:742.25, y:391.75 },
    contentMetrics = { x:11, y:51, width:298 },
    contentInset = { x:2.04, y:2.04 };
  for (const scale of [0.03, 0.25, 0.8, 1, 1.75, 2]) {
    const item = place(editor, contentMetrics, contentInset, scale),
      visibleEditorX = editor.x + contentMetrics.x / scale,
      visibleEditorY = editor.y + contentMetrics.y / scale;
    assert.ok(Math.abs(item.x + contentInset.x - visibleEditorX) < 1e-9);
    assert.ok(Math.abs(item.y + contentInset.y - visibleEditorY) < 1e-9);
    const reopened = reopen(item, contentMetrics, contentInset, scale);
    assert.ok(Math.abs(reopened.x - editor.x) < 1e-9);
    assert.ok(Math.abs(reopened.y - editor.y) < 1e-9);
  }
});

test("clipboard copy button and system paste import only text or images into native canvas controls", () => {
  const html = read("public/index.html"),
    app = read("public/app.js"),
    zh = read("public/locales/zh.js"),
    payload = functionSource(app, "clipboardPayloadFromDataTransfer"),
    navigatorPayload = functionSource(app, "navigatorClipboardPayload"),
    importPayload = functionSource(app, "importClipboardPayload"),
    addText = functionSource(app, "addClipboardText"),
    createText = functionSource(app, "createTextEditor"),
    restoreTextMode = functionSource(app, "restoreTextEditorMode"),
    copy = functionSource(app, "copyFromSystemClipboard");

  const imageButton = html.indexOf('id="imagePickerBtn"'),
    copyButton = html.indexOf('id="clipboardCopyBtn"');
  assert.ok(imageButton >= 0 && copyButton > imageButton);
  assert.match(html.slice(copyButton, copyButton + 500), /data-i18n-aria="copyFromClipboard"/);
  assert.match(app, /document\.addEventListener\("paste"/);
  assert.match(app, /editableClipboardTarget\(event\.target\)[\s\S]*?event\.preventDefault\(\)[\s\S]*?clipboardPayloadFromDataTransfer\(event\.clipboardData\)/);
  assert.match(payload, /startsWith\("image\/"\)[\s\S]*?getData\?\.\("text\/plain"\)/);
  assert.doesNotMatch(payload, /text\/html/);
  assert.match(navigatorPayload, /navigator\.clipboard\?\.read[\s\S]*?startsWith\("image\/"\)[\s\S]*?text\/plain/);
  assert.match(importPayload, /payload\?\.image instanceof Blob[\s\S]*?addImageFile\(payload\.image\)/);
  assert.match(importPayload, /payload\?\.text[\s\S]*?addClipboardText\(payload\.text\)/);
  assert.match(importPayload, /clipboardUnsupported/);
  assert.match(addText, /state\.pending[\s\S]*?acceptPending\(\)/);
  assert.match(addText, /state\.selection[\s\S]*?commitSelection\(\)/);
  assert.match(addText, /returnMode = state\.mode[\s\S]*?setCanvasMode\("select"/);
  assert.match(addText, /createTextEditor\(clipboardTextEditorPoint\(\), \{ text:value, returnMode \}\)/);
  assert.match(createText, /textarea\.value = typeof options\.text === "string"/);
  assert.match(createText, /returnMode:typeof options\.returnMode === "string"/);
  assert.match(restoreTextMode, /returnMode && state\.mode === "select"[\s\S]*?setCanvasMode\(returnMode/);
  assert.match(copy, /clipboardReading[\s\S]*?navigatorClipboardPayload\(\)[\s\S]*?clipboardReadFailed/);
  for (const key of ["copyFromClipboard", "clipboardReading", "clipboardTextAdded", "clipboardUnsupported", "clipboardReadFailed"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
});

test("text tool toggles a real MD+TeX preview and confirms the unchanged source", () => {
  const html = read("public/index.html"), app = read("public/app.js"), css = read("public/style.css"), zh = read("public/locales/zh.js");
  const textButton = html.match(/<button[^>]*data-mode="text"[\s\S]*?<\/button>/)?.[0] || "";
  assert.match(textButton, /class="[^\"]*icon-button[^\"]*"/);
  assert.match(textButton, /data-i18n-aria="text"/);
  for (const id of ["textEditorLayer", "textInputHint", "textHelpDialog", "textHelpClose"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.doesNotMatch(html, /id="textHelpDone"|data-i18n="textHelpConfirm"/);
  for (const name of ["createTextEditor", "confirmTextEditor", "cancelTextEditor", "toggleTextEditorMixedMode", "updateTextEditorMixedMode", "renderTextEditorPreview", "scheduleTextEditorPreview", "cancelTextEditorPreview", "mixedTextImage", "positionTextEditors", "keepTextEditorVisible", "clearTextEditors", "setCanvasMode", "openTextHelp", "closeTextHelp", "restoreTextEditorAfterHelp"]) assert.match(app, new RegExp(`function ${name}\\(`));
  assert.ok(html.indexOf('src="mixed-text.js"') < html.indexOf('src="app.js"'));
  assert.match(app, /textEditorStyleSheet\(\)/);
  assert.match(app, /textInputBlockedUntil/);
  assert.match(app, /nextTextEditorZ/);
  assert.match(app, /textTap/);
  assert.match(app, /\(event\.ctrlKey \|\| event\.metaKey\) && event\.key === "Enter"/);
  assert.match(app, /\? \{ typedInput \}/);
  assert.match(app, /if \(state\.auto && !refineCandidate\) schedule\(Math\.max\(1000, state\.autoDelayMs\)\)/);
  assert.match(app, /mixedMode:\s*false/);
  assert.match(app, /fontCss:\s*Number\(options\.fontCss\) \|\| TEXT_EDITOR_FONT_CSS/);
  assert.match(app, /startFontCss:\s*editor\.fontCss/);
  assert.match(app, /mixedModeButton\.setAttribute\("aria-pressed", "false"\)/);
  assert.match(app, /helpButton\.setAttribute\("aria-haspopup", "dialog"\)/);
  assert.match(app, /header\.className = "text-editor-header object-toolbar-shell"/);
  assert.match(app, /header\.append\(cancelButton, title, helpButton, mixedModeButton, acceptButton\)/);
  assert.match(app, /openTextHelp\(editor, helpButton\)/);
  assert.match(app, /function fittedTextBoxContent\(text, fontSize, color, maxWidth, fontFamily = TEXT_EDITOR_FONT_FAMILY, pixelRatio = desiredCanvasTextRasterRatio\(\)\)/);
  assert.match(app, /function textEditorContentMetrics\(editor\)/);
  assert.match(app, /function textImageContentInset\(image\)/);
  assert.match(app, /function textBoxOriginFromEditor\(editor, contentMetrics, contentInset, scale\)/);
  assert.match(app, /function textEditorOriginFromTextBox\(item, contentMetrics, contentInset, scale\)/);
  assert.match(app, /preview\.className = "text-editor-preview"/);
  assert.match(app, /mixedModeButton\.setAttribute\("aria-controls", preview\.id\)/);
  assert.match(app, /state\.latestTypedInput = \{ text: text\.slice\(0, TEXT_INPUT_MAX_LENGTH\), box \}/);
  const confirm = functionSource(app, "confirmTextEditor"),
    cancel = functionSource(app, "cancelTextEditor"),
    reconcile = functionSource(app, "reconcileDirtyAfterTextBoxDeletion"),
    create = functionSource(app, "createTextEditor"),
    setMode = functionSource(app, "setCanvasMode"),
    syncModePresentation = functionSource(app, "syncCanvasModePresentation"),
    openHelp = functionSource(app, "openTextHelp"),
    restoreHelp = functionSource(app, "restoreTextEditorAfterHelp"),
    toggle = functionSource(app, "toggleTextEditorMixedMode"),
    update = functionSource(app, "updateTextEditorMixedMode"),
    preview = functionSource(app, "renderTextEditorPreview");
  assert.doesNotMatch(confirm, /hotspotTrail\.push/);
  assert.match(app, /TEXT_INPUT_GUARD_MS\s*=\s*500/);
  assert.match(confirm, /blockCanvasInput\(TEXT_INPUT_GUARD_MS\)/);
  assert.match(cancel, /blockCanvasInput\(TEXT_INPUT_GUARD_MS\)/);
  assert.match(cancel, /editor\.sourceTextBoxId[\s\S]*?recordTextBoxesBefore\(\)[\s\S]*?state\.textBoxes\.splice\(index, 1\)[\s\S]*?state\.userRevision\+\+[\s\S]*?saveUserCanvasChange\(\)/);
  assert.doesNotMatch(cancel, /mergeDirtyBox|hotspotTrail|autoEligible\s*=\s*true/);
  assert.match(cancel, /reconcileDirtyAfterTextBoxDeletion\(deletedTextBox\)/);
  assert.match(reconcile, /deletedLatestTypedInput[\s\S]*?state\.latestTypedInput = null[\s\S]*?state\.dirtyTextBoxIds\.delete\(deletedTextBox\.id\)[\s\S]*?recomputeDirtyBounds\(\)/);
  assert.match(cancel, /if \(!deletedTextBox && !state\.textEditors\.size/);
  assert.doesNotMatch(create, /event\.key === "Escape"/);
  assert.match(confirm, /editor\.cancelled \|\| state\.textEditors\.get\(editor\.id\) !== editor/);
  assert.match(confirm, /if \(editor\.commitPromise\) return editor\.commitPromise/);
  assert.match(confirm, /editor\.commitPromise = commitPromise/);
  assert.match(confirm, /return await commitPromise/);
  assert.match(confirm, /proposedFontSize = editor\.fontCss \/ Math\.max\(0\.03, state\.scale\)/);
  assert.match(confirm, /contentMetrics = textEditorContentMetrics\(editor\)/);
  assert.match(confirm, /alignedOrigin = textBoxOriginFromEditor\(editor, contentMetrics, contentInset, editorScale\)/);
  assert.doesNotMatch(confirm, /editor\.x \+=|editor\.y \+=/);
  assert.match(confirm, /fittedTextBoxContent\(text, fontSize, color, maxWidth, editor\.fontFamily\)/);
  assert.match(confirm, /Math\.min\(SIZE - width, x\)/);
  assert.match(confirm, /Math\.min\(SIZE - height, y\)/);
  assert.match(confirm, /state\.textBoxes\.splice\(existingIndex, 1, item\)[\s\S]*?state\.textBoxes\.push\(item\)/);
  assert.doesNotMatch(confirm, /blitSized\(|retainSharpOverlay\(/);
  assert.match(app, /function editTextBox\(item\)/);
  assert.match(app, /state\.mode !== "hand"[\s\S]*?sourceTextBoxId:item\.id/);
  assert.match(functionSource(app, "beginCanvasObjectSelection"), /target\.kind === 'text-box'[\s\S]*?editTextBox\(target\.object\)/);
  assert.match(functionSource(app, "updateHandObjectHover"), /state\.handHoverKey = ""[\s\S]*releaseHandObjectFocus\(previousKey, "canvas-hover"\)[\s\S]*return false/);
  assert.doesNotMatch(functionSource(app, "updateHandObjectHover"), /handObjectToolbarTargetAtPoint|focusHandObject/);
  assert.doesNotMatch(functionSource(app, "objectChromeSpecs"), /target:"text-box"/);
  assert.doesNotMatch(app, /function finishTextBoxChromeGesture\(|function updateTextBoxChromeGesture\(|textBoxGesture/);
  assert.match(app, /header\.addEventListener\("pointerdown"[\s\S]*?event\.target\.closest\("button"\)[\s\S]*?textEditorPointerDown\(event, editor, "move"\)/);
  assert.match(css, /\.text-editor\s*\{[^}]*grid-template-rows:\s*34px minmax\(0, 1fr\)[^}]*border:\s*0;[^}]*border-radius:\s*7px;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none/);
  assert.match(css, /\.text-editor-button\s*\{[^}]*width:\s*28px;[^}]*height:\s*28px;[^}]*box-shadow:\s*none/);
  assert.ok(confirm.indexOf('setCanvasMode("pen")') > confirm.indexOf("if (!text.trim())"));
  assert.ok(confirm.indexOf('setCanvasMode("pen")') < confirm.indexOf("await fittedTextBoxContent"));
  assert.match(cancel, /setCanvasMode\("pen"\)/);
  assert.match(setMode, /state\.mode = mode/);
  assert.match(syncModePresentation, /classList\.toggle\("active", item === button\)/);
  assert.match(app, /button\.onclick = \(\) => selectCanvasToolMode\(button\.dataset\.mode, \{ showHint:true \}\)/);
  assert.match(openHelp, /focusTextEditor\(editor\)/);
  assert.match(openHelp, /dialog\.showModal\(\)/);
  assert.match(restoreHelp, /blockCanvasInput\(300\)/);
  assert.match(restoreHelp, /invoker\?\.isConnected/);
  assert.match(app, /textHelpDialog"\)\.addEventListener\("close", restoreTextEditorAfterHelp\)/);
  assert.match(app, /newCanvasDialog"\)\.open \|\| document\.querySelector\("#textHelpDialog"\)\.open/);
  assert.match(toggle, /editor\.mixedMode = !editor\.mixedMode/);
  assert.match(toggle, /scheduleTextEditorPreview\(editor, 0\)/);
  assert.doesNotMatch(toggle, /textarea\.value\s*=|\bschedule\(|requestAI\(|userRevision/);
  assert.match(update, /editor\.textarea\.hidden = editor\.mixedMode/);
  assert.match(update, /editor\.preview\.hidden = !editor\.mixedMode/);
  assert.match(preview, /text = editor\.textarea\.value/);
  assert.match(preview, /image = await mixedTextImage\(text, fontCss, color, maxWidth/);
  assert.match(preview, /editor\.previewRevision !== revision/);
  assert.match(preview, /editor\.preview\.replaceChildren\(image\)/);
  assert.doesNotMatch(preview, /schedule\(|requestAI\(|userRevision/);
  assert.match(css, /\.text-editor\s*\{[^}]*pointer-events:\s*auto;[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none/);
  assert.match(css, /\.text-editor-header\s*\{[^}]*height:\s*34px;[^}]*gap:\s*4px;[^}]*padding:\s*3px 4px;[^}]*cursor:\s*grab/);
  assert.match(css, /\.object-toolbar-shell\)\s*\{[^}]*border-bottom:\s*0;[^}]*border-radius:\s*7px 7px 0 0;[^}]*box-shadow:\s*none;[^}]*backdrop-filter:\s*saturate\(1\.12\) blur\(14px\)/);
  assert.match(css, /\.text-editor-body\s*\{[^}]*border:\s*1px solid[^}]*border-radius:\s*0 0 7px 7px;[^}]*background:\s*color-mix/);
  assert.match(css, /\.text-editor-button\.confirm, \.text-editor-button\.confirm:hover\s*\{[^}]*color:\s*var\(--confirm\)[^}]*background:\s*transparent/);
  assert.match(css, /\.text-editor-button\.cancel, \.text-editor-button\.cancel:hover\s*\{[^}]*color:\s*var\(--danger\)[^}]*background:\s*transparent/);
  assert.match(css, /\.text-editor-preview\s*\{[^}]*background:\s*transparent/);
  assert.match(css, /\.text-editor-preview-canvas\s*\{[^}]*--text-editor-preview-inset-x[^}]*--text-editor-preview-inset-y/);
  assert.match(css, /\.text-editor-input\[hidden\]\s*\{[^}]*display:\s*none/);
  assert.match(css, /font:\s*var\(--text-editor-font-size\)\/1\.35/);
  assert.match(css, /\.text-editor-button\.mixed-mode\[aria-pressed="true"\]/);
  assert.match(css, /\.text-editor-button\.help/);
  assert.match(css, /\.text-help-dialog\s*\{[^}]*max-height:\s*calc\(100dvh - 24px\)[^}]*overflow:\s*auto/);
  assert.match(css, /\.text-help-example pre\s*\{[^}]*overflow-wrap:\s*anywhere[^}]*white-space:\s*pre-wrap/);
  assert.match(css, /#textEditorLayer\s*\{[^}]*z-index:\s*var\(--text-editor-layer-z, 6\)/);
  assert.match(css, /\.text-editor-handle\.width/);
  assert.match(css, /\.text-editor-handle\.height/);
  assert.match(css, /\.text-editor-handle\.corner/);
  for (const key of ["text", "textMixedMode", "textMixedModeShort", "textEditMode", "textPreview", "textMixedModeError", "textConfirm", "textCancel", "textPlaceholder", "textConfirmHint", "textEmpty", "textHelp", "textHelpTitle", "textHelpClose", "textHelpIntro", "textHelpMarkdown", "textHelpMath", "textHelpExampleTitle", "textHelpExample"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
});

test("deleting a textbox removes its stale contribution from typed-only attention", () => {
  const app = read("public/app.js"),
    upperBox = { x:11299, y:7064, w:2370, h:708 },
    lowerBox = { x:11840, y:8920, w:920, h:690 },
    upper = { id:"text-box-1", ...upperBox },
    lower = { id:"text-box-2", ...lowerBox },
    state = {
      dirty:{ x:upperBox.x, y:upperBox.y, w:upperBox.w, h:lowerBox.y + lowerBox.h - upperBox.y },
      latestTypedInput:{ text:"Create a FHIR CarePlan", box:{ ...upperBox } },
      hotspotTrail:[],
      autoEligible:true,
      dirtyInkTiles:new Map(),
      dirtyInkBounds:new Map(),
      dirtyImageIds:new Set(),
      dirtyTextBoxIds:new Set([upper.id, lower.id]),
      images:[],
      textBoxes:[upper],
    },
    source = `(() => {
      ${functionSource(app, "unionDirtyBounds")}
      ${functionSource(app, "recomputeDirtyBounds")}
      return ${functionSource(app, "reconcileDirtyAfterTextBoxDeletion")};
    })()`,
    reconcile = vm.runInNewContext(source, {
      state,
      TILE:512,
      DIRTY_MASK_SCALE:.25,
      imageBox:(item) => ({ x:item.x, y:item.y, w:item.w, h:item.h }),
      textBoxBox:(item) => ({ x:item.x, y:item.y, w:item.w, h:item.h }),
      dirtyMaskAlphaBounds:() => null,
    });
  reconcile(lower);
  assert.deepEqual({ ...state.dirty }, upperBox);
  assert.equal(state.latestTypedInput.text, "Create a FHIR CarePlan");
  assert.deepEqual(state.hotspotTrail, []);
  assert.equal(state.autoEligible, true);
});

test("text rendering preserves explicit lines and rejects MathJax error output", () => {
  const app = read("public/app.js"), layout = functionSource(app, "layoutText"), mixed = functionSource(app, "mixedTextImage"), math = functionSource(app, "mathJaxImage");
  assert.match(layout, /split\("\\n"\)/);
  assert.match(layout, /lines\.push\(\.\.\.wrapped\)/);
  assert.match(mixed, /MIXED_TEXT\.parse/);
  assert.match(mixed, /segment\.raw/);
  assert.match(mixed, /rows\.push\(row\)/);
  assert.match(mixed, /MIXED_FORMULA_MAX_LENGTH/);
  assert.match(math, /\[data-mml-node="merror"\], mjx-merror/);
  assert.match(math, /image\.revealRows = \[logicalWidth\]/);
});

test("New canvas, Export, and Auto AI controls have English and Chinese copy", () => {
  const app = read("public/app.js"), zh = read("public/locales/zh.js");
  for (const key of ["autoDelay", "newCanvas", "exportPng", "exportComplete", "exportError", "newCanvasTitle", "saveAsNewAndCreate", "overwriteAndCreate", "newCanvasReady"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
});

test("eraser strokes shrink retained dirty input without becoming new AI instructions", () => {
  const app = read("public/app.js");
  const pointerMoveStart = app.indexOf('screen.addEventListener("pointermove"'),
    pointerMoveEnd = app.indexOf("function end(e)", pointerMoveStart),
    pointerMove = app.slice(pointerMoveStart, pointerMoveEnd),
    activeDrawing = functionSource(app, "updateActiveCanvasDrawing");
  assert.match(pointerMove, /if \(e\.pointerType !== "touch"\) updateWidgetRefinePointer\(clientPoint\(e\)\)/);
  assert.match(pointerMove, /if \(updateActiveCanvasDrawing\(e\)\) return/);
  assert.match(activeDrawing, /if \(!d \|\| d\.id !== e\.pointerId\) return false[\s\S]*?appendLiveInkSample\(d, p, size\)[\s\S]*?commitLiveInkDrawingProgress\(d\)/);
  assert.match(app, /const shouldRequest = !d\.erase/);
  assert.match(app, /if \(shouldRequest\) \{\s*for \(const point of d\.trail\) state\.hotspotTrail\.push\(point\)/);
  assert.match(app, /recomputeDirtyBounds\(\);\s*filterErasedDirtyHotspots\(d\.dirtyMaskTouched\);\s*refineCandidate = relatchWidgetRefineCandidateFromDirty\(\)/);
  assert.match(app, /if \(state\.dirty && state\.autoEligible && !refineCandidate\) schedule\(\)/);
  assert.match(app, /const erasing = forceEraser \|\| state\.mode === "eraser";\s*if \(erasing\) clearWidgetRefineCandidate\(\)/);
  assert.match(functionSource(app, "invalidateRecognition"), /clearWidgetRefineCandidate\(\)[\s\S]*?state\.dirty = null/);
  assert.match(app, /erase: erasing/);
  assert.match(app, /dirtyMaskTouched:erasing \? new Set\(\) : null/);
  assert.match(app, /samples: \[\],[\s\S]*?dirtyMaskTouched:erasing \? new Set\(\) : null[\s\S]*?appendLiveInkSample\(state\.drawing, p, size\)/);
  assert.match(functionSource(app, "commitLiveInkDrawingProgress"), /dot\(first\.point, drawing\.erase[\s\S]*?stroke\(previous\.point, current\.point, drawing\.erase/);
  assert.match(functionSource(app, "trackDirtyStrokeSegment"), /globalCompositeOperation = erase \? "destination-out" : "source-over"[\s\S]*?state\.dirtyInkBounds\.delete\(k\)/);
});

test("capture failure preserves dirty input and cannot block the AI request", () => {
  const app = read("public/app.js");
  const request = functionSource(app, "requestAI"), emergency = functionSource(app, "emergencyViewportImage");
  assert.doesNotMatch(app, /discardUncapturableInput/);
  assert.match(request, /if \(!packed\) \{[\s\S]*?packed = emergencyViewportImage\(/);
  assert.match(request, /const res = await fetch\("\/api\/ai\/command"/);
  assert.doesNotMatch(request.slice(0, request.indexOf('const res = await fetch("/api/ai/command"')), /state\.dirty = null|hotspotTrail\.splice/);
  assert.match(emergency, /data:image\/png;base64/);
  assert.match(emergency, /hotspotGrid:\{[\s\S]*?hotspots:\[\]/);
});

test("AI capture stays inside the current viewport when retained dirty ink is off-screen", () => {
  const app = read("public/app.js"), capture = functionSource(app, "captureRectFor"), plan = functionSource(app, "planViewportImage"), build = functionSource(app, "buildViewportImage"), request = functionSource(app, "requestAI");
  assert.match(capture, /return visible/);
  assert.doesNotMatch(capture, /Math\.max\(3200|Math\.max\(2200/);
  assert.match(plan, /useFullViewport = captureCurrentViewport \|\| Boolean\(latestBox && !intersection\(latestBox, captureRect\)\)/);
  assert.match(plan, /latestVisible = latestBox \? intersection\(latestBox, sourceRect\) \|\| \{ \.\.\.sourceRect \}/);
  assert.match(build, /changedBox: latestVisible/);
  assert.doesNotMatch(build, /containsRect\(sourceRect, latestBox\)/);
  assert.match(request, /const requestBox = packed\.changedBox/);
  assert.match(request, /rawCommands = Array\.isArray\(data\.commands\)[\s\S]*?normalizeCommandPlacements\(validate\(rawCommands, aiColor, widgetEditTarget, packed\.visibleRect\), packed, requestBox\)/);
});

test("clicking the magic orb sends the Auto AI prompt with the current viewport", () => {
  const app = read("public/app.js"),
    html = read("public/index.html"),
    manual = functionSource(app, "invokeAIAction"),
    request = functionSource(app, "requestAI"),
    plan = functionSource(app, "planViewportImage"),
    build = functionSource(app, "buildViewportImage"),
    automatic = functionSource(app, "launchAutomaticAI"),
    selection = functionSource(app, "requestSelectionAI");
  assert.doesNotMatch(html, /id="aiRadial"|data-ai-action=/);
  assert.match(app, /aiOrb\.addEventListener\("click"[\s\S]*?invokeAIAction\("auto"\)/);
  assert.match(manual, /requestAI\(action, null, \{ captureCurrentViewport: true \}\)/);
  assert.doesNotMatch(manual, /action === "answer"|state\.dirty/);
  assert.match(request, /automatic = action === "auto"/);
  assert.match(request, /trigger: automatic \? "user_paused" : "manual"/);
  assert.match(request, /userAction: action/);
  assert.match(request, /captureCurrentViewport = Boolean\(requestOptions\.captureCurrentViewport\)/);
  assert.match(request, /preparationGeneration = \+\+aiPreparationGeneration[\s\S]*?aiPreparationInvalid\(preparation, preparationGeneration, revision\)/);
  assert.match(functionSource(app, "aiPreparationInvalid"), /state\.userRevision === revision[\s\S]*?finishAIPreparation\(preparation\)[\s\S]*?setStatusKey\("deferred"\)/);
  assert.match(request, /attentionBox = dirtySnapshot \|\| \(captureCurrentViewport \? null : latestBox\)/);
  assert.match(request, /planViewportImage\(attentionBox, captureCurrentViewport\)[\s\S]*?await prepareVisibleWidgetSnapshots\(snapshotRegion\)/);
  assert.match(request, /packed = captureCurrentViewport \|\| attentionBox[\s\S]*?\? buildViewportImage\(state\.hotspotTrail\.slice\(0, hotspotCount\), attentionBox, captureCurrentViewport, capturePlan\)/);
  assert.ok(request.indexOf("await prepareVisibleWidgetSnapshots(") < request.indexOf("buildViewportImage("), "visible iframe snapshots must be prepared before the AI atlas is built");
  assert.equal((request.match(/buildViewportImage\(/g) || []).length, 1, "all viewport requests must use the same capture entry point");
  assert.match(request, /if \(!packed\) \{[\s\S]*?packed = emergencyViewportImage\(/);
  assert.match(functionSource(app, "planViewportImage"), /sourceRect = \{ x: left, y: top, w: right - left, h: bottom - top \}[\s\S]*?return \{ visible, captureRect, sourceRect, imageScale, imageSize, latestVisible \}/);
  assert.match(plan, /if \(!useFullViewport && !ink\) return null/);
  assert.match(plan, /left = useFullViewport \? captureRect\.x/);
  assert.match(plan, /right = useFullViewport \? captureRect\.x \+ captureRect\.w/);
  assert.match(plan, /latestVisible = latestBox \? intersection\(latestBox, sourceRect\) \|\| \{ \.\.\.sourceRect \}/);
  assert.match(build, /globalAlpha = 0\.42[\s\S]*?drawWidgetsToContext\(q, sourceRect\)[\s\S]*?drawWidgetsToContext\(q, latestVisible\)/);
  assert.ok(build.indexOf("drawWidgetsToContext(q, sourceRect)") < build.indexOf("drawImagesToContext(q, sourceRect)"));
  assert.match(build, /scope: captureCurrentViewport \? "current-viewport" : "visible-content"/);
  assert.match(request, /typedInput = !isolatedSelection[\s\S]*?containsRect\(packed\?\.sourceRect, state\.latestTypedInput\.box\)/);
  assert.match(request, /state\.dirty = null;[\s\S]*?state\.hotspotTrail\.splice\(0, hotspotCount\);[\s\S]*?state\.latestTypedInput = null/);
  assert.match(request, /state\.userRevision !== revision[\s\S]*?!run\.inputConsumed[\s\S]*?restoreDirty\(dirtySnapshot\)/);
  assert.match(automatic, /if \(state\.mode === "hand" \|\| !state\.auto \|\| !state\.dirty \|\| !state\.autoEligible \|\| state\.drawing \|\| state\.widgetRefineConfirmation\) return/);
  assert.match(automatic, /requestAI\("auto"\)/);
  assert.doesNotMatch(automatic, /captureCurrentViewport/);
  assert.match(selection, /requestAI\(action, packed, \{ isolatedSelection: true, selection, selectionRequestToken: token \}\)/);
  assert.doesNotMatch(selection, /captureCurrentViewport/);
});

test("the retained focus inset implementation is inactive", () => {
  const app = read("public/app.js");
  assert.match(app, /FOCUS_INSET_ENABLED = false/);
  assert.match(app, /FOCUS_INSET_ENABLED \? drawFocusInset\(out, latestVisible, sourceRect, imageScale, captureTime\) : null/);
  assert.match(app, /function drawFocusInset\(out, latestBox, sourceRect, mainScale, captureTime = performance\.now\(\)\)/);
});

test("normalize sends the lasso bounding rectangle on a blank background", () => {
  const app = read("public/app.js"), source = functionSource(app, "buildSelectionImage");
  assert.match(source, /const sourceRect = \{\s*\.\.\.selection\.box\s*\}/);
  assert.doesNotMatch(source, /const padding|content\.x - padding|content\.y - padding/);
  assert.match(source, /q\.fillStyle = "#fff"/);
  assert.match(source, /for \(const fragment of selection\.fragments\)/);
  assert.match(source, /changedBox: \{ \.\.\.sourceRect \}/);
});

test("normalize preserves literal text, formulas, and function plots without inspecting their content", () => {
  const request = functionSource(read("public/app.js"), "requestAI"),
    filter = request.match(/if \(action === "normalize"\)[\s\S]*?debug\("ai-response"/)?.[0] || "";
  assert.match(filter, /\["write_text", "draw_formula", "plot_function"\]\.includes\(commands\[index\]\.tool\)/);
  assert.doesNotMatch(filter, /commands\[index\]\.(?:text|latex|expression)|observedText/);
});

test("selection AI tracks its action while Typeset remains available", () => {
  const app = read("public/app.js"),
    mode = functionSource(app, "setCanvasMode"),
    pointer = functionSource(app, "handleSelectionPointerDown"),
    complete = functionSource(app, "completeNewCanvas"),
    selectionRequest = functionSource(app, "requestSelectionAI"),
    toolbar = functionSource(app, "updateSelectionToolbar"),
    release = functionSource(app, "releaseSelectionAITransformLock"),
    isTypesetting = vm.runInNewContext(`(${functionSource(app, "selectionIsTypesetting")})`, { selectionAIRequest: (selection) => selection?.aiRequest || null });
  assert.equal(isTypesetting({ aiRequest: { action: "continue" } }), false);
  assert.equal(isTypesetting({ aiRequest: { action: "normalize" } }), true);
  assert.match(selectionRequest, /selection\.aiRequest = \{ token, action \}/);
  assert.match(selectionRequest, /selectionRequestToken: token/);
  assert.match(selectionRequest, /selection\.aiRequest\?\.token === token/);
  assert.match(toolbar, /selectionTypesetButton\.disabled = false/);
  assert.match(toolbar, /isTypesetting \? "selectionTypesetting" : "selectionTypeset"/);
  assert.match(release, /selection\.aiRequest\?\.token !== token/);
  assert.match(mode, /selectionAIBusy\(state\.selection\)/);
  assert.match(mode, /selectionAIStatusKey\(state\.selection\)/);
  assert.match(pointer, /selectionAIBusy\(selection\)/);
  assert.doesNotMatch(app, /selection\.typesetting|selection\?\.typesetting/);
  assert.match(complete, /saved === null/);
  assert.match(complete, /setNewCanvasDialogBusy\(false\)/);
});

test("cancelling after accepting an isolated draft does not restore the old selection tiles", () => {
  const app = read("public/app.js"), cancel = functionSource(app, "cancelSelection"), consume = functionSource(app, "consumePendingInput");
  assert.match(cancel, /selection\.phase === "active" && !selection\.acceptedDraft/);
  assert.match(consume, /p\.selection\.acceptedDraft = true/);
});

test("lasso tool exposes local transform controls in both languages", () => {
  const html = read("public/index.html"), app = read("public/app.js"), zh = read("public/locales/zh.js");
  assert.match(html, /data-mode="select"/);
  assert.ok(html.indexOf('src="selection.js"') < html.indexOf('src="app.js"'));
  for (const key of ["select", "selectionTooSmall", "selectionReady", "selectionCommitted", "selectionCancelled", "selectionRecolored"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
  assert.match(app, /drawDraftActions\(ctx, selection\.box, size\)/);
  assert.match(app, /drawMoveHandle\(ctx, selection\.box, size, true\)/);
  assert.match(app, /drawResizeHandle\(ctx, selection\.box, size\)/);
  assert.match(app, /clippedContext\.clip\("evenodd"\)/);
  assert.match(app, /tileContext\.fill\("evenodd"\)/);
  assert.match(app, /MAX_LASSO_POINTS = 4096/);
});

test("selection edits never schedule or send AI requests", () => {
  const app = read("public/app.js");
  for (const name of ["captureSelection", "commitSelection", "cancelSelection", "applySelectionColor", "updateSelectionGesture"]) {
    const source = functionSource(app, name);
    assert.doesNotMatch(source, /\b(?:schedule|requestAI)\s*\(/, `${name} must stay local`);
  }
  assert.match(functionSource(app, "finishDrawing"), /schedule\(\)/);
  assert.match(functionSource(app, "invokeAIAction"), /requestAI\(action,/);
});

test("manual actions and pen-down use non-blocking latest-request-wins cancellation", () => {
  const app = read("public/app.js"),
    manual = functionSource(app, "invokeAIAction"),
    supersede = functionSource(app, "supersedeActiveAI"),
    request = functionSource(app, "requestAI"),
    guard = functionSource(app, "checkAI");
  assert.ok(manual.indexOf('supersedeActiveAI("manual-action")') < manual.indexOf("requestAI(action,"));
  assert.match(app, /if \(!valid\(p\)\)[\s\S]*?return;\s*}\s*supersedeActiveAI\("user-input-started"\);\s*clearTimeout\(state\.timer\)/);
  assert.match(request, /^function requestAI[\s\S]*?clearWidgetRefineCandidate\(\)/);
  assert.match(request, /automatic = action === "auto"[\s\S]*?if \(!automatic\) \{[\s\S]*?clearTimeout\(state\.timer\)[\s\S]*?state\.timer = 0/);
  assert.match(supersede, /active\.superseded = true;[\s\S]*?active\.controller\.abort\(\)/);
  assert.doesNotMatch(supersede, /discardPendingForNewAI\(\)/);
  assert.match(app, /appendPendingItems\(state\.pending, items, revision, meta, resolve\)/);
  assert.doesNotMatch(request, /if\s*\(state\.busy\)/);
  assert.match(guard, /run\.superseded \|\| state\.activeAI !== run/);
  assert.match(request, /animate\(commands\[0\], revision, meta, run\)/);
  assert.match(request, /preparePendingItem\(c, revision, meta, run\)/);
});

test("the magic orb becomes a device-scoped stop button while an AI request is active", () => {
  const html = read("public/index.html"), app = read("public/app.js"), css = read("public/style.css"), zh = read("public/locales/zh.js"),
    busy = functionSource(app, "setBusy"), stop = functionSource(app, "stopActiveAIRequests"), trigger = functionSource(app, "invokeAIAction"),
    reveal = functionSource(app, "revealAIOrb"), idle = functionSource(app, "scheduleAIOrbIdle"),
    supersede = functionSource(app, "supersedeActiveAI");
  assert.match(html, /id="aiOrb"[\s\S]*?class="ai-stop-icon"/);
  assert.match(html, /id="aiOrb"[^>]*data-i18n-aria="triggerAutoAI"/);
  assert.doesNotMatch(html, /id="aiRadial"|data-ai-action=|id="aiOrb"[^>]*aria-haspopup/);
  assert.match(busy, /classList\.toggle\("working", state\.busy\)[\s\S]*?revealAIOrb\(\)[\s\S]*?updateEmbodimentLabel\(\)/);
  assert.match(stop, /state\.activeAI \|\| aiPreparation[\s\S]*?supersedeActiveAI\("user-stop"\)/);
  assert.match(trigger, /clearTimeout\(state\.timer\)[\s\S]*?requestAI\(action, null, \{ captureCurrentViewport: true \}\)/);
  assert.match(reveal, /clearTimeout\(state\.aiOrbIdleTimer\)[\s\S]*?classList\.remove\("idle-dim"\)/);
  assert.match(idle, /revealAIOrb\(\)[\s\S]*?classList\.add\("idle-dim"\)[\s\S]*?AI_ORB_IDLE_DELAY_MS/);
  assert.match(app, /const AI_ORB_IDLE_DELAY_MS = 5000/);
  assert.match(app, /setNavigating\(true\);\s*scheduleAIOrbIdle\(\);/);
  assert.match(css, /\.ai-embodiment\s*\{[^}]*transition:\s*opacity \.32s ease/);
  assert.match(css, /\.ai-embodiment\.idle-dim:not\(\.working\):not\(:hover\):not\(:focus-within\)[^{]*\{[^}]*opacity:\s*\.36/);
  assert.match(css, /body\[data-theme="studio"\] \.ai-embodiment\s*\{[^}]*z-index:\s*41;[^}]*top:\s*calc\(var\(--studio-toolbar-height\) \+ 10px\);[^}]*right:\s*calc\(max\(10px, env\(safe-area-inset-right\)\) \+ var\(--studio-agent-edge-shift\)\);[^}]*width:\s*48px;[^}]*height:\s*48px;[^}]*opacity:\s*\.52/);
  assert.doesNotMatch(css, /body\[data-theme="studio"\] \.ai-embodiment\s*\{[^}]*right:\s*calc\(var\(--studio-agent-edge-shift\) - 24px\)/);
  assert.match(css, /body\[data-theme="studio"\] \.ai-embodiment\.idle-dim:not\(\.working\):not\(:hover\):not\(:focus-within\)\s*\{[^}]*opacity:\s*\.52/);
  assert.match(css, /body\[data-theme="studio"\] \.ai-embodiment:hover,[\s\S]*?\.ai-embodiment:focus-within\s*\{[^}]*opacity:\s*1/);
  assert.match(css, /body\[data-theme="studio"\] \.ai-embodiment\.working\s*\{[^}]*opacity:\s*1/);
  assert.match(css, /@property --ai-orb-ring-angle\s*\{[^}]*syntax:\s*"<angle>"[^}]*initial-value:\s*0deg/);
  assert.match(css, /body\[data-theme="studio"\] \.ai-embodiment\.working::before\s*\{[^}]*inset:\s*2px;[^}]*conic-gradient\(from var\(--ai-orb-ring-angle\)[^}]*animation:\s*ai-orb-ring-spin 1\.4s linear infinite/);
  assert.match(css, /@keyframes ai-orb-ring-spin\s*\{\s*to\s*\{\s*--ai-orb-ring-angle:\s*360deg/);
  assert.match(css, /body\[data-theme="studio"\] \.ai-orb\s*\{[^}]*inset:\s*4px;[^}]*width:\s*40px;[^}]*height:\s*40px;[^}]*box-shadow:\s*0 1px 4px[^}]*transition:\s*transform \.16s ease-out/);
  assert.match(css, /\.ai-orb\s*\{[^}]*-webkit-tap-highlight-color:\s*transparent;/, "touch and pen activation must not draw WebKit's tint block");
  assert.match(css, /body\[data-theme="studio"\] \.ai-orb::before\s*\{[^}]*display:\s*none/);
  assert.match(css, /body\[data-theme="studio"\] \.ai-embodiment:not\(\.working\) \.ai-orb:hover,[\s\S]*?\.ai-orb:focus-visible\s*\{[^}]*border-color:\s*var\(--studio-accent\);[^}]*transform:\s*scale\(1\.04\)/);
  assert.match(css, /@media \(hover: none\)\s*\{\s*body\[data-theme="studio"\] \.ai-embodiment:not\(\.working\) \.ai-orb:hover:not\(:focus-visible\)\s*\{[^}]*background:\s*var\(--studio-panel\);[^}]*transform:\s*none;/, "touch-only hover emulation must retain the untinted resting surface");
  assert.match(css, /body\[data-theme="studio"\] \.ai-embodiment\.working \.ai-orb,[\s\S]*?\.ai-orb:focus-visible\s*\{[^}]*color:\s*#b4232f;[^}]*background:\s*var\(--studio-panel\);[^}]*box-shadow:\s*0 1px 4px/);
  assert.doesNotMatch(css, /body\[data-theme="studio"\] \.ai-embodiment\.working \.ai-orb,[\s\S]*?\.ai-orb:focus-visible\s*\{[^}]*background:\s*#b4232f/);
  assert.match(css, /body\[data-theme="studio"\] \.orb-aura,[^}]*\.orb-runes,[^}]*\.orb-particle\s*\{[^}]*display:\s*none/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*?\.ai-embodiment\.working::before\s*\{[^}]*animation:\s*none/);
  assert.match(app, /aiOrb\.addEventListener\("click"[\s\S]*?if \(state\.busy\)[\s\S]*?stopActiveAIRequests\(\)[\s\S]*?invokeAIAction\("auto"\)/);
  assert.match(css, /\.ai-embodiment\.working \.ai-stop-icon\s*\{[^}]*display:\s*block/);
  assert.match(css, /\.ai-stop-icon\s*\{[^}]*width:\s*11px;[^}]*height:\s*11px;[^}]*border-radius:\s*2px;[^}]*background:\s*currentColor;[^}]*box-shadow:\s*none/);
  assert.doesNotMatch(css, /\.ai-stop-icon::before|\.ai-stop-icon::after|\.ai-stop-icon\s*\{[^}]*background:\s*#fff/);
  assert.match(zh, /triggerAutoAI:\s*"立即运行 Auto AI"/);
  assert.match(zh, /stopAIRequest:\s*"停止当前 AI 请求"/);
  assert.doesNotMatch(`${app}\n${css}`, /radial-action|openRadialMenu|closeRadialMenu|menu-open/);
  assert.doesNotMatch(stop, /fetch\(|\/api\//);
  assert.match(supersede, /reason === "user-stop"[\s\S]*?restoreDirty\(active\.dirtySnapshot\)[\s\S]*?refreshWidgetRefineHoverCandidate\(\)/);
  assert.match(supersede, /const preparation = aiPreparation[\s\S]*?preparation\.controller\.abort\(\)[\s\S]*?phase:"preparing"/);
  assert.match(functionSource(app, "activeWidgetRefinement"), /aiPreparation\?\.widgetEdit \|\| state\.activeAI\?\.widgetEdit/);
});

test("settled Canvas zoom upgrades only visible text raster caches within the shared pixel budget", () => {
  const canvas = read("src/client/app/canvas-runtime.js"), persistence = read("src/client/app/persistence.js"),
    desiredSource = functionSource(canvas, "desiredCanvasTextRasterRatio"),
    pixelsSource = functionSource(canvas, "textRasterPixels"),
    ratioSource = functionSource(canvas, "textImageRasterRatio"),
    extraSource = functionSource(canvas, "textRasterExtraPixels"),
    budgetSource = functionSource(canvas, "textRasterRatioForBudget"),
    renderImage = functionSource(canvas, "renderTextBoxImage"),
    refresh = functionSource(canvas, "refreshVisibleTextBoxQuality"),
    restore = functionSource(canvas, "restoreTextBoxes"),
    finishPreview = functionSource(canvas, "finishCanvasNavigationPreview"),
    desired = Function("state", "devicePixelRatio", `return (${desiredSource});`)({ scale:1 }, 2),
    textRasterPixels = Function(`return (${pixelsSource});`)(),
    textImageRasterRatio = Function(`return (${ratioSource});`)(),
    textRasterExtraPixels = Function("textRasterPixels", `return (${extraSource});`)(textRasterPixels),
    ratioForBudget = Function("textImageRasterRatio", "textRasterPixels", "MAX_SHARP_OVERLAY_ITEM_PIXELS", `return (${budgetSource});`)(textImageRasterRatio, textRasterPixels, 40000),
    item = { w:100, h:100, image:{ width:100, height:100, logicalWidth:100, logicalHeight:100 } };

  assert.equal(desired(0.5), 2);
  assert.equal(desired(1.5), 3);
  assert.equal(desired(4), 3);
  assert.equal(ratioForBudget(item, 3, 1000000), 2, "one cached text raster cannot exceed the per-item budget");
  assert.ok(Math.abs(ratioForBudget(item, 3, 5000) - Math.sqrt(1.5)) < 1e-9);
  assert.equal(ratioForBudget(item, 3, 1000), 1, "an upgrade smaller than five percent is skipped");
  assert.equal(textRasterExtraPixels(item, { width:200, height:200, logicalWidth:100, logicalHeight:100 }), 30000);

  assert.match(renderImage, /mixedTextImage\([^)]*pixelRatio\)[\s\S]*?textImage\([^)]*pixelRatio\)/);
  assert.match(refresh, /requestAnimationFrame\(\(\) => requestAnimationFrame\(resolve\)\)/);
  assert.match(refresh, /view\.classList\.contains\("canvas-navigation-previewing"\)/);
  assert.match(refresh, /canvasRenderRegion\(\)\.visible[\s\S]*?visibleTextBoxes\(visible\)/);
  assert.match(refresh, /state\.textBoxes\.reduce\(\(sum, item\) => sum \+ textRasterExtraPixels\(item\), 0\)/);
  assert.match(refresh, /MAX_SHARP_OVERLAY_PIXELS - state\.sharpOverlayPixels - retainedExtraPixels/);
  assert.match(refresh, /textRasterRatioForBudget\(item, targetRatio, remainingPixels\)/);
  assert.match(refresh, /generation !== canvasTextQualityGeneration[\s\S]*?!state\.textBoxes\.includes\(item\)[\s\S]*?item\.image !== currentImage/);
  assert.match(refresh, /renderedRatio <= textImageRasterRatio\(currentImage\) \* 1\.05[\s\S]*?renderedPixels > MAX_SHARP_OVERLAY_ITEM_PIXELS[\s\S]*?additionalPixels > remainingPixels/);
  assert.match(refresh, /item\.image = image[\s\S]*?remainingPixels -= additionalPixels[\s\S]*?renderTextContentLayer\(canvasRenderRegion\(\)\.visible\)/);
  assert.doesNotMatch(refresh, /state\.userRevision|saveUserCanvasChange|requestRender\(|\brender\(/);
  assert.match(restore, /textImageRasterRatio\(item\.image\) >= pixelRatio \/ 1\.05[\s\S]*?renderedTextBoxRecord\(item, pixelRatio\)/);
  assert.match(restore, /pixelRatio = 1[\s\S]*?requestRender\(\)[\s\S]*?refreshVisibleTextBoxQuality\(\)/);
  assert.match(finishPreview, /render\(\)[\s\S]*?void refreshVisibleTextBoxQuality\(\)/);
  assert.match(persistence, /restoreTextBoxes\(item\.textBoxes, 1\)/);
  assert.match(persistence, /fitViewerCanvas\(\);[\s\S]*?render\(\);[\s\S]*?void refreshVisibleTextBoxQuality\(\)/);
});

test("AI text defaults to the cross-platform handwritten font and remembers explicit choices", () => {
  const html = read("public/index.html"), core = read("src/client/app/core.js"), canvas = read("src/client/app/canvas-runtime.js"), ai = read("src/client/app/ai-runtime.js"), agent = read("src/client/app/canvas-agent-runtime.js"), bootstrap = read("src/client/app/ui-bootstrap.js"), app = read("public/app.js"),
    handwrittenOption = html.match(/<option[^>]*data-i18n="fontHand"[^>]*>/)?.[0] || "",
    handwritten = "Bradley Hand, Segoe Print, Comic Sans MS, cursive",
    normalizeFont = Function("AI_FONT_HANDWRITTEN_LEGACY", "AI_FONT_HANDWRITTEN", "AI_FONT_OPTIONS", `return (${functionSource(core, "normalizeAiFont")});`)(
      "Segoe Print, Comic Sans MS, cursive",
      handwritten,
      new Set(["ui-rounded, system-ui, sans-serif", handwritten, "Georgia, serif", "system-ui, sans-serif"]),
    ),
    setFont = functionSource(core, "setAiFont"),
    fitTextBox = functionSource(canvas, "fittedTextBoxContent"),
    renderTextBox = functionSource(canvas, "renderedTextBoxRecord"),
    prepareAgentItems = functionSource(agent, "canvasAgentPrepareCreateItems");
  assert.match(handwrittenOption, /value="Bradley Hand, Segoe Print, Comic Sans MS, cursive"/);
  assert.match(handwrittenOption, /\bselected\b/);
  assert.match(core, /AI_FONT_STORAGE_KEY = "penecho-ai-font"/);
  assert.match(core, /AI_FONT_HANDWRITTEN = "Bradley Hand, Segoe Print, Comic Sans MS, cursive"/);
  assert.match(core, /initialAiFont = normalizeAiFont\(storedAiFont\)/);
  assert.match(core, /aiFont: initialAiFont/);
  assert.equal(normalizeFont(null), handwritten);
  assert.equal(normalizeFont("not-an-option"), handwritten);
  assert.equal(normalizeFont("Segoe Print, Comic Sans MS, cursive"), handwritten);
  assert.equal(normalizeFont("Georgia, serif"), "Georgia, serif");
  assert.match(setFont, /state\.aiFont = normalizeAiFont\(value\)/);
  assert.match(setFont, /localStorage\.setItem\(AI_FONT_STORAGE_KEY, state\.aiFont\)/);
  assert.match(bootstrap, /document\.querySelector\("#aiFont"\)\.onchange = \(e\) => \{\s*setAiFont\(e\.target\.value\)/);
  assert.match(ai, /fontFamily = family \|\| AI_FONT_HANDWRITTEN/);
  assert.match(ai, /resolvedFamily = family \|\| AI_FONT_HANDWRITTEN/);
  assert.match(fitTextBox, /fontFamily = normalizeTextBoxFontFamily\(fontFamily\)/);
  assert.match(renderTextBox, /fittedTextBoxContent\(item\.text, fontSize, color, maxWidth, item\.fontFamily, pixelRatio\)/);
  assert.match(renderTextBox, /fontFamily:fitted\.fontFamily/);
  assert.match(prepareAgentItems, /fontFamily:state\.aiFont/);
  assert.match(app, /AI_FONT_HANDWRITTEN = "Bradley Hand, Segoe Print, Comic Sans MS, cursive"/);
});

test("AI drafts expose Select chrome and route body movement through selection", () => {
  const app = read("public/app.js"),
    pointerDownStart = app.indexOf('function handleCanvasPointerDown('),
    pointerDownEnd = app.indexOf('screen.addEventListener("pointermove"', pointerDownStart),
    pointerDown = app.slice(pointerDownStart, pointerDownEnd),
    specs = functionSource(app, "pendingChromeSpecs"),
    begin = functionSource(app, "beginObjectChromeMove");
  assert.match(specs, /standaloneDraftControl = \["write_text", "draw_formula", "draw"\]\.includes\(contentCommand\.tool\)/);
  assert.match(specs, /kind:"move"[\s\S]*?target:"pending"/);
  assert.match(begin, /spec\.target === "pending"[\s\S]*?beginPendingGesture\(event, "move", spec\.itemIndex\)/);
  assert.match(functionSource(app, "beginHandObjectResize"), /\["resize", "width", "height", "batch-resize"\]\.includes\(hit\)/);
  assert.doesNotMatch(pointerDown, /beginPendingGesture\(e, "move"/);
});

test("AI write_text validates and rasterizes the same 1000 characters", () => {
  const app = read("public/app.js"),
    validate = functionSource(app, "validate"),
    rasterScaleSource = functionSource(app, "rasterScaleFor"),
    rasterSource = functionSource(app, "textRasterMetrics"),
    imageSource = functionSource(app, "textImage"),
    capture = {},
    raster = vm.runInNewContext(`(${rasterSource})`, {
      AI_TEXT_MAX_LENGTH: 1000,
      SIZE: 20000,
      state: { aiFont: "system-ui" },
      rasterScaleFor: vm.runInNewContext(`(${rasterScaleSource})`),
      offscreen: () => ({ getContext: () => ({}) }),
      layoutText: (content) => {
        capture.content = content;
        return { lines: [content], widths: [content.length] };
      },
    });

  raster("x".repeat(1100), 24);
  assert.equal(capture.content.length, 1000);
  assert.match(app, /AI_TEXT_MAX_LENGTH = 1000/);
  assert.match(validate, /c\.text = c\.text\.slice\(0, AI_TEXT_MAX_LENGTH\)/);
  assert.match(rasterSource, /maxLength = AI_TEXT_MAX_LENGTH/);
  assert.match(imageSource, /maxLength = AI_TEXT_MAX_LENGTH/);
});

test("AI text, formula, and function-plot drafts expose copy and axis-resize controls", () => {
  const app = read("public/app.js"),
    css = read("public/style.css"),
    zh = read("public/locales/zh.js"),
    points = vm.runInNewContext(`(${functionSource(app, "draftActionPoints")})`, { SIZE: 20000 }),
    copyTextForCommand = vm.runInNewContext(`(${functionSource(app, "copyTextForCommand")})`),
    draw = functionSource(app, "drawPending"),
    drawBatch = functionSource(app, "drawPendingBatch"),
    hit = functionSource(app, "pendingHit"),
    start = functionSource(app, "startPending"),
    prepare = functionSource(app, "preparePendingItem"),
    update = functionSource(app, "updatePendingGesture"),
    pendingChrome = functionSource(app, "pendingChromeSpecs"),
    syncChrome = functionSource(app, "syncObjectChrome");
  const box = { x: 100, y: 120, w: 300, h: 180 },
    edge = points({ x: 0, y: 0, w: 300, h: 180 }, 14, true, true),
    radius = 14 * 0.54;

  assert.equal(copyTextForCommand({ tool: "write_text", text: "copy me" }), "copy me");
  assert.equal(copyTextForCommand({ tool: "draw_formula", latex: "x^2" }), "x^2");
  assert.equal(copyTextForCommand({ tool: "plot_function", expression: "x^2" }), "x^2");
  assert.deepEqual(Object.keys(points(box, 14, false, true)).sort(), ["accept", "cancel"]);
  assert.deepEqual(Object.keys(points(box, 14, true, true)).sort(), ["accept", "cancel", "copy"]);
  assert.deepEqual(Object.keys(points(box, 14, false)).sort(), ["item-accept", "item-cancel"]);
  assert.deepEqual(Object.keys(points(box, 14, true)).sort(), ["item-accept", "item-cancel", "item-copy"]);
  assert.equal(points(box, 14, true, true).copy.x, box.x + box.w / 2);
  assert.ok(edge.copy.y > 0 && edge.copy.y >= radius);
  assert.ok(Object.values(edge).every((point) => point.x >= radius && point.x <= 20000 - radius));
  assert.match(draw, /if \(p\.textCommand\) drawTextDraftSurface\(ctx, b\)/);
  assert.doesNotMatch(draw, /drawDraftActions/);
  assert.match(draw, /b\.x \+ b\.w \+ s \* 0\.08/);
  assert.match(draw, /b\.y \+ b\.h \+ s \* 0\.08/);
  assert.match(drawBatch, /if \(item\.textCommand\) drawTextDraftSurface\(ctx, box, index === p\.selectedIndex\)/);
  assert.doesNotMatch(drawBatch, /drawDraftActions/);
  assert.match(pendingChrome, /standaloneDraftControl = \["write_text", "draw_formula", "draw"\]\.includes\(contentCommand\.tool\)/);
  assert.match(pendingChrome, /kind:"move"[^\n]*standaloneDraftControl[\s\S]*?kind:"cancel"[^\n]*standaloneDraftControl[\s\S]*?kind:"accept"[^\n]*standaloneDraftControl[\s\S]*?kind:"copy"[^\n]*standaloneDraftControl/);
  assert.doesNotMatch(pendingChrome, /if \(standaloneDraftControl\)[\s\S]*?addObjectToolbarSpecs/);
  assert.match(syncChrome, /if \(spec\.objectToolbar \|\| spec\.standaloneDraftControl\)[\s\S]*?removeAttribute\("data-pe-button"\)[\s\S]*?removeAttribute\("data-pe-density"\)/);
  assert.match(css, /\.object-chrome-button \{[^}]*width: 36px;[^}]*height: 34px;/);
  assert.match(css, /\.object-chrome-button svg \{ width: 19px; height: 19px;/);
  assert.match(pendingChrome, /copyPendingText\(itemIndex\)/);
  assert.match(hit, /draftActionPoints\(box, s, pendingCopyable\(item\)\)/);
  assert.match(hit, /\.sort\(\(a, b\) => a\.distance - b\.distance \|\| b\.z - a\.z\)/);
  assert.match(start, /copyText = copyTextForCommand\(command\)/);
  assert.match(prepare, /copyText: copyTextForCommand\(c\)/);
  assert.match(update, /p\.scaleX = p\.scaleY = next/);
  assert.match(update, /g\.hit === "width"[\s\S]*?p\.scaleX = Math\.max/);
  assert.match(update, /g\.hit === "height"[\s\S]*?p\.scaleY = Math\.max/);
  assert.match(pendingChrome, /pendingCopyable\(target\)[\s\S]*?copyPendingText\(itemIndex\)/);
  assert.match(pendingChrome, /tool === "plot_function"[\s\S]*?addObjectToolbarSpecs[\s\S]*?kind:"copy"[\s\S]*?copyPendingText\(itemIndex\)/);
  assert.match(functionSource(app, "acceptPending"), /tool === "plot_function"[\s\S]*?addPendingPlotImage\(p, draftBounds\(p\)\)/);
  assert.match(functionSource(app, "commitPendingItem"), /tool === "plot_function"[\s\S]*?addPendingPlotImage\(item, box\)/);
  assert.match(functionSource(app, "addPendingPlotImage"), /imageRecord\([\s\S]*?plotExpression:expression[\s\S]*?state\.images\.push\(record\)/);
  assert.match(functionSource(app, "plotObjectImage"), /rendered = plot\(command\)[\s\S]*?MAX_IMAGE_DIMENSION[\s\S]*?canvasBlob\(image\)/);
  assert.match(css, /\.clipboard-copy-fallback\s*\{[^}]*left:\s*-10000px/);
  for (const key of ["copyText", "textCopied", "textCopyFailed"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
});

test("pending copy is exposed as a direct DOM chrome action", () => {
  const app = read("public/app.js"),
    specs = functionSource(app, "pendingChromeSpecs"),
    button = functionSource(app, "createObjectChromeButton");
  assert.match(specs, /pendingCopyable\(target\)[\s\S]*?kind:"copy"[\s\S]*?copyPendingText\(itemIndex\)/);
  assert.match(button, /kind === "move" \|\| kind === "toolbar" \|\| button\.disabled[\s\S]*?button\.penechoSpec\?\.activate\?\.\(button\)/);
  assert.match(functionSource(app, "objectChromeLabel"), /kind === "copy"[\s\S]*?t\("copyText"\)/);
});

test("AI text copy uses the original command with an insecure-context fallback and top status feedback", () => {
  const app = read("public/app.js"),
    clipboard = functionSource(app, "writeClipboardText"),
    fallback = functionSource(app, "fallbackCopyText"),
    copy = functionSource(app, "copyPendingText");

  assert.match(clipboard, /navigator\.clipboard\?\.writeText/);
  assert.match(clipboard, /fallbackCopyText\(text\)/);
  assert.match(fallback, /document\.createElement\("textarea"\)/);
  assert.match(fallback, /field\.value = text/);
  assert.match(fallback, /document\.execCommand\?\.\("copy"\)/);
  assert.match(fallback, /field\.remove\(\)/);
  assert.match(copy, /pendingCopyValue\(target\)/);
  assert.doesNotMatch(copy, /\.message|observedText|textContent|innerText/);
  assert.match(copy, /generation = \+\+state\.copyGeneration/);
  assert.match(copy, /if \(!stillPending\(\)\) return copied/);
  assert.match(copy, /setStatusKey\("copyText"\)/);
  assert.match(copy, /setStatusKey\("textCopied"\)/);
  assert.match(copy, /setTimeout\([\s\S]*COPY_STATUS_MS \+ 30/);
  assert.doesNotMatch(copy, /requestRender|copyFeedback/);
  assert.doesNotMatch(app, /function drawCopyFeedback/);
});

test("clipboard fallback runs before awaiting a native clipboard attempt", async () => {
  const source = functionSource(read("public/app.js"), "writeClipboardText");
  function harness({ fallbackResult, nativePromise }) {
    const calls = [],
      context = {
        debug: () => calls.push("debug"),
        document: { hasFocus: () => true },
        fallbackCopyText: () => {
          calls.push("fallback");
          return fallbackResult;
        },
        navigator: {
          clipboard: {
            writeText: () => {
              calls.push("native");
              return nativePromise;
            },
          },
        },
        window: { isSecureContext: true },
      };
    return { calls, copy: vm.runInNewContext(`(async ${source})`, context) };
  }

  const synchronousFallback = harness({ fallbackResult: true, nativePromise: Promise.resolve() }),
    fallbackResult = synchronousFallback.copy("copy me");
  assert.deepEqual(synchronousFallback.calls, ["fallback"]);
  assert.equal(await fallbackResult, true);

  let resolveNative;
  const acceptedNative = new Promise((resolve) => {
      resolveNative = resolve;
    }),
    secureNative = harness({ fallbackResult: false, nativePromise: acceptedNative }),
    nativeResult = secureNative.copy("copy me");
  assert.deepEqual(secureNative.calls, ["fallback", "native"]);
  resolveNative();
  assert.equal(await nativeResult, true);

  let rejectNative;
  const rejectedNative = new Promise((_, reject) => {
      rejectNative = reject;
    }),
    failed = harness({ fallbackResult: false, nativePromise: rejectedNative }),
    failedResult = failed.copy("copy me");
  assert.deepEqual(failed.calls, ["fallback", "native"]);
  rejectNative(Error("permission denied"));
  assert.equal(await failedResult, false);
  assert.deepEqual(failed.calls, ["fallback", "native", "debug"]);
});

test("AI text copy ignores stale clipboard completions and stale status timers", async () => {
  const source = functionSource(read("public/app.js"), "copyPendingText");
  function harness(writeClipboardText) {
    const pending = { copyText: "copy me" },
      state = { pending, copyGeneration: 0, statusKey: "draftReady" },
      statuses = [],
      timers = [];
    return {
      pending,
      state,
      statuses,
      timers,
      copy: vm.runInNewContext(`(async ${source})`, {
        COPY_STATUS_MS: 1600,
        pendingTextTarget: (value) => value,
        pendingCopyValue: (value) => value?.copyText,
        setStatusKey: (key) => {
          state.statusKey = key;
          statuses.push(key);
        },
        setTimeout: (callback) => {
          timers.push(callback);
        },
        state,
        writeClipboardText,
      }),
    };
  }

  let finishStaleCopy;
  const stale = harness(() => new Promise((resolve) => {
    finishStaleCopy = resolve;
  }));
  const staleResult = stale.copy();
  stale.state.pending = null;
  stale.state.statusKey = "merged";
  finishStaleCopy(true);
  assert.equal(await staleResult, true);
  assert.deepEqual(stale.statuses, ["copyText"]);
  assert.equal(stale.state.statusKey, "merged");
  assert.equal(stale.timers.length, 0);

  const current = harness(async () => true);
  await current.copy();
  const firstTimer = current.timers[0];
  await current.copy();
  const statusesBeforeOldTimer = current.statuses.slice();
  firstTimer();
  assert.deepEqual(current.statuses, statusesBeforeOldTimer);
  assert.equal(current.state.copyGeneration, 2);
});

test("batch drafts paint every body before their chrome", () => {
  const source = functionSource(read("public/app.js"), "drawPendingBatch"),
    events = [],
    context = {
      beginPath() {},
      clip() {},
      drawImage(image) {
        events.push(`body:${image.id}`);
      },
      lineTo() {},
      moveTo() {},
      rect() {},
      restore() {},
      save() {},
      setLineDash() {},
      stroke() {},
      strokeRect() {
        events.push("frame");
      },
    },
    draw = vm.runInNewContext(`(${source})`, {
      batchBounds: () => ({ x: 0, y: 0, w: 300, h: 180 }),
      ctx: context,
      drawResizeHandle: () => {},
      drawTextDraftSurface: (_ctx, box) => events.push(`surface:${box.id}`),
      pendingItemBounds: (item) => item.box,
      pendingCopyable: (item) => Boolean(item.textCommand),
      state: { scale: 1 },
    }),
    pending = {
      selectedIndex: 0,
      items: [
        { box: { id: 0, x: 0, y: 0, w: 180, h: 120 }, image: { id: 0, width: 180, height: 120 }, scaleX: 1, scaleY: 1, textCommand: { text: "first" } },
        { box: { id: 1, x: 60, y: 30, w: 180, h: 120 }, image: { id: 1, width: 180, height: 120 }, scaleX: 1, scaleY: 1, textCommand: { text: "second" } },
      ],
    };

  draw(pending);
  const firstChrome = events.indexOf("frame"),
    lastBody = Math.max(events.indexOf("body:0"), events.indexOf("body:1"));
  assert.ok(firstChrome > lastBody);
});

test("batch draft action controls provide a 44px touch target", () => {
  const app = read("public/app.js"),
    points = vm.runInNewContext(`(${functionSource(app, "draftActionPoints")})`, { SIZE: 20000 }),
    hit = vm.runInNewContext(`(${functionSource(app, "pendingHit")})`, {
      clientPoint: (event) => event,
      draftActionPoints: points,
      draftBounds: (pending) => pending.box,
      pendingItemBounds: (item) => item.box,
      pendingCopyable: (item) => Boolean(item.copyText || item.textCommand?.text),
      state: { scale: 1 },
    }),
    box = { x: 100, y: 120, w: 300, h: 180 },
    pending = { box, selectedIndex: 0, items: [{ box, textCommand: { text: "copy" } }] },
    copy = points(box, 14, true)["item-copy"];

  assert.deepEqual({ ...hit(pending, { x: copy.x + 20, y: copy.y, pointerType: "touch" }) }, { hit: "item-copy", itemIndex: 0 });
  assert.equal(hit(pending, { x: copy.x + 20, y: copy.y, pointerType: "mouse" }), null);
});

test("a multi-tool AI draft has one uniform group corner resize", () => {
  const app = read("public/app.js"),
    drawBatch = functionSource(app, "drawPendingBatch"),
    hit = functionSource(app, "pendingHit"),
    resize = vm.runInNewContext(`(${functionSource(app, "resizePendingBatchItems")})`, { SELECT: selectionMath }),
    items = [
      { x: 100, y: 100, scaleX: 1, scaleY: 1 },
      { x: 300, y: 200, scaleX: 0.5, scaleY: 2 },
    ],
    starts = items.map((item) => ({ ...item })),
    startBox = { x: 100, y: 100, w: 300, h: 300 };

  assert.match(drawBatch, /drawResizeHandle\(ctx, batch, s\)/);
  assert.match(hit, /addControl\("batch-resize",\s*\{ x: b\.x \+ b\.w, y: b\.y \+ b\.h \}/);
  const target = resize(items, startBox, starts, { x: 700, y: 700 }, 40, 1000);
  assert.deepEqual({ ...target }, { x: 100, y: 100, w: 600, h: 600 });
  assert.deepEqual(items.map((item) => ({ ...item })), [
    { x: 100, y: 100, scaleX: 2, scaleY: 2 },
    { x: 500, y: 300, scaleX: 1, scaleY: 4 },
  ]);
  const bounded = resize(items, target, items.map((item) => ({ ...item })), { x: 5000, y: 5000 }, 40, 800);
  assert.ok(bounded.x + bounded.w <= 800 && bounded.y + bounded.h <= 800);
});

test("PenEcho Agent internet search is configured in Settings and toggled beside attachments", () => {
  const html=read("public/index.html"),app=read("public/app.js"),server=read("src/server/main.js"),runtime=read("src/server/canvas-agent/runtime.mjs"),css=read("public/style.css"),zh=read("public/locales/zh.js");
  for(const id of ["settingsOpenSearch","settingsSearchEntryStatus","settingsDeepSeekSearchProvider","settingsOpenCodeGoSearchSetup","settingsDeepSeekSearchApiKey","settingsDeepSeekSearchSaved","settingsTavilyApiKey","settingsTavilySaved","settingsDuckDuckGoReady","settingsSearchTestResults","settingsSearchTestFlashLabel","settingsTestSearch","canvasAgentSearch"]) assert.match(html,new RegExp(`id="${id}"`));
  assert.ok(html.indexOf('id="canvasAgentAttach"')<html.indexOf('id="canvasAgentSearch"'));
  assert.ok(html.indexOf('id="canvasAgentSearch"')<html.indexOf('id="canvasAgentFileInput"'));
  assert.match(app,/settingsOpenSearch\?\.addEventListener\("click", \(\) => openConfiguration\("search"\)\)/);
  assert.match(app,/canvasAgentSearch\.setAttribute\("aria-disabled",String\(!canvasAgent\.searchConfigured\)\)/);
  assert.match(app,/canvasAgentSearch\.dataset\.tooltip = canvasAgent\.searchConfigured \? "" : label/);
  assert.match(app,/localStorage\.getItem\(CANVAS_AGENT_SEARCH_ENABLED_KEY\) !== "false"/);
  assert.match(app,/settingsTestSearch\?\.addEventListener\("click", \(\) => void testCanvasSearch\(\)\)/);
  assert.match(app,/fetch\("\/api\/settings\/search\/test"/);
  assert.ok(html.indexOf('id="settingsSearchTestResults"')<html.indexOf('id="settingsTestSearch"'));
  assert.ok(html.indexOf('id="settingsTestSearch"')<html.indexOf('id="settingsSave"'));
  assert.match(app,/webSearchEnabled:canvasAgent\.searchEnabled/);
  assert.match(server,/deepSeekSearchProvider:DEEPSEEK_SEARCH_PROVIDER/);
  assert.match(server,/hasDeepSeekSearchApiKey:Boolean\(DEEPSEEK_SEARCH_API_KEY\)/);
  assert.match(server,/hasTavilyApiKey:Boolean\(TAVILY_API_KEY\)/);
  assert.match(server,/url\.pathname === "\/api\/settings\/search\/test"/);
  assert.match(server,/deepseekApiKey:DEEPSEEK_SEARCH_API_KEY\|\|""/);
  assert.match(server,/tavilyApiKey:TAVILY_API_KEY\|\|""/);
  assert.match(runtime,/name:'deepseek_search'/);
  assert.match(runtime,/model:DEEPSEEK_SEARCH_MODEL/);
  assert.match(runtime,/type:'web_search_20250305'/);
  assert.match(runtime,/endpoint:'https:\/\/opencode\.ai\/zen\/go\/v1\/messages'/);
  assert.match(runtime,/name:'tavily_search'/);
  assert.doesNotMatch(runtime,/name:'load_search_skill'/);
  assert.match(runtime,/name:'research_search'/);
  assert.match(runtime,/name:'github_repository_search'/);
  assert.match(runtime,/name:'duckduckgo_search'/);
  assert.match(runtime,/name:'stock_symbol_search'/);
  assert.match(runtime,/name:'stock_market_data'/);
  assert.match(runtime,/export async function testCanvasSearchProviders/);
  assert.match(runtime,/include_answer:false, include_raw_content:false, include_images:false/);
  assert.match(css,/\.canvas-agent-composer \.canvas-agent-search\.active \{ color: var\(--studio-accent, #4f46e5\); background: transparent; \}/);
  assert.match(css,/content: attr\(data-tooltip\)/);
  assert.match(css,/\.settings-search-test-results output\[data-state="available"\]/);
  for(const text of ["互联网搜索","Flash 密钥来源","OpenCode Go","中国托管的 DeepSeek 模型","复制 Go API 密钥","Flash 搜索 API 密钥","Tavily API 密钥","DuckDuckGo 后备已就绪","当前搜索状态","测试搜索","尚未测试","未配置","可用 · 已返回结果","内置搜索已就绪","查询股票数据"]) assert.match(zh,new RegExp(text));
});

test("Widget interaction stays centered with separated trailing actions at every toolbar width", () => {
  const app = read("public/app.js"),
    minimum = vm.runInNewContext(`(${functionSource(app, "objectToolbarMinimumWidth")})`),
    finalize = vm.runInNewContext(`(${functionSource(app, "finalizeObjectToolbarWidths")})`, {
      objectToolbarMinimumWidth:minimum,
    }),
    state = { panX:0, panY:0, scale:1 },
    position = vm.runInNewContext(`(${functionSource(app, "objectChromePosition")})`, {
      state,
      view:{clientWidth:1200,clientHeight:800,getBoundingClientRect:()=>({left:0,top:0})},
      screenObjectBox: (box) => ({
        left:box.x * state.scale,
        top:box.y * state.scale,
        width:box.w * state.scale,
        height:box.h * state.scale,
      }),
    }),
    box = {x:100,y:300,w:900,h:200},
    epsilon = 1e-9;

  const makeSpecs = (interactWidth, toolWidths, decisions = true) => {
    const toolbar = {key:"toolbar",objectToolbar:true,baseHeight:34,toolbarHasDecisions:decisions},
      leading = {
        kind:"cancel", objectToolbarItem:true, objectToolbarKey:"toolbar",
        toolbarSlot:"leading", baseWidth:28, baseHeight:28, toolbarHasDecisions:decisions,
      },
      interact = {
        kind:"interact", objectToolbarItem:true, objectToolbarKey:"toolbar",
        toolbarSlot:"tool", toolbarOrder:-1, toolbarItemCount:toolWidths.length,
        baseWidth:interactWidth, baseHeight:28, toolbarHasDecisions:decisions,
      },
      tools = toolWidths.map((baseWidth, index) => ({
        kind:index === 1 && baseWidth === 92 ? "refine" : "copy",
        objectToolbarItem:true, objectToolbarKey:"toolbar", toolbarSlot:"tool",
        toolbarOrder:index, toolbarItemCount:toolWidths.length,
        baseWidth, baseHeight:28, toolbarHasDecisions:decisions,
      })),
      trailing = {
        kind:"accept", objectToolbarItem:true, objectToolbarKey:"toolbar",
        toolbarSlot:"trailing", baseWidth:28, baseHeight:28, toolbarHasDecisions:decisions,
      };
    return { toolbar, specs:decisions ? [toolbar, leading, interact, ...tools, trailing] : [toolbar, interact, ...tools] };
  };

  const assertToolbarLayout = ({toolbar, specs}, zoom, label) => {
    state.scale = zoom;
    finalize(specs);
    const toolbarPosition = position(box, "toolbar", "", toolbar);
    assert.ok(toolbarPosition, `${label}: toolbar should be positioned at scale ${zoom}`);
    const expectedWidth = Math.max(toolbar.minimumWidth, box.w * zoom);
    assert.ok(Math.abs(toolbarPosition.baseWidth - expectedWidth) < epsilon, `${label}: toolbar width`);
    assert.equal(toolbarPosition.scale, 1, `${label}: toolbar stays screen-sized`);
    const known = new Map([["toolbar", toolbarPosition]]),
      itemSpecs = specs.slice(1),
      positions = itemSpecs.map((spec) => {
        const itemPosition = position(box, spec.kind, "", spec, known);
        assert.ok(itemPosition, `${label}: ${spec.kind} should be positioned at scale ${zoom}`);
        return itemPosition;
      }),
      toolbarRight = toolbarPosition.x + toolbarPosition.baseWidth;

    let previousRight = toolbarPosition.x;
    for (let index = 0; index < positions.length; index++) {
      const itemPosition = positions[index],
        itemWidth = itemPosition.baseWidth * (itemPosition.scale || 1),
        itemRight = itemPosition.x + itemWidth;
      assert.ok(itemPosition.x >= toolbarPosition.x - epsilon, `${label}: item ${index} starts inside toolbar`);
      assert.ok(itemRight <= toolbarRight + epsilon, `${label}: item ${index} ends inside toolbar`);
      assert.ok(itemPosition.x >= previousRight - epsilon, `${label}: item ${index} does not overlap the preceding action`);
      previousRight = itemRight;
      if (itemSpecs[index].kind === "interact") {
        assert.equal(itemPosition.scale, 1, `${label}: interact stays screen-sized`);
        assert.equal(itemPosition.baseWidth, itemSpecs[index].baseWidth, `${label}: interact keeps its width`);
        assert.ok(
          Math.abs(itemPosition.x + itemWidth / 2 - (toolbarPosition.x + toolbarPosition.baseWidth / 2)) < epsilon,
          `${label}: interact remains centered`,
        );
      }
    }
    if (zoom < 1) assert.equal(toolbarPosition.baseWidth, toolbar.minimumWidth, `${label}: tiny Widget uses the toolbar minimum`);
  };

  for (const interactWidth of [76, 120]) {
    for (const toolCount of [1, 2, 5]) {
      const layout = makeSpecs(interactWidth, Array.from({length:toolCount}, () => 28));
      for (const zoom of [1, 0.1, 0.01]) {
        assertToolbarLayout(layout, zoom, `interact ${interactWidth}px / ${toolCount} tools`);
      }
      const decisionless = makeSpecs(interactWidth, Array.from({length:toolCount}, () => 28), false);
      for (const zoom of [1, 0.1, 0.01]) {
        assertToolbarLayout(decisionless, zoom, `decisionless interact ${interactWidth}px / ${toolCount} tools`);
      }
    }
  }

  const mixed = makeSpecs(120, [28, 92, 28, 28, 92]);
  for (const zoom of [1, 0.1, 0.01]) {
    assertToolbarLayout(mixed, zoom, `interact 120px / mixed tools including 92px refine`);
  }
});

test("Widget right-click lists the toolbar without decisions and interaction shows a status bar", () => {
  const app = read("public/app.js"),
    css = read("public/style.css"),
    zh = read("public/locales/zh.js"),
    chromeSpecs = functionSource(app, "objectChromeSpecs"),
    widgetBranch = chromeSpecs.slice(chromeSpecs.indexOf("prefix:`widget:${handTarget.id}`"), chromeSpecs.indexOf("pendingChromeSpecs(specs, state.pending)"));

  assert.match(app, /view\.addEventListener\('dblclick'[\s\S]*?handObjectToolbarTargetAtPoint\(clientPoint\(event\)\)[\s\S]*?showImagePresentation\(target\.object\)[\s\S]*?enterWidgetInteraction\(target\.object\)/);
  assert.match(app, /view\.addEventListener\('contextmenu', \(event\) => \{ showWidgetContextToolbar\(event\); \}\)/);
  assert.doesNotMatch(app, /screen\.addEventListener\("contextmenu"/);
  assert.match(functionSource(app, "showWidgetContextToolbar"), /event\.preventDefault\(\)[\s\S]*?state\.viewMode \|\| state\.spacePan \|\| state\.interactingWidgetId[\s\S]*?\["pen", "hand", "select"\]\.includes\(state\.mode\)[\s\S]*?canvasWidgetAtEvent\(event\)[\s\S]*?showHandObjectToolbar\("widget", widget\)/);
  assert.match(functionSource(app, "enterWidgetInteraction"), /state\.viewMode[\s\S]*?setCanvasViewTool\("select"\)[\s\S]*?state\.mode !== "select"[\s\S]*?setCanvasMode\("select"\)[\s\S]*?setWidgetInteraction\(widget\)/);
  assert.match(functionSource(app, "canvasWidgetInteractionChromeTarget"), /#canvasViewActions, #canvasNavigationActions, \.canvas-fit-contents, \.canvas-navigation-lock, \.object-chrome-button, \.widget-interaction-status/);
  assert.match(app, /key:`widget:\$\{widget\.id\}:interact`[\s\S]*?activate:\(\) => \{ enterWidgetInteraction\(widget\); \}/);
  assert.match(widgetBranch, /decisions:false[\s\S]*?addWidgetToolSpecs\(specs, handTarget, \{[\s\S]*?decisions:false/);
  assert.doesNotMatch(widgetBranch, /widgetDelete|widgetAccept|kind:"cancel"|kind:"accept"/);
  assert.match(chromeSpecs, /prefix:`pending-widget:\$\{widget\.id\}`[\s\S]*?cancelLabel:t\("widgetDiscard"\)[\s\S]*?acceptLabel:t\("widgetAccept"\)/);
  assert.match(app, /widgetInteracting: "Interacting"/);
  assert.match(zh, /widgetInteracting: "正在交互中"/);
  assert.match(functionSource(app, "syncWidgetInteractionStatus"), /state\.interactingWidgetId[\s\S]*?screenObjectBox\(widgetBox\(widget\)\)[\s\S]*?label\.textContent = t\("widgetInteracting"\)[\s\S]*?--widget-interaction-status-x/);
  assert.match(functionSource(app, "renderInteractionLayer"), /syncObjectChrome\(\)[\s\S]*?syncWidgetInteractionStatus\(\)/);
  assert.match(css, /\.widget-interaction-status \{[^}]*z-index: 5[^}]*pointer-events: none[^}]*font: 650 12\.5px/);
  assert.match(css, /\.widget-interaction-status\[hidden\] \{ display: none; \}/);
  assert.match(css, /#viewport\.canvas-navigation-previewing :is\([^)]*\.widget-interaction-status\)/);
  assert.match(css, /body\[data-theme="studio"\] \.widget-interaction-status \{[^}]*color: var\(--studio-accent-strong\)/);
});

test("opening Widget toolbar keeps canonical front order when Interact hides its material", () => {
  const app = read("public/app.js");
  for (const entry of ["focusHandObject", "showHandObjectToolbar"]) {
    const rear = {id:"rear",styleRule:{style:{}}}, front = {id:"front",styleRule:{style:{}}},
      state = {widgets:[rear,front],userRevision:0,mode:"select",frontCanvasObjectKind:"image",handToolbarTargets:new Map()},
      selectedWidgetMaterial = {hidden:false,classList:{remove(){}}}, styles = new Map(),
      context = vm.createContext({state,selectedWidgetMaterial,Date,Set,
        HAND_OBJECT_TOOLBAR_VISIBLE_MS:10000,
        widgetLayer:{},imageMaterialLayer:{},placedContentLayer:{},textEditorLayer:{},
        runtimeElementStyle:(_,key)=>{if(!styles.has(key))styles.set(key,{setProperty(){}});return styles.get(key);},
        handToolbarKey:(kind,id)=>`${kind}:${id}`,
        handToolbarRecord:key=>state.handToolbarTargets.get(key),
        handToolbarObject:record=>state.widgets.find(w=>w.id===record.id),
        recordWidgetsBefore(){},saveUserCanvasChange(){},
        beginWidgetEdit:()=>true,finishHandToolbarHide(){},scheduleHandObjectToolbarTick(){},
        requestInteractionLayerRender(){},refreshHandObjectToolbar(){},
      });
    for (const name of ["syncCanvasObjectLayerOrder","setCanvasObjectFrontKind","syncWidgetLayerOrder","setWidgetStackIndex","bringHtmlWidgetToFront","commitWidgetToolbarFront","ensureHandToolbarRecord","focusHandObject","activateHandObjectToolbar","showHandObjectToolbar","syncSelectedWidgetMaterial"]) {
      vm.runInContext(functionSource(app,name),context);
    }
    context[entry]("widget",rear);
    assert.deepEqual(state.widgets.map(w=>w.id),["front","rear"],entry);
    assert.equal(state.frontCanvasObjectKind,"widget");
    assert.equal(state.userRevision,1,"clicking alone marks saved content changed");
    context[entry]("widget",rear);
    assert.equal(state.userRevision,1,"refocusing the front Widget creates no extra save");
    const beforeLayer = styles.get("widget-layer-stack").zIndex;
    state.interactingWidgetId = rear.id;
    context.syncSelectedWidgetMaterial(null);
    assert.equal(styles.get("widget-layer-stack").zIndex,beforeLayer);
    assert.ok(Number(rear.styleRule.style.zIndex)>Number(front.styleRule.style.zIndex));
    assert.equal(styles.get("widget-layer-stack").zIndex,"3","Widget stays above ink and placed content");
  }
});
