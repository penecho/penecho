"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), vm = require("node:vm"), fs = require("node:fs"), path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../src/client/app/canvas-agent-runtime.js"), "utf8");
function functionSource(name) {
  const sync = source.indexOf(`  function ${name}(`), async = source.indexOf(`  async function ${name}(`), start = sync < 0 ? async : sync;
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf("\n  }", start) + 4);
}
function fixture({ ready = true, running = false, requestPending = false, matching = false } = {}) {
  const calls = { projects:0, sockets:0, transitions:0, handshakes:[], envelopes:[] };
  const oldSocket = { readyState:1, closes:0, close() { this.closes++; } };
  const agent = { socket:oldSocket, sessionId:"saved-session", sessionReady:ready, connectionId:"connection", connectPromise:null,
    sessionSearchEnabled:matching, searchEnabled:true, sessionProjectId:"", sessionAccessMode:"controlled", running, requestPending,
    currentConversation:{ id:"conversation" } };
  class FakeWebSocket {
    static OPEN = 1;
    constructor() { calls.sockets++; this.readyState = 1; }
    addEventListener(name, callback) { if (name === "open") callback(); }
    close() {}
  }
  const context = vm.createContext({ canvasAgent:agent, WebSocket:FakeWebSocket, window:{ PENECHO_CONFIG:{} },
    canvasAgentReconcileCloudCanvas() {}, canvasAgentCloudCanvasId:()=>"", canvasAgentExecutionAvailable:()=>true,
    canvasAgentEnsureProjects:async()=>{
      // Stop a real recursive connect loop without starving the test runner.
      if (++calls.projects > 25) throw Error("Connect kept retrying without waiting for an external state change");
    },
    selectedAiConnectionId:()=>"connection", canvasAgentUsesCloudHost:()=>false, canvasAgentSetStatus() {}, t:key=>key,
    canvasAgentCurrentWidgetCapabilities:async()=>({}), canvasAgentInvalidateSubmitExecution() {}, canvasAgentAssertSubmitExecution() {},
    canvasAgentContextProjectId:()=>"", canvasAgentEffectiveAccessMode:()=>"controlled", canvasAgentConnectionProvider:()=>"test",
    canvasAgentBeginSessionTransition() { calls.transitions++; agent.sessionReady = false; }, canvasClientId:()=>"handshake",
    canvasAgentContinuationHistory:()=>[], canvasAgentCloudSavedCanvasId:()=>"", canvasAgentSocketUrl:()=>"ws://local.test/agent",
    canvasAgentSendEnvelope:(type, payload)=>calls.envelopes.push({type,payload}),
    canvasAgentWaitForReady:async start=>{
      calls.handshakes.push("start");start();
      agent.sessionReady = true;agent.sessionSearchEnabled = agent.searchEnabled;
      agent.sessionProjectId = "";agent.sessionAccessMode = "controlled";
    },
  });
  for (const name of ["canvasAgentSessionContextMatches", "canvasAgentChangeContext", "canvasAgentConnect"]) vm.runInContext(functionSource(name), context);
  return { context, agent, calls, oldSocket, connect:options=>context.canvasAgentConnect(options) };
}
test("opening Agent while a running turn defers changed context returns without a microtask loop", async()=>{
  for (const flags of [{running:true}, {requestPending:true}]) {
    const f = fixture(flags);
    await f.connect();
    assert.equal(f.calls.projects, 1);
    assert.equal(f.agent.pendingContextChange.force, false);
    assert.equal(f.calls.handshakes.length, 0);
    assert.equal(f.agent.socket, f.oldSocket);
  }
});
test("an open socket with an unready saved session starts one handshake instead of mutual recursion", async()=>{
  const f = fixture({ready:false});
  await f.connect();
  assert.equal(f.calls.projects, 2, "one attempt and one check after the completed handshake");
  assert.equal(f.calls.sockets, 1);
  assert.equal(f.calls.handshakes.length, 1);
  assert.equal(f.calls.envelopes[0].type, "hello");
  assert.equal(f.oldSocket.closes, 1);
  assert.equal(f.agent.sessionReady, true);
});
test("an unready socket waits for an existing handshake before considering reconnection", async()=>{
  const f = fixture({ready:false});
  let resolve;
  f.agent.connectPromise = new Promise(done=>{resolve=done;});
  const connecting = f.connect();
  await Promise.resolve();await Promise.resolve();
  assert.equal(f.calls.sockets, 0);
  assert.equal(f.calls.handshakes.length, 0);
  f.agent.sessionReady=true;f.agent.sessionSearchEnabled=true;f.agent.connectPromise=null;resolve();
  await connecting;
  assert.equal(f.calls.sockets, 0);
});
test("idle context changes complete one handshake and a matching ready session does no handshake", async()=>{
  const f = fixture();
  await f.connect();
  assert.equal(f.calls.sockets, 0);
  assert.equal(f.calls.handshakes.length, 1);
  assert.equal(f.calls.envelopes[0].type, "change_context");
  await f.connect();
  assert.equal(f.calls.handshakes.length, 1);
});
test("an explicit submission can complete a context handshake while the turn is running", async()=>{
  const f = fixture({running:true});
  await f.connect({submitExecution:{}});
  assert.equal(f.calls.handshakes.length, 1);
  assert.equal(f.calls.envelopes[0].type, "change_context");
  assert.equal(f.agent.pendingContextChange, null);
});
test("a failed existing handshake rejects once without opening a replacement or spinning", async()=>{
  const f = fixture({ready:false}), error = Error("Handshake failed");
  f.agent.connectPromise = Promise.reject(error);
  await assert.rejects(f.connect(), failure=>failure === error);
  assert.equal(f.calls.projects, 1);
  assert.equal(f.calls.sockets, 0);
});
