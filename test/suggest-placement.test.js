"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../src/client/app/smart-suggestions.js"), "utf8");
const context = vm.createContext({});
vm.runInContext(source.slice(source.indexOf("  function assistOccupiedArea("), source.indexOf("  function positionAssist(")), context);

function mask(width, height, boxes) {
  const stride = width + 1, sums = new Uint32Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += boxes.some(b => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) ? 1 : 0;
      sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + row;
    }
  }
  return { width, height, stride, sums };
}
const placement = (...args) => JSON.parse(JSON.stringify(context.assistFindPlacement(...args)));
const overlap = (m, point, w, h) => context.assistOccupiedArea(m, point.x, point.y, w, h);

test("a docked Agent reserves its rectangle without pushing suggestions below the viewport", () => {
  const topbar = { left:0, top:0, right:400, width:400, height:40 },
    panel = { left:260, top:0, right:400, width:140, height:320 },
    ctx = vm.createContext({
      document:{ querySelector:selector => selector === ".topbar" ? topbar : null, querySelectorAll:() => [panel],
        createElement:() => ({ getContext:() => ({ fillRect(){}, getImageData:() => ({ data:new Uint8ClampedArray(400 * 320 * 4) }) }) }) },
      canvasElementLayoutRect:box => box, viewportRect:() => null,
      visibleWidgets:() => [], visibleImages:() => [], visibleTextBoxes:() => [], visibleAnimations:() => [],
      widgetBox(){}, imageBox(){}, textBoxBox(){}, animationBox(){}, assistPendingBox:() => null,
      assistScreenBox:box => box, canvasDocumentsCurrent:() => ({ id:"canvas" }), tiles:new Map(),
      state:{ history:[], userRevision:1, scale:1, panX:0, panY:0 },
    });
  vm.runInContext(source.slice(source.indexOf("  let assistPlacementMask = null;"), source.indexOf("  function assistOccupiedArea(")), ctx);
  assert.equal(ctx.assistContentMask(400, 320).minY, 48, "only the full-width topbar sets the placement floor");
});

test("an unobstructed preferred position keeps the writing gap and toolbar clearance", () => {
  const m = mask(400, 320, []), preferred = { x:180, y:170 };
  assert.deepEqual(placement(m, 120, 36, preferred, { x:80, y:50, w:100, h:56 }), preferred);
});

test("a complete content-free slot beats the preferred position and the writing gap", () => {
  const m = mask(400, 320, [
    { x:180, y:170, w:140, h:45 }, // Old ink at the preferred position.
    { x:0, y:0, w:400, h:140 }, // Widget occupying the upper viewport.
  ]);
  const found = placement(m, 120, 36, { x:180, y:170 }, { x:0, y:0, w:400, h:150 });
  assert.equal(overlap(m, found, 120, 36), 0);
  assert.ok(found.y + 36 <= 320 - 84);
});

test("even a single exact-size free slot prevents the overlap fallback", () => {
  const width = 200, height = 230, slot = { x:73, y:91, w:82, h:31 },
    m = mask(width, height, [
      { x:0, y:0, w:width, h:slot.y },
      { x:0, y:slot.y + slot.h, w:width, h:height - slot.y - slot.h },
      { x:0, y:slot.y, w:slot.x, h:slot.h },
      { x:slot.x + slot.w, y:slot.y, w:width - slot.x - slot.w, h:slot.h },
    ]);
  assert.deepEqual(placement(m, slot.w, slot.h, { x:8, y:8 }, null), { x:slot.x, y:slot.y });
});

test("when no full free position exists, fallback minimizes covered content", () => {
  const m = mask(200, 230, [{ x:0, y:0, w:200, h:230 }]);
  // Make one partial opening that cannot fit the complete bar.
  const open = mask(200, 230, [
    { x:0, y:0, w:200, h:50 }, { x:0, y:65, w:200, h:165 },
    { x:0, y:50, w:70, h:15 }, { x:150, y:50, w:50, h:15 },
  ]);
  const found = placement(open, 80, 30, { x:8, y:8 }, null);
  assert.equal(overlap(open, found, 80, 30), 80 * 15);
  assert.deepEqual(placement(m, 80, 30, { x:90, y:80 }, null), { x:90, y:80 });
});

const writingDistance = (point, w, h, anchor) => Math.max(0,
  anchor.x - point.x - w, point.x - anchor.x - anchor.w,
  anchor.y - point.y - h, point.y - anchor.y - anchor.h);

test("instant prompts reserve 80 screen pixels even when older content fills the distant slots", () => {
  const m = mask(440, 400, [{ x:0, y:0, w:440, h:400 }]), anchor = { x:150, y:130, w:50, h:40 },
    found = placement(m, 120, 36, { x:214, y:130 }, anchor, { inkGap:80, prioritizeInkGap:true });
  assert.ok(writingDistance(found, 120, 36, anchor) >= 80);
  assert.ok(found.x >= 8 && found.x + 120 <= 432 && found.y >= 8 && found.y + 36 <= 316);
});

