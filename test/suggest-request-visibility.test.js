"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const source = fs.readFileSync("src/client/app/smart-suggestions.js", "utf8");

function fixture() {
  let documentId = "first";
  const stroke = { id:7, historyEntry:{} }, box = { x:100, y:100, w:160, h:80 },
    model = { mode:"suggest", box, cluster:{ box, strokes:[stroke] }, view:{ items:[{ id:"solve" }] } },
    smartSuggest = { requests:new Map(), strokes:[stroke], consumedStrokeId:0, dismissedStrokeId:0, bar:{ ...model } },
    state = { history:[stroke.historyEntry] }, shown = [];
  const context = vm.createContext({ smartSuggest, state, canvasDocumentsCurrent:() => ({ id:documentId }),
    smartSuggestActive:() => true,
    hideAssist:() => { smartSuggest.bar = null; },
    renderAssist:model => { shown.push(model); smartSuggest.bar = { ...model }; },
    assistRefresh:() => { context.refreshed = true; },
    assistAgent:{resultTarget:null}, consumeAllDirtyInput:() => { context.cleared = (context.cleared || 0) + 1; state.dirty = null; },
    releaseDirtyInput:snapshot => { snapshot.released = true; },
    smartSuggestObjectInput:() => ({ objects:context.pendingObjects || [] }),
    scheduleAssist:() => { context.scheduled = true; },
    positionAssist:() => { smartSuggest.bar.hidden = context.assistRequestsHideBar() && smartSuggest.bar.mode !== "result"; },
  });
  vm.runInContext(source.slice(source.indexOf("  function assistRequestsActive("), source.indexOf("  function assistRefresh(")), context);
  return { context, smartSuggest, state, stroke, model, shown, document:value => { documentId = value; } };
}

test("stopping restores the saved suggestion and does not consume its input", () => {
  const h = fixture(), owner = {};
  h.context.assistRequestStarted(owner);
  assert.equal(h.smartSuggest.bar.hidden, false);
  h.smartSuggest.bar = { mode:"working", requestRestoreModel:h.model };
  h.context.assistRequestFinished(owner, "stopped");
  assert.equal(h.smartSuggest.bar.mode, "suggest");
  assert.equal(h.smartSuggest.bar.box, h.model.box);
  assert.equal(h.smartSuggest.bar.hidden, false);
  assert.equal(h.smartSuggest.consumedStrokeId, 0);
  assert.equal(h.smartSuggest.dismissedStrokeId, 0);
  h.context.assistRequestFinished(owner, "completed");
  assert.equal(h.smartSuggest.dismissedStrokeId, 0, "a late completion after Stop cannot dismiss restored help");
});

test("successful requests dismiss old suggestions while preserving result follow-ups", () => {
  const h = fixture(), owner = {};
  h.context.assistRequestStarted(owner);
  h.context.assistRequestFinished(owner, "completed");
  assert.equal(h.smartSuggest.bar, null);
  assert.equal(h.smartSuggest.dismissedStrokeId, 7);
  assert.equal(h.smartSuggest.consumedStrokeId, 0, "presentation dismissal does not consume dirty input");
  const next = { mode:"followup", target:{ resultBox:h.model.box } };
  h.smartSuggest.bar = { ...next };
  h.context.assistRequestStarted(owner);
  const newTarget = { resultBox:{ x:300, y:300, w:100, h:80 } };
  h.smartSuggest.bar = { mode:"followup", target:newTarget };
  h.context.assistRequestFinished(owner, "completed");
  assert.equal(h.smartSuggest.bar.target, newTarget);
  assert.equal(h.smartSuggest.bar.hidden, false);
});

test("overlapping Canvas AI requests keep suggestions visible until they settle", () => {
  const h = fixture(), canvasAI = {}, agent = {};
  h.context.assistRequestStarted(canvasAI);
  h.context.assistRequestStarted(agent);
  h.context.assistRequestFinished(canvasAI, "stopped");
  assert.equal(h.smartSuggest.bar.hidden, false);
  h.context.assistRequestFinished(agent, "stopped");
  assert.equal(h.smartSuggest.bar.hidden, false);
});

