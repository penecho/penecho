"use strict";
require("./helpers/safety.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { Service } = require("../src/server/project-lines/service.js");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const F = require("../src/server/project-lines/format.js");
const { newBundle } = require("../src/server/project-lines/canvas-file.js");

function root(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-usage-actions-"));
  t.after(() => fs.rmSync(directory, { recursive:true, force:true }));
  return directory;
}

test("Line actions count only after they succeed and a steer is distinct", async t => {
  const events = [], directory = root(t), agents = { available:() => [] };
  const service = new Service({ directory:path.join(directory, "state"), agents, autoWatch:false, onUsage:key => events.push(key) });
  t.after(() => service.close());
  const project = service.store.create({ name:"Private project", docsPath:path.join(directory, "docs") });
  const work = { ...F.workStep({ who:"claude" }), done:true, out:"Finished" };
  service.writeDoc(project, "done", F.initialLine({ title:"Done", status:"done", steps:[F.askStep({ words:"private" }), work] }));
  service.writeDoc(project, "open", F.initialLine({ title:"Open", status:"working", steps:[F.askStep({ words:"private" }), F.workStep({ who:"claude" })] }));
  service.sync(project);
  await service.act(project, "done", "review", { step:work.id });
  await service.act(project, "done", "rate", { step:work.id, rating:"good" });
  await service.act(project, "done", "todo", { todo:true });
  await assert.rejects(service.act(project, "done", "stop"), { code:"NOTHING_TO_STOP" });
  await service.act(project, "open", "stop");
  await service.act(project, "open", "close");
  await service.act(project, "open", "outdated", { outdated:false });
  assert.deepEqual(events, ["work-review", "work-rate", "line-todo", "work-stop", "line-archive"]);

  service.writeDoc(project, "steer", F.initialLine({ title:"Steer", status:"working", steps:[F.askStep({ words:"private" }), F.workStep({ who:"claude" })] }));
  const step = F.parseLine(service.readDoc(project, "steer")).steps.find(F.AGENT_LIKE);
  service.runs.set(service.key(project, "steer"), { stepId:step.id, agent:"claude", stopping:false, steer:async () => {} });
  assert.equal(await service.addFeedback(project, "steer", { text:"a private follow-up" }), true);
  assert.equal(events.at(-1), "line-steer");
});

test("a Canvas Ask marks line-new only when the Canvas really gained a new Line", async t => {
  const directory = root(t), service = new Service({ directory:path.join(directory, "state"), agents:{ available:() => [] }, autoWatch:false });
  t.after(() => service.close());
  const project = service.store.create({ name:"Private project", docsPath:path.join(directory, "docs") });
  const canvas = await service.createCanvas(project, { title:"Private Canvas", source:newBundle("Private Canvas") });
  const first = await service.saveUnsent(project, { text:"private ask", canvas:canvas.source });
  assert.equal(first.added, true, "the Ask is added to the Canvas's new Line");
  assert.equal(first.lineCreated, true);
  const again = await service.saveUnsent(project, { text:"another private ask", canvas:canvas.source });
  assert.equal(again.added, true);
  assert.equal(again.lineCreated, undefined, "an existing Line is not counted as new");
});

test("an actually launched Work emits work-run and its runner id once", async t => {
  const events = [], directory = root(t), children = [];
  let fail = false;
  const agents = {
    available:() => [{ id:"claude", available:true, name:"Claude" }], classifier:() => null,
    command:options => ({ command:"stand-in", args:[], cwd:options.workdir }),
  };
  const spawnFn = () => {
    const child = Object.assign(new EventEmitter(), { pid:900000 + children.length, stdout:new PassThrough(), stderr:new PassThrough(), stdin:new PassThrough() });
    child.kill = () => setImmediate(() => child.emit("close", null));
    setImmediate(() => { if (fail) child.emit("error", new Error("spawn ENOENT")); else child.emit("spawn"); });
    children.push(child); return child;
  };
  const service = new Service({ directory:path.join(directory, "state"), agents, autoWatch:false, spawnFn, conversations:{ home:path.join(directory, "home"), env:{} }, onUsage:(key, runner) => events.push([key, runner]) });
  t.after(() => { service.runs.clear(); service.close(); });
  const project = service.store.create({ name:"Private project", docsPath:path.join(directory, "docs") });
  project.defaultAgent = "claude"; service.store.save();
  const { slug } = await service.createTopic(project, { text:"private words", agent:"claude", kinds:["ask", "work"], start:false });
  await service.begin(project, slug);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events.filter(([key]) => key === "work-run"), [["work-run", "claude"]]);
  fail = true;
  const second = await service.createTopic(project, { text:"cannot start", agent:"claude", kinds:["ask", "work"], start:false });
  await service.begin(project, second.slug);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events.filter(([key]) => key === "work-run"), [["work-run", "claude"]], "an asynchronous spawn failure is not a run");
});

test("orchestrator jobs and coordinator-created tasks have separate, non-replaying counts", async t => {
  const events = [], directory = root(t);
  const agents = { available:() => [{ id:"claude", name:"Claude", available:true, runs:true }], useModelFile() {} };
  const lines = createProjectLines({ directory:path.join(directory, "state"), agents, serviceOptions:{ autoWatch:false, onUsage:key => events.push(key) } });
  t.after(() => lines.close());
  const { service, orchestrator } = lines, project = service.store.create({ name:"Private project", docsPath:path.join(directory, "docs") });
  const preset = service.presets.add({ agent:"claude", name:"Claude" });
  service.begin = async (p, slug) => { service.writeDoc(p, slug, F.setFront(service.readDoc(p, slug), { status:"working" })); };
  const requestId = "a".repeat(32);
  const job = await orchestrator.start(project, { goal:"a private job", preset:preset.id, requestId });
  await orchestrator.start(project, { goal:"a private job", preset:preset.id, requestId });
  assert.deepEqual(events, ["orchestrator-job"], "a replay does not create another job count");

  orchestrator.setBase("http://127.0.0.1/api/lines/orchestrate");
  const doc = F.parseLine(service.readDoc(project, job.line)), pass = orchestrator.env(project, job.line, doc).PENECHO_ORCH_PASS;
  await orchestrator.agentCall(pass, { do:"create-line", task:"a private delegated task", agent:preset.id, kind:"code" });
  await orchestrator.call(project, { do:"create-line", task:"a manual call", agent:preset.id, kind:"code" });
  assert.deepEqual(events, ["orchestrator-job", "orchestrator-task"], "only the coordinator API creates orchestrator-task");
});
