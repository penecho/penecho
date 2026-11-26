"use strict";
require("./helpers/safety.js");
// Drawing with no setup: one stateless call (POST /api/draw) makes a Canvas and its picture, GET reads it back,
// the user-level skill, MCP drawing tools with no page, and pulling an agent's new drawing into an open page.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const F = require("../src/server/project-lines/format.js");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const { createDraw, parseMultipart } = require("../src/server/draw.js");
const { createMcpService } = require("../src/server/mcp/service.js");
const { compileExpression } = require("../src/server/mcp/no-page.js");
const { pagePicture, browserPath, canRenderPages, localBrowserBlocked, hostedBrowserConfigured } = require("../src/server/project-lines/page-picture.js");

const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penecho-draw-")));
const servers = [];
after(() => { for (const close of servers) close(); fs.rmSync(temp, { recursive:true, force:true }); });
let counter = 0;
const FAKE_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const fakeRenderPage = () => ({ png:FAKE_PNG, checks:null });
const requireBrowserTests = process.env.PENECHO_REQUIRE_BROWSER_TESTS === "1";
const readBody = req => new Promise((resolve, reject) => { let s = ""; req.on("data", d => { s += d; }).on("end", () => { try { resolve(s ? JSON.parse(s) : {}); } catch (error) { reject(error); } }); });
async function setup({ renderPage = fakeRenderPage } = {}) {
  const n = ++counter, directory = path.join(temp, `state-${n}`), docsBase = path.join(temp, `base-${n}`), home = path.join(temp, `home-${n}`);
  fs.mkdirSync(directory, { recursive:true }); fs.mkdirSync(home, { recursive:true });
  const lines = createProjectLines({ directory, agents:createAgents({ env:{ PATH:"" } }), agentPaths:{ home }, serviceOptions:{ autoWatch:false, docsBase, renderPage }, authorizeRead:() => null, authorizeWrite:() => null, isThisComputer:() => true,
    readJson:readBody, send:(res, code, data) => { res.writeHead(code, { "content-type":"application/json" }); res.end(JSON.stringify(data)); } });
  let port = 0;
  const draw = createDraw({ service:lines.service, stateDirectory:directory, origin:() => `http://127.0.0.1:${port}`, home, drawFile:path.join(home, ".penecho", "draw.json") });
  const server = http.createServer(async (req, res) => { const url = new URL(req.url, "http://x"); if (await draw.handle(req, res, url)) return; if (!await lines.handle(req, res, url)) { res.writeHead(404); res.end(); } });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  port = server.address().port;
  await draw.announce(port);
  servers.push(() => { server.close(); lines.close(); });
  const { service } = lines, { token } = JSON.parse(fs.readFileSync(path.join(home, ".penecho", "draw.json"), "utf8"));
  const send = async (fields, { file, name = "map.diagram.json", headers = { "x-penecho-token":token } } = {}) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    if (file !== undefined) form.append("file", new Blob([file]), name);
    const res = await fetch(`http://127.0.0.1:${port}/api/draw`, { method:"POST", headers, body:form });
    return { status:res.status, ...await res.json() };
  };
  const look = async query => { const res = await fetch(`http://127.0.0.1:${port}/api/draw?${new URLSearchParams(query)}`, { headers:{ "x-penecho-token":token } }); return { status:res.status, ...await res.json() }; };
  const lineApi = async (method, route, body) => { const res = await fetch(`http://127.0.0.1:${port}/api/lines${route}`, { method, ...(body ? { headers:{ "content-type":"application/json" }, body:JSON.stringify(body) } : {}) }); return { status:res.status, ...await res.json() }; };
  const project = (name, code) => service.store.create({ name, docsPath:path.join(docsBase, name), ...(code ? { codePath:code } : {}) });
  return { service, draw, port, token, home, docsBase, directory, send, look, lineApi, project };
}
const diagram = (title, extra = []) => JSON.stringify({ type:"workflow", title, nodes:[{ id:"s", label:"Start", type:"start" }, ...extra.map((label, i) => ({ id:`n${i}`, label, type:"process" })), { id:"e", label:"End", type:"end" }], edges:[{ from:"s", to:"e" }] });
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const widgetsOf = bundle => bundle.assets.filter(a => a.kind === "widget").map(a => JSON.parse(Buffer.from(a.dataBase64, "base64").toString("utf8")));
const canvasFiles = dir => { const out = []; const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes:true })) { if (e.name.startsWith(".")) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith(".penecho.json")) out.push(p); } }; try { walk(dir); } catch { /* None. */ } return out; };

test("a draw with no page open makes a Canvas and its picture, and the same call twice makes one Canvas", async () => {
  const t = await setup(), docs = path.join(t.docsBase, "App"), code = path.join(temp, "app-code");
  fs.mkdirSync(path.join(code, "src"), { recursive:true });
  t.project("App", code);
  const working = path.join(code, "src");
  const first = await t.send({ folder:working, title:"How it flows" }, { file:diagram("Flow", ["Check"]) });
  assert.equal(first.status, 200, first.error);
  const project = t.service.store.projects.find(p => p.name === "App");
  assert.equal(first.project, project.id, "a folder inside the project's code folder is that project");
  assert.equal(first.canvas, "map");
  assert.equal(first.path, "files/map/canvas.penecho.json", "a Canvas of its own");
  assert.equal(first.line, "");
  assert.ok(path.isAbsolute(first.png) && fs.statSync(first.png).size > 100, "an absolute path to a real PNG");
  assert.equal(fs.readFileSync(first.png).subarray(1, 4).toString(), "PNG");
  const url = new URL(first.url);
  assert.equal(url.origin, `http://127.0.0.1:${t.port}`);
  assert.equal(url.searchParams.get("linesProject"), project.id);
  assert.equal(url.searchParams.get("linesCanvas"), "files/map/canvas.penecho.json");
  assert.equal(first.title, "How it flows", "title names a new Canvas");
  const bundle = readJson(path.join(docs, "files/map/canvas.penecho.json"));
  assert.equal(widgetsOf(bundle).length, 1);
  assert.equal(widgetsOf(bundle)[0].sourceFormat, "penecho-workflow+json", "an editable native diagram");
  const again = await t.send({ folder:working, title:"How it flows" }, { file:diagram("Flow", ["Check"]) });
  assert.equal(again.status, 200);
  assert.equal(again.path, first.path, "the same call twice is the same Canvas");
  assert.equal(canvasFiles(docs).length, 1, "and only one Canvas file");
  assert.equal(readJson(path.join(docs, "files/map/canvas.penecho.json")).updatedAt, readJson(path.join(docs, "files/map/canvas.penecho.json")).updatedAt);
  // Looking needs no page either.
  const seen = await t.look({ folder:working, canvas:first.canvas });
  assert.equal(seen.status, 200);
  assert.equal(seen.png, first.png);
  assert.equal(seen.name, "map");
  assert.equal(seen.url, first.url);
  assert.ok(seen.updatedAt > 0);
  const listed = await t.look({ folder:working });
  assert.deepEqual(listed.canvases.map(c => c.name), ["map"]);
});

test("an update keeps what the person drew and the other Widgets, and a page that saves an old copy keeps the update", async () => {
  const t = await setup(), project = t.project("Notes");
  const made = await t.send({ folder:project.docsPath }, { file:diagram("Plan"), name:"plan.diagram.json" });
  assert.equal(made.status, 200, made.error);
  const file = path.join(project.docsPath, made.path), read = await t.lineApi("GET", `/projects/${project.id}/canvas?path=${encodeURIComponent(made.path)}`);
  // The page adds ink and a Widget of its own, and saves.
  const page = read.source;
  page.assets.push({ kind:"tile", contentType:"image/png", metadata:{ tileKey:"1,1" }, dataBase64:"iVBORw0KGgo=" });
  const mine = { id:"widget-mine", widgetType:"html_widget", pluginId:"general", x:100, y:100, w:300, h:200, title:"Mine", html:"<p>mine</p>" };
  page.assets.push({ kind:"widget", contentType:"application/json", metadata:{ widgetId:mine.id, pluginId:"general" }, dataBase64:Buffer.from(JSON.stringify(mine)).toString("base64") });
  assert.equal((await t.lineApi("POST", `/projects/${project.id}/canvas`, { path:made.path, source:page, png:null })).status, 200);
  // The agent changes its picture, naming the Canvas it was given and the picture's own name.
  const updated = await t.send({ folder:project.docsPath, canvas:made.canvas }, { file:diagram("Plan", ["Build", "Ship"]), name:"plan.diagram.json" });
  assert.equal(updated.status, 200, updated.error);
  assert.equal(updated.path, made.path);
  const after = readJson(file), widgets = widgetsOf(after);
  assert.ok(after.assets.some(a => a.kind === "tile" && a.metadata.tileKey === "1,1"), "the ink stays");
  assert.ok(widgets.some(w => w.id === "widget-mine"), "the person's Widget stays");
  const drawn = widgets.find(w => w.id !== "widget-mine");
  assert.match(drawn.copyText, /Ship/, "the agent's Widget is updated in place");
  assert.equal(widgets.length, 2);
  // Same name again (no canvas) also updates it.
  const byName = await t.send({ folder:project.docsPath }, { file:diagram("Plan", ["Again"]), name:"plan.diagram.json" });
  assert.equal(byName.path, made.path);
  assert.match(widgetsOf(readJson(file)).find(w => w.id === drawn.id).copyText, /Again/);
  // The page, which never saw the update, saves its old copy: the agent's picture is kept.
  const saved = await t.lineApi("POST", `/projects/${project.id}/canvas`, { path:made.path, source:page, png:null });
  assert.deepEqual(saved.changed, [drawn.id]);
  assert.match(widgetsOf(readJson(file)).find(w => w.id === drawn.id).copyText, /Again/);
  // Another name on the same Canvas is one more picture on it, and that name again updates only that one.
  const second = await t.send({ folder:project.docsPath, canvas:made.canvas }, { file:diagram("Data", ["Rows"]), name:"data-model.diagram.json" });
  assert.equal(second.path, made.path);
  assert.ok(second.png.endsWith("canvas+data-model.png"), "png is the picture just drawn");
  assert.ok(second.canvasPng.endsWith("canvas.png"));
  let all = widgetsOf(readJson(file));
  assert.equal(all.length, 3);
  const other = all.find(w => w.id !== drawn.id && w.id !== "widget-mine");
  assert.match(other.copyText, /Rows/);
  await t.send({ folder:project.docsPath, canvas:made.canvas }, { file:diagram("Data", ["Columns"]), name:"data-model.diagram.json" });
  all = widgetsOf(readJson(file));
  assert.equal(all.length, 3);
  assert.match(all.find(w => w.id === other.id).copyText, /Columns/);
  assert.match(all.find(w => w.id === drawn.id).copyText, /Again/, "the first picture is untouched");
});

