"use strict";
require("./helpers/safety.js");
// A run PenEcho started that its agent finished, or that sits still on a command that never ends, is put right by itself (PE-499, PE-487).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { Service } = require("../src/server/project-lines/service.js");
const { createOrchestrator } = require("../src/server/project-lines/orchestrator.js");
const F = require("../src/server/project-lines/format.js");
const W = require("../src/server/project-lines/run-watch.js");

const MIN = 60000;
const tree = (cpu, below = [2]) => ({ cpu, below });

test("an answered turn held open by an idle leftover command: the command is stopped, then the agent", () => {
  const t0 = 1e12, r = { started:t0, heardAt:t0, turnOver:t0, said:"Done." };
  assert.equal(W.decide(r, tree(100), t0 + 1000), null);
  assert.equal(W.decide(r, tree(150), t0 + 5 * MIN), null);
  assert.equal(W.decide(r, tree(200), t0 + 11 * MIN), "free");
  assert.equal(W.decide(r, tree(200), t0 + 11.5 * MIN), null, "it gets a minute to end by itself");
  assert.equal(W.decide(r, tree(200), t0 + 12.1 * MIN), "end");
});

test("a command still doing real work after the answer is left alone", () => {
  const t0 = 1e12, r = { started:t0, heardAt:t0, turnOver:t0, said:"Started the build; I will report." };
  for (let m = 0; m <= 60; m++) assert.equal(W.decide(r, tree(m * 30000), t0 + 1000 + m * MIN), null);
});

test("a usage-limit answer frees the run at once", () => {
  const t0 = 1e12, r = { started:t0, heardAt:t0, turnOver:t0, said:"Claude AI usage limit reached" };
  assert.equal(W.decide(r, tree(100), t0 + MIN, { limitNotice:() => true }), "free");
});

test("a quiet stream whose agent's own record ends in an answer counts as done", () => {
  const t0 = 1e12, r = { started:t0, heardAt:t0, said:"Running the check." };
  let looked = 0;
  const finished = () => { looked++; return { answer:"Removed the tab." }; };
  assert.equal(W.decide(r, tree(100), t0 + 1000, { finished }), null);
  assert.equal(W.decide(r, tree(100), t0 + 5 * MIN, { finished }), null);
  assert.equal(looked, 0, "the record is read only after ten quiet minutes");
  assert.equal(W.decide(r, tree(100), t0 + 10.5 * MIN, { finished }), "free");
  assert.equal(r.transcriptAnswer, "Removed the tab.");
});

test("no word and no work for half an hour is stuck; speaking again starts over", () => {
  const t0 = 1e12, r = { started:t0, heardAt:t0, said:"" };
  assert.equal(W.decide(r, tree(100), t0 + 1000), null);
  assert.equal(W.decide(r, tree(100), t0 + 29 * MIN), null);
  assert.equal(W.decide(r, tree(100), t0 + 31 * MIN), "free");
  r.heardAt = t0 + 31.5 * MIN;
  assert.equal(W.decide(r, tree(100), t0 + 32.5 * MIN), null, "it went back to work after its command was stopped");
  assert.equal(r.watch.freedAt, 0);
  const s = { started:t0, heardAt:t0, said:"" };
  W.decide(s, tree(100, []), t0 + 1000);
  assert.equal(W.decide(s, tree(100, []), t0 + 31 * MIN), "stuck", "nothing left running to stop: the agent itself is stuck");
});

test("a run whose processes cannot be read is never stopped", () => {
  const t0 = 1e12, r = { started:t0, heardAt:t0, turnOver:t0, said:"Done." };
  for (let m = 0; m <= 120; m += 10) assert.equal(W.decide(r, null, t0 + m * MIN), null);
});

test("agents' own records: an answer with no tool call after the run started", () => {
  const at = Date.parse("2026-11-15T17:06:26Z");
  assert.deepEqual(W.antigravityDone([{ type:"PLANNER_RESPONSE", status:"DONE", created_at:"2026-11-15T17:04:50Z", tool_calls:[{ name:"run_command" }] }, { type:"GENERIC", status:"DONE" }, { type:"PLANNER_RESPONSE", status:"DONE", created_at:"2026-11-15T17:06:26Z", content:"Removed the tab." }], at - 1000), { answer:"Removed the tab.", at });
  assert.equal(W.antigravityDone([{ type:"PLANNER_RESPONSE", status:"DONE", created_at:"2026-11-15T17:06:26Z", content:"Calling", tool_calls:[{ name:"x" }] }], 0), null);
  assert.equal(W.antigravityDone([{ type:"PLANNER_RESPONSE", status:"DONE", created_at:"2026-11-15T17:06:26Z", content:"Old answer" }], at + 1000), null, "an answer from an earlier turn");
  assert.equal(W.claudeDone([{ type:"assistant", timestamp:"2026-11-15T17:06:26Z", message:{ content:[{ type:"text", text:"All done." }] } }], 0).answer, "All done.");
  assert.equal(W.claudeDone([{ type:"assistant", timestamp:"2026-11-15T17:06:26Z", message:{ content:[{ type:"tool_use", name:"Bash" }] } }], 0), null);
  assert.equal(W.claudeDone([{ type:"assistant", timestamp:"2026-11-15T17:06:26Z", message:{ content:[{ type:"text", text:"Hi" }] } }, { type:"user", timestamp:"2026-11-15T17:06:27Z" }], 0), null);
});

test("process times and trees", () => {
  assert.equal(W.cpuMs("0:11.50"), 11500);
  assert.equal(W.cpuMs("102:30.95"), 6150950);
  assert.equal(W.cpuMs("1-02:00:00"), 93600000);
  const t = W.treeOf([{ pid:10, ppid:1, cpu:1000 }, { pid:11, ppid:10, cpu:300 }, { pid:12, ppid:11, cpu:200 }, { pid:13, ppid:1, cpu:9999 }], 10);
  assert.deepEqual(t, { below:[11, 12], cpu:1500 });
  assert.equal(W.treeOf([{ pid:13, ppid:1, cpu:1 }], 10), null);
});

