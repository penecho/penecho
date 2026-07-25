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

test("New canvas controls are available in the toolbar and History panel", () => {
  const html = read("public/index.html"), app = read("public/app.js");
  assert.ok(html.indexOf('id="newCanvasBtn"') < html.indexOf('id="exportPngBtn"'));
  assert.ok(html.indexOf('id="exportPngBtn"') < html.indexOf('id="historyBtn"'));
  for (const id of ["historyNew", "newCanvasDialog", "newDiscard", "newSaveCopy", "newOverwrite"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(app, /currentSnapshotId:\s*null/);
  assert.match(app, /saveSnapshot\(\{\s*overwriteId\s*=\s*null,\s*name\s*=\s*null\s*\}/);
  assert.match(app, /completeNewCanvas\("overwrite"\)/);
  assert.match(app, /function startBlankCanvas\(\)/);
  assert.match(functionSource(app, "startBlankCanvas"), /clearTextEditors\(\)/);
  assert.match(functionSource(app, "loadSnapshot"), /clearTextEditors\(\)/);
});

test("canvas photos use one picker, editable image records, side action bar, and no auto AI", () => {
  const html = read("public/index.html"), app = read("public/app.js"), zh = read("public/locales/zh.js"), css = read("public/style.css"),
    end = functionSource(app, "end"),
    save = functionSource(app, "save"),
    loadSnapshot = functionSource(app, "loadSnapshot"),
    startBlankCanvas = functionSource(app, "startBlankCanvas"),
    renderExportCanvas = functionSource(app, "renderExportCanvas");

  assert.match(html, /id="imagePickerBtn"/);
  assert.match(html, /id="imagePickerInput" type="file" accept="image\/\*" hidden/);
  assert.doesNotMatch(html, /id="imagePickerInput"[^>]*\bcapture\b/);
  assert.match(app, /MAX_VISIBLE_IMAGES = 20/);
  assert.match(app, /IMAGE_TOUCH_HOLD_MS = 500/);
  assert.match(app, /function canvasIdentityGeneration\(\)/);
  assert.match(app, /function beginCanvasPointerAction\(e, point\)/);
  assert.match(app, /isAnimationActivationPointer\(e\) && valid\(point\)\) \{\s*const item = imageAtPoint\(point\);[\s\S]{0,220}?beginImageTouchHold\(e, point, item\)/);
  assert.match(app, /hold\.pointerType === "touch"[\s\S]{0,200}?beginCanvasPointerAction\(hold\.downEvent, hold\.point\)/);
  assert.match(app, /imageTapHold && imageTapHold\.pointerType !== "touch"[\s\S]{0,80}?beginCanvasPointerAction\(imageTapHold\.downEvent, imageTapHold\.point\)/);
  const mergeImage = functionSource(app, "mergeImage"),
    beginImageGesture = functionSource(app, "beginImageGesture"),
    addImageFile = functionSource(app, "addImageFile"),
    imageControlHit = functionSource(app, "imageControlHit"),
    drawImageChrome = functionSource(app, "drawImageChrome"),
    renderInteractionLayer = functionSource(app, "renderInteractionLayer");
  assert.doesNotMatch(addImageFile, /requestAI|buildViewportImage/);
  assert.match(addImageFile, /beginImageEdit\(item\)/);
  assert.doesNotMatch(beginImageGesture, /result\.hit === "(accept|merge|cancel)"/);
  assert.match(mergeImage, /recordBefore\(tx, ty\)[\s\S]{0,160}?drawImage\(item\.image/);
  assert.match(mergeImage, /extendInkBounds\(key\(tx, ty\)/);
  assert.match(mergeImage, /state\.images\.filter/);
  assert.match(mergeImage, /mergeDirty[\s\S]*?schedule\(\)[\s\S]*?save\(\)/);
  assert.doesNotMatch(imageControlHit, /draftActionPoints|merge/);
  assert.doesNotMatch(drawImageChrome, /drawDraftActions|drawImageMergeAction/);
  for (const id of ["imageEditBar", "imagePlaceBtn", "imageMergeBtn", "imageDeleteBtn"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(css, /\.image-edit-bar \{/);
  assert.match(css, /\.image-action-hint \{/);
  assert.match(app, /function positionImageEditBar\(\)/);
  assert.match(renderInteractionLayer, /positionImageEditBar\(\)/);
  assert.match(app, /imagePlaceButton\.onclick = \(\) => acceptImageEdit\(\)/);
  assert.match(app, /imageMergeButton\.onclick =[\s\S]{0,80}?mergeImage\(item\)/);
  assert.match(app, /imageDeleteButton\.onclick =[\s\S]{0,80}?deleteImage\(item\)/);
  assert.match(app, /images = storedImages\(\)/);
  assert.match(loadSnapshot, /decodeStoredImages\(item\.images\)/);
  assert.match(loadSnapshot, /restoreImages\(images\)/);
  assert.match(startBlankCanvas, /restoreImages\(\[\]\)/);
  assert.match(save, /imagesBefore[\s\S]*?imagesAfter[\s\S]*?state\.history\.push\(\{[^}]*imagesBefore, imagesAfter/);
  assert.match(renderExportCanvas, /drawImagesToContext\(context, region\)/);
  assert.ok(end.indexOf("cancelImageTouchHold") < end.indexOf("state.widgetGesture"));
  assert.ok(end.indexOf("state.imageGesture") < end.indexOf("state.pendingGesture"));
  assert.equal((app.match(/imagePickerButton\.addEventListener\("click"/g) || []).length, 1);
  for (const key of ["addImage", "imageAdded", "imageSelected", "imageDeleted", "imageMerged", "imageEditBarLabel", "imagePlace", "imagePlaceHint", "imageMerge", "imageMergeHint", "imageDelete", "imageDeleteHint", "snapshotImages"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
});

test("declarative animation scenes use persistent, interaction, and dirty-region canvas layers", () => {
  const html = read("public/index.html"), app = read("public/app.js"), css = read("public/style.css");
  assert.ok(html.indexOf('src="animation.js"') < html.indexOf('src="app.js"'));
  for (const id of ["animationLayer", "interactionLayer", "animationControls", "animationPlayPause", "animationRestart", "animationDelete"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.ok(html.indexOf('id="screen"') < html.indexOf('id="animationLayer"'));
  assert.ok(html.indexOf('id="animationLayer"') < html.indexOf('id="interactionLayer"'));
  assert.match(css, /\.animation-layer\s*\{[^}]*z-index:\s*1/);
  assert.match(css, /\.interaction-layer\s*\{[^}]*z-index:\s*2/);
  assert.match(app, /acceptedTools\.includes\(c\.tool\)/);
  assert.match(app, /animations = serializedAnimations\(\),[\s\S]*?animationCount: animations\.length,[\s\S]*?animations,/);
  assert.match(app, /captureTime = performance\.now\(\)/);
  assert.match(app, /drawAnimationsToContext\(q, sourceRect, captureTime\)/);
  assert.match(app, /document\.addEventListener\("visibilitychange"[\s\S]*?document\.hidden\) stopAnimationFrames\(\)/);
  assert.match(app, /renderObjectCount = playing\.reduce[\s\S]*?minimumFrameMs = 1000 \/ \(renderObjectCount > 24 \? 30 : 60\)/);
  assert.match(functionSource(app, "renderAnimationLayer"), /mergeAnimationDirtyRects[\s\S]*?clearRect\(region\.x, region\.y, region\.w, region\.h\)/);
  assert.match(functionSource(app, "renderInteractionLayer"), /drawPreview[\s\S]*?drawSelection[\s\S]*?drawSelectedAnimation[\s\S]*?drawPending/);
  assert.match(app, /for \(const \{ k, image \} of decoded\) \{[\s\S]*?tiles\.set\(k, canvas\);\s*\}\s*restoreAnimations\(item\.animations\);/);

  const end = functionSource(app, "end"),
    captureSelection = functionSource(app, "captureSelection"),
    eraseRect = functionSource(app, "eraseRect"),
    eraseWithMask = functionSource(app, "eraseWithMask");
  assert.ok(end.indexOf("state.animationGesture") < end.indexOf("state.selectionGesture"));
  assert.ok(captureSelection.indexOf("invalidateSharpOverlays(box)") > captureSelection.indexOf("if (!fragments.length)"));
  assert.match(eraseRect, /invalidateSharpOverlays\(\{ x, y, w, h \}\);[\s\S]*?forTiles\(/);
  assert.match(eraseWithMask, /invalidateSharpOverlays\(\{ x, y, w, h \}\);[\s\S]*?forTiles\(/);

  const restoreState = { animations: [], selectedAnimationId: null, nextAnimationId: 1 },
    restore = vm.runInNewContext(`(${functionSource(app, "restoreAnimations")})`, {
      ANIMATION: { normalize: (scene) => scene },
      SIZE: 20000,
      MAX_VISIBLE_ANIMATIONS: 20,
      performance: { now: () => 100 },
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
  restore(Array.from({ length: 22 }, () => saved));
  assert.equal(restoreState.animations.length, 20);
  assert.equal(new Set(restoreState.animations.map((animation) => animation.id)).size, 20);
  assert.ok(restoreState.nextAnimationId >= 21);
});

test("plugin manager is a centered dynamic catalog with built-in animation and local Markdown plugins", () => {
  const html = read("public/index.html"), app = read("public/app.js"), zh = read("public/locales/zh.js");
  const css = read("public/style.css");
  for (const id of ["pluginControl", "pluginButton", "pluginPopover", "pluginOptions", "pluginClose", "pluginRefresh", "pluginLocalTab", "pluginCreateTab", "pluginServerTab", "pluginLocalPanel", "pluginCreatePanel", "pluginServerPanel"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.doesNotMatch(html, /id="animationPluginEnabled"/);
  assert.match(app, /BUILTIN_PLUGIN_DEFINITIONS\s*=\s*Object\.freeze\(\[/);
  assert.match(app, /PLUGIN_DEFINITIONS\s*=\s*\[\.\.\.BUILTIN_PLUGIN_DEFINITIONS\]/);
  assert.match(app, /id:\s*"animation"[\s\S]*?requestField:\s*"animationEnabled"[\s\S]*?defaultEnabled:\s*true[\s\S]*?onChange:\s*applyAnimationPluginState/);
  assert.doesNotMatch(app, /documentPath:\s*"plugins\/weather\.md"/);
  assert.match(functionSource(app, "loadPluginDocuments"), /fetch\("\/api\/plugins"[\s\S]*?defaultEnabled:\["general", "weather"\]\.includes\(item\.manifest\.id\)[\s\S]*?generalDefinitions[\s\S]*?PLUGIN_DEFINITIONS\.splice\(0, PLUGIN_DEFINITIONS\.length, \.\.\.generalDefinitions, \.\.\.BUILTIN_PLUGIN_DEFINITIONS, \.\.\.remainingDefinitions\)/);
  assert.match(app, /localStorage\.setItem\(PLUGIN_STORAGE_KEY, JSON\.stringify/);
  assert.match(app, /if \(!state\.pluginCatalogLoaded\) void loadPluginDocuments\(\)/);
  assert.match(app, /applyTheme\(state\.theme\);\s*loadPluginDocuments\(\)\.catch/);
  assert.match(app, /function pluginRequestPayload\(\)/);
  assert.match(app, /\.\.\.pluginRequestPayload\(\)/);
  assert.match(functionSource(app, "validate"), /acceptedTools = pluginEnabled\("animation"\)/);
  assert.match(functionSource(app, "animate"), /c\.tool === "animate_scene" && !pluginEnabled\("animation"\)/);
  assert.match(functionSource(app, "preparePendingItem"), /c\.tool === "animate_scene" && !pluginEnabled\("animation"\)/);
  assert.match(functionSource(app, "renderPluginOptions"), /localizedManifestValue[\s\S]*?pluginPromptEstimate[\s\S]*?copy\.append\(titleRow, help, meta\)/);
  assert.match(functionSource(app, "renderPluginOptions"), /plugin\.id === "general"[\s\S]*?pluginRecommended[\s\S]*?generalPluginRecommendedHelp/);
  assert.match(functionSource(app, "renderPluginOptions"), /pluginSourceLabel[\s\S]*?pluginApiLabel[\s\S]*?manifest\.connect\.length[\s\S]*?pluginNoNetwork/);
  assert.match(functionSource(app, "renderPluginOptions"), /pluginPersonalSection[\s\S]*?plugin\.builtIn === false[\s\S]*?pluginBuiltInSection[\s\S]*?plugin\.builtIn !== false/);
  assert.match(app, /plugins\\\/\(\?:private\\\//);
  assert.match(css, /\.plugin-option-section-title\s*\{/);
  assert.match(css, /\.plugin-option-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.plugin-control\s*\{[^}]*height:\s*29px;\s*min-height:\s*29px/);
  assert.match(css, /@media \(pointer: coarse\)[\s\S]*?\.plugin-control\s*\{\s*height:\s*38px;\s*min-height:\s*38px;\s*\}[\s\S]*?\.toolbar \.plugin-trigger\s*\{\s*height:\s*36px;\s*min-height:\s*36px/);
  assert.match(css, /\.plugin-modal-layer\s*\{[^}]*position:\s*fixed[^}]*place-items:\s*center/);
  assert.match(css, /\.plugin-modal\s*\{[^}]*width:\s*min\(920px, 100%\)[^}]*max-height/);
  assert.match(html, /class="plugin-usage"[\s\S]*?data-i18n="pluginUsageDescription"/);
  assert.match(zh, /pluginUsageDescription:\s*"需要自定义界面时[\s\S]*?数据由你的浏览器直接获取/);
  assert.match(app, /generalPluginRecommendedHelp:\s*"Recommended\.[\s\S]*?interactive and dynamic content/);
  assert.match(zh, /generalPluginRecommendedHelp:\s*"建议开启[\s\S]*?交互内容和动态内容/);
  assert.match(html, /data-i18n="serverPluginsComingTitle"/);
  assert.match(app, /animationPluginCost:\s*"Adds about 500–600 prompt tokens/);
  assert.match(app, /animationPluginDisabledHelp:\s*"When enabled, the model can return animated demonstrations when explicitly requested or genuinely useful/);
  assert.match(zh, /animationPluginCost:\s*"每次 AI 请求约增加 500–600 个 prompt token"/);
  assert.match(zh, /animationPluginDisabledHelp:\s*"勾选后，大模型可在明确要求或确有必要时返回动态图演示。"/);
  assert.match(app, /MAX_VISIBLE_ANIMATIONS = 20/);
  assert.match(app, /animationLimitReached:\s*"Animation limit reached \(20\)/);
  assert.match(zh, /animationLimitReached:\s*"动画已达到 20 个上限/);
  assert.match(functionSource(app, "requestAI"), /animationLimitReached = pluginEnabled\("animation"\)[\s\S]*?state\.animations\.length >= MAX_VISIBLE_ANIMATIONS[\s\S]*?animate_scene[\s\S]*?setStatusKey\("animationLimitReached"\)/);
});

test("plugin creator offers one air-quality template, AI title completion, deletion, and local save-and-enable", () => {
  const html = read("public/index.html"), app = read("public/app.js"), css = read("public/style.css"), zh = read("public/locales/zh.js"), server = read("server.js");
  for (const id of ["pluginCreateForm", "pluginSimpleTemplate", "pluginTitle", "pluginDocumentEditor", "pluginDocumentBytes", "pluginDocumentStatus", "pluginImprove", "pluginSave"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.doesNotMatch(html, /id="pluginApiTemplate"|id="pluginImproveInstructions"/);
  assert.match(html, /data-i18n="sharePluginComing"[^>]*disabled|disabled[^>]*data-i18n="sharePluginComing"/);
  assert.match(html, /id="pluginCreateTab"[\s\S]*?class="plugin-preview"[\s\S]*?data-i18n="pluginPreview"/);
  assert.match(html, /data-i18n="createPluginDescription">Preview: this workflow has limited testing/);
  assert.match(zh, /createPluginDescription:\s*"Preview：此功能测试尚不充分/);
  assert.match(app, /const PLUGIN_TEMPLATE_DOCUMENTS = Object\.freeze\(\{/);
  assert.match(app, /simple: `[\s\S]*?我需要根据地点, 显示空气质量\.[\s\S]*?## One-shot example[\s\S]*?html_widget/);
  assert.doesNotMatch(app, /pluginApiTemplate|pluginImproveInstructions/);
  assert.match(functionSource(app, "pluginDraftValidation"), /PLUGINS\.parse[\s\S]*?pluginIdReserved[\s\S]*?pluginIdExists/);
  assert.match(functionSource(app, "improvePluginDraft"), /fetch\("\/api\/plugins\/improve"[\s\S]*?pluginDocumentEditor\.value = body\.document[\s\S]*?syncPluginTitleFromDocument/);
  assert.match(functionSource(app, "savePluginDraft"), /fetch\("\/api\/plugins"[\s\S]*?loadPluginDocuments\(\)[\s\S]*?setPluginEnabled\(savedId, true\)[\s\S]*?setPluginTab\("local"\)/);
  assert.match(functionSource(app, "deleteLocalPlugin"), /plugin\.builtIn !== false[\s\S]*?method:"DELETE"[\s\S]*?forgetPluginSetting[\s\S]*?loadPluginDocuments/);
  assert.match(functionSource(app, "renderPluginOptions"), /plugin\.builtIn === false[\s\S]*?data-plugin-delete|plugin\.builtIn === false[\s\S]*?dataset\.pluginDelete/);
  assert.match(functionSource(app, "setPluginTab"), /\["local", "create", "server"\]/);
  assert.match(css, /\.plugin-template-switch\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.match(css, /\.plugin-delete-button\s*\{/);
  assert.match(css, /\.plugin-create-actions\s*\{[^}]*grid-template-columns/);
  for (const key of ["createPlugin", "pluginSimpleTemplate", "pluginTitleLabel", "improvePluginWithAi", "saveAndEnablePlugin", "pluginMarketplaceNote", "pluginNoNetwork", "deletePlugin"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
  assert.match(server, /const PLUGIN_AUTHORING_SYSTEM = `[\s\S]*?under 3000 UTF-8 bytes[\s\S]*?do not include a full HTML example/);
  assert.match(functionSource(server, "pluginDocumentFromModel"), /matchAll[\s\S]*?candidates[\s\S]*?PLUGIN_FORMAT\.parse/);
  assert.match(functionSource(server, "improvePluginDocument"), /requestPluginAuthoringModel[\s\S]*?pluginDocumentFromModel[\s\S]*?pluginAuthoringRepairPrompt[\s\S]*?requestPluginAuthoringModel[\s\S]*?still failed validation/);
  assert.match(server, /url\.pathname === "\/api\/plugins"[\s\S]*?saveLocalPluginDocument\(body\.document\)/);
  assert.match(server, /url\.pathname === "\/api\/plugins\/improve"[\s\S]*?improvePluginDocument/);
  assert.match(server, /BUILTIN_PLUGIN_IDS[\s\S]*?function deleteLocalPlugin[\s\S]*?Built-in plugins cannot be deleted/);
  assert.match(server, /req\.method === "DELETE"[\s\S]*?deleteLocalPlugin\(id\)/);
});

test("disabled data plugins send no plugin payload and detach widget runtime hooks", () => {
  const app = read("public/app.js"), html = read("public/index.html"), requestPayload = functionSource(app, "pluginRequestPayload"), syncRuntime = functionSource(app, "syncWidgetRuntime"), pointerDown = app.slice(app.indexOf('screen.addEventListener("pointerdown"'), app.indexOf('screen.addEventListener("pointermove"'));
  assert.match(html, /id="widgetLayer"[^>]*\shidden(?:\s|>)/);
  assert.match(requestPayload, /if \(plugins\.length\) payload\.plugins = plugins/);
  assert.match(functionSource(app, "enabledPluginDescriptors"), /filter\(\(plugin\) => pluginEnabled\(plugin\.id\)\)/);
  assert.match(syncRuntime, /dataPluginDefinitions\(\)\.some[\s\S]*?widgetLayer\.hidden = !enabled[\s\S]*?addEventListener[\s\S]*?removeEventListener/);
  assert.doesNotMatch(app, /window\.addEventListener\("message", handleWidgetMessage\)/);
  assert.match(functionSource(app, "visibleWidgets"), /if \(!widgetRuntimeEnabled\(\)\) return \[\]/);
  assert.match(functionSource(app, "positionWidgets"), /if \(!widgetRuntimeEnabled\(\)\) return/);
  assert.match(functionSource(app, "drawWidgetChrome"), /if \(!widgetRuntimeEnabled\(\)\) return/);
  assert.match(pointerDown, /widgetRuntimeEnabled\(\) && valid\(point\) \? widgetPointerHit/);
  assert.match(functionSource(app, "validate"), /if \(widgetPluginIds\.size\) acceptedTools\.push\("html_widget"\)/);
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
    acceptAnimationEdit:()=>{},
  });
  position();
  assert.deepEqual(writes,{hidden:1,style:2,text:1});
  position();
  assert.deepEqual(writes,{hidden:1,style:2,text:1});
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
  assert.match(selected, /drawDraftActions\(context, box, handle, false, true\)/);
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
    chrome = functionSource(app, "drawWidgetChrome"),
    hit = functionSource(app, "widgetControlHit"),
    begin = functionSource(app, "beginWidgetGesture"),
    updatePoint = functionSource(app, "updateWidgetGesturePoint"),
    pointerHit = functionSource(app, "widgetPointerHit"),
    messageHandler = functionSource(app, "handleWidgetMessage"),
    positionWidget = vm.runInNewContext(`(${functionSource(app, "positionWidget")})`, {
      state:{ panX:10, panY:20, scale:0.2 },
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
  assert.match(functionSource(app, "widgetRecord"), /contentW = item\.contentW \?\? item\.w[\s\S]*?contentH = item\.contentH \?\? item\.h/);
  assert.doesNotMatch(functionSource(app, "widgetRecord"), /pluginManifests\.has/);
  assert.match(functionSource(app, "requestWidgetSnapshot"), /width:widget\.contentW, height:widget\.contentH/);
  assert.match(functionSource(app, "requestWidgetSnapshot"), /if \(widget\.snapshotPromise\) return widget\.snapshotPromise[\s\S]*?widget\.snapshotPromise = snapshotPromise[\s\S]*?widget\.snapshotPromise = null/);
  assert.match(chrome, /drawDraftActions\(context, box, handle, false, true\)/);
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
  assert.match(pointerHit, /hit && hit !== "move"/);
  assert.match(messageHandler, /validWidgetHostDrag\(message\)[\s\S]*?beginWidgetHostDrag\(widget, message\)[\s\S]*?updateWidgetHostDrag\(widget, message\)[\s\S]*?updateWidgetHostTouch[\s\S]*?finishWidgetHostDrag\(widget, message\)/);
  assert.match(messageHandler, /validWidgetHostTouch\(message\)[\s\S]*?beginWidgetHostTouch\(widget, message\)[\s\S]*?updateWidgetHostTouch\(widget, message\)[\s\S]*?finishWidgetHostTouch\(widget, message\)/);
  assert.match(functionSource(app, "sendWidgetHostState"), /selected[\s\S]*?penecho-widget-state[\s\S]*?scaleX[\s\S]*?scaleY/);
  assert.match(functionSource(app, "beginWidgetHostDrag"), /state\.touches\.keys[\s\S]*?releaseWidgetHostTouch[\s\S]*?source:"widget-host"[\s\S]*?hit:message\.hit[\s\S]*?startPoint:clientPoint/);
  assert.match(functionSource(app, "updateWidgetHostDrag"), /widgetHostViewportPoint[\s\S]*?updateWidgetGesturePoint/);
  assert.match(functionSource(app, "finishWidgetHostDrag"), /finishWidgetGesture/);
  assert.match(functionSource(app, "beginWidgetHostTouch"), /state\.touches\.set[\s\S]*?state\.touches\.size < 2[\s\S]*?beginTouchGesture/);
  assert.match(functionSource(app, "updateWidgetHostTouch"), /state\.touches\.size >= 2[\s\S]*?updateTouchGesture[\s\S]*?moveCanvas/);
  assert.match(functionSource(app, "finishWidgetHostTouch"), /state\.touches\.delete[\s\S]*?state\.touchGesture = null/);
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
  assert.match(css, /\.widget-layer\s*\{[^}]*z-index:\s*1[^}]*pointer-events:\s*none/);
  assert.match(css, /\.canvas-widget\s*\{[^}]*pointer-events:\s*none/);
  assert.match(frameRule, /pointer-events:\s*auto/);
  assert.match(frameRule, /touch-action:\s*none/);
  assert.match(frameRule, /border:\s*0/);
  assert.match(frameRule, /background:\s*transparent/);
  assert.doesNotMatch(frameRule, /box-shadow|border-radius/);
  assert.doesNotMatch(css, /canvas-widget-toolbar/);
  assert.match(read("server.js"), /Keep user-facing text natively selectable and do not globally disable text selection/);
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

test("mouse and pen select animations immediately while touch requires a one-second hold", () => {
  const app = read("public/app.js"),
    pointerDownStart = app.indexOf('screen.addEventListener("pointerdown"'),
    pointerDownEnd = app.indexOf('screen.addEventListener("pointermove"', pointerDownStart),
    pointerDown = app.slice(pointerDownStart, pointerDownEnd) + functionSource(app, "beginCanvasPointerAction"),
    pointerMoveStart = pointerDownEnd,
    pointerMoveEnd = app.indexOf("function end(e)", pointerMoveStart),
    pointerMove = app.slice(pointerMoveStart, pointerMoveEnd),
    activation = functionSource(app, "isAnimationActivationPointer"),
    touchHold = functionSource(app, "beginAnimationTouchHold");
  assert.doesNotMatch(activation, /pointerType === "touch"/);
  assert.match(activation, /pointerType === "mouse"/);
  assert.match(activation, /pointerType === "pen"/);
  assert.match(activation, /button === 0/);
  assert.match(app, /ANIMATION_TOUCH_HOLD_MS = 1000/);
  assert.match(app, /ANIMATION_TOUCH_HOLD_MOVE_PX = 10/);
  assert.match(touchHold, /setTimeout\([\s\S]*?beginAnimationGesture\([\s\S]*?ANIMATION_TOUCH_HOLD_MS/);
  assert.match(pointerDown, /pointerType === "touch"[\s\S]*?animationPointerHit\(point, e\.pointerType\)[\s\S]*?beginAnimationTouchHold/);
  assert.match(pointerMove, /animationTouchHold\?\.id === e\.pointerId[\s\S]*?ANIMATION_TOUCH_HOLD_MOVE_PX[\s\S]*?cancelAnimationTouchHold[\s\S]*?state\.panGesture/);
  assert.ok(pointerDown.indexOf("animationPointerHit(point") < pointerDown.indexOf('state.mode === "text"'));
  assert.ok(pointerDown.indexOf("animationPointerHit(point") < pointerDown.indexOf('if (e.pointerType === "touch")', pointerDown.indexOf('state.mode === "select"')));
  assert.ok(pointerDown.indexOf("animationPointerHit(point") < pointerDown.indexOf("state.drawing ="));
  assert.doesNotMatch(pointerDown, /state\.mode === "select"[\s\S]*?animationPointerHit/);
  assert.match(pointerDown, /state\.animationGesture\) finishAnimationGesture/);
  assert.ok(pointerDown.indexOf("if (state.selectedAnimationId) acceptAnimationEdit()") < pointerDown.indexOf('state.mode === "text"'));
  assert.match(functionSource(app, "acceptAnimationEdit"), /selectedAnimationId = null[\s\S]*?requestInteractionLayerRender\(\)/);
});

test("Save canvas exposes non-blocking progress and completion feedback", () => {
  const html = read("public/index.html"), app = read("public/app.js"), css = read("public/style.css"), zh = read("public/locales/zh.js");
  assert.match(html, /id="historyNotice"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(app, /async function saveSnapshotFromHistory\(\)/);
  assert.match(app, /showHistoryNoticeKey\("snapshotSaving", "busy", 0\)/);
  assert.match(app, /selectionBusyKey = selectionAIStatusKey\(\)/);
  assert.match(app, /showHistoryNoticeKey\(id \? "snapshotSaved" : selectionBusy \? selectionBusyKey : "emptyCanvas"/);
  assert.match(app, /historySave\"\)\.onclick = saveSnapshotFromHistory/);
  assert.match(app, /if \(event\.key === "Enter"\) saveSnapshotFromHistory\(\)/);
  assert.match(app, /button\.disabled = busy/);
  assert.match(css, /\.history-notice\s*\{[^}]*pointer-events:\s*none/);
  assert.match(css, /#historySave\.is-saving::before/);
  assert.match(zh, /snapshotSaving:/);
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
  assert.match(app, /initialTheme\s*=\s*\[[^\]]*"studio"[^\]]*\]\.includes\(storedTheme\)\s*\?\s*storedTheme\s*:\s*"studio"/);

  const themeCopy = functionSource(app, "updateThemeCopy"), embodimentCopy = functionSource(app, "updateEmbodimentLabel"), loadSnapshot = functionSource(app, "loadSnapshot");
  assert.match(themeCopy, /studio:\s*"taglineStudio"/);
  assert.match(themeCopy, /studio:\s*"themeFocusStudio"/);
  assert.match(embodimentCopy, /studio:\s*"guideStudio"/);
  assert.match(loadSnapshot, /\[[^\]]*"studio"[^\]]*\]\.includes\(item\.theme\)\)\s*applyTheme\(item\.theme\)/);

  for (const key of ["taglineStudio", "themeStudio", "themeFocusStudio", "guideStudio"]) {
    assert.match(app, new RegExp(`\\b${key}:\\s*"`));
    assert.match(zh, new RegExp(`\\b${key}:\\s*"`));
  }
  assert.match(css, /body\[data-theme="studio"\]\s*\{/);
  assert.match(css, /body\[data-theme="studio"\]\.is-fullscreen\s+#viewport\s*\{[^}]*height:\s*100%[^}]*min-height:\s*0/);
});

test("PNG export crops to all ink with one tile of padding", () => {
  const html = read("public/index.html"), app = read("public/app.js"), ink = functionSource(app, "exportInkBounds"), region = functionSource(app, "exportRegion"), render = functionSource(app, "renderExportCanvas"), run = functionSource(app, "exportCanvasPng");
  assert.match(ink, /inkBox\(tileCanvas/);
  assert.doesNotMatch(ink, /visibleInkBounds/);
  assert.match(region, /Math\.floor\(ink\.x\) - TILE/);
  assert.match(region, /Math\.ceil\(ink\.x \+ ink\.w\) \+ TILE/);
  assert.match(region, /Math\.ceil\(ink\.y \+ ink\.h\) \+ TILE/);
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
  assert.match(html, /id="autoDelayRange"[^>]*min="0"[^>]*max="10"[^>]*step="0\.1"/);
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
  assert.match(launch, /if \(hasUnsettledToolbox\(\)\)/);
  assert.match(launch, /state\.statusKey !== "autoToolboxPending"/);
  assert.ok(launch.indexOf("hasUnsettledToolbox()") < launch.indexOf('requestAI("auto")'));
  assert.doesNotMatch(schedule, /textEditors|hasUnsettledToolbox/);
  assert.match(schedule, /setTimeout\(\(\) =>/);
  assert.doesNotMatch(createText, /clearTimeout\(state\.timer\)/);
  assert.match(createText, /if \(!state\.timer && state\.auto && state\.dirty && state\.autoEligible\) schedule\(\)/);
  assert.match(manual, /requestAI\(action\)/);
  assert.doesNotMatch(manual, /hasUnsettledToolbox|autoToolboxPending/);
  assert.match(app, /autoToolboxPending:/);
  assert.match(zh, /autoToolboxPending:/);
});

test("toolbar exposes a fixed clickable reasoning menu before the drawing tools", () => {
  const html = read("public/index.html"), app = read("public/app.js"), css = read("public/style.css"), zh = read("public/locales/zh.js");
  const auto = html.indexOf('id="autoControl"'), effort = html.indexOf('id="effortControl"'), grid = html.indexOf('id="gridToggle"'), font = html.indexOf('id="aiFont"'), pen = html.indexOf('data-mode="pen"');
  assert.ok(auto < effort && effort < grid && grid < font && font < pen);
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

test("text tool toggles a real MD+TeX preview and confirms the unchanged source", () => {
  const html = read("public/index.html"), app = read("public/app.js"), css = read("public/style.css"), zh = read("public/locales/zh.js");
  const textButton = html.match(/<button[^>]*data-mode="text"[\s\S]*?<\/button>/)?.[0] || "";
  assert.match(textButton, /class="[^\"]*icon-button[^\"]*"/);
  assert.match(textButton, /data-i18n-aria="text"/);
  for (const id of ["textEditorLayer", "textInputHint", "textHelpDialog", "textHelpClose", "textHelpDone"]) assert.match(html, new RegExp(`id="${id}"`));
  for (const name of ["createTextEditor", "confirmTextEditor", "cancelTextEditor", "toggleTextEditorMixedMode", "updateTextEditorMixedMode", "renderTextEditorPreview", "scheduleTextEditorPreview", "cancelTextEditorPreview", "mixedTextImage", "positionTextEditors", "keepTextEditorVisible", "clearTextEditors", "setCanvasMode", "openTextHelp", "closeTextHelp", "restoreTextEditorAfterHelp"]) assert.match(app, new RegExp(`function ${name}\\(`));
  assert.ok(html.indexOf('src="mixed-text.js"') < html.indexOf('src="app.js"'));
  assert.match(app, /textEditorStyleSheet\(\)/);
  assert.match(app, /textInputBlockedUntil/);
  assert.match(app, /nextTextEditorZ/);
  assert.match(app, /textTap/);
  assert.match(app, /\(event\.ctrlKey \|\| event\.metaKey\) && event\.key === "Enter"/);
  assert.match(app, /\? \{ typedInput \}/);
  assert.match(app, /if \(state\.auto\) schedule\(Math\.max\(1000, state\.autoDelayMs\)\)/);
  assert.match(app, /mixedMode:\s*false/);
  assert.match(app, /fontCss:\s*TEXT_EDITOR_FONT_CSS/);
  assert.match(app, /startFontCss:\s*editor\.fontCss/);
  assert.match(app, /mixedModeButton\.setAttribute\("aria-pressed", "false"\)/);
  assert.match(app, /helpButton\.setAttribute\("aria-haspopup", "dialog"\)/);
  assert.match(app, /header\.append\(title, helpButton, mixedModeButton, acceptButton, cancelButton\)/);
  assert.match(app, /openTextHelp\(editor, helpButton\)/);
  assert.match(app, /editor\.mixedMode\s*\?\s*await mixedTextImage/);
  assert.match(app, /preview\.className = "text-editor-preview"/);
  assert.match(app, /mixedModeButton\.setAttribute\("aria-controls", preview\.id\)/);
  assert.match(app, /state\.latestTypedInput = \{ text: text\.slice\(0, TEXT_INPUT_MAX_LENGTH\), box \}/);
  const confirm = functionSource(app, "confirmTextEditor"),
    cancel = functionSource(app, "cancelTextEditor"),
    setMode = functionSource(app, "setCanvasMode"),
    openHelp = functionSource(app, "openTextHelp"),
    restoreHelp = functionSource(app, "restoreTextEditorAfterHelp"),
    toggle = functionSource(app, "toggleTextEditorMixedMode"),
    update = functionSource(app, "updateTextEditorMixedMode"),
    preview = functionSource(app, "renderTextEditorPreview");
  assert.match(app, /TEXT_INPUT_GUARD_MS\s*=\s*500/);
  assert.match(confirm, /blockCanvasInput\(TEXT_INPUT_GUARD_MS\)/);
  assert.match(cancel, /blockCanvasInput\(TEXT_INPUT_GUARD_MS\)/);
  assert.match(confirm, /editor\.cancelled \|\| state\.textEditors\.get\(editor\.id\) !== editor/);
  assert.match(confirm, /const fontSize = editor\.fontCss \/ Math\.max\(0\.03, state\.scale\)/);
  assert.ok(confirm.indexOf('setCanvasMode("pen")') > confirm.indexOf("if (!text.trim())"));
  assert.ok(confirm.indexOf('setCanvasMode("pen")') < confirm.indexOf("await mixedTextImage"));
  assert.match(cancel, /setCanvasMode\("pen"\)/);
  assert.match(setMode, /state\.mode = mode/);
  assert.match(setMode, /classList\.toggle\("active", item === button\)/);
  assert.match(app, /button\.onclick = \(\) => setCanvasMode\(button\.dataset\.mode\)/);
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
  assert.match(css, /\.text-editor\s*\{[^}]*pointer-events:\s*auto;[^}]*border:\s*1px solid rgba\(17,24,39,\.92\);[^}]*background:\s*transparent/);
  assert.match(css, /\.text-editor-header\s*\{[^}]*background:\s*transparent/);
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
  for (const key of ["text", "textMixedMode", "textMixedModeShort", "textEditMode", "textPreview", "textMixedModeError", "textConfirm", "textCancel", "textPlaceholder", "textConfirmHint", "textEmpty", "textHelp", "textHelpTitle", "textHelpClose", "textHelpIntro", "textHelpMarkdown", "textHelpMath", "textHelpConfirm", "textHelpExampleTitle", "textHelpExample", "textHelpDone"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
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

test("eraser strokes never enter the AI recognition batch", () => {
  const app = read("public/app.js");
  assert.match(app, /const shouldRequest = !d\.erase/);
  assert.match(app, /if \(shouldRequest\) \{\s*for \(const point of d\.trail\) state\.hotspotTrail\.push\(point\)/);
  assert.match(app, /if \(shouldRequest && state\.autoEligible\) schedule\(\)/);
  assert.match(app, /const erasing = state\.mode === "eraser";\s*if \(erasing\) invalidateRecognition\(\)/);
  assert.match(app, /erase: erasing/);
  assert.match(app, /dot\(p, erasing, size, !erasing\)/);
  assert.match(app, /stroke\(a, p, d\.erase, size, !d\.erase\)/);
});

test("an uncapturable batch is discarded before later pen strokes", () => {
  const app = read("public/app.js");
  assert.match(app, /function discardUncapturableInput\(hotspotCount, usedDirty\)/);
  assert.match(app, /if \(hotspotCount\) state\.hotspotTrail\.splice\(0, hotspotCount\);\s*state\.dirty = null;\s*state\.autoEligible = false/);
  assert.match(app, /if \(!packed\) \{\s*discardUncapturableInput\(hotspotCount, Boolean\(dirtySnapshot\)\)/);
});

test("AI capture stays inside the current viewport when retained dirty ink is off-screen", () => {
  const app = read("public/app.js"), capture = functionSource(app, "captureRectFor"), build = functionSource(app, "buildViewportImage"), request = functionSource(app, "requestAI");
  assert.match(capture, /return visible/);
  assert.doesNotMatch(capture, /Math\.max\(3200|Math\.max\(2200/);
  assert.match(build, /const latestVisible = intersection\(latestBox, sourceRect\)/);
  assert.match(build, /changedBox: latestVisible/);
  assert.doesNotMatch(build, /containsRect\(sourceRect, latestBox\)/);
  assert.match(request, /const requestBox = packed\.changedBox/);
  assert.match(request, /rawCommands = Array\.isArray\(data\.commands\)[\s\S]*?normalizeCommandPlacements\(validate\(rawCommands, aiColor\), packed, requestBox\)/);
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
  assert.match(functionSource(app, "invokeAIAction"), /requestAI\(action\)/);
});

test("manual actions and pen-down use non-blocking latest-request-wins cancellation", () => {
  const app = read("public/app.js"),
    manual = functionSource(app, "invokeAIAction"),
    supersede = functionSource(app, "supersedeActiveAI"),
    request = functionSource(app, "requestAI"),
    guard = functionSource(app, "checkAI");
  assert.ok(manual.indexOf('supersedeActiveAI("manual-action")') < manual.indexOf("requestAI(action)"));
  assert.match(app, /if \(!valid\(p\)\)[\s\S]*?return;\s*}\s*supersedeActiveAI\("user-input-started"\);\s*clearTimeout\(state\.timer\)/);
  assert.match(supersede, /active\.superseded = true;[\s\S]*?active\.controller\.abort\(\)/);
  assert.doesNotMatch(supersede, /discardPendingForNewAI\(\)/);
  assert.match(app, /appendPendingItems\(state\.pending, items, revision, meta, resolve\)/);
  assert.doesNotMatch(request, /if\s*\(state\.busy\)/);
  assert.match(guard, /run\.superseded \|\| state\.activeAI !== run/);
  assert.match(request, /animate\(commands\[0\], revision, meta, run\)/);
  assert.match(request, /preparePendingItem\(c, revision, meta, run\)/);
});

test("AI draft bodies move directly without plus handles", () => {
  const app = read("public/app.js"),
    draw = functionSource(app, "drawPending"),
    drawBatch = functionSource(app, "drawPendingBatch"),
    hit = functionSource(app, "pendingHit"),
    begin = functionSource(app, "beginPendingGesture"),
    pendingHit = vm.runInNewContext(`(${hit})`, {
      clientPoint: (event) => event,
      draftBounds: (pending) => pending.box,
      pendingItemBounds: (item) => item.box,
      draftActionPoints: () => ({}),
      pendingCopyable: () => false,
      state: { scale: 1 },
    }),
    grouped = {
      box: { x: 100, y: 100, w: 250, h: 200 },
      selectedIndex: 1,
      items: [
        { box: { x: 100, y: 100, w: 60, h: 50 } },
        { box: { x: 250, y: 200, w: 100, h: 100 } },
      ],
    };

  assert.doesNotMatch(draw, /drawMoveHandle\(/);
  assert.doesNotMatch(drawBatch, /drawMoveHandle\(|drawBatchMoveHandle\(/);
  assert.doesNotMatch(hit, /move-handle|batchMovePoint/);
  assert.match(hit, /frameOuter/);
  assert.match(hit, /frameInner/);
  assert.match(hit, /return \{ hit: "move", itemIndex: index \}/);
  assert.match(begin, /armed:\s*true/);
  assert.doesNotMatch(begin, /setTimeout\(/);
  assert.doesNotMatch(app, /e\.pointerType === "pen" && hit === "move"/);
  assert.deepEqual({ ...pendingHit(grouped, { x: 120, y: 120, pointerType: "mouse" }) }, { hit: "move", itemIndex: 0 });
  assert.deepEqual({ ...pendingHit(grouped, { x: 105, y: 120, pointerType: "mouse" }) }, { hit: "move", itemIndex: 0 });
  assert.deepEqual({ ...pendingHit(grouped, { x: 100, y: 120, pointerType: "mouse" }) }, { hit: "batch-move", itemIndex: null });
  assert.deepEqual({ ...pendingHit(grouped, { x: 200, y: 175, pointerType: "mouse" }) }, { hit: "batch-move", itemIndex: null });
  assert.deepEqual({ ...pendingHit(grouped, { x: 350, y: 300 }) }, { hit: "batch-resize", itemIndex: null });
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
  assert.match(draw, /drawDraftActions\(ctx, b, s, pendingCopyable\(p\), true\)/);
  assert.match(draw, /b\.x \+ b\.w \+ s \* 0\.08/);
  assert.match(draw, /b\.y \+ b\.h \+ s \* 0\.08/);
  assert.match(drawBatch, /if \(item\.textCommand\) drawTextDraftSurface\(ctx, box, index === p\.selectedIndex\)/);
  assert.match(drawBatch, /drawDraftActions\(ctx, box, s, pendingCopyable\(item\)\)/);
  assert.match(hit, /draftActionPoints\(box, s, pendingCopyable\(item\)\)/);
  assert.match(hit, /\.sort\(\(a, b\) => a\.distance - b\.distance \|\| b\.z - a\.z\)/);
  assert.match(start, /copyText = copyTextForCommand\(command\)/);
  assert.match(prepare, /copyText: copyTextForCommand\(c\)/);
  assert.match(update, /p\.scaleX = p\.scaleY = next/);
  assert.match(update, /g\.hit === "width"[\s\S]*?p\.scaleX = Math\.max/);
  assert.match(update, /g\.hit === "height"[\s\S]*?p\.scaleY = Math\.max/);
  assert.match(app, /hit === "copy" \|\| hit === "item-copy"/);
  assert.match(css, /\.clipboard-copy-fallback\s*\{[^}]*left:\s*-10000px/);
  for (const key of ["copyText", "textCopied", "textCopyFailed"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
});

test("canvas copy gestures arm on pointerdown and run once on a matching pointerup", () => {
  const app = read("public/app.js"),
    pointerDownStart = app.indexOf('screen.addEventListener("pointerdown"'),
    pointerDownEnd = app.indexOf('screen.addEventListener("pointermove"', pointerDownStart),
    pointerDown = app.slice(pointerDownStart, pointerDownEnd),
    end = functionSource(app, "end"),
    armSource = functionSource(app, "armPendingCopy"),
    matchesSource = functionSource(app, "pendingCopyMatches"),
    finishSource = functionSource(app, "finishPendingCopy");

  assert.match(pointerDown, /armPendingCopy\(e, hit, itemIndex\)/);
  assert.doesNotMatch(pointerDown, /copyPendingText\(itemIndex\)/);
  assert.match(end, /finishPendingCopy\(e\)/);

  function harness() {
    const pending = { copyText: "copy me" },
      state = { pending, pendingGesture: null },
      copied = [],
      context = {
        state,
        clientPoint: (event) => ({ x: event.clientX, y: event.clientY }),
        pendingHit: (_pending, event) => event.releaseHit ?? null,
        copyPendingText: (itemIndex) => {
          copied.push(itemIndex);
          return Promise.resolve(true);
        },
        render: () => {},
        requestRender: () => {},
        setCanvasCursor: () => {},
      };
    context.pendingCopyMatches = vm.runInNewContext(`(${matchesSource})`, context);
    return {
      arm: vm.runInNewContext(`(${armSource})`, context),
      copied,
      finish: vm.runInNewContext(`(${finishSource})`, context),
      pending,
      state,
    };
  }

  const matching = harness();
  matching.arm({ pointerId: 7, clientX: 10, clientY: 20 }, "copy", null);
  assert.deepEqual(matching.copied, []);
  matching.finish({ pointerId: 7, type: "pointerup", clientX: 10, clientY: 20, releaseHit: "copy" });
  matching.finish({ pointerId: 7, type: "pointerup", clientX: 10, clientY: 20, releaseHit: "copy" });
  assert.deepEqual(matching.copied, [null]);

  const cancelled = harness();
  cancelled.arm({ pointerId: 8, clientX: 10, clientY: 20 }, "copy", null);
  cancelled.finish({ pointerId: 8, type: "pointercancel", clientX: 10, clientY: 20, releaseHit: "copy" });
  assert.deepEqual(cancelled.copied, []);

  const outside = harness();
  outside.arm({ pointerId: 9, clientX: 10, clientY: 20 }, "copy", null);
  outside.finish({ pointerId: 9, type: "pointerup", clientX: 200, clientY: 220, releaseHit: null });
  assert.deepEqual(outside.copied, []);

  const replaced = harness();
  replaced.arm({ pointerId: 10, clientX: 10, clientY: 20 }, "copy", null);
  replaced.state.pending = { copyText: "replacement" };
  replaced.finish({ pointerId: 10, type: "pointerup", clientX: 10, clientY: 20, releaseHit: "copy" });
  assert.deepEqual(replaced.copied, []);
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

test("batch drafts paint every body before controls and keep selected controls on top", () => {
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
      drawDraftActions: (_ctx, box) => events.push(`actions:${box.id}`),
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
  const firstAction = Math.min(events.indexOf("actions:0"), events.indexOf("actions:1")),
    lastBody = Math.max(events.indexOf("body:0"), events.indexOf("body:1"));
  assert.ok(firstAction > lastBody);
  assert.ok(events.indexOf("actions:1") < events.indexOf("actions:0"));
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
