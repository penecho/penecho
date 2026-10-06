"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const persistence = fs.readFileSync(require.resolve("../src/client/app/persistence.js"), "utf8"),
  canvas = fs.readFileSync(require.resolve("../src/client/app/canvas-runtime.js"), "utf8"),
  ai = fs.readFileSync(require.resolve("../src/client/app/ai-runtime.js"), "utf8");
function fn(source, name) {
  const start = source.indexOf(`  function ${name}(`), next = source.indexOf("\n  function ", start + 1);
  assert.ok(start >= 0, name);
  return source.slice(start, next);
}
function fixture() {
  const committed = [], resolved = [], statuses = [], state = { mode:"pen", userRevision:4, recognitionGeneration:7, pending:null, pendingWidget:null, hotspotTrail:[] },
    context = { state,
      clearPendingHistoryState:() => { state.pending = null; state.pendingWidget = null; return null; },
      setCanvasMode:mode => { state.mode = mode; }, updateBatchActions(){}, setStatusKey:key => statuses.push(key),
      widgetRecord:record => ({ ...record }), mountWidget(){},
      capturePendingHistoryState:() => ({ pending:state.pending }), recordPendingHistory(){},
      resetCanvasCursor(){}, hideAnimationControls(){}, save:() => ({}), render(){},
      resolvePending:(_pending, value) => resolved.push(value), finishAIDraftHandMode(){},
      clearDirtyContributionTracking(){}, blitSized:(...args) => committed.push(args),
    };
  vm.createContext(context);
  for (const name of ["clonePendingHistoryItem", "clonePendingHistoryDraft", "restorePendingHistoryState"]) vm.runInContext(fn(persistence, name), context);
  vm.runInContext(fn(canvas,"consumeAllDirtyInput"),context);
  for (const name of ["draftBounds", "pendingItemBounds", "acceptPending", "acceptPendingItem", "removePendingItem", "consumePendingInput", "finishPendingItemAction", "rejectPending", "commitPendingBatch", "commitPendingItem"]) vm.runInContext(fn(ai, name), context);
  return { context, state, committed, resolved, statuses };
}
const drawing = () => ({ command:{ tool:"draw" }, image:{ width:550,height:300 }, x:200,y:200,scaleX:1,scaleY:1 });
for (const batch of [false, true]) test(`an Undo-restored ${batch ? "batch" : "single"} drawing can be confirmed again`, () => {
  const h = fixture(), pending = { ...drawing(), recognitionGeneration:0, ...(batch ? { items:[drawing()], selectedIndex:0 } : {}) },
    snapshot = { pending, returnMode:"pen" };
  h.context.restorePendingHistoryState({ pendingBefore:snapshot }, "before");
  assert.equal(h.state.pending.recognitionGeneration, h.state.recognitionGeneration);
  assert.equal(pending.recognitionGeneration, 0, "restoring must not change the stored history snapshot");
  if (batch) h.context.acceptPendingItem(0);
  else h.context.acceptPending();
  assert.equal(h.committed.length, 1, "confirmation must commit the restored image");
  assert.equal(h.state.pending, null);
  assert.ok(!h.statuses.includes("canvasChanged"));
  assert.deepEqual(JSON.parse(JSON.stringify(h.resolved)), batch ? [{ acceptedCount:1 }] : [true]);
});
test("a restored Widget draft belongs to the current recognition generation", () => {
  const h = fixture(); h.state.nextWidgetId = 1;
  const widget = { id:"widget-8", pluginId:"general", html:"<p>Keep</p>" };
  h.context.restorePendingHistoryState({ pendingBefore:{ pendingWidget:widget, returnMode:"pen" } }, "before");
  assert.equal(h.state.pendingWidget.recognitionGeneration, h.state.recognitionGeneration);
  assert.equal(h.state.nextWidgetId, 9);
});
test("a generation invalidation after history restoration still blocks confirmation", () => {
  const h = fixture();
  h.context.restorePendingHistoryState({ pendingBefore:{ pending:drawing() } }, "before");
  h.state.recognitionGeneration++;
  h.context.acceptPending();
  assert.equal(h.committed.length, 0);
  assert.equal(h.state.pending, null);
  assert.equal(h.statuses.at(-1), "canvasChanged");
});
