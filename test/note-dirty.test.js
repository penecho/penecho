"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const read = file => fs.readFileSync(require.resolve(`../src/client/app/${file}.js`), "utf8");
function sourceFunction(source, name) {
  const start = source.search(new RegExp(`  (?:async )?function ${name}\\(`)), next = source.indexOf("\n  function ", start + 1), asyncNext = source.indexOf("\n  async function ", start + 1);
  assert.ok(start >= 0, name);
  return source.slice(start, Math.min(...[next, asyncNext, source.length].filter(index => index > start)));
}
function localFixture({ libraryFailure = false, insertionFailure = false } = {}) {
  const calls = [], inputSnapshot = {}, selection = { phase:"active" }, state = { widgets:[], selection, userRevision:1, dirty:{x:10,y:20,w:900,h:800} }, noteCards = { knownIds:new Set() };
  let documentId = "source", releaseLibrary;
  const context = vm.createContext({
    state, noteCards, aiPreparationGeneration:0, MAX_VISIBLE_WIDGETS:10, canvasDocumentsCurrent:() => ({id:documentId}),
    noteCardRuntime:() => ({}), noteCopy:en => en, t:key => key,
    noteLibraryLoad:() => new Promise(resolve => { releaseLibrary = resolve; }), enableSnapshotWidgetPlugins:async () => {},
    noteCardWidgetFields:note => ({...note,id:"result"}), noteCardPlacement:() => ({x:100,y:200,w:300,h:400}),
    widgetRecord:record => insertionFailure ? null : record, pluginEnabled:() => false,
    recordWidgetsBefore:() => calls.push("record-before"), saveUserCanvasChange:() => calls.push("commit"),
    consumeDirtyInput:snapshot => { assert.equal(snapshot,inputSnapshot);calls.push("consume"); },
    releaseDirtyInput:snapshot => { assert.equal(snapshot,inputSnapshot); calls.push("release"); },
    requestRender(){}, noteLibraryUpsertWidget:async () => { if (libraryFailure) throw Error("Library unavailable"); }, noteLibraryPersist:async () => {},
    hideAssist(){}, setStatus(){}, showNoteChooser:() => calls.push("chooser"),
    cancelSelection:() => { state.selection=null; },
  });
  const source = read("note-cards");
  for (const name of ["noteCardInsert", "noteFinishLocal"]) vm.runInContext(sourceFunction(source,name),context);
  return { calls, state, inputSnapshot, selection, context, release:() => releaseLibrary(), switchDocument:() => { documentId="other"; } };
}
test("local Note consumes captured input after its undoable commit and releases tracking", async () => {
  const h = localFixture(), pending = h.context.noteFinishLocal({},null,h.selection,"",h.inputSnapshot,"source");
  assert.deepEqual(h.calls,[]);
  h.release(); assert.equal(await pending,true);
  assert.deepEqual(h.calls,["record-before","commit","consume","chooser","release"]);
});
test("a library failure after local Note commit cannot leave its source dirty", async () => {
  const h = localFixture({libraryFailure:true}), pending = h.context.noteFinishLocal({},null,h.selection,"",h.inputSnapshot,"source");
  h.release(); await pending;
  assert.equal(h.state.widgets.length,1);
  assert.deepEqual(h.calls,["record-before","commit","consume","release"]);
});
test("failed local Note insertion preserves its captured input", async () => {
  const h = localFixture({insertionFailure:true}), pending = h.context.noteFinishLocal({},null,h.selection,"",h.inputSnapshot,"source");
  h.release(); assert.equal(await pending,false);
  assert.equal(h.state.widgets.length,0); assert.deepEqual(h.calls,["release"]);
});
test("switching documents during local Note preparation cannot insert or consume there", async () => {
  const h = localFixture(), pending = h.context.noteFinishLocal({},null,h.selection,"",h.inputSnapshot,"source");
  h.switchDocument();h.release();assert.equal(await pending,false);
  assert.equal(h.state.widgets.length,0);assert.deepEqual(h.calls,["release"]);
});
test("Note captures its input before asynchronous media capture and releases a cancelled capture", async () => {
  const selection={phase:"active"}, state={selection}, snapshot={}, calls=[];let finish;
  const context = vm.createContext({state,aiPreparationGeneration:0,noteCardRuntime:() => ({}),canvasDocumentsCurrent:() => ({id:"source"}),
    captureSelectionDirtyInput:input => {assert.equal(input,selection);calls.push("capture-input");return snapshot;},
    noteCaptureSelection:() => {calls.push("capture-media");return new Promise(resolve=>{finish=resolve;});},
    renderAssist(){},noteCopy:en=>en,releaseDirtyInput:input=>{assert.equal(input,snapshot);calls.push("release");},
    organizeCapturedAsNote:() => assert.fail("a cancelled capture cannot create a note"),
  });
  vm.runInContext(sourceFunction(read("note-cards"),"organizeSelectionAsNote"),context);
  const pending=context.organizeSelectionAsNote({selection,box:{x:10,y:20,w:30,h:40}});
  assert.deepEqual(calls,["capture-input","capture-media"]);
  state.selection=null;finish({});assert.equal(await pending,false);
  assert.deepEqual(calls,["capture-input","capture-media","release"]);
});
test("selection AI reuses caller-owned Note input through the asynchronous fallback", async () => {
  const selection={phase:"active"}, snapshot={}, calls=[],context=vm.createContext({state:{selection},aiPreparationGeneration:0,
    supersedeActiveAI(){},setStatusKey(){},selectionAIStatusKey:()=>"observing",updateSelectionToolbar(){},renderInteractionLayer(){},
    captureSelectionDirtyInput:() => assert.fail("Note input must not be recaptured after later handwriting"),
    releaseDirtyInput:() => assert.fail("Note fallback still owns the captured input"),
    requestAI:async (_action,_packed,options) => {assert.equal(options.inputSnapshot,snapshot);options.onSettled({completed:false});},
  });
  vm.runInContext(sourceFunction(read("core"),"requestSelectionAI"),context);
  assert.equal(context.requestSelectionAI("answer",selection,{sourceRect:{}},{inputSnapshot:snapshot,onSettled:outcome=>calls.push(outcome.completed)}),true);
  await Promise.resolve();assert.deepEqual(calls,[false]);assert.equal(selection.aiRequest,null);
});