// ---------- In the service ----------
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-run-watch-")), directory = path.join(root, "state");
  const children = [], prompts = [];
  const agents = { available:() => [{ id:"pi", available:true, name:"Pi" }], classifier:() => null,
    command:options => ({ command:"stand-in", args:[], cwd:options.workdir, stdin:true, dialect:"pi" }) };
  const spawnFn = () => {
    const stdin = new PassThrough(), child = Object.assign(new EventEmitter(), { pid:900000 + children.length, stdout:new PassThrough(), stderr:new PassThrough(), stdin, killed:false });
    let prompt = ""; stdin.on("data", d => { prompt += d; }); stdin.on("finish", () => prompts.push(prompt));
    child.kill = () => { child.killed = true; setImmediate(() => child.emit("close", null)); };
    children.push(child);
    return child;
  };
  const service = new Service({ directory, agents, autoWatch:false, conversations:{ home:path.join(root, "home"), env:{} }, spawnFn });
  const stopped = [];
  // Never a real signal in a test: the tree is what the test says, and stopping the agent closes it.
  service.stopTree = async (child, { keepRoot = false } = {}) => { stopped.push({ pid:child.pid, keepRoot }); if (!keepRoot) child.kill(); };
  let cpu = 100;
  service.processTable = async () => children.filter(c => !c.killed).flatMap(c => [{ pid:c.pid, ppid:1, cpu }, { pid:c.pid + 50000, ppid:c.pid, cpu:0 }]);
  const project = service.store.create({ name:"Demo", docsPath:path.join(root, "docs") });
  project.defaultAgent = "pi"; service.store.save();
  const { slug } = await service.createTopic(project, { text:"Remove the order tab.", agent:"pi", kinds:["ask", "work"], start:false });
  await service.begin(project, slug);
  t.after(() => { service.runs.clear(); service.close(); fs.rmSync(root, { recursive:true, force:true }); });
  const settle = () => new Promise(resolve => setTimeout(resolve, 50));
  return { service, project, slug, children, prompts, stopped, settle, busy:() => { cpu += 60000; },
    run:() => service.runs.get(service.key(project, slug)),
    doc:() => F.parseLine(service.readDoc(project, slug)),
    detail:stepId => service.store.readText(project, F.detailPath(slug, stepId)).text };
}

