"use strict";
require("./helpers/safety.js");
// PE-595: a page that keeps the whole state is sent only what changed (?base=). Whatever changed, the state the page rebuilds from what it
// kept and what it was sent must be the whole state the server would have sent, part for part; and a poll while an agent writes stays small.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { test, after } = require("node:test");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const { createFolderWatch } = require("../src/server/project-lines/folder-watch.js");

const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penecho-state-changes-")));
const closing = [];
after(async () => { for (const close of closing.reverse()) await close(); fs.rmSync(temp, { recursive:true, force:true }); });
const wait = ms => new Promise(r => setTimeout(r, ms));

// The page's own code for what it keeps (public/lines/state.js), run as the page runs it.
const source = fs.readFileSync(require.resolve("../public/lines/state.js"), "utf8");
function page() {
  const requests = [], adopted = [], c = vm.createContext({
    S:{ cur:"p", route:{ view:"line", line:"a" }, data:{} }, HOSTED:false, EMBED:null,
    pathFor:id => `/projects/${id}`, api:url => new Promise((resolve, reject) => requests.push({ url, resolve, reject })),
    adoptState:state => { adopted.push(state); c.S.data[state.project.id] = { ...state, id:state.project.id, partial:state.view || "" }; },
  });
  vm.runInContext(source.slice(source.indexOf("const stateView ="), source.indexOf("async function loadProjects()")), c);
  return { c, requests, adopted, run:code => vm.runInContext(code, c) };
}

