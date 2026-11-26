"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { parseHTML } = require("./helpers/dom.js");

const RunWatch = require("../src/server/project-lines/run-watch.js");
const { CodexServer } = require("../src/server/project-lines/codex-server.js");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { parseLine, parseDialect, isResult, piRpcInit, piRpcSteer, piRpcUiResponse, claudeControlResponse } = require("../src/server/project-lines/activity.js");
const { Service } = require("../src/server/project-lines/service.js");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const F = require("../src/server/project-lines/format.js");
const TaskContext = require("../src/server/project-lines/task-context.js");

function makeFakeChild(pid = 99001) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.stdinChunks = [];
  const origWrite = child.stdin.write.bind(child.stdin);
  child.stdin.write = (chunk, ...rest) => {
    child.stdinChunks.push(String(chunk));
    return origWrite(chunk, ...rest);
  };
  const origEnd = child.stdin.end.bind(child.stdin);
  child.stdin.end = (chunk, ...rest) => {
    if (chunk !== undefined && chunk !== null && typeof chunk !== "function") child.stdinChunks.push(String(chunk));
    return origEnd(chunk, ...rest);
  };
  child.kill = () => { child.killed = true; setImmediate(() => child.emit("close", 0)); };
  return child;
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label = "condition", timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return;
    await wait(15);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

// =========================================================================
// 1. Antigravity schedule wakeup clearing & waiting-turn settlement
// =========================================================================
test("antigravityTurnState clears one-shot schedule task IDs on matching SYSTEM_MESSAGE wakeup and manage_task kill, while keeping real pending tasks active", () => {
  const conv = "fa3126ac-595d-49a7-b77f-e51f3cacfc55";
  const rows = [
    { step_index: 1, type: "USER_INPUT", status: "DONE", content: "Create icons" },
    { step_index: 22, type: "PLANNER_RESPONSE", status: "DONE", tool_calls: [{ id: "call-23", name: "schedule", args: { DurationSeconds: 6, Prompt: "Inspect rendered PNG" } }] },
    { step_index: 23, type: "TOOL_RESPONSE", tool_call_id: "call-23", status: "RUNNING", content: `Background task started. task id: ${conv}/task-23` },
    { step_index: 25, type: "SYSTEM_MESSAGE", status: "DONE", content: `[Message] timestamp=2026-11-21T03:53:37Z sender=${conv}/task-23 priority=MESSAGE_PRIORITY_HIGH content=Inspect rendered PNG` },
    { step_index: 30, type: "PLANNER_RESPONSE", status: "DONE", created_at: "2026-11-21T03:58:00Z", content: "Updated Questions for you. Awaiting your choice.", tool_calls: [] },
  ];
  const st = RunWatch.antigravityTurnState(rows, 0);
  assert.equal(st.pending, false, "one-shot schedule wakeup clears pending task");
  assert.deepEqual(st.pendingTasks, []);
  assert.equal(st.unansweredWakeup, false);
  assert.equal(st.done?.answer, "Updated Questions for you. Awaiting your choice.");

  // Unfired one-shot schedule stays pending
  const unfired = RunWatch.antigravityTurnState(rows.slice(0, 3), 0);
  assert.equal(unfired.pending, true);
  assert.deepEqual(unfired.pendingTasks, [`${conv}/task-23`]);

  // Recurring cron schedule does NOT clear on a single wakeup (only on completion notice or manage_task kill)
  const cronRows = [
    { step_index: 1, type: "USER_INPUT", status: "DONE", content: "Watch" },
    { step_index: 2, type: "PLANNER_RESPONSE", status: "DONE", tool_calls: [{ id: "call-c", name: "schedule", args: { CronExpression: "*/5 * * * *", Prompt: "Check" } }] },
    { step_index: 3, type: "TOOL_RESPONSE", tool_call_id: "call-c", status: "RUNNING", content: `task id: ${conv}/cron-1` },
    { step_index: 4, type: "SYSTEM_MESSAGE", status: "DONE", content: `[Message] sender=${conv}/cron-1 content=Check` },
  ];
  assert.equal(RunWatch.antigravityTurnState(cronRows, 0).pending, true, "cron schedule stays active after one tick");

  // manage_task kill clears cron schedule
  cronRows.push(
    { step_index: 5, type: "PLANNER_RESPONSE", status: "DONE", tool_calls: [{ id: "call-k", name: "manage_task", args: { Action: "kill", TaskId: `${conv}/cron-1` } }] },
    { step_index: 6, type: "TOOL_RESPONSE", tool_call_id: "call-k", status: "DONE", content: `Killed ${conv}/cron-1` },
  );
  assert.equal(RunWatch.antigravityTurnState(cronRows, 0).pending, false, "manage_task kill clears schedule");

  // Real pending run_command does NOT clear on a non-completion SYSTEM_MESSAGE
  const cmdRows = [
    { step_index: 1, type: "USER_INPUT", status: "DONE", content: "Run build" },
    { step_index: 2, type: "PLANNER_RESPONSE", status: "DONE", tool_calls: [{ id: "call-cmd", name: "run_command", args: { CommandLine: "npm run build" } }] },
    { step_index: 3, type: "TOOL_RESPONSE", tool_call_id: "call-cmd", status: "RUNNING", content: `task id: ${conv}/cmd-1` },
    { step_index: 4, type: "SYSTEM_MESSAGE", status: "DONE", content: `[Message] sender=${conv}/cmd-1 content=Still running...` },
  ];
  assert.equal(RunWatch.antigravityTurnState(cmdRows, 0).pending, true, "non-schedule background command stays pending until completion notice");
});

test("Antigravity turn with fired schedule and status: waiting closes stdin cleanly on result and settles to waiting", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agy-wait-"));
  const stateDir = path.join(root, "state"), docsDir = path.join(root, "docs");
  fs.mkdirSync(stateDir, { recursive: true });
  let spawnedChild = null;
  const agents = {
    available: () => [{ id: "antigravity", available: true, name: "Antigravity" }],
    classifier: () => null,
    command: (_id, opts) => ({ command: "agy", args: [], cwd: opts.workdir, stdin: true, input: "stream-json", dialect: "antigravity", steerMode: "live" }),
  };
  const service = new Service({
    directory: stateDir,
    agents,
    autoWatch: false,
    spawnFn: () => { spawnedChild = makeFakeChild(91001); return spawnedChild; },
  });
  service.antigravityRunState = () => ({ done: { answer: "Choose an icon", at: Date.now() }, pending: false, pendingTasks: [], unansweredWakeup: false, error: "" });
  t.after(() => { service.runs.clear(); service.close(); fs.rmSync(root, { recursive: true, force: true }); });

  const project = service.store.create({ name: "AgyWait", docsPath: docsDir });
  project.defaultAgent = "antigravity"; service.store.save();
  const created = await service.createTopic(project, { text: "Draw icons", agent: "antigravity", kinds: ["ask", "work"], start: true });
  await until(() => Boolean(spawnedChild), "agy child spawned");

  // Agent writes Questions for you + status: waiting, then emits result
  let md = service.readDoc(project, created.slug);
  md = F.setAbove(md, F.QUESTIONS, F.renderQuestions([{ from: "antigravity", text: "Which icon?", options: ["Option A", "Option B"] }]));
  md = F.setFront(md, { status: "waiting", why: "Choose an icon" });
  service.writeDoc(project, created.slug, md);

  spawnedChild.stdout.write(`${JSON.stringify({ event: "init", conversation_id: "conv-agy-1" })}\n`);
  spawnedChild.stdout.write(`${JSON.stringify({ event: "result", result: { conversation_id: "conv-agy-1", status: "SUCCESS", response: "Choose an icon" } })}\n`);
  await until(() => spawnedChild.stdin.writableEnded, "stdin closed cleanly on waiting result");
  spawnedChild.emit("close", 0);
  await until(() => !service.runs.size && !service.finishing.size, "run settled");

  const finalDoc = F.parseLine(service.readDoc(project, created.slug));
  assert.equal(finalDoc.status, "waiting");
  const line = service.stateOf(project).lines.find(l => l.slug === created.slug);
  assert.equal(line.running, false);
  assert.equal(line.asking.kind, "topic");
  assert.equal(line.asking.answerable, true);
});

// =========================================================================
// 2. Codex requestUserInput hold + reply & approvalPolicy preservation
// =========================================================================
test("CodexServer holds item/tool/requestUserInput open for replyServer, auto-declines approvals, and cleans up on close", async () => {
  const child = makeFakeChild(92001);
  const held = [];
  const server = new CodexServer({
    child,
    onServerRequest: msg => held.push(msg),
  });

  // Approval request still auto-declines
  child.stdout.write(`${JSON.stringify({ id: 10, method: "item/commandExecution/requestApproval", params: { command: "rm -rf /" } })}\n`);
  await wait(20);
  assert.equal(held.length, 0);
  const approvalReply = JSON.parse(child.stdinChunks.find(c => c.includes('"id":10')));
  assert.deepEqual(approvalReply, { id: 10, result: { decision: "decline" } });

  // requestUserInput is held open
  child.stdout.write(`${JSON.stringify({ id: 11, method: "item/tool/requestUserInput", params: { questions: [{ id: "q1", question: "Pick one?", options: [{ label: "Alpha" }, { label: "Beta" }] }] } })}\n`);
  await wait(20);
  assert.equal(held.length, 1);
  assert.equal(server.pendingServerRequests.size, 1);
  assert.equal(child.stdinChunks.some(c => c.includes('"id":11')), false, "must NOT auto-decline requestUserInput");

  // Reply via replyServer
  const sent = server.replyServer(11, { answers: { q1: { answers: ["Alpha"] } } });
  assert.equal(sent, true);
  assert.equal(server.pendingServerRequests.size, 0);
  const userReply = JSON.parse(child.stdinChunks.find(c => c.includes('"id":11')));
  assert.deepEqual(userReply, { id: 11, result: { answers: { q1: { answers: ["Alpha"] } } } });

  // Pending requests cleaned up on close
  child.stdout.write(`${JSON.stringify({ id: 12, method: "item/tool/requestUserInput", params: { questions: [{ id: "q2", question: "Another?" }] } })}\n`);
  await wait(20);
  assert.equal(server.pendingServerRequests.size, 1);
  server.close();
  assert.equal(server.pendingServerRequests.size, 0);
});

// =========================================================================
// 3. Pi & OMP RPC mode: flags, steer, extension_ui_request/response, EOF
// =========================================================================
test("Pi and OMP launch in RPC mode and an OMP Work can still be steered after an interim end", async t => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-omp-rpc-"));
  const binDir = path.join(tmpHome, ".local", "bin");
  fs.mkdirSync(binDir, { recursive: true });
  for (const name of ["pi", "omp"]) {
    fs.writeFileSync(path.join(binDir, name), "#!/bin/sh\n", { mode: 0o755 });
  }
  const realAgents = createAgents({ env: { HOME: tmpHome, PATH: "" } });
  const piCmd = realAgents.command("pi", { workdir: tmpHome, docs: tmpHome });
  assert.deepEqual(piCmd.args, ["--mode", "rpc"]);
  assert.equal(piCmd.input, "pi-rpc");
  assert.equal(piCmd.steerMode, "live");

  const ompCmd = realAgents.command("omp", { workdir: tmpHome, docs: tmpHome });
  assert.deepEqual(ompCmd.args, ["--mode", "rpc-ui", "--auto-approve"]);
  assert.equal(ompCmd.input, "pi-rpc");
  assert.equal(ompCmd.steerMode, "live");

  // Parser unit checks
  const st = {};
  assert.deepEqual(parseDialect("pi", JSON.stringify({ type: "response", command: "get_state", success: true, data: { sessionId: "pi-sess-1", model: { id: "claude-sonnet" } } }), st), [{ session: "pi-sess-1", model: "claude-sonnet" }]);
  assert.deepEqual(parseDialect("pi", JSON.stringify({ type: "extension_ui_request", id: "w1", method: "setWidget", widgetKey: "autoresearch" }), st), [], "fire-and-forget setWidget is ignored");
  const uiChanges = parseDialect("pi", JSON.stringify({ type: "extension_ui_request", id: "u1", method: "select", title: "Pick framework", options: ["React", "Vue"] }), st);
  assert.equal(uiChanges.some(c => c.asking?.id === "u1"), true);
  assert.equal(isResult(JSON.stringify({ type: "agent_end" })), true);
  assert.equal(isResult({ type:"agent_end", isTerminal:false, yielded:true }), false);
  assert.equal(isResult({ type:"agent_end", isTerminal:true, yielded:false }), false);

  // Full OMP Work using the shared Pi RPC protocol.
  const stateDir = path.join(tmpHome, "state"), docsDir = path.join(tmpHome, "docs");
  fs.mkdirSync(stateDir, { recursive: true });
  let piChild = null;
  const fakeAgents = {
    available: () => [{ id: "omp", available: true, name: "omp" }],
    classifier: () => null,
    command: (_id, opts) => ({ ...ompCmd, cwd:opts.workdir }),
  };
  const service = new Service({ directory: stateDir, agents: fakeAgents, autoWatch: false, spawnFn: () => { piChild = makeFakeChild(93001); return piChild; } });
  t.after(() => { service.runs.clear(); service.close(); fs.rmSync(tmpHome, { recursive: true, force: true }); });

  const project = service.store.create({ name: "PiRpc", docsPath: docsDir });
  project.defaultAgent = "omp"; service.store.save();
  const created = await service.createTopic(project, { text: "Build app", agent: "omp", kinds: ["ask", "work"], start: true });
  await until(() => Boolean(piChild), "pi child spawned");

  // Initial input contains set_event_filter (delta) + get_state + prompt for OMP
  const initJoined = piChild.stdinChunks.join("");
  const initFrames = initJoined.trim().split("\n").map(l => JSON.parse(l));
  assert.deepEqual(initFrames.map(f => f.type), ["set_event_filter", "get_state", "prompt"]);
  assert.equal(initFrames[0].messageUpdates, "delta");
  assert.equal(initJoined.includes('"command"'), false);

  // Emit get_state response + agent_start + extension_ui_request
  piChild.stdout.write(`${JSON.stringify({ id: "init-state", type: "response", command: "get_state", success: true, data: { sessionId: "pi-s1", model: { id: "kimi-k3" } } })}\n`);
  piChild.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  piChild.stdout.write(`${JSON.stringify({ type: "extension_ui_request", id: "req-pi-1", method: "select", title: "Choose DB", options: ["SQLite", "Postgres"] })}\n`);
  await wait(30);

  let line = service.stateOf(project).lines.find(l => l.slug === created.slug);
  assert.equal(line.asking.kind, "tool");
  assert.equal(line.asking.answerable, true);
  assert.equal(line.asking.id, "req-pi-1");
  assert.equal(line.runSteers, false, "a pending tool request requires an explicit answer");
  assert.notEqual(line.runSteerMode, "live");
  assert.equal(line.runAsking, true);

  // Answer via service.answer()
  const ansRes = await service.answer(project, created.slug, "req-pi-1", "Postgres", { requestId: "req-pi-1" });
  assert.equal(ansRes.answered, "tool");
  const uiReplyLine = piChild.stdinChunks.find(c => c.includes('"extension_ui_response"'));
  assert.deepEqual(JSON.parse(uiReplyLine), { type: "extension_ui_response", id: "req-pi-1", value: "Postgres" });

  // A recoverable model failure is followed by an interim agent_end before OMP retries.
  const run = service.runs.get(service.key(project, created.slug));
  piChild.stdout.write(JSON.stringify({ type:"message_end", message:{ role:"assistant", stopReason:"error", errorMessage:"Retrying the model" } }) + "\n");
  piChild.stdout.write(JSON.stringify({ type:"agent_end", isTerminal:false, yielded:false }) + "\n");
  assert.equal(run.lastFailed, true);
  assert.equal(run.rpcStreaming, true);
  assert.equal(Boolean(run.turnOver), false);
  assert.equal(piChild.stdin.writableEnded, false);

  // Live steer still uses the ongoing turn.
  const steerPromise = service.steerAction(project, created.slug, { text: "Also add migrations", mode: "live" });
  await until(() => piChild.stdinChunks.some(c => c.includes('"type":"steer"')), "steer frame written");
  const steerLine = piChild.stdinChunks.find(c => c.includes('"type":"steer"'));
  const steerFrame = JSON.parse(steerLine);
  assert.equal(steerFrame.type, "steer");
  assert.ok(steerFrame.id, "steer frame includes correlation id");
  assert.ok(steerFrame.message.includes("Also add migrations"));
  piChild.stdout.write(`${JSON.stringify({ id: steerFrame.id, type: "response", command: "steer", success: true })}\n`);
  const steerRes = await steerPromise;
  assert.equal(steerRes.mode, "steered");

  // agent_end closes stdin cleanly
  piChild.stdout.write(`${JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Done with Postgres and migrations." }] } })}\n`);
  piChild.stdout.write(`${JSON.stringify({ type: "agent_end", isTerminal:true, yielded:true })}\n`);
  await until(() => piChild.stdin.writableEnded, "pi stdin closed on agent_end");
  piChild.emit("close", 0);
  await until(() => !service.runs.size && !service.finishing.size, "pi run finished");
  assert.equal(F.parseLine(service.readDoc(project, created.slug)).status, "done");
});

test("OMP silent code-1 exit surfaces ~/.omp/logs error and sweeps finished keeper folders after completion", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-silent-exit-"));
  const stateDir = path.join(root, "state"), docsDir = path.join(root, "docs"), homeDir = path.join(root, "home");
  const script = path.join(root, "omp-crash.cjs");
  fs.mkdirSync(stateDir, { recursive:true });
  fs.mkdirSync(path.join(homeDir, ".omp", "logs"), { recursive:true });
  fs.writeFileSync(script, `
    const fs = require("node:fs");
    const path = require("node:path");
    const readline = require("node:readline");
    const rl = readline.createInterface({ input:process.stdin });
    rl.on("line", line => {
      const msg = JSON.parse(line);
      if (msg.type === "prompt") {
        const logDir = path.join(${JSON.stringify(homeDir)}, ".omp", "logs");
        const date = new Date().toISOString().slice(0, 10);
        fs.writeFileSync(path.join(logDir, "omp." + date + "." + process.pid + ".log"),
          JSON.stringify({ timestamp:new Date().toISOString(), level:"error", pid:process.pid, message:"RPC output delivery failed", error:"Error: ENOSPC: no space left on device, write" }) + "\\n");
        process.exit(1);
      }
    });
  `);
  const fakeAgents = {
    env:{ ...process.env, HOME:homeDir, USERPROFILE:homeDir },
    available:() => [{ id:"omp", available:true, name:"omp" }],
    classifier:() => null,
    command:(_id, opts) => ({ command:process.execPath, args:[script], cwd:opts.workdir, stdin:true, input:"pi-rpc", dialect:"pi", steerMode:"live" }),
  };
  const service = new Service({ directory:stateDir, agents:fakeAgents, autoWatch:false, conversations:{ home:homeDir, env:fakeAgents.env } });
  t.after(() => { service.close(); fs.rmSync(root, { recursive:true, force:true }); });

  const project = service.store.create({ name:"OmpDiag", docsPath:docsDir });
  project.defaultAgent = "omp"; service.store.save();
  const created = await service.createTopic(project, { text:"Trigger crash", agent:"omp", kinds:["ask", "work"], start:true });
  await until(() => F.parseLine(service.readDoc(project, created.slug)).status === "stopped", "OMP work settled as stopped");
  const doc = F.parseLine(service.readDoc(project, created.slug));
  assert.match(doc.front.why, /RPC output delivery failed: Error: ENOSPC: no space left on device, write/);
  const keepRoot = path.join(stateDir, "keep");
  await until(() => !fs.existsSync(keepRoot) || fs.readdirSync(keepRoot).length === 0, "finished keeper folder swept");
});

// =========================================================================
// 4. Claude Code control_request AskUserQuestion & residual permission approval (P1 #1)
// =========================================================================
test("Claude control_request holds AskUserQuestion and residual permission requests for explicit Allow/Deny (never auto-allowing based on preset), and fails closed when unattended", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-ctrl-"));
  const stateDir = path.join(root, "state"), docsDir = path.join(root, "docs");
  fs.mkdirSync(stateDir, { recursive: true });
  let claudeChild = null;
  const fakeAgents = {
    available: () => [{ id: "claude", available: true, name: "Claude Code" }],
    classifier: () => null,
    command: (_id, opts) => ({ command: "claude", args: ["--permission-prompt-tool", "stdio"], cwd: opts.workdir, stdin: true, input: "stream-json", ownInstructions: true, permissionMode: "bypassPermissions", steerMode: "live" }),
  };
  const service = new Service({ directory: stateDir, agents: fakeAgents, autoWatch: false, spawnFn: () => { claudeChild = makeFakeChild(94001); return claudeChild; } });
  t.after(() => { service.runs.clear(); service.close(); fs.rmSync(root, { recursive: true, force: true }); });

  const project = service.store.create({ name: "ClaudeCtrl", docsPath: docsDir });
  project.defaultAgent = "claude"; service.store.save();
  const created = await service.createTopic(project, { text: "Help me decide", agent: "claude", kinds: ["ask", "work"], start: true });
  await until(() => Boolean(claudeChild), "claude child spawned");

  // 1) Residual non-question tool even in bypassPermissions -> MUST NOT auto-allow; held as approval card
  claudeChild.stdout.write(`${JSON.stringify({ type: "control_request", request_id: "perm-1", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "npm test" } } })}\n`);
  await wait(25);
  assert.equal(claudeChild.stdinChunks.some(c => c.includes('"perm-1"')), false, "must NOT auto-allow residual permission request");
  let line = service.stateOf(project).lines.find(l => l.slug === created.slug);
  assert.equal(line.asking.id, "perm-1");
  assert.equal(line.asking.approval, true);
  assert.equal(line.asking.toolName, "Bash");
  assert.ok(line.asking.toolInput.includes("npm test"));

  // Explicit Allow sends allow
  await service.answer(project, created.slug, "approve-perm-1", "allow", { requestId: "perm-1" });
  const allowMsg = JSON.parse(claudeChild.stdinChunks.find(c => c.includes('"perm-1"')));
  assert.equal(allowMsg.type, "control_response");
  assert.equal(allowMsg.response.response.behavior, "allow");

  // 2) Explicit Deny sends deny
  claudeChild.stdout.write(`${JSON.stringify({ type: "control_request", request_id: "perm-2", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "rm -rf /tmp/x" } } })}\n`);
  await wait(25);
  assert.equal(claudeChild.stdinChunks.some(c => c.includes('"perm-2"')), false, "held until user decides");
  await service.answer(project, created.slug, "approve-perm-2", "deny", { requestId: "perm-2" });
  const denyMsg = JSON.parse(claudeChild.stdinChunks.find(c => c.includes('"perm-2"')));
  assert.equal(denyMsg.response.response.behavior, "deny");

  // 3) Unattended run -> fails closed immediately (deny)
  const run = service.runs.get(service.key(project, created.slug));
  run.unattended = true;
  claudeChild.stdout.write(`${JSON.stringify({ type: "control_request", request_id: "perm-3", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "echo hi" } } })}\n`);
  await wait(25);
  const unattendedDeny = JSON.parse(claudeChild.stdinChunks.find(c => c.includes('"perm-3"')));
  assert.equal(unattendedDeny.response.response.behavior, "deny");
  run.unattended = false;

  // 4) AskUserQuestion -> held open as run.asking, answered via service.answer()
  claudeChild.stdout.write(`${JSON.stringify({ type: "control_request", request_id: "auq-1", request: { subtype: "can_use_tool", tool_name: "AskUserQuestion", input: { questions: [{ question: "Target env?", options: [{ label: "Staging" }, { label: "Prod" }] }] } } })}\n`);
  await wait(25);
  line = service.stateOf(project).lines.find(l => l.slug === created.slug);
  assert.equal(line.asking.kind, "tool");
  assert.equal(line.asking.answerable, true);
  assert.equal(line.asking.id, "auq-1");

  await service.answer(project, created.slug, "Target env?", "Staging", { requestId: "auq-1" });
  const auqReply = JSON.parse(claudeChild.stdinChunks.find(c => c.includes('"auq-1"')));
  assert.equal(auqReply.response.response.behavior, "allow");
  assert.deepEqual(auqReply.response.response.updatedInput.answers, { "Target env?": "Staging" });

  // 5) Live userLine steering still works
  const steered = await service.steerAction(project, created.slug, { text: "Keep it brief", mode: "live" });
  assert.equal(steered.mode, "steered");
  assert.ok(claudeChild.stdinChunks.some(c => c.includes('"type":"user"') && c.includes("Keep it brief")));

  claudeChild.stdout.write(`${JSON.stringify({ type: "result", session_id: "cl-1", is_error: false })}\n`);
  await until(() => claudeChild.stdin.writableEnded, "claude stdin closed");
  claudeChild.emit("close", 0);
});

// =========================================================================
// 5. Interrupt-and-resume steer fallback (dsh) & HTTP /act/steer + /act/answer
// =========================================================================
test("interrupt-resume steer fallback cleanly stops dsh run and resumes its session with user steer; HTTP /steer, /act/steer, /answer, /act/answer work", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-steer-"));
  const stateDir = path.join(root, "state"), docsDir = path.join(root, "docs");
  fs.mkdirSync(stateDir, { recursive: true });
  const spawned = [];
  const resumeSeen = [];
  const fakeAgents = {
    available: () => [{ id: "dsh", available: true, name: "dsh" }],
    nameOf: () => "dsh",
    classifier: () => null,
    command: (_id, opts) => {
      resumeSeen.push(opts.resume || null);
      return { command: "dsh", args: ["--profile", "headless", "--json", ...(opts.resume ? ["--session-id", opts.resume] : [])], cwd: opts.workdir, stdin: true, dialect: "dsh", steerMode: "interrupt-resume" };
    },
  };
  const readJson = async req => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  };
  const send = (res, status, data) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(data));
  };
  const api = createProjectLines({
    directory: stateDir,
    agents: fakeAgents,
    authorizeRead: () => null,
    authorizeWrite: () => null,
    readJson,
    send,
    serviceOptions: {
      autoWatch: false,
      recoverOnStart: false,
      spawnFn: () => { const c = makeFakeChild(95000 + spawned.length); spawned.push(c); return c; },
    },
  });
  const service = api.service;
  service.stopTree = async child => { child.kill(); };
  t.after(() => { service.runs.clear(); api.close(); fs.rmSync(root, { recursive: true, force: true }); });

  const project = service.store.create({ name: "DshSteer", docsPath: docsDir });
  project.defaultAgent = "dsh"; service.store.save();
  const created = await service.createTopic(project, { text: "Initial task", agent: "dsh", kinds: ["ask", "work"], start: true });
  await until(() => spawned.length === 1, "first dsh run spawned");

  spawned[0].stdout.write(`${JSON.stringify({ type: "session", sessionId: "dsh-sess-42" })}\n`);
  await wait(25);

  const lineBefore = service.stateOf(project).lines.find(l => l.slug === created.slug);
  assert.equal(lineBefore.runSteers, false);
  assert.equal(lineBefore.runSteerMode, "interrupt-resume");

  // Call via HTTP POST /api/lines/projects/:id/topics/:slug/act/steer
  const srv = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      const handled = await api.handle(req, res, url);
      if (!handled && !res.headersSent) { res.writeHead(404); res.end(); }
    } catch (err) {
      if (!res.headersSent) { res.writeHead(500); res.end(String(err.message)); }
    }
  });
  await new Promise(resolve => srv.listen(0, "127.0.0.1", resolve));
  t.after(() => srv.close());
  const port = srv.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/api/lines/projects/${encodeURIComponent(project.id)}/topics/${encodeURIComponent(created.slug)}/act/steer`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: `http://127.0.0.1:${port}` },
    body: JSON.stringify({ text: "Switch to TypeScript", mode: "interrupt-resume" }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.mode, "continued");

  await until(() => spawned.length === 2, "second resumed dsh run spawned");
  assert.equal(resumeSeen[1], "dsh-sess-42", "continuation resumed dsh sessionId");
  assert.ok(spawned[1].stdinChunks.join("").includes("Switch to TypeScript"), "continuation prompt carries steered message");

  // Finish Work 2
  spawned[1].stdout.write(`${JSON.stringify({ type: "text", text: "Switched to TypeScript." })}\n`);
  spawned[1].emit("close", 0);
  await until(() => !service.runs.size && !service.finishing.size, "resumed run finished");

  const doc = F.parseLine(service.readDoc(project, created.slug));
  assert.equal(doc.status, "done", "line finishes cleanly, not marked broken failure");
  assert.equal(doc.steps.find(s => s.id === "work-1")?.off || "", "", "Work 1 not marked stopped/error");
});

