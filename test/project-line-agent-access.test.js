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
const { Service, buildInstructions, buildPrompt, reviewedPermissionNote } = require("../src/server/project-lines/service.js");
const { CodexServer, runTurn, approvalReply, declined } = require("../src/server/project-lines/codex-server.js");
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

test("Codex defaults to Full access on both the app-server and codex exec, and Reviewed opts into its sandbox with auto_review", () => {
  const home = fresh("home"), agents = fakeAgents(home, { codex:"echo 1.0.0" });
  const normal = agents.command("codex", { workdir:home, docs:home, also:[] });
  assert.deepEqual([normal.thread.approvalPolicy, normal.thread.sandbox, normal.thread.approvalsReviewer], ["never", "danger-full-access", undefined]);
  assert.deepEqual(normal.turn.sandboxPolicy, { type:"dangerFullAccess" });
  assert.equal(normal.sandboxWindowsPath, false);
  const full = agents.command("codex", { workdir:home, docs:home, also:[], access:"full" });
  assert.deepEqual([full.thread.approvalPolicy, full.thread.sandbox], ["never", "danger-full-access"]);
  assert.deepEqual(full.turn.sandboxPolicy, { type:"dangerFullAccess" });
  assert.equal(full.sandboxWindowsPath, false);
  const reviewed = agents.command("codex", { workdir:home, docs:home, also:[], access:"reviewed" });
  assert.deepEqual([reviewed.thread.approvalPolicy, reviewed.thread.approvalsReviewer, reviewed.thread.sandbox, reviewed.turn.sandboxPolicy.type], ["on-request", "auto_review", "workspace-write", "workspaceWrite"]);
  assert.equal(reviewed.sandboxWindowsPath, true);
  const plain = agents.command("codex", { workdir:home, docs:home, also:[], plain:true }).args;
  assert.equal(at(plain, "--sandbox"), "danger-full-access");
  assert.ok(!plain.includes("--add-dir"));
  const resumed = agents.command("codex", { workdir:home, docs:home, also:[], plain:true, resume:"t1" }).args;
  assert.ok(resumed.includes('sandbox_mode="danger-full-access"') && !resumed.some(a => a.startsWith("sandbox_workspace_write")));
  const reviewedPlain = agents.command("codex", { workdir:home, docs:home, also:[], plain:true, access:"reviewed" }).args;
  assert.equal(at(reviewedPlain, "--sandbox"), "workspace-write");
  assert.ok(reviewedPlain.includes("--add-dir"));
  const reviewedResumed = agents.command("codex", { workdir:home, docs:home, also:[], plain:true, access:"reviewed", resume:"t1" }).args;
  assert.ok(reviewedResumed.includes('sandbox_mode="workspace-write"') && reviewedResumed.some(a => a.startsWith("sandbox_workspace_write.writable_roots=")));
});

