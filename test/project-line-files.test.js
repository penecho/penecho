"use strict";
require("./helpers/safety.js");
// Canvases & files (N3): the state gives each file of a project its kind, the line and step that hold it and who made it,
// counts a picture kept as .png and .webp once, and lists the Claude Artifacts the lines link to.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { test, after } = require("node:test");
const { Service } = require("../src/server/project-lines/service.js");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { shelfOf, kindByName, latestFilesOf, pathsIn } = require("../src/server/project-lines/project-files.js");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-line-files-"));
const services = [];
after(() => { for (const s of services) s.close?.(); fs.rmSync(temp, { recursive:true, force:true }); });
const write = (root, rel, text = "x") => { const file = path.join(root, rel); fs.mkdirSync(path.dirname(file), { recursive:true }); fs.writeFileSync(file, text); };
const PNG = Buffer.from("\x89PNG\r\n\x1a\nfake", "latin1");

function makeProject() {
  const directory = path.join(temp, `state-${services.length}`), docs = path.join(temp, `docs-${services.length}`);
  fs.mkdirSync(directory, { recursive:true });
  const service = new Service({ directory, agents:createAgents({ env:{ PATH:"" } }), autoWatch:false });
  services.push(service);
  const project = service.store.create({ name:"Garden", docsPath:docs });
  return { service, project, docs };
}

test("kinds by name", () => {
  const cases = { "files/a/x.penecho.json":"canvas", "files/a/deck.slide-01.html":"slides", "files/a/p.explorer.html":"page", "files/a/i.png":"picture", "files/a/i.SVG":"picture",
    "files/a/d.pptx":"slides", "files/a/k.key":"slides", "files/a/n.md":"document", "files/a/n.pdf":"document", "files/a/n.docx":"document", "files/a/t.txt":"document",
    "files/a/s.xlsx":"data", "files/a/s.csv":"data", "files/a/v.mp4":"media", "files/a/v.m4a":"media", "files/a/c.py":null, "files/a/z.zip":null, "files/a/m.diagram.json":null };
  for (const [file, kind] of Object.entries(cases)) assert.equal(kindByName(file), kind, file);
});