test("new pen input cancels a local Note waiting for library preparation and retains its input", async () => {
  const h=localFixture(),pending=h.context.noteFinishLocal({},null,h.selection,"",h.inputSnapshot,"source");
  h.context.aiPreparationGeneration++;h.release();assert.equal(await pending,false);
  assert.equal(h.state.widgets.length,0);assert.deepEqual(h.calls,["release"]);
});

test("selection Note reports cancellation during request preparation without creating a fallback", async () => {
  const selection={phase:"active"},snapshot={},outcomes=[];let finish;
  const context=vm.createContext({state:{selection},aiPreparationGeneration:1,
    supersedeActiveAI(){},setStatusKey(){},selectionAIStatusKey:()=>"observing",updateSelectionToolbar(){},renderInteractionLayer(){},
    requestAI:()=>new Promise(resolve=>{finish=resolve;}),
  });
  vm.runInContext(sourceFunction(read("core"),"requestSelectionAI"),context);
  context.requestSelectionAI("answer",selection,{sourceRect:{}},{inputSnapshot:snapshot,onSettled:outcome=>outcomes.push(outcome)});
  context.aiPreparationGeneration++;finish();await Promise.resolve();
  assert.equal(outcomes.length,1);assert.equal(outcomes[0].superseded,true);assert.equal(outcomes[0].started,false);
});

for (const selected of [false,true]) for (const reason of ["failure", "cancelled", "rejected", "empty"]) test(`${selected ? "Lasso" : "Canvas"} Note AI ${reason} preserves dirty when its local fallback is committed`, async () => {
  const h=localFixture(),dirty=h.state.dirty;let requestOptions,finished;
  const settled=new Promise(resolve=>{finished=resolve;}),finishLocal=h.context.noteFinishLocal;
  Object.assign(h.context,{
    noteCardRuntime:()=>({noteFromParts:()=>({title:"Local fallback"})}),
    noteCardPlacement:()=>({x:100,y:200,w:300,h:400}),noteCategories:()=>[],smartSuggestRecent(){},
    hasSelectedAiConnection:()=>true,window:{PENECHO_CONFIG:{}},noteCategoryHint:()=>"Create a note",
    assistRequestOptions:()=>({}),requestAI:(_action,_image,options)=>{requestOptions=options;return Promise.resolve();},
    requestSelectionAI:(_action,_selection,_image,options)=>{requestOptions=options;return true;},
    noteFinishLocal:(...args)=>{const pending=finishLocal(...args);pending.then(finished);return pending;},
  });
  vm.runInContext(sourceFunction(read("note-cards"),"organizeCapturedAsNote"),h.context);
  const target=selected ? {selection:h.selection} : {canvasInput:true};
  assert.equal(h.context.organizeCapturedAsNote(target,{items:[{}],box:dirty},()=>({sourceRect:dirty}),h.inputSnapshot),true);
  requestOptions.onSettled({completed:false,superseded:false,reason});
  h.release();assert.equal(await settled,true);
  assert.equal(h.state.widgets.length,1);assert.equal(h.state.dirty,dirty);
  assert.deepEqual(h.calls,["record-before","commit","chooser","release"]);
});
