"use strict";
require("./helpers/safety.js");
// PE-404: what to make is chosen in the box and kept as one line on the Ask, never as prompt text. The agent is told one exact
// file to write, and a note card file becomes cards on a Canvas.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const F = require("../src/server/project-lines/format.js");
const C = require("../src/server/project-lines/canvas-file.js");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { createProjectLines } = require("../src/server/project-lines/http.js");

const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penecho-make-")));
const closers = [];
after(() => { for (const close of closers) close(); fs.rmSync(temp, { recursive:true, force:true }); });
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(check, label, ms = 20000) { const start = Date.now(); for (;;) { const v = await check(); if (v) return v; if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}`); await wait(25); } }
const widgetsOf = bundle => bundle.assets.filter(a => a.kind === "widget").map(a => JSON.parse(Buffer.from(a.dataBase64, "base64").toString("utf8")));
const card = (title, extra = {}) => ({ title, blocks:[{ type:"markdown", text:`About ${title}.` }], ...extra });

test("the Make line is written, read back and kept out of the words", () => {
  assert.equal(F.makeLine({ kind:"slides", sub:"investor" }), "> Make · Slides · Investor update");
  assert.equal(F.makeLine({ kind:"diagram", sub:"nope" }), "> Make · Diagram · AI picks", "an unknown kind falls back to the first");
  assert.equal(F.makeLine({ kind:"draw" }), "", "only the four kinds");
  const body = F.askStep({ words:"Q3 results for the board", refs:["[table-1.csv](../files/x/table-1.csv)", F.makeLine({ kind:"slides", sub:"investor" })] }).body;
  const md = `---\nid: PE-1\nstatus: waiting\n---\n\n# X\n\n## Ask · 2026-11-15 10:00 · Not sent\n\n${body}\n`;
  const ask = F.parseLine(md).steps.find(s => s.kind === "ask");
  assert.equal(ask.text, "Q3 results for the board");
  assert.deepEqual(ask.make, { kind:"slides", sub:"investor", label:"Slides", subLabel:"Investor update" });
  assert.equal(ask.files.length, 1, "the table is still an attached file");
  assert.ok(F.linkLines(ask.body).includes("> Make · Slides · Investor update"), "a retried Ask keeps it");
});

test("each choice asks for exactly one kind of file", () => {
  const say = make => F.makeSay(make, "/d/files/x", "/d/.penecho/ppt-slides.md", "CONTRACT");
  assert.match(say({ kind:"diagram", sub:"sequence" }), /one name\.diagram\.json in \/d\/files\/x with "type":"sequence"/);
  assert.match(say({ kind:"diagram", sub:"auto" }), /whichever type fits best/);
  assert.match(say({ kind:"explorer", sub:"prototype" }), /name\.explorer\.html[\s\S]*stop, because the person looks at it first/);
  assert.match(say({ kind:"slides", sub:"market" }), /in the market template\. Read \/d\/\.penecho\/ppt-slides\.md first, then write name\.slide-01\.html/);
  assert.match(say({ kind:"slides", sub:"auto" }), /pick the closest and say which/);
  assert.match(say({ kind:"card", sub:"flashcards" }), /\{"cards":\[…\]\}[\s\S]*one name\.note\.json in \/d\/files\/x\. CONTRACT/);
  assert.match(say({ kind:"card", sub:"work" }), /"style":"note"/);
  assert.equal(say(null), "");
  assert.match(F.pictureFormats(), /name\.note\.json for note cards/, "agents are told the note file in the picture formats too");
});

test("a note file becomes cards side by side on one Canvas, and fewer cards later leave none behind", async () => {
  assert.ok(C.SOURCE.test("files/x/terms.note.json"));
  assert.equal(C.pictureBase("files/x/terms.note.json"), "files/x/terms");
  assert.throws(() => C.checkPicture("x.note.json", JSON.stringify({ blocks:[] })), /title is required/);
  assert.throws(() => C.checkPicture("x.note.json", JSON.stringify({ cards:[card("A"), { blocks:[{ type:"markdown", text:"x" }] }] })), /^Error: Card 2: title is required/);
  const one = await C.makePicture({ source:"files/x/photo.note.json", text:JSON.stringify(card("Photosynthesis", { style:"card" })), existing:null, name:"photo.note.json", renderPage:() => null });
  assert.equal(one.title, "Photosynthesis");
  assert.ok(one.png?.length > 100, "it has a picture");
  const [w] = widgetsOf(one.bundle);
  assert.equal(w.sourceFormat, "penecho-note-card+json");
  assert.deepEqual([w.w, w.h, w.contentW, w.contentH], [900, 1200, 900, 1200]);
  assert.equal(JSON.parse(w.copyText).title, "Photosynthesis", "the card keeps its note object to copy and edit");
  const three = await C.makePicture({ source:"files/x/terms.note.json", text:JSON.stringify({ cards:["One", "Two", "Three"].map(t => card(t)) }), existing:null, name:"terms.note.json", renderPage:() => null });
  const ws = widgetsOf(three.bundle);
  assert.deepEqual(ws.map(x => x.title), ["One", "Two", "Three"]);
  assert.deepEqual(ws.map(x => x.x), [2000, 3000, 4000], "side by side, in order");
  assert.equal(ws[0].id, C.sourceWidgetId("files/x/terms.note.json"), "the first card is the file's own Widget");
  const fewer = await C.makePicture({ source:"files/x/terms.note.json", text:JSON.stringify([card("Only")]), existing:JSON.stringify(three.bundle), name:"terms.note.json", renderPage:() => null });
  assert.deepEqual(widgetsOf(fewer.bundle).map(x => x.title), ["Only"]);
});

