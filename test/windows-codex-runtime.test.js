"use strict";
require("./helpers/safety.js");

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const vm = require("node:vm");
const { createRequire } = require("node:module");

const {
  hasInaccessibleShellAlias,
  hasWindowsAppsPwshAlias,
  isSandboxUnsafeWindowsPathDir,
  isWindowsStoreAppsDir,
  prepareAgentEnv,
  resolveWindowsCmdShim,
} = require("../src/providers/agent-env.js");
const {
  findCodexInApp,
  parseAppxPackageKeys,
  parsePackageRootFolder,
  prepareCodexEnv,
  resetWindowsCodexAppCache,
  sanitizeCodexEnv,
} = require("../src/providers/codex-cli.js");
const { sanitizeClaudeEnv } = require("../src/providers/claude-cli.js");
const { sanitizeKimiEnv } = require("../src/providers/kimi-cli.js");
const { cliCandidates } = require("../src/providers/cli-discovery.js");
const { CodexServer } = require("../src/server/project-lines/codex-server.js");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { createAgentCheck, tryOne } = require("../src/server/project-lines/agent-check.js");
const { pickTopic } = require("../src/server/project-lines/router.js");
const { runAgent } = require("../src/server/project-lines/ask.js");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const { canvasBlock } = require("../src/server/project-lines/service.js");
const F = require("../src/server/project-lines/format.js");

function tempDir(t, prefix = "penecho-win-codex-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => { try { fs.rmSync(dir, { recursive:true, force:true, maxRetries:10, retryDelay:50 }); } catch {} });
  return dir;
}

function makeFile(root, rel, content = "") {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive:true });
  fs.writeFileSync(full, content);
  return full;
}

function fakeChildProcess() {
  const child = new EventEmitter();
  child.pid = 515151;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => { child.emit("close", 0, null); };
  child.unref = () => {};
  return child;
}

function loadWin32Module(entryFile, { execPath = "C:\\PenEcho\\PenEcho.exe", electron = "35.0.0" } = {}) {
  const cache = new Map();
  const proc = Object.create(process);
  Object.defineProperties(proc, {
    platform:{ value:"win32", enumerable:true },
    execPath:{ value:execPath, enumerable:true },
    versions:{ value:{ ...process.versions, ...(electron ? { electron } : { electron:undefined }) }, enumerable:true },
  });
  function load(filename) {
    filename = path.resolve(filename);
    if (cache.has(filename)) return cache.get(filename);
    const mod = { exports:{} }, localRequire = createRequire(filename);
    cache.set(filename, mod.exports);
    const requireMock = name => {
      if (name === "./agent-env.js") return load(localRequire.resolve(name));
      return localRequire(name);
    };
    requireMock.resolve = localRequire.resolve;
    vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
      require:requireMock,
      module:mod,
      exports:mod.exports,
      __filename:filename,
      __dirname:path.dirname(filename),
      process:proc,
      Buffer, setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, clearImmediate,
      URL, URLSearchParams, TextDecoder, TextEncoder, console,
    }, { filename });
    cache.set(filename, mod.exports);
    return mod.exports;
  }
  return load(entryFile);
}

