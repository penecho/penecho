"use strict";
// Test-only safety for the test process that loads it. Every test file loads it first, or test/helpers/dom.js, which loads
// it (test/test-safety.test.js checks); PenEcho itself never does. PE-927:
// 1. A failing assert never prints a huge value. Node's assert prints both sides with util.inspect at depth 1000, ignoring
//    util.inspect.custom, then diffs the lines with a diff that keeps a copy of its whole state per step: one linkedom node
//    (it drags in its document) grew a worker by ~5 GB/s until macOS ran out of memory, and --test-timeout cannot stop one
//    synchronous call. A failing comparison of big values is told in a short message instead; small ones keep Node's diff.
// 2. A test process whose runner is gone (killed by `timeout`, an alarm or Ctrl-C) ends itself within a second.
// 3. Processes the test process started (servers, agents, and their keepers, which are detached on purpose so real agents
//    outlive PenEcho) are ended when it ends, for any reason.
// 4. Node 22 ends a test file, and cancels the rest of it, once a test waits only for something unref'd (a worker that reads a
//    database); later Nodes wait. So a running test keeps the event loop going, for a minute at most.
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const util = require("node:util");
const { execFileSync } = require("node:child_process");

const KEY = Symbol.for("penecho.test-safety");
if (!globalThis[KEY]) globalThis[KEY] = install();
module.exports = globalThis[KEY];

