"use strict";
require("./helpers/safety.js");
// B2: every Canvas lives in My Canvases. The old Library's Canvases come in by `from` alone, an old Canvas project
// becomes a label, and a label becomes a project.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const { newBundle } = require("../src/server/project-lines/canvas-file.js");

const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penecho-library-")));
const closers = [];
after(() => { for (const close of closers) close(); fs.rmSync(temp, { recursive:true, force:true }); });
const bundle = (id, name) => { const b = newBundle({ id, name }); b.assets.push({ kind:"tile", contentType:"image/png", metadata:{ tileKey:"1,1" }, dataBase64:"iVBORw0KGgo=" }); return b; };
// This server's own Library: three Canvases in the project "Trip", one in Uncategorized.
function fakeLocal() {
  const canvases = [
    { id:"c1", name:"Day one", projectId:"project-trip", updatedAt:1000 },
    { id:"c2", name:"Day two", projectId:"project-trip", updatedAt:2000 },
    { id:"c3", name:"Day three", projectId:"project-trip", updatedAt:3000 },
    { id:"c4", name:"Loose idea", projectId:"uncategorized", updatedAt:4000 },
  ];
  const stored = Object.fromEntries(canvases.map(c => [c.id, JSON.stringify(bundle(`lib-${c.id}`, c.name))]));
  return { stored, list:() => canvases, projects:() => [{ id:"uncategorized", name:"Uncategorized", system:true }, { id:"project-trip", name:"Trip", system:false }], read:id => { if (!stored[id]) throw Object.assign(new Error("Canvas was not found."), { status:404 }); return JSON.parse(stored[id]); } };
}
function fakeCloud() {
  const cloud = { signedIn:false, loads:0 };
  cloud.status = () => ({ accountSession:{ signedIn:cloud.signedIn } });
  cloud.library = async () => ({ canvases:[{ id:"k1", name:"Board", projectId:"cp1", updatedAt:"2026-11-01T10:00:00Z" }], projects:[{ id:"cp1", name:"Work" }], page:{ nextOffset:null } });
  cloud.loadCloudCanvas = async id => { cloud.loads++; if (id !== "k1") throw new Error("nope"); return { revision:{ id:"r1" }, bundle:bundle("cloud-k1", "Board") }; };
  return cloud;
}
async function setup() {
  const directory = path.join(temp, `state-${closers.length}`), docsBase = path.join(temp, `base-${closers.length}`), local = fakeLocal(), cloud = fakeCloud();
  fs.mkdirSync(directory, { recursive:true });
  const lines = createProjectLines({ library:{ local, cloud:() => cloud }, directory, agents:createAgents({ env:{ PATH:"" } }), serviceOptions:{ autoWatch:false, docsBase }, authorizeRead:() => null, authorizeWrite:() => null, isThisComputer:() => true,
    readJson:req => new Promise((resolve, reject) => { let s = ""; req.on("data", d => { s += d; }).on("end", () => { try { resolve(s ? JSON.parse(s) : {}); } catch (error) { reject(error); } }); }),
    send:(res, code, data) => { res.writeHead(code, { "content-type":"application/json" }); res.end(JSON.stringify(data)); } });
  const server = http.createServer(async (req, res) => { if (!await lines.handle(req, res, new URL(req.url, "http://x"))) { res.writeHead(404); res.end(); } });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  closers.push(() => { server.close(); lines.close(); });
  const call = async (method, route, body) => { const res = await fetch(`http://127.0.0.1:${server.address().port}/api/lines${route}`, { method, ...(body ? { headers:{ "content-type":"application/json" }, body:JSON.stringify(body) } : {}) }); return { status:res.status, ...await res.json() }; };
  return { service:lines.service, local, cloud, call, docsBase };
}

