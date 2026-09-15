"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");

const root=path.join(__dirname,".."),studioSource=fs.readFileSync(path.join(root,"src/client/app/studio-navigator.js"),"utf8"),persistenceSource=fs.readFileSync(path.join(root,"src/client/app/persistence.js"),"utf8"),mcpRuntimeSource=fs.readFileSync(path.join(root,"src/client/app/mcp-runtime.js"),"utf8");
function extract(name,input){
  const start=input.indexOf(`function ${name}(`);assert.ok(start>=0,`missing ${name}`);
  const lineEnd=input.indexOf("\n",start),body=input.lastIndexOf("{",lineEnd);let depth=0;
  for(let i=body;i<input.length;i++){if(input[i]==="{")depth++;else if(input[i]==="}"&&--depth===0)return `${input.slice(start-6,start)==="async "?"async ":""}${input.slice(start,i+1)}`;}
  throw Error(name);
}
function button(){
  const span={textContent:""},attrs={};
  return {disabled:false,textContent:"",title:"",attrs,querySelector:()=>span,setAttribute:(key,value)=>{attrs[key]=value;},span};
}
function harness({documents=[],dirty=false}={}){
  const records=new Map(documents.map(doc=>[doc.id,doc])),calls=[],closed=[],reports=[],controls={showError:null,showGate:null,showAfter:null,closeError:null,closeGate:null,addOnClose:null};
  const follow=button(),close=button(),closeOthers=button(),group={attrs:{},setAttribute(key,value){this.attrs[key]=value;}},dialog={open:false,showModal(){this.open=true;},close(){this.open=false;}},nameInput={value:""},settingsLayer={hidden:true};
  const state={theme:"studio",language:"en",navigationLocked:false,drawing:false,panGesture:null,touchGesture:null,widgetGesture:null,imageGesture:null,selectionGesture:null,animationGesture:null,canvasAgentNavigationPointerIds:new Set(),textEditors:new Map(),scale:1};
  const canvasDocuments={records,activeId:documents[0]?.id||null,switching:false};
  const document={hidden:false,activeElement:null,dialogOpen:false,body:{},getElementById:id=>({studioMcpFollowLatest:follow,studioMcpCloseAll:close,studioMcpCloseOthers:closeOthers,studioMcpActions:group,settingsLayer}[id]||null),querySelector(selector){
    if(selector==="#newCanvasDialog")return dialog;
    if(selector==="#newSnapshotName")return nameInput;
    if(selector==="dialog[open]")return this.dialogOpen?{open:true}:null;
    return null;
  }};
  const mcpRuntime={sessions:new Map(),pendingView:new Map(),layoutTimer:0,layoutSince:0,queued:0,ready:true};
  const context=vm.createContext({
    state,document,mcpRuntime,canvasDocuments,selectCanvasToolMode:mode=>{state.mode=mode;},
    mcpEl:id=>id==="settingsLayer"?settingsLayer:null,
    canvasDocumentsCopy:text=>text,
    canvasDocumentsShow:async (id,execution,options)=>{controls.lastShowOptions=options;calls.push(["show",id]);const error=typeof controls.showError==="function"?controls.showError(id):controls.showError;if(error)throw error;if(controls.showGate&&controls.showGate.id===id)await controls.showGate.promise;canvasDocuments.activeId=id;controls.showAfter?.(id);return true;},
    canvasDocumentsClose:async(id,sourceId)=>{calls.push(["close",id,sourceId]);const error=typeof controls.closeError==="function"?controls.closeError(id):controls.closeError;if(error)throw error;if(controls.closeGate&&controls.closeGate.id===id)await controls.closeGate.promise;closed.push(id);controls.addOnClose?.(id);records.delete(id);return true;},
    canvasDocumentsCurrent:()=>({id:canvasDocuments.activeId}),
    canvasHasUnsavedChanges:()=>context.dirty,
    currentCanvasDisplayName:()=>"Unsaved Canvas",
    setNewCanvasDialogBusy:value=>calls.push(["busy",value]),updateNewCanvasDialog:()=>calls.push("dialog-update"),
    t:key=>key,canvasDocumentsReport:error=>reports.push(error),canvasAgentFrameRegion:(region,padding)=>calls.push(["frame",region,padding]),mcpRevealRegion:(region,...options)=>calls.push(["reveal",region,...options]),mcpRenderCanvasStatus:()=>{},
    clearTimeout,performance,queueMicrotask,
  });
  context.dirty=dirty;
  const functions=["studioMcpOpenDocumentIds","syncStudioMcpActions","cancelStudioMcpCloseAll","continueStudioMcpCloseAll","closeOtherStudioCanvases","closeOtherStudioMcpCanvases","closeAllStudioMcpCanvases","noteStudioMcpContentUpdate","studioMcpConnectionCurrent","flushStudioMcpFollowLatest","syncStudioNavigatorMcp"].map(name=>extract(name,studioSource)).join("\n");
  vm.runInContext(`
    let pendingCanvasTransition=null;
    let studioMcpFollowLatest=true,studioMcpLatestDocumentId=null,studioMcpLatestRegion=null,studioMcpPendingDocumentId=null,studioMcpPendingRegion=null,studioMcpFollowing=false,studioMcpCloseQueue=null,studioMcpUpdateRevision=0;
    let studioNavigatorMcpEnabled=false,studioNavigatorActiveTab="all",studioNavigatorSuspendedAgent=false,studioNavigatorRestoreAgentAfterManager=false;
    const studioNavigatorMcpTab={hidden:true},studioNavigatorSearch={value:""};
    function setStudioNavigatorTab(tab){studioNavigatorActiveTab=tab;}
    function setStudioNavigatorOpen(){}
    function closeCanvasAgent(){}
    ${extract("mcpViewBlockedBy",mcpRuntimeSource)}
    ${extract("performCanvasTransition",persistenceSource)}
    ${extract("requestCanvasTransition",persistenceSource)}
    ${functions}
    globalThis.api={
      mcpRuntime,canvasDocuments,document,state,
      syncStudioMcpActions,cancelStudioMcpCloseAll,continueStudioMcpCloseAll,closeOtherStudioCanvases,closeOtherStudioMcpCanvases,closeAllStudioMcpCanvases,noteStudioMcpContentUpdate,flushStudioMcpFollowLatest,syncStudioNavigatorMcp,requestCanvasTransition,performCanvasTransition,
      setFollowLatest(value){studioMcpFollowLatest=Boolean(value);studioMcpPendingDocumentId=studioMcpFollowLatest?studioMcpLatestDocumentId:null;studioMcpPendingRegion=studioMcpFollowLatest?studioMcpLatestRegion:null;syncStudioMcpActions();},
      setCloseQueue(value){studioMcpCloseQueue=value;syncStudioMcpActions();},
      mcpState(){return {follow:studioMcpFollowLatest,latest:studioMcpLatestDocumentId,latestRegion:studioMcpLatestRegion,pending:studioMcpPendingDocumentId,pendingRegion:studioMcpPendingRegion,following:studioMcpFollowing,closeQueue:studioMcpCloseQueue,retainedDocumentId:studioMcpCloseQueue?.retainedDocumentId||null};},
      setTab: setStudioNavigatorTab,
      pendingTransition(){return pendingCanvasTransition;},
    };
  `,context);
  return {context,...context.api,records,calls,closed,reports,controls,follow,close,closeOthers,group,dialog,nameInput,settingsLayer,setDirty:value=>{context.dirty=value;},clearCalls:()=>{calls.length=0;closed.length=0;reports.length=0;}};
}

