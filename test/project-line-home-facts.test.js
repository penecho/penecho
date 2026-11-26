"use strict";
require("./helpers/safety.js");
// H1's list of what the Home needs from the server: a line's last activity, when each Work ended, Archive and Reopen putting a line
// back as it was, and a pin kept with the project.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Service } = require("../src/server/project-lines/service.js");
const F = require("../src/server/project-lines/format.js");

const agents = { available:() => [], desktop:() => null, terminal:() => "" };
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "home-facts-")), directory = path.join(root, "state");
  fs.mkdirSync(directory);
  const service = new Service({ directory, agents, autoWatch:false });
  const project = service.store.create({ name:"Home", docsPath:path.join(root, "Docs") });
  const write = (slug, md) => { service.writeDoc(project, slug, md); service.sync(project); };
  const line = slug => { const st = service.stateOf(project); return [...st.lines, ...st.landed, ...st.backlog].find(l => l.id === slug); };
  t.after(() => { service.close(); fs.rmSync(root, { recursive:true, force:true }); });
  return { service, project, write, line };
}
const at = label => { const [d, h] = label.split(" "), [y, m, day] = d.split("-").map(Number), [hh, mm] = h.split(":").map(Number); return new Date(y, m - 1, day, hh, mm).getTime(); };

test("lastActivityAt is the time of the last note, Ask, Work start or Work end; each Work says when it ended", async t => {
  const { service, project, write, line } = setup(t);
  write("tap", `---\nid: T-1\nstatus: done\ncreated: 2026-11-01 08:00\n---\n\n# Fix the tap\n\n## Ask · 2026-11-10 09:00\n\nIt drips.\n\n## [x] Work 1 · @codex · 5 min\n\nFixed.\n\n[Details](tap/work-1.md)\n`);
  service.store.writeText(project, "topics/tap/work-1.md", `---\nline: ../tap.md\nstep: Work 1\nwho: @codex\nstarted: 2026-11-11 10:00\ntook: 5 min\n---\n\n# Work 1\n\n## Result\n\nFixed.\n`);
  let l = line("tap");
  const work = l.stations.find(s => s.kind === "work");
  assert.equal(work.startedAt, at("2026-11-11 10:00"));
  assert.equal(work.endedAt, at("2026-11-11 10:05"), "a Work from before `ended` was written: its start and how long it took");
  assert.equal(l.lastActivityAt, at("2026-11-11 10:05"));
  // A note later on moves it; a rename does not.
  write("tap", service.readDoc(project, "tap") + `\n## Note · 2026-11-12 08:30\n\nWasher replaced.\n`);
  l = line("tap");
  assert.equal(l.lastActivityAt, at("2026-11-12 08:30"));
  await service.act(project, "tap", "rename", { title:"Kitchen tap", baseHash:l.topicHash });
  assert.equal(line("tap").lastActivityAt, at("2026-11-12 08:30"));
  // A Work that ends now writes when.
  await service.closeDetail(project, "tap", work.id, { result:"Fixed again.", took:"7 min" });
  const front = F.splitFront(service.store.readText(project, "topics/tap/work-1.md").text).front;
  assert.match(front.ended, /^\d{4}-\d\d-\d\d \d\d:\d\d$/);
  assert.equal(line("tap").stations.find(s => s.kind === "work").endedAt, at(front.ended));
  // A line with nothing dated goes by when it was made.
  write("empty", `---\nid: T-2\nstatus: notes\ncreated: 2026-11-05 07:15\n---\n\n# Nothing yet\n`);
  assert.equal(line("empty").lastActivityAt, at("2026-11-05 07:15"));
});

test("Archive keeps what a line was, and Reopen puts it back so: notes, waiting (with why), stopped; working comes back stopped", async t => {
  const { service, project, write, line } = setup(t);
  write("notes", F.initialLine({ title:"Shopping", status:"notes", steps:[F.noteStep({ words:"Milk" })] }));
  write("unsent", `---\nid: T-3\nstatus: waiting\nwhy: Not sent\n---\n\n# Later\n\n## Ask · 2026-11-12 09:00 · Not sent\n\nDo it later.\n`);
  write("asked", `---\nid: T-4\nstatus: waiting\nwhy: Which colour?\n---\n\n# Paint\n\n## Ask · 2026-11-12 09:00\n\nPaint it.\n\n## [ ] Work 1 · @codex\n`);
  write("stopped", `---\nid: T-5\nstatus: stopped\nwhy: tests are red\n---\n\n# Build\n\n## Ask · 2026-11-12 09:00\n\nBuild it.\n\n## [ ] Work 1 · @codex\n`);
  write("busy", `---\nid: T-6\nstatus: working\n---\n\n# Busy\n\n## Ask · 2026-11-12 09:00\n\nGo.\n\n## [ ] Work 1 · @codex\n`);
  const before = Object.fromEntries(["notes", "unsent", "asked", "stopped"].map(slug => [slug, [line(slug).status, F.parseLine(service.readDoc(project, slug)).front.why || ""]]));
  for (const slug of ["notes", "unsent", "asked", "stopped", "busy"]) {
    await service.act(project, slug, "close");
    assert.equal(line(slug).archived, true, slug);
  }
  for (const slug of ["notes", "unsent", "asked", "stopped", "busy"]) await service.act(project, slug, "reopen");
  for (const slug of ["notes", "unsent", "asked", "stopped"]) {
    assert.deepEqual([line(slug).status, F.parseLine(service.readDoc(project, slug)).front.why || ""], before[slug], slug);
    assert.equal(F.parseLine(service.readDoc(project, slug)).front["before archive"], undefined, "nothing of the Archive is left in the file");
  }
  assert.equal(line("busy").status, "stopped");
  // A line archived before Archive kept anything: with only notes, it comes back as notes, not as done.
  write("old", `---\nid: T-7\nstatus: closed\n---\n\n# Old notes\n\n## Note · 2026-11-01 09:00\n\nKeep this.\n`);
  await service.act(project, "old", "reopen");
  assert.equal(line("old").status, "notes");
});

test("a pin is kept in the line's own file, shows on the line and in the rail's view, and comes off", async t => {
  const { service, project, write, line } = setup(t);
  write("tap", `---\nid: T-1\nstatus: done\n---\n\n# Fix the tap\n\n## Ask · 2026-11-10 09:00\n\nIt drips.\n`);
  assert.equal(line("tap").pinned, false);
  await service.act(project, "tap", "pin", { pinned:true });
  assert.equal(line("tap").pinned, true);
  assert.equal(F.parseLine(service.readDoc(project, "tap")).front.pinned, "yes", "in the file, so it travels with the project");
  assert.equal(service.stateFor(project, "rail").lines.find(l => l.id === "tap").pinned, true);
  await assert.rejects(service.act(project, "tap", "pin", {}), { code:"BAD_PIN" });
  await service.act(project, "tap", "pin", { pinned:false });
  assert.equal(line("tap").pinned, false);
  assert.equal(F.parseLine(service.readDoc(project, "tap")).front.pinned, undefined);
});
