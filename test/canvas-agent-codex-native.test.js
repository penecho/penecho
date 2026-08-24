"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const waitFor = async (predicate, timeoutMs = 2000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail("Timed out waiting for Codex Native Canvas Agent test state.");
};

class FakeCodexAppServer {
  constructor(options) {
    this.options = options;
    this.threadId = "thread-1";
    this.alive = false;
    this.closedCount = 0;
    this.requests = [];
    this.clientNotifications = [];
    this.responses = [];
    this.responseErrors = [];
    this.pendingServerRequests = new Map();
    this.pendingClientRequests = [];
    this.requestHandler = async (method, params) => {
      if (method === "initialize") return {};
      if (method === "thread/start") return { thread:{ id:this.threadId, ephemeral:true } };
      if (method === "turn/start") return { turn:{ id:`turn-${this.requests.filter(request => request.method === "turn/start").length}` } };
      return {};
    };
  }

  async start(threadOptions) {
    await this.request("initialize", { clientInfo:{ name:"penecho-canvas-agent" }, capabilities:{ experimentalApi:false } });
    this.notify("initialized", {});
    const result = await this.request("thread/start", {
      ...threadOptions,
      approvalPolicy:"never",
      sandbox:"read-only",
      runtimeWorkspaceRoots:[],
      ephemeral:true,
    });
    this.alive = true;
    return result.thread.id;
  }

  request(method, params) {
    this.requests.push({ method, params });
    return new Promise((resolve, reject) => {
      const pending = { method, params, resolve, reject };
      this.pendingClientRequests.push(pending);
      Promise.resolve(this.requestHandler(method, params)).then(
        value => {
          this.pendingClientRequests.splice(this.pendingClientRequests.indexOf(pending), 1);
          resolve(value);
        },
        error => {
          this.pendingClientRequests.splice(this.pendingClientRequests.indexOf(pending), 1);
          reject(error);
        },
      );
    });
  }

  notify(method, params) {
    this.clientNotifications.push({ method, params });
  }

  emitNotification(method, params) {
    this.options.onNotification(method, params);
  }

  serverRequest(method, params) {
    const id = `server-${this.pendingServerRequests.size + 1}`;
    this.pendingServerRequests.set(id, { method, params });
    return new Promise(resolve => {
      this.pendingServerRequests.get(id).resolve = resolve;
      Promise.resolve(this.options.onRequest(id, method, params)).then(
        result => this.respond(id, result),
        error => this.respondError(id, error),
      );
    });
  }

  respond(id, result) {
    this.responses.push({ id, result });
    this.pendingServerRequests.get(id)?.resolve(result);
    this.pendingServerRequests.delete(id);
  }

  respondError(id, error) {
    this.responseErrors.push({ id, error });
    this.pendingServerRequests.get(id)?.resolve({ error });
    this.pendingServerRequests.delete(id);
  }

  async interrupt(threadId, turnId) {
    this.requests.push({ method:"turn/interrupt", params:{ threadId, turnId } });
  }

  async close() {
    this.closedCount += 1;
    this.alive = false;
    const pending = this.pendingClientRequests.splice(0);
    for (const request of pending) request.reject(new Error("fake Codex app-server closed."));
  }

  gone(error = new Error("fake Codex process exited.")) {
    this.alive = false;
    const pending = this.pendingClientRequests.splice(0);
    for (const request of pending) request.reject(error);
    this.options.onGone(error);
  }
}

async function createNativeHarness(overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-codex-native-test-"));
  const processes = [];
  const logs = [];
  const messages = [];
  const { CodexNativeHost } = await import("../src/server/canvas-agent/codex-native-host.mjs");
  const connection = overrides.connection || { id:"codex-native", provider:"codex-cli", name:"Codex", cliPath:"codex-not-launched", cliModel:"codex-model", effort:"medium" };
  const host = new CodexNativeHost({
    stateDirectory:path.join(directory, "state"),
    rootDirectory:ROOT,
    resolveConnection:id => id === connection.id ? connection : null,
    resolveWebSearch:() => ({ apiKey:"" }),
    resolveWidgetCapabilities:() => ({ professionalEnabled:false, privatePlugins:[] }),
    resolveProject:async () => null,
    modelTimeoutMs:() => overrides.timeoutMs || 5000,
    logger:event => logs.push(event),
    createAppServer:options => {
      const process = new FakeCodexAppServer(options);
      processes.push(process);
      return process;
    },
    ...(overrides.sessionTtlMs ? { sessionTtlMs:overrides.sessionTtlMs } : {}),
  });
  return {
    directory,
    processes,
    logs,
    messages,
    host,
    connection,
    async connect() {
      const session = await host.connect({
        clientId:"native-test-client",
        connectionId:connection.id,
        binding:{ name:"test" },
        send:(type, payload, identity) => messages.push({ type, payload, identity }),
      });
      return session;
    },
    cleanup:async () => {
      await host.dispose().catch(() => {});
      fs.rmSync(directory, { recursive:true, force:true });
    },
  };
}

