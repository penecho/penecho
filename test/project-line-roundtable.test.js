"use strict";
require("./helpers/safety.js");
// PE-620: ordinary Works keep their own assignments and hold the Line through startup and result persistence.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { Service } = require("../src/server/project-lines/service.js");
const { createOrchestrator } = require("../src/server/project-lines/orchestrator.js");
const { createAgentPresets } = require("../src/server/project-lines/agent-presets.js");
const F = require("../src/server/project-lines/format.js");
const Git = require("../src/server/project-lines/git.js");

function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function hold(object, method, when) {
  const original = object[method].bind(object), entered = deferred(), released = deferred();
  let caught = false;
  object[method] = async (...args) => {
    if (!caught && when(...args)) { caught = true; entered.resolve(); await released.promise; }
    return original(...args);
  };
  return { entered:entered.promise, release:released.resolve };
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-roundtable-")), directory = path.join(root, "state"), launches = [];
  const agents = { available:() => [{ id:"fake", name:"Fake", available:true }], nameOf:() => "Fake", classifier:() => null,
    command:(_agent, options) => ({ command:"fixture-agent", args:[], cwd:options.workdir, env:{ FIXTURE_MODEL:options.model, FIXTURE_RESUME:options.resume || "" } }) };
  const options = { directory, agents, autoWatch:false, carryOn:false, memory:{ home:root, env:{} }, conversations:{ home:root, env:{} }, spawnFn:(_command, _args, options) => {
    const child = Object.assign(new EventEmitter(), { pid:900000 + launches.length, stdin:new PassThrough(), stdout:new PassThrough(), stderr:new PassThrough(), killed:false, kill() { this.killed = true; } });
    const launch = { child, model:options.env.FIXTURE_MODEL, resume:options.env.FIXTURE_RESUME, prompt:"" };
    child.stdin.on("data", chunk => { launch.prompt += chunk; });
    launches.push(launch);
    return child;
  } };
  const service = new Service(options);
  service.presets = createAgentPresets({ file:path.join(directory, "presets.json"), agents });
  const orchestrator = createOrchestrator({ directory, service }); service.orchestrator = orchestrator;
  service.stopTree = async child => child.kill();
  const project = service.store.create({ name:"Roundtable", docsPath:path.join(root, "docs") });
  project.defaultAgent = "fake"; project.follow = false; service.store.save();
  const presets = ["first", "second", "third", "synthesis"].map((model, i) => service.presets.add({ agent:"fake", name:`Reader ${i + 1}`, model, effort:i ? "high" : "low" }));
  const call = args => orchestrator.call(project, args);
  const create = () => call({ do:"create-line", task:"What should we choose? First independent opinion.", agent:presets[0].id, kind:"research" });
  const add = (line, n, parallel = true) => call({ do:"add-task", line, task:`Independent opinion ${n + 1}.`, agent:presets[n].id, parallel, kind:n === 3 ? "chat" : "research" });
  const doc = line => F.parseLine(service.readDoc(project, line));
  const run = (line, work) => service.heldWorks(project, line).find(r => r.stepId === work);
  const detail = (line, work) => service.store.readText(project, F.detailPath(line, work)).text;
  const state = line => { const s = service.stateOf(project); return [...s.lines, ...s.backlog, ...s.landed].find(l => l.id === line); };
  async function finish(line, work, code = 0, answer = `Answer for ${work}`, reason = "Participant failed") {
    const r = run(line, work); assert.ok(r, `Work ${work} owns a runtime slot`);
    r.said = answer; r.failed = code ? reason : "";
    await service.ended(project, line, r, code);
  }
  t.after(() => { service.close(); fs.rmSync(root, { recursive:true, force:true }); });
  return { service, orchestrator, project, presets, launches, options, call, create, add, doc, run, detail, state, finish };
}