function mcpDoc(id,extra={}){return {id,bindings:[],sessions:[],...extra};}
function mcpRegion(x,y,w,h){return {x,y,w,h};}

test("Close all snapshots the startup MCP document list, pauses on unsaved work, and respects cancel/completion",async()=>{
  const h=harness({documents:[mcpDoc("first",{bindings:[{sessionId:"a"}]}),mcpDoc("second",{sessions:[{id:"b"}]}),mcpDoc("live"),mcpDoc("ordinary")]});
  h.setTab("mcp");
  h.mcpRuntime.sessions.set("live-session",{documentId:"live",closed:false});
  h.noteStudioMcpContentUpdate("live");h.setFollowLatest(true);
  const closePromise=h.closeAllStudioMcpCanvases();
  h.records.set("added-later",mcpDoc("added-later",{bindings:[{}]}));
  await closePromise;
  assert.deepEqual(h.calls.filter(call=>Array.isArray(call)&&["show","close"].includes(call[0])),[["show","first"],["close","first",undefined],["show","second"],["close","second",undefined],["show","live"],["close","live",undefined]]);
  assert.deepEqual(h.closed,["first","second","live"]);assert.ok(h.records.has("ordinary"));assert.ok(h.records.has("added-later"));
  assert.equal(h.mcpState().follow,true);assert.equal(h.mcpState().pending,null);assert.equal(h.close.disabled,false);assert.equal(h.close.attrs["aria-busy"],"false");

  const paused=harness({documents:[mcpDoc("dirty",{bindings:[{}]}),mcpDoc("next",{bindings:[{}]})],dirty:true});
  await paused.closeAllStudioMcpCanvases();
  assert.deepEqual(paused.calls.filter(call=>Array.isArray(call)&&["show","close"].includes(call[0])),[["show","dirty"]]);assert.equal(paused.closed.length,0);assert.equal(paused.dialog.open,true);assert.ok(paused.pendingTransition());assert.deepEqual(Array.from(paused.mcpState().closeQueue),["dirty","next"]);
  paused.cancelStudioMcpCloseAll();assert.equal(paused.mcpState().closeQueue,null);assert.equal(paused.records.has("next"),true);

  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const cancelled=harness({documents:[mcpDoc("current",{bindings:[{}]}),mcpDoc("remaining",{bindings:[{}]})]});cancelled.controls.closeGate={id:"current",promise:gate};
  const cancelling=cancelled.closeAllStudioMcpCanvases();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(cancelled.calls.filter(call=>Array.isArray(call)&&["show","close"].includes(call[0])),[["show","current"],["close","current",undefined]]);cancelled.cancelStudioMcpCloseAll();release();await cancelling;assert.deepEqual(cancelled.closed,["current"]);assert.ok(cancelled.records.has("remaining"));
});

