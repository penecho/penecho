"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { StringDecoder } = require("node:string_decoder");
const { prepareCodexEnv } = require("../../providers/codex-cli.js");

const TURN_LOCK_WAIT = new Int32Array(new SharedArrayBuffer(4));
const pidAlive = pid => {
  if (!(Number(pid) > 0)) return false;
  try { process.kill(Number(pid), 0); return true; } catch (error) { return error?.code === "EPERM"; }
};

// Short-lived exclusive mutex guarding the check-input + append-turn/start critical section.
// - If a live owner holds the lock, wait briefly for it to finish writing and release.
// - If a previous owner crashed mid-append (dead PID left lock behind without releasing), report
//   { status: "ambiguous" } so recovery surfaces an explicit unknown-outcome failure instead of hanging or duplicating.
function acquireTurnSubmitLock(dir, { waitMs = 2000 } = {}) {
  if (!dir) return { status:"acquired", release() {} };
  const file = path.join(dir, "turn-submit.lock");
  const token = `${process.pid}:${Date.now()}:${crypto.randomBytes(6).toString("hex")}`;
  const payload = JSON.stringify({ pid:process.pid, at:Date.now(), token });
  const deadline = Date.now() + waitMs;
  for (;;) {
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    let created = false;
    try {
      fs.writeFileSync(tmp, payload, { mode:0o600 });
      try {
        fs.linkSync(tmp, file);
        created = true;
      } catch (error) {
        if (error?.code !== "EEXIST") {
          if (["EPERM", "EXDEV", "ENOTSUP", "ENOSYS"].includes(error?.code)) {
            let fd = null;
            try { fd = fs.openSync(file, "wx", 0o600); fs.writeFileSync(fd, payload); fs.closeSync(fd); created = true; }
            catch (err) { if (fd !== null) { try { fs.closeSync(fd); } catch {} } if (err?.code !== "EEXIST") throw err; }
          } else {
            throw error;
          }
        }
      }
    } finally {
      try { fs.unlinkSync(tmp); } catch {}
    }
    if (created) {
      return {
        status:"acquired",
        release() {
          try {
            const cur = JSON.parse(fs.readFileSync(file, "utf8"));
            if (cur?.token === token) fs.unlinkSync(file);
          } catch { /* Already released. */ }
        },
      };
    }
    try {
      const holder = JSON.parse(fs.readFileSync(file, "utf8"));
      if (holder?.pid && !pidAlive(holder.pid)) return { status:"ambiguous", release() {} };
    } catch (err) {
      if (err?.code === "ENOENT") continue;
      if (Date.now() >= deadline) return { status:"ambiguous", release() {} };
    }
    if (Date.now() >= deadline) return { status:"busy", release() {} };
    Atomics.wait(TURN_LOCK_WAIT, 0, 0, 10);
  }
}

function parseInputLog(text) {
  const state = { init:null, initialized:false, threadReq:null, turnReq:null, corruptTail:false };
  const rawLines = String(text || "").split("\n");
  // JSON-RPC frames on Codex stdio are newline-delimited: a trailing fragment without `\n` is NOT a complete submitted frame,
  // even if its bytes happen to parse as JSON, because Codex buffers until `\n`.
  const trailing = rawLines.pop() || "";
  if (trailing.trim()) state.corruptTail = true;
  for (const raw of rawLines) {
    if (!raw.trim()) continue;
    let msg; try { msg = JSON.parse(raw); } catch { state.corruptTail = true; continue; }
    if (!msg || typeof msg !== "object") continue;
    if (msg.method === "initialize") state.init = msg;
    else if (msg.method === "initialized") state.initialized = true;
    else if (msg.method === "thread/start" || msg.method === "thread/resume") state.threadReq = msg;
    else if (msg.method === "turn/start") state.turnReq = msg;
  }
  return state;
}

