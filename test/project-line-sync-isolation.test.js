"use strict";
require("./helpers/safety.js");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const { Service } = require("../src/server/project-lines/service.js");

// One project's sync, and the live following of every project, must never be blocked by anything outside that project:
// on 2026-11-20 another project's deleted docs folder made every text conversation of "Demo Coding Project" fail to import (PE-822).
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-sync-isolation-"));
after(() => fs.rmSync(temp, { recursive:true, force:true }));
let counter = 0;
const fakeAgents = { available:() => [], list:() => [], get:() => null, has:() => false, defaultId:() => "" };
const NOW = () => Date.now() - 3600000;
const PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function setup(conversations = {}) {
  const root = path.join(temp, `case-${++counter}`), directory = path.join(root, "state"), home = path.join(root, "home");
  fs.mkdirSync(directory, { recursive:true }); fs.mkdirSync(home, { recursive:true });
  const service = new Service({ directory, agents:fakeAgents, autoWatch:false, conversations:{ home, idleMs:45000, ...conversations } });
  const folder = name => { const dir = path.join(root, name); fs.mkdirSync(dir, { recursive:true }); return fs.realpathSync(dir); };
  const make = name => {
    const docs = folder(`${name}-docs`), project = service.store.create({ name, docsPath:docs, codePath:null });
    project.followSince = 1;
    return { project, docs };
  };
  // A project whose docs folder has been deleted, as "asdf" was.
  const gone = name => { const made = make(name); fs.rmSync(made.docs, { recursive:true, force:true }); return made; };
  // A Claude desktop conversation in a project's folder: plain words, or only a picture.
  const say = (docs, id, text, { picture = false } = {}) => {
    const dir = path.join(home, ".claude/projects", docs.replace(/[^A-Za-z0-9]/g, "-"));
    fs.mkdirSync(dir, { recursive:true });
    const content = picture ? [{ type:"image", source:{ type:"base64", media_type:"image/png", data:PIXEL } }] : text;
    const file = path.join(dir, `${id}.jsonl`);
    fs.writeFileSync(file, `${JSON.stringify({ type:"user", timestamp:new Date(NOW()).toISOString(), cwd:docs, entrypoint:"claude-desktop", message:{ role:"user", content } })}\n`);
    fs.utimesSync(file, NOW() / 1000, NOW() / 1000);
    return file;
  };
  const topics = project => service.store.scan(project).topics;
  return { service, conv:service.conversations, make, gone, say, topics, folder, root };
}
const codexThread = (id, cwd, text) => ({ id, cwd, updatedAt:Math.floor(NOW() / 1000), originator:"Codex Desktop", source:"vscode", turns:[{ id:`turn-${id}`, startedAt:Math.floor(NOW() / 1000), status:"completed", items:[{ id:`u-${id}`, type:"userMessage", content:[{ type:"text", text }] }] }] });
const codexClient = (threads, { failRead = new Set() } = {}) => ({ calls:[], async call(method, params) {
  this.calls.push([method, params?.threadId]);
  if (method === "thread/list") return { data:threads.map(({ turns, ...thread }) => thread) };
  if (failRead.has(params.threadId)) throw new Error(`Codex could not read ${params.threadId}`);
  const thread = threads.find(t => t.id === params.threadId);
  return { thread:{ ...thread, path:"" } };
} });
const opencodeSession = (id, directory) => ({ id, directory, updated:NOW() });
const opencodeClient = (sessions, { failRead = new Set() } = {}) => ({ reads:[], async list() { return sessions; }, async read(id) {
  this.reads.push(id);
  if (failRead.has(id)) throw new Error(`OpenCode could not read ${id}`);
  const ms = NOW();
  return { info:{}, messages:[{ info:{ id:`m-${id}`, role:"user", time:{ created:ms } }, parts:[{ id:`p-${id}`, type:"text", text:`Asked in ${id}` }] }, { info:{ id:`a-${id}`, role:"assistant", time:{ created:ms, completed:ms + 1000 } }, parts:[{ id:`q-${id}`, type:"text", text:`Done in ${id}` }] }] };
} });
const quiet = fn => async t => { const warn = console.warn; console.warn = () => {}; try { await fn(t); } finally { console.warn = warn; } };
const titles = (topics) => topics.map(t => t.doc.title);