test("Close all stops on transition errors and leaves unclosed documents available",async()=>{
  const h=harness({documents:[mcpDoc("first",{bindings:[{}]}),mcpDoc("broken",{bindings:[{}]}),mcpDoc("remaining",{bindings:[{}]})]});
  h.controls.closeError=id=>id==="broken"?Object.assign(Error("close failed"),{code:"CLOSE_FAILED"}):null;
  await assert.rejects(h.closeAllStudioMcpCanvases(),/close failed/);
  assert.deepEqual(h.closed,["first"]);assert.ok(!h.records.has("first"));assert.ok(h.records.has("broken"));assert.ok(h.records.has("remaining"));assert.equal(h.mcpState().closeQueue,null);
  assert.equal(h.calls.filter(call=>Array.isArray(call)&&call[0]==="show").length,2);assert.equal(h.calls.filter(call=>Array.isArray(call)&&call[0]==="close").length,2);
});

test("Close other snapshots ordinary and MCP documents, retains the active canvas, and ignores later documents",async()=>{
  const h=harness({documents:[mcpDoc("active"),mcpDoc("ordinary"),mcpDoc("bound",{bindings:[{key:"bound"}]}),mcpDoc("session",{sessions:[{id:"session"}]})]});
  const closePromise=h.closeOtherStudioCanvases();
  h.records.set("opened-later",mcpDoc("opened-later",{bindings:[{}]}));
  await closePromise;
  assert.deepEqual(h.calls.filter(call=>Array.isArray(call)&&["show","close"].includes(call[0])),[
    ["show","ordinary"],["close","ordinary",undefined],
    ["show","bound"],["close","bound",undefined],
    ["show","session"],["close","session",undefined],
    ["show","active"],
  ]);
  assert.deepEqual(h.closed,["ordinary","bound","session"]);
  assert.equal(h.canvasDocuments.activeId,"active");
  assert.ok(h.records.has("active"));assert.ok(h.records.has("opened-later"));assert.equal(h.records.size,2);
  assert.equal(h.mcpState().closeQueue,null);assert.equal(h.closeOthers.disabled,false);
});

test("Close other is a no-op when the active canvas is the only workspace document",async()=>{
  const h=harness({documents:[mcpDoc("only")]});
  h.syncStudioMcpActions();
  await h.closeOtherStudioCanvases();
  assert.deepEqual(h.calls,[]);assert.deepEqual(h.closed,[]);assert.equal(h.canvasDocuments.activeId,"only");assert.equal(h.records.size,1);
  assert.equal(h.mcpState().closeQueue,null);assert.equal(h.closeOthers.disabled,true);
});

test("Close other pauses on dirty work and cancellation stops before deleting the remaining batch",async()=>{
  const h=harness({documents:[mcpDoc("active"),mcpDoc("dirty",{bindings:[{}]}),mcpDoc("remaining")],dirty:true});
  await h.closeOtherStudioCanvases();
  assert.deepEqual(h.calls.filter(call=>Array.isArray(call)&&["show","close"].includes(call[0])),[["show","dirty"]]);
  assert.equal(h.dialog.open,true);assert.equal(h.canvasDocuments.activeId,"dirty");
  const transition=h.pendingTransition();assert.equal(transition?.type,"close");assert.equal(transition?.documentId,"dirty");assert.deepEqual(Array.from(h.mcpState().closeQueue),["dirty","remaining"]);assert.equal(h.mcpState().retainedDocumentId,"active");
  transition.onCancel();
  assert.equal(h.mcpState().closeQueue,null);assert.deepEqual(h.closed,[]);assert.ok(h.records.has("active"));assert.ok(h.records.has("dirty"));assert.ok(h.records.has("remaining"));assert.equal(h.closeOthers.disabled,false);
});

