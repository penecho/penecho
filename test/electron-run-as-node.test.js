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

const { CodexServer } = require("../src/server/project-lines/codex-server.js");
const { createKeeper } = require("../src/server/project-lines/kept-child.js");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { pickTopic } = require("../src/server/project-lines/router.js");
const { Conversations } = require("../src/server/project-lines/conversations.js");
const F = require("../src/server/project-lines/format.js");

function tempDir(t, prefix = "penecho-electron-node-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive:true, force:true }));
  return dir;
}

function makeFile(root, rel, content = "") {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive:true });
  fs.writeFileSync(full, content);
  return full;
}

// Normalize objects/arrays created inside vm.runInNewContext to the host realm for deepStrictEqual.
const plain = value => JSON.parse(JSON.stringify(value));

// Load CommonJS modules in an isolated VM context with a simulated Electron `process` (e.g. Windows PenEcho.exe).
function loadInProcessContext(entryFile, { platform = process.platform, execPath = process.execPath, electron = "35.0.0", mocks = {}, reloadLocal = () => false } = {}) {
  const cache = new Map();
  const proc = Object.create(process);
  Object.defineProperties(proc, {
    platform:{ value:platform, enumerable:true },
    execPath:{ value:execPath, enumerable:true },
    versions:{ value:{ ...process.versions, ...(electron ? { electron } : { electron:undefined }) }, enumerable:true },
  });
  function load(filename) {
    filename = path.resolve(filename);
    if (cache.has(filename)) return cache.get(filename);
    const mod = { exports:{} }, localRequire = createRequire(filename);
    cache.set(filename, mod.exports);
    const requireMock = name => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith(".") && reloadLocal(name, filename)) return load(localRequire.resolve(name));
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
      URL, URLSearchParams, TextDecoder, TextEncoder, AbortController, AbortSignal, console,
    }, { filename });
    cache.set(filename, mod.exports);
    return mod.exports;
  }
  return load(entryFile);
}

function fakeChildProcess() {
  const child = new EventEmitter();
  child.pid = 424242;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => { child.emit("close", 0, null); };
  child.unref = () => {};
  return child;
}

