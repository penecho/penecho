"use strict";
const os = require("node:os"), path = require("node:path");
const { openCodeModel } = require("./agent-model.js");
const { concreteModel } = require("../../../public/lines/work-pricing.js");
const { randomUUID, createHash } = require("node:crypto");
const { normalizeLocalTokenUsage } = require("../local-request-usage.js");

const FIELDS = ["inputTokens", "outputTokens", "cacheReadInputTokens", "cacheWriteInputTokens"];
// What a Work read: one entry per tool result, with hashed keys of the files, searches and commands behind it.
// Version 1 recorded it for Claude Code, Codex and PenEcho's own agent; version 2 for every agent; version 3 also finds the files a
// shell command reads after its start ("cd …; sed -n … file"), as most of them are. Versions 1 and 2 still count as recorded.
const READS_VERSION = 3, READS_V1 = new Set(["claude", "codex", "penecho"]);
const readsRecorded = e => (e?.readsVersion === READS_VERSION || e?.readsVersion === 2 || e?.readsVersion === 1 && e.attempts.every(a => READS_V1.has(a.agent))) && e.attempts.every(a => Array.isArray(a.reads));
const hasUsage = e => Boolean(e?.attempts?.some(a => a.requests?.length));
// Tool results measured on PenEcho Works: about 2.2 characters per token. A low figure counts re-reads high, so a saving is never overstated.
const CHARS_PER_TOKEN = 2.2, IMAGE_CHARS = 1600 * CHARS_PER_TOKEN;
// List prices as multiples of new input. Claude Code writes its cache for one hour, at 2x (Opus 5.5: $4 in, $0.20 hit, $8 write, $20 out per million).
// Codex reports cache hits but not writes; GPT-6 models charge 1.25x for new input written to the cache, which lasts at least 30 minutes.
// Measured on past Codex resumes it held for an hour: 20 of 24 found it after 30 to 60 idle minutes and 6 of 6 after 60 to 65 (PE-974).
// DeepSeek, Gemini and Kimi cache by themselves, with no charge for writing. Where a cache's life is not published, one hour is assumed
// for choosing between a fresh start and resuming (cacheMinutes).
// cacheMost: after this long unused, no cache still holds the conversation. Claude Code's is known (it writes for one hour).
// Codex's was measured: 18 of 22 past resumes after 3 hours or more found nothing, 13 of 21 after 1 to 3 hours found it (PE-1180). The
// others publish a least life or none, and some keep a cache for up to a day. Between cacheMinutes and cacheMost the saving is counted
// as if the cache were still warm: the smaller saving, so a claim is never made on a guess (PE-927).
const DAY = 24 * 60;
function weightsFor(agent, model) {
  const m = String(model || "");
  if (/claude|opus|sonnet|haiku|fable/i.test(m) || agent === "claude" && !m) return { name:"Claude", input:1, read:/opus-5/i.test(m) ? 0.05 : 0.1, write:2, output:5, cacheMinutes:60, cacheMost:60 };
  if (/gpt|codex/i.test(m) || agent === "codex" && !m) { const write = /gpt-6/i.test(m) ? 1.25 : 1; return { name:"Codex", input:write, read:/gpt-6\.1/i.test(m) ? 0.05 : 0.1, write, output:5, cacheMinutes:60, cacheMost:180 }; }
  if (/deepseek/i.test(m) || agent === "dsh" && !m) return { name:"DeepSeek", input:1, read:0.1, write:1, output:1.5, cacheMinutes:60, cacheMost:DAY };
  if (/gemini/i.test(m) || agent === "antigravity" && !m) return { name:"Gemini", input:1, read:0.1, write:1, output:6, cacheMinutes:60, cacheMost:DAY };
  if (/kimi|moonshot/i.test(m) || agent === "kimi" && !m) return { name:"Kimi", input:1, read:0.25, write:1, output:4, cacheMinutes:60, cacheMost:DAY };
  if (agent === "claude") return weightsFor("claude", "");
  if (agent === "codex") return weightsFor("codex", "");
  return { name:"Other agents", input:1, read:0.1, write:1.25, output:5, cacheMinutes:60, cacheMost:DAY };
}
// The price the person saved for a model (Agent record & prices), which the cost of each Work is already worked out with. With one,
// a comparison weighs tokens by that price and is told in dollars too; with none, by the typical prices above (PE-927).
let savedPrice = () => null;
function usePrices(lookup) { savedPrice = typeof lookup === "function" ? lookup : () => null; }
function pricesFor(agent, model) {
  const base = weightsFor(agent, model);
  let price = null; try { price = savedPrice(model) || null; } catch { price = null; }
  const unit = Number(price?.input), out = Number(price?.output);
  if (!(unit > 0) || !(out > 0)) return { ...base, source:"typical" };
  const ratio = (value, fallback) => value != null && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) / unit : fallback;
  // What a cache write costs follows how the agent caches: Claude Code writes for an hour, at twice new input; Codex writes all new input.
  const write = base.name === "Claude" ? base.write : ratio(price.cacheWrite, base.name === "Codex" ? 1 : base.write);
  return { ...base, input:base.name === "Codex" ? write : 1, read:ratio(price.cached, base.read), write, output:out / unit, source:"saved", model:concreteModel(String(price.model || model || "")), usd:unit / 1e6 };
}
const empty = () => Object.fromEntries(FIELDS.map(k => [k, null]));
const known = n => Number.isSafeInteger(n) && n >= 0;
const normalize = (raw, format = "openai") => {
  if (format !== "openai") {
    const normalized = normalizeLocalTokenUsage(raw,format);
    // dsh's TokenUsage contract defines totalTokens as exact aggregate prompt + output.
    // Its adapters omit zero cache categories, so use that authoritative total without inventing category values.
    const total = raw?.totalTokens, output = normalized.outputTokens;
    if (format === "harness" && normalized.inputTokens === null && known(total) && known(output) && total >= output) {
      const inclusive = total-output, disjoint = [raw.inputTokens,normalized.cacheReadInputTokens,normalized.cacheWriteInputTokens].reduce((n,x)=>n+(known(x)?x:0),0);
      if (inclusive >= disjoint) normalized.inputTokens = inclusive;
    }
    return normalized;
  }
  // Codex input is inclusive even when it exposes a snake_case cache-write field.
  const u = raw || {};
  return normalizeLocalTokenUsage({ inputTokens:u.inputTokens ?? u.input_tokens,outputTokens:u.outputTokens ?? u.output_tokens,
    cacheReadInputTokens:u.cachedInputTokens ?? u.cached_input_tokens,cacheWriteInputTokens:u.cacheWriteInputTokens ?? u.cache_write_input_tokens },"openai");
};
const add = rows => Object.fromEntries(FIELDS.map(k => [k, rows.some(r => known(r?.[k])) ? rows.reduce((n,r) => n + (r?.[k] || 0),0) : null]));
const maximum = (a, b) => Object.fromEntries(FIELDS.map(k => [k, known(b?.[k]) ? Math.max(a?.[k] ?? 0, b[k]) : a?.[k] ?? null]));
const requestModel = row => row?.model == null ? row : { ...row, model:concreteModel(row.model) };

