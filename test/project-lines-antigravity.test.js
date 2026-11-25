"use strict";
require("./helpers/safety.js");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const F = require("../src/server/project-lines/format.js");
const { Service } = require("../src/server/project-lines/service.js");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { parseDialect, userLine, isResult, isAntigravityOAuthError } = require("../src/server/project-lines/activity.js");
const { modelOf } = require("../src/server/project-lines/agent-model.js");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-agy-test-"));
after(() => fs.rmSync(temp, { recursive:true, force:true }));
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(check, label, ms = 8000) {
  const start = Date.now();
  for (;;) { const value = await check(); if (value) return value; if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}`); await wait(25); }
}
let counter = 0;
const fresh = name => { const dir = path.join(temp, `${name}-${++counter}`); fs.mkdirSync(dir, { recursive:true }); return fs.realpathSync(dir); };
const step = fields => ({ event:"step_update", step_update:{ conversation_id:"c3b6", ...fields } });

test("what `agy --output-format stream-json` prints becomes rows: words gathered per step, tools, and the conversation", () => {
  // Shaped as Antigravity's headless page shows them.
  const state = {};
  const rows = [
    { event:"init", conversation_id:"c3b6", init:{ cwd:"/w", tools:["run_command"], permission_mode:"always-proceed" } },
    step({ step_index:0, state:"DONE", step_type:"user_input" }),
    step({ step_index:1, state:"ACTIVE", step_type:"tool", tool_name:"run_command", tool_info:{ name:"run_command", parameters:{ CommandLine:"npm test" } } }),
    step({ step_index:1, state:"DONE", step_type:"tool", tool_name:"run_command", tool_info:{ name:"run_command", parameters:{ CommandLine:"npm test" }, output:"3 passing\r\n" } }),
    step({ step_index:2, state:"DONE", step_type:"tool", tool_name:"view_file", tool_info:{ name:"view_file", parameters:{ AbsolutePath:"\"/w/README.md\"" }, error:{ type:"NOT_FOUND", message:"no such file" } } }),
    step({ step_index:3, state:"ACTIVE", step_type:"agent_response", text_delta:"All " }),
    step({ step_index:3, state:"ACTIVE", step_type:"agent_response", text_delta:"done." }),
    step({ step_index:3, state:"DONE", step_type:"agent_response", text_delta:"\n" }),
    step({ step_index:4, state:"DONE", step_type:"checkpoint" }),
    { event:"result", result:{ conversation_id:"c3b6", status:"SUCCESS", response:"All done.\n", num_turns:1 } },
  ].flatMap(o => parseDialect("antigravity", JSON.stringify(o), state));
  assert.deepEqual(rows, [
    { session:"c3b6" },
    { upsert:{ id:"agy-1", state:"running", verb:"Ran", target:"npm test", code:true } },
    { upsert:{ id:"agy-1", state:"done", output:"3 passing\r\n", verb:"Ran", target:"npm test", code:true } },
    { upsert:{ id:"agy-2", state:"failed", output:"no such file", verb:"Read", target:"/w/README.md" } },
    { add:{ kind:"say", text:"All done." } }, { said:"All done." },
    { session:"c3b6" }, { turnEnd:true },
  ]);
});

test("a failed agy run says so in its result, and its answer comes from the result when no words came as a step", () => {
  const failed = parseDialect("antigravity", JSON.stringify({ event:"result", result:{ conversation_id:"", status:"ERROR", error:"invalid model selection" } }), {});
  assert.deepEqual(failed, [{ turnEnd:true, failed:"invalid model selection" }]);
  const answered = parseDialect("antigravity", JSON.stringify({ event:"result", result:{ conversation_id:"c1", status:"SUCCESS", response:"OK" } }), {});
  assert.deepEqual(answered, [{ session:"c1" }, { add:{ kind:"say", text:"OK" } }, { said:"OK" }, { turnEnd:true }]);
  assert.deepEqual(JSON.parse(userLine("Hi", "antigravity")), { event:"user", message:{ content:"Hi" } });
  assert.equal(JSON.parse(userLine("Hi")).type, "user", "Claude Code's shape stays the default");
  assert.equal(isResult('{"event":"result","result":{}}'), true);
  assert.equal(isResult('{"type":"result"}'), true);
});

test("parseAntigravity treats a stale result ERROR as recovered only when a non-empty answer finishes after the last error_message and tool", () => {
  const runEvents = events => {
    const state = {};
    return events.flatMap(o => parseDialect("antigravity", JSON.stringify(o), state));
  };

  // Recovered: mid-turn error_message (step 23) -> later tool (step 28) -> final agent_response (step 29) -> stale result ERROR.
  const recovered = runEvents([
    { event:"init", conversation_id:"c-rec" },
    step({ step_index:22, state:"DONE", step_type:"agent_response" }),
    step({ step_index:23, state:"DONE", step_type:"error_message" }),
    step({ step_index:24, state:"DONE", step_type:"agent_response" }),
    step({ step_index:28, state:"DONE", step_type:"tool", tool_name:"read_file", tool_info:{ name:"read_file", parameters:{ Path:"/w/a.js" }, output:"ok" } }),
    step({ step_index:29, state:"ACTIVE", step_type:"agent_response", text_delta:"Recovered " }),
    step({ step_index:29, state:"DONE", step_type:"agent_response", text_delta:"final answer." }),
    { event:"result", result:{ conversation_id:"c-rec", status:"ERROR", response:"Recovered final answer.", error:"The stream was interrupted. Please continue the task you were working on." } },
  ]);
  assert.ok(recovered.some(c => c.add?.kind === "note" && /Recovered after: The stream was interrupted/.test(c.add.text)));
  assert.deepEqual(recovered[recovered.length - 1], { turnEnd:true, recovered:true });
  assert.equal(recovered.some(c => "failed" in c), false);

  // Terminal error after earlier answer + tool must still fail.
  const terminal = runEvents([
    { event:"init", conversation_id:"c-term" },
    step({ step_index:1, state:"DONE", step_type:"agent_response", text_delta:"Working on it." }),
    step({ step_index:2, state:"DONE", step_type:"tool", tool_name:"run_command", tool_info:{ name:"run_command", parameters:{ CommandLine:"npm test" }, output:"ok" } }),
    step({ step_index:3, state:"DONE", step_type:"error_message" }),
    { event:"result", result:{ conversation_id:"c-term", status:"ERROR", response:"Working on it.", error:"The stream was interrupted." } },
  ]);
  assert.deepEqual(terminal[terminal.length - 1], { turnEnd:true, failed:"The stream was interrupted." });

  // Answer before a later tool step (with no answer after the tool) must still fail.
  const toolAfterAnswer = runEvents([
    { event:"init", conversation_id:"c-tool" },
    step({ step_index:1, state:"DONE", step_type:"error_message" }),
    step({ step_index:2, state:"DONE", step_type:"agent_response", text_delta:"Running tests now." }),
    step({ step_index:3, state:"ACTIVE", step_type:"tool", tool_name:"run_command", tool_info:{ name:"run_command", parameters:{ CommandLine:"npm test" } } }),
    { event:"result", result:{ conversation_id:"c-tool", status:"ERROR", error:"The stream was interrupted." } },
  ]);
  assert.deepEqual(toolAfterAnswer[toolAfterAnswer.length - 1], { turnEnd:true, failed:"The stream was interrupted." });

  // Empty/thinking-only agent_response after error_message must not count as recovery.
  const emptyAnswer = runEvents([
    { event:"init", conversation_id:"c-empty" },
    step({ step_index:1, state:"DONE", step_type:"error_message" }),
    step({ step_index:2, state:"DONE", step_type:"agent_response" }),
    { event:"result", result:{ conversation_id:"c-empty", status:"ERROR", error:"The stream was interrupted." } },
  ]);
  assert.deepEqual(emptyAnswer[emptyAnswer.length - 1], { turnEnd:true, failed:"The stream was interrupted." });

  // Rate/usage limit errors are never treated as recovered.
  const limitError = runEvents([
    { event:"init", conversation_id:"c-limit" },
    step({ step_index:1, state:"DONE", step_type:"error_message" }),
    step({ step_index:2, state:"DONE", step_type:"agent_response", text_delta:"Partial reply." }),
    { event:"result", result:{ conversation_id:"c-limit", status:"ERROR", error:"Rate limit reached" } },
  ]);
  assert.deepEqual(limitError[limitError.length - 1], { turnEnd:true, failed:"Rate limit reached" });
});

test("Antigravity counts with its app or agy; the app is where you paste, and agy's conversations open in Terminal", { skip:process.platform !== "darwin" }, t => {
  const root = fresh("agents"), apps = path.join(root, "Applications"), cli = path.join(root, ".local", "bin", "agy");
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  fs.mkdirSync(apps);
  const list = () => { const agents = createAgents({ env:{ PATH:"", HOME:root }, appFolders:[apps] }); return { agents, agy:agents.available().find(a => a.id === "antigravity") }; };
  assert.equal(list().agy.available, false);
  const plist = path.join(apps, "Antigravity.app", "Contents", "Info.plist");
  fs.mkdirSync(path.dirname(plist), { recursive:true });
  fs.writeFileSync(plist, `<?xml version="1.0"?><plist><dict><key>CFBundleIdentifier</key><string>com.google.antigravity</string><key>CFBundleShortVersionString</key><string>2.28.0</string></dict></plist>`);
  let { agents, agy } = list();
  assert.deepEqual([agy.available, agy.runs, agy.opens, agy.opensIn], [true, false, true, "app"]);
  assert.equal(agents.command("antigravity", { workdir:root, docs:root, gitDir:"" }), null, "only the app: nothing runs in the background");
  assert.deepEqual(agents.openApp("antigravity"), { command:"open", args:["-a", path.join(apps, "Antigravity.app")], app:"Antigravity", picks:true });
  assert.equal(agents.openApp("antigravity", "c3b6"), null, "agy's conversations are not in the app");
  fs.mkdirSync(path.dirname(cli), { recursive:true }); fs.writeFileSync(cli, "#!/bin/sh\n", { mode:0o755 });
  ({ agents, agy } = list());
  assert.deepEqual([agy.runs, agy.opensIn], [true, "app"]);
  assert.equal(agents.terminalLine("antigravity", "c3b6"), `${cli} --conversation c3b6`);
  assert.equal(agents.terminal("antigravity", "c3b6"), "agy --conversation c3b6");
  const run = agents.command("antigravity", { workdir:root, docs:"/docs", gitDir:"/repo/.git", resume:"c3b6" });
  assert.deepEqual(run.args, ["--input-format", "stream-json", "--output-format", "stream-json", "--dangerously-skip-permissions", "--conversation", "c3b6", "--add-dir", "/docs", "--add-dir", "/repo/.git"]);
  assert.deepEqual([run.input, run.dialect, run.cwd], ["stream-json", "antigravity", root]);
  agents.pickModel("antigravity", "gemini-3.8-flash", "high");
  assert.deepEqual(agents.command("antigravity", { workdir:root, docs:"/docs", gitDir:"" }).args.slice(5), ["--model", "gemini-3.8-flash", "--effort", "high", "--add-dir", "/docs"]);
  // If a tier-suffixed model is paired with an explicit effort, command() strips the suffix so `agy` does not fail with a conflict.
  agents.pickModel("antigravity", "gemini-3.8-flash-medium", "high");
  assert.deepEqual(agents.command("antigravity", { workdir:root, docs:"/docs", gitDir:"" }).args.slice(5), ["--model", "gemini-3.8-flash", "--effort", "high", "--add-dir", "/docs"]);
});

test("the model agy shows is the label /model saved, never offered as a name to run with", () => {
  const home = fresh("home"), file = path.join(home, ".gemini", "antigravity-cli", "settings.json");
  assert.equal(modelOf("antigravity", { HOME:home }).name, "");
  fs.mkdirSync(path.dirname(file), { recursive:true }); fs.writeFileSync(file, JSON.stringify({ model:"Gemini 3.8 Flash (High)" }));
  const about = modelOf("antigravity", { HOME:home });
  assert.deepEqual([about.name, about.from, about.choices], ["Gemini 3.8 Flash (High)", "~/.gemini/antigravity-cli/settings.json", []]);
});

test("a run in agy takes its words as JSON lines, ends its input at the result, and carries on in the same conversation", async () => {
  const dir = fresh("agy-run"), script = path.join(dir, "agy.js"), log = path.join(dir, "runs.jsonl");
  // Like agy, it keeps reading words until its input closes.
  fs.writeFileSync(script, `
const fs = require("fs"), args = process.argv.slice(2), lines = [];
const say = o => console.log(JSON.stringify(o)), id = args.includes("--conversation") ? args[args.indexOf("--conversation") + 1] : "conv-1";
let buffer = "";
process.stdin.on("data", d => {
  buffer += d; const parts = buffer.split("\\n"); buffer = parts.pop();
  for (const part of parts) {
    const o = JSON.parse(part); lines.push(o);
    say({ event:"init", conversation_id:id, init:{ cwd:process.cwd(), tools:[], permission_mode:"always-proceed" } });
    say({ event:"step_update", step_update:{ conversation_id:id, step_index:1, state:"DONE", step_type:"tool", tool_name:"run_command", tool_info:{ name:"run_command", parameters:{ CommandLine:"npm test" }, output:"3 passing" } } });
    say({ event:"step_update", step_update:{ conversation_id:id, step_index:2, state:"ACTIVE", step_type:"agent_response", text_delta:"Finished " } });
    say({ event:"step_update", step_update:{ conversation_id:id, step_index:2, state:"DONE", step_type:"agent_response", text_delta:"in Antigravity." } });
    say({ event:"result", result:{ conversation_id:id, status:"SUCCESS", response:"Finished in Antigravity." } });
  }
}).on("end", () => { fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, lines }) + "\\n"); });`);
  const agents = createAgents({ env:{ PATH:"", AGY_CLI_PATH:script } });
  assert.deepEqual(agents.available().filter(a => a.available).map(a => a.id), ["antigravity"]);
  const service = new Service({ directory:fresh("state"), agents, autoWatch:false, conversations:{ home:fresh("home"), env:{} } });
  const project = service.store.create({ name:"Demo", docsPath:fresh("docs"), codePath:null });
  project.defaultAgent = "antigravity";
  const runs = () => fs.readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line));
  const asked = await service.request(project, { text:"Tidy the notes", topic:"new" });
  await until(() => !service.runs.size && F.parseLine(service.readDoc(project, asked.slug)).status === "done" && fs.existsSync(log), "the run");
  const first = runs()[0];
  assert.equal(first.lines.length, 1);
  assert.equal(first.lines[0].event, "user");
  assert.match(first.lines[0].message.content, /Tidy the notes/);
  assert.ok(first.args.includes(project.docsPath), "agy may work in the docs folder");
  assert.ok(!first.args.includes("--conversation"));
  assert.deepEqual(service.activityOf(project, asked.slug, 0).rows.filter(r => r.kind === "tool").map(r => [r.verb, r.target, r.state, r.output]), [["Ran", "npm test", "done", "3 passing"]]);
  assert.match(service.readDoc(project, asked.slug), /Finished in Antigravity/);
  assert.equal(service.conversationOf(project, asked.slug, F.parseLine(service.readDoc(project, asked.slug))).terminal, "agy --conversation conv-1");
  await service.act(project, asked.slug, "feedback", { text:"And the index" });
  await until(() => fs.existsSync(log) && runs().length === 2 && !service.runs.size, "the follow-up");
  const second = runs()[1];
  assert.equal(second.args[second.args.indexOf("--conversation") + 1], "conv-1", "the same conversation carries on");
  service.close();
});

test("Service finishes recovered agy turns on exit 0 and exit 1, while genuine terminal and startup errors still stop", async () => {
  const runScenario = async (name, events, exitCode) => {
    const dir = fresh(`agy-${name}`), script = path.join(dir, "agy.js");
    fs.writeFileSync(script, `
