"use strict";
// penecho.ai works like the local app (PE-349): what the project pages there send to Cloud for what was hidden before, and what stays
// hidden for a project that lives on a computer or for My Canvases.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = name => fs.readFileSync(path.join(__dirname, "../public/lines", name), "utf8");
function extract(source, name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`)), body = source.indexOf("{", source.indexOf(")", start));
  assert.ok(start >= 0, name);
  for (let depth = 0, i = body; i < source.length; i++) { if (source[i] === "{") depth++; else if (source[i] === "}" && !--depth) return source.slice(start, i + 1); }
  throw new Error(`Missing ${name}`);
}
const constant = (source, name) => { const start = source.indexOf(`const ${name} = `); assert.ok(start >= 0, name); return source.slice(start, source.indexOf(";\n", start) + 1); };
const hosted = read("hosted.js");

test("Cloud Project Home omits the slides and Sources panel on open and refresh", () => {
  const { document } = require("./helpers/dom.js").parseHTML("<html><body></body></html>");
  const deck = { path:"files/sales-review.pptx", kind:"slides" };
  const source = { path:"files/review-evidence.json", kind:"file" };
  const p = { id:"sales", synced:true, files:[], lines:[], landed:[], backlog:[], pictures:[], notes:[] };
  const c = vm.createContext({
    document, $:selector => document.querySelector(selector), addEventListener() {},
    LINE_STATUS:require("../public/lines/line-status.js"),
    ACT:{}, SEND:{}, ICONS:{},
    esc:String, ic:() => "", FILE_ICON:() => "file", fvBackTo() {}, fvPendingTry() {}, requestAnimationFrame() {},
    composerHTML:() => "", panoHTML:() => '<div id="pano"></div>',
  });
  c.p = p;
  for (const name of ["state.js", "pages.js", "desk.js", "files.js"]) vm.runInContext(read(name), c, { filename:name });
  vm.runInContext("S.cur = p.id; S.data[p.id] = p;", c);
  const open = () => { document.body.innerHTML = c.homeHTML(p); };
  const assertCloudHome = () => {
    assert.ok(document.querySelector("#hmNeeds"), "the project Home rendered");
    assert.ok(!document.querySelector('#deckHero, .deck-hero, [aria-label="Slides"]'), "slides and Sources must be absent");
    assert.doesNotMatch(document.body.textContent, /\bOpen slides\b|\bSources\b/);
  };
  for (const mode of [{ key:"sales" }, { shared:true, read:true }]) {
    c.HOSTED = mode;
    p.files = [deck, source]; p.lines = [];
    open(); assertCloudHome();
    p.files = [source];
    p.lines = [{ id:"slides", labels:["Slides"], stations:[], ask:{ files:[], later:[] } }, { id:"work", stations:[] }];
    c.refreshDesk(); assertCloudHome();
    open(); assertCloudHome();
    p.files = [deck, source];
    c.refreshDesk(); assertCloudHome();
    assert.deepEqual(Array.from(c.flItems(p), item => item.path), [deck.path, source.path]);
  }
  c.HOSTED = null; p.lines = [];
  open();
  assert.match(document.querySelector(".deck-hero").textContent, /sales-review[\s\S]*Open slides[\s\S]*Sources[\s\S]*review-evidence\.json/);
});

// hostedFetch with Cloud answered by `answer(url, init)`; what it asked and what it told the dashboard are kept.
function page(answer) {
  const asked = [], told = [];
  const c = vm.createContext({ HOSTED:{ key:"garden", base:"/api/v1/line-projects/garden", last:"x", account:{ name:"Dana" }, held:{}, quiet:{} }, Response, JSON, Number, Boolean, String,
    location:{ origin:"https://penecho.ai" },
    hostedCall:async (url, init = {}) => { asked.push({ url, method:init.method || "GET", body:init.body }); const [status, body] = await answer(url, init); return new Response(JSON.stringify(body), { status, headers:{ "content-type":"application/json" } }); },
    hostedTell:message => told.push(message) });
  vm.runInContext([constant(hosted, "hostedAnswer"), ...["hostedSaid", "hostedShare", "hostedStateRetry", "hostedLive", "hostedReviewAll", "hostedFetch"].map(name => extract(hosted, name))].join("\n"), c);
  const fetch = async (p, init = {}) => { const r = await c.hostedFetch(p, { method:"GET", headers:{ accept:"application/json" }, ...init }); return { status:r.status, body:await r.json() }; };
  return { c, asked, told, fetch };
}

for (const status of [200, 409, 503]) test(`Cloud review-all uses one server action and preserves its ${status} response`, async () => {
  const body = status === 200 ? { ok:true } : { error:"save_failed", message:"Review was not saved." };
  const p = page(async () => [status, body]);
  // Even a page showing only some Works must review the whole Line. The
  // server owns the complete list; the page must not save them one at a time.
  p.c.project = () => ({ lines:[{ slug:"rain", stations:Array.from({ length:12 }, (_, i) => ({ id:`work-${i + 1}`, reviewed:true })) }] });
  p.c.lineById = project => project.lines[0]; p.c.canReview = () => true;
  p.c.hostedBaseOf = id => `/api/v1/line-projects/${id}`;
  p.c.HOSTED.onComputer = true;
  const result = await p.fetch("/projects/another-project/topics/rain/review-all", { method:"POST", body:"{}" });
  assert.deepEqual(result, { status, body:status === 200 ? body : { error:body.message, message:body.message, code:body.error } });
  assert.deepEqual(p.asked, [{ url:"/api/v1/line-projects/another-project/topics/rain/review-all", method:"POST", body:"{}" }]);
});

test("recent computer runs poll by revision and a skipped check cannot signal recovery", async () => {
  let now = 1000000, status = 502;
  const p = page(async () => [status, status === 200 ? { same:true, rev:"r1" } : {}]);
  p.c.Date = { now:() => now };
  Object.assign(p.c.HOSTED, { onComputer:true, runAt:now, askedAt:0 });
  const url = "/projects/garden/state?rev=r1";
  assert.equal((await p.fetch(url)).status, 503);
  now += 2000;
  await p.fetch(url);
  assert.equal(p.asked.length, 1, "no extra poll during the grace period");
  now += 118000;
  assert.equal((await p.fetch(url)).status, 503, "the gateway is still unavailable");
  now += 2000;
  assert.equal((await p.fetch(url)).status, 503, "throttling cannot manufacture a recovery");
  now += 2000;
  status = 200;
  assert.equal((await p.fetch(url)).body.rev, "r1");
  assert.equal(p.c.HOSTED.stateUnavailable, false);
  assert.ok(p.asked.every(a => a.url.endsWith("/state?rev=r1")));
  status = 502;
  assert.equal((await p.fetch("/projects/garden/state")).status, 502, "direct reads still show errors");
  assert.equal((await p.fetch("/projects/garden/topics/one/finish-unsent", { method:"POST", body:'{"step":"ask-1"}' })).status, 502);
  p.c.HOSTED.onComputer = false;
  p.c.HOSTED.runAt = now;
  assert.equal(p.c.hostedLive(), true, "Cloud-hosted agent runs keep live updates");
  // PE-692: while a line works here, a look still names what it has, so an unchanged run answers "the same", not the whole state.
  status = 200; now += 5000; p.asked.length = 0;
  await p.fetch(url); now += 2000; await p.fetch(url);
  assert.deepEqual(p.asked.map(a => a.url), ["/api/v1/line-projects/garden/state?rev=r1", "/api/v1/line-projects/garden/state?rev=r1"], "each live look names its revision, and none is held back");
});

test("a Cloud computer page waits through transient polling failures and reports sustained loss once", async () => {
  let now = 1000000, error;
  const notices = [];
  const c = vm.createContext({ document:{ hidden:false }, HOSTED:{ onComputer:true }, Date:{ now:() => now },
    S:{ cur:"garden" }, project:() => null, LIST_MS:Infinity, hostedRetry() {}, toast:s => notices.push(s),
    loadState:async () => { if (error) throw error; return false; } });
  const main = read("main.js");
  vm.runInContext(main.slice(main.indexOf("let polling ="), main.indexOf("function bindGlobal")), c);
  error = { status:502 };
  await c.poll(); now += 119999; await c.poll();
  assert.deepEqual(notices, []);
  error = null; await c.poll();
  error = { offline:true }; await c.poll(); now += 120000;
  await c.poll(); await c.poll();
  assert.deepEqual(notices, ["Could not refresh from PenEcho Cloud. Trying again."]);
  error = null; await c.poll();
  assert.equal(notices.at(-1), "Connected again.");
  error = { status:403, message:"Sign in" }; await c.poll();
  assert.equal(notices.at(-1), "Sign in", "actionable errors are immediate");
});

test("renaming the project goes to the project itself, and the dashboard's rail is told", async () => {
  const p = page(async () => [200, { ok:true }]);
  const done = await p.fetch("/projects/garden", { method:"PATCH", body:JSON.stringify({ name:"Garden plan" }) });
  assert.equal(done.status, 200);
  assert.deepEqual(p.asked.map(a => [a.url, a.method]), [["/api/v1/line-projects/garden", "PATCH"]]);
  assert.equal(p.asked[0].body, JSON.stringify({ name:"Garden plan" }));
  assert.deepEqual(JSON.parse(JSON.stringify(p.told)), [{ projects:true }]);
  assert.equal(p.c.HOSTED.last, "", "the next look takes the whole state, with its new name");
  const refused = page(async () => [409, { error:"kept", message:"My Canvases keeps its name." }]);
  const no = await refused.fetch("/projects/garden", { method:"PATCH", body:"{}" });
  assert.deepEqual([no.status, no.body.error], [409, "My Canvases keeps its name."]);
  assert.equal(refused.told.length, 0);
});

test("Share asks Cloud for the project's own link and answers as a computer would", async () => {
  let share = null;
  const p = page(async (url, init) => {
    assert.equal(url, "/api/v1/line-projects/garden/share");
    if (init.method === "POST") share = { url:"/l/abc", expiresAt:1, ended:false };
    if (init.method === "DELETE") share = null;
    return [200, { project:{ key:"garden", plus:false, maxBytes:104857600, share } }];
  });
  const before = await p.fetch("/projects/garden/cloud");
  assert.deepEqual([before.body.signedIn, before.body.link, before.body.remote.share, before.body.progress], [true, "", null, null]);
  const made = await p.fetch("/projects/garden/share", { method:"POST" });
  assert.equal(made.body.link, "https://penecho.ai/l/abc");
  assert.deepEqual([made.body.plus, made.body.maxBytes, made.body.name], [false, 104857600, "Dana"]);
  const stopped = await p.fetch("/projects/garden/share", { method:"DELETE" });
  assert.equal(stopped.body.remote.share, null);
  assert.deepEqual(p.asked.map(a => a.method), ["GET", "POST", "DELETE"]);
  const there = page(async () => [409, { error:"on_your_computer", message:"Share this project from PenEcho on your computer." }]);
  assert.deepEqual((await there.fetch("/projects/garden/cloud")).body.error, "Share this project from PenEcho on your computer.");
});

test("MeetCue is asked through the account's own link; links across projects are a computer's", async () => {
  const p = page(async url => [200, url === "/api/v1/meetcue" ? { available:true, linked:true } : { meetings:[{ id:"m-1" }] }]);
  assert.deepEqual((await p.fetch("/meetcue")).body, { available:true, linked:true, signedIn:true });
  assert.deepEqual((await p.fetch("/meetcue/meetings?limit=8")).body, { meetings:[{ id:"m-1" }] });
  await p.fetch("/meetcue/meetings/m-1");
  await p.fetch("/meetcue/meetings/m-1", { method:"DELETE" });
  assert.deepEqual(p.asked.map(a => `${a.method} ${a.url}`), ["GET /api/v1/meetcue", "GET /api/v1/meetcue/meetings?limit=8", "GET /api/v1/meetcue/meetings/m-1", "DELETE /api/v1/meetcue/meetings/m-1"]);
  assert.deepEqual((await p.fetch("/meetcue/links")).body, { signedIn:true, links:{} });
  assert.equal((await p.fetch("/meetcue/transfers")).status, 403, "anything else of MeetCue stays the dashboard's");
  // A meeting added to the project, or to one of its lines, is the project's own route.
  const add = page(async () => [200, { slug:"supply", step:"n-1" }]);
  await add.fetch("/projects/garden/meetings", { method:"POST", body:JSON.stringify({ meetingId:"m-1", topic:"supply" }) });
  assert.deepEqual(add.asked.map(a => `${a.method} ${a.url}`), ["POST /api/v1/line-projects/garden/meetings"]);
});

test("files, pins and Mark outdated go to the project's own routes", async () => {
  const p = page(async () => [200, { ok:true }]);
  for (const rest of ["/upload?dir=files%2Fadded&name=a.txt", "/files/rename", "/files/delete", "/files/restore", "/restore-line", "/notes",
    "/topics/rain/pin", "/topics/rain/outdated", "/topics/rain/approve", "/topics/rain/discard"]) await p.fetch(`/projects/garden${rest}`, { method:"POST", body:"{}" });
  assert.ok(p.asked.every(a => a.url.startsWith("/api/v1/line-projects/garden/")), JSON.stringify(p.asked.map(a => a.url)));
  assert.equal(p.asked.length, 10);
});

test("the folder's zip is the project's own on penecho.ai", () => {
  const pdf = read("pdf.js");
  const c = vm.createContext({ HOSTED:{ base:"/api/v1/line-projects/garden" }, encodeURIComponent });
  vm.runInContext(`const pathFor = id => \`/projects/\${encodeURIComponent(id)}\`;\nconst apiUrl = ${constant(read("state.js"), "apiUrl").replace(/^const apiUrl = /, "").replace(/;$/, "")};\n${extract(pdf, "zipUrl")}`, c);
  assert.equal(c.zipUrl({ id:"garden" }, [], "Garden"), "/api/v1/line-projects/garden/zip?name=Garden");
  c.HOSTED = null;
  assert.equal(c.zipUrl({ id:"garden" }, ["files/a.md"], "Garden"), "/api/lines/projects/garden/zip?path=files%2Fa.md&name=Garden");
});

