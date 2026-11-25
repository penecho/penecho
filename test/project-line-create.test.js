"use strict";
require("./helpers/safety.js");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { test, after } = require("node:test");
const { Store } = require("../src/server/project-lines/store.js");
const Memory = require("../src/server/project-lines/memory.js");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const { createCloudShare } = require("../src/server/project-lines/cloud-share.js");

const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penecho-create-")));
after(() => fs.rmSync(temp, { recursive:true, force:true }));
let n = 0;
const fresh = () => { const root = path.join(temp, String(++n)); fs.mkdirSync(root); return { root, store:new Store({ directory:path.join(root, "state") }) }; };
const write = (file, text = "Keep this unchanged.\n") => { fs.mkdirSync(path.dirname(file), { recursive:true }); fs.writeFileSync(file, text); };
function snapshot(root) {
  const out = [];
  const visit = rel => {
    const file = path.join(root, rel), stat = fs.lstatSync(file);
    out.push([rel, stat.isSymbolicLink() ? fs.readlinkSync(file) : stat.isDirectory() ? "directory" : stat.isSocket() ? "socket" : fs.readFileSync(file).toString("base64")]);
    if (stat.isDirectory()) for (const name of fs.readdirSync(file).sort()) visit(path.join(rel, name));
  };
  visit(""); return out;
}
function refuses(store, root, docsPath, code, codePath) {
  const before = snapshot(root), projects = JSON.stringify(store.projects);
  assert.throws(() => store.create({ name:"New project", docsPath, ...(codePath ? { codePath } : {}) }), { code, status:code === "BAD_FOLDER" ? 400 : 409 });
  assert.deepEqual(snapshot(root), before, "refusal must not create, move or rewrite files");
  assert.equal(JSON.stringify(store.projects), projects, "refusal must not change the registry");
}

test("new and existing empty docs folders work with an existing code repository", () => {
  const { root, store } = fresh(), code = path.join(root, "repo");
  write(path.join(code, "README.md")); write(path.join(code, "MEMORY.md"), "# Notes for my code\n");
  const before = fs.readFileSync(path.join(code, "README.md"), "utf8");
  const first = store.create({ name:"First", docsPath:path.join(code, "docs", "penecho"), codePath:code });
  assert.deepEqual(first.codePaths, [code]);
  assert.ok(fs.existsSync(path.join(first.docsPath, "lines")));
  const empty = path.join(root, "empty"), secondCode = path.join(root, "second-repo"); fs.mkdirSync(empty); write(path.join(secondCode, "README.md"));
  store.create({ name:"Second", docsPath:empty, codePath:secondCode });
  assert.equal(store.projects.length, 2);
  refuses(store, root, path.join(root, "conflicting-docs"), "CODE_FOLDER_IN_USE", code);
  assert.equal(fs.readFileSync(path.join(code, "README.md"), "utf8"), before);
});

test("nonempty docs, including hidden files and empty subfolders, are refused untouched", () => {
  for (const entry of ["notes.md", ".DS_Store", ".hidden", "subfolder/"]) {
    const { root, store } = fresh(), docs = path.join(root, "docs");
    if (entry.endsWith("/")) fs.mkdirSync(path.join(docs, entry), { recursive:true });
    else write(path.join(docs, entry));
    refuses(store, root, docs, "FOLDER_NOT_EMPTY");
  }
});

test("registered, nested, enclosing and archived docs roots are refused; prefix siblings work", () => {
  const { root, store } = fresh(), docs = path.join(root, "project");
  const project = store.create({ name:"Existing", docsPath:docs });
  refuses(store, root, docs, "PROJECT_EXISTS");
  fs.mkdirSync(path.join(docs, "empty"));
  refuses(store, root, path.join(docs, "empty"), "PROJECT_OVERLAP");
  refuses(store, root, path.join(docs, "new", "child"), "PROJECT_OVERLAP");
  refuses(store, root, root, "PROJECT_OVERLAP");
  store.update(project.id, { archived:true });
  refuses(store, root, path.join(docs, "new"), "PROJECT_OVERLAP");
  store.create({ name:"Sibling", docsPath:`${docs}-other` });
  // The registry reserves a temporarily missing project folder, too.
  fs.rmSync(docs, { recursive:true });
  refuses(store, root, path.join(docs, "new"), "PROJECT_OVERLAP");
  refuses(store, root, root, "PROJECT_OVERLAP");
});

test("symlink aliases and missing descendants cannot bypass project ownership", () => {
  const { root, store } = fresh(), docs = path.join(root, "project"), alias = path.join(root, "alias");
  store.create({ name:"Existing", docsPath:docs });
  fs.symlinkSync(docs, alias, "dir");
  refuses(store, root, alias, "PROJECT_EXISTS");
  refuses(store, root, path.join(alias, "not-yet", "child"), "PROJECT_OVERLAP");
  const outside = path.join(root, "outside"); fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(docs, "out"), "dir");
  refuses(store, root, path.join(docs, "out", "new"), "PROJECT_OVERLAP");
});

test("file paths, broken symlinks and file ancestors are refused before initialization", () => {
  const { root, store } = fresh(), file = path.join(root, "file"); write(file);
  refuses(store, root, file, "BAD_FOLDER");
  refuses(store, root, path.join(file, "child"), "BAD_FOLDER");
  const broken = path.join(root, "broken"); fs.symlinkSync(path.join(root, "gone"), broken, "dir");
  refuses(store, root, broken, "BAD_FOLDER");
  refuses(store, root, path.join(broken, "new"), "BAD_FOLDER");
});

