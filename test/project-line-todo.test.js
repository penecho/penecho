"use strict";
require("./helpers/safety.js");
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { Service } = require("../src/server/project-lines/service.js");
const F = require("../src/server/project-lines/format.js");
const STATUS = require("../public/lines/line-status.js");
const agents = { available:() => [], desktop:() => null, terminal:() => "" };
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "line-todo-")), directory = path.join(root, "state");
  const s = new Service({ directory, agents, autoWatch:false, memory:{ home:path.join(root, "home"), env:{} } });
  const p = s.store.create({ name:"Todo", docsPath:path.join(root, "docs") });
  p.follow = false; s.store.save();
  s.writeDoc(p, "one", F.initialLine({ title:"Uncertain outcome", status:"done", steps:[F.askStep({ words:"Try an idea" }), F.workStep({ who:"codex", done:true, took:"2 min", body:"Here is the result." })] }));
  s.store.writeText(p, "topics/one/work-1.md", F.setResult(F.initialDetail({ slug:"one", title:"Uncertain outcome", label:"Work 1", who:"codex", started:"2026-11-15 04:00", now:"" }), "Keep this result intact."));
  s.sync(p);
  const line = () => s.stateOf(p).lines.find(l => l.id === "one");
  const detail = () => s.store.readText(p, "topics/one/work-1.md").text;
  t.after(() => { s.close(); fs.rmSync(root, { recursive:true, force:true }); });
  return { s, p, directory, line, detail };
}

test("Todo persists independently of execution, reviews, results, read receipts and activity order", async t => {
  const { s, p, directory, line, detail } = setup(t), before = line(), result = detail(), rev = s.stateOf(p).rev;
  await s.act(p, "one", "todo", { todo:true });
  assert.equal(line().status, before.status);
  assert.equal(line().readRevision, before.readRevision);
  assert.equal(line().updatedAt, before.updatedAt);
  assert.equal(line().lastActivityAt, before.lastActivityAt);
  assert.equal(detail(), result);
  assert.equal(STATUS.shownState(line()), "todo");
  assert.equal(STATUS.toReview(line()), false);
  assert.equal(STATUS.toLookAt(line()), true);
  assert.equal(STATUS.matches(line(), "todo"), true);
  assert.notEqual(s.stateOf(p).rev, rev);
  for (const view of ["home", "rail"]) assert.equal(STATUS.shownState(s.stateFor(p, view).lines[0]), "todo");
  const marked = s.readDoc(p, "one");
  await s.act(p, "one", "todo", { todo:true });
  assert.equal(s.readDoc(p, "one"), marked, "marking twice is idempotent");
  const again = new Service({ directory, agents, autoWatch:false }); t.after(() => again.close());
  assert.equal(STATUS.shownState(again.stateOf(again.store.projects[0]).lines[0]), "todo");
  await s.act(p, "one", "todo", { todo:false });
  assert.equal(STATUS.shownState(line()), "review");
  assert.equal(detail(), result);
});

test("Todo works on reviewed lines; individual reviews preserve it and review-all clears it", async t => {
  const { s, p, line } = setup(t);
  await s.act(p, "one", "review-all");
  await s.act(p, "one", "todo", { todo:true });
  assert.equal(line().stations[1].reviewed, true);
  await s.act(p, "one", "todo", { todo:false });
  assert.equal(STATUS.shownState(line()), "landed");
  await s.act(p, "one", "todo", { todo:true });
  await s.act(p, "one", "review", { step:"work-1", reviewed:false });
  assert.equal(STATUS.shownState(line()), "todo");
  await s.act(p, "one", "review-all");
  assert.equal(line().todo, false);
  assert.equal(line().stations[1].reviewed, true);
  assert.equal(F.splitFront(s.readDoc(p, "one")).front.todo, undefined);
});

test("starting a new Work or resuming the old one clears the previous Todo", async t => {
  const { s, p, line } = setup(t);
  await s.act(p, "one", "todo", { todo:true });
  s.resumeWork(p, { slug:"one", stepId:"work-1" }); s.sync(p);
  assert.equal(line().todo, false);
  assert.equal(STATUS.shownState(line()), "working");
  s.writeDoc(p, "one", F.setFront(F.updateSteps(s.readDoc(p, "one"), steps => { F.closeStep(steps[1], { slug:"one", summary:"More work.", took:"3 min" }); }), { status:"done" })); s.sync(p);
  assert.equal(STATUS.shownState(line()), "review");
  await s.act(p, "one", "todo", { todo:true });
  s.writeDoc(p, "one", F.setFront(F.updateSteps(s.readDoc(p, "one"), steps => { steps.push(F.askStep({ words:"Now do this" }), F.workStep({ who:"codex" })); }), { status:"working" })); s.sync(p);
  assert.equal(line().todo, false);
});

test("archive and outdated hide Todo, while reopen preserves the disposition", async t => {
  const { s, p, line } = setup(t);
  await s.act(p, "one", "todo", { todo:true });
  for (const verb of ["close", "outdated"]) {
    await s.act(p, "one", verb);
    const archived = s.stateOf(p).landed[0];
    assert.equal(archived.todo, true);
    assert.equal(STATUS.isTodo(archived), false);
    await s.act(p, "one", "reopen");
    assert.equal(STATUS.shownState(line()), "todo");
  }
});

