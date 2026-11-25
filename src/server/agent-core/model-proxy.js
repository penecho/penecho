"use strict";
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");

// The PenEcho runner never holds the Cloud account token or an API key. It talks to this proxy, which answers only this computer,
// knows each run by a secret made for that run alone, adds the real key and passes the request on to the model.
const BODY_MOST = 64 * 1024 * 1024, IDLE_MOST = 6 * 60 * 60 * 1000;
// What a model request may carry on from the runner. Anything that names who is asking is set here instead.
const PASS_ON = /^(?:content-type|accept|user-agent|anthropic-version|anthropic-beta|x-penecho-request-kind|x-opencode-session|x-stainless-[a-z0-9-]+)$/;
const PASS_BACK = ["content-type", "retry-after", "x-request-id", "request-id", "x-penecho-request-id", "x-penecho-charged-credits", "x-penecho-idempotent-replay"];
// A held streamed call is answered with headers and a keepalive comment this often (see `hold` below).
const KEEPALIVE_MS = 10_000;
const LOCK_WAIT_MS = 3000, LOCK_STALE_MS = 10_000;
const LOCK_WAIT = new Int32Array(new SharedArrayBuffer(4));
const IN_PROGRESS_TIMEOUT_WHY = "The earlier model call on PenEcho Cloud did not finish in time";
const { TRIES, RETRY_AFTER_MOST_MS, HOSTED_SILENCE_MS, IN_PROGRESS_WAIT_MOST_MS, IN_PROGRESS_POLLS_MOST, WHY, backoffMs, retryAfterMs, retryableStatus, retryableEvent, whyOfStatus, whyOfEvent } = require("./model-retry.js");
const parsedBody = bytes => { try { const value = JSON.parse(Buffer.from(bytes).toString("utf8")); return value && typeof value === "object" ? value : null; } catch { return null; } };

// Watches a streamed answer go by: whether it reached its end marker, said how it ended, or carried an error.
function sseWatch(anthropic) {
  const decoder = new TextDecoder();
  let pending = "", done = false, finished = false, error = null;
  const take = block => {
    let name = "", data = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) name = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    const text = data.join("\n");
    if (!text && !name) return;
    if (!anthropic && text === "[DONE]") { done = true; return; }
    let value = null; try { value = JSON.parse(text); } catch { return; }
    if (!value || typeof value !== "object") return;
    if (anthropic) {
      if (name === "message_stop" || value.type === "message_stop") done = true;
      else if (name === "error" || value.type === "error") error = value.error && typeof value.error === "object" ? value.error : { message:String(value.error || "") };
      else if (value.type === "message_delta" && value.delta?.stop_reason) finished = true;
    } else if (value.error) error = typeof value.error === "object" ? value.error : { message:String(value.error) };
    else if (Array.isArray(value.choices) && value.choices.some(choice => choice?.finish_reason)) finished = true;
  };
  const drain = final => {
    const parts = pending.split(/\r?\n\r?\n/);
    pending = final ? "" : parts.pop();
    for (const part of parts) take(part);
  };
  return {
    push(chunk) { pending += decoder.decode(chunk, { stream:true }); drain(false); },
    end() { pending += decoder.decode(); drain(true); return { done, finished, error }; },
  };
}
const loopback = address => { const ip = String(address || "").replace(/^::ffff:/, ""); return ip === "127.0.0.1" || ip === "::1"; };
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const MAX_PID = 2147483647;
const alive = pid => {
  if (!Number.isInteger(pid) || pid <= 0 || pid > MAX_PID) return true;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code !== "ESRCH"; }
};

const CALL_ID_OK = /^[a-zA-Z0-9_-]{1,64}$/;
const NONCE_OK = /^[a-zA-Z0-9_-]{8,128}$/;
const RUN_ID_OK = /^[0-9a-f-]{36}$/;

function normalizeRun(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id : "";
  const secret = typeof raw.secret === "string" && raw.secret.trim() ? raw.secret : "";
  if (!id || !secret) return null;
  if (raw.pick !== undefined && typeof raw.pick !== "string") return null;
  if (raw.effort !== undefined && typeof raw.effort !== "string") return null;
  if (typeof raw.usedAt !== "number" || !Number.isFinite(raw.usedAt) || raw.usedAt <= 0) return null;
  if (raw.pid !== undefined && (typeof raw.pid !== "number" || !Number.isSafeInteger(raw.pid) || raw.pid < 0)) return null;
  if (raw.calls !== undefined && (typeof raw.calls !== "number" || !Number.isSafeInteger(raw.calls) || raw.calls < 0)) return null;
  return {
    id,
    secret,
    pick: raw.pick || "",
    effort: raw.effort || "",
    usedAt: raw.usedAt,
    pid: raw.pid === undefined ? 0 : raw.pid,
    calls: raw.calls === undefined ? 0 : raw.calls,
  };
}

function normalizeRefusal(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (typeof raw.at !== "number" || !Number.isFinite(raw.at) || raw.at <= 0) return null;
  if (!raw.body || typeof raw.body !== "object" || Array.isArray(raw.body)) return null;
  return { at: raw.at, body: raw.body };
}

function runIsLive(run, now = Date.now()) {
  if (!run) return false;
  if (now - run.usedAt > IDLE_MOST) return false;
  if (run.pid > 0 && !alive(run.pid)) return false;
  return true;
}

function ensurePrivateDir(dir) {
  fs.mkdirSync(dir, { recursive:true, mode:0o700 });
  try { fs.chmodSync(dir, 0o700); } catch { /* Best-effort permission tightening. */ }
}

function writeJsonAtomic(file, value) {
  ensurePrivateDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(value), { mode:0o600 });
    try { fs.chmodSync(tmp, 0o600); } catch { /* Best-effort permission tightening. */ }
    fs.renameSync(tmp, file);
  } catch (error) {
    try { fs.unlinkSync(tmp); } catch { /* Ignore cleanup failure. */ }
    throw error;
  }
}

