"use strict";
require("./helpers/safety.js");
// What a Work made shows on its card (PE-365): the deliverables its result points to, read by work-outputs.js, in the line's state,
// and a prototype page in the code folder opens on this computer only when the line lists it.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const { execFileSync } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const F = require("../src/server/project-lines/format.js");
const { workOutputs } = require("../src/server/project-lines/work-outputs.js");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { createProjectLines } = require("../src/server/project-lines/http.js");

const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penecho-work-outputs-")));
const closers = [];
after(() => { for (const close of closers) close(); fs.rmSync(temp, { recursive:true, force:true }); });
const write = (file, text = "x") => { fs.mkdirSync(path.dirname(file), { recursive:true }); fs.writeFileSync(file, text); };

test("a result's links and paths become the Work's outputs; code, sources, folders, your pictures and what the line shows do not", () => {
  const docs = path.join(temp, "docs"), code = path.join(temp, "code"), home = path.join(temp, "home");
  for (const f of ["files/l/plan.md", "files/l/shot.png", "files/l/image-3.png", "files/l/run.log", "files/l/deck.pptx", "files/l/notes.json",
    "files/l/flow.diagram.json", "files/l/flow.penecho.json", "files/l/flow.png", "files/own/canvas.penecho.json", "files/own/canvas.png",
    "files/l/shown.png", "lines/other.md", "lines/l.md"]) write(path.join(docs, f));
  write(path.join(docs, "files/l/page.html"), "<html><head><title>Try the page</title></head></html>");
  write(path.join(code, "docs/design/x/index.html"), "<title>Prototype &amp; notes</title>");
  write(path.join(code, "public/app.html"), "<title>The app</title>");
  write(path.join(code, ".claude/worktrees/v1/docs/design/y.html"), "<title>In a worktree</title>");
  write(path.join(code, "src/server.js"));
  write(path.join(temp, "elsewhere/page.html"));
  const result = F.resultOf([
    "Done.",
    "![A new Canvas](../../files/own/canvas.png)",
    "[The plan](../../files/l/plan.md) · [shot.png](../../files/l/shot.png) · [your picture](../../files/l/image-3.png) · [log](../../files/l/run.log)",
    "[deck](<../../files/l/deck.pptx>) [json](../../files/l/notes.json) [the folder](../../files/l/) [drawn](../../files/l/flow.diagram.json) [already here](../../files/l/shown.png)",
    `[open the prototype](${path.join(code, "docs/design/x/index.html")}) and ${path.join(code, "public/app.html")} and \`${path.join(code, ".claude/worktrees/v1/docs/design/y.html")}\`, code in ${path.join(code, "src/server.js")}, not ${path.join(temp, "elsewhere/page.html")}.`,
    "See files/l/page.html, the line [Other](../../lines/other.md), this line [l](../../lines/l.md) and [the Artifact](https://claude.ai/artifact/AbCdEf123456?x=1).",
  ].join("\n"));
  const shown = new Set(["files/l/shown.png", "files/l/flow.png"]);
  const made = workOutputs({ detail:"works/l/work-1.md", result, docs, home, exists:rel => fs.existsSync(path.join(docs, rel)), isFile:f => fs.existsSync(f) && fs.statSync(f).isFile(), real:f => fs.realpathSync(f), codeRoots:[fs.realpathSync(code)], shown, self:"l", isLine:slug => fs.existsSync(path.join(docs, "lines", `${slug}.md`)) });
  assert.deepEqual(made.canvases, [{ title:"A new Canvas", path:"files/own/canvas.png" }], "a Canvas of its own joins the pictures, one the line shows does not");
  assert.ok(shown.has("files/own/canvas.png"), "and is now shown, so a later Work does not show it again");
  assert.deepEqual(made.outputs.map(o => [o.kind, o.code ? path.relative(code, o.path) : o.path, o.title || o.line || ""]), [
    ["document", "files/l/plan.md", "The plan"],
    ["picture", "files/l/shot.png", ""],
    ["slides", "files/l/deck.pptx", "deck"],
    ["page", "docs/design/x/index.html", "Prototype & notes"],
    ["line", "lines/other.md", "other"],
    ["artifact", "https://claude.ai/artifact/AbCdEf123456", "the Artifact"],
    // Then the paths written as words, in the order they come.
    ["page", ".claude/worktrees/v1/docs/design/y.html", "In a worktree"],
    ["page", "files/l/page.html", "Try the page"],
  ]);
});

