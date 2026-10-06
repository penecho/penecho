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
      "notes-cards-v1",
      "hand-v1",
      "core-text-v1",
      "smart-assist-v1",
      "core-lasso-v3",
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
  for (const selector of ["#aiEffortButton", "#craftsButton", "#historyBtn", "#handToolBtn", "#lassoToolBtn", "#textToolBtn", "#imagePickerBtn", "#fullscreenBtn", "#shareCanvasBtn", "#cloudAccountBtn", "#canvasAgentToggle", "#canvasAgentPanel", "#aiOrb", "#aiStatusArea", "#viewport"])
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

test("1.4.0 release notes summarize the major updates in both languages", () => {
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
  assert.match(layer, />1\.4\.0</);
  assert.doesNotMatch(layer, /class="changelog-release changelog-earlier"/);
  assert.doesNotMatch(layer, /changelog-demo|penecho-architecture/);
  assert.match(app, /CHANGELOG_STORAGE_KEY = "penecho-changelog-seen"/);
  assert.match(app, /CHANGELOG_VERSION = "1\.4\.0"/);
  assert.match(app, /localStorage\.getItem\(CHANGELOG_STORAGE_KEY\) === CHANGELOG_VERSION/);
  assert.match(app, /localStorage\.setItem\(CHANGELOG_STORAGE_KEY, CHANGELOG_VERSION\)/);
  assert.match(app, /function maybeStartOnboarding\(\)\s*\{\s*if \(window\.PENECHO_CONFIG\?\.runtime === "viewer" \|\| settings\.open\) return false;\s*if \(!maybeStartFeatureTour\(\)\) maybeShowChangelog\(\);/);
  assert.match(app, /function closeFeatureTour[\s\S]*?maybeShowChangelog\(\)/);
  assert.match(app, /changelogLayer\.addEventListener\("keydown", handleChangelogKeydown\)/);
  assert.match(css, /\.changelog-layer\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;[^}]*place-items:\s*center/);
  assert.match(css, /\.changelog-dialog\s*\{[^}]*width:\s*min\(900px,[^}]*max-height:/);
  for (const key of ["changelogDialog", "changelogBadge", "changelogTitle", "changelogAssist", "changelogLasso", "changelogNotesCards", "changelogWidgetRefine", "changelogCanvasPolish"]) {
    assert.match(app, new RegExp(`${key}:`), `missing English ${key}`);
    assert.match(zh, new RegExp(`${key}:`), `missing Chinese ${key}`);
  }
  for (const key of ["changelogIntro", "changelogDone"]) {
    assert.doesNotMatch(app, new RegExp(`${key}:`));
    assert.doesNotMatch(zh, new RegExp(`${key}:`));
  }
  assert.equal((layer.match(/<li data-i18n="changelog/g) || []).length, 5);
  assert.match(app, /changelogAssist:[^\n]*handwriting, text and images/);
  assert.match(app, /changelogLasso:[^\n]*selected content/);
  assert.match(app, /changelogNotesCards:[^\n]*reusable notes and knowledge cards/);
  assert.match(zh, /changelogAssist:[^\n]*手写、文字和图片/);
  assert.match(zh, /changelogLasso:[^\n]*选中的内容/);
  assert.match(zh, /changelogNotesCards:[^\n]*笔记与知识卡片/);
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
      read(readmePath).includes(`/badge/release-v${version}-`),
      `${readmePath} version badge must match package.json`,
    );
  }
});

test("returning users see only the 1.4.0 tour additions without losing earlier progress", () => {
  const tour = require("../public/tour.js"),
    core = read("src/client/app/core.js"),
    steps = vm.runInNewContext(core.match(/const FEATURE_TOUR_STEPS = (Object\.freeze\(\[[\s\S]*?\]\));/)[1]),
    oldIds = steps.map(step => step.id).filter(id => !["notes-cards-v1", "smart-assist-v1", "core-lasso-v3"].includes(id)),
    progress = tour.parseProgress(JSON.stringify({ seen:[...oldIds, "core-lasso-v2"] })),
    pending = tour.unseenSteps(steps, progress);
  assert.deepEqual(Array.from(pending, step => step.id), ["notes-cards-v1", "smart-assist-v1", "core-lasso-v3"]);
  const completed = tour.markSeen(progress, pending.map(step => step.id));
  assert.equal(tour.unseenSteps(steps, completed).length, 0);
  assert.ok(completed.seen.includes("core-lasso-v2"));
  assert.ok(oldIds.every(id => completed.seen.includes(id)));
});

test("Studio shows unseen onboarding and release notes while settings and viewers stay undisturbed", () => {
  const source = functionSource(read("src/client/app/core.js"), "maybeStartOnboarding"),
    calls = [], settings = { open:false }, window = { PENECHO_CONFIG:{ runtime:"device" } };
  let tourPending = true;
  const start = vm.runInNewContext(`(${source})`, {
    window, settings, state:{ theme:"studio" },
    maybeStartFeatureTour() { calls.push("tour"); return tourPending; },
    maybeShowChangelog() { calls.push("changelog"); },
  });
  start();
  assert.deepEqual(calls, ["tour"]);
  calls.length = 0;
  tourPending = false;
  start();
  assert.deepEqual(calls, ["tour", "changelog"]);
  calls.length = 0;
  settings.open = true;
  assert.equal(start(), false);
  settings.open = false;
  window.PENECHO_CONFIG.runtime = "viewer";
  assert.equal(start(), false);
  assert.deepEqual(calls, []);
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
      "tourAssistTitle",
      "tourAssistBody",
      "tourNotesCardsTitle",
      "tourNotesCardsBody",
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
  assert.match(app, /tourHandBody:[^\n]*Hand pans the canvas[^\n]*header to move[^\n]*handles to resize[^\n]*Double-click a widget to interact/);
  assert.match(zh, /tourHandBody:[^\n]*小手可在大控件上直接移动画布[^\n]*拖动顶部可移动对象[^\n]*拖动边缘手柄可调整大小[^\n]*双击控件进入内部交互/);
  assert.match(app, /tourLassoBody:[^\n]*AI receives only the selected content[^\n]*Drag or resize the selection to move or scale ink[^\n]*Widgets stay in place/);
  assert.match(zh, /tourLassoBody:[^\n]*AI 只接收选中的内容[^\n]*拖动或缩放选区可以移动或缩放笔迹[^\n]*Widget 保持原位/);
  assert.doesNotMatch(app, /tourAnimationPlugin/);
  assert.doesNotMatch(zh, /控制动态图讲解/);
  assert.match(app, /tourFavoritesBody:[^\n]*Echoes favorites[^\n]*favorite Widget[^\n]*favorite Canvas/);
  assert.match(zh, /tourFavoritesBody:[^\n]*Echoes[^\n]*收藏组件[^\n]*收藏画布/);
  assert.match(app, /tourShareCanvasBody:[^\n]*read-only link[^\n]*future saved changes[^\n]*separate Craft to Echoes/);
  assert.match(zh, /tourShareCanvasBody:[^\n]*只读链接[^\n]*之后保存的改动[^\n]*独立的 Echo 按钮[^\n]*Echoes/);
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