test("each file gets its kind, line, step and maker; a png and webp pair counts once; Artifacts are found in a line", () => {
  const { service, project, docs } = makeProject();
  // A line: your Ask with a pasted picture (kept as .png and .webp), a Work by Claude that drew a Canvas, wrote a page and a deck, linked a report and an Artifact.
  write(docs, "lines/garden.md", `---
id: G-1
status: done
who: @claude
created: 2026-11-10 09:00
---

# Plan the garden

## Ask · 2026-11-10 09:00

Plan the beds.

![picture.png](../files/garden/picture.png)

## [x] Work 1 · @claude · 3 min

The plan is on the Canvas, and on a design canvas: [Garden beds design](https://claude.ai/artifact/AbCdEf123456).

![Garden beds](../files/garden/beds.png)

[Details](garden/work-1.md)

## Note · 2026-11-10 10:00

See also https://claude.ai/code/artifact/ZyXwVu987654 for the old one.
`);
  write(docs, "works/garden/work-1.md", `---
line: ../garden.md
step: Work 1
who: @claude
started: 2026-11-10 09:01
took: 3 min
---

# Work 1: Plan the garden

## Result

The report is [here](../../files/garden/report.md), the costs in [costs](../../files/garden/costs.xlsx).
`);
  fs.mkdirSync(path.join(docs, "files/garden"), { recursive:true });
  for (const name of ["picture.png", "picture.webp", "beds.png", "loose-photo.jpg"]) fs.writeFileSync(path.join(docs, "files/garden", name), PNG);
  write(docs, "files/garden/beds.penecho.json", JSON.stringify({ assets:[], manifest:{} }));
  write(docs, "files/garden/beds.explorer.html", "<html></html>");
  write(docs, "files/garden/report.md", "# Report");
  write(docs, "files/garden/costs.xlsx", "x");
  write(docs, "files/garden/talk.slide-01.html", "<div data-penecho-slide></div>");
  write(docs, "files/garden/talk.slide-02.html", "<div data-penecho-slide></div>");
  write(docs, "files/garden/helper.py", "print(1)");
  write(docs, "files/garden/app.dmg", "123456789");
  write(docs, "files/garden/beds.diagram.json", "{}");
  write(docs, "files/garden/proto/index.html", "<html></html>");
  write(docs, "files/garden/proto/shot.png", "x");
  write(docs, "files/garden/merge-arrow.svg", "<svg/>");
  // A Canvas of your own on no line, and a file outside every line's folder.
  write(docs, "files/canvases/sketch/canvas.penecho.json", JSON.stringify({ assets:[], manifest:{} }));
  write(docs, "files/notes.txt", "notes");

  const state = service.stateOf(project), byPath = Object.fromEntries(state.files.filter(f => f.kind).map(f => [f.path, f]));
  const pick = file => { const f = byPath[file]; return f && { kind:f.kind, line:f.line, step:f.step, by:f.by, ...(f.title ? { title:f.title } : {}), ...(f.folder ? { folder:true } : {}) }; };

  assert.deepEqual(pick("files/garden/picture.png"), { kind:"picture", line:"garden", step:"ask-1", by:"you" });
  assert.equal(byPath["files/garden/picture.webp"], undefined, "the .webp copy of a picture counts once");
  assert.deepEqual(pick("files/garden/beds.penecho.json"), { kind:"canvas", line:"garden", step:"work-1", by:"claude" });
  assert.equal(byPath["files/garden/beds.png"], undefined, "a Canvas's own picture is the Canvas");
  assert.deepEqual(pick("files/garden/beds.explorer.html"), { kind:"page", line:"garden", step:"", by:"claude" });
  assert.deepEqual(pick("files/garden/report.md"), { kind:"document", line:"garden", step:"work-1", by:"claude" }, "a link in a Work's result");
  assert.deepEqual(pick("files/garden/costs.xlsx"), { kind:"data", line:"garden", step:"work-1", by:"claude" });
  assert.deepEqual(pick("files/garden/talk.slide-01.html"), { kind:"slides", line:"garden", step:"", by:"claude", title:"talk" }, "a deck of slide pages is one card");
  assert.equal(byPath["files/garden/talk.slide-02.html"], undefined);
  assert.deepEqual(pick("files/garden/proto/index.html"), { kind:"page", line:"garden", step:"", by:"claude", title:"proto", folder:true }, "a folder with index.html is one page");
  assert.equal(byPath["files/garden/proto/shot.png"], undefined, "what is inside a page folder is part of that page");
  assert.deepEqual(pick("files/garden/helper.py"), { kind:"file", line:"garden", step:"", by:"claude" }, "a file of any other kind is listed, so it can be deleted");
  assert.deepEqual(pick("files/garden/app.dmg"), { kind:"file", line:"garden", step:"", by:"claude" });
  assert.equal(byPath["files/garden/app.dmg"].size, 9, "with its size, for the size filter");
  assert.equal(byPath["files/garden/beds.diagram.json"], undefined, "a Canvas's own source goes with the Canvas's card");
  assert.equal(byPath["files/garden/merge-arrow.svg"], undefined);
  assert.deepEqual(pick("files/garden/loose-photo.jpg"), { kind:"picture", line:"garden", step:"", by:"claude" });
  assert.deepEqual(pick("files/canvases/sketch/canvas.penecho.json"), { kind:"canvas", line:"", step:"", by:"you" });
  assert.deepEqual(pick("files/notes.txt"), { kind:"document", line:"", step:"", by:"you" });

  assert.deepEqual(state.artifacts.map(a => ({ path:a.path, id:a.id, kind:a.kind, title:a.title, line:a.line, step:a.step, by:a.by })).sort((a, b) => a.id.localeCompare(b.id)), [
    { path:"https://claude.ai/artifact/AbCdEf123456", id:"AbCdEf123456", kind:"artifact", title:"Garden beds design", line:"garden", step:"work-1", by:"claude" },
    { path:"https://claude.ai/code/artifact/ZyXwVu987654", id:"ZyXwVu987654", kind:"artifact", title:"Claude Artifact", line:"garden", step:"note-1", by:"you" },
  ]);
  // The Home's lighter state leaves the file list and the Artifacts out.
  const home = service.stateFor(project, "home");
  assert.equal(home.files, undefined);
  assert.equal(home.artifacts, undefined);
  assert.equal(home.filesShown, state.files.filter(f => f.kind).length + state.artifacts.length, "only the count of what Canvases & files shows");
  assert.deepEqual(home.latestFiles, state.latestFiles, "Home and the full state agree on the newest visual files");
  assert.ok(home.latestFiles.length <= 3);
  assert.equal(service.stateFor(project, "rail").latestFiles, undefined, "the rail does not need file previews");
});

