"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const source=fs.readFileSync(require.resolve("../public/widget-host.js"),"utf8");
function harness(){
  const listeners=new Map(),timers=new Map();let sequence=0;
  const context={widgetState:{maximized:false},innerWidth:0,innerHeight:0,
    addEventListener:(name,callback)=>listeners.set(name,callback),removeEventListener:name=>listeners.delete(name),
    setTimeout:callback=>{const id=++sequence;timers.set(id,callback);return id;},clearTimeout:id=>timers.delete(id)};
  vm.runInNewContext(source.slice(source.indexOf("    function waitForSnapshotViewport("),source.indexOf("    function captureDirectRendererStyleMutations("))+"\nglobalThis.wait=waitForSnapshotViewport;",context);
  return {context,listeners,timers};
}
test("a zero-sized preview viewport waits for actual iframe resize without changing authored dimensions",async()=>{
  const h=harness();let ready=false;
  const pending=h.context.wait(900,1200,10000).then(()=>{ready=true;});
  await Promise.resolve();assert.equal(ready,false);assert.equal(h.context.innerWidth,0);assert.equal(h.context.innerHeight,0);
  h.context.innerWidth=900;h.context.innerHeight=1200;h.listeners.get("resize")();
  await pending;assert.equal(ready,true);assert.equal(h.listeners.size,0);assert.equal(h.timers.size,0);
});
test("an iframe that never resizes fails instead of capturing its zero-sized document",async()=>{
  const h=harness(),pending=h.context.wait(900,1200,10000);
  [...h.timers.values()][0]();await assert.rejects(pending,/viewport did not finish resizing/);
  assert.equal(h.listeners.size,0);assert.equal(h.timers.size,0);
});
