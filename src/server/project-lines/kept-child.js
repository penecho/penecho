"use strict";
// Agents run under keepers (agent-keeper.js), so a stop, restart or crash of PenEcho never ends them. To the rest of PenEcho a
// kept agent looks like a child process: stdout and stderr give what it writes (read from its files), stdin takes its input
// (written to a file its keeper reads), kill() stops it, and "exit" and "close" say how it ended. A PenEcho started later
// attaches to the same agent by its folder and reads on from where the earlier one had got to.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { killWindowsTrees } = require("./windows-processes.js");
const { EventEmitter } = require("node:events");
const { Writable } = require("node:stream");
const { DSH_PATCH_FILE } = require("./dsh-models.js");

const KEEPER = path.join(__dirname, "agent-keeper.js");
const POLL_MS = 250;
const READ_BYTES = 4 * 1024 * 1024;
const watchNames = new Set(["out", "err", "exit.json", "pid.json", "claim.json"]);
const UNCLAIMED_TIMEOUT_MS = 10_000;
const droppedTypes = new Set(["message_update", "message_start", "turn_start", "turn_end", "tool_execution_update"]);
const rpcCandidate = /"(?:message_update|message_start|turn_start|turn_end|tool_execution_update|agent_end)"|\\u/;
const strictUtf8 = new TextDecoder("utf-8", { fatal:true, ignoreBOM:true });

function filterRpcLine(bytes) {
  if (!bytes.includes(123)) return bytes;
  let line, event;
  try {
    line = strictUtf8.decode(bytes);
    if (!rpcCandidate.test(line)) return bytes;
    event = JSON.parse(line);
  } catch { return bytes; }
  if (droppedTypes.has(event?.type)) return null;
  if (event?.type === "agent_end" && bytes.length > 1024 && Object.hasOwn(event, "messages")) {
    const ending = line.endsWith("\r\n") ? "\r\n" : line.endsWith("\n") ? "\n" : "";
    if (bytes.length - ending.length > 1024) {
      delete event.messages;
      try { return Buffer.from(JSON.stringify(event) + ending); } catch { return bytes; }
    }
  }
  return bytes;
}

const alive = pid => { if (!(pid > 0)) return false; try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; } };
// pid.json outlives a restart of the computer, its numbers do not: another program can have them now (the Codex app, say), and it must not be
// taken for the agent, or stopped as one. Only numbers written before this start are looked into.
function anothersNow(ids) {
  if (!(Number(ids?.at) > 0) || ids.at >= Date.now() - os.uptime() * 1000 - 60000) return false;
  return ![ids.agent, ids.keeper].some(pid => { const meta = alive(pid) && require("./run-watch.js").processMeta(pid); return meta && meta.startedAt > 0 && meta.startedAt <= ids.at + 120000; });
}
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
function createExclusiveFile(file, content, mode = 0o600) {
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
    try { fs.unlinkSync(tmp); } catch { /* Already linked or absent. */ }
  }
}
function tryCancelLaunchClaim(dir, { corruptAfterMs = UNCLAIMED_TIMEOUT_MS } = {}) {
  const file = path.join(dir, "claim.json");
  const payload = JSON.stringify({ owner:"cancelled", by:process.pid, at:Date.now() });
  try {
    if (createExclusiveFile(file, payload, 0o600)) return true;
    const existing = readJson(file);
    if (existing?.owner === "cancelled") return true;
    // Recover from an empty/corrupt claim file left by an external crash once it has aged past the timeout.
    if (!existing) {
      try {
        const stat = fs.statSync(file);
        if (Date.now() - stat.mtimeMs >= Math.max(0, Number(corruptAfterMs) || 0)) {
          const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
          fs.writeFileSync(tmp, payload, { mode:0o600 });
          fs.renameSync(tmp, file);
          return true;
        }
      } catch { /* Ignore race. */ }
    }
    return false;
  } catch {
    return false;
  }
}

// What the agent writes, given out as it is read. An offset moves on only once its listeners have taken the words in, so the
// offsets kept for a later PenEcho never skip anything this one had not yet handled.
class Output extends EventEmitter {
  setEncoding() { return this; } resume() { return this; } pause() { return this; }
  end() { this.emit("end"); this.emit("close"); }
}

