"use strict";
require("./helpers/safety.js");
// Jobs that read the disk again and again while nothing changed (PE-988, Work 3). Each is counted here, so it cannot quietly come back,
// and each test also checks that a change still shows at once:
// 1. reads that only read trust the folder's watcher for files it has said nothing about (store.js TRUST_MS);
// 2. an Orchestrator call or a page action no longer throws away every project's folder list (http.js);
// 3. a picture already up to date is not checked again by reading its source and its Canvas (pictureFrom);
// 4. the rule files beside MEMORY.md are read and compared only when one of them changed.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { createFolderWatch } = require("../src/server/project-lines/folder-watch.js");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const { Service } = require("../src/server/project-lines/service.js");
const { Conversations } = require("../src/server/project-lines/conversations.js");
const { listAntigravityConversations } = require("../src/server/project-lines/antigravity-sessions.js");
const Knowledge = require("../src/server/project-lines/knowledge.js");
const Tokens = require("../src/server/project-lines/token-evidence.js");
const F = require("../src/server/project-lines/format.js");
const AgentHelp = require("../src/server/project-lines/agent-help.js");
const Memory = require("../src/server/project-lines/memory.js");
const PrototypeRules = require("../src/server/prototype-rules.js");
const slides = require("../src/server/slides.js");

const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penecho-disk-reads-")));
const closing = [];
after(async () => { for (const close of closing.reverse()) await close(); fs.rmSync(temp, { recursive:true, force:true }); });

// The file calls made while `run` runs, by kind, and the files read by name.
async function counted(run) {
  const names = ["statSync", "lstatSync", "readFileSync", "readdirSync", "existsSync"], counts = { all:0, read:{} }, saved = {};
  for (const name of names) {
    saved[name] = fs[name];
    counts[name] = 0;
    fs[name] = function (...args) {
      counts[name]++; counts.all++;
      if (name === "readFileSync" && typeof args[0] === "string") counts.read[path.basename(args[0])] = (counts.read[path.basename(args[0])] || 0) + 1;
      return saved[name].apply(this, args);
    };
  }
  try { await run(); } finally { Object.assign(fs, saved); }
  return counts;
}
// A watcher that reports only what the test says, the same on every platform.
function fakeWatch() {
  const listeners = [];
  const watch = (folder, options, listener) => { listeners.push({ folder, listener }); return { close() {}, on() {} }; };
  const say = (folder, name) => { for (const l of listeners) if (l.folder === folder) l.listener("change", name); };
  return { watch, say };
}
const write = (project, rel, text) => { const file = path.join(project.docsPath, rel); fs.mkdirSync(path.dirname(file), { recursive:true }); fs.writeFileSync(file, text); };
const lineText = (title, slug) => `---\nid: T-1\nstatus: done\nwho: "@claude"\n---\n\n# ${title}\n\n## Ask · 2026-11-12 09:00\n\nDo it.\n\n## [x] Work 1 · @claude · 2 min\n\n### Done\n\n[Details](../works/${slug}/work-1.md)\n`;
const workText = (slug, result) => `---\nline: ../../lines/${slug}.md\nstep: Work 1\nwho: "@claude"\n---\n\n# Work 1\n\n## Result\n\n${result}\n`;
let made = 0;
function newService({ renderPage = null } = {}) {
  const n = ++made, watcher = fakeWatch();
  const service = new Service({ directory:path.join(temp, `state-${n}`), agents:createAgents({ env:{ PATH:"" } }), autoWatch:false, docsBase:path.join(temp, `docs-${n}`), folderWatch:{ watch:watcher.watch, enabled:true }, ...(renderPage ? { renderPage } : {}) });
  closing.push(() => service.close());
  const project = name => service.store.create({ name, docsPath:path.join(temp, `docs-${n}`, name) });
  return { service, watcher, project };
}

