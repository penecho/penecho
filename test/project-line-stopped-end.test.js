"use strict";
require("./helpers/safety.js");
// PE-527: a line showed Stopped ("PenEcho closed while this was running") with every Work finished. PenEcho's own run had just ended and,
// while it was still closing its Work, the conversation watcher saw the same conversation go quiet with no reply of its own and called it cut off.
// And whatever stops a line, Mark reviewed ends it there without a Retry.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Service } = require("../src/server/project-lines/service.js");
const F = require("../src/server/project-lines/format.js");

const agents = { available:() => [], desktop:() => null, terminal:() => "" };
const done = (extra = {}) => ({ ...F.workStep({ who:"claude", done:true, took:"5 min", body:"Did the thing." }), ...extra });
function setup(t, { status = "working", steps = [F.askStep({ words:"Make the button better" }), F.workStep({ who:"claude" })], why } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "line-stopped-end-")), directory = path.join(root, "state");
  fs.mkdirSync(directory);
  const service = new Service({ directory, agents, autoWatch:false });
  const project = service.store.create({ name:"Stopped", docsPath:path.join(root, "docs") });
  project.follow = false; service.store.save();
  let md = F.initialLine({ title:"One", status, steps });
  if (why) md = F.setFront(md, { why });
  service.writeDoc(project, "one", md);
  service.sync(project);
  const doc = () => F.parseLine(service.readDoc(project, "one"));
  const station = id => service.stateOf(project).lines.find(l => l.id === "one").stations.find(s => s.id === id);
  t.after(() => { service.close(); fs.rmSync(root, { recursive:true, force:true }); });
  return { service, project, doc, station };
}

test("PenEcho's own run closing its Work is not cut off by its conversation going quiet meanwhile", async t => {
  const { service:s, project:p, doc } = setup(t);
  const key = s.key(p, "one"), run = { agent:"claude", sessionId:"session-1", stepId:"work-1", said:"The button is now in the box.", buffer:"", tail:"", started:Date.now() - 60000, workdir:"", head:"" };
  // Its own conversation's record never holds the reply: PenEcho's run keeps that.
  const rec = { agent:"claude", id:"session-1", slug:"one", projectId:p.id, lastAt:Date.now(), doneTurns:{}, lastSay:"", stepId:"work-1", startedHere:true, turnOpen:false };
  s.runs.set(key, run);
  let quiet;
  const follow = s.followAgentBranch.bind(s);
  s.followAgentBranch = async (...args) => { quiet = s.conversationQuiet(p, rec); await quiet; return follow(...args); };
  await s.ended(p, "one", run, 0);
  assert.ok(quiet, "the conversation went quiet while the run was closing");
  const now = doc(), work = now.steps.find(x => x.id === "work-1");
  assert.ok(work.done && !work.off, "the Work finished");
  assert.notEqual(now.status, "stopped");
  assert.doesNotMatch(String(now.front.why || ""), /closed while/);
  assert.equal(s.finishing.size, 0);
});

test("a run PenEcho started that went quiet with no reply, and is not closing, still stops with Retry", async t => {
  const { service:s, project:p, doc } = setup(t);
  await s.conversationQuiet(p, { agent:"claude", id:"session-1", slug:"one", projectId:p.id, lastAt:Date.now(), doneTurns:{}, lastSay:"", stepId:"work-1", startedHere:true, turnOpen:false });
  assert.equal(doc().status, "stopped");
});

test("Mark reviewed ends a stopped line whose Works all finished", async t => {
  const steps = [F.askStep({ words:"First" }), done(), F.askStep({ words:"Second" }), done()];
  const { service:s, project:p, doc, station } = setup(t, { status:"stopped", steps, why:"PenEcho closed while this was running. Retry to continue from the saved conversation and files." });
  await s.act(p, "one", "review-all");
  assert.equal(doc().status, "done");
  assert.equal(doc().front.why, undefined);
  assert.equal(station("work-1").reviewed, true);
  assert.equal(station("work-2").reviewed, true);
});

test("Mark reviewed ends a stopped line at its stopped Work, which stays as it ended", async t => {
  const steps = [F.askStep({ words:"First" }), done(), F.askStep({ words:"Second" }), F.workStep({ who:"claude" })];
  const { service:s, project:p, doc, station } = setup(t, { status:"stopped", steps, why:"claude stopped with code 1." });
  s.writeDoc(p, "one", F.setAbove(s.readDoc(p, "one"), F.QUESTIONS, "- [ ] Which colour?"));
  await s.act(p, "one", "review-all");
  const now = doc(), stopped = now.steps.find(x => x.id === "work-2");
  assert.equal(now.status, "done");
  assert.ok(stopped.done);
  assert.equal(stopped.off, "stopped");
  assert.equal(station("work-1").reviewed, true);
  assert.doesNotMatch(s.readDoc(p, "one"), /Which colour/, "its question is not wanted any more");
});

test("Mark reviewed does not end a stopped line that is somehow running", async t => {
  const steps = [F.askStep({ words:"First" }), F.workStep({ who:"claude" })];
  const { service:s, project:p, doc } = setup(t, { status:"stopped", steps, why:"error" });
  s.runs.set(s.key(p, "one"), { agent:"claude", stepId:"work-1" });
  await assert.rejects(s.act(p, "one", "review-all"), { code:"BUSY" });
  s.runs.delete(s.key(p, "one"));
  assert.equal(doc().status, "stopped");
});

test("Mark reviewed on a finished line still only ticks its Works", async t => {
  const { service:s, project:p, doc, station } = setup(t, { status:"done", steps:[F.askStep({ words:"First" }), done()] });
  const before = s.readDoc(p, "one");
  await s.act(p, "one", "review-all");
  assert.equal(station("work-1").reviewed, true);
  assert.equal(s.readDoc(p, "one"), before);
  assert.equal(doc().status, "done");
});
