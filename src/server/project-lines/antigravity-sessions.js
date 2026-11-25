"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fileURLToPath } = require("node:url");
const { loadSqlite } = require("./sqlite.js");
const { agyTool, said, clip, cleanThinking, TEXT_MAX } = require("./activity.js");
const { humanWords } = require("./agent-sessions.js");

const SUMMARY_SQL = "SELECT conversation_id, title, last_modified_time, workspace_uris, status, source, parent_conversation_id, nesting_depth, app_data_dir FROM conversation_summaries";
const PENECHO_PROMPT = /^(?:A person using PenEcho asks? for\b|This session is being continued from a previous conversation\b|The person (?:says:|decided:|approved the prototype)\b|That is enough questions\.\s*Do the work now\b|PenEcho could not use\b|They changed what they asked\b|Carry on where you stopped\.$)/i;
const SUMMARY_CACHE_MAX = 32, LIST_CACHE_MS = 60000;
const summaryCache = new Map(), listCache = new Map();
const statStamp = file => {
  try {
    const st = fs.statSync(file, { throwIfNoEntry:false });
    return st?.isFile() ? `${st.dev}:${st.ino}:${st.ctimeMs}:${st.mtimeMs}:${st.size}` : "";
  } catch { return ""; }
};
// SQLite increments its 4-byte file change counter at offset 24 on every non-WAL commit, catching rapid same-size updates even on coarse clocks.
function dbStamp(dbFile) {
  let st = null;
  try { st = fs.statSync(dbFile, { throwIfNoEntry:false }); } catch { st = null; }
  if (!st?.isFile()) return "";
  const wal = statStamp(`${dbFile}-wal`);
  let gen = "";
  if (!wal && Math.abs(Date.now() - st.mtimeMs) < 2000 && st.size >= 28) {
    let fd = null;
    try {
      fd = fs.openSync(dbFile, "r");
      const buf = Buffer.allocUnsafe(4);
      if (fs.readSync(fd, buf, 0, 4, 24) === 4) gen = `:${buf.readUInt32BE(0)}`;
    } catch { /* Fall back to stat stamp. */ }
    finally { if (fd !== null) { try { fs.closeSync(fd); } catch {} } }
  }
  return `${st.dev}:${st.ino}:${st.ctimeMs}:${st.mtimeMs}:${st.size}${gen}|${wal}`;
}
function antigravityDbStamp(env = process.env, home = "") {
  const stores = antigravityStores(env, home);
  return `${dbStamp(stores.desktop.db)}#${dbStamp(stores.cli.db)}`;
}

// Antigravity keeps separate app-data roots for its Desktop app (`~/.gemini/antigravity`) and CLI (`~/.gemini/antigravity-cli`),
// though both SQLite summary databases reconcile metadata across stores.
function resolveHome(env = process.env, home = "") {
  if (home && home !== os.homedir()) return home;
  return env.HOME || env.USERPROFILE || home || os.homedir();
}
function antigravityStores(env = process.env, home = "") {
  const base = resolveHome(env, home);
  const desktop = env.ANTIGRAVITY_HOME || path.join(base, ".gemini", "antigravity");
  const cli = env.ANTIGRAVITY_CLI_HOME || path.join(base, ".gemini", "antigravity-cli");
  return {
    desktop:{ kind:"desktop", dir:desktop, db:path.join(desktop, "conversation_summaries.db"), brain:path.join(desktop, "brain"), convs:path.join(desktop, "conversations"), via:"Antigravity" },
    cli:{ kind:"cli", dir:cli, db:path.join(cli, "conversation_summaries.db"), brain:path.join(cli, "brain"), convs:path.join(cli, "conversations"), via:"Antigravity CLI" },
  };
}

