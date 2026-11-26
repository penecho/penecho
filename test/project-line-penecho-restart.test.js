"use strict";
require("./helpers/safety.js");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { test, after } = require("node:test");
const { createModelProxy } = require("../src/server/agent-core/model-proxy.js");
const { createPenEchoSource } = require("../src/server/agent-core/penecho-source.js");
const { createAgents } = require("../src/server/project-lines/agents.js");

const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pe-restart-")));
const closing = [];
after(async () => {
  for (const close of closing.reverse()) {
    try { await close(); } catch { /* Best-effort cleanup. */ }
  }
  fs.rmSync(temp, { recursive:true, force:true });
});

const ACCOUNT_TOKEN = "account-token-restart-test";
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(check, label, ms = 30_000) {
  const start = Date.now();
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}`);
    await wait(30);
  }
}

function stubModel(steps) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      const request = { url:req.url, method:req.method, headers:req.headers, body:JSON.parse(body || "{}") };
      requests.push(request);
      const step = typeof steps === "function"
        ? steps(request, requests.length)
        : steps[Math.min(requests.length - 1, steps.length - 1)];
      if (step && typeof step.handle === "function") return step.handle(req, res, request);
      const model = request.body.model || "stub-model";
      const base = { id:`chatcmpl-${requests.length}`, object:"chat.completion.chunk", created:1, model };
      if (step?.status) {
        res.writeHead(step.status, { "content-type":"application/json" });
        return res.end(JSON.stringify({ error:{ message:step.message || "failed" } }));
      }
      const chunks = step?.tool
        ? [
          { ...base, choices:[{ index:0, delta:{ role:"assistant", tool_calls:[{ index:0, id:`call_${requests.length}`, type:"function", function:{ name:step.tool, arguments:JSON.stringify(step.args) } }] }, finish_reason:null }] },
          { ...base, choices:[{ index:0, delta:{}, finish_reason:"tool_calls" }] },
        ]
        : [
          { ...base, choices:[{ index:0, delta:{ role:"assistant", content:step?.text || "OK." }, finish_reason:null }] },
          { ...base, choices:[{ index:0, delta:{}, finish_reason:"stop" }] },
        ];
      res.writeHead(200, { "content-type":"text/event-stream" });
      res.end(`${chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`);
    });
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => {
    closing.push(() => new Promise(done => { server.closeAllConnections?.(); server.close(() => done()); }));
    resolve({ requests, url:`http://127.0.0.1:${server.address().port}/v1` });
  }));
}

function cloudSourceFor(url, options = {}) {
  const hostedCatalog = { models:[{ id:"stub-model", apiFormat:"openai", worker:true }] };
  const connector = {
    hostedCatalog,
    status:() => ({ accountSession:{ signedIn:true } }),
    refreshHostedCatalog:async () => hostedCatalog,
    hostedModels:async () => ({ ...hostedCatalog, credits:100 }),
    prepareHostedConnection:async id => ({ id, provider:"api", apiFormat:"openai", apiUrl:url, apiModel:id.slice(7), apiKey:ACCOUNT_TOKEN, hosted:true }),
  };
  return createPenEchoSource({ cloud:() => connector, ...options });
}

const userLine = text => `${JSON.stringify({ type:"user", message:{ role:"user", content:[{ type:"text", text }] } })}\n`;

test("model-proxy persists live runs with 0600, survives close()+restart on a new port, and removes runs on end()/done", async () => {
  const stateDir = path.join(temp, "persist-state");
  const model = await stubModel([{ text:"From proxy 1" }, { text:"From proxy 2" }]);
  const source1 = cloudSourceFor(model.url, { stateDir });
  await source1.listening;

  const proxyDir = path.join(stateDir, "project-lines", "model-proxy");
  const runsFile = path.join(proxyDir, "runs.json");
  const endpointFile = path.join(proxyDir, "endpoint.json");
  assert.equal(source1.endpointFile, endpointFile);

  const run = source1.open({ pick:"stub-model", effort:"medium" });
  assert.equal(run.endpointFile, endpointFile);
  assert.ok(fs.existsSync(runsFile));
  assert.ok(fs.existsSync(endpointFile));
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(runsFile).mode & 0o777, 0o600, "runs.json must be 0600");
    assert.equal(fs.statSync(endpointFile).mode & 0o777, 0o600, "endpoint.json must be 0600");
    assert.equal(fs.statSync(proxyDir).mode & 0o777, 0o700, "model-proxy dir must be 0700");
  }
  const port1 = JSON.parse(fs.readFileSync(endpointFile, "utf8")).port;
  assert.ok(port1 > 0);

  // Record a live PID via /profile on proxy 1.
  const prof1 = await fetch(`${run.url}/profile`, {
    headers:{ authorization:`Bearer ${run.secret}`, "x-penecho-runner-pid":String(process.pid) },
  });
  assert.equal(prof1.status, 200);
  const prof1Body = await prof1.json();
  assert.ok(prof1Body.config.baseURL.startsWith(run.url));

  // Close proxy 1 (simulating PenEcho server shutdown): runs.json MUST retain the live run!
  await source1.close();
  const savedAfterClose = JSON.parse(fs.readFileSync(runsFile, "utf8"));
  assert.ok(savedAfterClose.runs[run.id], "close() must not delete live runs from disk");
  assert.equal(savedAfterClose.runs[run.id].pid, process.pid);

  // Start proxy 2 with the same stateDir (binds a new ephemeral port).
  const source2 = cloudSourceFor(model.url, { stateDir });
  closing.push(() => source2.close());
  await source2.listening;
  const port2 = JSON.parse(fs.readFileSync(endpointFile, "utf8")).port;
  assert.ok(port2 > 0 && port2 !== port1, "proxy 2 listens on a new port");

  // Proxy 2 serves /profile and /model/chat/completions with the original run id + secret.
  const base2 = `http://127.0.0.1:${port2}/run/${run.id}`;
  const prof2 = await fetch(`${base2}/profile`, { headers:{ authorization:`Bearer ${run.secret}` } });
  assert.equal(prof2.status, 200);
  const prof2Body = await prof2.json();
  assert.equal(prof2Body.config.baseURL, `${base2}/model`);

  const chatRes = await fetch(`${base2}/model/chat/completions`, {
    method:"POST",
    headers:{ authorization:`Bearer ${run.secret}`, "content-type":"application/json", "x-penecho-call-id":"call-abc-1" },
    body:JSON.stringify({ model:"stub-model", messages:[{ role:"user", content:"hi" }], stream:true }),
  });
  assert.equal(chatRes.status, 200);
  assert.match(await chatRes.text(), /From proxy 1/);
  assert.equal(model.requests[0].headers["idempotency-key"], `pe-${run.id}-call-abc-1`);

  // POST /done removes the run from disk as well as memory.
  const doneRes = await fetch(`${base2}/done`, { method:"POST", headers:{ authorization:`Bearer ${run.secret}` } });
  assert.equal(doneRes.status, 200);
  assert.equal(JSON.parse(fs.readFileSync(runsFile, "utf8")).runs[run.id], undefined);
  const afterDone = await fetch(`${base2}/profile`, { headers:{ authorization:`Bearer ${run.secret}` } });
  assert.equal(afterDone.status, 401);

  // end(id) also removes a run from disk.
  const run2 = source2.open({});
  assert.ok(JSON.parse(fs.readFileSync(runsFile, "utf8")).runs[run2.id]);
  source2.end(run2.id);
  assert.equal(JSON.parse(fs.readFileSync(runsFile, "utf8")).runs[run2.id], undefined);
});

test("model-proxy prunes dead PIDs on reload and preserves idempotency-key via x-penecho-call-id across restarts", async () => {
  const stateDir = path.join(temp, "prune-state");
  const model = await stubModel([{ text:"Answer 1" }, { text:"Answer 2" }]);
  const makeProxy = () => createModelProxy({
    stateDir,
    connect:async () => ({ apiFormat:"openai", apiUrl:model.url, apiKey:ACCOUNT_TOKEN, apiModel:"stub-model", hosted:true }),
    describe:async (c, { baseURL }) => ({ provider:"api", model:c.apiModel, apiKeyEnv:"K", config:{ baseURL } }),
    target:async c => c.apiUrl,
  });

  // Spawn a child that is alive when /profile records its PID, then exits before proxy #2 reloads.
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"]);
  const deadPid = child.pid;
  const childExited = new Promise(resolve => child.on("close", resolve));

  const proxy1 = makeProxy();
  await proxy1.listening;
  const deadRun = proxy1.open({});
  const liveRun = proxy1.open({});

  await fetch(`${deadRun.url}/profile`, { headers:{ authorization:`Bearer ${deadRun.secret}`, "x-penecho-runner-pid":String(deadPid) } });
  await fetch(`${liveRun.url}/profile`, { headers:{ authorization:`Bearer ${liveRun.secret}`, "x-penecho-runner-pid":String(process.pid) } });

  const runsFile = path.join(stateDir, "project-lines", "model-proxy", "runs.json");
  assert.equal(JSON.parse(fs.readFileSync(runsFile, "utf8")).runs[deadRun.id].pid, deadPid);

  const callId = "stable-call-42";
  const res1 = await fetch(`${liveRun.url}/model/chat/completions`, {
    method:"POST",
    headers:{ authorization:`Bearer ${liveRun.secret}`, "content-type":"application/json", "x-penecho-call-id":callId },
    body:JSON.stringify({ messages:[{ role:"user", content:"one" }], stream:true }),
  });
  assert.equal(res1.status, 200);
  await res1.text();
  await proxy1.close();

  child.kill("SIGKILL");
  await childExited;

  const proxy2 = makeProxy();
  closing.push(() => proxy2.close());
  await proxy2.listening;
  assert.equal(proxy2.count(), 1, "dead-PID run pruned on startup, live-PID run kept");
  assert.equal(JSON.parse(fs.readFileSync(runsFile, "utf8")).runs[deadRun.id], undefined, "dead-PID run removed from runs.json on reload");

  const deadCheck = await fetch(`http://127.0.0.1:${proxy2.port}/run/${deadRun.id}/profile`, { headers:{ authorization:`Bearer ${deadRun.secret}` } });
  assert.equal(deadCheck.status, 401, "dead-PID run is rejected after reload");

  const res2 = await fetch(`http://127.0.0.1:${proxy2.port}/run/${liveRun.id}/model/chat/completions`, {
    method:"POST",
    headers:{ authorization:`Bearer ${liveRun.secret}`, "content-type":"application/json", "x-penecho-call-id":callId },
    body:JSON.stringify({ messages:[{ role:"user", content:"one" }], stream:true }),
  });
  assert.equal(res2.status, 200);
  await res2.text();
  assert.equal(model.requests.length, 2);
  assert.equal(model.requests[0].headers["idempotency-key"], `pe-${liveRun.id}-${callId}`);
  assert.equal(model.requests[1].headers["idempotency-key"], `pe-${liveRun.id}-${callId}`);
});

test("penecho-runner survives a PenEcho proxy restart across turns and strips PENECHO_MODEL_PROXY_ENDPOINT from shell env", async () => {
  const stateDir = path.join(temp, "e2e-state");
  const workdir = path.join(temp, "e2e-work");
  const docs = path.join(temp, "e2e-docs");
  for (const dir of [stateDir, workdir, docs]) fs.mkdirSync(dir, { recursive:true });

  const model = await stubModel([
    { tool:"bash", args:{ command:"node -e \"for (const [k, v] of Object.entries(process.env)) console.log(k + '=' + v)\"" } },
    { text:"Turn 1 complete." },
    { text:"Turn 2 complete after restart." },
  ]);

  const source1 = cloudSourceFor(model.url, { stateDir });
  await source1.listening;
  const agents = createAgents({ env:process.env, paths:{ penecho:source1, stateDir }, appFolders:[] });
  const command = agents.command("penecho", { workdir, docs, instructions:"Be concise." });
  assert.equal(command.env.PENECHO_MODEL_PROXY_ENDPOINT, source1.endpointFile);

  const child = spawn(command.command, command.args, {
    cwd:command.cwd,
    env:{ ...process.env, ...command.env, PENECHO_PROXY_RECONNECT_MS:"15000", PENECHO_PROXY_POLL_MS:"50" },
    stdio:["pipe", "pipe", "pipe"],
  });
  closing.push(() => { try { child.kill("SIGKILL"); } catch { /* Already exited. */ } });

  const lines = [];
  let stdoutBuf = "", stderr = "";
  child.stdout.on("data", chunk => {
    stdoutBuf += chunk.toString("utf8");
    const parts = stdoutBuf.split("\n");
    stdoutBuf = parts.pop() || "";
    for (const part of parts) if (part.trim()) lines.push(JSON.parse(part));
  });
  child.stderr.on("data", chunk => { stderr += chunk.toString("utf8"); });
  const exited = new Promise(resolve => child.on("close", code => resolve(code)));

  // Turn 1 on proxy #1.
  child.stdin.write(userLine("Check env and say done."));
  await until(() => lines.filter(l => l.type === "result").length >= 1, "turn 1 result");
  const turn1 = lines.filter(l => l.type === "result")[0];
  assert.deepEqual([turn1.is_error, turn1.result], [false, "Turn 1 complete."], stderr);

  // Verify neither secret nor PENECHO_MODEL_PROXY_ENDPOINT leaked to child shell env.
  const toolResult = lines.find(l => l.type === "user")?.message?.content?.[0]?.content || "";
  assert.match(toolResult, /^PATH=/m);
  assert.doesNotMatch(toolResult, /PENECHO_MODEL_PROXY/i);
  assert.doesNotMatch(toolResult, new RegExp(command.env.PENECHO_MODEL_PROXY_SECRET));

  // Simulate PenEcho restart: close proxy #1, send turn 2 while proxy is completely down, then start proxy #2.
  const oldPort = JSON.parse(fs.readFileSync(source1.endpointFile, "utf8")).port;
  await source1.close();
  child.stdin.write(userLine("Continue after restart."));
  await wait(300);

  const source2 = cloudSourceFor(model.url, { stateDir });
  closing.push(() => source2.close());
  await source2.listening;
  const newPort = JSON.parse(fs.readFileSync(source2.endpointFile, "utf8")).port;
  assert.notEqual(newPort, oldPort);

  await until(() => lines.filter(l => l.type === "result").length >= 2, "turn 2 result");
  const turn2 = lines.filter(l => l.type === "result")[1];
  assert.deepEqual([turn2.is_error, turn2.result], [false, "Turn 2 complete after restart."], stderr);

  child.stdin.end();
  const code = await exited;
  assert.equal(code, 0, stderr);
  assert.equal(model.requests.length, 3);
});

