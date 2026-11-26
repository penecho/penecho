"use strict";
// A run PenEcho started can be held open after its agent is done (PE-487, PE-499): a command it left in the background never ends, so the agent never exits,
// or never even sends its result. Nobody should have to notice that. This looks at each run once a minute and puts it right by itself:
// first the commands the agent left behind are stopped (the agent then ends its turn as usual), and only if it still does not end is the agent stopped too.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const Windows = require("./windows-processes.js");
const { antigravityTranscript } = require("./antigravity-sessions.js");

const CHECK_MS = 60000;
// The agent has given its answer (result, or its own record says so) and nothing it started has done any work for this long: what is left is not work.
const DONE_IDLE_MS = 10 * 60000;
// The agent has said nothing for this long: its own record is read to see whether it is done.
const QUIET_MS = 10 * 60000;
// Not a word and no work at all for this long: stuck. Long builds and tests use the processor, so they are never taken for this.
const STUCK_MS = 30 * 60000;
// After its left-over commands are stopped, the agent has this long to end on its own.
const END_MS = 60000;
// Less processor time than this in a minute, for the agent and everything it started together, is idle. An idle agent and browser use well under a second.
const IDLE_CPU_MS = 1500;

const run = (file, args, timeout = 15000) => new Promise(resolve => {
  execFile(file, args, { timeout, maxBuffer:16 * 1024 * 1024, windowsHide:true }, (error, stdout) => resolve(error ? null : String(stdout)));
});
// Every process on the computer: its parent and the processor time it has used, in milliseconds.
async function processTable() {
  if (process.platform === "win32") return Windows.list();
  const out = await run("ps", ["-A", "-o", "pid=,ppid=,time="]);
  if (out === null) return null;
  return out.split("\n").map(l => l.trim().split(/\s+/)).filter(p => p.length >= 3).map(([pid, ppid, time]) => ({ pid:Number(pid), ppid:Number(ppid), cpu:cpuMs(time) })).filter(p => p.pid > 0);
}
// ps time: [[dd-]hh:]mm:ss[.cc]
function cpuMs(time) {
  const [days, rest] = String(time).includes("-") ? String(time).split("-") : ["0", String(time)];
  const parts = rest.split(":").map(Number);
  while (parts.length < 3) parts.unshift(0);
  const [h, m, s] = parts;
  return Number.isFinite(h + m + s) ? ((Number(days) || 0) * 86400 + h * 3600 + m * 60 + s) * 1000 : 0;
}
// The agent's process and everything under it, deepest last, with their processor time added up.
// Windows keeps naming a parent that has ended, and the agent can have that number by now: a process older than it is not one it started.
function treeOf(table, root) {
  const kids = new Map(), born = new Map(table.map(p => [p.pid, p.startedAt || 0]));
  for (const p of table) {
    if (p.startedAt && p.startedAt < born.get(p.ppid)) continue;
    if (!kids.has(p.ppid)) kids.set(p.ppid, []); kids.get(p.ppid).push(p);
  }
  const self = table.find(p => p.pid === root);
  if (!self) return null;
  const below = [], queue = [root];
  while (queue.length) for (const p of kids.get(queue.shift()) || []) { if (p.pid !== root && !below.some(b => b.pid === p.pid)) { below.push(p); queue.push(p.pid); } }
  return { below:below.map(p => p.pid), cpu:self.cpu + below.reduce((n, p) => n + p.cpu, 0) };
}
const signal = (pid, sig) => { try { process.kill(pid, sig); return true; } catch { return false; } };
const isPidAlive = pid => {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try { process.kill(n, 0); return true; } catch (error) { return error?.code === "EPERM"; }
};
// Read process metadata (pgid, start time, command) to validate process ownership before signaling recovered PIDs.
function processMeta(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return null;
  if (process.platform === "win32") return Windows.meta(n);
  try {
    const out = require("node:child_process").execFileSync("ps", ["-ww", "-o", "pid=,ppid=,pgid=,stat=,lstart=,command=", "-p", String(n)], { encoding:"utf8", timeout:2000, env:{ ...process.env, LC_ALL:"C" } });
    // Preserve trailing whitespace on `command=` so an extra empty trailing argv element stays distinguishable.
    const line = out.split(/\r?\n/).map(s => s.trimStart()).find(Boolean);
    if (!line) return null;
    // lstart format: "Thu Nov 20 10:15:27 2026" or "Fri 20 Nov 11:29:51 2026"
    const m = /^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+\s+(?:\S+\s+\d+|\d+\s+\S+)\s+\d+:\d+:\d+\s+\d{4})\s*(.*)$/.exec(line);
    if (!m) return null;
    let argv = null;
    if (process.platform === "linux") {
      try {
        const raw = fs.readFileSync(`/proc/${n}/cmdline`);
        if (raw.length > 0) {
          const parts = raw.toString("utf8").split("\0");
          if (parts.length && parts[parts.length - 1] === "") parts.pop();
          if (parts.length) argv = parts;
        }
      } catch { /* Proc cmdline unavailable; fall back to flat ps command. */ }
    }
    return { pid:+m[1], ppid:+m[2], pgid:+m[3], zombie:/^Z/.test(m[4]), startedAt:Date.parse(m[5]) || 0, command:m[6] || "", ...(argv ? { argv } : {}) };
  } catch { return null; }
}
// Stops these processes: asked first, made to five seconds later. Windows ends each with all it started.
function stopAll(pids, { canSignal = null } = {}) {
  if (!pids.length) return;
  if (canSignal && !canSignal()) return;
  if (process.platform === "win32") { Windows.killWindowsTrees(pids); return; }
  for (const pid of pids) signal(pid, "SIGTERM");
  setTimeout(() => { if (canSignal && !canSignal()) return; for (const pid of pids) signal(pid, "SIGKILL"); }, 5000).unref?.();
}
// What a run left running, then the run itself: the list is taken while the agent is still there, because what it started is nobody's child once it is gone.
async function stopTree(child, { keepRoot = false, canSignal = null } = {}) {
  if (canSignal && !canSignal()) return 0;
  const pid = child?.pid;
  if (!pid) { if (!keepRoot && (!canSignal || canSignal())) try { child?.kill(); } catch { /* It already ended. */ } return 0; }
  const table = await processTable(), tree = table && treeOf(table, pid);
  if (canSignal && !canSignal()) return 0;
  const below = tree ? tree.below : [];
  stopAll(below.reverse(), { canSignal });
  if (!keepRoot && (!canSignal || canSignal())) { if (process.platform === "win32") stopAll([pid], { canSignal }); else try { child.kill(); } catch { /* It already ended. */ } }
  return below.length;
}
// Capture process trees and per-PID metadata for multiple root PIDs in ONE snapshot BEFORE any kill signal is sent.
// Returns `{ ok, trees }` where `ok === false` means process enumeration failed and callers MUST fail closed.
async function captureTrees(rootPids = [], { processTable:tableFn = null } = {}) {
  const roots = [...new Set(rootPids.map(Number).filter(n => Number.isInteger(n) && n > 0))];
  const trees = new Map();
  if (!roots.length) return { ok:true, trees };
  const table = await (tableFn || RunWatchApi.processTable)();
  const ok = Array.isArray(table);
  for (const root of roots) {
    const tree = ok ? treeOf(table, root) : null;
    const pids = [root, ...(tree ? tree.below : [])];
    const procs = [];
    for (const pid of pids) {
      const meta = RunWatchApi.processMeta(pid);
      if (meta && !meta.zombie) procs.push({ pid:meta.pid, pgid:meta.pgid, startedAt:meta.startedAt, command:meta.command, ...(Array.isArray(meta.argv) ? { argv:meta.argv } : {}) });
    }
    trees.set(root, { pids, procs, rootFound:Boolean(tree) });
  }
  return { ok, trees };
}
// Stop a managed run and wait until its root process and descendants actually exit, escalating to SIGKILL after graceMs.
async function stopTreeAndWait(child, { graceMs = 2500, killMs = 500, extraPids = [], onTracked = null, preCaptured = false, processTable:tableFn = null } = {}) {
  const readKeeperIds = () => {
    if (!child?.dir) return null;
    try { return JSON.parse(fs.readFileSync(path.join(child.dir, "pid.json"), "utf8")); } catch { return null; }
  };
  const ids0 = readKeeperIds();
  const rootPid = child?.pid || Number(ids0?.agent) || 0;
  const tracked = new Set(extraPids.map(Number).filter(n => n > 0));
  if (rootPid > 0) tracked.add(rootPid);
  // Capture current descendants and root process-group leadership BEFORE writing `kill` so the root does not exit before ancestry is enumerated.
  let below = [], rootPgid = 0;
  if (rootPid > 0) {
    const table = await (tableFn || RunWatchApi.processTable)();
    if (!Array.isArray(table) && !preCaptured) {
      onTracked?.([...tracked]);
      return { stopped:false, remaining:[...tracked], discoveryFailed:true };
    }
    const tree = Array.isArray(table) ? treeOf(table, rootPid) : null;
    below = tree ? tree.below : [];
    for (const p of below) tracked.add(p);
    if (process.platform !== "win32" && rootPid !== process.pid) {
      const rm = RunWatchApi.processMeta(rootPid), selfMeta = RunWatchApi.processMeta(process.pid);
      if (rm && !rm.zombie && rm.pgid === rootPid && (!selfMeta || rm.pgid !== selfMeta.pgid)) rootPgid = rootPid;
    }
  }
  onTracked?.([...tracked]);
  if (child?.dir) { try { fs.writeFileSync(path.join(child.dir, "kill"), "SIGTERM"); } catch { /* Best-effort. */ } }
  const toSignalDesc = [...new Set([...below.reverse(), ...extraPids.map(Number).filter(n => n > 0 && n !== rootPid)])];
  if (process.platform !== "win32") for (const p of toSignalDesc) signal(p, "SIGTERM");
  if (process.platform === "win32") {
    await Windows.killWindowsTrees([...toSignalDesc, ...tracked]);
    try { child?.kill?.("SIGTERM"); } catch {}
  } else {
    try { child?.kill?.("SIGTERM"); } catch {}
    if (rootPgid > 0) signal(-rootPgid, "SIGTERM");
    for (const p of tracked) signal(p, "SIGTERM");
  }
  const liveNow = (checkZombie = false) => {
    const ids = readKeeperIds();
    if (Number(ids?.agent) > 0) tracked.add(Number(ids.agent));
    if (child?.pid > 0) tracked.add(child.pid);
    return [...tracked].filter(p => {
      if (!isPidAlive(p)) return false;
      if (checkZombie && process.platform !== "win32") {
        const meta = processMeta(p);
        if (meta?.zombie) return false;
      }
      return true;
    });
  };
  const waitGone = async ms => {
    const end = Date.now() + Math.max(0, ms);
    for (;;) {
      const rem = liveNow(false);
      if (!rem.length) return [];
      if (Date.now() >= end) return liveNow(true);
      await new Promise(r => setTimeout(r, 25));
    }
  };
  let remaining = await waitGone(graceMs);
  if (remaining.length) {
    if (child?.dir) { try { fs.writeFileSync(path.join(child.dir, "kill"), "SIGKILL"); } catch { /* Best-effort. */ } }
    if (process.platform === "win32") {
      await Windows.killWindowsTrees(remaining);
    } else {
      try { child?.kill?.("SIGKILL"); } catch {}
      if (rootPgid > 0) signal(-rootPgid, "SIGKILL");
      for (const p of remaining) {
        const meta = processMeta(p);
        if (meta && meta.pgid === p) signal(-p, "SIGKILL");
        signal(p, "SIGKILL");
      }
    }
    remaining = await waitGone(killMs);
  }
  return { stopped:remaining.length === 0, remaining };
}