test("delegation accepts a hidden preset and enforces later opt-outs on new and saved assignments", async t => {
  const f = fixture(t), [both, hidden, manual, neither] = f.presets;
  f.service.presets.update(hidden.id, { showInPicker:false });
  f.service.presets.update(manual.id, { allowDelegation:false, default:true });
  f.service.presets.update(neither.id, { showInPicker:false, allowDelegation:false });
  const choices = await f.call({ do:"agents" });
  assert.deepEqual(choices.agents.map(x => x.id), [both.id, hidden.id]);
  assert.equal(choices.default, "");
  const saved = await f.call({ do:"create-line", task:"Saved assignment", agent:hidden.id, kind:"research", run:false });
  for (const agent of [manual.id, neither.id, "auto:fake", "", undefined]) {
    await assert.rejects(f.call({ do:"create-line", task:"New assignment", agent }), { code:"BAD_AGENT" });
    await assert.rejects(f.call({ do:"add-task", line:saved.line, task:"Another assignment", agent }), { code:"BAD_AGENT" });
  }
  f.service.presets.update(hidden.id, { allowDelegation:false });
  await assert.rejects(f.call({ do:"start-line", line:saved.line }), { code:"BAD_AGENT" });
  assert.equal(f.launches.length, 0);
  f.service.presets.update(hidden.id, { allowDelegation:true });
  const work = await f.call({ do:"start-line", line:saved.line });
  assert.equal(F.splitFront(f.detail(saved.line, work.work)).front["saved agent id"], hidden.id);
  await f.finish(saved.line, work.work);
  for (const p of [both, hidden]) f.service.presets.update(p.id, { allowDelegation:false });
  assert.deepEqual((await f.call({ do:"agents" })).agents, []);
  await assert.rejects(f.call({ do:"create-line", task:"Empty pool" }), /Allow orchestrator assignments/);
  await assert.rejects(f.orchestrator.start(f.project, { preset:hidden.id, goal:"Manual start" }), { code:"BAD_AGENT" });
  const coordinator = await f.orchestrator.start(f.project, { preset:manual.id, goal:"Handle this directly" });
  assert.equal(f.state(coordinator.line).running, true, "a person can start a visible coordinator with an empty delegation pool");
});

test("three participants keep distinct presets and conversations; synthesis waits for every complete saved answer", async t => {
  const f = fixture(t), first = await f.create(), line = first.line;
  const [second, third] = await Promise.all([f.add(line, 1), f.add(line, 2)]);
  const synthesis = await f.add(line, 3, false);
  const works = [first.work, second.work, third.work];
  assert.equal(new Set(works).size, 3);
  assert.deepEqual(f.launches.map(l => l.model), ["first", "second", "third"]);
  assert.deepEqual(f.state(line).stations.filter(s => s.kind === "work").map(s => s.state), ["active", "active", "active", "todo"]);
  for (const [i, work] of works.entries()) {
    const r = f.run(line, work);
    f.service.applyChanges(f.project, line, r, [{ session:`opinion-${i}` }]);
    const front = F.splitFront(f.detail(line, work)).front;
    assert.equal(front["saved agent id"], f.presets[i].id);
    assert.equal(front["selected model"], f.presets[i].model);
    assert.equal(front["selected effort"], f.presets[i].effort);
    assert.equal(f.launches[i].resume, "");
    assert.match(f.launches[i].prompt, new RegExp(`Work file: works/${line}/${work}.md`));
  }
  assert.equal(new Set(works.map(work => f.run(line, work).session)).size, 3);
  const complete = `Full opinion.\n\n${"Evidence. ".repeat(6000)}\n\n[Source](../../files/source.md)\n\nLast recommendation.`;
  await f.finish(line, first.work, 0, complete);
  await f.finish(line, third.work);
  const saving = hold(f.service, "closeDetail", (_p, _line, work, args) => work === second.work && args.result);
  t.after(saving.release);
  const finished = f.finish(line, second.work);
  await saving.entered;
  await Promise.all([f.service.next(f.project, line), f.service.next(f.project, line)]);
  assert.equal(f.launches.length, 3, "a finalizer still holds the last opinion");
  assert.equal(f.state(line).running, true);
  assert.equal(f.service.activityOf(f.project, line).nows[second.work], "Saving result");
  assert.equal(f.service.isSessionRunning("fake", "opinion-1"), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.service.activeFile, "utf8")).map(r => r.stepId), [second.work]);
  saving.release(); await finished;
  assert.equal(f.launches.length, 4);
  assert.equal(f.launches[3].model, "synthesis");
  assert.equal(f.launches[3].resume, "");
  assert.ok(works.every(work => F.sectionText(f.detail(line, work), "Result")));
  const result = (await f.call({ do:"work", line, work:first.work })).result;
  assert.equal(result, F.sectionText(f.detail(line, first.work), "Result"), "the API returns raw Markdown without a summary conversion");
  assert.equal(F.resultOf(result).text, complete);
  assert.equal(F.splitFront(f.detail(line, synthesis.work)).front["selected model"], "synthesis");
  const taskIds = [...works, synthesis.work].map(work => F.splitFront(f.detail(line, work)).front["task id"]);
  assert.equal(new Set(taskIds).size, 4, "every assigned task has a new logical task too");
  assert.ok(f.doc(line).asks.slice(1).every(ask => ask.taskMode === "new"));
  await f.finish(line, synthesis.work, 0, "Compared all three complete opinions.");
  assert.equal(f.doc(line).status, "done");
  assert.ok(f.doc(line).steps.filter(F.AGENT_LIKE).every(s => s.done && !s.off));
  assert.equal((await f.call({ do:"wait", lines:[line] })).done, true);
});

