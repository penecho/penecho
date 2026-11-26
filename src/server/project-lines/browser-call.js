#!/usr/bin/env node
"use strict";
// Zero-dependency caller for the local browser endpoint.
// Authenticates the target PenEcho listener on a dedicated keep-alive socket via GET /api/browser/identity
// before transmitting x-penecho-token or request payloads (preventing port-reuse credential leaks),
// and recovers cleanly across PenEcho restarts/port changes within the intended instance.
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

function resolveUnpackedAsarPath(file, exists = fs.existsSync) {
  const value = String(file || "");
  const unpacked = value.replace(/([\\/])app\.asar\1/, "$1app.asar.unpacked$1");
  return unpacked !== value && exists(unpacked) ? unpacked : value;
}

const BROWSER_HELPER_PATH = resolveUnpackedAsarPath(path.resolve(__filename));
const DEFAULT_FILE = () => path.join(os.homedir(), ".penecho", "browser.json");
const MAX_RESPONSE = 64 * 1024 * 1024;

function sameSecret(a, b) {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}
function expectedBrowserProof(proofKey, nonce, port, instanceId) {
  return crypto.createHmac("sha256", String(proofKey)).update(`${nonce}:${port}:${instanceId}`).digest("base64url");
}
function localEndpoint(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname.toLowerCase()) || url.username || url.password || url.pathname !== "/api/browser") return null;
    return { url:url.href, hostname:url.hostname.replace(/^\[|\]$/g, ""), port:Number(url.port) || 80, path:`${url.pathname}${url.search}` };
  } catch { return null; }
}
function readBrowserDiscovery(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const endpoint = localEndpoint(data?.url || (Number(data?.port) > 0 ? `http://127.0.0.1:${Number(data.port)}/api/browser` : ""));
    if (!endpoint || typeof data?.token !== "string" || !/^[a-f0-9]{64}$/i.test(data.token)) return null;
    return {
      ...endpoint,
      token:data.token,
      pid:Number(data.pid) || 0,
      instanceId:typeof data.instanceId === "string" ? data.instanceId : "",
      proofKey:typeof data.proofKey === "string" ? data.proofKey : "",
    };
  } catch { return null; }
}
function readEndpointFile(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const endpoint = localEndpoint(data?.url || (Number(data?.port) > 0 ? `http://127.0.0.1:${Number(data.port)}/api/browser` : ""));
    if (!endpoint || typeof data?.proofKey !== "string" || !data.proofKey || typeof data?.instanceId !== "string" || !data.instanceId) return null;
    return { ...endpoint, instanceId:data.instanceId, proofKey:data.proofKey, pid:Number(data.pid) || 0 };
  } catch { return null; }
}

// Authenticates the target listener on one dedicated keep-alive socket before sending token or body.
function openVerifiedBrowserAgent(target, { signal = null, handshakeMs = 3000 } = {}) {
  return new Promise(resolve => {
    if (!target?.proofKey || !target?.instanceId || signal?.aborted) return resolve({ ok:false });
    let connects = 0;
    const agent = new http.Agent({ keepAlive:true, maxSockets:1 });
    agent.createConnection = (options, cb) => {
      if (++connects > 1) {
        const err = Object.assign(new Error("Verified browser socket was not reused."), { code:"BROWSER_SOCKET_NOT_REUSED" });
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
    const timer = setTimeout(() => { req.destroy(); finish({ ok:false }); }, handshakeMs);
    timer.unref?.();
    const req = http.request({
      hostname:target.hostname,
      port:target.port,
      method:"GET",
      path:`/api/browser/identity?nonce=${encodeURIComponent(nonce)}`,
      agent,
      headers:{ connection:"keep-alive" },
    }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => {
        if (res.statusCode !== 200) return finish({ ok:false });
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          const want = expectedBrowserProof(target.proofKey, nonce, target.port, target.instanceId);
          if (!data?.ok || data.instanceId !== target.instanceId || !sameSecret(data.proof, want)) return finish({ ok:false });
          setImmediate(() => {
            if (settled || signal?.aborted) return finish({ ok:false, aborted:Boolean(signal?.aborted) });
            finish({ ok:true, agent, target });
          });
        } catch { finish({ ok:false }); }
      });
      res.on("error", () => finish({ ok:false }));
      res.on("aborted", () => finish({ ok:false }));
    });
    req.on("error", err => finish({ ok:false, error:err }));
    req.end();
  });
}

