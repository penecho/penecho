"use strict";
require("./helpers/safety.js");
// PE-757: a Line can be Finished with a Work the person stopped (Stopped by you). It then had no Mark reviewed control,
// because only a Work that ended cleanly counted as reviewable. A stopped Work is part of what the Line finished.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Service } = require("../src/server/project-lines/service.js");
const F = require("../src/server/project-lines/format.js");
const STATUS = require("../public/lines/line-status.js");

const agents = { available:() => [], desktop:() => null, terminal:() => "" };
const stoppedWork = (extra = {}) => ({ ...F.workStep({ who:"antigravity", done:true, took:"11 min", body:"Stopped before finishing." }), off:"stopped", ...extra });
const doneWork = (extra = {}) => ({ ...F.workStep({ who:"codex", done:true, took:"5 min", body:"Did the thing." }), ...extra });

function setup(t, steps = [F.askStep({ words:"Make the link" }), stoppedWork()], status = "done") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "line-review-stopped-")), directory = path.join(root, "state");
  fs.mkdirSync(directory);
  const service = new Service({ directory, agents, autoWatch:false });
  const project = service.store.create({ name:"Review stopped", docsPath:path.join(root, "docs") });
  project.follow = false; service.store.save();
  service.writeDoc(project, "one", F.initialLine({ title:"One", status, steps }));
  let work = 0;
  for (const step of steps) if (F.AGENT_LIKE(step)) {
    work += 1;
    service.store.writeText(project, `topics/one/work-${work}.md`, F.initialDetail({ slug:"one", title:"One", label:`Work ${work}`, who:step.who, started:"2026-11-20 02:48", now:"" }));
  }
  service.sync(project);
  const line = () => service.stateOf(project).lines.find(l => l.id === "one");
  const station = id => line().stations.find(s => s.id === id);
  const detail = id => service.store.readText(project, `topics/one/${id}.md`).text;
  t.after(() => { service.close(); fs.rmSync(root, { recursive:true, force:true }); });
  return { service, project, directory, line, station, detail };
}

test("a finished Line whose only Work was stopped asks for review, and Mark reviewed marks that Work", async t => {
  const { service:s, project:p, directory, line, station, detail } = setup(t);
  const topic = s.readDoc(p, "one");
  assert.equal(line().status, "done");
  assert.equal(station("work-1").state, "off");
  assert.equal(station("work-1").off, "stopped");
  assert.equal(station("work-1").reviewed, false);
  assert.equal(STATUS.toReview(line()), true, "the Line still offers Mark reviewed");
  assert.equal(STATUS.shownState(line()), "review");

  await s.act(p, "one", "review-all");

  assert.equal(line().status, "done", "reviewing does not reopen or rerun the Line");
  assert.equal(station("work-1").reviewed, true);
  assert.equal(STATUS.toReview(line()), false, "the control goes away once its Work is reviewed");
  assert.match(F.splitFront(detail("work-1")).front.reviewed, /^\d{4}-\d\d-\d\d \d\d:\d\d$/);
  assert.equal(s.readDoc(p, "one"), topic, "the Line file itself is unchanged");

  const again = new Service({ directory, agents, autoWatch:false });
  t.after(() => again.close());
  const kept = again.stateOf(again.store.projects[0]).lines.find(l => l.id === "one");
  assert.equal(kept.stations.find(x => x.id === "work-1").reviewed, true, "the mark survives a restart");
  assert.equal(STATUS.toReview(kept), false);
});

test("mixed finished and stopped Works are all marked reviewed; a discarded Work is left alone", async t => {
  const steps = [
    F.askStep({ words:"First" }), doneWork(),
    F.askStep({ words:"Second, then stop" }), stoppedWork(),
    F.askStep({ words:"Third was discarded" }), { ...F.workStep({ who:"claude", done:true, took:"1 min", body:"Discarded." }), off:"discarded" },
  ];
  const { service:s, project:p, line, station, detail } = setup(t, steps);
  const topic = s.readDoc(p, "one");
  assert.equal(STATUS.toReview(line()), true);
  assert.equal(station("work-1").reviewed, false);
  assert.equal(station("work-2").reviewed, false);

  await s.act(p, "one", "review-all");

  assert.equal(station("work-1").reviewed, true);
  assert.equal(station("work-2").reviewed, true, "a stopped Work can be reviewed");
  assert.equal(station("work-3").reviewed, false, "a discarded Work has nothing to review");
  assert.equal(STATUS.toReview(line()), false);
  assert.equal(s.readDoc(p, "one"), topic);
  assert.doesNotMatch(detail("work-3"), /^reviewed:/m);
});