test("another project's deleted docs folder does not block syncRecent: text, picture, Codex and OpenCode conversations all come in", quiet(async t => {
  const { service, conv, make, gone, say, topics } = setup();
  t.after(() => service.close());
  // The project with the deleted folder is made first, so it sits after Healthy; pastedElsewhere looks at every other project whatever the order.
  gone("asdf");
  const { project, docs } = make("Healthy");
  say(docs, "chat-text", "Make a film about the sea");
  say(docs, "chat-picture", "", { picture:true });
  conv.codexOverride = codexClient([codexThread("cx-1", docs, "Write the README")]);
  conv.opencodeOverride = opencodeClient([opencodeSession("oc-1", docs)]);
  const result = await conv.syncRecent(project);
  assert.equal(result.warnings, undefined, JSON.stringify(result.warnings));
  assert.equal(result.added, 4);
  const found = topics(project);
  assert.equal(found.length, 4);
  assert.ok(found.some(x => /Make a film/.test(x.doc.title)));
  assert.ok(found.some(x => /Write the README/.test(x.doc.title)));
  assert.ok(found.some(x => /Asked in oc-1/.test(x.doc.title)));
  const picture = found.find(x => /^Picture/.test(x.doc.title));
  assert.ok(picture, `a picture-only conversation is titled Picture · date, not ${JSON.stringify(titles(found))}`);
  assert.doesNotMatch(titles(found).join("|"), /object/i);
}));

test("another project's deleted docs folder does not block live following either", quiet(async t => {
  const { service, conv, make, gone, say, topics } = setup();
  t.after(() => service.close());
  const { project, docs } = make("Healthy");
  gone("asdf");
  say(docs, "chat-1", "Plan the trip");
  say(docs, "chat-2", "", { picture:true });
  await conv.tick();
  assert.equal(topics(project).length, 2);
  assert.ok(topics(project).some(x => /^Picture/.test(x.doc.title)));
}));

test("a project whose folders cannot be worked out never stops tick for the others", quiet(async t => {
  const { service, conv, make, say, topics } = setup();
  t.after(() => service.close());
  const { project:broken } = make("Broken");
  const { project, docs } = make("Healthy");
  const rootsOf = conv.rootsOf.bind(conv);
  conv.rootsOf = async p => { if (p.id === broken.id) throw new Error("cannot read this project's folders"); return rootsOf(p); };
  say(docs, "chat-1", "Plan the trip");
  await conv.tick();
  assert.equal(topics(project).length, 1);
  // The same for a manual sync of the healthy project, and of the broken one, which falls back to its plain folders.
  say(docs, "chat-2", "Then the budget");
  const result = await conv.syncRecent(project);
  assert.equal(result.added, 1);
  await conv.syncRecent(broken);
}));

test("a code folder that is gone or unreadable does not break rootsOf or syncRecent", quiet(async t => {
  const { service, conv, make, say, topics, root } = setup();
  t.after(() => service.close());
  const { project, docs } = make("Healthy");
  project.codePaths = [path.join(root, "no-such-code-folder")];
  say(docs, "chat-1", "Plan the trip");
  const roots = await conv.rootsOf(project);
  assert.ok(roots.includes(docs));
  const result = await conv.syncRecent(project);
  assert.equal(result.added, 1);
  assert.equal(topics(project).length, 1);
}));

test("scanFiles: one conversation that fails to read does not stop the files after it", quiet(async t => {
  const { service, conv, make, say, topics } = setup();
  t.after(() => service.close());
  const { project, docs } = make("Healthy");
  say(docs, "a-bad", "This one fails");
  say(docs, "b-good", "This one reads");
  const readFile = conv.readFile.bind(conv);
  conv.readFile = async (source, p, roots, rec, ...rest) => { if (rec.id === "a-bad") throw new Error("unreadable"); return readFile(source, p, roots, rec, ...rest); };
  await conv.tick();
  assert.deepEqual(titles(topics(project)), ["This one reads"]);
}));