test("an orchestrator's sandboxed Codex run may use the network, while Full access has no sandbox to open (PE-658)", () => {
  const home = fresh("home"), agents = fakeAgents(home, { codex:"echo 1.0.0" });
  const base = { workdir:home, docs:home, also:[] };
  assert.deepEqual(agents.command("codex", base).turn.sandboxPolicy, { type:"dangerFullAccess" });
  assert.equal(agents.command("codex", { ...base, access:"reviewed" }).turn.sandboxPolicy.networkAccess, false);
  const app = agents.command("codex", { ...base, access:"reviewed", network:true });
  assert.deepEqual([app.thread.approvalPolicy, app.thread.approvalsReviewer, app.thread.sandbox, app.turn.sandboxPolicy.type, app.turn.sandboxPolicy.networkAccess], ["on-request", "auto_review", "workspace-write", "workspaceWrite", true]);
  for (const resume of [null, "t1"]) {
    const on = agents.command("codex", { ...base, plain:true, access:"reviewed", network:true, resume }).args, off = agents.command("codex", { ...base, plain:true, access:"reviewed", resume }).args;
    assert.ok(on.includes("sandbox_workspace_write.network_access=true"), `codex exec${resume ? " resume" : ""}`);
    assert.ok(!off.includes("sandbox_workspace_write.network_access=true"));
  }
  assert.ok(!agents.command("codex", { ...base, plain:true, network:true }).args.some(a => a.startsWith("sandbox_workspace_write")), "default Full access has no sandbox to open");
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

test("only Claude Code, Codex and dsh offer alternate Access modes; Codex and dsh default to Full access", () => {
  assert.deepEqual(accessOf("claude"), { normal:"reviewed", full:true });
  assert.deepEqual(accessOf("codex"), { normal:"full", full:true, reviewed:true });
  assert.deepEqual(accessOf("dsh"), { normal:"full", full:true, folders:true });
  assert.deepEqual(accessOf("penecho"), { normal:"folders", full:false });
  for (const id of ["opencode", "pi", "omp", "kimi", "antigravity"]) assert.deepEqual(accessOf(id), { normal:"full", full:false });
  const home = fresh("home"), agents = fakeAgents(home, { claude:"echo 1.0.0", codex:"echo 1.0.0", opencode:"echo 1.0.0", dsh:"echo 0.2.2" });
  assert.deepEqual(agents.describe().find(a => a.id === "claude").access, { normal:"reviewed", full:true }, "Settings learns each runner's choices");
  assert.deepEqual(agents.describe().find(a => a.id === "codex").access, { normal:"full", full:true, reviewed:true });
  assert.deepEqual(agents.describe().find(a => a.id === "dsh").access, { normal:"full", full:true, folders:true });
});

test("a saved agent keeps its Access, names it, and hands non-default Access to its runner", () => {
  const home = fresh("home"), agents = fakeAgents(home, { claude:NEW_CLAUDE_HELP, codex:"echo 1.0.0", opencode:"echo 1.0.0", dsh:"echo 0.2.2" });
  const dshProfile = path.join(home, ".dsh", "profiles", "headless");
  fs.mkdirSync(dshProfile, { recursive:true });
  fs.writeFileSync(path.join(dshProfile, "package.json"), JSON.stringify({ dsh:{ profile:{ bundles:["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"] } } }));
  const presets = createAgentPresets({ file:path.join(fresh("state"), "agent-presets.json"), agents });
  const open = presets.add({ agent:"claude", model:"opus", access:"full" }), plain = presets.add({ agent:"codex", model:"gpt-6.1-sol" });
  const codexLegacyFull = presets.add({ agent:"codex", model:"gpt-6.1-sol", access:"full" });
  const codexReviewed = presets.add({ agent:"codex", model:"gpt-6.1-sol", access:"reviewed" });
  const dshDefault = presets.add({ agent:"dsh", model:"deepseek-official/deepseek-v4-pro" });
  const dshLegacyFull = presets.add({ agent:"dsh", model:"deepseek-official/deepseek-flash", access:"full" });
  const dshFolders = presets.add({ agent:"dsh", model:"deepseek-official/deepseek-v4-pro", access:"folders" });
  assert.equal(open.access, "full");
  assert.equal(open.name, "Claude Code · opus · full access", "the name says it, so two saved agents never look the same");
  assert.equal(plain.access, "");
  assert.equal(plain.name, "Codex · gpt-6.1-sol");
  assert.equal(codexLegacyFull.access, "", "explicit full on Codex normalizes to its default");
  assert.equal(codexReviewed.access, "reviewed");
  assert.equal(codexReviewed.name, "Codex · gpt-6.1-sol · reviewed");
  assert.equal(dshDefault.access, "");
  assert.equal(dshDefault.name, "dsh · deepseek-official/deepseek-v4-pro");
  assert.equal(dshLegacyFull.access, "", "explicit full on dsh normalizes to its default");
  assert.equal(dshFolders.access, "folders");
  assert.equal(dshFolders.name, "dsh · deepseek-official/deepseek-v4-pro · project folders");
  assert.deepEqual(presets.handOver(presets.get(open.id)), { model:"opus", effort:"", access:"full" });
  assert.deepEqual(presets.handOver(presets.get(plain.id)), { model:"gpt-6.1-sol", effort:"" }, "no Access picked hands over nothing more");
  assert.deepEqual(presets.handOver(presets.get(codexReviewed.id)), { model:"gpt-6.1-sol", effort:"", access:"reviewed" });
  assert.deepEqual(presets.handOver(presets.get(dshDefault.id)), { model:"deepseek-official/deepseek-v4-pro", effort:"" });
  assert.deepEqual(presets.handOver(presets.get(dshFolders.id)), { model:"deepseek-official/deepseek-v4-pro", effort:"", access:"folders" });
  assert.equal(at(agents.command("claude", { workdir:home, docs:home, also:[], ...presets.handOver(presets.get(open.id)) }).args, "--permission-mode"), "bypassPermissions");
  assert.equal(agents.command("codex", { workdir:home, docs:home, also:[], ...presets.handOver(presets.get(plain.id)) }).thread.sandbox, "danger-full-access");
  assert.deepEqual([
    agents.command("codex", { workdir:home, docs:home, also:[], ...presets.handOver(presets.get(codexReviewed.id)) }).thread.sandbox,
    agents.command("codex", { workdir:home, docs:home, also:[], ...presets.handOver(presets.get(codexReviewed.id)) }).thread.approvalsReviewer,
  ], ["workspace-write", "auto_review"]);
  assert.equal(at(agents.command("dsh", { workdir:home, docs:home, also:[], ...presets.handOver(presets.get(dshDefault.id)) }).args, "--permission-mode"), "danger-full-access");
  assert.equal(at(agents.command("dsh", { workdir:home, docs:home, also:[], ...presets.handOver(presets.get(dshFolders.id)) }).args, "--permission-mode"), "workspace-write");
  assert.equal(presets.update(open.id, { access:"" }).access, "", "back to the default");
  assert.equal(presets.update(open.id, { model:"sonnet" }).access, "", "an edit that leaves Access out keeps it");
  assert.throws(() => presets.add({ agent:"opencode", access:"full" }), /not a choice/, "OpenCode already runs every tool: nothing to pick");
  assert.throws(() => presets.add({ agent:"claude", access:"folders" }), /not a choice/, "Claude does not offer Project folders");
  assert.throws(() => presets.add({ agent:"codex", access:"folders" }), /not a choice/, "Codex offers Reviewed, not Project folders");
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

test("CodexServer retries thread/start without approvalsReviewer when an older Codex rejects it", async () => {
  const { CodexServer, runTurn } = require("../src/server/project-lines/codex-server.js");
  const script = path.join(fresh("old-codex"), "fake-codex.js");
  fs.writeFileSync(script, `
    let buf = "";
    const send = m => process.stdout.write(JSON.stringify(m) + "\\n");
    process.stdin.on("data", d => {
      buf += d;
      const lines = buf.split("\\n"); buf = lines.pop();
      for (const l of lines) {
        if (!l.trim()) continue;
        const m = JSON.parse(l);
        if (m.method === "initialize") send({ id:m.id, result:{} });
        else if (m.method === "thread/start") {
          if (m.params?.approvalsReviewer) send({ id:m.id, error:{ code:-32602, message:"unknown field \`approvalsReviewer\`" } });
          else send({ id:m.id, result:{ thread:{ id:"t-fallback" } } });
        } else if (m.method === "turn/start") {
          send({ id:m.id, result:{ turn:{ id:"turn-1" } } });
          send({ method:"turn/completed", params:{ threadId:"t-fallback", turn:{ id:"turn-1", status:"completed" } } });
        }
      }
    });
  `);
  const server = new CodexServer({ command:process.execPath, args:[script], cwd:temp });
  const outcome = await runTurn(server, {
    thread:{ cwd:temp, approvalPolicy:"on-request", approvalsReviewer:"auto_review", sandbox:"workspace-write" },
    turn:{ sandboxPolicy:{ type:"workspaceWrite", writableRoots:[temp], networkAccess:false } },
    input:"hi",
  });
  server.close();
  assert.equal(outcome.code, 0);
});

test("Reviewed mode user prompt grants project & doc folder read/write and outside-sandbox escalation", () => {
  const ctx = {
    project:"MyApp", docs:"/Users/test/Documents/PenEcho/MyApp", workdir:"/Users/test/code/myapp",
    code:true, slug:"fix-it", base:"main", topicPath:"lines/fix-it.md", detailPath:"works/fix-it/work-1.md",
    words:"Check the project", files:[], said:[], note:"", moved:false, continuing:false, agent:"codex", access:"reviewed",
  };
  const note = reviewedPermissionNote(ctx);
  assert.match(note, /read and write access to the project folder \(\/Users\/test\/code\/myapp\) and the project docs folder \(\/Users\/test\/Documents\/PenEcho\/MyApp\)/);
  assert.match(note, /outside the sandbox/);
  assert.match(note, /request escalated execution outside the sandbox/);

  const prompt = buildPrompt(ctx, { kind:"work" });
  assert.match(prompt, /Reviewed mode permissions:/);
  assert.doesNotMatch(prompt, /Nobody is watching this run/);

  const docsOnly = reviewedPermissionNote({ ...ctx, code:false, workdir:ctx.docs });
  assert.match(docsOnly, /read and write access to the project docs folder \(\/Users\/test\/Documents\/PenEcho\/MyApp\)/);
  assert.doesNotMatch(docsOnly, /the project folder \(/);

  assert.equal(reviewedPermissionNote({ ...ctx, access:"full" }), "");
  assert.equal(reviewedPermissionNote({ ...ctx, access:"" }), "");
  assert.match(buildPrompt({ ...ctx, access:"full" }, { kind:"work" }), /Nobody is watching this run/);
});

test("Codex interactive approval requests surface Allow / Allow for session / Deny cards, grant permissions, survive restart, and fail closed when unattended", async t => {
  const { EventEmitter } = require("node:events");
  const { PassThrough } = require("node:stream");
  const vm = require("node:vm");
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const makeChild = () => {
    const child = new EventEmitter();
    Object.assign(child, { pid:98100, stdout:new PassThrough(), stderr:new PassThrough(), stdin:new PassThrough(), sent:[] });
    let buf = "";
    child.stdin.on("data", chunk => {
      buf += String(chunk);
      const lines = buf.split("\n"); buf = lines.pop();
      for (const line of lines) if (line.trim()) child.sent.push(JSON.parse(line));
    });
    child.kill = () => { setImmediate(() => child.emit("close", 0)); };
    return child;
  };

  // Schema-valid reply mapping for every Codex approval method
  assert.deepEqual(approvalReply("item/commandExecution/requestApproval", "allow"), { decision:"accept" });
  assert.deepEqual(approvalReply("item/commandExecution/requestApproval", "allow_session"), { decision:"acceptForSession" });
  assert.deepEqual(approvalReply("item/commandExecution/requestApproval", "deny"), { decision:"decline" });
  assert.deepEqual(approvalReply("item/fileChange/requestApproval", "allow_session"), { decision:"acceptForSession" });
  const reqPerms = { fileSystem:{ read:["/proj"], write:["/proj", "/docs"] }, network:{ enabled:true } };
  assert.deepEqual(approvalReply("item/permissions/requestApproval", "allow", { permissions:reqPerms }), { permissions:reqPerms, scope:"turn" });
  assert.deepEqual(approvalReply("item/permissions/requestApproval", "allow_session", { permissions:reqPerms }), { permissions:reqPerms, scope:"session" });
  assert.deepEqual(approvalReply("item/permissions/requestApproval", "deny", { permissions:reqPerms }), { permissions:{}, scope:"turn" });
  assert.deepEqual(approvalReply("execCommandApproval", "allow_session"), { decision:"approved_for_session" });
  assert.deepEqual(approvalReply("applyPatchApproval", "deny"), declined("applyPatchApproval"));

  const root = fresh("codex-approval"), stateDir = path.join(root, "state"), docsDir = path.join(root, "docs");
  fs.mkdirSync(stateDir, { recursive:true });
  const service = new Service({ directory:stateDir, agents:fakeAgents(root, { codex:"echo 1.0.0" }), autoWatch:false });
  t.after(() => { service.runs.clear(); service.close(); });
  const project = service.store.create({ name:"CodexApprove", docsPath:docsDir });
  const created = await service.createTopic(project, { text:"Run reviewed", agent:"codex", kinds:["ask", "work"], start:false });
  const key = service.key(project, created.slug);

  const child = makeChild();
  const run = {
    agent:"codex", step:"Work 1", stepId:"work-1", launchId:"launch-cx-1", kind:"work",
    stopping:false, inputClosed:false, unattended:false, pendingRequests:new Map(), answeredRequestIds:new Set(),
    child,
  };
  const server = new CodexServer({
    child,
    onServerRequest:msg => service.handleCodexServerRequest(project, created.slug, run, server, msg),
    onApprovalRequest:msg => service.handleCodexApprovalRequest(project, created.slug, run, server, msg),
    onServerRequestResolved:rid => service.resolvePendingRequest(project, created.slug, run, String(rid), { state:"done", output:"Resolved" }),
  });
  run.server = server;
  service.runs.set(key, run);

  const findLine = () => { const st = service.stateOf(project); return [...st.lines, ...st.backlog].find(l => l.slug === created.slug); };

  // 1) Command execution outside sandbox -> held open, surfaced as approval card, answered Allow for session
  child.stdout.write(`${JSON.stringify({ id:41, method:"item/commandExecution/requestApproval", params:{ command:"Get-ChildItem C:\\proj", cwd:"C:\\proj", reason:"Sandbox failed to start; run outside the sandbox?" } })}\n`);
  await wait(25);
  assert.equal(child.sent.some(m => m.id === 41), false, "interactive approval must wait for user");
  let line = findLine();
  assert.equal(line.asking.id, "41");
  assert.equal(line.asking.approval, true);
  assert.equal(line.asking.toolName, "Run command outside sandbox");
  assert.deepEqual(line.asking.questions[0].options, ["Allow", "Allow for session", "Deny"]);
  await service.answer(project, created.slug, "approve-41", "allow_session", { requestId:"41" });
  assert.deepEqual(child.sent.find(m => m.id === 41), { id:41, result:{ decision:"acceptForSession" } });

  // 2) Additional permissions request (project & doc folder read/write) -> answered Allow for session grants requested permissions
  child.stdout.write(`${JSON.stringify({ id:42, method:"item/permissions/requestApproval", params:{ reason:"Grant project & docs read/write", permissions:reqPerms } })}\n`);
  await wait(25);
  line = findLine();
  assert.equal(line.asking.id, "42");
  assert.equal(line.asking.toolName, "Additional permissions");
  assert.match(line.asking.toolInput, /Write: \/proj, \/docs/);
  await service.answer(project, created.slug, "approve-42", "allow_session", { requestId:"42" });
  assert.deepEqual(child.sent.find(m => m.id === 42), { id:42, result:{ permissions:reqPerms, scope:"session" } });

  // 3) Restart persistence: restorePendingRequests rebinds held codex-approval
  child.stdout.write(`${JSON.stringify({ id:43, method:"item/fileChange/requestApproval", params:{ reason:"Write docs file", grantRoot:"/docs" } })}\n`);
  await wait(25);
  const serialized = service.serializePendingRequests(run);
  assert.equal(serialized.length, 1);
  assert.equal(serialized[0].protocol, "codex-approval");
  run.pendingRequests.clear();
  server.pendingServerRequests.clear();
  service.restorePendingRequests(project, created.slug, run, serialized, server);
  await service.answer(project, created.slug, "approve-43", "deny", { requestId:"43" });
  assert.deepEqual(child.sent.find(m => m.id === 43), { id:43, result:{ decision:"decline" } });

  // 4) Unattended sub-agent run fails closed immediately without prompting
  run.unattended = true;
  child.stdout.write(`${JSON.stringify({ id:44, method:"item/commandExecution/requestApproval", params:{ command:"dir", reason:"Run outside sandbox" } })}\n`);
  await wait(25);
  assert.deepEqual(child.sent.find(m => m.id === 44), { id:44, result:{ decision:"decline" } });
  assert.equal(run.pendingRequests.size, 0);

  // 5) UI approval card renders Allow / Allow for session / Deny for Codex and Allow / Deny for Claude
  const lineSrc = fs.readFileSync(path.join(__dirname, "../public/lines/line.js"), "utf8");
  const startIdx = lineSrc.indexOf("function askedHTML(l, s = null)");
  const endIdx = lineSrc.indexOf("function workWords(l, s)");
  const uiCtx = vm.createContext({
    S:{}, esc:v => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
    av:() => "", ic:() => "", agentInfo:id => ({ name:id === "codex" ? "Codex" : "Claude Code" }),
    project:() => ({ id:"p1" }), qDraftKey:() => "k", workAsking:(l, s) => s?.asking || l.asking, answerAct:() => "",
  });
  vm.runInContext(`${lineSrc.slice(startIdx, endIdx)}\nthis.askedHTML = askedHTML;`, uiCtx);
  const codexCard = uiCtx.askedHTML({ id:"l1", asking:{ id:"41", kind:"tool", answerable:true, approval:true, requestType:"approval", agent:"codex", toolName:"Run command outside sandbox", toolInput:"dir", questions:[{ id:"approve-41", options:["Allow", "Allow for session", "Deny"], optionValues:["allow", "allow_session", "deny"] }] } });
  assert.match(codexCard, /Codex wants permission to run command outside sandbox/);
  assert.match(codexCard, /data-a="allow">Allow</);
  assert.match(codexCard, /data-a="allow_session">Allow for session</);
  assert.match(codexCard, /data-a="deny">Deny</);
  const claudeCard = uiCtx.askedHTML({ id:"l1", asking:{ id:"c1", kind:"tool", answerable:true, approval:true, requestType:"approval", agent:"claude", toolName:"Bash", toolInput:"npm test", questions:[{ id:"approve-c1", options:["Allow", "Deny"], optionValues:["allow", "deny"] }] } });
  assert.match(claudeCard, /Claude Code wants permission to use Bash/);
  assert.match(claudeCard, /data-a="allow">Allow</);
  assert.doesNotMatch(claudeCard, /allow_session/);

  server.close();
});