test("Codex Native starts one strict app-server thread and reuses it for later turns", async t => {
  const harness = await createNativeHarness();
  t.after(() => harness.cleanup());
  const session = await harness.connect();
  const process = harness.processes[0];
  const traceEvents = [];
  harness.host.conversationTrace = event => traceEvents.push(event);
  assert.equal(harness.processes.length, 1);
  assert.deepEqual(process.requests.map(request => request.method), ["initialize", "thread/start"]);
  assert.deepEqual(process.clientNotifications.map(notification => notification.method), ["initialized"]);
  const threadOptions = process.requests[1].params;
  assert.equal(threadOptions.ephemeral, true);
  assert.equal(threadOptions.approvalPolicy, "never");
  assert.equal(threadOptions.sandbox, "read-only");
  assert.deepEqual(threadOptions.runtimeWorkspaceRoots, []);
  assert.equal(session.threadId, "thread-1");
  assert.ok(threadOptions.baseInstructions.includes("PenEcho Canvas Agent"));
  const dynamicTools = threadOptions.dynamicTools;
  assert.equal(dynamicTools.length, 1);
  assert.equal(dynamicTools[0].type, "namespace");
  assert.equal(dynamicTools[0].name, "penecho");
  assert.ok(dynamicTools[0].tools.some(tool => tool.name === "canvas_inspect" && tool.inputSchema.type === "object"));
  assert.ok(dynamicTools[0].tools.some(tool => tool.name === "web_read"));

  const completeTurn = async (prompt, answer, images = []) => {
    let turnNumber = 0;
    process.requestHandler = async (method, params) => {
      if (method !== "turn/start") return {};
      turnNumber += 1;
      const turnId = `turn-${turnNumber}`;
      setImmediate(() => {
        process.emitNotification("turn/started", { threadId:process.threadId, turnId });
        process.emitNotification("item/agentMessage/delta", { threadId:process.threadId, turnId, delta:answer });
        process.emitNotification("thread/tokenUsage/updated", { threadId:process.threadId, turnId, tokenUsage:{ last:{ inputTokens:2, cachedInputTokens:0, outputTokens:3, reasoningOutputTokens:0, totalTokens:5 }, total:{ inputTokens:4, cachedInputTokens:0, outputTokens:6, reasoningOutputTokens:0, totalTokens:10 } } });
        process.emitNotification("item/completed", { threadId:process.threadId, turnId, item:{ type:"agentMessage", text:answer } });
        process.emitNotification("turn/completed", { threadId:process.threadId, turn:{ id:turnId, status:"completed", items:[] } });
      });
      return { turn:{ id:turnId } };
    };
    return harness.host.submit(session, prompt, false, images, {}, null);
  };
  const png=await sharp({ create:{ width:1, height:1, channels:3, background:"#ff0000" } }).png().toBuffer();

  const first = await completeTurn("first user turn", "first answer", [{ data:png.toString("base64"), mediaType:"image/png" }]);
  const second = await completeTurn("second user turn", "second answer");
  assert.equal(first.output, "first answer");
  assert.equal(second.output, "second answer");
  assert.equal(process.threadId, "thread-1");
  const turns = process.requests.filter(request => request.method === "turn/start");
  assert.deepEqual(turns.map(turn => turn.params.threadId), ["thread-1", "thread-1"]);
  assert.equal(turns[0].params.input.some(item => item.text?.includes("second user turn")), false);
  assert.equal(turns[1].params.input.some(item => item.text?.includes("first user turn")), false);
  assert.equal(turns[0].params.input[0].text, "first user turn");
  assert.equal(turns[1].params.input[0].text, "second user turn");
  assert.equal(turns[0].params.input.some(item => item.type === "image"), true);
  assert.equal(turns[1].params.input.some(item => item.type === "image"), false);
  assert.ok(harness.messages.some(message => message.type === "session_event" && message.payload.kind === "token_usage"));
  assert.ok(traceEvents.some(event => event.phase === "event" && event.event?.kind === "token_usage"));
});