// =========================================================================
// 6. service.answer() on held run (Markdown ## Questions for you)
// =========================================================================
test("service.answer() steers decision directly into a live held run for Markdown Questions for you", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "held-answer-"));
  const stateDir = path.join(root, "state"), docsDir = path.join(root, "docs");
  fs.mkdirSync(stateDir, { recursive: true });
  let child = null;
  const fakeAgents = {
    available: () => [{ id: "antigravity", available: true, name: "Antigravity" }],
    classifier: () => null,
    command: (_id, opts) => ({ command: "agy", args: [], cwd: opts.workdir, stdin: true, input: "stream-json", dialect: "antigravity", steerMode: "live" }),
  };
  const service = new Service({ directory: stateDir, agents: fakeAgents, autoWatch: false, spawnFn: () => { child = makeFakeChild(96001); return child; } });
  t.after(() => { service.runs.clear(); service.close(); fs.rmSync(root, { recursive: true, force: true }); });

  const project = service.store.create({ name: "HeldAns", docsPath: docsDir });
  project.defaultAgent = "antigravity"; service.store.save();
  const created = await service.createTopic(project, { text: "Pick color", agent: "antigravity", kinds: ["ask", "work"], start: true });
  await until(() => Boolean(child), "child spawned");

  let md = service.readDoc(project, created.slug);
  md = F.setAbove(md, F.QUESTIONS, F.renderQuestions([{ from: "antigravity", text: "Which color?", options: ["Teal", "Amber"] }]));
  md = F.setFront(md, { status: "waiting", why: "Pick color" });
  service.writeDoc(project, created.slug, md);

  service.runs.get(service.key(project, created.slug)).modelActivityAt = Date.now();
  const q = F.parseLine(service.readDoc(project, created.slug)).questions[0];
  const res = await service.answer(project, created.slug, q.id, "Teal");
  assert.equal(res.steered, true, "steered decision directly into held live run");
  assert.ok(child.stdinChunks.some(c => c.includes("The person decided: Which color? Teal")));
  const updated = F.parseLine(service.readDoc(project, created.slug));
  assert.equal(updated.status, "working");
  assert.equal(updated.questions.length, 0);
  assert.equal(updated.decided[0].answer, "Teal");
  child.emit("close", 0);
});

// =========================================================================
// 7. UI DOM tests: interactive .q-card & state-aware Steer dock composer
// =========================================================================
test("UI renders interactive .q-card (single-select, multi-select, inline custom reply), calm amber Waiting on you badge, and state-aware Steer dock composer", async () => {
  const { document, window } = parseHTML('<html><body><div id="view"></div></body></html>');
  const read = name => fs.readFileSync(path.join(__dirname, "../public/lines", name + ".js"), "utf8");
  const requests = [], toasts = [];
  const c = vm.createContext({
    document, window, console, navigator: { platform: "Mac" }, location: { hash: "#p/line/one" },
    ACT: {}, SEND: {}, HOSTED: false, EMBED: null, STATE_COLOR: {}, LINE_STATUS: require("../public/lines/line-status.js"),
    localStorage: { getItem: () => null }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    addEventListener() {}, requestAnimationFrame: fn => fn(), getComputedStyle: () => ({ lineHeight: "22px", paddingTop: "6px", paddingBottom: "6px" }),
    $: (sel, root = document) => root.querySelector(sel), $$: (sel, root = document) => [...root.querySelectorAll(sel)],
    esc: s => String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])),
    ic: () => "", av: () => "", reducedMotion: () => true, toast: msg => toasts.push(msg), nowWhen: () => "2026-11-21 04:00",
    detectPath: () => ({ kind: "line" }), can: () => true, openMenu: (el, items) => { c._lastMenu = items; },
    availableAgents: () => [{ id: "codex", name: "Codex", available: true }, { id: "dsh", name: "dsh", available: true }],
    agentInfo: id => ({ id, name: id === "codex" ? "Codex" : id === "dsh" ? "dsh" : id, color: "#333", mono: "Cx" }),
    openQuestions: l => (l.questions || []),
    canStop: l => Boolean(l.running),
    nodeIcon: () => "<svg class='spin'></svg>",
    inlineSay: s => String(s || ""),
    workSubHTML: () => "",
    outputsHTML: () => "",
    canvasPages: () => [],
    fileEntry: () => null,
    isReviewed: () => false,
    carryWork: () => null,
    resendWork: () => null,
    isQueued: () => false,
    ratingBadge: () => "",
    orchRatingBadge: () => "",
    reviewMark: () => "",
    currentStation: l => l.stations[0] || {},
    lineState: l => (l.asking ? "wait" : l.running ? "working" : "done"),
    loadState: async () => {},
    refreshAfterChange: () => {},
    readOpenedLine: () => {},
    loadProjects: async () => [],
    renderRail: () => {},
    withFinishedStop: () => {},
    settleEnd: () => {},
    refreshBehind: () => {},
    scrollToItem: () => {},
    routeToHash: () => "",
    embedCanvas: () => ({}),
    embedCanvasReady: async () => null,
  });
  const run = code => vm.runInContext(code, c);
  run(read("state"));
  run(read("composer"));
  run(read("line"));

  const S = run("S");
  S.cur = "p";
  S.route = { view: "line", line: "one" };
  S.agents = [{ id: "codex", name: "Codex", available: true }, { id: "dsh", name: "dsh", available: true }];
  c.loadState = async () => {};
  c.refreshAfterChange = () => {};
  c.api = async (url, opts = {}) => {
    requests.push({ url, method: opts.method, body: opts.body });
    return { ok: true, mode: opts.body?.mode || "live" };
  };

  // Case A: Live answerable multi-select + single-select tool question
  const liveLine = {
    id: "one", slug: "one", status: "waiting", running: true, runAgent: "codex", runSteers: true, runSteerMode: "live", elsewhere: false,
    asking: {
      kind: "tool", id: "req-1", agent: "codex", step: "work-1", answerable: true,
      questions: [
        { id: "q1", text: "Pick colors", multiSelect: true, options: ["Red", "Blue"] },
        { id: "q2", text: "Ship now?", multiSelect: false, options: ["Yes", "No"] },
      ],
    },
    questions: [],
    stations: [{ id: "work-1", index: 0, kind: "work", label: "Work 1", state: "wait", asked: true, agent: "codex", pictures: [], files: [], refers: [] }],
  };
  S.data.p = { id: "p", lines: [liveLine], landed: [], backlog: [] };

  const cardHtml = c.askedHTML(liveLine);
  assert.ok(cardHtml.includes("is-answerable"), "answerable tool card is interactive");
  assert.ok(cardHtml.includes("is-multi-q"), "multi-question card groups all questions");
  assert.ok(cardHtml.includes('type="checkbox"'), "multiSelect renders checkboxes");
  assert.ok(cardHtml.includes('data-act="answer-tool-all"'), "multi-question card renders unified Submit answers button");
  assert.ok(cardHtml.includes('data-act="pick-tool-opt"'), "multi-question single-select renders toggleable option pills");
  assert.ok(cardHtml.includes('class="q-input"'), "inline custom reply input is rendered");
  assert.ok(!cardHtml.includes("Answer in "), "does not show external Answer in <App> for answerable local run");

  // Single-question single-select stays 1-click
  const singleQLine = { ...liveLine, asking: { ...liveLine.asking, questions: [{ id: "q2", text: "Ship now?", multiSelect: false, options: ["Yes", "No"] }] } };
  assert.ok(c.askedHTML(singleQLine).includes('data-act="answer-tool"'), "single-question single-select renders 1-click option pills");

  // Work card shows calm amber "Waiting on you" instead of spinner, and Line thread never renders .q-card
  const workHtml = c.workItem(S.data.p, liveLine, liveLine.stations[0]);
  assert.ok(workHtml.includes("Waiting on you"), "shows calm amber Waiting on you badge");
  assert.ok(workHtml.includes("nd st-wait"), "uses calm amber wait dot");
  assert.ok(!workHtml.includes("class='spin'"), "no working spinner when waiting on user");
  assert.equal(c.questionsHTML(S.data.p, liveLine), "", "Line page never renders .q-card");

  // Case B: Unowned external followed conversation keeps read-only list + Answer in <App> inside job detail panel
  const extLine = {
    ...liveLine, elsewhere: true, runSteers: false, runSteerMode: "none",
    conversation: { agent: "codex", canOpen: true, app: "Codex" },
    asking: { kind: "tool", agent: "codex", step: "work-1", answerable: false, questions: [{ text: "Continue?", options: ["Yes"] }] },
  };
  const extHtml = c.askedHTML(extLine);
  assert.ok(extHtml.includes("Answer in Codex"), "unowned external run keeps Answer in <App>");
  assert.ok(!extHtml.includes('data-act="answer-tool"'), "unowned external run stays read-only");
  assert.equal(c.boxWords(extLine), "To answer Codex, use the button above.");

  // Case C: Req 1 — Bottom dock composer is ALWAYS ONLY Send to AI / Save as note even when running & asking
  const compFn = run("comp");
  document.getElementById("view").innerHTML = c.composerHTML("conv-p-one", { placeholder: c.boxWords(liveLine), preview: true, on: "step", topic: "one" });
  const form = document.querySelector(".composer");
  c.renderPathPreview(form, compFn(form.dataset.comp));
  assert.ok(form.innerHTML.includes("<span>Send to AI</span>"), "dock composer stays Send to AI on running/asking line");
  assert.ok(!form.innerHTML.includes("is-steer") && !form.innerHTML.includes("is-waiting"), "no is-steer or is-waiting styling on dock composer");
  assert.equal(form.dataset.steerMode || "", "", "form.dataset.steerMode is never set");
  assert.equal(c.boxWords(liveLine), "Add to this line. Type / for quick starts.");

  // Split menu ALWAYS offers ONLY Send to AI and Save as note
  const pickBtn = form.querySelector(".send-pick");
  c.ACT["cmp-send-pick"](pickBtn);
  assert.deepEqual(Array.from(c._lastMenu, i => i.label), ["Send to AI", "Save as note"]);

  // Case D: interrupt-resume runner (dsh) also stays Send to AI with Send to AI / Save as note menu
  liveLine.runAgent = "dsh";
  liveLine.runSteers = false;
  liveLine.runSteerMode = "interrupt-resume";
  liveLine.asking = null;
  c.renderPathPreview(form, compFn(form.dataset.comp));
  assert.ok(form.innerHTML.includes("<span>Send to AI</span>"));
  assert.equal(form.dataset.steerMode || "", "");
  c.ACT["cmp-send-pick"](form.querySelector(".send-pick"));
  assert.deepEqual(Array.from(c._lastMenu, i => i.label), ["Send to AI", "Save as note"]);

  // Case E: idle line still shows Send to AI, and Save as note mode works
  liveLine.running = false;
  liveLine.runSteerMode = "none";
  c.renderPathPreview(form, compFn(form.dataset.comp));
  assert.ok(form.innerHTML.includes("<span>Send to AI</span>"), "idle line keeps Send to AI");
  assert.equal(form.dataset.steerMode || "", "");
  assert.equal(c.boxSends(form, compFn(form.dataset.comp), S.data.p, { kind: "line" }).mode, "send");
});

// =========================================================================
// 8. P1 #2: Codex isSecret preservation, keeper fail-closed & plaintext suppression
// =========================================================================
test("P1 #2: Codex isSecret fails closed on keeper disk runs and masks/suppresses plaintext on in-memory stdio", async t => {
  const { richQuestionsOf } = require("../src/server/project-lines/activity.js");
  const norm = richQuestionsOf({ questions: [{ id: "tok", question: "API token?", isSecret: true }] });
  assert.equal(norm[0].isSecret, true, "richQuestionsOf preserves isSecret");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-secret-"));
  const stateDir = path.join(root, "state"), docsDir = path.join(root, "docs");
  fs.mkdirSync(stateDir, { recursive: true });
  let codexChild = null;
  let markKept = false;
  const fakeAgents = {
    available: () => [{ id: "codex", available: true, name: "Codex" }],
    classifier: () => null,
    command: (_id, opts) => ({ command: "codex", args: ["app-server"], cwd: opts.workdir, protocol: "app-server", thread: {}, turn: {}, steerMode: "live" }),
  };
  const service = new Service({
    directory: stateDir,
    agents: fakeAgents,
    autoWatch: false,
    spawnFn: () => {
      codexChild = makeFakeChild(97001);
      if (markKept) codexChild.kept = true;
      const origWrite = codexChild.stdin.write.bind(codexChild.stdin);
      codexChild.stdin.write = (chunk, ...rest) => {
        const res = origWrite(chunk, ...rest);
        for (const raw of String(chunk).split("\n")) {
          if (!raw.trim()) continue;
          let msg; try { msg = JSON.parse(raw); } catch { continue; }
          if (msg.method === "initialize") setImmediate(() => codexChild.stdout.write(`${JSON.stringify({ id: msg.id, result: {} })}\n`));
          if (msg.method === "thread/start") setImmediate(() => codexChild.stdout.write(`${JSON.stringify({ id: msg.id, result: { thread: { id: "th-sec-1" } } })}\n`));
          if (msg.method === "turn/start") setImmediate(() => codexChild.stdout.write(`${JSON.stringify({ id: msg.id, result: { turn: { id: "turn-sec-1" } } })}\n`));
        }
        return res;
      };
      return codexChild;
    },
  });
  t.after(() => { service.runs.clear(); service.close(); fs.rmSync(root, { recursive: true, force: true }); });

  const project = service.store.create({ name: "CodexSec", docsPath: docsDir });
  project.defaultAgent = "codex"; service.store.save();
  const created = await service.createTopic(project, { text: "Deploy", agent: "codex", kinds: ["ask", "work"], start: true });
  await until(() => Boolean(codexChild) && codexChild.stdinChunks.some(c => c.includes("turn/start")), "codex turn started");

  // Case A: direct in-memory stdio -> held open, answer sent to Codex, plaintext suppressed from activity & Line
  codexChild.stdout.write(`${JSON.stringify({ id: 501, method: "item/tool/requestUserInput", params: { questions: [{ id: "api_key", question: "Enter secret key", isSecret: true }] } })}\n`);
  await wait(30);
  const line = service.stateOf(project).lines.find(l => l.slug === created.slug);
  assert.equal(line.asking.isSecret, true);
  assert.equal(line.asking.questions[0].isSecret, true);

  const secretVal = "sk-super-secret-9999";
  await service.answer(project, created.slug, "api_key", secretVal, { requestId: "501" });
  assert.ok(codexChild.stdinChunks.some(c => c.includes(secretVal)), "secret sent directly to Codex stdio");
  const actRows = service.activity.load(project, created.slug).rows;
  assert.equal(JSON.stringify(actRows).includes(secretVal), false, "secret NEVER stored in activity log");
  assert.equal(service.readDoc(project, created.slug).includes(secretVal), false, "secret NEVER stored in Line Markdown");

  // Case B: keeper-backed disk run -> fails closed immediately
  const run = service.runs.get(service.key(project, created.slug));
  run.child.kept = true;
  run.child.detach = () => {};
  codexChild.stdout.write(`${JSON.stringify({ id: 502, method: "item/tool/requestUserInput", params: { questions: [{ id: "api_key_2", question: "Enter token", isSecret: true }] } })}\n`);
  await wait(30);
  const closedReply = codexChild.stdinChunks.find(c => c.includes('"id":502'));
  assert.ok(closedReply, "keeper-backed secret request immediately replied fail-closed");
  assert.deepEqual(JSON.parse(closedReply), { id: 502, result: { answers: { api_key_2: { answers: [] } } } });
  assert.equal(run.asking, null, "not held open on keeper disk run");
  assert.ok(service.activity.load(project, created.slug).rows.some(r => /logs stdin to disk/i.test(r.text || "")), "explains fail-closed reason");
  codexChild.emit("close", 0);
});

// =========================================================================
// 9. P1 #3: mode:"queue" NEVER writes to active child stdin and queues distinct Work
// =========================================================================
test("P1 #3: steerAction mode:'queue' writes zero bytes to active child stdin and queues a distinct follow-up Work", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "queue-nosteer-"));
  const stateDir = path.join(root, "state"), docsDir = path.join(root, "docs");
  fs.mkdirSync(stateDir, { recursive: true });
  let child = null;
  const fakeAgents = {
    available: () => [{ id: "claude", available: true, name: "Claude Code" }],
    classifier: () => null,
    command: (_id, opts) => ({ command: "claude", args: [], cwd: opts.workdir, stdin: true, input: "stream-json", steerMode: "live" }),
  };
  const service = new Service({ directory: stateDir, agents: fakeAgents, autoWatch: false, spawnFn: () => { child = makeFakeChild(97101); return child; } });
  t.after(() => { service.runs.clear(); service.close(); fs.rmSync(root, { recursive: true, force: true }); });

  const project = service.store.create({ name: "QueueOnly", docsPath: docsDir });
  project.defaultAgent = "claude"; service.store.save();
  const created = await service.createTopic(project, { text: "First task", agent: "claude", kinds: ["ask", "work"], start: true });
  await until(() => Boolean(child), "child spawned");
  const chunksBefore = child.stdinChunks.length;

  const res = await service.steerAction(project, created.slug, { text: "Run this after", mode: "queue" });
  assert.equal(res.ok, true);
  assert.equal(res.mode, "queued");
  assert.equal(child.stdinChunks.length, chunksBefore, "ZERO bytes written to active child stdin");

  const doc = F.parseLine(service.readDoc(project, created.slug));
  const queuedAsk = doc.steps.find(s => s.kind === "ask" && s.text.includes("Run this after"));
  assert.ok(queuedAsk, "queued Ask written to Line");
  const works = doc.steps.filter(s => s.kind === "work");
  assert.equal(works.length, 2, "distinct subsequent Work queued behind active Work");
  child.emit("close", 0);
});

// =========================================================================
// 10. P1 #4: Multiple simultaneous pending requests, stale requestId -> 409, parallel lane routing
// =========================================================================
test("P1 #4: pending requests indexed by requestId across primary & parallel lanes; stale requestId returns 409 and never falls through to Markdown", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reqid-map-"));
  const stateDir = path.join(root, "state"), docsDir = path.join(root, "docs");
  fs.mkdirSync(stateDir, { recursive: true });
  const children = [];
  const fakeAgents = {
    available: () => [{ id: "pi", available: true, name: "Pi" }],
    classifier: () => null,
    command: (_id, opts) => ({ command: "pi", args: ["--mode", "rpc"], cwd: opts.workdir, stdin: true, input: "pi-rpc", dialect: "pi", steerMode: "live" }),
  };
  const service = new Service({ directory: stateDir, agents: fakeAgents, autoWatch: false, spawnFn: () => { const c = makeFakeChild(97200 + children.length); children.push(c); return c; } });
  t.after(() => { service.runs.clear(); service.lanes.clear(); service.close(); fs.rmSync(root, { recursive: true, force: true }); });

  const project = service.store.create({ name: "ReqMap", docsPath: docsDir });
  project.defaultAgent = "pi"; service.store.save();
  const created = await service.createTopic(project, { text: "Multi req", agent: "pi", kinds: ["ask", "work"], start: true });
  await until(() => children.length === 1, "primary spawned");

  // Also add an open Markdown question to ensure stale requestId NEVER falls through to it
  let md = service.readDoc(project, created.slug);
  md = F.setAbove(md, F.QUESTIONS, F.renderQuestions([{ from: "pi", text: "Markdown Q?", options: ["M1", "M2"] }]));
  service.writeDoc(project, created.slug, md);

  // Two simultaneous requests A and B on primary run
  children[0].stdout.write(`${JSON.stringify({ type: "extension_ui_request", id: "req-A", method: "select", title: "Pick A", options: ["A1", "A2"] })}\n`);
  children[0].stdout.write(`${JSON.stringify({ type: "extension_ui_request", id: "req-B", method: "select", title: "Pick B", options: ["B1", "B2"] })}\n`);
  await wait(30);

  // Answer B first, then A — neither overwrote the other!
  await service.answer(project, created.slug, "req-B", "B2", { requestId: "req-B" });
  await service.answer(project, created.slug, "req-A", "A1", { requestId: "req-A" });
  assert.ok(children[0].stdinChunks.some(c => c.includes('"id":"req-B"') && c.includes('"value":"B2"')));
  assert.ok(children[0].stdinChunks.some(c => c.includes('"id":"req-A"') && c.includes('"value":"A1"')));

  // Stale requestId A submitted again -> HTTP 409, Markdown question untouched!
  await assert.rejects(
    () => service.answer(project, created.slug, "Markdown Q?", "M1", { requestId: "req-A" }),
    err => err.status === 409 && err.code === "STALE_REQUEST"
  );
  assert.equal(F.parseLine(service.readDoc(project, created.slug)).questions.length, 1, "Markdown question was NOT answered by stale requestId");

  // Parallel lane asking while primary is NOT asking
  const laneChild = makeFakeChild(97299);
  const key = service.key(project, created.slug);
  const laneRun = { agent: "pi", stepId: "work-2", lane: true, child: laneChild, pendingRequests: new Map(), place: { project, slug: created.slug } };
  service.lanes.set(key, new Map([["work-2", laneRun]]));
  service.handlePiAsking(project, created.slug, laneRun, { id: "lane-req-1", method: "input", rowId: "ui-lane-req-1", questions: [{ id: "lane-req-1", text: "Lane Q?", options: [] }] });
  const laneAns = await service.answer(project, created.slug, "lane-req-1", "Lane answer", { requestId: "lane-req-1" });
  assert.equal(laneAns.answered, "tool");
  assert.ok(laneChild.stdinChunks.some(c => c.includes('"id":"lane-req-1"') && c.includes('"value":"Lane answer"')));
  children[0].emit("close", 0);
});

// =========================================================================
// 11. P1 #5: Multi-question validation, original Claude keys/values, and UI draft submission
// =========================================================================
test("P1 #5: multi-question requests preserve original keys/values, reject incomplete single answers, and submit complete map from UI", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "multi-q-"));
  const stateDir = path.join(root, "state"), docsDir = path.join(root, "docs");
  fs.mkdirSync(stateDir, { recursive: true });
  let claudeChild = null;
  const fakeAgents = {
    available: () => [{ id: "claude", available: true, name: "Claude Code" }],
    classifier: () => null,
    command: (_id, opts) => ({ command: "claude", args: [], cwd: opts.workdir, stdin: true, input: "stream-json", steerMode: "live" }),
  };
  const service = new Service({ directory: stateDir, agents: fakeAgents, autoWatch: false, spawnFn: () => { claudeChild = makeFakeChild(97301); return claudeChild; } });
  t.after(() => { service.runs.clear(); service.close(); fs.rmSync(root, { recursive: true, force: true }); });

  const project = service.store.create({ name: "MultiQ", docsPath: docsDir });
  project.defaultAgent = "claude"; service.store.save();
  const created = await service.createTopic(project, { text: "Configure", agent: "claude", kinds: ["ask", "work"], start: true });
  await until(() => Boolean(claudeChild), "claude spawned");

  const longKey = "Target environment?\n(choose carefully)";
  claudeChild.stdout.write(`${JSON.stringify({
    type: "control_request",
    request_id: "mq-1",
    request: {
      subtype: "can_use_tool",
      tool_name: "AskUserQuestion",
      input: {
        questions: [
          { id: "env", question: longKey, options: [{ label: "Staging env", value: "staging_v2" }, { label: "Prod env", value: "prod_v2" }] },
          { id: "checks", question: "Which checks?", multiSelect: true, options: [{ label: "Lint" }, { label: "Unit" }] },
        ],
      },
    },
  })}\n`);
  await wait(30);

  // Partial single-question submission must be rejected (400), NOT close the whole request!
  await assert.rejects(
    () => service.answer(project, created.slug, "env", "Staging env", { requestId: "mq-1" }),
    err => err.status === 400 && err.code === "INCOMPLETE_ANSWERS"
  );
  assert.equal(claudeChild.stdinChunks.some(c => c.includes('"mq-1"')), false, "incomplete answer did not close request");

  // Complete answer map preserves original Claude multiline key and option value
  await service.answer(project, created.slug, "", "", { requestId: "mq-1", answers: { env: "Staging env", checks: ["Lint", "Unit"] } });
  const reply = JSON.parse(claudeChild.stdinChunks.find(c => c.includes('"mq-1"')));
  assert.deepEqual(reply.response.response.updatedInput.answers, { [longKey]: "staging_v2", "Which checks?": "Lint, Unit" });
  claudeChild.emit("close", 0);
});