test("prepareAgentEnv cleans dangling/empty TLS CA vars across all agents and OSes while preserving valid certs", t => {
  const root = tempDir(t);
  const validCa = makeFile(root, "valid-ca.pem", "-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n");
  const emptyCa = makeFile(root, "empty-ca.pem", "");
  const missingCa = path.join(root, "missing", "ca.pem");
  const validCaDir = path.join(root, "certs");
  const missingCaDir = path.join(root, "missing-certs");
  fs.mkdirSync(validCaDir, { recursive:true });

  const stripped = prepareAgentEnv({
    PATH:"/usr/bin",
    CODEX_CA_CERTIFICATE:missingCa,
    codex_ca_certificate:missingCa,
    SSL_CERT_FILE:missingCa,
    NODE_EXTRA_CA_CERTS:emptyCa,
    REQUESTS_CA_BUNDLE:missingCa,
    CURL_CA_BUNDLE:root,
    GIT_SSL_CAINFO:"   ",
    SSL_CERT_DIR:missingCaDir,
    KEEP_ME:"1",
  }, null, { platform:"win32" });
  assert.equal(stripped.CODEX_CA_CERTIFICATE, undefined);
  assert.equal(stripped.codex_ca_certificate, undefined);
  assert.equal(stripped.SSL_CERT_FILE, undefined);
  assert.equal(stripped.NODE_EXTRA_CA_CERTS, undefined);
  assert.equal(stripped.REQUESTS_CA_BUNDLE, undefined);
  assert.equal(stripped.CURL_CA_BUNDLE, undefined);
  assert.equal(stripped.GIT_SSL_CAINFO, undefined);
  assert.equal(stripped.SSL_CERT_DIR, undefined);
  assert.equal(stripped.KEEP_ME, "1");

  const kept = prepareAgentEnv({
    CODEX_CA_CERTIFICATE:validCa,
    SSL_CERT_FILE:validCa,
    NODE_EXTRA_CA_CERTS:validCa,
    REQUESTS_CA_BUNDLE:validCa,
    CURL_CA_BUNDLE:validCa,
    GIT_SSL_CAINFO:validCa,
    SSL_CERT_DIR:validCaDir,
  }, null, { platform:"win32" });
  assert.equal(kept.CODEX_CA_CERTIFICATE, validCa);
  assert.equal(kept.SSL_CERT_FILE, validCa);
  assert.equal(kept.NODE_EXTRA_CA_CERTS, validCa);
  assert.equal(kept.REQUESTS_CA_BUNDLE, validCa);
  assert.equal(kept.CURL_CA_BUNDLE, validCa);
  assert.equal(kept.GIT_SSL_CAINFO, validCa);
  assert.equal(kept.SSL_CERT_DIR, validCaDir);

  // Provider sanitizers (Codex, Claude, Kimi) all strip missing CA vars and keep valid ones.
  assert.equal(sanitizeCodexEnv({ PATH:"/bin", SSL_CERT_FILE:missingCa, NODE_EXTRA_CA_CERTS:missingCa }).SSL_CERT_FILE, undefined);
  assert.equal(sanitizeCodexEnv({ PATH:"/bin", SSL_CERT_FILE:validCa }).SSL_CERT_FILE, validCa);
  assert.equal(sanitizeClaudeEnv({ PATH:"/bin", NODE_EXTRA_CA_CERTS:missingCa, SSL_CERT_FILE:missingCa }).NODE_EXTRA_CA_CERTS, undefined);
  assert.equal(sanitizeClaudeEnv({ PATH:"/bin", NODE_EXTRA_CA_CERTS:validCa }).NODE_EXTRA_CA_CERTS, validCa);
  assert.equal(sanitizeKimiEnv({ PATH:"/bin", SSL_CERT_FILE:missingCa, NODE_EXTRA_CA_CERTS:missingCa }).SSL_CERT_FILE, undefined);
  assert.equal(sanitizeKimiEnv({ PATH:"/bin", SSL_CERT_FILE:validCa }).SSL_CERT_FILE, validCa);
});

