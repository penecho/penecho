"use strict";
// The Canvas kept open inside the Projects page: switching, leaving and Settings, without a page load to start things afresh.
require("./helpers/safety.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { parseHTML } = require("./helpers/dom.js");

const ROOT = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const bridge = read("src/client/app/project-lines-bridge.js");
const core = read("src/client/app/core.js");
const tick = () => new Promise(resolve => setImmediate(resolve));
const settle = async () => { for (let i = 0; i < 12; i++) await tick(); };
const between = (source, from, to) => {
  const start = source.indexOf(from), end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `${from} … ${to}`);
  return source.slice(start, end);
};

// ---------- The Canvas in the frame ----------
function frame({ saveFails = () => false } = {}) {
  const told = [], statuses = [], shown = [], writes = [], gets = [], listeners = [], records = new Map(), draft = new Map();
  const noop = () => {}, el = () => ({ classList:{ toggle:noop, add:noop, remove:noop }, addEventListener:noop, append:noop, setAttribute:noop, remove:noop });
  let active = "blank";
  const ctx = vm.createContext({
    URL, URLSearchParams, AbortController, encodeURIComponent, console, queueMicrotask,
    location:{ origin:"http://localhost", href:"http://localhost/index.html?shell=1", search:"" }, history:{ state:null, replaceState:noop },
    window:{ parent:{}, addEventListener:noop }, matchMedia:() => ({ matches:false }), setInterval:noop, performance:{ now:() => 0, mark:noop },
    addEventListener:(type, fn) => { if (type === "message") listeners.push(fn); },
    document:{ body:el(), createElement:el, querySelectorAll:() => [], querySelector:() => null },
    state:{ theme:"light", language:"en", images:[] },
    projectLinesInShell:true, projectLinesHost:null, projectLinesZh:() => false, projectLinesFetch:(...args) => ctx.fetch(...args),
    projectLinesShellTell:message => told.push({ ...message }), setStatus:text => statuses.push(text), projectLinesShellSyncUi:noop,
    projectLinesRememberView:noop, projectLinesRestoreView:noop, projectLinesRememberDoc:noop, projectLinesWasUnsaved:() => false, projectLinesRemember:noop,
    projectLinesBlank:() => false, projectLinesPanelPause:noop, projectLinesBindRail:() => true, projectLinesSyncLinks:noop, projectLinesSyncMoreMenu:noop,
    projectLinesRenderBreadcrumb:noop, projectLinesRenderContextStrip:noop, projectLinesBindMenuActions:noop, projectLinesEnsureMeta:noop,
    projectLinesBindSaveLabel:noop, projectLinesWatchInput:noop, projectLinesBindPanel:noop, projectLinesPanel:{}, projectLinesIntervalsWired:true, projectLinesMeta:{}, projectLinesStripState:{},
    projectLinesDestination:() => "/projects.html", projectLinesLanding:() => null, projectLinesActiveLineSlug:() => "", projectLinesShowElsewhere:noop, projectLinesTake:async () => 0,
    projectLinesSettingsHashOf:() => "", applySettingsFromStorage:noop,
    projectLinesBundle:async () => ({ key:draft.get(active) || "", name:"", source:{ from:active, ink:draft.get(active) || "" }, png:null }),
    canvasDocuments:{ records, get activeId() { return active; } }, canvasDocumentsDraft:{}, canvasDocumentsDraftKey:() => draft.get(active) || "",
    canvasDocumentsStartDraft:async () => {}, canvasDocumentsSettleDraft:async () => {}, canvasDocumentsRender:noop, setCanvasMode:noop,
    canvasAgentHash:async text => text.split(":").pop(), canvasDocumentsIsActive:doc => doc.id === active,
    canvasDocumentsRecord:(meta, stored) => ({ id:meta.documentId, stored }), canvasDocumentsPersist:async () => { await tick(); },
    canvasDocumentsShow:async id => { await tick(); active = id; shown.push(id); },
    canvasDocumentsClose:async id => { if (id !== active) throw Error("not in front"); await tick(); records.delete(id); active = "blank"; },
    readSnapshotBundle:async source => { await tick(); return { item:{ id:`snap-${source.ink}`, name:"" }, tileEntries:[] }; },
    fetch:(address, init) => {
      if (init.method === "POST") {
        const body = JSON.parse(init.body);
        if (saveFails(body)) return Promise.resolve({ ok:false, status:500, json:async () => ({ message:"The disk is full." }) });
        writes.push({ path:body.path, from:body.source.from, ink:body.source.ink });
        return Promise.resolve({ ok:true, json:async () => ({ base:"v2" }) });
      }
      const at = new URL(address, "http://localhost").searchParams.get("path");
      return new Promise((resolve, reject) => {
        const get = { path:at, answer:(exists = false) => resolve({ ok:true, json:async () => ({ exists, base:"v1", source:{ ink:at } }) }) };
        gets.push(get);
        init.signal?.addEventListener("abort", () => { get.aborted = true; reject(init.signal.reason); });
      });
    },
  });
  vm.runInContext(
    'let projectLinesTarget = null;\nconst PROJECT_LINES_GAVE_WAY = Symbol("gave way");\n' +
    between(bridge, "  const projectLinesNewRun =", "  const projectLinesUnsavedKey") +
    between(bridge, "  async function projectLinesRequest(", "  // A picture from a project") +
    between(bridge, "  async function projectLinesOpen(", "  // The picture a new Canvas") +
    between(bridge, "  async function projectLinesSave(", "  // Saves once the pen has been still") +
    between(bridge, "  async function projectLinesFlushAndDeactivate(", "  // An empty Canvas shows") +
    between(bridge, "  function projectLinesSwitchTarget(", "  async function projectLinesStart()") +
    "\nglobalThis.target = () => projectLinesTarget; globalThis.run = () => projectLinesRun; globalThis.bindHost = projectLinesBindShellHost; globalThis.leave = projectLinesLeave;", ctx);
  ctx.bindHost();
  told.length = 0;   // It says it is starting; the shell's part of that is below.
  const say = data => listeners.forEach(fn => fn({ origin:"http://localhost", source:ctx.window.parent, data:{ source:"penecho-shell", ...data } }));
  return {
    ctx, told, statuses, shown, writes, gets, draft, say,
    open:(source, requestId = `open-${source}`, handed = null) => say({ action:"open", requestId, target:{ project:"p", source, title:source }, handed }),
    answer:(source, exists) => gets.findLast(get => get.path === source).answer(exists),
    draw:ink => draft.set(active, ink),
    front:() => active,
  };
}

