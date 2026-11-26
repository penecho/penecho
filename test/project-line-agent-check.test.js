"use strict";
require("./helpers/safety.js");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const { createAgentCheck, tryOne } = require("../src/server/project-lines/agent-check.js");
const { createAgents } = require("../src/server/project-lines/agents.js");

const home = fs.mkdtempSync(path.join(os.tmpdir(), "pe-agent-check-"));
after(() => fs.rmSync(home, { recursive:true, force:true }));
const env = { HOME:home, PATH:"/usr/bin:/bin", SHELL:"/bin/zsh" };
const claudeSignIn = { args:["auth", "status"], ok:({ stdout }) => JSON.parse(stdout).loggedIn, login:"claude auth login" };
const agent = (id, more = {}) => ({ id, name:id[0].toUpperCase() + id.slice(1), mono:id.slice(0, 2), color:"#333", launch:{ command:`/bin/${id}`, prefixArgs:[] }, cli:id, envVar:`${id.toUpperCase()}_CLI_PATH`, configured:"", install:"", installFrom:"", signIn:null, extraFolders:[], app:null, ...more });
const list = agents => ({ describe:() => agents, reset() { this.resets = (this.resets || 0) + 1; } });
// Answers by command and first argument, the way the real agents would.
function runner(answers) {
  const calls = [];
  const run = async (command, args) => { calls.push([command, ...args].join(" ")); const key = `${path.basename(command)} ${args[0] || ""}`.trim(); return { status:1, stdout:"", stderr:"", timedOut:false, missing:false, ...(answers[key] || {}) }; };
  return { run, calls };
}

test("a ready agent shows its version and sign-in, with nothing to fix", async () => {
  const { run } = runner({ "claude --version":{ status:0, stdout:"2.1.300 (Claude Code)\n" }, "claude auth":{ status:0, stdout:'{"loggedIn":true}' } });
  const { agents, problems } = await createAgentCheck(list([agent("claude", { signIn:claudeSignIn })]), { env, run }).check();
  assert.equal(problems, 0);
  assert.deepEqual({ state:agents[0].state, version:agents[0].version, signedIn:agents[0].signedIn, problems:agents[0].problems }, { state:"ready", version:"2.1.300", signedIn:true, problems:[] });
});

test("signed out is a problem, with the sign-in command and a prompt for another agent", async () => {
  const { run } = runner({ "claude --version":{ status:0, stdout:"2.1.300" }, "claude auth":{ status:1, stdout:'{"loggedIn":false}' } });
  const { agents, problems } = await createAgentCheck(list([agent("claude", { signIn:claudeSignIn })]), { env, run }).check();
  const [problem] = agents[0].problems;
  assert.equal(problems, 1);
  assert.equal(agents[0].state, "problem");
  assert.equal(problem.title, "Not signed in");
  assert.equal(problem.command, "claude auth login");
  assert.match(problem.prompt, /Claude has a problem/);
  assert.match(problem.prompt, /Run `claude auth login`/);
});

test("a sign-in check that gives no answer claims nothing", async () => {
  const { run } = runner({ "claude --version":{ status:0, stdout:"2.1.300" }, "claude auth":{ status:1, stdout:"", stderr:"network down" } });
  const { agents } = await createAgentCheck(list([agent("claude", { signIn:claudeSignIn })]), { env, run }).check();
  assert.equal(agents[0].signedIn, null);
  assert.equal(agents[0].state, "ready");
});

test("an agent that does not start says what it said", async () => {
  const { run } = runner({ "codex --version":{ status:1, stderr:"\u001b[31mdyld: Library not loaded\u001b[0m\nmore" } });
  const { agents } = await createAgentCheck(list([agent("codex")]), { env, run }).check();
  assert.equal(agents[0].state, "problem");
  assert.equal(agents[0].problems[0].title, "Found, but it does not start");
  assert.equal(agents[0].problems[0].detail, "dyld: Library not loaded");
  assert.match(agents[0].problems[0].prompt, /What it said: dyld: Library not loaded/);
});

test("a setting that names a missing file is said, even when the agent is found elsewhere", async () => {
  const { run } = runner({ "pi --version":{ status:0, stdout:"0.84.2" } });
  const { agents } = await createAgentCheck(list([agent("pi", { configured:"/nowhere/pi" })]), { env, run }).check();
  assert.equal(agents[0].state, "problem");
  assert.equal(agents[0].problems[0].title, "PI_CLI_PATH names a file that is not there");
});

