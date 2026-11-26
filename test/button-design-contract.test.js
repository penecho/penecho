"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parseHTML } = require("./helpers/dom.js");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const ALLOWED_BUTTONS = new Set([
  "secondary", "primary", "ghost", "icon", "toolbar", "danger",
  "danger-primary", "segment", "menu-item", "composer-action",
]);

test("every static product button uses a defined PenEcho control contract", () => {
  const html = read("public/index.html"), { document } = parseHTML(html);
  // These controls are styled by their owning Studio component.
  const componentControls = "#canvasDocumentSaveState,#aiToolbarRun,#penSizeTrigger,#studioNavigatorOpenToggle,#studioNavigatorOpenMore,#canvasAutoPausedNotice,#mcpStatusFollow,#mcpStatusConnect,#mcpStatusSettings,#mcpStatusPower,#canvasWelcomeDraw,#canvasWelcomeMcp,#companionRail button,#companionCanvasTarget,#canvasWelcomeExamplesAll,#canvasAiHintDone,[data-shell-forward],[data-effort],[data-grid-style]";
  const uncovered = [];
  for (const button of document.querySelectorAll("button")) {
    if (button.id === "aiOrb") continue;
    if (button.matches(componentControls)) continue;
    const direct = button.matches("[data-pe-button],[data-pe-control],[data-pe-hit],[data-pe-item]");
    const controlled = Boolean(button.closest('[data-pe-control="tab"],[data-pe-control="segmented"]'));
    if (!direct && !controlled) uncovered.push(button.id || button.outerHTML.slice(0, 80));
  }
  assert.deepEqual(uncovered, []);
  for (const button of document.querySelectorAll("[data-pe-button]")) {
    assert.ok(ALLOWED_BUTTONS.has(button.dataset.peButton), `undefined button type: ${button.dataset.peButton}`);
  }
  assert.equal(document.querySelector("#aiOrb").hasAttribute("data-pe-button"), false, "aiOrb keeps its location-owned visual exception");
  assert.equal(document.querySelector("#studioNavigatorScrim").tagName, "DIV", "the structural scrim is not presented as a button");
});

test("the incremental stylesheet owns the canonical tint ladder without importing design CSS", () => {
  const html = read("public/index.html"), css = read("public/style.css");
  assert.doesNotMatch(html, /penecho-design-language\.css/);
  assert.doesNotMatch(css, /@import\b/);
  assert.match(css, /--pe-hover:\s*color-mix\(in srgb, var\(--studio-accent[^;]+ 6%, var\(--studio-panel/);
  assert.match(css, /--pe-selected:\s*color-mix\(in srgb, var\(--studio-accent[^;]+ 10%, var\(--studio-panel/);
  assert.match(css, /--pe-accent-focus:\s*color-mix\(in srgb, var\(--studio-accent[^;]+ 28%, transparent\)/);
  assert.match(css, /\[data-pe-button="primary"\][^}]*\[data-pe-button="composer-action"\][^}]*color:\s*var\(--pe-accent-ink\)[^}]*background:\s*var\(--pe-accent-strong\)/s);
  assert.match(css, /--pe-button-standard-h:\s*30px/);
  assert.match(css, /--pe-button-compact-h:\s*28px/);
  assert.match(css, /--pe-menu-item-h:\s*30px/);
  assert.match(css, /\[data-pe-button\]\)\s*\{[^}]*line-height:\s*var\(--pe-button-standard-h, 30px\);/s);
  assert.match(css, /\[data-pe-button="menu-item"\]\)\s*\{[^}]*height:\s*var\(--pe-menu-item-h, 30px\);[^}]*min-height:\s*var\(--pe-menu-item-h, 30px\);[^}]*line-height:\s*var\(--pe-menu-item-h, 30px\);/s);
  assert.match(css, /\.snapshot-location-options input:checked \+ \[data-pe-button="menu-item"\][\s\S]*?color:\s*var\(--pe-accent-label\);[^}]*background:\s*var\(--pe-selected\);/);
  assert.doesNotMatch(css, /\.snapshot-location-options label:hover span\s*\{/);
  assert.match(css, /--pe-control-radius:\s*5px/);
});

