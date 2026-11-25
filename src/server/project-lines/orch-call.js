"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

// Shared Orchestrator caller used both by the built-in PenEcho runner's native `orchestrate` tool
// and by external CLI coordinators (`node "$PENECHO_ORCH_HELPER" '{"do":"help"}'`).
// Re-resolves the owning PenEcho port from endpointFile on every call, mutually authenticates the
// listener on the exact same TCP socket via GET /identity?nonce=... before transmitting x-penecho-pass
// or payload, retries pre-dispatch failures across restarts/standby 409/closing 503, and never blinds-retries
// mutating calls after an ambiguous post-dispatch transport reset.

const MUTATING_ACTIONS = new Set([
  "decide", "set-price", "create-line", "start-line", "add-task",
  "stop", "retry", "rate", "review", "todo", "status", "rename", "rebuild-topics",
]);
const sameSecret = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const expectedOrchProof = (orchToken, nonce, port, instanceId) =>
  crypto.createHmac("sha256", String(orchToken)).update(`${nonce}:${port}:${instanceId}`).digest("base64url");

function parseLocalEndpoint(rawUrl) {
  try {
    const u = new URL(String(rawUrl || "").trim());
    if (u.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(u.hostname)) return null;
    const port = Number(u.port) || 80;
    if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
    return { url:u.toString(), hostname:u.hostname, port, path:`${u.pathname}${u.search}` || "/api/lines/orchestrate", basePath:u.pathname.replace(/\/+$/, "") || "/api/lines/orchestrate" };
  } catch { return null; }
}

function readEndpointTarget(endpointFile, fallback = {}) {
  if (endpointFile) {
    try {
      const data = JSON.parse(fs.readFileSync(endpointFile, "utf8"));
      const rawUrl = typeof data?.url === "string" && parseLocalEndpoint(data.url)
        ? data.url
        : (Number.isInteger(Number(data?.port)) && Number(data.port) > 0 && Number(data.port) <= 65535
          ? `http://127.0.0.1:${Number(data.port)}/api/lines/orchestrate` : "");
      const parsed = parseLocalEndpoint(rawUrl);
      const orchToken = typeof data?.orchToken === "string" ? data.orchToken : "";
      const instanceId = typeof data?.instanceId === "string" ? data.instanceId : "";
      if (parsed && orchToken && instanceId) return { ...parsed, orchToken, instanceId };
    } catch { /* Missing or mid-rotation: wait for a verified endpoint. */ }
    return null;
  }
  const parsed = parseLocalEndpoint(fallback.url);
  if (!parsed || !fallback.orchToken || !fallback.instanceId) return null;
  return { ...parsed, orchToken:String(fallback.orchToken), instanceId:String(fallback.instanceId) };
}

function readEndpointUrl(endpointFile) {
  if (!endpointFile) return "";
  try {
    const data = JSON.parse(fs.readFileSync(endpointFile, "utf8"));
    if (typeof data?.url === "string" && parseLocalEndpoint(data.url)) return data.url;
    const port = Number(data?.port);
    if (Number.isInteger(port) && port > 0 && port <= 65535) return `http://127.0.0.1:${port}/api/lines/orchestrate`;
  } catch { /* Missing or mid-rotation. */ }
  return "";
}

// Authenticates the target Orchestrator endpoint on one dedicated keep-alive socket before sending x-penecho-pass or payload.
function openVerifiedOrchAgent(target, { signal = null, handshakeMs = 3_000 } = {}) {
  return new Promise(resolve => {
    if (!target?.orchToken || !target?.instanceId || signal?.aborted) return resolve({ ok:false, retryable:true });
    let connects = 0;
    const agent = new http.Agent({ keepAlive:true, maxSockets:1 });
    agent.createConnection = (options, cb) => {
      if (++connects > 1) {
        const err = Object.assign(new Error("Verified orchestrator socket was not reused."), { code:"ORCH_SOCKET_NOT_REUSED" });
        if (typeof cb === "function") { cb(err); return null; }
        throw err;
      }
      return net.connect(options, cb);
    };
    const nonce = crypto.randomBytes(16).toString("base64url");
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
      if (!result.ok) agent.destroy();
      resolve(result);
    };
    const onAbort = () => { req.destroy(); finish({ ok:false, aborted:true }); };
    signal?.addEventListener?.("abort", onAbort, { once:true });
    const timer = setTimeout(() => { req.destroy(); finish({ ok:false, retryable:true }); }, handshakeMs);
    const req = http.request({
      hostname:target.hostname,
      port:target.port,
      method:"GET",
      path:`${target.basePath}/identity?nonce=${encodeURIComponent(nonce)}`,
      agent,
      headers:{ connection:"keep-alive" },
    }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let data = null;
        try { data = JSON.parse(text); } catch { /* Non-JSON response. */ }
        if (res.statusCode === 409 && data?.code === "RUNTIME_BUSY") {
          return finish({ ok:false, retryable:true, standby:true, status:409, text, json:data });
        }
        if (res.statusCode === 503 && (!data?.code || data.code === "CLOSING")) {
          return finish({ ok:false, retryable:true, closing:true, status:503, text, json:data });
        }
        if (res.statusCode !== 200 || !data?.ok || data.instanceId !== target.instanceId) {
          return finish({ ok:false, retryable:true });
        }
        const want = expectedOrchProof(target.orchToken, nonce, target.port, target.instanceId);
        if (!sameSecret(String(data.proof || ""), want)) {
          return finish({ ok:false, retryable:true });
        }
        setImmediate(() => {
          if (settled || signal?.aborted) return finish({ ok:false, aborted:Boolean(signal?.aborted) });
          finish({ ok:true, agent, target });
        });
      });
      res.on("error", () => finish({ ok:false, retryable:true }));
      res.on("aborted", () => finish({ ok:false, retryable:true }));
    });
    req.on("error", err => finish({ ok:false, retryable:true, error:err }));
    req.end();
  });
}

