"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const source=fs.readFileSync(require("node:path").join(__dirname,"../public/widget-host.js"),"utf8");
function chunk(start,end){return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));}
test("snapshot owner serializes overlapping captures and reports busy only when the budget is spent",async()=>{
  const finishers=[],calls=[],messages=[];let now=0;
  const context=vm.createContext({parent:{postMessage:m=>messages.push(m)},runtimeVersion:3,scienceMode:false,clock:()=>now,setTimeout,clearTimeout,
    reportPresentationScrollExtent:()=>{},snapshotDebugLog:()=>{},snapshotDocument:message=>{calls.push(message);return new Promise(r=>finishers.push(r));},scienceSnapshot:()=>{},});
  vm.runInContext(chunk('    let activeSnapshot =','    async function snapshotPrimarySvg'),context);
  const first=context.snapshot({requestId:"first",timeoutMs:10000});
  const second=context.snapshot({requestId:"second",timeoutMs:10000});
  await new Promise(r=>setImmediate(r));
  assert.deepEqual(calls.map(m=>m.requestId),["first"],"a second capture waits instead of failing");
  now=400;finishers[0]();await first;await new Promise(r=>setImmediate(r));
  assert.deepEqual(calls.map(m=>m.requestId),["first","second"]);
  assert.equal(calls[1].timeoutMs,9600,"queue time is charged to the waiting capture's budget");
  finishers[1]();await second;
  assert.equal(messages.length,0);
  vm.runInContext('activeSnapshotRender = new Promise(() => {})',context);
  await context.snapshot({requestId:"draining",timeoutMs:500});
  assert.equal(messages[0].code,"WIDGET_RENDER_BUSY");assert.equal(messages[0].details.stage,"render-draining");
});
test("render lifetime outlives timeout race and blocks another renderer",()=>{
  assert.match(source,/activeSnapshotRender=rendering;[\s\S]*rendering\.then\(release,release\);[\s\S]*await withTimeout\(rendering, remainingMs/);
  assert.match(source,/if\(captureExpired\)throw Error\("Widget snapshot timed out"\);\s*stage="dom-render"/);
  assert.match(source,/details:\{stage,elapsedMs:Math.round\(clock\(\)-snapshotStartedAt\),runtimeVersion\}/);
});