// =========================================================================
// 12. P1 #6: Restart/reattach preserves live questions & rpcStreaming without replaying answered requests
// =========================================================================
test("P1 #6: keeper detach+reattach restores pending live question & rpcStreaming before answer, and does not replay after answer", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reattach-q-"));
  const stateDir = path.join(root, "state"), docsDir = path.join(root, "docs");
  const keepDir = path.join(stateDir, "kept", "pi-reattach-1");
  fs.mkdirSync(keepDir, { recursive: true });
  fs.writeFileSync(path.join(keepDir, "spec.json"), JSON.stringify({ command: "pi" }));
  fs.writeFileSync(path.join(keepDir, "pid.json"), JSON.stringify({ agent: process.pid, keeper: process.pid }));
  fs.writeFileSync(path.join(keepDir, "out"), "");
  fs.writeFileSync(path.join(keepDir, "err"), "");

  const fakeAgents = {
    available: () => [{ id: "pi", available: true, name: "Pi" }],
    classifier: () => null,
    command: (_id, opts) => ({ command: "pi", args: ["--mode", "rpc"], cwd: opts.workdir, stdin: true, input: "pi-rpc", dialect: "pi", steerMode: "live" }),
  };

  // Service 1: receives agent_start + extension_ui_request, checkpoints run.json, detaches BEFORE answer
  const s1 = new Service({ directory: stateDir, agents: fakeAgents, autoWatch: false, recoverOnStart: false });
  t.after(() => { s1.runs.clear(); s1.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const project = s1.store.create({ name: "ReattachQ", docsPath: docsDir });
  project.defaultAgent = "pi"; s1.store.save();
  const created = await s1.createTopic(project, { text: "Do work", agent: "pi", kinds: ["ask", "work"], start: false });
  const doc = F.parseLine(s1.readDoc(project, created.slug));
  const workStep = doc.steps.find(s => s.kind === "work");

  const fakeKeptChild = makeFakeChild(process.pid);
  fakeKeptChild.kept = true;
  fakeKeptChild.dir = keepDir;
  fakeKeptChild.offsets = { out: 120, err: 0 };
  const run1 = {
    agent: "pi", dialect: "pi", step: workStep.index, stepId: workStep.id, kind: "work",
    started: Date.now(), log: path.join(keepDir, "run.log"), workdir: docsDir,
    keepDir, keepMode: { input: "pi-rpc", streaming: true }, child: fakeKeptChild,
    pendingRequests: new Map(), place: { project, slug: created.slug },
  };
  s1.runs.set(s1.key(project, created.slug), run1);
  s1.agentSaid(project, created.slug, run1, JSON.stringify({ type: "agent_start" }));
  s1.agentSaid(project, created.slug, run1, JSON.stringify({ type: "extension_ui_request", id: "q-keep-1", method: "select", title: "Choose", options: ["One", "Two"] }));
  s1.keepNote(project, created.slug, run1, true, { strict: true });

  const savedJson = JSON.parse(fs.readFileSync(path.join(keepDir, "run.json"), "utf8"));
  assert.equal(savedJson.fields.rpcStreaming, true, "rpcStreaming persisted in run.json");
  assert.equal(savedJson.fields.pendingToolRequests?.length, 1, "pending question persisted in run.json");

  // Detach Service 1 and release runtime lock
  s1.runs.clear();
  s1.close();

  // Service 2: reattach BEFORE answer
  const s2 = new Service({ directory: stateDir, agents: fakeAgents, autoWatch: false, recoverOnStart: false });
  t.after(() => { s2.runs.clear(); s2.close(); });
  const ok2 = s2.reattach({ keep: keepDir });
  assert.equal(ok2, true, "reattach succeeded before answer");
  const proj2 = s2.store.get(project.id);
  const run2 = s2.runs.get(s2.key(proj2, created.slug));
  assert.equal(run2.rpcStreaming, true, "rpcStreaming restored on reattach");
  assert.equal(run2.asking?.id, "q-keep-1", "pending question restored on reattach");

  // Answer through Service 2 -> writes extension_ui_response to keeper input file
  const ans2 = await s2.answer(proj2, created.slug, "q-keep-1", "Two", { requestId: "q-keep-1" });
  assert.equal(ans2.answered, "tool");
  const inputAfterAns = fs.readFileSync(path.join(keepDir, "input"), "utf8");
  assert.ok(inputAfterAns.includes('"type":"extension_ui_response"') && inputAfterAns.includes('"id":"q-keep-1"') && inputAfterAns.includes('"value":"Two"'));

  // Mid-turn steer after reattach uses type:"steer" (because rpcStreaming === true)
  const steerP = run2.steer("Keep going");
  await wait(30);
  const inputAfterSteer = fs.readFileSync(path.join(keepDir, "input"), "utf8");
  assert.ok(inputAfterSteer.includes('"type":"steer"'), "reattached Pi steer uses type:'steer', not 'prompt'");
  const steerLine = inputAfterSteer.trim().split("\n").find(l => l.includes('"type":"steer"'));
  run2.child.stdout.emit("data", Buffer.from(`${JSON.stringify({ id: JSON.parse(steerLine).id, type: "response", command: "steer", success: true })}\n`));
  await steerP;

  // Simulate restart AFTER answer was written to input, even with stale run.json still listing q-keep-1
  fs.writeFileSync(path.join(keepDir, "run.json"), JSON.stringify(savedJson));
  run2.child.detach();
  s2.runs.clear();
  s2.close();

  const s3 = new Service({ directory: stateDir, agents: fakeAgents, autoWatch: false, recoverOnStart: false });
  t.after(() => { s3.runs.clear(); s3.close(); });
  const ok3 = s3.reattach({ keep: keepDir });
  assert.equal(ok3, true, "reattach succeeded after answer");
  const proj3 = s3.store.get(project.id);
  const run3 = s3.runs.get(s3.key(proj3, created.slug));
  assert.equal(run3.asking, null, "already-answered request is NOT restored or replayed");
  run3.child.detach();
});

// =========================================================================
// 13. P1 #7: Expired/cancelled questions & Codex isBlocking:false
// =========================================================================
test("P1 #7: Pi timeout/cancel, Claude control_cancel_request, Codex serverRequest/resolved, and isBlocking:false never block completion or watchdog", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cancel-q-"));
  const stateDir = path.join(root, "state"), docsDir = path.join(root, "docs");
  fs.mkdirSync(stateDir, { recursive: true });
  let child = null;
  const fakeAgents = {
    available: () => [{ id: "pi", available: true, name: "Pi" }, { id: "claude", available: true, name: "Claude" }],
    classifier: () => null,
    command: (id, opts) => ({ command: id, args: [], cwd: opts.workdir, stdin: true, input: id === "pi" ? "pi-rpc" : "stream-json", dialect: id === "pi" ? "pi" : "", steerMode: "live" }),
  };
  const service = new Service({ directory: stateDir, agents: fakeAgents, autoWatch: false, spawnFn: () => { child = makeFakeChild(97401); return child; } });
  t.after(() => { service.runs.clear(); service.close(); fs.rmSync(root, { recursive: true, force: true }); });

  const project = service.store.create({ name: "CancelQ", docsPath: docsDir });
  project.defaultAgent = "pi"; service.store.save();
  const created = await service.createTopic(project, { text: "Timeout test", agent: "pi", kinds: ["ask", "work"], start: true });
  await until(() => Boolean(child), "pi spawned");
  const run = service.runs.get(service.key(project, created.slug));

  // Pi dialog with short timeout expires automatically and stops blocking watchdog & agent_end
  child.stdout.write(`${JSON.stringify({ type: "extension_ui_request", id: "pi-t1", method: "confirm", title: "Proceed?", timeout: 40 })}\n`);
  await wait(15);
  assert.equal(service.hasBlockingAsking(run), true);
  await until(() => !service.hasBlockingAsking(run), "pi dialog timed out");
  assert.equal(run.asking, null);

  // Explicit extension_ui_cancel also clears immediately
  child.stdout.write(`${JSON.stringify({ type: "extension_ui_request", id: "pi-c1", method: "input", title: "Name?" })}\n`);
  await wait(15);
  assert.equal(run.asking?.id, "pi-c1");
  child.stdout.write(`${JSON.stringify({ type: "extension_ui_cancel", id: "pi-c1" })}\n`);
  await wait(15);
  assert.equal(run.asking, null);

  // agent_end closes stdin cleanly
  child.stdout.write(`${JSON.stringify({ type: "agent_end" })}\n`);
  await until(() => child.stdin.writableEnded, "stdin closed after cancelled dialog + agent_end");
  child.emit("close", 0);
  await until(() => !service.runs.size, "pi settled");

  // Claude control_cancel_request clears pending request
  const clRun = { agent: "claude", stepId: "work-c", child: makeFakeChild(97402), pendingRequests: new Map(), place: { project, slug: created.slug } };
  service.agentSaid(project, created.slug, clRun, JSON.stringify({ type: "control_request", request_id: "cc-1", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "ls" } } }));
  assert.equal(clRun.asking?.id, "cc-1");
  service.agentSaid(project, created.slug, clRun, JSON.stringify({ type: "control_cancel_request", request_id: "cc-1" }));
  assert.equal(clRun.asking, null);

  // Codex serverRequest/resolved + isBlocking:false
  const cxChild = makeFakeChild(97403);
  const cxRun = { agent: "codex", stepId: "work-x", child: cxChild, pendingRequests: new Map(), place: { project, slug: created.slug } };
  const cxServer = new CodexServer({
    child: cxChild,
    onServerRequest: msg => service.handleCodexServerRequest(project, created.slug, cxRun, cxServer, msg),
    onServerRequestResolved: rid => service.resolvePendingRequest(project, created.slug, cxRun, String(rid), { state: "done", output: "Resolved" }),
  });
  cxChild.stdout.write(`${JSON.stringify({ id: 701, method: "item/tool/requestUserInput", params: { isBlocking: false, questions: [{ id: "nb", question: "Optional note?" }] } })}\n`);
  await wait(25);
  assert.equal(cxRun.asking?.id, "701");
  assert.equal(service.hasBlockingAsking(cxRun), false, "isBlocking:false does NOT block completion or watchdog");
  cxChild.stdout.write(`${JSON.stringify({ method: "serverRequest/resolved", params: { requestId: 701 } })}\n`);
  await wait(25);
  assert.equal(cxRun.asking, null, "serverRequest/resolved clears pending request");
  assert.equal(cxServer.pendingServerRequests.size, 0);
  cxServer.close();
});

// =========================================================================
// 14. P1 #8: Pi preflight rejection, terminal model error preservation, & rejected steer correlation
// =========================================================================
test("P1 #8: Pi prompt rejection closes stdin promptly; message_end(error)+agent_end preserves failure; rejected steer surfaces error", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-err-"));
  const stateDir = path.join(root, "state"), docsDir = path.join(root, "docs");
  fs.mkdirSync(stateDir, { recursive: true });
  const children = [];
  const fakeAgents = {
    available: () => [{ id: "pi", available: true, name: "Pi" }],
    classifier: () => null,
    command: (_id, opts) => ({ command: "pi", args: ["--mode", "rpc"], cwd: opts.workdir, stdin: true, input: "pi-rpc", dialect: "pi", steerMode: "live" }),
  };
  const service = new Service({ directory: stateDir, agents: fakeAgents, autoWatch: false, spawnFn: () => { const c = makeFakeChild(97500 + children.length); children.push(c); return c; } });
  t.after(() => { service.runs.clear(); service.close(); fs.rmSync(root, { recursive: true, force: true }); });

  const project = service.store.create({ name: "PiErr", docsPath: docsDir });
  project.defaultAgent = "pi"; service.store.save();

  // Case A: prompt preflight rejection -> marks failed & closes stdin immediately without waiting for agent_end
  const c1 = await service.createTopic(project, { text: "No creds", agent: "pi", kinds: ["ask", "work"], start: true });
  await until(() => children.length === 1, "child 1 spawned");
  const run1 = service.runs.get(service.key(project, c1.slug));
  children[0].stdout.write(`${JSON.stringify({ id: "init-prompt", type: "response", command: "prompt", success: false, error: "Missing API key" })}\n`);
  await until(() => children[0].stdin.writableEnded, "stdin closed immediately on rejected prompt");
  assert.equal(run1.lastFailed, true);
  assert.ok(run1.failed.includes("Missing API key"));
  children[0].emit("close", 0);
  await until(() => !service.runs.size && !service.finishing.size, "run 1 settled");
  assert.equal(F.parseLine(service.readDoc(project, c1.slug)).status, "stopped", "exit 0 after rejected prompt still settles as stopped/failed");

  // Case B: message_end(stopReason="error") followed by plain agent_end preserves failure; rejected steer rejects promise
  const c2 = await service.createTopic(project, { text: "Model error", agent: "pi", kinds: ["ask", "work"], start: true });
  await until(() => children.length === 2, "child 2 spawned");
  const run2 = service.runs.get(service.key(project, c2.slug));
  children[1].stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  await wait(20);

  const rejectedSteer = run2.steer("Try this");
  await until(() => children[1].stdinChunks.some(x => x.includes('"type":"steer"')), "steer written");
  const sf = JSON.parse(children[1].stdinChunks.find(x => x.includes('"type":"steer"')));
  children[1].stdout.write(`${JSON.stringify({ id: sf.id, type: "response", command: "steer", success: false, error: "Cannot steer now" })}\n`);
  await assert.rejects(() => rejectedSteer, /Cannot steer now/);

  children[1].stdout.write(`${JSON.stringify({ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "Model overloaded" } })}\n`);
  children[1].stdout.write(`${JSON.stringify({ type: "agent_end" })}\n`);
  await until(() => children[1].stdin.writableEnded, "child 2 stdin closed");
  assert.equal(run2.lastFailed, true, "plain agent_end does NOT clear message_end error");
  assert.ok(run2.failed.includes("Model overloaded"));
  children[1].emit("close", 0);
  await until(() => !service.runs.size && !service.finishing.size, "run 2 settled");
  assert.equal(F.parseLine(service.readDoc(project, c2.slug)).status, "stopped");
});

// =========================================================================
// 15. P1 #9: Markdown answer() preserves concurrent edits & schedules continuation even if status was still working
// =========================================================================
test("P1 #9: Markdown answer() re-reads after stopHeldAndWait to preserve concurrent edits and resumes even when status was still working", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "md-race-"));
  const stateDir = path.join(root, "state"), docsDir = path.join(root, "docs");
  fs.mkdirSync(stateDir, { recursive: true });
  const spawned = [];
  const fakeAgents = {
    available: () => [{ id: "dsh", available: true, name: "dsh" }],
    classifier: () => null,
    command: (_id, opts) => ({ command: "dsh", args: ["--json"], cwd: opts.workdir, stdin: true, dialect: "dsh", steerMode: "interrupt-resume" }),
  };
  const service = new Service({ directory: stateDir, agents: fakeAgents, autoWatch: false, spawnFn: () => { const c = makeFakeChild(97600 + spawned.length); spawned.push(c); return c; } });
  t.after(() => { service.runs.clear(); service.close(); fs.rmSync(root, { recursive: true, force: true }); });

  const project = service.store.create({ name: "MdRace", docsPath: docsDir });
  project.defaultAgent = "dsh"; service.store.save();
  const created = await service.createTopic(project, { text: "Ask question", agent: "dsh", kinds: ["ask", "work"], start: true });
  await until(() => spawned.length === 1, "first dsh spawned");

  // Agent writes ## Questions for you while frontmatter status is STILL "working"
  let md = service.readDoc(project, created.slug);
  md = F.setAbove(md, F.QUESTIONS, F.renderQuestions([{ from: "dsh", text: "Keep dark mode?", options: ["Yes", "No"] }]));
  service.writeDoc(project, created.slug, md);
  assert.equal(F.parseLine(service.readDoc(project, created.slug)).status, "working");

  // Inject a concurrent Line edit during stopTree shutdown
  service.stopTree = async child => {
    const cur = service.readDoc(project, created.slug);
    service.writeDoc(project, created.slug, cur + "\n\nConcurrent user note from second tab.\n");
    child.kill();
  };

  service.runs.get(service.key(project, created.slug)).modelActivityAt = Date.now();
  const q = F.parseLine(service.readDoc(project, created.slug)).questions[0];
  const res = await service.answer(project, created.slug, q.id, "Yes");
  assert.equal(res.ok, true);
  await until(() => spawned.length === 2, "continuation Work spawned even though status was still working");

  const finalRaw = service.readDoc(project, created.slug);
  assert.ok(finalRaw.includes("Concurrent user note from second tab."), "concurrent Line edit preserved across stopHeldAndWait");
  const finalDoc = F.parseLine(finalRaw);
  assert.equal(finalDoc.questions.length, 0);
  assert.equal(finalDoc.decided[0].answer, "Yes");
  spawned[1].emit("close", 0);
});

// =========================================================================
// 16. P2 #10: Attachment single-staging on fallback & clean 400 rejection on live tool request
// =========================================================================
test("P2 #10: steerAction rejects attachments on live tool requests before moving files, and stages once on queue fallback", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "attach-once-"));
  const stateDir = path.join(root, "state"), docsDir = path.join(root, "docs");
  fs.mkdirSync(stateDir, { recursive: true });
  let child = null;
  const fakeAgents = {
    available: () => [{ id: "pi", available: true, name: "Pi" }],
    classifier: () => null,
    command: (_id, opts) => ({ command: "pi", args: ["--mode", "rpc"], cwd: opts.workdir, stdin: true, input: "pi-rpc", dialect: "pi", steerMode: "live" }),
  };
  const service = new Service({ directory: stateDir, agents: fakeAgents, autoWatch: false, spawnFn: () => { child = makeFakeChild(97701); return child; } });
  t.after(() => { service.runs.clear(); service.close(); fs.rmSync(root, { recursive: true, force: true }); });

  const project = service.store.create({ name: "AttachOnce", docsPath: docsDir });
  project.defaultAgent = "pi"; service.store.save();
  const created = await service.createTopic(project, { text: "Check file", agent: "pi", kinds: ["ask", "work"], start: true });
  await until(() => Boolean(child), "child spawned");

  // Stage an incoming file
  const incomingRel = "files/_incoming/spec.png";
  const incomingAbs = path.join(docsDir, incomingRel);
  fs.mkdirSync(path.dirname(incomingAbs), { recursive: true });
  fs.writeFileSync(incomingAbs, "PNGDATA");

  // While a live tool prompt is open, attachment is rejected with 400 BEFORE moving the file
  child.stdout.write(`${JSON.stringify({ type: "extension_ui_request", id: "att-q", method: "input", title: "Input?" })}\n`);
  await wait(25);
  await assert.rejects(
    () => service.steerAction(project, created.slug, { text: "See img", attachments: [{ path: incomingRel, name: "spec.png", type: "image/png" }], mode: "live" }),
    err => err.status === 400 && err.code === "UNSUPPORTED_ATTACHMENT"
  );
  assert.equal(fs.existsSync(incomingAbs), true, "staged file was NOT moved on rejected tool-request attachment");

  // Clear tool prompt, close stdin so live steer fails and falls back to queue: file is moved ONCE without ENOENT
  child.stdout.write(`${JSON.stringify({ type: "extension_ui_cancel", id: "att-q" })}\n`);
  await wait(20);
  const run = service.runs.get(service.key(project, created.slug));
  run.inputClosed = true;
  const fbRes = await service.steerAction(project, created.slug, { text: "Queued with img", attachments: [{ path: incomingRel, name: "spec.png", type: "image/png" }], mode: "live" });
  assert.equal(fbRes.ok, true);
  assert.equal(fbRes.mode, "queued");
  assert.equal(fs.existsSync(incomingAbs), false, "staged file moved once into line folder");
  assert.ok(service.readDoc(project, created.slug).includes("spec.png"), "attachment linked in queued Ask");
  child.emit("close", 0);
});

// =========================================================================
// 17. P2 #11, #12, #15: UI DOM tests for Markdown dock Reply, refers/draft preservation, failed answer, parallel Work label, & contrast
// =========================================================================
test("P2 #11, #12, #15: dock Reply settles Markdown question, composer preserves refers & newer drafts, failed answer preserves text, parallel Work label matches asking.step, and contrast >= 4.5:1", async () => {
  const { document, window } = parseHTML('<html><body><div id="view"></div></body></html>');
  const read = name => fs.readFileSync(path.join(__dirname, "../public/lines", name + ".js"), "utf8");
  const requests = [], toasts = [];
  let resolveSteer = null;
  const c = vm.createContext({
    document, window, console, navigator: { platform: "Mac" }, location: { hash: "#p/line/one" },
    CSS: { escape: s => String(s) },
    ACT: {}, SEND: {}, HOSTED: false, EMBED: null, STATE_COLOR: {}, LINE_STATUS: require("../public/lines/line-status.js"),
    localStorage: { getItem: () => null }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    addEventListener() {}, requestAnimationFrame: fn => fn(), getComputedStyle: () => ({ lineHeight: "22px", paddingTop: "6px", paddingBottom: "6px" }),
    $: (sel, root = document) => root.querySelector(sel), $$: (sel, root = document) => [...root.querySelectorAll(sel)],
    esc: s => String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])),
    ic: () => "", av: () => "", reducedMotion: () => true, toast: msg => toasts.push(msg), nowWhen: () => "2026-11-21 04:00",
    detectPath: () => ({ kind: "line" }), can: () => true, openMenu: () => {}, savedId: id => id,
    availableAgents: () => [{ id: "codex", name: "Codex", available: true }],
    agentInfo: id => ({ id, name: "Codex", color: "#333", mono: "Cx" }),
    openQuestions: l => (l.questions || []),
    canStop: l => Boolean(l.running),
    nodeIcon: () => "<svg class='spin'></svg>",
    inlineSay: s => String(s || ""),
    workSubHTML: () => "", outputsHTML: () => "", canvasPages: () => [], fileEntry: () => null,
    isReviewed: () => false, carryWork: () => null, resendWork: () => null, isQueued: () => false,
    ratingBadge: () => "", orchRatingBadge: () => "", reviewMark: () => "",
    currentStation: l => l.stations[0] || {},
    lineState: l => (l.asking ? "wait" : l.running ? "working" : "done"),
    loadState: async () => {}, refreshAfterChange: () => {},
  });
  const run = code => vm.runInContext(code, c);
  run(read("state"));
  run(read("composer"));
  run(read("line"));

  const S = run("S");
  S.cur = "p";
  S.route = { view: "line", line: "one" };
  S.agents = [{ id: "codex", name: "Codex", available: true }];

  // P2 #15: Parallel active Works -> only asking.step gets "Waiting on you"
  const parallelLine = {
    id: "one", slug: "one", status: "waiting", running: true, runAgent: "codex", runSteers: true, runSteerMode: "live", elsewhere: false,
    asking: { kind: "tool", id: "req-p", agent: "codex", step: "work-1", answerable: true, questions: [{ id: "q1", text: "OK?", options: ["Yes"] }] },
    questions: [],
    stations: [
      { id: "work-1", index: 0, kind: "work", label: "Work 1", state: "active", asked: false, agent: "codex", pictures: [], files: [], refers: [] },
      { id: "work-2", index: 1, kind: "work", label: "Work 2", state: "active", asked: false, agent: "codex", pictures: [], files: [], refers: [] },
    ],
  };
  S.data.p = { id: "p", lines: [parallelLine], landed: [], backlog: [] };
  const w1Html = c.workItem(S.data.p, parallelLine, parallelLine.stations[0]);
  const w2Html = c.workItem(S.data.p, parallelLine, parallelLine.stations[1]);
  assert.ok(w1Html.includes("Waiting on you"), "matching asking.step work-1 shows Waiting on you");
  assert.ok(!w2Html.includes("Waiting on you"), "parallel active work-2 does NOT show Waiting on you");
  assert.ok(w2Html.includes("class='spin'"), "parallel active work-2 keeps working spinner");

  // P1 #2 UI: isSecret renders <input type="password" autocomplete="off">
  const secLine = { ...parallelLine, asking: { ...parallelLine.asking, questions: [{ id: "sec", text: "Token?", isSecret: true, options: [] }] } };
  const secHtml = c.askedHTML(secLine);
  assert.ok(secHtml.includes('type="password"') && secHtml.includes('autocomplete="off"'), "isSecret renders password input");

  // P1 #1 UI: approval card renders Allow / Deny and tool input
  const appLine = { ...parallelLine, asking: { kind: "tool", id: "perm-9", agent: "claude", step: "work-1", answerable: true, approval: true, toolName: "Bash", toolInput: "npm test", questions: [{ id: "approve-perm-9", text: "Allow Bash", options: ["Allow", "Deny"] }] } };
  const appHtml = c.askedHTML(appLine);
  assert.ok(appHtml.includes("is-approval") && appHtml.includes("npm test") && appHtml.includes("Allow") && appHtml.includes("Deny"));

  // P2 #11: Req 1 keeps dock composer ALWAYS Send to AI while job detail chooser routes through /answer
  const mdLine = {
    ...parallelLine,
    asking: { kind: "topic", agent: "codex", step: "work-1", answerable: true, questions: [{ text: "Ship?", options: ["Yes", "No"] }] },
    questions: [{ id: "q-md-1", workId: "work-1", from: "codex", text: "Ship?", options: ["Yes", "No"] }],
    stations: [
      { id: "work-1", index: 0, kind: "work", label: "Work 1", state: "wait", asked: false, agent: "codex", questions: [{ id: "q-md-1", workId: "work-1", from: "codex", text: "Ship?", options: ["Yes", "No"] }], pictures: [], files: [], refers: [] },
      parallelLine.stations[1],
    ],
  };
  S.data.p.lines = [mdLine];
  const compFn = run("comp");
  document.getElementById("view").innerHTML = c.composerHTML("conv-p-one", { placeholder: "Reply", preview: true, on: "step", topic: "one" });
  const form = document.querySelector(".composer");
  const box = compFn(form.dataset.comp);
  c.renderPathPreview(form, box);
  assert.equal(form.dataset.steerMode || "", "", "dock composer never sets steerMode");
  assert.ok(form.innerHTML.includes("<span>Send to AI</span>"), "dock composer stays Send to AI");
  assert.equal(c.questionsHTML(S.data.p, mdLine), "", "Line page does not render .q-card");

  c.loadState = async () => {};
  c.refreshAfterChange = () => {};
  c.api = async (url, opts = {}) => {
    requests.push({ url, method: opts.method, body: opts.body });
    if (url.endsWith("/steer")) return await new Promise(r => { resolveSteer = () => r({ ok: true, mode: "live" }); });
    return { ok: true };
  };
  document.getElementById("view").innerHTML = `<div id="lppResult">${c.resultHTML(S.data.p, mdLine, mdLine.stations[0], null)}</div>`;
  const panelInput = document.querySelector('#lppResult .q-input');
  panelInput.value = "Yes, ship it";
  await c.ACT["submit-q-topic"](document.querySelector('#lppResult [data-act="submit-q-topic"]'));
  assert.ok(requests[0].url.endsWith("/answer"), "job detail chooser routes through /answer endpoint");
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0].body)), { question: "q-md-1", answer: "Yes, ship it", stepId: "work-1" });

  S.agents = [];
  const how = c.boxSends({ dataset:{ preview:'1' } }, { flags:{} }, S.data.p, { kind:'line' });
  assert.equal(how.mode, 'send', 'zero installed runners still saves a normal Line draft');
  assert.equal(how.agent, null);

  // P2 #12: HTTP 200 { ok: false } on inline custom answer is treated as failure and preserves typed reply
  c.api = async () => ({ ok: false, error: "Question expired" });
  document.getElementById("view").innerHTML = c.askedHTML(parallelLine);
  const qInput = document.querySelector(".q-input");
  qInput.value = "My custom answer";
  toasts.length = 0;
  await c.ACT["answer-tool-custom"](document.querySelector('[data-act="answer-tool-custom"]'));
  assert.ok(toasts.includes("Question expired"), "surfaces error instead of claiming success on {ok:false}");
  assert.equal(document.querySelector(".q-input").value, "My custom answer", "preserves typed inline reply on failure");

  // P2 #15: Contrast ratio check (>= 4.5:1) for light and dark .send-btn.is-steer.is-waiting
  const lum = hex => {
    const [r, g, b] = hex.replace("#", "").match(/../g).map(h => {
      const v = parseInt(h, 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
  const linesCss = fs.readFileSync(path.join(__dirname, "../public/lines/lines.css"), "utf8");
  const darkCss = fs.readFileSync(path.join(__dirname, "../public/lines/dark.css"), "utf8");
  assert.ok(!linesCss.includes(".send-btn.is-steer"));
  assert.ok(!darkCss.includes(".send-btn.is-steer.is-waiting") && darkCss.includes("color: #1f1405; background: var(--amber-mark);"));
  assert.ok(ratio("#ffffff", "#8f5410") >= 4.5, `light contrast ${ratio("#ffffff", "#8f5410").toFixed(2)} >= 4.5`);
  assert.ok(ratio("#1f1405", "#e39a2d") >= 4.5, `dark contrast ${ratio("#1f1405", "#e39a2d").toFixed(2)} >= 4.5`);
});

// =========================================================================
// 18. P2 #13: Mixed Antigravity tool batches with ID-less results
// =========================================================================
test("P2 #13: antigravityTurnState clears one-shot timer in mixed batch using affirmative Task Description: Timer: evidence while keeping run_command and cron pending", () => {
  const conv = "conv-mixed-1";
  const mixedRows = [
    { step_index: 1, type: "USER_INPUT", status: "DONE", content: "Check build and wait" },
    {
      step_index: 2, type: "PLANNER_RESPONSE", status: "DONE",
      tool_calls: [
        { name: "schedule", args: { DurationSeconds: 6, Prompt: "Wake up" } },
        { name: "run_command", args: { CommandLine: "npm run build" } },
      ],
    },
    // ID-less tool results in mixed batch
    { step_index: 3, type: "TOOL_RESPONSE", status: "RUNNING", content: `Background task started.\ntask id: ${conv}/task-3\nTask Description: Timer: 6s` },
    { step_index: 4, type: "TOOL_RESPONSE", status: "RUNNING", content: `Background task started.\ntask id: ${conv}/task-4\nTask Description: npm run build` },
    { step_index: 5, type: "SYSTEM_MESSAGE", status: "DONE", content: `[Message] sender=${conv}/task-3 content=Wake up` },
    { step_index: 6, type: "PLANNER_RESPONSE", status: "DONE", created_at: "2026-11-21T04:10:00Z", content: "Still building", tool_calls: [] },
  ];
  const st1 = RunWatch.antigravityTurnState(mixedRows, 0);
  assert.deepEqual(st1.pendingTasks, [`${conv}/task-4`], "timer task-3 cleared via affirmative Timer: 6s evidence while run_command task-4 stays pending");

  // Once run_command finishes, nothing is pending
  mixedRows.push(
    { step_index: 7, type: "SYSTEM_MESSAGE", status: "DONE", content: `Task ${conv}/task-4 completed with exit code 0` },
    { step_index: 8, type: "PLANNER_RESPONSE", status: "DONE", created_at: "2026-11-21T04:11:00Z", content: "All done", tool_calls: [] },
  );
  const st2 = RunWatch.antigravityTurnState(mixedRows, 0);
  assert.equal(st2.pending, false);
  assert.deepEqual(st2.pendingTasks, []);
  assert.equal(st2.done?.answer, "All done");
});

// =========================================================================
// 19. P2 #14: HTTP /act/ route alias restricted strictly to steer and answer
// =========================================================================
test("P2 #14: HTTP /act/ alias allows only steer and answer and never bypasses retired merge 410", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "http-act-scope-"));
  const stateDir = path.join(root, "state"), docsDir = path.join(root, "docs");
  fs.mkdirSync(stateDir, { recursive: true });
  const fakeAgents = { available: () => [], classifier: () => null };
  const readJson = async req => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  };
  const send = (res, status, data) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(data)); };
  const api = createProjectLines({
    directory: stateDir, agents: fakeAgents, authorizeRead: () => null, authorizeWrite: () => null, readJson, send,
    serviceOptions: { autoWatch: false, recoverOnStart: false },
  });
  t.after(() => { api.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const project = api.service.store.create({ name: "HttpScope", docsPath: docsDir });
  const created = await api.service.createTopic(project, { text: "Topic", kinds: ["ask"], start: false });

  const srv = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      const handled = await api.handle(req, res, url);
      if (!handled && !res.headersSent) { res.writeHead(404); res.end(JSON.stringify({ error: "Not found" })); }
    } catch (err) {
      if (!res.headersSent) { res.writeHead(err.status || 400, { "content-type": "application/json" }); res.end(JSON.stringify({ code: err.code, error: err.message })); }
    }
  });
  await new Promise(resolve => srv.listen(0, "127.0.0.1", resolve));
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.address().port}/api/lines/projects/${encodeURIComponent(project.id)}/topics/${encodeURIComponent(created.slug)}`;
  const headers = { "content-type": "application/json", origin: `http://127.0.0.1:${srv.address().port}` };

  // Direct retired merge returns 410
  const directMerge = await fetch(`${base}/merge`, { method: "POST", headers, body: JSON.stringify({ from: ["other"] }) });
  assert.equal(directMerge.status, 410);

  // /act/merge is NOT routed (404) — never bypasses 410 check
  const aliasMerge = await fetch(`${base}/act/merge`, { method: "POST", headers, body: JSON.stringify({ from: ["other"] }) });
  assert.equal(aliasMerge.status, 404);

  // /act/answer still works
  const aliasAns = await fetch(`${base}/act/answer`, { method: "POST", headers, body: JSON.stringify({ question: "none", answer: "x" }) });
  assert.equal(aliasAns.status, 200);
});