test("Suggest clicks hide the bar across Agent handoff while ordinary requests keep it visible", () => {
  const h = fixture(), capture = {}, agent = {}, canvasAI = {};
  h.context.assistRequestStarted(canvasAI);
  assert.equal(h.smartSuggest.bar.hidden, false);
  h.context.assistRequestStarted(capture, { hideSuggestions:true });
  assert.equal(h.smartSuggest.bar.hidden, true);
  h.context.assistRequestStarted(agent, { hideSuggestions:true });
  h.context.assistRequestFinished(capture, "superseded");
  assert.equal(h.smartSuggest.bar.hidden, true);
  h.context.assistRequestStarted(agent);
  assert.equal(h.smartSuggest.bar.hidden, true, "turn_start preserves the Suggest origin");
  h.context.assistRequestFinished(agent, "stopped");
  assert.equal(h.smartSuggest.bar.hidden, false);
  assert.equal(h.smartSuggest.requests.size, 1);
  h.context.assistRequestFinished(canvasAI, "completed");
  assert.equal(h.smartSuggest.bar, null);
});

test("Suggest requests hide working bars while preserving draft approval and result Next", () => {
  for (const outcome of ["completed", "stopped", "failed"]) {
    const h = fixture(), owner = {};
    h.context.assistRequestStarted(owner, { hideSuggestions:true });
    h.smartSuggest.bar = { mode:"working", requestRestoreModel:h.model };
    h.context.positionAssist();
    assert.equal(h.smartSuggest.bar.hidden, true);
    h.context.assistRequestFinished(owner, outcome);
    if (outcome === "completed") {
      assert.equal(h.smartSuggest.dismissedStrokeId, 7);
      assert.equal(h.smartSuggest.bar, null, "completed working bars disappear immediately");
    }
    else assert.equal(h.smartSuggest.bar.mode, "suggest");
  }
  const h = fixture(), owner = {}, next = { resultBox:h.model.box };
  h.context.assistRequestStarted(owner, { hideSuggestions:true });
  h.smartSuggest.bar = { mode:"result" };
  h.context.positionAssist();
  assert.equal(h.smartSuggest.bar.hidden, false, "Keep stays usable during the request");
  h.smartSuggest.bar = { mode:"followup", target:next };
  h.context.assistRequestFinished(owner, "completed");
  assert.equal(h.smartSuggest.bar.target, next);
  assert.equal(h.smartSuggest.bar.hidden, false);
});

test("successful working bars immediately enter the existing Next-result presentation", () => {
  const h = fixture(), owner = {}, target = { box:h.model.box, resultBox:h.model.box };
  h.smartSuggest.bar = { mode:"working", target };
  h.context.assistRequestStarted(owner, { hideSuggestions:true });
  h.context.assistRequestFinished(owner, "completed");
  assert.equal(h.smartSuggest.bar.mode, "followup");
  assert.equal(h.smartSuggest.bar.target, target);
  assert.equal(h.smartSuggest.bar.hidden, false);
});

test("Agent requests keep suggestions visible and preserve them after Stop or failure", () => {
  for (const outcome of ["stopped", "failed"]) {
    const h = fixture(), agent = {};
    h.context.assistRequestStarted(agent);
    assert.equal(h.context.assistRequestsActive(), true);
    assert.equal(h.smartSuggest.bar.hidden, false);
    h.context.assistRequestFinished(agent, outcome);
    assert.equal(h.smartSuggest.bar.mode, "suggest");
    assert.equal(h.smartSuggest.bar.hidden, false);
    assert.equal(h.smartSuggest.dismissedStrokeId, 0);
    assert.equal(h.smartSuggest.consumedStrokeId, 0);
    assert.equal(h.smartSuggest.requests.size, 0);
  }
});

test("a newer lasso survives Agent completion without restoring the old suggestions", () => {
  const h = fixture(), agent = {}, selection = { phase:"active", box:h.model.box };
  h.context.assistRequestStarted(agent);
  h.state.selection = selection;
  h.smartSuggest.selection = selection;
  h.smartSuggest.bar = { ...h.model, cluster:{ selection, box:h.model.box, strokes:[] } };
  vm.runInContext(source.slice(source.indexOf("  function assistSuggestBlocked("), source.indexOf("  function assistRequestsActive(")), h.context);
  h.context.document = { visibilityState:"visible" };
  assert.equal(Boolean(h.context.assistSuggestBlocked()), true, "requests still pause automatic suggestion refreshes");
  h.context.assistRequestFinished(agent, "completed");
  assert.equal(h.state.selection, selection);
  assert.equal(h.smartSuggest.dismissedSelection, undefined);
  assert.equal(h.smartSuggest.bar, null);
});

test("Canvas AI preparation keeps suggestions visible alongside a running Agent", () => {
  const h = fixture(), agent = {}, canvasAI = {};
  h.context.assistRequestStarted(agent);
  h.context.assistRequestStarted(canvasAI);
  assert.equal(h.smartSuggest.bar.hidden, false);
  h.context.assistRequestFinished(canvasAI, "stopped");
  assert.equal(h.smartSuggest.bar.hidden, false);
  assert.equal(h.smartSuggest.requests.size, 1);
  h.context.assistRequestFinished(agent, "stopped");
  assert.equal(h.smartSuggest.bar.hidden, false);
});