function readRunsFileStrict(file) {
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); }
  catch (error) {
    if (error?.code === "ENOENT") return { exists:false, map:new Map(), refusals:new Map() };
    throw Object.assign(new Error(`Could not read model-proxy run registry: ${error.message}`), { code:"PROXY_STORE_UNREADABLE", cause:error });
  }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (error) {
    throw Object.assign(new Error(`Model-proxy run registry is corrupted: ${error.message}`), { code:"PROXY_STORE_CORRUPT", cause:error });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw Object.assign(new Error("Model-proxy run registry has an invalid shape."), { code:"PROXY_STORE_CORRUPT" });
  }
  const map = new Map();
  if (Array.isArray(parsed.runs)) {
    for (const item of parsed.runs) {
      const run = normalizeRun(item);
      if (!run || map.has(run.id)) {
        throw Object.assign(new Error("Model-proxy run registry contains an invalid or duplicate run row."), { code:"PROXY_STORE_CORRUPT" });
      }
      map.set(run.id, run);
    }
  } else if (parsed.runs && typeof parsed.runs === "object") {
    for (const [key, item] of Object.entries(parsed.runs)) {
      const run = normalizeRun(item);
      if (!run || run.id !== key || map.has(run.id)) {
        throw Object.assign(new Error("Model-proxy run registry contains an invalid or mismatched run row."), { code:"PROXY_STORE_CORRUPT" });
      }
      map.set(run.id, run);
    }
  } else {
    throw Object.assign(new Error("Model-proxy run registry is missing its runs map."), { code:"PROXY_STORE_CORRUPT" });
  }
  const refusalMap = new Map();
  if (parsed.refusals !== undefined) {
    if (!parsed.refusals || typeof parsed.refusals !== "object" || Array.isArray(parsed.refusals)) {
      throw Object.assign(new Error("Model-proxy run registry has an invalid refusals map."), { code:"PROXY_STORE_CORRUPT" });
    }
    for (const [key, item] of Object.entries(parsed.refusals)) {
      const ref = normalizeRefusal(item);
      if (!key || !ref) {
        throw Object.assign(new Error("Model-proxy run registry contains an invalid refusal row."), { code:"PROXY_STORE_CORRUPT" });
      }
      refusalMap.set(key, ref);
    }
  }
  return { exists:true, map, refusals:refusalMap };
}

function createExclusiveFile(file, content, mode = 0o600) {
  ensurePrivateDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(tmp, content, { mode });
    try { fs.chmodSync(tmp, mode); } catch { /* Best-effort permission tightening. */ }
    try {
      fs.linkSync(tmp, file);
      return true;
    } catch (error) {
      if (error?.code === "EEXIST") return false;
      if (["EPERM", "EXDEV", "ENOTSUP", "ENOSYS"].includes(error?.code)) {
        let fd = null;
        try {
          fd = fs.openSync(file, "wx", mode);
          fs.writeFileSync(fd, content);
          fs.closeSync(fd);
          return true;
        } catch (err) {
          if (fd !== null) { try { fs.closeSync(fd); } catch {} }
          if (err?.code === "EEXIST") return false;
          throw err;
        }
      }
      throw error;
    }
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* Ignore cleanup failure. */ }
  }
}

function unlinkIfTokenMatches(file, expectedToken) {
  try {
    const current = fs.readFileSync(file, "utf8");
    if (current === expectedToken) fs.unlinkSync(file);
  } catch { /* Already removed or unreadable. */ }
}

const parsePidToken = text => {
  const raw = String(text || "").split(":")[0];
  if (!/^\d+$/.test(raw)) return 0;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n <= MAX_PID ? n : 0;
};

function sweepReapFiles(lockFile, tokenHash = "", maxAgeMs = 60_000, { ownFile = "" } = {}) {
  const dir = path.dirname(lockFile);
  const prefix = `${path.basename(lockFile)}.reap.${tokenHash ? `${tokenHash}.` : ""}`;
  let currentHash = "";
  if (!tokenHash) {
    // Only sweep abandoned reap files when primary lock authority is positively known (missing or readable non-empty token).
    // If reading the primary lock fails with any non-ENOENT error (e.g. EIO), skip destructive cleanup completely.
    try {
      const cur = fs.readFileSync(lockFile, "utf8");
      if (!cur) return;
      currentHash = crypto.createHash("sha256").update(cur).digest("hex").slice(0, 16);
    } catch (error) {
      if (error?.code !== "ENOENT") return;
    }
  }
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return; }
  const now = Date.now();
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    if (currentHash && name.startsWith(`${path.basename(lockFile)}.reap.${currentHash}.`)) continue;
    const full = path.join(dir, name);
    try {
      if (full !== ownFile) {
        if (!tokenHash && now - fs.statSync(full).mtimeMs < maxAgeMs) continue;
        // Never remove another process's reap guard if its owner PID is live, invalid (e.g. non-integer), or unreadable.
        const text = fs.readFileSync(full, "utf8");
        const ownerPid = parsePidToken(text);
        if (!ownerPid || alive(ownerPid)) continue;
      }
      fs.unlinkSync(full);
    } catch { /* Ignore concurrent cleanup or unreadable file. */ }
  }
}

// Reap a stale primary lock using immutable per-token generation files (`<lock>.reap.<hash(token)>.<gen>`).
// Existing generation files are NEVER unlinked while `lockFile` still holds `expectedText`; a new generation `gen+1`
// can only be claimed after generation `gen`'s owner PID is dead and stale. Thus at most one alive process can ever
// verify `current === expectedText` and unlink `lockFile`.
function tryReapStaleLock(lockFile, expectedText) {
  const tokenHash = crypto.createHash("sha256").update(String(expectedText || "")).digest("hex").slice(0, 16);
  const reapToken = `${process.pid}:${Date.now()}:${crypto.randomBytes(8).toString("hex")}`;
  for (let gen = 0; gen < 64; gen++) {
    const reapFile = `${lockFile}.reap.${tokenHash}.${gen}`;
    if (fs.existsSync(reapFile)) {
      try {
        const stat = fs.statSync(reapFile);
        const text = fs.readFileSync(reapFile, "utf8");
        const ownerPid = parsePidToken(text);
        const stale = Date.now() - stat.mtimeMs > LOCK_STALE_MS && ownerPid > 0 && !alive(ownerPid);
        if (!stale) return false;
        continue;
      } catch (err) {
        if (err?.code === "ENOENT") return false;
        return false;
      }
    }
    let won = false;
    try { won = createExclusiveFile(reapFile, reapToken, 0o600); } catch { return false; }
    if (!won) return false;
    try {
      const stat = fs.statSync(lockFile);
      const current = fs.readFileSync(lockFile, "utf8");
      if (current !== expectedText) {
        unlinkIfTokenMatches(reapFile, reapToken);
        return false;
      }
      const ownerPid = parsePidToken(current);
      const stale = Date.now() - stat.mtimeMs > LOCK_STALE_MS && ownerPid > 0 && !alive(ownerPid);
      if (!stale) {
        unlinkIfTokenMatches(reapFile, reapToken);
        return false;
      }
      fs.unlinkSync(lockFile);
      sweepReapFiles(lockFile, tokenHash, 0, { ownFile:reapFile });
      return true;
    } catch {
      unlinkIfTokenMatches(reapFile, reapToken);
      return false;
    }
  }
  return false;
}

