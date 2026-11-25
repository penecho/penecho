"use strict";
require("./helpers/safety.js");
// PE-726 / PE-720: a second PenEcho instance watching the same project folder could mark a Line
// "stopped" ("PenEcho closed while this was running") during the owning server's endRun() save
// window, leaving the Work checked off Done while the Line stayed Stopped.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Service } = require("../src/server/project-lines/service.js");
const F = require("../src/server/project-lines/format.js");
const L = require("../src/server/project-lines/layout.js");

const INTERRUPTED = "PenEcho closed while this was running. Retry to continue from the saved conversation and files.";
const agents = { available:() => [{ id:"codex", available:true, name:"Codex" }], desktop:() => null, terminal:() => "", classifier:() => null, command:() => ({ command:"stand-in", args:[] }) };

async function twoServices(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-multi-end-"));
  const docsPath = path.join(root, "docs");
  const owner = new Service({ directory:path.join(root, "owner"), agents, autoWatch:false, conversations:{ home:path.join(root, "home-a"), env:{} } });
  const watcher = new Service({ directory:path.join(root, "watcher"), agents, autoWatch:false, conversations:{ home:path.join(root, "home-b"), env:{} } });
  t.after(() => { owner.close?.(); watcher.close?.(); fs.rmSync(root, { recursive:true, force:true }); });
  const ownerProject = owner.store.create({ name:"Shared", docsPath });
  const watcherProject = watcher.store.importFolder({ docsPath });
  ownerProject.follow = false; owner.store.save();
  watcherProject.follow = false; watcher.store.save();
  const slug = "shared-line";
  owner.writeDoc(ownerProject, slug, F.initialLine({ title:"Shared work", status:"working", steps:[F.askStep({ words:"Fix the settings." }), F.workStep({ who:"codex" })] }));
  owner.sync(ownerProject);
  const age = ms => { const file = path.join(docsPath, L.linePath(slug)), when = new Date(Date.now() - ms); fs.utimesSync(file, when, when); owner.changed(ownerProject); };
  const doc = () => F.parseLine(owner.readDoc(ownerProject, slug));
  const detail = (stepId = "work-1") => owner.store.readText(ownerProject, F.detailPath(slug, stepId)).text;
  return { root, docsPath, owner, watcher, ownerProject, watcherProject, slug, age, doc, detail };
}

test("owning server keeps runOwner through endRun and next so a second PenEcho cannot interrupt during save", async t => {
  const { owner, watcher, ownerProject, watcherProject, slug, age, doc, detail } = await twoServices(t);
  const key = owner.key(ownerProject, slug);
  const run = { agent:"codex", sessionId:"thread-1", stepId:"work-1", said:"All 74 tests pass.", buffer:"", tail:"", started:Date.now() - 9 * 60000, workdir:"", head:"" };
  owner.runs.set(key, run);
  owner.conversations.bind("codex", "thread-1", ownerProject, slug, "", "work-1");
  // Watcher knows about the same session from its own scan, with no reply of its own.
  watcher.conversations.recordOf("codex", "thread-1", { projectId:watcherProject.id, slug, stepId:"work-1", startedHere:true, active:false, lastAt:0, lastSay:"" });
  age(9 * 60000);

  let settledDuringSave = false;
  let ownerHeldDuringSave = false;
  const origClose = owner.closeDetail.bind(owner);
  owner.closeDetail = async (...args) => {
    const out = await origClose(...args);
    const sharedFile = owner.conversations.shared.file(ownerProject, owner.conversations.records["codex:thread-1"]);
    const saved = JSON.parse(fs.readFileSync(sharedFile, "utf8"));
    ownerHeldDuringSave = Boolean(saved.record?.runOwner);
    // Second PenEcho watches the same folder during the exact save window.
    await watcher.conversations.settleStale(watcherProject);
    settledDuringSave = true;
    return out;
  };

  await owner.ended(ownerProject, slug, run, 0);
  assert.equal(settledDuringSave, true);
  assert.equal(ownerHeldDuringSave, true, "shared runOwner must remain held until endRun and next finish");
  const now = doc(), work = now.steps.find(s => s.id === "work-1");
  assert.equal(now.status, "done");
  assert.equal(now.front.why, undefined);
  assert.equal(work.done, true);
  assert.match(F.sectionText(detail(), "Result"), /All 74 tests pass/);
  assert.equal(F.sectionText(detail(), "Stopped"), null);
  const sharedFile = owner.conversations.shared.file(ownerProject, owner.conversations.records["codex:thread-1"]);
  const after = JSON.parse(fs.readFileSync(sharedFile, "utf8"));
  assert.equal(after.record.runOwner, undefined, "runOwner is released once ended() completes");
  assert.ok(after.record.runEndedAt > 0, "runEndedAt is stamped when runOwner is released");
});