test("concurrent starts reserve each Work before yielding and parallel only starts its assigned Work", async t => {
  const f = fixture(t), starting = hold(f.service, "runCanvas", () => true);
  t.after(starting.release);
  const creating = f.create(); await starting.entered;
  const line = f.service.store.scan(f.project).topics[0].slug, first = f.doc(line).steps.find(F.AGENT_LIKE);
  const queued = await f.add(line, 3, false), independent = await f.add(line, 1);
  const key = f.service.key(f.project, line);
  assert.equal(f.service.startingWorks.size, 1);
  assert.equal(f.launches.length, 1, "only the explicitly parallel assignment started");
  assert.equal(f.launches[0].model, "second");
  assert.equal(f.state(line).running, true);
  assert.equal(f.state(line).stations.find(s => s.id === first.id).state, "active");
  assert.equal(f.state(line).stations.find(s => s.id === queued.work).state, "todo");
  assert.equal(f.service.runningJobs().filter(j => j.key === key).length, 2);
  await Promise.all(Array.from({ length:5 }, () => f.service.next(f.project, line)));
  await f.service.launch(f.project, line, first, f.doc(line));
  assert.equal(f.launches.length, 1);
  starting.release(); await creating;
  assert.equal(f.launches.length, 2);
  await f.finish(line, independent.work);
  assert.equal(f.launches.length, 2);
  await f.finish(line, first.id);
  assert.equal(f.launches.length, 3);
  assert.equal(f.launches[2].model, "synthesis");
  await f.finish(line, queued.work);
});

for (const parallel of [true, false]) {
  test(`finishing a ${parallel ? "parallel" : "serial"} assignment leaves the saved Ask unsent until Run`, async t => {
    const f = fixture(t), task = "Keep this saved for later";
    const saved = await f.call({ do:"create-line", task, agent:f.presets[0].id, kind:"research", run:false });
    const { line } = saved, second = await f.add(line, 1, parallel);
    assert.deepEqual(f.launches.map(l => l.model), ["second"]);
    await f.finish(line, second.work);
    assert.deepEqual(f.launches.map(l => l.model), ["second"], "finishing can only advance authorized Works");
    assert.deepEqual(f.service.heldWorks(f.project, line), []);
    assert.deepEqual(f.doc(line).steps.filter(F.AGENT_LIKE).map(s => s.id), [second.work]);
    assert.deepEqual(f.doc(line).asks.filter(F.isUnsent).map(s => s.text), [task]);
    assert.doesNotMatch(F.sectionText(f.detail(line, second.work), "Asked"), /Keep this saved for later/);

    // Asks are numbered in document order. Use the current step just as the Run action does.
    const view = await f.call({ do:"line", line });
    const ask = view.steps.find(s => s.unsent);
    assert.equal(ask.ask, task);
    assert.equal(ask.step, f.doc(line).asks.find(F.isUnsent).id);
    assert.equal(ask.savedAgentId, f.presets[0].id);
    f.service.pickPreset(f.project, line, f.presets[2].id); // Another Line pick cannot change the saved Ask.
    await f.service.act(f.project, line, "run-unsent", { step:ask.step });
    assert.deepEqual(f.launches.map(l => l.model), ["second", "first"]);
    assert.equal(f.doc(line).asks.some(F.isUnsent), false);
    const work = f.service.heldWorks(f.project, line)[0].stepId;
    const detail = f.detail(line, work);
    assert.equal(F.splitFront(detail).front["saved agent id"], f.presets[0].id);
    assert.match(F.sectionText(detail, "Asked"), /Keep this saved for later/);
    await f.finish(line, work);
    assert.deepEqual(f.launches.map(l => l.model), ["second", "first"]);
  });
}

