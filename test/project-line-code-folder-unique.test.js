"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { test, after } = require("node:test");
const { parseHTML } = require("./helpers/dom.js");
const { Store } = require("../src/server/project-lines/store.js");
const { createProjectLines } = require("../src/server/project-lines/http.js");

const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penecho-code-unique-")));
after(() => fs.rmSync(temp, { recursive:true, force:true }));
let counter = 0;
function fresh() {
  const root = path.join(temp, String(++counter));
  fs.mkdirSync(root);
  return { root, store:new Store({ directory:path.join(root, "state") }) };
}
const folder = (root, name) => { const dir = path.join(root, name); fs.mkdirSync(dir, { recursive:true }); return dir; };
const write = (file, text = "Keep this unchanged.\n") => { fs.mkdirSync(path.dirname(file), { recursive:true }); fs.writeFileSync(file, text); };
function snapshot(root) {
  const out = [];
  const visit = rel => {
    const file = path.join(root, rel), stat = fs.lstatSync(file);
    out.push([rel, stat.isSymbolicLink() ? fs.readlinkSync(file) : stat.isDirectory() ? "directory" : stat.isSocket() ? "socket" : fs.readFileSync(file).toString("base64")]);
    if (stat.isDirectory()) for (const name of fs.readdirSync(file).sort()) visit(path.join(rel, name));
  };
  visit("");
  return out;
}
function makeApi(root) {
  return createProjectLines({
    directory:path.join(root, "state"), computerRounds:0,
    agents:{ available:() => [] },
    serviceOptions:{ autoWatch:false, conversations:{ home:path.join(root, "home"), env:{} }, memory:{ home:path.join(root, "memory-home"), env:{} } },
    authorizeRead:() => null, authorizeWrite:() => null, readJson:async req => req.body || {},
    send:(res, status, body) => { Object.assign(res, { status, body, headersSent:true }); },
  });
}
async function request(api, method, route, body) {
  const res = { headersSent:false, on() {}, destroy() { this.destroyed = true; } };
  const req = { method, body, headers:{}, socket:{ remoteAddress:"127.0.0.1" }, on() {} };
  await api.handle(req, res, new URL(`http://localhost/api/lines${route}`));
  return res;
}
function assertCreateRefusal(store, root, docsPath, codePath, owner) {
  const before = snapshot(root), projects = JSON.stringify(store.projects);
  assert.throws(() => store.create({ name:"Duplicate", docsPath, codePath }), error => {
    assert.equal(error.code, "CODE_FOLDER_IN_USE");
    assert.equal(error.status, 409);
    assert.deepEqual(error.conflict, { id:owner.id, name:owner.name, archived:Boolean(owner.archived) });
    assert.match(error.message, owner.archived ? /archived project/ : /Open that project instead/);
    return true;
  });
  assert.deepEqual(snapshot(root), before, "a refused project must leave the filesystem untouched");
  assert.equal(JSON.stringify(store.projects), projects, "a refused project must leave the registry untouched");
}

test("Store.create refuses exact, trailing-slash, symlink and archived ownership without writes", () => {
  for (const kind of ["exact", "trailing slash", "symlink alias", "archived owner"]) {
    const { root, store } = fresh(), code = folder(root, "repo");
    const owner = store.create({ name:"Owner", docsPath:path.join(root, "owner-docs"), codePath:code });
    if (kind === "archived owner") store.update(owner.id, { archived:true });
    let candidate = code;
    if (kind === "trailing slash") candidate += path.sep;
    if (kind === "symlink alias") { candidate = path.join(root, "repo-alias"); fs.symlinkSync(code, candidate, "dir"); }
    assertCreateRefusal(store, root, path.join(root, "new-docs"), candidate, owner);
  }
});

test("Store.create recognizes a case alias on a case-insensitive filesystem", t => {
  const { root, store } = fresh(), code = folder(root, "Repo"), alias = path.join(root, "repo");
  const owner = store.create({ name:"Owner", docsPath:path.join(root, "owner-docs"), codePath:code });
  if (!fs.existsSync(alias)) return t.skip("case-sensitive filesystem");
  assertCreateRefusal(store, root, path.join(root, "new-docs"), alias, owner);
});

