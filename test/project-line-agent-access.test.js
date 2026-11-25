"use strict";
require("./helpers/safety.js");
// PE-485: what each agent may do with nobody there to ask, and the Access choice of a saved agent.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const { createAgents, accessOf } = require("../src/server/project-lines/agents.js");
const { createAgentPresets } = require("../src/server/project-lines/agent-presets.js");
const { buildInstructions } = require("../src/server/project-lines/service.js");
const { checkCommand } = require("../src/server/agent-core/run-commands.js");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pe-agent-access-"));
after(() => fs.rmSync(temp, { recursive:true, force:true }));
let counter = 0;
const fresh = name => { const dir = path.join(temp, `${name}-${++counter}`); fs.mkdirSync(dir, { recursive:true }); return dir; };
// Each fake agent prints what it is given for --version and --help.
function fakeAgents(home, scripts) {
  const bin = path.join(home, "bin");
  fs.mkdirSync(bin, { recursive:true });
  for (const [id, body] of Object.entries(scripts)) fs.writeFileSync(path.join(bin, id), `#!/bin/sh\n${body}\n`, { mode:0o755 });
  return createAgents({ env:{ HOME:home, PATH:bin }, appFolders:[] });
}
const at = (args, flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const NEW_CLAUDE_HELP = 'echo \'  --permission-mode <mode>   Permission mode to use for the session\'; echo \'      (choices: "acceptEdits", "auto",\'; echo \'      "bypassPermissions", "manual", "dontAsk", "plan")\'';
const OLD_CLAUDE_HELP = 'echo \'  --permission-mode <mode>  (choices: "acceptEdits", "bypassPermissions", "default", "plan")\'';

test("Claude Code runs in auto mode where its help offers it, acceptEdits where not, and bypassPermissions with Full access", () => {
  const run = (script, options = {}) => {
    const home = fresh("home"), agents = fakeAgents(home, { claude:script });
    return agents.command("claude", { workdir:home, docs:home, also:[], ...options }).args;
  };
  const auto = run(NEW_CLAUDE_HELP);
  assert.equal(at(auto, "--permission-mode"), "auto", "its own reviewer decides each command");
  assert.match(at(auto, "--allowedTools"), /Bash\(git:\*\)/, "the everyday tools stay listed for a session that starts without auto");
  assert.doesNotMatch(at(auto, "--allowedTools"), /\b(?:Computer|ComputerUse|mcp__\*)\b/, "browser/computer-use and MCP tools are never blanket pre-approved without review");
  assert.ok(!auto.includes("--disallowedTools") && !auto.includes("--tools"), "work runs do not hide computer-use or MCP tools");
  assert.equal(at(run(OLD_CLAUDE_HELP), "--permission-mode"), "acceptEdits", "an older Claude Code would stop at an unknown choice");
  assert.equal(at(run("echo 1.0.0"), "--permission-mode"), "acceptEdits", "help that names no modes keeps the older one");
  assert.equal(at(run(NEW_CLAUDE_HELP, { access:"full" }), "--permission-mode"), "bypassPermissions");
});

test("Codex keeps the desktop default, and Full access drops its sandbox on both the app-server and codex exec", () => {
  const home = fresh("home"), agents = fakeAgents(home, { codex:"echo 1.0.0" });
  const normal = agents.command("codex", { workdir:home, docs:home, also:[] });
  assert.deepEqual([normal.thread.approvalPolicy, normal.thread.sandbox, normal.turn.sandboxPolicy.type], ["on-request", "workspace-write", "workspaceWrite"]);
  const full = agents.command("codex", { workdir:home, docs:home, also:[], access:"full" });
  assert.deepEqual([full.thread.approvalPolicy, full.thread.sandbox], ["never", "danger-full-access"]);
  assert.deepEqual(full.turn.sandboxPolicy, { type:"dangerFullAccess" });
  const plain = agents.command("codex", { workdir:home, docs:home, also:[], plain:true, access:"full" }).args;
  assert.equal(at(plain, "--sandbox"), "danger-full-access");
  assert.ok(!plain.includes("--add-dir"));
  const resumed = agents.command("codex", { workdir:home, docs:home, also:[], plain:true, access:"full", resume:"t1" }).args;
  assert.ok(resumed.includes('sandbox_mode="danger-full-access"') && !resumed.some(a => a.startsWith("sandbox_workspace_write")));

});

test("an orchestrator's Codex run may use the network, so its PenEcho calls need no approval; other runs keep it shut (PE-658)", () => {
  const home = fresh("home"), agents = fakeAgents(home, { codex:"echo 1.0.0" });
  const base = { workdir:home, docs:home, also:[] };
  assert.equal(agents.command("codex", base).turn.sandboxPolicy.networkAccess, false);
  const app = agents.command("codex", { ...base, network:true });
  assert.deepEqual([app.thread.approvalPolicy, app.thread.sandbox, app.turn.sandboxPolicy.type, app.turn.sandboxPolicy.networkAccess], ["on-request", "workspace-write", "workspaceWrite", true]);
  for (const resume of [null, "t1"]) {
    const on = agents.command("codex", { ...base, plain:true, network:true, resume }).args, off = agents.command("codex", { ...base, plain:true, resume }).args;
    assert.ok(on.includes("sandbox_workspace_write.network_access=true"), `codex exec${resume ? " resume" : ""}`);
    assert.ok(!off.includes("sandbox_workspace_write.network_access=true"));
  }
  assert.ok(!agents.command("codex", { ...base, plain:true, network:true, access:"full" }).args.some(a => a.startsWith("sandbox_workspace_write")), "Full access has no sandbox to open");
});

test("dsh uses danger-full-access by default on 0.2.2+, and Project folders restricts writes via workspace-write", () => {
  const home = fresh("home"), agents = fakeAgents(home, { dsh:"echo 0.2.2" });
  const normal = agents.command("dsh", { workdir:home, docs:home, also:[] });
  assert.deepEqual([at(normal.args, "--permission-mode"), at(normal.args, "--approval-policy")], ["danger-full-access", "never"]);
  assert.ok(!normal.args.includes("--add-dir"));
  assert.equal(normal.sandboxWindowsPath, false);
  const full = agents.command("dsh", { workdir:home, docs:home, also:[], access:"full" });
  assert.deepEqual([at(full.args, "--permission-mode"), at(full.args, "--approval-policy")], ["danger-full-access", "never"]);
  assert.equal(full.sandboxWindowsPath, false);
  const folders = agents.command("dsh", { workdir:home, docs:home, also:[], access:"folders" });
  assert.deepEqual([at(folders.args, "--permission-mode"), at(folders.args, "--approval-policy")], ["workspace-write", "never"]);
  assert.ok(folders.args.includes("--add-dir"));
  assert.equal(folders.sandboxWindowsPath, true);
  const old = fakeAgents(fresh("home"), { dsh:"echo 0.2.1" }).command("dsh", { workdir:home, docs:home, also:[], access:"full" }).args;
  assert.ok(!old.includes("--permission-mode"), "before 0.2.2 dsh takes no permission options at all");
});

test("dsh prefers a 0.2.2+ binary over an older 0.2.1 binary earlier on PATH unless DSH_CLI_PATH pins one", { skip:process.platform === "win32" }, () => {
  const home = fresh("dsh-multi"), oldDir = path.join(home, "old-bin"), newDir = path.join(home, ".local", "bin");
  fs.mkdirSync(oldDir, { recursive:true });
  fs.mkdirSync(newDir, { recursive:true });
  const oldBin = path.join(oldDir, "dsh"), newBin = path.join(newDir, "dsh");
  fs.writeFileSync(oldBin, "#!/bin/sh\necho 0.2.1-rc.2\n", { mode:0o755 });
  fs.writeFileSync(newBin, "#!/bin/sh\necho 0.2.2-rc.5\n", { mode:0o755 });
  const auto = createAgents({ env:{ HOME:home, PATH:oldDir }, appFolders:[] });
  assert.equal(auto.launch("dsh").command, newBin, "selects the updated 0.2.2+ dsh even when an older 0.2.1 sits earlier on PATH");
  assert.equal(at(auto.command("dsh", { workdir:home, docs:home, also:[] }).args, "--permission-mode"), "danger-full-access");
  const pinned = createAgents({ env:{ HOME:home, PATH:oldDir, DSH_CLI_PATH:oldBin }, appFolders:[] });
  assert.equal(pinned.launch("dsh").command, oldBin, "respects explicit DSH_CLI_PATH override");
});

test("only Claude Code, Codex and dsh offer alternate Access modes; dsh defaults to Full access", () => {
  assert.deepEqual(accessOf("claude"), { normal:"reviewed", full:true });
  assert.deepEqual(accessOf("codex"), { normal:"reviewed", full:true });
  assert.deepEqual(accessOf("dsh"), { normal:"full", full:true, folders:true });
  assert.deepEqual(accessOf("penecho"), { normal:"folders", full:false });
  for (const id of ["opencode", "pi", "omp", "kimi", "antigravity"]) assert.deepEqual(accessOf(id), { normal:"full", full:false });
  const home = fresh("home"), agents = fakeAgents(home, { claude:"echo 1.0.0", opencode:"echo 1.0.0", dsh:"echo 0.2.2" });
  assert.deepEqual(agents.describe().find(a => a.id === "claude").access, { normal:"reviewed", full:true }, "Settings learns each runner's choices");
  assert.deepEqual(agents.describe().find(a => a.id === "dsh").access, { normal:"full", full:true, folders:true });
});

test("a saved agent keeps its Access, names it, and hands non-default Access to its runner", () => {
  const home = fresh("home"), agents = fakeAgents(home, { claude:NEW_CLAUDE_HELP, codex:"echo 1.0.0", opencode:"echo 1.0.0", dsh:"echo 0.2.2" });
  const dshProfile = path.join(home, ".dsh", "profiles", "headless");
  fs.mkdirSync(dshProfile, { recursive:true });
  fs.writeFileSync(path.join(dshProfile, "package.json"), JSON.stringify({ dsh:{ profile:{ bundles:["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"] } } }));
  const presets = createAgentPresets({ file:path.join(fresh("state"), "agent-presets.json"), agents });
  const open = presets.add({ agent:"claude", model:"opus", access:"full" }), plain = presets.add({ agent:"codex", model:"gpt-6.1-sol" });
  const dshDefault = presets.add({ agent:"dsh", model:"deepseek-official/deepseek-v4-pro" });
  const dshLegacyFull = presets.add({ agent:"dsh", model:"deepseek-official/deepseek-flash", access:"full" });
  const dshFolders = presets.add({ agent:"dsh", model:"deepseek-official/deepseek-v4-pro", access:"folders" });
  assert.equal(open.access, "full");
  assert.equal(open.name, "Claude Code · opus · full access", "the name says it, so two saved agents never look the same");
  assert.equal(plain.access, "");
  assert.equal(dshDefault.access, "");
  assert.equal(dshDefault.name, "dsh · deepseek-official/deepseek-v4-pro");
  assert.equal(dshLegacyFull.access, "", "explicit full on dsh normalizes to its default");
  assert.equal(dshFolders.access, "folders");
  assert.equal(dshFolders.name, "dsh · deepseek-official/deepseek-v4-pro · project folders");
  assert.deepEqual(presets.handOver(presets.get(open.id)), { model:"opus", effort:"", access:"full" });
  assert.deepEqual(presets.handOver(presets.get(plain.id)), { model:"gpt-6.1-sol", effort:"" }, "no Access picked hands over nothing more");
  assert.deepEqual(presets.handOver(presets.get(dshDefault.id)), { model:"deepseek-official/deepseek-v4-pro", effort:"" });
  assert.deepEqual(presets.handOver(presets.get(dshFolders.id)), { model:"deepseek-official/deepseek-v4-pro", effort:"", access:"folders" });
  assert.equal(at(agents.command("claude", { workdir:home, docs:home, also:[], ...presets.handOver(presets.get(open.id)) }).args, "--permission-mode"), "bypassPermissions");
  assert.equal(at(agents.command("dsh", { workdir:home, docs:home, also:[], ...presets.handOver(presets.get(dshDefault.id)) }).args, "--permission-mode"), "danger-full-access");
  assert.equal(at(agents.command("dsh", { workdir:home, docs:home, also:[], ...presets.handOver(presets.get(dshFolders.id)) }).args, "--permission-mode"), "workspace-write");
  assert.equal(presets.update(open.id, { access:"" }).access, "", "back to the default");
  assert.equal(presets.update(open.id, { model:"sonnet" }).access, "", "an edit that leaves Access out keeps it");
  assert.throws(() => presets.add({ agent:"opencode", access:"full" }), /not a choice/, "OpenCode already runs every tool: nothing to pick");
  assert.throws(() => presets.add({ agent:"claude", access:"folders" }), /not a choice/, "Claude does not offer Project folders");
  assert.throws(() => presets.add({ agent:"claude", access:"root" }), /not a choice/);
});

test("agents keep their own computer-use and Playwright routes, with PenEcho headless only as the unasked fallback", () => {
  const ctx = { project:"Demo", docs:"/docs", code:false, slug:"a", base:"main", topicPath:"lines/a.md", detailPath:"works/a/work-1.md", words:"Fix it", files:[], said:[], note:"", moved:false, continuing:false };
  for (const agent of ["claude", "codex"]) {
    const told = buildInstructions({ ...ctx, agent }, { kind:"work" });
    assert.doesNotMatch(told, /one command per call|no &&/, agent);
    assert.match(told, /quote separator text such as "====="/, agent);
    // The whole routing is in .penecho/agent-help.md, which the one line points to (PE-916).
    assert.match(told, /Browser: use your own tools as the person asks/, agent);
    assert.match(told, /\/docs\/\.penecho\/agent-help\.md/, agent);
    const help = require("../src/server/project-lines/agent-help.js").text();
    assert.match(help, /opened Chrome, Edge or another browser for you/, agent);
    assert.match(help, /PenEcho does not block it/, agent);
    assert.match(help, /do not disturb their Chrome\/Edge window unasked/, agent);
    assert.match(help, /\$PENECHO_BROWSER_URL/, agent);
    assert.match(help, /\$PENECHO_BROWSER_HELPER/, agent);
    assert.match(help, /<name>\.png/, agent);
    assert.doesNotMatch(told, /never the person's own Chrome|Do not start a browser/i, agent);
  }
});

test("PenEcho's own agent may run the read-only programs real runs were refused", () => {
  for (const command of ["date", "which node", "sleep 2", "pwd", "uname -a", "jq .name package.json", "true"]) assert.ok(checkCommand(command, { cwd:temp }).ok, command);
  for (const command of ["sh -c ls", "rm -rf x", "env ls", "xargs rm"]) assert.equal(checkCommand(command, { cwd:temp }).ok, false, command);
});
