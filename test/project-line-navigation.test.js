"use strict";
// Exercise the actual browser routing functions without requiring a local port or a browser process.
const { test } = require("node:test"), assert = require("node:assert/strict"), vm = require("node:vm");
const fs = require("node:fs"), path = require("node:path");
const { parseHTML } = require("./helpers/dom.js");
const read = name => fs.readFileSync(path.join(__dirname, "../public/lines", name), "utf8");
const main = read("main.js");
const hashHandler = main.slice(main.indexOf("  addEventListener('hashchange'"), main.indexOf("  addEventListener('resize'"));
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function setup({ stored = {}, hash = "#a/line/one/work-1", storageFails = false } = {}) {
  const items = new Map(Object.entries(stored)), classes = new Set(), nodes = {}, events = {};
  for (const key of ['#app', '#linePage', '#lpScroll', '#lpList', '#lppScroll']) nodes[key] = { scrollTop:0, innerHTML:"" };
  nodes['#view'] = parseHTML('<html><body><main id="view"></main></body></html>').document.querySelector('#view');
  nodes['#view'].scrollTop = 0;
  const storage = { getItem:key => { if (storageFails) throw Error("No storage"); return items.get(key) || null; }, setItem:(key, value) => { if (storageFails) throw Error("No storage"); items.set(key, value); }, removeItem:key => items.delete(key) };
  const fixtureState = { cur:"a", route:{ view:"line", line:"one", step:"work-1" }, tabs:["a"], routes:Object.create(null), projects:["a", "b", "c"].map(id => ({ id, lastOpenedAt:0 })), comp:{}, data:{} };
  for (const { id } of fixtureState.projects) fixtureState.data[id] = { id, name:id, files:[{ path:"notes.md" }], landed:[], backlog:[], lines:[{ id:"one", slug:"one", stations:[{ id:"work-1" }, { id:"work-2" }] }] };
  const context = { fixtureState, nodes, items, classes, events, console, Object, Map, Set, Date, Promise, JSON, encodeURIComponent, decodeURIComponent,
    LINE_STATUS:require("../public/lines/line-status.js"), navigator:{ platform:"" }, performance, zoomEnds:0,
    localStorage:storage, sessionStorage:storage,
    location:{ get hash() { return hash; }, set hash(value) { hash = value; context.history.state = null; } },
    history:{ state:null, replaceState(state, _title, value) { hash = value; this.state = state; } },
    document:{ addEventListener() {}, documentElement:{ addEventListener() {} }, body:{ classList:{ add:key => classes.add(key), remove:(...keys) => keys.forEach(k => classes.delete(k)), toggle:(key, on) => on ? classes.add(key) : classes.delete(key) } } }, window:{},
    $:(selector, _root) => nodes[selector] || null, $$:() => [], Pano:{ sheet:null }, SHEET:null, ACT:{}, SEND:{}, CSS:{ escape:x => x },
    loadState:async () => {}, api:async () => ({}), finishEdit:async () => true,
    endFlight:() => {}, closeMenu:() => {}, flightToLine:() => null, flightToHome:() => null, readOpenedLine:() => {}, unmountLine:() => {}, hideStopCard:() => {}, homeShape:() => "code", showRow:() => {},
    refreshChrome:() => vm.runInContext("refreshProjectsVisibility()", context), spyLine:() => {}, toast:() => {}, ic:() => "",
    addEventListener:(key, fn) => { events[key] = fn; }, clearTimeout() {}, setTimeout() {}, setInterval() {}, pollActivity:() => {}, bindGlobal:() => {}, wireDrop:() => {}, restoreBoxes:() => {}, loadProjects:async () => {}, loadAgents:async () => {}, checkAgents:() => {}, applyRoles:() => {}, boxUrls:() => {}, takeDrawing:async () => {},
  };
  // The Settings window (settings.js) opens over the page: these addresses leave the page beneath as it was.
  Object.assign(context, { EMBED:null, HOSTED:false, embedRailOnly:() => false, embedKeeps:() => true, embedShown:() => {}, hostedAddress:() => {}, hostedBoot:() => {}, renderSettingsModal:() => { context.modal = context.S.shelfPage; }, dropSettingsModal:() => { context.modal = null; }, renderRail:() => {}, refreshAfterChange:() => {} });
  context.document.getElementById = id => (id === 'sysModal' && context.modal ? {} : null);
  vm.createContext(context);
  const boundary = Object.fromEntries(["loadState", "api", "readOpenedLine", "loadProjects", "loadAgents", "applyRoles", "renderSettingsModal", "dropSettingsModal", "renderRail"].map(name => [name, context[name]]));
  for (const file of ["state.js", "pages.js", "settings.js", "navigation.js"]) vm.runInContext(read(file), context, { filename:file });
  Object.assign(context, boundary);
  context.S = vm.runInContext("Object.assign(S, fixtureState)", context);
  for (const view of ['home', 'topicsPage', 'canvases', 'newLine', 'stats', 'memory', 'vault', 'find', 'archive', 'deleted', 'settings', 'line', 'doc', 'markup']) context[view + 'HTML'] = () => view;
  vm.runInContext(main.replace(/^boot\(\);$/m, ""), context, { filename:"main.js" });
  vm.runInContext("afterRender = () => {}; bindGlobal = () => {};", context);
  vm.runInContext(hashHandler, context);
  context.run = code => vm.runInContext(code, context);
  return context;
}

