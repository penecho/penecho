"use strict";
require("./helpers/safety.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const vm = require("node:vm");
const { createFolderPicker, commandFor } = require("../src/server/project-lines/pick-folder.js");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { createAgentCheck } = require("../src/server/project-lines/agent-check.js");

const ROOT = path.resolve(__dirname, "..");

function loadAgentProcess(crossSpawnStub, fakeProcess = process) {
  const file = path.join(ROOT, "src/server/project-lines/agent-process.js");
  const mod = { exports:{} };
  const fn = vm.runInThisContext(
    `(function(require, module, exports, __filename, __dirname, process) {\n${fs.readFileSync(file, "utf8")}\n})`,
    { filename:file },
  );
  fn(name => name === "cross-spawn" ? crossSpawnStub : require(name), mod, mod.exports, file, path.dirname(file), fakeProcess);
  return mod.exports;
}

test("Windows folder picker hides the PowerShell console window while showing the dialog", async () => {
  const env = { SystemRoot:"C:\\Windows" };
  const [command, args] = commandFor("win32", "Pick a folder", env);
  assert.equal(command, "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  assert.ok(args.includes("-WindowStyle"));
  assert.equal(args[args.indexOf("-WindowStyle") + 1], "Hidden");
  assert.ok(args.includes("-STA"));

  const [upperCmd] = commandFor("win32", "Pick a folder", { SYSTEMROOT:"D:\\Win" });
  assert.equal(upperCmd, "D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  const [windirCmd] = commandFor("win32", "Pick a folder", { windir:"E:\\Win" });
  assert.equal(windirCmd, "E:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");

  const seen = [];
  const picker = createFolderPicker({
    platform:"win32",
    env,
    run(cmd, cmdArgs, options, done) {
      seen.push({ cmd, cmdArgs, options });
      setImmediate(() => done(null, ""));
    },
  });
  const result = await picker.pick({ prompt:"Pick a folder" });
  assert.deepEqual(result, { canceled:true });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].cmd, "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  assert.equal(seen[0].options.windowsHide, true);

  const macSeen = [];
  const macPicker = createFolderPicker({
    platform:"darwin",
    run(cmd, cmdArgs, options, done) {
      macSeen.push({ cmd, options });
      setImmediate(() => done(null, ""));
    },
  });
  await macPicker.pick({ prompt:"Pick a folder" });
  assert.equal(macSeen[0].cmd, "osascript");
  assert.equal(macSeen[0].options.windowsHide, false);
});

test("Windows folder picker gives back Chinese names and drives, and falls back to the page when the dialog fails", async () => {
  const [, args] = commandFor("win32", "Pick a folder", { SystemRoot:"C:\\Windows" });
  assert.match(args.at(-1), /UTF8\.GetBytes\(\$dialog\.SelectedPath\)/);
  assert.doesNotMatch(args.at(-1), /Console\]::Out\.Write/);
  const statSync = fs.statSync, stat = [];
  fs.statSync = (file, ...rest) => {
    if (!/^[A-Z]:/.test(String(file))) return statSync(file, ...rest);
    stat.push(file);
    if (file.includes("\uFFFD")) throw Object.assign(new Error("missing"), { code:"ENOENT" });
    return { isDirectory:() => true };
  };
  try {
    const pick = (stdout, error = null) => createFolderPicker({ platform:"win32", env:{}, run:(c, a, o, done) => setImmediate(() => done(error, stdout)) }).pick();
    assert.deepEqual(await pick("C:\\Users\\msi\\托尔斯泰"), { path:"C:\\Users\\msi\\托尔斯泰" });
    assert.deepEqual(await pick("D:\\"), { path:"D:\\" });
    assert.deepEqual(await pick("D:\\code\\"), { path:"D:\\code" });
    assert.deepEqual(await pick("C:\\\uFFFD\uFFFD"), { unavailable:true });
    assert.deepEqual(await pick("", Object.assign(new Error("failed"), { code:1 })), { unavailable:true });
    assert.deepEqual(await pick("", Object.assign(new Error("timeout"), { killed:true })), { canceled:true });
    assert.deepEqual(await pick(""), { canceled:true });
    assert.deepEqual(stat.slice(0, 2), ["C:\\Users\\msi\\托尔斯泰", "D:\\"]);
  } finally { fs.statSync = statSync; }
});

test("agent-process spawn and spawnSync default windowsHide to true without overriding explicit false", () => {
  const calls = [];
  const stub = Object.assign(
    (command, ...rest) => { calls.push({ mode:"spawn", command, rest }); return { ok:true }; },
    { sync(command, ...rest) { calls.push({ mode:"sync", command, rest }); return { status:0 }; } },
  );
  const fakeProcess = {
    platform:"win32",
    execPath:"C:\\PenEcho\\PenEcho.exe",
    versions:{ electron:"35.0.0" },
    env:{ PATH:"C:\\Windows\\System32" },
  };
  const ap = loadAgentProcess(stub, fakeProcess);

  ap.spawn("codex.exe", ["--version"]);
  ap.spawn("codex.exe", ["--version"], { cwd:"C:\\work" });
  ap.spawn("codex.exe", ["--version"], { windowsHide:false });
  ap.spawn("codex.exe");
  ap.spawn(fakeProcess.execPath, ["script.js"], { cwd:"C:\\work" });
  ap.spawnSync("codex.exe", ["--version"]);
  ap.spawnSync("codex.exe", ["--version"], { windowsHide:false });
  ap.spawnSync("codex.exe");

  assert.equal(calls[0].rest[1].windowsHide, true);
  assert.equal(calls[1].rest[1].windowsHide, true);
  assert.equal(calls[1].rest[1].cwd, "C:\\work");
  assert.equal(calls[2].rest[1].windowsHide, false);
  assert.equal(calls[3].rest[0].windowsHide, true);
  assert.equal(calls[4].rest[1].windowsHide, true);
  assert.equal(calls[4].rest[1].env.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(calls[5].rest[1].windowsHide, true);
  assert.equal(calls[6].rest[1].windowsHide, false);
  assert.equal(calls[7].rest[0].windowsHide, true);
});

test("Windows helper spawns never combine detached:true with CREATE_NO_WINDOW or omit windowsHide", () => {
  const runtime = fs.readFileSync(path.join(ROOT, "src/server/canvas-agent/runtime.mjs"), "utf8");
  assert.doesNotMatch(runtime, /detached:\s*true\s*,\s*windowsHide:\s*true/, "runtime.mjs must not pass detached:true on win32");
  assert.match(runtime, /sqlite-reader-process\.mjs[\s\S]{0,220}detached:process\.platform !== 'win32'[\s\S]{0,80}windowsHide:true/);
  assert.match(runtime, /'--no-config', \.\.\.argv[\s\S]{0,180}detached:process\.platform !== 'win32'[\s\S]{0,80}windowsHide:true/);

  const shell = fs.readFileSync(path.join(ROOT, "src/server/agent-core/shell.mjs"), "utf8");
  assert.match(shell, /spawn\(argv\[0\], argv\.slice\(1\), \{ cwd, env, detached:process\.platform !== 'win32', windowsHide:true/);

  const keeper = fs.readFileSync(path.join(ROOT, "src/server/project-lines/agent-keeper.js"), "utf8");
  assert.match(keeper, /spawnSync\("taskkill\.exe", \["\/pid", String\(child\.pid\), "\/T", "\/F"\], \{ stdio:"ignore", windowsHide:true, shell:false \}\)/);
  assert.match(keeper, /crossSpawn\(spec\.command, spec\.args \|\| \[\], \{ cwd:spec\.cwd, env, stdio, detached:false, windowsHide:true \}\)/);

  const winProcs = fs.readFileSync(path.join(ROOT, "src/server/project-lines/windows-processes.js"), "utf8");
  assert.match(winProcs, /"-WindowStyle", "Hidden"/);
  assert.match(winProcs, /windowsHide:true/);

  const updater = fs.readFileSync(path.join(ROOT, "desktop/update-manager.js"), "utf8");
  assert.match(updater, /execFile\(command, args, \{ encoding:"utf8", maxBuffer:1024 \* 1024, windowsHide:true \}/);
});

test("Antigravity launches disable agy background auto-update across check, command, and answer paths", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pe-agy-env-"));
  try {
    const bin = path.join(dir, process.platform === "win32" ? "agy.exe" : "agy");
    fs.writeFileSync(bin, "#!/bin/sh\n", { mode:0o755 });
    const env = { HOME:dir, USERPROFILE:dir, PATH:dir, NODE_ENV:"test" };
    const agents = createAgents({ env, fromApps:false });

    const described = agents.describe().find(a => a.id === "antigravity");
    assert.equal(described.launch?.command, bin);
    assert.equal(described.launch?.env?.AGY_CLI_DISABLE_AUTO_UPDATE, "true");

    const cmd = agents.command("antigravity", { workdir:dir, docs:dir });
    assert.equal(cmd.env?.AGY_CLI_DISABLE_AUTO_UPDATE, "true");
    assert.equal(cmd.prepareEnv(env, cmd.env).AGY_CLI_DISABLE_AUTO_UPDATE, "true");

    const ans = agents.answerer("antigravity");
    assert.equal(ans.env?.AGY_CLI_DISABLE_AUTO_UPDATE, "true");
    assert.equal(ans.prepareEnv(env, ans.env).AGY_CLI_DISABLE_AUTO_UPDATE, "true");

    const seen = [];
    const check = createAgentCheck(agents, {
      env,
      run:async (command, args, opts) => {
        seen.push({ command, args, disableAutoUpdate:opts?.env?.AGY_CLI_DISABLE_AUTO_UPDATE });
        return { status:0, stdout:args.includes("models") ? "gemini-4-neon  Gemini 4 Neon\n" : "0.1.0\n", stderr:"", timedOut:false, missing:false };
      },
    });
    await check.check({ fresh:true });
    const agyCalls = seen.filter(entry => entry.command === bin);
    assert.equal(agyCalls.length, 2, "agent-check should probe both --version and models for Antigravity");
    for (const call of agyCalls) assert.equal(call.disableAutoUpdate, "true");
  } finally {
    fs.rmSync(dir, { recursive:true, force:true });
  }
});

test("Windows patched helpers execute cleanly without detached PowerShell breakage", { skip:process.platform !== "win32" }, async () => {
  const { spawnSync } = require("../src/server/project-lines/agent-process.js");
  const winProcs = require("../src/server/project-lines/windows-processes.js");
  const { createKeeper } = require("../src/server/project-lines/kept-child.js");
  const { runProjectShell } = await import(pathToFileURL(path.join(ROOT, "src/server/agent-core/shell.mjs")).href);

  const ps = path.win32.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const syncRes = spawnSync(ps, ["-NoProfile", "-WindowStyle", "Hidden", "-Command", "Write-Output 'agent-process-ok'"], { encoding:"utf8" });
  assert.equal(syncRes.status, 0, syncRes.stderr);
  assert.equal(syncRes.stdout.trim(), "agent-process-ok");

  const shellRes = await runProjectShell([ps, "-NoProfile", "-WindowStyle", "Hidden", "-Command", "Write-Output 'shell-ok'"], {
    cwd:os.tmpdir(),
    env:process.env,
    timeoutMs:15000,
  });
  assert.equal(shellRes.exitCode, 0, shellRes.stderr?.text);
  assert.equal(shellRes.stdout?.text?.trim(), "shell-ok");

  const rows = await winProcs.list();
  assert.ok(Array.isArray(rows) && rows.length > 0, "windows-processes list() should return running processes");
  const selfMeta = winProcs.meta(process.pid);
  assert.equal(selfMeta?.pid, process.pid);

  const keepRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pe-win-keep-"));
  try {
    const keeper = createKeeper({ root:keepRoot });
    const child = keeper.spawn(process.execPath, ["-e", "console.log('ready'); setInterval(() => {}, 1000);"], { cwd:os.tmpdir(), keepName:"win-kill" });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("kept child did not start")), 10000);
      child.stdout.on("data", buf => {
        if (String(buf).includes("ready")) { clearTimeout(timer); resolve(); }
      });
      child.on("error", err => { clearTimeout(timer); reject(err); });
    });
    const closed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("kept child did not close after kill")), 10000);
      child.once("close", (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
    });
    child.kill("SIGTERM");
    await closed;
  } finally {
    fs.rmSync(keepRoot, { recursive:true, force:true, maxRetries:15, retryDelay:100 });
  }
});
