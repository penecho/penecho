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
    clearWidgetRefineCandidate(){},refreshWidgetRefineHoverCandidate(){},pluginEnabled:()=>false,pluginRequestPayload:()=>({}),aiRequestHeaders:headers=>headers,requireAiConnectionSelection:()=>true,
    selectedAiConnectionId:()=>"connection-a",aiConnectionScope:()=>"scope-a",promptForAiConnectionSelection:()=>true,
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

test("Canvas thinking follows the explicit request target independently of dirty input",async()=>{
  const target={x:80,y:120,w:780,h:180}, stale={x:1200,y:700,w:40,h:40};
  for (const dirty of [null,stale]) {
    let finish;
    const h=fixture(()=>new Promise(resolve=>{finish=resolve;}));
    h.context.dirtyInputScope=box=>({box});
    h.state.dirty=dirty;h.state.lastUserBox=stale;
    const attentionBox={...target}, run=h.context.requestAI("plot",{...packed,changedBox:{...target}},{attentionBox,focusAttention:true});
    const initial=JSON.parse(JSON.stringify(h.state.summonAnchor));
    attentionBox.x+=500;
    const afterMutation=JSON.parse(JSON.stringify(h.state.summonAnchor));
    finish(new Response(JSON.stringify({error:"test complete"}),{status:503,headers:{"content-type":"application/json"}}));
    await run;
    assert.deepEqual(initial,target,"current target wins over missing or unrelated dirty input and the previous request");
    assert.deepEqual(afterMutation,target,"the in-flight animation owns a stable target snapshot");
  }
});

test("an explicit thinking region keeps precedence over the attention target",async()=>{
  let finish;
  const h=fixture(()=>new Promise(resolve=>{finish=resolve;})),thinkingBox={x:100,y:150,w:500,h:240};
  const run=h.context.requestAI("answer",packed,{thinkingBox,attentionBox:{x:200,y:210,w:20,h:20}});
  const anchor=h.state.summonAnchor,initial=JSON.parse(JSON.stringify(anchor));
  finish(new Response(JSON.stringify({error:"test complete"}),{status:503,headers:{"content-type":"application/json"}}));
  await run;
  assert.deepEqual(initial,thinkingBox);
  assert.notEqual(anchor,thinkingBox,"selection and Widget regions are also captured by value");
});

test("selection Canvas AI refreshes Widget pixels before replacing the provisional screenshot",async()=>{
  const requests=[],h=fixture(async(_url,options)=>{requests.push(JSON.parse(options.body));return new Response(JSON.stringify({error:"isolated payload captured"}),{status:503,headers:{"content-type":"application/json"}});});
  const selection={phase:"active",regionOnly:true,box:{x:20,y:30,w:100,h:90},fragments:[]};h.state.selection=selection;
  let ready,refreshed=false;const widget={id:"lasso-widget"};
  h.context.selectionPathFor=s=>s.path||[];
  h.context.widgetsRequiredForCapture=(region,path)=>{assert.equal(region,selection.box);assert.deepEqual(path,[]);return [widget];};
  h.context.ensureWidgetSnapshots=async(widgets,options)=>{
    assert.deepEqual(widgets,[widget]);assert.equal(options.signal.aborted,false);assert.equal(options.timeoutMs,undefined,"selection AI uses the full capture budget");
    await new Promise(resolve=>{ready=resolve;});refreshed=true;return {complete:true,missing:0,missingWidgets:[]};
  };
  h.context.buildSelectionImage=s=>{assert.equal(s,selection);assert.equal(refreshed,true);return {...packed,atlasImage:"fresh-selection"};};
  const run=h.context.requestAI("answer",{...packed,atlasImage:"old-selection"},{isolatedSelection:true,selection});
  assert.equal(requests.length,0);ready();await run;
  assert.equal(requests[0].atlasImage,"fresh-selection");
  assert.equal(h.state.dirty.w,packed.changedBox.w,"an isolated request preserves unrelated dirty ink");
});