const events = ${JSON.stringify(events)};
let buffer = "";
process.stdin.on("data", d => {
  buffer += d; const parts = buffer.split("\\n"); buffer = parts.pop();
  if (!parts.length) return;
  for (const o of events) console.log(JSON.stringify(o));
}).on("end", () => process.exit(${Number(exitCode)}));`);
    const agents = createAgents({ env:{ PATH:"", AGY_CLI_PATH:script } });
    const service = new Service({ directory:fresh(`state-${name}`), agents, autoWatch:false, conversations:{ home:fresh(`home-${name}`), env:{} } });
    const project = service.store.create({ name:"Demo", docsPath:fresh(`docs-${name}`), codePath:null });
    project.defaultAgent = "antigravity";
    try {
      const asked = await service.request(project, { text:`Scenario ${name}`, topic:"new" });
      await until(() => !service.runs.size && !service.finishing.size && ["done", "stopped"].includes(F.parseLine(service.readDoc(project, asked.slug)).status), `scenario ${name}`);
      const md = service.readDoc(project, asked.slug);
      const detail = service.store.readText(project, F.detailPath(asked.slug, "work-1")).text;
      const rows = service.activityOf(project, asked.slug, 0).rows;
      return { doc:F.parseLine(md), detail, front:F.splitFront(detail).front, rows };
    } finally {
      service.close();
    }
  };

  const recoveredEvents = [
    { event:"init", conversation_id:"conv-rec" },
    step({ step_index:23, state:"DONE", step_type:"error_message" }),
    step({ step_index:28, state:"DONE", step_type:"tool", tool_name:"read_file", tool_info:{ name:"read_file", parameters:{ Path:"/w/a.js" }, output:"ok" } }),
    step({ step_index:29, state:"ACTIVE", step_type:"agent_response", text_delta:"Recovered " }),
    step({ step_index:29, state:"DONE", step_type:"agent_response", text_delta:"cleanly." }),
    { event:"result", result:{ conversation_id:"conv-rec", status:"ERROR", response:"Recovered cleanly.", error:"The stream was interrupted. Please continue the task you were working on." } },
  ];

  for (const exitCode of [0, 1]) {
    const out = await runScenario(`recovered-exit-${exitCode}`, recoveredEvents, exitCode);
    assert.equal(out.doc.status, "done", `recovered agy turn with exit ${exitCode} should finish as done`);
    assert.equal(out.front["stop why"], undefined);
    assert.doesNotMatch(out.detail, /## Stopped/);
    assert.match(out.detail, /Recovered cleanly\./);
    assert.ok(out.rows.some(r => r.kind === "note" && /Recovered after: The stream was interrupted/.test(r.text)));
  }

  // Terminal error after earlier answer and tool must still stop (even on exit 0).
  const terminal = await runScenario("terminal-error", [
    { event:"init", conversation_id:"conv-term" },
    step({ step_index:1, state:"DONE", step_type:"agent_response", text_delta:"Partial progress." }),
    step({ step_index:2, state:"DONE", step_type:"tool", tool_name:"run_command", tool_info:{ name:"run_command", parameters:{ CommandLine:"npm test" }, output:"ok" } }),
    step({ step_index:3, state:"DONE", step_type:"error_message" }),
    { event:"result", result:{ conversation_id:"conv-term", status:"ERROR", response:"Partial progress.", error:"The stream was interrupted." } },
  ], 0);
  assert.equal(terminal.doc.status, "stopped");
  assert.equal(terminal.front["stop why"], "error");

  // Startup failure with no error_message / agent_response steps must still stop.
  const startup = await runScenario("startup-error", [
    { event:"result", result:{ conversation_id:"", status:"ERROR", error:"invalid model selection" } },
  ], 1);
  assert.equal(startup.doc.status, "stopped");
  assert.equal(startup.front["stop why"], "error");
  assert.match(startup.detail, /invalid model selection/);

  // A recovered turn whose final answer is itself a usage-limit notice still stops as limit.
  const limitNotice = await runScenario("limit-notice", [
    { event:"init", conversation_id:"conv-limit" },
    step({ step_index:1, state:"DONE", step_type:"error_message" }),
    step({ step_index:2, state:"DONE", step_type:"agent_response", text_delta:"You've hit your usage limit." }),
    { event:"result", result:{ conversation_id:"conv-limit", status:"ERROR", response:"You've hit your usage limit.", error:"The stream was interrupted." } },
  ], 1);
  assert.equal(limitNotice.doc.status, "stopped");
  assert.equal(limitNotice.front["stop why"], "limit");
});

test("agy that fails to start its conversation starts again once by itself, and stops on a second failure", async () => {
  const runFailing = async (name, failures) => {
    const dir = fresh(`agy-${name}`), script = path.join(dir, "agy.js"), count = path.join(dir, "count");
    // Like agy losing the race on its own conversation database: it says so on stderr and exits before any conversation exists.
    fs.writeFileSync(script, `