test("endRun reconciles a false interruption written by an older PenEcho during closeDetail", async t => {
  const { owner, ownerProject, slug, doc, detail } = await twoServices(t);
  const key = owner.key(ownerProject, slug);
  const run = { agent:"codex", sessionId:"thread-2", stepId:"work-1", said:"Completed cleanly.", buffer:"", tail:"", started:Date.now() - 5 * 60000, workdir:"", head:"" };
  owner.runs.set(key, run);

  const origClose = owner.closeDetail.bind(owner);
  owner.closeDetail = async (...args) => {
    await origClose(...args);
    // Simulate an older PenEcho Desktop instance overwriting both the Line and detail file mid-save.
    const rel = F.detailPath(slug, "work-1");
    owner.store.writeText(ownerProject, rel, F.setSection(owner.store.readText(ownerProject, rel).text, "Stopped", INTERRUPTED, ["Result"]));
    owner.writeDoc(ownerProject, slug, F.setFront(owner.readDoc(ownerProject, slug), { status:"stopped", why:INTERRUPTED }));
  };

  await owner.ended(ownerProject, slug, run, 0);
  const now = doc(), work = now.steps.find(s => s.id === "work-1");
  assert.equal(now.status, "done");
  assert.equal(now.front.why, undefined);
  assert.equal(work.done, true);
  assert.equal(F.sectionText(detail(), "Stopped"), null);
  assert.match(F.sectionText(detail(), "Result"), /Completed cleanly/);
});

test("a real agent failure overwrites a competing false interruption instead of leaving PenEcho-closed", async t => {
  const { owner, ownerProject, slug, doc } = await twoServices(t);
  const key = owner.key(ownerProject, slug);
  const run = { agent:"codex", sessionId:"thread-3", stepId:"work-1", said:"", failed:"codex crashed with ECONNRESET", buffer:"", tail:"", started:Date.now() - 60000, workdir:"", head:"" };
  owner.runs.set(key, run);
  const origClose = owner.closeDetail.bind(owner);
  owner.closeDetail = async (...args) => {
    await origClose(...args);
    owner.writeDoc(ownerProject, slug, F.setFront(owner.readDoc(ownerProject, slug), { status:"stopped", why:INTERRUPTED }));
  };

  await owner.ended(ownerProject, slug, run, 1);
  assert.equal(doc().status, "stopped");
  assert.match(doc().front.why, /codex crashed with ECONNRESET/);
});

test("endRun preserves a status the agent itself set, such as waiting for user decision", async t => {
  const { owner, ownerProject, slug, doc } = await twoServices(t);
  const key = owner.key(ownerProject, slug);
  const run = { agent:"codex", sessionId:"thread-4", stepId:"work-1", said:"Please choose option A or B.", buffer:"", tail:"", started:Date.now() - 60000, workdir:"", head:"" };
  owner.runs.set(key, run);
  owner.writeDoc(ownerProject, slug, F.setFront(owner.readDoc(ownerProject, slug), { status:"waiting", why:"Need your decision" }));

  await owner.ended(ownerProject, slug, run, 0);
  assert.equal(doc().status, "waiting");
  assert.equal(doc().front.why, "Need your decision");
});

test("interruptWork refuses to interrupt a Work that is already checked off or closed with a result", async t => {
  const { owner, ownerProject, slug, doc } = await twoServices(t);
  const step = doc().steps.find(s => s.id === "work-1");
  await owner.closeDetail(ownerProject, slug, "work-1", { result:"Done.", took:"2 min" });
  // Detail has ended without stop why: even before step is ticked, INTERRUPTED must not overwrite it.
  assert.equal(owner.interruptWork(ownerProject, slug, step), false);
  assert.equal(doc().status, "working");
  // Once step is checked off, interruptWork refuses any reason.
  owner.writeDoc(ownerProject, slug, F.updateSteps(owner.readDoc(ownerProject, slug), steps => { F.closeStep(steps.find(s => s.id === "work-1"), { slug, took:"2 min", summary:"Done." }); }));
  assert.equal(owner.interruptWork(ownerProject, slug, step, "Some error"), false);
  assert.equal(doc().status, "working");
});