test("Home's bounded latest files use actual file dates and canonical origins, omitting duplicate and internal images", () => {
  const files = [
    { path:"files/shared/native.penecho.json", mtime:50 },
    { path:"files/shared/native.png", mtime:100 },
    { path:"files/missing/native.penecho.json", mtime:200 },
    { path:"files/loose.jpg", mtime:40 },
    { path:"files/shared/a.png", mtime:20 },
    { path:"files/shared/a.webp", mtime:90 },
    { path:"files/shared/b.png", mtime:20 },
    { path:"files/site/index.html", mtime:10 },
    { path:"files/site/internal.png", mtime:300 },
    { path:"files/_incoming/picture.png", mtime:400 },
  ];
  const pictures = [
    { source:"files/shared/native.penecho.json", path:"files/shared/native.png", title:"Native drawing", mtime:50, hasPicture:true },
    { source:"files/missing/native.penecho.json", path:"files/missing/native.png", title:"No preview", mtime:200, hasPicture:false },
  ];
  const lines = [{ slug:"origin", stations:[{ id:"ask-1", kind:"ask", pictures:[{ path:"files/shared/native.png" }, { path:"files/shared/a.png" }], files:[] }] }];
  const shelf = shelfOf({ files, pictures, lines });
  const classified = files.map(f => ({ ...f, ...shelf.files.get(f.path) }));
  const latest = latestFilesOf(classified, pictures);
  assert.deepEqual(latest.map(f => f.path), ["files/shared/native.png", "files/loose.jpg", "files/shared/a.png"]);
  assert.deepEqual(latest.map(f => f.topic), ["origin", "", "origin"], "line ownership follows its mention even outside the line's folder");
  assert.equal(latest[0].mtime, 50, "regenerating a Canvas preview does not make the source newer");
  assert.equal(latest[0].kind, "canvas");
  assert.equal(latest[0].source, "files/shared/native.penecho.json");
  assert.equal(latest[1].kind, "image", "an unreferenced picture can be among the newest files");
  assert.deepEqual(latestFilesOf([...classified].reverse(), [...pictures].reverse()), latest, "equal dates have a stable path order");
  assert.deepEqual(latestFilesOf([], []), []);
});

test("a meeting's minutes on a line are a meeting", () => {
  const lines = [{ slug:"standup", title:"Standup", agent:"", stations:[{ id:"meeting-1", kind:"meeting", agent:"you", text:"**Weekly sync** · 2026-11-10 10:00 · 30 min\n\nWe agreed.", files:[{ path:"files/standup/minutes.md" }], pictures:[] }] }];
  const { files } = shelfOf({ files:[{ path:"files/standup/minutes.md", mtime:1, size:1 }], lines });
  assert.deepEqual(files.get("files/standup/minutes.md"), { kind:"meeting", title:"Weekly sync", line:"standup", step:"meeting-1", by:"you", usage:"active", deletion:{folder:"", files:["files/standup/minutes.md"]} });
});