test("Codex Native dynamic tools preserve call ids, execute serially through the browser, and return content items", async t => {
  const harness = await createNativeHarness();
  t.after(() => harness.cleanup());
  const session = await harness.connect();
  const process = harness.processes[0];
  process.requestHandler = async method => {
    if (method !== "turn/start") return {};
    const turnId = "tool-turn";
    setImmediate(async () => {
      process.emitNotification("turn/started", { threadId:process.threadId, turnId });
      const calls = [
        process.serverRequest("item/tool/call", {
        threadId:process.threadId, turnId, callId:"codex-call-1", namespace:"penecho", tool:"canvas_inspect", arguments:{ scope:"canvas" },
        }),
        process.serverRequest("item/tool/call", {
          threadId:process.threadId, turnId, callId:"codex-call-2", namespace:"penecho", tool:"canvas_inspect", arguments:{ scope:"viewport" },
        }),
      ];
      await Promise.all(calls);
      process.emitNotification("item/agentMessage/delta", { threadId:process.threadId, turnId, delta:"Inspected." });
      process.emitNotification("turn/completed", { threadId:process.threadId, turn:{ id:turnId, status:"completed", items:[] } });
    });
    return { turn:{ id:turnId } };
  };
  const submitted = harness.host.submit(session, "Inspect the canvas", false, [], {}, null);
  await waitFor(() => harness.messages.some(message => message.type === "tool_request"));
  const request = harness.messages.find(message => message.type === "tool_request");
  assert.equal(request.payload.callId, "codex-call-1");
  assert.equal(request.payload.name, "canvas_inspect");
  assert.equal(harness.messages.filter(message => message.type === "tool_request").length, 1, "dynamic tools must not execute concurrently");
  harness.host.resolveToolResult(session, { requestId:request.payload.requestId, ok:true, result:{ revision:7, canvas:{ width:800, height:600 } } });
  await waitFor(() => harness.messages.filter(message => message.type === "tool_request").length === 2);
  const secondRequest = harness.messages.filter(message => message.type === "tool_request")[1];
  assert.equal(secondRequest.payload.callId, "codex-call-2");
  harness.host.resolveToolResult(session, { requestId:secondRequest.payload.requestId, ok:true, result:{ revision:8, canvas:{ width:800, height:600 } } });
  const result = await submitted;
  assert.equal(result.output, "Inspected.");
  assert.equal(process.responses.length, 2);
  assert.equal(process.responses[0].result.success, true);
  assert.equal(process.responses[0].result.contentItems[0].type, "inputText");
  assert.match(process.responses[0].result.contentItems[0].text, /"revision":7/);
});

test("Codex Native process crashes fail closed and remove the session mapping and runtime directory", async t => {
  const harness = await createNativeHarness();
  t.after(() => harness.cleanup());
  const session = await harness.connect();
  const process = harness.processes[0];
  const runtimeDirectory = session.projectRuntimeDirectory;
  process.requestHandler = async method => {
    if (method !== "turn/start") return {};
    setImmediate(() => process.gone(new Error("fake protocol exit")));
    return new Promise(() => {});
  };
  await assert.rejects(harness.host.submit(session, "turn after crash", false, [], {}, null), /fake protocol exit/);
  await waitFor(() => process.closedCount > 0);
  assert.equal(harness.host.sessions.size, 0);
  assert.equal(fs.existsSync(runtimeDirectory), false);
  await assert.rejects(harness.host.submit(session, "submit after crash", false, [], {}, null), /closed/);
});

