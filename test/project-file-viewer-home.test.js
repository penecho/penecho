"use strict";
require("./helpers/safety.js");

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function harness() {
  const listeners = {}, requests = [], opened = [], messages = [], focused = [];
  const line = { id:"beds", title:"Plan the beds", stations:[{ id:"ask-1", kind:"ask", label:"Ask" }, { id:"work-1", kind:"work", label:"Work 1" }] };
  const picture = (name, step = "ask-1") => ({ path:`files/beds/${name}.png`, kind:"picture", line:"beds", step, by:step === "ask-1" ? "you" : "claude", mtime:1 });
  const first = picture("one"), second = picture("two", "work-1"), hidden = picture("hidden");
  const partial = { id:"p", partial:"home", pictures:[], files:[{ path:first.path }, { path:second.path }], lines:[line] };
  const full = { ...partial, partial:"", files:[first, second, hidden] };
  let cards = [first, second].map(f => ({ dataset:{ path:f.path }, scrollIntoView() {}, focus() { focused.push(f.path); } }));
  const document = { addEventListener(name, fn) { (listeners[name] ||= []).push(fn); } };
  const context = vm.createContext({
    console, document, ICONS:{}, ACT:{}, Pano:{}, S:{ cur:"p", route:{ view:"home" }, data:{ p:partial } },
    location:{ hash:"#p" }, navigationTransition:0, HOSTED:false, EMBED:false,
    CSS:{ escape:s => s }, sessionStorage:{ getItem:() => null, removeItem() {} },
    addEventListener:(name, fn) => (listeners[name] ||= []).push(fn),
    $:selector => {
      if (selector === '#lightbox:not([hidden]) > .fv') return context.shown || null;
      if (selector === '#pano') return {};
      if (selector.startsWith('#panoRows ')) return cards.find(c => selector.includes(`[data-path="${c.dataset.path}"]`)) || null;
      return null;
    },
    $$:selector => selector === '#panoRows .hl-detail .st-pic' ? cards : [],
    project:(id = context.S.cur) => context.S.data[id],
    lineById:(p, id) => p.lines.find(l => l.id === id), stationById:(l, id) => l.stations.find(s => s.id === id),
    esc:s => String(s), ic:() => "", agentInfo:() => ({ name:"Claude" }),
    closeMenu() {}, closeLightbox() { context.shown = false; }, toast:message => messages.push(message),
    loadState:async (id, options) => { const pending = deferred(); requests.push({ id, options, ...pending }); if (!context.S.data[id].partial) pending.resolve(); await pending.promise; context.S.data[id] = full; },
  });
  const run = code => vm.runInContext(code, context);
  for (const file of ["desk.js", "files.js", "files-view.js"]) run(fs.readFileSync(path.join(__dirname, "../public/lines", file), "utf8"));
  // Keep the real opening, origin, navigation and focus code; record painting without needing a browser DOM.
  context.recordPaint = it => { opened.push(it.key); context.shown = true; };
  run("fvPaint = (p, it) => { FV.key = it.key; FV.mtime = it.mtime; recordPaint(it); }");
  return { context, run, requests, opened, messages, focused, partial, full, first, second, listeners, replaceCards() { cards = cards.map(c => ({ ...c })); },
    start:(key, opts = { line:"beds", step:"ask-1" }) => run(`fvOpenHome(project(), ${JSON.stringify(key || first.path)}, ${JSON.stringify(opts)})`),
    event:(name, event = {}) => { event.target ||= { closest:() => null }; for (const fn of listeners[name] || []) fn(event); } };
}

test("Home fetches full metadata before opening the shared viewer and links the exact Ask or Work", async () => {
  const h = harness(), done = h.start();
  assert.equal(h.opened.length, 0);
  assert.equal(h.requests[0].id, "p");
  assert.equal(JSON.stringify(h.requests[0].options.needs), '{"parts":["files"],"lines":["beds"]}');
  h.requests[0].resolve(); await done;
  assert.deepEqual(h.opened, [h.first.path]);
  const ask = h.run("flFromHTML(project(), fvItem(project(), FV.key))");
  assert.match(ask, /data-line="beds" data-step="ask-1"/);
  assert.match(ask, /Added with your Ask/);
  await h.start(h.second.path);
  const work = h.run("flFromHTML(project(), fvItem(project(), FV.key))");
  assert.match(work, /data-step="work-1"/);
  assert.match(work, /Made in Work 1/);
  assert.equal(h.requests.length, 2, "a full read also supersedes any Home poll already in flight");
  assert.ok(h.requests.every(r => r.options.force && r.options.needs.parts[0] === "files"));
});