test("prepareCodexEnv strips all Windows Store/MSIX WindowsApps and inaccessible shell aliases in sandbox mode while preserving Full Access", t => {
  const root = tempDir(t);
  const localWinApps = path.join(root, "Users", "alice", "AppData", "Local", "Microsoft", "WindowsApps");
  const msixPwshDir = path.join(root, "Program Files", "WindowsApps", "Microsoft.PowerShell_7.5.0.0_x64__8wekyb3d8bbwe");
  const customAliasDir = path.join(root, "CustomAliases");
  const msiPwsh = path.join(root, "Program Files", "PowerShell", "7");
  const sysRoot = path.join(root, "Windows");
  const sys32 = path.join(sysRoot, "System32");
  const winPs = path.join(sys32, "WindowsPowerShell", "v1.0");
  for (const dir of [localWinApps, msixPwshDir, customAliasDir, msiPwsh, sys32, winPs]) fs.mkdirSync(dir, { recursive:true });

  const pwshAlias = path.join(localWinApps, "pwsh.exe");
  const customBashAlias = path.join(customAliasDir, "bash.exe");
  fs.writeFileSync(pwshAlias, "");
  fs.writeFileSync(customBashAlias, "");

  // Simulate real Windows Store App Execution Alias behavior (statSync throws EACCES, lstatSync succeeds).
  const aliasSet = new Set([path.resolve(pwshAlias), path.resolve(customBashAlias)]);
  const simulatedFs = {
    statSync(target) {
      if (aliasSet.has(path.resolve(target))) {
        throw Object.assign(new Error("EACCES: permission denied"), { code:"EACCES" });
      }
      return fs.statSync(target);
    },
    lstatSync(target) {
      return fs.lstatSync(target);
    },
    accessSync(target, mode) {
      return fs.accessSync(target, mode);
    },
  };

  assert.equal(isWindowsStoreAppsDir(localWinApps), true);
  assert.equal(isWindowsStoreAppsDir(msixPwshDir), true);
  assert.equal(isWindowsStoreAppsDir(msiPwsh), false);
  assert.equal(hasWindowsAppsPwshAlias(localWinApps, simulatedFs), true);
  assert.equal(hasInaccessibleShellAlias(customAliasDir, simulatedFs), true);
  assert.equal(isSandboxUnsafeWindowsPathDir(msiPwsh, simulatedFs), false);

  // Sandboxed Codex strips Microsoft\WindowsApps, Program Files\WindowsApps\*, AND any dir with inaccessible shell aliases,
  // preserves non-Store PowerShell 7 + normal tools, ensures System32 + WindowsPowerShell\v1.0, and avoids duplicate Path/PATH keys.
  const cleaned = prepareCodexEnv({
    Path:`${localWinApps};${msixPwshDir};${customAliasDir};${msiPwsh};C:\\Tools`,
    SystemRoot:sysRoot,
  }, { CODEX_MANAGED_BY_NPM:"1" }, { platform:"win32", fs:simulatedFs });

  assert.equal(Object.keys(cleaned).filter(k => k.toLowerCase() === "path").length, 1, "must not duplicate Path/PATH keys");
  assert.equal(cleaned.PATH, undefined, "preserves original Path key casing");
  const dirs = cleaned.Path.split(";");
  assert.equal(dirs.includes(localWinApps), false, "Microsoft\\WindowsApps removed in sandbox mode");
  assert.equal(dirs.includes(msixPwshDir), false, "Program Files\\WindowsApps\\* removed in sandbox mode");
  assert.equal(dirs.includes(customAliasDir), false, "directory with inaccessible reparse shell alias removed");
  assert.equal(dirs.includes(msiPwsh), true, "non-Store PowerShell 7 kept");
  assert.equal(dirs.includes("C:\\Tools"), true, "other PATH entries kept");
  assert.equal(dirs.includes(sys32), true, "System32 ensured for curl.exe/cmd.exe");
  assert.equal(dirs.includes(winPs), true, "WindowsPowerShell fallback ensured");
  assert.equal(cleaned.CODEX_MANAGED_BY_NPM, "1");

  // Even when pwsh.exe is ABSENT from Microsoft\WindowsApps, WindowsApps is STILL stripped in sandbox mode
  // because Windows 10/11 ships default Store aliases (python.exe/python3.exe/bash.exe) there that also fail Error 5.
  fs.unlinkSync(pwshAlias);
  const withoutPwsh = prepareCodexEnv({
    Path:`${localWinApps};${sys32};${winPs};C:\\Tools`,
    SystemRoot:sysRoot,
  }, null, { platform:"win32", fs:simulatedFs });
  assert.deepEqual(withoutPwsh.Path.split(";"), [sys32, winPs, "C:\\Tools"]);

  // Full Access (sandboxWindowsPath: false) preserves WindowsApps so Store tools (winget/wt/Store pwsh/python) still work,
  // while still stripping dangling CA vars.
  const fullAccess = prepareCodexEnv({
    Path:`${localWinApps};C:\\Tools`,
    SystemRoot:sysRoot,
    CODEX_CA_CERTIFICATE:path.join(root, "missing.pem"),
  }, null, { platform:"win32", fs:simulatedFs, sandboxWindowsPath:false });
  assert.deepEqual(fullAccess.Path.split(";"), [localWinApps, "C:\\Tools"]);
  assert.equal(fullAccess.CODEX_CA_CERTIFICATE, undefined);

  // Does NOT alter PATH on darwin.
  const macEnv = prepareCodexEnv({ PATH:`${localWinApps}:/usr/bin` }, null, { platform:"darwin", fs:simulatedFs });
  assert.equal(macEnv.PATH, `${localWinApps}:/usr/bin`);
});

