"use strict";
require("./helpers/safety.js");
// PE-522 Work 11: a Claude desktop conversation called a tool that waited hours, so its Work was stopped as cut off
// ("PenEcho closed while this was running"). It then carried on and finished, and the line still said Stopped.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Service } = require("../src/server/project-lines/service.js");
const F = require("../src/server/project-lines/format.js");

const agents = { available:() => [], desktop:() => null, terminal:() => "" };
const CUT_OFF = /PenEcho closed while this was running/;
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "line-cut-off-")), directory = path.join(root, "state");
  fs.mkdirSync(directory);
  const service = new Service({ directory, agents, autoWatch:false });
  const project = service.store.create({ name:"Cut off", docsPath:path.join(root, "docs") });
  project.follow = false; service.store.save();
  service.writeDoc(project, "one", F.initialLine({ title:"One", status:"working", steps:[F.askStep({ words:"Remake the film" }), F.workStep({ who:"claude" })] }));
  service.sync(project);
  const rec = { agent:"claude", id:"session-1", slug:"one", projectId:project.id, lastAt:Date.now() - 600000, doneTurns:{}, lastSay:"", stepId:"work-1", appStep:"work-1", startedHere:true, turnOpen:true, via:"Claude desktop", workStarted:Date.now() - 700000 };
  const doc = () => F.parseLine(service.readDoc(project, "one"));
  const detail = () => service.store.readText(project, F.detailPath("one", "work-1")).text;
  t.after(() => { service.close(); fs.rmSync(root, { recursive:true, force:true }); });
  return { service, project, rec, doc, detail };
}
const said = (text, id) => ({ said:text, add:{ kind:"say", text, id }, at:Date.now() });

test("a Work stopped as cut off is Working again when its conversation carries on, and ends with its reply", async t => {
  const { service:s, project:p, rec, doc, detail } = setup(t);
  await s.conversationQuiet(p, rec);
  assert.equal(doc().status, "stopped");
  assert.match(doc().front.why, CUT_OFF);
  await s.conversationChanges(p, rec, [said("Looking at the recording first.", "say-1")]);
  assert.equal(doc().status, "working");
  assert.equal(doc().front.why, undefined);
  assert.ok(!F.sectionText(detail(), "Stopped"));
  assert.ok(!s.activity.load(p, "one").rows.some(r => r.kind === "error"), "the stop reads as a note now");
  await s.conversationChanges(p, rec, [said("The film is remade.", "say-2")]);
  rec.turnOpen = false;
  await s.conversationQuiet(p, rec);
  const work = doc().steps.find(x => x.id === "work-1");
  assert.ok(work.done && !work.off, "the Work finished");
  assert.notEqual(doc().status, "stopped");
  assert.match(detail(), /The film is remade\./);
});

test("a line left Stopped after its conversation carried on and finished is ended at the next quiet look", async t => {
  const { service:s, project:p, rec, doc, detail } = setup(t);
  await s.conversationQuiet(p, rec);
  assert.equal(doc().status, "stopped");
  // What it did afterwards was read without the line being put back to Working, as before this fix.
  s.activity.add(p, "one", { kind:"say", text:"The film is remade.", step:"work-1" });
  Object.assign(rec, { lastSay:"The film is remade.", lastAt:Date.now(), turnOpen:false });
  assert.equal(s.cutOffStep(p, rec)?.id, "work-1");
  await s.conversationQuiet(p, rec);
  const work = doc().steps.find(x => x.id === "work-1");
  assert.ok(work.done && !work.off, "the Work finished");
  assert.notEqual(doc().status, "stopped");
  assert.doesNotMatch(detail(), CUT_OFF);
  assert.match(detail(), /The film is remade\./);
});

test("a cut-off Work nothing was heard from since stays Stopped, and so does a run lost in a restart", async t => {
  const { service:s, project:p, rec, doc } = setup(t);
  await s.conversationQuiet(p, rec);
  await s.conversationQuiet(p, rec);
  assert.equal(doc().status, "stopped");
  // Words from before the stop are no proof that it went on.
  rec.lastSay = "An old reply";
  await s.conversationQuiet(p, rec);
  assert.equal(doc().status, "stopped");
  rec.interrupted = true;
  await s.conversationChanges(p, rec, [said("Still here.", "say-1")]);
  assert.equal(doc().status, "stopped");
  assert.match(doc().front.why, CUT_OFF);
});
