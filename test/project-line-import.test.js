"use strict";
require("./helpers/safety.js");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const { Store } = require("../src/server/project-lines/store.js");

const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penecho-import-test-")));
after(() => fs.rmSync(temp, { recursive:true, force:true }));
let counter = 0;
const folder = name => { const dir = path.join(temp, `${name}-${++counter}`); fs.mkdirSync(dir, { recursive:true }); return dir; };
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive:true }); fs.writeFileSync(path.join(dir, rel), text); };
const topic = (id, code) => `---\nid: ${id}\nstatus: done\n${code ? `code: ${code}\n` : ""}---\n\n# A line\n\n## Ask · 2026-11-10 02:43\n\nHi\n`;

test("an existing docs folder comes back with its name, code folder and next Topic id", () => {
  const store = new Store({ directory:folder("registry") }), docs = folder("docs"), code = folder("code");
  write(docs, "README.md", `---\nproject: Moon Base\ncode: ${code}\n---\n\n# Moon Base\n`);
  write(docs, "MEMORY.md", "---\nproject: Moon Base\n---\n\n# Project memory\n\nKeep me.\n");
  write(docs, "topics/one.md", topic("MB-3"));
  write(docs, "topics/two.md", topic("MB-41"));
  const project = store.importFolder({ docsPath:docs });
  assert.equal(project.name, "Moon Base");
  assert.deepEqual(project.codePaths, [code]);
  assert.equal(project.prefix, "MB");
  assert.equal(store.nextId(project), "MB-42");
  assert.match(fs.readFileSync(path.join(docs, "MEMORY.md"), "utf8"), /Keep me\./);
  // Importing again gives the same project, back out of Archived.
  store.update(project.id, { archived:true });
  assert.equal(store.importFolder({ docsPath:docs }).id, project.id);
  assert.equal(project.archived, false);
  assert.equal(store.projects.length, 1);
});

test("a code folder that is not on this computer is left out; Topics name it when the README does not", () => {
  const store = new Store({ directory:folder("registry") }), code = folder("code");
  const away = folder("docs");
  write(away, "README.md", "---\nproject: Away\ncode: /nowhere/at/all\n---\n");
  assert.deepEqual(store.importFolder({ docsPath:away }).codePaths, []);
  const older = folder("docs");
  write(older, "README.md", "---\nproject: Older\ncode: none\n---\n");
  write(older, "topics/a.md", topic("OL-1", code));
  assert.deepEqual(store.importFolder({ docsPath:older }).codePaths, [code]);
  const bare = folder("docs");
  write(bare, "topics/a.md", topic("BA-7"));
  const named = store.importFolder({ docsPath:bare });
  assert.equal(named.name, path.basename(bare));
  assert.deepEqual(named.codePaths, []);
});

test("a folder that was never a project is refused", () => {
  const store = new Store({ directory:folder("registry") }), plain = folder("plain");
  write(plain, "notes.md", "# Notes\n");
  assert.throws(() => store.importFolder({ docsPath:plain }), { code:"NOT_PROJECT" });
  assert.throws(() => store.importFolder({ docsPath:path.join(temp, "missing") }), { code:"BAD_FOLDER" });
  assert.equal(store.projects.length, 0);
  assert.equal(fs.existsSync(path.join(plain, "topics")), false);
});

test("POST /projects/import adds the folder and lists it", async () => {
  const http = require("node:http");
  const { createProjectLines } = require("../src/server/project-lines/http.js");
  const lines = createProjectLines({ directory:folder("state"), serviceOptions:{ autoWatch:false }, authorizeRead:() => null, authorizeWrite:() => null, isThisComputer:() => true, readJson:req => new Promise(res => { let s = ""; req.on("data", d => s += d).on("end", () => res(s ? JSON.parse(s) : {})); }), send:(res, code, data) => { res.writeHead(code, { "content-type":"application/json" }); res.end(JSON.stringify(data)); } });
  const server = http.createServer(async (req, res) => { const url = new URL(req.url, "http://x"); if (!await lines.handle(req, res, url)) { res.writeHead(404); res.end(); } });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  after(() => { server.close(); lines.service.close?.(); });
  const base = `http://127.0.0.1:${server.address().port}/api/lines`, docs = folder("docs"), code = folder("code");
  write(docs, "README.md", `---\nproject: Over HTTP\ncode: ${code}\n---\n`);
  const post = body => fetch(`${base}/projects/import`, { method:"POST", headers:{ "content-type":"application/json" }, body:JSON.stringify(body) });
  const made = await post({ docsPath:docs });
  assert.equal(made.status, 200);
  const { project } = await made.json();
  assert.equal(project.name, "Over HTTP");
  assert.equal(project.code, code);
  const { projects } = await (await fetch(`${base}/projects`)).json();
  assert.deepEqual(projects.map(p => p.id), [project.id]);
  const refused = await post({ docsPath:folder("plain") });
  assert.equal(refused.status, 400);
  assert.match((await refused.json()).error, /not a PenEcho docs folder/);
});
