"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { KimiAcpClient } = require("../src/providers/kimi-acp.js");

function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-kimi-acp-test-"));
  test.after(() => fs.rmSync(directory, { recursive:true, force:true }));
  return directory;
}

function fakeAcpAgent(directory) {
  const file = path.join(directory, "fake-kimi-acp.js");
  fs.writeFileSync(file, `#!/usr/bin/env node
"use strict";
let buffer="",pendingToolPrompt=null,toolAttempted=false,permissionRejected=false;
const send=message=>process.stdout.write(JSON.stringify(message)+"\\n");
process.stdin.on("data",chunk=>{
  buffer+=chunk;
  for(;;){
    const end=buffer.indexOf("\\n");
    if(end<0)return;
    const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
    if(!line.trim())continue;
    const message=JSON.parse(line);
    if(message.method==="initialize")send({jsonrpc:"2.0",id:message.id,result:{protocolVersion:1,agentInfo:{name:"fake-kimi"}}});
    else if(message.method==="session/new")send({jsonrpc:"2.0",id:message.id,result:{sessionId:"session-"+message.id}});
    else if(message.method==="session/set_config_option")send({jsonrpc:"2.0",id:message.id,result:{}});
    else if(message.method==="session/cancel"&&pendingToolPrompt){send({jsonrpc:"2.0",id:pendingToolPrompt,result:{stopReason:"cancelled"}});pendingToolPrompt=null;}
    else if(message.id===900&&message.method===undefined){permissionRejected=message.result?.outcome?.optionId==="reject";}
    else if(message.method==="session/prompt"){
      const text=message.params.prompt.find(block=>block.type==="text")?.text;
      if(text==="two-images"&&message.params.prompt.filter(block=>block.type==="image").length!==2){send({jsonrpc:"2.0",id:message.id,error:{message:"expected two images"}});continue;}
      if(text==="tool-once"){
        toolAttempted=true;pendingToolPrompt=message.id;
        send({jsonrpc:"2.0",method:"session/update",params:{sessionId:message.params.sessionId,update:{sessionUpdate:"tool_call",toolCallId:"tool-1",title:"ReadMediaFile: canvas.webp",status:"in_progress"}}});
        send({jsonrpc:"2.0",method:"session/update",params:{sessionId:message.params.sessionId,update:{sessionUpdate:"tool_call_update",toolCallId:"tool-1",title:"ReadMediaFile: canvas.webp",status:"in_progress"}}});
        send({jsonrpc:"2.0",id:900,method:"session/request_permission",params:{sessionId:message.params.sessionId,toolCall:{toolCallId:"tool-1",title:"ReadMediaFile: canvas.webp"},options:[{optionId:"reject",kind:"reject_once"}]}});
        continue;
      }
      if(text?.startsWith("ERROR: PenEcho rejected your Kimi/CLI built-in tool call")){
        if(!toolAttempted||!permissionRejected||message.params.prompt.some(block=>block.type==="image")){send({jsonrpc:"2.0",id:message.id,error:{message:"invalid tool recovery"}});continue;}
        send({jsonrpc:"2.0",method:"session/update",params:{sessionId:message.params.sessionId,update:{sessionUpdate:"agent_message_chunk",content:{type:"text",text:"Recovered"}}}});
        send({jsonrpc:"2.0",id:message.id,result:{stopReason:"end_turn"}});
        continue;
      }
      send({jsonrpc:"2.0",method:"session/update",params:{sessionId:message.params.sessionId,update:{sessionUpdate:"agent_message_chunk",content:{type:"text",text:"Hel"}}}});
      send({jsonrpc:"2.0",method:"session/update",params:{sessionId:message.params.sessionId,update:{sessionUpdate:"agent_message_chunk",content:{type:"text",text:"lo"}}}});
      send({jsonrpc:"2.0",id:message.id,result:{stopReason:"end_turn",usage:{input_tokens:20,cache_read_tokens:70,output_tokens:8}}});
    }
  }
});
`);
  fs.chmodSync(file, 0o755);
  return file;
}

test("Kimi ACP keeps one process while creating isolated sessions", async () => {
  const directory = temporaryDirectory(), executable = fakeAcpAgent(directory),
    events = [],
    client = new KimiAcpClient({
      launch:{ command:process.execPath, prefixArgs:[executable] },
      env:{ PATH:process.env.PATH, HOME:os.homedir() },
      workDir:directory,
      kimiHome:path.join(directory, "kimi-home"),
      logger:(event, data)=>events.push({ event, data }),
    });
  try {
    let activityCount=0,usage=null;
    assert.equal(await client.request({ prompt:"first", model:"kimi-code/k3", effort:"medium", onActivity:()=>activityCount++, onUsage:value=>{usage=value;} }), "Hello");
    assert.ok(activityCount>0);
    assert.deepEqual(usage,{input_tokens:20,cache_read_tokens:70,output_tokens:8});
    assert.equal(await client.request({ prompt:"second" }), "Hello");
    assert.equal(await client.request({ prompt:"two-images", images:[{mimeType:"image/png",data:"AA=="},{mimeType:"image/webp",data:"AQ=="}] }), "Hello");
    assert.equal(await client.request({ prompt:"tool-once", image:{mimeType:"image/webp",data:"Ag=="} }), "Recovered");
    assert.deepEqual(events.filter(entry=>entry.event==="acp-tool-rejected").map(entry=>entry.data.tool), ["ReadMediaFile"]);
    assert.deepEqual(events.filter(entry=>entry.event==="acp-tool-recovery").map(entry=>entry.data.attempt), [1]);
  } finally {
    await client.close();
  }
});
