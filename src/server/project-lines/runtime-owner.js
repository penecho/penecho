"use strict";
// Which PenEcho runs the Lines of a state folder (watching, recovery, carrying on, imports) is decided by a local socket that the
// operating system holds for that PenEcho. It goes when the process goes, however it goes (Ctrl-C, a crash, a forced quit, a restart
// of the computer), so nothing can be left behind that keeps PenEcho out, and a reused process number or a new computer name
// cannot pass for a running PenEcho. A PenEcho that is running answers on it with where it can be opened.
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

// Sockets this process holds, so a second ask from inside it is answered at once (it cannot answer its own probe while waiting for it).
const held = new Map();
const PROBE_TIMEOUT_MS = 1500;
const SQLITE_BUSY = 5;

function realDirectory(directory) {
  try { return fs.realpathSync(directory); } catch { return path.resolve(directory); }
}
// Unix socket paths are limited to about 104 bytes; a deep folder gets a fixed short path from the folder's name instead.
function socketPath(directory) {
  const real = realDirectory(directory);
  const id = crypto.createHash("sha256").update(process.platform === "win32" ? real.toLowerCase() : real).digest("hex").slice(0, 24);
  if (process.platform === "win32") return `\\\\.\\pipe\\penecho-lines-${id}`;
  const near = path.join(real, "runtime.sock");
  return Buffer.byteLength(near) <= 100 ? near : path.join("/tmp", `penecho-lines-${id}.sock`);
}

// Asks the socket, from a short separate process because the runtime is claimed synchronously.
//   { alive:false }               nobody holds it (a file left by a process that ended)
//   { alive:true, owner:{...} }   a PenEcho holds it; owner is what it says about itself ({} if it could not answer in time)
const PROBE = `
const s = require("node:net").connect(process.argv[1]); let text = "";
const done = (alive, owner) => { process.stdout.write(JSON.stringify({ alive, owner })); process.exit(0); };
s.setEncoding("utf8");
s.on("data", d => { text += d; if (text.includes("\\n")) { try { done(true, JSON.parse(text)); } catch { done(true, {}); } } });
s.on("error", e => done(!["ECONNREFUSED", "ENOENT"].includes(e.code), {}));
s.on("end", () => { try { done(true, JSON.parse(text)); } catch { done(true, {}); } });
setTimeout(() => done(true, {}), ${PROBE_TIMEOUT_MS});
`;
function probe(file) {
  const answer = spawnSync(process.execPath, ["-e", PROBE, file], { encoding:"utf8", timeout:PROBE_TIMEOUT_MS + 3000, env:{ ...process.env, ELECTRON_RUN_AS_NODE:"1" }, windowsHide:true });
  try { return JSON.parse(answer.stdout); } catch { return { alive:true, owner:{} }; }
}

function listen(file, describe) {
  const server = net.createServer(socket => {
    let info = {};
    try { info = describe() || {}; } catch { /* It says only that it is there. */ }
    socket.on("error", () => {});
    socket.end(`${JSON.stringify({ pid:process.pid, ...info })}\n`);
  });
  // A refused bind is also reported later as an event; it is already handled here.
  server.on("error", () => {});
  server.listen(file);
  if (!server.listening) return null;
  server.unref();
  return server;
}

function claimUnixSocket(directory, file, describe) {
  const { DatabaseSync } = require("./sqlite.js").requireSqlite();
  // Use SQLite's OS-backed writer lock without writing a transaction. Keep the database inode:
  // unlinking it would let another process lock a different inode. The OS releases locks on exit.
  const guard = new DatabaseSync(path.join(directory, "runtime-lock.sqlite"));
  try {
    try { guard.exec("BEGIN IMMEDIATE"); }
    catch (error) {
      // Extended SQLite result codes keep the primary code in the low byte.
      if (error.code !== "ERR_SQLITE_ERROR" || (error.errcode & 0xff) !== SQLITE_BUSY) throw error;
      return { owner:probe(file).owner || {} };
    }
    let server = listen(file, describe);
    if (server) return { server };
    const seen = probe(file);
    if (seen.alive) return { owner:seen.owner || {} };
    try { fs.unlinkSync(file); } catch (error) { if (error.code !== "ENOENT") throw error; }
    server = listen(file, describe);
    return server ? { server } : { owner:probe(file).owner || {} };
  } finally { guard.close(); }
}

// Takes the Lines of `directory` for this process if no running PenEcho holds them.
//   { release }      this process runs them until release() (or until it ends)
//   { owner }        another PenEcho runs them; owner is what it said ({ pid, port } when it could answer)
function acquire(directory, describe = () => ({})) {
  // The folder is made first: its real path names the socket, and a link in the path must give the same name every time.
  fs.mkdirSync(directory, { recursive:true });
  const file = socketPath(directory);
  if (held.has(file)) return { owner:held.get(file)() };
  const { server, owner } = process.platform === "win32"
    ? { server:listen(file, describe) }
    : claimUnixSocket(directory, file, describe);
  if (!server) return { owner:owner ?? (probe(file).owner || {}) };
  let released = false;
  held.set(file, () => { try { return { pid:process.pid, ...(describe() || {}) }; } catch { return { pid:process.pid }; } });
  return { release:() => { if (released) return; released = true; held.delete(file); server.close(); } };
}

// Whether something on this computer accepts connections on a port: an older PenEcho is counted only while it really serves.
function portAnswers(port) {
  if (!(Number(port) > 0)) return false;
  const answer = spawnSync(process.execPath, ["-e", `
    const s = require("node:net").connect({ port:Number(process.argv[1]), host:"127.0.0.1" });
    s.on("connect", () => { process.stdout.write("yes"); process.exit(0); });
    s.on("error", () => process.exit(0));
    setTimeout(() => process.exit(0), ${PROBE_TIMEOUT_MS});
  `, String(port)], { encoding:"utf8", timeout:PROBE_TIMEOUT_MS + 3000, env:{ ...process.env, ELECTRON_RUN_AS_NODE:"1" }, windowsHide:true });
  // A probe that could not run says nothing either way: the older PenEcho is assumed to be there, as before.
  return answer.error ? true : answer.stdout === "yes";
}

module.exports = { acquire, socketPath, probe, portAnswers };
