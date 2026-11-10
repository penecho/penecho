"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

test("tool results preserve ordinary errors, structured Harness errors, and matching call identity", async () => {
  const { publicSessionEvent } = await import("../src/server/canvas-agent/runtime.mjs");
  const { createToolResultMessage } = await import("@deepseek-ai/dsh-llm");
  const session = { projectRuntimeDirectory:"/private/runtime-test" };
  const project = (isError, text, error) => publicSessionEvent({ type:"tool/result", data:{
    turn:2, step:3,
    message:createToolResultMessage({ callId:"create-2", isError, content:[{ type:"text", text }] }),
    ...(error ? { error } : {}),
  } }, session);
  const ordinary = project(true, "Error: missing placement /private/runtime-test/item");
  assert.equal(ordinary.callId, "create-2");
  assert.equal(ordinary.text, "Error: missing placement <project-runtime>/item");
  assert.deepEqual(ordinary.error, { message:ordinary.text });
  const structured = project(true, "Error: invalid arguments", { name:"ToolInputError", code:"INVALID_ARGUMENTS" });
  assert.deepEqual(structured.error, { name:"ToolInputError", code:"INVALID_ARGUMENTS" });
  const success = project(false, "Created");
  assert.equal(success.error, null);
  assert.equal(success.text, "Created");
  const mismatched = publicSessionEvent({ type:"tool/result", data:{ message:{ source:{ callId:"correct" }, content:[{ type:"tool-result", toolCallId:"other", isError:true, content:[{type:"text",text:"wrong call"}] }] } } }, session);
  assert.equal(mismatched.callId, "correct");
  assert.equal(mismatched.error, null);
  assert.equal(mismatched.text, "");
});

test("API progress reaches the existing chat stream before tools and remains in completed messages", async () => {
  const { publicSessionEvent } = await import("../src/server/canvas-agent/runtime.mjs");
  const session = {}, events = [];
  const project = (type, data) => {
    const event = publicSessionEvent({ type, data }, session);
    if (event) events.push(event);
    return event;
  };
  project("turn/start", { turn:1 });
  const updates = ["进展：先读取相关内容。\n", "进展：已确认结构，开始修改。\n", "进展：修改已应用，正在核对结果。\n"];
  for (let step = 1; step <= updates.length; step++) {
    const text = updates[step - 1];
    project("assistant/chunk", { turn:1, step, chunk:{ type:"text-delta", text } });
    assert.equal(events.at(-1).kind, "assistant_delta");
    assert.equal(events.at(-1).text, text);
    project("assistant/message", { turn:1, step, message:{ content:[{ type:"text", text }] } });
    project("tool/call", { turn:1, step, callId:`call-${step}`, name:"canvas_inspect", arguments:"{}" });
    assert.deepEqual(events.slice(-3).map(event => event.kind), ["assistant_delta", "assistant_message", "tool_call"]);
  }
  project("assistant/message", { turn:1, step:4, message:{ content:[{ type:"text", text:"已完成修改。" }] } });
  project("turn/end", { turn:1, reason:{ kind:"completed" } });
  assert.deepEqual(events.filter(event => event.kind === "assistant_message").map(event => event.text), [...updates, "已完成修改。"]);
});

test("public progress never forwards reasoning or tool-argument deltas", async () => {
  const { publicSessionEvent } = await import("../src/server/canvas-agent/runtime.mjs");
  for (const type of ["reasoning-delta", "thinking-delta", "tool-call-delta"]) {
    assert.equal(publicSessionEvent({ type:"assistant/chunk", data:{ turn:1, step:1, chunk:{ type, text:"private content", argumentsDelta:"private arguments" } } }, {}), null);
  }
  assert.equal(publicSessionEvent({ type:"assistant/message", data:{ turn:1, step:1, message:{ content:[{ type:"reasoning", text:"private content" }] } } }, {}), null);
});

test("progress and a fragmented final Canvas title coexist in the same turn", async () => {
  const { publicSessionEvent } = await import("../src/server/canvas-agent/runtime.mjs");
  const session = { canvasTitleRequested:true };
  const chunk = (step, text) => publicSessionEvent({ type:"assistant/chunk", data:{ turn:1, step, chunk:{ type:"text-delta", text } } }, session);
  assert.equal(chunk(1, "进展：正在整理内容。\n").text, "进展：正在整理内容。\n");
  assert.equal(chunk(2, "<penecho_canvas_"), null);
  assert.equal(chunk(2, "title>内容整理</penecho_canvas_title>\n已完成。").text, "已完成。");
  assert.equal(publicSessionEvent({ type:"turn/end", data:{ turn:1, reason:{ kind:"completed" } } }, session).canvasTitle, "内容整理");
});