function withFileLock(lockFile, fn) {
  ensurePrivateDir(path.dirname(lockFile));
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    const lockToken = `${process.pid}:${Date.now()}:${crypto.randomBytes(8).toString("hex")}`;
    let acquired = false;
    try {
      acquired = createExclusiveFile(lockFile, lockToken, 0o600);
    } catch (error) {
      throw error;
    }
    if (acquired) {
      try { return fn(); }
      finally { unlinkIfTokenMatches(lockFile, lockToken); }
    }
    let inspectErr = null;
    try {
      const stat = fs.statSync(lockFile);
      const text = fs.readFileSync(lockFile, "utf8");
      const ownerPid = parsePidToken(text);
      const stale = Date.now() - stat.mtimeMs > LOCK_STALE_MS && ownerPid > 0 && !alive(ownerPid);
      if (stale && tryReapStaleLock(lockFile, text)) continue;
    } catch (err) {
      if (err?.code === "ENOENT") continue;
      inspectErr = err;
    }
    if (Date.now() >= deadline) {
      if (inspectErr) throw Object.assign(new Error(`Could not inspect model-proxy registry lock: ${inspectErr.message}`), { code:"PROXY_LOCK_UNREADABLE", cause:inspectErr });
      throw Object.assign(new Error("Timed out waiting for model-proxy registry lock."), { code:"PROXY_LOCK_TIMEOUT" });
    }
    Atomics.wait(LOCK_WAIT, 0, 0, 5);
  }
}

function proxyIdentityProof(proxyToken, nonce, port, instanceId) {
  return crypto.createHmac("sha256", String(proxyToken)).update(`${nonce}:${port}:${instanceId}`).digest("base64url");
}