// Codex's documented app-server: newline-delimited JSON requests, answers and notifications over stdio.
// Threads started this way are interactive threads, the same kind Codex's own desktop app lists.
class CodexServer {
  // child: an app-server already running (one a PenEcho before this one started, under its keeper); it was set up then.
  constructor({ command, args = [], cwd, env = process.env, spawnFn = spawn, onNote = null, onResponse = null, onServerRequest = null, onServerRequestResolved = null, clientName = "penecho", child = null, sandboxWindowsPath = true }) {
    // Requests of an earlier PenEcho may still be answered on an attached server: these ids never meet theirs.
    this.seq = child ? 1e9 + Math.floor(Math.random() * 1e6) : 0; this.waiting = new Map(); this.pendingServerRequests = new Map(); this.buffer = ""; this.tail = ""; this.onNote = onNote; this.onResponse = onResponse; this.onServerRequest = onServerRequest; this.onServerRequestResolved = onServerRequestResolved; this.alive = true; this.detached = Boolean(child?.detached); this.clientName = clientName;
    this.outputDecoder = new StringDecoder("utf8");
    const extraEnv = !child && command === process.execPath && process.versions?.electron && Array.isArray(args) && args.length && !env?.ELECTRON_RUN_AS_NODE
      ? { ELECTRON_RUN_AS_NODE:"1" }
      : null;
    const spawnEnv = child ? env : prepareCodexEnv(env, extraEnv, { platform:process.platform, sandboxWindowsPath });
    this.child = child || spawnFn(command, args, { cwd, env:spawnEnv, stdio:["pipe", "pipe", "pipe"], windowsHide:true });
    this.child.stdout?.on("data", chunk => this.read(chunk));
    this.child.stderr?.on("data", chunk => { this.tail = (this.tail + String(chunk)).slice(-2000); });
    this.child.stdin?.on("error", () => {});
    const gone = (error, detached = false) => {
      this.alive = false;
      if (detached) this.detached = true;
      this.pendingServerRequests.clear();
      for (const reject of this.waiting.values()) reject.fail(error || Object.assign(Error(detached ? "Detached from Codex." : "Codex stopped before it answered."), detached ? { detached:true } : {}));
      this.waiting.clear();
    };
    this.child.on("error", gone);
    this.child.on("close", () => gone());
    this.child.on("detach", () => gone(null, true));
    this.ready = child ? Promise.resolve({}) : this.request("initialize", { clientInfo:{ name:this.clientName, title:"PenEcho", version:"1" } }).then(result => { this.notify("initialized"); return result; });
    this.ready.catch(() => {});
  }
  read(chunk) {
    // A kept child advances its raw byte cursor after the data listeners return.
    // Its stdout chunks end at a frame boundary or inside a single frame.
    const offset = this.child.offsets?.out;
    this.outputEnd = Number.isSafeInteger(offset) ? offset + Buffer.byteLength(chunk) : null;
    this.buffer += typeof chunk === "string" ? chunk : this.outputDecoder.write(chunk);
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      let message; try { message = JSON.parse(line); } catch { continue; }
      if (message.id !== undefined && message.method) {
        if (this.onServerRequest && message.method === "item/tool/requestUserInput") {
          this.pendingServerRequests.set(String(message.id), message);
          this.onServerRequest(message);
          continue;
        }
        this.answerServer(message);
        continue;
      }
      if (message.id !== undefined) {
        this.onResponse?.(message);
        const waiter = this.waiting.get(message.id);
        if (waiter) { this.waiting.delete(message.id); if (message.error) waiter.fail(Object.assign(Error(message.error.message || "Codex refused that."), { rpc:message.error })); else waiter.done(message.result); }
        continue;
      }
      if (message.method) {
        if (message.method === "serverRequest/resolved") {
          const rid = message.params?.requestId ?? message.params?.id;
          if (rid !== undefined && rid !== null) {
            this.pendingServerRequests.delete(String(rid));
            this.onServerRequestResolved?.(rid, message);
          }
        }
        this.onNote?.(message);
      }
    }
  }
  // Reply to a held JSON-RPC ServerRequest (e.g. item/tool/requestUserInput).
  replyServer(id, result) {
    const key = String(id), req = this.pendingServerRequests.get(key);
    if (!req) return false;
    this.pendingServerRequests.delete(key);
    return this.write({ id:req.id, result });
  }
  // Nobody is here to approve anything, so whatever Codex would ask about is declined.
  // Codex's auto-reviewer, when the person turned it on, decides inside Codex and never asks here.
  answerServer(message) {
    this.write({ id:message.id, result:declined(message.method) });
  }
  write(message) {
    if (!this.alive || this.detached || this.child.detached || !this.child.stdin?.writable) return false;
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
    return true;
  }
  notify(method, params) { return this.write(params === undefined ? { method } : { method, params }); }
  request(method, params) {
    return new Promise((done, fail) => {
      if (!this.alive || this.detached || this.child.detached || !this.child.stdin?.writable) {
        fail(Object.assign(Error("Codex connection is no longer writable."), { detached:Boolean(this.detached || this.child.detached) }));
        return;
      }
      const id = ++this.seq;
      this.waiting.set(id, { done, fail });
      this.write({ id, method, params });
    });
  }
  async call(method, params) { await this.ready; return this.request(method, params); }
  close({ reason = "" } = {}) { this.alive = false; this.pendingServerRequests.clear(); try { this.child.kill("SIGTERM", reason ? { reason } : undefined); } catch { /* It already ended. */ } }
}

