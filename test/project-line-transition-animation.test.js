"use strict";
require("./helpers/safety.js");
const { test } = require("node:test"), assert = require("node:assert/strict"), vm = require("node:vm");
const fs = require("node:fs"), path = require("node:path");

const read = name => fs.readFileSync(path.join(__dirname, "../public/lines", name), "utf8");
const slice = (src, startMarker, endMarker) => {
  const start = src.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing marker: ${startMarker}`);
  const end = endMarker ? src.indexOf(endMarker, start) : src.length;
  assert.notEqual(end, -1, `Missing end marker: ${endMarker}`);
  return src.slice(start, end);
};

const navigation = read("navigation.js");
const pages = read("pages.js");
const line = read("line.js");
const main = read("main.js");
const markdown = read("markdown.js");

const switchFn = slice(pages, "async function switchProject(", "ACT['open-switcher']");
const switchProjectAct = slice(pages, "ACT['switch-project'] =", "// New project is a page:");
const lineBackAct = slice(line, "ACT['line-back'] =", "ACT['line-fold'] =");
const openLineActs = slice(line, "ACT['open-line'] =", "const STARTS =");
const openDocSrc = slice(markdown, "ACT['open-doc'] = el =>", "// Turns what you typed");
const hashHandler = slice(main, "  addEventListener('hashchange'", "  addEventListener('resize'");

const RECT = { left:20, top:40, width:160, height:32, right:180, bottom:72 };

function makeButton({ dataset = {}, selectors = {} } = {}) {
  return {
    dataset,
    getBoundingClientRect: () => RECT,
    closest(sel) { return selectors[sel] || null; },
  };
}

function makeHomeLinesButton(lineId, extraDataset = {}) {
  const pano = { id:"pano" };
  const row = {
    dataset:{ row:lineId },
    closest(sel) { return sel === "#pano" ? pano : sel === ".hl-row" ? row : null; },
  };
  return makeButton({
    dataset:{ line:lineId, ...extraDataset },
    selectors:{ ".hl-row":row, "#pano":pano },
  });
}

function makeRailLineButton(projectId, lineId) {
  const rail = { id:"rail" };
  return makeButton({
    dataset:{ p:projectId, line:lineId },
    selectors:{ "#rail":rail },
  });
}

function makeRailProjectButton(projectId) {
  const rail = { id:"rail" };
  return makeButton({
    dataset:{ p:projectId },
    selectors:{ "#rail":rail },
  });
}

function setup({ route = { view:"home" }, hash = "#a" } = {}) {
  const calls = [];
  const items = new Map(), classes = new Set(), nodes = {}, events = {};
  const pageNode = { getBoundingClientRect: () => ({ left:0, top:0, width:1000, height:800 }) };
  for (const key of ["#app", "#view", "#linePage", "#lpScroll", "#lpList", "#lppScroll"]) {
    nodes[key] = { scrollTop:0, innerHTML:"" };
  }
  nodes["#view > *"] = pageNode;
  const targets = new Map();

  const historyStack = [{ hash, state:null }];
  let historyIndex = 0;

  const storage = {
    getItem: key => items.get(key) || null,
    setItem: (key, value) => items.set(key, value),
    removeItem: key => items.delete(key),
  };

  const S = {
    cur:"a",
    route,
    tabs:["a"],
    routes:Object.create(null),
    docs:{ "a:files/one/note.md":{ path:"files/one/note.md", title:"Note" } },
    projects:[
      { id:"a", name:"Alpha", lastOpenedAt:0 },
      { id:"b", name:"Beta", lastOpenedAt:0 },
    ],
    comp:{},
    data:{
      a:{
        id:"a",
        name:"Alpha",
        files:[{ path:"files/one/note.md" }],
        lines:[
          { id:"one", slug:"one", title:"Line One", stations:[{ id:"work-1" }, { id:"work-2" }] },
          { id:"two", slug:"two", title:"Line Two", stations:[{ id:"work-1" }] },
          { id:"sub-1", slug:"sub-1", title:"Sub Line", stations:[{ id:"work-1" }] },
        ],
        landed:[],
        backlog:[],
      },
      b:{
        id:"b",
        name:"Beta",
        files:[],
        lines:[
          { id:"beta-1", slug:"beta-1", title:"Beta Line", stations:[{ id:"work-1" }] },
        ],
        landed:[],
        backlog:[],
      },
    },
  };

  const location = {
    get hash() { return historyStack[historyIndex].hash; },
    set hash(value) {
      historyStack.splice(historyIndex + 1);
      historyStack.push({ hash:value, state:null });
      historyIndex = historyStack.length - 1;
    },
  };
  const history = {
    get state() { return historyStack[historyIndex].state; },
    replaceState(state, _title, value) {
      historyStack[historyIndex] = { hash:value, state };
    },
  };

  const context = {
    S, calls, nodes, targets, items, classes, events, console, Object, Map, Set, Date, Promise, JSON,
    encodeURIComponent, decodeURIComponent, performance:{ now: () => 0 }, setTimeout: () => 0, clearTimeout: () => {},
    localStorage:storage, sessionStorage:storage,
    location, history,
    document:{
      title:"",
      body:{ classList:{ add:k => classes.add(k), remove:(...ks) => ks.forEach(k => classes.delete(k)), toggle:(k, on) => on ? classes.add(k) : classes.delete(k) } },
      getElementById: () => null,
    },
    window:{},
    $:(selector) => nodes[selector] || targets.get(selector) || null,
    $$:() => [],
    Pano:{ sheet:null },
    SHEET:null,
    ACT:{},
    CSS:{ escape:x => x },
    EMBED:null,
    HOSTED:false,
    SET:{},
    SETTINGS_PAGES:new Set(["agents", "providers", "settings", "archived", "setup"]),
    zoomEnds:0,
    project:(id = S.cur) => S.data[id],
    summaryOf:id => S.projects.find(p => p.id === id),
    lineById:(p, id) => p?.lines?.find(l => l.id === id) || null,
    lineState:() => "notes",
    stationById:(l, id) => l?.stations?.find(s => s.id === id) || null,
    fileEntry:(p, name) => p?.files?.find(f => f.path === name) || null,
    docById:(name, p = S.data[S.cur]) => S.docs[`${p.id}:${name}`] || null,
    lacks:() => null, routeNeeds:() => ({}), readNeeds:async () => true, holdFor:() => null, readLineFiles:() => {},
    loadState:async () => {},
    api:async () => ({}),
    pathFor:id => `/projects/${id}`,
    finishEdit:async () => true,
    endFlight:() => { calls.push(["endFlight"]); },
    closeMenu:() => {},
    flightToLine:(lineId, from) => {
      calls.push(["flightToLine", lineId]);
      return () => { calls.push(["flightToLine:run", lineId, Boolean(from)]); };
    },
    flightToHome:(lineId) => {
      calls.push(["flightToHome", lineId]);
      return () => { calls.push(["flightToHome:run", lineId]); };
    },
    zoomIn:(_page, rect) => { calls.push(["zoomIn", Boolean(rect)]); },
    zoomOutClone:(_from, _node, rectTo) => { calls.push(["zoomOutClone", Boolean(rectTo)]); },
    readOpenedLine:() => {},
    unmountLine:() => {},
    hideStopCard:() => {},
    hasContent:() => true,
    homeShape:() => "code",
    showRow:id => { calls.push(["showRow", id]); },
    refreshChrome:() => {},
    renderRail:() => {},
    refreshAfterChange:() => {},
    renderSettingsModal:() => {},
    dropSettingsModal:() => {},
    settingsUp:() => false,
    embedRailOnly:() => false,
    embedKeeps:() => true,
    embedShown:() => {},
    hostedAddress:() => {},
    hostedBoot:() => {},
    spyLine:() => {},
    toast:() => {},
    ic:() => "",
    railGoing:() => {},
    applyRoles:() => {},
    boxUrls:() => {},
    takeDrawing:() => {},
    addEventListener:(key, fn) => { events[key] = fn; },
    setInterval:() => {},
    poll:() => {},
    pollActivity:() => {},
    chromeHTML:() => "",
    bindGlobal:() => {},
    wireDrop:() => {},
    restoreBoxes:() => {},
    loadProjects:async () => {},
    loadAgents:async () => {},
    checkAgents:() => {},
    showKeptRail:() => false,
    showKeptPage:() => false,
    railLive:() => {},
  };
  for (const view of ["home", "topicsPage", "canvases", "newLine", "stats", "orchestrator", "memory", "vault", "find", "archive", "deleted", "settings", "line", "doc", "markup"]) {
    context[view + "HTML"] = () => view;
  }

  vm.createContext(context);
  vm.runInContext(
    navigation + "\n" + switchFn + "\n" + switchProjectAct + "\n" + main.replace(/^boot\(\);$/m, "") + "\n" + lineBackAct + "\n" + openLineActs + "\n" + openDocSrc,
    context
  );
  vm.runInContext("afterRender = () => {}; bindGlobal = () => {}; setDocRouteProject(S.cur);", context);
  vm.runInContext(hashHandler, context);

  context.run = code => vm.runInContext(code, context);
  context.browserBack = async () => {
    assert.ok(historyIndex > 0, "Cannot go back past start of history");
    historyIndex--;
    await events.hashchange();
  };
  context.browserForward = async () => {
    assert.ok(historyIndex < historyStack.length - 1, "Cannot go forward past end of history");
    historyIndex++;
    await events.hashchange();
  };
  context.animNames = () => calls.filter(([name]) => ["flightToLine:run", "flightToHome:run", "zoomIn", "zoomOutClone"].includes(name)).map(([name]) => name);
  context.clearCalls = () => { calls.length = 0; };
  return context;
}

test("clicking a Line from All lines on the project homepage animates in and back via Back button and browser Back", async () => {
  const c = setup();
  const homeBtn = makeHomeLinesButton("one");

  c.ACT["open-line"](homeBtn);
  assert.deepEqual(c.animNames(), ["flightToLine:run"]);
  assert.equal(c.S.route.view, "line");
  assert.equal(c.S.route.line, "one");

  // Selecting a step keeps the home-lines origin for the return animation.
  c.clearCalls();
  c.S.route = { view:"line", line:"one", step:"work-2" };
  c.run("syncHash(true)");
  c.ACT["line-back"]();
  assert.deepEqual(c.animNames(), ["flightToHome:run"]);
  assert.equal(c.S.route.view, "home");

  // Browser Back (and Forward then Back) also animates when returning from a home-Lines visit.
  c.clearCalls();
  c.ACT["open-line"](makeHomeLinesButton("one"));
  assert.deepEqual(c.animNames(), ["flightToLine:run"]);

  c.clearCalls();
  await c.browserBack();
  assert.deepEqual(c.animNames(), ["flightToHome:run"]);
  assert.equal(c.S.route.view, "home");

  c.clearCalls();
  await c.browserForward();
  assert.deepEqual(c.animNames(), []);
  assert.equal(c.S.route.view, "line");

  c.clearCalls();
  await c.browserBack();
  assert.deepEqual(c.animNames(), ["flightToHome:run"]);
  assert.equal(c.S.route.view, "home");
});

test("opening a line from the left panel never animates (from home, from another line, or across projects)", async () => {
  const c = setup();

  // 1. On Home -> click line in left panel (same project): no flight, no zoomIn.
  c.ACT["open-line"](makeRailLineButton("a", "one"));
  assert.deepEqual(c.animNames(), []);
  assert.equal(c.S.route.view, "line");
  assert.equal(c.S.route.line, "one");

  // Going back from a left-panel opened line also does not animate.
  c.clearCalls();
  c.ACT["line-back"]();
  assert.deepEqual(c.animNames(), []);
  assert.equal(c.S.route.view, "home");

  // Browser Back from a left-panel opened line does not animate either.
  c.clearCalls();
  c.ACT["open-line"](makeRailLineButton("a", "one"));
  assert.deepEqual(c.animNames(), []);
  c.clearCalls();
  await c.browserBack();
  assert.deepEqual(c.animNames(), []);
  assert.equal(c.S.route.view, "home");

  // 2. On Line One -> click Line Two in left panel (same project): no zoomIn.
  c.ACT["open-line"](makeHomeLinesButton("one"));
  c.clearCalls();
  c.ACT["open-line"](makeRailLineButton("a", "two"));
  assert.deepEqual(c.animNames(), []);
  assert.equal(c.S.route.line, "two");

  // Back from Line Two (opened via left panel) does not animate.
  c.clearCalls();
  c.ACT["line-back"]();
  assert.deepEqual(c.animNames(), []);
  assert.equal(c.S.route.view, "home");

  // 3. Click line in another project in left panel: no flight, no zoomIn.
  c.clearCalls();
  c.ACT["open-line"](makeRailLineButton("b", "beta-1"));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(c.S.cur, "b");
  assert.equal(c.S.route.view, "line");
  assert.equal(c.S.route.line, "beta-1");
  assert.deepEqual(c.animNames(), []);

  // 4. Switch to another project in left panel whose saved route is a line: no zoomIn / flight.
  c.S.routes.a = { view:"line", line:"one" };
  c.clearCalls();
  c.ACT["switch-project"](makeRailProjectButton("a"));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(c.S.cur, "a");
  assert.equal(c.S.route.view, "line");
  assert.equal(c.S.route.line, "one");
  assert.deepEqual(c.animNames(), []);
});

test("opening a line from other links (Topics card, Orchestrator, Search, sub-line) never zooms or flies", () => {
  const c = setup();

  // Link on homepage outside #pano (e.g. Topics dot / Not sent / Deck hero).
  const topicDot = makeButton({ dataset:{ line:"one" } });
  c.ACT["open-line"](topicDot);
  assert.deepEqual(c.animNames(), []);
  assert.equal(c.S.route.line, "one");

  // Sub-line opened from parent line, and back to parent line: no zoomIn, no zoomOutClone.
  const subKey = `[data-step="sub-1"],[data-line="sub-1"],[data-card="sub-1"],[data-path="sub-1"],[data-doc="sub-1"]`;
  c.targets.set(subKey, { getBoundingClientRect: () => RECT });
  c.clearCalls();
  c.ACT["open-line"](makeButton({ dataset:{ line:"sub-1", fromParent:"one" } }));
  assert.deepEqual(c.animNames(), []);
  assert.equal(c.S.route.line, "sub-1");

  c.clearCalls();
  c.ACT["line-back"]();
  assert.deepEqual(c.animNames(), []);
  assert.equal(c.S.route.line, "one");

  // Orchestrator -> line -> back to Orchestrator: no flight, no zoomIn, no zoomOutClone.
  c.run("go({ view:'orchestrator' })");
  c.clearCalls();
  c.ACT["open-line"](makeButton({ dataset:{ line:"two" } }));
  assert.deepEqual(c.animNames(), []);
  assert.equal(c.S.route.line, "two");

  c.clearCalls();
  c.ACT["line-back"]();
  assert.deepEqual(c.animNames(), []);
  assert.equal(c.S.route.view, "orchestrator");

  // Search/Find open-step -> line: no flight, no zoomIn.
  c.run("go({ view:'find' })");
  c.clearCalls();
  c.ACT["open-step"](makeButton({ dataset:{ line:"one", step:"work-1" } }));
  assert.deepEqual(c.animNames(), []);
  assert.equal(c.S.route.view, "line");
  assert.equal(c.S.route.step, "work-1");
});

test("home-Lines origin survives doc and sub-line round-trips, and clicking project in left panel does not fly back", async () => {
  const c = setup();

  // Open Line One from Home Lines -> open Sub-Line -> Back to Line One -> open Doc -> doc-back -> Back to Home.
  c.ACT["open-line"](makeHomeLinesButton("one"));
  assert.deepEqual(c.animNames(), ["flightToLine:run"]);

  c.clearCalls();
  c.ACT["open-line"](makeButton({ dataset:{ line:"sub-1", fromParent:"one" } }));
  assert.deepEqual(c.animNames(), []);

  c.clearCalls();
  c.ACT["line-back"]();
  assert.deepEqual(c.animNames(), []);
  assert.equal(c.S.route.line, "one");

  // Opening a doc from Line One still keeps doc zoomIn/zoomOutClone and preserves homeLinesOrigin.
  const docTargetKey = `[data-step="files/one/note.md"],[data-line="files/one/note.md"],[data-card="files/one/note.md"],[data-path="files/one/note.md"],[data-doc="files/one/note.md"]`;
  c.targets.set(docTargetKey, { getBoundingClientRect: () => RECT });
  c.clearCalls();
  c.run("openDoc('files/one/note.md', { dataset:{ doc:'files/one/note.md' }, getBoundingClientRect: () => ({ left:10, top:10, width:80, height:24 }) })");
  assert.deepEqual(c.animNames(), ["zoomIn"]);

  c.clearCalls();
  c.ACT["doc-back"]();
  assert.deepEqual(c.animNames(), ["zoomOutClone"]);
  assert.equal(c.S.route.view, "line");
  assert.equal(c.S.route.line, "one");

  c.clearCalls();
  c.ACT["line-back"]();
  assert.deepEqual(c.animNames(), ["flightToHome:run"]);
  assert.equal(c.S.route.view, "home");

  // Open Line One from Home Lines, then click current project in left panel -> no flightToHome.
  c.clearCalls();
  c.ACT["open-line"](makeHomeLinesButton("one"));
  assert.deepEqual(c.animNames(), ["flightToLine:run"]);

  c.clearCalls();
  c.ACT["switch-project"](makeRailProjectButton("a"));
  assert.deepEqual(c.animNames(), []);
  assert.equal(c.S.route.view, "home");

  // Open Line One from Home Lines, then switch to Project B (whose route is Home) -> no animation at all.
  c.ACT["open-line"](makeHomeLinesButton("one"));
  c.S.routes.b = { view:"home" };
  c.clearCalls();
  c.ACT["switch-project"](makeRailProjectButton("b"));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(c.S.cur, "b");
  assert.equal(c.S.route.view, "home");
  assert.deepEqual(c.animNames(), []);
  assert.equal(c.calls.some(([name]) => name === "flightToHome" || name === "showRow"), false);
});

test("clicking a project that lands on home (or any non-line page) never zooms or flies", async () => {
  const c = setup();

  // 1. On Project A home -> click Project B in left panel (lands on Project B home): no zoomIn / flight.
  c.S.routes.b = { view:"home" };
  c.clearCalls();
  c.ACT["switch-project"](makeRailProjectButton("b"));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(c.S.cur, "b");
  assert.equal(c.S.route.view, "home");
  assert.deepEqual(c.animNames(), []);

  // 2. Click Project A from Archived/non-rail button (lands on home): no zoomIn / flight.
  c.S.routes.a = { view:"home" };
  c.clearCalls();
  c.ACT["switch-project"](makeButton({ dataset:{ p:"a" } }));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(c.S.cur, "a");
  assert.equal(c.S.route.view, "home");
  assert.deepEqual(c.animNames(), []);

  // 3. Switch to Project B whose saved route is another non-line page (canvases / orchestrator): no zoomIn.
  c.S.routes.b = { view:"canvases" };
  c.clearCalls();
  c.ACT["switch-project"](makeRailProjectButton("b"));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(c.S.cur, "b");
  assert.equal(c.S.route.view, "canvases");
  assert.deepEqual(c.animNames(), []);

  // 4. Even if switchProject or go({ view:'home' }) is called directly with { from }, no zoomIn runs.
  c.clearCalls();
  c.run("switchProject('a', { view:'home', from:{ dataset:{ p:'a' }, getBoundingClientRect:() => ({ left:10, top:10, width:80, height:24 }) } })");
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(c.S.cur, "a");
  assert.equal(c.S.route.view, "home");
  assert.deepEqual(c.animNames(), []);

  c.clearCalls();
  c.run("go({ view:'home' }, { from:{ dataset:{ p:'a' }, getBoundingClientRect:() => ({ left:10, top:10, width:80, height:24 }) } })");
  assert.deepEqual(c.animNames(), []);

  // 5. Opening a doc from Home still keeps doc zoomIn / zoomOutClone, and switching projects from a doc clears stale origin without animating.
  const docTargetKey = `[data-step="files/one/note.md"],[data-line="files/one/note.md"],[data-card="files/one/note.md"],[data-path="files/one/note.md"],[data-doc="files/one/note.md"]`;
  c.targets.set(docTargetKey, { getBoundingClientRect: () => RECT });
  c.clearCalls();
  c.run("openDoc('files/one/note.md', { dataset:{ doc:'files/one/note.md' }, getBoundingClientRect: () => ({ left:10, top:10, width:80, height:24 }) })");
  assert.deepEqual(c.animNames(), ["zoomIn"]);

  c.clearCalls();
  c.ACT["doc-back"]();
  assert.deepEqual(c.animNames(), ["zoomOutClone"]);
  assert.equal(c.S.route.view, "home");

  c.run("openDoc('files/one/note.md', { dataset:{ doc:'files/one/note.md' }, getBoundingClientRect: () => ({ left:10, top:10, width:80, height:24 }) })");
  c.S.routes.b = { view:"home" };
  c.clearCalls();
  c.ACT["switch-project"](makeRailProjectButton("b"));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(c.S.cur, "b");
  assert.equal(c.S.route.view, "home");
  assert.deepEqual(c.animNames(), []);
});
