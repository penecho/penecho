"use strict";
require("./helpers/safety.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Service } = require("../src/server/project-lines/service.js");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { createAgentPresets } = require("../src/server/project-lines/agent-presets.js");
const { createOrchestrator } = require("../src/server/project-lines/orchestrator.js");
const F = require("../src/server/project-lines/format.js");

function makeAgentScript(root) {
  const script = path.join(root, "agent.js");
  const log = path.join(root, "prompts.jsonl");
  fs.writeFileSync(script, `
const fs = require("node:fs"), path = require("node:path");
let input = "";
process.stdin.on("data", d => { input += d; });
process.stdin.on("end", () => {
  const request = /<request>([\\s\\S]*?)<\\/request>/.exec(input)?.[1] || input;
  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ line:process.env.PENECHO_LINE, request, prompt:input }) + "\\n");
  const succeed = (text, delay = 20) => setTimeout(() => {
    console.log(JSON.stringify({ type:"result", is_error:false, result:text }));
    process.exit(0);
  }, delay);
  if (request.includes("mode:slow")) return succeed("Slow done.", 30000);
  if (request.includes("mode:restart-delay")) return succeed("Finished across restart.", 1800);
  if (request.includes("mode:fail-primary")) return setTimeout(() => {
    console.error("Intentional primary failure");
    process.exit(1);
  }, 150);
  if (request.includes("mode:lane-success")) return succeed("Lane succeeded.", 450);
  if (request.includes("mode:lane-question") && !request.includes("Yes")) return setTimeout(() => {
    const file = path.join(process.env.PENECHO_DOCS_FOLDER, "lines", process.env.PENECHO_LINE + ".md");
    const md = fs.readFileSync(file, "utf8")
      .replace("status: working", "status: waiting\\nwhy: Needs confirmation")
      .replace(/^## Ask/m, "## Questions for you\\n\\n**Ship it?** (@other)\\n\\n- [ ] Yes\\n- [ ] No\\n\\n## Ask");
    fs.writeFileSync(file, md);
    console.log(JSON.stringify({ type:"result", is_error:false, result:"Please choose." }));
    process.exit(0);
  }, 450);
  return succeed("Completed: " + request.slice(0, 100));
});
`);
  return { script, log };
}

function fakeAgents(script) {
  const adapter = name => ({
    name, mono:name.slice(0, 2), color:"#2563eb", role:"Build",
    resolve:() => ({ command:process.execPath, prefixArgs:[script] }),
    command:(launch, { workdir }) => ({ command:launch.command, args:launch.prefixArgs, cwd:workdir, stdin:true }),
  });
  return createAgents({ env:{ PATH:"" }, extra:{ fake:adapter("Fake"), other:adapter("Other") } });
}

async function until(fn, label = "condition", ms = 7000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function setup(t, name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `orch-review-${name}-`));
  const { script, log } = makeAgentScript(root);
  const directory = path.join(root, "state");
  fs.mkdirSync(directory, { recursive:true });
  const agents = fakeAgents(script);
  const service = new Service({ directory, agents, autoWatch:false });
  service.presets = createAgentPresets({ file:path.join(directory, "agent-presets.json"), agents });
  const fast = service.presets.add({ name:"Fake", agent:"fake" });
  const other = service.presets.add({ name:"Other", agent:"other" });
  const orchestrator = service.orchestrator = createOrchestrator({ service, directory });
  const project = service.store.create({ name, docsPath:path.join(root, "docs") });
  project.follow = false;
  project.autoWake = true;
  service.store.save();
  t.after(() => {
    service.close();
    fs.rmSync(root, { recursive:true, force:true, maxRetries:5, retryDelay:50 });
  });
  const doc = slug => F.parseLine(service.readDoc(project, slug));
  const prompts = slug => {
    try {
      return fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse).filter(row => !slug || row.line === slug);
    } catch { return []; }
  };
  return { root, service, orchestrator, project, fast, other, doc, prompts };
}

test("Retry reruns the failed primary after a sibling lane succeeds", async t => {
  const { service, orchestrator, project, fast, other, doc, prompts } = setup(t, "retry-after-lane");
  const made = await orchestrator.call(project, { do:"create-line", task:"mode:fail-primary", agent:fast.id, kind:"code" });
  const lane = await orchestrator.call(project, { do:"add-task", line:made.line, task:"mode:lane-success", agent:other.id, kind:"code", parallel:true });
  await until(() => !service.heldWorks(project, made.line).length && doc(made.line).status === "stopped", "primary failed and lane settled");
  assert.equal(doc(made.line).steps.find(s => s.id === lane.work).done, true);
  service.writeDoc(project, made.line, service.readDoc(project, made.line).replace("mode:fail-primary", "primary retry would succeed"));
  const before = prompts(made.line).length;
  const retried = await orchestrator.call(project, { do:"retry", line:made.line });
  await until(() => !service.heldWorks(project, made.line).length && doc(made.line).status === "done", "retry returned and Line finished");
  const after = prompts(made.line).length;
  assert.equal(after, before + 1, "one new retry");
  assert.equal(retried.work, made.work);
  assert.equal(retried.started, true, "retry admitted");
});

