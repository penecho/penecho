"use strict";
require("./helpers/safety.js");
// B1: an Ask sent beside an open Canvas tells the agent which Canvas, and what it draws lands on that Canvas.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const vm = require("node:vm");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const F = require("../src/server/project-lines/format.js");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const { createDraw } = require("../src/server/draw.js");

const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penecho-canvas-asks-")));
const closers = [];
after(() => { for (const close of closers) close(); fs.rmSync(temp, { recursive:true, force:true }); });
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(check, label, ms = 20000) { const start = Date.now(); for (;;) { const v = await check(); if (v) return v; if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}`); await wait(25); } }
// A stand-in agent: it keeps what it was told and the line it was given, then drops a drawing for its line as the prompt says.
const agentScript = path.join(temp, "agent.js");
fs.writeFileSync(agentScript, `
const fs = require("fs");
const say = o => console.log(JSON.stringify(o));
let prompt = "";
process.stdin.on("data", d => prompt += d).on("end", () => {
  const docs = process.env.PENECHO_DOCS_FOLDER, slug = process.env.PENECHO_LINE;
  fs.writeFileSync(docs + "/../prompt-" + slug + ".txt", prompt + "\\n---env " + process.env.PENECHO_LINE + " " + process.env.PENECHO_PROJECT);
  say({ type:"system", subtype:"init", session_id:"session-" + slug });
  if (!/no drawing/.test(prompt)) { fs.mkdirSync(docs + "/files/" + slug, { recursive:true }); fs.writeFileSync(docs + "/files/" + slug + "/login.diagram.json", JSON.stringify({ type:"workflow", title:"Login flow", nodes:[{ id:"s", label:"Start", type:"start" }, { id:"e", label:"Signed in", type:"end" }], edges:[{ from:"s", to:"e" }] })); }
  say({ type:"result", subtype:"success", is_error:false, result:"Drew it.", session_id:"session-" + slug });
});
`);
const agents = () => createAgents({ env:{ PATH:"" }, extra:{ fake:{ name:"Fake", mono:"Fk", color:"#000", role:"Build", resolve:() => ({ command:process.execPath, prefixArgs:[agentScript] }), command:(launch, { workdir }) => ({ command:launch.command, args:launch.prefixArgs, cwd:workdir, stdin:true }) } } });
let n = 0;
async function setup() {
  const id = ++n, directory = path.join(temp, `state-${id}`), docsBase = path.join(temp, `base-${id}`), home = path.join(temp, `home-${id}`);
  fs.mkdirSync(directory, { recursive:true }); fs.mkdirSync(home, { recursive:true });
  const lines = createProjectLines({ directory, agents:agents(), agentPaths:{ home }, serviceOptions:{ autoWatch:false, docsBase }, authorizeRead:() => null, authorizeWrite:() => null, isThisComputer:() => true,
    readJson:req => new Promise((resolve, reject) => { let s = ""; req.on("data", d => { s += d; }).on("end", () => { try { resolve(s ? JSON.parse(s) : {}); } catch (error) { reject(error); } }); }),
    send:(res, code, data) => { res.writeHead(code, { "content-type":"application/json" }); res.end(JSON.stringify(data)); } });
  let port = 0;
  const draw = createDraw({ service:lines.service, stateDirectory:directory, origin:() => `http://127.0.0.1:${port}`, home, drawFile:path.join(home, "draw.json") });
  const server = http.createServer(async (req, res) => { const url = new URL(req.url, "http://x"); if (await draw.handle(req, res, url)) return; if (!await lines.handle(req, res, url)) { res.writeHead(404); res.end(); } });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  port = server.address().port;
  closers.push(() => { server.close(); lines.close(); });
  const call = async (method, route, body) => { const res = await fetch(`http://127.0.0.1:${port}/api/lines${route}`, { method, ...(body ? { headers:{ "content-type":"application/json" }, body:JSON.stringify(body) } : {}) }); return { status:res.status, ...await res.json() }; };
  const sendDraw = async (fields, name, file) => { const form = new FormData(); for (const [k, v] of Object.entries(fields)) form.append(k, v); form.append("file", new Blob([file]), name); const res = await fetch(`http://127.0.0.1:${port}/api/draw`, { method:"POST", headers:{ "x-penecho-token":draw.token }, body:form }); return { status:res.status, ...await res.json() }; };
  const project = name => { const made = lines.service.store.create({ name, docsPath:path.join(docsBase, name) }); made.defaultAgent = "fake"; return made; };
  return { service:lines.service, docsBase, call, sendDraw, project, origin:`http://127.0.0.1:${port}` };
}
const widgetsOf = bundle => bundle.assets.filter(a => a.kind === "widget").map(a => JSON.parse(Buffer.from(a.dataBase64, "base64").toString("utf8")));
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const finished = (service, p, slug) => !service.runs.size && ["done", "ready", "waiting"].includes(F.parseLine(service.readDoc(p, slug)).status);