test("Harness forwards CLI progress to the chat before the CLI decision resolves", async t => {
  const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
  const { CanvasHarnessHost } = await import("../src/server/canvas-agent/runtime.mjs");
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-progress-stream-"));
  const connection = { id:"progress-test", provider:"claude-cli", name:"Test", cliPath:"unused-test-cli", cliModel:"test", effort:"high" };
  const events = [], progress = "进展：正在读取现有内容。", reply = "读取完成。";
  let release, cliResolved = false, calls = 0, sawProgress;
  const pending = new Promise(resolve => { release = resolve; });
  const progressSeen = new Promise(resolve => { sawProgress = resolve; });
  const host = new CanvasHarnessHost({
    stateDirectory, rootDirectory:path.resolve(__dirname, ".."),
    resolveConnection:id => id === connection.id ? connection : null,
    listConnections:() => [connection],
    callCli:async request => {
      calls++;
      if (calls > 1) return JSON.stringify({ type:"final", text:reply });
      request.onText?.(JSON.stringify({ progress }).slice(0, -1) + ",");
      await pending;
      cliResolved = true;
      return JSON.stringify({ progress, type:"tool_call", name:"penecho_read_file", arguments:{ path:"canvas.json" } });
    },
  });
  t.after(async () => { release(); await host.dispose(); fs.rmSync(stateDirectory, { recursive:true, force:true }); });
  let session;
  session = await host.connect({ clientId:"progress-client", connectionId:connection.id, binding:{}, send:(type, payload) => {
    if (type === "session_event") {
      events.push(payload);
      if (payload.kind === "assistant_delta" && payload.text.includes(progress)) sawProgress();
    }
    if (type === "tool_request") {
      assert.equal(payload.name,"canvas_document");
      assert.equal(payload.arguments.operation,"mcp_read_file");
      assert.equal(payload.arguments.arguments.path,"/canvas.json");
      assert.equal(payload.arguments.bindingKey,payload.arguments.arguments.sessionId);
      queueMicrotask(() => host.resolveToolResult(session, { requestId:payload.requestId, ok:true, result:{ sessionId:payload.arguments.bindingKey, path:"/canvas.json", content:"{}", contentHash:"canvas-hash" } }));
    }
  } });
  host.updateState(session, { revision:1, canvas:{ width:2048, height:2048 }, selection:{ objectIds:[] } });
  const submission = host.submit(session, "读取画布并说明结果。");
  let timer;
  try {
    await Promise.race([progressSeen, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Progress was buffered until CLI completion")), 2000); })]);
    assert.equal(cliResolved, false);
    assert.equal(events.some(event => event.kind === "tool_call"), false);
    release();
    await submission;
    // Harness submit dispatches asynchronously; wait only for the observable end.
    const deadline = Date.now() + 2000;
    while (!events.some(event => event.kind === "turn_end") && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(events.some(event => event.kind === "turn_end" && event.reason?.kind === "completed"), true);
    assert.equal(events.filter(event => event.kind === "assistant_message" && event.text.includes(progress)).length, 1);
    assert.equal(events.some(event => event.kind === "assistant_message" && event.text === reply), true);
    assert.equal(calls, 2);
  } finally { clearTimeout(timer); release(); await submission; }
});


test("output exhaustion reaches the existing error UI without discarding the session or Canvas", async () => {
  const { publicSessionEvent } = await import("../src/server/canvas-agent/runtime.mjs");
  const content={revision:7,objects:[{id:"existing-widget"}]};
  const session={id:"same-session",stateDigest:content,canvasTitleRequested:true,canvasTitleCandidate:"unfinished",canvasTitleStreams:new Map()};
  const event=publicSessionEvent({type:"turn/end",data:{turn:2,reason:{kind:"max-tokens"}}},session);
  assert.equal(event.reason.kind,"error");
  assert.equal(event.reason.terminationReason,"max-tokens");
  assert.equal(event.reason.error.code,"MODEL_OUTPUT_EXHAUSTED");
  assert.match(event.reason.error.message,/before completing this turn/);
  assert.equal(event.canvasTitle,undefined);
  assert.equal(session.id,"same-session");
  assert.equal(session.stateDigest,content);
  assert.equal(publicSessionEvent({type:"turn/end",data:{turn:3,reason:{kind:"cancelled"}}},session).reason.kind,"cancelled");
});