// ---------- The agent's own record ----------
// Read from the end only: these files can be large.
function lastRows(file, bytes = 256 * 1024, { maxSize = null } = {}) {
  let fd; try { fd = fs.openSync(file, "r"); } catch { return []; }
  try {
    let size = fs.fstatSync(fd).size;
    if (Number.isInteger(maxSize) && maxSize >= 0) size = Math.min(size, maxSize);
    const start = Math.max(0, size - bytes), buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString("utf8").split("\n");
    if (start) lines.shift();
    return lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; } finally { fs.closeSync(fd); }
}
function isAgyTurnStart(row) {
  return Boolean(row && (row.type === "USER_INPUT" || row.source === "USER_EXPLICIT"));
}
// Read from the end in disjoint growing chunks until the current turn's USER_INPUT / USER_EXPLICIT boundary is included,
// so large tool outputs (>256 KiB) cannot push an earlier RUNNING background task out of view (PE-775, PE-779) without
// re-reading or re-parsing bytes already scanned.
function antigravityTurnRows(file, initialBytes = 256 * 1024) {
  let fd; try { fd = fs.openSync(file, "r"); } catch { return []; }
  try {
    const size = fs.fstatSync(fd).size;
    if (!size) return [];
    const batches = [];
    let end = size, step = Math.max(1, initialBytes), carry = Buffer.alloc(0);
    while (end > 0) {
      const start = Math.max(0, end - step);
      const buf = Buffer.allocUnsafe(end - start);
      const got = fs.readSync(fd, buf, 0, buf.length, start);
      const block = carry.length ? Buffer.concat([buf.subarray(0, got), carry]) : buf.subarray(0, got);
      const nl = start > 0 ? block.indexOf(10) : -1;
      if (start > 0 && nl < 0) {
        carry = block;
        end = start;
        step = Math.min(end, step * 4);
        continue;
      }
      carry = start > 0 ? block.subarray(0, nl) : Buffer.alloc(0);
      const ready = start > 0 ? block.subarray(nl + 1) : block;
      const rows = ready.toString("utf8").split("\n").map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      batches.push(rows);
      if (start === 0 || rows.some(isAgyTurnStart)) break;
      end = start;
      step = Math.min(end, step * 4);
    }
    return batches.reverse().flat();
  } catch { return []; } finally { fs.closeSync(fd); }
}
function agyArgValue(raw) {
  if (typeof raw !== "string") return raw;
  try { return JSON.parse(raw); } catch { return raw; }
}
function agyArgsOf(c) {
  const raw = c?.args;
  if (!raw) return {};
  if (typeof raw === "string") {
    const parsed = agyArgValue(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  }
  return typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}
const escRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const agyToolName = c => String(c?.name || "").trim().toLowerCase();
const isAgyDaemonCall = c => agyToolName(c) === "run_command" && (agyArgValue(agyArgsOf(c).IsDaemon) === true || String(agyArgValue(agyArgsOf(c).IsDaemon) ?? "").trim().toLowerCase() === "true");
const isAgyOneShotScheduleCall = c => agyToolName(c) === "schedule" && !agyArgValue(agyArgsOf(c).CronExpression) && !(agyArgValue(agyArgsOf(c).IsDaemon) === true || String(agyArgValue(agyArgsOf(c).IsDaemon) ?? "").trim().toLowerCase() === "true");
function agyTimerCondition(c) {
  const raw = agyArgValue(agyArgsOf(c).TimerCondition);
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s || s.toLowerCase() === "never") return "";
  if (s.toLowerCase() === "any") return "any";
  return s;
}
function matchOneShotSchedule(oneShotSchedules, desc) {
  if (!oneShotSchedules.length) return null;
  if (oneShotSchedules.length === 1) return oneShotSchedules[0];
  const m = /^Timer:\s*(\d+)s(?:,\s*Prompt:\s*([\s\S]+))?$/i.exec(desc || "");
  if (m) {
    const secs = Number(m[1]), prompt = (m[2] || "").trim();
    const bySecs = oneShotSchedules.filter(c => Number(agyArgValue(agyArgsOf(c).DurationSeconds)) === secs);
    if (prompt) {
      const strictExact = bySecs.filter(c => String(agyArgValue(agyArgsOf(c).Prompt) || "").trim() === prompt);
      if (strictExact.length === 1) return strictExact[0];
      const stem = prompt.replace(/[.…]+$/, "");
      if (stem.length >= 12) {
        const prefixMatch = bySecs.filter(c => String(agyArgValue(agyArgsOf(c).Prompt) || "").trim().startsWith(stem));
        if (prefixMatch.length === 1) return prefixMatch[0];
      }
    }
    if (bySecs.length === 1) return bySecs[0];
  }
  const conds = new Set(oneShotSchedules.map(agyTimerCondition));
  if (conds.size === 1) return oneShotSchedules[0];
  return null;
}
const agyCmdOf = c => String(agyArgValue(agyArgsOf(c).CommandLine) || "").trim();
const AGY_BG_TOOLS = new Set(["run_command", "schedule", "invoke_subagent", "run_workflow"]);
const KILL_ALREADY_GONE = /not found|no longer running|already (?:finished|completed|stopped|exited|killed|ended)/i;
const TASK_DONE_VERB_SRC = "(?:completed|finished|was\\s+canceled|was\\s+cancelled|canceled|cancelled|failed|exited|ended|stopped|timed\\s+out)";

