"use strict";
require("./helpers/safety.js");
// Running an Ask with another agent while an external app conversation (e.g. Codex desktop) is live
// must queue a separate Work behind it and never relabel or absorb the Ask into the live external Work.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Service } = require("../src/server/project-lines/service.js");
const { createAgentPresets } = require("../src/server/project-lines/agent-presets.js");
const F = require("../src/server/project-lines/format.js");

const stubAgents = {
  available:() => [
    { id:"codex", name:"Codex", available:true, runs:true },
    { id:"antigravity", name:"Antigravity", available:true, runs:true },
    { id:"claude", name:"Claude Code", available:true, runs:true },
  ],
  nameOf:id => ({ codex:"Codex", antigravity:"Antigravity", claude:"Claude Code" }[id] || id),
  desktop:() => null,
  terminal:() => "",
  appOnly:() => null,
  modelFor:() => "",
  effortFor:() => "",
};

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "line-live-queue-")), directory = path.join(root, "state");
  fs.mkdirSync(directory);
  const service = new Service({ directory, agents:stubAgents, autoWatch:false });
  service.presets = createAgentPresets({ file:path.join(directory, "agent-presets.json"), agents:stubAgents });
  const project = service.store.create({ name:"LiveQueue", docsPath:path.join(root, "docs") });
  project.follow = false;
  service.store.save();
  const slug = "pack-app";
  const now = Date.now();
  service.writeDoc(project, slug, F.initialLine({
    title:"Pack app", status:"working", who:"codex", source:"Codex desktop",
    steps:[F.askStep({ words:"Rebuild and install macOS app", via:"Codex desktop" }), F.workStep({ who:"codex" })],
  }));
  const rec = {
    agent:"codex", id:"01a20549-codex-session", via:"Codex desktop", slug, projectId:project.id,
    stepId:"work-1", appStep:"work-1", cwd:root, active:true, turnOpen:true,
    workStarted:now - 60000, lastAt:now, lastSay:"", doneTurns:{},
  };
  service.conversations.records[`codex:${rec.id}`] = rec;
  service.conversationStillGoing(project, rec);
  service.sync(project);
  t.after(() => { service.close(); fs.rmSync(root, { recursive:true, force:true }); });
  const doc = () => F.parseLine(service.readDoc(project, slug));
  const line = () => service.stateOf(project).lines.find(l => l.slug === slug);
  const addUnsent = words => {
    service.writeDoc(project, slug, F.updateSteps(service.readDoc(project, slug), steps => steps.push(F.askStep({ words, via:F.NOT_SENT }))));
    return doc().steps.at(-1).id;
  };
  return { service, project, slug, rec, doc, line, addUnsent };
}

test("Run with another agent while Codex desktop is live queues a separate Work and never relabels Codex", async t => {
  const { service, project, slug, rec, doc, line, addUnsent } = setup(t);
  const agyPreset = service.presets.add({ agent:"antigravity", model:"gemini-4-neon", effort:"xhigh" });
  const launched = [];
  service.launch = async (p, s, step, d) => {
    const prepared = service.prepareTask(p, s, step, d, step.who);
    launched.push({ id:step.id, who:step.who, taskMode:prepared.task.mode, taskWhy:prepared.task.why });
  };

  // Add an unsent Ask and click Run with Antigravity while Codex desktop is still working on Work 1.
  const ask2Id = addUnsent("it is still ask for permission!!");
  const res1 = await service.act(project, slug, "run-unsent", { step:ask2Id, agent:"antigravity", preset:agyPreset.id, expectedMode:"next" });
  assert.equal(res1.after, true);
  assert.equal(res1.mode, "queued");
  assert.equal(res1.next, "codex");
  assert.deepEqual(launched, [], "Antigravity waits until Codex desktop finishes");

  // Work 1 stays @codex; Work 2 is queued for @antigravity with its preset pinned.
  let cur = doc();
  assert.equal(cur.front.who, "@codex", "line frontmatter who stays @codex while Codex runs");
  assert.deepEqual(
    cur.steps.map(s => [s.id, s.kind, s.who || "", s.done, s.text || ""]),
    [
      ["ask-1", "ask", "you", true, "Rebuild and install macOS app"],
      ["work-1", "work", "codex", false, ""],
      ["ask-2", "ask", "you", true, "it is still ask for permission!!"],
      ["work-2", "work", "antigravity", false, ""],
    ],
  );
  const pinned = service.workSettings.get(service.workSettingsKey(project, slug, "work-2"));
  assert.equal(pinned?.agent, "antigravity");
  assert.equal(pinned?.model, "gemini-4-neon");
  assert.equal(pinned?.effort, "xhigh");

  const view = line();
  assert.equal(view.running, true);
  assert.equal(view.elsewhere, true);
  assert.equal(view.runAgent, "codex");
  assert.equal(view.stations.find(s => s.id === "work-1").state, "active");
  assert.equal(view.stations.find(s => s.id === "work-1").agent, "codex");
  assert.equal(view.stations.find(s => s.id === "work-2").state, "todo");
  assert.equal(view.stations.find(s => s.id === "work-2").agent, "antigravity");

  // Queue a second Ask for Claude behind Antigravity, then test unqueueing it.
  const ask3Id = addUnsent("check tests afterwards");
  const res2 = await service.act(project, slug, "run-unsent", { step:ask3Id, agent:"claude", expectedMode:"next" });
  assert.equal(res2.mode, "queued");
  assert.equal(res2.next, "codex");
  cur = doc();
  assert.deepEqual(
    cur.steps.filter(s => s.kind === "work").map(s => [s.id, s.who]),
    [["work-1", "codex"], ["work-2", "antigravity"], ["work-3", "claude"]],
  );

  // Live external Work 1 cannot be unqueued; queued Work 3 can be unqueued cleanly.
  await assert.rejects(service.act(project, slug, "unqueue", { step:"work-1" }), err => err.code === "NOT_QUEUED");
  await service.act(project, slug, "unqueue", { step:"work-3" });
  cur = doc();
  assert.equal(cur.front.who, "@codex");
  assert.deepEqual(cur.steps.filter(s => s.kind === "work").map(s => [s.id, s.who]), [["work-1", "codex"], ["work-2", "antigravity"]]);
  assert.ok(F.isUnsent(cur.steps.at(-1)), "unqueued Ask returns to Not sent");

  // Codex desktop finishes Work 1: work-1.md stays @codex and only holds Codex's Ask; Work 2 launches as a fresh Antigravity task.
  rec.lastSay = "Rebuilt and installed PenEcho 1.5.0.";
  rec.active = false;
  rec.turnOpen = false;
  rec.lastAt = Date.now();
  await service.conversationQuiet(project, rec);

  cur = doc();
  const work1 = cur.steps.find(s => s.id === "work-1");
  assert.equal(work1.done, true);
  assert.equal(work1.who, "codex", "closed external Work keeps codex");
  const detail1 = service.store.readText(project, F.detailPath(slug, "work-1")).text;
  assert.equal(F.splitFront(detail1).front.who, "@codex", "work-1.md records @codex");
  assert.match(F.sectionText(detail1, "Asked"), /Rebuild and install macOS app/);
  assert.doesNotMatch(F.sectionText(detail1, "Asked"), /still ask for permission/, "queued Antigravity Ask is not absorbed into Codex's Work");

  assert.equal(launched.length, 1, "queued Antigravity Work starts automatically when Codex finishes");
  assert.deepEqual(launched[0], { id:"work-2", who:"antigravity", taskMode:"new", taskWhy:"Another agent had the last conversation" });
});

