"use strict";
const assert=require('node:assert/strict'),test=require('node:test');

test('native diagnostics separate byte traffic from activity and reset counters between turns',async()=>{
  const {NativeActivityDiagnostics}=await import('../src/server/canvas-agent/native-activity-diagnostics.mjs');
  let time=1000;const d=new NativeActivityDiagnostics({now:()=>1700000000000+time,monotonicNow:()=>time});
  d.recordStdoutChunk('previous turn');d.recordJsonLine();
  const turn=d.beginTurn({turnNumber:2});
  time+=10;d.recordStdoutChunk('中文');d.setRawBufferBytes(6);
  let s=turn.summary('timeout');
  assert.equal(s.process.stdoutBytes,6);assert.equal(s.process.stdoutChunks,1);assert.equal(s.process.jsonLines,0);
  assert.equal(s.process.rawBufferBytes,6);assert.equal(s.activity.last,null);
  turn.notification('ignored','unknown-event');assert.equal(turn.summary('timeout').activity.last,null);
  time+=10;turn.notification('recognized','item/reasoning/textDelta');turn.activity('item/reasoning/textDelta');
  d.recordJsonLine();d.setRawBufferBytes(0);d.recordJsonRpcReply();d.recordJsonRpcReply({callback:true,error:true});
  s=turn.summary('timeout',{pendingRequests:1,pendingAdmissions:2,executingTools:3});
  assert.equal(s.activity.last.source,'item/reasoning/textDelta');assert.equal(s.process.replyCallbackErrors,1);
  assert.deepEqual(s.pending,{requests:1,admissions:2,executingTools:3});
  turn.close();const next=d.beginTurn({turnNumber:3}).summary('completed');
  assert.equal(next.process.stdoutBytes,0);assert.equal(next.process.lastStdout,null);assert.equal(next.process.lastReplyWrite,null);
});

test('native activity summary is bounded and excludes raw content, arbitrary method names and stderr',async()=>{
  const {NativeActivityDiagnostics}=await import('../src/server/canvas-agent/native-activity-diagnostics.mjs');
  const d=new NativeActivityDiagnostics(),turn=d.beginTurn({turnNumber:1});
  const secret='PRIVATE_SOURCE_COOKIE_REASONING';
  d.recordStdoutChunk(secret);d.recordStderrChunk(secret);
  for(let i=0;i<500;i++) {turn.notification('ignored',secret+i);turn.activity(secret+i);turn.phase(secret);turn.tool(secret);}
  d.recordProcessExit(1,secret);const s=turn.summary('timeout');
  assert.equal(JSON.stringify(s).includes(secret),false);
  assert.ok(Object.keys(s.notifications.ignored).length<=33);assert.ok(Object.keys(s.activity.counts).length<=33);
  assert.ok(s.recentEvents.length<=64);assert.equal(s.process.exit.signal,null);
  assert.equal(s.process.stderrBytes,Buffer.byteLength(secret));
  const before=JSON.stringify(s.recentEvents);turn.close();turn.notification('recognized','item/started');
  assert.equal(JSON.stringify(turn.summary('completed').recentEvents),before);
});

test('process buffers incomplete JSON while diagnostics record traffic without model activity',async()=>{
  const {CodexNativeAppServerProcess}=await import('../src/server/canvas-agent/codex-native-host.mjs');
  const {NativeActivityDiagnostics}=await import('../src/server/canvas-agent/native-activity-diagnostics.mjs');
  const d=new NativeActivityDiagnostics(),turn=d.beginTurn({turnNumber:1}),received=[];
  const p=new CodexNativeAppServerProcess({connection:{},diagnostics:d,onNotification:(method,params)=>received.push({method,params})});
  p.child={};const line=JSON.stringify({method:'item/agentMessage/delta',params:{delta:'private reply'}})+'\n';
  p.handleData(line.slice(0,15));assert.equal(received.length,0);
  assert.equal(turn.summary('timeout').process.rawBufferBytes,15);assert.equal(turn.summary('timeout').activity.last,null);
  p.handleData(line.slice(15));assert.equal(received.length,1);assert.equal(received[0].params.delta,'private reply');
  const s=turn.summary('completed');assert.equal(s.process.jsonLines,1);assert.equal(s.process.rawBufferBytes,0);
  assert.equal(JSON.stringify(s).includes('private reply'),false);
});

test('disabled process diagnostics keep no collector and preserve notification parsing',async()=>{
  const {CodexNativeAppServerProcess}=await import('../src/server/canvas-agent/codex-native-host.mjs');
  let received=0;const p=new CodexNativeAppServerProcess({connection:{},onNotification:()=>received++});p.child={};
  for(let i=0;i<100;i++)p.handleData('{"method":"item/started","params":{}}\n');
  assert.equal(received,100);assert.equal(p.diagnostics,null);assert.equal(p.buffer,'');
});

test('reply diagnostics preserve the disabled write path and separate write from callback failure',async()=>{
  const {CodexNativeAppServerProcess}=await import('../src/server/canvas-agent/codex-native-host.mjs');
  const {NativeActivityDiagnostics}=await import('../src/server/canvas-agent/native-activity-diagnostics.mjs');
  const writes=[],p=new CodexNativeAppServerProcess({connection:{}});
  p.child={stdin:{writable:true,write:(...args)=>writes.push(args)}};
  p.respond(1,{ok:true});assert.equal(writes[0].length,1);
  const d=new NativeActivityDiagnostics(),turn=d.beginTurn();p.diagnostics=d;
  p.respond(2,{private:'not logged'});
  assert.equal(turn.summary('completed').process.replyWrites,1);
  assert.equal(turn.summary('completed').process.replyCallbacks,0);
  writes[1][1](new Error('private failure'));
  const s=turn.summary('completed');assert.equal(s.process.replyCallbacks,1);
  assert.equal(s.process.replyCallbackErrors,1);assert.equal(JSON.stringify(s).includes('private'),false);
});

test('summary trace failure does not interrupt completion or retry duplicate writes',async()=>{
  const {CodexNativeHost}=await import('../src/server/canvas-agent/codex-native-host.mjs');
  const {NativeActivityDiagnostics}=await import('../src/server/canvas-agent/native-activity-diagnostics.mjs');
  const d=new NativeActivityDiagnostics(),active={activityDiagnostics:d.beginTurn(),pendingToolAdmissions:new Map()};
  let attempts=0;
  const session={process:{alive:true,pending:new Map()},pending:new Map(),toolAborts:new Map(),traceDecisionProtocol:()=>{attempts++;throw new Error('disk failure')}};
  const host={logger:()=>{throw new Error('logger failure')}};
  assert.doesNotThrow(()=>CodexNativeHost.prototype.traceNativeActivitySummary.call(host,session,active,'timeout'));
  assert.doesNotThrow(()=>CodexNativeHost.prototype.traceNativeActivitySummary.call(host,session,active,'error'));
  assert.equal(attempts,1);
});
