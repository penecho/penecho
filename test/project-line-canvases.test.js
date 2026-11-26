"use strict";
require("./helpers/safety.js");
// Canvases in projects: a folder for each Canvas, My Canvases, agent drawings that survive a page's save, and moving, renaming and deleting.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const F = require("../src/server/project-lines/format.js");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const { newBundle, sourceWidgetId } = require("../src/server/project-lines/canvas-file.js");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-line-canvases-"));
const servers = [];
after(() => { for (const { server, lines } of servers) { server.close(); lines.close(); } fs.rmSync(temp, { recursive:true, force:true }); });
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(check, label = "condition", ms = 15000) {
  const start = Date.now();
  for (;;) { const value = await check(); if (value) return value; if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}`); await wait(25); }
}
// A stand-in agent. From the outside it behaves like Claude Code, and it draws by writing one small file, as the real ones are told to.
const agentScript = path.join(temp, "agent.js");
fs.writeFileSync(agentScript, `
const fs = require("fs");
const say = o => console.log(JSON.stringify(o));
let prompt = "";
process.stdin.on("data", d => prompt += d).on("end", () => {
  const docs = process.env.PENECHO_DOCS_FOLDER, slug = prompt.match(/lines\\/(.+?)\\.md/)[1], dir = docs + "/files/" + slug;
  say({ type:"system", subtype:"init", session_id:"session-" + slug });
  fs.mkdirSync(dir, { recursive:true });
  fs.writeFileSync(dir + "/map.diagram.json", JSON.stringify({ type:"architecture", title:"The map", nodes:[{ id:"a", label:"App", type:"frontend" }, { id:"b", label:"Store", type:"backend" }], edges:[{ from:"a", to:"b" }] }));
  say({ type:"assistant", message:{ content:[{ type:"text", text:"Drew the map." }] } });
  say({ type:"result", subtype:"success", is_error:false, result:"Drew the map.", session_id:"session-" + slug });
});
`);
const agents = () => createAgents({ env:{ PATH:"" }, extra:{ fake:{ name:"Fake", mono:"Fk", color:"#000", role:"Build", resolve:() => ({ command:process.execPath, prefixArgs:[agentScript] }), command:(launch, { workdir }) => ({ command:launch.command, args:launch.prefixArgs, cwd:workdir, stdin:true }) } } });
let counter = 0;
// The real routes over real HTTP, on folders of their own.
async function setup() {
  const directory = path.join(temp, `state-${++counter}`), docsBase = path.join(temp, `base-${counter}`);
  fs.mkdirSync(directory, { recursive:true });
  const lines = createProjectLines({ directory, agents:agents(), serviceOptions:{ autoWatch:false, docsBase }, authorizeRead:() => null, authorizeWrite:() => null, isThisComputer:() => true,
    readJson:req => new Promise((resolve, reject) => { let s = ""; req.on("data", d => { s += d; }).on("end", () => { try { resolve(s ? JSON.parse(s) : {}); } catch (error) { reject(error); } }); }),
    send:(res, code, data) => { res.writeHead(code, { "content-type":"application/json" }); res.end(JSON.stringify(data)); } });
  const server = http.createServer(async (req, res) => { if (!await lines.handle(req, res, new URL(req.url, "http://x"))) { res.writeHead(404); res.end(); } });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  servers.push({ server, lines });
  const base = `http://127.0.0.1:${server.address().port}/api/lines`, { service } = lines;
  const call = async (method, route, body) => { const res = await fetch(`${base}${route}`, { method, ...(body ? { headers:{ "content-type":"application/json" }, body:JSON.stringify(body) } : {}) }); return { status:res.status, ...await res.json() }; };
  const project = name => { const made = service.store.create({ name, docsPath:path.join(docsBase, name) }); made.defaultAgent = "fake"; return made; };
  return { lines, service, docsBase, call, post:(route, body = {}) => call("POST", route, body), get:route => call("GET", route), project };
}
const PNG = (mark = "page") => `data:image/png;base64,${Buffer.from(`\x89PNG\r\n\x1a\n${mark}`, "latin1").toString("base64")}`;
const sha = text => crypto.createHash("sha256").update(text).digest("hex");
const diagram = (title, extra = []) => JSON.stringify({ type:"workflow", title, nodes:[{ id:"s", label:"Start", type:"start" }, ...extra.map((label, i) => ({ id:`n${i}`, label, type:"process" })), { id:"e", label:"End", type:"end" }], edges:[{ from:"s", to:extra.length ? "n0" : "e" }, ...extra.map((_, i) => ({ from:`n${i}`, to:i + 1 < extra.length ? `n${i + 1}` : "e" }))] });
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const widgetsOf = bundle => bundle.assets.filter(a => a.kind === "widget").map(a => JSON.parse(Buffer.from(a.dataBase64, "base64").toString("utf8")));
const setWidget = (bundle, id, change) => { const asset = bundle.assets.find(a => a.kind === "widget" && a.metadata.widgetId === id), widget = JSON.parse(Buffer.from(asset.dataBase64, "base64").toString("utf8")); change(widget); asset.dataBase64 = Buffer.from(JSON.stringify(widget)).toString("base64"); };
const tile = key => ({ kind:"tile", contentType:"image/png", metadata:{ tileKey:key }, dataBase64:"AAAA" });
const canvasFiles = docs => fs.readdirSync(docs, { recursive:true }).map(String).filter(name => /\.(penecho\.json|png)$/.test(name) && !name.startsWith(".")).sort();

