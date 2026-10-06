"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const read = file => fs.readFileSync(require.resolve(`../src/client/app/${file}.js`), "utf8");
function fn(source, name) {
  let start = source.indexOf(`  function ${name}(`);
  if (start < 0) start = source.indexOf(`  async function ${name}(`);
  const next = source.indexOf("\n  function ", start + 1);
  assert.ok(start >= 0, name);
  return source.slice(start, next < 0 ? source.length : next);
}
// 8x8 alpha masks: TILE 32 at DIRTY_MASK_SCALE .25, so one mask pixel is 4 units.
function mask() {
  const result = { width:8, height:8, pixels:new Uint8ClampedArray(8 * 8 * 4) };
  result.getContext = () => ({
    clearRect(x, y, w, h) {
      for (let py = Math.max(0, Math.floor(y)); py < Math.min(8, Math.ceil(y + h)); py++)
        for (let px = Math.max(0, Math.floor(x)); px < Math.min(8, Math.ceil(x + w)); px++) result.pixels[(py * 8 + px) * 4 + 3] = 0;
    },
    getImageData() { return { width:8, height:8, data:result.pixels.slice() }; },
  });
  return result;
}
function fixture() {
  const state = { dirtyInkTiles:new Map(), dirtyInkBounds:new Map(), dirtyImageIds:new Set(), dirtyTextBoxIds:new Set(), hotspotTrail:[],
      latestTypedInput:null, lastUserBox:null, dirty:null, autoEligible:false, images:[], textBoxes:[], recognitionGeneration:0, activeAI:null },
    smartSuggest = { strokes:[], consumedStrokeId:0 }, calls = [],
    context = { state, smartSuggest, calls, TILE:32, DIRTY_MASK_SCALE:.25, dirtyInputSnapshots:new Set(),
      key:(x, y) => `${x},${y}`, invalidateDirtyHistoryMask(){}, finishDirtyHistoryConsumption:() => calls.push("history"),
      smartSuggestInputConsumed:id => calls.push(`suggest:${id}`),
      imageBox:item => ({ x:item.x, y:item.y, w:item.w, h:item.h }), textBoxBox:item => ({ x:item.x, y:item.y, w:item.w, h:item.h }),
      unionDirtyBounds:(a, b) => !a ? { ...b } : { x:Math.min(a.x, b.x), y:Math.min(a.y, b.y),
        w:Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x), h:Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y) } };
  vm.createContext(context);
  const runtime = read("canvas-runtime"), persistence = read("persistence"), ai = read("ai-runtime");
  for (const name of ["dirtyInputScope", "consumeDirtyInputScope", "dirtyMaskAlphaBounds", "recomputeDirtyBounds", "clearDirtyContributionTracking", "consumeAllDirtyInput", "filterErasedDirtyHotspots"]) vm.runInContext(fn(runtime, name), context);
  vm.runInContext(fn(persistence, "clearDirtyInkRegion"), context);
  for (const name of ["intersection", "containsRect", "consumeAIRequestInput", "consumePendingInput"]) vm.runInContext(fn(ai, name), context);
  // Ink A in tile 0,0 (world 0..32) and ink B far away in tile 5,5 (world 160..192).
  for (const [k, x, y] of [["0,0", 12, 12], ["5,5", 172, 172]]) {
    const canvas = mask(), [tx, ty] = k.split(",").map(Number);
    canvas.pixels[(((y - ty * 32) / 4) * 8 + (x - tx * 32) / 4) * 4 + 3] = 255;
    state.dirtyInkTiles.set(k, canvas);
    state.hotspotTrail.push({ x, y });
  }
  state.textBoxes.push({ id:"near", x:4, y:4, w:8, h:8 }, { id:"far", x:200, y:200, w:8, h:8 });
  state.dirtyTextBoxIds.add("near").add("far");
  smartSuggest.strokes.push({ id:1, box:{ x:10, y:10, w:4, h:4 }, size:2 }, { id:2, box:{ x:170, y:170, w:4, h:4 }, size:2 });
  context.recomputeDirtyBounds();
  return { context, state, smartSuggest, calls };
}

