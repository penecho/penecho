"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname,"..");
const { createCanvasAgentRequestTracer } = require("../src/server/canvas-agent/request-trace.js");

async function waitFor(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  throw new Error("Timed out waiting for Canvas Agent diagnostic test state.");
}

test("Canvas Agent request trace retains redacted CLI provider diagnostics",async t=>{
  const stateDirectory=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-canvas-agent-cli-diagnostic-")),requestTraceDirectory=path.join(stateDirectory,"logs","requests"),messages=[],
    tracer=createCanvasAgentRequestTracer({requestTraceDirectory,prune:()=>{}}),
    connection={id:"claude-diagnostic",provider:"claude-cli",name:"Claude diagnostic",cliPath:"claude-test",cliModel:"claude-opus-test",effort:"high"},
    diagnostic=JSON.stringify({
      events:[{type:"system",subtype:"init",model:"claude-opus-test",tools:[]},{type:"assistant"}],
      stderr:"Authorization: Bearer provider-secret-token\nCLAUDE_CODE_OAUTH_TOKEN=oauth-secret-value\nrequest failed after native tool_use",
    }),
    {CanvasHarnessHost}=await import("../src/server/canvas-agent/runtime.mjs"),
    host=new CanvasHarnessHost({
      stateDirectory,
      rootDirectory:ROOT,
      resolveConnection:id=>id===connection.id?connection:null,
      listConnections:()=>[connection],
      conversationTrace:tracer,
      callCli:async()=>{
        const error=new Error("Claude CLI attempted disabled tool use: canvas_inspect.");
        error.traceDiagnostic=diagnostic;
        throw error;
      },
    });
  t.after(async()=>{
    await host.dispose();
    fs.rmSync(stateDirectory,{recursive:true,force:true});
  });
  const session=await host.connect({clientId:"diagnostic-client",connectionId:connection.id,binding:{},send:(type,payload)=>messages.push({type,payload})});
  host.updateState(session,{revision:1,canvas:{width:20000,height:20000},objects:[]});
  await host.submit(session,"Inspect this canvas.");
  await waitFor(()=>messages.some(message=>message.type==="session_event"&&message.payload.kind==="turn_end"));
  const directories=fs.readdirSync(requestTraceDirectory,{withFileTypes:true}).filter(entry=>entry.isDirectory());
  assert.equal(directories.length,1);
  const trace=JSON.parse(fs.readFileSync(path.join(requestTraceDirectory,directories[0].name,"trace.json"),"utf8")),serialized=JSON.stringify(trace),providerDiagnostic=trace.diagnostics[0];
  assert.equal(trace.status,"failed");
  assert.equal(providerDiagnostic.kind,"cli-provider");
  assert.equal(providerDiagnostic.provider,"claude-cli");
  assert.equal(providerDiagnostic.model,"claude-opus-test");
  assert.equal(providerDiagnostic.turn,1);
  assert.equal(providerDiagnostic.step,1);
  assert.equal(providerDiagnostic.error.message,"Claude CLI attempted disabled tool use: canvas_inspect.");
  assert.equal(providerDiagnostic.trace.format,"json");
  assert.deepEqual(providerDiagnostic.trace.value.events.map(event=>event.type),["system","assistant"]);
  assert.match(providerDiagnostic.trace.value.stderr,/request failed after native tool_use/);
  assert.match(providerDiagnostic.trace.value.stderr,/<redacted>/);
  assert.doesNotMatch(serialized,/provider-secret-token|oauth-secret-value/);
});