// ---------- Through the server ----------
const agentScript = path.join(temp, "agent.js");
fs.writeFileSync(agentScript, `
const fs = require("fs");
const say = o => console.log(JSON.stringify(o));
let prompt = "";
process.stdin.on("data", d => prompt += d).on("end", () => {
  const docs = process.env.PENECHO_DOCS_FOLDER, slug = process.env.PENECHO_LINE;
  fs.writeFileSync(docs + "/../prompt-" + slug + ".txt", prompt);
  say({ type:"system", subtype:"init", session_id:"session-" + slug });
  if (/name\\.note\\.json/.test(prompt)) { fs.mkdirSync(docs + "/files/" + slug, { recursive:true }); fs.writeFileSync(docs + "/files/" + slug + "/terms.note.json", JSON.stringify({ cards:[{ title:"Mitosis", blocks:[{ type:"qa", question:"Phases?", answer:"PMAT" }] }, { title:"Meiosis", blocks:[{ type:"qa", question:"Cells?", answer:"Four" }] }] })); }
  say({ type:"result", subtype:"success", is_error:false, result:"Made it.", session_id:"session-" + slug });
});
`);
let setups = 0;
async function setup() {
  const root = path.join(temp, String(++setups)), directory = path.join(root, "state"), docsBase = path.join(root, "base"), home = path.join(root, "home");
  fs.mkdirSync(docsBase, { recursive:true }); fs.mkdirSync(directory, { recursive:true }); fs.mkdirSync(home, { recursive:true });
  const agents = createAgents({ env:{ PATH:"" }, extra:{ fake:{ name:"Fake", mono:"Fk", color:"#000", role:"Build", resolve:() => ({ command:process.execPath, prefixArgs:[agentScript] }), command:(launch, { workdir }) => ({ command:launch.command, args:launch.prefixArgs, cwd:workdir, stdin:true }) } } });
  const lines = createProjectLines({ directory, agents, agentPaths:{ home }, serviceOptions:{ autoWatch:false, docsBase, renderPage:() => null }, authorizeRead:() => null, authorizeWrite:() => null, isThisComputer:() => true,
    readJson:req => new Promise((resolve, reject) => { let s = ""; req.on("data", d => { s += d; }).on("end", () => { try { resolve(s ? JSON.parse(s) : {}); } catch (error) { reject(error); } }); }),
    send:(res, code, data) => { res.writeHead(code, { "content-type":"application/json" }); res.end(JSON.stringify(data)); } });
  const server = http.createServer(async (req, res) => { if (!await lines.handle(req, res, new URL(req.url, "http://x"))) { res.writeHead(404); res.end(); } });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  closers.push(() => { server.close(); lines.close(); });
  const port = server.address().port;
  const call = async (method, route, body) => { const res = await fetch(`http://127.0.0.1:${port}/api/lines${route}`, { method, ...(body ? { headers:{ "content-type":"application/json" }, body:JSON.stringify(body) } : {}) }); return { status:res.status, ...await res.json() }; };
  const p = lines.service.store.create({ name:"Biology", docsPath:path.join(docsBase, "Biology") });
  p.defaultAgent = "fake";
  return { service:lines.service, docsBase, call, p };
}