test("a Canvas asked for while another is loading is the one shown, and the only one written", async () => {
  const f = frame();
  f.open("one"); await settle(); f.answer("one"); await settle();
  assert.equal(f.front(), "doc-one");
  f.open("two"); await settle();
  f.open("three"); await settle();
  assert.equal(f.gets.find(get => get.path === "two").aborted, true, "Two's load is stopped");
  f.answer("three"); await settle();
  f.answer("two"); await settle();
  assert.equal(f.front(), "doc-three");
  assert.equal(f.ctx.target().source, "three");
  assert.equal(f.ctx.run().documentId, "doc-three");
  assert.equal(f.ctx.run().ready, true);
  assert.deepEqual(f.shown.filter(id => id === "doc-two"), [], "Two never shows");
  assert.deepEqual(f.told.filter(said => said.ready).map(said => [said.canvas, said.requestId]), [["one", "open-one"], ["three", "open-three"]]);
  f.draw("stroke"); f.say({ action:"leave", requestId:"leave-1" }); await settle();
  assert.deepEqual(f.writes, [{ path:"three", from:"doc-three", ink:"stroke" }]);
  assert.deepEqual(f.told.at(-1), { left:true, requestId:"leave-1" });
});

test("a new drawing opens without asking the folder for anything, on the picture it was handed", async () => {
  const f = frame(), seeds = [];
  f.ctx.projectLinesSeeded = async () => { seeds.push(f.ctx.target().picture.name); return { item:{ images:[{ id:"image-1" }] }, tileEntries:[] }; };
  f.open("fresh", "open-1", { fresh:true, picture:{ blob:{ size:3 }, name:"shot.png" } }); await settle();
  assert.equal(f.front(), "doc-fresh");
  assert.deepEqual(f.gets, []);
  assert.deepEqual(seeds, ["shot.png"]);
  assert.equal(f.ctx.run().seeded, true);
  assert.equal(f.ctx.run().base, "", "its first save still says what it started from");
  assert.deepEqual([f.ctx.target().fresh, f.ctx.target().picture], [false, null], "opened again, it is read from the folder");
  f.say({ action:"picture-saved", project:"p", canvas:"other", path:"files/_incoming/other.png" });
  assert.equal(f.ctx.target().seed, "", "another Canvas's picture is not this one's");
  f.say({ action:"picture-saved", project:"p", canvas:"fresh", path:"files/_incoming/shot.png" });
  assert.equal(f.ctx.target().seed, "files/_incoming/shot.png");
  // Anything else is read from the folder, as it always was.
  f.open("kept"); await settle();
  assert.deepEqual(f.gets.map(get => get.path), ["kept"]);
});

