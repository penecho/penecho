"use strict";
// Works that ran before PenEcho saved token evidence still left the agent's own usage reports in the run log
// (runs/<project>/<line>.log). This reads them back with the same rules as a live run. No model is called.
const Tokens = require("./token-evidence.js");

const HEAD = /^--- (\d{4}-\d\d-\d\d \d\d:\d\d) (.+) \(([^()]+)\)$/;
// Only lines that can carry usage or a tool result are parsed; the rest of a large log is skipped by a cheap text test.
const USEFUL = /"(?:thread\/tokenUsage\/updated|assistant|result|init|message_end|turn\.completed|tool_result|item\/completed|status|step_finish|tool_use|tool_call|step_update|tool_execution_start|tool_execution_end|session\.resume_hint)"/;

// Each "--- <time> <Work label> (<agent>)" header starts one run of that Work.
function sections(text) {
  const out = [];
  let cur = null;
  for (const line of String(text || "").split("\n")) {
    const head = line.match(HEAD);
    if (head) { cur = { at:head[1], label:head[2], agent:head[3], records:[] }; out.push(cur); continue; }
    if (!cur || line[0] !== "{" || !USEFUL.test(line)) continue;
    try { cur.records.push(JSON.parse(line)); } catch { /* A cut-off line is skipped. */ }
  }
  // A Codex thread resumed in a later run counts from where its last run ended.
  const totals = new Map();
  for (const s of out) {
    const notes = s.records.filter(o => o.method === "thread/tokenUsage/updated" && o.params?.tokenUsage?.total);
    const thread = notes[0]?.params.threadId;
    if (thread && totals.has(thread)) s.priorTotal = totals.get(thread);
    if (notes.length) totals.set(thread, Tokens.normalize(notes.at(-1).params.tokenUsage.total));
  }
  // A run ends, at the latest, where the next one in the log starts.
  out.forEach((s, i) => { s.until = out[i + 1]?.at || ""; });
  return out;
}
const labelTime = label => { const t = Date.parse(String(label || "").replace(" ", "T")); return Number.isFinite(t) ? t : 0; };

// Kimi prints no usage; `kimi(sessionId, since, until)` returns the records its own log keeps for that time.
// The log gives times to the minute, so a run is read from the start of its minute.
function withKimi(run, kimi) {
  if (run.agent !== "kimi" || !kimi) return run.records;
  const id = run.records.find(o => o.type === "session.resume_hint" && o.session_id)?.session_id;
  const since = labelTime(run.at), until = labelTime(run.until) || Infinity;
  return id && since ? [...run.records, ...kimi(id, since, until)] : run.records;
}
// Kimi's records and OpenCode's usage carry their own times; for the rest, the run's start is all the log has.
const when = (o, start) => (o.type === "usage.record" && Number.isFinite(o.time) && o.time) || (o.type === "step_finish" && Number.isFinite(o.timestamp) && o.timestamp) || start;
// One evidence file for a Work, with one attempt per run of it in the log. Returns null when nothing was measured.
function evidenceFor({ workId, runs, model = "", log = "", kimi = null, cwd = "" }) {
  if (!runs.length) return null;
  const at = labelTime(runs[0].at) || Date.now();
  const e = Tokens.create({ workId, taskId:"", taskMode:"earlier", continuedFromWork:"", baseline:null, manifest:"", at });
  e.startup = { status:"earlier", reason:"Ran before PenEcho chose the context for each task", baseline:null, first:null, difference:null };
  e.backfilled = { source:"PenEcho run log", log, at:Date.now() };
  for (const run of runs) {
    const start = labelTime(run.at) || at;
    const note = run.records.find(o => o.method === "thread/tokenUsage/updated");
    const usage = note?.params?.tokenUsage, total = usage && Tokens.normalize(usage.total), last = usage && Tokens.normalize(usage.last);
    // A resumed Codex thread counts from its earlier total: from its last run in this log, or else from before its first request here.
    const before = total && last ? Object.fromEntries(Object.keys(total).map(k => [k, total[k] != null && last[k] != null ? total[k] - last[k] : null])) : null;
    const cumulative = run.priorTotal || before;
    const a = Tokens.startAttempt(e, { agent:run.agent, config:"", resumed:Boolean(cumulative), cumulative, cwd, at:start });
    // Times are the run's start: the log has no time on each line.
    for (const o of withKimi(run, kimi)) Tokens.observe(e, a, o, { threadId:note?.params?.threadId || "", turnId:"", at:when(o, start) });
    if (model) Tokens.recordModel(e, a, model);
    Tokens.finish(e, a, start);
    e.startup = { status:"earlier", reason:"Ran before PenEcho chose the context for each task", baseline:null, first:null, difference:null };
  }
  e.attempts = e.attempts.filter(a => a.requests.length || a.totals.inputTokens != null);
  return e.attempts.length ? e : null;
}