test("failed Widget snapshots stop selection Canvas AI before the model request",async()=>{
  const h=fixture(()=>assert.fail("incomplete screenshots cannot be sent")),selection={phase:"active",regionOnly:true,box:packed.sourceRect};
  h.state.selection=selection;
  h.context.selectionPathFor=()=>[];h.context.widgetsRequiredForCapture=()=>[{id:"broken"}];
  h.context.buildSelectionImage=()=>assert.fail("an incomplete lasso image is never built");
  for (const failure of ["throws","incomplete"]) {
    h.context.ensureWidgetSnapshots=async()=>{if(failure==="throws")throw Error("Widget unavailable");return {complete:false,missing:1,missingWidgets:[{id:"broken"}]};};
    h.context.widgetSnapshotsUnavailableError=result=>Object.assign(Error("Widget unavailable"),{details:{widgetIds:result.missingWidgets.map(widget=>widget.id)}});
    h.state.statusKey=null;
    assert.equal(await h.context.requestAI("answer",packed,{isolatedSelection:true,selection}),false,failure);
    assert.equal(h.state.busy,false);assert.equal(h.state.statusKey,"widgetExportFailed");
  }
});

test("cancelled snapshot preparation cannot submit a closed lasso",async()=>{
  const h=fixture(()=>assert.fail("cancelled screenshots cannot be sent")),selection={phase:"active",regionOnly:true,box:packed.sourceRect};
  h.state.selection=selection;let ready;
  h.context.selectionPathFor=()=>[];h.context.widgetsRequiredForCapture=()=>[{id:"widget"}];
  h.context.ensureWidgetSnapshots=()=>new Promise(resolve=>{ready=()=>resolve({complete:true,missing:0,missingWidgets:[]});});
  const run=h.context.requestAI("answer",packed,{isolatedSelection:true,selection});
  h.context.supersedeActiveAI("selection-cancelled");h.state.selection=null;ready();await run;
  assert.equal(h.state.busy,false);
});
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
  assert.equal(h.statuses.at(-1),"aiNoVisibleResponse","the next request can proceed without reloading and reports its empty result");
});
for (const streamed of [false,true]) test(`a stale connection opens the chooser and preserves ink (${streamed?"stream":"JSON"})`,async()=>{
  const data={error:"AI service rejected the request (HTTP 409). Please retry or check the AI service configuration.",errorCode:"CONNECTION_STALE"};
  const h=fixture(async()=>streamed
    ?new Response(JSON.stringify({type:"error",status:409,data})+"\n",{headers:{"content-type":"application/x-ndjson"}})
    :new Response(JSON.stringify(data),{status:409,headers:{"content-type":"application/json"}}));
  const prompts=[];
  h.context.promptForAiConnectionSelection=expected=>{prompts.push(JSON.parse(JSON.stringify(expected)));return true;};
  await h.run();
  assert.deepEqual(prompts,[{id:"connection-a",scope:"scope-a"}]);
  assert.equal(h.statuses.at(-1),"canvasAgentChooseConnection");
  assert.deepEqual(JSON.parse(JSON.stringify(h.state.dirty)),packed.changedBox);
  assert.equal(h.state.autoEligible,false);
  assert.equal(h.state.busy,false);
  assert.equal(h.state.activeAI,null);
});
test("a superseded request cannot open the chooser on a stale-connection response",async()=>{
  let finish;
  const h=fixture(()=>new Promise(resolve=>{finish=resolve;}));
  h.context.promptForAiConnectionSelection=()=>assert.fail("must not interrupt a newer request");
  const old=h.run();
  const current={controller:new AbortController()};
  h.state.activeAI=current;
  h.context.setStatusKey("aiWaitingResponse");
  finish(new Response(JSON.stringify({errorCode:"CONNECTION_STALE"}),{status:409,headers:{"content-type":"application/json"}}));
  await old;
  assert.equal(h.state.activeAI,current);
  assert.equal(h.statuses.at(-1),"aiWaitingResponse");
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
    sendWidgetHostState(){},releaseSelectionAITransformLock(){},
  });
  for(const name of ["canvasAgentWidgetSourceState"])vm.runInContext(functionSource(agentSource,name),c);
  for(const name of ["consumeAllDirtyInput","widgetEditContext","widgetReplacementRecordInput","acceptPendingWidget","startPendingWidgetReplacement"])
    vm.runInContext(functionSource(canvasSource,name),c);
  h.target={id:"widget-1",pluginId:"general",widgetType:"html_widget",html:"original",x:10,y:10,w:300,h:200,contentW:300,contentH:200};
  h.other={...h.target,id:"widget-2",html:"other"};
  h.state.widgets=[h.target,h.other];
  h.refine=()=>c.requestAI("answer",packed,{widgetEditTarget:h.state.widgets.find(w=>w.id==="widget-1")});
  return h;
}
const widgetResponse=()=>new Response(JSON.stringify({commands:[{tool:"html_widget",widgetType:"html_widget",pluginId:"general",html:"AI result"}]}),{headers:{"content-type":"application/json"}});
test("successful selected Widget commits clear all dirty before later callbacks",async()=>{
  const h=widgetFixture(async()=>widgetResponse()),selection={phase:"active"},snapshot={generation:1};
  h.state.selection=selection;
  let clears=0;h.context.clearDirtyContributionTracking=()=>{clears++;};
  await h.context.requestAI("answer",packed,{isolatedSelection:true,selection,inputSnapshot:snapshot,widgetEditTarget:h.target,onResultCommitted:()=>{
    assert.equal(h.state.dirty,null);assert.equal(clears,1);
    h.context.supersedeActiveAI("user-stop");
  }});
  assert.equal(clears,1,"completion clears all dirty exactly once");
  assert.equal(h.state.dirty,null);
});

