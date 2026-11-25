"use strict";
require("./helpers/safety.js");
// S1, server: a project's state is kept and made again only when something it is made from changed; a poll that finds nothing
// changed reads nothing; the list of projects answers from a summary kept per project; ?for=rail, ?for=home and ?for=line give less.
// Nothing may show later than it did when an answer was simply given again for a second: an agent's file, a run moving on,
// and files a sync with Cloud brought all show in the next answer.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const { createFolderWatch } = require("../src/server/project-lines/folder-watch.js");
const { Service } = require("../src/server/project-lines/service.js");
const { fakeCloud, fakeConnector } = require("./fake-cloud-lines.js");

const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penecho-state-cache-")));
const closing = [];
after(async () => { for (const close of closing.reverse()) await close(); fs.rmSync(temp, { recursive:true, force:true }); });
const wait = ms => new Promise(r => setTimeout(r, ms));
// What "the next answer" may take: an answer could be given again for a second before (S1's stop-gap), so a change must show within it.
async function within(ms, check, label) { const start = Date.now(); for (;;) { const v = await check(); if (v) return { value:v, after:Date.now() - start }; if (Date.now() - start > ms) throw new Error(`Not shown within ${ms} ms: ${label}`); await wait(20); } }
const agentScript = path.join(temp, "agent.js");
fs.writeFileSync(agentScript, `
const say = o => console.log(JSON.stringify(o));
let prompt = "";
process.stdin.on("data", d => prompt += d).on("end", () => {
  say({ type:"system", subtype:"init", session_id:"s-" + Date.now() });
  setTimeout(() => say({ type:"assistant", message:{ content:[{ type:"tool_use", id:"t1", name:"Bash", input:{ command:"npm test" } }] } }), 300);
  setTimeout(() => say({ type:"assistant", message:{ content:[{ type:"text", text:"All done." }] } }), 1100);
  setTimeout(() => say({ type:"result", subtype:"success", is_error:false, result:"All done.", session_id:"s" }), 1200);
});
`);
const fakeAgent = name => ({ name, mono:name.slice(0, 2), color:"#000", role:"Build", resolve:() => ({ command:process.execPath, prefixArgs:[agentScript] }), command:(launch, { workdir }) => ({ command:launch.command, args:launch.prefixArgs, cwd:workdir }) });
let count = 0;
async function computer({ cloud = null, folderWatch = {} } = {}) {
  const n = ++count, directory = path.join(temp, `state-${n}`), docsBase = path.join(temp, `computer-${n}`), connector = cloud ? fakeConnector(cloud) : null;
  fs.mkdirSync(directory, { recursive:true });
  const lines = createProjectLines({ ...(cloud ? { cloud:() => connector } : {}), directory, agents:createAgents({ env:{ PATH:"" }, extra:{ fake:fakeAgent("Fake") } }), serviceOptions:{ autoWatch:false, docsBase, folderWatch },
    authorizeRead:() => null, authorizeWrite:() => null, isThisComputer:() => true,
    readJson:req => new Promise((resolve, reject) => { let s = ""; req.on("data", d => { s += d; }).on("end", () => { try { resolve(s ? JSON.parse(s) : {}); } catch (error) { reject(error); } }); }),
    send:(res, code, data) => { res.writeHead(code, { "content-type":"application/json" }); res.end(JSON.stringify(data)); } });
  const server = http.createServer(async (req, res) => { if (!await lines.handle(req, res, new URL(req.url, "http://x"))) { res.writeHead(404); res.end(); } });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  closing.push(() => { server.close(); lines.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api/lines`;
  const call = async (method, route, body) => { const res = await fetch(`${base}${route}`, { method, headers:body !== undefined ? { "content-type":"application/json" } : {}, ...(body !== undefined ? { body:JSON.stringify(body) } : {}) }); const text = await res.text(); return { status:res.status, bytes:text.length, ...(text ? JSON.parse(text) : {}) }; };
  const service = lines.service;
  // How many times a project's state was made, so a test can say nothing was made again.
  const made = { count:0 };
  const makeState = service.makeState.bind(service);
  service.makeState = (...args) => { made.count++; return makeState(...args); };
  const project = name => { const p = service.store.create({ name, docsPath:path.join(docsBase, name) }); p.defaultAgent = "fake"; return p; };
  const write = (p, rel, text) => { fs.mkdirSync(path.dirname(path.join(p.docsPath, rel)), { recursive:true }); fs.writeFileSync(path.join(p.docsPath, rel), text); };
  return { lines, service, share:lines.cloudShare, call, project, write, made, sync:p => lines.cloudShare.syncNow(p) };
}
const line = (title, words, status = "done") => `---\nid: T-1\nstatus: ${status}\n---\n\n# ${title}\n\n## Ask · 2026-11-12 09:00\n\n${words}\n`;
const allLines = state => [...state.lines, ...state.landed, ...state.backlog];
test("compact rail summaries add only non-empty Orchestrator refs in each list", () => {
  const project = { id:"p", docsPath:temp, codePaths:[] };
  const ordinary = { id:"plain", stations:[{ kind:"note", state:"done", text:"Do not send this" }], questions:[], privateField:true };
  const rows = [
    { ...ordinary, orchestratorRef:"", orchestratedBy:"" },
    { ...ordinary, id:"parent", orchestratorRef:"PE-1" },
    { ...ordinary, id:"child", orchestratedBy:"PE-1" },
    { ...ordinary, id:"nested", orchestratorRef:"PE-2", orchestratedBy:"PE-1" },
  ];
  const summary = Service.prototype.summaryFrom(project, { lines:rows, landed:rows, backlog:rows, pictures:[], notes:[], files:[] });
  for (const list of [summary.lines, summary.landed, summary.backlog]) {
    const [plain, parent, child, nested] = list;
    assert.deepEqual(Object.keys(plain).sort(), [
      "id", "code", "title", "landed", "status", "stations", "questions", "createdAt", "at", "shown", "canReviewLine", "asking", "unsent", "running", "pinned", "readRevision",
    ].sort());
    assert.deepEqual(plain.stations, [{ kind:"note", state:"done" }]);
    assert.deepEqual(parent, { ...plain, id:"parent", orchestratorRef:"PE-1" });
    assert.deepEqual(child, { ...plain, id:"child", orchestratedBy:"PE-1" });
    assert.deepEqual(nested, { ...plain, id:"nested", orchestratorRef:"PE-2", orchestratedBy:"PE-1" });
  }
});
const lastParagraphOf = text => { const t = String(text ?? "").trim(), last = t.split(/\n\s*\n/).pop() || ""; return last.length > 480 ? `…${last.slice(-480)}` : last === t ? t : `…\n\n${last}`; };

for (const watching of [true, false]) {
  test(`an agent wrote a file: the next answer has it, and a poll that finds nothing changed makes nothing (${watching ? "with" : "without"} the folder's watcher)`, async () => {
    const a = await computer({ folderWatch:watching ? {} : { enabled:false } }), p = a.project("Garden");
    a.write(p, "lines/plant.md", line("Plant tomatoes", "Where do they go?"));
    // A watcher tells of a write a moment after it; a report that comes after a look makes the state again, rightly.
    await wait(300);
    const first = await a.call("GET", `/projects/${p.id}/state`);
    assert.equal(first.status, 200, first.error);
    assert.deepEqual(allLines(first).map(l => l.title), ["Plant tomatoes"]);
    const madeBefore = a.made.count;
    for (let i = 0; i < 5; i++) assert.deepEqual(await a.call("GET", `/projects/${p.id}/state?rev=${first.rev}`), { status:200, bytes:first.rev.length + 22, same:true, rev:first.rev });
    assert.equal(a.made.count, madeBefore, "nothing changed, so nothing was made again");
    // An agent, outside PenEcho, adds to the line and writes a picture.
    await wait(5);
    a.write(p, "lines/plant.md", line("Plant tomatoes", "Where do they go?\n\nBy the south wall."));
    a.write(p, "files/plant/bed.svg", "<svg/>");
    const shown = await within(1200, async () => { const s = await a.call("GET", `/projects/${p.id}/state?rev=${first.rev}`); return !s.same && s; }, "the agent's words");
    assert.match(allLines(shown.value)[0].stations[0].text, /south wall/);
    assert.ok(shown.value.files.some(f => f.path === "files/plant/bed.svg"));
    if (watching && a.service.folderWatch.watching(p.docsPath)) assert.ok(shown.after < 600, `the watcher showed it at once (${shown.after} ms)`);
  });
}

test("a run moved on: what the agent does now, and its end, each show in the next answer", async () => {
  const a = await computer(), p = a.project("Kitchen");
  const asked = await a.call("POST", `/projects/${p.id}/topics`, { text:"Fix the tap please", agent:"fake" });
  assert.equal(asked.status, 200, asked.error);
  const slug = asked.slug || asked.topic?.slug || allLines(await a.call("GET", `/projects/${p.id}/state`))[0].slug;
  const lineOf = async () => allLines(await a.call("GET", `/projects/${p.id}/state`)).find(l => l.slug === slug);
  await within(3000, async () => (await lineOf())?.running, "the run");
  // The agent runs a command: the line's active step says so, while nothing in the folder changed.
  await within(3000, async () => /running tests/i.test((await lineOf()).stations.find(s => s.state === "active")?.now || ""), "what it does now");
  const done = await within(5000, async () => { const l = await lineOf(); return !l.running && l.status !== "working" && l; }, "the end of the run");
  assert.match(done.value.result.text, /All done/);
});

test("a sync with Cloud changed files: the next answer has them, on the computer that pulled them", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer({ cloud }), b = await computer({ cloud }), p = a.project("Shed");
  a.write(p, "lines/paint.md", line("Paint the shed", "Which green?"));
  assert.equal((await a.call("POST", `/projects/${p.id}/cloud`, { sync:true })).status, 200);
  const copied = await b.call("POST", `/cloud/projects/${encodeURIComponent(p.id)}/copy`, {});
  assert.equal(copied.status, 200, copied.error);
  const there = b.service.store.projects.find(x => x.id === copied.project.id);
  const before = await b.call("GET", `/projects/${there.id}/state`);
  assert.deepEqual(allLines(before).map(l => l.title), ["Paint the shed"]);
  // The other computer adds a line and sends it; this one pulls it.
  a.write(p, "lines/door.md", line("Fix the door", "It sticks."));
  await a.sync(p);
  await b.sync(there);
  const after = await b.call("GET", `/projects/${there.id}/state?rev=${before.rev}`);
  assert.ok(!after.same, "the sync's files are in the very next answer");
  assert.deepEqual(allLines(after).map(l => l.title).sort(), ["Fix the door", "Paint the shed"]);
});

test("the list of projects answers from each project's summary, made again only when that project changed", async () => {
  const a = await computer(), one = a.project("One"), two = a.project("Two");
  a.write(one, "lines/a.md", line("First", "Words."));
  a.write(two, "lines/b.md", line("Second", "Words."));
  await wait(300);
  const list = await a.call("GET", "/projects");
  assert.deepEqual(list.projects.filter(x => [one.id, two.id].includes(x.id)).map(x => [x.name, x.lines.length]).sort(), [["One", 1], ["Two", 1]]);
  const made = a.made.count;
  await a.call("GET", "/projects");
  assert.equal(a.made.count, made, "a second look makes nothing again");
  // A project nobody opened keeps only its summary.
  assert.equal(a.service.states.get(two.id).state, null);
  // A rename shows at once; it changes the project, not its folder.
  assert.equal((await a.call("PATCH", `/projects/${one.id}`, { name:"Uno" })).status, 200);
  assert.equal((await a.call("GET", "/projects")).projects.find(x => x.id === one.id).name, "Uno");
  // A new line in one project: the list has it within the list's own four seconds, and only that project is made again.
  // The watcher tells of the rename's own write a moment after it; let that pass, so what is counted below is the new line alone.
  await wait(300);
  await a.call("GET", "/projects");
  a.write(two, "lines/c.md", line("Third", "Words."));
  a.service.folderWatch.touch(two.docsPath);
  const before = a.made.count, again = await a.call("GET", "/projects");
  assert.equal(again.projects.find(x => x.id === two.id).lines.length, 2);
  assert.equal(a.made.count - before, 1);
});

test("?for=rail and ?for=home: the same state with less in it, the same rev, and ?rev= still answers same", async () => {
  const a = await computer(), p = a.project("Notes");
  const long = `${"word ".repeat(200)}end of the first paragraph.\n\nLast paragraph: shall I go on?`;
  a.write(p, "lines/long.md", line("A long line", long));
  a.write(p, "lines/old.md", line("An archived line", "Old words.", "closed"));
  a.write(p, "files/picture.svg", "<svg/>");
  const full = await a.call("GET", `/projects/${p.id}/state`), rail = await a.call("GET", `/projects/${p.id}/state?for=rail`), home = await a.call("GET", `/projects/${p.id}/state?for=home`);
  for (const view of [rail, home]) assert.equal(view.rev, full.rev);
  assert.equal(rail.view, "rail"); assert.equal(home.view, "home");
  // The rail: the project, and for each line its name, where it stands and the marks of its steps. Nothing else.
  for (const key of ["files", "notes", "pictures", "branches", "deleted", "conflicts"]) assert.equal(rail[key], undefined, key);
  assert.deepEqual(rail.project, full.project);
  const railLine = rail.lines[0];
  assert.deepEqual(Object.keys(railLine.stations[0]).sort(), ["agent", "asked", "finishedAsk", "id", "index", "kind", "reviewed", "state", "unsent"]);
  assert.equal(railLine.ask, undefined); assert.equal(railLine.result, undefined);
  assert.deepEqual(rail.landed.map(l => [l.title, l.archived, l.stations.length]), [["An archived line", true, 0]]);
  // Home: no files list, each step's first words, a result's last paragraph, archived lines as the rail has them.
  assert.equal(home.files, undefined);
  assert.ok(home.pictures.length >= 0 && Array.isArray(home.notes));
  const step = home.lines[0].stations.find(s => s.kind === "ask");
  assert.ok(step.text.length <= 241 && step.clipped, `clipped: ${step.text.length}`);
  assert.ok(full.lines[0].stations.find(s => s.kind === "ask").text.length > 900);
  assert.deepEqual(home.landed, rail.landed);
  assert.ok(home.bytes < full.bytes && rail.bytes < home.bytes);
  assert.deepEqual(await a.call("GET", `/projects/${p.id}/state?for=rail&rev=${full.rev}`), { status:200, bytes:full.rev.length + 22, same:true, rev:full.rev });
  assert.equal((await a.call("GET", `/projects/${p.id}/state?for=nothing`)).status, 400);
});

test("?for=line: that line whole, the others as the rail has them, and only the files that changed (PE-559)", async () => {
  const a = await computer(), p = a.project("Busy");
  const long = `${"word ".repeat(200)}end of the first paragraph.\n\nLast paragraph: shall I go on?`;
  a.write(p, "lines/open.md", line("The open line", long));
  a.write(p, "lines/other.md", line("Another line", long));
  a.write(p, "lines/old.md", line("An archived line", "Old words.", "closed"));
  a.write(p, "files/open/picture.svg", "<svg/>");
  a.write(p, "files/other/notes.md", "# Notes\n");
  const full = await a.call("GET", `/projects/${p.id}/state`), view = await a.call("GET", `/projects/${p.id}/state?for=line&line=open`);
  assert.equal(view.view, "line"); assert.equal(view.openLine, "open"); assert.equal(view.rev, full.rev);
  const open = view.lines.find(l => l.id === "open"), other = view.lines.find(l => l.id === "other");
  assert.deepEqual(open, full.lines.find(l => l.id === "open"));
  assert.equal(other.ask, undefined);
  assert.equal(other.stations.find(s => s.kind === "ask").text, undefined);
  assert.equal(other.result.text, lastParagraphOf(full.lines.find(l => l.id === "other").result.text));
  assert.deepEqual(view.landed.map(l => [l.title, l.stations.length]), [["An archived line", 0]]);
  assert.deepEqual(view.files, full.files);
  assert.ok(view.filesKey);
  assert.ok(view.bytes < full.bytes);
  // An archived line opened is sent whole too.
  const old = await a.call("GET", `/projects/${p.id}/state?for=line&line=old`);
  assert.deepEqual(old.landed[0], full.landed[0]);
  // The page names the list it has: only what changed since its newest file comes, until which files there are changes.
  const since = Math.max(...view.files.map(f => f.mtime));
  await wait(20);
  a.write(p, "files/open/picture.svg", "<svg><g/></svg>");
  const changed = await within(3000, async () => { const r = await a.call("GET", `/projects/${p.id}/state?for=line&line=open&files=${view.filesKey}&since=${since}`); return r.filesSince?.some(f => f.path === "files/open/picture.svg" && f.size > 6) && r; }, "the changed picture");
  assert.equal(changed.value.files, undefined);
  assert.equal(changed.value.filesKey, view.filesKey);
  assert.ok(changed.value.filesSince.every(f => f.mtime >= since));
  a.write(p, "files/open/new.md", "# New\n");
  const added = await within(3000, async () => { const r = await a.call("GET", `/projects/${p.id}/state?for=line&line=open&files=${view.filesKey}&since=${since}`); return r.files?.some(f => f.path === "files/open/new.md") && r; }, "the new file");
  assert.notEqual(added.value.filesKey, view.filesKey);
  assert.equal(added.value.filesSince, undefined);
  // Nothing changed still answers same, files or not.
  assert.deepEqual(await a.call("GET", `/projects/${p.id}/state?for=line&line=open&rev=${added.value.rev}&files=${added.value.filesKey}&since=1`), { status:200, bytes:added.value.rev.length + 22, same:true, rev:added.value.rev });
});

test("the folder's watcher: a change shows at once; a watcher that fails leaves the folder's list, taken again after its age", async () => {
  const folder = fs.mkdtempSync(path.join(temp, "watch-")), files = [{ path:"a.md", mtime:1, size:1 }];
  let fire = null, failWith = null, clock = 5000;
  const fake = (dir, options, listener) => { fire = listener; return { close() {}, on(event, fn) { if (event === "error") failWith = fn; } }; };
  const watch = createFolderWatch({ watch:fake, enabled:true, now:() => clock });
  const k1 = watch.key(folder, () => files, 1000).key;
  assert.equal(watch.key(folder, () => { throw new Error("not walked within its age"); }, 1000).key, k1);
  fire("change", "a.md");
  assert.notEqual(watch.key(folder, () => files, 1000).key, k1, "a reported change is a new key at once");
  failWith(new Error("gone"));
  assert.equal(watch.watching(folder), false);
  const k2 = watch.key(folder, () => files, 1000).key;
  files[0].mtime = 2;
  assert.equal(watch.key(folder, () => files, 1000).key, k2, "within its age the list is not taken again");
  clock += 1000;
  assert.notEqual(watch.key(folder, () => files, 1000).key, k2, "after it, the list shows the change");
  watch.close();
});

test("changes inside folders the list leaves out (.penecho import locks, .git, temporary files) give no new key", async () => {
  const { leftOut } = require("../src/server/project-lines/store.js");
  const folder = fs.mkdtempSync(path.join(temp, "ignored-")), files = [{ path:"lines/a.md", mtime:1, size:1 }];
  let fire = null, walks = 0;
  const fake = (dir, options, listener) => { fire = listener; return { close() {}, on() {} }; };
  const watch = createFolderWatch({ watch:fake, enabled:true, ignore:leftOut }), walk = () => { walks++; return files; };
  const k1 = watch.key(folder, walk, 1000).key;
  for (const name of [".penecho/imports/sessions/a.json.lock", ".penecho", ".git/index", ".trash/removed/x", "lines/a.md.1.ab.tmp", path.join("files", "x.app", "Contents", "Info.plist")]) fire("rename", name);
  assert.equal(watch.key(folder, walk, 1000).key, k1, "nothing the list holds changed");
  assert.equal(walks, 1);
  fire("change", "lines/a.md");
  assert.notEqual(watch.key(folder, walk, 1000).key, k1, "a listed file still shows at once");
  fire("change", ".history/lines/a.md");
  assert.equal(leftOut(".history/lines/a.md"), false, ".history is listed");
  watch.close();
});

test("Kimi's own list of folders is read once for all of a store's folders, and a missing one throws nothing", () => {
  const { kimiFolders } = require("../src/server/project-lines/kimi-sessions.js");
  const home = fs.mkdtempSync(path.join(temp, "kimi-")), names = Array.from({ length:200 }, (_, i) => `wd_other_${String(i).padStart(12, "0")}`);
  const stat = fs.statSync;
  let stats = 0;
  fs.statSync = function (file, ...rest) { if (String(file).startsWith(home)) stats++; return stat.call(this, file, ...rest); };
  try { assert.deepEqual(kimiFolders(home, [path.join(temp, "nowhere")], names), []); } finally { fs.statSync = stat; }
  assert.ok(stats <= 2, `looked ${stats} times`);
});

test("the 3 s watch asks Git for the trunk only when the repository's branches or checkout moved", async () => {
  const { execFileSync } = require("node:child_process");
  const { Service } = require("../src/server/project-lines/service.js");
  const root = fs.mkdtempSync(path.join(temp, "trunk-")), code = path.join(root, "code"), docs = path.join(root, "docs"), state = path.join(root, "state");
  for (const dir of [code, docs, state]) fs.mkdirSync(dir, { recursive:true });
  const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd:code, stdio:"ignore" });
  git("init", "-q", "-b", "main"); fs.writeFileSync(path.join(code, "a.txt"), "a"); git("add", "."); git("commit", "-qm", "a");
  const service = new Service({ directory:state, agents:createAgents({ env:{ PATH:process.env.PATH } }), autoWatch:false });
  closing.push(() => service.close?.());
  const project = service.store.create({ name:"Trunk", docsPath:docs, codePath:code });
  const refresh = service.refreshTrunk.bind(service);
  let asked = 0;
  service.refreshTrunk = p => { asked++; return refresh(p); };
  assert.equal(await service.watchTrunk(project), "main");
  assert.equal(await service.watchTrunk(project), "main");
  assert.equal(asked, 1, "nothing moved: Git is not asked again");
  git("branch", "penecho/new-line");
  await service.watchTrunk(project);
  assert.equal(asked, 2, "a new branch, even one folder down, is seen at once");
  assert.ok(project.trunkCache.heads.has("penecho/new-line"));
  git("checkout", "-q", "penecho/new-line");
  await service.watchTrunk(project);
  assert.equal(asked, 3, "a checkout is seen at once");
  assert.equal(service.hereOf(project), "penecho/new-line");
});