test("an Ask from a Canvas tells the agent that Canvas, and what it drops for the line is drawn onto it", async () => {
  const { service, docsBase, call, project } = await setup(), p = project("Board");
  const made = await call("POST", `/projects/${p.id}/canvases`, { title:"Sketchpad", blank:true });
  fs.writeFileSync(path.join(p.docsPath, made.picture), Buffer.from("\x89PNG\r\n\x1a\nsaved by the page", "latin1"));
  const asked = await call("POST", `/projects/${p.id}/topics`, { text:"Draw the login flow.", canvas:made.source });
  assert.equal(asked.status, 200, asked.error);
  const slug = asked.slug;
  await until(() => finished(service, p, slug), "the run");
  const prompt = fs.readFileSync(path.join(docsBase, `prompt-${slug}.txt`), "utf8");
  assert.ok(prompt.includes(path.join(p.docsPath, made.source)), "the prompt names the Canvas file");
  assert.ok(prompt.includes(path.join(p.docsPath, made.picture)), "and its picture");
  assert.match(prompt, /Use the saved Canvas/);
  assert.match(prompt, /plot=.+artifactId/);
  assert.doesNotMatch(prompt, /PenEcho turns it into an editable Canvas/);
  assert.match(prompt, /<name>\.png beside the file or \$(?:env:)?PENECHO_DRAW_URL\?view=1/, "Canvas previews and the new browser routing stay explicit");
  // An Ask from the open Canvas is about that Canvas: no reading round the project first, no Topic to update (PE-539).
  assert.match(prompt, /do not update any Topic, understanding\.md, MEMORY\.md or the Work file/);
  assert.doesNotMatch(prompt, /Read MEMORY\.md there first/, "no MEMORY.md to read first");
  assert.doesNotMatch(prompt, /update that Topic and understanding\.md/, "no Topic to update");
  const expectedViewPattern = process.platform === "win32"
    ? new RegExp(`"\\$\\{env:PENECHO_DRAW_URL\\}\\?project=${p.id}&canvas=sketchpad&view=1" -H "x-penecho-token: \\$env:PENECHO_DRAW_PASS"`)
    : new RegExp(`"\\$PENECHO_DRAW_URL\\?project=${p.id}&canvas=sketchpad&view=1" -H "x-penecho-token: \\$PENECHO_DRAW_PASS"`);
  assert.match(prompt, expectedViewPattern, "and how to see what is on the person's screen");
  assert.match(prompt, /-F canvas=sketchpad/, "and the call that draws on it");
  assert.match(prompt, new RegExp(`-F line=${slug} -F canvas=sketchpad`), "the call names the line, so leaving out canvas still draws for this line");
  assert.match(prompt, /new Canvas, send the same call with -F new=1/, "and how to make a new Canvas on the line when the person asks for one");
  assert.match(prompt, new RegExp(`---env ${slug} ${p.id}$`), "the run knows its line and project");
  // The Ask keeps its Canvas in the file, and the page sees it on the Ask and on the work.
  const md = service.readDoc(p, slug);
  assert.match(md, /> On the Canvas \[Sketchpad\]\(\.\.\/files\/sketchpad\/canvas\.penecho\.json\)/);
  const doc = F.parseLine(md), ask = doc.steps.find(s => s.kind === "ask");
  assert.equal(ask.text, "Draw the login flow.", "the words are not changed by it");
  assert.equal(ask.files.length, 0, "the Canvas is not an attached file");
  const state = await call("GET", `/projects/${p.id}/state`), line = [...state.lines, ...state.landed, ...state.backlog].find(l => l.slug === slug);
  assert.deepEqual(line.stations.filter(s => s.kind !== "canvas").map(s => [s.kind, s.canvas]), [["ask", made.source], ["work", made.source]]);
  // The dropped drawing became one more picture on that Canvas, and no second Canvas was made.
  const bundle = readJson(path.join(p.docsPath, made.source));
  assert.deepEqual(widgetsOf(bundle).map(w => w.title), ["Login flow"]);
  assert.ok(!fs.existsSync(path.join(p.docsPath, `files/${slug}/login.penecho.json`)), "no Canvas of its own");
  assert.equal(fs.readFileSync(path.join(p.docsPath, made.picture), "latin1").includes("saved by the page"), true, "the page's picture is kept until it saves one with both");
  // The picture goes with the Ask for an agent that can see.
  assert.ok(service.askFilePaths(p, ask).includes(path.join(p.docsPath, made.picture)));
});

