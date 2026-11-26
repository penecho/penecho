"use strict";
require("./helpers/safety.js");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { Service } = require("../src/server/project-lines/service.js");
const F = require("../src/server/project-lines/format.js");

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-recovery-")), directory = path.join(root, "state"), home = path.join(root, "home");
  let launches = 0, commandOptions, prompt = "";
  const agents = { available:() => [{ id:"pi", available:true, name:"Pi" }], classifier:() => null,
    command:(id, options) => { commandOptions = options; return { command:"stand-in", args:[], cwd:options.workdir, stdin:true, dialect:"pi" }; } };
  const options = { directory, agents, autoWatch:false, conversations:{ home, env:{} }, spawnFn:() => {
    launches++;
    const stdin = new PassThrough(); prompt = ""; stdin.on("data", d => { prompt += d; });
    return Object.assign(new EventEmitter(), { stdout:new PassThrough(), stderr:new PassThrough(), stdin, kill() {} });
  } };
  let service = new Service(options);
  const project = service.store.create({ name:"Demo", docsPath:path.join(root, "docs") });
  project.defaultAgent = "pi"; project.followSince = Date.now() - 60000; service.store.save();
  const { slug } = await service.createTopic(project, { text:"Remove the project finder.", agent:"pi", kinds:["ask", "work"], start:false });
  await service.begin(project, slug);
  const run = service.runs.get(service.key(project, slug)), id = "pi-managed", at = Date.now(), sourceDir = path.join(home, ".pi/agent/sessions", `--${project.docsPath.replace(/^\//, "").replace(/\//g, "-")}--`);
  fs.mkdirSync(sourceDir, { recursive:true });
  const file = path.join(sourceDir, `2026-11-08T06-48-23-919Z_${id}.jsonl`), header = { type:"session", id, version:3, cwd:project.docsPath, timestamp:new Date(at - 100).toISOString() };
  fs.writeFileSync(file, JSON.stringify(header) + "\n");
  service.agentSaid(project, slug, run, JSON.stringify(header));
  const api = {
    get service() { return service; }, project, slug, run, id, at, file,
    get launches() { return launches; }, get commandOptions() { return commandOptions; }, get prompt() { return prompt; },
    doc:() => F.parseLine(service.readDoc(project, slug)),
    rows:() => service.activityOf(project, slug, 0).rows,
    detail:() => service.store.readText(project, F.detailPath(slug, run.stepId)).text,
    message(message, managed = true, envelopeAt = message.timestamp) {
      fs.appendFileSync(file, JSON.stringify({ type:"message", timestamp:new Date(envelopeAt).toISOString(), message }) + "\n");
      if (managed) service.agentSaid(project, slug, run, JSON.stringify({ type:"message_end", message }));
    },
    restart(carryOn = false) {
      service.runs.clear(); service.close(); // Simulate losing the process without its completion callback.
      service = new Service({ ...options, recoverOnStart:true, carryOn });
      return service.conversations.records[`pi:${id}`];
    },
    async read() { await service.conversations.tick(); },
  };
  t.after(() => { service.runs.clear(); service.close(); fs.rmSync(root, { recursive:true, force:true }); });
  return api;
}
const assistant = (at, text, calls = []) => ({ role:"assistant", timestamp:at, stopReason:calls.length ? "toolUse" : "stop", content:[...(text ? [{ type:"text", text }] : []), ...calls.map(id => ({ type:"toolCall", id, name:"edit", arguments:{ path:`${id}.js` } }))] });
const result = (at, id) => ({ role:"toolResult", timestamp:at, toolCallId:id, isError:false, content:[{ type:"text", text:"Saved." }] });