test("the watcher tells a reader whether a file, or a folder it is in, changed since it looked", () => {
  const w = fakeWatch(), watch = createFolderWatch({ watch:w.watch, enabled:true }), folder = path.join(temp, "watch-unit");
  fs.mkdirSync(folder, { recursive:true });
  const file = "works/a/work-1.md";
  assert.equal(watch.mark(folder), null, "a folder nobody watches tells nothing");
  watch.key(folder, () => [], 1000);
  const at = watch.mark(folder);
  assert.ok(watch.still(folder, [file], at));
  w.say(folder, "works/b/work-1.md");
  assert.ok(watch.still(folder, [file], at), "another file changed");
  w.say(folder, "works/a");
  assert.ok(!watch.still(folder, [file], at), "the folder it is in moved: only the folder is reported");
  const later = watch.mark(folder);
  assert.ok(watch.still(folder, [file], later), "looked at again after the move");
  w.say(folder, path.join("works", "a", "work-1.md"));
  assert.ok(!watch.still(folder, [file], later), "the file itself, spelled the platform's way");
  if (process.platform === "darwin" || process.platform === "win32") {
    const now = watch.mark(folder);
    w.say(folder, "Works/A/Work-1.md");
    assert.ok(!watch.still(folder, [file], now), "a name in another case is the same file here");
  }
  const mine = watch.mark(folder);
  watch.touch(folder, ["lines/x.md"]);
  assert.ok(!watch.still(folder, ["lines/x.md"], mine), "PenEcho's own write names the file");
  assert.ok(watch.still(folder, [file], mine), "and nothing else");
  watch.touch(folder);
  assert.ok(!watch.still(folder, [file], mine), "a change anywhere in the folder");
  const last = watch.mark(folder);
  w.say(folder, null);
  assert.ok(!watch.still(folder, [file], last), "a report without a name");
  watch.close();
  assert.equal(watch.mark(folder), null, "a closed watcher tells nothing");
  assert.ok(!watch.still(folder, [file], last));
});

test("a page's state made again reads no Line or Work file the watcher said nothing about, and shows one it named at once", async () => {
  const { service, watcher, project: make } = newService(), project = make("Reads");
  for (let i = 1; i <= 30; i++) { write(project, `lines/line-${i}.md`, lineText(`Line ${i}`, `line-${i}`)); write(project, `works/line-${i}/work-1.md`, workText(`line-${i}`, `Result ${i}`)); }
  service.readCachedState(project);
  const trusted = await counted(() => { service.changedState(); service.readCachedState(project); });
  const watch = service.store.watch;
  service.store.watch = null;
  const looked = await counted(() => { service.changedState(); service.readCachedState(project); });
  service.store.watch = watch;
  service.changedState(); service.readCachedState(project);
  // Without the watcher each of the 30 Line files is looked up again (three or four calls); with it, each is looked at once.
  assert.ok(looked.statSync + looked.lstatSync >= 75, `without the watcher each Line file is looked up again (${looked.statSync + looked.lstatSync})`);
  assert.ok(trusted.statSync + trusted.lstatSync <= 40, `with it each is looked at once (${trusted.statSync + trusted.lstatSync} calls)`);
  assert.equal(trusted.readFileSync, looked.readFileSync, "the same files are read either way");

  // An agent writes its result: the watcher names the file, and the next state has it.
  write(project, "works/line-3/work-1.md", workText("line-3", "Result changed by the agent"));
  watcher.say(project.docsPath, "works/line-3/work-1.md");
  assert.match(JSON.stringify(service.readCachedState(project).state), /Result changed by the agent/);
  // Its folder moved: what was known of every file in it is looked at again.
  fs.renameSync(path.join(project.docsPath, "works", "line-4"), path.join(project.docsPath, "works", "line-4-old"));
  watcher.say(project.docsPath, "works/line-4");
  watcher.say(project.docsPath, "works/line-4-old");
  assert.equal(service.store.exists(project, "works/line-4/work-1.md", { trust:true }), false);
  fs.renameSync(path.join(project.docsPath, "works", "line-4-old"), path.join(project.docsPath, "works", "line-4"));
  watcher.say(project.docsPath, "works/line-4");
  assert.equal(service.store.exists(project, "works/line-4/work-1.md", { trust:true }), true);

  // A change the watcher has not reported yet (it takes a few milliseconds): the file is still looked at, so every read has it at once.
  write(project, "lines/line-5.md", lineText("Line five, edited by hand", "line-5"));
  assert.match(service.store.readText(project, "lines/line-5.md", { trust:true }).text, /Line five, edited by hand/);
  assert.match(JSON.stringify(service.readCachedState(project, { fresh:0 }).state), /Line five, edited by hand/);
  // A link put in a Work file's place is looked up again, and refused when it leads out of the docs folder.
  const outside = path.join(temp, "outside.md");
  fs.writeFileSync(outside, workText("line-8", "Secret from outside"));
  fs.rmSync(path.join(project.docsPath, "works/line-8/work-1.md"));
  fs.symlinkSync(outside, path.join(project.docsPath, "works/line-8/work-1.md"));
  assert.throws(() => service.store.readText(project, "works/line-8/work-1.md", { trust:true }), /leaves the docs folder/);
  // A link loop where a Work's folder was is "not there", as before, and never fails the page's state.
  fs.renameSync(path.join(project.docsPath, "works/line-10"), path.join(temp, "line-10-away"));
  fs.symlinkSync("line-10", path.join(project.docsPath, "works/line-10"));
  assert.equal(service.store.readIfThere(project, "works/line-10/work-1.md", { trust:true }), null);
  assert.equal(service.store.exists(project, "works/line-10/work-1.md", { trust:true }), false);
  // A Work known not to be there, whose Line was archived a moment ago with the Work in it: found in archive/ before the watcher says so.
  assert.equal(service.store.exists(project, "works/line-11/work-2.md", { trust:true }), false);
  fs.mkdirSync(path.join(project.docsPath, "archive", "lines"), { recursive:true });
  fs.mkdirSync(path.join(project.docsPath, "archive", "works"), { recursive:true });
  fs.renameSync(path.join(project.docsPath, "lines/line-11.md"), path.join(project.docsPath, "archive/lines/line-11.md"));
  fs.renameSync(path.join(project.docsPath, "works/line-11"), path.join(project.docsPath, "archive/works/line-11"));
  fs.writeFileSync(path.join(project.docsPath, "archive/works/line-11/work-2.md"), workText("line-11", "Second"));
  assert.equal(service.store.exists(project, "works/line-11/work-2.md", { trust:true }), true);
  // Where a file is, is not taken from what is known for longer than TRUST_MS, whatever the watcher says.
  assert.equal(service.store.exists(project, "works/line-9/work-1.md", { trust:true }), true);
  fs.renameSync(path.join(project.docsPath, "lines/line-9.md"), path.join(project.docsPath, "archive/lines/line-9.md"));
  fs.renameSync(path.join(project.docsPath, "works/line-9"), path.join(project.docsPath, "archive/works/line-9"));
  assert.match(service.store.readText(project, "works/line-9/work-1.md", { trust:true }).text, /Result 9/, "archived while nobody said so: found where it went");
  const now = Date.now;
  try {
    Date.now = () => now() + 31000;
    assert.equal(service.store.inArchive(project, "line-9", { trust:true }), true);
  } finally { Date.now = now; }
  assert.doesNotThrow(() => service.readCachedState(project, { fresh:0 }), "the page's state is made with the loop and the moves in place");
});

