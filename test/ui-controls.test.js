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
  for (const id of ["historySaveCurrent", "newCanvasDialog", "newDiscard", "newSaveCopy", "newOverwrite", "saveCanvasBtn"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /id="currentSnapshotLabel"[^>]*hidden/);
  assert.match(css, /\.new-canvas-dialog \.current-snapshot\[hidden\]\s*\{\s*display:\s*none/);
  for (const id of ["historyNew", "newCanvasCancel"]) assert.doesNotMatch(html, new RegExp(`id="${id}"`));
  assert.match(html, /class="new-canvas-actions"[\s\S]*?id="newDiscard"[\s\S]*?class="new-canvas-action-group"[\s\S]*?id="newOverwrite"[\s\S]*?id="newSaveCopy"/);
  assert.match(css, /\.new-canvas-actions\s*\{[^}]*align-items:\s*center;[^}]*justify-content:\s*space-between/);
  assert.match(css, /\.new-canvas-action-group\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*flex-end/);
  assert.doesNotMatch(css, /\.new-canvas-actions\s*\{[^}]*grid-template-columns:\s*1fr 1fr/);
  assert.match(app, /currentSnapshotId:\s*null/);
  assert.match(app, /saveSnapshot\(\{\s*overwriteId\s*=\s*null,\s*name\s*=\s*null,\s*location\s*=\s*state\.snapshotLocation\s*\}/);
  assert.match(app, /completeNewCanvas\("overwrite"\)/);
  assert.match(app, /function startBlankCanvas\(\)/);
  assert.match(functionSource(app, "startBlankCanvas"), /clearTextEditors\(\)/);
  assert.match(functionSource(app, "startBlankCanvas"), /state\.aiDraftReturnMode = null[\s\S]*?setCanvasNavigationLocked\(false\)[\s\S]*?setCanvasMode\("pen", \{/);
  assert.match(functionSource(app, "loadSnapshot"), /clearTextEditors\(\)/);
  assert.match(functionSource(app, "renderSnapshotList"), /runSnapshotLoadAction\(load, \(\) => requestLoadSnapshot\(item\.id, location\)\)/);
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
  const effortSelect = html.match(/<select id="settingsEffort"[\s\S]*?<\/select>/)?.[0] || "";
  assert.match(effortSelect, /required/);
  assert.doesNotMatch(effortSelect, /value=""|Provider default/);
  for (const effort of ["none", "low", "medium", "high", "xhigh", "max"]) assert.match(effortSelect, new RegExp(`value="${effort}"`));
  assert.match(html, /data-effort="config"[^>]*>[\s\S]*?Configured/);
  assert.match(html, /id="settingsTestConnection"[^>]*data-i18n="settingsTestConnection"/);
  assert.match(html, /id="settingsInstallCli"[^>]*hidden[^>]*data-i18n="settingsInstallCli"/);
  for (const endpoint of [
    "https://api.moonshot.ai/v1", "https://api.moonshot.cn/v1", "https://api.kimi.com/coding/v1",
    "https://api.minimax.io/v1", "https://api.minimax.io/anthropic", "https://api.minimaxi.com/v1", "https://api.minimaxi.com/anthropic",
  ]) assert.match(app, new RegExp(endpoint.replaceAll(".", "\\.")));
  for (const model of ["k3", "kimi-k3", "MiniMax-M3", "MiniMax-M2.7"]) assert.match(app, new RegExp(`"${model.replaceAll(".", "\\.")}"`));
  assert.match(app, /function connectionTitle\(connection\)/);
  assert.match(app, /return connection\.provider === "api" \? connection\.apiModel \|\| "API" : connection\.cliModel/);
  assert.match(functionSource(app, "renderConnectionLists"), /settings-connection-quick\$\{connection\.active \? " active" : ""\}[\s\S]*?editing = settings\.editingConnectionId === connection\.id[\s\S]*?settings-connection-item\$\{editing \? " editing" : ""\}/);
  assert.match(functionSource(app, "fillConnectionEditor"), /settings\.editingConnectionId = connection\?\.id \|\| null[\s\S]*?renderConnectionLists\(\)/);
  assert.match(functionSource(app, "hideConnectionEditor"), /settings\.editingConnectionId = null[\s\S]*?renderConnectionLists\(\)/);
  assert.match(functionSource(app, "defaultConnectionEffort"), /return "medium"/);
  assert.match(functionSource(app, "fillConnectionEditor"), /connection\?\.effort \|\| defaultConnectionEffort\(provider\)/);
  assert.match(functionSource(app, "testCanvasConnection"), /\/api\/settings\/connections\/test[\s\S]*?settings\.editingConnectionId[\s\S]*?body\?\.installable/);
  assert.match(functionSource(app, "installCanvasCli"), /penechoDesktop\.installCli\(provider\)[\s\S]*?settingsCliPath\.value = result\.executable[\s\S]*?testCanvasConnection\(\)/);
  assert.match(css, /\.settings-connection-item\.editing\s*\{/);
  assert.doesNotMatch(css, /\.settings-connection-item\.active\s*\{/);
  assert.match(css, /\.settings-panel, \.configuration-panel\s*\{[^}]*color-scheme:\s*light[^}]*--panel-raised:\s*#ffffff/);
  assert.match(css, /\.settings-save\s*\{[^}]*color:\s*#fff;[^}]*background:\s*#4f46e5/);
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

test("closing Settings moves focus outside before hiding it from accessibility APIs", () => {
  const closeSettings = functionSource(read("public/app.js"), "closeSettings");
  const focusMove = closeSettings.indexOf("settingsLayer.contains(document.activeElement)");
  const hideLayer = closeSettings.indexOf("settingsLayer.hidden = true");
  const hideFromAccessibility = closeSettings.indexOf('settingsLayer.setAttribute("aria-hidden", "true")');
  assert.ok(focusMove >= 0 && focusMove < hideLayer && hideLayer < hideFromAccessibility);
  assert.match(closeSettings, /restoreTarget\?\.focus\(\{ preventScroll:true \}\)/);
});

test("canvas photos use one picker, editable image records, side action bar, and dirty Auto AI", () => {
  const html = read("public/index.html"), app = read("public/app.js"), zh = read("public/locales/zh.js"), css = read("public/style.css"),
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
  assert.match(app, /state\.mode !== "hand"[\s\S]{0,120}?beginCanvasPointerAction\(e, clientPoint\(e\)\)/);
  assert.match(functionSource(app, "objectChromeSpecs"), /target:"image"/);
  const mergeImage = functionSource(app, "mergeImage"),
    beginImageGesture = functionSource(app, "beginImageGesture"),
    addImageFile = functionSource(app, "addImageFile"),
    imageControlHit = functionSource(app, "imageControlHit"),
    imageRecord = functionSource(app, "imageRecord"),
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
  assert.match(addImageFile, /enterManualImageHandMode\(\)[\s\S]{0,80}?beginImageEdit\(item\)/);
  assert.match(functionSource(app, "finishManualImageHandMode"), /imageHandReturnMode/);
  for (const name of ["acceptImageEdit", "cancelImageEdit", "deleteImage", "mergeImage"]) {
    assert.match(functionSource(app, name), /finishManualImageHandMode\(\)/);
  }
  assert.doesNotMatch(beginImageGesture, /result\.hit === "(accept|merge|cancel)"/);
  assert.match(mergeImage, /recordBefore\(tx, ty\)[\s\S]{0,160}?drawImage\(item\.image/);
  assert.match(mergeImage, /extendInkBounds\(key\(tx, ty\)/);
  assert.match(mergeImage, /state\.images\.filter/);
  assert.match(mergeImage, /trackMergedImageAsDirty\(item, box\)[\s\S]*?recomputeDirtyBounds\(\)[\s\S]*?state\.autoEligible\s*=\s*true[\s\S]*?schedule\(\)[\s\S]*?save\(\)/);
  assert.doesNotMatch(imageControlHit, /draftActionPoints|merge/);
  assert.doesNotMatch(drawImageChrome, /drawDraftActions|drawImageMergeAction/);
  assert.deepEqual({ ...resizeImage(resizeStart, { x:15100, y:0 }, "width") }, { ...resizeStart, w:15000 });
  assert.deepEqual({ ...resizeImage(resizeStart, { x:0, y:15200 }, "height") }, { ...resizeStart, h:15000 });
  assert.deepEqual({ ...resizeImage(resizeStart, { x:15100, y:10200 }, "resize") }, { ...resizeStart, w:15000, h:10000 });
  assert.doesNotMatch(resizeImageBox, /6000|MAX_IMAGE_PIXELS/);
  assert.doesNotMatch(imageRecord, /n\(item\.(?:w|h), 80, 6000\)|item\.w \* item\.h > MAX_IMAGE_PIXELS/);
  for (const id of ["imageEditBar", "imagePlaceBtn", "imageMergeBtn", "imageDeleteBtn"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(css, /\.image-edit-bar \{/);
  assert.match(css, /\.image-action-hint \{/);
  assert.match(app, /function positionImageEditBar\(\)/);
  assert.match(renderInteractionLayer, /positionImageEditBar\(\)/);
  assert.match(app, /imagePlaceButton\.onclick = \(\) => acceptImageEdit\(\{ showHint:true \}\)/);
  assert.match(app, /imageMergeButton\.onclick =[\s\S]{0,100}?mergeImage\(item, \{ showHint:true \}\)/);
  assert.match(app, /imageDeleteButton\.onclick =[\s\S]{0,80}?deleteImage\(item\)/);
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
  for (const key of ["addImage", "imageAdded", "imageSelected", "imageDeleted", "imageMerged", "imageEditBarLabel", "imagePlace", "imagePlaceHint", "imageMerge", "imageMergeHint", "imageDelete", "imageDeleteHint", "snapshotImages"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
});

test("hand is the only object interaction mode and uses dedicated, clamped move handles", () => {
  const html = read("public/index.html"),
    app = read("public/app.js"),
    css = read("public/style.css"),
    zh = read("public/locales/zh.js"),
    handIndex = html.indexOf('data-mode="hand"'),
    penIndex = html.indexOf('data-mode="pen"'),
    pointerDown = app.slice(app.indexOf('screen.addEventListener("pointerdown"'), app.indexOf('screen.addEventListener("pointermove"')),
    mode = functionSource(app, "setCanvasMode"),
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
    chromePosition = vm.runInNewContext(`(${functionSource(app, "objectChromePosition")})`, {
      state:{ panX:0, panY:-180, scale:1 },
      view:{ clientWidth:900, clientHeight:600 },
      screenObjectBox:(box) => ({ left:box.x, top:box.y - 180, width:box.w, height:box.h }),
    });

  assert.ok(handIndex >= 0 && handIndex < penIndex);
  assert.match(html, /id="handToolBtn"[^>]*data-mode="hand"[^>]*aria-pressed="false"[^>]*data-i18n-aria="hand"/);
  assert.match(app, /mode:\s*"pen"/);
  assert.match(app, /hand:\s*"Hand tool: move canvas and objects"/);
  assert.match(zh, /hand:\s*"小手：移动画布和对象"/);
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
  assert.match(acceptImageEdit, /options\.showHint[\s\S]*?showHandStatusHint\("image-confirmed"/);
  assert.match(mergeImage, /options\.showHint[\s\S]*?showHandStatusHint\("image-merged"/);
  assert.match(acceptWidgetEdit, /options\.showHint[\s\S]*?showHandStatusHint\("widget-confirmed"/);
  assert.match(acceptPendingWidget, /options\.showHint[\s\S]*?showHandStatusHint\("widget-draft-confirmed"/);
  assert.match(acceptAnimationEdit, /options\.showHint[\s\S]*?showHandStatusHint\("animation-confirmed"/);
  assert.match(confirmTextEditor, /options\.showHint[\s\S]*?showHandStatusHint\("text-confirmed"/);
  assert.match(acceptPending, /options\.showHint[\s\S]*?showHandStatusHint\("ai-draft-confirmed"/);
  assert.match(app, /imagePlaceButton\.onclick = \(\) => acceptImageEdit\(\{ showHint:true \}\)/);
  assert.match(app, /mergeImage\(item, \{ showHint:true \}\)/);
  assert.match(app, /acceptPending\(\{ showHint:true \}\)/);
  assert.match(app, /acceptPendingWidget\(\{ showHint:true \}\)/);
  assert.match(mode, /view\.classList\.toggle\("hand-mode", mode === "hand"\)/);
  assert.match(mode, /requestInteractionLayerRender\(\)/);
  assert.match(mode, /finalizingPendingWidgetForEraser = mode === "eraser"[\s\S]*?\["hand", "pen"\]\.includes\(state\.mode\)[\s\S]*?acceptPendingWidget\(\{ restoreMode:false, allowRevisionMismatch:true \}\)/);
  assert.match(mode, /leavingDraftHand[\s\S]*?acceptPending\(\{ restoreMode:false \}\)/);
  assert.match(functionSource(app, "beginCanvasPointerAction"), /state\.mode === "hand"[\s\S]*?state\.panGesture[\s\S]*?setCanvasCursor\("grabbing"\)/);
  assert.ok(pointerDown.indexOf('state.mode !== "hand"') < pointerDown.indexOf("widgetPointerHit(point"));
  assert.match(pointerDown, /widgetPointerHit\(point, e\.pointerType, false\)/);
  assert.match(pointerDown, /imagePointerHit\(point, e\.pointerType, false\)/);
  assert.match(pointerDown, /selectedImageResult\.hit !== "move"/);
  assert.doesNotMatch(pointerDown, /state\.selectedImageId\) acceptImageEdit\(\)/);
  assert.match(pointerDown, /animationResult && animationResult\.hit !== "move"/);
  assert.doesNotMatch(pointerDown, /beginImageTouchHold|beginAnimationTouchHold/);
  for (const target of ["image", "animation", "widget", "pending-widget"]) assert.match(chromeSpecs, new RegExp(`target:"${target}"`));
  assert.match(functionSource(app, "pendingChromeSpecs"), /target:"pending"/);
  assert.match(chromeMove, /beginPendingGesture[\s\S]*?beginWidgetGesture[\s\S]*?beginImageGesture[\s\S]*?beginAnimationGesture/);
  assert.equal(chromePosition({ x:100, y:100, w:300, h:260 }, "move").y, 6);
  assert.doesNotMatch(app, /function drawHandModeOutlines\(/);
  const handToolbarOutlines = functionSource(app, "drawHandObjectToolbarOutlines");
  assert.match(handToolbarOutlines, /state\.mode !== "hand"[\s\S]*?state\.handToolbarTargets\.values\(\)[\s\S]*?if \(!record\.expanded\) continue[\s\S]*?widgetBox\(object\)[\s\S]*?imageBox\(object\)[\s\S]*?animationBox\(object\)[\s\S]*?textBoxBox\(object\)[\s\S]*?strokeRect/);
  assert.match(functionSource(app, "renderInteractionLayer"), /drawHandObjectToolbarOutlines\(interactionCtx\)/);
  assert.match(chromeSpecs, /for \(const \[key, record\] of state\.handToolbarTargets\)/);
  assert.doesNotMatch(chromeSpecs, /for \(const item of (?:visibleImages|visibleAnimations|visibleTextBoxes|visibleWidgets)/);
  assert.match(app, /HAND_OBJECT_TOOLBAR_VISIBLE_MS = 10000/);
  assert.match(functionSource(app, "expireHandObjectToolbars"), /record\.holds\?\.size\) continue[\s\S]*?record\.expiresAt <= now[\s\S]*?record\.hiding = true[\s\S]*?HAND_OBJECT_TOOLBAR_FADE_MS/);
  assert.match(functionSource(app, "ensureHandToolbarRecord"), /expanded:false[\s\S]*?holds:new Set\(\)/);
  assert.match(functionSource(app, "updateHandObjectHover"), /handObjectToolbarTargetAtPoint[\s\S]*?releaseHandObjectFocus[\s\S]*?focusHandObject/);
  assert.match(functionSource(app, "beginHandObjectFocus"), /handObjectToolbarTargetAtPoint[\s\S]*?handPointerFocusKeys\.set/);
  assert.match(createChromeButton, /kind === "move"\) activateHandObjectToolbar[\s\S]*?beginObjectChromeMove/);
  assert.match(refineHoverOutline, /state\.widgetRefineButtonHoverId[\s\S]*?\["pen", "hand"\]\.includes\(state\.mode\)/);
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
  assert.match(css, /#viewport\.hand-mode \.canvas-widget-frame\s*\{[^}]*pointer-events:\s*auto[^}]*cursor:\s*default/);
  assert.match(css, /\.widget-layer\s*\{[^}]*z-index:\s*1/);
  assert.match(css, /\.object-chrome-layer\s*\{[^}]*z-index:\s*4/);
  assert.match(css, /\.object-chrome-button\.move\s*\{[^}]*width:\s*34px[^}]*height:\s*34px[^}]*cursor:\s*grab/);
  assert.match(css, /\.object-chrome-button\.hand-toolbar-hiding\s*\{[^}]*pointer-events:\s*none[^}]*opacity:\s*0/);
  for (const name of ["acceptImageEdit", "cancelImageEdit", "deleteImage", "mergeImage"]) {
    assert.match(functionSource(app, name), /state\.mode !== "hand"/);
  }
  assert.doesNotMatch(functionSource(app, "updateImageGesture"), /schedule|requestAI/);
  assert.doesNotMatch(functionSource(app, "updateWidgetGesturePoint"), /schedule\(\)|requestAI/);
  assert.doesNotMatch(functionSource(app, "updateAnimationGesture"), /schedule|requestAI/);
});

test("AI drafts temporarily enter Hand, restore the prior tool, and undo back to an unconfirmed draft", () => {
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
  assert.match(enter, /setCanvasMode\("hand", \{[\s\S]*?preserveSelection:true,[\s\S]*?skipDraftFinalize:true,[\s\S]*?preserveWidgetRefinement:true/);
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
  assert.match(restore, /setCanvasMode\("hand", \{ preserveSelection:true, skipDraftFinalize:true \}\)/);
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
      busy:false,
    };
  let accepted = 0;
  vm.runInNewContext(`(${setCanvasMode})("eraser")`, {
    state,
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
    deselectAnimation() {},
    view:{ classList:{ toggle() {} } },
    resetCanvasCursor() {},
    requestInteractionLayerRender() {},
  });
  assert.equal(accepted, 1);
  assert.equal(state.mode, "eraser");
  assert.equal(state.pendingWidget, null);
});

test("contextual footer hints persist, settle from blue, and follow widget and tool behavior", () => {
  const html = read("public/index.html"), app = read("public/app.js"), css = read("public/style.css"), zh = read("public/locales/zh.js"),
    showHint = functionSource(app, "showCanvasHint"),
    renderHint = functionSource(app, "renderCanvasHint"),
    mode = functionSource(app, "setCanvasMode"),
    startWidget = functionSource(app, "startPendingWidget"),
    acceptWidget = functionSource(app, "acceptPendingWidget");
  assert.match(html, /id="canvasHint" class="canvas-hint" role="status" aria-live="polite" hidden/);
  assert.doesNotMatch(html, /data-i18n="footerTip"|AI drafts: move the whole group/);
  assert.match(renderHint, /`\$\{t\("hintPrefix"\)\}: \$\{t\(state\.canvasHintKey\)\}`[\s\S]*?canvasHint\.hidden = false/);
  assert.match(app, /hintPrefix:\s*"Hint"/);
  assert.match(zh, /hintPrefix:\s*"提示"/);
  assert.match(zh, /pluginPreview:\s*"预览"/);
  assert.doesNotMatch(showHint, /setTimeout|hidden\s*=\s*true/);
  assert.match(showHint, /Array\.isArray\(keys\)[\s\S]*?candidates\.filter\(\(key\) => key !== state\.canvasHintKey\)[\s\S]*?Math\.random\(\)/);
  assert.match(css, /\.canvas-hint\s*\{[^}]*flex:\s*1 1 auto[^}]*min-width:\s*0[^}]*max-width:\s*none[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/);
  assert.match(css, /\.canvas-hint\.is-new\s*\{[^}]*animation:\s*canvasHintSettle 10s/);
  assert.match(css, /@keyframes canvasHintSettle\s*\{[\s\S]*?#2f80ed[\s\S]*?var\(--muted\)/);
  assert.match(startWidget, /widget\.widgetType === "html_widget"[\s\S]*?showCanvasHint\(\["canvasHintWidgetAdded", "canvasHintWidgetAddedAlt", "canvasHintRefineInPlace", "canvasHintAIAddsOnly"\]\)/);
  assert.match(acceptWidget, /if \(restoreMode\) finishAIDraftHandMode\(\);[\s\S]*?if \(!replacement && restoreMode\) showCanvasHint\("canvasHintWidgetTouchHand"\)/);
  assert.match(mode, /hand:\["canvasHintHand", "canvasHintHandAlt"\][\s\S]*?select:\["canvasHintLasso", "canvasHintLassoAlt"\][\s\S]*?text:\["canvasHintText", "canvasHintTextAlt"\][\s\S]*?eraser:\["canvasHintEraser", "canvasHintEraserAlt"\]/);
  assert.match(app, /button\.onclick = \(\) => setCanvasMode\(button\.dataset\.mode, \{ showHint:true \}\)/);
  assert.match(app, /e\.pointerType === "touch"[\s\S]*?touchWidget = valid\(touchPoint\) \? widgetAtRefinePoint\(touchPoint\) : null[\s\S]*?state\.mode !== "hand"\) showCanvasHint\("canvasHintWidgetTouchHand"\)/);
  const hintKeys = [
    "canvasHintWidgetAdded", "canvasHintWidgetAddedAlt", "canvasHintRefineInPlace", "canvasHintAIAddsOnly", "canvasHintHand", "canvasHintHandAlt", "canvasHintLasso",
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
  assert.match(functionSource(app, "renderPlacedContentLayer"), /drawImagesToContext\(placedContentCtx, visible, state\.widgetShadowEnabled\)[\s\S]*?drawTextBoxesToContext\(placedContentCtx, visible\)/);
  assert.doesNotMatch(mergeImage, /shadow(?:Color|Blur|Offset)|widgetShadowEnabled/);
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
  assert.match(preview, /state\.mode !== "eraser"[\s\S]*?context\.setLineDash\(\[3\.5 \* unit, 3 \* unit\]\)[\s\S]*?context\.arc/);
  const updatePreview = functionSource(app, "updateCanvasPointerPreview"),
    beginPointer = functionSource(app, "beginCanvasPointerAction"),
    finishPointer = functionSource(app, "end");
  assert.match(updatePreview, /state\.mode === "eraser"[\s\S]*?!drawing \|\| drawing\.erase && drawing\.id === event\.pointerId[\s\S]*?requestInteractionLayerRender\(\)/);
  assert.match(beginPointer, /state\.drawing = \{[\s\S]*?erase: erasing,[\s\S]*?\};[\s\S]*?updateCanvasPointerPreview\(e\)/);
  assert.match(finishPointer, /const wasErasing = state\.drawing\.erase;[\s\S]*?finishDrawing\(e\.pointerType\);[\s\S]*?state\.pointerPreview = null;[\s\S]*?requestInteractionLayerRender\(\)/);
  assert.match(app, /screen\.addEventListener\("pointerleave", \(\) => \{[\s\S]*?state\.pointerPreview = null;[\s\S]*?requestInteractionLayerRender\(\)/);
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
  assert.match(app, /tip:\s*"Pan: middle-mouse drag, Hand tool, or one finger · Zoom: wheel or pinch"/);
  assert.match(zh, /tip:\s*"移动画布：鼠标中键、小手或单指拖动 · 缩放：滚轮或双指"/);
  assert.match(css, /#tip\s*\{[^}]*right:\s*12px[^}]*visibility:\s*hidden[^}]*opacity:\s*0/);
  assert.match(css, /#viewport\.is-navigating #tip\s*\{[^}]*visibility:\s*visible[^}]*opacity:\s*1/);
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
  assert.match(css, /\.canvas-navigation-lock\s*\{[^}]*top:\s*10px[^}]*left:\s*10px[^}]*width:\s*30px[^}]*height:\s*30px[^}]*opacity:\s*\.3/);
  assert.match(css, /#viewport\.is-navigating \.canvas-navigation-lock[^}]*opacity:\s*\.58/);
  assert.match(css, /\.canvas-navigation-lock\.locked[^}]*opacity:\s*\.76/);
  assert.match(css, /body\[data-theme="arcane"\] \.canvas-navigation-lock:not\(\.locked\)\s*\{[^}]*var\(--outside\)[^}]*opacity:\s*\.52/);
  assert.match(css, /body\[data-theme="arcane"\] #viewport\.is-navigating \.canvas-navigation-lock:not\(\.locked\)[\s\S]*?opacity:\s*\.68/);
  assert.match(css, /body\[data-theme="scifi"\] \.canvas-navigation-lock:not\(\.locked\)\s*\{[^}]*var\(--outside\) 78%[^}]*opacity:\s*\.38/);
  assert.match(css, /body\[data-theme="scifi"\] #viewport\.is-navigating \.canvas-navigation-lock:not\(\.locked\)\s*\{[^}]*opacity:\s*\.5/);
  assert.match(css, /body\[data-theme="scifi"\] \.canvas-navigation-lock:not\(\.locked\):hover[\s\S]*?opacity:\s*\.66/);
  assert.match(css, /\.canvas-navigation-lock-hint\s*\{[^}]*right:\s*12px[^}]*bottom:\s*11px[^}]*color:[^}]*opacity:\s*0/);
  assert.match(css, /#viewport\.navigation-locked \.canvas-navigation-lock-hint\s*\{[^}]*visibility:\s*visible[^}]*opacity:\s*\.78/);
  assert.match(app, /NAVIGATION_HINT_VISIBLE_MS\s*=\s*10000/);
  assert.match(toggle, /state\.navigationLocked = Boolean\(locked\)[\s\S]*?view\.classList\.toggle\("navigation-locked"[\s\S]*?syncWidgetHostStates\(\)[\s\S]*?setNavigating\(true\)/);
  assert.match(move, /if \(state\.navigationLocked\)[\s\S]*?return false[\s\S]*?state\.panX \+= dx/);
  assert.match(zoom, /if \(state\.navigationLocked\)[\s\S]*?return false[\s\S]*?state\.scale = next/);
  assert.match(pinch, /if \(state\.navigationLocked\)[\s\S]*?return false[\s\S]*?state\.scale = next/);
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

test("declarative scenes and widgets render below the dedicated ink and interaction layers", () => {
  const html = read("public/index.html"), app = read("public/app.js"), css = read("public/style.css");
  assert.ok(html.indexOf('src="animation.js"') < html.indexOf('src="app.js"'));
  for (const id of ["animationLayer", "placedContentLayer", "inkLayer", "interactionLayer", "objectChromeLayer", "animationControls", "animationPlayPause", "animationRestart", "animationDelete"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.ok(html.indexOf('id="screen"') < html.indexOf('id="animationLayer"'));
  assert.ok(html.indexOf('id="widgetLayer"') < html.indexOf('id="placedContentLayer"'));
  assert.ok(html.indexOf('id="placedContentLayer"') < html.indexOf('id="inkLayer"'));
  assert.ok(html.indexOf('id="inkLayer"') < html.indexOf('id="interactionLayer"'));
  assert.ok(html.indexOf('id="animationLayer"') < html.indexOf('id="interactionLayer"'));
  assert.match(css, /\.animation-layer\s*\{[^}]*z-index:\s*1/);
  assert.match(css, /\.placed-content-layer\s*\{[^}]*z-index:\s*2/);
  assert.match(css, /\.ink-layer\s*\{[^}]*z-index:\s*2/);
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
  for (const id of ["pluginControl", "pluginButton", "pluginPopover", "pluginOptions", "pluginClose", "pluginRefresh", "pluginLocalTab", "pluginCreateTab", "pluginServerTab", "pluginLocalPanel", "pluginCreatePanel", "pluginServerPanel"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.doesNotMatch(html, /id="animationPluginEnabled"/);
  assert.match(app, /BUILTIN_PLUGIN_DEFINITIONS\s*=\s*Object\.freeze\(\[/);
  assert.match(app, /PLUGIN_DEFINITIONS\s*=\s*\[\.\.\.BUILTIN_PLUGIN_DEFINITIONS\]/);
  assert.match(app, /BUILTIN_PLUGIN_DEFINITIONS\s*=\s*Object\.freeze\(\[\]\)/);
  assert.doesNotMatch(app, /documentPath:\s*"plugins\/weather\.md"/);
  const loadPluginDocuments = functionSource(app, "loadPluginDocuments");
  assert.match(loadPluginDocuments, /fetch\("\/api\/plugins"[\s\S]*?defaultEnabled:\["general", "flowchart"\]\.includes\(item\.manifest\.id\)[\s\S]*?professionalDefinitions = definitions\.filter\(\(definition\) => definition\.id === "flowchart"\)[\s\S]*?promotedDefinitions = \["image-search", "weather"\][\s\S]*?PLUGIN_DEFINITIONS\.splice\(0, PLUGIN_DEFINITIONS\.length, \.\.\.generalDefinitions, \.\.\.professionalDefinitions, \.\.\.BUILTIN_PLUGIN_DEFINITIONS, \.\.\.promotedDefinitions, \.\.\.remainingDefinitions\)/);
  const enabledPluginDescriptors = functionSource(app, "enabledPluginDescriptors");
  assert.match(enabledPluginDescriptors, /id === "general" \? 0 : id === "flowchart" \? 1 : 2/);
  assert.doesNotMatch(enabledPluginDescriptors, /styles/);
  assert.match(app, /localStorage\.setItem\(PLUGIN_STORAGE_KEY, JSON\.stringify/);
  assert.match(app, /if \(!state\.pluginCatalogLoaded\) void loadPluginDocuments\(\)/);
  assert.match(app, /applyTheme\(state\.theme\);\s*resetCanvasCursor\(\);\s*loadPluginDocuments\(\)\.catch/);
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
  assert.match(css, /#status\[data-ai-progress="true"\][^{]*\{[^}]*min-width:\s*180px/);
  assert.match(css, /#status\s*\{[^}]*height:\s*38px[^}]*display:\s*grid[^}]*align-items:\s*center/);
  assert.match(css, /#status\[data-ai-progress="true"\][^{]*\{[^}]*overflow-wrap:\s*anywhere[^}]*white-space:\s*normal/);
  assert.match(css, /@media \(max-width:\s*620px\)[\s\S]*?#status\s*\{[^}]*width:\s*min\(210px, calc\(100vw - 20px\)\)[^}]*min-width:\s*min\(210px, calc\(100vw - 20px\)\)[^}]*max-width:\s*min\(210px, calc\(100vw - 20px\)\)/);
  const handleConnectionAction = functionSource(app, "handleConnectionAction");
  assert.match(handleConnectionAction, /localStorage\.setItem\(AI_CONNECTION_STORAGE_KEY, id\)/);
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
  assert.match(css, /\.plugin-control\s*\{[^}]*height:\s*29px;\s*min-height:\s*29px/);
  assert.match(css, /@media \(pointer: coarse\)[\s\S]*?\.plugin-control\s*\{\s*height:\s*38px;\s*min-height:\s*38px;\s*\}[\s\S]*?\.toolbar \.plugin-trigger\s*\{\s*height:\s*36px;\s*min-height:\s*36px/);
  assert.match(css, /\.plugin-modal-layer\s*\{[^}]*position:\s*fixed[^}]*place-items:\s*center/);
  assert.match(css, /\.plugin-modal\s*\{[^}]*color-scheme:\s*light[^}]*--ink:\s*#1c1f27[^}]*--panel-raised:\s*#ffffff[^}]*--gold-bright:\s*#4f46e5[^}]*width:\s*min\(920px, 100%\)[^}]*max-height/);
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
  const app = read("public/app.js"), html = read("public/index.html"), requestPayload = functionSource(app, "pluginRequestPayload"), syncRuntime = functionSource(app, "syncWidgetRuntime"), pointerDown = app.slice(app.indexOf('screen.addEventListener("pointerdown"'), app.indexOf('screen.addEventListener("pointermove"')), validate = functionSource(app, "validate");
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
  assert.match(pointerDown, /widgetRuntimeEnabled\(\) && valid\(point\) \? widgetPointerHit/);
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

test("AI waiting uses a mathematical loader and quiet copy for the real request lifetime", () => {
  const core = read("src/client/app/core.js"),
    bootstrap = read("src/client/app/ui-bootstrap.js"),
    busy = functionSource(core, "setBusy");
  assert.match(core, /summonLayer|fxCanvas:\s*summonLayer|getAiColor:\s*\(\)\s*=>\s*state\.aiColor/);
  assert.match(busy, /if \(state\.busy\) \{[\s\S]*?showSummon\(\);[\s\S]*?\} else \{[\s\S]*?hideSummon\(\);/);
  assert.doesNotMatch(core, /summonEffect|setSummonEffect|previewSummon|summonPreviewTimer/);
  assert.doesNotMatch(bootstrap, /summon-effect-option|setSummonEffect|previewSummon/);
});

test("new canvases open 1.5 times closer without overriding restored views", () => {
  const core = read("src/client/app/core.js"),
    canvas = read("src/client/app/canvas-runtime.js"),
    persistence = read("src/client/app/persistence.js"),
    fitSource = functionSource(canvas, "fit"),
    state = { scale:0.1, panX:0, panY:0, viewInitialized:false, animationFullRedraw:false },
    screen = {},
    animationLayer = {},
    placedContentLayer = {},
    inkLayer = {},
    interactionLayer = {},
    fit = vm.runInNewContext(`(${fitSource})`, {
      INITIAL_VIEW_ZOOM:1.5,
      SIZE:20000,
      viewerAutoFitWidgetId:null,
      viewerAutoFitCanvas:false,
      devicePixelRatio:1,
      view:{ getBoundingClientRect:() => ({ width:1200, height:800 }) },
      screen,
      animationLayer,
      placedContentLayer,
      inkLayer,
      interactionLayer,
      state,
      updateCoordinates:() => {},
      requestRender:() => {},
    });
  assert.match(core, /INITIAL_VIEW_ZOOM\s*=\s*1\.5/);
  assert.match(fitSource, /Math\.max\(r\.width,\s*r\.height\)\s*\/\s*10000\s*\*\s*INITIAL_VIEW_ZOOM/);
  fit();
  assert.equal(state.scale, 0.18);
  assert.equal(state.panX + 10000 * state.scale, 600);
  assert.equal(state.panY + 10000 * state.scale, 400);
  assert.match(functionSource(persistence, "startBlankCanvas"), /state\.viewInitialized\s*=\s*false;[\s\S]*?fit\(\)/);
  assert.match(persistence, /state\.scale\s*=\s*Math\.max\(0\.03,\s*Math\.min\(2,\s*item\.view\.scale\)\)/);
});

test("the public Viewer camera fits a Widget in phone portrait and landscape", () => {
  const fitSource = functionSource(read("src/client/app/canvas-runtime.js"), "fit"),
    widget = { id:"viewer-widget", x:2400, y:3600, w:1200, h:800 },
    state = { widgets:[widget], scale:.1, panX:0, panY:0, viewInitialized:true, animationFullRedraw:false },
    screen = {}, animationLayer = {}, placedContentLayer = {}, inkLayer = {}, interactionLayer = {};
  let rect = { left:0, top:0, width:375, height:667 };
  const fit = vm.runInNewContext(`(${fitSource})`, {
    INITIAL_VIEW_ZOOM:1.5,
    SIZE:20000,
    viewerAutoFitWidgetId:widget.id,
    viewerAutoFitCanvas:false,
    widgetBox:(item) => ({ x:item.x, y:item.y, w:item.w, h:item.h }),
    devicePixelRatio:1,
    view:{ getBoundingClientRect:() => rect },
    document:{ querySelector:() => ({ getBoundingClientRect:() => ({ bottom:62 }) }) },
    screen,
    animationLayer,
    placedContentLayer,
    inkLayer,
    interactionLayer,
    state,
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
    screen = {}, animationLayer = {}, placedContentLayer = {}, inkLayer = {}, interactionLayer = {},
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
      INITIAL_VIEW_ZOOM:1.5,
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
      document:{ querySelector:() => ({ getBoundingClientRect:() => ({ bottom:62 }) }) },
      screen,
      animationLayer,
      placedContentLayer,
      inkLayer,
      interactionLayer,
      state,
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
    view:{getBoundingClientRect:()=>({width:1000,height:700})},
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
  for (const key of ["tour-layer", "tour-highlight", "tour-card", "tour-progress", "animation-controls", "image-edit-bar", "selection-toolbar", "summon-copy"])
    assert.match(app, new RegExp(`runtimeElementStyle\\([^)]*["']${key}["']`));
  assert.doesNotMatch(app, /Reflect\.get\((?:tourLayer|tourHighlight|tourCard|tourProgressBar|animationControls|imageEditBar|selectionToolbar), "style"\)/);
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
    css = read("public/style.css"),
    resize = vm.runInNewContext(`(${functionSource(app, "resizeWidgetBox")})`, { SIZE:20000 }),
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
    begin = functionSource(app, "beginWidgetGesture"),
    updatePoint = functionSource(app, "updateWidgetGesturePoint"),
    finishReleased = functionSource(app, "finishReleasedWidgetGesture"),
    finishStaleHost = functionSource(app, "finishStaleWidgetHostGesture"),
    pointerHit = functionSource(app, "widgetPointerHit"),
    messageHandler = functionSource(app, "handleWidgetMessage"),
    finishWidgetGesture = functionSource(app, "finishWidgetGesture"),
    positionWidget = vm.runInNewContext(`(${functionSource(app, "positionWidget")})`, {
      state:{ panX:10, panY:20, scale:0.2 },
      updateWidgetRenderVisibility() {},
      sendWidgetHostState() {},
    }),
    pointerDown = app.slice(app.indexOf('screen.addEventListener("pointerdown"'), app.indexOf('screen.addEventListener("pointermove"')),
    frameRule = /\.canvas-widget-frame\s*\{[^}]*\}/.exec(css)?.[0] || "";
  const declaration = {},
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
  assert.equal(declaration.transform, "translate3d(30px,60px,0) scale(0.1,0.1)");
  assert.match(frameRule, /color-scheme:\s*light/);
  assert.match(frameRule, /background:\s*transparent/);
  assert.match(functionSource(app, "serializedWidgets"), /contentW:\s*widget\.contentW[\s\S]*?contentH:\s*widget\.contentH/);
  assert.match(functionSource(app, "serializedWidgets"), /widget\.widgetType !== "diagram_source"[\s\S]*?widget\.pluginId !== "image-search"[\s\S]*?copyText:widget\.copyText[\s\S]*?copyLabel:widget\.copyLabel/);
  const widgetRecord = functionSource(app, "widgetRecord");
  assert.match(widgetRecord, /contentW = item\.contentW \?\? item\.w[\s\S]*?contentH = item\.contentH \?\? item\.h/);
  assert.match(widgetRecord, /copyText: widgetType === "diagram_source" \? source[\s\S]*?allowCopy[\s\S]*?copyLabel: widgetType === "diagram_source" \? runtime\?\.copyLabel/);
  assert.match(functionSource(app, "sendWidgetInit"), /html:widget\.html[\s\S]*?pluginStyles:manifest\.styles/);
  assert.doesNotMatch(functionSource(app, "sendWidgetInit"), /copyText|copyLabel/);
  assert.doesNotMatch(functionSource(app, "resizeWidgetBox"), /5000|4000|12000000|maximumArea/);
  assert.doesNotMatch(functionSource(app, "widgetRecord"), /pluginManifests\.has/);
  assert.match(functionSource(app, "requestWidgetSnapshot"), /width:widget\.contentW, height:widget\.contentH, timeoutMs:remaining\(\)/);
  const requestSnapshot = functionSource(app, "requestWidgetSnapshot"),
    prepareSnapshots = functionSource(app, "prepareVisibleWidgetSnapshots"),
    capturableWidgets = functionSource(app, "capturableWidgets"),
    acceptPendingWidget = functionSource(app, "acceptPendingWidget");
  assert.match(requestSnapshot, /timeoutMs = WIDGET_SNAPSHOT_TIMEOUT_MS[\s\S]*?if \(widget\.snapshotPromise\)[\s\S]*?await inFlight[\s\S]*?widget\.snapshotVersion >= widget\.contentVersion[\s\S]*?widget\.snapshotPromise = snapshotPromise[\s\S]*?widget\.snapshotPromise = null/);
  assert.doesNotMatch(requestSnapshot, /waitForWidgetContent|readyPromise|contentReady|\bfetch\s*\(/);
  assert.match(requestSnapshot, /if \(!widget\.hostReady\)[\s\S]*?widget\.hostReadyPromise[\s\S]*?sendWidgetInit\(widget\)/);
  assert.match(messageHandler, /penecho-widget-updated[\s\S]*?widget\.contentVersion\+\+/);
  assert.match(messageHandler, /penecho-widget-updated[\s\S]*?if \(widget\.favorite\)[\s\S]*?widget\.favorite = false[\s\S]*?syncObjectChrome\(\)/);
  assert.doesNotMatch(messageHandler, /removeLocalFavorite|\/api\/favorites|DELETE/);
  const favoriteState = functionSource(app, "setCommunityWidgetFavorite");
  assert.match(favoriteState, /busy === true && !widget\.favoriteBusy[\s\S]*?favoritePendingVersion = widget\.contentVersion/);
  assert.match(favoriteState, /changedWhileSaving[\s\S]*?favoritePendingVersion !== widget\.contentVersion[\s\S]*?if \(!changedWhileSaving\) widget\.favorite = favorite/);
  assert.match(functionSource(app, "widgetRecord"), /favoriteBusy: false[\s\S]*?favoritePendingVersion: null/);
  assert.match(messageHandler, /penecho-widget-snapshot-error[\s\S]*?console\.warn\("PenEcho widget snapshot failed:"/);
  assert.doesNotMatch(messageHandler, /requestWidgetSnapshot/);
  assert.equal((app.match(/requestWidgetSnapshot\(/g) || []).length, 3);
  assert.match(app, /WIDGET_SNAPSHOT_TIMEOUT_MS = 20000,[\s\S]*?WIDGET_HISTORY_SNAPSHOT_WAIT_MS = 3000/);
  assert.doesNotMatch(app, /WIDGET_(?:BACKGROUND_SNAPSHOT_DELAY|SNAPSHOT_CACHE_REFRESH|SNAPSHOT_CACHE_STAGGER)_MS|scheduleWidgetSnapshot|snapshotTimer|snapshotCapturedAt/);
  assert.match(requestSnapshot, /widget\.snapshotPromise = snapshotPromise[\s\S]*?return await snapshotPromise[\s\S]*?widget\.snapshotPromise = null/);
  assert.match(messageHandler, /penecho-widget-capture-ready[\s\S]*?return/);
  assert.doesNotMatch(messageHandler, /penecho-widget-snapshot-ready/);
  assert.match(messageHandler, /widget\.snapshotImage = await decodeWidgetSnapshot[\s\S]*?widget\.snapshotVersion = pending\.contentVersion[\s\S]*?pending\.resolve\(widget\.snapshotImage\)/);
  assert.match(capturableWidgets, /visibleWidgets\(region\)[\s\S]*?state\.pendingWidget[\s\S]*?pending\.shell[\s\S]*?return \[\.\.\.widgets, pending\]/);
  assert.match(prepareSnapshots, /capturableWidgets\(region\)[\s\S]*?requestWidgetSnapshot\(widget, WIDGET_SNAPSHOT_TIMEOUT_MS, true\)[\s\S]*?Promise\.race\([\s\S]*?WIDGET_HISTORY_SNAPSHOT_WAIT_MS[\s\S]*?Boolean\(widget\.snapshotImage\)/);
  assert.match(prepareSnapshots, /bestEffort = true[\s\S]*?if \(bestEffort\) await Promise\.race[\s\S]*?else await request/);
  assert.match(functionSource(app, "widgetBounds"), /capturableWidgets\(region\)/);
  assert.match(functionSource(app, "drawWidgetsToContext"), /capturableWidgets\(region\)/);
  assert.match(functionSource(app, "renderExportCanvas"), /prepareVisibleWidgetSnapshots\(null, false\)[\s\S]*?scale = Math\.min\(1, EXPORT_MAX_DIMENSION \/ region\.w[\s\S]*?Math\.sqrt\(EXPORT_MAX_PIXELS \/ \(region\.w \* region\.h\)\)/);
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
  assert.match(hit, /draftActionPoints\(box, handle, false, true\)/);
  for (const control of ["width", "height", "resize"]) assert.match(hit, new RegExp(`hit:\\s*"${control}"`));
  assert.match(begin, /result\.hit === "accept"[\s\S]*?acceptPendingWidget[\s\S]*?acceptWidgetEdit/);
  assert.match(begin, /result\.hit === "cancel"[\s\S]*?rejectPendingWidget[\s\S]*?deleteWidget\(result\.widget\)/);
  assert.match(functionSource(app, "deleteWidget"), /recordWidgetsBefore\(\)[\s\S]*?state\.widgets = state\.widgets\.filter[\s\S]*?save\(\)[\s\S]*?setStatusKey\("widgetDeleted"\)/);
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
  assert.match(messageHandler, /validWidgetHostActivate\(message\)[\s\S]*?handObjectToolbarTargetFromWidgetMessage\(widget, message\)[\s\S]*?focusHandObject\(target\.kind, target\.object\)/);
  assert.doesNotMatch(messageHandler, /penecho-widget-copy-source/);
  assert.match(functionSource(app, "sendWidgetHostState"), /selected[\s\S]*?penecho-widget-state[\s\S]*?scaleX[\s\S]*?scaleY/);
  assert.match(functionSource(app, "beginWidgetHostDrag"), /state\.handWidgetPointerIds[\s\S]*?source:"widget-host"[\s\S]*?hit:message\.hit[\s\S]*?startPoint:clientPoint/);
  assert.match(functionSource(app, "updateWidgetHostDrag"), /widgetHostViewportPoint[\s\S]*?updateWidgetGesturePoint/);
  assert.match(functionSource(app, "finishWidgetHostDrag"), /finishWidgetGesture/);
  const handTarget = functionSource(app, "handObjectToolbarTargetAtPoint");
  assert.ok(handTarget.indexOf("textBoxAtPoint(point)") < handTarget.indexOf("imageAtPoint(point)"));
  assert.ok(handTarget.indexOf("imageAtPoint(point)") < handTarget.indexOf("visibleWidgets()"));
  assert.ok(handTarget.indexOf("visibleWidgets()") < handTarget.indexOf("animationPointerHit(point)"));
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
  assert.match(beginResetTap, /state\.mode !== "hand"[\s\S]*?\["mouse", "touch"\][\s\S]*?event\.isPrimary === false[\s\S]*?state\.pointers\.size[\s\S]*?handObjectToolbarTargetAtPoint\(point\)/);
  assert.match(updateResetTap, /state\.pointers\.size > 1[\s\S]*?Math\.hypot[\s\S]*?HAND_WIDGET_GESTURE_RESET_TAP_PX/);
  assert.match(finishResetTap, /state\.mode !== "hand"[\s\S]*?event\.type === "pointercancel"[\s\S]*?state\.pointers\.size[\s\S]*?state\.touches\.size[\s\S]*?clearWidgetOwnedHandGestures\(\)/);
  assert.match(pointerDown, /beginCanvasWidgetGestureResetTap\(e, handPoint\)[\s\S]*?state\.pointers\.set/);
  assert.match(app, /screen\.addEventListener\("pointermove"[\s\S]*?updateCanvasWidgetGestureResetTap\(e\)[\s\S]*?finishReleasedWidgetGesture\(e\)/);
  assert.match(functionSource(app, "end"), /state\.pointers\.delete[\s\S]*?state\.touches\.delete[\s\S]*?finishCanvasWidgetGestureResetTap\(e\)[\s\S]*?handGestureIncludesWidget/);
  const resetState = {
      mode:"hand",
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
  assert.match(functionSource(app, "mountWidget"), /frame\.addEventListener\("pointerenter"[\s\S]*?updateHandObjectHover\(clientPoint\(event\)\)[\s\S]*?frame\.addEventListener\("pointerleave"[\s\S]*?updateHandObjectHover\(null\)/);
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
  assert.ok(pointerDown.indexOf("widgetPointerHit(point") < pointerDown.indexOf("animationPointerHit(point"));
  assert.match(app, /state\.widgetGesture\?\.id === e\.pointerId[\s\S]*?updateWidgetGesture\(e\)/);
  assert.match(app, /state\.widgetGesture\?\.id === e\.pointerId[\s\S]*?finishWidgetGesture\(e\)/);
  assert.match(pointerDown, /finishStaleWidgetHostGesture\(e\)/);
  assert.match(app, /objectChromeLayer\?\.addEventListener\("pointermove"[\s\S]*?finishReleasedWidgetGesture\(event\)/);
  assert.match(css, /\.widget-layer\s*\{[^}]*z-index:\s*1[^}]*pointer-events:\s*none/);
  assert.match(css, /\.canvas-widget\s*\{[^}]*pointer-events:\s*none/);
  assert.match(frameRule, /pointer-events:\s*none/);
  assert.match(css, /#viewport\.hand-mode \.canvas-widget-frame\s*\{[^}]*pointer-events:\s*auto/);
  assert.match(frameRule, /touch-action:\s*none/);
  assert.match(frameRule, /border:\s*0/);
  assert.match(frameRule, /background:\s*transparent/);
  assert.doesNotMatch(frameRule, /box-shadow|border-radius/);
  assert.doesNotMatch(css, /canvas-widget-toolbar/);
  assert.match(read("src/server/main.js"), /Keep user-facing text natively selectable and do not globally disable text selection/);
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
    mode = functionSource(app, "setCanvasMode"),
    snapshot = functionSource(app, "requestWidgetSnapshot"),
    chrome = functionSource(app, "objectChromeSpecs"),
    selectedRefine = functionSource(app, "selectedWidgetRefineCandidate"),
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
  assert.match(nonHandChrome, /persistentCandidate = currentWidgetRefineCandidate\(\)[\s\S]*?hoverCandidate = currentWidgetRefineHoverCandidate\(\)[\s\S]*?state\.mode !== "hand"/);
  assert.doesNotMatch(nonHandChrome, /copy:true/);
  assert.match(chrome, /for \(const \[key, record\] of state\.handToolbarTargets\)[\s\S]*?record\.kind === "text-box"[\s\S]*?target:"text-box"/);
  assert.match(chrome, /if \(persistentCandidate\) addWidgetToolSpecs\(specs, persistentCandidate\.widget, \{ refine:persistentCandidate \}\)/);
  assert.match(functionSource(app, "updateWidgetRefinePointer"), /\["pen", "hand"\]\.includes\(state\.mode\)[\s\S]*?widgetAtRefinePoint[\s\S]*?const hasDirty = viewportHasWidgetRefineInput/);
  assert.match(functionSource(app, "updateWidgetRefinePointer"), /instructionMode:"viewport-dirty"[\s\S]*?hintKey:"widgetRefineViewportHint"/);
  assert.match(selectedRefine, /persistentCandidate\?\.widget === widget[\s\S]*?hoverCandidate\?\.widget === widget/);
  assert.match(selectedRefine, /const hasDirty = viewportHasWidgetRefineInput\(\)[\s\S]*?instructionMode:hasDirty \? "viewport-dirty" : "implicit-polish"[\s\S]*?hintKey:hasDirty \? "widgetRefineViewportHint" : "widgetRefineNoInputHint"/);
  assert.match(functionSource(app, "scheduleWidgetRefineHoverClear"), /WIDGET_REFINE_HOVER_GRACE_MS/);
  assert.match(functionSource(app, "widgetRefineHintVisible"), /widgetRefineHintHovered\(candidate\) \|\| candidate\.hintUntil > Date\.now\(\)/);
  assert.match(functionSource(app, "confirmTextEditor"), /latchWidgetRefineCandidate\(item, "text-box"\)[\s\S]*?!refineCandidate\) schedule/);
  assert.match(functionSource(app, "finishTextBoxChromeGesture"), /latchWidgetRefineCandidate\(gesture\.item, "text-box"\)/);
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
  assert.match(functionSource(app, "syncWidgetRefineConfirmation"), /Math\.min\(560, view\.clientWidth - 24\)[\s\S]*?element\.offsetHeight/);
  const confirmationPosition = vm.runInNewContext(`(${functionSource(app, "widgetRefineConfirmationPosition")})`);
  assert.deepEqual({ ...confirmationPosition({ x:300, y:220, width:112, height:34 }, 360, 50, 1000, 700) }, { x:176, y:212 });
  assert.deepEqual({ ...confirmationPosition({ x:930, y:220, width:64, height:34 }, 360, 50, 1000, 700) }, { x:632, y:212 });
  assert.deepEqual({ ...confirmationPosition({ x:300, y:670, width:112, height:34 }, 360, 50, 1000, 700) }, { x:176, y:642 });
  assert.match(chrome, /editWidget = state\.mode === "hand" && state\.widgetEdit \? selectedWidget\(\) : null/);
  const handChrome = chrome.slice(chrome.indexOf("const specs = [];", chrome.indexOf("return specs;") + 1));
  assert.doesNotMatch(handChrome, /addWidgetToolSpecs\([^\n]*refine:/);
  assert.match(handChrome, /state\.widgetEdit\?\.id === handTarget\.id[\s\S]*?editWidget === handTarget[\s\S]*?addWidgetToolSpecs\(specs, handTarget, \{ copy:true, community:true, handToolbar:true/);
  assert.match(chrome, /state\.pendingWidget[\s\S]*?addWidgetToolSpecs\(specs, widget, \{ copy:true \}\)/);
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
  assert.match(functionSource(app, "objectChromePosition"), /positions = \[[\s\S]*?layout:"horizontal"[\s\S]*?side:"right", layout:"vertical"[\s\S]*?side:"bottom", layout:"horizontal"[\s\S]*?side:"left", layout:"vertical"/);
  assert.match(functionSource(app, "objectChromePosition"), /spec\.groupHorizontalOffset[\s\S]*?vertical \? spec\.groupVerticalOffset/);
  assert.match(functionSource(app, "objectChromePosition"), /ignoreKey[\s\S]*?\.object-chrome-button/);
  assert.match(functionSource(app, "objectChromePosition"), /chromeGap = 7[\s\S]*?above = screenBox\.top - height - chromeGap[\s\S]*?gap = chromeGap \* controlScale/);
  const syncChrome = functionSource(app, "syncObjectChrome");
  assert.match(syncChrome, /objectChromePosition\(spec\.box, spec\.kind, spec\.key, spec\)/);
  assert.match(syncChrome, /spec\.kind === "refine"\) button\.removeAttribute\("title"\)/);
  assert.doesNotMatch(syncChrome, /button\.title = spec\.kind === "refine"/);
  assert.doesNotMatch(app, /function widgetToolScale/);
  assert.match(app, /function addWidgetToolSpecs\(specs, widget, options = \{\}\)[\s\S]*?controlScale = 1[\s\S]*?baseHeight:34/);
  assert.match(app, /kind:"favorite"[\s\S]*?baseWidth:36,[\s\S]*?iconOnly:true/);
  assert.match(app, /kind:"share"[\s\S]*?baseWidth:36,[\s\S]*?iconOnly:true/);
  assert.match(syncChrome, /classList\.toggle\("icon-only", Boolean\(spec\.iconOnly\)\)/);
  assert.match(app, /favoriteLabelKey = widget\.favoriteBusy \? "favoriteWidgetSaving" : widget\.favorite \? "unfavoriteWidget" : "favoriteWidget"/);
  assert.match(app, /kind:"favorite"[\s\S]*?pressed:widget\.favorite === true,[\s\S]*?busy:widget\.favoriteBusy === true/);
  assert.match(functionSource(app, "createObjectChromeButton"), /kind === "move" \|\| button\.disabled/);
  assert.match(syncChrome, /classList\.toggle\("is-favorite", Boolean\(spec\.kind === "favorite" && spec\.pressed\)\)/);
  assert.match(syncChrome, /button\.disabled = Boolean\(spec\.busy\)/);
  assert.match(syncChrome, /spec\.kind === "favorite"\) button\.setAttribute\("aria-pressed", String\(Boolean\(spec\.pressed\)\)\)/);
  assert.match(syncChrome, /spec\.busy\) button\.setAttribute\("aria-busy", "true"\)/);
  assert.match(app, /move:'<svg[^']*?<path d="M12 9V3M9 6l3-3 3 3[\s\S]*?M15 12h6M18 9l3 3-3 3/);
  assert.match(read("public/style.css"), /\.object-chrome-button\.move \{ width: 34px; height: 34px;/);
  assert.match(read("public/style.css"), /\.object-chrome-button \{[^}]*box-shadow: none;[^}]*backdrop-filter: none;/);
  assert.match(read("public/style.css"), /\.object-chrome-button\.widget-tool \{[^}]*height: var\(--object-control-height, 34px\)[^}]*border-style: dashed;[^}]*border-radius: 5px;[^}]*background: rgba\(255, 255, 255, \.9\)/);
  assert.match(read("public/style.css"), /\.object-chrome-button\.widget-tool\.icon-only \{[^}]*gap: 0;[^}]*padding: 0;/);
  assert.match(read("public/style.css"), /\.object-chrome-button\.widget-tool\.icon-only \.object-chrome-label \{ display: none; \}/);
  assert.match(read("public/style.css"), /\.object-chrome-button\.favorite\.is-favorite svg \{ fill: currentColor; \}/);
  assert.match(read("public/style.css"), /\.object-chrome-button\.favorite\.loading::after \{[^}]*animation: history-save-spin \.8s linear infinite;/);
  assert.match(read("public/style.css"), /object-chrome-button[^}]*scale\(var\(--object-control-scale, 1\)\)/);
});

test("widget Refine discovery stays in the parent canvas and leaves iframe events untouched", () => {
  const app = read("public/app.js"),
    widgetHost = read("public/widget-host.js"),
    css = read("public/style.css"),
    pointer = functionSource(app, "updateWidgetRefinePointer"),
    hitTest = functionSource(app, "widgetAtRefinePoint"),
    messageHandler = functionSource(app, "handleWidgetMessage"),
    frameRule = /\.canvas-widget-frame\s*\{[^}]*\}/.exec(css)?.[0] || "",
    handFrameRule = /#viewport\.hand-mode \.canvas-widget-frame\s*\{[^}]*\}/.exec(css)?.[0] || "";

  assert.match(pointer, /state\.widgetRefinePointer = point && valid\(point\) \? point : null/);
  assert.match(pointer, /\["pen", "hand"\]\.includes\(state\.mode\) \? widgetAtRefinePoint\(state\.widgetRefinePointer\) : null/);
  assert.match(hitTest, /visibleWidgets\(\)[\s\S]*?widgetBox\(widget\)[\s\S]*?point\.x[\s\S]*?point\.y/);
  assert.doesNotMatch(hitTest, /contentWindow|postMessage|addEventListener/);
  assert.match(functionSource(app, "mountWidget"), /frame\.addEventListener\("pointerenter"[\s\S]*?updateHandObjectHover\(clientPoint\(event\)\)[\s\S]*?frame\.addEventListener\("pointerleave"[\s\S]*?updateHandObjectHover\(null\)/);
  assert.doesNotMatch(widgetHost, /penecho-widget-hover|widget-refine/i);
  assert.doesNotMatch(messageHandler, /refine|hover/i);
  assert.match(frameRule, /pointer-events:\s*none/);
  assert.match(frameRule, /touch-action:\s*none/);
  assert.match(handFrameRule, /pointer-events:\s*auto/);
  assert.match(handFrameRule, /cursor:\s*default/);
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

test("object bodies cannot activate editing outside Hand and long-press selection is removed", () => {
  const app = read("public/app.js"),
    pointerDownStart = app.indexOf('screen.addEventListener("pointerdown"'),
    pointerDownEnd = app.indexOf('screen.addEventListener("pointermove"', pointerDownStart),
    pointerDown = app.slice(pointerDownStart, pointerDownEnd),
    nonHand = pointerDown.indexOf('if (state.mode !== "hand")'),
    widgetHit = pointerDown.indexOf("widgetPointerHit(point"),
    imageHit = pointerDown.indexOf("imagePointerHit(point"),
    animationHit = pointerDown.indexOf("animationPointerHit(point");
  assert.ok(nonHand > 0 && nonHand < widgetHit && nonHand < imageHit && nonHand < animationHit);
  assert.match(pointerDown, /beginCanvasPointerAction\(e, clientPoint\(e\)\);\s*return/);
  assert.doesNotMatch(app, /beginAnimationTouchHold|animationTouchHold|ANIMATION_TOUCH_HOLD/);
  assert.doesNotMatch(app, /beginImageTouchHold|imageTouchHold|IMAGE_TOUCH_HOLD/);
  assert.match(functionSource(app, "beginObjectChromeMove"), /target === "animation"[\s\S]*?beginAnimationGesture/);
  assert.doesNotMatch(app, /function handleWidgetHostNavigation\(|function validWidgetHostNavigation\(/);
  assert.doesNotMatch(read("public/widget-host.js"), /penecho-widget-wheel|penecho-widget-pan-(?:start|move|end)/);
  assert.match(functionSource(app, "acceptAnimationEdit"), /selectedAnimationId = null[\s\S]*?requestInteractionLayerRender\(\)/);
});

test("Save canvas exposes non-blocking progress and completion feedback", () => {
  const html = read("public/index.html"), app = read("public/app.js"), css = read("public/style.css"), zh = read("public/locales/zh.js"),
    saveCurrent = functionSource(app, "saveCurrentCanvas"),
    finalize = functionSource(app, "finalizeCanvasForSnapshot");
  assert.match(html, /id="historyNotice"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(app, /async function saveSnapshotFromHistory\(\)/);
  assert.match(app, /showHistoryNoticeKey\("snapshotSaving", "busy", 0\)/);
  assert.match(app, /selectionBusyKey = selectionAIStatusKey\(\)/);
  assert.match(app, /showHistoryNoticeKey\(id \? "snapshotSaved" : selectionBusy \? selectionBusyKey : "emptyCanvas"/);
  assert.match(app, /historySaveCurrent"\)\.onclick = saveCurrentCanvas/);
  assert.match(app, /historySave\"\)\.onclick = saveSnapshotFromHistory/);
  assert.match(app, /if \(event\.key === "Enter"\) saveCurrentCanvas\(\)/);
  assert.match(app, /button\.disabled = busy/);
  assert.match(css, /\.history-notice\s*\{[^}]*pointer-events:\s*none/);
  assert.match(css, /#historySaveCurrent\.is-saving::before/);
  assert.match(zh, /snapshotSaving:/);
  assert.match(html, /id="saveCanvasBtn"/);
  assert.match(html, /id="historySaveCurrent"[^>]*>Save<\/button>/);
  assert.match(html, /id="historySave"[^>]*>Save New<\/button>/);
  assert.match(saveCurrent, /currentSnapshotLocation === state\.snapshotLocation \? state\.currentSnapshotId : null/);
  assert.match(saveCurrent, /requestedName = document\.querySelector\("#historyName"\)/);
  assert.match(saveCurrent, /saveSnapshot\(\{ overwriteId, name, location:state\.snapshotLocation \}\)/);
  assert.match(finalize, /state\.pendingWidget[\s\S]*?acceptPendingWidget\(\{ restoreMode:false \}\)/);
  assert.match(finalize, /state\.pending[\s\S]*?acceptPending\(\{ restoreMode:false \}\)/);
  assert.ok(finalize.indexOf("acceptPendingWidget") < finalize.indexOf("confirmTextEditor"));
  for (const edit of ["acceptWidgetEdit", "acceptImageEdit", "acceptAnimationEdit"]) assert.match(finalize, new RegExp(`\\b${edit}\\(\\)`));
  assert.match(finalize, /for \(const editor of \[\.\.\.state\.textEditors\.values\(\)\]\) await confirmTextEditor\(editor\)/);
  assert.match(finalize, /state\.selection[\s\S]*?commitSelection\(\)/);
  assert.match(finalize, /finishAIDraftHandMode\(\)/);
  assert.match(app, /async function saveSnapshot\(\{ overwriteId = null, name = null, location = state\.snapshotLocation \} = \{\}\) \{[\s\S]*?selectionAIBusy\(\)[\s\S]*?await finalizeCanvasForSnapshot\(\)[\s\S]*?if \(!tiles\.size/);
  assert.match(app, /async function saveSnapshot\([\s\S]*?prepareVisibleWidgetSnapshots\(null, false\)/);
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
  assert.match(html, /id="historyPanel"[^>]*aria-hidden="true"[^>]*\sinert/);
  assert.doesNotMatch(html, /id="historyPanel"[\s\S]*?<span class="history-kicker">PenEcho<\/span>[\s\S]*?<div class="history-composer">/);
  assert.doesNotMatch(html, /data-i18n="historyDescription"/);
  assert.doesNotMatch(app, /historyDescription:/);
  assert.doesNotMatch(zh, /historyDescription:/);
  assert.match(css, /\.history-panel, \.new-canvas-dialog\s*\{[^}]*color-scheme:\s*light[^}]*--ai-bg:\s*#ffffff/);
  assert.doesNotMatch(css, /body\[data-theme="(?:studio|research|arcane|scifi)"\] \.history-panel/);
  assert.match(openHistory, /panel\.inert = false/);
  assert.match(closeHistory, /panel\.contains\(document\.activeElement\)[\s\S]*?button\.focus\(\{ preventScroll:true \}\)[\s\S]*?panel\.inert = true[\s\S]*?aria-hidden", "true"/);
  for (const name of ["historyStorageLocation", "newCanvasStorageLocation"]) {
    assert.match(html, new RegExp(`name="${name}" value="device"`));
    assert.match(html, new RegExp(`name="${name}" value="server"`));
    assert.match(html, new RegExp(`name="${name}" value="cloud"`));
  }
  for (const key of ["saveLocation", "storageThisDevice", "storagePenEchoServer", "storagePenEchoCloud", "storageThisDeviceDescription", "storagePenEchoServerDescription", "storagePenEchoCloudDescription", "cloudCanvasConflict"]) {
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
  assert.match(functionSource(app, "serverSnapshotItems"), /fetch\("\/api\/canvases"/);
  assert.match(functionSource(app, "serverSnapshotItems"), /fetch\("\/api\/canvas-projects"/);
  assert.match(functionSource(app, "saveServerSnapshot"), /method:overwriteId \? "PUT" : "POST"/);
  assert.match(functionSource(app, "deleteServerSnapshot"), /method:"DELETE"/);
  assert.match(functionSource(app, "cloudSnapshotItems"), /\/api\/cloud\/library[\s\S]*?bundleVersion !== 2[\s\S]*?conflictPolicy !== "base-revision-required"/);
  assert.match(functionSource(app, "saveCloudSnapshot"), /baseRevisionId[\s\S]*?\/api\/cloud\/canvases\/[\s\S]*?status === 409[\s\S]*?cloudCanvasConflict[\s\S]*?\/api\/cloud\/projects\//);
  assert.match(functionSource(app, "readCloudSnapshot"), /\/api\/cloud\/canvases\/[\s\S]*?body\?\.revision\?\.id[\s\S]*?readSnapshotBundle/);
  assert.match(functionSource(app, "openCloudProjectHistory"), /setSnapshotLocation\("cloud", \{ refresh:false \}\)[\s\S]*?refreshSnapshots\(\)[\s\S]*?openHistoryPanel\(false\)/);
  assert.match(functionSource(app, "openHistoryPanel"), /if \(refresh\) refreshSnapshots\(\)/);
  for (const key of ["snapshotLibraryLoading", "snapshotLibraryLoadingDetail", "snapshotLoading", "snapshotLoadDownloading", "snapshotLoadDecoding", "snapshotLoadApplying"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
  for (const id of ["historyActivity", "historyActivityTitle", "historyActivityDetail", "historyActivityProgress"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(app, /function setSnapshotLocation\([\s\S]*?snapshotItems = \[\][\s\S]*?snapshotItemsLocation = null[\s\S]*?renderSnapshotListLoading\(location\)/);
  assert.match(app, /function setSnapshotLocation\([\s\S]*?snapshotLoadInProgress[\s\S]*?state\.snapshotLoadGeneration\+\+[\s\S]*?snapshotLoadInProgress = false/);
  assert.match(functionSource(app, "updateHistoryReadControls"), /input\[name="historyStorageLocation"\][\s\S]*?control\.disabled = snapshotSaveInProgress/);
  assert.match(functionSource(app, "refreshSnapshots"), /snapshotItemsLocation !== location[\s\S]*?renderSnapshotListLoading\(location\)[\s\S]*?snapshotItemsLocation = location/);
  assert.match(functionSource(app, "loadSnapshot"), /setHistoryActivity[\s\S]*?snapshotLoadRequesting[\s\S]*?snapshotLoadDownloading[\s\S]*?snapshotLoadDecoding[\s\S]*?snapshotLoadApplying/);
  assert.match(functionSource(app, "loadSnapshot"), /if \(!loadIsCurrent\(\)\) return;[\s\S]*?loadGeneration !== state\.snapshotLoadGeneration[\s\S]*?return false/);
  for (const id of ["serverProjectManager", "historyProjectSelect", "historyProjectCreate", "historyProjectDelete", "projectDialog", "projectForm", "projectName", "projectDialogCreate", "newCanvasProjectField", "newCanvasProjectSelect"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.doesNotMatch(html, /id="projectDialogCancel"/);
  assert.match(functionSource(app, "openServerProjectDialog"), /projectDialog[\s\S]*?showModal\(\)[\s\S]*?input\.focus\(\)/);
  assert.match(functionSource(app, "createServerProject"), /projectName[\s\S]*?input\.value\.trim\(\)\.slice\(0, 48\)[\s\S]*?fetch\(isCloud \? "\/api\/cloud\/projects" : "\/api\/canvas-projects"[\s\S]*?dialog\.close\("created"\)/);
  assert.doesNotMatch(app, /\bprompt\s*\(/);
  assert.match(functionSource(app, "storedServerProjectId"), /sessionStorage\.getItem\(SERVER_PROJECT_SESSION_KEY\)/);
  assert.match(functionSource(app, "rememberSelectedServerProject"), /sessionStorage\.setItem\(SERVER_PROJECT_SESSION_KEY, selectedServerProjectId\)/);
  assert.match(functionSource(app, "selectedServerSaveProjectId"), /selectedServerProjectId === SERVER_ALL_PROJECTS_ID \? SERVER_DEFAULT_PROJECT_ID/);
  assert.match(app, /async function saveSnapshot\([\s\S]*?projectId:location === "server"[\s\S]*?overwriteId[\s\S]*?selectedServerSaveProjectId\(\)/);
  assert.match(functionSource(app, "deleteSelectedServerProject"), /method:"DELETE"[\s\S]*?rememberSelectedServerProject\(SERVER_DEFAULT_PROJECT_ID\)/);
  assert.match(functionSource(app, "moveServerSnapshot"), /\/api\/canvases\/\$\{encodeURIComponent\(id\)\}\/project[\s\S]*?projectId/);
  assert.match(functionSource(app, "requestLoadSnapshot"), /canvasHasUnsavedChanges\(\)[\s\S]*?pendingCanvasTransition = \{ id, location \}[\s\S]*?showModal/);
  assert.match(functionSource(app, "openNewCanvasDialog"), /!canvasHasUnsavedChanges\(\)[\s\S]*?startBlankCanvas\(\)[\s\S]*?showModal/);
  assert.match(functionSource(app, "canvasHasUnsavedChanges"), /state\.dirty \|\| state\.userRevision !== state\.snapshotSavedRevision/);
  assert.match(css, /\.history-card\s*\{[^}]*grid-template-columns:\s*136px/);
  assert.match(css, /\.history-preview\s*\{[^}]*width:\s*136px[^}]*min-height:\s*96px[^}]*align-self:\s*stretch/);
  assert.doesNotMatch(css, /\.history-preview\s*\{[^}]*height:\s*80px/);
  assert.match(css, /\.history-save-row\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto/);
  assert.match(css, /\.history-meta\s*\{[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\)/);
  assert.match(css, /\.snapshot-location-options\s*\{[^}]*grid-template-columns:\s*repeat\(3/);
  assert.doesNotMatch(html, /class="history-kicker"/);
  assert.match(css, /\.history-list-loading\s*\{[^}]*min-height:\s*44px[^}]*border:\s*0/);
  assert.match(css, /\.history-empty\s*\{[^}]*padding:\s*12px[^}]*border:\s*0/);
  assert.match(css, /\.history-projects \.history-project-delete\s*\{[^}]*color:\s*var\(--ai-faint\)[^}]*background:\s*transparent/);
  assert.match(css, /\.new-canvas-fields\s*\{[^}]*display:\s*grid;[^}]*gap:\s*12px;[^}]*\}/);
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
  assert.match(functionSource(persistence, "refreshSnapshots"), /authenticationRequired[\s\S]*?renderCloudHistorySignIn[\s\S]*?!authenticationRequired[\s\S]*?setHistoryActivity[\s\S]*?"error"/);
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
  assert.match(css, /\.history-cloud-auth button\s*\{[^}]*min-height:\s*36px/);
  assert.match(css, /\.history-cloud-auth button:hover:not\(:disabled\), \.history-cloud-auth button:focus-visible\s*\{[^}]*color:\s*var\(--ai-primary-ink\)[^}]*background:\s*var\(--ai-primary-hover\)/);
  assert.match(css, /#historyClose, \.new-canvas-close\s*\{[^}]*width:\s*36px[^}]*height:\s*36px[^}]*flex:\s*0 0 36px/);
  for (const selector of [
    "history-save-row input",
    "history-projects select",
    "history-projects button",
    "history-actions button",
    "history-move",
    "new-canvas-project select, \\.new-snapshot-name input",
    "new-canvas-actions button",
  ]) assert.match(css, new RegExp(`\\.${selector}\\s*\\{[^}]*min-height:\\s*36px`));
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

test("New, Export, Clear, and Debug are accessible theme-aware icon buttons", () => {
  const html = read("public/index.html"), css = read("public/style.css");
  for (const id of ["newCanvasBtn", "exportPngBtn", "clearCanvasBtn", "debugBtn"]) {
    const button = html.match(new RegExp(`<button[^>]*id="${id}"[\\s\\S]*?<\\/button>`))?.[0] || "";
    assert.match(button, /class="[^"]*icon-button[^"]*utility-icon[^"]*"/);
    assert.match(button, /data-i18n-aria=/);
    assert.match(button, /data-i18n-title=/);
    assert.match(button, /<svg /);
    assert.doesNotMatch(button, />\s*(New|Clear|Debug)\s*</);
  }
  for (const theme of ["arcane", "scifi", "research", "studio"]) assert.match(html, new RegExp(`value="${theme}"`));
  assert.match(css, /button\.utility-icon:not\(\.active\).*var\(--ink\)/);
  assert.match(css, /button\.utility-icon\.danger:not\(\.active\).*var\(--danger\)/);
});

test("Studio theme is wired through initialization, localization, and snapshots", () => {
  const html = read("public/index.html"), app = read("public/app.js"), css = read("public/style.css"), zh = read("public/locales/zh.js");
  const studioOption = html.match(/<option\b[^>]*\bvalue="studio"[^>]*>[^<]*<\/option>/)?.[0] || "";
  assert.match(studioOption, /data-i18n="themeStudio"/);
  assert.match(studioOption, /\bselected\b/);
  assert.match(html, /<body\b[^>]*\bdata-theme="studio"/);
  assert.match(html, /<meta\b[^>]*\bname="theme-color"[^>]*\bcontent="#eef0f3"/);
  assert.match(html, /<div\b[^>]*\bid="aiEmbodiment"[^>]*\bdata-theme="studio"/);
  assert.match(app, /SUPPORTED_THEMES\s*=\s*new Set\(\[[^\]]*"studio"[^\]]*\]\)/);
  assert.match(app, /function normalizeTheme\(theme\)\s*\{\s*return SUPPORTED_THEMES\.has\(theme\) \? theme : "studio";/);
  assert.match(app, /initialTheme\s*=\s*normalizeTheme\(storedTheme\)/);

  const themeCopy = functionSource(app, "updateThemeCopy"), embodimentCopy = functionSource(app, "updateEmbodimentLabel"), loadSnapshot = functionSource(app, "loadSnapshot");
  assert.match(themeCopy, /studio:\s*"themeFocusStudio"/);
  assert.doesNotMatch(themeCopy, /tagline/);
  assert.match(embodimentCopy, /studio:\s*"guideStudio"/);
  assert.match(loadSnapshot, /applyTheme\(item\.theme\)/);
  assert.match(functionSource(app, "applyTheme"), /theme\s*=\s*normalizeTheme\(theme\)/);

  for (const key of ["themeStudio", "themeFocusStudio", "guideStudio"]) {
    assert.match(app, new RegExp(`\\b${key}:\\s*"`));
    assert.match(zh, new RegExp(`\\b${key}:\\s*"`));
  }
  assert.doesNotMatch(html, /data-i18n="tagline"/);
  assert.doesNotMatch(app, /\btagline(?:Arcane|Scifi|Research|Studio)?\s*:/);
  assert.doesNotMatch(zh, /\btagline(?:Arcane|Scifi|Research|Studio)?\s*:/);
  assert.match(css, /body\[data-theme="studio"\]\s*\{/);
  assert.match(css, /body\[data-theme="studio"\]\.is-fullscreen\s+#viewport\s*\{[^}]*height:\s*100%[^}]*min-height:\s*0/);
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

test("PNG export crops to all ink with one tile of padding at native resolution", () => {
  const html = read("public/index.html"), app = read("public/app.js"), ink = functionSource(app, "exportInkBounds"), region = functionSource(app, "exportRegion"), render = functionSource(app, "renderExportCanvas"), run = functionSource(app, "exportCanvasPng");
  assert.match(ink, /inkBox\(tileCanvas/);
  assert.doesNotMatch(ink, /visibleInkBounds/);
  assert.match(region, /Math\.floor\(ink\.x\) - TILE/);
  assert.match(region, /Math\.ceil\(ink\.x \+ ink\.w\) \+ TILE/);
  assert.match(region, /Math\.ceil\(ink\.y \+ ink\.h\) \+ TILE/);
  assert.match(app, /EXPORT_MAX_DIMENSION = 16384,[\s\S]*?EXPORT_MAX_PIXELS = 64 \* 1024 \* 1024/);
  assert.doesNotMatch(app, /EXPORT_TARGET_SCALE|function exportPixelScale/);
  assert.match(render, /prepareVisibleWidgetSnapshots\(null, false\)/);
  assert.match(render, /scale = Math\.min\(1, EXPORT_MAX_DIMENSION \/ region\.w, EXPORT_MAX_DIMENSION \/ region\.h, Math\.sqrt\(EXPORT_MAX_PIXELS \/ \(region\.w \* region\.h\)\)\)/);
  assert.match(render, /offscreen\(Math\.max\(1, Math\.ceil\(region\.w \* scale\)\), Math\.max\(1, Math\.ceil\(region\.h \* scale\)\)\)/);
  assert.match(render, /setTransform\(scale, 0, 0, scale, -region\.x \* scale, -region\.y \* scale\)/);
  assert.match(render, /state\.paint\.paper/);
  assert.match(render, /state\.gridVisible/);
  assert.match(render, /for \(const \[tileKey, tileCanvas\] of tiles\)/);
  assert.match(render, /selection\?\.phase === "active"/);
  assert.match(run, /canvasBlob\(canvas\)/);
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

test("toolbar exposes a fixed clickable reasoning menu before the drawing tools", () => {
  const html = read("public/index.html"), app = read("public/app.js"), css = read("public/style.css"), zh = read("public/locales/zh.js");
  const section = html.indexOf('id="aiToolsSection"'), auto = html.indexOf('id="autoControl"'), effort = html.indexOf('id="effortControl"'), font = html.indexOf('id="aiFont"'), pen = html.indexOf('data-mode="pen"'), fullscreen = html.indexOf('id="fullscreenBtn"'), grid = html.indexOf('id="gridToggle"');
  assert.ok(section < auto && auto < effort && effort < pen && pen < font);
  assert.ok(pen < fullscreen && fullscreen < grid);
  assert.match(html, /id="aiToolsSection"[^>]*data-i18n-aria="aiTools"[\s\S]*?class="ai-section-label"[^>]*>AI<\/span>/);
  assert.match(html, /<label[^>]*class="settings-row"[^>]*>[\s\S]*?<span data-i18n="aiFont">AI font<\/span>[\s\S]*?id="aiFont"/);
  assert.match(css, /\.ai-tools-section\s*\{/);
  assert.match(css, /\.view-tools\s*\{/);
  assert.match(html, /id="aiEffortButton"[^>]*aria-haspopup="listbox"/);
  assert.match(html, /id="effortPopover"[^>]*hidden/);
  assert.equal((html.match(/class="effort-option"/g) || []).length, 6);
  assert.match(html, /data-effort="config"/);
  for (const mode of ["pen", "eraser", "select"]) {
    const button = html.match(new RegExp(`<button[^>]*data-mode="${mode}"[\\s\\S]*?<\\/button>`))?.[0] || "";
    assert.match(button, /class="[^"]*icon-button[^"]*"/);
    assert.match(button, /data-i18n-aria=/);
    assert.match(button, /data-i18n-title=/);
    assert.doesNotMatch(button, /<span/);
  }
  assert.match(app, /penecho-ai-effort/);
  assert.match(app, /reasoningEffort === "config" \? \{\} : \{ reasoningEffort: state\.reasoningEffort \}/);
  assert.match(app, /const EFFORT_LEVELS = \["none", "low", "medium", "high", "max"\]/);
  assert.match(app, /EFFORT_OPTIONS = \["config", \.\.\.EFFORT_LEVELS\]/);
  assert.match(css, /\.effort-control\s*\{[^}]*width:\s*172px;[^}]*flex:\s*0 0 172px/);
  assert.doesNotMatch(css, /effort-slider-shell|effort-thumb|effort-dots/);
  for (const key of ["reasoningEffort", "reasoningEffortDisplay", "effortConfigured", "effortConfiguredShort", "effortNone", "effortLow", "effortMedium", "effortMediumShort", "effortHigh", "effortMaximum"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
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
  assert.match(addText, /returnMode = state\.mode[\s\S]*?setCanvasMode\("hand"/);
  assert.match(addText, /createTextEditor\(clipboardTextEditorPoint\(\), \{ text:value, returnMode \}\)/);
  assert.match(createText, /textarea\.value = typeof options\.text === "string"/);
  assert.match(createText, /returnMode:typeof options\.returnMode === "string"/);
  assert.match(restoreTextMode, /returnMode && state\.mode === "hand"[\s\S]*?setCanvasMode\(returnMode/);
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
  assert.match(app, /header\.append\(title, helpButton, mixedModeButton, acceptButton, cancelButton\)/);
  assert.match(app, /openTextHelp\(editor, helpButton\)/);
  assert.match(app, /function fittedTextBoxContent\(text, fontSize, color, maxWidth\)/);
  assert.match(app, /preview\.className = "text-editor-preview"/);
  assert.match(app, /mixedModeButton\.setAttribute\("aria-controls", preview\.id\)/);
  assert.match(app, /state\.latestTypedInput = \{ text: text\.slice\(0, TEXT_INPUT_MAX_LENGTH\), box \}/);
  const confirm = functionSource(app, "confirmTextEditor"),
    cancel = functionSource(app, "cancelTextEditor"),
    reconcile = functionSource(app, "reconcileDirtyAfterTextBoxDeletion"),
    create = functionSource(app, "createTextEditor"),
    setMode = functionSource(app, "setCanvasMode"),
    openHelp = functionSource(app, "openTextHelp"),
    restoreHelp = functionSource(app, "restoreTextEditorAfterHelp"),
    toggle = functionSource(app, "toggleTextEditorMixedMode"),
    update = functionSource(app, "updateTextEditorMixedMode"),
    preview = functionSource(app, "renderTextEditorPreview");
  assert.doesNotMatch(confirm, /hotspotTrail\.push/);
  assert.match(app, /TEXT_INPUT_GUARD_MS\s*=\s*500/);
  assert.match(confirm, /blockCanvasInput\(TEXT_INPUT_GUARD_MS\)/);
  assert.match(cancel, /blockCanvasInput\(TEXT_INPUT_GUARD_MS\)/);
  assert.match(cancel, /editor\.sourceTextBoxId[\s\S]*?recordTextBoxesBefore\(\)[\s\S]*?state\.textBoxes\.splice\(index, 1\)[\s\S]*?state\.userRevision\+\+[\s\S]*?save\(\)/);
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
  assert.match(confirm, /fittedTextBoxContent\(text, fontSize, color, maxWidth\)/);
  assert.match(confirm, /Math\.min\(SIZE - width, x\)/);
  assert.match(confirm, /Math\.min\(SIZE - height, y\)/);
  assert.match(confirm, /state\.textBoxes\.splice\(existingIndex, 1, item\)[\s\S]*?state\.textBoxes\.push\(item\)/);
  assert.doesNotMatch(confirm, /blitSized\(|retainSharpOverlay\(/);
  assert.match(app, /function editTextBox\(item\)/);
  assert.match(app, /state\.mode !== "hand"[\s\S]*?sourceTextBoxId:item\.id/);
  assert.match(css, /\.text-editor\s*\{[^}]*box-shadow:\s*none/);
  assert.match(css, /\.text-editor-button\s*\{[^}]*width:\s*34px;[^}]*height:\s*34px;[^}]*box-shadow:\s*none/);
  assert.ok(confirm.indexOf('setCanvasMode("pen")') > confirm.indexOf("if (!text.trim())"));
  assert.ok(confirm.indexOf('setCanvasMode("pen")') < confirm.indexOf("await fittedTextBoxContent"));
  assert.match(cancel, /setCanvasMode\("pen"\)/);
  assert.match(setMode, /state\.mode = mode/);
  assert.match(setMode, /classList\.toggle\("active", item === button\)/);
  assert.match(app, /button\.onclick = \(\) => setCanvasMode\(button\.dataset\.mode, \{ showHint:true \}\)/);
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
  assert.match(css, /\.text-editor\s*\{[^}]*pointer-events:\s*auto;[^}]*border:\s*1px dashed[^}]*background:[^}]*box-shadow:\s*none/);
  assert.match(css, /\.text-editor-header\s*\{[^}]*border-bottom:\s*1px dashed[^}]*background:/);
  assert.match(css, /\.text-editor-body\s*\{[^}]*background:\s*transparent/);
  assert.match(css, /\.text-editor-preview\s*\{[^}]*background:\s*transparent/);
  assert.match(css, /\.text-editor-input\[hidden\]\s*\{[^}]*display:\s*none/);
  assert.match(css, /font:\s*var\(--text-editor-font-size\)\/1\.35/);
  assert.match(css, /\.text-editor-button\.mixed-mode\[aria-pressed="true"\]/);
  assert.match(css, /\.text-editor-button\.help/);
  assert.match(css, /\.text-help-dialog\s*\{[^}]*max-height:\s*calc\(100dvh - 24px\)[^}]*overflow:\s*auto/);
  assert.match(css, /\.text-help-example pre\s*\{[^}]*overflow-wrap:\s*anywhere[^}]*white-space:\s*pre-wrap/);
  assert.match(css, /#textEditorLayer\s*\{[^}]*z-index:\s*6/);
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
    pointerMove = app.slice(pointerMoveStart, pointerMoveEnd);
  assert.match(pointerMove, /if \(e\.pointerType !== "touch"\) updateWidgetRefinePointer\(clientPoint\(e\)\)/);
  assert.match(pointerMove, /if \(!state\.drawing \|\| state\.drawing\.id !== e\.pointerId\) return[\s\S]*?stroke\(a, p, d\.erase, size, true\)/);
  assert.match(app, /const shouldRequest = !d\.erase/);
  assert.match(app, /if \(shouldRequest\) \{\s*for \(const point of d\.trail\) state\.hotspotTrail\.push\(point\)/);
  assert.match(app, /recomputeDirtyBounds\(\);\s*filterErasedDirtyHotspots\(d\.dirtyMaskTouched\);\s*refineCandidate = relatchWidgetRefineCandidateFromDirty\(\)/);
  assert.match(app, /if \(state\.dirty && state\.autoEligible && !refineCandidate\) schedule\(\)/);
  assert.match(app, /const erasing = state\.mode === "eraser";\s*if \(erasing\) clearWidgetRefineCandidate\(\)/);
  assert.match(functionSource(app, "invalidateRecognition"), /clearWidgetRefineCandidate\(\)[\s\S]*?state\.dirty = null/);
  assert.match(app, /erase: erasing/);
  assert.match(app, /dirtyMaskTouched:erasing \? new Set\(\) : null/);
  assert.match(app, /dot\(p, erasing, size, true\)/);
  assert.match(app, /stroke\(a, p, d\.erase, size, true\)/);
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

test("every manual magic action sends the complete current viewport without requiring dirty input", () => {
  const app = read("public/app.js"),
    html = read("public/index.html"),
    manual = functionSource(app, "invokeAIAction"),
    request = functionSource(app, "requestAI"),
    plan = functionSource(app, "planViewportImage"),
    build = functionSource(app, "buildViewportImage"),
    automatic = functionSource(app, "launchAutomaticAI"),
    selection = functionSource(app, "requestSelectionAI");
  for (const action of ["answer", "hint", "continue", "explain", "plot"]) assert.match(html, new RegExp(`data-ai-action="${action}"`));
  assert.match(manual, /requestAI\(action, null, \{ captureCurrentViewport: true \}\)/);
  assert.doesNotMatch(manual, /action === "answer"|state\.dirty/);
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
    busy = functionSource(app, "setBusy"), stop = functionSource(app, "stopActiveAIRequests"), open = functionSource(app, "openRadialMenu"),
    close = functionSource(app, "closeRadialMenu"), reveal = functionSource(app, "revealAIOrb"), idle = functionSource(app, "scheduleAIOrbIdle"),
    supersede = functionSource(app, "supersedeActiveAI");
  assert.match(html, /id="aiOrb"[\s\S]*?class="ai-stop-icon"/);
  assert.match(busy, /classList\.toggle\("working", state\.busy\)[\s\S]*?aria-haspopup[\s\S]*?closeRadialMenu\(\)[\s\S]*?updateEmbodimentLabel\(\)/);
  assert.match(stop, /state\.activeAI \|\| aiPreparation[\s\S]*?radialSuppressClickUntil[\s\S]*?supersedeActiveAI\("user-stop"\)/);
  assert.match(open, /if \(state\.busy\) return/);
  assert.match(open, /revealAIOrb\(\)[\s\S]*?classList\.add\("menu-open"\)/);
  assert.match(close, /classList\.remove\("menu-open"\)[\s\S]*?!state\.busy\) scheduleAIOrbIdle\(\)/);
  assert.match(reveal, /clearTimeout\(state\.aiOrbIdleTimer\)[\s\S]*?classList\.remove\("idle-dim"\)/);
  assert.match(idle, /revealAIOrb\(\)[\s\S]*?classList\.add\("idle-dim"\)[\s\S]*?AI_ORB_IDLE_DELAY_MS/);
  assert.match(app, /const AI_ORB_IDLE_DELAY_MS = 5000/);
  assert.match(app, /setNavigating\(true\);\s*scheduleAIOrbIdle\(\);/);
  assert.match(css, /\.ai-embodiment\s*\{[^}]*transition:\s*opacity \.32s ease/);
  assert.match(css, /\.ai-embodiment\.idle-dim:not\(\.working\):not\(\.menu-open\)[^{]*\{[^}]*opacity:\s*\.36/);
  assert.match(app, /aiOrb\.addEventListener\("pointerdown"[\s\S]*?if \(state\.busy\)[\s\S]*?stopActiveAIRequests\(\)/);
  assert.match(app, /aiOrb\.addEventListener\("click"[\s\S]*?if \(state\.busy\)[\s\S]*?stopActiveAIRequests\(\)/);
  assert.match(css, /\.ai-embodiment\.working \.ai-stop-icon\s*\{[^}]*display:\s*block/);
  assert.match(zh, /stopAIRequest:\s*"停止当前 AI 请求"/);
  assert.doesNotMatch(stop, /fetch\(|\/api\//);
  assert.match(supersede, /reason === "user-stop"[\s\S]*?restoreDirty\(active\.dirtySnapshot\)[\s\S]*?refreshWidgetRefineHoverCandidate\(\)/);
  assert.match(supersede, /const preparation = aiPreparation[\s\S]*?preparation\.controller\.abort\(\)[\s\S]*?phase:"preparing"/);
  assert.match(functionSource(app, "activeWidgetRefinement"), /aiPreparation\?\.widgetEdit \|\| state\.activeAI\?\.widgetEdit/);
});

test("AI drafts move only from the dedicated Hand chrome", () => {
  const app = read("public/app.js"),
    pointerDownStart = app.indexOf('screen.addEventListener("pointerdown"'),
    pointerDownEnd = app.indexOf('screen.addEventListener("pointermove"', pointerDownStart),
    pointerDown = app.slice(pointerDownStart, pointerDownEnd),
    specs = functionSource(app, "pendingChromeSpecs"),
    begin = functionSource(app, "beginObjectChromeMove");
  assert.match(specs, /kind:"move"[\s\S]*?target:"pending"/);
  assert.match(begin, /spec\.target === "pending"[\s\S]*?beginPendingGesture\(event, "move", spec\.itemIndex\)/);
  assert.match(pointerDown, /\["resize", "width", "height", "batch-resize"\]\.includes\(hit\)/);
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

test("AI text and formula drafts expose copy and axis-resize controls", () => {
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
    update = functionSource(app, "updatePendingGesture");
  const box = { x: 100, y: 120, w: 300, h: 180 },
    edge = points({ x: 0, y: 0, w: 300, h: 180 }, 14, true, true),
    radius = 14 * 0.54;

  assert.equal(copyTextForCommand({ tool: "write_text", text: "copy me" }), "copy me");
  assert.equal(copyTextForCommand({ tool: "draw_formula", latex: "x^2" }), "x^2");
  assert.equal(copyTextForCommand({ tool: "plot_function", expression: "x^2" }), null);
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
  assert.match(functionSource(app, "pendingChromeSpecs"), /kind:"move"[\s\S]*?kind:"cancel"[\s\S]*?kind:"accept"[\s\S]*?kind:"copy"/);
  assert.match(functionSource(app, "pendingChromeSpecs"), /copyPendingText\(itemIndex\)/);
  assert.match(hit, /draftActionPoints\(box, s, pendingCopyable\(item\)\)/);
  assert.match(hit, /\.sort\(\(a, b\) => a\.distance - b\.distance \|\| b\.z - a\.z\)/);
  assert.match(start, /copyText = copyTextForCommand\(command\)/);
  assert.match(prepare, /copyText: copyTextForCommand\(c\)/);
  assert.match(update, /p\.scaleX = p\.scaleY = next/);
  assert.match(update, /g\.hit === "width"[\s\S]*?p\.scaleX = Math\.max/);
  assert.match(update, /g\.hit === "height"[\s\S]*?p\.scaleY = Math\.max/);
  assert.match(functionSource(app, "pendingChromeSpecs"), /pendingCopyable\(target\)[\s\S]*?copyPendingText\(itemIndex\)/);
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
  assert.match(button, /kind !== "move"[\s\S]*?button\.penechoSpec\?\.activate\?\.\(button\)/);
  assert.match(functionSource(app, "objectChromeLabel"), /kind === "copy"[\s\S]*?t\("copyText"\)/);
});

test("AI text copy uses the original command with an insecure-context fallback and local feedback", () => {
  const app = read("public/app.js"),
    clipboard = functionSource(app, "writeClipboardText"),
    fallback = functionSource(app, "fallbackCopyText"),
    copy = functionSource(app, "copyPendingText"),
    feedback = functionSource(app, "drawCopyFeedback");

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
  assert.match(copy, /target\.copyFeedbackUntil = performance\.now\(\) \+ COPY_FEEDBACK_MS/);
  assert.match(copy, /setStatusKey\("textCopied"\)/);
  assert.match(copy, /target\.copyFeedbackGeneration !== generation/);
  assert.match(feedback, /label = t\("textCopied"\)/);
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

test("AI text copy ignores stale clipboard completions and stale feedback timers", async () => {
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
        COPY_FEEDBACK_MS: 1600,
        performance: { now: () => 0 },
        pendingTextTarget: (value) => value,
        pendingCopyValue: (value) => value?.copyText,
        requestRender: () => {},
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
  assert.equal(current.pending.copyFeedbackGeneration, 2);
});

test("batch drafts paint every body before selected feedback", () => {
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
      drawCopyFeedback: (_ctx, box) => events.push(`feedback:${box.id}`),
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
  const firstFeedback = Math.min(events.indexOf("feedback:0"), events.indexOf("feedback:1")),
    lastBody = Math.max(events.indexOf("body:0"), events.indexOf("body:1"));
  assert.ok(firstFeedback > lastBody);
  assert.ok(events.indexOf("feedback:1") < events.indexOf("feedback:0"));
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
