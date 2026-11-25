"use strict";
require("./helpers/safety.js");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { createInterface } = require("node:readline");
const { test } = require("node:test");
const { setTimeout:delay } = require("node:timers/promises");
const { createPenEchoSource } = require("../src/server/agent-core/penecho-source.js");
const { createAgents } = require("../src/server/project-lines/agents.js");
const RuntimeOwner = require("../src/server/project-lines/runtime-owner.js");

const reconnectMs = 500;
const outageMs = 1200;
const answer = "Same runner after the outage.";

async function until(check, label) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const value = check();
    if (value) return value;
    await delay(15);
  }
  assert.fail(`Timed out waiting for ${label}`);
}

async function proxyFixture(t, { holdFirst = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pe-ro-"));
  const sources = [], runners = [], requests = [];
  const model = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ key:req.headers["idempotency-key"], body:JSON.parse(body) });
    if (holdFirst && requests.length === 1) return;
    const base = { id:"fixture", object:"chat.completion.chunk", created:1, model:"stub-model" };
    const chunks = [
      { ...base, choices:[{ index:0, delta:{ role:"assistant", content:answer }, finish_reason:null }] },
      { ...base, choices:[{ index:0, delta:{}, finish_reason:"stop" }] },
    ];
    res.writeHead(200, { "content-type":"text/event-stream" });
    res.end(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n");
  });
  t.after(async () => {
    for (const { child } of runners) child.kill("SIGKILL");
    await Promise.allSettled(runners.map(({ exited }) => exited));
    await Promise.allSettled(sources.map(source => source.close()));
    model.closeAllConnections();
    await new Promise(resolve => model.close(resolve));
    fs.rmSync(root, { recursive:true, force:true });
  });
  model.listen(0, "127.0.0.1");
  await once(model, "listening");
  const catalog = { models:[{ id:"stub-model", apiFormat:"openai", worker:true }] };
  const connector = {
    hostedCatalog:catalog,
    status:() => ({ accountSession:{ signedIn:true } }),
    refreshHostedCatalog:async () => catalog,
    hostedModels:async () => ({ ...catalog, credits:100 }),
    prepareHostedConnection:async id => ({
      id, provider:"api", apiFormat:"openai", apiUrl:`http://127.0.0.1:${model.address().port}/v1`,
      apiModel:id.slice(7), apiKey:"fixture-api-key", hosted:true,
    }),
  };
  async function startProxy() {
    const source = createPenEchoSource({ cloud:() => connector, stateDir:root, keepaliveMs:50 });
    sources.push(source);
    await source.listening;
    return source;
  }
  function command(source) {
    const agents = createAgents({ env:process.env, paths:{ penecho:source, stateDir:root, home:root }, appFolders:[] });
    return agents.command("penecho", { workdir:root, docs:root });
  }
  function startRunner(spec) {
    const scratch = fs.mkdtempSync(path.join(root, "runner-"));
    const child = spawn(spec.command, spec.args, {
      cwd:spec.cwd,
      env:{ ...process.env, ...spec.env, TMPDIR:scratch, TMP:scratch, TEMP:scratch, PENECHO_PROXY_RECONNECT_MS:String(reconnectMs), PENECHO_PROXY_POLL_MS:"25" },
      stdio:["pipe", "pipe", "pipe"],
    });
    const exited = once(child, "close");
    runners.push({ child, exited });
    const messages = [];
    const reader = createInterface({ input:child.stdout });
    reader.on("line", line => { if (line.trim()) messages.push(JSON.parse(line)); });
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
    return {
      child, exited, messages, status:() => stderr,
      // Its private folder is the last thing a runner makes before it takes signals and looks for the proxy.
      started:() => fs.readdirSync(scratch).some(name => name.startsWith("penecho-run-")),
      ask() {
        child.stdin.write(JSON.stringify({ type:"user", message:{ content:[{ type:"text", text:"Reply once." }] } }) + "\n");
      },
      result:() => messages.find(message => message.type === "result"),
    };
  }
  return { requests, startProxy, command, startRunner };
}

test("built-in runner survives a refused local proxy beyond the reconnect budget and replays the same call", { timeout:15000 }, async t => {
  const fixture = await proxyFixture(t, { holdFirst:true });
  const original = await fixture.startProxy();
  const runner = fixture.startRunner(fixture.command(original));
  const pid = runner.child.pid;
  runner.ask();
  await until(() => fixture.requests.length === 1, "first model request");
  await original.close();
  assert.ok(fs.existsSync(original.endpointFile), "clean shutdown leaves a stale endpoint record");
  await delay(outageMs);
  assert.equal(runner.result(), undefined, runner.status());
  assert.equal(process.kill(pid, 0), true);

  await fixture.startProxy();
  const result = await until(runner.result, "recovered result");
  assert.deepEqual([result.is_error, result.result], [false, answer], runner.status());
  assert.equal(runner.child.pid, pid);
  assert.equal(fixture.requests.length, 2);
  assert.ok(fixture.requests[0].key);
  assert.deepEqual(fixture.requests[1], fixture.requests[0], "successor forwards the same request and idempotency key");
  runner.child.stdin.end();
  assert.deepEqual(await runner.exited, [0, null], runner.status());
});