// `connect(pick)` answers with the connection a run uses: { apiFormat, apiUrl, apiKey, apiModel, hosted, … }, looked up again for every request
// so a key changed or an account signed out stops a run at its next step. `describe(connection)` gives the runner its settings with no key in them,
// and `target(connection)` is the model's real address.
// `idleMs()` is how long a person's own provider may send nothing before a try is given up (Cloud has its own, shorter limit).
// `onRetry(runId, { attempt, of, why, waitMs })` hears each call about to be tried again.
function createModelProxy({ connect, describe, target, idleMs = () => 0, hostedSilenceMs = HOSTED_SILENCE_MS, backoff = backoffMs, inProgressWaitMostMs = IN_PROGRESS_WAIT_MOST_MS, inProgressPollsMost = IN_PROGRESS_POLLS_MOST, keepaliveMs = KEEPALIVE_MS, onError = () => {}, onRetry: retryListener = null, stateDir = "", publishEndpoint = true } = {}) {
  const runs = new Map(), retryListeners = new Set(retryListener ? [retryListener] : []);
  const onRetry = (id, info) => { for (const listener of retryListeners) listener(id, info); };
  // A run Cloud refused for credits keeps Cloud's answer here a while after it ends (persisted in runs.json when stateDir is set),
  // so PenEcho can say why and hold its Ask even across a server restart.
  const refusals = new Map();
  const pendingEnds = new Set();
  const persistedDir = typeof stateDir === "string" && stateDir.trim() ? path.join(stateDir.trim(), "project-lines", "model-proxy") : "";
  const runsFile = persistedDir ? path.join(persistedDir, "runs.json") : "";
  const runsLockFile = persistedDir ? path.join(persistedDir, "runs.json.lock") : "";
  const pendingEndsDir = persistedDir ? path.join(persistedDir, "pending-ends") : "";
  const endpointFile = persistedDir ? path.join(persistedDir, "endpoint.json") : "";
  const instanceId = crypto.randomUUID();
  const proxyToken = crypto.randomBytes(32).toString("base64url");
  let port = 0, closed = false, active = !persistedDir || publishEndpoint !== false, startupError = null;

  function readDiskPendingEnds() {
    const out = new Set();
    if (!pendingEndsDir) return out;
    let names;
    try { names = fs.readdirSync(pendingEndsDir); }
    catch (error) {
      if (error?.code === "ENOENT") return out;
      throw Object.assign(new Error(`Could not read model-proxy pending-ends directory: ${error.message}`), { code:"PROXY_STORE_UNREADABLE", cause:error });
    }
    for (const name of names) if (RUN_ID_OK.test(name)) out.add(name);
    return out;
  }
  function persistPendingEnd(id) {
    if (!pendingEndsDir || !RUN_ID_OK.test(String(id || ""))) return false;
    try {
      ensurePrivateDir(pendingEndsDir);
      const marker = path.join(pendingEndsDir, id);
      fs.writeFileSync(marker, String(Date.now()), { mode:0o600 });
      return true;
    } catch { return false; }
  }
  function clearDiskPendingEnds(ids) {
    if (!pendingEndsDir) return;
    for (const id of ids) {
      if (!RUN_ID_OK.test(String(id || ""))) continue;
      try { fs.unlinkSync(path.join(pendingEndsDir, id)); } catch { /* Already gone. */ }
    }
  }

  // Serialize every mutation to runs.json under a cross-process lock, applying ONLY the requested
  // change against the authoritative on-disk registry so concurrent proxies never clobber live runs
  // or resurrect ended runs. Never overwrites a corrupted or unreadable registry.
  function mutateRuns(mutator) {
    if (!runsFile) return null;
    return withFileLock(runsLockFile, () => {
      const now = Date.now();
      const { exists, map, refusals:diskRefusals } = readRunsFileStrict(runsFile);
      let pruned = false;
      for (const [id, diskRun] of map) {
        if (!runIsLive(diskRun, now)) { map.delete(id); pruned = true; }
      }
      // Never evict unconsumed credit refusals by age alone; they are removed explicitly by clearRefusal() after Work disposition.
      const diskPending = readDiskPendingEnds();
      const allPending = new Set([...pendingEnds, ...diskPending]);
      if (allPending.size) {
        for (const endedId of allPending) {
          if (map.delete(endedId)) pruned = true;
        }
      }
      const outcome = mutator(map, now, diskRefusals);
      const changed = Boolean(outcome && typeof outcome === "object" ? outcome.changed : outcome);
      if (changed || (pruned && exists)) {
        const payload = { version:1, runs:Object.fromEntries(map), ...(diskRefusals.size ? { refusals:Object.fromEntries(diskRefusals) } : {}) };
        writeJsonAtomic(runsFile, payload);
      }
      pendingEnds.clear();
      if (diskPending.size) clearDiskPendingEnds(diskPending);
      runs.clear();
      for (const [id, diskRun] of map) runs.set(id, diskRun);
      refusals.clear();
      for (const [id, ref] of diskRefusals) refusals.set(id, ref);
      return outcome && typeof outcome === "object" ? outcome.value : outcome;
    });
  }

  function loadPersistedRuns() {
    if (!runsFile) return;
    mutateRuns(() => ({ changed:false, value:true }));
  }

  function authenticateRun(id) {
    const now = Date.now();
    if (pendingEnds.has(id)) return undefined;
    if (!runsFile) {
      const run = runs.get(id);
      if (!run || !runIsLive(run, now)) { runs.delete(id); return undefined; }
      return run;
    }
    if (readDiskPendingEnds().has(id)) {
      runs.delete(id);
      return undefined;
    }
    const { map } = readRunsFileStrict(runsFile);
    const diskRun = map.get(id);
    if (!diskRun || !runIsLive(diskRun, now)) {
      runs.delete(id);
      return undefined;
    }
    runs.set(id, diskRun);
    return diskRun;
  }

  function touchRun(id, { pid = 0, incrementCall = false } = {}) {
    const now = Date.now();
    if (!runsFile) {
      const run = runs.get(id);
      if (!run || !runIsLive(run, now)) return null;
      run.usedAt = now;
      if (pid > 0) run.pid = pid;
      if (incrementCall) run.calls += 1;
      return run;
    }
    return mutateRuns((map, ts) => {
      const cur = map.get(id);
      if (!cur || !runIsLive(cur, ts)) return { changed:false, value:null };
      const prevUsedAt = cur.usedAt;
      const pidChanged = pid > 0 && cur.pid !== pid;
      cur.usedAt = Math.max(prevUsedAt, ts);
      if (pidChanged) cur.pid = pid;
      if (incrementCall) cur.calls += 1;
      const shouldWrite = pidChanged || incrementCall || (ts - prevUsedAt >= 60_000);
      return { changed:shouldWrite, value:{ ...cur } };
    });
  }

  function recordRefusal(id, body) {
    const entry = { at:Date.now(), body };
    if (runsFile) {
      // Persist to disk FIRST; if persistence fails, throw so 402 is never acknowledged unpersisted.
      mutateRuns((_map, _ts, diskRefusals) => { diskRefusals.set(id, entry); return { changed:true, value:true }; });
    }
    refusals.set(id, entry);
  }

  function clearRefusal(id) {
    refusals.delete(id);
    if (!runsFile) return true;
    try {
      mutateRuns((_map, _ts, diskRefusals) => ({ changed:diskRefusals.delete(id), value:true }));
      return true;
    } catch (error) {
      onError(error);
      return false;
    }
  }

  function writeEndpoint({ force = false } = {}) {
    if (!endpointFile || !port || closed || (!active && !force)) return;
    writeJsonAtomic(endpointFile, { port, pid:process.pid, instanceId, proxyToken, updatedAt:Date.now() });
  }

  function activate() {
    if (closed) throw Object.assign(new Error("The model proxy has closed."), { code:"PROXY_CLOSED" });
    const prevActive = active;
    try {
      loadPersistedRuns();
      if (port) writeEndpoint({ force:true });
      startupError = null;
      active = true;
      return { port, endpointFile, instanceId };
    } catch (error) {
      active = prevActive;
      throw error;
    }
  }

  function deactivate() {
    active = false;
  }

  if (active && runsFile) {
    try { loadPersistedRuns(); }
    catch (error) {
      startupError = error;
      active = false;
      onError(error);
    }
  }

  const send = (res, status, body, extraHeaders = {}) => {
    res.writeHead(status, { "content-type":"application/json", ...extraHeaders });
    res.end(JSON.stringify(body));
  };
  const refuse = (res, status, message, { code, headers = {} } = {}) => send(res, status, { error:{ message, type:"penecho_proxy", ...(code ? { code } : {}) } }, headers);

  async function handle(req, res) {
    if (!loopback(req.socket.remoteAddress)) return refuse(res, 403, "This address answers only this computer.", { headers:{ "x-penecho-proxy-final":"1" } });
    if (closed || !active) {
      return refuse(res, 503, "PenEcho's model proxy is restarting.", { code:"proxy_restarting", headers:{ "x-penecho-proxy-retry":"1" } });
    }
    const parsedUrl = new URL(String(req.url || "/"), "http://127.0.0.1");
    if (req.method === "GET" && parsedUrl.pathname === "/identity") {
      const nonce = String(parsedUrl.searchParams.get("nonce") || "");
      if (!NONCE_OK.test(nonce)) return refuse(res, 400, "A valid nonce is required.", { headers:{ "x-penecho-proxy-final":"1" } });
      return send(res, 200, {
        ok:true,
        instanceId,
        port,
        keepaliveMs,
        proof:proxyIdentityProof(proxyToken, nonce, port, instanceId),
      });
    }
    const match = /^\/run\/([0-9a-f-]{36})(\/[a-z0-9/_-]*)$/.exec(parsedUrl.pathname);
    let run;
    try { run = match && authenticateRun(match[1]); }
    catch (error) {
      onError(error);
      return refuse(res, 503, error.message || "Model-proxy run registry is unavailable.", { code:error.code || "proxy_store_error", headers:{ "x-penecho-proxy-final":"1" } });
    }
    const bearer = /^Bearer (.+)$/i.exec(String(req.headers.authorization || ""))?.[1] || "", key = String(req.headers["x-api-key"] || "");
    if (!run || !(same(bearer, run.secret) || same(key, run.secret))) {
      return refuse(res, 401, "This run is not known here, or it has ended.", { headers:{ "x-penecho-proxy-final":"1" } });
    }
    const headerPid = Number(req.headers["x-penecho-runner-pid"]);
    const validPid = Number.isSafeInteger(headerPid) && headerPid > 0 ? headerPid : 0;
    const rest = match[2];
    if (req.method === "GET" && rest === "/profile") {
      const updated = touchRun(run.id, { pid:validPid });
      if (!updated) return refuse(res, 401, "This run is not known here, or it has ended.", { headers:{ "x-penecho-proxy-final":"1" } });
      const connection = await connect(updated.pick);
      return send(res, 200, await describe(connection, { baseURL:`http://127.0.0.1:${port}/run/${updated.id}/model`, effort:updated.effort }));
    }
    if (req.method === "POST" && rest === "/done") {
      if (runsFile) mutateRuns(map => ({ changed:map.delete(run.id), value:true }));
      else runs.delete(run.id);
      return send(res, 200, { ok:true });
    }
    // Only the two calls a model takes. The same key opens the rest of an account, and none of that is passed on.
    if (req.method !== "POST" || !["/model/chat/completions", "/model/v1/messages"].includes(rest)) {
      if (validPid) touchRun(run.id, { pid:validPid });
      return refuse(res, 404, "Only model requests are passed on.", { headers:{ "x-penecho-proxy-final":"1" } });
    }
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > BODY_MOST) return refuse(res, 413, "The request is too large.", { headers:{ "x-penecho-proxy-final":"1" } }); chunks.push(chunk); }
    const anthropic = rest === "/model/v1/messages";
    let request;
    try { request = JSON.parse(Buffer.concat(chunks).toString("utf8")); if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error(); }
    catch { return refuse(res, 400, "A model request is one JSON object.", { headers:{ "x-penecho-proxy-final":"1" } }); }
    // The call is tried here, up to TRIES times, with ONE immutable idempotency key so Cloud never bills twice.
    // No part of an answer reaches the runner until it is whole: a cut or failed try is never mistaken for a finished one.
    const suppliedCallId = String(req.headers["x-penecho-call-id"] || "").trim();
    const updated = touchRun(run.id, { pid:validPid, incrementCall:!CALL_ID_OK.test(suppliedCallId) });
    if (!updated) return refuse(res, 401, "This run is not known here, or it has ended.", { headers:{ "x-penecho-proxy-final":"1" } });
    const callKey = CALL_ID_OK.test(suppliedCallId) ? `pe-${updated.id}-${suppliedCallId}` : `pe-${updated.id}-${updated.calls}`;
    let current = null, gone = false, wake = () => {}, last = null;
    // Failed tries (at most TRIES) and request_in_progress waits (by polls and by one deadline) are counted apart, so neither
    // can stretch or shorten the other however a 409, a 503 and a cut alternate.
    let failureTries = 0, inProgressPolls = 0, inProgressDeadline = 0;
    // A streamed call still held after keepaliveMs: the runner gets its 200 now and a keepalive comment every keepaliveMs, because
    // the HTTP client inside it (Node's fetch) gives up after 300 s without headers, whatever the model adapter's own timeout says.
    // The answer still goes out only when whole; a failure after that is one error event in the model's own format.
    let opened = false, keepalive = null;
    const hold = request.stream === true ? setTimeout(() => {
      if (gone || res.headersSent || closed || !active) return;
      opened = true;
      res.writeHead(200, { "content-type":"text/event-stream; charset=utf-8", "cache-control":"no-cache" });
      res.write(": keepalive\n\n");
      keepalive = setInterval(() => { if (!res.writableNeedDrain && !closed && active) res.write(": keepalive\n\n"); }, keepaliveMs);
    }, keepaliveMs) : null;
    const stopHolding = () => { clearTimeout(hold); clearInterval(keepalive); };
    const errorEvent = (message, code) => anthropic
      ? `event: error\ndata: ${JSON.stringify({ type:"error", error:{ type:"penecho_proxy", code, message } })}\n\n`
      : `data: ${JSON.stringify({ error:{ message, type:"penecho_proxy", code } })}\n\n`;
    const finish = (status, back, body, failed = null, { final = true } = {}) => {
      stopHolding();
      if (!opened) {
        const outHeaders = { ...back, ...(final ? { "x-penecho-proxy-final":"1" } : {}) };
        res.writeHead(status, outHeaders);
        return res.end(body);
      }
      if (status >= 200 && status < 300 && !failed) return res.end(body);
      // Headers already went out: what went wrong goes as one error event, in words.
      const parsed = failed ? null : parsedBody(body);
      const message = failed?.message || String(parsed?.error?.message || parsed?.message || (typeof parsed?.error === "string" ? parsed.error : "") || Buffer.from(body || "").toString("utf8").slice(0, 500) || WHY.server);
      return res.end(errorEvent(message, failed?.code || String(parsed?.error?.code || parsed?.error || "model_unavailable")));
    };
    res.on("close", () => { stopHolding(); if (res.writableEnded) return; gone = true; current?.abort(); wake(); });
    const wait = ms => new Promise(resolve => { const timer = setTimeout(resolve, ms); wake = () => { clearTimeout(timer); resolve(); }; });
    // Gone (the runner hung up) or the proxy closing: nothing more is sent, and the runner is told once if it can still hear.
    const stopped = () => {
      if (gone) { stopHolding(); return true; }
      if (closed || !active) {
        stopHolding();
        if (!opened) refuse(res, 503, "PenEcho's model proxy is restarting.", { code:"proxy_restarting", headers:{ "x-penecho-proxy-retry":"1" } });
        else res.destroy();
        return true;
      }
      return false;
    };
    const inProgressTimedOut = () => ({ ok:false, retry:false, status:504, code:"request_in_progress", why:IN_PROGRESS_TIMEOUT_WHY });
    const withDeadline = (promise, deadlineMs) => {
      if (!(deadlineMs > 0)) return promise.then(value => ({ timedOut:false, value }));
      const left = deadlineMs - Date.now();
      if (left <= 0) { void promise.catch(() => {}); return Promise.resolve({ timedOut:true }); }
      let timer;
      return Promise.race([
        promise.then(value => ({ timedOut:false, value })),
        new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut:true }), left); timer.unref?.(); }),
      ]).finally(() => clearTimeout(timer));
    };
    while (!gone) {
      if (stopped()) return;
      // Once Cloud has said the earlier call is still going, ONE budget covers every later try, preparation and sleep.
      if (inProgressDeadline > 0 && inProgressDeadline - Date.now() <= 0) { last = inProgressTimedOut(); break; }
      const attemptStartedAt = Date.now();
      // The connection is looked up again for every try, so a key changed or an account signed out is seen at once.
      let connection = null;
      try {
        const looked = await withDeadline(Promise.resolve().then(() => connect(updated.pick)), inProgressDeadline);
        if (looked.timedOut) { last = inProgressTimedOut(); break; }
        connection = looked.value;
      } catch (error) { last = connectFailure(error); }
      if (stopped()) return;
      if (connection) {
        if ((connection.apiFormat === "anthropic") !== anthropic) return finish(400, { "content-type":"application/json" }, JSON.stringify({ error:{ message:"This model does not take that kind of request.", type:"penecho_proxy" } }));
        const headers = {};
        for (const [name, value] of Object.entries(req.headers)) if (PASS_ON.test(name) && typeof value === "string") headers[name] = value;
        if (anthropic) headers["x-api-key"] = connection.apiKey;
        if (!anthropic || connection.hosted) headers.authorization = `Bearer ${connection.apiKey}`;
        // Cloud counts what Lines spends apart from the Canvas's own AI, and charges a call tried again only once.
        if (connection.hosted) { headers["x-penecho-product"] = "lines"; headers["idempotency-key"] = callKey; }
        // The model is the one chosen for this run, whatever the request names (review finding 11).
        const body = Buffer.from(JSON.stringify({ ...request, model:String(connection.apiModel) }));
        const silenceMs = connection.hosted ? hostedSilenceMs : Math.max(30_000, Number(idleMs()) || 180_000);
        const resolvedBase = await withDeadline(Promise.resolve().then(() => target(connection)), inProgressDeadline);
        if (resolvedBase.timedOut) { last = inProgressTimedOut(); break; }
        const base = resolvedBase.value;
        if (stopped()) return;
        if (inProgressDeadline > 0 && inProgressDeadline - Date.now() <= 0) { last = inProgressTimedOut(); break; }
        // The deadline binds only a try made while waiting for an earlier call; an ordinary model call has none.
        last = await attempt({ url:`${base}${rest.slice("/model".length)}`, headers, body, anthropic, silenceMs, own:!connection.hosted, deadlineMs:inProgressDeadline, cancelled:() => gone || closed || !active, setCurrent:controller => { current = controller; } });
        if (gone) return stopHolding();
        if (last.cancelled && stopped()) return;
        // Never mutate callKey after request_already_completed: Cloud already settled that call and does not retain
        // the response body, so retrying under a new key would bill the same logical turn a second time.
        if (!last.ok && last.code === "request_already_completed") {
          const message = "This model call already completed on PenEcho Cloud before the connection dropped, and its answer could not be retrieved. PenEcho did not bill it again.";
          const payload = JSON.stringify(anthropic
            ? { type:"error", error:{ type:"penecho_proxy", code:"result_unavailable", message } }
            : { error:{ message, type:"penecho_proxy", code:"result_unavailable" } });
          return finish(409, { "content-type":"application/json" }, payload, { message, code:"result_unavailable" });
        }
        if (last.ok) {
          if (connection.hosted && last.status === 402 && active && !closed) {
            try {
              recordRefusal(updated.id, parsedBody(last.body) || { error:"insufficient_credits", message:last.body.toString("utf8").slice(0, 500) });
            } catch (error) {
              onError(error);
              const msg = "Could not persist the credit refusal before acknowledging it.";
              const payload = JSON.stringify(anthropic
                ? { type:"error", error:{ type:"penecho_proxy", code:"proxy_store_error", message:msg } }
                : { error:{ message:msg, type:"penecho_proxy", code:"proxy_store_error" } });
              return finish(503, { "content-type":"application/json" }, payload, { message:msg, code:"proxy_store_error" });
            }
          }
          return finish(last.status, last.back, last.body);
        }
      }
      // Told to wait longer than is worth waiting: the call ends now and says why, instead of sitting quiet for minutes.
      const tooLong = why => { last = { ...last, retry:false, passOn:false, why:`${why}, and asked to wait ${Math.ceil(last.retryAfter / 1000)} seconds` }; };
      if (last.retry && last.code === "request_in_progress") {
        // Cloud is still finishing the earlier try of this same call (the key never changes): not a failure, so no try is used up.
        // The budget starts when the try that heard it began, so a wait Cloud already held for us counts against it.
        if (!inProgressDeadline) inProgressDeadline = attemptStartedAt + inProgressWaitMostMs;
        if (Number.isFinite(last.retryAfter) && last.retryAfter > RETRY_AFTER_MOST_MS) { tooLong(WHY.inProgress); break; }
        const remaining = inProgressDeadline - Date.now();
        if (remaining <= 0 || inProgressPolls >= inProgressPollsMost) { last = inProgressTimedOut(); break; }
        // Never poll before Cloud's own retry-after: one that is longer than the time left ends the call instead.
        if (Number.isFinite(last.retryAfter) && last.retryAfter > remaining) { last = inProgressTimedOut(); break; }
        inProgressPolls++;
        // A gentle ramp that Cloud's retry-after can only lengthen. The ramp alone is capped at 10 s and at the time left; a retry-after
        // that fits the time left is never clipped.
        const ramp = Math.min([2000, 3000, 5000, 5000, 8000, 10_000][Math.min(inProgressPolls - 1, 5)], remaining);
        const waitMs = Number.isFinite(last.retryAfter) ? Math.max(last.retryAfter, ramp) : Math.max(0, backoff !== backoffMs ? Math.min(backoff(inProgressPolls), remaining) : ramp);
        try { if (active && !closed) onRetry(updated.id, { attempt:inProgressPolls, of:inProgressPollsMost, why:WHY.inProgress, waitMs }); } catch { /* A listener's trouble is not the call's. */ }
        await wait(waitMs);
        // A timer can end a millisecond early: a wait that took all the time left has used it up.
        if (waitMs >= remaining) inProgressDeadline = Math.min(inProgressDeadline, Date.now());
        continue;
      }
      failureTries++;
      if (!last.retry || failureTries >= TRIES) break;
      let waitMs = Number.isFinite(last.retryAfter) ? last.retryAfter : backoff(failureTries);
      if (waitMs > RETRY_AFTER_MOST_MS) { last = { ...last, retry:false, passOn:false, why:`${WHY.busy}, and asked to wait ${Math.ceil(waitMs / 1000)} seconds` }; break; }
      // After an in-progress wait began, no sleep runs past its deadline and none ends before a retry-after asked for.
      if (inProgressDeadline > 0) {
        const remaining = inProgressDeadline - Date.now();
        if (Number.isFinite(last.retryAfter) && waitMs > remaining) { last = inProgressTimedOut(); break; }
        waitMs = Math.max(0, Math.min(waitMs, remaining));
      }
      const usesUp = inProgressDeadline > 0 && Date.now() + waitMs >= inProgressDeadline;
      try { if (active && !closed) onRetry(updated.id, { attempt:failureTries + 1, of:TRIES, why:last.why, waitMs }); } catch { /* A listener's trouble is not the call's. */ }
      await wait(waitMs);
      if (usesUp) inProgressDeadline = Math.min(inProgressDeadline, Date.now());
    }
    if (gone) return stopHolding();
    // Refused in a way another try cannot fix: the answer is passed on as it was. Every try failed: the runner hears one plain sentence.
    if (last?.passOn && !last.retry) return finish(last.status, last.back, last.body);
    const words = last?.retry ? `${last.why}. PenEcho tried ${TRIES} times.` : `${last?.why || WHY.server}.`, code = last?.code || "model_unavailable";
    finish(last?.status || 503, { "content-type":"application/json" }, JSON.stringify(anthropic ? { type:"error", error:{ type:"penecho_proxy", code, message:words } } : { error:{ message:words, type:"penecho_proxy", code } }), { message:words, code });
  }

  // One try of a model call. Answers { ok, status, back, body } when there is something to give the runner, or
  // { ok:false, retry, why, status?, retryAfter?, passOn? } when this try failed.
  // `deadlineMs` (0 for none) ends this try when it comes, however alive the stream still is; `cancelled()` is asked before anything is sent.
  async function attempt({ url, headers, body, anthropic, silenceMs, own, deadlineMs = 0, cancelled = () => false, setCurrent }) {
    if (cancelled()) return { ok:false, retry:false, cancelled:true, status:503, why:"The call was stopped" };
    const timedOut = () => ({ ok:false, retry:false, status:504, code:"request_in_progress", why:IN_PROGRESS_TIMEOUT_WHY });
    if (deadlineMs > 0 && deadlineMs - Date.now() <= 0) return timedOut();
    const upstream = new AbortController(); setCurrent(upstream);
    let silent = false, late = false, timer = null, deadlineTimer = null;
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => { silent = true; upstream.abort(); }, silenceMs); timer.unref?.(); };
    if (deadlineMs > 0) { deadlineTimer = setTimeout(() => { late = true; upstream.abort(); }, Math.max(1, deadlineMs - Date.now())); deadlineTimer.unref?.(); }
    arm();
    try {
      let response;
      try { response = await fetch(url, { method:"POST", headers, body, redirect:"error", signal:upstream.signal }); }
      catch { return late ? timedOut() : silent ? { ok:false, retry:true, why:WHY.silent, status:504 } : { ok:false, retry:true, why:own ? WHY.connectOwn : WHY.connect, status:503 }; }
      arm();
      const back = {};
      for (const name of PASS_BACK) { const value = response.headers.get(name); if (value) back[name] = value; }
      const chunks = []; let size = 0;
      const stream = /^text\/event-stream/i.test(response.headers.get("content-type") || "") ? sseWatch(anthropic) : null;
      try {
        // Node 22 loses fetch's abort signal once it collects the request, so the body is cancelled here: a stalled answer still ends in time.
        const reader = response.body?.getReader(), end = () => { reader?.cancel().catch(() => {}); };
        if (upstream.signal.aborted) end(); else upstream.signal.addEventListener("abort", end, { once:true });
        for (;;) {
          const { done, value:chunk } = reader ? await reader.read() : { done:true };
          upstream.signal.throwIfAborted();
          if (done) break;
          arm(); size += chunk.length;
          if (size > BODY_MOST) { upstream.abort(); return { ok:false, retry:false, why:"The answer was too large", status:502 }; }
          chunks.push(Buffer.from(chunk)); stream?.push(chunk);
        }
      } catch { return late ? timedOut() : { ok:false, retry:true, why:silent ? WHY.silent : WHY.cut, status:silent ? 504 : 502 }; }
      const bytes = Buffer.concat(chunks);
      if (response.status < 200 || response.status >= 300) {
        const parsed = parsedBody(bytes), code = String(parsed?.error?.code || parsed?.error?.type || (typeof parsed?.error === "string" ? parsed.error : "") || "");
        const retry = retryableStatus(response.status, code) && parsed?.retryable !== false && parsed?.details?.retryable !== false;
        if (!retry) return response.status === 402 ? { ok:true, status:402, back, body:bytes } : { ok:false, retry:false, passOn:true, status:response.status, code, back, body:bytes };
        return { ok:false, retry:true, why:whyOfStatus(response.status, code), status:response.status, code, retryAfter:retryAfterMs(response.headers.get("retry-after")), passOn:true, back, body:bytes };
      }
      if (!stream) return { ok:true, status:response.status, back, body:bytes };
      const seen = stream.end();
      if (seen.error) {
        // Cloud's replay of a settled call expired while this one waited (keepalive already sent): the same answer as a plain 409.
        if (String(seen.error.code || seen.error.type || "") === "request_already_completed") return { ok:false, retry:false, status:409, code:"request_already_completed" };
        // Cloud's own hint, in seconds, for how long to wait before the same call is asked again.
        const hint = Number(seen.error.retry_after_seconds ?? seen.error.details?.retryAfterSeconds);
        if (retryableEvent(seen.error)) return { ok:false, retry:true, why:whyOfEvent(seen.error), status:503, code:String(seen.error.code || seen.error.type || ""), ...(Number.isFinite(hint) && hint > 0 ? { retryAfter:Math.round(hint * 1000) } : {}) };
        return { ok:true, status:response.status, back, body:bytes };
      }
      if (seen.done) return { ok:true, status:response.status, back, body:bytes };
      // The last event said how the answer ended, and only the closing marker was lost: the answer is whole.
      if (seen.finished) return { ok:true, status:response.status, back, body:Buffer.concat([bytes, Buffer.from(anthropic ? 'event: message_stop\ndata: {"type":"message_stop"}\n\n' : "data: [DONE]\n\n")]) };
      return { ok:false, retry:true, why:WHY.cut, status:502 };
    } finally { clearTimeout(timer); clearTimeout(deadlineTimer); }
  }
  // Cloud's catalog could not be read for this try. A refusal (an unknown model, signed out) is final.
  function connectFailure(error) {
    const status = Number(error?.status) || 0;
    return status >= 400 && status < 500 && status !== 408 && status !== 429
      ? { ok:false, retry:false, status, why:String(error.message || "The model is not available.") }
      : { ok:false, retry:true, status:503, why:WHY.connect };
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(error => {
      onError(error);
      if (!res.headersSent) refuse(res, error.status || 502, String(error.message || "The model request failed."), { headers:{ "x-penecho-proxy-final":"1" } });
      else res.end();
    });
  });
  // Keep verified /identity -> /model keep-alive sockets open across transient server pauses
  // (keepAliveTimeout/headersTimeout), and avoid dropping slow request uploads on Node's requestTimeout.
  server.requestTimeout = 0;
  server.keepAliveTimeout = 60_000;
  server.headersTimeout = 65_000;
  const listening = new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      port = server.address().port;
      if (active) {
        try { writeEndpoint(); }
        catch (error) { active = false; onError(error); return reject(error); }
      }
      resolve(port);
    });
  });
  listening.catch(onError);
  // Neither the listener nor its sweep keeps PenEcho from quitting.
  server.unref();
  const sweep = setInterval(() => {
    const now = Date.now();
    if (active && !closed) {
      if (runsFile) {
        try { mutateRuns(() => ({ changed:false, value:true })); } catch (error) { onError(error); }
        sweepReapFiles(runsLockFile);
      } else {
        for (const run of runs.values()) if (!runIsLive(run, now)) runs.delete(run.id);
      }
    }
  }, 60000);
  sweep.unref();

  return {
    listening,
    endpointFile,
    get port() { return port; },
    get active() { return active && !closed; },
    get instanceId() { return instanceId; },
    activate,
    deactivate,
    // A run about to start: its address and its secret, which go into that run's environment and nowhere else.
    open({ pick = "", effort = "" } = {}) {
      if (!port) return null;
      if (startupError && !active && !closed) {
        // Re-check disk so a corrupt registry still throws PROXY_STORE_CORRUPT cleanly.
        loadPersistedRuns();
      }
      if (closed || !active) throw Object.assign(new Error("This PenEcho instance does not own Lines model proxy routing."), { code:"PROXY_INACTIVE", status:409 });
      const run = { id:crypto.randomUUID(), secret:crypto.randomBytes(32).toString("base64url"), pick, effort, usedAt:Date.now(), pid:0, calls:0 };
      if (runsFile) {
        mutateRuns(map => { map.set(run.id, { ...run }); return { changed:true, value:true }; });
      } else {
        runs.set(run.id, run);
      }
      return { id:run.id, url:`http://127.0.0.1:${port}/run/${run.id}`, secret:run.secret, endpointFile, proxyToken, instanceId };
    },
    end(id) {
      if (runsFile) {
        try {
          mutateRuns(map => ({ changed:map.delete(id), value:true }));
          pendingEnds.delete(id);
          clearDiskPendingEnds([id]);
          return true;
        } catch (error) {
          pendingEnds.add(id);
          runs.delete(id);
          const durable = persistPendingEnd(id);
          onError(error);
          return durable;
        }
      } else {
        runs.delete(id);
        return true;
      }
    },
    // Cloud's 402 answer for this run, if it had one (retained durably across server restarts until cleared after Work disposition).
    refused(id) {
      const mem = refusals.get(id);
      if (mem) return mem.body;
      if (runsFile) {
        try {
          const { refusals:diskRefusals } = readRunsFileStrict(runsFile);
          const disk = diskRefusals.get(id);
          if (disk) {
            refusals.set(id, disk);
            return disk.body;
          }
        } catch { /* Fall back to null if unreadable. */ }
      }
      return null;
    },
    clearRefusal,
    count() {
      if (runsFile) {
        const now = Date.now(), { map } = readRunsFileStrict(runsFile), ended = new Set([...pendingEnds, ...readDiskPendingEnds()]);
        let n = 0;
        for (const run of map.values()) if (!ended.has(run.id) && runIsLive(run, now)) n++;
        return n;
      }
      return runs.size;
    },
    // Hear every call that is about to be tried again. Answers a function that stops listening.
    onRetry(listener) { retryListeners.add(listener); return () => retryListeners.delete(listener); },
    close() {
      if (runsFile) {
        let hasPending = pendingEnds.size > 0;
        if (!hasPending) { try { hasPending = readDiskPendingEnds().size > 0; } catch { hasPending = false; } }
        if (hasPending) {
          try { mutateRuns(() => ({ changed:false, value:true })); } catch { /* Pending-end markers remain on disk for the successor. */ }
        }
      }
      active = false;
      closed = true;
      clearInterval(sweep);
      runs.clear();
      // Leave endpoint.json for the successor proxy to atomically replace; never unlink a newer successor's file.
      server.closeAllConnections?.();
      return new Promise(resolve => server.close(() => resolve()));
    },
  };
}

module.exports = { createModelProxy, proxyIdentityProof, sweepReapFiles };
