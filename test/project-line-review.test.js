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
const work = (extra = {}) => ({ ...F.workStep({ who:"codex", done:true, took:"5 min", body:"Did the thing." }), ...extra });
function setup(t, steps = [F.askStep({ words:"Please help" }), work()]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "line-review-")), directory = path.join(root, "state");
  fs.mkdirSync(directory);
  const service = new Service({ directory, agents, autoWatch:false });
  const project = service.store.create({ name:"Review", docsPath:path.join(root, "docs") });
  project.follow = false; service.store.save();
  service.writeDoc(project, "one", F.initialLine({ title:"One", status:"done", steps }));
  service.store.writeText(project, "topics/one/work-1.md", F.initialDetail({ slug:"one", title:"One", label:"Work 1", who:"codex", started:"2026-11-07 09:00", now:"" }));
  service.sync(project);
  const line = () => service.stateOf(project).lines.find(l => l.id === "one");
  const station = id => line().stations.find(s => s.id === id);
  const detail = (id = "work-1") => service.store.readText(project, `topics/one/${id}.md`).text;
  t.after(() => { service.close(); fs.rmSync(root, { recursive:true, force:true }); });
  return { root, directory, service, project, line, station, detail };
}

test("marking a Work leaves the Topic file exactly as it was, and the line does not read as updated", async t => {
  const { service:s, project:p, line, station, detail } = setup(t);
  const topic = s.readDoc(p, "one"), before = line(), details = detail(), rev = s.stateOf(p).rev;
  assert.equal(station("work-1").reviewed, false);

  await s.act(p, "one", "review", { step:"work-1", reviewed:true });
  assert.equal(s.readDoc(p, "one"), topic);
  assert.match(F.splitFront(detail()).front.reviewed, /^\d{4}-\d\d-\d\d \d\d:\d\d$/);
  assert.equal(station("work-1").reviewed, true);
  assert.equal(line().readRevision, before.readRevision, "it would read as Unread");
  assert.equal(line().updatedAt, before.updatedAt, "it would read as just updated");
  assert.notEqual(s.stateOf(p).rev, rev, "another open page would not see it");

  await s.act(p, "one", "review", { step:"work-1", reviewed:false });
  assert.equal(station("work-1").reviewed, false);
  assert.equal(detail(), details);
  assert.equal(s.readDoc(p, "one"), topic);
});

test("marking twice keeps the first time, and undoing twice changes nothing", async t => {
  const { service:s, project:p, detail } = setup(t);
  await s.act(p, "one", "review", { step:"work-1" });
  const marked = detail();
  await s.act(p, "one", "review", { step:"work-1", reviewed:true });
  assert.equal(detail(), marked);
  await s.act(p, "one", "review", { step:"work-1", reviewed:false });
  const clear = detail();
  await s.act(p, "one", "review", { step:"work-1", reviewed:false });
  assert.equal(detail(), clear);
});

test("the mark stays with the folder when PenEcho starts again", async t => {
  const { service:s, project:p, directory } = setup(t);
  await s.act(p, "one", "review", { step:"work-1" });
  const again = new Service({ directory, agents, autoWatch:false });
  t.after(() => again.close());
  assert.equal(again.stateOf(again.store.projects[0]).lines[0].stations.find(x => x.id === "work-1").reviewed, true);
});

test("a Work written by hand with no detail file can still be marked", async t => {
  const { service:s, project:p, station, detail } = setup(t, [F.askStep({ words:"Please help" }), work(), F.askStep({ words:"And this" }), work({ took:"", body:"By hand." })]);
  assert.equal(s.store.exists(p, "topics/one/work-2.md"), false);
  const topic = s.readDoc(p, "one");
  await s.act(p, "one", "review", { step:"work-2", reviewed:false });
  assert.equal(s.store.exists(p, "topics/one/work-2.md"), false, "undoing what was never marked makes no file");
  await s.act(p, "one", "review", { step:"work-2" });
  assert.equal(station("work-2").reviewed, true);
  assert.equal(station("work-2").out, "By hand.");
  assert.doesNotMatch(detail("work-2"), /## Now/);
  assert.equal(s.readDoc(p, "one"), topic);
});

test("Mark all reviewed ticks every finished Work at once and leaves the rest alone", async t => {
  const { service:s, project:p, station, detail } = setup(t, [F.askStep({ words:"Please help" }), work(), F.askStep({ words:"And this" }), work({ took:"", body:"By hand." }), F.askStep({ words:"Last" }), work({ done:false, took:"", body:"" })]);
  await s.act(p, "one", "review", { step:"work-1" });
  const first = detail(), topic = s.readDoc(p, "one");
  await s.act(p, "one", "review-all");
  assert.equal(station("work-1").reviewed, true);
  assert.equal(station("work-2").reviewed, true);
  assert.equal(station("work-3").reviewed, false, "unfinished work has nothing to review");
  assert.equal(detail(), first, "an earlier mark keeps its time");
  assert.equal(s.store.exists(p, "topics/one/work-3.md"), false);
  assert.equal(s.readDoc(p, "one"), topic);
});

test("only finished work can be reviewed", async t => {
  const { service:s, project:p, station } = setup(t, [F.askStep({ words:"Please help" }), work(), F.askStep({ words:"And this" }), work({ done:false, took:"", body:"" })]);
  await assert.rejects(s.act(p, "one", "review", { step:"work-2" }), { code:"NOT_FINISHED" });
  await assert.rejects(s.act(p, "one", "review", { step:"ask-1" }), { code:"NOT_FOUND" });
  await assert.rejects(s.act(p, "one", "review", { step:"work-9" }), { code:"NOT_FOUND" });
  await assert.rejects(s.act(p, "one", "review", {}), { code:"NOT_FOUND" });
  assert.equal(station("work-2").reviewed, false);
  assert.equal(station("ask-1").reviewed, false);
});

test("new work on a reviewed Work clears its mark, and it stays clear when that work ends", async t => {
  const { service:s, project:p, station, detail } = setup(t);
  await s.act(p, "one", "review", { step:"work-1" });
  s.resumeWork(p, { slug:"one", stepId:"work-1" });
  assert.equal(F.splitFront(detail()).front.reviewed, undefined);
  assert.equal(station("work-1").reviewed, false);
  s.writeDoc(p, "one", F.updateSteps(s.readDoc(p, "one"), steps => { F.closeStep(steps[1], { slug:"one", took:"9 min", summary:"Did more." }); }));
  assert.equal(station("work-1").state, "done");
  assert.equal(station("work-1").reviewed, false);
});

test("a hand edit that opens a Work again hides its mark", async t => {
  const { service:s, project:p, station } = setup(t);
  await s.act(p, "one", "review", { step:"work-1" });
  s.writeDoc(p, "one", s.readDoc(p, "one").replace("## [x] Work 1", "## [ ] Work 1"));
  assert.equal(station("work-1").reviewed, false);
});