test("what penecho.ai still leaves to a computer is listed once; approving a step and sharing stay with a project on a computer", () => {
  const c = vm.createContext({});
  const start = hosted.indexOf("const HOSTED_OFF = {"), end = hosted.indexOf("\n};\n", start);
  vm.runInContext(`var OFF = ${hosted.slice(start + "const HOSTED_OFF = ".length, end + 2)};`, c);
  const off = c.OFF;
  for (const act of ["unsent-finish", "project-rename", "restore-line", "file-add", "file-menu", "file-restore", "cmp-attach", "new-note-quick", "approve-step", "discard-work", "line-pin", "line-outdated",
    "meetcue-add", "cmp-meeting", "cmp-meeting-node", "line-meeting", "download-folder", "project-share", "ppt-download", "open-example"]) assert.ok(!off.acts.includes(act), act);
  for (const what of ["files", "restore-line"]) assert.ok(!off.can.includes(what), what);
  for (const view of ["settings", "vault"]) assert.ok(!off.views.includes(view), view);
  for (const label of ["Pin", "Unpin", "Add images or files", "Add meeting notes from MeetCue", "Add meeting node", "Mark outdated"]) assert.ok(!off.menus.includes(label), label);
  for (const part of ["#dropOverlay", ".cmp-plus", ".examples"]) assert.ok(!off.parts.includes(part), part);
  assert.deepEqual([...off.computer].sort(), ["approve-step", "discard-work", "project-share"]);
  // My Canvases keeps its name, is not shared, and is never archived or deleted.
  assert.deepEqual([...off.system].sort(), ["project-archive", "project-delete", "project-rename", "project-share"]);
  for (const act of ["project-archive", "project-restore"]) assert.ok(!off.acts.includes(act), act);
  assert.ok(!off.parts.some(part => part.includes('aria-label="Archive"')), "the Archive row shows");
  // Still a computer's: Git, folders, pasting into an agent app, and slides from data.
  for (const act of ["merge-line", "box-branch", "project-folder", "unsent-context", "open-desktop", "cmp-ppt", "build-topics", "carry-on"]) assert.ok(off.acts.includes(act), act);
  assert.ok(!off.parts.includes(".lp-thread-adds"), "Add meeting below a line's thread (its New canvas is hidden by itself)");
  assert.ok(!off.views.includes("topics"));
  // The Orchestrator is here for a project that lives on a computer only (owner, 2026-11-22).
  assert.ok(!off.views.includes("orchestrator"));
  assert.deepEqual(JSON.parse(JSON.stringify(off.needsComputer)), { views:["orchestrator"], acts:["review-tree", "review-tree-menu", "review-tree-apply", "work-review", "work-review-pick"] });
  for (const [HOSTED, here] of [[null, true], [{ onComputer:true }, true], [{ onComputer:false }, false]]) {
    const c = vm.createContext({ HOSTED, HOSTED_OFF:off });
    vm.runInContext(`${hosted.match(/^const viewHere = .*$/m)[0]}\n${hosted.match(/^const orchHere = .*$/m)[0]}\nvar out = [orchHere(), viewHere("topics"), viewHere("markup")];`, c);
    assert.deepEqual([...c.out], [here, true, !HOSTED], JSON.stringify(HOSTED));
  }
  for (const act of ["line-draw", "cmp-draw", "new-canvas", "my-new-canvas", "canvas-library"]) assert.ok(!off.acts.includes(act), act);
});