test("case aliases are recognized on filesystems that support them", t => {
  const { root, store } = fresh(), docs = path.join(root, "CaseProject"), alias = path.join(root, "caseproject");
  store.create({ name:"Existing", docsPath:docs });
  if (!fs.existsSync(alias)) return t.skip("case-sensitive filesystem");
  refuses(store, root, alias, "PROJECT_EXISTS");
  refuses(store, root, path.join(alias, "new"), "PROJECT_OVERLAP");
});

test("unregistered current and legacy project ancestors are protected", () => {
  for (const legacy of [false, true]) {
    const { root, store } = fresh(), docs = path.join(root, "project");
    if (legacy) { write(path.join(docs, "MEMORY.md"), Memory.initialMemory("Old", "OL", 1)); fs.mkdirSync(path.join(docs, "topics")); }
    else write(path.join(docs, ".penecho/layout.json"), '{"version":2}');
    refuses(store, root, path.join(docs, "empty"), "PROJECT_OVERLAP");
    const elsewhere = path.join(root, "elsewhere"); fs.mkdirSync(elsewhere);
    fs.symlinkSync(elsewhere, path.join(docs, "out"), "dir");
    refuses(store, root, path.join(docs, "out", "new"), "PROJECT_OVERLAP");
  }
});

test("Open existing docs restores archived projects and deduplicates aliases", () => {
  const { root, store } = fresh(), docs = path.join(root, "project");
  const project = store.create({ name:"Original", docsPath:docs });
  write(path.join(docs, "lines/notes.md"), "# Keep my notes\n");
  store.update(project.id, { archived:true });
  const alias = path.join(root, "alias"); fs.symlinkSync(docs, alias, "dir");
  assert.equal(store.importFolder({ docsPath:alias }).id, project.id);
  assert.equal(project.archived, false);
  assert.equal(store.projects.length, 1);
  assert.equal(fs.readFileSync(path.join(docs, "lines/notes.md"), "utf8"), "# Keep my notes\n");
});

test("POST /projects enforces the rule even with caller-supplied bypass fields", async () => {
  const { root } = fresh();
  const api = createProjectLines({ directory:path.join(root, "state"), computerRounds:0,
    agents:{ available:() => [] }, serviceOptions:{ autoWatch:false, memory:{ home:path.join(root, "home"), env:{} } },
    authorizeRead:() => null, authorizeWrite:() => null, readJson:async req => req.body,
    send:(res, status, body) => { Object.assign(res, { status, body, headersSent:true }); } });
  try {
    const docs = path.join(root, "docs"); write(path.join(docs, "notes.md"));
    const before = snapshot(root), res = {};
    await api.handle({ method:"POST", body:{ name:"Do not adopt", docsPath:docs, allowNonempty:true, import:true, restore:true } }, res, new URL("http://localhost/api/lines/projects"));
    assert.equal(res.status, 409);
    assert.equal(res.body.code, "FOLDER_NOT_EMPTY");
    assert.match(res.body.error, /empty folder/);
    assert.deepEqual(snapshot(root), before);
    assert.equal(api.service.store.projects.length, 0);
  } finally { api.close(); }
});

test("Cloud copy checks the destination before downloading, and can restore a project without metadata", async () => {
  const { root, store } = fresh(), bytes = Buffer.from("A Cloud-only document.\n"), sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  let downloads = 0;
  const connector = {
    status:() => ({ accountSession:{ signedIn:true }, account:{ name:"Test" } }),
    cloudRequest:async () => ({ project:{ name:"From Cloud" }, rev:1, files:[{ path:"notes.md", sha256, size:bytes.length }] }),
    accountFetch:async () => { downloads++; return new Response(bytes); },
  };
  const cloud = createCloudShare({ store, connector });
  try {
    const docs = path.join(root, "existing"), project = store.create({ name:"Existing", docsPath:docs });
    const nonempty = path.join(root, "nonempty"); write(path.join(nonempty, "mine.txt"));
    for (const [folder, code] of [[docs, "PROJECT_EXISTS"], [path.join(docs, "child"), "PROJECT_OVERLAP"], [nonempty, "FOLDER_NOT_EMPTY"]]) {
      const before = snapshot(root);
      await assert.rejects(cloud.copyToComputer("cloud-project", { folder }), { code });
      assert.equal(downloads, 0, "unsafe destinations must never download files");
      assert.deepEqual(snapshot(root), before);
      assert.equal(store.projects.length, 1);
    }
    const copy = await cloud.copyToComputer("cloud-project", { folder:path.join(root, "safe") });
    assert.equal(copy.project.name, "From Cloud");
    assert.equal(copy.project.cloud.key, "cloud-project");
    assert.equal(fs.readFileSync(path.join(copy.project.docsPath, "notes.md"), "utf8"), bytes.toString());
    assert.equal(downloads, 1);
    // An unexpected import error must propagate, rather than falling through to adoption.
    store.importFolder = () => { throw Object.assign(new Error("Unreadable project"), { code:"EACCES" }); };
    await assert.rejects(cloud.copyToComputer("other-project", { folder:path.join(root, "other") }), { code:"EACCES" });
    assert.equal(store.projects.length, 2);
    assert.ok(store.projects.includes(project));
  } finally { cloud.close(); }
});

test("My Canvases can reopen its existing system folder after its registry entry is lost", () => {
  const { root } = fresh(), options = { directory:path.join(root, "state"), docsBase:path.join(root, "docs") };
  const first = new Store(options), mine = first.myCanvases();
  write(path.join(mine.docsPath, "files/my-drawing.txt"));
  first.projects = []; first.save();
  const reopened = new Store(options).myCanvases();
  assert.equal(reopened.myCanvases, true);
  assert.equal(fs.readFileSync(path.join(reopened.docsPath, "files/my-drawing.txt"), "utf8"), "Keep this unchanged.\n");
});