test("penecho-runner retries seamlessly with the same idempotency-key if proxy restarts after sending SSE keepalives", async () => {
  const stateDir = path.join(temp, "keepalive-restart-state");
  const workdir = path.join(temp, "keepalive-restart-work");
  for (const dir of [stateDir, workdir]) fs.mkdirSync(dir, { recursive:true });

  let firstHeldRes = null;
  const model = await stubModel((request, n) => {
    if (n === 1) {
      return {
        handle(req, res) {
          // Hold the first upstream attempt open so proxy #1 emits `: keepalive\n\n`, then gets closed.
          firstHeldRes = res;
        },
      };
    }
    return { text:"Recovered mid-stream." };
  });
  closing.push(() => { try { firstHeldRes?.destroy(); } catch { /* Ignore. */ } });

  const source1 = cloudSourceFor(model.url, { stateDir, keepaliveMs:50 });
  await source1.listening;
  const agents = createAgents({ env:process.env, paths:{ penecho:source1, stateDir }, appFolders:[] });
  const command = agents.command("penecho", { workdir, docs:workdir });

  const child = spawn(command.command, command.args, {
    cwd:command.cwd,
    env:{ ...process.env, ...command.env, PENECHO_PROXY_RECONNECT_MS:"15000", PENECHO_PROXY_POLL_MS:"50" },
    stdio:["pipe", "pipe", "pipe"],
  });
  closing.push(() => { try { child.kill("SIGKILL"); } catch { /* Already exited. */ } });

  const lines = [];
  let stdoutBuf = "", stderr = "";
  child.stdout.on("data", chunk => {
    stdoutBuf += chunk.toString("utf8");
    const parts = stdoutBuf.split("\n");
    stdoutBuf = parts.pop() || "";
    for (const part of parts) if (part.trim()) lines.push(JSON.parse(part));
  });
  child.stderr.on("data", chunk => { stderr += chunk.toString("utf8"); });
  const exited = new Promise(resolve => child.on("close", code => resolve(code)));

  child.stdin.write(userLine("Wait through a restart."));
  await until(() => model.requests.length === 1, "first upstream request");
  // Let proxy #1 emit at least one `: keepalive\n\n` comment to the runner relay.
  await wait(160);
  // Abruptly shut down proxy #1 and its upstream socket, simulating a PenEcho server restart.
  firstHeldRes?.destroy();
  const closing1 = source1.close();
  // Wait briefly, then bring up proxy #2 on a new port with the same stateDir.
  await wait(150);
  const source2 = cloudSourceFor(model.url, { stateDir, keepaliveMs:50 });
  closing.push(() => source2.close());
  await source2.listening;
  await closing1;

  await until(() => lines.filter(l => l.type === "result").length >= 1, "recovered result");
  const res = lines.find(l => l.type === "result");
  assert.deepEqual([res.is_error, res.result], [false, "Recovered mid-stream."], stderr);
  assert.equal(model.requests.length, 2);
  assert.equal(model.requests[1].headers["idempotency-key"], model.requests[0].headers["idempotency-key"], "retried call preserves idempotency-key across restart");

  child.stdin.end();
  assert.equal(await exited, 0, stderr);
});

test("R2 & R26: concurrent proxies preserve overlapping opens, propagate deletions across instances, and keep zero retained deletion state", async () => {
  const stateDir = path.join(temp, "concurrent-state");
  const model = await stubModel([{ text:"OK" }]);
  const makeProxy = () => createModelProxy({
    stateDir,
    connect:async () => ({ apiFormat:"openai", apiUrl:model.url, apiKey:ACCOUNT_TOKEN, apiModel:"stub-model", hosted:true }),
    describe:async (c, { baseURL }) => ({ provider:"api", model:c.apiModel, apiKeyEnv:"K", config:{ baseURL } }),
    target:async c => c.apiUrl,
  });

  // 1) Two separate child processes simultaneously opening 8 runs each against the same stateDir: ALL 16 must survive!
  const workerCode = `
    const { createModelProxy } = require(${JSON.stringify(path.resolve("src/server/agent-core/model-proxy.js"))});
    (async () => {
      const p = createModelProxy({ stateDir: process.argv[1], connect: async () => ({}), describe: async () => ({}), target: async () => "" });
      await p.listening;
      const ids = [];
      for (let i = 0; i < 8; i++) ids.push(p.open({ pick: "m-" + process.pid + "-" + i }).id);
      process.stdout.write(JSON.stringify(ids));
      await p.close();
    })().catch(e => { console.error(e); process.exit(1); });
  `;
  const runWorker = () => new Promise((resolve, reject) => {
    const c = spawn(process.execPath, ["-e", workerCode, stateDir], { stdio:["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    c.stdout.on("data", d => { out += d; });
    c.stderr.on("data", d => { err += d; });
    c.on("close", code => code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err || `exit ${code}`)));
  });
  const [idsA, idsB] = await Promise.all([runWorker(), runWorker()]);
  const runsFile = path.join(stateDir, "project-lines", "model-proxy", "runs.json");
  const savedAfterParallel = JSON.parse(fs.readFileSync(runsFile, "utf8")).runs;
  for (const id of [...idsA, ...idsB]) assert.ok(savedAfterParallel[id], `concurrent run ${id} must survive`);

  // 2) Cross-instance deletion: proxyA loads R1, proxyB ends R1, proxyA must immediately reject R1 with 401 and NEVER recreate R1 on unrelated open/touch!
  const proxyA = makeProxy(), proxyB = makeProxy();
  closing.push(() => proxyA.close(), () => proxyB.close());
  await Promise.all([proxyA.listening, proxyB.listening]);
  const r1 = proxyA.open({ pick:"stub-model" });
  const okA = await fetch(`http://127.0.0.1:${proxyA.port}/run/${r1.id}/profile`, { headers:{ authorization:`Bearer ${r1.secret}` } });
  assert.equal(okA.status, 200);
  proxyB.end(r1.id);
  const deniedA = await fetch(`http://127.0.0.1:${proxyA.port}/run/${r1.id}/profile`, { headers:{ authorization:`Bearer ${r1.secret}` } });
  assert.equal(deniedA.status, 401, "ended run must be rejected immediately on the other proxy instance");
  const r2 = proxyA.open({ pick:"stub-model" });
  const afterUnrelated = JSON.parse(fs.readFileSync(runsFile, "utf8")).runs;
  assert.equal(afterUnrelated[r1.id], undefined, "unrelated open on stale proxy must never resurrect ended run");
  assert.ok(afterUnrelated[r2.id], "new run persisted");

  // 3) Sustained open/end cycles leave zero retained state in durable and in-memory modes.
  for (const id of [...idsA, ...idsB, r2.id]) proxyA.end(id);
  for (let i = 0; i < 40; i++) { const tmpRun = proxyA.open({}); proxyA.end(tmpRun.id); }
  assert.equal(proxyA.count(), 0);
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(runsFile, "utf8")).runs).length, 0);

  const memProxy = createModelProxy({ connect:async () => ({}), describe:async () => ({}), target:async () => "" });
  closing.push(() => memProxy.close());
  await memProxy.listening;
  for (let i = 0; i < 40; i++) { const r = memProxy.open({}); memProxy.end(r.id); }
  assert.equal(memProxy.count(), 0);
});

test("R3: standby proxy does not publish endpoint or accept calls before activation, close does not unlink successor endpoint, and takeover handles 402 credit-hold", async () => {
  const stateDir = path.join(temp, "standby-state");
  const model = await stubModel([
    { status:402, message:"Add credits." },
  ]);
  const owner = cloudSourceFor(model.url, { stateDir, publishEndpoint:true });
  await owner.listening;
  const endpointFile = owner.endpointFile;
  const epBefore = JSON.parse(fs.readFileSync(endpointFile, "utf8"));

  // Standby starts with publishEndpoint:false -> MUST NOT overwrite endpoint.json or open runs!
  const standby = cloudSourceFor(model.url, { stateDir, publishEndpoint:false });
  await standby.listening;
  assert.equal(standby.active(), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(endpointFile, "utf8")), epBefore, "standby must not hijack endpoint.json");
  assert.throws(() => standby.open({}), { code:"PROXY_INACTIVE" });

  // Closing standby must NOT touch owner's endpoint.json.
  await standby.close();
  assert.deepEqual(JSON.parse(fs.readFileSync(endpointFile, "utf8")), epBefore, "closing standby must leave owner endpoint intact");

  // Open a live run on owner, then simulate takeover by successor.
  const run = owner.open({ pick:"stub-model" });
  const successor = cloudSourceFor(model.url, { stateDir, publishEndpoint:false });
  closing.push(() => successor.close());
  await successor.listening;
  assert.equal(JSON.parse(fs.readFileSync(endpointFile, "utf8")).port, epBefore.port, "unactivated successor leaves old endpoint alone");

  // Activate successor BEFORE closing owner (simulating overlap), then close owner -> owner MUST NOT unlink successor's endpoint!
  const activated = successor.activate();
  assert.equal(JSON.parse(fs.readFileSync(endpointFile, "utf8")).port, activated.port);
  await owner.close();
  assert.equal(JSON.parse(fs.readFileSync(endpointFile, "utf8")).port, activated.port, "closing old owner must never unlink successor's endpoint.json");

  // Exercise 402 credit-hold on successor: successor records refusal in its own refusal map.
  const res402 = await fetch(`http://127.0.0.1:${activated.port}/run/${run.id}/model/chat/completions`, {
    method:"POST",
    headers:{ authorization:`Bearer ${run.secret}`, "content-type":"application/json" },
    body:JSON.stringify({ messages:[{ role:"user", content:"hi" }], stream:true }),
  });
  assert.equal(res402.status, 402);
  assert.ok(successor.refused(run.id), "owning successor recorded 402 refusal");
});