test("an Ask already marked finished does not hide a stopped Work from review", async t => {
  const steps = [F.askStep({ words:"Already done elsewhere", via:F.FINISHED_ASK }), stoppedWork()];
  const { service:s, project:p, line, station } = setup(t, steps);
  assert.equal(station("ask-1").finishedAsk, true);
  assert.equal(station("ask-1").reviewed, true);
  assert.equal(STATUS.toReview(line()), true, "the stopped Work keeps the Line to review");
  await s.act(p, "one", "review-all");
  assert.equal(station("work-1").reviewed, true);
  assert.equal(STATUS.toReview(line()), false);
  assert.equal(line().status, "done");
});

test("Mark reviewed on a stopped Line also reviews the Work it ends, so the control does not come back", async t => {
  const { service:s, project:p, line, station } = setup(t, [F.askStep({ words:"Start" }), F.workStep({ who:"claude" })], "stopped");
  assert.equal(line().status, "stopped");
  assert.equal(station("work-1").state, "error");
  await s.act(p, "one", "review-all");
  assert.equal(line().status, "done");
  assert.equal(station("work-1").state, "off");
  assert.equal(station("work-1").off, "stopped");
  assert.equal(station("work-1").reviewed, true);
  assert.equal(STATUS.toReview(line()), false);

  const before = s.readDoc(p, "one");
  await s.act(p, "one", "review-all");
  assert.equal(s.readDoc(p, "one"), before, "a second click changes nothing");
});

test("a normal finished Line still offers review for its finished Work", async t => {
  const { service:s, project:p, line, station } = setup(t, [F.askStep({ words:"Do it" }), doneWork()], "done");
  assert.equal(STATUS.shownState(line()), "review");
  assert.equal(STATUS.toReview(line()), true);
  await s.act(p, "one", "review-all");
  assert.equal(station("work-1").reviewed, true);
  assert.equal(STATUS.toReview(line()), false);
  assert.equal(STATUS.shownState(line()), "landed");
  assert.equal(line().status, "done");
});

test("PE-769: stopped Work without a Details link beside an already-reviewed Work marks reviewed and sticks across warm cache and restart", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "line-review-pe769-")), directory = path.join(root, "state");
  fs.mkdirSync(directory);
  const service = new Service({ directory, agents, autoWatch:false });
  const project = service.store.create({ name:"PE-769", docsPath:path.join(root, "docs") });
  project.follow = false; service.store.save();
  t.after(() => { service.close(); fs.rmSync(root, { recursive:true, force:true }); });

  const lineMd = [
    "---",
    "id: PE-769",
    "status: done",
    "who: @antigravity",
    "created: 2026-11-20 03:50",
    "finished: 2026-11-20 04:00",
    "---",
    "",
    "# Remove up arrow on Start",
    "",
    "## Ask · 2026-11-20 03:50",
    "",
    "remove that up arrow",
    "",
    "## [x] Work 1 · @antigravity · stopped",
    "",
    "## Ask · 2026-11-20 03:50",
    "",
    "maybe change to another icon or just remove it",
    "",
    "## [x] Work 2 · @antigravity · 9 min",
    "",
    "Removed the up-arrow icon.",
    "",
    "[Details](../works/one/work-2.md)",
  ].join("\n");
  service.writeDoc(project, "one", lineMd);
  service.store.writeText(project, "works/one/work-1.md", F.setFront(F.initialDetail({ slug:"one", title:"Remove up arrow on Start", label:"Work 1", who:"antigravity", started:"2026-11-20 03:50", now:"" }), { "stop why":"stopped" }));
  service.store.writeText(project, "works/one/work-2.md", F.setFront(F.initialDetail({ slug:"one", title:"Remove up arrow on Start", label:"Work 2", who:"antigravity", started:"2026-11-20 03:50", now:"" }), { reviewed:"2026-11-20 04:02" }));
  service.sync(project);

  // Warm state + lineMemo + rail view + summary before clicking review-all.
  const before = service.stateOf(project).lines.find(l => l.id === "one");
  assert.equal(before.stations.find(s => s.id === "work-1").reviewed, false);
  assert.equal(before.stations.find(s => s.id === "work-2").reviewed, true);
  assert.equal(STATUS.toReview(before), true);
  assert.equal(STATUS.canMarkReviewed(before), true);
  const railBefore = service.stateFor(project, "rail").lines.find(l => l.id === "one");
  assert.equal(railBefore.stations.find(s => s.id === "work-1").off, "stopped", "rail view preserves stopped Work off field");
  assert.equal(STATUS.toReview(railBefore), true);
  assert.equal(service.summaryOf(project).lines.find(l => l.id === "one").canReviewLine, true);

  await service.act(project, "one", "review-all");

  const after = service.stateOf(project).lines.find(l => l.id === "one");
  assert.equal(after.stations.find(s => s.id === "work-1").reviewed, true);
  assert.equal(after.stations.find(s => s.id === "work-2").reviewed, true);
  assert.equal(STATUS.toReview(after), false);
  assert.equal(STATUS.canMarkReviewed(after), false);
  assert.equal(service.summaryOf(project).lines.find(l => l.id === "one").canReviewLine, false);

  const again = new Service({ directory, agents, autoWatch:false });
  t.after(() => again.close());
  const kept = again.stateOf(again.store.projects[0]).lines.find(l => l.id === "one");
  assert.equal(kept.stations.find(s => s.id === "work-1").reviewed, true);
  assert.equal(STATUS.canMarkReviewed(kept), false);
});