// Each kind of approval takes its own "no": the item/… requests "decline", the older execCommandApproval and applyPatchApproval "denied",
// and a request for more permissions is granted none. Names as read in Codex 0.167.
function declined(method = "") {
  if (method === "item/permissions/requestApproval") return { permissions:{}, scope:"turn" };
  if (/^item\/.*requestApproval$/.test(method)) return { decision:"decline" };
  if (/approval/i.test(method)) return { decision:"denied" };
  return {};
}

function turnResult(note) {
  const turn = note.params?.turn;
  return { code:turn?.status === "completed" ? 0 : 1, reason:turn?.error?.message || (turn?.status === "interrupted" ? "It was interrupted." : "") };
}

function turnRejection(message) {
  return { code:1, reason:message.error.message || "Codex refused that." };
}

function matchesOutcome(outcome, threadId, turnId, turnRequest) {
  if (!outcome || !Number.isSafeInteger(outcome.out) || outcome.out <= 0 || !threadId || outcome.threadId !== threadId) return false;
  if (![0, 1].includes(outcome.result?.code) || typeof outcome.result.reason !== "string") return false;
  if (outcome.requestId !== undefined) return !turnId && outcome.result.code === 1 && outcome.requestId === turnRequest?.id;
  return typeof outcome.turnId === "string" && Boolean(outcome.turnId) && (!turnId || outcome.turnId === turnId);
}

// One piece of work: start or resume a thread, run one turn, and say when it has ended.
function runTurn(server, { resume, thread, turn, input, onInitialized, onThread, onBeforeTurn, onStarted }) {
  let finish = null, threadId = null, turnId = null, requestId, done = false;
  const ended = new Promise(resolve => { finish = resolve; });
  const finished = (result, identity) => {
    if (done) return;
    done = true;
    if (identity && server.outputEnd) server.turnOutcome = { ...identity, out:server.outputEnd, result };
    finish(result);
  };
  const previousResponse = server.onResponse;
  server.onResponse = message => {
    previousResponse?.(message);
    if (message.id === requestId && message.error) finished(turnRejection(message), { threadId, requestId });
  };
  const previous = server.onNote;
  // An agent may start helpers, each on its own thread. Only this thread's own turn says the work has ended, and only its words count.
  server.onNote = note => {
    const from = note.params?.threadId;
    if (from && threadId && from !== threadId) return;
    previous?.(note);
    if (note.method === "turn/completed" && threadId) {
      const id = note.params?.turn?.id;
      if (turnId && id !== turnId) return;
      finished(turnResult(note), { threadId, turnId:id });
    }
  };
  server.child.on("close", code => finished({ code:code || 1, reason:server.tail.trim().split("\n").pop() || "Codex stopped before it finished.", closed:true }));
  (async () => {
    await server.ready;
    onInitialized?.();
    const opened = resume ? await server.request("thread/resume", { threadId:resume, ...thread }) : await server.request("thread/start", thread);
    threadId = opened.thread.id;
    onThread?.(threadId, opened.thread);
    onBeforeTurn?.(threadId);
    let startedPromise = null;
    const lock = acquireTurnSubmitLock(server.child?.dir);
    try {
      if (lock.status !== "acquired") return;
      if (!server.alive || server.detached || server.child?.detached) return;
      if (server.child?.dir) {
        let existingInput = "";
        try { existingInput = fs.readFileSync(path.join(server.child.dir, "input"), "utf8"); } catch {}
        if (parseInputLog(existingInput).turnReq) return;
      }
      requestId = server.seq + 1;
      startedPromise = server.request("turn/start", { threadId:opened.thread.id, input:[{ type:"text", text:input }], ...turn });
    } finally {
      lock.release();
    }
    const started = await startedPromise;
    turnId = started.turn?.id;
    onStarted?.(turnId);
  })().catch(error => { if (!error?.detached) finished({ code:1, reason:error.message, protocol:true }); });
  return ended;
}