// Evidence saved before PenEcho recorded what each Work read, or all of it, gets its reads from the same log.
// Each saved attempt is matched to a run of the log by its first request, or else by its place and request count.
// Returns the evidence with reads, or null when any attempt has no clear match, or a log cut short holds fewer reads than were
// recorded: then the reads stay as they were.
function withReads(evidence, fromLog) {
  if (!evidence?.attempts?.length || !fromLog?.attempts?.length) return null;
  const used = new Set(), out = [], recorded = Tokens.readsRecorded(evidence);
  for (const [i, a] of evidence.attempts.entries()) {
    const first = a.requests[0]?.id;
    let match = fromLog.attempts.findIndex((b, j) => !used.has(j) && first && b.requests[0]?.id === first);
    if (match < 0 && fromLog.attempts[i] && !used.has(i) && fromLog.attempts[i].requests.length === a.requests.length) match = i;
    if (match < 0 || recorded && (fromLog.attempts[match].reads || []).length < a.reads.length) return null;
    used.add(match); out.push({ ...a, reads:fromLog.attempts[match].reads || [] });
  }
  return { ...evidence, attempts:out, readsVersion:Tokens.READS_VERSION };
}

// Claude evidence saved while a later turn's result replaced the Work's totals with that turn's alone (often all zero) gets the whole
// run's totals back from the same log. Each saved attempt is matched by its first request; a field only ever grows.
// Returns the evidence with its totals mended, or null when nothing changes.
function withTotals(evidence, fromLog) {
  if (!evidence?.attempts?.length || !fromLog?.attempts?.length) return null;
  let changed = false;
  const attempts = evidence.attempts.map(a => {
    const first = a.requests[0]?.id, b = first && a.agent === "claude" ? fromLog.attempts.find(x => x.requests[0]?.id === first) : null;
    if (!b?.reported) return a;
    const totals = Object.fromEntries(Object.entries(a.totals).map(([k, v]) => [k, Number.isSafeInteger(b.totals[k]) && b.totals[k] > (v ?? -1) ? b.totals[k] : v]));
    if (Object.keys(totals).every(k => totals[k] === a.totals[k])) return a;
    changed = true;
    // Period totals add up usage events, so what is mended is one more event, at the attempt's end.
    const at = a.endedAt || a.requests.at(-1)?.at || a.startedAt, gain = Object.fromEntries(Object.keys(totals).map(k => [k, Number.isSafeInteger(totals[k]) ? totals[k] - (a.totals[k] || 0) : null]));
    return { ...a, totals, reported:b.reported, events:[...(a.events || []), { at, ...gain }] };
  });
  return changed ? { ...evidence, attempts, totalsMended:{ source:"PenEcho run log", at:Date.now() } } : null;
}

// Evidence saved while PenEcho could not yet read an agent's usage (OpenCode, dsh, Antigravity, Kimi before version 3) has the Work's task
// and what it was compared with, but no request. The log's attempts fill it in, one for one, and the comparison is made again.
// Returns null when the attempts do not pair up.
function withUsage(evidence, fromLog) {
  if (!evidence?.attempts?.length || !fromLog?.attempts?.length || evidence.attempts.some(a => a.requests.length)) return null;
  // A run that measured nothing is not in the log's evidence, so the saved attempts that measured something must be the ones left after the same filter.
  if (evidence.attempts.length !== fromLog.attempts.length) return null;
  const attempts = evidence.attempts.map((a, i) => { const b = fromLog.attempts[i]; return { ...a, requests:b.requests.map(r => ({ ...r, at:Math.max(r.at || 0, a.startedAt || 0) })), events:b.events, reads:b.reads || [], totals:b.totals, source:b.source, complete:b.complete, firstSeen:b.firstSeen, firstMissing:b.firstMissing }; });
  return Tokens.recompare({ ...evidence, attempts, readsVersion:Tokens.READS_VERSION, backfilled:{ ...(fromLog.backfilled || {}), usage:true } });
}