function create({ workId, taskId, taskMode, continuedFromWork, baseline = null, manifest, at = Date.now() }) {
  return { schemaVersion:1, comparisonVersion:"previous-input-v1", readsVersion:READS_VERSION, workId, taskId, taskMode, continuedFromWork, manifest, createdAt:at, attempts:[],
    startup:{ status:taskMode === "new" ? "pending" : "continuation", reason:taskMode === "new" ? "Waiting for the first model request" : "Same task; no new startup comparison", baseline:requestModel(baseline), first:null, difference:null } };
}
// `cwd` is where its commands start, to know the files they name. Like the tools under way, it is kept only while the attempt runs.
function startAttempt(evidence, { id = randomUUID(), agent, config, sessionId = "", resumed = false, cumulative = null, cwd = "", at = Date.now() }) {
  const a = { id, agent, config, sessionId, resumed, startedAt:at, ...(cwd ? { cwd } : {}), requests:[], events:[], reads:[], totals:empty(), source:"", complete:false,
    cumulativeBaseline:resumed ? cumulative : { inputTokens:0, outputTokens:0, cacheReadInputTokens:0, cacheWriteInputTokens:0 },
    lastCumulative:null, firstSeen:false, firstMissing:false, endedAt:null };
  evidence.attempts.push(a);
  return a;
}
function request(a, id, usage, value, at) {
  const model = concreteModel(value);
  let row = a.requests.find(r => r.id === id);
  if (!row) { row = { id, model, at, ...empty() }; a.requests.push(row); }
  Object.assign(row, maximum(row, usage));
  if (model) row.model = model;
  else if (!concreteModel(row.model) && concreteModel(a.model || "")) row.model = concreteModel(a.model);
  return row;
}
function compare(e, a) {
  if (e.taskMode !== "new" || e.attempts[0]?.id !== a.id) return;
  e.startup.difference = null;
  if (e.historyIncomplete) { e.startup.status = "unavailable"; e.startup.reason = "Earlier attempt telemetry is unavailable"; return; }
  const first = a.requests[0];
  if (!first || a.firstMissing || !known(first.inputTokens)) {
    e.startup.status = a.endedAt || a.firstMissing ? "unavailable" : "pending";
    e.startup.reason = a.firstMissing ? "The first request was not fully measured" : "Waiting for the first model request";
    return;
  }
  e.startup.first = { requestId:first.id, input:first.inputTokens, model:concreteModel(first.model), agent:a.agent, sessionId:a.sessionId, at:first.at, config:a.config };
  Object.assign(e.startup, startupAgainst(e.startup.first, e.startup.baseline));
}
// The baseline is the last measured request of the conversation this agent would otherwise have resumed on this Line:
// before task-scoped context, PenEcho resumed each agent's own conversation for every new Ask.
// Model and effort may differ, because a resumed conversation carries its context to the new model too; its cache it does not (otherModel).
function startupAgainst(first, b) {
  if (!b || !known(b.input)) return { status:"unavailable", reason:"No earlier conversation by this agent on this Line", difference:null, baseline:b || null };
  if (b.agent && first.agent && b.agent !== first.agent) return { status:"unavailable", reason:"A different agent had the earlier conversation", difference:null, baseline:b };
  return { status:"compared", reason:"Last measured input of the conversation this agent would have resumed, minus this task's first measured input", difference:b.input - first.input, baseline:b };
}