// =========================================================================
// 20. Round 2 review regressions: consent, colliding IDs, partial answers,
//     restored deadline, Claude terminal result, Pi rejected steer,
//     concurrent Markdown answers, secret dock guard, mixed cron batch,
//     and UI refresh/draft isolation
// =========================================================================
function makeService() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "r2-wait-steer-"));
  const stateDir = path.join(root, "state"), docsDir = path.join(root, "docs");
  fs.mkdirSync(stateDir, { recursive: true });
  const fakeAgents = {
    available: () => [{ id: "claude", name: "Claude", available: true }, { id: "codex", name: "Codex", available: true }, { id: "pi", name: "Pi", available: true }],
    classifier: () => null,
    nameOf: id => id,
    command: () => null,
  };
  const service = new Service({ directory: stateDir, agents: fakeAgents, autoWatch: false, recoverOnStart: false });
  const project = service.store.create({ name: "R2Proj", docsPath: docsDir });
  return { service, project, cleanup: () => { service.close(); fs.rmSync(root, { recursive: true, force: true }); } };
}
function loadLineUi() {
  const { document, window } = parseHTML('<html><body><div id="view"></div></body></html>');
  const read = name => fs.readFileSync(path.join(__dirname, "../public/lines", name + ".js"), "utf8");
  const c = vm.createContext({
    document, window, console, navigator: { platform: "Mac" }, location: { hash: "#p1/line/line-a" },
    CSS: { escape: s => String(s) },
    ACT: {}, SEND: {}, HOSTED: false, EMBED: null, STATE_COLOR: {}, LINE_STATUS: require("../public/lines/line-status.js"),
    KIND: { ask: { label: "Ask" }, note: { label: "Note" }, work: { label: "Work" }, canvas: { label: "Canvas" }, meeting: { label: "Meeting" } },
    localStorage: { getItem: () => null }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    addEventListener() {}, requestAnimationFrame: fn => fn(), getComputedStyle: () => ({ lineHeight: "22px", paddingTop: "6px", paddingBottom: "6px" }),
    $: (sel, root = document) => root.querySelector(sel), $$: (sel, root = document) => [...root.querySelectorAll(sel)],
    esc: s => String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])),
    ic: () => "", av: () => "", reducedMotion: () => true, toast: () => {}, nowWhen: () => "2026-11-21 04:00",
    detectPath: () => ({ kind: "line" }), can: () => true, openMenu: (_el, items) => { c._lastMenu = items; }, savedId: id => id,
    availableAgents: () => [{ id: "claude", name: "Claude", available: true }],
    agentInfo: id => ({ id, name: "Claude", color: "#333", mono: "Cl" }),
    openQuestions: l => (l.questions || []),
    canStop: l => Boolean(l.running),
    canMarkReviewed: () => false,
    wordsMd: s => String(s || ""),
    nodeIcon: () => "<svg class='spin'></svg>",
    fileEntry: () => null,
    stationById: (l, id) => l?.stations?.find(st => st.id === id) || null,
    stepLabel: s => s.label || s.kind || "Work",
    currentStation: l => l?.stations?.find(s => s.state === "wait" || s.state === "active") || l?.stations?.[0] || {},
    lineState: l => (l.asking || l.waitingForReply || (l.questions && l.questions.length) ? "wait" : l.running ? "working" : l.status || "done"),
    project: id => c.S.projects.find(x => x.id === (id || c.S.cur)),
    lineById: (p, id) => (c.S.state[p?.id]?.lines || []).find(x => x.id === id || x.slug === id),
    topicApi: (p, l, tail) => `/api/lines/projects/${p.id}/topics/${l.slug}/${tail}`,
    pathFor: id => `/api/lines/projects/${id}`,
    api: async () => ({ ok: true }),
    loadState: async () => {},
    refreshAfterChange: () => {},
    readOpenedLine: () => {},
    loadProjects: async () => [],
    renderRail: () => {},
    withFinishedStop: () => {},
    settleEnd: () => {},
    refreshBehind: () => {},
    scrollToItem: () => {},
    routeToHash: () => "",
    embedCanvas: () => ({}),
    embedCanvasReady: async () => null,
    S: { cur: "p1", route: { view: "line", line: "line-a" }, comp: {}, projects: [], state: {}, qDrafts: {} },
  });
  vm.runInContext(read("composer"), c);
  vm.runInContext(read("line"), c);
  return { c, document };
}

test("Round 2: stale Markdown Yes cannot authorize Claude approval; colliding requestIds require stepId; partial multi-question + scalar rejects", async t => {
  const { service, project, cleanup } = makeService();
  t.after(cleanup);
  const created = await service.createTopic(project, { text: "Consent and ownership", kinds: ["ask", "work"], start: false });
  const key = service.key(project, created.slug);

  // 1) Stale Markdown "Yes" must NEVER approve a pending Claude approval request!
  const written1 = [];
  const primaryRun = {
    agent: "claude", step: "Work 1", stepId: "work-1", launchId: "launch-1", kind: "work",
    stopping: false, inputClosed: false, pendingRequests: new Map(), answeredRequestIds: new Set(),
    child: { stdin: { writable: true, writableEnded: false, write: s => { written1.push(s); return true; } } },
  };
  service.runs.set(key, primaryRun);
  service.handleClaudeControlRequest(project, slugOf(created), primaryRun, {
    id: "req-1", subtype: "can_use_tool", toolName: "Bash", input: { command: "rm -rf ./tmp" },
  });
  const staleRes = await service.answer(project, created.slug, "stale-markdown-q", "Yes");
  assert.equal(staleRes.ok, false, "stale Markdown Yes does not authorize Claude approval");
  assert.equal(written1.length, 0, "no control_response sent to Claude");
  assert.ok(primaryRun.pendingRequests.has("req-1"), "approval remains pending");

  // 2) Colliding requestId "req-1" across primary and parallel lane:
  const written2 = [];
  const laneRun = {
    agent: "claude", step: "Work 2", stepId: "work-2", launchId: "launch-2", kind: "work", lane: true,
    stopping: false, inputClosed: false, pendingRequests: new Map(), answeredRequestIds: new Set(),
    child: { stdin: { writable: true, writableEnded: false, write: s => { written2.push(s); return true; } } },
  };
  service.lanes.set(key, new Map([["work-2", laneRun]]));
  service.handleClaudeControlRequest(project, created.slug, laneRun, {
    id: "req-1", subtype: "can_use_tool", toolName: "Edit", input: { file_path: "a.js", old_string: "x", new_string: "y" },
  });
  // Ambiguous requestId without stepId -> 409 AMBIGUOUS_REQUEST
  await assert.rejects(
    () => service.answer(project, created.slug, "", "allow", { requestId: "req-1" }),
    err => err.code === "AMBIGUOUS_REQUEST" && err.status === 409,
  );
  assert.equal(written1.length, 0);
  assert.equal(written2.length, 0);
  // Explicit stepId routes strictly to work-2 (lane)
  await service.answer(project, created.slug, "", "allow", { requestId: "req-1", stepId: "work-2" });
  assert.equal(written1.length, 0, "primary untouched");
  assert.equal(written2.length, 1, "lane received approval");
  assert.ok(primaryRun.pendingRequests.has("req-1"), "primary approval still pending");

  // 3) Claude terminal result clears pending requests
  const changes = parseLine(JSON.stringify({ type: "result", subtype: "success", session_id: "c1" }));
  assert.equal(changes[0].clearAsking, true);
  service.applyChanges(project, created.slug, primaryRun, changes);
  assert.equal(primaryRun.pendingRequests.size, 0, "terminal result cleared pending approval");

  // 4) Multi-question partial map + scalar answer with empty question selector rejects 400
  const qs = [
    { id: "env", key: "Target environment?", text: "Target environment?", options: ["staging", "prod"] },
    { id: "checks", key: "Which checks?", text: "Which checks?", options: ["unit", "e2e"] },
  ];
  assert.throws(
    () => service.extractMultiAnswers(qs, { question: "", answer: "fallback", answers: { env: "staging" } }),
    err => err.code === "INCOMPLETE_ANSWERS" && err.status === 400,
  );

  // 5) Attachments on /answer for a live tool prompt are rejected before touching files
  service.handleClaudeControlRequest(project, created.slug, laneRun, {
    id: "req-att", subtype: "can_use_tool", toolName: "AskUserQuestion",
    input: { questions: [{ id: "q1", question: "Pick?", options: [{ label: "A" }] }] },
  });
  await assert.rejects(
    () => service.answer(project, created.slug, "q1", "A", { requestId: "req-att", stepId: "work-2", attachments: [{ path: "x.png" }] }),
    err => err.code === "UNSUPPORTED_ATTACHMENT" && err.status === 400,
  );
  service.runs.clear();
  service.lanes.clear();
});
function slugOf(c) { return c.slug; }

test("Round 2: restored Pi deadline expires, batch restore checkpoints once, rejected Pi steer does not fail Work, and concurrent Markdown answers deliver once", async t => {
  const { service, project, cleanup } = makeService();
  t.after(cleanup);
  const created = await service.createTopic(project, { text: "Restore and races", kinds: ["ask", "work"], start: false });
  const key = service.key(project, created.slug);

  // 1) Restored Pi deadline expires after remaining time; batch restore calls keepNote once
  const run = {
    agent: "pi", dialect: "pi", step: "Work 1", stepId: "work-1", kind: "work",
    stopping: false, inputClosed: false, pendingRequests: new Map(), answeredRequestIds: new Set(),
    child: { stdin: { writable: true, writableEnded: false, write: () => true } },
  };
  const soon = Date.now() + 35;
  service.addPendingRequest(project, created.slug, run, {
    id: "pi-exp", protocol: "pi", kind: "tool", requestType: "question", method: "select",
    rowId: "ui-pi-exp", at: Date.now(), expiresAt: soon, isBlocking: true,
    questions: [{ id: "pi-exp", text: "Quick?", options: ["A"] }], answer: async () => {},
  });
  const saved = service.serializePendingRequests(run);
  assert.equal(saved[0].expiresAt, soon, "expiresAt persisted in descriptor");
  // Restore two descriptors on a fresh run and verify single checkpoint
  const run2 = {
    agent: "pi", dialect: "pi", step: "Work 1", stepId: "work-1", kind: "work",
    stopping: false, inputClosed: false, pendingRequests: new Map(), answeredRequestIds: new Set(),
    child: { stdin: { writable: true, writableEnded: false, write: () => true } },
  };
  let keepCalls = 0;
  const origKeep = service.keepNote.bind(service);
  service.keepNote = (...args) => { keepCalls++; return origKeep(...args); };
  service.restorePendingRequests(project, created.slug, run2, [
    saved[0],
    { ...saved[0], id: "pi-long", rowId: "ui-pi-long", expiresAt: Date.now() + 60_000 },
  ]);
  service.keepNote = origKeep;
  assert.equal(keepCalls, 1, "restorePendingRequests checkpoints once after rebinding all entries");
  assert.equal(run2.pendingRequests.size, 2);
  await new Promise(r => setTimeout(r, 60));
  assert.equal(run2.pendingRequests.has("pi-exp"), false, "restored 35ms Pi dialog expired on schedule");
  assert.equal(run2.pendingRequests.has("pi-long"), true, "non-expired dialog remains pending");
  service.clearAllPendingRequests(project, created.slug, run2);

  // 2) Rejected Pi steer / steer-prompt does NOT mark running Work failed and surfaces 409 on mode:"live"
  const steerRejectChanges = parseDialect("pi", JSON.stringify({ type: "response", id: "steer-1", command: "steer", success: false, error: "Cannot steer now" }), run2);
  assert.ok(!steerRejectChanges.some(c => "failed" in c), "rejected steer does not set Work failed");
  const promptSteerRejectChanges = parseDialect("pi", JSON.stringify({ type: "response", id: "steer-2", command: "prompt", success: false, error: "Busy" }), run2);
  assert.ok(!promptSteerRejectChanges.some(c => "failed" in c || c.promptRejected), "rejected steer-* prompt does not trigger initial-prompt EOF/fail");
  const steerFailRun = {
    agent: "pi", step: "Work 1", stepId: "work-1", kind: "work",
    stopping: false, inputClosed: false, plainWords: true,
    steer: async () => { throw new Error("CLI busy"); },
  };
  service.runs.set(key, steerFailRun);
  await assert.rejects(
    () => service.steerAction(project, created.slug, { text: "Check now", mode: "live" }),
    err => err.code === "STEER_REJECTED" && err.status === 409 && /CLI busy/.test(err.message),
  );

  // 3) Concurrent Markdown answers for the same question only steer ONCE
  const md = service.readDoc(project, created.slug);
  const withQ = F.setFront(F.setAbove(md, F.QUESTIONS, F.renderQuestions([{ text: "Which icon?", from: "claude", options: ["A", "B"] }])), { status: "waiting", why: "Pick" });
  service.writeDoc(project, created.slug, withQ);
  const qId = F.parseLine(withQ).questions[0].id;
  const steeredTexts = [];
  const slowSteerRun = { modelActivityAt:Date.now(),
    agent: "claude", step: "Work 1", stepId: "work-1", kind: "work",
    stopping: false, inputClosed: false,
    steer: async text => { await new Promise(r => setTimeout(r, 25)); steeredTexts.push(text); },
  };
  service.runs.set(key, slowSteerRun);
  const [r1, r2] = await Promise.all([
    service.answer(project, created.slug, qId, "A"),
    service.answer(project, created.slug, qId, "B"),
  ]);
  assert.equal(steeredTexts.length, 1, "only one concurrent Markdown decision reached the live runner");
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, false, "second concurrent answer saw question already answered");
  service.runs.clear();
});

test("Round 2: Codex isSecret dock blocked, isBlocking:false keeps working status, mixed timer+cron Antigravity batch clears timer, and UI preserves sent draft on refresh error + isolates qDrafts by line", async t => {
  const { service, project, cleanup } = makeService();
  t.after(cleanup);
  const created = await service.createTopic(project, { text: "Secret and nonblocking", kinds: ["ask", "work"], start: false });
  const key = service.key(project, created.slug);

  // 1) Codex isSecret rejected via dock steerAction
  const secRun = {
    agent: "codex", step: "Work 1", stepId: "work-1", kind: "work",
    stopping: false, inputClosed: false, pendingRequests: new Map(), answeredRequestIds: new Set(),
  };
  service.runs.set(key, secRun);
  service.addPendingRequest(project, created.slug, secRun, {
    id: "sec-1", protocol: "codex", kind: "tool", requestType: "question", rowId: "r-sec",
    isSecret: true, isBlocking: true, questions: [{ id: "tok", text: "API Token", isSecret: true, options: [] }],
    answer: async () => {},
  });
  await assert.rejects(
    () => service.steerAction(project, created.slug, { text: "sk-secret", mode: "auto" }),
    err => err.code === "SECRET_REQUIRES_CARD" && err.status === 400,
  );
  service.clearAllPendingRequests(project, created.slug, secRun);

  // 2) Codex isBlocking:false does NOT flip Line status from working to waiting
  service.writeDoc(project, created.slug, F.setFront(service.readDoc(project, created.slug), { status: "working" }));
  service.addPendingRequest(project, created.slug, secRun, {
    id: "nb-1", protocol: "codex", kind: "tool", requestType: "question", rowId: "r-nb",
    isBlocking: false, questions: [{ id: "opt", text: "Optional hint?", options: ["Skip"] }],
    answer: async () => {},
  });
  const lineView = service.stateOf(project).lines.find(l => l.slug === created.slug);
  assert.equal(lineView.status, "working", "non-blocking Codex prompt keeps Line status working");
  assert.equal(lineView.runAsking, false, "runAsking is false for non-blocking prompt");
  service.clearAllPendingRequests(project, created.slug, secRun);
  service.runs.clear();

  // 3) Mixed Antigravity ID-less batch with BOTH one-shot timer AND cron clears only the one-shot timer
  const conv = "conv-cron-mixed";
  const cronMixed = [
    { step_index: 1, type: "USER_INPUT", status: "DONE", content: "Schedule both" },
    {
      step_index: 2, type: "PLANNER_RESPONSE", status: "DONE",
      tool_calls: [
        { name: "schedule", args: { DurationSeconds: 6, Prompt: "One-shot" } },
        { name: "schedule", args: { CronExpression: "*/5 * * * *", Prompt: "Recurring" } },
      ],
    },
    { step_index: 3, type: "TOOL_RESPONSE", status: "RUNNING", content: `Background task started.\ntask id: ${conv}/task-1\nTask Description: Timer: 6s` },
    { step_index: 4, type: "TOOL_RESPONSE", status: "RUNNING", content: `Background task started.\ntask id: ${conv}/task-2\nTask Description: Cron: */5 * * * *` },
    { step_index: 5, type: "SYSTEM_MESSAGE", status: "DONE", content: `[Message] sender=${conv}/task-1 content=One-shot` },
    { step_index: 6, type: "PLANNER_RESPONSE", status: "DONE", created_at: "2026-11-21T04:10:00Z", content: "Checked", tool_calls: [] },
  ];
  const st = RunWatch.antigravityTurnState(cronMixed, 0);
  assert.deepEqual(st.pendingTasks, [`${conv}/task-2`], "one-shot Timer: 6s cleared even when cron is in same batch, while cron stays pending");

  // 4) UI: steerToTopic does NOT restore draft when POST succeeded and loadState() fails; S.qDrafts isolated by line
  const { c, document } = loadLineUi();
  const lA = { id: "line-a", slug: "line-a", title: "A", running: true, runAgent: "claude", runSteers: true, runSteerMode: "live", asking: { kind: "tool", id: "shared-req", step: "work-1", agent: "claude", answerable: true, questions: [{ id: "q1", text: "Q?", options: ["One", "Two"] }, { id: "q2", text: "Q2?", options: ["X"] }] }, questions: [], stations: [{ id: "work-1", kind: "work", state: "active" }] };
  const lB = { ...lA, id: "line-b", slug: "line-b", title: "B" };
  c.S.cur = "p1";
  c.S.route = { view: "line", line: "line-a" };
  c.S.projects = [{ id: "p1", name: "Proj", lines: [lA, lB], files: [] }];
  c.S.state.p1 = { lines: [lA, lB], files: [] };
  // Save draft on line-a, verify line-b does not see it
  c.saveQDraft("line-a", "shared-req", "q1", "One");
  const htmlB = c.askedHTML(lB);
  assert.ok(!htmlB.includes("is-picked"), "line-b does not inherit line-a's qDraft for colliding requestId");
  const old = c.qDraftKey(lA.id, 'shared-req', '', 'p1', 'work-1');
  lA.asking.launchId = 'another-launch';
  assert.notEqual(c.qDraftKey(lA.id, 'shared-req', '', 'p1', 'work-1'), old);
  assert.equal(c.S.qDrafts[old], undefined);

});