// A Work done in Claude's own app (Claude desktop, or Claude Code in a terminal) is read into its line from the conversation's transcript,
// ~/.claude/projects/<folder>/<id>.jsonl, which keeps each request's usage. Only the requests made in the Work's own time are counted.
// Each content block of a reply is its own transcript line with the same message id and usage, so a request is counted once.
// Returns null when nothing in that time was measured.
function fromTranscript({ workId, text, since, until, via = "Claude desktop" }) {
  const e = Tokens.create({ workId, taskId:"", taskMode:"app", continuedFromWork:"", baseline:null, manifest:"", at:since });
  const startup = { status:"app", reason:`Done in ${via}, which chose its own context`, baseline:null, first:null, difference:null };
  const a = Tokens.startAttempt(e, { agent:"claude", config:"", resumed:true, at:since });
  for (const line of String(text || "").split("\n")) {
    if (!line.includes('"assistant"') && !line.includes('"tool_result"')) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const at = Date.parse(o?.timestamp || "");
    if (!Number.isFinite(at) || at < since || at > until) continue;
    if (o.type === "assistant" && !a.sessionId) a.sessionId = o.sessionId || "";
    Tokens.observe(e, a, o, { at });
  }
  Tokens.finish(e, a, until);
  e.startup = startup;
  e.backfilled = { source:`${via} transcript`, at:Date.now() };
  return a.requests.length ? e : null;
}

// A Work done in the Codex app is read the same way from its rollout, ~/.codex/sessions/YYYY/MM/DD/rollout-…-<id>.jsonl. Each request leaves a
// token_count event with the thread's running total and that request's own usage; a repeated total is the same request again (PE-503).
// The total before the Work's first request is where its attempt starts. `lines` are the rollout's token_count and turn_context lines.
function fromRollout({ workId, lines, since, until, via = "Codex desktop", threadId = "" }) {
  const seen = [];
  let model = "", top = -1;
  for (const line of lines || []) {
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o?.type === "turn_context" && o.payload?.model) model = o.payload.model;
    const info = o?.type === "event_msg" && o.payload?.type === "token_count" ? o.payload.info : null, at = Date.parse(o?.timestamp || "");
    const total = info && Tokens.normalize(info.total_token_usage), last = info && Tokens.normalize(info.last_token_usage);
    if (!total || total.inputTokens == null || last.inputTokens == null || total.inputTokens <= top) continue;
    top = total.inputTokens;
    if (Number.isFinite(at) && at >= since && at <= until) seen.push({ at, total, last, raw:info, model });
  }
  if (!seen.length) return null;
  const e = Tokens.create({ workId, taskId:"", taskMode:"app", continuedFromWork:"", baseline:null, manifest:"", at:since });
  const before = Object.fromEntries(Object.keys(seen[0].total).map(k => [k, seen[0].total[k] != null && seen[0].last[k] != null ? seen[0].total[k] - seen[0].last[k] : null]));
  const a = Tokens.startAttempt(e, { agent:"codex", config:"", sessionId:threadId, resumed:true, cumulative:before, at:since });
  for (const s of seen) Tokens.observe(e, a, { method:"thread/tokenUsage/updated", model:s.model, params:{ threadId, tokenUsage:{ total:s.raw.total_token_usage, last:s.raw.last_token_usage } } }, { threadId, at:s.at });
  Tokens.finish(e, a, until);
  e.startup = { status:"app", reason:`Done in ${via}, which chose its own context`, baseline:null, first:null, difference:null };
  e.backfilled = { source:`${via} rollout`, at:Date.now() };
  return a.requests.length ? e : null;
}

module.exports = { sections, evidenceFor, withReads, withTotals, withUsage, labelTime, fromTranscript, fromRollout };
