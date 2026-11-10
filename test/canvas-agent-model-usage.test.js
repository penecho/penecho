"use strict";

const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const test=require("node:test");

const ROOT=path.resolve(__dirname,"..");
const waitFor=async(predicate,timeoutMs=3_000)=>{
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){if(predicate())return;await new Promise((resolve)=>setTimeout(resolve,10));}
  throw new Error("Timed out waiting for PenEcho Agent model usage.");
};

test("Harness reports local model usage metadata without conversation content",async (context)=>{
  const stateDirectory=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-agent-usage-test-"));
  context.after(()=>fs.rmSync(stateDirectory,{recursive:true,force:true}));
  const {CanvasHarnessHost}=await import("../src/server/canvas-agent/runtime.mjs");
  const reports=[],messages=[];
  const connection={id:"usage-cli",provider:"codex-cli",name:"Usage CLI",cliPath:"codex-test",cliModel:"gpt-test",effort:"medium"};
  const host=new CanvasHarnessHost({
    stateDirectory,rootDirectory:ROOT,resolveConnection:(id)=>id===connection.id?connection:null,listConnections:()=>[connection],
    callCli:async(request)=>{request.onUsage({input_tokens:100,cached_input_tokens:75,output_tokens:9});return JSON.stringify({type:"final",text:"Usage observed."});},
    onModelUsage:async(report)=>{reports.push(report);},
  });
  context.after(()=>host.dispose());
  const session=await host.connect({clientId:"usage-client",connectionId:connection.id,binding:{},send:(type,payload)=>messages.push({type,payload})});
  host.updateState(session,{revision:1,canvas:{width:100,height:100},objects:[]});
  await host.submit(session,"Measure this request.");
  await waitFor(()=>messages.some((message)=>message.type==="session_event"&&message.payload.kind==="turn_end")&&reports.length===1);
  assert.equal(reports[0].connectionId,connection.id);
  assert.equal(reports[0].connectionName,connection.name);
  assert.equal(reports[0].model,connection.cliModel);
  assert.equal(reports[0].usageFormat,"harness");
  assert.equal(reports[0].status,"succeeded");
  assert.deepEqual(reports[0].usage,{inputTokens:25,outputTokens:9,cacheReadTokens:75});
  assert.match(reports[0].requestId,/^[0-9a-f-]{36}$/i);
  assert.equal(Number.isFinite(reports[0].createdAt),true);
  assert.equal(Number.isFinite(reports[0].completedAt),true);
  assert.equal(Object.hasOwn(reports[0],"prompt"),false);
  assert.equal(Object.hasOwn(reports[0],"messages"),false);
});

test("Harness never duplicates hosted usage into the local callback",async (context)=>{
  const stateDirectory=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-hosted-usage-test-"));
  context.after(()=>fs.rmSync(stateDirectory,{recursive:true,force:true}));
  const {CanvasHarnessHost}=await import("../src/server/canvas-agent/runtime.mjs");
  const reports=[],messages=[];
  const connection={id:"hosted:db6e5128-0ec7-4a2a-a9bd-6b20c49c322b",provider:"codex-cli",name:"Hosted bridge",cliPath:"codex-test",cliModel:"glm",effort:"medium"};
  const host=new CanvasHarnessHost({
    stateDirectory,rootDirectory:ROOT,resolveConnection:(id)=>id===connection.id?connection:null,listConnections:()=>[connection],
    callCli:async(request)=>{request.onUsage({input_tokens:10,output_tokens:2});return JSON.stringify({type:"final",text:"Hosted."});},
    onModelUsage:(report)=>reports.push(report),
  });
  context.after(()=>host.dispose());
  const session=await host.connect({clientId:"hosted-usage-client",connectionId:connection.id,binding:{},send:(type,payload)=>messages.push({type,payload})});
  host.updateState(session,{revision:1,canvas:{width:100,height:100},objects:[]});
  await host.submit(session,"Do not duplicate billing.");
  await waitFor(()=>messages.some((message)=>message.type==="session_event"&&message.payload.kind==="turn_end"));
  await new Promise((resolve)=>setImmediate(resolve));
  assert.deepEqual(reports,[]);
});

test("Harness resume tokens remain bound to their server principal",async (context)=>{
  const stateDirectory=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-principal-scope-test-"));
  context.after(()=>fs.rmSync(stateDirectory,{recursive:true,force:true}));
  const {CanvasHarnessHost}=await import("../src/server/canvas-agent/runtime.mjs");
  const connection={id:"scope-cli",provider:"codex-cli",name:"Scope CLI",cliPath:"codex-test",cliModel:"gpt-test",effort:"medium"};
  const frames=[];
  const host=new CanvasHarnessHost({stateDirectory,rootDirectory:ROOT,resolveConnection:(id)=>id===connection.id?connection:null,listConnections:()=>[connection],callCli:async()=>JSON.stringify({type:"final",text:"ok"})});
  context.after(()=>host.dispose());
  const session=await host.connect({clientId:"scope-client",connectionId:connection.id,principal:{accountId:"account-a",canvasId:"canvas-a"},binding:{},send:(type,payload)=>frames.push({type,payload})});
  const ready=frames.find((frame)=>frame.type==="ready");
  await assert.rejects(host.connect({canvasSessionId:session.id,resumeToken:ready.payload.resumeToken,clientId:"scope-client-b",connectionId:connection.id,principal:{accountId:"account-b",canvasId:"canvas-a"},binding:{},send:()=>{}}),/session scope is invalid/);
  assert.equal(host.sessions.get(session.id),session);
});