test("a choice made in the box goes with the Ask, tells the agent one file, and the cards land on a Canvas", async () => {
  const { service, docsBase, call, p } = await setup();
  const saved = await call("POST", `/projects/${p.id}/unsent`, { text:"Chapter 3, two cards", topic:"new", make:{ kind:"card", sub:"flashcards" } });
  assert.equal(saved.status, 200, saved.error);
  const slug = saved.slug;
  assert.match(service.readDoc(p, slug), /\nChapter 3, two cards\n\n> Make · Note card · Flashcards\n/, "your words, then the choice on its own line");
  const state = await call("GET", `/projects/${p.id}/state`), line = [...state.lines, ...state.backlog].find(l => l.slug === slug);
  const ask = line.stations.find(s => s.kind === "ask");
  assert.equal(ask.text, "Chapter 3, two cards", "no prompt text is added to the words");
  assert.deepEqual(ask.make, { kind:"card", sub:"flashcards", label:"Note card", subLabel:"Flashcards" });
  // Pasting it into an agent's own app says the same one sentence.
  const pasted = await service.pasteUnsent(p, slug, { step:saved.step, context:true }, { local:false });
  assert.match(pasted.text, /They chose flashcards[\s\S]*one name\.note\.json in /);
  assert.doesNotMatch(pasted.text, /> Make ·/, "the line itself is not pasted");
  const ran = await call("POST", `/projects/${p.id}/topics/${slug}/run-unsent`, { step:saved.step });
  assert.equal(ran.status, 200, ran.error);
  await until(() => !service.runs.size && ["done", "ready", "waiting"].includes(F.parseLine(service.readDoc(p, slug)).status), "the run");
  const prompt = fs.readFileSync(path.join(docsBase, `prompt-${slug}.txt`), "utf8");
  assert.match(prompt, new RegExp(`They chose flashcards[\\s\\S]*one name\\.note\\.json in ${path.join(p.docsPath, "files", slug).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(prompt, /PenEcho note card \(sourceFormat/, "with the note card's own rules");
  await service.makePictures(p);
  const canvas = path.join(p.docsPath, "files", slug, "terms.penecho.json");
  assert.ok(fs.existsSync(canvas), "the note file became a Canvas");
  assert.deepEqual(widgetsOf(JSON.parse(fs.readFileSync(canvas, "utf8"))).map(w => w.title), ["Mitosis", "Meiosis"]);
  assert.match(service.readDoc(p, slug), /!\[Terms\]\(\.\.\/files\/[^)]+\/terms\.png\)/, "and its picture is on the line");
});

test("a sent Ask on a line, and a new line, keep the choice too", async () => {
  const { service, call, p } = await setup();
  const made = await call("POST", `/projects/${p.id}/topics`, { text:"How cells divide", kinds:["ask"], make:{ kind:"diagram", sub:"workflow" } });
  assert.equal(made.status, 200, made.error);
  assert.match(service.readDoc(p, made.slug), /> Make · Diagram · Workflow/);
  const more = await call("POST", `/projects/${p.id}/topics`, { text:"Now as slides", kinds:["ask"], topic:made.slug, make:{ kind:"slides", sub:"auto" } });
  assert.equal(more.status, 200, more.error);
  const asks = F.parseLine(service.readDoc(p, made.slug)).steps.filter(s => s.kind === "ask");
  assert.deepEqual(asks.map(a => [a.text, a.make?.kind, a.make?.sub]), [["How cells divide", "diagram", "workflow"], ["Now as slides", "slides", "auto"]]);
});

test("home and line composers hide output buttons inside + and show only an active choice in the bar", () => {
  const vm = require("node:vm");
  const { window, document } = require("./helpers/dom.js").parseHTML("<html><body></body></html>");
  let plusMenu = null;
  const ctx = vm.createContext({
    window, document, console, setTimeout, clearTimeout, addEventListener: () => {},
    ICONS: {}, ACT: {}, S: { comp: {}, cur: "p1", route: { view: "line", line: "l1" } },
    HOSTED: null, EMBED: false,
    $: (s, r = document) => r.querySelector(s),
    $$: (s, r = document) => [...r.querySelectorAll(s)],
    esc: s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c])),
    ic: name => `<svg data-ic="${name}"></svg>`,
    can: () => true,
    project: () => ({ id: "p1", lines: [] }),
    detectPath: () => ({ kind: "line", stay: true }),
    boxTarget: () => null,
    branchPicker: () => "",
    openMenu: (_el, items) => { plusMenu = items; },
    closeMenu: () => {},
    getComputedStyle: () => ({ lineHeight: "22", paddingTop: "0", paddingBottom: "0", paddingRight: "0" }),
    navigator: { platform: "MacIntel", userAgent: "Mac" },
  });
  for (const file of ["composer.js", "make.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/lines", file), "utf8"), ctx);
  }
  document.body.innerHTML = ctx.composerHTML("line-box", { placeholder: "Add to this line. Type / for quick starts.", preview: true, on: "step", topic: "l1" });
  const form = document.querySelector(".composer");
  ctx.syncComposer(form);
  const chips = form.querySelector(".cmp-chips");
  assert.equal(chips.hidden, true, "output buttons are hidden from the bar by default");
  assert.deepEqual([...form.querySelectorAll(".cmp-chip")], []);

  ctx.ACT["cmp-plus"](form.querySelector(".cmp-plus"));
  assert.deepEqual(Array.from(plusMenu.filter(i => !i.sep), i => i.label), [
    "Add images or files", "Add new canvas", "Diagram", "Explorer", "Slides", "Note card", "MeetCue",
  ]);

  plusMenu.find(i => i.label === "Diagram").fn();
  assert.equal(chips.hidden, false, "choosing an output shows only the active chip");
  assert.deepEqual([...form.querySelectorAll(".cmp-chip")].map(el => el.textContent), ["Diagram"]);
  assert.equal(form.querySelector(".cmp-chip").getAttribute("aria-pressed"), "true");

  ctx.ACT["make-chip"](form.querySelector(".cmp-chip"));
  assert.equal(chips.hidden, true, "clearing the active choice hides the chip container again");
  assert.deepEqual([...form.querySelectorAll(".cmp-chip")], []);
});
