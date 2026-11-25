"use strict";
require("./helpers/safety.js");
// PE-764 / PE-765: Bulk review-tree server action for an Orchestrator Line and its direct sub-Lines.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { Service } = require("../src/server/project-lines/service.js");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const F = require("../src/server/project-lines/format.js");
const STATUS = require("../public/lines/line-status.js");

const agents = { available:() => [], desktop:() => null, terminal:() => "" };
const doneWork = (body = "Finished cleanly.", extra = {}) => ({ ...F.workStep({ who:"codex", done:true, took:"4 min", body }), ...extra });
const stoppedWork = (extra = {}) => ({ ...F.workStep({ who:"antigravity", done:true, took:"2 min", body:"Stopped by you." }), off:"stopped", ...extra });

function setupTree(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "line-review-tree-")), directory = path.join(root, "state");
  fs.mkdirSync(directory);
  const service = new Service({ directory, agents, autoWatch:false });
  const project = service.store.create({ name:"Orch Tree", docsPath:path.join(root, "docs") });
  project.follow = false; service.store.save();
  t.after(() => { service.close(); fs.rmSync(root, { recursive:true, force:true }); });

  function addLine(slug, { id, title, status = "done", orchestrator = false, orchestratedBy = "", todo = false, questions = null, steps = [F.askStep({ words:"Do it" }), doneWork()], reviewedWorks = [] } = {}) {
    let md = F.initialLine({ title:title || slug, status, steps });
    const front = {
      ...(id ? { id } : {}),
      ...(orchestrator ? { orchestrator:"yes" } : {}),
      ...(orchestratedBy ? { "orchestrated by":orchestratedBy } : {}),
      ...(todo ? { todo:"yes" } : {}),
    };
    md = F.setFront(md, front);
    if (questions) md = F.setAbove(md, F.QUESTIONS, questions);
    service.writeDoc(project, slug, md);
    let work = 0;
    for (const step of steps) if (F.AGENT_LIKE(step)) {
      work += 1;
      const detailPath = F.detailPath(slug, `work-${work}`);
      let detailMd = F.initialDetail({ slug, title:title || slug, label:`Work ${work}`, who:step.who, started:"2026-11-20 03:00", now:"" });
      if (reviewedWorks.includes(`work-${work}`)) detailMd = F.setFront(detailMd, { reviewed:"2026-11-20 03:10" });
      service.store.writeText(project, detailPath, detailMd);
    }
  }

  const all = () => {
    const st = service.stateOf(project);
    return [...st.lines, ...st.landed, ...st.backlog];
  };
  const line = slug => all().find(l => l.id === slug);
  const station = (slug, stepId) => line(slug).stations.find(s => s.id === stepId);
  return { root, directory, service, project, addLine, line, station };
}

