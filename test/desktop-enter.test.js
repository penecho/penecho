"use strict";
const { parseHTML } = require("./helpers/dom.js");
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");

const openingSource = fs.readFileSync(require.resolve("../public/lines/opening.js"), "utf8");
const bridgeSource = fs.readFileSync(require.resolve("../src/client/app/project-lines-bridge.js"), "utf8");
const startupRoute = bridgeSource.slice(bridgeSource.indexOf("  function projectLinesWorkingOnCanvas("), bridgeSource.indexOf("  function projectLinesNothingKept(")) +
  bridgeSource.slice(bridgeSource.indexOf("  async function projectLinesStartAlone("), bridgeSource.indexOf("  if (projectLinesAlone) {"));

function storage(items = new Map()) {
  return { getItem:key => items.get(key) ?? null, setItem:(key, value) => items.set(key, value), removeItem:key => items.delete(key) };
}

function film({ launch = "launch-one", self = false, reduced = false, time = 10000, sessionStorage = storage() } = {}) {
  const { document } = parseHTML("<html><body></body></html>");
  document.cookie = "penecho-boot=test";
  document.currentScript = { dataset:{ play:self ? "self" : "" } };
  const timers = new Map(), frames = [], events = {};
  let now = time, nextTimer = 0, show;
  const whenShown = new Promise(resolve => { show = resolve; });
  const window = { penechoDesktop:{ whenStartupVisible:() => whenShown } };
  window.top = window;
  vm.runInNewContext(openingSource, {
    window, document, sessionStorage, localStorage:storage(), URLSearchParams,
    location:{ search:`?desktopLaunch=${launch}` }, navigator:{}, matchMedia:query => ({ matches:reduced && query.includes("reduced-motion") }),
    Date:class extends Date { static now() { return now; } }, innerWidth:1440, innerHeight:900,
    addEventListener:(key, listener) => { events[key] = listener; }, removeEventListener:key => { delete events[key]; },
    setTimeout:(callback, ms) => { const id = ++nextTimer; timers.set(id, { callback, at:now + ms }); return id; },
    clearTimeout:id => timers.delete(id), requestAnimationFrame:callback => frames.push(callback),
  });
  const advance = ms => {
    now += ms;
    for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.callback(); }
  };
  return { opening:window.PenEchoOpening, root:() => document.getElementById("peOpening"), sessionStorage, show, advance, frames, events };
}

test("desktop holds the first frame and the route until the native window shows and the film settles", async () => {
  const f = film();
  assert.equal(f.opening.wanted(), true);
  f.opening.play({ waitForWindow:true });
  let settled = false;
  const readyToLeave = f.opening.settled().then(() => { settled = true; });
  f.advance(5000);
  assert.equal(f.root().classList.contains("po-paused"), true);
  assert.equal(settled, false);
  f.show(true);
  await Promise.resolve();
  f.frames.shift()();
  assert.equal(f.root().classList.contains("po-paused"), true);
  f.frames.shift()();
  assert.equal(f.root().classList.contains("po-paused"), false);
  f.advance(1999);
  await Promise.resolve();
  assert.equal(settled, false);
  f.advance(1);
  await readyToLeave;
  assert.equal(f.root().classList.contains("po-out"), false);
  const carried = film({ self:true, time:17000, sessionStorage:f.sessionStorage });
  assert.equal(carried.root().style.getPropertyValue("--at"), "-2000ms", "Projects picks up at the final frame");
  assert.equal(f.opening.wanted(), false);
  assert.equal(film({ sessionStorage:f.sessionStorage }).opening.wanted(), false, "reload within the same native launch");
  assert.equal(film({ launch:"launch-two", sessionStorage:f.sessionStorage }).opening.wanted(), true, "a new window plays a new opening");
});

test("a desktop launch skips the film for reduced motion and dismisses it on input", async () => {
  const reduced = film({ reduced:true });
  assert.equal(reduced.opening.wanted(), false);
  await reduced.opening.settled();
  for (const event of ["pointerdown", "keydown", "wheel"]) {
    const f = film();
    f.opening.play({ waitForWindow:true });
    const settled = f.opening.settled();
    f.events[event]();
    await settled;
    assert.equal(f.root().classList.contains("po-out"), true);
    f.advance(340);
    assert.equal(f.root(), null);
    assert.equal(film({ self:true, sessionStorage:f.sessionStorage }).root(), null, "Projects does not replay a dismissed film");
  }
});

