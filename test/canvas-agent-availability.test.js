"use strict";

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

test("Canvas Agent availability separates browser-only UI from executable connections",()=>{
  const context={window:{PENECHO_CONFIG:{runtime:"local"}}},functions=availabilityFunctions(context),cases=[
    [{runtime:"local",canvasAgent:true,browserCanvasEditing:false},true,true],
    [{runtime:"cloud",canvasAgent:true,browserCanvasEditing:false},true,true],
    [{runtime:"cloud",canvasAgent:false,browserCanvasEditing:true},true,false],
    [{runtime:"cloud",canvasAgent:false,browserCanvasEditing:false},false,false],
    [{runtime:"viewer",canvasAgent:true,browserCanvasEditing:true},false,false],
    [{runtime:"local",canvasAgent:undefined,browserCanvasEditing:false},true,true],
  ];
  for (const [config,expectedUi,expectedExecution] of cases) {
    context.window.PENECHO_CONFIG=config;
    assert.equal(functions.available(),expectedUi,`UI availability for ${JSON.stringify(config)}`);
    assert.equal(functions.execution(),expectedExecution,`execution availability for ${JSON.stringify(config)}`);
  }
});

test("Canvas Agent browser-only mode keeps the panel launcher but disables sending with status linkage",()=>{
  const send=button(),input={disabled:false},context={
    window:{PENECHO_CONFIG:{runtime:"cloud",canvasAgent:false,browserCanvasEditing:true}},
    canvasAgentSend:send,canvasAgentInput:input,canvasAgent:{attachmentBusy:false,projectUploadBusy:false},
  },sync=vm.runInNewContext(`(()=>{
    ${functionSource(source,"canvasAgentExecutionAvailable")}
    ${functionSource(source,"canvasAgentSyncSendAvailability")}
    return canvasAgentSyncSendAvailability;
  })()`,context);
  sync();
  assert.equal(send.disabled,true);
  assert.equal(send.attributes["aria-describedby"],"canvasAgentStatus");

  context.window.PENECHO_CONFIG={runtime:"local",canvasAgent:true};
  sync();
  assert.equal(send.disabled,false);
  assert.equal(send.attributes["aria-describedby"],undefined);

  for (const state of [
    {inputDisabled:true,attachmentBusy:false,projectUploadBusy:false},
    {inputDisabled:false,attachmentBusy:true,projectUploadBusy:false},
    {inputDisabled:false,attachmentBusy:false,projectUploadBusy:true},
  ]) {
    input.disabled=state.inputDisabled;
    context.canvasAgent.attachmentBusy=state.attachmentBusy;
    context.canvasAgent.projectUploadBusy=state.projectUploadBusy;
    sync();
    assert.equal(send.disabled,true,JSON.stringify(state));
    assert.equal(send.attributes["aria-describedby"],undefined,"busy/input-disabled states do not mislabel an executable connection as unavailable");
  }
});

test("Canvas Agent attachment sync restores sending after project upload and keeps browser-only sending disabled",()=>{
  const attach=button(),send=button(),input={disabled:false},context={
    window:{PENECHO_CONFIG:{runtime:"local",canvasAgent:true}},
    canvasAgentUsesCloudHost:()=>false,t:localized,canvasAgentFileInput:{accept:""},
    canvasAgentAttach:attach,canvasAgentSend:send,canvasAgentInput:input,
    canvasAgent:{attachmentBusy:false,projectUploadBusy:true},canvasAgentSyncPromptSuggestions() {},
  },sync=vm.runInNewContext(`(()=>{
    ${functionSource(source,"canvasAgentExecutionAvailable")}
    ${functionSource(source,"canvasAgentSyncSendAvailability")}
    ${functionSource(source,"canvasAgentSyncAttachmentButton")}
    return canvasAgentSyncAttachmentButton;
  })()`,context);
  sync();
  assert.equal(attach.disabled,true);
  assert.equal(send.disabled,true,"project upload keeps Send disabled while busy");

  context.canvasAgent.projectUploadBusy=false;
  sync();
  assert.equal(attach.disabled,false);
  assert.equal(send.disabled,false,"ending project upload restores Send for an executable connection");

  context.window.PENECHO_CONFIG={runtime:"cloud",canvasAgent:false,browserCanvasEditing:true};
  sync();
  assert.equal(attach.disabled,false);
  assert.equal(send.disabled,true,"browser-only editing remains send-disabled after upload completion");
  assert.equal(send.attributes["aria-describedby"],"canvasAgentStatus");
});