test("Run with an explicit preset overrides the saved Ask's original preset", async t => {
  const f = fixture(t);
  const saved = await f.call({ do:"create-line", task:"Keep this for an explicit send", agent:f.presets[0].id, kind:"research", run:false });
  await f.service.act(f.project, saved.line, "run-unsent", { step:saved.ask, preset:f.presets[2].id });
  assert.deepEqual(f.launches.map(l => l.model), ["third"]);
  const work = f.doc(saved.line).steps.find(F.AGENT_LIKE);
  await f.finish(saved.line, work.id);
  assert.equal(F.splitFront(f.detail(saved.line, work.id)).front["saved agent id"], f.presets[2].id);
});

test("a new assignment arriving during a status-only advance still retains its requested start", async t => {
  const f = fixture(t), first = await f.create(), line = first.line;
  await f.finish(line, first.work);
  await f.service.setStatus(f.project, line, "working");
  const checking = hold(f.service, "checkMerged", () => true); t.after(checking.release);
  const advancing = f.service.next(f.project, line, { start:false }); await checking.entered;
  const added = await f.add(line, 1, false);
  checking.release(); await advancing;
  assert.equal(f.launches.length, 2);
  assert.ok(f.run(line, added.work));
  await f.finish(line, added.work);
});

for (const [mainFails, laneFails] of [[false, true], [true, false], [true, true]]) for (const mainFirst of [true, false]) {
  test(`failures remain truthful: main=${mainFails}, lane=${laneFails}, ${mainFirst ? "main" : "lane"} ends first`, async t => {
    const f = fixture(t), first = await f.create(), second = await f.add(first.line, 1), line = first.line;
    const ordered = mainFirst ? [[first.work, mainFails], [second.work, laneFails]] : [[second.work, laneFails], [first.work, mainFails]];
    for (const [i, [work, fails]] of ordered.entries()) {
      await f.finish(line, work, fails ? 1 : 0, `Partial or full answer for ${work}`, `Failure in ${work}`);
      if (!i) {
        const signal = AbortSignal.abort(), waited = await f.orchestrator.call(f.project, { do:"wait", lines:[line] }, { signal });
        assert.equal(waited.done, false); assert.equal(waited.lines[0].running, true);
        assert.equal(f.state(line).stations.find(s => s.id === ordered[1][0]).state, "active");
        if (mainFirst && mainFails) await assert.rejects(f.service.act(f.project, line, "review-all"), { code:"BUSY" });
      }
    }
    const main = f.doc(line).steps.find(s => s.id === first.work), lane = f.doc(line).steps.find(s => s.id === second.work);
    assert.equal(main.done, !mainFails, "ordinary primary failure remains retryable");
    assert.equal(Boolean(main.off), false);
    assert.equal(lane.done, true);
    assert.equal(lane.off || "", laneFails ? "stopped" : "");
    assert.equal(f.doc(line).status, mainFails ? "stopped" : "done");
    assert.equal(f.state(line).running, false);
    for (const [work, fails] of [[first.work, mainFails], [second.work, laneFails]]) {
      assert.equal(F.resultOf(F.sectionText(f.detail(line, work), "Result")).text, `Partial or full answer for ${work}`);
      assert.equal(Boolean(F.sectionText(f.detail(line, work), "Stopped")), fails);
      if (fails) assert.equal(F.splitFront(f.detail(line, work)).front["stop why"], "error");
    }
    // Both are Works in Statistics; whether they finished is neither counted nor shown (PE-660).
    assert.equal(f.orchestrator.stats(f.project).rows.reduce((n, r) => n + r.works, 0), 2);
    assert.ok(f.orchestrator.stats(f.project).rows.every(r => !("finished" in r) && !("failed" in r) && !("successRate" in r)));
  });
}

