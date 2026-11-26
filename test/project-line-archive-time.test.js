"use strict";
require("./helpers/safety.js");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { parseHTML } = require("./helpers/dom.js");
const F = require("../src/server/project-lines/format.js");
const L = require("../src/server/project-lines/layout.js");
const { Service } = require("../src/server/project-lines/service.js");

function setup(t, hosted = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "archive-time-"));
  const docsPath = path.join(root, "docs");
  const service = new Service({
    directory:path.join(root, "state"), agents:{ available:() => [] }, autoWatch:false, carryOn:false,
    conversations:{ home:path.join(root, "home"), env:{} }, folderWatch:{ enabled:false },
  });
  t.after(() => { service.close(); fs.rmSync(root, { recursive:true, force:true }); });
  if (hosted) L.markVersion(docsPath, 1, { stay:true });
  const project = hosted ? service.store.restoreDownloadedProject({ name:"Archive", docsPath }) : service.store.create({ name:"Archive", docsPath });
  project.follow = false;
  let id = 0;
  const write = (slug, patch = {}) => service.writeDoc(project, slug, F.setFront(F.initialLine({
    title:slug, id:`PE-${++id}`, status:"notes", created:"2026-11-01 08:00", steps:[F.noteStep({ words:"A note", when:"2026-11-01 08:30" })],
  }), patch));
  const read = slug => F.splitFront(service.readDoc(project, slug)).front;
  return { service, project, write, read };
}

for (const hosted of [false, true]) {
  test(`Archive shows one Orchestrator job and restores only the Lines archived with it (${hosted ? "hosted layout" : "local layout"})`, async t => {
    const { service, project, write, read } = setup(t, hosted);
    write("job", { id:"PE-JOB", orchestrator:"yes" });
    write("exact-child", { "orchestrated by slug":"job", status:"waiting", why:"Needs input" });
    write("legacy-child", { "orchestrated by":"PE-JOB" });
    write("old-child", { "orchestrated by":"PE-JOB", status:"landed", commit:"abc1234" });
    write("other-job", { id:"PE-OTHER", orchestrator:"yes" });
    write("other-child", { "orchestrated by slug":"other-job", "orchestrated by":"PE-JOB" });
    write("separate-archive", { status:"closed" });
    service.store.writeText(project, "files/exact-child/result.md", "A saved result");

    await service.act(project, "job", "close");
    assert.equal(read("job").status, "closed");
    assert.equal(read("exact-child").status, "closed");
    assert.equal(read("legacy-child").status, "closed");
    assert.equal(read("old-child").status, "landed");
    assert.equal(read("other-child").status, "notes");
    assert.equal(service.store.readText(project, "files/exact-child/result.md").text, "A saved result");

    const view = service.stateOf(project);
    const { document } = parseHTML("<!doctype html><html><body></body></html>");
    const context = vm.createContext({
      document, navigator:{}, location:{ hash:"", pathname:"/" }, addEventListener() {},
      localStorage:{ getItem:() => null }, HOSTED:hosted, LINE_STATUS:require("../public/lines/line-status.js"),
      view, render() {}, toast() {}, reopen:(line, action) => service.act(project, line.id, action),
    });
    for (const file of ["core", "state", "composer", "pages", "line"]) {
      vm.runInContext(fs.readFileSync(path.join(__dirname, `../public/lines/${file}.js`), "utf8"), context, { filename:`${file}.js` });
    }
    document.body.innerHTML = vm.runInContext("archiveHTML(view)", context);
    assert.deepEqual([...document.querySelectorAll(".ar-row .row-name")].map(button => button.dataset.line).sort(), ["job", "separate-archive"]);
    assert.match(document.querySelector(".ar-row:has([data-line=job]) .ar-meta").textContent, /3 sub-sessions/);
    const reopen = vm.runInContext("S.cur = view.project.id; S.data[S.cur] = view; act = reopen; ACT['reopen-line']", context);
    await reopen(document.querySelector("[data-act=reopen-line][data-line=job]"));
    assert.deepEqual([read("job").status, read("exact-child").status, read("exact-child").why, read("legacy-child").status], ["notes", "waiting", "Needs input", "notes"]);
    assert.equal(read("old-child").commit, "abc1234");
    assert.deepEqual(service.stateOf(project).landed.map(line => line.id).sort(), ["old-child", "separate-archive"]);
  });

  test(`Archive saves the transition time, keeps it during Outdated changes, and resets it on restore (${hosted ? "hosted layout" : "local layout"})`, async t => {
    const { service, project, write, read } = setup(t, hosted);
    const slug = "old-note", live = path.join(project.docsPath, hosted ? "topics/old-note.md" : "lines/old-note.md");
    const archived = hosted ? live : path.join(project.docsPath, "archive/lines/old-note.md");
    const act = (action, body) => service.act(project, slug, action, body);
    const state = () => service.stateOf(project);
    write(slug);
    const created = state().lines[0].createdAt;
    let now = Date.parse("2026-11-14T09:43:28.123Z");
    t.mock.method(Date, "now", () => now);

    await act("close");
    const first = now;
    assert.equal(fs.existsSync(archived), true);
    assert.equal(fs.existsSync(live), hosted);
    assert.equal(F.splitFront(fs.readFileSync(archived, "utf8")).front["archived at"], "2026-11-14T09:43:28.123Z");
    assert.equal(state().landed[0].archivedAt, first);
    assert.equal(service.stateFor(project, "rail").landed[0].archivedAt, first);
    assert.equal(service.stateFor(project, "home").landed[0].archivedAt, first);
    now += 60_000;
    await act("close");
    assert.equal(state().landed[0].archivedAt, first);
    await act("outdated");
    assert.equal(state().landed[0].outdated, true);
    assert.equal(state().landed[0].archivedAt, first);
    await act("outdated", { outdated:false });
    assert.equal(state().landed[0].outdated, false);
    assert.equal(state().landed[0].archivedAt, first);

    await act("reopen");
    assert.equal(read(slug)["archived at"], undefined);
    assert.equal(fs.existsSync(live), true);
    assert.equal(fs.existsSync(archived), hosted);
    assert.deepEqual(state().landed, []);
    assert.equal(state().lines[0].status, "notes");
    assert.equal(Object.hasOwn(state().lines[0], "archivedAt"), false);

    now += 60_000;
    await act("outdated");
    assert.equal(read(slug)["archived at"], new Date(now).toISOString());
    assert.deepEqual([state().landed[0].archivedAt, state().landed[0].outdated, state().landed[0].createdAt], [now, true, created]);
  });
}