function postJsonOnAgent(target, agent, pass, payloadBytes, { opId = "", signal = null, timeoutMs = 15 * 60 * 1000 + 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Object.assign(new Error("Aborted"), { code:"ABORT_ERR" }));
    let settled = false, dispatched = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener?.("abort", onAbort);
      agent.destroy();
      if (err) reject(err); else resolve(value);
    };
    const req = http.request({
      hostname:target.hostname,
      port:target.port,
      method:"POST",
      path:target.path,
      agent,
      headers:{
        "content-type":"application/json",
        "content-length":String(payloadBytes.length),
        "x-penecho-pass":String(pass || ""),
        ...(opId ? { "x-penecho-op-id":opId } : {}),
        connection:"close",
      },
      timeout:timeoutMs,
    }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch { /* Non-JSON response. */ }
        finish(null, { status:res.statusCode || 502, text, json });
      });
      res.on("error", err => finish(Object.assign(err, { postDispatch:true })));
      res.on("aborted", () => finish(Object.assign(new Error("Connection closed before response ended."), { code:"ECONNRESET", postDispatch:true })));
    });
    const onAbort = () => { req.destroy(); finish(Object.assign(new Error("Aborted"), { code:"ABORT_ERR" })); };
    signal?.addEventListener?.("abort", onAbort, { once:true });
    req.on("timeout", () => { req.destroy(); finish(Object.assign(new Error("Orchestrator request timed out."), { code:"ETIMEDOUT", postDispatch:dispatched })); });
    req.on("error", err => {
      const preDispatch = err?.code === "ECONNREFUSED" || err?.code === "ORCH_SOCKET_NOT_REUSED" || !dispatched;
      finish(Object.assign(err, { postDispatch:!preDispatch }));
    });
    req.end(payloadBytes, () => { dispatched = true; });
  });
}