test("Stop cancels reserved startup and queued synthesis before any process can start", async t => {
  const f = fixture(t), starting = hold(f.service, "runCanvas", () => true);
  t.after(starting.release);
  const creating = f.create(); await starting.entered;
  const line = f.service.store.scan(f.project).topics[0].slug;
  await f.add(line, 3, false);
  await f.service.stopWork(f.project, line);
  assert.equal(f.launches.length, 0);
  starting.release(); await creating;
  await f.service.next(f.project, line);
  assert.equal(f.launches.length, 0);
  assert.equal(f.service.startingWorks.size, 0);
  assert.ok(f.doc(line).steps.filter(F.AGENT_LIKE).every(s => s.done && s.off === "stopped"));
});

test("a sibling that finishes startup after the primary fails never reopens or retries the primary", async t => {
  const f = fixture(t), first = await f.create(), line = first.line;
  const starting = hold(f.service, "runCanvas", () => true); t.after(starting.release);
  const adding = f.add(line, 1); await starting.entered;
  await f.add(line, 3, false);
  await f.finish(line, first.work, 1, "Partial primary opinion", "Primary failed during sibling startup");
  assert.equal(f.doc(line).status, "stopped");
  starting.release(); const second = await adding;
  assert.equal(f.doc(line).status, "stopped");
  await f.finish(line, second.work);
  assert.equal(f.doc(line).status, "stopped");
  assert.equal(f.launches.length, 2);
  assert.equal(f.doc(line).steps.find(s => s.id === first.work).done, false);
  assert.equal(f.doc(line).steps.find(s => s.id === second.work).done, true);
});

test("Stop cancels every reserved sibling startup before any of them can spawn", async t => {
  const f = fixture(t), first = await f.create(), line = first.line, canvas = f.service.runCanvas.bind(f.service);
  const entered = deferred(), released = deferred(); let waiting = 0;
  t.after(released.resolve);
  f.service.runCanvas = async (...args) => { if (++waiting === 2) entered.resolve(); await released.promise; return canvas(...args); };
  const adding = Promise.all([f.add(line, 1), f.add(line, 2)]); await entered.promise;
  await f.add(line, 3, false);
  assert.equal(f.service.startingWorks.size, 2);
  await f.service.stopWork(f.project, line);
  released.resolve(); await adding;
  await f.service.next(f.project, line);
  assert.equal(f.launches.length, 1);
  assert.equal(f.service.startingWorks.size, 0);
  assert.ok(f.doc(line).steps.filter(F.AGENT_LIKE).every(s => s.done && s.off === "stopped"));
});

test("Stop during result persistence keeps stopped details and never starts queued work", async t => {
  const f = fixture(t), first = await f.create(), line = first.line, second = await f.add(line, 1);
  await f.add(line, 3, false);
  const saving = hold(f.service, "closeDetail", (_p, _line, work, args) => work === first.work && args.result);
  t.after(saving.release);
  const finished = f.finish(line, first.work); await saving.entered;
  const surviving = f.run(line, second.work);
  await f.service.stopWork(f.project, line);
  assert.equal(surviving.stopping, true); assert.equal(surviving.child.killed, true);
  saving.release(); await finished;
  await f.service.ended(f.project, line, surviving, 0);
  await f.service.next(f.project, line);
  assert.equal(f.launches.length, 2);
  assert.ok(f.doc(line).steps.filter(F.AGENT_LIKE).every(s => s.done && s.off === "stopped"));
  for (const work of [first.work, second.work]) {
    assert.equal(F.sectionText(f.detail(line, work), "Stopped"), "Stopped by you");
    assert.equal(F.splitFront(f.detail(line, work)).front["stop why"], "stopped");
  }
});

