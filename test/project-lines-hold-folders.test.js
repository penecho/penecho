"use strict";
require("./helpers/safety.js");
// The Mac app serves its window from the server's own thread, and macOS keeps the first look into Documents waiting until the person
// answers its question about it: kept waiting about 15 seconds, the window could not load at all. Held, the projects' folders are not
// looked into until something needs them, and the first look is made off that thread (http.js openFolders).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const { Store } = require("../src/server/project-lines/store.js");

const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penecho-hold-folders-")));
const closing = [];
after(async () => { for (const close of closing.reverse()) await close(); fs.rmSync(temp, { recursive:true, force:true }); });

// Every look into `folder`, in order: synchronous ones (which would hold the window's thread) and the async first look.
function watchLooks(folder) {
  const looks = [], undo = [];
  const note = (kind, value) => { if (typeof value === "string" && value.startsWith(folder)) looks.push(kind); };
  for (const name of Object.keys(fs)) {
    if (!/Sync$/.test(name) || typeof fs[name] !== "function") continue;
    const original = fs[name];
    fs[name] = function (...args) { note("sync", args[0]); return original.apply(this, args); };
    undo.push(() => { fs[name] = original; });
  }
  const opendir = fs.promises.opendir;
  fs.promises.opendir = function (at, ...rest) { note("opendir", at); return opendir.call(this, at, ...rest); };
  undo.push(() => { fs.promises.opendir = opendir; });
  return { looks, stop:() => undo.forEach(restore => restore()) };
}

async function computer(name, holdFolders) {
  const directory = path.join(temp, name, "state"), docsBase = path.join(temp, name, "Documents", "PenEcho");
  fs.mkdirSync(directory, { recursive:true });
  const made = new Store({ directory, docsBase }).create({ name:"Garden", docsPath:path.join(docsBase, "Garden") });
  const watch = watchLooks(docsBase);
  const lines = createProjectLines({ directory, holdFolders, agents:createAgents({ env:{ PATH:"" } }), serviceOptions:{ autoWatch:false, docsBase },
    authorizeRead:() => null, authorizeWrite:() => null, isThisComputer:() => true,
    readJson:req => new Promise((resolve, reject) => { let s = ""; req.on("data", d => { s += d; }).on("end", () => { try { resolve(s ? JSON.parse(s) : {}); } catch (error) { reject(error); } }); }),
    send:(res, code, data) => { res.writeHead(code, { "content-type":"application/json" }); res.end(JSON.stringify(data)); } });
  const server = http.createServer(async (req, res) => { if (!await lines.handle(req, res, new URL(req.url, "http://x"))) { res.writeHead(404); res.end(); } });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  closing.push(() => { watch.stop(); server.close(); lines.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api/lines`;
  const get = async route => { const response = await fetch(`${base}${route}`); return { status:response.status, body:await response.json() }; };
  const post = async (route, body) => { const response = await fetch(`${base}${route}`, { method:"POST", headers:{ "content-type":"application/json" }, body:JSON.stringify(body) }); return { status:response.status, body:await response.json() }; };
  return { lines, made, docsBase, watch, get, post };
}

test("held, starting and the Canvas page's first list look into no project folder", async () => {
  const c = await computer("held", true);
  assert.equal(c.lines.service.foldersHeld, true);
  assert.ok(!c.lines.service.releaseRuntime, "the Lines do not run before the folders are open");
  const first = await c.get("/projects?first=1");
  assert.equal(first.status, 200);
  const garden = first.body.projects.find(p => p.id === c.made.id);
  assert.equal(garden.name, "Garden");
  assert.equal(garden.missing, false, "a project not looked into yet is not shown as missing");
  assert.deepEqual(c.watch.looks, [], "nothing read the projects' folders yet");
  assert.equal(c.lines.service.foldersHeld, true);
});

test("held, the first page that needs the folders opens them off the thread first, then the Lines run", async () => {
  const c = await computer("opening", true);
  const [one, two] = await Promise.all([c.get("/projects"), c.get(`/projects/${c.made.id}/state`)]);
  assert.equal(one.status, 200); assert.equal(two.status, 200);
  assert.equal(c.watch.looks[0], "opendir", "the first look is the async one, so macOS's question never holds the window's thread");
  assert.equal(c.watch.looks.filter(kind => kind === "opendir").length, 1, "opened once for both pages");
  assert.equal(c.lines.service.foldersHeld, false);
  assert.ok(c.lines.service.releaseRuntime, "the Lines run once the folders are open");
  assert.equal(one.body.projects.find(p => p.id === c.made.id).name, "Garden");
});

test("held, a new project in a folder nobody looked into yet is looked into off the thread first", async () => {
  const c = await computer("new-project", true);
  await c.get("/projects");
  c.watch.looks.length = 0;
  const made = await c.post("/projects", { name:"Orchard", docsPath:path.join(c.docsBase, "Orchard") });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  assert.equal(c.watch.looks[0], "opendir");
});

test("not held (the server on its own), everything starts as before and first=1 is the whole list", async () => {
  const c = await computer("plain", false);
  assert.equal(c.lines.service.foldersHeld, false);
  assert.ok(c.lines.service.releaseRuntime);
  const first = await c.get("/projects?first=1");
  assert.equal(first.status, 200);
  assert.ok(first.body.projects.some(p => p.id === c.made.id));
  assert.ok(!c.watch.looks.includes("opendir"), "no extra first look without holding");
});
