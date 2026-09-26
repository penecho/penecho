"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require("node:path").join(__dirname,"../src/client/app/ai-runtime.js"),"utf8");
const packed = { changedBox:{x:10,y:10,w:20,h:20}, sourceRect:{x:0,y:0,w:100,h:100} };
function fixture(fetch) {
  const statuses=[], logs=[];
  const state={userRevision:1,recognitionGeneration:1,aiColor:"#000000",dirty:{...packed.changedBox},hotspotTrail:[],reasoningEffort:"medium",theme:"studio",aiRequestTimeoutMs:1000,widgets:[],images:[]};
  const context=vm.createContext({state,fetch,AbortController,TextDecoder,setTimeout,clearTimeout,
    SIZE:20000,MAX_VISIBLE_WIDGETS:100,MAX_VISIBLE_IMAGES:100,AI_REJECTED:"rejected",AI_SUPERSEDED:"superseded",AI_CANCELLED:"cancelled",
    clearWidgetRefineCandidate(){},pluginEnabled:()=>false,pluginRequestPayload:()=>({}),aiRequestHeaders:headers=>headers,
    setBusy:busy=>{state.busy=busy;},setStatusKey:key=>{state.statusKey=key;statuses.push(key);},setStatus:text=>statuses.push(text),
    t:key=>({aiRequestFailed:"Request failed. Please try again",aiError:"AI: ",timeout:"Timed out"}[key]||key),
    debug:(...args)=>logs.push(args),rememberRequest:id=>{state.lastRequestId=id;},restoreDirty:box=>{state.dirty=box;},
    validate:commands=>commands,normalizeCommandPlacements:commands=>commands,
  });
  vm.runInContext(source,context);
  context.validate=commands=>commands;
  context.normalizeCommandPlacements=commands=>commands;
  return {context,state,statuses,logs,run:()=>context.requestAI("assist",packed)};
}
for (const streamed of [false,true]) test(`hosted cancellation preserves input and gives a recoverable status (${streamed?"stream":"JSON"})`,async()=>{
  const data={error:"hosted_request_superseded",message:"A newer Canvas input replaced this hosted model request."};
  const response=()=>streamed
    ?new Response(JSON.stringify({type:"error",status:409,data})+"\n",{headers:{"content-type":"application/x-ndjson"}})
    :new Response(JSON.stringify(data),{status:409,headers:{"content-type":"application/json"}});
  const h=fixture(async()=>response());
  await h.run();
  assert.equal(h.statuses.at(-1),"aiRequestSuperseded");
  assert.deepEqual(JSON.parse(JSON.stringify(h.state.dirty)),packed.changedBox);
  assert.equal(h.state.busy,false);
  assert.equal(h.state.activeAI,null);
  assert.equal(h.state.autoEligible,false,"a cancellation must not create an automatic retry loop");
  assert.equal(h.logs.some(([kind])=>kind==="ai-error"),false);
  assert.equal(h.logs.at(-1)[1].reason,"hosted_request_superseded","diagnostics retain the internal reason");
  h.context.fetch=async()=>new Response(JSON.stringify({commands:[],message:"Completed"}),{headers:{"content-type":"application/json"}});
  await h.run();
  assert.equal(h.statuses.at(-1),"Completed","the next request can proceed without reloading");
});
test("an unknown internal code is not displayed and human-readable server errors remain useful",()=>{
  const h=fixture(()=>{});
  assert.equal(h.context.aiCommandFailure({error:"provider_failed"},503).message,"Request failed. Please try again (HTTP 503)");
  assert.equal(h.context.aiCommandFailure({error:"insufficient_credits",message:"Add credits to continue."},402).message,"Add credits to continue.");
  assert.equal(h.context.aiCommandFailure({error:"The selected model is unavailable."},503).message,"The selected model is unavailable.");
});
test("a replaced request cannot overwrite the current request status",async()=>{
  let finish;
  const h=fixture(()=>new Promise(resolve=>{finish=resolve;}));
  const old=h.run();
  const current={controller:new AbortController()};
  h.state.activeAI=current;
  h.context.setStatusKey("aiWaitingResponse");
  finish(new Response(JSON.stringify({error:"hosted_request_superseded"}),{status:409,headers:{"content-type":"application/json"}}));
  await old;
  assert.equal(h.statuses.at(-1),"aiWaitingResponse");
  assert.equal(h.state.activeAI,current);
});

