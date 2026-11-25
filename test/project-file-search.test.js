"use strict";
require("./helpers/safety.js");
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = name => fs.readFileSync(path.join(__dirname, `../public/lines/${name}.js`), "utf8");
const turn = () => new Promise(resolve => setImmediate(resolve));

// Exercise the real state loader, Files refresh and input/focus handlers with independently delayed state and focus events.
function harness(view = "files") {
  const events = {}, windowEvents = {}, queued = [], calls = { render:0, chrome:0, viewer:0 };
  const body = { dataset:{}, innerHTML:"" }, sheet = { dataset:{} }, other = { id:"other", isConnected:true };
  const document = { hidden:false, activeElement:other, focused:true, hasFocus() { return this.focused; },
    addEventListener(name, fn) { (events[name] ||= []).push(fn); } };
  const emit = (name, target, extra = {}) => { for (const fn of events[name] || []) fn({ target, ...extra }); };
  const input = { id:"flQ", isConnected:true, value:"", selectionStart:0, selectionEnd:0, selectionDirection:"none", focusCalls:0,
    closest:() => ({ contains:el => el === input || el.id === "search-icon" }),
    focus(options) { this.focusCalls++; this.focusOptions = options; document.activeElement = this; emit("focusin", this); },
    setSelectionRange(start, end, direction = "none") { this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction; } };
  let mounted = true, respond;
  const response = new Promise(resolve => { respond = resolve; });
  const context = vm.createContext({ document, ICONS:{}, ACT:{}, HOSTED:false, can:() => true, EMBED:null, navigationTransition:0,
    navigator:{ platform:"MacIntel" }, localStorage:{ getItem:() => null }, queueMicrotask:fn => queued.push(fn), setTimeout:fn => { queued.push(fn); return queued.length; },
    addEventListener:(name, fn) => (windowEvents[name] ||= []).push(fn),
    $:selector => selector === "#flBody" ? mounted && body : selector === "#flSheet" ? sheet : selector === "#flQ" ? input : null,
    $$:() => [], fetch:async () => ({ ok:true, status:200, json:async () => response }),
    boxesNeedFiles:() => false, canvasGroups:() => [], av:() => "", ic:() => "", esc:String, shortWhen:() => "Today", assetUrl:(_p, f) => f,
    refreshChrome:() => calls.chrome++, refreshReaders() {}, fvRefresh:() => calls.viewer++,
    render:() => { calls.render++; input.isConnected = false; document.activeElement = other; },
  });
  const run = code => vm.runInContext(code, context);
  run(source("line-status"));
  run(source("state"));
  run(source("files"));
  const pages = source("pages");
  run(pages.slice(pages.indexOf("function refreshAfterChange()"), pages.indexOf("// ---------- Memory and files ----------")));
  run(`S.cur='p'; S.route={view:${JSON.stringify(view)}}; S.data.p={id:'p',code:true,partial:'home',lines:[],landed:[],backlog:[],files:[],pictures:[]}`);
  const complete = async () => {
    respond({ format:2, rev:"full", project:{ id:"p", code:true }, lines:[], landed:[], backlog:[],
      files:[{ path:"files/lines.txt", title:"lines.txt", kind:"document", by:"you", mtime:Date.now() }] });
    await turn();
  };
  const type = words => { for (const ch of words) { input.value += ch; input.setSelectionRange(input.value.length, input.value.length); emit("input", input); } };
  const preview = { id:"", isConnected:true };
  context.preview = preview;
  run("flPreviews.set({}, {frame:preview})");
  return { context, document, input, other, body, preview, calls, run, emit, type, complete,
    blurWindow:() => { for (const fn of windowEvents.blur || []) fn(); },
    flush:() => { while (queued.length) queued.shift()(); },
    unmount:() => { mounted = false; },
    steal(frame = preview) { document.activeElement = frame; emit("focusout", input); },
  };
}

// A change that arrives while you type in the search is shown in place.
const readAgain = h => h.run("loadState('p', { force:true }).then(() => { if (S.cur === 'p') refreshAfterChange(); })");
for (const view of ["files", "canvases"]) test(`${view}: a delayed state preserves search, selection and results`, async () => {
  const h = harness(view);
  readAgain(h);
  h.input.focus(); h.type("line"); h.input.setSelectionRange(1, 3, "backward");
  await h.complete();
  assert.equal(h.calls.render, 0);
  assert.equal(h.calls.chrome, 1);
  assert.equal(h.calls.viewer, 1);
  assert.equal(h.document.activeElement, h.input);
  assert.equal(h.input.isConnected, true);
  assert.equal(h.input.value, "line");
  assert.deepEqual([h.input.selectionStart, h.input.selectionEnd, h.input.selectionDirection], [1, 3, "backward"]);
  assert.match(h.body.innerHTML, /lines\.txt/);
  h.type("s");
  assert.equal(h.run("flState().q"), "lines");
  assert.equal(h.document.activeElement, h.input);
});

test("hydration does not pull focus back after the user leaves the search", async () => {
  const h = harness(); readAgain(h);
  h.input.focus(); h.type("li"); h.emit("pointerdown", h.other);
  h.document.activeElement = h.other; h.emit("focusin", h.other);
  await h.complete();
  assert.equal(h.document.activeElement, h.other);
  assert.equal(h.input.focusCalls, 1);
});

test("older browsers recover focus and selection only when a registered preview steals it", () => {
  const h = harness(); h.input.focus(); h.type("lines"); h.input.setSelectionRange(1, 4, "backward");
  h.steal(); h.blurWindow(); h.flush();
  assert.equal(h.document.activeElement, h.input);
  assert.equal(h.input.focusCalls, 2, "focusout and window blur share one recovery");
  assert.equal(h.input.focusOptions.preventScroll, true);
  assert.deepEqual([h.input.selectionStart, h.input.selectionEnd, h.input.selectionDirection], [1, 4, "backward"]);
  assert.equal(h.input.value, "lines");
});

test("pressing the search icon keeps the current editing session", () => {
  const h = harness(); h.input.focus();
  h.emit("pointerdown", { id:"search-icon" }); h.steal(); h.flush();
  assert.equal(h.document.activeElement, h.input);
});

for (const mode of ["outside pointer", "Tab", "Escape", "other control", "hidden", "unfocused", "project", "view", "navigation", "disconnected input", "removed preview", "unregistered frame", "stale edit"]) {
  test(`preview focus recovery respects ${mode}`, () => {
    const h = harness(); h.input.focus(); h.type("li"); h.steal();
    if (mode === "outside pointer") h.emit("pointerdown", h.other);
    if (["Tab", "Escape"].includes(mode)) h.emit("keydown", h.input, { key:mode });
    if (mode === "other control") { h.document.activeElement = h.other; h.emit("focusin", h.other); h.document.activeElement = h.preview; }
    if (mode === "hidden") h.document.hidden = true;
    if (mode === "unfocused") h.document.focused = false;
    if (mode === "project") h.run("S.cur='other'");
    if (mode === "view") h.run("S.route={view:'home'}");
    if (mode === "navigation") h.run("navigationTransition++");
    if (mode === "disconnected input") h.input.isConnected = false;
    if (mode === "removed preview") h.preview.isConnected = false;
    if (mode === "unregistered frame") h.run("flPreviews.clear()");
    if (mode === "stale edit") { h.input.focus(); h.document.activeElement = h.preview; }
    const count = h.input.focusCalls;
    h.flush();
    assert.equal(h.input.focusCalls, count, "no stale or intentional exit may refocus search");
  });
}