test("Windows npm wrappers and JS entrypoints set ELECTRON_RUN_AS_NODE=1 under Electron, never for native binaries or plain Node", t => {
  const root = tempDir(t);
  const fakeExe = "C:\\Users\\test\\AppData\\Local\\penecho\\app-1.5.0\\PenEcho.exe";

  const codexCmd = makeFile(root, "npm/codex.cmd");
  const codexJs = makeFile(root, "npm/node_modules/@openai/codex/bin/codex.js");
  const codexExe = makeFile(root, "native/codex.exe");

  const claudeCmd = makeFile(root, "npm/claude.cmd");
  const claudeWrapper = makeFile(root, "npm/node_modules/@anthropic-ai/claude-code/cli-wrapper.cjs");
  const claudeNativeCmd = makeFile(root, "npm-native/claude.cmd");
  const claudeNativeExe = makeFile(root, "npm-native/node_modules/@anthropic-ai/claude-code/bin/claude.exe");

  const kimiCmd = makeFile(root, "npm/kimi.cmd");
  const kimiJs = makeFile(root, "npm/node_modules/@moonshot-ai/kimi-code/dist/cli.js");
  const kimiExe = makeFile(root, "native/kimi.exe");

  const codexElectron = loadInProcessContext(path.join(__dirname, "../src/providers/codex-cli.js"), { platform:"win32", execPath:fakeExe, electron:"35.0.0" });
  const claudeElectron = loadInProcessContext(path.join(__dirname, "../src/providers/claude-cli.js"), { platform:"win32", execPath:fakeExe, electron:"35.0.0" });
  const kimiElectron = loadInProcessContext(path.join(__dirname, "../src/providers/kimi-cli.js"), { platform:"win32", execPath:fakeExe, electron:"35.0.0" });

  assert.deepEqual(plain(codexElectron.resolveCodexLaunch(codexCmd)), { command:fakeExe, prefixArgs:[codexJs], env:{ ELECTRON_RUN_AS_NODE:"1" } });
  assert.deepEqual(plain(codexElectron.resolveCodexLaunch(codexJs)), { command:fakeExe, prefixArgs:[codexJs], env:{ ELECTRON_RUN_AS_NODE:"1" } });
  assert.deepEqual(plain(codexElectron.resolveCodexLaunch(codexExe)), { command:codexExe, prefixArgs:[] });

  assert.deepEqual(plain(claudeElectron.resolveClaudeLaunch(claudeCmd)), { command:fakeExe, prefixArgs:[claudeWrapper], env:{ ELECTRON_RUN_AS_NODE:"1" } });
  assert.deepEqual(plain(claudeElectron.resolveClaudeLaunch(claudeNativeCmd)), { command:claudeNativeExe, prefixArgs:[] });

  assert.deepEqual(plain(kimiElectron.resolveKimiLaunch(kimiCmd)), { command:fakeExe, prefixArgs:[kimiJs], env:{ ELECTRON_RUN_AS_NODE:"1" } });
  assert.deepEqual(plain(kimiElectron.resolveKimiLaunch(kimiExe)), { command:kimiExe, prefixArgs:[] });

  // Plain Node (non-Electron) must not add ELECTRON_RUN_AS_NODE.
  // npm's codex.js opens a window for codex.exe, so the program it would start is started directly, where its layout is known.
  const nativeExe = makeFile(root, `npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-${process.arch}/vendor/${process.arch === "arm64" ? "aarch64" : "x86_64"}-pc-windows-msvc/bin/codex.exe`);
  const native = { command:nativeExe, prefixArgs:[], env:{ CODEX_MANAGED_PACKAGE_ROOT:fs.realpathSync(path.join(root, "npm/node_modules/@openai/codex")), CODEX_MANAGED_BY_NPM:"1" } };
  assert.deepEqual(plain(codexElectron.resolveCodexLaunch(codexCmd)), native);
  assert.deepEqual(plain(codexElectron.resolveCodexLaunch(codexJs)), native);
  fs.rmSync(nativeExe);

  const codexPlain = loadInProcessContext(path.join(__dirname, "../src/providers/codex-cli.js"), { platform:"win32", execPath:process.execPath, electron:"" });
  assert.deepEqual(plain(codexPlain.resolveCodexLaunch(codexCmd)), { command:process.execPath, prefixArgs:[codexJs] });
});

