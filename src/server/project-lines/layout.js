"use strict";
// Where everything of a project lives in its docs folder. This is the one place that knows; everything else asks here.
//
// Layout 2 (from 2026-11-15):
//   understanding.md            the way in: what the project is and where it stands, kept by agents
//   topics/<name>.md            knowledge Topics, written as requirements documents by agents; never Lines
//   lines/<slug>.md             Lines: the person's Asks word for word and a short note on each Work. Only .md files
//   works/<slug>/work-N.md      each Work's detail
//   files/<slug>/…              a Line's files; other folders under files/ are shared
//   archive/{lines,works,files}/…   archived Lines with their Works and files, in the same layout under archive/
//   .trash/lines/<slug>-<id>/   deleted Lines with their Works and files, until restored or purged
//   .penecho/layout.json        which layout the folder has, and the log of the move to it
//
// Layout 1 (until 2026-11-15) kept Lines and their Works in topics/: topics/<slug>.md, topics/<slug>/work-N.md.
//
// The code works with layout-2 paths ("names") only. The store turns a name into the place on disk: in topics/ for a
// folder still in layout 1, in archive/ for an archived Line. So an archived Line keeps its links and a layout-1
// folder keeps working until it is moved.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const P = path.posix;

const VERSION = 2;
const LINES = "lines", WORKS = "works", FILES = "files", TOPICS = "topics", ARCHIVE = "archive", UNDERSTANDING = "understanding.md";
const STATE_DIR = ".penecho", LAYOUT_FILE = ".penecho/layout.json", MIGRATIONS = ".penecho/migrations", TRASH = ".trash/lines";

// ---------- Names ----------
const linePath = slug => `${LINES}/${slug}.md`;
const worksDir = slug => `${WORKS}/${slug}`;
const detailPath = (slug, id) => `${WORKS}/${slug}/${id}.md`;
const filesDir = slug => `${FILES}/${slug}`;
// A link written in a Line's file, as a name in the docs folder, and back.
// Links are always right for someone reading the folder: an archived Line in archive/lines/ links its own things beside it and
// everything else one level further up; a current file links an archived Line in archive/. PenEcho reads every link as a name
// (resolveFrom): what is in archive/ is named as if it were not, and the store finds it where it is.
const nameOf = rel => rel.replace(/^archive\/(?=(?:lines|works|files)\/)/, "");
// A link written in the file named `name`, as a name. A link that climbs one folder too high was written in the archived copy.
function resolveFrom(name, href) {
  let rel = P.normalize(P.join(P.dirname(name), href));
  if (rel.startsWith("../") && !P.normalize(P.join(P.dirname(`${ARCHIVE}/${name}`), href)).startsWith("../")) rel = P.normalize(P.join(P.dirname(`${ARCHIVE}/${name}`), href));
  // A Work linked the way layout 1 linked it ("<slug>/work-1.md", as PenEcho Cloud still writes it) is in works/.
  return nameOf(rel).replace(/^lines\/(?=[^/]+\/.)/, `${WORKS}/`);
}
const fromLine = href => resolveFrom(`${LINES}/x.md`, href);
const toLine = rel => P.relative(LINES, rel);
// The links a Line and its Work details write to each other.
const detailHref = (slug, id) => `../${WORKS}/${slug}/${id}.md`;
const lineFromDetail = slug => `../../${LINES}/${slug}.md`;
const LINE = /^lines\/([^/]+)\.md$/;
const slugOfLine = rel => (LINE.exec(String(rel || "")) || [])[1] || "";
const isLinePath = rel => LINE.test(String(rel || ""));
// A Line's file, a Work detail or a file of a Line: the slug it belongs to.
const OWNED = /^(?:lines\/([^/]+)\.md|(?:works|files)\/([^/]+)(?:\/.*)?)$/;
const ownerOf = rel => { const m = OWNED.exec(String(rel || "")); return m ? m[1] || m[2] : ""; };
const isTopicPath = rel => /^topics\/[^/]+\.md$/.test(String(rel || ""));
// A Line whose status is one of these is archived: it lives in archive/.
const ARCHIVED = new Set(["closed", "landed"]);
// Folders under files/ that are shared, never one Line's.
const SHARED_FILES = new Set(["canvases", "_incoming", "drawings"]);