test("a project that lives on a computer, and My Canvases, are marked so their own actions are not drawn", async () => {
  for (const [project, onComputer, system] of [[{ key:"garden", cloudMade:true }, false, false], [{ key:"garden" }, true, false], [{ key:"garden", system:"my-canvases" }, false, true]]) {
    const marks = {};
    const c = vm.createContext({ HOSTED:{ key:"garden", onComputer:false, system:false, lives:null }, Boolean,
      document:{ documentElement:{ classList:{ toggle:(name, on) => { marks[name] = on; } } } },
      hostedCall:async () => ({ ok:true, json:async () => ({ projects:[project] }) }) });
    vm.runInContext(extract(hosted, "hostedLives"), c);
    await c.hostedLives();
    assert.deepEqual([c.HOSTED.onComputer, c.HOSTED.system, marks["is-on-computer"], marks["is-system"]], [onComputer, system, onComputer, system], JSON.stringify(project));
  }
});

test("the project's own Settings keeps the project in the dashboard's address; #settings alone is Settings for every project", () => {
  const told = [];
  const c = vm.createContext({ HOSTED:{ key:"garden", told:"" }, location:{ hash:"" }, document:{ title:"Garden · PenEcho Lines" }, encodeURIComponent, hostedTell:m => told.push(m.hash) });
  vm.runInContext([constant(hosted, "HOSTED_PLACES"), constant(hosted, "HOSTED_OUTSIDE"), extract(hosted, "hostedHash"), extract(hosted, "hostedAddress")].join("\n"), c);
  for (const [hash, said] of [["#garden/settings", "garden/settings"], ["#settings/agents", "settings/agents"], ["#garden/line/rain", "line/rain"], ["#garden/vault", "vault"], ["#garden", ""]]) {
    c.location.hash = hash; c.HOSTED.told = ""; c.hostedAddress();
    assert.equal(told.at(-1), said, hash);
    assert.equal(c.hostedHash(said) || "garden", hash.slice(1), `${said} opens ${hash} again`);
  }
});

