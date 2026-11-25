"use strict";
require("./helpers/safety.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile, execFileSync } = require("node:child_process");
const { Service } = require("../src/server/project-lines/service.js");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { createAgentPresets } = require("../src/server/project-lines/agent-presets.js");
const { createOrchestrator } = require("../src/server/project-lines/orchestrator.js");
const F = require("../src/server/project-lines/format.js");
const LINE_STATUS = require("../public/lines/line-status.js");

function makeRoot(t, prefix = "line-sm-fixes-") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive:true, force:true, maxRetries:5, retryDelay:50 }));
  return root;
}

function makeFakeAgentScript(root) {
  const script = path.join(root, "fake-agent.js");
  fs.writeFileSync(script, `
const fs = require("node:fs"), path = require("node:path");
let input = "";
process.stdin.on("data", d => { input += d; });
process.stdin.on("end", () => {
  const reqMatch = /<request>([\\s\\S]*?)<\\/request>/.exec(input);
  const current = reqMatch ? reqMatch[1] : input;
  if (current.includes("mode:fail")) {
    console.log(JSON.stringify({ type:"result", is_error:true, result:"Simulated agent failure." }));
    process.exit(1);
  }
  if (current.includes("mode:slow")) {
    setTimeout(() => {
      console.log(JSON.stringify({ type:"result", is_error:false, result:"Slow done." }));
      process.exit(0);
    }, 30000);
    return;
  }
  if (current.includes("mode:empty-ask")) {
    const docs = process.env.PENECHO_DOCS_FOLDER, slug = process.env.PENECHO_LINE;
    const file = path.join(docs, "lines", slug + ".md");
    const md = fs.readFileSync(file, "utf8")
      .replace("status: working", "status: waiting\\nwhy: Needs confirmation")
      .replace(/^## Ask/m, "## Questions for you\\n\\n**Ship it?** (@fake)\\n\\n- [ ] Yes\\n- [ ] No\\n\\n## Ask");
    fs.writeFileSync(file, md);
    console.log(JSON.stringify({ type:"result", is_error:false, result:"" }));
    process.exit(0);
  }
  console.log(JSON.stringify({ type:"result", is_error:false, result:"Completed: " + input.slice(0, 80).replace(/\\s+/g, " ") }));
  process.exit(0);
});
`);
  return script;
}

function fakeAgents(script) {
  const adapter = name => ({
    name, mono:name.slice(0, 2), color:"#2563eb", role:"Build",
    resolve:() => ({ command:process.execPath, prefixArgs:[script] }),
    command:(launch, { workdir }) => ({ command:launch.command, args:launch.prefixArgs, cwd:workdir, stdin:true }),
  });
  return createAgents({ env:{ PATH:"" }, extra:{ fake:adapter("Fake"), other:adapter("Other") } });
}

async function until(fn, label = "condition", ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

test("paused status is removed: legacy paused normalizes on read, pause/resume reject, settle & reopen never emit paused", async t => {
  const root = makeRoot(t);
  const directory = path.join(root, "state"), docs = path.join(root, "docs");
  fs.mkdirSync(directory, { recursive:true });
  const service = new Service({ directory, agents:fakeAgents(makeFakeAgentScript(root)), autoWatch:false });
  t.after(() => service.close());
  const project = service.store.create({ name:"No Paused", docsPath:docs });
  project.follow = false; service.store.save();

  // Legacy paused frontmatter normalizes cleanly depending on content
  assert.equal(F.parseLine("---\nstatus: paused\n---\n\n# A\n\n## Ask\n\nHi\n\n## [ ] Work 1 · @fake\n").status, "stopped");
  assert.equal(F.parseLine("---\nstatus: paused\nwhy: Not started. Resume to give it to an agent.\n---\n\n# A\n\n## Ask\n\nHi\n\n## [ ] Work 1 · @fake\n").status, "not-started");
  assert.equal(F.parseLine("---\nstatus: paused\n---\n\n# A\n\n## Ask\n\nHi\n\n## [x] Work 1 · @fake · 1 min\n").status, "done");
  assert.equal(F.parseLine("---\nstatus: paused\n---\n\n# A\n\n## Note\n\nMemo\n").status, "notes");
  assert.equal(F.parseLine("---\nstatus: paused\n---\n\n# A\n\n## Ask · 2026-11-20 07:00 · Not sent\n\nDraft\n").status, "waiting");

  // LINE_STATUS never returns paused and maps stale cloud 'paused' safely to 'error' (not 'working')
  assert.equal(LINE_STATUS.lineState({ status:"paused" }), "error");
  assert.equal(LINE_STATUS.lineState({ status:"not-started" }), "backlog");

  // pause and resume actions are both rejected
  service.writeDoc(project, "one", F.initialLine({ title:"One", status:"not-started", steps:[F.askStep({ words:"Do it" }), F.workStep({ who:"fake" })] }));
  await assert.rejects(service.act(project, "one", "pause"), { code:"BAD_ACTION" });
  await assert.rejects(service.act(project, "one", "resume"), { code:"BAD_ACTION" });
  const line = service.stateOf(project).backlog.find(l => l.id === "one");
  assert.ok(line, "not-started Line is in backlog");
  assert.equal("paused" in line, false, "lineFrom omits removed paused field");

  // settle() on open unstarted step -> not-started; started step -> stopped; non-agent -> waiting
  await service.settle(project, "one");
  assert.equal(F.parseLine(service.readDoc(project, "one")).status, "not-started");
  service.store.writeText(project, F.detailPath("one", "work-1"), F.initialDetail({ slug:"one", title:"One", label:"Work 1", who:"fake", started:"2026-11-20 07:00", now:"" }));
  await service.settle(project, "one");
  assert.equal(F.parseLine(service.readDoc(project, "one")).status, "stopped");

  service.writeDoc(project, "sketch", F.initialLine({ title:"Sketch", status:"working", steps:[F.askStep({ words:"Draw" }), F.workStep({ kind:"sketch", who:"you" })] }));
  await service.settle(project, "sketch");
  assert.equal(F.parseLine(service.readDoc(project, "sketch")).status, "waiting");

  // P2-1: reopen of Line archived while working with 0 open steps settles to done (not paused or stopped)
  service.writeDoc(project, "done-while-working", F.initialLine({ title:"Done", status:"working", steps:[F.askStep({ words:"Hi" }), { ...F.workStep({ who:"fake" }), done:true, took:"1 min" }] }));
  await service.act(project, "done-while-working", "close");
  await service.act(project, "done-while-working", "reopen");
  assert.equal(F.parseLine(service.readDoc(project, "done-while-working")).status, "done");
});

test("P0-2: watchAll heals stuck working Lines that have open steps and no active run", async t => {
  const root = makeRoot(t);
  const directory = path.join(root, "state"), docs = path.join(root, "docs");
  fs.mkdirSync(directory, { recursive:true });
  const service = new Service({ directory, agents:fakeAgents(makeFakeAgentScript(root)), autoWatch:false });
  t.after(() => service.close());
  const project = service.store.create({ name:"Stuck Working", docsPath:docs });
  project.follow = false; service.store.save();

  // Case A1: stalled Work WITH launch evidence (detail file) heals to stopped
  service.writeDoc(project, "stuck-started", F.initialLine({ title:"Stuck Started", status:"working", steps:[F.askStep({ words:"Run me" }), F.workStep({ who:"fake" })] }));
  service.store.writeText(project, F.detailPath("stuck-started", "work-1"), F.initialDetail({ slug:"stuck-started", title:"Stuck Started", label:"Work 1", who:"fake", started:"2026-11-20 06:00", now:"Starting" }));
  // Case A2: untouched open Work with NO launch evidence heals to not-started (no fake interruption, no auto-start)
  service.writeDoc(project, "stuck-open", F.initialLine({ title:"Stuck Open", status:"working", steps:[F.askStep({ words:"Run me" }), F.workStep({ who:"fake" })] }));
  // Case B: crashed after closeDetail wrote clean ended: before ticking [x]
  service.writeDoc(project, "stuck-ended", F.initialLine({ title:"Stuck Ended", status:"working", steps:[F.askStep({ words:"Finish me" }), F.workStep({ who:"fake" })] }));
  const finishedDetail = F.setFront(
    F.setSection(F.initialDetail({ slug:"stuck-ended", title:"Stuck Ended", label:"Work 1", who:"fake", started:"2026-11-20 06:00", now:"" }), "Result", "<!-- result: the agent's last message -->\nAll done cleanly.\n<!-- /result -->"),
    { took:"2 min", ended:"2026-11-20 06:02" }
  );
  service.store.writeText(project, F.detailPath("stuck-ended", "work-1"), finishedDetail);
  // Case C: live leftRunning PID must NOT be healed prematurely
  service.writeDoc(project, "live-pid", F.initialLine({ title:"Live PID", status:"working", steps:[F.askStep({ words:"Keep going" }), F.workStep({ who:"fake" })] }));
  service.leftRunning = [{ key:service.key(project, "live-pid"), pid:process.pid }];
  // Case D (R22): clean-ended Work 1 followed by queued Work 2 -> Work 1 ticked, Line becomes not-started without blaming Work 2
  service.writeDoc(project, "ended-then-queued", F.initialLine({ title:"Ended Queued", status:"working", steps:[F.askStep({ words:"One" }), F.workStep({ who:"fake" }), F.askStep({ words:"Two" }), F.workStep({ who:"other" })] }));
  service.store.writeText(project, F.detailPath("ended-then-queued", "work-1"), finishedDetail);
  // Case E (R22): clean-ended Work 1 followed by Sketch -> Work 2 -> Work 1 ticked, Line becomes waiting for Sketch (never skips Sketch to blame Work 2!)
  service.writeDoc(project, "ended-then-sketch", F.initialLine({ title:"Ended Sketch", status:"working", steps:[F.askStep({ words:"One" }), F.workStep({ who:"fake" }), F.workStep({ kind:"sketch", who:"you" }), F.workStep({ who:"other" })] }));
  service.store.writeText(project, F.detailPath("ended-then-sketch", "work-1"), finishedDetail);

  const old = new Date(Date.now() - 120_000);
  for (const slug of ["stuck-started", "stuck-open", "stuck-ended", "live-pid", "ended-then-queued", "ended-then-sketch"]) {
    const file = service.store.resolve(project, `lines/${slug}.md`);
    fs.utimesSync(file, old, old);
  }
  await service.watchAll();

  const startedDoc = F.parseLine(service.readDoc(project, "stuck-started"));
  assert.equal(startedDoc.status, "stopped", "stalled working Line with launch evidence heals to stopped");
  assert.match(startedDoc.front.why || "", /PenEcho closed while this was running/);

  const openDoc = F.parseLine(service.readDoc(project, "stuck-open"));
  assert.equal(openDoc.status, "not-started", "untouched working Line with no launch evidence heals to not-started without inventing an interruption");

  const endedDoc = F.parseLine(service.readDoc(project, "stuck-ended"));
  assert.equal(endedDoc.status, "done", "crashed post-closeDetail working Line heals cleanly to done");
  assert.equal(endedDoc.steps.find(s => s.id === "work-1").done, true);

  const liveDoc = F.parseLine(service.readDoc(project, "live-pid"));
  assert.equal(liveDoc.status, "working", "Line with live orphaned PID is left untouched");

  const eqDoc = F.parseLine(service.readDoc(project, "ended-then-queued"));
  assert.equal(eqDoc.steps.find(s => s.id === "work-1").done, true);
  assert.equal(eqDoc.status, "not-started", "clean-ended Work 1 followed by queued Work 2 settles to not-started without blaming Work 2");
  assert.equal(service.store.exists(project, F.detailPath("ended-then-queued", "work-2")), false, "queued Work 2 was not falsely interrupted");

  const esDoc = F.parseLine(service.readDoc(project, "ended-then-sketch"));
  assert.equal(esDoc.steps.find(s => s.id === "work-1").done, true);
  assert.equal(esDoc.status, "waiting", "clean-ended Work 1 followed by Sketch settles to waiting for Sketch");
  assert.match(esDoc.front.why || "", /Sketch is yours to do/);
  assert.equal(service.store.exists(project, F.detailPath("ended-then-sketch", "work-2")), false, "Work 2 after Sketch was not blamed");
});

test("P0-3: discardWork resumes queued Work, carryOnWith runs fresh Work in place, and wait() surfaces failed parallel lanes", async t => {
  const root = makeRoot(t);
  const script = makeFakeAgentScript(root);
  const directory = path.join(root, "state"), docs = path.join(root, "docs");
  fs.mkdirSync(directory, { recursive:true });
  const agents = fakeAgents(script);
  const service = new Service({ directory, agents, autoWatch:false });
  service.presets = createAgentPresets({ file:path.join(directory, "agent-presets.json"), agents });
  const fakePreset = service.presets.add({ name:"Fake", agent:"fake" });
  const otherPreset = service.presets.add({ name:"Other", agent:"other" });
  const orchestrator = createOrchestrator({ service, directory });
  t.after(() => service.close());
  const project = service.store.create({ name:"P0-3", docsPath:docs });
  project.follow = false; service.store.save();

  // 1) discardWork resumes queued Work 2 instead of stranding as paused
  service.writeDoc(project, "q-discard", F.initialLine({
    title:"Discard Queue", status:"stopped", why:"Work 1 failed",
    steps:[
      F.askStep({ words:"First" }), F.workStep({ who:"fake" }),
      F.askStep({ words:"Second queued task" }), F.workStep({ who:"other" }),
    ],
  }));
  await service.act(project, "q-discard", "discard", { step:"work-1" });
  await until(() => F.parseLine(service.readDoc(project, "q-discard")).status === "done", "queued work 2 finishes");
  const dDoc = F.parseLine(service.readDoc(project, "q-discard"));
  assert.equal(dDoc.steps.find(s => s.id === "work-1").off, "discarded");
  assert.equal(dDoc.steps.find(s => s.id === "work-2").done, true);
  assert.equal(dDoc.steps.find(s => s.id === "work-2").off || "", "");

  // 2) carryOnWith inserts and launches the carry-on step right after the stopped Work, ahead of queued Work 2
  service.writeDoc(project, "q-carry", F.initialLine({
    title:"Carry Queue", status:"stopped", why:"Work 1 failed",
    steps:[
      F.askStep({ words:"First" }), F.workStep({ who:"fake" }),
      F.askStep({ words:"Second queued" }), F.workStep({ who:"other" }),
    ],
  }));
  const carried = await service.act(project, "q-carry", "carry-on", { agent:"other", step:"work-1" });
  assert.equal(carried.step, "work-3", "carry-on allocates a unique id without colliding with queued work-2 and launches it first");
  await until(() => F.parseLine(service.readDoc(project, "q-carry")).status === "done", "carry-on and queued work finish");
  const cDoc = F.parseLine(service.readDoc(project, "q-carry"));
  assert.deepEqual(cDoc.steps.filter(F.AGENT_LIKE).map(s => [s.id, s.done, s.off || ""]), [
    ["work-1", true, "ended"],
    ["work-3", true, ""],
    ["work-2", true, ""],
  ]);

  // 3) Orchestrator wait() surfaces failed parallel lane in stoppedWorks even when primary succeeded
  const made = await orchestrator.call(project, { do:"create-line", task:"mode:slow primary", agent:fakePreset.id, kind:"code" });
  await until(() => service.runs.size === 1, "primary running");
  const lane = await orchestrator.call(project, { do:"add-task", line:made.line, task:"mode:fail lane", agent:otherPreset.id, kind:"code", parallel:true });
  await until(() => F.parseLine(service.readDoc(project, made.line)).steps.find(s => s.id === lane.work)?.off === "stopped", "lane failed");
  // Let primary complete cleanly
  const primaryRun = service.runs.get(service.key(project, made.line));
  primaryRun.said = "Primary succeeded.";
  try { primaryRun.child?.kill(); } catch {}
  await service.ended(project, made.line, primaryRun, 0);
  await until(() => !service.heldWorks(project, made.line).length && F.parseLine(service.readDoc(project, made.line)).status === "done", "line settled");
  const waited = await orchestrator.call(project, { do:"wait", lines:[made.line], seconds:2 });
  assert.equal(waited.done, true);
  assert.equal(waited.lines[0].status, "done");
  assert.deepEqual(waited.lines[0].stoppedWorks, [{ work:lane.work, state:"off", off:"stopped", stopWhy:"error" }]);
});

test("P0-4 & P1-4: manual Stop with no completed Work sets stopped, supports Retry and Orchestrator retry, and add-task clears stale questions", async t => {
  const root = makeRoot(t);
  const script = makeFakeAgentScript(root);
  const directory = path.join(root, "state"), docs = path.join(root, "docs");
  fs.mkdirSync(directory, { recursive:true });
  const agents = fakeAgents(script);
  const service = new Service({ directory, agents, autoWatch:false });
  service.presets = createAgentPresets({ file:path.join(directory, "agent-presets.json"), agents });
  const fakePreset = service.presets.add({ name:"Fake", agent:"fake" });
  const orchestrator = createOrchestrator({ service, directory });
  t.after(() => service.close());
  const project = service.store.create({ name:"Stop Retry", docsPath:docs });
  project.follow = false; service.store.save();

  // Manual Stop on sole running Work -> status: stopped (not done)
  const made = await orchestrator.call(project, { do:"create-line", task:"mode:slow work", agent:fakePreset.id, kind:"code" });
  await until(() => service.runs.size === 1, "started");
  await orchestrator.call(project, { do:"stop", line:made.line });
  const stoppedDoc = F.parseLine(service.readDoc(project, made.line));
  assert.equal(stoppedDoc.status, "stopped");
  assert.equal(stoppedDoc.front.why, "Stopped by you");

  const waited = await orchestrator.call(project, { do:"wait", lines:[made.line], seconds:2 });
  assert.equal(waited.done, true);
  assert.equal(waited.lines[0].status, "stopped");
  assert.equal(waited.lines[0].why, "Stopped by you");
  assert.equal(waited.lines[0].stoppedWorks.length, 1);

  // Rewrite Ask so retry completes fast, then use Orchestrator `retry` action
  service.writeDoc(project, made.line, service.readDoc(project, made.line).replace("mode:slow work", "fast retry work"));
  const retried = await orchestrator.call(project, { do:"retry", line:made.line });
  assert.equal(retried.line, made.line);
  await until(() => F.parseLine(service.readDoc(project, made.line)).status === "done", "retried work finished");
  assert.equal(F.parseLine(service.readDoc(project, made.line)).steps.filter(F.AGENT_LIKE).length, 2);

  // Retry rejects non-stopped Line
  await assert.rejects(orchestrator.call(project, { do:"retry", line:made.line }), { code:"NOT_STOPPED" });

  // P1-4: add-task on waiting Line clears stale ## Questions for you
  service.writeDoc(project, "waiting-q", `---\nid: PE-99\nstatus: waiting\nwhy: Your answer\nwho: @fake\n---\n\n# Ask Q\n\n## Questions for you\n\n**Pick one?** (@fake)\n\n- [ ] A\n- [ ] B\n\n## Ask · 2026-11-20 07:00\n\nInitial\n\n## [ ] Work 1 · @fake · 1 min\n`);
  await orchestrator.call(project, { do:"add-task", line:"waiting-q", task:"Proceed with A", agent:fakePreset.id, kind:"code" });
  const qLine = service.stateOf(project).lines.find(l => l.id === "waiting-q");
  assert.equal(qLine.questions.length, 0, "stale questions cleared on add-task");
  assert.equal(LINE_STATUS.lineNeedsYou(qLine), false);
  await until(() => !service.heldWorks(project, "waiting-q").length, "waiting-q settled");
});

test("P0-5: launchWork writes keepNote before saveActive and startRuntime honors live pid.json when run.json is missing", async t => {
  const root = makeRoot(t);
  const script = makeFakeAgentScript(root);
  const directory = path.join(root, "state"), docs = path.join(root, "docs");
  fs.mkdirSync(directory, { recursive:true });
  const service = new Service({ directory, agents:fakeAgents(script), autoWatch:false });
  t.after(() => service.close());
  const project = service.store.create({ name:"P0-5", docsPath:docs });
  project.follow = false; service.store.save();

  const order = [];
  const origKeep = service.keepNote.bind(service), origSave = service.saveActive.bind(service);
  service.keepNote = (...args) => { if (args[3] === true) order.push("keepNote"); return origKeep(...args); };
  service.saveActive = (...args) => { order.push("saveActive"); return origSave(...args); };

  const { slug } = await service.createTopic(project, { text:"quick task", agent:"fake" });
  await until(() => F.parseLine(service.readDoc(project, slug)).status === "done", "done");
  const keepIdx = order.indexOf("keepNote"), saveAfterKeep = order.indexOf("saveActive", keepIdx);
  assert.ok(keepIdx >= 0 && saveAfterKeep > keepIdx, `expected keepNote before final saveActive, got: ${JSON.stringify(order)}`);
  service.close();

  // Simulate missing run.json with live pid.json in keep directory
  const keepDir = path.join(directory, "keep", "orphan-test");
  fs.mkdirSync(keepDir, { recursive:true });
  fs.writeFileSync(path.join(keepDir, "pid.json"), JSON.stringify({ keeper:process.pid, agent:process.pid }));
  service.writeDoc(project, "orphan", F.initialLine({ title:"Orphan", status:"working", steps:[F.askStep({ words:"Keep" }), F.workStep({ who:"fake" })] }));
  fs.writeFileSync(path.join(directory, "active-runs.json"), JSON.stringify([{ key:`${project.id}/orphan`, stepId:"work-1", agent:"fake", pid:0, keep:keepDir }]));

  const restarted = new Service({ directory, agents:fakeAgents(script), autoWatch:false, recoverOnStart:true, carryOn:true });
  t.after(() => restarted.close());
  assert.equal(restarted.leftRunning.length, 1, "live pid.json keeps entry in leftRunning");
  assert.equal(F.parseLine(restarted.readDoc(project, "orphan")).status, "working", "must not falsely mark stopped or spawn duplicate");
});

test("P1-2: wait() settles on not-started, parent Stop cascades to active sublines, and announce() persists endpoint.json", async t => {
  const root = makeRoot(t);
  const script = makeFakeAgentScript(root);
  const directory = path.join(root, "state"), docs = path.join(root, "docs");
  fs.mkdirSync(directory, { recursive:true });
  const agents = fakeAgents(script);
  const service = new Service({ directory, agents, autoWatch:false });
  service.presets = createAgentPresets({ file:path.join(directory, "agent-presets.json"), agents });
  const fakePreset = service.presets.add({ name:"Fake", agent:"fake" });
  const orchestrator = createOrchestrator({ service, directory });
  orchestrator.setBase("http://127.0.0.1:4111/api/lines/orchestrate");
  t.after(() => service.close());
  const project = service.store.create({ name:"P1-2", docsPath:docs });
  project.follow = false; service.store.save();

  // wait() immediately settles on not-started
  service.writeDoc(project, "idle-ns", F.initialLine({ title:"Not Started", status:"not-started", steps:[F.askStep({ words:"Later" }), F.workStep({ who:"fake" })] }));
  const waited = await orchestrator.call(project, { do:"wait", lines:["idle-ns"], seconds:10 });
  assert.equal(waited.done, true);
  assert.equal(waited.lines[0].status, "not-started");

  // announce() writes endpoint.json (0o600) and env() exposes PENECHO_ORCH_ENDPOINT
  orchestrator.announce(4321);
  const env = orchestrator.env(project, "parent", { front:{ orchestrator:"yes" } });
  assert.ok(env.PENECHO_ORCH_ENDPOINT);
  const ep = JSON.parse(fs.readFileSync(env.PENECHO_ORCH_ENDPOINT, "utf8"));
  assert.equal(ep.url, "http://127.0.0.1:4321/api/lines/orchestrate");
  assert.equal(ep.port, 4321);
  if (process.platform !== "win32") assert.equal(fs.statSync(env.PENECHO_ORCH_ENDPOINT).mode & 0o777, 0o600);

  // Parent Stop cascades to active sublines while leaving finished siblings alone
  const parent = await orchestrator.start(project, { goal:"mode:slow parent", preset:fakePreset.id });
  await until(() => service.runs.has(service.key(project, parent.line)), "parent running");
  const parentRef = F.parseLine(service.readDoc(project, parent.line)).front.id;
  const activeChild = await orchestrator.call(project, { do:"create-line", task:"mode:slow child", agent:fakePreset.id, kind:"code" }, { session:parent.line });
  await until(() => service.runs.has(service.key(project, activeChild.line)), "child running");
  service.writeDoc(project, "done-child", F.initialLine({ title:"Done Child", status:"done", steps:[F.askStep({ words:"Already done" }), { ...F.workStep({ who:"fake" }), done:true, took:"1 min" }] }));
  service.writeDoc(project, "done-child", F.setFront(service.readDoc(project, "done-child"), { "orchestrated by":parentRef }));

  await service.act(project, parent.line, "stop");
  assert.equal(service.runs.size, 0, "both parent and active child runs stopped");
  assert.equal(F.parseLine(service.readDoc(project, parent.line)).status, "stopped");
  assert.equal(F.parseLine(service.readDoc(project, activeChild.line)).status, "stopped");
  assert.equal(F.parseLine(service.readDoc(project, "done-child")).status, "done", "finished child untouched");
});

test("P1-3: standby PenEcho rejects /api/lines/orchestrate with 409 RUNTIME_BUSY", async t => {
  const root = makeRoot(t);
  const directory = path.join(root, "state"), docs = path.join(root, "docs");
  fs.mkdirSync(directory, { recursive:true });
  const responses = [];
  const send = (_res, status, body) => responses.push({ status, body });
  const readJson = async () => ({ do:"help" });
  const owner = createProjectLines({ directory, authorizeRead:() => null, authorizeWrite:() => null, readJson, send, serviceOptions:{ autoWatch:false, recoverOnStart:true } });
  const standby = createProjectLines({ directory, authorizeRead:() => null, authorizeWrite:() => null, readJson, send, serviceOptions:{ autoWatch:false, recoverOnStart:true } });
  t.after(() => { standby.close(); owner.close(); });
  owner.service.store.create({ name:"Busy", docsPath:docs });

  assert.ok(standby.service.runtimeBusy && !standby.service.releaseRuntime, "second instance is standby");
  const req = { method:"POST", headers:{ "x-penecho-pass":"any" } };
  const res = { headersSent:false, writableEnded:false, on() {} };
  const handled = await standby.handle(req, res, new URL("http://127.0.0.1/api/lines/orchestrate"));
  assert.equal(handled, true);
  assert.equal(responses.length, 1);
  assert.equal(responses[0].status, 409);
  assert.equal(responses[0].body.code, "RUNTIME_BUSY");
});

test("P1-5: waiting Line with custom why and empty agent output unblocks when questions are answered", async t => {
  const root = makeRoot(t);
  const script = makeFakeAgentScript(root);
  const directory = path.join(root, "state"), docs = path.join(root, "docs");
  fs.mkdirSync(directory, { recursive:true });
  const service = new Service({ directory, agents:fakeAgents(script), autoWatch:false });
  t.after(() => service.close());
  const project = service.store.create({ name:"P1-5", docsPath:docs });
  project.follow = false; service.store.save();

  const { slug } = await service.createTopic(project, { text:"mode:empty-ask", agent:"fake" });
  await until(() => !service.heldWorks(project, slug).length && F.parseLine(service.readDoc(project, slug)).status === "waiting", "waiting on custom why");
  const waitingDoc = F.parseLine(service.readDoc(project, slug));
  assert.equal(waitingDoc.front.why, "Needs confirmation");
  assert.ok(waitingDoc.steps.find(s => s.id === "work-1").took, "took recorded even with empty output");

  // Rewrite Ask so continuation finishes cleanly
  service.writeDoc(project, slug, service.readDoc(project, slug).replace("mode:empty-ask", "continue after answer"));
  await service.act(project, slug, "answer", { questionRev:F.parseLine(service.readDoc(project, slug)).questionRev, question:"Ship it?", answer:"Yes" });
  await until(() => F.parseLine(service.readDoc(project, slug)).status === "done", "resumed and finished after answer");

  // Non-agent step (sketch) must NOT wake an agent on question answer
  service.writeDoc(project, "yours-only", `---\nid: PE-88\nstatus: waiting\nwhy: Sketch is yours to do\n---\n\n# Yours\n\n## Questions for you\n\n**Color?** (@fake)\n\n- [ ] Blue\n\n## Ask · 2026-11-20 07:00\n\nDraw\n\n## [ ] Sketch · @you\n`);
  await service.act(project, "yours-only", "answer", { questionRev:F.parseLine(service.readDoc(project, "yours-only")).questionRev, question:"Color?", answer:"Blue" });
  assert.equal(F.parseLine(service.readDoc(project, "yours-only")).status, "waiting");
});

test("P2-2 & P2-4: dropUnsent/sendUnsent preserve ready on branch ahead, and hasPendingWork checks lanes & startingWorks", async t => {
  const root = makeRoot(t);
  const script = makeFakeAgentScript(root);
  const directory = path.join(root, "state"), docs = path.join(root, "docs"), code = path.join(root, "code");
  fs.mkdirSync(directory, { recursive:true }); fs.mkdirSync(code, { recursive:true });
  const git = (...args) => execFileSync("git", args, { cwd:code, env:{ ...process.env, GIT_AUTHOR_NAME:"Test", GIT_AUTHOR_EMAIL:"t@example.com", GIT_COMMITTER_NAME:"Test", GIT_COMMITTER_EMAIL:"t@example.com" } });
  git("init", "-b", "main");
  fs.writeFileSync(path.join(code, "a.txt"), "base\n");
  git("add", "."); git("commit", "-m", "init");
  git("checkout", "-b", "feat/work");
  fs.writeFileSync(path.join(code, "a.txt"), "changed\n");
  git("add", "."); git("commit", "-m", "feat commit");
  git("checkout", "main");

  const service = new Service({ directory, agents:fakeAgents(script), autoWatch:false });
  t.after(() => service.close());
  const project = service.store.create({ name:"P2", docsPath:docs, codePath:code });
  project.follow = false; project.autoWake = false; service.store.save();

  // P2-2: dropUnsent on branch ahead of main restores 'ready' instead of 'done'
  service.writeDoc(project, "ahead-drop", F.initialLine({
    title:"Ahead", status:"waiting", branch:"feat/work", base:"main",
    steps:[
      F.askStep({ words:"First" }), { ...F.workStep({ who:"fake" }), done:true, took:"1 min" },
      F.askStep({ words:"Draft follow-up", via:F.NOT_SENT }),
    ],
  }));
  service.writeDoc(project, "ahead-drop", F.setFront(service.readDoc(project, "ahead-drop"), { why:F.NOT_SENT }));
  await service.act(project, "ahead-drop", "drop-unsent", { step:"ask-2" });
  assert.equal(F.parseLine(service.readDoc(project, "ahead-drop")).status, "ready");

  // P2-2: sendUnsent with autoWake=false on branch ahead preserves 'ready'
  service.writeDoc(project, "ahead-send", F.initialLine({
    title:"Ahead Send", status:"waiting", branch:"feat/work", base:"main",
    steps:[
      F.askStep({ words:"First" }), { ...F.workStep({ who:"fake" }), done:true, took:"1 min" },
      F.askStep({ words:"Queued follow-up", via:F.NOT_SENT }),
    ],
  }));
  service.writeDoc(project, "ahead-send", F.setFront(service.readDoc(project, "ahead-send"), { why:F.NOT_SENT }));
  await service.act(project, "ahead-send", "run-unsent", { step:"ask-2", agent:"fake" });
  assert.equal(F.parseLine(service.readDoc(project, "ahead-send")).status, "ready");

  // P2-4: finishUnsent does NOT settle to done while a parallel lane or startingWorks is active
  service.writeDoc(project, "lane-pending", F.initialLine({
    title:"Lane Pending", status:"working",
    steps:[
      F.askStep({ words:"First" }), { ...F.workStep({ who:"fake" }), done:true, took:"1 min" },
      F.askStep({ words:"Done elsewhere", via:F.NOT_SENT }),
    ],
  }));
  const key = service.key(project, "lane-pending");
  service.lanes.set(key, new Map([["work-99", { stepId:"work-99", agent:"other", lane:true }]]));
  await service.act(project, "lane-pending", "finish-unsent", { step:"ask-2" });
  assert.equal(F.parseLine(service.readDoc(project, "lane-pending")).status, "working", "active parallel lane prevents premature done");
  service.lanes.delete(key);
});

// ==================== Review Regression Tests (PE-798 Work 2) ====================

test("R1 (P0): keeper launch persists keepDir before spawn and never launches twice across crash boundaries", async t => {
  const root = makeRoot(t, "r1-keeper-");
  const startsFile = path.join(root, "starts.log");
  const counterScript = path.join(root, "counting-agent.js");
  fs.writeFileSync(counterScript, `
    const fs = require("node:fs");
    let input = "";
    process.stdin.on("data", d => { input += d; });
    process.stdin.on("end", () => {
      fs.appendFileSync(${JSON.stringify(startsFile)}, JSON.stringify({ pid:process.pid, input:input.slice(0, 120) }) + "\\n");
      const delay = input.includes("delay:short") ? 350 : 20;
      setTimeout(() => {
        console.log(JSON.stringify({ type:"result", is_error:false, result:"Counted done." }));
        process.exit(0);
      }, delay);
    });
  `);
  const directory = path.join(root, "state"), docs = path.join(root, "docs");
  fs.mkdirSync(directory, { recursive:true });
  const service = new Service({ directory, agents:fakeAgents(counterScript), autoWatch:false });
  t.after(() => service.close());
  const project = service.store.create({ name:"R1", docsPath:docs });
  project.follow = false; service.store.save();

  // 1) Observe active-runs.json at the EXACT moment agentSpawn is invoked: keepDir + run.json MUST already be persisted!
  let activeAtSpawn = null, runJsonAtSpawn = false;
  const origSpawn = service.agentSpawn.bind(service);
  service.agentSpawn = (...args) => {
    activeAtSpawn = JSON.parse(fs.readFileSync(service.activeFile, "utf8"));
    const keepDir = activeAtSpawn.find(e => e.keep)?.keep;
    runJsonAtSpawn = Boolean(keepDir && fs.existsSync(path.join(keepDir, "run.json")));
    return origSpawn(...args);
  };
  const { slug } = await service.createTopic(project, { text:"delay:short Single run only", agent:"fake" });
  assert.ok(activeAtSpawn?.some(e => e.keep && e.stepId === "work-1"), "active-runs.json contains keepDir BEFORE keeper spawns");
  assert.equal(runJsonAtSpawn, true, "run.json exists inside keepDir BEFORE keeper spawns");

  // Simulate abrupt crash right after spawn (BEFORE work completes, and even if active-runs.json missed keepDir!):
  const run = service.runs.get(service.key(project, slug));
  assert.ok(run?.child?.kept);
  // Corrupt active-runs.json back to pre-keep reservation to also exercise discoverUnindexedKeepers()!
  fs.writeFileSync(service.activeFile, JSON.stringify([{ key:service.key(project, slug), stepId:"work-1", agent:"fake", pid:0 }]));
  run.child.detach();
  service.close();

  const restarted = new Service({ directory, agents:fakeAgents(counterScript), autoWatch:false, recoverOnStart:true, carryOn:true });
  t.after(() => restarted.close());
  await until(() => F.parseLine(restarted.readDoc(project, slug)).status === "done", "reattached work finishes");
  const startCount = fs.readFileSync(startsFile, "utf8").trim().split("\n").filter(Boolean).length;
  assert.equal(startCount, 1, "original live keeper must execute ONCE (zero duplicate launch)");
  restarted.close();

  // 2) Fault injection: crash after allocating keepDir + run.json BEFORE spec.json/spawn -> restart launches ONCE!
  fs.rmSync(startsFile, { force:true });
  const dir2 = path.join(root, "state-pre-spawn"), docs2 = path.join(root, "docs-pre-spawn");
  fs.mkdirSync(dir2, { recursive:true });
  const s2 = new Service({ directory:dir2, agents:fakeAgents(counterScript), autoWatch:false });
  const p2 = s2.store.create({ name:"R1-Pre", docsPath:docs2 });
  p2.follow = false; s2.store.save();
  s2.writeDoc(p2, "pre-spawn", F.initialLine({ title:"Pre Spawn", status:"working", steps:[F.askStep({ words:"Run once" }), F.workStep({ who:"fake" })] }));
  const emptyKeep = s2.keeper.allocate("pre-spawn-work-1");
  fs.writeFileSync(path.join(emptyKeep, "run.json"), JSON.stringify({ projectId:p2.id, slug:"pre-spawn", mode:{ protocol:"plain" }, offsets:{ out:0, err:0 }, fields:{ stepId:"work-1", agent:"fake" } }));
  fs.writeFileSync(path.join(dir2, "active-runs.json"), JSON.stringify([{ key:s2.key(p2, "pre-spawn"), stepId:"work-1", agent:"fake", pid:0, keep:emptyKeep }]));
  s2.close();

  const r2 = new Service({ directory:dir2, agents:fakeAgents(counterScript), autoWatch:false, recoverOnStart:true, carryOn:true });
  t.after(() => r2.close());
  await until(() => F.parseLine(r2.readDoc(p2, "pre-spawn")).status === "done", "pre-spawn work recovered and finished");
  assert.equal(fs.existsSync(emptyKeep), false, "unused pre-spawn keepDir cleaned up");
  assert.equal(fs.readFileSync(startsFile, "utf8").trim().split("\n").filter(Boolean).length, 1, "pre-spawn crash runs exactly ONCE");
});

test("R8: shutdown during preflight or HTTP body read is never recorded as 'Stopped by you' and successor owns continuation", async t => {
  const root = makeRoot(t, "r8-shutdown-");
  const directory = path.join(root, "state"), docs = path.join(root, "docs");
  fs.mkdirSync(directory, { recursive:true });
  const agents = fakeAgents(makeFakeAgentScript(root));
  let releasePreflight;
  agents.creditsRefusal = () => new Promise(resolve => { releasePreflight = () => resolve(null); });

  const service = new Service({ directory, agents, autoWatch:false });
  const project = service.store.create({ name:"R8", docsPath:docs });
  project.follow = false; service.store.save();
  service.writeDoc(project, "preflight-line", F.initialLine({ title:"Preflight", status:"working", steps:[F.askStep({ words:"Do work" }), F.workStep({ who:"fake" })] }));

  const launching = service.next(project, "preflight-line");
  await until(() => typeof releasePreflight === "function", "preflight pending");
  // Simulate SIGINT/SIGTERM calling close() while preflight is pending.
  service.close();
  releasePreflight();
  await launching;

  const afterClose = F.parseLine(fs.readFileSync(path.join(docs, "lines", "preflight-line.md"), "utf8"));
  assert.notEqual(afterClose.front.why, "Stopped by you", "shutdown must NEVER record 'Stopped by you'");
  assert.equal(afterClose.steps.find(s => s.id === "work-1").done, false, "open Work stays recoverable for successor");

  // Successor takes over and finishes cleanly.
  const successor = new Service({ directory, agents:fakeAgents(makeFakeAgentScript(root)), autoWatch:false, recoverOnStart:true, carryOn:true });
  t.after(() => successor.close());
  await until(() => F.parseLine(successor.readDoc(project, "preflight-line")).status === "done", "successor finishes work");

  // HTTP body read interrupted by close() must reject 503 CLOSING and never mutate the Line.
  const dirHttp = path.join(root, "state-http"), docsHttp = path.join(root, "docs-http");
  fs.mkdirSync(dirHttp, { recursive:true });
  let releaseBody;
  const responses = [];
  const pl = createProjectLines({
    directory:dirHttp,
    agents:fakeAgents(makeFakeAgentScript(root)),
    authorizeRead:() => null, authorizeWrite:() => null,
    readJson:() => new Promise(resolve => { releaseBody = () => resolve({ title:"Hijacked" }); }),
    send:(_res, status, body) => responses.push({ status, body }),
    serviceOptions:{ autoWatch:false, recoverOnStart:true },
  });
  const pHttp = pl.service.store.create({ name:"R8-HTTP", docsPath:docsHttp });
  pl.service.writeDoc(pHttp, "one", F.initialLine({ title:"Original", status:"done", steps:[F.askStep({ words:"Hi" })] }));
  const req = { method:"POST", headers:{} }, res = { headersSent:false, writableEnded:false, on() {} };
  const handling = pl.handle(req, res, new URL(`http://127.0.0.1/api/lines/projects/${pHttp.id}/topics/one/rename`));
  await until(() => typeof releaseBody === "function", "body reading");
  pl.close();
  releaseBody();
  await handling;
  assert.equal(responses[0].status, 503);
  assert.equal(responses[0].body.code, "CLOSING");
  assert.equal(F.parseLine(fs.readFileSync(path.join(docsHttp, "lines", "one.md"), "utf8")).title, "Original");
});

test("R9: live orphan recognized via pid.json is active in Line state, blocks Retry/delete, fails Stop if unkillable, and stops cleanly when killed", async t => {
  const root = makeRoot(t, "r9-orphan-");
  const directory = path.join(root, "state"), docs = path.join(root, "docs");
  fs.mkdirSync(directory, { recursive:true });
  const sleeper = require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { detached:true, stdio:"ignore" });
  t.after(() => { try { process.kill(sleeper.pid, "SIGKILL"); } catch {} });

  const s0 = new Service({ directory, agents:fakeAgents(makeFakeAgentScript(root)), autoWatch:false });
  const project = s0.store.create({ name:"R9", docsPath:docs });
  project.follow = false; s0.store.save();
  s0.writeDoc(project, "orphan", F.initialLine({ title:"Orphan", status:"working", steps:[F.askStep({ words:"Keep" }), F.workStep({ who:"fake" })] }));
  const keepDir = path.join(directory, "keep", "orphan-live");
  fs.mkdirSync(keepDir, { recursive:true });
  fs.writeFileSync(path.join(keepDir, "pid.json"), JSON.stringify({ keeper:0, agent:sleeper.pid, command:process.execPath, at:Date.now() }));
  fs.writeFileSync(path.join(directory, "active-runs.json"), JSON.stringify([{ key:s0.key(project, "orphan"), stepId:"work-1", agent:"fake", pid:0, started:Date.now(), keep:keepDir }]));
  s0.close();

  const s1 = new Service({ directory, agents:fakeAgents(makeFakeAgentScript(root)), autoWatch:false, recoverOnStart:true, carryOn:true });
  t.after(() => s1.close());
  const view = s1.stateOf(project).lines.find(l => l.id === "orphan");
  assert.equal(view.running, true, "live orphan is shown as running");
  assert.equal(view.stations.find(s => s.id === "work-1").state, "active");
  await assert.rejects(s1.act(project, "orphan", "retry"), { code:"BUSY" });
  await assert.rejects(s1.act(project, "orphan", "delete", { confirm:"orphan" }), { code:"BUSY" });

  // Stop terminates the live orphan process and clears leftRunning, after which Retry succeeds.
  await s1.act(project, "orphan", "stop");
  assert.equal(s1.orphansOf(project, "orphan").length, 0, "orphan terminated and cleared");
  assert.equal(F.parseLine(s1.readDoc(project, "orphan")).status, "stopped");
  await until(() => { try { process.kill(sleeper.pid, 0); return false; } catch { return true; } }, "orphan OS process reaped after Stop", 2000);

  await s1.act(project, "orphan", "retry");
  await until(() => F.parseLine(s1.readDoc(project, "orphan")).status === "done", "retry succeeds after orphan stopped");
});

