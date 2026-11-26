"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { Worker } = require("node:worker_threads");
const { openCodeModel } = require("./agent-model.js");
const { loadSqlite, requireSqlite } = require("./sqlite.js");

// OpenCode keeps its conversations in a SQLite database. Reading it directly, and only reading it, starts no OpenCode process,
// and sees what its app sees: an older command line on the same computer does not know the tables a newer app writes.
const MOST = 60;
const MODEL_ROWS = 64;
const parse = text => { try { return JSON.parse(text) || {}; } catch { return {}; } };

// Newer OpenCode writes each message as one row, with its parts inside. The rest of PenEcho reads the shape OpenCode's own export has.
function messageFromRow(row) {
  const d = parse(row.data), created = Number(d.time?.created) || Number(row.time_created) || 0;
  if (row.type === "user") {
    const words = d.metadata?.displayText ?? d.text ?? "", files = (d.files || []).map((file, i) => ({ id:`${row.id}:f${i}`, type:"file", mime:file.mime || "" }));
    return { info:{ id:row.id, role:"user", time:{ created } }, parts:[{ id:`${row.id}:t`, type:"text", text:words }, ...files] };
  }
  if (row.type !== "assistant") return null;
  const completed = Number(d.time?.completed) || 0, parts = [];
  (d.content || []).forEach((part, i) => {
    if (part?.type === "text") parts.push({ id:`${row.id}:${i}`, type:"text", text:part.text || "", ...(completed ? { time:{ end:completed } } : {}) });
    else if (part?.type === "tool") {
      const state = part.state || {}, output = (Array.isArray(state.content) ? state.content : []).filter(x => x?.type === "text").map(x => x.text).join("\n");
      parts.push({ id:part.id || `${row.id}:${i}`, callID:part.id, type:"tool", tool:part.name, state:{ status:state.status, input:state.input, output, error:state.error?.message ?? state.error } });
    }
  });
  if (d.error?.message && !parts.some(p => p.type === "text" && p.text.trim())) parts.push({ id:`${row.id}:error`, type:"text", text:`OpenCode stopped: ${d.error.message}`, ...(completed ? { time:{ end:completed } } : {}) });
  return { info:{ id:row.id, role:"assistant", model:d.model, time:{ created, ...(completed ? { completed } : {}) } }, parts };
}

// The recent ones are picked by when their messages were made, which an index holds. Only theirs are then read, for when one last changed:
// a person's whole history can be gigabytes.
function listSql(newer, older) {
  const recent = (sessions, messages, where = "") => `with recent as (select id, directory, parent_id, time_updated, (select max(time_created) from ${messages} m where m.session_id = s.id) as newest from ${sessions} s ${where} order by max(time_updated, coalesce(newest, 0)) desc limit ${MOST})
    select id, directory, parent_id, time_updated, (select max(time_updated) from ${messages} m where m.session_id = recent.id) as latest from recent order by max(time_updated, coalesce(latest, 0)) desc`;
  return [...(newer ? [recent("session_v2", "session_message")] : []), ...(older ? [recent("session", "message", newer ? "where id not in (select id from session_v2)" : "")] : [])];
}
// Reading it waits for the disk, which on a cold start can take many seconds, and the desktop app's window waits for whatever its server waits for. So it is read beside it.
const READER = `const { parentPort, workerData:{ file, busyTimeout, queries } } = require("node:worker_threads");
${requireSqlite}
const db = new (requireSqlite().DatabaseSync)(file, { readOnly:true });
try { db.exec("PRAGMA busy_timeout = " + busyTimeout); parentPort.postMessage(queries.flatMap(query => db.prepare(query).all().map(row => ({ ...row })))); } finally { db.close(); }`;
function aside(sqlite, file, busyTimeout, queries) {
  if (sqlite !== loadSqlite()) return Promise.resolve().then(() => readRows(sqlite, file, busyTimeout, queries));
  return new Promise((resolve, reject) => {
    const worker = new Worker(READER, { eval:true, workerData:{ file, busyTimeout, queries } });
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.once("exit", () => reject(Error("OpenCode's conversations could not be read.")));
    worker.unref();
  });
}
function readRows(sqlite, file, busyTimeout, queries) {
  const db = new sqlite.DatabaseSync(file, { readOnly:true });
  try { db.exec(`PRAGMA busy_timeout = ${busyTimeout}`); return queries.flatMap(query => db.prepare(query).all()); } finally { db.close(); }
}