const cleanSessionId = id => String(id || "").trim().replace(/^(['"])(.*)\1$/, "$2");
const transcriptPath = (store, id) => (id ? path.join(store.brain, id, ".system_generated", "logs", "transcript_full.jsonl") : "");
const compactTranscriptPath = (store, id) => (id ? path.join(store.brain, id, ".system_generated", "logs", "transcript.jsonl") : "");
const hasFile = file => { try { return Boolean(file && fs.statSync(file, { throwIfNoEntry:false })?.isFile()); } catch { return false; } };
const hasState = (store, id) => hasFile(path.join(store.convs, `${id}.pb`)) || hasFile(path.join(store.convs, `${id}.db`));

// Each conversation's live brain directory and protobuf DB live in the single store that owns it.
function antigravityOwner(id, env = process.env, home = env.HOME || env.USERPROFILE || os.homedir()) {
  const clean = cleanSessionId(id);
  if (!clean || clean === "tempmediaStorage") return null;
  const stores = antigravityStores(env, home);
  if (hasFile(transcriptPath(stores.cli, clean)) || hasFile(compactTranscriptPath(stores.cli, clean))) return stores.cli;
  if (hasFile(transcriptPath(stores.desktop, clean)) || hasFile(compactTranscriptPath(stores.desktop, clean))) return stores.desktop;
  if (hasState(stores.cli, clean)) return stores.cli;
  if (hasState(stores.desktop, clean)) return stores.desktop;
  return null;
}

const antigravityInDesktop = (id, env = process.env) => antigravityOwner(id, env)?.kind === "desktop";
const antigravityHasSession = (id, env = process.env) => Boolean(antigravityOwner(id, env));

function antigravityTranscript(id, env = process.env, home = env.HOME || env.USERPROFILE || os.homedir()) {
  const clean = cleanSessionId(id), owner = antigravityOwner(clean, env, home);
  const file = owner ? transcriptPath(owner, clean) : "";
  return hasFile(file) ? file : "";
}
// Compact transcript keeps full PLANNER_RESPONSE.thinking summaries while truncating large tool outputs, making live reads fast.
function antigravityLiveTranscript(id, env = process.env, home = env.HOME || env.USERPROFILE || os.homedir()) {
  const clean = cleanSessionId(id), owner = antigravityOwner(clean, env, home);
  if (!owner) return "";
  const compact = compactTranscriptPath(owner, clean);
  if (hasFile(compact)) return compact;
  const full = transcriptPath(owner, clean);
  return hasFile(full) ? full : "";
}

function readSummaryRows(dbFile, stamp = dbStamp(dbFile)) {
  if (!stamp) return [];
  const cached = summaryCache.get(dbFile);
  if (cached && cached.stamp === stamp) return cached.rows;
  const sqlite = loadSqlite();
  if (!sqlite) return [];
  let db;
  try {
    db = new sqlite.DatabaseSync(dbFile, { readOnly:true });
    db.exec("PRAGMA busy_timeout = 1000");
    const rows = db.prepare(SUMMARY_SQL).all();
    const after = dbStamp(dbFile);
    if (after && after === stamp) {
      if (summaryCache.size >= SUMMARY_CACHE_MAX) summaryCache.clear();
      summaryCache.set(dbFile, { stamp:after, rows });
    } else summaryCache.delete(dbFile);
    return rows;
  } catch { return []; }
  finally { try { db?.close(); } catch { /* Already closed or failed to open. */ } }
}

function parseAntigravityTime(raw) {
  const text = String(raw || "").trim();
  if (!text) return 0;
  return Date.parse(text.replace(" ", "T")) || 0;
}

function urisToFolders(raw) {
  if (!raw) return [];
  let list;
  try { list = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    if (typeof item !== "string" || !item.trim()) continue;
    try {
      if (item.startsWith("file://")) out.push(fileURLToPath(item));
      else if (path.isAbsolute(item)) out.push(item);
    } catch { /* Ignore malformed workspace URI. */ }
  }
  return [...new Set(out)];
}

function mergeRow(existing, row, fromKind, owner, file) {
  const id = String(row.conversation_id || "").trim();
  if (!id) return existing;
  const ownsRow = fromKind === owner.kind;
  const title = String(row.title || "").trim();
  const updated = parseAntigravityTime(row.last_modified_time);
  const parent = String(row.parent_conversation_id || "").trim() || (Number(row.nesting_depth) > 0 ? "__subagent__" : "");
  const folders = urisToFolders(row.workspace_uris);
  const status = String(row.status || "").trim();
  if (!existing) {
    return { id, store:owner, file, ownsRow, title, updated, status, busy:status === "CASCADE_RUN_STATUS_RUNNING", parent, folders };
  }
  if ((ownsRow && !existing.ownsRow && title) || (!existing.title && title)) existing.title = title;
  if (updated > existing.updated) existing.updated = updated;
  if ((ownsRow && !existing.ownsRow && status) || (!existing.status && status)) { existing.status = status; existing.busy = status === "CASCADE_RUN_STATUS_RUNNING"; }
  if (ownsRow) existing.ownsRow = true;
  if (!existing.parent || (existing.parent === "__subagent__" && parent && parent !== "__subagent__")) existing.parent = parent;
  for (const folder of folders) if (!existing.folders.includes(folder)) existing.folders.push(folder);
  return existing;
}

// Reconciled summaries in both stores are merged per conversation_id and matched to the store whose brain holds the transcript.
// Cached per DB stamp (60 s backstop) so 3-second polling does not re-open SQLite and stat thousands of idle transcripts (PE-988).
function listAntigravityConversations(env = process.env, home = "") {
  const stores = antigravityStores(env, home);
  const dStamp = dbStamp(stores.desktop.db), cStamp = dbStamp(stores.cli.db), stamp = `${dStamp}#${cStamp}`;
  const cacheKey = `${stores.desktop.dir}\0${stores.cli.dir}`, now = Date.now(), cached = listCache.get(cacheKey);
  if (cached && cached.stamp === stamp && now - cached.at < LIST_CACHE_MS) {
    // Re-probe any entry that lacked a transcript file last time, in case it was created without touching the DB.
    for (const item of cached.list) {
      if (item.file) continue;
      const owner = antigravityOwner(item.id, env, home);
      if (owner) {
        const file = transcriptPath(owner, item.id);
        if (hasFile(file)) { item.store = owner; item.file = file; }
      }
    }
    return cached.list.map(item => ({ ...item, folders:[...item.folders] }));
  }
  // Collect rows from both DBs by id first so each unique conversation probes the filesystem once instead of twice.
  const grouped = new Map();
  for (const [store, st] of [[stores.desktop, dStamp], [stores.cli, cStamp]]) {
    for (const row of readSummaryRows(store.db, st)) {
      const id = String(row.conversation_id || "").trim();
      if (!id) continue;
      let pair = grouped.get(id);
      if (!pair) { pair = []; grouped.set(id, pair); }
      pair.push([store.kind, row]);
    }
  }
  const byId = new Map();
  for (const [id, rows] of grouped) {
    // Reuse a previously verified transcript path if still present, otherwise probe owner once.
    const prev = cached?.byId?.get(id);
    let owner = null, file = "";
    if (prev?.file && hasFile(prev.file)) { owner = prev.store; file = prev.file; }
    else {
      owner = antigravityOwner(id, env, home);
      if (owner) {
        const candidate = transcriptPath(owner, id);
        if (hasFile(candidate)) file = candidate;
      } else {
        const cliRow = rows.some(([, r]) => r.source === "CORTEX_TRAJECTORY_SOURCE_CLI" || r.app_data_dir === "antigravity-cli");
        owner = cliRow ? stores.cli : stores.desktop;
      }
    }
    let merged = null;
    for (const [fromKind, row] of rows) merged = mergeRow(merged, row, fromKind, owner, file);
    if (merged) byId.set(id, merged);
  }
  const list = [...byId.values()].sort((a, b) => b.updated - a.updated);
  if (listCache.size >= SUMMARY_CACHE_MAX) listCache.clear();
  listCache.set(cacheKey, { stamp, at:now, list, byId });
  return list.map(item => ({ ...item, folders:[...item.folders] }));
}

function antigravityTitle(env = process.env, id, home = env.HOME || env.USERPROFILE || os.homedir()) {
  const clean = cleanSessionId(id);
  if (!clean) return "";
  const stores = antigravityStores(env, home), owner = antigravityOwner(clean, env, home);
  const dbs = owner ? [owner.db, owner.kind === "desktop" ? stores.cli.db : stores.desktop.db] : [stores.desktop.db, stores.cli.db];
  const sqlite = loadSqlite();
  if (!sqlite) return "";
  for (const dbFile of dbs) {
    if (!hasFile(dbFile)) continue;
    let db;
    try {
      db = new sqlite.DatabaseSync(dbFile, { readOnly:true });
      db.exec("PRAGMA busy_timeout = 1000");
      const row = db.prepare("SELECT title FROM conversation_summaries WHERE conversation_id = ? LIMIT 1").get(clean);
      const title = String(row?.title || "").trim();
      if (title) return title;
    } catch { /* Try next store DB. */ }
    finally { try { db?.close(); } catch { /* Ignore close errors. */ } }
  }
  return "";
}

function extractUserRequest(raw) {
  const text = String(raw || "");
  const tagged = text.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/);
  if (tagged) return tagged[1].trim();
  return text
    .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g, "")
    .replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/g, "")
    .trim();
}

