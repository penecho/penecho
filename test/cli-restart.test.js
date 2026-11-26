"use strict";
require("./helpers/safety.js");

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { PassThrough } = require("node:stream");

const CLI = require("../src/cli/main.js");
const {
  createInstanceControl,
  isPidAlive,
  listRegisteredServers,
  readActiveRunsFallback,
} = require("../src/server/instance-control.js");
const { Service } = require("../src/server/project-lines/service.js");

const ROOT = path.resolve(__dirname, "..");

function createCapture() {
  let text = "";
  return {
    stream: {
      write(chunk) {
        text += String(chunk);
        return true;
      },
    },
    text() {
      return text;
    },
  };
}

function makeTempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  // A stopped server may still be writing its last file.
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return dir;
}

async function listenHttp(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { server, port: address.port };
}

test("parseArgs and buildRestartArgv support restart options cleanly", () => {
  assert.equal(CLI.parseArgs(["restart"]).command, "restart");
  assert.deepEqual(
    CLI.parseArgs(["restart", "--port", "3889", "--config", "team.env", "--uat"]),
    {
      command: "restart",
      provider: null,
      port: 3889,
      model: null,
      effort: null,
      config: "team.env",
      uat: true,
      open: true,
      help: false,
      version: false,
    },
  );
  assert.throws(() => CLI.parseArgs(["restart", "doctor"]), /Only one command/);
  assert.match(CLI.helpText(), /penecho restart/);

  assert.deepEqual(
    CLI.buildRestartArgv(["--port", "3888", "--claude", "--model=sonnet"], {}, 3888),
    ["--claude", "--model=sonnet", "--port", "3888"],
  );
  assert.deepEqual(
    CLI.buildRestartArgv(["--port=3888", "--claude", "--config", "old.env"], { port: 3999, provider: "codex-cli", config: "/abs/new.env" }, 3888),
    ["--port", "3999", "--config", "/abs/new.env", "--codex"],
  );
});

test("Service.runningJobs reports active project-line runs while ignoring external sessions", async (t) => {
  const root = makeTempDir(t, "penecho-running-jobs-");
  const agents = {
    available: () => [{ id: "pi", available: true, name: "Pi" }],
    classifier: () => null,
    command: (_id, options) => ({ command: "stand-in", args: [], cwd: options.workdir, stdin: true, dialect: "pi" }),
  };
  const service = new Service({
    directory: path.join(root, "state"),
    agents,
    autoWatch: false,
    conversations: { home: path.join(root, "home"), env: {} },
    spawnFn: () => Object.assign(new EventEmitter(), {
      pid: process.pid,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      stdin: new PassThrough(),
      kill() {},
    }),
  });
  t.after(() => service.close());

  assert.deepEqual(service.runningJobs(), []);

  const project = service.store.create({ name: "PenEcho", docsPath: path.join(root, "docs") });
  project.defaultAgent = "pi";
  service.store.save();
  const { slug } = await service.createTopic(project, {
    text: "Keep long task safe",
    agent: "pi",
    kinds: ["ask", "work"],
    start: false,
  });
  await service.begin(project, slug);

  const jobs = service.runningJobs();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].kind, "project-line");
  assert.equal(jobs[0].projectName, "PenEcho");
  assert.equal(jobs[0].slug, slug);
  assert.equal(jobs[0].agent, "pi");
  assert.equal(jobs[0].stepLabel, "Work 1");
});

