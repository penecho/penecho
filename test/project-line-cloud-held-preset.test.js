"use strict";
require("./helpers/safety.js");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { Service } = require("../src/server/project-lines/service.js");
const { createAgentPresets } = require("../src/server/project-lines/agent-presets.js");
const F = require("../src/server/project-lines/format.js");
const CA = require("../src/server/project-lines/computer-asks.js");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cloud-held-preset-"));
  const agents = { available:() => ["codex", "antigravity"].map(id => ({ id, name:id, available:true })), desktop:() => null, terminal:() => "" };
  const service = new Service({ directory:path.join(root, "state"), agents, autoWatch:false, keepAgents:false });
  t.after(() => { service.close(); fs.rmSync(root, { recursive:true, force:true }); });
  service.presets = createAgentPresets({ file:path.join(root, "state", "presets.json"), agents });
  const project = service.store.create({ name:"Garden", docsPath:path.join(root, "docs") });
  project.follow = false;
  const codex = service.presets.add({ agent:"codex", model:"codex-model", effort:"low", default:true });
  const chosen = service.presets.add({ agent:"antigravity", model:"gemini-4-neon", effort:"high" });
  const continued = [];
  service.launch = async () => {};
  service.continueReply = async (_project, _slug, step) => { continued.push(step); return "continued"; };
  return { service, project, codex, chosen, continued };
}

const draft = () => F.askStep({ words:"Make a chart.", via:F.NOT_SENT });
const pinOf = (service, project, slug, step) => service.workSettings.get(service.workSettingsKey(project, slug, step.id));

test("PE-911: a saved computer hold is a new Ask, not a reply to the default agent", async t => {
  const { service, project, chosen, continued } = fixture(t), slug = "rain";
  const md = F.setFront(F.initialLine({ title:"Rain", status:"waiting", steps:[draft()] }), { why:F.NOT_SENT, who:"@codex" });
  const held = CA.holdUnsentText(md, { agent:chosen.agent, preset:chosen.id });
  service.writeDoc(project, slug, held.md);
  assert.equal(service.isWaitingForReply(F.parseLine(held.md)), false);
  assert.equal(service.readCachedState(project).state.lines.find(line => line.slug === slug).waitingForReply, false);
  await service.sendUnsent(project, slug, { step:held.step });
  const doc = service.parsedDoc(project, slug), work = doc.steps.find(step => step.kind === "work");
  assert.equal(work?.who, "antigravity");
  assert.equal(doc.status, "working");
  assert.notEqual(doc.front.why, CA.WAITING);
  assert.equal(doc.steps.filter(F.isUnsent).length, 0);
  assert.deepEqual(continued, []);
  assert.equal(service.presetFor(project, slug, work.who, work.id).id, chosen.id);
});

test("PE-911: an unowned waiting reply falls back to the chosen preset or by, not the Line's old agent", async t => {
  const { service, project, chosen } = fixture(t);
  for (const [slug, options] of [["chosen", { chosen }], ["by", { by:chosen.agent }]]) {
    const md = F.setFront(F.initialLine({ title:slug, status:"waiting", steps:[] }), { why:"Ready for your reply", who:"@codex" });
    service.writeDoc(project, slug, md);
    assert.equal(service.isWaitingForReply(F.parseLine(md)), true);
    assert.equal((await service.addFeedback(project, slug, { text:"Continue with the chart.", ...options })).mode, "continued");
    const work = service.parsedDoc(project, slug).steps.find(step => step.kind === "work");
    assert.equal(work?.who, chosen.agent);
    if (options.chosen) {
      assert.equal(service.stepPresets.get(`${service.key(project, slug)}:${work.id}`), chosen.id);
      const pin = pinOf(service, project, slug, work);
      assert.deepEqual([pin.agent, pin.model, pin.effort], [chosen.agent, chosen.model, chosen.effort]);
    }
  }
});

test("PE-911: a genuine question still continues its own Work despite a separate computer hold", async t => {
  const { service, project, chosen, codex, continued } = fixture(t), slug = "question";
  const original = F.initialLine({ title:"Question", status:"waiting", steps:[F.workStep({ who:codex.agent, wait:true }), draft()] });
  const md = F.setAbove(original, F.QUESTIONS, F.renderQuestions([{ from:codex.agent, text:"Which chart?", options:["Bars", "Lines"] }]));
  const held = CA.holdUnsentText(md, { agent:chosen.agent, preset:chosen.id });
  service.writeDoc(project, slug, held.md);
  const before = service.parsedDoc(project, slug), oldWork = before.steps.find(step => step.kind === "work");
  service.stepPresets.set(`${service.key(project, slug)}:${oldWork.id}`, codex.id);
  assert.equal(service.isWaitingForReply(before), false);
  assert.equal((await service.answer(project, slug, before.questions[0].id, "Bars", { chosen, questionRev:before.questionRev })).mode, "continued");
  const doc = service.parsedDoc(project, slug), work = doc.steps.find(step => step.id === continued[0]);
  assert.equal(work?.who, codex.agent);
  assert.equal(pinOf(service, project, slug, work).model, codex.model);
  assert.equal(doc.steps.find(F.isUnsent)?.held?.preset, chosen.id);

  const other = service.presets.add({ agent:codex.agent, model:"new-model", effort:"high" });
  service.writeDoc(project, slug, held.md);
  await service.answer(project, slug, before.questions[0].id, "Lines", { chosen:other, questionRev:before.questionRev });
  const updated = service.parsedDoc(project, slug).steps.find(step => step.id === continued[1]);
  assert.equal(service.stepPresets.get(`${service.key(project, slug)}:${updated.id}`), other.id);
  assert.equal(pinOf(service, project, slug, updated).model, other.model);
});

test("PE-911: pinSettings rejects foreign chosen, cached and persisted preset settings", t => {
  const { service, project, codex, chosen } = fixture(t), slug = "pins";
  const source = { id:"work-1", who:codex.agent, kind:"work" }, step = { id:"work-2", who:codex.agent };
  service.workSettings.set(service.workSettingsKey(project, slug, source.id), { ...chosen, agent:codex.agent });
  service.stepPresets.set(`${service.key(project, slug)}:${source.id}`, chosen.id);
  service.store.writeText(project, service.stepDetail(project, slug, source), F.setFront("# Work\n", { who:"@codex", "saved agent id":chosen.id, "selected model":chosen.model, "selected effort":chosen.effort }));
  service.pinSettings(project, slug, step, source, chosen);
  const pin = pinOf(service, project, slug, step);
  assert.deepEqual([pin.agent, pin.id, pin.model, pin.effort], [codex.agent, codex.id, codex.model, codex.effort]);
});