test("scanCodex: one thread that fails to read does not stop the threads after it, in any project", quiet(async t => {
  const { service, conv, make, topics } = setup();
  t.after(() => service.close());
  const a = make("A"), b = make("B");
  const threads = [codexThread("cx-bad", a.docs, "Broken thread"), codexThread("cx-a", a.docs, "Thread of A"), codexThread("cx-b", b.docs, "Thread of B")];
  conv.codexOverride = codexClient(threads, { failRead:new Set(["cx-bad"]) });
  await conv.tick();
  assert.deepEqual(titles(topics(a.project)), ["Thread of A"]);
  assert.deepEqual(titles(topics(b.project)), ["Thread of B"]);
}));

test("scanCodex: the project that owns a thread reads it; one owned elsewhere is left alone", quiet(async t => {
  const { service, conv, make, topics, root } = setup();
  t.after(() => service.close());
  const shared = path.join(root, "shared-code"); fs.mkdirSync(shared);
  // The newest project is listed first, so "A" is looked at before "B".
  const b = make("B"), a = make("A");
  a.project.codePaths = [shared]; b.project.codePaths = [shared];
  const cwd = fs.realpathSync(shared);
  conv.recordOf("codex", "cx-b", { projectId:b.project.id });
  conv.codexOverride = codexClient([codexThread("cx-b", cwd, "Belongs to B"), codexThread("cx-free", cwd, "Belongs to nobody yet")]);
  const readBy = [], readCodex = conv.readCodex.bind(conv);
  conv.readCodex = (client, entry, thread, ...rest) => { readBy.push(`${thread.id}:${entry.project.id === a.project.id ? "A" : "B"}`); return readCodex(client, entry, thread, ...rest); };
  await conv.tick();
  assert.equal(readBy.find(x => x.startsWith("cx-b:")), "cx-b:B", "the owner reads it even though A is listed first");
  assert.ok(titles(topics(b.project)).includes("Belongs to B"));
  assert.ok(!titles(topics(a.project)).includes("Belongs to B"), "A never takes what B owns");
}));

test("scanOpencode and recentOpencode skip what another project owns, and one failing session does not stop the rest", quiet(async t => {
  const { service, conv, make, topics } = setup();
  t.after(() => service.close());
  const a = make("A"), b = make("B");
  conv.recordOf("opencode", "oc-b", { projectId:b.project.id });
  const sessions = [opencodeSession("oc-bad", a.docs), opencodeSession("oc-b", a.docs), opencodeSession("oc-a", a.docs)];
  const client = opencodeClient(sessions, { failRead:new Set(["oc-bad"]) });
  conv.opencodeOverride = client;
  const recent = await conv.recentOpencode({ project:a.project, roots:[a.docs] }, 0);
  assert.deepEqual(recent.map(x => x.id).sort(), ["oc-a", "oc-bad"]);
  await conv.scanOpencode([{ project:a.project, roots:[a.docs] }]);
  assert.ok(!client.reads.includes("oc-b"), "a session another project owns is never read");
  assert.deepEqual(titles(topics(a.project)), ["Asked in oc-a"]);
}));

test("syncRecent: one agent source that fails does not stop the others, and says which failed", quiet(async t => {
  const { service, conv, make, say, topics } = setup();
  t.after(() => service.close());
  const { project, docs } = make("Healthy");
  say(docs, "chat-1", "Plan the trip");
  conv.codexOverride = codexClient([codexThread("cx-1", docs, "Write the README")]);
  conv.opencodeOverride = opencodeClient([opencodeSession("oc-1", docs)]);
  // A files agent whose folder cannot be walked.
  conv.fileAgents.unshift({ agent:"boom", via:"Boom", root:docs, line:() => null, read:() => ({ lines:[], next:0 }), folders:() => { throw new Error("boom folders"); }, files:() => [] });
  conv.recentAntigravity = () => { throw new Error("antigravity store is corrupt"); };
  const opencode = conv.opencodeOverride;
  opencode.list = async () => { throw new Error("opencode is down"); };
  const result = await conv.syncRecent(project);
  assert.equal(result.added, 2, "Claude and Codex still come in");
  assert.ok(result.warnings.some(w => /boom/.test(w)), JSON.stringify(result.warnings));
  assert.ok(result.warnings.some(w => /Antigravity/.test(w)));
  assert.ok(result.warnings.some(w => /OpenCode.*opencode is down/.test(w)), JSON.stringify(result.warnings));
  assert.deepEqual(titles(topics(project)).sort(), ["Plan the trip", "Write the README"]);
  // Each agent on its own: OpenCode failing hard (not only its list) still leaves the rest.
  conv.recentOpencode = async () => { throw new Error("opencode crashed"); };
  say(docs, "chat-2", "Then the budget");
  const again = await conv.syncRecent(project);
  assert.equal(again.added, 1);
  assert.ok(again.warnings.some(w => /OpenCode: opencode crashed/.test(w)));
}));