test("a Canvas stopped after it was already shown is let go of as itself before the next one opens", async () => {
  const f = frame();
  f.ctx.canvasDocumentsShow = (show => async id => { await show(id); if (id === "doc-two") { f.draw("recovered"); f.open("three"); } })(f.ctx.canvasDocumentsShow);
  f.open("two"); await settle(); f.answer("two"); await settle(); f.draw("recovered later"); f.answer("three"); await settle();
  assert.equal(f.front(), "doc-three");
  assert.equal(f.ctx.target().source, "three");
  assert.ok(f.writes.every(write => write.from === `doc-${write.path}`), JSON.stringify(f.writes));
});

test("leaving while a Canvas is loading stops it, and it does not come alive behind the page", async () => {
  const f = frame();
  f.open("two"); await settle();
  f.say({ action:"leave", requestId:"leave-1" }); await settle();
  assert.deepEqual(f.told, [{ left:true, requestId:"leave-1" }]);
  f.answer("two"); await settle();
  assert.equal(f.ctx.run().ready, false);
  assert.deepEqual(f.shown, []);
});

test("a Canvas that cannot be saved stays open, whether it is left, switched from or left by its own way back", async () => {
  let fails = true;
  const f = frame({ saveFails:() => fails });
  f.open("one"); await settle(); f.answer("one"); await settle(); f.draw("stroke"); f.told.length = 0;

  f.say({ action:"leave", requestId:"leave-1" }); await settle();
  assert.deepEqual(f.told, [{ stayed:true, requestId:"leave-1", error:"The disk is full.", project:"p", canvas:"one" }]);
  f.open("two"); f.open("three"); await settle();
  assert.deepEqual(f.told.slice(1), [{ stayed:true, requestId:"open-three", error:"The disk is full.", project:"p", canvas:"one" }], "only the last one asked for is answered");
  await assert.rejects(f.ctx.leave("/projects.html#p"), /disk is full/);
  assert.equal(f.told.length, 2, "nothing is left");
  assert.equal(f.front(), "doc-one");
  assert.equal(f.ctx.run().ready, true);
  assert.equal(f.ctx.target().source, "one");
  assert.match(f.statuses.at(-1), /Could not save to the project folder: The disk is full/);
  assert.deepEqual(f.gets.map(get => get.path), ["one"]);

  fails = false;
  f.open("two"); await settle(); f.answer("two"); await settle();
  assert.deepEqual(f.writes, [{ path:"one", from:"doc-one", ink:"stroke" }]);
  assert.equal(f.front(), "doc-two");
});

test("a stroke made while the Canvas is being left is saved as well", async () => {
  const f = frame({ saveFails:body => { if (body.source.ink === "first") f.draw("second"); return false; } });
  f.open("one"); await settle(); f.answer("one"); await settle(); f.draw("first");
  f.say({ action:"leave", requestId:"leave-1" }); await settle();
  assert.deepEqual(f.writes.map(write => write.ink), ["first", "second"]);
  assert.deepEqual(f.told.at(-1), { left:true, requestId:"leave-1" });
});

test("a save under way never lands in the file of a Canvas opened since", async () => {
  const f = frame();
  f.open("one"); await settle(); f.answer("one"); await settle(); f.draw("stroke");
  let bundled;
  f.ctx.projectLinesBundle = () => new Promise(resolve => { bundled = () => resolve({ key:"stroke", name:"", source:{ from:"doc-one", ink:"stroke" }, png:null }); });
  const saving = f.ctx.projectLinesSave();
  // Another Canvas comes to the front by some other way than a switch (the Library).
  await f.ctx.canvasDocumentsShow("doc-elsewhere");
  bundled();
  await assert.rejects(saving, /Another Canvas was opened/);
  assert.deepEqual(f.writes, []);
});