test("a Line also gets an archive timestamp when it is combined into another Line", async t => {
  const { service, project, write, read } = setup(t);
  write("combined", { status:"ready" });
  const now = Date.parse("2026-11-14T10:00:00.012Z");
  t.mock.method(Date, "now", () => now);
  await service.land(project, "combined", { line:"remaining", into:"Remaining Line" });
  assert.equal(read("combined")["archived at"], new Date(now).toISOString());
  const line = service.stateOf(project).landed[0];
  assert.equal(line.archivedAt, now);
  assert.equal(line.status, "landed");
  assert.ok(line.landedAt, "the merge still has a date of its own");
});

test("Nested groups stay separate on restore, exact links win, and stale Undo cannot reopen a newer archive", async t => {
  const { service, project, write, read } = setup(t);
  write("outer", { id:"PE-DUP", orchestrator:"yes" });
  write("duplicate", { id:"PE-DUP", status:"closed" });
  write("ambiguous", { "orchestrated by":"PE-DUP" });
  write("nested", { id:"PE-NESTED", orchestrator:"yes", "orchestrated by slug":"outer" });
  write("nested-old", { "orchestrated by":"PE-NESTED" });
  const independentlyArchived = await service.act(project, "nested", "close");
  write("nested-late", { "orchestrated by":"PE-NESTED" });
  write("direct", { "orchestrated by slug":"outer" });
  const first = await service.act(project, "outer", "close");
  assert.deepEqual(first.archivedLines.sort(), ["direct", "nested-late", "outer"]);
  assert.equal(read("ambiguous").status, "notes");
  await service.act(project, "direct", "reopen");
  await service.act(project, "direct", "close");
  await service.act(project, "outer", "reopen", { archiveOperation:first.archiveOperation });
  assert.deepEqual([read("direct").status, read("nested-late").status, read("nested-old").status], ["closed", "notes", "closed"]);
  const second = await service.act(project, "outer", "close");
  assert.notEqual(second.archiveOperation, first.archiveOperation);
  await assert.rejects(service.act(project, "outer", "reopen", { archiveOperation:first.archiveOperation }), { code:"ARCHIVE_CHANGED" });
  assert.equal(read("outer").status, "closed");
  await service.act(project, "nested", "reopen", { archiveOperation:independentlyArchived.archiveOperation });
  assert.equal(read("nested-old").status, "notes");
  assert.equal(read("nested-late").status, "closed");
});