const fs = require("fs"), n = fs.existsSync(${JSON.stringify(count)}) ? Number(fs.readFileSync(${JSON.stringify(count)}, "utf8")) + 1 : 1;
fs.writeFileSync(${JSON.stringify(count)}, String(n));
if (n <= ${Number(failures)}) { console.error("Error: failed to start conversation: backend returned an empty conversation id"); process.exit(1); }
const say = o => console.log(JSON.stringify(o));
let buffer = "";
process.stdin.on("data", d => {
  buffer += d; const parts = buffer.split("\\n"); buffer = parts.pop();
  if (!parts.length) return;
  say({ event:"init", conversation_id:"conv-ok" });
  say({ event:"step_update", step_update:{ conversation_id:"conv-ok", step_index:1, state:"DONE", step_type:"agent_response", text_delta:"Started the second time." } });
  say({ event:"result", result:{ conversation_id:"conv-ok", status:"SUCCESS", response:"Started the second time." } });
});`);
    const agents = createAgents({ env:{ PATH:"", AGY_CLI_PATH:script } });
    const service = new Service({ directory:fresh(`state-${name}`), agents, autoWatch:false, conversations:{ home:fresh(`home-${name}`), env:{} } });
    const project = service.store.create({ name:"Demo", docsPath:fresh(`docs-${name}`), codePath:null });
    project.defaultAgent = "antigravity";
    try {
      const asked = await service.request(project, { text:`Scenario ${name}`, topic:"new" });
      await until(() => !service.runs.size && !service.finishing.size && !service.startingWorks.size && ["done", "stopped"].includes(F.parseLine(service.readDoc(project, asked.slug)).status), `scenario ${name}`);
      const doc = F.parseLine(service.readDoc(project, asked.slug));
      return { doc, runs:Number(fs.readFileSync(count, "utf8")), rows:service.activityOf(project, asked.slug, 0).rows, detail:service.store.readText(project, F.detailPath(asked.slug, "work-1")).text };
    } finally {
      service.close();
    }
  };
  const once = await runFailing("start-once", 1);
  assert.equal(once.doc.status, "done");
  assert.equal(once.runs, 2);
  assert.equal(once.doc.steps.filter(s => s.kind === "work").length, 1, "the same Work carries on");
  assert.match(once.detail, /Started the second time\./);
  assert.ok(once.rows.some(r => r.kind === "note" && /could not start its conversation/.test(r.text)));
  const twice = await runFailing("start-twice", 2);
  assert.equal(twice.doc.status, "stopped");
  assert.equal(twice.runs, 2);
  assert.match(twice.doc.front.why, /failed to start conversation/);
});

test("agy models groups tier variants into base models + effortsFor and createAgentCheck caches and migrates them", async t => {
  const { parseAntigravityModels } = require("../src/server/project-lines/agent-model.js");
  const { createAgentCheck } = require("../src/server/project-lines/agent-check.js");
  const parsed = parseAntigravityModels("\r⠋ Fetching available models...\r\n\u001b[2Kgemini-4-argon-high\tGemini 4 Argon (High)\ngemini-4-argon-medium\tGemini 4 Argon (Medium)\ngemini-4-hydrogen-xhigh\tGemini 4 Hydrogen (XHigh)\ngemini-4-hydrogen-low\tGemini 4 Hydrogen (Low)\ngemini-pro-orchestrator-g1-pro\tOrchestrator (Argon)\nclaude-opus-5-5-high            Claude Opus 5.5 (High)\n");
  assert.deepEqual(parsed.choices, ["gemini-4-argon", "gemini-4-hydrogen", "gemini-pro-orchestrator-g1-pro", "claude-opus-5-5"]);
  assert.equal(parsed.choiceLabels["gemini-4-argon"], "Gemini 4 Argon");
  assert.equal(parsed.choiceLabels["gemini-pro-orchestrator-g1-pro"], "Orchestrator (Argon)");
  assert.deepEqual(parsed.effortsFor, { "gemini-4-argon":["medium", "high"], "gemini-4-hydrogen":["low", "xhigh"], "claude-opus-5-5":["high"] });
  assert.deepEqual(parsed.variants["gemini-4-hydrogen-xhigh"], { model:"gemini-4-hydrogen", effort:"xhigh" });

  const root = fresh("agy-check-"), bin = path.join(root, "bin"), modelsFile = path.join(root, "agent-models.json");
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  fs.mkdirSync(bin);
  const agy = path.join(bin, "agy");
  fs.writeFileSync(agy, "#!/bin/sh\n", { mode:0o755 });
  fs.mkdirSync(path.join(root, ".gemini", "antigravity-cli"), { recursive:true });
  fs.writeFileSync(path.join(root, ".gemini", "antigravity-cli", "settings.json"), JSON.stringify({ model:"Gemini 3.8 Flash (High)" }));
  const env = { HOME:root, PATH:`${bin}:/usr/bin:/bin`, SHELL:"/bin/sh" };
  const agents = createAgents({ env, appFolders:[] });
  agents.useModelFile(modelsFile);
  // Seed a legacy tier-suffixed pick to verify automatic migration to base model + effort.
  agents.pickModel("antigravity", "gemini-4-argon-medium", "medium");
  let modelCalls = 0;
  const run = async (cmd, args) => {
    if (args[0] === "--version") return { status:0, stdout:"1.5.8\n", stderr:"" };
    if (args[0] === "models") { modelCalls++; return { status:0, stdout:"gemini-4-argon-high  Gemini 4 Argon (High)\ngemini-4-argon-medium  Gemini 4 Argon (Medium)\ngemini-3.8-flash-low  Gemini 3.8 Flash (Low)\ngemini-3.8-flash-high  Gemini 3.8 Flash (High)\ngemini-pro-orchestrator-g1-pro  Orchestrator (Argon)\n", stderr:"" }; }
    return { status:1, stdout:"", stderr:"" };
  };
  const checker = createAgentCheck(agents, { env, run, maxAge:0 });
  const first = (await checker.check()).agents.find(a => a.id === "antigravity");
  assert.deepEqual(first.model.choices, ["gemini-4-argon", "gemini-3.8-flash", "gemini-pro-orchestrator-g1-pro"]);
  assert.deepEqual(first.model.efforts, []);
  assert.deepEqual(first.model.effortsFor["gemini-4-argon"], ["medium", "high"]);
  assert.deepEqual(first.model.effortsFor["Gemini 3.8 Flash (High)"], ["low", "high"]);
  assert.deepEqual(first.model.effortsFor["gemini-pro-orchestrator-g1-pro"], []);
  assert.equal(first.model.picked, "gemini-4-argon");
  assert.equal(first.model.pickedEffort, "medium");
  assert.equal(modelCalls, 1);

  assert.equal((await checker.pickModel("antigravity", { effort:"max" })).error, "gemini-4-argon does not take the reasoning level max.");
  const picked = (await checker.pickModel("antigravity", { model:"gemini-4-argon", effort:"high" })).agents.find(a => a.id === "antigravity");
  assert.equal(picked.model.picked, "gemini-4-argon");
  assert.equal(picked.model.pickedEffort, "high");
  const tierless = (await checker.pickModel("antigravity", { model:"gemini-pro-orchestrator-g1-pro" })).agents.find(a => a.id === "antigravity");
  assert.equal(tierless.model.pickedEffort, "", "switching to a tierless Antigravity model drops effort");

  await checker.check();
  assert.equal(modelCalls, 1, "cached across non-fresh checks");
  await checker.check({ fresh:true });
  assert.equal(modelCalls, 2, "Check again refreshes available Antigravity models");
});

test("Antigravity desktop and CLI conversations sync into linked projects, handle live turns, subagents, pictures, and open cleanly", async t => {
  const { DatabaseSync } = require("node:sqlite");
  const { Conversations } = require("../src/server/project-lines/conversations.js");
  const { Service } = require("../src/server/project-lines/service.js");
  const root = fresh("agy-sync-"), home = path.join(root, "home"), docs = path.join(root, "docs"), code = path.join(root, "repo"), state = path.join(root, "state"), apps = path.join(root, "Applications"), bin = path.join(root, "bin");
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  fs.mkdirSync(docs, { recursive:true }); fs.mkdirSync(code, { recursive:true }); fs.mkdirSync(state, { recursive:true }); fs.mkdirSync(bin, { recursive:true });
  fs.mkdirSync(path.join(apps, "Antigravity.app", "Contents"), { recursive:true });
  fs.writeFileSync(path.join(apps, "Antigravity.app", "Contents", "Info.plist"), `<?xml version="1.0"?><plist><dict><key>CFBundleIdentifier</key><string>com.google.antigravity</string><key>CFBundleShortVersionString</key><string>2.31.2</string></dict></plist>`);
  const cli = path.join(bin, "agy");
  fs.writeFileSync(cli, "#!/bin/sh\necho '1.5.8'\n", { mode:0o755 });

  const agDesk = path.join(home, ".gemini", "antigravity"), agCli = path.join(home, ".gemini", "antigravity-cli");
  for (const dir of [agDesk, agCli]) {
    fs.mkdirSync(path.join(dir, "brain"), { recursive:true });
    const db = new DatabaseSync(path.join(dir, "conversation_summaries.db"));
    db.exec("CREATE TABLE conversation_summaries (conversation_id TEXT PRIMARY KEY, title TEXT, step_count INTEGER, last_modified_time TEXT, workspace_uris TEXT, status TEXT, source TEXT, parent_conversation_id TEXT, nesting_depth INTEGER, app_data_dir TEXT)");
    db.close();
  }
  const writeTranscript = (baseDir, id, lines) => {
    const file = path.join(baseDir, "brain", id, ".system_generated", "logs", "transcript_full.jsonl");
    fs.mkdirSync(path.dirname(file), { recursive:true });
    fs.writeFileSync(file, lines.map(o => JSON.stringify(o)).join("\n") + "\n");
    return file;
  };
  const upsertSummary = (dbFile, row) => {
    const db = new DatabaseSync(dbFile);
    db.prepare("INSERT OR REPLACE INTO conversation_summaries (conversation_id, title, step_count, last_modified_time, workspace_uris, status, source, parent_conversation_id, nesting_depth, app_data_dir) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(row.id, row.title || "", row.steps || 1, row.at, JSON.stringify(row.uris || []), row.status || "CASCADE_RUN_STATUS_IDLE", row.source || "", row.parent || "", row.depth || 0, row.dir || "antigravity");
    db.close();
  };

  const env = { HOME:home, PATH:bin };
  const agents = createAgents({ env, appFolders:[apps] });
  const service = new Service({ directory:state, agents, autoWatch:false });
  const project = service.store.create({ name:"Widget", docsPath:docs, codePath:code });
  project.createdAt = Date.now() - 60000;
  project.followSince = project.createdAt;
  service.store.save();
  const conv = new Conversations({ directory:state, service, env, home, idleMs:45000 });
  const uri = `file://${code}`;

  // Upload image attachment for Desktop conversation.
  const imgFile = path.join(agDesk, "brain", "desk-1", ".user_uploaded", "pic.png");
  fs.mkdirSync(path.dirname(imgFile), { recursive:true });
  fs.writeFileSync(imgFile, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));

  const t1 = new Date(Date.now() - 10000).toISOString(), t2 = new Date(Date.now() - 8000).toISOString();
  const deskFile = writeTranscript(agDesk, "desk-1", [
    { step_index:0, source:"USER_EXPLICIT", type:"USER_INPUT", status:"DONE", created_at:t1, content:"<USER_REQUEST>\nBuild the widget\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\ntime\n</ADDITIONAL_METADATA>", media:[{ mime_type:"image/png", uri:`file://${imgFile}` }] },
    { step_index:1, source:"MODEL", type:"PLANNER_RESPONSE", status:"DONE", created_at:t2, tool_calls:[{ name:"read_file", args:{ Path:path.join(code, "a.js") } }], content:"Working on the widget." },
    { step_index:2, source:"MODEL", type:"GENERIC", status:"DONE", created_at:t2, content:"raw file output should not become assistant reply" },
  ]);
  // Reconcile the Desktop row into BOTH DBs plus an unrelated /tmp conversation and a subagent.
  const deskRow = { id:"desk-1", title:"Widget Build", at:t2, uris:[uri, "file:///other/repo"], status:"CASCADE_RUN_STATUS_RUNNING", dir:"antigravity" };
  upsertSummary(path.join(agDesk, "conversation_summaries.db"), deskRow);
  upsertSummary(path.join(agCli, "conversation_summaries.db"), deskRow);
  upsertSummary(path.join(agDesk, "conversation_summaries.db"), { id:"sub-1", title:"Subagent", at:t2, uris:[], status:"CASCADE_RUN_STATUS_IDLE", parent:"desk-1", depth:1, dir:"antigravity" });
  writeTranscript(agDesk, "sub-1", [{ step_index:0, source:"USER_EXPLICIT", type:"USER_INPUT", status:"DONE", created_at:t2, content:"<USER_REQUEST>\nsub task\n</USER_REQUEST>" }]);
  upsertSummary(path.join(agDesk, "conversation_summaries.db"), { id:"tmp-1", title:"Temp", at:t2, uris:["file:///tmp/unrelated"], status:"CASCADE_RUN_STATUS_IDLE", dir:"antigravity" });
  writeTranscript(agDesk, "tmp-1", [{ step_index:0, source:"USER_EXPLICIT", type:"USER_INPUT", status:"DONE", created_at:t2, content:"<USER_REQUEST>\nignore me\n</USER_REQUEST>" }]);

  await conv.tick();
  const topicsAfterStart = service.store.scan(project).topics;
  assert.equal(topicsAfterStart.length, 1, "only matching top-level conversation becomes a Topic (not subagent or unrelated /tmp)");
  const slug = topicsAfterStart[0].slug;
  assert.match(service.readDoc(project, slug), /Build the widget/);
  assert.match(service.readDoc(project, slug), /!\[picture\.png\]\(\.\.\/files\/[^)]+\/picture\.png\)/);
  assert.equal(topicsAfterStart[0].doc.status, "working");
  assert.equal(topicsAfterStart[0].doc.front.source, "Antigravity");
  assert.ok(service.activity.load(project, slug).rows.some(r => r.verb === "Read" && r.target === path.join(code, "a.js")), "PLANNER_RESPONSE tool_calls map into activity rows");
  assert.equal(await conv.titleOf("antigravity", "desk-1"), "Widget Build");
  assert.equal(await conv.stillOpens("antigravity", "desk-1"), true);
  assert.equal(service.agents.terminal("antigravity", "desk-1"), "");
  assert.deepEqual(service.agents.openApp("antigravity", "desk-1"), { command:"open", args:["-a", path.join(apps, "Antigravity.app")], app:"Antigravity", picks:true });

  // Finish the turn in Desktop DB & transcript -> settles immediately via explicitIdle!
  const t3 = new Date(Date.now() - 2000).toISOString();
  fs.appendFileSync(deskFile, JSON.stringify({ step_index:3, source:"MODEL", type:"PLANNER_RESPONSE", status:"DONE", created_at:t3, content:"Widget is ready." }) + "\n");
  upsertSummary(path.join(agDesk, "conversation_summaries.db"), { ...deskRow, at:t3, status:"CASCADE_RUN_STATUS_IDLE" });
  await conv.tick();
  const doneDoc = F.parseLine(service.readDoc(project, slug));
  assert.equal(doneDoc.status, "done");
  assert.match(doneDoc.steps.find(s => s.kind === "work")?.body || "", /Widget is ready\./);
  // An unchanged conversation is passed over before its shared lock: an idle one locked every 3 s wrote lock files into the docs folder
  // and moved its watcher, so every page look made the whole state again.
  const sharedRun = conv.shared.run;
  let deskRuns = 0;
  conv.shared.run = function (p, rec, fn) { if (rec.id === "desk-1") deskRuns++; return sharedRun.call(this, p, rec, fn); };
  await conv.tick(); await conv.tick();
  assert.equal(deskRuns, 0, "an idle Antigravity conversation takes no shared lock");
  conv.shared.run = sharedRun;

  // Follow-up turn: PENECHO_PROMPT step is skipped (scripted), next human prompt opens Work 2 incrementally, subagent helper bumps mtime, and ERROR_MESSAGE adds a note.
  const t4 = new Date(Date.now() - 1000).toISOString();
  const t5 = new Date().toISOString();
  fs.appendFileSync(deskFile, [
    JSON.stringify({ step_index:4, source:"USER_EXPLICIT", type:"USER_INPUT", status:"DONE", created_at:t4, content:"<USER_REQUEST>\nA person using PenEcho asks for ignore scripted handoff\n</USER_REQUEST>" }),
    JSON.stringify({ step_index:5, source:"USER_EXPLICIT", type:"USER_INPUT", status:"DONE", created_at:t4, content:"<USER_REQUEST>\nPolish the corners\n</USER_REQUEST>" }),
    JSON.stringify({ step_index:6, source:"MODEL", type:"ERROR_MESSAGE", status:"ERROR", created_at:t5, error:"Rate limit reached" }),
  ].map(l => l + "\n").join(""));
  upsertSummary(path.join(agDesk, "conversation_summaries.db"), { id:"sub-1", title:"Subagent", at:t5, uris:[], status:"CASCADE_RUN_STATUS_RUNNING", parent:"desk-1", depth:1, dir:"antigravity" });
  upsertSummary(path.join(agDesk, "conversation_summaries.db"), { ...deskRow, at:t5, status:"CASCADE_RUN_STATUS_IDLE" });
  await conv.tick();
  const mdFollow = service.readDoc(project, slug);
  assert.doesNotMatch(mdFollow, /ignore scripted handoff/);
  assert.match(mdFollow, /Polish the corners/);
  assert.ok(service.activity.load(project, slug).rows.some(r => r.kind === "note" && /Rate limit reached/.test(r.text || "")), "ERROR_MESSAGE adds a note row");

  // Historic CLI conversation from before followSince is picked up by syncRecent and opens in Terminal.
  const oldAt = new Date(Date.now() - 3600000).toISOString();
  writeTranscript(agCli, "cli-old", [
    { step_index:0, source:"USER_EXPLICIT", type:"USER_INPUT", status:"DONE", created_at:oldAt, content:"<USER_REQUEST>\nFix older CLI bug\n</USER_REQUEST>" },
    { step_index:1, source:"MODEL", type:"PLANNER_RESPONSE", status:"DONE", created_at:oldAt, content:"Fixed the CLI bug." },
  ]);
  const cliRow = { id:"cli-old", title:"CLI Fix", at:oldAt, uris:[uri], status:"CASCADE_RUN_STATUS_IDLE", source:"CORTEX_TRAJECTORY_SOURCE_CLI", dir:"antigravity-cli" };
  upsertSummary(path.join(agCli, "conversation_summaries.db"), cliRow);
  upsertSummary(path.join(agDesk, "conversation_summaries.db"), { ...cliRow, dir:"antigravity" });
  const synced = await conv.syncRecent(project);
  assert.equal(synced.added, 1);
  const cliTopic = service.store.scan(project).topics.find(x => x.slug !== slug);
  assert.ok(cliTopic);
  assert.equal(cliTopic.doc.status, "done");
  assert.equal(cliTopic.doc.front.source, "Antigravity CLI");
  // It ended an hour ago, when it last said something, not now when the sync read it (PE-491).
  const oldLabel = F.nowLabel(new Date(oldAt)), cliWork = F.splitFront(fs.readFileSync(path.join(docs, F.detailPath(cliTopic.slug, "work-1")), "utf8")).front;
  assert.equal(cliWork.ended, oldLabel);
  assert.equal(cliTopic.doc.front.finished, oldLabel);
  assert.equal(await conv.stillOpens("antigravity", "cli-old"), true);
  assert.equal(service.agents.openApp("antigravity", "cli-old"), null);
  assert.equal(service.agents.terminal("antigravity", "cli-old"), "agy --conversation cli-old");

  // PE-758 / PE-792: CASCADE_RUN_STATUS_IDLE while a non-daemon background task is still RUNNING in transcript_full.jsonl
  // must NOT settle the Work as Done with an interim "Waiting for completion." reply.
  const pe758At = new Date().toISOString();
  const pe758File = writeTranscript(agCli, "cli-pe758", [
    { step_index:0, source:"USER_EXPLICIT", type:"USER_INPUT", status:"DONE", created_at:pe758At, content:"<USER_REQUEST>\nDeploy Cloud and verify smoke checks\n</USER_REQUEST>" },
    { step_index:1, source:"MODEL", type:"PLANNER_RESPONSE", status:"DONE", created_at:pe758At, tool_calls:[{ name:"run_command", args:{ CommandLine:'"gh workflow run deploy-low-cost.yml && gh run watch 44677775746"' } }] },
    { step_index:2, source:"MODEL", type:"GENERIC", status:"RUNNING", created_at:pe758At, content:"Tool is running as a background task with task id: cli-pe758/task-401\nTask Description: gh workflow run deploy-low-cost.yml" },
    { step_index:3, source:"MODEL", type:"PLANNER_RESPONSE", status:"DONE", created_at:pe758At, content:"Deployment (run 44677775746) is now running. Waiting for completion." },
  ]);
  const pe758Row = { id:"cli-pe758", title:"Deploy Cloud", at:pe758At, uris:[uri], status:"CASCADE_RUN_STATUS_IDLE", source:"CORTEX_TRAJECTORY_SOURCE_CLI", dir:"antigravity-cli" };
  upsertSummary(path.join(agCli, "conversation_summaries.db"), pe758Row);
  await conv.tick();
  const pe758Rec = conv.records["antigravity:cli-pe758"];
  assert.ok(pe758Rec?.slug, "PE-758 conversation creates a Line");
  const pe758Doc = F.parseLine(service.readDoc(project, pe758Rec.slug));
  assert.equal(pe758Doc.status, "working", "pending background task keeps Line working even when DB says CASCADE_RUN_STATUS_IDLE");
  assert.equal(pe758Rec.pendingTask, true);
  assert.equal(pe758Rec.explicitIdle, false);

  // 10-15 minute wait with a pending background task stays Working (does not time out after 5-minute TURN_OPEN_MS).
  pe758Rec.lastAt = Date.now() - 14 * 60000;
  assert.equal(conv.isActive(pe758Rec), true, "pending background task stays active past 5-minute TURN_OPEN_MS (14 min wait)");
  pe758Rec.lastAt = Date.now() - 31 * 60000;
  assert.equal(conv.isActive(pe758Rec), false, "pending background task times out after 30-minute PENDING_TASK_MS");

  // If the conversation permanently goes quiet while the background task is still pending, it stops honestly as error, never Done.
  await service.conversationQuiet(project, pe758Rec);
  const stoppedPe758 = F.parseLine(service.readDoc(project, pe758Rec.slug));
  assert.equal(stoppedPe758.status, "stopped", "unfinished background task marks Line stopped, not done");
  assert.match(stoppedPe758.front.why || "", /background task/i);
  const pe758Detail = fs.readFileSync(path.join(docs, F.detailPath(pe758Rec.slug, "work-1")), "utf8");
  assert.equal(F.splitFront(pe758Detail).front["stop why"], "error");
  assert.match(F.sectionText(pe758Detail, "Stopped"), /background task/i);

  // If the background task later completes and writes a final answer (without manually resetting status),
  // late completion reconciles the open stopped Work cleanly AND clears stale stop why / resets at / Stopped.
  const pe758DoneAt = new Date(Date.now() + 2000).toISOString();
  fs.appendFileSync(pe758File, [
    JSON.stringify({ step_index:4, source:"SYSTEM", type:"SYSTEM_MESSAGE", status:"DONE", created_at:pe758DoneAt, content:'[Message] sender=cli-pe758/task-401 content=Task id "cli-pe758/task-401" finished with result:\nOK' }),
    JSON.stringify({ step_index:5, source:"MODEL", type:"PLANNER_RESPONSE", status:"DONE", created_at:pe758DoneAt, content:"Deployment succeeded and smoke checks passed." }),
  ].join("\n") + "\n");
  upsertSummary(path.join(agCli, "conversation_summaries.db"), { ...pe758Row, at:pe758DoneAt, status:"CASCADE_RUN_STATUS_IDLE" });
  await conv.tick();
  const finishedPe758 = F.parseLine(service.readDoc(project, pe758Rec.slug));
  assert.equal(finishedPe758.status, "done", "late completion reconciles stopped pending-task Work to done");
  assert.match(finishedPe758.steps.find(s => s.kind === "work")?.body || "", /Deployment succeeded/);
  const cleanDetail = fs.readFileSync(path.join(docs, F.detailPath(pe758Rec.slug, "work-1")), "utf8");
  assert.equal(F.splitFront(cleanDetail).front["stop why"], undefined, "clean close clears stale stop why");
  assert.equal(F.splitFront(cleanDetail).front["resets at"], undefined, "clean close clears stale resets at");
  assert.equal(F.sectionText(cleanDetail, "Stopped"), null, "clean close clears Stopped section");

  // Oversized (>8 MiB) completion notice pins incremental reader before final answer: importer must NOT settle with stale "Waiting...".
  const bigAt = new Date().toISOString();
  const bigFile = writeTranscript(agCli, "cli-bigrow", [
    { step_index:0, source:"USER_EXPLICIT", type:"USER_INPUT", status:"DONE", created_at:bigAt, content:"<USER_REQUEST>\nRun big deploy\n</USER_REQUEST>" },
    { step_index:1, source:"MODEL", type:"PLANNER_RESPONSE", status:"DONE", created_at:bigAt, tool_calls:[{ name:"run_command", args:{ CommandLine:'"gh run watch 999"' } }] },
    { step_index:2, source:"MODEL", type:"GENERIC", status:"RUNNING", created_at:bigAt, content:"Tool is running as a background task with task id: cli-bigrow/task-2\nTask Description: gh run watch 999" },
    { step_index:3, source:"MODEL", type:"PLANNER_RESPONSE", status:"DONE", created_at:bigAt, content:"Waiting for big deploy." },
  ]);
  const bigRow = { id:"cli-bigrow", title:"Big Deploy", at:bigAt, uris:[uri], status:"CASCADE_RUN_STATUS_IDLE", source:"CORTEX_TRAJECTORY_SOURCE_CLI", dir:"antigravity-cli" };
  upsertSummary(path.join(agCli, "conversation_summaries.db"), bigRow);
  await conv.tick();
  const bigRec = conv.records["antigravity:cli-bigrow"];
  assert.equal(F.parseLine(service.readDoc(project, bigRec.slug)).status, "working");
  const bigDoneAt = new Date(Date.now() + 3000).toISOString();
  const hugeOutput = "Z".repeat(8 * 1024 * 1024 + 4096);
  fs.appendFileSync(bigFile, [
    JSON.stringify({ step_index:4, source:"SYSTEM", type:"SYSTEM_MESSAGE", status:"DONE", created_at:bigDoneAt, content:`[Message] sender=cli-bigrow/task-2 content=Task id "cli-bigrow/task-2" finished with result:\n${hugeOutput}` }),
    JSON.stringify({ step_index:5, source:"MODEL", type:"PLANNER_RESPONSE", status:"DONE", created_at:bigDoneAt, content:"Big deploy verified green." }),
  ].join("\n") + "\n");
  upsertSummary(path.join(agCli, "conversation_summaries.db"), { ...bigRow, at:bigDoneAt, status:"CASCADE_RUN_STATUS_IDLE" });
  await conv.tick();
  const bigDoc = F.parseLine(service.readDoc(project, bigRec.slug));
  assert.equal(bigDoc.status, "done");
  assert.match(bigDoc.steps.find(s => s.kind === "work")?.body || "", /Big deploy verified green/, "oversized >8 MiB row settles with verified final answer, not stale Waiting...");
  assert.doesNotMatch(bigDoc.steps.find(s => s.kind === "work")?.body || "", /Waiting for big deploy/);

  // Parallel unrelated run on the same Line must NOT let conversationQuiet bypass pendingTask guard and close imported Work as Done.
  const parAt = new Date().toISOString();
  writeTranscript(agCli, "cli-parallel", [
    { step_index:0, source:"USER_EXPLICIT", type:"USER_INPUT", status:"DONE", created_at:parAt, content:"<USER_REQUEST>\nParallel wait check\n</USER_REQUEST>" },
    { step_index:1, source:"MODEL", type:"PLANNER_RESPONSE", status:"DONE", created_at:parAt, tool_calls:[{ name:"run_command", args:{ CommandLine:'"sleep 600"' } }] },
    { step_index:2, source:"MODEL", type:"GENERIC", status:"RUNNING", created_at:parAt, content:"Tool is running as a background task with task id: cli-parallel/task-2\nTask Description: sleep 600" },
    { step_index:3, source:"MODEL", type:"PLANNER_RESPONSE", status:"DONE", created_at:parAt, content:"Waiting on parallel task." },
  ]);
  upsertSummary(path.join(agCli, "conversation_summaries.db"), { id:"cli-parallel", title:"Parallel Wait", at:parAt, uris:[uri], status:"CASCADE_RUN_STATUS_IDLE", source:"CORTEX_TRAJECTORY_SOURCE_CLI", dir:"antigravity-cli" });
  await conv.tick();
  const parRec = conv.records["antigravity:cli-parallel"];
  const parKey = service.key(project, parRec.slug);
  service.runs.set(parKey, { stepId:"work-99", agent:"codex", sessionId:"other" });
  await service.conversationQuiet(project, parRec);
  service.runs.delete(parKey);
  const parDoc = F.parseLine(service.readDoc(project, parRec.slug));
  const parWork = parDoc.steps.find(s => s.id === parRec.stepId);
  assert.equal(parWork.off, "stopped", "unrelated active run on the same Line must not bypass pendingTask guard");
  assert.doesNotMatch(parWork.body || "", /Waiting on parallel task/);

  // Late completion must NOT overwrite a newer Retry/Work started after the stopped Work.
  const retryAt = new Date().toISOString();
  const retryFile = writeTranscript(agCli, "cli-retry-guard", [
    { step_index:0, source:"USER_EXPLICIT", type:"USER_INPUT", status:"DONE", created_at:retryAt, content:"<USER_REQUEST>\nRetry guard check\n</USER_REQUEST>" },
    { step_index:1, source:"MODEL", type:"PLANNER_RESPONSE", status:"DONE", created_at:retryAt, tool_calls:[{ name:"run_command", args:{ CommandLine:'"sleep 600"' } }] },
    { step_index:2, source:"MODEL", type:"GENERIC", status:"RUNNING", created_at:retryAt, content:"Tool is running as a background task with task id: cli-retry-guard/task-2\nTask Description: sleep 600" },
    { step_index:3, source:"MODEL", type:"PLANNER_RESPONSE", status:"DONE", created_at:retryAt, content:"Waiting on retry guard." },
  ]);
  const retryRow = { id:"cli-retry-guard", title:"Retry Guard", at:retryAt, uris:[uri], status:"CASCADE_RUN_STATUS_IDLE", source:"CORTEX_TRAJECTORY_SOURCE_CLI", dir:"antigravity-cli" };
  upsertSummary(path.join(agCli, "conversation_summaries.db"), retryRow);
  await conv.tick();
  const retryRec = conv.records["antigravity:cli-retry-guard"];
  await service.conversationQuiet(project, retryRec);
  assert.equal(F.parseLine(service.readDoc(project, retryRec.slug)).status, "stopped");
  // Simulate a newer Work added after Work 1 (e.g. Carry on / Retry).
  service.writeDoc(project, retryRec.slug, F.updateSteps(service.readDoc(project, retryRec.slug), steps => {
    steps.push(F.workStep({ who:"codex" }));
  }));
  const retryDoneAt = new Date(Date.now() + 4000).toISOString();
  fs.appendFileSync(retryFile, [
    JSON.stringify({ step_index:4, source:"SYSTEM", type:"SYSTEM_MESSAGE", status:"DONE", created_at:retryDoneAt, content:'[Message] sender=cli-retry-guard/task-2 content=Task id "cli-retry-guard/task-2" finished with result:\nOK' }),
    JSON.stringify({ step_index:5, source:"MODEL", type:"PLANNER_RESPONSE", status:"DONE", created_at:retryDoneAt, content:"Late old answer." }),
  ].join("\n") + "\n");
  upsertSummary(path.join(agCli, "conversation_summaries.db"), { ...retryRow, at:retryDoneAt, status:"CASCADE_RUN_STATUS_IDLE" });
  await conv.tick();
  assert.equal(F.parseLine(service.readDoc(project, retryRec.slug)).status, "stopped", "late completion must not reopen/overwrite when a newer Work exists");

  // agStamp includes exact status so non-busy -> CASCADE_RUN_STATUS_IDLE transition is never missed.
  const { antigravityStamp } = require("../src/server/project-lines/conversations.js");
  const fakeStat = { size:100, mtimeMs:12345 };
  const s1 = antigravityStamp({ file:pe758File, busy:false, status:"CASCADE_RUN_STATUS_WAITING", title:"T", updated:1 }, fakeStat);
  const s2 = antigravityStamp({ file:pe758File, busy:false, status:"CASCADE_RUN_STATUS_IDLE", title:"T", updated:1 }, fakeStat);
  assert.notEqual(s1, s2, "agStamp changes when non-busy status transitions to CASCADE_RUN_STATUS_IDLE");

  // Dual-workspace conversation puts repoB first in workspace_uris -> routes to projectB even though projectA comes earlier in store.projects.
  const codeB = path.join(root, "repo-b"), docsB = path.join(root, "docs-b");
  fs.mkdirSync(codeB, { recursive:true }); fs.mkdirSync(docsB, { recursive:true });
  const projectB = service.store.create({ name:"WidgetB", docsPath:docsB, codePath:codeB });
  projectB.createdAt = Date.now() - 60000;
  projectB.followSince = projectB.createdAt;
  service.store.save();
  const dualAt = new Date().toISOString();
  writeTranscript(agDesk, "desk-dual", [
    { step_index:0, source:"USER_EXPLICIT", type:"USER_INPUT", status:"DONE", created_at:dualAt, content:"<USER_REQUEST>\nDual workspace primary check\n</USER_REQUEST>" },
    { step_index:1, source:"MODEL", type:"PLANNER_RESPONSE", status:"DONE", created_at:dualAt, content:"Routed to primary workspace." },
  ]);
  upsertSummary(path.join(agDesk, "conversation_summaries.db"), { id:"desk-dual", title:"Dual Primary", at:dualAt, uris:[`file://${codeB}`, uri], status:"CASCADE_RUN_STATUS_IDLE", dir:"antigravity" });
  await conv.tick();
  assert.equal(service.store.scan(projectB).topics.length, 1, "primary workspace (first URI) receives the dual-workspace conversation");
  assert.equal(service.store.scan(project).topics.some(x => x.doc.title === "Dual Primary" || /Dual workspace primary check/.test(service.readDoc(project, x.slug))), false, "secondary workspace project does not steal the primary workspace conversation");

  service.close();
});

