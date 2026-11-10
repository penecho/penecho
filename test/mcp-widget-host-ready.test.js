"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),{getEventListeners}=require("node:events");
const source=fs.readFileSync(path.join(__dirname,"../src/client/app/mcp-runtime.js"),"utf8"),
  canvasSource=fs.readFileSync(path.join(__dirname,"../src/client/app/canvas-runtime.js"),"utf8"),
  coreSource=fs.readFileSync(path.join(__dirname,"../src/client/app/core.js"),"utf8"),
  timeoutMs=Number(coreSource.match(/WIDGET_SNAPSHOT_TIMEOUT_MS\s*=\s*(\d+)/)[1]),
  waitSource=source.slice(source.indexOf("  async function mcpWaitForWidgetLoad("),source.indexOf("  async function mcpCaptureWidget(")),
  abortSource=canvasSource.slice(canvasSource.indexOf("  function widgetSnapshotAbortError("),canvasSource.indexOf("  async function requestWidgetSnapshot("));
function harness(){
  let now=0,next=1,ready,fail;
  const timers=new Map(),calls=[],controller=new AbortController(),
    widget={id:"never-ready",hostReady:false,mcpDocumentLoaded:true,hostReadyPromise:new Promise((resolve,reject)=>{ready=resolve;fail=reject;})},
    context={WIDGET_SNAPSHOT_TIMEOUT_MS:timeoutMs,Error,
      setTimeout:(fn,delay)=>{const id=next++;timers.set(id,{fn,at:now+delay});return id;},clearTimeout:id=>timers.delete(id),
      canvasAgentAssertToolExecution:()=>{if(controller.signal.aborted)throw controller.signal.reason;},
      sendWidgetInit:()=>calls.push("init"),sendWidgetHostState:()=>calls.push("state")};
  vm.runInNewContext(abortSource+waitSource+";this.wait=mcpWaitForWidgetLoad;",context);
  return {widget,controller,timers,calls,ready:()=>{widget.hostReady=true;ready();},fail,
    wait:()=>context.wait(widget,{controller}),
    advance:ms=>{now+=ms;for(const [id,timer] of timers)if(timer.at<=now){timers.delete(id);timer.fn();}}};
}
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
test("never-ready MCP host fails at the shared deadline with structured readiness details",async()=>{
  const h=harness();let settled=false;
  const pending=h.wait();pending.then(()=>{settled=true;},()=>{settled=true;});
  const rejected=assert.rejects(pending,error=>{assert.equal(error.code,"WIDGET_READY_TIMEOUT");assert.equal(error.details.widgetId,h.widget.id);assert.equal(error.details.stage,"host-ready");assert.equal(error.details.elapsedMs,timeoutMs);return true;});
  assert.ok(timeoutMs<=20000);h.advance(timeoutMs-1);await flush();assert.equal(settled,false);
  h.advance(1);await rejected;assert.equal(h.timers.size,0);assert.equal(getEventListeners(h.controller.signal,"abort").length,0);
  h.ready();await flush();assert.deepEqual(h.calls,[]);
});
test("early host readiness continues immediately and clears its deadline",async()=>{
  const h=harness(),pending=h.wait();h.ready();await pending;
  assert.deepEqual(h.calls,["init","state"]);assert.equal(h.timers.size,0);assert.equal(getEventListeners(h.controller.signal,"abort").length,0);
  h.advance(timeoutMs*2);await flush();assert.deepEqual(h.calls,["init","state"]);
});
test("cancellation preserves the reason, clears its deadline and cannot initialize a late host",async()=>{
  const h=harness(),pending=h.wait(),reason=Error("Session disconnected");
  h.controller.abort(reason);await assert.rejects(pending,error=>error===reason);
  assert.equal(h.timers.size,0);assert.equal(getEventListeners(h.controller.signal,"abort").length,0);
  h.advance(timeoutMs*2);h.ready();await flush();assert.deepEqual(h.calls,[]);
});
test("host failure preserves the error and clears readiness resources",async()=>{
  const h=harness(),pending=h.wait(),reason=Error("Host failed");h.fail(reason);
  await assert.rejects(pending,error=>error===reason);assert.equal(h.timers.size,0);assert.equal(getEventListeners(h.controller.signal,"abort").length,0);
  h.advance(timeoutMs*2);await flush();assert.deepEqual(h.calls,[]);
});
test("an already-ready host takes no deadline timer",async()=>{
  const h=harness();h.widget.hostReady=true;await h.wait();assert.equal(h.timers.size,0);assert.deepEqual(h.calls,["init","state"]);
});