function mediaPath(uri) {
  const raw = String(uri || "").trim();
  if (!raw) return "";
  try {
    if (raw.startsWith("file://")) return fileURLToPath(raw);
    return path.isAbsolute(raw) ? raw : "";
  } catch { return ""; }
}

function parseAntigravityStep(line, { readPicture, key = "" } = {}) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return { at:0, changes:[] };
  let o;
  try { o = JSON.parse(trimmed); } catch { return { at:0, changes:[] }; }
  if (!o || typeof o !== "object") return { at:0, changes:[] };
  const at = Date.parse(o.created_at) || 0;
  if (o.type === "USER_INPUT" || o.source === "USER_EXPLICIT") {
    const raw = extractUserRequest(o.content);
    if (PENECHO_PROMPT.test(raw)) return { at, scripted:true, changes:[] };
    const text = humanWords(raw);
    const pictures = [];
    if (Array.isArray(o.media) && typeof readPicture === "function") {
      for (const item of o.media) {
        const file = mediaPath(item?.uri || item?.path);
        const pic = file && readPicture(file);
        if (pic) pictures.push({ name:path.basename(file), ...pic });
      }
    }
    if (!text && !pictures.length) return { at, changes:[] };
    return { at, turnOpen:true, changes:[{ me:text, ...(pictures.length ? { pictures } : {}), at }] };
  }
  if (o.type === "PLANNER_RESPONSE") {
    const changes = [], base = key || `step-${o.step_index ?? at}`;
    const calls = Array.isArray(o.tool_calls) ? o.tool_calls : [];
    const hasContent = typeof o.content === "string" && Boolean(o.content.trim());
    const thinking = typeof o.thinking === "string" ? cleanThinking(o.thinking) : "";
    if (thinking && (calls.length > 0 || !hasContent)) {
      changes.push({ add:{ kind:"say", thinking:true, id:`ag-think-${base}`, text:clip(thinking, TEXT_MAX) }, at });
    }
    for (let i = 0; i < calls.length; i++) {
      const tc = calls[i];
      if (!tc?.name) continue;
      const state = o.status === "RUNNING" ? "running" : o.status === "ERROR" || o.status === "INVALID" ? "failed" : "done";
      changes.push({ upsert:{ id:`ag-${base}-${i}`, state, ...agyTool(tc.name, tc.args || {}) }, at });
    }
    if (hasContent) {
      for (const item of said(o.content)) changes.push({ ...item, at });
    }
    return { at, changes };
  }
  if (o.type === "ERROR_MESSAGE") {
    const msg = clip(String(o.error || o.content || "Antigravity stopped with an error.").trim(), 500);
    return { at, changes:[{ add:{ kind:"note", text:msg }, failed:msg, at }] };
  }
  return { at, changes:[] };
}

module.exports = {
  antigravityStores,
  antigravityOwner,
  antigravityInDesktop,
  antigravityHasSession,
  antigravityTranscript,
  antigravityLiveTranscript,
  antigravityDbStamp,
  listAntigravityConversations,
  antigravityTitle,
  extractUserRequest,
  parseAntigravityStep,
};