// =========================================================================
// 19. PE-857: Misplaced/varied Questions for you, waiting continuation, & chooser UI
// =========================================================================
test("PE-857 format.js: parses misplaced ## Questions for you & varied formats, preserves round-trips, and cleans up via setAbove", () => {
  const md = [
    "---",
    "id: PE-857",
    "status: waiting",
    "why: Pick direction",
    "who: @antigravity",
    "---",
    "",
    "# Octopus icon redesign",
    "",
    "## Ask · 2026-11-21 12:34",
    "",
    "Please redesign the icon.",
    "",
    "<!-- penecho-task: new -->",
    "",
    "## Questions for you",
    "",
    "Tick one here, in any Markdown editor, or in PenEcho.",
    "",
    "Choose a soft octopus icon option in [Work 3](works/demo/work-3.md), or tell me what to adjust:",
    "",
    "- [ ] **A — Soft Squircle Badge**: gentle rounded icon",
    "- [ ] **B — Open Linework**: minimalist strokes",
    "",
    "1. **Placement** (@codex)",
    "- [ ] Header only",
    "- [ ] Sidebar + header",
    "",
    "### Dark mode weight",
    "- [ ] Regular",
    "- [ ] Bold",
    "",
    "**Ship today?** (@claude)",
    "",
    "- [ ] Yes",
    "- [x] Tomorrow",
    "",
    "## Decided by you",
    "",
    "- Palette **Warm amber**",
    "",
    "## Handoffs between agents",
    "",
    "> @claude to @antigravity: Prepare icon SVGs.",
    "",
    "## [x] Work 1 · @claude · 2 min",
    "",
    "Explore concepts.",
    "",
    "```markdown",
    "## Questions for you",
    "",
    "**Ignored fence question?** (@fake)",
    "",
    "- [ ] Should never parse",
    "```",
  ].join("\n");

  const doc = F.parseLine(md);
  assert.equal(doc.asks.length, 1);
  assert.doesNotMatch(doc.asks[0].text, /Questions for you|Soft Squircle Badge|Decided by you|Handoffs between agents/, "metadata sections do NOT leak into ask-1 text");
  assert.match(doc.asks[0].text, /^Please redesign the icon\.$/);
  assert.equal(doc.decided.length, 1);
  assert.equal(doc.handoffs.length, 1);
  assert.equal(doc.questions.length, 4, "parses plain paragraph, numbered, subheading, and bold questions without boilerplate or fenced examples");
  assert.equal(doc.questions[0].from, "antigravity");
  assert.match(doc.questions[0].text, /^Choose a soft octopus icon option/);
  assert.equal(doc.questions[0].options.length, 2);
  assert.equal(doc.questions[1].text, "Placement");
  assert.equal(doc.questions[1].from, "codex");
  assert.equal(doc.questions[2].text, "Dark mode weight");
  assert.equal(doc.questions[3].id, F.hashText("Ship today?"), "preserves exact hashText ID for **Q?** (@agent)");
  assert.equal(doc.questions[3].ticked, "Tomorrow");

  // Bare checkboxes fall back cleanly to fallbackText / why
  const bareDoc = F.parseLine("---\nid: PE-BARE\nstatus: waiting\nwhy: Pick a color\n---\n\n# Bare\n\n## Questions for you\n\n- [ ] Teal\n- [ ] Coral\n\n## Ask · 2026-11-21 09:00\n\nGo\n");
  assert.equal(bareDoc.questions.length, 1);
  assert.equal(bareDoc.questions[0].text, "Pick a color");
  assert.deepEqual(bareDoc.questions[0].options, ["Teal", "Coral"]);

  // updateSteps round-trip preserves misplaced ## Questions for you without dropping or duplicating
  const roundTripped = F.updateSteps(md, steps => steps.push(F.askStep({ words: "Follow up" })));
  const rtDoc = F.parseLine(roundTripped);
  assert.equal(rtDoc.questions.length, 4, "round-trip preserves all 4 questions");
  assert.equal(rtDoc.decided.length, 1, "round-trip preserves Decided by you");
  assert.equal(rtDoc.handoffs.length, 1, "round-trip preserves Handoffs");
  assert.equal((roundTripped.split("```markdown")[0].match(/^## Questions for you$/gm) || []).length, 1, "no duplicate Questions headings outside code fence");

  // setAbove(md, QUESTIONS, null) removes misplaced ## Questions for you too, while leaving fenced example intact
  const cleared = F.setAbove(md, F.QUESTIONS, null);
  assert.equal(F.parseLine(cleared).questions.length, 0, "cleared Questions everywhere");
  assert.match(cleared, /\*\*Ignored fence question\?\*\*/, "fenced example preserved untouched");
});

test("PE-857 server: i-do-not-like-this regression continues immediately with Refers to Work 3; generic waiting & batch answer work", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pe857-srv-"));
  const stateDir = path.join(root, "state"), docsDir = path.join(root, "docs");
  fs.mkdirSync(stateDir, { recursive: true });
  const launches = [];
  const fakeAgents = {
    available: () => [{ id: "antigravity", available: true, name: "Antigravity" }],
    classifier: () => null,
    command: (_id, opts) => ({ command: "agy", args: [], cwd: opts.workdir }),
  };
  const service = new Service({
    directory: stateDir,
    agents: fakeAgents,
    autoWatch: false,
    spawnFn: (_cmd, _args, opts) => {
      const ch = makeFakeChild(97000 + launches.length);
      launches.push({ prompt: opts?.prompt, child: ch });
      setTimeout(() => {
        ch.stdout.write("Implemented cleanly.\n");
        ch.emit("close", 0);
      }, 20);
      return ch;
    },
  });
  const inherited = [];
  service.orchestrator = { env: () => null, brief: () => "", inheritAssignment: (...args) => inherited.push(args) };
  t.after(() => { service.runs.clear(); service.close(); fs.rmSync(root, { recursive: true, force: true }); });

  const project = service.store.create({ name: "Octo", docsPath: docsDir });
  project.defaultAgent = "antigravity"; service.store.save();

  // 1) Exact i-do-not-like-this.md shape: ## Questions for you after ## Ask, Work 3 open without `took` + detail file
  const slug = "i-do-not-like-this";
  service.writeDoc(project, slug, [
    "---",
    "id: PE-857",
    "status: waiting",
    "who: @antigravity",
    "why: Choose a soft octopus icon option in Work 3, or tell me what to adjust",
    "created: 2026-11-21 12:34",
    "---",
    "",
    "# Orchestrator icon redesign options",
    "",
    "## Ask · 2026-11-21 12:34",
    "",
    "Fix the circled design",
    "",
    "<!-- penecho-task: new -->",
    "",
    "## Questions for you",
    "",
    "Choose a soft octopus icon option in [Work 3](works/i-do-not-like-this/work-3.md), or tell me what to adjust:",
    "",
    "- [ ] **A — Soft Squircle Badge**",
    "- [ ] **B — Open Linework**",
    "- [ ] **C — Minimal Mark**",
    "",
    "## [x] Work 1 · @antigravity · 3 min",
    "",
    "Initial review.",
    "",
    "## [x] Work 2 · @antigravity · 2 min",
    "",
    "More refinements.",
    "",
    "## [ ] Work 3 · @antigravity",
    "",
    "Waiting on icon pick.",
    `[Details](../works/${slug}/work-3.md)`,
  ].join("\n"));
  service.store.writeText(project, F.detailPath(slug, "work-3"), "---\nwho: @antigravity\n---\n\n## Result\n\nPresented options A, B, C.\n");
  service.stepPresets.set(`${service.key(project, slug)}:work-3`, "preset-custom");

  const doc0 = F.parseLine(service.readDoc(project, slug));
  assert.equal(service.stoppedToAsk(doc0, project, slug), true, "Work 3 without took still counts as stoppedToAsk when detail file & why exist");
  const view0 = service.stateOf(project).lines.find(l => l.slug === slug);
  assert.equal(view0.waitingForReply, true);
  assert.equal(view0.questions.length, 1);
  assert.doesNotMatch(view0.stations.find(s => s.id === "ask-1").text, /Questions for you|Soft Squircle/);

  // User replies in dock composer with Refers to Work 3
  const steerRes = await service.steerAction(project, slug, { text: "A, pls implement", refers: ["work-3"] });
  assert.equal(steerRes.ok, true);
  assert.equal(steerRes.mode, "continued", "waiting Line with Refers immediately continues instead of queuing dead-end");
  await until(() => F.parseLine(service.readDoc(project, slug)).status === "done", "Work 4 completed after continuation");

  const afterDoc = F.parseLine(service.readDoc(project, slug));
  assert.equal(afterDoc.questions.length, 0, "misplaced Questions for you cleared");
  const idxW3 = afterDoc.steps.findIndex(s => s.id === "work-3");
  const idxAsk2 = afterDoc.steps.findIndex(s => s.kind === "ask" && s.text.includes("A, pls implement"));
  const idxW4 = afterDoc.steps.findIndex(s => s.id === "work-4");
  assert.ok(idxW3 >= 0 && idxAsk2 > idxW3 && idxW4 > idxAsk2, "Ask inserted AFTER Work 3 and carried-on Work 4 placed after Ask");
  assert.equal(afterDoc.steps[idxW3].done, true);
  assert.equal(service.stepPresets.get(`${service.key(project, slug)}:work-4`), "preset-custom", "inherited stepPreset onto Work 4");
  assert.ok(inherited.some(x => x[2] === "work-3" && x[3] === "work-4"), "inherited orchestrator assignment onto Work 4");

  // 2) Generic status: waiting with 0 checkboxes & all Works [x] done continues immediately from both steerAction and answer(__waiting__)
  const gSlug = "generic-waiting";
  service.writeDoc(project, gSlug, [
    "---",
    "id: PE-858",
    "status: waiting",
    "who: @antigravity",
    "why: Let me know if you want dark mode too",
    "---",
    "",
    "# Generic waiting",
    "",
    "## Ask · 2026-11-21 10:00",
    "",
    "Build theme",
    "",
    "## [x] Work 1 · @antigravity · 1 min",
    "",
    "Built light mode.",
  ].join("\n"));
  const gView = service.stateOf(project).lines.find(l => l.slug === gSlug);
  assert.equal(gView.waitingForReply, true);
  assert.equal(gView.why, "Let me know if you want dark mode too");

  const gSteer = await service.steerAction(project, gSlug, { text: "Yes, add dark mode too" });
  assert.equal(gSteer.mode, "continued");
  await until(() => F.parseLine(service.readDoc(project, gSlug)).status === "done", "generic waiting steer finished");
  assert.equal(F.parseLine(service.readDoc(project, gSlug)).steps.filter(F.AGENT_LIKE).length, 2);

  // Set waiting again with 0 checkboxes and submit via answer(__waiting__)
  service.writeDoc(project, gSlug, F.setFront(service.readDoc(project, gSlug), { status: "waiting", why: "Approve final spacing" }));
  const gAns = await service.answer(project, gSlug, "__waiting__", "", { note: "Looks good, ship spacing" });
  assert.equal(gAns.ok, true);
  assert.equal(gAns.mode, "continued");
  await until(() => F.parseLine(service.readDoc(project, gSlug)).status === "done", "generic __waiting__ card reply finished");
  assert.equal(F.parseLine(service.readDoc(project, gSlug)).steps.filter(F.AGENT_LIKE).length, 3);

  // 3) Single option + manual note, AND multi-question batch submit via answer()
  const bSlug = "batch-waiting";
  service.writeDoc(project, bSlug, [
    "---",
    "id: PE-859",
    "status: waiting",
    "who: @antigravity",
    "why: Two decisions",
    "---",
    "",
    "# Batch decisions",
    "",
    "## Questions for you",
    "",
    "1. **Theme**",
    "- [ ] Light",
    "- [ ] Dark",
    "",
    "2. **Layout**",
    "- [ ] Compact",
    "- [ ] Roomy",
    "",
    "## Ask · 2026-11-21 11:00",
    "",
    "Choose",
    "",
    "## [ ] Work 1 · @antigravity",
  ].join("\n"));
  const bQs = F.parseLine(service.readDoc(project, bSlug)).questions;
  assert.equal(bQs.length, 2);
  const bRes = await service.act(project, bSlug, "answer", {
    questionRev:F.parseLine(service.readDoc(project, bSlug)).questionRev,
    answers: { [bQs[0].id]: "Dark", [bQs[1].id]: "Roomy" },
    note: "Add 12px padding",
  });
  assert.equal(bRes.ok, true);
  await until(() => F.parseLine(service.readDoc(project, bSlug)).status === "done", "batch multi-question answer finished");
  const bAfter = F.parseLine(service.readDoc(project, bSlug));
  assert.equal(bAfter.questions.length, 0);
  assert.deepEqual(bAfter.decided, [
    { text: "Theme", answer: "Dark" },
    { text: "Layout", answer: "Roomy" },
    { text: "Additional feedback", answer: "Add 12px padding" },
  ]);
});

test("PE-857 UI: chooser renders inline Markdown, option+note submit, panel mirror, draft preservation, canStop=false when idle waiting, and Continue dock", async () => {
  const { c, document } = loadLineUi();
  const requests = [], toasts = [];
  c.toast = m => toasts.push(m);
  c.api = async (url, opts = {}) => {
    requests.push({ url, body: opts.body });
    return { ok: true, mode: "continued" };
  };
  const inlineSay = text => c.esc(text).replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  c.inlineSay = inlineSay;
  c.holdMath = text => String(text ?? "");
  c.replaceMarkdownLinks = text => String(text ?? "");
  c.canMarkReviewed = () => false;
  c.currentStation = l => l.stations.find(s => s.state === "wait") || l.stations[0] || {};

  const waitLine = {
    id: "w1", slug: "w1", title: "Octopus", status: "waiting", running: false, elsewhere: false, closed: false, archived: false,
    why: "Choose a soft octopus icon option in Work 3",
    waitingForReply: true, agent: "claude",
    questions: [
      { id: "q1", from: "claude", text: "Which direction?", options: ["**A — Soft Squircle Badge**", "**B — Open Linework**"] },
      { id: "q2", from: "claude", text: "Corner radius?", options: ["Rounded", "Sharp"] },
    ],
    stations: [
      { id: "ask-1", index: 0, kind: "ask", state: "done", text: "Fix the circled design", files: [], pictures: [], refers: [] },
      { id: "work-3", index: 1, kind: "work", label: "Work 3", state: "wait", agent: "claude", asked: false, files: [], pictures: [], refers: [], out: "Options ready." },
    ],
  };
  const p = { id: "p1", name: "Proj", lines: [waitLine], files: [] };
  c.S.cur = "p1";
  c.S.route = { view: "line", line: "w1", step: "work-3" };
  c.S.projects = [p];
  c.S.state.p1 = { lines: [waitLine], files: [] };

  // 1) canStop is false on idle waiting Line (no Stop button in header or card)
  assert.equal(c.canStop(waitLine), false, "idle waiting Line does NOT show Stop");
  assert.doesNotMatch(c.lineHeadActions(p, waitLine, "wait", waitLine.stations[1]), /data-verb="stop"/);
  assert.equal(c.canStop({ ...waitLine, running: true }), true, "actively running Line still allows Stop");

  // 2) Line page never renders .q-card; right-hand Work panel #lppResult renders per-Work chooser cleanly with inline Markdown
  assert.equal(c.questionsHTML(p, waitLine), "", "Line thread NEVER renders .q-card");

  const panelHtml = c.resultHTML(p, waitLine, waitLine.stations[1], null);
  assert.match(panelHtml, /q-card is-topic-q is-multi-q is-panel-q/, "right-hand Work panel renders chooser below Work 3 output");
  assert.match(panelHtml, /data-step="work-3"/, "panel chooser is explicitly scoped to work-3");
  assert.match(panelHtml, /<span class="q-opt-label"><strong>A — Soft Squircle Badge<\/strong><\/span>/, "renders inline Markdown instead of raw asterisks");
  assert.doesNotMatch(panelHtml, /<span class="q-opt-label">[^<]*\*\*A — Soft Squircle Badge\*\*/);
  assert.match(panelHtml, />Reply ↵</);
  assert.match(panelHtml, /Add optional feedback, or type your own reply/);
  assert.doesNotMatch(panelHtml, /data-verb="stop"/);

  document.getElementById("view").innerHTML = `<div id="lpThread">${c.threadHTML(p, waitLine)}</div><div id="lpPanel"><div id="lppResult">${panelHtml}</div></div>`;
  assert.equal(document.querySelectorAll('#lpThread .q-card').length, 0, "no .q-card inside #lpThread");

  // 3) Click option -> selects; click again -> deselects; click across questions + add manual feedback -> syncs S.qDrafts scoped by stepId & survives poll re-render
  const optA = document.querySelector('#lppResult [data-act="pick-q-opt"][data-q="q1"][data-a="**A — Soft Squircle Badge**"]');
  const optRounded = document.querySelector('#lppResult [data-act="pick-q-opt"][data-q="q2"][data-a="Rounded"]');
  c.ACT["pick-q-opt"](optA);
  assert.ok(optA.classList.contains("is-picked"), "first click picks option");
  c.ACT["pick-q-opt"](optA);
  assert.ok(!optA.classList.contains("is-picked"), "second click deselects option");
  c.ACT["pick-q-opt"](optA);
  c.ACT["pick-q-opt"](optRounded);
  c.saveQDraft("w1", "__topic__", "__note", "Softer gradient too", undefined, "work-3");

  // Simulated background poll re-render preserves selection + typed note from S.qDrafts
  const pollHtml = c.resultHTML(p, waitLine, waitLine.stations[1], null);
  assert.match(pollHtml, /is-picked[^>]*data-a="\*\*A — Soft Squircle Badge\*\*"|data-a="\*\*A — Soft Squircle Badge\*\*"[^>]*is-picked/);
  assert.match(pollHtml, /value="Softer gradient too"/);

  // Submit multi-question + manual feedback via Continue button inside right panel
  const panelBtn = document.querySelector('#lppResult [data-act="submit-q-topic"]');
  await c.ACT["submit-q-topic"](panelBtn);
  assert.equal(requests.length, 1);
  assert.ok(requests[0].url.endsWith("/answer"));
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0].body)), {
    answers: { q1: "**A — Soft Squircle Badge**", q2: "Rounded" },
    note: "Softer gradient too",
    stepId: "work-3",
  });
  assert.ok(toasts.includes("Continuing with your reply."));

  // 4) Fallback amber .q-card when 0 parsed questions on waiting Work inside panel ONLY
  const noQWait = { ...waitLine, status: "waiting", why: "Choose a soft octopus icon option in Work 3", waitingForReply: true, questions: [] };
  assert.equal(c.questionsHTML(p, noQWait), "", "fallback waiting card never renders on Line thread");
  const noQHtml = c.resultHTML(p, noQWait, noQWait.stations[1], null);
  assert.match(noQHtml, /is-waiting-reply/, "renders fallback amber card inside waiting Work panel when waiting without parsed checkboxes");
  assert.match(noQHtml, /Choose a soft octopus icon option in Work 3/);
  document.getElementById("view").innerHTML = `<div id="lppResult">${noQHtml}</div>`;
  document.querySelector('#lppResult .q-input').value = "Implement B cleanly";
  requests.length = 0;
  await c.ACT["submit-q-topic"](document.querySelector('#lppResult [data-act="submit-q-topic"]'));
  assert.equal(requests.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0].body)), {
    question: "__waiting__",
    answer: "Implement B cleanly",
    note: "Implement B cleanly",
    stepId: "work-3",
  });

  // 5) Req 1: Dock composer ALWAYS stays Send to AI (and calm placeholder) even when waiting with 0/multi questions, Refers, or attachments!
  const dockWait = {
    ...waitLine,
    status: "waiting",
    why: "Choose a soft octopus icon option in Work 3",
    waitingForReply: true,
    questions: [
      { id: "q1", from: "claude", text: "Which direction?", options: ["**A — Soft Squircle Badge**", "**B — Open Linework**"] },
      { id: "q2", from: "claude", text: "Corner radius?", options: ["Rounded", "Sharp"] },
    ],
  };
  c.S.state.p1.lines = [dockWait];
  assert.equal(c.boxWords(dockWait), "Add to this line. Type / for quick starts.", "boxWords keeps calm 2-days-ago placeholder");
  document.getElementById("view").innerHTML = c.composerHTML("conv-p1-w1", { preview: true, on: "step", topic: "w1" });
  const form = document.querySelector(".composer");
  const compKey = form.dataset.comp;
  c.S.comp[compKey].text = "OK, pls implement A";
  c.S.comp[compKey].refers = [{ line: "w1", step: "work-3", label: "Work 3", words: "Options" }];
  c.renderPathPreview(form, c.S.comp[compKey]);
  assert.equal(form.dataset.steerMode || "", "", "dock composer never sets steerMode on waiting Line");
  assert.ok(form.innerHTML.includes("<span>Send to AI</span>"), "dock primary button reads Send to AI");
  assert.ok(!form.innerHTML.includes("is-steer") && !form.innerHTML.includes("is-waiting"), "dock button never uses is-steer or is-waiting");
  assert.equal(c.boxSends(form, c.S.comp[compKey], c.project(), { kind: "line" }).mode, "send", "dock always goes through unsent saveToTopic flow");

  // Dock composer with file attachment + 0 questions also keeps Send to AI
  const dockNoQ = { ...waitLine, status: "waiting", why: "Choose a soft octopus icon option in Work 3", waitingForReply: true, questions: [] };
  c.S.state.p1.lines = [dockNoQ];
  const formNoQ = document.querySelector(".composer");
  const keyNoQ = formNoQ.dataset.comp;
  c.S.comp[keyNoQ].files = [{ name: "ref.png", path: "files/w1/ref.png", type: "image/png" }];
  c.S.comp[keyNoQ].refers = [];
  c.renderPathPreview(formNoQ, c.S.comp[keyNoQ]);
  assert.equal(formNoQ.dataset.steerMode || "", "");
  assert.ok(formNoQ.innerHTML.includes("<span>Send to AI</span>"));
  c.S.comp[keyNoQ].files = [];
});

test('PE-887 held decisions use model requests, not stdout heartbeats; stop failure preserves choices', async t => {
  const Tokens = require('../src/server/project-lines/token-evidence.js');
  for (const [inputTokens, age, stops] of [[150000, 5000, true], [20000, 7200000, true], [20000, 5000, false], [20000, 45 * 60000, false], [null, null, true]]) {
    const f = reviewWait(t), at = Date.now() - age;
    const evidence = Tokens.create({workId:'work-1',taskId:'task',taskMode:'new'});
    if (inputTokens) Tokens.startAttempt(evidence,{agent:'claude',at}).requests.push({id:'req',at,inputTokens,model:'claude-sonnet'});
    const messages = [], owner = {stepId:'work-1',agent:'claude',heardAt:Date.now(),tokenEvidence:evidence,steer:async text => messages.push(text)};
    f.service.runs.set(f.key,owner);
    f.service.stopHeldAndWait = async (_project, _slug, runs) => { assert.deepEqual(runs,[owner]); };
    if (stops) {
      await assert.rejects(f.answer({question:'Color?',answer:'Red'}), {status:409});
      assert.equal(f.doc().questions.length,1);
      f.service.stopHeldAndWait = async () => { f.service.runs.delete(f.key); };
    }
    await f.service.answer(f.project,f.slug,'Color?','Red',{fromWatch:true,questionRev:f.doc().questionRev});
    if (stops) {
      const added = f.doc().steps.find(step => step.replaces === 'work-1');
      assert.equal(F.splitFront(f.service.store.readText(f.project,F.detailPath(f.slug,added.id)).text).front['task mode'],'new');
      assert.match(F.asksFor(f.doc().steps,added).at(-1).text,/Red/);
    } else {
      assert.match(messages.join(' '),/Red/);
      assert.match(F.asksFor(f.doc().steps,f.doc().steps.find(s=>s.id==='work-1')).at(-1).text,/Color\?: Red/);
    }
  }
});

test('PE-887 a queued Ask and a sibling option retain distinct execution settings across a restart', async t => {
  const f=reviewWait(t,'**Pick?** (@claude)\n- [ ] Yes','## Ask\n\nStart\n\n## [ ] Work 1 · @pi\n\n## [x] Work 2 · @claude');
  const original={id:'same',agent:'claude',model:'original',effort:'high',access:'full'};
  const changed={...original,model:'newer',effort:'low',access:''};
  const presets={get:()=>null,defaultPreset:()=>null,handOver:p=>({model:p.model,effort:p.effort,access:p.access})}; f.service.presets=presets;
  f.service.pinSettings(f.project,f.slug,f.doc().steps.at(-1),null,original);
  f.service.runs.set(f.key,{agent:'pi',stepId:'work-1'});
  await f.service.addFeedback(f.project,f.slug,{text:'Next request',by:'claude',chosen:changed,apart:true});
  const queued=f.doc().steps.find(step=>step.id==='work-3');
  assert.equal(F.asksFor(f.doc().steps,queued).at(-1).taskMode || '', '');
  const result=await f.answer({question:'Pick?',answer:'Yes'});assert.equal(result.mode,'queued');
  const reply=f.doc().steps.find(step=>step.replaces==='work-2');
  f.service.runs.clear();
  f.write(F.updateSteps(f.read(),steps=>{steps.find(step=>step.id==='work-1').done=true;}));
  const commands=[];
  const restarted=new Service({directory:f.service.directory,autoWatch:false,recoverOnStart:false,
    agents:{...f.service.agents,command:(agent,opts)=>({command:agent,args:[opts.model,opts.effort,opts.access],cwd:opts.workdir,stdin:true})},
    spawnFn:(cmd,args)=>{const child=makeFakeChild(99000+commands.length);commands.push([cmd,...args]);setImmediate(()=>child.emit('close',0));return child;}});
  restarted.presets=presets; restarted.next=async()=>{};
  try {
    for(const [step, expected] of [[queued,changed],[reply,original]]) {
      const settings=restarted.presetFor(f.project,f.slug,'claude',step.id);
      for(const key of ['id','agent','model','effort','access']) assert.equal(settings[key],expected[key]);
      const doc=f.doc();await restarted.launch(f.project,f.slug,doc.steps.find(candidate=>candidate.id===step.id),doc);
      assert.deepEqual(commands.at(-1),['claude',expected.model,expected.effort,expected.access]);
      await until(()=>!restarted.heldWorks(f.project,f.slug).length && !restarted.finishing.size,'fake command completes');
    }
  } finally { await restarted.close(); }
});

test('PE-887 inline ownership survives stamping; unknown work tags and concurrent anonymous writes are not guessed', t => {
  const f=reviewWait(t,'**Top?** (@claude)\n- [ ] Yes\n\n**Unknown?**\n<!-- work: work-99 -->\n- [ ] No\n\n**Anonymous?**\n- [ ] Maybe','## Ask\n\nStart\n\n## [ ] Work 1 · @claude\n\n## [ ] Work 2 · @pi\n\n## Questions for you\n\n**Inline?**\n- [ ] Later');
  f.service.stampUntaggedLineQuestions(f.project,f.slug,f.doc().steps.find(s=>s.id==='work-1'));
  const state=f.service.lineQuestionsState(f.project,f.slug,f.doc());
  assert.deepEqual(state.byStep.get('work-1').map(q=>q.text),['Top?']);
  assert.deepEqual(state.byStep.get('work-2').map(q=>q.text),['Inline?']);
  assert.match(f.read(),/<!-- work: work-2 -->/);assert.match(f.read(),/<!-- work: work-99 -->/);
});

test('PE-887 run eligibility, zero-option waiting owner and custom detail README grouping', t => {
  const f=reviewWait(t,'','## Ask\n\nStart\n\n## [ ] Work 1 · @claude\n\n## Ask · Not sent\n\nDraft');
  const view=()=>f.service.lineFrom(f.project,{slug:f.slug,text:f.read(),doc:f.doc(),mtime:Date.now()});
  const owner={agent:'claude',stepId:'work-1',steer:async()=>{}};f.service.runs.set(f.key,owner);
  assert.equal(view().runSteers,true);
  f.service.lanes.set(f.key,new Map([['work-2',{agent:'pi',stepId:'work-2'}]]));assert.equal(view().runSteers,false);
  f.service.lanes.clear(); f.write(f.read().replace('## Ask · Not sent','## Ask'));assert.equal(view().runSteers,false);
  f.service.runs.clear();f.write(f.read().replace('## [ ] Work 1','## [x] Work 1').replace('## Ask\n\nDraft','## Ask · Not sent\n\nDraft'));
  assert.equal(view().stations.find(s=>s.id==='work-1').waitingReply,true);
  f.write(F.setFront(f.read().replace('## Ask · Not sent','[Details](../works/merged/options.md)\n\n## Ask · Not sent'),{status:'done'}));
  f.service.store.writeText(f.project,'works/merged/options.md','## Questions for you\n\n**Open?**\n- [ ] Yes');
  f.service.store.syncGenerated(f.project,'main');
  const readme=f.service.store.readText(f.project,'README.md').text;
  assert.match(readme.split('## Needs you')[1]?.split('\n## ')[0] || '',/Review/);
});

test('PE-887 live acknowledgment splices only its original draft after an unrelated write', async t => {
  const f = reviewWait(t,'','## Ask\n\nOriginal\n\n## [ ] Work 1 · @claude\n\n## Ask · Not sent\n\nFirst draft');
  let accept, deliveries = 0;
  const request = {id:'r',questions:[{id:'q',text:'Reply?'}],answer:() => {deliveries++; return new Promise(resolve => {accept = resolve;});}};
  f.service.runs.set(f.key,{stepId:'work-1',agent:'claude',modelActivityAt:Date.now(),pendingRequests:new Map([['r',request]])});
  const delivery = f.service.sendUnsent(f.project,f.slug,{step:f.doc().steps.at(-1).id,agent:'claude'});
  await until(() => accept,'delivery started');
  f.write(F.setFront(f.read(),{why:'Newer reason'})+'\n## Ask · Not sent\n\nSecond draft\n');
  accept(); await delivery;
  assert.equal(deliveries,1); assert.equal(f.doc().front.why,'Newer reason');
  assert.deepEqual(f.doc().steps.filter(F.isUnsent).map(step => step.text),['Second draft']);
});