test("resolveWindowsCmdShim resolves pnpm, yarn, and scoop Windows shims without executing a shell and rejects arbitrary batch files", t => {
  const root = tempDir(t, "penecho-win-shims-");
  // pnpm layout: pnpm/codex.cmd -> pnpm/global/5/node_modules/@openai/codex/bin/codex.js + native vendor codex.exe
  const pnpmCodexJs = makeFile(root, "pnpm/global/5/node_modules/@openai/codex/bin/codex.js", "// codex\n");
  const pnpmCodexCmd = makeFile(root, "pnpm/codex.cmd", `@ECHO off\r\n"%_prog%"  "%dp0%\\global\\5\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n`);
  assert.equal(resolveWindowsCmdShim(pnpmCodexCmd, ["codex.js", "codex.exe"]), pnpmCodexJs);

  // scoop layout: scoop/shims/codex.cmd -> scoop/apps/codex/current/codex.exe
  const scoopCodexExe = makeFile(root, "scoop/apps/codex/current/codex.exe", "MZ");
  const scoopCodexCmd = makeFile(root, "scoop/shims/codex.cmd", `@"%~dp0\\..\\apps\\codex\\current\\codex.exe" %*\r\n`);
  assert.equal(resolveWindowsCmdShim(scoopCodexCmd, ["codex.js", "codex.exe"]), scoopCodexExe);

  // Empty / arbitrary / shell-injection batch file must be rejected cleanly.
  const emptyBat = makeFile(root, "bad/empty.bat", "");
  const evilBat = makeFile(root, "bad/evil.cmd", `@echo off\r\ncalc.exe & "%dp0%\\codex.exe|whoami"\r\n`);
  assert.equal(resolveWindowsCmdShim(emptyBat, ["codex.js", "codex.exe"]), null);
  assert.equal(resolveWindowsCmdShim(evilBat, ["codex.js", "codex.exe"]), null);

  // End-to-end through win32 resolveCodexLaunch (pnpm JS -> native codex.exe when vendor exists, else Electron Node mode; scoop -> codex.exe directly).
  const codexWin = loadWin32Module(path.join(__dirname, "../src/providers/codex-cli.js"));
  const pnpmLaunchJs = codexWin.resolveCodexLaunch(pnpmCodexCmd);
  assert.equal(pnpmLaunchJs.command, "C:\\PenEcho\\PenEcho.exe");
  assert.deepEqual(Array.from(pnpmLaunchJs.prefixArgs), [pnpmCodexJs]);
  assert.equal(pnpmLaunchJs.env.ELECTRON_RUN_AS_NODE, "1");

  const archPkg = process.arch === "arm64" ? "codex-win32-arm64" : "codex-win32-x64";
  const archTriple = process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  const pnpmNativeExe = makeFile(root, `pnpm/global/5/node_modules/@openai/codex/node_modules/@openai/${archPkg}/vendor/${archTriple}/bin/codex.exe`, "MZ");
  const pnpmLaunchNative = codexWin.resolveCodexLaunch(pnpmCodexCmd);
  assert.equal(pnpmLaunchNative.command, pnpmNativeExe);
  assert.deepEqual(Array.from(pnpmLaunchNative.prefixArgs), []);
  assert.equal(pnpmLaunchNative.env.CODEX_MANAGED_BY_NPM, "1");

  const scoopLaunch = codexWin.resolveCodexLaunch(scoopCodexCmd);
  assert.equal(scoopLaunch.command, scoopCodexExe);
  assert.deepEqual(Array.from(scoopLaunch.prefixArgs), []);

  assert.throws(() => codexWin.resolveCodexLaunch(emptyBat), /Windows batch wrappers are unsupported/);
});