test("R4, R6, R7: relay authenticates proxy before sending secrets/body, handles missing/rogue endpoints, starts outage budget at first disconnect, and never corrupts SSE at any byte boundary", async () => {
  const { createProxyRelay } = await import("../src/server/project-lines/penecho-runner.mjs");
  const { proxyIdentityProof } = require("../src/server/agent-core/model-proxy.js");

  // 1) R4: Rogue listener on reused port + missing endpoint.json + verified /done.
  const rogueSeen = [];
  const rogueServer = http.createServer((req, res) => {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => {
      rogueSeen.push({ method:req.method, url:req.url, auth:req.headers.authorization || "", apiKey:req.headers["x-api-key"] || "", body });
      res.writeHead(200, { "content-type":"application/json" });
      res.end(JSON.stringify({ ok:true, instanceId:"rogue", proof:"forged" }));
    });
  });
  await new Promise(r => rogueServer.listen(0, "127.0.0.1", r));
  closing.push(() => new Promise(r => { rogueServer.closeAllConnections?.(); rogueServer.close(() => r()); }));

  const epDir = path.join(temp, "r4-ep");
  fs.mkdirSync(epDir, { recursive:true });
  const endpointFile = path.join(epDir, "endpoint.json");
  // Stale endpoint pointing at rogue port with legitimate proxyToken.
  fs.writeFileSync(endpointFile, JSON.stringify({ port:rogueServer.address().port, pid:process.pid, instanceId:"real-inst", proxyToken:"real-token", updatedAt:Date.now() }));

  const relay1 = await createProxyRelay({ initialOrigin:`http://127.0.0.1:${rogueServer.address().port}`, secret:"top-secret-run", endpointFile, reconnectMs:250, pollMs:30, handshakeMs:150 });
  closing.push(() => relay1.close());
  const badRes = await fetch(`http://127.0.0.1:${relay1.port}/run/11111111-1111-1111-1111-111111111111/model/chat/completions`, {
    method:"POST",
    headers:{ authorization:"Bearer top-secret-run", "content-type":"application/json" },
    body:JSON.stringify({ messages:[{ role:"user", content:"PRIVATE PROMPT" }], stream:true }),
  });
  assert.equal(badRes.status, 503);
  const doneOk = await relay1.sendDone("/run/11111111-1111-1111-1111-111111111111", 200);
  assert.equal(doneOk, false, "/done must refuse unverified rogue listener");
  assert.ok(rogueSeen.length >= 1, "rogue saw only identity probes");
  for (const hit of rogueSeen) {
    assert.match(hit.url, /^\/identity\?nonce=/, "rogue must only ever see /identity");
    assert.equal(hit.auth, "", "bearer secret must NEVER be sent to unverified listener");
    assert.equal(hit.apiKey, "", "x-api-key must NEVER be sent to unverified listener");
    assert.equal(hit.body, "", "request body must NEVER be sent to unverified listener");
  }

  // Missing endpointFile waits until valid endpoint appears (does NOT fall back to unverified initialOrigin).
  fs.unlinkSync(endpointFile);
  const stateDir = path.join(temp, "r4-recover");
  const realModel = await stubModel([{ text:"Verified answer." }]);
  const realProxy = cloudSourceFor(realModel.url, { stateDir });
  closing.push(() => realProxy.close());
  await realProxy.listening;
  const realRun = realProxy.open({ pick:"stub-model" });
  const relay2 = await createProxyRelay({ initialOrigin:`http://127.0.0.1:${rogueServer.address().port}`, secret:realRun.secret, endpointFile, reconnectMs:3000, pollMs:30, handshakeMs:300 });
  closing.push(() => relay2.close());
  setTimeout(() => { fs.copyFileSync(realProxy.endpointFile, endpointFile); }, 120);
  const recRes = await fetch(`http://127.0.0.1:${relay2.port}/run/${realRun.id}/model/chat/completions`, {
    method:"POST",
    headers:{ authorization:`Bearer ${realRun.secret}`, "content-type":"application/json" },
    body:JSON.stringify({ messages:[{ role:"user", content:"hi" }], stream:true }),
  });
  assert.equal(recRes.status, 200);
  assert.match(await recRes.text(), /Verified answer\./);

  // 2) R6: Healthy keepalive stream longer than reconnectMs + transient 503 vs terminal 400 + unresponsive peer.
  const tok = "tok-r6", inst = "inst-r6";
  let r6Mode = "long-keepalive-cut", r6Calls = 0;
  const r6Server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    if (u.pathname === "/identity") {
      if (r6Mode === "hang-identity") return; // Accept and never answer!
      const nonce = u.searchParams.get("nonce");
      res.writeHead(200, { "content-type":"application/json" });
      return res.end(JSON.stringify({ ok:true, instanceId:inst, port:r6Server.address().port, keepaliveMs:50, proof:proxyIdentityProof(tok, nonce, r6Server.address().port, inst) }));
    }
    r6Calls++;
    if (r6Mode === "long-keepalive-cut" && r6Calls === 1) {
      res.writeHead(200, { "content-type":"text/event-stream" });
      res.write(": keepalive\n\n");
      // Exceed reconnectMs (250ms) during a healthy keepalive stream, THEN drop cleanly -> outage budget starts NOW!
      setTimeout(() => { res.write(": keepalive\n\n"); }, 150);
      setTimeout(() => { res.end(); }, 420);
      return;
    }
    if (r6Mode === "transient-503" && r6Calls === 1) {
      res.writeHead(503, { "content-type":"application/json", "x-penecho-proxy-retry":"1" });
      return res.end(JSON.stringify({ error:{ message:"Restarting" } }));
    }
    if (r6Mode === "final-400") {
      res.writeHead(400, { "content-type":"application/json", "x-penecho-proxy-final":"1" });
      return res.end(JSON.stringify({ error:{ message:"Bad request" } }));
    }
    res.writeHead(200, { "content-type":"text/event-stream" });
    res.end('data: {"choices":[{"delta":{"content":"Recovered"}}]}\n\ndata: [DONE]\n\n');
  });
  await new Promise(r => r6Server.listen(0, "127.0.0.1", r));
  closing.push(() => new Promise(r => { r6Server.closeAllConnections?.(); r6Server.close(() => r()); }));
  const r6Ep = path.join(epDir, "r6-endpoint.json");
  fs.writeFileSync(r6Ep, JSON.stringify({ port:r6Server.address().port, pid:process.pid, instanceId:inst, proxyToken:tok, updatedAt:Date.now() }));
  const relayR6 = await createProxyRelay({ secret:"s6", endpointFile:r6Ep, reconnectMs:250, pollMs:25, handshakeMs:150 });
  closing.push(() => relayR6.close());

  const longRes = await fetch(`http://127.0.0.1:${relayR6.port}/run/22222222-2222-2222-2222-222222222222/model/chat/completions`, {
    method:"POST", headers:{ authorization:"Bearer s6", "content-type":"application/json" }, body:JSON.stringify({ stream:true }),
  });
  assert.equal(longRes.status, 200);
  assert.match(await longRes.text(), /Recovered/);
  assert.equal(r6Calls, 2, "outage budget started at disconnect after 420ms healthy stream (> 250ms reconnectMs)");

  r6Mode = "transient-503"; r6Calls = 0;
  const res503 = await fetch(`http://127.0.0.1:${relayR6.port}/run/22222222-2222-2222-2222-222222222222/model/chat/completions`, {
    method:"POST", headers:{ authorization:"Bearer s6", "content-type":"application/json" }, body:JSON.stringify({ stream:true }),
  });
  assert.equal(res503.status, 200);
  assert.equal(r6Calls, 2, "restart-related 503 retried seamlessly");

  r6Mode = "final-400"; r6Calls = 0;
  const res400 = await fetch(`http://127.0.0.1:${relayR6.port}/run/22222222-2222-2222-2222-222222222222/model/chat/completions`, {
    method:"POST", headers:{ authorization:"Bearer s6", "content-type":"application/json" }, body:JSON.stringify({ stream:true }),
  });
  assert.equal(res400.status, 400);
  assert.equal(r6Calls, 1, "terminal 400 forwarded immediately without retry");

  r6Mode = "hang-identity"; r6Calls = 0;
  const tStart = Date.now();
  const hungRes = await fetch(`http://127.0.0.1:${relayR6.port}/run/22222222-2222-2222-2222-222222222222/model/chat/completions`, {
    method:"POST", headers:{ authorization:"Bearer s6", "content-type":"application/json" }, body:JSON.stringify({ stream:true }),
  });
  assert.equal(hungRes.status, 503);
  assert.ok(Date.now() - tStart < 2000, "unresponsive peer bounded by handshakeMs + reconnectMs");

  // 3) R7: Split first OpenAI data line and Anthropic event line at EVERY byte boundary before cut -> ZERO SSE corruption!
  const tok7 = "tok-r7", inst7 = "inst-r7";
  let splitLine = "", splitAt = 0, attempt7 = 0, cutAfterCommit = false;
  const r7Server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    if (u.pathname === "/identity") {
      const nonce = u.searchParams.get("nonce");
      res.writeHead(200, { "content-type":"application/json" });
      return res.end(JSON.stringify({ ok:true, instanceId:inst7, port:r7Server.address().port, keepaliveMs:50, proof:proxyIdentityProof(tok7, nonce, r7Server.address().port, inst7) }));
    }
    attempt7++;
    res.writeHead(200, { "content-type":"text/event-stream" });
    if (cutAfterCommit) {
      res.write(splitLine);
      setTimeout(() => res.destroy(), 10);
      return;
    }
    if (attempt7 === 1) {
      res.write(": keepalive\n\n");
      if (splitAt > 0) res.write(splitLine.slice(0, splitAt));
      setTimeout(() => res.destroy(), 5);
      return;
    }
    res.end(`${splitLine}\n`);
  });
  await new Promise(r => r7Server.listen(0, "127.0.0.1", r));
  closing.push(() => new Promise(r => { r7Server.closeAllConnections?.(); r7Server.close(() => r()); }));
  const r7Ep = path.join(epDir, "r7-endpoint.json");
  fs.writeFileSync(r7Ep, JSON.stringify({ port:r7Server.address().port, pid:process.pid, instanceId:inst7, proxyToken:tok7, updatedAt:Date.now() }));
  const relayR7 = await createProxyRelay({ secret:"s7", endpointFile:r7Ep, reconnectMs:2000, pollMs:10, handshakeMs:300 });
  closing.push(() => relayR7.close());

  for (const [label, line] of [["openai", 'data: [DONE]\n'], ["anthropic", 'event: message_stop\n']]) {
    for (let k = 1; k < line.length; k++) {
      splitLine = line; splitAt = k; attempt7 = 0; cutAfterCommit = false;
      const r = await fetch(`http://127.0.0.1:${relayR7.port}/run/33333333-3333-3333-3333-333333333333/model/${label === "anthropic" ? "v1/messages" : "chat/completions"}`, {
        method:"POST", headers:{ authorization:"Bearer s7", "content-type":"application/json" }, body:JSON.stringify({ stream:true }),
      });
      assert.equal(r.status, 200);
      const body = await r.text();
      assert.equal(body, `: keepalive\n\n${line}\n`, `${label} split at byte ${k} must not corrupt SSE line`);
      assert.equal(attempt7, 2);
    }
  }

  // Once a complete payload line is committed downstream, a mid-stream abort must NOT replay over those bytes.
  splitLine = 'data: {"choices":[{"delta":{"content":"First"}}]}\n';
  attempt7 = 0; cutAfterCommit = true;
  await assert.rejects(
    fetch(`http://127.0.0.1:${relayR7.port}/run/33333333-3333-3333-3333-333333333333/model/chat/completions`, {
      method:"POST", headers:{ authorization:"Bearer s7", "content-type":"application/json" }, body:JSON.stringify({ stream:true }),
    }).then(r => r.text()),
    "truncation after payload commit must fail downstream without replaying"
  );
  assert.equal(attempt7, 1, "must NOT retry after payload bytes were already committed");
});

test("R10: persistence errors surface loudly and preserve the last good runs.json instead of overwriting", async () => {
  const stateDir = path.join(temp, "corrupt-state");
  const proxyDir = path.join(stateDir, "project-lines", "model-proxy");
  const runsFile = path.join(proxyDir, "runs.json");
  fs.mkdirSync(proxyDir, { recursive:true });
  const badContent = "{not-valid-json-keep-me";
  fs.writeFileSync(runsFile, badContent);

  const errors = [];
  const proxy = createModelProxy({
    stateDir,
    onError:err => errors.push(err),
    connect:async () => ({}), describe:async () => ({}), target:async () => "",
  });
  closing.push(() => proxy.close());
  await proxy.listening;
  assert.ok(errors.some(e => e.code === "PROXY_STORE_CORRUPT"), "startup load reports corruption");
  assert.throws(() => proxy.open({}), { code:"PROXY_STORE_CORRUPT" }, "open() refuses to return a non-durable run");
  assert.equal(fs.readFileSync(runsFile, "utf8"), badContent, "corrupted file must NOT be overwritten with empty state");
});

test("R17: built-in PenEcho coordinator uses native orchestrate tool across standby 409 and port rotation while keeping pass out of bash", async () => {
  const { expectedOrchProof } = require("../src/server/project-lines/orch-call.js");
  const stateDir = path.join(temp, "builtin-orch-state");
  const workdir = path.join(temp, "builtin-orch-work");
  fs.mkdirSync(stateDir, { recursive:true });
  fs.mkdirSync(workdir, { recursive:true });

  const orchTok = "orch-tok-builtin", orchInst = "orch-inst-builtin";
  const ownerHits = [], standbyPasses = [];
  const ownerOrch = http.createServer((req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    if (req.method === "GET" && u.pathname === "/api/lines/orchestrate/identity") {
      const nonce = u.searchParams.get("nonce") || "";
      res.writeHead(200, { "content-type":"application/json" });
      return res.end(JSON.stringify({ ok:true, instanceId:orchInst, port:ownerOrch.address().port, opDedup:true, proof:expectedOrchProof(orchTok, nonce, ownerOrch.address().port, orchInst) }));
    }
    let body = ""; req.on("data", c => { body += c; });
    req.on("end", () => {
      ownerHits.push({ pass:req.headers["x-penecho-pass"], body:JSON.parse(body || "{}") });
      res.writeHead(200, { "content-type":"application/json" });
      res.end(JSON.stringify({ ok:true, functions:[{ do:"help" }] }));
    });
  });
  await new Promise(r => ownerOrch.listen(0, "127.0.0.1", r));
  closing.push(() => new Promise(r => { ownerOrch.closeAllConnections?.(); ownerOrch.close(() => r()); }));

  const orchEndpoint = path.join(stateDir, "orch-endpoint.json");
  // Standby answers 409 RUNTIME_BUSY on /identity; once hit, rotate endpoint.json to the verified owner.
  const standbyOrch = http.createServer((req, res) => {
    if (req.headers["x-penecho-pass"]) standbyPasses.push(req.headers["x-penecho-pass"]);
    req.resume();
    fs.writeFileSync(orchEndpoint, JSON.stringify({ url:`http://127.0.0.1:${ownerOrch.address().port}/api/lines/orchestrate`, port:ownerOrch.address().port, instanceId:orchInst, orchToken:orchTok }));
    res.writeHead(409, { "content-type":"application/json" });
    res.end(JSON.stringify({ error:"Busy", code:"RUNTIME_BUSY", owner:{ port:ownerOrch.address().port } }));
  });
  await new Promise(r => standbyOrch.listen(0, "127.0.0.1", r));
  closing.push(() => new Promise(r => { standbyOrch.closeAllConnections?.(); standbyOrch.close(() => r()); }));

  fs.writeFileSync(orchEndpoint, JSON.stringify({ url:`http://127.0.0.1:${standbyOrch.address().port}/api/lines/orchestrate`, port:standbyOrch.address().port, instanceId:"standby-inst", orchToken:"standby-tok" }));

  const model = await stubModel([
    { tool:"orchestrate", args:{ payload:JSON.stringify({ do:"help" }) } },
    { tool:"bash", args:{ command:"node -e \"console.log(Object.keys(process.env).filter(k => k.includes('ORCH')).join(','))\"" } },
    { text:"Coordinated cleanly." },
  ]);
  const source = cloudSourceFor(model.url, { stateDir });
  closing.push(() => source.close());
  await source.listening;
  const agents = createAgents({ env:process.env, paths:{ penecho:source, stateDir }, appFolders:[] });
  const command = agents.command("penecho", { workdir, docs:workdir });
  const child = spawn(command.command, command.args, {
    cwd:command.cwd,
    env:{
      ...process.env,
      ...command.env,
      PENECHO_ORCH_URL:`http://127.0.0.1:${standbyOrch.address().port}/api/lines/orchestrate`,
      PENECHO_ORCH_PASS:"secret-orch-pass-123",
      PENECHO_ORCH_ENDPOINT:orchEndpoint,
    },
    stdio:["pipe", "pipe", "pipe"],
  });
  closing.push(() => { try { child.kill("SIGKILL"); } catch {} });

  const lines = [];
  let buf = "", stderr = "";
  child.stdout.on("data", chunk => {
    buf += chunk.toString("utf8");
    const parts = buf.split("\n"); buf = parts.pop() || "";
    for (const part of parts) if (part.trim()) lines.push(JSON.parse(part));
  });
  child.stderr.on("data", chunk => { stderr += chunk; });
  const exited = new Promise(r => child.on("close", r));

  child.stdin.write(userLine("Call orchestrate help and check env."));
  await until(() => lines.some(l => l.type === "result"), "coordinator result");
  const res = lines.find(l => l.type === "result");
  assert.deepEqual([res.is_error, res.result], [false, "Coordinated cleanly."], stderr);
  assert.equal(standbyPasses.length, 0, "orchestrator pass must NEVER be sent to unverified standby before identity handshake");
  assert.equal(ownerHits.length, 1, "orchestrate tool verified and switched to owner port");
  assert.equal(ownerHits[0].pass, "secret-orch-pass-123");
  assert.deepEqual(ownerHits[0].body, { do:"help" });
  const toolResults = lines.filter(l => l.type === "user").map(l => l.message?.content?.[0]?.content || "");
  assert.doesNotMatch(toolResults[1] || "", /PENECHO_ORCH|secret-orch-pass/, "orchestrator pass must NEVER leak into bash env");

  child.stdin.end();
  assert.equal(await exited, 0, stderr);
});

