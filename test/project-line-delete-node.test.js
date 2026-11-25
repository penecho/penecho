"use strict";
require("./helpers/safety.js");
// Every node of a Line can be deleted (PE-1144): it leaves what later agents read, and Restore brings it back.
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { Service } = require("../src/server/project-lines/service.js");
const F = require("../src/server/project-lines/format.js");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-delete-node-"));
test.after(() => fs.rmSync(temp, { recursive:true, force:true }));
let count = 0;
const LINE = `---
id: DE-1
status: done
git: no
created: 2026-11-25 10:00
---

# Two jobs

## Decided by you

- Which tone? **Blue-secret**

## Ask · 2026-11-25 10:00

First secret-alpha request

## [x] Work 1 · @codex · 2 min

Did secret-beta.

[Details](../works/two-jobs/work-1.md)

## [x] Orchestrator review · @claude

Secret-review says fine.

[Details](../works/two-jobs/work-1--review.md)

<!-- penecho-review-of: work-1 -->

## Ask · 2026-11-25 11:00

Second request

> Refers to [Work 1](../works/two-jobs/work-1.md): Did secret-beta.

## [x] Work 2 · @codex · 3 min

Second done.

[Details](../works/two-jobs/work-2.md)
`;
function setup() {
  const root = path.join(temp, String(++count)), docs = path.join(root, "docs");
  fs.mkdirSync(path.join(root, "state"), { recursive:true });
  const service = new Service({ directory:path.join(root, "state"), home:root, autoWatch:false, agents:{ list:() => [], get:() => null, hasResumeSession:() => true } });
  const project = service.store.create({ name:"Demo", docsPath:docs, codePath:null });
  fs.mkdirSync(path.join(docs, "lines"), { recursive:true }); fs.mkdirSync(path.join(docs, "works/two-jobs"), { recursive:true });
  const put = (rel, text) => fs.writeFileSync(path.join(docs, rel), text), read = rel => fs.readFileSync(path.join(docs, rel), "utf8");
  put("lines/two-jobs.md", LINE);
  put("works/two-jobs/work-1.md", `---\nline: ../../lines/two-jobs.md\nstep: Work 1\nreviewed: 2026-11-25\n---\n\n# Work 1\n\n## Asked\n\n> First secret-alpha request\n\n## Result\n\nsecret-beta. Which tone?\n`);
  put("works/two-jobs/work-1--review.md", "# Review secret-review\n");
  put("works/two-jobs/work-1.context.json", JSON.stringify({ attempts:[{ id:"a", currentAsk:"First secret-alpha request" }] }));
  put("works/two-jobs/work-2.md", "---\nstep: Work 2\n---\n\n# Work 2\n\n## Asked\n\n> Second request\n\n## Result\n\nSecond done.\n");
  put("works/two-jobs/work-2.context.json", JSON.stringify({ attempts:[{ id:"b", history:"secret-beta", currentAsk:"Second request", sources:[{ path:"works/two-jobs/work-1.md" }] }] }));
  service.sessions[service.key(project, "two-jobs")] = { codex:{ id:"s1", policyVersion:1, workId:"work-2" } };
  const doc = () => F.parseLine(service.readDoc(project, "two-jobs"));
  const all = () => [read("lines/two-jobs.md"), ...fs.readdirSync(path.join(docs, "works/two-jobs")).map(f => read(`works/two-jobs/${f}`))].join("\n");
  // What the page says it showed (line.js nodeSeen).
  const seen = step => { const steps = doc().steps, s = steps.find(x => x.id === step); return s && { kind:s.kind, when:s.when || "", text:s.text.slice(0, 400), chars:s.text.length, count:steps.filter(x => x.kind === s.kind).length }; };
  return { service, project, docs, doc, all, read, put, seen, drop:step => service.act(project, "two-jobs", "drop-yours", { step, seen:seen(step) }), back:removed => service.act(project, "two-jobs", "restore-yours", { removed }) };
}
test("a finished Work goes with its review, files and quotes, keeps its number, and comes back whole", async () => {
  const x = setup(), { removed } = await x.drop("work-1");
  assert.doesNotMatch(x.all(), /secret-beta|secret-review|Blue-secret/);
  assert.deepEqual(x.doc().steps.map(s => s.id), ["ask-1", "ask-2", "work-2"]);
  assert.equal(x.doc().status, "done");
  assert.deepEqual(F.asksFor(x.doc().steps, x.doc().steps[2]).map(a => a.text), ["Second request"], "its Ask is not given to the next Work");
  const s = x.service.sessions[x.service.key(x.project, "two-jobs")].codex;
  assert.ok(s.dropped && !s.policyVersion, "the next Work starts a new conversation");
  await x.drop("work-2");
  x.service.writeDoc(x.project, "two-jobs", F.updateSteps(x.service.readDoc(x.project, "two-jobs"), steps => steps.push(F.workStep({ who:"codex" }))));
  assert.equal(x.doc().steps.at(-1).id, "work-3");
  await x.back(removed);
  assert.deepEqual(x.doc().steps.map(s => s.id), ["ask-1", "work-1", "work-1--review", "ask-2", "work-3"]);
  assert.match(x.read("lines/two-jobs.md"), /Refers to \[Work 1\][\s\S]*/);
  assert.match(x.read("lines/two-jobs.md"), /Blue-secret/);
  assert.match(x.read("works/two-jobs/work-1.md"), /secret-beta/);
  assert.match(x.read("works/two-jobs/work-1--review.md"), /secret-review/);
  x.service.close();
});
test("an Ask leaves the Work that answered it too", async () => {
  const x = setup(), { removed } = await x.drop("ask-1");
  assert.doesNotMatch(x.all(), /secret-alpha/);
  assert.match(x.read("works/two-jobs/work-1.md"), /reviewed: 2026-11-25/);
  await x.back(removed);
  assert.match(x.read("lines/two-jobs.md"), /secret-alpha/);
  assert.match(x.read("works/two-jobs/work-1.md"), /> First secret-alpha request/);
  x.service.close();
});
test("a review goes alone and stays away; a Line can lose everything; nothing goes while it runs", async () => {
  const x = setup(), { removed } = await x.drop("work-1--review");
  assert.doesNotMatch(x.all(), /secret-review/);
  assert.equal(x.doc().front["reviews deleted"], "work-1");
  await x.back(removed);
  assert.equal(x.doc().front["reviews deleted"], undefined);
  assert.equal(x.doc().steps[2].id, "work-1--review");
  x.service.writeDoc(x.project, "two-jobs", F.setFront(x.service.readDoc(x.project, "two-jobs"), { status:"working" }));
  await assert.rejects(x.drop("work-1"), /still running/);
  x.service.writeDoc(x.project, "two-jobs", F.setFront(x.service.readDoc(x.project, "two-jobs"), { status:"done" }));
  let last;
  while (x.doc().steps.length) last = await x.drop(x.doc().steps.at(-1).id);
  assert.equal(x.doc().status, "notes");
  await x.back(last.removed);
  assert.equal(x.doc().status, "done");
  x.service.close();
});
test("a confirmation deletes the node it showed, and no other that took its place", async () => {
  const x = setup(), stale = x.seen("ask-1"), act = (verb, body) => x.service.act(x.project, "two-jobs", verb, body);
  await assert.rejects(act("drop-yours", { step:"ask-1" }), { code:"CONFLICT" }, "an Ask that was sent goes only by what was shown");
  await act("drop-yours", { step:"ask-1", seen:stale });
  assert.equal(x.doc().steps.find(s => s.id === "ask-1").text, "Second request", "the next Ask has its id now");
  await assert.rejects(act("drop-yours", { step:"ask-1", seen:stale }), { code:"CONFLICT" }, "sent twice, it does not take the next one");
  assert.match(x.read("lines/two-jobs.md"), /Second request/);
  // Two notes and two drafts that say the same at the same minute.
  x.service.writeDoc(x.project, "two-jobs", F.updateSteps(x.service.readDoc(x.project, "two-jobs"), steps => {
    for (const s of [1, 2]) steps.push(F.noteStep({ words:"Same note", when:"2026-11-25 12:00" }), F.askStep({ words:"Same draft", when:"2026-11-25 12:01", via:F.NOT_SENT }));
  }));
  for (const [verb, kind] of [["drop-yours", "note"], ["drop-unsent", "ask"]]) {
    const step = x.doc().steps.filter(s => s.kind === kind).at(-2).id, shown = x.seen(step);
    await act(verb, { step, seen:shown });
    await assert.rejects(act(verb, { step, seen:shown }), { code:"CONFLICT" });
    assert.equal(x.doc().steps.filter(s => s.kind === kind && /^Same/.test(s.text)).length, 1);
  }
  x.service.close();
});
test("a deleted node comes back to its place after the ids before it changed", async () => {
  const x = setup();
  x.service.writeDoc(x.project, "two-jobs", F.updateSteps(x.service.readDoc(x.project, "two-jobs"), steps => {
    steps.splice(4, 0, F.noteStep({ words:"After the second request", when:"2026-11-25 11:01" }));
    steps.push(F.askStep({ words:"Third request", when:"2026-11-25 12:00" }));
  }));
  const { removed } = await x.drop("note-1");
  await x.drop("ask-1");
  await x.back(removed);
  const steps = x.doc().steps, at = steps.findIndex(s => s.kind === "note");
  assert.equal(steps[at - 1].text, "Second request");
  x.service.close();
});
test("a name made of a deleted node's words goes with it, in the line and its Works' files", async () => {
  const x = setup(), rename = (title, by = null) => x.service.writeDoc(x.project, "two-jobs", F.setFront(F.setTitle(x.service.readDoc(x.project, "two-jobs"), title), { "title by":by }));
  rename("First secret-alpha request");
  x.put("works/two-jobs/work-2.md", x.read("works/two-jobs/work-2.md").replace("# Work 2", "# Work 2: First secret-alpha request"));
  x.put("works/two-jobs/work-2.context.json", JSON.stringify({ attempts:[{ id:"b", history:"Line\nSource: lines/two-jobs.md\nFirst secret-alpha request", currentAsk:"Second request" }] }));
  const { removed } = await x.drop("ask-1");
  assert.equal(x.doc().title, "Second request");
  assert.ok(F.wantsTitle(x.doc()), "the next Work names it");
  assert.match(x.read("works/two-jobs/work-2.md"), /^# Work 2: Second request$/m);
  assert.doesNotMatch(x.all(), /secret-alpha/);
  await x.back(removed);
  assert.equal(x.doc().title, "First secret-alpha request");
  assert.match(x.read("works/two-jobs/work-2.md"), /^# Work 2: First secret-alpha request$/m);
  // A name of its own stays, and the Works' files get it.
  for (const by of ["claude", "you"]) {
    rename("Two jobs", by);
    const gone = await x.drop("ask-1");
    assert.equal(x.doc().title, "Two jobs");
    assert.equal(x.doc().front["title by"], by);
    assert.doesNotMatch(x.all(), /secret-alpha/);
    await x.back(gone.removed);
  }
  // Named by the person, in the Ask's own words: it is their name.
  rename("First secret-alpha request", "you");
  await x.drop("ask-1");
  assert.equal(x.doc().title, "First secret-alpha request");
  x.service.close();
});
test("a draft that is all its line holds takes the line with it, until it is restored", async () => {
  const x = setup(), { slug, step } = await x.service.saveUnsent(x.project, { text:"Secret-draft to write", topic:"new" });
  await x.service.act(x.project, slug, "drop-unsent", { step });
  assert.equal(x.service.store.isDeleted(x.project, slug), true);
  for (const dir of ["lines", "archive"]) assert.equal(fs.existsSync(path.join(x.docs, dir, dir === "lines" ? `${slug}.md` : `lines/${slug}.md`)), false);
  assert.ok(!fs.readdirSync(x.docs, { recursive:true }).some(f => /^(?!\.).*\.md$/.test(f) && /secret-draft/i.test(x.read(f))), "no file an agent reads says it");
  x.service.restoreLine(x.project, { slug });
  assert.match(x.read(`lines/${slug}.md`), /Secret-draft to write/);
  // Beside a note, only the draft goes, and the name made of its words.
  x.service.writeDoc(x.project, slug, F.addYours(x.service.readDoc(x.project, slug), F.noteStep({ words:"Plain note" })));
  await x.service.act(x.project, slug, "drop-unsent", { step:x.service.store.parsed(x.project, `lines/${slug}.md`).steps.find(F.isUnsent).id });
  assert.doesNotMatch(x.read(`lines/${slug}.md`), /secret-draft/i);
  assert.equal(F.parseLine(x.read(`lines/${slug}.md`)).title, "Plain note");
  x.service.close();
});
test("a merged line loses its Merge too and stays archived; a closed one reopens as what is left", async () => {
  const x = setup();
  await x.service.land(x.project, "two-jobs", { commit:"abc1234", into:"main" });
  assert.equal(x.doc().status, "landed");
  assert.ok(x.service.store.inArchive(x.project, "two-jobs"));
  const seen = x.seen("merge"), { removed } = await x.service.act(x.project, "two-jobs", "drop-yours", { step:"merge", seen });
  assert.equal(x.doc().status, "landed");
  assert.equal(x.doc().steps.some(s => s.kind === "merge"), false);
  await x.back(removed);
  assert.equal(x.doc().steps.at(-1).kind, "merge");
  await x.drop("work-1");
  assert.equal(fs.existsSync(path.join(x.docs, "archive/works/two-jobs/work-1.md")), false);
  assert.doesNotMatch(x.service.readDoc(x.project, "two-jobs"), /secret-beta|secret-review|Blue-secret/);
  assert.equal(x.doc().status, "landed");
  x.service.close();
  const y = setup();
  y.service.writeDoc(y.project, "two-jobs", F.setFront(y.service.readDoc(y.project, "two-jobs"), { status:"waiting", why:"Is secret-beta right?" }));
  await y.service.act(y.project, "two-jobs", "close");
  while (y.doc().steps.length) await y.drop(y.doc().steps.at(-1).id);
  assert.equal(y.doc().status, "closed");
  assert.doesNotMatch(y.service.readDoc(y.project, "two-jobs"), /secret/);
  await y.service.act(y.project, "two-jobs", "reopen");
  assert.equal(y.doc().status, "notes");
  y.service.close();
});