// ---------- Layout 1 ----------
// A name, as the place it has in a layout-1 folder. lines/<slug>/… comes from a link written in an old Line file.
function toV1(rel) {
  const m = /^(?:lines|works)(\/.*)?$/.exec(rel);
  return m ? `${TOPICS}${m[1] || ""}` : rel;
}
// A place in a layout-1 folder, as its name: files directly in topics/ are Lines (or notes beside them), folders their Works.
function fromV1(rel) {
  const m = /^topics\/(.+)$/.exec(rel);
  if (!m) return rel;
  return m[1].includes("/") ? `${WORKS}/${m[1]}` : `${LINES}/${m[1]}`;
}

// ---------- PenEcho Cloud ----------
// Cloud reads projects in layout 1 only (until its own Lines code learns layout 2), so names go to and come from it as layout 1 names.
// The knowledge (understanding.md and the Topics in topics/) has no place in Cloud's layout 1, where topics/ holds the Lines. It goes
// under .knowledge/ there, by the same names, and comes back to them (PE-581: the owner wants memory and Topic files kept in Cloud too).
const CLOUD_KNOWLEDGE = ".knowledge";
const toCloud = name => (name.startsWith(`${TOPICS}/`) || name === UNDERSTANDING ? `${CLOUD_KNOWLEDGE}/${name}` : toV1(name));
const fromCloud = rel => { const text = String(rel || ""); return text.startsWith(`${CLOUD_KNOWLEDGE}/`) ? text.slice(CLOUD_KNOWLEDGE.length + 1) : fromV1(text); };

// ---------- Which layout a folder has ----------
const exists = file => { try { fs.lstatSync(file); return true; } catch { return false; } };
const isDir = file => { try { return fs.statSync(file).isDirectory(); } catch { return false; } };
function readState(docs, { strict = false } = {}) {
  try { return JSON.parse(fs.readFileSync(path.join(docs, LAYOUT_FILE), "utf8")) || {}; }
  catch (error) {
    if (strict && !(error instanceof SyntaxError) && !["ENOENT", "ENOTDIR"].includes(error?.code)) throw error;
    return null;
  }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive:true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, file);
}
// 1 or 2. A folder that says nothing is layout 1 when it has a topics folder with something in it and no lines folder.
function versionOf(docs, { strict = false } = {}) {
  const state = readState(docs, { strict });
  if (state && (state.version === 1 || state.version === 2)) return state.version;
  if (strict) {
    try { if (fs.statSync(path.join(docs, LINES)).isDirectory()) return 2; }
    catch (error) { if (!["ENOENT", "ENOTDIR"].includes(error?.code)) throw error; }
  } else if (isDir(path.join(docs, LINES))) return 2;
  let names = [];
  try { names = fs.readdirSync(path.join(docs, TOPICS)).filter(name => !name.startsWith(".")); }
  catch (error) { if (strict && !["ENOENT", "ENOTDIR"].includes(error?.code)) throw error; /* No topics folder. */ }
  return names.length ? 1 : 2;
}
function markVersion(docs, version, extra = {}) {
  writeJson(path.join(docs, LAYOUT_FILE), { version, ...extra });
}