test("a bad setting for an agent that is not installed stays a problem, and its prompt installs it", async () => {
  const { run } = runner({ "zsh -lc":{ status:1 } });
  const { agents, problems } = await createAgentCheck(list([agent("claude", { launch:null, configured:"/nonexistent" })]), { env, run }).check();
  assert.equal(problems, 1);
  assert.equal(agents[0].state, "problem");
  assert.deepEqual(agents[0].problems.map(p => p.title), ["CLAUDE_CLI_PATH names a file that is not there"]);
  assert.match(agents[0].problems[0].prompt, /installing it if it is not/);
});

test("a setting with a bare name, as the Canvas connection writes, is not a problem", async () => {
  const { run } = runner({ "codex --version":{ status:0, stdout:"codex-cli 0.166.0" } });
  const { agents } = await createAgentCheck(list([agent("codex", { configured:"codex" })]), { env, run }).check();
  assert.equal(agents[0].state, "ready");
  assert.equal(agents[0].version, "0.166.0");
});

test("installed where PenEcho does not look is a problem, not missing", async () => {
  fs.mkdirSync(path.join(home, ".npm-global", "bin"), { recursive:true });
  fs.writeFileSync(path.join(home, ".npm-global", "bin", "codex"), "");
  const { run, calls } = runner({});
  const { agents } = await createAgentCheck(list([agent("codex", { launch:null })]), { env, run }).check();
  assert.equal(agents[0].state, "problem");
  assert.equal(agents[0].problems[0].title, "Installed, but PenEcho cannot find it");
  assert.match(agents[0].problems[0].prompt, /installed at .*\.npm-global\/bin\/codex/);
  assert.match(agents[0].problems[0].prompt, /PenEcho looks for commands in: \/usr\/bin:\/bin/);
  assert.deepEqual(calls, []);
});

test("found by the login shell only counts outside PenEcho's PATH", async () => {
  const { run } = runner({ "zsh -lc":{ status:0, stdout:"/usr/bin/kimi\n" } });
  const { agents } = await createAgentCheck(list([agent("kimi", { launch:null })]), { env, run }).check();
  assert.equal(agents[0].state, "missing");
});

test("not installed is listed with an install prompt, and is not counted as a problem", async () => {
  const { run } = runner({ "zsh -lc":{ status:1 } });
  const { agents, problems } = await createAgentCheck(list([agent("opencode", { launch:null, install:"curl -fsSL https://opencode.ai/install | bash" })]), { env, run }).check();
  assert.equal(problems, 0);
  assert.equal(agents[0].state, "missing");
  assert.equal(agents[0].problems[0].command, "curl -fsSL https://opencode.ai/install | bash");
  assert.match(agents[0].problems[0].prompt, /Install it with `curl -fsSL https:\/\/opencode.ai\/install \| bash`/);
});

test("an app alone is ready to paste into, with a tip for runs; an old app gets a tip too", async () => {
  const { run } = runner({ "claude --version":{ status:0, stdout:"2.1.300" } });
  const { agents, problems } = await createAgentCheck(list([
    agent("kimi", { launch:null, app:{ name:"Kimi", version:"3.2.25", ok:true, opensNew:true, enough:true } }),
    agent("claude", { app:{ name:"Claude", version:"1.0", ok:false, opensNew:true, enough:false } }),
  ]), { env, run }).check();
  assert.equal(problems, 0);
  assert.equal(agents[0].state, "ready");
  assert.equal(agents[0].problems[0].title, "Runs from PenEcho need the kimi command");
  assert.equal(agents[1].state, "ready");
  assert.equal(agents[1].problems[0].title, "Update Claude to open conversations from PenEcho");
});

test("the check is kept a while, refreshes disk-backed model catalogs immediately, and Check again asks afresh", async () => {
  const at = fs.mkdtempSync(path.join(os.tmpdir(), "pe-agent-cache-refresh-"));
  try {
    fs.mkdirSync(path.join(at, ".codex"), { recursive:true });
    fs.writeFileSync(path.join(at, ".codex", "models_cache.json"), JSON.stringify({ models:[{ slug:"gpt-5.6-sol" }] }));
    const { run, calls } = runner({ "codex --version":{ status:0, stdout:"codex-cli 0.171.0" } });
    const agentList = list([agent("codex")]), check = createAgentCheck(agentList, { env:{ ...env, HOME:at }, run });
    const first = await check.check();
    assert.deepEqual(first.agents[0].model.choices, ["gpt-5.6-sol"]);
    fs.writeFileSync(path.join(at, ".codex", "models_cache.json"), JSON.stringify({ models:[{ slug:"gpt-6.2-sol" }, { slug:"gpt-5.6-sol" }] }));
    const cached = await check.check();
    assert.equal(calls.length, 1, "still reuses cached CLI version/login check within maxAge");
    assert.deepEqual(cached.agents[0].model.choices, ["gpt-6.2-sol", "gpt-5.6-sol"], "immediately reflects new models written by Codex app/CLI");
    await check.check({ fresh:true });
    assert.equal(calls.length, 2);
    assert.equal(agentList.resets, 1);
  } finally { fs.rmSync(at, { recursive:true, force:true }); }
});

