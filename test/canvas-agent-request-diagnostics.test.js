"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");

const ROOT = path.resolve(__dirname,"..");
const { createCanvasAgentRequestTracer } = require("../src/server/canvas-agent/request-trace.js");

async function waitFor(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  throw new Error("Timed out waiting for PenEcho Agent diagnostic test state.");
}

test("PenEcho Agent request trace records provider cache ratios for API usage",t=>{
  const stateDirectory=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-canvas-agent-api-usage-")),requestTraceDirectory=path.join(stateDirectory,"logs","requests"),
    tracer=createCanvasAgentRequestTracer({requestTraceDirectory,prune:()=>{}}),conversationId="api-usage-conversation",
    connection={provider:"api",format:"openai",model:"qwen-test",effort:"max"},event=(type,data,time)=>({type,data,time});
  t.after(()=>fs.rmSync(stateDirectory,{recursive:true,force:true}));
  tracer({phase:"start",conversationId,connectionId:"api-usage",connection});
  tracer({phase:"event",conversationId,connectionId:"api-usage",event:event("turn/start",{turn:1},"2026-08-26T00:00:00.000Z")});
  tracer({phase:"event",conversationId,connectionId:"api-usage",event:event("step/start",{turn:1,step:1},"2026-08-26T00:00:01.000Z")});
  tracer({phase:"event",conversationId,connectionId:"api-usage",event:event("assistant/message",{turn:1,step:1,usage:{inputTokens:25,outputTokens:9,cacheReadTokens:75},message:{role:"assistant",source:{provider:"penecho-api",model:"qwen-test"},content:[{type:"text",text:"First response"}]}},"2026-08-26T00:00:02.000Z"),messages:[]});
  tracer({phase:"event",conversationId,connectionId:"api-usage",event:event("step/end",{turn:1,step:1},"2026-08-26T00:00:03.000Z")});
  tracer({phase:"event",conversationId,connectionId:"api-usage",event:event("step/start",{turn:1,step:2},"2026-08-26T00:00:04.000Z")});
  tracer({phase:"event",conversationId,connectionId:"api-usage",event:event("assistant/message",{turn:1,step:2,usage:{inputTokens:10,outputTokens:2,cacheWriteTokens:5},message:{role:"assistant",source:{provider:"penecho-api",model:"qwen-test"},content:[{type:"text",text:"Second response"}]}},"2026-08-26T00:00:05.000Z"),messages:[]});
  tracer({phase:"event",conversationId,connectionId:"api-usage",event:event("turn/end",{turn:1,reason:{kind:"completed"}},"2026-08-26T00:00:06.000Z")});
  const directory=fs.readdirSync(requestTraceDirectory,{withFileTypes:true}).find(entry=>entry.isDirectory()),trace=JSON.parse(fs.readFileSync(path.join(requestTraceDirectory,directory.name,"trace.json"),"utf8"));
  assert.deepEqual(trace.steps.map(step=>step.response.usage.cacheReadRatio),[.75,0]);
  assert.deepEqual(trace.steps.map(step=>step.response.usage.promptTokens),[100,15]);
  assert.deepEqual(trace.apiUsage,{
    calls:2,
    cacheHitCalls:1,
    inputTokens:35,
    cacheReadTokens:75,
    cacheWriteTokens:5,
    promptTokens:115,
    outputTokens:11,
    reasoningTokens:0,
    cacheReadRatio:.652174,
    cacheWriteRatio:.043478,
    cacheHitRatio:.5,
  });
});