test("Back returns Orchestrator Line and Work visits to their session list", () => {
  const c = setup(), line = read("line.js"), orch = read("orchestrator.js");
  Object.assign(c, { esc:String, zoomIn:() => {}, selectedStep:() => null, boxWords:() => "", STATE_COLOR:{},
    av:() => "", plainOut:String, reviewProgress:() => "", listHTML:() => "", lineHeadHTML:() => "", threadHTML:() => "" });
  c.run(read("composer.js"));
  c.composerHTML = () => "";
  c.run(orch);
  c.run(line.slice(line.indexOf("function lineDockHTML("), line.indexOf("function newLineHTML(")));
  c.run(line.slice(line.indexOf("ACT['line-back']"), line.indexOf("ACT['line-fold']")));
  c.run(line.slice(line.indexOf("ACT['open-line'] ="), line.indexOf("const STARTS")));
  c.S.data.a.lines.push({ id:"child", stations:[] });
  c.session = { line:"one", title:"Plan", report:"Finished", reportWork:"work-1", lines:[{ line:"child", title:"Build", works:[] }] };
  c.run("VIEWS.line = lineHTML; VIEWS.orchestrator = p => orchSessionCard(p, session, 'done')");
  const view = c.nodes['#view'];
  const button = selector => view.querySelector(selector);
  const activate = el => c.ACT[el.dataset.act](el);
  c.run("go({view:'orchestrator'})");
  for (const [selector, id, step] of [['.orch-title', 'one'], ['.orch-line-t', 'child'], ['.orch-report', 'one', 'work-1']]) {
    view.scrollTop = 370;
    activate(button(selector));
    assert.equal(c.S.route.line, id);
    assert.equal(c.S.route.step, step);
    c.S.route.step = step ? 'work-2' : undefined;
    c.run("syncHash(true); render()");
    if (step) c.run("go({view:'doc', doc:'notes.md'}); ACT['doc-back']()");
    const back = button('.lp-back');
    activate(back);
    assert.equal(c.location.hash, '#a/orchestrator');
    assert.equal(back.textContent, 'Orchestrator');
    assert.ok(button(selector));
    assert.equal(view.scrollTop, 370);
  }
  c.run("go({view:'home'}); ACT['open-line']({ dataset:{line:'one'} })");
  const back = button('.lp-back');
  assert.equal(back.textContent, c.S.data.a.name);
  activate(back);
  assert.equal(c.location.hash, '#a');
});