test("Stop during an awaited detail snapshot cannot be overwritten by the late result save", async t => {
  const f = fixture(t), first = await f.create(), line = first.line, r = f.run(line, first.work);
  await f.add(line, 3, false);
  r.head = "before";
  const entered = deferred(), released = deferred(), original = Git.headOf;
  Git.headOf = async () => { entered.resolve(); await released.promise; return ""; };
  t.after(() => { Git.headOf = original; released.resolve(); });
  const ending = f.finish(line, first.work); await entered.promise;
  await f.service.stopWork(f.project, line);
  released.resolve(); await ending;
  assert.equal(f.launches.length, 1);
  assert.equal(f.doc(line).steps.find(s => s.id === first.work).off, "stopped");
  assert.equal(F.sectionText(f.detail(line, first.work), "Stopped"), "Stopped by you");
  assert.equal(F.resultOf(F.sectionText(f.detail(line, first.work), "Result")).text, `Answer for ${first.work}`);
});

test("Stop cancels a pending automatic retry before its finalizer releases the Work", async t => {
  const f = fixture(t), first = await f.create(), line = first.line;
  const r = f.run(line, first.work); r.ending = "stuck";
  const saved = deferred(), released = deferred(), endRun = f.service.endRun.bind(f.service);
  t.after(released.resolve);
  f.service.endRun = async (...args) => { await endRun(...args); saved.resolve(); await released.promise; };
  const ending = f.service.ended(f.project, line, r, 1); await saved.promise;
  assert.ok(r.retry);
  await f.service.stopWork(f.project, line);
  released.resolve(); await ending;
  assert.equal(f.launches.length, 1);
  assert.equal(f.doc(line).steps.find(s => s.id === first.work).off, "stopped");
});

test("a failed parallel startup releases its reservation and stays failed while successful work and synthesis finish", async t => {
  const f = fixture(t), first = await f.create(), spawn = f.service.spawn;
  f.service.spawn = (...args) => { if (args[2].env.FIXTURE_MODEL === "second") throw Error("Fixture spawn failure"); return spawn(...args); };
  const second = await f.add(first.line, 1), synthesis = await f.add(first.line, 3, false);
  assert.equal(f.service.startingWorks.size, 0);
  assert.equal(f.doc(first.line).steps.find(s => s.id === second.work).off, "stopped");
  assert.match(F.sectionText(f.detail(first.line, second.work), "Stopped"), /Fixture spawn failure/);
  await f.finish(first.line, first.work); await f.finish(first.line, synthesis.work);
  assert.equal(f.doc(first.line).status, "done");
  assert.equal(f.launches.length, 2);
});

test("lane lifecycle invalidates cached state, owns late-named sessions and survives active-run recovery records", async t => {
  const f = fixture(t), first = await f.create(), line = first.line, second = await f.add(line, 1), third = await f.add(line, 2);
  const r = f.run(line, second.work), original = f.state(line), revision = f.service.stateOf(f.project).rev;
  r.now = "Checking a different opinion";
  assert.notStrictEqual(f.state(line), original);
  assert.notEqual(f.service.stateOf(f.project).rev, revision, "revision checks must send the updated lane state too");
  assert.equal(f.state(line).stations.find(s => s.id === second.work).now, r.now);
  assert.equal(f.service.awaitsName("fake"), true);
  assert.equal(f.service.claimUnnamed("fake", "late-name", r.workdir, { created:Date.now(), prompt:r.promptHead }), true);
  assert.equal(r.sessionId, "late-name");
  assert.equal(f.service.isSessionRunning("fake", "late-name"), true);
  const rec = { agent:"fake", id:"late-name", projectId:f.project.id, slug:line, startedHere:true, stepId:second.work, lastSay:"", doneTurns:{} };
  await f.service.conversationChanges(f.project, rec, [{ me:"A duplicate prompt", at:Date.now() }]);
  await f.service.conversationQuiet(f.project, rec);
  assert.equal(f.doc(line).asks.length, 3);
  assert.equal(f.doc(line).status, "working");
  f.service.saveActive();
  const active = JSON.parse(fs.readFileSync(f.service.activeFile, "utf8"));
  assert.equal(active.length, 3);
  assert.deepEqual(active.filter(r => r.lane).map(r => r.stepId).sort(), [second.work, third.work].sort());
  f.service.close();
  assert.ok(f.launches.every(l => l.child.killed), "shutdown includes every participant");
  const restarted = new Service({ ...f.options, recoverOnStart:true }); t.after(() => restarted.close());
  const recovered = F.parseLine(restarted.readDoc(f.project, line));
  assert.equal(recovered.status, "stopped");
  assert.equal(recovered.steps.find(s => s.id === first.work).done, false);
  for (const work of [first.work, second.work, third.work]) assert.match(F.sectionText(restarted.store.readText(f.project, F.detailPath(line, work)).text, "Stopped"), /PenEcho closed while this was running/);
  for (const work of [second.work, third.work]) assert.equal(recovered.steps.find(s => s.id === work).off, "stopped");
  assert.equal(f.launches.length, 3, "recovery does not duplicate or silently serialize opinions");
  assert.equal(restarted.stepPresets.get(`${restarted.key(f.project, line)}:${third.work}`), f.presets[2].id);
  assert.equal(restarted.stepPresets.get(`${restarted.key(f.project, line)}:${first.work}`), f.presets[0].id, "the first participant retains its assignment on recovery too");
});

