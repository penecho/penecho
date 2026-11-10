"use strict";
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {getAuthoringGuidance}=require('../src/server/mcp/authoring-guidance.js');

async function runRequest(t, prompt, respond) {
  const stateDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'penecho-lazy-design-'));
  const {CanvasHarnessHost}=await import('../src/server/canvas-agent/runtime.mjs');
  const calls=[],messages=[];
  const connection={id:'design',provider:'codex-cli',cliPath:'codex-test',cliModel:'test',effort:'medium'};
  const host=new CanvasHarnessHost({stateDirectory,rootDirectory:path.resolve(__dirname,'..'),resolveConnection:()=>connection,listConnections:()=>[connection],callCli:async request=>{
    calls.push(request);
    return JSON.stringify(respond(calls.length));
  }});
  t.after(async()=>{await host.dispose();fs.rmSync(stateDirectory,{recursive:true,force:true});});
  const session=await host.connect({clientId:'design',connectionId:connection.id,binding:{},send:(type,payload)=>messages.push({type,payload})});
  host.updateState(session,{revision:1,canvas:{width:100,height:100},objects:[]});
  await host.submit(session,prompt);
  const deadline=Date.now()+10000;
  while(!messages.some(event=>event.payload.kind==='turn_end') && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
  assert.ok(messages.some(event=>event.payload.kind==='turn_end'));
  return {calls,messages};
}

function assertDeferredDesign(systemPrompt) {
  const guidance=getAuthoringGuidance('visual-explorer','full');
  assert.ok(!systemPrompt.includes(guidance.document));
  assert.doesNotMatch(systemPrompt, /## 1\. Information Architecture|penecho_canvas_agent_visual_explorer/);
  assert.match(systemPrompt,/Before authoring a Visual Explorer, read penecho_get_guidance/);
}

test('a fresh hi request retains routing and tools without preloading Visual Explorer design', async t => {
  const {calls,messages}=await runRequest(t,'hi',()=>({type:'final',text:'Hi!'}));
  assert.equal(calls.length,1);
  assertDeferredDesign(calls[0].systemPrompt);
  assert.ok(!calls[0].prompt.includes(JSON.stringify(getAuthoringGuidance('visual-explorer','full').document).slice(1,-1)));
  const request=JSON.parse(calls[0].prompt);
  assert.ok(request.availableTools.some(tool=>tool.name==='penecho_get_guidance'));
  assert.ok(request.availableTools.some(tool=>tool.name==='penecho_present_widget'));
  assert.ok(!request.availableTools.some(tool=>tool.name==='canvas_create'));
  assert.equal(request.conversation.flatMap(message=>message.content).some(part=>part.type==='tool_result'),false);
  assert.equal(messages.some(event=>event.type==='tool_request'),false);
});

test('Visual Explorer guidance reaches the next Harness step in full only after an explicit read', async t => {
  const {calls,messages}=await runRequest(t,'Explain how a compiler works visually.',step=>step===1
    ? {type:'tool_call',name:'penecho_get_guidance',arguments:{id:'visual-explorer'}}
    : {type:'final',text:'The complete design guidance is available.'});
  assert.equal(calls.length,2);
  assertDeferredDesign(calls[0].systemPrompt);
  assert.equal(calls[1].systemPrompt,calls[0].systemPrompt);
  const first=JSON.parse(calls[0].prompt),second=JSON.parse(calls[1].prompt);
  assert.deepEqual(second.availableTools,first.availableTools);
  assert.equal(first.conversation.flatMap(message=>message.content).some(part=>part.type==='tool_result'),false);
  const results=second.conversation.flatMap(message=>message.content).filter(part=>part.type==='tool_result');
  assert.equal(results.length,1);
  const actual=JSON.parse(results[0].content[0].text),full=getAuthoringGuidance('visual-explorer','full');
  assert.deepEqual(actual,getAuthoringGuidance('visual-explorer'));
  assert.equal(actual.document,full.document);
  assert.equal(actual.hash,full.hash);
  assert.match(actual.document,/Correct a concrete mismatch found in rendered evidence/);
  assert.equal(messages.some(event=>event.type==='tool_request'),false);
});

test('native Agent also defers the same complete Visual Explorer design to its guidance tool', async () => {
  const {createCanvasAgentNativeRuntime}=await import('../src/server/canvas-agent/runtime.mjs');
  const runtime=await createCanvasAgentNativeRuntime({
    session:{id:'native-lazy-design',publicWebEnabled:false,webSearch:{enabled:false},attachmentRefs:new Map()},
    attachments:{saveImages:async()=>[]},
  });
  const instructions=runtime.instructions();
  assertDeferredDesign(instructions);
  const tools=runtime.dynamicTools();
  const result=await runtime.tool('penecho_get_guidance').execute({id:'visual-explorer'}, {callId:'load-design',signal:new AbortController().signal});
  const full=getAuthoringGuidance('visual-explorer','full');
  assert.equal(result.document,full.document);
  assert.equal(result.hash,full.hash);
  assert.equal(runtime.instructions(),instructions);
  assert.deepEqual(runtime.dynamicTools(),tools);
  assert.ok(!JSON.stringify(runtime.turnAdditionalContext()).includes(JSON.stringify(full.document).slice(1,-1)));
});