test("live Antigravity run does not set turnOver or close Done during pending task or standalone error_message", async t => {
  const { EventEmitter } = require("node:events");
  const { PassThrough } = require("node:stream");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-agy-live-guard-"));
  const docs = path.join(root, "docs"), code = path.join(root, "code");
  fs.mkdirSync(docs, { recursive:true }); fs.mkdirSync(code, { recursive:true });
  const children = [];
  const agents = {
    available: () => [{ id:"antigravity", available:true, name:"Antigravity" }],
    classifier: () => null,
    command: options => ({ command:"agy", args:[], cwd:options.workdir, stdin:true, input:"stream-json", dialect:"antigravity" }),
  };
  const spawnFn = () => {
    const child = Object.assign(new EventEmitter(), { pid:920001 + children.length, stdout:new PassThrough(), stderr:new PassThrough(), stdin:new PassThrough(), killed:false });
    child.kill = () => { child.killed = true; setImmediate(() => child.emit("close", 0)); };
    children.push(child);
    return child;
  };
  const service = new Service({ directory:path.join(root, "state"), agents, autoWatch:false, conversations:{ home:path.join(root, "home"), env:{} }, spawnFn });
  const project = service.store.create({ name:"LiveGuard", docsPath:docs, codePath:code });
  project.defaultAgent = "antigravity"; service.store.save();
  t.after(() => { service.runs.clear(); service.close(); fs.rmSync(root, { recursive:true, force:true }); });

  // 1. Interim result while transcript still has a pending background task: must NOT set turnOver, must NOT close stdin, and exit 0 stops honestly instead of Done.
  service.antigravityRunState = () => ({ done:null, pending:true, pendingTasks:["cid/task-401"], unansweredWakeup:false, error:"" });
  const line1 = await service.createTopic(project, { text:"Deploy and watch.", agent:"antigravity", kinds:["ask", "work"], start:false });
  await service.begin(project, line1.slug);
  const run1 = service.runs.get(service.key(project, line1.slug)), child1 = children[0];
  child1.stdout.write(`${JSON.stringify({ event:"init", conversation_id:"conv-pending" })}\n`);
  child1.stdout.write(`${JSON.stringify({ event:"step_update", step_update:{ step_index:1, state:"DONE", step_type:"agent_response", text_delta:"Waiting for completion." } })}\n`);
  child1.stdout.write(`${JSON.stringify({ event:"result", result:{ conversation_id:"conv-pending", status:"SUCCESS", response:"Waiting for completion." } })}\n`);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.ok(!run1.turnOver, "live Antigravity run must not set turnOver when transcript has pending task");
  assert.equal(child1.stdin.writableEnded, false, "live Antigravity run must keep stdin open when transcript has pending task");
  child1.emit("close", 0);
  await new Promise(resolve => setTimeout(resolve, 60));
  const doc1 = F.parseLine(service.readDoc(project, line1.slug));
  assert.equal(doc1.status, "stopped", "exit 0 with pending background task must stop honestly, never Done");
  assert.match(doc1.front.why || "", /background task/i);

  // 2. Standalone error_message step followed by exit 0 without a result event must surface the error text and stop honestly.
  service.antigravityRunState = () => ({ done:null, pending:false, pendingTasks:[], unansweredWakeup:false, error:"" });
  const line2 = await service.createTopic(project, { text:"Run check.", agent:"antigravity", kinds:["ask", "work"], start:false });
  await service.begin(project, line2.slug);
  const child2 = children[1];
  child2.stdout.write(`${JSON.stringify({ event:"init", conversation_id:"conv-err" })}\n`);
  child2.stdout.write(`${JSON.stringify({ event:"step_update", step_update:{ step_index:2, state:"DONE", step_type:"error_message", text:"Upstream quota exhausted" } })}\n`);
  await new Promise(resolve => setTimeout(resolve, 30));
  child2.emit("close", 0);
  await new Promise(resolve => setTimeout(resolve, 60));
  const doc2 = F.parseLine(service.readDoc(project, line2.slug));
  assert.equal(doc2.status, "stopped", "exit 0 after standalone error_message without result must stop, not Done");
  assert.match(doc2.front.why || "", /Upstream quota exhausted/);
});