test("syncRecent: a conversation that fails to import does not stop the others", quiet(async t => {
  const { service, conv, make, say, topics } = setup();
  t.after(() => service.close());
  const { project, docs } = make("Healthy");
  say(docs, "chat-1", "Fails");
  say(docs, "chat-2", "Works");
  const readWhole = conv.readWhole.bind(conv);
  conv.readWhole = async (source, p, roots, rec, ...rest) => { if (rec.id === "chat-1") throw new Error("could not read chat-1"); return readWhole(source, p, roots, rec, ...rest); };
  const result = await conv.syncRecent(project);
  assert.equal(result.added, 1);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /chat-1/);
  assert.deepEqual(titles(topics(project)), ["Works"]);
}));

test("settle: one conversation that fails does not stop the others or the stale check", quiet(async t => {
  const { service, conv, make } = setup();
  t.after(() => service.close());
  const { project } = make("Healthy");
  const going = [];
  for (const id of ["one", "two"]) conv.recordOf("claude", id, { projectId:project.id, slug:`line-${id}`, active:true, lastAt:Date.now(), mtime:Date.now() });
  service.conversationStillGoing = (_p, rec) => { going.push(rec.id); if (rec.id === "one") throw new Error("cannot settle one"); };
  let stale = 0;
  conv.settleStale = async () => { stale++; };
  await conv.settle(project);
  assert.deepEqual(going.sort(), ["one", "two"]);
  assert.equal(stale, 1);
}));

test("fillPictures and fillCodexPictures: one conversation that fails does not stop the others", quiet(async t => {
  const { service, conv, make, root } = setup();
  t.after(() => service.close());
  const { project } = make("Healthy");
  const file = path.join(root, "x.jsonl"); fs.writeFileSync(file, "");
  for (const id of ["one", "two"]) conv.recordOf("claude", id, { projectId:project.id, slug:`line-${id}`, file });
  for (const id of ["cone", "ctwo"]) conv.recordOf("codex", id, { projectId:project.id, slug:`line-${id}` });
  conv.codexOverride = codexClient([]);
  const asked = [];
  service.hasCountedPictures = (_p, slug) => { asked.push(slug); if (slug === "line-one" || slug === "line-cone") throw new Error("cannot look"); return false; };
  await conv.fillPictures(project);
  await conv.fillCodexPictures(project);
  assert.deepEqual(asked.sort(), ["line-cone", "line-ctwo", "line-one", "line-two"]);
}));

test("a failed import of a brand-new conversation leaves no owner behind and succeeds on retry", quiet(async t => {
  const { service, conv, make, say, topics } = setup();
  t.after(() => service.close());
  const { project, docs } = make("Healthy");
  say(docs, "chat-1", "Plan the trip");
  const createTopic = service.createTopic.bind(service);
  let failing = true;
  service.createTopic = async (...args) => { if (failing) throw new Error("a transient error"); return createTopic(...args); };
  await conv.tick();
  conv.save(true);
  const saved = JSON.parse(fs.readFileSync(conv.file, "utf8"))["claude:chat-1"];
  assert.ok(saved, "the conversation is known");
  assert.equal(saved.projectId, undefined, "no project is stamped on a conversation that never came in");
  assert.equal(saved.slug, undefined);
  assert.equal(topics(project).length, 0);
  failing = false;
  await conv.tick();
  assert.deepEqual(titles(topics(project)), ["Plan the trip"]);
  assert.equal(conv.records["claude:chat-1"].projectId, project.id);
}));