test("/api/draw with only line= lands on the Canvas the line's Ask came from; an explicit canvas still wins", async () => {
  const { service, call, sendDraw, project } = await setup(), p = project("Draw");
  const made = await call("POST", `/projects/${p.id}/canvases`, { title:"Open one", blank:true });
  const other = await call("POST", `/projects/${p.id}/canvases`, { title:"Other", blank:true });
  const { slug, step } = await call("POST", `/projects/${p.id}/unsent`, { text:"no drawing, just think", canvas:made.source });
  // Not sent yet: the line has no Canvas to draw on until the Ask goes.
  assert.equal(service.lineCanvas(p, slug), "");
  const ran = await call("POST", `/projects/${p.id}/topics/${slug}/run-unsent`, { step });
  assert.equal(ran.status, 200, ran.error);
  await until(() => finished(service, p, slug), "the run");
  assert.equal(service.lineCanvas(p, slug), made.source);
  const flow = JSON.stringify({ type:"workflow", title:"Flow", nodes:[{ id:"s", label:"A", type:"start" }, { id:"e", label:"B", type:"end" }], edges:[{ from:"s", to:"e" }] });
  const onLine = await sendDraw({ folder:p.docsPath, line:slug }, "flow.diagram.json", flow);
  assert.equal(onLine.status, 200, onLine.error);
  assert.equal(onLine.path, made.source);
  assert.deepEqual(widgetsOf(readJson(path.join(p.docsPath, made.source))).map(w => w.title), ["Flow"]);
  const explicit = await sendDraw({ folder:p.docsPath, line:slug, canvas:other.slug }, "flow.diagram.json", flow);
  assert.equal(explicit.path, other.source, "canvas= wins");
  // The run's environment is enough: a folder of the line is not needed, line= alone does it.
  assert.equal((await sendDraw({ project:p.id, line:slug }, "flow.diagram.json", flow)).path, made.source);
  // Asked for a new Canvas: new=1 makes one on the line, linked from it, and leaves the open one alone. The same name again updates it.
  const before = fs.readFileSync(path.join(p.docsPath, made.source), "utf8");
  const fresh = await sendDraw({ project:p.id, line:slug, new:"1" }, "flow.diagram.json", flow);
  assert.equal(fresh.status, 200, fresh.error);
  assert.equal(fresh.path, `files/${slug}/flow.penecho.json`);
  assert.equal(fresh.line, slug);
  assert.equal(fs.readFileSync(path.join(p.docsPath, made.source), "utf8"), before, "the Canvas the Ask came from is not touched");
  assert.ok(service.readDoc(p, slug).includes(`](../files/${slug}/flow.png)`), "the line shows the new Canvas");
  assert.equal((await sendDraw({ project:p.id, line:slug, new:"1" }, "flow.diagram.json", flow)).path, fresh.path);
  // A name that is already a Canvas on the line gets a free one, never that Canvas.
  const named = await sendDraw({ project:p.id, line:slug, new:"1" }, "canvas.diagram.json", flow);
  assert.notEqual(named.path, made.source);
});

