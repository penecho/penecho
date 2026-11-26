"use strict";
require("./helpers/safety.js");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const { Service } = require("../src/server/project-lines/service.js");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const { branchTree } = require("../src/server/project-lines/branches.js");
const { canvasSlides } = require("../src/server/project-lines/canvas-file.js");
const { addExample, seedExamples, fill, stamp, VERSION } = require("../src/server/project-lines/examples.js");

// The example projects for someone with no project of their own: a code project, class notes, and a deck made from a spreadsheet.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-lines-examples-"));
after(() => fs.rmSync(temp, { recursive:true, force:true }));
const noAgents = { available:() => [], list:() => [], get:() => null };
let counter = 0;
const fresh = () => path.join(temp, `state-${++counter}`);
const service = directory => new Service({ directory, agents:noAgents, autoWatch:false });
const gitIn = (cwd, ...args) => execFileSync("git", args, { cwd, encoding:"utf8", stdio:["ignore", "pipe", "pipe"] }).trim();
const isAncestor = (cwd, a, b) => { try { gitIn(cwd, "merge-base", "--is-ancestor", a, b); return true; } catch { return false; } };
const walk = dir => fs.readdirSync(dir, { withFileTypes:true }).flatMap(e => e.isDirectory() ? (e.name === ".git" ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]);
const read = (p, rel) => fs.readFileSync(path.join(p.docsPath, rel), "utf8");
const listing = directory => { fs.mkdirSync(directory, { recursive:true }); return directory; };
async function lines(s, project) {
  await s.refreshTrunk(project);
  const state = s.stateOf(project);
  return { state, all:[...state.lines, ...state.landed, ...state.backlog] };
}
const widgetsOf = file => JSON.parse(fs.readFileSync(file, "utf8")).assets.filter(a => a.kind === "widget").map(a => JSON.parse(Buffer.from(a.dataBase64, "base64").toString("utf8")));

test("someone with no project of their own gets the three examples, code project first", () => {
  const s = service(fresh());
  const made = seedExamples(s.store);
  assert.deepEqual(made.map(p => p.name).sort(), ["Calculus class notes (Demo)", "Sales review deck (Demo)", "Timeline app (Demo)"]);
  const byOpened = [...s.store.projects].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  assert.deepEqual(byOpened.map(p => p.example), ["app", "class", "deck"]);
  for (const p of s.store.projects) {
    assert.equal(p.offerSkill, false, "an example does not ask to add the drawing skill");
    assert.equal(p.seq, { app:4, class:3, deck:2 }[p.example], "the next line gets a number of its own");
    assert.ok(p.docsPath.startsWith(path.join(s.directory, "examples")), "examples live in PenEcho's own folder");
    for (const file of walk(p.docsPath).filter(f => f.endsWith(".md"))) assert.doesNotMatch(fs.readFileSync(file, "utf8"), /\{\{/, `${file} has every value filled in`);
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(s.directory, "projects.json"), "utf8")).examples, VERSION, "the version given is kept");
  s.close();
});

