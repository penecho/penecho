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
let buffer="";
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
    else if(message.method==="session/prompt"){
      send({jsonrpc:"2.0",method:"session/update",params:{sessionId:message.params.sessionId,update:{sessionUpdate:"agent_message_chunk",content:{type:"text",text:"Hel"}}}});
      send({jsonrpc:"2.0",method:"session/update",params:{sessionId:message.params.sessionId,update:{sessionUpdate:"agent_message_chunk",content:{type:"text",text:"lo"}}}});
      send({jsonrpc:"2.0",id:message.id,result:{stopReason:"end_turn"}});
    }
  }
});
`);
  fs.chmodSync(file, 0o755);
  return file;
}

test("Kimi ACP keeps one process while creating isolated sessions", async () => {
  const directory = temporaryDirectory(), executable = fakeAcpAgent(directory),
    client = new KimiAcpClient({
      launch:{ command:process.execPath, prefixArgs:[executable] },
      env:{ PATH:process.env.PATH, HOME:os.homedir() },
      workDir:directory,
      kimiHome:path.join(directory, "kimi-home"),
    });
  try {
    let activityCount=0;
    assert.equal(await client.request({ prompt:"first", model:"kimi-code/k3", effort:"medium", onActivity:()=>activityCount++ }), "Hello");
    assert.ok(activityCount>0);
    assert.equal(await client.request({ prompt:"second" }), "Hello");
  } finally {
    await client.close();
  }
});