test("switching projects restores each line and selected Work, including same-current navigation", async () => {
  const c = setup();
  c.S.routes.b = { view:"line", line:"one", step:"work-2" };
  await c.run("switchProject('b')");
  assert.equal(c.S.cur, "b"); assert.deepEqual(plain(c.S.route), { view:"line", line:"one", step:"work-2" });
  await c.run("switchProject('a')");
  assert.deepEqual(plain(c.S.route), { view:"line", line:"one", step:"work-1" });
  await c.run("switchProject('b', { view:'settings' })");
  assert.deepEqual(plain(c.S.route), { view:"settings" });
});

test("step changes with an unchanged hash are persisted; unrelated route fields are discarded", () => {
  const c = setup();
  c.S.route.privateText = "never persist";
  c.run("syncHash(true)");
  assert.deepEqual(JSON.parse(c.items.get("penecho-lines")).routes.a, { view:"line", line:"one", step:"work-1" });
  c.S.route.step = "work-2"; c.run("syncHash(true)");
  assert.equal(JSON.parse(c.items.get("penecho-lines")).routes.a.step, "work-2");
});

test("project selection restores reading positions and the explicit closed-panel choice", async () => {
  const c = setup();
  c.nodes['#lpScroll'].scrollTop = 280; c.nodes['#lpList'].scrollTop = 35; c.nodes['#lppScroll'].scrollTop = 110;
  c.S.panelShut = "one";
  await c.run("switchProject('b')");
  c.nodes['#lpScroll'].scrollTop = 0; c.nodes['#lpList'].scrollTop = 0; c.nodes['#lppScroll'].scrollTop = 0;
  await c.run("switchProject('a')");
  assert.equal(c.S.panelShut, "one");
  assert.deepEqual(['#lpScroll', '#lpList', '#lppScroll'].map(k => c.nodes[k].scrollTop), [280, 35, 110]);
  assert.equal(c.run("projectPosition('a', {view:'line',line:'one',step:'work-2'})"), null);
});

test("hide/show is in-place, remembered, and holds on every page", () => {
  const c = setup();
  c.run("refreshProjectsVisibility()"); assert.equal(c.classes.has("projects-hidden"), false);
  c.nodes['#lpScroll'].scrollTop = 350;
  c.run("ACT['toggle-projects']()");
  assert.equal(c.classes.has("projects-hidden"), true);
  assert.equal(c.nodes['#lpScroll'].scrollTop, 350); assert.equal(c.items.get("penecho-lines-projects-hidden"), "1");
  c.S.route = { view:"home" }; c.run("refreshProjectsVisibility()"); assert.equal(c.classes.has("projects-hidden"), true);
  c.S.newPage = true; c.run("refreshProjectsVisibility()"); assert.equal(c.classes.has("projects-hidden"), true); c.S.newPage = false;
  c.S.route = { view:"line", line:"one" }; c.run("refreshProjectsVisibility()"); assert.equal(c.classes.has("projects-hidden"), true);
  const reloaded = setup({ stored:Object.fromEntries(c.items) });
  reloaded.run("refreshProjectsVisibility()"); assert.equal(reloaded.classes.has("projects-hidden"), true);
  c.run("ACT['toggle-projects']()"); assert.equal(c.classes.has("projects-hidden"), false);
});

test("Hide projects sits atop the sidebar and Show projects at the line's left edge, not beside the title", () => {
  const c = setup();
  assert.match(c.run("projectsToggleHTML(true)"), /class="icon-btn rail-hide"[^>]*aria-label="Hide projects"/);
  assert.match(c.run("projectsToggleHTML()"), /class="icon-btn projects-show"[^>]*aria-label="Show projects"/);
  assert.doesNotMatch(c.run("projectsToggleHTML()"), /<span>Projects<\/span>/);
  const { document } = parseHTML(c.run("chromeHTML()"));
  assert.ok(document.querySelector('#rail > .rail-top > .rail-hide[aria-label="Hide projects"]'));
  assert.match(read("line.js"), /<div class="lp-side-top">\$\{projectsToggleHTML\(\)\}/);
});