function landing({ projects, desktop = true, beforeSettled = () => {} }) {
  const calls = [], window = {
    projectLinesFirstAnswer:Promise.resolve(projects && { projects }),
    projectLinesWelcomeOpen:true,
    PenEchoOpening:{ desktopLaunch:desktop ? "launch-one" : "", settled:async () => { calls.push("settled"); beforeSettled(window); }, ready:() => calls.push("ready") },
    projectLinesCover:{ lift:() => calls.push("lift") },
  };
  const context = vm.createContext({
    window, URLSearchParams, location:{ href:"http://localhost/", replace:address => calls.push(address) },
    canvasDocumentsDraft:{ commitVersion:0 }, canvasDocumentsDraftBusy:() => false, mcpRuntime:{ sessions:new Map() },
    canvasDocumentsStartDraft:async () => calls.push("restore"), projectLinesNothingKept:() => false,
    projectLinesStays:() => {}, projectLinesStayed:null,
  });
  const result = vm.runInContext(startupRoute + "projectLinesStartAlone()", context);
  return result.then(() => calls);
}

test("desktop starts in Projects despite recovered Canvas data, while the browser retains Canvas recovery priority", async () => {
  const projects = [{ id:"mine" }];
  assert.deepEqual(await landing({ projects }), ["settled", "/projects.html?desktopLaunch=launch-one"]);
  assert.deepEqual(await landing({ projects, desktop:false }), ["restore", "lift"]);
});

test("first use, a failed list, and an active Canvas choice release the desktop welcome", async () => {
  for (const projects of [null, [], [{ example:true }, { myCanvases:true }, { archived:true }]]) {
    assert.deepEqual(await landing({ projects }), ["lift", "ready"]);
  }
  assert.deepEqual(await landing({ projects:[{ id:"mine" }], beforeSettled:window => { window.projectLinesWelcomeOpen = false; } }), ["settled", "lift", "ready"]);
});

test("desktop Projects restores a valid saved route and chooses an available personal project when it is gone", async () => {
  const main = fs.readFileSync(require.resolve("../public/lines/main.js"), "utf8");
  const navigation = fs.readFileSync(require.resolve("../public/lines/navigation.js"), "utf8");
  const from = main.indexOf("  S.routes = Object.create(null);");
  const route = main.slice(from, main.indexOf("  if (typeof setDocRouteProject", from));
  const projects = [
    { id:"personal", lastOpenedAt:1 }, { id:"example", example:true, lastOpenedAt:2 },
    { id:"my-canvases", myCanvases:true, lastOpenedAt:3 }, { id:"archived", archived:true, lastOpenedAt:4 },
    { id:"missing", missing:true, lastOpenedAt:5 },
  ];
  async function restore(saved) {
    const S = { projects }, savedRoute = { view:"line", line:"one", step:"work-2" };
    const localStorage = storage(new Map([["penecho-lines", JSON.stringify({ cur:saved, routes:{ [saved]:savedRoute } })]]));
    await vm.runInNewContext(`${navigation}\n(async () => {${route}})()`, {
      S, location:{ hash:"" }, HOSTED:false, EMBED:null, localStorage, window:{ PenEchoOpening:{ desktopLaunch:"launch-one" } },
      ACT:{}, VIEWS:{ home:true, line:true }, history:{ state:null },
      summaryOf:id => projects.find(p => p.id === id), hashToRoute:() => null, parseShelfPage:() => false,
      project:() => ({}), applyRoles:() => {},
      loadState:async id => { if (id === "missing") throw Error("Folder not found"); },
    });
    return { project:S.cur, route:{ ...S.route } };
  }
  assert.deepEqual(await restore("example"), { project:"example", route:{ view:"line", line:"one", step:"work-2" } });
  for (const missing of ["missing", "removed"]) assert.deepEqual(await restore(missing), { project:"personal", route:{ view:"home" } });
});