test("the real list describes how to install and sign in, and a test's list never looks in apps", () => {
  const described = createAgents({ env:{ PATH:"", HOME:home, NODE_ENV:"test" } }).describe();
  const byId = Object.fromEntries(described.map(a => [a.id, a]));
  assert.equal(byId.claude.signIn.login, "claude auth login");
  assert.equal(byId.codex.signIn.login, "codex login");
  assert.equal(byId.claude.launch, null);
  assert.equal(byId.opencode.install, process.platform === "win32" ? "npm install -g @opencode/cli" : "curl -fsSL https://opencode.ai/v2/install | bash");
  for (const id of ["claude", "codex", "opencode", "pi", "omp", "dsh", "kimi", "antigravity"]) {
    assert.ok(byId[id].install, `${id} provides an install command for its install prompt`);
  }
  assert.equal(byId.codex.signIn.ok({ status:1, stdout:"", stderr:"Not logged in\n" }), false);
  assert.equal(byId.codex.signIn.ok({ status:1, stdout:"", stderr:"boom" }), null);
  assert.equal(byId.claude.signIn.ok({ status:0, stdout:'{"loggedIn":true}' }), true);

  // PenEcho-installed Kimi under stateDir/tools/kimi/bin is detected by Lines agents.
  const kimiState = fs.mkdtempSync(path.join(os.tmpdir(), "pe-kimi-managed-"));
  try {
    const managedKimi = path.join(kimiState, "tools", "kimi", "bin", process.platform === "win32" ? "kimi.exe" : "kimi");
    fs.mkdirSync(path.dirname(managedKimi), { recursive:true });
    fs.writeFileSync(managedKimi, "#!/bin/sh\n", { mode:0o755 });
    const withManaged = createAgents({ env:{ PATH:"", HOME:home, NODE_ENV:"test" }, paths:{ home, stateDir:kimiState } }).describe();
    const kimi = withManaged.find(a => a.id === "kimi");
    assert.equal(kimi.launch?.command, managedKimi);
  } finally { fs.rmSync(kimiState, { recursive:true, force:true }); }
});

test("each agent shows the model its own settings pick, and where to change it", async () => {
  const at = fs.mkdtempSync(path.join(os.tmpdir(), "pe-agent-model-")), put = (file, text) => { fs.mkdirSync(path.dirname(path.join(at, file)), { recursive:true }); fs.writeFileSync(path.join(at, file), text); };
  try {
    put(".codex/config.toml", 'model = "gpt-6.1-sol"\nmodel_reasoning_effort = "xhigh"\n\n[profiles.fast]\nmodel = "gpt-mini"\n');
    put(".config/opencode/opencode.json", '{\n  // mine\n  "$schema": "https://opencode.ai/config.json",\n  "model": "magpie/deepseek/deepseek-flash",\n}\n');
    put(".pi/agent/settings.json", '{"defaultProvider":"anthropic","defaultModel":"claude-opus-5-5"}');
    put(".kimi-code/config.toml", 'default_model = "kimi-k3"\n');
    put(".dsh/profiles/headless/package.json", JSON.stringify({ dsh:{ profile:{ bundles:["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"] } } }));
    const ids = ["claude", "codex", "opencode", "pi", "kimi", "dsh"];
    const answers = Object.fromEntries(ids.map(id => [`${id} --version`, { status:0, stdout:"1.0.0" }]));
    const { agents } = await createAgentCheck(list(ids.map(id => agent(id))), { env:{ ...env, HOME:at }, run:runner(answers).run }).check();
    const byId = Object.fromEntries(agents.map(a => [a.id, a.model]));
    // Nothing set for Claude Code is its own default.
    assert.equal(byId.claude.name, "");
    assert.match(byId.claude.change, /`\/model` in Claude Code, or set `"model"` in `~\/.claude\/settings.json`/);
    assert.deepEqual({ name:byId.codex.name, effort:byId.codex.effort, from:byId.codex.from }, { name:"gpt-6.1-sol", effort:"xhigh", from:"~/.codex/config.toml" });
    assert.equal(byId.opencode.name, "magpie/deepseek/deepseek-flash");
    assert.equal(byId.pi.name, "anthropic/claude-opus-5-5");
    assert.equal(byId.kimi.name, "kimi-k3");
    assert.equal(byId.dsh.name, "deepseek-official/deepseek-flash");
    assert.deepEqual(byId.dsh.choices, ["deepseek-official/deepseek-flash", "deepseek-official/deepseek-v4-pro"]);

    put(".claude/settings.json", '{"model":"opus"}');
    const later = await createAgentCheck(list([agent("claude")]), { env:{ ...env, HOME:at }, run:runner(answers).run }).check();
    assert.deepEqual({ name:later.agents[0].model.name, from:later.agents[0].model.from }, { name:"opus", from:"~/.claude/settings.json" });
    const fromEnv = await createAgentCheck(list([agent("claude")]), { env:{ ...env, HOME:at, ANTHROPIC_MODEL:"claude-sonnet-5-5" }, run:runner(answers).run }).check();
    assert.equal(fromEnv.agents[0].model.name, "claude-sonnet-5-5");
  } finally { fs.rmSync(at, { recursive:true, force:true }); }
});