test("an example on an empty project becomes a project of the account's own and opens", async () => {
  const asked = [], went = [], said = [];
  const el = { dataset:{ kind:"class" }, disabled:false };
  const c = vm.createContext({ HOSTED:{ key:"garden" }, ACT:{}, JSON, encodeURIComponent, Response, toast:m => said.push(m), hostedGo:p => went.push(p),
    hostedCall:async (url, init) => { asked.push([url, init.method, init.body]); return new Response(JSON.stringify(said.length || asked.length > 1 ? { error:"project_limit", message:"Free keeps 3 projects in Cloud." } : { project:{ key:"cloud-1" } }), { status:asked.length > 1 ? 409 : 201 }); } });
  const start = hosted.indexOf("  ACT['open-example'] = async el => {"), end = hosted.indexOf("\n  };\n", start) + 5;
  vm.runInContext([constant(hosted, "hostedAnswer"), extract(hosted, "hostedSaid"), hosted.slice(start, end)].join("\n"), c);
  await c.ACT["open-example"](el);
  assert.deepEqual(asked[0], ["/api/v1/line-projects", "POST", JSON.stringify({ example:"class" })]);
  assert.deepEqual(went, ["/lines/cloud-1"]);
  await c.ACT["open-example"](el);
  assert.deepEqual(said, ["Free keeps 3 projects in Cloud."]);
  assert.equal(el.disabled, false);
});

