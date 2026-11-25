"use strict";
require("./helpers/safety.js");
// Agents run under keepers: a stop, restart or crash of PenEcho never ends them, and the next PenEcho follows them on (PE-640).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { createOrchestrator } = require("../src/server/project-lines/orchestrator.js");
const F = require("../src/server/project-lines/format.js");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-keep-"));
const starts = path.join(temp, "starts.jsonl");
// A Claude-like agent: reads its prompt, says it started, works for a while ("work=ms" in the request), then gives its result.
const plainAgent = path.join(temp, "plain-agent.js");
fs.writeFileSync(plainAgent, `
const fs = require("fs"), say = o => console.log(JSON.stringify(o));
let prompt = "";
process.stdin.on("data", d => prompt += d).on("end", () => {
  const request = prompt.split("<request>\\n")[1]?.split("\\n</request>")[0] || prompt;
  fs.appendFileSync(${JSON.stringify(starts)}, JSON.stringify({ request, pid:process.pid, at:Date.now() }) + "\\n");
  say({ type:"system", subtype:"init", session_id:"keep-" + process.pid });
  say({ type:"assistant", message:{ content:[{ type:"tool_use", id:"tool-1", name:"Bash", input:{ command:"make it" } }] } });
  const work = Number(/work=(\\d+)/.exec(request)?.[1] || 50);
  setTimeout(() => {
    say({ type:"assistant", message:{ content:[{ type:"text", text:"Finished: " + request }] } });
    say({ type:"result", subtype:"success", is_error:false, result:"Finished: " + request });
    process.exit(0);
  }, work);
});
`);
// A Codex-like app-server: answers initialize, thread/start and turn/start, works, then completes its turn.
const codexAgent = path.join(temp, "codex-agent.js");
fs.writeFileSync(codexAgent, `
const fs = require("fs"), send = o => process.stdout.write(JSON.stringify(o) + "\\n");
let buffer = "";
process.stdin.on("data", d => {
  buffer += d;
  for (let end; (end = buffer.indexOf("\\n")) >= 0;) {
    const m = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
    if (m.method === "initialize") send({ id:m.id, result:{} });
    if (m.method === "thread/start") send({ id:m.id, result:{ thread:{ id:"thread-" + process.pid, path:"" } } });
    if (m.method === "turn/steer") { fs.appendFileSync(${JSON.stringify(starts)}, JSON.stringify({ steer:m.params.input[0].text }) + "\\n"); send({ id:m.id, result:{} }); }
    if (m.method === "turn/start") {
      const request = m.params.input[0].text, threadId = m.params.threadId;
      fs.appendFileSync(${JSON.stringify(starts)}, JSON.stringify({ request:request.split("<request>\\n")[1]?.split("\\n</request>")[0] || request, pid:process.pid, at:Date.now() }) + "\\n");
      send({ id:m.id, result:{ turn:{ id:"turn-1" } } });
      send({ method:"item/started", params:{ threadId, item:{ id:"cmd-1", type:"commandExecution", command:"make it" } } });
      const work = Number(/work=(\\d+)/.exec(request)?.[1] || 50);
      setTimeout(() => {
        send({ method:"item/completed", params:{ threadId, item:{ id:"cmd-1", type:"commandExecution", command:"make it", exitCode:0 } } });
        send({ method:"item/completed", params:{ threadId, item:{ id:"msg-1", type:"agentMessage", text:"Codex finished the work." } } });
        send({ method:"turn/completed", params:{ threadId, turn:{ id:"turn-1", status:"completed" } } });
      }, work);
    }
  }
});
`);
const startsLog = () => { try { return fs.readFileSync(starts, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse); } catch { return []; } };
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (check, what, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 50)); } assert.fail(`timed out waiting for ${what}`); };