function postBrowser(target, pass, payload, { agent = null, signal = null, timeoutMs = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { agent?.destroy?.(); reject(Object.assign(new Error("Browser call aborted."), { code:"ABORT_ERR" })); return; }
    let done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", aborted);
      agent?.destroy?.();
      if (error) reject(error); else resolve(value);
    };
    const req = http.request({
      hostname:target.hostname,
      port:target.port,
      path:target.path,
      method:"POST",
      ...(agent ? { agent } : {}),
      headers:{ "content-type":"application/json", "content-length":payload.length, "x-penecho-token":String(pass || ""), connection:"close" },
    }, res => {
      const chunks = [];
      let size = 0;
      res.on("data", chunk => {
        size += chunk.length;
        if (size > MAX_RESPONSE) { req.destroy(Object.assign(new Error("The browser response is too large."), { code:"TOO_LARGE" })); return; }
        chunks.push(chunk);
      });
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch { /* Return the text as it arrived. */ }
        finish(null, { status:res.statusCode || 502, text, json });
      });
      res.on("error", finish);
      res.on("aborted", () => finish(Object.assign(new Error("The browser connection closed early."), { code:"ECONNRESET" })));
    });
    const timer = setTimeout(() => req.destroy(Object.assign(new Error("The browser call timed out."), { code:"ETIMEDOUT" })), timeoutMs);
    timer.unref?.();
    const aborted = () => req.destroy(Object.assign(new Error("Browser call aborted."), { code:"ABORT_ERR" }));
    signal?.addEventListener?.("abort", aborted, { once:true });
    req.on("error", finish);
    req.end(payload);
  });
}

async function sendVerified(target, pass, payload, { signal = null, timeoutMs = 60000 } = {}) {
  // Always verify listener identity on the exact same TCP socket before transmitting token or body (fail closed).
  if (!target?.proofKey || !target?.instanceId) {
    throw Object.assign(new Error("Missing PenEcho browser endpoint identity credentials."), { code:"BROWSER_UNVERIFIED" });
  }
  const verified = await openVerifiedBrowserAgent(target, { signal });
  if (verified.aborted) throw Object.assign(new Error("Browser call aborted."), { code:"ABORT_ERR" });
  if (!verified.ok) {
    const err = verified.error || Object.assign(new Error("Could not verify PenEcho browser endpoint identity."), { code:"BROWSER_UNVERIFIED" });
    throw err;
  }
  return postBrowser(verified.target, pass, payload, { agent:verified.agent, signal, timeoutMs });
}