test("Windows Codex discovery works across cli-discovery.js and agents.js for Store WindowsApps, HKCU registry, non-Store apps, and common user folders", async t => {
  const root = tempDir(t);
  const pf = path.join(root, "Program Files");
  const winAppsRoot = path.join(pf, "WindowsApps");
  const oldRoot = path.join(winAppsRoot, "OpenAI.Codex_26.1000.1.0_x64__2p2nqsd0c76g0");
  const newRoot = path.join(winAppsRoot, "OpenAI.Codex_26.1120.5083.0_x64__2p2nqsd0c76g0");
  makeFile(oldRoot, "app/resources/codex.exe", "old");
  const newExe = makeFile(newRoot, "app/resources/codex.exe", "new");

  // 1. Direct Program Files\WindowsApps scan finds newest OpenAI.Codex synchronously on first call (including via cli-discovery.js!).
  resetWindowsCodexAppCache();
  t.after(() => resetWindowsCodexAppCache());
  assert.equal(findCodexInApp({ ProgramFiles:pf }, { platform:"win32" }), newExe);

  const discovered = cliCandidates("codex-cli", {
    platform:"win32",
    home:path.join(root, "home"),
    stateDir:path.join(root, "state"),
    env:{ ProgramFiles:pf, PATH:"" },
  });
  assert.ok(discovered.some(c => c.executable === newExe && c.source === "system"), "cliCandidates discovers Windows Store OpenAI.Codex");

  // 2. Non-Store desktop app (%LOCALAPPDATA%\Programs\Codex\resources\codex.exe) is discovered directly too.
  const localAppData = path.join(root, "LocalAppData");
  const nonStoreExe = makeFile(localAppData, "Programs/Codex/resources/codex.exe", "exe");
  resetWindowsCodexAppCache();
  assert.equal(findCodexInApp({ LOCALAPPDATA:localAppData }, { platform:"win32" }), nonStoreExe);

  // 3. When Program Files\WindowsApps denies listing (EACCES), async HKCU registry lookup finds and caches newest package without blocking.
  const listOut = [
    "",
    "HKEY_CURRENT_USER\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppModel\\Repository\\Packages\\OpenAI.Codex_26.1000.1.0_x64__2p2nqsd0c76g0",
    "HKEY_CURRENT_USER\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppModel\\Repository\\Packages\\OpenAI.Codex_26.1120.5083.0_x64__2p2nqsd0c76g0",
    "End of search: 2 match(es) found.",
  ].join("\r\n");
  const keys = parseAppxPackageKeys(listOut);
  assert.equal(keys.length, 2);
  assert.match(keys[0], /26\.1120\.5083\.0/);
  assert.equal(parsePackageRootFolder(`    PackageRootFolder    REG_SZ    ${newRoot}\r\n`), newRoot);

  resetWindowsCodexAppCache();
  let foundPath = "";
  const mockRun = (cmd, args, _opts, cb) => {
    assert.equal(cmd, "reg.exe");
    setImmediate(() => {
      if (args.includes("/f")) cb(null, listOut, "");
      else if (args[1].includes("26.1120.5083.0")) cb(null, `    PackageRootFolder    REG_SZ    ${newRoot}\r\n`, "");
      else cb(null, `    PackageRootFolder    REG_SZ    ${oldRoot}\r\n`, "");
    });
  };
  assert.equal(findCodexInApp({}, { platform:"win32", run:mockRun, onFound:p => { foundPath = p; } }), null);
  await new Promise(r => setTimeout(r, 30));
  assert.equal(foundPath, newExe);
  assert.equal(findCodexInApp({}, { platform:"win32", run:() => assert.fail("should use cache") }), newExe);

  // 4. Official Windows standalone Codex (%LOCALAPPDATA%\Programs\OpenAI\Codex\bin\codex.exe) and other common user CLI directories
  //    (e.g. %LOCALAPPDATA%\pnpm) are discovered by cliCandidates when omitted from Desktop PATH, with official standalone preferred over %APPDATA%\npm.
  const pnpmExe = makeFile(localAppData, "pnpm/codex.exe", "MZ");
  const pnpmFound = cliCandidates("codex-cli", {
    platform:"win32",
    home:path.join(root, "home"),
    stateDir:path.join(root, "state"),
    env:{ LOCALAPPDATA:localAppData, PATH:"" },
  });
  assert.ok(pnpmFound.some(c => c.executable === pnpmExe), "discovers pnpm codex even when missing from PATH");

  const officialStandaloneExe = makeFile(localAppData, "Programs/OpenAI/Codex/bin/codex.exe", "MZ");
  const npmAppData = path.join(root, "RoamingAppData");
  const npmCodexCmd = makeFile(npmAppData, "npm/codex.cmd", "@echo off\r\n");
  const standaloneFound = cliCandidates("codex-cli", {
    platform:"win32",
    home:path.join(root, "home"),
    stateDir:path.join(root, "state"),
    env:{ LOCALAPPDATA:localAppData, APPDATA:npmAppData, PATH:"" },
  });
  assert.equal(standaloneFound[0]?.executable, officialStandaloneExe, "discovers official Windows standalone Codex first among standard folders");
  assert.ok(standaloneFound.some(c => c.executable === npmCodexCmd));

  // Explicit CODEX_CLI_PATH or NODE_ENV=test never falls back to app discovery.
  assert.equal(findCodexInApp({ CODEX_CLI_PATH:"/custom/codex" }, { platform:"win32" }), null);
  assert.equal(findCodexInApp({ NODE_ENV:"test", ProgramFiles:pf }, { platform:"win32" }), null);
  // "codex" alone, as a saved connection with no path says, picks none in particular.
  assert.equal(findCodexInApp({ CODEX_CLI_PATH:"codex" }, { platform:"win32" }), newExe);

  // 5. On Windows, agents.js prefers the official Codex Desktop App (Program Files\WindowsApps with BUILTIN\Users RX ACLs)
  //    over an %APPDATA%\npm wrapper when both exist, while still honoring explicit CODEX_CLI_PATH.
  if (process.platform === "win32") {
    const fakeAppData = path.join(root, "Users", "alice", "AppData", "Roaming");
    const npmDir = path.join(fakeAppData, "npm");
    const npmCmd = makeFile(npmDir, "codex.cmd", `@"%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n`);
    makeFile(npmDir, "node_modules/@openai/codex/bin/codex.js", "// npm codex\n");
    const archPkg = process.arch === "arm64" ? "codex-win32-arm64" : "codex-win32-x64";
    const archTriple = process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
    makeFile(npmDir, `node_modules/@openai/codex/node_modules/@openai/${archPkg}/vendor/${archTriple}/bin/codex.exe`, "MZ");

    resetWindowsCodexAppCache();
    const bothAgents = createAgents({ env:{ Path:npmDir, APPDATA:fakeAppData, ProgramFiles:pf }, platform:"win32", fromApps:true });
    assert.equal(bothAgents.launch("codex")?.command, newExe, "official Store Codex app preferred over %APPDATA%\\npm wrapper");

    const pinnedAgents = createAgents({ env:{ Path:npmDir, APPDATA:fakeAppData, ProgramFiles:pf, CODEX_CLI_PATH:npmCmd }, platform:"win32", fromApps:true });
    assert.notEqual(pinnedAgents.launch("codex")?.command, newExe, "explicit CODEX_CLI_PATH always wins");
  }
});

