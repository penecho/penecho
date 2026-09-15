"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const read=file=>fs.readFileSync(path.join(__dirname,"..",file),"utf8"),
  canvas=read("src/client/app/canvas-runtime.js"),mcp=read("src/client/app/mcp-runtime.js"),host=read("public/widget-host.js"),
  handler=canvas.slice(canvas.indexOf("  async function handleWidgetMessage("),canvas.indexOf("  function selectedWidget(")),
  load=mcp.slice(mcp.indexOf("  async function mcpWaitForWidgetLoad("),mcp.indexOf("  async function mcpCaptureWidget(")),
  forward=host.slice(host.indexOf('if (message.type === "penecho-widget-updated") {'),host.indexOf('    } else if (message.type === "penecho-widget-snapshot"'))+'}';
function harness(){
  const controller=new AbortController(),widget={id:"widget",hostReady:true,mcpDocumentLoaded:false,contentVersion:0,snapshotDataUrl:"old",frame:{contentWindow:{}}},requests=new Map(),forwarded=[],
    context={state:{widgets:[widget]},location:{origin:"http://local"},setTimeout,clearTimeout,
      validWidgetHostActivate:()=>false,validWidgetHostDrag:()=>false,validWidgetHostTouch:()=>false,
      validWidgetRuntimeDiagnostics:()=>false,validVisualExplainerDiagnostics:()=>false,
      canvasAgentAssertToolExecution:()=>{},sendWidgetInit:()=>{},sendWidgetHostState:()=>{},
      widgetSnapshotRequests:requests,decodeWidgetSnapshot:async()=>({width:100,height:50}),t:()=>"Widget export failed",
      runtimeVersion:4,forwardWidgetState:()=>{},Date:{now:()=>10000},lastUpdate:0,UPDATE_FORWARD_INTERVAL_MS:100,
      parent:{postMessage:message=>forwarded.push(message)},parentOrigin:"http://local"};
  vm.runInNewContext(handler+load+';this.handle=handleWidgetMessage;this.wait=mcpWaitForWidgetLoad;this.forward=function(message){'+forward+'};',context);
  return {widget,requests,forwarded,controller,context,
    wait:()=>context.wait(widget,{controller}),
    message:message=>context.handle({source:widget.frame.contentWindow,origin:"http://local",data:message}),
    forward:message=>context.forward(message)};
}
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
  assert.equal(resolved,false);assert.equal(rejected.message,"Widget export failed");assert.equal(h.widget.snapshotDataUrl,"");assert.equal(h.requests.size,0);
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
