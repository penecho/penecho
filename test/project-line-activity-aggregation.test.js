"use strict";
require("./helpers/safety.js");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { test, after } = require("node:test");
const { parseHTML } = require("./helpers/dom.js");
const { ActivityLog, agyTool, parseLine, parseAppServer, parseDialect } = require("../src/server/project-lines/activity.js");
const { parseAntigravityStep } = require("../src/server/project-lines/antigravity-sessions.js");
const { piLine, dshLine, opencodePartChanges } = require("../src/server/project-lines/agent-sessions.js");
const { Service } = require("../src/server/project-lines/service.js");
const { createAgents } = require("../src/server/project-lines/agents.js");
const F = require("../src/server/project-lines/format.js");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-act-agg-"));
after(() => fs.rmSync(temp, { recursive:true, force:true }));
let counter = 0;
const fresh = name => { const dir = path.join(temp, `${name}-${++counter}`); fs.mkdirSync(dir, { recursive:true }); return fs.realpathSync(dir); };
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(check, label, ms = 8000) {
  const start = Date.now();
  for (;;) { const value = await check(); if (value) return value; if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}`); await wait(25); }
}

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const ic = (name, size = 14) => `<svg class="ic" data-ic="${name}" width="${size}" height="${size}"></svg>`;
const lineSrc = fs.readFileSync(path.join(__dirname, "../public/lines/line.js"), "utf8");
const slice = (src, start, end) => {
  const a = src.indexOf(start), b = src.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error(`Slice not found: ${start} .. ${end}`);
  return src.slice(a, b);
};

function renderHarness() {
  const { document } = parseHTML("<html><body><div id='lppScroll'><div id='lppLive'></div><div id='lppRows'></div><span id='lppCount'></span></div></body></html>");
  const c = vm.createContext({
    document, console, esc, ic, S:{ lineSel:null, detailsShown:{} },
    av:id => `<span class="av">${esc(id)}</span>`,
    agentInfo:id => ({ name:id === "antigravity" ? "Antigravity" : String(id) }),
    shortWhen:() => "3:38pm",
    sayHTML:t => `<p>${esc(t)}</p>`,
    shortPath:t => t,
    project:() => ({ id:"p1", vault:{ path:"/docs" } }),
    apiUrl:u => `/api/${u}`,
    topicApi:(p, l, v) => `${p.id}/${l.slug}/${v}`,
    mdSection:() => "",
    docById:() => null,
    isOrchReview:() => false,
    paintLive:() => {},
    $:(sel, root = document) => root.querySelector(sel),
    $$:(sel, root = document) => [...root.querySelectorAll(sel)],
  });
  vm.runInContext(slice(lineSrc, "function toolRow(row, l) {", "// While a Topic is on screen"), c);
  return { document, c };
}

test("rowsHTML aggregates consecutive actions between LLM texts with natural summaries and picture thumbnails", () => {
  const { document, c } = renderHarness();
  const l = { id:"l1", slug:"demo", workdir:"/repo" };
  const s = { id:"work-1", state:"active", agent:"antigravity" };
  const rows = [
    { i:0, step:"work-1", kind:"start", agent:"antigravity", at:1000 },
    { i:1, step:"work-1", kind:"say", thinking:true, text:"Checking the timing fault before editing." },
    { i:2, step:"work-1", kind:"tool", verb:"Ran", target:"ffmpeg -i a.mp4", code:true, state:"done", output:"ok" },
    { i:3, step:"work-1", kind:"tool", verb:"Ran", target:"ffprobe a.mp4", code:true, state:"done", output:"ok" },
    { i:4, step:"work-1", kind:"say", text:"Timing fault found: fixing clip timing first." },
    { i:5, step:"work-1", kind:"tool", verb:"Ran", target:"node fix.js", code:true, state:"done" },
    { i:6, step:"work-1", kind:"tool", verb:"Ran", target:"node check.js", code:true, state:"done" },
    { i:7, step:"work-1", kind:"tool", verb:"Ran", target:"node render.js", code:true, state:"done" },
    { i:8, step:"work-1", kind:"tool", verb:"Read", target:"/repo/title-half.png", state:"done", pictures:["aaa1112223334445-0.png"] },
    { i:9, step:"work-1", kind:"say", text:"Checking every clip's first and last frame." },
    { i:10, step:"work-1", kind:"tool", verb:"Read", target:"/repo/f1.png", state:"done", pictures:["p1-0.png", "p1-1.png"] },
    { i:11, step:"work-1", kind:"tool", verb:"Read", target:"/repo/f2.png", state:"done", pictures:["p2-0.png", "p2-1.png", "p2-2.png"] },
    { i:12, step:"work-1", kind:"tool", verb:"Ran", target:"node verify.js", code:true, state:"done" },
    { i:13, step:"work-1", kind:"tool", verb:"Ran", target:"node scan.js", code:true, state:"done" },
    { i:14, step:"work-1", kind:"say", text:"Updating memory and verifying." },
    { i:15, step:"work-1", kind:"tool", verb:"Read", target:"/docs/MEMORY.md", state:"done" },
    { i:16, step:"work-1", kind:"tool", verb:"Ran", target:"npm test", code:true, state:"running" },
  ];
  const a = { running:true, started:Date.now() - 5000, now:"Running npm test", seq:16, rows:new Map(rows.map(r => [r.i, r])) };
  const html = c.rowsHTML({ id:"p1" }, l, a, s);
  document.getElementById("lppRows").innerHTML = `<div class="act-rows">${html}</div>`;
  const container = document.querySelector(".act-rows");

  const says = [...container.querySelectorAll(":scope > .at-say")];
  assert.equal(says.length, 4, "all 4 LLM text blocks stay visible");
  assert.ok(says[0].classList.contains("is-thinking"));

  const groups = [...container.querySelectorAll(":scope > details.at-group")];
  assert.equal(groups.length, 4, "every action run between texts (including <=4 actions and live tail) is aggregated");
  assert.equal(container.querySelectorAll(":scope > .at").length, 0, "no ungrouped tool rows leak outside groups");

  const labels = groups.map(g => g.querySelector(".at-group-label").textContent.trim());
  assert.deepEqual(labels, [
    "Ran 2 commands",
    "Ran 3 commands, read title-half.png",
    "Read 2 files, ran 2 commands",
    "Recalled a memory, running a command",
  ]);
  assert.equal(groups[1].querySelector(".at-group-file").textContent, "title-half.png");
  assert.equal(groups[1].querySelectorAll(".at-group-thumb").length, 1);
  assert.equal(groups[2].querySelectorAll(".at-group-thumb").length, 3);
  assert.equal(groups[2].querySelector(".at-group-more").textContent, "+2");
  assert.ok(groups[3].classList.contains("is-running"));
  assert.ok(groups[3].querySelector(".at-group-main .spin"));

  // Expanding a group reveals every underlying tool row inside .at-group-body with clickable details and chevrons.
  assert.equal(groups[0].querySelectorAll(".at-group-body .at").length, 2);
  assert.equal(groups[1].querySelectorAll(".at-group-body .at").length, 4);
  const picReadRow = groups[1].querySelector('.at-group-body details.at[data-row="8"]');
  assert.ok(picReadRow, "read row with file path and picture is an expandable details element");
  assert.ok(picReadRow.querySelector("summary .at-chev"), "expandable action row displays chevron cue");
  assert.equal(picReadRow.querySelector("summary .at-file-name").textContent, "title-half.png");
  assert.equal(picReadRow.querySelectorAll("summary .at-row-thumb").length, 1, "row summary shows compact right-aligned thumbnail");
  assert.equal(picReadRow.querySelectorAll(".at-body .at-pictures img").length, 1, "full picture preview renders inside expanded details body");
});

test("finished Work hides only a trailing non-thinking final reply, keeping intermediate texts and block thinking", () => {
  const { document, c } = renderHarness();
  const l = { id:"l1", slug:"demo", workdir:"/repo" };
  const doneWork = { id:"work-1", state:"done", agent:"antigravity" };
  const rows = [
    { i:0, step:"work-1", kind:"start", agent:"antigravity", at:1000 },
    { i:1, step:"work-1", kind:"say", thinking:true, text:"Inspecting live.js and line.js." },
    { i:2, step:"work-1", kind:"tool", verb:"Read", target:"/repo/public/lines/live.js", state:"done" },
    { i:3, step:"work-1", kind:"say", text:"Final answer shown in Result." },
  ];
  const a = { running:false, started:0, now:"", seq:3, rows:new Map(rows.map(r => [r.i, r])) };
  document.getElementById("lppRows").innerHTML = c.rowsHTML({ id:"p1" }, l, a, doneWork);
  const says = [...document.querySelectorAll("#lppRows .at-say")].map(el => el.textContent.trim());
  assert.deepEqual(says, ["Inspecting live.js and line.js."]);

  // If the last row before completion was a tool call after a commentary say, keep that commentary say visible.
  const rowsNoTrailing = rows.slice(0, 3);
  const a2 = { running:false, started:0, now:"", seq:2, rows:new Map(rowsNoTrailing.map(r => [r.i, r])) };
  document.getElementById("lppRows").innerHTML = c.rowsHTML({ id:"p1" }, l, a2, doneWork);
  const says2 = [...document.querySelectorAll("#lppRows .at-say")].map(el => el.textContent.trim());
  assert.deepEqual(says2, ["Inspecting live.js and line.js."]);
});

test("parsers capture block-thinking summaries across Antigravity, Codex, Pi/omp, OpenCode, and dsh without altering final answers", () => {
  // Antigravity transcript step: thinking before tools, not duplicated on final content-only step
  const agTools = parseAntigravityStep(JSON.stringify({
    step_index:1, type:"PLANNER_RESPONSE", status:"DONE", created_at:"2026-11-24T03:40:00Z",
    thinking:"I'm thinking through how to approach this.\n\n\nChecking live.js and line.js.",
    tool_calls:[{ name:"read_file", args:{ Path:"/repo/public/lines/live.js" } }],
  }), { key:"s1" });
  assert.equal(agTools.changes[0].add.kind, "say");
  assert.equal(agTools.changes[0].add.thinking, true);
  assert.equal(agTools.changes[0].add.text, "Checking live.js and line.js.");
  assert.equal(agTools.changes[1].upsert.verb, "Read");
  assert.equal(agTools.changes.some(c => c.said), false);

  const agFinal = parseAntigravityStep(JSON.stringify({
    step_index:2, type:"PLANNER_RESPONSE", status:"DONE", created_at:"2026-11-24T03:41:00Z",
    thinking:"Wrapping up the final answer.",
    content:"Done updating the UI.",
  }), { key:"s2" });
  assert.equal(agFinal.changes.filter(c => c.add?.kind === "say").length, 1);
  assert.equal(agFinal.changes[0].add.text, "Done updating the UI.");

  // Codex reasoning summary (both exec and app-server)
  const cxApp = parseAppServer({ method:"item/completed", params:{ item:{ type:"reasoning", id:"rs_1", summary:["Inspecting the activity timeline."] } } });
  assert.deepEqual(cxApp, [{ add:{ kind:"say", thinking:true, id:"codex-reason-rs_1", text:"Inspecting the activity timeline." } }]);
  const cxEmpty = parseAppServer({ method:"item/completed", params:{ item:{ type:"reasoning", id:"rs_2", summary:[], content:[] } } });
  assert.deepEqual(cxEmpty, []);
  const cxExec = parseLine(JSON.stringify({ type:"item.completed", item:{ type:"reasoning", id:"rs_3", summary:[{ text:"Checking tests." }] } }));
  assert.deepEqual(cxExec, [{ add:{ kind:"say", thinking:true, id:"codex-reason-rs_3", text:"Checking tests." } }]);

  // Pi / omp: thinking emitted when calling tools without text, NOT as final answer
  const piThink = parseDialect("pi", JSON.stringify({
    type:"message_end",
    message:{ role:"assistant", content:[{ type:"thinking", thinking:"Reading live.js next." }, { type:"toolCall", id:"tc1", name:"read", arguments:{ path:"live.js" } }] },
  }));
  assert.equal(piThink.some(c => c.add?.kind === "say" && c.add.thinking === true && c.add.text === "Reading live.js next."), true);
  assert.equal(piThink.some(c => c.said), false);
  const piRec = piLine(JSON.stringify({
    type:"message", timestamp:"2026-11-24T03:40:00Z",
    message:{ role:"assistant", content:[{ type:"thinking", thinking:"Checking tests." }, { type:"toolCall", id:"tc2", name:"bash", arguments:{ command:"npm test" } }] },
  }));
  assert.equal(piRec.changes[0].add.kind, "say");
  assert.equal(piRec.changes[0].add.thinking, true);
  assert.equal(piRec.changes[1].add.kind, "tool");

  // OpenCode reasoning (stream & db part)
  const ocStream = parseDialect("opencode", JSON.stringify({ type:"reasoning", part:{ text:"Comparing layout specs." } }));
  assert.deepEqual(ocStream, [{ add:{ kind:"say", thinking:true, text:"Comparing layout specs." } }]);
  const ocPart = opencodePartChanges({ type:"reasoning", text:"Comparing layout specs.", time:{ end:1 } }, false);
  assert.deepEqual(ocPart, [{ add:{ kind:"say", thinking:true, text:"Comparing layout specs." } }]);

  // dsh reasoning (stream & session)
  const dshStream = parseDialect("dsh", JSON.stringify({ type:"reasoning", text:"Checking runner." }));
  assert.deepEqual(dshStream, [{ add:{ kind:"say", thinking:true, text:"Checking runner." } }]);
  const dshRec = dshLine(JSON.stringify({ type:"assistant/message", seq:5, time:100, data:{ message:{ content:[{ type:"reasoning", text:"Inspecting files." }] } } }));
  assert.deepEqual(dshRec.changes, [{ add:{ kind:"say", thinking:true, text:"Inspecting files." } }]);
});

test("Service pulls Antigravity block-thinking summaries live from transcript.jsonl in order before tools, without duplicating on resume", async () => {
  const dir = fresh("agy-live-think"), home = fresh("home"), script = path.join(dir, "agy.js");
  const transcriptFile = path.join(home, ".gemini", "antigravity-cli", "brain", "conv-think-1", ".system_generated", "logs", "transcript.jsonl");
  fs.writeFileSync(script, `
const fs = require("fs"), path = require("path");
const tf = ${JSON.stringify(transcriptFile)};
const say = o => console.log(JSON.stringify(o));
const appendT = o => { fs.mkdirSync(path.dirname(tf), { recursive:true }); fs.appendFileSync(tf, JSON.stringify(o) + "\\n"); };
let buffer = "";
process.stdin.on("data", d => {
  buffer += d; const parts = buffer.split("\\n"); buffer = parts.pop();
  if (!parts.length) return;
  say({ event:"init", conversation_id:"conv-think-1", init:{ cwd:process.cwd(), tools:[] } });
  appendT({ step_index:0, source:"USER_EXPLICIT", type:"USER_INPUT", status:"DONE", created_at:"2026-11-24T03:40:00Z", content:"Fix live UI" });
  say({ event:"step_update", step_update:{ conversation_id:"conv-think-1", step_index:0, state:"DONE", step_type:"user_input" } });
  appendT({ step_index:1, source:"MODEL", type:"PLANNER_RESPONSE", status:"DONE", created_at:"2026-11-24T03:40:02Z", thinking:"I'm thinking through how to approach this.\\n\\n\\nReading live.js to inspect the octopus panel.", tool_calls:[{ name:"read_file", args:{ Path:"/w/live.js" } }] });
  say({ event:"step_update", step_update:{ conversation_id:"conv-think-1", step_index:1, state:"DONE", step_type:"agent_response", usage:{ thinking_tokens:120 } } });
  say({ event:"step_update", step_update:{ conversation_id:"conv-think-1", step_index:2, state:"ACTIVE", step_type:"tool", tool_name:"read_file", tool_info:{ name:"read_file", parameters:{ Path:"/w/live.js" } } } });
  say({ event:"step_update", step_update:{ conversation_id:"conv-think-1", step_index:2, state:"DONE", step_type:"tool", tool_name:"read_file", tool_info:{ name:"read_file", parameters:{ Path:"/w/live.js" }, output:"ok" } } });
  appendT({ step_index:3, source:"MODEL", type:"PLANNER_RESPONSE", status:"DONE", created_at:"2026-11-24T03:40:05Z", thinking:"Found the action list; now editing live.js.", tool_calls:[{ name:"edit_file", args:{ Path:"/w/live.js" } }] });
  say({ event:"step_update", step_update:{ conversation_id:"conv-think-1", step_index:3, state:"DONE", step_type:"agent_response" } });
  say({ event:"step_update", step_update:{ conversation_id:"conv-think-1", step_index:4, state:"DONE", step_type:"tool", tool_name:"edit_file", tool_info:{ name:"edit_file", parameters:{ Path:"/w/live.js" }, output:"ok" } } });
  appendT({ step_index:5, source:"MODEL", type:"PLANNER_RESPONSE", status:"DONE", created_at:"2026-11-24T03:40:08Z", thinking:"All done.", content:"Updated live.js and line.js." });
  say({ event:"step_update", step_update:{ conversation_id:"conv-think-1", step_index:5, state:"DONE", step_type:"agent_response", text_delta:"Updated live.js and line.js." } });
  say({ event:"result", result:{ conversation_id:"conv-think-1", status:"SUCCESS", response:"Updated live.js and line.js." } });
});`);
  const agents = createAgents({ env:{ PATH:"", HOME:home, AGY_CLI_PATH:script } });
  const service = new Service({ directory:fresh("state"), agents, autoWatch:false, conversations:{ home, env:{ HOME:home } } });
  const project = service.store.create({ name:"Demo", docsPath:fresh("docs"), codePath:null });
  project.defaultAgent = "antigravity";
  try {
    const asked = await service.request(project, { text:"Fix live UI", topic:"new" });
    await until(() => !service.runs.size && F.parseLine(service.readDoc(project, asked.slug)).status === "done", "agy thinking run");
    const rows = service.activityOf(project, asked.slug, 0).rows.filter(r => r.step === "work-1" && r.kind !== "start");
    assert.deepEqual(rows.map(r => [r.kind, r.thinking || false, r.kind === "say" ? r.text : r.verb]), [
      ["say", true, "Reading live.js to inspect the octopus panel."],
      ["tool", false, "Read"],
      ["say", true, "Found the action list; now editing live.js."],
      ["tool", false, "Edited"],
      ["say", false, "Updated live.js and line.js."],
    ]);
    assert.match(service.readDoc(project, asked.slug), /Updated live\.js and line\.js\./);
  } finally {
    service.close();
  }
});

test("ActivityLog scopes patch/findById per step and updates index on retag", () => {
  const dir = fresh("act-step-scope");
  const log = new ActivityLog(dir);
  const project = { id:"p1" }, slug = "same-line";
  const w1 = log.add(project, slug, { kind:"tool", id:"item_0", verb:"Read", target:"/repo/old.js", state:"done", step:"work-1" });
  assert.equal(log.patch(project, slug, "item_0", { state:"running", target:"/repo/new.js" }, "work-2"), null, "work-2 never patches work-1 row");
  const w2 = log.add(project, slug, { kind:"tool", id:"item_0", verb:"Read", target:"/repo/new.js", state:"running", step:"work-2" });
  assert.notEqual(w1.i, w2.i);
  const patched = log.patch(project, slug, "item_0", { state:"done", output:"ok" }, "work-2");
  assert.equal(patched.i, w2.i);
  assert.equal(log.findById(project, slug, "item_0", "work-1").target, "/repo/old.js");
  assert.equal(log.findById(project, slug, "item_0", "work-2").output, "ok");

  log.retag(project, slug, "work-1", "removed-1");
  assert.equal(log.findById(project, slug, "item_0", "work-1"), null);
  assert.equal(log.findById(project, slug, "item_0", "removed-1").i, w1.i);
});

test("Work 2 on the same Line with fresh Antigravity step_index keeps all actions between texts without overwriting Work 1, and captures read image thumbnails", async () => {
  const dir = fresh("agy-work2"), home = fresh("home"), docs = fresh("docs"), script = path.join(dir, "agy.js");
  const imgFile = path.join(docs, "shot.png");
  const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2dIAAAAASUVORK5CYII=", "base64");
  const stateFile = path.join(dir, "run-count.txt");
  fs.writeFileSync(script, `
const fs = require("fs"), path = require("path");
const home = ${JSON.stringify(home)}, img = ${JSON.stringify(imgFile)}, sf = ${JSON.stringify(stateFile)};
const say = o => console.log(JSON.stringify(o));
let buffer = "";
process.stdin.on("data", d => {
  buffer += d; const parts = buffer.split("\\n"); buffer = parts.pop();
  if (!parts.length) return;
  const n = (fs.existsSync(sf) ? Number(fs.readFileSync(sf, "utf8")) : 0) + 1;
  fs.writeFileSync(sf, String(n));
  const conv = "conv-w" + n;
  const tf = path.join(home, ".gemini", "antigravity-cli", "brain", conv, ".system_generated", "logs", "transcript.jsonl");
  const appendT = o => { fs.mkdirSync(path.dirname(tf), { recursive:true }); fs.appendFileSync(tf, JSON.stringify(o) + "\\n"); };
  say({ event:"init", conversation_id:conv, init:{ cwd:process.cwd(), tools:[] } });
  appendT({ step_index:0, source:"USER_EXPLICIT", type:"USER_INPUT", status:"DONE", created_at:"2026-11-24T04:00:00Z", content:"Task " + n });
  say({ event:"step_update", step_update:{ conversation_id:conv, step_index:0, state:"DONE", step_type:"user_input" } });
  appendT({ step_index:1, source:"MODEL", type:"PLANNER_RESPONSE", status:"DONE", created_at:"2026-11-24T04:00:01Z", thinking:"Work " + n + " Text 1: inspecting screenshot and files.", tool_calls:[{ name:"read_file", args:{ Path:JSON.stringify(img) } }, { name:"run_command", args:{ CommandLine:'"echo hi"', toolSummary:'"Check environment"' } }] });
  say({ event:"step_update", step_update:{ conversation_id:conv, step_index:1, state:"DONE", step_type:"agent_response" } });
  say({ event:"step_update", step_update:{ conversation_id:conv, step_index:2, state:"ACTIVE", step_type:"tool", tool_name:"read_file", tool_info:{ name:"read_file", parameters:{ Path:img } } } });
  say({ event:"step_update", step_update:{ conversation_id:conv, step_index:2, state:"DONE", step_type:"tool", tool_name:"read_file", tool_info:{ name:"read_file", parameters:{ Path:img }, output:"Showing binary file of type image/png" } } });
  say({ event:"step_update", step_update:{ conversation_id:conv, step_index:3, state:"ACTIVE", step_type:"tool", tool_name:"run_command", tool_info:{ name:"run_command", parameters:{ CommandLine:"echo hi" } } } });
  say({ event:"step_update", step_update:{ conversation_id:conv, step_index:3, state:"DONE", step_type:"tool", tool_name:"run_command", tool_info:{ name:"run_command", parameters:{ CommandLine:"echo hi" }, output:"hi" } } });
  appendT({ step_index:4, source:"MODEL", type:"PLANNER_RESPONSE", status:"DONE", created_at:"2026-11-24T04:00:05Z", thinking:"Work " + n + " Text 2: updating steps and verifying.", tool_calls:[{ name:"update_steps", args:{ steps:[{ title:"Inspect", status:"done" }, { title:"Verify", status:"in_progress" }] } }, { name:"run_command", args:{ CommandLine:'"echo ok"', toolSummary:'"Verify result"' } }] });
  say({ event:"step_update", step_update:{ conversation_id:conv, step_index:4, state:"DONE", step_type:"agent_response" } });
  say({ event:"step_update", step_update:{ conversation_id:conv, step_index:5, state:"DONE", step_type:"tool", tool_name:"update_steps", tool_info:{ name:"update_steps", parameters:{ steps:[{ title:"Inspect", status:"done" }, { title:"Verify", status:"in_progress" }] }, output:"OK" } } });
  say({ event:"step_update", step_update:{ conversation_id:conv, step_index:6, state:"DONE", step_type:"tool", tool_name:"run_command", tool_info:{ name:"run_command", parameters:{ CommandLine:"echo ok" }, output:"ok" } } });
  appendT({ step_index:7, source:"MODEL", type:"PLANNER_RESPONSE", status:"DONE", created_at:"2026-11-24T04:00:09Z", content:"Completed Work " + n + "." });
  say({ event:"step_update", step_update:{ conversation_id:conv, step_index:7, state:"DONE", step_type:"agent_response", text_delta:"Completed Work " + n + "." } });
  say({ event:"result", result:{ conversation_id:conv, status:"SUCCESS", response:"Completed Work " + n + "." } });
});`);
  const agents = createAgents({ env:{ PATH:"", HOME:home, AGY_CLI_PATH:script } });
  const service = new Service({ directory:fresh("state"), agents, autoWatch:false, conversations:{ home, env:{ HOME:home } } });
  const project = service.store.create({ name:"Demo", docsPath:docs, codePath:null });
  fs.writeFileSync(imgFile, tinyPng);
  project.defaultAgent = "antigravity";
  try {
    const asked = await service.request(project, { text:"First task", topic:"new" });
    await until(() => !service.runs.size && F.parseLine(service.readDoc(project, asked.slug)).status === "done", "work-1 done");
    await service.request(project, { text:"Second independent task", topic:asked.slug, taskMode:"new" });
    await until(() => !service.runs.size && F.parseLine(service.readDoc(project, asked.slug)).steps.find(s => s.id === "work-2")?.done, "work-2 done");

    const all = service.activityOf(project, asked.slug, 0).rows;
    const w1 = all.filter(r => r.step === "work-1" && r.kind !== "start");
    const w2 = all.filter(r => r.step === "work-2" && r.kind !== "start");

    const shape = list => list.map(r => [r.kind, r.thinking || false, r.kind === "say" ? r.text : `${r.verb}:${r.summary || ""}`]);
    assert.deepEqual(shape(w1), [
      ["say", true, "Work 1 Text 1: inspecting screenshot and files."],
      ["tool", false, "Read:"],
      ["tool", false, "Ran:Check environment"],
      ["say", true, "Work 1 Text 2: updating steps and verifying."],
      ["tool", false, "Updated its plan:"],
      ["tool", false, "Ran:Verify result"],
      ["say", false, "Completed Work 1."],
    ]);
    assert.deepEqual(shape(w2), [
      ["say", true, "Work 2 Text 1: inspecting screenshot and files."],
      ["tool", false, "Read:"],
      ["tool", false, "Ran:Check environment"],
      ["say", true, "Work 2 Text 2: updating steps and verifying."],
      ["tool", false, "Updated its plan:"],
      ["tool", false, "Ran:Verify result"],
      ["say", false, "Completed Work 2."],
    ]);
    assert.equal(w2[1].pictures?.length, 1, "local PNG read in Work 2 captures an activity thumbnail");
    assert.equal(w2[4].todos?.length, 2, "Antigravity update_steps parses plan checklist");

    // Verify rendered timeline alternates Text1 -> group 1 -> Text2 -> group 2 cleanly
    const { document, c } = renderHarness();
    const l = { id:"p1", slug:asked.slug, workdir:docs };
    const s2 = { id:"work-2", state:"done", agent:"antigravity" };
    const act = { running:false, started:0, now:"", seq:all.length, rows:new Map(all.map(r => [r.i, r])) };
    document.getElementById("lppRows").innerHTML = `<div class="act-rows">${c.rowsHTML({ id:"p1" }, l, act, s2)}</div>`;
    const children = [...document.querySelector(".act-rows").children].map(el => el.className.split(" ")[0]);
    assert.deepEqual(children, ["at-start", "at-say", "at-group", "at-say", "at-group"]);
    assert.equal(document.querySelectorAll(".act-rows > .at-group")[0].querySelectorAll(".at-group-thumb").length, 1);
    // Verify resumed Work 3 continuing conv-w2 captures new thinking + toolSummary without replaying Work 2's transcript bytes.
    const w2Tf = path.join(home, ".gemini", "antigravity-cli", "brain", "conv-w2", ".system_generated", "logs", "transcript.jsonl");
    assert.ok(fs.existsSync(w2Tf), "Work 2 transcript exists before resumed Work 3 spawns");
    fs.writeFileSync(script, `
const fs = require("fs");
const tf = ${JSON.stringify(w2Tf)};
const say = o => console.log(JSON.stringify(o));
const appendT = o => fs.appendFileSync(tf, JSON.stringify(o) + "\\n");
let buffer = "";
process.stdin.on("data", d => {
  buffer += d; const parts = buffer.split("\\n"); buffer = parts.pop();
  if (!parts.length) return;
  say({ event:"init", conversation_id:"conv-w2", init:{ cwd:process.cwd(), tools:[] } });
  appendT({ step_index:8, source:"USER_EXPLICIT", type:"USER_INPUT", status:"DONE", created_at:"2026-11-24T04:01:00Z", content:"Follow up" });
  say({ event:"step_update", step_update:{ conversation_id:"conv-w2", step_index:8, state:"DONE", step_type:"user_input" } });
  appendT({ step_index:9, source:"MODEL", type:"PLANNER_RESPONSE", status:"DONE", created_at:"2026-11-24T04:01:02Z", thinking:"Work 3 resumed thought.", tool_calls:[{ name:"run_command", args:{ CommandLine:'"echo w3"', toolSummary:'"Run follow-up check"' } }] });
  say({ event:"step_update", step_update:{ conversation_id:"conv-w2", step_index:9, state:"DONE", step_type:"agent_response" } });
  say({ event:"step_update", step_update:{ conversation_id:"conv-w2", step_index:10, state:"DONE", step_type:"tool", tool_name:"run_command", tool_info:{ name:"run_command", parameters:{ CommandLine:"echo w3" }, output:"w3" } } });
  appendT({ step_index:11, source:"MODEL", type:"PLANNER_RESPONSE", status:"DONE", created_at:"2026-11-24T04:01:05Z", content:"Completed Work 3." });
  say({ event:"step_update", step_update:{ conversation_id:"conv-w2", step_index:11, state:"DONE", step_type:"agent_response", text_delta:"Completed Work 3." } });
  say({ event:"result", result:{ conversation_id:"conv-w2", status:"SUCCESS", response:"Completed Work 3." } });
});`);
    await service.request(project, { text:"Follow up on Work 2", topic:asked.slug, taskMode:"continue" });
    await until(() => !service.runs.size && F.parseLine(service.readDoc(project, asked.slug)).steps.find(s => s.id === "work-3")?.done, "work-3 done");
    const w3 = service.activityOf(project, asked.slug, 0).rows.filter(r => r.step === "work-3" && r.kind !== "start");
    assert.deepEqual(shape(w3), [
      ["say", true, "Work 3 resumed thought."],
      ["tool", false, "Ran:Run follow-up check"],
      ["say", false, "Completed Work 3."],
    ]);
  } finally {
    service.close();
  }
});

test("pullAntigravityThinking skips historical thinking behind agyFloorStep / agyMaxEmittedStep so reattach never dumps a wall of text", () => {
  const home = fresh("home-reattach"), conv = "conv-reattach-1";
  const tf = path.join(home, ".gemini", "antigravity-cli", "brain", conv, ".system_generated", "logs", "transcript.jsonl");
  fs.mkdirSync(path.dirname(tf), { recursive:true });
  fs.writeFileSync(tf, [
    JSON.stringify({ step_index:1, type:"PLANNER_RESPONSE", status:"DONE", created_at:"2026-11-24T04:00:01Z", thinking:"Old thought 1", tool_calls:[{ name:"read_file", args:{ Path:"/a" } }] }),
    JSON.stringify({ step_index:5, type:"PLANNER_RESPONSE", status:"DONE", created_at:"2026-11-24T04:00:05Z", thinking:"Old thought 5", tool_calls:[{ name:"read_file", args:{ Path:"/b" } }] }),
    JSON.stringify({ step_index:11, type:"PLANNER_RESPONSE", status:"DONE", created_at:"2026-11-24T04:00:11Z", thinking:"Fresh thought 11", tool_calls:[{ name:"run_command", args:{ CommandLine:'"npm test"', toolSummary:'"Run tests"' } }] }),
  ].join("\n") + "\n");
  const agents = createAgents({ env:{ PATH:"", HOME:home } });
  const service = new Service({ directory:fresh("state"), agents, autoWatch:false, conversations:{ home, env:{ HOME:home } } });
  const project = service.store.create({ name:"Demo", docsPath:fresh("docs"), codePath:null });
  try {
    const run = { dialect:"antigravity", sessionId:conv, stepId:"work-1", launchId:"L1", agyFloorStep:10, agyMaxEmittedStep:10, started:Date.parse("2026-11-24T04:00:00Z") };
    service.pullAntigravityThinking(project, "demo-reattach", run, 11);
    const rows = service.activityOf(project, "demo-reattach", 0).rows;
    assert.deepEqual(rows.map(r => r.text), ["Fresh thought 11"]);
    assert.equal(run.agyToolSummaries.get("agy-12"), "Run tests");
  } finally {
    service.close();
  }
});

test("agyTool maps Antigravity update_steps into a plan checklist", () => {
  const row = agyTool("update_steps", { steps:[{ title:"Locate bug", status:"done" }, { title:"Patch server", status:"in_progress" }, { title:"Run tests", status:"pending" }] });
  assert.deepEqual(row, {
    verb:"Updated its plan",
    target:"",
    todos:[
      { text:"Locate bug", status:"completed" },
      { text:"Patch server", status:"in_progress" },
      { text:"Run tests", status:"pending" },
    ],
  });
});