test("a file is renamed with its links and .webp copy, deleted to the project's Trash with its picture off the line, and brought back", async () => {
  const { service, project, docs } = makeProject();
  write(docs, "lines/beds.md", `---
id: B-1
status: done
created: 2026-11-10 09:00
---

# Beds

## Ask · 2026-11-10 09:00

Look at this.

![photo.png](../files/beds/photo.png)
`);
  fs.mkdirSync(path.join(docs, "files/beds"), { recursive:true });
  fs.writeFileSync(path.join(docs, "files/beds/photo.png"), PNG);
  fs.writeFileSync(path.join(docs, "files/beds/photo.webp"), PNG);
  write(docs, "files/beds/site/index.html", "<link rel=stylesheet href=style.css>");
  write(docs, "files/beds/site/style.css", "body{}");

  const renamed = await service.renameFile(project, { path:"files/beds/photo.png", name:"Front bed.png" });
  assert.equal(renamed.path, "files/beds/Front bed.png");
  assert.ok(fs.existsSync(path.join(docs, "files/beds/Front bed.png")) && fs.existsSync(path.join(docs, "files/beds/Front bed.webp")), "the .webp copy follows");
  assert.match(fs.readFileSync(path.join(docs, "lines/beds.md"), "utf8"), /!\[photo\.png\]\(\.\.\/files\/beds\/Front bed\.png\)/, "the line's link follows");
  await assert.rejects(service.renameFile(project, { path:"files/beds/Front bed.png", name:"" }), /name/);

  const { removed } = await service.deleteFile(project, { path:"files/beds/Front bed.png" });
  assert.ok(!fs.existsSync(path.join(docs, "files/beds/Front bed.png")) && !fs.existsSync(path.join(docs, "files/beds/Front bed.webp")));
  assert.ok(fs.existsSync(path.join(docs, ".trash/files", removed, "file.json")), "kept in the project's Trash");
  assert.doesNotMatch(fs.readFileSync(path.join(docs, "lines/beds.md"), "utf8"), /Front bed/, "the picture left the line");
  assert.deepEqual(service.stateOf(project).deleted.files.map(f => f.title), ["Front bed.png"]);

  await service.restoreFile(project, { removed });
  assert.ok(fs.existsSync(path.join(docs, "files/beds/Front bed.png")) && fs.existsSync(path.join(docs, "files/beds/Front bed.webp")));
  assert.match(fs.readFileSync(path.join(docs, "lines/beds.md"), "utf8"), /Front bed\.png/, "and is back on its line");

  // A page folder goes, and comes back, whole.
  const page = await service.deleteFile(project, { path:"files/beds/site/index.html" });
  assert.ok(!fs.existsSync(path.join(docs, "files/beds/site")));
  await service.restoreFile(project, { removed:page.removed });
  assert.ok(fs.existsSync(path.join(docs, "files/beds/site/style.css")));
  await assert.rejects(service.deleteFile(project, { path:"files/../topics/beds.md" }), /not a file/);
  await assert.rejects(service.deleteFile(project, { path:"lines/beds.md" }), /not a file/);
});

// Exercise the real viewer actions, file/Canvas helpers and Deleted renderer against
// the real service, without needing an HTTP listener or browser for these checks.
function viewerFor(service, project) {
  let current, lastToast;
  const requests = [], reveals = [];
  const refresh = async () => {
    const state = service.stateOf(project);
    current = { ...state.project, ...state };
  };
  const context = vm.createContext({
    ACT:{}, SEND:{}, ICONS:{}, S:{ route:{ view:"files" } }, EMBED:true, HOSTED:null,
    document:{ addEventListener() {}, documentElement:{ addEventListener() {} } }, addEventListener() {}, readLists:() => ({}),
    $:() => null, render() {}, loadState:refresh, loadProjects:async () => {},
    project:() => current, can:() => !context.HOSTED,
    pathFor:id => `/projects/${id}`, fileUrl:(_p, file) => file,
    ic:() => "", FILE_ICON:() => "file", esc:value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c])), agentInfo:by => ({ name:by }),
    toast:(message, action) => { lastToast = { message, action }; },
    api:async (address, { body }) => {
      requests.push(address);
      const key = address.split("/").slice(-2).join("/");
      if (key === "files/reveal") {
        if (context.revealError) throw context.revealError;
        reveals.push(body?.path);
        return { ok:true };
      }
      const methods = {
        "files/delete":"deleteFile", "files/restore":"restoreFile",
        "canvases/delete":"deleteCanvas", "canvases/restore":"restoreCanvas",
      };
      assert.ok(methods[key], `unexpected request: ${address}`);
      return service[methods[key]](project, body);
    },
  });
  for (const file of ["canvases.js", "files.js", "files-view.js", "pages.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/lines", file), "utf8"), context, { filename:file });
  }
  return {
    context, requests, reveals, refresh, get toast() { return lastToast; },
    get state() { return current; },
    show(file) {
      context.file = file;
      return vm.runInContext("FV.key = file; fvSideHTML(project(), fvItem(project(), file))", context);
    },
    deleted:() => context.deletedHTML(current),
    delete:() => context.ACT["fv-delete"]({ disabled:false, isConnected:true }),
    reveal:() => context.ACT["fv-reveal"]({ disabled:false, isConnected:true }),
    restore:removed => context.ACT["file-restore"]({ dataset:{ removed } }),
    restoreCanvas:removed => context.ACT["canvas-restore"]({ dataset:{ removed } }),
  };
}