test("startup waits for a missing endpoint across the old deadline and can still be stopped", { timeout:60000 }, async t => {
  const fixture = await proxyFixture(t);
  const original = await fixture.startProxy();
  const command = fixture.command(original);
  await original.close();
  fs.unlinkSync(original.endpointFile);
  const runner = fixture.startRunner(command);
  await until(runner.started, "the runner to start");
  await delay(outageMs);
  assert.deepEqual(runner.messages, [], runner.status());
  assert.equal(runner.child.exitCode, null);

  const successor = await fixture.startProxy();
  runner.ask();
  const result = await until(runner.result, "result after delayed profile");
  assert.deepEqual([result.is_error, result.result], [false, answer], runner.status());
  runner.child.stdin.end();
  assert.deepEqual(await runner.exited, [0, null], runner.status());

  const stopCommand = fixture.command(successor);
  await successor.close();
  fs.unlinkSync(successor.endpointFile);
  const waiting = fixture.startRunner(stopCommand);
  await until(waiting.started, "the second runner to start");
  await delay(outageMs);
  assert.deepEqual(waiting.messages, [], waiting.status());
  assert.equal(waiting.child.kill("SIGTERM"), true);
  assert.deepEqual(await waiting.exited, process.platform === "win32" ? [null, "SIGTERM"] : [143, null], waiting.status());
  assert.deepEqual(waiting.messages, [], waiting.status());
  assert.equal(fixture.requests.length, 1);
});

test("an absent endpoint can hold an SSE request, and malformed discovery still fails within the live budget", { timeout:10000 }, async t => {
  const { createProxyRelay } = await import("../src/server/project-lines/penecho-runner.mjs");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pe-ro-"));
  t.after(() => fs.rmSync(directory, { recursive:true, force:true }));
  const endpointFile = path.join(directory, "endpoint.json");
  const relay = await createProxyRelay({ secret:"fixture", endpointFile, reconnectMs, pollMs:25 });
  t.after(() => relay.close());
  const response = await fetch(`http://127.0.0.1:${relay.port}/run/fixture/model/v1/chat/completions`, {
    method:"POST", headers:{ authorization:"Bearer fixture" }, body:'{"stream":true}',
    signal:AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const first = await reader.read();
  assert.equal(Buffer.from(first.value).toString(), ": waiting for PenEcho\n\n");
  let nextReceived = false;
  const next = reader.read().then(chunk => { nextReceived = true; return chunk; });
  await delay(outageMs);
  assert.equal(nextReceived, false, "the stream remains open past its former deadline");
  fs.writeFileSync(endpointFile, "{invalid json");
  let text = "";
  for (let chunk = await next; !chunk.done; chunk = await reader.read()) {
    text += Buffer.from(chunk.value);
  }
  assert.match(text, /"code":"proxy_unavailable"/);
});

const ownerFixture = `
const fs = require("node:fs");
const RuntimeOwner = require(${JSON.stringify(require.resolve("../src/server/project-lines/runtime-owner.js"))});
const [directory, mode] = process.argv.slice(1);
if (mode === "pause") {
  const socket = RuntimeOwner.socketPath(directory), unlink = fs.unlinkSync;
  fs.unlinkSync = (file, ...args) => {
    if (file === socket) {
      fs.writeSync(1, "reaping\\n");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20000);
      throw Error("The test did not stop the paused reaper");
    }
    return unlink(file, ...args);
  };
}
const taken = RuntimeOwner.acquire(directory, () => ({ port:1234 }));
fs.writeSync(1, JSON.stringify(taken.release ? { acquired:true } : { owner:taken.owner }) + "\\n");
if (taken.release) {
  process.once("SIGTERM", () => { taken.release(); process.exit(0); });
  setInterval(() => {}, 1000);
}
`;

test("Unix socket reaping stays exclusive through a paused reaper and its crash", { skip:process.platform === "win32", timeout:20000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pe-ro-"));
  const socket = RuntimeOwner.socketPath(directory);
  const legacy = socket + ".reap";
  const children = [];
  t.after(async () => {
    for (const { child } of children) child.kill("SIGKILL");
    await Promise.allSettled(children.map(({ exited }) => exited));
    // The socket can live in /tmp if the chosen state directory has a long path.
    fs.rmSync(legacy, { force:true });
    fs.rmSync(socket, { force:true });
    fs.rmSync(directory, { recursive:true, force:true });
  });
  function owner(mode) {
    const child = spawn(process.execPath, ["-e", ownerFixture, directory, mode], { stdio:["ignore", "pipe", "inherit"] });
    const reader = createInterface({ input:child.stdout });
    const entry = { child, line:once(reader, "line").then(([line]) => line), exited:once(child, "close") };
    children.push(entry);
    return entry;
  }
  const past = new Date(Date.now() - 60000);
  function ageLegacyLock() { fs.utimesSync(legacy, past, past); }

  const previous = owner("normal");
  assert.deepEqual(JSON.parse(await previous.line), { acquired:true });
  previous.child.kill("SIGKILL");
  assert.deepEqual(await previous.exited, [null, "SIGKILL"]);
  assert.ok(fs.statSync(socket).isSocket());
  fs.writeFileSync(legacy, String(previous.child.pid));
  ageLegacyLock();

  const reaper = owner("pause");
  assert.equal(await reaper.line, "reaping");
  // Simulate the old deadline passing while the first reaper is paused at the stale unlink.
  ageLegacyLock();
  const contender = owner("normal");
  assert.deepEqual(JSON.parse(await contender.line), { owner:{} });
  assert.deepEqual(await contender.exited, [0, null]);

  reaper.child.kill("SIGKILL");
  assert.deepEqual(await reaper.exited, [null, "SIGKILL"]);
  const successor = owner("normal");
  assert.deepEqual(JSON.parse(await successor.line), { acquired:true });
  assert.deepEqual(JSON.parse(await owner("normal").line), { owner:{ pid:successor.child.pid, port:1234 } });

  successor.child.kill("SIGTERM");
  assert.deepEqual(await successor.exited, [0, null]);
  const next = owner("normal");
  assert.deepEqual(JSON.parse(await next.line), { acquired:true });
  next.child.kill("SIGTERM");
  assert.deepEqual(await next.exited, [0, null]);
});