test("canvasBlock emits Windows PowerShell curl.exe and $env:TEMP on win32 and preserves POSIX commands on darwin/linux", () => {
  const ctx = {
    slug:"canvas-126",
    docs:"C:\\Users\\alice\\Documents\\PenEcho\\My Canvases",
    canvas:{
      project:"p123",
      name:"canvas-126",
      title:"Sketchpad",
      file:"C:\\Users\\alice\\Documents\\PenEcho\\My Canvases\\files\\canvas-126\\canvas.penecho.json",
      live:true,
      widgets:[],
    },
  };

  const winText = canvasBlock(ctx, { platform:"win32" });
  assert.match(winText, /curl\.exe -fsS "\$env:PENECHO_DRAW_URL" -H "x-penecho-token: \$env:PENECHO_DRAW_PASS"/);
  assert.match(winText, /-F "file=@\$env:TEMP\\<name>\.explorer\.html"/);
  assert.match(winText, /Set-Content -Encoding utf8/);
  assert.match(winText, /"\$\{env:PENECHO_DRAW_URL\}\?project=p123&canvas=canvas-126&view=1"/);
  assert.equal(winText.includes("file=@/tmp/"), false, "Windows prompt must never tell agents to write /tmp/");

  const posixText = canvasBlock(ctx, { platform:"darwin" });
  assert.match(posixText, /curl -fsS "\$PENECHO_DRAW_URL" -H "x-penecho-token: \$PENECHO_DRAW_PASS"/);
  assert.match(posixText, /-F file=@\/tmp\/<name>\.explorer\.html/);
});