class KeptChild extends EventEmitter {
  constructor(dir, { offsets = {}, streamFilter, unclaimedTimeoutMs, earlier = false } = {}) {
    super();
    this.kept = true; this.dir = dir;
    this.offsets = { out:Number(offsets.out) || 0, err:Number(offsets.err) || 0 };
    this.streamFilter = streamFilter || readJson(path.join(dir, "spec.json"))?.streamFilter || "";
    this.rawUntilNewline = null;
    this.emittingStart = null;
    // How far the files are read, and the lines read but not yet given out (one at a time, as they would have come down a pipe).
    this.readTo = { ...this.offsets }; this.lines = []; this.giving = false; this.ending = null;
    this.stdoutActivityAt = 0;
    this.stdout = new Output(); this.stderr = new Output();
    this.exitCode = null; this.signalCode = null; this.closed = false; this.detached = false;
    this.attachedAt = Date.now();
    this.unclaimedTimeoutMs = Number(unclaimedTimeoutMs) > 0 ? Number(unclaimedTimeoutMs) : UNCLAIMED_TIMEOUT_MS;
    this.pid = this.readIds()?.agent || undefined;
    this.restarted = earlier && anothersNow(readJson(path.join(dir, "pid.json")));
    // Written at once, beside the agent: words said in the moment PenEcho goes are still taken up by its keeper.
    // Once detached or closed, stdin refuses any further writes so a superseded owner can never inject RPC frames.
    this.stdin = new Writable({
      write:(chunk, encoding, callback) => {
        if (this.detached || this.closed) { callback(Object.assign(new Error("Kept child is detached."), { code:"DETACHED" })); return; }
        try { fs.appendFileSync(path.join(dir, "input"), chunk); callback(); } catch (error) { callback(error); }
      },
      final:callback => {
        if (this.detached || this.closed) { callback(); return; }
        try { fs.writeFileSync(path.join(dir, "input-end"), ""); callback(); } catch (error) { callback(error); }
      },
    });
    this.stdin.on("error", () => {});
    this.timer = setInterval(() => this.pump(), POLL_MS); this.timer.unref?.();
    try {
      this.watcher = fs.watch(dir, (_event, filename) => {
        const name = filename && path.basename(String(filename));
        if (!name || watchNames.has(name)) this.pump(name);
      });
      this.watcher.on("error", () => {}); this.watcher.unref?.();
    } catch { /* The timer reads on its own. */ }
    setImmediate(() => this.pump());
  }
  readFrom(name, { finalFlush = false, ends = {} } = {}) {
    const from = this.readTo[name];
    if (ends[name] <= from) return 0;
    let fd; try { fd = fs.openSync(path.join(this.dir, name), "r"); } catch { return 0; }
    try {
      const size = ends[name] ??= fs.fstatSync(fd).size;
      if (size <= from) return 0;
      const filtered = name === "out" && this.streamFilter === "pi-rpc";
      if (filtered && this.rawUntilNewline === null) {
        const previous = Buffer.alloc(1);
        this.rawUntilNewline = from > 0 && (fs.readSync(fd, previous, 0, 1, from - 1) !== 1 || previous[0] !== 10);
      }
      const bytes = Buffer.alloc(Math.min(size - from, READ_BYTES));
      const got = fs.readSync(fd, bytes, 0, bytes.length, from);
      let consumed = 0, lastLine;
      while (consumed < got) {
        const newline = bytes.indexOf(10, consumed);
        const stop = newline < 0 ? got : newline + 1;
        if (filtered && newline < 0 && !(finalFlush && from + stop === size)) {
          if (stop - consumed < READ_BYTES || from + stop === size) break;
          this.rawUntilNewline = true;
        }
        let frame = bytes.subarray(consumed, stop);
        if (filtered) {
          if (!this.rawUntilNewline) frame = filterRpcLine(frame);
          if (newline >= 0) this.rawUntilNewline = false;
        }
        if (frame) {
          lastLine = { name, bytes:frame, start:from + consumed, end:from + stop };
          this.lines.push(lastLine);
        }
        consumed = stop;
      }
      this.readTo[name] = from + consumed;
      if (filtered && consumed && lastLine?.end !== this.readTo.out) {
        const pending = lastLine || this.lines.findLast(line => line.name === "out");
        if (pending) pending.end = this.readTo.out;
        else if (!this.giving && !this.lines.length) this.offsets.out = this.readTo.out;
      }
      if (lastLine) this.give();
      return consumed;
    } finally { fs.closeSync(fd); }
  }
  // Each line goes out on its own turn of the event loop, so what follows from one (an answer awaited) happens before the next.
  give() {
    if (this.giving) return;
    this.giving = true;
    const next = () => {
      if (this.detached) { this.giving = false; return; }
      const line = this.lines.shift();
      if (!line) {
        this.giving = false;
        if (this.streamFilter === "pi-rpc") this.offsets.out = this.readTo.out;
        if (this.ending) this.finishNow(this.ending);
        return;
      }
      if (line.name === "out") this.emittingStart = line.start;
      try { (line.name === "out" ? this.stdout : this.stderr).emit("data", line.bytes); } finally { if (line.name === "out") this.emittingStart = null; this.offsets[line.name] = line.end; }
      setImmediate(next);
    };
    setImmediate(next);
  }
  readIds() {
    const ids = readJson(path.join(this.dir, "pid.json"));
    this.keeperPid = ids?.keeper;
    return ids;
  }
  pump(name) {
    if (this.closed || this.ending || this.detached || this.pumping) return;
    const outBefore = this.readTo.out;
    this.pumping = true;
    try {
      const ids = this.pid ? null : this.readIds();
      if (ids?.agent) { this.pid = ids.agent; this.emit("spawn"); }
      const isAlive = pid => !this.restarted && alive(pid), agentAlive = isAlive(this.pid);
      const outputEvent = name === "out" || name === "err";
      // Check exit.json before reading when not on a live steady-state output burst so a late attach after foreground exit
      // bounds its drain strictly to exit.json's outSize/errSize and never ingests post-exit descendant output.
      let ending = (!outputEvent || !agentAlive) && readJson(path.join(this.dir, "exit.json"));
      let readOutput = false;
      if (!ending) {
        const ends = {};
        while (this.readFrom("out", { ends }) || this.readFrom("err", { ends })) readOutput = true;
        if (outputEvent && agentAlive && !readOutput) ending = readJson(path.join(this.dir, "exit.json"));
      }
      // A keeper that was itself killed leaves no word: the agent, still writing into its files, is read until it has gone too.
      let latestIds = !ending && !agentAlive ? this.readIds() : null;
      const claimFile = path.join(this.dir, "claim.json");
      const hasClaimFile = !ending && !this.pid && fs.existsSync(claimFile);
      const claim = hasClaimFile ? readJson(claimFile) : null;
      if (!ending && this.pid && !agentAlive && !isAlive(this.keeperPid)) ending = { code:1, signal:null, lost:true };
      // If keeper died before publishing an agent PID, fence with `launch-aborted` FIRST and re-read pid.json:
      // if the pre-exec wrapper already published agent PID, adopt it instead of declaring the launch lost; otherwise
      // the pre-exec wrapper is guaranteed to observe `launch-aborted` and exit without exec'ing the agent.
      const deadKeeperNoAgent = !ending && !this.pid && !latestIds?.agent && (
        (latestIds?.keeper && !isAlive(latestIds.keeper))
        || (claim?.owner === "keeper" && claim.keeper && !isAlive(claim.keeper))
      );
      if (deadKeeperNoAgent) {
        try { fs.writeFileSync(path.join(this.dir, "launch-aborted"), String(Date.now())); } catch { /* Best-effort fence. */ }
        latestIds = this.readIds();
        if (latestIds?.agent) {
          this.pid = latestIds.agent;
          this.emit("spawn");
        } else {
          ending = { code:1, signal:null, lost:true };
        }
      }
      if (!ending && !this.pid && !latestIds?.agent && claim?.owner === "cancelled") ending = { code:1, signal:"SIGTERM", lost:true };
      if (!ending && !this.pid && !latestIds?.agent && !claim) {
        let refMtime = this.attachedAt;
        if (hasClaimFile) {
          try { refMtime = Math.min(refMtime, fs.statSync(claimFile).mtimeMs); } catch { /* Missing claim. */ }
        } else {
          try { refMtime = Math.min(refMtime, fs.statSync(path.join(this.dir, "spec.json")).mtimeMs); } catch { /* Missing spec. */ }
        }
        if (Date.now() - refMtime >= this.unclaimedTimeoutMs && tryCancelLaunchClaim(this.dir, { corruptAfterMs:this.unclaimedTimeoutMs })) {
          try { fs.writeFileSync(path.join(this.dir, "launch-aborted"), String(Date.now())); } catch { /* Best-effort fence. */ }
          latestIds = this.readIds();
          if (latestIds?.agent) {
            this.pid = latestIds.agent;
            this.emit("spawn");
          } else {
            ending = { code:1, signal:null, lost:true };
          }
        }
      }
      if (!ending) return;
      const finalEnds = { out:0, err:0 };
      for (const stream of Object.keys(finalEnds)) {
        let diskSize = 0;
        try { diskSize = fs.statSync(path.join(this.dir, stream)).size; } catch {}
        const cap = ending[`${stream}Size`];
        finalEnds[stream] = Number.isInteger(cap) && cap >= 0 ? Math.min(diskSize, cap) : diskSize;
      }
      const finalRead = { finalFlush:true, ends:finalEnds };
      while (this.readFrom("out", finalRead) || this.readFrom("err", finalRead)) {}
      this.finish(ending);
    } finally {
      // Filtered RPC frames still show the agent is working. Update once per pump that consumes stdout.
      if (this.streamFilter === "pi-rpc" && this.readTo.out > outBefore) this.stdoutActivityAt = Date.now();
      this.pumping = false;
    }
  }
  finish(ending) {
    if (this.closed || this.ending) return;
    this.ending = ending; this.stop();
    if (!this.giving && !this.lines.length) this.finishNow(ending);
  }
  finishNow(ending) {
    if (this.closed) return;
    this.closed = true;
    this.exitCode = ending.signal ? null : ending.code; this.signalCode = ending.signal || null;
    this.stdout.end(); this.stderr.end();
    // Exit is known and all output has been delivered. Keep the durable run record
    // for Work finalization and recovery, and release its launch-only overlay.
    try { fs.unlinkSync(path.join(this.dir, DSH_PATCH_FILE)); } catch { /* Absent, or the next sweep can remove it. */ }
    // Read to its end: its folder may now be cleared away (sweep).
    try { fs.writeFileSync(path.join(this.dir, "read"), ""); } catch { /* It stays until it is swept. */ }
    setImmediate(() => {
      if (ending.error && !this.pid) { this.emit("error", Object.assign(Error(ending.error), { code:/ENOENT/.test(ending.error) ? "ENOENT" : undefined })); return; }
      this.emit("exit", this.exitCode, this.signalCode);
      this.emit("close", this.exitCode, this.signalCode);
    });
  }
  stop() { clearInterval(this.timer); try { this.watcher?.close(); } catch { /* Already closed. */ } }
  kill(signal = "SIGTERM", { reason = "" } = {}) {
    if (this.closed || this.ending) return false;
    if (reason === "completed") {
      try { fs.writeFileSync(path.join(this.dir, "normal-close"), String(Date.now())); } catch { /* Best-effort provenance. */ }
    } else if (reason === "user") {
      try { fs.writeFileSync(path.join(this.dir, "stopped-by-user"), String(Date.now())); } catch { /* Best-effort provenance. */ }
    }
    try { fs.writeFileSync(path.join(this.dir, "kill"), String(signal)); } catch { /* Stopped directly below. */ }
    if (!this.pid) {
      const ids = this.readIds();
      if (ids?.agent) this.pid = ids.agent;
    }
    if (this.pid && !this.restarted) {
      if (process.platform === "win32") killWindowsTrees([this.pid]);
      else { try { process.kill(-this.pid, signal); } catch { try { process.kill(this.pid, signal); } catch { /* It already ended. */ } } }
    }
    return true;
  }
  // This PenEcho lets go of the agent and leaves it working; another PenEcho can attach to it.
  detach() {
    if (this.closed || this.detached) return;
    this.detached = true;
    this.stop();
    try { this.stdin.destroy(); } catch { /* Already destroyed. */ }
    this.emit("detach");
  }
}