test("Store.update refuses duplicates before mutation and allows clearing, keeping and reusing folders", () => {
  const { root, store } = fresh(), firstCode = folder(root, "first-code"), secondCode = folder(root, "second-code");
  const owner = store.create({ name:"Owner", docsPath:path.join(root, "owner-docs"), codePath:firstCode });
  const target = store.create({ name:"Target", docsPath:path.join(root, "target-docs"), codePath:secondCode });
  const duplicate = archived => {
    const registry = fs.readFileSync(store.file, "utf8");
    assert.throws(() => store.update(target.id, { name:"Must not stick", codePath:firstCode }), error => {
      assert.equal(error.code, "CODE_FOLDER_IN_USE");
      assert.equal(error.status, 409);
      assert.deepEqual(error.conflict, { id:owner.id, name:"Owner", archived });
      return true;
    });
    assert.equal(target.name, "Target");
    assert.deepEqual(target.codePaths, [secondCode]);
    assert.equal(fs.readFileSync(store.file, "utf8"), registry);
  };
  duplicate(false);
  store.update(owner.id, { archived:true });
  duplicate(true);
  assert.throws(() => store.update(target.id, { codePath:target.docsPath }), { code:"BAD_FOLDER", status:400 });
  assert.equal(target.name, "Target");
  store.update(target.id, { codePath:`${secondCode}${path.sep}` });
  assert.deepEqual(target.codePaths, [secondCode], "keeping the project's own folder is allowed");
  store.update(target.id, { codePath:"" });
  assert.deepEqual(target.codePaths, []);
  store.update(target.id, { codePath:secondCode });
  store.update(target.id, { codePath:null });
  assert.deepEqual(target.codePaths, []);
  store.update(target.id, { codePath:secondCode });
  assert.throws(() => store.update(target.id, { docsPath:secondCode }), { code:"BAD_FOLDER", status:400 });
  store.update(owner.id, { codePath:"" });
  store.update(target.id, { codePath:firstCode });
  assert.deepEqual(target.codePaths, [firstCode], "unlinking the old owner frees its folder");
  store.forget(target.id);
  store.update(owner.id, { codePath:firstCode });
  assert.deepEqual(owner.codePaths, [firstCode], "deleting the old owner also frees its folder");
});

test("importFolder skips a conflicting README or Line code folder and exposes transient conflict info", () => {
  for (const source of ["README.md", "Lines front matter"]) {
    const { root, store } = fresh(), code = folder(root, "repo"), docs = folder(root, "imported-docs");
    const owner = store.create({ name:"Owner", docsPath:path.join(root, "owner-docs"), codePath:code });
    store.update(owner.id, { archived:true });
    if (source === "README.md") write(path.join(docs, "README.md"), `---\nproject: Imported\ncode: ${code}\n---\n`);
    else {
      write(path.join(docs, "README.md"), "---\nproject: Imported\ncode: none\n---\n");
      write(path.join(docs, "lines", "one.md"), `---\nid: IM-1\ncode: ${code}\n---\n\n# One\n`);
    }
    const imported = store.importFolder({ docsPath:docs });
    assert.deepEqual(imported.codePaths, []);
    assert.deepEqual(store.importCodeConflict(imported), { path:code, id:owner.id, name:"Owner", archived:true });
    assert.equal(store.importCodeConflict(imported), null, "the import notice is consumed once");
    const saved = JSON.parse(fs.readFileSync(store.file, "utf8")).projects.find(p => p.id === imported.id);
    assert.deepEqual(saved.codePaths, []);
    assert.equal(saved.codeConflict, undefined);
    assert.equal(Object.hasOwn(imported, "codeConflict"), false);
  }
});