test("CodexServer, agents.js (Codex + Claude), ask.js, router.js, and agent-check.js strip missing CA vars and toggle WindowsApps for Full Access", async t => {
  const root = tempDir(t);
  const missingCa = path.join(root, "gone", "ca.pem");
  const fakeCodex = makeFile(root, process.platform === "win32" ? "bin/codex.exe" : "bin/codex", "#!/bin/sh\n");
  const fakeClaude = makeFile(root, process.platform === "win32" ? "bin/claude.exe" : "bin/claude", "#!/bin/sh\n");
  fs.chmodSync(fakeCodex, 0o755);
  fs.chmodSync(fakeClaude, 0o755);

  // 1. CodexServer
  const serverSpawns = [];
  const server = new CodexServer({
    command:fakeCodex,
    args:["app-server"],
    cwd:root,
    env:{ PATH:path.dirname(fakeCodex), CODEX_CA_CERTIFICATE:missingCa, NODE_EXTRA_CA_CERTS:missingCa },
    spawnFn:(cmd, args, opts) => { serverSpawns.push(opts.env); return fakeChildProcess(); },
  });
  server.close();
  assert.equal(serverSpawns.length, 1);
  assert.equal(serverSpawns[0].CODEX_CA_CERTIFICATE, undefined);
  assert.equal(serverSpawns[0].NODE_EXTRA_CA_CERTS, undefined);

  // 2. agents.js attaches prepareEnv to ALL agents (Codex AND Claude), and toggles sandboxWindowsPath by access level.
  const winApps = path.join(root, "Local", "Microsoft", "WindowsApps");
  fs.mkdirSync(winApps, { recursive:true });
  const winAgents = createAgents({ env:{ PATH:path.dirname(fakeCodex), HOME:root, NODE_EXTRA_CA_CERTS:missingCa }, platform:"win32" });
  const codexDefault = winAgents.command("codex", { workdir:root, docs:root, also:[] });
  const codexFull = winAgents.command("codex", { workdir:root, docs:root, also:[], access:"full" });
  const codexReviewed = winAgents.command("codex", { workdir:root, docs:root, also:[], access:"reviewed" });
  assert.equal(codexDefault.sandboxWindowsPath, false);
  assert.equal(codexFull.sandboxWindowsPath, false);
  assert.equal(codexReviewed.sandboxWindowsPath, true);
  const reviewedPathDirs = codexReviewed.prepareEnv({ Path:`${winApps};C:\\Tools` }).Path.split(";");
  assert.equal(reviewedPathDirs.includes(winApps), false, "sandboxed (Reviewed) Codex strips WindowsApps");
  assert.equal(reviewedPathDirs.includes("C:\\Tools"), true, "sandboxed (Reviewed) Codex preserves normal PATH entries");
  assert.equal(codexDefault.prepareEnv({ Path:`${winApps};C:\\Tools`, CODEX_CA_CERTIFICATE:missingCa }).Path, `${winApps};C:\\Tools`);
  assert.equal(codexDefault.prepareEnv({ Path:`${winApps};C:\\Tools`, CODEX_CA_CERTIFICATE:missingCa }).CODEX_CA_CERTIFICATE, undefined);
  assert.equal(codexFull.prepareEnv({ Path:`${winApps};C:\\Tools`, CODEX_CA_CERTIFICATE:missingCa }).Path, `${winApps};C:\\Tools`);
  assert.equal(codexFull.prepareEnv({ Path:`${winApps};C:\\Tools`, CODEX_CA_CERTIFICATE:missingCa }).CODEX_CA_CERTIFICATE, undefined);

  // Windows USERPROFILE fallback for Kimi and AppData\Local\deepseek-harness\bin for dsh
  const userHome = path.join(root, "win-user");
  const kimiExe = makeFile(userHome, ".kimi-code/bin/kimi.exe", "MZ");
  const dshExe = makeFile(userHome, "AppData/Local/deepseek-harness/bin/dsh.exe", "MZ");
  const winUserAgents = createAgents({ env:{ PATH:"", USERPROFILE:userHome }, platform:"win32" });
  if (process.platform === "win32") {
    assert.equal(winUserAgents.launch("kimi")?.command, kimiExe);
    assert.equal(winUserAgents.launch("dsh")?.command, dshExe);
  }

  const claudeCmd = winAgents.command("claude", { workdir:root, docs:root, also:[] });
  assert.equal(typeof claudeCmd.prepareEnv, "function", "non-Codex agents also get prepareEnv");
  assert.equal(claudeCmd.prepareEnv({ NODE_EXTRA_CA_CERTS:missingCa, KEEP:"1" }).NODE_EXTRA_CA_CERTS, undefined);
  assert.equal(claudeCmd.prepareEnv({ NODE_EXTRA_CA_CERTS:missingCa, KEEP:"1" }).KEEP, "1");

  // 3. ask.js (runAgent), router.js (pickTopic), and agent-check.js (check + tryOne) strip missing CA vars for BOTH Codex and Claude.
  const env = { PATH:path.dirname(fakeCodex), HOME:root, CODEX_CA_CERTIFICATE:missingCa, NODE_EXTRA_CA_CERTS:missingCa };
  const agents = createAgents({ env });

  const askSpawns = [];
  const ans = await runAgent(agents.answerer("codex"), "hello", {
    cwd:root,
    env,
    spawnFn:(_cmd, _args, opts) => {
      askSpawns.push(opts.env);
      const child = fakeChildProcess();
      setImmediate(() => {
        child.stdout.write(`${JSON.stringify({ type:"item.completed", item:{ type:"agent_message", text:"hi" } })}\n`);
        child.emit("close", 0);
      });
      return child;
    },
  });
  assert.equal(ans, "hi");
  assert.equal(askSpawns[0].CODEX_CA_CERTIFICATE, undefined);
  assert.equal(askSpawns[0].NODE_EXTRA_CA_CERTS, undefined);

  const routerSpawns = [];
  const topic = await pickTopic({
    words:"bug",
    topics:[{ slug:"bug", title:"Bug", words:"bug" }],
    agents,
    cwd:root,
    env,
    spawnFn:(cmd, _args, opts) => {
      routerSpawns.push(opts.env);
      const child = fakeChildProcess();
      setImmediate(() => {
        const payload = cmd === fakeClaude
          ? '{"topic":"bug"}\n'
          : `${JSON.stringify({ type:"item.completed", item:{ type:"agent_message", text:'{"topic":"bug"}' } })}\n`;
        child.stdout.write(payload);
        child.emit("close", 0);
      });
      return child;
    },
  });
  assert.equal(topic, "bug");
  assert.equal(routerSpawns[0].CODEX_CA_CERTIFICATE, undefined);
  assert.equal(routerSpawns[0].NODE_EXTRA_CA_CERTS, undefined);

  const checkEnvs = [];
  const check = createAgentCheck(agents, {
    env,
    run:async (cmd, args, opts) => {
      if (cmd === fakeCodex || cmd === fakeClaude) {
        checkEnvs.push({ cmd, args, ca:opts.env.CODEX_CA_CERTIFICATE, nodeCa:opts.env.NODE_EXTRA_CA_CERTS });
      }
      if (cmd === fakeClaude) {
        return { status:0, stdout:args.includes("--version") ? "2.1.0\n" : '{"loggedIn":true}\n', stderr:"", timedOut:false, missing:false };
      }
      return { status:0, stdout:args.includes("--version") ? "codex-cli 0.144.5\n" : "Logged in\n", stderr:"", timedOut:false, missing:false };
    },
  });
  await check.check();
  assert.ok(checkEnvs.some(c => c.cmd === fakeCodex), "checked codex");
  assert.ok(checkEnvs.some(c => c.cmd === fakeClaude), "checked claude");
  for (const call of checkEnvs) {
    assert.equal(call.ca, undefined);
    assert.equal(call.nodeCa, undefined);
  }

  const tryEnvs = [];
  const tried = await tryOne(agents, "codex", {
    env,
    spawnFn:(_cmd, _args, opts) => {
      tryEnvs.push(opts.env);
      const child = fakeChildProcess();
      setImmediate(() => {
        child.stdout.write(`${JSON.stringify({ type:"item.completed", item:{ type:"agent_message", text:"OK" } })}\n`);
        child.emit("close", 0);
      });
      return child;
    },
  });
  assert.equal(tried.ok, true);
  assert.equal(tryEnvs[0].CODEX_CA_CERTIFICATE, undefined);
  assert.equal(tryEnvs[0].NODE_EXTRA_CA_CERTS, undefined);
});

