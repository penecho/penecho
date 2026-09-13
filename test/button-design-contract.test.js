"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parseHTML } = require("linkedom");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const ALLOWED_BUTTONS = new Set([
  "secondary", "primary", "ghost", "icon", "toolbar", "danger",
  "danger-primary", "segment", "menu-item", "composer-action",
]);

test("every static product button uses a defined PenEcho control contract", () => {
  const html = read("public/index.html"), { document } = parseHTML(html);
  const uncovered = [];
  for (const button of document.querySelectorAll("button")) {
    if (["aiOrb","canvasAgentSend","canvasAgentStop"].includes(button.id)) continue;
    const direct = button.matches("[data-pe-button],[data-pe-control],[data-pe-hit],[data-pe-item]");
    const controlled = Boolean(button.closest('[data-pe-control="tab"],[data-pe-control="segmented"]'));
    if (!direct && !controlled) uncovered.push(button.id || button.outerHTML.slice(0, 80));
  }
  assert.deepEqual(uncovered, []);
  for (const button of document.querySelectorAll("[data-pe-button]")) {
    assert.ok(ALLOWED_BUTTONS.has(button.dataset.peButton), `undefined button type: ${button.dataset.peButton}`);
  }
  for (const id of ["aiOrb","canvasAgentSend","canvasAgentStop"]) assert.equal(document.querySelector(`#${id}`).hasAttribute("data-pe-button"), false, `${id} keeps its location-owned visual exception`);
  assert.equal(document.querySelector("#studioNavigatorScrim").tagName, "DIV", "the structural scrim is not presented as a button");
});