test("stopped Work with no detail file on disk at all can still be marked reviewed and persists", async t => {
  const { service:s, project:p, line, station } = setup(t, [F.askStep({ words:"Try" }), stoppedWork()], "done");
  fs.rmSync(s.store.resolve(p, F.detailPath("one", "work-1")));
  s.sync(p);
  assert.equal(station("work-1").reviewed, false);
  assert.equal(STATUS.canMarkReviewed(line()), true);
  await s.act(p, "one", "review-all");
  assert.equal(station("work-1").reviewed, true);
  assert.equal(STATUS.canMarkReviewed(line()), false);
});

test("legacy paused, waiting (with questions or reply), and stale-working Lines with no active job offer Mark reviewed and always succeed", async t => {
  for (const [label, status, steps, extra] of [
    ["legacy-paused", "paused", [F.askStep({ words:"Legacy paused" }), F.workStep({ who:"claude" })], null],
    ["waiting-questions", "waiting", [F.askStep({ words:"Ask me" }), F.workStep({ who:"claude", wait:true })], "- [ ] Option A"],
    ["stale-working-stopped-work", "working", [F.askStep({ words:"Stale" }), stoppedWork()], null],
  ]) {
    const { service:s, project:p, line, station } = setup(t, steps, status);
    if (extra) { s.writeDoc(p, "one", F.setAbove(s.readDoc(p, "one"), F.QUESTIONS, extra)); s.sync(p); }
    assert.equal(STATUS.lineWorking(line()), false, `${label}: not working when no job runs`);
    assert.equal(STATUS.canMarkReviewed(line()), true, `${label}: Mark reviewed is an option`);
    await s.act(p, "one", "review-all");
    assert.equal(line().status, "done", `${label}: settles to done`);
    assert.equal(station("work-1").reviewed, true, `${label}: Work marked reviewed`);
    assert.equal(STATUS.canMarkReviewed(line()), false, `${label}: does not revert`);
    assert.equal(STATUS.toReview(line()), false);
  }

  // Done Line with reply-style asking question clears asking once reviewed.
  const { service:s, project:p, line, station } = setup(t, [
    F.askStep({ words:"Make 2 prototypes for me to choose from" }),
    doneWork({ body:"Made 2 options. Which prototype works better?" }),
  ], "done");
  assert.equal(Boolean(line().asking), true);
  assert.equal(STATUS.canMarkReviewed(line()), true);
  await s.act(p, "one", "review-all");
  assert.equal(station("work-1").reviewed, true);
  assert.equal(line().asking, null, "reviewed reply clears Needs you asking");
  assert.equal(STATUS.canMarkReviewed(line()), false);
});

test("a Line with a working job hides Mark reviewed and rejects review-all with BUSY", async t => {
  const { service:s, project:p, line } = setup(t, [
    F.askStep({ words:"First" }), stoppedWork(),
    F.askStep({ words:"Second" }), F.workStep({ who:"codex" }),
  ], "working");
  s.runs.set(s.key(p, "one"), { agent:"codex", stepId:"work-2", started:Date.now(), now:"Working" });
  s.changed(p);
  assert.equal(STATUS.lineWorking(line()), true);
  assert.equal(STATUS.canMarkReviewed(line()), false);
  assert.equal(STATUS.toReview(line()), false);
  await assert.rejects(s.act(p, "one", "review-all"), { code:"BUSY" });
  s.runs.delete(s.key(p, "one"));
});
