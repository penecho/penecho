"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const source=fs.readFileSync(require("node:path").join(__dirname,"../public/widget-host.js"),"utf8");
function chunk(start,end){return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));}
test("snapshot owner prevents overlapping capture and releases after completion",async()=>{
  let finish;const messages=[];
  const context=vm.createContext({parent:{postMessage:m=>messages.push(m)},runtimeVersion:3,scienceMode:false,
    reportPresentationScrollExtent:()=>{},snapshotDebugLog:()=>{},snapshotDocument:()=>new Promise(r=>{finish=r;}),scienceSnapshot:()=>{},});
  vm.runInContext(chunk('    let activeSnapshot =','    async function snapshotPrimarySvg'),context);
  const first=context.snapshot({requestId:"first"});
  await context.snapshot({requestId:"second"});
  assert.equal(messages[0].code,"WIDGET_RENDER_BUSY");
  finish();await first;
  const next=context.snapshot({requestId:"third"});finish();await next;
  assert.equal(messages.length,1);
  vm.runInContext('activeSnapshotRender = Promise.resolve()',context);
  await context.snapshot({requestId:"draining"});assert.equal(messages[1].details.stage,"render-draining");
});
test("readiness consumes the same capture deadline",()=>{
  const messages=[],errors=[],order=[];
  const context=vm.createContext({innerDocumentReady:true,performance:{now:()=>5000},snapshotDebugLog:()=>{},
    forwardWidgetState:()=>order.push("state"),
    inner:{contentWindow:{postMessage:m=>{order.push("snapshot");messages.push(m);}}},snapshotError:(...args)=>errors.push(args)});
  vm.runInContext(chunk('  function forwardSnapshotRequest(', '  async function proxyPublicFetch('),context);
  context.forwardSnapshotRequest("ok",{timeoutMs:10000,startedAt:1000,requestedWidth:500,requestedHeight:300});
  assert.equal(messages[0].timeoutMs,5750);
  assert.deepEqual(order,["state","snapshot"]);
  context.forwardSnapshotRequest("expired",{timeoutMs:4000,startedAt:1000});
  assert.equal(messages.length,1);assert.equal(errors[0][2],"WIDGET_READY_TIMEOUT");
});
test("render lifetime outlives timeout race and blocks another renderer",()=>{
  assert.match(source,/activeSnapshotRender=rendering;[\s\S]*rendering\.then\(release,release\);[\s\S]*await withTimeout\(rendering, remainingMs/);
  assert.match(source,/if\(captureExpired\)throw Error\("Widget snapshot timed out"\);\s*stage="dom-render"/);
  assert.match(source,/details:\{stage,elapsedMs:Math.round\(clock\(\)-snapshotStartedAt\),runtimeVersion\}/);
});