// Agents also write a link from the docs folder, not from the Work's file (PE-1190).
test("a link written from the docs folder is the same file, with the words of the link as its name", () => {
  const docs = path.join(temp, "from-docs");
  for (const f of ["files/l/plan.md", "files/other/map.md", "lines/other.md"]) write(path.join(docs, f));
  const result = F.resultOf("[The plan](files/l/plan.md) [Its map](./files/other/map.md) [Other](lines/other.md) [gone](files/l/none.md)");
  const made = workOutputs({ detail:"works/l/work-1.md", result, docs, exists:rel => fs.existsSync(path.join(docs, rel)), self:"l", isLine:slug => slug === "other" });
  assert.deepEqual(made.outputs.map(o => [o.kind, o.path, o.title || o.line]), [["document", "files/l/plan.md", "The plan"], ["document", "files/other/map.md", "Its map"], ["line", "lines/other.md", "other"]]);
});

test("a Work keeps at most twelve outputs and eight pictures", () => {
  const docs = path.join(temp, "many");
  for (let i = 0; i < 20; i++) { write(path.join(docs, `files/m/p${i}.png`)); write(path.join(docs, `files/m/d${i}.md`)); }
  const links = [...[...Array(20).keys()].map(i => `[p${i}](../../files/m/p${i}.png)`), ...[...Array(20).keys()].map(i => `[d${i}](../../files/m/d${i}.md)`)].join("\n");
  const made = workOutputs({ detail:"works/m/work-1.md", result:F.resultOf(links), docs, exists:rel => fs.existsSync(path.join(docs, rel)) });
  assert.equal(made.outputs.length, 12);
  assert.equal(made.outputs.filter(o => o.kind === "picture").length, 8);
});