test("Close other propagates transition errors and leaves the failed and remaining canvases available",async()=>{
  const h=harness({documents:[mcpDoc("active"),mcpDoc("first"),mcpDoc("broken",{bindings:[{}]}),mcpDoc("remaining") ]});
  h.controls.closeError=id=>id==="broken"?Object.assign(Error("close failed"),{code:"CLOSE_FAILED"}):null;
  await assert.rejects(h.closeOtherStudioCanvases(),/close failed/);
  assert.deepEqual(h.closed,["first"]);assert.ok(!h.records.has("first"));assert.ok(h.records.has("active"));assert.ok(h.records.has("broken"));assert.ok(h.records.has("remaining"));assert.equal(h.mcpState().closeQueue,null);
  assert.ok(h.calls.some(call=>Array.isArray(call)&&call[0]==="close"&&call[1]==="broken"));
});

test("A live MCP connection turns Follow latest on so the next content update switches canvases",async()=>{
  const h=harness({documents:[mcpDoc("active"),mcpDoc("latest")]});
  h.syncStudioNavigatorMcp(true);
  assert.equal(h.mcpState().follow,true);assert.equal(h.follow.attrs["aria-checked"],"true");assert.equal(h.mcpState().pending,null);
  h.noteStudioMcpContentUpdate("latest");await h.flushStudioMcpFollowLatest();
  assert.deepEqual(h.calls.filter(call=>Array.isArray(call)&&call[0]==="show"),[["show","latest"]]);assert.equal(h.canvasDocuments.activeId,"latest");
  h.syncStudioNavigatorMcp(false);assert.equal(h.mcpState().follow,true);
});

test("Follow latest keeps the newest update, waits for real idle state, and switches once unblocked",async()=>{
  const off=harness({documents:[mcpDoc("active"),mcpDoc("latest")]});off.setFollowLatest(false);off.noteStudioMcpContentUpdate("latest");await off.flushStudioMcpFollowLatest();assert.equal(off.calls.length,0);assert.equal(off.mcpState().pending,null);off.setFollowLatest(true);await off.flushStudioMcpFollowLatest();assert.deepEqual(off.calls.filter(call=>Array.isArray(call)&&call[0]==="show"),[["show","latest"]]);

  const h=harness({documents:[mcpDoc("active"),mcpDoc("older"),mcpDoc("latest")]});h.canvasDocuments.activeId="active";
  h.setFollowLatest(true);h.noteStudioMcpContentUpdate("older");h.noteStudioMcpContentUpdate("latest");await h.flushStudioMcpFollowLatest();
  assert.deepEqual(h.calls.filter(call=>Array.isArray(call)&&call[0]==="show"),[["show","latest"]]);assert.equal(h.mcpState().pending,null);assert.equal(h.mcpState().following,false);

  const busy=harness({documents:[mcpDoc("active"),mcpDoc("older"),mcpDoc("latest")]});busy.setFollowLatest(true);busy.noteStudioMcpContentUpdate("older");busy.mcpRuntime.queued=1;busy.noteStudioMcpContentUpdate("latest");await busy.flushStudioMcpFollowLatest();assert.equal(busy.calls.length,0);assert.equal(busy.mcpState().pending,"latest");busy.mcpRuntime.queued=0;await busy.flushStudioMcpFollowLatest();assert.deepEqual(busy.calls.filter(call=>Array.isArray(call)&&call[0]==="show"),[["show","latest"]]);assert.equal(busy.mcpState().pending,null);

  const blockedCases=[
    ["editing",h=>{h.state.textEditors.set("editor",{});}],
    ["locked",h=>{h.state.navigationLocked=true;}],
    ["hidden",h=>{h.document.hidden=true;}],
    ["modal",h=>{h.document.dialogOpen=true;}],
    ["input",h=>{h.document.activeElement={matches:()=>true};}],
    ["trackpad",h=>{h.state.trackpadGesture={scale:1};}],
    ["navigation deadline",h=>{h.state.navigationDeadline=h.context.performance.now()+1000;}],
  ];
  for(const [label,block] of blockedCases){const blocked=harness({documents:[mcpDoc("active"),mcpDoc("latest")]});blocked.setFollowLatest(true);blocked.noteStudioMcpContentUpdate("latest");block(blocked);await blocked.flushStudioMcpFollowLatest();assert.equal(blocked.calls.length,0,`${label}: blocked follow must not switch`);assert.equal(blocked.mcpState().pending,"latest",`${label}: blocked follow must retain target`);}

  const closing=harness({documents:[mcpDoc("active"),mcpDoc("latest")]});closing.setFollowLatest(true);closing.noteStudioMcpContentUpdate("latest");closing.setCloseQueue(["closing"]);await closing.flushStudioMcpFollowLatest();assert.equal(closing.calls.length,0);assert.equal(closing.mcpState().pending,"latest");closing.setCloseQueue(null);await closing.flushStudioMcpFollowLatest();assert.deepEqual(closing.calls.filter(call=>Array.isArray(call)&&call[0]==="show"),[["show","latest"]]);
});