test("POST /projects/import opens docs without a conflicting code folder and returns codeConflict", async t => {
  const { root, store } = fresh(), code = folder(root, "repo"), docs = folder(root, "imported-docs");
  const owner = store.create({ name:"Owner", docsPath:path.join(root, "owner-docs"), codePath:code });
  store.update(owner.id, { archived:true });
  write(path.join(docs, "README.md"), `---\nproject: Imported\ncode: ${code}\n---\n`);
  const api = makeApi(root);
  t.after(() => api.close());
  const res = await request(api, "POST", "/projects/import", { docsPath:docs });
  assert.equal(res.status, 200);
  assert.equal(res.body.project.name, "Imported");
  assert.equal(res.body.project.code, "");
  assert.deepEqual(res.body.codeConflict, { path:code, id:owner.id, name:"Owner", archived:true });
  const saved = JSON.parse(fs.readFileSync(api.service.store.file, "utf8"));
  assert.equal(saved.projects.length, 2);
  assert.ok(saved.projects.every(p => p.codeConflict === undefined));
  assert.deepEqual(api.service.store.get(res.body.project.id).codePaths, []);
});

test("HTTP POST and PATCH return 409 with structured owner metadata", async t => {
  const { root, store } = fresh(), code = folder(root, "repo");
  const owner = store.create({ name:"Owner", docsPath:path.join(root, "owner-docs"), codePath:code });
  const api = makeApi(root);
  t.after(() => api.close());
  const newDocs = path.join(root, "new-docs");
  const posted = await request(api, "POST", "/projects", { name:"Duplicate", docsPath:newDocs, codePath:code });
  for (const res of [posted]) {
    assert.equal(res.status, 409);
    assert.equal(res.body.code, "CODE_FOLDER_IN_USE");
    assert.match(res.body.error, /already used by the project “Owner”/);
    assert.deepEqual(res.body.conflict, { id:owner.id, name:"Owner", archived:false });
  }
  assert.equal(api.service.store.projects.length, 1);
  assert.equal(fs.existsSync(newDocs), false);
  const target = api.service.store.create({ name:"Target", docsPath:path.join(root, "target-docs") });
  const patched = await request(api, "PATCH", `/projects/${target.id}`, { codePath:code });
  assert.equal(patched.status, 409);
  assert.equal(patched.body.code, "CODE_FOLDER_IN_USE");
  assert.match(patched.body.error, /already used by the project “Owner”/);
  assert.deepEqual(patched.body.conflict, { id:owner.id, name:"Owner", archived:false });
  assert.deepEqual(target.codePaths, []);
});

test("legacy shared folders load, surface codeConflict, change rev when resolved, and remain editable", async t => {
  const { root, store } = fresh(), code = folder(root, "repo");
  const first = store.create({ name:"First", docsPath:path.join(root, "first-docs"), codePath:code });
  const second = store.create({ name:"Second", docsPath:path.join(root, "second-docs") });
  second.codePaths = [code];
  store.save();
  const api = makeApi(root);
  t.after(() => api.close());
  const currentFirst = api.service.store.get(first.id), currentSecond = api.service.store.get(second.id);
  api.service.store.update(currentFirst.id, { archived:true });
  const secondState = api.service.stateOf(currentSecond);
  assert.deepEqual(secondState.project.codeConflict, { id:first.id, name:"First", archived:true });
  assert.deepEqual(api.service.stateOf(currentFirst).project.codeConflict, { id:second.id, name:"Second", archived:false });
  api.service.store.update(currentFirst.id, { codePath:"" });
  api.service.changed();
  const resolved = api.service.stateOf(currentSecond);
  assert.equal(resolved.project.codeConflict, undefined);
  assert.notEqual(resolved.rev, secondState.rev);
  api.service.store.update(currentSecond.id, { name:"Renamed" });
  assert.equal(currentSecond.name, "Renamed");
  api.service.store.update(currentSecond.id, { archived:true });
  assert.equal(currentSecond.archived, true);
  api.service.store.update(currentSecond.id, { codePath:"" });
  assert.deepEqual(currentSecond.codePaths, []);
  api.service.store.forget(currentSecond.id);
  api.service.store.forget(currentFirst.id);
  assert.equal(api.service.store.projects.length, 0);
});