// ---------- The shell around it ----------
function shellPage({ narrow = false } = {}) {
  const { document, window } = parseHTML('<!doctype html><html><head></head><body><div id="app"><aside id="rail"></aside><section id="canvasStage" hidden></section></div></body></html>');
  const posted = [], toasts = [], listeners = [], loc = { href:"http://127.0.0.1:1/projects.html#p1", origin:"http://127.0.0.1:1", hash:"#p1" };
  const create = document.createElement.bind(document);
  document.createElement = tag => { const el = create(tag); if (tag === "iframe") el.contentWindow = { postMessage:msg => posted.push(msg) }; return el; };
  const S = { cur:"p1", route:{ view:"home" }, projects:[{ id:"p1" }, { id:"p2" }], data:{} };
  const ctx = vm.createContext({
    window, document, location:loc, URL, URLSearchParams, S, EMBED:null, HOSTED:null, lineProjectsHidden:false,
    history:{ pushState:(_s, _t, url) => { loc.hash = url; }, replaceState:(_s, _t, url) => { loc.hash = url; }, back() {} },
    addEventListener:(type, fn) => { if (type === "message") listeners.push(fn); },
    // The start out of sight waits for the page to be at rest; here it is at once.
    setTimeout:(fn, ms) => { if (ms === 1200) { fn(); return 0; } const t = setTimeout(fn, ms); t.unref?.(); return t; }, clearTimeout,
    navigator:{}, matchMedia:() => ({ matches:narrow }),
    summaryOf:id => S.projects.find(p => p.id === id), project:() => null, routeToHash:() => "p1", renderRail() {}, render() {}, toast:text => toasts.push(text),
    loadState:async () => false, refreshAfterChange() {},
  });
  window.top = window; window.requestIdleCallback = fn => fn();
  vm.runInContext(read("public/lines/canvas-shell.js"), ctx);
  const say = data => listeners.forEach(fn => fn({ origin:loc.origin, source:document.getElementById("canvasFrame").contentWindow, data:{ source:"penecho-canvas-shell", ...data } }));
  const ready = canvas => say({ ready:true, project:"p1", canvas });
  return { shell:window.PenEchoCanvasShell, Event:window.Event, document, S, loc, posted, toasts, say, ready, open:(source, project = "p1") => window.PenEchoCanvasShell.open({ project, source, title:source }),
    veil:() => Boolean(document.querySelector(".canvas-stage-veil:not(.is-out)")), last:action => posted.filter(msg => msg.action === action).at(-1) };
}

test("the Canvas page is started out of sight, and the first Canvas opens in it without a load", async () => {
  const p = shellPage();
  p.shell.warmSoon();
  const stage = p.document.getElementById("canvasStage"), frame = p.document.getElementById("canvasFrame");
  assert.match(frame.getAttribute("src"), /^\/index\.html\?shell=1&warm=1/);
  assert.doesNotMatch(frame.getAttribute("src"), /linesCanvas/);
  assert.equal(stage.classList.contains("is-warming"), true, "laid out, so it starts at its real size");
  assert.equal(stage.inert, true, "and it can take neither the keys nor the pointer");
  assert.equal(p.shell.active, false);
  assert.equal(p.loc.hash, "#p1");
  p.say({ ready:true, warm:true, project:"", canvas:"" });
  assert.deepEqual([stage.hidden, stage.inert, stage.classList.contains("is-warming"), p.shell.booted], [true, false, false, true]);
  assert.equal(p.document.body.classList.contains("canvas-open"), false);
  assert.deepEqual(p.posted, [], "there is nothing to let go of");
  p.shell.warmSoon();
  assert.equal(p.document.querySelectorAll("iframe").length, 1);

  const blob = { size:3 };
  await p.shell.open({ project:"p1", source:"one", title:"one", draft:true }, { fresh:true, picture:{ blob, name:"shot.png" } });
  assert.strictEqual(p.document.getElementById("canvasFrame"), frame);
  assert.equal(stage.hidden, false);
  assert.equal(p.last("open").target.source, "one");
  assert.deepEqual([p.last("open").handed.fresh, p.last("open").handed.picture.name], [true, "shot.png"]);
  assert.strictEqual(p.last("open").handed.picture.blob, blob);
  p.say({ ready:true, requestId:p.last("open").requestId, project:"p1", canvas:"one" });
  assert.equal(p.veil(), false);
  p.shell.pictureSaved("p1", "one", "files/_incoming/shot.png");
  assert.equal(p.last("picture-saved").path, "files/_incoming/shot.png");
  assert.equal(p.shell.target.seed, "files/_incoming/shot.png");
  await p.open("two");
  assert.equal(p.last("open").handed, null, "what one Canvas was handed is not the next one's");
});