test("while the folder's watcher works, the list is taken every 30 s, not at each look, and at once after a reported change", async () => {
  const folder = fs.mkdtempSync(path.join(temp, "watched-")), files = [{ path:"a.md", mtime:1, size:1 }];
  let fire = null, walks = 0, clock = 5000;
  const fake = (dir, options, listener) => { fire = listener; return { close() {}, on() {} }; };
  const watch = createFolderWatch({ watch:fake, enabled:true, now:() => clock }), walk = () => { walks++; return files; };
  const k1 = watch.key(folder, walk, 1000);
  assert.equal(walks, 1);
  assert.equal(k1.files, files, "the list just taken goes to the caller");
  for (let s = 0; s < 14; s++) { clock += 2000; assert.equal(watch.key(folder, walk, 1000).key, k1.key); }
  assert.equal(walks, 1, "a page asking every 2 s for 28 s takes no list");
  fire("change", "a.md");
  files[0].mtime = 2;
  const k2 = watch.key(folder, walk, 1000);
  assert.equal(walks, 2, "a reported change takes the list at once");
  assert.equal(k2.files, files);
  assert.notEqual(k2.key, k1.key);
  assert.equal(watch.key(folder, walk, 1000).files, null, "and only once");
  // A change the watcher missed shows when the list is 30 s old.
  files[0].mtime = 3;
  clock += 29000;
  assert.equal(watch.key(folder, walk, 1000).key, k2.key);
  clock += 1000;
  assert.notEqual(watch.key(folder, walk, 1000).key, k2.key);
  assert.equal(walks, 3);
  watch.close();
});