// spawn(command, args, options) for agents: the agent runs under a keeper in its own folder under `root`.
//   options.keepName  a readable name for the folder (the run's line and Work)
function createKeeper({ root, execPath = process.execPath }) {
  // The keep folders this process uses, for whoever has to find its kept agents again (a test process ends the ones it started).
  (globalThis[Symbol.for("penecho.keeper-roots")] ||= new Set()).add(root);
  function allocate(keepName = "run") {
    const name = `${String(keepName || "run").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 60)}-${Date.now().toString(36)}${crypto.randomBytes(4).toString("hex")}`;
    const dir = path.join(root, name);
    fs.mkdirSync(dir, { recursive:true, mode:0o700 });
    return dir;
  }
  return {
    root,
    allocate,
    discardUnstarted(dir) {
      if (fs.existsSync(path.join(dir, "claim.json")) || fs.existsSync(path.join(dir, "pid.json")) || fs.existsSync(path.join(dir, "exit.json"))) return;
      try { fs.rmSync(dir, { recursive:true, force:true }); } catch { /* Cleanup must not interrupt Work finalization. */ }
    },
    tryCancelLaunchClaim,
    spawn(command, args = [], options = {}) {
      const dir = options.dir || allocate(options.keepName);
      fs.mkdirSync(dir, { recursive:true, mode:0o700 });
      const env = { ...(options.env || process.env) };
      const needsElectronNode = Boolean(process.versions?.electron) && (command === execPath || command === process.execPath) && Array.isArray(args) && args.length > 0;
      const dropEnv = (env.ELECTRON_RUN_AS_NODE || needsElectronNode) ? [] : ["ELECTRON_RUN_AS_NODE"];
      // Write initial prompt input before spawning so a crash right after spawn never leaves a keeper waiting without its prompt.
      if (options.initialInput) fs.writeFileSync(path.join(dir, "input"), options.initialInput);
      if (options.closeInput) fs.writeFileSync(path.join(dir, "input-end"), "");
      const specTmp = path.join(dir, `spec.json.${process.pid}.tmp`);
      fs.writeFileSync(specTmp, JSON.stringify({ command, args, cwd:options.cwd || process.cwd(), dropEnv, ...(options.streamFilter ? { streamFilter:options.streamFilter } : {}) }));
      fs.renameSync(specTmp, path.join(dir, "spec.json"));
      const dirArg = `--dir-b64=${Buffer.from(dir, "utf8").toString("base64url")}`;
      const keeper = spawn(execPath, [KEEPER, dirArg], { cwd:options.cwd || process.cwd(), env:{ ...env, ELECTRON_RUN_AS_NODE:"1" }, stdio:"ignore", detached:true, windowsHide:true });
      if (keeper.pid) {
        try { fs.writeFileSync(path.join(dir, "pid.json"), JSON.stringify({ keeper:keeper.pid, agent:0 }), { flag:"wx" }); } catch { /* agent-keeper already wrote pid.json. */ }
      }
      keeper.on("error", error => { try { fs.writeFileSync(path.join(dir, "exit.json"), JSON.stringify({ code:-1, error:error.message, at:Date.now() })); } catch { /* The run says it could not start. */ } });
      keeper.unref();
      return new KeptChild(dir, { streamFilter:options.streamFilter });
    },
    // A kept agent a PenEcho before this one started, read on from `offsets`.
    attach(dir, offsets) { return new KeptChild(dir, { offsets, earlier:true }); },
    // Folders of runs read to their end, and of ended runs nobody will read any more (older than a week).
    sweep(keep = new Set()) {
      let names = []; try { names = fs.readdirSync(root); } catch { return; }
      for (const name of names) {
        const dir = path.join(root, name);
        if (keep.has(dir)) continue;
        try {
          const read = fs.existsSync(path.join(dir, "read")), old = Date.now() - fs.statSync(dir).mtimeMs > 7 * 24 * 3600 * 1000;
          if ((read || old) && fs.existsSync(path.join(dir, "exit.json"))) fs.rmSync(dir, { recursive:true, force:true });
        } catch { /* Tried again next time. */ }
      }
    },
  };
}

module.exports = { createKeeper, KeptChild, tryCancelLaunchClaim, KEEPER };