test("the code example is a real repository: a branch for the bug fix, one for the homepage, and dark mode on a branch of the homepage's", async () => {
  const s = service(fresh());
  seedExamples(s.store);
  const p = s.store.projects.find(x => x.example === "app"), code = p.codePaths[0];
  const { state, all } = await lines(s, p);
  assert.equal(state.project.trunk, "main");
  assert.deepEqual(all.map(l => [l.title, l.status, l.branch]).sort(), [["Dark mode", "ready", "dark-mode"], ["Homepage from my drawing", "ready", "homepage"], ["Time labels overlap", "ready", "fix-time-labels"]]);
  assert.equal(gitIn(code, "branch", "--show-current"), "main");
  assert.deepEqual(gitIn(code, "branch", "--format=%(refname:short)").split("\n").sort(), ["dark-mode", "fix-time-labels", "homepage", "main"]);
  assert.ok(!isAncestor(code, "fix-time-labels", "main"), "the bug fix waits on its branch to be merged");
  assert.ok(isAncestor(code, "homepage", "dark-mode") && !isAncestor(code, "dark-mode", "homepage"), "dark mode is built on the homepage branch");
  assert.ok(fs.existsSync(path.join(code, "timeline.js")) && !fs.existsSync(path.join(code, "labels.js")) && !fs.existsSync(path.join(code, "home.js")), "main has the bug and neither change");
  assert.match(gitIn(code, "show", "fix-time-labels:labels.js"), /placeLabels/);
  assert.match(gitIn(code, "show", "homepage:home.js"), /trunk/);
  assert.throws(() => gitIn(code, "show", "homepage:timeline.js"), "the homepage replaces timeline.js");
  assert.match(gitIn(code, "show", "dark-mode:theme.js"), /prefers-color-scheme/);
  // Each Work names the commits it went between, so its changes can be shown.
  const main = gitIn(code, "rev-parse", "main");
  assert.match(read(p, "works/time-labels-overlap/work-1.md"), new RegExp(`^from: ${main}\\nto: ${gitIn(code, "rev-parse", "fix-time-labels")}$`, "m"));
  assert.match(read(p, "works/homepage-from-my-drawing/work-2.md"), new RegExp(`^from: ${main}\\nto: ${gitIn(code, "rev-parse", "homepage")}$`, "m"));
  assert.match(read(p, "works/dark-mode/work-3.md"), new RegExp(`^from: ${gitIn(code, "rev-parse", "homepage")}\\nto: ${gitIn(code, "rev-parse", "dark-mode")}$`, "m"));
  // The map hangs dark mode from the homepage, and the other two from main.
  const started = Object.fromEntries(all.map(l => [l.branch, l.started]));
  const tree = await branchTree(code, "main", ["fix-time-labels", "homepage", "dark-mode"].map(branch => ({ branch, started:started[branch] })));
  assert.equal(tree["dark-mode"].parent, "homepage");
  assert.equal(tree.homepage.parent, null);
  assert.equal(tree["fix-time-labels"].parent, null);
  assert.equal(tree["fix-time-labels"].merged, false);
  // A drawing, a prototype from it on a Canvas, a marked-up screenshot in an Ask, and Claude and Codex both on one line.
  const homepage = all.find(l => l.branch === "homepage"), dark = all.find(l => l.branch === "dark-mode"), bug = all.find(l => l.branch === "fix-time-labels");
  assert.deepEqual(homepage.stations.map(st => st.kind), ["canvas", "ask", "work", "ask", "work"]);
  assert.deepEqual(dark.stations.filter(st => st.kind === "work").map(st => st.agent), ["claude", "codex", "codex"]);
  assert.deepEqual(bug.stations.map(st => st.kind), ["ask", "work"]);
  assert.match(read(p, "lines/time-labels-overlap.md"), /## Ask[^\n]*\n\n[^\n]+\n\n!\[time-labels\.png\]\(\.\.\/files\/time-labels-overlap\/time-labels\.png\)/);
  for (const [slug, name] of [
    ["homepage-from-my-drawing", "sketch"],
    ["homepage-from-my-drawing", "prototype"],
    ["homepage-from-my-drawing", "homepage"],
    ["dark-mode", "dark-mode"],
    ["time-labels-overlap", "time-labels-fixed"],
  ]) {
    assert.ok(state.pictures.some(pic => pic.source === `files/${slug}/${name}.penecho.json` && pic.hasPicture), `${slug}/${name} opens on the Canvas`);
    if (name !== "sketch") {
      assert.equal(widgetsOf(path.join(p.docsPath, `files/${slug}/${name}.penecho.json`)).length, 1, `${slug}/${name} is a Widget you can click`);
      assert.ok(state.files.some(f => f.kind === "page" && f.path === `files/${slug}/${name}.explorer.html`), `${slug}/${name} has its HTML page linked`);
    }
  }
  s.close();
});

test("existing untouched example projects adopt the (Demo) names without overwriting user renames", () => {
  const directory = listing(fresh()), s = service(directory);
  const appDocs = listing(path.join(directory, "examples", "Timeline app"));
  const classDocs = listing(path.join(directory, "examples", "Calculus class notes"));
  const app = s.store.create({ name:"Timeline app", docsPath:appDocs }); app.example = "app";
  const cls = s.store.create({ name:"My Calc Copy", docsPath:classDocs }); cls.example = "class";
  s.store.examples = VERSION; s.store.save();
  assert.deepEqual(seedExamples(s.store), []);
  assert.equal(s.store.projects.find(p => p.example === "app").name, "Timeline app (Demo)");
  assert.equal(s.store.projects.find(p => p.example === "class").name, "My Calc Copy");
  s.close();
});

test("the class notes: handwriting with Canvas AI's answers on the Canvas, notes by dsh, and a practice exam", async () => {
  const s = service(fresh());
  seedExamples(s.store);
  const p = s.store.projects.find(x => x.example === "class");
  const { state, all } = await lines(s, p);
  assert.equal(state.project.code, false);
  assert.deepEqual(all.map(l => [l.title, l.status]).sort(), [["Class 1 · Limits", "done"], ["Class 2 · Derivatives", "done"]]);
  assert.deepEqual(all.find(l => l.title.startsWith("Class 1")).stations.map(st => st.kind), ["canvas", "ask", "work"]);
  assert.deepEqual(all.find(l => l.title.startsWith("Class 2")).stations.map(st => st.kind), ["canvas", "ask", "work", "ask", "work"]);
  assert.ok(all.every(l => l.stations.filter(st => st.kind === "work").every(st => st.agent === "dsh")));
  for (const [file, answers] of [["files/class-1-limits/class-1.penecho.json", 2], ["files/class-2-derivatives/class-2.penecho.json", 1]]) {
    const bundle = JSON.parse(read(p, file));
    assert.ok(bundle.assets.filter(a => a.kind === "tile").length >= 6, `${file} holds the handwriting`);
    assert.equal(widgetsOf(path.join(p.docsPath, file)).length, answers, `${file} holds Canvas AI's answers beside it`);
    assert.ok(state.pictures.some(pic => pic.source === file && pic.hasPicture));
  }
  assert.ok(state.pictures.some(pic => pic.source === "files/class-2-derivatives/practice-exam.penecho.json" && pic.hasPicture), "the exam is on a Canvas");
  for (const note of ["files/class-1-limits/limits-notes.md", "files/class-2-derivatives/derivatives-notes.md"]) assert.match(read(p, note), /\$\$/, `${note} keeps the formulas`);
  s.close();
});

test("the deck: an Ask with a spreadsheet, six slides on one Canvas, then a change asked for and made", async () => {
  const s = service(fresh());
  seedExamples(s.store);
  const p = s.store.projects.find(x => x.example === "deck");
  const { state, all } = await lines(s, p);
  assert.deepEqual(all.map(l => [l.title, l.status]), [["Q3 sales review deck", "done"]]);
  assert.deepEqual(all[0].stations.map(st => st.kind), ["ask", "work", "ask", "work"]);
  const topic = read(p, "lines/q3-sales-review-deck.md");
  assert.match(topic, /\]\(\.\.\/files\/q3-sales-review-deck\/sales-2026\.xlsx\)/, "the spreadsheet is attached to the first Ask");
  assert.ok(fs.statSync(path.join(p.docsPath, "files/q3-sales-review-deck/sales-2026.xlsx")).size > 3000, "and it is a real spreadsheet");
  const slides = canvasSlides(read(p, "files/q3-sales-review-deck/sales-review.penecho.json"));
  assert.equal(slides.length, 6, "the Canvas has the six slides, so Download PPT gives all six");
  assert.match(slides[2].html, /West grew fastest/);
  assert.ok(state.pictures.some(pic => pic.source === "files/q3-sales-review-deck/sales-review.penecho.json" && pic.hasPicture));
  s.close();
});

