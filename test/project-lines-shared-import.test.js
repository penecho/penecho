"use strict";
require("./helpers/safety.js");
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { fork } = require("node:child_process");
const { Service } = require("../src/server/project-lines/service.js");
const F = require("../src/server/project-lines/format.js");
const Shared = require("../src/server/project-lines/import-state.js");
const agents = { available:() => [], list:() => [], get:() => null, has:() => false, defaultId:() => "" };
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-shared-import-")), docs = path.join(root, "docs"), home = path.join(root, "home"), services = [];
  function app() {
    const directory = path.join(root, `state-${services.length}`); fs.mkdirSync(directory, { recursive:true });
    const s = new Service({ directory, agents, autoWatch:false, conversations:{ home, idleMs:45000 } });
    const p = services.length ? s.store.importFolder({ docsPath:docs }) : s.store.create({ name:"Shared", docsPath:docs });
    p.followSince = 1; services.push(s); return { s, p, c:s.conversations };
  }
  const first = app();
  function say(id, text, append = false) {
    const folder = path.join(home, ".claude/projects", fs.realpathSync(docs).replace(/[^A-Za-z0-9]/g, "-")); fs.mkdirSync(folder, { recursive:true });
    const file = path.join(folder, `${id}.jsonl`);
    fs.writeFileSync(file, JSON.stringify({ type:"user", timestamp:"2026-11-17T10:00:00Z", cwd:docs, entrypoint:"claude-desktop", message:{ role:"user", content:text } }) + "\n", { flag:append ? "a" : "w" });
    return file;
  }
  const lines = () => first.s.store.scan(first.p).topics;
  t.after(() => { for (const s of services) s.close(); fs.rmSync(root, { recursive:true, force:true }); });
  return { root, docs, home, app, say, lines, ...first };
}
async function workers(configs) {
  const children = configs.map(config => {
    const child = fork(path.join(__dirname, "fixtures/shared-import-worker.cjs"), [], { stdio:["ignore", "ignore", "pipe", "ipc"] });
    let stderr = ""; child.stderr.on("data", b => stderr += b);
    const ready = new Promise((resolve, reject) => { child.once("message", m => m.error ? reject(Error(m.error)) : resolve(m)); child.once("error", reject); });
    child.send(config);
    return { child, ready, result:() => new Promise((resolve, reject) => {
      child.once("message", m => m.error ? reject(Error(m.error)) : resolve(m));
      child.once("error", reject); child.once("exit", code => { if (code) reject(Error(stderr || `Child exited ${code}`)); });
    }) };
  });
  try { await Promise.all(children.map(c => c.ready)); const pending = children.map(c => c.result()); for (const c of children) c.child.send({ go:true }); return await Promise.all(pending); }
  finally { for (const c of children) if (c.child.connected) c.child.disconnect(); }
}
test("two processes and a later manual sync import one conversation once", async t => {
  const f = setup(t); f.say("one", "Make the header blue");
  await workers(["a", "b"].map(n => ({ docs:f.docs, home:f.home, directory:path.join(f.root, n) })));
  assert.equal(f.lines().length, 1);
  const second = f.app(); await second.c.syncRecent(second.p);
  assert.equal(f.lines().length, 1); assert.equal(f.lines()[0].doc.asks.length, 1);
  f.say("one", "Make the header blue", true); // Same text/time, different event.
  await Promise.all([f.c.tick(), second.c.tick()]); await second.c.tick();
  assert.equal(f.lines()[0].doc.asks.length, 2);
});
test("different sessions with identical titles keep distinct files and PE numbers", async t => {
  const f = setup(t), b = f.app(); f.say("one", "Hi"); f.say("two", "Hi");
  await Promise.all([f.c.tick(), b.c.tick()]); await b.c.tick();
  assert.equal(f.lines().length, 2); assert.equal(new Set(f.lines().map(l => l.doc.front.id)).size, 2);
});
test("PE reservations are unique across processes with stale private counters", async t => {
  const f = setup(t);
  const results = await workers(["a", "b"].map(n => ({ docs:f.docs, home:f.home, directory:path.join(f.root, n), action:"ids", count:30 })));
  const ids = results.flatMap(r => r.ids); assert.equal(ids.length, 60); assert.equal(new Set(ids).size, 60);
});
test("crash after first Line write reuses the reserved destination and Work", async t => {
  const f = setup(t); const file = f.say("one", "A recoverable request");
  const write = f.s.writeDoc.bind(f.s); let fail = true;
  f.s.writeDoc = (...args) => { const out = write(...args); if (fail && args[2].includes("penecho-import:")) { fail = false; throw Error("simulated crash after write"); } return out; };
  await f.c.tick(); assert.equal(f.lines().length, 1);
  const second = f.app(); await second.c.tick();
  assert.equal(f.lines().length, 1); assert.equal(f.lines()[0].doc.asks.length, 1);
  assert.equal(f.lines()[0].doc.steps.filter(s => s.kind === "work").length, 1);
  assert.equal(second.c.records["claude:one"].offset, fs.statSync(file).size);
});
test("crash after a follow-up write does not append it or its Work again", async t => {
  const f = setup(t); f.say("one", "First request"); await f.c.tick();
  const rec = f.c.records["claude:one"]; rec.lastSay = "First answer"; f.c.shared.save(f.p, rec);
  f.say("one", "Second request", true);
  const write = f.s.writeDoc.bind(f.s); let fail = true;
  f.s.writeDoc = (...args) => { const out = write(...args); if (fail && args[2].includes("Second request")) { fail = false; throw Error("simulated crash after follow-up"); } return out; };
  await f.c.tick(); const before = f.lines()[0].doc;
  const second = f.app(); await second.c.tick(); const after = f.lines()[0].doc;
  assert.equal(after.asks.length, 2); assert.equal(after.steps.length, before.steps.length);
});
test("a dead importer lock is recovered; a live lock is never stolen", async t => {
  const f = setup(t); f.say("one", "Recover the import");
  const rec = { agent:"claude", id:"one" }, file = f.c.shared.file(f.p, rec);
  Shared.atomic(`${file}.lock`, { pid:2147483647, host:os.hostname(), token:"dead" });
  await f.c.tick(); assert.equal(f.lines().length, 1);
  const release = Shared.lock(`${file}.lock`, f.c.shared.instance);
  f.say("one", "Later", true); const b = f.app(); await b.c.tick(); assert.equal(f.lines()[0].doc.asks.length, 1);
  release(); await b.c.tick(); assert.equal(f.lines()[0].doc.asks.length, 2);
});
test("unchanged transcripts do not touch shared checkpoints or locks", async t => {
  const f = setup(t); f.say("one", "Idle import"); await f.c.tick();
  let calls = 0; const run = f.c.shared.run.bind(f.c.shared); f.c.shared.run = (...args) => { calls++; return run(...args); };
  for (let i = 0; i < 20; i++) await f.c.tick();
  assert.equal(calls, 0);
});
test("a corrupt shared checkpoint fails closed without creating another Line", async t => {
  const f = setup(t); f.say("one", "Keep the existing record"); await f.c.tick();
  const rec = f.c.records["claude:one"]; fs.writeFileSync(f.c.shared.file(f.p, rec), "corrupt");
  const b = f.app(); await b.c.tick(); assert.equal(f.lines().length, 1);
});
test("replaying a multi-turn batch leaves already finished Works finished", async t => {
  const f = setup(t), file = f.say("one", "First request");
  const answer = text => JSON.stringify({ type:"assistant", timestamp:"2026-11-17T10:01:00Z", message:{ role:"assistant", content:[{ type:"text", text }] } }) + "\n";
  fs.appendFileSync(file, answer("First answer")); f.say("one", "Second request", true); fs.appendFileSync(file, answer("Second answer"));
  const write = f.s.writeDoc.bind(f.s); let fail = true;
  f.s.writeDoc = (...args) => { const out = write(...args); if (fail && args[2].includes("Second request")) { fail = false; throw Error("simulated mid-batch crash"); } return out; };
  await f.c.tick(); const b = f.app(); await b.c.tick();
  const works = f.lines()[0].doc.steps.filter(s => s.kind === "work");
  assert.equal(f.lines()[0].doc.asks.length, 2); assert.equal(works.length, 2); assert.ok(works[0].done);
});
test("Codex replay after creation failure does not checkpoint an undelivered turn", async t => {
  const f = setup(t), rec = f.c.recordOf("codex", "thread");
  const thread = { id:"thread", cwd:f.docs, updatedAt:1794909600 };
  const client = { call:async () => ({ thread:{ turns:[{ id:"turn", startedAt:1794909600, completedAt:1794909660, status:"completed", items:[{ id:"user", type:"userMessage", content:[{ type:"text", text:"A Codex request" }] }, { id:"answer", type:"agentMessage", text:"A Codex answer" }] }] } }) };
  const write = f.s.writeDoc.bind(f.s); let fail = true;
  f.s.writeDoc = (...args) => { const out = write(...args); if (fail) { fail = false; throw Error("crash"); } return out; };
  await assert.rejects(f.c.readCodex(client, { project:f.p }, thread, rec, 0));
  const b = f.app(), next = b.c.recordOf("codex", "thread"); await b.c.readCodex(client, { project:b.p }, thread, next, 0);
  assert.equal(f.lines().length, 1); assert.equal(f.lines()[0].doc.asks.length, 1); assert.equal(next.doneTurns.turn, 1); assert.equal(next.lastSay, "A Codex answer");
});
test("renaming a Line keeps its identity when another instance imports a follow-up", async t => {
  const f = setup(t); f.say("one", "Original title"); await f.c.tick();
  const slug = f.lines()[0].slug; f.s.nameLine(f.p, slug, "Renamed by the owner", "you");
  f.say("one", "Next request", true); const b = f.app(); await b.c.tick();
  assert.equal(f.lines().length, 1); assert.equal(f.lines()[0].slug, slug); assert.equal(f.lines()[0].doc.asks.length, 2);
});
test("an abandoned partially written lock and reaper can be recovered", t => {
  const f = setup(t), file = path.join(f.docs, ".penecho/imports/test.lock"); fs.mkdirSync(path.dirname(file), { recursive:true });
  fs.writeFileSync(file, ""); fs.utimesSync(file, new Date(0), new Date(0));
  Shared.atomic(`${file}.reap`, { pid:2147483647, host:os.hostname(), token:"dead-reaper" });
  const release = Shared.lock(file, f.c.shared.instance); assert.equal(typeof release, "function"); release(); assert.ok(!fs.existsSync(file));
});
test("moving an imported Line preserves its shared binding for the other instance", async t => {
  const f=setup(t);f.say("one","A movable conversation");await f.c.tick();const rec=f.c.records["claude:one"],slug=rec.slug;
  Object.assign(rec,{active:false,turnOpen:false,lastAt:0,mtime:0});f.s.live.delete(f.s.key(f.p,slug));
  f.s.writeDoc(f.p,slug,F.setFront(f.s.readDoc(f.p,slug),{status:"done"}));f.c.shared.save(f.p,rec);
  const target=f.s.store.create({name:"Target",docsPath:path.join(f.root,"target")});await f.s.moveLine(f.p,slug,{to:target.id});
  const b=f.app(),other=b.s.store.importFolder({docsPath:target.docsPath});other.followSince=1;f.say("one","Follow it to the new project",true);await b.c.tick();
  assert.equal(f.lines().length,0);const moved=b.s.store.scan(other).topics;assert.equal(moved.length,1);assert.equal(moved[0].doc.asks.length,2);
});