test("an agent redraws while the page saves an older copy, and the Canvas still gets the drawing", async () => {
  const { service, project, post, get } = await setup(), p = project("Redraw"), docs = p.docsPath;
  const { slug } = await service.saveYours(p, { kind:"note", text:"Plan the flow" });
  const source = `files/${slug}/map.diagram.json`, canvas = `files/${slug}/map.penecho.json`, id = sourceWidgetId(source), file = path.join(docs, canvas), picture = path.join(docs, `files/${slug}/map.png`);
  fs.mkdirSync(path.dirname(file), { recursive:true });
  fs.writeFileSync(path.join(docs, source), diagram("One"));
  await service.makePictures(p);
  assert.equal(readJson(file).manifest.extensions["penecho.lines"].sources[id], sha(diagram("One")), "the Canvas says which text its Widget was drawn from");
  assert.equal(widgetsOf(readJson(file))[0].title, "One");

  // The page opens the Canvas. You draw on it and move the diagram.
  const page = (await get(`/projects/${p.id}/canvas?path=${encodeURIComponent(canvas)}`)).source;
  page.assets.push(tile("3,3"));
  setWidget(page, id, widget => Object.assign(widget, { x:5000, y:6000, w:900, h:500 }));
  // Meanwhile an agent rewrites the diagram, and the page saves its older copy before PenEcho has looked at the folder again.
  fs.writeFileSync(path.join(docs, source), diagram("Two", ["Check the order"]));
  const madeByAgent = fs.readFileSync(picture);
  const saved = await post(`/projects/${p.id}/canvas`, { path:canvas, source:page, png:PNG("stale") });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.changed, [id], "the save says which Widget an agent changed");
  assert.equal(saved.widgets[0].title, "Two");
  assert.equal(saved.sources[id], sha(diagram("Two", ["Check the order"])));
  let disk = readJson(file), widget = widgetsOf(disk)[0];
  assert.equal(widget.title, "Two"); assert.match(widget.html, /Check the order/);
  assert.deepEqual([widget.x, widget.y, widget.w, widget.h], [5000, 6000, 900, 500], "where and as large as the page had it");
  assert.equal(disk.assets.filter(a => a.kind === "tile").length, 1, "what you drew is kept");
  assert.equal(widgetsOf(disk).length, 1);
  assert.notDeepEqual(fs.readFileSync(picture), madeByAgent, "the picture was made again from the new diagram");
  assert.ok(!fs.readFileSync(picture).includes("stale"), "the page's picture, drawn before it had the new diagram, does not hide it");
  assert.match(fs.readFileSync(path.join(docs, `lines/${slug}.md`), "utf8"), /!\[Two\]\(\.\.\/files\/.+\/map\.png\)|!\[One\]\(\.\.\/files\/.+\/map\.png\)/, "and it is linked from its line");

  // A page that never takes the change in keeps saving its old copy, with no picture on quick saves. The drawing stays.
  page.assets.push(tile("4,4"));
  const again = await post(`/projects/${p.id}/canvas`, { path:canvas, source:page, png:null });
  assert.deepEqual(again.changed, [id]);
  disk = readJson(file);
  assert.equal(widgetsOf(disk)[0].title, "Two"); assert.equal(disk.assets.filter(a => a.kind === "tile").length, 2);

  // The save and the picture maker at the same moment: each waits for the other, and both are in the file.
  fs.writeFileSync(path.join(docs, source), diagram("Three", ["Check the order", "Ship it"]));
  page.assets.push(tile("5,5"));
  const [, both] = await Promise.all([service.makePictures(p), service.saveCanvas(p, { path:canvas, source:page, png:null })]);
  assert.deepEqual(both.changed, [id]);
  disk = readJson(file);
  assert.equal(widgetsOf(disk)[0].title, "Three"); assert.match(widgetsOf(disk)[0].html, /Ship it/);
  assert.equal(disk.assets.filter(a => a.kind === "tile").length, 3);
  assert.ok(!service.canvasBusy(p, canvas), "and the file's turn is over");

  // A page that took the change in sends it back with its picture, and that picture is the one kept.
  const fresh = (await get(`/projects/${p.id}/canvas?path=${encodeURIComponent(canvas)}`)).source;
  const settled = await post(`/projects/${p.id}/canvas`, { path:canvas, source:fresh, png:PNG("both") });
  assert.deepEqual(settled.changed, []);
  assert.ok(fs.readFileSync(picture).includes("both"));
});

test("a source that did not change keeps what you changed on the Canvas", async () => {
  const { service, project, post, get } = await setup(), p = project("Edits"), docs = p.docsPath;
  const { slug } = await service.saveYours(p, { kind:"note", text:"Plan" });
  const source = `files/${slug}/map.diagram.json`, canvas = `files/${slug}/map.penecho.json`, id = sourceWidgetId(source), file = path.join(docs, canvas);
  fs.mkdirSync(path.dirname(file), { recursive:true });
  fs.writeFileSync(path.join(docs, source), diagram("One"));
  await service.makePictures(p);
  const page = (await get(`/projects/${p.id}/canvas?path=${encodeURIComponent(canvas)}`)).source;
  setWidget(page, id, widget => { widget.html += "<!-- edited on the Canvas -->"; widget.title = "Mine"; });
  const saved = await post(`/projects/${p.id}/canvas`, { path:canvas, source:page, png:PNG() });
  assert.deepEqual(saved.changed, []);
  assert.match(widgetsOf(readJson(file))[0].html, /edited on the Canvas/);
  // The source file is touched, as a sync or a checkout does, with the same text in it. The old test by file time drew it again here.
  const later = new Date(Date.now() + 60000);
  fs.utimesSync(path.join(docs, source), later, later);
  await service.makePictures(p);
  assert.match(widgetsOf(readJson(file))[0].html, /edited on the Canvas/);
  assert.equal(widgetsOf(readJson(file))[0].title, "Mine");
  assert.ok(fs.readFileSync(path.join(docs, `files/${slug}/map.png`)).includes("page"), "and your picture stays");
  // You delete the diagram on the Canvas. It does not come back while its source stays as it is.
  page.assets = page.assets.filter(a => a.kind !== "widget");
  await post(`/projects/${p.id}/canvas`, { path:canvas, source:page, png:null });
  await service.makePictures(p);
  assert.equal(widgetsOf(readJson(file)).length, 0);
  // The agent draws it again, and it is back.
  fs.writeFileSync(path.join(docs, source), diagram("Again"));
  await service.makePictures(p);
  assert.equal(widgetsOf(readJson(file))[0].title, "Again");

  // A Canvas made before this was kept has nothing to compare, so it is told by file time, as before, and its file is not rewritten.
  const old = readJson(file);
  delete old.manifest.extensions["penecho.lines"];
  fs.writeFileSync(file, JSON.stringify(old));
  const before = fs.readFileSync(file, "utf8"), earlier = new Date(Date.now() - 60000);
  fs.utimesSync(path.join(docs, source), earlier, earlier);
  await service.makePictures(p);
  assert.equal(fs.readFileSync(file, "utf8"), before);
  fs.writeFileSync(path.join(docs, source), diagram("Newer"));
  fs.utimesSync(path.join(docs, source), later, later);
  await service.makePictures(p);
  assert.equal(widgetsOf(readJson(file))[0].title, "Newer", "a newer source is still drawn");
  assert.ok(readJson(file).manifest.extensions["penecho.lines"].sources[id], "and from then on it is told by its text");
});

