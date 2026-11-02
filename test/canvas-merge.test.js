"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const plain = value => JSON.parse(JSON.stringify(value));
const TILE = 512;

function merger() {
  const context = vm.createContext({ window:{ PENECHO_LIVE_OPS:require("../public/live-ops.js") }, Blob, structuredClone, Uint8ClampedArray, TILE });
  vm.runInContext(`${fs.readFileSync(path.join(ROOT, "src/client/app/canvas-merge.js"), "utf8")}\nglobalThis.api={canvasMergeSaves,canvasMergeTileMap};`, context);
  return context.api;
}
// Tiles as plain RGBA arrays, painted one pixel at a time.
function tile(pixels = {}) {
  const data = new Uint8ClampedArray(TILE * TILE * 4);
  for (const [at, rgba] of Object.entries(pixels)) data.set(rgba, Number(at) * 4);
  return { pixels:data };
}
const read = async source => source.pixels;
const pixel = (source, at) => [...source.pixels.subarray(at * 4, at * 4 + 4)];
const RED = [255, 0, 0, 255], GREEN = [0, 200, 0, 255], BLUE = [0, 0, 255, 255], CLEAR = [0, 0, 0, 0];
const item = (fields = {}) => ({ name:"Plan", theme:"light", widgets:[], images:[], textBoxes:[], animations:[], bundleExtensions:{}, manifestExtensions:{}, ...fields });

test("both pages' object changes are kept: fields merge, deletions hold, and a clashing new object is renumbered", async () => {
  const { canvasMergeSaves } = merger();
  const widget = (id, fields) => ({ id, pluginId:"note", x:0, y:0, w:100, h:80, ...fields });
  const base = { item:item({ widgets:[widget("widget-1", { color:"red" }), widget("widget-2")] }), tiles:new Map() };
  const local = { item:item({ widgets:[widget("widget-1", { color:"red", x:50 }), widget("widget-3", { text:"mine" })] }), tiles:new Map() };
  const remote = { item:item({ widgets:[widget("widget-1", { color:"blue" }), widget("widget-2"), widget("widget-3", { text:"theirs" }), widget("widget-4")] }), tiles:new Map() };
  const merged = await canvasMergeSaves({ base, local, remote, pixels:read });
  assert.deepEqual(plain(merged.item.widgets.map(({ id, x, color, text }) => ({ id, x, color, text }))), [
    { id:"widget-1", x:50, color:"blue" },
    { id:"widget-3", x:0, text:"theirs" },
    { id:"widget-4", x:0 },
    { id:"widget-5", x:0, text:"mine" },
  ], "a moved widget keeps the other page's colour; the deleted one stays deleted; both new ones are kept");
  assert.equal(merged.changed, true);
});

test("an object the newer save already holds is the same object, not a second one", async () => {
  const { canvasMergeSaves } = merger();
  const box = (id, blob) => ({ id, blob, x:260, y:0, w:200, h:80 });
  const merged = await canvasMergeSaves({
    base:{ item:item({ images:[box("image-1", new Blob(["a"]))] }), tiles:new Map() },
    local:{ item:item({ images:[box("image-1", new Blob(["a"])), box("image-3000001", new Blob(["mine"]))] }), tiles:new Map() },
    remote:{ item:item({ images:[box("image-1", new Blob(["a"])), box("image-3000001", new Blob(["theirs"]))] }), tiles:new Map() }, pixels:read });
  assert.deepEqual(merged.item.images.map(entry => entry.id), ["image-1", "image-3000001"], "a box that reached the other page live is not doubled");
});

