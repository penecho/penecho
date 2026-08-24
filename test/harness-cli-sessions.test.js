"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname,"..");
const FIXTURE = path.join(ROOT,"tools","test-fixtures","fake-harness-cli.js");
const signal = () => new AbortController().signal;

function connection(provider,id=provider) {
  return { id, provider, name:id, cliPath:FIXTURE, cliModel:"", effort:"config" };
}

test("Harness CLI manager reuses only an exact Harness replay and isolates New sessions",async()=>{
  const {HarnessCliSessionManager}=await import("../src/server/canvas-agent/harness-cli-sessions.mjs"),created=[];
  const manager=new HarnessCliSessionManager({transportFactory:(provider)=>{
    const transport={provider,alive:true,closed:false,requests:[],conversationId:`fake-${created.length+1}`,
      async request(request){this.requests.push(request.prompt);return {output:JSON.stringify({type:"final",text:request.prompt}),providerConversationId:this.conversationId};},
      async close(){this.alive=false;this.closed=true;},
    };
    created.push(transport);
    return transport;
  }}),base={connection:connection("codex-cli","isolated"),systemPrompt:"system",signal:signal()};
  const first=await manager.request({...base,harnessSessionId:"harness-a",fullPrompt:"snapshot-a1",deltaPrompt:"delta-unused"});
  const second=await manager.request({...base,harnessSessionId:"harness-a",fullPrompt:"snapshot-unused",deltaPrompt:"delta-a2",replay:first.replayState.response});
  assert.equal(created.length,1);
  assert.deepEqual(created[0].requests,["snapshot-a1","delta-a2"]);
  assert.equal(second.replayState.response.sessionNonce,first.replayState.response.sessionNonce);

  const fresh=await manager.request({...base,harnessSessionId:"harness-b",fullPrompt:"snapshot-b1",deltaPrompt:"delta-unused"});
  assert.equal(created.length,2,"New Harness session must create a distinct provider transport");
  assert.notEqual(fresh.replayState.response.sessionNonce,first.replayState.response.sessionNonce);

  const rebuilt=await manager.request({...base,harnessSessionId:"harness-a",fullPrompt:"snapshot-a-rebuilt",deltaPrompt:"delta-invalid",replay:null});
  assert.equal(created.length,3,"missing Harness replay must rebuild instead of trusting provider-side history");
  assert.equal(created[0].closed,true);
  assert.deepEqual(created[2].requests,["snapshot-a-rebuilt"]);

  created[2].alive=false;
  await manager.request({...base,harnessSessionId:"harness-a",fullPrompt:"snapshot-after-crash",deltaPrompt:"delta-after-crash",replay:rebuilt.replayState.response});
  assert.equal(created.length,4,"dead provider transport must rebuild from the Harness snapshot");
  assert.deepEqual(created[3].requests,["snapshot-after-crash"]);

  const compacted=await manager.request({...base,harnessSessionId:"harness-b",surfaceMarker:"compact-1",fullPrompt:"compacted-snapshot",deltaPrompt:"stale-delta",replay:fresh.replayState.response});
  assert.equal(created.length,5,"Harness compaction must invalidate the older provider conversation");
  await manager.request({...base,harnessSessionId:"harness-b",surfaceMarker:"compact-1",fullPrompt:"unused-after-compaction",deltaPrompt:"post-compaction-delta",replay:compacted.replayState.response});
  assert.equal(created.length,5,"the rebuilt conversation may continue while the Harness compaction marker is unchanged");
  assert.deepEqual(created[4].requests,["compacted-snapshot","post-compaction-delta"]);
  await manager.disposeSession("harness-a");
  assert.equal(created[3].closed,true);
  assert.equal(created[4].closed,false,"disposing one Harness session must not affect another");
  await manager.dispose();
  assert.equal(created[4].closed,true);
});

test("Harness CLI adapter carries provider identity only through Harness replay metadata",async()=>{
  const {HarnessCliSessionManager}=await import("../src/server/canvas-agent/harness-cli-sessions.mjs"),
    {PenEchoCliAdapter}=await import("../src/server/canvas-agent/cli-adapter.mjs"),requests=[];
  const manager=new HarnessCliSessionManager({transportFactory:()=>({
    alive:true,conversationId:"upstream-thread-1",
    async request(request){requests.push(JSON.parse(request.prompt));return {output:JSON.stringify({type:"final",text:`answer-${requests.length}`}),providerConversationId:this.conversationId};},
    async close(){this.alive=false;},
  })}),adapter=new PenEchoCliAdapter({sessionManager:manager}),provider=adapter.replaceConnections([connection("codex-cli","replay")])[0],first=[];
  const initial={provider,model:"default",sessionId:"harness-replay",system:"canvas-system",messages:[{role:"user",source:{kind:"user"},content:[{type:"text",text:"first"}]}],tools:[]};
  for await(const chunk of adapter.stream(initial))first.push(chunk);
  const replayState=first.find(chunk=>chunk.type==="finish").replayState;
  assert.equal(replayState.response.providerConversationId,"upstream-thread-1");
  const second=[];
  for await(const chunk of adapter.stream({...initial,messages:[
    ...initial.messages,
    {role:"assistant",source:{kind:"model",provider,model:"default",replayState},content:[{type:"text",text:"answer-1"}]},
    {role:"user",source:{kind:"tool"},content:[{type:"text",text:"tool-result"}]},
  ]}))second.push(chunk);
  assert.equal(requests.length,2);
  assert.equal(requests[0].contextMode,"snapshot");
  assert.equal(requests[0].conversation.length,1);
  assert.equal(requests[1].contextMode,"delta");
  assert.equal(requests[1].conversationDelta.length,1);
  assert.equal(requests[1].conversationDelta[0].content[0].text,"tool-result");
  assert.equal(second.find(chunk=>chunk.type==="finish").replayState.response.sessionNonce,replayState.response.sessionNonce);
  await adapter.dispose();
});