test("a folder in no project lands in My Canvases, and a line can be named", async () => {
  const t = await setup(), loose = path.join(temp, "somewhere-else");
  fs.mkdirSync(loose, { recursive:true });
  assert.equal(t.service.store.myCanvases({ create:false }), null, "there is no My Canvases yet");
  const made = await t.send({ folder:loose }, { file:"<!doctype html><title>Try it</title><p>Hello</p>", name:"try.explorer.html" });
  assert.equal(made.status, 200, made.error);
  const mine = t.service.store.myCanvases({ create:false });
  assert.ok(mine, "My Canvases is made");
  assert.equal(made.project, mine.id);
  assert.equal(made.path, "files/try/canvas.penecho.json");
  assert.ok(fs.existsSync(made.png));
  assert.ok(t.service.stateOf(mine).pictures.some(p => p.source === made.path), "it is one of My Canvases' Canvases");
  // On a line of a project.
  const project = t.project("Lines");
  const { slug } = await t.service.saveUnsent(project, { text:"Draw the steps" });
  const onLine = await t.send({ folder:project.docsPath, line:slug }, { file:diagram("Steps"), name:"steps.diagram.json" });
  assert.equal(onLine.status, 200, onLine.error);
  assert.equal(onLine.line, slug);
  assert.equal(onLine.path, `files/${slug}/steps.penecho.json`);
  assert.equal(new URL(onLine.url).searchParams.get("linesDoc"), `lines/${slug}.md`);
  assert.match(fs.readFileSync(path.join(project.docsPath, `lines/${slug}.md`), "utf8"), /\(\.\.\/files\/[^)]+\/steps\.png\)/, "the line shows the picture");
  assert.equal((await t.send({ folder:project.docsPath, line:"no-such-line" }, { file:diagram("X") })).status, 404);
});

test("no token, a wrong token, a cross-site post and bad input are refused", async () => {
  const t = await setup(), folder = path.join(temp, "safe");
  fs.mkdirSync(folder, { recursive:true });
  const stat = fs.statSync(path.join(t.home, ".penecho", "draw.json"));
  if (process.platform !== "win32") assert.equal(stat.mode & 0o777, 0o600, "the token file is this user's only");
  assert.equal(JSON.parse(fs.readFileSync(path.join(t.home, ".penecho", "draw.json"), "utf8")).port, t.port);
  const none = await t.send({ folder }, { file:diagram("X"), headers:{} });
  assert.equal(none.status, 401); assert.equal(none.code, "BAD_TOKEN");
  const wrong = await t.send({ folder }, { file:diagram("X"), headers:{ "x-penecho-token":"0".repeat(64) } });
  assert.equal(wrong.status, 401);
  // A form on another site posting here: the browser sends its Origin, and cannot add the token.
  const raw = (headers, body = "folder=x") => new Promise(resolve => {
    const req = http.request({ host:"127.0.0.1", port:t.port, path:"/api/draw", method:"POST", headers:{ "content-type":"application/x-www-form-urlencoded", "content-length":Buffer.byteLength(body), ...headers } }, res => { let s = ""; res.on("data", d => { s += d; }).on("end", () => resolve({ status:res.statusCode, ...JSON.parse(s) })); });
    req.end(body);
  });
  const cross = await raw({ origin:"https://evil.example" });
  assert.equal(cross.status, 403); assert.equal(cross.code, "CROSS_SITE");
  assert.equal((await raw({ origin:"https://evil.example", "x-penecho-token":t.token })).status, 403, "even with the token");
  assert.equal((await raw({ "sec-fetch-site":"cross-site", "x-penecho-token":t.token })).status, 403);
  assert.equal((await raw({ host:"evil.example", "x-penecho-token":t.token })).status, 403, "a name that is not this computer (DNS rebinding)");
  assert.equal(canvasFiles(t.docsBase).length, 0, "nothing was written");
  // The folder must be a real folder, and the file one PenEcho can draw.
  assert.equal((await t.send({ folder:"relative/path" }, { file:diagram("X") })).status, 400);
  assert.equal((await t.send({ folder:path.join(temp, "missing") }, { file:diagram("X") })).status, 404);
  assert.equal((await t.send({ folder:path.join(t.home, ".penecho", "draw.json") }, { file:diagram("X") })).code, "BAD_FOLDER");
  assert.equal((await t.send({ folder }, { file:"x", name:"notes.txt" })).code, "BAD_FILE");
  const broken = await t.send({ folder }, { file:"{not json", name:"a.diagram.json" });
  assert.equal(broken.code, "BAD_PICTURE"); assert.match(broken.error, /JSON/);
  assert.equal((await t.send({ folder })).code, "BAD_FILE", "no file");
  assert.equal(canvasFiles(t.docsBase).length, 0);
  assert.equal((await t.look({ folder, canvas:"../../etc" })).status, 400);
});

