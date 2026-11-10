"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
test('native public progress projects only complete leading lines and completion does not repeat them',async()=>{
  const {CodexNativeHost}=await import('../src/server/canvas-agent/codex-native-host.mjs');
  const events=[],host={emitPublicEvent:(_,event)=>events.push(event)},session={turnNumber:1},
    active={text:'进展：正在检查',responseTextStart:0,completedResponseMessages:[]};
  const project=()=>CodexNativeHost.prototype.projectNativeProgress.call(host,session,active);
  project();assert.equal(events.length,0);
  active.text+='源码\n';project();project();assert.equal(events.length,1);
  active.text+='已完成';CodexNativeHost.prototype.sealNativeAssistantResponse.call(host,session,active);
  assert.equal(events.map(e=>e.text).join(''),'进展：正在检查源码\n已完成');
  active.text+='普通回复\n';project();assert.equal(events.length,2);
  const title={...active,text:'Progress: preparing\n',responseTextStart:0,titleRequested:true};
  CodexNativeHost.prototype.projectNativeProgress.call(host,session,title);assert.equal(events.length,3);
  assert.equal(events.at(-1).text,'Progress: preparing\n');
});