test("An answer continues the lane that asked the question", async t => {
  const { service, orchestrator, project, fast, other, doc, prompts } = setup(t, "lane-question");
  const made = await orchestrator.call(project, { do:"create-line", task:"primary succeeds first", agent:fast.id, kind:"code" });
  const lane = await orchestrator.call(project, { do:"add-task", line:made.line, task:"mode:lane-question", agent:other.id, kind:"code", parallel:true });
  await until(() => !service.heldWorks(project, made.line).length && doc(made.line).status === "waiting", "lane asked its question and settled");
  const waiting = doc(made.line);
  assert.equal(waiting.steps.find(s => s.id === made.work).done, true);
  assert.equal(waiting.steps.find(s => s.id === lane.work).done, false, "questioning Work stays open");
  const before = prompts(made.line).length;
  await service.act(project, made.line, "answer", { stepId:lane.work, question:"Ship it?", answer:"Yes", questionRev:service.lineQuestionsState(project, made.line, waiting).revByStep.get(lane.work) });
  await until(() => doc(made.line).status === "done", "answer closed the Line");
  const after = prompts(made.line).length;
  assert.equal(after, before + 1, "one continuation received the answer");
  assert.match(prompts(made.line).at(-1).prompt, /Ship it.*Yes/s);
  assert.equal(doc(made.line).steps.filter(F.AGENT_LIKE).at(-1).who, "other");
});

test("Parallel add-task preserves an idle unanswered Work", async t => {
  const { service, orchestrator, project, fast, doc, prompts } = setup(t, "waiting-parallel");
  service.writeDoc(project, "waiting", `---\nid: PE-ORCH-WAIT\nstatus: waiting\nwhy: Your answer\nwho: @fake\n---\n\n# Waiting\n\n## Questions for you\n\n**Pick?** (@fake)\n\n- [ ] A\n- [ ] B\n\n## Ask · 2026-11-20 07:00\n\nOriginal unanswered task\n\n## [ ] Work 1 · @fake · 1 min\n`);
  await orchestrator.call(project, { do:"add-task", line:"waiting", task:"Independent new task", agent:fast.id, kind:"code", parallel:true });
  await until(() => !service.heldWorks(project, "waiting").length && doc("waiting").status === "waiting", "both new and old Works settled");
  const requests = prompts("waiting").map(row => row.request);
  assert.equal(requests.length, 1);
  assert.ok(requests.some(text => text.includes("Independent new task")));
  assert.ok(!requests.some(text => text.includes("Original unanswered task")));
});

test("A lane credit refusal preserves the successful primary result", async t => {
  const { service, orchestrator, project, fast, other, doc } = setup(t, "lane-credits");
  const made = await orchestrator.call(project, { do:"create-line", task:"mode:restart-delay primary", agent:fast.id, kind:"code" });
  const lane = await orchestrator.call(project, { do:"add-task", line:made.line, task:"mode:slow lane", agent:other.id, kind:"code", parallel:true });
  const laneRun = service.lanes.get(service.key(project, made.line))?.get(lane.work);
  await until(() => laneRun && laneRun.child, "lane running");
  laneRun.proxyRun = "credit-fixture";
  service.agents.creditsRefused = (agent, id) => id === "credit-fixture" ? { details:{ balance:0, required:1 } } : null;
  laneRun.child.kill();

  await until(() => !service.heldWorks(project, made.line).length, "primary finished after lane credit refusal");
  const final = doc(made.line);
  const primary = final.steps.find(s => s.id === made.work);
  assert.equal(primary.done, true);
  assert.equal(final.status, "waiting");
});

test("Stop and Retry while a preflight is pending launch exactly one agent", async t => {
  const { service, project, doc, prompts } = setup(t, "preflight-retry");
  const { slug } = await service.createTopic(project, { text:"Independent task", agent:"fake", kinds:["ask","work"], start:false });
  let entered, release;
  const pending = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const original = service.runCanvas.bind(service);
  service.runCanvas = async (...args) => {
    service.runCanvas = original;
    entered();
    await gate;
    return original(...args);
  };
  const starting = service.begin(project, slug);
  await pending;
  try {
    await service.stopWork(project, slug);
    const step = doc(slug).steps.find(F.AGENT_LIKE);
    assert.equal(step.off, "stopped");
    await service.begin(project, slug, { step:step.id });
  } finally { release(); }
  await starting;
  await until(() => doc(slug).status === "done");
  assert.equal(prompts(slug).length, 1);
});

test("Run with preserves the only copy of a request in every written revision", async t => {
  const { service, project, doc } = setup(t, "send-draft");
  const text = "Keep this exact Ask through shutdown.";
  const { slug } = await service.createTopic(project, { text, kinds:["ask"], start:false, unsent:true });
  const write = service.writeDoc.bind(service);
  const copies = [];
  service.writeDoc = (p, line, md) => {
    if (line === slug) copies.push(F.parseLine(md).asks.filter(a => a.text === text).length);
    return write(p, line, md);
  };
  await service.runUnsent(project, slug, { step:doc(slug).asks[0].id, agent:"fake" });
  await until(() => doc(slug).status === "done");
  assert.ok(copies.length && copies.every(count => count === 1));
});