test("review-tree marks parent and finished sub-Lines reviewed in one sync, skips already-reviewed without disk write", async t => {
  const h = setupTree(t), { service:s, project:p } = h;
  h.addLine("parent", { id:"PE-751", title:"MCP Companion Redesign", orchestrator:true, todo:true, steps:[F.askStep({ words:"Design" }), doneWork("Step 1"), F.askStep({ words:"Refine" }), stoppedWork()] });
  h.addLine("child-done", { id:"PE-752", title:"Header Layout", orchestratedBy:"PE-751", steps:[F.askStep({ words:"Build" }), doneWork("Done")] });
  h.addLine("child-reviewed", { id:"PE-753", title:"Already Checked", orchestratedBy:"PE-751", steps:[F.askStep({ words:"Check" }), doneWork("Already ok")], reviewedWorks:["work-1"] });
  h.addLine("unrelated", { id:"PE-999", title:"Other Line", steps:[F.askStep({ words:"Other" }), doneWork("Leave untouched")] });
  s.sync(p);

  const reviewedDetailPath = s.store.resolve(p, F.detailPath("child-reviewed", "work-1"));
  const beforeReviewedText = fs.readFileSync(reviewedDetailPath, "utf8");
  const beforeUnrelated = s.readDoc(p, "unrelated");

  const res = await s.act(p, "parent", "review-tree", { includeParent:true, includeSubLines:true, includeStopped:false });
  assert.equal(res.ok, true);
  assert.deepEqual(res.errors, []);
  assert.deepEqual(res.marked.map(m => ({ slug:m.slug, code:m.code, role:m.role, worksMarked:m.worksMarked, settled:m.settled })), [
    { slug:"parent", code:"PE-751", role:"parent", worksMarked:2, settled:false },
    { slug:"child-done", code:"PE-752", role:"child", worksMarked:1, settled:false },
  ]);
  assert.deepEqual(res.skipped, [
    { slug:"child-reviewed", code:"PE-753", role:"child", reason:"already-reviewed" },
  ]);

  assert.equal(h.line("parent").todo, false);
  assert.equal(h.station("parent", "work-1").reviewed, true);
  assert.equal(h.station("parent", "work-2").reviewed, true);
  assert.equal(STATUS.toReview(h.line("parent")), false);
  assert.equal(h.station("child-done", "work-1").reviewed, true);
  assert.equal(STATUS.toReview(h.line("child-done")), false);
  assert.equal(h.station("unrelated", "work-1").reviewed, false, "unrelated Line is untouched");
  assert.equal(s.readDoc(p, "unrelated"), beforeUnrelated);
  assert.equal(fs.readFileSync(reviewedDetailPath, "utf8"), beforeReviewedText, "already-reviewed sub-Line has no disk write");

  // Persists across restart.
  const again = new Service({ directory:h.directory, agents, autoWatch:false });
  t.after(() => again.close());
  const lines = again.stateOf(again.store.projects[0]).lines;
  assert.equal(lines.find(l => l.id === "parent").stations.every(st => st.kind !== "work" || st.reviewed), true);
  assert.equal(lines.find(l => l.id === "child-done").stations.find(st => st.id === "work-1").reviewed, true);
});

test("review-tree never fails on running Lines and enforces waiting/stopped/queued/archived safety rules", async t => {
  const h = setupTree(t), { service:s, project:p } = h;
  h.addLine("parent", { id:"PE-751", title:"Parent", status:"working", orchestrator:true, steps:[F.askStep({ words:"Run" }), doneWork(), F.askStep({ words:"Wait" }), F.workStep({ who:"codex" })] });
  h.addLine("child-done", { id:"PE-752", title:"Finished child", orchestratedBy:"PE-751" });
  h.addLine("child-running", { id:"PE-778", title:"Running child", status:"working", orchestratedBy:"PE-751", steps:[F.askStep({ words:"Go" }), F.workStep({ who:"codex" })] });
  h.addLine("child-waiting-q", { id:"PE-761", title:"Questions child", status:"waiting", orchestratedBy:"PE-751", questions:"- [ ] Option A\n- [ ] Option B", steps:[F.askStep({ words:"Ask" }), F.workStep({ who:"claude", wait:true })] });
  h.addLine("child-waiting-reply", { id:"PE-762", title:"Reply asking child", status:"done", orchestratedBy:"PE-751", steps:[F.askStep({ words:"Make 2 prototypes for me to choose from" }), doneWork("Made 2 options. Which prototype works better?")] });
  h.addLine("child-stopped", { id:"PE-760", title:"Stopped child", status:"stopped", orchestratedBy:"PE-751", steps:[F.askStep({ words:"Try" }), F.workStep({ who:"claude" })] });
  h.addLine("child-queued", { id:"PE-763", title:"Queued child", status:"not-started", orchestratedBy:"PE-751", steps:[F.askStep({ words:"Later" })] });
  h.addLine("child-archived", { id:"PE-748", title:"Archived child", status:"closed", orchestratedBy:"PE-751" });
  s.sync(p);

  // Mark parent and child-running as actively held/running.
  s.runs.set(s.key(p, "parent"), { agent:"codex", stepId:"work-2", started:Date.now(), now:"Waiting on sub-Line" });
  s.runs.set(s.key(p, "child-running"), { agent:"codex", stepId:"work-1", started:Date.now(), now:"Working" });

  // 1. Default bulk review (includeStopped: false): marks child-done, skips running, waiting, stopped, queued, archived.
  const first = await s.act(p, "parent", "review-tree", { includeParent:true, includeSubLines:true, includeStopped:false });
  assert.equal(first.ok, true);
  assert.deepEqual(first.errors, []);
  assert.deepEqual(first.marked.map(m => m.slug), ["child-done"]);
  const reasonBySlug = Object.fromEntries(first.skipped.map(x => [x.slug, x.reason]));
  assert.deepEqual(reasonBySlug, {
    parent:"running",
    "child-running":"running",
    "child-waiting-q":"waiting",
    "child-waiting-reply":"waiting",
    "child-stopped":"stopped",
    "child-queued":"queued",
    "child-archived":"archived",
  });
  assert.equal(h.line("child-stopped").status, "stopped", "stopped sub-Line is not settled by default");
  assert.match(s.readDoc(p, "child-waiting-q"), /- \[ \] Option A/, "unanswered questions remain untouched");

  // 2. Opt-in bulk review (includeStopped: true): settles stopped sub-Line, still skips running, waiting, queued, archived!
  const second = await s.act(p, "parent", "review-tree", { includeParent:true, includeSubLines:true, includeStopped:true });
  assert.equal(second.ok, true);
  assert.deepEqual(second.errors, []);
  assert.deepEqual(second.marked, [
    { slug:"child-stopped", code:"PE-760", role:"child", worksMarked:1, settled:true },
  ]);
  const secondReasons = Object.fromEntries(second.skipped.map(x => [x.slug, x.reason]));
  assert.equal(secondReasons["child-done"], "already-reviewed");
  assert.equal(secondReasons["child-waiting-q"], "waiting", "never auto-clear unanswered questions even with includeStopped");
  assert.equal(secondReasons["child-waiting-reply"], "waiting", "never auto-clear reply-style waiting questions in bulk");
  assert.equal(secondReasons["child-queued"], "queued", "queued Line is never settled as stopped");
  assert.equal(secondReasons["child-archived"], "archived");
  assert.equal(h.line("child-stopped").status, "done");
  assert.equal(h.station("child-stopped", "work-1").off, "stopped");
  assert.equal(h.station("child-stopped", "work-1").reviewed, true);
  assert.match(s.readDoc(p, "child-waiting-q"), /- \[ \] Option A/, "questions still preserved");

  s.runs.delete(s.key(p, "parent"));
  s.runs.delete(s.key(p, "child-running"));
});