test("a Work whose agent finished but stayed open ends as done, with the answer from the agent's own record", async t => {
  const f = await fixture(t), run = f.run(), t0 = run.started;
  f.service.finishedTurn = () => ({ answer:"Removed the order tab.\n\n<!-- penecho: tags=\"Home\" -->" });
  await f.service.watchRuns(t0 + 1000);
  await f.service.watchRuns(t0 + 11 * MIN);
  assert.deepEqual(f.stopped, [{ pid:run.child.pid, keepRoot:true }], "first only what it left running");
  assert.equal(f.doc().status, "working");
  await f.service.watchRuns(t0 + 12.5 * MIN);
  await f.settle();
  assert.deepEqual(f.stopped.at(-1), { pid:run.child.pid, keepRoot:false });
  const doc = f.doc(), step = doc.steps.find(s => s.id === run.stepId);
  assert.equal(step.done, true);
  assert.notEqual(doc.status, "stopped");
  assert.match(f.detail(run.stepId), /Removed the order tab\./);
  assert.doesNotMatch(f.detail(run.stepId), /## Stopped/);
  assert.equal(f.service.runs.size, 0);
});

test("a Work stuck on a command that never ends carries on once by itself, then stops with Retry", async t => {
  const f = await fixture(t), first = f.run(), t0 = first.started;
  await f.service.watchRuns(t0 + 1000);
  await f.service.watchRuns(t0 + 31 * MIN);
  await f.service.watchRuns(t0 + 32.5 * MIN);
  await f.settle();
  const second = f.run();
  assert.ok(second && second !== first, "it carried on in a new run");
  assert.equal(f.children.length, 2);
  assert.match(f.prompts.at(-1) || "", /never ended/);
  assert.equal(f.doc().status, "working");
  const t1 = t0 + 40 * MIN;
  await f.service.watchRuns(t1);
  await f.service.watchRuns(t1 + 31 * MIN);
  await f.service.watchRuns(t1 + 32.5 * MIN);
  await f.settle();
  assert.equal(f.children.length, 2, "only once");
  assert.equal(f.doc().status, "stopped");
  assert.match(f.doc().front.why, /sat still/);
});

test("a run doing real work is never touched, however quiet", async t => {
  const f = await fixture(t), run = f.run(), t0 = run.started;
  f.service.finishedTurn = () => null;
  for (let m = 0; m <= 120; m += 5) { f.busy(); await f.service.watchRuns(t0 + 1000 + m * MIN); }
  assert.deepEqual(f.stopped, []);
  assert.equal(f.run(), run);
});

test("Stop ends the agent with everything it started", async t => {
  const f = await fixture(t), run = f.run();
  await f.service.stopWork(f.project, f.slug);
  assert.deepEqual(f.stopped, [{ pid:run.child.pid, keepRoot:false }]);
});

test("antigravityDone ignores interim status text while a non-daemon background task is still running", () => {
  const at = Date.parse("2026-11-20T03:33:51Z");
  const tid = "65379913-c21e-431a-b486-9a9be40f06fe/task-18";
  const waitingTurn = [
    { step_index:0, type:"USER_INPUT", status:"DONE", created_at:"2026-11-20T03:31:17Z" },
    { step_index:17, type:"PLANNER_RESPONSE", status:"DONE", created_at:"2026-11-20T03:33:10Z", tool_calls:[{ name:"run_command", args:{ CommandLine:'"python3 wait.py"', WaitMsBeforeAsync:"10000" } }] },
    { step_index:18, type:"GENERIC", status:"RUNNING", created_at:"2026-11-20T03:33:38Z", content:`Created At: 2026-11-20T03:33:38Z\nTool is running as a background task with task id: ${tid}\nTask Description: python3 wait.py` },
    { step_index:19, type:"PLANNER_RESPONSE", status:"DONE", created_at:"2026-11-20T03:33:51Z", content:"Waiting for the codebase research task to complete." },
  ];
  assert.equal(W.antigravityDone(waitingTurn, at - 60000), null, "background task still running in this turn");

  // Once the background task wakes the agent via SYSTEM_MESSAGE and it gives its final answer, it counts as done.
  const doneAt = Date.parse("2026-11-20T04:05:00Z");
  const finishedTurn = [
    ...waitingTurn,
    { step_index:20, type:"SYSTEM_MESSAGE", status:"DONE", content:`<SYSTEM_MESSAGE>\n[Message] sender=${tid} content=Task id "${tid}" completed` },
    { step_index:21, type:"PLANNER_RESPONSE", status:"DONE", created_at:"2026-11-20T04:05:00Z", content:"Final design ready." },
  ];
  assert.deepEqual(W.antigravityDone(finishedTurn, at - 60000), { answer:"Final design ready.", at:doneAt });

  // A task killed via manage_task also clears it.
  const killedTurn = [
    ...waitingTurn,
    { step_index:20, type:"PLANNER_RESPONSE", status:"DONE", tool_calls:[{ name:"manage_task", args:{ Action:'"kill"', TaskId:JSON.stringify(tid) } }] },
    { step_index:21, type:"GENERIC", status:"DONE", content:"Task killed." },
    { step_index:22, type:"PLANNER_RESPONSE", status:"DONE", created_at:"2026-11-20T04:05:00Z", content:"Stopped and done." },
  ];
  assert.deepEqual(W.antigravityDone(killedTurn, at - 60000), { answer:"Stopped and done.", at:doneAt });

  // An unclosed background task from an earlier turn (before the latest USER_INPUT) does not block a later turn.
  const laterTurn = [
    ...waitingTurn,
    { step_index:20, type:"USER_INPUT", status:"DONE", created_at:"2026-11-20T04:00:00Z" },
    { step_index:21, type:"PLANNER_RESPONSE", status:"DONE", created_at:"2026-11-20T04:05:00Z", content:"Done in new turn." },
  ];
  assert.deepEqual(W.antigravityDone(laterTurn, at - 60000), { answer:"Done in new turn.", at:doneAt });

  // Explicit IsDaemon:true background servers do not block cleanup after a finished answer.
  const daemonTurn = [
    { step_index:0, type:"USER_INPUT", status:"DONE" },
    { step_index:1, type:"PLANNER_RESPONSE", status:"DONE", tool_calls:[{ name:"run_command", args:{ CommandLine:'"node demo.mjs"', IsDaemon:"true" } }] },
    { step_index:2, type:"GENERIC", status:"RUNNING", content:"Tool is running as a background task with task id: cid/task-2\nTask Description: node demo.mjs" },
    { step_index:3, type:"PLANNER_RESPONSE", status:"DONE", created_at:"2026-11-20T04:05:00Z", content:"Demo server ready." },
  ];
  assert.deepEqual(W.antigravityDone(daemonTurn, at - 60000), { answer:"Demo server ready.", at:doneAt });

  // Parallel daemon + non-daemon still waits for the non-daemon task.
  const mixedTurn = [
    { step_index:0, type:"USER_INPUT", status:"DONE" },
    { step_index:1, type:"PLANNER_RESPONSE", status:"DONE", tool_calls:[
      { name:"run_command", args:{ CommandLine:'"node demo.mjs"', IsDaemon:"true" } },
      { name:"run_command", args:{ CommandLine:'"curl wait"' } },
    ] },
    { step_index:2, type:"GENERIC", status:"RUNNING", content:"Tool is running as a background task with task id: cid/task-2\nTask Description: node demo.mjs" },
    { step_index:3, type:"GENERIC", status:"RUNNING", content:"Tool is running as a background task with task id: cid/task-3\nTask Description: curl wait" },
    { step_index:4, type:"PLANNER_RESPONSE", status:"DONE", created_at:"2026-11-20T04:05:00Z", content:"Waiting for sub-Line." },
  ];
  assert.equal(W.antigravityDone(mixedTurn, at - 60000), null);

  // An anonymous still-running step without a task id also blocks done until a DONE update for that step arrives.
  const anonRunning = [
    { step_index:0, type:"USER_INPUT", status:"DONE" },
    { step_index:1, type:"PLANNER_RESPONSE", status:"DONE", created_at:"2026-11-20T04:05:00Z", content:"Working." },
    { step_index:2, type:"GENERIC", status:"RUNNING", content:"Created At: 2026-11-20T04:05:01Z\nStep is still running" },
  ];
  assert.equal(W.antigravityDone(anonRunning, at - 60000), null);
});

test("decide leaves an orchestrator waiting on sub-Lines alone past quiet and stuck limits", () => {
  const t0 = 1e12, r = { started:t0, heardAt:t0, said:"Waiting." };
  let looked = 0;
  const finished = () => { looked++; return { answer:"Waiting." }; };
  for (let m = 0; m <= 60; m += 5) {
    assert.equal(W.decide(r, tree(100), t0 + 1000 + m * MIN, { finished, waiting:true }), null);
  }
  assert.equal(looked, 0, "does not probe transcript while orchestrator wait is active");
  // Once waiting ends, idle time starts fresh from when waiting ended rather than firing immediately.
  assert.equal(W.decide(r, tree(100), t0 + 62 * MIN, { finished, waiting:false }), null);
  assert.equal(W.decide(r, tree(100), t0 + 72 * MIN, { finished, waiting:false }), "free");
});

test("service watchRuns does not kill an orchestrator while its wait call is active on a running sub-Line", async t => {
  const f = await fixture(t), run = f.run(), t0 = run.started;
  const orch = f.service.orchestrator = createOrchestrator({ service:f.service, directory:path.dirname(f.service.store.file) });
  // Create a running sub-Line so orchestrator wait stays pending.
  const child = await f.service.createTopic(f.project, { text:"Research codebase.", agent:"pi", kinds:["ask", "work"], start:false });
  await f.service.begin(f.project, child.slug);
  f.service.finishedTurn = () => ({ answer:"Waiting for the codebase research task to complete." });

  const abort = new AbortController();
  const waitPromise = orch.call(f.project, { do:"wait", lines:[child.slug], seconds:60 }, { session:f.slug, signal:abort.signal });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(orch.isWaiting(f.project, f.slug), true);
  assert.equal(orch.isWaiting(f.project, child.slug), false);

  // Even past both QUIET_MS (10 min) and STUCK_MS (30 min) with 0 CPU, watchRuns must leave the waiting orchestrator alone.
  await f.service.watchRuns(t0 + 1000);
  await f.service.watchRuns(t0 + 11 * MIN);
  await f.service.watchRuns(t0 + 40 * MIN);
  assert.deepEqual(f.stopped.filter(s => s.pid === run.child.pid), [], "waiting orchestrator was not freed or killed");
  assert.equal(f.run(), run);

  abort.abort();
  await waitPromise;
  assert.equal(orch.isWaiting(f.project, f.slug), false);
});

test("streaming agent reporting active background tasks does not mark turnOver on interim result", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-bg-turn-")), directory = path.join(root, "state");
  let child;
  const agents = { available:() => [{ id:"claude", available:true, name:"Claude" }], classifier:() => null,
    command:options => ({ command:"stand-in", args:[], cwd:options.workdir, stdin:true, input:"stream-json" }) };
  const spawnFn = () => {
    const stdin = new PassThrough();
    child = Object.assign(new EventEmitter(), { pid:910001, stdout:new PassThrough(), stderr:new PassThrough(), stdin, killed:false });
    child.kill = () => { child.killed = true; setImmediate(() => child.emit("close", 0)); };
    return child;
  };
  const service = new Service({ directory, agents, autoWatch:false, conversations:{ home:path.join(root, "home"), env:{} }, spawnFn });
  const project = service.store.create({ name:"Demo", docsPath:path.join(root, "docs") });
  project.defaultAgent = "claude"; service.store.save();
  const { slug } = await service.createTopic(project, { text:"Coordinate.", agent:"claude", kinds:["ask", "work"], start:false });
  await service.begin(project, slug);
  t.after(() => { service.runs.clear(); service.close(); fs.rmSync(root, { recursive:true, force:true }); });

  const run = service.runs.get(service.key(project, slug));
  child.stdout.write(`${JSON.stringify({ type:"system", subtype:"background_tasks_changed", tasks:[{ id:"t1" }] })}\n`);
  child.stdout.write(`${JSON.stringify({ type:"result", result:"Waiting on sub-Line." })}\n`);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(run.background, 1);
  assert.ok(!run.turnOver, "interim result with background tasks must not set turnOver");
  assert.equal(child.stdin.writableEnded, false);

  child.stdout.write(`${JSON.stringify({ type:"system", subtype:"background_tasks_changed", tasks:[] })}\n`);
  child.stdout.write(`${JSON.stringify({ type:"result", result:"All done." })}\n`);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(run.background, 0);
  assert.ok(run.turnOver > 0, "final result with no background tasks sets turnOver");
  assert.equal(child.stdin.writableEnded, true);
});