test("Round 2 F4, F5, F6: stale-lock race preserves all runs, usedAt refreshes across 6h, invalid rows fail strict, activate rolls back on error, and 402 survives restart", async () => {
  const { execFile } = require("node:child_process");

  // 1) F4: Two real child processes racing to reap the same stale lock BOTH preserve their opened runs!
  const f4Dir = path.join(temp, "f4-stale-lock");
  const proxyDir = path.join(f4Dir, "project-lines", "model-proxy");
  fs.mkdirSync(proxyDir, { recursive:true, mode:0o700 });
  const lockFile = path.join(proxyDir, "runs.json.lock");
  fs.writeFileSync(lockFile, "999999999:1", { mode:0o600 });
  const oldTime = new Date(Date.now() - 30_000);
  fs.utimesSync(lockFile, oldTime, oldTime);
  const proxyModule = require.resolve("../src/server/agent-core/model-proxy.js");
  const openInChild = label => new Promise((resolve, reject) => {
    execFile(process.execPath, ["-e", `
      const { createModelProxy } = require(${JSON.stringify(proxyModule)});
      (async () => {
        const p = createModelProxy({ stateDir:${JSON.stringify(f4Dir)}, connect:async () => ({}), describe:async () => ({}), target:async () => "" });
        await p.listening;
        const r = p.open({ pick:${JSON.stringify(label)} });
        console.log(JSON.stringify({ id:r.id }));
        await p.close();
      })();
    `], { encoding:"utf8" }, (err, stdout, stderr) => err ? reject(new Error(`${err.message}\n${stderr}`)) : resolve(JSON.parse(stdout.trim())));
  });
  const [childA, childB] = await Promise.all([openInChild("pick-a"), openInChild("pick-b")]);
  const afterRace = JSON.parse(fs.readFileSync(path.join(proxyDir, "runs.json"), "utf8"));
  assert.ok(afterRace.runs[childA.id], "contender A run survived stale-lock race");
  assert.ok(afterRace.runs[childB.id], "contender B run survived stale-lock race");

  // 2) F5a: usedAt persists across >60s calls even with x-penecho-call-id and same pid!
  const f5Dir = path.join(temp, "f5-usedat");
  const stub = await stubModel([{ text:"One" }, { text:"Two" }]);
  const src5 = cloudSourceFor(stub.url, { stateDir:f5Dir });
  closing.push(() => src5.close());
  await src5.listening;
  const r5 = src5.open({ pick:"stub-model" });
  const runs5Path = path.join(f5Dir, "project-lines", "model-proxy", "runs.json");
  // Backdate usedAt by 5 hours on disk, then send a normal relay call WITH x-penecho-call-id and pid!
  const beforeDisk = JSON.parse(fs.readFileSync(runs5Path, "utf8"));
  const fiveHoursAgo = Date.now() - 5 * 60 * 60 * 1000;
  beforeDisk.runs[r5.id].usedAt = fiveHoursAgo;
  beforeDisk.runs[r5.id].pid = process.pid;
  fs.writeFileSync(runs5Path, JSON.stringify(beforeDisk));
  const res5 = await fetch(`${r5.url}/model/chat/completions`, {
    method:"POST",
    headers:{ authorization:`Bearer ${r5.secret}`, "content-type":"application/json", "x-penecho-call-id":"fixed-call-1", "x-penecho-runner-pid":String(process.pid) },
    body:JSON.stringify({ messages:[{ role:"user", content:"hi" }], stream:true }),
  });
  assert.equal(res5.status, 200);
  await res5.text();
  const afterDisk = JSON.parse(fs.readFileSync(runs5Path, "utf8"));
  assert.ok(afterDisk.runs[r5.id].usedAt > fiveHoursAgo + 4 * 60 * 60 * 1000, "usedAt refreshed on disk despite supplied call-id and unchanged pid");

  // 3) F5b: Registry containing one invalid row throws PROXY_STORE_CORRUPT and leaves bytes untouched!
  const badRowDir = path.join(temp, "f5-bad-row");
  const badRowProxyDir = path.join(badRowDir, "project-lines", "model-proxy");
  fs.mkdirSync(badRowProxyDir, { recursive:true });
  const badRowFile = path.join(badRowProxyDir, "runs.json");
  const badPayload = JSON.stringify({
    version:1,
    runs:{
      "11111111-1111-1111-1111-111111111111":{ id:"11111111-1111-1111-1111-111111111111", secret:"ok", pick:"", effort:"", usedAt:Date.now(), pid:0, calls:0 },
      "22222222-2222-2222-2222-222222222222":{ id:"mismatched-id", secret:"bad", usedAt:Date.now() },
    },
  });
  fs.writeFileSync(badRowFile, badPayload);
  const badProxy = createModelProxy({ stateDir:badRowDir, connect:async () => ({}), describe:async () => ({}), target:async () => "" });
  closing.push(() => badProxy.close());
  await badProxy.listening;
  assert.equal(badProxy.active, false, "startup corruption prevents proxy from becoming active/publishing");
  assert.throws(() => badProxy.open({}), { code:"PROXY_STORE_CORRUPT" });
  assert.equal(fs.readFileSync(badRowFile, "utf8"), badPayload, "invalid-row registry preserved untouched on disk");

  // 4) F5c: Failed endpoint activation rolls back active=false and source.ready()=false!
  const actDir = path.join(temp, "f5-act-rollback");
  const srcAct = cloudSourceFor(stub.url, { stateDir:actDir, publishEndpoint:false });
  closing.push(() => srcAct.close());
  await srcAct.listening;
  assert.equal(srcAct.ready(), false, "inactive standby source is not ready()");
  const origRename = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (String(to).endsWith("endpoint.json")) throw Object.assign(new Error("ENOSPC"), { code:"ENOSPC" });
    return origRename(from, to);
  };
  try {
    assert.throws(() => srcAct.activate(), { code:"ENOSPC" });
    assert.equal(srcAct.active(), false, "failed activate() must roll back active to false");
    assert.equal(srcAct.ready(), false, "source.ready() stays false after failed activate()");
    assert.throws(() => srcAct.open({ pick:"stub-model" }), { code:"PROXY_INACTIVE" });
  } finally {
    fs.renameSync = origRename;
  }

  // 5) F6: 402 credit refusal recorded before restart survives on successor proxy even after /done!
  const f6Dir = path.join(temp, "f6-402-handoff");
  const cloud402 = http.createServer((req, res) => {
    req.resume();
    res.writeHead(402, { "content-type":"application/json" });
    res.end(JSON.stringify({ error:"insufficient_credits", details:{ balance:0, required:5 } }));
  });
  await new Promise(r => cloud402.listen(0, "127.0.0.1", r));
  closing.push(() => new Promise(r => { cloud402.closeAllConnections?.(); cloud402.close(() => r()); }));
  const p6a = cloudSourceFor(`http://127.0.0.1:${cloud402.address().port}`, { stateDir:f6Dir });
  await p6a.listening;
  const r6 = p6a.open({ pick:"stub-model" });
  const res402 = await fetch(`${r6.url}/model/chat/completions`, {
    method:"POST", headers:{ authorization:`Bearer ${r6.secret}`, "content-type":"application/json" },
    body:JSON.stringify({ messages:[{ role:"user", content:"hi" }], stream:false }),
  });
  assert.equal(res402.status, 402);
  await res402.text();
  assert.equal(p6a.refused(r6.id)?.error, "insufficient_credits");
  await p6a.close();

  const p6b = cloudSourceFor(`http://127.0.0.1:${cloud402.address().port}`, { stateDir:f6Dir });
  closing.push(() => p6b.close());
  const p6bPort = await p6b.listening;
  // Even after /done deletes the active run, the persisted 402 refusal stays readable for Work finalization!
  const doneRes = await fetch(`http://127.0.0.1:${p6bPort}/run/${r6.id}/done`, { method:"POST", headers:{ authorization:`Bearer ${r6.secret}` } });
  assert.equal(doneRes.status, 200);
  const survived = p6b.refused(r6.id);
  assert.equal(survived?.error, "insufficient_credits", "402 refusal survives restart and /done on successor proxy");
  assert.equal(survived?.details?.required, 5);
});

test("Round 2 F7, F8, F9, F16, F21: fail-closed model identity, stalled verified proxy bounds, slow /profile, Anthropic result_unavailable code, O(N) large SSE line, and Orchestrator AMBIGUOUS_OUTCOME + opId dedup", async () => {
  const { createProxyRelay } = await import("../src/server/project-lines/penecho-runner.mjs");
  const { proxyIdentityProof } = require("../src/server/agent-core/model-proxy.js");
  const { callOrchestrator, expectedOrchProof } = require("../src/server/project-lines/orch-call.js");

  // 1) F8: Fail closed when model proxy identity credentials are missing (even without endpointFile).
  const unauthHits = [];
  const plainListener = http.createServer((req, res) => { unauthHits.push(req.headers.authorization || ""); res.writeHead(200); res.end("leaked"); });
  await new Promise(r => plainListener.listen(0, "127.0.0.1", r));
  closing.push(() => new Promise(r => { plainListener.closeAllConnections?.(); plainListener.close(() => r()); }));
  const failClosedRelay = await createProxyRelay({ initialOrigin:`http://127.0.0.1:${plainListener.address().port}`, secret:"never-leak", reconnectMs:150, pollMs:20 });
  closing.push(() => failClosedRelay.close());
  const fcRes = await fetch(`http://127.0.0.1:${failClosedRelay.port}/run/11111111-1111-1111-1111-111111111111/profile`, { headers:{ authorization:"Bearer never-leak" } });
  assert.equal(fcRes.status, 503);
  assert.equal(unauthHits.length, 0, "relay must NEVER transmit run secret without verified identity credentials");

  // 2) F7 & F21: Verified peer stalling on non-stream POST, headers-only SSE stall, slow healthy /profile, and 64KB multibyte first SSE line!
  const tok = "tok-f7", inst = "inst-f7";
  let mode = "stall-nonstream", hits = 0;
  const bigEmojiText = "🚀你好世界".repeat(4000); // ~64 KiB multibyte UTF-8
  const bigLine = `data: {"choices":[{"delta":{"content":${JSON.stringify(bigEmojiText)}}}]}\n`;
  const f7Server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    if (u.pathname === "/identity") {
      const nonce = u.searchParams.get("nonce") || "";
      res.writeHead(200, { "content-type":"application/json" });
      return res.end(JSON.stringify({ ok:true, instanceId:inst, port:f7Server.address().port, keepaliveMs:50, proof:proxyIdentityProof(tok, nonce, f7Server.address().port, inst) }));
    }
    hits++;
    if (mode === "stall-nonstream") return; // Never sends headers!
    if (mode === "headers-only-sse") { res.writeHead(200, { "content-type":"text/event-stream" }); res.flushHeaders?.(); return; } // Sends headers then stalls!
    if (mode === "slow-profile") {
      setTimeout(() => { res.writeHead(200, { "content-type":"application/json" }); res.end(JSON.stringify({ ok:true, slow:true })); }, 220);
      return;
    }
    if (mode === "big-multibyte-sse") {
      res.writeHead(200, { "content-type":"text/event-stream" });
      const raw = Buffer.from(`${bigLine}\ndata: [DONE]\n\n`, "utf8");
      for (let i = 0; i < raw.length; i += 97) res.write(raw.subarray(i, i + 97));
      res.end();
    }
  });
  await new Promise(r => f7Server.listen(0, "127.0.0.1", r));
  closing.push(() => new Promise(r => { f7Server.closeAllConnections?.(); f7Server.close(() => r()); }));
  const relayF7 = await createProxyRelay({
    initialOrigin:`http://127.0.0.1:${f7Server.address().port}`,
    initialProxyToken:tok,
    initialInstanceId:inst,
    secret:"s7",
    reconnectMs:300,
    pollMs:25,
    handshakeMs:100,
    profileTimeoutMs:500,
    nonStreamTimeoutMs:200,
  });
  closing.push(() => relayF7.close());

  // Non-stream verified-but-silent model POST is bounded instead of hanging forever.
  const t0 = Date.now();
  const rNonStream = await fetch(`http://127.0.0.1:${relayF7.port}/run/11111111-1111-1111-1111-111111111111/model/chat/completions`, {
    method:"POST", headers:{ authorization:"Bearer s7", "content-type":"application/json" }, body:JSON.stringify({ stream:false }),
  });
  assert.equal(rNonStream.status, 503);
  assert.ok(Date.now() - t0 < 2000, "verified-but-silent non-stream request bounded by nonStreamTimeoutMs + reconnectMs");

  // Headers-only SSE stall is detected and bounded.
  mode = "headers-only-sse"; hits = 0;
  const t1 = Date.now();
  const rHeadersOnly = await fetch(`http://127.0.0.1:${relayF7.port}/run/11111111-1111-1111-1111-111111111111/model/chat/completions`, {
    method:"POST", headers:{ authorization:"Bearer s7", "content-type":"application/json" }, body:JSON.stringify({ stream:true }),
  });
  assert.equal(rHeadersOnly.status, 503);
  assert.ok(Date.now() - t1 < 4000, "headers-only SSE stall bounded");

  // Slow healthy /profile succeeds on attempt 1 without premature cutoff.
  mode = "slow-profile"; hits = 0;
  const rSlowProf = await fetch(`http://127.0.0.1:${relayF7.port}/run/11111111-1111-1111-1111-111111111111/profile`, { headers:{ authorization:"Bearer s7" } });
  assert.equal(rSlowProf.status, 200);
  assert.equal((await rSlowProf.json()).slow, true);
  assert.equal(hits, 1, "slow healthy /profile not cut off prematurely");

  // F21: 64KB multibyte first SSE line split across ~660 small chunks arrives intact.
  mode = "big-multibyte-sse"; hits = 0;
  const rBig = await fetch(`http://127.0.0.1:${relayF7.port}/run/11111111-1111-1111-1111-111111111111/model/chat/completions`, {
    method:"POST", headers:{ authorization:"Bearer s7", "content-type":"application/json" }, body:JSON.stringify({ stream:true }),
  });
  assert.equal(rBig.status, 200);
  assert.equal(await rBig.text(), `${bigLine}\ndata: [DONE]\n\n`, "large multibyte first SSE line preserved byte-for-byte");

  // 3) F9: Held Anthropic SSE request_already_completed error event preserves machine-readable code="result_unavailable"!
  let antHits = 0;
  const antCloud = http.createServer((req, res) => {
    req.resume();
    antHits++;
    if (antHits === 1) {
      setTimeout(() => { res.writeHead(409, { "content-type":"application/json" }); res.end(JSON.stringify({ error:{ code:"request_in_progress", message:"Still running" } })); }, 60);
      return;
    }
    res.writeHead(409, { "content-type":"application/json" });
    res.end(JSON.stringify({ error:{ code:"request_already_completed", message:"Already completed" } }));
  });
  await new Promise(r => antCloud.listen(0, "127.0.0.1", r));
  closing.push(() => new Promise(r => { antCloud.closeAllConnections?.(); antCloud.close(() => r()); }));
  const antProxy = createModelProxy({
    keepaliveMs:25,
    backoff:() => 15,
    connect:async () => ({ apiFormat:"anthropic", apiUrl:`http://127.0.0.1:${antCloud.address().port}`, apiKey:"k", apiModel:"claude-test", hosted:true }),
    describe:async () => ({}),
    target:async c => c.apiUrl,
  });
  closing.push(() => antProxy.close());
  await antProxy.listening;
  const antRun = antProxy.open({});
  const antRes = await fetch(`${antRun.url}/model/v1/messages`, {
    method:"POST", headers:{ "x-api-key":antRun.secret, "content-type":"application/json" },
    body:JSON.stringify({ messages:[{ role:"user", content:"hi" }], stream:true }),
  });
  assert.equal(antRes.status, 200, "keepalive opened 200 SSE before terminal error");
  const antText = await antRes.text();
  assert.match(antText, /"code":"result_unavailable"/, "held Anthropic SSE error event retains code=result_unavailable");

  // 4) F16: Mutating Orchestrator call dropped after dispatch surfaces AMBIGUOUS_OUTCOME and NEVER auto-submits twice!
  const oTok = "otok-f16", oInst = "oinst-f16";
  let postCount = 0;
  const dropServer = http.createServer((req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    if (req.method === "GET" && u.pathname === "/api/lines/orchestrate/identity") {
      const nonce = u.searchParams.get("nonce") || "";
      res.writeHead(200, { "content-type":"application/json" });
      return res.end(JSON.stringify({ ok:true, instanceId:oInst, port:dropServer.address().port, opDedup:true, proof:expectedOrchProof(oTok, nonce, dropServer.address().port, oInst) }));
    }
    postCount++;
    req.on("data", () => {});
    req.on("end", () => { res.destroy(); }); // Accepted mutation, then dropped response!
  });
  await new Promise(r => dropServer.listen(0, "127.0.0.1", r));
  closing.push(() => new Promise(r => { dropServer.closeAllConnections?.(); dropServer.close(() => r()); }));
  const epF16 = path.join(temp, "f16-orch-endpoint.json");
  fs.writeFileSync(epF16, JSON.stringify({ url:`http://127.0.0.1:${dropServer.address().port}/api/lines/orchestrate`, port:dropServer.address().port, instanceId:oInst, orchToken:oTok }));
  await assert.rejects(
    callOrchestrator({ pass:"pass-16", endpointFile:epF16, body:{ do:"add-task", line:"l", task:"t", agent:"a", kind:"code" }, retryMs:1000, pollMs:25 }),
    { code:"AMBIGUOUS_OUTCOME" }
  );
  assert.equal(postCount, 1, "mutating call must NOT be automatically resubmitted after ambiguous post-dispatch reset");
});