test("Grouped archive rejects stale scope, external work, and cycles before changing any state", async t => {
  const { service, project, write, read } = setup(t);
  write("job", { orchestrator:"yes" });
  write("child", { "orchestrated by slug":"job", orchestrator:"yes" });
  await assert.rejects(service.act(project, "job", "close", { expectedChildren:[] }), { code:"ARCHIVE_CHANGED" });
  service.live.set(service.key(project, "child"), new Map([["external", {}]]));
  await assert.rejects(service.act(project, "job", "close"), { code:"BUSY", message:/child/ });
  service.live.delete(service.key(project, "child"));
  service.writeDoc(project, "job", F.setFront(service.readDoc(project, "job"), { "orchestrated by slug":"child" }));
  await assert.rejects(service.act(project, "job", "close"), { code:"ARCHIVE_CYCLE" });
  assert.deepEqual([read("job").status, read("child").status], ["notes", "notes"]);
});

test("Retry finishes only the admitted archive after a partial write failure", async t => {
  const { service, project, write, read } = setup(t);
  write("job", { orchestrator:"yes" });
  for (const id of ["first", "second"]) write(id, { "orchestrated by slug":"job" });
  const originalWrite = service.writeDoc.bind(service);
  const broken = t.mock.method(service, "writeDoc", (p, id, md, options) => {
    if (id === "job" && F.splitFront(md).front.status === "closed") throw new Error("simulated write failure");
    return originalWrite(p, id, md, options);
  });
  await assert.rejects(service.act(project, "job", "close"), { code:"ARCHIVE_INCOMPLETE" });
  broken.mock.restore();
  const operation = read("job")["archive operation"];
  assert.ok(operation);
  assert.deepEqual([read("job").status, read("first").status, read("second").status], ["notes", "closed", "closed"]);
  await assert.rejects(service.act(project, "first", "reopen"), { code:"ARCHIVE_INCOMPLETE" });
  write("new-child", { "orchestrated by slug":"job" });
  assert.equal((await service.act(project, "job", "close")).archiveOperation, operation);
  assert.deepEqual([read("job").status, read("new-child").status], ["closed", "notes"]);
  await service.act(project, "job", "reopen", { archiveOperation:operation });
  assert.deepEqual([read("job").status, read("first").status, read("second").status], ["notes", "notes", "notes"]);
});