test("the Agent begin-request and turn-start hooks preserve suggestions until successful completion", () => {
  const agentSource = fs.readFileSync("src/client/app/canvas-agent-runtime.js", "utf8"), h = fixture(), agent = {};
  Object.assign(h.context, { canvasAgent:agent, canvasAgentDismissPromptSuggestions(){}, canvasAgentSyncTriggerState(){}, canvasAgentPauseAutomaticAI(){}, canvasAgentSyncAutomaticAIStatus(){} });
  const start = agentSource.indexOf("  function canvasAgentBeginRequest("), end = agentSource.indexOf("  function canvasAgentRequestDidNotSend(", start);
  vm.runInContext(agentSource.slice(start, end), h.context);
  h.context.canvasAgentBeginRequest();
  assert.equal(agent.requestPending, true);
  assert.equal(h.smartSuggest.bar.hidden, false);
  const turnStart = agentSource.slice(agentSource.indexOf('    if (event.kind === "turn_start")'), agentSource.indexOf('    else if (event.kind === "user_message"'));
  Object.assign(h.context, { event:{ kind:"turn_start" }, replay:false, canvasAgentSetRunning:value => { agent.running = value; } });
  vm.runInContext(turnStart, h.context);
  assert.equal(agent.running, true);
  assert.equal(h.context.assistRequestsActive(), true);
  assert.equal(h.smartSuggest.requests.size, 1, "turn_start keeps the original restore target");
  assert.equal(h.smartSuggest.bar.hidden, false);
  h.context.assistRequestFinished(agent, "stopped");
  assert.equal(h.smartSuggest.bar.hidden, false);
  h.context.canvasAgentBeginRequest();
  h.context.assistRequestFinished(agent, "completed");
  assert.equal(h.smartSuggest.bar, null);
  assert.equal(h.smartSuggest.dismissedStrokeId, 7);
});

test("new writing and changed documents cannot restore a stale request target", () => {
  const h = fixture(), owner = {};
  h.context.assistRequestStarted(owner);
  h.smartSuggest.strokes.push({ id:8, historyEntry:{} });
  h.context.assistRequestFinished(owner, "stopped");
  assert.equal(h.shown.length, 0);
  assert.equal(h.context.refreshed, true);
  h.context.assistRequestStarted(owner);
  h.document("second");
  assert.equal(h.context.assistRequestsActive(), false);
  h.context.assistRequestStarted(owner);
  assert.equal(h.smartSuggest.requests.get(owner).documentId, "second");
});

test("a successful lasso request stays dismissed but Stop restores an unfinished lasso", () => {
  const h = fixture(), owner = {}, selection = {};
  h.state.selection = selection;
  h.smartSuggest.bar.cluster.selection = selection;
  h.context.assistRequestStarted(owner);
  h.context.assistRequestFinished(owner, "stopped");
  assert.equal(h.smartSuggest.dismissedSelection, undefined);
  h.context.assistRequestStarted(owner);
  h.context.assistRequestFinished(owner, "completed");
  assert.equal(h.smartSuggest.dismissedSelection, selection);
  assert.equal(h.smartSuggest.bar, null);
});

test("completion resumes suggestions for ink added during the request", () => {
  const h = fixture(), owner = {}, newer = { id:8, historyEntry:{} };
  h.context.assistRequestStarted(owner);
  h.smartSuggest.strokes.push(newer);
  h.state.history.push(newer.historyEntry);
  h.context.assistRequestFinished(owner, "completed");
  assert.equal(h.smartSuggest.dismissedStrokeId, 7);
  assert.equal(newer.inputConsumed, undefined);
  assert.equal(h.context.scheduled, true);
});

test("ordinary Agent completion clears all dirty and releases its submitted snapshot", () => {
  const h = fixture(), owner = {}, snapshot = {};
  h.context.assistRequestStarted(owner);
  h.context.assistRequestInputCaptured(owner, snapshot);
  h.smartSuggest.requests.get(owner).canvasWritten=true;
  h.context.assistRequestFinished(owner, "completed");
  assert.equal(h.context.cleared,1);
  assert.equal(h.state.dirty,null);
  assert.equal(snapshot.released,true);
  assert.equal(h.smartSuggest.bar, null);
});