test("asked for while it is still starting out of sight, a Canvas opens in that same frame", async () => {
  const p = shellPage();
  p.shell.warmSoon();
  await p.open("one");
  assert.equal(p.document.getElementById("canvasStage").classList.contains("is-warming"), false);
  assert.equal(p.last("open"), undefined);
  p.say({ ready:true, warm:true, project:"", canvas:"" });
  assert.equal(p.last("open").target.source, "one");
  assert.equal(p.veil(), true);
  p.ready("one");
  assert.equal(p.veil(), false);
  assert.equal(p.document.querySelectorAll("iframe").length, 1);
});

test("a picture is handed to a Canvas page that has started, however it was started", async () => {
  const p = shellPage();
  await p.shell.open({ project:"p1", source:"one", title:"one" }, { fresh:true, picture:{ blob:{ size:3 }, name:"shot.png" } });
  assert.match(p.document.getElementById("canvasFrame").getAttribute("src"), /warm=1/);
  p.say({ ready:true, warm:true, project:"", canvas:"" });
  assert.equal(p.last("open").handed.picture.name, "shot.png");
  // Loaded again before it had opened, it comes back with the address but not the picture: it is asked once more.
  p.say({ gone:true });
  p.ready("one");
  assert.equal(p.posted.filter(msg => msg.action === "open").length, 2);
  assert.equal(p.veil(), true);
  p.say({ ready:true, requestId:p.last("open").requestId, project:"p1", canvas:"one" });
  assert.equal(p.veil(), false);
});

test("started out of sight and no Canvas (a sign-in), the frame is dropped and the first Canvas asks afresh", async () => {
  const p = shellPage();
  p.shell.warmSoon();
  const frame = p.document.getElementById("canvasFrame");
  frame.contentWindow.projectLinesInShell = false;
  frame.dispatchEvent(new p.Event("load"));
  assert.equal(p.document.getElementById("canvasFrame"), null);
  assert.equal(p.document.getElementById("canvasStage").hidden, true);
  await p.open("one");
  assert.match(p.document.getElementById("canvasFrame").getAttribute("src"), /linesCanvas=one/);
});

test("a small window does not start the Canvas page before it is asked for", () => {
  const p = shellPage({ narrow:true });
  p.shell.warmSoon();
  assert.equal(p.document.getElementById("canvasFrame"), null);
});

test("the page kept for a reload holds no Canvas frame, which would open that Canvas a second time", () => {
  const { document } = parseHTML('<!doctype html><html><body></body></html>'), pages = read("public/lines/pages.js");
  const template = () => { const content = document.createElement("div"); return { content, get innerHTML() { return content.innerHTML; }, set innerHTML(html) { content.innerHTML = html; } }; };
  const ctx = vm.createContext({ document:{ createElement:template } });
  vm.runInContext(between(pages, "function sanitizeKeptTemplate(", "function keepPage()") + "\nglobalThis.kept = html => sanitizeKeptTemplate(html).innerHTML;", ctx);
  const html = ctx.kept('<main id="view"><p>Home</p></main><section id="canvasStage" class="canvas-stage is-warming" inert=""><iframe id="canvasFrame" src="/index.html?shell=1&amp;linesCanvas=one"></iframe></section>');
  assert.match(html, /<p>Home<\/p>/);
  assert.match(html, /<section (?=[^>]*\bhidden\b)(?=[^>]*class="canvas-stage")[^>]*><\/section>/);
  assert.doesNotMatch(html, /iframe|inert/);
});

test("asked for while the frame is still starting, a Canvas is opened as soon as it has", async () => {
  const p = shellPage();
  await p.open("one");
  await p.open("two");
  assert.equal(p.last("open"), undefined, "a frame that is starting cannot hear");
  p.ready("one");
  assert.equal(p.last("open").target.source, "two");
  assert.equal(p.veil(), true, "One is never shown under Two's address");
  p.ready("two");
  assert.equal(p.veil(), false);
  assert.equal(p.posted.filter(msg => msg.action === "open").length, 1);
});

test("an answer about a Canvas that is no longer the one asked for does not lift the veil", async () => {
  const p = shellPage();
  await p.open("one"); p.ready("one");
  await p.open("two"); await p.open("three");
  p.ready("two");
  assert.equal(p.veil(), true);
  assert.equal(p.posted.filter(msg => msg.action === "open").length, 2, "Three is already on its way");
  p.ready("three");
  assert.equal(p.veil(), false);
  p.say({ line:"old", project:"p1", canvas:"two" });
  assert.equal(p.shell.activeLine, "", "the line of the Canvas before is not this one's");
  p.say({ line:"new", project:"p1", canvas:"three" });
  assert.equal(p.shell.activeLine, "new");
});