test("Harness CLI timeout cancels and discards the persistent provider session",async()=>{
  const {HarnessCliSessionManager}=await import("../src/server/canvas-agent/harness-cli-sessions.mjs"),
    {PenEchoCliAdapter}=await import("../src/server/canvas-agent/cli-adapter.mjs"),created=[];
  const manager=new HarnessCliSessionManager({transportFactory:()=>{
    const transport={alive:true,closed:false,
      request:({signal})=>new Promise((resolve,reject)=>{
        if(signal.aborted)return reject(signal.reason);
        signal.addEventListener("abort",()=>reject(signal.reason),{once:true});
      }),
      async close(){this.alive=false;this.closed=true;},
    };
    created.push(transport);
    return transport;
  }}),adapter=new PenEchoCliAdapter({sessionManager:manager,timeoutMs:()=>15}),provider=adapter.replaceConnections([connection("claude-cli","timeout-persistent")])[0];
  await assert.rejects(async()=>{
    for await(const chunk of adapter.stream({provider,model:"default",sessionId:"harness-timeout",system:"system",messages:[],tools:[]}))void chunk;
  },/timed out/);
  assert.equal(created.length,1);
  assert.equal(created[0].closed,true);
  assert.equal(manager.sessions.size,0,"an interrupted upstream conversation must never be reused without a successful replay");
  await adapter.dispose();
});

for(const provider of ["codex-cli","claude-cli","kimi-cli"]){
  test(`Harness ${provider} transport keeps one live CLI conversation across model steps`,async t=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),`penecho-harness-${provider}-test-`)),auth=path.join(root,"codex-home");
    fs.mkdirSync(auth,{recursive:true});
    fs.writeFileSync(path.join(auth,"auth.json"),"{}",{mode:0o600});
    const {HarnessCliSessionManager}=await import("../src/server/canvas-agent/harness-cli-sessions.mjs"),manager=new HarnessCliSessionManager({env:{...process.env,CODEX_HOME:auth}});
    t.after(async()=>{await manager.dispose();fs.rmSync(root,{recursive:true,force:true});});
    const base={connection:connection(provider),harnessSessionId:`harness-${provider}`,systemPrompt:"strict harness system",signal:signal()},
      first=await manager.request({...base,fullPrompt:"snapshot-one",deltaPrompt:"unused"}),
      second=await manager.request({...base,fullPrompt:"unused",deltaPrompt:"delta-two",replay:first.replayState.response}),
      firstDecision=JSON.parse(first.output),secondDecision=JSON.parse(second.output),firstIdentity=firstDecision.text.split(":"),secondIdentity=secondDecision.text.split(":");
    assert.equal(firstIdentity[0],provider.replace("-cli",""));
    assert.equal(firstIdentity[1],secondIdentity[1],"both steps must be served by the same OS process");
    assert.equal(firstIdentity[2],"1");
    assert.equal(secondIdentity[2],"2");
    assert.equal(first.replayState.response.providerConversationId,second.replayState.response.providerConversationId);
  });

  test(`Harness ${provider} transport rejects provider-side tool activity`,async t=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),`penecho-harness-tool-${provider}-test-`)),auth=path.join(root,"codex-home");
    fs.mkdirSync(auth,{recursive:true});
    fs.writeFileSync(path.join(auth,"auth.json"),"{}",{mode:0o600});
    const {HarnessCliSessionManager}=await import("../src/server/canvas-agent/harness-cli-sessions.mjs"),manager=new HarnessCliSessionManager({env:{...process.env,CODEX_HOME:auth}});
    t.after(async()=>{await manager.dispose();fs.rmSync(root,{recursive:true,force:true});});
    await assert.rejects(manager.request({
      connection:connection(provider,`tool-${provider}`),harnessSessionId:`harness-tool-${provider}`,systemPrompt:"strict harness system",
      fullPrompt:"attempt-disabled-tool",deltaPrompt:"unused",signal:signal(),
    }),/disabled|tool use/);
    assert.equal(manager.sessions.size,0);
  });
}

test("Harness persistent CLI implementation stays outside legacy Canvas AI provider paths",async()=>{
  const main=fs.readFileSync(path.join(ROOT,"src","server","main.js"),"utf8"),
    adapter=fs.readFileSync(path.join(ROOT,"src","server","canvas-agent","cli-adapter.mjs"),"utf8"),
    runtime=fs.readFileSync(path.join(ROOT,"src","server","canvas-agent","runtime.mjs"),"utf8"),
    providers=["codex-cli.js","claude-cli.js","kimi-cli.js"].map(file=>fs.readFileSync(path.join(ROOT,"src","providers",file),"utf8"));
  assert.match(adapter,/HarnessCliSessionManager/);
  assert.match(main,/callCodexCli/);
  assert.match(main,/callClaudeCli/);
  assert.match(main,/callKimiCli/);
  assert.doesNotMatch(main,/harness-cli-sessions/);
  assert.match(runtime,/cliAdapter\?\.disposeSession\(String\(session\.handle\?\.agent\?\.id/);
  for(const source of providers)assert.doesNotMatch(source,/HarnessCliSessionManager|harness-cli-sessions/);
});
