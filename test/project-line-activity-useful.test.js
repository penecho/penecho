"use strict";
require("./helpers/safety.js");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { test, after } = require("node:test");
const { parseHTML } = require("./helpers/dom.js");
const { parseLine, parseAppServer, parseDialect, agyTool, nowFrom } = require("../src/server/project-lines/activity.js");
const { Service } = require("../src/server/project-lines/service.js");
const { createAgents } = require("../src/server/project-lines/agents.js");
const F = require("../src/server/project-lines/format.js");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-act-useful-"));
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
  assert.ok(a >= 0 && b > a, `Slice not found: ${start} .. ${end}`);
  return src.slice(a, b);
};

function renderHarness() {
  const { document } = parseHTML("<html><body><div id='lppScroll'><div id='lppLive'></div><div id='lppRows'></div><span id='lppCount'></span></div></body></html>");
  const c = vm.createContext({
    document, console, esc, ic, S:{ lineSel:{ id:"work-1" }, detailsShown:{} }, ACT:{},
    CSS:{ escape:x => String(x) },
    av:id => `<span class="av">${esc(id)}</span>`,
    agentInfo:id => ({ name:id === "antigravity" ? "Antigravity" : String(id) }),
    shortWhen:() => "03:33",
    sayHTML:t => `<p>${esc(t)}</p>`,
    shortPath:t => t,
    reducedMotion:() => true,
    setTimeout:() => 0,
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
  vm.runInContext(slice(lineSrc, "function toolRow(row, l) {", "async function pollActivity()"), c);
  return { document, c };
}

test("activity.js captures tool summaries, plan checklists, multi-file edits, read ranges, and cleans nowFrom", () => {
  // Claude Code Bash description + TodoWrite checklist
  const [bash] = parseLine(JSON.stringify({
    type:"assistant",
    message:{ content:[{ type:"tool_use", id:"t1", name:"Bash", input:{ command:"cd /repo && npm test", description:"Run navigation tests" } }] },
  }));
  assert.equal(bash.add.summary, "Run navigation tests");
  assert.equal(nowFrom(bash.add), "Run navigation tests");

  const [todo] = parseLine(JSON.stringify({
    type:"assistant",
    message:{ content:[{ type:"tool_use", id:"t2", name:"TodoWrite", input:{ todos:[{ content:"Locate animation", status:"completed" }, { content:"Gate transitions", status:"in_progress" }] } }] },
  }));
  assert.deepEqual(todo.add.todos, [
    { text:"Locate animation", status:"completed" },
    { text:"Gate transitions", status:"in_progress" },
  ]);

  // Codex multi-file fileChange + plan items
  const [cxFiles] = parseAppServer({
    method:"item/completed",
    params:{ item:{ type:"fileChange", id:"fc1", status:"completed", changes:[{ path:"public/lines/main.js" }, { path:"public/lines/line.js" }] } },
  });
  assert.deepEqual(cxFiles.upsert.files, ["public/lines/main.js", "public/lines/line.js"]);
  const [cxPlan] = parseAppServer({
    method:"item/completed",
    params:{ item:{ type:"plan", id:"pl1", items:[{ step:"Verify in browser", completed:false }] } },
  });
  assert.deepEqual(cxPlan.upsert.todos, [{ text:"Verify in browser", status:"pending" }]);

  // Antigravity toolSummary + StartLine/EndLine (only when provided)
  assert.deepEqual(agyTool("run_command", { CommandLine:"cd /repo && git diff", toolSummary:'"Inspect working tree diff"' }), {
    verb:"Ran", target:"cd /repo && git diff", code:true, summary:"Inspect working tree diff",
  });
  assert.deepEqual(agyTool("read_file", { Path:"/repo/main.js", StartLine:65, EndLine:108 }), {
    verb:"Read", target:"/repo/main.js", range:"65-108",
  });

  // nowFrom strips noisy cd prefixes even without summary, and recognizes Windows PowerShell helpers
  assert.equal(nowFrom({ kind:"tool", verb:"Ran", code:true, target:"cd /Users/heack/workspace/penecho_071_version && git diff --stat && git diff public/lines/line.js" }), "Checking git diff");
  assert.equal(nowFrom({ kind:"tool", verb:"Ran", code:true, target:"cd /Users/heack/workspace/penecho_071_version && node --test test/a.test.js" }), "Running tests");
  assert.equal(nowFrom({ kind:"tool", verb:"Ran", code:true, target:"cd /Users/heack/workspace/penecho_071_version && rg -n zoomIn public/lines/" }), "Searching code");
  assert.equal(nowFrom({ kind:"tool", verb:"Ran", code:true, target:`'{"dir":"C:/app"}' | node "$env:PENECHO_BROWSER_HELPER"` }), "Checking page in browser");
  assert.equal(nowFrom({ kind:"tool", verb:"Ran", code:true, target:`node -e 'require(process.env.PENECHO_BROWSER_HELPER)'` }), "Checking page in browser");
  assert.equal(nowFrom({ kind:"tool", verb:"Ran", code:true, target:`'{"do":"plan"}' | node "$env:PENECHO_ORCH_HELPER"` }), "Updating Orchestrator");

  // Windows Codex PowerShell commands render cleanly in the briefing with no powershell.exe wrapper or false Issues
  const ps = String.raw`"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command `;
  const winInspect = parseLine(JSON.stringify({ type:"item.completed", item:{ id:"w1", type:"command_execution", command:`${ps}'Get-Content -LiteralPath style.css -Raw; git branch --show-current; rg --files -g AGENTS.md'`, exit_code:1, aggregated_output:"dark-mode\n" } }))[0].upsert;
  const winBrowser = parseLine(JSON.stringify({ type:"item.completed", item:{ id:"w2", type:"command_execution", command:`${ps}'\'{"dir":"C:/app"}\' | node "$env:PENECHO_BROWSER_HELPER"'`, exit_code:0, aggregated_output:'{"ok":true,"consoleErrors":[],"pageErrors":[]}' } }))[0].upsert;
  assert.equal(winInspect.state, "done");
  assert.doesNotMatch(winInspect.target, /powershell\.exe/i);
  const winHarness = renderHarness();
  const winRows = [
    { i:0, step:"work-4", kind:"tool", ...winInspect },
    { i:1, step:"work-4", kind:"tool", ...winBrowser },
  ];
  const winAct = { running:false, seq:2, rows:new Map(winRows.map(r => [r.i, r])) };
  winHarness.c.ACTIVITY = { "p1:dark-mode":winAct };
  winHarness.c.activityOf = () => winAct;
  winHarness.c.S.lineSel = { id:"work-4" };
  winHarness.c.paintRows({ id:"p1" }, { id:"l2", slug:"dark-mode", workdir:"C:\\app" }, { id:"work-4", state:"done", agent:"codex" });
  const winBriefText = winHarness.document.querySelector("#lppRows .at-brief")?.textContent || "";
  assert.match(winBriefText, /Browser check/);
  assert.match(winBriefText, /0 errors/);
  assert.doesNotMatch(winBriefText, /Issues|powershell\.exe/i);
});

test("paintRows renders a structured Work progress briefing (Plan, Changed, Checks, Issues, Read), human-readable rows, and clean live footer", () => {
  const { document, c } = renderHarness();
  const l = { id:"l1", slug:"demo", workdir:"/Users/heack/workspace/penecho_071_version" };
  const s = { id:"work-1", state:"active", agent:"antigravity" };
  const rows = [
    { i:0, step:"work-1", kind:"start", agent:"antigravity", at:1000 },
    { i:1, step:"work-1", kind:"tool", verb:"Updated its plan", target:"", todos:[{ text:"Locate animation code", status:"completed" }, { text:"Update navigation rules", status:"in_progress" }, { text:"Verify in Chromium", status:"pending" }], state:"done" },
    { i:2, step:"work-1", kind:"tool", verb:"Ran", code:true, target:'node "$PENECHO_ORCH_HELPER" \'{"do":"decide","route":"self","kind":"code"}\'', state:"done", output:'{"route":"self"}' },
    { i:3, step:"work-1", kind:"tool", verb:"Read", target:"/Users/heack/workspace/penecho_071_version/public/lines/main.js", range:"65-110", state:"done" },
    { i:4, step:"work-1", kind:"tool", verb:"Read", target:"/Users/heack/workspace/penecho_071_version/public/lines/navigation.js", state:"done" },
    { i:5, step:"work-1", kind:"tool", verb:"Read", target:"/Users/heack/workspace/penecho_071_version/public/lines/panorama.js", state:"done" },
    { i:6, step:"work-1", kind:"tool", verb:"Ran", code:true, target:'cd /Users/heack/workspace/penecho_071_version && rg -n "zoomIn|flightToLine" public/lines/', state:"done", output:"main.js:87" },
    { i:7, step:"work-1", kind:"tool", verb:"Ran", code:true, target:"cd /Users/heack/workspace/penecho_071_version && node --test test/project-line-navigation.test.js test/project-line-doc-back.test.js", state:"failed", output:"ℹ tests 19\nℹ pass 5\nℹ fail 14\nCommand exited with code 1." },
    { i:8, step:"work-1", kind:"tool", verb:"Edited", target:"/Users/heack/workspace/penecho_071_version/public/lines/main.js", state:"done" },
    { i:9, step:"work-1", kind:"tool", verb:"Edited", target:"/Users/heack/workspace/penecho_071_version/public/lines/main.js", state:"done" },
    { i:10, step:"work-1", kind:"tool", verb:"Wrote", target:"/Users/heack/workspace/penecho_071_version/test/project-line-transition-animation.test.js", state:"done" },
    { i:11, step:"work-1", kind:"tool", verb:"Ran", code:true, target:"cd /Users/heack/workspace/penecho_071_version && npm run build:lines && npm run check:lines && node --test test/project-line-transition-animation.test.js", state:"done", output:"ℹ pass 19\nℹ fail 0\n" },
    { i:12, step:"work-1", kind:"tool", verb:"Ran", code:true, target:"cd /Users/heack/workspace/penecho_071_version && git diff --stat && git diff public/lines/line.js", state:"running" },
  ];
  const a = { running:true, started:Date.now() - 444000, now:"Running cd /Users/heack/workspace/penecho_071_version && git diff --stat", seq:12, rows:new Map(rows.map(r => [r.i, r])) };
  c.ACTIVITY = { "p1:demo":a };
  c.activityOf = () => a;
  c.paintRows({ id:"p1" }, l, s);

  const brief = document.querySelector("#lppRows .at-brief");
  assert.ok(brief, "briefing card renders at top of #lppRows");

  // Plan section
  assert.match(brief.querySelector(".at-brief-plan").textContent, /1\/3/);
  assert.equal(brief.querySelectorAll(".at-brief-plan .at-todos li").length, 3);

  // Changed files: deduplicated (main.js x2 + created test file), NOT duplicated in Read
  const changedChips = [...brief.querySelectorAll(".at-brief-row:nth-child(2) .at-chip")].map(el => el.textContent);
  assert.deepEqual(changedChips, ["main.js×2", "+project-line-transition-animation.test.js"]);

  // Checks: newest first with parsed test counts
  const checks = [...brief.querySelectorAll(".at-check")].map(el => ({
    label:el.querySelector(".at-check-label").textContent,
    badge:el.querySelector(".at-badge")?.textContent || "",
    failed:el.classList.contains("s-failed"),
  }));
  assert.equal(checks.length, 2);
  assert.equal(checks[0].badge, "19 passed");
  assert.equal(checks[0].failed, false);
  assert.equal(checks[1].badge, "14 failed, 5 passed");
  assert.equal(checks[1].failed, true);

  // Read excludes already-changed main.js
  const readChips = [...brief.querySelectorAll(".at-brief-row:last-child .at-chip")].map(el => el.textContent);
  assert.deepEqual(readChips, ["panorama.js", "navigation.js"]);

  // Underlying toolRow strips `cd /Users/... && `, preserves quoted regex pipes, and keeps raw command inside <pre>
  const searchRow = document.querySelector('#lppRows .act-rows [data-row="6"]');
  assert.doesNotMatch(searchRow.querySelector("summary").textContent, /cd \/Users\/heack/);
  assert.match(searchRow.querySelector("summary").textContent, /Searched/);
  assert.match(searchRow.querySelector("summary").textContent, /zoomIn\|flightToLine in public\/lines\//);
  assert.match(searchRow.querySelector("pre").textContent, /\$ cd \/Users\/heack\/workspace\/penecho_071_version && rg/);

  // Clicking a file chip jumps to the underlying step and opens its enclosing group
  const mainChip = brief.querySelector('.at-chip[data-act="act-jump"]');
  assert.ok(mainChip, "changed file chip has act-jump");
  const grpBefore = document.querySelector("#lppRows details.at-group");
  assert.ok(!grpBefore.open);
  c.ACT["act-jump"](mainChip);
  assert.equal(grpBefore.open, true, "act-jump opens the enclosing step group");

  // Live footer never repeats raw `cd /Users/...`
  const liveNow = document.querySelector("#lppRows .at-live .at-now").textContent;
  assert.doesNotMatch(liveNow, /cd \/Users\/heack/);
  assert.match(liveNow, /Git · diff --stat · diff public\/lines\/line\.js/);

  // When no tool is running, live footer says Thinking… instead of a stale command
  rows[12].state = "done";
  a.seq = 13;
  c.paintRows({ id:"p1" }, l, s);
  assert.equal(document.querySelector("#lppRows .at-live .at-now").textContent, "Thinking…");
});

test("Service enriches live Antigravity run_command rows with toolSummary from transcript.jsonl", async () => {
  const dir = fresh("agy-live-sum"), home = fresh("home"), script = path.join(dir, "agy.js");
  const transcriptFile = path.join(home, ".gemini", "antigravity-cli", "brain", "conv-sum-1", ".system_generated", "logs", "transcript.jsonl");
  fs.writeFileSync(script, `
const fs = require("fs"), path = require("path");
const tf = ${JSON.stringify(transcriptFile)};
const say = o => console.log(JSON.stringify(o));
const appendT = o => { fs.mkdirSync(path.dirname(tf), { recursive:true }); fs.appendFileSync(tf, JSON.stringify(o) + "\\n"); };
let buffer = "";
process.stdin.on("data", d => {
  buffer += d; const parts = buffer.split("\\n"); buffer = parts.pop();
  if (!parts.length) return;
  say({ event:"init", conversation_id:"conv-sum-1", init:{ cwd:process.cwd(), tools:[] } });
  appendT({ step_index:0, source:"USER_EXPLICIT", type:"USER_INPUT", status:"DONE", created_at:"2026-11-24T04:00:00Z", content:"Check tests" });
  say({ event:"step_update", step_update:{ conversation_id:"conv-sum-1", step_index:0, state:"DONE", step_type:"user_input" } });
  appendT({ step_index:1, source:"MODEL", type:"PLANNER_RESPONSE", status:"DONE", created_at:"2026-11-24T04:00:02Z", thinking:"Running tests to verify.", tool_calls:[{ name:"run_command", args:{ CommandLine:'"cd /repo && npm test"', toolSummary:'"Run full animation test suite"' } }] });
  say({ event:"step_update", step_update:{ conversation_id:"conv-sum-1", step_index:1, state:"DONE", step_type:"agent_response" } });
  say({ event:"step_update", step_update:{ conversation_id:"conv-sum-1", step_index:2, state:"ACTIVE", step_type:"tool", tool_name:"run_command", tool_info:{ name:"run_command", parameters:{ CommandLine:"cd /repo && npm test" } } } });
  say({ event:"step_update", step_update:{ conversation_id:"conv-sum-1", step_index:2, state:"DONE", step_type:"tool", tool_name:"run_command", tool_info:{ name:"run_command", parameters:{ CommandLine:"cd /repo && npm test" }, output:"ℹ pass 4\\nℹ fail 0\\n" } } });
  say({ event:"step_update", step_update:{ conversation_id:"conv-sum-1", step_index:3, state:"DONE", step_type:"agent_response", text_delta:"All 4 tests passed." } });
  say({ event:"result", result:{ conversation_id:"conv-sum-1", status:"SUCCESS", response:"All 4 tests passed." } });
});`);
  const agents = createAgents({ env:{ PATH:"", HOME:home, AGY_CLI_PATH:script } });
  const service = new Service({ directory:fresh("state"), agents, autoWatch:false, conversations:{ home, env:{ HOME:home } } });
  const project = service.store.create({ name:"Demo", docsPath:fresh("docs"), codePath:null });
  project.defaultAgent = "antigravity";
  try {
    const asked = await service.request(project, { text:"Check tests", topic:"new" });
    await until(() => !service.runs.size && F.parseLine(service.readDoc(project, asked.slug)).status === "done", "agy summary run");
    const tool = service.activityOf(project, asked.slug, 0).rows.find(r => r.step === "work-1" && r.kind === "tool");
    assert.ok(tool);
    assert.equal(tool.summary, "Run full animation test suite");
  } finally {
    service.close();
  }
});