// The turn a PenEcho before this one started, followed to its end on the attached server. Everything Codex said meanwhile is read first.
// If PenEcho exited during initialize / thread setup before issuing turn/start, reconcile from the live keeper input/output log,
// await any already-in-flight initialize or thread/start RPC by its ID, and issue turn/start at most once across all handoff owners.
function followTurn(server, { threadId = null, turnId = null, savedOutcome = null, phase = "turn", resume = null, thread = null, turn = null, input = "", inputText = "", readInput = null, isDetached = null, onThread = null, onBeforeTurn = null, onStarted = null } = {}) {
  let finished = null, done = false, observedTurn = Boolean(turnId);
  const resolveOnce = (result, identity) => {
    if (done) return;
    done = true;
    if (identity && server.outputEnd) server.turnOutcome = { ...identity, out:server.outputEnd, result };
    finished(result);
  };
  const ended = new Promise(resolve => { finished = resolve; });
  const keepDir = server.child?.dir || "";
  const liveInput = () => {
    if (typeof readInput === "function") { try { return String(readInput() || ""); } catch { return ""; } }
    if (keepDir) { try { return fs.readFileSync(path.join(keepDir, "input"), "utf8"); } catch { return ""; } }
    return String(inputText || "");
  };
  const ownerGone = () => Boolean(done || !server.alive || server.detached || server.child?.detached || isDetached?.());
  const initialLog = parseInputLog(liveInput());
  let observedThreadId = threadId || initialLog.turnReq?.params?.threadId || null;
  let observedTurnId = turnId;
  const hasSavedOutcome = matchesOutcome(savedOutcome, observedThreadId, observedTurnId, initialLog.turnReq);
  const restoreOutcome = () => {
    server.turnOutcome = savedOutcome;
    resolveOnce(savedOutcome.result);
  };
  if (hasSavedOutcome && !ownerGone() && savedOutcome.out <= server.child.offsets?.out) {
    restoreOutcome();
    return ended;
  }
  const seenResponses = new Map(), responseWaiters = new Map();
  const prevResponse = server.onResponse;
  server.onResponse = msg => {
    prevResponse?.(msg);
    if (msg.id === undefined || ownerGone()) return;
    seenResponses.set(msg.id, msg);
    const waiter = responseWaiters.get(msg.id);
    if (waiter) {
      responseWaiters.delete(msg.id);
      if (msg.error) waiter.fail(Object.assign(Error(msg.error.message || "Codex refused that."), { rpc:msg.error }));
      else waiter.done(msg.result);
    }
    const parsed = parseInputLog(liveInput());
    if (parsed.threadReq && msg.id === parsed.threadReq.id && msg.result?.thread?.id && !observedThreadId) {
      observedThreadId = msg.result.thread.id;
      onThread?.(observedThreadId, msg.result.thread);
    }
    if (parsed.turnReq && msg.id === parsed.turnReq.id) {
      if (msg.error) {
        resolveOnce(turnRejection(msg), { threadId:observedThreadId || parsed.turnReq.params?.threadId || null, requestId:msg.id });
        return;
      }
      observedTurn = true;
      observedTurnId ||= msg.result?.turn?.id;
      if (!server.waiting.has(msg.id)) onStarted?.(observedTurnId);
    }
  };
  const waitResponse = id => {
    if (seenResponses.has(id)) {
      const msg = seenResponses.get(id);
      return msg.error ? Promise.reject(Object.assign(Error(msg.error.message || "Codex refused that."), { rpc:msg.error })) : Promise.resolve(msg.result);
    }
    return new Promise((doneRes, failRes) => {
      if (ownerGone()) { failRes(Object.assign(Error("Detached from Codex."), { detached:true })); return; }
      responseWaiters.set(id, { done:doneRes, fail:failRes });
    });
  };
  const cancelWaiters = detached => {
    const err = Object.assign(Error(detached ? "Detached from Codex." : "Codex stopped before it answered."), detached ? { detached:true } : {});
    for (const waiter of responseWaiters.values()) waiter.fail(err);
    responseWaiters.clear();
  };
  const previous = server.onNote;
  server.onNote = note => {
    const from = note.params?.threadId;
    if (from && !observedThreadId) observedThreadId = from;
    if (from && observedThreadId && from !== observedThreadId) return;
    if (note.method === "item/started" || note.method === "item/completed" || note.method === "turn/started" || note.method === "turn/completed") observedTurn = true;
    previous?.(note);
    if (note.method === "turn/completed") {
      const id = note.params?.turn?.id;
      if (observedTurnId && id !== observedTurnId) return;
      resolveOnce(turnResult(note), { threadId:observedThreadId, turnId:id });
    }
  };
  server.child.on("close", code => {
    cancelWaiters(false);
    if (!done && hasSavedOutcome && !isDetached?.() && savedOutcome.out <= server.child.offsets?.out) {
      restoreOutcome();
      return;
    }
    resolveOnce({ code:code || 1, reason:server.tail.trim().split("\n").pop() || "Codex stopped before it finished.", closed:true });
  });
  let delayTimer = null, wakeDelay = null;
  server.child.on("detach", () => {
    clearTimeout(delayTimer);
    wakeDelay?.();
    cancelWaiters(true);
  });
  const turnAlreadySent = hasSavedOutcome || phase === "turn" || observedTurn || Boolean(initialLog.turnReq);
  if (!turnAlreadySent && input) {
    (async () => {
      // Allow replayed stdout lines to surface any already-created thread, RPC replies, or completed turn before reconciling.
      await new Promise(resolve => { wakeDelay = resolve; delayTimer = setTimeout(resolve, 150); delayTimer.unref?.(); });
      wakeDelay = null;
      if (ownerGone() || observedTurn) return;
      let log = parseInputLog(liveInput());
      if (log.turnReq) {
        observedTurn = true;
        return;
      }
      if (log.corruptTail) {
        resolveOnce({ code:1, reason:"Codex input log contains an incomplete frame from an interrupted turn submission.", protocol:true });
        return;
      }
      if (!log.init) {
        if (ownerGone()) return;
        await server.request("initialize", { clientInfo:{ name:server.clientName, title:"PenEcho", version:"1" } });
        if (ownerGone()) return;
        if (!parseInputLog(liveInput()).initialized) server.notify("initialized");
      } else if (!log.initialized) {
        if (log.init.id !== undefined) await waitResponse(log.init.id);
        if (ownerGone()) return;
        if (!parseInputLog(liveInput()).initialized) server.notify("initialized");
      }
      if (ownerGone() || observedTurn) return;
      log = parseInputLog(liveInput());
      if (log.turnReq) {
        observedTurn = true;
        return;
      }
      if (!observedThreadId) {
        if (log.threadReq && log.threadReq.id !== undefined) {
          // A prior owner already submitted thread/start or thread/resume: await its RPC reply instead of opening a duplicate thread.
          const opened = await waitResponse(log.threadReq.id);
          if (ownerGone()) return;
          if (!observedThreadId && opened?.thread?.id) {
            observedThreadId = opened.thread.id;
            onThread?.(observedThreadId, opened.thread);
          }
        } else {
          const opened = resume ? await server.request("thread/resume", { threadId:resume, ...(thread || {}) }) : await server.request("thread/start", thread || {});
          if (ownerGone()) return;
          observedThreadId = opened.thread.id;
          onThread?.(observedThreadId, opened.thread);
        }
      }
      if (ownerGone() || observedTurn || !observedThreadId) return;
      // Invoke onBeforeTurn BEFORE acquiring the submission lock so a detach at this checkpoint releases cleanly
      // and allows the successor to submit the turn once (no lost turns!).
      onBeforeTurn?.(observedThreadId);
      if (ownerGone() || observedTurn) return;
      const lock = acquireTurnSubmitLock(keepDir);
      let startedPromise = null;
      try {
        if (lock.status === "ambiguous") {
          const recheck = parseInputLog(liveInput());
          if (recheck.turnReq) { observedTurn = true; return; }
          resolveOnce({ code:1, reason:"Codex turn submission was interrupted in an unknown state before completing.", protocol:true });
          return;
        }
        if (lock.status !== "acquired") return;
        if (ownerGone() || observedTurn) return;
        log = parseInputLog(liveInput());
        if (log.turnReq) { observedTurn = true; return; }
        if (log.corruptTail) {
          resolveOnce({ code:1, reason:"Codex input log contains an incomplete frame from an interrupted turn submission.", protocol:true });
          return;
        }
        // `server.request` appends the complete JSON frame to keeper `input` synchronously before releasing the lock.
        startedPromise = server.request("turn/start", { threadId:observedThreadId, input:[{ type:"text", text:input }], ...(turn || {}) });
      } finally {
        lock.release();
      }
      const started = await startedPromise;
      if (ownerGone()) return;
      observedTurn = true;
      onStarted?.(started.turn?.id);
    })().catch(error => { if (!error?.detached && !ownerGone()) resolveOnce({ code:1, reason:error.message, protocol:true }); });
  }
  return ended;
}

// More words for the turn still running, the way typing into Codex while it works steers it. Refused once that turn has ended.
function steerTurn(server, { threadId, turnId, input }) {
  if (!server.alive || !threadId || !turnId) return Promise.reject(Error("No turn is running to take this."));
  return server.request("turn/steer", { threadId, expectedTurnId:turnId, input:[{ type:"text", text:input }] });
}

module.exports = { CodexServer, runTurn, followTurn, steerTurn, turnResult, declined };