test("Codex Native turn timeout interrupts, fails tools, closes the process, and is idempotent", async t => {
  const harness = await createNativeHarness({ timeoutMs:30 });
  t.after(() => harness.cleanup());
  const session = await harness.connect();
  const process = harness.processes[0];
  process.requestHandler = async method => method === "turn/start" ? { turn:{ id:"timeout-turn" } } : {};
  await assert.rejects(harness.host.submit(session, "timeout turn", false, [], {}, null), /timed out/);
  await waitFor(() => process.closedCount > 0);
  assert.ok(process.requests.some(request => request.method === "turn/interrupt" && request.params.turnId === "timeout-turn"));
  assert.equal(harness.host.sessions.size, 0);
  await harness.host.disposeSession(session);
  await harness.host.dispose();
  assert.equal(process.closedCount, 1);
});

test("Codex Native observes native compaction without recording prompt content", async t => {
  const harness = await createNativeHarness();
  t.after(() => harness.cleanup());
  const conversationEvents = [];
  harness.host.conversationLogger = event => conversationEvents.push(event);
  const traceEvents = [];
  harness.host.conversationTrace = event => traceEvents.push(event);
  const session = await harness.connect();
  const process = harness.processes[0];
  process.requestHandler = async method => {
    if (method !== "turn/start") return {};
    const turnId = "compaction-turn";
    setImmediate(() => {
      process.emitNotification("thread/compacted", { threadId:process.threadId, turnId });
      process.emitNotification("item/completed", { threadId:process.threadId, turnId, item:{ type:"contextCompaction" } });
      process.emitNotification("item/completed", { threadId:process.threadId, turnId, item:{ type:"agentMessage", text:"Compact." } });
      process.emitNotification("turn/completed", { threadId:process.threadId, turn:{ id:turnId, status:"completed", items:[] } });
    });
    return { turn:{ id:turnId } };
  };
  const result = await harness.host.submit(session, "private prompt content", false, [], {}, null);
  assert.equal(result.output, "Compact.");
  const compactions = harness.messages.filter(message => message.type === "session_event" && message.payload.kind === "compaction");
  assert.equal(compactions.length, 2);
  const serialized = JSON.stringify(conversationEvents);
  assert.equal(serialized.includes("private prompt content"), false);
  assert.equal(JSON.stringify(traceEvents).includes("private prompt content"), false);
  assert.ok(traceEvents.some(event => event.phase === "event" && event.event?.kind === "compaction"));
});

test("Codex Native refuses non-allowlisted app-server interactions", async t => {
  const harness = await createNativeHarness();
  t.after(() => harness.cleanup());
  const session = await harness.connect();
  const process = harness.processes[0];
  process.requestHandler = async method => {
    if (method !== "turn/start") return {};
    const turnId = "approval-turn";
    setImmediate(() => {
      process.emitNotification("turn/started", { threadId:process.threadId, turnId });
      void process.serverRequest("item/commandExecution/requestApproval", { threadId:process.threadId, turnId });
    });
    return { turn:{ id:turnId } };
  };
  await assert.rejects(harness.host.submit(session, "request approval", false, [], {}, null), /refused Codex app-server request/);
  await waitFor(() => process.closedCount > 0);
  assert.equal(process.responseErrors.length, 1);
  assert.match(process.responseErrors[0].error.message, /refused/);
});