test("Round 3 F4, F5, F6, F7: per-token reap lock, strict type validation, durable pending-ends, fail-closed 402 refusal, and healthy post-commit SSE idle timer", async t => {
  const crypto = require("node:crypto");

  // 1) F4: Stale primary lock + stale .reap.<hash>.0 owned by dead PID advances to gen 1 cleanly without unlinking a live lock!
  {
    const dir = path.join(temp, "r3-f4");
    const proxyDir = path.join(dir, "project-lines", "model-proxy");
    fs.mkdirSync(proxyDir, { recursive:true });
    const lockFile = path.join(proxyDir, "runs.json.lock");
    const stalePrimary = "999999:1:deadprimary";
    const hash = crypto.createHash("sha256").update(stalePrimary).digest("hex").slice(0, 16);
    const staleReap0 = `${lockFile}.reap.${hash}.0`;
    fs.writeFileSync(lockFile, stalePrimary);
    fs.writeFileSync(staleReap0, "999998:1:deadreaper");
    const old = new Date(Date.now() - 30_000);
    fs.utimesSync(lockFile, old, old);
    fs.utimesSync(staleReap0, old, old);

    const p1 = createModelProxy({ stateDir:dir, connect:async () => ({}), describe:async () => ({}), target:async () => "" });
    const p2 = createModelProxy({ stateDir:dir, connect:async () => ({}), describe:async () => ({}), target:async () => "" });
    closing.push(() => p1.close(), () => p2.close());
    await Promise.all([p1.listening, p2.listening]);
    const r1 = p1.open({ pick:"m" }), r2 = p2.open({ pick:"m" });
    assert.ok(r1.id && r2.id);
    assert.equal(p1.count(), 2, "both concurrent proxies acquired lock cleanly past stale primary + stale reap.0");
    assert.equal(fs.existsSync(staleReap0), false, "completed reap swept stale generation files");
  }

  // 2) F5: Strict numeric field validation rejects usedAt:true / pid:null / calls:false as PROXY_STORE_CORRUPT without rewriting disk!
  {
    const dir = path.join(temp, "r3-f5-types");
    const runsFile = path.join(dir, "project-lines", "model-proxy", "runs.json");
    fs.mkdirSync(path.dirname(runsFile), { recursive:true });
    const malformed = JSON.stringify({
      version:1,
      runs:{
        "00000000-0000-4000-8000-000000000001":{ id:"00000000-0000-4000-8000-000000000001", secret:"sec", usedAt:true, pid:null, calls:false },
      },
    });
    fs.writeFileSync(runsFile, malformed);
    let sawErr = null;
    const p = createModelProxy({ stateDir:dir, onError:e => { sawErr = e; }, connect:async () => ({}), describe:async () => ({}), target:async () => "" });
    closing.push(() => p.close());
    await p.listening;
    assert.equal(sawErr?.code, "PROXY_STORE_CORRUPT", "usedAt:true / pid:null / calls:false rejected as corrupt");
    assert.equal(p.active, false, "proxy did not activate with malformed numeric fields");
    assert.equal(fs.readFileSync(runsFile, "utf8"), malformed, "malformed runs.json was NOT rewritten or deleted");
  }

  // 3) F5: Failed end(id) on runs.json rename writes durable pending-ends marker so successor count() is 0 after close,
  //    and agents.endRun forwards false if persistence fails!
  {
    const dir = path.join(temp, "r3-f5-end");
    const p1 = createModelProxy({ stateDir:dir, connect:async () => ({}), describe:async () => ({}), target:async () => "" });
    await p1.listening;
    const run = p1.open({ pick:"m" });
    const runsFile = path.join(dir, "project-lines", "model-proxy", "runs.json");
    const origRename = fs.renameSync;
    fs.renameSync = (from, to) => {
      if (String(to) === runsFile) throw Object.assign(new Error("injected rename failure"), { code:"EIO" });
      return origRename.call(fs, from, to);
    };
    try {
      const ok = p1.end(run.id);
      assert.equal(ok, true, "durable pending-ends marker recorded even when runs.json rename failed");
      await p1.close();
    } finally {
      fs.renameSync = origRename;
    }
    const p2 = createModelProxy({ stateDir:dir, connect:async () => ({}), describe:async () => ({}), target:async () => "" });
    closing.push(() => p2.close());
    await p2.listening;
    assert.equal(p2.count(), 0, "successor proxy excludes ended run persisted via pending-ends marker");

    // Production adapter agents.endRun forwards boolean return value instead of dropping it.
    const ag = createAgents({ env:{}, paths:{ penecho:{ end:() => false } } });
    assert.equal(ag.endRun("penecho", "run-x"), false, "agents.endRun returns false on failure");
  }

  // 4) F6: Refusal write failure returns 503 (never 402); persisted refusal does NOT expire after 10 minutes and clears only on clearRefusal(id)!
  {
    const dir = path.join(temp, "r3-f6");
    const modelSrv = http.createServer((_req, res) => {
      res.writeHead(402, { "content-type":"application/json" });
      res.end(JSON.stringify({ error:"insufficient_credits", details:{ balance:0, required:1 } }));
    });
    await new Promise(r => modelSrv.listen(0, "127.0.0.1", r));
    closing.push(() => new Promise(r => modelSrv.close(r)));
    const p1 = createModelProxy({
      stateDir:dir,
      connect:async () => ({ apiFormat:"openai", apiModel:"m", apiKey:"k", hosted:true }),
      describe:async () => ({}),
      target:async () => `http://127.0.0.1:${modelSrv.address().port}`,
    });
    closing.push(() => p1.close());
    await p1.listening;
    const run = p1.open({ pick:"m" });
    const runsFile = path.join(dir, "project-lines", "model-proxy", "runs.json");
    const origRename = fs.renameSync;
    fs.renameSync = (from, to) => {
      if (String(to) === runsFile) throw Object.assign(new Error("refusal rename EIO"), { code:"EIO" });
      return origRename.call(fs, from, to);
    };
    let status;
    try {
      const resp = await fetch(`http://127.0.0.1:${p1.port}/run/${run.id}/model/chat/completions`, {
        method:"POST",
        headers:{ authorization:`Bearer ${run.secret}`, "content-type":"application/json", "x-penecho-call-id":"call-f6-unpersisted" },
        body:JSON.stringify({ messages:[{ role:"user", content:"hi" }] }),
      });
      status = resp.status;
    } finally {
      fs.renameSync = origRename;
    }
    assert.equal(status, 503, "unpersisted 402 refusal returns 503 instead of acknowledging 402");
    assert.equal(p1.refused(run.id), null, "proxy does not report an unpersisted refusal");

    // Successful 402 persists and survives >10 minutes until explicitly cleared via clearRefusal(id).
    const ok402 = await fetch(`http://127.0.0.1:${p1.port}/run/${run.id}/model/chat/completions`, {
      method:"POST",
      headers:{ authorization:`Bearer ${run.secret}`, "content-type":"application/json" },
      body:JSON.stringify({ messages:[{ role:"user", content:"hi" }] }),
    });
    assert.equal(ok402.status, 402);
    // Backdate refusal timestamp by 20 minutes (> old 10-min TTL) on disk and verify successor STILL returns it!
    const raw = JSON.parse(fs.readFileSync(runsFile, "utf8"));
    raw.refusals[run.id].at = Date.now() - 20 * 60_000;
    fs.writeFileSync(runsFile, JSON.stringify(raw));
    const p2 = createModelProxy({ stateDir:dir, connect:async () => ({}), describe:async () => ({}), target:async () => "" });
    closing.push(() => p2.close());
    await p2.listening;
    assert.equal(p2.refused(run.id)?.error, "insufficient_credits", "persisted refusal does NOT expire after 10 minutes");
    p2.clearRefusal(run.id);
    assert.equal(p2.refused(run.id), null, "clearRefusal removes the refusal once Work records disposition");
  }

  // 5) F7: After reconnect retry with tight remaining outage budget, committing first SSE event resets idle timer to healthy postHeaderIdleMs!
  {
    const { createProxyRelay } = await import("../src/server/project-lines/penecho-runner.mjs");
    const ep = path.join(temp, "r3-f7-ep.json");
    const token = "tok-f7", inst = "inst-f7";
    let calls = 0;
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, "http://127.0.0.1");
      if (req.method === "GET" && u.pathname === "/identity") {
        const nonce = u.searchParams.get("nonce");
        const proof = require("../src/server/agent-core/model-proxy.js").proxyIdentityProof(token, nonce, srv.address().port, inst);
        res.writeHead(200, { "content-type":"application/json" });
        return res.end(JSON.stringify({ ok:true, instanceId:inst, port:srv.address().port, keepaliveMs:300, proof }));
      }
      calls++;
      if (calls === 1) {
        // First try fails with 503 proxy_restarting, arming outageDeadline = now + 150ms.
        res.writeHead(503, { "content-type":"application/json", "x-penecho-proxy-retry":"1" });
        return res.end(JSON.stringify({ error:{ code:"proxy_restarting", message:"restarting" } }));
      }
      // Second try runs with ~120ms of outage budget left, commits first SSE data event immediately,
      // then pauses 250ms (> 120ms remaining outage budget, < 1000ms healthy body idle)!
      res.writeHead(200, { "content-type":"text/event-stream; charset=utf-8" });
      res.write('data: {"choices":[{"delta":{"content":"part1"}}]}\n\n');
      setTimeout(() => {
        res.write('data: {"choices":[{"delta":{"content":"part2"}}]}\n\ndata: [DONE]\n\n');
        res.end();
      }, 250);
    });
    await new Promise(r => srv.listen(0, "127.0.0.1", r));
    closing.push(() => new Promise(r => srv.close(r)));
    fs.writeFileSync(ep, JSON.stringify({ port:srv.address().port, instanceId:inst, proxyToken:token }));
    const relay = await createProxyRelay({
      initialOrigin:`http://127.0.0.1:${srv.address().port}`,
      secret:"sec-f7",
      endpointFile:ep,
      initialProxyToken:token,
      initialInstanceId:inst,
      reconnectMs:150,
      pollMs:25,
      headerTimeoutMs:1000,
    });
    closing.push(() => relay.close());
    const resp = await fetch(`http://127.0.0.1:${relay.port}/run/00000000-0000-4000-8000-000000000007/model/chat/completions`, {
      method:"POST",
      headers:{ "content-type":"application/json", authorization:"Bearer sec-f7" },
      body:JSON.stringify({ stream:true, messages:[{ role:"user", content:"hi" }] }),
    });
    assert.equal(resp.status, 200);
    const body = await resp.text();
    assert.match(body, /part1/, "first SSE chunk arrived");
    assert.match(body, /part2/, "second SSE chunk after healthy 250ms gap completed cleanly instead of firing stale reconnect timer");
    assert.match(body, /\[DONE\]/);
  }
});