test("Settings AI font uses the compact defined select contract", () => {
  const { document } = parseHTML(read("public/index.html")), css = read("public/style.css");
  assert.equal(document.querySelector("#aiFont").dataset.peControl, "select");
  assert.match(css, /#aiFont\[data-pe-control="select"\]\s*\{[^}]*width:\s*auto;[^}]*min-width:\s*0;[^}]*max-width:\s*min\(168px, 48%\);[^}]*height:\s*32px;[^}]*min-height:\s*32px;[^}]*flex:\s*0 0 auto;[^}]*padding:\s*0 28px 0 9px;[^}]*border-radius:\s*5px;/s);
  assert.match(css, /@media \(pointer: coarse\)[\s\S]*?label\.settings-row:has\(> #aiFont\[data-pe-control="select"\]\) \{ min-height:\s*44px; \}/);
});

test("binary switches match the catalog off state and tint only the on state", () => {
  const css = read("public/style.css");
  const switchContract = css.match(/:is\(#pe-button-contract, \[data-pe-control="switch"\]\)\s*\{([^}]*)\}/)?.[1] || "";
  assert.match(css, /--pe-ink-2:\s*var\(--studio-muted,\s*#4e5764\);/);
  assert.match(switchContract, /background:\s*var\(--pe-surface\)/);
  assert.match(css, /\[data-pe-control="switch"\]\)::after\s*\{[^}]*background:\s*var\(--pe-ink-2\);/s);
  assert.match(css, /\[data-pe-control="switch"\]\)\[aria-checked="true"\]\s*\{[^}]*border-color:\s*var\(--pe-accent\);[^}]*background:\s*var\(--pe-accent\);/s);
});

test("selection checkmarks use the unfilled success treatment", () => {
  const css = read("public/style.css");
  assert.match(css, /#settingsConnectionQuickList > \.settings-connection-quick\.active\s*\{[^}]*color:\s*var\(--pe-ink,[^}]*border-color:\s*var\(--pe-line,[^}]*background:\s*var\(--pe-surface,[^}]*box-shadow:\s*none;/s);
  assert.match(css, /#settingsConnectionQuickList > \.settings-connection-quick\.active > span:first-child\s*\{[^}]*color:\s*var\(--pe-success,[^}]*border-color:\s*transparent;[^}]*background:\s*transparent;/s);
  assert.match(css, /\.studio-palette-option\[aria-checked="true"\]::after\s*\{[^}]*color:\s*var\(--pe-success,[^}]*border-radius:\s*0;[^}]*background:\s*transparent;[^}]*content:\s*"✓";/s);
});

test("batch draft decisions use peer outlined buttons without tint fill", () => {
  const { document } = parseHTML(read("public/index.html")), css = read("public/style.css");
  assert.equal(document.querySelector("#rejectBatch").dataset.peButton, "danger");
  assert.equal(document.querySelector("#acceptBatch").dataset.peButton, "secondary");
  assert.match(css, /#batchActions > :is\(#rejectBatch, #acceptBatch\)\[data-pe-button\]\s*\{[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;[^}]*transform:\s*none;/s);
  assert.match(css, /#batchActions > #acceptBatch\[data-pe-button="secondary"\]\s*\{[^}]*color:\s*var\(--pe-success, var\(--confirm\)\);[^}]*border-color:\s*color-mix\(in srgb, var\(--pe-success, var\(--confirm\)\) 35%, var\(--pe-line, var\(--line\)\)\);/s);
  assert.match(css, /#batchActions > :is\(#rejectBatch, #acceptBatch\)\[data-pe-button\]:not\(:disabled\):is\(:hover, :focus-visible, :active\)\s*\{[^}]*background:\s*transparent;[^}]*transform:\s*none;/s);
});

test("runtime-created controls opt into the same closed contract", () => {
  const canvasRuntime = read("src/client/app/canvas-runtime.js");
  const appSources = [
    "src/client/app/core.js",
    "src/client/app/canvas-runtime.js",
    "src/client/app/persistence.js",
    "src/client/app/canvas-agent-runtime.js",
    "src/client/app/studio-navigator.js",
  ].map(read).join("\n");
  assert.match(appSources, /function peButton\(/);
  assert.doesNotMatch(appSources, /button\.dataset\.peList="double"/);
  assert.match(appSources, /peButton\(button, kind === "delete" \? "danger" : kind === "refine" \? "secondary" : "toolbar", "compact"\)/);
  assert.match(canvasRuntime, /function textEditorButton\([\s\S]*?peButton\(button, "toolbar", "compact"\)/);
  assert.match(read("public/cloud-connect.js"), /node\.dataset\.peButton = node\.classList\.contains\("primary"\)/);
  assert.match(read("public/viewer.js"), /link\.dataset\.peButton = "primary"/);
  assert.match(read("public/viewer.js"), /link\.dataset\.peButton = "secondary"/);
});

test("Studio navigator and view controls keep their location-owned button expression", () => {
  const { document } = parseHTML(read("public/index.html")), css = read("public/style.css");
  assert.equal(document.querySelector("#studioNavigatorManage").dataset.peButton, "ghost");
  assert.equal(document.querySelector("#canvasAgentToggle"), null, "the Agent launcher is gone");
  assert.equal(document.querySelector("#mcpToolbarToggle").dataset.peButton, "secondary");
  assert.equal(document.querySelector("#fullscreenBtn").dataset.peButton, "toolbar");
  assert.equal(document.querySelector("#gridToggle").dataset.peButton, "toolbar");
  assert.match(css, /Studio navigator location corrections/);
  assert.doesNotMatch(css, /#canvasAgentToggle/);
  assert.match(css, /\.view-tools > :is\(#fullscreenBtn, #gridToggle\)\[data-pe-button\]/);
  assert.match(css, /#fullscreenBtn\[data-pe-button\] > \.fullscreen-exit \{ display: none; \}/);
  assert.match(css, /body\[data-theme="studio"\]\.is-fullscreen \.view-tools > #fullscreenBtn\[data-pe-button\] > \.fullscreen-enter \{ display: none; \}/);
  assert.match(css, /body\[data-theme="studio"\]\.is-fullscreen \.view-tools > #fullscreenBtn\[data-pe-button\] > \.fullscreen-exit \{ display: block; \}/);
  assert.match(css, /#fullscreenBtn\[data-pe-button\]\[aria-pressed="true"\] \{[^}]*background: transparent;/s);
  assert.match(css, /#gridToggle\[data-pe-button\]\.active\s*\{[^}]*color:\s*var\(--pe-accent-label\);[^}]*border-color:\s*color-mix\(in srgb, var\(--pe-accent\) 28%, var\(--pe-line\)\);[^}]*background:\s*var\(--pe-selected\);[^}]*box-shadow:\s*none;/s);
  assert.match(css, /\.primary-tools \.view-tools\s*\{\s*gap:\s*8px/);
  assert.match(read("src/client/app/ui-bootstrap.js"), /fullscreenButton\.onclick = async \(event\)[\s\S]*?pointerActivated[\s\S]*?finally[\s\S]*?fullscreenButton\.blur\(\)/);
});

test("toolbar button shells do not draw a second control frame", () => {
  const { document } = parseHTML(read("public/index.html")), css = read("public/style.css");
  const effortShell = css.match(/\.effort-control\s*\{[^}]*\}/)?.[0] || "";
  const favoritesShell = css.match(/\.plugin-control\s*\{[^}]*\}/)?.[0] || "";
  assert.match(effortShell, /border:\s*0/);
  assert.match(effortShell, /background:\s*transparent/);
  assert.match(effortShell, /box-shadow:\s*none/);
  assert.match(favoritesShell, /border:\s*0/);
  assert.match(favoritesShell, /background:\s*transparent/);
  assert.match(favoritesShell, /box-shadow:\s*none/);
  assert.doesNotMatch(css, /\.(?:effort|plugin)-control:focus-within/);
  assert.equal(document.querySelector("#aiEffortButton").dataset.peButton, "secondary");
  assert.equal(document.querySelector("#craftsButton").dataset.peButton, "toolbar");
  assert.equal(document.querySelector("#craftsButton path").getAttribute("d"), "m12 3.6 2.5 5.2 5.7.7-4.2 3.9 1.1 5.6L12 16.2 6.9 19l1.1-5.6-4.2-3.9 5.7-.7Z");
  assert.doesNotMatch(document.querySelector("#craftsButton path").getAttribute("d"), /M12 5v14/);
});

test("toolbar color controls remain centered inside every pointer-size shell", () => {
  const css = read("public/style.css");
  assert.match(css, /\.color-orb-trigger\)\[data-pe-button\]\s*\{[^}]*top:\s*50%;[^}]*right:\s*auto;[^}]*bottom:\s*auto;[^}]*left:\s*50%;[^}]*transform:\s*translate\(-50%, -50%\)/s);
});