test("antigravityDone rejects pre-wakeup waiting text, prefix/reminder false clears, long >256 KiB turns, and trailing errors (PE-775 W2, PE-779 W1)", t => {
  const at = Date.parse("2026-11-20T04:57:13Z");
  const doneAt = Date.parse("2026-11-20T05:12:00Z");

  // 1. Completion wakeup arrived after the waiting response, before the model's post-wakeup response.
  const midWakeup = [
    { step_index:0, type:"USER_INPUT", status:"DONE" },
    { step_index:17, type:"PLANNER_RESPONSE", status:"DONE", tool_calls:[{ name:"run_command", args:{ CommandLine:'"gh run watch 44677775746"' } }] },
    { step_index:18, type:"GENERIC", status:"RUNNING", content:"Tool is running as a background task with task id: cid/task-18\nTask Description: gh run watch 44677775746" },
    { step_index:19, type:"PLANNER_RESPONSE", status:"DONE", created_at:"2026-11-20T04:57:13Z", content:"Waiting for completion." },
    { step_index:20, type:"SYSTEM_MESSAGE", status:"DONE", content:'<SYSTEM_MESSAGE>\n[Message] timestamp=2026-11-20T05:11:32Z sender=cid/task-18 content=Task id "cid/task-18" finished with result:\nOK' },
  ];
  assert.equal(W.antigravityDone(midWakeup, at - 60000), null, "pre-wakeup waiting text must not look final");
  assert.equal(W.antigravityTurnState(midWakeup, at - 60000).unansweredWakeup, true);

  // 2. Prefix collision (task-20 vs task-2) and non-completion reminder do not clear still-running tasks.
  const prefixTurn = [
    { step_index:0, type:"USER_INPUT", status:"DONE" },
    { step_index:1, type:"PLANNER_RESPONSE", status:"DONE", tool_calls:[{ name:"run_command", args:{ CommandLine:'"node app.mjs"' } }] },
    { step_index:2, type:"GENERIC", status:"RUNNING", content:"Tool is running as a background task with task id: cid/task-2\nTask Description: node app.mjs" },
    { step_index:3, type:"PLANNER_RESPONSE", status:"DONE", tool_calls:[{ name:"run_command", args:{ CommandLine:'"python3 wait.py"' } }] },
    { step_index:4, type:"GENERIC", status:"RUNNING", content:"Tool is running as a background task with task id: cid/task-20\nTask Description: python3 wait.py" },
    { step_index:5, type:"SYSTEM_MESSAGE", status:"DONE", content:'[Message] sender=cid/task-20 content=Task id "cid/task-20" finished with result:\nOK' },
    { step_index:6, type:"SYSTEM_MESSAGE", status:"DONE", content:"Reminder: task id cid/task-2 is still running. Do not start it again." },
    { step_index:7, type:"PLANNER_RESPONSE", status:"DONE", created_at:"2026-11-20T05:12:00Z", content:"Waiting for app." },
  ];
  assert.equal(W.antigravityDone(prefixTurn, at - 60000), null, "task-20 completion and reminder must not clear task-2");
  assert.deepEqual(W.antigravityTurnState(prefixTurn, at - 60000).pendingTasks, ["cid/task-2"]);

  // 3. Parallel daemon + non-daemon sharing a >40-char working-directory prefix, plus paraphrased daemon beside another call.
  const longPrefix = "cd /Users/heack/workspace/penecho_071_version/very/long/subdir && ";
  const sharedPrefixTurn = [
    { step_index:0, type:"USER_INPUT", status:"DONE" },
    { step_index:1, type:"PLANNER_RESPONSE", status:"DONE", tool_calls:[
      { name:"RUN_COMMAND", args:{ CommandLine:JSON.stringify(`${longPrefix}node server.mjs`), IsDaemon:true } },
      { name:"run_command", args:{ CommandLine:JSON.stringify(`${longPrefix}node --test`) } },
    ] },
    { step_index:2, type:"GENERIC", status:"RUNNING", content:`Tool is running as a background task with task id: cid/task-2\nTask Description: ${longPrefix}node server.mjs` },
    { step_index:3, type:"GENERIC", status:"RUNNING", content:`Tool is running as a background task with task id: cid/task-3\nTask Description: ${longPrefix}node --test` },
    { step_index:4, type:"PLANNER_RESPONSE", status:"DONE", created_at:"2026-11-20T05:12:00Z", content:"Waiting for tests." },
  ];
  assert.equal(W.antigravityDone(sharedPrefixTurn, at - 60000), null, "non-daemon sharing 40-char prefix with daemon stays pending");
  assert.deepEqual(W.antigravityTurnState(sharedPrefixTurn, at - 60000).pendingTasks, ["cid/task-3"]);

  const paraphrasedDaemon = [
    { step_index:0, type:"USER_INPUT", status:"DONE" },
    { step_index:1, type:"PLANNER_RESPONSE", status:"DONE", tool_calls:[
      { name:"run_command", args:{ CommandLine:'"node demo.mjs"', IsDaemon:"true" } },
      { name:"read_file", args:{ Path:'"/tmp/x"' } },
    ] },
    { step_index:2, type:"GENERIC", status:"RUNNING", content:"Tool is running as a background task with task id: cid/task-2\nTask Description: Starting the demo server" },
    { step_index:3, type:"GENERIC", status:"DONE", content:"file contents" },
    { step_index:4, type:"PLANNER_RESPONSE", status:"DONE", created_at:"2026-11-20T05:12:00Z", content:"Demo server ready." },
  ];
  assert.deepEqual(W.antigravityDone(paraphrasedDaemon, at - 60000), { answer:"Demo server ready.", at:doneAt });

  // 4. manage_task kill matching: positional failure keeps target active, already-ended error clears it, short TaskId matches.
  const killFailTurn = [
    { step_index:0, type:"USER_INPUT", status:"DONE" },
    { step_index:1, type:"PLANNER_RESPONSE", status:"DONE", tool_calls:[{ name:"run_command", args:{ CommandLine:'"sleep 99"' } }, { name:"run_command", args:{ CommandLine:'"sleep 98"' } }] },
    { step_index:2, type:"GENERIC", status:"RUNNING", content:"Tool is running as a background task with task id: cid/task-1\nTask Description: sleep 99" },
    { step_index:3, type:"GENERIC", status:"RUNNING", content:"Tool is running as a background task with task id: cid/task-2\nTask Description: sleep 98" },
    { step_index:4, type:"PLANNER_RESPONSE", status:"DONE", tool_calls:[
      { name:"manage_task", args:{ Action:'"kill"', TaskId:'"task-1"' } },
      { name:"manage_task", args:{ Action:'"kill"', TaskId:'"cid/task-2"' } },
    ] },
    { step_index:5, type:"GENERIC", status:"ERROR", content:"Task cid/task-1 is no longer running." },
    { step_index:6, type:"GENERIC", status:"ERROR", content:"Permission denied." },
    { step_index:7, type:"PLANNER_RESPONSE", status:"DONE", created_at:"2026-11-20T05:12:00Z", content:"Tried to stop." },
  ];
  assert.equal(W.antigravityDone(killFailTurn, at - 60000), null);
  assert.deepEqual(W.antigravityTurnState(killFailTurn, at - 60000).pendingTasks, ["cid/task-2"]);

  // 5. USER_EXPLICIT turn boundary, INVALID anonymous step, and trailing ERROR_MESSAGE.
  const explicitAndInvalid = [
    { step_index:0, type:"USER_INPUT", status:"DONE" },
    { step_index:1, type:"GENERIC", status:"RUNNING", content:"Tool is running as a background task with task id: cid/task-old" },
    { step_index:2, type:"GENERIC", source:"USER_EXPLICIT", status:"DONE", content:"Carry on." },
    { step_index:3, type:"GENERIC", status:"RUNNING", content:"Step running" },
    { step_index:3, type:"GENERIC", status:"INVALID", content:"Cancelled" },
    { step_index:4, type:"PLANNER_RESPONSE", status:"DONE", created_at:"2026-11-20T05:12:00Z", content:"All clear." },
  ];
  assert.deepEqual(W.antigravityDone(explicitAndInvalid, at - 60000), { answer:"All clear.", at:doneAt });

  const trailingError = [
    { step_index:0, type:"USER_INPUT", status:"DONE" },
    { step_index:1, type:"PLANNER_RESPONSE", status:"DONE", created_at:"2026-11-20T04:57:13Z", content:"Running tests. Waiting for completion." },
    { step_index:2, type:"ERROR_MESSAGE", status:"ERROR", created_at:"2026-11-20T05:12:00Z", error:"agent executor error: expected tool step" },
  ];
  assert.equal(W.antigravityDone(trailingError, at - 60000), null);
  assert.match(W.antigravityTurnState(trailingError, at - 60000).error, /agent executor error/);

  // 6. Long turn (>256 KiB tool output between RUNNING task and waiting message) stays pending via antigravityTurnRows.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-long-turn-"));
  t.after(() => fs.rmSync(tmpDir, { recursive:true, force:true }));
  const file = path.join(tmpDir, "transcript_full.jsonl");
  const bigChunk = "x".repeat(300 * 1024);
  const longRows = [
    { step_index:0, type:"USER_INPUT", status:"DONE", created_at:"2026-11-20T04:50:00Z" },
    { step_index:1, type:"PLANNER_RESPONSE", status:"DONE", tool_calls:[{ name:"run_command", args:{ CommandLine:'"gh run watch 44677775746"' } }] },
    { step_index:2, type:"GENERIC", status:"RUNNING", content:"Tool is running as a background task with task id: cid/task-401\nTask Description: gh run watch 44677775746" },
    { step_index:3, type:"GENERIC", status:"DONE", content:bigChunk },
    { step_index:4, type:"PLANNER_RESPONSE", status:"DONE", created_at:"2026-11-20T04:57:13Z", content:"Deployment is now running. Waiting for completion." },
  ];
  fs.writeFileSync(file, longRows.map(r => JSON.stringify(r)).join("\n") + "\n");
  assert.equal(W.antigravityDone(W.antigravityTurnRows(file), at - 60000), null, "long >256 KiB turn still sees task-401 RUNNING");
  assert.deepEqual(W.antigravityTranscriptState(file, at - 60000).pendingTasks, ["cid/task-401"]);

  fs.appendFileSync(file, [
    JSON.stringify({ step_index:5, type:"SYSTEM_MESSAGE", status:"DONE", content:'[Message] sender=cid/task-401 content=Task id "cid/task-401" was canceled with result:\nStopped' }),
    JSON.stringify({ step_index:6, type:"PLANNER_RESPONSE", status:"DONE", created_at:"2026-11-20T05:12:00Z", content:"Deploy finished." }),
  ].join("\n") + "\n");
  assert.deepEqual(W.antigravityDone(W.antigravityTurnRows(file), at - 60000), { answer:"Deploy finished.", at:doneAt });
});