test("same-named lines restore only their project's filter with independent Set snapshots", async () => {
  const c = setup();
  c.S.lineFilter = { line:"one", f:"review", known:new Set(["work-1"]), kept:new Set(["a-kept"]) };
  c.S.routes.b = { view:"line", line:"one", step:"work-2" };
  await c.run("switchProject('b')"); assert.equal(c.S.lineFilter, null);
  c.S.lineFilter = { line:"one", f:"done", known:new Set(["work-2"]), kept:new Set(["b-kept"]) };
  await c.run("switchProject('a')");
  assert.equal(c.S.lineFilter.f, "review"); assert.deepEqual([...c.S.lineFilter.known], ["work-1"]); assert.deepEqual([...c.S.lineFilter.kept], ["a-kept"]);
  c.S.lineFilter.kept.add("changed");
  assert.equal(c.run("projectLineFilter('a', S.route).kept.has('changed')"), false);
  await c.run("switchProject('b')"); assert.equal(c.S.lineFilter.f, "done"); assert.deepEqual([...c.S.lineFilter.kept], ["b-kept"]);
  c.location.hash = "#a/line/one/work-2"; await c.events.hashchange(); assert.equal(c.S.lineFilter, null);
});

test("a project transition awaits its outgoing editor save and retains the editor on failure", async () => {
  const c = setup(), saved = deferred(); let loaded = false, owner;
  c.nodes['.reader'] = {}; c.nodes['#rdArea'] = { hidden:false };
  c.finishEdit = async () => { owner = c.S.cur; return saved.promise; };
  c.loadState = async () => { loaded = true; };
  const changing = c.run("switchProject('b')");
  assert.equal(owner, "a"); assert.equal(c.S.cur, "a"); assert.equal(loaded, false);
  saved.resolve(false); await changing;
  assert.equal(loaded, false); assert.equal(c.S.cur, "a"); assert.equal(c.nodes['#rdArea'].hidden, false);
});

test("concurrent project selections share an editor save and only the latest selection wins", async () => {
  const c = setup(), save = deferred(), reads = []; let saves = 0;
  c.nodes['.reader'] = {}; c.nodes['#rdArea'] = { hidden:false };
  c.finishEdit = async () => { saves++; const result = await save.promise; c.nodes['#rdArea'].hidden = true; return result; };
  const data = { ...c.S.data };
  delete c.S.data.b; delete c.S.data.c;
  c.loadState = async id => { reads.push(id); c.S.data[id] = data[id]; };
  const b = c.run("switchProject('b')"), latest = c.run("switchProject('c')");
  assert.equal(saves, 1); save.resolve(true); await Promise.all([b, latest]);
  assert.deepEqual(reads, ["c"]);
  assert.equal(c.S.cur, "c");
});

test("late project responses cannot replace a newer selection or explicit route", async () => {
  const c = setup(), loading = deferred();
  const b = c.S.data.b, reads = [];
  const loadB = response => async id => { reads.push(id); await response.promise; c.S.data.b = b; };
  const turn = () => new Promise(resolve => setImmediate(resolve));
  delete c.S.data.b;
  c.loadState = loadB(loading);
  const first = c.run("switchProject('b')"); await turn();
  assert.deepEqual(reads, ["b"]);
  await c.run("switchProject('c')"); loading.resolve(); await first;
  assert.equal(c.S.cur, "c");
  const secondResponse = deferred();
  delete c.S.data.b;
  c.loadState = loadB(secondResponse);
  const second = c.run("switchProject('b')"); await turn();
  assert.deepEqual(reads, ["b", "b"]);
  c.run("go({view:'memory'})"); secondResponse.resolve(); await second;
  assert.equal(c.S.cur, "c"); assert.equal(c.S.route.view, "memory");
});

test("unavailable destinations leave the current project and its route intact", async () => {
  const c = setup(), reads = [];
  delete c.S.data.b;
  c.loadState = async id => { reads.push(id); throw Error("Folder unavailable"); };
  await c.run("switchProject('b')"); assert.equal(c.S.cur, "a"); assert.equal(c.S.route.view, "line");
  c.S.newPage = true; c.S.hashWrite = "#new"; c.location.hash = "#b";
  await c.events.hashchange(); assert.equal(c.location.hash, "#new"); assert.equal(c.S.newPage, true);
  assert.deepEqual(reads, ["b", "b"]);
});