test("restart finalizes the exact interrupted Work without spawning or losing its output", async t => {
  const f = await fixture(t), { service, project, slug, run } = f;
  f.message(assistant(f.at, "I found the finder.", ["edit-1"]));
  service.activity.add(project, slug, { kind:"tool", id:"other-agent", step:"work-2", state:"running" });
  const detail = F.setResult(f.detail(), "Earlier output stays here.");
  service.store.writeText(project, F.detailPath(slug, run.stepId), F.setNow(detail, "Editing main.js"));
  const active = JSON.parse(fs.readFileSync(service.activeFile, "utf8"));
  assert.equal(typeof active[0]?.launchId, "string");
  assert.ok(active[0].launchId.length > 0);
  assert.deepEqual(active, [{ key:service.key(project, slug), stepId:run.stepId, agent:"pi", sessionId:f.id, pid:0, started:run.started, carried:0, launchId:run.launchId }]);
  const rec = f.restart();
  assert.equal(f.launches, 1, "recovering relaunches nothing by itself");
  assert.equal(f.doc().status, "stopped");
  assert.equal(f.doc().steps.find(s => s.id === run.stepId).done, false);
  assert.doesNotMatch(f.detail(), /## Now|Editing main\.js/);
  assert.match(f.detail(), /## Stopped[\s\S]*Retry to continue/);
  assert.match(f.detail(), /Earlier output stays here/);
  assert.equal(f.rows().find(r => r.id === "edit-1").state, "lost");
  assert.equal(f.rows().find(r => r.id === "other-agent").state, "running");
  assert.equal(rec.stepId, run.stepId); assert.equal(rec.active, false); assert.equal(rec.turnOpen, false);
  await f.read();
  assert.equal(f.doc().status, "stopped");
  assert.equal(f.service.activityOf(project, slug, 0).running, false);
  assert.equal(f.rows().filter(r => r.kind === "say").length, 1);
  assert.equal(f.rows().filter(r => r.id === "edit-1").length, 1);
});

test("legacy active-run keys recover with stopped details and keep Retry's saved session", async t => {
  const f = await fixture(t);
  fs.writeFileSync(f.service.activeFile, JSON.stringify([f.service.key(f.project, f.slug)]));
  f.restart();
  assert.equal(f.doc().status, "stopped");
  assert.match(f.detail(), /## Stopped/);
  await f.service.act(f.project, f.slug, "retry");
  assert.equal(f.launches, 2);
  assert.equal(f.commandOptions.resume, f.id);
});

test("Pi checkpoint recognizes a managed assistant despite a later transcript envelope", async t => {
  const f = await fixture(t);
  f.message(assistant(f.at, "Removing the search field.", ["call-1"]), true, f.at + 12000);
  const transcript = fs.readFileSync(f.file, "utf8").trim().split("\n").map(line => JSON.parse(line));
  transcript[1].message = Object.fromEntries(Object.entries(transcript[1].message).reverse());
  fs.writeFileSync(f.file, transcript.map(row => JSON.stringify(row)).join("\n") + "\n");
  // The assistant message precedes tool_execution_start. Recovery still has the call.
  f.restart(); await f.read(); await f.read();
  assert.equal(f.doc().status, "stopped");
  assert.deepEqual(f.rows().filter(r => r.kind === "say").map(r => r.text), ["Removing the search field."]);
  assert.deepEqual(f.rows().filter(r => r.kind === "tool").map(r => r.id), ["call-1"]);
});

test("unseen Pi tool results update the managed raw IDs, including timestamp ties", async t => {
  const f = await fixture(t);
  f.message(assistant(f.at, "", ["a", "b"]));
  f.message(result(f.at + 1, "a"));
  f.message(result(f.at + 1, "b"), false);
  f.restart(); await f.read();
  assert.deepEqual(f.rows().filter(r => r.kind === "tool").map(r => [r.id, r.state, r.output]), [["a", "done", "Saved."], ["b", "done", "Saved."]]);
  assert.equal(f.doc().status, "working", "only new activity reopens the Work");
  const rec = f.service.conversations.records[`pi:${f.id}`];
  rec.lastAt = rec.mtime = Date.now() - 301000;
  await f.service.conversations.settle(f.project);
  assert.equal(f.doc().status, "stopped", "an unfinished turn going quiet is not successful completion");
});

test("all managed messages at one Pi timestamp stay handled after restart", async t => {
  const f = await fixture(t);
  f.message(assistant(f.at, "", ["a", "b"]));
  f.message(result(f.at + 1, "a")); f.message(result(f.at + 1, "b"));
  f.restart(); await f.read();
  assert.equal(f.doc().status, "stopped");
  assert.equal(f.rows().filter(r => r.kind === "tool").length, 2);
  assert.equal(f.rows().filter(r => r.state === "done").length, 2);
});

test("a final reply written during downtime completes the original Work once", async t => {
  const f = await fixture(t);
  f.message(assistant(f.at, "Looking.", ["a"]));
  f.message(result(f.at + 1, "a"));
  f.message(assistant(f.at + 2, "Removed the project finder."), false, f.at + 30000);
  const rec = f.restart(); await f.read();
  rec.lastAt = rec.mtime = Date.now() - 46000;
  await f.service.conversations.settle(f.project);
  assert.equal(f.doc().status, "done");
  assert.equal(f.doc().steps.filter(s => s.kind === "work").length, 1);
  assert.equal(f.doc().steps.find(s => s.id === f.run.stepId).done, true);
  assert.match(f.detail(), /## Result[\s\S]*Removed the project finder/);
  assert.doesNotMatch(f.detail(), /## Stopped/);
  await f.read();
  assert.equal(f.rows().filter(r => r.text === "Removed the project finder.").length, 1);
  assert.equal(f.launches, 1);
});

test("a later transcript cannot reopen work explicitly stopped by the person", async t => {
  const f = await fixture(t);
  f.message(assistant(f.at, "Looking.", ["a"]));
  f.restart();
  f.service.writeDoc(f.project, f.slug, F.setFront(f.service.readDoc(f.project, f.slug), { status:"stopped", why:"Stopped by you" }));
  f.message(assistant(f.at + 1, "A late reply."), false);
  await f.read();
  assert.equal(f.doc().status, "stopped");
  assert.equal(f.service.activityOf(f.project, f.slug, 0).running, false);
  assert.equal(f.doc().steps.find(s => s.id === f.run.stepId).done, false);
});

test("a late Pi reply cannot finish or take ownership of another managed run", async t => {
  const f = await fixture(t);
  f.message(assistant(f.at, "Looking.", ["a"]));
  f.restart();
  f.service.writeDoc(f.project, f.slug, F.setFront(f.service.readDoc(f.project, f.slug), { status:"working", who:"@other" }));
  f.service.runs.set(f.service.key(f.project, f.slug), { agent:"other", stepId:"work-2" });
  f.message(assistant(f.at + 1, "Late Pi result."), false);
  await f.read();
  const rec = f.service.conversations.records[`pi:${f.id}`];
  rec.lastAt = rec.mtime = Date.now() - 46000;
  await f.service.conversations.settle(f.project);
  assert.equal(f.doc().status, "working");
  assert.equal(f.doc().front.who, "@other");
  assert.equal(f.doc().steps.find(s => s.id === f.run.stepId).done, false);
  assert.equal(f.service.runs.get(f.service.key(f.project, f.slug)).agent, "other");
});

test("a Pi failure written during downtime is stopped rather than successful", async t => {
  const f = await fixture(t);
  f.message(assistant(f.at, "Looking.", ["a"]));
  f.message({ role:"assistant", timestamp:f.at + 1, content:[], stopReason:"error", errorMessage:"Provider timed out." }, false);
  const rec = f.restart(); await f.read();
  rec.lastAt = rec.mtime = Date.now() - 46000;
  await f.service.conversations.settle(f.project);
  assert.equal(f.doc().status, "stopped");
  assert.match(f.doc().front.why, /Provider timed out/);
  assert.match(f.detail(), /## Stopped[\s\S]*Provider timed out/);
  assert.equal(f.doc().steps.find(s => s.id === f.run.stepId).done, false);
});

test("binding a resumed session refreshes its Work without moving another Topic's binding", async t => {
  const f = await fixture(t), c = f.service.conversations;
  c.bind("pi", f.id, f.project, f.slug, f.project.docsPath, "work-2");
  assert.equal(c.records[`pi:${f.id}`].stepId, "work-2");
  c.bind("pi", f.id, f.project, "another-topic", f.project.docsPath, "work-3");
  assert.equal(c.records[`pi:${f.id}`].stepId, "work-2");
  assert.equal(c.records[`pi:${f.id}`].slug, f.slug);
});

test("Pi tool starts are idempotent and cannot regress a completed row", async t => {
  const f = await fixture(t);
  f.message(assistant(f.at, "", ["a"])); f.message(result(f.at + 1, "a"));
  f.service.agentSaid(f.project, f.slug, f.run, JSON.stringify({ type:"tool_execution_start", toolCallId:"a", toolName:"edit", args:{ path:"a.js" } }));
  assert.deepEqual(f.rows().filter(r => r.kind === "tool").map(r => [r.id, r.state]), [["a", "done"]]);
});

test("an unseen message sharing the Pi session header's timestamp is retained", async t => {
  const f = await fixture(t);
  f.message(assistant(f.at - 100, "Arrived after the session header."), false);
  f.restart(); await f.read();
  assert.equal(f.rows().filter(r => r.text === "Arrived after the session header.").length, 1);
});

const writeActive = (f, fields) => fs.writeFileSync(f.service.activeFile, JSON.stringify([{ key:f.service.key(f.project, f.slug), stepId:f.run.stepId, agent:"pi", sessionId:f.id, ...fields }]));

test("after a restart, interrupted work carries on by itself in the same conversation", async t => {
  const f = await fixture(t);
  f.message(assistant(f.at, "I found the finder.", ["edit-1"]));
  f.restart(true); await f.service.carriedOn;
  assert.equal(f.launches, 2);
  assert.equal(f.commandOptions.resume, f.id);
  assert.match(f.prompt, /PenEcho restarted while you were working on this/);
  assert.doesNotMatch(f.prompt, /Remove the project finder/, "the conversation already has your words");
  assert.equal(f.doc().status, "working");
  assert.equal(f.doc().front.why, undefined);
  assert.doesNotMatch(f.detail(), /## Stopped/);
  assert.equal(f.rows().filter(r => r.kind === "error").length, 0);
  assert.equal(f.rows().filter(r => r.kind === "note" && /carried on in the same conversation/.test(r.text)).length, 1);
  assert.ok(f.service.runs.has(f.service.key(f.project, f.slug)));
});

test("after a restart, the run's own prompt read back from its conversation is not a new Ask and does not block carrying on", async t => {
  const f = await fixture(t), prompt = f.prompt;
  const rec = f.restart();
  const asks = () => f.doc().steps.filter(s => s.kind === "ask").length, before = asks();
  rec.lastSay = "The previous Work's answer.";
  await f.service.conversationChanges(f.project, rec, [{ me:prompt, at:Date.now() }]);
  assert.equal(asks(), before, "PenEcho's own prompt is already the Ask");
  assert.equal(f.doc().status, "stopped");
  assert.equal(rec.resumedElsewhere, undefined, "the conversation is still PenEcho's to resume");
  assert.equal(rec.lastSay, "", "an earlier Work's answer is not this Work's result");
});

test("a reply written while PenEcho was closed is followed, not started again", async t => {
  const f = await fixture(t);
  f.message(assistant(f.at, "Looking.", ["a"]));
  f.message(result(f.at + 1, "a"));
  f.message(assistant(f.at + 2, "Removed the project finder."), false, f.at + 30000);
  f.restart(true); await f.service.carriedOn;
  assert.equal(f.launches, 1);
  assert.equal(f.doc().status, "working");
});

test("work stays stopped after a restart when starting work by itself is off or it keeps dying", async t => {
  const f = await fixture(t);
  f.project.autoWake = false; f.service.store.save();
  f.restart(true); await f.service.carriedOn;
  assert.equal(f.doc().status, "stopped");
  f.project.autoWake = true; f.service.store.get(f.project.id).autoWake = true; f.service.store.save();
  f.service.writeDoc(f.project, f.slug, F.setFront(f.service.readDoc(f.project, f.slug), { status:"working", why:null }));
  writeActive(f, { started:Date.now() - 1000, carried:3 });
  f.restart(true); await f.service.carriedOn;
  assert.equal(f.doc().status, "stopped");
  assert.equal(f.launches, 1);
  f.service.writeDoc(f.project, f.slug, F.setFront(f.service.readDoc(f.project, f.slug), { status:"working", why:null }));
  writeActive(f, { started:Date.now() - 10 * 60000, carried:3 });
  f.restart(true); await f.service.carriedOn;
  assert.equal(f.launches, 2, "a run that lasted a while starts counting again");
  assert.equal(f.service.runs.get(f.service.key(f.project, f.slug)).carried, 1);
});

test("inspection and a competing runtime cannot interrupt an owned Work or replace the registry", async t => {
  const f = await fixture(t), owner = f.service;
  const snapshot = () => [owner.readDoc(f.project, f.slug), f.detail(), ...[owner.activeFile, owner.conversations.file, owner.activity.fileOf(f.project, f.slug)].map(file => fs.readFileSync(file, "utf8"))];
  const before = snapshot(), passive = new Service({ directory:owner.directory, autoWatch:false });
  assert.equal(passive.readDoc(f.project, f.slug), before[0]);
  passive.saveActive();
  assert.throws(() => passive.stateOf(f.project), { code:"RUNTIME_BUSY" });
  assert.throws(() => passive.startRuntime(), { code:"RUNTIME_BUSY" });
  assert.throws(() => new Service({ directory:owner.directory, recoverOnStart:true }), { code:"RUNTIME_BUSY" });
  passive.close();
  assert.deepEqual(snapshot(), before);
  assert.equal(f.launches, 1);
});

test("an agent that outlived the previous PenEcho is left running, and its Work is recovered once it ends", async t => {
  const f = await fixture(t);
  const { spawn } = require("node:child_process");
  const agent = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio:"ignore" });
  t.after(() => { try { agent.kill("SIGKILL"); } catch {} });
  writeActive(f, { pid:agent.pid, started:Date.now() });
  const line = f.service.readDoc(f.project, f.slug), detail = f.detail();
  f.restart(true);
  assert.ok(f.service.releaseRuntime, "PenEcho starts even while an earlier agent is still running");
  assert.equal(f.service.readDoc(f.project, f.slug), line);
  assert.equal(f.detail(), detail);
  assert.equal(JSON.parse(fs.readFileSync(f.service.activeFile, "utf8"))[0].pid, agent.pid, "its record is kept");
  assert.deepEqual(f.service.checkLeftRunning(), []);
  agent.kill("SIGKILL"); await new Promise(resolve => agent.once("exit", resolve));
  const restarted = f.service.checkLeftRunning();
  assert.equal(restarted.length, 1);
  assert.equal(restarted[0].slug, f.slug);
  assert.equal(fs.existsSync(f.service.activeFile), false);
  assert.equal(f.launches, 1);
});

test("the owner reconciles only its matching interruption and completes the original Work once", async t => {
  const f = await fixture(t), { service, project, slug, run } = f;
  const step = f.doc().steps.find(s => s.id === run.stepId);
  service.interruptWork(project, slug, step, "Provider stopped");
  service.reconcileOwnedRun(project, slug, run);
  assert.equal(f.doc().front.why, "Provider stopped");
  service.interruptWork(project, slug, step);
  const stopped = f.detail();
  service.reconcileOwnedRun(project, slug, { ...run });
  assert.equal(f.detail(), stopped);
  fs.unlinkSync(service.activeFile);
  service.reconcileOwnedRun(project, slug, run);
  assert.equal(f.doc().status, "working");
  assert.equal(f.doc().front.why, undefined);
  assert.equal(F.sectionText(f.detail(), "Stopped"), null);
  assert.equal(JSON.parse(fs.readFileSync(service.activeFile))[0].stepId, step.id);
  // A second false interruption just before completion must not strand the saved result.
  service.interruptWork(project, slug, step);
  run.said = "Finished the original task.";
  await service.ended(project, slug, run, 0);
  assert.equal(f.doc().status, "done");
  assert.equal(f.doc().steps.find(s => s.id === step.id).done, true);
  assert.match(F.sectionText(f.detail(), "Result"), /Finished the original task/);
  assert.equal(f.launches, 1);
});

test('recovery preserves managed messages across a failed import without advancing the shared cursor', async t => {
  const f = await fixture(t);
  f.message(assistant(f.at, 'Already delivered', ['original']));
  const rec = f.restart(), shared = f.service.conversations.shared, file = shared.file(f.project, rec);
  const previous = JSON.parse(fs.readFileSync(file)), sameTime = rec.piCheckpoint.at;
  previous.record.piCheckpoint = { at:sameTime, hashes:['also-seen'] };
  previous.record.offset = 13;
  fs.writeFileSync(file, JSON.stringify(previous));
  const expected = new Set([...rec.piCheckpoint.hashes, 'also-seen']);
  await assert.rejects(shared.run(f.project, rec, () => {
    assert.equal(rec.interrupted, true);
    assert.deepEqual(new Set(rec.piCheckpoint.hashes), expected);
    rec.offset = 95;
    throw Error('incomplete import');
  }), /incomplete import/);
  await shared.run(f.project, rec, () => {
    assert.equal(rec.offset, 13);
    assert.deepEqual(new Set(rec.piCheckpoint.hashes), expected);
    assert.equal(rec.interrupted, true);
  });
});

test('an advanced shared importer keeps its cursor and lifecycle, and a live owner keeps its session', async t => {
  const f = await fixture(t);
  f.message(assistant(f.at, 'Delivered', ['original']));
  const rec = f.restart(), shared = f.service.conversations.shared, file = shared.file(f.project, rec);
  const later = JSON.parse(fs.readFileSync(file));
  later.writer = 'another-importer';
  later.record.active = true;
  later.record.interrupted = false;
  later.record.offset = 22;
  later.record.piCheckpoint = { at:rec.piCheckpoint.at + 1, hashes:['later'] };
  fs.writeFileSync(file, JSON.stringify(later));
  await shared.run(f.project, rec, () => {
    assert.equal(rec.active, true); assert.equal(rec.interrupted, false);
    assert.deepEqual(rec.piCheckpoint, later.record.piCheckpoint); assert.equal(rec.offset, 22);
  });
  later.record.runOwner = { host:os.hostname(), pid:process.pid };
  fs.writeFileSync(file, JSON.stringify(later));
  rec.interrupted = true;
  assert.equal(await shared.run(f.project, rec, () => assert.fail('foreign session imported')), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), later);
});

const { spawnSync: runSync, spawn: runAsync } = require("node:child_process");
const ownerModule = require.resolve("../src/server/project-lines/runtime-owner.js");
// Another PenEcho process holding the Lines of `directory`; `then` is what it does once it holds them.
function otherPenEcho(directory, then) {
  return runAsync(process.execPath, ["-e", `
    const taken = require(process.argv[2]).acquire(process.argv[1], () => ({ port:4321 }));
    if (!taken.release) process.exit(2);
    process.stdout.write("held\\n"); ${then}
  `, directory, ownerModule], { stdio:["ignore", "pipe", "inherit"] });
}
const held = child => new Promise((resolve, reject) => { child.stdout.once("data", resolve); child.once("exit", code => reject(new Error(`the other PenEcho exited ${code}`))); });

test("a PenEcho running in another process is refused and named; once it ends, the Lines can be taken over", async t => {
  const f = await fixture(t), owner = f.service;
  owner.runs.clear(); owner.close();
  const other = otherPenEcho(owner.directory, "setInterval(() => {}, 1000);");
  t.after(() => { try { other.kill("SIGKILL"); } catch {} });
  await held(other);
  assert.throws(() => new Service({ directory:owner.directory, recoverOnStart:true }), error => error.code === "RUNTIME_BUSY" && error.owner.port === 4321 && error.message.includes("port 4321"));
  other.kill("SIGKILL"); await new Promise(resolve => other.once("exit", resolve));
  const next = new Service({ directory:owner.directory, recoverOnStart:true });
  t.after(() => next.close());
  assert.ok(next.releaseRuntime);
});

test("nothing a PenEcho leaves behind keeps the next one out: a killed owner, a reused process number, a renamed computer", async t => {
  const f = await fixture(t), owner = f.service;
  owner.runs.clear(); owner.close();
  // Killed while running: its socket file stays, but nobody answers on it.
  const killed = runSync(process.execPath, ["-e", `require(process.argv[2]).acquire(process.argv[1]); process.kill(process.pid, "SIGKILL");`, owner.directory, ownerModule]);
  assert.equal(killed.signal, "SIGKILL");
  // Lock files of the earlier design, naming a live process (this one) and another computer name.
  fs.writeFileSync(path.join(owner.directory, "runtime.lock"), JSON.stringify({ pid:process.pid, host:"Old-Name.local", token:"x", at:1 }));
  writeActive(f, { pid:0, started:Date.now() - 60000 });
  f.restart();
  assert.ok(f.service.releaseRuntime, "the next PenEcho runs the Lines");
  assert.equal(f.doc().status, "stopped");
  assert.equal(f.launches, 1);
  assert.equal(fs.existsSync(owner.activeFile), false);
});

test("two PenEchos starting together: exactly one runs the Lines", async t => {
  const f = await fixture(t), owner = f.service;
  owner.runs.clear(); owner.close();
  runSync(process.execPath, ["-e", `require(process.argv[2]).acquire(process.argv[1]); process.kill(process.pid, "SIGKILL");`, owner.directory, ownerModule]);
  const racers = Array.from({ length:4 }, () => runAsync(process.execPath, ["-e", `
    const taken = require(process.argv[2]).acquire(process.argv[1]);
    process.stdout.write(taken.release ? "owner" : "busy"); setTimeout(() => process.exit(0), 2500);
  `, owner.directory, ownerModule], { stdio:["ignore", "pipe", "inherit"] }));
  const said = await Promise.all(racers.map(child => new Promise(resolve => { let text = ""; child.stdout.on("data", d => { text += d; }); child.once("exit", () => resolve(text)); })));
  assert.equal(said.filter(x => x === "owner").length, 1, said.join(","));
});

test("a server never quits over the Lines: it reads them elsewhere and takes over when the other PenEcho ends", async t => {
  const f = await fixture(t), owner = f.service;
  owner.runs.clear(); owner.close();
  const other = otherPenEcho(owner.directory, "setInterval(() => {}, 1000);");
  t.after(() => { try { other.kill("SIGKILL"); } catch {} });
  await held(other);
  const { createProjectLines } = require("../src/server/project-lines/http.js");
  const lines = createProjectLines({ directory:owner.directory, agents:{ available:() => [], useModelFile() {} }, serviceOptions:{ autoWatch:false }, authorizeRead:() => null, authorizeWrite:() => null, isThisComputer:() => true, readJson:async () => ({}), send:() => {} });
  t.after(() => lines.close());
  assert.ok(!lines.service.releaseRuntime, "it does not run them meanwhile");
  assert.equal(lines.service.runtimeBusy.port, 4321);
  other.kill("SIGKILL"); await new Promise(resolve => other.once("exit", resolve));
  for (let i = 0; i < 50 && !lines.service.releaseRuntime; i++) await new Promise(resolve => setTimeout(resolve, 200));
  assert.ok(lines.service.releaseRuntime, "it took over");
  assert.equal(lines.service.runtimeBusy, null);
});

// PE-1160: omp went on writing for the second or two it took to kill it. Read back, its unfinished turn opened the stopped Work again as "working in another app".
test("Stop stays stopped when the agent wrote more while it was being stopped", async t => {
  const f = await fixture(t), { service:s, project:p, slug, run } = f;
  s.stopGraceMs = 20; s.stopKillMs = 20;
  f.message({ role:"user", timestamp:f.at, content:[{ type:"text", text:f.prompt }] });
  f.message(assistant(f.at + 1, "", ["read-1"]));
  s.stopTree = async () => {
    f.message(assistant(Date.now() - 2, "", ["late-1"]));
    f.message(result(Date.now() - 1, "late-1"));
  };
  await s.stopWork(p, slug);
  await f.read(); await f.read();
  const line = s.stateOf(p).lines.find(l => l.id === slug), work = f.doc().steps.find(x => x.id === run.stepId);
  assert.equal(f.doc().status, "stopped");
  assert.equal(f.doc().front.why, "Stopped by you");
  assert.equal(work.done, true); assert.equal(work.off, "stopped");
  assert.equal(line.elsewhere, false); assert.equal(line.running, false);
  assert.equal(s.live.size, 0);
  // Carried on by the person in omp itself, the line follows it as before.
  await new Promise(resolve => setTimeout(resolve, 5));
  f.message({ role:"user", timestamp:Date.now(), content:[{ type:"text", text:"Go on, but shorter." }] }, false);
  await f.read();
  assert.equal(f.doc().status, "working");
  assert.equal(s.live.size, 1);
});

test("Stop drops what the watcher held of the conversation it stopped, and leaves another one's Work alone", async t => {
  const f = await fixture(t), { service:s, project:p, slug, run } = f;
  s.stopGraceMs = 20; s.stopKillMs = 20; s.stopTree = async () => {};
  const key = s.key(p, slug);
  s.live.set(key, new Map([[`pi:${f.id}`, { agent:"pi", sessionId:f.id, stepId:run.stepId }], ["codex:x", { agent:"codex", sessionId:"x", stepId:"work-9" }]]));
  await s.stopWork(p, slug);
  assert.deepEqual([...s.live.get(key).keys()], ["codex:x"]);
  assert.equal(f.doc().steps.find(x => x.id === run.stepId).off, "stopped");
  assert.equal(f.doc().status, "working", "the other conversation keeps the line working");
});

test("a Stop finished only after a restart is not undone by the killed turn", async t => {
  const f = await fixture(t), { service:s, run } = f;
  f.message(assistant(f.at + 1, "", ["read-1"]));
  run.stopping = run.userStopped = true; s.saveActive();
  f.message(assistant(Date.now() - 2, "", ["late-1"]), false);
  f.restart();
  await f.read(); await f.read();
  assert.equal(f.doc().status, "stopped");
  assert.equal(f.doc().front.why, "Stopped by you");
  assert.equal(f.service.live.size, 0);
});