test("watchAll heals a Line stranded as stopped/INTERRUPTED when all Works after its last Ask finished cleanly", async t => {
  const { owner, ownerProject, slug, age, doc, detail } = await twoServices(t);
  await owner.closeDetail(ownerProject, slug, "work-1", { result:"Finished cleanly.", took:"9 min", ended:new Date(2026, 10, 19, 8, 59).getTime() });
  const rel = F.detailPath(slug, "work-1");
  owner.store.writeText(ownerProject, rel, F.setSection(owner.store.readText(ownerProject, rel).text, "Stopped", INTERRUPTED, ["Result"]));
  let md = F.updateSteps(owner.readDoc(ownerProject, slug), steps => { F.closeStep(steps.find(s => s.id === "work-1"), { slug, took:"9 min", summary:"Finished cleanly." }); });
  owner.writeDoc(ownerProject, slug, F.setFront(md, { status:"stopped", why:INTERRUPTED }));
  // Freshly written file waits a minute so an active save settles first.
  await owner.watchAll();
  assert.equal(doc().status, "stopped");
  age(2 * 60000);
  await owner.watchAll();
  assert.equal(doc().status, "done");
  assert.equal(doc().front.why, undefined);
  assert.equal(doc().front.finished, "2026-11-19 08:59");
  assert.equal(F.sectionText(detail(), "Stopped"), null);
});

test("watchAll leaves genuinely stopped Lines alone", async t => {
  const { owner, ownerProject, slug, age, doc } = await twoServices(t);
  // Case 1: open (undone) Work with INTERRUPTED stays stopped.
  owner.writeDoc(ownerProject, slug, F.setFront(owner.readDoc(ownerProject, slug), { status:"stopped", why:INTERRUPTED }));
  age(2 * 60000);
  await owner.watchAll();
  assert.equal(doc().status, "stopped");

  // Case 2: Work closed with stop why in detail stays stopped.
  await owner.closeDetail(ownerProject, slug, "work-1", { stopped:"Out of credits", why:"limit", result:"" });
  let md = F.updateSteps(owner.readDoc(ownerProject, slug), steps => { const s = steps.find(x => x.id === "work-1"); s.done = true; s.off = "stopped"; });
  owner.writeDoc(ownerProject, slug, F.setFront(md, { status:"stopped", why:INTERRUPTED }));
  age(2 * 60000);
  await owner.watchAll();
  assert.equal(doc().status, "stopped");

  // Case 3: Done Work with a different stop reason stays stopped.
  await owner.closeDetail(ownerProject, slug, "work-1", { result:"Done.", took:"1 min" });
  md = F.updateSteps(owner.readDoc(ownerProject, slug), steps => { const s = steps.find(x => x.id === "work-1"); s.done = true; s.off = ""; });
  owner.writeDoc(ownerProject, slug, F.setFront(md, { status:"stopped", why:"Custom error" }));
  age(2 * 60000);
  await owner.watchAll();
  assert.equal(doc().status, "stopped");
  assert.equal(doc().front.why, "Custom error");
});

test("retrying a stuck run on the same session keeps runOwner held without releasing it in ended()", async t => {
  const { owner, ownerProject, slug } = await twoServices(t);
  const key = owner.key(ownerProject, slug);
  const run = { agent:"codex", sessionId:"thread-retry", stepId:"work-1", ending:"stuck", said:"", buffer:"", tail:"", started:Date.now() - 60000, workdir:"", head:"" };
  owner.runs.set(key, run);
  owner.conversations.bind("codex", "thread-retry", ownerProject, slug, "", "work-1");
  let relaunched = false;
  owner.launch = async (project, s, step) => {
    relaunched = true;
    const replacement = { agent:"codex", sessionId:"thread-retry", stepId:step.id, said:"", buffer:"", tail:"", started:Date.now(), workdir:"", head:"" };
    owner.runs.set(key, replacement);
    owner.conversations.bind("codex", "thread-retry", project, s, "", step.id);
  };
  await owner.ended(ownerProject, slug, run, 1);
  assert.equal(relaunched, true);
  const sharedFile = owner.conversations.shared.file(ownerProject, owner.conversations.records["codex:thread-retry"]);
  const saved = JSON.parse(fs.readFileSync(sharedFile, "utf8"));
  assert.ok(saved.record.runOwner, "runOwner must stay held for the retried run on the same session");
  owner.runs.delete(key);
});