test("Download PPT reads slides through the Widget host the page's own Canvas uses", () => {
  const ppt = read("ppt.js");
  const c = vm.createContext({ URL, HOSTED:{ key:"garden" }, location:{ href:"https://penecho.ai/canvas/projects.html?hosted=garden", origin:"https://penecho.ai" } });
  vm.runInContext(`${constant(ppt, "pptHere")}\n${extract(ppt, "pptHostUrl")}`, c);
  assert.equal(c.pptHostUrl(), "https://penecho.ai/canvas/widget-host.html?remote-canvas=1&public-https=1");
  c.HOSTED = null; c.location = { href:"http://127.0.0.1:3889/projects.html", origin:"http://127.0.0.1:3889" };
  assert.equal(c.pptHostUrl(), "http://localhost:3889/widget-host.html?parent-origin=http%3A%2F%2F127.0.0.1%3A3889", "on a computer, the other loopback name");
});

test("Delete on penecho.ai: a row that says what goes, and Delete stays off until the project's name is typed", () => {
  const rowOf = HOSTED => { const c = vm.createContext({ HOSTED, esc:x => String(x) }); vm.runInContext(extractFn("hostedDeleteRow"), c); return c.hostedDeleteRow({ name:"Garden" }); };
  assert.match(rowOf({ onComputer:false, system:false }), /Delete this project[\s\S]*for good[\s\S]*data-act="project-delete"/);
  assert.match(rowOf({ onComputer:true, system:false }), /Delete from PenEcho Cloud[\s\S]*The project on your computer stays as it is and stops syncing/);
  assert.equal(rowOf({ onComputer:false, system:true }), "", "My Canvases is never deleted");
  assert.equal(rowOf(null), "", "on a computer a project is its folder");
  assert.match(hosted, /<button type="submit" class="btn danger" disabled>Delete<\/button>/);
  assert.match(hosted, /input\.value\.trim\(\) === String\(p\.name\)\.trim\(\)/);
  assert.match(hosted, /method:'DELETE'[\s\S]*JSON\.stringify\(\{ confirm:input\.value\.trim\(\) \}\)/);
});
function extractFn(name) {
  const start = hosted.search(new RegExp(`function ${name}\\(`)), body = hosted.indexOf("{", hosted.indexOf(")", start));
  for (let depth = 0, i = body; i < hosted.length; i++) { if (hosted[i] === "{") depth++; else if (hosted[i] === "}" && !--depth) return hosted.slice(start, i + 1); }
  throw new Error(name);
}

