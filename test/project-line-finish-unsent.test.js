"use strict";
require("./helpers/safety.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Service } = require("../src/server/project-lines/service.js");
const F = require("../src/server/project-lines/format.js");

const agents = { available:() => [], desktop:() => null, terminal:() => "" };
const unsent = words => F.askStep({ words, when:"2026-11-12 14:53", via:F.NOT_SENT });
function setup(t, steps = [unsent("Replace the project page.")], { status = "waiting", why = F.NOT_SENT, questions = "" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "finish-unsent-")), directory = path.join(root, "state");
  const service = new Service({ directory, agents, autoWatch:false });
  const project = service.store.create({ name:"Completion", docsPath:path.join(root, "docs") });
  project.follow = false; service.store.save();
  let md = F.setFront(F.initialLine({ title:"One", status, steps }), { why });
  if (questions) md = F.setAbove(md, F.QUESTIONS, questions);
  service.writeDoc(project, "one", md); service.sync(project);
  const read = () => service.readDoc(project, "one"), doc = () => F.parseLine(read());
  const line = () => service.stateOf(project).lines.find(l => l.id === "one");
  t.after(() => { service.close(); fs.rmSync(root, { recursive:true, force:true }); });
  return { service, project, read, doc, line, directory };
}

test("an unsent Ask can be certified complete without a worker, detail file or agent run", async t => {
  const ask = unsent("Replace the project page.\n\n![Plan](../files/one/plan.png)\n\n[Notes](../files/one/notes.md)\n\n> Refers to [Another Ask](other.md) — Keep its words.");
  const { service:s, project:p, read, doc, line, directory } = setup(t, [ask]);
  const before = doc().steps[0];
  assert.equal(line().stations[0].canFinishUnsent, true);
  s.launch = () => assert.fail("completion must not launch an agent");
  s.next = () => assert.fail("completion must not advance the workflow");
  s.stopRun = () => assert.fail("completion must not stop an agent");
  await s.act(p, "one", "finish-unsent", { step:"ask-1" });
  assert.equal(doc().status, "done");
  assert.equal(doc().front.why, undefined);
  assert.match(doc().front.finished, /^\d{4}-\d\d-\d\d \d\d:\d\d$/);
  assert.equal(doc().steps.length, 1);
  const after = doc().steps[0], station = line().stations[0];
  for (const key of ["body", "when", "id", "who"]) assert.equal(after[key], before[key], key);
  assert.equal(F.isFinishedAsk(after), true);
  assert.deepEqual({ state:station.state, unsent:station.unsent, reviewed:station.reviewed, finishedAsk:station.finishedAsk, detail:station.detail }, { state:"done", unsent:false, reviewed:true, finishedAsk:true, detail:"" });
  assert.equal(s.store.exists(p, "topics/one/ask-1.md"), false);
  assert.equal(s.runs.size, 0);
  assert.deepEqual(F.topicFingerprint(doc()).asks, []);
  assert.match(read(), /## Ask · 2026-11-12 14:53 · Finished & reviewed/);
  const again = new Service({ directory, agents, autoWatch:false });
  t.after(() => again.close());
  const saved = again.stateOf(again.store.projects[0]).lines.find(l => l.id === "one");
  assert.equal(saved.status, "done");
  assert.equal(saved.stations[0].finishedAsk, true);
  assert.equal(saved.stations[0].reviewed, true);
});

test("finishing a queued Ask clears only its own computer hold", async t => {
  const marker = "> Held · computer · agent codex · computer laptop-01";
  const { service:s, project:p, doc, read } = setup(t, [unsent("First\n\n" + marker), unsent("Second\n\n" + marker)]);
  await s.act(p, "one", "finish-unsent", { step:"ask-2" });
  const [first, second] = doc().steps;
  assert.ok(F.isUnsent(first) && first.held);
  assert.ok(F.isFinishedAsk(second));
  assert.equal(second.held, null);
  assert.equal(read().split(marker).length - 1, 1);
});

test("completing a later unsent Ask preserves exact content, order and all Work IDs", async t => {
  const { service:s, project:p, read, doc, line } = setup(t, [F.askStep({ words:"Earlier request" }), F.workStep({ who:"codex", done:true, body:"Earlier result" }), unsent("First pending"), unsent("Second pending")]);
  const original = read();
  await s.act(p, "one", "finish-unsent", { step:"ask-3" });
  assert.equal(read(), original.replace(/(## Ask · 2026-11-12 14:53 · )Not sent(?=\n\nSecond pending)/, "$1Finished & reviewed"));
  assert.deepEqual(doc().steps.map(s => s.id), ["ask-1", "work-1", "ask-2", "ask-3"]);
  assert.equal(line().stations.find(s => s.id === "ask-2").unsent, true);
  assert.equal(doc().status, "waiting");
  assert.equal(doc().front.why, F.NOT_SENT);
  assert.equal(doc().front.finished, undefined);
  assert.deepEqual(F.asksFor(doc().steps, doc().steps[1]).map(a => a.text), ["Earlier request"]);
  assert.deepEqual(F.topicFingerprint(doc()).asks, [F.hashText("Earlier request")]);
  await s.act(p, "one", "finish-unsent", { step:"ask-2" });
  assert.equal(doc().status, "done");
  assert.equal(line().stations.find(s => s.id === "work-1").reviewed, false, "existing results still need their own review");
});

for (const [name, steps, options, prepare] of [
  ["active Work", [F.workStep({ who:"codex" }), unsent("Already done elsewhere")], { status:"working", why:"Keep going" }],
  ["pending merge", [unsent("Already done elsewhere"), { kind:"merge", num:0, done:false, who:"you", body:"" }], { status:"ready", why:"Only you merge" }],
  ["unresolved question", [unsent("Already done elsewhere")], { questions:"**Which branch?**\n\n- [ ] Main\n- [ ] Another branch", why:"Choose a branch" }],
  ["live run", [unsent("Already done elsewhere")], { status:"working", why:"Still working" }, (s, p) => s.runs.set(s.key(p, "one"), { started:Date.now() })],
  ["live conversation", [unsent("Already done elsewhere")], { status:"working", why:"Still working" }, (s, p) => s.live.set(s.key(p, "one"), new Map([["external", { agent:"codex", started:Date.now() }]]))],
  ["ready line", [unsent("Already done elsewhere")], { status:"ready", why:"Not merged" }],
]) test(`certifying an Ask leaves ${name} and its blocker alone`, async t => {
  const { service:s, project:p, doc } = setup(t, steps, options);
  prepare?.(s, p);
  const before = doc();
  await s.act(p, "one", "finish-unsent", { step:"ask-1" });
  assert.equal(doc().status, before.status);
  assert.equal(doc().front.why, before.front.why);
  assert.equal(doc().front.finished, undefined);
  assert.equal(F.isFinishedAsk(doc().steps.find(s => s.id === "ask-1")), true);
  assert.deepEqual(doc().steps.filter(s => s.kind !== "ask"), before.steps.filter(s => s.kind !== "ask"));
  assert.deepEqual(doc().questions, before.questions);
});

test("stale or invalid completion requests do not change the line", async t => {
  const { service:s, project:p, read } = setup(t);
  for (const step of ["", "ask-9", "work-1"]) {
    const original = read();
    await assert.rejects(s.act(p, "one", "finish-unsent", { step }), { code:"NOT_UNSENT" });
    assert.equal(read(), original);
  }
  await s.act(p, "one", "finish-unsent", { step:"ask-1" });
  const marked = read();
  await assert.rejects(s.act(p, "one", "finish-unsent", { step:"ask-1" }), { code:"NOT_UNSENT" });
  assert.equal(read(), marked);
});

test("a sent Ask and an archived line cannot be certified through a stale button", async t => {
  const { service:s, project:p, read } = setup(t, [F.askStep({ words:"Sent already" }), unsent("Still pending")]);
  const original = read();
  await assert.rejects(s.act(p, "one", "finish-unsent", { step:"ask-1" }), { code:"NOT_UNSENT" });
  assert.equal(read(), original);
  s.writeDoc(p, "one", F.setFront(read(), { status:"closed" }));
  const closed = read();
  await assert.rejects(s.act(p, "one", "finish-unsent", { step:"ask-2" }), { code:"ARCHIVED" });
  assert.equal(read(), closed);
});

test("a failed write preserves both the request and its unfinished status", async t => {
  const { service:s, project:p, read, line } = setup(t);
  const original = read();
  s.writeDoc = () => { throw new Error("Disk is full"); };
  await assert.rejects(s.act(p, "one", "finish-unsent", { step:"ask-1" }), /Disk is full/);
  assert.equal(read(), original);
  assert.equal(line().stations[0].unsent, true);
  assert.equal(line().stations[0].reviewed, false);
});

test("background pickup never sends a completed Ask, including repeated refreshes", async t => {
  const { service:s, project:p, read } = setup(t);
  await s.act(p, "one", "finish-unsent", { step:"ask-1" });
  const completed = read();
  s.handOn = () => assert.fail("a completed Ask must not wake an agent");
  assert.equal(await s.pickUp(p, "one"), false);
  assert.equal(await s.pickUp(p, "one"), false);
  assert.equal(read(), completed);
});

for (const blocked of ["work", "question"]) test(`background pickup preserves ${blocked} still pending after certification`, async t => {
  const expectedStatus = blocked === "work" ? "not-started" : "waiting";
  const { service:s, project:p, doc } = setup(t,
    [...(blocked === "work" ? [F.workStep({ who:"codex" })] : []), unsent("Done elsewhere")],
    { status:expectedStatus, why:F.NOT_SENT, ...(blocked === "question" ? { questions:"**Which branch?**\n\n- [ ] Main\n- [ ] Another" } : {}) });
  await s.act(p, "one", "finish-unsent", { step:"ask-1" });
  s.handOn = () => assert.fail("a completed Ask must not wake an agent");
  assert.equal(await s.pickUp(p, "one"), false);
  assert.equal(doc().status, expectedStatus);
  assert.equal(doc().front.why, F.NOT_SENT);
});

test("ending another Work does not create a new Work for an Ask completed elsewhere", async t => {
  const { service:s, project:p, doc } = setup(t, [F.askStep({ words:"Do this first" }), F.workStep({ who:"codex" }), unsent("Done elsewhere")], { status:"working", why:null });
  await s.act(p, "one", "finish-unsent", { step:"ask-2" });
  s.writeDoc(p, "one", F.updateSteps(s.readDoc(p, "one"), steps => { steps.find(x => x.id === "work-1").done = true; }));
  s.launch = () => assert.fail("a completed Ask must not start another Work");
  await s.next(p, "one");
  assert.deepEqual(doc().steps.map(s => s.id), ["ask-1", "work-1", "ask-2"]);
  assert.equal(doc().status, "done");
});

test("a fresh agent receives only sent Asks and their attachments", async t => {
  const finished = F.askStep({ words:"Already completed request", via:F.FINISHED_ASK, refs:["[Old file](../files/one/old.txt)"] });
  const sent = F.askStep({ words:"The actual new request", refs:["[New file](../files/one/new.txt)"] });
  const pending = unsent("Still waiting for permission to send\n\n[Pending file](../files/one/pending.txt)");
  const { service:s, project:p, doc } = setup(t, [finished, sent, F.workStep({ who:"codex" }), pending], { status:"working", why:null });
  for (const file of ["old", "new", "pending"]) s.store.writeBytes(p, `files/one/${file}.txt`, Buffer.from(file));
  let prompt;
  s.agents = { ...agents, available:() => [{ id:"codex", available:true }], nameOf:id => id, command:() => ({ command:"unused", args:[], ownInstructions:true }) };
  s.runCanvas = async () => "";
  s.recordStart = (_project, _slug, _step, entry) => { prompt = entry.prompt; throw new Error("Captured test prompt"); };
  s.spawn = () => assert.fail("this test must not start a process");
  await s.launch(p, "one", doc().steps.find(x => x.id === "work-1"), doc());
  assert.equal(doc().status, "stopped");
  assert.match(doc().front.why, /Captured test prompt/);
  const detail = s.store.readText(p, F.detailPath("one", "work-1")).text;
  assert.match(F.sectionText(detail, "Stopped"), /Captured test prompt/);
  assert.equal(F.splitFront(detail).front["stop why"], "error");
  assert.equal(s.runs.size, 0);
  assert.equal(s.startingWorks.size, 0);
  assert.match(prompt, /The actual new request/);
  assert.match(prompt, /files\/one\/new.txt/);
  assert.doesNotMatch(prompt, /Already completed request|old\.txt|Still waiting for permission|pending\.txt/);
});