test("a new Canvas has a folder of its own, shows as loose, and a note beside it makes its line without a second file", async () => {
  const { service, project, post, get } = await setup(), p = project("Plain"), docs = p.docsPath;
  const made = await post(`/projects/${p.id}/canvases`, { title:"Sketch" });
  assert.deepEqual([made.slug, made.source, made.picture, made.written], ["sketch", "files/sketch/canvas.penecho.json", "files/sketch/canvas.png", false]);
  assert.equal((await post(`/projects/${p.id}/canvases`, { title:"Sketch" })).slug, "sketch-2", "a second one does not take the first one's folder");
  assert.equal((await get(`/projects/${p.id}/state`)).pictures.length, 0, "nothing is a Canvas until something is drawn");
  // The Canvas page saves what you drew.
  const bundle = newBundle({ id:"lines-1", name:"Sketch" });
  bundle.assets.push(tile("1,1"));
  assert.equal((await post(`/projects/${p.id}/canvas`, { path:made.source, source:bundle, png:PNG() })).status, 200);
  let state = await get(`/projects/${p.id}/state`);
  assert.equal(state.pictures.length, 1);
  assert.deepEqual((({ source, path:png, title, folder, canvas, loose, topic, hasPicture }) => ({ source, png, title, folder, canvas, loose, topic, hasPicture }))(state.pictures[0]),
    { source:made.source, png:made.picture, title:"Sketch", folder:"sketch", canvas:true, loose:true, topic:undefined, hasPicture:true });
  assert.equal(state.lines.length + state.backlog.length, 0);
  const before = canvasFiles(docs);
  assert.deepEqual(before, ["files/sketch/canvas.penecho.json", "files/sketch/canvas.png"]);

  // A note beside it: the Canvas becomes a line where it is. Only the line's Markdown file is written.
  const noted = await post(`/projects/${p.id}/yours`, { kind:"note", text:"Remember the margin.", canvas:made.source });
  assert.equal(noted.slug, "sketch");
  assert.deepEqual(canvasFiles(docs), before, "no second Canvas file and no second picture");
  const topic = fs.readFileSync(path.join(docs, "lines/sketch.md"), "utf8");
  assert.match(topic, /## Canvas[^\n]*\n\n!\[Sketch\]\(\.\.\/files\/sketch\/canvas\.png\)/);
  assert.match(topic, /Remember the margin\./);
  state = await get(`/projects/${p.id}/state`);
  assert.equal(state.pictures[0].topic, "sketch"); assert.ok(!state.pictures[0].loose);
  const line = [...state.lines, ...state.backlog].find(l => l.slug === "sketch");
  assert.deepEqual(line.stations.map(s => s.kind), ["canvas", "note"]);
  // The page that had it open keeps saving to the same file.
  bundle.assets.push(tile("2,2"));
  assert.equal((await post(`/projects/${p.id}/canvas`, { path:made.source, source:bundle, png:PNG("more") })).status, 200);
  assert.deepEqual(canvasFiles(docs), before);
  // More notes, and an Ask, go on the same line.
  assert.deepEqual((({ slug, added }) => ({ slug, added }))(await post(`/projects/${p.id}/yours`, { kind:"note", text:"And the footer.", canvas:made.source })), { slug:"sketch", added:true });
  assert.deepEqual((({ slug, added }) => ({ slug, added }))(await post(`/projects/${p.id}/unsent`, { text:"Tidy this drawing up.", canvas:made.source })), { slug:"sketch", added:true });
  assert.deepEqual(canvasFiles(docs), before);
  assert.equal(fs.readdirSync(path.join(docs, "lines")).filter(name => name.endsWith(".md")).length, 1);
  // What the box draws for a Canvas of its own is that Canvas: it is not moved into another line's folder.
  const second = await post(`/projects/${p.id}/canvases`, { title:"Second", blank:true });
  assert.equal(second.written, true);
  fs.writeFileSync(path.join(docs, second.picture), Buffer.from("\x89PNG\r\n\x1a\nx", "latin1"));
  const asLine = await post(`/projects/${p.id}/yours`, { kind:"canvas", picture:second.picture });
  assert.equal(asLine.slug, "second");
  assert.ok(fs.existsSync(path.join(docs, second.source)));
  // Canvases kept the old way are still read.
  fs.mkdirSync(path.join(docs, "files/canvases"), { recursive:true });
  fs.writeFileSync(path.join(docs, "files/canvases/canvas-1.penecho.json"), JSON.stringify(newBundle({ id:"old", name:"Whatever the page called it" })));
  fs.mkdirSync(path.join(docs, "files/_incoming"), { recursive:true });
  fs.writeFileSync(path.join(docs, "files/_incoming/drawing-1.penecho.json"), JSON.stringify(newBundle({ id:"box", name:"" })));
  state = await get(`/projects/${p.id}/state`);
  const old = state.pictures.find(pic => pic.source === "files/canvases/canvas-1.penecho.json");
  assert.deepEqual([old.title, old.loose, old.canvas], ["canvas 1", true, undefined]);
  assert.ok(!state.pictures.some(pic => pic.source.startsWith("files/_incoming/")));
});

test("My Canvases is made on first use, is told apart, and cannot be archived or removed", async () => {
  const { service, docsBase, post, get, call, project } = await setup();
  project("Other");
  assert.equal((await get("/projects")).myCanvases, "");
  assert.equal((await get("/projects/my-canvases/state")).status, 404, "reading does not make it");
  assert.ok(!fs.existsSync(path.join(docsBase, "My Canvases")));
  const made = await post("/projects/my-canvases/canvases", { title:"Idea" });
  assert.equal(made.source, "files/idea/canvas.penecho.json");
  assert.ok(fs.existsSync(path.join(docsBase, "My Canvases", "MEMORY.md")), "an ordinary project folder under the docs base");
  const list = await get("/projects"), mine = list.projects.find(x => x.myCanvases);
  assert.equal(list.myCanvases, mine.id); assert.equal(mine.name, "My Canvases");
  assert.equal(list.projects.filter(x => x.myCanvases).length, 1);
  assert.equal((await post("/my-canvases")).project.id, mine.id, "asked for again, it is the same one");
  assert.equal((await get("/projects/my-canvases/state")).project.myCanvases, true);
  assert.equal((await get(`/projects/${list.projects.find(x => !x.myCanvases).id}/state`)).project.myCanvases, false);
  assert.equal((await call("PATCH", `/projects/${mine.id}`, { archived:true })).status, 400);
  assert.equal((await call("DELETE", `/projects/${mine.id}`)).status, 400);
  assert.equal(service.store.get(mine.id).archived, false);
  assert.equal((await call("PATCH", `/projects/${mine.id}`, { pinned:true })).status, 200, "everything else about it is an ordinary project");
});

test("a first open is said while there is no project and nothing kept in My Canvases (N1)", async () => {
  const { service, post, get, project } = await setup();
  assert.equal((await get("/projects")).firstOpen, true, "a fresh install");
  const made = await post("/projects/my-canvases/canvases", { title:"Canvas 1" });
  assert.equal((await get("/projects")).firstOpen, true, "a new Canvas nothing was drawn on yet keeps it a first open");
  const mine = service.store.myCanvases({ create:false });
  fs.mkdirSync(path.dirname(path.join(mine.docsPath, made.source)), { recursive:true });
  fs.writeFileSync(path.join(mine.docsPath, made.source), JSON.stringify(newBundle({ name:"Canvas 1" })));
  assert.equal((await get("/projects")).firstOpen, undefined, "a Canvas kept in My Canvases ends it");
  fs.rmSync(path.join(mine.docsPath, made.source));
  assert.equal((await get("/projects")).firstOpen, true);
  project("Weather app");
  assert.equal((await get("/projects")).firstOpen, undefined, "so does any project");
});

test("a Canvas from the Library is copied in, with the picture it was sent or the small one it carries", async () => {
  const { service, post, get } = await setup();
  const library = newBundle({ id:"snapshot-7", name:"Library drawing" });
  library.assets.push(tile("1,1"), { kind:"preview", contentType:"image/png", metadata:{ width:640, height:426 }, dataBase64:Buffer.from("\x89PNG\r\n\x1a\nsmall", "latin1").toString("base64") });
  const sent = JSON.stringify(library);
  // An unopened Library Canvas has no full picture, so none is sent.
  const copied = await post("/projects/my-canvases/canvases", { source:library, from:"server:snapshot-7" });
  assert.deepEqual([copied.slug, copied.source, copied.title, copied.hasPicture, copied.written], ["library-drawing", "files/library-drawing/canvas.penecho.json", "Library drawing", true, true]);
  const mine = service.store.myCanvases({ create:false }), docs = mine.docsPath, kept = readJson(path.join(docs, copied.source));
  assert.equal(kept.assets.filter(a => a.kind === "tile").length, 1); assert.equal(kept.id, "snapshot-7");
  assert.equal(kept.manifest.extensions["penecho.lines"].from, "server:snapshot-7");
  assert.ok(fs.readFileSync(path.join(docs, copied.picture)).includes("small"), "the small picture it carries stands in");
  assert.equal(JSON.stringify(library), sent, "what was sent is not changed");
  const pic = (await get("/projects/my-canvases/state")).pictures[0];
  assert.deepEqual([pic.title, pic.loose, pic.canvas, pic.hasPicture], ["Library drawing", true, true, true]);
  // Copied again, it is the same Canvas, not a second one.
  const twice = await post("/projects/my-canvases/canvases", { source:library, from:"server:snapshot-7" });
  assert.deepEqual([twice.source, twice.existing], [copied.source, true]);
  // Into a named project, with a name and the picture of an open Canvas.
  const other = service.store.create({ name:"Named", docsPath:path.join(path.dirname(docs), "Named") });
  const named = await post(`/projects/${other.id}/canvases`, { source:library, title:"Plan B", png:PNG("full") });
  assert.equal(named.source, "files/plan-b/canvas.penecho.json");
  assert.equal(readJson(path.join(other.docsPath, named.source)).name, "Plan B");
  assert.ok(fs.readFileSync(path.join(other.docsPath, named.picture)).includes("full"));
  assert.equal((await post(`/projects/${other.id}/canvases`, { source:{ assets:[] } })).status, 400, "anything that is not a Canvas is refused");
  assert.equal((await post(`/projects/${other.id}/canvases`, { source:library, png:"data:image/png;base64,AAAA" })).status, 400);
});

test("a line moved to another project keeps its pictures and its work details", async () => {
  const { service, project, post, get } = await setup(), a = project("From"), b = project("To"), c = project("Third");
  const { slug } = await service.createTopic(a, { text:"Draw the map.", kinds:["ask", "work"] });
  await until(() => !service.runs.size && ["done", "ready"].includes(F.parseLine(service.readDoc(a, slug)).status), "the work to finish");
  await service.saveYours(a, { kind:"note", text:"A note of mine.", topic:slug });
  const state = await get(`/projects/${a.id}/state`), line = [...state.lines, ...state.landed].find(l => l.slug === slug), work = line.stations.find(s => s.kind === "work");
  assert.ok(work.detail && fs.existsSync(path.join(a.docsPath, work.detail)), "the work has a detail file");
  assert.ok(fs.existsSync(path.join(a.docsPath, `files/${slug}/map.penecho.json`)), "and drew a picture");
  const detail = fs.readFileSync(path.join(a.docsPath, work.detail), "utf8"), canvasBefore = readJson(path.join(a.docsPath, `files/${slug}/map.penecho.json`));
  // A note taken off the line can still come back after the move.
  const dropped = await service.act(a, slug, "drop-yours", { step:line.stations.find(s => s.kind === "note").id });
  const activity = service.activityOf(a, slug).rows?.length ?? 0;

  const moved = await post(`/projects/${a.id}/topics/${slug}/move`, { to:b.id });
  assert.deepEqual([moved.status, moved.project, moved.slug], [200, b.id, slug]);
  assert.ok(!fs.existsSync(path.join(a.docsPath, `lines/${slug}.md`)) && !fs.existsSync(path.join(a.docsPath, `works/${slug}`)) && !fs.existsSync(path.join(a.docsPath, `files/${slug}`)), "it has left the first project");
  assert.equal(fs.readFileSync(path.join(b.docsPath, work.detail), "utf8"), detail, "its work detail is there as it was");
  assert.deepEqual(readJson(path.join(b.docsPath, `files/${slug}/map.penecho.json`)), canvasBefore);
  assert.ok(fs.existsSync(path.join(b.docsPath, `files/${slug}/map.png`)) && fs.existsSync(path.join(b.docsPath, `files/${slug}/map.diagram.json`)));
  const there = await get(`/projects/${b.id}/state`), arrived = [...there.lines, ...there.landed].find(l => l.slug === slug);
  assert.ok(arrived, "the line is in the other project");
  assert.match(arrived.code, new RegExp(`^${b.prefix}-\\d+$`), "with an id of that project");
  assert.match(fs.readFileSync(path.join(b.docsPath, `lines/${slug}.md`), "utf8"), /^moved from: .+ in From$/m);
  assert.deepEqual(arrived.pictures.map(pic => pic.path), [`files/${slug}/map.png`]);
  assert.equal(there.pictures.find(pic => pic.path === `files/${slug}/map.png`).topic, slug);
  assert.equal(arrived.stations.find(s => s.kind === "work").detail, work.detail);
  assert.equal(service.activityOf(b, slug).rows?.length ?? 0, activity, "what the agent did went with it");
  assert.equal((await get(`/projects/${a.id}/state`)).pictures.length, 0);
  // Its picture is not drawn a second time in its new place, and the source there still updates it.
  const at = fs.statSync(path.join(b.docsPath, `files/${slug}/map.penecho.json`)).mtimeMs;
  await service.makePictures(b);
  assert.equal(fs.statSync(path.join(b.docsPath, `files/${slug}/map.penecho.json`)).mtimeMs, at);
  assert.equal((await post(`/projects/${b.id}/topics/${slug}/restore-yours`, { removed:dropped.removed })).status, 200);
  assert.match(fs.readFileSync(path.join(b.docsPath, `lines/${slug}.md`), "utf8"), /A note of mine\./);

  // Where a line of that name is already there, it takes the next free name, and its links and its Widgets follow.
  // The first project keeps the name it gave, so the line comes from a third one.
  assert.equal((await service.createTopic(a, { text:"Draw the map.", kinds:["ask"] })).slug, `${slug}-2`, "a name is given once in a project");
  const again = await service.createTopic(c, { text:"Draw the map.", kinds:["ask", "work"] });
  assert.equal(again.slug, slug);
  await until(() => !service.runs.size && ["done", "ready"].includes(F.parseLine(service.readDoc(c, slug)).status), "the second work to finish");
  const second = await post(`/projects/${c.id}/topics/${slug}/move`, { to:b.id });
  assert.equal(second.slug, `${slug}-2`);
  const topic = fs.readFileSync(path.join(b.docsPath, `lines/${slug}-2.md`), "utf8");
  assert.match(topic, new RegExp(`\\(\\.\\./files/${slug}-2/map\\.png\\)`)); assert.match(topic, new RegExp(`\\(\\.\\./works/${slug}-2/work-1\\.md\\)`));
  assert.match(fs.readFileSync(path.join(b.docsPath, `works/${slug}-2/work-1.md`), "utf8"), new RegExp(`\\(\\.\\./\\.\\./lines/${slug}-2\\.md\\)`));
  const renamed = readJson(path.join(b.docsPath, `files/${slug}-2/map.penecho.json`)), id = sourceWidgetId(`files/${slug}-2/map.diagram.json`);
  assert.deepEqual(widgetsOf(renamed).map(w => w.id), [id]);
  fs.writeFileSync(path.join(b.docsPath, `files/${slug}-2/map.diagram.json`), JSON.stringify({ type:"architecture", title:"The new map", nodes:[{ id:"a", label:"App", type:"frontend" }], edges:[] }));
  await service.makePictures(b);
  const redrawn = widgetsOf(readJson(path.join(b.docsPath, `files/${slug}-2/map.penecho.json`)));
  assert.deepEqual(redrawn.map(w => [w.id, w.title]), [[id, "The new map"]], "one Widget, updated in place");

  // A Canvas on no line yet moves the same way, here to My Canvases. One that is being saved is refused.
  const loose = await post(`/projects/${a.id}/canvases`, { title:"Loose", blank:true });
  let release;
  const drawing = service.withCanvas(a, loose.source, () => new Promise(resolve => { release = resolve; })), saving = service.saveCanvas(a, { path:loose.source, source:newBundle({ id:"x", name:"Loose" }), png:null });
  const refused = await post(`/projects/${a.id}/topics/loose/move`, { to:"my-canvases" });
  assert.deepEqual([refused.status, refused.code], [409, "BUSY"]);
  assert.equal((await post(`/projects/${a.id}/canvases/delete`, { path:loose.source })).code, "BUSY");
  release(); await drawing; await saving;
  assert.ok(fs.existsSync(path.join(a.docsPath, loose.source)), "and the save that was waiting went through");
  const home = await post(`/projects/${a.id}/topics/loose/move`, { to:"my-canvases" });
  assert.equal(home.status, 200);
  const mine = service.store.myCanvases({ create:false });
  assert.equal(home.project, mine.id);
  assert.ok(fs.existsSync(path.join(mine.docsPath, "files/loose/canvas.penecho.json")) && !fs.existsSync(path.join(a.docsPath, "files/loose")));
  // A page that still has it open under its old place is told where it went, and makes no second Canvas there.
  const stale = await post(`/projects/${a.id}/canvas`, { path:loose.source, source:newBundle({ id:"x", name:"Loose" }), png:null });
  assert.deepEqual([stale.status, stale.code, stale.moved], [409, "MOVED", { project:mine.id, path:"files/loose/canvas.penecho.json" }]);
  assert.ok(!fs.existsSync(path.join(a.docsPath, loose.source)));
  assert.equal((await post(`/projects/${a.id}/topics/loose/move`, { to:b.id })).status, 404, "it is not there to move twice");
  assert.equal((await post(`/projects/${b.id}/topics/${slug}/move`, { to:b.id })).code, "SAME_PROJECT");
});

test("a renamed Canvas and a deleted Canvas come back as they were", async () => {
  const { service, project, post, get } = await setup(), p = project("Keep"), docs = p.docsPath;
  const made = await post(`/projects/${p.id}/canvases`, { title:"Sketch", blank:true });
  fs.writeFileSync(path.join(docs, made.picture), Buffer.from("\x89PNG\r\n\x1a\nx", "latin1"));
  await post(`/projects/${p.id}/yours`, { kind:"note", text:"Remember the margin.", canvas:made.source });
  // A page has it open, from before the new name.
  const page = (await get(`/projects/${p.id}/canvas?path=${encodeURIComponent(made.source)}`)).source;

  const renamed = await post(`/projects/${p.id}/canvases/rename`, { path:made.source, title:"Floor plan" });
  assert.deepEqual([renamed.status, renamed.title], [200, "Floor plan"]);
  assert.equal(readJson(path.join(docs, made.source)).name, "Floor plan");
  let state = await get(`/projects/${p.id}/state`);
  assert.equal(state.pictures[0].title, "Floor plan");
  assert.match(fs.readFileSync(path.join(docs, "lines/sketch.md"), "utf8"), /!\[Floor plan\]\(\.\.\/files\/sketch\/canvas\.png\)/);
  assert.equal(state.pictures[0].source, made.source, "its file stays where it is");
  // The page saves under the name it knew. The new name stays, and the page is told it.
  page.assets.push(tile("1,1"));
  const saved = await post(`/projects/${p.id}/canvas`, { path:made.source, source:page, png:null });
  assert.equal(saved.name, "Floor plan");
  assert.equal(readJson(path.join(docs, made.source)).name, "Floor plan");
  // Once the page has read the new name, a name given on the page is the one kept.
  const fresh = (await get(`/projects/${p.id}/canvas?path=${encodeURIComponent(made.source)}`)).source;
  fresh.name = "Ground floor";
  assert.equal((await post(`/projects/${p.id}/canvas`, { path:made.source, source:fresh, png:null })).name, undefined);
  assert.equal((await get(`/projects/${p.id}/state`)).pictures[0].title, "Ground floor");
  assert.equal((await post(`/projects/${p.id}/canvases/rename`, { path:made.source, title:" " })).status, 400);
  // A Canvas kept the old way takes a new name too.
  fs.mkdirSync(path.join(docs, "files/canvases"), { recursive:true });
  fs.writeFileSync(path.join(docs, "files/canvases/canvas-1.penecho.json"), JSON.stringify(newBundle({ id:"old", name:"Canvas 1" })));
  await post(`/projects/${p.id}/canvases/rename`, { path:"files/canvases/canvas-1.penecho.json", title:"Old one" });
  assert.equal((await get(`/projects/${p.id}/state`)).pictures.find(pic => pic.source === "files/canvases/canvas-1.penecho.json").title, "Old one");

  // Deleted: it leaves the folder and its line, and is listed in Deleted.
  const before = fs.readFileSync(path.join(docs, made.source), "utf8"), topicBefore = fs.readFileSync(path.join(docs, "lines/sketch.md"), "utf8");
  const deleted = await post(`/projects/${p.id}/canvases/delete`, { path:made.source });
  assert.equal(deleted.status, 200);
  assert.ok(!fs.existsSync(path.join(docs, made.source)) && !fs.existsSync(path.join(docs, made.picture)));
  state = await get(`/projects/${p.id}/state`);
  assert.ok(!state.pictures.some(pic => pic.source === made.source));
  assert.deepEqual(state.deleted.canvases.map(c => [c.removed, c.title, c.source]), [[deleted.removed, "Ground floor", made.source]]);
  assert.deepEqual(state.deleted.nodes, [], "its drawing on the line comes back with it, not by itself");
  assert.deepEqual([...state.lines, ...state.backlog].find(l => l.slug === "sketch").stations.map(s => s.kind), ["note"]);
  const late = await post(`/projects/${p.id}/canvas`, { path:made.source, source:page, png:null });
  assert.deepEqual([late.status, late.code], [410, "DELETED"], "a page that still has it open does not bring a copy back");

  const restored = await post(`/projects/${p.id}/canvases/restore`, { removed:deleted.removed });
  assert.deepEqual([restored.status, restored.source, restored.picture], [200, made.source, made.picture]);
  assert.equal(fs.readFileSync(path.join(docs, made.source), "utf8"), before, "the same file, with its new name");
  assert.ok(fs.existsSync(path.join(docs, made.picture)));
  assert.equal(fs.readFileSync(path.join(docs, "lines/sketch.md"), "utf8").replace(/\s+/g, " "), topicBefore.replace(/\s+/g, " "), "and its drawing is back on its line, where it was");
  state = await get(`/projects/${p.id}/state`);
  assert.deepEqual([state.pictures.find(pic => pic.source === made.source).title, state.pictures.find(pic => pic.source === made.source).topic], ["Ground floor", "sketch"]);
  assert.deepEqual(state.deleted.canvases, []);
  assert.equal((await post(`/projects/${p.id}/canvases/restore`, { removed:deleted.removed })).status, 404);
  assert.equal((await post(`/projects/${p.id}/canvas`, { path:made.source, source:fresh, png:null })).status, 200, "and it can be saved again");

  // A new Canvas that takes a deleted one's place is another Canvas: it saves, as the Projects page's New Canvas may reuse a name.
  await post(`/projects/${p.id}/canvases/delete`, { path:"files/canvases/canvas-1.penecho.json" });
  assert.equal((await post(`/projects/${p.id}/canvas`, { path:"files/canvases/canvas-1.penecho.json", source:newBundle({ id:"lines-new", name:"Canvas 1" }), png:null })).status, 200);
  assert.equal((await get(`/projects/${p.id}/state`)).deleted.canvases.length, 1);

  // A Canvas an agent drew goes with its source file, so it is not drawn again while it is in Deleted, and comes back linked from its Work.
  const { slug } = await service.createTopic(p, { text:"Draw the map.", kinds:["ask", "work"] });
  await until(() => !service.runs.size && ["done", "ready"].includes(F.parseLine(service.readDoc(p, slug)).status), "the work to finish");
  const drawn = `files/${slug}/map.penecho.json`, lineBefore = fs.readFileSync(path.join(docs, `lines/${slug}.md`), "utf8");
  assert.match(lineBefore, /!\[The map\]/);
  const gone = await post(`/projects/${p.id}/canvases/delete`, { path:drawn });
  await service.makePictures(p);
  assert.ok(!fs.existsSync(path.join(docs, drawn)) && !fs.existsSync(path.join(docs, `files/${slug}/map.diagram.json`)));
  assert.doesNotMatch(fs.readFileSync(path.join(docs, `lines/${slug}.md`), "utf8"), /!\[The map\]/);
  await post(`/projects/${p.id}/canvases/restore`, { removed:gone.removed });
  assert.ok(fs.existsSync(path.join(docs, drawn)) && fs.existsSync(path.join(docs, `files/${slug}/map.diagram.json`)));
  assert.match(fs.readFileSync(path.join(docs, `lines/${slug}.md`), "utf8"), /!\[The map\]\(\.\.\/files\/.+\/map\.png\)/);
});

test("a Canvas taken off its line is a loose Canvas again, in a folder of its own", async () => {
  const { service, project, post, get } = await setup(), p = project("Off"), docs = p.docsPath;
  const { slug } = await service.createTopic(p, { text:"Draw the map.", kinds:["ask", "work"] });
  await until(() => !service.runs.size && ["done", "ready"].includes(F.parseLine(service.readDoc(p, slug)).status), "the work to finish");
  const drawn = `files/${slug}/map.penecho.json`, id = sourceWidgetId(`files/${slug}/map.diagram.json`);
  assert.deepEqual(widgetsOf(readJson(path.join(docs, drawn))).map(w => w.id), [id]);
  const off = await post(`/projects/${p.id}/canvases/loose`, { path:drawn });
  assert.deepEqual([off.status, off.slug, off.source, off.moved], [200, "the-map", "files/the-map/canvas.penecho.json", true]);
  assert.ok(!fs.existsSync(path.join(docs, drawn)) && !fs.existsSync(path.join(docs, `files/${slug}/map.diagram.json`)) && !fs.existsSync(path.join(docs, `files/${slug}/map.png`)));
  assert.ok(fs.existsSync(path.join(docs, "files/the-map/canvas.diagram.json")) && fs.existsSync(path.join(docs, "files/the-map/canvas.png")));
  assert.doesNotMatch(fs.readFileSync(path.join(docs, `lines/${slug}.md`), "utf8"), /map\.png/);
  let state = await get(`/projects/${p.id}/state`);
  const pic = state.pictures.find(x => x.source === off.source);
  assert.deepEqual([pic.title, pic.loose, pic.canvas, pic.topic], ["The map", true, true, undefined]);
  assert.ok([...state.lines, ...state.landed].some(l => l.slug === slug), "the line keeps everything else");
  // Its Widget is still its source's: it is not drawn twice, and a new drawing updates it in place.
  await service.makePictures(p);
  const next = sourceWidgetId("files/the-map/canvas.diagram.json");
  assert.deepEqual(widgetsOf(readJson(path.join(docs, off.source))).map(w => w.id), [next]);
  assert.ok(!fs.existsSync(path.join(docs, drawn)), "and nothing draws it again on the line");
  assert.deepEqual((await post(`/projects/${p.id}/canvases/loose`, { path:off.source })).moved, false, "a loose Canvas stays as it is");
  // A line that held only its Canvas goes to Deleted when the Canvas leaves it.
  const made = await post(`/projects/${p.id}/canvases`, { title:"Only", blank:true });
  fs.writeFileSync(path.join(docs, made.picture), Buffer.from("\x89PNG\r\n\x1a\nx", "latin1"));
  await post(`/projects/${p.id}/yours`, { kind:"canvas", picture:made.picture });
  assert.ok(fs.existsSync(path.join(docs, "lines/only.md")));
  const only = await post(`/projects/${p.id}/canvases/loose`, { path:made.source });
  assert.deepEqual(only.linesDeleted, ["only"]);
  state = await get(`/projects/${p.id}/state`);
  assert.ok(state.deleted.lines.some(l => l.slug === "only"));
  assert.equal(state.pictures.find(x => x.source === only.source).loose, true);
});

test("AI asked beside a Canvas works on that Canvas's line, and the Canvas stays where it is", async () => {
  const { service, project, post, get } = await setup(), p = project("Ask"), docs = p.docsPath;
  const made = await post(`/projects/${p.id}/canvases`, { title:"Board", blank:true });
  const before = fs.readFileSync(path.join(docs, made.source), "utf8");
  const asked = await post(`/projects/${p.id}/topics`, { text:"Draw the map.", canvas:made.source });
  assert.deepEqual([asked.status, asked.slug], [200, "board"]);
  await until(() => !service.runs.size && ["done", "ready"].includes(F.parseLine(service.readDoc(p, "board")).status), "the work to finish");
  // What the agent drew for this line went onto the Canvas the Ask came from, as one more picture on it (B1), and the Canvas stayed where it is.
  const after = readJson(path.join(docs, made.source));
  assert.notEqual(JSON.stringify(after), before);
  assert.deepEqual(widgetsOf(after).map(w => w.title), ["The map"]);
  assert.ok(fs.existsSync(path.join(docs, "files/board/canvas+map.diagram.json")));
  const state = await get(`/projects/${p.id}/state`), line = [...state.lines, ...state.landed].find(l => l.slug === "board");
  assert.deepEqual(line.stations.map(s => s.kind), ["canvas", "ask", "work"]);
  assert.equal(state.pictures.find(pic => pic.source === made.source).topic, "board");
  assert.equal((await post(`/projects/${p.id}/topics`, { text:"", canvas:made.source })).status, 400);
});

test("review finding 4: a new line never takes the name of a Canvas folder, so the Canvas is not carried off with it", async () => {
  const { service, project, post } = await setup(), p = project("Names");
  const canvas = await post(`/projects/${p.id}/canvases`, { title:"Roadmap", blank:true });
  assert.equal(canvas.source, "files/roadmap/canvas.penecho.json");
  const unsent = await post(`/projects/${p.id}/unsent`, { text:"Roadmap" });
  assert.notEqual(unsent.slug, "roadmap", "the line gets a name of its own");
  const yours = await service.newYoursLine(p, { title:"Roadmap" });
  assert.notEqual(yours, "roadmap");
  const note = service.createNote(p, { title:"Roadmap" });
  assert.notEqual(note.path, "lines/roadmap.md");
  assert.ok(!service.isLine(p, "roadmap"));
  // The Canvas still becomes its own line when a note is added beside it.
  const beside = await post(`/projects/${p.id}/yours`, { kind:"note", text:"Q3 first.", canvas:canvas.source });
  assert.equal(beside.slug, "roadmap");
});

test("review finding 6: two pages on one Canvas: a save from a page that started before another page's save is refused, an agent's drawing is not a reason", async () => {
  const { service, project, post, get } = await setup(), p = project("Two pages");
  const made = await post(`/projects/${p.id}/canvases`, { title:"Shared", blank:true });
  const open = async () => { const read = await get(`/projects/${p.id}/canvas?path=${encodeURIComponent(made.source)}`); return { source:read.source, base:read.base }; };
  const a = await open(), b = await open();
  assert.equal(a.base, b.base);
  const savedA = await post(`/projects/${p.id}/canvas`, { path:made.source, source:a.source, png:null, base:a.base });
  assert.equal(savedA.status, 200, savedA.error);
  assert.ok(savedA.base && savedA.base !== a.base, "a save answers the new version");
  const refused = await post(`/projects/${p.id}/canvas`, { path:made.source, source:b.source, png:null, base:b.base });
  assert.deepEqual([refused.status, refused.error, refused.current], [409, "canvas_changed", savedA.base]);
  // An agent draws: page A's next save still goes, and keeps the drawing.
  fs.writeFileSync(path.join(p.docsPath, "files/shared/canvas+map.diagram.json"), diagram("Agent map"));
  await service.makePictures(p);
  const again = await post(`/projects/${p.id}/canvas`, { path:made.source, source:a.source, png:null, base:savedA.base });
  assert.equal(again.status, 200, again.error);
  assert.equal(again.changed.length, 1, "the agent's Widget came into the save");
  // A page that sends no base (an older page) saves as before.
  assert.equal((await post(`/projects/${p.id}/canvas`, { path:made.source, source:b.source, png:null })).status, 200);
});

test("review finding 7: after a restart, a page still open on a deleted or moved Canvas is told so instead of making it again", async () => {
  const first = await setup(), p = first.project("Restart");
  const made = await first.post(`/projects/${p.id}/canvases`, { title:"Gone soon", blank:true });
  const read = await first.get(`/projects/${p.id}/canvas?path=${encodeURIComponent(made.source)}`);
  assert.equal((await first.post(`/projects/${p.id}/canvases/delete`, { path:made.source })).status, 200);
  // PenEcho restarts: a new service on the same state folder.
  const { Service } = require("../src/server/project-lines/service.js");
  const again = new Service({ directory:first.service.directory, agents:createAgents({ env:{ PATH:"" } }), autoWatch:false, docsBase:first.docsBase });
  const project = again.store.get(p.id);
  await assert.rejects(again.saveCanvas(project, { path:made.source, source:read.source, png:null }), error => error.status === 410 && error.code === "DELETED");
  assert.ok(!fs.existsSync(path.join(p.docsPath, made.source)), "not made again at its old place");
  again.close();
});

test("review finding 12: a move or a restore that fails half way leaves everything in one place", async () => {
  const { service, project, post } = await setup(), from = project("From"), to = project("To");
  const { slug } = await post(`/projects/${from.id}/unsent`, { text:"Moving line" });
  fs.mkdirSync(path.join(from.docsPath, `files/${slug}`), { recursive:true });
  fs.writeFileSync(path.join(from.docsPath, `files/${slug}/a.txt`), "a");
  const locked = path.join(from.docsPath, `files/${slug}/z-locked.txt`);
  fs.writeFileSync(locked, "z"); fs.chmodSync(locked, 0o000);
  // 1. A copy that fails half way leaves nothing in the target.
  const failed = await post(`/projects/${from.id}/topics/${slug}/move`, { to:to.id });
  fs.chmodSync(locked, 0o600);
  assert.equal(failed.status, 500, "the copy failed half way"); {
    assert.equal(failed.code, "MOVE_FAILED");
    assert.ok(!fs.existsSync(path.join(to.docsPath, `files/${slug}`)), "no partial folder in the target");
    assert.ok(service.isLine(from, slug));
  }
  // 2. An error after the copy: the line is in the target only.
  const fileOf = service.activity.fileOf;
  service.activity.fileOf = () => { throw new Error("disk trouble"); };
  const moved = await post(`/projects/${from.id}/topics/${slug}/move`, { to:to.id });
  service.activity.fileOf = fileOf;
  assert.equal(moved.status, 200, moved.error);
  assert.ok(moved.warning, "it says what stayed behind");
  assert.ok(!fs.existsSync(path.join(from.docsPath, `lines/${slug}.md`)), "not left in both projects");
  assert.ok(service.isLine(to, moved.slug));
  // 3. A restore that fails half way puts everything back in Deleted, and the next restore works.
  const c = await post(`/projects/${to.id}/canvases`, { title:"Restore me", blank:true });
  fs.writeFileSync(path.join(to.docsPath, "files/restore-me/canvas.png"), "png");
  const deleted = await post(`/projects/${to.id}/canvases/delete`, { path:c.source });
  const rename = fs.renameSync;
  let calls = 0;
  fs.renameSync = (...args) => { if (++calls === 2) throw Object.assign(new Error("busy"), { code:"EBUSY" }); return rename(...args); };
  const half = await post(`/projects/${to.id}/canvases/restore`, { removed:deleted.removed });
  fs.renameSync = rename;
  assert.equal(half.status, 500);
  assert.ok(!fs.existsSync(path.join(to.docsPath, c.source)) && !fs.existsSync(path.join(to.docsPath, "files/restore-me/canvas.png")), "nothing half restored");
  const whole = await post(`/projects/${to.id}/canvases/restore`, { removed:deleted.removed });
  assert.equal(whole.status, 200, whole.error);
  assert.ok(fs.existsSync(path.join(to.docsPath, c.source)));
});

test("a new loose Canvas can be attached to an existing Line and detached cleanly on Undo", async () => {
  const { service, project, post, get } = await setup(), p = project("Attach"), docs = p.docsPath;
  const line = await post(`/projects/${p.id}/unsent`, { text:"Investigate timing bug" });
  const canvas = await post(`/projects/${p.id}/canvases`, { title:"Retry Diagram", blank:true });
  fs.writeFileSync(path.join(docs, canvas.picture), Buffer.from("\x89PNG\r\n\x1a\ndrawing", "latin1"));

  // Attaching adds a Canvas node to the target Line while keeping the Canvas in its own folder.
  const first = await post(`/projects/${p.id}/canvases/attach`, { path:canvas.source, topic:line.slug });
  assert.equal(first.status, 200, first.error);
  assert.deepEqual([first.ok, first.slug, first.alreadyAdded], [true, line.slug, false]);
  assert.ok(first.step);
  assert.match(fs.readFileSync(path.join(docs, `lines/${line.slug}.md`), "utf8"), /!\[Retry Diagram\]\(\.\.\/files\/retry-diagram\/canvas\.png\)/);

  // Calling attach again is idempotent (prevents duplicate nodes on double-click).
  const second = await post(`/projects/${p.id}/canvases/attach`, { path:canvas.source, topic:line.slug });
  assert.equal(second.status, 200);
  assert.equal(second.alreadyAdded, true);
  assert.equal(second.step, first.step);

  // Detaching (Undo) removes only the Canvas node while keeping both the Line and the Canvas intact.
  const undone = await post(`/projects/${p.id}/canvases/detach`, { path:canvas.source, topic:line.slug, step:first.step });
  assert.equal(undone.status, 200);
  assert.equal(undone.removed, true);
  assert.doesNotMatch(fs.readFileSync(path.join(docs, `lines/${line.slug}.md`), "utf8"), /retry-diagram\/canvas\.png/);
  assert.ok(fs.existsSync(path.join(docs, canvas.source)));
  assert.ok(service.isLine(p, line.slug));
  const state = await get(`/projects/${p.id}/state`);
  assert.equal(state.pictures.find(pic => pic.source === canvas.source)?.loose, true);
});

test("a Canvas on no line moves to another project with its picture, and the original goes to Deleted", async () => {
  const { project, post, get } = await setup(), a = project("Move from"), b = project("Move to");
  fs.mkdirSync(path.join(a.docsPath, "files/canvases"), { recursive:true });
  fs.writeFileSync(path.join(a.docsPath, "files/canvases/sketch.penecho.json"), JSON.stringify(newBundle({ id:"s1", name:"Sketch" })));
  fs.writeFileSync(path.join(a.docsPath, "files/canvases/sketch.png"), Buffer.from("\x89PNG\r\n\x1a\nsketch", "latin1"));
  // Something with the same name is already there: the moved one takes another, and that one is left as it was.
  const theirs = JSON.stringify(newBundle({ id:"s0", name:"Theirs" }));
  fs.mkdirSync(path.join(b.docsPath, "files/canvases"), { recursive:true });
  fs.writeFileSync(path.join(b.docsPath, "files/canvases/sketch.penecho.json"), theirs);
  const moved = await post(`/projects/${a.id}/canvases/move`, { path:"files/canvases/sketch.penecho.json", to:b.id });
  assert.equal(moved.status, 200, JSON.stringify(moved));
  assert.equal(moved.path, "files/canvases/sketch-2.penecho.json");
  assert.ok(fs.existsSync(path.join(b.docsPath, "files/canvases/sketch-2.png")), "its picture went with it");

  assert.equal(fs.readFileSync(path.join(b.docsPath, "files/canvases/sketch.penecho.json"), "utf8"), theirs);
  assert.ok(!fs.existsSync(path.join(a.docsPath, "files/canvases/sketch.penecho.json")));
  assert.equal((await get(`/projects/${a.id}/state`)).deleted.canvases.length, 1, "the original is in Deleted, where Restore brings it back");
  assert.equal((await post(`/projects/${a.id}/canvases/move`, { path:"files/canvases/sketch.penecho.json", to:"nope" })).status, 404);
});