function install() {
  // Values for which a short message is always better than Node's full print (dom.js adds linkedom nodes).
  const alwaysShort = [];
  // About how many lines Node may print per side before its diff costs more than a few tens of MB.
  const LINES = 500;
  function small(root) {
    let left = LINES;
    const seen = new Set(), stack = [root];
    try {
      while (stack.length) {
        const value = stack.pop();
        if (--left < 0) return false;
        if (typeof value === "string") { left -= Math.floor(value.length / 200) + (value.match(/\n/g) || []).length; continue; }
        if (value === null || (typeof value !== "object" && typeof value !== "function") || seen.has(value)) continue;
        seen.add(value);
        if (alwaysShort.some(test => test(value))) return false;
        if (ArrayBuffer.isView(value)) { left -= value.length ?? value.byteLength; continue; }
        if (Array.isArray(value) && value.length > left) return false;
        if (value instanceof Error) left -= String(value.stack || "").split("\n").length;
        if (value instanceof Map || value instanceof Set) {
          if (value.size > left) return false;
          for (const entry of value) stack.push(entry);
        }
        for (const key of Reflect.ownKeys(value)) {
          const field = Object.getOwnPropertyDescriptor(value, key);
          if (!field?.enumerable) continue;
          if (--left < 0) return false;
          if (!field.get) stack.push(field.value);
        }
      }
    } catch { return false; }
    return left >= 0;
  }
  const clip = text => text.length > 1500 ? `${text.slice(0, 1500)}… (${text.length} characters)` : text;
  const show = value => clip(util.inspect(value, { depth:2, maxArrayLength:20, maxStringLength:300, breakLength:100 }));
  // An Error as the message makes assert throw it as it is, so a failure is known before Node prints anything.
  const SENTINEL = new Error("penecho.test-safety probe");
  const NAMES = ["equal", "notEqual", "strictEqual", "notStrictEqual", "deepEqual", "notDeepEqual", "deepStrictEqual", "notDeepStrictEqual", "partialDeepStrictEqual"];
  function guard(target, name) {
    const original = target?.[name];
    if (typeof original !== "function" || original[KEY]) return;
    const guarded = function (actual, expected, ...message) {
      if (arguments.length < 2 || message[0] instanceof Error) return Reflect.apply(original, this, arguments);
      try { Reflect.apply(original, this, [actual, expected, SENTINEL]); return; }
      catch (error) { if (error !== SENTINEL) throw error; }
      if (small(actual) && small(expected)) return Reflect.apply(original, this, arguments);
      const said = message.length ? `${util.format(...message)}\n\n` : "";
      const error = new assert.AssertionError({ message:`${said}assert.${name} failed (values too big for a full diff):\n\nactual: ${show(actual)}\n\nexpected: ${show(expected)}`, operator:"fail", stackStartFn:guarded });
      Object.assign(error, { actual:show(actual), expected:show(expected), operator:name });
      throw error;
    };
    Object.defineProperty(guarded, "name", { value:name });
    guarded[KEY] = true;
    target[name] = guarded;
  }
  for (const target of [assert, assert.strict]) for (const name of NAMES) guard(target, name);

  // Processes started by this one: its descendants, and the keepers and agents written in the keep folders it used.
  // kept-child.js notes each keep folder a process uses in KEEP_ROOTS.
  const loadedAt = Date.now(), keepRoots = new Set(), KEEP_ROOTS = Symbol.for("penecho.keeper-roots");
  // Only a keep folder this test made. A person's own PenEcho keeps real agents in ~/.penecho, in a state folder far older
  // than any test process: a test that opened it by mistake must never end them.
  function ownsKeepRoot(root, since = loadedAt - 2000) {
    try {
      const real = fs.realpathSync(root), state = fs.statSync(path.dirname(real)), born = state.birthtimeMs;
      let home = ""; try { home = fs.realpathSync(path.join(os.userInfo().homedir, ".penecho")); } catch { /* No PenEcho of their own. */ }
      if (home && (real === home || real.startsWith(home + path.sep))) return false;
      return born > 0 && born >= since;
    } catch { return false; }
  }
  function table() {
    const rows = new Map();
    const out = execFileSync("ps", ["-A", "-o", "pid=,ppid=,lstart="], { encoding:"utf8", env:{ ...process.env, LC_ALL:"C" }, stdio:["ignore", "pipe", "ignore"], timeout:5000 });
    for (const line of out.split("\n")) {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/);
      if (match) rows.set(Number(match[1]), { ppid:Number(match[2]), started:Date.parse(match[3]) });
    }
    return rows;
  }
  function doomed(rows, found = new Set()) {
    const kids = new Map();
    for (const [pid, row] of rows) { if (!kids.has(row.ppid)) kids.set(row.ppid, []); kids.get(row.ppid).push(pid); }
    const roots = [process.pid];
    for (const root of new Set([...keepRoots, ...(globalThis[KEEP_ROOTS] || [])])) {
      if (!ownsKeepRoot(root)) continue;
      let names = []; try { names = fs.readdirSync(root); } catch { continue; }
      for (const name of names) {
        let ids = {}; try { ids = JSON.parse(fs.readFileSync(path.join(root, name, "pid.json"), "utf8")); } catch { continue; }
        // Only a process started after this one: a pid number used again since is never someone else's.
        for (const pid of [ids.keeper, ids.agent].map(Number)) if (rows.get(pid)?.started >= loadedAt - 2000) roots.push(pid);
      }
    }
    while (roots.length) {
      const pid = roots.pop();
      if (pid !== process.pid) { if (found.has(pid)) continue; found.add(pid); }
      roots.push(...(kids.get(pid) || []));
    }
    return found;
  }
  let ended = false;
  function endStarted() {
    if (ended || process.platform === "win32") return;
    ended = true;
    try {
      // Stopped first so none of them starts another process meanwhile, then looked for once more, then ended.
      const first = doomed(table());
      if (!first.size) return;
      for (const pid of first) try { process.kill(pid, "SIGSTOP"); } catch { /* Already gone. */ }
      for (const pid of doomed(table(), first)) try { process.kill(pid, "SIGKILL"); } catch { /* Already gone. */ }
    } catch { /* ps is missing or failed: nothing more can be done here. */ }
  }
  process.on("exit", endStarted);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGALRM", "SIGQUIT"]) {
    // When node:test handles the signal it ends the process itself ("exit" above); else end the way the signal would have.
    const onSignal = () => {
      if (process.listenerCount(signal) > 1) return;
      endStarted();
      process.removeListener(signal, onSignal);
      process.kill(process.pid, signal);
    };
    process.on(signal, onSignal);
  }
  const parent = process.ppid;
  setInterval(() => { if (process.ppid !== parent) { endStarted(); process.exit(1); } }, 1000).unref();

  if (/\.test\.[cm]?js$/.test(process.argv[1] || "")) {
    const { beforeEach, afterEach } = require("node:test");
    let running = 0, since = 0;
    const hold = setInterval(() => { if (Date.now() - since > 60000) hold.unref(); }, 1000).unref();
    beforeEach(() => { running++; since = Date.now(); hold.ref(); });
    afterEach(() => { if (--running <= 0) hold.unref(); });
  }

  return {
    // Values matching `test` are always told in the short message.
    shortWhen(test) { alwaysShort.push(test); },
    // Keepers and agents in `root` (a Lines keep folder) started while this process ran are ended with it.
    watchKeepers(root) { if (root) keepRoots.add(root); },
    ownsKeepRoot,
    endStarted,
  };
}