test("ended() keeps retrying under sustained session lock contention until runOwner is cleared on disk", async t => {
  const { owner, watcher, ownerProject, watcherProject, slug } = await twoServices(t);
  const key = owner.key(ownerProject, slug);
  const run = { agent:"codex", sessionId:"thread-lock-end", stepId:"work-1", said:"Done.", buffer:"", tail:"", started:Date.now() - 60000, workdir:"", head:"" };
  owner.runs.set(key, run);
  owner.conversations.bind("codex", "thread-lock-end", ownerProject, slug, "", "work-1");
  const rec = owner.conversations.records["codex:thread-lock-end"];
  const sharedFile = owner.conversations.shared.file(ownerProject, rec);
  const lockFile = `${sharedFile}.lock`;
  // Hold the session lock for 160ms across ended() so the first attempt and first 50ms retry both contend.
  fs.writeFileSync(lockFile, JSON.stringify({ pid:process.pid, host:os.hostname(), instance:"external-holder", token:"t1", at:Date.now() }));
  setTimeout(() => { try { fs.unlinkSync(lockFile); } catch {} }, 160);

  await owner.ended(ownerProject, slug, run, 0);
  // Wait for the backoff retry after the lock clears.
  const deadline = Date.now() + 2000;
  let cleared = false;
  while (Date.now() < deadline) {
    const saved = JSON.parse(fs.readFileSync(sharedFile, "utf8"));
    if (!saved.record.runOwner) { cleared = true; break; }
    await new Promise(r => setTimeout(r, 30));
  }
  assert.equal(cleared, true, "runOwner must eventually be cleared once lock contention ends");
  const wRec = watcher.conversations.recordOf("codex", "thread-lock-end", { projectId:watcherProject.id, slug, stepId:"work-1" });
  let ran = false;
  assert.equal(await watcher.conversations.shared.run(watcherProject, wRec, () => { ran = true; }), true);
  assert.equal(ran, true, "second instance can now import the session after release");
});

test("bind() retries under session lock contention so a live run still claims runOwner", async t => {
  const { owner, watcher, ownerProject, watcherProject, slug, age, doc } = await twoServices(t);
  const key = owner.key(ownerProject, slug);
  const run = { agent:"codex", sessionId:"thread-lock-bind", stepId:"work-1", said:"", buffer:"", tail:"", started:Date.now() - 60000, workdir:"", head:"" };
  owner.runs.set(key, run);
  const rec = owner.conversations.recordOf("codex", "thread-lock-bind", { projectId:ownerProject.id, slug, stepId:"work-1", startedHere:true });
  const sharedFile = owner.conversations.shared.file(ownerProject, rec);
  fs.mkdirSync(path.dirname(sharedFile), { recursive:true });
  const lockFile = `${sharedFile}.lock`;
  fs.writeFileSync(lockFile, JSON.stringify({ pid:process.pid, host:os.hostname(), instance:"external-holder", token:"t2", at:Date.now() }));
  setTimeout(() => { try { fs.unlinkSync(lockFile); } catch {} }, 120);

  owner.conversations.bind("codex", "thread-lock-bind", ownerProject, slug, "", "work-1");
  const deadline = Date.now() + 2000;
  let claimed = false;
  while (Date.now() < deadline) {
    if (fs.existsSync(sharedFile)) {
      const saved = JSON.parse(fs.readFileSync(sharedFile, "utf8"));
      if (saved.record.runOwner?.instance === owner.conversations.shared.instance) { claimed = true; break; }
    }
    await new Promise(r => setTimeout(r, 30));
  }
  assert.equal(claimed, true, "live run must claim runOwner once lock clears");
  watcher.conversations.recordOf("codex", "thread-lock-bind", { projectId:watcherProject.id, slug, stepId:"work-1", startedHere:true, active:false, lastAt:0, lastSay:"" });
  age(2 * 60000);
  await watcher.conversations.settleStale(watcherProject);
  assert.equal(doc().status, "working", "second instance must not interrupt the claimed live run");
  owner.runs.delete(key);
});