test("Canvas Agent request trace records each widget patch protocol failure and retry independently",async t=>{
  const stateDirectory=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-canvas-agent-patch-trace-")),requestTraceDirectory=path.join(stateDirectory,"logs","requests"),messages=[],calls=[],
    tracer=createCanvasAgentRequestTracer({requestTraceDirectory,prune:()=>{}}),
    connection={id:"patch-trace",provider:"codex-cli",name:"Patch trace",cliPath:"codex-test",cliModel:"gpt-test",effort:"medium"},
    html="<h1>Old trace body</h1>\n",
    barePatch="--- widget.html\n+++ widget.html\n@@ -1 +1 @@\n-<h1>Old trace body</h1>\n+<h1>New trace body</h1>\n",
    fixedPatch="--- a/widget.html\n+++ b/widget.html\n@@ -1 +1 @@\n-<h1>Old trace body</h1>\n+<h1>New trace body</h1>\n",
    decisions=[
      JSON.stringify({type:"tool_call",name:"canvas_patch_widget",arguments:{objectId:"widget-1",baseRevision:7,patch:barePatch}}),
      JSON.stringify({type:"tool_call",name:"canvas_patch_widget",arguments:{objectId:"widget-1",baseRevision:7,patch:fixedPatch}}),
      JSON.stringify({type:"final",text:"Patch corrected."}),
    ],
    {CanvasHarnessHost}=await import("../src/server/canvas-agent/runtime.mjs"),
    host=new CanvasHarnessHost({
      stateDirectory,
      rootDirectory:ROOT,
      resolveConnection:id=>id===connection.id?connection:null,
      listConnections:()=>[connection],
      conversationTrace:tracer,
      callCli:async request=>{calls.push(request);return decisions.shift();},
    });
  t.after(async()=>{
    await host.dispose();
    fs.rmSync(stateDirectory,{recursive:true,force:true});
  });
  let session;
  const widgetEdit={widgetType:"html_widget",pluginId:"general",title:"Trace",refreshSeconds:0,html,source:"",sourceFormat:"",box:{x:100,y:100,w:800,h:500}},send=(type,payload)=>{
    messages.push({type,payload});
    if(type!=="tool_request")return;
    let result;
    if(payload.name==="canvas_internal_widget")result={revision:7,hash:"widget-hash",containerSourceFormat:null,widgetEdit};
    else if(payload.name==="canvas_internal_replace_widget")result={revision:8,changeId:payload.callId};
    else throw new Error(`Unexpected browser tool ${payload.name}`);
    queueMicrotask(()=>host.resolveToolResult(session,{requestId:payload.requestId,ok:true,result}));
  };
  session=await host.connect({clientId:"patch-trace-client",connectionId:connection.id,binding:{},send});
  host.updateState(session,{revision:7,canvas:{width:20000,height:20000,contentBounds:{x:100,y:100,width:800,height:500}},counts:{widgets:1},objects:[{id:"widget-1",kind:"widget",box:{x:100,y:100,width:800,height:500}}]});
  await host.submit(session,"Correct the widget heading.");
  await waitFor(()=>messages.some(message=>message.type==="session_event"&&message.payload.kind==="turn_end"));
  assert.equal(calls.length,3);
  const retryConversation=JSON.stringify(JSON.parse(calls[1].prompt).conversation);
  assert.match(retryConversation,/Widget patch file headers are invalid/);
  assert.match(retryConversation,/--- a\/widget\.html[\s\S]*\+\+\+ b\/widget\.html[\s\S]*a\/ and b\/ prefixes are mandatory/);
  const directories=fs.readdirSync(requestTraceDirectory,{withFileTypes:true}).filter(entry=>entry.isDirectory());
  assert.equal(directories.length,1);
  const trace=JSON.parse(fs.readFileSync(path.join(requestTraceDirectory,directories[0].name,"trace.json"),"utf8")),records=trace.patchProtocol;
  assert.deepEqual(records.map(record=>record.kind),["widget-patch-protocol-error","widget-patch-retry","widget-patch-retry-result"]);
  assert.deepEqual(records.map(record=>record.attempt),[1,2,2]);
  assert.deepEqual(records.map(record=>record.retryOf),[null,1,1]);
  assert.equal(records[0].error.code,"WIDGET_PATCH_FILE_HEADER");
  assert.deepEqual(records[0].headers,["--- widget.html","+++ widget.html"]);
  assert.deepEqual(records[1].headers,["--- a/widget.html","+++ b/widget.html"]);
  assert.equal(records[2].outcome,"applied");
  assert.equal(JSON.stringify(records).includes("Old trace body"),false,"patch traces must store envelope metadata, not the complete diff body");
});
