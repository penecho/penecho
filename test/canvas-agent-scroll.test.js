"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT=path.resolve(__dirname,".."),
  runtime=fs.readFileSync(path.join(ROOT,"src/client/app/canvas-agent-runtime.js"),"utf8"),
  css=fs.readFileSync(path.join(ROOT,"public/style.css"),"utf8");

function functionSource(name){
  const start=runtime.indexOf(`function ${name}(`);
  assert.notEqual(start,-1,`missing function ${name}`);
  const signature=runtime.indexOf("(",start);let parentheses=0,signatureEnd=-1;
  for(let index=signature;index<runtime.length;index++){
    if(runtime[index]==="(")parentheses++;
    else if(runtime[index]===")"&&--parentheses===0){signatureEnd=index;break;}
  }
  assert.notEqual(signatureEnd,-1,`unterminated signature ${name}`);
  const body=runtime.indexOf("{",signatureEnd);let depth=0;
  for(let index=body;index<runtime.length;index++){
    if(runtime[index]==="{")depth++;
    else if(runtime[index]==="}"&&--depth===0)return runtime.slice(start,index+1);
  }
  assert.fail(`unterminated function ${name}`);
}

test("PenEcho Agent keeps a slightly larger bottom follow zone",()=>{
  const threshold=Number(/CANVAS_AGENT_FOLLOW_LATEST_PX = (\d+)/.exec(runtime)?.[1]);
  assert.equal(threshold,48);
  const canvasAgentTranscript={scrollHeight:1000,clientHeight:400,scrollTop:552},
    nearLatest=vm.runInNewContext(`(()=>{${functionSource("canvasAgentTranscriptNearLatest")}return canvasAgentTranscriptNearLatest;})()`,{canvasAgentTranscript,CANVAS_AGENT_FOLLOW_LATEST_PX:threshold});
  assert.equal(nearLatest(),true,"48px from the bottom remains inside the follow zone");
  canvasAgentTranscript.scrollTop=551;
  assert.equal(nearLatest(),false,"the follow zone remains bounded");
});

test("PenEcho Agent follows instantly unless the user actually left the bottom",()=>{
  const canvasAgent={followLatest:true},canvasAgentTranscript={scrollHeight:1000,clientHeight:400,scrollTop:200},
    scrollLatest=vm.runInNewContext(`(()=>{${functionSource("canvasAgentScrollToLatest")}return canvasAgentScrollToLatest;})()`,{canvasAgent,canvasAgentTranscript});
  assert.equal(scrollLatest(),true);
  assert.equal(canvasAgentTranscript.scrollTop,600);
  canvasAgent.followLatest=false;canvasAgentTranscript.scrollTop=240;
  assert.equal(scrollLatest(),false);
  assert.equal(canvasAgentTranscript.scrollTop,240,"manual history reading is preserved");
  assert.equal(scrollLatest(true),true);
  assert.equal(canvasAgentTranscript.scrollTop,600,"explicit conversation loads still force the latest position");
  assert.match(css,/\.canvas-agent-transcript\s*\{[^}]*scroll-behavior:\s*auto/);
  assert.doesNotMatch(runtime,/canvasAgentTranscript\.addEventListener\("wheel"[\s\S]*?followLatest\s*=\s*false/);
});

test("PenEcho Agent coalesces layout follow-ups and rechecks user intent",()=>{
  const callbacks=[],canvasAgent={followLatest:true,scrollLatestFrame:0},scrolls=[],
    schedule=vm.runInNewContext(`(()=>{${functionSource("canvasAgentScheduleScrollToLatest")}return canvasAgentScheduleScrollToLatest;})()`,{
      canvasAgent,requestAnimationFrame(callback){callbacks.push(callback);return callbacks.length;},canvasAgentScrollToLatest(){scrolls.push(canvasAgent.followLatest);return canvasAgent.followLatest;},
    });
  schedule();schedule();
  assert.equal(callbacks.length,1,"repeated layout changes share one follow-up frame");
  canvasAgent.followLatest=false;
  callbacks.shift()();
  assert.deepEqual(scrolls,[false],"a user scroll before the frame prevents forced repositioning");
  assert.equal(canvasAgent.scrollLatestFrame,0);
  schedule();
  assert.equal(callbacks.length,0,"layout changes do not move a conversation the user is reading");
});

test("PenEcho Agent repairs bottom position after result, completion, and layout changes",()=>{
  const handleEvent=functionSource("canvasAgentHandleEvent");
  assert.match(handleEvent,/tool_result[\s\S]*?canvasAgentScheduleHistoryPersist\(0\);[\s\S]*?canvasAgentScrollToLatest\(\)/);
  assert.match(handleEvent,/turn_end[\s\S]*?canvasAgentMarkTurnSummaryCopyable[\s\S]*?canvasAgentSetRunning\(false\)[\s\S]*?canvasAgentScrollToLatest\(\)/);
  assert.match(runtime,/new ResizeObserver\(canvasAgentScheduleScrollToLatest\)\.observe\(canvasAgentTranscript\)/);
  assert.match(runtime,/new MutationObserver\(canvasAgentScheduleScrollToLatest\)\.observe\(canvasAgentTranscript,\{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:\["class","hidden","open","style"\]\}\)/,"activity notes and other asynchronous transcript content changes keep the latest item visible");
});