test('PE-887 held Markdown handoff uses the pre-send owner and never drops the other agent’s options', async t => {
  for (const agent of ['claude','pi']) {
    const f=reviewWait(t,'**Pick?** (@claude)\n- [ ] Red','## Ask\n\nOriginal\n\n## [ ] Work 1 · @claude\n\n## Ask · Not sent\n\nNew direction');
    const messages=[], stopped=[];
    const owner={agent:'claude',stepId:'work-1',modelActivityAt:Date.now(),steer:async text=>messages.push(text)};
    f.service.runs.set(f.key,owner);
    f.service.stopHeldAndWait=async (_project,_slug,runs)=>{stopped.push(...runs);f.service.runs.clear();};
    const result=await f.service.sendUnsent(f.project,f.slug,{step:f.doc().steps.at(-1).id,agent});
    assert.equal(result.ok,true); assert.equal(f.doc().steps.some(F.isUnsent),false);
    if(agent==='claude') { assert.equal(f.doc().questions.length,0);assert.match(messages.join(' '),/New direction/);assert.equal(stopped.length,0); }
    else {assert.deepEqual(stopped,[owner]);assert.equal(f.doc().questions[0].workId,'work-1');assert.equal(f.doc().steps.filter(F.AGENT_LIKE).at(-1).who,'pi');}
  }
});

test('PE-887 an uncertain live delivery cannot be retried, even after reloading delivery state', async t => {
  const f=reviewWait(t,'','## Ask\n\nStart\n\n## [ ] Work 1 · @claude\n\n## Ask · Not sent\n\nMy answer');
  let calls=0;
  const owner={agent:'claude',stepId:'work-1',launchId:'launch',modelActivityAt:Date.now(),pendingRequests:new Map([['r',{id:'r',questions:[],answer:async()=>{calls++;throw Error('lost acknowledgment');}}]])};
  f.service.runs.set(f.key,owner);const send=()=>f.service.sendUnsent(f.project,f.slug,{agent:'claude',step:f.doc().steps.at(-1).id});
  await assert.rejects(send(),{code:'DELIVERY_UNCONFIRMED'});f.service.pendingDeliveries.reload();
  await assert.rejects(send(),{code:'DELIVERY_UNCONFIRMED'});assert.equal(calls,1);assert.equal(f.service.runs.get(f.key),owner);assert.ok(F.isUnsent(f.doc().steps.at(-1)));
});

test('PE-887 exact fresh comparison replaces an incorrect same-agent baseline using only the target’s reads', t => {
  const f=reviewWait(t,'','## Ask\n\nStart\n\n## [x] Work 1 · @claude\n\n## [x] Work 2 · @claude\n\n## [x] Work 3 · @claude');
  const Tokens=require('../src/server/project-lines/token-evidence.js');
  for(const [work,input,key] of [[1,200000,'target'],[2,300000,'sibling'],[3,20000,'target']]) {
    const id='work-'+work, detail=F.detailPath(f.slug,id);
    f.service.store.writeText(f.project,detail,F.setFront('## Result\n\nDone',{who:'@claude',...(work===3?{'continued from work':'work-1'}:{})}));
    const record=Tokens.create({workId:id,taskId:id,taskMode:'new',baseline:work===3?{agent:'claude',requestId:'request-2',input:300000,at:2}:null});
    const attempt=Tokens.startAttempt(record,{agent:'claude',at:work,sessionId:'session-'+work});
    Tokens.observe(record,attempt,{type:'assistant',message:{id:'request-'+work,model:'opus',usage:{input_tokens:input,cache_read_input_tokens:0,cache_creation_input_tokens:0,output_tokens:10},content:[]}},{at:work});
    attempt.reads.push({q:0,k:[key],c:400});
    f.service.store.writeText(f.project,detail.replace(/\.md$/,'.tokens.json'),JSON.stringify(record));
  }
  const doc=f.doc(), step=doc.steps.at(-1);
  assert.equal(f.service.lastConversation(f.project,f.slug,doc.steps,{...step,continuedFromWork:'work-1'},'claude').input,200000);
  const view=f.service.lineFrom(f.project,{slug:f.slug,text:f.read(),doc,mtime:Date.now()});
  const startup=view.stations.at(-1).tokens.startup;
  assert.equal(startup.baseline.requestId,'request-1');assert.equal(startup.difference,180000);assert.ok(startup.cost.rereadTokens>0);
  assert.throws(()=>f.service.prepareTask(f.project,f.slug,{...step,replaces:'work-missing'},doc,'claude'),{code:'MISSING_WORK'});
});

test('PE-887 identical source questions and interleaved partial choices stay separate', async t => {
  const f = reviewWait(t,'<!-- work: work-1 -->\n**Same?**\n- [ ] Yes','## Ask\n\nInitial\n\n## [x] Work 1 · @claude\n\n## [x] Work 2 · @pi');
  f.service.next = async () => {};
  const detail = (id,text) => f.service.store.writeText(f.project,F.detailPath(f.slug,id),'## Questions for you\n\n'+text+'\n');
  detail('work-1','**Same?**\n- [ ] No'); detail('work-2','**First B?**\n- [ ] Beta\n\n**Second B?**\n- [ ] Gamma');
  const state = () => f.service.lineQuestionsState(f.project,f.slug,f.doc());
  const send = (id,source,value) => { const now=state(), q=now.byStep.get(id).find(q => q.source===source && q.options.includes(value)); return f.answer({stepId:id,question:q.id,answer:value,questionRev:now.revByStep.get(id)}); };
  assert.equal(new Set(state().byStep.get('work-1').map(q => q.id)).size,2);
  const revision = state().revByStep.get('work-2');
  await send('work-1','line','Yes'); f.write(F.setFront(f.read(),{why:'Another reason'}));
  assert.equal(state().revByStep.get('work-2'),revision);
  await send('work-2','work','Beta'); await send('work-1','work','No'); await send('work-2','work','Gamma');
  const reply = id => { const doc=f.doc(); return F.asksFor(doc.steps,doc.steps.find(s => s.replaces===id)).at(-1).text; };
  assert.match(reply('work-1'),/Yes.*No/); assert.doesNotMatch(reply('work-1'),/Beta|Gamma/);
  assert.match(reply('work-2'),/Beta.*Gamma/); assert.doesNotMatch(reply('work-2'),/Same/);
});

function reviewWait(t, questions = "**Color?**\n- [ ] Red", steps = "## Ask\n\nOriginal\n\n## [ ] Work 1 · @claude", why = "Choose") {
  const { service, project, cleanup } = makeService();
  const slug = "review-wait", key = service.key(project, slug);
  t.after(() => { service.runs.clear(); service.lanes.clear(); cleanup(); });
  const read = () => service.readDoc(project, slug);
  const doc = () => F.parseLine(read());
  const write = md => service.writeDoc(project, slug, md);
  write(`---\nid: PE-860\nstatus: waiting\nwhy: ${why}\n---\n\n# Review\n\n## Questions for you\n\n${questions}\n\n${steps}\n`);
  const launches = [];
  service.next = async () => {
    const step = doc().steps.find(s => !s.done);
    launches.push(step?.id);
    if (step) service.runs.set(key, { stepId:step.id, agent:step.who });
  };
  const answer = body => service.act(project, slug, "answer", { questionRev:doc().questionRev, ...body });
  return { service, project, slug, key, read, doc, write, launches, answer };
}

test("PE-860 #1, #15 waiting reply owns its replacement before queued Work and preserves an unsent draft", async t => {
  const f = reviewWait(t, "**Pick?**\n- [ ] Red", "## Ask\n\nOriginal\n\n## [ ] Work 1 · @claude\n\n## Ask\n\nQueued\n\n## [ ] Work 2 · @pi\n\n## Ask · Not sent\n\nDraft", "");
  const result = await f.service.steerAction(f.project, f.slug, { text:"Implement Red", refers:["work-1"], links:["[Asset](../files/red.txt)"], mode:"continue" });
  assert.equal(result.mode, "continued");
  const { steps } = f.doc();
  const asks = id => F.asksFor(steps, steps.find(s => s.id === id));
  assert.deepEqual(asks("work-3").map(a => a.text), ["Original", "Implement Red"]);
  assert.equal(asks("work-3")[1].files[0].name, "Asset");
  assert.equal(asks("work-3")[1].refers[0].label, "Work 1");
  assert.deepEqual(asks("work-2").map(a => a.text), ["Queued"]);
  assert.ok(F.isUnsent(steps.at(-1)));
  assert.deepEqual(f.launches, ["work-3"]);

  const done = reviewWait(t, "**OK?**\n- [ ] Yes", "## Ask\n\nOriginal\n\n## [x] Work 1 · @claude\n\n## Ask · Not sent\n\nPrivate draft");
  assert.equal((await done.answer({ question:done.doc().questions[0].id, answer:"Yes" })).mode, "continued");
  assert.ok(F.isUnsent(done.doc().steps.at(-1)));
  assert.deepEqual(done.launches, ["work-2"]);
});

test("PE-860 #2, #3, #13, #14 stale batches are atomic and held or finished Lines record long manual replies", async t => {
  const f = reviewWait(t, "**Same?**\n- [ ] A\n**Same?**\n- [x] B", undefined, "Working on another Line");
  const before = f.read(), [one,two] = f.doc().questions;
  for (const answers of [{ old:"A" }, { [one.id]:"A", old:"A" }, { [one.id]:"Removed" }, {}]) {
    await assert.rejects(f.answer({ answers, note:"Manual" }), { code:"STALE_QUESTION" });
    assert.equal(f.read(), before);
  }
  const old = f.doc().questionRev;
  f.write(before.replace("- [ ] A", "- [ ] Green"));
  await assert.rejects(f.answer({ questionRev:old, answers:{ [one.id]:"A" } }), { code:"STALE_QUESTION" });
  const text = "A".repeat(6200);
  assert.equal((await f.answer({ question:one.id, answer:text })).mode, "recorded");
  assert.equal(f.doc().decided[0].answer, text);
  assert.equal(f.doc().questions[0].id, two.id);
  assert.equal(f.doc().questions[0].ticked, "B");
  assert.equal((await f.answer({ question:two.id, answer:"B" })).mode, "recorded");
  assert.equal(f.doc().front.why, "Working on another Line");
  assert.equal(f.doc().status, "waiting");
  f.write(F.setFront(before, { status:"done" }));
  assert.equal((await f.answer({ answers:{ [one.id]:"A", [two.id]:"B" } })).mode, "recorded");
  assert.equal(f.doc().status, "done");
  assert.deepEqual(f.launches, []);
});

test("PE-860 #4, #5, #7 partial answers leave runs alone and final decisions reach only their owner", async t => {
  const f = reviewWait(t, "**Color?** (@pi)\n- [ ] Red\n**Size?** (@pi)\n- [x] Small", "## Ask\n\nOriginal\n\n## [ ] Work 1 · @claude\n\n## [ ] Work 2 · @pi");
  const messages = [];
  f.service.runs.set(f.key, { agent:"claude", stepId:"work-1", steer:async () => assert.fail("wrong Work") });
  const lane = { modelActivityAt:Date.now(), agent:"pi", stepId:"work-2", lane:true, steer:async text => messages.push(text) };
  f.service.lanes.set(f.key, new Map([["work-2",lane]]));
  const [color,size] = f.doc().questions;
  assert.equal((await f.answer({ answers:{ [color.id]:"Red" } })).mode, "recorded");
  assert.deepEqual(messages, []);
  assert.equal(f.doc().questions[0].ticked, "Small");
  assert.equal((await f.answer({ answers:{ [size.id]:"Small" } })).mode, "steered");
  assert.equal(messages.length, 1);
  assert.match(messages[0], /Color\? Red.*Size\? Small/);
  const race = reviewWait(t);
  race.service.runs.set(race.key, { modelActivityAt:Date.now(), stepId:"work-1", agent:"claude", steer:async () => race.write(race.read().replace("Color?", "New question?")) });
  await assert.rejects(race.answer({ question:"__waiting__", answer:"Old reply" }), { code:"STALE_QUESTION" });
  assert.equal(race.doc().questions[0].text, "New question?");
});

test("PE-860 #5 lane-only ownership and pending approval, secret and ordinary requests veto restart", async t => {
  const f = reviewWait(t);
  const before = f.read();
  for (const request of [{ requestType:"approval" }, { isSecret:true }, { requestType:"question" }]) {
    f.write(before);
    const pendingRequests = new Map([["pending", request]]);
    const run = { agent:"claude", stepId:"work-1", pendingRequests, lane:true, steer:async () => assert.fail("prompt interrupted") };
    f.service.lanes.set(f.key, new Map([["work-1",run]]));
    await assert.rejects(f.answer({ question:f.doc().questions[0].id, answer:"Red" }), { code:"BUSY", status:409 });
    assert.equal(f.read(), before);
    assert.equal(pendingRequests.size, 1);
    await assert.rejects(f.service.steerAction(f.project, f.slug, { mode:"interrupt-resume", text:"again" }), e => ["BUSY","SECRET_REQUIRES_CARD"].includes(e.code));
  }
  f.write(before);
  f.service.lanes.set(f.key, new Map([["work-2",{ agent:"pi", stepId:"work-2", lane:true }]]));
  await assert.rejects(f.answer({ question:"__waiting__", answer:"continue" }), { code:"BUSY" });
  assert.equal(f.read(), before);
  assert.deepEqual(f.launches, []);
});

test("PE-860 #8 answer lock releases a failing final operation without a second rejection", async t => {
  const f = reviewWait(t), sequence = [];
  await assert.rejects(f.service.withAnswerLock(f.key, () => { throw Error("write failed"); }), /write failed/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.service.answerLocks.size, 0);
  await Promise.all([1,2].map(n => f.service.withAnswerLock(f.key, async () => sequence.push(n))));
  assert.deepEqual(sequence, [1,2]);
});