test("Canvas Agent unavailable status and connection label remain unavailable across refreshes",()=>{
  assert.match(coreSource,/canvasAgentNoConnections:\s*"No available connections"/);
  assert.match(zhSource,/canvasAgentNoConnections:\s*"无可用的连接"/);
  const status={textContent:"",},panel={dataset:{status:"ready"}},label={textContent:""},connection=button(),context={
    window:{PENECHO_CONFIG:{runtime:"cloud",canvasAgent:false,browserCanvasEditing:true}},
    canvasAgentStatus:status,canvasAgentPanel:panel,canvasAgentConnectionButton:connection,canvasAgentConnectionLabel:label,
    allAiConnections:()=>[{id:"saved",provider:"api",name:"Saved API"}],selectedAiConnectionId:()=>"saved",connectionTitle:item=>item.name,
    t:localized,canvasAgentSyncSendAvailability(){},
  },run=vm.runInNewContext(`(()=>{
    ${functionSource(source,"canvasAgentExecutionAvailable")}
    ${functionSource(source,"canvasAgentUnavailableMessage")}
    ${functionSource(source,"canvasAgentSetStatus")}
    ${functionSource(source,"canvasAgentUpdateConnectionButton")}
    return {setStatus:canvasAgentSetStatus,updateConnectionButton:canvasAgentUpdateConnectionButton};
  })()`,context);
  run.setStatus("Ready", "ready");
  assert.equal(status.textContent,"No available connections");
  assert.equal(panel.dataset.status,"unavailable");
  run.updateConnectionButton();
  assert.equal(label.textContent,"No available connections");
  assert.match(connection.attributes["aria-label"],/Choose AI connection: No available connections/);

  context.window.PENECHO_CONFIG={runtime:"local",canvasAgent:true};
  run.setStatus("Connecting…", "connecting");
  assert.equal(status.textContent,"Connecting…");
  assert.equal(panel.dataset.status,"connecting");
  run.updateConnectionButton();
  assert.equal(label.textContent,"Saved API");
});

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

test("Canvas Agent capabilities refresh preserves the browser-only panel and synchronizes unavailable controls",()=>{
  const calls={close:0,hostedModels:0,connection:0,send:0,assistant:0,status:[]},toggle={hidden:false},panel={hidden:false},context={
    settings:{connectionScope:""},aiConnectionScope:()=>"",renderConnectionLists:()=>{},
    window:{PENECHO_CONFIG:{runtime:"cloud",canvasAgent:false,browserCanvasEditing:true}},
    canvasAgentToggle:toggle,canvasAgentPanel:panel,
    canvasAgentAvailable:null,canvasAgentExecutionAvailable:null,
    closeCanvasAgent:()=>calls.close++,renderHostedModels:()=>calls.hostedModels++,canvasAgentUpdateConnectionButton:()=>calls.connection++,
    canvasAgentSyncSendAvailability:()=>calls.send++,canvasAgentSyncAssistantActions:()=>calls.assistant++,
    canvasAgentSetStatus:(text,kind)=>calls.status.push({text,kind}),t:localized,
    document:{querySelector:()=>null},
  };
  const run=vm.runInNewContext(`(()=>{
    ${functionSource(source,"canvasAgentAvailable")}
    ${functionSource(source,"canvasAgentExecutionAvailable")}
    ${functionSource(source,"canvasAgentSyncRuntimeAvailability")}
    return canvasAgentSyncRuntimeAvailability;
  })()`,context);
  run();
  assert.equal(toggle.hidden,false,"browser-only editing keeps the launcher visible");
  assert.equal(panel.hidden,false,"capability refresh must not close a browser-only panel");
  assert.equal(calls.close,0);
  assert.equal(calls.hostedModels,1);
  assert.equal(calls.connection,1);
  assert.equal(calls.send,1);
  assert.equal(calls.assistant,1);
  assert.deepEqual(calls.status,[{text:"No available connections",kind:"unavailable"}]);
});