test("PenEcho Agent composer maps tint to the defined action hierarchy", () => {
  const { document } = parseHTML(read("public/index.html"));
  const expected = {
    canvasAgentAttach:"toolbar",
    canvasAgentProject:"toolbar",
    canvasAgentPromptToggle:"ghost",
    canvasAgentConnection:"ghost",
    canvasAgentReference:"toolbar",
    canvasAgentTextMode:"toolbar",
    canvasAgentInkMode:"toolbar",
    canvasAgentSearch:"toolbar",
  };
  for (const [id, type] of Object.entries(expected)) assert.equal(document.querySelector(`#${id}`).dataset.peButton, type, id);
  for (const id of ["canvasAgentSend","canvasAgentStop"]) assert.equal(document.querySelector(`#${id}`).dataset.peButton,undefined,`${id} restores its original circular control`);
  assert.match(read("public/style.css"),/\.canvas-agent-composer \.canvas-agent-send,[\s\S]*?\.canvas-agent-composer \.canvas-agent-stop\s*\{[^}]*border-radius:\s*50%/);
  assert.match(read("src/client/app/canvas-agent-runtime.js"), /peButton\(canvasAgentProjectButton,\s*project\s*\?\s*"secondary"\s*:\s*"toolbar",\s*"compact"\)/);
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
  assert.match(css, /\.canvas-agent-reference-chip em::before\s*\{[^}]*color:\s*var\(--pe-success,[^}]*border-radius:\s*0;[^}]*background:\s*transparent;[^}]*content:\s*"\\2713";[^}]*font:\s*700 15px\/16px var\(--pe-font-ui/s);
  assert.match(css, /#canvasAgentReferenceList > button\[data-pe-button="menu-item"\]\[aria-selected="true"\]\s*\{[^}]*color:\s*var\(--pe-ink,[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s);
  assert.match(css, /#canvasAgentReferenceList > button\[data-pe-button="menu-item"\]\[aria-selected="true"\]:hover\s*\{[^}]*color:\s*var\(--pe-ink,[^}]*background:\s*var\(--pe-surface-raised,[^}]*box-shadow:\s*none;/s);
  assert.match(css, /#canvasAgentReferenceList > button\[data-pe-button="menu-item"\]\[aria-selected="true"\] > small::before\s*\{[^}]*color:\s*var\(--pe-success,[^}]*border-radius:\s*0;[^}]*background:\s*transparent;[^}]*content:\s*"\\2713";/s);
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
  assert.match(appSources, /button\.dataset\.peItem="icon-copy-action"/);
  assert.doesNotMatch(appSources, /button\.dataset\.peList="double"/);
  assert.match(appSources, /titleText=t\(suggestion\.title\)/);
  assert.match(read("public/index.html"),/id="canvasAgentPromptPopup"[^>]*data-pe-list="icon-copy"/);
  assert.match(appSources, /peButton\(button, kind === "delete" \? "danger" : kind === "refine" \? "secondary" : "toolbar", "compact"\)/);
  assert.match(appSources, /peButton\(remove,"toolbar","compact"\)/, "navigator session delete remains an inline toolbar action");
  assert.match(canvasRuntime, /function textEditorButton\([\s\S]*?peButton\(button, "toolbar", "compact"\)/);
  assert.match(canvasRuntime, /document\.body\.classList\.contains\("studio-agent-docked"\)/);
  assert.match(read("public/cloud-connect.js"), /node\.dataset\.peButton = node\.classList\.contains\("primary"\)/);
  assert.match(read("public/viewer.js"), /link\.dataset\.peButton = "primary"/);
  assert.match(read("public/viewer.js"), /link\.dataset\.peButton = "secondary"/);
});

test("Studio navigator and view controls keep their location-owned button expression", () => {
  const { document } = parseHTML(read("public/index.html")), css = read("public/style.css");
  assert.equal(document.querySelector("#studioNavigatorManage").dataset.peButton, "ghost");
  assert.equal(document.querySelector("#canvasAgentToggle").dataset.peButton, "toolbar");
  assert.equal(document.querySelector("#fullscreenBtn").dataset.peButton, "toolbar");
  assert.equal(document.querySelector("#gridToggle").dataset.peButton, "toolbar");
  assert.match(css, /Studio navigator and Agent composer location corrections/);
  assert.match(css, /#canvasAgentToggle\[data-pe-button="toolbar"\]\s*\{[^}]*width: max-content;[^}]*min-width: max-content;[^}]*flex: 0 0 auto;[^}]*padding: 2px 10px;/s);
  assert.match(css, /studio-toolbar-controls-compact[\s\S]*?#canvasAgentToggle\[data-pe-button="toolbar"\]\s*\{[^}]*height: 32px;[^}]*min-height: 32px;[^}]*padding-inline: 4px;/);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*?#canvasAgentToggle\[data-pe-button="toolbar"\]\s*\{[^}]*width: 46px;[^}]*min-width: 46px;[^}]*height: 46px;[^}]*min-height: 46px;[^}]*flex-basis: 46px;/);
  assert.match(css, /\.view-tools > :is\(#fullscreenBtn, #gridToggle\)\[data-pe-button\]/);
  assert.match(css, /#fullscreenBtn\[data-pe-button\] > \.fullscreen-exit \{ display: none; \}/);
  assert.match(css, /body\[data-theme="studio"\]\.is-fullscreen \.view-tools > #fullscreenBtn\[data-pe-button\] > \.fullscreen-enter \{ display: none; \}/);
  assert.match(css, /body\[data-theme="studio"\]\.is-fullscreen \.view-tools > #fullscreenBtn\[data-pe-button\] > \.fullscreen-exit \{ display: block; \}/);
  assert.match(css, /#fullscreenBtn\[data-pe-button\]\[aria-pressed="true"\] \{[^}]*background: transparent;/s);
  assert.match(css, /#gridToggle\[data-pe-button\]\.active\s*\{[^}]*color:\s*var\(--pe-accent-label\);[^}]*border-color:\s*color-mix\(in srgb, var\(--pe-accent\) 28%, var\(--pe-line\)\);[^}]*background:\s*var\(--pe-selected\);[^}]*box-shadow:\s*none;/s);
  assert.match(css, /\.primary-tools \.view-tools\s*\{\s*gap:\s*8px/);
  assert.match(read("src/client/app/ui-bootstrap.js"), /fullscreenButton\.onclick = async \(event\)[\s\S]*?pointerActivated[\s\S]*?finally[\s\S]*?fullscreenButton\.blur\(\)/);
});

test("Agent composer keeps the scale90 button set and layout while adopting tint", () => {
  const { document } = parseHTML(read("public/index.html")), css = read("public/style.css");
  const ids = Array.from(document.querySelectorAll(".canvas-agent-composer-actions button"), (button) => button.id);
  assert.deepEqual(ids, [
    "canvasAgentAttach",
    "canvasAgentReference",
    "canvasAgentTextMode",
    "canvasAgentInkMode",
    "canvasAgentSearch",
    "canvasAgentStop",
    "canvasAgentSend",
  ]);
  const toolbarIds = Array.from(document.querySelectorAll(".canvas-agent-composer-toolbar button"), (button) => button.id);
  assert.deepEqual(toolbarIds, ["canvasAgentProject","canvasAgentProjectClear","canvasAgentPromptToggle","canvasAgentConnection"]);
  assert.equal(document.querySelector("#canvasAgentProjectLabel")?.parentElement?.className, "canvas-agent-project-content");
  assert.equal(document.querySelector("#canvasAgentProjectLabel")?.parentElement?.parentElement?.className, "canvas-agent-project-label-clip");
  assert.equal(document.querySelector("#canvasAgentConnectionLabel")?.parentElement?.className, "canvas-agent-connection-label-clip");
  const genericSvgRule = css.match(/:is\(#pe-button-contract, \[data-pe-button\]\) > svg\s*\{([^}]*)\}/)?.[1] || "";
  assert.match(css, /:where\(\[data-pe-button\]\) > svg \{ display: block; \}/);
  assert.doesNotMatch(genericSvgRule, /display:\s*block/, "state-owned SVG visibility must beat generic icon normalization");
  assert.match(css, /\.canvas-agent-tool-actions,\s*\.canvas-agent-primary-actions\s*\{ display: flex; align-items: center; gap: 2px; \}/);
  assert.match(css, /:is\(#pe-button-contract, \.canvas-agent-composer-toolbar\) \.canvas-agent-project-control > \.canvas-agent-project-button\[data-pe-button\]\s*\{[^}]*width: 100%;[^}]*min-width: 0;[^}]*max-width: 100%;[^}]*flex: 1 1 auto;/s);
  const noProjectLabelRule = css.match(/(?:^|\n)\.canvas-agent-project-button > \.canvas-agent-project-label-clip\s*\{([^}]*)\}/)?.[1] || "";
  assert.match(noProjectLabelRule, /width:\s*100%;[^}]*flex:\s*1 1 auto;[^}]*text-overflow:\s*clip;/s);
  assert.doesNotMatch(noProjectLabelRule, /mask-image/, "No project stays fully visible");
  assert.match(css, /\.canvas-agent-project-button\[data-pe-button="toolbar"\]\[aria-expanded="false"\] #canvasAgentProjectLabel\s*\{[^}]*color:\s*var\(--pe-ink, var\(--studio-text, #20242c\)\);/s);
  const selectedProjectLabelRule = css.match(/\.canvas-agent-project-control\.has-resource > \.canvas-agent-project-button > \.canvas-agent-project-label-clip\s*\{([^}]*)\}/)?.[1] || "";
  assert.match(selectedProjectLabelRule, /-webkit-mask-image:\s*linear-gradient\(to left,\s*transparent 0 8px,\s*#000 16px\);/);
  assert.match(selectedProjectLabelRule, /(?:^|[;\s])mask-image:\s*linear-gradient\(to left,\s*transparent 0 8px,\s*#000 16px\);/);
  assert.doesNotMatch(selectedProjectLabelRule, /%|calc\(/, "Only the trailing half of the 16px clear rail fades; the outer half stays transparent");
  assert.doesNotMatch(selectedProjectLabelRule, /padding-inline-end/, "The outer mask rail must extend through the whole clear-action footprint");
  assert.match(css, /\.canvas-agent-project-content\s*\{[^}]*width:\s*100%;[^}]*justify-content:\s*safe center;/s);
  assert.match(css, /\.canvas-agent-project-control\.has-resource > \.canvas-agent-project-button \.canvas-agent-project-content\s*\{[^}]*width:\s*calc\(100% - 16px\);[^}]*flex-basis:\s*calc\(100% - 16px\);/s);
  assert.match(css, /\.canvas-agent-project-content > :is\(\.canvas-agent-project-folder-icon, \.canvas-agent-project-file-icon\)\s*\{[^}]*width:\s*14px;[^}]*flex:\s*0 0 14px;[^}]*stroke:\s*currentColor;/s);
  assert.match(css, /\.canvas-agent-project-control\.has-resource > \.canvas-agent-project-button\[data-pe-button\]\s*\{[^}]*padding-inline:\s*8px 5px;/s);
  assert.match(css, /\.canvas-agent-composer \.canvas-agent-project-clear\s*\{[^}]*right:\s*10px;[^}]*left:\s*auto;/s);
  assert.match(css, /\.canvas-agent-project-control\.has-resource:is\(:hover, :focus-within\) > \.canvas-agent-project-button\[data-pe-button\]\s*\{[^}]*gap:\s*0;/s);
  assert.match(css, /\.canvas-agent-project-control\.has-resource:is\(:hover, :focus-within\) \.canvas-agent-project-content > :is\(\.canvas-agent-project-folder-icon, \.canvas-agent-project-file-icon\)\s*\{[^}]*width:\s*0;[^}]*flex-basis:\s*0;/s);
  assert.match(css, /@media \(hover: none\)[\s\S]*?\.canvas-agent-project-control\.has-resource > \.canvas-agent-project-clear\[data-pe-button\]\s*\{[^}]*opacity:\s*1;[^}]*pointer-events:\s*auto;/s);
  assert.match(css, /@media \(pointer: coarse\)[\s\S]*?\.canvas-agent-project-clear::before\s*\{[^}]*inset:\s*-14px 0 -14px -28px;/s);
  const connectionLabelRule = css.match(/(?:^|\n)\.canvas-agent-connection-button > \.canvas-agent-connection-label-clip\s*\{([^}]*)\}/)?.[1] || "";
  assert.match(connectionLabelRule, /max-width:\s*100%;[^}]*flex:\s*0 1 auto;[^}]*padding-inline-end:\s*19px;[^}]*text-overflow:\s*clip;/s);
  assert.match(connectionLabelRule, /-webkit-mask-image:\s*linear-gradient\(to left,\s*transparent 0 7px,\s*#000 14px\);/);
  assert.match(connectionLabelRule, /(?:^|[;\s])mask-image:\s*linear-gradient\(to left,\s*transparent 0 7px,\s*#000 14px\);/);
  assert.doesNotMatch(connectionLabelRule, /ellipsis|mask-image:[^;]*%|mask-image:[^;]*calc\(/, "The connection label fades only inside the fixed 14px chevron rail");
  assert.match(css, /\.canvas-agent-connection-button\[data-pe-button\]\s*\{[^}]*justify-content:\s*center;[^}]*gap:\s*0;/s);
  assert.match(css, /\.canvas-agent-connection-button\[data-pe-button\] > svg\s*\{[^}]*margin-inline-start:\s*-14px;/s);
  assert.match(css, /\.canvas-agent-composer-toolbar\s*\{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /@container \(max-width: 520px\)[\s\S]*?\.canvas-agent-primary-actions\) \{ gap: 1px; \}/);
  assert.doesNotMatch(css, /\.canvas-agent-primary-actions\s*\) \{ gap: 4px; \}/);
});

test("Agent attachments keep the catalog icon action inside the preview corner", () => {
  const source = read("src/client/app/canvas-agent-runtime.js"), css = read("public/style.css");
  assert.match(source, /chip\.dataset\.peList="single"/);
  assert.match(css, /\.canvas-agent-attachment\.file\s*\{[^}]*display:\s*block;/s);
  assert.doesNotMatch(css, /\.canvas-agent-attachment\.file\s*\{[^}]*grid-template-columns:/s);
  assert.match(css, /\.canvas-agent-attachment\) > button\[data-pe-button="icon"\]\s*\{[^}]*position:\s*absolute;[^}]*top:\s*0;[^}]*right:\s*0;[^}]*width:\s*28px;[^}]*height:\s*28px;[^}]*border-color:\s*transparent;[^}]*background:\s*transparent;/s);
  assert.match(css, /\.canvas-agent-attachment\) > button\[data-pe-button="icon"\]::before\s*\{[^}]*inset:\s*-4px;[^}]*content:\s*"";/s);
  assert.match(css, /\.canvas-agent-attach\) > \.canvas-agent-attachment-count\s*\{[^}]*top:\s*-10px;[^}]*right:\s*0;[^}]*min-width:\s*16px;[^}]*height:\s*16px;/s);
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