test("PE-860 #6, #9–11 Markdown splices preserve literal ranges, duplicate/empty sections, and physical Ask identity", () => {
  const fenced = "```md\r\n## Ask\r\n\r\n\r\n> Held · busy\r\n```";
  const result = "<!-- result: -->\r\n**Fake?**\r\n- [x] Fake\r\n\r\n\r\n<!-- /result -->";
  const md = ["# Test", "## Ask", fenced, "## Ask · Not sent", "> Held · busy", fenced, "## Questions for you", "**Real?**", "- [ ] Yes", result, "## Questions for you", "**Real?**", "- [ ] Yes", "## Parts", "## My checklist", "> Held · busy", "## [ ] Work 1"].join("\r\n");
  assert.deepEqual(F.parseLine(md).questions.map(q => q.text), ["Real?", "Real?"]);
  assert.equal(F.updateSteps(md, () => {}), md);
  assert.match(F.parseLine(md).asks[1].body, /## My checklist/);
  const finished = F.finishUnsentAsk(md, "ask-2");
  assert.equal(finished, md.replace("## Ask · Not sent\r\n> Held · busy", "## Ask · Finished & reviewed"));
  for (const replacement of [null,"**New?**\n- [ ] Yes"]) {
    const changed = F.setAbove(md, F.QUESTIONS, replacement);
    assert.equal(changed.split(fenced).length, 3);
    assert.ok(changed.includes(result));
    assert.doesNotMatch(changed, /(?<!\r)\n/);
  }
  for (const opener of ["```md", "<!-- result: -->"]) {
    const tail = [opener, "## Questions for you", "**Fake?**", "- [x] Fake", ""].join("\n");
    const source = "# Test\n\n## Questions for you\n**Live?**\n- [ ] Yes\n" + tail;
    assert.deepEqual(F.parseLine(source).questions.map(q => q.text), ["Live?"]);
    assert.ok(F.setAbove(source, F.QUESTIONS, null).endsWith(tail));
  }
});

test("PE-860 #3, #4, #14, #16, #17 rendered cards isolate stale drafts, expose keyboard choices and preserve save intent", async () => {
  const { c, document } = loadLineUi();
  const p = { id:"p1" }, other = { id:"p2" };
  const line = { id:"same", slug:"same", status:"done", waitingForReply:false, questionRev:"revA", stations:[], questions:[{ id:"a", text:"A?", options:["Yes","No"] }] };
  c.S.projects = [p,other];
  c.S.state.p1 = { lines:[line] };
  c.S.state.p2 = { lines:[{ ...line }] };
  c.inlineSay = c.esc;
  const render = () => c.topicChooserHTML(c.project(), c.lineById(c.project(),"same"));
  document.body.innerHTML = render();
  assert.equal(c.isWaitingReplyLine(line), false);
  assert.match(document.body.innerHTML, /Reply ↵/);
  assert.doesNotMatch(document.body.innerHTML, /role="radio"|aria-checked/);
  const buttons = document.querySelectorAll('.q-choice');
  assert.equal(buttons.length, 2);
  let focused = false;
  buttons[1].focus = () => { focused = true; };
  c.choiceKeydown({ target:buttons[0], key:"ArrowRight", preventDefault() {} });
  assert.equal(focused,true);
  c.ACT["pick-q-opt"](buttons[0]);
  assert.equal(buttons[0].getAttribute("aria-pressed"),"true");
  c.saveQDraft("same","__topic__","__note","Private A","revA");
  const submit = document.querySelector('[data-act="submit-q-topic"]');
  c.S.cur = "p2";
  assert.doesNotMatch(render(), /Private A/);
  c.S.cur = "p1";
  line.questionRev = "revB";
  line.questions = [{ id:"b", text:"B?", options:["Yes"] }];
  const requests = [];
  c.api = async (...args) => requests.push(args);
  await c.ACT["submit-q-topic"](submit);
  assert.deepEqual(requests, []);
  assert.doesNotMatch(render(), /Private A/);
  line.questionRev = "revA";
  assert.match(render(), /Private A/);

  const draft = vm.runInContext('comp("retry")', c);
  draft.text = "Save privately";
  draft.flags.prefer = "note";
  const took = c.takeBox("retry");
  c.backInBox("retry", took);
  assert.equal(draft.flags.prefer, "note");
  c.testRuns = () => false;
  assert.equal(c.boxSends({ dataset:{ preview:"1" } },draft,p,{ kind:"line" }).mode,"send");
  c.testRuns = () => true;
  assert.equal(c.boxSends({ dataset:{ preview:"1" } },draft,p,{ kind:"line" }).mode,"run");
  assert.match(fs.readFileSync(path.join(__dirname,"../public/lines/lines.css"),"utf8"), /\.is-topic-q \.q-qblock \+ \.q-qblock/);
  assert.match(fs.readFileSync(path.join(__dirname,"../public/lines/line.css"),"utf8"), /#lppResult \.q-card\.is-panel-q/);
});

// =========================================================================
// 21. Owner Requirements 1-4: Composer, Unsent Steer/Queue, Panel-only Per-Work Isolation, AutoMode & Same/Different Agent Waiting
// =========================================================================
test("Req 1 & Req 2 UI: composer always Send to AI/Save as note across all states; unsent Ask defaults Steer and queues on agent or preset change", async () => {
  const { c, document } = loadLineUi();
  const requests = [], toasts = [];
  c.toast = m => toasts.push(m);
  c.api = async (url, opts = {}) => { requests.push({ url, body: opts.body }); return { ok: true, id: "ask-new", slug: "l1", step: "ask-new", added: true }; };
  const presets = [
    { id: "p-codex-fast", name: "Codex Fast", agent: "codex", model: "gpt-5", effort: "low", enabled: true },
    { id: "p-codex-deep", name: "Codex Deep", agent: "codex", model: "gpt-5", effort: "high", enabled: true },
    { id: "p-claude", name: "Claude", agent: "claude", model: "claude-sonnet", enabled: true },
  ];
  c.S.agents = [
    { id: "codex", name: "Codex", available: true, app: "Codex", steers: true },
    { id: "claude", name: "Claude", available: true, app: "Claude", steers: true },
    { id: "dsh", name: "dsh", available: true, steers: false },
  ];
  c.S.presets = presets;
  c.availableAgents = () => c.S.agents;
  c.agentInfo = id => c.S.agents.find(a => a.id === id) || { id, name: id || "Agent", color: "#333", mono: "Ag" };
  c.savedAgents = () => presets;
  c.savedAgentById = id => presets.find(x => x.id === id) || null;
  c.defaultPreset = () => presets[0];

  const baseLine = {
    id: "l1", slug: "l1", title: "Demo", status: "idle", running: false, elsewhere: false,
    runAgent: "codex", runSteers: true, runSteerMode: "live", agent: "codex",
    stations: [{ id: "work-1", index: 0, kind: "work", label: "Work 1", state: "done", agent: "codex", preset: "p-codex-fast", model: "gpt-5", reasoningEffort: "low", pictures: [], files: [], refers: [] }],
    questions: [], asking: null,
  };
  const proj = { id: "p1", name: "P", defaultAgent: "codex", lines: [baseLine], landed: [], backlog: [], files: [], git: false };
  c.S.cur = "p1";
  c.S.route = { view: "line", line: "l1" };
  c.S.projects = [proj];
  c.S.state.p1 = { lines: [baseLine], landed: [], backlog: [], files: [] };

  // Req 1: Home + Line composer across idle, working, waiting(options), waiting(0 options), grill
  const compFn = vm.runInContext("comp", c);
  for (const state of [
    { name: "home-idle", on: "home", topic: "", patch: { status: "idle", running: false, waitingForReply: false, questions: [], asking: null } },
    { name: "line-idle", on: "step", topic: "l1", patch: { status: "done", running: false, waitingForReply: false, questions: [], asking: null } },
    { name: "line-running", on: "step", topic: "l1", patch: { status: "working", running: true, runAgent: "codex", runSteers: true, waitingForReply: false, questions: [], asking: null } },
    { name: "line-waiting-opts", on: "step", topic: "l1", patch: { status: "waiting", running: false, waitingForReply: true, questions: [{ id: "q1", text: "Pick?", options: ["A"] }], asking: null } },
    { name: "line-waiting-no-opts", on: "step", topic: "l1", patch: { status: "waiting", running: false, waitingForReply: true, questions: [], asking: null } },
  ]) {
    Object.assign(baseLine, state.patch);
    document.getElementById("view").innerHTML = c.composerHTML(`cmp-${state.name}`, { placeholder: c.boxWords(baseLine), preview: true, on: state.on, topic: state.topic });
    const form = document.querySelector(".composer");
    const draft = compFn(form.dataset.comp);
    c.renderPathPreview(form, draft);
    assert.ok(form.innerHTML.includes("<span>Send to AI</span>"), `${state.name} always renders Send to AI`);
    for (const forbidden of [">Steer<", ">Queue next<", ">Continue<", ">Reply<", "Save without sending", "is-steer", "is-waiting"]) {
      assert.ok(!form.innerHTML.includes(forbidden), `${state.name} never renders ${forbidden}`);
    }
    assert.equal(form.dataset.steerMode || "", "", `${state.name} never sets steerMode`);
    c.ACT["cmp-send-pick"](form.querySelector(".send-pick"));
    assert.deepEqual(Array.from(c._lastMenu, i => i.label), ["Send to AI", "Save as note"], `${state.name} menu only has 2 options`);
    assert.equal(c.boxSends(form, draft, proj, { kind: "line" }).mode, "send", `${state.name} boxSends always uses saveToTopic ('send')`);
  }
  assert.equal(c.boxWords({ ...baseLine, status: "waiting", asking: null, stations: [{ kind: "work", state: "wait", wait: true }] }), "What should change?");
  assert.equal(c.boxWords({ ...baseLine, status: "waiting", asking: null, stations: [{ kind: "grill", state: "wait", wait: true }] }), "Your answer");
  assert.equal(c.boxWords({ ...baseLine, asking: { kind: "tool", agent: "codex", answerable: false } }), "To answer Codex, use the button above.");

  // Submitting from Line composer while running creates an unsent Ask via /unsent (NOT /steer!)
  Object.assign(baseLine, { status: "working", running: true, runAgent: "codex", runSteers: true, stations: [{ id: "work-1", index: 0, kind: "work", label: "Work 1", state: "active", agent: "codex", preset: "p-codex-fast", model: "gpt-5", reasoningEffort: "low", pictures: [], files: [], refers: [] }] });
  document.getElementById("view").innerHTML = c.composerHTML("conv-p1-l1", { placeholder: c.boxWords(baseLine), preview: true, on: "step", topic: "l1" });
  const liveForm = document.querySelector(".composer");
  const liveComp = compFn(liveForm.dataset.comp);
  liveComp.text = "Follow-up idea";
  document.querySelector(".cmp-input").value = "Follow-up idea";
  c.sendComposer(liveForm);
  await new Promise(r => setImmediate(r));
  assert.equal(requests.length, 1);
  assert.ok(requests[0].url.endsWith("/unsent"), "Line composer submission posts to /unsent");

  // Req 2: Unsent Ask card defaults to Steer when same live agent/preset, switches to 'next' when changing agent OR preset, and 'next' for non-live runner
  c.presetById = id => presets.find(x => x.id === id) || null;
  c.runnablePresets = () => presets;
  baseLine.runSetup = "gpt-5|low";
  baseLine.stations[0].picked = { model: "gpt-5", effort: "low" };
  baseLine.stations[0].selected = { model: "gpt-5", effort: "low" };
  baseLine.stations[0].savedAgentId = "p-codex-fast";
  baseLine.stations[0].savedAgent = "Codex Fast";
  const unsentStep = { id: "ask-2", index: 1, kind: "ask", state: "todo", unsent: true, via: "Not sent", text: "Queued thought", files: [], pictures: [], refers: [] };
  baseLine.stations.push(unsentStep);
  const footSame = c.unsentFoot(proj, baseLine, unsentStep);
  assert.match(footSame, /<span>Steer into Codex\b[^<]*<\/span>/, "default unsent button when live working is Steer into <Agent>");
  assert.match(footSame, /Goes into the Work Codex is doing now/);
  assert.equal(c.runMode(baseLine, "codex", presets[0]), "steer");

  // Switch unsent Ask agent to different agent (claude) via S.runWith -> mode switches to 'next' ('Runs next')
  c.S.runWith = { l1: "claude" };
  const footDiffAgent = c.unsentFoot(proj, baseLine, unsentStep);
  assert.match(footDiffAgent, /<span>Run with Claude\b[^<]* next<\/span>/, "changing agent switches unsent Ask to queued 'next'");
  assert.match(footDiffAgent, /Starts when Codex finishes/);
  assert.equal(c.runMode(baseLine, "claude", presets[2]), "next");

  // Switch back to codex but pick DIFFERENT preset (Deep reasoning vs active Fast) -> mode switches to 'next'
  c.S.runWith = { l1: "codex" };
  c.S.runPresetOn = { l1: "p-codex-deep" };
  const footDiffPreset = c.unsentFoot(proj, baseLine, unsentStep);
  assert.match(footDiffPreset, /<span>Run with Codex\b[^<]* next<\/span>/, "changing preset/model/effort switches unsent Ask to queued 'next'");
  assert.match(footDiffPreset, /Starts when Codex finishes/);
  assert.equal(c.runMode(baseLine, "codex", presets[1]), "next");

  // Non-live runner (runSteers=false, dsh) -> mode stays 'next'
  c.S.runWith = {};
  c.S.runPresetOn = {};
  baseLine.runAgent = "dsh";
  baseLine.runSteers = false;
  baseLine.runSetup = "|";
  baseLine.stations[0].agent = "dsh";
  baseLine.stations[0].savedAgentId = "";
  baseLine.stations[0].savedAgent = "";
  baseLine.stations[0].picked = null;
  baseLine.stations[0].selected = null;
  const footNoLive = c.unsentFoot(proj, baseLine, unsentStep);
  assert.match(footNoLive, /<span>Run with dsh\b[^<]* next<\/span>/);
  assert.match(footNoLive, /Starts when dsh finishes/);
  assert.equal(c.runMode(baseLine, "dsh", null), "next");
});

test("Req 3a UI: panel-only per-Work isolation for options, fallback wait, parallel live prompts, and desk ACT['need-reply']", async () => {
  const { c, document } = loadLineUi();
  c.inlineSay = s => c.esc(String(s || ""));
  c.holdMath = s => String(s || "");
  c.replaceMarkdownLinks = s => String(s || "");
  c.canMarkReviewed = () => false;

  const line = {
    id: "multi", slug: "multi", title: "Parallel Agents", status: "waiting", waitingForReply: true, running: true,
    questionRev: "combined",
    stations: [
      {
        id: "work-1", index: 0, kind: "work", label: "Work 1", state: "wait", agent: "claude", asked: false,
        questions: [{ id: "q-w1", workId: "work-1", from: "claude", text: "Claude option?", options: ["Use SQLite", "Use JSON"] }],
        questionRev: "rev-w1", waitingReply: false, asking: null, out: "Claude finished pass 1.", pictures: [], files: [], refers: [],
      },
      {
        id: "work-2", index: 1, kind: "work", label: "Work 2", state: "active", asked: true,
        questions: [], questionRev: "", waitingReply: false,
        asking: { kind: "tool", id: "req-w2", agent: "codex", step: "work-2", answerable: true, questions: [{ id: "tool-w2", text: "Codex live prompt?", options: ["Proceed", "Abort"] }] },
        out: "", pictures: [], files: [], refers: [],
      },
      {
        id: "work-3", index: 2, kind: "work", label: "Work 3", state: "done", asked: false,
        questions: [], questionRev: "", waitingReply: false, asking: null,
        out: "Pi completed cleanly.", pictures: [], files: [], refers: [],
      },
    ],
    questions: [{ id: "q-w1", workId: "work-1", from: "claude", text: "Claude option?", options: ["Use SQLite", "Use JSON"] }],
    asking: null,
  };
  const p = { id: "p1", name: "Proj", lines: [line], landed: [], backlog: [], files: [] };
  c.S.cur = "p1";
  c.S.route = { view: "line", line: "multi", step: "work-3" };
  c.S.projects = [p];
  c.S.state.p1 = { lines: [line], landed: [], backlog: [], files: [] };

  // Line page never renders .q-card; ONLY waiting Works show amber 'Waiting on you'
  assert.equal(c.questionsHTML(p, line), "", "Line page never renders .q-card");
  const w1 = c.workItem(p, line, line.stations[0]);
  const w2 = c.workItem(p, line, line.stations[1]);
  const w3 = c.workItem(p, line, line.stations[2]);
  assert.ok(w1.includes("w-wait") && w1.includes("Waiting on you"), "Work 1 shows amber Waiting on you");
  assert.ok(w2.includes("w-wait") && w2.includes("Waiting on you"), "Work 2 shows amber Waiting on you");
  assert.ok(!w3.includes("Waiting on you") && !w3.includes("w-wait"), "Work 3 (no pending prompt) does NOT show Waiting on you");

  // Panel isolation: Work 1 gets only Work 1 chooser; Work 2 gets only Work 2 live tool card; Work 3 gets NEITHER!
  const p1Html = c.resultHTML(p, line, line.stations[0], null);
  const p2Html = c.resultHTML(p, line, line.stations[1], null);
  const p3Html = c.resultHTML(p, line, line.stations[2], null);
  assert.ok(p1Html.includes("Claude option?") && !p1Html.includes("Codex live prompt?"), "Work 1 panel renders Work 1 options only");
  assert.ok(p2Html.includes("Codex live prompt?") && !p2Html.includes("Claude option?"), "Work 2 panel renders Work 2 live prompt only");
  assert.ok(!p3Html.includes("q-card") && !p3Html.includes("Claude option?") && !p3Html.includes("Codex live prompt?"), "Work 3 panel NEVER receives Work 1 or Work 2 options");

  // Fallback waitingReply shows ONLY on the waiting Work (never on Work 3)
  line.stations[0].questions = [];
  line.stations[0].waitingReply = true;
  line.questions = [];
  assert.ok(c.resultHTML(p, line, line.stations[0], null).includes("is-waiting-reply"), "Work 1 shows fallback reply card");
  assert.ok(!c.resultHTML(p, line, line.stations[2], null).includes("is-waiting-reply"), "Work 3 NEVER shows Work 1 fallback reply card");

  // PE-1134: penecho.ai shows the same reply card (the answer is recorded there and held for the computer); a read-only or shared page does not.
  const localCard = c.topicChooserHTML(p, line, line.stations[0], { inPanel: true });
  c.HOSTED = { key: "p1", read: false, shared: false, onComputer: true };
  assert.equal(c.topicChooserHTML(p, line, line.stations[0], { inPanel: true }), localCard, "the hosted reply card is the local one");
  assert.match(localCard, /is-waiting-reply[\s\S]*Type your reply to continue…[\s\S]*data-act="submit-q-topic"/);
  assert.ok(!c.resultHTML(p, line, line.stations[2], null).includes("is-waiting-reply"), "hosted Work 3 NEVER shows Work 1 fallback reply card");
  assert.match(c.answerAct({ ...line, asking: null, stations: [line.stations[0], line.stations[2]] }), /data-act="need-reply"[^>]*data-step="work-1">Answer</, "hosted Answer opens the Work that waits");
  c.HOSTED = { key: "p1", read: true, shared: true };
  assert.equal(c.topicChooserHTML(p, line, line.stations[0], { inPanel: true }), "", "a read-only page has no reply card");
  c.HOSTED = false;

  // desk.js ACT['need-reply'] navigates directly to waiting Work detail panel and focuses #lpPanel .q-card
  const { document: dDoc, window: dWin } = parseHTML('<html><body><div id="lpPanel"><div class="q-card" data-step="work-2"><input class="q-input" /></div></div></body></html>');
  const navCalls = [];
  let focusedInput = false;
  dDoc.querySelector("#lpPanel .q-card .q-input").focus = () => { focusedInput = true; };
  dDoc.querySelector("#lpPanel .q-card .q-input").scrollIntoView = () => {};
  const dc = vm.createContext({
    document: dDoc, window: dWin, console, ACT: {}, S: { flying: false }, setTimeout,
    $: (sel, root = dDoc) => root.querySelector(sel),
    $$: (sel, root = dDoc) => [...root.querySelectorAll(sel)],
    esc: s => String(s ?? ""), ic: () => "",
    project: () => p,
    lineById: (_p, id) => id === "multi" ? line : null,
    stationById: (l, id) => l.stations.find(st => st.id === id) || null,
    isWork: s => s.kind === "work",
    lineState: () => "wait",
    currentStation: l => l.stations[0],
    askedYou: () => "",
    questionIn: () => "",
    plainOut: s => String(s || ""),
    rememberReply: () => {},
    go: route => { dc.S.route = route; navCalls.push(route); },
  });
  const deskSrc = fs.readFileSync(path.join(__dirname, "../public/lines/desk.js"), "utf8");
  vm.runInContext(deskSrc.slice(deskSrc.indexOf("const isGrillStop"), deskSrc.indexOf("// ---------- A small track")), dc);
  dc.ACT["need-reply"]({ dataset: { line: "multi" } });
  assert.deepEqual(JSON.parse(JSON.stringify(navCalls)), [{ view: "line", line: "multi", step: "work-2" }], "ACT['need-reply'] opens waiting Work detail step");
  assert.equal(focusedInput, true, "ACT['need-reply'] focuses #lpPanel .q-card input");
});

test("Req 3b & 3c: multi-agent per-Work option isolation, superseded legacy suppression, warm/expired/large TaskContext.autoMode, and README Needs you", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "req3bc-"));
  const stateDir = path.join(root, "state"), docsDir = path.join(root, "docs");
  fs.mkdirSync(stateDir, { recursive: true });
  const spawns = [];
  const fakeAgents = {
    available: () => [
      { id: "claude", available: true, name: "Claude" },
      { id: "codex", available: true, name: "Codex" },
    ],
    classifier: () => null,
    command: (id, opts) => ({ command: id, args: opts.resume ? ["--resume", opts.resume] : [], cwd: opts.workdir, stdin: true }),
  };
  const service = new Service({
    directory: stateDir,
    agents: fakeAgents,
    autoWatch: false,
    spawnFn: (cmd, args, opts) => {
      const ch = makeFakeChild(98100 + spawns.length);
      spawns.push({ cmd, args, prompt: opts?.prompt || "", child: ch });
      setImmediate(() => {
        ch.stdout.write(`Done by ${cmd}.\n`);
        ch.emit("close", 0);
      });
      return ch;
    },
  });
  t.after(() => { service.runs.clear(); service.close(); fs.rmSync(root, { recursive: true, force: true }); });

  const project = service.store.create({ name: "Multi3b", docsPath: docsDir });
  project.defaultAgent = "claude";
  service.store.save();

  // 1) Superseded legacy inline 'Fewer buttons' bug on done Line: suppressed!
  const legacyDoc = F.parseLine([
    "---",
    "id: PE-900",
    "status: done",
    "who: @claude",
    "---",
    "",
    "# Fewer buttons",
    "",
    "## Ask · 2026-11-20 10:00",
    "",
    "Clean UI",
    "",
    "## [x] Work 1 · @claude · 1 min",
    "",
    "First try.",
    "",
    "## Questions for you",
    "",
    "**Fewer buttons?**",
    "- [ ] Yes",
    "- [ ] No",
    "",
    "## [x] Work 2 · @claude · 1 min",
    "",
    "Already finished afterward.",
  ].join("\n"));
  assert.equal(legacyDoc.questions.length, 0, "superseded legacy inline section after Work 1 is ignored once Work 2 by @claude finished on done Line");

  // 2) Multi-agent Work 1 (@claude in lines md with <!-- work: work-1 -->) + Work 2 (@codex in works/<slug>/work-2.md)
  const slug = "multi-work-iso";
  service.writeDoc(project, slug, [
    "---",
    "id: PE-901",
    "status: waiting",
    "who: @codex",
    "why: Pick options",
    "created: 2026-11-21 10:00",
    "---",
    "",
    "# Two agents waiting",
    "",
    "## Questions for you",
    "",
    "**Which DB?** (@claude)",
    "<!-- work: work-1 -->",
    "",
    "- [ ] Postgres",
    "- [ ] SQLite",
    "",
    "## Ask · 2026-11-21 10:00",
    "",
    "Build storage and API",
    "",
    "## [ ] Work 1 · @claude · 1 min",
    "",
    "Storage draft ready.",
    `[Details](../works/${slug}/work-1.md)`,
    "",
    "## [x] Work 2 · @codex · 1 min",
    "",
    "API draft ready.",
    `[Details](../works/${slug}/work-2.md)`,
  ].join("\n"));
  service.store.writeText(project, F.detailPath(slug, "work-1"), `---\nwho: @claude\ntask id: task-w1\nended: ${F.nowLabel()}\n---\n\n## Result\n\nProposed Postgres vs SQLite.\n`);
  service.store.writeText(project, F.detailPath(slug, "work-2"), "---\nwho: @codex\ntask id: task-w2\n---\n\n## Result\n\nAPI options ready.\n\n## Questions for you\n\n**REST or RPC?**\n\n- [ ] REST\n- [ ] RPC\n");

  // Sync README and verify Work-detail-only questions surface in Needs you
  service.store.syncGenerated(project, "main");
  const readme = fs.readFileSync(path.join(docsDir, "README.md"), "utf8");
  assert.match(readme, /Two agents waiting[\s\S]*Needs you/i, "README Needs you reflects open questions");

  const view = service.stateOf(project).lines.find(l => l.slug === slug);
  const w1 = view.stations.find(s => s.id === "work-1");
  const w2 = view.stations.find(s => s.id === "work-2");
  assert.equal(w1.questions.length, 1);
  assert.equal(w1.questions[0].text, "Which DB?");
  assert.equal(w2.questions.length, 1);
  assert.equal(w2.questions[0].text, "REST or RPC?");
  assert.equal(view.questions.length, 2, "line.questions is union across Works");

  // Seed warm (<150k, recent endedAt) parallel-lane session for work-1 so autoMode resumes Work 1's Claude session
  const key = service.key(project, slug);
  service.startRuntime();
  service.sessions[key] = {
    "claude#work-1": { id: "claude-sess-w1", workId: "work-1", config:TaskContext.hash(JSON.stringify(["claude", "", "", "work"])), policyVersion: TaskContext.VERSION },
    codex: { id: "codex-sess-w2", workId: "work-2", config:TaskContext.hash(JSON.stringify(["codex", "", "", "work"])), policyVersion: TaskContext.VERSION },
  };
  service.stepPresets.set(`${key}:work-1`, "");
  fs.mkdirSync(path.join(docsDir, path.dirname(TaskContext.taskFile(slug, "work-1"))), { recursive: true });
  const seedUsage = (inputTokens, age, work = "work-1", agent = "claude") => {
    const Tokens = require('../src/server/project-lines/token-evidence.js'), at = Date.now() - age;
    const evidence = Tokens.create({ workId:work, taskId:work === 'work-1' ? 'task-w1' : 'task-w2', taskMode:'new' }), attempt = Tokens.startAttempt(evidence, {agent, at});
    attempt.requests.push({ id:'req', at, inputTokens, model:'claude-sonnet' });
    service.store.writeText(project, TaskContext.taskFile(slug, work), JSON.stringify(evidence));
  };
  seedUsage(20000, 5000);
  service.writeDoc(project, slug, F.setFront(service.readDoc(project, slug).replace('## [ ] Work 1', '## [ ] Work 3 · @codex\n\nActive sibling\n\n## [x] Work 1'), { status:'working' }));

  // Queue work-3 as an active held run by codex to verify Work 1 continuation queues cleanly behind active sibling Work!
  const fakeHeldW3 = { agent: "codex", stepId: "work-3", stopping: false, pendingRequests: new Map() };
  service.lanes.set(key, new Map([["work-3", fakeHeldW3]]));
  const ansW1 = await service.answer(project, slug, w1.questions[0].id, "Postgres", { stepId: "work-1", questionRev: w1.questionRev });
  assert.equal(ansW1.ok, true);
  assert.equal(ansW1.mode, "queued", "Work 1 continuation queues behind active sibling Work 3");
  service.lanes.delete(key);

  const afterW1 = F.parseLine(service.readDoc(project, slug));
  assert.equal(afterW1.questions.length, 0, "Work 1 question removed from lines/<slug>.md");
  assert.equal(F.parseDetailQuestions(service.store.readText(project, F.detailPath(slug, "work-2")).text, { workId: "work-2" }).length, 1, "Work 2 options in work-2.md remain untouched");
  const contW1 = afterW1.steps.find(s => s.replaces === "work-1" && F.AGENT_LIKE(s));
  assert.ok(contW1, "continuation Work references replaces: work-1");
  assert.equal(contW1.who, "claude", "continuation Work goes to targetWork.who (@claude), NOT doc.front.who (@codex)");

  // Evaluate prepareTask on warm contW1 -> resumes claude-sess-w1!
  const warmPrep = service.prepareTask(project, slug, contW1, afterW1, contW1.who);
  assert.equal(warmPrep.task.mode, "continue", "warm <150k session resumes via TaskContext.autoMode");
  assert.equal(warmPrep.task.id, "task-w1");

  // Simulate expired cache (>1h) AND >=150k input tokens -> prepareTask starts fresh ('new') with Decided by you packet!
  service.store.writeText(project, TaskContext.taskFile(slug, contW1.id), "{}");
  service.store.writeText(project, F.detailPath(slug, contW1.id), "---\nwho: @claude\n---\n");
  service.store.writeText(project, F.detailPath(slug, "work-1"), "---\nwho: @claude\ntask id: task-w1\nended: 2026-11-20 10:00\n---\n\n## Result\n\nProposed Postgres vs SQLite.\n");
  seedUsage(20000, 2 * 3600 * 1000);
  const coldPrep = service.prepareTask(project, slug, contW1, afterW1, contW1.who);
  assert.equal(coldPrep.task.mode, "new", "stale / >=150k Work triggers token-saving fresh session");
  assert.notEqual(coldPrep.task.id, "task-w1");
  const coldPacket = TaskContext.historicalPacket({ slug, doc: afterW1, step: contW1, task: coldPrep.task, topicText: service.readDoc(project, slug), previous: coldPrep.previous, readDetail: rel => service.store.exists(project, rel) ? service.store.readText(project, rel).text : "" });
  assert.match(coldPacket.text, /Decided by you[\s\S]*Postgres/, "fresh packet carries Decided by you + decision");
  assert.match(coldPacket.text, /Proposed Postgres vs SQLite/, "fresh packet carries target Work result");

  service.store.writeText(project, F.detailPath(slug, contW1.id), '---\nwho: @claude\n---\n');
  service.store.writeText(project, F.detailPath(slug, 'work-1'), `---\nwho: @claude\ntask id: task-w1\nended: ${F.nowLabel()}\n---\n`);
  seedUsage(150000, 5000);
  assert.equal(service.prepareTask(project, slug, contW1, afterW1, 'claude').task.mode, 'new', 'recent but large starts fresh');
  seedUsage(20000, 5000);
  service.store.writeText(project, F.detailPath(slug, contW1.id), '---\nwho: @claude\n---\n');
  service.writeDoc(project, slug, F.updateSteps(service.readDoc(project, slug), steps => { steps.find(s => s.id === 'work-3').done = true; }));
  await service.launch(project, slug, contW1, F.parseLine(service.readDoc(project, slug)));
  assert.deepEqual(spawns.at(-1).args, ['--resume', 'claude-sess-w1']);
  await until(() => !service.heldWorks(project, slug).length, 'warm continuation completes');

  // External tick in works/<slug>/work-2.md while Line awaits feedback is picked up by watchProject
  service.writeDoc(project, slug, F.setFront(F.updateSteps(service.readDoc(project, slug), steps => {
    for (const item of steps) {
      if (item.id === contW1.id) item.done = true;
      if (item.id === 'work-3') item.done = false;
    }
  }), { status: 'working', why:null }));
  service.lanes.set(key, new Map([['work-3',fakeHeldW3]]));
  const w2DetailRel = F.detailPath(slug, "work-2");
  service.store.writeText(project, w2DetailRel, service.store.readText(project, w2DetailRel).text.replace("- [ ] REST", "- [x] REST"));
  seedUsage(25000, 5000, "work-2", "codex");
  const watchAnswer = service.answer.bind(service);
  let checkedReply;
  service.answer = async (...args) => { try { return checkedReply = await watchAnswer(...args); } catch (error) { checkedReply = error; throw error; } };
  await service.watchProject(project);
  assert.equal(checkedReply?.mode, 'queued', checkedReply?.message);
  assert.equal(spawns.at(-1).cmd, 'claude');
  service.notes.clear(); service.lanes.delete(key);
  service.writeDoc(project, slug, F.updateSteps(service.readDoc(project, slug), steps => {steps.find(s=>s.id==='work-3').done=true;}));
  await service.next(project, slug);
  await until(() => spawns.at(-1)?.cmd === "codex", "ticked work-2 option spawns Codex continuation");
  assert.equal(F.parseDetailQuestions(service.store.readText(project, w2DetailRel).text, { workId: "work-2" }).length, 0, "ticked work-2 options cleared after watchProject");
  assert.equal(spawns.at(-1).cmd, "codex");
  assert.deepEqual(spawns.at(-1).args, ["--resume", "codex-sess-w2"]);
  assert.match(spawns.at(-1).child.stdinChunks.join(""), /REST or RPC\?: REST/);
});

test("Req 4: choosing DIFFERENT agent preserves Agent A options and runs B; choosing SAME agent clears only its options and continues", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "req4-agents-"));
  const stateDir = path.join(root, "state"), docsDir = path.join(root, "docs");
  fs.mkdirSync(stateDir, { recursive: true });
  const spawns = [];
  const fakeAgents = {
    available: () => [
      { id: "claude", available: true, name: "Claude" },
      { id: "codex", available: true, name: "Codex" },
    ],
    classifier: () => null,
    command: (id, opts) => ({ command: id, args: [], cwd: opts.workdir, stdin: true }),
  };
  const service = new Service({
    directory: stateDir,
    agents: fakeAgents,
    autoWatch: false,
    spawnFn: cmd => {
      const ch = makeFakeChild(98200 + spawns.length);
      spawns.push({ cmd, child: ch });
      setImmediate(() => { ch.stdout.write(`Done by ${cmd}\n`); ch.emit("close", 0); });
      return ch;
    },
  });
  t.after(() => { service.runs.clear(); service.close(); fs.rmSync(root, { recursive: true, force: true }); });

  const project = service.store.create({ name: "Req4", docsPath: docsDir });
  project.defaultAgent = "claude";
  service.store.save();

  const slug = "switch-wait";
  service.writeDoc(project, slug, [
    "---",
    "id: PE-902",
    "status: waiting",
    "who: @claude",
    "why: Pick",
    "---",
    "",
    "# Switch wait",
    "",
    "## Questions for you",
    "",
    "**Approach?** (@claude)",
    "<!-- work: work-1 -->",
    "",
    "- [ ] Fast",
    "- [ ] Thorough",
    "",
    "## Ask · 2026-11-21 10:00",
    "",
    "Build",
    "",
    "## [ ] Work 1 · @claude · 1 min",
    "",
    "Waiting on approach.",
    "",
    "## Ask · 2026-11-21 10:05 · Not sent",
    "",
    "Try with Codex instead",
  ].join("\n"));

  const unsentB = F.parseLine(service.readDoc(project, slug)).steps.find(F.isUnsent);
  await service.sendUnsent(project, slug, { step: unsentB.id, agent: "codex" });
  await until(() => spawns.length === 1 && !service.runs.size && !service.finishing.size, "Codex spawned cleanly after switching away from waiting Claude");
  const afterDiff = F.parseLine(service.readDoc(project, slug));
  assert.equal(afterDiff.questions.length, 1, "Agent A (@claude) options are preserved when choosing DIFFERENT agent (@codex)");
  assert.equal(afterDiff.steps.find(s => s.id === "work-1").done, true, "open [ ] Work 1 closed cleanly so Codex is not blocked");
  assert.equal(spawns[0].cmd, "codex");

  // Now put Codex into waiting with its own Work 3 questions while Claude's Work 1 question is still open, and send SAME agent (codex)
  service.writeDoc(project, slug, [
    "---",
    "id: PE-902",
    "status: waiting",
    "who: @codex",
    "why: Pick codex option",
    "---",
    "",
    "# Switch wait",
    "",
    "## Questions for you",
    "",
    "**Approach?** (@claude)",
    "<!-- work: work-1 -->",
    "",
    "- [ ] Fast",
    "- [ ] Thorough",
    "",
    "**Endpoint?** (@codex)",
    "<!-- work: work-2 -->",
    "",
    "- [ ] v1",
    "- [ ] v2",
    "",
    "## Ask · 2026-11-21 10:00",
    "",
    "Build",
    "",
    "## [x] Work 1 · @claude · 1 min",
    "",
    "Done.",
    "",
    "## [ ] Work 2 · @codex · 1 min",
    "",
    "Waiting.",
    "",
    "## Ask · 2026-11-21 10:10 · Not sent",
    "",
    "Use v2 please",
  ].join("\n"));

  const unsentSame = F.parseLine(service.readDoc(project, slug)).steps.find(F.isUnsent);
  await service.sendUnsent(project, slug, { step: unsentSame.id, agent: "codex" });
  await until(() => spawns.length === 2, "Codex continued cleanly for same agent");
  const afterSame = F.parseLine(service.readDoc(project, slug));
  assert.equal(afterSame.questions.length, 1, "ONLY Codex's own options cleared; Claude's Work 1 options preserved");
  assert.equal(afterSame.questions[0].workId, "work-1");
  assert.equal(afterSame.steps.find(s => s.id === "work-2").done, true, "open [ ] Work 2 closed cleanly");
});

test('PE-887 live prompt at 150k stops only its owner; protected sibling rejects Markdown without consuming it', async t => {
  const Tokens=require('../src/server/project-lines/token-evidence.js'), f=reviewWait(t,'','## Ask\n\nInitial\n\n## [ ] Work 1 · @claude\n\n## Ask · Not sent\n\nSelected answer');
  const at=Date.now(), evidence=Tokens.create({workId:'work-1',taskId:'task',taskMode:'new'});
  Tokens.startAttempt(evidence,{agent:'claude',at}).requests.push({id:'large',inputTokens:150000,at});
  const owner={agent:'claude',stepId:'work-1',started:at,tokenEvidence:evidence,pendingRequests:new Map([['q',{id:'q',answer:async()=>assert.fail('large session reused')} ]])};
  f.service.runs.set(f.key,owner);f.service.stopHeldAndWait=async (_project,_slug,runs)=>{assert.deepEqual(runs,[owner]);f.service.runs.delete(f.key);};
  await f.service.sendUnsent(f.project,f.slug,{agent:'claude',step:f.doc().steps.at(-1).id});
  const replaced=f.doc().steps.find(s=>s.replaces==='work-1');
  assert.equal(F.asksFor(f.doc().steps,replaced).at(-1).text,'Selected answer');
  assert.equal(f.service.detailOf(f.project,F.detailPath(f.slug,replaced.id)).front['task mode'],'new');
  const sibling=reviewWait(t,'**Pick?** (@pi)\n- [ ] Yes','## Ask\n\nStart\n\n## [ ] Work 1 · @claude\n\n## [x] Work 2 · @pi');
  for(const prompt of [{requestType:'approval'},{isSecret:true}]) {
    sibling.service.runs.set(sibling.key,{agent:'claude',stepId:'work-1',pendingRequests:new Map([['q',prompt]])});
    const before=sibling.read();await assert.rejects(sibling.answer({question:'Pick?',answer:'Yes'}),{status:409});assert.equal(sibling.read(),before);
  }
});