function sleep(ms, signal) {
  return new Promise(resolve => {
    if (signal?.aborted || ms <= 0) return resolve();
    const timer = setTimeout(() => { signal?.removeEventListener?.("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); resolve(); };
    signal?.addEventListener?.("abort", onAbort, { once:true });
  });
}

async function callOrchestrator({
  url = "",
  pass = "",
  endpointFile = "",
  orchToken = "",
  instanceId = "",
  body,
  opId = "",
  signal = null,
  retryMs = 90_000,
  pollMs = 500,
  handshakeMs = 3_000,
  requestTimeoutMs,
} = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body ?? {});
  const payloadBytes = Buffer.from(payload, "utf8");
  let action = "";
  try { action = String(JSON.parse(payload)?.do || ""); } catch { /* Invalid JSON handled by server. */ }
  const isMutating = MUTATING_ACTIONS.has(action);
  const effectiveOpId = String(opId || (isMutating ? crypto.randomUUID() : "")).trim();
  let outageDeadline = 0;
  let lastError = null;
  let lastStandbyResponse = null;

  for (;;) {
    if (signal?.aborted) throw Object.assign(new Error("Orchestrator call aborted."), { code:"ABORT_ERR" });
    const target = readEndpointTarget(endpointFile, { url, orchToken, instanceId });
    if (!target) {
      if (!outageDeadline) outageDeadline = Date.now() + retryMs;
      const left = outageDeadline - Date.now();
      if (left <= 0) throw Object.assign(new Error("No verified PenEcho orchestrator endpoint is available."), { code:"ORCH_UNVERIFIED" });
      await sleep(Math.min(pollMs, left), signal);
      continue;
    }

    const verified = await openVerifiedOrchAgent(target, {
      signal,
      handshakeMs:outageDeadline ? Math.min(handshakeMs, Math.max(100, outageDeadline - Date.now())) : handshakeMs,
    });
    if (verified.aborted || signal?.aborted) throw Object.assign(new Error("Orchestrator call aborted."), { code:"ABORT_ERR" });
    if (!verified.ok) {
      if (verified.error) lastError = verified.error;
      if (verified.status) lastStandbyResponse = { status:verified.status, text:verified.text, json:verified.json };
      if (!outageDeadline) outageDeadline = Date.now() + retryMs;
      const left = outageDeadline - Date.now();
      if (left <= 0) {
        if (lastStandbyResponse) return lastStandbyResponse;
        throw lastError || Object.assign(new Error("Could not verify PenEcho orchestrator endpoint."), { code:"ORCH_UNVERIFIED" });
      }
      await sleep(Math.min(verified.standby ? 100 : pollMs, left), signal);
      continue;
    }

    try {
      const response = await postJsonOnAgent(verified.target, verified.agent, pass, payloadBytes, {
        opId:effectiveOpId,
        signal,
        ...(requestTimeoutMs ? { timeoutMs:requestTimeoutMs } : {}),
      });
      const code = String(response.json?.code || "");
      const retryableStandby = response.status === 409 && code === "RUNTIME_BUSY";
      const retryableClosing = response.status === 503 && (!code || code === "CLOSING");
      if (retryableStandby || retryableClosing) {
        lastStandbyResponse = response;
        if (!outageDeadline) outageDeadline = Date.now() + retryMs;
        const left = outageDeadline - Date.now();
        if (left <= 0) return response;
        await sleep(Math.min(retryableStandby ? 100 : pollMs, left), signal);
        continue;
      }
      return response;
    } catch (error) {
      if (error?.code === "ABORT_ERR" || signal?.aborted) throw error;
      // Never blindly resubmit a mutating action after an ambiguous post-dispatch transport reset:
      // surface an explicit unknown-outcome error so the caller checks current state before retrying.
      if (isMutating && error?.postDispatch) {
        throw Object.assign(
          new Error(`Orchestrator ${action} connection dropped before a response arrived; check current Line state before retrying (opId=${effectiveOpId}).`),
          { code:"AMBIGUOUS_OUTCOME", opId:effectiveOpId, cause:error }
        );
      }
      lastError = error;
      if (!outageDeadline) outageDeadline = Date.now() + retryMs;
      const left = outageDeadline - Date.now();
      if (left <= 0) throw lastError;
      await sleep(Math.min(pollMs, left), signal);
    }
  }
}

if (require.main === module) {
  (async () => {
    let raw = process.argv[2];
    if (raw === undefined) {
      const chunks = [];
      for await (const chunk of process.stdin) chunks.push(chunk);
      raw = Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, "").trim();
    }
    if (!raw) {
      process.stderr.write("Usage: node orch-call.js '{\"do\":\"help\"}'\n");
      process.exit(2);
    }
    const response = await callOrchestrator({
      url:process.env.PENECHO_ORCH_URL || "",
      pass:process.env.PENECHO_ORCH_PASS || "",
      endpointFile:process.env.PENECHO_ORCH_ENDPOINT || "",
      orchToken:process.env.PENECHO_ORCH_PROOF_KEY || "",
      instanceId:process.env.PENECHO_ORCH_INSTANCE || "",
      body:raw,
      retryMs:Math.max(1000, Number(process.env.PENECHO_ORCH_RETRY_MS) || 90_000),
      pollMs:Math.max(25, Math.min(2000, Number(process.env.PENECHO_ORCH_POLL_MS) || 500)),
    });
    process.stdout.write(response.text.endsWith("\n") ? response.text : `${response.text}\n`);
    if (response.status < 200 || response.status >= 300) process.exit(1);
  })().catch(error => {
    process.stderr.write(`${error?.message || error}\n`);
    process.exit(1);
  });
}

function resolveUnpackedAsarPath(file, exists = fs.existsSync) {
  const value = String(file || "");
  const unpacked = value.replace(/([\\/])app\.asar\1/, "$1app.asar.unpacked$1");
  return unpacked !== value && exists(unpacked) ? unpacked : value;
}

const HELPER_PATH = resolveUnpackedAsarPath(path.resolve(__filename));

module.exports = { callOrchestrator, readEndpointUrl, readEndpointTarget, parseLocalEndpoint, expectedOrchProof, resolveUnpackedAsarPath, HELPER_PATH };