function agents() {
  const plain = { name:"Plain", mono:"Pl", color:"#000", role:"Build", resolve:() => ({ command:process.execPath, prefixArgs:[plainAgent] }), command:launch => ({ command:launch.command, args:launch.prefixArgs }) };
  const codex = { name:"Codexish", mono:"Cx", color:"#000", role:"Build", resolve:() => ({ command:process.execPath, prefixArgs:[codexAgent] }),
    command:(launch, { workdir }) => ({ command:launch.command, args:launch.prefixArgs, cwd:workdir, protocol:"app-server", ownInstructions:true, thread:{ cwd:workdir }, turn:{} }) };
  return createAgents({ env:{ PATH:"" }, extra:{ plain, codexish:codex } });
}
let n = 0;
function open(directory) {
  return createProjectLines({ directory, agents:agents(), serviceOptions:{ autoWatch:false }, authorizeRead:() => null, authorizeWrite:() => null, isThisComputer:() => true, readJson:async () => ({}), send:() => {} });
}
async function startWork(agent, words) {
  const directory = path.join(temp, `state-${++n}`), docs = path.join(temp, `docs-${n}`);
  const lines = open(directory), { service } = lines;
  const project = service.store.create({ name:"Keep", docsPath:docs });
  project.defaultAgent = agent; service.store.save();
  const { slug } = await service.createTopic(project, { text:words, agent, kinds:["ask", "work"], start:false });
  await service.begin(project, slug);
  await until(() => service.runs.get(service.key(project, slug))?.child?.pid, "the agent running");
  const run = service.runs.get(service.key(project, slug));
  return { directory, lines, service, project, slug, run, pid:run.child.pid };
}
const lineOf = (service, project, slug) => F.parseLine(service.readDoc(project, slug));
const rows = (service, project, slug) => service.activityOf(project, slug, 0).rows;

test("PenEcho stopping leaves the agent working; the next PenEcho follows it to its end, once, without starting it again", async () => {
  const f = await startWork("plain", "build the page work=1500");
  f.lines.close();
  await new Promise(r => setTimeout(r, 300));
  assert.ok(alive(f.pid), "the agent keeps working while no PenEcho runs");
  const again = open(f.directory), { service } = again;
  try {
    const project = service.store.get(f.project.id);
    assert.ok(service.runs.get(service.key(project, f.slug)), "the Work is running again in the new PenEcho");
    await until(() => lineOf(service, project, f.slug).status === "done", "the Work finished", 20000);
    const doc = lineOf(service, project, f.slug), work = doc.steps.find(s => s.kind === "work");
    assert.ok(work.done && !work.off, "finished, not stopped");
    assert.equal(startsLog().filter(s => s.request === "build the page work=1500").length, 1, "the agent was never started again");
    const text = rows(service, project, f.slug).map(r => r.text || "").join("\n");
    assert.doesNotMatch(text, /PenEcho closed while this was running/);
    assert.match(text, /The agent kept working/);
    assert.equal(rows(service, project, f.slug).filter(r => r.id === "tool-1").length, 1, "a row read again is not added twice");
  } finally { again.close(); }
});

test("a PenEcho killed outright (as Ctrl-C does) leaves the agent working, and the next one follows it", async () => {
  const directory = path.join(temp, `state-${++n}`), docs = path.join(temp, `docs-${n}`);
  // The first PenEcho runs in a process of its own and is killed with its agent mid-way.
  const first = spawn(process.execPath, ["-e", `
    const { createProjectLines } = require(${JSON.stringify(require.resolve("../src/server/project-lines/http.js"))});
    const { createAgents } = require(${JSON.stringify(require.resolve("../src/server/project-lines/agents.js"))});
    const plain = { name:"Plain", mono:"Pl", color:"#000", role:"Build", resolve:() => ({ command:process.execPath, prefixArgs:[${JSON.stringify(plainAgent)}] }), command:launch => ({ command:launch.command, args:launch.prefixArgs }) };
    const lines = createProjectLines({ directory:${JSON.stringify(directory)}, agents:createAgents({ env:{ PATH:"" }, extra:{ plain } }), serviceOptions:{ autoWatch:false }, authorizeRead:() => null, authorizeWrite:() => null, isThisComputer:() => true, readJson:async () => ({}), send:() => {} });
    (async () => {
      const project = lines.service.store.create({ name:"Keep", docsPath:${JSON.stringify(docs)} }); project.defaultAgent = "plain"; lines.service.store.save();
      const { slug } = await lines.service.createTopic(project, { text:"killed server work=2000", agent:"plain", kinds:["ask", "work"], start:false });
      await lines.service.begin(project, slug);
      const wait = () => { const run = lines.service.runs.get(lines.service.key(project, slug)); if (run?.child?.pid) process.stdout.write(JSON.stringify({ projectId:project.id, slug, pid:run.child.pid }) + "\\n"); else setTimeout(wait, 50); };
      wait();
    })();
  `], { stdio:["ignore", "pipe", "inherit"] });
  const started = await new Promise((resolve, reject) => { first.stdout.once("data", d => resolve(JSON.parse(String(d)))); first.once("exit", code => reject(Error(`first PenEcho exited ${code}`))); });
  first.kill("SIGKILL"); await new Promise(r => first.once("exit", r));
  await new Promise(r => setTimeout(r, 300));
  assert.ok(alive(started.pid), "killing PenEcho does not kill the agent");
  const again = open(directory), { service } = again;
  try {
    const project = service.store.get(started.projectId);
    await until(() => lineOf(service, project, started.slug).status === "done", "the Work finished", 20000);
    assert.ok(lineOf(service, project, started.slug).steps.find(s => s.kind === "work").done);
    assert.equal(startsLog().filter(s => s.request === "killed server work=2000").length, 1);
  } finally { again.close(); }
});