test("an owned record keeps its owner when an import fails", quiet(async t => {
  const { service, conv, make, say } = setup();
  t.after(() => service.close());
  const { project, docs } = make("Healthy");
  const other = make("Other").project;
  const rec = conv.recordOf("claude", "chat-1", { projectId:other.id, here:other.id });
  say(docs, "chat-1", "Plan the trip");
  await assert.rejects(conv.shared.run(project, rec, async () => { throw new Error("later failure"); }), /later failure/);
  assert.equal(rec.projectId, other.id);
  assert.equal(rec.here, other.id);
}));

test("a picture with only data and a type is titled Picture · date, not [object Object]", quiet(async t => {
  const { service, conv, make, topics } = setup();
  t.after(() => service.close());
  const { project, docs } = make("Healthy");
  const rec = conv.recordOf("codex", "cx-1", { cwd:docs });
  await service.conversationTopic(project, rec, "", Date.now(), [{ type:"image/png", data:PIXEL }], []);
  const [line] = topics(project);
  assert.match(line.doc.title, /^Picture · /);
  assert.doesNotMatch(line.slug, /object/);
  // A named picture still names the line.
  const rec2 = conv.recordOf("codex", "cx-2", { cwd:docs });
  await service.conversationTopic(project, rec2, "", Date.now(), [{ type:"image/png", data:PIXEL, name:"login-screen.png" }], []);
  assert.ok(titles(topics(project)).includes("Login screen"));
}));

test("pastedElsewhere passes over a deleted, unreadable or broken project", t => {
  const { service, make, gone } = setup();
  t.after(() => service.close());
  gone("asdf");
  const broken = make("Broken").project;
  const scan = service.store.scan.bind(service.store);
  service.store.scan = p => { if (p.id === broken.id) throw new Error("unreadable folder"); return scan(p); };
  const { project } = make("Healthy");
  assert.equal(service.pastedElsewhere(project, {}, "Some words", "Some words", []), null);
});

test("watchAll keeps watching healthy projects when another project's folder goes missing or breaks", quiet(async t => {
  const { service, make, gone } = setup();
  t.after(() => service.close());
  // Newest first: the broken projects are looked at before the healthy one.
  const healthy = make("Healthy");
  gone("asdf");
  const broken = make("Broken").project;
  const first = await service.createTopic(healthy.project, { text:"First", kinds:["ask"], start:false, unsent:true });
  const second = await service.createTopic(healthy.project, { text:"Second", kinds:["ask"], start:false, unsent:true });
  // Broken after the first scan: landing merged branches asks for a scan that now throws.
  let landed = false;
  service.landMergedBranches = async p => { if (p.id !== broken.id) return false; landed = true; return true; };
  const scan = service.store.scan.bind(service.store);
  service.store.scan = p => { if (landed && p.id === broken.id) throw new Error("folder unreadable"); return scan(p); };
  const picked = [];
  // Throws at once, not as a rejected promise.
  service.pickUp = (p, slug) => { picked.push(slug); if (slug === first.slug) throw new Error("this Topic fails"); return Promise.resolve(); };
  await service.watchAll();
  assert.ok(picked.includes(first.slug) && picked.includes(second.slug), `every Topic of the healthy project is looked at: ${picked}`);
}));

test("startup recovery survives a project whose docs path was replaced by a regular file and still syncs healthy projects", quiet(async t => {
  const { service, make, say, root } = setup();
  const broken = make("Broken"), healthy = make("Healthy");
  // Record a pending deletion on Broken, then replace Broken's docs directory with a regular file (ENOTDIR).
  service.store.deleted[`${broken.project.id}:old-line`] = {
    projectId:broken.project.id, slug:"old-line", phase:"pending", bundle:true,
    original:"lines/old-line.md", trash:".trash/lines/old-line-1",
  };
  service.store.saveDeleted();
  const directory = service.directory, home = service.conversations.home;
  service.close();
  fs.rmSync(broken.docs, { recursive:true, force:true });
  fs.writeFileSync(broken.docs, "not a directory anymore\n");
  // Restart a fresh Service and start its runtime against the same state directory.
  const restarted = new Service({ directory, agents:fakeAgents, autoWatch:false, conversations:{ home, idleMs:45000 } });
  t.after(() => restarted.close());
  restarted.startRuntime({ autoWatch:false, recoverOnStart:false });
  assert.equal(restarted.store.deleted[`${broken.project.id}:old-line`]?.phase, "pending", "failed pending deletion is preserved for retry");
  const liveHealthy = restarted.store.get(healthy.project.id);
  liveHealthy.followSince = 1;
  say(healthy.docs, "after-restart", "Healthy syncs after restart");
  await restarted.conversations.tick();
  assert.deepEqual(titles(restarted.store.scan(liveHealthy).topics), ["Healthy syncs after restart"]);
}));