test("missing steps, lines and documents normalize both the saved route and URL", async () => {
  const c = setup(); c.S.routes.b = { view:"line", line:"one", step:"removed" };
  await c.run("switchProject('b')"); assert.deepEqual(plain(c.S.route), { view:"line", line:"one" });
  assert.equal(c.location.hash, "#b/line/one");
  for (const route of [{ view:"line", line:"removed" }, { view:"doc", doc:"removed.md" }]) {
    c.S.route = route; c.run("render()");
    assert.equal(c.location.hash, "#b"); assert.deepEqual(JSON.parse(c.items.get("penecho-lines")).routes.b, { view:"home" });
  }
});

test("explicit hashes and browser history override saved destinations", async () => {
  const c = setup(); c.S.routes.b = { view:"settings" };
  c.location.hash = "#b/line/one/work-2"; await c.events.hashchange();
  assert.equal(c.S.cur, "b"); assert.equal(c.S.route.step, "work-2");
  c.location.hash = "#a"; await c.events.hashchange();
  assert.equal(c.S.cur, "a"); assert.equal(c.S.route.view, "home");
});

test("failed editor saves undo hash navigation without leaving the outgoing project", async () => {
  const c = setup(); c.S.hashWrite = c.location.hash;
  c.nodes['.reader'] = {}; c.nodes['#rdArea'] = { hidden:false }; c.finishEdit = async () => false;
  c.location.hash = "#b"; await c.events.hashchange();
  assert.equal(c.S.cur, "a"); assert.equal(c.location.hash, "#a/line/one/work-1"); assert.equal(c.nodes['#rdArea'].hidden, false);
});

test("New and Archived pages retain the project's last route", async () => {
  const c = setup();
  c.run(read("start.js"));
  c.PenEchoProjects = c.window.PenEchoProjects;
  c.mountNewProject = () => {};
  for (const special of ["#new", "#archived"]) {
    if (special === "#archived") {
      c.location.hash = "#new"; await c.events.hashchange();
    }
    c.location.hash = special; await c.events.hashchange();
    assert.equal(c.S.routes.a.step, "work-1");
    assert.match(c.nodes['#view'].innerHTML, /<h1 class="np-title">New project<\/h1>/);
    if (special === "#archived") {
      assert.equal(c.modal, "archived", "Archived opens in Settings, over the page");
      assert.equal(c.S.newPage, true, "New project stays beneath it");
    }
    await c.run("switchProject('b')"); await c.run("switchProject('a')");
    assert.equal(c.S.route.step, "work-1");
  }
});

test("old project Agents links and saved views lead to Home, and the global Agents link opens Settings", () => {
  const c = setup();
  const target = c.run("hashToRoute('#b/agents')");
  assert.deepEqual(plain(target), { cur:"b", route:{ view:"home" } });
  c.S.cur = target.cur;
  assert.equal(c.run("routeToHash(hashToRoute('#b/agents').route)"), "b");
  c.S.routes.b = { view:"agents" };
  assert.deepEqual(plain(c.run("lastProjectRoute('b')")), { view:"home" });
  assert.equal(c.run("parseShelfPage('#agents')"), "agents");
  assert.equal(c.run("SET.agentsTab"), "agents");
});

test("boot resumes the last project unless an explicit address overrides it", async () => {
  const stored = { 'penecho-lines':JSON.stringify({ tabs:["a", "b"], cur:"b", routes:{ b:{ view:"line", line:"one", step:"work-2" } } }) };
  const c = setup({ stored, hash:"" }); await c.run("boot()");
  assert.equal(c.S.cur, "b"); assert.equal(c.S.route.step, "work-2"); assert.equal(c.location.hash, "#b/line/one/work-2");
  const explicit = setup({ stored, hash:"#b" }); await explicit.run("boot()"); assert.equal(explicit.S.route.view, "home");
});

