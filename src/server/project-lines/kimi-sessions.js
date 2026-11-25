"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { kimiTool, partsText, textOf, tail, said, OUTPUT_MAX } = require("./activity.js");
const { humanWords } = require("./agent-sessions.js");
const { loadSqlite } = require("./sqlite.js");

// Kimi keeps a conversation the same way whether it was had in Kimi Code on the command line or in Kimi's desktop app, which runs Kimi Code inside it:
// one log per conversation, wire.jsonl, under a folder named after where it happened. Each keeps its own store, so a conversation opens again only where it was had.
// Everything here only reads. It was read from Kimi Code 0.35 and Kimi 3.2.25; anything unexpected is skipped rather than guessed at.

function desktopData(env, home) {
  if (process.platform === "win32") return path.join(env.APPDATA || path.join(home, "AppData", "Roaming"), "kimi-desktop");
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "kimi-desktop");
  return path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "kimi-desktop");
}
// The desktop app's own copy of Kimi Code, where the titles its list shows are kept too, and the command line's.
function kimiStores(env, home) {
  const desktop = path.join(desktopData(env, home), "daimon-share", "daimon");
  return {
    desktop:{ home:path.join(desktop, "runtime", "kimi-code", "home"), titles:path.join(desktop, "agents", "main", "sessions", "hosted-logical", "conversations.sqlite"), prefix:"conv-", via:"Kimi desktop" },
    cli:{ home:env.KIMI_CODE_HOME || path.join(home, ".kimi-code"), prefix:"session_", via:"Kimi Code" },
  };
}
// Which store a conversation is in, by how its name starts.
const inDesktop = id => String(id || "").startsWith("conv-");

const isFile = file => { try { return Boolean(fs.statSync(file, { throwIfNoEntry:false })?.isFile()); } catch { return false; } };
const inside = (folder, root) => { const rel = path.relative(root, folder); return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel)); };
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, "utf8")) || {}; } catch { return {}; } };

// ---------- Which conversations happened in a folder ----------
// A folder's are under wd_<its name>_<the first 12 characters of the SHA-256 of its path>, so a linked folder's own are found exactly.
const shortHash = folder => createHash("sha256").update(String(folder)).digest("hex").slice(0, 12);
// The store's own list of folders also names those inside a linked folder.
const listed = new Map();
function listedFolders(home) {
  const files = ["workspaces.json", "projects.json"].map(name => path.join(home, name));
  const stamp = files.map(file => { try { return fs.statSync(file, { throwIfNoEntry:false })?.mtimeMs || 0; } catch { return 0; } }).join("|"), known = listed.get(home);
  if (known?.stamp === stamp) return known.folders;
  const folders = new Map();
  for (const [file, key] of [[files[0], "workspaces"], [files[1], "projects"]]) {
    for (const [id, entry] of Object.entries(readJson(file)[key] || {})) if (typeof entry?.root === "string" && entry.root) folders.set(id, entry.root);
  }
  listed.set(home, { stamp, folders });
  return folders;
}
// The folders under sessions/ that belong to these linked folders, each with the folder it stands for.
function kimiFolders(home, roots, names) {
  const byHash = new Map(roots.map(root => [shortHash(root), root])), out = [];
  let folders = null; // Looked up once for all the names: once for each made thousands of stats every 3 s.
  for (const name of names) {
    const hash = /^wd_.+_([0-9a-f]{12})$/.exec(name)?.[1];
    if (!hash) continue;
    let cwd = byHash.get(hash);
    if (!cwd) { const root = (folders ||= listedFolders(home)).get(name); if (root && roots.some(r => inside(root, r))) cwd = root; }
    if (cwd) out.push({ name, cwd });
  }
  return out;
}
// Each conversation's log. The desktop app also keeps short helper conversations that only name the others, and their names leave them out.
function kimiFiles(dir, prefix) {
  let names; try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter(name => name.startsWith(prefix)).map(name => ({ id:name, full:path.join(dir, name, "agents", "main", "wire.jsonl") })).filter(f => isFile(f.full));
}

// When a conversation began and the words it began with, from the head of its log: Kimi writes its start first and the first Ask soon after it.
// prompt is null while that Ask is not written yet, and the whole is null when the log cannot be read.
const HEAD_MOST = 512 * 1024;
function kimiHead(file) {
  let text;
  try {
    const fd = fs.openSync(file, "r");
    try { const buffer = Buffer.alloc(HEAD_MOST); text = buffer.toString("utf8", 0, fs.readSync(fd, buffer, 0, HEAD_MOST, 0)); } finally { fs.closeSync(fd); }
  } catch { return null; }
  let created = 0;
  for (const line of text.split("\n")) {
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o?.type === "metadata") created = Number(o.created_at) || 0;
    if (o?.type === "turn.prompt") return { created:created || Number(o.time) || 0, prompt:partsText(Array.isArray(o.input) ? o.input : []) };
  }
  return { created, prompt:null };
}

