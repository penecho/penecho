"use strict";
require("./helpers/safety.js");

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname,"..");
const read = file => fs.readFileSync(path.join(ROOT,file),"utf8");
const functionSource = (source,name) => {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start,-1,`missing function ${name}`);
  const body = source.indexOf("{",start);
  let depth = 0;
  for (let index = body; index < source.length; index++) {
    if (source[index] === "{") depth++;
    else if (source[index] === "}" && --depth === 0) return source.slice(start,index + 1);
  }
  assert.fail(`unterminated function ${name}`);
};

const source = read("src/client/app/canvas-agent-runtime.js");
const coreSource = read("src/client/app/core.js");
const zhSource = read("public/locales/zh.js");

function availabilityFunctions(context) {
  return vm.runInNewContext(`(()=>{
    ${functionSource(source,"canvasAgentAvailable")}
    ${functionSource(source,"canvasAgentExecutionAvailable")}
    return {available:canvasAgentAvailable,execution:canvasAgentExecutionAvailable};
  })()`,context);
}

function localized(key) {
  return {
    canvasAgentNoConnections: "No available connections",
    canvasAgentChooseConnection: "Choose AI connection",
    canvasAgentChooseModel: "Choose model",
    canvasAgentNewCanvasStatus: "New conversation · this canvas",
  }[key] || key;
}

function button() {
  return {
    disabled:false,
    attributes:{},
    setAttribute(name,value){this.attributes[name]=String(value);},
    removeAttribute(name){delete this.attributes[name];},
  };
}

test("Cloud hosted connections execute without a device only when the hosted Agent capability is enabled",()=>{
  let selected="hosted:db6e5128-0ec7-4a2a-a9bd-6b20c49c322b";
  const context={window:{PENECHO_CONFIG:{runtime:"cloud",canvasAgent:false,browserCanvasEditing:true,hostedCanvasAgent:true}},
    location:{pathname:"/canvas/5250fdb4-3cce-44fd-a60c-3b6ee5732ad0",protocol:"https:",host:"uat.example.test"},
    state:{currentSnapshotLocation:"cloud",currentSnapshotId:"5250fdb4-3cce-44fd-a60c-3b6ee5732ad0"},
    selectedAiConnectionId:()=>selected};
  const run=vm.runInNewContext(`(()=>{
    ${functionSource(source,"canvasAgentCloudSavedCanvasId")}
    ${functionSource(source,"canvasAgentCloudCanvasId")}
    ${functionSource(source,"canvasAgentUsesCloudHost")}
    ${functionSource(source,"canvasAgentExecutionAvailable")}
    ${functionSource(source,"canvasAgentSocketUrl")}
    return {available:canvasAgentExecutionAvailable,url:canvasAgentSocketUrl};
  })()`,context);
  assert.equal(run.available(),true);
  assert.equal(run.url(),"wss://uat.example.test/api/v1/hosted/canvases/5250fdb4-3cce-44fd-a60c-3b6ee5732ad0/agent");
  selected="default";
  assert.equal(run.available(),false,"offline device connections remain unavailable");
  assert.equal(run.url(),"wss://uat.example.test/api/v1/remote-canvas/canvas-agent");
  selected="hosted:db6e5128-0ec7-4a2a-a9bd-6b20c49c322b";
  context.window.PENECHO_CONFIG.hostedCanvasAgent=false;
  assert.equal(run.available(),false,"a listed model cannot advertise a missing execution backend");
  context.window.PENECHO_CONFIG={runtime:"viewer",canvasAgent:false,hostedCanvasAgent:true};
  assert.equal(run.available(),false);
});

test("Hosted model labels identify Cloud and round display multipliers without changing billing values",()=>{
  const run=vm.runInNewContext(`(()=>{
    ${functionSource(coreSource,"hostedMultiplierLabel")}
    ${functionSource(coreSource,"connectionTitle")}
    return {label:connectionTitle,multiplier:hostedMultiplierLabel};
  })()`,{t:localized});
  assert.equal(run.label({hosted:true,provider:"api",apiModel:"glm-5.3-flash"}),"☁️ glm-5.3-flash");
  assert.equal(run.label({provider:"api",apiModel:"Local model"}),"Local model");
  assert.equal(run.multiplier(1.3538),"1.4×");
  assert.equal(run.multiplier(1),"1×");
  assert.equal(run.multiplier(1.25),"1.3×");
});