test("the form parser reads what curl -F sends", () => {
  const boundary = "----x", body = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="folder"\r\n\r\n/tmp/a b\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="m.diagram.json"\r\nContent-Type: application/octet-stream\r\n\r\n{"a":1}\r\n--${boundary}--\r\n`);
  const form = parseMultipart(body, `multipart/form-data; boundary=${boundary}`);
  assert.equal(form.fields.folder, "/tmp/a b");
  assert.equal(form.files[0].filename, "m.diagram.json");
  assert.equal(form.files[0].data.toString(), '{"a":1}');
  assert.throws(() => parseMultipart(body, "application/json"), /multipart/);
});

test("the distinct local skill coexists with Cloud and only removes PenEcho-marked legacy copies", async () => {
  const t = await setup(), claude = path.join(t.home, ".claude/skills", F.LOCAL_SKILL_NAME, "SKILL.md"), agentsFile = path.join(t.home, ".agents/skills", F.LOCAL_SKILL_NAME, "SKILL.md");
  assert.equal(t.service.home, t.home, "agentPaths.home reaches Service and never falls back to the owner's real home");
  const cloudFile = path.join(t.home, ".agents/skills/penecho-canvas/SKILL.md"), legacyFile = path.join(t.home, ".claude/skills/penecho-canvas/SKILL.md"), cloud = "PenEcho Cloud https://penecho.ai/mcp — my own skill";
  fs.mkdirSync(path.dirname(cloudFile), { recursive:true }); fs.writeFileSync(cloudFile, cloud);
  fs.mkdirSync(path.dirname(legacyFile), { recursive:true }); fs.writeFileSync(legacyFile, F.drawingSkill({ name:"Old local", drop:"/old/.penecho/drawings" }));
  let status = await t.lineApi("GET", "/agents/skill");
  assert.equal(status.installed, false);
  assert.deepEqual(status.places.map(p => p.state), ["missing", "missing"], "Cloud's different skill is not the local one");
  status = await t.lineApi("POST", "/agents/skill", { install:true });
  assert.equal(status.installed, true);
  assert.deepEqual(status.places.map(p => p.state), ["installed", "installed"]);
  const text = fs.readFileSync(claude, "utf8");
  assert.match(text, new RegExp(`^---\\nname: ${F.LOCAL_SKILL_NAME}\\ndescription: Use when asked to draw`));
  assert.match(text, /interactive explorer/);
  assert.match(text, /clickable UI prototype/);
  assert.match(text, /note cards/);
  assert.match(text, /PPT/);
  assert.match(text, /local PenEcho desktop Canvas for this computer's local projects/);
  assert.match(text, /~\/\.penecho\/draw\.json/, "it reads the token file");
  assert.match(text, /curl -s http:\/\/127\.0\.0\.1:PORT\/api\/draw -H "x-penecho-token: TOKEN" -F folder="\$PWD" -F file=@/);
  assert.match(text, /PowerShell: `curl\.exe -s http:\/\/127\.0\.0\.1:PORT\/api\/draw[\s\S]*\$\(\$PWD\.Path\)[\s\S]*\$env:TEMP/);
  assert.match(text, /cmd\.exe: `curl\.exe -s http:\/\/127\.0\.0\.1:PORT\/api\/draw[\s\S]*%CD%[\s\S]*%TEMP%/);
  assert.match(text, /PowerShell: `curl\.exe -s -G http:\/\/127\.0\.0\.1:PORT\/api\/draw[\s\S]*\$\(\$PWD\.Path\)/);
  assert.match(text, /cmd\.exe: `curl\.exe -s -G http:\/\/127\.0\.0\.1:PORT\/api\/draw[\s\S]*%CD%/);
  assert.match(text, /Written by PenEcho/);
  assert.doesNotMatch(text, /\.penecho\/drawings/, "the user skill has no drop-folder fallback");
  assert.match(text, /tell the person to start PenEcho/i);
  for (const file of [claude, agentsFile]) {
    assert.ok(fs.existsSync(path.join(path.dirname(file), "ppt-slides.md")), "the slide rules sit beside it");
    assert.ok(fs.existsSync(path.join(path.dirname(file), "design-prototype.md")), "the prototype rules sit beside it");
  }
  assert.equal(fs.readFileSync(cloudFile, "utf8"), cloud, "Cloud's unmarked skill is untouched");
  assert.ok(!fs.existsSync(path.dirname(legacyFile)), "our old user-level copy is retired");
  status = await t.lineApi("POST", "/agents/skill", { install:false });
  assert.equal(status.installed, false);
  assert.ok(!fs.existsSync(path.dirname(claude)), "PenEcho's local copy is gone");
  assert.ok(!fs.existsSync(path.dirname(agentsFile)), "both local homes are removed");
  assert.equal(fs.readFileSync(cloudFile, "utf8"), cloud, "removal never touches Cloud either");
  assert.equal((await t.lineApi("POST", "/agents/skill", {})).status, 400);
  // The legacy template is retained only so old copies can be recognized and migrated.
  const project = F.drawingSkill({ name:"Demo", drop:"/x/.penecho/drawings" });
  assert.match(project, /^---\nname: penecho-canvas/);
  assert.ok(project.indexOf("/api/draw") < project.indexOf("/x/.penecho/drawings"));
  assert.ok(project.indexOf("## If PenEcho cannot be reached") < project.indexOf("/x/.penecho/drawings"));
});

test("folder-based drawing honors canvasSkill false without blocking allowed project calls", async () => {
  const t = await setup(), enabled = t.project("Enabled"), disabled = t.project("Disabled");
  disabled.canvasSkill = false; t.service.store.save();
  const denied = await t.send({ folder:disabled.docsPath }, { file:diagram("Not allowed") });
  assert.equal(denied.status, 403);
  assert.equal(denied.code, "SKILL_DISABLED");
  assert.match(denied.error, /Project settings/);
  assert.equal(canvasFiles(disabled.docsPath).length, 0, "a disabled folder draw writes nothing");
  const byId = await t.send({ project:disabled.id }, { file:diagram("PenEcho Work") });
  assert.equal(byId.status, 200, byId.error);
  assert.equal(byId.project, disabled.id, "PenEcho-launched Works keep their explicit project");
  const viewed = await t.look({ folder:disabled.docsPath, view:"1" });
  assert.equal(viewed.status, 200, viewed.error);
  assert.notEqual(viewed.code, "SKILL_DISABLED");
  const byDefault = await t.send({ folder:enabled.docsPath }, { file:diagram("Default") });
  assert.equal(byDefault.status, 200, byDefault.error);
  enabled.canvasSkill = true; t.service.store.save();
  const expresslyOn = await t.send({ folder:enabled.docsPath, name:"on.diagram.json" }, { file:diagram("On") });
  assert.equal(expresslyOn.status, 200, expresslyOn.error);
  const loose = path.join(temp, "disabled-skill-loose"); fs.mkdirSync(loose, { recursive:true });
  const mine = await t.send({ folder:loose }, { file:diagram("My Canvas") });
  assert.equal(mine.status, 200, mine.error);
  assert.equal(mine.project, t.service.store.myCanvases({ create:false }).id, "unknown folders still use My Canvases");
});

test("two projects keep drawings separate across main checkouts and external linked worktrees", async () => {
  const t = await setup(), git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding:"utf8", stdio:["ignore", "pipe", "pipe"] }).trim();
  const repo = name => {
    const dir = path.join(temp, `draw-repo-${name}`); fs.mkdirSync(dir, { recursive:true });
    git(dir, "init", "-q", "-b", "main"); git(dir, "config", "user.name", "Test"); git(dir, "config", "user.email", "test@example.com");
    fs.writeFileSync(path.join(dir, "README.md"), `${name}\n`); git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", "first");
    return dir;
  };
  const codeA = repo("a"), codeB = repo("b"), a = t.project("Project A", codeA), b = t.project("Project B", codeB);
  const workA = path.join(temp, "external-a"), workB = path.join(temp, "external-b");
  git(codeA, "worktree", "add", "-q", "-b", "side-a", workA); git(codeB, "worktree", "add", "-q", "-b", "side-b", workB);
  const nestedA = path.join(workA, "nested/deep"); fs.mkdirSync(nestedA, { recursive:true });
  const fromA = await t.send({ folder:nestedA }, { file:diagram("A flow"), name:"shared.diagram.json" });
  assert.equal(fromA.status, 200, fromA.error); assert.equal(fromA.project, a.id);
  const fromB = await t.send({ folder:workB }, { file:diagram("B flow"), name:"shared.diagram.json" });
  assert.equal(fromB.status, 200, fromB.error); assert.equal(fromB.project, b.id);
  const sourceA = path.join(a.docsPath, "files/shared/canvas.diagram.json"), sourceB = path.join(b.docsPath, "files/shared/canvas.diagram.json");
  assert.match(fs.readFileSync(sourceA, "utf8"), /A flow/);
  assert.match(fs.readFileSync(sourceB, "utf8"), /B flow/);
  assert.doesNotMatch(fs.readFileSync(sourceA, "utf8"), /B flow/);
  assert.doesNotMatch(fs.readFileSync(sourceB, "utf8"), /A flow/);
  fs.mkdirSync(path.join(codeA, "src"), { recursive:true }); fs.mkdirSync(path.join(codeB, "src"), { recursive:true });
  assert.equal((await t.send({ folder:path.join(codeA, "src") }, { file:diagram("A main"), name:"main-a.diagram.json" })).project, a.id);
  assert.equal((await t.send({ folder:path.join(codeB, "src") }, { file:diagram("B main"), name:"main-b.diagram.json" })).project, b.id);
});

test("ambiguous sibling worktree draws are refused with 409 while explicit project ids still work, and global skill uninstall persists across keepSkill", async () => {
  const t = await setup(), git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding:"utf8", stdio:["ignore", "pipe", "pipe"] }).trim();
  const mainRepo = path.join(temp, "draw-ambig-main");
  fs.mkdirSync(mainRepo, { recursive:true });
  git(mainRepo, "init", "-q", "-b", "main"); git(mainRepo, "config", "user.name", "Test"); git(mainRepo, "config", "user.email", "test@example.com");
  fs.writeFileSync(path.join(mainRepo, "README.md"), "shared\n"); git(mainRepo, "add", "-A"); git(mainRepo, "commit", "-q", "-m", "first");
  const workB = path.join(temp, "draw-ambig-b"), workThird = path.join(temp, "draw-ambig-third");
  git(mainRepo, "worktree", "add", "-q", "-b", "b-branch", workB);
  git(mainRepo, "worktree", "add", "-q", "-b", "third-branch", workThird);
  const a = t.project("Shared A", mainRepo), b = t.project("Shared B", workB);
  // Third sibling worktree is claimed at equal depth by both A and B: must be refused rather than resolved by order.
  const denied = await t.send({ folder:workThird }, { file:diagram("Ambiguous") });
  assert.equal(denied.status, 409);
  assert.equal(denied.code, "AMBIGUOUS_PROJECT");
  const lookDenied = await t.look({ folder:workThird });
  assert.equal(lookDenied.status, 409);
  assert.equal(lookDenied.code, "AMBIGUOUS_PROJECT");
  // Direct checkouts and explicit project IDs remain unambiguous and succeed.
  assert.equal((await t.send({ folder:mainRepo }, { file:diagram("A direct"), name:"a.diagram.json" })).project, a.id);
  assert.equal((await t.send({ folder:workB }, { file:diagram("B direct"), name:"b.diagram.json" })).project, b.id);
  assert.equal((await t.send({ project:b.id }, { file:diagram("Explicit B"), name:"exp.diagram.json" })).project, b.id);
  // Global uninstall via /agents/skill persists across background keepSkill() until explicitly re-enabled.
  await t.service.addSkill(a);
  assert.equal((await t.lineApi("GET", "/agents/skill")).installed, true);
  assert.equal((await t.lineApi("POST", "/agents/skill", { install:false })).installed, false);
  t.service.skillKept.clear();
  await t.service.keepSkill(a);
  assert.equal((await t.lineApi("GET", "/agents/skill")).installed, false, "keepSkill must not silently undo global uninstall");
  assert.equal((await t.lineApi("POST", "/agents/skill", { install:true })).installed, true, "explicit install re-enables it");
});

test("MCP drawing tools with no page connected return a link and a picture instead of an error", async () => {
  const t = await setup(), folder = path.join(temp, "mcp-folder"), registry = path.join(temp, `registry-${counter}`);
  fs.mkdirSync(folder, { recursive:true });
  const mcp = createMcpService({ server:new http.Server(), authorizeBrowser:() => null, rootDirectory:process.cwd(), stateDirectory:registry, registryStateDirectory:registry, autoStartHttp:false, draw:args => t.draw.draw(args) });
  servers.push(() => { void mcp.close(); });
  const owner = crypto.randomUUID();
  const widget = await mcp.callTool(owner, "penecho_present_widget", { artifactId:"flow-map", title:"Flow map", requestId:"r1", folder, workflow:{ version:1, title:"Flow", nodes:[{ id:"s", label:"Start", type:"start" }, { id:"e", label:"End", type:"end" }], edges:[{ from:"s", to:"e" }] } });
  assert.equal(widget.noPage, true);
  assert.equal(widget.applied, true);
  assert.ok(widget.url.includes("linesCanvas=files%2Fflow-map%2Fcanvas.penecho.json"));
  assert.ok(fs.existsSync(widget.png));
  assert.equal(widget.project, t.service.store.myCanvases({ create:false }).id);
  // A session from a page that is gone draws the same way, and the same artifactId updates the same Canvas.
  const again = await mcp.callTool(owner, "penecho_present_widget", { sessionId:"gone", artifactId:"flow-map", title:"Flow map", requestId:"r2", folder, workflow:{ version:1, title:"Flow", nodes:[{ id:"s", label:"Start", type:"start" }, { id:"m", label:"Middle", type:"process" }, { id:"e", label:"End", type:"end" }], edges:[{ from:"s", to:"m" }, { from:"m", to:"e" }] } });
  assert.equal(again.path, widget.path);
  const plot = await mcp.callTool(owner, "penecho_plot", { artifactId:"wave", title:"Wave", requestId:"r3", expression:"sin(x)", project:"my-canvases" });
  assert.equal(plot.noPage, true);
  assert.ok(fs.existsSync(path.join(t.service.store.myCanvases({ create:false }).docsPath, "files/wave/canvas.explorer.html")));
  const drawn = await mcp.callTool(owner, "penecho_draw", { artifactId:"boxes", title:"Boxes", requestId:"r4", items:[{ id:"a", type:"rect", text:"A" }, { id:"b", type:"ellipse", text:"B" }, { id:"ab", type:"arrow", from:"a", to:"b" }] });
  assert.equal(drawn.canvas, "boxes", "no folder or project: My Canvases");
  await assert.rejects(mcp.callTool(owner, "penecho_plot", { artifactId:"bad", title:"Bad", requestId:"r5", expression:"require('fs')", folder }), error => error.code === "invalid_arguments");
  await assert.rejects(mcp.callTool(owner, "penecho_plot", { artifactId:"far", title:"Far", requestId:"r6", expression:"x", folder }, { ipDirect:true }), /IP direct/);
  // Without a draw function (Cloud) the old answer stands.
  const old = createMcpService({ server:new http.Server(), authorizeBrowser:() => null, rootDirectory:process.cwd(), stateDirectory:registry, registryStateDirectory:registry, autoStartHttp:false });
  servers.push(() => { void old.close(); });
  await assert.rejects(old.callTool(owner, "penecho_plot", { sessionId:"gone", artifactId:"w", title:"W", requestId:"r7", expression:"x" }), error => error.code === "session_not_found");
});

test("the plot language is the Canvas's and nothing more", () => {
  assert.equal(compileExpression("y = 2*x^2 + 1")(3), 19);
  assert.ok(Math.abs(compileExpression("sin(pi/2)")(0) - 1) < 1e-9);
  for (const bad of ["process.exit()", "constructor", "x;1", "a(x)"]) assert.throws(() => compileExpression(bad));
});

test("pull answers only what an agent drew since the page read the Canvas, and writes nothing", async () => {
  const t = await setup(), project = t.project("Pull");
  const made = await t.send({ folder:project.docsPath }, { file:diagram("One"), name:"one.diagram.json" });
  const file = path.join(project.docsPath, made.path), read = await t.lineApi("GET", `/projects/${project.id}/canvas?path=${encodeURIComponent(made.path)}`);
  const sources = read.source.manifest.extensions["penecho.lines"].sources;
  const same = await t.lineApi("POST", `/projects/${project.id}/canvas/pull`, { path:made.path, sources });
  assert.equal(same.status, 200);
  assert.deepEqual(same.widgets, [], "nothing changed, nothing to apply");
  assert.deepEqual(same.sources, sources);
  assert.equal(same.name, "");
  await t.send({ folder:project.docsPath, canvas:made.canvas }, { file:diagram("One", ["Two"]), name:"one.diagram.json" });
  const before = fs.readFileSync(file, "utf8"), mtime = fs.statSync(file).mtimeMs;
  const pulled = await t.lineApi("POST", `/projects/${project.id}/canvas/pull`, { path:made.path, sources });
  assert.equal(pulled.widgets.length, 1, "only the Widget the agent changed");
  assert.match(pulled.widgets[0].copyText, /Two/);
  const id = pulled.widgets[0].id;
  assert.notEqual(pulled.sources[id], sources[id], "its source is the new one");
  assert.equal(fs.readFileSync(file, "utf8"), before, "nothing was written");
  assert.equal(fs.statSync(file).mtimeMs, mtime);
  // A rename made elsewhere comes too, when the page says the name it has.
  await t.lineApi("POST", `/projects/${project.id}/canvases/rename`, { path:made.path, title:"Renamed" });
  assert.equal((await t.lineApi("POST", `/projects/${project.id}/canvas/pull`, { path:made.path, sources:pulled.sources, name:"Old" })).name, "Renamed");
  // It waits its turn for the file, as a save and a picture do.
  let released;
  const held = t.service.withCanvas(project, made.path, () => new Promise(r => { released = r; }));
  let done = false;
  const waiting = t.lineApi("POST", `/projects/${project.id}/canvas/pull`, { path:made.path, sources }).then(v => { done = true; return v; });
  await new Promise(r => setTimeout(r, 150));
  assert.equal(done, false, "pull waits for the Canvas's lock");
  released(); await held;
  assert.equal((await waiting).status, 200);
  assert.equal((await t.lineApi("POST", `/projects/${project.id}/canvas/pull`, { path:"files/none/canvas.penecho.json", sources:{} })).status, 404);
});

test("review finding 5: a drawing name is remembered per line, so one line's drawing never replaces another's picture", async () => {
  const t = await setup(), project = t.project("Two lines");
  const { slug:a } = await t.service.saveUnsent(project, { text:"Line A" });
  const { slug:b } = await t.service.saveUnsent(project, { text:"Line B" });
  const onA = await t.send({ folder:project.docsPath, line:a }, { file:diagram("A's map"), name:"map.diagram.json" });
  assert.equal(onA.path, `files/${a}/map.penecho.json`);
  const loose = await t.send({ folder:project.docsPath }, { file:diagram("Someone else's map"), name:"map.diagram.json" });
  assert.notEqual(loose.path, onA.path, "a call for no line does not take line A's picture");
  const onB = await t.send({ folder:project.docsPath, line:b }, { file:diagram("B's map"), name:"map.diagram.json" });
  assert.equal(onB.path, `files/${b}/map.penecho.json`);
  assert.match(JSON.stringify(readJson(path.join(project.docsPath, onA.path))), /A's map/, "line A's picture is untouched");
  const again = await t.send({ folder:project.docsPath, line:a }, { file:diagram("A's map, v2"), name:"map.diagram.json" });
  assert.equal(again.path, onA.path, "the same line and name still update its own picture");
});

test("slides sent again to the Canvas of a deck replace that deck's slides, also under another file name", async () => {
  const t = await setup(), project = t.project("Deck");
  const slide = (n, words) => `<div class="slide" data-penecho-slide data-penecho-deck="Sales review" style="width:1280px;height:720px"><h1>Slide ${n}</h1><p>${words}</p></div>`;
  const first = await t.send({ folder:project.docsPath }, { file:slide(1, "first version"), name:"sales.slide-01.html" });
  assert.equal(first.status, 200);
  await t.send({ folder:project.docsPath }, { file:slide(2, "first version"), name:"sales.slide-02.html" });
  const file = path.join(project.docsPath, first.path), slidesOf = () => widgetsOf(readJson(file)).filter(w => /data-penecho-slide/.test(w.html));
  assert.equal(slidesOf().length, 2);
  // The agent is asked to fix slide 2 and sends it to that Canvas under a name of its own.
  const fixed = await t.send({ folder:project.docsPath, canvas:first.canvas }, { file:slide(2, "fixed"), name:"sales-fixed.slide-02.html" });
  assert.equal(fixed.status, 200);
  assert.equal(fixed.path, first.path);
  const now = slidesOf();
  assert.equal(now.length, 2, "the fixed slide took the old one's place");
  assert.ok(now.some(w => /fixed/.test(w.html)) && !now.some(w => /Slide 2<\/h1><p>first version/.test(w.html)), "the old slide 2 is gone");
  assert.ok(now.some(w => /Slide 1<\/h1><p>first version/.test(w.html)), "slide 1 is untouched");
  // What Download PPT reads is the new deck, in order.
  const deck = t.service.canvasSlides(project, first.path).slides.map(s => /<p>([^<]+)/.exec(s.html)[1]);
  assert.deepEqual(deck, ["first version", "fixed"]);
  // A third slide under the new name joins the same deck.
  await t.send({ folder:project.docsPath, canvas:first.canvas }, { file:slide(3, "added"), name:"sales-fixed.slide-03.html" });
  assert.deepEqual(t.service.canvasSlides(project, first.path).slides.map(s => /<p>([^<]+)/.exec(s.html)[1]), ["first version", "fixed", "added"]);
});

test("review finding 8: a second PenEcho does not take draw.json from one that is still running, takes it over once that one has gone, and each removes only its own", async () => {
  const home = fs.mkdtempSync(path.join(temp, "two-")), file = path.join(home, ".penecho", "draw.json");
  const make = n => { const directory = path.join(home, `state-${n}`); fs.mkdirSync(directory); return createDraw({ service:{ store:{ projects:[] } }, stateDirectory:directory, origin:() => "", home, drawFile:file }); };
  const listen = () => new Promise(r => { const server = http.createServer((q, s) => s.end()); server.listen(0, "127.0.0.1", () => r(server)); });
  const a = make(1), b = make(2), serverA = await listen(), serverB = await listen();
  assert.equal((await a.announce(serverA.address().port)).written, true);
  const second = await b.announce(serverB.address().port);
  assert.deepEqual([second.written, second.port], [false, serverA.address().port], "the running one keeps it");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).token, a.token);
  b.withdraw();
  assert.ok(fs.existsSync(file), "B removes nothing that is not its own");
  await new Promise(r => serverA.close(r));
  assert.equal((await b.announce(serverB.address().port)).written, true, "once A has gone, B takes it over");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).token, b.token);
  a.withdraw();
  assert.ok(fs.existsSync(file), "A, quitting late, leaves B's file");
  b.withdraw();
  assert.ok(!fs.existsSync(file), "B removes its own on exit");
  serverB.close();
});

test("review finding 9: a failed draw leaves the folder as it was, and the same call works once its cause is gone", async () => {
  const t = await setup(), project = t.project("Retry");
  const made = await t.send({ folder:project.docsPath }, { file:"<!doctype html><title>Page</title><p>v1</p>", name:"board.explorer.html" });
  const canvasFile = path.join(project.docsPath, made.path), sourceFile = path.join(project.docsPath, "files/board/canvas.explorer.html");
  // The Canvas file gets broken; drawing a diagram onto it fails.
  const good = fs.readFileSync(canvasFile, "utf8");
  fs.writeFileSync(canvasFile, "{ broken");
  const failed = await t.send({ folder:project.docsPath, canvas:made.canvas }, { file:diagram("Board"), name:"board.diagram.json" });
  assert.equal(failed.status, 400);
  assert.ok(!fs.existsSync(path.join(project.docsPath, "files/board/canvas.diagram.json")), "the new source file is taken back");
  assert.match(fs.readFileSync(sourceFile, "utf8"), /v1/, "and the page it would have replaced is back");
  // Fixed: the very same call now works, instead of repeating the old error.
  fs.writeFileSync(canvasFile, good);
  const worked = await t.send({ folder:project.docsPath, canvas:made.canvas }, { file:diagram("Board"), name:"board.diagram.json" });
  assert.equal(worked.status, 200, worked.error);
});

test("R9: a Widget drawn on the Canvas itself gets a file, and that file or its id changes it where it stands", async () => {
  const t = await setup(), docs = path.join(t.docsBase, "Clock");
  const project = t.project("Clock");
  const { newBundle } = require("../src/server/project-lines/canvas-file.js");
  const bundle = newBundle({ id:"lines-clock", name:"Clock" });
  const widget = { id:"widget-1", widgetType:"html_widget", pluginId:"general", x:3100, y:2700, w:900, h:560, contentW:1200, contentH:750, title:"Clock", refreshSeconds:0, html:"<!doctype html><title>Clock</title><p style=\"color:#333\">12:00</p>" };
  bundle.assets.push({ kind:"widget", contentType:"application/json", metadata:{ widgetId:"widget-1", pluginId:"general" }, dataBase64:Buffer.from(JSON.stringify(widget)).toString("base64") });
  const canvas = path.join(docs, "files/clock/canvas.penecho.json");
  fs.mkdirSync(path.dirname(canvas), { recursive:true });
  fs.writeFileSync(canvas, JSON.stringify(bundle));

  const seen = await t.look({ project:project.id, canvas:"clock" });
  assert.equal(seen.status, 200, seen.error);
  const file = path.join(docs, "files/clock/canvas+widget-1.explorer.html");
  assert.deepEqual(seen.widgets, [{ id:"widget-1", title:"Clock", file, box:{ x:3100, y:2700, w:900, h:560 } }], "each Widget with where it is and the file it is drawn from");
  assert.equal(fs.readFileSync(file, "utf8"), widget.html, "the Widget's own page, written out");
  assert.ok(fs.statSync(file).mtimeMs < fs.statSync(canvas).mtimeMs, "dated before the Canvas");
  const before = fs.readFileSync(canvas, "utf8");
  await t.service.makePictures(project);
  assert.equal(fs.readFileSync(canvas, "utf8"), before, "writing the file out redraws nothing");

  // Edited where it is, as an agent would: the same Widget changes, where the person put it.
  fs.writeFileSync(file, "<!doctype html><title>Clock</title><p style=\"color:#e11d48\">12:00</p>");
  await t.service.makePictures(project);
  let widgets = widgetsOf(readJson(canvas));
  assert.equal(widgets.length, 1, "never a second clock");
  assert.equal(widgets[0].id, "widget-1");
  assert.match(widgets[0].html, /#e11d48/);
  assert.deepEqual([widgets[0].x, widgets[0].y, widgets[0].w, widgets[0].h], [3100, 2700, 900, 560]);
  assert.equal(widgets[0].title, "Clock");

  // Or sent with its id, under any name.
  const sent = await t.send({ project:project.id, canvas:"clock", widget:"widget-1" }, { file:"<!doctype html><title>Clock</title><p style=\"color:#16a34a\">12:00</p>", name:"colorful.explorer.html" });
  assert.equal(sent.status, 200, sent.error);
  widgets = widgetsOf(readJson(canvas));
  assert.equal(widgets.length, 1);
  assert.match(widgets[0].html, /#16a34a/);
  assert.deepEqual([widgets[0].x, widgets[0].y], [3100, 2700]);
  assert.ok(!fs.existsSync(path.join(docs, "files/clock/canvas+colorful.explorer.html")), "it is that Widget's file, not one more picture");
  assert.equal(fs.readFileSync(file, "utf8").includes("#16a34a"), true);
  const again = await t.look({ project:project.id, canvas:"clock" });
  assert.equal(fs.readFileSync(again.widgets[0].file, "utf8").includes("#16a34a"), true, "a file the agent sent back stays as it sent it");

  // Or sent under the file's own name.
  const named = await t.send({ project:project.id, canvas:"clock" }, { file:"<!doctype html><title>Clock</title><p style=\"color:#2563eb\">12:00</p>", name:"canvas+widget-1.explorer.html" });
  assert.equal(named.status, 200, named.error);
  widgets = widgetsOf(readJson(canvas));
  assert.equal(widgets.length, 1);
  assert.match(widgets[0].html, /#2563eb/);

  const missing = await t.send({ project:project.id, canvas:"clock", widget:"widget-9" }, { file:"<!doctype html><p>x</p>", name:"x.explorer.html" });
  assert.equal(missing.status, 404);
  assert.equal(widgetsOf(readJson(canvas)).length, 1);
  const noCanvas = await t.send({ project:project.id, widget:"widget-1" }, { file:"<!doctype html><p>x</p>", name:"x.explorer.html" });
  assert.equal(noCanvas.status, 400);
  const slide = await t.send({ project:project.id, canvas:"clock", widget:"widget-1" }, { file:"<!doctype html><p>x</p>", name:"deck.slide-01.html" });
  assert.equal(slide.status, 400);
});

test("two files for one Widget: the newest is drawn, the older goes, and nothing redraws after", async () => {
  const t = await setup(), docs = path.join(t.docsBase, "Clocks");
  const project = t.project("Clocks");
  const dir = path.join(docs, "files/clock"), canvas = path.join(dir, "canvas.penecho.json");
  fs.mkdirSync(dir, { recursive:true });
  const first = path.join(dir, "canvas+clock.explorer.html");
  fs.writeFileSync(first, "<!doctype html><title>Clock</title><p style=\"color:#333\">12:00</p>");
  await t.service.makePictures(project);
  const [made] = widgetsOf(readJson(canvas));
  // An agent changes that Widget through the file named for it, and the first file is still there.
  const named = path.join(dir, `canvas+${made.id}.explorer.html`);
  fs.writeFileSync(named, "<!doctype html><title>Clock</title><p style=\"color:#e11d48\">12:00</p>");
  const later = new Date(fs.statSync(first).mtimeMs + 5000);
  fs.utimesSync(named, later, later);
  await t.service.makePictures(project);
  assert.match(fs.readFileSync(first, "utf8"), /#e11d48/, "the newer text is in the file the Widget has");
  assert.ok(!fs.existsSync(named), "and only there");
  let widgets = widgetsOf(readJson(canvas));
  assert.equal(widgets.length, 1);
  assert.match(widgets[0].html, /#e11d48/, "the Canvas shows the file that is left");
  const settled = fs.readFileSync(canvas, "utf8");
  for (let i = 0; i < 3; i++) await t.service.makePictures(project);
  assert.equal(fs.readFileSync(canvas, "utf8"), settled, "and it is not drawn again and again");
});

test("a broken edit to a Widget keeps its last good file, and a good one then replaces it", async () => {
  const t = await setup(), docs = path.join(t.docsBase, "Broken");
  const project = t.project("Broken");
  const dir = path.join(docs, "files/clock"), canvas = path.join(dir, "canvas.penecho.json");
  fs.mkdirSync(dir, { recursive:true });
  const first = path.join(dir, "canvas+clock.explorer.html");
  fs.writeFileSync(first, "<!doctype html><title>Clock</title><p style=\"color:#333\">12:00</p>");
  await t.service.makePictures(project);
  const [made] = widgetsOf(readJson(canvas));
  const named = path.join(dir, `canvas+${made.id}.explorer.html`), stamp = s => { const at = new Date(fs.statSync(first).mtimeMs + s * 1000); fs.utimesSync(named, at, at); };
  fs.writeFileSync(named, "");
  stamp(5);
  const before = fs.readFileSync(canvas, "utf8");
  for (let i = 0; i < 3; i++) await t.service.makePictures(project);
  assert.ok(fs.existsSync(first), "the last good file stays");
  assert.equal(fs.readFileSync(canvas, "utf8"), before, "and the Canvas still shows it");
  fs.writeFileSync(named, "<!doctype html><title>Clock</title><p style=\"color:#e11d48\">12:00</p>");
  stamp(10);
  await t.service.makePictures(project);
  assert.match(fs.readFileSync(first, "utf8"), /#e11d48/, "a good edit replaces it, under its name");
  assert.ok(!fs.existsSync(named));
  assert.match(widgetsOf(readJson(canvas))[0].html, /#e11d48/);
});

// A page of one colour, drawn as a PNG that says which, so a test can tell whose picture a file is.
const colored = async () => { const sharp = require("sharp"); return (html => sharp({ create:{ width:4, height:4, channels:3, background:/#[0-9a-f]{6}/.exec(html)?.[0] || "#ffffff" } }).png().toBuffer().then(png => ({ png, checks:null }))); };
const colorOf = async file => { const { data } = await require("sharp")(file).removeAlpha().raw().toBuffer({ resolveWithObject:true }); return `#${data.subarray(0, 3).toString("hex")}`; };
const page = (color, title = "Dark mode") => `<!doctype html><title>${title}</title><p style="color:${color}">12:00</p>`;

test("a Widget changed by its id keeps its own file: the Canvas's page and its picture stay the Canvas's", async () => {
  const t = await setup({ renderPage:await colored() }), project = t.project("Dark"), dir = path.join(project.docsPath, "files/dark-mode");
  const made = await t.send({ folder:project.docsPath }, { file:page("#101010"), name:"dark-mode.explorer.html" });
  assert.equal(made.status, 200, made.error);
  const canvas = path.join(project.docsPath, made.path), own = path.join(dir, "canvas.explorer.html"), [{ id }] = widgetsOf(readJson(canvas));
  assert.equal(await colorOf(made.png), "#101010");
  const changed = await t.send({ project:project.id, canvas:made.canvas, widget:id }, { file:page("#fafafa"), name:"light.explorer.html" });
  assert.equal(changed.status, 200, changed.error);
  assert.equal(changed.widgetId, id);
  assert.match(fs.readFileSync(own, "utf8"), /#fafafa/, "the page is in the file it had, so Open page finds it");
  assert.deepEqual(fs.readdirSync(dir).sort(), ["canvas.explorer.html", "canvas.penecho.json", "canvas.png"], "and no second file is made");
  assert.equal(changed.png, made.png);
  assert.equal(await colorOf(made.png), "#fafafa", "the Canvas's picture is the new page");
  assert.equal(readJson(canvas).manifest.extensions["penecho.lines"].behind, undefined, "and shows all of it");
  // Under the name PenEcho writes such files out with, and for one more picture on it, the same holds.
  const named = await t.send({ project:project.id, canvas:made.canvas }, { file:page("#eeeeee"), name:`canvas+${id}.explorer.html` });
  assert.equal(named.status, 200, named.error);
  await t.send({ project:project.id, canvas:made.canvas }, { file:page("#202020", "Clock"), name:"clock.explorer.html" });
  const clock = widgetsOf(readJson(canvas)).find(w => w.title === "Clock");
  const again = await t.send({ project:project.id, canvas:made.canvas, widget:clock.id }, { file:page("#dddddd", "Clock"), name:"x.explorer.html" });
  assert.deepEqual(fs.readdirSync(dir).sort(), ["canvas+clock.explorer.html", "canvas+clock.png", "canvas.explorer.html", "canvas.penecho.json", "canvas.png"]);
  assert.ok(again.png.endsWith("canvas+clock.png"));
  assert.equal(await colorOf(again.png), "#dddddd");
  assert.equal(widgetsOf(readJson(canvas)).length, 2);
  // Without a title of its own the Widget keeps the one it has.
  await t.send({ project:project.id, canvas:made.canvas, widget:clock.id }, { file:"<!doctype html><p style=\"color:#cccccc\">1</p>", name:"x.explorer.html" });
  assert.equal(widgetsOf(readJson(canvas)).find(w => w.id === clock.id).title, "Clock");
  // A failed one leaves its file as it was.
  const bad = await t.send({ project:project.id, canvas:made.canvas, widget:id }, { file:"no page", name:"x.explorer.html" });
  assert.equal(bad.status, 400);
  assert.match(fs.readFileSync(own, "utf8"), /#eeeeee/);
  // A file dropped under that name goes into the Widget's own too.
  fs.writeFileSync(path.join(dir, `canvas+${id}.explorer.html`), page("#bbbbbb"));
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(path.join(dir, `canvas+${id}.explorer.html`), later, later);
  await t.service.makePictures(project);
  assert.match(fs.readFileSync(own, "utf8"), /#bbbbbb/);
  assert.ok(!fs.existsSync(path.join(dir, `canvas+${id}.explorer.html`)));
  const settled = fs.readFileSync(canvas, "utf8");
  for (let i = 0; i < 3; i++) await t.service.makePictures(project);
  assert.equal(fs.readFileSync(canvas, "utf8"), settled, "nothing is drawn again after");
});

test("a slide changed by its id keeps its file, and is not drawn over and over", async () => {
  const t = await setup(), project = t.project("Deck by id");
  const slide = words => `<div class="slide" data-penecho-slide data-penecho-deck="Sales" style="width:1280px;height:720px"><h1>${words}</h1></div>`;
  const made = await t.send({ folder:project.docsPath }, { file:slide("One"), name:"sales.slide-01.html" });
  await t.send({ folder:project.docsPath, canvas:made.canvas }, { file:slide("Two"), name:"sales.slide-02.html" });
  const canvas = path.join(project.docsPath, made.path), dir = path.dirname(canvas), second = widgetsOf(readJson(canvas)).find(w => /Two/.test(w.html));
  const fixed = await t.send({ project:project.id, canvas:made.canvas, widget:second.id }, { file:slide("Second"), name:"fix.explorer.html" });
  assert.equal(fixed.status, 200, fixed.error);
  assert.equal(fixed.widgetId, second.id);
  assert.match(fs.readFileSync(path.join(dir, "canvas.slide-02.html"), "utf8"), /Second/);
  assert.ok(!fs.readdirSync(dir).some(name => name.includes("+")), "no file beside it");
  const settled = fs.readFileSync(canvas, "utf8");
  for (let i = 0; i < 3; i++) await t.service.makePictures(project);
  assert.equal(fs.readFileSync(canvas, "utf8"), settled);
  assert.equal(widgetsOf(readJson(canvas)).length, 2);
  const page = await t.send({ project:project.id, canvas:made.canvas, widget:second.id }, { file:"<!doctype html><p>not a slide</p>", name:"fix.explorer.html" });
  assert.equal(page.status, 400, "a page that is no slide does not take a slide's place");
  assert.match(page.error, /data-penecho-slide/);
  assert.match(fs.readFileSync(path.join(dir, "canvas.slide-02.html"), "utf8"), /Second/);
});

test("a Canvas whose page was left under its Widget's id gets its page and its picture back, with nothing drawn", async () => {
  const t = await setup({ renderPage:await colored() }), project = t.project("Lost page"), dir = path.join(project.docsPath, "files/dark-mode");
  const made = await t.send({ folder:project.docsPath }, { file:page("#101010"), name:"dark-mode.explorer.html" });
  const canvas = path.join(project.docsPath, made.path), own = path.join(dir, "canvas.explorer.html"), [{ id }] = widgetsOf(readJson(canvas)), other = name => path.join(dir, `canvas+${id}${name}`);
  // As it was left: the changed page and its picture under the id, the Canvas up to date, its own picture the old one.
  const before = async color => {
    const old = fs.readFileSync(path.join(dir, "canvas.png"));
    await t.send({ project:project.id, canvas:made.canvas }, { file:page(color), name:"dark-mode.explorer.html" });
    fs.renameSync(own, other(".explorer.html"));
    fs.copyFileSync(path.join(dir, "canvas.png"), other(".png"));
    fs.writeFileSync(path.join(dir, "canvas.png"), old);
    const ago = new Date(Date.now() - 60000);
    fs.utimesSync(path.join(dir, "canvas.png"), ago, ago);
    t.service.picturesSettled?.clear();
  };
  await before("#fafafa");
  const same = fs.readFileSync(canvas, "utf8");
  await t.service.makePictures(project);
  assert.match(fs.readFileSync(own, "utf8"), /#fafafa/, "the page has its name back");
  assert.ok(!fs.existsSync(other(".explorer.html")));
  assert.equal(await colorOf(path.join(dir, "canvas.png")), "#fafafa", "and the Canvas shows it");
  assert.equal(fs.readFileSync(canvas, "utf8"), same, "the Canvas itself is not touched");
  await t.service.makePictures(project);
  assert.equal(fs.readFileSync(canvas, "utf8"), same);
  // With ink on it, its picture is not replaced by the page's alone: the page that opens it draws it.
  const bundle = readJson(canvas);
  bundle.assets.push({ kind:"tile", contentType:"image/png", metadata:{ tileKey:"1,1" }, dataBase64:"iVBORw0KGgo=" });
  fs.writeFileSync(canvas, JSON.stringify(bundle));
  await before("#cccccc");
  await t.service.makePictures(project);
  assert.match(fs.readFileSync(own, "utf8"), /#cccccc/);
  assert.equal(await colorOf(path.join(dir, "canvas.png")), "#fafafa", "the picture it has stays");
  assert.equal((await t.lineApi("GET", `/projects/${project.id}/canvas?path=${encodeURIComponent(made.path)}`)).behind, true, "and the page is told to draw it again");
  assert.equal(readJson(canvas).assets.filter(a => a.kind === "tile").length, 1, "the ink stays");
});

test("a picture that does not show all of its Canvas is drawn again by the page that opens it, which saves nothing else", async () => {
  const t = await setup({ renderPage:await colored() }), project = t.project("Behind");
  const made = await t.send({ folder:project.docsPath }, { file:page("#101010"), name:"board.explorer.html" });
  const canvas = path.join(project.docsPath, made.path), png = path.join(path.dirname(canvas), "canvas.png"), api = `/projects/${project.id}/canvas`;
  const open = () => t.lineApi("GET", `${api}?path=${encodeURIComponent(made.path)}`), draw = (body = {}) => t.lineApi("POST", api, { path:made.path, redraw:true, ...body });
  const shot = async color => `data:image/png;base64,${(await require("sharp")({ create:{ width:4, height:4, channels:3, background:color } }).png().toBuffer()).toString("base64")}`;
  assert.equal((await open()).behind, undefined, "one page on its own Canvas is all of it");
  // One more picture on it, which its own picture does not show.
  await t.send({ folder:project.docsPath, canvas:made.canvas }, { file:page("#202020", "Clock"), name:"clock.explorer.html" });
  assert.equal(await colorOf(png), "#101010");
  let seen = await open();
  assert.equal(seen.behind, true);
  const sources = seen.source.manifest.extensions["penecho.lines"].sources, rest = file => { const b = readJson(file); delete b.manifest.extensions["penecho.lines"].behind; return JSON.stringify(b); }, was = rest(canvas);
  // A page that does not show what the folder has is not taken.
  assert.equal((await draw({ png:await shot("#303030"), base:seen.base, sources:{} })).taken, false);
  assert.equal((await draw({ png:await shot("#303030"), base:"another", sources })).taken, false);
  assert.equal((await draw({ base:seen.base, sources })).taken, false);
  assert.equal(await colorOf(png), "#101010");
  assert.equal((await open()).behind, true);
  assert.equal((await draw({ png:await shot("#303030"), base:seen.base, sources })).taken, true);
  assert.equal(await colorOf(png), "#303030");
  assert.equal(rest(canvas), was, "nothing on the Canvas changes, nor its version");
  assert.equal((await open()).behind, undefined);
  // A page's save without its picture leaves it behind; one with it does not, whatever the page's copy says.
  seen = await open();
  let saved = await t.lineApi("POST", api, { path:made.path, source:seen.source, png:null, base:seen.base });
  assert.equal(saved.status, 200);
  assert.equal((await open()).behind, true);
  const copy = (await open()).source;
  saved = await t.lineApi("POST", api, { path:made.path, source:copy, png:await shot("#404040"), base:saved.base });
  assert.equal(await colorOf(png), "#404040");
  assert.equal((await open()).behind, undefined);
  // An agent's page on a Canvas that holds more than it is that page's picture until the Canvas opens.
  await t.send({ folder:project.docsPath, canvas:made.canvas }, { file:page("#505050"), name:"board.explorer.html" });
  assert.equal(await colorOf(png), "#505050");
  assert.equal((await open()).behind, true);
});

test("R9: an Ask from a Canvas tells the agent each Widget's file, and never to edit the Canvas file", () => {
  const { followUpPrompt } = require("../src/server/project-lines/service.js");
  const canvas = { title:"Clock", file:"/docs/files/clock/canvas.penecho.json", project:"p1", picture:"", name:"clock", widgets:[{ id:"widget-1", title:"Clock", file:"/docs/files/clock/canvas+widget-1.explorer.html" }] };
  const said = followUpPrompt({ said:["make it colourful"], files:[], canvas, docs:"/docs", slug:"clock-line" }, { kind:"work" });
  assert.match(said, /- widget-1 "Clock": \/docs\/files\/clock\/canvas\+widget-1\.explorer\.html/);
  assert.match(said, /edit its file where it is/);
  assert.match(said, /Never edit canvas\.penecho\.json by hand/);
});

test("PE-539: a new picture lands beside the person's drawing, or where x, y and w say, and GET gives the ink box", async () => {
  const t = await setup(), docs = path.join(t.docsBase, "Ink");
  const project = t.project("Ink");
  const sharp = require("sharp");
  const { newBundle } = require("../src/server/project-lines/canvas-file.js");
  // A stroke from (100,200) to (300,260) inside tile 17,17.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect x="100" y="200" width="200" height="60" fill="#111"/></svg>`;
  const tile = (await sharp(Buffer.from(svg)).png().toBuffer()).toString("base64");
  const bundle = newBundle({ id:"lines-ink", name:"Ink" });
  bundle.assets.push({ kind:"tile", contentType:"image/png", metadata:{ tileKey:"17,17" }, dataBase64:tile });
  const canvas = path.join(docs, "files/ink/canvas.penecho.json");
  fs.mkdirSync(path.dirname(canvas), { recursive:true });
  fs.writeFileSync(canvas, JSON.stringify(bundle));

  const seen = await t.look({ project:project.id, canvas:"ink" });
  assert.deepEqual(seen.ink, { x:17 * 512 + 100, y:17 * 512 + 200, w:200, h:60 });

  const beside = await t.send({ project:project.id, canvas:"ink" }, { file:"<!doctype html><title>A</title><p>a</p>", name:"a.explorer.html" });
  assert.equal(beside.status, 200, beside.error);
  let a = widgetsOf(readJson(canvas)).find(w => w.title === "A");
  assert.ok(a.x >= 18 * 512 && a.x < 18 * 512 + 600 && a.y === 17 * 512, `beside the drawing, not at 2000,2000: ${a.x},${a.y}`);

  const onIt = await t.send({ project:project.id, canvas:"ink", x:"8800", y:"8900", w:"400" }, { file:"<!doctype html><title>B</title><p>b</p>", name:"b.explorer.html" });
  assert.equal(onIt.status, 200, onIt.error);
  let b = widgetsOf(readJson(canvas)).find(w => w.title === "B");
  assert.deepEqual([b.x, b.y, b.w, b.h], [8800, 8900, 400, 250]);
  // Sent again with another place, it stays where it is: only a new picture is placed.
  await t.send({ project:project.id, canvas:"ink", x:"100", y:"100" }, { file:"<!doctype html><title>B</title><p>b2</p>", name:"b.explorer.html" });
  b = widgetsOf(readJson(canvas)).find(w => w.title === "B");
  assert.deepEqual([b.x, b.y], [8800, 8900]);
  const outside = await t.send({ project:project.id, canvas:"ink", x:"-5", y:"10" }, { file:"<!doctype html><p>c</p>", name:"c.explorer.html" });
  assert.equal(outside.status, 400);
});

test("PE-539: GET view=1 is answered by the open Canvas page with a picture of its view, and says so when no page has it open", async () => {
  const t = await setup(), docs = path.join(t.docsBase, "Seen");
  const project = t.project("Seen");
  const { newBundle } = require("../src/server/project-lines/canvas-file.js");
  const canvas = path.join(docs, "files/seen/canvas.penecho.json");
  fs.mkdirSync(path.dirname(canvas), { recursive:true });
  fs.writeFileSync(canvas, JSON.stringify(newBundle({ id:"lines-seen", name:"Seen" })));
  const source = "files/seen/canvas.penecho.json";

  const closed = await t.look({ project:project.id, canvas:"seen", view:"1" });
  assert.equal(closed.status, 200);
  assert.equal(closed.png, "", "no page has it open");
  assert.match(closed.why, /open in front/);

  // The page looks for new drawings and says what is on its screen.
  const first = await t.lineApi("POST", `/projects/${project.id}/canvas/pull`, { path:source, sources:{}, view:{ x:8000.4, y:8100, w:1200, h:700 } });
  assert.equal(first.status, 200);
  assert.equal(first.capture, undefined, "nothing asked for yet");
  const asked = t.look({ view:"1" });
  await new Promise(r => setTimeout(r, 50));
  const next = await t.lineApi("POST", `/projects/${project.id}/canvas/pull`, { path:source, sources:{} });
  assert.match(next.capture, /^[0-9a-f-]{36}$/, "its next look carries the request");
  const png = (await require("sharp")({ create:{ width:4, height:3, channels:3, background:"#fff" } }).png().toBuffer()).toString("base64");
  const wrong = await t.lineApi("POST", `/projects/${project.id}/canvas/view`, { path:source, id:"not-it", png:`data:image/png;base64,${png}` });
  assert.equal(wrong.taken, false, "a view nobody asked for is not taken");
  const took = await t.lineApi("POST", `/projects/${project.id}/canvas/view`, { path:source, id:next.capture, png:`data:image/png;base64,${png}`, region:{ x:8000, y:8100, width:1200, height:700 } });
  assert.equal(took.taken, true);
  const seen = await asked;
  assert.equal(seen.status, 200);
  assert.equal(seen.project, project.id);
  assert.equal(seen.canvas, "seen", "the Canvas open in front, with no name given");
  assert.deepEqual(seen.box, { x:8000, y:8100, w:1200, h:700 });
  assert.ok(path.isAbsolute(seen.png));
  assert.equal(fs.readFileSync(seen.png).subarray(1, 4).toString(), "PNG", "a picture the agent can read");
  const after = await t.lineApi("POST", `/projects/${project.id}/canvas/pull`, { path:source, sources:{} });
  assert.equal(after.capture, undefined, "an answered request is gone");

  // A page that cannot make the picture says why, and the agent hears it.
  const failing = t.look({ project:project.id, canvas:"seen", view:"1" });
  await new Promise(r => setTimeout(r, 50));
  const again = await t.lineApi("POST", `/projects/${project.id}/canvas/pull`, { path:source, sources:{} });
  await t.lineApi("POST", `/projects/${project.id}/canvas/view`, { path:source, id:again.capture, error:"Widgets were loading." });
  const failed = await failing;
  assert.equal(failed.png, "");
  assert.equal(failed.why, "Widgets were loading.");
});

test("Lines plots share the plotter, use live bounds and inherit a saved neighbor on a closed Canvas", async () => {
  const t = await setup({ renderPage:() => null }), p = t.project("Graph replay");
  const board = await t.service.createCanvas(p, { title:"Panned", blank:true });
  const view = { x:7440, y:8458, w:4050, h:2500 };
  await t.lineApi("POST", `/projects/${p.id}/canvas/pull`, { path:board.source, sources:{}, view });
  const target = { project:p.id, canvas:board.slug };
  const plot = (options, extra = {}) => t.send({ ...target, plot:JSON.stringify(options), ...extra });
  const first = await plot({ artifactId:"sine", expression:"x*sin(x)", xMin:-4*Math.PI, xMax:4*Math.PI, yMin:-13.5, yMax:13.5 });
  assert.equal(first.status, 200, first.error);
  assert.equal(first.path, board.source);
  assert.equal(first.view, "live");
  assert.deepEqual(first.viewport, view);
  assert.equal(first.fullyVisible, true);
  const read = () => widgetsOf(readJson(path.join(p.docsPath, board.source)));
  const [sine] = read();
  assert.equal(sine.id, first.widgetId);
  assert.equal(sine.x, first.bounds.x);
  assert.match(sine.html, /4π/);
  assert.match(sine.html, /stroke-dasharray/);
  t.service.openCanvases.clear();
  const other = await plot({ artifactId:"tangent", expression:"x*tan(x)" }, { beside:sine.id });
  assert.equal(other.status, 200, other.error);
  assert.equal(other.path, board.source);
  assert.equal(other.view, "saved");
  assert.equal(other.visible, null);
  const [same, tan] = read();
  assert.deepEqual(same, sine);
  assert.equal(tan.w, sine.w);
  assert.ok(tan.x >= sine.x + sine.w);
  const { plotRange } = require("../src/server/mcp/no-page.js");
  assert.deepEqual(plotRange(tan.html), plotRange(sine.html));
  const runs = [...tan.html.matchAll(/<polyline points="([^"]+)"/g)].map(m => m[1].split(" ").map(pair => Number(pair.split(",")[0])));
  assert.equal(runs.length, 9);
  const width = Number(/viewBox="0 0 (\d+) /.exec(tan.html)[1]);
  for (let i = 0; i < 8; i++) {
    const pole = 48 + (i + .5) * (width - 96) / 8;
    assert.ok(runs.every(run => run[0] >= pole || run.at(-1) <= pole));
  }
  const retry = await plot({ artifactId:"tangent", expression:"x*tan(x)" }, { beside:sine.id, x:0, y:0 });
  assert.deepEqual(retry.bounds, other.bounds);
  assert.equal(retry.widgetId, other.widgetId);
  assert.equal(read().length, 2);
  // Headless hosts without a page renderer return no widget preview receipt.
  assert.equal(other.preview.ready, false);
  assert.equal(other.preview.png, "");
  // With an injected renderer, plot previews save the rendered receipt without launching Chrome.
  const calls = [];
  const withRenderer = await setup({ renderPage:(html, size) => { calls.push({ html, size }); return { png:FAKE_PNG, checks:null }; } });
  const p2 = withRenderer.project("Graph receipt");
  const board2 = await withRenderer.service.createCanvas(p2, { title:"Receipt", blank:true });
  const drawn = await withRenderer.send({ project:p2.id, canvas:board2.slug, plot:JSON.stringify({ artifactId:"cosine", expression:"cos(x)" }) });
  assert.equal(drawn.status, 200, drawn.error);
  assert.equal(drawn.preview.ready, true);
  assert.ok(fs.existsSync(drawn.preview.png));
  assert.deepEqual(fs.readFileSync(drawn.preview.png), FAKE_PNG);
  assert.ok(calls.length >= 1);
  for (const bad of [{ expression:"sin(" }, { xMin:2, xMax:1 }, { color:"no-color" }, { width:-1 }]) {
    assert.equal((await plot({ artifactId:"bad", expression:"x", ...bad })).status, 400);
  }
  assert.equal((await plot({ artifactId:"missing", expression:"x" }, { beside:"widget-999" })).status, 400);
  assert.equal((await t.send({ ...target, plot:"{" })).status, 400);
  assert.equal(read().length, 2);
});

test("page-picture blocks direct Chrome launch in macOS sandboxes and routes through hosted browser when configured", () => {
  const hostedEnv = {
    PENECHO_BROWSER_URL:"http://127.0.0.1:3889/api/browser",
    PENECHO_BROWSER_PASS:"a".repeat(64),
    PENECHO_BROWSER_PROOF_KEY:"b".repeat(64),
    PENECHO_BROWSER_INSTANCE:"inst-1",
  };
  assert.equal(localBrowserBlocked({ CODEX_SANDBOX:"seatbelt" }, "darwin"), true);
  assert.equal(localBrowserBlocked({ CODEX_SANDBOX_NETWORK_DISABLED:"1" }, "darwin"), true);
  assert.equal(localBrowserBlocked({ SANDBOX_RUNTIME:"1" }, "darwin"), true);
  assert.equal(localBrowserBlocked({ PENECHO_NO_LOCAL_BROWSER:"1" }, "linux"), true);
  assert.equal(localBrowserBlocked({ PENECHO_PAGE_RENDERER:"hosted" }, "darwin"), true);
  assert.equal(localBrowserBlocked({ PENECHO_PAGE_RENDERER:"off" }, "darwin"), true);
  assert.equal(browserPath({ CODEX_SANDBOX:"seatbelt", CHROME_PATH:process.execPath }, "darwin"), null);
  assert.equal(hostedBrowserConfigured(hostedEnv), true);
  assert.equal(hostedBrowserConfigured({ ...hostedEnv, CODEX_SANDBOX:"seatbelt" }), true);
  assert.equal(hostedBrowserConfigured({ ...hostedEnv, CODEX_SANDBOX_NETWORK_DISABLED:"1" }), false);
  assert.equal(hostedBrowserConfigured({ ...hostedEnv, PENECHO_PAGE_RENDERER:"local" }), false);
  assert.equal(hostedBrowserConfigured({ ...hostedEnv, PENECHO_PAGE_RENDERER:"off" }), false);
  assert.equal(canRenderPages({ CODEX_SANDBOX:"seatbelt", CODEX_SANDBOX_NETWORK_DISABLED:"1", ...hostedEnv }, "darwin"), false);
  assert.equal(canRenderPages({ CODEX_SANDBOX:"seatbelt", ...hostedEnv }, "darwin"), true);
  assert.equal(canRenderPages({ PENECHO_PAGE_RENDERER:"off", ...hostedEnv }, "darwin"), false);
});

test("plot readout accepts a touch, pointer and keyboard in scaled SVG coordinates", () => {
  const { plotPage } = require("../src/server/mcp/no-page.js");
  const html = plotPage({ title:"Square", expression:"x^2", xMin:-2, xMax:2, yMin:-1, yMax:5, width:800, height:500 });
  const events = {}, point = {}, output = {};
  const svg = {
    addEventListener:(name, fn) => { events[name] = fn; },
    getScreenCTM:() => ({ inverse:() => ({}) }),
    createSVGPoint:() => ({ matrixTransform() { return { x:this.x / 2 }; } }),
  };
  const document = { querySelector:() => svg, getElementById:id => id === "coordinate" ? output : { setAttribute:(key,value) => { point[key] = value; } } };
  require("node:vm").runInNewContext(/<script>([\s\S]+)<\/script>/.exec(html)[1], { document });
  events.pointerdown({ clientX:96, clientY:0 });
  assert.match(output.textContent, /x = -2 +y = 4/);
  events.pointermove({ clientX:800, clientY:0 });
  assert.match(output.textContent, /x = 0 +y = 0/);
  events.keydown({ key:"End", preventDefault() {} });
  assert.match(output.textContent, /x = 2 +y = 4/);
  events.keydown({ key:"ArrowLeft", preventDefault() {} });
  assert.match(output.textContent, /x = 1\.9933/);
  assert.equal(point.visibility, "visible");
  assert.equal(compileExpression("-2^2")(0), -4);
  assert.equal(compileExpression("2^-2")(0), .25);
});

test("the PenEcho page renderer renders plots and runs keyboard and pointer handlers", async t => {
  if (!requireBrowserTests && !canRenderPages()) {
    t.skip("PenEcho's page renderer is unavailable here");
    return;
  }
  const { plotPage } = require("../src/server/mcp/no-page.js");
  const { inCanvas } = require("../src/server/project-lines/canvas-file.js");
  const tangentHtml = plotPage({ title:"y = x*tan(x)", expression:"x*tan(x)", xMin:-4*Math.PI, xMax:4*Math.PI, yMin:-13.5, yMax:13.5, width:800, height:500 }, { trigScale:true });
  const plotPng = await pagePicture(inCanvas(tangentHtml), { width:1200, height:750 });
  assert.ok(plotPng, "PenEcho's page renderer returned no plot image");
  const { data, info } = await require("sharp")(plotPng).removeAlpha().raw().toBuffer({ resolveWithObject:true });
  let blue = 0;
  for (let i = 0; i < data.length; i += info.channels) if (data[i + 2] > 170 && data[i] < 110 && data[i + 1] < 155) blue++;
  assert.ok(blue > 500, "the actual widget PNG has a rendered curve");

  const page = plotPage({ title:"Square", expression:"x^2", xMin:-2, xMax:2, yMin:-1, yMax:5, width:800, height:500 });
  // Use a narrower viewport with letterboxing so the browser must transform client coordinates.
  const probe = `<script>(() => {
    const svg = document.querySelector("svg"), output = document.getElementById("coordinate");
    const point = svg.createSVGPoint(); point.x = 400; point.y = 250;
    const client = point.matrixTransform(svg.getScreenCTM());
    svg.dispatchEvent(new PointerEvent("pointerdown", { pointerType:"touch", clientX:client.x, clientY:client.y }));
    const touched = output.textContent === "x = 0   y = 0";
    svg.focus();
    svg.dispatchEvent(new KeyboardEvent("keydown", { key:"End", cancelable:true }));
    const keyed = output.textContent === "x = 2   y = 4";
    const mark = document.createElement("div"); mark.style.cssText = "position:fixed;left:0;top:0;width:5px;height:5px;background:" + (touched && keyed ? "#0a4f91" : "red");
    document.body.append(mark);
  })()</script>`;
  const png = await pagePicture(page.replace("</body>", () => probe + "</body>"), { width:500, height:600 });
  assert.ok(png, "PenEcho's page renderer returned no interaction probe image");
  const sample = await require("sharp")(png).extract({ left:1, top:1, width:1, height:1 }).removeAlpha().raw().toBuffer();
  assert.deepEqual([...sample], [10,79,145]);
});
