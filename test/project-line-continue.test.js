"use strict";
require("./helpers/safety.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { Service } = require("../src/server/project-lines/service.js");
const F = require("../src/server/project-lines/format.js");
const TaskContext = require("../src/server/project-lines/task-context.js");

async function until(find) {
  const end = Date.now() + 8000;
  while (Date.now() < end) {
    const value = find();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for the Work");
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "line-continue-"));
  const script = path.join(root, "runner.cjs"), calls = [], plans = [];
  fs.writeFileSync(script, `
const plan = JSON.parse(process.argv[2]), resume = process.argv[3], say = o => console.log(JSON.stringify(o));
require("node:readline").createInterface({ input:process.stdin }).once("line", line => {
  require("node:fs").writeFileSync(plan.promptFile, JSON.parse(line).message.content.map(p => p.text || "").join(""));
  const id = plan.different ? "unexpected-session" : resume || plan.session;
  if (id && !plan.missing) say({ type:"system", subtype:"init", session_id:id, model:"fixture" });
  if (plan.missing) {
    say({ type:"result", is_error:true, result:"No conversation found" });
    process.exitCode = 1;
    return process.stdin.unref();
  }
  say({ type:"assistant", message:{ id:plan.promptFile, model:"fixture", usage:{ input_tokens:plan.input || 20, cache_read_input_tokens:plan.cached || 0, cache_creation_input_tokens:0, output_tokens:20 }, content:[{ type:"text", text:resume ? "Resumed progress" : "Original progress" }] } });
  setTimeout(() => {
    say({ type:"result", session_id:id || undefined, is_error:Boolean(plan.fail), result:plan.fail ? "503 Request failed" : "Finished remaining work." });
    process.stdin.unref();
    process.exitCode = plan.fail ? 1 : 0;
  }, plan.delay || 1);
});`);
  const agents = {
    available:() => [{ id:"fake", available:true }, { id:"other", available:true }],
    command:(agent, { workdir, resume, exactResume }) => {
      const plan = { ...plans.shift(), promptFile:path.join(root, `prompt-${calls.length}`) };
      calls.push({ agent, resume, exactResume, prompt:() => fs.readFileSync(plan.promptFile, "utf8") });
      return { command:process.execPath, args:[script, JSON.stringify(plan), resume || ""], cwd:workdir, input:"stream-json", ownInstructions:true };
    },
  };
  const directory = path.join(root, "state");
  const service = new Service({ directory, agents, autoWatch:false, memory:{ home:root, env:{} }, conversations:{ home:root, env:{} } });
  const project = service.store.create({ name:"Continue test", docsPath:path.join(root, "docs") });
  project.follow = false;
  t.after(async () => {
    for (const job of service.runningJobs()) await service.stopWork(project, job.slug).catch(() => {});
    service.close();
    fs.rmSync(root, { recursive:true, force:true });
  });
  const ask = "Original Ask must stay in this session without being sent again.";
  const start = async plan => {
    plans.push(plan);
    const { slug } = await service.request(project, { text:ask, topic:"new", agent:"fake" });
    return slug;
  };
  const doc = slug => F.parseLine(service.readDoc(project, slug));
  const wait = slug => until(() => !service.heldWorks(project, slug).length);
  const detail = (slug, id = "work-1") => service.store.readText(project, F.detailPath(slug, id)).text;
  const view = slug => service.lineFrom(project, service.store.scan(project).topics.find(line => line.slug === slug));
  const json = rel => JSON.parse(service.store.readText(project, rel).text);
  return { service, project, calls, plans, ask, start, doc, wait, view, detail, json, directory };
}