// Extract only the structured Antigravity message header before any command output body (`with result:` or subsequent lines),
// so quoted completion text inside stdout or a non-completion message from the same sender can never clear a running task.
function agyNoticeHeader(content) {
  const text = String(content || "");
  const msgMatch = /(?:^|\n)(\[Message\][^\n]*)/i.exec(text);
  const raw = msgMatch ? msgMatch[1] : ((/<SYSTEM_MESSAGE>\s*\n?([\s\S]*)/i.exec(text)?.[1] || text).trimStart().split("\n", 1)[0] || "");
  return raw.replace(/\bwith\s+result:[\s\S]*$/i, "with result:").trim();
}
function agyTaskIdMatches(candidate, tid) {
  if (!candidate || !tid) return false;
  if (candidate === tid) return true;
  if (!tid.includes("/") && candidate.endsWith(`/${tid}`)) return true;
  if (!candidate.includes("/") && tid.endsWith(`/${candidate}`)) return true;
  return false;
}
function agyMessageSender(header) {
  if (!header || !/^\[Message\]/i.test(header)) return "";
  const meta = header.replace(/\bcontent=[\s\S]*$/i, "");
  return /\bsender=([^\s\]]+)/i.exec(meta)?.[1] || "";
}
function isTaskCompletionNotice(content, tid) {
  if (!content || !tid) return false;
  const header = agyNoticeHeader(content);
  if (!header) return false;
  const sender = agyMessageSender(header);
  if (sender && !agyTaskIdMatches(sender, tid)) return false;
  const body = (/\bcontent=([\s\S]*)$/i.exec(header)?.[1] ?? header).trim();
  const taskMatch = new RegExp(`^(?:Background\\s+)?Task(?:\\s+id)?\\s+["']?([^\\s"'<>]+)["']?\\s+${TASK_DONE_VERB_SRC}\\b`, "i").exec(body);
  if (taskMatch && agyTaskIdMatches(taskMatch[1], tid)) return true;
  if (sender && new RegExp(`^(?:Background\\s+)?Task\\s+${TASK_DONE_VERB_SRC}\\b`, "i").test(body)) return true;
  return false;
}
function isAnyTaskCompletionNotice(content) {
  const header = agyNoticeHeader(content);
  if (!header) return false;
  const sender = agyMessageSender(header);
  const body = (/\bcontent=([\s\S]*)$/i.exec(header)?.[1] ?? header).trim();
  if (new RegExp(`^(?:Background\\s+)?Task(?:\\s+id)?\\s+["']?[^\\s"'<>]+["']?\\s+${TASK_DONE_VERB_SRC}\\b`, "i").test(body)) return true;
  if (sender && new RegExp(`^(?:Background\\s+)?Task\\s+${TASK_DONE_VERB_SRC}\\b`, "i").test(body)) return true;
  return false;
}
function deleteMatchingTask(active, tid) {
  if (!tid) return;
  if (active.delete(tid)) return;
  if (!tid.includes("/")) {
    const suffix = `/${tid}`;
    for (const key of [...active.keys()]) if (key.endsWith(suffix)) active.delete(key);
  }
}
function spanToolResultRows(turn, plannerIdx) {
  const out = [];
  for (let j = plannerIdx + 1; j < turn.length; j++) {
    const r = turn[j];
    if (!r || r.type === "SYSTEM_MESSAGE") continue;
    if (r.type === "PLANNER_RESPONSE" || isAgyTurnStart(r)) break;
    out.push({ idx:j, row:r });
  }
  return out;
}
function agyCallIdOf(row) {
  return String(row?.tool_call_id || row?.call_id || "").trim();
}
function cmdMatchesDesc(cmd, desc) {
  if (!cmd || !desc) return false;
  if (cmd === desc) return true;
  const cmdFirst = cmd.split("\n", 1)[0].trim();
  const descFirst = desc.split("\n", 1)[0].trim();
  if (cmdFirst && descFirst && cmdFirst === descFirst) return true;
  return (desc.length >= 12 && (cmd.startsWith(desc) || desc.startsWith(cmd)))
    || (descFirst.length >= 12 && cmdFirst.startsWith(descFirst));
}
function rowMentionsTaskId(content, tid) {
  if (!content || !tid) return false;
  const shortId = tid.includes("/") ? tid.split("/").pop() : tid;
  return new RegExp(`(?<![\\w-])${escRe(tid)}(?![\\w-])`, "i").test(content)
    || (shortId !== tid && new RegExp(`(?<![\\w-])${escRe(shortId)}(?![\\w-])`, "i").test(content));
}
const KILL_RESULT_HINT = /\b(?:killed|terminated|stopped|canceled|cancelled|task)\b|not found|no longer running|already (?:finished|completed|stopped|exited|killed|ended)/i;