test("an agent that is not installed has no model to show", async () => {
  const { agents } = await createAgentCheck(list([agent("codex", { launch:null })]), { env, run:runner({}).run }).check();
  assert.equal(agents[0].model, null);
});

test("dsh with no DeepSeek key anywhere is a problem, and the key DeepSeek Harness saved is enough", async () => {
  const at = fs.mkdtempSync(path.join(home, "dsh-"));
  const { run } = runner({ "dsh --version":{ status:0, stdout:"0.2.2\n" } });
  const none = await createAgentCheck(list([agent("dsh")]), { env:{ ...env, HOME:at }, run }).check();
  assert.equal(none.agents[0].state, "problem");
  assert.equal(none.agents[0].problems[0].title, "No DeepSeek key for runs from PenEcho");
  assert.match(none.agents[0].problems[0].prompt, /Do not make one up/);
  fs.mkdirSync(path.join(at, ".dsh"));
  fs.writeFileSync(path.join(at, ".dsh", ".credentials.yaml"), "refs:\n  DEEPSEEK_API_KEY: sk-test\n");
  assert.equal((await createAgentCheck(list([agent("dsh")]), { env:{ ...env, HOME:at }, run }).check()).agents[0].state, "ready");
  assert.equal((await createAgentCheck(list([agent("dsh")]), { env:{ ...env, DEEPSEEK_API_KEY:"sk-env" }, run }).check()).agents[0].state, "ready");
});

test("dsh older than 0.2.2 gets an update tip with command and prompt, and is not a problem for it", async () => {
  const { run } = runner({ "dsh --version":{ status:0, stdout:"0.2.1-rc.2\n" } });
  const old = await createAgentCheck(list([agent("dsh")]), { env:{ ...env, DEEPSEEK_API_KEY:"sk-env" }, run }).check();
  assert.equal(old.agents[0].state, "ready");
  assert.deepEqual(old.agents[0].problems.map(p => [p.kind, p.action, p.title]), [["tip", "update", "Update dsh to 0.2.2 or later"]]);
  assert.equal(old.agents[0].problems[0].command, "npm install -g @deepseek-ai/dsh@latest");
  assert.match(old.agents[0].problems[0].detail, /0\.2\.1-rc\.2.*0\.2\.2.*Full access/i);
  assert.match(old.agents[0].problems[0].prompt, /npm install -g @deepseek-ai\/dsh@latest/);
  const { run:newer } = runner({ "dsh --version":{ status:0, stdout:"0.2.2-rc.1\n" } });
  assert.deepEqual((await createAgentCheck(list([agent("dsh")]), { env:{ ...env, DEEPSEEK_API_KEY:"sk-env" }, run:newer }).check()).agents[0].problems, []);
});

// A stand-in for a started agent: it prints what it is given, and ends with the code given unless it hangs.
function fakeSpawn({ stdout = "", stderr = "", code = 0, hang = false }) {
  const { EventEmitter } = require("node:events");
  const seen = { words:"" };
  const spawnFn = (command, args, options) => {
    Object.assign(seen, { command, args, options });
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin = { on() {}, end(words) { seen.words = words; } };
    child.kill = () => setImmediate(() => child.emit("close", null));
    setImmediate(() => { child.stdout.emit("data", stdout); child.stderr.emit("data", stderr); if (!hang) child.emit("close", code); });
    return child;
  };
  return { spawnFn, seen };
}
const tryList = (agents, command) => ({ ...list(agents), command:() => command });
const piRun = runner({ "pi --version":{ status:0, stdout:"1.0.0\n" } }).run;