test("Canvas Agent language refresh keeps unavailable status instead of restoring ready or connecting",()=>{
  let inputResizeCalls=0;
  const names=[
    "canvasAgentSend","canvasAgentStop","canvasAgentInput","canvasAgentInputHint","canvasAgentInkCanvas","canvasAgentClearInkButton","canvasAgentTextMode","canvasAgentInkMode",
    "canvasAgentReference","canvasAgentReferencePicker","canvasAgentReferenceHelp","canvasAgentReferenceSearch","canvasAgentReferenceCollapse","canvasAgentSelection",
    "canvasAgentHead","canvasAgentResizeTop","canvasAgentResizeBottom","canvasAgentResizeLeft","canvasAgentResizeRight","canvasAgentAttach","canvasAgentAttachments",
    "canvasAgentProjectButton","canvasAgentProjectClose","canvasAgentProjectRootBack","canvasAgentProjectRootSelect","canvasAgentProjectRootTruncated","canvasAgentProjectRootApproval",
    "canvasAgentProjectRootApprovalReject","canvasAgentProjectRootApprovalAllow","canvasAgentProjectRootApprovalDetail","canvasAgentProjectRemoveTitle","canvasAgentProjectRemoveCancel",
    "canvasAgentProjectRemoveConfirm","canvasAgentProjectRemoveDescription","canvasAgentApproval","canvasAgentTranscript","canvasAgentStatus","canvasAgentPanel",
  ];
  const element=()=>({textContent:"",hidden:true,value:"",dataset:{status:"connecting"},classList:{contains:()=>false},setAttribute(){},querySelector:()=>({textContent:""}),querySelectorAll:()=>[]});
  const context={window:{PENECHO_CONFIG:{runtime:"cloud",canvasAgent:false,browserCanvasEditing:true}},canvasAgent:{running:false,projectRootApproval:null,projectRemovePending:null,toolRows:new Map(),lastTurnError:null},t:localized,
    canvasAgentSetComposerActionLabel(){},canvasAgentRenderPromptSuggestions(){},canvasAgentUpdateSearchButton(){},canvasAgentUpdateConnectionButton(){},canvasAgentRenderToolRow(){},canvasAgentBlockLabel:key=>key,
    canvasAgentSetAssistantCopyState(){},canvasAgentRenderErrorElement(){},canvasAgentSyncSelection(){},canvasAgentRenderReferencePicker(){},canvasAgentRenderHistoryList(){},canvasAgentRenderProjects(){},canvasAgentRenderEmpty(){},
    canvasAgentSyncInputHint(){},canvasAgentSyncPromptSuggestions(){},canvasAgentSyncSendAvailability(){},canvasAgentResizeInput(){inputResizeCalls++;},
  };
  for (const name of names) context[name]=element();
  context.canvasAgentTranscript.querySelectorAll=()=>[];
  context.canvasAgentReferencePicker.hidden=true;
  const run=vm.runInNewContext(`(()=>{
    ${functionSource(source,"canvasAgentExecutionAvailable")}
    ${functionSource(source,"canvasAgentUnavailableMessage")}
    ${functionSource(source,"canvasAgentSetStatus")}
    ${functionSource(source,"updateCanvasAgentLanguage")}
    return updateCanvasAgentLanguage;
  })()`,context);
  run();
  assert.equal(context.canvasAgentStatus.textContent,"No available connections");
  assert.equal(context.canvasAgentPanel.dataset.status,"unavailable");
  assert.equal(inputResizeCalls,1,"language changes recalculate the composer height");
});

test("Canvas Agent connect rejects unavailable execution before project loading, capabilities, or WebSocket creation",async()=>{
  const calls={projects:0,websocket:0},context={
    window:{PENECHO_CONFIG:{runtime:"cloud",canvasAgent:false,browserCanvasEditing:true}},
    canvasAgentReconcileCloudCanvas:()=>{},canvasAgentCloudCanvasId:()=>"",
    canvasAgentEnsureProjects:async()=>{calls.projects++},canvasAgentCurrentWidgetCapabilities:async()=>{calls.capabilities=(calls.capabilities||0)+1;return {};},
    canvasAgentSetStatus:()=>{},canvasAgentExecutionAvailable:null,
    t:localized,
    WebSocket:function(){calls.websocket++;},
  },connect=vm.runInNewContext(`(()=>{
    ${functionSource(source,"canvasAgentExecutionAvailable")}
    ${functionSource(source,"canvasAgentConnect").replace(/^function /,"async function ")}
    return canvasAgentConnect;
  })()`,context);
  await assert.rejects(connect(),error=>error?.code==="CANVAS_AGENT_NO_CONNECTION");
  assert.deepEqual(calls,{projects:0,websocket:0});
});

