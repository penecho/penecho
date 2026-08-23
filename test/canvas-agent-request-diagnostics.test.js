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