test("R11 & R24: Carry on, manual Retry, and waiting add-task send exact authoritative requests, attachments, presets and kinds", async t => {
  const root = makeRoot(t, "r11-prompts-");
  const promptsLog = path.join(root, "prompts.jsonl");
  const capturingScript = path.join(root, "capture-agent.js");
  fs.writeFileSync(capturingScript, `
    const fs = require("node:fs");
    let input = "";
    process.stdin.on("data", d => { input += d; });
    process.stdin.on("end", () => {
      fs.appendFileSync(${JSON.stringify(promptsLog)}, JSON.stringify({ line:process.env.PENECHO_LINE, prompt:input }) + "\\n");
      if (input.includes("mode:slow-stop")) { setTimeout(() => process.exit(0), 30000); return; }
      console.log(JSON.stringify({ type:"result", is_error:false, result:"Done capturing." }));
      process.exit(0);
    });
  `);
  const directory = path.join(root, "state"), docs = path.join(root, "docs");
  fs.mkdirSync(directory, { recursive:true });
  const agents = fakeAgents(capturingScript);
  const service = new Service({ directory, agents, autoWatch:false });
  service.presets = createAgentPresets({ file:path.join(directory, "agent-presets.json"), agents });
  const fakePreset = service.presets.add({ name:"Fake", agent:"fake" });
  const otherPreset = service.presets.add({ name:"Other", agent:"other" });
  const orchestrator = createOrchestrator({ service, directory });
  t.after(() => service.close());
  const project = service.store.create({ name:"R11", docsPath:docs });
  project.follow = false; service.store.save();

  const readPrompts = slug => fs.readFileSync(promptsLog, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l)).filter(e => e.line === slug).map(e => e.prompt);

  // 1) Carry on with queued Work 2: Work 3 MUST get "First task" + first.txt, Work 2 MUST get "Second queued" + second.txt!
  service.store.writeBytes(project, "files/carry-exact/first.txt", Buffer.from("one"));
  service.store.writeBytes(project, "files/carry-exact/second.txt", Buffer.from("two"));
  service.writeDoc(project, "carry-exact", F.initialLine({
    title:"Carry Exact", status:"stopped", why:"Work 1 failed",
    steps:[
      F.askStep({ words:"First task", refs:["[first.txt](../files/carry-exact/first.txt)"] }), F.workStep({ who:"fake" }),
      F.askStep({ words:"Second queued", refs:["[second.txt](../files/carry-exact/second.txt)"] }), F.workStep({ who:"other" }),
    ],
  }));
  await service.act(project, "carry-exact", "carry-on", { preset:otherPreset.id, step:"work-1" });
  await until(() => F.parseLine(service.readDoc(project, "carry-exact")).status === "done", "carry-exact finished");
  const carryPrompts = readPrompts("carry-exact");
  assert.equal(carryPrompts.length, 2);
  assert.match(carryPrompts[0], /<request>\nFirst task/, "replacement Work 3 receives Work 1's exact request");
  assert.match(carryPrompts[0], /first\.txt/, "replacement Work 3 receives Work 1's attachment");
  assert.doesNotMatch(carryPrompts[0], /Second queued/, "replacement Work 3 must NOT steal Work 2's queued request");
  assert.match(carryPrompts[1], /<request>\nSecond queued/, "queued Work 2 receives its own request");
  assert.match(carryPrompts[1], /second\.txt/, "queued Work 2 receives its own attachment");

  // 2) Manual Stop -> Orchestrator Retry: replacement Work 2 gets original request + attachment AND preserves kind!
  service.store.writeBytes(project, "files/manual-retry/spec.txt", Buffer.from("spec"));
  const created = await orchestrator.call(project, { do:"create-line", task:"mode:slow-stop Build feature X\n\n[spec.txt](../files/manual-retry/spec.txt)", agent:fakePreset.id, kind:"code", title:"Manual Retry" });
  await until(() => service.runs.has(service.key(project, created.line)) && fs.existsSync(promptsLog) && readPrompts(created.line).length >= 1, "slow work started and received prompt");
  await orchestrator.call(project, { do:"stop", line:created.line });
  // Remove slow marker so retry finishes quickly while keeping original request text.
  service.writeDoc(project, created.line, service.readDoc(project, created.line).replace("mode:slow-stop ", ""));
  const retried = await orchestrator.call(project, { do:"retry", line:created.line });
  assert.equal(retried.work, "work-2");
  assert.equal(retried.kind, "code", "manual Retry preserves Orchestrator assignment kind");
  await until(() => F.parseLine(service.readDoc(project, created.line)).status === "done", "manual retry finished");
  const retryPrompts = readPrompts(created.line);
  assert.equal(retryPrompts.length, 2);
  assert.match(retryPrompts[1], /Build feature X/, "manual Retry receives original authoritative request");
  assert.doesNotMatch(retryPrompts[1], /Carry on with Work 2 for this task/, "must NOT fall back to generic Carry on placeholder");

  // 3) Waiting add-task: old waiting Work 1 is marked ended (0 extra launches), new Work 2 runs ONCE with "Proceed with A"!
  service.writeDoc(project, "wait-add", `---\nid: PE-111\nstatus: waiting\nwhy: Your answer\nwho: @fake\n---\n\n# Wait Add\n\n## Questions for you\n\n**Pick?** (@fake)\n\n- [ ] A\n\n## Ask · 2026-11-20 07:00\n\nInitial ask\n\n## [ ] Work 1 · @fake · 1 min\n`);
  await orchestrator.call(project, { do:"add-task", line:"wait-add", task:"Proceed with A", agent:fakePreset.id, kind:"code" });
  await until(() => F.parseLine(service.readDoc(project, "wait-add")).status === "done", "wait-add finished");
  const waitDoc = F.parseLine(service.readDoc(project, "wait-add"));
  assert.equal(waitDoc.steps.find(s => s.id === "work-1").off, "ended", "superseded waiting Work 1 given explicit ended disposition");
  const waitPrompts = readPrompts("wait-add");
  assert.equal(waitPrompts.length, 1, "only new Work 2 launched (old waiting Work 1 did NOT re-run)");
  assert.match(waitPrompts[0], /Proceed with A/);
  assert.doesNotMatch(waitPrompts[0], /<request>[\s\S]*Initial ask[\s\S]*<\/request>/);

  // 4) R24: wait() surfaces waiting why (e.g. "Out of credits") even when there are no questions.
  service.writeDoc(project, "credits-wait", F.setFront(F.initialLine({ title:"Credits", status:"waiting", steps:[F.askStep({ words:"Held", via:F.NOT_SENT })] }), { why:"Out of credits" }));
  const waitedCredits = await orchestrator.call(project, { do:"wait", lines:["credits-wait"], seconds:2 });
  assert.equal(waitedCredits.done, true);
  assert.equal(waitedCredits.lines[0].status, "waiting");
  assert.equal(waitedCredits.lines[0].why, "Out of credits");
});

test("R12: Discard while a sibling lane runs restores working and drains queued Work when autoWake is on (or settles to not-started when off)", async t => {
  const root = makeRoot(t, "r12-discard-");
  const script = makeFakeAgentScript(root);
  const directory = path.join(root, "state"), docs = path.join(root, "docs");
  fs.mkdirSync(directory, { recursive:true });
  const service = new Service({ directory, agents:fakeAgents(script), autoWatch:false });
  t.after(() => service.close());
  const project = service.store.create({ name:"R12", docsPath:docs });
  project.follow = false; project.autoWake = true; service.store.save();

  for (const autoWake of [true, false]) {
    project.autoWake = autoWake; service.store.save();
    const slug = autoWake ? "sib-on" : "sib-off";
    service.writeDoc(project, slug, F.initialLine({
      title:slug, status:"stopped", why:"Work 1 failed",
      steps:[
        F.askStep({ words:"One" }), F.workStep({ who:"fake" }),
        F.askStep({ words:"mode:slow Sibling" }), F.workStep({ who:"other" }),
        F.askStep({ words:"Three queued" }), F.workStep({ who:"fake" }),
      ],
    }));
    // Launch Work 2 as an active parallel lane while Work 1 is stopped.
    const doc = F.parseLine(service.readDoc(project, slug));
    await service.launch(project, slug, doc.steps.find(s => s.id === "work-2"), doc, { lane:true });
    const laneRun = service.lanes.get(service.key(project, slug))?.get("work-2");
    assert.ok(laneRun, "sibling lane is running");

    await service.act(project, slug, "discard", { step:"work-1" });
    assert.equal(F.parseLine(service.readDoc(project, slug)).status, "working", "discard restores working while sibling runs");

    // Finish sibling Work 2 cleanly.
    laneRun.said = "Sibling done.";
    try { laneRun.child?.kill(); } catch {}
    await service.ended(project, slug, laneRun, 0);
    if (autoWake) {
      await until(() => F.parseLine(service.readDoc(project, slug)).status === "done", "queued Work 3 drained");
      assert.equal(F.parseLine(service.readDoc(project, slug)).steps.find(s => s.id === "work-3").done, true);
    } else {
      await until(() => F.parseLine(service.readDoc(project, slug)).status === "not-started", "settles to not-started when autoWake=false");
      assert.equal(F.parseLine(service.readDoc(project, slug)).steps.find(s => s.id === "work-3").done, false);
    }
  }
});

test("R13 & R14: sendUnsent revalidates draft after Git await (never splices -1) and late Stop settlement never overwrites a newer task", async t => {
  const root = makeRoot(t, "r13-r14-");
  const directory = path.join(root, "state"), docs = path.join(root, "docs"), code = path.join(root, "code");
  fs.mkdirSync(directory, { recursive:true }); fs.mkdirSync(code, { recursive:true });
  const git = (...args) => execFileSync("git", args, { cwd:code, env:{ ...process.env, GIT_AUTHOR_NAME:"Test", GIT_AUTHOR_EMAIL:"t@example.com", GIT_COMMITTER_NAME:"Test", GIT_COMMITTER_EMAIL:"t@example.com" } });
  git("init", "-b", "main");
  fs.writeFileSync(path.join(code, "a.txt"), "base\n");
  git("add", "."); git("commit", "-m", "init");
  git("checkout", "-b", "feat/race");
  fs.writeFileSync(path.join(code, "a.txt"), "v2\n");
  git("add", "."); git("commit", "-m", "commit");
  git("checkout", "main");

  const Git = require("../src/server/project-lines/git.js");
  const origAhead = Git.aheadCount;
  t.after(() => { Git.aheadCount = origAhead; });

  const service = new Service({ directory, agents:fakeAgents(makeFakeAgentScript(root)), autoWatch:false });
  t.after(() => service.close());
  const project = service.store.create({ name:"Races", docsPath:docs, codePath:code });
  project.follow = false; project.autoWake = false; service.store.save();

  // R13: remove draft during Git.aheadCount -> sendUnsent throws CONFLICT and completed Work 1 stays intact!
  service.writeDoc(project, "send-race", F.setFront(F.initialLine({
    title:"Send Race", status:"waiting", branch:"feat/race", base:"main",
    steps:[F.askStep({ words:"Done ask" }), { ...F.workStep({ who:"fake" }), done:true, took:"1 min" }, F.askStep({ words:"Draft to delete", via:F.NOT_SENT })],
  }), { why:F.NOT_SENT }));
  let releaseGit = null, blockedOnce = false;
  Git.aheadCount = (...args) => {
    if (!blockedOnce) { blockedOnce = true; return new Promise(resolve => { releaseGit = () => resolve(1); }); }
    return origAhead(...args);
  };
  const sending = service.sendUnsent(project, "send-race", { step:"ask-2", agent:"fake" });
  await until(() => typeof releaseGit === "function", "git pending in sendUnsent");
  // Concurrent second Send on same step immediately conflicts!
  await assert.rejects(service.sendUnsent(project, "send-race", { step:"ask-2", agent:"fake" }), { code:"CONFLICT" });
  // Delete the draft while Git is pending.
  await service.dropUnsent(project, "send-race", { step:"ask-2" });
  releaseGit();
  await assert.rejects(sending, { code:"CONFLICT" });
  const afterSendRace = F.parseLine(service.readDoc(project, "send-race"));
  assert.ok(afterSendRace.steps.find(s => s.id === "work-1"), "completed Work 1 must NOT be deleted by splice(-1, 1)");
  assert.equal(afterSendRace.asks.length, 1, "removed draft was NOT sent");

  // R14: late Stop settlement must NOT overwrite a newer task added during Git.aheadCount!
  service.writeDoc(project, "stop-race", F.initialLine({
    title:"Stop Race", status:"working", branch:"feat/race", base:"main",
    steps:[F.askStep({ words:"First" }), F.workStep({ who:"fake" })],
  }));
  releaseGit = null; blockedOnce = false;
  Git.aheadCount = (...args) => {
    if (!blockedOnce) { blockedOnce = true; return new Promise(resolve => { releaseGit = () => resolve(0); }); }
    return origAhead(...args);
  };
  const stopping = service.stopWork(project, "stop-race");
  await until(() => typeof releaseGit === "function", "git pending in settleAfterStop");
  // Service admission rejects a new task until Stop releases the Line.
  // A separate writer can still add work while Git is pending.
  project.autoWake = true;
  await assert.rejects(service.addAgentTask(project, "stop-race", { text:"Must not be admitted", agent:"fake" }), { code:"BUSY" });
  assert.doesNotMatch(service.readDoc(project, "stop-race"), /Must not be admitted/);
  const external = F.updateSteps(service.readDoc(project, "stop-race"), steps => steps.push(F.askStep({ words:"External task" }), F.workStep({ who:"fake" })));
  service.writeDoc(project, "stop-race", F.setFront(external, { status:"working", why:null }));
  releaseGit();
  await stopping;
  Git.aheadCount = origAhead;
  const afterStopRace = F.parseLine(service.readDoc(project, "stop-race"));
  assert.equal(afterStopRace.status, "working", "late Stop settlement must NOT overwrite newer working task");
  assert.ok(afterStopRace.steps.some(s => !s.done), "newer open Work preserved");
  await service.stopWork(project, "stop-race").catch(() => {});
});

test("R15: unrelated draft Ask does not strand answering a custom question, while credit/sketch holds stay held", async t => {
  const root = makeRoot(t, "r15-draft-q-");
  const directory = path.join(root, "state"), docs = path.join(root, "docs");
  fs.mkdirSync(directory, { recursive:true });
  const service = new Service({ directory, agents:fakeAgents(makeFakeAgentScript(root)), autoWatch:false });
  t.after(() => service.close());
  const project = service.store.create({ name:"R15", docsPath:docs });
  project.follow = false; service.store.save();

  service.writeDoc(project, "q-plus-draft", `---\nid: PE-15\nstatus: waiting\nwhy: Needs confirmation\nwho: @fake\n---\n\n# Q Draft\n\n## Questions for you\n\n**Proceed?** (@fake)\n\n- [ ] Yes\n- [ ] No\n\n## Ask · 2026-11-20 07:00\n\nDo step 1\n\n## [ ] Work 1 · @fake · 1 min\n`);
  await service.saveUnsent(project, { topic:"q-plus-draft", text:"Unrelated draft note" });
  await service.act(project, "q-plus-draft", "answer", { questionRev:F.parseLine(service.readDoc(project, "q-plus-draft")).questionRev, question:"Proceed?", answer:"Yes" });
  await until(() => F.parseLine(service.readDoc(project, "q-plus-draft")).status === "done", "answered Work resumed despite unrelated draft");
  const doc = F.parseLine(service.readDoc(project, "q-plus-draft"));
  assert.ok(doc.steps.some(F.isUnsent), "unrelated draft preserved as Not sent");
});

test("R16 & R27: takeover reloads passes/projects/presets created after standby started, and private files are 0600 before rename", async t => {
  const root = makeRoot(t, "r16-r27-");
  const directory = path.join(root, "state"), docs1 = path.join(root, "docs1"), docs2 = path.join(root, "docs2");
  fs.mkdirSync(directory, { recursive:true });

  // R27: verify temporary file permissions under permissive umask 0o000 BEFORE rename!
  if (process.platform !== "win32") {
    const prevUmask = process.umask(0o000);
    const origRename = fs.renameSync;
    const tempModes = [];
    try {
      fs.renameSync = (from, to) => {
        if (String(to).endsWith("passes.json") || String(to).endsWith("endpoint.json")) {
          tempModes.push({ file:path.basename(to), mode:fs.statSync(from).mode & 0o777 });
        }
        return origRename(from, to);
      };
      const dirPerm = path.join(root, "perm-state");
      const sPerm = new Service({ directory:dirPerm, agents:fakeAgents(makeFakeAgentScript(root)), autoWatch:false });
      const oPerm = createOrchestrator({ service:sPerm, directory:dirPerm });
      oPerm.setBase("http://127.0.0.1:4200/api/lines/orchestrate");
      const pPerm = sPerm.store.create({ name:"Perm", docsPath:path.join(root, "perm-docs") });
      oPerm.announce(4200);
      oPerm.env(pPerm, "orch-1", { front:{ orchestrator:"yes" } });
      sPerm.close();
      assert.ok(tempModes.length >= 2, "captured temp modes for endpoint.json and passes.json");
      for (const m of tempModes) assert.equal(m.mode, 0o600, `temp file for ${m.file} must be 0600 before rename under umask 000`);
      assert.equal(fs.statSync(path.join(dirPerm, "orchestrator")).mode & 0o777, 0o700, "orchestrator dir is 0700");
    } finally {
      fs.renameSync = origRename;
      process.umask(prevUmask);
    }
  }

  // R16: standby starts BEFORE new project & coordinator pass are created on owner; after takeover, original pass works!
  const responses = [];
  const makePl = () => createProjectLines({
    directory,
    agents:fakeAgents(makeFakeAgentScript(root)),
    authorizeRead:() => null, authorizeWrite:() => null,
    readJson:async () => ({ do:"overview" }),
    send:(_res, status, body) => responses.push({ status, body }),
    serviceOptions:{ autoWatch:false, recoverOnStart:true },
  });
  const owner = makePl();
  owner.service.store.create({ name:"First", docsPath:docs1 });
  const standby = makePl();
  t.after(() => { standby.close(); owner.close(); });
  assert.ok(standby.service.runtimeBusy && !standby.service.releaseRuntime);

  // Create a SECOND project + coordinator pass on owner AFTER standby already started!
  const p2 = owner.service.store.create({ name:"Created After Standby", docsPath:docs2 });
  owner.service.writeDoc(p2, "coord", F.setFront(F.initialLine({ title:"Coord", status:"working", steps:[F.askStep({ words:"Run" })] }), { orchestrator:"yes" }));
  owner.orchestrator.setBase("http://127.0.0.1:4300/api/lines/orchestrate");
  const pass = owner.orchestrator.env(p2, "coord", F.parseLine(owner.service.readDoc(p2, "coord"))).PENECHO_ORCH_PASS;

  // Owner closes; standby takes over!
  owner.close();
  standby.service.startRuntime({ autoWatch:false, recoverOnStart:true });
  standby.service.runtimeBusy = null;
  standby.orchestrator.announce(4301);

  const req = { method:"POST", headers:{ "x-penecho-pass":pass } }, res = { headersSent:false, writableEnded:false, on() {} };
  await standby.handle(req, res, new URL("http://127.0.0.1/api/lines/orchestrate"));
  assert.equal(responses[0].status, 200, "surviving coordinator pass works immediately after takeover");
  assert.equal(responses[0].body.project, "Created After Standby", "new project created after standby startup is loaded on takeover");
});

test("R17 (external helper): orch-call.js authenticates endpoint.json via /identity before sending pass and rotates past standby 409", async t => {
  const http = require("node:http");
  const { HELPER_PATH, expectedOrchProof } = require("../src/server/project-lines/orch-call.js");
  const root = makeRoot(t, "r17-helper-");
  const tok = "helper-orch-tok", inst = "helper-orch-inst";
  const standbyPasses = [];

  const owner = http.createServer((req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    if (req.method === "GET" && u.pathname === "/api/lines/orchestrate/identity") {
      const nonce = u.searchParams.get("nonce") || "";
      res.writeHead(200, { "content-type":"application/json" });
      return res.end(JSON.stringify({ ok:true, instanceId:inst, port:owner.address().port, opDedup:true, proof:expectedOrchProof(tok, nonce, owner.address().port, inst) }));
    }
    let body = ""; req.on("data", c => { body += c; });
    req.on("end", () => {
      res.writeHead(200, { "content-type":"application/json" });
      res.end(JSON.stringify({ ok:true, pass:req.headers["x-penecho-pass"], received:JSON.parse(body) }));
    });
  });
  await new Promise(r => owner.listen(0, "127.0.0.1", r));
  t.after(() => owner.close());

  const ep = path.join(root, "endpoint.json");
  const standby = http.createServer((req, res) => {
    if (req.headers["x-penecho-pass"]) standbyPasses.push(req.headers["x-penecho-pass"]);
    req.resume();
    fs.writeFileSync(ep, JSON.stringify({ url:`http://127.0.0.1:${owner.address().port}/api/lines/orchestrate`, port:owner.address().port, instanceId:inst, orchToken:tok }));
    res.writeHead(409, { "content-type":"application/json" });
    res.end(JSON.stringify({ error:"Busy", code:"RUNTIME_BUSY", owner:{ port:owner.address().port } }));
  });
  await new Promise(r => standby.listen(0, "127.0.0.1", r));
  t.after(() => standby.close());

  fs.writeFileSync(ep, JSON.stringify({ url:`http://127.0.0.1:${standby.address().port}/api/lines/orchestrate`, port:standby.address().port, instanceId:"standby-inst", orchToken:"standby-tok" }));

  const out = await new Promise((resolve, reject) => {
    execFile(process.execPath, [HELPER_PATH, '{"do":"help"}'], {
      encoding:"utf8",
      env:{
        ...process.env,
        PENECHO_ORCH_URL:`http://127.0.0.1:${standby.address().port}/api/lines/orchestrate`,
        PENECHO_ORCH_PASS:"helper-pass-xyz",
        PENECHO_ORCH_ENDPOINT:ep,
      },
    }, (error, stdout, stderr) => error ? reject(new Error(`${error.message}\n${stderr}`)) : resolve(stdout));
  });
  const parsed = JSON.parse(out);
  assert.equal(standbyPasses.length, 0, "pass must NOT be sent to standby before mutual auth succeeds");
  assert.equal(parsed.ok, true);
  assert.equal(parsed.pass, "helper-pass-xyz");
  assert.deepEqual(parsed.received, { do:"help" });
});