for (const scope of ["manual", "suggest", "widget", "lasso"]) test(`successful ${scope} Canvas AI clears all pending ink, text, images and attention`, () => {
  const h = fixture();
  h.state.dirtyImageIds.add("offscreen-image");
  h.state.latestTypedInput = {text:"far",box:{x:200,y:200,w:8,h:8}};
  h.context.consumeAIRequestInput({ recognitionGeneration:0, requestBox:{ x:0, y:0, w:32, h:32 },
    isolatedSelection:scope === "lasso", inputScope:scope === "suggest" ? {x:0,y:0,w:32,h:32} : null });
  assert.equal(h.state.dirty, null);
  assert.equal(h.state.dirtyInkTiles.size, 0);
  assert.equal(h.state.dirtyTextBoxIds.size, 0);
  assert.equal(h.state.dirtyImageIds.size, 0);
  assert.equal(h.state.hotspotTrail.length, 0);
  assert.equal(h.state.latestTypedInput, null);
  assert.equal(h.state.autoEligible, false);
  assert.deepEqual(h.calls, ["suggest:2", "history"]);
});

for (const isolatedSelection of [false,true]) test(`accepting a ${isolatedSelection ? "lasso" : "focused"} draft clears all dirty input`, () => {
  const h = fixture();
  const selection = {};
  h.context.consumePendingInput({ isolatedSelection, selection, inputScope:{ x:150, y:150, w:70, h:70 }, latestBox:null });
  assert.equal(h.state.dirtyInkTiles.has("5,5"), false);
  assert.equal(h.state.dirtyInkTiles.has("0,0"), false);
  assert.equal(h.state.dirty, null);
  assert.deepEqual([...h.state.dirtyTextBoxIds], []);
  assert.deepEqual(h.calls, ["suggest:2", "history"]);
  assert.equal(selection.acceptedDraft,isolatedSelection ? true : undefined);
});

test("an explicit mask scope covers the pen width beyond the stroke's point box", () => {
  const h = fixture();
  h.smartSuggest.strokes[0].size = 60;
  const scope = h.context.dirtyInputScope({ x:10, y:10, w:4, h:4 }, 24);
  assert.equal(scope.x, 10 - (30 + 2 + 4));
  assert.deepEqual({ ...h.context.dirtyInputScope({ x:100, y:100, w:4, h:4 }, 24) }, { x:76, y:76, w:52, h:52 }, "unrelated strokes do not widen it");
});

test("capture targets never restrict successful AI dirty cleanup", () => {
  const ai = read("ai-runtime"), runtime = read("canvas-runtime");
  assert.doesNotMatch(fn(ai, "requestAI"), /inputScope|state\.dirty = null|clearDirtyContributionTracking/);
  assert.match(fn(runtime, "requestWidgetRefinement"), /captureWholeInput:Boolean\(refineInputBox\)/);
  assert.doesNotMatch(fn(runtime, "requestWidgetRefinement"), /inputScope/);
  for (const name of ["consumeAIRequestInput","consumePendingInput"]) {
    assert.match(fn(ai,name), /consumeAllDirtyInput\(\)/);
    assert.doesNotMatch(fn(ai,name), /consumeDirtyInputScope|consumeDirtyInput\(/);
  }
});

test("lifting lasso ink keeps unrelated pending input; commit moves and delete drops only the lifted mask", () => {
  const persistence = read("persistence");
  const capture = fn(persistence, "captureInkSelection");
  assert.doesNotMatch(capture, /invalidateRecognition\(\)/);
  assert.match(capture, /supersedeActiveAI\("ink-selection"\);[\s\S]*recordDirtyHistoryBefore\(\);[\s\S]*state\.historyBefore\.set/);
  assert.match(fn(persistence, "commitSelection"), /moveSelectionDirtyInk\(selection\);/);
  assert.match(fn(persistence, "deleteSelection"), /dropSelectionDirtyInk\(selection\);/);
});
