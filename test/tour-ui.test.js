"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const functionSource = (source, name) => {
  const start = source.indexOf(`function ${name}(`), body = source.indexOf("{", start);
  assert.notEqual(start, -1, `missing function ${name}`);
  let depth = 0;
  for (let index = body; index < source.length; index++) {
    if (source[index] === "{") depth++;
    else if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`unterminated function ${name}`);
};

test("feature tour exposes an accessible dialog and replay entry point", () => {
  const html = read("public/index.html"),
    layer = html.match(/<div id="tourLayer"[\s\S]*?<\/section>\s*<\/div>/)?.[0] || "";
  assert.doesNotMatch(html, /id="tourReplayBtn"/);
  assert.match(html, /id="settingsTourBtn"[^>]*data-i18n="tourReplay"/);
  assert.match(layer, /class="tour-layer"[^>]*hidden[^>]*aria-hidden="true"/);
  assert.match(layer, /id="tourHighlight"[^>]*aria-hidden="true"/);
  assert.match(layer, /id="tourCard"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="tourTitle"[^>]*aria-describedby="tourBody"/);
  for (const id of ["tourProgress", "tourProgressTrack", "tourTitle", "tourBody", "tourBack", "tourNext", "tourSkip"]) assert.match(layer, new RegExp(`id="${id}"`));
  assert.ok(html.indexOf('src="tour.js"') < html.indexOf('src="app.js"'));
});

test("custom dialog layers release focus before hiding from accessibility APIs", () => {
  const app = read("public/app.js"), calls = [], document = { body:{} };
  let active = {
    blur() {
      calls.push("blur");
      document.activeElement = document.body;
    },
  };
  const hiddenTarget = {
      isConnected:true,
      closest() { return { hidden:true }; },
      focus() { calls.push("hidden-focus"); },
    },
    visibleTarget = {
      isConnected:true,
      closest() { return null; },
      focus() {
        calls.push("focus");
        document.activeElement = visibleTarget;
      },
    },
    layer = {
      contains(value) { return value === active; },
      set hidden(value) { calls.push(`hidden:${value}`); },
      setAttribute(name, value) { calls.push(`${name}:${value}`); },
    },
    hideLayer = vm.runInNewContext(`(()=>{${functionSource(app, "focusTargetAvailableOutsideLayer")}\n${functionSource(app, "hideLayerWithoutRetainedFocus")}\nreturn hideLayerWithoutRetainedFocus;})()`, { document });

  document.activeElement = active;
  hideLayer(layer, hiddenTarget, visibleTarget);
  assert.deepEqual(calls, ["focus", "hidden:true", "aria-hidden:true"]);

  calls.length = 0;
  active = {
    blur() {
      calls.push("blur");
      document.activeElement = document.body;
    },
  };
  document.activeElement = active;
  hideLayer(layer);
  assert.deepEqual(calls, ["blur", "hidden:true", "aria-hidden:true"]);

  for (const [name, layerName] of [
    ["closeFeatureTour", "tourLayer"],
    ["closeChangelog", "changelogLayer"],
    ["closeConfiguration", "configurationLayer"],
    ["hidePluginControl", "pluginPopover"],
  ]) {
    const start = app.indexOf(`function ${name}(`),
      end = app.indexOf("\n  function ", start + 1),
      close = app.slice(start, end < 0 ? app.length : end);
    assert.notEqual(start, -1, `missing function ${name}`);
    assert.match(close, new RegExp(`hideLayerWithoutRetainedFocus\\(${layerName}`));
    assert.doesNotMatch(close, new RegExp(`${layerName}\\.hidden\\s*=\\s*true`));
    assert.doesNotMatch(close, new RegExp(`${layerName}\\.setAttribute\\(\\"aria-hidden\\",\\s*\\"true\\"\\)`));
  }
});