test("line ownership guards reject terminal actions while a sibling survives a primary failure", async t => {
  const f = fixture(t), first = await f.create(), line = first.line;
  await f.add(line, 1); await f.finish(line, first.work, 1);
  const before = f.service.readDoc(f.project, line);
  await assert.rejects(f.service.carryOnWith(f.project, line, { preset:f.presets[2].id, step:first.work }), { code:"BUSY" });
  await assert.rejects(f.service.resendWork(f.project, line, { step:first.work }), { code:"BUSY" });
  await assert.rejects(f.service.act(f.project, line, "delete", { confirm:line }), { code:"BUSY" });
  const target = f.service.store.create({ name:"Other", docsPath:path.join(path.dirname(f.project.docsPath), "other") });
  await assert.rejects(f.service.moveLine(f.project, line, { to:target.id }), { code:"BUSY" });
  assert.equal(f.service.readDoc(f.project, line), before);
  assert.equal(f.launches.length, 2);
});

test("recovery records every surviving lane even when the primary already stopped the Line", async t => {
  const f = fixture(t), first = await f.create(), line = first.line, second = await f.add(line, 1), third = await f.add(line, 2);
  await f.finish(line, first.work, 1, "Primary partial answer", "Original primary failure");
  assert.equal(JSON.parse(fs.readFileSync(f.service.activeFile, "utf8")).length, 2);
  f.service.close();
  const restarted = new Service({ ...f.options, recoverOnStart:true }); t.after(() => restarted.close());
  const recovered = F.parseLine(restarted.readDoc(f.project, line));
  assert.equal(recovered.front.why, "Original primary failure");
  assert.equal(recovered.steps.find(s => s.id === first.work).done, false);
  for (const work of [second.work, third.work]) {
    assert.equal(recovered.steps.find(s => s.id === work).off, "stopped");
    assert.match(F.sectionText(restarted.store.readText(f.project, F.detailPath(line, work)).text, "Stopped"), /PenEcho closed while this was running/);
  }
  assert.equal(f.launches.length, 3);
});

test("the watchdog includes a surviving lane after the primary has failed", async t => {
  const f = fixture(t), first = await f.create(), line = first.line, second = await f.add(line, 1);
  await f.finish(line, first.work, 1);
  const r = f.run(line, second.work), started = r.started;
  r.turnOver = started; r.said = "The surviving opinion.";
  f.service.processTable = async () => [{ pid:r.child.pid, ppid:1, cpu:0 }];
  f.service.finishedTurn = () => null;
  await f.service.watchRuns(started + 1000);
  await f.service.watchRuns(started + 11 * 60000);
  assert.equal(r.ending, "end");
  assert.equal(r.child.killed, true);
  await f.service.ended(f.project, line, r, 0);
  assert.equal(f.doc(line).steps.find(s => s.id === second.work).done, true);
  assert.equal(f.doc(line).status, "stopped");
});