test("decide does not mark a streaming agent with active background tasks done after 10 quiet minutes (PE-775 W2)", () => {
  const t0 = 1e12, r = { started:t0, heardAt:t0, background:1, said:"Waiting on background task." };
  let looked = 0;
  const finished = () => { looked++; return { answer:"Waiting on background task." }; };
  assert.equal(W.decide(r, tree(100), t0 + 1000, { finished }), null);
  assert.equal(W.decide(r, tree(100), t0 + 11 * MIN, { finished }), null, "must not probe or free as done while background > 0");
  assert.equal(W.decide(r, tree(100), t0 + 25 * MIN, { finished }), null);
  assert.equal(looked, 0, "transcript not probed while agent reports active background tasks");
  assert.ok(!r.turnOver);
  // After STUCK_MS with 0 CPU, it frees as stuck (error path), never as done.
  assert.equal(W.decide(r, tree(100), t0 + 31 * MIN, { finished }), "free");
  assert.equal(r.watch.why, "stuck");
});

test("antigravityTurnState handles reversed [daemon, worker] results, unrelated DONE before failed kill, non-completion/quoted notices, and non-final planner rows", () => {
  const at = Date.parse("2026-11-20T04:57:13Z");

  // 1. Reversed [daemon, worker] tool results must NOT exempt the real worker as a daemon.
  const reversedParallel = [
    { step_index:0, type:"USER_INPUT", status:"DONE" },
    { step_index:1, type:"PLANNER_RESPONSE", status:"DONE", tool_calls:[
      { name:"run_command", args:{ CommandLine:'"node dev-server.mjs"', IsDaemon:true } },
      { name:"run_command", args:{ CommandLine:'"gh run watch 44677775746"' } },
    ] },
    // Worker row arrives FIRST, daemon row arrives SECOND.
    { step_index:2, type:"GENERIC", status:"RUNNING", content:"Tool is running as a background task with task id: cid/task-worker\nTask Description: gh run watch 44677775746" },
    { step_index:3, type:"GENERIC", status:"RUNNING", content:"Tool is running as a background task with task id: cid/task-daemon\nTask Description: node dev-server.mjs" },
    { step_index:4, type:"PLANNER_RESPONSE", status:"DONE", created_at:"2026-11-20T05:12:00Z", content:"Waiting on deploy." },
  ];
  const revState = W.antigravityTurnState(reversedParallel, at - 60000);
  assert.equal(revState.done, null);
  assert.deepEqual(revState.pendingTasks, ["cid/task-worker"], "worker stays pending and only the daemon is exempted");

  // 2. Unrelated DONE row before a failed manage_task kill result must NOT clear the target task.
  const unrelatedBeforeFailedKill = [
    { step_index:0, type:"USER_INPUT", status:"DONE" },
    { step_index:1, type:"PLANNER_RESPONSE", status:"DONE", tool_calls:[{ name:"run_command", args:{ CommandLine:'"sleep 99"' } }] },
    { step_index:2, type:"GENERIC", status:"RUNNING", content:"Tool is running as a background task with task id: cid/task-9\nTask Description: sleep 99" },
    { step_index:3, type:"PLANNER_RESPONSE", status:"DONE", tool_calls:[
      { name:"manage_task", args:{ Action:'"kill"', TaskId:'"cid/task-9"' } },
    ] },
    { step_index:4, type:"GENERIC", status:"DONE", content:"Showing lines 1-5 of README.md" },
    { step_index:5, type:"GENERIC", status:"ERROR", content:"Failed to kill cid/task-9: permission denied" },
    { step_index:6, type:"PLANNER_RESPONSE", status:"DONE", created_at:"2026-11-20T05:12:00Z", content:"Could not kill." },
  ];
  const killState = W.antigravityTurnState(unrelatedBeforeFailedKill, at - 60000);
  assert.equal(killState.done, null);
  assert.deepEqual(killState.pendingTasks, ["cid/task-9"], "unrelated DONE row ahead of failed kill must not clear task-9");

  // 3. sender=<tid> non-completion message and quoted completion text inside another task's stdout must NOT clear <tid>.
  const looseNotices = [
    { step_index:0, type:"USER_INPUT", status:"DONE" },
    { step_index:1, type:"PLANNER_RESPONSE", status:"DONE", tool_calls:[
      { name:"run_command", args:{ CommandLine:'"gh run watch 1"' } },
      { name:"run_command", args:{ CommandLine:'"echo test"' } },
    ] },
    { step_index:2, type:"GENERIC", status:"RUNNING", content:"Tool is running as a background task with task id: cid/task-1\nTask Description: gh run watch 1" },
    { step_index:3, type:"GENERIC", status:"RUNNING", content:"Tool is running as a background task with task id: cid/task-2\nTask Description: echo test" },
    { step_index:4, type:"SYSTEM_MESSAGE", status:"DONE", content:"<SYSTEM_MESSAGE>\n[Message] timestamp=2026-11-20T05:00:00Z sender=cid/task-1 priority=MESSAGE_PRIORITY_HIGH content=Still running; another job completed" },
    { step_index:5, type:"SYSTEM_MESSAGE", status:"DONE", content:'<SYSTEM_MESSAGE>\n[Message] timestamp=2026-11-20T05:01:00Z sender=cid/task-2 priority=MESSAGE_PRIORITY_HIGH content=Task id "cid/task-2" finished with result:\nTask id "cid/task-1" finished with result:\nOK' },
    { step_index:6, type:"PLANNER_RESPONSE", status:"DONE", created_at:"2026-11-20T05:12:00Z", content:"Still waiting for task-1." },
  ];
  const noticeState = W.antigravityTurnState(looseNotices, at - 60000);
  assert.equal(noticeState.done, null);
  assert.deepEqual(noticeState.pendingTasks, ["cid/task-1"], "non-completion sender message and quoted stdout notice must not clear task-1");

  // 4. Non-final (status !== DONE or empty) PLANNER_RESPONSE must NOT clear trailing ERROR_MESSAGE or unansweredWakeup.
  const nonFinalAfterError = [
    { step_index:0, type:"USER_INPUT", status:"DONE" },
    { step_index:1, type:"ERROR_MESSAGE", status:"ERROR", created_at:"2026-11-20T05:10:00Z", error:"stream aborted" },
    { step_index:2, type:"PLANNER_RESPONSE", status:"ERROR", created_at:"2026-11-20T05:11:00Z", content:"" },
  ];
  const errState = W.antigravityTurnState(nonFinalAfterError, at - 60000);
  assert.equal(errState.done, null);
  assert.match(errState.error, /stream aborted/, "non-DONE planner row must not clear trailing ERROR_MESSAGE");

  const emptyAfterWakeup = [
    { step_index:0, type:"USER_INPUT", status:"DONE" },
    { step_index:1, type:"GENERIC", status:"RUNNING", content:"Tool is running as a background task with task id: cid/task-7" },
    { step_index:2, type:"SYSTEM_MESSAGE", status:"DONE", content:'<SYSTEM_MESSAGE>\n[Message] timestamp=2026-11-20T05:10:00Z sender=cid/task-7 priority=MESSAGE_PRIORITY_HIGH content=Task id "cid/task-7" finished with result:\nOK' },
    { step_index:3, type:"PLANNER_RESPONSE", status:"DONE", created_at:"2026-11-20T05:11:00Z", content:"   " },
  ];
  const wakeState = W.antigravityTurnState(emptyAfterWakeup, at - 60000);
  assert.equal(wakeState.done, null);
  assert.equal(wakeState.unansweredWakeup, true, "empty planner row must not clear unansweredWakeup");
});