test("a shared link reads only: what penecho.ai lets an owner change is not drawn or sent for a reader", async () => {
  const c = vm.createContext({});
  const start = hosted.indexOf("const HOSTED_OFF = {"), end = hosted.indexOf("\n};\n", start);
  vm.runInContext(`var OFF = ${hosted.slice(start + "const HOSTED_OFF = ".length, end + 2)};`, c);
  const rStart = hosted.indexOf("const HOSTED_READ = {"), rEnd = hosted.indexOf("\n};\n", rStart);
  vm.runInContext(`var READ = ${hosted.slice(rStart + "const HOSTED_READ = ".length, rEnd + 2)};`, c);
  const { OFF:off, READ:read } = c;
  // Every button an owner has on penecho.ai that changes the project is off for a reader.
  for (const act of ["line-draw", "cmp-draw", "new-canvas", "my-new-canvas", "canvas-library", "unsent-finish", "project-rename", "project-archive", "project-restore", "project-delete", "project-share", "restore-line", "file-add", "file-menu", "file-restore", "cmp-attach",
    "new-note-quick", "approve-step", "discard-work", "line-pin", "line-outdated", "meetcue-add", "cmp-meeting", "cmp-meeting-node", "line-meeting", "open-example", "open-settings",
    "line-todo", "work-rate", "work-rate-note", "memory-recover", "topic-merge-accept", "file-delete-selected"]) {
    assert.ok(off.acts.includes(act) || read.acts.includes(act), act);
  }
  assert.ok(read.views.includes("settings"));
  for (const label of ["Pin", "Unpin", "Add images or files", "Add meeting notes from MeetCue", "Add meeting node", "Mark outdated"]) assert.ok(read.menus.includes(label), label);
  for (const part of ["#dropOverlay", ".cmp-plus", ".examples", ".composer"]) assert.ok(read.parts.includes(part), part);
  // And whatever is still asked of Cloud, a reader sends nothing that changes it, and no account is asked for.
  const view = page(() => [200, {}]);
  view.c.HOSTED.read = true; view.c.HOSTED.shared = true;
  assert.equal((await view.fetch("/projects/garden/topics/rain/finish-unsent", { method:"POST", body:'{"step":"ask-1"}' })).status, 403);
  assert.equal((await view.fetch("/projects/garden/files", { method:"POST", body:"{}" })).status, 403);
  assert.deepEqual((await view.fetch("/cloud/account")).body, { signedIn:false });
  assert.equal((await view.fetch("/meetcue")).body.signedIn, false);
  assert.equal(view.asked.length, 0);
});

test("opening a hosted Home or Canvas rail consumes one project-state response", async () => {
  for (const view of ["", "rail"]) {
    const data = { format:2, rev:"1", project:{ name:"Garden" }, lines:[], pictures:[], notes:[] };
    const server = page(async () => [200, data]);
    const rest = "/state" + (view ? "?for=" + view : "");
    Object.assign(server.c, { S:{ cur:null }, location:{ hash:"#garden" }, project:() => null, stateAsk:() => ({ path:"/projects/garden" + rest }), hostedFirstRoute:() => ({ view:"home" }),
      hostedSummary:state => state.project, hostedProjects:here => [here], hostedState:state => state });
    await server.fetch("/projects");
    const result = await server.fetch("/projects/garden/state" + (view ? "?for=" + view : ""));
    assert.deepEqual(result.body, data);
    assert.deepEqual(server.asked.map(r => r.url), ["/api/v1/line-projects/garden/state" + (view ? "?for=" + view : "")]);
  }
});