test("a Canvas a Work made without naming its line, and linked from its result, shows under that Work", async () => {
  const { service, call, sendDraw, project } = await setup(), p = project("Loose");
  const asked = await call("POST", `/projects/${p.id}/topics`, { text:"no drawing, just think" });
  await until(() => finished(service, p, asked.slug), "the run");
  const flow = JSON.stringify({ type:"workflow", title:"Flow", nodes:[{ id:"s", label:"A", type:"start" }, { id:"e", label:"B", type:"end" }], edges:[{ from:"s", to:"e" }] });
  const drawn = await sendDraw({ project:p.id }, "architecture.diagram.json", flow);
  assert.equal(drawn.line, "", "sent with the project only, it is a Canvas of its own");
  const lineOf = async () => { const state = await call("GET", `/projects/${p.id}/state`); return { state, line:[...state.lines, ...state.landed, ...state.backlog].find(l => l.slug === asked.slug) }; };
  const { line:first } = await lineOf(), work = first.stations.find(s => s.kind === "work");
  assert.ok(work.detail, "the Work has a detail file");
  // The run writes its detail file last: change it only after that.
  const detail = path.join(p.docsPath, work.detail), text = await until(() => { const now = fs.readFileSync(detail, "utf8"); return /\nended: /.test(now) && now; }, "the detail file");
  fs.writeFileSync(detail, `${text.trimEnd()}\n\n## Result\n\nA new Canvas.\n\n![Architecture](../../files/architecture/canvas.png)\n`);
  // The state is kept a moment between looks at the folder, so it is asked again until the change is seen.
  const { state, line } = await until(async () => { const now = await lineOf(); return now.line.stations.find(s => s.id === work.id).pictures.length && now; }, "the picture under the Work", 5000), shown = line.stations.find(s => s.id === work.id);
  assert.deepEqual(shown.pictures.map(pic => [pic.title, pic.path]), [["Architecture", "files/architecture/canvas.png"]]);
  assert.ok(line.pictures.some(pic => pic.path === "files/architecture/canvas.png"), "it is one of the line's pictures");
  const canvas = state.pictures.find(c => c.source === "files/architecture/canvas.penecho.json");
  assert.equal(canvas.topic, asked.slug, "and the Canvas belongs to the line");
  assert.ok(!canvas.loose);
});

test("an Ask with no Canvas is told nothing about one, and its drawing gets a Canvas of its own as before", async () => {
  const { service, docsBase, call, project } = await setup(), p = project("Plain");
  const asked = await call("POST", `/projects/${p.id}/topics`, { text:"Draw the login flow." });
  await until(() => finished(service, p, asked.slug), "the run");
  const prompt = fs.readFileSync(path.join(docsBase, `prompt-${asked.slug}.txt`), "utf8");
  assert.doesNotMatch(prompt, /sent from the Canvas|has open beside|-F canvas=/);
  // How to draw is read only when the work needs it (PE-916): every run gets one line that names the help file.
  const help = path.join(p.docsPath, ".penecho", "agent-help.md");
  assert.ok(prompt.includes(`For a picture, diagram, note card, slides or a prototype, or to see the Canvas the person has open, first read ${help}.`), "every run is told where the drawing words are");
  assert.match(fs.readFileSync(help, "utf8"), /name\.diagram\.json/, "the help file has them");
  assert.ok(fs.existsSync(path.join(p.docsPath, `files/${asked.slug}/login.penecho.json`)), "a Canvas of its own, as today");
});

test("saving a sidebar Ask carries its viewport before the first Canvas poll", async () => {
  const { service, call, project } = await setup(), p = project("Save handshake");
  const canvas = await service.createCanvas(p, { title:"Panned", blank:true });
  const box = { x:7440, y:8458, w:3640, h:3084 };
  const saved = await call("POST", `/projects/${p.id}/unsent`, { canvas:canvas.source, canvasView:box, text:"no drawing" });
  assert.equal(saved.status, 200);
  assert.deepEqual(service.openCanvas(p, canvas.source).box, box);
  const follow = await call("POST", `/projects/${p.id}/unsent`, { topic:saved.slug, canvas:canvas.source, canvasView:box, text:"no drawing, another question" });
  const asks = F.parseLine(service.readDoc(p, saved.slug)).asks;
  assert.equal(follow.slug, saved.slug);
  assert.deepEqual(asks.map(a => a.canvas.path), [canvas.source, canvas.source]);
});