test("a Canvas that could not be saved keeps its place: close says so, and a switch goes back", async () => {
  const p = shellPage();
  await p.open("one"); p.ready("one");
  const closing = p.shell.close();
  p.say({ stayed:true, requestId:p.last("leave").requestId, error:"The disk is full.", project:"p1", canvas:"one" });
  assert.equal(await closing, false);
  assert.equal(p.shell.active, true);
  assert.equal(p.document.getElementById("canvasStage").hidden, false);
  assert.match(p.toasts.at(-1), /could not be saved.*The disk is full/);

  await p.open("four", "p2");
  assert.equal(p.S.cur, "p2");
  p.say({ stayed:true, requestId:p.last("open").requestId, error:"The disk is full.", project:"p1", canvas:"one" });
  assert.equal(p.shell.target.source, "one");
  assert.equal(p.S.cur, "p1");
  assert.equal(p.loc.hash, "#p1/canvas/one");
  assert.match(p.document.title, /^one/);
  assert.equal(p.veil(), false);

  const again = p.shell.close();
  p.say({ left:true, requestId:p.last("leave").requestId });
  assert.equal(await again, true);
  assert.equal(p.shell.active, false);
});

test("the page you were going to waits for the Canvas, and only moves when it closed", () => {
  for (const [file, pattern] of [
    ["public/lines/main.js", /PenEchoCanvasShell\.close\(\)\.then\(closed => \{\s+if \(transition !== navigationTransition\) return;[^]*?if \(!closed\) \{ setRailGoing\(null\); return; \}/],
    ["public/lines/main.js", /const closed = await window\.PenEchoCanvasShell\.close\(\);\s+if \(transition !== navigationTransition \|\| !closed\) return;/],
    ["public/lines/pages.js", /const closed = await window\.PenEchoCanvasShell\.close\(\{ refresh:false \}\);\s+if \(transition !== navigationTransition\) return;\s+if \(!closed\) \{ railGoing\(null\); return; \}/],
    ["public/lines/desktop-menu.js", /close\(\)\.then\(closed => \{ if \(closed\) ACT\['new-project'\]\(\); \}\)/],
  ]) assert.match(read(file), pattern, file);
});

test("a frame that is loaded again is asked once more when it has started, and a leave does not wait for it", async () => {
  const p = shellPage();
  await p.open("one"); p.ready("one");
  const closing = p.shell.close();
  p.say({ gone:true });
  assert.equal(await closing, true);
  await p.open("three");
  assert.equal(p.last("open"), undefined);
  p.ready("one");
  assert.equal(p.last("open").target.source, "three");

  // Its goodbye can be lost with the page that said it. The new page says the same as it starts.
  p.ready("three");
  await p.open("four");
  p.say({ gone:true });
  p.ready("three");
  assert.equal(p.posted.filter(msg => msg.action === "open" && msg.target.source === "four").length, 2, "what was asked of the page that went is asked again");
});

test("a page in the frame that is no Canvas does not hold up leaving", async () => {
  const p = shellPage();
  await p.open("one"); p.ready("one");
  const frame = p.document.getElementById("canvasFrame"), closing = p.shell.close();
  frame.contentWindow.projectLinesInShell = false;
  frame.dispatchEvent(new p.Event("load"));
  assert.equal(await closing, true);
});

test("closed while its frame was starting, a Canvas is let go of again", async () => {
  const p = shellPage();
  await p.open("one");
  assert.equal(await p.shell.close(), true);
  p.ready("one");
  assert.equal(p.last("leave").requestId, "");
  assert.equal(p.shell.active, false);
});

// ---------- Settings ----------
test("a Canvas that is never loaded again reads every setting the Settings pages write", () => {
  const stored = new Map(Object.entries({
    "penecho-language":"zh", "penecho-canvas-page-scale":"1.2", "penecho-grid":"true", "penecho-grid-style":"lines", "penecho-wheel-zoom":"true", "penecho-auto-delay-ms":"2000",
    "penecho-auto-ai":"true", "penecho-summon-enabled":"false", "penecho-canvas-hints-enabled":"false", "penecho-widget-shadow":"true", "penecho-ai-font":"serif",
    "penecho-illustration-style":"3d", "penecho-illustration-background":"none", "penecho-ai-effort":"low", "penecho-smart-suggestions":"false", "penecho-pen-intelligence":'{"gestures":false}',
  }));
  const calls = [], call = (name, change = () => {}) => (...args) => { calls.push(name); change(...args); };
  const state = { language:"en", pageScale:1, gridVisible:true, gridStyle:"dots", wheelZoom:false, autoDelayMs:5000, autoPreference:false, summonEnabled:true, canvasHintsEnabled:true, widgetShadowEnabled:false, aiFont:"rounded", illustrationStyle:"storybook", illustrationBackground:"auto", reasoningEffort:"medium" };
  const smartSuggest = { enabled:true }, pen = { gestures:true, stepCheck:true };
  const ctx = vm.createContext({
    localStorage:{ getItem:key => stored.get(key) ?? null, setItem:(key, value) => stored.set(key, value) }, state, smartSuggest,
    window:{ PenEchoPageScale:{ syncFromStorage() {
      const next = Number(stored.get("penecho-canvas-page-scale") || 1);
      if (state.pageScale !== next) { state.pageScale = next; calls.push("scale"); }
    } } },
    AI_FONT_STORAGE_KEY:"penecho-ai-font", ILLUSTRATION_STYLE_STORAGE_KEY:"penecho-illustration-style", ILLUSTRATION_BACKGROUND_STORAGE_KEY:"penecho-illustration-background", SMART_SUGGEST_STORAGE_KEY:"penecho-smart-suggestions",
    GRID_PREFERENCE_VERSION_KEY:"v", GRID_PREFERENCE_VERSION:"1",
    applyLanguage:call("language"), updateGridButton:call("grid"), requestRender() {}, updateAutoControl:call("delay"), updateEffortControl:call("effort"),
    setWheelZoom:value => { if (value !== state.wheelZoom) { calls.push("wheel"); state.wheelZoom = value; } },
    setAutoEnabled:call("auto", value => { state.autoPreference = value; }), setSummonEnabled:call("summon", value => { state.summonEnabled = value; }), setCanvasHintsEnabled:call("hints", value => { state.canvasHintsEnabled = value; }), setWidgetShadowEnabled:call("shadow", value => { state.widgetShadowEnabled = value; }),
    normalizeAiFont:value => value || "rounded", setAiFont:call("font", value => { state.aiFont = value; }),
    PenEchoIllustrationStyle:{ normalize:value => value || "storybook", normalizeBackground:value => value || "auto" }, setIllustrationStyle:call("style", value => { state.illustrationStyle = value; }), setIllustrationBackground:call("background", value => { state.illustrationBackground = value; }),
    normalizeToolbarReasoningEffort:value => value || "", setSmartSuggestEnabled:call("suggestions", value => { smartSuggest.enabled = value; }),
    penIntelStoredSettings:() => ({ gestures:true, stepCheck:true, ...JSON.parse(stored.get("penecho-pen-intelligence") || "{}") }), penIntelSetting:name => pen[name], setPenIntelSetting:call("pen", (name, value) => { pen[name] = value; }),
    mcpSyncWakeLock:async () => {}, mcpRenderSettings() {}, renderConnectionLists() {}, syncLocalConnectionSelection() {}, canvasAgentConnectionDidChange() {}, loadCanvasSettings:call("keys and models"),
  });
  stored.set("v", "1");
  vm.runInContext(between(core, "  function loadCanvasGridPreference()", "  function normalizeAiFont(") + between(core, "  function applySettingsFromStorage()", "  window.PenEchoOpenSettingsPage"), ctx);
  ctx.applySettingsFromStorage();
  assert.deepEqual(calls.sort(), ["auto", "background", "delay", "effort", "font", "grid", "hints", "keys and models", "language", "pen", "scale", "shadow", "style", "suggestions", "summon", "wheel"]);
  assert.equal(state.language, "zh");
  assert.equal(state.pageScale, 1.2);
  assert.equal(state.gridStyle, "lines");
  assert.equal(state.autoDelayMs, 2000);
  assert.equal(pen.gestures, false);
  calls.length = 0;
  ctx.applySettingsFromStorage();
  assert.deepEqual(calls, ["keys and models"], "what has not changed is left alone");
  stored.clear(); stored.set("v", "1"); calls.length = 0;
  ctx.applySettingsFromStorage();
  assert.equal(state.language, "zh", "a language never chosen stays what it is");
  assert.equal(state.autoDelayMs, 2000);
});

test("every Canvas setting the Settings pages write is one the open Canvas reads again", () => {
  const settings = read("public/lines/settings.js"), reads = between(core, "  function applySettingsFromStorage()", "  window.PenEchoOpenSettingsPage") + between(core, "  function loadCanvasGridPreference()", "  function normalizeAiFont(");
  const keys = new Set([...settings.matchAll(/lsSet\('(penecho-[a-z-]+)'/g)].map(match => match[1]));
  assert.ok(keys.size >= 15, [...keys].join(" "));
  const named = { "penecho-ai-font":"AI_FONT_STORAGE_KEY", "penecho-illustration-style":"ILLUSTRATION_STYLE_STORAGE_KEY", "penecho-illustration-background":"ILLUSTRATION_BACKGROUND_STORAGE_KEY", "penecho-smart-suggestions":"SMART_SUGGEST_STORAGE_KEY", "penecho-pen-intelligence":"penIntelStoredSettings", "penecho-mcp-keep-awake":"mcpSyncWakeLock" };
  for (const key of keys) assert.ok(reads.includes(`"${key}"`) || reads.includes(named[key] || "\0"), `${key} is written in Settings and not read by applySettingsFromStorage`);
  assert.match(bridge, /if \(msg\.action === "sync-settings"\) applySettingsFromStorage\(\);/);
});

// ---------- Bundles ----------
test("a commit's Lines bundles are built from that commit's own sources", { skip:!fs.existsSync(path.join(ROOT, ".git")) }, () => {
  const generator = execFileSync("git", ["show", "HEAD:scripts/build-lines.cjs"], { cwd:ROOT });
  execFileSync(process.execPath, ["-", "--check", "--ref", "HEAD"], { cwd:path.join(ROOT, "scripts"), input:generator, stdio:"pipe" });
});

test("bundles built for a commit carry what is staged, not other work in the folder", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-lines-staged-"));
  try {
    const { CSS_SOURCES, HEAD_JS_SOURCES, BODY_JS_SOURCES } = require("../scripts/build-lines.cjs");
    for (const file of ["scripts/build-lines.cjs", ...CSS_SOURCES, ...HEAD_JS_SOURCES, ...BODY_JS_SOURCES]) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive:true });
      fs.copyFileSync(path.join(ROOT, file), path.join(dir, file));
    }
    fs.symlinkSync(path.dirname(path.dirname(require.resolve("esbuild/package.json"))), path.join(dir, "node_modules"));
    const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args], { cwd:dir, encoding:"utf8", stdio:["ignore", "pipe", "pipe"], maxBuffer:64 << 20 });
    const build = (...args) => { try { return { out:execFileSync(process.execPath, ["scripts/build-lines.cjs", ...args], { cwd:dir, encoding:"utf8", stdio:["ignore", "pipe", "pipe"] }), code:0 }; } catch (error) { return { out:String(error.stderr), code:error.status }; } };
    build();
    git("init", "-q"); git("add", "public", "scripts"); git("commit", "-qm", "start");
    assert.equal(build("--check", "--ref", "HEAD").code, 0);

    // Someone else's unfinished work, and mine, in one folder. The folder's own bundles hold both.
    fs.appendFileSync(path.join(dir, "public/lines/find.js"), "\nwindow.unfinishedElsewhere = 1;\n");
    fs.appendFileSync(path.join(dir, "public/lines/main.js"), "\nwindow.mineForThisCommit = 1;\n");
    assert.equal(build().code, 0);
    git("add", "public/lines/main.js", "public/lines/bundle.js", "public/projects.html");
    const wrong = build("--check", "--staged");
    assert.equal(wrong.code, 1);
    assert.match(wrong.out, /npm run build:lines -- --staged/);

    const folder = fs.readFileSync(path.join(dir, "public/lines/bundle.js"), "utf8");
    assert.equal(build("--staged").code, 0);
    assert.equal(build("--check", "--staged").code, 0);
    git("commit", "-qm", "mine");
    const committed = git("show", "HEAD:public/lines/bundle.js");
    assert.match(committed, /mineForThisCommit/);
    assert.doesNotMatch(committed, /unfinishedElsewhere/);
    assert.equal(build("--check", "--ref", "HEAD").code, 0);
    assert.equal(fs.readFileSync(path.join(dir, "public/lines/bundle.js"), "utf8"), folder, "the folder keeps its own bundles");
    assert.equal(build("--check").code, 0);
  } finally { fs.rmSync(dir, { recursive:true, force:true }); }
});