test("scanCodex paginates across nextCursor so busy projects cannot starve another project on later pages", quiet(async t => {
  const { service, conv, make, topics } = setup();
  t.after(() => service.close());
  const a = make("A"), b = make("B");
  const pages = {
    "": { data:[codexThread("a-1", a.docs, "A page 1")], nextCursor:"p2" },
    p2: { data:[codexThread("a-2", a.docs, "A page 2")], nextCursor:"p3" },
    p3: { data:[codexThread("a-3", a.docs, "A page 3")], nextCursor:"p4" },
    p4: { data:[codexThread("b-4", b.docs, "B on page 4")], nextCursor:null },
  };
  const threads = Object.values(pages).flatMap(p => p.data);
  conv.codexOverride = {
    async call(method, params = {}) {
      if (method === "thread/list") {
        const p = pages[params.cursor || ""];
        return { data:p.data.map(({ turns, ...thread }) => thread), nextCursor:p.nextCursor };
      }
      const thread = threads.find(x => x.id === params.threadId);
      return { thread:{ ...thread, path:"" } };
    },
  };
  // First tick covers pages 1-3 (bounded per tick) and saves continuation cursor "p4".
  await conv.scanCodex([{ project:a.project, roots:[a.docs] }, { project:b.project, roots:[b.docs] }]);
  assert.equal(topics(a.project).length, 3);
  assert.equal(conv.codexCursor, "p4");
  // Second tick resumes at p4 and reaches B's thread, then resets cursor.
  await conv.scanCodex([{ project:a.project, roots:[a.docs] }, { project:b.project, roots:[b.docs] }]);
  assert.deepEqual(titles(topics(b.project)), ["B on page 4"]);
  assert.equal(conv.codexCursor, "");
}));

test("malformed Codex and OpenCode list entries do not suppress valid conversations around them", quiet(async t => {
  const { service, conv, make, topics } = setup();
  t.after(() => service.close());
  const { project, docs } = make("Healthy");
  const goodCx1 = codexThread("cx-good-1", docs, "First good Codex");
  const goodCx2 = codexThread("cx-good-2", docs, "Second good Codex");
  conv.codexOverride = {
    async call(method, params = {}) {
      if (method === "thread/list") {
        return { data:[goodCx1, null, { id:123, cwd:docs }, { id:"bad-cwd", cwd:42 }, goodCx2].map(x => (x && x.turns ? (({ turns, ...rest }) => rest)(x) : x)) };
      }
      const thread = [goodCx1, goodCx2].find(x => x.id === params.threadId);
      return { thread:{ ...thread, path:"" } };
    },
  };
  const ocGood1 = opencodeSession("oc-good-1", docs), ocGood2 = opencodeSession("oc-good-2", docs);
  const ocBase = opencodeClient([ocGood1, ocGood2]);
  conv.opencodeOverride = {
    list:async () => [ocGood1, null, { id:"bad-dir", directory:null }, { id:"", directory:docs }, ocGood2],
    read:(id) => ocBase.read(id),
  };
  const recentOc = await conv.recentOpencode({ project, roots:[docs] }, 0, []);
  assert.deepEqual(recentOc.map(x => x.id), ["oc-good-1", "oc-good-2"]);
  await conv.scanCodex([{ project, roots:[docs] }]);
  await conv.scanOpencode([{ project, roots:[docs] }]);
  assert.deepEqual(titles(topics(project)).sort(), ["Asked in oc-good-1", "Asked in oc-good-2", "First good Codex", "Second good Codex"]);
}));
