"use strict";
require("./helpers/safety.js");
// Mark outdated (PE-425): a line no longer valid, or replaced by newer work, goes to the Archive marked Outdated.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Service } = require("../src/server/project-lines/service.js");
const F = require("../src/server/project-lines/format.js");

const agents = { available:() => [], desktop:() => null, terminal:() => "" };
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "line-outdated-")), directory = path.join(root, "state");
  fs.mkdirSync(directory);
  const service = new Service({ directory, agents, autoWatch:false });
  const project = service.store.create({ name:"Outdated", docsPath:path.join(root, "docs") });
  project.follow = false; service.store.save();
  const write = (slug, md) => { service.writeDoc(project, slug, md); service.sync(project); };
  const line = slug => { const state = service.stateOf(project); return [...state.lines, ...state.landed, ...state.backlog].find(l => l.id === slug); };
  const front = slug => F.parseLine(service.readDoc(project, slug)).front;
  t.after(() => { service.close(); fs.rmSync(root, { recursive:true, force:true }); });
  return { service, project, write, line, front };
}
const done = () => F.initialLine({ title:"Old login", status:"done", steps:[F.askStep({ words:"Fix the login" }), F.workStep({ who:"codex", done:true, took:"5 min", body:"Fixed it." })] });

test("Mark outdated archives the line, says Outdated in its file and the README, and Back to lines takes it all off", async t => {
  const { service, project, write, line, front } = setup(t);
  write("old", done());
  await service.act(project, "old", "outdated");
  assert.deepEqual([line("old").archived, line("old").outdated, line("old").closed], [true, true, true]);
  assert.deepEqual(service.stateOf(project).lines.map(l => l.id), [], "it leaves the home");
  assert.equal(front("old").status, "closed", "any reader that knows only Archive still sees it archived");
  assert.equal(front("old").outdated, "yes");
  assert.match(service.readDoc(project, "old"), /> \[!status\] Outdated and archived: no longer valid, or replaced by newer work/);
  assert.match(service.store.readText(project, "README.md").text, /\| \[Old login\]\(archive\/lines\/old\.md\) \| Outdated \|/);
  assert.equal(service.stateFor(project, "rail").landed.find(l => l.id === "old").outdated, true, "the Archive page and Find have it");

  await service.act(project, "old", "reopen");
  assert.deepEqual([line("old").status, line("old").archived, line("old").outdated], ["done", false, false]);
  assert.equal(front("old").outdated, undefined);
  assert.doesNotMatch(service.readDoc(project, "old"), /Outdated/);
});

test("a line in the Archive already only gets the mark, and Undo takes only the mark off", async t => {
  const { service, project, write, line, front } = setup(t);
  write("old", done());
  await service.act(project, "old", "close");
  await service.act(project, "old", "outdated");
  assert.deepEqual([line("old").archived, line("old").outdated, front("old")["before archive"]], [true, true, "done"], "what it was before the Archive is kept");
  await service.act(project, "old", "outdated", { outdated:false });
  assert.deepEqual([line("old").archived, line("old").outdated, front("old").status], [true, false, "closed"]);
  await service.act(project, "old", "reopen");
  assert.equal(line("old").status, "done");
});

test("a merged line stays merged when it is marked outdated", async t => {
  const { service, project, write, line, front } = setup(t);
  write("merged", done().replace("status: done", "status: landed\ncommit: abc1234"));
  await service.act(project, "merged", "outdated");
  assert.deepEqual([front("merged").status, line("merged").commit, line("merged").outdated, line("merged").archived], ["landed", "abc1234", true, true]);
});

test("a working line is stopped and comes back stopped, as Archive does", async t => {
  const { service, project, write, line } = setup(t);
  write("busy", `---\nid: T-6\nstatus: working\n---\n\n# Busy\n\n## Ask · 2026-11-12 09:00\n\nGo.\n\n## [ ] Work 1 · @codex\n`);
  await service.act(project, "busy", "outdated");
  assert.deepEqual([line("busy").archived, line("busy").outdated], [true, true]);
  await service.act(project, "busy", "reopen");
  assert.deepEqual([line("busy").status, line("busy").outdated], ["stopped", false]);
});

test("outdated written by hand on an open line means nothing until it is archived", () => {
  const doc = F.parseLine(`---\nstatus: done\noutdated: yes\n---\n\n# Open\n`);
  assert.equal(F.isOutdated(doc), false);
  assert.equal(F.isOutdated(F.parseLine(`---\nstatus: closed\noutdated: yes\n---\n\n# Gone\n`)), true);
});