test("Follow latest reveals the newest region on the active canvas and after switching",async()=>{
  const sameRegion=mcpRegion(10,20,30,40),same=harness({documents:[mcpDoc("active")]});
  same.noteStudioMcpContentUpdate("active",sameRegion);same.setFollowLatest(true);await same.flushStudioMcpFollowLatest();
  assert.deepEqual(same.calls,[["reveal",sameRegion]]);assert.equal(same.mcpState().pending,null);assert.deepEqual(same.mcpState().pendingRegion,null);

  const crossRegion=mcpRegion(100,120,300,240),cross=harness({documents:[mcpDoc("active"),mcpDoc("latest")]});
  cross.noteStudioMcpContentUpdate("latest",crossRegion);cross.setFollowLatest(true);await cross.flushStudioMcpFollowLatest();
  assert.deepEqual(cross.calls,[["show","latest"],["reveal",crossRegion]]);assert.equal(cross.canvasDocuments.activeId,"latest");assert.equal(cross.mcpState().pending,null);
});

test("Follow latest clears automatic reveals only for the followed document",async()=>{
  const region=mcpRegion(40,50,160,120),h=harness({documents:[mcpDoc("active"),mcpDoc("hidden")]});
  h.mcpRuntime.sessions.set("active-session",{documentId:"active"});h.mcpRuntime.sessions.set("hidden-session",{documentId:"hidden"});
  h.mcpRuntime.pendingView.set("active-session",new Set(["active-object"]));h.mcpRuntime.pendingView.set("hidden-session",new Set(["hidden-object"]));
  h.noteStudioMcpContentUpdate("active",region);h.setFollowLatest(true);await h.flushStudioMcpFollowLatest();
  assert.deepEqual(h.calls,[["reveal",region]]);assert.equal(h.mcpRuntime.pendingView.has("active-session"),false);assert.deepEqual([...h.mcpRuntime.pendingView.get("hidden-session")],["hidden-object"]);assert.equal(h.mcpState().pending,null);
});

test("Follow latest coalesces the newest region while blocked and does not move after follow is turned off",async()=>{
  const firstRegion=mcpRegion(1,2,30,40),latestRegion=mcpRegion(11,12,130,140),h=harness({documents:[mcpDoc("active")]});
  h.noteStudioMcpContentUpdate("active",firstRegion);h.setFollowLatest(true);h.mcpRuntime.queued=1;h.noteStudioMcpContentUpdate("active",latestRegion);await h.flushStudioMcpFollowLatest();
  assert.equal(h.calls.length,0);assert.equal(h.mcpState().pending,"active");assert.deepEqual(h.mcpState().pendingRegion,latestRegion);
  h.mcpRuntime.queued=0;await h.flushStudioMcpFollowLatest();assert.deepEqual(h.calls,[["reveal",latestRegion]]);

  const offRegion=mcpRegion(20,30,40,50),off=harness({documents:[mcpDoc("active")]});
  off.noteStudioMcpContentUpdate("active",offRegion);off.setFollowLatest(true);off.setFollowLatest(false);await off.flushStudioMcpFollowLatest();
  assert.equal(off.calls.length,0);assert.equal(off.mcpState().pending,null);assert.deepEqual(off.mcpState().pendingRegion,null);
});

test("Follow latest retains a pending region when navigation locks after show",async()=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const region=mcpRegion(50,60,70,80),h=harness({documents:[mcpDoc("active"),mcpDoc("latest")]});
  h.controls.showGate={id:"latest",promise:gate};h.controls.showAfter=()=>{h.state.navigationLocked=true};h.noteStudioMcpContentUpdate("latest",region);h.setFollowLatest(true);
  const first=h.flushStudioMcpFollowLatest();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(h.calls,[["show","latest"]]);assert.equal(h.mcpState().following,true);
  release();await first;
  assert.equal(h.mcpState().pending,"latest");assert.deepEqual(h.mcpState().pendingRegion,region);assert.equal(h.calls.some(call=>Array.isArray(call)&&call[0]==="reveal"),false);
  h.state.navigationLocked=false;await h.flushStudioMcpFollowLatest();assert.deepEqual(h.calls,[["show","latest"],["reveal",region]]);assert.equal(h.mcpState().pending,null);
});

