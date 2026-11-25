"use strict";
// Local agent browser endpoint. Loopback-only, guarded against cross-site calls and DNS rebinding,
// supports mutual server-identity verification (/api/browser/identity), Work-scoped folder-restricted
// signed tokens, and serialized atomic discovery file ownership in ~/.penecho/browser.json.
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { createBrowserEngine, browserError, ACTIONS, STEP_OPS } = require("./project-lines/browser-engine.js");
const { BROWSER_HELPER_PATH, expectedBrowserProof } = require("./project-lines/browser-call.js");

const MAX_BODY = 4 * 1024 * 1024;
const TOKEN = /^[a-f0-9]{64}$/;
const LOOPBACK_NAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const LOCK_WAIT = new Int32Array(new SharedArrayBuffer(4));

function isLoopback(address) {
  const value = String(address || "").toLowerCase().split("%", 1)[0];
  const ip = value.startsWith("::ffff:") ? value.slice(7) : value;
  return ip === "::1" || ip === "127.0.0.1" || ip.startsWith("127.");
}
function hostOf(req) {
  const value = typeof req.headers.host === "string" ? req.headers.host.trim() : "";
  try { const url = new URL(`http://${value}`); return url.pathname === "/" && !url.username ? url : null; } catch { return null; }
}
function sameToken(given, token) {
  const a = Buffer.from(String(given || "")), b = Buffer.from(String(token || ""));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}