// =========================================================================
// 22. PE-887 Round 2 verification regressions (P1-1, P1-6, P1-9, P2-2, P2-4)
// =========================================================================
test("PE-887 R2 P1-1: late RunWatch.decide() transcript read uses transcript done.at so cold held session starts fresh instead of steering", async t => {
  const Tokens = require("../src/server/project-lines/token-evidence.js");
  const f = reviewWait(t, "**Color?** (@claude)\n- [ ] Red", "## Ask\n\nOriginal\n\n## [ ] Work 1 · @claude");
  const now = Date.now(), twoHoursAgo = now - 2 * 3600 * 1000;
  const evidence = Tokens.create({ workId:"work-1", taskId:"t1", taskMode:"new" });
  Tokens.startAttempt(evidence, { agent:"claude", at:twoHoursAgo }).requests.push({ id:"req-1", at:twoHoursAgo, inputTokens:20000, model:"claude-sonnet" });
  let steerCalls = 0, stopCalls = 0;
  const owner = {
    stepId:"work-1", agent:"claude", started:twoHoursAgo - 10000, heardAt:twoHoursAgo,
    tokenEvidence:evidence,
    steer:async () => { steerCalls++; },
  };
  // Late poll observes transcript finished two hours ago -> turnOver is now, turnOverAt is twoHoursAgo
  RunWatch.decide(owner, { cpu:0, below:[] }, now, { finished:() => ({ answer:"Waiting on Color?", at:twoHoursAgo }) });
  assert.equal(owner.turnOver, now);
  assert.equal(owner.turnOverAt, twoHoursAgo);

  f.service.runs.set(f.key, owner);
  f.service.stopHeldAndWait = async (_project, _slug, runs) => { stopCalls++; assert.deepEqual(runs, [owner]); f.service.runs.delete(f.key); };
  const res = await f.answer({ question:f.doc().questions[0].id, answer:"Red" });
  assert.equal(steerCalls, 0, "cold held session must NOT steer after late transcript poll");
  assert.equal(stopCalls, 1, "cold held session stopped cleanly");
  assert.equal(res.steered, false);
  const added = f.doc().steps.find(s => s.replaces === "work-1");
  assert.equal(F.splitFront(f.service.store.readText(f.project, F.detailPath(f.slug, added.id)).text).front["task mode"], "new");
});

test("PE-887 R2 P1-6: persisted draftId blocks retry after renumbering and prevents deleting identical sibling on in-flight delete", async t => {
  // Case A: unconfirmed live delivery survives deletion of earlier Ask (renumbering ask-2 -> ask-1)
  const f1 = reviewWait(t, "", "## Ask\n\nEarlier ask\n\n## [ ] Work 1 · @claude\n\n## Ask · Not sent\n\nMy live reply");
  let calls = 0;
  f1.service.runs.set(f1.key, {
    agent:"claude", stepId:"work-1", launchId:"launch-1", modelActivityAt:Date.now(),
    pendingRequests:new Map([["r1", { id:"r1", questions:[], answer:async () => { calls++; throw Error("lost ack"); } }]]),
  });
  await assert.rejects(f1.service.sendUnsent(f1.project, f1.slug, { agent:"claude", step:"ask-2" }), { code:"DELIVERY_UNCONFIRMED" });
  assert.equal(calls, 1);
  // Delete unrelated earlier ask-1 so the draft renumbers from ask-2 to ask-1
  f1.write(F.updateSteps(f1.read(), steps => { steps.splice(steps.findIndex(s => s.id === "ask-1"), 1); }));
  const renumbered = f1.doc().steps.find(F.isUnsent);
  assert.equal(renumbered.id, "ask-1");
  assert.ok(renumbered.draftId, "draftId persisted on disk and survived renumbering");
  f1.service.pendingDeliveries.reload();
  await assert.rejects(f1.service.sendUnsent(f1.project, f1.slug, { agent:"claude", step:renumbered.id }), { code:"DELIVERY_UNCONFIRMED" });
  assert.equal(calls, 1, "answer callback NOT invoked a second time after renumbering");

  // Case B: deleting in-flight draft while an identical sibling slides into ask-2 leaves sibling untouched
  const f2 = reviewWait(t, "", "## Ask\n\nStart\n\n## [ ] Work 1 · @claude\n\n## Ask · Not sent\n\nSame text\n\n## Ask · Not sent\n\nSame text");
  let resolveAck;
  f2.service.runs.set(f2.key, {
    agent:"claude", stepId:"work-1", launchId:"launch-2", modelActivityAt:Date.now(),
    pendingRequests:new Map([["r2", { id:"r2", questions:[{ id:"q", text:"Reply?" }], answer:() => new Promise(r => { resolveAck = r; }) }]]),
  });
  const pending = f2.service.sendUnsent(f2.project, f2.slug, { agent:"claude", step:"ask-2" });
  await until(() => Boolean(resolveAck), "live delivery in flight");
  // Remove the tagged in-flight draft (ask-2); identical untagged sibling slides into ask-2
  f2.write(F.updateSteps(f2.read(), steps => { steps.splice(steps.findIndex(s => F.isUnsent(s) && s.draftId), 1); }));
  resolveAck();
  await assert.rejects(pending, { code:"DELIVERED_CONFLICT", status:409 });
  const remainingUnsent = f2.doc().steps.filter(F.isUnsent);
  assert.equal(remainingUnsent.length, 1, "identical untagged sibling draft preserved untouched");
  assert.equal(remainingUnsent[0].text, "Same text");
});

test("PE-887 R2 P1-9: answering completed Work with trailing legacy sent Ask pins exact continuation Work, not synthesized legacy Work", async t => {
  const f = reviewWait(t, "**Pick?** (@claude)\n<!-- work: work-1 -->\n- [ ] Yes", "## Ask\n\nStart\n\n## [x] Work 1 · @claude\n\n## Ask\n\nSecond\n\n## [ ] Work 2 · @codex\n\n## Ask\n\nLegacy trailing ask");
  const claudeOrig = { id:"p-claude-orig", agent:"claude", model:"claude-opus-orig", effort:"high", access:"full" };
  f.service.presets = { get:() => null, defaultPreset:() => null, handOver:p => ({ model:p.model, effort:p.effort, access:p.access }) };
  f.service.pinSettings(f.project, f.slug, f.doc().steps.find(s => s.id === "work-1"), null, claudeOrig);
  f.service.runs.set(f.key, { agent:"codex", stepId:"work-2", stopping:false, pendingRequests:new Map() });

  const res = await f.answer({ stepId:"work-1", question:f.doc().questions[0].id, answer:"Yes" });
  assert.equal(res.mode, "queued");
  const steps = f.doc().steps;
  const legacySynth = steps.find(s => s.id === "work-3");
  const contWork = steps.find(s => s.replaces === "work-1");
  assert.equal(legacySynth.who, "codex", "legacy sent Ask synthesized as Codex Work 3");
  assert.equal(contWork.id, "work-4", "Claude continuation inserted as Work 4");
  assert.equal(contWork.who, "claude");
  assert.equal(f.service.presetFor(f.project, f.slug, "claude", contWork.id)?.model, "claude-opus-orig", "Work 4 receives Claude original pin");
  assert.notEqual(f.service.presetFor(f.project, f.slug, "codex", legacySynth.id)?.model, "claude-opus-orig", "synthesized legacy Work 3 did NOT steal Claude pin");
});

test("PE-887 R2 P2-2: runSteers matches sendUnsent with sibling options, and stale expectedMode=steer rejects 409 without queueing", async t => {
  // Case A: running steerable Codex Work 2 + finished Claude Work 1 with Markdown options -> runSteers=true and sendUnsent steers into Codex
  const f = reviewWait(t, "**Pick?** (@claude)\n<!-- work: work-1 -->\n- [ ] Red", "## Ask\n\nStart\n\n## [x] Work 1 · @claude\n\n## Ask\n\nRun codex\n\n## [ ] Work 2 · @codex\n\n## Ask · Not sent\n\nSteer codex now");
  const steered = [];
  const codexRun = { agent:"codex", stepId:"work-2", stopping:false, inputClosed:false, pendingRequests:new Map(), steer:async text => { steered.push(text); } };
  f.service.runs.set(f.key, codexRun);
  const view = f.service.lineFrom(f.project, { slug:f.slug, text:f.read(), doc:f.doc(), mtime:Date.now() });
  assert.equal(view.runSteers, true, "steerable Codex Work 2 advertises runSteers=true despite finished Claude sibling options");

  const draft = f.doc().steps.find(F.isUnsent);
  const res = await f.service.sendUnsent(f.project, f.slug, { step:draft.id, agent:"codex", expectedMode:"steer", expectedAgent:"codex" });
  assert.equal(res.steered, "codex");
  assert.equal(steered.length, 1, "steered directly into Codex instead of queueing");
  assert.match(steered[0], /Steer codex now/);
  assert.equal(f.doc().questions.length, 1, "finished Claude sibling options preserved untouched");
  assert.equal(f.doc().questions[0].workId, "work-1");

  // Case B: stale expectedMode=steer when run can no longer steer rejects 409 STEER_UNAVAILABLE without consuming draft or queueing
  f.write(f.read() + "\n\n## Ask · Not sent\n\nStale steer attempt\n");
  const staleDraft = f.doc().steps.find(F.isUnsent);
  const beforeStale = f.read();
  codexRun.inputClosed = true;
  await assert.rejects(
    f.service.sendUnsent(f.project, f.slug, { step:staleDraft.id, agent:"codex", expectedMode:"steer", expectedAgent:"codex" }),
    { code:"STEER_UNAVAILABLE", status:409 }
  );
  assert.equal(f.read(), beforeStale, "rejected stale steer leaves draft untouched and does not queue");

  // Case C: runtime steer() rejection with expectedMode=steer also rejects 409 STEER_UNAVAILABLE without queueing
  codexRun.inputClosed = false;
  codexRun.steer = async () => { throw Error("stdin closed"); };
  await assert.rejects(
    f.service.sendUnsent(f.project, f.slug, { step:staleDraft.id, agent:"codex", expectedMode:"steer", expectedAgent:"codex" }),
    { code:"STEER_UNAVAILABLE", status:409 }
  );
  assert.equal(f.read(), beforeStale, "failed runtime steer with expectedMode=steer does not silently queue");
});

test("PE-887 R2 P2-4: Panorama answerButton and rowActions rank local Work options ahead of external open-desktop fallback", () => {
  const { document, window } = parseHTML("<html><body></body></html>");
  const read = name => fs.readFileSync(path.join(__dirname, "../public/lines", name + ".js"), "utf8");
  const c = vm.createContext({
    document, window, console, ACT:{}, HOSTED:false, S:{ cur:"p1", plan:[], lineMarkSaving:new Set() },
    STATE_TEXT:{ ready:"Ready", reviewed:"Reviewed", archived:"Archived" },
    esc:s => String(s ?? "").replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch])),
    ic:() => "", isWork:s => s?.kind === "work", openQuestions:l => l.questions || [],
    agentInfo:id => ({ id, name:id }), lineState:() => "wait", rowMark:() => "you",
    currentStation:l => l.stations[0] || {}, endStoppedButton:() => "", todoMark:() => "",
    lineWorking:() => false, toReview:() => false, nextToReview:() => false, canMarkReviewed:() => false,
    canMerge:() => false, lineById:() => null, mergeTarget:() => ({ name:"main" }), unsentSendHTML:() => "",
    canStop:() => false, lineContinue:() => "", lineNeedsYou:() => true, isTodo:() => false, lineReviewed:() => false,
    lineStopButton:() => "",
  });
  // Load answerAct from line.js + panorama.js
  const lineSrc = read("line");
  vm.runInContext(lineSrc.slice(lineSrc.indexOf("function answerAct("), lineSrc.indexOf("// Interactive question card")), c);
  vm.runInContext(read("panorama"), c);

  const mixedLine = {
    id:"mixed", slug:"mixed", status:"waiting", waitingForReply:true,
    asking:{ kind:"tool", id:"ext-1", agent:"claude", step:"work-1", answerable:false, isBlocking:true, questions:[{ text:"External?" }] },
    conversations:{ claude:{ canOpen:true, opensApp:true, app:"Claude" } },
    questions:[{ id:"q-local", workId:"work-2", text:"Local option?", options:["Yes", "No"] }],
    stations:[
      { id:"work-1", kind:"work", agent:"claude", asked:true, asking:{ kind:"tool", agent:"claude", step:"work-1", answerable:false, isBlocking:true } },
      { id:"work-2", kind:"work", agent:"codex", state:"wait", questions:[{ id:"q-local", workId:"work-2", text:"Local option?", options:["Yes", "No"] }] },
    ],
  };
  const btn = c.answerButton(mixedLine);
  assert.match(btn, /data-act="need-reply"/, "answerButton picks local need-reply ahead of external desktop");
  assert.match(btn, /data-step="work-2"/, "answerButton targets the local actionable work-2");
  assert.doesNotMatch(btn, /open-desktop/);

  const rowBtn = c.rowActions({ id:"p1" }, mixedLine);
  assert.match(rowBtn, /data-act="need-reply"/, "rowActions picks local need-reply ahead of external desktop");
  assert.match(rowBtn, /data-step="work-2"/, "rowActions targets local work-2");
  assert.doesNotMatch(rowBtn, /open-desktop/);

  // Contrast: when NO local Work is actionable, external desktop fallback still renders open-desktop
  const extOnly = { ...mixedLine, questions:[], stations:[mixedLine.stations[0]] };
  assert.match(c.answerButton(extOnly), /data-act="open-desktop"/);
  assert.match(c.rowActions({ id:"p1" }, extOnly), /data-act="open-desktop"/);

  // R3 P2-4: on a followed (elsewhere:true) Line, Markdown chooser is unavailable in the panel, so Panorama & answerAct fall back to open-desktop
  const elsewhereMixed = { ...mixedLine, elsewhere:true };
  assert.match(c.answerButton(elsewhereMixed), /data-act="open-desktop"/, "elsewhere Line falls back to open-desktop instead of empty sibling panel");
  assert.match(c.rowActions({ id:"p1" }, elsewhereMixed), /data-act="open-desktop"/, "elsewhere rowActions falls back to open-desktop");
  assert.match(c.answerAct(elsewhereMixed), /data-act="open-desktop"/, "elsewhere answerAct falls back to open-desktop");
});

// =========================================================================
// 23. PE-887 Round 3 verification regressions (legacy keeper turnOver, draft link edit, stale Steer targeting & attachments)
// =========================================================================
test("PE-887 R3 P1-1: legacy pre-fix keeper snapshot carrying only poll-time turnOver does not warm a cold held session", async t => {
  const Tokens = require("../src/server/project-lines/token-evidence.js");
  const f = reviewWait(t, "**Color?** (@claude)\n- [ ] Red", "## Ask\n\nOriginal\n\n## [ ] Work 1 · @claude");
  const now = Date.now(), twoHoursAgo = now - 2 * 3600 * 1000;
  const evidence = Tokens.create({ workId:"work-1", taskId:"t-legacy", taskMode:"new" });
  Tokens.startAttempt(evidence, { agent:"claude", at:twoHoursAgo }).requests.push({ id:"req-old", at:twoHoursAgo, inputTokens:20000, model:"claude-sonnet" });
  let steerCalls = 0, stopCalls = 0;
  // Restored pre-fix keeper snapshot: has poll-time turnOver=now, NO turnOverAt
  const legacyRestored = {
    stepId:"work-1", agent:"claude", started:twoHoursAgo - 5000, heardAt:now,
    turnOver:now,
    tokenEvidence:evidence,
    steer:async () => { steerCalls++; },
  };
  f.service.runs.set(f.key, legacyRestored);
  f.service.stopHeldAndWait = async (_project, _slug, runs) => { stopCalls++; assert.deepEqual(runs, [legacyRestored]); f.service.runs.delete(f.key); };
  const res = await f.answer({ question:f.doc().questions[0].id, answer:"Red" });
  assert.equal(steerCalls, 0, "legacy poll-time turnOver without turnOverAt must NOT steer a cold held session");
  assert.equal(stopCalls, 1);
  assert.equal(res.steered, false);
  const added = f.doc().steps.find(s => s.replaces === "work-1");
  assert.equal(F.splitFront(f.service.store.readText(f.project, F.detailPath(f.slug, added.id)).text).front["task mode"], "new");
});

test("PE-887 R3 P1-6: replacing link-only attachment during live delivery rejects 409 DELIVERED_CONFLICT, keeps edit and delivery fence", async t => {
  const f = reviewWait(t, "", "## Ask\n\nStart\n\n## [ ] Work 1 · @claude\n\n## Ask · Not sent\n\nCheck file\n\n[old.txt](../files/old.txt)");
  let resolveAck, calls = 0;
  f.service.runs.set(f.key, {
    agent:"claude", stepId:"work-1", launchId:"launch-att", modelActivityAt:Date.now(),
    pendingRequests:new Map([["r-att", { id:"r-att", questions:[{ id:"q", text:"Reply?" }], answer:() => { calls++; return new Promise(r => { resolveAck = r; }); } }]]),
  });
  const pending = f.service.sendUnsent(f.project, f.slug, { agent:"claude", step:"ask-2" });
  await until(() => Boolean(resolveAck), "live delivery in flight");
  // Replace only the link-only attachment line while delivery is in flight (exact.text is unchanged!)
  f.write(f.read().replace("[old.txt](../files/old.txt)", "[new.txt](../files/new.txt)"));
  resolveAck();
  await assert.rejects(pending, { code:"DELIVERED_CONFLICT", status:409 });
  const rawAfter = f.read();
  assert.ok(rawAfter.includes("[new.txt](../files/new.txt)"), "edited draft attachment preserved");
  assert.ok(!rawAfter.includes("[old.txt](../files/old.txt)"), "stale old.txt was NOT recorded");
  // Delivery fence remains active on conflict so retrying cannot double-deliver
  await assert.rejects(f.service.sendUnsent(f.project, f.slug, { agent:"claude", step:"ask-2" }), { code:"DELIVERY_UNCONFIRMED", status:409 });
  assert.equal(calls, 1);
});

test("PE-887 R3 P2-2: stale Steer rejects new tool prompts, wrong Work/launch, and attached drafts on held Markdown-option Works", async t => {
  // 1) Steer click races new 1-question and 2-question live tool prompts -> rejects 409 STEER_UNAVAILABLE before delivery or stop
  for (const qs of [[{ id:"q1", text:"One?" }], [{ id:"q1", text:"One?" }, { id:"q2", text:"Two?" }]]) {
    const f = reviewWait(t, "", "## Ask\n\nStart\n\n## [ ] Work 1 · @claude\n\n## Ask · Not sent\n\nSteer text");
    let answerCalls = 0, stopCalls = 0;
    f.service.runs.set(f.key, {
      agent:"claude", stepId:"work-1", launchId:"launch-1", modelActivityAt:Date.now(),
      steer:async () => {},
      pendingRequests:new Map([["req", { id:"req", questions:qs, answer:async () => { answerCalls++; } }]]),
    });
    f.service.stopHeldAndWait = async () => { stopCalls++; };
    const before = f.read();
    await assert.rejects(
      f.service.sendUnsent(f.project, f.slug, { step:"ask-2", agent:"claude", expectedMode:"steer", expectedAgent:"claude", expectedStep:"work-1", expectedLaunch:"launch-1" }),
      { code:"STEER_UNAVAILABLE", status:409 }
    );
    assert.equal(answerCalls, 0, "stale Steer must not answer newly opened tool prompt");
    assert.equal(stopCalls, 0, "stale Steer must not stop Work 1 on multi-question prompt");
    assert.equal(f.read(), before, "draft and Line untouched");
  }

  // 2) Stale Steer targeting Claude Work 1 (launch-1) does NOT steer into Claude Work 2 (launch-2)
  const f2 = reviewWait(t, "", "## Ask\n\nStart\n\n## [x] Work 1 · @claude\n\n## Ask\n\nNext\n\n## [ ] Work 2 · @claude\n\n## Ask · Not sent\n\nFor work 1");
  let steerCalls = 0;
  f2.service.runs.set(f2.key, { agent:"claude", stepId:"work-2", launchId:"launch-2", stopping:false, inputClosed:false, pendingRequests:new Map(), steer:async () => { steerCalls++; } });
  const before2 = f2.read();
  await assert.rejects(
    f2.service.sendUnsent(f2.project, f2.slug, { step:"ask-3", agent:"claude", expectedMode:"steer", expectedAgent:"claude", expectedStep:"work-1", expectedLaunch:"launch-1" }),
    { code:"STEER_UNAVAILABLE", status:409 }
  );
  assert.equal(steerCalls, 0, "stale Steer for work-1 must not steer into work-2");
  assert.equal(f2.read(), before2);

  // 3) Warm held Work with Markdown options + attached draft: server rejects expectedMode=steer and UI runMode advertises 'next'
  const f3 = reviewWait(t, "**Pick?** (@claude)\n<!-- work: work-1 -->\n- [ ] Yes", "## Ask\n\nStart\n\n## [ ] Work 1 · @claude\n\n## Ask · Not sent\n\nWith file\n\n[spec.txt](../files/spec.txt)");
  f3.service.runs.set(f3.key, { agent:"claude", stepId:"work-1", launchId:"launch-3", modelActivityAt:Date.now(), stopping:false, inputClosed:false, pendingRequests:new Map(), steer:async () => { assert.fail("attached draft cannot steer into Markdown-question run"); } });
  const view3 = f3.service.lineFrom(f3.project, { slug:f3.slug, text:f3.read(), doc:f3.doc(), mtime:Date.now() });
  assert.equal(view3.runHasQuestions, true);
  assert.equal(view3.runStep, "work-1");
  assert.equal(view3.runLaunch, "launch-3");
  const attachedStation = view3.stations.find(s => s.unsent);
  assert.equal(attachedStation.hasRefs, true);
  const { c } = loadLineUi();
  assert.equal(c.runMode(view3, "claude", null, attachedStation), "next", "UI advertises 'next' (not 'steer') for attached draft on Markdown-question run");
  await assert.rejects(
    f3.service.sendUnsent(f3.project, f3.slug, { step:"ask-2", agent:"claude", expectedMode:"steer", expectedAgent:"claude", expectedStep:"work-1", expectedLaunch:"launch-3" }),
    { code:"STEER_UNAVAILABLE", status:409 }
  );

  // 4) R4 P2-2: clicking 'Run with Claude next' (expectedMode='next') on an attached draft queues behind the warm waiting Work without stopping it or clearing its options
  let stop3 = 0;
  f3.service.stopHeldAndWait = async () => { stop3++; };
  const nextRes = await f3.service.sendUnsent(f3.project, f3.slug, { step:"ask-2", agent:"claude", expectedMode:"next" });
  assert.equal(stop3, 0, "expectedMode=next must NOT stop the running/held Work");
  assert.equal(nextRes.mode, "queued");
  assert.equal(nextRes.next, "claude");
  assert.equal(f3.doc().questions.length, 1, "held Work's Markdown options stay intact when queueing next");
  assert.equal(f3.doc().steps.filter(F.AGENT_LIKE).length, 2, "attached draft queued as Work 2 behind Work 1");

  // 5) R4 P2-2: open unsent-run-pick menu captures its Steers-in snapshot at open time and posts the original launch even after state refreshes
  const ui = loadLineUi();
  const posted = [];
  const lineState = {
    id:"line-a", slug:"line-a", status:"working", running:true, elsewhere:false,
    runAgent:"claude", runStep:"work-1", runLaunch:"launch-old", runSteers:true, runHasQuestions:false, runSetup:"|",
    stations:[
      { id:"work-1", index:0, kind:"work", state:"active", agent:"claude", pictures:[], files:[], refers:[] },
      { id:"ask-2", index:1, kind:"ask", state:"todo", unsent:true, text:"Draft", pictures:[], files:[], refers:[] },
    ],
  };
  ui.c.S.projects = [{ id:"p1", name:"P", defaultAgent:"claude" }];
  ui.c.S.state.p1 = { lines:[lineState] };
  ui.c.S.agents = [{ id:"claude", name:"Claude", available:true }];
  ui.c.runnableAgents = () => ui.c.S.agents;
  ui.c.runPresets = () => [];
  ui.c.presetById = () => null;
  ui.c.api = async (_url, opts) => { posted.push(opts.body); return { ok:true }; };
  ui.document.getElementById("view").innerHTML = `<button type="button" data-act="unsent-run-pick" data-line="line-a" data-step="ask-2"></button>`;
  const pickBtn = ui.document.querySelector('[data-act="unsent-run-pick"]');
  ui.c.ACT["unsent-run-pick"](pickBtn);
  const menuEntry = ui.c._lastMenu.find(item => item.label === "Claude");
  assert.equal(menuEntry.note, "Steers in");
  // Simulate Line refresh while menu stays open: launch changes to launch-new AND a live tool prompt appears (runSteers becomes false)
  lineState.runLaunch = "launch-new";
  lineState.runSteers = false;
  menuEntry.fn();
  await new Promise(r => setImmediate(r));
  assert.equal(posted.length, 1);
  assert.deepEqual(
    { expectedMode:posted[0].expectedMode, expectedAgent:posted[0].expectedAgent, expectedStep:posted[0].expectedStep, expectedLaunch:posted[0].expectedLaunch },
    { expectedMode:"steer", expectedAgent:"claude", expectedStep:"work-1", expectedLaunch:"launch-old" },
    "open menu posts the Steer snapshot captured when opened, not the refreshed launch/mode"
  );
});

test("PE-904 regression: answering a finished Work's options queues behind an active Work even when the active Work already has Markdown questions, and resumeWork preserves replaces", async t => {
  const f = reviewWait(
    t,
    "",
    "## Ask\n\nAsk omp\n\n## [ ] Work 1 · @omp\n\n## Ask\n\nAsk opencode\n\n## [x] Work 2 · @opencode\n\n<!-- penecho-replaces: work-1 -->\n\n[Details](../works/review-wait/work-2.md)"
  );
  f.service.store.writeText(f.project, F.detailPath(f.slug, "work-1"), "## Questions for you\n\n**Active omp question?** (@omp)\n- [ ] Alpha\n- [ ] Beta\n");
  f.service.store.writeText(f.project, F.detailPath(f.slug, "work-2"), "## Questions for you\n\n**Finished opencode question?** (@opencode)\n- [ ] All five\n- [ ] Only two\n");
  f.service.runs.set(f.key, { agent:"omp", stepId:"work-1", stopping:false, pendingRequests:new Map() });

  const qs = f.service.lineQuestionsState(f.project, f.slug, f.doc());
  const w2q = qs.byStep.get("work-2")[0];
  const res = await f.answer({ stepId:"work-2", question:w2q.id, answer:"All five", questionRev:qs.revByStep.get("work-2") });
  assert.equal(res.ok, true);
  assert.equal(res.mode, "queued", "explicit finished Work option reply queues behind active Work that has Markdown questions");
  const cont = f.doc().steps.find(s => s.replaces === "work-2" && !s.done);
  assert.ok(cont, "queued continuation step created for Work 2");
  assert.equal(cont.who, "opencode");
  assert.equal(F.parseDetailQuestions(f.service.store.readText(f.project, F.detailPath(f.slug, "work-1")).text, { workId:"work-1" }).length, 1, "active Work 1's Markdown options preserved");

  // resumeWork() must keep <!-- penecho-replaces: ... --> intact if a finished replacement Work is genuinely reopened.
  f.service.runs.clear();
  f.service.resumeWork(f.project, { slug:f.slug, stepId:"work-2", agent:"opencode", interrupted:false });
  const reopened = f.doc().steps.find(s => s.id === "work-2");
  assert.equal(reopened.done, false);
  assert.equal(reopened.replaces, "work-1", "resumeWork preserves penecho-replaces marker");
});