test("Continue reuses the old large primary session and appends to the same Work", async t => {
  const f = fixture(t), { service, project } = f;
  const slug = await f.start({ session:"expensive-session", input:767500, cached:17210000, fail:true });
  await f.wait(slug);
  const detail = F.detailPath(slug, "work-1"), tokens = TaskContext.taskFile(slug, "work-1");
  const before = f.json(tokens);
  const id = F.splitFront(f.detail(slug)).front["task id"];
  service.store.writeText(project, detail, F.setFront(f.detail(slug), { ended:"2024-01-01 00:00", "stop why":"limit", "resets at":"2024-01-02T00:00:00.000Z" }));
  const sessions = service.sessions[service.key(project, slug)];
  Object.assign(sessions[":work:work-1"], { policyVersion:0, config:"old-config" });
  service.remember(project, slug, "fake", "unrelated-session", "work", project.docsPath, { agent:"fake", workId:"work-99" });
  assert.equal(f.view(slug).status, "stopped");
  assert.equal(f.view(slug).canContinue, true);
  assert.equal(f.view(slug).continueStep, "work-1");
  assert.equal(f.view(slug).stations.find(s => s.id === "work-1").canContinue, true);
  assert.ok(before.attempts[0].requests[0].inputTokens > 150000);
  const progress = service.activity.load(project, slug).rows.filter(r => r.step === "work-1").map(r => r.kind);
  f.plans.push({ delay:200 });
  assert.deepEqual(await service.act(project, slug, "continue"), { ok:true, step:"work-1" });
  assert.equal(f.calls[1].resume, "expensive-session");
  assert.equal(f.calls[1].exactResume, true);
  assert.equal(f.doc(slug).status, "working");
  assert.equal(f.view(slug).canContinue, undefined);
  assert.equal(F.sectionText(f.detail(slug), "Stopped"), null);
  assert.equal(F.splitFront(f.detail(slug)).front["stop why"], undefined);
  assert.equal(F.splitFront(f.detail(slug)).front.ended, undefined);
  await f.wait(slug);
  assert.equal(f.doc(slug).status, "done");
  assert.equal(f.doc(slug).steps.filter(F.AGENT_LIKE).length, 1);
  assert.equal(f.doc(slug).asks[0].text, f.ask);
  assert.equal(F.splitFront(f.detail(slug)).front["task id"], id);
  assert.doesNotMatch(f.calls[1].prompt(), /Original Ask/);
  assert.match(f.calls[1].prompt(), /Continue where you stopped/);
  // The same Work goes on; PenEcho saves the last message as its result, so no file is named to write (PE-916).
  assert.match(f.calls[1].prompt(), /Continue Work 1 in lines\//);
  const after = f.json(tokens);
  assert.deepEqual(after.attempts[0], before.attempts[0]);
  assert.equal(after.attempts.length, 2);
  assert.equal(after.attempts[1].sessionId, "expensive-session");
  assert.deepEqual(service.activity.load(project, slug).rows.filter(r => r.step === "work-1").slice(0, progress.length).map(r => r.kind), progress);
  assert.match(F.sectionText(f.detail(slug), "Earlier results"), /Original progress/);
  assert.equal(f.json(TaskContext.manifestFile(slug, "work-1")).attempts.length, 2);
});

test("Continue reopens a Work stopped by the person", async t => {
  const f = fixture(t), { service, project } = f;
  const slug = await f.start({ session:"manual-session", delay:30000 });
  await until(() => service.sessions[service.key(project, slug)]?.[":work:work-1"]);
  await service.stopWork(project, slug);
  const work = f.doc(slug).steps.find(F.AGENT_LIKE);
  assert.equal(work.done, true);
  assert.equal(work.off, "stopped");
  f.plans.push({});
  await service.act(project, slug, "continue", { step:work.id });
  await f.wait(slug);
  assert.equal(f.calls[1].resume, "manual-session");
  assert.equal(f.doc(slug).steps.filter(F.AGENT_LIKE).length, 1);
  assert.equal(f.doc(slug).steps.find(F.AGENT_LIKE).off, undefined);
});

test("Continue accepts a legacy lane key without disturbing a primary Work", async t => {
  const f = fixture(t), { service, project } = f;
  const slug = await f.start({ session:"primary-session", delay:30000 });
  const key = service.key(project, slug);
  const primary = service.runs.get(key);
  const lane = "work-2";
  service.writeDoc(project, slug, F.updateSteps(service.readDoc(project, slug), steps => {
    steps.push({ ...F.workStep({ who:"other", done:true }), off:"stopped" });
  }));
  const rel = F.detailPath(slug, lane);
  service.store.writeText(project, rel, F.setSection(F.initialDetail({ slug, title:"Test", label:"Work 2", who:"other", started:F.nowLabel(), now:"" }), "Stopped", "Stopped by you"));
  service.remember(project, slug, `other#${lane}`, "lane-session", "work", project.docsPath);
  assert.equal(f.view(slug).continueStep, undefined);
  assert.equal(f.view(slug).stations.find(s => s.id === lane).canContinue, true);
  f.plans.push({ delay:200 });
  await service.act(project, slug, "continue", { step:lane });
  assert.equal(service.runs.get(key), primary);
  assert.equal(service.lanes.get(key).get(lane).sessionId, "lane-session");
  await until(() => !service.heldWorks(project, slug).some(r => r.stepId === lane));
  assert.equal(f.doc(slug).status, "working");
  assert.equal(f.doc(slug).front.who, "@fake");
  assert.equal(f.doc(slug).steps.find(s => s.id === lane).off, undefined);
});

test("Continue rejects absent, unrelated, busy, orphaned, human and non-stopped sessions", async t => {
  const f = fixture(t), { service, project } = f;
  const slug = await f.start({ fail:true });
  await f.wait(slug);
  const key = service.key(project, slug), original = service.readDoc(project, slug), detail = f.detail(slug);
  service.remember(project, slug, "fake", "unproven-alias", "work", project.docsPath);
  assert.equal(f.view(slug).canContinue, undefined);
  const reject = code => assert.rejects(service.act(project, slug, "continue", { step:"work-1" }), { status:409, code });
  await reject("NO_WORK_SESSION");
  service.remember(project, slug, "fake", "saved-session", "work", project.docsPath, { agent:"fake", workId:"work-1" });
  service.heldElsewhere = async () => true;
  await reject("SESSION_BUSY");
  service.heldElsewhere = async () => false;
  service.stopActiveCounts.set(key, 1);
  await reject("BUSY");
  service.stopActiveCounts.delete(key);
  service.leftRunning = [{ key, discoveryIncomplete:true }];
  await reject("BUSY");
  service.leftRunning = [];
  assert.equal(service.readDoc(project, slug), original);
  assert.equal(f.detail(slug), detail);
  service.writeDoc(project, slug, F.setFront(original, { status:"working" }));
  await reject("NOT_STOPPED");
  service.writeDoc(project, slug, F.updateSteps(original, steps => { steps.find(F.AGENT_LIKE).who = "you"; }));
  await reject("HUMAN_STEP");
  assert.equal(f.calls.length, 1);
});

test("Continue reserves a session before asynchronous admission and never retries a missing session", async t => {
  const f = fixture(t), { service, project } = f;
  const slug = await f.start({ session:"gone", fail:true });
  await f.wait(slug);
  let check;
  service.heldElsewhere = () => new Promise(resolve => { check = resolve; });
  service.writeDoc(project, slug, F.updateSteps(service.readDoc(project, slug), steps => {
    steps.push({ ...F.workStep({ who:"fake", done:true }), off:"stopped" });
  }));
  service.store.writeText(project, F.detailPath(slug, "work-2"), F.initialDetail({ slug, label:"Work 2", who:"fake", started:F.nowLabel(), now:"" }));
  service.remember(project, slug, "fake#work-2", "gone", "work", project.docsPath);
  f.plans.push({ missing:true });
  const first = service.act(project, slug, "continue");
  assert.equal(typeof check, "function");
  await assert.rejects(service.act(project, slug, "continue"), { status:409, code:"BUSY" });
  await assert.rejects(service.act(project, slug, "continue", { step:"work-2" }), { status:409, code:"SESSION_BUSY" });
  check(false);
  await first;
  await f.wait(slug);
  assert.equal(f.calls.length, 2);
  assert.equal(f.doc(slug).status, "stopped");
  assert.match(f.doc(slug).front.why, /could not find.*saved session/);
  assert.equal(f.view(slug).canContinue, undefined);
  assert.equal(f.view(slug).stations.find(s => s.id === "work-2").canContinue, undefined);
});

test("Known credit and session failures keep the original stopped Work intact", async t => {
  const f = fixture(t), { service, project } = f;
  const slug = await f.start({ session:"old", fail:true });
  await f.wait(slug);
  const original = service.readDoc(project, slug), detail = f.detail(slug);
  service.agents.creditsRefusal = async () => ({ details:{ balance:0 } });
  await assert.rejects(service.act(project, slug, "continue"), { status:409, code:"CONTINUE_FAILED", message:/Out of credits/ });
  service.agents.creditsRefusal = async () => null;
  service.agents.hasResumeSession = () => false;
  assert.equal(f.view(slug).canContinue, undefined);
  await assert.rejects(service.act(project, slug, "continue"), { status:409, code:"NO_WORK_SESSION" });
  assert.equal(f.calls.length, 1);
  assert.equal(service.readDoc(project, slug), original);
  assert.equal(f.detail(slug), detail);
});

test("A reused Work number cannot pick up the removed Work's session", async t => {
  const f = fixture(t), { service, project } = f;
  const slug = await f.start({ session:"old", fail:true });
  await f.wait(slug);
  service.store.writeText(project, F.detailPath(slug, "work-1"), F.setFront(f.detail(slug), { "started at":"2026-11-01T10:00:00Z" }));
  assert.equal(f.view(slug).canContinue, undefined);
  await assert.rejects(service.act(project, slug, "continue"), { status:409, code:"NO_WORK_SESSION" });
});

test("Continue stops a runner that reports a different session and retains the original binding", async t => {
  const f = fixture(t), { service, project } = f;
  const slug = await f.start({ session:"keep-me", fail:true });
  await f.wait(slug);
  f.plans.push({ different:true, delay:1000 });
  await service.act(project, slug, "continue");
  await f.wait(slug);
  assert.equal(f.calls.length, 2);
  assert.equal(f.doc(slug).status, "stopped");
  assert.match(f.doc(slug).front.why, /different session/);
  assert.equal(service.sessions[service.key(project, slug)][":work:work-1"].id, "keep-me");
  assert.equal(f.json(TaskContext.taskFile(slug, "work-1")).attempts.at(-1).sessionId, "keep-me");
});

test("PenEcho's runner refuses missing or malformed strict resume history without creating a session", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "strict-runner-"));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const session = "7093dc04-18af-4a71-a4a7-338707cd8ca6";
  const file = path.join(root, `${session}.json`);
  const run = () => spawnSync(process.execPath, [path.join(__dirname, "../src/server/project-lines/penecho-runner.mjs"), "--sessions", root, "--resume", session, "--require-session"], { encoding:"utf8", timeout:5000 });
  let result = run();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /saved PenEcho session was not found/);
  assert.equal(fs.existsSync(file), false);
  for (const content of ["invalid JSON", JSON.stringify({ id:"wrong", turns:[] }), JSON.stringify({ id:session, turns:[null] })]) {
    fs.writeFileSync(file, content);
    result = run();
    assert.equal(result.status, 1);
    assert.match(result.stdout, /saved PenEcho session was not found/);
    assert.equal(fs.readFileSync(file, "utf8"), content);
  }
});