test("new text and images resume suggestions when an Agent turn completes", () => {
  const h = fixture(), owner = {};
  h.context.assistRequestStarted(owner);
  h.context.pendingObjects = [{kind:"text",id:"new-text"},{kind:"image",id:"new-image"}];
  h.context.assistRequestFinished(owner, "completed");
  assert.equal(h.context.scheduled, true);
});

test("Stop, failure and document changes release Agent snapshots without consuming input", () => {
  for (const outcome of ["stopped", "failed", "superseded", "other-document"]) {
    const h = fixture(), owner = {}, snapshot = {};
    h.context.assistRequestStarted(owner);
    h.context.assistRequestInputCaptured(owner, snapshot);
    if (outcome === "other-document") h.document("second");
    h.context.assistRequestFinished(owner, outcome === "other-document" ? "completed" : outcome);
    assert.equal(snapshot.released, true, outcome);
    assert.equal(snapshot.consumed, undefined, outcome);
  }
});

test("all submitted steering snapshots settle once with the Agent turn", () => {
  const h = fixture(), owner = {}, first = {}, second = {};
  h.context.assistRequestStarted(owner);
  h.context.assistRequestInputCaptured(owner, first);
  h.context.assistRequestStarted(owner);
  h.context.assistRequestInputCaptured(owner, second);
  h.smartSuggest.requests.get(owner).canvasWritten=true;
  h.context.assistRequestFinished(owner, "completed");
  assert.equal(h.context.cleared,1);
  h.context.assistRequestFinished(owner, "failed");
  assert.equal(first.released, true);
  assert.equal(second.released, true);
  assert.equal(h.context.cleared,1,"late settlement cannot clear newer input");
});

test("ordinary Agent successful writes without a dirty snapshot clear all; stale completion preserves input",()=>{
  for(const outcome of ["completed","stopped","failed","superseded","recognition"]){
    const h=fixture(),agent={},dirty={x:100,y:100,w:8000,h:5000};
    h.context.canvasAgent=agent;h.state.dirty=dirty;h.state.recognitionGeneration=3;
    h.context.assistRequestStarted(agent);
    h.smartSuggest.requests.get(agent).canvasWritten=true;
    if(outcome==="recognition")h.state.recognitionGeneration++;
    h.context.assistRequestFinished(agent,outcome==="recognition"?"completed":outcome);
    assert.equal(h.state.dirty,outcome==="completed"?null:dirty,outcome);
    assert.equal(h.context.cleared,outcome==="completed"?1:undefined,outcome);
  }
});
test("ordinary Agent completed text and read-only turns preserve all dirty input",()=>{
  for(const captured of [false,true]){
    const h=fixture(),owner={},dirty={x:100,y:100,w:8000,h:5000};
    h.context.canvasAgent=owner;h.state.dirty=dirty;h.context.assistRequestStarted(owner);
    if(captured)h.context.assistRequestInputCaptured(owner,{});
    h.context.assistRequestFinished(owner,"completed");
    assert.equal(h.state.dirty,dirty);assert.equal(h.context.cleared,undefined);
  }
});

test("Agent turn completion clears current dirty; replay, Stop and errors never clear it",()=>{
  const source=fs.readFileSync("src/client/app/canvas-agent-runtime.js","utf8"),start=source.indexOf("  function canvasAgentHandleEvent("),end=source.indexOf("\n  async function ",start);
  for(const reason of ["completed","cancelled","error"])for(const replay of [false,true]){
    const h=fixture(),agent={},dirty={x:100,y:100,w:8000,h:5000};
    h.context.canvasAgent=agent;h.state.dirty=dirty;
    for(const name of ["canvasAgentFlushAssistantRenders","canvasAgentMarkTurnSummaryCopyable","applyCurrentCanvasGeneratedName","canvasAgentSetRunning","canvasAgentErrorRow","canvasAgentSetStatus","canvasAgentScrollToLatest","canvasAgentSyncState","canvasAgentPersistCurrentConversation"])h.context[name]=()=>{};
    h.context.canvasAgentNormalizeError=error=>error;h.context.canvasAgentErrorSummary=()=>"error";
    h.context.assistAgentFinishResult=completed=>{h.context.scopedFinish=completed;};
    vm.runInContext(source.slice(start,end),h.context);
    h.context.assistRequestStarted(agent);
    h.smartSuggest.requests.get(agent).canvasWritten=true;
    h.context.canvasAgentHandleEvent({kind:"turn_end",reason:{kind:reason}}, {replay});
    assert.equal(h.state.dirty,!replay&&reason==="completed"?null:dirty,`${reason}, replay=${replay}`);
    assert.equal(h.context.scopedFinish,replay?undefined:reason==="completed");
  }
});