test("start-line consumes exactly the selected saved Ask and persists its real assignment", async t => {
  const f = fixture(t);
  const first = await f.call({ do:"create-line", task:"First deferred opinion", agent:f.presets[0].id, kind:"research", run:false });
  const { line } = first;
  assert.equal(first.work, "");
  f.project.autoWake = false;
  await f.service.saveUnsent(f.project, { topic:line, text:"Second deferred opinion", taskMode:"new" });
  await assert.rejects(f.call({ do:"start-line", line, ask:first.ask, revision:first.revision }), { code:"CONFLICT" });
  await assert.rejects(f.call({ do:"start-line", line }), { code:"BAD_ASK" });
  const view = await f.call({ do:"line", line });
  const second = view.steps.filter(s => s.unsent)[1];
  const request = { do:"start-line", line, ask:second.step, revision:view.revision, agent:f.presets[1].id, kind:"docs" };
  await assert.rejects(f.call({ ...request, agent:"missing" }), { code:"BAD_AGENT" });
  assert.equal(f.doc(line).asks.filter(F.isUnsent).length, 2);
  const [a, b] = await Promise.allSettled([f.call(request), f.call(request)]);
  assert.equal(a.status, "fulfilled"); assert.equal(b.status, "rejected");
  assert.equal(a.value.started, true);
  assert.deepEqual(f.launches.map(l => l.model), ["second"]);
  assert.equal(f.doc(line).asks.filter(F.isUnsent)[0].text, "First deferred opinion");
  assert.match(F.sectionText(f.detail(line, a.value.work), "Asked"), /Second deferred opinion/);
  await f.finish(line, a.value.work);
  await assert.rejects(f.call(request), { code:"CONFLICT" });
  const last = await f.call({ do:"start-line", line });
  assert.equal(last.started, true);
  assert.deepEqual(f.launches.map(l => l.model), ["second", "first"]);
  await f.finish(line, last.work);
  assert.deepEqual(f.orchestrator.records(f.project).map(r => [r.work, r.kind, r.preset]), [
    [a.value.work, "docs", f.presets[1].id], [last.work, "research", f.presets[0].id],
  ]);
  await assert.rejects(f.call({ do:"start-line", line }), { code:"NOT_QUEUED" });
});

test("start-line starts the single original Work on an older unscheduled Line and requires a task kind", async t => {
  const f = fixture(t);
  const { slug } = await f.service.createTopic(f.project, { text:"Already assigned", agent:"fake", start:false, preset:f.presets[0].id });
  await assert.rejects(f.call({ do:"start-line", line:slug }), { code:"BAD_KIND" });
  const result = await f.call({ do:"start-line", line:slug, kind:"code" });
  assert.equal(result.work, "work-1"); assert.equal(result.kind, "code"); assert.equal(result.started, true);
  assert.equal(f.doc(slug).asks.length, 1);
  assert.equal(f.orchestrator.records(f.project).find(r => r.line === slug && r.work === "work-1")?.kind, "code");
  await f.finish(slug, result.work);
});

test("a primary finishing after a false interruption restores only the still-owned parallel Work", async t => {
  const f = fixture(t), first = await f.create(), line = first.line, second = await f.add(line, 1);
  for (const id of [first.work, second.work]) f.service.interruptWork(f.project, line, f.doc(line).steps.find(s => s.id === id));
  f.service.writeDoc(f.project, line, F.updateSteps(f.service.readDoc(f.project, line), steps => {
    const step = steps.find(s => s.id === second.work);
    step.done = true; step.off = "stopped";
  }));
  await f.finish(line, first.work);
  assert.equal(f.doc(line).status, "working");
  assert.equal(f.doc(line).steps.find(s => s.id === second.work).done, false);
  assert.equal(F.sectionText(f.detail(line, second.work), "Stopped"), null);
  await f.finish(line, second.work);
  assert.equal(f.doc(line).status, "done");
  assert.equal(f.launches.length, 2);
});
