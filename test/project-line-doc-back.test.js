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
const markdown = read("markdown.js");
const line = read("line.js");
const composer = read("composer.js");
const main = read("main.js");

const openDocSrc = slice(markdown, "ACT['open-doc'] = el =>", "// Turns what you typed");
const drawAndBackSrc = slice(line, "ACT['draw-doc'] = el =>", "SEND.markup =");
const hashHandler = slice(main, "  addEventListener('hashchange'", "  addEventListener('resize'");

function setup({ route = { view:"line", line:"one", step:"work-6" }, hash = "#a/line/one/work-6" } = {}) {
  const items = new Map(), classes = new Set(), nodes = {}, events = {};
  for (const key of ["#app", "#view", "#linePage", "#lpScroll", "#lpList", "#lppScroll"]) nodes[key] = { scrollTop:0, innerHTML:"" };
  const storage = {
    getItem:key => items.get(key) || null,
    setItem:(key, value) => items.set(key, value),
    removeItem:key => items.delete(key),
  };
  const fixtureState = {
    cur:"a",
    route,
    tabs:["a"],
    routes:Object.create(null),
    docs:{
      "a:files/one/understanding.md":{ path:"files/one/understanding.md", title:"Understanding" },
      "a:lines/two.md":{ path:"lines/two.md", title:"Second Topic" },
      "a:works/one/work-1.md":{ path:"works/one/work-1.md", title:"Work 1" },
      "b:files/b-note.md":{ path:"files/b-note.md", title:"Project B Note" },
    },
    projects:[
      { id:"a", name:"Alpha", lastOpenedAt:0 },
      { id:"b", name:"Beta", lastOpenedAt:0 },
    ],
    comp:{},
    data:{
      a:{
        id:"a",
        name:"Alpha",
        files:[
          { path:"files/one/understanding.md" },
          { path:"lines/two.md" },
          { path:"works/one/work-1.md" },
        ],
        lines:[
          { id:"one", slug:"one", title:"Line One", topicPath:"lines/one.md", stations:[{ id:"work-1", detail:"works/one/work-1.md" }, { id:"work-6" }] },
          { id:"two", slug:"two", title:"Line Two", topicPath:"lines/two.md", stations:[{ id:"work-1" }] },
        ],
        landed:[],
        backlog:[],
      },
      b:{
        id:"b",
        name:"Beta",
        files:[{ path:"files/b-note.md" }],
        lines:[{ id:"only", slug:"only", title:"Beta Line", topicPath:"lines/only.md", stations:[{ id:"work-1" }] }],
        landed:[],
        backlog:[],
      },
    },
  };
  const context = {
    fixtureState, nodes, items, classes, events, console, Object, Map, Set, Date, Promise, JSON, encodeURIComponent, decodeURIComponent,
    LINE_STATUS:require("../public/lines/line-status.js"), performance, zoomEnds:0,
    localStorage:storage, sessionStorage:storage,
    EMBED:false, HOSTED:false, Pano:{ sheet:null }, SHEET:null, ACT:{}, SEND:{}, CSS:{ escape:x => x },
    location:{ hash },
    history:{ replaceState:(_s, _t, value) => { context.location.hash = value; } },
    document:{
      title:"",
      getElementById:() => null, addEventListener() {}, documentElement:{ addEventListener() {} },
      body:{ classList:{ add:key => classes.add(key), remove:(...keys) => keys.forEach(k => classes.delete(k)), toggle:(key, on) => on ? classes.add(key) : classes.delete(key) } },
    },
    window:{},
    $:(selector, _root) => nodes[selector] || null,
    $$:() => [],
    readerHost:(_p, name) => `<div data-doc="${name}"></div>`,
    composerHTML:() => "",
    esc:value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c])),
    ic:() => "",
    loadState:async () => {}, api:async () => ({}), finishEdit:async () => true,
    endFlight:() => {}, closeMenu:() => {}, flightToLine:() => null, flightToHome:() => null, readOpenedLine:() => {}, unmountLine:() => {}, hideStopCard:() => {},
    homeShape:() => "code", showRow:() => {}, refreshChrome:() => {}, spyLine:() => {}, toast:() => {},
    hostedBoot:() => {}, hostedAddress:() => {}, embedKeeps:() => true, embedTell:() => {}, embedShown:() => {}, embedRailOnly:() => false,
    mountLine:() => {}, mountMarkup:() => {}, applyRoles:() => {}, boxUrls:() => {},
    addEventListener:(key, fn) => { events[key] = fn; }, clearTimeout() {}, setTimeout() {},
    loadProjects:async () => {}, loadAgents:async () => {}, checkAgents:() => {},
    canvasesHTML:() => "canvases",
    newLineHTML:() => "newline",
  };
  vm.createContext(context);
  const boundary = Object.fromEntries(["loadState", "api", "readOpenedLine", "loadProjects", "loadAgents", "applyRoles", "readerHost"].map(name => [name, context[name]]));
  for (const [name, source] of [["state.js", read("state.js")], ["pages.js", pages], ["settings.js", read("settings.js")], ["navigation.js", navigation]]) {
    vm.runInContext(source, context, { filename:name });
  }
  Object.assign(context, boundary);
  context.S = vm.runInContext("Object.assign(S, fixtureState)", context);
  for (const view of ["home", "stats", "memory", "vault", "find", "archive", "deleted", "settings", "line", "markup"]) {
    context[view + "HTML"] = () => view;
  }
  vm.runInContext(
    main.replace(/^boot\(\);$/m, "") + "\n" + openDocSrc + "\n" + drawAndBackSrc,
    context
  );
  vm.runInContext("afterRender = () => {}; bindGlobal = () => {}; setDocRouteProject(S.cur);", context);
  vm.runInContext(hashHandler, context);
  context.run = code => vm.runInContext(code, context);
  return context;
}