test("createInstanceControl blocks shutdown with 409 when jobs are running and authenticates callers", async (t) => {
  const root = makeTempDir(t, "penecho-control-");
  let running = [{ kind: "project-line", key: "p/tell-me-what-you-think", title: "Tell me what you think", stepLabel: "Work 8", agent: "claude", pid: process.pid }];
  let shutdownCount = 0;

  let control;
  const { server, port } = await listenHttp(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (await control.handle(req, res, url)) return;
    res.writeHead(404).end();
  });
  t.after(() => new Promise((resolve) => server.close(() => resolve())));

  control = createInstanceControl({
    stateDir: root,
    packageRoot: ROOT,
    entry: path.join(ROOT, "cli.js"),
    argv: ["--port", String(port)],
    getRunningJobs: () => running,
    onShutdown: () => { shutdownCount++; },
  });
  const record = control.register(port);
  t.after(() => control.unregister());

  assert.equal(listRegisteredServers(root).length, 1);

  const unauth = await fetch(`http://127.0.0.1:${port}/api/server/running-jobs`);
  assert.equal(unauth.status, 401);

  const blocked = await fetch(`http://127.0.0.1:${port}/api/server/shutdown`, {
    method: "POST",
    headers: { "x-penecho-control-token": record.token },
  });
  assert.equal(blocked.status, 409);
  const blockedBody = await blocked.json();
  assert.equal(blockedBody.code, "JOBS_RUNNING");
  assert.equal(blockedBody.running.length, 1);
  assert.equal(shutdownCount, 0);

  running = [];
  const allowed = await fetch(`http://127.0.0.1:${port}/api/server/shutdown`, {
    method: "POST",
    headers: { "x-penecho-control-token": record.token },
  });
  assert.equal(allowed.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(shutdownCount, 1);
});

test("penecho restart refuses to restart when a registered server has a running job", async (t) => {
  const root = makeTempDir(t, "penecho-restart-blocked-");
  const home = path.join(root, "home");
  const cwd = path.join(root, "cwd");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });

  let shutdownCount = 0;
  let control;
  const { server, port } = await listenHttp(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (await control.handle(req, res, url)) return;
    res.writeHead(404).end();
  });
  t.after(() => new Promise((resolve) => server.close(() => resolve())));

  control = createInstanceControl({
    stateDir: root,
    packageRoot: ROOT,
    entry: path.join(ROOT, "cli.js"),
    argv: ["--port", String(port)],
    getRunningJobs: () => [{
      kind: "project-line",
      key: "proj/tell-me-what-you-think",
      slug: "tell-me-what-you-think",
      title: "Tell me what you think",
      stepLabel: "Work 8",
      agent: "claude",
      pid: process.pid,
    }],
    onShutdown: () => { shutdownCount++; },
  });
  control.register(port);
  t.after(() => control.unregister());

  const output = createCapture();
  const errorOutput = createCapture();
  const code = await CLI.main(["restart"], {
    env: { ...process.env, PENECHO_STATE_DIR: root },
    home,
    cwd,
    output: output.stream,
    errorOutput: errorOutput.stream,
    spawnRestart: () => { throw new Error("should not spawn replacement while job is running"); },
  });

  assert.equal(code, 1);
  assert.equal(shutdownCount, 0);
  assert.match(errorOutput.text(), /cannot restart/i);
  assert.match(errorOutput.text(), /tell-me-what-you-think/);
  assert.match(errorOutput.text(), /Work 8/);
  assert.equal(listRegisteredServers(root).length, 1);
});

test("penecho restart refuses via active-runs.json fallback if a live child job is persisted", async (t) => {
  const root = makeTempDir(t, "penecho-restart-fallback-");
  const home = path.join(root, "home");
  const cwd = path.join(root, "cwd");
  fs.mkdirSync(path.join(root, "project-lines"), { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });

  fs.writeFileSync(
    path.join(root, "project-lines", "active-runs.json"),
    JSON.stringify([{ key: "proj/still-working", stepId: "step-8", agent: "claude", sessionId: "s-1", pid: process.pid, started: Date.now() }]),
  );

  assert.equal(readActiveRunsFallback(root).length, 1);

  const output = createCapture();
  const errorOutput = createCapture();
  const code = await CLI.main(["restart"], {
    env: { ...process.env, PENECHO_STATE_DIR: root },
    home,
    cwd,
    output: output.stream,
    errorOutput: errorOutput.stream,
  });

  assert.equal(code, 1);
  assert.match(errorOutput.text(), /still running/i);
  assert.match(errorOutput.text(), /still-working/);
});