test("a Library project with three Canvases gives three Canvases in My Canvases with its name as their label, and no new project", async () => {
  const { service, local, call } = await setup(), before = JSON.stringify(local.stored);
  let listed = await call("GET", "/library");
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.cloud, { signedIn:false });
  assert.deepEqual(listed.canvases.map(c => [c.from, c.title, c.kept, c.project?.name || null, c.imported]), [
    ["server:c4", "Loose idea", "server", null, false], ["server:c3", "Day three", "server", "Trip", false], ["server:c2", "Day two", "server", "Trip", false], ["server:c1", "Day one", "server", "Trip", false]]);
  assert.deepEqual(listed.canvases[1].project, { id:"project-trip", name:"Trip" });
  for (const id of ["c1", "c2", "c3", "c4"]) {
    const made = await call("POST", "/projects/my-canvases/canvases", { from:`server:${id}` });
    assert.equal(made.status, 200, made.error);
    assert.equal(made.written, true);
  }
  const mine = service.store.myCanvases({ create:false });
  assert.deepEqual(service.store.projects.map(p => p.id), [mine.id], "no project but My Canvases");
  const state = await call("GET", `/projects/${mine.id}/state`), pics = state.pictures.filter(p => p.canvas);
  assert.deepEqual(pics.map(p => [p.title, p.group || ""]).sort(), [["Day one", "Trip"], ["Day three", "Trip"], ["Day two", "Trip"], ["Loose idea", ""]]);
  const file = JSON.parse(fs.readFileSync(path.join(mine.docsPath, pics.find(p => p.title === "Day two").source), "utf8"));
  assert.deepEqual([file.manifest.extensions["penecho.lines"].from, file.manifest.extensions["penecho.lines"].group], ["server:c2", "Trip"]);
  assert.ok(file.assets.some(a => a.kind === "tile"), "the drawing came with it");
  // Asking again (as a page will on every save) gives the same Canvas and writes nothing.
  const source = pics.find(p => p.title === "Day two").source, mtime = fs.statSync(path.join(mine.docsPath, source)).mtimeMs;
  const again = await call("POST", "/projects/my-canvases/canvases", { from:"server:c2" });
  assert.deepEqual([again.source, again.existing], [source, true]);
  assert.equal(fs.statSync(path.join(mine.docsPath, source)).mtimeMs, mtime);
  assert.equal(service.store.walk(mine).filter(f => f.path.endsWith(".penecho.json")).length, 4);
  assert.equal(JSON.stringify(local.stored), before, "the Library's own copies are untouched");
  listed = await call("GET", "/library");
  assert.ok(listed.canvases.every(c => c.imported));
  assert.equal((await call("POST", "/projects/my-canvases/canvases", { from:"server:nope" })).status, 404);
  assert.equal((await call("POST", "/projects/my-canvases/canvases", { from:"elsewhere:1" })).status, 400);
});

test("fromGroup makes a project of that label and moves exactly its Canvases into it", async () => {
  const { service, call, docsBase } = await setup();
  for (const id of ["c1", "c2", "c3", "c4"]) await call("POST", "/projects/my-canvases/canvases", { from:`server:${id}` });
  const mine = service.store.myCanvases({ create:false });
  const made = await call("POST", "/projects", { name:"Trip", fromGroup:"Trip" });
  assert.equal(made.status, 200, made.error);
  assert.equal(made.moved, 3);
  assert.equal(made.project.name, "Trip");
  const project = service.store.projects.find(p => p.id === made.project.id);
  assert.equal(project.docsPath, path.join(docsBase, "Trip"));
  const theirs = service.store.walk(project).filter(f => /^files\/[^/]+\/canvas\.penecho\.json$/.test(f.path));
  assert.equal(theirs.length, 3, "each as a Canvas of the new project");
  assert.deepEqual(service.stateOf(project).lines.length, 0, "not on a line");
  const left = service.store.walk(mine).filter(f => /^files\/[^/]+\/canvas\.penecho\.json$/.test(f.path));
  assert.equal(left.length, 1, "the Canvas with no label stays");
  // Brought in once: asking for it again finds it in the project it moved to.
  const again = await call("POST", "/projects/my-canvases/canvases", { from:"server:c1" });
  assert.deepEqual([again.existing, again.project], [true, project.id]);
  assert.equal(service.store.walk(mine).filter(f => f.path.endsWith(".penecho.json")).length, 1, "no second copy");
  assert.equal((await call("POST", "/projects", { name:"x", fromGroup:"" })).status, 400);
});

test("a Cloud Canvas needs a signed-in account, comes in with its Cloud project's name, and an unknown one is 404", async () => {
  const { service, cloud, call } = await setup();
  const out = await call("POST", "/projects/my-canvases/canvases", { from:"cloud:k1" });
  assert.deepEqual([out.status, out.code], [401, "SIGN_IN"]);
  cloud.signedIn = true;
  const listed = await call("GET", "/library");
  assert.deepEqual(listed.canvases.find(c => c.from === "cloud:k1"), { from:"cloud:k1", title:"Board", kept:"cloud", updatedAt:Date.parse("2026-11-01T10:00:00Z"), project:{ id:"cp1", name:"Work" }, imported:false });
  const made = await call("POST", "/projects/my-canvases/canvases", { from:"cloud:k1" });
  assert.equal(made.status, 200, made.error);
  assert.equal(made.title, "Board");
  const mine = service.store.myCanvases({ create:false });
  assert.equal(service.stateOf(mine).pictures.find(p => p.source === made.source).group, "Work");
  assert.equal((await call("POST", "/projects/my-canvases/canvases", { from:"cloud:k9" })).status, 404);
  // A Cloud that does not answer leaves the computer's own list.
  cloud.library = async () => { throw new Error("offline"); };
  const offline = await call("GET", "/library");
  assert.equal(offline.canvases.length, 4);
  assert.match(offline.cloud.error, /offline/);
});