test("crash between closeDetail and step tick recovers by closing the Work instead of stranding Working", async t => {
  const { root, docsPath, owner, ownerProject, slug, doc } = await twoServices(t);
  await owner.closeDetail(ownerProject, slug, "work-1", { result:"Saved right before crash.", took:"4 min", ended:new Date(2026, 10, 19, 10, 15).getTime() });
  // Active runs registry still lists work-1 (simulating crash right after closeDetail, before ticking step).
  const activeFile = owner.activeFile;
  fs.writeFileSync(activeFile, JSON.stringify([{ key:owner.key(ownerProject, slug), stepId:"work-1", agent:"codex", started:Date.now() - 4 * 60000 }]));
  owner.close();

  const restarted = new Service({ directory:path.join(root, "owner"), agents, autoWatch:false, carryOn:true, recoverOnStart:true, conversations:{ home:path.join(root, "home-a"), env:{} } });
  t.after(() => restarted.close?.());
  await restarted.carriedOn;
  const p = restarted.store.get(ownerProject.id);
  const now = F.parseLine(restarted.readDoc(p, slug)), work = now.steps.find(s => s.id === "work-1");
  assert.equal(work.done, true, "already-ended Work is ticked off on recovery");
  assert.equal(now.status, "done", "Line transitions to done instead of stranding at working");
  assert.equal(now.front.finished, "2026-11-19 10:15");
});

test("conversationQuiet closes an open Work whose detail already ended cleanly instead of stranding Working", async t => {
  const { owner, ownerProject, slug, doc } = await twoServices(t);
  await owner.closeDetail(ownerProject, slug, "work-1", { result:"Already saved.", took:"2 min", ended:new Date(2026, 10, 19, 11, 20).getTime() });
  const rec = { agent:"codex", id:"thread-quiet-ended", projectId:ownerProject.id, slug, stepId:"work-1", startedHere:true, active:false, lastAt:0, lastSay:"" };
  await owner.conversationQuiet(ownerProject, rec);
  const now = doc(), work = now.steps.find(s => s.id === "work-1");
  assert.equal(work.done, true);
  assert.equal(now.status, "done");
  assert.equal(now.front.finished, "2026-11-19 11:20");
});

test("watchAll reconciles a false interruption during a live run and handles parallel lanes safely", async t => {
  const { owner, ownerProject, slug, doc } = await twoServices(t);
  owner.startRuntime({ autoWatch:false, recoverOnStart:false });
  const key = owner.key(ownerProject, slug);
  // Two parallel Works on the same Line.
  owner.writeDoc(ownerProject, slug, F.initialLine({ title:"Parallel", status:"working", steps:[F.askStep({ words:"Compare." }), F.workStep({ who:"codex" }), F.workStep({ who:"codex" })] }));
  const run1 = { agent:"codex", sessionId:"t-p1", stepId:"work-1", said:"First opinion.", buffer:"", tail:"", started:Date.now() - 60000, workdir:"", head:"" };
  const run2 = { agent:"codex", sessionId:"t-p2", stepId:"work-2", lane:true, said:"Second opinion.", buffer:"", tail:"", started:Date.now() - 60000, workdir:"", head:"" };
  owner.runs.set(key, run1);
  owner.lanes.set(key, new Map([["work-2", run2]]));
  owner.store.writeText(ownerProject, F.detailPath(slug, "work-1"), F.initialDetail({ slug, title:"Parallel", label:"Work 1", who:"codex", started:F.nowLabel(), asks:[], now:"Working" }));
  owner.store.writeText(ownerProject, F.detailPath(slug, "work-2"), F.initialDetail({ slug, title:"Parallel", label:"Work 2", who:"codex", started:F.nowLabel(), asks:[], now:"Working" }));

  // Competing older instance interrupts the Line mid-run.
  owner.writeDoc(ownerProject, slug, F.setFront(owner.readDoc(ownerProject, slug), { status:"stopped", why:INTERRUPTED }));
  await owner.watchAll();
  assert.equal(doc().status, "working", "watchAll reconciles the live run before it ends");

  // Primary finishes first while lane 2 is still running.
  await owner.ended(ownerProject, slug, run1, 0);
  assert.equal(doc().status, "working", "Line stays working while parallel lane is still running");

  // Competing older instance interrupts during lane 2's closeDetail; lane 2 is the last Work and restores + finishes the Line.
  const origClose = owner.closeDetail.bind(owner);
  owner.closeDetail = async (...args) => {
    await origClose(...args);
    owner.writeDoc(ownerProject, slug, F.setFront(owner.readDoc(ownerProject, slug), { status:"stopped", why:INTERRUPTED }));
  };
  await owner.ended(ownerProject, slug, run2, 0);
  assert.equal(doc().status, "done");
  assert.equal(doc().steps.filter(s => s.kind === "work").every(s => s.done && !s.off), true);
});