function sendJson(res, status, value) {
  const data = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { "content-type":"application/json; charset=utf-8", "content-length":data.length, "cache-control":"no-store", "x-content-type-options":"nosniff" });
  res.end(data);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0, done = false;
    req.on("data", chunk => {
      if (done) return;
      size += chunk.length;
      if (size > limit) { done = true; reject(browserError("TOO_LARGE", "The browser request is larger than 4 MiB.", 413)); req.resume(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    req.on("error", error => { if (!done) { done = true; reject(error); } });
  });
}
function pidAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try { process.kill(n, 0); return true; } catch (error) { return error?.code === "EPERM"; }
}
function withDiscoveryLock(lockFile, fn) {
  fs.mkdirSync(path.dirname(lockFile), { recursive:true, mode:0o700 });
  const owner = JSON.stringify({ pid:process.pid, nonce:crypto.randomBytes(8).toString("hex") });
  const deadline = Date.now() + 2000;
  let acquired = false;
  while (Date.now() < deadline) {
    try {
      const fd = fs.openSync(lockFile, "wx", 0o600);
      try { fs.writeSync(fd, owner); } finally { fs.closeSync(fd); }
      acquired = true;
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") break;
      try {
        const held = JSON.parse(fs.readFileSync(lockFile, "utf8"));
        if (held?.pid && !pidAlive(held.pid)) { fs.rmSync(lockFile, { force:true }); continue; }
      } catch {
        // Corrupt or disappearing lock file: remove if older than 5s.
        try { if (Date.now() - fs.statSync(lockFile).mtimeMs > 5000) fs.rmSync(lockFile, { force:true }); } catch { /* Gone. */ }
      }
      Atomics.wait(LOCK_WAIT, 0, 0, 15);
    }
  }
  if (!acquired) return { locked:false, value:null };
  try { return { locked:true, value:fn() }; }
  finally {
    try { if (fs.readFileSync(lockFile, "utf8") === owner) fs.rmSync(lockFile, { force:true }); } catch { /* Already gone. */ }
  }
}
function loadOrCreateSecretFile(file, field) {
  try {
    const lst = fs.lstatSync(file);
    if (lst.isSymbolicLink() || !lst.isFile()) throw new Error("Token file must be a regular file.");
    if (process.platform !== "win32" && (lst.mode & 0o077) !== 0) {
      try { fs.chmodSync(file, 0o600); } catch { /* Best-effort tighten. */ }
    }
    const kept = JSON.parse(fs.readFileSync(file, "utf8"))?.[field];
    if (TOKEN.test(kept)) return kept;
  } catch { /* Create fresh below. */ }
  const made = crypto.randomBytes(32).toString("hex");
  fs.mkdirSync(path.dirname(file), { recursive:true, mode:0o700 });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ [field]:made }), { mode:0o600 });
  try { fs.chmodSync(tmp, 0o600); } catch { /* Windows keeps its own rights. */ }
  fs.renameSync(tmp, file);
  return made;
}
function verifyLiveOwner(entry) {
  const port = Number(entry?.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return Promise.resolve(false);
  if (!entry.proofKey || !entry.instanceId) return Promise.resolve(false);
  const nonce = crypto.randomBytes(12).toString("base64url");
  return new Promise(resolve => {
    let done = false;
    const finish = ok => { if (done) return; done = true; clearTimeout(timer); resolve(ok); };
    const req = http.request({
      hostname:"127.0.0.1",
      port,
      method:"GET",
      path:`/api/browser/identity?nonce=${encodeURIComponent(nonce)}`,
      headers:{ connection:"close" },
    }, res => {
      let text = "";
      res.on("data", chunk => { text = (text + chunk).slice(0, 4096); });
      res.on("end", () => {
        if (res.statusCode !== 200) return finish(false);
        try {
          const data = JSON.parse(text);
          const want = expectedBrowserProof(entry.proofKey, nonce, port, entry.instanceId);
          finish(Boolean(data?.ok && data.instanceId === entry.instanceId && sameToken(data.proof, want)));
        } catch { finish(false); }
      });
      res.on("error", () => finish(false));
    });
    const timer = setTimeout(() => { req.destroy(); finish(false); }, 800);
    timer.unref?.();
    req.on("error", () => finish(false));
    req.end();
  });
}
function help() {
  return {
    ok:true,
    actions:ACTIONS,
    stepOps:STEP_OPS,
    inputs:["url", "file", "html", "dir", "entry", "sessionId", "viewport", "waitUntil", "waitFor", "settleMs", "waitMs", "steps", "screenshot", "includeText", "includeHtml", "layoutCheck", "offline", "allowExternal", "keepSession", "timeoutMs"],
    usage:{
      helper:`node "$PENECHO_BROWSER_HELPER" '{"file":"/absolute/page.html"}'`,
      powershell:`'{"file":"C:/absolute/page.html"}' | node "$env:PENECHO_BROWSER_HELPER"`,
      curl:`curl -s "$PENECHO_BROWSER_URL" -H "x-penecho-token: $PENECHO_BROWSER_PASS" -H "content-type: application/json" -d '{"url":"http://127.0.0.1:3000"}'`,
      discovery:"~/.penecho/browser.json (or $PENECHO_BROWSER_FILE)",
    },
  };
}

function createBrowser({ stateDirectory, home = os.homedir(), browserFile = null, engineOptions = {} }) {
  if (!stateDirectory) throw new TypeError("createBrowser needs stateDirectory.");
  const engine = createBrowserEngine({ stateDirectory, ...engineOptions });
  const tokenFile = path.join(stateDirectory, "browser-token.json");
  const proofFile = path.join(stateDirectory, "browser-proof.json");
  const endpointFile = path.join(stateDirectory, "browser-endpoint.json");
  const homeFile = browserFile || process.env.PENECHO_BROWSER_FILE || (process.env.NODE_ENV === "test" ? path.join(stateDirectory, "penecho-browser.json") : path.join(home, ".penecho", "browser.json"));
  const lockFile = `${homeFile}.lock`;
  const token = loadOrCreateSecretFile(tokenFile, "token");
  const proofKey = loadOrCreateSecretFile(proofFile, "proofKey");
  const instanceId = crypto.randomUUID();
  const named = () => { try { return JSON.parse(fs.readFileSync(homeFile, "utf8")); } catch { return null; } };
  let announcedPort = 0, retry = null, closed = false;

  // Issue a Work-scoped signed token bound to approved filesystem roots (survives PenEcho restarts).
  function issueScope({ roots = [], workId = "" } = {}) {
    const normalizedRoots = [...new Set(roots.filter(r => typeof r === "string" && path.isAbsolute(r)).map(r => {
      try { return fs.realpathSync(r); } catch { return path.resolve(r); }
    }))];
    const payload = Buffer.from(JSON.stringify({ r:normalizedRoots, w:String(workId || ""), n:crypto.randomBytes(12).toString("hex") })).toString("base64url");
    const sig = crypto.createHmac("sha256", token).update(payload).digest("base64url");
    return `v1.${payload}.${sig}`;
  }
  function verifyToken(given) {
    const raw = String(given || "");
    if (!raw) return null;
    if (sameToken(raw, token)) return { kind:"global", id:"global", roots:null };
    if (!raw.startsWith("v1.")) return null;
    const parts = raw.split(".");
    if (parts.length !== 3) return null;
    const want = crypto.createHmac("sha256", token).update(parts[1]).digest("base64url");
    if (!sameToken(parts[2], want)) return null;
    try {
      const data = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
      if (!Array.isArray(data?.r) || data.r.some(r => typeof r !== "string" || !path.isAbsolute(r))) return null;
      return { kind:"scoped", id:`scope:${data.w || ""}:${parts[2].slice(0, 16)}`, roots:data.r, workId:String(data.w || "") };
    } catch { return null; }
  }

  function writeJsonAtomic(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive:true, mode:0o700 });
    const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(data)}\n`, { mode:0o600 });
    try { fs.chmodSync(temporary, 0o600); } catch { /* Windows keeps its own rights. */ }
    fs.renameSync(temporary, file);
  }
  function writeEndpointFile(port) {
    // Token-less endpoint metadata for same-instance restart recovery (safe for scoped built-in runners).
    writeJsonAtomic(endpointFile, { port, url:`http://127.0.0.1:${port}/api/browser`, instanceId, proofKey, pid:process.pid });
  }
  async function announce(port) {
    announcedPort = Number(port);
    writeEndpointFile(announcedPort);
    const other = named();
    const otherWasLive = Boolean(
      other && (Number(other.port) !== announcedPort || other.instanceId !== instanceId) && other.token !== token && await verifyLiveOwner(other)
    );
    if (otherWasLive) {
      if (!retry) { retry = setInterval(() => { announce(announcedPort).catch(() => {}); }, 60000); retry.unref?.(); }
      return { written:false, file:homeFile, port:Number(other.port) };
    }
    const locked = withDiscoveryLock(lockFile, () => {
      const current = named();
      // If a DIFFERENT instance appeared since our check above, defer to the next verification cycle;
      // if it is the exact stale entry we just verified dead/non-PenEcho, replace it cleanly.
      const racedNewOwner = Boolean(
        current && current.instanceId && current.instanceId !== instanceId && current.token !== token
        && current.instanceId !== other?.instanceId
      );
      if (racedNewOwner) return { written:false, file:homeFile, port:Number(current.port) };
      writeJsonAtomic(homeFile, { port:announcedPort, token, url:`http://127.0.0.1:${announcedPort}/api/browser`, instanceId, proofKey, pid:process.pid });
      return { written:true, file:homeFile, port:announcedPort };
    });
    const result = locked.locked ? locked.value : { written:false, file:homeFile, port:Number(named()?.port) || announcedPort };
    if (result.written && retry) { clearInterval(retry); retry = null; }
    if (!result.written && !retry) { retry = setInterval(() => { announce(announcedPort).catch(() => {}); }, 60000); retry.unref?.(); }
    return result;
  }
  function withdraw() {
    if (retry) { clearInterval(retry); retry = null; }
    try {
      withDiscoveryLock(lockFile, () => {
        const now = named();
        if (now && now.token === token && Number(now.port) === announcedPort && (!now.instanceId || now.instanceId === instanceId)) {
          try { fs.rmSync(homeFile, { force:true }); } catch { /* Next start replaces it. */ }
        }
      });
    } catch { /* Best-effort cleanup. */ }
    try {
      const ep = JSON.parse(fs.readFileSync(endpointFile, "utf8"));
      if (ep?.instanceId === instanceId) fs.rmSync(endpointFile, { force:true });
    } catch { /* Already gone. */ }
  }
  const onExit = () => { withdraw(); void engine.close(); };
  process.once("exit", onExit);

  function refusedOrigin(req) {
    if (!isLoopback(req.socket?.remoteAddress)) return { status:403, code:"LOCAL_ONLY", error:"The browser endpoint is only for agents on the computer running PenEcho." };
    const host = hostOf(req);
    if (!host || !LOOPBACK_NAMES.has(host.hostname.toLowerCase())) return { status:403, code:"LOCAL_ONLY", error:"Use http://127.0.0.1 to reach PenEcho's browser endpoint." };
    const from = req.headers.origin, site = String(req.headers["sec-fetch-site"] || "").toLowerCase();
    if (from !== undefined) {
      let same = false;
      try {
        const origin = new URL(String(from));
        same = origin.protocol === "http:" && origin.host === host.host && LOOPBACK_NAMES.has(origin.hostname.toLowerCase());
      } catch { /* Not an origin. */ }
      if (!same) return { status:403, code:"CROSS_SITE", error:"A page of another site cannot use PenEcho's browser." };
    }
    if (site === "cross-site" || site === "same-site") return { status:403, code:"CROSS_SITE", error:"A page of another site cannot use PenEcho's browser." };
    return null;
  }
  function refused(req) {
    const originErr = refusedOrigin(req);
    if (originErr) return originErr;
    const scope = verifyToken(req.headers["x-penecho-token"]);
    if (!scope) return { status:401, code:"BAD_TOKEN", error:`Send the token from ${homeFile} as the x-penecho-token header.` };
    return null;
  }
  async function handle(req, res, url) {
    if (url.pathname === "/api/browser/identity" && req.method === "GET") {
      const originErr = refusedOrigin(req);
      if (originErr) { req.resume(); sendJson(res, originErr.status, { ok:false, error:originErr.error, code:originErr.code }); return true; }
      const nonce = String(url.searchParams.get("nonce") || "");
      if (!nonce || nonce.length > 128) { sendJson(res, 400, { ok:false, error:"Missing nonce.", code:"BAD_NONCE" }); return true; }
      const port = announcedPort || Number(req.socket?.localPort) || 0;
      sendJson(res, 200, { ok:true, instanceId, proof:expectedBrowserProof(proofKey, nonce, port, instanceId) });
      return true;
    }
    if (url.pathname !== "/api/browser") return false;
    const originErr = refusedOrigin(req);
    if (originErr) { req.resume(); sendJson(res, originErr.status, { ok:false, error:originErr.error, code:originErr.code }); return true; }
    const scope = verifyToken(req.headers["x-penecho-token"]);
    if (!scope) { req.resume(); sendJson(res, 401, { ok:false, error:`Send the token from ${homeFile} as the x-penecho-token header.`, code:"BAD_TOKEN" }); return true; }
    const controller = new AbortController();
    const abortRequest = () => { if (!res.writableEnded) controller.abort(); };
    req.once("aborted", abortRequest);
    res.once("close", abortRequest);
    try {
      if (req.method === "GET") { sendJson(res, 200, engine.status()); return true; }
      if (req.method !== "POST") { req.resume(); sendJson(res, 405, { ok:false, error:"Use GET or POST.", code:"METHOD" }); return true; }
      if (!/^application\/json(?:\s*;|\s*$)/i.test(String(req.headers["content-type"] || ""))) { req.resume(); throw browserError("BAD_JSON", "Send the browser request as application/json."); }
      const raw = (await readBody(req, MAX_BODY)).toString("utf8");
      let body;
      try { body = raw ? JSON.parse(raw) : {}; } catch { throw browserError("BAD_JSON", "The browser request is not valid JSON."); }
      if (!body || typeof body !== "object" || Array.isArray(body)) throw browserError("BAD_REQUEST", "Send a JSON object.");
      const action = body.action === undefined ? "inspect" : String(body.action);
      if (!ACTIONS.includes(action)) throw browserError("BAD_ACTION", "action must be inspect, close, status or help.");
      if (action === "status") sendJson(res, 200, engine.status());
      else if (action === "help") sendJson(res, 200, help());
      else if (action === "close") {
        if (typeof body.sessionId !== "string" || !body.sessionId) throw browserError("BAD_SESSION", "close needs a sessionId.");
        sendJson(res, 200, { ok:true, closed:await engine.closeSession(body.sessionId, { scope }) });
      } else sendJson(res, 200, await engine.inspect(body, { scope, signal:controller.signal }));
    } catch (error) {
      if (!res.headersSent) sendJson(res, error.status || 500, { ok:false, error:error.status ? error.message : "The browser request failed.", code:error.code || "FAILED", ...(error.browserSteps ? { steps:error.browserSteps } : {}) });
      else res.destroy();
    } finally {
      req.removeListener("aborted", abortRequest);
      res.removeListener("close", abortRequest);
    }
    return true;
  }
  async function close() {
    if (closed) return;
    closed = true;
    withdraw();
    process.removeListener("exit", onExit);
    await engine.close();
  }
  return {
    handle, announce, withdraw, close, status:engine.status,
    issueScope, verifyToken, closeScopeSessions:engine.closeScopeSessions,
    token, proofKey, instanceId, homeFile, endpointFile, refused, engine, helperPath:BROWSER_HELPER_PATH,
  };
}

module.exports = { createBrowser, isLoopback, sameToken, readBody, help };