test("a newer save that already holds this page's changes needs nothing more", async () => {
  const { canvasMergeSaves, canvasMergeTileMap } = merger();
  const theirs = tile({ 2:GREEN, 3:BLUE }), newer = new Map([["0,0", theirs]]);
  const merged = await canvasMergeSaves({
    base:{ item:item({ widgets:[{ id:"widget-1", x:0 }] }), tiles:new Map() },
    local:{ item:item({ widgets:[{ id:"widget-1", x:5 }, { id:"widget-2", x:9 }] }), tiles:new Map([["0,0", tile({ 2:GREEN })]]) },
    remote:{ item:item({ widgets:[{ id:"widget-1", x:5 }, { id:"widget-2", x:9 }] }), tiles:newer }, pixels:read });
  assert.equal(merged.changed, false, "so this page does not save the same content again");
  assert.equal(merged.tiles.get("0,0"), theirs, "and keeps the newer save's tile as it is");
});

test("images compare by their bytes, so a moved image keeps the newer save's file", async () => {
  const { canvasMergeSaves } = merger();
  const mine = new Blob(["a"]), theirs = new Blob(["a"]), fresh = new Blob(["b"]);
  const image = (id, blob, x = 0) => ({ id, blob, x, y:0, w:10, h:10 });
  const merged = await canvasMergeSaves({
    base:{ item:item({ images:[image("image-1", mine)] }), tiles:new Map() },
    local:{ item:item({ images:[image("image-1", mine, 40), image("image-2", fresh)] }), tiles:new Map() },
    remote:{ item:item({ images:[image("image-1", theirs)] }), tiles:new Map() }, pixels:read });
  assert.deepEqual(merged.item.images.map(entry => [entry.id, entry.x, entry.blob === theirs ? "theirs" : entry.blob === fresh ? "fresh" : "other"]), [["image-1", 40, "theirs"], ["image-2", 0, "fresh"]]);
  assert.equal(Object.hasOwn(merged.item.images[0], "src"), false, "stored images carry their file, not a key");
});

test("ink merges by pixel: each page's strokes survive, even in the same tile", async () => {
  const { canvasMergeSaves } = merger();
  const base = { item:item(), tiles:new Map([["0,0", tile({ 1:RED })], ["1,0", tile({ 5:RED })], ["3,0", tile({ 7:RED })]]) };
  const local = { item:item(), tiles:new Map([["0,0", tile({ 1:RED, 2:GREEN })], ["2,0", tile({ 9:GREEN })]]) };
  const remote = { item:item(), tiles:new Map([["0,0", tile({ 3:BLUE })], ["1,0", tile({ 5:RED, 6:BLUE })], ["3,0", tile({ 7:RED })]]) };
  const merged = await canvasMergeSaves({ base, local, remote, pixels:read });
  const shared = merged.tiles.get("0,0");
  assert.deepEqual([pixel(shared, 1), pixel(shared, 2), pixel(shared, 3)], [CLEAR, GREEN, BLUE], "their erase, my stroke and their stroke in one tile");
  assert.deepEqual([pixel(merged.tiles.get("1,0"), 5), pixel(merged.tiles.get("1,0"), 6)], [CLEAR, BLUE], "my erase keeps their new stroke beside it");
  assert.equal(merged.tiles.has("3,0"), false, "a tile this page erased, untouched elsewhere, goes");
  assert.deepEqual(pixel(merged.tiles.get("2,0"), 9), GREEN, "a tile only this page drew in is added");
  assert.equal(merged.changed, true);
});

test("a tile this page did not touch keeps the newer save's own entry", async () => {
  const { canvasMergeSaves, canvasMergeTileMap } = merger();
  const same = new Blob(["tile"]), newer = { k:"0,0", blob:new Blob(["newer"]) };
  const merged = await canvasMergeSaves({ base:{ item:item(), tiles:canvasMergeTileMap([{ k:"0,0", blob:same }]) }, local:{ item:item(), tiles:canvasMergeTileMap([{ k:"0,0", blob:same }]) },
    remote:{ item:item(), tiles:canvasMergeTileMap([newer]) }, pixels:async () => assert.fail("an untouched tile is never decoded") });
  assert.equal(merged.tiles.get("0,0"), newer);
  assert.equal(merged.changed, false, "nothing of this page's to save again");
});