test("Round 4 F4, F5, F6, F7: sweepReapFiles fails closed on EIO/live PID, pending-ends EACCES fails closed, refusals never age out, and slow non-SSE 200 JSON clears outageTimer", async () => {
  const { sweepReapFiles, proxyIdentityProof } = require("../src/server/agent-core/model-proxy.js");
  const { createProxyRelay } = await import("../src/server/project-lines/penecho-runner.mjs");

  // 1) F4: sweepReapFiles skips deletion when reading primary lock hits EIO AND never deletes a live-PID reap guard!
  {
    const dir = path.join(temp, "r4-f4");
    fs.mkdirSync(dir, { recursive:true });
    const lockFile = path.join(dir, "runs.json.lock");
    fs.writeFileSync(lockFile, `${process.pid}:1:tok`, { mode:0o600 });
    const liveReap = `${lockFile}.reap.0123456789abcdef.0`;
    const deadReap = `${lockFile}.reap.fedcba9876543210.0`;
    fs.writeFileSync(liveReap, `${process.pid}:1:guard`, { mode:0o600 });
    fs.writeFileSync(deadReap, `999999999:1:dead`, { mode:0o600 });
    const oldTime = new Date(Date.now() - 120_000);
    fs.utimesSync(liveReap, oldTime, oldTime);
    fs.utimesSync(deadReap, oldTime, oldTime);

    const origRead = fs.readFileSync;
    fs.readFileSync = (file, ...rest) => {
      if (String(file) === lockFile) throw Object.assign(new Error("simulated primary EIO"), { code:"EIO" });
      return origRead.call(fs, file, ...rest);
    };
    try {
      sweepReapFiles(lockFile, "", 60_000);
    } finally {
      fs.readFileSync = origRead;
    }
    assert.equal(fs.existsSync(liveReap), true, "primary lock EIO must NOT delete live reap guard");
    assert.equal(fs.existsSync(deadReap), true, "primary lock EIO skips all destructive reap cleanup");

    // Without EIO (primary lock absent), dead aged reap guard IS cleaned, while live-PID aged reap guard is STILL preserved!
    fs.unlinkSync(lockFile);
    sweepReapFiles(lockFile, "", 60_000);
    assert.equal(fs.existsSync(liveReap), true, "aged reap guard owned by live PID is never unlinked");
    assert.equal(fs.existsSync(deadReap), false, "aged reap guard owned by dead PID is cleaned when primary authority is known");

    // Round 5 F4: invalid non-integer PID (1.5) in aged guard MUST NOT be deleted, and hash-specific sweep MUST preserve live/invalid/unreadable guards!
    const floatReap = `${lockFile}.reap.1111111111111111.0`;
    const hashLive = `${lockFile}.reap.aaaaaaaaaaaaaaaa.0`;
    const hashInvalid = `${lockFile}.reap.aaaaaaaaaaaaaaaa.1`;
    const hashDead = `${lockFile}.reap.aaaaaaaaaaaaaaaa.2`;
    fs.writeFileSync(floatReap, "1.5:1:badpid", { mode:0o600 });
    fs.writeFileSync(hashLive, `${process.pid}:1:live`, { mode:0o600 });
    fs.writeFileSync(hashInvalid, "not-a-pid:1:bad", { mode:0o600 });
    fs.writeFileSync(hashDead, "999999999:1:dead", { mode:0o600 });
    for (const f of [floatReap, hashLive, hashInvalid, hashDead]) fs.utimesSync(f, oldTime, oldTime);
    sweepReapFiles(lockFile, "", 60_000);
    assert.equal(fs.existsSync(floatReap), true, "aged reap guard with invalid float PID 1.5 must NOT be unlinked");
    sweepReapFiles(lockFile, "aaaaaaaaaaaaaaaa", 0);
    assert.equal(fs.existsSync(hashLive), true, "hash-specific sweep preserves live-owner reap guard");
    assert.equal(fs.existsSync(hashInvalid), true, "hash-specific sweep preserves invalid/unreadable-owner reap guard");
    assert.equal(fs.existsSync(hashDead), false, "hash-specific sweep cleans valid dead-owner reap guard");

    // Round 6 F4: unprobeable out-of-range 32-bit PID (2147483648 throws ERR_INVALID_ARG_TYPE, NOT ESRCH) MUST NOT be unlinked!
    const overMaxPeriodic = `${lockFile}.reap.2222222222222222.0`;
    const overMaxHash = `${lockFile}.reap.bbbbbbbbbbbbbbbb.0`;
    fs.writeFileSync(overMaxPeriodic, "2147483648:1:overmax", { mode:0o600 });
    fs.writeFileSync(overMaxHash, "2147483648:1:overmax", { mode:0o600 });
    fs.utimesSync(overMaxPeriodic, oldTime, oldTime);
    fs.utimesSync(overMaxHash, oldTime, oldTime);
    sweepReapFiles(lockFile, "", 60_000);
    sweepReapFiles(lockFile, "bbbbbbbbbbbbbbbb", 0);
    assert.equal(fs.existsSync(overMaxPeriodic), true, "periodic sweep preserves unprobeable PID 2147483648");
    assert.equal(fs.existsSync(overMaxHash), true, "hash-specific sweep preserves unprobeable PID 2147483648");
  }

  // 2) F5: Unreadable pending-ends directory (EACCES/EIO) fails successor startup and count() closed instead of trusting empty set!
  {
    const dir = path.join(temp, "r4-f5");
    const p1 = createModelProxy({ stateDir:dir, connect:async () => ({}), describe:async () => ({}), target:async () => "" });
    await p1.listening;
    const r = p1.open({ pick:"m" });
    await p1.close();
    const pendingDir = path.join(dir, "project-lines", "model-proxy", "pending-ends");
    fs.mkdirSync(pendingDir, { recursive:true });
    fs.writeFileSync(path.join(pendingDir, r.id), String(Date.now()));

    const errors = [];
    const origReaddir = fs.readdirSync;
    fs.readdirSync = (target, ...rest) => {
      if (String(target) === pendingDir) throw Object.assign(new Error("simulated EACCES"), { code:"EACCES" });
      return origReaddir.call(fs, target, ...rest);
    };
    let p2;
    try {
      p2 = createModelProxy({ stateDir:dir, onError:e => errors.push(e), connect:async () => ({}), describe:async () => ({}), target:async () => "" });
      closing.push(() => p2.close());
      await p2.listening;
      assert.equal(p2.active, false, "successor MUST fail closed (active=false) when pending-ends cannot be listed");
      assert.ok(errors.some(e => e.code === "PROXY_STORE_UNREADABLE"), "startup reported PROXY_STORE_UNREADABLE");
      assert.throws(() => p2.count(), { code:"PROXY_STORE_UNREADABLE" }, "count() refuses to trust unverified runs when pending-ends is unreadable");
    } finally {
      fs.readdirSync = origReaddir;
    }
    // Once readable again, activate() succeeds and honors the pending-end marker (0 runs).
    p2.activate();
    assert.equal(p2.active, true);
    assert.equal(p2.count(), 0, "once pending-ends is readable, ended run is removed");
  }

  // 3) F6: Unconsumed credit refusal older than 7 days (e.g. 10 days) is NEVER evicted by age; only clearRefusal(id) removes it!
  {
    const dir = path.join(temp, "r4-f6");
    const modelSrv = http.createServer((_req, res) => {
      res.writeHead(402, { "content-type":"application/json" });
      res.end(JSON.stringify({ error:"insufficient_credits", details:{ balance:0, required:1 } }));
    });
    await new Promise(r => modelSrv.listen(0, "127.0.0.1", r));
    closing.push(() => new Promise(r => modelSrv.close(r)));
    const p1 = createModelProxy({
      stateDir:dir,
      connect:async () => ({ apiFormat:"openai", apiModel:"m", apiKey:"k", hosted:true }),
      describe:async () => ({}),
      target:async () => `http://127.0.0.1:${modelSrv.address().port}`,
    });
    closing.push(() => p1.close());
    await p1.listening;
    const run = p1.open({ pick:"m" });
    const resp = await fetch(`http://127.0.0.1:${p1.port}/run/${run.id}/model/chat/completions`, {
      method:"POST",
      headers:{ authorization:`Bearer ${run.secret}`, "content-type":"application/json" },
      body:JSON.stringify({ messages:[{ role:"user", content:"hi" }] }),
    });
    assert.equal(resp.status, 402);
    const runsFile = path.join(dir, "project-lines", "model-proxy", "runs.json");
    const raw = JSON.parse(fs.readFileSync(runsFile, "utf8"));
    raw.refusals[run.id].at = Date.now() - 10 * 86_400_000; // 10 days old!
    fs.writeFileSync(runsFile, JSON.stringify(raw));

    const p2 = createModelProxy({ stateDir:dir, connect:async () => ({}), describe:async () => ({}), target:async () => "" });
    closing.push(() => p2.close());
    await p2.listening;
    assert.equal(p2.refused(run.id)?.error, "insufficient_credits", "10-day-old unconsumed credit refusal survives successor startup");
    p2.clearRefusal(run.id);
    assert.equal(p2.refused(run.id), null, "clearRefusal explicitly removes the refusal");
  }

  // 4) F7: Slow multi-chunk non-SSE 200 JSON body after attempt-1 failure clears outageTimer and finishes 200 OK!
  {
    const ep = path.join(temp, "r4-f7-ep.json");
    const token = "tok-r4-f7", inst = "inst-r4-f7";
    let calls = 0;
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, "http://127.0.0.1");
      if (req.method === "GET" && u.pathname === "/identity") {
        const nonce = u.searchParams.get("nonce");
        const proof = proxyIdentityProof(token, nonce, srv.address().port, inst);
        res.writeHead(200, { "content-type":"application/json" });
        return res.end(JSON.stringify({ ok:true, instanceId:inst, port:srv.address().port, keepaliveMs:300, proof }));
      }
      calls++;
      if (calls === 1) {
        res.writeHead(503, { "content-type":"application/json", "x-penecho-proxy-retry":"1" });
        return res.end(JSON.stringify({ error:{ code:"proxy_restarting", message:"restarting" } }));
      }
      // Attempt 2: final 200 OK JSON delivered in two chunks 400ms apart (> 200ms reconnectMs, < 1200ms headerTimeoutMs)!
      res.writeHead(200, { "content-type":"application/json" });
      res.write('{"choices":[{"message":');
      setTimeout(() => {
        res.end('{"content":"slow non-sse ok"}}]}');
      }, 400);
    });
    await new Promise(r => srv.listen(0, "127.0.0.1", r));
    closing.push(() => new Promise(r => srv.close(r)));
    fs.writeFileSync(ep, JSON.stringify({ port:srv.address().port, instanceId:inst, proxyToken:token }));
    const relay = await createProxyRelay({
      initialOrigin:`http://127.0.0.1:${srv.address().port}`,
      secret:"sec-r4-f7",
      endpointFile:ep,
      initialProxyToken:token,
      initialInstanceId:inst,
      reconnectMs:200,
      pollMs:25,
      headerTimeoutMs:1200,
    });
    closing.push(() => relay.close());
    const resp = await fetch(`http://127.0.0.1:${relay.port}/run/00000000-0000-4000-8000-000000000047/model/chat/completions`, {
      method:"POST",
      headers:{ "content-type":"application/json", authorization:"Bearer sec-r4-f7" },
      body:JSON.stringify({ stream:false, messages:[{ role:"user", content:"hi" }] }),
    });
    assert.equal(resp.status, 200, "slow healthy non-SSE 200 JSON must NOT be truncated to 503 by stale outageTimer");
    const data = await resp.json();
    assert.equal(data.choices[0].message.content, "slow non-sse ok");
    assert.equal(calls, 2);
  }
});