test("missing and broken code folders on other projects never break ownership validation", () => {
  const { root, store } = fresh(), healthy = folder(root, "healthy");
  const missing = store.create({ name:"Missing", docsPath:path.join(root, "missing-docs") });
  missing.codePaths = [path.join(root, "not-here")];
  const broken = store.create({ name:"Broken", docsPath:path.join(root, "broken-docs") });
  const alias = path.join(root, "broken-alias");
  fs.symlinkSync(path.join(root, "missing-target"), alias, "dir");
  broken.codePaths = [alias, path.join(root, "plain-file", "child")];
  write(path.join(root, "plain-file"));
  assert.equal(store.codeOwner(healthy), null);
  assert.equal(store.checkCodeFolder(healthy), healthy);
  assert.deepEqual(store.create({ name:"Healthy", docsPath:path.join(root, "healthy-docs"), codePath:healthy }).codePaths, [healthy]);
});

test("nonexistent case aliases still conflict on macOS and Windows", t => {
  if (!["darwin", "win32"].includes(process.platform)) return t.skip("case-insensitive platform required");
  const { root, store } = fresh();
  folder(root, "Missing");
  const owner = store.create({ name:"Owner", docsPath:path.join(root, "owner-docs") });
  owner.codePaths = [path.join(root, "Missing", "Repo")];
  assert.equal(store.codeOwner(path.join(root, "missing", "repo"))?.id, owner.id);
  assert.throws(() => store.checkCodeFolder(path.join(root, "missing", "repo")), { code:"CODE_FOLDER_IN_USE", status:409 });
});

const startSource = fs.readFileSync(path.join(__dirname, "../public/lines/start.js"), "utf8");
const pagesSource = fs.readFileSync(path.join(__dirname, "../public/lines/pages.js"), "utf8");
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
function startHarness({ lang = "en", projects = [], respond, onCreated, navigator = { platform:"MacIntel", userAgent:"Mac" } } = {}) {
  const { document, window } = parseHTML("<html><body><div id=\"host\"></div></body></html>"), calls = [], stored = new Map(), navigated = [];
  Object.defineProperty(window.HTMLElement.prototype, "elements", { configurable:true, get() {
    if (this.tagName !== "FORM") return undefined;
    const fields = [...this.querySelectorAll("input, button, select, textarea")];
    for (const field of fields) if (field.name) fields[field.name] = field;
    return fields;
  } });
  const context = vm.createContext({
    window, document, navigator,
    fetch:async (url, options = {}) => {
      calls.push({ url, options });
      const result = respond?.(url, options) || { status:200, body:{} };
      return { ok:result.status >= 200 && result.status < 300, status:result.status, json:async () => result.body };
    },
    matchMedia:() => ({ matches:true }),
    sessionStorage:{ setItem(k, v) { stored.set(k, v); }, getItem(k) { return stored.has(k) ? stored.get(k) : null; }, removeItem(k) { stored.delete(k); } },
    location:{ assign(url) { navigated.push(url); }, set href(url) { navigated.push(url); } },
    FormData:window.FormData, Event:window.Event, setTimeout, clearTimeout,
  });
  vm.runInContext(startSource, context);
  const host = document.querySelector("#host");
  window.PenEchoProjects.mount(host, { lang, projects, agents:[], showExamples:false, showTitle:false, showBenefits:false, onCreated });
  return { document, window, context, host, calls, stored, navigated, projects:window.PenEchoProjects };
}