test("feature tour follows the requested concise order with stable targets", () => {
  const app = read("public/app.js"),
    ordered = [
      "core-effort-v1",
      "favorites-add-v1",
      "hand-v1",
      "core-lasso-v1",
      "core-text-v1",
      "core-image-v1",
      "core-fullscreen-v1",
      "cloud-share-canvas-v1",
      "cloud-workspace-v1",
      "canvas-agent-launcher-v2",
      "canvas-agent-panel-v2",
      "core-manual-ai-v1",
      "core-status-v1",
      "core-navigation-v1",
    ];
  for (let index = 1; index < ordered.length; index++) assert.ok(app.indexOf(ordered[index - 1]) < app.indexOf(ordered[index]));
  for (const selector of ["#aiEffortButton", "#craftsButton", "#handToolBtn", "#lassoToolBtn", "#textToolBtn", "#imagePickerBtn", "#fullscreenBtn", "#shareCanvasBtn", "#cloudAccountBtn", "#canvasAgentToggle", "#canvasAgentPanel", "#aiOrb", "#aiStatusArea", "#viewport"])
    assert.match(app, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(app, /canvas-agent-panel-v2[^\n]*preview: "canvas-agent-panel"/);
  assert.match(app, /openCanvasAgent\(\{ focus:false, connect:false, animate:false \}\)/);
  assert.match(app, /closeCanvasAgent\(\{ focus:false, animate:false \}\)/);
});

test("PenEcho Agent tour preview is connection-free and restores only tour-opened panels", () => {
  const app = read("public/app.js"), panel = { hidden:true }, featureTour = { canvasAgentOpenedForTour:false }, calls = [],
    sync = vm.runInNewContext(`(()=>{${functionSource(app, "syncFeatureTourPreview")}return syncFeatureTourPreview;})()`, {
      featureTour,
      canvasAgentPanel:panel,
      openCanvasAgent(options) { calls.push(["open", options]); panel.hidden = false; },
      closeCanvasAgent(options) { calls.push(["close", options]); panel.hidden = true; },
    });
  sync({ preview:"canvas-agent-panel" });
  assert.equal(JSON.stringify(calls), JSON.stringify([["open", { focus:false, connect:false, animate:false }]]));
  assert.equal(featureTour.canvasAgentOpenedForTour, true);
  sync(null);
  assert.equal(JSON.stringify(calls.at(-1)), JSON.stringify(["close", { focus:false, animate:false }]));
  assert.equal(featureTour.canvasAgentOpenedForTour, false);

  calls.length = 0;
  panel.hidden = false;
  sync({ preview:"canvas-agent-panel" });
  sync(null);
  assert.deepEqual(calls, [], "a panel that was already open must remain open");
  assert.equal(panel.hidden, false);
  assert.match(app, /if\(connect\)\{[\s\S]*?canvasAgentSyncState\(\);[\s\S]*?canvasAgentConnect\(\)[\s\S]*?\}else canvasAgentSyncSelection\(\)/);
});

test("feature tour persists seen ids, supports replay, and repositions accessibly", () => {
  const app = read("public/app.js"),
    css = read("public/style.css");
  assert.match(app, /FEATURE_TOUR_STORAGE_KEY = "penecho-tour-progress"/);
  assert.match(app, /TOUR\.unseenSteps\(FEATURE_TOUR_STEPS, progress\)/);
  assert.match(app, /startFeatureTour\(FEATURE_TOUR_STEPS, \{ replay: true, newOnly: false \}\)/);
  assert.match(app, /markFeatureTourStepsSeen\(availableFeatureTourSteps\(FEATURE_TOUR_STEPS\)\)/);
  assert.match(app, /if \(!featureTour\.shownIds\.has\(step\.id\)\)[\s\S]*?markFeatureTourStepsSeen\(\[step\]\)/);
  assert.match(app, /availableFeatureTourSteps\(pending\)/);
  assert.match(app, /new MutationObserver\(/);
  assert.match(app, /attributeFilter: \["hidden", "class", "style", "aria-hidden", "open"\]/);
  assert.match(app, /computed\.visibility !== "hidden"/);
  assert.match(app, /TOUR\.rectHasArea\(rect\)/);
  assert.match(app, /showFeatureTourStep\(featureTour\.index \+ 1, 1\)/);
  assert.match(app, /if \(featureTour\.active\) return;/);
  assert.match(app, /featureTour\.steps\[featureTour\.index\]\?\.id !== stepId/);
  assert.match(app, /tourMain\.inert = true/);
  assert.match(app, /tourMain\.inert = false/);
  assert.match(app, /addEventListener\("keydown", handleFeatureTourKeydown, true\)/);
  assert.match(app, /addEventListener\("scroll", scheduleFeatureTourPosition, true\)/);
  assert.match(app, /addEventListener\("resize", handleFeatureTourViewportChange\)/);
  assert.match(app, /window\.visualViewport\?\.addEventListener/);
  assert.match(app, /new ResizeObserver\(scheduleFeatureTourPosition\)/);
  assert.match(app, /function startFeatureTour\([\s\S]*?hideAutoDelayControl\(\);[\s\S]*?hideEffortControl\(\);[\s\S]*?hidePluginControl\(\);[\s\S]*?featureTour\.active = true/);
  assert.match(app, /loadCanvasSettings\(\)\.finally\(maybeStartOnboarding\)/);
  assert.match(css, /\.tour-layer\s*\{[^}]*position:\s*fixed;[^}]*z-index:\s*80;[^}]*inset:\s*0/);
  assert.match(css, /\.tour-layer\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(app, /--tour-viewport-width/);
  assert.match(app, /--tour-viewport-height/);
  assert.match(css, /\.tour-layer\s*\{[^}]*touch-action:\s*pan-y pinch-zoom;[^}]*overscroll-behavior:\s*contain/);
  assert.match(css, /body\.tour-open\s*\{[^}]*overflow:\s*hidden/);
  assert.match(css, /\.tour-card\s*\{[^}]*width:\s*min\(400px, calc\(var\(--tour-viewport-width, 100vw\) - 24px\)\)/);
  assert.match(css, /\.tour-card-scroll\s*\{[^}]*max-height:\s*calc\(var\(--tour-viewport-height, 100dvh\) - 26px\)[^}]*overflow:\s*auto;[^}]*touch-action:\s*pan-y pinch-zoom/);
  assert.match(css, /\.tour-highlight\s*\{[^}]*pointer-events:\s*none/);
  assert.match(css, /#tourTitle:focus\s*\{[^}]*outline:\s*none/);
  assert.match(css, /\.tour-actions button:not\(\.tour-primary\):hover:not\(:disabled\)/);
  assert.match(css, /\.tour-actions \.tour-primary\s*\{[^}]*color:\s*#fff;/);
  assert.match(css, /\.tour-actions \.tour-primary:hover\s*\{[^}]*color:\s*#fff;/);
  assert.match(css, /body\[data-theme="studio"\] \.tour-actions button:not\(\.tour-primary\):hover:not\(:disabled\)/);
  assert.match(css, /body\[data-theme="studio"\] \.tour-card\s*\{[^}]*border-color:\s*var\(--studio-accent-border\)[^}]*background:\s*var\(--studio-panel\)/);
  assert.match(css, /body\[data-theme="studio"\] \.tour-skip:hover\s*\{[^}]*color:\s*var\(--studio-text\)[^}]*background:\s*var\(--studio-accent-softer\)/);
  assert.doesNotMatch(css, /(?:^|\n)(?:body\[data-theme="studio"\] )?\.tour-actions button:hover:not\(:disabled\)/);
  assert.match(css, /@media \(max-width:\s*620px\)[\s\S]*?\.tour-card\s*\{[^}]*width:\s*calc\(var\(--tour-viewport-width, 100vw\) - 16px\)/);
  assert.match(css, /body\[data-theme="research"\] \.tour-actions \.tour-primary[^}]*color:\s*#fff8e9/);
  assert.match(css, /\.tour-card\.tour-compact \.tour-card-header\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(css, /\.tour-card\.tour-compact \.tour-actions\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.match(app, /TOUR\.resolveInitialLanguage\(storedPrimaryLanguage, storedLegacyLanguage\)/);
  assert.doesNotMatch(app, /resolveInitialLanguage\([^)]*navigator/);
});

test("1.3.0 release notes include Canvas Agent and MCP in both languages", () => {
  const html = read("public/index.html"),
    app = read("public/app.js"),
    css = read("public/style.css"),
    zh = read("public/locales/zh.js"),
    layer = html.match(/<div id="changelogLayer"[\s\S]*?<script src="remote-canvas\.js">/)?.[0] || "";
  assert.match(layer, /class="changelog-layer"[^>]*hidden[^>]*aria-hidden="true"/);
  assert.match(layer, /id="changelogDialog"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="changelogTitle"/);
  assert.doesNotMatch(layer, /aria-describedby=/);
  for (const id of ["changelogClose", "changelogTitle"]) assert.match(layer, new RegExp(`id="${id}"`));
  for (const id of ["changelogIntro", "changelogCurrentVersion", "changelogDone"]) assert.doesNotMatch(layer, new RegExp(`id="${id}"`));
  assert.match(layer, />1\.3\.0</);
  assert.doesNotMatch(layer, /class="changelog-release changelog-earlier"/);
  assert.match(layer, /<img src="penecho-architecture\.webp"[^>]*loading="lazy"/);
  assert.ok(read("public/penecho-architecture.webp").length > 0);
  assert.match(app, /CHANGELOG_STORAGE_KEY = "penecho-changelog-seen"/);
  assert.match(app, /CHANGELOG_VERSION = "1\.3\.0"/);
  assert.match(app, /localStorage\.getItem\(CHANGELOG_STORAGE_KEY\) === CHANGELOG_VERSION/);
  assert.match(app, /localStorage\.setItem\(CHANGELOG_STORAGE_KEY, CHANGELOG_VERSION\)/);
  assert.match(app, /function maybeStartOnboarding\(\)\s*\{\s*if \(window\.PENECHO_CONFIG\?\.runtime === "viewer" \|\| settings\.open\) return false;\s*if \(!maybeStartFeatureTour\(\)\) maybeShowChangelog\(\);/);
  assert.match(app, /function closeFeatureTour[\s\S]*?maybeShowChangelog\(\)/);
  assert.match(app, /changelogLayer\.addEventListener\("keydown", handleChangelogKeydown\)/);
  assert.match(css, /\.changelog-layer\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;[^}]*place-items:\s*center/);
  assert.match(css, /\.changelog-dialog\s*\{[^}]*width:\s*min\(900px,[^}]*max-height:/);
  for (const key of ["changelogDialog", "changelogBadge", "changelogTitle", "changelogCanvasAgent", "changelogMcpCanvases", "changelogCloudMcp", "changelogFrostedStudio", "changelogPerformance", "changelogKeyboardShortcuts"]) {
    assert.match(app, new RegExp(`${key}:`), `missing English ${key}`);
    assert.match(zh, new RegExp(`${key}:`), `missing Chinese ${key}`);
  }
  for (const key of ["changelogIntro", "changelogDone"]) {
    assert.doesNotMatch(app, new RegExp(`${key}:`));
    assert.doesNotMatch(zh, new RegExp(`${key}:`));
  }
  assert.equal((layer.match(/<li data-i18n="changelog/g) || []).length, 6);
  assert.match(layer, /changelogFrostedStudio[\s\S]*changelogPerformance[\s\S]*changelogKeyboardShortcuts/);
  assert.match(app, /changelogFrostedStudio:[^\n]*frosted Studio[^\n]*Translucent materials[^\n]*Canvas visible/);
  assert.match(app, /changelogPerformance:[^\n]*Drawing, erasing, panning, and zooming[^\n]*Low-latency live ink/);
  assert.match(app, /changelogKeyboardShortcuts:[^\n]*Customizable keyboard shortcuts[^\n]*undo and redo/);
  assert.match(zh, /changelogFrostedStudio:[^\n]*磨砂 Studio[^\n]*半透明材质[^\n]*画布始终清晰可见/);
  assert.match(zh, /changelogPerformance:[^\n]*书写、擦除、平移和缩放[^\n]*低延迟实时笔迹/);
  assert.match(zh, /changelogKeyboardShortcuts:[^\n]*自定义键盘快捷键[^\n]*撤销与重做/);
});

test("README version badges match the package version in every language", () => {
  const version = JSON.parse(read("package.json")).version;
  const readmePaths = [
    "README.md",
    ...fs.readdirSync(path.join(root, "docs/readme"))
      .filter((name) => /^README\.[^.]+(?:-[^.]+)?\.md$/.test(name))
      .map((name) => path.join("docs/readme", name)),
  ];
  for (const readmePath of readmePaths) {
    assert.ok(
      read(readmePath).includes(`/badge/version-${version}-`),
      `${readmePath} version badge must match package.json`,
    );
  }
});

test("feature tour copy is complete in English and Chinese", () => {
  const app = read("public/app.js"),
    zh = read("public/locales/zh.js"),
    keys = [
      "tourReplay",
      "tourBadge",
      "tourBadgeNew",
      "tourProgress",
      "tourStepCounter",
      "tourSkip",
      "tourBack",
      "tourNext",
      "tourDone",
      "tourCanvasAgentLauncherTitle",
      "tourCanvasAgentLauncherBody",
      "tourCanvasAgentPanelTitle",
      "tourCanvasAgentPanelBody",
      "tourEffortTitle",
      "tourEffortBody",
      "tourHandTitle",
      "tourHandBody",
      "tourLassoTitle",
      "tourLassoBody",
      "tourTextTitle",
      "tourTextBody",
      "tourImageTitle",
      "tourImageBody",
      "tourFullscreenTitle",
      "tourFullscreenBody",
      "tourFavoritesTitle",
      "tourFavoritesBody",
      "tourShareCanvasTitle",
      "tourShareCanvasBody",
      "tourCloudTitle",
      "tourCloudBody",
      "tourManualAITitle",
      "tourManualAIBody",
      "tourStatusTitle",
      "tourStatusBody",
      "tourCanvasTitle",
      "tourCanvasBody",
    ];
  for (const key of keys) {
    assert.match(app, new RegExp(`${key}:`), `missing English ${key}`);
    assert.match(zh, new RegExp(`${key}:`), `missing Chinese ${key}`);
  }
  assert.match(zh, /闭合套索/);
  assert.doesNotMatch(app, /tourPlugins(?:Title|Body):|plugins-v3/);
  assert.doesNotMatch(zh, /tourPlugins(?:Title|Body):/);
  assert.match(app, /tourHandBody:[^\n]*Hand moves the canvas[^\n]*Use Select[^\n]*widget interaction/);
  assert.match(zh, /小手可在大控件上直接移动画布.*使用选择工具整理对象/);
  assert.match(zh, /使用选择工具整理对象，或进入控件交互/);
  assert.doesNotMatch(app, /tourAnimationPlugin/);
  assert.doesNotMatch(zh, /控制动态图讲解/);
  assert.match(zh, /不会参考画布其他部分/);
  assert.match(app, /tourFavoritesBody:[^\n]*Echoes favorites[^\n]*favorite Widget[^\n]*favorite Canvas/);
  assert.match(zh, /tourFavoritesBody:[^\n]*Echoes[^\n]*收藏组件[^\n]*收藏画布/);
  assert.match(app, /tourShareCanvasBody:[^\n]*public in Echoes[^\n]*Use Cloud instead for private saves/);
  assert.match(zh, /tourShareCanvasBody:[^\n]*公开发布到 Echoes[^\n]*私密保存请使用 Cloud/);
  assert.match(app, /tourCloudBody:[^\n]*private versioned Canvases[^\n]*favorite Canvases or Widgets/);
  assert.match(zh, /tourCloudBody:[^\n]*私密画布[^\n]*收藏的画布或组件/);
  assert.match(zh, /请求进度|正在观察/);
  assert.match(zh, /双指.*缩放/);
  assert.match(zh, /tourCanvasAgentLauncherBody:[^\n]*工具栏最右侧[^\n]*多步骤/);
  assert.match(zh, /tourCanvasAgentPanelBody:[^\n]*右侧栏[^\n]*底部面板[^\n]*只读文件夹项目/);
});

test("feature tour follows the responsive Agent toolbar and panel locations", () => {
  const app = read("public/app.js"),
    zh = read("public/locales/zh.js");
  assert.match(app, /id: "canvas-agent-launcher-v2", targets: \["#canvasAgentToggle"\][^\n]*placement: "bottom"/);
  assert.match(app, /id: "canvas-agent-panel-v2", targets: \["#canvasAgentPanel"\][^\n]*placement: "left"[^\n]*preview: "canvas-agent-panel"/);
  assert.doesNotMatch(app, /canvas-agent-(?:launcher|panel)-v1/);
  assert.match(app, /function featureTourStepAvailable\(step\)[\s\S]*?panelRect = featureTourTargetRect\(step\)[\s\S]*?toggleRect = featureTourTargetRect\(\{ targets:\["#canvasAgentToggle"\] \}\)[\s\S]*?panelRect \|\| toggleRect/);
  assert.match(app, /tourCanvasAgentLauncherBody:[^\n]*right end of the toolbar[^\n]*lower right/);
  assert.match(app, /tourCanvasAgentPanelBody:[^\n]*right sidebar[^\n]*bottom panel/);
  assert.match(zh, /tourCanvasAgentLauncherBody:[^\n]*工具栏最右侧[^\n]*右下角/);
  assert.match(zh, /tourCanvasAgentPanelBody:[^\n]*右侧栏[^\n]*底部面板/);
});