test("R18: parent Stop blocks in-flight create-line, stops active children of an idle parent, handles duplicate legacy IDs, and surfaces child-stop failure", async t => {
  const root = makeRoot(t, "r18-parent-stop-");
  const script = makeFakeAgentScript(root);
  const directory = path.join(root, "state"), docs = path.join(root, "docs");
  fs.mkdirSync(directory, { recursive:true });
  const agents = fakeAgents(script);
  const service = new Service({ directory, agents, autoWatch:false });
  service.presets = createAgentPresets({ file:path.join(directory, "agent-presets.json"), agents });
  const fakePreset = service.presets.add({ name:"Fake", agent:"fake" });
  const orchestrator = createOrchestrator({ service, directory });
  t.after(() => service.close());
  const project = service.store.create({ name:"R18", docsPath:docs });
  project.follow = false; service.store.save();

  // 1) In-flight create-line blocked by parent Stop cancellation generation.
  const parent = await orchestrator.start(project, { goal:"mode:slow parent", preset:fakePreset.id });
  await until(() => service.runs.has(service.key(project, parent.line)), "parent running");
  let releaseTrunk;
  const origRefresh = service.refreshTrunk.bind(service);
  service.refreshTrunk = () => new Promise(resolve => { releaseTrunk = () => resolve("main"); });
  const creating = orchestrator.call(project, { do:"create-line", task:"mode:slow late child", agent:fakePreset.id, kind:"code", branch:"new" }, { session:parent.line });
  await until(() => typeof releaseTrunk === "function", "create-line awaiting refreshTrunk");
  await service.act(project, parent.line, "stop");
  releaseTrunk();
  service.refreshTrunk = origRefresh;
  await assert.rejects(creating, { code:"PARENT_STOPPED" });
  assert.equal(service.runs.size, 0, "in-flight child was never spawned after parent Stop");

  // 2) Idle parent with active child -> parent Stop still stops the child!
  service.writeDoc(project, "idle-parent", F.setFront(F.initialLine({ title:"Idle Parent", status:"done", steps:[F.askStep({ words:"Done" }), { ...F.workStep({ who:"fake" }), done:true, took:"1 min" }] }), { id:"PE-501", orchestrator:"yes" }));
  const child = await orchestrator.call(project, { do:"create-line", task:"mode:slow active child", agent:fakePreset.id, kind:"code" }, { session:"idle-parent" });
  await until(() => service.runs.has(service.key(project, child.line)), "child of idle parent running");
  await service.act(project, "idle-parent", "stop");
  assert.equal(service.runs.size, 0, "active child stopped even when parent was already done");
  assert.equal(F.parseLine(service.readDoc(project, child.line)).status, "stopped");

  // 3) Duplicate legacy display PE ID: stopping parent A does NOT touch parent B's legacy child!
  service.writeDoc(project, "dup-a", F.setFront(F.initialLine({ title:"Dup A", status:"working", steps:[F.askStep({ words:"A" }), F.workStep({ who:"fake" })] }), { id:"PE-DUP", orchestrator:"yes" }));
  service.writeDoc(project, "dup-b", F.setFront(F.initialLine({ title:"Dup B", status:"done", steps:[F.askStep({ words:"B" })] }), { id:"PE-DUP", orchestrator:"yes" }));
  service.writeDoc(project, "legacy-b-child", F.setFront(F.initialLine({ title:"Legacy B Child", status:"working", steps:[F.askStep({ words:"Keep" }), F.workStep({ who:"fake" })] }), { "orchestrated by":"PE-DUP" }));
  await service.act(project, "dup-a", "stop");
  assert.equal(F.parseLine(service.readDoc(project, "legacy-b-child")).status, "working", "ambiguous duplicate PE ID must NOT be stopped");
});

test("R19: unified legacy paused normalization across parseLine, upgradeTopic, and reopen preserves Start/Answer/Merge", async t => {
  const { upgradeTopic } = require("../src/server/project-lines/upgrade.js");
  const root = makeRoot(t, "r19-legacy-");
  const directory = path.join(root, "state"), docs = path.join(root, "docs");
  fs.mkdirSync(directory, { recursive:true });
  const service = new Service({ directory, agents:fakeAgents(makeFakeAgentScript(root)), autoWatch:false });
  t.after(() => service.close());
  const project = service.store.create({ name:"R19", docsPath:docs });
  project.follow = false; service.store.save();

  // 1) Sent Ask awaiting its first Work (wantsWork, 0 open checkboxes) + paused + "Not started. Resume..." -> not-started (NOT done!)
  const awaitingStartMd = "---\nid: PE-19\nstatus: paused\nwhy: Not started. Resume to give it to an agent.\nwho: @fake\n---\n\n# Awaiting\n\n## Ask · 2026-11-20 07:00\n\nDo first work\n";
  const parsed = F.parseLine(awaitingStartMd);
  assert.equal(parsed.status, "not-started", "wantsWork legacy paused must be not-started, never done");
  assert.doesNotMatch(parsed.front.why || "", /Resume/i, "obsolete Resume wording normalized");
  service.writeDoc(project, "legacy-await", awaitingStartMd);
  await service.act(project, "legacy-await", "start");
  await until(() => F.parseLine(service.readDoc(project, "legacy-await")).status === "done", "Start runs legacy wantsWork Line");

  // 2) Legacy paused with human step Sketch -> waiting; with merge into -> ready
  assert.equal(F.parseLine("---\nstatus: paused\n---\n\n# Sk\n\n## Ask\n\nDraw\n\n## [ ] Sketch · @you\n").status, "waiting");
  assert.equal(F.parseLine("---\nstatus: paused\nmerge into: main\n---\n\n# Mg\n\n## Ask\n\nCode\n\n## [x] Work 1 · @fake · 1 min\n").status, "ready");

  // 3) V1 upgrade with paused + outstanding ## Questions for you -> waiting (NOT done!)
  const upgraded = upgradeTopic({
    slug:"v1-q",
    topicMd:"---\ntopic: V1 Question\n---\n\n# V1 Question\n\n## What I asked for\n\nPick a color\n",
    tasksMd:"---\nstatus: paused\nwho: @fake\n---\n\n## Questions for you\n\n**Color?** (@fake)\n\n- [ ] Red\n- [ ] Blue\n\n## Steps\n\n- [x] **Work** (@fake, 1 min): Asked\n",
    rows:[],
  });
  const upgradedDoc = F.parseLine(upgraded.md);
  assert.equal(upgradedDoc.status, "waiting", "V1 paused fixture with question upgrades to waiting, never done");
  assert.equal(upgradedDoc.questions.length, 1);

  // 4) Reopen archived before-archive: paused with wantsWork -> not-started
  service.writeDoc(project, "arch-paused", "---\nid: PE-20\nstatus: closed\nbefore archive: paused\nwhy before archive: Not started. Resume to give it to an agent.\n---\n\n# Archived\n\n## Ask · 2026-11-20 07:00\n\nRun later\n");
  await service.act(project, "arch-paused", "reopen");
  assert.equal(F.parseLine(service.readDoc(project, "arch-paused")).status, "not-started");
});

test("R20 & R21: watchdog protects coordinator with active delegated sublines after wait disconnect, and lost parallel lane recovers/retries", async t => {
  const root = makeRoot(t, "r20-r21-");
  const script = makeFakeAgentScript(root);
  const directory = path.join(root, "state"), docs = path.join(root, "docs");
  fs.mkdirSync(directory, { recursive:true });
  const agents = fakeAgents(script);
  const service = new Service({ directory, agents, autoWatch:false });
  service.presets = createAgentPresets({ file:path.join(directory, "agent-presets.json"), agents });
  const fakePreset = service.presets.add({ name:"Fake", agent:"fake" });
  const otherPreset = service.presets.add({ name:"Other", agent:"other" });
  const orchestrator = service.orchestrator = createOrchestrator({ service, directory });
  t.after(() => service.close());
  const project = service.store.create({ name:"R20-R21", docsPath:docs });
  project.follow = false; service.store.save();

  // R20: Orchestrator running Claude with NO open wait HTTP request, interim assistant message, and active delegated subline!
  const coord = await orchestrator.start(project, { goal:"mode:slow coordinate", preset:fakePreset.id });
  await until(() => service.runs.has(service.key(project, coord.line)), "coord running");
  const sub = await orchestrator.call(project, { do:"create-line", task:"mode:slow delegated", agent:otherPreset.id, kind:"code" }, { session:coord.line });
  await until(() => service.runs.has(service.key(project, sub.line)), "sub running");

  const coordRun = service.runs.get(service.key(project, coord.line));
  coordRun.agent = "claude";
  const t0 = coordRun.started;
  const killed = [];
  service.processTable = async () => [{ pid:coordRun.child.pid, ppid:1, cpu:0 }];
  service.finishedTurn = () => ({ answer:"Waiting on delegated subline to finish..." });
  service.stopTree = async child => { killed.push(child.pid); };
  assert.equal(orchestrator.isWaiting(project, coord.line), true, "active delegated subline keeps isWaiting true without active HTTP wait");
  await service.watchRuns(t0 + 1000);
  await service.watchRuns(t0 + 40 * 60_000);
  assert.equal(killed.length, 0, "watchdog must NOT kill coordinator while delegated subline is active");
  await service.act(project, coord.line, "stop");

  // R21: Explicit per-lane retry retries a stopped parallel lane beside a running/finished primary!
  const laneLine = await orchestrator.call(project, { do:"create-line", task:"mode:slow primary", agent:fakePreset.id, kind:"code" });
  await until(() => service.runs.has(service.key(project, laneLine.line)), "primary running");
  const failedLane = await orchestrator.call(project, { do:"add-task", line:laneLine.line, task:"mode:fail lane", agent:otherPreset.id, kind:"code", parallel:true });
  await until(() => F.parseLine(service.readDoc(project, laneLine.line)).steps.find(s => s.id === failedLane.work)?.off === "stopped", "lane failed");
  service.writeDoc(project, laneLine.line, service.readDoc(project, laneLine.line).replace("mode:fail lane", "succeed lane now"));
  const retriedLane = await orchestrator.call(project, { do:"retry", line:laneLine.line, work:failedLane.work });
  assert.equal(retriedLane.work, failedLane.work);
  await until(() => {
    const s = F.parseLine(service.readDoc(project, laneLine.line)).steps.find(x => x.id === failedLane.work);
    return s?.done && !s.off;
  }, "retried parallel lane succeeded cleanly");
  await service.act(project, laneLine.line, "stop").catch(() => {});
});

test("R23 & R25: all four draft operations preserve ready on branch ahead, and UI consumers classify stale paused safely", async t => {
  const root = makeRoot(t, "r23-r25-");
  const directory = path.join(root, "state"), docs = path.join(root, "docs"), code = path.join(root, "code");
  fs.mkdirSync(directory, { recursive:true }); fs.mkdirSync(code, { recursive:true });
  const git = (...args) => execFileSync("git", args, { cwd:code, env:{ ...process.env, GIT_AUTHOR_NAME:"Test", GIT_AUTHOR_EMAIL:"t@example.com", GIT_COMMITTER_NAME:"Test", GIT_COMMITTER_EMAIL:"t@example.com" } });
  git("init", "-b", "main");
  fs.writeFileSync(path.join(code, "a.txt"), "base\n");
  git("add", "."); git("commit", "-m", "init");
  git("checkout", "-b", "feat/drafts");
  fs.writeFileSync(path.join(code, "a.txt"), "ahead\n");
  git("add", "."); git("commit", "-m", "ahead commit");
  git("checkout", "main");

  const service = new Service({ directory, agents:fakeAgents(makeFakeAgentScript(root)), autoWatch:false });
  t.after(() => service.close());
  const project = service.store.create({ name:"R23", docsPath:docs, codePath:code });
  project.follow = false; service.store.save();

  const makeAhead = slug => {
    service.writeDoc(project, slug, F.setFront(F.initialLine({
      title:slug, status:"waiting", branch:"feat/drafts", base:"main",
      steps:[F.askStep({ words:"Sole draft", via:F.NOT_SENT })],
    }), { why:F.NOT_SENT }));
  };

  // 1) finishUnsent -> ready
  makeAhead("fin-ahead");
  await service.act(project, "fin-ahead", "finish-unsent", { step:"ask-1" });
  assert.equal(F.parseLine(service.readDoc(project, "fin-ahead")).status, "ready");

  // 2) pickUp after deleting draft directly in Markdown -> ready
  makeAhead("md-ahead");
  service.writeDoc(project, "md-ahead", service.readDoc(project, "md-ahead").replace(/## Ask[\s\S]*$/, ""));
  await service.pickUp(project, "md-ahead");
  assert.equal(F.parseLine(service.readDoc(project, "md-ahead")).status, "ready");

  // 3) dropUnsent on sole draft with branch ahead -> ready (NOT closed!)
  makeAhead("drop-ahead");
  await service.act(project, "drop-ahead", "drop-unsent", { step:"ask-1" });
  assert.equal(F.parseLine(service.readDoc(project, "drop-ahead")).status, "ready");

  // 4) takeUnsent on sole draft with branch ahead -> ready, alone:false (NOT deleted!)
  makeAhead("take-ahead");
  const taken = await service.act(project, "take-ahead", "take-unsent", { step:"ask-1" });
  assert.equal(taken.alone, false);
  assert.equal(service.store.isDeleted(project, "take-ahead"), false);
  assert.equal(F.parseLine(service.readDoc(project, "take-ahead")).status, "ready");

  // R25: Statistics & Orchestrator UI handle stale external `status: "paused"` via shared classifier.
  const STATS = require("../public/lines/stats.js");
  const summary = STATS.computeProjectStats({
    lines:[{ id:"stale-p", status:"paused", stations:[] }],
    landed:[], backlog:[],
  }, { period:"all" });
  assert.equal(summary.lines[0].kind, "stopped", "Statistics classifies stale paused Line as stopped, NOT working");
  assert.equal(summary.breakdown.find(b => b.kind === "stopped")?.count, 1);
  assert.equal(summary.breakdown.find(b => b.kind === "working"), undefined);

  const vm = require("node:vm");
  const ctx = {
    LINE_STATUS,
    navigator:{ platform:"" },
    STATE_TEXT:{ working:'Working', wait:'Needs you', ready:'Ready', landed:'Done', backlog:'Not started', error:'Stopped', notes:'Notes' },
    esc:s => String(s),
    lineById:() => null,
    shownState:() => 'error',
    document:{ addEventListener() {}, querySelector() { return null; }, getElementById() { return null; } },
    window:{ addEventListener() {} },
    ACT:{},
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.resolve("public/lines/composer.js"), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(path.resolve("public/lines/orchestrator.js"), "utf8"), ctx);
  const badge = ctx.orchLineState({}, { line:"unloaded", status:"paused", running:false });
  assert.match(badge, /Stopped/, "Orchestrator renders Stopped label for stale external paused session");
});

test("Stop followed immediately by server restart never resurrects a killed keeper or marks the stopped Line running", async t => {
  const root = makeRoot(t, "stop-restart-");
  const script = makeFakeAgentScript(root);
  const directory = path.join(root, "state"), docs = path.join(root, "docs");
  fs.mkdirSync(directory, { recursive:true });
  const pl1 = createProjectLines({ directory, agents:fakeAgents(script), serviceOptions:{ autoWatch:false } });
  const p1 = pl1.service.store.create({ name:"StopRestart", docsPath:docs });
  p1.follow = false; pl1.service.store.save();
  const created = await pl1.service.createTopic(p1, { text:"mode:slow Stop before restart", agent:"fake", start:true });
  await until(() => pl1.service.runs.has(pl1.service.key(p1, created.slug)), "slow work running");
  await pl1.service.act(p1, created.slug, "stop");
  assert.equal(F.parseLine(pl1.service.readDoc(p1, created.slug)).status, "stopped");
  pl1.close();

  const pl2 = createProjectLines({ directory, agents:fakeAgents(script), serviceOptions:{ autoWatch:false } });
  t.after(() => pl2.close());
  const p2 = pl2.service.store.get(p1.id);
  const st = pl2.service.stateOf(p2).lines.find(l => l.id === created.slug);
  assert.equal(st.status, "stopped");
  assert.equal(st.running, false, "stopped keeper must NOT be resurrected on immediate restart");
  assert.equal(pl2.service.runs.size, 0);
  assert.equal(pl2.service.orphansOf(p2, created.slug).length, 0);
});

test("Round 2 F1 (P0): atomic claim.json fences aged spec-only delayed keeper, absent keeper reconciles, and failed run.json write aborts before spawn", async t => {
  const { spawn } = require("node:child_process");
  const { KeptChild } = require("../src/server/project-lines/kept-child.js");
  const root = makeRoot(t, "r2-f1-claim-");
  const startsFile = path.join(root, "starts.log");
  const countingAgent = path.join(root, "counting-agent.js");
  fs.writeFileSync(countingAgent, `
    const fs = require("node:fs");
    fs.appendFileSync(${JSON.stringify(startsFile)}, process.pid + "\\n");
    process.stdin.resume();
    process.stdin.on("end", () => {
      console.log(JSON.stringify({ type:"result", is_error:false, result:"Counted once." }));
      process.exit(0);
    });
  `);

  // 1) Aged spec.json without pid.json or claim.json: recovery cancels claim, launches once, and releasing the delayed keeper produces ZERO extra agent starts!
  const dir1 = path.join(root, "state-aged"), docs1 = path.join(root, "docs-aged");
  fs.mkdirSync(dir1, { recursive:true });
  const sSeed = new Service({ directory:dir1, agents:fakeAgents(countingAgent), autoWatch:false });
  const pSeed = sSeed.store.create({ name:"AgedSpec", docsPath:docs1 });
  pSeed.follow = false; pSeed.autoWake = true; sSeed.store.save();
  sSeed.writeDoc(pSeed, "spec-race", F.initialLine({ title:"Spec Race", status:"working", steps:[F.askStep({ words:"Run once" }), F.workStep({ who:"fake" })] }));
  const keepDir = path.join(dir1, "keep", "spec-race-work-1-delayed");
  fs.mkdirSync(keepDir, { recursive:true, mode:0o700 });
  fs.writeFileSync(path.join(keepDir, "input"), "Run once");
  fs.writeFileSync(path.join(keepDir, "input-end"), "");
  fs.writeFileSync(path.join(keepDir, "run.json"), JSON.stringify({ projectId:pSeed.id, slug:"spec-race", offsets:{ out:0, err:0 }, fields:{ stepId:"work-1", agent:"fake", session:"fake", workdir:docs1, started:Date.now() - 15000, carried:0, log:path.join(root, "run.log") } }));
  const specFile = path.join(keepDir, "spec.json");
  fs.writeFileSync(specFile, JSON.stringify({ command:process.execPath, args:[countingAgent], cwd:docs1, dropEnv:[] }));
  const elevenSecAgo = new Date(Date.now() - 11_000);
  fs.utimesSync(specFile, elevenSecAgo, elevenSecAgo);
  fs.writeFileSync(path.join(dir1, "active-runs.json"), JSON.stringify([{ key:`${pSeed.id}/spec-race`, stepId:"work-1", agent:"fake", pid:0, started:Date.now() - 15000, keep:keepDir }]));
  sSeed.close();

  const plRec = createProjectLines({ directory:dir1, agents:fakeAgents(countingAgent), serviceOptions:{ autoWatch:false, carryOn:true, recoverOnStart:true } });
  t.after(() => plRec.close());
  const pRec = plRec.service.store.get(pSeed.id);
  await until(() => F.parseLine(plRec.service.readDoc(pRec, "spec-race")).status === "done", "recovery replacement completed");
  assert.equal(JSON.parse(fs.readFileSync(path.join(keepDir, "claim.json"), "utf8")).owner, "cancelled", "recovery fenced aged spec.json via claim.json");

  // Now release the delayed original agent-keeper.js on keepDir: it MUST exit without spawning countingAgent!
  const keeperScript = require.resolve("../src/server/project-lines/agent-keeper.js");
  await new Promise(resolve => {
    const delayed = spawn(process.execPath, [keeperScript, keepDir], { stdio:"ignore" });
    delayed.once("close", resolve);
  });
  const totalStarts = fs.readFileSync(startsFile, "utf8").trim().split("\n").filter(Boolean);
  assert.equal(totalStarts.length, 1, "delayed keeper saw cancelled claim.json and NEVER produced a duplicate agent start");

  // 2) Fresh spec.json with NO keeper process: KeptChild.pump reconciles after unclaimedTimeoutMs instead of hanging forever at PID 0!
  const ghostDir = path.join(root, "ghost-keep");
  fs.mkdirSync(ghostDir, { recursive:true });
  fs.writeFileSync(path.join(ghostDir, "spec.json"), JSON.stringify({ command:process.execPath, args:["-e", ""], cwd:root, dropEnv:[] }));
  const kc = new KeptChild(ghostDir, { unclaimedTimeoutMs:150 });
  const closedCode = await new Promise(resolve => kc.once("close", code => resolve(code)));
  assert.equal(closedCode, 1, "unclaimed spec-only keeper directory reconciles instead of sticking at PID 0");
  assert.equal(JSON.parse(fs.readFileSync(path.join(ghostDir, "claim.json"), "utf8")).owner, "cancelled");

  // 3) Mandatory initial run.json write failure prevents spawning!
  const dirFail = path.join(root, "state-runjson-fail"), docsFail = path.join(root, "docs-runjson-fail");
  fs.mkdirSync(dirFail, { recursive:true });
  let spawnedCount = 0;
  const sFail = new Service({ directory:dirFail, agents:fakeAgents(countingAgent), autoWatch:false });
  t.after(() => sFail.close());
  const origSpawn = sFail.agentSpawn;
  sFail.agentSpawn = (...a) => { spawnedCount++; return origSpawn.apply(sFail, a); };
  const pFail = sFail.store.create({ name:"FailRunJson", docsPath:docsFail });
  pFail.follow = false; sFail.store.save();
  const origKeepNote = sFail.keepNote.bind(sFail);
  sFail.keepNote = (p, sl, run, now, opts) => {
    if (opts?.strict) throw Object.assign(new Error("ENOSPC"), { code:"ENOSPC" });
    return origKeepNote(p, sl, run, now, opts);
  };
  await sFail.createTopic(pFail, { text:"Should not spawn", agent:"fake", start:true });
  assert.equal(spawnedCount, 0, "failed mandatory initial run.json write must abort before spawning");
});

test("Round 2 F2 (P0): Stop waits for slow SIGTERM exit while holding ownership, and interrupted Stop never auto-carries-on after restart", async t => {
  const root = makeRoot(t, "r2-f2-stop-");
  const slowTermScript = path.join(root, "slow-term-agent.js");
  const startsLog = path.join(root, "slow-term-starts.log");
  fs.writeFileSync(slowTermScript, `
    const fs = require("node:fs");
    process.on("SIGTERM", () => { setTimeout(() => process.exit(0), 500); });
    fs.appendFileSync(${JSON.stringify(startsLog)}, process.pid + "\\n");
    process.stdin.resume();
    setTimeout(() => process.exit(0), 30000);
  `);

  const dir = path.join(root, "state"), docs = path.join(root, "docs");
  fs.mkdirSync(dir, { recursive:true });
  const pl = createProjectLines({ directory:dir, agents:fakeAgents(slowTermScript), serviceOptions:{ autoWatch:false } });
  t.after(() => pl.close());
  const p = pl.service.store.create({ name:"SlowStop", docsPath:docs });
  p.follow = false; pl.service.store.save();

  const created = await pl.service.createTopic(p, { text:"Slow SIGTERM job", agent:"fake", start:true });
  await until(() => pl.service.runs.get(pl.service.key(p, created.slug))?.child?.pid && fs.existsSync(startsLog) && fs.readFileSync(startsLog, "utf8").trim().length > 0, "slow-term agent registered SIGTERM handler");
  const firstPid = pl.service.runs.get(pl.service.key(p, created.slug)).child.pid;

  // Kick off Stop (takes ~500ms while agent handles SIGTERM): Retry during that window MUST reject BUSY and NOT spawn a second process!
  const stopping = pl.service.act(p, created.slug, "stop");
  await new Promise(r => setTimeout(r, 80));
  assert.equal(pl.service.heldWorks(p, created.slug).length, 1, "Stop keeps held reservation while agent is still exiting");
  await assert.rejects(pl.service.act(p, created.slug, "retry"), { code:"BUSY" });
  await stopping;
  let stillAlive = true;
  try { process.kill(firstPid, 0); } catch { stillAlive = false; }
  assert.equal(stillAlive, false, "Stop must NOT return until the agent OS process has actually exited");
  assert.equal(fs.readFileSync(startsLog, "utf8").trim().split("\n").filter(Boolean).length, 1);

  // 2) Interrupted Stop (durable kill + exit.json + still-indexed active-runs.json + open working step) with carryOn=true MUST NOT relaunch!
  const dir2 = path.join(root, "state-int-stop"), docs2 = path.join(root, "docs-int-stop");
  fs.mkdirSync(dir2, { recursive:true });
  const s2 = new Service({ directory:dir2, agents:fakeAgents(slowTermScript), autoWatch:false });
  const p2 = s2.store.create({ name:"IntStop", docsPath:docs2 });
  p2.follow = false; p2.autoWake = true; s2.store.save();
  s2.writeDoc(p2, "cancelled-mid-stop", F.initialLine({ title:"Cancelled", status:"working", steps:[F.askStep({ words:"Cancel me" }), F.workStep({ who:"fake" })] }));
  const keep2 = path.join(dir2, "keep", "cancelled-mid-stop-work-1-x");
  fs.mkdirSync(keep2, { recursive:true });
  fs.writeFileSync(path.join(keep2, "kill"), "SIGTERM");
  fs.writeFileSync(path.join(keep2, "exit.json"), JSON.stringify({ code:1, signal:"SIGTERM", at:Date.now() }));
  fs.writeFileSync(path.join(dir2, "active-runs.json"), JSON.stringify([{ key:`${p2.id}/cancelled-mid-stop`, stepId:"work-1", agent:"fake", pid:0, started:Date.now() - 1000, keep:keep2 }]));
  s2.close();

  const beforeCount = fs.readFileSync(startsLog, "utf8").trim().split("\n").filter(Boolean).length;
  const pl2 = createProjectLines({ directory:dir2, agents:fakeAgents(slowTermScript), serviceOptions:{ autoWatch:false, carryOn:true, recoverOnStart:true } });
  t.after(() => pl2.close());
  await pl2.service.carriedOn;
  const p2After = pl2.service.store.get(p2.id);
  const doc2 = F.parseLine(pl2.service.readDoc(p2After, "cancelled-mid-stop"));
  assert.equal(doc2.status, "stopped");
  assert.equal(doc2.front.why, "Stopped by you");
  assert.equal(doc2.steps.find(s => s.id === "work-1").off, "stopped");
  assert.equal(fs.readFileSync(startsLog, "utf8").trim().split("\n").filter(Boolean).length, beforeCount, "cancelled Work must NEVER be relaunched on carryOn recovery");
});

test("Round 2 F3, F10, F11, F12, F13, F14, F15, F17, F18, F19, F20: comprehensive state-machine, ownership, draft-race, takeover and lane regressions", async t => {
  const { spawn } = require("node:child_process");
  const Git = require("../src/server/project-lines/git.js");
  const root = makeRoot(t, "r2-all-");
  const script = makeFakeAgentScript(root);
  const directory = path.join(root, "state"), docs = path.join(root, "docs"), code = path.join(root, "code");
  fs.mkdirSync(directory, { recursive:true }); fs.mkdirSync(code, { recursive:true });
  const git = (...args) => execFileSync("git", args, { cwd:code, env:{ ...process.env, GIT_AUTHOR_NAME:"Test", GIT_AUTHOR_EMAIL:"t@example.com", GIT_COMMITTER_NAME:"Test", GIT_COMMITTER_EMAIL:"t@example.com" } });
  git("init", "-b", "main");
  fs.writeFileSync(path.join(code, "a.txt"), "base\n");
  git("add", "."); git("commit", "-m", "init");
  git("checkout", "-b", "feat/r2");
  fs.writeFileSync(path.join(code, "a.txt"), "v2\n");
  git("add", "."); git("commit", "-m", "v2");
  git("checkout", "main");

  // 1) F3: Post-close finalizer (held in makePictures) and watchdog (held in processTable) must NEVER mutate Line or kill children!
  {
    const d3 = path.join(root, "s-f3"), docs3 = path.join(root, "docs-f3");
    fs.mkdirSync(d3, { recursive:true });
    const s3 = new Service({ directory:d3, agents:fakeAgents(script), autoWatch:false });
    const p3 = s3.store.create({ name:"F3", docsPath:docs3 });
    p3.follow = false; s3.store.save();
    s3.writeDoc(p3, "fin-close", F.initialLine({ title:"Fin Close", status:"working", steps:[F.askStep({ words:"Hi" }), F.workStep({ who:"fake" })] }));
    let releasePic;
    s3.makePictures = () => new Promise(resolve => { releasePic = () => resolve([]); });
    const fakeRun = { stepId:"work-1", agent:"fake", session:"fake", workdir:docs3, started:Date.now() - 1000, said:"Finished!", buffer:"", tail:"", stopping:false, detaching:false, place:{ project:p3, slug:"fin-close" } };
    s3.runs.set(s3.key(p3, "fin-close"), fakeRun);
    const finPromise = s3.ended(p3, "fin-close", fakeRun, 0);
    await until(() => typeof releasePic === "function", "endRun paused in makePictures");
    s3.close();
    releasePic();
    await finPromise;
    assert.equal(F.parseLine(s3.readDoc(p3, "fin-close")).steps.find(s => s.id === "work-1").done, false, "closed service must NOT tick Work 1 after release");
  }

  // 2) F10: Live orphan shows running in activityOf and is stopped (not hidden) by Archive / Outdated!
  {
    const d10 = path.join(root, "s-f10"), docs10 = path.join(root, "docs-f10");
    fs.mkdirSync(d10, { recursive:true });
    const sleeper = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio:"ignore", detached:true });
    t.after(() => { try { process.kill(sleeper.pid, "SIGKILL"); } catch {} });
    const s10 = new Service({ directory:d10, agents:fakeAgents(script), autoWatch:false });
    t.after(() => s10.close());
    const p10 = s10.store.create({ name:"F10", docsPath:docs10 });
    p10.follow = false; s10.store.save();
    s10.writeDoc(p10, "arch-orphan", F.initialLine({ title:"Arch Orphan", status:"working", steps:[F.askStep({ words:"Run" }), F.workStep({ who:"fake" })] }));
    const sleeperMeta = require("../src/server/project-lines/run-watch.js").processMeta(sleeper.pid);
    s10.leftRunning = [{ key:s10.key(p10, "arch-orphan"), stepId:"work-1", agent:"fake", pid:sleeper.pid, started:Date.now(), procs:sleeperMeta ? [sleeperMeta] : [] }];
    assert.equal(s10.activityOf(p10, "arch-orphan", 0).running, true, "activityOf reports running=true for live orphan");
    await s10.act(p10, "arch-orphan", "close");
    await until(() => { try { process.kill(sleeper.pid, 0); return false; } catch { return true; } }, "Archive stops live orphan before closing Line", 2000);
    assert.equal(s10.activityOf(p10, "arch-orphan", 0).running, false);
  }

  // 3) F11: waiting add-task preserves untouched queued Work 2; asksFor keeps original Ask + trailing feedback; answer() with unrelated draft binds replaces!
  {
    const steps = [
      F.askStep({ words:"Original request", refs:["[a.txt](../files/x/a.txt)"] }),
      { ...F.workStep({ who:"fake" }), id:"work-1", done:true, off:"ended" },
      { ...F.workStep({ who:"other", replaces:"work-1" }), id:"work-2", replaces:"work-1", done:false },
      F.askStep({ words:"Trailing feedback" }),
    ];
    steps.forEach((s, i) => { s.index = i; if (!s.id) s.id = `ask-${i + 1}`; });
    const got = F.asksFor(steps, steps[2]);
    assert.equal(got.length, 2, "replacement Work with trailing feedback receives BOTH original request and trailing feedback");
    assert.match(got[0].body, /Original request/);
    assert.match(got[0].body, /a\.txt/);
    assert.match(got[1].body, /Trailing feedback/);

    const carried = F.parseLine(F.carryOn("---\nstatus: waiting\n---\n\n# T\n\n## Ask · 2026-11-20 07:00\n\nOrig\n\n## [ ] Work 1 · @fake · 1 min\n\n## Ask · 2026-11-20 07:01 · Not sent\n\nUnrelated draft\n"));
    const w2 = carried.steps.find(s => s.id === "work-2");
    assert.equal(w2.replaces, "work-1", "F.carryOn binds replaces: work-1 so answer continuations inherit Work 1's Ask");
    assert.equal(F.asksFor(carried.steps, w2)[0].text, "Orig");
  }

  const agents = fakeAgents(script);
  const service = new Service({ directory, agents, autoWatch:false });
  service.presets = createAgentPresets({ file:path.join(directory, "agent-presets.json"), agents });
  const fakePreset = service.presets.add({ name:"Fake", agent:"fake" });
  const otherPreset = service.presets.add({ name:"Other", agent:"other" });
  const orchestrator = service.orchestrator = createOrchestrator({ service, directory });
  t.after(() => service.close());
  const project = service.store.create({ name:"R2All", docsPath:docs, codePath:code });
  project.follow = false; service.store.save();

  // F11a: waiting add-task does NOT cancel untouched queued Work 2!
  service.writeDoc(project, "wait-q2", `---\nid: PE-911\nstatus: waiting\nwhy: Your answer\nwho: @fake\n---\n\n# Wait Q2\n\n## Questions for you\n\n**Pick?** (@fake)\n\n- [ ] Yes\n\n## Ask · 2026-11-20 07:00\n\nAsk 1\n\n## [ ] Work 1 · @fake · 1 min\n\n## Ask · 2026-11-20 07:02\n\nQueued task 2\n\n## [ ] Work 2 · @other\n`);
  await orchestrator.call(project, { do:"add-task", line:"wait-q2", task:"Task 3", agent:fakePreset.id, kind:"code" });
  await until(() => F.parseLine(service.readDoc(project, "wait-q2")).status === "done", "wait-q2 finished");
  const wq2 = F.parseLine(service.readDoc(project, "wait-q2"));
  assert.equal(wq2.steps.find(s => s.id === "work-1").off, "ended");
  assert.equal(wq2.steps.find(s => s.id === "work-2").off || "", "", "untouched queued Work 2 must NOT be cancelled as ended");

  // 4) F12: Discard with TWO remaining sibling lanes + autoWake=false settles queued Work 4 to not-started!
  project.autoWake = false; service.store.save();
  service.writeDoc(project, "two-sibs", F.initialLine({
    title:"Two Sibs", status:"stopped", why:"Work 1 failed",
    steps:[
      F.askStep({ words:"One" }), F.workStep({ who:"fake" }),
      F.askStep({ words:"mode:slow Sib 2" }), F.workStep({ who:"other" }),
      F.askStep({ words:"mode:slow Sib 3" }), F.workStep({ who:"fake" }),
      F.askStep({ words:"Queued 4" }), F.workStep({ who:"other" }),
    ],
  }));
  const tsDoc = F.parseLine(service.readDoc(project, "two-sibs"));
  await service.launch(project, "two-sibs", tsDoc.steps.find(s => s.id === "work-2"), tsDoc, { lane:true });
  await service.launch(project, "two-sibs", tsDoc.steps.find(s => s.id === "work-3"), tsDoc, { lane:true });
  await service.act(project, "two-sibs", "discard", { step:"work-1" });
  const l2 = service.lanes.get(service.key(project, "two-sibs")).get("work-2");
  const l3 = service.lanes.get(service.key(project, "two-sibs")).get("work-3");
  l2.said = "L2 done"; try { l2.child?.kill(); } catch {}
  await service.ended(project, "two-sibs", l2, 0);
  l3.said = "L3 done"; try { l3.child?.kill(); } catch {}
  await service.ended(project, "two-sibs", l3, 0);
  await until(() => F.parseLine(service.readDoc(project, "two-sibs")).status === "not-started", "two-sibs settled to not-started");
  assert.equal(F.parseLine(service.readDoc(project, "two-sibs")).steps.find(s => s.id === "work-4").done, false, "queued Work 4 NOT launched when autoWake=false across 2 siblings");
  project.autoWake = true; service.store.save();

  // 5) F13: Concurrent new Ask during Finish/Drop/Take + identical same-minute drafts in Send + Git aheadCount=null!
  const origAhead = Git.aheadCount;
  t.after(() => { Git.aheadCount = origAhead; });
  for (const op of ["finish-unsent", "drop-unsent", "take-unsent"]) {
    const slug = `race-${op}`;
    service.writeDoc(project, slug, F.setFront(F.initialLine({ title:slug, status:"waiting", branch:"feat/r2", base:"main", steps:[F.askStep({ words:"Only draft", via:F.NOT_SENT })] }), { why:F.NOT_SENT }));
    let rel;
    Git.aheadCount = () => new Promise(resolve => { rel = () => resolve(0); });
    const pending = service.act(project, slug, op, { step:"ask-1" });
    await until(() => typeof rel === "function", `${op} awaiting git`);
    await service.saveUnsent(project, { topic:slug, text:"Newer Ask saved during await" });
    rel();
    Git.aheadCount = origAhead;
    await assert.rejects(pending, { code:"CONFLICT" });
    assert.equal(service.store.isDeleted(project, slug), false, `${op} must NOT delete Line with newer Ask`);
    assert.match(service.readDoc(project, slug), /Newer Ask saved during await/, `${op} must NOT erase newer Ask`);
  }
  // Identical same-minute drafts in sendUnsent: removing ask-1 during await must reject ask-1 Send with CONFLICT (not send ask-2)!
  const sameWhen = "2026-11-20 07:00";
  service.writeDoc(project, "dup-draft", F.setFront(F.initialLine({
    title:"Dup Draft", status:"waiting", branch:"feat/r2", base:"main",
    steps:[F.askStep({ words:"Same text", when:sameWhen, via:F.NOT_SENT }), F.askStep({ words:"Same text", when:sameWhen, via:F.NOT_SENT })],
  }), { why:F.NOT_SENT }));
  let relSend;
  Git.aheadCount = () => new Promise(resolve => { relSend = () => resolve(0); });
  const pSend = service.sendUnsent(project, "dup-draft", { step:"ask-1", agent:"fake" });
  await until(() => typeof relSend === "function", "sendUnsent awaiting git");
  await service.dropUnsent(project, "dup-draft", { step:"ask-1" });
  relSend();
  Git.aheadCount = origAhead;
  await assert.rejects(pSend, { code:"CONFLICT" });
  assert.equal(F.parseLine(service.readDoc(project, "dup-draft")).steps.filter(F.isUnsent).length, 1, "remaining identical draft must NOT be consumed");

  // Unknown Git aheadCount (null) prevents destructive takeUnsent from deleting the Line!
  service.writeDoc(project, "git-null", F.setFront(F.initialLine({ title:"Git Null", status:"waiting", branch:"feat/r2", base:"main", steps:[F.askStep({ words:"Draft", via:F.NOT_SENT })] }), { why:F.NOT_SENT }));
  Git.aheadCount = async () => null;
  const takenNull = await service.act(project, "git-null", "take-unsent", { step:"ask-1" });
  Git.aheadCount = origAhead;
  assert.equal(takenNull.alone, false, "unknown Git aheadCount preserves Line instead of deleting");
  assert.equal(service.store.isDeleted(project, "git-null"), false);

  // 6) F14: Newer Work added while Stop awaits stopTree is never overwritten to stopped/not-started!
  service.writeDoc(project, "stop-early-race", F.initialLine({ title:"Stop Early", status:"working", steps:[F.askStep({ words:"mode:slow First" }), F.workStep({ who:"fake" })] }));
  const r14Doc = F.parseLine(service.readDoc(project, "stop-early-race"));
  await service.launch(project, "stop-early-race", r14Doc.steps.find(s => s.id === "work-1"), r14Doc);
  let relStop;
  const origStopTree = service.stopTree;
  service.stopTree = child => new Promise(resolve => { relStop = () => { try { child.kill("SIGKILL"); } catch {} resolve(0); }; });
  const pStop14 = service.stopWork(project, "stop-early-race");
  await until(() => typeof relStop === "function", "stopWork paused in stopTree");
  // Add a newer open Work while stopWork is waiting on Work 1's process exit.
  service.writeDoc(project, "stop-early-race", F.updateSteps(service.readDoc(project, "stop-early-race"), steps => { steps.push(F.askStep({ words:"Newer" }), F.workStep({ who:"fake" })); }));
  relStop();
  service.stopTree = origStopTree;
  await pStop14;
  const after14 = F.parseLine(service.readDoc(project, "stop-early-race"));
  assert.equal(after14.status, "working", "Stop superseded by newer Work must NOT overwrite Line to stopped/not-started");
  assert.equal(after14.steps.find(s => s.id === "work-1").off, "stopped");
  assert.equal(after14.steps.find(s => s.id === "work-2").done, false);

  // 7) F15: Standby takeover reloads conversations.json instead of overwriting owner's new bindings!
  {
    const d15 = path.join(root, "s-f15"), docs15 = path.join(root, "docs-f15");
    fs.mkdirSync(d15, { recursive:true });
    const owner15 = createProjectLines({ directory:d15, agents:fakeAgents(script), serviceOptions:{ autoWatch:false, recoverOnStart:true } });
    const standby15 = createProjectLines({ directory:d15, agents:fakeAgents(script), serviceOptions:{ autoWatch:false, recoverOnStart:true } });
    t.after(() => { standby15.close(); owner15.close(); });
    owner15.service.conversations.recordOf("claude", "owner-sess-1", { projectId:"p1", slug:"l1" });
    owner15.service.conversations.save(true);
    owner15.close();
    standby15.service.startRuntime({ autoWatch:false, recoverOnStart:true });
    assert.ok(standby15.service.conversations.records["claude:owner-sess-1"], "takeover reloaded owner's conversation binding");
    standby15.service.conversations.recordOf("claude", "standby-sess-2", { projectId:"p1", slug:"l2" });
    standby15.service.conversations.save(true);
    const savedConvs = JSON.parse(fs.readFileSync(path.join(d15, "conversations.json"), "utf8"));
    assert.ok(savedConvs["claude:owner-sess-1"] && savedConvs["claude:standby-sess-2"], "saving on successor preserves owner's binding");
  }

  // 8) F17: Delayed coordinator call with pre-Stop pass rejected with PARENT_STOPPED + archived duplicate PE ID stays ambiguous!
  orchestrator.setBase("http://127.0.0.1:4300/api/lines/orchestrate");
  service.writeDoc(project, "par-stop", F.setFront(F.initialLine({ title:"Par Stop", status:"working", steps:[F.askStep({ words:"mode:slow Go" }), F.workStep({ who:"fake" })] }), { id:"PE-717", orchestrator:"yes" }));
  const preStopPass = orchestrator.env(project, "par-stop", F.parseLine(service.readDoc(project, "par-stop"))).PENECHO_ORCH_PASS;
  await service.act(project, "par-stop", "stop");
  await assert.rejects(orchestrator.agentCall(preStopPass, { do:"create-line", task:"Delayed child", agent:fakePreset.id, kind:"code" }), { code:"PARENT_STOPPED" });

  // Archived duplicate PE ID must keep legacy child ambiguous!
  service.writeDoc(project, "dup-live", F.setFront(F.initialLine({ title:"Dup Live", status:"working", steps:[F.askStep({ words:"A" }), F.workStep({ who:"fake" })] }), { id:"PE-ARCHDUP", orchestrator:"yes" }));
  service.writeDoc(project, "dup-arch", F.setFront(F.initialLine({ title:"Dup Arch", status:"closed", steps:[F.askStep({ words:"B" })] }), { id:"PE-ARCHDUP", orchestrator:"yes" }));
  service.writeDoc(project, "legacy-arch-child", F.setFront(F.initialLine({ title:"Legacy Arch Child", status:"working", steps:[F.askStep({ words:"Keep" }), F.workStep({ who:"fake" })] }), { "orchestrated by":"PE-ARCHDUP" }));
  await service.act(project, "dup-live", "stop");
  assert.equal(F.parseLine(service.readDoc(project, "legacy-arch-child")).status, "working", "archived duplicate PE ID must keep legacy reference ambiguous");

  // 9) F18: Paused with question + wantsWork normalizes to waiting; healLeftWorking on Work · @you sets waiting!
  const mixedPaused = F.parseLine("---\nid: PE-18\nstatus: paused\nwhy: Not started\n---\n\n# Mixed\n\n## Questions for you\n\n**Proceed?** (@fake)\n\n- [ ] Yes\n\n## Ask · 2026-11-20 07:00\n\nDo it\n");
  assert.equal(mixedPaused.status, "waiting", "pending question takes precedence over wantsWork / Not started");
  service.writeDoc(project, "human-work", "---\nid: PE-18H\nstatus: working\n---\n\n# Human Work\n\n## Ask · 2026-11-20 07:00\n\nDo manually\n\n## [ ] Work 1 · @you\n");
  const hwTopic = service.store.scan(project).topics.find(x => x.slug === "human-work");
  hwTopic.mtime = Date.now() - 120_000;
  await service.healLeftWorking(project, hwTopic);
  assert.equal(F.parseLine(service.readDoc(project, "human-work")).status, "waiting", "human-owned Work · @you heals to waiting, NOT not-started");

  // 10) F19: External-app active child keeps orchestrator.isWaiting(parent) true!
  service.writeDoc(project, "ext-parent", F.setFront(F.initialLine({ title:"Ext Parent", status:"working", steps:[F.askStep({ words:"Wait" }), F.workStep({ who:"fake" })] }), { id:"PE-19P", orchestrator:"yes" }));
  service.writeDoc(project, "ext-child", F.setFront(F.initialLine({ title:"Ext Child", status:"working", steps:[F.askStep({ words:"Ext" }), F.workStep({ who:"claude" })] }), { "orchestrated by":"PE-19P", "orchestrated by slug":"ext-parent" }));
  service.live.set(service.key(project, "ext-child"), new Map([["claude:ext-1", { agent:"claude", stepId:"work-1", now:"Working" }]]));
  assert.equal(orchestrator.isWaiting(project, "ext-parent"), true, "external-app active child protects coordinator in isWaiting");
  service.live.delete(service.key(project, "ext-child"));

  // 11) F20: Explicit lane retry on idle stopped Line runs THAT lane + generic Retry preserves queued Work 2's existing kind + lane-only recovery drains queue!
  const prompts20 = [];
  const capScript = path.join(root, "cap20.js");
  const capLog = path.join(root, "cap20.jsonl");
  fs.writeFileSync(capScript, `
    const fs = require("node:fs"); let input = "";
    process.stdin.on("data", d => input += d).on("end", () => {
      fs.appendFileSync(${JSON.stringify(capLog)}, JSON.stringify({ line:process.env.PENECHO_LINE, input }) + "\\n");
      console.log(JSON.stringify({ type:"result", is_error:false, result:"OK" }));
      process.exit(0);
    });
  `);
  const d20 = path.join(root, "s-f20"), docs20 = path.join(root, "docs-f20");
  fs.mkdirSync(d20, { recursive:true });
  const ag20 = fakeAgents(capScript);
  const s20 = new Service({ directory:d20, agents:ag20, autoWatch:false });
  s20.presets = createAgentPresets({ file:path.join(d20, "agent-presets.json"), agents:ag20 });
  const fp20 = s20.presets.add({ name:"Fake", agent:"fake" });
  const op20 = s20.presets.add({ name:"Other", agent:"other" });
  const o20 = s20.orchestrator = createOrchestrator({ service:s20, directory:d20 });
  t.after(() => s20.close());
  const p20 = s20.store.create({ name:"F20", docsPath:docs20 });
  p20.follow = false; p20.autoWake = true; s20.store.save();

  // Explicit work-2 retry on idle stopped Line with open work-1 must run work-2's request ("Lane Two"), NOT "Primary One"!
  s20.writeDoc(p20, "explicit-lane", F.initialLine({
    title:"Explicit Lane", status:"stopped", why:"Primary failed",
    steps:[
      F.askStep({ words:"Primary One" }), F.workStep({ who:"fake" }),
      F.askStep({ words:"Lane Two" }), { ...F.workStep({ who:"other" }), done:true, off:"stopped" },
    ],
  }));
  const rExp = await o20.call(p20, { do:"retry", line:"explicit-lane", work:"work-2" });
  assert.equal(rExp.work, "work-2");
  await until(() => F.parseLine(s20.readDoc(p20, "explicit-lane")).steps.find(s => s.id === "work-2")?.done && !F.parseLine(s20.readDoc(p20, "explicit-lane")).steps.find(s => s.id === "work-2")?.off, "work-2 finished");
  const expLogs = fs.readFileSync(capLog, "utf8").trim().split("\n").map(JSON.parse).filter(x => x.line === "explicit-lane");
  assert.match(expLogs[0].input, /<request>\nLane Two\n<\/request>/, "explicit lane retry ran Work 2's request");
  assert.doesNotMatch(expLogs[0].input, /<request>\nPrimary One\n<\/request>/, "explicit lane retry must NOT launch open Work 1 instead");

  // Generic Retry when Work 1 (code) failed and queued Work 2 (chat) is next must preserve Work 2's kind="chat"!
  const cMeta = await o20.call(p20, { do:"create-line", task:"First code", agent:fp20.id, kind:"code" });
  await until(() => F.parseLine(s20.readDoc(p20, cMeta.line)).status === "done", "cMeta w1 done");
  const qMeta = await o20.call(p20, { do:"add-task", line:cMeta.line, task:"Discuss second approach", agent:op20.id, kind:"chat" });
  await until(() => F.parseLine(s20.readDoc(p20, cMeta.line)).status === "done", "cMeta w2 done");
  // Reset work-1 as stopped (done=true, off=stopped) and work-2 as open queued (done=false) on a stopped Line.
  s20.writeDoc(p20, cMeta.line, F.setFront(F.updateSteps(s20.readDoc(p20, cMeta.line), steps => {
    const w1 = steps.find(s => s.id === "work-1"), w2 = steps.find(s => s.id === qMeta.work);
    w1.done = true; w1.off = "stopped";
    w2.done = false; w2.off = "";
  }), { status:"stopped", why:"Work 1 stopped" }));
  const rMeta = await o20.call(p20, { do:"retry", line:cMeta.line });
  assert.equal(rMeta.work, qMeta.work);
  assert.equal(rMeta.kind, "chat", "generic Retry must NOT overwrite queued Work 2's existing kind=chat with Work 1's kind=code");
  await until(() => F.parseLine(s20.readDoc(p20, cMeta.line)).status === "done", "cMeta retry done");

  // Lane-only interruption with completed primary + queued Work 3: carryOn=true recovers lane and drains Work 3 to done!
  const dLane = path.join(root, "s-lane-rec"), docsLane = path.join(root, "docs-lane-rec");
  fs.mkdirSync(dLane, { recursive:true });
  const sL1 = new Service({ directory:dLane, agents:ag20, autoWatch:false });
  const pL1 = sL1.store.create({ name:"LaneRec", docsPath:docsLane });
  pL1.follow = false; pL1.autoWake = true; sL1.store.save();
  sL1.writeDoc(pL1, "lane-q3", F.initialLine({
    title:"Lane Q3", status:"working",
    steps:[
      F.askStep({ words:"Primary done" }), { ...F.workStep({ who:"fake" }), done:true, took:"1 min" },
      F.askStep({ words:"Lane interrupted" }), F.workStep({ who:"other" }),
      F.askStep({ words:"Queued 3" }), F.workStep({ who:"fake" }),
    ],
  }));
  fs.writeFileSync(path.join(dLane, "active-runs.json"), JSON.stringify([{ key:`${pL1.id}/lane-q3`, stepId:"work-2", agent:"other", lane:true, pid:0, started:Date.now() - 1000 }]));
  sL1.close();
  const sL2 = new Service({ directory:dLane, agents:ag20, autoWatch:false, carryOn:true, recoverOnStart:true });
  t.after(() => sL2.close());
  const pL2 = sL2.store.get(pL1.id);
  await until(() => F.parseLine(sL2.readDoc(pL2, "lane-q3")).status === "done", "lane-q3 recovered lane and drained queued Work 3 to done");
  assert.equal(F.parseLine(sL2.readDoc(pL2, "lane-q3")).steps.find(s => s.id === "work-3").done, true);
});