test("PenEcho Agent request trace records the normalized ink-image upload and exact LLM request image",async t=>{
  const stateDirectory=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-canvas-agent-handwriting-trace-")),requestTraceDirectory=path.join(stateDirectory,"logs","requests"),messages=[],
    tracer=createCanvasAgentRequestTracer({requestTraceDirectory,prune:()=>{}}),
    connection={id:"handwriting-trace",provider:"claude-cli",name:"Handwriting trace",cliPath:"claude-test",cliModel:"claude-test",effort:"medium"},
    webp=await sharp({create:{width:48,height:32,channels:4,background:{r:255,g:255,b:255,alpha:1}}}).webp({lossless:true}).toBuffer(),
    {CanvasHarnessHost}=await import("../src/server/canvas-agent/runtime.mjs"),
    host=new CanvasHarnessHost({
      stateDirectory,
      rootDirectory:ROOT,
      resolveConnection:id=>id===connection.id?connection:null,
      listConnections:()=>[connection],
      conversationTrace:tracer,
      callCli:async()=>JSON.stringify({type:"final",text:"Handwriting received."}),
    });
  t.after(async()=>{
    await host.dispose();
    fs.rmSync(stateDirectory,{recursive:true,force:true});
  });
  const session=await host.connect({clientId:"handwriting-trace-client",connectionId:connection.id,binding:{},send:(type,payload)=>messages.push({type,payload})});
  host.updateState(session,{revision:1,canvas:{width:20000,height:20000},objects:[]});
  await host.submit(session,"Read the image instruction.",false,[{
    name:"canvas-agent-message.webp",mediaType:"image/webp",data:webp.toString("base64"),width:48,height:32,
  }]);
  await waitFor(()=>messages.some(message=>message.type==="session_event"&&message.payload.kind==="turn_end"));
  const directory=fs.readdirSync(requestTraceDirectory,{withFileTypes:true}).find(entry=>entry.isDirectory()),trace=JSON.parse(fs.readFileSync(path.join(requestTraceDirectory,directory.name,"trace.json"),"utf8")),records=trace.imageDiagnostics;
  assert.equal(trace.status,"completed");
  assert.deepEqual(records.map(record=>record.stage),["upload-admission","llm-request"]);
  assert.equal(records[0].kind,"canvas-agent-handwriting");
  assert.equal(records[0].preservedOriginal,false);
  assert.equal(records[0].byteIdenticalToAdmitted,true);
  assert.deepEqual(records[0].clientReported,{width:48,height:32});
  assert.equal(records[0].name,"canvas-agent-message.webp");
  assert.deepEqual(records[0].admitted,{mediaType:"image/webp",bytes:webp.length,width:48,height:32});
  assert.equal(records[1].kind,"canvas-agent-handwriting");
  assert.equal(records[1].name,"canvas-agent-message.webp");
  assert.equal(records[1].mediaType,"image/webp");
  assert.equal(records[1].bytes,webp.length);
  assert.equal(records[1].width,48);
  assert.equal(records[1].height,32);
  assert.equal(records[1].byteIdenticalToAdmitted,true);
  assert.equal(records[1].transformedForModel,false);
  assert.deepEqual(records[1].policy,{maxPixels:2048*2048,maxBytes:5*1024*1024});
  assert.equal(records[0].sha256,records[1].sha256);
  for(const record of records)assert.equal(fs.readFileSync(path.join(requestTraceDirectory,directory.name,record.file)).equals(webp),true);
  assert.equal(JSON.stringify(trace).includes(webp.toString("base64")),false);
});

test("PenEcho Agent handwriting diagnostics recognize WebP primary and PNG fallback filenames",async()=>{
  const { isCanvasAgentHandwritingImageName }=await import("../src/server/canvas-agent/runtime.mjs");
  assert.equal(isCanvasAgentHandwritingImageName("canvas-agent-message.webp"),true);
  assert.equal(isCanvasAgentHandwritingImageName("canvas-agent-message.png"),true);
  assert.equal(isCanvasAgentHandwritingImageName("canvas-agent-message.jpg"),false);
});

test("PenEcho Agent request trace retains redacted CLI provider diagnostics",async t=>{
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

test("PenEcho Agent request trace keeps complete large standard JSON tool bodies",t=>{
  const stateDirectory=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-canvas-agent-full-body-trace-")),requestTraceDirectory=path.join(stateDirectory,"logs","requests"),
    tracer=createCanvasAgentRequestTracer({requestTraceDirectory,prune:()=>{}}),conversationId="full-body-conversation",
    body=JSON.stringify({baseRevision:1,items:[{type:"widget",pluginId:"general",widgetType:"html_widget",title:"Full body",html:`<main>${"complete-body-segment-".repeat(6000)}</main>`}]});
  t.after(()=>fs.rmSync(stateDirectory,{recursive:true,force:true}));
  assert.ok(body.length>64_000);
  tracer({phase:"start",conversationId,connectionId:"codex-native",connection:{provider:"codex-cli",model:"codex-model"}});
  tracer({phase:"event",conversationId,connectionId:"codex-native",event:{kind:"turn_start",turn:1,step:1}});
  tracer({phase:"diagnostic",conversationId,connectionId:"codex-native",diagnostic:{provider:"codex-cli",model:"codex-model",traceDiagnostic:JSON.stringify({kind:"native-response-boundary",toolCallCount:1,rawCalls:[{name:"exec",arguments:body}]})}});
  tracer({phase:"event",conversationId,connectionId:"codex-native",event:{kind:"turn_end",turn:1,step:1,reason:{kind:"completed"}}});
  const directory=fs.readdirSync(requestTraceDirectory,{withFileTypes:true}).find(entry=>entry.isDirectory()),trace=JSON.parse(fs.readFileSync(path.join(requestTraceDirectory,directory.name,"trace.json"),"utf8"));
  assert.equal(trace.diagnostics[0].trace.value.rawCalls[0].arguments,body);
  assert.equal(JSON.stringify(trace).includes("…[truncated]"),false);
});

test("PenEcho Agent request trace records each widget patch protocol failure and retry independently",async t=>{
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
