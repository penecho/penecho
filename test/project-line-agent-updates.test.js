"use strict";
require("./helpers/safety.js");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const { createAgentUpdates:makeUpdates, claudeTag, compareVersions, installKind } = require("../src/server/project-lines/agent-updates.js");
const { updateAgent, runsIn, homebrewOf } = require("../src/server/project-lines/agent-self-update.js");
const { createAgentCheck } = require("../src/server/project-lines/agent-check.js");

const createAgentUpdates = options => makeUpdates({ claudeChannel:() => "stable", ...options });
const home = fs.mkdtempSync(path.join(os.tmpdir(), "pe-agent-updates-"));
after(() => fs.rmSync(home, { recursive:true, force:true }));
const TAGS = { "@anthropic-ai/claude-code":{ stable:"2.1.326", latest:"2.1.332" }, "@opencode/cli":{ latest:"2.4.1" }, "@earendil-works/pi-coding-agent":{ latest:"0.90.0" }, "@oh-my-pi/pi-coding-agent":{ latest:"19.1.1" } };
// A registry that knows three packages and counts what it is asked.
function registry(tags = TAGS) {
  const asked = [];
  const fetchImpl = async url => {
    asked.push(url);
    const pkg = /\/-\/package\/(.+)\/dist-tags$/.exec(url)?.[1];
    return tags[pkg] ? { ok:true, json:async () => tags[pkg] } : { ok:false, json:async () => ({}) };
  };
  return { fetchImpl, asked };
}

test("versions compare by number, and a suffix comes before the same version without one", () => {
  assert.ok(compareVersions("2.1.326", "2.1.300") > 0);
  assert.ok(compareVersions("1.19.6", "1.19.10") < 0);
  assert.ok(compareVersions("0.2.2", "0.2.2-rc.1") > 0);
  assert.ok(compareVersions("0.2.2-rc.5", "0.2.2-rc.1") > 0);
  assert.ok(compareVersions("19.1.1", "omp/19.0.1") > 0);
  assert.equal(compareVersions("2.1.300", "2.1.300 (Claude Code)"), 0);
  assert.equal(compareVersions("nonsense", "1.0.0"), 0);
});

test("a check learns the newest version, keeps it in a file, and is not repeated for a day and a half", async () => {
  const file = path.join(home, "first", "agent-updates.json"), { fetchImpl, asked } = registry();
  let at = 1_000_000_000_000;
  const updates = createAgentUpdates({ file, fetchImpl, now:() => at });
  assert.equal(updates.newer("claude", "2.1.300"), "", "nothing is known before the first check");
  assert.equal(await updates.refreshIfDue(), true);
  assert.equal(updates.newer("claude", "2.1.300"), "2.1.326", "the version of the channel Claude Code follows");
  assert.equal(updates.newer("claude", "2.1.330"), "", "a newer copy than the installer's is left alone");
  assert.equal(updates.newer("omp", "omp/19.0.1"), "19.1.1");
  assert.equal(updates.newer("dsh", "0.2.1"), "", "a package that gave no answer says nothing");
  const count = asked.length;
  at += 35 * 60 * 60 * 1000;
  assert.equal(await updates.refreshIfDue(), false);
  assert.equal(asked.length, count, "not asked again within 36 hours");
  // A new server reads the file and shows the result without asking.
  const again = createAgentUpdates({ file, fetchImpl, now:() => at });
  assert.equal(again.newer("opencode", "1.19.5"), "2.4.1");
  assert.equal(asked.length, count);
  at += 2 * 60 * 60 * 1000;
  assert.equal(await again.refreshIfDue(), true);
  assert.ok(asked.length > count, "asked again after 36 hours");
});