// ---------- One line of a conversation's log ----------
const PICTURE_TYPES = { png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg", gif:"image/gif", webp:"image/webp" }, PICTURE_MOST = 20 * 1024 * 1024, FILE_MOST = 25 * 1024 * 1024;
function pictureFile(file) {
  const type = PICTURE_TYPES[path.extname(String(file || "")).slice(1).toLowerCase()];
  try { const stat = fs.statSync(file); return type && stat.isFile() && stat.size <= PICTURE_MOST ? { type, data:fs.readFileSync(file).toString("base64") } : null; } catch { return null; }
}
const dataPicture = url => { const m = String(url || "").match(/^data:(image\/[\w.+-]+);base64,([\s\S]+)$/); return m ? { type:m[1], data:m[2] } : null; };
const keepable = file => { try { const stat = fs.statSync(file); return stat.isFile() && stat.size <= FILE_MOST; } catch { return false; } };
// The desktop app puts a note of the time in front of what was typed, and names each attachment by its path inside the words.
const TIME_NOTE = /^\s*<meta\b[^>]*\/>\s*/i, ATTACHMENT = /<attachment>(\{[\s\S]*?\})<\/attachment>/g;
function kimiSaid(parts) {
  const pictures = [], files = [], named = [];
  let images = 0;
  for (const part of parts) {
    if (part?.type !== "image_url") continue;
    images++;
    const pic = dataPicture(part.imageUrl?.url ?? part.image_url?.url);
    if (pic) pictures.push(pic);
  }
  const typed = partsText(parts).replace(TIME_NOTE, "").replace(ATTACHMENT, (_, json) => {
    let a; try { a = JSON.parse(json); } catch { return ""; }
    const file = typeof a?.path === "string" ? a.path : "";
    if (a?.type === "image") { images++; const pic = pictureFile(file); if (pic) pictures.push(pic); return ""; }
    if (path.isAbsolute(file) && keepable(file)) files.push(file);
    else if (a?.name || file) named.push(String(a.name || path.basename(file)));
    return "";
  });
  const words = humanWords(typed), lost = images - pictures.length;
  const me = [words, named.length ? `[Attached: ${named.join(", ")}]` : "", lost > 0 ? `[${lost} ${lost === 1 ? "picture" : "pictures"}]` : ""].filter(Boolean).join("\n");
  return me || pictures.length || files.length ? [{ me, ...(pictures.length ? { pictures } : {}), ...(files.length ? { files } : {}) }] : [];
}
function kimiLine(line) {
  let o; try { o = JSON.parse(line); } catch { return null; }
  if (!o || typeof o !== "object") return null;
  const at = Number(o.time) || 0;
  switch (o.type) {
    // What was asked, and what was said while it worked. What Kimi itself adds is marked as from somewhere else.
    case "turn.prompt": case "turn.steer":
      return { at, turnOpen:true, changes:o.origin?.kind && o.origin.kind !== "user" ? [] : kimiSaid(Array.isArray(o.input) ? o.input : []) };
    case "turn.ended": case "turn.cancel": return { at, turnOpen:false, changes:[] };
    case "context.append_loop_event": {
      const e = o.event || {};
      if (e.type === "content.part") return e.part?.type === "text" && String(e.part.text || "").trim() ? { at, turnOpen:true, changes:said(e.part.text) } : null;
      if (e.type === "tool.call" && e.toolCallId) return { at, turnOpen:true, changes:[{ add:{ kind:"tool", id:e.toolCallId, state:"running", ...kimiTool(e.name, e.args) } }] };
      if (e.type === "tool.result" && e.toolCallId) return { at, turnOpen:true, changes:[{ patch:{ id:e.toolCallId, state:e.result?.isError ? "failed" : "done", output:tail(textOf(e.result?.output), OUTPUT_MAX) } }] };
      return null;
    }
    default: return null;
  }
}

// ---------- The desktop app's list ----------
// The title the desktop app lists a conversation under, to pick it there: its links cannot open one conversation.
function kimiTitle(file, id, sqlite = loadSqlite()) {
  if (!sqlite?.DatabaseSync || !isFile(file)) return "";
  const db = new sqlite.DatabaseSync(file, { readOnly:true });
  try { db.exec("PRAGMA busy_timeout = 1000"); return String(db.prepare("select title from conversations where kernel_session_id = ? order by updated_at_ms desc limit 1").get(id)?.title || "").trim(); }
  catch { return ""; } finally { db.close(); }
}
// The folder a conversation is kept in, or "".
function kimiDir(stores, id) {
  const store = inDesktop(id) ? stores.desktop : stores.cli, sessions = path.join(store.home, "sessions");
  if (!String(id).startsWith(store.prefix) || /[\\/]/.test(id)) return "";
  let names; try { names = fs.readdirSync(sessions); } catch { return ""; }
  return names.map(name => path.join(sessions, name, id)).find(folder => isFile(path.join(folder, "agents", "main", "wire.jsonl"))) || "";
}
// Whether the store a conversation came from still has it. A conversation the command line archived does not count.
function kimiHolds(stores, id) {
  const dir = kimiDir(stores, id);
  return Boolean(dir) && readJson(path.join(dir, "state.json")).archived !== true;
}
// Kimi prints no token usage while it runs; its log keeps one usage record for each model request, with the tools each one called.
// These are the records from `since` to `until` (milliseconds), for counting a Work's tokens. Nothing else is read.
const USAGE_LINE = /"type":"(?:usage\.record|context\.append_loop_event)"/;
function kimiUsageRecords(stores, id, since = 0, until = Infinity) {
  const dir = kimiDir(stores, id);
  if (!dir) return [];
  let text; try { text = fs.readFileSync(path.join(dir, "agents", "main", "wire.jsonl"), "utf8"); } catch { return []; }
  const out = [];
  for (const line of text.split("\n")) {
    if (!USAGE_LINE.test(line)) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const kind = o.type === "usage.record" ? "usage" : o.event?.type;
    if ((kind === "usage" || kind === "tool.call" || kind === "tool.result") && o.time >= since && o.time < until) out.push(o);
  }
  return out;
}

module.exports = { kimiStores, inDesktop, shortHash, kimiFolders, kimiFiles, kimiHead, kimiLine, kimiSaid, kimiTitle, kimiHolds, kimiUsageRecords };
