"use strict";
require("./helpers/safety.js");
require("./helpers/show-topics.js");
// Build and Rebuild Topics start on a click, with no box to pick an agent in: Settings keeps a saved agent for them (jobs.topics),
// else they run with the default, as any Ask.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const F = require("../src/server/project-lines/format.js");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { createAgentPresets } = require("../src/server/project-lines/agent-presets.js");
const { Service } = require("../src/server/project-lines/service.js");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pe-topics-agent-"));
const services = [];
after(() => { for (const s of services) s.close?.(); fs.rmSync(temp, { recursive:true, force:true }); });
let n = 0;
const fresh = name => { const dir = path.join(temp, `${name}-${++n}`); fs.mkdirSync(dir, { recursive:true }); return dir; };
// A command for each agent that only says its version, so it counts as here.
function fakeAgents(home, ids) {
  const bin = path.join(home, "bin");
  fs.mkdirSync(bin, { recursive:true });
  for (const id of ids) fs.writeFileSync(path.join(bin, id), "#!/bin/sh\necho 1.0.0\n", { mode:0o755 });
  return createAgents({ env:{ HOME:home, PATH:bin }, appFolders:[] });
}
const lineMd = `---\nid: PE-1\nstatus: done\nwho: @claude\ncreated: 2026-11-10 09:00\n---\n\n# Fix the login\n\n## Ask · 2026-11-10 09:00\n\nFix the login.\n`;

test("saved agents keep one for Topics; it is cleared with the saved agent, and an unknown job or agent is refused", () => {
  const home = fresh("home"), file = path.join(fresh("state"), "agent-presets.json"), presets = createAgentPresets({ file, agents:fakeAgents(home, ["claude", "codex"]) });
  assert.deepEqual(presets.list().jobs, { topics:"" });
  assert.equal(presets.jobPreset("topics"), null);
  const haiku = presets.add({ agent:"claude", model:"haiku", effort:"low" });
  presets.setJob("topics", haiku.id);
  assert.equal(createAgentPresets({ file, agents:fakeAgents(home, ["claude", "codex"]) }).list().jobs.topics, haiku.id, "kept on disk");
  assert.equal(presets.jobPreset("topics").model, "haiku");
  presets.setJob("topics", "auto:codex");
  assert.equal(presets.jobPreset("topics").agent, "codex", "a runner as itself can be picked too");
  presets.setJob("topics", haiku.id);
  presets.remove(haiku.id);
  assert.equal(presets.list().jobs.topics, "", "removing the saved agent takes it off the job");
  assert.throws(() => presets.setJob("topics", "gone"), /gone/);
  assert.throws(() => presets.setJob("deploy", ""), /no such job/);
  presets.setJob("topics", "auto:codex");
  presets.setJob("topics", "");
  assert.equal(presets.list().jobs.topics, "", "'' goes back to the default");
});

test("Build Topics runs with the saved agent picked for Topics, with its model and effort; with none, with the default", async () => {
  const home = fresh("home"), agents = fakeAgents(home, ["claude", "codex"]), directory = fresh("state");
  const s = new Service({ directory, agents, autoWatch:false, carryOn:false });
  services.push(s);
  s.presets = createAgentPresets({ file:path.join(directory, "agent-presets.json"), agents });
  s.begin = async () => {};
  s.presets.add({ agent:"claude", model:"opus", effort:"high", default:true });
  const quick = s.presets.add({ agent:"codex", model:"gpt-5-mini", effort:"low" });
  const build = async () => {
    const docs = fresh("docs"), project = s.store.create({ name:`Garden ${n}`, docsPath:docs });
    fs.mkdirSync(path.join(docs, "lines"), { recursive:true });
    fs.writeFileSync(path.join(docs, "lines", "fix-login.md"), lineMd);
    const { slug } = await s.buildTopics(project);
    return { who:F.parseLine(s.readDoc(project, slug)).steps.find(x => x.kind === "work").who, picked:s.presetFor(project, slug, "codex") };
  };
  assert.equal((await build()).who, "claude", "no pick: the default's runner");
  s.presets.setJob("topics", quick.id);
  const picked = await build();
  assert.equal(picked.who, "codex");
  assert.deepEqual(s.presets.handOver(picked.picked), { model:"gpt-5-mini", effort:"low" }, "its model and effort go to the runner");
});