test("old, malformed or unavailable browser storage is recoverable", async () => {
  for (const stored of [{ 'penecho-lines':'null' }, { 'penecho-lines':'{' }, { 'penecho-lines':JSON.stringify({ tabs:{}, cur:"a", routes:{ a:{ view:["line"], line:"one" } } }) }]) {
    const c = setup({ stored, hash:"" }); await c.run("boot()"); assert.equal(c.S.route.view, "home");
  }
  const c = setup({ storageFails:true }); c.run("ACT['toggle-projects']()"); await c.run("switchProject('b')"); assert.equal(c.S.cur, "b");
  assert.equal(c.run("hashToRoute('#a/line/%not-encoded')"), null);
});

test("same-slug line drafts are project-scoped", () => {
  const c = setup(), line = read("line.js"), composer = read("composer.js");
  c.esc = x => String(x); c.selectedStep = () => null; c.boxWords = () => "Continue"; c.STATE_COLOR = {};
  c.reviewProgress = c.listHTML = c.lineHeadHTML = c.threadHTML = () => "";
  c.run(composer.slice(0, composer.indexOf("function syncComposer(")));
  c.run(line.slice(line.indexOf("function lineDockHTML("), line.indexOf("function itemTop(")));
  c.run("lineHTML(project(), {line:'one'})");
  const a = Object.keys(c.S.comp)[0]; c.S.comp[a].text = "Alpha draft";
  c.S.cur = "b"; c.run("lineHTML(project(), {line:'one'})");
  const b = Object.keys(c.S.comp).find(k => k !== a);
  assert.ok(b); assert.equal(c.S.comp[b].text, ""); assert.equal(c.S.comp[b].project, "b");
  c.S.comp[b].text = "Beta draft"; c.S.cur = "a"; c.run("lineHTML(project(), {line:'one'})");
  assert.equal(c.S.comp[a].text, "Alpha draft"); assert.equal(c.S.comp[b].text, "Beta draft");
});

test("legacy drafts migrate once only when the last project and explicit line identify the owner", async () => {
  const stored = { 'penecho-lines':JSON.stringify({ cur:"a", tabs:["a"] }) };
  const c = setup({ stored }); c.S.comp['conv-one'] = { text:"Keep this draft" };
  await c.run("boot()");
  assert.equal(c.S.comp['conv-a-one'].text, "Keep this draft"); assert.equal(c.S.comp['conv-one'], undefined);
  await c.run("switchProject('b')"); assert.equal(c.S.comp['conv-b-one'], undefined);
  const other = setup({ stored, hash:"#b/line/one" }); other.S.comp['conv-one'] = { text:"Uncertain owner" };
  await other.run("boot()"); assert.equal(other.S.comp['conv-b-one'], undefined); assert.equal(other.S.comp['conv-one'].text, "Uncertain owner");
});

test("drawing and reload preserve other projects' attachment drafts", async () => {
  const c = setup(), composer = read("composer.js");
  c.run(composer.slice(composer.indexOf("const BOXES_KEY"), composer.indexOf("// A Canvas kept beside")));
  c.S.comp.a = { project:"a", text:"A", files:[{ name:"a.txt", path:"a.txt" }], flags:{} };
  c.S.comp.b = { project:"b", text:"B", files:[{ name:"b.txt", path:"b.txt" }, { name:"upload.txt", blob:{} }], flags:{} };
  for (const id of ["a", "b"]) c.S.data[id].files.push({ path:`${id}.txt` });
  c.assetUrl = (p, name) => `/${p.id}/${name}`;
  c.uploadFiles = () => { throw Error("Must not upload another project's draft"); };
  c.run("boxUrls(project())"); await c.run("uploadBoxes(project())");
  assert.equal(c.S.comp.b.files.length, 2); assert.equal(c.S.comp.b.files[0].path, "b.txt");
  c.run("rememberBoxes()"); c.S.comp = {}; c.run("restoreBoxes()");
  assert.equal(c.S.comp.b.project, "b"); assert.equal(c.S.comp.b.files[0].path, "b.txt");
  await c.run("switchProject('b')"); assert.equal(c.S.comp.b.files[0].url, "/b/b.txt");
});