test("without a known base nothing is removed: this page's ink and objects are laid over the newer save", async () => {
  const { canvasMergeSaves } = merger();
  const merged = await canvasMergeSaves({ base:null,
    local:{ item:item({ widgets:[{ id:"widget-1", x:9 }] }), tiles:new Map([["0,0", tile({ 2:GREEN })]]) },
    remote:{ item:item({ widgets:[{ id:"widget-1", x:0 }, { id:"widget-2", x:0 }] }), tiles:new Map([["0,0", tile({ 3:BLUE })]]) }, pixels:read });
  assert.deepEqual(plain(merged.item.widgets), [{ id:"widget-1", x:9 }, { id:"widget-2", x:0 }]);
  const shared = merged.tiles.get("0,0");
  assert.deepEqual([pixel(shared, 2), pixel(shared, 3)], [GREEN, BLUE]);
});

test("names and themes follow whichever page changed them; the document and its sessions stay this page's", async () => {
  const { canvasMergeSaves } = merger();
  const merged = await canvasMergeSaves({
    base:{ item:item({ name:"Plan" }), tiles:new Map() },
    local:{ item:item({ name:"Plan v2", view:{ scale:2 }, bundleExtensions:{ penechoDocument:{ documentId:"mine" }, penechoWorkspace:{ sessions:[1] } } }), tiles:new Map() },
    remote:{ item:item({ theme:"dark", currentRevisionId:"r2", bundleExtensions:{ penechoDocument:{ documentId:"theirs" }, penechoLive:{ seq:4 } } }), tiles:new Map() }, pixels:read });
  assert.deepEqual(plain({ name:merged.item.name, theme:merged.item.theme, view:merged.item.view, revision:merged.item.currentRevisionId, extensions:merged.item.bundleExtensions }),
    { name:"Plan v2", theme:"dark", view:{ scale:2 }, revision:"r2", extensions:{ penechoDocument:{ documentId:"mine" }, penechoLive:{ seq:4 }, penechoWorkspace:{ sessions:[1] } } });
});

function clientFunction(file, name) {
  const source = fs.readFileSync(path.join(ROOT, file), "utf8"), start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  let depth = 0;
  for (let index = source.indexOf("{", start); index < source.length; index++) {
    if (source[index] === "{") depth++;
    else if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`unterminated ${name}`);
}

test("history made before a merge undoes only what still holds its change, and is not sent anywhere", () => {
  const ink = [], objects = [];
  const context = vm.createContext({
    LIVE_OPS:require("../public/live-ops.js"), LIVE_OBJECT_KINDS:["widgets", "images", "textBoxes"],
    liveCanvasCanEdit:() => false, liveTilePixels:canvas => canvas?.pixels || null,
    liveApplyLocalInk:(k, patch) => ink.push([k, patch]), liveWireList:(kind, list) => list, liveWireObject:(kind, item) => item,
    liveCommitOrder:op => objects.push(op), liveCommitObject:op => objects.push(op),
    liveCanvasQueue:() => assert.fail("a page that is not live sends nothing"),
  });
  vm.runInContext(`${clientFunction("src/client/app/live-canvas.js", "liveCanvasApplyHistory")}\nglobalThis.apply=liveCanvasApplyHistory;`, context);
  const entry = { tiles:[{ k:"0,0", before:tile(), after:tile({ 1:RED }) }], widgetsBefore:[{ id:"widget-1", x:0 }], widgetsAfter:[{ id:"widget-1", x:5 }] };
  assert.equal(context.apply(entry, "before"), null, "ordinary history restores as before");
  entry.rebased = true;
  assert.deepEqual(plain(context.apply(entry, "before")), { objects:null });
  const [[k, patch]] = ink;
  assert.equal(k, "0,0");
  assert.deepEqual([[...patch.values], [...patch.expect]], [CLEAR, RED], "the stroke is undone only where it is still there");
  assert.deepEqual(plain(objects), [{ t:"obj", k:"widgets", id:"widget-1", set:{ x:0 }, expect:{ x:5 } }], "a move is undone only if nobody moved it since");
});