test("failed, empty and stopped selection requests retain their captured input",async()=>{
  for(const mode of ["failure","empty","stop"]){
    const h=fixture(async()=>{
      if(mode==="stop")h.context.supersedeActiveAI("user-stop");
      return new Response(JSON.stringify(mode==="failure"?{error:"test"}:{commands:[]}),{status:mode==="failure"?503:200,headers:{"content-type":"application/json"}});
    }),selection={phase:"active"};h.state.selection=selection;
    h.context.consumeAllDirtyInput=()=>assert.fail("unfulfilled input cannot be consumed");
    await h.context.requestAI("answer",packed,{isolatedSelection:true,selection,inputSnapshot:{generation:1}});
    assert.deepEqual(JSON.parse(JSON.stringify(h.state.dirty)),packed.changedBox,mode);
  }
});

test("dirty survives result preparation, rejection and Stop, then remains available to Manual AI",async()=>{
  for(const mode of ["reject","stop"]){
    const h=widgetFixture(async()=>new Response(JSON.stringify({commands:[{tool:"draw"}]}),{headers:{"content-type":"application/json"}})),dirty=h.state.dirty;
    h.context.preparePendingItem=async()=>({});
    h.context.resolvePendingItemOverlaps=()=>{};
    h.context.startPendingBatch=async()=>{
      assert.equal(h.state.dirty,dirty,"receiving and preparing a result must not clear dirty");
      if(mode==="stop")h.context.supersedeActiveAI("user-stop");
      throw Error(mode==="stop"?"cancelled":"rejected");
    };
    await h.run();
    assert.deepEqual(JSON.parse(JSON.stringify(h.state.dirty)),packed.changedBox,mode);
    let manualSnapshot;
    h.context.fetch=async()=>{manualSnapshot=JSON.parse(JSON.stringify(h.state.activeAI.dirtySnapshot));return new Response(JSON.stringify({commands:[]}),{headers:{"content-type":"application/json"}});};
    await h.context.requestAI("answer",packed);
    assert.deepEqual(manualSnapshot,packed.changedBox,mode);
    assert.deepEqual(JSON.parse(JSON.stringify(h.state.dirty)),packed.changedBox,"empty Manual AI preserves input too");
  }
});
test("a failed or stopped concurrent Canvas request cannot resurrect dirty cleared by a successful Agent write",async()=>{
  for(const stopped of [false,true]){
    let respond;
    const h=widgetFixture(()=>new Promise(resolve=>{respond=resolve;})),pending=h.run();
    h.context.consumeAllDirtyInput();
    assert.equal(h.state.dirty,null);
    if(stopped)h.context.supersedeActiveAI("user-stop");
    respond(new Response(JSON.stringify({error:"test failure"}),{status:503,headers:{"content-type":"application/json"}}));
    await pending;
    assert.equal(h.state.dirty,null,stopped?"stopped":"failed");
  }
});
test("Canvas AI inserts every Widget through the live Widget path instead of raster drafts",async()=>{
  const commands=["Beijing","New York","London"].map((title,index)=>({
    tool:"html_widget",widgetType:"html_widget",pluginId:"general",title,html:`<p>${title}</p>`,x:100+index*500,y:200,w:440,h:600,
  })),h=widgetFixture(async()=>new Response(JSON.stringify({commands}),{headers:{"content-type":"application/json"}}));
  h.state.widgets=[];h.state.nextWidgetId=1;
  h.context.showWidgetHeader=()=>{};
  vm.runInContext(functionSource(canvasSource,"startPendingWidget"),h.context);
  await h.run();
  assert.deepEqual(h.state.widgets.map(widget=>widget.title),["Beijing","New York","London"]);
  assert.deepEqual(h.state.widgets.map(widget=>widget.x),[100,600,1100]);
  assert.equal(h.statuses.at(-1),"aiDone");
  assert.equal(h.state.busy,false);
});
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
test("Widget commit consumes input before a new stroke supersedes the async request",async()=>{
  const h=widgetFixture(async()=>widgetResponse()),next={x:600,y:100,w:100,h:50};
  let clears=0,consumed;
  h.context.clearDirtyContributionTracking=()=>{clears++;};
  await h.context.requestAI("answer",packed,{widgetEditTarget:h.target,onResultCommitted:()=>{
    consumed=h.state.activeAI.inputConsumed;
    h.context.supersedeActiveAI("user-stop");
    assert.equal(h.state.dirty,null,"stopping an already committed request cannot restore its old dirty snapshot");
    h.state.dirty=next;
  }});
  assert.equal(consumed,true);
  assert.equal(clears,1);
  assert.equal(h.state.dirty,next,"the old continuation cannot consume later input");
  assert.equal(h.state.widgets[0].html,"AI result");
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
  const state={pending:{},pendingWidget:{},pendingWidgetReplacement:{},textEditors:new Map(),widgets:[],images:[],animations:[]};
  const context=vm.createContext({state,canvasAgent:{},
    canvasAgentAssertToolExecution(){},canvasAgentToolError:(code,message)=>Object.assign(Error(message),{code})});
  vm.runInContext(functionSource(agentSource,"canvasAgentMutationState")+functionSource(agentSource,"canvasAgentMutationIdle"),context);
  const mutate=context.canvasAgentMutationIdle;
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
  Object.assign(h.context,{canvasAgent,canvasAgentDismissPromptSuggestions(){},canvasAgentSyncTriggerState(){},canvasAgentPauseAutomaticAI(){},canvasAgentSyncAutomaticAIStatus(){},canvasAgentIsOpen:()=>false});
  vm.runInContext(functionSource(agentSource,"canvasAgentBeginRequest"),h.context);
  vm.runInContext(functionSource(agentSource,"canvasAgentSuppressesAutomaticAI"),h.context);
  h.context.canvasAgentBeginRequest();
  assert.equal(h.state.activeAI,active);assert.equal(active.controller.signal.aborted,false);
  assert.equal(h.context.canvasAgentSuppressesAutomaticAI(),false);
});