test("providers merge launch.env into isolated spawn env under Electron", async t => {
  const root = tempDir(t);
  const codexHome = path.join(root, "codex-home");
  fs.mkdirSync(codexHome, { recursive:true });
  fs.writeFileSync(path.join(codexHome, "auth.json"), '{"auth_mode":"test"}');
  const codexJs = makeFile(root, "codex.js");
  const claudeJs = makeFile(root, "claude.js");
  const kimiJs = makeFile(root, "kimi.js");
  const fakeExe = "C:\\PenEcho\\PenEcho.exe";

  // Codex callCodexCli
  const codexSpawns = [];
  const codexMod = loadInProcessContext(path.join(__dirname, "../src/providers/codex-cli.js"), {
    platform:"win32",
    execPath:fakeExe,
    electron:"35.0.0",
    mocks:{
      child_process:{
        spawn(cmd, args, opts) {
          codexSpawns.push({ cmd, args, opts });
          const child = fakeChildProcess();
          setImmediate(() => {
            child.stdout.write(`${JSON.stringify({ type:"item.completed", item:{ type:"agent_message", text:"ok" } })}\n`);
            child.stdout.write(`${JSON.stringify({ type:"turn.completed" })}\n`);
            child.emit("close", 0);
          });
          return child;
        },
      },
    },
  });
  const codexOut = await codexMod.callCodexCli({ executable:codexJs, prompt:"hi", env:{ PATH:"", CODEX_HOME:codexHome } });
  assert.equal(codexOut, "ok");
  assert.equal(codexSpawns[0].cmd, fakeExe);
  assert.equal(codexSpawns[0].opts.env.ELECTRON_RUN_AS_NODE, "1");

  // Claude callClaudeCli
  const claudeSpawns = [];
  const claudeMod = loadInProcessContext(path.join(__dirname, "../src/providers/claude-cli.js"), {
    platform:"win32",
    execPath:fakeExe,
    electron:"35.0.0",
    mocks:{
      child_process:{
        spawn(cmd, args, opts) {
          claudeSpawns.push({ cmd, args, opts });
          const child = fakeChildProcess();
          setImmediate(() => {
            child.stdout.write(`${JSON.stringify({ type:"result", subtype:"success", result:"ok-claude" })}\n`);
            child.emit("close", 0);
          });
          return child;
        },
      },
    },
  });
  const claudeOut = await claudeMod.callClaudeCli({ executable:claudeJs, systemPrompt:"sys", prompt:"hi", env:{ PATH:"" } });
  assert.equal(claudeOut, "ok-claude");
  assert.equal(claudeSpawns[0].cmd, fakeExe);
  assert.equal(claudeSpawns[0].opts.env.ELECTRON_RUN_AS_NODE, "1");

  // Kimi callKimiCliSpawn + KimiAcpClient
  const kimiSpawns = [];
  const kimiMod = loadInProcessContext(path.join(__dirname, "../src/providers/kimi-cli.js"), {
    platform:"win32",
    execPath:fakeExe,
    electron:"35.0.0",
    mocks:{
      child_process:{
        spawn(cmd, args, opts) {
          kimiSpawns.push({ cmd, args, opts });
          const child = fakeChildProcess();
          setImmediate(() => {
            child.stdout.write(`${JSON.stringify({ type:"message", role:"assistant", content:"ok-kimi", done:true })}\n`);
            child.emit("close", 0);
          });
          return child;
        },
      },
    },
  });
  const kimiOut = await kimiMod.callKimiCliSpawn({ executable:kimiJs, prompt:"hi", env:{ PATH:"" } });
  assert.equal(kimiOut, "ok-kimi");
  assert.equal(kimiSpawns[0].cmd, fakeExe);
  assert.equal(kimiSpawns[0].opts.env.ELECTRON_RUN_AS_NODE, "1");

  const acpSpawns = [];
  const kimiAcpMod = loadInProcessContext(path.join(__dirname, "../src/providers/kimi-acp.js"), {
    platform:"win32",
    execPath:fakeExe,
    electron:"35.0.0",
    mocks:{
      child_process:{
        spawn(cmd, args, opts) {
          acpSpawns.push({ cmd, args, opts });
          const child = fakeChildProcess();
          child.stdin.on("data", chunk => {
            const msg = JSON.parse(String(chunk).trim());
            child.stdout.write(`${JSON.stringify({ jsonrpc:"2.0", id:msg.id, result:{ agentInfo:{ name:"kimi", version:"1" } } })}\n`);
          });
          return child;
        },
      },
    },
  });
  const acp = new kimiAcpMod.KimiAcpClient({ launch:kimiMod.resolveKimiLaunch(kimiJs), env:{ PATH:"" }, workDir:root, kimiHome:root });
  await acp.start();
  t.after(() => acp.close());
  assert.equal(acpSpawns[0].cmd, fakeExe);
  assert.equal(acpSpawns[0].opts.env.ELECTRON_RUN_AS_NODE, "1");
});