test("New project shows a live normalized-path hint and marks only the code input on a 409", async () => {
  const owner = { id:"old", name:"Old project", archived:true, code:"/Users/test/work/Repo", docsPath:"/Users/test/Documents/PenEcho/Old", docsParent:"/Users/test/Documents/PenEcho" };
  const serverMessage = "This code folder is already used by the archived project “Old project”.";
  const h = startHarness({ projects:[owner], respond:(url, options) => {
    if (url.endsWith("/projects") && options.method === "POST") return { status:409, body:{ error:serverMessage, code:"CODE_FOLDER_IN_USE", conflict:{ id:"old", name:"Old project", archived:true } } };
  } });
  const code = h.document.querySelector('[name="code"]'), docs = h.document.querySelector('[name="docs"]'), hint = h.document.querySelector(".pls-code-privacy");
  const docsDesc = h.document.querySelector(".pls-docs-desc"), codeDesc = h.document.querySelector(".pls-code-desc");
  assert.match(docsDesc.textContent, /Lines.*Markdown \(\.md\) files.*read anywhere.*lifecycles/i);
  assert.match(codeDesc.textContent, /source code or repository folder/i);
  assert.deepEqual(docs.getAttribute("aria-describedby").split(/\s+/), [docsDesc.id, h.document.querySelector(".pls-folder-rule").id]);
  assert.deepEqual(code.getAttribute("aria-describedby").split(/\s+/), [codeDesc.id, hint.id]);
  h.document.querySelector('[name="name"]').value = "Fresh";
  code.value = "~/WORK/repo/";
  code.dispatchEvent(new h.window.Event("input", { bubbles:true }));
  assert.match(hint.textContent, /archived project “Old project”/);
  assert.equal(hint.classList.contains("is-conflict"), true);
  code.value = "/Users/test/work/unused";
  code.dispatchEvent(new h.window.Event("input", { bubbles:true }));
  assert.equal(hint.textContent, "Kept separate from your Docs folder—your code stays on the computer running PenEcho.");
  assert.equal(hint.classList.contains("is-conflict"), false);
  code.value = "~/work/Repo";
  code.dispatchEvent(new h.window.Event("input", { bubbles:true }));
  h.document.querySelector(".pls-form").dispatchEvent(new h.window.Event("submit", { bubbles:true, cancelable:true }));
  await settle();
  assert.equal(code.getAttribute("aria-invalid"), "true");
  assert.equal(docs.getAttribute("aria-invalid"), null);
  assert.equal(h.document.querySelector(".pls-error").textContent, serverMessage);
  code.value = "/Users/test/work/new";
  code.dispatchEvent(new h.window.Event("input", { bubbles:true }));
  assert.equal(code.getAttribute("aria-invalid"), null);
  assert.equal(h.document.querySelector(".pls-error").hidden, true);
});

test("New project localizes a Chinese 409 with the archived owner's name", async () => {
  const owner = { id:"old", name:"旧项目", archived:true, code:"/Users/test/work/repo", docsPath:"/Users/test/Documents/PenEcho/Old", docsParent:"/Users/test/Documents/PenEcho" };
  const h = startHarness({ lang:"zh", projects:[owner], respond:url => url.endsWith("/projects") ? { status:409, body:{ error:"English server text", code:"CODE_FOLDER_IN_USE", conflict:{ id:"old", name:"旧项目", archived:true } } } : undefined });
  assert.match(h.document.querySelector(".pls-docs-desc").textContent, /Line.*Markdown.*生命周期/);
  assert.match(h.document.querySelector(".pls-code-desc").textContent, /源代码或仓库文件夹/);
  h.document.querySelector('[name="name"]').value = "新项目";
  const code = h.document.querySelector('[name="code"]');
  code.value = owner.code;
  code.dispatchEvent(new h.window.Event("input", { bubbles:true }));
  h.document.querySelector(".pls-form").dispatchEvent(new h.window.Event("submit", { bubbles:true, cancelable:true }));
  await settle();
  assert.match(h.document.querySelector(".pls-error").textContent, /归档项目“旧项目”/);
  assert.match(h.document.querySelector(".pls-error").textContent, /设置 › 已归档/);
  assert.equal(code.getAttribute("aria-invalid"), "true");
  assert.equal(h.document.querySelector('[name="docs"]').getAttribute("aria-invalid"), null);
});