test("a Line and its composer open the editor for the same project with the local actions", async () => {
  const { document } = require("./helpers/dom.js").parseHTML('<html><body><div id="thread"></div><div class="lp-dock"><form class="composer" data-preview="1"><button data-act="cmp-plus"></button></form></div></body></html>');
  const project = { id:"garden" }, line = { slug:"plan", stations:[], closed:false }, draws = [], S = { route:{ line:"plan" } };
  const openDrawing = async (p, form, options) => draws.push([p.id, form.className, options?.toLine]);
  const c = vm.createContext({ document, HOSTED:{ key:"garden" }, S, ACT:{}, URLSearchParams, location:{ hash:"#garden/line/plan" },
    LINE_STATUS:require("../public/lines/line-status.js"), navigator:{ platform:"" }, addEventListener() {},
    project:() => project, lineById:() => line, ic:() => "", questionsHTML:() => "", $:s => document.querySelector(s),
    openMenu:(_, items) => { c.menu = items; }, setTimeout:fn => fn(), EMBED:null, toast:assert.fail });
  vm.runInContext([constant(hosted, "HOSTED_OFF"), constant(hosted, "can"), extract(read("state.js"), "canvasUrl")].join("\n"), c);
  for (const name of ["composer.js", "line.js"]) vm.runInContext(read(name), c, { filename:name });
  c.openDrawing = openDrawing;
  document.querySelector("#thread").innerHTML = c.threadHTML(project, line);
  const button = document.querySelector('#thread [data-act="line-draw"]');
  assert.equal(button.textContent, "Add new canvas");
  c.ACT["line-draw"](button);
  c.ACT["cmp-plus"](document.querySelector(".cmp-plus") || document.querySelector('[data-act="cmp-plus"]'));
  assert.deepEqual(Array.from(c.menu, m => m.label), ["Add images or files", "Add new canvas"]);
  c.menu[1].fn();
  assert.deepEqual(draws, [["garden", "composer", "plan"], ["garden", "composer", undefined]]);
  const link = new URL(c.canvasUrl(project, { source:"files/drawing.penecho.json", draft:true }), "https://penecho.ai");
  assert.equal(link.pathname, "/canvas/project");
  assert.equal(link.searchParams.get("linesProject"), "garden");
  assert.equal(link.searchParams.get("linesBack"), "garden/line/plan");
  assert.equal(link.searchParams.get("linesDraft"), "1");
  c.HOSTED.read = true;
  c.ACT["cmp-plus"](document.querySelector('[data-act="cmp-plus"]'));
  assert.ok(!c.menu.some(item => item.label === "Add new canvas"));
});