test("kept Codex app-server run strips missing CODEX_CA_CERTIFICATE through agent-keeper", async t => {
  const root = tempDir(t, "penecho-codex-kept-env-");
  const directory = path.join(root, "state");
  const docs = path.join(root, "docs");
  const envLog = path.join(root, "seen-env.json");
  const missingCa = path.join(root, "missing-ca.pem");
  const codexScript = makeFile(root, "fake-codex-app-server.js", `
    const fs = require("node:fs");
    const send = o => process.stdout.write(JSON.stringify(o) + "\\n");
    fs.writeFileSync(${JSON.stringify(envLog)}, JSON.stringify({
      ca: process.env.CODEX_CA_CERTIFICATE ?? null,
    }));
    let buf = "";
    process.stdin.on("data", chunk => {
      buf += chunk;
      for (let end; (end = buf.indexOf("\\n")) >= 0;) {
        const m = JSON.parse(buf.slice(0, end));
        buf = buf.slice(end + 1);
        if (m.method === "initialize") send({ id:m.id, result:{} });
        if (m.method === "thread/start") send({ id:m.id, result:{ thread:{ id:"th-clean", path:"" } } });
        if (m.method === "turn/start") {
          const threadId = m.params.threadId;
          send({ id:m.id, result:{ turn:{ id:"turn-1" } } });
          setImmediate(() => {
            send({ method:"item/completed", params:{ threadId, item:{ id:"m1", type:"agentMessage", text:"Clean env verified." } } });
            send({ method:"turn/completed", params:{ threadId, turn:{ id:"turn-1", status:"completed" } } });
          });
        }
      }
    });
  `);

  const prevCa = process.env.CODEX_CA_CERTIFICATE;
  process.env.CODEX_CA_CERTIFICATE = missingCa;
  t.after(() => {
    if (prevCa === undefined) delete process.env.CODEX_CA_CERTIFICATE;
    else process.env.CODEX_CA_CERTIFICATE = prevCa;
  });

  const agents = createAgents({
    env:{ PATH:"", CODEX_CA_CERTIFICATE:missingCa },
    extra:{
      codex:{
        name:"Codex", mono:"Cx", color:"#000", role:"Build",
        resolve:() => ({ command:process.execPath, prefixArgs:[codexScript] }),
        prepareEnv:prepareCodexEnv,
        command:(launch, { workdir }) => ({
          command:launch.command,
          args:[...launch.prefixArgs, "app-server"],
          cwd:workdir,
          protocol:"app-server",
          ownInstructions:true,
          thread:{ cwd:workdir },
          turn:{},
        }),
      },
    },
  });
  const lines = createProjectLines({
    directory,
    agents,
    serviceOptions:{ autoWatch:false },
    authorizeRead:() => null,
    authorizeWrite:() => null,
    isThisComputer:() => true,
    readJson:async () => ({}),
    send:() => {},
  });
  t.after(() => lines.close());

  const project = lines.service.store.create({ name:"CleanEnv", docsPath:docs });
  project.defaultAgent = "codex";
  lines.service.store.save();
  const { slug } = await lines.service.createTopic(project, { text:"check env", agent:"codex", kinds:["ask", "work"], start:false });
  await lines.service.begin(project, slug);

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && F.parseLine(lines.service.readDoc(project, slug)).status !== "done") {
    await new Promise(r => setTimeout(r, 30));
  }
  assert.equal(F.parseLine(lines.service.readDoc(project, slug)).status, "done");
  const seen = JSON.parse(fs.readFileSync(envLog, "utf8"));
  assert.equal(seen.ca, null, "dangling CODEX_CA_CERTIFICATE must be stripped before spawning Codex through keeper");
});
