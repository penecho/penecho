"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("feature tour exposes an accessible dialog and replay entry point", () => {
  const html = read("public/index.html"),
    layer = html.match(/<div id="tourLayer"[\s\S]*?<\/section>\s*<\/div>/)?.[0] || "";
  assert.match(html, /id="tourReplayBtn"[^>]*data-i18n-aria="tourReplay"[^>]*data-i18n-title="tourReplay"/);
  assert.match(layer, /class="tour-layer"[^>]*hidden[^>]*aria-hidden="true"/);
  assert.match(layer, /id="tourHighlight"[^>]*aria-hidden="true"/);
  assert.match(layer, /id="tourCard"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="tourTitle"[^>]*aria-describedby="tourBody"/);
  for (const id of ["tourProgress", "tourProgressTrack", "tourTitle", "tourBody", "tourBack", "tourNext", "tourSkip"]) assert.match(layer, new RegExp(`id="${id}"`));
  assert.ok(html.indexOf('src="tour.js"') < html.indexOf('src="app.js"'));
});

test("feature tour follows the requested ten-step order with stable targets", () => {
  const app = read("public/app.js"),
    ordered = [
      "core-effort-v1",
      "plugins-v2",
      "studio-theme-v1",
      "core-lasso-v1",
      "core-text-v1",
      "core-fullscreen-v1",
      "core-files-v1",
      "core-manual-ai-v1",
      "core-status-v1",
      "core-navigation-v1",
    ];
  for (let index = 1; index < ordered.length; index++) assert.ok(app.indexOf(ordered[index - 1]) < app.indexOf(ordered[index]));
  for (const selector of ["#aiEffortButton", "#pluginButton", "#theme", "#lassoToolBtn", "#textToolBtn", "#fullscreenBtn", "#canvasFileActions", "#aiOrb", "#aiStatusArea", "#viewport"])
    assert.match(app, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
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
  assert.match(app, /function startFeatureTour\([\s\S]*?hideAutoDelayControl\(\);[\s\S]*?hideEffortControl\(\);[\s\S]*?hidePluginControl\(\);[\s\S]*?closeRadialMenu\(\);/);
  assert.match(app, /requestAnimationFrame\(\(\) => requestAnimationFrame\(maybeStartOnboarding\)\)/);
  assert.match(css, /\.tour-layer\s*\{[^}]*position:\s*fixed;[^}]*z-index:\s*80;[^}]*inset:\s*0/);
  assert.match(css, /\.tour-layer\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(app, /--tour-viewport-width/);
  assert.match(app, /--tour-viewport-height/);
  assert.match(css, /\.tour-layer\s*\{[^}]*touch-action:\s*pan-y pinch-zoom;[^}]*overscroll-behavior:\s*contain/);
  assert.match(css, /body\.tour-open\s*\{[^}]*overflow:\s*hidden/);
  assert.match(css, /\.tour-card\s*\{[^}]*width:\s*min\(400px, calc\(var\(--tour-viewport-width, 100vw\) - 24px\)\)/);
  assert.match(css, /\.tour-card-scroll\s*\{[^}]*max-height:\s*calc\(var\(--tour-viewport-height, 100dvh\) - 26px\)[^}]*overflow:\s*auto;[^}]*touch-action:\s*pan-y pinch-zoom/);
  assert.match(css, /\.tour-highlight\s*\{[^}]*pointer-events:\s*none/);
  assert.match(css, /@media \(max-width:\s*620px\)[\s\S]*?\.tour-card\s*\{[^}]*width:\s*calc\(var\(--tour-viewport-width, 100vw\) - 16px\)/);
  assert.match(css, /body\[data-theme="research"\] \.tour-actions \.tour-primary[^}]*color:\s*#fff8e9/);
  assert.match(css, /\.tour-card\.tour-compact \.tour-card-header\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(css, /\.tour-card\.tour-compact \.tour-actions\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.match(app, /TOUR\.resolveInitialLanguage\(storedPrimaryLanguage, storedLegacyLanguage\)/);
  assert.doesNotMatch(app, /resolveInitialLanguage\([^)]*navigator/);
});

test("0.7.1 changelog is a one-page dialog shown once after the feature tour", () => {
  const html = read("public/index.html"),
    app = read("public/app.js"),
    css = read("public/style.css"),
    zh = read("public/locales/zh.js"),
    layer = html.match(/<div id="changelogLayer"[\s\S]*?<script src="\/api\/config\.js">/)?.[0] || "";
  assert.match(layer, /class="changelog-layer"[^>]*hidden[^>]*aria-hidden="true"/);
  assert.match(layer, /id="changelogDialog"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="changelogTitle"[^>]*aria-describedby="changelogIntro"/);
  for (const id of ["changelogClose", "changelogTitle", "changelogIntro", "changelogCurrentVersion", "changelogEarlierTitle", "changelogDone"]) assert.match(layer, new RegExp(`id="${id}"`));
  assert.match(layer, />0\.7\.1</);
  assert.match(app, /CHANGELOG_STORAGE_KEY = "penecho-changelog-seen"/);
  assert.match(app, /CHANGELOG_VERSION = "0\.7\.1"/);
  assert.match(app, /localStorage\.getItem\(CHANGELOG_STORAGE_KEY\) === CHANGELOG_VERSION/);
  assert.match(app, /localStorage\.setItem\(CHANGELOG_STORAGE_KEY, CHANGELOG_VERSION\)/);
  assert.match(app, /function maybeStartOnboarding\(\)\s*\{\s*if \(!maybeStartFeatureTour\(\)\) maybeShowChangelog\(\);/);
  assert.match(app, /function closeFeatureTour[\s\S]*?maybeShowChangelog\(\)/);
  assert.match(app, /changelogLayer\.addEventListener\("keydown", handleChangelogKeydown\)/);
  assert.match(css, /\.changelog-layer\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;[^}]*place-items:\s*center/);
  assert.match(css, /\.changelog-dialog\s*\{[^}]*width:\s*min\(620px,[^}]*max-height:/);
  for (const key of ["changelogDialog", "changelogBadge", "changelogTitle", "changelogIntro", "changelogImages", "changelogImageEdit", "changelogImageAi", "changelogEarlierTitle", "changelogPluginsSummary", "changelogAnimation", "changelogFoundation", "changelogDone"]) {
    assert.match(app, new RegExp(`${key}:`), `missing English ${key}`);
    assert.match(zh, new RegExp(`${key}:`), `missing Chinese ${key}`);
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
      "tourEffortTitle",
      "tourEffortBody",
      "tourPluginsTitle",
      "tourPluginsBody",
      "tourStudioThemeTitle",
      "tourStudioThemeBody",
      "tourLassoTitle",
      "tourLassoBody",
      "tourTextTitle",
      "tourTextBody",
      "tourImageTitle",
      "tourImageBody",
      "tourFullscreenTitle",
      "tourFullscreenBody",
      "tourFilesTitle",
      "tourFilesBody",
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
  assert.match(app, /tourPluginsBody:[\s\S]*Only checked plugins[\s\S]*Unchecked plugins/);
  assert.match(zh, /勾选的插件.*LLM 请求/);
  assert.match(zh, /未勾选的插件.*不会.*prompt/);
  assert.match(zh, /社区插件/);
  assert.doesNotMatch(app, /tourAnimationPlugin/);
  assert.doesNotMatch(zh, /控制动态图讲解/);
  assert.match(zh, /Studio 主题/);
  assert.match(zh, /不会参考画布其他部分/);
  assert.match(zh, /PNG/);
  assert.match(zh, /请求进度|正在观察/);
  assert.match(zh, /双指.*缩放/);
});