test("a check that fails is silent, keeps what was known, and waits six hours before the next try", async () => {
  const file = path.join(home, "offline", "agent-updates.json");
  fs.mkdirSync(path.dirname(file), { recursive:true });
  fs.writeFileSync(file, JSON.stringify({ checkedAt:1, triedAt:1, latest:{ claude:"2.1.326", unknown:"9.9.9", pi:"not a version" } }));
  let at = 1_000_000_000_000, calls = 0;
  const updates = createAgentUpdates({ file, fetchImpl:async () => { calls++; throw new Error("offline"); }, now:() => at });
  assert.equal(await updates.refreshIfDue(), false);
  assert.equal(updates.newer("claude", "2.1.300"), "2.1.326");
  const count = calls;
  at += 5 * 60 * 60 * 1000;
  await updates.refreshIfDue();
  assert.equal(calls, count, "not tried again within six hours");
  at += 2 * 60 * 60 * 1000;
  await updates.refreshIfDue();
  assert.ok(calls > count);
  // A file that cannot be written is no error either.
  const stuck = createAgentUpdates({ file:path.join(file, "inside-a-file.json"), fetchImpl:registry().fetchImpl, now:() => at });
  assert.equal(await stuck.refreshIfDue(), true);
  assert.equal(stuck.newer("claude", "2.1.300"), "2.1.326");
});

test("two pages opened at once start one check", async () => {
  const { fetchImpl, asked } = registry(), updates = createAgentUpdates({ file:path.join(home, "once", "agent-updates.json"), fetchImpl });
  await Promise.all([updates.refreshIfDue(), updates.refreshIfDue()]);
  assert.equal(asked.filter(url => url.includes("claude-code")).length, 1);
});

test("only the copy PenEcho's installer writes is updated by the app", () => {
  const bin = path.join(home, ".local", "bin");
  fs.mkdirSync(bin, { recursive:true });
  fs.writeFileSync(path.join(home, "claude-2.1.300"), "Ïú binary");
  fs.symlinkSync(path.join(home, "claude-2.1.300"), path.join(bin, "claude"));
  fs.writeFileSync(path.join(bin, "omp"), "#!/bin/zsh\nexec /somewhere/else/omp \"$@\"\n");
  const where = { home, platform:"darwin" };
  assert.equal(installKind("claude", path.join(bin, "claude"), where), "managed");
  assert.equal(installKind("omp", path.join(bin, "omp"), where), "own", "a wrapper script is the person's own");
  assert.equal(installKind("claude", "/opt/homebrew/bin/claude", where), "own");
  assert.equal(installKind("codex", path.join(bin, "codex"), where), "own");
  assert.equal(installKind("codex", "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex", where), "app");
  assert.equal(installKind("dsh", "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh", where), "app");
  assert.equal(installKind("kimi", path.join(bin, "kimi"), where), "", "an agent with no version to ask for");
  assert.equal(installKind("claude", "claude", where), "");
});