async function callBrowser({
  url = "",
  pass = "",
  endpointFile = "",
  proofKey = "",
  instanceId = "",
  browserFile = "",
  file = "",
  allowGlobalDiscovery = true,
  body = {},
  env = process.env,
  signal = null,
  timeoutMs = 60000,
} = {}) {
  const payloadText = typeof body === "string" ? body : JSON.stringify(body ?? {});
  const payload = Buffer.from(payloadText, "utf8");
  if (payload.length > 4 * 1024 * 1024) throw Object.assign(new Error("The browser request is larger than 4 MiB."), { code:"TOO_LARGE" });

  const initialUrl = url || env.PENECHO_BROWSER_URL || "";
  const initialPass = pass || env.PENECHO_BROWSER_PASS || "";
  const effectiveEndpointFile = endpointFile || env.PENECHO_BROWSER_ENDPOINT || "";
  const effectiveProofKey = proofKey || env.PENECHO_BROWSER_PROOF_KEY || "";
  const effectiveInstanceId = instanceId || env.PENECHO_BROWSER_INSTANCE || "";
  const discoveryFile = allowGlobalDiscovery ? (browserFile || file || env.PENECHO_BROWSER_FILE || DEFAULT_FILE()) : "";

  const fromEnvironment = localEndpoint(initialUrl);
  if (initialUrl && !fromEnvironment) throw Object.assign(new Error("PENECHO_BROWSER_URL must be a loopback http:// URL ending in /api/browser."), { code:"BAD_BROWSER_URL" });

  let target = null;
  let effectiveToken = initialPass;
  if (fromEnvironment && initialPass) {
    let resolvedProofKey = effectiveProofKey, resolvedInstanceId = effectiveInstanceId;
    if ((!resolvedProofKey || !resolvedInstanceId) && effectiveEndpointFile) {
      const ep = readEndpointFile(effectiveEndpointFile);
      if (ep && ep.port === fromEnvironment.port) { resolvedProofKey = ep.proofKey; resolvedInstanceId = ep.instanceId; }
    }
    if ((!resolvedProofKey || !resolvedInstanceId) && discoveryFile) {
      const found = readBrowserDiscovery(discoveryFile);
      if (found && found.port === fromEnvironment.port) { resolvedProofKey = found.proofKey; resolvedInstanceId = found.instanceId; }
    }
    target = { ...fromEnvironment, proofKey:resolvedProofKey, instanceId:resolvedInstanceId };
  } else if (effectiveEndpointFile && initialPass) {
    const ep = readEndpointFile(effectiveEndpointFile);
    if (ep) target = ep;
  } else if (discoveryFile) {
    const found = readBrowserDiscovery(discoveryFile);
    if (found) { target = found; effectiveToken = found.token; }
  }
  if (!target || !effectiveToken) {
    throw Object.assign(new Error("No verified PenEcho browser endpoint is configured; start PenEcho or check its discovery file."), { code:"NO_BROWSER" });
  }

  try {
    return await sendVerified(target, effectiveToken, payload, { signal, timeoutMs });
  } catch (error) {
    if (!["ECONNREFUSED", "BROWSER_UNVERIFIED", "ECONNRESET"].includes(error?.code)) throw error;
    // Recover only within the intended instance when endpointFile is pinned; otherwise re-read global discovery
    // and only switch if the discovery file itself has matching verified credentials (same token/owner unless discovery-only).
    if (effectiveEndpointFile) {
      const freshEp = readEndpointFile(effectiveEndpointFile);
      if (!freshEp) throw error;
      return sendVerified(freshEp, effectiveToken, payload, { signal, timeoutMs });
    }
    if (!discoveryFile) throw error;
    const fresh = readBrowserDiscovery(discoveryFile);
    if (!fresh) throw error;
    if (initialPass && !sameSecret(fresh.token, initialPass)) throw error;
    return sendVerified(fresh, fresh.token, payload, { signal, timeoutMs });
  }
}

const USAGE = `Usage:
  node "$PENECHO_BROWSER_HELPER" '{"url":"http://127.0.0.1:3000","steps":[{"op":"click","selector":"button"}]}'
  node "$PENECHO_BROWSER_HELPER" --status
  printf '%s' '{"file":"/absolute/page.html"}' | node "$PENECHO_BROWSER_HELPER"
  Windows PowerShell (it drops the quotes of JSON given as an argument):
  '{"file":"C:/absolute/page.html"}' | node "$env:PENECHO_BROWSER_HELPER"

The JSON body also accepts html, dir, viewport, waitUntil, waitFor, settleMs, screenshot,
includeText, includeHtml, layoutCheck, offline, keepSession, sessionId and timeoutMs.
Actions: inspect (default), close, status, help. Discovery: ~/.penecho/browser.json.
`;

if (require.main === module) {
  (async () => {
    const arg = process.argv[2];
    if (arg === "--help" || arg === "-h") { process.stdout.write(USAGE); return; }
    let raw = arg;
    if (arg === "--status") raw = JSON.stringify({ action:"status" });
    if (raw === undefined) {
      const chunks = [];
      for await (const chunk of process.stdin) chunks.push(chunk);
      raw = Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, "").trim();
    }
    if (!raw) { process.stderr.write(USAGE); process.exitCode = 2; return; }
    const response = await callBrowser({ body:raw });
    process.stdout.write(response.text.endsWith("\n") ? response.text : `${response.text}\n`);
    if (response.status < 200 || response.status >= 300) process.exitCode = 1;
  })().catch(error => { process.stderr.write(`${error?.message || error}\n`); process.exitCode = 1; });
}

module.exports = { callBrowser, BROWSER_HELPER_PATH, resolveUnpackedAsarPath, readBrowserDiscovery, readEndpointFile, expectedBrowserProof, postBrowser, localEndpoint, USAGE };