test("PE-835: live proxy stall past 3s handshake, pre-payload SSE keepalives after reconnect, flapping bound, endpoint rotation during /identity, sendDone bound, and accurate timeout wording", async () => {
  const { createProxyRelay } = await import("../src/server/project-lines/penecho-runner.mjs");
  const { proxyIdentityProof } = require("../src/server/agent-core/model-proxy.js");

  // 1) Live unchanged proxy stalled 3.2s (> old 3s handshakeMs) with default handshakeMs completes on attempt 1!
  {
    const ep = path.join(temp, "pe835-stall-ep.json");
    const token = "tok-835-1", inst = "inst-835-1";
    let idHits = 0, postCalls = 0;
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, "http://127.0.0.1");
      if (req.method === "GET" && u.pathname === "/identity") {
        idHits++;
        const nonce = u.searchParams.get("nonce") || "";
        setTimeout(() => {
          if (res.destroyed || res.writableEnded) return;
          const proof = proxyIdentityProof(token, nonce, srv.address().port, inst);
          res.writeHead(200, { "content-type":"application/json" });
          res.end(JSON.stringify({ ok:true, instanceId:inst, port:srv.address().port, keepaliveMs:1000, proof }));
        }, 3_200);
        return;
      }
      postCalls++;
      res.writeHead(200, { "content-type":"text/event-stream; charset=utf-8" });
      res.end('data: {"choices":[{"delta":{"content":"survived-3.2s-stall"}}]}\n\ndata: [DONE]\n\n');
    });
    await new Promise(r => srv.listen(0, "127.0.0.1", r));
    closing.push(() => new Promise(r => { srv.closeAllConnections?.(); srv.close(r); }));
    fs.writeFileSync(ep, JSON.stringify({ port:srv.address().port, pid:process.pid, instanceId:inst, proxyToken:token }));
    const relay = await createProxyRelay({
      initialOrigin:`http://127.0.0.1:${srv.address().port}`,
      secret:"sec-835-1",
      endpointFile:ep,
      initialProxyToken:token,
      initialInstanceId:inst,
      reconnectMs:5_000,
      pollMs:50,
    });
    closing.push(() => relay.close());
    const resp = await fetch(`http://127.0.0.1:${relay.port}/run/00000000-0000-4000-8000-000000000835/model/chat/completions`, {
      method:"POST",
      headers:{ "content-type":"application/json", authorization:"Bearer sec-835-1" },
      body:JSON.stringify({ stream:true, messages:[{ role:"user", content:"hi" }] }),
    });
    assert.equal(resp.status, 200);
    assert.match(await resp.text(), /survived-3\.2s-stall/);
    assert.equal(idHits, 1, "default handshakeMs waits through 3.2s live-server stall instead of aborting at 3s");
    assert.equal(postCalls, 1);
  }

  // 2) After reconnect latches near end of outage budget, pre-payload SSE keepalives disarm outageTimer and survive longer than reconnectMs!
  {
    const ep = path.join(temp, "pe835-ka-ep.json");
    const token = "tok-835-2", inst = "inst-835-2";
    let calls = 0;
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, "http://127.0.0.1");
      if (req.method === "GET" && u.pathname === "/identity") {
        const nonce = u.searchParams.get("nonce") || "";
        const proof = proxyIdentityProof(token, nonce, srv.address().port, inst);
        res.writeHead(200, { "content-type":"application/json" });
        return res.end(JSON.stringify({ ok:true, instanceId:inst, port:srv.address().port, keepaliveMs:150, proof }));
      }
      calls++;
      if (calls === 1) {
        // Delay 220ms of a 300ms reconnectMs budget before replying 503 proxy_restarting:
        // Wait: 503 on try 1 starts outageDeadline = T0 + 300ms!
        // Sleep 210ms on retry before sending headers? Simulate via 200-230ms outage recovery on /identity instead!
        res.writeHead(503, { "content-type":"application/json", "x-penecho-proxy-retry":"1" });
        return res.end(JSON.stringify({ error:{ code:"proxy_restarting", message:"restarting" } }));
      }
      // Attempt 2 runs cleanly, holds 150ms (= keepaliveMs) with ~220ms budget left (< 2*keepaliveMs or tight!),
      // emits keepalive frames every 150ms, then commits payload at +450ms (> 300ms reconnectMs!).
      setTimeout(() => {
        if (res.destroyed || res.writableEnded) return;
        res.writeHead(200, { "content-type":"text/event-stream; charset=utf-8" });
        res.write(": keepalive\n\n");
        setTimeout(() => {
          if (res.destroyed || res.writableEnded) return;
          res.write(": keepalive\n\n");
          setTimeout(() => {
            if (res.destroyed || res.writableEnded) return;
            res.end('data: {"choices":[{"delta":{"content":"ka-survived"}}]}\n\ndata: [DONE]\n\n');
          }, 150);
        }, 150);
      }, 150);
    });
    await new Promise(r => srv.listen(0, "127.0.0.1", r));
    closing.push(() => new Promise(r => { srv.closeAllConnections?.(); srv.close(r); }));
    fs.writeFileSync(ep, JSON.stringify({ port:srv.address().port, pid:process.pid, instanceId:inst, proxyToken:token }));
    const relay = await createProxyRelay({
      initialOrigin:`http://127.0.0.1:${srv.address().port}`,
      secret:"sec-835-2",
      endpointFile:ep,
      initialProxyToken:token,
      initialInstanceId:inst,
      reconnectMs:300,
      pollMs:25,
      handshakeMs:150,
    });
    closing.push(() => relay.close());
    const resp = await fetch(`http://127.0.0.1:${relay.port}/run/00000000-0000-4000-8000-000000000836/model/chat/completions`, {
      method:"POST",
      headers:{ "content-type":"application/json", authorization:"Bearer sec-835-2" },
      body:JSON.stringify({ stream:true, messages:[{ role:"user", content:"hi" }] }),
    });
    assert.equal(resp.status, 200);
    assert.match(await resp.text(), /ka-survived/);
    assert.equal(calls, 2, "pre-payload SSE keepalives after reconnect disarm outageTimer instead of aborting live call");
  }

  // 3) Tight remaining budget (< keepaliveMs) right at recovery + sustained keepalive second cut + 0ms flapping bound!
  {
    const ep = path.join(temp, "pe835-flap-ep.json");
    const token = "tok-835-3", inst = "inst-835-3";
    let mode = "tight-then-cut2", calls = 0, allowIdentityAt = 0;
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, "http://127.0.0.1");
      if (req.method === "GET" && u.pathname === "/identity") {
        if (Date.now() < allowIdentityAt) return; // Hold until outage nearly exhausted!
        const nonce = u.searchParams.get("nonce") || "";
        const proof = proxyIdentityProof(token, nonce, srv.address().port, inst);
        res.writeHead(200, { "content-type":"application/json" });
        return res.end(JSON.stringify({ ok:true, instanceId:inst, port:srv.address().port, keepaliveMs:150, proof }));
      }
      calls++;
      if (mode === "tight-then-cut2") {
        if (calls === 1) {
          allowIdentityAt = Date.now() + 210; // Leaves only ~90ms (< 150ms keepaliveMs) when attempt 2 verifies!
          res.writeHead(503, { "content-type":"application/json", "x-penecho-proxy-retry":"1" });
          return res.end(JSON.stringify({ error:{ code:"proxy_restarting", message:"restarting" } }));
        }
        if (calls === 2) {
          setTimeout(() => {
            if (res.destroyed || res.writableEnded) return;
            res.writeHead(200, { "content-type":"text/event-stream; charset=utf-8" });
            res.write(": keepalive\n\n");
            // Drop cleanly after keepalive so fresh reconnectMs starts and attempt 3 succeeds!
            setTimeout(() => { if (!res.destroyed && !res.writableEnded) res.end(); }, 50);
          }, 160);
          return;
        }
        res.writeHead(200, { "content-type":"text/event-stream; charset=utf-8" });
        return res.end('data: {"choices":[{"delta":{"content":"recovered-3"}}]}\n\ndata: [DONE]\n\n');
      }
      // Flapping 0ms keepalive+close loop MUST still stop within reconnectMs!
      res.writeHead(200, { "content-type":"text/event-stream; charset=utf-8" });
      res.write(": keepalive\n\n");
      res.end();
    });
    await new Promise(r => srv.listen(0, "127.0.0.1", r));
    closing.push(() => new Promise(r => { srv.closeAllConnections?.(); srv.close(r); }));
    fs.writeFileSync(ep, JSON.stringify({ port:srv.address().port, pid:process.pid, instanceId:inst, proxyToken:token }));
    const relay = await createProxyRelay({
      initialOrigin:`http://127.0.0.1:${srv.address().port}`,
      secret:"sec-835-3",
      endpointFile:ep,
      initialProxyToken:token,
      initialInstanceId:inst,
      reconnectMs:300,
      pollMs:25,
      handshakeMs:100,
    });
    closing.push(() => relay.close());
    const okRes = await fetch(`http://127.0.0.1:${relay.port}/run/00000000-0000-4000-8000-000000000837/model/chat/completions`, {
      method:"POST",
      headers:{ "content-type":"application/json", authorization:"Bearer sec-835-3" },
      body:JSON.stringify({ stream:true, messages:[{ role:"user", content:"hi" }] }),
    });
    assert.equal(okRes.status, 200);
    assert.match(await okRes.text(), /recovered-3/);
    assert.equal(calls, 3);

    mode = "flap-0ms"; calls = 0;
    const tFlap = Date.now();
    const flapRes = await fetch(`http://127.0.0.1:${relay.port}/run/00000000-0000-4000-8000-000000000837/model/chat/completions`, {
      method:"POST",
      headers:{ "content-type":"application/json", authorization:"Bearer sec-835-3" },
      body:JSON.stringify({ stream:true, messages:[{ role:"user", content:"hi" }] }),
    });
    assert.equal(flapRes.status, 200, "downstream SSE opened on first keepalive frame");
    const flapBody = await flapRes.text();
    assert.match(flapBody, /"error"/, "flapping keepalive+close ends cleanly with an SSE error event");
    assert.ok(Date.now() - tFlap < 1500, "0ms flapping keepalive+close proxy still bounded by reconnectMs");
  }

  // 4) Endpoint rotation aborts hung /identity fast (< pollMs*4), sendDone honors timeoutMs, and live stall != false restart wording!
  {
    const ep = path.join(temp, "pe835-rot-ep.json");
    const tokenOld = "tok-old", instOld = "inst-old";
    const tokenNew = "tok-new", instNew = "inst-new";
    const hungSrv = http.createServer(() => { /* Hung forever on /identity! */ });
    const newSrv = http.createServer((req, res) => {
      const u = new URL(req.url, "http://127.0.0.1");
      if (req.method === "GET" && u.pathname === "/identity") {
        const nonce = u.searchParams.get("nonce") || "";
        const proof = proxyIdentityProof(tokenNew, nonce, newSrv.address().port, instNew);
        res.writeHead(200, { "content-type":"application/json" });
        return res.end(JSON.stringify({ ok:true, instanceId:instNew, port:newSrv.address().port, keepaliveMs:500, proof }));
      }
      res.writeHead(200, { "content-type":"application/json" });
      res.end(JSON.stringify({ choices:[{ message:{ content:"rotated-fast" } }] }));
    });
    await new Promise(r => hungSrv.listen(0, "127.0.0.1", r));
    await new Promise(r => newSrv.listen(0, "127.0.0.1", r));
    closing.push(() => new Promise(r => { hungSrv.closeAllConnections?.(); hungSrv.close(r); }));
    closing.push(() => new Promise(r => { newSrv.closeAllConnections?.(); newSrv.close(r); }));

    fs.writeFileSync(ep, JSON.stringify({ port:hungSrv.address().port, pid:process.pid, instanceId:instOld, proxyToken:tokenOld }));
    const relay = await createProxyRelay({
      initialOrigin:`http://127.0.0.1:${hungSrv.address().port}`,
      secret:"sec-835-4",
      endpointFile:ep,
      initialProxyToken:tokenOld,
      initialInstanceId:instOld,
      reconnectMs:300,
      pollMs:30,
      handshakeMs:5_000,
    });
    closing.push(() => relay.close());

    // sendDone must honor short timeoutMs (150ms) even with 5_000ms handshakeMs!
    const tDone = Date.now();
    const doneOk = await relay.sendDone("/run/00000000-0000-4000-8000-000000000838", 150);
    assert.equal(doneOk, false);
    assert.ok(Date.now() - tDone < 500, "sendDone honors its timeoutMs during /identity verification");

    // Rotate endpoint.json after 80ms while /identity is waiting on hungSrv (5000ms handshakeMs):
    setTimeout(() => {
      fs.writeFileSync(ep, JSON.stringify({ port:newSrv.address().port, pid:process.pid, instanceId:instNew, proxyToken:tokenNew }));
    }, 80);
    const tRot = Date.now();
    const rotRes = await fetch(`http://127.0.0.1:${relay.port}/run/00000000-0000-4000-8000-000000000838/model/chat/completions`, {
      method:"POST",
      headers:{ "content-type":"application/json", authorization:"Bearer sec-835-4" },
      body:JSON.stringify({ stream:false, messages:[{ role:"user", content:"hi" }] }),
    });
    assert.equal(rotRes.status, 200);
    assert.equal((await rotRes.json()).choices[0].message.content, "rotated-fast");
    assert.ok(Date.now() - tRot < 1500, "hung /identity aborted immediately upon endpoint.json rotation");

    // Unchanged live stalled peer timing out without any restart must NOT blame a restart —
    // even when initialInstanceId differs from the current endpoint (an earlier restart happened before this request)!
    const epStall = path.join(temp, "pe835-norestart-ep.json");
    fs.writeFileSync(epStall, JSON.stringify({ port:hungSrv.address().port, pid:process.pid, instanceId:instNew, proxyToken:tokenOld }));
    const relayNoRestart = await createProxyRelay({
      initialOrigin:`http://127.0.0.1:${hungSrv.address().port}`,
      secret:"sec-835-5",
      endpointFile:epStall,
      initialProxyToken:tokenOld,
      initialInstanceId:instOld,
      reconnectMs:250,
      pollMs:25,
      handshakeMs:100,
    });
    closing.push(() => relayNoRestart.close());
    const timeoutRes = await fetch(`http://127.0.0.1:${relayNoRestart.port}/run/00000000-0000-4000-8000-000000000839/model/chat/completions`, {
      method:"POST",
      headers:{ "content-type":"application/json", authorization:"Bearer sec-835-5" },
      body:JSON.stringify({ stream:true, messages:[{ role:"user", content:"hi" }] }),
    });
    assert.equal(timeoutRes.status, 503);
    const timeoutBody = await timeoutRes.json();
    assert.doesNotMatch(timeoutBody.error.message, /after restart/i, "timeout on unchanged live PID must not falsely blame an earlier restart");
    assert.match(timeoutBody.error.message, /did not respond in time/i);

    // Dead endpoint PID aborts hung /identity fast (< 1s despite 5s handshakeMs) and reports restart!
    const epDeadPid = path.join(temp, "pe835-deadpid-ep.json");
    fs.writeFileSync(epDeadPid, JSON.stringify({ port:hungSrv.address().port, pid:999999, instanceId:instNew, proxyToken:tokenOld }));
    const relayDeadPid = await createProxyRelay({
      initialOrigin:`http://127.0.0.1:${hungSrv.address().port}`,
      secret:"sec-835-dead",
      endpointFile:epDeadPid,
      initialProxyToken:tokenOld,
      initialInstanceId:instNew,
      reconnectMs:180,
      pollMs:25,
      handshakeMs:5_000,
    });
    closing.push(() => relayDeadPid.close());
    const tDead = Date.now();
    const deadRes = await fetch(`http://127.0.0.1:${relayDeadPid.port}/run/00000000-0000-4000-8000-000000000841/model/chat/completions`, {
      method:"POST",
      headers:{ "content-type":"application/json", authorization:"Bearer sec-835-dead" },
      body:JSON.stringify({ stream:true, messages:[{ role:"user", content:"hi" }] }),
    });
    assert.equal(deadRes.status, 503);
    assert.ok(Date.now() - tDead < 1500, "dead endpoint PID aborts hung /identity fast instead of waiting 5s handshakeMs");
    assert.match((await deadRes.json()).error.message, /did not come back after restart/i);

    // Slow-flapping proxy (holds >= keepaliveMs, sends keepalive, then drops) hits the reset ceiling and terminates!
    let slowFlapCalls = 0;
    const slowFlapSrv = http.createServer((req, res) => {
      const u = new URL(req.url, "http://127.0.0.1");
      if (req.method === "GET" && u.pathname === "/identity") {
        const nonce = u.searchParams.get("nonce") || "";
        const proof = proxyIdentityProof(tokenNew, nonce, slowFlapSrv.address().port, instNew);
        res.writeHead(200, { "content-type":"application/json" });
        return res.end(JSON.stringify({ ok:true, instanceId:instNew, port:slowFlapSrv.address().port, keepaliveMs:40, proof }));
      }
      slowFlapCalls++;
      setTimeout(() => {
        if (res.destroyed || res.writableEnded) return;
        res.writeHead(200, { "content-type":"text/event-stream; charset=utf-8" });
        res.write(": keepalive\n\n");
        res.end();
      }, 55);
    });
    await new Promise(r => slowFlapSrv.listen(0, "127.0.0.1", r));
    closing.push(() => new Promise(r => { slowFlapSrv.closeAllConnections?.(); slowFlapSrv.close(r); }));
    const epSlowFlap = path.join(temp, "pe835-slowflap-ep.json");
    fs.writeFileSync(epSlowFlap, JSON.stringify({ port:slowFlapSrv.address().port, pid:process.pid, instanceId:instNew, proxyToken:tokenNew }));
    const relaySlowFlap = await createProxyRelay({
      initialOrigin:`http://127.0.0.1:${slowFlapSrv.address().port}`,
      secret:"sec-835-slowflap",
      endpointFile:epSlowFlap,
      initialProxyToken:tokenNew,
      initialInstanceId:instNew,
      reconnectMs:150,
      pollMs:25,
      handshakeMs:100,
    });
    closing.push(() => relaySlowFlap.close());
    const tSlowFlap = Date.now();
    const slowFlapRes = await fetch(`http://127.0.0.1:${relaySlowFlap.port}/run/00000000-0000-4000-8000-000000000842/model/chat/completions`, {
      method:"POST",
      headers:{ "content-type":"application/json", authorization:"Bearer sec-835-slowflap" },
      body:JSON.stringify({ stream:true, messages:[{ role:"user", content:"hi" }] }),
    });
    assert.equal(slowFlapRes.status, 200);
    assert.match(await slowFlapRes.text(), /"error"/, "slow-flapping keepalive+close proxy terminates cleanly via reset ceiling");
    assert.ok(Date.now() - tSlowFlap < 4000 && slowFlapCalls <= 12, `expected bounded slow-flapping attempts, got ${slowFlapCalls}`);

    // Conversely, exhausting retries on a genuinely restarting proxy (503 proxy_restarting) preserves the restart message!
    const restartSrv = http.createServer((req, res) => {
      const u = new URL(req.url, "http://127.0.0.1");
      if (req.method === "GET" && u.pathname === "/identity") {
        const nonce = u.searchParams.get("nonce") || "";
        const proof = proxyIdentityProof(tokenNew, nonce, restartSrv.address().port, instNew);
        res.writeHead(200, { "content-type":"application/json" });
        return res.end(JSON.stringify({ ok:true, instanceId:instNew, port:restartSrv.address().port, keepaliveMs:500, proof }));
      }
      res.writeHead(503, { "content-type":"application/json", "x-penecho-proxy-retry":"1" });
      res.end(JSON.stringify({ error:{ code:"proxy_restarting", message:"PenEcho's model proxy is restarting." } }));
    });
    await new Promise(r => restartSrv.listen(0, "127.0.0.1", r));
    closing.push(() => new Promise(r => { restartSrv.closeAllConnections?.(); restartSrv.close(r); }));
    const epRestart = path.join(temp, "pe835-restarting-ep.json");
    fs.writeFileSync(epRestart, JSON.stringify({ port:restartSrv.address().port, pid:process.pid, instanceId:instNew, proxyToken:tokenNew }));
    const relayRestartErr = await createProxyRelay({
      initialOrigin:`http://127.0.0.1:${restartSrv.address().port}`,
      secret:"sec-835-6",
      endpointFile:epRestart,
      initialProxyToken:tokenNew,
      initialInstanceId:instNew,
      reconnectMs:180,
      pollMs:25,
      handshakeMs:100,
    });
    closing.push(() => relayRestartErr.close());
    const restartFailRes = await fetch(`http://127.0.0.1:${relayRestartErr.port}/run/00000000-0000-4000-8000-000000000840/model/chat/completions`, {
      method:"POST",
      headers:{ "content-type":"application/json", authorization:"Bearer sec-835-6" },
      body:JSON.stringify({ stream:true, messages:[{ role:"user", content:"hi" }] }),
    });
    assert.equal(restartFailRes.status, 503);
    const restartFailBody = await restartFailRes.json();
    assert.match(restartFailBody.error.message, /did not come back after restart/i);
  }
});