test("the agents page carries a newer version beside a working agent, and never as a problem", async () => {
  const bin = path.join(home, "page", ".opencode", "bin"), pageHome = path.join(home, "page"), piBin = path.join(pageHome, ".pi", "agent", "bin");
  fs.mkdirSync(bin, { recursive:true });
  fs.mkdirSync(piBin, { recursive:true });
  fs.writeFileSync(path.join(piBin, "pi"), "#!/usr/bin/env node\n");
  fs.writeFileSync(path.join(bin, "opencode"), "Ïú binary");
  const describe = () => [
    { id:"opencode", name:"OpenCode", mono:"Oc", color:"#333", launch:{ command:path.join(bin, "opencode"), prefixArgs:[] }, cli:"opencode", install:"curl -fsSL https://opencode.ai/v2/install | bash", configured:"", app:null },
    { id:"pi", name:"Pi", mono:"Pi", color:"#333", launch:{ command:path.join(piBin, "pi"), prefixArgs:[] }, cli:"pi", install:"", configured:"", app:null },
    { id:"claude", name:"Claude Code", mono:"Cl", color:"#333", launch:{ command:"/opt/homebrew/bin/claude", prefixArgs:[] }, cli:"claude", install:"curl -fsSL https://claude.ai/install.sh | bash", configured:"", app:null },
    { id:"codex", name:"Codex", mono:"Cx", color:"#333", launch:{ command:"/Applications/ChatGPT.app/Contents/Resources/codex", prefixArgs:[] }, cli:"codex", install:"", configured:"", app:null },
    { id:"omp", name:"omp", mono:"Om", color:"#333", launch:{ command:"/usr/local/bin/omp", prefixArgs:[] }, cli:"omp", install:"", configured:"", app:null },
  ];
  const versions = { opencode:"1.19.5", pi:"0.84.2", claude:"2.1.300 (Claude Code)", codex:"codex-cli 0.100.0", omp:"omp/19.1.1" };
  const run = async command => ({ status:0, stdout:versions[path.basename(command)], stderr:"", timedOut:false, missing:false });
  const tags = { ...TAGS, "@openai/codex":{ latest:"0.172.0" } };
  const updates = createAgentUpdates({ file:path.join(pageHome, "agent-updates.json"), fetchImpl:registry(tags).fetchImpl });
  const check = createAgentCheck({ describe, reset() {} }, { env:{ HOME:pageHome, PATH:"/usr/bin:/bin" }, run, updates });
  const first = await check.check();
  assert.ok(first.agents.every(a => !a.update), "the first answer does not wait for the check");
  await updates.refreshIfDue();
  const { agents, problems } = await check.check();
  const by = Object.fromEntries(agents.map(a => [a.id, a]));
  assert.equal(problems, 0);
  assert.ok(agents.every(a => a.state === "ready" && !a.problems.length));
  assert.deepEqual({ latest:by.pi.update.latest, auto:by.pi.update.auto }, { latest:"0.90.0", auto:true });
  assert.deepEqual({ latest:by.opencode.update.latest, auto:by.opencode.update.auto }, { latest:"2.4.1", auto:false }, "a new major version goes through an agent");
  assert.match(by.opencode.update.prompt, /Newest: 2\.4\.1 \(a new major version/);
  assert.deepEqual({ latest:by.claude.update.latest, auto:by.claude.update.auto }, { latest:"2.1.326", auto:true });
  assert.match(by.claude.update.prompt, /Installed: 2\.1\.300, run as \/opt\/homebrew\/bin\/claude/);
  assert.match(by.claude.update.prompt, /prints 2\.1\.326/);
  assert.equal(by.codex.update, undefined, "a command inside an app is updated with the app");
  assert.equal(by.omp.update, undefined, "an agent already on the newest version says nothing");
});

// A copy of an agent whose commands are answered here, with the version it prints after its updater ran.
function copy(id, { help = `  ${id} update   Update ${id}\n  ${id} upgrade`, before = "1.0.0", after = "1.0.1", status = 0, said = "" } = {}) {
  const ran = []; let updated = false;
  const run = async (command, args, options) => {
    ran.push({ command, args, cwd:options.cwd });
    if (args[0] === "--help") return { status:0, stdout:help, stderr:"" };
    if (args[0] === "--version") return { status:0, stdout:updated ? after : before, stderr:"" };
    updated = true;
    return { status, stdout:said, stderr:"", timedOut:false };
  };
  return { ran, run, agent:{ id, cli:id, launch:{ command:path.join(home, "copies", id), prefixArgs:[] } } };
}
const idle = { env:{ HOME:home, PATH:"/usr/bin:/bin" }, version:"1.0.0", kind:"own", lines:async () => ["/sbin/launchd", "node server.js"] };

test("an agent is updated with its own updater, in an empty folder, and only a newer version counts", async () => {
  const omp = copy("omp");
  assert.equal((await updateAgent(omp.agent, { ...idle, run:omp.run })).ok, true);
  assert.deepEqual(omp.ran.map(r => r.args[0]), ["--help", "update", "--version"]);
  assert.ok(omp.ran.every(r => path.basename(r.cwd).startsWith("penecho-update-") && !fs.existsSync(r.cwd)));
  const pi = copy("pi");
  await updateAgent(pi.agent, { ...idle, run:pi.run });
  assert.deepEqual(pi.ran[1].args, ["update", "--self"]);
  const same = copy("opencode", { after:"1.0.0", said:"\x1b[31mpermission denied\x1b[0m" }), failed = await updateAgent(same.agent, { ...idle, run:same.run });
  assert.deepEqual(failed, { ok:false, busy:false, said:"permission denied" });
});

test("an agent without an update command is never started with one", async () => {
  const codex = copy("codex", { help:"Usage: codex [PROMPT]\n  exec  Run" }), result = await updateAgent(codex.agent, { ...idle, run:codex.run });
  assert.equal(result.ok, false);
  assert.ok(!codex.ran.some(r => r.args.includes("update")));
  const dsh = copy("dsh"), installed = [];
  const done = await updateAgent(dsh.agent, { ...idle, run:dsh.run, kind:"managed", stateDir:home, install:async provider => { installed.push(provider); await dsh.run("npm", ["install"], {}); } });
  assert.deepEqual({ ok:done.ok, installed }, { ok:true, installed:["dsh-cli"] });
});

test("an agent in use is left alone, and so is one nobody can say is idle", { skip:process.platform === "win32" }, async () => {
  for (const line of ["omp --mode rpc", "/usr/bin/bun /opt/x/omp", `/bin/sh ${path.join(home, "copies", "omp")} -p`, "node /x/node_modules/@oh-my-pi/pi-coding-agent/cli.js"]) {
    const omp = copy("omp");
    assert.equal((await updateAgent(omp.agent, { ...idle, run:omp.run, lines:async () => [line] })).busy, true, line);
    assert.equal(omp.ran.length, 0);
  }
  const omp = copy("omp");
  assert.equal((await updateAgent(omp.agent, { ...idle, run:omp.run, lines:async () => null })).busy, true);
  assert.equal(runsIn("vim pineapple.txt", { id:"pi", command:"/a/pi", real:"/a/pi", cli:"pi" }), false);
  // Claude Code keeps each version in its own file.
  const versions = path.join(home, "share", "claude", "versions"), file = path.join(versions, "1.0.0"), link = path.join(home, "claude-link");
  fs.mkdirSync(versions, { recursive:true }); fs.writeFileSync(file, ""); fs.symlinkSync(file, link);
  const claude = copy("claude");
  claude.agent.launch.command = link;
  assert.equal((await updateAgent(claude.agent, { ...idle, run:claude.run, lines:async () => ["claude"] })).ok, true);
});

test("a Homebrew copy is updated by Homebrew", () => {
  assert.deepEqual(homebrewOf("/opt/homebrew/Cellar/opencode/1.2.3/bin/opencode"), { command:"/opt/homebrew/bin/brew", args:["upgrade", "opencode"] });
  assert.deepEqual(homebrewOf("/opt/homebrew/Caskroom/claude-code/2.1.3/claude"), { command:"/opt/homebrew/bin/brew", args:["upgrade", "--cask", "claude-code"] });
  assert.equal(homebrewOf("/Users/a/.local/share/claude/versions/2.1.3"), null);
});

// The Agents page over two agents, with an updater that answers as told.
async function page(name, answer) {
  const dir = path.join(home, name), versions = { omp:"19.0.1", opencode:"2.3.0", codex:"0.100.0" }, calls = [];
  fs.mkdirSync(dir, { recursive:true });
  const describe = () => Object.keys(versions).map(id => ({ id, name:id, mono:id, color:"#333", launch:{ command:`/usr/local/bin/${id}`, prefixArgs:[] }, cli:id, install:"", configured:"", app:null }));
  const run = async command => ({ status:0, stdout:versions[path.basename(command)], stderr:"", timedOut:false, missing:false });
  const updates = createAgentUpdates({ file:path.join(dir, "agent-updates.json"), fetchImpl:registry({ ...TAGS, "@openai/codex":{ latest:"0.172.0" } }).fetchImpl });
  await updates.refreshIfDue();
  const waits = [];
  const check = createAgentCheck({ describe, reset() {}, setUpdating:(id, job) => waits.push(job) }, { env:{ HOME:dir, PATH:"/usr/bin:/bin" }, run, updates,
    updater:async agent => { calls.push(agent.id); const result = answer(agent.id); if (result.ok) versions[agent.id] = TAGS["@oh-my-pi/pi-coding-agent"].latest; return result; } });
  return { check, updates, calls, waits, row:async id => (await check.check()).agents.find(a => a.id === id), file:path.join(dir, "agent-updates.json") };
}
const settle = async p => { for (let i = 0; i < 20; i++) { await Promise.all(p.waits); await new Promise(resolve => setImmediate(resolve)); } };

test("a click updates the agent, and one that fails gives the prompt with what was said", async () => {
  const good = await page("click", () => ({ ok:true, busy:false, said:"" }));
  await good.check.check();
  assert.deepEqual(good.calls, [], "nothing is updated unasked");
  const after = await good.check.update("omp");
  assert.equal(after.agents.find(a => a.id === "omp").version, "19.1.1");
  assert.equal(after.agents.find(a => a.id === "omp").update, undefined);
  const bad = await page("bad", () => ({ ok:false, busy:false, said:"EACCES: permission denied" }));
  const row = (await bad.check.update("omp")).agents.find(a => a.id === "omp");
  assert.equal(row.state, "ready", "a failed update is no problem of the agent");
  assert.equal(row.update.failed, true);
  assert.match(row.update.prompt, /What it said: EACCES: permission denied/);
  const busy = await page("busy", () => ({ ok:false, busy:true, said:"" })), held = await busy.check.update("omp");
  assert.equal(held.updateBusy, true);
  assert.equal(held.agents.find(a => a.id === "omp").update.failed, false);
});

test("a step to a new major version is never run", async () => {
  const p = await page("major", () => ({ ok:true, busy:false, said:"" }));
  await p.check.check();
  p.updates.newer = id => (id === "omp" ? "20.0.0" : "");
  await p.check.update("omp");
  await settle(p);
  assert.deepEqual(p.calls, []);
});

test("nothing is updated without a click, even where a setting kept from an earlier build says so, and a failed one stays known after a restart", async () => {
  const p = await page("unasked", () => ({ ok:false, busy:false, said:"no" })), kept = JSON.parse(fs.readFileSync(p.file, "utf8"));
  fs.writeFileSync(p.file, JSON.stringify({ ...kept, auto:true }));
  const updates = createAgentUpdates({ file:p.file, fetchImpl:async () => ({ ok:false }) }), calls = [];
  const check = createAgentCheck({ describe:() => [{ id:"omp", name:"omp", mono:"omp", color:"#333", launch:{ command:"/usr/local/bin/omp", prefixArgs:[] }, cli:"omp", install:"", configured:"", app:null }], reset() {} },
    { env:{ HOME:path.dirname(p.file), PATH:"/usr/bin:/bin" }, run:async () => ({ status:0, stdout:"19.0.1", stderr:"", timedOut:false, missing:false }), updates, updater:async agent => { calls.push(agent.id); return { ok:false, busy:false, said:"no" }; } });
  const first = await check.check();
  await check.check({ fresh:true });
  await settle({ waits:[] });
  assert.deepEqual(calls, []);
  assert.equal("autoUpdate" in first, false);
  assert.equal(first.agents[0].update.latest, "19.1.1");
  await check.update("omp");
  assert.deepEqual(calls, ["omp"]);
  const again = createAgentUpdates({ file:p.file, fetchImpl:async () => ({ ok:false }) });
  assert.equal(again.failed("omp", "19.1.1").said, "no");
  assert.equal(again.failed("omp", "19.1.2"), null);
});

test("Claude Code's newest version is the one of the channel its settings name", async () => {
  const folder = path.join(home, "channel");
  fs.mkdirSync(folder, { recursive:true });
  assert.equal(claudeTag({ CLAUDE_CONFIG_DIR:folder }), "latest");
  fs.writeFileSync(path.join(folder, "settings.json"), JSON.stringify({ autoUpdatesChannel:"stable" }));
  assert.equal(claudeTag({ CLAUDE_CONFIG_DIR:folder }), "stable");
  const updates = createAgentUpdates({ file:path.join(folder, "agent-updates.json"), fetchImpl:registry().fetchImpl, claudeChannel:() => "latest" });
  await updates.refreshIfDue();
  assert.equal(updates.newer("claude", "2.1.326"), "2.1.332");
});