test("the 3-second look checks each Line and Work file only when the watcher names it", async () => {
  const { service, watcher, project: make } = newService(), project = make("Look");
  for (let i = 1; i <= 30; i++) { write(project, `lines/line-${i}.md`, lineText(`Line ${i}`, `line-${i}`)); write(project, `works/line-${i}/work-1.md`, workText(`line-${i}`, `Result ${i}`)); }
  await service.watchProject(project); await service.watchProject(project);
  const quiet = await counted(() => service.watchProject(project));
  // Before: place, resolve and stat each time a Line or its Work file was read, about 27 calls for each of the 30 Lines. Now one look at
  // each file for each pass that reads it (the README and status pass, the questions, what to pick up): about 6 for each Line.
  assert.ok(quiet.statSync + quiet.lstatSync <= 240, `a quiet look checks little (${quiet.statSync + quiet.lstatSync} calls)`);
  assert.equal(quiet.readFileSync, 0, "and reads nothing");
  // A question ticked by hand in a Line is still seen: the watcher names the file.
  write(project, "lines/line-7.md", lineText("Line 7 renamed by hand", "line-7"));
  watcher.say(project.docsPath, "lines/line-7.md");
  await service.watchProject(project);
  assert.match(fs.readFileSync(path.join(project.docsPath, "README.md"), "utf8"), /Line 7 renamed by hand/, "the README index follows the Line at the next look");
});