// What a tool call read, as short hashes: the file, and the exact search or command. A resumed conversation already holds
// what it read before, so a fresh start reading the same again is a cost of starting fresh. Edits and writes read nothing.
const keyOf = text => createHash("sha256").update(text).digest("hex").slice(0, 12), readKeyOfFile = file => keyOf(`f:${file}`);
// The files a shell command shows (cat, sed -n, head, tail, nl, less, more), in whichever folder a `cd` before them left it. `parts`
// counts what it printed: each file shown, and each other command that prints. A name made from a variable or a pattern, or relative
// to a folder that is not known, names no file here; output sent to a file is not shown.
const SHOWS = new Set(["cat", "sed", "head", "tail", "nl", "less", "more"]), VALUED = { head:/^-[nc]$/, tail:/^-[nc]$/, nl:/^-[bdfhilnsvw]$/, sed:/^-[a-zA-Z]*[ef]$/ };
const SILENT = new Set(["cd", "echo", "printf", "export", "set", "unset", "mkdir", "sleep", "true", ":", "[", "[[", "test", "exit", "wait", "for", "done", "fi", "esac", "}"]);
const LEADS = new Set(["do", "then", "else", "if", "while", "!", "{", "time", "command"]);
function commandReads(command, cwd = "") {
  const text = String(command || "").replace(/<<-?[ \t]*(['"]?)(\w+)\1([^\n]*)\n[\s\S]*?\n[ \t]*\2(?=\n|$)/g, " $3"); // Here-documents are input.
  const files = [], folders = [typeof cwd === "string" && path.isAbsolute(cwd) ? cwd : ""], home = os.homedir();
  let parts = 0, pipeline = [], words = [], word = null, skip = false;
  const add = (c, dynamic = false) => { word ||= { text:"", dynamic:false }; word.text += c; word.dynamic ||= dynamic; };
  const resolve = w => w.dynamic || !w.text ? "" : path.isAbsolute(w.text) ? path.normalize(w.text) : folders.at(-1) ? path.resolve(folders.at(-1), w.text) : "";
  const shownBy = ([name, ...rest]) => {
    if (!name || !SHOWS.has(name.text)) return [];
    const sed = name.text === "sed", options = rest.map(w => w.text).filter(x => /^-./.test(x)), named = [];
    if (sed && (!options.some(x => /^-[a-zA-Z]*n|^--quiet$|^--silent$/.test(x)) || options.some(x => /^-[a-zA-Z]*i|^--in-place/.test(x)))) return [];
    let script = sed && !options.some(x => VALUED.sed.test(x));
    for (let k = 0; k < rest.length; k++) {
      if (/^-./.test(rest[k].text)) { if (VALUED[name.text]?.test(rest[k].text)) k++; }
      else if (script) script = false;
      else if (rest[k].text !== "-") named.push(rest[k]);
    }
    return named;
  };
  const endWord = () => { if (word && !skip) words.push(word); if (word) skip = false; word = null; };
  const endCommand = () => { endWord(); skip = false; if (words.length) pipeline.push(words); words = []; };
  const endPipeline = () => {
    endCommand();
    for (const list of pipeline) while (list.length && (LEADS.has(list[0].text) || /^\w+=/.test(list[0].text))) list.shift();
    const [name, ...rest] = pipeline[0] || [], shown = pipeline.map(shownBy).find(named => named.length) || [];
    if (name?.text === "cd") { const to = rest.find(w => !/^-[-LP]$/.test(w.text)); folders[folders.length - 1] = !to ? home : to.text === "-" ? "" : resolve(to); }
    if (!pipeline.at(-1)?.hidden) {
      for (const file of shown.map(resolve)) if (file) files.push(file);
      parts += shown.length || Number(pipeline.some(list => list.length && !SILENT.has(list[0].text)));
    }
    pipeline = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1] || "";
    if (c === "\\") { if (next !== "\n") add(next); i++; }
    else if (c === "'") { const end = text.indexOf("'", i + 1); add(text.slice(i + 1, end < 0 ? text.length : end)); i = end < 0 ? text.length : end; }
    else if (c === '"') { add(""); for (i++; i < text.length && text[i] !== '"'; i++) { const escaped = text[i] === "\\" && /["\\$`]/.test(text[i + 1] || ""); if (escaped) i++; add(text[i], !escaped && /[$`]/.test(text[i])); } }
    else if (c === "$" && next === "(") { let depth = 0; for (i++; i < text.length; i++) if (text[i] === "(") depth++; else if (text[i] === ")" && !--depth) break; add("$", true); }
    else if (c === "`") { const end = text.indexOf("`", i + 1); add("`", true); i = end < 0 ? text.length : end; }
    else if (c === "#" && !word) { const end = text.indexOf("\n", i); i = end < 0 ? text.length : end - 1; }
    else if (c === "~" && !word && /^(?:[/\s;&|)]|$)/.test(next)) add(home);
    else if (c === ">" || c === "<" || c === "&" && next === ">") {
      // A redirection, with the stream's number before it and where it goes after: 2>/dev/null, >>log, 2>&1, &>log, <file.
      const stream = word && /^\d$/.test(word.text) ? word.text : "";
      if (stream) word = null; else endWord();
      let to = c; while (/[><&|]/.test(text[i + 1] || "")) to += text[++i];
      if (c !== "<" && stream !== "2" && !/>&$/.test(to)) words.hidden = true;
      skip = true;
    }
    else if (/[ \t\r]/.test(c)) endWord();
    else if (c === "|" && next !== "|") { if (next === "&") i++; endCommand(); }
    else if (/[\n;|&]/.test(c)) { if (next === c) i++; endPipeline(); }
    else if (c === "(" && !word) { endPipeline(); folders.push(folders.at(-1)); }
    else if (c === ")") { endPipeline(); if (folders.length > 1) folders.pop(); }
    else add(c, /[$*?[]/.test(c) || c === "{" && /\S/.test(next));
  }
  endPipeline();
  return { files, parts, cwd:folders[0] };
}
// Each agent names the same tools its own way: Claude Code and Kimi "Read", OpenCode and dsh "read", Antigravity "view_file".
const READ_TOOL = /^(?:read|notebookread|read_file|view_file|view_file_outline|view_code_item|readmediafile)$/i;
const SEARCH_TOOL = /^(?:grep|glob|ls|list|find|grep_search|find_by_name|list_dir|codesearch)$/i, SHELL_TOOL = /^(?:bash|shell|run_command)$/i;
// Antigravity's command line gives some values as JSON strings.
const plain = v => typeof v === "string" && /^".*"$/s.test(v) ? (() => { try { return JSON.parse(v); } catch { return v; } })() : v;
// The keys of one tool call: k, and for a shell command n, how many parts it printed. Its first key is the whole command, the rest its files.
function readKeys(name, input = {}, a = null) {
  input = input && typeof input === "object" ? input : {};
  const file = plain(input.file_path ?? input.filePath ?? input.path ?? input.AbsolutePath ?? input.Path), command = plain(input.command ?? input.CommandLine);
  if (READ_TOOL.test(name)) return { k:file ? [readKeyOfFile(file)] : [] };
  if (SEARCH_TOOL.test(name)) return { k:[keyOf(`c:${name}:${JSON.stringify(input)}`)] };
  if (!SHELL_TOOL.test(name) || typeof command !== "string" || !command) return { k:[] };
  const { files, parts, cwd } = commandReads(command, plain(input.workdir ?? input.Cwd ?? input.cwd) || a?.cwd || "");
  // Only Claude Code's shell stays in the folder a command left it in; the others start each command in the same one.
  if (a?.agent === "claude" && cwd !== a.cwd) a.cwd = cwd;
  return { k:[keyOf(`c:${command}`), ...files.map(readKeyOfFile)], n:parts };
}
const textChars = v => typeof v === "string" ? v.length : v == null ? 0 : JSON.stringify(v).length;
const resultChars = c => typeof c === "string" ? c.length : Array.isArray(c) ? c.reduce((n, x) => n + (x?.type === "image" ? IMAGE_CHARS : String(x?.text || "").length), 0) : 0;
// A tool's result goes with the request that asked for it. OpenCode and dsh give that request's usage after its tools have run, so theirs is the one still to come.
function noteRead(a, keys, c, ahead = false) {
  const { k, n } = Array.isArray(keys) ? { k:keys } : keys;
  (a.reads ||= []).push({ q:ahead ? a.requests.length : Math.max(0, a.requests.length - 1), k, c:Math.round(c), ...(n > 1 ? { n } : {}) });
}
function observeReads(a, o, threadId) {
  // OpenCode: a finished tool, with what it was given and what it gave back.
  if (o.type === "tool_use" && o.part?.state && ["completed", "error"].includes(o.part.state.status)) noteRead(a, readKeys(o.part.tool, o.part.state.input, a), textChars(o.part.state.output ?? o.part.state.error), true);
  // dsh: the call, then its result.
  if (o.type === "tool_call" && o.callId) (a.pendingTools ||= {})[o.callId] = readKeys(o.tool, typeof o.input === "string" ? (() => { try { return JSON.parse(o.input); } catch { return {}; } })() : o.input, a);
  if (o.type === "tool_result" && o.callId && a.pendingTools?.[o.callId]) { noteRead(a, a.pendingTools[o.callId], textChars(o.result), true); delete a.pendingTools[o.callId]; }
  // Antigravity: a tool step, once it is done.
  const step = o.event === "step_update" ? o.step_update : null;
  if (step?.step_type === "tool" && step.state === "DONE") { const info = step.tool_info || {}; noteRead(a, readKeys(step.tool_name || info.name, info.parameters, a), textChars(info.error?.message || info.output)); }
  // Pi and omp: a tool starts after the message that asked for it, and ends with its result.
  if (o.type === "tool_execution_start" && o.toolCallId) (a.pendingTools ||= {})[o.toolCallId] = readKeys(o.toolName, o.args, a);
  if (o.type === "tool_execution_end" && a.pendingTools?.[o.toolCallId]) { noteRead(a, a.pendingTools[o.toolCallId], resultChars(o.result?.content)); delete a.pendingTools[o.toolCallId]; }
  // Kimi, from its own conversation log.
  if (o.type === "context.append_loop_event" && o.event?.type === "tool.call" && o.event.toolCallId) (a.pendingTools ||= {})[o.event.toolCallId] = readKeys(o.event.name, o.event.args, a);
  if (o.type === "context.append_loop_event" && o.event?.type === "tool.result" && a.pendingTools?.[o.event.toolCallId]) { noteRead(a, a.pendingTools[o.event.toolCallId], textChars(o.event.result?.output ?? o.event.result)); delete a.pendingTools[o.event.toolCallId]; }
  if (o.type === "assistant" && !o.parent_tool_use_id && !o.isSidechain)
    for (const c of o.message?.content || []) if (c?.type === "tool_use" && c.id) (a.pendingTools ||= {})[c.id] = readKeys(c.name, c.input, a);
  if (o.type === "user" && !o.parent_tool_use_id && !o.isSidechain && Array.isArray(o.message?.content))
    for (const c of o.message.content) if (c?.type === "tool_result" && a.pendingTools?.[c.tool_use_id]) {
      noteRead(a, a.pendingTools[c.tool_use_id], resultChars(c.content)); delete a.pendingTools[c.tool_use_id];
      // Claude Code says so when it puts its shell back in the folder it started in.
      const back = /Shell cwd was reset to (.+)\s*$/.exec(typeof c.content === "string" ? c.content.slice(-600) : Array.isArray(c.content) ? String(c.content.at(-1)?.text || "").slice(-600) : "");
      if (back) a.cwd = back[1].trim();
    }
  if (o.method === "item/completed" && (!threadId || o.params?.threadId === threadId)) {
    const item = o.params?.item || {};
    if (item.type === "commandExecution") {
      // Codex names the files of a command it can follow; one it cannot comes as a single action holding the whole of it.
      const acts = (item.commandActions || []).map(x => x.type === "read" && x.path ? { files:[x.path], parts:1 } : x.type === "unknown" ? commandReads(x.command, item.cwd) : { files:[], parts:1 });
      noteRead(a, { k:[keyOf(`c:${item.command || ""}`), ...acts.flatMap(x => x.files).map(readKeyOfFile)], n:acts.reduce((n, x) => n + x.parts, 0) }, String(item.aggregatedOutput || "").length);
    } else if (item.type === "fileChange" || item.type === "mcpToolCall" || item.type === "webSearch") noteRead(a, [], 0);
  }
}

// Takes provider records, never prompt/transcript byte sizes. Snapshots replace, rather than add to, earlier snapshots.
function observe(e, a, o, { threadId = "", turnId = "", at = Date.now() } = {}) {
  if (!o || typeof o !== "object" || a.endedAt) return false;
  const before = { ...a.totals }; let touched = false;
  if (o.type === "system" && o.subtype === "init") { a.sessionId = o.session_id || a.sessionId; if (o.cwd) a.cwd = o.cwd; return true; }
  // Reads are saved with the next usage report, not on their own.
  observeReads(a, o, threadId);
  if (o.type === "assistant" && !o.parent_tool_use_id && !o.isSidechain && o.message?.model !== "<synthetic>") {
    const m = o.message || {}, id = m.id;
    if (!a.firstSeen) { a.firstSeen = true; a.firstMissing = !id; }
    if (id && m.usage) {
      request(a, id, normalize(m.usage, o.usage_format === "harness" ? "harness" : "anthropic"), m.model, at);
      a.source = "Assistant request usage"; touched = true;
      a.totals = a.reported ? maximum(add(a.requests), a.reported) : add(a.requests);
    } else if (!a.requests.length) { a.firstMissing = true; touched = true; }
  }
  // One Claude process can run several turns (a steered Work, an answered question). Each result's usage is its own turn only,
  // and can be all zero, so the turns are added up. (modelUsage is no help: a resumed session carries its earlier Works' usage in it.)
  // Streamed requests report only a placeholder for their output, and a turn cut off has no result, so the totals are whichever is larger, field by field.
  if (o.type === "result" && a.agent === "claude" && o.usage) {
    // The same result seen twice (a repeated line) is one turn.
    const turn = normalize(o.usage, "anthropic"), id = o.uuid || JSON.stringify([o.session_id, o.num_turns, o.duration_ms, o.usage]);
    if (known(turn.inputTokens) && !(a.results ||= []).includes(id)) { a.results.push(id); a.reported = add([a.reported, turn]); a.totals = maximum(add(a.requests), a.reported); a.authoritative = true; a.source = "Claude invocation usage"; a.complete = true; touched = true; }
  }
  if (o.method === "thread/tokenUsage/updated") {
    const p = o.params || {};
    if (!threadId || p.threadId !== threadId || (turnId && p.turnId !== turnId)) return false;
    const total = normalize(p.tokenUsage?.total), last = normalize(p.tokenUsage?.last), base = a.cumulativeBaseline;
    if (known(total.inputTokens)) {
      if (a.lastCumulative && total.inputTokens < a.lastCumulative.inputTokens) { a.counterReset = true; a.complete = false; return false; }
      // A resumed thread first repeats its earlier total. That snapshot is no request of this attempt.
      if (!a.lastCumulative && base && known(base.inputTokens) && total.inputTokens <= base.inputTokens) return false;
      const advanced = !a.lastCumulative || total.inputTokens > a.lastCumulative.inputTokens;
      if (advanced && known(last.inputTokens)) {
        if (!a.firstSeen) { a.firstSeen = true; a.firstMissing = !base || !known(base.inputTokens) || total.inputTokens - base.inputTokens !== last.inputTokens; }
        request(a, `${threadId}:${turnId}:${total.inputTokens}`, last, o.model || p.model || a.model, at);
      } else if (!advanced && a.requests.length) {
        request(a, a.requests.at(-1).id, last, o.model || p.model || a.model, at);
      } else if (advanced && !a.firstSeen) { a.firstSeen = true; a.firstMissing = true; }
      a.lastCumulative = maximum(a.lastCumulative, total);
      if (base && known(base.inputTokens) && total.inputTokens >= base.inputTokens) {
        a.totals = Object.fromEntries(FIELDS.map(k => [k, known(total[k]) && known(base[k]) && total[k] >= base[k] ? total[k] - base[k] : null]));
        a.complete = !a.counterReset && known(a.totals.inputTokens) && known(a.totals.outputTokens);
      }
      a.source = "Codex thread cumulative usage minus pre-attempt baseline"; touched = true;
    }
  }
  if (o.type === "turn.completed" && o.usage) {
    a.totals = normalize(o.usage); a.source = "Codex CLI invocation usage"; a.complete = known(a.totals.inputTokens); touched = true;
  }
  if (o.type === "message_end" && o.message?.role === "assistant" && o.message.usage) {
    const m = o.message, u = m.usage;
    const mapped = { inputTokens:u.input, outputTokens:u.output, cacheReadTokens:u.cacheRead, cacheWriteTokens:u.cacheWrite };
    const id = m.id || m.timestamp;
    if (!a.firstSeen) { a.firstSeen = true; a.firstMissing = !id; }
    if (id) { request(a, String(id), normalize(mapped,"harness"), m.model, at); a.totals = add(a.requests); a.source = "Pi assistant usage"; touched = true; }
  }
  // One model request each, as the agent reports it. All but Antigravity give input apart from cache reads; OpenCode gives reasoning apart from output.
  const each = (id, usage, model, source) => { if (!a.firstSeen) { a.firstSeen = true; a.firstMissing = false; } request(a, id, usage, model, at); a.totals = add(a.requests); a.source = source; touched = true; };
  if (o.type === "status" && o.phase === "step_end" && o.usage) each(`dsh:${o.turn ?? ""}:${o.step ?? a.requests.length}`, normalize(o.usage, "harness"), "", "dsh step usage");
  if (o.type === "step_finish" && o.part?.tokens) {
    const t = o.part.tokens, out = known(t.output) ? t.output + (known(t.reasoning) ? t.reasoning : 0) : null;
    each(String(o.part.messageID || o.part.id || a.requests.length), normalize({ inputTokens:t.input, outputTokens:out, cacheReadTokens:t.cache?.read, cacheWriteTokens:t.cache?.write, totalTokens:t.total }, "harness"), openCodeModel(o.part) || openCodeModel(o), "OpenCode step usage");
  }
  if (o.event === "step_update" && o.step_update?.usage && o.step_update.state === "DONE") {
    const s = o.step_update, u = s.usage, read = known(u.cache_read_tokens) ? u.cache_read_tokens : null;
    // Its input leaves out the cache reads, and its output holds the thinking.
    each(`${s.conversation_id || ""}:${s.step_index}`, normalize({ inputTokens:known(u.input_tokens) ? u.input_tokens + (read || 0) : null, outputTokens:u.output_tokens, cachedInputTokens:read }), "", "Antigravity step usage");
  }
  if (o.type === "usage.record" && o.usage) {
    const u = o.usage;
    each(`kimi:${o.time ?? a.requests.length}`, normalize({ inputTokens:u.inputOther, outputTokens:u.output, cacheReadTokens:u.inputCacheRead, cacheWriteTokens:u.inputCacheCreation ?? 0 }, "harness"), o.model, "Kimi usage record");
  }
  if (!touched) return false;
  compare(e,a);
  const delta = Object.fromEntries(FIELDS.map(k => [k, known(a.totals[k]) ? a.totals[k] - (before[k] || 0) : null]));
  if (FIELDS.some(k => delta[k]) || known(a.totals.inputTokens) && !known(before.inputTokens)) a.events.push({ at, ...delta });
  return true;
}
// Streamed Claude requests carry only a placeholder for their output until their turn's result, so a running Work's percent read high.
// Claude's transcript has each request's real output once that request ends. Only requests this attempt already has are settled,
// so a resumed conversation's earlier Works are never counted. Returns the ids it did not know yet.
function settleOutput(e, a, messages, at = Date.now()) {
  const before = { ...a.totals }, unknown = [];
  let touched = false;
  for (const m of messages || []) {
    const row = m?.id && m.usage ? a.requests.find(r => r.id === m.id) : null;
    if (!row) { if (m?.id) unknown.push(m.id); continue; }
    const out = normalize(m.usage, "anthropic").outputTokens;
    if (known(out) && out > (row.outputTokens || 0)) { row.outputTokens = out; touched = true; }
  }
  if (touched) {
    a.totals = a.reported ? maximum(add(a.requests), a.reported) : add(a.requests);
    const delta = Object.fromEntries(FIELDS.map(k => [k, known(a.totals[k]) ? a.totals[k] - (before[k] || 0) : null]));
    if (FIELDS.some(k => delta[k])) a.events.push({ at, ...delta });
  }
  return { touched, unknown };
}
function finish(e, a, at = Date.now()) {
  a.endedAt = at; delete a.pendingTools; delete a.cwd; compare(e,a);
  if (e.startup.status === "pending") { e.startup.status = "unavailable"; e.startup.reason = "The first request was not fully measured"; }
}
// The comparison made again, for evidence whose requests were filled in later.
function recompare(e) {
  if (e.taskMode !== "new" || !e.attempts[0]) return e;
  e.startup = { ...e.startup, status:"pending", first:null, difference:null };
  compare(e, e.attempts[0]);
  if (e.startup.status === "pending") { e.startup.status = "unavailable"; e.startup.reason = "The first request was not fully measured"; }
  return e;
}
function recordModel(e, a, value) {
  const model = concreteModel(value);
  if (!model) return;
  a.model = model;
  for (const row of a.requests) if (!concreteModel(row.model)) row.model = model;
  compare(e,a);
}
function recordRequestModels(e, a, models) {
  for (const row of a.requests) {
    const model = concreteModel(models.get(row.id));
    if (model) row.model = model;
  }
  compare(e, a);
}
function summary(e, { events = true } = {}) {
  if (!e || e.schemaVersion !== 1 || !e.startup || !Array.isArray(e.attempts) || e.attempts.some(a=>!a || !Array.isArray(a.requests) || !Array.isArray(a.events) || !a.totals)) return null;
  // A Claude attempt never counts less than its own requests: evidence saved while each turn's result replaced its totals can hold less.
  const totals = add(e.attempts.map(a=>a.agent === "claude" && a.requests.length ? maximum(add(a.requests), a.totals) : a.totals)), measured = e.attempts.filter(a=>known(a.totals.inputTokens));
  const lastAttempt = [...e.attempts].reverse().find(a=>a.requests.some(r=>known(r.inputTokens)));
  const last = lastAttempt && [...lastAttempt.requests].reverse().find(r=>known(r.inputTokens));
  // The models its conversation ran on, when its last request does not say them all: what is in each one's cache (otherModel).
  const inConversation = lastAttempt ? e.attempts.filter(a=>a === lastAttempt || a.sessionId && a.sessionId === lastAttempt.sessionId) : [];
  const lastModels = [...new Set(inConversation.flatMap(a=>a.requests.map(r=>concreteModel(r.model) || concreteModel(a.model || ""))))];
  const requestModelId = e.attempts.at(-1)?.requests.findLast(r => concreteModel(r.model))?.model || "";
  const requests = e.attempts.reduce((n,a)=>n+a.requests.filter(r=>known(r.inputTokens)).length,0);
  // Every measured request in order, as [input, cache reads, cache writes, output], and what each one's tool results read.
  // They are for the comparison on the server; the service drops them before a page gets the summary.
  const series = [], reads = [];
  for (const a of e.attempts) {
    const offset = series.length;
    for (const r of a.requests) if (known(r.inputTokens)) series.push([r.inputTokens, r.cacheReadInputTokens || 0, r.cacheWriteInputTokens || 0, r.outputTokens || 0]);
    for (const x of a.reads || []) reads.push([offset + x.q, x.k, x.c, x.n]);
  }
  const readsKnown = readsRecorded(e);
  const row = { workId:e.workId, taskId:e.taskId, taskMode:e.taskMode, continuedFromWork:e.continuedFromWork, createdAt:e.createdAt,
    ...totals, attempts:e.attempts.length, measuredAttempts:measured.length, requests, series, reads, readsKnown, readsVersion:e.readsVersion,
    coverage:measured.length ? !e.historyIncomplete && e.attempts.every(a=>a.complete) ? "reported totals" : "partial" : "unavailable" };
  // Meant to continue, but no conversation of its own could be resumed (settings changed, open elsewhere, another agent's): it started a new one.
  const startup = e.startup.status === "continuation" && e.attempts[0]?.resumed === false
    ? { ...e.startup, status:"recovered", reason:"Meant to continue, but no earlier conversation could be resumed, so it started a new one" } : e.startup;
  const ranModel = concreteModel(e.attempts[0]?.model || "") || concreteModel(e.attempts.findLast(a => concreteModel(a.model || ""))?.model || "");
  const firstStart = requestModel(startup.first);
  const normalizedStartup = { ...startup, first:firstStart && !firstStart.model && ranModel ? { ...firstStart, model:ranModel } : firstStart, baseline:requestModel(startup.baseline) };
  return { ...row, startup:withEstimate({ ...row, startup:normalizedStartup }).startup, manifest:e.manifest,
    ...(e.backfilled ? { backfilled:e.backfilled } : {}), ...(e.decision ? { decision:e.decision } : {}),
    lastRequest:last ? { requestId:last.id, input:last.inputTokens, model:concreteModel(last.model), ...(lastModels.length > 1 || lastModels[0] !== concreteModel(last.model) ? { models:lastModels } : {}), agent:lastAttempt.agent, config:lastAttempt.config, sessionId:lastAttempt.sessionId, at:last.at, workId:e.workId, taskId:e.taskId } : null,
    requestModel:concreteModel(requestModelId),
    // Historical requests can carry the exact key of a gateway-specific saved price.
    ...(requestModelId.includes("/") ? { requestModelId } : {}),
    cumulative:e.attempts.at(-1)?.lastCumulative || null,
    // These events are small usage deltas. They allow time ranges to use observation times, even when a Work crosses midnight.
    ...(events ? { events:e.attempts.flatMap(a=>a.events) } : {}),
    qualification:"The start is measured on both sides. The rest of the resumed side is an estimate: this Work's own requests, each carrying the earlier conversation instead of the fresh start, minus what this Work re-read that the earlier conversation had already read. Cost weighs each kind of token by its list price, cache hits and writes included.",
    helperCoverage:"Internal helper usage is included only where the runner reports it in its totals." };
}
// A new task stored before its baseline was known (an older Work was measured later, from the run log) is compared when shown.
// `prior` holds the read keys of the conversation it would have resumed, when PenEcho recorded them.
function withBaseline(row, baseline, prior = null, exact = false) {
  if (!row || row.taskMode !== "new" || !row.startup?.first) return row;
  if (exact) {
    const first = row.startup.first;
    return withEstimate({ ...row, startup:{ first, ...startupAgainst(first, baseline) } }, prior);
  }
  if (row.startup.status === "compared") {
    // A conversation read back from the run log knows only when its Work started; the service passes its end, which is when its cache was last used.
    // Nor did a comparison made before PenEcho kept them know every model that conversation ran on.
    const b = row.startup.baseline, same = baseline && b && baseline.requestId === b.requestId, at = same && baseline.at > (b.at || 0) ? baseline.at : b?.at, models = same && baseline.models;
    return withEstimate(models || at !== b?.at ? { ...row, startup:{ ...row.startup, baseline:{ ...b, at, ...(models ? { models } : {}) } } } : row, prior);
  }
  if (!baseline) return row;
  return withEstimate({ ...row, startup:{ ...row.startup, ...startupAgainst(row.startup.first, baseline) } }, prior);
}
// Whether the earlier conversation ran on another model than this Work, so nothing of it is in this model's cache: of the recorded
// changes of model, all 11 inside a Codex Work and all 10 resumes within the hour (Claude Code 7, Codex 3) found at most the instructions
// every conversation shares; the one resume that found more had run on the new model before. Only a sure difference counts. A name with no version ("opus") can be any of
// a family; a date, a context size or an effort in the name is the same model; a connection's own id names no model.
function cacheModel(value) {
  const model = concreteModel(String(value || "")).toLowerCase().replace(/[[(#@:].*$/, "").replace(/-(?:latest|20\d{6}|20\d\d-\d\d-\d\d)$/, "").replace(/-(?:minimal|low|medium|high|xhigh|max)$/, "");
  return /\d/.test(model) && !/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(model) ? model : "";
}
function otherModel(first, baseline) {
  const now = cacheModel(first.model), held = (baseline.models || [baseline.model]).map(cacheModel);
  return Boolean(now) && held.every(m => m && m !== now);
}
const share = (part, whole) => whole > 0 ? Math.round(1000 * part / whole) / 10 : null;
// Fresh start against resuming, for the same work. Both are worked out from this Work's own requests.
// - Fresh: what the agent reported, each kind of token weighed by its list price.
// - Resumed: each request carries the earlier conversation (its last request) instead of the fresh start. What this Work re-read
//   that the earlier conversation had already read is taken out, and so is a request that only re-read. When the earlier conversation's
//   reads were not recorded, every read of this Work counts as a re-read, which can only make the saving smaller.
// - Cache: within the agent's cache time the earlier conversation is a cache hit; once no cache could still hold it, the whole
//   conversation is written again. Between the two, and when the pause is not known, nobody knows: it is counted as a hit, the
//   smaller saving, and the other figure is given beside it. A model cannot read what another wrote to its cache: after a change of
//   model the whole conversation is written again, however short the pause ("model").
// - Misses: when a request found less of this Work's own context in the cache than its last request sent, as Gemini's cache sometimes
//   drops a whole conversation mid-Work, resuming loses that much too. The earlier conversation, cached long before, is counted as kept.
// - Other contexts: a request smaller than the conversation so far is a helper the agent started, or the conversation made shorter.
//   It does not carry the earlier conversation, so it is the same request, at the same cost, on both sides.
function compareCost(row, c, prior) {
  const series = row.series || [];
  if (!series.length) return null;
  const w = pricesFor(c.first.agent, c.first.model), F0 = series[0][0], P = c.baseline.input;
  const idle = c.first.at && c.baseline.at ? Math.max(0, c.first.at - c.baseline.at) / 60000 : null;
  const cache = otherModel(c.first, c.baseline) ? "model" : idle == null ? "unknown" : idle < w.cacheMinutes ? "warm" : idle >= w.cacheMost ? "expired" : "unknown", warm = cache === "warm" || cache === "unknown";
  const priorKeys = prior?.keys instanceof Set ? prior.keys : null;
  const rereadsHow = !row.readsKnown ? "not recorded" : priorKeys ? "matched" : "every read counted";
  const byRequest = new Map();
  for (const [q, keys, chars, parts] of row.readsKnown ? row.reads || [] : []) {
    const had = keys.length > 0 && (!priorKeys || keys.some(k => priorKeys.has(k)));
    // A command that printed several things counts for the part of them that was read before, unless the whole of it was run before.
    const again = !had ? 0 : !(parts > 1) || !priorKeys || priorKeys.has(keys[0]) ? 1 : keys.slice(1).filter(k => priorKeys.has(k)).length / parts;
    const r = byRequest.get(q) || { results:0, again:0, tokens:0 };
    r.results++; if (again === 1) r.again++; r.tokens += again * chars / CHARS_PER_TOKEN;
    byRequest.set(q, r);
  }
  // Output is the same work on both sides. A streamed request may report only part of its output, so the Work's reported total is used.
  const streamedOut = series.reduce((n, r) => n + r[3], 0), output = known(row.outputTokens) && row.outputTokens > streamedOut ? row.outputTokens : streamedOut;
  const weigh = ([input, read, write]) => Math.max(0, input - read - write) * w.input + read * w.read + write * w.write;
  const fresh = { tokensIn:series.reduce((n, r) => n + r[0], 0), cost:series.reduce((n, r) => n + weigh(r), 0) + output * w.output };
  const resumedRows = [], inMain = [];
  let carried = 0, skipped = 0, skippedOut = 0, reread = 0, main = F0;
  series.forEach(([input, read, , out], i) => {
    if (i && input < main) { resumedRows.push({ size:input, same:weigh(series[i]) }); return; }
    const r = byRequest.get(i), onlyAgain = i > 0 && r && r.results === r.again;
    const lost = i ? Math.max(0, main - Math.max(read, F0)) : 0; main = input; inMain[i] = true;
    if (onlyAgain) { skipped++; skippedOut += out; } else resumedRows.push({ size:Math.max(P, P + input - F0 - carried), lost });
    // Context from here on would not hold what was read again, nor a request that only read again.
    const tokens = r?.tokens || 0; reread += tokens; carried += tokens + (onlyAgain ? out : 0);
  });
  const outputCost = (output - skippedOut) * w.output;
  // `earlier` is what carrying the earlier conversation costs: its tokens, read from the cache or written to it again, in every request.
  const resumedCost = startWarm => {
    // A cold start still finds the part every conversation shares (system prompt, tools) in the cache, as the fresh start did.
    let held = startWarm ? P : Math.min(series[0][1], P), context = 0, earlier = 0;
    for (const { size, lost, same } of resumedRows) {
      if (same != null) { context += same; continue; }
      const hit = Math.max(0, Math.min(held, size) - lost), kept = Math.min(hit, P);
      context += hit * w.read + (size - hit) * w.write; earlier += kept * w.read + (P - kept) * w.write; held = size;
    }
    return { cost:context + outputCost, earlier, own:context - earlier };
  };
  const tokensIn = resumedRows.reduce((n, { size }) => n + size, 0), resumed = resumedCost(warm), other = resumedCost(!warm);
  // The fresh start's own tokens (its first request) are sent again with every later request too, from the cache where the request read that much.
  const freshStart = series.reduce((n, r, i) => { if (!i) return n + weigh(r); if (!inMain[i]) return n; const hit = Math.min(r[1], F0); return n + hit * w.read + (F0 - hit) * w.input; }, 0);
  const dollars = cost => w.usd ? { usd:Math.round(cost * w.usd * 1e4) / 1e4 } : {};
  return { fresh:{ tokensIn:fresh.tokensIn, cost:Math.round(fresh.cost), ...dollars(fresh.cost) }, resumed:{ tokensIn:Math.round(tokensIn), cost:Math.round(resumed.cost), ...dollars(resumed.cost) },
    tokensPercent:share(tokensIn - fresh.tokensIn, tokensIn), costPercent:share(resumed.cost - fresh.cost, resumed.cost),
    cache, idleMinutes:idle == null ? null : Math.round(idle), cacheMinutes:w.cacheMinutes,
    ...(cache === "model" ? {} : { otherCache:{ cache:warm ? "expired" : "warm", costPercent:share(other.cost - fresh.cost, other.cost) } }),
    // What each side's cost is made of, for the page's picture, the same three parts on both: what every request sends again
    // (the fresh start, or the earlier conversation), this Work's own context, and output.
    parts:{ fresh:[freshStart, fresh.cost - output * w.output - freshStart, output * w.output].map(Math.round), resumed:[resumed.earlier, resumed.own, outputCost].map(Math.round) },
    rereadTokens:Math.round(reread), rereads:rereadsHow, skippedRequests:skipped, prices:w };
}
function withEstimate(row, prior = null) {
  const c = row?.startup;
  if (!c || c.status !== "compared" || !known(c.baseline?.input)) return row;
  const requests = row.requests || 0, percent = c.baseline.input ? Math.round(100 * c.difference / c.baseline.input) : null;
  const cost = c.first ? compareCost(row, c, prior) : null;
  // Tokens saved over the task: the resumed estimate minus what the fresh start used.
  const taskEstimate = cost ? cost.resumed.tokensIn - cost.fresh.tokensIn : requests ? c.difference * requests : c.difference;
  return { ...row, startup:{ ...c, percent, requests, taskEstimate, ...(cost ? { cost } : {}) } };
}
// Works compared in money terms: totals on both sides, so a big Work weighs more than a small one.
function costTotals(starts) {
  const rows = starts.map(e => e.startup?.cost || e.cost).filter(Boolean);
  if (!rows.length) return null;
  const sum = (side, k) => rows.reduce((n, r) => n + r[side][k], 0);
  const fresh = { tokensIn:sum("fresh", "tokensIn"), cost:sum("fresh", "cost") }, resumed = { tokensIn:sum("resumed", "tokensIn"), cost:sum("resumed", "cost") };
  // One Work's cost is in its own model's new-input tokens, and models are priced apart: added up, only dollars are money. With every
  // Work's price saved the percent is of dollars; with one missing it is of those tokens, as before.
  const priced = rows.every(r => r.fresh.usd != null && r.resumed.usd != null);
  if (priced) { fresh.usd = Math.round(sum("fresh", "usd") * 1e4) / 1e4; resumed.usd = Math.round(sum("resumed", "usd") * 1e4) / 1e4; }
  return { works:rows.length, fresh, resumed, tokensPercent:share(resumed.tokensIn - fresh.tokensIn, resumed.tokensIn),
    costPercent:priced ? share(resumed.usd - fresh.usd, resumed.usd) : share(resumed.cost - fresh.cost, resumed.cost) };
}
// Per-row UTC daily sums cached by the row's immutable events array so rebuilding project totals when one active Work updates
// never re-formats tens of thousands of historical timestamps with Date.prototype.toISOString (PE-988).
const rowDailyCache = new WeakMap();
function dailyOfEvents(events) {
  if (!Array.isArray(events) || !events.length) return [];
  const len = events.length, last = events[len - 1];
  let cached = rowDailyCache.get(events);
  if (cached && cached.len === len && cached.last === last) return cached.list;
  const days = new Map();
  for (const event of events) {
    const day = new Date(event.at).toISOString().slice(0, 10);
    let totals = days.get(day);
    if (!totals) { totals = empty(); days.set(day, totals); }
    for (const k of FIELDS) if (known(event?.[k])) totals[k] = (totals[k] || 0) + event[k];
  }
  const list = [...days.entries()];
  rowDailyCache.set(events, { len, last, list });
  return list;
}
function aggregate(rows, since = 0, until = Infinity) {
  const entries = [...new Map(rows.filter(Boolean).map(e=>[e.workId,e])).values()];
  const starts = entries.filter(e=>e.taskMode === "new" && (e.startup?.first?.at || e.createdAt || 0) >= since && (e.startup?.first?.at || e.createdAt || Infinity) < until);
  const compared = starts.filter(e=>e.startup.status === "compared");
  const whole = since === 0 && until === Infinity;
  const events = whole ? null : entries.flatMap(e=>e.events || []).filter(x=>x.at >= since && x.at < until);
  return { tasks:starts.length, compared:compared.length, difference:compared.length ? compared.reduce((n,e)=>n+e.startup.difference,0) : null,
    taskEstimate:compared.length ? compared.reduce((n,e)=>n+(e.startup.taskEstimate ?? e.startup.difference),0) : null,
    baseline:compared.length ? compared.reduce((n,e)=>n+e.startup.baseline.input,0) : null, cost:costTotals(compared),
    ...add(whole ? entries : events), works:entries.length, measuredWorks:entries.filter(e=>known(e.inputTokens)).length };
}
// The keys a Work's tool results read, for the next fresh start to match against. Null when they were not recorded.
const readKeysOf = row => row?.readsKnown ? new Set((row.reads || []).flatMap(x => x[1])) : null;
// The comparison data stays on the server.
const forPage = row => { if (!row) return row; const { series, reads, readsVersion, ...rest } = row; return rest; };
function projectSummary(entries) {
  const rows = [...new Map(entries.filter(Boolean).map(e=>[e.workId,e])).values()], days = new Map();
  for (const row of rows) for (const [day, part] of dailyOfEvents(row.events)) {
    let totals = days.get(day);
    if (!totals) { totals = empty(); days.set(day, totals); }
    for (const k of FIELDS) if (known(part[k])) totals[k] = (totals[k] || 0) + part[k];
  }
  return { ...aggregate(rows),timezone:"UTC",daily:[...days].map(([day,totals])=>({day,...totals})).sort((a,b)=>a.day.localeCompare(b.day)),
    starts:rows.filter(r=>r.taskMode === "new").map(r=>({workId:r.workId,at:r.startup.first?.at || r.createdAt,status:r.startup.status,difference:r.startup.difference,taskEstimate:r.startup.taskEstimate ?? null,baseline:r.startup.baseline?.input ?? null,cost:r.startup.cost || null})),
    records:rows.map(r=>({workId:r.workId,lineId:r.lineId,stepId:r.stepId,label:r.label,evidencePath:r.evidencePath,taskId:r.taskId,taskMode:r.taskMode,createdAt:r.createdAt,startup:r.startup,inputTokens:r.inputTokens,outputTokens:r.outputTokens,
      cacheReadInputTokens:r.cacheReadInputTokens,cacheWriteInputTokens:r.cacheWriteInputTokens,attempts:r.attempts,requests:r.requests,coverage:r.coverage,manifest:r.manifest,
      ...(r.decision ? { decision:r.decision } : {}),...(r.backfilled ? { backfilled:r.backfilled } : {}),...(r.lastRequest ? { lastRequest:r.lastRequest } : {})})) };
}
module.exports = { cacheModel, READS_VERSION, readsRecorded, hasUsage, recompare, startupAgainst, withBaseline, withEstimate, weightsFor, pricesFor, usePrices, readKeysOf, readKeyOfFile, commandReads, forPage, create, startAttempt, observe, settleOutput, finish, recordModel, recordRequestModels, summary, aggregate, projectSummary, normalize };