test("PenEcho's first look at an example draws nothing again and rewrites nothing", async () => {
  const s = service(fresh());
  seedExamples(s.store);
  for (const p of s.store.projects) {
    const files = walk(p.docsPath), before = new Map(files.map(f => [f, [fs.statSync(f).mtimeMs, fs.readFileSync(f, "utf8").length]]));
    s.sync(p);
    assert.deepEqual(await s.makePictures(p), [], `${p.name} has no picture problems`);
    for (const f of files) assert.deepEqual([fs.statSync(f).mtimeMs, fs.readFileSync(f, "utf8").length], before.get(f), `${path.relative(p.docsPath, f)} is as it was made`);
  }
  s.close();
});

test("times are working days back, in working hours, and no two steps share a minute", () => {
  assert.equal(stamp(new Date(2026, 10, 7, 8, 0), -2, "09:12"), "2026-11-05 09:12", "from a Saturday, two working days back is Thursday");
  assert.equal(stamp(new Date(2026, 10, 9, 8, 0), -1, "10:00"), "2026-11-06 10:00", "from a Monday, one back is Friday");
  assert.equal(stamp(new Date(2026, 0, 1), -1, "16:59"), "2025-12-31 16:59");
  const s = service(fresh());
  seedExamples(s.store);
  for (const p of s.store.projects) {
    const topics = fs.readdirSync(path.join(p.docsPath, "lines")).filter(n => n.endsWith(".md"));
    const times = topics.flatMap(n => [...read(p, `lines/${n}`).matchAll(/^## .*?(\d{4}-\d\d-\d\d \d\d:\d\d)/gm)].map(m => m[1]));
    assert.ok(times.length >= 2, `${p.name} has steps with times`);
    assert.equal(new Set(times).size, times.length, `${p.name}: no two steps share a minute`);
    for (const t of times) {
      const at = new Date(t.replace(" ", "T"));
      assert.ok(at.getDay() % 6, `${t} is on a working day`);
      assert.ok(at.getHours() >= 9 && at.getHours() < 18, `${t} is in working hours`);
      assert.ok(at.getTime() < Date.now(), `${t} is in the past`);
    }
    const file = path.join(p.docsPath, "lines", fs.readdirSync(path.join(p.docsPath, "lines")).find(n => n.endsWith(".md")));
    assert.ok(fs.statSync(file).mtimeMs < Date.now() - 3600000, "a line's file is dated when its last step happened");
  }
  s.close();
});

test("a line with a value that cannot be filled is left out whole", () => {
  const text = fill("id: {{id 1}}\nbranch: {{branch fix}}\ncommit: {{short main}}\ncode: {{code}}\n", { now:new Date(), prefix:"WE", code:"/c", commits:null });
  assert.equal(text, "id: WE-1\ncode: /c\n");
});

test("someone with a project of their own gets no examples, then or after", () => {
  const directory = listing(fresh()), mine = listing(path.join(temp, `mine-${counter}`));
  const s = service(directory);
  s.store.create({ name:"Mine", docsPath:mine });
  assert.deepEqual(seedExamples(s.store), []);
  assert.equal(s.store.projects.length, 1);
  s.close();
  const again = service(directory);
  assert.equal(again.store.examples, VERSION, "it is not asked again on the next start");
  again.close();
});

test("only My Canvases counts as no project: the examples are added, and earlier examples leave the list with their folders kept", () => {
  const directory = listing(fresh()), old = listing(path.join(directory, "examples", "Weather app"));
  fs.writeFileSync(path.join(directory, "projects.json"), JSON.stringify({ version:1, projects:[] }));
  const s = service(directory);
  s.store.myCanvases();
  const weather = s.store.create({ name:"Weather app", docsPath:old }); weather.example = "code"; s.store.save();
  const made = seedExamples(s.store);
  assert.equal(made.length, 3);
  assert.deepEqual(s.store.projects.filter(p => !p.myCanvases).map(p => p.example).sort(), ["app", "class", "deck"]);
  assert.ok(fs.existsSync(old), "the earlier example's folder stays");
  // One you remove does not come back.
  s.store.forget(s.store.projects.find(p => p.example === "deck").id);
  assert.deepEqual(seedExamples(s.store), []);
  assert.ok(!s.store.projects.some(p => p.example === "deck"));
  s.close();
});

test("someone with projects of their own loses earlier examples from the list too, even after this version was given", () => {
  const directory = listing(fresh()), mine = listing(path.join(temp, `mine-${counter}`)), old = listing(path.join(directory, "examples", "Notebook"));
  const s = service(directory);
  s.store.create({ name:"Mine", docsPath:mine });
  const notebook = s.store.create({ name:"Notebook", docsPath:old }); notebook.example = "notebook";
  s.store.examples = VERSION; s.store.save();
  assert.deepEqual(seedExamples(s.store), []);
  assert.deepEqual(s.store.projects.map(p => p.name), ["Mine"]);
  assert.ok(fs.existsSync(old), "the earlier example's folder stays");
  s.close();
  const again = service(directory);
  assert.deepEqual(again.store.projects.map(p => p.name), ["Mine"], "the list was saved without it");
  again.close();
});

test("an example can be added later, and one removed comes back from its folder as you left it", () => {
  const directory = listing(fresh()), s = service(directory);
  const first = addExample(s.store, "class");
  assert.equal(addExample(s.store, "class").id, first.id, "asking again opens the same one");
  const topic = path.join(first.docsPath, "lines/class-1-limits.md");
  fs.appendFileSync(topic, "\n## Note · 2026-11-07 10:00\n\nMine.\n");
  s.store.forget(first.id);
  const again = addExample(s.store, "class");
  assert.notEqual(again.id, first.id);
  assert.equal(again.docsPath, first.docsPath);
  assert.match(fs.readFileSync(topic, "utf8"), /Mine\./, "nothing you wrote is overwritten");
  s.store.update(again.id, { archived:true });
  assert.equal(addExample(s.store, "class").archived, false, "an archived example is restored");
  assert.throws(() => addExample(s.store, "cooking"), /no example/);
  s.close();
});

test("a code example brought back finds its commits again", () => {
  const directory = listing(fresh()), s = service(directory);
  const first = addExample(s.store, "app"), fixed = read(first, "works/time-labels-overlap/work-1.md").match(/^to: (\w+)$/m)[1];
  fs.rmSync(first.docsPath, { recursive:true });
  s.store.forget(first.id);
  const again = addExample(s.store, "app");
  assert.match(read(again, "works/time-labels-overlap/work-1.md"), new RegExp(`^to: ${fixed}$`, "m"));
  assert.match(read(again, "works/homepage-from-my-drawing/work-2.md"), /^from: [0-9a-f]{40}$/m);
  s.close();
});

test("without Git the code example still has its app and three lines, on no branch", async () => {
  const s = service(fresh()), saved = process.env.PATH;
  process.env.PATH = path.join(temp, "no-git-here");
  let p;
  try { p = addExample(s.store, "app"); } finally { process.env.PATH = saved; }
  const { all } = await lines(s, p);
  assert.ok(fs.existsSync(path.join(p.codePaths[0], "index.html")));
  assert.ok(!fs.existsSync(path.join(p.codePaths[0], ".git")));
  assert.equal(all.length, 3);
  assert.ok(all.every(l => !l.branch));
  s.close();
});

test("the page can ask for an example, and a new server only seeds when told to", async () => {
  const send = (res, status, body) => { res.writeHead(status, { "content-type":"application/json" }); res.end(JSON.stringify(body)); };
  const readJson = req => new Promise(resolve => { let b = ""; req.on("data", d => b += d).on("end", () => resolve(b ? JSON.parse(b) : {})); });
  const options = { authorizeRead:() => null, authorizeWrite:() => null, readJson, send, agents:noAgents, serviceOptions:{ autoWatch:false } };
  const quiet = createProjectLines({ directory:fresh(), ...options });
  assert.equal(quiet.service.store.projects.length, 0, "tests and existing callers start empty");
  const lines = createProjectLines({ directory:fresh(), ...options, examples:true });
  assert.equal(lines.service.store.projects.length, 3);
  const server = http.createServer((req, res) => lines.handle(req, res, new URL(req.url, "http://x")));
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const call = async (method, url, body) => { const r = await fetch(`http://127.0.0.1:${server.address().port}${url}`, { method, headers:{ "content-type":"application/json" }, body:body && JSON.stringify(body) }); return { status:r.status, body:await r.json() }; };
  const list = await call("GET", "/api/lines/projects");
  assert.deepEqual(list.body.projects.map(p => p.example).sort(), ["app", "class", "deck"]);
  const notes = list.body.projects.find(p => p.example === "class");
  await call("DELETE", `/api/lines/projects/${notes.id}`);
  const back = await call("POST", "/api/lines/examples", { kind:"class" });
  assert.equal(back.status, 200);
  assert.equal(back.body.project.example, "class");
  assert.equal(back.body.project.lines.length, 2);
  assert.equal((await call("POST", "/api/lines/examples", { kind:"nope" })).status, 404);
  server.close(); quiet.close(); lines.close();
});

test("deleting an example takes its folders; deleting your own project leaves yours", async () => {
  const send = (res, status, body) => { res.writeHead(status, { "content-type":"application/json" }); res.end(JSON.stringify(body)); };
  const readJson = req => new Promise(resolve => { let b = ""; req.on("data", d => b += d).on("end", () => resolve(b ? JSON.parse(b) : {})); });
  const lines = createProjectLines({ directory:fresh(), authorizeRead:() => null, authorizeWrite:() => null, readJson, send, agents:noAgents, serviceOptions:{ autoWatch:false }, examples:true });
  const server = http.createServer((req, res) => lines.handle(req, res, new URL(req.url, "http://x")));
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const call = async (method, url, body) => { const r = await fetch(`http://127.0.0.1:${server.address().port}${url}`, { method, headers:{ "content-type":"application/json" }, body:body && JSON.stringify(body) }); return { status:r.status, body:await r.json() }; };
  const code = lines.service.store.projects.find(p => p.example === "app"), folders = [code.docsPath, ...code.codePaths];
  assert.ok(folders.length === 2 && folders.every(f => fs.existsSync(f)));
  await call("PATCH", `/api/lines/projects/${code.id}`, { archived:true });
  assert.equal((await call("DELETE", `/api/lines/projects/${code.id}`)).status, 200);
  assert.ok(!lines.service.store.projects.some(p => p.id === code.id), "it leaves the list");
  assert.ok(folders.every(f => !fs.existsSync(f)), "the folders PenEcho made are gone");
  assert.ok(fs.existsSync(path.join(lines.service.store.directory, "examples")), "the other examples stay");
  const mine = path.join(temp, `mine-${counter}`); fs.mkdirSync(mine);
  const made = await call("POST", "/api/lines/projects", { name:"Mine", docsPath:mine });
  await call("DELETE", `/api/lines/projects/${made.body.project.id}`);
  assert.ok(fs.existsSync(mine), "your own folder is never deleted");
  server.close(); lines.close();
});
