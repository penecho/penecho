"use strict";
require("./helpers/safety.js");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const bridge = fs.readFileSync(path.join(__dirname, "../src/client/app/project-lines-bridge.js"), "utf8");
const documents = fs.readFileSync(path.join(__dirname, "../src/client/app/canvas-documents.js"), "utf8");
const functions = bridge.slice(bridge.indexOf("  const projectLinesView ="), bridge.indexOf("  async function projectLinesOpen("));
const applyView = documents.slice(documents.indexOf("  function canvasDocumentsApplyView("), documents.indexOf("  async function canvasDocumentsAdopt("));
const key = "penecho-lines-view:doc-one";
const camera = { version:1, scale:.65, panX:-850, panY:-900, navigationLocked:false };
function harness({ value, storage = new Map(), unavailable = false } = {}) {
  if (value !== undefined) storage.set(key, value);
  const writes = [], timers = new Map(); let sequence = 0, local = true, active = "doc-one";
  const state = { scale:.4, panX:80, panY:90, navigationLocked:false, viewInitialized:false, userRevision:7 };
  const run = { ready:false, documentId:"doc-one" };
  const context = {
    state, projectLinesRun:run, projectLinesInFront:() => active === run.documentId, projectLinesLocal:() => local,
    localStorage:{ getItem:k => { if (unavailable) throw Error("blocked"); return storage.get(k) || null; }, setItem:(k,v) => { if (unavailable) throw Error("blocked"); storage.set(k,v); writes.push([k,v]); } },
    requestRender() {}, updateCoordinates() {}, setCanvasNavigationLocked:locked => { state.navigationLocked = locked; },
    setTimeout:(fn, ms) => { assert.equal(ms, 200); timers.set(++sequence, fn); return sequence; }, clearTimeout:id => timers.delete(id),
  };
  const api = vm.runInNewContext(`${applyView}\n${functions}\n({restore:projectLinesRestoreView, remember:projectLinesRememberView})`, context);
  api.restore(); run.ready = true;
  return { state, run, api, writes, storage, timers, setLocal:value => { local = value; }, setActive:value => { active = value; }, flushTimer:() => { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); } };
}
test("a valid camera restores exact pan, lock and zoom, including outside the finite canvas", () => {
  const h = harness({ value:JSON.stringify({ ...camera, panX:-500000, navigationLocked:true }) });
  assert.equal(h.state.scale, camera.scale); assert.equal(h.state.panX, -500000); assert.equal(h.state.panY, camera.panY);
  assert.equal(h.state.navigationLocked, true); assert.equal(h.state.viewInitialized, true); assert.equal(h.writes.length, 0);
});
test("invalid or unavailable camera storage preserves the bundle's view", () => {
  const invalid = [undefined, "{", "null", JSON.stringify({ ...camera, version:2 }), JSON.stringify({ ...camera, scale:0 }), JSON.stringify({ ...camera, scale:-1 }), JSON.stringify({ ...camera, scale:"1" }), JSON.stringify({ ...camera, panX:null }), JSON.stringify({ ...camera, navigationLocked:undefined })];
  for (const value of invalid) {
    const h = harness({ value }); assert.equal(h.state.scale, .4); assert.equal(h.state.panX, 80); assert.equal(h.state.panY, 90);
  }
  const h = harness({ unavailable:true }); h.state.panX = 300; assert.doesNotThrow(() => h.api.remember(true));
});
test("restoration uses the existing zoom limits", () => {
  assert.equal(harness({ value:JSON.stringify({ ...camera, scale:10 }) }).state.scale, 2);
  assert.equal(harness({ value:JSON.stringify({ ...camera, scale:.001 }) }).state.scale, .03);
});
test("navigation writes a small camera record after settling without revising content", () => {
  const h = harness(); h.state.panX = -1200; h.api.remember();
  assert.equal(h.writes.length, 0); assert.equal(h.timers.size, 1);
  h.state.scale = .75; h.api.remember(); assert.equal(h.timers.size, 1); h.flushTimer();
  assert.deepEqual(JSON.parse(h.storage.get(key)), { version:1, scale:.75, panX:-1200, panY:90, navigationLocked:false });
  assert.equal(h.state.userRevision, 7); h.api.remember(true); assert.equal(h.writes.length, 1);
});
test("an immediate lifecycle flush captures movement and lock before the coordinate callback", () => {
  const h = harness(); h.state.panY = 1200; h.api.remember(); h.state.panY = 1500; h.state.navigationLocked = true;
  h.api.remember(true); assert.equal(h.timers.size, 0);
  assert.equal(JSON.parse(h.storage.get(key)).panY, 1500); assert.equal(JSON.parse(h.storage.get(key)).navigationLocked, true);
});
test("an unchanged older tab does not overwrite a newer tab's camera on exit", () => {
  const h = harness({ value:JSON.stringify(camera) });
  const newer = JSON.stringify({ ...camera, panX:500 }); h.storage.set(key, newer);
  h.api.remember(); h.api.remember(true); assert.equal(h.writes.length, 0); assert.equal(h.storage.get(key), newer);
});
test("opening another document and nonlocal runtimes cannot overwrite this canvas's camera", () => {
  const h = harness(); h.state.panX = 1000; h.setActive("doc-other"); h.api.remember(true); assert.equal(h.writes.length, 0);
  h.setActive("doc-one"); h.setLocal(false); h.api.remember(true); assert.equal(h.writes.length, 0);
  h.setLocal(true); h.run.ready = false; h.api.remember(true); assert.equal(h.writes.length, 0);
});
const panelFunctions = bridge.slice(bridge.indexOf("  const projectLinesAddress ="), bridge.indexOf("  const projectLinesLocal =")) +
  bridge.slice(bridge.indexOf("  function projectLinesPanelAddress("), bridge.indexOf("  // The Canvas now belongs to this line:"));