test("an agent that ends while no PenEcho runs is finished, not interrupted, when PenEcho starts", async () => {
  const f = await startWork("plain", "quick while away work=300");
  f.lines.close();
  await until(() => !alive(f.pid), "the agent ending on its own");
  const again = open(f.directory), { service } = again;
  try {
    const project = service.store.get(f.project.id);
    await until(() => lineOf(service, project, f.slug).status === "done", "the Work finished");
    const work = lineOf(service, project, f.slug).steps.find(s => s.kind === "work");
    assert.ok(work.done && !work.off);
    assert.doesNotMatch(rows(service, project, f.slug).map(r => r.text || "").join("\n"), /PenEcho closed while this was running/);
  } finally { again.close(); }
});

test("Stop still ends a Work that a restarted PenEcho follows", async () => {
  const f = await startWork("plain", "stop me later work=20000");
  f.lines.close();
  const again = open(f.directory), { service } = again;
  try {
    const project = service.store.get(f.project.id);
    service.stopRun(project, f.slug);
    await until(() => !alive(f.pid), "the agent stopped");
    await until(() => !service.runs.has(service.key(project, f.slug)), "the run let go");
  } finally { again.close(); }
});

test("a Codex app-server turn carries on through a restart; words for it still steer in, and it ends with its answer", async () => {
  const f = await startWork("codexish", "codex job work=2000");
  await until(() => f.run.turnId, "the turn started");
  f.lines.close();
  await new Promise(r => setTimeout(r, 200));
  assert.ok(alive(f.pid), "the app-server keeps working");
  const again = open(f.directory), { service } = again;
  try {
    const project = service.store.get(f.project.id), run = service.runs.get(service.key(project, f.slug));
    assert.ok(run?.steer, "it can be steered after the restart");
    await run.steer("also add a footer");
    await until(() => lineOf(service, project, f.slug).status === "done", "the turn completed", 20000);
    assert.ok(startsLog().some(s => s.steer === "also add a footer"), "the words reached the agent");
    assert.equal(startsLog().filter(s => s.request?.startsWith("codex job work=2000")).length, 1, "the turn was not started again");
    assert.match(service.store.readText(project, F.detailPath(f.slug, run.stepId)).text, /Codex finished the work/);
  } finally { again.close(); }
});

test("an orchestrator's pass still works after PenEcho restarts", async () => {
  const directory = path.join(temp, `orch-${++n}`);
  const projects = [{ id:"p1", name:"P", docsPath:temp }];
  const service = { store:{ projects }, readDoc:() => "---\norchestrator: yes\n---\n# Job\n", drawEnv:() => ({ PENECHO_DRAW_URL:"http://127.0.0.1:3889/api/draw" }) };
  const before = createOrchestrator({ service, directory }).env(projects[0], "job", { front:{ orchestrator:"yes" } });
  const after = createOrchestrator({ service, directory });
  assert.equal(after.env(projects[0], "job", { front:{ orchestrator:"yes" } }).PENECHO_ORCH_PASS, before.PENECHO_ORCH_PASS, "the same pass after a restart");
  await assert.rejects(after.agentCall("not-a-pass", { do:"help" }), { code:"NO_PASS" });
  const answer = await after.agentCall(before.PENECHO_ORCH_PASS, { do:"help" }).catch(error => error);
  assert.notEqual(answer?.code, "NO_PASS", "the pass from before the restart is accepted");
  assert.equal((fs.statSync(path.join(directory, "orchestrator", "passes.json")).mode & 0o077), 0, "only this user can read the passes");
});