test("Canvas Agent connect rechecks execution after asynchronous capabilities and avoids creating a stale WebSocket",async()=>{
  const calls={projects:0,capabilities:0,websocket:0},FakeWebSocket=function(){calls.websocket++};
  FakeWebSocket.OPEN=1;
  const context={
    window:{PENECHO_CONFIG:{runtime:"cloud",canvasAgent:true,browserCanvasEditing:false}},
    canvasAgent:{socket:null,connectPromise:null},
    canvasAgentReconcileCloudCanvas:()=>{},canvasAgentCloudCanvasId:()=>"",
    canvasAgentEnsureProjects:async()=>{calls.projects++},
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
  assert.deepEqual(calls,{projects:1,capabilities:1,websocket:0});
});

test("Canvas Agent unavailable submission returns false without consuming the draft or creating a request",async()=>{
  const send=button(),input={disabled:false,value:"keep this draft"},conversation={id:"conversation-before"},counts={begin:0,submit:0,conversation:0,connect:0,search:0,request:0,network:0},status=[];
  const context={
    window:{PENECHO_CONFIG:{runtime:"cloud",canvasAgent:false,browserCanvasEditing:true}},
    canvasAgentSend:send,canvasAgentInput:input,canvasAgent:{attachmentBusy:false,projectUploadBusy:false,attachments:[{id:"draft-image"}],inkPresent:true,currentConversation:conversation},
    canvasAgentSetStatus:(text,kind)=>status.push({text,kind}),canvasAgentSyncSendAvailability:null,
    canvasAgentBeginRequest:()=>counts.begin++,canvasAgentBeginSubmitExecution:()=>{counts.submit++;},canvasAgentDidStartUserConversation:()=>{counts.conversation++;},
    canvasAgentConnect:async()=>{counts.connect++;},canvasAgentEnsureSearchSession:async()=>{counts.search++;},canvasAgentSendRequest:()=>counts.request++,
    fetch:()=>{counts.network++;throw Error("network must not be called");},t:localized,
  },submit=vm.runInNewContext(`(()=>{
    ${functionSource(source,"canvasAgentExecutionAvailable")}
    ${functionSource(source,"canvasAgentSyncSendAvailability")}
    ${functionSource(source,"canvasAgentSubmitMessage").replace(/^function /,"async function ")}
    return canvasAgentSubmitMessage;
  })()`,context);
  assert.equal(await submit(),false);
  assert.equal(input.value,"keep this draft");
  assert.deepEqual(counts,{begin:0,submit:0,conversation:0,connect:0,search:0,request:0,network:0});
  assert.deepEqual(context.canvasAgent.attachments,[{id:"draft-image"}]);
  assert.equal(context.canvasAgent.inkPresent,true);
  assert.equal(context.canvasAgent.currentConversation,conversation);
  assert.deepEqual(status,[{text:"No available connections",kind:"unavailable"}]);
  assert.equal(send.disabled,true);
  assert.equal(send.attributes["aria-describedby"],"canvasAgentStatus");
});

test("Canvas Agent retry is disabled when the UI remains available but execution has no connection",()=>{
  const context={
    window:{PENECHO_CONFIG:{runtime:"cloud",canvasAgent:false,browserCanvasEditing:true}},
    canvasAgent:{running:false,requestPending:false,attachmentBusy:false,projectUploadBusy:false,pendingApproval:false},
    canvasAgentInput:{disabled:false},canvasAgentCanShowRetryTarget:()=>true,
  },retry=vm.runInNewContext(`(()=>{
    ${functionSource(source,"canvasAgentExecutionAvailable")}
    ${functionSource(source,"canvasAgentCanRetryTarget")}
    return canvasAgentCanRetryTarget;
  })()`,context);
  assert.equal(retry({historyItem:{}}),false);
  context.window.PENECHO_CONFIG={runtime:"local",canvasAgent:true};
  assert.equal(retry({historyItem:{}}),true);
});