test("Codex Native app-server child uses strict wire initialization before ephemeral thread creation", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-codex-process-test-"));
  t.after(() => fs.rmSync(directory, { recursive:true, force:true }));
  const { CodexNativeAppServerProcess } = await import("../src/server/canvas-agent/codex-native-host.mjs");
  class FakeStdin extends EventEmitter {
    constructor(child) { super(); this.child=child; this.writable=true; }
    write(line) {
      const message=JSON.parse(line);
      this.child.sent.push(message);
      if (message.id !== undefined && message.method) {
        const result=message.method === "thread/start" ? { thread:{ id:"wire-thread", ephemeral:true } } : {};
        setImmediate(() => this.child.stdout.emit("data", `${JSON.stringify({ jsonrpc:"2.0", id:message.id, result })}\n`));
      }
    }
    end() { this.writable=false; }
  }
  class FakeChild extends EventEmitter {
    constructor() {
      super();
      this.sent=[];
      this.stdin=new FakeStdin(this);
      this.stdout=new EventEmitter();
      this.stderr=new EventEmitter();
      this.stdout.setEncoding=() => {};
      this.stderr.setEncoding=() => {};
    }
  }
  const child=new FakeChild(), spawned=[];
  const fakeExecutable=path.join(directory, "codex");
  fs.writeFileSync(fakeExecutable, "#!/bin/sh\nexit 0\n", { mode:0o700 });
  const process=new CodexNativeAppServerProcess({
    connection:{ cliPath:fakeExecutable },
    env:{},
    spawnProcess:(command,args,options) => { spawned.push({ command,args,options }); return child },
    prepareRuntime:async () => ({}),
  });
  const threadId=await process.start({ model:"codex-model", cwd:directory, baseInstructions:"stable instructions", dynamicTools:[] });
  assert.equal(threadId, "wire-thread");
  assert.equal(fs.statSync(process.workDir).mode & 0o700, 0o700);
  assert.deepEqual(child.sent.map(message => message.method || `response:${message.id}`), ["initialize", "initialized", "thread/start"]);
  assert.equal(child.sent[0].params.clientInfo.name, "penecho-canvas-agent");
  assert.equal(child.sent[2].params.model, "codex-model");
  assert.equal(child.sent[2].params.ephemeral, true);
  assert.equal(child.sent[2].params.approvalPolicy, "never");
  assert.equal(child.sent[2].params.sandbox, "read-only");
  assert.equal(spawned[0].args[0], "app-server");
  assert.equal(spawned[0].options.cwd, process.workDir);
  assert.equal(spawned[0].options.shell, false);
  assert.deepEqual(spawned[0].options.env, {});
  assert.deepEqual(spawned[0].options.stdio, ["pipe", "pipe", "pipe"]);
  assert.equal(spawned[0].args.includes("--strict-config"), true);
  assert.equal(spawned[0].args.includes("--disable"), true);
  assert.ok(spawned[0].args.some((value, index) => value === "-c" && spawned[0].args[index + 1] === 'approval_policy="never"'));
  assert.ok(spawned[0].args.some((value, index) => value === "-c" && spawned[0].args[index + 1] === 'history.persistence="none"'));
  const workDirectory=process.workDir;
  const gone=new Promise(resolve => { process.onGone=resolve });
  child.stdout.emit("data", "not-json\n");
  assert.match((await gone).message, /invalid JSON-RPC/);
  await process.close();
  assert.equal(fs.existsSync(workDirectory), false);
});

test("Codex Native provider switch interrupts an active old turn before cleanup and suppresses its callbacks", async t => {
  const harness=await createNativeHarness();
  t.after(() => harness.cleanup());
  const session=await harness.connect();
  const process=harness.processes[0];
  process.requestHandler=async method => {
    if (method !== "turn/start") return {};
    const turnId="active-switch-turn";
    setImmediate(() => process.emitNotification("turn/started", { threadId:process.threadId, turnId, turn:{ id:turnId } }));
    return new Promise(() => {});
  };
  const submitted=harness.host.submit(session, "old connection turn", false, [], {}, null);
  await waitFor(() => harness.messages.some(message => message.type === "session_event" && message.payload.kind === "turn_start"));
  await waitFor(() => Boolean(session.active?.turnId));
  await harness.host.disposeSession(session);
  await assert.rejects(submitted, /session closed/);
  assert.ok(process.requests.some(request => request.method === "turn/interrupt"));
  assert.equal(process.closedCount, 1);
  assert.equal(harness.host.sessions.size, 0);
  process.emitNotification("item/agentMessage/delta", { threadId:process.threadId, turnId:"active-switch-turn", delta:"old callback" });
  assert.equal(harness.messages.some(message => message.type === "session_event" && message.payload.text === "old callback"), false);
  assert.equal(harness.processes.length, 1);
});

test("Codex Native returns loaded optional contracts as tool content rather than only hashes", async t => {
  const harness = await createNativeHarness();
  t.after(() => harness.cleanup());
  const session = await harness.connect();
  const widget = await session.native.tool("load_widget_contract").execute({ route:"general-html" }, { callId:"contract-call", signal:new AbortController().signal });
  assert.equal(widget.route, "general-html");
  assert.match(widget.document, /HTML|visual|Widget/i);
  assert.ok(widget.sha256.length === 64);
  const skill = await session.native.tool("load_visual_skill").execute({ skill:"math-2d" }, { callId:"skill-call", signal:new AbortController().signal });
  assert.equal(skill.skill, "math-2d");
  assert.match(skill.document, /scientific visualization|math/i);
});