test("New project passes an import codeConflict to onCreated", async () => {
  let created = null;
  const conflict = { path:"/Users/test/work/repo", id:"old", name:"Old project", archived:false };
  const h = startHarness({ onCreated:(project, extra) => { created = { project, extra }; }, respond:url => {
    if (url.endsWith("/pick-folder")) return { status:200, body:{ path:"/Users/test/Documents/Imported" } };
    if (url.endsWith("/projects/import")) return { status:200, body:{ project:{ id:"imported", name:"Imported" }, codeConflict:conflict } };
  } });
  h.document.querySelector("[data-import]").dispatchEvent(new h.window.Event("click", { bubbles:true }));
  await settle();
  assert.equal(created.project.id, "imported");
  assert.equal(created.extra.codeConflict.path, conflict.path);
  assert.equal(created.extra.codeConflict.name, "Old project");
});

test("whereRow names the other project for a legacy shared code folder", () => {
  const start = pagesSource.indexOf("const folderOpens"), end = pagesSource.indexOf("const modelExplainerHTML", start);
  const context = vm.createContext({ S:{ thisComputer:false, openFolderLabel:"" }, esc:value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c])), ic:() => "", p:{
    vault:{ path:"/docs/here", code:[{ path:"/code/shared" }] }, codeConflict:{ id:"other", name:"PenEcho", archived:true },
  } });
  vm.runInContext(`${pagesSource.slice(start, end)}\nthis.out = whereRow(p);`, context);
  assert.match(context.out, /Already used by “PenEcho” \(archived\) — conversations synced there won't sync here\./);
  assert.match(context.out, /class="where-hint code-conflict"/);
});

test("pathForm shows a live code-folder hint and keeps the server's 409 in #pathError", async () => {
  const { document, window } = parseHTML("<html><body><div id=\"lightbox\" hidden></div></body></html>");
  window.HTMLElement.prototype.select = function () {};
  const start = startHarness(), projects = [
    { id:"self", name:"Current", code:"/Users/test/work/current", docsParent:"/Users/test/Documents/PenEcho" },
    { id:"old", name:"Old project", archived:true, code:"/Users/test/work/Repo", docsParent:"/Users/test/Documents/PenEcho" },
  ];
  const context = vm.createContext({
    document, window, S:{ cur:"self", projects }, PenEchoProjects:start.projects,
    $:selector => document.querySelector(selector), esc:value => String(value ?? ""), ic:() => "", closeLightbox() {},
    onSave:async () => { throw Object.assign(new Error("Server says the folder is used."), { code:"CODE_FOLDER_IN_USE" }); },
  });
  const begin = pagesSource.indexOf("function pathForm("), end = pagesSource.indexOf("async function patchProject", begin);
  vm.runInContext(`${pagesSource.slice(begin, end)}\npathForm({ title:'Code folder', label:'Code', value:'', pick:'Choose', code:true, onSave });`, context);
  const input = document.querySelector("#pathInput"), hint = document.querySelector("#pathCodeHint");
  input.value = "~/WORK/repo/";
  input.dispatchEvent(new window.Event("input", { bubbles:true }));
  assert.equal(hint.hidden, false);
  assert.match(hint.textContent, /archived project “Old project”/);
  input.value = "/Users/test/work/current";
  input.dispatchEvent(new window.Event("input", { bubbles:true }));
  assert.equal(hint.hidden, true, "the current project's own folder is not a conflict");
  input.value = "~/work/Repo";
  input.dispatchEvent(new window.Event("input", { bubbles:true }));
  document.querySelector("#pathForm").dispatchEvent(new window.Event("submit", { bubbles:true, cancelable:true }));
  await settle();
  const error = document.querySelector("#pathError");
  assert.equal(error.hidden, false);
  assert.equal(error.textContent, "Server says the folder is used.");
  assert.equal(input.getAttribute("aria-invalid"), "true");
});

test("openMade explains when import skipped an already-used code folder", async () => {
  const toasts = [], context = vm.createContext({
    loadProjects:async () => {}, switchProject:async () => {}, syncIfNew() {}, toast:text => toasts.push(text),
  });
  const start = pagesSource.indexOf("function toastCodeConflict("), end = pagesSource.indexOf("// The third way", start);
  vm.runInContext(pagesSource.slice(start, end), context);
  await context.openMade({ id:"imported" }, { codeConflict:{ path:"/code/shared", id:"old", name:"Old project", archived:true } });
  assert.equal(toasts.length, 1);
  assert.match(toasts[0], /opened without linking \/code\/shared/);
  assert.match(toasts[0], /archived project “Old project”/);
});