test("the shared composer picks pictures, draws with touch, undoes, removes and retries a note without a caption", async () => {
  const { window, document } = require("./helpers/dom.js").parseHTML("<html><body></body></html>");
  const sharp = require("sharp"), messages = [], requests = [];
  const line = { id:"garden", stations:[] }, project = { id:"shared" };
  const S = { comp:{}, cur:project.id, route:{ view:"line", line:line.id } };
  const create = document.createElement.bind(document);
  document.createElement = tag => {
    const el = create(tag);
    if (tag === "dialog") {
      el.showModal = () => { el.open = true; };
      el.close = () => { el.open = false; el.dispatchEvent(new window.Event("close")); };
    }
    return el;
  };
  const c = vm.createContext({ document, navigator:{}, File, URL, Response, S, KIND:{ note:{ label:"Note" } },
    HOSTED:{ shared:true, account:{ name:"Ben" }, csrf:"csrf", base:"/share" },
    project:() => project, lineById:() => line, getComputedStyle:() => ({}), refreshAfterChange() {}, scrollToItem() {},
    addEventListener() {}, removeEventListener() {}, requestAnimationFrame() {},
    FileReader:class { async readAsDataURL(blob) { this.result = "data:" + blob.type + ";base64," + Buffer.from(await blob.arrayBuffer()).toString("base64"); this.onload(); } },
    fetch:async (url, req) => {
      requests.push({ url, body:JSON.parse(req.body), headers:req.headers });
      return requests.length === 1 ? Response.json({ message:"Try again." }, { status:503 }) : Response.json({ slug:line.id, step:"note-2" });
    } });
  vm.runInContext([read("core.js"), read("visuals.js"), read("sheet.js"), read("composer.js"),
    constant(hosted, "hostedAnswer"), extract(hosted, "hostedSaid"), constant(hosted, "GUEST_IMAGE_TYPES"),
    ...["hostedGuestBar", "hostedDrawNote", "hostedPictureProblem", "hostedSendNote"].map(name => extract(hosted, name))].join("\n"), c);
  c.toast = msg => messages.push(msg);
  c.refreshBehind = () => {};
  c.rasterize = async url => ({ bytes:await sharp(Buffer.from(decodeURIComponent(url.slice(url.indexOf(",") + 1)))).png().toBuffer() });
  // Redrawing Home on Line Back refreshes the branch preview independently of syncComposer.
  document.body.innerHTML = c.composerHTML("home-shared", { preview:true });
  const homeForm = document.querySelector("form");
  c.renderPathPreview(homeForm, S.comp["home-shared"]);
  assert.deepEqual(Array.from(homeForm.querySelectorAll("button"), b => b.querySelector("span").textContent), ["Add picture", "Draw", "Save as note"]);
  document.body.innerHTML = c.composerHTML("note", { on:"step", topic:line.id, preview:true });
  c.wireComposers();
  const form = document.querySelector("form"), $ = s => document.querySelector(s);
  assert.deepEqual(Array.from(form.querySelectorAll("button"), b => b.querySelector("span").textContent), ["Add picture", "Draw", "Save as note"]);
  assert.equal($(".guest-tools").getAttribute("role"), "group");
  assert.equal($(".guest-tools").getAttribute("aria-label"), "Add media to note");
  assert.equal($(".guest-tools").querySelectorAll("button").length, 2);
  assert.equal($(".send-btn .cmp-key").textContent, "↵");
  assert.equal($("input").accept || $("input").getAttribute("accept"), "image/png,image/jpeg,image/webp,image/gif");
  const pick = $("input"), attach = $("[data-pick-picture]");
  let opened = false;
  pick.click = () => { opened = true; };
  attach.click();
  assert.ok(opened);
  pick.files = [new File(["text"], "notes.txt", { type:"text/plain" })];
  pick.onchange();
  assert.equal(S.comp.note.files.length, 0);
  assert.match(messages.pop(), /Choose a PNG/);
  pick.files = [new File(["test"], "photo.png", { type:"image/png" })];
  pick.onchange();
  assert.ok($(".cmp-file img"));
  vm.runInContext("ACT['cmp-remove'](document.querySelector('[data-act=cmp-remove]'))", c);
  assert.equal(S.comp.note.files.length, 0);

  $("[data-draw-note]").click();
  const surface = $(".guest-drawing .sheet-wrap"), add = $("[data-add]"), undo = $("[data-undo]");
  surface.setPointerCapture = () => {};
  const stroke = () => {
    for (const [i, type] of ["pointerdown", "pointermove", "pointerup"].entries()) {
      const event = Object.assign(new window.Event(type), { pointerType:"touch", pointerId:1, clientX:30 + i * 20, clientY:25 + i * 10, button:0 });
      surface.dispatchEvent(event);
    }
  };
  assert.equal(add.disabled, true);
  stroke(); assert.equal(add.disabled, false);
  undo.click(); assert.equal(add.disabled, true);
  stroke(); await add.onclick();
  assert.equal($("dialog"), null);
  assert.equal(requests.length, 0);
  assert.equal(S.comp.note.files[0].drawing, true);
  form.dispatchEvent(new window.Event("submit", { cancelable:true }));
  await vm.runInContext("SAVING[0].done", c);
  assert.equal(S.comp.note.files.length, 1, "failed save restores the drawing");
  assert.equal(messages.pop(), "Try again.");
  $("textarea").dispatchEvent(Object.assign(new window.Event("keydown"), { key:"Enter", ctrlKey:true }));
  await vm.runInContext("SAVING[0].done", c);
  assert.deepEqual(requests[0], requests[1]);
  const { url, body, headers } = requests[1];
  assert.equal(url, "/share/yours/pictures");
  assert.equal(body.topic, line.id);
  assert.equal(body.text, "");
  assert.equal(headers["x-penecho-csrf"], "csrf");
  assert.equal((await sharp(Buffer.from(body.pictures[0].data, "base64")).metadata()).format, "png");
});