test("a test run that answers marks the agent, and its own words repeated back are no answer", async () => {
  const good = fakeSpawn({ stdout:'{"type":"message","text":"OK"}\n' });
  const ok = await createAgentCheck(tryList([agent("pi")], { command:"/bin/pi", args:["--mode", "json"], cwd:"/tmp", stdin:true }), { env, run:piRun, spawnFn:good.spawnFn }).tryRun("pi");
  assert.equal(ok.agents[0].tried.ok, true);
  assert.equal(ok.agents[0].state, "ready");
  assert.match(good.seen.words, /Reply with just the word OK/, "the words go on stdin");
  const echo = fakeSpawn({ stdout:`${JSON.stringify({ type:"user", text:good.seen.words })}\n` });
  const echoed = await createAgentCheck(tryList([agent("pi")], { command:"/bin/pi", args:[], cwd:"/tmp", stdin:true }), { env, run:piRun, spawnFn:echo.spawnFn }).tryRun("pi");
  assert.equal(echoed.agents[0].tried.ok, false);
});

// A stand-in for Pi in RPC mode: it reads JSON commands, and quits with code 0 as soon as stdin closes, answered or not.
function fakePiRpc({ answer = "OK", reject = "", dialog = false, retry = false } = {}) {
  const { EventEmitter } = require("node:events");
  const seen = { lines:[], ended:false };
  const spawnFn = () => {
    const child = new EventEmitter(), say = event => setImmediate(() => child.stdout.emit("data", `${JSON.stringify(event)}\n`));
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.kill = () => setImmediate(() => child.emit("close", null));
    child.stdin = { on() {}, end() { seen.ended = true; setImmediate(() => child.emit("close", 0)); }, write(text) {
      for (const line of text.split("\n").filter(Boolean)) {
        let command; try { command = JSON.parse(line); } catch { say({ type:"response", command:"parse", success:false, error:"Failed to parse command" }); continue; }
        seen.lines.push(command);
        if (command.type === "prompt") {
          if (reject) { say({ id:command.id, type:"response", command:"prompt", success:false, error:reject }); continue; }
          say({ id:command.id, type:"response", command:"prompt", success:true });
          if (dialog) { say({ type:"extension_ui_request", id:"d1", method:"confirm", title:"Go on?" }); continue; }
          const finish = () => {
            if (seen.ended) return;
            say({ type:"message_end", message:{ role:"assistant", content:[{ type:"text", text:answer }], stopReason:answer ? "stop" : "error", errorMessage:answer ? undefined : "No API key for provider" } });
            say({ type:"agent_end", ...(retry ? { isTerminal:true, yielded:true } : {}) });
          };
          if (retry) {
            say({ type:"message_end", message:{ role:"assistant", stopReason:"error", errorMessage:"Retrying the model" } });
            say({ type:"agent_end", isTerminal:false, yielded:false });
            setImmediate(finish);
          } else finish();
        }
        if (command.type === "extension_ui_response") {
          say({ type:"message_end", message:{ role:"assistant", content:[{ type:"text", text:"OK" }], stopReason:"stop" } });
          say({ type:"agent_end" });
        }
      }
    } };
    return child;
  };
  return { spawnFn, seen };
}

test("a test run of Pi in RPC mode sends a JSON prompt and keeps stdin open until the run ends", async () => {
  const rpc = { command:"/bin/pi", args:["--mode", "rpc"], cwd:"/tmp", stdin:true, input:"pi-rpc", dialect:"pi" };
  const good = fakePiRpc();
  assert.deepEqual(await tryOne(tryList([agent("pi")], rpc), "pi", { env, spawnFn:good.spawnFn }), { ok:true, said:"OK", error:"" });
  assert.equal(good.seen.lines.find(line => line.type === "prompt").message.includes("Reply with just the word OK"), true);
  assert.equal(good.seen.ended, true, "stdin closes once the run ends");
  const failed = await tryOne(tryList([agent("pi")], rpc), "pi", { env, spawnFn:fakePiRpc({ answer:"" }).spawnFn });
  assert.equal(failed.error, "No API key for provider");
  const rejected = await tryOne(tryList([agent("pi")], rpc), "pi", { env, spawnFn:fakePiRpc({ reject:"Model not found" }).spawnFn });
  assert.equal(rejected.error, "Model not found");
  const asked = fakePiRpc({ dialog:true });
  assert.equal((await tryOne(tryList([agent("pi")], rpc), "pi", { env, spawnFn:asked.spawnFn })).ok, true);
  assert.deepEqual(asked.seen.lines.find(line => line.type === "extension_ui_response"), { type:"extension_ui_response", id:"d1", cancelled:true }, "a dialog is cancelled, with nobody there to answer");
});