test("Codex Native browser disconnect can resume the same thread and TTL cleanup is idempotent", async t => {
  const harness = await createNativeHarness({ sessionTtlMs:20 });
  t.after(() => harness.cleanup());
  const session = await harness.connect();
  const ready = harness.messages.find(message => message.type === "ready");
  await harness.host.disconnect(session, session.binding);
  const resumedMessages = [];
  const resumed = await harness.host.connect({
    canvasSessionId:session.id,
    resumeToken:ready.payload.resumeToken,
    clientId:session.clientId,
    connectionId:session.connectionId,
    binding:{ name:"resumed" },
    send:(type, payload, identity) => resumedMessages.push({ type, payload, identity }),
  });
  assert.equal(resumed, session);
  assert.equal(resumed.threadId, "thread-1");
  assert.equal(harness.processes.length, 1);
  assert.equal(resumedMessages[0].payload.resumed, true);
  await harness.host.disconnect(resumed, resumed.binding);
  await waitFor(() => harness.processes[0].closedCount > 0);
  assert.equal(harness.host.sessions.size, 0);
  await harness.host.disposeSession(resumed);
  await harness.host.dispose();
  assert.equal(harness.processes[0].closedCount, 1);
});

test("Codex Native exposes only the host-resolved read-only project tool surface", async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(), "penecho-codex-native-project-test-"));
  t.after(() => fs.rmSync(directory, { recursive:true, force:true }));
  const projectDirectory=path.join(directory, "project");
  fs.mkdirSync(projectDirectory);
  fs.writeFileSync(path.join(projectDirectory, "notes.txt"), "bounded text\n");
  const { createCanvasAgentNativeRuntime }=await import("../src/server/canvas-agent/runtime.mjs");
  const baseSession={
    projectRuntimeDirectory:directory,
    widgetCapabilities:{ professionalEnabled:false, privatePlugins:[] },
    generalHtmlContract:{ hash:"general-hash", document:"general" },
    professionalDiagramsContract:null,
    visualExplorerContract:{ hash:"visual-hash", document:"visual" },
    visualSkillContracts:{},
    widgetContractsLoaded:new Set(),
    visualSkillsLoaded:new Set(),
    nextWidgetContractOrder:500,
    webSearch:{ enabled:false },
  };
  const folderRuntime=await createCanvasAgentNativeRuntime({
    attachments:{ saveImages:async () => [] },
    session:{ ...baseSession, project:{ kind:"folder", id:"folder-project", name:"Project", path:projectDirectory } },
  });
  const folderTools=folderRuntime.dynamicTools()[0].tools.map(tool => tool.name);
  for (const name of ["read", "read_image", "glob", "grep", "list_directory", "read_document", "read_database"]) assert.ok(folderTools.includes(name), `missing folder tool ${name}`);
  assert.equal(folderTools.includes("load_project_plugin"), false);
  assert.equal(folderTools.some(name => /^(?:bash|shell|write)/i.test(name)), false);
  assert.match(folderRuntime.instructions(), /read-only folder project/);

  const fileRuntime=await createCanvasAgentNativeRuntime({
    attachments:{ saveImages:async () => [] },
    session:{ ...baseSession, project:{ kind:"file", id:"file-project", name:"notes.txt", reader:"text" } },
  });
  const fileTools=fileRuntime.dynamicTools()[0].tools.map(tool => tool.name);
  assert.ok(fileTools.includes("read"));
  assert.equal(fileTools.includes("glob"), false);
  assert.equal(fileTools.includes("list_directory"), false);
  assert.match(fileRuntime.instructions(), /exactly one read-only file/);
});

test("Codex Native connection fingerprint changes dispose the old thread and start a new process", async t => {
  const harness = await createNativeHarness();
  t.after(() => harness.cleanup());
  const session = await harness.connect();
  const ready = harness.messages.find(message => message.type === "ready");
  harness.connection.cliModel = "changed-model";
  const replacement = await harness.host.connect({
    canvasSessionId:session.id,
    resumeToken:ready.payload.resumeToken,
    clientId:session.clientId,
    connectionId:session.connectionId,
    binding:{ name:"replacement" },
    send:() => {},
  });
  assert.notEqual(replacement, session);
  assert.equal(harness.processes.length, 2);
  assert.equal(harness.processes[0].closedCount, 1);
  assert.equal(harness.processes[1].closedCount, 0);
  assert.equal(harness.host.sessions.size, 1);
});