test("the viewer deletes a file directly, supports Undo and recovery from Deleted, and has no Cloud button", async () => {
  const { service, project, docs } = makeProject();
  write(docs, "files/notes.txt", "Seeds to buy.");
  const viewer = viewerFor(service, project);
  await viewer.refresh();
  const html = viewer.show("files/notes.txt");
  assert.match(html, /data-act="fv-delete"/);
  assert.doesNotMatch(html, /fv-cloud|Keep in Cloud|In Cloud/);
  viewer.context.S.cloudAccount = { signedIn:true };
  assert.doesNotMatch(viewer.show("files/notes.txt"), /fv-cloud|Keep in Cloud|In Cloud/);

  await viewer.delete();
  assert.equal(viewer.requests[0], `/projects/${project.id}/files/delete`);
  assert.ok(!fs.existsSync(path.join(docs, "files/notes.txt")));
  assert.match(viewer.deleted(), /notes\.txt.*data-act="file-restore"/s);
  assert.equal(viewer.toast.action.label, "Undo");
  await viewer.toast.action.fn();
  assert.equal(fs.readFileSync(path.join(docs, "files/notes.txt"), "utf8"), "Seeds to buy.");

  viewer.show("files/notes.txt");
  await viewer.delete();
  await viewer.restore(viewer.state.deleted.files[0].removed);
  assert.equal(fs.readFileSync(path.join(docs, "files/notes.txt"), "utf8"), "Seeds to buy.");
  assert.doesNotMatch(viewer.deleted(), /data-act="file-restore"/);
  // Hosted file management remains unavailable, including direct action calls.
  viewer.context.HOSTED = {};
  assert.doesNotMatch(viewer.show("files/notes.txt"), /data-act="fv-delete"/);
  const before = viewer.requests.length;
  await viewer.delete();
  assert.equal(viewer.requests.length, before);
});

test("the viewer shows a platform-specific reveal button on this computer and hides it remotely or on Cloud", async () => {
  const { service, project, docs } = makeProject();
  write(docs, "files/redesign/README-redesign.md", "# PenEcho\n");
  const viewer = viewerFor(service, project);
  await viewer.refresh();

  // Remote client: hidden and blocked.
  viewer.context.S.thisComputer = false;
  assert.doesNotMatch(viewer.show("files/redesign/README-redesign.md"), /data-act="fv-reveal"/);
  await viewer.reveal();
  assert.equal(viewer.reveals.length, 0);

  // macOS local client.
  viewer.context.S.thisComputer = true;
  viewer.context.S.revealFileLabel = "Reveal in Finder";
  const macHtml = viewer.show("files/redesign/README-redesign.md");
  assert.match(macHtml, /data-act="fv-reveal"[^>]*>Reveal in Finder<\/button>/);
  await viewer.reveal();
  assert.deepEqual(viewer.reveals, ["files/redesign/README-redesign.md"]);

  // Windows local client.
  viewer.context.S.revealFileLabel = "Show in File Explorer";
  assert.match(viewer.show("files/redesign/README-redesign.md"), /data-act="fv-reveal"[^>]*>Show in File Explorer<\/button>/);

  // Fallback from openFolderLabel before server restart, plus helpful 404 toast.
  viewer.context.S.revealFileLabel = "";
  viewer.context.S.openFolderLabel = "Open folder in File Explorer";
  assert.match(viewer.show("files/redesign/README-redesign.md"), /data-act="fv-reveal"[^>]*>Show in File Explorer<\/button>/);
  viewer.context.revealError = Object.assign(new Error("Not found."), { status:404 });
  await viewer.reveal();
  assert.equal(viewer.toast.message, "Restart PenEcho to reveal files from here.");
  viewer.context.revealError = null;

  // Hosted mode: hidden and blocked even if labels were populated.
  viewer.context.HOSTED = {};
  assert.doesNotMatch(viewer.show("files/redesign/README-redesign.md"), /data-act="fv-reveal"/);
  const countBefore = viewer.reveals.length;
  await viewer.reveal();
  assert.equal(viewer.reveals.length, countBefore);
});