// A stand-in agent that answers at once without drawing anything.
const agentScript = path.join(temp, "agent.js");
fs.writeFileSync(agentScript, `
const say = o => console.log(JSON.stringify(o));
process.stdin.on("data", () => {}).on("end", () => { say({ type:"system", subtype:"init", session_id:"s1" }); say({ type:"result", subtype:"success", is_error:false, result:"Made it.", session_id:"s1" }); });
`);
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(check, label, ms = 20000) { const start = Date.now(); for (;;) { const v = await check(); if (v) return v; if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}`); await wait(25); } }

test("the line's state lists a Work's outputs, and only a listed prototype page opens on this computer", async () => {
  const directory = path.join(temp, "state"), docsBase = path.join(temp, "docs-base"), home = path.join(temp, "home2"), code = path.join(temp, "app-code");
  fs.mkdirSync(directory, { recursive:true }); fs.mkdirSync(home, { recursive:true });
  write(path.join(code, "docs/design/idea/index.html"), "<title>The idea</title>");
  write(path.join(code, "docs/design/other/index.html"), "<title>Not this one</title>");
  // A code folder is a Git repository, or a line has nowhere safe to work.
  const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd:code, stdio:"ignore" });
  git("init", "-q", "-b", "main"); git("add", "-A"); git("commit", "-q", "-m", "first");
  const opened = [];
  const agents = createAgents({ env:{ PATH:"" }, extra:{ fake:{ name:"Fake", mono:"Fk", color:"#000", role:"Build", resolve:() => ({ command:process.execPath, prefixArgs:[agentScript] }), command:(launch, { workdir }) => ({ command:launch.command, args:launch.prefixArgs, cwd:workdir, stdin:true }) } } });
  const lines = createProjectLines({ directory, agents, agentPaths:{ home }, serviceOptions:{ autoWatch:false, docsBase }, authorizeRead:() => null, authorizeWrite:() => null, isThisComputer:req => !req.headers["x-test-other-device"],
    folderOpener:{ label:"Open", open:async () => ({ ok:true }), openFile:async file => { opened.push(file); return { ok:true }; } },
    readJson:req => new Promise((resolve, reject) => { let s = ""; req.on("data", d => { s += d; }).on("end", () => { try { resolve(s ? JSON.parse(s) : {}); } catch (error) { reject(error); } }); }),
    send:(res, status, data) => { res.writeHead(status, { "content-type":"application/json" }); res.end(JSON.stringify(data)); } });
  const server = http.createServer(async (req, res) => { if (!await lines.handle(req, res, new URL(req.url, "http://x"))) { res.writeHead(404); res.end(); } });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  closers.push(() => { server.close(); lines.close(); });
  const call = async (method, route, body) => { const res = await fetch(`http://127.0.0.1:${server.address().port}/api/lines${route}`, { method, ...(body ? { headers:{ "content-type":"application/json" }, body:JSON.stringify(body) } : {}) }); return { status:res.status, ...await res.json() }; };
  const service = lines.service, p = service.store.create({ name:"Made", docsPath:path.join(docsBase, "Made") });
  p.defaultAgent = "fake"; p.codePaths = [code];
  const asked = await call("POST", `/projects/${p.id}/topics`, { text:"Write the plan and a prototype." });
  assert.equal(asked.status, 200, asked.error);
  const slug = asked.slug;
  await until(() => !service.runs.size && ["done", "ready"].includes(F.parseLine(service.readDoc(p, slug)).status), "the run");
  const stationOf = async () => { const state = await call("GET", `/projects/${p.id}/state`); return [...state.lines, ...state.landed, ...state.backlog].find(l => l.slug === slug).stations.find(s => s.kind === "work"); };
  const work = await stationOf(), detail = path.join(p.docsPath, work.detail);
  const text = await until(() => { const now = fs.readFileSync(detail, "utf8"); return /\nended: /.test(now) && now; }, "the detail file");
  write(path.join(p.docsPath, `files/${slug}/plan.md`), "# Plan");
  fs.writeFileSync(detail, `${text.trimEnd()}\n\n## Result\n\nThe [plan](../../files/${slug}/plan.md) and the [prototype](${path.join(code, "docs/design/idea/index.html")}).\n`);
  const shown = await until(async () => { const now = await stationOf(); return now.outputs?.length === 2 && now; }, "the outputs in the state", 5000);
  assert.deepEqual(shown.outputs.map(o => [o.kind, o.title, Boolean(o.code)]), [["document", "plan", false], ["page", "The idea", true]]);
  const page = shown.outputs[1].path;
  // Only a page this Work lists opens, and only for the Work that lists it.
  assert.equal((await call("POST", `/projects/${p.id}/topics/${slug}/open-output`, { step:work.id, path:path.join(fs.realpathSync(code), "docs/design/other/index.html") })).status, 404);
  assert.equal((await call("POST", `/projects/${p.id}/topics/${slug}/open-output`, { step:"nope", path:page })).status, 404);
  assert.deepEqual(opened, []);
  const ok = await call("POST", `/projects/${p.id}/topics/${slug}/open-output`, { step:work.id, path:page });
  assert.equal(ok.status, 200, ok.error);
  assert.deepEqual(opened, [page]);

  // Inline links are independent of the deliverable cards. A Work can cite a source file or its own record.
  const icon = path.join(code, ".claude/worktrees/demo/public/icon (blue).svg"), svg = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22"/>';
  const source = "src/main.js:12", other = path.join(temp, "outside.svg"), alias = path.join(code, "outside.svg");
  write(icon, svg); write(path.join(code, "src/main.js"), "// cited source"); write(other, svg);
  fs.symlinkSync(other, alias);
  const original = fs.readFileSync(detail, "utf8");
  fs.writeFileSync(detail, original + `\n[View the icon](<${icon}>) · [Work 1](${detail}) · [Source](${source}) · [Offsite](${other}) · [Alias](${alias})\n`);
  const origin = `http://127.0.0.1:${server.address().port}/api/lines/projects/${p.id}`;
  const meta = await fetch(`${origin}/doc?path=${encodeURIComponent(work.detail)}`).then(r => r.json());
  assert.deepEqual(meta.codeLinks, [path.join(code, "docs/design/idea/index.html"), icon, source]);
  const preview = (href, headers) => fetch(`${origin}/result-file?${new URLSearchParams({ doc:work.detail, href })}`, { headers });
  const image = await preview(icon);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/svg+xml");
  assert.doesNotMatch(image.headers.get("content-security-policy"), /allow-scripts|allow-same-origin/);
  assert.equal(await image.text(), svg);
  const js = await preview(source);
  assert.equal(js.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(await js.text(), "// cited source");
  for (const missing of [other, alias, path.join(code, "docs/design/other/index.html")]) assert.equal((await preview(missing)).status, 404);
  assert.equal((await preview(icon, { "x-test-other-device":"1" })).status, 403);
  fs.writeFileSync(detail, original);
  assert.equal((await preview(icon)).status, 404, "a removed reference ceases to grant a preview");
});