test("penecho-runner finishes after a proxy restart even when Cloud answers request_in_progress more than 8 times before replaying the same idempotency-key", async () => {
  const stateDir = path.join(temp, "in-progress-restart-state");
  const workdir = path.join(temp, "in-progress-restart-work");
  for (const dir of [stateDir, workdir]) fs.mkdirSync(dir, { recursive:true });

  let firstHeldRes = null;
  const WAITS = 10;
  const model = await stubModel((request, n) => {
    if (n === 1) return { handle(req, res) { firstHeldRes = res; } };
    // The earlier call is still being finished on Cloud: Retry-After 0 makes the proxy use its own gentle floor, which a custom backoff replaces here.
    if (n <= 1 + WAITS) {
      return { handle(req, res) {
        res.writeHead(409, { "content-type":"application/json" });
        res.end(JSON.stringify({ error:{ code:"request_in_progress", message:"A request with this idempotency key is still running." } }));
      } };
    }
    return { text:"Replayed after the wait." };
  });
  closing.push(() => { try { firstHeldRes?.destroy(); } catch { /* Ignore. */ } });

  const retries = [];
  const options = { stateDir, keepaliveMs:50, backoff:() => 25, onRetry:(id, info) => retries.push(info) };
  const source1 = cloudSourceFor(model.url, options);
  await source1.listening;
  const agents = createAgents({ env:process.env, paths:{ penecho:source1, stateDir }, appFolders:[] });
  const command = agents.command("penecho", { workdir, docs:workdir });
  const child = spawn(command.command, command.args, {
    cwd:command.cwd,
    env:{ ...process.env, ...command.env, PENECHO_PROXY_RECONNECT_MS:"15000", PENECHO_PROXY_POLL_MS:"50" },
    stdio:["pipe", "pipe", "pipe"],
  });
  closing.push(() => { try { child.kill("SIGKILL"); } catch { /* Already exited. */ } });
  const lines = [];
  let stdoutBuf = "", stderr = "";
  child.stdout.on("data", chunk => {
    stdoutBuf += chunk.toString("utf8");
    const parts = stdoutBuf.split("\n");
    stdoutBuf = parts.pop() || "";
    for (const part of parts) if (part.trim()) lines.push(JSON.parse(part));
  });
  child.stderr.on("data", chunk => { stderr += chunk.toString("utf8"); });
  const exited = new Promise(resolve => child.on("close", code => resolve(code)));

  child.stdin.write(userLine("Wait through a restart and a slow earlier call."));
  await until(() => model.requests.length === 1, "first upstream request");
  await wait(160);
  firstHeldRes?.destroy();
  const closing1 = source1.close();
  await wait(150);
  const source2 = cloudSourceFor(model.url, options);
  closing.push(() => source2.close());
  await source2.listening;
  await closing1;

  await until(() => lines.some(l => l.type === "result"), "result after the in-progress waits");
  const result = lines.find(l => l.type === "result");
  assert.deepEqual([result.is_error, result.result], [false, "Replayed after the wait."], stderr);
  assert.equal(model.requests.length, 2 + WAITS, "the held call, the in-progress answers, then the replay");
  assert.equal(new Set(model.requests.map(r => r.headers["idempotency-key"])).size, 1, "one idempotency key through the restart and every wait");
  assert.equal(retries.length, WAITS);
  assert.ok(retries.every(r => r.why === "Waiting for the earlier model call to finish"));
  child.stdin.end();
  assert.equal(await exited, 0, stderr);
});

// ---- Real servers (server.js) signed in to a stub Cloud, with a runner's run already on disk, as after a PenEcho restart. ----
const CLOUD_MODEL = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
async function stubSignedInCloud(answer = "Signed-in answer.") {
  const posts = [], sockets = new Set();
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      const json = (status, body) => { res.writeHead(status, { "content-type":"application/json" }); res.end(JSON.stringify(body)); };
      if (req.method === "GET" && req.url === "/api/v1/models") return json(200, { models:[{ id:CLOUD_MODEL, apiFormat:"openai", available:true, enabled:true, worker:true, displayName:"Stub", sortOrder:1 }] });
      if (req.method === "GET" && req.url === "/api/v1/credits") return json(200, { credits:100 });
      if (req.method === "POST" && req.url.endsWith("/chat/completions")) {
        posts.push({ key:String(req.headers["idempotency-key"] || ""), auth:String(req.headers.authorization || ""), body:JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") });
        res.writeHead(200, { "content-type":"text/event-stream" });
        const base = { id:"chatcmpl-1", object:"chat.completion.chunk", created:1, model:"stub" };
        return res.end(`data: ${JSON.stringify({ ...base, choices:[{ index:0, delta:{ role:"assistant", content:answer }, finish_reason:null }] })}\n\ndata: ${JSON.stringify({ ...base, choices:[{ index:0, delta:{}, finish_reason:"stop" }] })}\n\ndata: [DONE]\n\n`);
      }
      json(404, { error:"not_found" });
    });
  });
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  closing.push(() => new Promise(done => { for (const socket of sockets) socket.destroy(); server.close(() => done()); }));
  return { posts, origin:`http://127.0.0.1:${server.address().port}` };
}

// A computer signed in to `cloud`, and one run (the secret a surviving runner holds) already in the proxy's registry.
function signedInComputer(root, cloud) {
  const stateDir = path.join(root, "state"), cloudDir = path.join(root, "cloud"), home = path.join(root, "home");
  for (const dir of [stateDir, cloudDir, home, path.join(stateDir, "project-lines", "model-proxy")]) fs.mkdirSync(dir, { recursive:true, mode:0o700 });
  fs.writeFileSync(path.join(cloudDir, "cloud-device.json"), JSON.stringify({ version:2, origin:cloud.origin, accountToken:"signed-in-account-token" }), { mode:0o600 });
  const run = { id:"11111111-2222-4333-8444-555555555555", secret:"surviving-runner-secret", pick:"", effort:"", usedAt:Date.now(), pid:0, calls:0 };
  fs.writeFileSync(path.join(stateDir, "project-lines", "model-proxy", "runs.json"), JSON.stringify({ version:1, runs:{ [run.id]:run } }), { mode:0o600 });
  return { root, stateDir, cloudDir, home, run, endpoint:path.join(stateDir, "project-lines", "model-proxy", "endpoint.json") };
}
// A preload that can hold the listen callback (the one that builds the Cloud connector) until a file says go, and says when the model
// proxy's own listener is up, so a test waits on those two events and not on a clock.
function writeListenGate(computer) {
  const shim = path.join(computer.root, "listen-gate.cjs"), gate = path.join(computer.root, "gate");
  fs.mkdirSync(gate, { recursive:true });
  fs.writeFileSync(shim, `
    const fs = require("node:fs"), path = require("node:path"), net = require("node:net"), real = net.Server.prototype.listen, gate = ${JSON.stringify(gate)};
    net.Server.prototype.listen = function (...args) {
      const last = args.length - 1;
      if (typeof args[last] === "function") {
        const callback = args[last], text = String(callback);
        if (text.includes("new CloudConnector(")) {
          args[last] = function (...rest) {
            fs.writeFileSync(path.join(gate, "main-held"), "1");
            const timer = setInterval(() => { if (fs.existsSync(path.join(gate, "release"))) { clearInterval(timer); callback.apply(this, rest); } }, 10);
          };
        } else if (text.includes("writeEndpoint(")) {
          args[last] = function (...rest) { const out = callback.apply(this, rest); fs.writeFileSync(path.join(gate, "proxy-listening"), "1"); return out; };
        }
      }
      return real.apply(this, args);
    };
  `);
  return { shim, has:name => fs.existsSync(path.join(gate, name)), release:() => fs.writeFileSync(path.join(gate, "release"), "1") };
}
function startComputer(computer, { shim = "", name = "server" } = {}) {
  const child = spawn(process.execPath, [...(shim ? ["--require", shim] : []), path.join(__dirname, "..", "server.js")], {
    cwd:path.join(__dirname, ".."),
    env:{ ...process.env, NODE_ENV:"test", PENECHO_LINES_PENECHO_AGENT:"1", PENECHO_STATE_DIR:computer.stateDir, PENECHO_CLOUD_STATE_DIR:computer.cloudDir, HOME:computer.home, USERPROFILE:computer.home, AI_PROVIDER:"codex-cli", HOST:"127.0.0.1", PORT:"0", PENECHO_TEST_OPEN_ACCESS:"1" },
    stdio:["ignore", "pipe", "pipe"],
  });
  const server = { child, name, out:"", exited:new Promise(resolve => child.once("close", resolve)) };
  child.stdout.on("data", chunk => { server.out += chunk.toString("utf8"); });
  child.stderr.on("data", chunk => { server.out += chunk.toString("utf8"); });
  closing.push(() => new Promise(done => { if (child.exitCode !== null || child.signalCode) return done(); child.once("close", done); child.kill("SIGKILL"); }));
  return server;
}
const readEndpoint = file => { try { const value = JSON.parse(fs.readFileSync(file, "utf8")); return Number(value?.port) > 0 ? value : null; } catch { return null; } };
// What the surviving runner does the moment it sees an endpoint: one model call with its own secret.
async function modelCall(endpoint, run) {
  const res = await fetch(`http://127.0.0.1:${endpoint.port}/run/${run.id}/model/chat/completions`, {
    method:"POST", headers:{ authorization:`Bearer ${run.secret}`, "content-type":"application/json", "x-penecho-call-id":"first-call" },
    body:JSON.stringify({ model:"x", messages:[{ role:"user", content:"hi" }], stream:true }),
  });
  return { status:res.status, body:await res.text() };
}
async function endpointWhere(computer, check, label, ms = 30_000) {
  const start = Date.now();
  for (;;) {
    const value = readEndpoint(computer.endpoint);
    if (value && check(value)) return value;
    if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}`);
    await wait(2);
  }
}

test("a signed-in PenEcho publishes endpoint.json only once its Cloud connector exists, and the first model call after it succeeds", async () => {
  const cloud = await stubSignedInCloud();
  const computer = signedInComputer(path.join(temp, "signed-in-start"), cloud);
  const gate = writeListenGate(computer);
  const server = startComputer(computer, { shim:gate.shim });
  // The model proxy is listening, the listen callback that builds the Cloud connector is held: nothing may be published meanwhile.
  await until(() => gate.has("proxy-listening") && gate.has("main-held"), `the proxy to listen while the connector waits\n${server.out}`);
  assert.equal(fs.existsSync(computer.endpoint), false, `endpoint.json was published before the Cloud connector existed\n${server.out}`);
  assert.equal(/PenEcho: http/.test(server.out), false, "the server has not said it is listening");
  await wait(150);
  assert.equal(fs.existsSync(computer.endpoint), false, "still nothing while the connector is not built");
  gate.release();
  // The runner's very first call lands the moment the file exists: it must be served, not refused as not set up.
  const endpoint = await endpointWhere(computer, () => true, "endpoint.json after the connector exists");
  const first = await modelCall(endpoint, computer.run);
  assert.equal(first.status, 200, `${first.body}\n${server.out}`);
  assert.match(first.body, /Signed-in answer\./);
  assert.doesNotMatch(first.body, /PENECHO_NOT_SET_UP|not set up/i);
  assert.equal(cloud.posts.length, 1);
  assert.ok(cloud.posts[0].key.startsWith(`pe-${computer.run.id}-`), cloud.posts[0].key);
  assert.equal(cloud.posts[0].auth, "Bearer signed-in-account-token");
  assert.equal(cloud.posts[0].body.model, CLOUD_MODEL);
});

test("a standby PenEcho takes over the model proxy when the first server ends: endpoint.json rotates and a signed-in call is served", async () => {
  const cloud = await stubSignedInCloud("Served after takeover.");
  const computer = signedInComputer(path.join(temp, "signed-in-standby"), cloud);
  const first = startComputer(computer, { name:"first" });
  const endpointA = await endpointWhere(computer, () => true, `the first server's endpoint.json\n${first.out}`);
  const beforeTakeover = await modelCall(endpointA, computer.run);
  assert.equal(beforeTakeover.status, 200, `${beforeTakeover.body}\n${first.out}`);

  const second = startComputer(computer, { name:"second" });
  await until(() => /PenEcho: http/.test(second.out), `the second server to listen\n${second.out}`);
  await wait(200);
  assert.equal(readEndpoint(computer.endpoint)?.instanceId, endpointA.instanceId, "a standby server does not publish while the first one runs the Lines");
  assert.equal(readEndpoint(computer.endpoint)?.port, endpointA.port);

  first.child.kill("SIGKILL");
  await first.exited;
  const endpointB = await endpointWhere(computer, value => value.instanceId !== endpointA.instanceId, `the endpoint to rotate to the second server\n${second.out}`);
  assert.notEqual(endpointB.port, endpointA.port);
  assert.equal(endpointB.pid, second.child.pid);
  const afterTakeover = await modelCall(endpointB, computer.run);
  assert.equal(afterTakeover.status, 200, `${afterTakeover.body}\n${second.out}`);
  assert.match(afterTakeover.body, /Served after takeover\./);
  assert.doesNotMatch(afterTakeover.body, /PENECHO_NOT_SET_UP|not set up/i);
  assert.equal(cloud.posts.length, 2);
  assert.ok(cloud.posts.every(post => post.key.startsWith(`pe-${computer.run.id}-`)));
});