test("A sent Ask wakes a Notes Line and an archived Line keeps its contents", async t => {
  const { service, project, doc, prompts } = setup(t, "notes-to-work");
  const slug = "notes";
  service.writeDoc(project, slug, F.initialLine({ title:"Notes", status:"notes", who:"fake", steps:[F.noteStep({ words:"Reference note" })] }));
  await service.act(project, slug, "feedback", { text:"Use my note", by:"fake" });
  await until(() => doc(slug).status === "done");
  assert.equal(prompts(slug).length, 1);
  service.writeDoc(project, slug, F.setFront(service.readDoc(project, slug), { status:"landed" }));
  const archived = service.readDoc(project, slug);
  await assert.rejects(service.request(project, { topic:slug, text:"Archived request", agent:"other" }), { code:"ARCHIVED" });
  await assert.rejects(service.saveUnsent(project, { topic:slug, text:"Archived draft" }), { code:"ARCHIVED" });
  assert.equal(service.readDoc(project, slug), archived);
});

for (const status of ["waiting", "stopped"]) {
  test(`A saved assignment starts on an idle ${status} Line`, async t => {
    const { service, orchestrator, project, fast, doc, prompts } = setup(t, "saved-ask");
    const slug = "saved";
    service.writeDoc(project, slug, F.initialLine({ id:"PE-501", title:"Saved", status, steps:[
      F.askStep({ words:"Original task" }), { ...F.workStep({ who:"fake" }), took:"1 min" },
      F.askStep({ words:"Run the saved assignment", via:F.NOT_SENT }),
    ] }));
    service.store.writeText(project, F.detailPath(slug, "work-1"), "# Original Work\n");
    const revision = F.hashText(service.readDoc(project, slug));
    const result = await orchestrator.call(project, { do:"start-line", line:slug, ask:"ask-2", revision, agent:fast.id, kind:"code" });
    await until(() => doc(slug).status === "done", "saved assignment finished");
    assert.equal(result.work, "work-2");
    assert.equal(prompts(slug).length, 1);
    assert.match(prompts(slug)[0].request, /Run the saved assignment/);
    assert.equal(doc(slug).steps.find(s => s.id === "work-1").off, "ended");
  });
}

test("Archiving a coordinator stops and archives its active child and revokes its pass", async t => {
  const { service, orchestrator, project, fast, doc } = setup(t, "archive-parent");
  const parent = await orchestrator.start(project, { goal:"mode:slow parent", preset:fast.id });
  orchestrator.setBase("http://127.0.0.1:3888/api/lines/orchestrate");
  const pass = orchestrator.env(project, parent.line, doc(parent.line)).PENECHO_ORCH_PASS;
  const child = await orchestrator.call(project, { do:"create-line", task:"mode:slow child", agent:fast.id, kind:"code" }, { session:parent.line });
  const { archiveOperation } = await service.act(project, parent.line, "close");
  assert.equal(doc(parent.line).status, "closed");
  assert.equal(doc(child.line).status, "closed");
  assert.equal(service.heldWorks(project, child.line).length, 0);
  await assert.rejects(orchestrator.agentCall(pass, { do:"help" }), { code:"PARENT_STOPPED" });
  await service.act(project, parent.line, "reopen", { archiveOperation });
  assert.equal(doc(child.line).status, "stopped");
  assert.equal(service.heldWorks(project, child.line).length, 0);
});

test("A new or unsent child awaiting Git cannot appear after its coordinator is archived", async t => {
  const { root, service, orchestrator, project, fast, doc } = setup(t, "archive-creation");
  project.codePaths.push(root);
  const Git = require("../src/server/project-lines/git.js");
  t.mock.method(Git, "isRepo", async () => true);
  const pending = [];
  t.mock.method(Git, "currentBranch", () => new Promise(resolve => pending.push(resolve)));
  const parent = "archive-job";
  service.writeDoc(project, parent, F.setFront(F.initialLine({ title:"Archive job", id:"PE-1", status:"notes", steps:[F.noteStep({ words:"A job" })] }), { orchestrator:"yes" }));
  const requests = [true, false].map(run => orchestrator.call(project, { do:"create-line", title:run ? "Late work" : "Late draft", task:"A late request", agent:fast.id, kind:"code", run }, { session:parent }));
  const rejected = Promise.all(requests.map(request => assert.rejects(request, { code:"PARENT_STOPPED" })));
  await until(() => pending.length === 2, "both child creates reached Git");
  await service.act(project, parent, "close");
  for (const release of pending) release("main");
  await rejected;
  assert.equal(doc(parent).status, "closed");
  assert.deepEqual(service.store.scan(project).topics.map(topic => topic.slug), [parent]);
});