const plain = value => JSON.parse(JSON.stringify(value));

test("composer GOES_ONLY includes doc-back so returning never waits on saving queues", () => {
  assert.match(composer, /GOES_ONLY\s*=\s*new Set\(\[[^\]]*'doc-back'/);
});

test("opening a non-topic md file from a line detail page returns to that line and step with its title and scroll state", () => {
  const c = setup();
  c.nodes["#lpScroll"].scrollTop = 420;
  c.nodes["#lpList"].scrollTop = 55;
  c.nodes["#lppScroll"].scrollTop = 180;
  c.S.lineFilter = { line:"one", f:"review", known:new Set(["work-1"]), kept:new Set(["work-6"]) };

  c.run("openDoc('files/one/understanding.md', { dataset:{ path:'files/one/understanding.md' } })");
  assert.deepEqual(plain(c.S.route), { view:"doc", doc:"files/one/understanding.md" });
  const backMatch = c.nodes["#view"].innerHTML.match(/<div class="doc-back">(<button[\s\S]*?<\/button>)/);
  assert.ok(backMatch);
  assert.match(backMatch[1], /data-act="doc-back"/);
  assert.match(backMatch[1], />Line One<\/button>/);

  c.nodes["#lpScroll"].scrollTop = 0;
  c.nodes["#lpList"].scrollTop = 0;
  c.nodes["#lppScroll"].scrollTop = 0;
  c.S.lineFilter = null;

  c.run("ACT['doc-back']()");
  assert.deepEqual(plain(c.S.route), { view:"line", line:"one", step:"work-6" });
  assert.equal(c.nodes["#lpScroll"].scrollTop, 420);
  assert.equal(c.nodes["#lpList"].scrollTop, 55);
  assert.equal(c.nodes["#lppScroll"].scrollTop, 180);
  assert.equal(c.S.lineFilter.f, "review");
});

test("opening another line's md from Line One returns to Line One instead of jumping to Line Two", () => {
  const c = setup();
  c.run("openDoc('lines/two.md')");
  assert.match(c.nodes["#view"].innerHTML, /<div class="doc-back"><button[^>]*data-act="doc-back">Line One<\/button>/);
  c.run("ACT['doc-back']()");
  assert.deepEqual(plain(c.S.route), { view:"line", line:"one", step:"work-6" });
});

test("multi-hop md -> md -> doc-back returns step-by-step and markup round-trips keep the line origin", () => {
  const c = setup();
  c.run("openDoc('files/one/understanding.md')");
  c.nodes["#view"].scrollTop = 310;
  c.run("ACT['open-doc']({ dataset:{ doc:'lines/two.md' } })");
  assert.match(c.nodes["#view"].innerHTML, /<div class="doc-back"><button[^>]*data-act="doc-back">Understanding<\/button>/);

  c.run("ACT['draw-doc']({ dataset:{ doc:'lines/two.md' } })");
  assert.deepEqual(plain(c.S.route), { view:"markup", doc:"lines/two.md" });
  c.run("ACT['markup-back']()");
  assert.deepEqual(plain(c.S.route), { view:"doc", doc:"lines/two.md" });
  assert.match(c.nodes["#view"].innerHTML, /<div class="doc-back"><button[^>]*data-act="doc-back">Understanding<\/button>/);

  c.run("ACT['doc-back']()");
  assert.deepEqual(plain(c.S.route), { view:"doc", doc:"files/one/understanding.md" });
  assert.equal(c.nodes["#view"].scrollTop, 310);
  assert.match(c.nodes["#view"].innerHTML, /<div class="doc-back"><button[^>]*data-act="doc-back">Line One<\/button>/);

  c.run("ACT['doc-back']()");
  assert.deepEqual(plain(c.S.route), { view:"line", line:"one", step:"work-6" });
});

test("opening md from files, vault, archive, or home returns to that page with the right label", () => {
  for (const [view, label] of [["files", "Canvases &amp; files"], ["vault", "Vault"], ["archive", "Archive"], ["home", "Alpha"]]) {
    const c = setup({ route:{ view }, hash:`#a/${view}` });
    c.nodes["#view"].scrollTop = view === "home" ? 0 : 245;
    c.run("openDoc('files/one/understanding.md')");
    assert.match(c.nodes["#view"].innerHTML, new RegExp(`<div class="doc-back"><button[^>]*data-act="doc-back">${label}</button>`));
    c.nodes["#view"].scrollTop = 0;
    c.run("ACT['doc-back']()");
    assert.deepEqual(plain(c.S.route), { view });
    if (view !== "home") assert.equal(c.nodes["#view"].scrollTop, 245);
  }
});

test("browser back between docs pops newer hops, and leaving via subnav clears the doc trail", async () => {
  const c = setup();
  c.run("openDoc('files/one/understanding.md')");
  c.run("openDoc('lines/two.md')");
  c.location.hash = "#a/doc/" + encodeURIComponent("files/one/understanding.md");
  await c.events.hashchange();
  assert.match(c.nodes["#view"].innerHTML, /<div class="doc-back"><button[^>]*data-act="doc-back">Line One<\/button>/);

  c.run("go({ view:'vault' })");
  c.run("openDoc('lines/two.md')");
  assert.match(c.nodes["#view"].innerHTML, /<div class="doc-back"><button[^>]*data-act="doc-back">Vault<\/button>/);
});

test("project switch and direct URL opening do not invent a false origin and keep direct fallbacks", async () => {
  const c = setup();
  c.S.routes.b = { view:"doc", doc:"files/b-note.md" };
  await c.run("switchProject('b')");
  assert.deepEqual(plain(c.S.route), { view:"doc", doc:"files/b-note.md" });
  assert.match(c.nodes["#view"].innerHTML, /<div class="doc-back"><button[^>]*data-act="go-view" data-view="home">Beta<\/button>/);

  const directStep = setup({ route:{ view:"doc", doc:"works/one/work-1.md" }, hash:"#a/doc/" + encodeURIComponent("works/one/work-1.md") });
  directStep.run("render()");
  assert.match(directStep.nodes["#view"].innerHTML, /data-act="open-step" data-step="work-1" data-line="one"/);
});