test("Canvas Agent router fixes the session owner and switches providers atomically", async () => {
  const { CanvasAgentHostRouter } = await import("../src/server/canvas-agent/host-router.mjs");
  const events = [];
  let nativeSessionId = 0, harnessSessionId = 0;
  const native = {
    resolveConnection:id => id.startsWith("codex-") ? { id, provider:"codex-cli" } : null,
    async connect(request) { events.push(`native:connect:${request.connectionId}`); return { id:`native-${++nativeSessionId}`, connectionId:request.connectionId, active:true } },
    async disposeSession(session) { events.push(`native:dispose:${session.id}`) },
    submit(session) { events.push(`native:submit:${session.id}`); return { owner:"native" } },
    cancel() {}, resolveToolResult() {}, disconnect() {}, updateState() {}, setWebSearchEnabled() {}, activeProjectIds:() => [], dispose() {},
  };
  const harness = {
    resolveConnection:id => id.startsWith("api-") || id.startsWith("kimi-") || id.startsWith("claude-") ? { id, provider:id.split("-")[0] === "api" ? "api" : `${id.split("-")[0]}-cli` } : null,
    async connect(request) { events.push(`harness:connect:${request.connectionId}`); return { id:`harness-${++harnessSessionId}`, connectionId:request.connectionId, active:true } },
    async disposeSession(session) { events.push(`harness:dispose:${session.id}`) },
    submit(session) { events.push(`harness:submit:${session.id}`); return { owner:"harness" } },
    cancel() {}, resolveToolResult() {}, disconnect() {}, updateState() {}, setWebSearchEnabled() {}, activeProjectIds:() => [], dispose() {},
  };
  const router = new CanvasAgentHostRouter({ harness, native });
  const codex = await router.connect({ connectionId:"codex-a" });
  assert.equal(codex.engine, "codex-native");
  const api = await router.replaceSession(codex, { connectionId:"api-b" });
  assert.equal(api.engine, "harness");
  const codexAgain = await router.replaceSession(api, { connectionId:"codex-b" });
  assert.equal(codexAgain.engine, "codex-native");
  const codexReplacement = await router.replaceSession(codexAgain, { connectionId:"codex-c" });
  assert.equal(codexReplacement.engine, "codex-native");
  const kimi = await router.replaceSession(codexReplacement, { connectionId:"kimi-d" });
  assert.equal(kimi.engine, "harness");
  const claude = await router.replaceSession(kimi, { connectionId:"claude-e" });
  assert.equal(claude.engine, "harness");
  assert.deepEqual(events, [
    "native:connect:codex-a",
    "native:dispose:native-1",
    "harness:connect:api-b",
    "harness:dispose:harness-1",
    "native:connect:codex-b",
    "native:dispose:native-2",
    "native:connect:codex-c",
    "native:dispose:native-3",
    "harness:connect:kimi-d",
    "harness:dispose:harness-2",
    "harness:connect:claude-e",
  ]);
  codexAgain.engineOwner = harness;
  assert.throws(() => router.submit(codexAgain), /owner is invalid/);
});

test("Codex Canvas Agent routing does not initialize the DeepSeek Harness runtime", async () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(), "penecho-codex-router-test-"));
  fs.rmSync(directory, { recursive:true, force:true });
  const { CanvasHarnessHost }=await import("../src/server/canvas-agent/runtime.mjs");
  const { CanvasAgentHostRouter }=await import("../src/server/canvas-agent/host-router.mjs");
  const harness=new CanvasHarnessHost({
    stateDirectory:directory,
    rootDirectory:ROOT,
    resolveConnection:() => ({ id:"codex-only", provider:"codex-cli" }),
    listConnections:() => [],
  });
  harness.initialize=async () => { throw new Error("Harness must not initialize for Codex Native Canvas Agent.") };
  const native={
    resolveConnection:id => id === "codex-only" ? { id, provider:"codex-cli" } : null,
    async connect(request) { return { id:"codex-native-only", connectionId:request.connectionId } },
    disposeSession() {}, activeProjectIds:() => [], async dispose() {},
  };
  const router=new CanvasAgentHostRouter({ harness, native });
  const session=await router.connect({ connectionId:"codex-only" });
  assert.equal(session.engine, "codex-native");
  assert.equal(harness.context, null);
  await router.dispose();
});