test("the viewer deletes a Canvas as a complete Canvas and recovers it from Deleted", async () => {
  const { service, project, docs } = makeProject();
  const canvas = await service.createCanvas(project, { title:"Garden plan", blank:true });
  const viewer = viewerFor(service, project);
  await viewer.refresh();
  assert.match(viewer.show(canvas.source), /data-act="fv-delete"/);
  await viewer.delete();
  assert.equal(viewer.requests[0], `/projects/${project.id}/canvases/delete`);
  assert.ok(!fs.existsSync(path.join(docs, canvas.source)));
  assert.match(viewer.deleted(), /Garden plan.*data-act="canvas-restore"/s);
  assert.doesNotMatch(viewer.deleted(), /Nothing deleted/);
  await viewer.restoreCanvas(viewer.state.deleted.canvases[0].removed);
  assert.ok(fs.existsSync(path.join(docs, canvas.source)));
  assert.doesNotMatch(viewer.deleted(), /data-act="canvas-restore"/);
});

test("both Deleted lists show preserved images and escaped document excerpts before restoration", async () => {
  const { service, project, docs } = makeProject();
  write(docs, "files/photo.png", PNG);
  write(docs, "files/notes.md", '# Seeds\n\nBuy basil. <img src=x onerror="alert(1)">');
  await service.deleteFile(project, { path:"files/photo.png" });
  await service.deleteFile(project, { path:"files/notes.md" });
  const viewer = viewerFor(service, project);
  await viewer.refresh();
  const image = viewer.state.deleted.files.find(f => f.title === "photo.png");
  for (const html of [viewer.deleted(), viewer.context.flBodyHTML(viewer.state)]) {
    assert.ok(html.includes(image.preview.path), "the image is read from Deleted");
    assert.match(html, /data-act="deleted-preview"/);
    assert.match(html, /Buy basil/);
    assert.match(html, /&lt;img src=x onerror=/);
    assert.doesNotMatch(html, /<img src=x/);
    assert.match(html, /files\/notes\.md/);
    assert.match(html, /data-act="file-restore"/);
  }
  const box = { hidden:true, innerHTML:"" }, anchor = { dataset:{ kind:"files", removed:image.removed }, isConnected:true, focus() {} };
  let wired = 0, focused = 0;
  viewer.context.$ = selector => selector === "#lightbox" ? box : { focus() { focused++; } };
  viewer.context.wireImagePreview = () => { wired++; };
  const before = viewer.requests.length;
  viewer.context.ACT["deleted-preview"](anchor);
  assert.equal(box.hidden, false);
  assert.ok(box.innerHTML.includes(image.preview.path));
  assert.equal(wired, 1);
  assert.equal(focused, 1);
  assert.equal(viewer.requests.length, before, "previewing does not restore or modify the file");
});