test("Agent Setup accepts OMP's successful reply after a retry", async () => {
  const { OMP_RPC_EVENT_FILTER } = require("../src/server/project-lines/activity.js");
  const rpc = { command:"/bin/omp", args:["--mode", "rpc-ui"], cwd:"/tmp", stdin:true, input:"pi-rpc", rpcEventFilter:OMP_RPC_EVENT_FILTER, dialect:"pi" };
  const checked = fakePiRpc({ retry:true });
  assert.deepEqual(await tryOne(tryList([agent("omp")], rpc), "omp", { env, spawnFn:checked.spawnFn }), { ok:true, said:"OK", error:"" });
  assert.equal(checked.seen.lines[0]?.type, "set_event_filter");
  assert.equal(checked.seen.lines[0]?.messageUpdates, "delta");
  const failed = fakePiRpc({ retry:true, answer:"" });
  assert.equal((await tryOne(tryList([agent("omp")], rpc), "omp", { env, spawnFn:failed.spawnFn })).error, "No API key for provider");

  // Older OMP without set_event_filter replies success:false for set_event_filter; Agent Setup still succeeds.
  const { EventEmitter } = require("node:events");
  const legacySpawn = () => {
    const child = new EventEmitter(), say = event => setImmediate(() => child.stdout.emit("data", `${JSON.stringify(event)}\n`));
    child.pid = 77711; child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.kill = () => setImmediate(() => child.emit("close", null));
    child.stdin = { on() {}, end() { setImmediate(() => child.emit("close", 0)); }, write(text) {
      for (const line of text.split("\n").filter(Boolean)) {
        const cmd = JSON.parse(line);
        if (cmd.type === "set_event_filter") say({ id:cmd.id, type:"response", command:"set_event_filter", success:false, error:"Unknown command: set_event_filter" });
        if (cmd.type === "prompt") {
          say({ id:cmd.id, type:"response", command:"prompt", success:true });
          say({ type:"message_end", message:{ role:"assistant", content:[{ type:"text", text:"OK" }], stopReason:"stop" } });
          say({ type:"agent_end" });
        }
      }
    } };
    return child;
  };
  assert.deepEqual(await tryOne(tryList([agent("omp")], rpc), "omp", { env, spawnFn:legacySpawn }), { ok:true, said:"OK", error:"" });

  // Silent code-1 exit surfaces matching ~/.omp/logs error.
  const ompHome = fs.mkdtempSync(path.join(home, "omp-log-"));
  const crashPid = 77712;
  const crashSpawn = () => {
    const child = new EventEmitter();
    child.pid = crashPid; child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.kill = () => {};
    child.stdin = { on() {}, end() {}, write() {
      const logDir = path.join(ompHome, ".omp", "logs");
      fs.mkdirSync(logDir, { recursive:true });
      const date = new Date().toISOString().slice(0, 10);
      fs.writeFileSync(path.join(logDir, `omp.${date}.${crashPid}.log`), JSON.stringify({ timestamp:new Date().toISOString(), level:"error", pid:crashPid, message:"RPC output delivery failed", error:"Error: ENOSPC: no space left on device, write" }) + "\n");
      setImmediate(() => child.emit("close", 1));
    } };
    return child;
  };
  const crashed = await tryOne(tryList([agent("omp")], rpc), "omp", { env:{ ...env, HOME:ompHome, USERPROFILE:ompHome }, spawnFn:crashSpawn });
  assert.equal(crashed.ok, false);
  assert.match(crashed.error, /RPC output delivery failed: Error: ENOSPC/);
});