test("agents.js propagates launch.env across command, classifier, answerer, reviewer, and findCli under Electron", t => {
  const root = tempDir(t);
  const fakeExe = "C:\\PenEcho\\PenEcho.exe";
  const codexCmd = makeFile(root, "bin/codex.cmd");
  const codexJs = makeFile(root, "bin/node_modules/@openai/codex/bin/codex.js");
  const claudeCmd = makeFile(root, "bin/claude.cmd");
  const claudeWrapper = makeFile(root, "bin/node_modules/@anthropic-ai/claude-code/cli-wrapper.cjs");
  const piJs = makeFile(root, "bin/pi.js");

  const agentsMod = loadInProcessContext(path.join(__dirname, "../src/server/project-lines/agents.js"), {
    platform:"win32",
    execPath:fakeExe,
    electron:"35.0.0",
    reloadLocal:name => name.endsWith("codex-cli.js") || name.endsWith("claude-cli.js") || name.endsWith("kimi-cli.js"),
  });
  const env = { PATH:"", CODEX_CLI_PATH:codexCmd, CLAUDE_CLI_PATH:claudeCmd, PI_CLI_PATH:piJs };
  const agents = agentsMod.createAgents({ env, platform:"win32" });

  const codexCmdSpec = agents.command("codex", { workdir:root, docs:root, gitDir:"" });
  assert.equal(codexCmdSpec.command, fakeExe);
  assert.deepEqual(plain(codexCmdSpec.args), [codexJs, "app-server"]);
  assert.equal(codexCmdSpec.env?.ELECTRON_RUN_AS_NODE, "1");

  const codexPlainSpec = agents.command("codex", { workdir:root, docs:root, gitDir:"", plain:true });
  assert.equal(codexPlainSpec.env?.ELECTRON_RUN_AS_NODE, "1");

  const codexAnswer = agents.answerer("codex");
  assert.equal(codexAnswer.env?.ELECTRON_RUN_AS_NODE, "1");

  const codexReview = agents.reviewer("codex");
  assert.equal(codexReview.env?.ELECTRON_RUN_AS_NODE, "1");

  const claudeSpec = agents.command("claude", { workdir:root, docs:root });
  assert.equal(claudeSpec.command, fakeExe);
  assert.equal(claudeSpec.args[0], claudeWrapper);
  assert.equal(claudeSpec.env?.ELECTRON_RUN_AS_NODE, "1");

  const piSpec = agents.command("pi", { workdir:root, docs:root });
  assert.equal(piSpec.command, fakeExe);
  assert.equal(piSpec.args[0], piJs);
  assert.equal(piSpec.env?.ELECTRON_RUN_AS_NODE, "1");

  const classified = agents.classifier();
  assert.equal(classified.env?.ELECTRON_RUN_AS_NODE, "1");
});