test("Deleted paginates Lines and Items independently and clamps after a restore", async () => {
  const { service, project } = makeProject();
  const viewer = viewerFor(service, project);
  await viewer.refresh();
  const d = viewer.state.deleted, deletedAt = Date.now() - 1000, goneAt = deletedAt + 86400000;
  d.lines = Array.from({ length:21 }, (_, i) => ({ slug:`line-${i}`, title:`Line ${i}`, deletedAt, goneAt }));
  d.files = Array.from({ length:20 }, (_, i) => ({ removed:`file-${i}`, title:`File ${i}`, deletedAt:deletedAt - i, goneAt }));
  d.nodes = [{ slug:"gone", removed:"note", words:"Removed note", kind:"note", removedAt:new Date(deletedAt + 1).toISOString(), goneAt, lineGone:true }];
  d.canvases = [{ removed:"canvas", title:"Removed Canvas", deletedAt:deletedAt + 2, goneAt }];
  viewer.context.removedWord = () => "Note";
  const go = (act, dataset) => viewer.context.ACT[act]({ dataset });
  const rows = html => (html.match(/<article class="del-row/g) || []).length;
  const count = text => assert.match(viewer.deleted(), text);

  assert.equal(rows(viewer.deleted()), 20);
  assert.doesNotMatch(viewer.deleted(), /data-act="file-restore"|data-slug="line-20"/);
  count(/Page 1 of 2/);
  go("deleted-page", { step:"1" });
  assert.equal(rows(viewer.deleted()), 1);
  count(/data-slug="line-20"/);

  go("deleted-tab", { tab:"items" });
  assert.equal(rows(viewer.deleted()), 20);
  assert.doesNotMatch(viewer.deleted(), /data-act="restore-line"/);
  count(/Removed Canvas.*Removed note.*Restore its line first.*File 0/s);
  go("deleted-page", { step:"1" });
  assert.equal(rows(viewer.deleted()), 2);
  count(/Page 2 of 2/);

  go("deleted-tab", { tab:"lines" });
  count(/Page 2 of 2/);
  d.lines.pop();
  const afterRestore = viewer.deleted();
  assert.equal(rows(afterRestore), 20);
  assert.doesNotMatch(afterRestore, /class="del-pager/);
  go("deleted-tab", { tab:"items" });
  count(/Page 2 of 2/);
});


test("cleanup association protects active references and never guesses deleted owners", () => {
  const files = ['files/old/a.txt', 'files/old/b.txt', 'files/gone/c.txt', 'files/unknown/d.txt', 'files/old/canvas.penecho.json', 'files/old/canvas.png'].map(path => ({path, size:10}));
  const lines = [{slug:'old', archived:true, stations:[]}, {slug:'current', stations:[{id:'ask-1', kind:'ask', files:[{path:'files/old/a.txt'}, {path:'files/old/canvas.png'}]}]}];
  const shelf = shelfOf({files, lines, deletedLines:['gone'], pictures:[{source:'files/old/canvas.penecho.json', path:'files/old/canvas.png'}], canvasParts:new Map([['files/old/canvas.penecho.json', ['files/old/canvas.penecho.json', 'files/old/canvas.png']]])});
  assert.equal(shelf.files.get('files/old/a.txt').usage, 'active');
  assert.equal(shelf.files.get('files/old/b.txt').usage, 'archived');
  assert.equal(shelf.files.get('files/gone/c.txt').usage, 'deleted');
  assert.equal(shelf.files.get('files/unknown/d.txt').usage, 'unlinked');
  assert.equal(shelf.files.get('files/old/canvas.penecho.json').usage, 'active');
});

test("a file named in a Work, an Ask, a Topic or understanding.md is in use; folders only with their slash in plain words", () => {
  const found = pathsIn("![a](../../files/x/y%20z.png) and `files/My Folder/a b.md`, files/kit/ and files/s t.png, https://e.com/a.png", "works/l/work-1.md");
  assert.ok(found.includes("files/x/y z.png") && found.includes("files/My Folder/a b.md") && found.includes("files/kit/"));
  assert.ok(!found.includes("files/s/"), "a bare word that stops at a space never names a folder");
  assert.deepEqual(pathsIn("No paths here.", "topics/a.md"), []);

  const files = ['files/old/topic.png', 'files/old/work.md', 'files/old/self.md', 'files/old/plain.md', 'files/kit/a.txt', 'files/kit/b.txt', 'files/s/c.txt'].map(path => ({path, size:10}));
  const lines = [{slug:'old', archived:true, stations:[]}, {slug:'now', stations:[]}];
  const references = [{line:'', paths:['files/old/topic.png']}, {line:'now', paths:['files/old/work.md', 'files/kit/']}, {line:'old', paths:['files/old/self.md']}, {line:'now', paths:['files/s']}];
  const shelf = shelfOf({files, lines, references});
  assert.equal(shelf.files.get('files/old/topic.png').usage, 'active', "a Topic keeps it whatever its Line");
  assert.equal(shelf.files.get('files/old/work.md').usage, 'active', "a current Line's Work keeps it");
  assert.equal(shelf.files.get('files/old/self.md').usage, 'archived', "its own archived Line does not");
  assert.equal(shelf.files.get('files/old/plain.md').usage, 'archived');
  assert.equal(shelf.files.get('files/kit/a.txt').usage, 'active', "a folder named keeps all of it");
  assert.equal(shelf.files.get('files/s/c.txt').usage, 'unlinked', "a folder named without its slash names nothing");
});

test("a Canvas of its own is never a cleanup candidate; a Line's Canvas still is", () => {
  const files = ['files/canvas-71/canvas.penecho.json', 'files/canvas-71/canvas.png', 'files/old/canvas.penecho.json', 'files/old/canvas.png'].map(path => ({path, size:10}));
  const pictures = [{source:'files/canvas-71/canvas.penecho.json', path:'files/canvas-71/canvas.png', canvas:true, folder:'canvas-71', loose:true}, {source:'files/old/canvas.penecho.json', path:'files/old/canvas.png', canvas:true, folder:'old', topic:'old'}];
  const shelf = shelfOf({files, pictures, lines:[{slug:'old', archived:true, stations:[]}]});
  assert.equal(shelf.files.get('files/canvas-71/canvas.penecho.json').usage, 'active');
  assert.equal(shelf.files.get('files/old/canvas.penecho.json').usage, 'archived');
});

test("deleting a picture leaves a note on an archived line, and Restore puts the picture back in its place", async () => {
  const { service, project, docs } = makeProject();
  write(docs, "lines/old.md", `---
id: G-2
status: landed
who: @you
created: 2026-11-01 09:00
---

# Old work

## Ask · 2026-11-01 09:00

Look at this.

![shot.png](../files/old/shot.png)

Thanks.
`);
  write(docs, "lines/now.md", `---
id: G-3
status: done
who: @you
created: 2026-11-02 09:00
---

# Now

## Ask · 2026-11-02 09:00

Same picture.

![shot.png](../files/old/shot.png)
`);
  fs.mkdirSync(path.join(docs, "files/old"), { recursive:true });
  fs.writeFileSync(path.join(docs, "files/old/shot.png"), PNG);
  write(docs, "files/old/kept.md", "x");
  write(docs, "topics/notes.md", "# Notes\n\nSee [kept](../files/old/kept.md).\n");
  const usage = file => service.stateOf(project).files.find(f => f.path === file)?.usage;
  assert.equal(usage("files/old/kept.md"), "active", "a Topic's link keeps an archived Line's file in use");

  const lineText = slug => { const archived = path.join(docs, "archive/lines", `${slug}.md`); return fs.readFileSync(fs.existsSync(archived) ? archived : path.join(docs, "lines", `${slug}.md`), "utf8"); };
  const { removed } = await service.deleteFile(project, { path:"files/old/shot.png" });
  const old = lineText("old");
  assert.doesNotMatch(old, /!\[shot\.png\]/);
  assert.match(old, /Look at this\.\n\n\(File deleted on \d{4}-\d{2}-\d{2}: shot\.png\)\n\nThanks\./, "the note takes the picture's place");
  assert.doesNotMatch(lineText("now"), /shot\.png/, "a current line loses the picture as before");

  await service.restoreFile(project, { removed });
  assert.match(lineText("old"), /Look at this\.\n\n!\[shot\.png\]\(\.\.\/files\/old\/shot\.png\)\n\nThanks\./);
  assert.doesNotMatch(lineText("old"), /File deleted/);
  assert.match(lineText("now"), /!\[shot\.png\]/);
});

test("the page viewer shows Open in a new tab in a browser and Open in browser with an arrow in the desktop app", async () => {
  const { service, project, docs } = makeProject();
  write(docs, "files/demo/circle.explorer.html", "<!doctype html><title>Circle</title>");
  const viewer = viewerFor(service, project);
  viewer.context.ic = name => `<svg data-ic="${name}"></svg>`;
  await viewer.refresh();

  // Regular browser: no window.penechoDesktop.
  viewer.context.window = {};
  const browserHtml = viewer.show("files/demo/circle.explorer.html");
  assert.match(browserHtml, /data-act="fv-tab"><svg data-ic="expand"><\/svg>Open in a new tab<\/button>/);

  // Desktop app: top-level window.penechoDesktop.
  viewer.context.window = { penechoDesktop:{ platform:"darwin" } };
  const desktopHtml = viewer.show("files/demo/circle.explorer.html");
  assert.match(desktopHtml, /data-act="fv-tab">Open in browser<svg data-ic="arrow"><\/svg><\/button>/);

  // Desktop app embedded side panel: window.top.penechoDesktop.
  viewer.context.window = { top:{ penechoDesktop:{ platform:"darwin" } } };
  const embeddedDesktopHtml = viewer.show("files/demo/circle.explorer.html");
  assert.match(embeddedDesktopHtml, /data-act="fv-tab">Open in browser<svg data-ic="arrow"><\/svg><\/button>/);

  // Hosted mode keeps browser copy even if a bridge existed.
  viewer.context.HOSTED = {};
  const hostedHtml = viewer.show("files/demo/circle.explorer.html");
  assert.match(hostedHtml, /data-act="fv-tab"><svg data-ic="expand"><\/svg>Open in a new tab<\/button>/);
});