function panelHarness({ blank = false, doc = "topics/forecast.md" } = {}) {
  const saves = [], classes = [], attrs = {}, frameAttrs = {}, cleared = [], frame = { getAttribute:key => frameAttrs[key], set src(value) { frameAttrs.src = value; } };
  const panel = { element:{ hidden:true }, frame, button:{ setAttribute:(key,value) => { attrs[key] = value; } } };
  const show = vm.runInNewContext(`${panelFunctions}\nprojectLinesPanelShow`, {
    projectLinesHost:null, projectLinesPanel:panel, projectLinesTarget:{ project:"weather", source:"files/forecast/canvas.penecho.json", doc },
    projectLinesNothingYet:() => blank, projectLinesCanSave:() => true, projectLinesSave:async options => { saves.push(options); },
    keepCanvasContentsClearOfPanel:() => { cleared.push(panel.element.hidden); }, document:{ body:{ classList:{ toggle:(key,value) => classes.push([key,value]) } } }, URLSearchParams,
  });
  return { show, panel, frameAttrs, attrs, saves, cleared };
}
test("opening the panel selects this canvas's line and toggles without reloading it", () => {
  const h = panelHarness(); h.show(true);
  assert.equal(h.panel.element.hidden, false); assert.equal(h.attrs["aria-expanded"], "true");
  assert.equal(h.frameAttrs.src, "/projects.html?embed=panel&canvas=files%2Fforecast%2Fcanvas.penecho.json#weather/line/forecast");
  h.show(false); assert.equal(h.panel.element.hidden, true); h.show(true); assert.equal(h.saves.length, 0);
  // Each time the panel comes out (and only then), the Canvas moves what it would cover.
  h.show(true); assert.deepEqual(h.cleared, [false, false]);
});
test("a blank canvas opens the new-line composer and writes nothing by opening it", () => {
  const h = panelHarness({ blank:true, doc:"" }); h.show(true); h.show(false); h.show(true);
  assert.match(h.frameAttrs.src, /#weather\/newline$/); assert.equal(h.saves.length, 0);
});
const fileFunction = bridge.slice(bridge.indexOf("  async function projectLinesFileForPanel("), bridge.indexOf("  // The Canvas now belongs to this line:"));
test("the panel's line makes the canvas a file only when the folder is behind", async () => {
  for (const [blank, behind, expected] of [[true, false, 1], [false, true, 1], [false, false, 0]]) {
    const saves = [];
    const make = vm.runInNewContext(`${fileFunction}\nprojectLinesFileForPanel`, {
      projectLinesCanSave:() => true, projectLinesNothingYet:() => blank, projectLinesBehind:() => ({ file:behind }), projectLinesSave:async options => { saves.push(options); },
    });
    await make();
    assert.equal(saves.length, expected); if (expected) assert.equal(saves[0].picture, false);
  }
});