function openCodeDatabase(dataDir, sqlite = loadSqlite(), busyTimeout = 1000) {
  const file = path.join(dataDir, "opencode.db");
  if (!sqlite?.DatabaseSync || !fs.existsSync(file)) return null;
  const withDb = use => {
    const db = new sqlite.DatabaseSync(file, { readOnly:true });
    try { db.exec(`PRAGMA busy_timeout = ${busyTimeout}`); return use(db); } finally { db.close(); }
  };
  let tables;
  try { tables = withDb(db => new Set(db.prepare("select name from sqlite_master where type = 'table'").all().map(row => row.name))); } catch { return null; }
  const newer = tables.has("session_v2") && tables.has("session_message"), older = tables.has("session") && tables.has("message") && tables.has("part");
  if (!newer && !older) return null;
  return {
    // Read assistant metadata only, from the session and attempt that produced this Work.
    models:(session, { ids = [], started, ended }) => withDb(db => {
      const requested = ids.slice(-MODEL_ROWS), selected = requested.length ? `and id in (${requested.map(() => "?").join(",")})` : "";
      const sql = (table, assistant, provider, model) => `select id, time_created as at, json_extract(data, '${provider}') as providerID,
        json_extract(data, '${model}') as modelID from ${table} where session_id = ? and time_created between ? and ?
        and json_valid(data) and ${assistant} ${selected} order by time_created desc, id desc limit ${MODEL_ROWS}`;
      const params = [session, started, ended, ...requested];
      const rows = newer ? db.prepare(sql("session_message", "type = 'assistant'", "$.model.providerID", "$.model.id")).all(...params) : [];
      if (older) rows.push(...db.prepare(sql("message", "json_extract(data, '$.role') = 'assistant'", "$.providerID", "$.modelID")).all(...params));
      return rows.map(row => ({ id:row.id, at:Number(row.at), model:openCodeModel(row) })).filter(row => row.model);
    }),
    // Every recent conversation, in any folder, helpers' too: the caller keeps those in its own folders, and need ask only once.
    // Its row is not touched for each message, so the latest message counts too. A helper's names the conversation that started it.
    everywhere:true,
    list:() => aside(sqlite, file, busyTimeout, listSql(newer, older)).then(rows => rows.map(row => ({ id:row.id, directory:row.directory, updated:Math.max(Number(row.time_updated) || 0, Number(row.latest) || 0), ...(row.parent_id ? { parent:row.parent_id } : {}) }))),
    // Whether its app still holds this conversation, whole and not archived. A helper's has a parent. An older `session` row does not count: asked for one, the app's terminal program starts a new conversation under that id.
    holds:async id => withDb(db => newer && Boolean(db.prepare("select 1 from session_v2 where id = ? and parent_id is null and time_archived is null").get(id))),
    // The title its app lists a conversation under.
    title:async id => withDb(db => (newer && db.prepare("select title from session_v2 where id = ?").get(id)?.title) || ""),
    // Only what comes after `after`, so a long conversation is not read whole every few seconds.
    read:async (id, _folder, { after = 0 } = {}) => withDb(db => {
      if (newer) {
        const session = db.prepare("select parent_id from session_v2 where id = ?").get(id);
        const any = session && db.prepare("select 1 from session_message where session_id = ? limit 1").get(id);
        if (any) {
          const rows = db.prepare("select id, type, seq, time_created, cast(data as text) as data from session_message where session_id = ? and seq > ? and type in ('user', 'assistant') order by seq").all(id, after), messages = [];
          let settled = after, open = false;
          for (const row of rows) { const message = messageFromRow(row); if (!message) continue; messages.push(message); if (message.info.role === "assistant" && !message.info.time.completed) open = true; if (!open) settled = Number(row.seq); }
          // It is at work from what you asked until it says it is idle.
          const last = db.prepare("select type from session_message where session_id = ? and type in ('user', 'idle') order by seq desc limit 1").get(id);
          return { info:{ parentID:session.parent_id || undefined }, messages, settled, busy:last?.type === "user" };
        }
      }
      if (!older) return { info:{}, messages:[] };
      const session = db.prepare("select parent_id from session where id = ?").get(id), parts = new Map();
      for (const row of db.prepare("select id, message_id, cast(data as text) as data from part where session_id = ? order by id").all(id)) { if (!parts.has(row.message_id)) parts.set(row.message_id, []); parts.get(row.message_id).push({ id:row.id, ...parse(row.data) }); }
      const messages = db.prepare("select id, cast(data as text) as data from message where session_id = ? order by time_created, id").all(id).map(row => ({ info:{ id:row.id, ...parse(row.data) }, parts:parts.get(row.id) || [] }));
      return { info:{ parentID:session?.parent_id || undefined }, messages };
    }),
  };
}

module.exports = { openCodeDatabase };