function functionSource(source,name) {
  const start=source.indexOf(`function ${name}(`),body=source.indexOf("{",start);
  assert.notEqual(start,-1,name);
  let depth=0;
  for(let i=body;i<source.length;i++) {
    if(source[i]==="{")depth++;
    else if(source[i]==="}"&&!--depth)return source.slice(start,i+1);
  }
  throw Error(`Unclosed function ${name}`);
}
const canvasSource=fs.readFileSync(require("node:path").join(__dirname,"../src/client/app/canvas-runtime.js"),"utf8");
const agentSource=fs.readFileSync(require("node:path").join(__dirname,"../src/client/app/canvas-agent-runtime.js"),"utf8");
function widgetFixture(fetch) {
  const h=fixture(fetch),c=h.context;
  Object.assign(c,{
    pluginEnabled:name=>name==="general",pluginManifests:new Map([["general",{}]]),
    widgetUsesHtmlCopySource:()=>true,widgetBox:w=>({x:w.x,y:w.y,w:w.w,h:w.h}),
    VISUAL_EXPLAINER_SOURCE_FORMAT:"visual-explainer",widgetRecord:record=>({...record}),
    capturePendingHistoryState:()=>null,recordWidgetsBefore(){},unmountWidget(){},mountWidget(){},
    save:()=>({}),recordPendingHistory(){},requestInteractionLayerRender(){},clearDirtyContributionTracking(){},
    finishAIDraftHandMode(){},showCanvasHint(){},widgetInteractionPresentation:()=>"inline",
    sendWidgetHostState(){},
  });
  for(const name of ["canvasAgentWidgetSourceState"])vm.runInContext(functionSource(agentSource,name),c);
  for(const name of ["widgetEditContext","widgetReplacementRecordInput","acceptPendingWidget","startPendingWidgetReplacement"])
    vm.runInContext(functionSource(canvasSource,name),c);
  h.target={id:"widget-1",pluginId:"general",widgetType:"html_widget",html:"original",x:10,y:10,w:300,h:200,contentW:300,contentH:200};
  h.other={...h.target,id:"widget-2",html:"other"};
  h.state.widgets=[h.target,h.other];
  h.refine=()=>c.requestAI("answer",packed,{widgetEditTarget:h.state.widgets.find(w=>w.id==="widget-1")});
  return h;
}
const widgetResponse=()=>new Response(JSON.stringify({commands:[{tool:"html_widget",widgetType:"html_widget",pluginId:"general",html:"AI result"}]}),{headers:{"content-type":"application/json"}});
test("Canvas AI commits a Widget while another overlapping Widget changes and retains the latest geometry",async()=>{
  const h=widgetFixture(async()=>{
    h.other.html="Agent edit";
    h.target.x=45;h.target.contentW=600;h.state.userRevision+=3;
    return widgetResponse();
  });
  await h.refine();
  assert.equal(h.state.widgets[0].html,"AI result");
  assert.equal(h.state.widgets[0].x,45);
  assert.equal(h.state.widgets[0].contentW,600);
  assert.equal(h.state.widgets[1].html,"Agent edit");
  assert.equal(h.statuses.at(-1),"aiDone");
  assert.equal(h.state.busy,false);
});
test("a conflicting Widget bundle remains intact and the next Canvas AI request succeeds without reload",async()=>{
  const h=widgetFixture(async()=>{
    h.target.html="MCP edit";h.target.title="MCP title";h.state.userRevision++;
    return widgetResponse();
  });
  await h.refine();
  assert.equal(h.state.widgets[0],h.target);
  assert.equal(h.target.html,"MCP edit");assert.equal(h.target.title,"MCP title");
  assert.equal(h.statuses.at(-1),"aiWidgetChanged");
  assert.deepEqual(JSON.parse(JSON.stringify(h.state.dirty)),packed.changedBox);
  assert.equal(h.state.activeAI,null);assert.equal(h.state.busy,false);
  h.context.fetch=async()=>widgetResponse();
  await h.refine();
  assert.equal(h.state.widgets[0].html,"AI result");
  assert.equal(h.statuses.at(-1),"aiDone");
});
test("a Widget removed or replaced under the same ID cannot be overwritten by a stale result",async()=>{
  for(const replace of [false,true]) {
    const h=widgetFixture(async()=>{
      h.state.widgets=replace?[{...h.target,html:"replacement"},h.other]:[h.other];
      h.state.userRevision++;
      return widgetResponse();
    });
    await h.refine();
    assert.equal(h.statuses.at(-1),"aiWidgetChanged");
    assert.equal(h.state.widgets.some(w=>w.html==="AI result"),false);
    assert.equal(h.state.activeAI,null);
  }
});
test("new Widget drafts can be accepted after unrelated writes; document invalidation still rejects",()=>{
  const h=widgetFixture(()=>{}),c=h.context;
  let outcome;
  const draft={id:"widget-3",recognitionGeneration:1,revision:1,resolve:value=>{outcome=value;}};
  h.state.pendingWidget=draft;h.state.userRevision=20;
  c.acceptPendingWidget();
  assert.equal(h.state.widgets.at(-1),draft);assert.equal(outcome,true);
  let rejected=false;
  c.rejectPendingWidget=()=>{rejected=true;};
  h.state.pendingWidget={...draft,recognitionGeneration:0};
  c.acceptPendingWidget();
  assert.equal(rejected,true);
});
test("unrelated writes during capture preparation do not suppress the model request",async()=>{
  const h=widgetFixture(async()=>widgetResponse());
  let release;
  h.context.pluginEnabled=name=>["general","flowchart"].includes(name);
  h.context.ensurePluginRuntime=()=>new Promise(resolve=>{release=resolve;});
  const pending=h.refine();
  h.other.html="changed during capture";h.state.userRevision++;
  release();await pending;
  assert.equal(h.state.widgets[0].html,"AI result");
  assert.equal(h.statuses.at(-1),"aiDone");
});
test("Agent mutations are not globally blocked by a Canvas AI draft",()=>{
  const state={pending:{},pendingWidget:{},pendingWidgetReplacement:{},textEditors:new Map()};
  const mutate=vm.runInNewContext(`(${functionSource(agentSource,"canvasAgentMutationIdle")})`,{state,
    canvasAgentAssertToolExecution(){},canvasAgentToolError:(code,message)=>Object.assign(Error(message),{code})});
  assert.doesNotThrow(()=>mutate({}));
  state.drawing={};
  assert.throws(()=>mutate({}),{code:"CANVAS_BUSY"},"an uncommitted ink transaction still needs to finish");
});
test("manual Canvas AI remains available on a Canvas bound to an external MCP conversation",async()=>{
  const h=widgetFixture(async()=>widgetResponse());
  h.context.canvasDocumentsExternal=()=>true;
  await h.refine();
  assert.equal(h.state.widgets[0].html,"AI result");
  assert.equal(h.statuses.at(-1),"aiDone");
});
test("starting Agent preserves a running Stroke request and background Agent does not suppress the next Stroke",()=>{
  const h=fixture(()=>{}),canvasAgent={running:true},active={action:"auto",controller:new AbortController()};
  h.state.activeAI=active;
  Object.assign(h.context,{canvasAgent,canvasAgentSyncTriggerState(){},canvasAgentPauseAutomaticAI(){},canvasAgentSyncAutomaticAIStatus(){},canvasAgentIsOpen:()=>false});
  vm.runInContext(functionSource(agentSource,"canvasAgentBeginRequest"),h.context);
  vm.runInContext(functionSource(agentSource,"canvasAgentSuppressesAutomaticAI"),h.context);
  h.context.canvasAgentBeginRequest();
  assert.equal(h.state.activeAI,active);assert.equal(active.controller.signal.aborted,false);
  assert.equal(h.context.canvasAgentSuppressesAutomaticAI(),false);
});
