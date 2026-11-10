"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const functionSource = (file, name) => {
  const source = read(file).match(new RegExp(`function ${name}\\([^]*?\\n  \\}`))?.[0];
  assert.ok(source, name);
  return source;
};

function fixture(action = "normalize", changed = false) {
  const token = {}, selection = { phase:"active", aiRequest:{token, action},
    originalBox:{x:10,y:20,w:100,h:60}, box:{x:40,y:50,w:200,h:120},
    fragments:[{image:"original", renderImage:"recolored", x:10,y:20,w:100,h:60}] };
  const pending = {selection}, run = {isolatedSelection:true, selection, selectionRequestToken:token, action};
  const state = {selection, pending, activeAI:run, selectionGesture:{id:1}, userRevision:4}, calls = [];
  const release = vm.runInNewContext(`(${functionSource("src/client/app/persistence.js", "releaseSelectionAITransformLock")})`, {
    state, selectionHasChanges:() => changed, SELECT:require("../public/selection.js"),
    restoreSelectionSource:s => { assert.equal(s, selection); calls.push("restore"); },
    blitSized:(...args) => calls.push(args), invalidateSelectionInkTracking:() => calls.push("tracking"),
    saveUserCanvasChange:() => calls.push("save"), resetCanvasCursor:() => calls.push("cursor"),
    updateSelectionToolbar:() => calls.push("toolbar"),
  });
  return {state, selection, pending, run, calls, release};
}

test("a visible Typeset draft ends the source selection and preserves its request and original ink", () => {
  const h = fixture();
  h.release();
  assert.equal(h.state.selection, null);
  assert.equal(h.state.selectionGesture, null);
  assert.equal(h.selection.aiRequest, null);
  assert.equal(h.state.activeAI, h.run, "ending the source selection does not abort the model request");
  assert.equal(h.state.pending, h.pending, "the Typeset draft still waits for confirmation");
  assert.equal(h.state.userRevision, 4);
  assert.deepEqual(h.calls, ["restore", "cursor", "toolbar"], "unchanged handwriting is restored without a new document edit");
});

test("Typeset preserves the selected ink's moved, resized and recolored appearance", () => {
  const h = fixture("normalize", true);
  h.release();
  assert.deepEqual(h.calls[0], ["recolored", 40, 50, 200, 120]);
  assert.deepEqual(h.calls.slice(1), ["tracking", "save", "cursor", "toolbar"]);
  assert.equal(h.state.userRevision, 5);
  assert.equal(h.state.selection, null);
  assert.equal(h.state.pending, h.pending);
});

test("selection requests without a visible result retain their source", () => {
  for (const action of ["answer", "plot", "normalize"]) {
    const h = fixture(action);
    h.state.pending = null;
    h.release();
    assert.equal(h.state.selection, h.selection, action);
    assert.deepEqual(h.calls, ["toolbar"]);
  }
});

test("all visible selection AI drafts release their source while retaining result controls", () => {
  for (const action of ["answer", "plot", "normalize"]) {
    const h = fixture(action);
    h.release();
    assert.equal(h.state.selection, null, action);
    assert.equal(h.state.activeAI, h.run);
    assert.equal(h.state.pending, h.pending);
    assert.deepEqual(h.calls, ["restore", "cursor", "toolbar"]);
  }
});

test("a generated Note Widget releases its source before insertion", () => {
  const h = fixture("answer");
  h.state.pending = null;
  h.state.pendingWidget = { id:"note-widget" };
  h.release();
  assert.equal(h.state.selection, null);
  assert.equal(h.state.pendingWidget.id, "note-widget");
  assert.equal(h.state.activeAI, h.run);
  assert.deepEqual(h.calls, ["restore", "cursor", "toolbar"]);
});

test("an old Typeset result cannot close a newer selection or request", () => {
  for (const changed of ["selection", "token"]) {
    const h = fixture();
    if (changed === "selection") h.state.selection = {phase:"active"};
    else h.selection.aiRequest = {token:{}, action:"answer"};
    const current = h.state.selection;
    h.release();
    assert.equal(h.state.selection, current);
    assert.deepEqual(h.calls, []);
  }
});

test("closing the Typeset source selection retains the result controls with a reusable retry target", () => {
  const previous = {}, target = {selection:previous, selectionKey:"selection:3", box:{x:10,y:20,w:100,h:60}},
    bar = {mode:"working", target, action:{id:"typeset"}}, shown = [], state = {selection:null, pending:{selection:previous}, activeAI:{action:"normalize"}},
    smartSuggest = {selection:previous, selectionKey:"old", selectionVersion:3, bar};
  const sync = vm.runInNewContext(`(${functionSource("src/client/app/smart-suggestions.js", "syncSelectionSuggestions")})`, {
    state, smartSuggest, smartSuggestSyncDocument(){},
    cancelSmartSuggest:() => { smartSuggest.bar = null; },
    renderAssist:model => shown.push(model), assistPendingBox:() => ({x:200,y:20,w:80,h:60}),
    assistUnion:(a,b) => ({x:a.x,y:a.y,w:b.x+b.w-a.x,h:60}),
    scheduleAssist:() => assert.fail("completed Typeset must not reopen source suggestions"),
  });
  sync();
  assert.equal(smartSuggest.selection, null);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].mode, "result");
  assert.equal(shown[0].action, bar.action);
  assert.equal(shown[0].target.selection, null, "Retry can capture the handwriting again instead of using a closed selection");
  assert.equal(shown[0].target.selectionKey, null);
  assert.deepEqual(shown[0].target.box, target.box);
});
