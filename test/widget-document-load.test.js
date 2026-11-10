"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const read=file=>fs.readFileSync(path.join(__dirname,"..",file),"utf8"),
  canvas=read("src/client/app/canvas-runtime.js"),mcp=read("src/client/app/mcp-runtime.js"),host=read("public/widget-host.js"),
  handler=canvas.slice(canvas.indexOf("  async function handleWidgetMessage("),canvas.indexOf("  function selectedWidget(")),
  load=mcp.slice(mcp.indexOf("  async function mcpWaitForWidgetLoad("),mcp.indexOf("  async function mcpCaptureWidget(")),
  forward=host.slice(host.indexOf('if (message.type === "penecho-widget-updated") {'),host.indexOf('    } else if (message.type === "penecho-widget-snapshot"'))+'}';
function harness(){
  const controller=new AbortController(),widget={id:"widget",hostReady:true,initialized:true,mcpDocumentLoaded:false,contentVersion:0,snapshotDataUrl:"old",frame:{contentWindow:{}}},requests=new Map(),forwarded=[],forwardedSnapshots=[],
    context={state:{widgets:[widget]},location:{origin:"http://local"},setTimeout,clearTimeout,performance,
      validWidgetHostActivate:()=>false,validWidgetHostDrag:()=>false,validWidgetHostTouch:()=>false,
      validWidgetRuntimeDiagnostics:()=>false,validVisualExplainerDiagnostics:()=>false,
      canvasAgentAssertToolExecution:()=>{},sendWidgetInit:()=>{},sendWidgetHostState:()=>{},
      requestWidgetAutomaticContentFit:()=>false,
      widgetSnapshotRequests:requests,decodeWidgetSnapshot:async()=>({width:100,height:50}),t:()=>"Widget export failed",
      runtimeVersion:4,forwardWidgetState:()=>{},Date:{now:()=>10000},lastUpdate:0,UPDATE_FORWARD_INTERVAL_MS:100,
      innerDocumentLoaded:false,trailingUpdateTimer:0,pendingSnapshots:new Map(),forwardSnapshotRequest:id=>forwardedSnapshots.push(id),
      parent:{postMessage:message=>forwarded.push(message)},parentOrigin:"http://local"};
  vm.runInNewContext(handler+load+';this.handle=handleWidgetMessage;this.wait=mcpWaitForWidgetLoad;this.forward=function(message){'+forward+'};',context);
  return {widget,requests,forwarded,forwardedSnapshots,controller,context,
    wait:()=>context.wait(widget,{controller}),
    message:message=>context.handle({source:widget.frame.contentWindow,origin:"http://local",data:message}),
    forward:message=>context.forward(message)};
}
test("lasso capture forwards the visible frame before document readiness and load, while ordinary export still waits",()=>{
  const start=host.indexOf('  function forwardSnapshotRequest('),end=host.indexOf('  async function proxyPublicFetch(',start),messages=[],timers=[];
  const context={innerCaptureBridgeReady:true,innerDocumentReady:false,innerDocumentLoaded:false,performance:{now:()=>100},SNAPSHOT_LOAD_GRACE_MS:4000,
    pendingSnapshots:new Map(),setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout(){},snapshotDebugLog(){},forwardWidgetState(){},
    snapshotError:()=>assert.fail('capture should be forwarded'),inner:{contentWindow:{postMessage:message=>messages.push(message)}}};
  vm.createContext(context);vm.runInContext(host.slice(start,end),context);
  const lasso={currentFrame:true,startedAt:0,timeoutMs:8000,requestedWidth:400,requestedHeight:300};
  context.forwardSnapshotRequest('lasso',lasso);
  assert.equal(messages.length,1);assert.equal(messages[0].currentFrame,true);assert.equal(lasso.forwardedAfterLoad,false);
  assert.equal(timers.length,0,'the lasso never schedules a document-load grace timer');
  context.forwardSnapshotRequest('export',{startedAt:0,timeoutMs:20000});assert.equal(messages.length,1,'ordinary export still waits for document readiness');
  context.innerDocumentReady=true;
  context.forwardSnapshotRequest('export',{startedAt:0,timeoutMs:20000});assert.equal(messages.length,1);assert.equal(timers.length,1,'existing export load policy is preserved');
  context.innerCaptureBridgeReady=false;
  context.forwardSnapshotRequest('not-mounted',{currentFrame:true,startedAt:0,timeoutMs:8000});assert.equal(messages.length,1,'a lasso still needs the screenshot bridge');
});
test("lasso accepts current pixels across load without waiting or retrying, but rejects a replaced source",async()=>{
  for(const sourceChanged of [false,true]){
    const h=harness();let resolved=null,rejected=null;
    h.widget.html='<p>Visible content</p>';
    h.requests.set('lasso',{widget:h.widget,contentVersion:0,currentFrame:true,sourceHtml:h.widget.html,frame:h.widget.frame,resolve:image=>{resolved=image;},reject:error=>{rejected=error;}});
    if(sourceChanged)h.widget.html='<p>Replacement</p>';
    await h.message({type:'penecho-widget-updated',loaded:true});
    await h.message({type:'penecho-widget-snapshot',requestId:'lasso',afterLoad:false,dataUrl:'data:image/png;base64,AQ==',width:100,height:50});
    if(sourceChanged){assert.equal(resolved,null);assert.equal(rejected.code,'WIDGET_CONTENT_CHANGED');}
    else{assert.ok(resolved);assert.equal(rejected,null);}
  }
});
test("author updates invalidate snapshots but only loaded updated releases the MCP document wait",async()=>{
  const h=harness();let completed=false;const pending=h.wait().then(()=>{completed=true;});
  try {
    await h.message({type:"penecho-widget-updated"});
    assert.equal(h.widget.contentVersion,1);assert.equal(h.widget.snapshotDataUrl,"");assert.equal(h.widget.mcpDocumentLoaded,false);
    assert.equal(completed,false);assert.equal(h.widget.mcpLoadWaiters.size,1);
    await h.message({type:"penecho-widget-capture-ready"});assert.equal(completed,false);assert.equal(h.widget.mcpDocumentLoaded,false);
    await h.message({type:"penecho-widget-updated",loaded:true});await pending;
    assert.equal(h.widget.mcpDocumentLoaded,true);assert.equal(h.widget.contentVersion,2);assert.equal(h.widget.mcpLoadWaiters.size,0);
  } finally {h.controller.abort();await pending.catch(()=>{});}
});
test("host preserves current-runtime load notification and rejects stale-runtime load notification",()=>{
  const h=harness();h.forward({type:"penecho-widget-updated"});
  assert.equal(h.forwarded.length,1);assert.equal(h.forwarded[0].loaded,false);
  h.forward({type:"penecho-widget-updated",loaded:true,runtimeVersion:3});assert.equal(h.forwarded.length,1);
  h.forward({type:"penecho-widget-updated",loaded:true,runtimeVersion:4});
  assert.equal(h.forwarded.length,2);assert.equal(h.forwarded[1].loaded,true);
  // Load bypasses ordinary update throttling, which remains active for author updates.
  h.forward({type:"penecho-widget-updated"});assert.equal(h.forwarded.length,2);
});
test("host releases captures that waited for load only after announcing load to the Canvas",()=>{
  const h=harness();h.context.pendingSnapshots.set("capture",{});
  h.forward({type:"penecho-widget-updated",loaded:true,runtimeVersion:3});
  assert.equal(h.context.innerDocumentLoaded,false);assert.deepEqual(h.forwardedSnapshots,[]);
  h.forward({type:"penecho-widget-updated",loaded:true,runtimeVersion:4});
  assert.equal(h.context.innerDocumentLoaded,true);assert.deepEqual(h.forwardedSnapshots,["capture"]);
  assert.equal(h.forwarded.at(-1).loaded,true);
});
test("a capture the host started after load is accepted across the first-load notification",async()=>{
  const h=harness();let resolved=null;
  h.requests.set("capture",{widget:h.widget,contentVersion:0,resolve:image=>{resolved=image;},reject:error=>assert.fail(error.message)});
  await h.message({type:"penecho-widget-updated",loaded:true});
  await h.message({type:"penecho-widget-snapshot",requestId:"capture",afterLoad:true,dataUrl:"data:image/png;base64,AQ==",width:100,height:50});
  assert.ok(resolved);assert.equal(h.widget.snapshotVersion,1);assert.equal(h.widget.contentVersion,1);assert.equal(h.requests.size,0);
});
test("a final attempt tolerates only the Widget's own runtime update",async()=>{
  for(const [source,accepted] of [["runtime",true],["edit",false]]){
    const h=harness();let resolved=null,rejected=null;
    h.requests.set("capture",{widget:h.widget,contentVersion:0,acceptContentRace:true,resolve:image=>{resolved=image;},reject:error=>{rejected=error;}});
    if(source==="runtime")await h.message({type:"penecho-widget-updated"});else h.widget.contentVersion++;
    await h.message({type:"penecho-widget-snapshot",requestId:"capture",dataUrl:"data:image/png;base64,AQ==",width:100,height:50});
    if(accepted){assert.ok(resolved);assert.equal(h.widget.snapshotVersion,1);}
    else{assert.equal(resolved,null);assert.equal(rejected.code,"WIDGET_CONTENT_CHANGED");}
  }
});
test("runtime window load announces loaded once with the current runtime version",()=>{
  const events=new EventTarget(),messages=[],notify=host.slice(host.indexOf("    function notifyReady() {"),host.indexOf("    function setRuntimeActive(")),
    registration=host.match(/addEventListener\("load", notifyReady, \{ once: true \}\);/)[0];
  vm.runInNewContext(notify+registration,{UPDATED:"penecho-widget-updated",runtimeVersion:4,parent:{postMessage:message=>messages.push(message)},addEventListener:events.addEventListener.bind(events)});
  events.dispatchEvent(new Event("load"));events.dispatchEvent(new Event("load"));
  assert.equal(messages.length,1);assert.equal(messages[0].loaded,true);assert.equal(messages[0].runtimeVersion,4);
});
test("ordinary content updates still reject an in-flight stale snapshot",async()=>{
  const h=harness();let rejected,resolved=false;
  h.requests.set("capture",{widget:h.widget,contentVersion:0,resolve:()=>{resolved=true;},reject:error=>{rejected=error;}});
  await h.message({type:"penecho-widget-updated"});
  await h.message({type:"penecho-widget-snapshot",requestId:"capture",dataUrl:"data:image/png;base64,AQ==",width:100,height:50});
  assert.equal(resolved,false);assert.equal(rejected.message,"Widget export failed");assert.equal(rejected.code,"WIDGET_CONTENT_CHANGED");assert.equal(h.widget.snapshotDataUrl,"");assert.equal(h.requests.size,0);
});
test("first-load notification marks an in-flight snapshot as retryable",async()=>{
  const h=harness();let rejected;
  h.requests.set("capture",{widget:h.widget,contentVersion:0,resolve:()=>assert.fail("stale pixels must not be used"),reject:error=>{rejected=error;}});
  await h.message({type:"penecho-widget-updated",loaded:true});
  await h.message({type:"penecho-widget-snapshot",requestId:"capture",dataUrl:"data:image/png;base64,AQ==",width:100,height:50});
  assert.equal(h.widget.mcpDocumentLoaded,true);
  assert.equal(rejected.code,"WIDGET_CONTENT_CHANGED");
  assert.equal(rejected.details.stage,"content-version");
  assert.equal(h.requests.size,0);
});
test("snapshot deadline remains active while the returned PNG is decoding",async()=>{
  const h=harness();let rejectRequest;
  h.widget.contentVersion=4;
  h.context.decodeWidgetSnapshot=()=>new Promise(()=>{});
  const result=new Promise((resolve,reject)=>{rejectRequest=reject;h.requests.set("capture",{widget:h.widget,contentVersion:4,resolve,reject,signal:null,abort:null,timer:setTimeout(()=>{h.requests.delete("capture");reject(Error("decode deadline"));},10)});});
  void h.message({type:"penecho-widget-snapshot",requestId:"capture",dataUrl:"data:image/png;base64,AQ==",width:100,height:50});
  await assert.rejects(result,/decode deadline/);
  assert.equal(h.requests.size,0);assert.equal(h.widget.snapshotDataUrl,"old");
});
test("throttled Widget updates are deferred, never dropped",async()=>{
  const h=harness();const timers=[];h.context.setTimeout=(fn,ms)=>{timers.push({fn,ms});return timers.length;};h.context.clearTimeout=()=>{};
  h.forward({type:"penecho-widget-updated"});assert.equal(h.forwarded.length,1);
  h.forward({type:"penecho-widget-updated"});h.forward({type:"penecho-widget-updated"});
  assert.equal(h.forwarded.length,1,"updates inside the interval are coalesced");assert.equal(timers.length,1,"one trailing update is scheduled");
  timers[0].fn();
  assert.equal(h.forwarded.length,2);assert.equal(h.forwarded[1].type,"penecho-widget-updated");assert.equal(h.forwarded[1].loaded,false);
});