test("PE-692: an idle project is walked at most once for each watcher look, and PenEcho's own write to a known file walks nothing", async () => {
  // A watcher that never fires: what PenEcho wrote itself must be enough, and an idle folder is not walked again.
  const t = await computer({ folderWatch:{ enabled:true, watch:() => ({ close() {}, on() {} }) } });
  const p = t.project("Idle");
  t.write(p, "lines/one.md", line("One", "Hello"));
  for (let i = 0; i < 40; i++) t.write(p, `files/one/note-${i}.md`, `# Note ${i}\n`);
  let walks = 0;
  const walk = t.service.store.walk.bind(t.service.store);
  t.service.store.walk = (...args) => { walks++; return walk(...args); };
  // The first looks make README.md, MEMORY.md and the rest: a new file is a walk.
  await t.service.watchAll(); await t.service.watchAll();
  const settled = walks;
  for (let i = 0; i < 5; i++) await t.service.watchAll();
  assert.equal(walks, settled, "five idle looks walk nothing");
  // An agent's token record, written again and again, then a page looking each time.
  t.service.store.writeText(p, "works/one/work-1.tokens.json", "{}");
  t.service.stateOf(p);
  const after = walks;
  for (let i = 0; i < 5; i++) { t.service.store.writeText(p, "works/one/work-1.tokens.json", JSON.stringify({ n:i })); t.service.stateOf(p); }
  assert.equal(walks, after, "writes to a file already listed walk nothing");
  const files = t.service.folderList(p);
  assert.ok(files.find(f => f.path === "works/one/work-1.tokens.json"), "and the list still has it");
});
