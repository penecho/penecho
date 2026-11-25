"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createLink } = require("../src/server/desktop-link.js");

// Runs the PenEcho server in its own process and keeps it running. The same program, run as Node, so macOS and Windows see the app
// they already know: the same firewall rule, the same answers about folders. Agents run under keepers of their own and go on through a restart.
// Electron takes its language (sorting, dates) from the system; run as Node it takes it from LC_ALL, which server-entry.js takes away again.
const ENTRY = path.join(__dirname, "server-entry.js");
const START_MS = 60_000, STOP_MS = 6_000, RESTARTS_MOST = 3, RESTARTS_WITHIN_MS = 60_000, RESTART_AFTER_MS = 300;
const LOG_MAX_BYTES = 262_144;

function openLog(file) {
  if (!file) return null;
  try {
    fs.mkdirSync(path.dirname(file), { recursive:true });
    let flags = "a";
    try { if (fs.statSync(file).size > LOG_MAX_BYTES) flags = "w"; } catch { /* Not written yet. */ }
    return fs.openSync(file, flags, 0o600);
  } catch { return null; }
}

/**
 * settings() gives the environment its settings make, read again for each start after a crash: they may have changed since.
 * attach(link) gives each new server process its answers from the window's process.
 * onUp({ port, host, networkAccess, again }) hears that it listens; again is true after a restart.
 * onEnded() hears that it was asked to stop by something other than stop() (penecho stop, a signal).
 * onFailed(error) hears that it keeps ending and is not started again; again() tries once more.
 */
function createServerProcess({
  execPath = process.execPath, entry = ENTRY, env = process.env, inheritOutput = false, logFile = "",
  locale = Intl.DateTimeFormat().resolvedOptions().locale, platform = process.platform,
  settings = () => ({}), attach = () => {}, onUp = () => {}, onEnded = () => {}, onFailed = () => {},
  spawnImpl = spawn, now = Date.now, startMs = START_MS, stopMs = STOP_MS, restartAfterMs = RESTART_AFTER_MS,
  restartsMost = RESTARTS_MOST, restartsWithinMs = RESTARTS_WITHIN_MS,
} = {}) {
  const restarts = [];
  let current = null, port = null, stopping = null, restartTimer = null;

  function launch() {
    const log = inheritOutput ? null : openLog(logFile);
    let child;
    try {
      child = spawnImpl(execPath, [entry], {
        env:{ ...env, ELECTRON_RUN_AS_NODE:"1", ...(platform === "win32" ? {} : { LC_ALL:`${locale.replaceAll("-", "_")}.UTF-8` }) }, serialization:"advanced", windowsHide:true,
        stdio:["ignore", inheritOutput ? "inherit" : "ignore", inheritOutput ? "inherit" : log ?? "ignore", "ipc"],
      });
    } finally { if (log !== null) try { fs.closeSync(log); } catch { /* The process holds its own. */ } }
    const link = createLink({ send:(message, callback) => child.send(message, callback) });
    const run = { child, link, up:false, ended:false };
    run.exited = new Promise(resolve => {
      const end = (code, signal, error = null) => {
        if (run.ended) return;
        run.ended = true;
        link.close();
        resolve({ code, signal, error });
        ended(run, { code, signal });
      };
      child.once("exit", (code, signal) => end(code, signal));
      child.on("error", error => { if (child.pid === undefined) end(null, null, error); });
    });
    child.on("message", message => link.receive(message));
    child.once("disconnect", () => link.close());
    attach(link);
    current = run;
    return run;
  }

  async function begin(again) {
    clearTimeout(restartTimer);
    const run = launch();
    let timer, info;
    try {
      // It goes over the channel, not into the command's environment, which other programs can list.
      // Started again, it serves the address the window already shows.
      const configuration = { ...settings(), ...(again && port !== null ? { PORT:String(port) } : {}) };
      info = await Promise.race([
        // The channel closes just before the process ends: how it ended says more.
        run.link.request("start", { env:configuration }).catch(error => { if (error.code !== "DESKTOP_LINK_CLOSED") throw error; return run.exited.then(gone); }),
        run.exited.then(gone),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("PenEcho server did not become ready.")), startMs); }),
      ]);
      run.up = true;
      port = info.port;
    } catch (error) {
      if (!run.ended) kill(run);
      throw error;
    } finally { clearTimeout(timer); }
    onUp({ ...info, again });
    return info;
  }
  function gone({ error, code, signal }) {
    throw error || new Error(`PenEcho's server ended while starting (${signal || `code ${code}`}).${logFile && !inheritOutput ? ` See ${logFile}` : ""}`);
  }
  // Ended on its own: asked to from outside, it stays ended; anything else is started again, unless it keeps ending.
  function ended(run, { code, signal }) {
    if (current === run) current = null;
    if (stopping || !run.up) return;
    if (code === 0 || code === 130 || code === 143 || ["SIGTERM", "SIGINT", "SIGHUP"].includes(signal)) { onEnded(); return; }
    restart(new Error(`PenEcho's server ended unexpectedly (${signal || `code ${code}`}).`));
  }
  function restart(error) {
    const at = now();
    while (restarts.length && at - restarts[0] > restartsWithinMs) restarts.shift();
    if (restarts.length >= restartsMost) { restarts.length = 0; onFailed(error); return; }
    restarts.push(at);
    restartTimer = setTimeout(() => {
      restartTimer = null;
      if (!stopping) begin(true).catch(failure => { if (!stopping) restart(failure); });
    }, restartAfterMs);
  }
  function kill(run) { try { run.child.kill("SIGKILL"); } catch { /* It has already ended. */ } }

  return {
    start:() => begin(false),
    again() { return !current && !stopping ? begin(true) : Promise.reject(new Error("PenEcho's server cannot be started again.")); },
    request:(method, params, options) => (current?.up ? current.link.request(method, params, options) : Promise.reject(Object.assign(new Error("PenEcho's server is not running."), { code:"SERVER_NOT_RUNNING" }))),
    listening:() => Boolean(current?.up && !stopping),
    running:() => Boolean(current),
    pid:() => current?.child.pid || 0,
    // Resolves once the process has gone: asked first, and ended for it when it does not answer in time.
    stop() {
      if (stopping) return stopping;
      clearTimeout(restartTimer);
      const run = current;
      if (!run) return (stopping = Promise.resolve());
      run.link.request("stop").catch(() => {});
      const force = setTimeout(() => kill(run), stopMs);
      return (stopping = run.exited.then(() => { clearTimeout(force); }));
    },
  };
}

module.exports = { createServerProcess, ENTRY, RESTARTS_MOST, RESTARTS_WITHIN_MS };