test("handTo and request protect live external Works and works queued behind them", async t => {
  const { service, project, slug, doc } = setup(t);
  const agyPreset = service.presets.add({ agent:"antigravity", model:"gemini-4-neon", effort:"high" });

  await service.request(project, { topic:slug, text:"Follow up with Antigravity", agent:"antigravity", preset:agyPreset.id });
  let cur = doc();
  assert.equal(cur.front.who, "@codex");
  assert.deepEqual(cur.steps.filter(s => s.kind === "work").map(s => [s.id, s.who]), [["work-1", "codex"], ["work-2", "antigravity"]]);
  assert.equal(service.workSettings.get(service.workSettingsKey(project, slug, "work-2"))?.model, "gemini-4-neon");

  // Explicit handTo must not overwrite the live Codex Work or the queued Antigravity Work behind it.
  service.handTo(project, slug, "claude");
  cur = doc();
  assert.deepEqual(cur.steps.filter(s => s.kind === "work").map(s => [s.id, s.who]), [["work-1", "codex"], ["work-2", "antigravity"]]);
});

test("two concurrent live external conversations keep handBack until the last one finishes", async t => {
  const { service, project, slug, rec, doc, addUnsent } = setup(t);
  const launched = [];
  service.launch = async (_p, _s, step) => { launched.push({ id:step.id, who:step.who }); };

  // Second live external conversation (Claude desktop) starts Work 2 on the same Line.
  const rec2 = {
    agent:"claude", id:"claude-session-2", via:"Claude desktop", slug, projectId:project.id,
    stepId:"", appStep:"", cwd:rec.cwd, active:true, turnOpen:true,
    workStarted:Date.now(), lastAt:Date.now(), lastSay:"", doneTurns:{},
  };
  service.conversations.records[`claude:${rec2.id}`] = rec2;
  await service.conversationChanges(project, rec2, [{ me:"Second external task", at:Date.now() }]);
  service.conversationStillGoing(project, rec2);

  // User queues an Antigravity Ask while both external conversations are live.
  const askId = addUnsent("Run Antigravity after both");
  await service.act(project, slug, "run-unsent", { step:askId, agent:"antigravity", expectedMode:"next" });
  assert.deepEqual(doc().steps.filter(s => s.kind === "work").map(s => [s.id, s.who]), [["work-1", "codex"], ["work-2", "claude"], ["work-3", "antigravity"]]);

  // First external conversation finishes: Claude is still live, so Antigravity must still wait (and handBack must not be lost).
  rec.lastSay = "Codex done.";
  rec.active = false;
  rec.turnOpen = false;
  await service.conversationQuiet(project, rec);
  assert.deepEqual(launched, [], "still waiting for second live external conversation");

  // Second external conversation finishes: queued Antigravity Work starts now.
  rec2.lastSay = "Claude done.";
  rec2.active = false;
  rec2.turnOpen = false;
  await service.conversationQuiet(project, rec2);
  assert.deepEqual(launched, [{ id:"work-3", who:"antigravity" }]);
});
