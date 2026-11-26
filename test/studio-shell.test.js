"use strict";
require("./helpers/safety.js");

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("the Studio shell loads after the Canvas styles and before the opening film, and both ship", () => {
  const html = read("public/index.html"), packageJson = JSON.parse(read("package.json"));
  const links = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((match) => match[1]);
  assert.deepEqual(links.slice(-2), ["studio-shell.css", "lines/opening.css"]);
  assert.match(html, /<script src="viewer\.js" defer><\/script>\s*<script src="studio-shell\.js" defer><\/script>/);
  assert.ok(packageJson.files.includes("public/studio-shell.css"));
  assert.ok(packageJson.files.includes("public/studio-shell.js"));
  assert.ok(packageJson.files.includes("public/lines/"));
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

test("dock popovers open upward; the Canvas AI bar's open downward, within the bar", () => {
  const css = read("public/studio-shell.css"), core = read("src/client/app/core.js");
  assert.match(css, /:is\(#eraserToolMenu, #inkColorPopover\)\.toolbar-anchored-popover\s*\{[^}]*top:\s*auto !important;[^}]*bottom:/);
  assert.doesNotMatch(css, /#autoDelayPopover, #effortPopover\)\.toolbar-anchored-popover/, "Auto and effort popovers are placed by the runtime, under the bar");
  assert.doesNotMatch(css, /#aiColorPopover\)\.toolbar-anchored-popover/);
  assert.match(core, /control\.closest\("#aiToolsSection"\)/, "a bar popover ends at the bar's right edge, clear of a panel");
});

test("view controls sit bottom left, level with the dock; the Canvas AI bar sits top right, left of a line's panel", () => {
  const css = read("public/studio-shell.css"), app = read("public/app.js"), entry = read("public/project-lines-entry.css");
  const js = read("public/studio-shell.js"), html = read("public/index.html");
  assert.match(js, /measure\(document\.querySelector\("#viewport"\)\)/);
  for (const mode of ["horizontal", "vertical", "rows"]) assert.ok(js.includes(`"${mode}"`));
  assert.match(js, /viewWidth \+ toolsWidth \+ gap \* 2 > available\.width/);
  assert.doesNotMatch(js, /aiWidth/, "the bottom row no longer makes room for the AI controls");
  assert.match(css, /\.primary-tools > \.ai-tools-section \{[^}]*position: fixed;[^}]*top: calc\(var\(--pe-shell-bar-h\) \+ 12px\);[^}]*right: calc\(var\(--pe-shell-right\) \+ 12px\);[^}]*bottom: auto;/);
  assert.match(entry, /\.project-lines-panel-open \.primary-tools > \.ai-tools-section,[^{]*\{ right:calc\(var\(--project-lines-panel-width\) \+ 12px\); \}/);
  assert.match(html, /id="aiToolsSection"[\s\S]*?id="aiModelControl"[\s\S]*?id="aiModelButton"[\s\S]*?id="aiModelMenu"[\s\S]*?id="effortControl"/);
  assert.match(css, /--pe-shell-tools-x/);
  assert.match(css, /--pe-shell-view-x/);
  assert.match(app, /Click the bottom-left lock to unlock/);
});

test("maximized Widgets use an opaque page and header", () => {
  const css = read("public/studio-shell.css");
  assert.match(css, /#viewport \.canvas-widget\.widget-maximized \{[^}]*backdrop-filter: none;/);
  assert.match(css, /:is\(\.widget-maximized, \.canvas-image-presentation\) > \.widget-presentation-toolbar \{[^}]*background: var\(--studio-panel[^}]*backdrop-filter: none;/);
});

test("project Canvas actions distinguish open panels and Auto status from the selected ink", () => {
  const css = read("public/studio-shell.css");
  assert.match(css, /body\[data-theme="studio"\] \{[^}]*--canvas-tool-hover:[^}]*--canvas-tool-selected:/, "the topbar and its sibling AI toolbar both inherit the control colors");
  assert.match(css, /\.project-lines-canvas:not\(\.project-lines-draft\) \.topbar \.project-lines-link \{[^}]*background: transparent;/);
  assert.match(css, /:is\(\.project-lines-panel-button, #shareCanvasBtn:not\(\[data-collaborating="true"\]\)\)\[aria-expanded="true"\] \{[^}]*background: var\(--canvas-tool-selected\);/);
  assert.match(css, /#auto\)\.active::before \{[^}]*background: var\(--pe-success\);/);
  assert.match(css, /\.color-orb-trigger::before \{[^}]*background: var\(--selected-color,/);
  assert.match(css, /#aiToolsSection :is\(#aiToolbarRun, #aiModelButton, #aiEffortButton, #auto, \.color-orb-trigger\):focus-visible \{[^}]*outline: 2px solid/);
});

test("the filled Canvas AI action uses legible ink and surface colors in each Studio palette", () => {
  assert.match(read("public/studio-shell.css"), /#aiToolbarRun\.ai-section-label \{[^}]*color: var\(--studio-panel\);[^}]*background: var\(--studio-text\);/);
  const luminance = hex => hex.match(/../g).map(channel => parseInt(channel, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  const palettes = [...read("public/style.css").matchAll(/\[data-studio-palette="([^"]+)"\] \{([^}]*--studio-text:[^}]*)\}/g)];
  assert.ok(palettes.length > 0);
  for (const [, name, tokens] of palettes) {
    const levels = ["panel", "text"].map(token => luminance(tokens.match(new RegExp(`--studio-${token}: #([\\da-f]{6});`, "i"))[1]));
    assert.ok((Math.max(...levels) + .05) / (Math.min(...levels) + .05) >= 4.5, name);
  }
});

test("floating chrome follows the existing navigator and Agent state classes", () => {
  const css = read("public/studio-shell.css"), js = read("public/studio-shell.js");
  assert.match(css, /main > footer:not\(\.penecho-desktop-update-visible\)/);
});

test("the title bar More menu forwards to the original Canvas buttons", () => {
  const html = read("public/index.html"), js = read("public/studio-shell.js");
  assert.match(html, /<button id="canvasMoreBtn"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"[^>]*aria-controls="canvasMoreMenu"/);
  const menuStart = html.indexOf('<div id="canvasMoreMenu"'), menuEnd = html.indexOf('<button id="companionCanvasTarget"', menuStart),
    menuHtml = html.slice(menuStart, menuEnd);
  assert.match(menuHtml, /<div id="canvasMoreMenu"[^>]*role="menu"[^>]*hidden>/);
  const targets = [...menuHtml.matchAll(/role="menuitem"[^>]*data-shell-forward="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(targets, ["#fullscreenBtn", "#exportPngBtn"]);
  for (const id of ["newCanvasBtn", "historyBtn", "exportPngBtn", "collaborateCanvasBtn", "settingsBtn"]) assert.match(html, new RegExp(`<button id="${id}"`));
  for (const id of ["headerMcpPill", "canvasShareMenu", "shareDrawTogetherBtn", "shareViewLinkBtn", "moreNewCanvasBtn", "moreRenameCanvasBtn", "moreDownloadTrigger", "exportPdfBtn", "canvasMoreMcpSwitch", "canvasMoreSettingsBtn", "moreHelpTrigger", "moreDeleteCanvasBtn"]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.doesNotMatch(html, /id="echoCanvasBtn"|data-shell-forward="#echoCanvasBtn"/);
  // Menu items mirror hidden/disabled state of their targets (even when inside #canvasCommandProxies) and support nested keyboard navigation.
  assert.match(js, /#canvasCommandProxies/);
  assert.match(js, /item\.hidden = !target \|\| target\.hidden;/);
  assert.match(js, /item\.disabled = Boolean\(target\?\.disabled\);/);
  assert.match(js, /event\.key === "ArrowRight"/);
  assert.match(js, /event\.key === "ArrowLeft"/);
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

test("Cloud account lives in Settings, and the Library has no Favorites entry", () => {
  const html = read("public/index.html"), cloud = read("public/cloud-connect.js"), app = read("public/app.js");
  assert.match(html, /id="settingsNavCloud"[^>]*data-settings-page-target="cloud"[^>]*aria-controls="settingsPageCloud"/);
  assert.match(html, /<section id="settingsPageCloud"[^>]*data-settings-page="cloud" hidden>\s*<div id="settingsCloudHost" class="settings-cloud-host"><\/div>/);
  assert.match(app, /addEventListener\("penecho:show-settings"/);
  assert.match(app, /new CustomEvent\("penecho:settings-page"/);
  // The Cloud page of Settings is the account alone: the linked device is retired.
  assert.match(cloud, /settingsCloudHost\.replaceChildren\(accountPanel\(renderCloudSettings, setRefreshing\)\);/);
  assert.doesNotMatch(cloud, /devicePanel|stopDeviceConnectionWatch|startDeviceConnectionWatch/);
  assert.doesNotMatch(html, /id="historyFavoritesNav"|data-shell-forward="#historyBtn,#historyFavoritesNav"/);
  assert.match(html, /<section id="historyFavoritesView" class="history-favorites-view"[^>]*hidden><\/section>/);
  assert.match(cloud, /craftsButton\?\.addEventListener\("click", openFavorites\)/);
  const css = read("public/studio-shell.css");
  assert.match(css, /#historyPanel\[data-library-view="favorites"\] \.history-library-main > :not\(#historyFavoritesView\) \{ display: none !important; \}/);
});

test("Share shows ordered checklist steps", () => {
  const cloud = read("public/cloud-connect.js");
  const keys = [...cloud.matchAll(/shareStep\("([a-z]+)"/g)].map((match) => match[1]);
  // An empty Canvas can be shared, so content is not a step.
  assert.deepEqual(keys, ["account", "cloud", "link"]);
  assert.match(cloud, /el\("ol", \{class:"live-share-steps"/);
  assert.match(cloud, /"current"/);
});

test("the attached object toolbar shows a drag grip on its empty surface", () => {
  const css = read("public/studio-shell.css"), runtime = read("src/client/app/canvas-runtime.js");
  assert.match(css, /\.object-chrome-button\.object-toolbar-surface\)::before \{[^}]*radial-gradient\([^}]*pointer-events: none;/);
  assert.match(runtime, /button\.classList\.toggle\("has-decisions", Boolean\(spec\.objectToolbar && spec\.toolbarHasDecisions !== false\)\)/);
});

test("the side panel shows Collaborate, Share and its Canvases as tabs", () => {
  const css = read("public/studio-shell.css"), html = read("public/index.html"), app = read("public/app.js");
  const hidden = css.match(/:root\[data-penecho-companion="minimal"\] body \.topbar :is\(([^)]*)\) \{ display: none; \}/);
  assert.ok(hidden && !hidden[1].includes(".canvas-file-actions"), "the file actions stay in the side panel");
  assert.match(css, /:root\[data-penecho-companion="minimal"\] body \.topbar \.canvas-file-actions > :is\(#newCanvasBtn, #exportPngBtn, #historyBtn\) \{ display: none; \}/);
  assert.match(html, /<a id="companionBrandLink" class="companion-brand-link" href="\/" target="_blank" rel="noopener"/);
  assert.match(html, /<nav id="companionTabs" class="companion-tabs" aria-label="Canvases" hidden><\/nav>/);
  assert.match(app, /function renderCompanionTabs\(docs, current, disabled\)/);
  assert.match(app, /Tabs keep the order they were opened in/);
  assert.doesNotMatch(app, /companionProjectBridge/);
  assert.match(app, /A folder page saves into its folder's project \(a guest's, or a signed-out app's, stays with its page\)\.\n\s*if \(window\.PENECHO_CONFIG\?\.folderProject\?\.localProjectId\) return window\.PENECHO_CONFIG\.folderProject\.localProjectId;\n\s*const folderProject = window\.PENECHO_CONFIG\?\.folderProject\?\.cloudProjectId \|\| window\.PENECHO_CONFIG\?\.folderProject\?\.guestProjectId;/);
  // A window whose agent connection moved says so instead of claiming to reconnect.
  assert.match(app, /connectionNotice === "workspaceReplaced" \? companionCanvasesCopy\("MCP · Other window"/);
  assert.match(app, /"workspaceReplaced":"workspaceAccessRequired";\s*setStatus\(mcpConnectionNotice\(\)\);mcpRenderSettings\(\);window\.PenEchoCompanionCanvases\?\.changed\?\.\(\)/);
});

test("nothing blurs what is behind it: one block at the end switches frosted glass off and makes its surfaces solid", () => {
  const css = read("public/studio-shell.css"), block = css.slice(css.lastIndexOf("No frosted glass"));
  assert.match(block, /\*, \*::before, \*::after, ::backdrop \{ -webkit-backdrop-filter: none !important; backdrop-filter: none !important; \}/);
  assert.match(block, /body\[data-theme="studio"\] \{ --studio-glass: var\(--studio-titlebar\); --studio-glass-strong: var\(--studio-titlebar\); --studio-agent-overlay: var\(--studio-panel\); \}/);
  assert.match(block, /\.selected-widget-material, body\[data-theme="studio"\] \.selected-widget-material \{ background: var\(--panel-raised, #ffffff\); filter: none; \}/);
  assert.doesNotMatch(block, /blur\(/);
  assert.doesNotMatch(read("public/lines/lines.css"), /backdrop-filter/);
});

test("Canvas ink suggestions dock in an attached shelf below the AI bar without hiding model or effort controls", () => {
  const css = read("public/studio-shell.css");
  assert.match(css, /#aiToolsSection > \.assist-bar\.in-ai-bar \{[^}]*position: absolute;[^}]*top: calc\(100% \+ 6px\);[^}]*right: -1px;/);
  assert.doesNotMatch(css, /#aiToolsSection:has\(> \.assist-bar\.in-ai-bar[^)]*\) > :is\([^)]*#aiModelControl/);
  assert.doesNotMatch(css, /#aiToolsSection:has\(> \.assist-bar\.in-ai-bar[^)]*\) > :is\([^)]*#effortControl/);
});
