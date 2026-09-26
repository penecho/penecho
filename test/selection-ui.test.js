"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const functionSource = (source, name) => source.match(new RegExp(`function ${name}\\([^]*?\\n  \\}`))?.[0] || "";

function viewportSource(html) {
  const start = html.indexOf('<section id="viewport"');
  assert.ok(start >= 0, "Canvas viewport exists");
  let depth = 0;
  for (const match of html.slice(start).matchAll(/<\/?section\b[^>]*>/g)) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(start, start + match.index + match[0].length);
  }
  assert.fail("Canvas viewport closes after its nested sections");
}

test("selection toolbar is an accessible viewport overlay with stable action hooks", () => {
  const html = read("public/index.html"),
    viewport = viewportSource(html),
    layer = viewport.match(/<div id="selectionOverlayLayer"[\s\S]*?<\/div>\s*<\/div>/)?.[0] || "";

  assert.match(layer, /class="selection-overlay-layer"[^>]*hidden/);
  assert.match(layer, /id="selectionToolbar"[^>]*role="toolbar"[^>]*data-i18n-aria="selectionTools"/);
  assert.match(layer, /id="selectionScopeNotice"[^>]*data-i18n="selectionScopeNotice"/);
  for (const [id, key] of [
    ["selectionTypesetBtn", "selectionTypeset"],
    ["selectionDeleteBtn", "selectionDelete"],
    ["selectionCancelBtn", "selectionCancel"],
  ]) {
    const button = layer.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`))?.[0] || "";
    assert.match(button, /type="button"/);
    assert.match(button, new RegExp(`data-i18n="${key}"`));
    assert.match(button, new RegExp(`data-i18n-aria="${key}"`));
    assert.match(button, new RegExp(`data-i18n-title="${key}"`));
  }
  assert.ok(viewport.indexOf('id="screen"') < viewport.indexOf('id="selectionOverlayLayer"'));
  assert.ok(viewport.indexOf('id="selectionOverlayLayer"') < viewport.indexOf('id="textEditorLayer"'));
});

test("selection overlay only intercepts its compact toolbar controls", () => {
  const css = read("public/style.css");

  assert.match(css, /\.selection-overlay-layer\s*\{[^}]*position:\s*absolute;[^}]*z-index:\s*7;[^}]*inset:\s*0;[^}]*pointer-events:\s*none/);
  assert.match(css, /\.selection-overlay-layer\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(css, /\.selection-context-toolbar\s*\{[^}]*position:\s*absolute;[^}]*max-width:\s*min\(580px,\s*calc\(100% - 16px\)\)[^}]*pointer-events:\s*auto/);
  assert.match(css, /transform:\s*translate3d\(var\(--selection-toolbar-x,\s*8px\),\s*var\(--selection-toolbar-y,\s*8px\),\s*0\)/);
  assert.match(css, /\.selection-scope-notice\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*gap:\s*5px/);
  assert.match(css, /\.selection-scope-notice::before\s*\{[^}]*flex:\s*0\s+0\s+15px/);
  assert.match(css, /\.selection-toolbar-actions\s*\{[^}]*display:\s*inline-flex/);
  assert.match(css, /@media \(max-width:\s*620px\)[\s\S]*?\.selection-context-toolbar\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(css, /@media \(pointer:\s*coarse\)[\s\S]*?\.selection-toolbar-button\s*\{[^}]*min-height:\s*36px/);
});

test("selection resize handles share one uninterrupted canvas path", () => {
  const app = read("public/app.js"),
    axes = functionSource(app, "drawSelectionAxisHandles"),
    selection = functionSource(app, "drawSelection");

  assert.doesNotMatch(axes, /\.beginPath\(|\.stroke\(/);
  assert.match(selection, /ctx\.beginPath\(\);\s*drawResizeHandle\(ctx, selection\.box, size\);\s*drawSelectionAxisHandles\(ctx, selection\.box, size\);\s*ctx\.stroke\(\);/);
});