test("server rejects stale or invalid Todo requests and never masks higher priority states", async t => {
  const { s, p, line } = setup(t), finished = s.readDoc(p, "one"), base = line();
  await assert.rejects(s.act(p, "one", "todo", {}), { code:"BAD_TODO" });
  for (const status of ["not-started", "notes", "closed", "landed"]) {
    s.writeDoc(p, "one", F.setFront(finished, { status })); s.sync(p);
    await assert.rejects(s.act(p, "one", "todo", { todo:true }), { code:"NOT_FINISHED" });
  }
  s.writeDoc(p, "one", F.setFront(finished, { status:"working" }));
  s.runs.set(s.key(p, "one"), { agent:"codex", stepId:"work-1", started:Date.now(), now:"Working" });
  s.sync(p);
  assert.equal(STATUS.canMarkTodo(line()), false);
  await assert.rejects(s.act(p, "one", "todo", { todo:true }), { code:"BUSY" });
  s.runs.delete(s.key(p, "one"));
  const bad = [
    { status:"working" }, { status:"waiting" }, { status:"stopped" }, { status:"not-started" }, { status:"paused" }, { running:true }, { commit:"abc" }, { archived:true },
    { asking:{ kind:"reply" } }, { questions:[{ text:"Which option?" }] },
    { stations:[...base.stations, { kind:"ask", unsent:true }] },
    { stations:[...base.stations, { kind:"work", state:"todo", reviewed:false }] },
    { stations:[{ kind:"note", state:"done" }] },
  ];
  for (const extra of bad) assert.equal(STATUS.isTodo({ ...base, todo:true, ...extra }), false, JSON.stringify(extra));
  s.writeDoc(p, "one", F.setFront(finished, { commit:"abc" })); s.sync(p);
  await assert.rejects(s.act(p, "one", "todo", { todo:true }), { code:"NOT_FINISHED" });
  s.writeDoc(p, "one", F.updateSteps(finished, steps => { steps.push(F.askStep({ words:"Later", via:F.NOT_SENT })); })); s.sync(p);
  await assert.rejects(s.act(p, "one", "todo", { todo:true }), { code:"NOT_FINISHED" });
});

test("non-working waiting, stopped, stale-working, and reply-asking Lines can be marked Todo without marking Works reviewed", async t => {
  for (const [label, status, steps, extra] of [
    ["waiting-questions", "waiting", [F.askStep({ words:"Ask me" }), F.workStep({ who:"codex", done:true, took:"2 min", body:"Drafted icons." })], "- [ ] Option A"],
    ["stopped-open", "stopped", [F.askStep({ words:"Try" }), F.workStep({ who:"codex" })], null],
    ["stale-working", "working", [F.askStep({ words:"Stale" }), F.workStep({ who:"codex", done:true, off:"stopped", took:"stopped" })], null],
  ]) {
    const { s, p, directory, line } = setup(t);
    s.writeDoc(p, "one", F.initialLine({ title:"Pending", status, steps }));
    if (extra) s.writeDoc(p, "one", F.setAbove(s.readDoc(p, "one"), F.QUESTIONS, extra));
    s.sync(p);
    assert.equal(STATUS.lineWorking(line()), false, `${label}: not working`);
    assert.equal(STATUS.canMarkTodo(line()), true, `${label}: Mark todo is offered`);
    await s.act(p, "one", "todo", { todo:true });
    assert.equal(line().status, "done", `${label}: settles to done`);
    assert.equal(line().todo, true, `${label}: saved as todo`);
    assert.equal(line().questions.length, 0, `${label}: open questions cleared`);
    assert.equal(STATUS.shownState(line()), "todo", `${label}: shows Todo`);
    assert.equal(line().stations.find(st => st.id === "work-1").reviewed, false, `${label}: Work stays unreviewed`);
    const again = new Service({ directory, agents, autoWatch:false }); t.after(() => again.close());
    assert.equal(STATUS.shownState(again.stateOf(again.store.projects[0]).lines[0]), "todo", `${label}: survives reload`);
  }

  // Done Line with an implicit reply-style asking clears asking once marked Todo and stays Todo.
  const { s, p, line } = setup(t);
  s.writeDoc(p, "one", F.initialLine({ title:"Prototypes", status:"done", steps:[
    F.askStep({ words:"Make 2 prototypes for me to choose from" }),
    F.workStep({ who:"codex", done:true, took:"3 min", body:"Made 2 options. Which prototype works better?" }),
  ] }));
  s.store.writeText(p, "topics/one/work-1.md", F.setResult(F.initialDetail({ slug:"one", title:"Prototypes", label:"Work 1", who:"codex", started:"2026-11-15 04:00", now:"" }), "Made 2 options. Which prototype works better?"));
  s.sync(p);
  assert.equal(Boolean(line().asking), true);
  assert.equal(STATUS.canMarkTodo(line()), true);
  await s.act(p, "one", "todo", { todo:true });
  assert.equal(line().asking, null, "Todo suppresses implicit reply asking");
  assert.equal(STATUS.shownState(line()), "todo");
  assert.equal(line().stations.find(st => st.id === "work-1").reviewed, false);
});

test("pin and result edits do not silently discard Todo", async t => {
  const { s, p, line, detail } = setup(t);
  await s.act(p, "one", "todo", { todo:true });
  await s.act(p, "one", "pin", { pinned:true });
  s.store.writeText(p, "topics/one/work-1.md", F.setResult(detail(), "A revised explanation.")); s.sync(p);
  assert.equal(STATUS.shownState(line()), "todo");
});