test("decide clears premature turnOver and avoids free('done') when Antigravity transcript has a pending task", () => {
  const t0 = 1e12, r = { agent:"antigravity", started:t0, heardAt:t0, turnOver:t0 + 1000, said:"Waiting for completion." };
  const pending = () => true;
  assert.equal(W.decide(r, tree(100), t0 + 2000, { pending }), null);
  assert.equal(r.turnOver, 0, "premature turnOver is cleared while transcript shows pending work");
  assert.equal(W.decide(r, tree(100), t0 + 12 * MIN, { pending }), null, "must not mark done after 10 idle minutes while pending");
  assert.equal(W.decide(r, tree(100), t0 + 31 * MIN, { pending }), "free", "only STUCK_MS safety net triggers after 30 idle minutes");
  assert.equal(r.watch.why, "stuck");
});

test("antigravityTurnState clears one-shot timers cancelled early by TimerCondition ('any' or sender ID) without misclassifying 'never', reminders, or unrelated senders", () => {
  const conv = "1354ed2a-75e3-4ed0-bdba-0f70f33cec86";
  const doneAt = "2026-10-05T00:01:05Z";

  // 1. Real-world pattern: two sequential TimerCondition:"any" timers cancelled silently when render commands finish (ID-less transcript rows).
  const anyRows = [
    { step_index:0, type:"USER_INPUT", status:"DONE", created_at:"2026-10-04T23:57:14Z", content:"Design iOS screens" },
    { step_index:19, type:"PLANNER_RESPONSE", status:"DONE", tool_calls:[{ name:"run_command", args:{ CommandLine:"render-1" } }] },
    { step_index:20, type:"GENERIC", status:"RUNNING", content:`Tool is running as a background task with task id: ${conv}/task-20\nTask Description: render-1` },
    { step_index:23, type:"PLANNER_RESPONSE", status:"DONE", tool_calls:[{ name:"schedule", args:{ DurationSeconds:20, Prompt:"Check render task and view PNGs", TimerCondition:"any" } }] },
    { step_index:24, type:"GENERIC", status:"RUNNING", content:`Tool is running as a background task with task id: ${conv}/task-24\nTask Description: Timer: 20s, Prompt: Check render task and view PNGs` },
    { step_index:29, type:"SYSTEM_MESSAGE", status:"DONE", content:`<SYSTEM_MESSAGE>\n[Message] timestamp=2026-10-05T00:00:04Z sender=${conv}/task-20 priority=MESSAGE_PRIORITY_HIGH content=Task id "${conv}/task-20" finished with result:\nOK\n</SYSTEM_MESSAGE>` },
    { step_index:37, type:"PLANNER_RESPONSE", status:"DONE", tool_calls:[{ name:"run_command", args:{ CommandLine:"render-2" } }] },
    { step_index:38, type:"GENERIC", status:"RUNNING", content:`Tool is running as a background task with task id: ${conv}/task-38\nTask Description: render-2` },
    { step_index:39, type:"PLANNER_RESPONSE", status:"DONE", tool_calls:[{ name:"schedule", args:{ DurationSeconds:25, Prompt:"Render done? view s2,s5 pngs", TimerCondition:"any" } }] },
    { step_index:40, type:"GENERIC", status:"RUNNING", content:`Tool is running as a background task with task id: ${conv}/task-40\nTask Description: Timer: 25s, Prompt: Render done? view s2,s5 pngs` },
    { step_index:44, type:"SYSTEM_MESSAGE", status:"DONE", content:`<SYSTEM_MESSAGE>\n[Message] timestamp=2026-10-05T00:00:40Z sender=${conv}/task-38 priority=MESSAGE_PRIORITY_HIGH content=Task id "${conv}/task-38" finished with result:\nOK\n</SYSTEM_MESSAGE>` },
    { step_index:49, type:"PLANNER_RESPONSE", status:"DONE", created_at:doneAt, content:"Designed all six iPhone screens." },
  ];
  const anyState = W.antigravityTurnState(anyRows, 0);
  assert.equal(anyState.pending, false);
  assert.deepEqual(anyState.pendingTasks, []);
  assert.equal(anyState.unansweredWakeup, false);
  assert.equal(anyState.done?.answer, "Designed all six iPhone screens.");

  // Before any [Message] arrives, TimerCondition:"any" timer stays pending; an internal non-[Message] reminder must NOT cancel it.
  const reminderRows = [
    ...anyRows.slice(0, 5),
    { step_index:25, type:"SYSTEM_MESSAGE", status:"DONE", content:"<SYSTEM_MESSAGE>\nReminder: work efficiently.\n</SYSTEM_MESSAGE>" },
  ];
  const reminderState = W.antigravityTurnState(reminderRows, 0);
  assert.equal(reminderState.pending, true);
  assert.deepEqual(reminderState.pendingTasks, [`${conv}/task-20`, `${conv}/task-24`]);

  // TimerCondition:"any" cancelled by a peer/subagent [Message] with no following PLANNER_RESPONSE flags unansweredWakeup.
  const wakeupRows = [
    { step_index:0, type:"USER_INPUT", status:"DONE" },
    { step_index:1, type:"PLANNER_RESPONSE", status:"DONE", tool_calls:[{ name:"schedule", args:{ DurationSeconds:60, Prompt:"Check peer", TimerCondition:"any" } }] },
    { step_index:2, type:"GENERIC", status:"RUNNING", content:`Tool is running as a background task with task id: ${conv}/task-2\nTask Description: Timer: 60s, Prompt: Check peer` },
    { step_index:3, type:"SYSTEM_MESSAGE", status:"DONE", content:`<SYSTEM_MESSAGE>\n[Message] timestamp=2026-10-05T00:00:10Z sender=subagent-abc priority=MESSAGE_PRIORITY_HIGH content=Subagent finished\n</SYSTEM_MESSAGE>` },
  ];
  const wakeupState = W.antigravityTurnState(wakeupRows, 0);
  assert.equal(wakeupState.pending, false);
  assert.equal(wakeupState.unansweredWakeup, true);
  assert.equal(wakeupState.done, null);

  // 2. TimerCondition:<senderId> (short or full) cancels ONLY on a message from that sender, never on an unrelated sender.
  const senderRows = [
    { step_index:0, type:"USER_INPUT", status:"DONE" },
    { step_index:1, type:"PLANNER_RESPONSE", status:"DONE", tool_calls:[
      { id:"c-cmd", name:"run_command", args:{ CommandLine:"build" } },
      { id:"c-t1", name:"schedule", args:{ DurationSeconds:30, Prompt:"Wait on build", TimerCondition:"task-10" } },
      { id:"c-t2", name:"schedule", args:{ DurationSeconds:45, Prompt:"Wait on never", TimerCondition:"never" } },
    ] },
    { step_index:2, type:"GENERIC", tool_call_id:"c-cmd", status:"RUNNING", content:`task id: ${conv}/task-10\nTask Description: build` },
    { step_index:3, type:"GENERIC", tool_call_id:"c-t1", status:"RUNNING", content:`task id: ${conv}/task-11\nTask Description: Timer: 30s, Prompt: Wait on build` },
    { step_index:4, type:"GENERIC", tool_call_id:"c-t2", status:"RUNNING", content:`task id: ${conv}/task-12\nTask Description: Timer: 45s, Prompt: Wait on never` },
    // Message from unrelated sender does NOT clear task-11 (waiting on task-10) or task-12 (never).
    { step_index:5, type:"SYSTEM_MESSAGE", status:"DONE", content:`<SYSTEM_MESSAGE>\n[Message] sender=other-agent content=Hello\n</SYSTEM_MESSAGE>` },
  ];
  assert.deepEqual(W.antigravityTurnState(senderRows, 0).pendingTasks, [`${conv}/task-10`, `${conv}/task-11`, `${conv}/task-12`]);

  // Message from task-10 clears both task-10 and task-11, while task-12 (TimerCondition:"never") stays pending.
  senderRows.push(
    { step_index:6, type:"SYSTEM_MESSAGE", status:"DONE", content:`<SYSTEM_MESSAGE>\n[Message] sender=${conv}/task-10 content=Task id "${conv}/task-10" finished with result:\nOK\n</SYSTEM_MESSAGE>` },
    { step_index:7, type:"PLANNER_RESPONSE", status:"DONE", created_at:doneAt, content:"Build done, timer-12 still armed." },
  );
  const afterSender = W.antigravityTurnState(senderRows, 0);
  assert.equal(afterSender.pending, true);
  assert.deepEqual(afterSender.pendingTasks, [`${conv}/task-12`]);
  assert.equal(afterSender.done, null);

  // 3. ID-less batch with two one-shot timers of different TimerConditions disambiguates by DurationSeconds/Prompt.
  const multiTimerRows = [
    { step_index:0, type:"USER_INPUT", status:"DONE" },
    { step_index:1, type:"PLANNER_RESPONSE", status:"DONE", tool_calls:[
      { name:"schedule", args:{ DurationSeconds:15, Prompt:"Cancel on any", TimerCondition:"any" } },
      { name:"schedule", args:{ DurationSeconds:60, Prompt:"Keep armed", TimerCondition:"never" } },
    ] },
    { step_index:2, type:"GENERIC", status:"RUNNING", content:`task id: ${conv}/t-any\nTask Description: Timer: 15s, Prompt: Cancel on any` },
    { step_index:3, type:"GENERIC", status:"RUNNING", content:`task id: ${conv}/t-never\nTask Description: Timer: 60s, Prompt: Keep armed` },
    { step_index:4, type:"SYSTEM_MESSAGE", status:"DONE", content:`<SYSTEM_MESSAGE>\n[Message] sender=subagent-1 content=Done\n</SYSTEM_MESSAGE>` },
  ];
  assert.deepEqual(W.antigravityTurnState(multiTimerRows, 0).pendingTasks, [`${conv}/t-never`]);

  // 4. P1: Bound run_command in a mixed batch with description starting with "Timer: 30s" must NEVER inherit schedule TimerCondition.
  const boundCmdRows = [
    { step_index:0, type:"USER_INPUT", status:"DONE" },
    { step_index:1, type:"PLANNER_RESPONSE", status:"DONE", tool_calls:[
      { id:"c-cmd", name:"run_command", args:{ CommandLine:"Timer: 30s bench" } },
      { id:"c-sched", name:"schedule", args:{ DurationSeconds:30, Prompt:"Watch bench", TimerCondition:"any" } },
    ] },
    { step_index:2, type:"GENERIC", tool_call_id:"c-cmd", status:"RUNNING", content:`task id: ${conv}/cmd-timer\nTask Description: Timer: 30s bench` },
    { step_index:3, type:"GENERIC", tool_call_id:"c-sched", status:"RUNNING", content:`task id: ${conv}/t-bench\nTask Description: Timer: 30s, Prompt: Watch bench` },
    { step_index:4, type:"SYSTEM_MESSAGE", status:"DONE", content:`<SYSTEM_MESSAGE>\n[Message] sender=peer-1 content=Ping\n</SYSTEM_MESSAGE>` },
    { step_index:5, type:"PLANNER_RESPONSE", status:"DONE", created_at:doneAt, content:"Still benchmarking." },
  ];
  const boundCmdState = W.antigravityTurnState(boundCmdRows, 0);
  assert.equal(boundCmdState.pending, true);
  assert.deepEqual(boundCmdState.pendingTasks, [`${conv}/cmd-timer`], "bound run_command stays pending even when description starts with Timer:");
  assert.equal(boundCmdState.done, null);

  // 5. P1: Non-message reminder or sender= inside content= body must NOT spoof sender= for TimerCondition:<senderId>.
  const spoofRows = [
    { step_index:0, type:"USER_INPUT", status:"DONE" },
    { step_index:1, type:"PLANNER_RESPONSE", status:"DONE", tool_calls:[
      { id:"c-s", name:"schedule", args:{ DurationSeconds:30, Prompt:"Wait build", TimerCondition:`${conv}/task-build` } },
    ] },
    { step_index:2, type:"GENERIC", tool_call_id:"c-s", status:"RUNNING", content:`task id: ${conv}/t-wait\nTask Description: Timer: 30s, Prompt: Wait build` },
    { step_index:3, type:"SYSTEM_MESSAGE", status:"DONE", content:`<SYSTEM_MESSAGE>\nReminder: check sender=${conv}/task-build later\n</SYSTEM_MESSAGE>` },
    { step_index:4, type:"SYSTEM_MESSAGE", status:"DONE", content:`<SYSTEM_MESSAGE>\n[Message] timestamp=2026-10-05T00:00:10Z content=echo sender=${conv}/task-build\n</SYSTEM_MESSAGE>` },
  ];
  assert.deepEqual(W.antigravityTurnState(spoofRows, 0).pendingTasks, [`${conv}/t-wait`], "reminder and content= sender text must not clear TimerCondition:<senderId>");

  // 6. P2: Bare completion notice with short task ID clears TimerCondition waiting on prefixed conv/task-build.
  spoofRows.push(
    { step_index:5, type:"SYSTEM_MESSAGE", status:"DONE", content:`<SYSTEM_MESSAGE>\nTask id "task-build" finished with result:\nOK\n</SYSTEM_MESSAGE>` },
    { step_index:6, type:"PLANNER_RESPONSE", status:"DONE", created_at:doneAt, content:"Build completed." },
  );
  const afterBare = W.antigravityTurnState(spoofRows, 0);
  assert.equal(afterBare.pending, false);
  assert.equal(afterBare.done?.answer, "Build completed.");

  // 7. P2: JSON-stringified args objects preserve TimerCondition and cron classification.
  const stringArgsRows = [
    { step_index:0, type:"USER_INPUT", status:"DONE" },
    { step_index:1, type:"PLANNER_RESPONSE", status:"DONE", tool_calls:[
      { id:"c-one", name:"schedule", args:JSON.stringify({ DurationSeconds:10, Prompt:"One-shot", TimerCondition:"any" }) },
      { id:"c-cron", name:"schedule", args:JSON.stringify({ CronExpression:"*/5 * * * *", Prompt:"Cron check" }) },
    ] },
    { step_index:2, type:"GENERIC", tool_call_id:"c-one", status:"RUNNING", content:`task id: ${conv}/t-one\nTask Description: Timer: 10s, Prompt: One-shot` },
    { step_index:3, type:"GENERIC", tool_call_id:"c-cron", status:"RUNNING", content:`task id: ${conv}/t-cron\nTask Description: Cron: */5 * * * *` },
    { step_index:4, type:"SYSTEM_MESSAGE", status:"DONE", content:`<SYSTEM_MESSAGE>\n[Message] sender=${conv}/t-cron content=Cron check\n</SYSTEM_MESSAGE>` },
  ];
  assert.deepEqual(W.antigravityTurnState(stringArgsRows, 0).pendingTasks, [`${conv}/t-cron`], "stringified args clears one-shot TimerCondition:'any' while keeping recurring cron active");

  // 8. P2: Same-duration ID-less timers with prefix-overlapping prompts and multiline prompts resolve exact match first.
  const overlapRows = [
    { step_index:0, type:"USER_INPUT", status:"DONE" },
    { step_index:1, type:"PLANNER_RESPONSE", status:"DONE", tool_calls:[
      { name:"schedule", args:{ DurationSeconds:20, Prompt:"Check build output\nline 2", TimerCondition:"any" } },
      { name:"schedule", args:{ DurationSeconds:20, Prompt:"Check build output\nline 2 carefully", TimerCondition:"never" } },
    ] },
    { step_index:2, type:"GENERIC", status:"RUNNING", content:`task id: ${conv}/t-short\nTask Description: Timer: 20s, Prompt: Check build output\nline 2\nTask logs are available at: file:///tmp/t-short.log` },
    { step_index:3, type:"GENERIC", status:"RUNNING", content:`task id: ${conv}/t-long\nTask Description: Timer: 20s, Prompt: Check build output\nline 2 carefully\nTask logs are available at: file:///tmp/t-long.log` },
    { step_index:4, type:"SYSTEM_MESSAGE", status:"DONE", content:`<SYSTEM_MESSAGE>\n[Message] sender=subagent-2 content=Done\n</SYSTEM_MESSAGE>` },
  ];
  assert.deepEqual(W.antigravityTurnState(overlapRows, 0).pendingTasks, [`${conv}/t-long`], "exact prompt match resolves prefix-overlapping multiline timers");
});
