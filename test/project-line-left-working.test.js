"use strict";
require("./helpers/safety.js");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Service } = require("../src/server/project-lines/service.js");
const { ImportState } = require("../src/server/project-lines/import-state.js");
const F = require("../src/server/project-lines/format.js");
const L = require("../src/server/project-lines/layout.js");

// A line whose only Work has ended, saved as Working, the way a missed finish leaves it.
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-left-working-"));
  const agents = { available:() => [{ id:"pi", available:true, name:"Pi" }], classifier:() => null, command:() => ({ command:"stand-in", args:[] }) };
  const service = new Service({ directory:path.join(root, "state"), agents, autoWatch:false, conversations:{ home:path.join(root, "home"), env:{} } });
  t.after(() => { service.close?.(); fs.rmSync(root, { recursive:true, force:true }); });
  const project = service.store.create({ name:"Demo", docsPath:path.join(root, "docs") });
  project.defaultAgent = "pi"; service.store.save();
  const { slug } = await service.createTopic(project, { text:"Check the badge.", agent:"pi", kinds:["ask", "work"], start:false });
  const work = F.parseLine(service.readDoc(project, slug)).steps.find(s => s.kind === "work");
  let md = F.updateSteps(service.readDoc(project, slug), steps => { F.closeStep(steps.find(s => s.id === work.id), { slug, took:"3 min", summary:"Done." }); });
  service.writeDoc(project, slug, F.setFront(md, { status:"working", why:null }));
  const age = ms => { const file = path.join(project.docsPath, L.linePath(slug)), when = new Date(Date.now() - ms); fs.utimesSync(file, when, when); };
  return { service, project, slug, work, age, status:() => F.parseLine(service.readDoc(project, slug)).status };
}

test("a Working line whose Works have all ended finishes on the next look, once it has been left a minute", async t => {
  const { service, project, slug, age, status } = await fixture(t);
  const topic = () => service.store.scan(project).topics.find(x => x.slug === slug);
  assert.equal(service.leftWorking(project, topic()), false, "a line written moments ago may still be finishing");
  age(2 * 60000);
  assert.equal(service.leftWorking(project, topic()), true);
  await service.watchAll();
  assert.equal(status(), "done");
});

test("a line something here still holds is left Working", async t => {
  const { service, project, slug, age, status } = await fixture(t);
  age(2 * 60000);
  const rec = { agent:"omp", id:"s1", projectId:project.id, slug, stepId:"work-1", active:true, lastAt:Date.now() };
  service.conversationStillGoing(project, rec);
  await service.watchAll();
  assert.equal(status(), "working");
});

test("a conversation another PenEcho already ended lets go of the line here", async t => {
  const { service, project, slug, work, status } = await fixture(t);
  const rec = service.conversations.recordOf("omp", "s1", { projectId:project.id, slug, stepId:work.id, active:true, lastAt:Date.now() - 3600000, lastSay:"Done." });
  service.conversationStillGoing(project, rec);
  // The other PenEcho saved the conversation as ended before this one looked.
  const other = new ImportState(service);
  other.save(project, { ...rec, active:false });
  other.close();
  await service.conversations.settle(project);
  assert.equal(service.live.has(service.key(project, slug)), false);
  assert.equal(status(), "done");
});

test("a note left after the record already says ended is cleared on a later look", async t => {
  const { service, project, slug, work, status } = await fixture(t);
  const rec = service.conversations.recordOf("omp", "s2", { projectId:project.id, slug, stepId:work.id, active:false, lastAt:Date.now() - 3600000, lastSay:"Done." });
  service.conversationStillGoing(project, rec);
  await service.conversations.settle(project);
  assert.equal(service.live.has(service.key(project, slug)), false);
  assert.equal(status(), "done");
});
