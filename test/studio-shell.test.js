"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("the Studio shell layer loads last and ships with the package", () => {
  const html = read("public/index.html"), packageJson = JSON.parse(read("package.json"));
  const links = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((match) => match[1]);
  assert.equal(links.at(-1), "studio-shell.css");
  assert.match(html, /<script src="viewer\.js" defer><\/script>\s*<script src="studio-shell\.js" defer><\/script>/);
  assert.ok(packageJson.files.includes("public/studio-shell.css"));
  assert.ok(packageJson.files.includes("public/studio-shell.js"));
});

test("the Studio shell stays a presentation layer", () => {
  const css = read("public/studio-shell.css"), js = read("public/studio-shell.js");
  assert.doesNotMatch(css, /@import\b/);
  assert.doesNotMatch(css, /url\(\s*["']?https?:/);
  // It forwards to existing controls and never calls Canvas runtime APIs.
  assert.doesNotMatch(js, /\bfetch\(|localStorage|indexedDB|PenEchoStudioNavigator|state\./);
  assert.match(js, /target\.click\(\)/);
});

test("every shell forwarder targets an existing control", () => {
  const html = read("public/index.html");
  const forwards = [...html.matchAll(/data-shell-forward="([^"]+)"/g)].flatMap((match) => match[1].split(","));
  assert.ok(forwards.length >= 4);
  for (const selector of forwards) {
    const id = selector.trim().replace(/^#/, "");
    assert.match(html, new RegExp(`id="${id}"`), `${selector} must exist`);
  }
});

test("dock and bottom-right AI popovers open upward", () => {
  const css = read("public/studio-shell.css");
  assert.match(css, /:is\(#eraserToolMenu, #inkColorPopover, #aiColorPopover\)\.toolbar-anchored-popover\s*\{[^}]*top:\s*auto !important;[^}]*bottom:/);
  assert.match(css, /:is\(#autoDelayPopover, #effortPopover\)\.toolbar-anchored-popover\s*\{[^}]*top:\s*auto !important;[^}]*bottom: calc\(var\(--pe-shell-corner-bottom\)/);
});

test("view and AI clusters sit in the bottom corners, level with the dock", () => {
  const css = read("public/studio-shell.css"), app = read("public/app.js");
  const js = read("public/studio-shell.js");
  assert.match(js, /measure\(document\.querySelector\("#viewport"\)\)/);
  for (const mode of ["horizontal", "vertical", "rows"]) assert.ok(js.includes(`"${mode}"`));
  assert.match(js, /viewWidth \+ toolsWidth \+ aiWidth \+ gap \* 2 > available\.width/);
  assert.match(css, /--pe-shell-ai-x/);
  assert.match(css, /--pe-shell-tools-x/);
  assert.match(css, /--pe-shell-view-x/);
  assert.match(app, /Click the bottom-left lock to unlock/);
});

test("maximized Widgets use an opaque page and header", () => {
  const css = read("public/studio-shell.css");
  assert.match(css, /#viewport \.canvas-widget\.widget-maximized \{[^}]*backdrop-filter: none;/);
  assert.match(css, /:is\(\.widget-maximized, \.canvas-image-presentation\) > \.widget-presentation-toolbar \{[^}]*background: var\(--studio-panel[^}]*backdrop-filter: none;/);
});

test("floating chrome follows the existing navigator and Agent state classes", () => {
  const css = read("public/studio-shell.css"), js = read("public/studio-shell.js");
  assert.match(css, /\.studio-agent-docked\.canvas-agent-open:not\(\.canvas-agent-navigation-hidden\)\s+\.shell-geometry\s*\{[^}]*--pe-shell-right:/);
  assert.ok(js.includes('/^canvas-agent-width-\\d+$/'), "Agent width comes from the retained frame class");
  assert.match(js, /target\.style\.setProperty\("--pe-shell-agent-width",agentWidth\)/);
  assert.match(css, /main > footer:not\(\.penecho-desktop-update-visible\)/);
});

test("the title bar More menu forwards to the original Canvas buttons", () => {
  const html = read("public/index.html"), js = read("public/studio-shell.js");
  assert.match(html, /<button id="canvasMoreBtn"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"[^>]*aria-controls="canvasMoreMenu"/);
  const menu = html.match(/<div id="canvasMoreMenu"[^>]*role="menu"[^>]*hidden>([\s\S]*?)<\/div>/);
  assert.ok(menu, "More menu starts hidden");
  const targets = [...menu[1].matchAll(/role="menuitem"[^>]*data-shell-forward="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(targets, ["#newCanvasBtn", "#historyBtn", "#exportPngBtn", "#echoCanvasBtn", "#clipboardCopyBtn", "#fullscreenBtn"]);
  for (const id of ["newCanvasBtn", "historyBtn", "exportPngBtn", "echoCanvasBtn"]) assert.match(html, new RegExp(`<button id="${id}"`));
  // Menu items mirror hidden/disabled state of their targets and support keyboard navigation.
  assert.match(js, /item\.hidden = !target \|\| target\.hidden;/);
  assert.match(js, /item\.disabled = Boolean\(target\?\.disabled\);/);
  assert.match(js, /event\.key === "Escape"/);
});

test("zoom buttons reuse the wheel zoom path and show the live scale", () => {
  const html = read("public/index.html"), runtime = read("src/client/app/canvas-runtime.js"), navigation = read("src/client/app/canvas-navigation.js");
  for (const id of ["canvasZoomOut", "canvasZoomLevel", "canvasZoomIn"]) assert.match(html, new RegExp(`<button id="${id}"[^>]*data-i18n-aria="`));
  assert.match(runtime, /function zoomCanvasBy\(factor\) \{[\s\S]*?zoomCanvasAt\(x, y, delta\)/);
  assert.match(runtime, /Math\.round\(state\.scale \* 100\)\}%/);
  assert.match(navigation, /#canvasZoomOut'\)\?\.addEventListener\('click', \(\) => zoomCanvasBy\(1 \/ 1\.25\)\)/);
  assert.match(navigation, /#canvasZoomIn'\)\?\.addEventListener\('click', \(\) => zoomCanvasBy\(1\.25\)\)/);
  assert.match(navigation, /#canvasZoomLevel'\)\?\.addEventListener\('click', \(\) => zoomCanvasBy\(1 \/ state\.scale\)\)/);
});

test("Cloud account lives in Settings and Favorites lives in the Library", () => {
  const html = read("public/index.html"), cloud = read("public/cloud-connect.js"), app = read("public/app.js");
  assert.match(html, /id="settingsNavCloud"[^>]*data-settings-page-target="cloud"[^>]*aria-controls="settingsPageCloud"/);
  assert.match(html, /<section id="settingsPageCloud"[^>]*data-settings-page="cloud" hidden>\s*<div id="settingsCloudHost" class="settings-cloud-host"><\/div>/);
  assert.match(app, /addEventListener\("penecho:show-settings"/);
  assert.match(app, /new CustomEvent\("penecho:settings-page"/);
  assert.match(cloud, /settingsCloudHost\.replaceChildren\(accountPanel\(renderCloudSettings, setRefreshing\), devicePanel\(renderCloudSettings\)\)/);
  // Device polling stops when another Settings page is selected.
  assert.match(cloud, /else stopDeviceConnectionWatch\(\);/);
  assert.match(html, /id="historyFavoritesNav"[^>]*aria-controls="historyFavoritesView"/);
  assert.match(html, /<section id="historyFavoritesView" class="history-favorites-view"[^>]*hidden><\/section>/);
  assert.match(cloud, /craftsButton\?\.addEventListener\("click", openFavorites\)/);
  const css = read("public/studio-shell.css");
  assert.match(css, /#historyPanel\[data-library-view="favorites"\] \.history-library-main > :not\(#historyFavoritesView\) \{ display: none !important; \}/);
});

test("Share shows ordered checklist steps", () => {
  const cloud = read("public/cloud-connect.js");
  const keys = [...cloud.matchAll(/shareStep\("([a-z]+)"/g)].map((match) => match[1]);
  assert.deepEqual(keys, ["content", "account", "cloud", "link"]);
  assert.match(cloud, /el\("ol", \{class:"live-share-steps"/);
  assert.match(cloud, /"current"/);
});

test("the attached object toolbar shows a drag grip on its empty surface", () => {
  const css = read("public/studio-shell.css"), runtime = read("src/client/app/canvas-runtime.js");
  assert.match(css, /\.object-chrome-button\.object-toolbar-surface\)::before \{[^}]*radial-gradient\([^}]*pointer-events: none;/);
  assert.match(runtime, /button\.classList\.toggle\("has-decisions", Boolean\(spec\.objectToolbar && spec\.toolbarHasDecisions !== false\)\)/);
});