test("Home navigation ignores Files filters and visits only its visible pictures", async () => {
  const h = harness(); h.context.S.data.p = h.full;
  h.run("Object.assign(flState(), {kind:'canvas', who:'ai', q:'no matching file'})");
  await h.start();
  assert.deepEqual(Array.from(h.run("fvList(project()).map(it => it.key)")), [h.first.path, h.second.path]);
  assert.equal(h.run("fvStack(project(), FV.key).length"), 0);
  h.run("fvStep(1)");
  assert.equal(h.opened.at(-1), h.second.path);
  h.run("fvOpen(project(), 'files/beds/one.png')");
  assert.equal(h.run("FV.home"), null);
  assert.equal(h.run("fvList(project()).length"), 0, "the Files viewer still respects its filters");
});

for (const firstResponse of ["home", "full"]) {
  test(`cached full metadata survives an overlapping complete Home poll when ${firstResponse} responds first`, async () => {
    const h = harness(), network = [];
    h.context.S.data.p = h.full;
    h.context.boxesNeedFiles = () => false;
    h.context.pathFor = id => `/projects/${id}`;
    h.context.api = address => { const pending = deferred(); network.push({ address, ...pending }); return pending.promise; };
    h.context.adoptState = state => { h.context.S.data.p = state; };
    const state = fs.readFileSync(path.join(__dirname, "../public/lines/state.js"), "utf8");
    h.run(state.slice(state.indexOf("const stateView ="), state.indexOf("async function loadProjects()")));
    const poll = h.run("loadState('p')"), opening = h.start();
    assert.match(network[0].address, /for=light/);
    assert.equal(network[1].address, "/projects/p/state?for=light&full=beds&parts=files&base=", "the opening asks for the files and its line again");
    const home = () => network[0].resolve({ ...h.partial, view:"home" }), full = () => network[1].resolve(h.full);
    if (firstResponse === "home") { home(); await poll; full(); await opening; }
    else { full(); await opening; home(); await poll; }
    assert.equal(h.context.S.data.p.partial, "");
    assert.deepEqual(h.opened, [h.first.path]);
    assert.match(h.run("flFromHTML(project(), fvItem(project(), FV.key))"), /data-step="ask-1"/);
  });
}

test("only the last picture click may open after delayed metadata", async () => {
  const h = harness(), first = h.start(), second = h.start(h.second.path);
  h.requests[1].resolve(); await second;
  h.requests[0].resolve(); await first;
  assert.deepEqual(h.opened, [h.second.path]);
});

for (const cancel of ["leave and return", "switch project", "Escape", "another viewer", "close"]) {
  test(`pending Home opening is cancelled by ${cancel}`, async () => {
    const h = harness(), done = h.start();
    if (cancel === "leave and return") h.context.navigationTransition += 2;
    if (cancel === "switch project") h.context.S.cur = "other";
    if (cancel === "Escape") h.event("keydown", { key:"Escape" });
    if (cancel === "another viewer") { h.context.S.data.p = h.full; h.run("fvOpen(project(), 'files/beds/two.png')"); }
    if (cancel === "close") h.run("fvClose()");
    h.requests[0].resolve(); await done;
    assert.deepEqual(h.opened, cancel === "another viewer" ? [h.second.path] : []);
  });
}

test("a metadata failure is handled and the next click can retry", async () => {
  const h = harness(), failed = h.start();
  h.requests[0].reject(new Error("Could not load the picture")); await failed;
  assert.deepEqual(h.messages, ["Could not load the picture"]);
  assert.equal(h.opened.length, 0);
  const retry = h.start(); h.requests[1].resolve(); await retry;
  assert.deepEqual(h.opened, [h.first.path]);
});

test("a picture removed while metadata loads gives feedback instead of a broken viewer", async () => {
  const h = harness(), done = h.start(); h.full.files = [];
  h.requests[0].resolve(); await done;
  assert.equal(h.opened.length, 0);
  assert.deepEqual(h.messages, ["This picture is no longer available."]);
});

test("closing returns focus to the current Home picture after its cards were redrawn", async () => {
  const h = harness(); h.context.S.data.p = h.full;
  await h.start(); h.run("fvStep(1)"); h.replaceCards(); h.run("fvClose()");
  assert.deepEqual(h.focused, [h.second.path]);
});

test("browser Back restores a Home viewer, including a picture from a line", async () => {
  const h = harness();
  h.context.S.flViaBack = { hash:"#p" }; h.context.S.flBack = { place:"p:home", key:"files/beds/hidden.png" };
  assert.equal(h.run("fvBackTo('p:home')"), "files/beds/hidden.png");
  h.run("fvPendingTry()");
  assert.equal(h.requests.length, 1);
  h.requests[0].resolve(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.opened, ["files/beds/hidden.png"]);
  assert.ok(h.run("fvList(project()).some(it => it.key === FV.key)"));
  h.run("fvClose()");
  assert.equal(h.run("fvBackTo('p:home')"), "", "ordinary Home navigation does not restore a viewer");
});
