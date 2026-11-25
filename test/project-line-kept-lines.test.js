"use strict";
require("./helpers/safety.js");
// PE-460: while agents run, a project's state is made again every few seconds. Only the lines whose own things changed are made again;
// the others are kept as they were, and the state is the same as one made from nothing.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Service } = require("../src/server/project-lines/service.js");
const { createAgents } = require("../src/server/project-lines/agents.js");

const agents = { available:() => [], desktop:() => null, terminal:() => "" };
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kept-lines-")), directory = path.join(root, "state");
  fs.mkdirSync(directory);
  const service = new Service({ directory, agents, autoWatch:false });
  const project = service.store.create({ name:"Kept", docsPath:path.join(root, "Docs") });
  const write = (slug, md) => { service.writeDoc(project, slug, md); service.sync(project); };
  const line = slug => { const st = service.stateOf(project); return [...st.lines, ...st.landed, ...st.backlog].find(l => l.id === slug); };
  t.after(() => { service.close(); fs.rmSync(root, { recursive:true, force:true }); });
  return { service, project, write, line };
}
const md = (title, work = "") => `---\nid: K-${title.length}\nstatus: done\ncreated: 2026-11-15 08:00\n---\n\n# ${title}\n\n## Ask · 2026-11-15 09:00\n\n${title}, please.\n\n## [x] Work 1 · @codex · 5 min\n\n${work || "Done."}\n\n[Details](../works/${title.toLowerCase()}/work-1.md)\n`;

test("a line whose own things did not change is kept from the last state; one that changed is made again", t => {
  const { service, project, write, line } = setup(t);
  write("tap", md("Tap"));
  write("door", md("Door"));
  service.store.writeText(project, "works/tap/work-1.md", "---\nline: ../../lines/tap.md\nstep: Work 1\nwho: @codex\nstarted: 2026-11-15 09:00\ntook: 5 min\n---\n\n# Work 1\n\n## Result\n\nFixed.\n");
  const tap = line("tap"), door = line("door");

  // Something else in the project changed (an agent on another line took a step): both lines are kept.
  service.changed(project);
  assert.equal(line("tap"), tap);
  assert.equal(line("door"), door);

  // A run on the tap line says what it is doing now: that line is made again and shows it; the door line is kept.
  service.runs.set(service.key(project, "tap"), { agent:"codex", stepId:"", now:"Reading the tap", started:Date.now(), workdir:"" });
  service.changed(project);
  const running = line("tap");
  assert.notEqual(running, tap);
  assert.equal(running.running, true);
  assert.equal(line("door"), door);
  service.runs.delete(service.key(project, "tap"));

  // A Work's file changing (its result written) makes its line again.
  service.store.writeText(project, "works/tap/work-1.md", "---\nline: ../../lines/tap.md\nstep: Work 1\nwho: @codex\nstarted: 2026-11-15 09:00\ntook: 5 min\n---\n\n# Work 1\n\n## Result\n\nFixed, and the washer replaced.\n");
  service.changed(project);
  assert.match(line("tap").result.text, /washer/);
  assert.equal(line("door"), door);

  // The line's own file changing makes it again.
  write("door", md("Door", "Painted."));
  assert.notEqual(line("door"), door);
  assert.match(line("door").stations.find(s => s.kind === "work").out || line("door").stations.find(s => s.kind === "work").text || "", /Painted/);
});

test("the state made with kept lines is the same as one made from nothing", t => {
  const { service, project, write } = setup(t);
  for (const name of ["Tap", "Door", "Roof"]) write(name.toLowerCase(), md(name));
  service.stateOf(project);
  service.changed(project);
  const kept = JSON.stringify(service.stateOf(project));
  service.lineMemo.clear();
  service.changed(project);
  assert.equal(JSON.stringify(service.stateOf(project)), kept);
});

test("a line deleted from the project is let go from the kept lines", async t => {
  const { service, project, write } = setup(t);
  write("tap", md("Tap"));
  write("door", md("Door"));
  service.stateOf(project);
  assert.ok(service.lineMemo.has(service.key(project, "door")));
  fs.rmSync(path.join(project.docsPath, "lines", "door.md"));
  service.changed(project);
  service.stateOf(project);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(service.lineMemo.has(service.key(project, "door")), false);
  assert.ok(service.lineMemo.has(service.key(project, "tap")));
});

test("where an agent's command is, for the links that open its app, is looked up once and kept for a while", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kept-agent-"));
  let looked = 0;
  const made = createAgents({ env:{ HOME:dir, PATH:"" }, platform:"linux", extra:{ probe:{ name:"Probe", resolve:() => { looked++; return { command:"probe", prefixArgs:[] }; }, desktop:(launch, id) => ({ command:launch.command, args:[id] }) } } });
  assert.deepEqual(made.desktop("probe", "a"), { command:"probe", args:["a"] });
  assert.deepEqual(made.desktop("probe", "b"), { command:"probe", args:["b"] });
  assert.equal(looked, 1);
  made.reset();
  made.desktop("probe", "c");
  assert.equal(looked, 2);
  fs.rmSync(dir, { recursive:true, force:true });
});