test("an Orchestrator call or another project's action does not make a project's folder be listed again; its own action does", async () => {
  const watcher = fakeWatch(), directory = path.join(temp, "http-state"), docsBase = path.join(temp, "http-docs");
  fs.mkdirSync(directory, { recursive:true });
  const lines = createProjectLines({ directory, agents:createAgents({ env:{ PATH:"" } }), serviceOptions:{ autoWatch:false, docsBase, folderWatch:{ watch:watcher.watch, enabled:true } },
    authorizeRead:() => null, authorizeWrite:() => null, isThisComputer:() => true,
    readJson:req => new Promise((resolve, reject) => { let s = ""; req.on("data", d => { s += d; }).on("end", () => { try { resolve(s ? JSON.parse(s) : {}); } catch (error) { reject(error); } }); }),
    send:(res, code, data) => { res.writeHead(code, { "content-type":"application/json" }); res.end(JSON.stringify(data)); } });
  const server = http.createServer(async (req, res) => { if (!await lines.handle(req, res, new URL(req.url, "http://x"))) { res.writeHead(404); res.end(); } });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  closing.push(() => { server.close(); lines.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api/lines`;
  const call = async (method, route, body) => (await fetch(`${base}${route}`, { method, headers:body !== undefined ? { "content-type":"application/json" } : {}, ...(body !== undefined ? { body:JSON.stringify(body) } : {}) })).status;
  const { service } = lines, walks = new Map(), walk = service.store.walk.bind(service.store);
  service.store.walk = (project, options) => { walks.set(project.id, (walks.get(project.id) || 0) + 1); return walk(project, options); };
  const a = service.store.create({ name:"A", docsPath:path.join(docsBase, "A") }), b = service.store.create({ name:"B", docsPath:path.join(docsBase, "B") });
  for (const p of [a, b]) write(p, "lines/one.md", lineText("One", "one"));
  for (const p of [a, b]) assert.equal(await call("GET", `/projects/${p.id}/state`), 200);
  const looks = () => Promise.all([a, b].map(p => call("GET", `/projects/${p.id}/state`)));
  walks.clear();
  await call("POST", "/orchestrate", { do:"help" });
  await looks();
  assert.deepEqual([walks.get(a.id) || 0, walks.get(b.id) || 0], [0, 0], "an Orchestrator call lists no folder again");
  assert.equal(await call("PATCH", `/projects/${a.id}`, {}), 200);
  await looks();
  assert.ok((walks.get(a.id) || 0) >= 1, "A's own action makes its next look fresh");
  assert.equal(walks.get(b.id) || 0, 0, "B's folder is left to its watcher");
  // A file another project's action wrote straight into B (a Canvas moved there) is in B's next look.
  write(a, "files/canvases/moved.penecho.json", JSON.stringify({ type:"penecho-document", name:"Moved", elements:[] }));
  const moved = await fetch(`${base}/projects/${a.id}/canvases/move`, { method:"POST", headers:{ "content-type":"application/json" }, body:JSON.stringify({ path:"files/canvases/moved.penecho.json", to:b.id }) });
  assert.equal(moved.status, 200, "the Canvas moved");
  const to = (await moved.json()).path, state = await (await fetch(`${base}/projects/${b.id}/state`)).json();
  assert.ok(to && JSON.stringify(state).includes(to), "the moved Canvas shows in B at once");
});

test("a slide deck already on its Canvas is not read again at each look, and a changed slide is drawn", async () => {
  const { service, project: make } = newService({ renderPage:async () => null }), project = make("Deck");
  const slide = words => `<!doctype html><html><head><meta charset="utf-8"><title>${words}</title></head><body>\n<div class="slide" data-penecho-slide data-penecho-template="investor" data-penecho-deck="Deck"><div class="hd"><h1>${words}</h1></div></div></body></html>`;
  for (let i = 1; i <= 3; i++) write(project, `files/deck/deck.slide-0${i}.html`, slide(`Slide ${i}`));
  for (let i = 0; i < 2; i++) await service.makePictures(project);
  const canvas = path.join(project.docsPath, "files/deck/deck.penecho.json"), slidesOn = () => JSON.parse(fs.readFileSync(canvas, "utf8")).assets.filter(a => a.kind === "widget").map(a => Buffer.from(a.dataBase64, "base64").toString("utf8")).join("\n");
  assert.match(slidesOn(), /Slide 3/, "the deck is on its Canvas");
  // A Canvas made before PenEcho kept which text each Widget was drawn from: each slide is compared with what the Canvas holds. That read the
  // whole Canvas once for each slide at every look (a 1 MB deck of ten slides: 13 MB every 3 s).
  const bundle = JSON.parse(fs.readFileSync(canvas, "utf8"));
  delete bundle.manifest.extensions["penecho.lines"];
  fs.writeFileSync(canvas, JSON.stringify(bundle));
  const first = await counted(() => service.makePictures(project));
  // Once for what it says of itself (canvasMeta) and once for its text, for all three slides.
  assert.equal(first.read["deck.penecho.json"], 2, "the Canvas is read once for the deck, not once for each slide");
  const quiet = await counted(() => service.makePictures(project));
  assert.equal(quiet.readFileSync, 0, "nothing is read while the slides and the Canvas stay as they are");
  write(project, "files/deck/deck.slide-02.html", slide("Slide 2, changed"));
  await service.makePictures(project);
  assert.match(slidesOn(), /Slide 2, changed/, "a changed slide is drawn at the next look");
});

test("the rule files beside MEMORY.md are read only when they changed, and one changed by hand is put back", async () => {
  const dir = path.join(temp, "rules", Memory.TOOL_DIR), docs = path.dirname(dir);
  fs.mkdirSync(dir, { recursive:true });
  assert.equal(slides.installSlideRules(dir), true);
  assert.equal(PrototypeRules.installPrototypeRules(dir), true);
  assert.equal(AgentHelp.install(dir), true);
  assert.equal(Memory.installTool(docs), true);
  // The next look reads each copy once to know it holds the text (a copy just written may have been changed meanwhile); then no more.
  for (const install of [() => slides.installSlideRules(dir), () => PrototypeRules.installPrototypeRules(dir), () => AgentHelp.install(dir)]) assert.equal(install(), false);
  const again = await counted(() => {
    assert.equal(slides.installSlideRules(dir), false);
    assert.equal(PrototypeRules.installPrototypeRules(dir), false);
    assert.equal(AgentHelp.install(dir), false);
    assert.equal(Memory.installTool(docs), false);
  });
  assert.equal(again.readFileSync, 0, "up to date: nothing read");
  const help = path.join(dir, AgentHelp.NAME), rules = path.join(dir, slides.RULES_NAME);
  fs.writeFileSync(help, "changed by hand");
  fs.rmSync(rules);
  assert.equal(AgentHelp.install(dir), true);
  assert.equal(slides.installSlideRules(dir), true);
  assert.equal(fs.readFileSync(help, "utf8"), AgentHelp.text());
  assert.ok(fs.readFileSync(rules, "utf8").length > 100);
});

test("Topic files, understanding.md and removed-step records are not re-read on unchanged state rebuilds, and edits show at once", async t => {
  // Topics are hidden in every project for now (PE-1066); this test shows them again.
  const Knowledge = require("../src/server/project-lines/knowledge.js");
  Knowledge.TOPICS.hidden = false;
  t.after(() => { Knowledge.TOPICS.hidden = true; });
  const { service, project: make } = newService(), project = make("Knowledge");
  write(project, "lines/a.md", lineText("Alpha", "a"));
  write(project, "understanding.md", "# Understanding\n\n## Topics\n\n**Core**\n- [Perf](topics/perf.md)\n");
  for (let i = 1; i <= 10; i++) {
    write(project, `topics/topic-${i}.md`, `---\nid: T-${i}\narea: Core\ntitle: Topic ${i}\n---\n\n# Topic ${i}\n\n**Goal ${i}.**\n\nStatus on 2026-11-23: Ready.\n\n## Lines\n\n| Line | What it is | Requirements |\n| --- | --- | --- |\n| [T-1](../lines/a.md) | Alpha | R1 |\n`);
  }
  write(project, ".trash/removed/a--abcdef012345.json", JSON.stringify({ slug:"a", removedAt:new Date().toISOString(), step:{ kind:"note", text:"Removed note" } }));
  service.readCachedState(project);
  const quiet = await counted(() => { service.changedState(); service.readCachedState(project); });
  assert.equal(quiet.readFileSync, 0, `unchanged Topics, understanding.md and removed records are not re-read (${JSON.stringify(quiet.read)})`);
  assert.equal(service.readCachedState(project).state.knowledge.length, 10);
  assert.deepEqual(service.readCachedState(project).state.areas, ["Core"]);
  // Editing a Topic or understanding.md shows on the very next call.
  write(project, "topics/topic-3.md", `---\nid: T-3\narea: Core\ntitle: Topic 3 Revised\n---\n\n# Topic 3 Revised\n\n**Goal 3 revised.**\n\nStatus on 2026-11-23: Updated.\n`);
  write(project, "understanding.md", "# Understanding\n\n## Topics\n\n**Core**\n**Billing**\n");
  assert.equal(Knowledge.topicsOf(project.docsPath).find(t => t.id === "T-3")?.title, "Topic 3 Revised");
  assert.deepEqual(Knowledge.areasOf(project.docsPath), ["Core", "Billing"]);
});

test("Antigravity summary DB and idle historical conversations are not re-queried or re-stat'ed on every 3-second tick", async () => {
  const { DatabaseSync } = require("node:sqlite");
  const { pathToFileURL } = require("node:url");
  const root = path.join(temp, "ag-idle-test"), docs = path.join(root, "docs"), code = path.join(root, "code"), state = path.join(root, "state"), home = path.join(root, "home");
  fs.mkdirSync(docs, { recursive:true }); fs.mkdirSync(code, { recursive:true }); fs.mkdirSync(state, { recursive:true });
  const agDesk = path.join(home, ".gemini", "antigravity"), agCli = path.join(home, ".gemini", "antigravity-cli");
  for (const dir of [agDesk, agCli]) {
    fs.mkdirSync(path.join(dir, "brain"), { recursive:true });
    const db = new DatabaseSync(path.join(dir, "conversation_summaries.db"));
    db.exec("CREATE TABLE conversation_summaries (conversation_id TEXT PRIMARY KEY, title TEXT, step_count INTEGER, last_modified_time TEXT, workspace_uris TEXT, status TEXT, source TEXT, parent_conversation_id TEXT, nesting_depth INTEGER, app_data_dir TEXT)");
    db.close();
  }
  const uri = pathToFileURL(code).href, oldIso = new Date(Date.now() - 20 * 60000).toISOString();
  const dbDesk = new DatabaseSync(path.join(agDesk, "conversation_summaries.db"));
  const ins = dbDesk.prepare("INSERT OR REPLACE INTO conversation_summaries (conversation_id, title, step_count, last_modified_time, workspace_uris, status, source, parent_conversation_id, nesting_depth, app_data_dir) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (let i = 1; i <= 40; i++) {
    const id = `idle-${i}`, file = path.join(agDesk, "brain", id, ".system_generated", "logs", "transcript_full.jsonl");
    fs.mkdirSync(path.dirname(file), { recursive:true });
    fs.writeFileSync(file, JSON.stringify({ step_index:0, source:"USER_EXPLICIT", type:"USER_INPUT", status:"DONE", created_at:oldIso, content:`<USER_REQUEST>\nTask ${i}\n</USER_REQUEST>` }) + "\n"
      + JSON.stringify({ step_index:1, source:"MODEL", type:"PLANNER_RESPONSE", status:"DONE", created_at:oldIso, content:`Done ${i}.` }) + "\n");
    ins.run(id, `Idle ${i}`, 2, oldIso, JSON.stringify([uri]), "CASCADE_RUN_STATUS_IDLE", "CORTEX_TRAJECTORY_SOURCE_IDE", "", 0, "antigravity");
  }
  dbDesk.close();
  const env = { HOME:home, PATH:"" };
  const service = new Service({ directory:state, agents:createAgents({ env }), autoWatch:false, docsBase:root });
  closing.push(() => service.close());
  const project = service.store.create({ name:"AgIdle", docsPath:docs, codePath:code });
  project.createdAt = Date.now() - 30 * 60000; project.followSince = project.createdAt; service.store.save();
  const conv = new Conversations({ directory:state, service, env, home, idleMs:45000 });
  closing.push(() => conv.close());
  // Prime: imports all 40 idle historical conversations and stamps them.
  await conv.tick();
  assert.equal(listAntigravityConversations(env, home).length, 40);
  await conv.tick();
  const quiet = await counted(() => conv.scanAntigravity([{ project, roots:[docs, code] }]));
  // Before: 40*6+ stats in listAntigravityConversations + 40 stats in antigravityStamp (~280+ stats). Now only DB + WAL stats (<= 10).
  assert.ok(quiet.statSync <= 12, `quiet Antigravity scan should only check DB stamps (${quiet.statSync} statSync calls)`);
  // Updating the DB (resuming a conversation) is seen immediately on the next tick.
  const nowIso = new Date().toISOString();
  const tx1 = path.join(agDesk, "brain", "idle-1", ".system_generated", "logs", "transcript_full.jsonl");
  fs.appendFileSync(tx1, JSON.stringify({ step_index:2, source:"USER_EXPLICIT", type:"USER_INPUT", status:"DONE", created_at:nowIso, content:"<USER_REQUEST>\nFollow up now\n</USER_REQUEST>" }) + "\n");
  const db2 = new DatabaseSync(path.join(agDesk, "conversation_summaries.db"));
  db2.prepare("UPDATE conversation_summaries SET last_modified_time = ?, status = ? WHERE conversation_id = ?").run(nowIso, "CASCADE_RUN_STATUS_RUNNING", "idle-1");
  db2.close();
  await conv.scanAntigravity([{ project, roots:[docs, code] }]);
  const slug1 = conv.records["antigravity:idle-1"]?.slug;
  assert.ok(slug1 && /Follow up now/.test(service.readDoc(project, slug1)), "DB update breaks cache and imports follow-up immediately");
});

test("settleStale skips already-settled historical conversations on quiet ticks and still heals a reverted Line", async () => {
  const { service, watcher, project: make } = newService(), project = make("Stale");
  const oldTime = new Date(Date.now() - 20 * 60000);
  for (let i = 1; i <= 30; i++) {
    const slug = `done-${i}`;
    write(project, `lines/${slug}.md`, lineText(`Done ${i}`, slug));
    fs.utimesSync(path.join(project.docsPath, `lines/${slug}.md`), oldTime, oldTime);
    service.conversations.recordOf("claude", `s-${i}`, { projectId:project.id, slug, stepId:"work-1", active:false, lastAt:oldTime.getTime(), lastSay:"Done." });
  }
  service.readCachedState(project);
  // First pass confirms all 30 are settled.
  await service.conversations.settleStale(project, { fromTick:true });
  const quiet = await counted(() => service.conversations.settleStale(project, { fromTick:true }));
  assert.equal(quiet.lstatSync + quiet.statSync + quiet.readFileSync, 0, `settled historical records make zero disk calls on quiet tick (got ${quiet.all})`);
  // Reverting one Line back to working with an undone Work (and notifying watcher) still heals it.
  const reverted = F.initialLine({ title:"Done 5", status:"working", steps:[F.askStep({ words:"Do it." }), F.workStep({ who:"claude" })] });
  write(project, "lines/done-5.md", reverted);
  fs.utimesSync(path.join(project.docsPath, "lines/done-5.md"), oldTime, oldTime);
  watcher.say(project.docsPath, "lines/done-5.md");
  await service.conversations.settleStale(project, { fromTick:true });
  assert.equal(F.parseLine(service.readDoc(project, "done-5")).status, "done", "reverted working Line is still settled");
});

test("Tokens.projectSummary caches per-Work daily aggregation and produces exact totals", () => {
  const mkRow = (id, events) => ({
    workId:id, taskId:`t-${id}`, taskMode:"continuation", createdAt:events[0].at,
    inputTokens:events.reduce((n, e) => n + (e.inputTokens || 0), 0),
    outputTokens:events.reduce((n, e) => n + (e.outputTokens || 0), 0),
    cacheReadInputTokens:events.some(e => e.cacheReadInputTokens != null) ? events.reduce((n, e) => n + (e.cacheReadInputTokens || 0), 0) : null,
    cacheWriteInputTokens:null,
    attempts:1, requests:events.length, coverage:"reported totals", startup:{ status:"continuation" }, events,
  });
  const day1 = Date.parse("2026-11-20T10:00:00Z"), day2 = Date.parse("2026-11-21T10:00:00Z");
  const rows = [
    mkRow("w1", [{ at:day1, inputTokens:100, outputTokens:20, cacheReadInputTokens:50, cacheWriteInputTokens:null }, { at:day2, inputTokens:30, outputTokens:5, cacheReadInputTokens:null, cacheWriteInputTokens:null }]),
    mkRow("w2", [{ at:day1, inputTokens:200, outputTokens:40, cacheReadInputTokens:null, cacheWriteInputTokens:null }]),
  ];
  const first = Tokens.projectSummary(rows);
  assert.deepEqual(first.daily, [
    { day:"2026-11-20", inputTokens:300, outputTokens:60, cacheReadInputTokens:50, cacheWriteInputTokens:null },
    { day:"2026-11-21", inputTokens:30, outputTokens:5, cacheReadInputTokens:null, cacheWriteInputTokens:null },
  ]);
  const origIso = Date.prototype.toISOString;
  let isoCalls = 0;
  Date.prototype.toISOString = function () { isoCalls++; return origIso.call(this); };
  try {
    const second = Tokens.projectSummary(rows);
    assert.deepEqual(second.daily, first.daily);
    assert.equal(isoCalls, 0, "cached Work event arrays do not re-format timestamps");
    const updated = [...rows, mkRow("w3", [{ at:day2, inputTokens:70, outputTokens:10, cacheReadInputTokens:15, cacheWriteInputTokens:5 }])];
    const third = Tokens.projectSummary(updated);
    assert.equal(isoCalls, 1, "only the newly added Work's events format timestamps");
    assert.deepEqual(third.daily[1], { day:"2026-11-21", inputTokens:100, outputTokens:15, cacheReadInputTokens:15, cacheWriteInputTokens:5 });
  } finally { Date.prototype.toISOString = origIso; }
});

test("state rebuild reads activitySeq without loading historical activity logs into RAM, and stays live on updates", () => {
  const { service, project: make } = newService(), project = make("ActSeq");
  write(project, "lines/big.md", lineText("Big activity", "big"));
  write(project, "lines/huge-line.md", lineText("Huge single line", "huge-line"));
  const bigFile = service.activity.fileOf(project, "big"), hugeFile = service.activity.fileOf(project, "huge-line");
  fs.mkdirSync(path.dirname(bigFile), { recursive:true });
  // > 80 KB file with 200 rows: tail reader must find seq=200 without populating activity.logs.
  const rows = [];
  for (let i = 0; i < 200; i++) rows.push(JSON.stringify({ i, at:1700000000000 + i, kind:"tool", verb:"Ran", output:"x".repeat(450), seq:i + 1 }));
  fs.writeFileSync(bigFile, rows.join("\n") + "\n");
  // Single row > 70 KB: tail window must expand and still find seq=7.
  fs.writeFileSync(hugeFile, JSON.stringify({ i:0, at:1700000000000, kind:"note", text:"y".repeat(75000), seq:7 }) + "\n");

  const state = service.readCachedState(project).state;
  assert.equal(state.lines.find(l => l.slug === "big")?.activitySeq, 200);
  assert.equal(state.lines.find(l => l.slug === "huge-line")?.activitySeq, 7);
  assert.equal(service.activity.logs.size, 0, "state build must not load historical activity rows into RAM");
  // Adding a live activity row loads only that Line and bumps activitySeq immediately.
  service.activity.add(project, "big", { kind:"note", text:"Live update" });
  const next = service.readCachedState(project).state;
  assert.equal(next.lines.find(l => l.slug === "big")?.activitySeq, 201);
  assert.equal(service.activity.logs.size, 1);
});

test("store.exists with trust rejects a parent symlink swapped to a different file outside docs, and syncGenerated restores edited README", async () => {
  const { service, project: make } = newService(), project = make("Boundary");
  write(project, "lines/one.md", lineText("One", "one"));
  write(project, "works/one/work-1.md", workText("one", "Inside"));
  service.readCachedState(project);
  assert.equal(service.store.exists(project, "works/one/work-1.md", { trust:true }), true);
  // Swap parent folder works/one for a symlink to an outside folder containing a different work-1.md.
  const outsideDir = path.join(temp, "outside-parent");
  fs.mkdirSync(outsideDir, { recursive:true });
  fs.writeFileSync(path.join(outsideDir, "work-1.md"), workText("one", "Outside secret"));
  fs.renameSync(path.join(project.docsPath, "works/one"), path.join(temp, "one-orig"));
  fs.symlinkSync(outsideDir, path.join(project.docsPath, "works/one"));
  // Advance past realFolder's 1 s cache (FOLDER_MS) while still well inside TRUST_MS (30 s): without sameFile on exists(), trust would still return true.
  const origNow = Date.now;
  try {
    Date.now = () => origNow() + 1500;
    assert.equal(service.store.exists(project, "works/one/work-1.md", { trust:true }), false, "trusted exists catches swapped parent symlink to different outside file");
  } finally { Date.now = origNow; }
  // Restore works/one and verify README hand-edit is repaired at the next syncGenerated.
  fs.unlinkSync(path.join(project.docsPath, "works/one"));
  fs.renameSync(path.join(temp, "one-orig"), path.join(project.docsPath, "works/one"));
  service.store.syncGenerated(project, "main");
  const readmePath = path.join(project.docsPath, "README.md");
  const expected = fs.readFileSync(readmePath, "utf8");
  fs.writeFileSync(readmePath, "tampered by hand\n");
  service.store.syncGenerated(project, "main");
  assert.equal(fs.readFileSync(readmePath, "utf8"), expected, "hand-edited README.md is restored");
});