test("Round 3 Blocker 1 + F2 + F14 (P0): Stop keeps reservation after root exits while descendant survives SIGTERM, rejects overlapping Retry, and preserves normal Codex close provenance", async t => {
  const { spawn } = require("node:child_process");
  const { createKeeper } = require("../src/server/project-lines/kept-child.js");
  const { CodexServer } = require("../src/server/project-lines/codex-server.js");
  const root = makeRoot(t, "r3-b1-");
  const dir = path.join(root, "state"), docs = path.join(root, "docs");
  fs.mkdirSync(dir, { recursive:true });

  // Agent spawns a descendant that registers its SIGTERM handler BEFORE announcing its PID, while parent exits immediately on SIGTERM!
  const descPidFile = path.join(root, "desc.pid");
  const descScript = path.join(root, "desc-ignore-term.js");
  fs.writeFileSync(descScript, `
const fs = require("node:fs");
process.on("SIGTERM", () => {});
fs.writeFileSync(${JSON.stringify(descPidFile)}, String(process.pid));
setInterval(() => {}, 1000);
`);
  const parentScript = path.join(root, "parent-with-desc.js");
  fs.writeFileSync(parentScript, `
const { spawn } = require("node:child_process");
spawn(process.execPath, [${JSON.stringify(descScript)}], { stdio:"ignore" });
process.on("SIGTERM", () => { process.exit(0); });
setInterval(() => {}, 1000);
`);
  const ag = {
    available:() => [{ id:"fake", name:"Fake", available:true, runs:true }],
    nameOf:() => "Fake",
    command:(_id, opts) => ({ command:process.execPath, args:[parentScript], cwd:opts.workdir, env:{} }),
  };

  const s = new Service({ directory:dir, agents:ag, autoWatch:false, stopGraceMs:2500, stopKillMs:500 });
  t.after(() => s.close());
  const p = s.store.create({ name:"R3B1", docsPath:docs });
  p.follow = false; s.store.save();
  const created = await s.createTopic(p, { text:"Start with descendant", agent:"fake", start:true });
  await until(() => fs.existsSync(descPidFile), "descendant pid written");
  const descPid = Number(fs.readFileSync(descPidFile, "utf8").trim());
  t.after(() => { try { process.kill(descPid, "SIGKILL"); } catch {} });

  // Start Stop: root exits immediately on SIGTERM while descendant stays alive for the grace before SIGKILL!
  const stopPromise = s.act(p, created.slug, "stop");
  await until(() => JSON.parse(fs.readFileSync(s.activeFile, "utf8"))[0]?.stopping === true, "the stopping reservation is saved");
  await new Promise(r => setTimeout(r, 120));
  // Descendant is still alive; reservation MUST still exist in heldWorks & active-runs.json and Retry MUST reject BUSY!
  let descStillAlive = false;
  try { process.kill(descPid, 0); descStillAlive = true; } catch {}
  assert.equal(descStillAlive, true, "descendant still alive during grace window");
  assert.ok(s.heldWorks(p, created.slug).length > 0, "stoppingWorks keeps heldWorks non-empty even after root exits");
  const activeMid = JSON.parse(fs.readFileSync(s.activeFile, "utf8"));
  assert.ok(activeMid.length > 0 && activeMid[0].stopping === true, "active-runs.json keeps stopping reservation while descendant is alive");
  await assert.rejects(s.act(p, created.slug, "retry"), { code:"BUSY" }, "Retry MUST be rejected while Stop awaits surviving descendant");

  await stopPromise;
  let descAfter = true;
  try { process.kill(descPid, 0); } catch { descAfter = false; }
  assert.equal(descAfter, false, "Stop escalated to SIGKILL and terminated surviving descendant");
  assert.equal(F.parseLine(s.readDoc(p, created.slug)).status, "stopped");

  // F2 Codex provenance: normal CodexServer.close({ reason:"completed" }) writes `normal-close`, NOT `stopped-by-user`,
  // so a restart before Markdown settlement does NOT classify a completed turn as "Stopped by you".
  const keepRoot = path.join(root, "keep-prov");
  const keeper = createKeeper({ root:keepRoot });
  const child = keeper.spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { cwd:root, keepName:"codex-prov" });
  const srv = new CodexServer({ child });
  await until(() => fs.existsSync(path.join(child.dir, "pid.json")), "keeper spawned");
  srv.close({ reason:"completed" });
  assert.equal(fs.existsSync(path.join(child.dir, "normal-close")), true, "normal Codex close writes normal-close provenance marker");
  assert.equal(fs.existsSync(path.join(child.dir, "stopped-by-user")), false, "normal Codex close must NOT write stopped-by-user");
  await until(() => child.closed, "keeper child exited");

  // Verify #recoverInterrupted does NOT treat normal-close + kill as "Stopped by you".
  const dProv = path.join(root, "s-prov"), docsProv = path.join(root, "docs-prov");
  fs.mkdirSync(dProv, { recursive:true });
  const sp1 = new Service({ directory:dProv, agents:ag, autoWatch:false });
  const pp1 = sp1.store.create({ name:"Prov", docsPath:docsProv });
  pp1.follow = false; sp1.store.save();
  sp1.writeDoc(pp1, "codex-fin", F.initialLine({ title:"Codex Fin", status:"working", steps:[F.askStep({ words:"Do" }), F.workStep({ who:"fake" })] }));
  const kd = path.join(dProv, "keep", "codex-prov-rec");
  fs.mkdirSync(kd, { recursive:true });
  fs.writeFileSync(path.join(kd, "kill"), "SIGTERM");
  fs.writeFileSync(path.join(kd, "normal-close"), String(Date.now()));
  fs.writeFileSync(path.join(kd, "exit.json"), JSON.stringify({ code:0, signal:null, at:Date.now() }));
  fs.writeFileSync(path.join(dProv, "active-runs.json"), JSON.stringify([{ key:`${pp1.id}/codex-fin`, stepId:"work-1", agent:"fake", pid:0, started:Date.now() - 1000, keep:kd }]));
  sp1.close();
  const sp2 = new Service({ directory:dProv, agents:ag, autoWatch:false, recoverOnStart:true, carryOn:false });
  t.after(() => sp2.close());
  const pDoc = F.parseLine(sp2.readDoc(pp1, "codex-fin"));
  assert.notEqual(pDoc.front.why, "Stopped by you", "normal-close + kill must NOT be misclassified as Stopped by you");
  assert.equal(pDoc.steps.find(x => x.id === "work-1").done, false, "normal-close interruption leaves step open for recovery");
  assert.ok(!pDoc.steps.find(x => x.id === "work-1").off, "normal-close interruption does NOT set off:stopped");
});