test("Canvas Agent connect rejects unavailable execution before capabilities or WebSocket creation",async()=>{
  const calls={websocket:0},context={
    window:{PENECHO_CONFIG:{runtime:"cloud",canvasAgent:false,browserCanvasEditing:true}},
    canvasAgentReconcileCloudCanvas:()=>{},canvasAgentCloudCanvasId:()=>"",
    canvasAgentCurrentWidgetCapabilities:async()=>{calls.capabilities=(calls.capabilities||0)+1;return {};},
    canvasAgentSetStatus:()=>{},canvasAgentExecutionAvailable:null,
    t:localized,
    WebSocket:function(){calls.websocket++;},
  },connect=vm.runInNewContext(`(()=>{
    ${functionSource(source,"canvasAgentExecutionAvailable")}
    ${functionSource(source,"canvasAgentConnect").replace(/^function /,"async function ")}
    return canvasAgentConnect;
  })()`,context);
  await assert.rejects(connect(),error=>error?.code==="CANVAS_AGENT_NO_CONNECTION");
  assert.deepEqual(calls,{websocket:0});
});

test("Canvas Agent connect rechecks execution after asynchronous capabilities and avoids creating a stale WebSocket",async()=>{
  const calls={capabilities:0,websocket:0},FakeWebSocket=function(){calls.websocket++};
  FakeWebSocket.OPEN=1;
  const context={
    window:{PENECHO_CONFIG:{runtime:"cloud",canvasAgent:true,browserCanvasEditing:false}},
    canvasAgent:{socket:null,connectPromise:null},
    canvasAgentReconcileCloudCanvas:()=>{},canvasAgentCloudCanvasId:()=>"",
    canvasAgentCurrentWidgetCapabilities:async()=>{
      calls.capabilities++;
      await Promise.resolve();
      context.window.PENECHO_CONFIG.canvasAgent=false;
      return {};
    },
    canvasAgentSetStatus:()=>{},selectedAiConnectionId:()=>"connection",
    canvasAgentExecutionAvailable:null,t:localized,WebSocket:FakeWebSocket,
  },connect=vm.runInNewContext(`(()=>{
    ${functionSource(source,"canvasAgentExecutionAvailable")}
    ${functionSource(source,"canvasAgentConnect").replace(/^function /,"async function ")}
    return canvasAgentConnect;
  })()`,context);
  await assert.rejects(connect(),error=>error?.code==="CANVAS_AGENT_NO_CONNECTION");
  assert.deepEqual(calls,{capabilities:1,websocket:0});
});

test("the engine's status stays unavailable when the language changes",()=>{
  const said=[],context={
    window:{PENECHO_CONFIG:{runtime:"cloud",canvasAgent:false,browserCanvasEditing:true}},
    canvasAgent:{running:false,statusKind:"connecting",statusText:"",lastTurnError:null},t:localized,
    canvasAgentTell:type=>said.push(type),canvasAgentErrorSummary:()=>"",
  },run=vm.runInNewContext(`(()=>{
    ${functionSource(source,"canvasAgentExecutionAvailable")}
    ${functionSource(source,"canvasAgentUnavailableMessage")}
    ${functionSource(source,"canvasAgentSetStatus")}
    ${functionSource(source,"updateCanvasAgentLanguage")}
    return updateCanvasAgentLanguage;
  })()`,context);
  run();
  assert.equal(context.canvasAgent.statusText,"No available connections");
  assert.equal(context.canvasAgent.statusKind,"unavailable","a language change does not bring back ready or connecting");
  assert.deepEqual(said,["state"]);
});

test("an engine with no connection refuses a request without starting one",async()=>{
  const conversation={id:"conversation-before"},counts={begin:0,submit:0,connect:0,search:0,request:0,network:0},status=[];
  const context={
    window:{PENECHO_CONFIG:{runtime:"cloud",canvasAgent:false,browserCanvasEditing:true}},
    requireAiConnectionSelection:()=>true,canvasAgent:{currentConversation:conversation},
    canvasAgentSetStatus:(text,kind)=>status.push({text,kind}),
    canvasAgentBeginRequest:()=>counts.begin++,canvasAgentBeginSubmitExecution:()=>{counts.submit++;},
    canvasAgentConnect:async()=>{counts.connect++;},canvasAgentEnsureSearchSession:async()=>{counts.search++;},canvasAgentSendRequest:()=>counts.request++,
    fetch:()=>{counts.network++;throw Error("network must not be called");},t:localized,
  },submit=vm.runInNewContext(`(()=>{
    ${functionSource(source,"canvasAgentExecutionAvailable")}
    ${functionSource(source,"canvasAgentSubmitMessage").replace(/^function /,"async function ")}
    return canvasAgentSubmitMessage;
  })()`,context);
  assert.equal(await submit({textOverride:"What is this?"}),false);
  assert.deepEqual(counts,{begin:0,submit:0,connect:0,search:0,request:0,network:0});
  assert.equal(context.canvasAgent.currentConversation,conversation);
  assert.deepEqual(status,[{text:"No available connections",kind:"unavailable"}]);
  assert.equal(await submit({textOverride:"   "}),false,"nothing to ask is not a request");
  assert.equal(await submit(),false);
  assert.equal(status.length,1);
});