test("penecho restart aborts cleanly if shutdown returns 409 JOBS_RUNNING", async (t) => {
  const root = makeTempDir(t, "penecho-restart-race-");
  const home = path.join(root, "home");
  const cwd = path.join(root, "cwd");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });

  let calls = 0;
  let control;
  const { server, port } = await listenHttp(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (await control.handle(req, res, url)) return;
    res.writeHead(404).end();
  });
  t.after(() => new Promise((resolve) => server.close(() => resolve())));

  control = createInstanceControl({
    stateDir: root,
    packageRoot: ROOT,
    entry: path.join(ROOT, "cli.js"),
    argv: ["--port", String(port)],
    getRunningJobs: () => {
      calls++;
      return calls === 1 ? [] : [{ kind: "project-line", key: "proj/race-task", slug: "race-task", title: "Race task", stepLabel: "Work 2", agent: "codex", pid: process.pid }];
    },
    onShutdown: () => { throw new Error("should not shut down"); },
  });
  control.register(port);
  t.after(() => control.unregister());

  const output = createCapture();
  const errorOutput = createCapture();
  const code = await CLI.main(["restart", "--port", String(port)], {
    env: { ...process.env, PENECHO_STATE_DIR: root },
    home,
    cwd,
    output: output.stream,
    errorOutput: errorOutput.stream,
  });

  assert.equal(code, 1);
  assert.match(errorOutput.text(), /race-task/);
});

test("penecho restart stops an idle PenEcho server process and starts its replacement", async (t) => {
  const root = makeTempDir(t, "penecho-restart-live-");
  const home = path.join(root, "home");
  const cwd = path.join(root, "cwd");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });

  const childEnv = {
    ...process.env,
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PENECHO_STATE_DIR: root,
    PENECHO_DRAW_FILE: path.join(root, "draw.json"),
    PENECHO_EXIT_ON_SHUTDOWN: "1",
    PENECHO_LINES_EXAMPLES: "0",
  };

  let initialStderr = "";
  const initialChild = spawn(process.execPath, [path.join(ROOT, "cli.js"), "--port", "0"], {
    cwd,
    env: childEnv,
    stdio: ["ignore", "ignore", "pipe"],
  });
  initialChild.stderr.on("data", (chunk) => { initialStderr += String(chunk); });

  t.after(async () => {
    try { if (initialChild.pid && isPidAlive(initialChild.pid)) process.kill(initialChild.pid, "SIGKILL"); } catch {}
    for (const serverRecord of listRegisteredServers(root)) {
      try { if (isPidAlive(serverRecord.pid)) process.kill(serverRecord.pid, "SIGKILL"); } catch {}
    }
  });

  const waitRegistered = async (predicate, timeoutMs = 15000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const match = listRegisteredServers(root).find(predicate);
      if (match) return match;
      if (initialChild.exitCode !== null && !match) {
        throw new Error(`Initial child exited early (${initialChild.exitCode}): ${initialStderr}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out waiting for server registration. stderr=${initialStderr}`);
  };

  const firstRecord = await waitRegistered((record) => record.pid === initialChild.pid);
  assert.ok(firstRecord.port > 0);

  const output = createCapture();
  const errorOutput = createCapture();
  const code = await CLI.main(["restart"], {
    env: childEnv,
    home,
    cwd,
    output: output.stream,
    errorOutput: errorOutput.stream,
  });

  assert.equal(code, 0, errorOutput.text());
  assert.match(output.text(), new RegExp(`PenEcho restarted on http://127\\.0\\.0\\.1:${firstRecord.port}`));

  const restarted = listRegisteredServers(root).find((record) => record.port === firstRecord.port);
  assert.ok(restarted);
  assert.notEqual(restarted.pid, firstRecord.pid);
  assert.equal(isPidAlive(firstRecord.pid), false);
  assert.equal(isPidAlive(restarted.pid), true);

  const checkRes = await fetch(`http://127.0.0.1:${restarted.port}/api/server/running-jobs`, {
    headers: { "x-penecho-control-token": restarted.token },
  });
  assert.equal(checkRes.status, 200);
  const checkBody = await checkRes.json();
  assert.deepEqual(checkBody.running, []);

  // Clean shutdown of replacement server.
  const stopRes = await fetch(`http://127.0.0.1:${restarted.port}/api/server/shutdown`, {
    method: "POST",
    headers: { "x-penecho-control-token": restarted.token },
  });
  assert.equal(stopRes.status, 200);
  const stopBy = Date.now() + 15000;
  while (isPidAlive(restarted.pid) && Date.now() < stopBy) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(isPidAlive(restarted.pid), false, "the replacement server ended");
});