test("Round 3 Blocker 2 + F1 (P0): Codex handoff fences detached owners and pending thread/start so at most one turn/start is sent, and empty claim.json times out", async t => {
  const { KeptChild, createKeeper } = require("../src/server/project-lines/kept-child.js");
  const { CodexServer, followTurn } = require("../src/server/project-lines/codex-server.js");
  const root = makeRoot(t, "r3-b2-");

  // 1) Two handoff owners at phase="thread": detach owner 1 during 150ms delay and attach owner 2 -> ONLY ONE turn/start!
  {
    const kd = path.join(root, "keep-handoff");
    fs.mkdirSync(kd, { recursive:true });
    fs.writeFileSync(path.join(kd, "pid.json"), JSON.stringify({ keeper:process.pid, agent:process.pid }));
    fs.writeFileSync(path.join(kd, "input"), `${JSON.stringify({ id:1, method:"initialize", params:{} })}\n${JSON.stringify({ method:"initialized" })}\n${JSON.stringify({ id:2, method:"thread/start", params:{} })}\n`);
    fs.writeFileSync(path.join(kd, "out"), `${JSON.stringify({ id:1, result:{} })}\n${JSON.stringify({ id:2, result:{ thread:{ id:"thr-1" } } })}\n`);

    const child1 = new KeptChild(kd);
    const srv1 = new CodexServer({ child:child1 });
    const p1 = followTurn(srv1, { threadId:"thr-1", phase:"thread", input:"Run once", readInput:() => fs.readFileSync(path.join(kd, "input"), "utf8") });
    await new Promise(r => setTimeout(r, 40));
    child1.detach();
    // Detached stdin MUST refuse writes.
    assert.equal(srv1.write({ id:999, method:"turn/start", params:{} }), false, "detached CodexServer.write returns false");

    const child2 = new KeptChild(kd);
    const srv2 = new CodexServer({ child:child2 });
    const p2 = followTurn(srv2, { threadId:"thr-1", phase:"thread", input:"Run once", readInput:() => fs.readFileSync(path.join(kd, "input"), "utf8") });
    await new Promise(r => setTimeout(r, 240));
    const frames = fs.readFileSync(path.join(kd, "input"), "utf8").trim().split("\n").map(JSON.parse);
    const turnStarts = frames.filter(f => f.method === "turn/start");
    assert.equal(turnStarts.length, 1, `expected exactly 1 turn/start frame across handoff, got ${turnStarts.length}`);
    child2.detach();
    void p1; void p2;
  }

  // 2) Pending thread/start already in input: recovery waits for its reply instead of sending a second thread/start after 150ms!
  {
    const kd = path.join(root, "keep-pending-thread");
    fs.mkdirSync(kd, { recursive:true });
    fs.writeFileSync(path.join(kd, "pid.json"), JSON.stringify({ keeper:process.pid, agent:process.pid }));
    fs.writeFileSync(path.join(kd, "input"), `${JSON.stringify({ id:1, method:"initialize", params:{} })}\n${JSON.stringify({ method:"initialized" })}\n${JSON.stringify({ id:2, method:"thread/start", params:{} })}\n`);
    fs.writeFileSync(path.join(kd, "out"), `${JSON.stringify({ id:1, result:{} })}\n`);

    const child = new KeptChild(kd);
    const srv = new CodexServer({ child });
    const p = followTurn(srv, { phase:"initialized", input:"After pending thread", readInput:() => fs.readFileSync(path.join(kd, "input"), "utf8") });
    // Wait past the 150ms replay delay while thread/start id=2 has NOT yet been answered.
    await new Promise(r => setTimeout(r, 230));
    let frames = fs.readFileSync(path.join(kd, "input"), "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(frames.filter(f => f.method === "thread/start").length, 1, "must NOT submit a second thread/start while id=2 is pending");
    assert.equal(frames.filter(f => f.method === "turn/start").length, 0, "must wait for thread/start reply before turn/start");

    // Now deliver thread/start reply for id=2 -> recovery captures thr-pending and sends ONE turn/start!
    fs.appendFileSync(path.join(kd, "out"), `${JSON.stringify({ id:2, result:{ thread:{ id:"thr-pending" } } })}\n`);
    await until(() => {
      const f = fs.readFileSync(path.join(kd, "input"), "utf8").trim().split("\n").map(JSON.parse);
      return f.some(x => x.method === "turn/start");
    }, "turn/start sent after pending thread reply");
    frames = fs.readFileSync(path.join(kd, "input"), "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(frames.filter(f => f.method === "thread/start").length, 1, "still only 1 thread/start");
    assert.equal(frames.filter(f => f.method === "turn/start").length, 1, "exactly 1 turn/start");
    assert.equal(frames.find(f => f.method === "turn/start").params.threadId, "thr-pending");
    child.detach();
    void p;
  }

  // 3) Empty 0-byte claim.json times out cleanly past unclaimedTimeoutMs instead of holding PID-0 handle open forever!
  {
    const kd = path.join(root, "keep-empty-claim");
    fs.mkdirSync(kd, { recursive:true });
    fs.writeFileSync(path.join(kd, "spec.json"), JSON.stringify({ command:process.execPath, args:[], cwd:root, dropEnv:[] }));
    fs.writeFileSync(path.join(kd, "claim.json"), "");
    const old = new Date(Date.now() - 5000);
    fs.utimesSync(path.join(kd, "claim.json"), old, old);
    const child = new KeptChild(kd, { unclaimedTimeoutMs:120 });
    await until(() => child.closed, "PID-0 handle with empty claim.json closes past unclaimedTimeoutMs", 3000);
    const parsedClaim = JSON.parse(fs.readFileSync(path.join(kd, "claim.json"), "utf8"));
    assert.equal(parsedClaim.owner, "cancelled", "empty corrupt claim.json replaced with cancelled claim");
  }

  // 4) Pre-exec POSIX wrapper publishes pid.json BEFORE exec and honors launch-aborted fence!
  if (process.platform !== "win32") {
    const keepRoot = path.join(root, "keep-fence");
    const keeper = createKeeper({ root:keepRoot });
    const marker = path.join(root, "should-not-run.txt");
    const kd = keeper.allocate("aborted-launch");
    fs.writeFileSync(path.join(kd, "launch-aborted"), String(Date.now()));
    const child = keeper.spawn(process.execPath, ["-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran")`], { cwd:root, dir:kd });
    await until(() => child.closed, "aborted launch keeper exits");
    assert.equal(fs.existsSync(marker), false, "launch-aborted prevented agent command from executing");
  }
});

test("Round 3 Blocker 3 + F3 + F10 + F11 + F12 + F13 + F15 + F16 + F17 + F18 + F20 + F22: all remaining P1/P2 findings", async t => {
  const { spawn } = require("node:child_process");
  const http = require("node:http");
  const Git = require("../src/server/project-lines/git.js");
  const RunWatch = require("../src/server/project-lines/run-watch.js");
  const { callOrchestrator } = require("../src/server/project-lines/orch-call.js");
  const root = makeRoot(t, "r3-all-");
  const script = makeFakeAgentScript(root);

  // 1) Blocker 3 + F17 + F22: Paused in-flight create-line while parent Stop completes (retiring stopActiveCounts) MUST reject PARENT_STOPPED;
  //    retry & rebuild-topics reject stale parent pass; ordinary Line Stop does NOT pollute generations.json; delete purges orchestrator entries.
  {
    const dir = path.join(root, "s-b3"), docs = path.join(root, "docs-b3");
    fs.mkdirSync(dir, { recursive:true });
    const presets = createAgentPresets({ file:path.join(dir, "agent-presets.json"), agents:fakeAgents(script) });
    const fp = presets.add({ name:"Fake", agent:"fake", model:"", effort:"", inPicker:true, forOrchestrator:true });
    const s = new Service({ directory:dir, agents:fakeAgents(script), autoWatch:false });
    s.presets = presets;
    t.after(() => s.close());
    const o = createOrchestrator({ service:s, directory:dir });
    o.setBase("http://127.0.0.1:9999/api/lines/orchestrate");
    s.orchestrator = o;
    const p = s.store.create({ name:"B3", docsPath:docs });
    p.follow = false; s.store.save();

    // Ordinary non-orchestrator Line Stop must NOT add an entry to generations.json.
    s.writeDoc(p, "plain-line", F.initialLine({ title:"Plain", status:"working", steps:[F.askStep({ words:"Hi" }), F.workStep({ who:"fake" })] }));
    await s.act(p, "plain-line", "stop");
    const gensAfterPlain = fs.existsSync(path.join(dir, "orchestrator", "generations.json"))
      ? JSON.parse(fs.readFileSync(path.join(dir, "orchestrator", "generations.json"), "utf8"))
      : {};
    assert.equal(`${p.id}/plain-line` in gensAfterPlain, false, "ordinary Line Stop must not pollute generations.json");

    // Parent orchestrator Line: pause create-line inside createTopic, stop parent to completion, then release createTopic!
    s.writeDoc(p, "parent-orch", F.setFront(F.initialLine({ title:"Parent", status:"working", steps:[F.askStep({ words:"Coord" }), F.workStep({ who:"fake" })] }), { orchestrator:"yes" }));
    const passBeforeStop = o.env(p, "parent-orch", F.parseLine(s.readDoc(p, "parent-orch"))).PENECHO_ORCH_PASS;
    let releaseCreate, enteredCreate;
    const enteredP = new Promise(r => { enteredCreate = r; });
    const origCreateTopic = s.createTopic.bind(s);
    s.createTopic = async (...args) => {
      const res = await origCreateTopic(...args);
      enteredCreate(res.slug);
      await new Promise(r => { releaseCreate = r; });
      return res;
    };
    const createPromise = o.agentCall(passBeforeStop, { do:"create-line", task:"Child task", agent:fp.id, kind:"code" });
    const childSlug = await enteredP;
    // Parent Stop runs to COMPLETE return (retiring stopActiveCounts and stopGenerations!).
    await s.act(p, "parent-orch", "stop");
    assert.equal(s.stopGeneration(p, "parent-orch"), 0, "transient stopGenerations retired after Stop returned");
    releaseCreate();
    await assert.rejects(createPromise, { code:"PARENT_STOPPED" }, "in-flight create-line rejected even after parent Stop returned");
    assert.equal(s.heldWorks(p, childSlug).length, 0, "child acquired NO active owner after parent Stop");
    assert.equal(F.parseLine(s.readDoc(p, childSlug)).status, "stopped", "child left stopped, not working");
    s.createTopic = origCreateTopic;

    // Stale pre-Stop pass must also be rejected for `retry` and `rebuild-topics`!
    await assert.rejects(o.agentCall(passBeforeStop, { do:"retry", line:childSlug }), { code:"PARENT_STOPPED" }, "stale pass rejected on retry");
    await assert.rejects(o.agentCall(passBeforeStop, { do:"rebuild-topics", agent:fp.id }), { code:"PARENT_STOPPED" }, "stale pass rejected on rebuild-topics");

    // Deleting orchestrator Line purges generations.json and passes.json entries.
    const parentHash = s.store.readText(p, `lines/parent-orch.md`).hash;
    await s.act(p, "parent-orch", "delete", { confirm:"parent-orch", baseHash:parentHash });
    const gensAfterDelete = JSON.parse(fs.readFileSync(path.join(dir, "orchestrator", "generations.json"), "utf8"));
    assert.equal(`${p.id}/parent-orch` in gensAfterDelete, false, "delete purges generations.json");
  }

  // 2) F3: Closed owner inside checkMerged/land during advance AND inside stopTree's processTable await!
  {
    const dir = path.join(root, "s-f3"), docs = path.join(root, "docs-f3"), code = path.join(root, "code-f3");
    fs.mkdirSync(dir, { recursive:true }); fs.mkdirSync(code, { recursive:true });
    const s = new Service({ directory:dir, agents:fakeAgents(script), autoWatch:false });
    const p = s.store.create({ name:"F3", docsPath:docs, codePath:code });
    p.follow = false; s.store.save();
    s.writeDoc(p, "merge-race", F.setFront(F.initialLine({ title:"Merge Race", status:"working", steps:[F.askStep({ words:"Done" }), { ...F.workStep({ who:"fake" }), done:true }] }), { branch:"feat/x", "merge into":"main", "merge from":"feat/x" }));
    const origMerged = Git.isMergedInto, origCommit = Git.mergeCommitOf;
    let releaseGit;
    Git.isMergedInto = () => new Promise(r => { releaseGit = () => r(true); });
    Git.mergeCommitOf = async () => "abc1234";
    t.after(() => { Git.isMergedInto = origMerged; Git.mergeCommitOf = origCommit; });
    const advP = s.advance(p, "merge-race");
    await until(() => typeof releaseGit === "function", "advance paused in checkMerged");
    s.close();
    releaseGit();
    await advP;
    assert.equal(F.parseLine(s.readDoc(p, "merge-race")).status, "working", "closed owner must NOT land Line after Git await");

    // Watchdog stopTree with canSignal=false after processTable must NOT kill child.
    let killed = false;
    let allowed = true;
    const origExec = RunWatch.processTable;
    const fakeChild = { pid:process.pid, kill() { killed = true; } };
    const pStop = RunWatch.stopTree(fakeChild, { canSignal:() => allowed });
    allowed = false;
    await pStop;
    assert.equal(killed, false, "stopTree does not signal once canSignal flips false");
    void origExec;
  }

  // 3) F10: Inconclusive PID identity (processMeta -> null) keeps orphan unresolved in activityOf and refuses blind kill in stopOrphans!
  {
    const dir = path.join(root, "s-f10"), docs = path.join(root, "docs-f10");
    fs.mkdirSync(dir, { recursive:true });
    const sleeper = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio:"ignore", detached:true });
    t.after(() => { try { process.kill(sleeper.pid, "SIGKILL"); } catch {} });
    const s = new Service({ directory:dir, agents:fakeAgents(script), autoWatch:false });
    t.after(() => s.close());
    const p = s.store.create({ name:"F10Unk", docsPath:docs });
    p.follow = false; s.store.save();
    s.writeDoc(p, "unk-orphan", F.initialLine({ title:"Unk", status:"working", steps:[F.askStep({ words:"Run" }), F.workStep({ who:"fake" })] }));
    s.leftRunning = [{ key:s.key(p, "unk-orphan"), stepId:"work-1", agent:"fake", pid:sleeper.pid, started:Date.now() }];
    const origMeta = RunWatch.processMeta;
    RunWatch.processMeta = () => null;
    try {
      assert.equal(s.identifyOrphanPid(sleeper.pid, s.leftRunning[0]), "unknown");
      assert.equal(s.activityOf(p, "unk-orphan", 0).running, true, "inconclusive PID still counts as unresolved live owner");
      await assert.rejects(s.stopOrphans(p, "unk-orphan"), { code:"STOP_FAILED" }, "stopOrphans refuses to signal inconclusive PID blindly");
      let alive = false; try { process.kill(sleeper.pid, 0); alive = true; } catch {}
      assert.equal(alive, true, "inconclusive process was NOT killed blindly");
    } finally {
      RunWatch.processMeta = origMeta;
    }
  }

  // 4) F11: F.carryOn keeps queued Work 2's Ask attached to Work 2 instead of stealing it into Work 1's continuation!
  {
    const md = [
      "---",
      "status: waiting",
      "---",
      "",
      "# Q",
      "",
      "## Ask · 2026-11-20 07:00",
      "",
      "Original",
      "",
      "## [ ] Work 1 · @fake · 1 min",
      "",
      "## Ask · 2026-11-20 07:01",
      "",
      "Queued assignment",
      "",
      "## [ ] Work 2 · @other",
      "",
    ].join("\n");
    const after = F.parseLine(F.carryOn(md));
    const works = after.steps.filter(s => s.kind === "work");
    assert.equal(works.length, 3);
    const cont = works.find(w => w.replaces === "work-1");
    const queued = works.find(w => w.who === "other");
    assert.ok(cont && queued);
    assert.deepEqual(F.asksFor(after.steps, cont).map(a => a.text), ["Original"], "continuation receives ONLY Original");
    assert.deepEqual(F.asksFor(after.steps, queued).map(a => a.text), ["Queued assignment"], "queued Work 2 retains Queued assignment");
  }

  // 5) F12: Rejected BUSY Retry on running sibling MUST NOT clear persisted `no auto drain`!
  {
    const dir = path.join(root, "s-f12"), docs = path.join(root, "docs-f12");
    fs.mkdirSync(dir, { recursive:true });
    const s = new Service({ directory:dir, agents:fakeAgents(script), autoWatch:false });
    t.after(() => s.close());
    const p = s.store.create({ name:"F12", docsPath:docs });
    p.follow = false; p.autoWake = false; s.store.save();
    s.writeDoc(p, "busy-hold", F.setFront(F.initialLine({
      title:"Hold", status:"working",
      steps:[
        F.askStep({ words:"Primary" }), { ...F.workStep({ who:"fake" }), done:true, off:"discarded" },
        F.askStep({ words:"Lane running" }), F.workStep({ who:"fake" }),
        F.askStep({ words:"Queued next" }), F.workStep({ who:"fake" }),
      ],
    }), { "no auto drain":"yes" }));
    const key = s.key(p, "busy-hold");
    s.noAutoDrain.add(key);
    s.lanes.set(key, new Map([["work-2", { stepId:"work-2", agent:"fake", lane:true, stopping:false }]]));
    await assert.rejects(s.begin(p, "busy-hold", { step:"work-2" }), { code:"BUSY" });
    assert.equal(F.parseLine(s.readDoc(p, "busy-hold")).front["no auto drain"], "yes", "failed BUSY Retry must NOT clear persisted no auto drain");
    assert.equal(s.noAutoDrain.has(key), true, "failed BUSY Retry must NOT clear in-memory noAutoDrain");
    s.lanes.delete(key);
    await s.next(p, "busy-hold");
    assert.equal(F.parseLine(s.readDoc(p, "busy-hold")).status, "not-started", "queued Work stays not-started when autoWake is off");
  }

  // 6) F13: dropUnsent rejects BUSY if external owner appears during Git await; pickUp does NOT swallow a sent Ask arriving during Git await!
  {
    const dir = path.join(root, "s-f13"), docs = path.join(root, "docs-f13"), code = path.join(root, "code-f13");
    fs.mkdirSync(dir, { recursive:true }); fs.mkdirSync(code, { recursive:true });
    const s = new Service({ directory:dir, agents:fakeAgents(script), autoWatch:false });
    t.after(() => s.close());
    const p = s.store.create({ name:"F13", docsPath:docs, codePath:code });
    p.follow = false; p.autoWake = false; s.store.save();

    // dropUnsent with external owner registering during branchReadyState
    s.writeDoc(p, "drop-live", F.setFront(F.initialLine({ title:"Drop Live", status:"waiting", steps:[F.askStep({ words:"Draft", via:F.NOT_SENT })] }), { branch:"feat/d", base:"main" }));
    let releaseDrop;
    const origBranch = s.branchReadyState.bind(s);
    s.branchReadyState = () => new Promise(r => { releaseDrop = () => r({ ready:false, unknown:false, why:null }); });
    const dropP = s.dropUnsent(p, "drop-live", { step:"ask-1" });
    await until(() => typeof releaseDrop === "function", "dropUnsent in branchReadyState");
    s.live.set(s.key(p, "drop-live"), new Map([["ext-1", { stepId:"work-1", now:"Working" }]]));
    releaseDrop();
    await assert.rejects(dropP, { code:"BUSY" }, "dropUnsent refuses to close while external owner is active");
    assert.notEqual(F.parseLine(s.readDoc(p, "drop-live")).status, "closed");
    s.live.delete(s.key(p, "drop-live"));

    // pickUp with new sent Ask arriving during branchReadyState
    s.writeDoc(p, "pickup-race", F.setFront(F.initialLine({ title:"Pickup", status:"waiting", steps:[] }), { why:F.NOT_SENT, branch:"feat/p", base:"main" }));
    s.markSeen(p, "pickup-race");
    let releasePick;
    s.branchReadyState = () => new Promise(r => { releasePick = () => r({ ready:false, unknown:false, why:null }); });
    const pickP = s.pickUp(p, "pickup-race", { wake:true });
    await until(() => typeof releasePick === "function", "pickUp in branchReadyState");
    // New sent Ask arrives while branchReadyState is pending!
    s.writeDoc(p, "pickup-race", F.insertAsk(s.readDoc(p, "pickup-race"), F.askStep({ words:"Fresh Ask during await" })));
    releasePick();
    const woke = await pickP;
    assert.equal(woke, true, "pickUp processed the sent Ask that arrived during branchReadyState instead of marking it seen silently");
    s.branchReadyState = origBranch;
  }

  // 7) F15: EIO on conversations.reload() aborts takeover without wiping existing conversations.json!
  {
    const dir = path.join(root, "s-f15"), docs = path.join(root, "docs-f15");
    fs.mkdirSync(dir, { recursive:true });
    const convFile = path.join(dir, "conversations.json");
    const existingBindings = { "pi:sess-existing":{ agent:"pi", id:"sess-existing", slug:"demo", projectId:"p1", offset:42 } };
    fs.writeFileSync(convFile, JSON.stringify(existingBindings));
    const s = new Service({ directory:dir, agents:fakeAgents(script), autoWatch:false });
    t.after(() => s.close());
    const origRead = fs.readFileSync;
    fs.readFileSync = (file, ...rest) => {
      if (String(file) === convFile) throw Object.assign(new Error("simulated EIO"), { code:"EIO" });
      return origRead.call(fs, file, ...rest);
    };
    try {
      assert.throws(() => s.startRuntime({ autoWatch:false, recoverOnStart:true }), { code:"CONVERSATIONS_UNREADABLE" });
    } finally {
      fs.readFileSync = origRead;
    }
    assert.equal(s.releaseRuntime, null, "takeover aborted cleanly on EIO");
    assert.deepEqual(JSON.parse(fs.readFileSync(convFile, "utf8")), existingBindings, "existing conversations.json preserved intact");
  }

  // 8) F16: orch-call treats `stop` and `status` as mutating (AMBIGUOUS_OUTCOME on post-dispatch reset);
  //    server WAL persists `pending` BEFORE executing side effect and rejects crashed `pending` replay as AMBIGUOUS_OUTCOME!
  {
    const orchToken = "tok-f16-test", instanceId = "inst-f16-test";
    let stopPosts = 0;
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, "http://127.0.0.1");
      if (req.method === "GET" && u.pathname === "/api/lines/orchestrate/identity") {
        const nonce = u.searchParams.get("nonce");
        const proof = require("../src/server/project-lines/orch-call.js").expectedOrchProof(orchToken, nonce, srv.address().port, instanceId);
        res.writeHead(200, { "content-type":"application/json" });
        return res.end(JSON.stringify({ ok:true, instanceId, port:srv.address().port, proof }));
      }
      stopPosts++;
      req.on("data", () => {});
      req.on("end", () => { res.destroy(); });
    });
    await new Promise(r => srv.listen(0, "127.0.0.1", r));
    t.after(() => srv.close());
    const ep = path.join(root, "orch-f16.json");
    fs.writeFileSync(ep, JSON.stringify({ url:`http://127.0.0.1:${srv.address().port}/api/lines/orchestrate`, port:srv.address().port, orchToken, instanceId }));
    await assert.rejects(
      callOrchestrator({ endpointFile:ep, pass:"p", body:{ do:"stop", line:"x" }, retryMs:1000, pollMs:50 }),
      { code:"AMBIGUOUS_OUTCOME" },
      "stop response reset surfaces AMBIGUOUS_OUTCOME without replay"
    );
    assert.equal(stopPosts, 1, "stop was NOT blindly replayed");

    // Server WAL: crashed pending entry in ops.json blocks duplicate execution on restart!
    const dir = path.join(root, "s-f16"), docs = path.join(root, "docs-f16");
    fs.mkdirSync(dir, { recursive:true });
    const presets = createAgentPresets({ file:path.join(dir, "agent-presets.json"), agents:fakeAgents(script) });
    const fp = presets.add({ name:"Fake", agent:"fake", model:"", effort:"", inPicker:true, forOrchestrator:true });
    const s = new Service({ directory:dir, agents:fakeAgents(script), autoWatch:false });
    s.presets = presets;
    t.after(() => s.close());
    const o = createOrchestrator({ service:s, directory:dir });
    o.setBase("http://127.0.0.1:9999/api/lines/orchestrate");
    s.orchestrator = o;
    const p = s.store.create({ name:"F16", docsPath:docs });
    p.follow = false; s.store.save();
    s.writeDoc(p, "orch-wal", F.setFront(F.initialLine({ title:"WAL", status:"working", steps:[F.askStep({ words:"Run" }), F.workStep({ who:"fake" })] }), { orchestrator:"yes" }));
    const pass = o.env(p, "orch-wal", F.parseLine(s.readDoc(p, "orch-wal"))).PENECHO_ORCH_PASS;
    const args = { do:"create-line", task:"Once only", agent:fp.id, kind:"code", run:false };
    const opId = "op-crashed-pending-1234";
    const opsFile = path.join(dir, "orchestrator", "ops.json");
    fs.mkdirSync(path.dirname(opsFile), { recursive:true });
    fs.writeFileSync(opsFile, JSON.stringify({ [`${p.id}/orch-wal/${opId}`]:{ state:"pending", at:Date.now(), fp:F.hashText(JSON.stringify(args)) } }));
    o.reload();
    await assert.rejects(o.agentCall(pass, args, null, { opId }), { code:"AMBIGUOUS_OUTCOME" }, "crashed pending WAL entry blocks duplicate execution");
  }

  // 9) F18: Explicit Retry on stopped `Work 1 · @you` rejects HUMAN_STEP without launching an agent or changing owner!
  {
    const dir = path.join(root, "s-f18"), docs = path.join(root, "docs-f18");
    fs.mkdirSync(dir, { recursive:true });
    let spawned = 0;
    const ag = {
      available:() => [{ id:"fake", name:"Fake", available:true, runs:true }],
      nameOf:() => "Fake",
      command:() => { spawned++; return { command:process.execPath, args:[script], cwd:docs, env:{} }; },
    };
    const s = new Service({ directory:dir, agents:ag, autoWatch:false });
    t.after(() => s.close());
    const p = s.store.create({ name:"F18", docsPath:docs });
    p.follow = false; s.store.save();
    s.writeDoc(p, "human-work", F.setFront(F.initialLine({
      title:"Human", status:"stopped",
      steps:[F.askStep({ words:"Manual" }), { ...F.workStep({ who:"you" }), done:true, off:"stopped" }],
    }), { who:"@fake" }));
    await assert.rejects(s.act(p, "human-work", "retry", { step:"work-1" }), { code:"HUMAN_STEP" }, "explicit Retry on @you rejects HUMAN_STEP");
    assert.equal(spawned, 0, "no agent launched for human-owned Work");
    assert.equal(F.parseLine(s.readDoc(p, "human-work")).steps.find(x => x.id === "work-1").who, "you", "owner remained @you");
  }

  // 10) F20: Explicit Retry on stopped lane Work 2 when Line is idle/stopped selects primary slot while STILL resuming `fake#work-2` session!
  {
    const dir = path.join(root, "s-f20"), docs = path.join(root, "docs-f20");
    fs.mkdirSync(dir, { recursive:true });
    let gotResume = undefined;
    const ag = {
      available:() => [{ id:"fake", name:"Fake", available:true, runs:true }],
      nameOf:() => "Fake",
      command:(_id, opts) => { gotResume = opts.resume; return { command:process.execPath, args:[script], cwd:opts.workdir, env:{} }; },
    };
    const s = new Service({ directory:dir, agents:ag, autoWatch:false });
    t.after(() => s.close());
    const p = s.store.create({ name:"F20", docsPath:docs });
    p.follow = false; s.store.save();
    s.writeDoc(p, "lane-resume", F.initialLine({
      title:"Lane Resume", status:"stopped",
      steps:[
        F.askStep({ words:"W1" }), { ...F.workStep({ who:"fake" }), done:true, took:"1 min" },
        F.askStep({ words:"W2" }), { ...F.workStep({ who:"fake" }), done:true, off:"stopped" },
      ],
    }));
    const TaskContext = require("../src/server/project-lines/task-context.js");
    const cfg = TaskContext.hash(JSON.stringify(["fake", "", "", "work"]));
    s.sessions[s.key(p, "lane-resume")] = {
      fake:{ id:"sess-primary-w1", workId:"work-1", policyVersion:TaskContext.VERSION, config:cfg, cwd:docs },
      "fake:task-lane-w2:work#work-2":{ id:"sess-lane-w2", workId:"work-2", kind:"work", policyVersion:TaskContext.VERSION, config:cfg, cwd:docs },
    };
    fs.writeFileSync(s.sessionsFile, JSON.stringify(s.sessions));
    await s.act(p, "lane-resume", "retry", { step:"work-2" });
    await until(() => F.parseLine(s.readDoc(p, "lane-resume")).status === "done", "lane-resume finished");
    assert.equal(gotResume, "sess-lane-w2", "explicit Retry of lane Work 2 in primary slot resumed its saved fake#work-2 session");
  }
});

test("Round 4 Blocker 1 + F2 + F10 (P0): two-lane real-keeper Stop kills both SIGTERM-ignoring descendants before release and per-PID procs identify surviving helpers", async t => {
  const { spawn } = require("node:child_process");
  const RunWatch = require("../src/server/project-lines/run-watch.js");
  const root = makeRoot(t, "r4-b1-");
  const dir = path.join(root, "state"), docs = path.join(root, "docs");
  fs.mkdirSync(dir, { recursive:true });

  const desc1File = path.join(root, "desc-1.pid");
  const desc2File = path.join(root, "desc-2.pid");
  const descScript = path.join(root, "desc-ignore-term.js");
  fs.writeFileSync(descScript, `
const fs = require("node:fs");
process.on("SIGTERM", () => {});
fs.writeFileSync(process.argv[2], String(process.pid));
setInterval(() => {}, 1000);
`);
  const parentScript = path.join(root, "parent-two-lane.js");
  fs.writeFileSync(parentScript, `
const { spawn } = require("node:child_process");
// Spawn descendant in its own session (detached) so only upfront tree capture can track it after root exits immediately on SIGTERM.
spawn(process.execPath, [${JSON.stringify(descScript)}, process.env.DESC_FILE], { stdio:"ignore", detached:true });
process.on("SIGTERM", () => { process.exit(0); });
setInterval(() => {}, 1000);
`);

  let launchCount = 0;
  const ag = {
    available:() => [{ id:"fake", name:"Fake", available:true, runs:true }],
    nameOf:() => "Fake",
    command:(_id, opts) => {
      launchCount++;
      if (launchCount <= 2) {
        return { command:process.execPath, args:[parentScript], cwd:opts.workdir, env:{ DESC_FILE:launchCount === 1 ? desc1File : desc2File } };
      }
      return { command:process.execPath, args:["-e", "console.log(JSON.stringify({ type:'result', is_error:false, result:'Retried cleanly' })); process.exit(0);"], cwd:opts.workdir, env:{} };
    },
  };

  const s = new Service({ directory:dir, agents:ag, autoWatch:false, stopGraceMs:350, stopKillMs:500 });
  t.after(() => s.close());
  const p = s.store.create({ name:"R4B1", docsPath:docs });
  p.follow = false; s.store.save();

  const created = await s.createTopic(p, { text:"Primary lane work", agent:"fake", start:true });
  await until(() => fs.existsSync(desc1File), "work-1 descendant pid written");
  const desc1 = Number(fs.readFileSync(desc1File, "utf8").trim());
  t.after(() => { try { process.kill(desc1, "SIGKILL"); } catch {} });

  // Add parallel Work 2 on the same Line.
  await s.addAgentTask(p, created.slug, { text:"Parallel lane work", agent:"fake", parallel:true });
  await until(() => fs.existsSync(desc2File), "work-2 descendant pid written");
  const desc2 = Number(fs.readFileSync(desc2File, "utf8").trim());
  t.after(() => { try { process.kill(desc2, "SIGKILL"); } catch {} });

  const isAlive = pid => { try { process.kill(pid, 0); return !RunWatch.processMeta?.(pid)?.zombie; } catch { return false; } };
  assert.equal(isAlive(desc1), true, "work-1 descendant alive before Stop");
  assert.equal(isAlive(desc2), true, "work-2 descendant alive before Stop");

  const stopP = s.act(p, created.slug, "stop");
  await new Promise(r => setTimeout(r, 120));
  // During grace window both descendants survive while both reservations stay in active-runs.json with per-PID procs!
  const midActive = JSON.parse(fs.readFileSync(s.activeFile, "utf8"));
  assert.equal(midActive.length, 2, "both lanes keep durable stopping reservations during grace window");
  assert.ok(midActive.every(e => e.stopping === true && Array.isArray(e.procs) && e.procs.length >= 2), "both reservations persist per-PID procs");
  await assert.rejects(s.act(p, created.slug, "retry", { step:"work-2" }), { code:"BUSY" }, "explicit Retry on work-2 blocked while descendants are still alive");

  await stopP;
  assert.equal(isAlive(desc1), false, "work-1 descendant terminated before Stop returned");
  assert.equal(isAlive(desc2), false, "work-2 descendant terminated before Stop returned");
  assert.equal(s.heldWorks(p, created.slug).length, 0, "heldWorks empty only after BOTH descendants exited");
  assert.equal(JSON.parse(fs.readFileSync(s.activeFile, "utf8")).length, 0, "active-runs.json empty only after BOTH descendants exited");

  // Explicit Retry on work-2 now succeeds cleanly with zero overlap.
  await s.act(p, created.slug, "retry", { step:"work-2" });
  await until(() => F.parseLine(s.readDoc(p, created.slug)).steps.find(x => x.id === "work-2")?.done && !F.parseLine(s.readDoc(p, created.slug)).steps.find(x => x.id === "work-2")?.off, "work-2 retry finished");

  // F10: Per-PID procs metadata identifies a surviving helper with a different executable and later start time (>2 min after root),
  // while still rejecting a genuinely reused PID!
  const sleeper = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio:"ignore", detached:true });
  t.after(() => { try { process.kill(sleeper.pid, "SIGKILL"); } catch {} });
  const helperStart = Date.now();
  const rootStart = helperStart - 10 * 60_000;
  const origMeta = RunWatch.processMeta;
  RunWatch.processMeta = pid => pid === sleeper.pid
    ? { pid:sleeper.pid, ppid:1, pgid:sleeper.pid, zombie:false, startedAt:helperStart, command:"/usr/bin/python3 helper.py" }
    : origMeta(pid);
  try {
    const entryWithHelper = {
      key:s.key(p, created.slug), stepId:"work-1", agent:"fake", pid:999999, started:rootStart,
      pids:[999999, sleeper.pid],
      procs:[{ pid:sleeper.pid, pgid:sleeper.pid, startedAt:helperStart, command:"/usr/bin/python3 helper.py" }],
    };
    assert.equal(s.identifyOrphanPid(sleeper.pid, entryWithHelper), "match", "per-PID proc record matches surviving helper with different executable and >2min later start");
    assert.deepEqual(s.orphanPidsOf(entryWithHelper), [sleeper.pid], "orphanPidsOf retains verified surviving helper");

    const entryReused = {
      key:s.key(p, created.slug), stepId:"work-1", agent:"fake", pid:999999, started:rootStart,
      pids:[sleeper.pid],
      procs:[{ pid:sleeper.pid, pgid:sleeper.pid, startedAt:helperStart - 60_000, command:"/usr/bin/other-tool" }],
    };
    assert.equal(s.identifyOrphanPid(sleeper.pid, entryReused), "mismatch", "genuinely reused PID still rejected as mismatch");
  } finally {
    RunWatch.processMeta = origMeta;
  }
});

test("Round 4 Blocker 2 + F1 (P0): Codex handoff at onBeforeTurn never loses turn, dead lock surfaces protocol error, and POSIX keeper works with restricted PATH", async t => {
  const { KeptChild, createKeeper } = require("../src/server/project-lines/kept-child.js");
  const { CodexServer, followTurn } = require("../src/server/project-lines/codex-server.js");
  const root = makeRoot(t, "r4-b2-");

  // 1) Detach first recovery owner at onBeforeTurn -> successor submits EXACTLY ONE turn/start (zero lost turns, zero duplicates) and completes!
  {
    const kd = path.join(root, "keep-before-turn");
    fs.mkdirSync(kd, { recursive:true });
    fs.writeFileSync(path.join(kd, "pid.json"), JSON.stringify({ keeper:process.pid, agent:process.pid }));
    fs.writeFileSync(path.join(kd, "input"), `${JSON.stringify({ id:1, method:"initialize", params:{} })}\n${JSON.stringify({ method:"initialized" })}\n${JSON.stringify({ id:2, method:"thread/start", params:{} })}\n`);
    fs.writeFileSync(path.join(kd, "out"), `${JSON.stringify({ id:1, result:{} })}\n${JSON.stringify({ id:2, result:{ thread:{ id:"thr-bt" } } })}\n`);

    const child1 = new KeptChild(kd);
    const srv1 = new CodexServer({ child:child1 });
    let hitBeforeTurn = false;
    const p1 = followTurn(srv1, {
      threadId:"thr-bt",
      phase:"thread",
      input:"Must not disappear",
      readInput:() => fs.readFileSync(path.join(kd, "input"), "utf8"),
      onBeforeTurn:() => { hitBeforeTurn = true; child1.detach(); },
    });
    await until(() => hitBeforeTurn, "owner 1 hit onBeforeTurn and detached");
    const afterDetach = fs.readFileSync(path.join(kd, "input"), "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(afterDetach.filter(f => f.method === "turn/start").length, 0, "owner 1 detached before sending turn/start");
    assert.equal(fs.existsSync(path.join(kd, "turn-submit.lock")), false, "no stale lock left when owner 1 detaches at onBeforeTurn");

    // Successor attaches and MUST submit exactly 1 turn/start and complete cleanly.
    const child2 = new KeptChild(kd);
    const srv2 = new CodexServer({ child:child2 });
    const p2 = followTurn(srv2, {
      threadId:"thr-bt",
      phase:"starting-turn",
      input:"Must not disappear",
      readInput:() => fs.readFileSync(path.join(kd, "input"), "utf8"),
    });
    await until(() => {
      const f = fs.readFileSync(path.join(kd, "input"), "utf8").trim().split("\n").map(JSON.parse);
      return f.some(x => x.method === "turn/start");
    }, "successor submitted turn/start");
    const frames = fs.readFileSync(path.join(kd, "input"), "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(frames.filter(f => f.method === "turn/start").length, 1, "exactly 1 turn/start submitted across onBeforeTurn handoff");
    fs.appendFileSync(path.join(kd, "out"), `${JSON.stringify({ method:"turn/completed", params:{ threadId:"thr-bt", turn:{ id:"t-1", status:"completed" } } })}\n`);
    const outcome = await p2;
    assert.equal(outcome.code, 0, "successor settled turn cleanly");
    child2.detach();
    void p1;
  }

  // 2) Dead-PID turn-submit.lock left behind without turn/start in input surfaces explicit protocol error instead of hanging!
  {
    const kd = path.join(root, "keep-ambig-lock");
    fs.mkdirSync(kd, { recursive:true });
    fs.writeFileSync(path.join(kd, "pid.json"), JSON.stringify({ keeper:process.pid, agent:process.pid }));
    fs.writeFileSync(path.join(kd, "input"), `${JSON.stringify({ id:1, method:"initialize", params:{} })}\n${JSON.stringify({ method:"initialized" })}\n${JSON.stringify({ id:2, method:"thread/start", params:{} })}\n`);
    fs.writeFileSync(path.join(kd, "out"), `${JSON.stringify({ id:1, result:{} })}\n${JSON.stringify({ id:2, result:{ thread:{ id:"thr-ambig" } } })}\n`);
    fs.writeFileSync(path.join(kd, "turn-submit.lock"), JSON.stringify({ pid:999999999, at:Date.now(), token:"dead-owner" }));

    const child = new KeptChild(kd);
    const srv = new CodexServer({ child });
    const outcome = await followTurn(srv, {
      threadId:"thr-ambig",
      phase:"starting-turn",
      input:"Ambiguous",
      readInput:() => fs.readFileSync(path.join(kd, "input"), "utf8"),
    });
    assert.equal(outcome.code, 1);
    assert.equal(outcome.protocol, true, "dead turn-submit.lock surfaces explicit protocol error instead of hanging");
    const frames = fs.readFileSync(path.join(kd, "input"), "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(frames.filter(f => f.method === "turn/start").length, 0, "no blind duplicate turn/start emitted on ambiguous crash");
    child.detach();
  }

  // 3) POSIX keeper with absolute Node executable and empty/restricted PATH="" runs cleanly (no `mv: command not found`)!
  if (process.platform !== "win32") {
    const keepRoot = path.join(root, "keep-empty-path");
    const keeper = createKeeper({ root:keepRoot });
    const marker = path.join(root, "ran-empty-path.txt");
    const child = keeper.spawn(process.execPath, ["-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ok")`], {
      cwd:root,
      env:{ PATH:"" },
      keepName:"empty-path",
    });
    const code = await new Promise(resolve => child.on("close", resolve));
    assert.equal(code, 0, "POSIX keeper with absolute executable and PATH='' must succeed without mv: command not found");
    assert.equal(fs.readFileSync(marker, "utf8"), "ok");
  }
});

test("Round 4 Blocker 3 + F3 + F12 + F14 + F16 + F17 + F22: parent Stop+Delete/Recreate, bounded passes, advance owner fence, generic begin hold, durable launchId, and pending WAL retention", async t => {
  const Git = require("../src/server/project-lines/git.js");
  const root = makeRoot(t, "r4-all-");
  const script = makeFakeAgentScript(root);

  // 1) Blocker 3 + F17 + F22: Stop+Delete AND Stop+Delete+Recreate same slug both reject paused create-line with PARENT_STOPPED;
  //    repeated invalidate+reissue keeps passes.json bounded to 1 active entry per Line while revoking older v2 passes!
  {
    const dir = path.join(root, "s-b3"), docs = path.join(root, "docs-b3");
    fs.mkdirSync(dir, { recursive:true });
    const presets = createAgentPresets({ file:path.join(dir, "agent-presets.json"), agents:fakeAgents(script) });
    const fp = presets.add({ name:"Fake", agent:"fake", model:"", effort:"", inPicker:true, forOrchestrator:true });
    const s = new Service({ directory:dir, agents:fakeAgents(script), autoWatch:false });
    s.presets = presets;
    t.after(() => s.close());
    const o = createOrchestrator({ service:s, directory:dir });
    o.setBase("http://127.0.0.1:9999/api/lines/orchestrate");
    s.orchestrator = o;
    const p = s.store.create({ name:"R4B3", docsPath:docs });
    p.follow = false; s.store.save();

    // (a) Stop + Delete parent before releasing paused create-line -> PARENT_STOPPED, zero child owners!
    s.writeDoc(p, "del-parent", F.setFront(F.initialLine({ title:"Del Parent", status:"working", steps:[F.askStep({ words:"Coord" }), F.workStep({ who:"fake" })] }), { id:"PE-901", orchestrator:"yes" }));
    const passA = o.env(p, "del-parent", F.parseLine(s.readDoc(p, "del-parent"))).PENECHO_ORCH_PASS;
    let releaseA, enteredA;
    const enteredAP = new Promise(r => { enteredA = r; });
    const origCreateTopic = s.createTopic.bind(s);
    s.createTopic = async (...args) => {
      const res = await origCreateTopic(...args);
      enteredA(res.slug);
      await new Promise(r => { releaseA = r; });
      return res;
    };
    const createA = o.agentCall(passA, { do:"create-line", task:"Child after delete", agent:fp.id, kind:"code" });
    const childA = await enteredAP;
    await s.act(p, "del-parent", "stop");
    const hashA = s.store.readText(p, "lines/del-parent.md").hash;
    await s.act(p, "del-parent", "delete", { confirm:"del-parent", baseHash:hashA });
    assert.equal(s.isLine(p, "del-parent"), false);
    releaseA();
    await assert.rejects(createA, { code:"PARENT_STOPPED" }, "paused create-line rejected after parent Stop + Delete");
    assert.equal(s.heldWorks(p, childA).length, 0, "deleted parent left zero active child owners");
    assert.equal(F.parseLine(s.readDoc(p, childA)).status, "stopped");

    // (b) Stop + Delete + Recreate parent with the SAME slug -> paused create-line AND stale pass STILL rejected PARENT_STOPPED!
    s.writeDoc(p, "rec-parent", F.setFront(F.initialLine({ title:"Rec Parent 1", status:"working", steps:[F.askStep({ words:"Coord" }), F.workStep({ who:"fake" })] }), { orchestrator:"yes" }));
    const passB = o.env(p, "rec-parent", F.parseLine(s.readDoc(p, "rec-parent"))).PENECHO_ORCH_PASS;
    let releaseB, enteredB;
    const enteredBP = new Promise(r => { enteredB = r; });
    s.createTopic = async (...args) => {
      const res = await origCreateTopic(...args);
      enteredB(res.slug);
      await new Promise(r => { releaseB = r; });
      return res;
    };
    const createB = o.agentCall(passB, { do:"create-line", task:"Child after recreate", agent:fp.id, kind:"code" });
    const childB = await enteredBP;
    await s.act(p, "rec-parent", "stop");
    const hashB = s.store.readText(p, "lines/rec-parent.md").hash;
    await s.act(p, "rec-parent", "delete", { confirm:"rec-parent", baseHash:hashB });
    // Clear deletion tombstone and recreate with exact same slug (even without front.id!) + issue a fresh pass -> monotonic _seq prevents generation reuse!
    delete s.store.deleted[`${p.id}:rec-parent`];
    s.store.saveDeleted();
    s.writeDoc(p, "rec-parent", F.setFront(F.initialLine({ title:"Rec Parent 2", status:"working", steps:[F.askStep({ words:"New" }), F.workStep({ who:"fake" })] }), { orchestrator:"yes" }));
    const freshPassB = o.env(p, "rec-parent", F.parseLine(s.readDoc(p, "rec-parent"))).PENECHO_ORCH_PASS;
    assert.notEqual(freshPassB, passB, "recreated same-slug parent gets a strictly newer generation pass");
    releaseB();
    await assert.rejects(createB, { code:"PARENT_STOPPED" }, "paused create-line rejected after Stop + Delete + Recreate with same slug");
    assert.equal(s.heldWorks(p, childB).length, 0, "recreated parent left zero active child owners");
    await assert.rejects(o.agentCall(passB, { do:"status", line:childB }), { code:"PARENT_STOPPED" }, "revoked v2 pass rejected even on non-launch call against recreated same-slug parent");
    const okFresh = await o.agentCall(freshPassB, { do:"help" });
    assert.ok(Array.isArray(okFresh.functions), "recreated parent's own fresh pass works normally");
    s.createTopic = origCreateTopic;

    // (c) F22: 4x invalidate + reissue on a retained coordinator keeps ONLY 1 active pass in passes.json while older passes reject PARENT_STOPPED!
    s.writeDoc(p, "bounded-coord", F.setFront(F.initialLine({ title:"Bounded", status:"working", steps:[F.askStep({ words:"Go" }), F.workStep({ who:"fake" })] }), { id:"PE-922", orchestrator:"yes" }));
    const oldPasses = [];
    for (let i = 0; i < 4; i++) {
      oldPasses.push(o.env(p, "bounded-coord", F.parseLine(s.readDoc(p, "bounded-coord"))).PENECHO_ORCH_PASS);
      o.invalidateSession(p, "bounded-coord");
    }
    const latestPass = o.env(p, "bounded-coord", F.parseLine(s.readDoc(p, "bounded-coord"))).PENECHO_ORCH_PASS;
    const diskPasses = JSON.parse(fs.readFileSync(path.join(dir, "orchestrator", "passes.json"), "utf8"));
    const entriesForLine = Object.values(diskPasses).filter(e => e.projectId === p.id && e.slug === "bounded-coord");
    assert.equal(entriesForLine.length, 1, `passes.json must keep only 1 active entry per coordinator Line, got ${entriesForLine.length}`);
    for (const stale of oldPasses) {
      await assert.rejects(o.agentCall(stale, { do:"create-line", task:"Stale", agent:fp.id, kind:"code" }), { code:"PARENT_STOPPED" }, "every pruned older v2 pass still rejects PARENT_STOPPED");
    }
    const okHelp = await o.agentCall(latestPass, { do:"help" });
    assert.ok(Array.isArray(okHelp.functions), "latest active pass works normally");
  }

  // 2) F3: Closed owner paused in Git.removeWorktree inside advance() MUST NOT call Git.deleteBranch!
  {
    const dir = path.join(root, "s-f3-wt"), docs = path.join(root, "docs-f3-wt"), code = path.join(root, "code-f3-wt");
    fs.mkdirSync(dir, { recursive:true }); fs.mkdirSync(code, { recursive:true });
    const s = new Service({ directory:dir, agents:fakeAgents(script), autoWatch:false });
    const p = s.store.create({ name:"F3WT", docsPath:docs, codePath:code });
    p.follow = false; s.store.save();
    const branch = "penecho/wt-race";
    s.writeDoc(p, "wt-race", F.setFront(F.initialLine({ title:"WT Race", status:"working", steps:[F.askStep({ words:"Done" }), { ...F.workStep({ who:"fake" }), done:true }] }), { branch, base:"main" }));
    const origMerged = Git.isMergedInto, origAhead = Git.aheadCount, origRemove = Git.removeWorktree, origDelete = Git.deleteBranch;
    let releaseRemove, deletedBranch = false;
    Git.isMergedInto = async () => false;
    Git.aheadCount = async () => 0;
    Git.removeWorktree = () => new Promise(r => { releaseRemove = () => r(); });
    Git.deleteBranch = async () => { deletedBranch = true; };
    t.after(() => { Git.isMergedInto = origMerged; Git.aheadCount = origAhead; Git.removeWorktree = origRemove; Git.deleteBranch = origDelete; });
    const advP = s.advance(p, "wt-race");
    await until(() => typeof releaseRemove === "function", "advance paused in removeWorktree");
    s.close();
    releaseRemove();
    await advP;
    assert.equal(deletedBranch, false, "closed owner MUST NOT invoke Git.deleteBranch after removeWorktree await");
  }

  // 3) F12: Generic begin() with autoWake=false and an external live owner rejects BUSY without clearing `no auto drain`!
  {
    const dir = path.join(root, "s-f12-ext"), docs = path.join(root, "docs-f12-ext");
    fs.mkdirSync(dir, { recursive:true });
    const s = new Service({ directory:dir, agents:fakeAgents(script), autoWatch:false });
    t.after(() => s.close());
    const p = s.store.create({ name:"F12Ext", docsPath:docs });
    p.follow = false; p.autoWake = false; s.store.save();
    s.writeDoc(p, "ext-hold", F.setFront(F.initialLine({
      title:"Ext Hold", status:"working",
      steps:[
        F.askStep({ words:"Primary" }), { ...F.workStep({ who:"fake" }), done:true, off:"discarded" },
        F.askStep({ words:"Queued next" }), F.workStep({ who:"fake" }),
      ],
    }), { "no auto drain":"yes" }));
    const key = s.key(p, "ext-hold");
    s.noAutoDrain.add(key);
    s.live.set(key, new Map([["claude:ext-sibling", { agent:"claude", stepId:"work-1", now:"Working" }]]));
    await assert.rejects(s.begin(p, "ext-hold"), { code:"BUSY" }, "generic begin() rejects BUSY while external live owner runs");
    assert.equal(F.parseLine(s.readDoc(p, "ext-hold")).front["no auto drain"], "yes", "persisted no auto drain preserved after BUSY");
    assert.equal(s.noAutoDrain.has(key), true, "in-memory noAutoDrain preserved after BUSY");
    s.live.delete(key);
    await s.next(p, "ext-hold");
    assert.equal(F.parseLine(s.readDoc(p, "ext-hold")).status, "not-started", "queued Work stays not-started once external owner finishes");
  }

  // 4) F14: Delayed closeDetail with old launchId does NOT overwrite an already-completed replacement attempt!
  {
    const dir = path.join(root, "s-f14-durable"), docs = path.join(root, "docs-f14-durable");
    fs.mkdirSync(dir, { recursive:true });
    const s = new Service({ directory:dir, agents:fakeAgents(script), autoWatch:false });
    t.after(() => s.close());
    const p = s.store.create({ name:"F14Dur", docsPath:docs });
    p.follow = false; s.store.save();
    s.writeDoc(p, "dur-launch", F.initialLine({ title:"Durable", status:"done", steps:[F.askStep({ words:"Do" }), { ...F.workStep({ who:"fake" }), done:true }] }));
    // Replacement attempt L2 finishes and writes its result + durable launch id, leaving zero live owners.
    await s.closeDetail(p, "dur-launch", "work-1", { result:"Authoritative L2 answer", took:"1 min", launchId:"launch-L2" });
    assert.equal(s.heldWorks(p, "dur-launch").length, 0);
    // Delayed settlement carrying old launchId L1 must be rejected!
    await s.closeDetail(p, "dur-launch", "work-1", { result:"Stale L1 output", stopped:"Stopped by you", why:"stopped", launchId:"launch-L1" });
    const detail = s.store.readText(p, F.detailPath("dur-launch", "work-1")).text;
    assert.match(detail, /Authoritative L2 answer/, "L2 result preserved against delayed L1 closeDetail");
    assert.doesNotMatch(detail, /Stopped by you/, "stale L1 launchId must NOT write Stopped by you over L2");
    assert.equal(F.splitFront(detail).front["launch id"], "launch-L2");
  }

  // 5) F16: saveOps never evicts unresolved `pending` WAL records even after >500 newer settled receipts!
  {
    const dir = path.join(root, "s-f16-evict"), docs = path.join(root, "docs-f16-evict");
    fs.mkdirSync(dir, { recursive:true });
    const presets = createAgentPresets({ file:path.join(dir, "agent-presets.json"), agents:fakeAgents(script) });
    const fp = presets.add({ name:"Fake", agent:"fake", model:"", effort:"", inPicker:true, forOrchestrator:true });
    const s = new Service({ directory:dir, agents:fakeAgents(script), autoWatch:false });
    s.presets = presets;
    t.after(() => s.close());
    const o = createOrchestrator({ service:s, directory:dir });
    o.setBase("http://127.0.0.1:9999/api/lines/orchestrate");
    s.orchestrator = o;
    const p = s.store.create({ name:"F16Evict", docsPath:docs });
    p.follow = false; s.store.save();
    s.writeDoc(p, "wal-evict", F.setFront(F.initialLine({ title:"WAL Evict", status:"working", steps:[F.askStep({ words:"Run" }), F.workStep({ who:"fake" })] }), { orchestrator:"yes" }));
    const pass = o.env(p, "wal-evict", F.parseLine(s.readDoc(p, "wal-evict"))).PENECHO_ORCH_PASS;
    const pendingArgs = { do:"create-line", task:"Must stay pending", agent:fp.id, kind:"code", run:false };
    const pendingOpId = "op-oldest-pending-0001";
    const pendingKey = `${p.id}/wal-evict/${pendingOpId}`;
    const opsFile = path.join(dir, "orchestrator", "ops.json");
    fs.mkdirSync(path.dirname(opsFile), { recursive:true });
    const seeded = { [pendingKey]:{ state:"pending", at:1000, fp:F.hashText(JSON.stringify(pendingArgs)) } };
    for (let i = 0; i < 500; i++) {
      seeded[`${p.id}/wal-evict/op-settled-${String(i).padStart(4, "0")}`] = { state:"done", at:2000 + i, fp:`fp-${i}`, result:{ ok:true } };
    }
    fs.writeFileSync(opsFile, JSON.stringify(seeded));
    o.reload();
    // Execute two new mutating ops so saveOps runs with >500 settled records.
    await o.agentCall(pass, { do:"create-line", task:"Settled draft 1", agent:fp.id, kind:"code", run:false }, null, { opId:"op-new-settled-1" });
    await o.agentCall(pass, { do:"create-line", task:"Settled draft 2", agent:fp.id, kind:"code", run:false }, null, { opId:"op-new-settled-2" });
    const savedOps = JSON.parse(fs.readFileSync(opsFile, "utf8"));
    assert.ok(savedOps[pendingKey], "unresolved pending WAL record must NEVER be evicted by newer settled receipts");
    assert.equal(savedOps[pendingKey].state, "pending");
    const settledCount = Object.values(savedOps).filter(v => v.state !== "pending").length;
    assert.equal(settledCount, 500, "settled receipts remain bounded at OPS_MOST (500)");
    await assert.rejects(o.agentCall(pass, pendingArgs, null, { opId:pendingOpId }), { code:"AMBIGUOUS_OUTCOME" }, "preserved pending WAL record still rejects replay");
  }
});

test("Round 5 F1, F2, F10, F14, F17, F22: processTable failure fails Stop closed, unterminated Codex frame surfaces protocol error, legacy gen-0 upgrades cleanly, strict F10 identity, stale endRun fenced, and purge EIO aborts Delete", async t => {
  const { spawn } = require("node:child_process");
  const { KeptChild } = require("../src/server/project-lines/kept-child.js");
  const { CodexServer, followTurn } = require("../src/server/project-lines/codex-server.js");
  const RunWatch = require("../src/server/project-lines/run-watch.js");
  const root = makeRoot(t, "r5-all-");
  const script = makeFakeAgentScript(root);

  // 1) P0 · F2: Two-lane real-keeper Stop when processTable() fails MUST fail closed with STOP_FAILED,
  //    retain both reservations in heldWorks & active-runs.json, block Retry (409 BUSY), and succeed once processTable recovers!
  {
    const dir = path.join(root, "s-f2-disc"), docs = path.join(root, "docs-f2-disc");
    fs.mkdirSync(dir, { recursive:true });
    const d1File = path.join(root, "r5-d1.pid"), d2File = path.join(root, "r5-d2.pid");
    const descScript = path.join(root, "r5-desc.js");
    fs.writeFileSync(descScript, `const fs = require("node:fs"); process.on("SIGTERM", () => {}); fs.writeFileSync(process.argv[2], String(process.pid)); setInterval(() => {}, 1000);`);
    const parentScript = path.join(root, "r5-parent.js");
    fs.writeFileSync(parentScript, `const { spawn } = require("node:child_process"); spawn(process.execPath, [${JSON.stringify(descScript)}, process.env.DESC_FILE], { stdio:"ignore", detached:true }); process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1000);`);
    let n = 0;
    const ag = {
      available:() => [{ id:"fake", name:"Fake", available:true, runs:true }],
      nameOf:() => "Fake",
      command:(_id, opts) => ({ command:process.execPath, args:[parentScript], cwd:opts.workdir, env:{ DESC_FILE:++n === 1 ? d1File : d2File } }),
    };
    const s = new Service({ directory:dir, agents:ag, autoWatch:false, stopGraceMs:300, stopKillMs:500 });
    t.after(() => s.close());
    const p = s.store.create({ name:"R5F2", docsPath:docs });
    p.follow = false; s.store.save();

    const created = await s.createTopic(p, { text:"Lane 1", agent:"fake", start:true });
    await until(() => fs.existsSync(d1File), "lane 1 desc");
    const d1 = Number(fs.readFileSync(d1File, "utf8").trim());
    t.after(() => { try { process.kill(d1, "SIGKILL"); } catch {} });
    await s.addAgentTask(p, created.slug, { text:"Lane 2", agent:"fake", parallel:true });
    await until(() => fs.existsSync(d2File), "lane 2 desc");
    const d2 = Number(fs.readFileSync(d2File, "utf8").trim());
    t.after(() => { try { process.kill(d2, "SIGKILL"); } catch {} });

    const isAlive = pid => { try { process.kill(pid, 0); return !RunWatch.processMeta?.(pid)?.zombie; } catch { return false; } };
    const origTable = RunWatch.processTable;
    RunWatch.processTable = async () => null;
    try {
      await assert.rejects(s.act(p, created.slug, "stop"), { code:"STOP_FAILED" }, "Stop MUST fail closed when process enumeration fails");
      assert.equal(s.heldWorks(p, created.slug).length, 2, "both lane reservations preserved after failed discovery");
      const activeAfterFail = JSON.parse(fs.readFileSync(s.activeFile, "utf8"));
      assert.equal(activeAfterFail.length, 2, "active-runs.json preserves both reservations");
      assert.ok(activeAfterFail.every(e => e.stopping === true), "both persisted reservations marked stopping");
      await assert.rejects(s.act(p, created.slug, "retry", { step:"work-2" }), { code:"BUSY" }, "Retry blocked while Stop failed discovery");
      await assert.rejects(s.act(p, created.slug, "retry"), { code:"BUSY" }, "generic Retry blocked while Stop failed discovery");
    } finally {
      RunWatch.processTable = origTable;
    }
    // Once process discovery recovers, a second Stop enumerates both intact trees and terminates BOTH descendants cleanly!
    await s.act(p, created.slug, "stop");
    assert.equal(isAlive(d1), false, "lane 1 descendant terminated on recovery Stop");
    assert.equal(isAlive(d2), false, "lane 2 descendant terminated on recovery Stop");
    assert.equal(s.heldWorks(p, created.slug).length, 0);
    assert.equal(JSON.parse(fs.readFileSync(s.activeFile, "utf8")).length, 0);
  }

  // 2) P0 · F1: Unterminated valid turn/start JSON without trailing `\n` in keeper input MUST surface explicit protocol error (never wait forever)!
  {
    const kd = path.join(root, "keep-no-newline");
    fs.mkdirSync(kd, { recursive:true });
    fs.writeFileSync(path.join(kd, "pid.json"), JSON.stringify({ keeper:process.pid, agent:process.pid }));
    // Complete JSON object for turn/start, but MISSING the trailing `\n` delimiter required by Codex stdio!
    fs.writeFileSync(path.join(kd, "input"),
      `${JSON.stringify({ id:1, method:"initialize", params:{} })}\n${JSON.stringify({ method:"initialized" })}\n${JSON.stringify({ id:2, method:"thread/start", params:{} })}\n`
      + JSON.stringify({ id:3, method:"turn/start", params:{ threadId:"thr-nnl", input:[{ type:"text", text:"partial" }] } })
    );
    fs.writeFileSync(path.join(kd, "out"), `${JSON.stringify({ id:1, result:{} })}\n${JSON.stringify({ id:2, result:{ thread:{ id:"thr-nnl" } } })}\n`);
    const child = new KeptChild(kd);
    const srv = new CodexServer({ child });
    const outcome = await followTurn(srv, {
      threadId:"thr-nnl",
      phase:"starting-turn",
      input:"partial",
      readInput:() => fs.readFileSync(path.join(kd, "input"), "utf8"),
    });
    assert.equal(outcome.code, 1, "unterminated turn/start frame must settle with error instead of waiting forever");
    assert.equal(outcome.protocol, true, "unterminated turn/start frame reports explicit protocol error");
    child.detach();
  }

  // 3) P1 · F17: Upgrading a working Round-4 generation-0 coordinator preserves its valid legacy pass while keeping already-stopped gen-0 rejected!
  {
    const dir = path.join(root, "s-f17-upg"), docs = path.join(root, "docs-f17-upg");
    fs.mkdirSync(path.join(dir, "orchestrator"), { recursive:true });
    const presets = createAgentPresets({ file:path.join(dir, "agent-presets.json"), agents:fakeAgents(script) });
    const fp = presets.add({ name:"Fake", agent:"fake", model:"", effort:"", inPicker:true, forOrchestrator:true });
    const s = new Service({ directory:dir, agents:fakeAgents(script), autoWatch:false });
    s.presets = presets;
    t.after(() => s.close());
    const p = s.store.create({ name:"R5Upg", docsPath:docs });
    p.follow = false; s.store.save();
    s.writeDoc(p, "working-gen0", F.setFront(F.initialLine({ title:"Working Gen0", status:"working", steps:[F.askStep({ words:"Coord" }), F.workStep({ who:"fake" })] }), { id:"PE-950", orchestrator:"yes" }));
    s.writeDoc(p, "stopped-gen0", F.setFront(F.initialLine({ title:"Stopped Gen0", status:"stopped", steps:[F.askStep({ words:"Coord" }), { ...F.workStep({ who:"fake" }), done:true, off:"stopped" }] }), { id:"PE-951", orchestrator:"yes" }));
    // Seed Round 4 state: working-gen0 has gen:0 with NO entry in generations.json; stopped-gen0 has gen:0 with generations.json=1.
    fs.writeFileSync(path.join(dir, "orchestrator", "passes.json"), JSON.stringify({
      "legacy-working-pass":{ projectId:p.id, slug:"working-gen0", gen:0 },
      "legacy-stopped-pass":{ projectId:p.id, slug:"stopped-gen0", gen:0 },
    }));
    fs.writeFileSync(path.join(dir, "orchestrator", "generations.json"), JSON.stringify({
      [`${p.id}/stopped-gen0`]:1,
    }));
    const o = createOrchestrator({ service:s, directory:dir });
    o.setBase("http://127.0.0.1:9999/api/lines/orchestrate");
    s.orchestrator = o;

    const helpRes = await o.agentCall("legacy-working-pass", { do:"help" });
    assert.ok(Array.isArray(helpRes.functions));
    const draftRes = await o.agentCall("legacy-working-pass", { do:"create-line", task:"Draft after upgrade", agent:fp.id, kind:"code", run:false });
    assert.equal(draftRes.started, false, "working generation-0 coordinator MUST create drafts after upgrade");
    assert.ok(draftRes.line, "draft Line created");
    await assert.rejects(o.agentCall("legacy-stopped-pass", { do:"create-line", task:"Must fail", agent:fp.id, kind:"code", run:false }), { code:"NO_PASS" }, "already-stopped gen-0 pass stays rejected after upgrade");
    // Stopping working-gen0 NOW invalidates its migrated legacy pass cleanly.
    await s.act(p, "working-gen0", "stop");
    await assert.rejects(o.agentCall("legacy-working-pass", { do:"create-line", task:"After stop", agent:fp.id, kind:"code", run:false }), { code:"NO_PASS" });
  }

  // 4) F10: Strict per-PID birth-time (±2s) & full-command validation rejects reused same-executable PID (10s later / different args),
  //    while tracked descendant PID without metadata returns `unknown` (retained, NOT falsely discarded against root)!
  {
    const dir = path.join(root, "s-f10-r5"), docs = path.join(root, "docs-f10-r5");
    fs.mkdirSync(dir, { recursive:true });
    const s = new Service({ directory:dir, agents:fakeAgents(script), autoWatch:false });
    t.after(() => s.close());
    const p = s.store.create({ name:"R5F10", docsPath:docs });
    p.follow = false; s.store.save();
    const sleeper = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio:"ignore", detached:true });
    t.after(() => { try { process.kill(sleeper.pid, "SIGKILL"); } catch {} });
    const origMeta = RunWatch.processMeta;
    const t0 = Date.now() - 10 * 60_000;
    try {
      // (a) Same executable born 10s later with different arguments -> MISMATCH!
      RunWatch.processMeta = pid => pid === sleeper.pid
        ? { pid:sleeper.pid, ppid:1, pgid:sleeper.pid, zombie:false, startedAt:t0 + 10_000, command:"/usr/bin/node unrelated-task.js" }
        : origMeta(pid);
      const recEntry = {
        key:s.key(p, "l1"), stepId:"work-1", agent:"fake", pid:999998, started:t0,
        pids:[999998, sleeper.pid],
        procs:[{ pid:sleeper.pid, pgid:sleeper.pid, startedAt:t0, command:"/usr/bin/node helper-a.js" }],
      };
      assert.equal(s.identifyOrphanPid(sleeper.pid, recEntry), "mismatch", "same executable born 10s later with different args is PID reuse (mismatch)");

      // (b) Same executable at exact same second but different arguments -> MISMATCH!
      RunWatch.processMeta = pid => pid === sleeper.pid
        ? { pid:sleeper.pid, ppid:1, pgid:sleeper.pid, zombie:false, startedAt:t0, command:"/usr/bin/node unrelated-task.js" }
        : origMeta(pid);
      assert.equal(s.identifyOrphanPid(sleeper.pid, recEntry), "mismatch", "different arguments to same executable is mismatch");

      // (c) Tracked descendant PID recorded WITHOUT per-PID procs metadata, born 5 minutes after root -> `unknown` (retained, NOT discarded)!
      RunWatch.processMeta = pid => pid === sleeper.pid
        ? { pid:sleeper.pid, ppid:1, pgid:sleeper.pid, zombie:false, startedAt:t0 + 5 * 60_000, command:"/usr/bin/python3 late-helper.py" }
        : origMeta(pid);
      const noMetaEntry = { key:s.key(p, "l1"), stepId:"work-1", agent:"fake", pid:999998, started:t0, pids:[999998, sleeper.pid] };
      assert.equal(s.identifyOrphanPid(sleeper.pid, noMetaEntry), "unknown", "later-born tracked descendant without procRec returns unknown instead of falling back to root mismatch");
      assert.deepEqual(s.orphanPidsOf(noMetaEntry), [sleeper.pid], "later-born helper without procRec is retained as unresolved owner");
    } finally {
      RunWatch.processMeta = origMeta;
    }
  }

  // 5) F14: Delayed endRun from an older failed lane with ZERO live owners must NOT flip completed replacement Work step to stopped!
  {
    const dir = path.join(root, "s-f14-endrun"), docs = path.join(root, "docs-f14-endrun");
    fs.mkdirSync(dir, { recursive:true });
    const s = new Service({ directory:dir, agents:fakeAgents(script), autoWatch:false });
    t.after(() => s.close());
    const p = s.store.create({ name:"R5F14", docsPath:docs });
    p.follow = false; s.store.save();
    s.writeDoc(p, "lane-stale", F.initialLine({
      title:"Lane Stale", status:"done",
      steps:[
        F.askStep({ words:"Primary" }), { ...F.workStep({ who:"fake" }), done:true, took:"1 min" },
        F.askStep({ words:"Lane" }), { ...F.workStep({ who:"fake" }), done:true, took:"1 min" },
      ],
    }));
    await s.closeDetail(p, "lane-stale", "work-2", { result:"Replacement L2 answer", took:"1 min", launchId:"launch-L2" });
    assert.equal(s.heldWorks(p, "lane-stale").length, 0);
    // Simulate delayed failed endRun from old attempt launch-L1 on lane work-2.
    await s.endRun(p, "lane-stale", {
      agent:"fake", stepId:"work-2", step:"Work 2", kind:"work", lane:true, launchId:"launch-L1",
      started:Date.now() - 5000, buffer:"", tail:"old failure", failed:"old failure", said:"", stopping:false,
    }, 1);
    const afterDoc = F.parseLine(s.readDoc(p, "lane-stale"));
    const w2 = afterDoc.steps.find(x => x.id === "work-2");
    assert.equal(w2.done, true);
    assert.ok(!w2.off, `delayed stale endRun MUST NOT flip completed replacement work-2 to off=${w2.off}`);
    const detail = s.store.readText(p, F.detailPath("lane-stale", "work-2")).text;
    assert.match(detail, /Replacement L2 answer/);
    assert.equal(F.splitFront(detail).front["launch id"], "launch-L2");
  }

  // 6) F22: Injected EIO persisting generation purge MUST abort Delete (preventing 2->2 generation reuse),
  //    AND removing a cached v2 pass from passes.json on disk unconditionally revokes it in agentCall!
  {
    const dir = path.join(root, "s-f22-eio"), docs = path.join(root, "docs-f22-eio");
    fs.mkdirSync(dir, { recursive:true });
    const s = new Service({ directory:dir, agents:fakeAgents(script), autoWatch:false });
    t.after(() => s.close());
    const o = createOrchestrator({ service:s, directory:dir });
    o.setBase("http://127.0.0.1:9999/api/lines/orchestrate");
    s.orchestrator = o;
    const p = s.store.create({ name:"R5F22", docsPath:docs });
    p.follow = false; s.store.save();

    s.writeDoc(p, "eio-parent", F.setFront(F.initialLine({ title:"EIO Parent", status:"working", steps:[F.askStep({ words:"Go" }), F.workStep({ who:"fake" })] }), { id:"PE-960", orchestrator:"yes" }));
    const cachedPass = o.env(p, "eio-parent", F.parseLine(s.readDoc(p, "eio-parent"))).PENECHO_ORCH_PASS;
    // Unconditional revocation on disk absence even while cached in memory!
    const passesFile = path.join(dir, "orchestrator", "passes.json");
    fs.writeFileSync(passesFile, "{}");
    await assert.rejects(o.agentCall(cachedPass, { do:"help" }), { code:"PARENT_STOPPED" }, "v2 pass removed from passes.json on disk MUST be revoked even on in-memory cache hit");

    // Re-issue active pass, Stop parent, then inject EIO on generations.json rename during Delete -> Delete MUST fail cleanly!
    const activePass = o.env(p, "eio-parent", F.parseLine(s.readDoc(p, "eio-parent"))).PENECHO_ORCH_PASS;
    assert.ok(activePass);
    await s.act(p, "eio-parent", "stop");
    const gensFile = path.join(dir, "orchestrator", "generations.json");
    const hash = s.store.readText(p, "lines/eio-parent.md").hash;
    const origRename = fs.renameSync;
    fs.renameSync = (from, to) => {
      if (String(to) === gensFile) throw Object.assign(new Error("simulated purge EIO"), { code:"EIO" });
      return origRename.call(fs, from, to);
    };
    try {
      await assert.rejects(s.act(p, "eio-parent", "delete", { confirm:"eio-parent", baseHash:hash }), { code:"EIO" }, "EIO persisting generation purge MUST abort Delete");
    } finally {
      fs.renameSync = origRename;
    }
    assert.equal(s.isLine(p, "eio-parent"), true, "Line was NOT deleted when generation purge failed with EIO");
  }
});

test("Round 6 F2, F10, F14, F17, F22: successor stopOrphans kills detached helpers after failed discovery handoff, strict two-factor F10, settled replacement fences Stop, crash-safe F17 migration and F22 pass-EIO fence preservation", async t => {
  const { spawn } = require("node:child_process");
  const RunWatch = require("../src/server/project-lines/run-watch.js");
  const root = makeRoot(t, "r6-all-");
  const script = makeFakeAgentScript(root);

  // 1) P0 · F2: Failed process discovery Stop on Service 1 -> handoff to Service 2 -> Service 2 discovers & kills BOTH detached helpers!
  {
    const dir = path.join(root, "s-r6-f2"), docs = path.join(root, "docs-r6-f2");
    fs.mkdirSync(dir, { recursive:true });
    const d1File = path.join(root, "r6-d1.pid"), d2File = path.join(root, "r6-d2.pid");
    const descScript = path.join(root, "r6-desc.js");
    fs.writeFileSync(descScript, `const fs = require("node:fs"); process.on("SIGTERM", () => {}); fs.writeFileSync(process.argv[2], String(process.pid)); setInterval(() => {}, 1000);`);
    const parentScript = path.join(root, "r6-parent.js");
    fs.writeFileSync(parentScript, `const { spawn } = require("node:child_process"); spawn(process.execPath, [${JSON.stringify(descScript)}, process.env.DESC_FILE], { stdio:"ignore", detached:true }); process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1000);`);
    let n = 0;
    const makeAg = () => ({
      available:() => [{ id:"fake", name:"Fake", available:true, runs:true }],
      nameOf:() => "Fake",
      command:(_id, opts) => ({ command:process.execPath, args:[parentScript], cwd:opts.workdir, env:{ DESC_FILE:++n === 1 ? d1File : d2File } }),
    });
    const s1 = new Service({ directory:dir, agents:makeAg(), autoWatch:false, stopGraceMs:300, stopKillMs:500 });
    const p1 = s1.store.create({ name:"R6F2", docsPath:docs });
    p1.follow = false; s1.store.save();

    const created = await s1.createTopic(p1, { text:"Lane 1", agent:"fake", start:true });
    await until(() => fs.existsSync(d1File), "r6 lane 1 desc");
    const d1 = Number(fs.readFileSync(d1File, "utf8").trim());
    t.after(() => { try { process.kill(d1, "SIGKILL"); } catch {} });
    await s1.addAgentTask(p1, created.slug, { text:"Lane 2", agent:"fake", parallel:true });
    await until(() => fs.existsSync(d2File), "r6 lane 2 desc");
    const d2 = Number(fs.readFileSync(d2File, "utf8").trim());
    t.after(() => { try { process.kill(d2, "SIGKILL"); } catch {} });

    const isAlive = pid => { try { process.kill(pid, 0); return !RunWatch.processMeta?.(pid)?.zombie; } catch { return false; } };
    const origTable = RunWatch.processTable;
    RunWatch.processTable = async () => null;
    try {
      await assert.rejects(s1.act(p1, created.slug, "stop"), { code:"STOP_FAILED" }, "Service 1 Stop fails closed when process discovery is down");
    } finally {
      RunWatch.processTable = origTable;
    }
    // Hand off ownership from Service 1 to Service 2!
    s1.close();
    const s2 = new Service({ directory:dir, agents:makeAg(), autoWatch:false, recoverOnStart:true, stopGraceMs:300, stopKillMs:500 });
    t.after(() => s2.close());
    const p2 = s2.store.get(p1.id);
    assert.equal(s2.orphansOf(p2, created.slug).length, 2, "successor recovered both stopping orphan reservations");
    await assert.rejects(s2.act(p2, created.slug, "retry", { step:"work-2" }), { code:"BUSY" }, "successor blocks Retry while orphans remain");

    // While processTable fails on successor too, Stop still fails closed without clearing reservations!
    RunWatch.processTable = async () => null;
    try {
      await assert.rejects(s2.act(p2, created.slug, "stop"), { code:"STOP_FAILED" }, "successor Stop fails closed when discovery is still down");
      assert.equal(s2.orphansOf(p2, created.slug).length, 2);
    } finally {
      RunWatch.processTable = origTable;
    }
    // Once discovery recovers on successor, Stop discovers & terminates BOTH detached helpers and clears active-runs.json!
    await s2.act(p2, created.slug, "stop");
    assert.equal(isAlive(d1), false, "successor Stop terminated lane 1 detached helper");
    assert.equal(isAlive(d2), false, "successor Stop terminated lane 2 detached helper");
    assert.equal(s2.orphansOf(p2, created.slug).length, 0);
    assert.equal(JSON.parse(fs.readFileSync(s2.activeFile, "utf8")).length, 0);
  }

  // 2) P1 · F17: Interrupted gen-0 migration on BOTH passes.json EIO AND generations.json EIO recovers cleanly without mistaking working parent for stopped!
  {
    const dir = path.join(root, "s-r6-f17"), docs = path.join(root, "docs-r6-f17");
    fs.mkdirSync(path.join(dir, "orchestrator"), { recursive:true });
    const presets = createAgentPresets({ file:path.join(dir, "agent-presets.json"), agents:fakeAgents(script) });
    const fp = presets.add({ name:"Fake", agent:"fake", model:"", effort:"", inPicker:true, forOrchestrator:true });
    const s = new Service({ directory:dir, agents:fakeAgents(script), autoWatch:false });
    s.presets = presets;
    t.after(() => s.close());
    const p = s.store.create({ name:"R6F17", docsPath:docs });
    p.follow = false; s.store.save();
    s.writeDoc(p, "mig-a", F.setFront(F.initialLine({ title:"Mig A", status:"working", steps:[F.askStep({ words:"Go" }), F.workStep({ who:"fake" })] }), { id:"PE-970", orchestrator:"yes" }));
    s.writeDoc(p, "mig-b", F.setFront(F.initialLine({ title:"Mig B", status:"working", steps:[F.askStep({ words:"Go" }), F.workStep({ who:"fake" })] }), { id:"PE-971", orchestrator:"yes" }));
    const passesFile = path.join(dir, "orchestrator", "passes.json");
    const gensFile = path.join(dir, "orchestrator", "generations.json");

    // (a) EIO writing passes.json during migration must NOT write generations.json=1; once restored, migration succeeds!
    fs.writeFileSync(passesFile, JSON.stringify({ "legacy-a":{ projectId:p.id, slug:"mig-a", gen:0 } }));
    const origRename = fs.renameSync;
    fs.renameSync = (from, to) => {
      if (String(to) === passesFile) throw Object.assign(new Error("passes EIO"), { code:"EIO" });
      return origRename.call(fs, from, to);
    };
    let o1;
    try {
      o1 = createOrchestrator({ service:s, directory:dir });
    } finally {
      fs.renameSync = origRename;
    }
    assert.equal(fs.existsSync(gensFile), false, "passes.json EIO must NOT leave half-migrated generations.json=1 on disk");
    o1.setBase("http://127.0.0.1:9999/api/lines/orchestrate");
    s.orchestrator = o1;
    const helpA = await o1.agentCall("legacy-a", { do:"help" });
    assert.ok(Array.isArray(helpA.functions), "legacy-a works once storage recovers");
    const draftA = await o1.agentCall("legacy-a", { do:"create-line", task:"After passes EIO", agent:fp.id, kind:"code", run:false });
    assert.ok(draftA.line, "legacy-a creates draft cleanly after recovering from passes.json EIO");

    // (b) EIO writing generations.json after passes.json upgraded to gen>=1 -> next load adopts gen>=1 and flushes cleanly!
    const curPasses = JSON.parse(fs.readFileSync(passesFile, "utf8"));
    curPasses["legacy-b"] = { projectId:p.id, slug:"mig-b", gen:0 };
    fs.writeFileSync(passesFile, JSON.stringify(curPasses));
    fs.renameSync = (from, to) => {
      if (String(to) === gensFile) throw Object.assign(new Error("gens EIO"), { code:"EIO" });
      return origRename.call(fs, from, to);
    };
    try {
      createOrchestrator({ service:s, directory:dir });
    } finally {
      fs.renameSync = origRename;
    }
    const o2 = createOrchestrator({ service:s, directory:dir });
    o2.setBase("http://127.0.0.1:9999/api/lines/orchestrate");
    s.orchestrator = o2;
    const draftB = await o2.agentCall("legacy-b", { do:"create-line", task:"After gens EIO", agent:fp.id, kind:"code", run:false });
    assert.ok(draftB.line, "legacy-b creates draft cleanly after recovering from generations.json EIO");
  }

  // 3) F10: Partial procRec (empty command OR missing startedAt) MUST return "unknown" (never "match")!
  {
    const dir = path.join(root, "s-r6-f10"), docs = path.join(root, "docs-r6-f10");
    fs.mkdirSync(dir, { recursive:true });
    const s = new Service({ directory:dir, agents:fakeAgents(script), autoWatch:false });
    t.after(() => s.close());
    const p = s.store.create({ name:"R6F10", docsPath:docs });
    p.follow = false; s.store.save();
    const sleeper = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio:"ignore", detached:true });
    t.after(() => { try { process.kill(sleeper.pid, "SIGKILL"); } catch {} });
    const origMeta = RunWatch.processMeta;
    const t0 = Date.now() - 5000;
    RunWatch.processMeta = pid => pid === sleeper.pid
      ? { pid:sleeper.pid, ppid:1, pgid:sleeper.pid, zombie:false, startedAt:t0, command:"/usr/bin/node helper.js" }
      : origMeta(pid);
    try {
      const onlyTime = { key:s.key(p, "l"), stepId:"work-1", pid:999997, started:t0, pids:[sleeper.pid], procs:[{ pid:sleeper.pid, startedAt:t0, command:"" }] };
      const onlyCmd = { key:s.key(p, "l"), stepId:"work-1", pid:999997, started:t0, pids:[sleeper.pid], procs:[{ pid:sleeper.pid, startedAt:0, command:"/usr/bin/node helper.js" }] };
      const rootNoCmd = { key:s.key(p, "l"), stepId:"work-1", pid:sleeper.pid, started:t0 };
      assert.equal(s.identifyOrphanPid(sleeper.pid, onlyTime), "unknown", "matching birth time alone with empty command MUST be unknown");
      assert.equal(s.identifyOrphanPid(sleeper.pid, onlyCmd), "unknown", "matching command alone with absent birth time MUST be unknown");
      assert.equal(s.identifyOrphanPid(sleeper.pid, rootNoCmd), "unknown", "root record lacking expected command MUST be unknown");
    } finally {
      RunWatch.processMeta = origMeta;
    }
  }

  // 4) F14: Settled replacement (with its own failure reason and zero live owners) while old Stop awaits termination prevents old Stop from overwriting Line reason/questions!
  {
    const dir = path.join(root, "s-r6-f14"), docs = path.join(root, "docs-r6-f14");
    fs.mkdirSync(dir, { recursive:true });
    const s = new Service({ directory:dir, agents:fakeAgents(script), autoWatch:false });
    t.after(() => s.close());
    const p = s.store.create({ name:"R6F14", docsPath:docs });
    p.follow = false; s.store.save();
    s.writeDoc(p, "settled-rep", F.initialLine({ title:"Settled Rep", status:"working", steps:[F.askStep({ words:"mode:slow Go" }), F.workStep({ who:"fake" })] }));
    const initDoc = F.parseLine(s.readDoc(p, "settled-rep"));
    await s.launch(p, "settled-rep", initDoc.steps.find(x => x.id === "work-1"), initDoc);
    let releaseStop, stoppedChild;
    const origStopTree = s.stopTree;
    s.stopTree = child => new Promise(resolve => { stoppedChild = child; releaseStop = () => { try { child.kill("SIGKILL"); } catch {} resolve(0); }; });
    const stopP = s.act(p, "settled-rep", "stop");
    await until(() => typeof releaseStop === "function", "old Stop paused in stopTree");
    // While old Stop awaits termination, replacement attempt L2 records its launch in manifest + detail and settles with its own failure reason and zero live owners!
    const TaskContext = require("../src/server/project-lines/task-context.js");
    const mRel = TaskContext.manifestFile("settled-rep", "work-1");
    const manifests = JSON.parse(s.store.readText(p, mRel).text);
    manifests.attempts.push({ id:"launch-L2-settled", workId:"work-1", at:Date.now() });
    s.store.writeText(p, mRel, JSON.stringify(manifests));
    s.recordStart(p, "settled-rep", initDoc.steps.find(x => x.id === "work-1"), { prompt:"Replacement L2", launchId:"launch-L2-settled" });
    const wroteL2 = await s.closeDetail(p, "settled-rep", "work-1", { stopped:"Replacement API timeout", why:"error", result:"Partial L2", launchId:"launch-L2-settled" });
    assert.equal(wroteL2, true, "replacement L2 wrote its own detail");
    s.writeDoc(p, "settled-rep", F.setFront(F.updateSteps(s.readDoc(p, "settled-rep"), steps => {
      const w = steps.find(x => x.id === "work-1");
      if (w) { w.done = true; w.off = "stopped"; }
    }), { status:"stopped", why:"Replacement API timeout" }));
    releaseStop();
    s.stopTree = origStopTree;
    await stopP;
    if (stoppedChild) await until(() => stoppedChild.closed, "keeper child exited before cleanup", 2000).catch(() => {});
    const finalDoc = F.parseLine(s.readDoc(p, "settled-rep"));
    assert.equal(finalDoc.front.why, "Replacement API timeout", "old Stop MUST NOT overwrite settled replacement's Line reason with 'Stopped by you'");
    const detailText = s.store.readText(p, F.detailPath("settled-rep", "work-1")).text;
    assert.match(detailText, /Replacement API timeout/);
    assert.equal(F.splitFront(detailText).front["launch id"], "launch-L2-settled");
  }

  // 5) F22: With passes.json writes failing (EIO), Stop advances fence to 2 leaving old gen-1 pass on disk; Delete fails EIO AND preserves per-Line fence=2!
  {
    const dir = path.join(root, "s-r6-f22"), docs = path.join(root, "docs-r6-f22");
    fs.mkdirSync(dir, { recursive:true });
    const s = new Service({ directory:dir, agents:fakeAgents(script), autoWatch:false });
    t.after(() => s.close());
    const o = createOrchestrator({ service:s, directory:dir });
    o.setBase("http://127.0.0.1:9999/api/lines/orchestrate");
    s.orchestrator = o;
    const p = s.store.create({ name:"R6F22", docsPath:docs });
    p.follow = false; s.store.save();

    s.writeDoc(p, "fence-eio", F.setFront(F.initialLine({ title:"Fence EIO", status:"working", steps:[F.askStep({ words:"Go" }), F.workStep({ who:"fake" })] }), { id:"PE-980", orchestrator:"yes" }));
    const oldPass = o.env(p, "fence-eio", F.parseLine(s.readDoc(p, "fence-eio"))).PENECHO_ORCH_PASS;
    const passesFile = path.join(dir, "orchestrator", "passes.json");
    const gensFile = path.join(dir, "orchestrator", "generations.json");
    const origRename = fs.renameSync;
    fs.renameSync = (from, to) => {
      if (String(to) === passesFile) throw Object.assign(new Error("passes write EIO"), { code:"EIO" });
      return origRename.call(fs, from, to);
    };
    try {
      // Stop bumps generations.json fence to 2 while leaving old gen-1 pass in passes.json (best-effort pass pruning hit EIO).
      await s.act(p, "fence-eio", "stop");
      const gensAfterStop = JSON.parse(fs.readFileSync(gensFile, "utf8"));
      assert.equal(gensAfterStop[`${p.id}/fence-eio`], 2, "Stop durably advanced per-Line fence to 2");
      // Delete hits EIO removing passes.json -> MUST abort Delete AND preserve per-Line fence=2 in generations.json!
      const hash = s.store.readText(p, "lines/fence-eio.md").hash;
      await assert.rejects(s.act(p, "fence-eio", "delete", { confirm:"fence-eio", baseHash:hash }), { code:"EIO" }, "Delete aborts on passes.json EIO");
      assert.equal(s.isLine(p, "fence-eio"), true, "Line retained when pass removal fails");
      const gensAfterFailedDel = JSON.parse(fs.readFileSync(gensFile, "utf8"));
      assert.equal(gensAfterFailedDel[`${p.id}/fence-eio`], 2, "per-Line revocation fence MUST remain intact while old pass stays on disk");
    } finally {
      fs.renameSync = origRename;
    }
    await assert.rejects(o.agentCall(oldPass, { do:"help" }), { code:"PARENT_STOPPED" }, "old gen-1 pass stays rejected by preserved fence=2");
  }
});

test("Round 7 F2, F10, F14, F17, F22: failed-discovery reservation survives root exit, env() retries failed gen-0 migration, strict root executable check, legacy absent-to-present launchId replacement, and ELOOP pass path preserves fence", async t => {
  const { spawn } = require("node:child_process");
  const RunWatch = require("../src/server/project-lines/run-watch.js");
  const root = makeRoot(t, "r7-all-");
  const script = makeFakeAgentScript(root);

  // 1) P0 · F2: After failed discovery Stop + handoff, if one root exits BEFORE the next Stop while its detached helper
  //    is still alive, Stop MUST keep that lane's reservation unresolved (STOP_FAILED), checkLeftRunning MUST NOT clear it,
  //    and Retry MUST reject 409 BUSY!
  {
    const dir = path.join(root, "s-r7-f2"), docs = path.join(root, "docs-r7-f2");
    fs.mkdirSync(dir, { recursive:true });
    const d1File = path.join(root, "r7-d1.pid"), d2File = path.join(root, "r7-d2.pid");
    const r2File = path.join(root, "r7-r2.pid");
    const descScript = path.join(root, "r7-desc.js");
    fs.writeFileSync(descScript, `const fs = require("node:fs"); process.on("SIGTERM", () => {}); fs.writeFileSync(process.argv[2], String(process.pid)); setInterval(() => {}, 1000);`);
    const parentScript = path.join(root, "r7-parent.js");
    fs.writeFileSync(parentScript, `
const fs = require("node:fs");
const { spawn } = require("node:child_process");
if (process.env.ROOT_FILE) fs.writeFileSync(process.env.ROOT_FILE, String(process.pid));
spawn(process.execPath, [${JSON.stringify(descScript)}, process.env.DESC_FILE], { stdio:"ignore", detached:true });
process.on("SIGTERM", () => process.exit(0));
process.on("SIGUSR1", () => process.exit(0));
setInterval(() => {}, 1000);
`);
    let n = 0;
    const makeAg = () => ({
      available:() => [{ id:"fake", name:"Fake", available:true, runs:true }],
      nameOf:() => "Fake",
      command:(_id, opts) => {
        const idx = ++n;
        return { command:process.execPath, args:[parentScript], cwd:opts.workdir, env:{ DESC_FILE:idx === 1 ? d1File : d2File, ...(idx === 2 ? { ROOT_FILE:r2File } : {}) } };
      },
    });
    const s1 = new Service({ directory:dir, agents:makeAg(), autoWatch:false, stopGraceMs:300, stopKillMs:500 });
    const p1 = s1.store.create({ name:"R7F2", docsPath:docs });
    p1.follow = false; s1.store.save();

    const created = await s1.createTopic(p1, { text:"Lane 1", agent:"fake", start:true });
    await until(() => fs.existsSync(d1File), "r7 lane 1 desc");
    const d1 = Number(fs.readFileSync(d1File, "utf8").trim());
    t.after(() => { try { process.kill(d1, "SIGKILL"); } catch {} });
    await s1.addAgentTask(p1, created.slug, { text:"Lane 2", agent:"fake", parallel:true });
    await until(() => fs.existsSync(d2File) && fs.existsSync(r2File), "r7 lane 2 desc & root");
    const d2 = Number(fs.readFileSync(d2File, "utf8").trim());
    const r2 = Number(fs.readFileSync(r2File, "utf8").trim());
    t.after(() => { try { process.kill(d2, "SIGKILL"); } catch {} });

    const isAlive = pid => { try { process.kill(pid, 0); return !RunWatch.processMeta?.(pid)?.zombie; } catch { return false; } };
    const origTable = RunWatch.processTable;
    RunWatch.processTable = async () => null;
    try {
      await assert.rejects(s1.act(p1, created.slug, "stop"), { code:"STOP_FAILED" });
    } finally {
      RunWatch.processTable = origTable;
    }
    // Hand off to Service 2.
    s1.close();
    const s2 = new Service({ directory:dir, agents:makeAg(), autoWatch:false, recoverOnStart:true, stopGraceMs:300, stopKillMs:500 });
    t.after(() => s2.close());
    const p2 = s2.store.get(p1.id);
    assert.equal(s2.orphansOf(p2, created.slug).length, 2);

    // Root 2 now exits normally BEFORE Stop #2, leaving helper d2 alive and unaccounted!
    process.kill(r2, "SIGUSR1");
    await until(() => !isAlive(r2), "root 2 exited normally");
    assert.equal(isAlive(d2), true, "helper d2 still alive after root 2 exited");

    // Maintenance (checkLeftRunning) MUST NOT clear the failed-discovery reservation!
    s2.checkLeftRunning();
    assert.equal(s2.orphansOf(p2, created.slug).length, 2, "checkLeftRunning preserves failed-discovery reservation across root exit");

    // Stop #2 captures & kills lane 1 (root 1 + helper d1), while keeping lane 2 unresolved and returning STOP_FAILED!
    await assert.rejects(s2.act(p2, created.slug, "stop"), { code:"STOP_FAILED" }, "Stop MUST NOT report success when failed-discovery root 2 exited before capture");
    assert.equal(isAlive(d1), false, "lane 1 detached helper was discovered and stopped");
    assert.equal(s2.orphansOf(p2, created.slug).length, 1, "lane 2 failed-discovery reservation remains unresolved");
    const activeLeft = JSON.parse(fs.readFileSync(s2.activeFile, "utf8"));
    assert.equal(activeLeft.length, 1);
    assert.equal(activeLeft[0].discoveryIncomplete, true);
    s2.checkLeftRunning();
    assert.equal(s2.orphansOf(p2, created.slug).length, 1, "maintenance still refuses to clear unresolved lane 2");
    await assert.rejects(s2.act(p2, created.slug, "retry", { step:"work-2" }), { code:"BUSY" }, "Retry on work-2 blocked while failed-discovery reservation remains unresolved");
    try { process.kill(d2, "SIGKILL"); } catch {}
  }

  // 2) P1 · F17: If env() is the FIRST call after a failed passes.json migration EIO recovers, it completes migration
  //    on disk (both passes.json=1 and generations.json=1) so the returned pass works for help and create-line!
  {
    const dir = path.join(root, "s-r7-f17"), docs = path.join(root, "docs-r7-f17");
    fs.mkdirSync(path.join(dir, "orchestrator"), { recursive:true });
    const presets = createAgentPresets({ file:path.join(dir, "agent-presets.json"), agents:fakeAgents(script) });
    const fp = presets.add({ name:"Fake", agent:"fake", model:"", effort:"", inPicker:true, forOrchestrator:true });
    const s = new Service({ directory:dir, agents:fakeAgents(script), autoWatch:false });
    s.presets = presets;
    t.after(() => s.close());
    const p = s.store.create({ name:"R7F17", docsPath:docs });
    p.follow = false; s.store.save();
    s.writeDoc(p, "env-mig", F.setFront(F.initialLine({ title:"Env Mig", status:"working", steps:[F.askStep({ words:"Go" }), F.workStep({ who:"fake" })] }), { id:"PE-990", orchestrator:"yes" }));
    const passesFile = path.join(dir, "orchestrator", "passes.json");
    const gensFile = path.join(dir, "orchestrator", "generations.json");
    fs.writeFileSync(passesFile, JSON.stringify({ "legacy-env-pass":{ projectId:p.id, slug:"env-mig", gen:0 } }));

    const origRename = fs.renameSync;
    fs.renameSync = (from, to) => {
      if (String(to) === passesFile) throw Object.assign(new Error("passes EIO"), { code:"EIO" });
      return origRename.call(fs, from, to);
    };
    let o;
    try {
      o = createOrchestrator({ service:s, directory:dir });
    } finally {
      fs.renameSync = origRename;
    }
    o.setBase("http://127.0.0.1:9999/api/lines/orchestrate");
    s.orchestrator = o;

    // First call after storage recovers is env()!
    const envObj = o.env(p, "env-mig", F.parseLine(s.readDoc(p, "env-mig")));
    assert.equal(envObj.PENECHO_ORCH_PASS, "legacy-env-pass");
    const diskPasses = JSON.parse(fs.readFileSync(passesFile, "utf8"));
    const diskGens = JSON.parse(fs.readFileSync(gensFile, "utf8"));
    assert.equal(diskPasses["legacy-env-pass"].gen, 1, "env() completed passes.json migration to gen=1");
    assert.equal(diskGens[`${p.id}/env-mig`], 1, "env() persisted matching generations.json fence=1");
    const helpRes = await o.agentCall(envObj.PENECHO_ORCH_PASS, { do:"help" });
    assert.ok(Array.isArray(helpRes.functions), "migrated pass succeeds on help after env()");
    const draftRes = await o.agentCall(envObj.PENECHO_ORCH_PASS, { do:"create-line", task:"Draft via env", agent:fp.id, kind:"code", run:false });
    assert.ok(draftRes.line, "migrated pass succeeds on create-line after env()");
  }

  // 3) F10: Root fallback MUST NOT match an unrelated executable whose arguments happen to contain the expected basename!
  {
    const dir = path.join(root, "s-r7-f10"), docs = path.join(root, "docs-r7-f10");
    fs.mkdirSync(dir, { recursive:true });
    const keepDir = path.join(dir, "keep-f10");
    fs.mkdirSync(keepDir, { recursive:true });
    const s = new Service({ directory:dir, agents:fakeAgents(script), autoWatch:false });
    t.after(() => s.close());
    const p = s.store.create({ name:"R7F10", docsPath:docs });
    p.follow = false; s.store.save();
    const sleeper = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio:"ignore", detached:true });
    t.after(() => { try { process.kill(sleeper.pid, "SIGKILL"); } catch {} });
    const t0 = Date.now() - 2000;
    fs.writeFileSync(path.join(keepDir, "pid.json"), JSON.stringify({ keeper:999991, agent:sleeper.pid, command:"/usr/bin/node", at:t0 }));
    const origMeta = RunWatch.processMeta;
    try {
      // Unrelated `/usr/bin/tail -f /tmp/node.log` with same birth time MUST return "mismatch"!
      RunWatch.processMeta = pid => pid === sleeper.pid
        ? { pid:sleeper.pid, ppid:1, pgid:sleeper.pid, zombie:false, startedAt:t0, command:"/usr/bin/tail -f /tmp/node.log" }
        : origMeta(pid);
      const entry = { key:s.key(p, "l"), stepId:"work-1", pid:sleeper.pid, started:t0, keep:keepDir };
      assert.equal(s.identifyOrphanPid(sleeper.pid, entry), "mismatch", "tail -f /tmp/node.log must NOT match recorded /usr/bin/node");

      // Unrelated `/usr/bin/tail -f /tmp/agent-keeper.js` MUST also return "mismatch"!
      RunWatch.processMeta = pid => pid === sleeper.pid
        ? { pid:sleeper.pid, ppid:1, pgid:sleeper.pid, zombie:false, startedAt:t0, command:"/usr/bin/tail -f /tmp/agent-keeper.js" }
        : origMeta(pid);
      assert.equal(s.identifyOrphanPid(sleeper.pid, entry), "mismatch", "tail -f /tmp/agent-keeper.js must NOT match real keeper");

      // Genuine `/usr/bin/node /some/agent.js` with matching birth time returns "match"!
      RunWatch.processMeta = pid => pid === sleeper.pid
        ? { pid:sleeper.pid, ppid:1, pgid:sleeper.pid, zombie:false, startedAt:t0, command:"/usr/bin/node /some/agent.js" }
        : origMeta(pid);
      assert.equal(s.identifyOrphanPid(sleeper.pid, entry), "match", "genuine node executable with matching birth time returns match");
    } finally {
      RunWatch.processMeta = origMeta;
    }
  }

  // 4) F14: Legacy Work with NO original launch ID acquiring its first persisted launch ID during old Stop prevents
  //    old Stop from overwriting Line reason, removing Questions, or calling settleAfterStop!
  {
    const dir = path.join(root, "s-r7-f14"), docs = path.join(root, "docs-r7-f14");
    fs.mkdirSync(dir, { recursive:true });
    const s = new Service({ directory:dir, agents:fakeAgents(script), autoWatch:false });
    t.after(() => s.close());
    const p = s.store.create({ name:"R7F14", docsPath:docs });
    p.follow = false; s.store.save();
    s.writeDoc(p, "legacy-rep", F.initialLine({ title:"Legacy Rep", status:"working", steps:[F.askStep({ words:"Go" }), F.workStep({ who:"fake" })] }));
    // Seed a legacy in-flight run with NO launchId and NO manifest/detail launch id!
    let releaseStop;
    const origStopTree = s.stopTree;
    s.stopTree = () => new Promise(resolve => { releaseStop = () => resolve(0); });
    let settleCalled = 0;
    const origSettleAfter = s.settleAfterStop.bind(s);
    s.settleAfterStop = async (...args) => { settleCalled++; return origSettleAfter(...args); };
    const fakeChild = { pid:0, kill() {} };
    s.runs.set(s.key(p, "legacy-rep"), { agent:"fake", stepId:"work-1", step:"Work 1", kind:"work", child:fakeChild, started:Date.now(), said:"", buffer:"", tail:"", stopping:false });
    const stopP = s.act(p, "legacy-rep", "stop");
    await until(() => typeof releaseStop === "function", "legacy Stop paused in stopTree");

    // Replacement settles on work-1, writing its FIRST launch id + Line reason + Question, leaving zero live owners!
    await s.closeDetail(p, "legacy-rep", "work-1", { stopped:"Replacement needs input", why:"error", result:"Need answer", launchId:"first-launch-id" });
    const withQ = F.setAbove(F.setFront(F.updateSteps(s.readDoc(p, "legacy-rep"), steps => {
      const w = steps.find(x => x.id === "work-1");
      if (w) { w.done = true; w.off = "stopped"; }
    }), { status:"waiting", why:"Replacement needs input" }), F.QUESTIONS, "**Continue?** (@fake)\n\n- [ ] Yes");
    s.writeDoc(p, "legacy-rep", withQ);

    releaseStop();
    s.stopTree = origStopTree;
    await stopP;
    const after = F.parseLine(s.readDoc(p, "legacy-rep"));
    assert.equal(after.status, "waiting", "old Stop preserved replacement status");
    assert.equal(after.front.why, "Replacement needs input", "old Stop did NOT overwrite replacement reason with Stopped by you");
    assert.equal(after.questions.length, 1, "old Stop did NOT erase replacement question");
    assert.equal(settleCalled, 0, "old Stop did NOT call settleAfterStop after absent->present replacement");
  }

  // 5) F22: Unreadable passes.json path (e.g. symlink loop ELOOP where existsSync returns false!) MUST fail purgeLine
  //    strictly WITHOUT removing the per-Line revocation fence in generations.json!
  if (process.platform !== "win32") {
    const dir = path.join(root, "s-r7-f22"), docs = path.join(root, "docs-r7-f22");
    fs.mkdirSync(path.join(dir, "orchestrator"), { recursive:true });
    const s = new Service({ directory:dir, agents:fakeAgents(script), autoWatch:false });
    t.after(() => s.close());
    const o = createOrchestrator({ service:s, directory:dir });
    s.orchestrator = o;
    const p = s.store.create({ name:"R7F22", docsPath:docs });
    p.follow = false; s.store.save();
    const gensFile = path.join(dir, "orchestrator", "generations.json");
    const passesFile = path.join(dir, "orchestrator", "passes.json");
    fs.writeFileSync(gensFile, JSON.stringify({ [`${p.id}/eloop-line`]:2, _seq:2 }));
    // Create a self-referencing symlink (ELOOP): fs.existsSync returns false, readFileSync throws ELOOP!
    try { fs.unlinkSync(passesFile); } catch {}
    fs.symlinkSync(passesFile, passesFile);
    assert.equal(fs.existsSync(passesFile), false, "symlink loop causes existsSync to return false");
    assert.throws(() => o.purgeLine(p, "eloop-line"), { code:"ORCH_STATE_UNREADABLE" }, "purgeLine MUST fail strictly on ELOOP instead of skipping Phase 1");
    const gensAfter = JSON.parse(fs.readFileSync(gensFile, "utf8"));
    assert.equal(gensAfter[`${p.id}/eloop-line`], 2, "per-Line revocation fence=2 preserved when passes.json read hits ELOOP");
    fs.unlinkSync(passesFile);
  }
});

test("Round 8 F2 & F10: recovery preserves exited agent identity when keeper survives (blocking Retry while helper lives) and exact keeper argv rejects node --check", async t => {
  const { spawn } = require("node:child_process");
  const RunWatch = require("../src/server/project-lines/run-watch.js");
  const root = makeRoot(t, "r8-all-");
  const script = makeFakeAgentScript(root);

  // 1) P0 · F2: Failed discovery persists discoveryIncomplete; agent exits BEFORE recovery while its keeper + detached helper
  //    are still alive -> recovery MUST preserve original agentPid (NOT substitute keeper PID!), Stop MUST retain the reservation
  //    and return 409 STOP_FAILED, and Retry MUST reject 409 BUSY!
  {
    const dir = path.join(root, "s-r8-f2"), docs = path.join(root, "docs-r8-f2");
    fs.mkdirSync(dir, { recursive:true });
    const descFile = path.join(root, "r8-desc.pid");
    const descScript = path.join(root, "r8-desc.js");
    fs.writeFileSync(descScript, `const fs = require("node:fs"); process.on("SIGTERM", () => {}); fs.writeFileSync(process.argv[2], String(process.pid)); setInterval(() => {}, 1000);`);
    const agentScript = path.join(root, "r8-agent.js");
    fs.writeFileSync(agentScript, `const { spawn } = require("node:child_process"); spawn(process.execPath, [${JSON.stringify(descScript)}, process.env.DESC_FILE], { stdio:"ignore", detached:true }); setInterval(() => {}, 1000);`);
    // Also spawn a real node process standing in for a live keeper (exact keeper command line!) while agent exits before recovery.
    const makeAg = () => ({
      available:() => [{ id:"fake", name:"Fake", available:true, runs:true }],
      nameOf:() => "Fake",
      command:(_id, opts) => ({ command:process.execPath, args:[agentScript], cwd:opts.workdir, env:{ DESC_FILE:descFile } }),
    });
    const s1 = new Service({ directory:dir, agents:makeAg(), autoWatch:false, stopGraceMs:300, stopKillMs:500 });
    const p1 = s1.store.create({ name:"R8F2", docsPath:docs });
    p1.follow = false; s1.store.save();

    const created = await s1.createTopic(p1, { text:"Agent with detached helper", agent:"fake", start:true });
    await until(() => fs.existsSync(descFile), "r8 detached helper started");
    const helperPid = Number(fs.readFileSync(descFile, "utf8").trim());
    t.after(() => { try { process.kill(helperPid, "SIGKILL"); } catch {} });

    const origTable = RunWatch.processTable;
    RunWatch.processTable = async () => null;
    try {
      await assert.rejects(s1.act(p1, created.slug, "stop"), { code:"STOP_FAILED" });
    } finally {
      RunWatch.processTable = origTable;
    }
    const activeBefore = JSON.parse(fs.readFileSync(s1.activeFile, "utf8"));
    assert.equal(activeBefore.length, 1);
    const keepDir = activeBefore[0].keep;
    const origIds = JSON.parse(fs.readFileSync(path.join(keepDir, "pid.json"), "utf8"));
    assert.ok(origIds.agent > 0 && origIds.keeper > 0 && origIds.agent !== origIds.keeper);

    // Close Service 1, kill ONLY the agent root before Service 2 opens (simulating agent exiting while keeper & helper stay alive).
    s1.close();
    const liveKeeper = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio:"ignore", detached:true });
    t.after(() => { try { process.kill(liveKeeper.pid, "SIGKILL"); } catch {} });
    // Kill real agent & wait until dead, then point pid.json's keeper to our live keeper stand-in (deterministic timing!) with exact keeper metadata.
    try { process.kill(origIds.agent, "SIGKILL"); } catch {}
    await until(() => { try { process.kill(origIds.agent, 0); return false; } catch { return true; } }, "agent root exited before recovery");
    fs.writeFileSync(path.join(keepDir, "pid.json"), JSON.stringify({ ...origIds, keeper:liveKeeper.pid }));

    const keeperScript = path.resolve("src/server/project-lines/agent-keeper.js");
    const origMeta = RunWatch.processMeta;
    RunWatch.processMeta = pid => pid === liveKeeper.pid
      ? { pid:liveKeeper.pid, ppid:1, pgid:liveKeeper.pid, zombie:false, startedAt:origIds.at, command:`${process.execPath} ${keeperScript} ${keepDir}` }
      : origMeta(pid);
    try {
      const s2 = new Service({ directory:dir, agents:makeAg(), autoWatch:false, recoverOnStart:true, stopGraceMs:300, stopKillMs:500 });
      t.after(() => s2.close());
      const p2 = s2.store.get(p1.id);
      const recovered = s2.orphansOf(p2, created.slug);
      assert.equal(recovered.length, 1, "successor recovered failed-discovery entry");
      assert.equal(recovered[0].agentPid, origIds.agent, "recovery preserved original exited agentPid instead of substituting keeper PID");
      assert.notEqual(recovered[0].pid, liveKeeper.pid, "recovery did NOT overwrite entry.pid with keeper PID");

      // Stop on successor sees ONLY the keeper alive (agent root already exited before capture) -> MUST fail 409 STOP_FAILED & retain reservation!
      await assert.rejects(s2.act(p2, created.slug, "stop"), { code:"STOP_FAILED" }, "Stop MUST NOT treat surviving keeper as captured agent root");
      assert.equal(s2.orphansOf(p2, created.slug).length, 1, "reservation retained while detached helper is unaccounted");
      const activeAfter = JSON.parse(fs.readFileSync(s2.activeFile, "utf8"));
      assert.equal(activeAfter.length, 1);
      assert.equal(activeAfter[0].discoveryIncomplete, true);
      await assert.rejects(s2.act(p2, created.slug, "retry"), { code:"BUSY" }, "Retry MUST return 409 BUSY while detached helper is unaccounted");
    } finally {
      RunWatch.processMeta = origMeta;
    }
    try { process.kill(helperPid, "SIGKILL"); } catch {}
  }

  // 2) F10: Keeper command matcher MUST require exact `<node> <.../agent-keeper.js> <exact keepDir>` (and keeperPid),
  //    rejecting `node --check agent-keeper.js`, another Node script reading agent-keeper.js, suffix dir mismatch, and non-keeper PID!
  {
    const dir = path.join(root, "s-r8-f10"), docs = path.join(root, "docs-r8-f10");
    fs.mkdirSync(dir, { recursive:true });
    const keepDir = path.join(dir, "keep-exact");
    fs.mkdirSync(keepDir, { recursive:true });
    const s = new Service({ directory:dir, agents:fakeAgents(script), autoWatch:false });
    t.after(() => s.close());
    const p = s.store.create({ name:"R8F10", docsPath:docs });
    p.follow = false; s.store.save();
    const sleeper = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio:"ignore", detached:true });
    t.after(() => { try { process.kill(sleeper.pid, "SIGKILL"); } catch {} });
    const t0 = Date.now() - 2000;
    const keeperScript = path.resolve("src/server/project-lines/agent-keeper.js");
    // Recorded non-Node agent (`/usr/bin/python3`), sleeper is keeperPid.
    fs.writeFileSync(path.join(keepDir, "pid.json"), JSON.stringify({ keeper:sleeper.pid, agent:999992, command:"/usr/bin/python3", at:t0 }));
    const entry = { key:s.key(p, "l"), stepId:"work-1", pid:999992, started:t0, keep:keepDir };
    const origMeta = RunWatch.processMeta;
    try {
      const checkCmd = cmd => {
        RunWatch.processMeta = pid => pid === sleeper.pid ? { pid:sleeper.pid, ppid:1, pgid:sleeper.pid, zombie:false, startedAt:t0, command:cmd } : origMeta(pid);
        return s.identifyOrphanPid(sleeper.pid, entry);
      };
      assert.equal(checkCmd(`${process.execPath} ${keeperScript} ${keepDir}`), "match", "exact keeper invocation matches keeperPid");
      assert.equal(checkCmd(`${process.execPath} --check ${keeperScript} ${keepDir}`), "mismatch", "node --check agent-keeper.js MUST NOT match");
      assert.equal(checkCmd(`${process.execPath} -c ${keeperScript} ${keepDir}`), "mismatch", "node -c agent-keeper.js MUST NOT match");
      assert.equal(checkCmd(`${process.execPath} /tmp/reader.js ${keeperScript} ${keepDir}`), "mismatch", "another node script reading agent-keeper.js MUST NOT match");
      assert.equal(checkCmd(`${process.execPath} ${keeperScript} ${keepDir}-other`), "mismatch", "substring keepDir suffix MUST NOT match");
      assert.equal(checkCmd(`${process.execPath} ${keeperScript} ${keepDir} --extra`), "mismatch", "extra trailing argument MUST NOT match");

      // Even exact keeper command line MUST NOT match if pid is recorded as agentPid (non-Node), NOT keeperPid!
      fs.writeFileSync(path.join(keepDir, "pid.json"), JSON.stringify({ keeper:999991, agent:sleeper.pid, command:"/usr/bin/python3", at:t0 }));
      assert.equal(checkCmd(`${process.execPath} ${keeperScript} ${keepDir}`), "mismatch", "keeper command must NOT match recorded non-Node agentPid");
    } finally {
      RunWatch.processMeta = origMeta;
    }
  }
});

test("Round 9 F10: keeper-only identity for Node agents, real spaced-dir keeper verification, and argument-boundary safety", async t => {
  const { spawn } = require("node:child_process");
  const RunWatch = require("../src/server/project-lines/run-watch.js");
  const root = makeRoot(t, "r9-f10-");
  const script = makeFakeAgentScript(root);
  const { createKeeper } = require("../src/server/project-lines/kept-child.js");
  const keeperScript = path.resolve("src/server/project-lines/agent-keeper.js");

  const dir = path.join(root, "s-r9-f10"), docs = path.join(root, "docs-r9-f10");
  fs.mkdirSync(dir, { recursive:true });
  const s = new Service({ directory:dir, agents:fakeAgents(script), autoWatch:false });
  t.after(() => s.close());
  const p = s.store.create({ name:"R9F10", docsPath:docs });
  p.follow = false; s.store.save();

  const sleeper = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio:"ignore", detached:true });
  t.after(() => { try { process.kill(sleeper.pid, "SIGKILL"); } catch {} });
  const t0 = Date.now() - 2000;
  const origMeta = RunWatch.processMeta;

  // 1) Both Python AND Node agent records MUST enforce keeper-specific identity at the recorded keeperPid!
  const keepPlain = path.join(dir, "keep-plain");
  fs.mkdirSync(keepPlain, { recursive:true });
  const b64Plain = `--dir-b64=${Buffer.from(keepPlain, "utf8").toString("base64url")}`;
  const entryPlain = { key:s.key(p, "l"), stepId:"work-1", pid:999992, started:t0, keep:keepPlain };
  try {
    for (const agentCmd of ["/usr/bin/python3", process.execPath, "/usr/bin/node"]) {
      fs.writeFileSync(path.join(keepPlain, "pid.json"), JSON.stringify({ keeper:sleeper.pid, agent:999992, command:agentCmd, at:t0 }));
      const check = (cmd, argv = null) => {
        RunWatch.processMeta = pid => pid === sleeper.pid
          ? { pid:sleeper.pid, ppid:1, pgid:sleeper.pid, zombie:false, startedAt:t0, command:cmd, ...(argv ? { argv } : {}) }
          : origMeta(pid);
        return s.identifyOrphanPid(sleeper.pid, entryPlain);
      };
      assert.equal(check(`${process.execPath} ${keeperScript} ${b64Plain}`), "match", `[${agentCmd}] genuine --dir-b64 keeper matches keeperPid`);
      assert.equal(check(`${process.execPath} ${keeperScript} ${keepPlain}`), "match", `[${agentCmd}] genuine no-space legacy keeper matches keeperPid`);
      // All 5 invalid commands MUST return "mismatch" for BOTH Python AND Node agent records!
      assert.equal(check(`${process.execPath} --check ${keeperScript} ${keepPlain}`), "mismatch", `[${agentCmd}] --check rejected`);
      assert.equal(check(`${process.execPath} -c ${keeperScript} ${keepPlain}`), "mismatch", `[${agentCmd}] -c rejected`);
      assert.equal(check(`${process.execPath} /tmp/reader.js ${keeperScript} ${keepPlain}`), "mismatch", `[${agentCmd}] intermediate reader script rejected`);
      assert.equal(check(`${process.execPath} ${keeperScript} ${keepPlain}-other`), "mismatch", `[${agentCmd}] different directory suffix rejected`);
      assert.equal(check(`${process.execPath} ${keeperScript} ${keepPlain} --extra`), "mismatch", `[${agentCmd}] extra trailing argument rejected`);
      // Same 5 invalid commands on --dir-b64 form + empty trailing/middle args!
      assert.equal(check(`${process.execPath} --check ${keeperScript} ${b64Plain}`), "mismatch", `[${agentCmd}] --check --dir-b64 rejected`);
      assert.equal(check(`${process.execPath} -c ${keeperScript} ${b64Plain}`), "mismatch", `[${agentCmd}] -c --dir-b64 rejected`);
      assert.equal(check(`${process.execPath} /tmp/reader.js ${keeperScript} ${b64Plain}`), "mismatch", `[${agentCmd}] reader --dir-b64 rejected`);
      assert.equal(check(`${process.execPath} ${keeperScript} --dir-b64=${Buffer.from(`${keepPlain}-other`, "utf8").toString("base64url")}`), "mismatch", `[${agentCmd}] other --dir-b64 rejected`);
      assert.equal(check(`${process.execPath} ${keeperScript} ${b64Plain} --extra`), "mismatch", `[${agentCmd}] extra --dir-b64 rejected`);
      assert.equal(check(`${process.execPath} ${keeperScript} ${b64Plain} `), "mismatch", `[${agentCmd}] trailing empty arg rejected`);
      assert.equal(check(`${process.execPath} ${keeperScript}  ${b64Plain}`), "mismatch", `[${agentCmd}] middle empty arg rejected`);
    }

    // 2) Directory containing spaces:
    //    - Real keeper spawned via createKeeper uses --dir-b64=<b64> -> verified as "match" via real processMeta for BOTH agent types!
    //    - Flat metadata WITHOUT argv for a legacy spaced path CANNOT establish argument boundaries -> MUST withhold "match" ("unknown")!
    //    - Structured metadata WITH argv verifies genuine 1-arg spaced dir ("match") and rejects split args ("mismatch")!
    const spacedRoot = path.join(root, "dir with spaces");
    fs.mkdirSync(spacedRoot, { recursive:true });
    const keeper = createKeeper({ root:spacedRoot });
    const child = keeper.spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { cwd:root, keepName:"space test" });
    t.after(() => { try { child.kill("SIGKILL"); } catch {} });
    await until(() => {
      try {
        const ids = JSON.parse(fs.readFileSync(path.join(child.dir, "pid.json"), "utf8"));
        return Number(ids?.keeper) > 0 && Number(ids?.agent) > 0;
      } catch { return false; }
    }, "real keeper in spaced directory started");
    const realIds = JSON.parse(fs.readFileSync(path.join(child.dir, "pid.json"), "utf8"));
    t.after(() => {
      for (const pid of [realIds.agent, realIds.keeper]) { try { process.kill(pid, "SIGKILL"); } catch {} }
    });
    const realEntry = { key:s.key(p, "l"), stepId:"work-1", pid:realIds.agent, started:realIds.at, keep:child.dir };

    // Use REAL RunWatch.processMeta (no mock!) against the live keeper in `dir with spaces`!
    RunWatch.processMeta = origMeta;
    const realMeta = RunWatch.processMeta(realIds.keeper);
    assert.ok(realMeta && realMeta.command.includes("--dir-b64="), "real keeper spawned with whitespace-free --dir-b64 argument");
    assert.equal(s.identifyOrphanPid(realIds.keeper, realEntry), "match", "genuine keeper in directory with spaces matches with Node agent record");
    fs.writeFileSync(path.join(child.dir, "pid.json"), JSON.stringify({ ...realIds, command:"/usr/bin/python3" }));
    assert.equal(s.identifyOrphanPid(realIds.keeper, realEntry), "match", "genuine keeper in directory with spaces matches with Python agent record");
    child.kill("SIGKILL");
    await new Promise(r => child.once("close", r));
    await until(() => !RunWatch.isPidAlive(realIds.keeper) && !RunWatch.isPidAlive(realIds.agent), "real spaced keeper & agent exited");

    // Now test ambiguous flat metadata vs structured argv for a directory containing spaces!
    const keepSpace = path.join(spacedRoot, "keep spaced");
    fs.mkdirSync(keepSpace, { recursive:true });
    const entrySpace = { key:s.key(p, "l"), stepId:"work-1", pid:999993, started:t0, keep:keepSpace };
    for (const agentCmd of ["/usr/bin/python3", process.execPath]) {
      fs.writeFileSync(path.join(keepSpace, "pid.json"), JSON.stringify({ keeper:sleeper.pid, agent:999993, command:agentCmd, at:t0 }));
      // Flat ps output (no argv) for legacy unencoded spaced path: cannot distinguish `[node, keeper, "/a b"]` from `[node, keeper, "/a", "b"]` -> MUST return "unknown"!
      RunWatch.processMeta = pid => pid === sleeper.pid
        ? { pid:sleeper.pid, ppid:1, pgid:sleeper.pid, zombie:false, startedAt:t0, command:`${process.execPath} ${keeperScript} ${keepSpace}` }
        : origMeta(pid);
      assert.equal(s.identifyOrphanPid(sleeper.pid, entrySpace), "unknown", `[${agentCmd}] flat metadata without argv MUST withhold match for spaced directory`);

      // Invalid commands on spaced directory STILL return "mismatch" even without argv!
      for (const bad of [
        `${process.execPath} --check ${keeperScript} ${keepSpace}`,
        `${process.execPath} -c ${keeperScript} ${keepSpace}`,
        `${process.execPath} /tmp/reader.js ${keeperScript} ${keepSpace}`,
        `${process.execPath} ${keeperScript} ${keepSpace}-other`,
        `${process.execPath} ${keeperScript} ${keepSpace} --extra`,
      ]) {
        RunWatch.processMeta = pid => pid === sleeper.pid
          ? { pid:sleeper.pid, ppid:1, pgid:sleeper.pid, zombie:false, startedAt:t0, command:bad }
          : origMeta(pid);
        assert.equal(s.identifyOrphanPid(sleeper.pid, entrySpace), "mismatch", `[${agentCmd}] invalid spaced command rejected: ${bad}`);
      }

      // Structured argv (exact OS boundaries): 1-arg spaced dir returns "match", split across 2+ args returns "mismatch"!
      RunWatch.processMeta = pid => pid === sleeper.pid
        ? { pid:sleeper.pid, ppid:1, pgid:sleeper.pid, zombie:false, startedAt:t0, command:`${process.execPath} ${keeperScript} ${keepSpace}`, argv:[process.execPath, keeperScript, keepSpace] }
        : origMeta(pid);
      assert.equal(s.identifyOrphanPid(sleeper.pid, entrySpace), "match", `[${agentCmd}] structured argv matches genuine 1-arg spaced directory`);

      const splitIdx = keepSpace.indexOf(" ");
      RunWatch.processMeta = pid => pid === sleeper.pid
        ? { pid:sleeper.pid, ppid:1, pgid:sleeper.pid, zombie:false, startedAt:t0, command:`${process.execPath} ${keeperScript} ${keepSpace}`, argv:[process.execPath, keeperScript, keepSpace.slice(0, splitIdx), keepSpace.slice(splitIdx + 1)] }
        : origMeta(pid);
      assert.equal(s.identifyOrphanPid(sleeper.pid, entrySpace), "mismatch", `[${agentCmd}] structured argv rejects spaced directory split across two arguments`);
    }

    // 3) Round 10 F10:
    //    - Saved per-PID records (`entry.procs`) MUST NOT bypass verified keeper script & directory checks (for both Python & Node agents, flat & structured metadata)!
    //    - Independent birth-time & command checks on saved `procRec` are preserved!
    //    - Live legacy keeper in a directory with spaces remains "unknown" even AFTER RunWatch.captureTrees persists a `procRec`!
    //    - A different script outside PenEcho's source directory named `agent-keeper.js` MUST return "mismatch" for BOTH flat & structured metadata!
    const foreignDir = path.join(root, "foreign-keeper");
    fs.mkdirSync(foreignDir, { recursive:true });
    const foreignKeeperScript = path.join(foreignDir, "agent-keeper.js");
    fs.writeFileSync(foreignKeeperScript, "setTimeout(() => {}, 30000);\n");
    // Round 11 F10: different working directory holding its own file at the SAME relative path as PenEcho's launcher!
    const relKeeper = path.relative(process.cwd(), keeperScript);
    assert.ok(relKeeper && !path.isAbsolute(relKeeper), "relative keeper path from PenEcho cwd is non-empty and relative");
    const foreignCwd = path.join(root, "foreign-cwd");
    const foreignRelFile = path.join(foreignCwd, relKeeper);
    fs.mkdirSync(path.dirname(foreignRelFile), { recursive:true });
    fs.writeFileSync(foreignRelFile, "setTimeout(() => {}, 30000);\n");
    assert.notEqual(fs.statSync(foreignRelFile).ino, fs.statSync(keeperScript).ino, "foreign relative file is a distinct file on disk");

    for (const agentCmd of ["/usr/bin/python3", process.execPath]) {
      fs.writeFileSync(path.join(keepPlain, "pid.json"), JSON.stringify({ keeper:sleeper.pid, agent:999992, command:agentCmd, at:t0 }));
      const invalidCases = [
        { label:"--check", cmd:`${process.execPath} --check ${keeperScript} ${keepPlain}`, argv:[process.execPath, "--check", keeperScript, keepPlain] },
        { label:"-c", cmd:`${process.execPath} -c ${keeperScript} ${keepPlain}`, argv:[process.execPath, "-c", keeperScript, keepPlain] },
        { label:"reader", cmd:`${process.execPath} /tmp/reader.js ${keeperScript} ${keepPlain}`, argv:[process.execPath, "/tmp/reader.js", keeperScript, keepPlain] },
        { label:"other dir", cmd:`${process.execPath} ${keeperScript} ${keepPlain}-other`, argv:[process.execPath, keeperScript, `${keepPlain}-other`] },
        { label:"extra arg", cmd:`${process.execPath} ${keeperScript} ${keepPlain} --extra`, argv:[process.execPath, keeperScript, keepPlain, "--extra"] },
        { label:"foreign same-name script (positional)", cmd:`${process.execPath} ${foreignKeeperScript} ${keepPlain}`, argv:[process.execPath, foreignKeeperScript, keepPlain] },
        { label:"foreign same-name script (b64)", cmd:`${process.execPath} ${foreignKeeperScript} ${b64Plain}`, argv:[process.execPath, foreignKeeperScript, b64Plain] },
        { label:"relative script path from different cwd (positional)", cmd:`${process.execPath} ${relKeeper} ${keepPlain}`, argv:[process.execPath, relKeeper, keepPlain] },
        { label:"relative script path from different cwd (b64)", cmd:`${process.execPath} ${relKeeper} ${b64Plain}`, argv:[process.execPath, relKeeper, b64Plain] },
      ];
      for (const c of invalidCases) {
        const entryWithRecFlat = { ...entryPlain, procs:[{ pid:sleeper.pid, startedAt:t0, command:c.cmd }] };
        const entryWithRecArgv = { ...entryPlain, procs:[{ pid:sleeper.pid, startedAt:t0, command:c.cmd, argv:c.argv }] };
        // Without saved procRec: flat & structured
        RunWatch.processMeta = pid => pid === sleeper.pid ? { pid:sleeper.pid, ppid:1, pgid:sleeper.pid, zombie:false, startedAt:t0, command:c.cmd } : origMeta(pid);
        assert.equal(s.identifyOrphanPid(sleeper.pid, entryPlain), "mismatch", `[${agentCmd}] no-procRec flat rejects ${c.label}`);
        assert.equal(s.identifyOrphanPid(sleeper.pid, entryWithRecFlat), "mismatch", `[${agentCmd}] saved-procRec flat rejects ${c.label}`);
        RunWatch.processMeta = pid => pid === sleeper.pid ? { pid:sleeper.pid, ppid:1, pgid:sleeper.pid, zombie:false, startedAt:t0, command:c.cmd, argv:c.argv } : origMeta(pid);
        assert.equal(s.identifyOrphanPid(sleeper.pid, entryPlain), "mismatch", `[${agentCmd}] no-procRec argv rejects ${c.label}`);
        assert.equal(s.identifyOrphanPid(sleeper.pid, entryWithRecArgv), "mismatch", `[${agentCmd}] saved-procRec argv rejects ${c.label}`);
      }

      // Independent birth-time & command checks are preserved when a saved procRec exists for a genuine keeper!
      const validCmd = `${process.execPath} ${keeperScript} ${b64Plain}`;
      RunWatch.processMeta = pid => pid === sleeper.pid ? { pid:sleeper.pid, ppid:1, pgid:sleeper.pid, zombie:false, startedAt:t0, command:validCmd } : origMeta(pid);
      assert.equal(s.identifyOrphanPid(sleeper.pid, { ...entryPlain, procs:[{ pid:sleeper.pid, startedAt:t0, command:validCmd }] }), "match", `[${agentCmd}] matching procRec on genuine keeper matches`);
      assert.equal(s.identifyOrphanPid(sleeper.pid, { ...entryPlain, procs:[{ pid:sleeper.pid, startedAt:t0 - 10_000, command:validCmd }] }), "mismatch", `[${agentCmd}] stale procRec birth time on genuine keeper mismatches`);
      assert.equal(s.identifyOrphanPid(sleeper.pid, { ...entryPlain, procs:[{ pid:sleeper.pid, startedAt:t0, command:`${process.execPath} ${keeperScript} ${keepPlain}` }] }), "mismatch", `[${agentCmd}] differing procRec command on genuine keeper mismatches`);
      assert.equal(s.identifyOrphanPid(sleeper.pid, { ...entryPlain, procs:[{ pid:sleeper.pid, startedAt:0, command:validCmd }] }), "unknown", `[${agentCmd}] partial procRec lacking birth time stays unknown`);
      assert.equal(s.identifyOrphanPid(sleeper.pid, { ...entryPlain, procs:[{ pid:sleeper.pid, startedAt:t0, command:"" }] }), "unknown", `[${agentCmd}] partial procRec lacking command stays unknown`);
    }

    // Real live legacy keeper in a directory containing spaces: stays "unknown" on macOS EVEN AFTER RunWatch.captureTrees persists procRec!
    const legacySpaceDir = path.join(spacedRoot, "legacy spaced keep");
    fs.mkdirSync(legacySpaceDir, { recursive:true });
    fs.writeFileSync(path.join(legacySpaceDir, "spec.json"), JSON.stringify({ command:process.execPath, args:["-e", "setTimeout(() => {}, 30000)"], cwd:root, dropEnv:[] }));
    const legacyKeeper = spawn(process.execPath, [keeperScript, legacySpaceDir], { cwd:root, stdio:"ignore", detached:true });
    t.after(() => { try { process.kill(legacyKeeper.pid, "SIGKILL"); } catch {} });
    await until(() => {
      try {
        const ids = JSON.parse(fs.readFileSync(path.join(legacySpaceDir, "pid.json"), "utf8"));
        return Number(ids?.keeper) === legacyKeeper.pid && Number(ids?.agent) > 0;
      } catch { return false; }
    }, "live legacy spaced keeper started");
    const legacyIds = JSON.parse(fs.readFileSync(path.join(legacySpaceDir, "pid.json"), "utf8"));
    t.after(() => { try { process.kill(legacyIds.agent, "SIGKILL"); } catch {} });
    RunWatch.processMeta = origMeta;
    const legacyMeta = RunWatch.processMeta(legacyIds.keeper);
    const legacyEntry = { key:s.key(p, "l"), stepId:"work-1", pid:legacyIds.agent, started:legacyIds.at, keep:legacySpaceDir };
    const captured = await RunWatch.captureTrees([legacyIds.keeper]);
    const capturedProcs = captured.trees.get(legacyIds.keeper)?.procs || [];
    assert.ok(capturedProcs.some(rec => rec.pid === legacyIds.keeper), "captureTrees captured live legacy keeper record");
    const legacyEntryCaptured = { ...legacyEntry, procs:capturedProcs };
    if (!Array.isArray(legacyMeta?.argv)) {
      // On macOS (no OS argv boundaries): MUST remain "unknown" BOTH before and after captureTrees persists procRec!
      assert.equal(s.identifyOrphanPid(legacyIds.keeper, legacyEntry), "unknown", "live legacy spaced keeper without argv is unknown before capture");
      assert.equal(s.identifyOrphanPid(legacyIds.keeper, legacyEntryCaptured), "unknown", "live legacy spaced keeper without argv stays unknown after captureTrees persists procRec");
    } else {
      assert.equal(s.identifyOrphanPid(legacyIds.keeper, legacyEntry), "match", "live legacy spaced keeper with OS argv matches before capture");
      assert.equal(s.identifyOrphanPid(legacyIds.keeper, legacyEntryCaptured), "match", "live legacy spaced keeper with OS argv matches after capture");
    }
    for (const pid of [legacyIds.agent, legacyIds.keeper]) { try { process.kill(pid, "SIGKILL"); } catch {} }
    await until(() => !RunWatch.isPidAlive(legacyIds.keeper) && !RunWatch.isPidAlive(legacyIds.agent), "live legacy spaced keeper exited");
  } finally {
    RunWatch.processMeta = origMeta;
  }
});