test("isAntigravityOAuthError matches Google OAuth 401 expiry shapes and ignores non-OAuth or limit errors", () => {
  assert.equal(isAntigravityOAuthError("UNAUTHENTICATED (code 401): Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential."), true);
  assert.equal(isAntigravityOAuthError('AGY_ERROR: {"short_error":"UNAUTHENTICATED (code 401)","status":"UNAUTHENTICATED","error_code":401,"code_kind":"http","retryable":false}'), true);
  assert.equal(isAntigravityOAuthError('{"error_code":401,"status":"UNAUTHENTICATED"}'), true);
  assert.equal(isAntigravityOAuthError("You are not logged into Antigravity."), false);
  assert.equal(isAntigravityOAuthError("invalid model selection"), false);
  assert.equal(isAntigravityOAuthError("The stream was interrupted."), false);
  assert.equal(isAntigravityOAuthError("UNAUTHENTICATED (code 401): rate limit exceeded"), false);
});

test("multi-turn Antigravity recovery clears earlier Turn 1 OAuth 401 error without masking later crashes or standalone errors", async t => {
  const { EventEmitter } = require("node:events");
  const { PassThrough } = require("node:stream");
  const root = fresh("agy-multiturn-");
  const docs = path.join(root, "docs"), code = path.join(root, "code");
  fs.mkdirSync(docs, { recursive:true }); fs.mkdirSync(code, { recursive:true });
  const children = [];
  const agents = {
    available: () => [{ id:"antigravity", available:true, name:"Antigravity" }],
    classifier: () => null,
    command: options => ({ command:"agy", args:[], cwd:options.workdir, stdin:true, input:"stream-json", dialect:"antigravity" }),
  };
  const spawnFn = () => {
    const child = Object.assign(new EventEmitter(), { pid:930001 + children.length, stdout:new PassThrough(), stderr:new PassThrough(), stdin:new PassThrough(), killed:false });
    child.kill = () => { child.killed = true; setImmediate(() => child.emit("close", 0)); };
    children.push(child);
    return child;
  };
  const service = new Service({ directory:path.join(root, "state"), agents, autoWatch:false, conversations:{ home:path.join(root, "home"), env:{} }, spawnFn });
  const project = service.store.create({ name:"MultiTurn", docsPath:docs, codePath:code });
  project.defaultAgent = "antigravity"; service.store.save();
  t.after(() => { service.runs.clear(); service.close(); fs.rmSync(root, { recursive:true, force:true }); });

  const oauth401 = "UNAUTHENTICATED (code 401): Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential.";

  // 1 & 2. Exact PE-793 Work 1 reproduction: Turn 1 fails with Google OAuth 401, Turn 2 refreshes and finishes with status SUCCESS (both exit 0 and exit 1).
  for (const exitCode of [0, 1]) {
    const line = await service.createTopic(project, { text:`Multi-turn exit ${exitCode}`, agent:"antigravity", kinds:["ask", "work"], start:false });
    await service.begin(project, line.slug);
    const child = children[children.length - 1];
    child.stdout.write(`${JSON.stringify({ event:"init", conversation_id:`conv-mt-${exitCode}` })}\n`);
    child.stdout.write(`${JSON.stringify({ event:"step_update", step_update:{ step_index:148, state:"DONE", step_type:"agent_response", text_delta:"Waiting for helper." } })}\n`);
    child.stdout.write(`${JSON.stringify({ event:"step_update", step_update:{ step_index:149, state:"DONE", step_type:"error_message" } })}\n`);
    child.stdout.write(`${JSON.stringify({ event:"result", result:{ conversation_id:`conv-mt-${exitCode}`, status:"ERROR", response:"Waiting for helper.", error:oauth401 } })}\n`);
    child.stderr.write(`error: ${oauth401}\nAGY_ERROR: {"status":"UNAUTHENTICATED","error_code":401}\n`);
    child.stdout.write(`${JSON.stringify({ event:"step_update", step_update:{ step_index:150, state:"DONE", step_type:"user_input" } })}\n`);
    child.stdout.write(`${JSON.stringify({ event:"step_update", step_update:{ step_index:162, state:"DONE", step_type:"agent_response", text_delta:"All work finished cleanly." } })}\n`);
    child.stdout.write(`${JSON.stringify({ event:"result", result:{ conversation_id:`conv-mt-${exitCode}`, status:"SUCCESS", response:"All work finished cleanly." } })}\n`);
    await wait(30);
    child.emit("close", exitCode);
    await until(() => !service.runs.size && !service.finishing.size && ["done", "stopped"].includes(F.parseLine(service.readDoc(project, line.slug)).status), `multiturn ${exitCode}`);
    const doc = F.parseLine(service.readDoc(project, line.slug));
    const detail = service.store.readText(project, F.detailPath(line.slug, "work-1")).text;
    const rows = service.activityOf(project, line.slug, 0).rows;
    assert.equal(doc.status, "done", `Turn 2 SUCCESS after Turn 1 401 should finish done (exit ${exitCode})`);
    assert.equal(F.splitFront(detail).front["stop why"], undefined);
    assert.doesNotMatch(detail, /## Stopped/);
    assert.doesNotMatch(detail, /UNAUTHENTICATED/);
    assert.match(detail, /All work finished cleanly\./);
    assert.equal(rows.some(r => r.kind === "error"), false, "no error row should be recorded on a cleanly completed Work");
  }

  // 3. Turn 1 recovers, Turn 2 has a standalone error_message without result -> must NOT be masked by Turn 1's recoveredTurn.
  const lineErr = await service.createTopic(project, { text:"Standalone error after recovery", agent:"antigravity", kinds:["ask", "work"], start:false });
  await service.begin(project, lineErr.slug);
  const childErr = children[children.length - 1];
  childErr.stdout.write(`${JSON.stringify({ event:"init", conversation_id:"conv-rec-then-err" })}\n`);
  childErr.stdout.write(`${JSON.stringify({ event:"step_update", step_update:{ step_index:1, state:"DONE", step_type:"error_message" } })}\n`);
  childErr.stdout.write(`${JSON.stringify({ event:"step_update", step_update:{ step_index:2, state:"DONE", step_type:"agent_response", text_delta:"Turn 1 recovered." } })}\n`);
  childErr.stdout.write(`${JSON.stringify({ event:"result", result:{ conversation_id:"conv-rec-then-err", status:"ERROR", response:"Turn 1 recovered.", error:"The stream was interrupted." } })}\n`);
  childErr.stdout.write(`${JSON.stringify({ event:"step_update", step_update:{ step_index:3, state:"DONE", step_type:"error_message", text:"Disk full during Turn 2" } })}\n`);
  await wait(30);
  childErr.emit("close", 1);
  await until(() => !service.runs.size && !service.finishing.size && ["done", "stopped"].includes(F.parseLine(service.readDoc(project, lineErr.slug)).status), "standalone after recovery");
  const docErr = F.parseLine(service.readDoc(project, lineErr.slug));
  assert.equal(docErr.status, "stopped", "standalone error after earlier recovery must still stop");
  assert.match(docErr.front.why || "", /Disk full during Turn 2/);

  // 4. Turn 1 fails with 401 -> Turn 2 succeeds cleanly -> Turn 3 fails with a new error -> reports Turn 3's error, not stale 401.
  const lineLater = await service.createTopic(project, { text:"Turn 3 failure after clean Turn 2", agent:"antigravity", kinds:["ask", "work"], start:false });
  await service.begin(project, lineLater.slug);
  const childLater = children[children.length - 1];
  childLater.stdout.write(`${JSON.stringify({ event:"init", conversation_id:"conv-turn3-err" })}\n`);
  childLater.stdout.write(`${JSON.stringify({ event:"result", result:{ conversation_id:"conv-turn3-err", status:"ERROR", error:oauth401 } })}\n`);
  childLater.stderr.write(`error: ${oauth401}\n`);
  childLater.stdout.write(`${JSON.stringify({ event:"step_update", step_update:{ step_index:5, state:"DONE", step_type:"agent_response", text_delta:"Turn 2 ok." } })}\n`);
  childLater.stdout.write(`${JSON.stringify({ event:"result", result:{ conversation_id:"conv-turn3-err", status:"SUCCESS", response:"Turn 2 ok." } })}\n`);
  childLater.stdout.write(`${JSON.stringify({ event:"result", result:{ conversation_id:"conv-turn3-err", status:"ERROR", error:"Context window exceeded" } })}\n`);
  await wait(30);
  childLater.emit("close", 1);
  await until(() => !service.runs.size && !service.finishing.size && ["done", "stopped"].includes(F.parseLine(service.readDoc(project, lineLater.slug)).status), "turn 3 error");
  const docLater = F.parseLine(service.readDoc(project, lineLater.slug));
  assert.equal(docLater.status, "stopped");
  assert.match(docLater.front.why || "", /Context window exceeded/);
  assert.doesNotMatch(docLater.front.why || "", /UNAUTHENTICATED/);

  // 5. Turn 1 fails with 401 -> Turn 2 succeeds cleanly -> automatic Turn 3 starts a tool and crashes (exit 1) without result/error_message -> MUST stop, not record Done with Turn 2's answer.
  const lineCrash = await service.createTopic(project, { text:"Automatic follow-up tool crash after recovery", agent:"antigravity", kinds:["ask", "work"], start:false });
  await service.begin(project, lineCrash.slug);
  const childCrash = children[children.length - 1];
  childCrash.stdout.write(`${JSON.stringify({ event:"init", conversation_id:"conv-turn3-crash" })}\n`);
  childCrash.stdout.write(`${JSON.stringify({ event:"result", result:{ conversation_id:"conv-turn3-crash", status:"ERROR", error:oauth401 } })}\n`);
  childCrash.stdout.write(`${JSON.stringify({ event:"step_update", step_update:{ step_index:5, state:"DONE", step_type:"agent_response", text_delta:"Turn 2 answer." } })}\n`);
  childCrash.stdout.write(`${JSON.stringify({ event:"result", result:{ conversation_id:"conv-turn3-crash", status:"SUCCESS", response:"Turn 2 answer." } })}\n`);
  childCrash.stdout.write(`${JSON.stringify({ event:"step_update", step_update:{ step_index:6, state:"ACTIVE", step_type:"tool", tool_name:"run_command", tool_info:{ name:"run_command", parameters:{ CommandLine:"npm test" } } } })}\n`);
  await wait(30);
  childCrash.emit("close", 1);
  await until(() => !service.runs.size && !service.finishing.size && ["done", "stopped"].includes(F.parseLine(service.readDoc(project, lineCrash.slug)).status), "turn 3 crash");
  const docCrash = F.parseLine(service.readDoc(project, lineCrash.slug));
  assert.equal(docCrash.status, "stopped", "a later turn crashing after starting a tool must not be masked by an earlier recoveredTurn");
  assert.equal(F.splitFront(service.store.readText(project, F.detailPath(lineCrash.slug, "work-1")).text).front["stop why"], "error");
});

test("single-turn Antigravity mid-run Google OAuth 401 automatically resumes and finishes cleanly, while permanent 401 stops without looping", async () => {
  const oauth401 = "UNAUTHENTICATED (code 401): Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential.";
  const runOAuthScenario = async (name, { failures, exitCode = 1, errorText = oauth401, withInit = true, cooldownMs, transcriptError = false } = {}) => {
    const dir = fresh(`agy-oauth-${name}`), script = path.join(dir, "agy.js"), count = path.join(dir, "count"), calls = path.join(dir, "calls.jsonl");
    fs.writeFileSync(script, `
const fs = require("fs"), args = process.argv.slice(2);
const n = fs.existsSync(${JSON.stringify(count)}) ? Number(fs.readFileSync(${JSON.stringify(count)}, "utf8")) + 1 : 1;
fs.writeFileSync(${JSON.stringify(count)}, String(n));
const say = o => console.log(JSON.stringify(o));
const id = args.includes("--conversation") ? args[args.indexOf("--conversation") + 1] : "conv-oauth-1";
let buffer = "", lines = [];
process.stdin.on("data", d => {
  buffer += d; const parts = buffer.split("\\n"); buffer = parts.pop();
  for (const part of parts) {
    if (!part.trim()) continue;
    lines.push(JSON.parse(part));
    if (n <= ${Number(failures)}) {
      if (${Boolean(withInit)}) {
        say({ event:"init", conversation_id:id });
        say({ event:"step_update", step_update:{ conversation_id:id, step_index:1, state:"DONE", step_type:"agent_response", text_delta:"Halfway done before token expiry." } });
        say({ event:"step_update", step_update:{ conversation_id:id, step_index:2, state:"DONE", step_type:"error_message" } });
      }
      if (${Boolean(transcriptError)}) {
        say({ event:"result", result:{ conversation_id:id, status:"SUCCESS", response:"Halfway done before token expiry." } });
      } else {
        say({ event:"result", result:{ conversation_id:id, status:"ERROR", response:"Halfway done before token expiry.", error:${JSON.stringify(errorText)} } });
        console.error("error: " + ${JSON.stringify(errorText)});
      }
    } else {
      say({ event:"init", conversation_id:id });
      say({ event:"step_update", step_update:{ conversation_id:id, step_index:10, state:"DONE", step_type:"agent_response", text_delta:"Completed cleanly after OAuth refresh." } });
      say({ event:"result", result:{ conversation_id:id, status:"SUCCESS", response:"Completed cleanly after OAuth refresh." } });
    }
  }
}).on("end", () => {
  fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ n, args, lines }) + "\\n");
  process.exit(n <= ${Number(failures)} ? ${Number(exitCode)} : 0);
});`);
    const agents = createAgents({ env:{ PATH:"", AGY_CLI_PATH:script } });
    const service = new Service({ directory:fresh(`state-${name}`), agents, autoWatch:false, conversations:{ home:fresh(`home-${name}`), env:{} } });
    if (cooldownMs !== undefined) service.oauthRetryCooldownMs = cooldownMs;
    if (transcriptError) {
      service.antigravityRunState = () => {
        const n = fs.existsSync(count) ? Number(fs.readFileSync(count, "utf8")) : 0;
        return n <= failures
          ? { done:null, pending:false, pendingTasks:[], unansweredWakeup:false, error:errorText }
          : { done:{ answer:"Completed cleanly after OAuth refresh.", at:Date.now() }, pending:false, pendingTasks:[], unansweredWakeup:false, error:"" };
      };
    } else {
      // Simulate transcript also holding ERROR_MESSAGE during Attempt 1 to verify stdin still closes promptly instead of hanging.
      service.antigravityRunState = () => {
        const n = fs.existsSync(count) ? Number(fs.readFileSync(count, "utf8")) : 0;
        return n <= failures
          ? { done:null, pending:false, pendingTasks:[], unansweredWakeup:false, error:errorText }
          : { done:{ answer:"Completed cleanly after OAuth refresh.", at:Date.now() }, pending:false, pendingTasks:[], unansweredWakeup:false, error:"" };
      };
    }
    const project = service.store.create({ name:"Demo", docsPath:fresh(`docs-${name}`), codePath:null });
    project.defaultAgent = "antigravity";
    try {
      const asked = await service.request(project, { text:`OAuth scenario ${name}`, topic:"new" });
      await until(() => !service.runs.size && !service.finishing.size && !service.startingWorks.size && ["done", "stopped"].includes(F.parseLine(service.readDoc(project, asked.slug)).status), `oauth ${name}`);
      const doc = F.parseLine(service.readDoc(project, asked.slug));
      const detail = service.store.readText(project, F.detailPath(asked.slug, "work-1")).text;
      const recorded = fs.readFileSync(calls, "utf8").trim().split("\n").map(l => JSON.parse(l));
      return { doc, detail, front:F.splitFront(detail).front, runs:Number(fs.readFileSync(count, "utf8")), calls:recorded, rows:service.activityOf(project, asked.slug, 0).rows };
    } finally {
      service.close();
    }
  };

  // 1. Mid-run OAuth 401 (even with transcript ERROR_MESSAGE present) closes stdin promptly, resumes same conversation, and finishes cleanly without any error banner.
  const recovered = await runOAuthScenario("midrun-recover", { failures:1, exitCode:1 });
  assert.equal(recovered.doc.status, "done");
  assert.equal(recovered.runs, 2);
  assert.equal(recovered.doc.steps.filter(s => s.kind === "work").length, 1, "resumes the same Work");
  assert.equal(recovered.calls[1].args[recovered.calls[1].args.indexOf("--conversation") + 1], "conv-oauth-1", "resumes the same Antigravity conversation");
  assert.match(recovered.calls[1].lines[0].message.content, /Google OAuth access token expired mid-run/);
  assert.equal(recovered.front["stop why"], undefined);
  assert.doesNotMatch(recovered.detail, /## Stopped/);
  assert.doesNotMatch(recovered.detail, /UNAUTHENTICATED/);
  assert.match(recovered.detail, /Completed cleanly after OAuth refresh\./);
  assert.equal(recovered.rows.some(r => r.kind === "error"), false);
  assert.ok(recovered.rows.some(r => r.kind === "note" && /Google OAuth token expired mid-run/.test(r.text)));

  // 2. Permanent OAuth 401 (both Attempt 1 and immediate Attempt 2 fail within cooldown) stops honestly after 1 retry.
  const permanent = await runOAuthScenario("permanent-401", { failures:5, exitCode:1 });
  assert.equal(permanent.doc.status, "stopped");
  assert.equal(permanent.runs, 2, "must not infinite-loop on permanently revoked credentials");
  assert.equal(permanent.front["stop why"], "error");
  assert.match(permanent.detail, /## Stopped[\s\S]*UNAUTHENTICATED/);

  // 3. Multi-hour Work hitting OAuth expiry twice (outside cooldown) recovers cleanly on Attempt 3.
  const multiHour = await runOAuthScenario("multi-hour", { failures:2, exitCode:0, cooldownMs:0 });
  assert.equal(multiHour.doc.status, "done");
  assert.equal(multiHour.runs, 3);
  assert.equal(multiHour.front["stop why"], undefined);
  assert.doesNotMatch(multiHour.detail, /## Stopped/);

  // 4. Logged-out error ("You are not logged into Antigravity.") is NOT retried as token expiry.
  const loggedOut = await runOAuthScenario("logged-out", { failures:2, exitCode:1, withInit:false, errorText:"You are not logged into Antigravity." });
  assert.equal(loggedOut.doc.status, "stopped");
  assert.equal(loggedOut.runs, 1);

  // 5. Exit 0 with trailing OAuth 401 in transcript_full.jsonl also triggers automatic resume and finishes cleanly.
  const transcriptOnly = await runOAuthScenario("transcript-401", { failures:1, exitCode:0, transcriptError:true });
  assert.equal(transcriptOnly.doc.status, "done");
  assert.equal(transcriptOnly.runs, 2);
  assert.equal(transcriptOnly.front["stop why"], undefined);
  assert.doesNotMatch(transcriptOnly.detail, /## Stopped/);

  // 6. Transcript-only 401 with exit 1 and no stream error also triggers OAuth auto-resume and finishes cleanly.
  const transcriptExit1 = await runOAuthScenario("transcript-exit1", { failures:1, exitCode:1, transcriptError:true });
  assert.equal(transcriptExit1.doc.status, "done");
  assert.equal(transcriptExit1.runs, 2);
  assert.equal(transcriptExit1.front["stop why"], undefined);
  assert.doesNotMatch(transcriptExit1.detail, /## Stopped/);
});

test("resumed OAuth retry ignores stale Attempt 1 transcript error predating run.started, recovers watchdog-stuck 401, and preserves tail + retry budget across reattach", async t => {
  const { EventEmitter } = require("node:events");
  const { PassThrough } = require("node:stream");
  const { antigravityTurnState } = require("../src/server/project-lines/run-watch.js");
  const oauth401 = "UNAUTHENTICATED (code 401): Request had invalid authentication credentials. Expected OAuth 2 access token.";

  // 1. Unit check: antigravityTurnState ignores ERROR_MESSAGE predating `since` and keeps one at/after `since`.
  const oldAt = new Date(Date.now() - 60000).toISOString();
  const nowMs = Date.now();
  const staleRows = [
    { step_index:0, type:"USER_INPUT", source:"USER_EXPLICIT", status:"DONE", created_at:oldAt, content:"do work" },
    { step_index:1, type:"ERROR_MESSAGE", status:"ERROR", created_at:oldAt, error:oauth401 },
  ];
  assert.equal(antigravityTurnState(staleRows, nowMs).error, "", "stale transcript error predating resumed run.started must be ignored");
  assert.equal(antigravityTurnState(staleRows, 0).error, oauth401, "without since (importer), error is preserved");
  assert.equal(antigravityTurnState(staleRows, Date.parse(oldAt)).error, oauth401, "current-run error at/after since is preserved");

  // 2. End-to-end: Attempt 1 writes 401 to real transcript_full.jsonl; Attempt 2 succeeds on stdout BEFORE transcript updates -> finishes Done (not stopped with stale 401).
  const root = fresh("agy-stale-tx-"), home = path.join(root, "home"), script = path.join(root, "agy.js"), count = path.join(root, "count");
  const txFile = path.join(home, ".gemini", "antigravity-cli", "brain", "conv-stale-tx", ".system_generated", "logs", "transcript_full.jsonl");
  fs.mkdirSync(path.dirname(txFile), { recursive:true });
  fs.writeFileSync(script, `
const fs = require("fs");
const n = fs.existsSync(${JSON.stringify(count)}) ? Number(fs.readFileSync(${JSON.stringify(count)}, "utf8")) + 1 : 1;
fs.writeFileSync(${JSON.stringify(count)}, String(n));
const say = o => console.log(JSON.stringify(o));
let buffer = "";
process.stdin.on("data", d => {
  buffer += d; const parts = buffer.split("\\n"); buffer = parts.pop();
  if (!parts.length) return;
  say({ event:"init", conversation_id:"conv-stale-tx" });
  if (n === 1) {
    const oldAt = new Date(Date.now() - 5000).toISOString();
    fs.writeFileSync(${JSON.stringify(txFile)}, [
      JSON.stringify({ step_index:0, type:"USER_INPUT", source:"USER_EXPLICIT", status:"DONE", created_at:oldAt, content:"work" }),
      JSON.stringify({ step_index:1, type:"ERROR_MESSAGE", status:"ERROR", created_at:oldAt, error:${JSON.stringify(oauth401)} }),
    ].join("\\n") + "\\n");
    say({ event:"result", result:{ conversation_id:"conv-stale-tx", status:"ERROR", error:${JSON.stringify(oauth401)} } });
  } else {
    // Deliberately leave txFile still ending in Attempt 1's older 401 row to simulate delayed transcript flush.
    say({ event:"step_update", step_update:{ step_index:2, state:"DONE", step_type:"agent_response", text_delta:"Done on retry." } });
    say({ event:"result", result:{ conversation_id:"conv-stale-tx", status:"SUCCESS", response:"Done on retry." } });
  }
}).on("end", () => process.exit(n === 1 ? 1 : 0));`);
  const agents = createAgents({ env:{ PATH:"", AGY_CLI_PATH:script } });
  const service = new Service({ directory:fresh("state-stale-tx"), agents, autoWatch:false, conversations:{ home, env:{ HOME:home } } });
  t.after(() => service.close());
  const project = service.store.create({ name:"StaleTx", docsPath:fresh("docs-stale-tx"), codePath:null });
  project.defaultAgent = "antigravity";
  const asked = await service.request(project, { text:"Finish despite delayed transcript flush", topic:"new" });
  await until(() => !service.runs.size && !service.finishing.size && !service.startingWorks.size && ["done", "stopped"].includes(F.parseLine(service.readDoc(project, asked.slug)).status), "stale tx recovery");
  const doc = F.parseLine(service.readDoc(project, asked.slug));
  const detail = service.store.readText(project, F.detailPath(asked.slug, "work-1")).text;
  assert.equal(doc.status, "done", "Attempt 2 SUCCESS must not be failed by Attempt 1's stale transcript ERROR_MESSAGE");
  assert.equal(F.splitFront(detail).front["stop why"], undefined);
  assert.doesNotMatch(detail, /## Stopped/);
  assert.match(detail, /Done on retry\./);

  // 3. Watchdog-stuck transcript-only 401 triggers OAuth recovery (not UNSTUCK_NOTE) and finishes Done.
  const stuckRoot = fresh("agy-stuck-401-"), stuckDocs = path.join(stuckRoot, "docs");
  fs.mkdirSync(stuckDocs, { recursive:true });
  const stuckChildren = [], stuckInputs = [];
  const stuckAgents = {
    available: () => [{ id:"antigravity", available:true, name:"Antigravity" }],
    classifier: () => null,
    command: options => ({ command:"agy", args:[], cwd:options.workdir, stdin:true, input:"stream-json", dialect:"antigravity" }),
  };
  const stuckSpawn = () => {
    const idx = stuckChildren.length;
    stuckInputs[idx] = "";
    const child = Object.assign(new EventEmitter(), { pid:940001 + idx, stdout:new PassThrough(), stderr:new PassThrough(), stdin:new PassThrough(), killed:false });
    child.stdin.on("data", d => { stuckInputs[idx] += String(d); });
    child.kill = () => { child.killed = true; setImmediate(() => child.emit("close", 1)); };
    stuckChildren.push(child);
    return child;
  };
  const stuckSvc = new Service({ directory:path.join(stuckRoot, "state"), agents:stuckAgents, autoWatch:false, conversations:{ home:path.join(stuckRoot, "home"), env:{} }, spawnFn:stuckSpawn });
  t.after(() => { stuckSvc.runs.clear(); stuckSvc.close(); });
  stuckSvc.antigravityRunState = () => stuckChildren.length === 1
    ? { done:null, pending:false, pendingTasks:[], unansweredWakeup:false, error:oauth401 }
    : { done:{ answer:"Recovered after stuck 401.", at:Date.now() }, pending:false, pendingTasks:[], unansweredWakeup:false, error:"" };
  const stuckProj = stuckSvc.store.create({ name:"Stuck401", docsPath:stuckDocs, codePath:null });
  stuckProj.defaultAgent = "antigravity"; stuckSvc.store.save();
  const stuckLine = await stuckSvc.createTopic(stuckProj, { text:"Watchdog 401", agent:"antigravity", kinds:["ask", "work"], start:false });
  await stuckSvc.begin(stuckProj, stuckLine.slug);
  const run1 = stuckSvc.runs.get(stuckSvc.key(stuckProj, stuckLine.slug));
  stuckChildren[0].stdout.write(`${JSON.stringify({ event:"init", conversation_id:"conv-stuck-401" })}\n`);
  await wait(30);
  run1.ending = "stuck";
  stuckChildren[0].emit("close", 1);
  await until(() => stuckChildren.length === 2, "oauth retry launch after stuck 401");
  stuckChildren[1].stdout.write(`${JSON.stringify({ event:"init", conversation_id:"conv-stuck-401" })}\n`);
  stuckChildren[1].stdout.write(`${JSON.stringify({ event:"step_update", step_update:{ step_index:2, state:"DONE", step_type:"agent_response", text_delta:"Recovered after stuck 401." } })}\n`);
  stuckChildren[1].stdout.write(`${JSON.stringify({ event:"result", result:{ conversation_id:"conv-stuck-401", status:"SUCCESS", response:"Recovered after stuck 401." } })}\n`);
  await wait(30);
  stuckChildren[1].emit("close", 0);
  await until(() => !stuckSvc.runs.size && !stuckSvc.finishing.size && ["done", "stopped"].includes(F.parseLine(stuckSvc.readDoc(stuckProj, stuckLine.slug)).status), "stuck 401 finished");
  assert.equal(F.parseLine(stuckSvc.readDoc(stuckProj, stuckLine.slug)).status, "done");
  assert.match(stuckInputs[1] || "", /Google OAuth access token expired mid-run/, "stuck 401 must use OAuth recovery note, not UNSTUCK_NOTE");

  // 4. Restart / reattach preserves persisted `tail` (stderr-only 401) and `oauthRetry` budget (no extra immediate retry across restart).
  const keepRoot = fresh("agy-keep-401-"), keepState = path.join(keepRoot, "state"), keepDocs = path.join(keepRoot, "docs"), keepDir = path.join(keepRoot, "keep-1");
  fs.mkdirSync(keepState, { recursive:true }); fs.mkdirSync(keepDocs, { recursive:true }); fs.mkdirSync(keepDir, { recursive:true });
  const keepChildren = [];
  let spawnedAfterReattach = 0;
  const makeRetryChild = () => {
    spawnedAfterReattach++;
    const child = Object.assign(new EventEmitter(), { pid:960001 + spawnedAfterReattach, stdout:new PassThrough(), stderr:new PassThrough(), stdin:new PassThrough(), killed:false });
    child.kill = () => setImmediate(() => child.emit("close", 0));
    keepChildren.push(child);
    return child;
  };
  const fakeKeeper = {
    attach() {
      const child = Object.assign(new EventEmitter(), { pid:950001 + keepChildren.length, stdout:new PassThrough(), stderr:new PassThrough(), stdin:new PassThrough(), offsets:{ out:0, err:0 }, kept:true, dir:keepDir, closed:false, detach() {} });
      keepChildren.push(child);
      return child;
    },
    allocate(name) { return fs.mkdtempSync(path.join(keepRoot, `${name}-`)); },
    discardUnstarted() {},
    spawn: makeRetryChild,
    sweep() {},
  };
  const keepAgents = {
    available: () => [{ id:"antigravity", available:true, name:"Antigravity" }],
    classifier: () => null,
    command: options => ({ command:"agy", args:[], cwd:options.workdir, stdin:true, input:"stream-json", dialect:"antigravity" }),
  };
  const keepSvc = new Service({ directory:keepState, agents:keepAgents, autoWatch:false, conversations:{ home:path.join(keepRoot, "home"), env:{} }, spawnFn:makeRetryChild });
  keepSvc.keeper = fakeKeeper;
  t.after(() => { keepSvc.runs.clear(); keepSvc.close(); });
  const keepProj = keepSvc.store.create({ name:"Keep401", docsPath:keepDocs, codePath:null });
  keepProj.defaultAgent = "antigravity"; keepSvc.store.save();

  // Case 4a: Reattach with stderr-only 401 already saved in `tail` (past offsets.err) and NO prior retry -> triggers OAuth retry!
  const line4a = await keepSvc.createTopic(keepProj, { text:"Reattach stderr 401", agent:"antigravity", kinds:["ask", "work"], start:false });
  keepSvc.writeDoc(keepProj, line4a.slug, F.setFront(keepSvc.readDoc(keepProj, line4a.slug), { status:"working" }));
  fs.writeFileSync(path.join(keepDir, "out"), "");
  fs.writeFileSync(path.join(keepDir, "spec.json"), "{}"); // Its keeper was started: a folder with no launch in it is not attached to.
  fs.writeFileSync(path.join(keepDir, "run.json"), JSON.stringify({
    projectId:keepProj.id, slug:line4a.slug, mode:{ protocol:"plain", streaming:true }, attempt:"", offsets:{ out:0, err:200 },
    fields:{ agent:"antigravity", dialect:"antigravity", step:"Work 1", stepId:"work-1", kind:"work", session:"antigravity", sessionId:"conv-r1", started:Date.now() - 1000, log:path.join(keepRoot, "r1.log"), workdir:keepDocs, written:0, tail:`error: ${oauth401}\n`, said:"", failed:"", now:"Working" },
  }));
  assert.equal(keepSvc.reattach({ keep:keepDir }), true);
  keepChildren[keepChildren.length - 1].emit("close", 1);
  await until(() => spawnedAfterReattach === 1, "stderr-only 401 triggers retry after reattach");
  const retryChild = keepChildren[keepChildren.length - 1];
  retryChild.stdout.write(`${JSON.stringify({ event:"init", conversation_id:"conv-r1" })}\n`);
  retryChild.stdout.write(`${JSON.stringify({ event:"step_update", step_update:{ step_index:1, state:"DONE", step_type:"agent_response", text_delta:"Recovered after reattach." } })}\n`);
  retryChild.stdout.write(`${JSON.stringify({ event:"result", result:{ conversation_id:"conv-r1", status:"SUCCESS", response:"Recovered after reattach." } })}\n`);
  await wait(30);
  retryChild.emit("close", 0);
  await until(() => !keepSvc.runs.size && !keepSvc.finishing.size && ["done", "stopped"].includes(F.parseLine(keepSvc.readDoc(keepProj, line4a.slug)).status), "reattach 4a done");
  assert.equal(F.parseLine(keepSvc.readDoc(keepProj, line4a.slug)).status, "done");

  // Case 4b: Reattach with persisted `oauthRetry` inside cooldown -> immediate 401 stops honestly without spawning another retry!
  const keepDir2 = path.join(keepRoot, "keep-2");
  fs.mkdirSync(keepDir2, { recursive:true });
  const line4b = await keepSvc.createTopic(keepProj, { text:"Reattach budget cap", agent:"antigravity", kinds:["ask", "work"], start:false });
  keepSvc.writeDoc(keepProj, line4b.slug, F.setFront(keepSvc.readDoc(keepProj, line4b.slug), { status:"working" }));
  fs.writeFileSync(path.join(keepDir2, "out"), "");
  fs.writeFileSync(path.join(keepDir2, "spec.json"), "{}"); // Its keeper was started: a folder with no launch in it is not attached to.
  fs.writeFileSync(path.join(keepDir2, "run.json"), JSON.stringify({
    projectId:keepProj.id, slug:line4b.slug, mode:{ protocol:"plain", streaming:true }, attempt:"", offsets:{ out:0, err:200 },
    fields:{ agent:"antigravity", dialect:"antigravity", step:"Work 1", stepId:"work-1", kind:"work", session:"antigravity", sessionId:"conv-r2", started:Date.now() - 1000, log:path.join(keepRoot, "r2.log"), workdir:keepDocs, written:0, tail:`error: ${oauth401}\n`, said:"", failed:oauth401, lastFailed:true, oauthRetry:{ count:1, at:Date.now() - 1000 }, now:"Working" },
  }));
  assert.equal(keepSvc.reattach({ keep:keepDir2 }), true);
  keepChildren[keepChildren.length - 1].emit("close", 1);
  await until(() => !keepSvc.runs.size && !keepSvc.finishing.size && ["done", "stopped"].includes(F.parseLine(keepSvc.readDoc(keepProj, line4b.slug)).status), "reattach 4b stopped");
  assert.equal(spawnedAfterReattach, 1, "reattached run with recent oauthRetry must not grant another immediate retry");
  assert.equal(F.parseLine(keepSvc.readDoc(keepProj, line4b.slug)).status, "stopped");
});

test("syncRecent preserves historical timestamps on stopped Antigravity imports and marks TimerCondition-cancelled completed chats as done", async t => {
  const { DatabaseSync } = require("node:sqlite");
  const { pathToFileURL } = require("node:url");
  const dir = fresh("agy-hist-sync-");
  const docs = path.join(dir, "docs"), code = path.join(dir, "code"), state = path.join(dir, "state"), home = path.join(dir, "home");
  fs.mkdirSync(docs, { recursive:true }); fs.mkdirSync(code, { recursive:true }); fs.mkdirSync(state, { recursive:true });
  const agDesk = path.join(home, ".gemini", "antigravity");
  fs.mkdirSync(path.join(agDesk, "brain"), { recursive:true });
  const dbPath = path.join(agDesk, "conversation_summaries.db");
  const initDb = new DatabaseSync(dbPath);
  initDb.exec("CREATE TABLE conversation_summaries (conversation_id TEXT PRIMARY KEY, title TEXT, step_count INTEGER, last_modified_time TEXT, workspace_uris TEXT, status TEXT, source TEXT, parent_conversation_id TEXT, nesting_depth INTEGER, app_data_dir TEXT)");
  initDb.close();
  const writeTranscript = (baseDir, id, lines) => {
    const file = path.join(baseDir, "brain", id, ".system_generated", "logs", "transcript_full.jsonl");
    fs.mkdirSync(path.dirname(file), { recursive:true });
    fs.writeFileSync(file, lines.map(o => JSON.stringify(o)).join("\n") + "\n");
    return file;
  };
  const upsertSummary = (dbFile, row) => {
    const db = new DatabaseSync(dbFile);
    db.prepare("INSERT OR REPLACE INTO conversation_summaries (conversation_id, title, step_count, last_modified_time, workspace_uris, status, source, parent_conversation_id, nesting_depth, app_data_dir) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(row.id, row.title || "", row.steps || 1, row.at, JSON.stringify(row.uris || []), row.status || "CASCADE_RUN_STATUS_IDLE", row.source || "", row.parent || "", row.depth || 0, row.dir || "antigravity");
    db.close();
  };
  const uri = pathToFileURL(code).href;

  // 1. Historical USER_INPUT-only chat (no reply) from 2026-10-05: must stay stopped with Oct 5 timestamp, NOT Today.
  const noReplyAt = "2026-10-05T00:10:11Z";
  writeTranscript(agDesk, "hist-noreply", [
    { step_index:0, source:"USER_EXPLICIT", type:"USER_INPUT", status:"DONE", created_at:noReplyAt, content:"<USER_REQUEST>\nHistorical prompt without reply\n</USER_REQUEST>" },
  ]);
  upsertSummary(dbPath, {
    id:"hist-noreply", title:"Historical prompt without reply", at:noReplyAt, uris:[uri], status:"CASCADE_RUN_STATUS_IDLE", source:"CORTEX_TRAJECTORY_SOURCE_IDE", dir:"antigravity",
  });

  // 2. Historical pending-task chat from 2026-09-24: must stay stopped with Sep 24 timestamp, NOT Today.
  const pendStartAt = "2026-09-24T18:04:15Z", pendEndAt = "2026-09-24T18:06:53Z";
  writeTranscript(agDesk, "hist-pending", [
    { step_index:0, source:"USER_EXPLICIT", type:"USER_INPUT", status:"DONE", created_at:pendStartAt, content:"<USER_REQUEST>\nHistorical OCR task\n</USER_REQUEST>" },
    { step_index:1, source:"MODEL", type:"PLANNER_RESPONSE", status:"DONE", created_at:pendStartAt, tool_calls:[{ name:"run_command", args:{ CommandLine:"swift ocr.swift" } }] },
    { step_index:2, source:"MODEL", type:"GENERIC", status:"RUNNING", created_at:pendEndAt, content:"Tool is running as a background task with task id: hist-pending/task-25\nTask Description: swift ocr.swift" },
    { step_index:3, source:"MODEL", type:"PLANNER_RESPONSE", status:"DONE", created_at:pendEndAt, content:"Wait for OCR to finish." },
  ]);
  upsertSummary(dbPath, {
    id:"hist-pending", title:"Historical OCR task", at:pendEndAt, uris:[uri], status:"CASCADE_RUN_STATUS_IDLE", source:"CORTEX_TRAJECTORY_SOURCE_IDE", dir:"antigravity",
  });

  // 3. Historical completed chat with TimerCondition:"any" timer cancelled early by completed task (PE-7 / 1354ed2a pattern): must be Done with Oct 5 timestamps.
  const doneStartAt = "2026-10-04T23:57:14Z", doneEndAt = "2026-10-05T00:01:05Z";
  writeTranscript(agDesk, "hist-timer-done", [
    { step_index:0, source:"USER_EXPLICIT", type:"USER_INPUT", status:"DONE", created_at:doneStartAt, content:"<USER_REQUEST>\nDesign mobile screens\n</USER_REQUEST>" },
    { step_index:1, source:"MODEL", type:"PLANNER_RESPONSE", status:"DONE", created_at:"2026-10-04T23:59:41Z", tool_calls:[{ name:"run_command", args:{ CommandLine:"render png" } }] },
    { step_index:2, source:"MODEL", type:"GENERIC", status:"RUNNING", created_at:"2026-10-04T23:59:46Z", content:"Tool is running as a background task with task id: hist-timer-done/task-20\nTask Description: render png" },
    { step_index:3, source:"MODEL", type:"PLANNER_RESPONSE", status:"DONE", created_at:"2026-10-04T23:59:58Z", tool_calls:[{ name:"schedule", args:{ DurationSeconds:20, Prompt:"Check render", TimerCondition:"any" } }] },
    { step_index:4, source:"MODEL", type:"GENERIC", status:"RUNNING", created_at:"2026-10-05T00:00:00Z", content:"Tool is running as a background task with task id: hist-timer-done/task-24\nTask Description: Timer: 20s, Prompt: Check render" },
    { step_index:5, source:"SYSTEM", type:"SYSTEM_MESSAGE", status:"DONE", created_at:"2026-10-05T00:00:05Z", content:'<SYSTEM_MESSAGE>\n[Message] timestamp=2026-10-05T00:00:04Z sender=hist-timer-done/task-20 priority=MESSAGE_PRIORITY_HIGH content=Task id "hist-timer-done/task-20" finished with result:\nOK\n</SYSTEM_MESSAGE>' },
    { step_index:6, source:"MODEL", type:"PLANNER_RESPONSE", status:"DONE", created_at:doneEndAt, content:"All six screens are designed and rendered." },
  ]);
  upsertSummary(dbPath, {
    id:"hist-timer-done", title:"Design mobile screens", at:doneEndAt, uris:[uri], status:"CASCADE_RUN_STATUS_IDLE", source:"CORTEX_TRAJECTORY_SOURCE_IDE", dir:"antigravity",
  });

  const service = new Service({
    directory:state,
    agents:{ available:() => [], classifier:() => null },
    autoWatch:false,
    conversations:{ home, env:{ HOME:home }, idleMs:100 },
  });
  t.after(() => service.close());
  const project = service.store.create({ name:"HistCloud", docsPath:docs, codePath:code });
  const res = await service.syncRecent(project);
  assert.equal(res.added, 3);

  const st = service.stateOf(project);
  const byTitle = title => st.lines.find(l => l.title === title);

  const lNoReply = byTitle("Historical prompt without reply");
  assert.ok(lNoReply, "no-reply line imported");
  assert.equal(lNoReply.status, "stopped");
  assert.equal(lNoReply.lastActivityAt, Date.parse(noReplyAt), "stopped no-reply line keeps historical Oct 5 lastActivityAt");
  const dNoReply = F.splitFront(fs.readFileSync(path.join(docs, F.detailPath(lNoReply.slug, "work-1")), "utf8")).front;
  assert.equal(dNoReply.started, F.nowLabel(new Date(Date.parse(noReplyAt))));
  assert.equal(dNoReply["started at"], new Date(Date.parse(noReplyAt)).toISOString());
  assert.equal(service.activity.load(project, lNoReply.slug).rows.at(-1)?.at, Date.parse(noReplyAt));

  // Existing Work detail preserves its original started / started at on a later interruptWork call.
  const openStep = F.parseLine(service.readDoc(project, lNoReply.slug)).steps.find(s => s.id === "work-1");
  service.interruptWork(project, lNoReply.slug, openStep, "Later error", { started:Date.now() });
  const dNoReplyAfter = F.splitFront(fs.readFileSync(path.join(docs, F.detailPath(lNoReply.slug, "work-1")), "utf8")).front;
  assert.equal(dNoReplyAfter.started, F.nowLabel(new Date(Date.parse(noReplyAt))));
  assert.equal(dNoReplyAfter["started at"], new Date(Date.parse(noReplyAt)).toISOString());

  // ISO string `started` parses to an exact UTC instant (preserving offset & ms) and note->error upgrade honors historical `at`.
  const isoStart = "2026-10-05T00:10:11.321Z", isoFailAt = Date.parse("2026-10-05T00:12:00.000Z");
  const isoLine = await service.createTopic(project, { text:"ISO interrupt test", kinds:["ask", "work"], start:false, at:Date.parse(isoStart) });
  const isoStep = F.parseLine(service.readDoc(project, isoLine.slug)).steps.find(s => s.id === "work-1");
  service.activity.add(project, isoLine.slug, { kind:"note", text:"Stopped on historical note", step:"work-1", at:Date.now() });
  service.interruptWork(project, isoLine.slug, isoStep, "Stopped on historical note", { started:isoStart, at:isoFailAt });
  const isoDetail = F.splitFront(fs.readFileSync(path.join(docs, F.detailPath(isoLine.slug, "work-1")), "utf8")).front;
  assert.equal(isoDetail.started, F.nowLabel(new Date(Date.parse(isoStart))));
  assert.equal(isoDetail["started at"], isoStart);
  const isoStateLine = service.stateOf(project).lines.find(l => l.slug === isoLine.slug);
  assert.equal(isoStateLine?.stations.find(s => s.id === "work-1")?.startedAt, Date.parse(isoStart));
  assert.equal(isoStateLine?.lastActivityAt, Date.parse(isoStart));
  assert.equal(service.activity.load(project, isoLine.slug).rows.at(-1)?.at, isoFailAt, "note->error upgrade updates activity row timestamp to supplied historical at");

  // healLeftWorking preserves historical start and activity error timestamp from step activity rows.
  const healLine = await service.createTopic(project, { text:"Heal historical work", kinds:["ask", "work"], start:false, at:Date.parse(pendStartAt) });
  service.writeDoc(project, healLine.slug, F.setFront(service.readDoc(project, healLine.slug), { status:"working" }));
  service.activity.add(project, healLine.slug, { kind:"start", agent:"antigravity", step:"work-1", at:Date.parse(pendStartAt) });
  service.activity.add(project, healLine.slug, { kind:"say", text:"Working...", step:"work-1", at:Date.parse(pendEndAt) });
  const healEntry = service.store.scan(project).topics.find(x => x.slug === healLine.slug);
  healEntry.mtime = Date.now() - 120000;
  assert.equal(await service.healLeftWorking(project, healEntry), true);
  const healDetail = F.splitFront(fs.readFileSync(path.join(docs, F.detailPath(healLine.slug, "work-1")), "utf8")).front;
  assert.equal(healDetail["started at"], new Date(Date.parse(pendStartAt)).toISOString());
  assert.equal(service.activity.load(project, healLine.slug).rows.at(-1)?.at, Date.parse(pendEndAt));

  const lPending = byTitle("Historical OCR task");
  assert.ok(lPending, "pending-task line imported");
  assert.equal(lPending.status, "stopped");
  assert.equal(lPending.lastActivityAt, Date.parse(pendStartAt), "stopped pending-task line keeps historical Sep 24 lastActivityAt");
  const dPending = F.splitFront(fs.readFileSync(path.join(docs, F.detailPath(lPending.slug, "work-1")), "utf8")).front;
  assert.equal(dPending.started, F.nowLabel(new Date(Date.parse(pendStartAt))));
  assert.equal(dPending["started at"], new Date(Date.parse(pendStartAt)).toISOString());
  assert.equal(service.activity.load(project, lPending.slug).rows.at(-1)?.at, Date.parse(pendEndAt));

  const lDone = byTitle("Design mobile screens");
  assert.ok(lDone, "TimerCondition-completed line imported");
  assert.equal(lDone.status, "done", "completed chat with TimerCondition:'any' timer must settle as done, not stopped");
  assert.match(lDone.result.text, /All six screens are designed and rendered/);
  assert.equal(lDone.lastActivityAt, F.labelTime(F.nowLabel(new Date(Date.parse(doneEndAt)))), "completed line keeps historical Oct 5 lastActivityAt");
});
