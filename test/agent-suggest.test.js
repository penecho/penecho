"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, ".."),
  source = fs.readFileSync(path.join(ROOT, "src/client/app/agent-suggest.js"), "utf8"),
  runtime = fs.readFileSync(path.join(ROOT, "src/client/app/canvas-agent-runtime.js"), "utf8"),
  SMART_SUGGEST = require("../public/smart-suggest.js");

function promptLibrary() {
  const start = runtime.indexOf("CANVAS_AGENT_PROMPT_LIBRARY ="), end = runtime.indexOf("CANVAS_AGENT_PROMPT_ICON_PATHS =", start);
  return vm.runInNewContext(`(${runtime.slice(start + "CANVAS_AGENT_PROMPT_LIBRARY =".length, end).trim().replace(/,$/, "")})`);
}

// A small fake of the Agent panel and Canvas: enough for the trigger policy.
function scene({ available = true, enabled = true, blocked = false } = {}) {
  const timers = new Map(), requests = [], element = () => ({ hidden:false, dataset:{}, attributes:{}, children:[], textContent:"",
    setAttribute(name, value) { this.attributes[name] = String(value); }, querySelector() { return null; }, replaceChildren(...nodes) { this.children = nodes; }, append(...nodes) { this.children.push(...nodes); } });
  let nextTimer = 1, now = 1_000_000;
  const input = { value:"", disabled:false }, document = { activeElement:input, querySelector:() => null, createElement:element };
  const context = {
    console, JSON, Math, Number, String, Boolean, Array, Object, Map, Set, WeakMap, Promise, Error,
    document, SIZE:1000, SMART_SUGGEST, SMART_SUGGEST_CROP_SIDE:512, WIDGET_CLASSIFY_SNAPSHOT_REUSE_MS:2000,
    state:{ language:"en", history:[], userRevision:0, widgets:[], images:[], textBoxes:[], animations:[], preservedSnapshotAnimations:[], selection:null },
    canvasAgent:{ attachments:[], projectId:"", running:false, requestPending:false, pendingApproval:null, attachmentBusy:false, projectUploadBusy:false, promptSuggestionsExpanded:false, promptSuggestionsIntent:false, promptSuggestionsDismissed:false },
    canvasAgentPanel:{ hidden:false }, canvasAgentInput:input,
    smartSuggest:{ available, enabled, nextStrokeId:1, availability:{ checkedAt:1 }, access:null },
    CANVAS_AGENT_PROMPT_LIBRARY:promptLibrary(),
    canvasAgentPromptSuggestionsAvailable:() => true,
    canvasAgentSyncPromptPresentation:visible => { context.canvasAgent.promptSuggestionsExpanded=Boolean(visible); },
    canvasAgentDismissPromptSuggestions:() => {
      context.canvasAgent.promptSuggestionsIntent=false;context.canvasAgent.promptSuggestionsDismissed=true;
      context.agentSuggestCancelPending();context.canvasAgent.promptSuggestionsExpanded=false;
    },
    canvasAgentProjectById:() => context.project || null,
    canvasAgentReferencedIds:() => [],
    canvasAgentPromptFileContext:resource => /\.xlsx$/.test(resource.name) ? "spreadsheet" : /\.ts$/.test(resource.name) ? "code" : "file",
    canvasDocumentsCurrent:() => ({ id:"doc-1" }),
    visibleInkBounds:() => context.ink ? { x:1, y:1, w:10, h:10 } : null,
    canvasAgentContentBounds:() => null,
    suggestionAccessBlocked:() => blocked,
    suggestionAllowance:() => null, suggestionAllowanceShort:() => "", suggestionAllowanceLines:() => [],
    updateSuggestionAccess() {}, authenticatedApiHeaders:headers => headers, suggestionApiPath:() => "/api/suggest", debug() {}, t:key => key,
    performance:{ now:() => now },
    Date:{ now:() => now },
    AbortController,
    setTimeout(callback) { const id = nextTimer++; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch:async (url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      if(context.responseWait)await context.responseWait;
      if(context.failResponse)throw Error("offline");
      const answers = context.emptyResponse ? {} : Object.fromEntries(body.context.prompts.map((id, index) => [`prompt_${id}`, { type:"noul", noul:context.lowResponse ? .02 : ([0.82, 0.46, 0.44, 0.11, 0.1, 0.02][index] ?? 0.01) }]));
      return { ok:true, status:200, json:async () => ({ ok:true, answers }) };
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return {
    context, input, requests, timers,
    call(code) { return vm.runInContext(code,context); },
    async focus() { context.agentSuggestComposerFocused();this.flushTimers();await this.settle(); },
    async click() { context.agentSuggestComposerClicked();this.flushTimers();await this.settle(); },
    advance(ms) { now += ms; },
    flushTimers() { const pending = [...timers.values()]; timers.clear(); for (const callback of pending) callback(); },
    async settle() { for (let index = 0; index < 8; index++) await new Promise(resolve => setImmediate(resolve)); },
  };
}

test("Agent Suggest combines Canvas actions with Agent requests in the candidate space", () => {
  const library = promptLibrary(), canvasActions = Object.values(library).map(item => item.canvasAction).filter(Boolean);
  for (const id of ["plot", "typeset", "solve", "check_step", "next_step", "hint", "practice", "snap_shapes", "diagram", "prototype", "organize", "answer", "create_visual", "explain", "animate", "finish_drawing", "vivid", "animate_sketch", "refine"])
    assert.ok(canvasActions.includes(id), `Canvas action ${id} needs a fuller Agent request`);
  const { context } = scene();
  context.ink = true;
  context.canvasAgent.attachments = [{ id:"a", kind:"file", name:"budget.xlsx" }];
  context.project = { id:"p", kind:"folder" };
  const ids = vm.runInContext("agentSuggestCandidates(agentSuggestSnapshot())", context);
  assert.ok(ids.length <= 40, "Cloud accepts at most 40 requests");
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(Array.from(ids.slice(0, 4)), ["spreadsheetVisual", "excel", "spreadsheetLayer", "spreadsheetPublish"], "explicit attachments rank first");
  for (const id of ["projectEvidence", "solveProblem", "checkWork"]) assert.ok(ids.includes(id), id);
  for (const id of ["transformer", "ukTrip"]) assert.ok(!ids.includes(id), "fixed examples are not contextual");
});

test("Agent Suggest lists requests above 10% and highlights at the Canvas Suggest threshold", () => {
  const { context } = scene();
  assert.equal(SMART_SUGGEST.POLICY.confident, 0.45);
  const items = vm.runInContext(`agentSuggestRankAnswers({prompt_a:{noul:.11},prompt_b:{noul:.1},prompt_c:{noul:.82},prompt_d:{noul:.45},prompt_e:{noul:.449}},["a","b","c","d","e"])`, context);
  assert.deepEqual(Array.from(items, item => item.id), ["c", "d", "e", "a"]);
  assert.deepEqual(Array.from(items, item => vm.runInContext("agentSuggestHighlighted", context)(item)), [true, true, false, false]);
});


test("Agent Suggest falls back to the top three valid scores only when none exceed 10%", () => {
  const { context } = scene(), rank = context.agentSuggestRankAnswers;
  const answers = { prompt_a:{noul:.02}, prompt_b:{noul:.1}, prompt_c:{noul:.08}, prompt_d:{noul:.04}, prompt_e:{noul:0} };
  const items = rank(answers, ["a", "b", "c", "d", "e"]);
  assert.deepEqual(Array.from(items, item => item.id), ["b", "c", "d"]);
  assert.ok(items.every(item => !context.agentSuggestHighlighted(item)));
  answers.prompt_a.noul = .11;
  assert.deepEqual(Array.from(rank(answers, ["a", "b", "c", "d", "e"]), item => item.id), ["a"], "do not pad above-floor results");
  assert.deepEqual(Array.from(rank(answers, ["c", "e"]), item => item.id), ["c", "e"], "fewer than three valid results are retained, including zero");
  assert.equal(rank({prompt_a:{noul:null},prompt_b:{noul:NaN},prompt_c:{noul:Infinity},prompt_d:{noul:-.1},prompt_e:{noul:1.1}}, ["a", "b", "c", "d", "e", "missing"]).length, 0);
});

test("focus presents and caches the top three when every returned score is below the floor", async () => {
  const run = scene(), { context } = run;
  context.ink = true;
  context.lowResponse = true;
  await run.focus();
  assert.equal(context.canvasAgent.promptSuggestionsExpanded, true);
  assert.equal(context.agentSuggest.items.length, 3);
  assert.ok(context.agentSuggest.items.every(item => item.p === .02));
  context.canvasAgentDismissPromptSuggestions();
  await run.focus();
  assert.equal(run.requests.length, 1, "the fallback reuses the successful ranking");
  assert.equal(context.canvasAgent.promptSuggestionsExpanded, true);
});

test("focus ranks with existing text and continued typing; content changes alone never trigger",async()=>{
  const run=scene(),{context,input}=run;
  input.value="An unfinished question";await run.focus();assert.equal(run.requests.length,0,"blank canvas");
  context.ink=true;context.smartSuggest.nextStrokeId++;
  context.agentSuggestSync();await run.settle();assert.equal(run.requests.length,0);
  context.agentSuggestComposerFocused();input.value+=" while ranking";
  context.agentSuggestSync();run.flushTimers();await run.settle();
  assert.equal(run.requests.length,1);assert.equal(run.requests[0].mode,"agent");
  assert.equal(input.value,"An unfinished question while ranking");
  assert.equal(context.canvasAgent.promptSuggestionsExpanded,true);
  await run.focus();assert.equal(run.requests.length,1,"same context is cached");
});

test("cold availability resumes the originating focus, but dismissal while checking prevents inference",async()=>{
  for(const dismiss of [false,true]){
    const run=scene({available:false}),{context}=run;context.ink=true;
    let finish;context.smartSuggest.availability.pending=new Promise(resolve=>{finish=()=>{context.smartSuggest.available=true;resolve();};});
    context.agentSuggestComposerFocused();run.flushTimers();await run.settle();assert.equal(run.requests.length,0);
    if(dismiss)context.canvasAgentDismissPromptSuggestions();
    finish();await run.settle();assert.equal(run.requests.length,dismiss?0:1);
    assert.equal(context.canvasAgent.promptSuggestionsExpanded,!dismiss);
  }
});

test("attachments, projects, strokes, AI widgets and MCP edits rank on next focus, including rapid changes",async()=>{
  const run=scene(),{context}=run;
  context.canvasAgent.attachments=[{id:"file",kind:"file",name:"budget.xlsx"}];await run.focus();
  assert.equal(run.requests.length,1);assert.deepEqual(Array.from(run.requests[0].context.attachments),["spreadsheet"]);
  const edits=[()=>{context.project={id:"p",kind:"folder"};context.canvasAgent.projectId="p";},()=>{context.ink=true;context.smartSuggest.nextStrokeId++;},()=>{context.state.widgets.push({id:"ai"});context.state.history.push({widgetsAfter:[{id:"ai"}]});},()=>{context.state.userRevision++;}];
  for(const edit of edits){const before=run.requests.length;edit();context.agentSuggestSync();await run.settle();assert.equal(run.requests.length,before);await run.focus();assert.equal(run.requests.length,before+1);}
  assert.equal(context.state.dirty,undefined,"AI output does not become dirty input");
  context.state.userRevision--;await run.focus();assert.equal(run.requests.length,5,"Undo reuses a cached context");
});

test("Agent and Canvas AI work block focus requests and completing work does not retry",async()=>{
  for(const blocker of ['running','requestPending','canvas','preparing','selection','assist']){
    const run=scene(),{context}=run;context.ink=true;
    if(blocker==='running'||blocker==='requestPending')context.canvasAgent[blocker]=true;
    if(blocker==='canvas')context.state.activeAI={};
    if(blocker==='preparing')context.aiPreparation={};
    if(blocker==='selection')context.state.selection={box:{x:1,y:1,w:2,h:2},aiRequest:{}};
    if(blocker==='assist')context.assistRequestsActive=()=>true;
    await run.focus();assert.equal(run.requests.length,0,blocker);
    context.canvasAgent.running=false;context.canvasAgent.requestPending=false;context.state.activeAI=null;context.aiPreparation=null;context.state.selection=null;context.assistRequestsActive=()=>false;
    context.agentSuggestSync();await run.settle();assert.equal(run.requests.length,0,blocker+' end is not focus');
    await run.focus();assert.equal(run.requests.length,1);
  }
});

test("busy, allowance and settings are checked again after settle and snapshot preparation",async()=>{
  for(const stage of ['settle','capture'])for(const gate of ['canvas','agent','disabled','blocked']){
    const run=scene(),{context}=run;context.ink=true;
    let finish;if(stage==='capture')context.agentSuggestCaptureImage=()=>new Promise(resolve=>{finish=()=>resolve(null);});
    context.agentSuggestComposerFocused();
    if(stage==='capture'){run.flushTimers();await run.settle();}
    if(gate==='canvas')context.state.activeAI={};if(gate==='agent')context.canvasAgent.running=true;
    if(gate==='disabled')context.smartSuggest.enabled=false;if(gate==='blocked')context.suggestionAccessBlocked=()=>true;
    if(finish)finish();else run.flushTimers();await run.settle();
    assert.equal(run.requests.length,0,stage+' '+gate);
    assert.equal(context.canvasAgent.promptSuggestionsExpanded,false);
  }
});

test("only successful nonempty rankings become visible; errors and empty results stay silent until another focus",async()=>{
  for(const failure of ['network','empty']){
    const run=scene(),{context}=run;context.ink=true;
    context.failResponse=failure==='network';context.emptyResponse=failure==='empty';
    await run.focus();assert.equal(run.requests.length,1);assert.equal(context.canvasAgent.promptSuggestionsExpanded,false);
    context.agentSuggestSync();await run.settle();assert.equal(run.requests.length,1);
    if(failure==='network'){context.failResponse=false;await run.focus();assert.equal(run.requests.length,2);assert.equal(context.canvasAgent.promptSuggestionsExpanded,true);}
  }
});

test("closing or starting AI work suppresses late results without losing the cached response",async()=>{
  for(const action of ['close','work']){
    const run=scene(),{context}=run;context.ink=true;
    let finish;context.responseWait=new Promise(resolve=>{finish=resolve;});
    context.agentSuggestComposerFocused();run.flushTimers();await run.settle();assert.equal(run.requests.length,1);
    assert.equal(context.canvasAgent.promptSuggestionsExpanded,false,"pending response stays outside the panel");
    if(action==='work')context.agentSuggestWorkStarted();else context.canvasAgentDismissPromptSuggestions();
    finish();await run.settle();context.agentSuggestSync();
    assert.equal(context.canvasAgent.promptSuggestionsExpanded,false);
    await run.focus();assert.equal(run.requests.length,1);assert.equal(context.canvasAgent.promptSuggestionsExpanded,true);
  }
});

test("a new focus joins an in-flight request and ranks a changed context after it finishes",async()=>{
  const run=scene(),{context}=run;context.ink=true;
  let finish;context.responseWait=new Promise(resolve=>{finish=resolve;});
  context.agentSuggestComposerFocused();run.flushTimers();await run.settle();assert.equal(run.requests.length,1);
  context.state.userRevision++;context.agentSuggestComposerFocused();run.flushTimers();await run.settle();assert.equal(run.requests.length,1);
  finish();await run.settle();assert.equal(run.requests.length,2);assert.equal(context.canvasAgent.promptSuggestionsExpanded,true);
  assert.equal(run.call('agentSuggest.key===agentSuggestSnapshot().key'),true);
});

test("click retries missing results without changing focus and reuses nonempty suggestions",async()=>{
  for(const failure of ['network','empty']){
    const run=scene(),{context,input}=run;context.ink=true;
    context.failResponse=failure==='network';context.emptyResponse=failure==='empty';
    await run.focus();assert.equal(run.requests.length,1);assert.equal(context.canvasAgent.promptSuggestionsExpanded,false);
    assert.equal(context.agentSuggest.cache.size,0,'missing results are not cached');
    context.failResponse=false;context.emptyResponse=false;input.value='Keep my draft';
    await run.click();assert.equal(run.requests.length,2);assert.equal(context.canvasAgent.promptSuggestionsExpanded,true);
    assert.equal(context.document.activeElement,input);assert.equal(input.value,'Keep my draft');
    await run.click();assert.equal(run.requests.length,2,'visible suggestions do not infer again');
    context.canvasAgentDismissPromptSuggestions();
    await run.click();assert.equal(run.requests.length,2,'dismissed suggestions reuse the cache');
    assert.equal(context.canvasAgent.promptSuggestionsExpanded,true);
    context.state.userRevision++;
    await run.click();assert.equal(run.requests.length,3,'stale suggestions require current context');
  }
});

test("focus plus click and repeated clicks preserve pending availability, capture and inference",async()=>{
  for(const stage of ['settle','availability','capture','request']){
    const run=scene(),{context}=run;context.ink=true;
    let finish;
    if(stage==='availability')context.smartSuggest.availability.pending=new Promise(resolve=>{finish=resolve;});
    if(stage==='capture')context.agentSuggestCaptureImage=()=>new Promise(resolve=>{finish=()=>resolve(null);});
    if(stage==='request')context.responseWait=new Promise(resolve=>{finish=resolve;});
    context.agentSuggestComposerFocused();
    if(stage!=='settle'){run.flushTimers();await run.settle();}
    const epoch=context.agentSuggest.focusEpoch;
    for(let index=0;index<3;index++)context.agentSuggestComposerClicked();
    assert.equal(context.agentSuggest.focusEpoch,epoch,stage+' retains the pending owner');
    if(stage==='request')context.state.userRevision++;
    if(stage==='settle')run.flushTimers();await run.settle();
    assert.equal(run.requests.length,stage==='settle'||stage==='request'?1:0);
    if(finish)finish();await run.settle();
    assert.equal(run.requests.length,1,stage+' sends exactly one request');
    if(stage==='request'){
      assert.equal(context.canvasAgent.promptSuggestionsExpanded,false,'changed context stays stale');
      await run.click();assert.equal(run.requests.length,2,'next idle click ranks changed context');
    }
  }
});

test("click respects busy, settings, allowance and meaningful-context gates",async()=>{
  for(const gate of ['blank','busy','disabled','blocked']){
    const run=scene(),{context}=run;context.ink=gate!=='blank';
    if(gate==='busy')context.canvasAgent.running=true;
    if(gate==='disabled')context.smartSuggest.enabled=false;
    if(gate==='blocked')context.suggestionAccessBlocked=()=>true;
    await run.click();assert.equal(run.requests.length,0,gate);
  }
});