test("legacy Archive times are read without rewriting records and survive later status edits", async t => {
  const { service, project, write, read } = setup(t);
  const modified = Date.parse("2026-11-13T13:28:00Z");
  const merged = "2026-11-11 17:45", created = "2026-11-01 08:00";
  write("closed", { status:"closed", landed:merged, finished:created });
  write("merged", { status:"landed", landed:merged, commit:"abc1234" });
  // A numeric string accepted by Date.parse is still not an ISO timestamp.
  write("invalid", { status:"closed", outdated:"yes", "archived at":"0" });
  write("no-mtime", { status:"closed" });
  for (const slug of ["closed", "merged", "invalid", "no-mtime"]) {
    const seconds = slug === "no-mtime" ? 0 : modified / 1000;
    fs.utimesSync(path.join(project.docsPath, `archive/lines/${slug}.md`), seconds, seconds);
  }
  const map = () => Object.fromEntries(service.stateOf(project).landed.map(l => [l.id, l.archivedAt]));
  const dates = { closed:modified, merged:+new Date("2026-11-11T17:45"), invalid:modified, "no-mtime":+new Date("2026-11-01T08:00") };
  assert.deepEqual(map(), dates);
  assert.equal(read("closed")["archived at"], undefined);
  assert.equal(read("invalid")["archived at"], "0");

  const savedScan = service.sync(project);
  const saved = savedScan.topics.find(line => line.slug === "closed");
  assert.equal(saved.text, service.readDoc(project, "closed"));
  assert.equal(saved.doc.front["archived at"], new Date(modified).toISOString());
  await service.act(project, "closed", "outdated");
  assert.deepEqual(map(), dates);
  assert.equal(read("closed")["archived at"], new Date(modified).toISOString());
  assert.equal(read("merged")["archived at"], new Date(dates.merged).toISOString());
  assert.equal(F.archiveTime({}), 0);
  assert.equal(F.archiveTime({ status:"LANDED", landed:merged }), +new Date("2026-11-11T17:45"));
  assert.equal(read("merged").commit, "abc1234");
});

test("Archive renders the newest entry first from a mixed-order hosted view and Back to lines restores it", async t => {
  const { service, project, write } = setup(t, true);
  let now = +new Date("2026-11-15T16:04:13");
  t.mock.method(Date, "now", () => now);
  write("earlier-archive", { created:"2026-11-12 14:00", finished:"2026-11-12 18:00" });
  write("a-recent-archive");
  write("b-recent-archive");
  await service.act(project, "earlier-archive", "close");
  now = +new Date("2026-11-16T07:05:48");
  await service.act(project, "a-recent-archive", "outdated");
  await service.act(project, "b-recent-archive", "close");
  const state = service.stateOf(project);
  assert.deepEqual(state.landed.map(l => l.id), ["earlier-archive", "a-recent-archive", "b-recent-archive"]);
  const byId = id => state.landed.find(l => l.id === id);
  const legacy = { ...byId("earlier-archive"), id:"legacy-view", title:"Legacy view", archivedAt:undefined, statusAt:+new Date("2026-11-16T07:05:02") };
  // A hosted view may contain older payloads and append a Line rebuilt after an edit.
  const view = { ...state, landed:[byId("earlier-archive"), byId("b-recent-archive"), legacy, byId("a-recent-archive")] };
  const { document } = parseHTML("<!doctype html><html><body></body></html>");
  const context = vm.createContext({
    document, navigator:{}, location:{ hash:"", pathname:"/" }, addEventListener() {},
    localStorage:{ getItem:() => null }, HOSTED:true, LINE_STATUS:require("../public/lines/line-status.js"),
    view, render() {}, toast() {}, reopen:(l, action) => service.act(project, l.id, action),
  });
  for (const file of ["core", "state", "composer", "pages", "line"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, `../public/lines/${file}.js`), "utf8"), context, { filename:`${file}.js` });
  }
  document.body.innerHTML = vm.runInContext("archiveHTML(view)", context);
  const buttons = [...document.querySelectorAll(".ar-row button[data-act='reopen-line']")];
  assert.deepEqual(buttons.map(b => b.dataset.line), ["a-recent-archive", "b-recent-archive", "legacy-view", "earlier-archive"]);
  assert.deepEqual([...document.querySelectorAll(".ar-who time")].map(el => el.textContent), [
    "2026-11-16 07:05", "2026-11-16 07:05", "2026-11-16 07:05", "2026-11-15 16:04",
  ]);
  assert.equal(document.querySelector(".ar-row.is-outdated .ar-meta").textContent, "Outdated");
  assert.equal(buttons[0].textContent, "Back to lines");
  assert.equal(buttons[0].getAttribute("type"), "button");
  const reopen = vm.runInContext("S.cur = view.project.id; S.data[S.cur] = view; act = reopen; ACT['reopen-line']", context);
  await reopen(buttons[0]);
  assert.ok(service.stateOf(project).lines.some(l => l.id === "a-recent-archive"));
});