// Background tasks, wakeups, and trailing errors in agy's append-only transcript:
// a RUNNING row starts a task id, and a later completion/cancellation SYSTEM_MESSAGE for that exact id
// or a confirmed manage_task kill closes it. Explicit daemons (IsDaemon:true) stay up indefinitely and
// do not hold a finished turn open.
function antigravityTurnState(rows, since = 0) {
  let start = 0;
  for (let i = rows.length - 1; i >= 0; i--) if (isAgyTurnStart(rows[i])) { start = i + 1; break; }
  const turn = rows.slice(start);
  const active = new Map(), scheduleTaskIds = new Set(), scheduleTimerConditions = new Map(), anonRunning = new Set(), boundRowIdx = new Set(), daemonRowIdx = new Map(), scheduleRowIdx = new Map(), scheduleCondRowIdx = new Map();
  let daemonCmds = [], nonDaemonCmds = [], oneShotScheduleCalls = [], allBatchBgAreDaemons = false, allBatchBgAreOneShotSchedules = false, hasOneShotScheduleInBatch = false, hasCronScheduleInBatch = false;
  let lastPlannerIdx = -1, lastValidPlannerIdx = -1, lastWakeupIdx = -1, lastError = null;
  for (let i = 0; i < turn.length; i++) {
    const row = turn[i];
    if (!row) continue;
    const stepKey = row.step_index != null ? `s:${row.step_index}` : `i:${i}`;
    if (row.type === "PLANNER_RESPONSE") {
      lastPlannerIdx = i;
      const calls = Array.isArray(row.tool_calls) ? row.tool_calls : [];
      const hasContent = typeof row.content === "string" && row.content.trim().length > 0;
      if (row.status === "DONE" && (calls.length > 0 || hasContent)) lastValidPlannerIdx = i;
      if (row.status === "RUNNING") anonRunning.add(stepKey);
      else if (row.step_index != null) anonRunning.delete(stepKey);
      const runCmds = calls.filter(c => agyToolName(c) === "run_command");
      const daemons = runCmds.filter(isAgyDaemonCall);
      const otherBgCalls = calls.filter(c => AGY_BG_TOOLS.has(agyToolName(c)) && !isAgyDaemonCall(c));
      const oneShotSchedules = otherBgCalls.filter(isAgyOneShotScheduleCall);
      const cronSchedules = otherBgCalls.filter(c => agyToolName(c) === "schedule" && !isAgyOneShotScheduleCall(c));
      oneShotScheduleCalls = oneShotSchedules;
      allBatchBgAreDaemons = daemons.length > 0 && otherBgCalls.length === 0;
      allBatchBgAreOneShotSchedules = oneShotSchedules.length > 0 && oneShotSchedules.length === otherBgCalls.length;
      hasOneShotScheduleInBatch = oneShotSchedules.length > 0;
      hasCronScheduleInBatch = cronSchedules.length > 0;
      daemonCmds = daemons.map(agyCmdOf).filter(Boolean);
      nonDaemonCmds = runCmds.filter(c => !isAgyDaemonCall(c)).map(agyCmdOf).filter(Boolean);
      const results = calls.length ? spanToolResultRows(turn, i) : [];
      // Only bind daemon/schedule status to a result row by explicit call id (never by array position, because parallel tool results can arrive out of order).
      const callById = new Map(calls.filter(c => c?.id).map(c => [String(c.id), c]));
      for (const res of results) {
        const cid = agyCallIdOf(res.row);
        if (cid && callById.has(cid)) {
          const matchedCall = callById.get(cid);
          boundRowIdx.add(res.idx);
          if (agyToolName(matchedCall) === "run_command") daemonRowIdx.set(res.idx, isAgyDaemonCall(matchedCall));
          if (isAgyOneShotScheduleCall(matchedCall)) {
            scheduleRowIdx.set(res.idx, true);
            const cond = agyTimerCondition(matchedCall);
            if (cond) scheduleCondRowIdx.set(res.idx, cond);
          }
        }
      }
      const killCalls = calls.filter(c => agyToolName(c) === "manage_task" && String(agyArgValue(agyArgsOf(c).Action) || "").trim().toLowerCase() === "kill");
      for (const c of killCalls) {
        const tid = String(agyArgValue(agyArgsOf(c).TaskId) || "").trim();
        if (!tid || !results.length) continue;
        // Match by explicit call id first, then by rows referencing this task id; never trust an unrelated DONE row ahead of a failed kill.
        const cid = c.id ? String(c.id) : "";
        let matched = cid ? results.filter(r => agyCallIdOf(r.row) === cid) : [];
        if (!matched.length) matched = results.filter(r => rowMentionsTaskId(typeof r.row.content === "string" ? r.row.content : "", tid));
        if (!matched.length && calls.length === 1 && results.length === 1) {
          const single = results[0];
          const sc = typeof single.row.content === "string" ? single.row.content : "";
          if (KILL_RESULT_HINT.test(sc) || single.row.status === "ERROR") matched = [single];
        }
        if (!matched.length) continue;
        const failed = matched.some(r => r.row.status === "ERROR" && !KILL_ALREADY_GONE.test(typeof r.row.content === "string" ? r.row.content : ""));
        if (failed) continue;
        const confirmed = matched.some(r => r.row.status === "DONE" || (r.row.status === "ERROR" && KILL_ALREADY_GONE.test(typeof r.row.content === "string" ? r.row.content : "")));
        if (confirmed) {
          deleteMatchingTask(active, tid);
          for (const key of [...scheduleTaskIds]) if (agyTaskIdMatches(key, tid)) scheduleTaskIds.delete(key);
          for (const key of [...scheduleTimerConditions.keys()]) if (agyTaskIdMatches(key, tid)) scheduleTimerConditions.delete(key);
        }
      }
      continue;
    }
    const content = typeof row.content === "string" ? row.content : "";
    if (row.type === "ERROR_MESSAGE") {
      if (row.step_index != null) anonRunning.delete(stepKey);
      const msg = String(row.error || content || "Antigravity stopped with an error.").trim();
      lastError = { idx:i, message:msg, at:Date.parse(row.created_at) || 0 };
      continue;
    }
    if (row.type === "SYSTEM_MESSAGE") {
      let cleared = false;
      const header = agyNoticeHeader(content);
      const hasMessageHeader = Boolean(header && /^\[Message\]/i.test(header));
      const sender = agyMessageSender(header);
      const anyNotice = isAnyTaskCompletionNotice(content);
      for (const tid of [...active.keys()]) {
        if (isTaskCompletionNotice(content, tid)) {
          active.delete(tid);
          scheduleTaskIds.delete(tid);
          scheduleTimerConditions.delete(tid);
          cleared = true;
        } else if (sender && scheduleTaskIds.has(tid) && agyTaskIdMatches(sender, tid)) {
          // One-shot `schedule` timer wakeups carry the timer's Prompt text as content= instead of "Task <id> completed".
          active.delete(tid);
          scheduleTaskIds.delete(tid);
          scheduleTimerConditions.delete(tid);
          cleared = true;
        } else if (scheduleTimerConditions.has(tid)) {
          // One-shot `schedule` timers with TimerCondition ("any" or a sender ID) are cancelled silently when a matching message arrives.
          const cond = scheduleTimerConditions.get(tid);
          const condMatches = (cond === "any" && (hasMessageHeader || anyNotice))
            || (cond && cond !== "any" && ((sender && agyTaskIdMatches(sender, cond)) || isTaskCompletionNotice(content, cond)));
          if (condMatches) {
            active.delete(tid);
            scheduleTaskIds.delete(tid);
            scheduleTimerConditions.delete(tid);
            cleared = true;
          }
        }
      }
      if (cleared || anyNotice) lastWakeupIdx = i;
      continue;
    }
    if (row.status === "DONE" || row.status === "ERROR" || row.status === "INVALID" || row.status === "CANCELED") {
      if (row.step_index != null) anonRunning.delete(stepKey);
      continue;
    }
    if (row.status === "RUNNING") {
      const m = /task id:\s*([^\s"'<>]+)/i.exec(content);
      if (m) {
        let isDaemon = false;
        if (daemonRowIdx.has(i)) isDaemon = daemonRowIdx.get(i);
        else if (!boundRowIdx.has(i) && allBatchBgAreDaemons) isDaemon = true;
        else if (!boundRowIdx.has(i)) {
          const desc = /Task Description:\s*([\s\S]+)/i.exec(content)?.[1]?.trim() || "";
          if (desc) {
            const matchesDaemon = daemonCmds.some(cmd => cmdMatchesDesc(cmd, desc));
            const matchesNonDaemon = nonDaemonCmds.some(cmd => cmdMatchesDesc(cmd, desc));
            isDaemon = matchesDaemon && !matchesNonDaemon;
          }
        }
        if (!isDaemon) {
          active.set(m[1], i);
          const rawDesc = /Task Description:\s*([\s\S]+)/i.exec(content)?.[1] || "";
          const desc = rawDesc.replace(/\r?\nTask logs are available at:[\s\S]*$/i, "").trim();
          const isBound = boundRowIdx.has(i);
          const affirmativeTimer = !isBound && hasOneShotScheduleInBatch && /^Timer:\s*\d+/i.test(desc);
          if (scheduleRowIdx.get(i) || (!isBound && (allBatchBgAreOneShotSchedules || affirmativeTimer))) {
            scheduleTaskIds.add(m[1]);
            let cond = "";
            if (isBound) cond = scheduleCondRowIdx.get(i) || "";
            else {
              const matched = matchOneShotSchedule(oneShotScheduleCalls, desc);
              cond = matched ? agyTimerCondition(matched) : "";
            }
            if (cond) scheduleTimerConditions.set(m[1], cond);
          }
        }
      } else {
        anonRunning.add(stepKey);
      }
    }
  }
  const last = lastPlannerIdx >= 0 ? turn[lastPlannerIdx] : null;
  const pending = active.size > 0 || anonRunning.size > 0;
  const unansweredWakeup = lastWakeupIdx > lastValidPlannerIdx;
  const error = lastError && lastError.idx > lastValidPlannerIdx && (!since || !lastError.at || lastError.at >= since) ? lastError.message : "";
  let done = null;
  if (last && last.status === "DONE" && !(last.tool_calls || []).length && !pending && !unansweredWakeup && !error) {
    const at = Date.parse(last.created_at) || 0, answer = typeof last.content === "string" ? last.content.trim() : "";
    if (answer && at >= since) done = { answer, at };
  }
  return { done, pending, pendingTasks:[...active.keys()], unansweredWakeup, error };
}
function antigravityDone(rows, since) {
  return antigravityTurnState(rows, since).done;
}
function antigravityTranscriptState(file, since = 0) {
  if (!file) return { done:null, pending:false, pendingTasks:[], unansweredWakeup:false, error:"" };
  return antigravityTurnState(antigravityTurnRows(file), since);
}
function claudeDone(rows, since) {
  const last = [...rows].reverse().find(o => (o.type === "assistant" || o.type === "user") && !o.isSidechain && !o.isMeta);
  if (!last || last.type !== "assistant") return null;
  const parts = Array.isArray(last.message?.content) ? last.message.content : [];
  if (parts.some(p => p?.type === "tool_use")) return null;
  const at = Date.parse(last.timestamp) || 0, answer = parts.filter(p => p?.type === "text").map(p => p.text).join("\n").trim();
  return answer && at >= since ? { answer, at } : null;
}
function claudeFile(id, env, home) {
  const root = path.join(env.CLAUDE_CONFIG_DIR || path.join(home, ".claude"), "projects");
  let names; try { names = fs.readdirSync(root); } catch { return ""; }
  for (const name of names) { const file = path.join(root, name, `${id}.jsonl`); if (fs.existsSync(file)) return file; }
  return "";
}
function antigravityRunState(r, { env = process.env, home = os.homedir() } = {}) {
  if (!r?.sessionId || r.agent !== "antigravity") return null;
  const file = antigravityTranscript(r.sessionId, { ...env, HOME:home }, home);
  return file ? antigravityTranscriptState(file, r.started || 0) : null;
}
// What the agent's own record says when its stream has gone quiet: its final answer, if its turn has ended. Only agents whose record says so plainly.
function finishedTurn(r, { env = process.env, home = os.homedir() } = {}) {
  if (!r.sessionId) return null;
  if (r.agent === "antigravity") return antigravityRunState(r, { env, home })?.done || null;
  if (r.agent === "claude") { const file = claudeFile(r.sessionId, env, home); return file ? claudeDone(lastRows(file), r.started) : null; }
  return null;
}

// ---------- Deciding ----------
// One look at one run. `tree` is its process tree now (null when it cannot be read), `now` the time. It says what to do, and keeps what it needs on the run.
//   "free": stop what it left running; "end": stop the agent too, its turn done; "stuck": stop the agent, which never finished.
function decide(r, tree, now, { finished = () => null, limitNotice = () => false, waiting = false, pending = () => false } = {}) {
  const w = r.watch ||= { idleSince:r.started || now, cpu:null };
  const heard = Math.max(r.heardAt || r.started || now, r.child?.stdoutActivityAt || 0);
  if (tree) {
    // Idle counts from the first look: what it did before that is not known.
    if (w.cpu === null || tree.cpu - w.cpu > IDLE_CPU_MS * Math.max(1, (now - (w.at || now)) / CHECK_MS)) w.idleSince = now;
    w.cpu = tree.cpu; w.at = now;
  }
  // An orchestrator blocked inside PenEcho's wait call or tracking active delegated sublines is never idle or stuck.
  if (waiting) {
    w.idleSince = now;
    if (r.turnOver) { r.turnOver = 0; r.turnOverAt = undefined; }
    if (w.freedAt) { w.freedAt = 0; w.why = ""; }
    return null;
  }
  const idleSince = Math.max(w.idleSince, heard);
  // It spoke again after its commands were stopped: it is working, so everything starts over.
  if (w.freedAt && heard > w.freedAt) { w.freedAt = 0; w.why = ""; }
  if (w.freedAt) return now - w.freedAt >= END_MS ? (w.why === "stuck" ? "stuck" : "end") : null;
  const hasBackground = Number(r.background) > 0 || Boolean(pending(r));
  // If a pending background task, unanswered wakeup, or trailing error is detected in the transcript, clear any premature turnOver.
  if (hasBackground && r.turnOver) { r.turnOver = 0; r.turnOverAt = undefined; }
  if (!r.turnOver && !hasBackground && now - heard >= QUIET_MS && (!w.lookedAt || now - w.lookedAt >= QUIET_MS)) {
    w.lookedAt = now;
    const done = finished(r);
    if (done) { r.turnOver = now; r.turnOverAt = Number.isFinite(done.at) ? done.at : 0; r.transcriptAnswer = done.answer; }
  }
  if (!tree) return null;
  const free = why => { w.freedAt = now; w.why = why; return tree.below.length ? "free" : why === "stuck" ? "stuck" : "end"; };
  if (r.turnOver && !hasBackground && (limitNotice(r.said) || now - idleSince >= DONE_IDLE_MS)) return free("done");
  if ((!r.turnOver || hasBackground) && now - idleSince >= STUCK_MS) return free("stuck");
  return null;
}

const RunWatchApi = { CHECK_MS, DONE_IDLE_MS, QUIET_MS, STUCK_MS, END_MS, IDLE_CPU_MS, processTable, treeOf, captureTrees, cpuMs, stopTree, stopTreeAndWait, processMeta, isPidAlive, stopAll, decide, finishedTurn, antigravityRunState, antigravityDone, antigravityTurnState, antigravityTranscriptState, antigravityTurnRows, claudeDone, lastRows };

module.exports = RunWatchApi;