// ---------- Links in Markdown ----------
// [text](href), ![text](href), [text](<href with spaces>), [text](href "title"), and a front matter "line: ../x.md".
const LINK = /(\]\()(<[^>\n]*>|[^)\s]*)((?:\s+"[^"\n]*")?\))/g;
const FRONT_LINK = /^(line:[ \t]*)(\S+)[ \t]*$/m;
const outside = href => !href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#") || href.startsWith("/") || href.startsWith("~");
function decode(href) { try { return decodeURI(href); } catch { return href; } }
// Each relative link in `text`, written in a file once at `from`, now at `to`: where it points, through `move`, from `to`.
// `move(name)` gives where a name went, or null if it stayed.
function rewriteLinks(text, from, to, move) {
  const fix = raw => {
    const angled = raw.startsWith("<") && raw.endsWith(">"), bare = angled ? raw.slice(1, -1) : raw;
    const cut = bare.search(/[?#]/), href = cut < 0 ? bare : bare.slice(0, cut), tail = cut < 0 ? "" : bare.slice(cut);
    if (outside(href)) return raw;
    // A link out of the docs folder (to the code beside it) keeps pointing at the same place from a file that moved deeper.
    const plain = decode(href), target = P.normalize(P.join(P.dirname(from), plain)).replace(/\/$/, "");
    const moved = (target.startsWith("..") ? null : move(target)) || target;
    let next = P.relative(P.dirname(to), moved);
    if (!next) return raw;
    if (plain.endsWith("/")) next += "/";
    if (next === plain || P.normalize(P.join(P.dirname(to), next)) === P.normalize(P.join(P.dirname(to), plain))) return raw;
    if (plain !== href) next = encodeURI(next);
    else if (!angled && /\s/.test(next)) return `<${next}${tail}>`;
    return angled ? `<${next}${tail}>` : `${next}${tail}`;
  };
  let out = String(text).replace(LINK, (all, open, raw, close) => `${open}${fix(raw)}${close}`);
  const front = /^---\n[\s\S]*?\n---/.exec(out.replace(/\r\n/g, "\n"));
  if (front) {
    const head = front[0], fixed = head.replace(FRONT_LINK, (all, key, raw) => `${key}${fix(raw)}`);
    if (fixed !== head) out = fixed + out.replace(/\r\n/g, "\n").slice(head.length);
  }
  return out;
}

// ---------- Moving a folder from layout 1 to layout 2, and back ----------
const SKIP = new Set([".git", "node_modules", ".penecho", ".trash", ".history", ".obsidian", ".DS_Store"]);
// Every Markdown file in the docs folder, as names, except what PenEcho keeps for itself.
function markdownIn(docs, rel = "", out = []) {
  let entries;
  try { entries = fs.readdirSync(path.join(docs, rel), { withFileTypes:true }); } catch { return out; }
  for (const entry of entries) {
    if (SKIP.has(entry.name) || entry.isSymbolicLink()) continue;
    const next = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) { if (!/\.(app|framework|bundle)$/i.test(entry.name)) markdownIn(docs, next, out); }
    else if (entry.isFile() && /\.(md|markdown)$/i.test(entry.name)) out.push(next);
  }
  return out;
}
const hashOf = text => crypto.createHash("sha256").update(text).digest("hex").slice(0, 20);
const stampNow = () => new Date().toISOString().replace(/[:.]/g, "-");
// What would move: [from, to] for each entry of topics/ (and archive/ on the way back), whole folders at once.
function planMoves(docs, direction) {
  const moves = [];
  const list = rel => { try { return fs.readdirSync(path.join(docs, rel), { withFileTypes:true }).filter(e => !e.name.startsWith(".") && !e.name.endsWith(".tmp")); } catch { return []; } };
  if (direction === "up") {
    // A Line archived already (its status says so) goes straight to archive/, with its Works and files.
    const archived = archivedIn(docs);
    for (const e of list(TOPICS)) {
      const slug = e.isDirectory() ? e.name : e.name.replace(/\.md$/, ""), base = archived.has(slug) ? `${ARCHIVE}/` : "";
      moves.push([`${TOPICS}/${e.name}`, e.isDirectory() ? `${base}${WORKS}/${e.name}` : `${base}${LINES}/${e.name}`]);
    }
    for (const slug of archived) if (!SHARED_FILES.has(slug) && exists(path.join(docs, FILES, slug))) moves.push([`${FILES}/${slug}`, `${ARCHIVE}/${FILES}/${slug}`]);
  } else {
    for (const base of ["", `${ARCHIVE}/`]) {
      for (const e of list(`${base}${LINES}`)) moves.push([`${base}${LINES}/${e.name}`, `${TOPICS}/${e.name}`]);
      for (const e of list(`${base}${WORKS}`)) moves.push([`${base}${WORKS}/${e.name}`, `${TOPICS}/${e.name}`]);
      if (base) for (const e of list(`${base}${FILES}`)) moves.push([`${base}${FILES}/${e.name}`, `${FILES}/${e.name}`]);
    }
  }
  return moves;
}
// The Lines of a layout-1 folder whose status says they are archived.
function archivedIn(docs) {
  const out = new Set();
  let names = [];
  try { names = fs.readdirSync(path.join(docs, TOPICS)).filter(n => n.endsWith(".md") && !n.startsWith(".")); } catch { return out; }
  for (const name of names) {
    let head = "";
    try { const fd = fs.openSync(path.join(docs, TOPICS, name), "r"), buf = Buffer.alloc(4096); head = buf.toString("utf8", 0, fs.readSync(fd, buf, 0, 4096, 0)); fs.closeSync(fd); } catch { continue; }
    const front = (/^---\r?\n([\s\S]*?)\r?\n---/.exec(head) || [])[1] || "", status = ((/^status:[ \t]*(\S+)/m.exec(front) || [])[1] || "").replace(/^["']|["']$/g, "");
    const recordType = ((/^record_type:[ \t]*(\S+)/m.exec(front) || [])[1] || "").replace(/^["']|["']$/g, "");
    if (ARCHIVED.has(status.toLowerCase()) && !/^(?:topic|project-understanding)$/i.test(recordType)) out.add(name.slice(0, -3));
  }
  return out;
}
const mover = moves => name => {
  for (const [from, to] of moves) {
    if (name === from) return to;
    if (name.startsWith(`${from}/`)) return to + name.slice(from.length);
  }
  return null;
};

// Moves a layout-1 folder to layout 2 (direction "up"), or back ("down"). All or nothing as far as a crash allows:
// the log is written before anything moves, and an unfinished one is rolled back by recover() the next time.
// Every Markdown file whose links change is kept as it was in the log folder first. Nothing is ever overwritten:
// when a place it would move to is taken, nothing moves and the reason is given.
function move(docs, direction, { why = "" } = {}) {
  const from = direction === "up" ? 1 : 2, to = direction === "up" ? 2 : 1;
  recover(docs);
  if (versionOf(docs) !== from) return { moved:false, reason:`The folder is not in layout ${from}.` };
  const moves = planMoves(docs, direction);
  if (direction === "down" && exists(path.join(docs, TOPICS))) {
    // Knowledge Topics would sit among the Lines again: they go to files/topics, where nothing reads them as Lines.
    for (const e of fs.readdirSync(path.join(docs, TOPICS)).filter(n => !n.startsWith("."))) if (!moves.some(([, t]) => t === `${TOPICS}/${e}`)) moves.unshift([`${TOPICS}/${e}`, `${FILES}/topics/${e}`]);
  }
  const taken = moves.filter(([, t]) => exists(path.join(docs, t)));
  const clash = taken.concat(moves.filter(([, t], i) => moves.findIndex(([, u]) => u === t) !== i));
  if (clash.length) return { moved:false, reason:`These places are taken: ${clash.map(([, t]) => t).slice(0, 5).join(", ")}.` };
  // A link to something that is not there (any more) still follows the layout's rule, so it stays the same dead link and not a different one.
  const archived = direction === "up" ? new Set(moves.filter(([, b]) => b.startsWith(`${ARCHIVE}/${LINES}/`)).map(([, b]) => b.slice(ARCHIVE.length + LINES.length + 2, -3))) : new Set();
  const moved = mover(moves), rule = direction === "up" ? name => (name.startsWith(`${TOPICS}/`) ? (n => (archived.has(ownerOf(n)) ? `${ARCHIVE}/${n}` : n))(fromV1(name)) : null) : name => (/^(?:archive\/)?(?:lines|works)(?:\/|$)/.test(name) ? toV1(name.replace(/^archive\//, "")) : null);
  const where = name => moved(name) || rule(name), stamp = stampNow(), dir = path.join(docs, MIGRATIONS, stamp);
  // Every Markdown file, where it is now and where it will be, and its text with its links pointing the new way.
  const rewrites = [];
  for (const name of markdownIn(docs)) {
    const now = moved(name) || name, text = fs.readFileSync(path.join(docs, name), "utf8"), next = rewriteLinks(text, name, now, where);
    if (next !== text) rewrites.push({ from:name, to:now, before:hashOf(text), after:hashOf(next), next, text });
  }
  for (const r of rewrites) { const file = path.join(dir, "before", r.from); fs.mkdirSync(path.dirname(file), { recursive:true }); fs.writeFileSync(file, r.text); }
  const log = { from, to, at:new Date().toISOString(), why, phase:"moving", moves, rewrites:rewrites.map(({ from:f, to:t, before, after }) => ({ from:f, to:t, before, after })) };
  writeJson(path.join(dir, "log.json"), log);
  const done = [];
  try {
    for (const [a, b] of moves) {
      fs.mkdirSync(path.dirname(path.join(docs, b)), { recursive:true });
      fs.renameSync(path.join(docs, a), path.join(docs, b));
      done.push([a, b]);
    }
    for (const r of rewrites) {
      const file = path.join(docs, r.to), temp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(temp, r.next);
      fs.renameSync(temp, file);
    }
    for (const folder of direction === "up" ? [LINES, WORKS, TOPICS, FILES] : [TOPICS, FILES]) fs.mkdirSync(path.join(docs, folder), { recursive:true });
    if (direction === "down") for (const folder of [LINES, WORKS, `${ARCHIVE}/${LINES}`, `${ARCHIVE}/${WORKS}`, `${ARCHIVE}/${FILES}`, ARCHIVE]) { try { fs.rmdirSync(path.join(docs, folder)); } catch { /* Not empty, or not there. */ } }
    markVersion(docs, to, { migration:stamp, ...(direction === "down" ? { stay:true } : {}) });
    log.phase = "done";
    writeJson(path.join(dir, "log.json"), log);
  } catch (error) {
    rollBack(docs, dir, log, done);
    return { moved:false, reason:`The move stopped and was undone: ${error.message}` };
  }
  return { moved:true, stamp, log:path.join(dir, "log.json"), moves:moves.length, rewritten:rewrites.length };
}
function rollBack(docs, dir, log, done) {
  for (const [a, b] of [...done].reverse()) {
    try { if (exists(path.join(docs, b)) && !exists(path.join(docs, a))) { fs.mkdirSync(path.dirname(path.join(docs, a)), { recursive:true }); fs.renameSync(path.join(docs, b), path.join(docs, a)); } } catch { /* Left for the person; the log says where. */ }
  }
  for (const r of log.rewrites || []) {
    try { fs.writeFileSync(path.join(docs, r.from), fs.readFileSync(path.join(dir, "before", r.from))); } catch { /* It kept its old text. */ }
  }
  log.phase = "rolled back";
  writeJson(path.join(dir, "log.json"), log);
}
// A move that a crash cut short is rolled back, so the folder is whole in its old layout again.
function recover(docs) {
  let stamps = [];
  try { stamps = fs.readdirSync(path.join(docs, MIGRATIONS)); } catch { return; }
  for (const stamp of stamps) {
    const dir = path.join(docs, MIGRATIONS, stamp);
    let log;
    try { log = JSON.parse(fs.readFileSync(path.join(dir, "log.json"), "utf8")); } catch { continue; }
    if (log.phase !== "moving") continue;
    rollBack(docs, dir, log, log.moves.filter(([a, b]) => exists(path.join(docs, b)) && !exists(path.join(docs, a))));
  }
}
const migrate = (docs, options) => move(docs, "up", options);
// Back to layout 1, for good: PenEcho does not move it again until layout.json says otherwise.
// A file not changed since the move gets exactly its old text back; one changed since keeps its changes with its links turned back.
function undo(docs) {
  const state = readState(docs) || {}, dir = state.migration ? path.join(docs, MIGRATIONS, state.migration) : "";
  let log = null;
  try { log = JSON.parse(fs.readFileSync(path.join(dir, "log.json"), "utf8")); } catch { /* Turned back by its links alone. */ }
  // Files nobody changed since the move get their exact old bytes back.
  const unchanged = (log?.rewrites || []).filter(r => { try { return hashOf(fs.readFileSync(path.join(docs, r.to), "utf8")) === r.after; } catch { return false; } });
  const result = move(docs, "down", { why:"undo" });
  if (!result.moved) return result;
  let exact = 0;
  for (const r of unchanged) {
    try { fs.writeFileSync(path.join(docs, r.from), fs.readFileSync(path.join(dir, "before", r.from))); exact++; } catch { /* It keeps its links turned back. */ }
  }
  return { ...result, exact };
}

module.exports = {
  VERSION, LINES, WORKS, FILES, TOPICS, ARCHIVE, UNDERSTANDING, STATE_DIR, LAYOUT_FILE, MIGRATIONS, TRASH, SHARED_FILES, ARCHIVED,
  linePath, worksDir, detailPath, filesDir, fromLine, resolveFrom, nameOf, toLine, detailHref, lineFromDetail, slugOfLine, isLinePath, ownerOf, isTopicPath,
  toV1, fromV1, toCloud, fromCloud, versionOf, markVersion, readState, rewriteLinks, markdownIn, planMoves, migrate, undo, recover, move,
};
