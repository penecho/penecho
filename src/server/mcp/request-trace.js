"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MAX_ARRAY_ITEMS = 32;
const MAX_OBJECT_KEYS = 64;
const MAX_STRING_CHARS = 8_000;
const MAX_VALUE_CHARS = 64_000;
const MAX_VALUE_NODES = 512;
const SECRET_KEY = /(?:^|[-_])(?:authorization|proxy[-_]?authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|resume[-_]?token|cookie|password|secret)(?:$|[-_])/i;
const SECRET_TEXT = /((?:authorization|proxy[-_]?authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|resume[-_]?token|cookie|password|secret)\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi;

function redactText(value, preserveImages = false) {
  return String(value)
    .replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, match => preserveImages ? match : "<encoded image omitted>")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1<redacted>")
    .replace(SECRET_TEXT, "$1<redacted>")
    .replace(/([?&](?:api[-_]?key|access[-_]?token|refresh[-_]?token|resume[-_]?token)=)[^&#\s]+/gi, "$1<redacted>")
    .replace(/\b(?:sk|xox[baprs]|gh[pousr])[-_][A-Za-z0-9_-]{12,}\b/g, "<redacted-token>");
}

function encodedBody(value, key, parent) {
  if (/^data:[^;,]+;base64,/i.test(value)) return true;
  if (value.length >= 512 && /^[A-Za-z0-9+/=]+$/.test(value)) return true;
  if (/^(?:dataUrl|imageUrl|base64|screenshot)$/i.test(key) && /^[A-Za-z0-9+/=\s]{128,}$/.test(value)) return true;
  return key === "data" && /^image\//i.test(String(parent?.mimeType || parent?.mediaType || ""));
}

function safeTraceValue(value) {
  const seen = new WeakSet();
  let remaining = MAX_VALUE_CHARS, remainingNodes = MAX_VALUE_NODES;

  function visit(item, key = "", parent = null, depth = 0) {
    if (remainingNodes-- <= 0) return "<value limit reached>";
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "number") return Number.isFinite(item) ? item : String(item);
    if (typeof item === "bigint") return String(item);
    if (typeof item === "string") {
      if (encodedBody(item, key, parent)) return "<encoded image omitted>";
      const redacted = redactText(item), limit = Math.max(0, Math.min(MAX_STRING_CHARS, remaining));
      remaining -= Math.min(redacted.length, limit);
      return redacted.length > limit ? `${redacted.slice(0, limit)}\n…[truncated]` : redacted;
    }
    if (typeof item !== "object") return String(item);
    if (item instanceof Error) return visit({ name:item.name, code:item.code, message:item.message }, key, parent, depth);
    if (depth >= 8) return "<maximum depth reached>";
    if (seen.has(item)) return "<circular reference>";
    seen.add(item);
    if (Array.isArray(item)) {
      const output = item.slice(0, MAX_ARRAY_ITEMS).map(entry => visit(entry, "", item, depth + 1));
      if (item.length > MAX_ARRAY_ITEMS) output.push(`<${item.length - MAX_ARRAY_ITEMS} items omitted>`);
      return output;
    }
    const output = {}, keys = Object.keys(item);
    for (const [index, name] of keys.slice(0, MAX_OBJECT_KEYS).entries()) {
      const secret = SECRET_KEY.test(name), safeName = secret ? `<secret field ${index + 1}>` : redactText(name).slice(0, 128);
      output[safeName] = secret ? "<redacted>" : visit(item[name], name, item, depth + 1);
    }
    if (keys.length > MAX_OBJECT_KEYS) output.traceFieldsOmitted = keys.length - MAX_OBJECT_KEYS;
    return output;
  }

  try { return visit(value); }
  catch (error) { return { serializationError:redactText(String(error?.message || "Could not serialize trace value.")).slice(0, 1_000) }; }
}

function isoTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function createMcpRequestTracer({ requestTraceDirectory, requestTraceLimit = 100, logger = () => {}, now = () => Date.now(), createRequestId = () => crypto.randomUUID() }) {
  if (!path.isAbsolute(requestTraceDirectory)) throw new TypeError("requestTraceDirectory must be an absolute path.");
  if (!Number.isInteger(requestTraceLimit) || requestTraceLimit < 1 || requestTraceLimit > 1_000) throw new TypeError("requestTraceLimit must be an integer between 1 and 1000.");
  const root = path.resolve(requestTraceDirectory), groups = new Map(), aliases = new Map();
  let rootAvailable = false;
  const hash = value => crypto.createHash("sha256").update(String(value)).digest("hex");
  const requestPattern = /^request-[0-9]{13}-[a-f0-9]{64}$/;
  const idleMs = 30 * 60 * 1000;
  const terminalStatuses = new Set(["done", "waiting", "error"]);
  const readOnlyTools = new Set(["penecho_read_file", "penecho_capture_canvas", "penecho_inspect_session"]);
  function report(error, requestId) {
    try { logger({ type:"mcp-request-trace-error", requestId, errorCode:String(error?.code || "write_failed").slice(0, 80) }); } catch {}
  }
  function guarded(trace, action) { try { return action(); } catch (error) { report(error, trace?.data?.requestId); } }
  function privateDirectory(directory) {
    for (let current = directory;; current = path.dirname(current)) {
      if (!["/var", "/tmp"].includes(current) && fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error("Symlinked trace directory");
      if (path.dirname(current) === current) break;
    }
    fs.mkdirSync(directory, { recursive:true, mode:0o700 });
    fs.chmodSync(directory, 0o700);
  }
  function file(directory, name, value) {
    const target = path.join(directory, name);
    const fd = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW, 0o600);
    try { fs.fchmodSync(fd, 0o600); fs.writeFileSync(fd, value); } finally { fs.closeSync(fd); }
  }
  function write(trace) { if (!trace.available) return; guarded(trace, () => {
    trace.data.updatedAt = isoTime(now());
    file(trace.directory, "trace.json", JSON.stringify(trace.data, null, 2));
    Object.assign(trace.record, {status:trace.data.status, completedAt:trace.data.completedAt, durationMs:trace.data.durationMs, queuedState:trace.data.queuedUpdate?.state});
    const group = trace.group;
    file(group.directory, "trace.json", JSON.stringify({schemaVersion:3, kind:"mcp-request", requestId:group.id, ...group.metadata, startedAt:isoTime(group.startedAt), updatedAt:trace.data.updatedAt, completedAt:group.completedAt || null, status:group.status || "working", boundary:group.boundary || null, pendingToolCalls:group.active.size, tools:group.records}, null, 2));
  }); }
  function payload(trace, label, value) { if (!trace.available) return; return guarded(trace, () => {
    let asset = 0; const assets = []; const seen = new WeakSet();
    function image(data, mime) {
      const extension = ({"image/png":"png", "image/jpeg":"jpg", "image/webp":"webp", "image/gif":"gif", "image/svg+xml":"svg"})[mime.toLowerCase()] || "bin";
      const filename = `${label}-image-${++asset}.${extension}`;
      assets.push({filename, mimeType:mime});
      file(trace.directory, filename, Buffer.from(data.replace(/\s/g, ""), "base64"));
      return filename;
    }
    function visit(item, key = "", parent = null) {
      if (typeof item === "string") {
        if (key === "data" && /^image\//i.test(String(parent?.mimeType || parent?.mediaType || ""))) { image(item, parent.mimeType || parent.mediaType); return item; }
        const replaced = item.replace(/data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/gi, (match, mime, data) => { image(data, mime); return match; });
        const text = redactText(replaced, true);
        if (/^(html|content|patch|text|source)$/i.test(key)) file(trace.directory, `${label}-source-${++asset}.${key === "html" ? "html" : "txt"}`, text);
        return text;
      }
      if (item === null || typeof item === "boolean" || typeof item === "number") return item;
      if (item instanceof Error) return visit({ name:item.name, code:item.code, message:item.message, stack:item.stack, details:item.details });
      if (item === undefined) return undefined;
      if (typeof item !== "object") return String(item);
      if (seen.has(item)) return "<circular reference>";
      seen.add(item);
      const output = Array.isArray(item) ? item.map(entry => visit(entry, "", item)) : Object.fromEntries(Object.keys(item).map(name => [name, SECRET_KEY.test(name) ? "<redacted>" : visit(item[name], name, item)]));
      seen.delete(item); return output;
    }
    const full = visit(value);
    if (assets.length) file(trace.directory, `${label}-images.json`, JSON.stringify(assets, null, 2));
    file(trace.directory, `${label}.json`, JSON.stringify(full, null, 2));
    file(trace.directory, `${label}.txt`, typeof full === "string" ? full : JSON.stringify(full, null, 2));
    return full;
  }); }
  function prune() { if (!rootAvailable) return; guarded(null, () => {
    privateDirectory(root);
    const entries = fs.readdirSync(root, { withFileTypes:true }).filter(entry => entry.isDirectory() && requestPattern.test(entry.name))
      .map(entry => ({ name:entry.name, time:fs.statSync(path.join(root, entry.name)).mtimeMs })).sort((a,b) => a.time-b.time);
    let excess = entries.length - requestTraceLimit;
    for (const entry of entries) {
      if (excess <= 0) break;
      const group = groups.get(entry.name);
      if (group?.active.size) continue;
      fs.rmSync(path.join(root, entry.name), {recursive:true, force:true}); excess--;
      groups.delete(entry.name);
      for (const [key, value] of aliases) if (value === group) aliases.delete(key);
    }
  }); }
  function bind(identity, group) { if (identity) aliases.set(identity, group); }
  function begin({ ownerId, name, arguments:args }) {
    const startedAt = now(), requestId = String(createRequestId()), owner = String(ownerId);
    const sessionIdentity = args?.sessionId ? `${owner}\0id:${args.sessionId}` : null;
    const keyIdentity = args?.sessionKey ? `${owner}\0key:${args.sessionKey}` : null;
    let group = aliases.get(sessionIdentity) || aliases.get(keyIdentity);
    // Guidance/discovery calls carry no sessionId. Attach only when attribution is unambiguous.
    if (!group) {
      const candidates = [...groups.values()].filter(g => g.owner === owner && !g.closed && startedAt - g.lastAt < idleMs &&
        ((!sessionIdentity && !keyIdentity && name !== "penecho_start_session") || !g.bound));
      if (candidates.length === 1) group = candidates[0];
      else if (!candidates.length && !sessionIdentity && !keyIdentity && name !== "penecho_start_session") group = aliases.get(`${owner}\0current`);
    }
    const expired = group && startedAt - group.lastAt >= idleMs && !group.active.size;
    const rollover = group && group.records.length >= 1024 && !group.active.size;
    if (!group || expired || rollover || group.closed && !readOnlyTools.has(name)) {
      const previous = group;
      const id = `request-${String(startedAt).padStart(13,"0")}-${hash(requestId)}`;
      group = {id, owner, directory:path.join(root, id), active:new Set(), records:[], startedAt, lastAt:startedAt, metadata:{ownerId:safeTraceValue(ownerId), sessionIds:[]}};
      groups.set(id, group);
      // A logical request can span reconnects to the same sessionKey.
      if (previous) for (const [key, value] of aliases) if (value === previous) bind(key, group);
      group.metadata.grouping = "session binding; terminal completion starts next request; 30-minute idle fallback";
      if (expired || rollover) group.metadata.startedBy = expired ? "idle-timeout" : "tool-limit";
    }
    group.lastAt = startedAt;
    bind(`${owner}\0current`, group);
    bind(sessionIdentity, group); bind(keyIdentity, group);
    if (sessionIdentity || keyIdentity || name === "penecho_start_session") group.bound = true;
    for (const key of ["sessionKey","title","client"]) if (args?.[key] !== undefined && group.metadata[key] === undefined) group.metadata[key] = safeTraceValue(args[key]);
    if (args?.sessionId && !group.metadata.sessionIds.includes(args.sessionId)) group.metadata.sessionIds.push(safeTraceValue(args.sessionId));
    const toolDirectory = `tool-${String(group.records.length + 1).padStart(4,"0")}-${hash(name).slice(0,12)}`;
    const record = {tool:safeTraceValue(name), path:`${toolDirectory}/trace.json`, startedAt:isoTime(startedAt), status:"running"};
    group.records.push(record);
    const terminal = name === "penecho_close_session" ? "done" : name === "penecho_update_session" ? args?.status : args?.completion?.status;
    const trace = { available:false, group, record, owner, terminal:terminalStatuses.has(terminal) ? terminal : null, directory:path.join(group.directory, toolDirectory), data:{schemaVersion:3, kind:"mcp-tool-call", requestId, startedAt:isoTime(startedAt), updatedAt:isoTime(startedAt), completedAt:null, durationMs:null, status:"running", request:{ownerId:safeTraceValue(ownerId), tool:safeTraceValue(name), arguments:safeTraceValue(args)}, browserInteractions:[], outcome:null, error:null} };
    group.active.add(trace);
    guarded(trace, () => { privateDirectory(root); rootAvailable = true; privateDirectory(group.directory); privateDirectory(trace.directory); trace.available = true; });
    payload(trace, "request", {ownerId, tool:name, arguments:args}); write(trace); prune(); return trace;
  }
  function closeRequest(trace) {
    if (!trace.terminal) return;
    trace.group.closed = true;
    trace.group.status = trace.terminal;
    trace.group.completedAt = isoTime(now());
    trace.group.boundary = trace.data.request.tool === "penecho_close_session" ? "close_session" : "completion.status";
  }
  function browserStarted(trace, {requestId, name, arguments:args, requestedAt}) {
    if (!trace) return null;
    const interaction = {requestId, name, requestedAt:isoTime(requestedAt), completedAt:null, durationMs:null, status:"pending", arguments:safeTraceValue(args), result:null, error:null};
    interaction.artifactPrefix = `browser-${trace.data.browserInteractions.length + 1}`;
    trace.data.browserInteractions.push(interaction);
    payload(trace, `${interaction.artifactPrefix}-request`, args); write(trace); return interaction;
  }
  function browserCompleted(trace, interaction, {result, timing}) {
    if (!trace || !interaction) return;
    Object.assign(interaction, {completedAt:isoTime(timing.completedAt), durationMs:timing.durationMs, status:"completed", result:safeTraceValue(result)});
    payload(trace, `${interaction.artifactPrefix}-response`, result); write(trace);
  }
  function browserFailed(trace, interaction, error, completedAt = now()) {
    if (!trace || !interaction) return;
    Object.assign(interaction, {completedAt:isoTime(completedAt), durationMs:Math.max(0, completedAt-new Date(interaction.requestedAt).getTime()), status:"failed", error:safeTraceValue(error)});
    payload(trace, `${interaction.artifactPrefix}-error`, error); write(trace);
  }
  function queuedUpdateOutcome(trace, state, details) {
    if (!trace) return;
    trace.data.queuedUpdate = {state, recordedAt:isoTime(now()), ...safeTraceValue(details)};
    payload(trace, "queued-outcome", {state, ...details});
    trace.group.active.delete(trace);
    if (state === "applied") closeRequest(trace);
    write(trace); prune();
  }
  function finish(trace, result, error) {
    if (!trace) return;
    if (!error && trace.data.request.tool === "penecho_start_session" && result?.sessionId) {
      aliases.set(`${trace.owner}\0id:${result.sessionId}`, trace.group);
      if (!trace.group.metadata.sessionIds.includes(result.sessionId)) trace.group.metadata.sessionIds.push(result.sessionId);
    }
    const completedAt = now();
    Object.assign(trace.data, {status:error ? "failed" : "completed", completedAt:isoTime(completedAt), durationMs:Math.max(0, completedAt-new Date(trace.data.startedAt).getTime()), outcome:error ? null : safeTraceValue(result), error:error ? safeTraceValue(error) : null});
    payload(trace, error ? "error" : "response", error || result);
    const queued = result?.accepted && result?.applied === false;
    if (error || !queued || trace.data.queuedUpdate) trace.group.active.delete(trace);
    if (!error && (!queued || trace.data.queuedUpdate?.state === "applied")) closeRequest(trace);
    write(trace);
    prune();
  }
  return {begin, browserCompleted, browserFailed, browserStarted, complete:(trace,result) => finish(trace,result,null), fail:(trace,error) => finish(trace,null,error), queuedUpdateOutcome};
}

module.exports = { createMcpRequestTracer, safeTraceValue };