test("Follow latest discards a failed target and follows the next update",async()=>{
  const h=harness({documents:[mcpDoc("active"),mcpDoc("latest")]});h.controls.showError=()=>Object.assign(Error("load failed"),{code:"LOAD_FAILED"});h.setFollowLatest(true);h.noteStudioMcpContentUpdate("latest");await h.flushStudioMcpFollowLatest();assert.equal(h.calls.filter(call=>Array.isArray(call)&&call[0]==="show").length,1);assert.equal(h.mcpState().follow,true);assert.equal(h.mcpState().pending,null);assert.equal(h.reports.length,1);await h.flushStudioMcpFollowLatest();assert.equal(h.calls.filter(call=>Array.isArray(call)&&call[0]==="show").length,1,"failed follow must not retry itself");h.controls.showError=null;const nextRegion=mcpRegion(1,2,30,40);h.noteStudioMcpContentUpdate("latest",nextRegion);await h.flushStudioMcpFollowLatest();assert.equal(h.canvasDocuments.activeId,"latest");assert.deepEqual(h.calls.filter(call=>call[0]==="reveal"),[["reveal",nextRegion]]);
});

test("Follow latest preserves a newer target after an in-flight show without looping on the same target",async()=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const h=harness({documents:[mcpDoc("active"),mcpDoc("old"),mcpDoc("new")]});h.controls.showGate={id:"old",promise:gate};h.setFollowLatest(true);h.noteStudioMcpContentUpdate("old");
  const first=h.flushStudioMcpFollowLatest();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(h.calls.filter(call=>Array.isArray(call)&&call[0]==="show"),[["show","old"]]);assert.equal(h.mcpState().following,true);
  h.noteStudioMcpContentUpdate("new");await h.flushStudioMcpFollowLatest();assert.equal(h.mcpState().pending,"new");assert.deepEqual(h.calls.filter(call=>Array.isArray(call)&&call[0]==="show"),[["show","old"]]);
  release();await first;await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(h.calls.filter(call=>Array.isArray(call)&&call[0]==="show"),[["show","old"],["show","new"]]);assert.equal(h.canvasDocuments.activeId,"new");assert.equal(h.mcpState().pending,null);assert.equal(h.mcpState().following,false);

  let releaseSame;
  const sameGate=new Promise(resolve=>{releaseSame=resolve;});
  const same=harness({documents:[mcpDoc("active"),mcpDoc("same")]});same.controls.showGate={id:"same",promise:sameGate};same.setFollowLatest(true);same.noteStudioMcpContentUpdate("same");const sameFirst=same.flushStudioMcpFollowLatest();await new Promise(resolve=>setImmediate(resolve));same.noteStudioMcpContentUpdate("same");releaseSame();await sameFirst;await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(same.calls.filter(call=>Array.isArray(call)&&call[0]==="show"),[["show","same"]]);assert.equal(same.mcpState().pending,null);assert.equal(same.mcpState().following,false);
});

test("Follow latest reveals a newer same-document region that arrives during an in-flight show",async()=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const oldRegion=mcpRegion(1,2,30,40),newRegion=mcpRegion(101,102,130,140),h=harness({documents:[mcpDoc("active"),mcpDoc("latest")]});
  h.controls.showGate={id:"latest",promise:gate};h.noteStudioMcpContentUpdate("latest",oldRegion);h.setFollowLatest(true);
  const first=h.flushStudioMcpFollowLatest();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(h.calls,[["show","latest"]]);assert.equal(h.mcpState().following,true);
  h.noteStudioMcpContentUpdate("latest",newRegion);assert.deepEqual(h.mcpState().pendingRegion,newRegion);release();await first;
  assert.deepEqual(h.calls,[["show","latest"],["reveal",newRegion]]);assert.equal(h.mcpState().pending,null);assert.equal(h.mcpState().following,false);
});

test("disconnecting an in-flight Follow latest prevents the retired connection from revealing content",async()=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve;}),region=mcpRegion(5,6,70,80),h=harness({documents:[mcpDoc("active"),mcpDoc("latest")]});
  const socket={readyState:1},controller=new AbortController(),execution={socket,generation:3,controller};
  h.context.WebSocket={OPEN:1};h.mcpRuntime.socket=socket;h.mcpRuntime.generation=3;h.controls.showGate={id:"latest",promise:gate};h.noteStudioMcpContentUpdate("latest",region);
  const following=h.flushStudioMcpFollowLatest(execution);await new Promise(resolve=>setImmediate(resolve));
  controller.abort();h.mcpRuntime.generation=4;h.mcpRuntime.socket=null;release();await following;
  assert.equal(h.calls.some(call=>call[0]==="reveal"),false);assert.equal(h.mcpState().pending,"latest");
});