test("CodexServer, agent-process, and router enforce ELECTRON_RUN_AS_NODE=1 for Electron execPath spawns", async t => {
  const fakeExe = "C:\\PenEcho\\PenEcho.exe";

  // CodexServer defense-in-depth under Electron
  const codexServerMod = loadInProcessContext(path.join(__dirname, "../src/server/project-lines/codex-server.js"), {
    platform:"win32",
    execPath:fakeExe,
    electron:"35.0.0",
  });
  const serverSpawns = [];
  const server = new codexServerMod.CodexServer({
    command:fakeExe,
    args:["C:\\npm\\codex.js", "app-server"],
    cwd:process.cwd(),
    env:{ PATH:"C:\\Windows" },
    spawnFn:(cmd, args, opts) => { serverSpawns.push({ cmd, args, opts }); return fakeChildProcess(); },
  });
  server.close();
  assert.equal(serverSpawns.length, 1);
  assert.equal(serverSpawns[0].opts.env.ELECTRON_RUN_AS_NODE, "1");

  // Native binary through CodexServer does NOT get ELECTRON_RUN_AS_NODE
  const nativeSpawns = [];
  const nativeServer = new codexServerMod.CodexServer({
    command:"C:\\bin\\codex.exe",
    args:["app-server"],
    cwd:process.cwd(),
    env:{ PATH:"C:\\Windows" },
    spawnFn:(cmd, args, opts) => { nativeSpawns.push({ cmd, args, opts }); return fakeChildProcess(); },
  });
  nativeServer.close();
  assert.equal(nativeSpawns[0].opts.env.ELECTRON_RUN_AS_NODE, undefined);

  // agent-process spawn / spawnSync / runCommand
  const crossCalls = [];
  const crossMock = Object.assign(
    (cmd, args, opts) => { crossCalls.push({ kind:"spawn", cmd, args, opts }); const c = fakeChildProcess(); setImmediate(() => c.emit("close", 0)); return c; },
    { sync:(cmd, args, opts) => { crossCalls.push({ kind:"sync", cmd, args, opts }); return { status:0, stdout:"" }; } },
  );
  const procMod = loadInProcessContext(path.join(__dirname, "../src/server/project-lines/agent-process.js"), {
    platform:"win32",
    execPath:fakeExe,
    electron:"35.0.0",
    mocks:{ "cross-spawn":crossMock },
  });
  procMod.spawn(fakeExe, ["script.js"], { env:{ PATH:"x" } });
  procMod.spawnSync(fakeExe, ["script.js"], { env:{ PATH:"x" } });
  await procMod.runCommand(fakeExe, ["script.js"], { env:{ PATH:"x" } });
  procMod.spawn("C:\\bin\\codex.exe", ["--version"], { env:{ PATH:"x" } });
  assert.equal(crossCalls[0].opts.env.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(crossCalls[1].opts.env.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(crossCalls[2].opts.env.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(crossCalls[3].opts.env.ELECTRON_RUN_AS_NODE, undefined);

  // router.pickTopic merges command.env
  const routerSpawns = [];
  const topic = await pickTopic({
    words:"fix bug",
    topics:[{ slug:"bug", title:"Bug", words:"fix" }],
    agents:{ classifier:() => ({ command:fakeExe, args:["codex.js"], env:{ ELECTRON_RUN_AS_NODE:"1" } }) },
    cwd:process.cwd(),
    env:{ PATH:"x" },
    spawnFn:(cmd, args, opts) => {
      routerSpawns.push({ cmd, args, opts });
      const child = fakeChildProcess();
      setImmediate(() => {
        child.stdout.write('{"topic":"bug"}\n');
        child.emit("close", 0);
      });
      return child;
    },
  });
  assert.equal(topic, "bug");
  assert.equal(routerSpawns[0].opts.env.ELECTRON_RUN_AS_NODE, "1");
});

test("Conversations.codexClient forwards command.env and backs off when Codex exits before initialize", async t => {
  const dir = tempDir(t);
  const spawns = [];
  let failStart = true;
  const service = {
    directory:dir,
    foldersHeld:true,
    store:{ projects:[], deleted:{} },
    agents:{
      env:{ PATH:"test-path", CODEX_HOME:dir },
      available:() => [{ id:"codex", available:true }],
      command:() => ({ command:process.execPath, args:["codex.js", "app-server"], protocol:"app-server", env:{ ELECTRON_RUN_AS_NODE:"1" } }),
    },
    spawn(cmd, args, opts) {
      spawns.push({ cmd, args, opts });
      const child = fakeChildProcess();
      if (failStart) {
        setImmediate(() => child.emit("close", 0));
      } else {
        child.stdin.on("data", chunk => {
          for (const line of String(chunk).split("\n").filter(Boolean)) {
            const msg = JSON.parse(line);
            if (msg.method === "initialize") child.stdout.write(`${JSON.stringify({ id:msg.id, result:{} })}\n`);
          }
        });
      }
      return child;
    },
    isSessionRunning:() => false,
  };
  const conv = new Conversations({ directory:dir, service, home:dir, env:{} });
  t.after(() => conv.close());

  const first = conv.codexClient();
  assert.ok(first);
  assert.equal(spawns.length, 1);
  assert.equal(spawns[0].opts.env.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(spawns[0].opts.env.CODEX_HOME, dir);

  await assert.rejects(first.ready);
  // Wait a microtask for Conversations' rejection handler to record backoff.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(conv.codexFailures, 1);
  assert.ok(conv.codexBackoffUntil > Date.now());

  // Background poll during backoff must NOT spawn again.
  assert.equal(conv.codexClient(), null);
  assert.equal(spawns.length, 1);

  // Explicit sync (force:true) bypasses backoff and clears it once healthy.
  failStart = false;
  const recovered = conv.codexClient({ force:true });
  assert.ok(recovered);
  await recovered.ready;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(spawns.length, 2);
  assert.equal(conv.codexFailures, 0);
  assert.equal(conv.codexBackoffUntil, 0);
});

test("kept-child preserves ELECTRON_RUN_AS_NODE for Electron execPath agents and drops it for native binaries", t => {
  const root = tempDir(t);
  const fakeExe = "C:\\PenEcho\\PenEcho.exe";
  const spawnedKeepers = [];
  const keptMod = loadInProcessContext(path.join(__dirname, "../src/server/project-lines/kept-child.js"), {
    platform:"win32",
    execPath:fakeExe,
    electron:"35.0.0",
    mocks:{
      "node:child_process":{
        spawn(cmd, args, opts) {
          spawnedKeepers.push({ cmd, args, opts });
          return fakeChildProcess();
        },
        spawnSync:() => ({ status:0 }),
      },
    },
  });
  const keeper = keptMod.createKeeper({ root, execPath:fakeExe });

  // Case 1: Electron execPath with script args (even if caller forgot ELECTRON_RUN_AS_NODE in env)
  const dirJs = path.join(root, "js-agent");
  const childJs = keeper.spawn(fakeExe, ["C:\\npm\\codex.js", "app-server"], { dir:dirJs, cwd:root, env:{ PATH:"x" } });
  t.after(() => childJs.detach());
  const specJs = JSON.parse(fs.readFileSync(path.join(dirJs, "spec.json"), "utf8"));
  assert.deepEqual(plain(specJs.dropEnv), []);
  assert.equal(spawnedKeepers[0].opts.env.ELECTRON_RUN_AS_NODE, "1");

  // Case 2: Native binary without ELECTRON_RUN_AS_NODE in options.env -> dropEnv still strips it!
  const dirNative = path.join(root, "native-agent");
  const childNative = keeper.spawn("C:\\bin\\codex.exe", ["app-server"], { dir:dirNative, cwd:root, env:{ PATH:"x" } });
  t.after(() => childNative.detach());
  const specNative = JSON.parse(fs.readFileSync(path.join(dirNative, "spec.json"), "utf8"));
  assert.deepEqual(plain(specNative.dropEnv), ["ELECTRON_RUN_AS_NODE"]);
  assert.equal(spawnedKeepers[1].opts.env.ELECTRON_RUN_AS_NODE, "1");
});

test("kept Codex app-server with ELECTRON_RUN_AS_NODE=1 survives PenEcho restart and completes", async t => {
  const root = tempDir(t, "penecho-electron-restart-");
  const directory = path.join(root, "state");
  const docs = path.join(root, "docs");
  const envLog = path.join(root, "agent-env.json");
  const releaseFile = path.join(root, "release");
  const codexScript = makeFile(root, "codex-app-server.js", `
    const fs = require("node:fs");
    const send = o => process.stdout.write(JSON.stringify(o) + "\\n");
    fs.writeFileSync(${JSON.stringify(envLog)}, JSON.stringify({
      pid: process.pid,
      electronRunAsNode: process.env.ELECTRON_RUN_AS_NODE || null,
    }));
    let buf = "";
    process.stdin.on("data", chunk => {
      buf += chunk;
      for (let end; (end = buf.indexOf("\\n")) >= 0;) {
        const m = JSON.parse(buf.slice(0, end));
        buf = buf.slice(end + 1);
        if (m.method === "initialize") send({ id:m.id, result:{} });
        if (m.method === "thread/start") send({ id:m.id, result:{ thread:{ id:"thread-" + process.pid, path:"" } } });
        if (m.method === "turn/start") {
          const threadId = m.params.threadId;
          send({ id:m.id, result:{ turn:{ id:"turn-1" } } });
          const timer = setInterval(() => {
            if (!fs.existsSync(${JSON.stringify(releaseFile)})) return;
            clearInterval(timer);
            send({ method:"item/completed", params:{ threadId, item:{ id:"msg-1", type:"agentMessage", text:"Survived restart with Electron Node mode." } } });
            send({ method:"turn/completed", params:{ threadId, turn:{ id:"turn-1", status:"completed" } } });
          }, 25);
        }
      }
    });
  `);

  const makeAgents = () => createAgents({
    env:{ PATH:"" },
    extra:{
      codex:{
        name:"Codex", mono:"Cx", color:"#000", role:"Build",
        resolve:() => ({ command:process.execPath, prefixArgs:[codexScript], env:{ ELECTRON_RUN_AS_NODE:"1" } }),
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
  const open = () => createProjectLines({
    directory,
    agents:makeAgents(),
    serviceOptions:{ autoWatch:false },
    authorizeRead:() => null,
    authorizeWrite:() => null,
    isThisComputer:() => true,
    readJson:async () => ({}),
    send:() => {},
  });
  const until = async (check, label, ms = 15000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const value = await check();
      if (value) return value;
      await new Promise(r => setTimeout(r, 30));
    }
    assert.fail(`Timed out waiting for ${label}`);
  };

  const first = open();
  let restarted = null;
  t.after(() => { first.close(); restarted?.close(); });
  const project = first.service.store.create({ name:"RestartTest", docsPath:docs });
  project.defaultAgent = "codex";
  first.service.store.save();
  const { slug } = await first.service.createTopic(project, { text:"verify electron restart", agent:"codex", kinds:["ask", "work"], start:false });
  await first.service.begin(project, slug);
  const firstRun = await until(() => {
    const run = first.service.runs.get(first.service.key(project, slug));
    return run?.turnId ? run : null;
  }, "Codex turn started");
  const agentPid = firstRun.child.pid;
  const recorded = JSON.parse(fs.readFileSync(envLog, "utf8"));
  assert.equal(recorded.electronRunAsNode, "1", "kept Codex agent must receive ELECTRON_RUN_AS_NODE=1");
  assert.equal(recorded.pid, agentPid);

  // Close first PenEcho; kept Codex agent must stay alive and keep working.
  first.close();
  await new Promise(r => setTimeout(r, 200));
  assert.doesNotThrow(() => process.kill(agentPid, 0), "kept Codex agent stayed alive after PenEcho closed");

  // Start replacement PenEcho; it must reattach to the exact same PID and finish the Work.
  restarted = open();
  const project2 = restarted.service.store.get(project.id);
  const reattached = restarted.service.runs.get(restarted.service.key(project2, slug));
  assert.ok(reattached, "restarted PenEcho reattached to running Codex Work");
  assert.equal(reattached.child.pid, agentPid, "reattached to the original Codex process");

  fs.writeFileSync(releaseFile, "go");
  await until(() => F.parseLine(restarted.service.readDoc(project2, slug)).status === "done", "reattached Codex Work done");
  const detail = restarted.service.store.readText(project2, F.detailPath(slug, reattached.stepId)).text;
  assert.match(detail, /Survived restart with Electron Node mode\./);
});

test("CLI preflight runCaptured, codex-native-host, and sqlite reader pass ELECTRON_RUN_AS_NODE=1 under Electron", async t => {
  const root = tempDir(t);
  const fakeExe = "C:\\PenEcho\\PenEcho.exe";
  const codexCmd = makeFile(root, "npm/codex.cmd");
  const codexJs = makeFile(root, "npm/node_modules/@openai/codex/bin/codex.js");

  // src/cli/main.js runCodexPreflight
  const cliSpawns = [];
  const cliMod = loadInProcessContext(path.join(__dirname, "../src/cli/main.js"), {
    platform:"win32",
    execPath:fakeExe,
    electron:"35.0.0",
    reloadLocal:name => name.endsWith("codex-cli.js"),
    mocks:{
      child_process:{
        spawn(cmd, args, opts) {
          cliSpawns.push({ cmd, args, opts });
          const child = fakeChildProcess();
          setImmediate(() => {
            child.stdout.write(args.includes("--version") ? "codex 0.166.0\n" : "Logged in\n");
            child.emit("close", 0);
          });
          return child;
        },
      },
    },
  });
  const preflight = await cliMod.runCodexPreflight({ cwd:root, env:{ PATH:"", CODEX_CLI_PATH:codexCmd } });
  assert.equal(preflight.ok, true);
  assert.equal(cliSpawns.length, 2);
  for (const call of cliSpawns) {
    assert.equal(call.cmd, fakeExe);
    assert.equal(call.args[0], codexJs);
    assert.equal(call.opts.env.ELECTRON_RUN_AS_NODE, "1");
  }

  // Behavioral check for codex-native-host.mjs under simulated Electron
  const codexHome = path.join(root, "native-codex-home");
  fs.mkdirSync(codexHome, { recursive:true });
  fs.writeFileSync(path.join(codexHome, "auth.json"), '{"auth_mode":"test"}');
  const nativeSpawns = [];
  const prevElectron = Object.getOwnPropertyDescriptor(process.versions, "electron");
  Object.defineProperty(process.versions, "electron", { value:"35.0.0", configurable:true, enumerable:true });
  try {
    const { CodexNativeAppServerProcess } = await import("../src/server/canvas-agent/codex-native-host.mjs");
    const client = new CodexNativeAppServerProcess({
      connection:{ cliPath:codexJs },
      env:{ PATH:"", CODEX_HOME:codexHome },
      runtimeDirectory:root,
      spawnProcess(cmd, args, opts) {
        nativeSpawns.push({ cmd, args, opts });
        const child = fakeChildProcess();
        child.stdin.on("data", chunk => {
          for (const line of String(chunk).split("\n").filter(Boolean)) {
            const msg = JSON.parse(line);
            if (msg.method === "initialize") child.stdout.write(`${JSON.stringify({ id:msg.id, result:{} })}\n`);
            if (msg.method === "thread/start") child.stdout.write(`${JSON.stringify({ id:msg.id, result:{ thread:{ id:"th-1", ephemeral:true } } })}\n`);
          }
        });
        return child;
      },
    });
    const threadId = await client.start({ cwd:root, baseInstructions:"test", dynamicTools:[] });
    await client.close();
    assert.equal(threadId, "th-1");
    assert.equal(nativeSpawns.length, 1);
    assert.equal(nativeSpawns[0].cmd, process.execPath);
    assert.equal(nativeSpawns[0].opts.env.ELECTRON_RUN_AS_NODE, "1");
  } finally {
    if (prevElectron) Object.defineProperty(process.versions, "electron", prevElectron);
    else delete process.versions.electron;
  }

  // Verify runtime.mjs runSqliteReader sets ELECTRON_RUN_AS_NODE when process.versions.electron is present
  const runtimeSrc = fs.readFileSync(path.join(__dirname, "../src/server/canvas-agent/runtime.mjs"), "utf8");
  assert.match(runtimeSrc, /\.\.\.\(process\.versions\?\.electron \? \{ ELECTRON_RUN_AS_NODE:'1' \} : \{\}\)/);
});
