"use strict";
// The keeper of one agent run. PenEcho starts it apart from itself (its own session, no terminal), and it starts the agent.
// Everything goes through files in its folder, so nothing is lost while no PenEcho is running:
//   out, err     raw durable output
//   input        words for the agent, appended by PenEcho; input-end once its input is to close
//   kill         asks for the agent to be stopped (its first line names the signal)
//   pid.json     the keeper's and the agent's process numbers
//   exit.json    how the agent ended, written once it has
// Stopping, restarting or losing PenEcho never reaches the agent (kept-child.js).
//   node agent-keeper.js --dir-b64=<base64url(folder)>  (or legacy <folder>)
//   the folder holds spec.json: { command, args, cwd, dropEnv }
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const crossSpawn = require("cross-spawn");

const rawDirArg = process.argv[2] || "";
const dir = rawDirArg.startsWith("--dir-b64=")
  ? Buffer.from(rawDirArg.slice("--dir-b64=".length), "base64url").toString("utf8")
  : rawDirArg;
const spec = JSON.parse(fs.readFileSync(path.join(dir, "spec.json"), "utf8"));
const at = name => path.join(dir, name);
// Windows will not replace a file while PenEcho reads it. That is over in a moment, so it is tried again: a keeper that stopped there left its agent unknown.
const HELD = new Set(["EPERM", "EACCES", "EBUSY"]), PAUSE = new Int32Array(new SharedArrayBuffer(4));
function replace(tmp, file) {
  for (let left = process.platform === "win32" ? 100 : 0; ; left--) {
    try { fs.renameSync(tmp, file); return; } catch (error) { if (!left || !HELD.has(error?.code)) throw error; }
    Atomics.wait(PAUSE, 0, 0, 20);
  }
}
const writeJson = (name, value) => { const file = at(name), tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`; fs.writeFileSync(tmp, JSON.stringify(value)); replace(tmp, file); };
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
function resolveExecutablePosix(command, envObj, cwd) {
  const cmd = String(command || "");
  if (!cmd) return { ok:false, error:"spawn ENOENT" };
  const check = full => {
    try {
      const st = fs.statSync(full);
      if (!st.isFile()) return "EACCES";
      fs.accessSync(full, fs.constants.X_OK);
      return "OK";
    } catch (error) { return error?.code || "ENOENT"; }
  };
  if (cmd.includes("/")) {
    const full = path.isAbsolute(cmd) ? cmd : path.resolve(cwd || process.cwd(), cmd);
    const status = check(full);
    return status === "OK" ? { ok:true, file:full } : { ok:false, error:`spawn ${cmd} ${status}` };
  }
  const pathVal = String(envObj.PATH || process.env.PATH || "");
  let sawAccess = false;
  for (const part of pathVal.split(path.delimiter)) {
    if (!part) continue;
    const full = path.join(part, cmd);
    const status = check(full);
    if (status === "OK") return { ok:true, file:full };
    if (status === "EACCES") sawAccess = true;
  }
  return { ok:false, error:`spawn ${cmd} ${sawAccess ? "EACCES" : "ENOENT"}` };
}
// The terminal PenEcho ran in is not this one's: nothing said to it reaches the agent.
for (const signal of ["SIGINT", "SIGHUP", "SIGQUIT"]) { try { process.on(signal, () => {}); } catch { /* Not on this system. */ } }

const env = { ...process.env };
for (const name of spec.dropEnv || []) delete env[name];
const out = fs.openSync(at("out"), "a"), err = fs.openSync(at("err"), "a");
let child = null, finished = false, read = 0, stopped = false;

const stdio = ["pipe", out, err];
const controlNames = new Set(["input", "input-end", "kill", "stopped-by-user", "launch-aborted"]);

function finish(result) {
  if (finished) return;
  finished = true;
  let outSize, errSize;
  try { outSize = fs.fstatSync(out).size; } catch {}
  try { errSize = fs.fstatSync(err).size; } catch {}
  try {
    writeJson("exit.json", {
      ...result,
      ...(Number.isInteger(outSize) && outSize >= 0 ? { outSize } : {}),
      ...(Number.isInteger(errSize) && errSize >= 0 ? { errSize } : {}),
      at:Date.now(),
    });
  } catch { /* Its folder is gone: nobody is left to read it. */ }
  setTimeout(() => process.exit(0), 50).unref();
}
function stop(signal = "SIGTERM") {
  if (!child?.pid || finished) return;
  if (process.platform === "win32") { try { spawnSync("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], { stdio:"ignore", windowsHide:true, shell:false }); } catch { /* It already ended. */ } return; }
  try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch { /* It already ended. */ } }
}
// Takes up what PenEcho wrote for the agent since the last look.
let orphaned = false;
function look() {
  if (finished || !child) return;
  // Its folder was removed (only ever after the agent ended, or with a test's temporary folder): nothing can read the agent or stop it any more.
  if (!fs.existsSync(dir)) {
    if (!orphaned) { orphaned = true; stop("SIGTERM"); setTimeout(() => { stop("SIGKILL"); process.exit(0); }, 5000); }
    return;
  }
  if (!stopped && fs.existsSync(at("kill"))) { stopped = true; let signal = "SIGTERM"; try { signal = fs.readFileSync(at("kill"), "utf8").trim() || signal; } catch { /* The usual one. */ } stop(signal); return; }
  if (child.stdin?.writableEnded) return;
  try {
    const fd = fs.openSync(at("input"), "r");
    try {
      const size = fs.fstatSync(fd).size;
      if (size > read) { const bytes = Buffer.alloc(size - read); const got = fs.readSync(fd, bytes, 0, bytes.length, read); read += got; if (got) child.stdin.write(bytes.subarray(0, got)); }
    } finally { fs.closeSync(fd); }
  } catch { /* Nothing for it yet. */ }
  if (fs.existsSync(at("input-end"))) {
    // input-end is written after the last words; they were read just above unless more came in between.
    let size = 0; try { size = fs.statSync(at("input")).size; } catch { /* No words at all. */ }
    if (size <= read) child.stdin.end();
  }
}

// Atomically claim the right to execute this launch before spawning the child (temp + linkSync avoids any 0-byte claim window).
// If restart recovery already claimed/cancelled this spec-only directory via `claim.json`, exit without spawning.
function acquireClaim() {
  const file = at("claim.json");
  const payload = JSON.stringify({ owner:"keeper", keeper:process.pid, at:Date.now() });
  try {
    if (createExclusiveFile(file, payload, 0o600)) return true;
    try {
      const existing = JSON.parse(fs.readFileSync(file, "utf8"));
      return existing?.owner === "keeper" && Number(existing.keeper) === process.pid;
    } catch { return false; }
  } catch { return false; }
}

if (!acquireClaim() || fs.existsSync(at("launch-aborted"))) {
  writeJson("pid.json", { keeper:process.pid, agent:0, command:spec.command, at:Date.now() });
  finish({ code:1, signal:"SIGTERM", cancelled:true });
} else if (fs.existsSync(at("kill")) || fs.existsSync(at("stopped-by-user"))) {
  let signal = "SIGTERM";
  try { signal = fs.readFileSync(at("kill"), "utf8").trim() || signal; } catch { /* The usual one. */ }
  writeJson("pid.json", { keeper:process.pid, agent:0, command:spec.command, at:Date.now() });
  finish({ code:1, signal });
} else {
  try {
    if (process.platform !== "win32") {
      // Resolve executable upfront so ENOENT/EACCES matches direct spawn, then publish pid.json atomically from the
      // child PID itself and check launch-aborted/kill BEFORE `exec "$@"` (eliminating any spawn -> pid.json gap).
      const resolved = resolveExecutablePosix(spec.command, env, spec.cwd);
      if (!resolved.ok) {
        writeJson("pid.json", { keeper:process.pid, agent:0, command:spec.command, at:Date.now() });
        finish({ code:-1, error:resolved.error });
      } else {
        const mvBin = ["/bin/mv", "/usr/bin/mv"].find(p => fs.existsSync(p)) || "mv";
        const preExecScript = 'tmp="$1.$$.tmp"; printf \'{"keeper":%s,"agent":%s,"command":%s,"at":%s}\n\' "$2" "$$" "$3" "$4" > "$tmp" && "$6" -f "$tmp" "$1" || exit 1; if [ -f "$5/launch-aborted" ] || [ -f "$5/stopped-by-user" ] || [ -f "$5/kill" ]; then exit 143; fi; shift 6; exec "$@"';
        const args = [
          "-c", preExecScript, "_",
          at("pid.json"),
          String(process.pid),
          JSON.stringify(String(spec.command || "")),
          String(Date.now()),
          dir,
          mvBin,
          resolved.file,
          ...(spec.args || []),
        ];
        child = crossSpawn("/bin/sh", args, { cwd:spec.cwd, env, stdio, detached:true, windowsHide:true });
      }
    } else {
      child = crossSpawn(spec.command, spec.args || [], { cwd:spec.cwd, env, stdio, detached:false, windowsHide:true });
    }
  } catch (error) { writeJson("pid.json", { keeper:process.pid, agent:0, command:spec.command, at:Date.now() }); finish({ code:-1, error:error.message }); }
}
if (child) {
  child.stdin?.on("error", () => {});
  child.on("error", error => finish({ code:-1, error:error.message }));
  child.on("exit", (code, signal) => finish({ code:code ?? (signal ? 1 : 0), signal:signal || null }));
  writeJson("pid.json", { keeper:process.pid, agent:child.pid || 0, command:spec.command, at:Date.now() });
  look();
  setInterval(look, 250);
  try {
    fs.watch(dir, (_event, filename) => {
      if (!filename || controlNames.has(path.basename(String(filename)))) look();
    }).on("error", () => {});
  } catch { /* The timer looks on its own. */ }
}