test("dangling symlink or file-replaced docs path on another project never blocks create or import", () => {
  const { root, store } = fresh();
  const wrap = folder(root, "wrap");
  const brokenDocs = path.join(wrap, "broken-docs");
  const fileDocs = path.join(root, "file-docs");
  const goodA = store.create({ name:"BrokenA", docsPath:brokenDocs });
  const goodB = store.create({ name:"FileB", docsPath:fileDocs });
  // Turn A's docsPath into a dangling symlink and B's docsPath into a regular file.
  fs.rmSync(brokenDocs, { recursive:true, force:true });
  fs.symlinkSync(path.join(root, "nowhere"), brokenDocs, "dir");
  fs.rmSync(fileDocs, { recursive:true, force:true });
  fs.writeFileSync(fileDocs, "replaced by file\n");
  // Healthy create and import still succeed.
  const created = store.create({ name:"Healthy", docsPath:path.join(root, "healthy-docs") });
  assert.equal(created.name, "Healthy");
  const toImport = folder(root, "import-docs");
  write(path.join(toImport, "README.md"), "---\nproject: Imported\n---\n");
  const imported = store.importFolder({ docsPath:toImport });
  assert.equal(imported.name, "Imported");
  // Enclosing lexical overlap with the broken project is still refused as PROJECT_OVERLAP.
  assert.throws(() => store.create({ name:"Overlap", docsPath:wrap }), { code:"PROJECT_OVERLAP", status:409 });
  assert.ok(goodA && goodB);
});

test("standalone import without onCreated opens the project and stores the codeConflict notice", async () => {
  const conflict = { path:"/Users/test/work/repo", id:"old", name:"Old project", archived:false };
  const h = startHarness({ respond:url => {
    if (url.endsWith("/pick-folder")) return { status:200, body:{ path:"/Users/test/Documents/Imported" } };
    if (url.endsWith("/projects/import")) return { status:200, body:{ project:{ id:"imported", name:"Imported" }, codeConflict:conflict } };
  } });
  h.document.querySelector("[data-import]").dispatchEvent(new h.window.Event("click", { bubbles:true }));
  await settle();
  assert.equal(h.navigated.length, 1, "standalone import still opens the imported project");
  assert.match(h.navigated[0], /#imported/);
  const saved = JSON.parse(h.stored.get("penecho-lines-import-conflict") || "null");
  assert.equal(saved?.projectId, "imported");
  assert.equal(saved?.id, "old");
  assert.equal(saved?.name, "Old project");
  assert.equal(saved?.path, conflict.path);
});

test("a Mac browser talking to a case-sensitive Linux host does not falsely fold path case", () => {
  const linuxOwner = { id:"linux-1", name:"LinuxApp", archived:false, code:"/home/alice/work/App", docsPath:"/home/alice/Documents/PenEcho/LinuxApp", docsParent:"/home/alice/Documents/PenEcho" };
  const h = startHarness({ projects:[linuxOwner], navigator:{ platform:"MacIntel", userAgent:"Macintosh" } });
  // Even before useBase supplies caseInsensitive:false, /home/ host paths stay case-sensitive.
  assert.equal(h.projects.codeFolderOwner("/home/alice/work/app", [linuxOwner]), null);
  assert.equal(h.projects.codeFolderOwner("/home/alice/work/App", [linuxOwner])?.id, "linux-1");
  // Authoritative host caseInsensitive:false overrides browser platform even for non-/home/ paths.
  h.projects.useBase("/srv/docs", { caseInsensitive:false });
  const srvOwner = { id:"srv-1", name:"SrvApp", code:"/srv/Code/Repo", docsPath:"/srv/docs/SrvApp", docsParent:"/srv/docs" };
  assert.equal(h.projects.codeFolderOwner("/srv/code/repo", [srvOwner]), null);
  assert.equal(h.projects.codeFolderOwner("/srv/Code/Repo/", [srvOwner])?.id, "srv-1");
});