// PE-922: any Line that is not working and not yet reviewed can be marked reviewed. Lines that need you join the bulk only when ticked in.
test("review-tree ends Lines that need you only with includeWaiting, clearing their questions as a single Mark reviewed does", async t => {
  const h = setupTree(t), { service:s, project:p } = h;
  h.addLine("parent", { id:"PE-751", title:"Parent", orchestrator:true });
  h.addLine("child-waiting-q", { id:"PE-761", title:"Questions child", status:"waiting", orchestratedBy:"PE-751", questions:"- [ ] Option A\n- [ ] Option B", steps:[F.askStep({ words:"Ask" }), doneWork("Pick one.")] });
  h.addLine("child-waiting-reply", { id:"PE-762", title:"Reply asking child", status:"done", orchestratedBy:"PE-751", steps:[F.askStep({ words:"Make 2 prototypes for me to choose from" }), doneWork("Made 2 options. Which prototype works better?")] });
  h.addLine("child-not-sent", { id:"PE-764", title:"Not sent child", status:"waiting", orchestratedBy:"PE-751", steps:[{ ...F.askStep({ words:"Later" }), unsent:true }] });
  s.sync(p);
  assert.ok(STATUS.lineNeedsYou(h.line("child-waiting-q")) && STATUS.canMarkReviewed(h.line("child-waiting-q")));

  const out = await s.act(p, "parent", "review-tree", { includeParent:true, includeSubLines:true, includeWaiting:true });
  assert.deepEqual(out.errors, []);
  assert.deepEqual(out.marked.map(m => m.slug).sort(), ["child-waiting-q", "child-waiting-reply", "parent"]);
  assert.equal(Object.fromEntries(out.skipped.map(x => [x.slug, x.reason]))["child-not-sent"], "waiting", "a Not sent Ask has no agent Work to end");
  for (const slug of ["child-waiting-q", "child-waiting-reply"]) {
    const l = h.line(slug);
    assert.equal(STATUS.lineNeedsYou(l), false, `${slug} no longer needs you`);
    assert.equal(STATUS.lineReviewed(l), true, `${slug} is reviewed`);
    assert.equal(STATUS.canMarkReviewed(l), false, `${slug} offers no second Mark reviewed`);
  }
  assert.doesNotMatch(s.readDoc(p, "child-waiting-q"), /Option A/, "its questions are cleared");
});

