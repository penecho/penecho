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
  assert.doesNotMatch(html, /id="tourReplayBtn"/);
  assert.match(html, /id="settingsTourBtn"[^>]*data-i18n="tourReplay"/);
  assert.match(layer, /class="tour-layer"[^>]*hidden[^>]*aria-hidden="true"/);
  assert.match(layer, /id="tourHighlight"[^>]*aria-hidden="true"/);
  assert.match(layer, /id="tourCard"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="tourTitle"[^>]*aria-describedby="tourBody"/);
  for (const id of ["tourProgress", "tourProgressTrack", "tourTitle", "tourBody", "tourBack", "tourNext", "tourSkip"]) assert.match(layer, new RegExp(`id="${id}"`));
  assert.ok(html.indexOf('src="tour.js"') < html.indexOf('src="app.js"'));
});

test("feature tour follows the requested concise order with stable targets", () => {
  const app = read("public/app.js"),
    ordered = [
      "core-effort-v1",
      "plugins-v3",
      "hand-v1",
      "studio-theme-v1",
      "core-lasso-v1",
      "core-text-v1",
      "core-image-v1",
      "core-fullscreen-v1",
      "core-files-v1",
      "core-manual-ai-v1",
      "core-status-v1",
      "core-navigation-v1",
    ];
  for (let index = 1; index < ordered.length; index++) assert.ok(app.indexOf(ordered[index - 1]) < app.indexOf(ordered[index]));
  for (const selector of ["#aiEffortButton", "#pluginButton", "#handToolBtn", "#theme", "#lassoToolBtn", "#textToolBtn", "#imagePickerBtn", "#fullscreenBtn", "#canvasFileActions", "#aiOrb", "#aiStatusArea", "#viewport"])
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

test("1.0.0 changelog is a concise one-page dialog shown once after the feature tour", () => {
  const html = read("public/index.html"),
    app = read("public/app.js"),
    css = read("public/style.css"),
    zh = read("public/locales/zh.js"),
    layer = html.match(/<div id="changelogLayer"[\s\S]*?<script src="\/api\/config\.js">/)?.[0] || "";
  assert.match(layer, /class="changelog-layer"[^>]*hidden[^>]*aria-hidden="true"/);
  assert.match(layer, /id="changelogDialog"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="changelogTitle"/);
  assert.doesNotMatch(layer, /aria-describedby=/);
  for (const id of ["changelogClose", "changelogTitle"]) assert.match(layer, new RegExp(`id="${id}"`));
  for (const id of ["changelogIntro", "changelogCurrentVersion", "changelogDone"]) assert.doesNotMatch(layer, new RegExp(`id="${id}"`));
  assert.match(layer, />1\.0\.0</);
  assert.doesNotMatch(layer, /class="changelog-demo"|class="changelog-release changelog-earlier"/);
  assert.match(app, /CHANGELOG_STORAGE_KEY = "penecho-changelog-seen"/);
  assert.match(app, /CHANGELOG_VERSION = "1\.0\.0"/);
  assert.match(app, /localStorage\.getItem\(CHANGELOG_STORAGE_KEY\) === CHANGELOG_VERSION/);
  assert.match(app, /localStorage\.setItem\(CHANGELOG_STORAGE_KEY, CHANGELOG_VERSION\)/);
  assert.match(app, /function maybeStartOnboarding\(\)\s*\{\s*if \(window\.PENECHO_CONFIG\?\.runtime === "viewer"\) return false;\s*if \(!maybeStartFeatureTour\(\)\) maybeShowChangelog\(\);/);
  assert.match(app, /function closeFeatureTour[\s\S]*?maybeShowChangelog\(\)/);
  assert.match(app, /changelogLayer\.addEventListener\("keydown", handleChangelogKeydown\)/);
  assert.match(css, /\.changelog-layer\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;[^}]*place-items:\s*center/);
  assert.match(css, /\.changelog-dialog\s*\{[^}]*width:\s*min\(620px,[^}]*max-height:/);
  for (const key of ["changelogDialog", "changelogBadge", "changelogTitle", "changelogLocalCloud", "changelogEchoes"]) {
    assert.match(app, new RegExp(`${key}:`), `missing English ${key}`);
    assert.match(zh, new RegExp(`${key}:`), `missing Chinese ${key}`);
  }
  for (const key of ["changelogIntro", "changelogDone"]) {
    assert.doesNotMatch(app, new RegExp(`${key}:`));
    assert.doesNotMatch(zh, new RegExp(`${key}:`));
  }
  assert.equal((layer.match(/<li data-i18n="changelog/g) || []).length, 2);
  assert.match(app, /changelogLocalCloud:[^\n]*Open Cloud[^\n]*current Canvas/);
  assert.match(app, /changelogEchoes:[^\n]*Publish to Echoes[^\n]*as images/);
  assert.match(zh, /changelogLocalCloud:[^\n]*本地打开[^\n]*当前画布/);
  assert.match(zh, /changelogEchoes:[^\n]*发布到 Echoes[^\n]*分享为图片/);
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
      "tourHandTitle",
      "tourHandBody",
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
  assert.match(app, /tourPluginsBody:[\s\S]*Real Photos[\s\S]*Professional Diagrams[\s\S]*copyable source/);
  assert.match(zh, /显示网络真实照片.*一张/);
  assert.match(zh, /tourPluginsBody:[^\n]*专业图示[^\n]*源码/);
  assert.match(app, /tourHandBody:[^\n]*tap an image[^\n]*AI widget[^\n]*HTML widgets remain interactive/);
  assert.match(zh, /点击图片、动画、文本框或 AI 控件.*显示操作按钮/);
  assert.match(zh, /HTML 控件仍可直接交互/);
  assert.doesNotMatch(app, /tourAnimationPlugin/);
  assert.doesNotMatch(zh, /控制动态图讲解/);
  assert.match(zh, /Studio 主题/);
  assert.match(zh, /不会参考画布其他部分/);
  assert.match(zh, /PNG/);
  assert.match(zh, /请求进度|正在观察/);
  assert.match(zh, /双指.*缩放/);
});