test("MCP completion hook only marks content producing tools and excludes reads/progress/inspect",()=>{
  const match=mcpRuntimeSource.match(/if\(\["mcp_present_widget","mcp_draw","mcp_plot","mcp_patch_file","mcp_edit_canvas","mcp_place_image"\][\s\S]*?noteMcpContentUpdate\?\.\(result\.documentId,region\);/);
  assert.ok(match,"content update hook whitelist should remain explicit");assert.doesNotMatch(match[0],/mcp_read_feedback|mcp_update_session|mcp_inspect_session|mcp_capture_widget/);assert.match(match[0],/presentation\?\.intent!=="inspect"/);assert.match(match[0],/message\.arguments\?\.action!=="show"/);
});


test("MCP close others keeps the current canvas and unrelated ordinary canvases",async()=>{
  const h=harness({documents:[mcpDoc("current",{bindings:[{}]}),mcpDoc("ordinary"),mcpDoc("other-mcp",{bindings:[{}]})]});
  h.setTab("mcp");
  await h.closeOtherStudioMcpCanvases();
  assert.deepEqual(h.closed,["other-mcp"]);
  assert.equal(h.canvasDocuments.activeId,"current");
  assert.ok(h.records.has("ordinary"));assert.ok(h.records.has("current"));
});

for(const tab of ["all","canvas"]){
  test(`${tab} menu close others closes every other open canvas and restores current`,async()=>{
    const h=harness({documents:[mcpDoc("current"),mcpDoc("ordinary"),mcpDoc("mcp",{bindings:[{}]})]});
    h.setTab(tab);
    const closing=h.closeOtherStudioMcpCanvases();
    h.records.set("later",mcpDoc("later"));
    h.setTab("mcp");
    await closing;
    assert.deepEqual(h.closed,["ordinary","mcp"]);
    assert.equal(h.canvasDocuments.activeId,"current");
    assert.deepEqual([...h.records.keys()],["current","later"]);
    assert.equal(h.mcpState().closeQueue,null);
  });

  test(`${tab} menu close all snapshots every open canvas despite later tab changes`,async()=>{
    const h=harness({documents:[mcpDoc("ordinary"),mcpDoc("mcp",{bindings:[{}]})]});
    h.setTab(tab);
    const closing=h.closeAllStudioMcpCanvases();
    h.records.set("later",mcpDoc("later"));
    h.setTab("mcp");
    await closing;
    assert.deepEqual(h.closed,["ordinary","mcp"]);
    assert.deepEqual([...h.records.keys()],["later"]);
    assert.equal(h.mcpState().closeQueue,null);
  });

  for(const action of ["closeOtherStudioMcpCanvases","closeAllStudioMcpCanvases"]){
    test(`${tab} ${action} honors unsaved ordinary canvas cancellation`,async()=>{
      const h=harness({documents:[mcpDoc("current"),mcpDoc("dirty"),mcpDoc("remaining",{bindings:[{}]})],dirty:true});
      h.setTab(tab);
      await h[action]();
      const expectedId=action==="closeOtherStudioMcpCanvases"?"dirty":"current";
      assert.equal(h.dialog.open,true);
      assert.deepEqual(h.closed,[]);
      assert.equal(h.pendingTransition()?.documentId,expectedId);
      h.pendingTransition().onCancel();
      assert.equal(h.mcpState().closeQueue,null);
      assert.deepEqual([...h.records.keys()],["current","dirty","remaining"]);
    });
  }
}

function canvasRowCloseHarness({activeId="current",show=async()=>{}}={}){
  const calls=[],canvasDocuments={activeId,switching:false};
  let click;
  const close={setAttribute(){},addEventListener(event,handler){assert.equal(event,"click");click=handler;}};
  const section={classList:{add(){},toggle(){}},append(control){assert.equal(control,close);}};
  const context=vm.createContext({
    document:{createElement:()=>close},canvasDocuments,peButton(){},canvasDocumentsCopy:text=>text,
    canvasDocumentsUiAction:action=>action(),
    canvasDocumentsShow:async id=>{calls.push(["show",id]);await show(id);canvasDocuments.activeId=id;calls.push(["shown",id]);},
    requestCanvasTransition:transition=>{calls.push(["transition",transition.type,transition.documentId,canvasDocuments.activeId]);},
  });
  vm.runInContext(`${extract("appendStudioCanvasClose",studioSource)};globalThis.appendClose=appendStudioCanvasClose;`,context);
  context.appendClose(section,"target",activeId==="target","Target");
  return {calls,click:()=>click()};
}

test("Canvas row close awaits background activation before requesting the dirty-aware transition",async()=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const h=canvasRowCloseHarness({show:()=>gate});
  const closing=h.click();
  assert.deepEqual(h.calls,[["show","target"]]);
  release();await closing;
  assert.deepEqual(h.calls,[["show","target"],["shown","target"],["transition","close","target","target"]]);
});

test("Canvas row close requests the current document transition without switching",async()=>{
  const h=canvasRowCloseHarness({activeId:"target"});
  await h.click();
  assert.deepEqual(h.calls,[["transition","close","target","target"]]);
});

