"use strict";
require("./helpers/safety.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const bridge = read("src/client/app/project-lines-bridge.js");
const cover = read("public/project-lines-cover.js");
const bootstrap = read("src/client/app/ui-bootstrap.js");
const target = { project:"project a", source:"files/a.penecho.json", doc:"lines/a.md", title:"Picture" };
const query = `?${new URLSearchParams({ path:target.source, doc:target.doc })}`;
const url = `/api/lines/projects/project%20a/canvas${query}`;
const search = `?${new URLSearchParams({ linesProject:target.project, linesCanvas:target.source, linesDoc:target.doc })}`;
const response = (data, status = 200) => ({ ok:status < 400, status, json:async () => data });
const turn = () => new Promise(resolve => setImmediate(resolve));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const prefetchSource = source => source.slice(0, source.indexOf("// Opened on its own"));
const requestSource = source => source.slice(source.indexOf("  async function projectLinesRequest("), source.indexOf("  // A picture from a project"));
const openSource = source => source.slice(source.indexOf("  async function projectLinesOpen("), source.indexOf("  // The picture a new Canvas"));
function lifecycleSource(source) {
  const marker = source.indexOf("  // Editing a picture needs");
  return source.slice(marker < 0 ? source.indexOf('  window.addEventListener("load",') : marker);
}
function harness({ source = bridge, info = { exists:true, source:{ name:"On disk" }, base:"disk-version" }, existing = false, unsaved = false } = {}) {
  const calls = [], records = new Map(), selected = { id:"doc-selected", stored:{ item:{ name:"Unsaved work" } } };
  if (existing) records.set(selected.id, selected);
  const context = vm.createContext({
    URLSearchParams, encodeURIComponent, window:{}, projectLinesTarget:{ ...target }, projectLinesRun:{ ready:false },
    projectLinesZh:() => false, fetch:async (address, options) => { calls.push(["fetch", address, options]); return response(info); },
    canvasDocuments:{ records, activeId:"blank" }, canvasDocumentsDraft:{ savedKey:"" }, state:{ theme:"light" },
    canvasDocumentsStartDraft:async restore => { calls.push(["draft", restore]); },
    canvasDocumentsSettleDraft:async (...args) => { calls.push(["settle", ...args]); },
    canvasAgentHash:async () => "selected", projectLinesRememberDoc:id => calls.push(["remember", id]),
    projectLinesWasUnsaved:() => unsaved, projectLinesUnsavedBase:() => "unsaved-base",
    canvasDocumentsIsActive:doc => doc.id === context.canvasDocuments.activeId,
    canvasDocumentsClose:async id => { calls.push(["close", id]); records.delete(id); },
    readSnapshotBundle:async bundle => { calls.push(["decode", bundle]); return { item:{ ...bundle, id:"snapshot-1" }, tileEntries:[] }; },
    projectLinesSeeded:async () => { calls.push(["seed"]); return { item:{ images:[{ id:"seed" }] }, tileEntries:[] }; },
    canvasDocumentsRecord:(meta, stored) => ({ ...meta, id:meta.documentId, stored }),
    canvasDocumentsPersist:async doc => calls.push(["persist", doc.id]),
    canvasDocumentsShow:async id => { calls.push(["show", id]); context.canvasDocuments.activeId = id; },
    canvasDocumentsDraftKey:() => "selected-key", canvasDocumentsRender:() => {},
    projectLinesRestoreView:() => calls.push(["view"]), projectLinesRememberView:() => {}, setCanvasMode:mode => calls.push(["mode", mode]),
  });
  vm.runInContext(bridge.slice(bridge.indexOf("  const projectLinesHost ="), bridge.indexOf("  const projectLinesLocal =")) + requestSource(source) + openSource(source), context);
  return { context, calls, selected, records };
}
function lifecycle(context, source = bridge, { readyState = "loading", local = true, hasTarget = true } = {}) {
  const events = new Map();
  const listen = (name, fn, options) => {
    const list = events.get(name) || []; list.push({ fn, once:options?.once }); events.set(name, list);
  };
  context.projectLinesTarget = hasTarget ? context.projectLinesTarget || target : null;
  context.projectLinesLocal = () => local;
  context.projectLinesBindRail = () => {};
  context.document = { readyState, addEventListener:listen, documentElement:{ classList:{ contains:() => false } } };
  context.window.addEventListener = listen;
  context.queueMicrotask = queueMicrotask;
  vm.runInContext(lifecycleSource(source), context);
  return name => {
    const list = events.get(name) || [];
    events.set(name, list.filter(listener => !listener.once));
    list.forEach(listener => listener.fn());
  };
}

test("the page starts one authenticated read of the exact selected Canvas before editor boot", async () => {
  const h = harness(); h.context.location = { search };
  vm.runInContext(prefetchSource(cover), h.context);
  assert.equal(h.calls[0][1], url);
  assert.equal(h.calls[0][2].credentials, "same-origin");
  await h.context.projectLinesOpen();
  assert.equal(h.calls.filter(call => call[0] === "fetch").length, 1);
  assert.equal(h.context.window.projectLinesCanvasLoad, null);
  assert.equal(h.context.projectLinesRun.ready, true);
  assert.equal(h.context.canvasDocumentsDraft.savedKey, "selected-key");
  await h.context.projectLinesRequest(query);
  assert.equal(h.calls.filter(call => call[0] === "fetch").length, 2, "later reads must be fresh");
});

test("prefetch stays out of ordinary, Viewer, Cloud and browser-draft startup", () => {
  for (const [config, address] of [[{}, ""], [{ runtime:"viewer" }, search], [{ runtime:"cloud" }, search], [{ browserDraftId:"b" }, search], [{ guestCanvas:true }, search]]) {
    const h = harness(); h.context.location = { search:address }; h.context.window.PENECHO_CONFIG = config;
    vm.runInContext(prefetchSource(cover), h.context);
    assert.equal(h.calls.length, 0);
  }
});

test("a failed early network read retries normally; an HTTP error retains its code", async () => {
  const h = harness(); h.context.location = { search };
  const fetch = h.context.fetch; h.context.fetch = async () => { throw Error("offline"); };
  vm.runInContext(prefetchSource(cover), h.context);
  await turn(); h.context.fetch = fetch;
  await h.context.projectLinesRequest(query);
  assert.equal(h.calls.length, 1);
  h.context.window.projectLinesCanvasLoad = { url, response:Promise.resolve(response({ code:"NOT_FOUND", message:"Missing Canvas" }, 404)) };
  await assert.rejects(h.context.projectLinesRequest(query), { message:"Missing Canvas", code:"NOT_FOUND", status:404 });
  assert.equal(h.calls.length, 1, "do not conceal a server error with another read");
});

test("a prefetched response cannot replace a different read or a save", async () => {
  const h = harness(); h.context.window.projectLinesCanvasLoad = { url, response:Promise.resolve(response({ early:true })) };
  await h.context.projectLinesRequest("?path=elsewhere");
  await h.context.projectLinesRequest("", { path:target.source, base:"v1" });
  assert.equal(h.calls[1][2].method, "POST");
  assert.ok(h.context.window.projectLinesCanvasLoad);
  assert.equal((await h.context.projectLinesRequest(query)).early, true);
  assert.equal(h.calls.length, 2);
});

test("editing opens before window load even if the sidebar or a preview never finishes", async () => {
  const h = harness(); let opening;
  h.context.projectLinesStart = () => { opening = h.context.projectLinesOpen(); };
  const dispatch = lifecycle(h.context);
  assert.equal(opening, undefined);
  dispatch("DOMContentLoaded"); await opening;
  assert.equal(h.context.projectLinesRun.ready, true);
  dispatch("load"); dispatch("DOMContentLoaded");
  assert.equal(h.calls.filter(call => call[0] === "show").length, 1);
  assert.equal(h.calls.find(call => call[0] === "draft")[1], false);
});

test("an already parsed editor starts once, while ordinary and nonlocal startup keep their load gate", async () => {
  const h = harness(); let starts = 0; h.context.projectLinesStart = () => { starts++; };
  const dispatch = lifecycle(h.context, bridge, { readyState:"complete" });
  await turn(); dispatch("load"); assert.equal(starts, 1);
  for (const options of [{ hasTarget:false }, { local:false }]) {
    const other = harness(); let calls = 0; other.context.projectLinesStart = () => { calls++; };
    const fire = lifecycle(other.context, bridge, options);
    fire("DOMContentLoaded"); assert.equal(calls, 0); fire("load"); assert.equal(calls, 1);
  }
});

test("selected unsaved edits and their conflict base survive the direct open", async () => {
  const h = harness({ existing:true, unsaved:true });
  await h.context.projectLinesOpen();
  assert.equal(h.records.get("doc-selected"), h.selected);
  assert.equal(h.context.projectLinesRun.base, "unsaved-base");
  assert.equal(h.context.projectLinesRun.savedKey, "");
  assert.equal(h.calls.some(call => ["decode", "persist", "close"].includes(call[0])), false);
  assert.deepEqual(h.calls.filter(call => call[0] === "show"), [["show", "doc-selected"]]);
  assert.equal(h.calls.at(-1)[0], "view");
});

test("a clean saved copy refreshes from disk; a new picture still seeds an editable draft", async () => {
  const saved = harness({ existing:true }); await saved.context.projectLinesOpen();
  assert.notEqual(saved.records.get("doc-selected"), saved.selected);
  assert.equal(saved.records.get("doc-selected").stored.item.name, "On disk");
  assert.equal(saved.context.projectLinesRun.base, "disk-version");
  const fresh = harness({ info:{ exists:false } }); Object.assign(fresh.context.projectLinesTarget, { seed:"files/photo.png", draft:true });
  await fresh.context.projectLinesOpen();
  assert.equal(fresh.context.projectLinesRun.seeded, true);
  assert.ok(fresh.calls.some(call => call[0] === "seed"));
  assert.ok(fresh.calls.some(call => call[0] === "mode" && call[1] === "pen"));
});

test("local project boot skips Library and previous-canvas rendering without changing other routes", async () => {
  const guard = bootstrap.match(/if \(window\.PENECHO_CONFIG\?\.runtime !== "viewer"[^;{}]*?refreshSnapshots\(\)\.catch\(\(\) => \{\}\);/)[0];
  const draft = bootstrap.slice(bootstrap.indexOf("  const localFolderPage="), bootstrap.indexOf("  requestAnimationFrame(() => {", bootstrap.indexOf("  const localFolderPage=")));
  for (const [config, selected, expectedHistory, expectedRestore] of [
    [{}, true, 0, false], [{}, false, 1, true], [{ runtime:"cloud", remoteCanvasNativeReads:true }, true, 0, false],
    [{ browserDraftId:"draft" }, true, 1, true], [{ runtime:"viewer" }, true, 0, undefined],
  ]) {
    let history = 0, restore;
    const c = { window:{ PENECHO_CONFIG:config }, location:{ search:"" }, URLSearchParams,
      projectLinesTarget:selected ? target : null,
      projectLinesLocal:() => !["cloud", "viewer"].includes(config.runtime) && !config.browserDraftId,
      refreshSnapshots:async () => { history++; }, canvasDocumentsStartDraft:async value => { restore = value; },
    };
    vm.runInNewContext(guard + draft, c); await turn();
    assert.equal(history, expectedHistory); assert.equal(restore, expectedRestore);
  }
});

// Optional before/after experiment using a captured pre-edit source, not git HEAD
// (the shared tree can already contain other work). These are controlled resource
// delays, not browser paint timings: DOM at 50 ms, preview/iframe load at 1000 ms,
// Canvas response in 150 ms and Canvas activation in 20 ms.
if (process.env.PENECHO_CANVAS_LOAD_BASELINE) test("controlled before/after opening latency", async t => {
  async function measure(source, early) {
    const h = harness({ source }), started = performance.now();
    const fetch = h.context.fetch;
    h.context.fetch = async (...args) => { await pause(150); return fetch(...args); };
    h.context.canvasDocumentsShow = async () => { await pause(20); };
    h.context.location = { search };
    vm.runInContext(prefetchSource(early), h.context);
    let finish; const done = new Promise(resolve => { finish = resolve; });
    h.context.projectLinesStart = async () => { await h.context.projectLinesOpen(); finish(performance.now() - started); };
    const dispatch = lifecycle(h.context, source);
    const dom = setTimeout(() => dispatch("DOMContentLoaded"), 50), load = setTimeout(() => dispatch("load"), 1000);
    try { return await done; } finally { clearTimeout(dom); clearTimeout(load); }
  }
  const beforeDir = process.env.PENECHO_CANVAS_LOAD_BASELINE;
  const before = await measure(fs.readFileSync(path.join(beforeDir, "project-lines-bridge.js"), "utf8"), fs.readFileSync(path.join(beforeDir, "project-lines-cover.js"), "utf8"));
  const after = await measure(bridge, cover);
  t.diagnostic(JSON.stringify({ controlled:true, beforeMs:Math.round(before), afterMs:Math.round(after), reductionPercent:Math.round((1 - after / before) * 100) }));
  assert.ok(after < before / 2);
});

test("a Canvas whose picture is behind draws it again once you are still, and sends only the picture", async () => {
  const opened = harness({ info:{ exists:true, source:{ name:"On disk" }, base:"v1", behind:true } });
  await opened.context.projectLinesOpen();
  assert.equal(opened.context.projectLinesRun.redraw, true);
  const whole = harness();
  await whole.context.projectLinesOpen();
  assert.equal(whole.context.projectLinesRun.redraw, false);

  const redraw = bridge.slice(bridge.indexOf("  function projectLinesAutosave("), bridge.indexOf("  // Going to another window"));
  const renderPicture = bridge.slice(bridge.indexOf("  function projectLinesRenderPicture("), bridge.indexOf("  // This Canvas as the folder keeps it:"));
  const page = () => {
    const sent = [], saves = [], run = { redraw:true, inputAt:0, saving:null, base:"v1" };
    let now = 100000, key = "k", drawing = null;
    const context = vm.createContext({
      performance:{ now:() => now }, document:{ hidden:false }, state:{ drawing:false, images:[] }, projectLinesRun:run, projectLinesTarget:{ source:"files/a.penecho.json" },
      PROJECT_LINES_IDLE_MS:2500, PROJECT_LINES_PICTURE_IDLE_MS:6000, PROJECT_LINES_PICTURE_PIXELS:1,
      projectLinesCanSave:() => true, projectLinesNothingYet:() => false, projectLinesInFront:() => true, projectLinesBehind:() => ({ file:key !== "k", picture:key !== "k" }),
      canvasDocumentsDraftKey:() => key, renderExportCanvas:async () => { await drawing?.(); return {}; }, projectLinesPng:async () => "data:image/png;base64,AA", projectLinesSources:() => ({ w:"h" }),
      projectLinesSave:async options => { saves.push(options); }, projectLinesRequest:async (query, body) => { sent.push(body); },
    });
    vm.runInContext(renderPicture + redraw, context);
    const look = async ms => { now += ms; context.projectLinesAutosave(); await turn(); await turn(); };
    return { run, sent, saves, look, during:fn => { drawing = fn; }, edit:() => { key = "edited"; }, input:() => { run.inputAt = now + 1; } };
  };
  const still = page();
  await still.look(500);
  await still.look(5000);
  assert.equal(still.sent.length, 0, "not while the Canvas has only just opened");
  await still.look(1000);
  assert.deepEqual(JSON.parse(JSON.stringify(still.sent)), [{ path:"files/a.penecho.json", redraw:true, png:"data:image/png;base64,AA", base:"v1", sources:{ w:"h" } }], "the picture, and nothing of the Canvas");
  await still.look(9000);
  assert.equal(still.sent.length, 1, "once");
  assert.equal(still.saves.length, 0, "opening a Canvas saves nothing on it");
  // Moved about meanwhile: it waits. Changed meanwhile: the save that follows brings its picture.
  const moved = page();
  moved.during(() => moved.input());
  await moved.look(500); await moved.look(6500);
  assert.equal(moved.sent.length, 0);
  moved.during(null);
  await moved.look(6500);
  assert.equal(moved.sent.length, 1);
  const edited = page();
  edited.during(() => edited.edit());
  await edited.look(500); await edited.look(6500);
  assert.equal(edited.sent.length, 0, "a picture older than the Canvas is not sent");
  await edited.look(500);
  assert.equal(edited.saves.length, 1);
});