test("review-tree isolates per-Line errors without aborting remaining Lines and respects includeParent/includeSubLines", async t => {
  const h = setupTree(t), { service:s, project:p } = h;
  h.addLine("parent", { id:"PE-751", title:"Parent", orchestrator:true });
  h.addLine("child-ok", { id:"PE-752", title:"Good child", orchestratedBy:"PE-751" });
  h.addLine("child-bad", { id:"PE-753", title:"Broken child", orchestratedBy:"PE-751" });
  s.sync(p);

  const origReviewLine = s.reviewLine.bind(s);
  s.reviewLine = async (proj, slug, doc, opts) => {
    if (slug === "child-bad") throw new Error("Disk write failed");
    return origReviewLine(proj, slug, doc, opts);
  };
  const partial = await s.act(p, "parent", "review-tree", { includeParent:false, includeSubLines:true });
  assert.equal(partial.ok, true);
  assert.deepEqual(partial.marked.map(m => m.slug), ["child-ok"]);
  assert.deepEqual(partial.errors, [{ slug:"child-bad", code:"PE-753", role:"child", error:"Disk write failed" }]);
  assert.equal(h.station("parent", "work-1").reviewed, false, "includeParent:false leaves parent untouched");
  assert.equal(h.station("child-ok", "work-1").reviewed, true, "sibling child still succeeded");

  s.reviewLine = origReviewLine;
  const parentOnly = await s.act(p, "parent", "review-tree", { includeParent:true, includeSubLines:false });
  assert.deepEqual(parentOnly.marked.map(m => m.slug), ["parent"]);
  assert.equal(h.station("parent", "work-1").reviewed, true);
  assert.equal(h.station("child-bad", "work-1").reviewed, false, "includeSubLines:false leaves children untouched");
});

test("POST /api/lines/projects/:id/topics/:slug/review-tree works through http.js", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "line-review-tree-http-")), directory = path.join(root, "state");
  fs.mkdirSync(directory);
  let statusCode = 0, payload = null;
  const api = createProjectLines({
    directory,
    agents,
    authorizeRead:() => null,
    authorizeWrite:() => null,
    readJson:async req => JSON.parse(req._body || "{}"),
    send:(_res, code, body) => { statusCode = code; payload = body; },
    serviceOptions:{ autoWatch:false, recoverOnStart:false },
    computerRounds:0,
  });
  t.after(() => { api.close(); fs.rmSync(root, { recursive:true, force:true }); });

  const project = api.service.store.create({ name:"HTTP Tree", docsPath:path.join(root, "docs") });
  api.service.writeDoc(project, "parent", F.setFront(F.initialLine({ title:"Parent", status:"done", steps:[F.askStep({ words:"A" }), doneWork()] }), { id:"PE-10", orchestrator:"yes" }));
  api.service.writeDoc(project, "child", F.setFront(F.initialLine({ title:"Child", status:"done", steps:[F.askStep({ words:"B" }), doneWork()] }), { id:"PE-11", "orchestrated by":"PE-10" }));
  api.service.sync(project);

  const req = Object.assign(new EventEmitter(), { method:"POST", headers:{}, _body:JSON.stringify({ includeParent:true, includeSubLines:true, includeStopped:false }) });
  const res = Object.assign(new EventEmitter(), { headersSent:false, writableEnded:false });
  const url = new URL(`http://127.0.0.1/api/lines/projects/${encodeURIComponent(project.id)}/topics/parent/review-tree`);
  const handled = await api.handle(req, res, url);
  assert.equal(handled, true);
  assert.equal(statusCode, 200);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.marked.map(m => m.slug), ["parent", "child"]);
});