test("a cramped viewport keeps the prompt visible at the greatest available writing distance", () => {
  const m = mask(240, 220, []), anchor = { x:95, y:90, w:50, h:40 },
    found = placement(m, 160, 36, { x:145, y:100 }, anchor, { inkGap:80, prioritizeInkGap:true });
  assert.equal(writingDistance(found, 160, 36, anchor), 46);
  assert.equal(found.y, 8);
  assert.ok(found.x >= 8 && found.x + 160 <= 232 && found.y + 36 <= 136);
});

test("writing clearance uses screen coordinates consistently across Canvas zoom and pan", () => {
  for (const scale of [.35, 1, 2]) {
    const anchor = { x:130 * scale + 15, y:85 * scale + 25, w:30 * scale, h:20 * scale },
      found = placement(mask(620, 500, []), 150, 36, { x:anchor.x + anchor.w + 14, y:anchor.y }, anchor,
        { inkGap:80, prioritizeInkGap:true });
    assert.ok(writingDistance(found, 150, 36, anchor) >= 80, `zoom ${scale}`);
  }
});

test("Refine moves away from the Suggest bar without losing the writing clearance", () => {
  const anchor = { x:120, y:95, w:40, h:30 }, preferred = { x:240, y:95 },
    obstacles = [{ ...preferred, w:180, h:40 }],
    found = placement(mask(480, 400, []), 180, 40, preferred, anchor,
      { inkGap:80, prioritizeInkGap:true, obstacles });
  assert.ok(writingDistance(found, 180, 40, anchor) >= 80);
  assert.equal(Math.max(0, Math.min(found.x + 180, 420) - Math.max(found.x, 240))
    * Math.max(0, Math.min(found.y + 40, 135) - Math.max(found.y, 95)), 0);
});

test("pen-down hides every actionable Assist state independently of requests", () => {
  const start = source.indexOf("  function assistSyncWriting("), end = source.indexOf("  function smartSuggestDrawingStarted(", start),
    ctx = vm.createContext({ state:{ drawing:{} }, smartSuggest:{localReadyAt:0}, performance:{now:()=>1000}, smartSuggestReopenedInk:()=>false });
  vm.runInContext(source.slice(start, end), ctx);
  for (const mode of ["suggest", "working", "result", "followup", "tools", "tool"]) {
    const classes = new Set(), bar = { mode, element:{ classList:{ toggle:(name, on) => on ? classes.add(name) : classes.delete(name) } } };
    ctx.smartSuggest.bar = bar;
    ctx.state.drawing = {};
    assert.equal(ctx.assistSyncWriting(), true);
    assert.ok(classes.has("is-writing"));
    assert.equal(bar.element.inert, true);
    ctx.state.drawing = null;
    ctx.smartSuggest.localReadyAt = 1500;
    assert.equal(ctx.assistSyncWriting(), true, "pen-up keeps the bar hidden through the quiet period");
    assert.equal(bar.element.inert, true);
    ctx.smartSuggest.localReadyAt = 1000;
    assert.equal(ctx.assistSyncWriting(), false);
    assert.ok(!classes.has("is-writing"));
    assert.equal(bar.element.inert, false);
  }
});

test("pen chips fully yield during writing and step flags wait for pen-up quiet", () => {
  const pen = fs.readFileSync(path.join(__dirname, "../src/client/app/pen-intelligence.js"), "utf8"),
    start = pen.indexOf("  function penIntelSyncWriting("), end = pen.indexOf("\n  // Reserve", start),
    chip = () => ({ classes:new Set(), classList:{ toggle(name, on) { on ? this.owner.classes.add(name) : this.owner.classes.delete(name); } } }),
    elements = [chip(), chip(), chip()];
  for (const element of elements) element.classList.owner = element;
  const ctx = vm.createContext({ state:{drawing:{}}, smartSuggest:{localReadyAt:1500}, performance:{now:()=>1000},
    penIntel:{offer:{element:elements[0]},refineOffer:{element:elements[1]},step:{chip:elements[2]}} });
  vm.runInContext(pen.slice(start, end), ctx);
  ctx.penIntelSyncWriting();
  assert.ok(elements.every(element => element.inert && element.classes.has("is-writing")));
  ctx.state.drawing = null;ctx.penIntelSyncWriting();
  assert.ok(elements.slice(0, 2).every(element => !element.inert && !element.classes.has("is-writing")));
  assert.equal(elements[2].inert, true);
  ctx.smartSuggest.localReadyAt = 1000;ctx.penIntelSyncWriting();
  assert.ok(elements.every(element => !element.inert && !element.classes.has("is-writing")));
});