test("omp's hint after its error keeps the error", async () => {
  const stderr = 'Model "x/y" not found\n\nRun `omp models find <pattern>` to search, or `omp models` to list all.\n';
  const failed = await createAgentCheck(tryList([agent("omp")], { command:"/bin/omp", args:[], cwd:"/tmp", stdin:true }), { env, run:piRun, spawnFn:fakeSpawn({ stderr, code:1 }).spawnFn }).tryRun("omp");
  assert.match(failed.agents[0].tried.error, /^Model "x\/y" not found — Run `omp models/);
});

test("a test run with a picked model and effort runs with them and leaves the agent's own test run alone", async () => {
  const good = fakeSpawn({ stdout:'{"type":"message","text":"OK"}\n' }), seen = [];
  const agents = { ...list([agent("pi")]), command:(id, options) => { seen.push(options); return { command:"/bin/pi", args:[], cwd:"/tmp", stdin:true }; } };
  const check = createAgentCheck(agents, { env, run:piRun, spawnFn:good.spawnFn });
  assert.deepEqual(await check.tryRun("pi", { model:" m1 ", effort:"high" }), { tried:{ ok:true, error:"" } });
  assert.deepEqual([seen[0].model, seen[0].effort], ["m1", "high"]);
  assert.equal((await check.check()).agents[0].tried, undefined);
  assert.match((await check.tryRun("pi", { model:"--yolo", effort:"" })).error, /does not start with a dash/);
  assert.match((await check.tryRun("pi", { model:"", effort:"high low" })).error, /one word/);
  assert.equal(seen.length, 1);
});

test("an agent that reads JSON lines is sent a user line, not bare words", async () => {
  const good = fakeSpawn({ stdout:'{"type":"result","subtype":"success","result":"OK"}\n' });
  const ok = await createAgentCheck(tryList([agent("claude")], { command:"/bin/claude", args:["-p", "--input-format", "stream-json"], cwd:"/tmp", stdin:true, input:"stream-json" }), { env, run:piRun, spawnFn:good.spawnFn }).tryRun("claude");
  assert.equal(ok.agents[0].tried.ok, true);
  const sent = JSON.parse(good.seen.words);
  assert.equal(sent.type, "user");
  assert.equal(sent.message.role, "user");
  assert.equal(sent.message.content[0].text, "This is a check from PenEcho that you can run. Reply with just the word OK. Do not use any tools.");
});

test("a harmless error item beside a real answer is not a failed run", async () => {
  const stdout = [
    '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Under-development features enabled: chronicle."}}',
    '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"OK"}}',
    '{"type":"turn.completed"}',
  ].join("\n") + "\n";
  const run = fakeSpawn({ stdout });
  const result = await createAgentCheck(tryList([agent("pi")], { command:"/bin/pi", args:["--mode", "json"], cwd:"/tmp", stdin:true }), { env, run:piRun, spawnFn:run.spawnFn }).tryRun("pi");
  assert.equal(result.agents[0].tried.ok, true);
  assert.equal(result.agents[0].state, "ready", "a harmless warning does not become a problem");
});

test("a top-level error event fails the run and its message is the detail", async () => {
  const stdout = [
    '{"type":"error","message":"model refused"}',
    '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"OK"}}',
  ].join("\n") + "\n";
  const run = fakeSpawn({ stdout });
  const result = await createAgentCheck(tryList([agent("codex")], { command:"/bin/codex", args:["exec"], cwd:"/tmp", stdin:true }), { env, run:piRun, spawnFn:run.spawnFn }).tryRun("codex");
  assert.equal(result.agents[0].tried.ok, false);
  assert.equal(result.agents[0].tried.error, "model refused");
});

test("a failed test run becomes a fix, with what the agent said in its prompt", async () => {
  const bad = fakeSpawn({ stdout:'{"type":"final","reason":{"kind":"error","error":{"message":"no API key for provider route","code":"MISSING_CREDENTIAL"}}}\n', code:1 });
  const failed = await createAgentCheck(tryList([agent("pi")], { command:"/bin/pi", args:["--prompt"], cwd:"/tmp", promptLast:true, env:{ SOME_SETTING:"1" } }), { env, run:piRun, spawnFn:bad.spawnFn }).tryRun("pi");
  const a = failed.agents[0];
  assert.equal(a.state, "problem");
  assert.equal(failed.problems, 1);
  assert.equal(a.tried.error, "no API key for provider route");
  assert.match(bad.seen.args.at(-1), /Reply with just the word OK/, "an agent that reads no stdin gets the words last");
  assert.equal(bad.seen.options.env.SOME_SETTING, "1");
  const p = a.problems.find(x => x.title === "A test run failed");
  assert.match(p.prompt, /What it said: no API key for provider route/);
  assert.match(p.prompt, /Settings PenEcho added for it: SOME_SETTING/);
});

test("a successful retry clears the startup warning and updates the problem count", async () => {
  const agents = tryList([agent("kimi"), agent("pi", { configured:path.join(home, "missing-pi") })], { command:"/bin/kimi", args:[], cwd:home, stdin:true });
  const { run } = runner({ "kimi --version":{ status:null, timedOut:true }, "pi --version":{ status:0, stdout:"1.0.0" } });
  let spawnFn = fakeSpawn({ stderr:"Model unavailable", code:1 }).spawnFn;
  const check = createAgentCheck(agents, { env, run, spawnFn:(...args) => spawnFn(...args) });
  const initial = await check.check();
  assert.equal(initial.agents[0].problems[0].detail, "No answer in 15 seconds.");
  assert.equal(initial.problems, 2);

  const failed = await check.tryRun("kimi");
  assert.equal(failed.agents[0].tried.ok, false);
  assert.deepEqual(failed.agents[0].problems.map(p => p.title), ["Found, but it does not start", "A test run failed"]);

  spawnFn = fakeSpawn({ stdout:"OK\n" }).spawnFn;
  const answered = await check.tryRun("kimi");
  assert.equal(answered.agents[0].tried.ok, true);
  assert.equal(answered.agents[0].state, "ready");
  assert.deepEqual(answered.agents[0].problems, []);
  assert.deepEqual(answered.agents[1].problems, initial.agents[1].problems);
  assert.equal(answered.problems, 1);
  assert.deepEqual((await check.check()).agents[0].problems, []);
});

test("an error on stderr is shown whole, not only the log path after it", async () => {
  const stderr = "\x1b[31merror: Model not configured\x1b[0m\n\nmessage:\nNo model is set for Kimi Code.\nSee log: C:/Users/msi/.kimi-code/logs/kimi-code.log\n";
  const failed = await createAgentCheck(tryList([agent("kimi")], { command:"/bin/kimi", args:["--prompt"], cwd:"/tmp", promptLast:true }), { env, run:piRun, spawnFn:fakeSpawn({ stderr, code:1 }).spawnFn }).tryRun("kimi");
  assert.equal(failed.agents[0].tried.error, "error: Model not configured — No model is set for Kimi Code. · See log: C:/Users/msi/.kimi-code/logs/kimi-code.log");
  const plain = await createAgentCheck(tryList([agent("pi")], { command:"/bin/pi", args:[], cwd:"/tmp", stdin:true }), { env, run:piRun, spawnFn:fakeSpawn({ stderr:"starting\nsomething broke\n", code:1 }).spawnFn }).tryRun("pi");
  assert.equal(plain.agents[0].tried.error, "something broke");
});

test("a test run with no answer says where it was waiting, and Check again forgets it", async () => {
  const slow = fakeSpawn({ stdout:'{"payload":{"baseURL":"http://192.168.3.32:11434/v1"}}\n', hang:true });
  const agents = tryList([agent("pi")], { command:"/bin/pi", args:[], cwd:"/tmp", stdin:true });
  const timed = await tryOne(agents, "pi", { env, spawnFn:slow.spawnFn, timeout:50 });
  assert.equal(timed.error, "No answer in 0 seconds. It was waiting on http://192.168.3.32:11434/v1.");
  const check = createAgentCheck(agents, { env, run:piRun, spawnFn:fakeSpawn({ stdout:"OK\n" }).spawnFn });
  assert.equal((await check.tryRun("pi")).agents[0].tried.ok, true);
  assert.equal((await check.check()).agents[0].tried.ok, true, "the last test run stays on the row");
  assert.equal((await check.check({ fresh:true })).agents[0].tried, undefined);
});

test("failed dsh Try diagnostics redact headers, saved keys, and standalone tokens", async () => {
  const dshHome = fs.mkdtempSync(path.join(home, "dsh-redaction-"));
  const saved = "fixture-saved-value-42", passed = "fixture-command-secret-43", commandOnly = "fixture-extra-credential-44";
  fs.writeFileSync(path.join(dshHome, ".credentials.yaml"), `refs:\n  CUSTOM_REF: ${saved}\n`);
  const command = { command:"dsh", args:[], env:{ CUSTOM_REF:passed, MORE:commandOnly }, cwd:home };
  const agents = tryList([agent("dsh")], command);
  const header = "header-placeholder-value", apiKey = "api-placeholder-value", basic = "Y2xpZW50OnRlc3Q=", token = "sk-standalone-token-marker";
  const stdout = JSON.stringify({ type:"error", message:`Provider refused Authorization: Bearer ${header}` }) + "\n";
  const stderr = `error: request failed with Basic ${basic}\nx-api-key: ${apiKey}\nEchoed ${saved}, ${passed}, ${commandOnly}; token ${token}\n`;
  for (const output of [stdout, ""]) {
    const { spawnFn } = fakeSpawn({ stdout:output, stderr, code:1 });
    const result = await tryOne(agents, "dsh", { env:{ ...env, DSH_HOME:dshHome }, runtimeDirectory:home, spawnFn });
    assert.equal(result.ok, false);
    assert.match(result.error, output ? /Provider refused/ : /request failed/);
    assert.match(result.problem.prompt, /Its last words on stderr/);
    for (const field of [result.error, result.problem.detail, result.problem.prompt]) {
      assert.match(field, /\[redacted\]/);
      for (const secret of [header, apiKey, basic, saved, passed, commandOnly, token]) assert.ok(!field.includes(secret), "a credential reached Settings");
    }
  }
});

test("dsh Try timeout diagnostics retain the endpoint and redact URL credentials", async () => {
  const url = "https://url-user-placeholder:url-password-placeholder@fixture.invalid/v1?api_key=url-query-placeholder&sig=url-signature-placeholder";
  const { spawnFn } = fakeSpawn({ stderr:JSON.stringify({ baseURL:url }).replaceAll("/", "\\/") + "\n", hang:true });
  const command = { command:"dsh", args:[], cwd:home };
  const result = await tryOne(tryList([agent("dsh")], command), "dsh", { env, runtimeDirectory:home, spawnFn, timeout:50 });
  assert.equal(result.error, "No answer in 0 seconds. It was waiting on https://fixture.invalid/v1.");
  for (const field of [result.error, result.problem.detail, result.problem.prompt]) assert.doesNotMatch(field, /url-\w+-placeholder/);
});