test("Canvas row close never requests a transition after background activation fails",async()=>{
  const h=canvasRowCloseHarness({show:async()=>{throw Error("show failed");}});
  await assert.rejects(h.click(),/show failed/);
  assert.deepEqual(h.calls,[["show","target"]]);
});

test("Follow preference survives reconnect and every close action while obsolete targets are cleared",async()=>{
  for(const enabled of [true,false]){
    const h=harness({documents:[mcpDoc("active"),mcpDoc("latest")]});
    h.setFollowLatest(enabled);h.syncStudioNavigatorMcp(true);h.noteStudioMcpContentUpdate("latest",mcpRegion(1,2,3,4));
    h.syncStudioNavigatorMcp(false);
    assert.equal(h.mcpState().follow,enabled);assert.equal(h.mcpState().pending,null);assert.equal(h.mcpState().pendingRegion,null);
    h.syncStudioNavigatorMcp(true);assert.equal(h.mcpState().follow,enabled);
    h.noteStudioMcpContentUpdate("latest",mcpRegion(1,2,3,4));await h.flushStudioMcpFollowLatest();
    assert.equal(h.canvasDocuments.activeId,enabled?"latest":"active");
    for(const method of ["closeOtherStudioCanvases","closeOtherStudioMcpCanvases","closeAllStudioMcpCanvases"]){
      const closing=harness({documents:[mcpDoc("active",{bindings:[{}]}),mcpDoc("latest",{bindings:[{}]})]});
      closing.setFollowLatest(enabled);closing.noteStudioMcpContentUpdate("latest",mcpRegion(1,2,3,4));await closing[method]();
      assert.equal(closing.mcpState().follow,enabled,method);assert.equal(closing.mcpState().pending,null,method);assert.equal(closing.mcpState().pendingRegion,null,method);
    }
  }
});

test("A failed in-flight follow preserves a newer target including another update on the same document",async()=>{
  for(const target of ["old","new"]){
    let reject;
    const promise=new Promise((resolve,fail)=>{reject=fail;});
    const h=harness({documents:[mcpDoc("active"),mcpDoc("old"),mcpDoc("new")]});
    h.controls.showGate={id:"old",promise};h.noteStudioMcpContentUpdate("old",mcpRegion(1,2,3,4));
    const first=h.flushStudioMcpFollowLatest();
    await new Promise(resolve=>setImmediate(resolve));
    const newest=mcpRegion(10,20,30,40);h.noteStudioMcpContentUpdate(target,newest);h.controls.showGate=null;
    reject(Object.assign(Error("load failed"),{code:"LOAD_FAILED"}));await first;await new Promise(resolve=>setImmediate(resolve));
    assert.equal(h.mcpState().follow,true);assert.equal(h.reports.length,1);assert.equal(h.canvasDocuments.activeId,target);
    assert.deepEqual(h.calls.filter(call=>call[0]==="reveal"),[["reveal",newest]]);assert.equal(h.mcpState().pending,null);
  }
});

test("automatic Follow latest preserves unread acknowledgement",async()=>{
  const h=harness({documents:[mcpDoc("active"),mcpDoc("latest",{unseen:1})]});
  h.noteStudioMcpContentUpdate("latest");
  await h.flushStudioMcpFollowLatest();
  assert.equal(h.canvasDocuments.activeId,"latest");
  assert.equal(h.controls.lastShowOptions.markSeen,false);
});

test("cancelling a Canvas close preserves unread updates on active and background documents",async()=>{
  for(const activeId of ["other","target"]){
    const target={id:"target",unseen:3},workspace={records:new Map([["target",target]]),activeId,switching:false};
    let click,shown=0,confirmations=0;
    const close={classList:{add(){},toggle(){}},setAttribute(){},addEventListener(event,handler){if(event==="click")click=handler;}};
    const context=vm.createContext({document:{createElement:()=>close},canvasDocuments:workspace,peButton(){},canvasDocumentsCopy:text=>text,
      canvasDocumentsUiAction:action=>action(),
      canvasDocumentsShow:async(id,execution,options)=>{shown++;if(options?.markSeen!==false)target.unseen=0;workspace.activeId=id;},
      requestCanvasTransition:async transition=>{assert.equal(transition.type,"close");assert.equal(transition.documentId,target.id);confirmations++;return false;},
    });
    vm.runInContext(extract("appendStudioCanvasClose",studioSource),context);
    context.appendStudioCanvasClose({classList:{add(){},toggle(){}},append(){}},target.id,activeId===target.id,"Target");
    await click();
    assert.equal(shown,activeId===target.id?0:1);
    assert.equal(confirmations,1);
    assert.equal(target.unseen,3,"a cancelled close is not an explicit selection acknowledgement");
    assert.ok(workspace.records.has(target.id));
  }
});