test("Canvas suggestions open an unsent sidebar Ask with its image; only Run with starts it", async () => {
  const { service, call, project, docsBase, origin } = await setup(), p = project("Suggestion routing");
  const canvas = await service.createCanvas(p, { title:"Sketch", blank:true });
  const box = { x:10, y:20, w:130, h:90 }, png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const requests = [], shots = [], statuses = [], panel = { frame:{} }, target = { box, selection:{ phase:"active", box }, selectionKey:"selection:1" };
  const ctx = vm.createContext({
    state:{ language:"en", history:[], selection:target.selection, scale:1 }, smartSuggest:{ selectionVersion:1 },
    canvasDocuments:{ epoch:1, activeId:"doc" }, canvasDocumentsCurrent:()=>({ id:"doc" }), assistAgent:{ generation:0 },
    projectLinesTarget:{ project:p.id, source:canvas.source }, projectLinesRun:{ ready:true, documentId:"doc", snapshotId:"saved" },
    projectLinesLocal:()=>true, projectLinesPanel:panel, projectLinesBehind:()=>({ file:false }), projectLinesSeenRect:()=>box,
    projectLinesAddress:x=>x, projectLinesAdoptLine:slug=>{ ctx.projectLinesTarget.doc=`lines/${slug}.md`; },
    projectLinesPanelShow:open=>{ panel.open=open; }, viewportRect:()=>box, suggestionCopy:en=>en, setStatus:msg=>statuses.push(msg),
    projectLinesFetch:(url,init)=>{ requests.push(url); return fetch(new URL(url,origin),init); },
    canvasAgentCapture:async(args,{ assertCurrent })=>{ assertCurrent(); shots.push(args.target); return { dataUrl:`data:image/png;base64,${png}` }; },
    assistRequestStarted(){}, assistRequestFinished(){}, cancelWidgetRefinement(){}, supersedeActiveAI(){}, clearTimeout,
    renderAssist(){}, smartSuggestRecent(){}, t:key=>key, assistClassifyRequest:()=>({ type:"choice", choice:"penecho_agent" }),
    SMART_SUGGEST:require("../public/smart-suggest.js"), ASSIST_AGENT_TASKS:{ prototype:"Build a working prototype." },
    URLSearchParams, atob, Blob, Uint8Array,
  });
  function use(file, names) {
    const source = fs.readFileSync(path.join(__dirname,"../src/client/app",file),"utf8");
    for (const name of names) {
      const start = new RegExp(`^  (?:async )?function ${name}\\(`, "m").exec(source).index;
      vm.runInContext(source.slice(start, source.indexOf("\n  }",start)+4),ctx);
    }
  }
  use("assist-agent.js",["assistAgentTargetCurrent","assistAgentTaskContext"]);
  use("persistence.js",["dataUrlBlob"]);
  use("project-lines-bridge.js",["projectLinesCanAsk","projectLinesActiveLineSlug","projectLinesContextLineSlug","projectLinesPanelAddress","projectLinesJson","projectLinesSaveSuggestion"]);
  use("smart-suggestions.js",["assistUnion","assistSelectionTargetValid","assistSaveSidebarTask","assistAsk","executeAssistAction"]);
  await ctx.assistAsk("Describe the selected content, no drawing.",target);
  assert.match(statuses.at(-1),/Run with/,statuses.join("\n"));
  const slug = ctx.projectLinesContextLineSlug(), first = F.parseLine(service.readDoc(p,slug)).asks[0];
  assert.match(first.text,/Describe the selected content/);
  assert.match(first.text,/masked selection/);
  assert.equal(first.canvas.path,canvas.source);
  assert.equal(F.isUnsent(first),true);
  assert.equal(panel.open,true);
  assert.match(panel.frame.src,new RegExp(`/line/${slug}/${first.id}$`));
  ctx.state.selection = null;
  await Promise.all([1,2].map(()=>ctx.executeAssistAction({ id:"prototype" },{ box,strokes:[] })));
  const asks = F.parseLine(service.readDoc(p,slug)).asks;
  assert.equal(asks.length,2,"a double click saves the second task just once");
  assert.match(asks[1].text,/Build prototype/);
  assert.deepEqual(shots,["selection","region"]);
  assert.ok(asks.every(a=>F.isUnsent(a) && a.canvas.path===canvas.source));
  assert.ok(service.readDoc(p,slug).includes("![selection.png]"),"the masked image was attached");
  assert.deepEqual(requests.map(url=>new URL(url,origin).pathname.split("/").at(-1)),["upload","unsent","upload","unsent"]);
  assert.equal(service.runs.size,0);
  const promptPath = path.join(docsBase,`prompt-${slug}.txt`);
  assert.equal(fs.existsSync(promptPath),false);
  const ran = await call("POST",`/projects/${p.id}/topics/${slug}/run-unsent`,{ step:first.id, agent:"fake" });
  assert.equal(ran.status,200,ran.error);
  await until(()=>fs.existsSync(promptPath) && !service.runs.size,"explicit Run with");
  assert.match(fs.readFileSync(promptPath,"utf8"),/Describe the selected content/);
  assert.ok(F.parseLine(service.readDoc(p,slug)).asks.some(a=>F.isUnsent(a) && a.text.includes("Build prototype")));
});