async function computer() {
  const directory = path.join(temp, `state-${closing.length}`), docsBase = path.join(temp, `docs-${closing.length}`);
  fs.mkdirSync(directory, { recursive:true });
  const lines = createProjectLines({ directory, agents:createAgents({ env:{ PATH:"" } }), serviceOptions:{ autoWatch:false, docsBase },
    authorizeRead:() => null, authorizeWrite:() => null, isThisComputer:() => true,
    readJson:req => new Promise((resolve, reject) => { let s = ""; req.on("data", d => { s += d; }).on("end", () => { try { resolve(s ? JSON.parse(s) : {}); } catch (error) { reject(error); } }); }),
    send:(res, code, data) => { res.writeHead(code, { "content-type":"application/json" }); res.end(JSON.stringify(data)); } });
  const server = http.createServer(async (req, res) => { if (!await lines.handle(req, res, new URL(req.url, "http://x"))) { res.writeHead(404); res.end(); } });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  closing.push(() => { server.close(); lines.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api/lines`;
  const get = async route => { const text = await (await fetch(`${base}${route}`)).text(); return { bytes:text.length, body:JSON.parse(text) }; };
  const p = lines.service.store.create({ name:"Garden", docsPath:path.join(docsBase, "Garden") });
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(p.docsPath, rel)), { recursive:true }); fs.writeFileSync(path.join(p.docsPath, rel), text); };
  return { lines, p, get, write, state:q => get(`/projects/${p.id}/state${q ? `?${q}` : ""}`) };
}
const line = (title, words, extra = "") => `---\nid: G-1\nstatus: done\n${extra}---\n\n# ${title}\n\n## Ask · 2026-11-12 09:00\n\n${words}\n`;
const withoutTag = ({ tag, ...rest }) => rest;
// Objects made in the page's context have its own prototypes: compared as plain data.
const plain = value => JSON.parse(JSON.stringify(value));

test("whatever changed, the kept state with what was sent is the whole state", async () => {
  const a = await computer(), pg = page();
  a.write("lines/a.md", line("Plant tomatoes", "Where do they go?"));
  a.write("lines/b.md", line("Water the beds", "How often?"));
  a.write("files/a/bed.svg", "<svg/>");
  await wait(300);
  const first = await a.state("base=");
  assert.ok(first.body.tag, "a whole state sent for ?base= carries its tag");
  pg.c.keepSent("p", first.body);
  const changes = [
    ["an agent adds to a line", () => a.write("lines/a.md", line("Plant tomatoes", "Where do they go?\n\nBy the south wall."))],
    ["a new line", () => a.write("lines/c.md", line("Prune the roses", "When?"))],
    ["a file added", () => a.write("files/b/plan.md", "# Plan\n")],
    ["a file changed", () => a.write("files/a/bed.svg", "<svg width='2'/>")],
    ["a line archived", () => { fs.mkdirSync(path.join(a.p.docsPath, "archive/lines"), { recursive:true }); fs.renameSync(path.join(a.p.docsPath, "lines/b.md"), path.join(a.p.docsPath, "archive/lines/b.md")); }],
    ["a file removed", () => fs.rmSync(path.join(a.p.docsPath, "files/b/plan.md"))],
    ["a line removed", () => fs.rmSync(path.join(a.p.docsPath, "lines/c.md"))],
  ];
  let tag = first.body.tag;
  for (const [what, change] of changes) {
    await wait(20);
    change();
    a.lines.service.folderWatch.touch(a.p.docsPath);
    const sent = await a.state(`base=${encodeURIComponent(tag)}`);
    assert.ok(sent.body.delta, `${what}: only what changed is sent`);
    const kept = pg.c.sentWith("p", sent.body);
    assert.ok(kept, `${what}: it applies to the kept state`);
    pg.c.setSent("p", kept);
    const whole = await a.state("");
    assert.deepEqual(plain(pg.c.sentState(kept)), whole.body, `${what}: the rebuilt state is the whole state`);
    assert.ok(sent.bytes < whole.bytes, `${what}: smaller than the whole state (${sent.bytes} < ${whole.bytes})`);
    tag = sent.body.tag;
  }
  // Nothing changed: the short answer.
  const same = await a.state(`base=${encodeURIComponent(tag)}`);
  assert.equal(same.body.same, true);
  // A late report from the folder's watcher may have made the state again, unchanged: then it names the page's tag as its base.
  if (same.body.tag !== tag) assert.equal(same.body.base, tag);
});

test("a tag the server no longer keeps is sent the whole state", async () => {
  const a = await computer();
  a.write("lines/a.md", line("Plant tomatoes", "Where?"));
  await wait(300);
  const sent = await a.state("base=nothing.kept.1");
  assert.ok(!sent.body.delta && sent.body.tag, "the whole state, with its tag");
  assert.deepEqual(withoutTag(sent.body), (await a.state("")).body);
});

test("a poll while an agent writes a Work sends a few bytes, not the whole state", async () => {
  const a = await computer();
  for (let i = 0; i < 30; i++) a.write(`lines/l${i}.md`, line(`Line ${i}`, "Words ".repeat(400)));
  a.write("works/l1/work-1.md", "# Work 1\n");
  await wait(300);
  const first = await a.state("base=");
  await wait(20);
  fs.appendFileSync(path.join(a.p.docsPath, "works/l1/work-1.md"), "More output.\n");
  a.lines.service.folderWatch.touch(a.p.docsPath);
  const sent = await a.state(`base=${encodeURIComponent(first.body.tag)}`);
  assert.ok(sent.body.delta);
  assert.ok(sent.bytes < first.bytes / 20, `${sent.bytes} bytes against ${first.bytes} for the whole state`);
});

test("the page keeps the whole state, takes only changes, and asks for the whole again when a change does not fit", async () => {
  const pg = page(), whole = { format:2, rev:"r1", tag:"r1.x.1", project:{ id:"p" }, tokens:{ works:1, records:[{ workId:"w1", inputTokens:5 }] },
    lines:[{ id:"a", text:"First" }, { id:"b", text:"Second" }], landed:[], backlog:[], files:[{ path:"files/x.md", mtime:1 }] };
  // An older server has no light state: the page takes the whole one, and only its changes, from then on.
  pg.c.S.noViews = true;
  let loading = pg.c.loadState("p");
  assert.equal(pg.requests[0].url, "/projects/p/state?base=");
  pg.requests[0].resolve(structuredClone(whole)); assert.equal(await loading, true);
  // Only line b and one record changed, and a file was added.
  const unchanged = pg.c.S.data.p.lines[0];
  loading = pg.c.loadState("p");
  assert.equal(pg.requests[1].url, "/projects/p/state?rev=r1&base=r1.x.1");
  pg.requests[1].resolve({ format:2, delta:true, base:"r1.x.1", rev:"r2", tag:"r2.x.2", set:{ tokens:{ works:2 } },
    lists:{ lines:{ put:[{ id:"b", text:"Second, longer" }] }, files:{ keys:["files/x.md", "files/y.md"], put:[{ path:"files/y.md", mtime:2 }] }, "tokens.records":{ put:[{ workId:"w1", inputTokens:9 }] } } });
  assert.equal(await loading, true);
  const now = pg.adopted.at(-1);
  assert.deepEqual(plain(now.lines), [{ id:"a", text:"First" }, { id:"b", text:"Second, longer" }]);
  assert.deepEqual(plain(now.files.map(f => f.path)), ["files/x.md", "files/y.md"]);
  assert.deepEqual(plain(now.tokens), { works:2, records:[{ workId:"w1", inputTokens:9 }] });
  assert.equal(now.rev, "r2");
  assert.equal(now.lines[0], unchanged, "a line that did not change is not read again");
  // The page's own changes to what it adopted never reach what it keeps.
  now.lines[0].text = "Changed on the page";
  // Asked to read again after a change while nothing changed on the server: the kept state, fresh.
  loading = pg.c.loadState("p", { force:true });
  pg.requests[2].resolve({ same:true, rev:"r2", tag:"r2.x.2" }); assert.equal(await loading, true);
  assert.equal(pg.adopted.at(-1).lines[0].text, "First");
  // A change made for another state is not applied: the whole state is asked for instead.
  loading = pg.c.loadState("p");
  pg.requests[3].resolve({ format:2, delta:true, base:"r9.x.9", rev:"r3", tag:"r3.x.3", set:{}, lists:{} });
  await wait(0);
  assert.equal(pg.requests[4].url, "/projects/p/state?rev=r2&base=");
  pg.requests[4].resolve({ ...structuredClone(whole), rev:"r3", tag:"r3.x.4" }); assert.equal(await loading, true);
  assert.equal(pg.adopted.at(-1).rev, "r3");
  // A plain poll that finds nothing changed adopts nothing.
  loading = pg.c.loadState("p");
  pg.requests[5].resolve({ same:true, rev:"r3", tag:"r3.x.4" }); assert.equal(await loading, false);
  // Made again on the server with nothing changed: the page keeps its state under the new tag.
  loading = pg.c.loadState("p");
  pg.requests[6].resolve({ same:true, rev:"r3", tag:"r3.x.5", base:"r3.x.4" }); assert.equal(await loading, false);
  pg.c.loadState("p");
  assert.equal(pg.requests[7].url, "/projects/p/state?rev=r3&base=r3.x.5");
});

test("token starts go as a list: one new Work's start is a few bytes, and the page rebuilds the whole token counts", async () => {
  const a = await computer(), pg = page(), service = a.lines.service;
  const start = i => ({ workId:`p/l${i}/work-1`, at:1000 + i, status:"compared", difference:i, taskEstimate:2000, baseline:100, cost:{ fresh:{ tokensIn:i * 1000 } } });
  const record = i => ({ workId:`p/l${i}/work-1`, inputTokens:i });
  const make = (rev, starts, records, works) => ({ format:2, rev, project:{ id:"p" }, tokens:{ works, daily:[{ day:"2026-11-17", tokens:works }], starts, records }, lines:[], landed:[], backlog:[], files:[] });
  const many = Array.from({ length:200 }, (_, i) => start(i)), first = make("r1", many, many.map((_, i) => record(i)), 200);
  const whole = service.stateSince(a.p, first, "");
  pg.c.keepSent("p", structuredClone(whole));
  const steps = [
    ["a Work starts", make("r2", [...many, start(200)], [...many.map((_, i) => record(i)), record(200)], 201)],
    ["a start is compared again", make("r3", [...many.slice(0, 199), { ...start(199), difference:5 }, start(200)], [...many.map((_, i) => record(i)), record(200)], 201)],
    ["starts are gone", { ...make("r4", null, [record(1)], 1), tokens:{ works:1, records:[record(1)] } }],
    ["starts are back", make("r5", [start(3)], [record(1)], 1)],
  ];
  let was = whole;
  for (const [what, now] of steps) {
    const sent = service.stateSince(a.p, now, was.tag);
    assert.ok(sent.delta, `${what}: only what changed is sent`);
    if (what === "a Work starts") assert.ok(JSON.stringify(sent).length < 2000, `${what}: ${JSON.stringify(sent).length} bytes`);
    const kept = pg.c.sentWith("p", sent);
    assert.ok(kept, `${what}: it applies to the kept state`);
    pg.c.setSent("p", kept);
    assert.deepEqual(plain(pg.c.sentState(kept)), plain(now), `${what}: the rebuilt state is the whole state`);
    was = sent;
  }
});

test("the folder's list is brought up to date from the watcher's names, and walked when a file is added", () => {
  const listeners = [], watch = (folder, options, listener) => { listeners.push(listener); return { close() {} }; };
  const fw = createFolderWatch({ watch, enabled:true });
  let walks = 0, files = [{ path:"lines/a.md", mtime:1, size:1 }];
  const walk = () => { walks++; return files; }, refresh = (list, names) => (names.has("new.md") ? null : list.map(f => (names.has(f.path) ? { ...f, mtime:f.mtime + 1 } : f)));
  const first = fw.key("/f", walk, 1000, refresh);
  assert.equal(walks, 1);
  listeners[0]("change", "lines/a.md");
  const second = fw.key("/f", walk, 1000, refresh);
  assert.equal(walks, 1, "a change to a listed file needs no walk");
  assert.notEqual(second.key, first.key);
  assert.equal(second.files[0].mtime, 2);
  listeners[0]("rename", "new.md");
  files = [...files, { path:"new.md", mtime:1, size:1 }];
  fw.key("/f", walk, 1000, refresh);
  assert.equal(walks, 2, "a file added is found by walking");
  listeners[0]("change", null);
  fw.key("/f", walk, 1000, refresh);
  assert.equal(walks, 3, "a change the watcher could not name is found by walking");
  fw.close();
});

// PE-927: half of making a big project's state was classifying its files (shelfOf), done again at every look while an agent worked.
// The shelf is now kept while nothing it is made from changed. Whatever changes, it must be what making it afresh gives.
test("the kept shelf of files is always what making the state afresh gives, and an agent writing plain words makes none of it again", async () => {
  const a = await computer(), service = a.lines.service, p = a.p;
  const work = (n, body) => `---\nline: ../../lines/a.md\nstep: Work ${n}\nwho: "@codex"\n---\n\n# Work ${n}\n\n## Result\n\n${body}\n`;
  const withWork = extra => `---\nid: G-1\nstatus: done\n---\n\n# Plant tomatoes\n\n## Ask · 2026-11-12 09:00\n\nWhere do they go?\n\n## [x] Work 1 · @codex\n\nDone.\n\n[Details](../works/a/work-1.md)\n${extra || ""}`;
  a.write("lines/a.md", withWork());
  a.write("lines/b.md", line("Water the beds", "How often? See files/b/notes.md"));
  a.write("works/a/work-1.md", work(1, "Planted by the south wall."));
  a.write("files/a/bed.svg", "<svg/>");
  a.write("files/a/plan.md", "# Plan\n");
  a.write("files/b/notes.md", "# Notes\n");
  a.write("files/loose/readme.md", "# Loose\n");
  await wait(300);
  const shown = () => { const s = service.stateOf(p); return plain({ files:s.files, artifacts:s.artifacts, latestFiles:s.latestFiles }); };
  const afresh = () => { const s = service.makeState(p, null, { fresh:true }).state; return plain({ files:s.files, artifacts:s.artifacts, latestFiles:s.latestFiles }); };
  const look = () => { service.folderWatch.touch(p.docsPath); return service.stateOf(p); };
  assert.deepEqual(shown(), afresh());

  // Only what is in memory changed (an agent's "now"): the same list of files, not one made again.
  const before = look().files;
  service.stateVersion++;
  assert.equal(service.stateOf(p).files, before, "nothing of the files is made again");

  // An agent writes more of its answer, with no new link: every other file keeps its item, and the shelf is not made again.
  const made = service.shelfMemo.get(p.id).shelf;
  await wait(20);
  a.write("works/a/work-1.md", work(1, "Planted by the south wall.\n\nWatered them in."));
  service.folderWatch.touch(p.docsPath, ["works/a/work-1.md"]);
  const after = service.stateOf(p).files, was = new Map(before.map(f => [f.path, f]));
  assert.equal(service.shelfMemo.get(p.id).shelf, made, "plain words in a Work make no new shelf");
  assert.ok(after.filter(f => f.path !== "works/a/work-1.md").every(f => was.get(f.path) === f), "files that did not change keep their items");
  assert.notEqual(after.find(f => f.path === "works/a/work-1.md"), was.get("works/a/work-1.md"), "the file that changed has a new item");
  assert.deepEqual(shown(), afresh());

  const changes = [
    ["a Work's result links a file", () => a.write("works/a/work-1.md", work(1, "Planted. See [the plan](../../files/a/plan.md) and [loose](../../files/loose/readme.md)."))],
    ["a Work's result names a Claude Artifact", () => a.write("works/a/work-1.md", work(1, "Planted. [Garden map](https://claude.ai/artifact/0f4b7c1a-1111-4222-8333-444455556666) and [the plan](../../files/a/plan.md)."))],
    ["a Work's result names another Claude Artifact, and the same files", () => a.write("works/a/work-1.md", work(1, "Planted. [Garden map](https://claude.ai/artifact/9a9a9a9a-2222-4333-8444-555566667777) and [the plan](../../files/a/plan.md)."))],
    ["a line's words name another file", () => a.write("lines/b.md", line("Water the beds", "How often? See files/loose/readme.md"))],
    ["a file is added", () => a.write("files/a/second.svg", "<svg/>")],
    ["a file is removed", () => fs.rmSync(path.join(p.docsPath, "files/b/notes.md"))],
    ["a line is archived", () => { fs.mkdirSync(path.join(p.docsPath, "archive/lines"), { recursive:true }); fs.renameSync(path.join(p.docsPath, "lines/b.md"), path.join(p.docsPath, "archive/lines/b.md")); }],
    ["a line gets a second Work", () => { a.write("works/a/work-2.md", work(2, "Staked them: [bed](../../files/a/bed.svg).")); a.write("lines/a.md", withWork("\n## Ask · 2026-11-13 09:00\n\nStake them.\n\n## [x] Work 2 · @claude\n\nStaked.\n\n[Details](../works/a/work-2.md)\n")); }],
  ];
  for (const [what, change] of changes) {
    await wait(20);
    change();
    look();
    assert.deepEqual(shown(), afresh(), what);
  }
});
