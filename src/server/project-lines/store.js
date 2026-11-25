"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const F = require("./format.js");
const Memory = require("./memory.js");
const L = require("./layout.js");
const ImportState = require("./import-state.js");

function keepArchiveTime(text, previous) {
  const { front } = F.splitFront(text);
  if (!F.isLineFront(front)) return text;
  if (!L.ARCHIVED.has(front.status.toLowerCase())) {
    return Object.hasOwn(front, "archived at") ? F.setFront(text, { "archived at":null }) : text;
  }
  // An imported Line can already be archived. A new timestamp needs a known transition into the Archive.
  const before = previous && (previous.doc?.front || F.splitFront(previous.text).front);
  if (!before || !F.isLineFront(before)) return text;
  // Preserve the legacy estimate before an edit or a generated status update changes the file's mtime.
  const at = L.ARCHIVED.has(before.status.toLowerCase()) ? F.archiveTime(before, previous.mtime) : Date.now();
  const stamp = at ? new Date(at).toISOString() : "";
  return stamp && stamp !== front["archived at"] ? F.setFront(text, { "archived at":stamp }) : text;
}

// Projects are folders you own. The registry only remembers which folders PenEcho knows about;
// everything that matters lives in the docs folder as ordinary files.
const failure = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
// MAX_ENTRIES: the most files the folder's list holds. Taking it is a stat per file (about 15 ms for each 1,000), and while the
// folder's watcher works it is taken only every 30 s (folder-watch.js), so the count can be high.
const MAX_TEXT = 4 * 1024 * 1024, MAX_ENTRIES = 20000, FOLDER_SHARE = 200, HISTORY_KEEP = 20;
const HIDDEN = new Set([".git", "node_modules", ".obsidian", ".trash", ".DS_Store", ".penecho"]);
const COLORS = ["#4f46e5", "#a8502a", "#277a4c", "#3457c9", "#7a5bb5", "#2b303a", "#9a5b12", "#b4232c"];
const FILE_NAME = /^[^/\\\0]{1,160}$/;
const MY_CANVASES = "My Canvases", MY_CANVASES_ID = "my-canvases";
const BUNDLE = /\.(app|framework|bundle|plugin|kext|xcframework)$/i;
// What each walked list's entries are called in the folder (named() gives archived ones other names), and where each is in it (relisted).
const REAL_PATHS = new WeakMap(), REAL_INDEX = new WeakMap(), REAL_LOWER = new WeakMap();
// Lines and their Works first, then the Topics and the files, so nothing else in the folder uses up the count first. Layout 1 kept Lines in topics.
// The few files at the top (MEMORY.md, understanding.md) come before files/, which can hold thousands.
const ROOT_ORDER = { lines:0, works:1, topics:2, files:4 }, ARCHIVE_ORDER = { lines:0, works:1, files:2 };
const rootOrder = entry => (entry.name in ROOT_ORDER ? ROOT_ORDER[entry.name] : !entry.isDirectory() ? 3 : entry.name === L.ARCHIVE ? 6 : entry.name === ".history" ? 7 : 5);
// A name in the folder that walk() never lists: hidden folders (.penecho, .git, .trash), temporary files, what is inside a Mac program.
function leftOut(rel) {
  const parts = String(rel).split(/[\\/]/);
  return parts.some((part, i) => HIDDEN.has(part) || (part.startsWith(".") && part !== ".history") || part.endsWith(".tmp") || (i < parts.length - 1 && BUNDLE.test(part)));
}
// Programs an agent installs for the work go here, beside every project and in none of them, so one copy serves them all.
// On a Mac that is a folder in your own Applications, where Spotlight and Launchpad find them.
function toolsFolder({ home = os.homedir(), platform = process.platform, env = process.env } = {}) {
  if (env.PENECHO_TOOLS_DIR) return env.PENECHO_TOOLS_DIR;
  return platform === "darwin" ? path.join(home, "Applications", "PenEcho Tools") : path.join(home, ".penecho", "tools");
}

function fileGenOf(stat) {
  return `${stat.dev}:${stat.ino}:${stat.ctimeMs}:${stat.mtimeMs}:${stat.size}`;
}
function withFileGen(entry, stat) {
  Object.defineProperty(entry, "gen", { value:fileGenOf(stat), configurable:true });
  return entry;
}
// A plain rename drops whichever file occupies the destination at commit time. For
// generated status, retain that exact file until we have verified its contents.
let displaceStatus;
function statusReplacement() {
  if (displaceStatus) return displaceStatus;
  const koffi = require("koffi");
  if (process.platform === "win32") {
    const dll = koffi.load("kernel32.dll");
    const replace = dll.func("int __stdcall ReplaceFileW(str16, str16, str16, uint32_t, void *, void *)");
    const lastError = dll.func("uint32_t __stdcall GetLastError()");
    displaceStatus = (file, temp, recovery) => {
      if (!replace(path.toNamespacedPath(file), path.toNamespacedPath(temp), path.toNamespacedPath(recovery), 0, null, null)) {
        const code = lastError();
        // ReplaceFileW can move the original to the backup even when publication fails.
        if (code === 1177 || fs.existsSync(recovery)) throw statusConflict(recovery);
        throw new Error(`Could not replace ${file} (Windows error ${code}).`);
      }
    };
  } else {
    const libc = koffi.load(null);
    let exchange;
    if (process.platform === "darwin") {
      const swap = libc.func("int renamex_np(str, str, unsigned int)");
      exchange = (a, b) => swap(a, b, 2); // RENAME_SWAP
    } else if (process.platform === "linux") {
      const swap = libc.func("int renameat2(int, str, int, str, unsigned int)");
      exchange = (a, b) => swap(-100, a, -100, b, 2); // AT_FDCWD, RENAME_EXCHANGE
    } else {
      throw new Error("This platform cannot safely replace a Line status.");
    }
    displaceStatus = (file, temp, recovery, staged) => {
      fs.renameSync(temp, recovery);
      if (exchange(recovery, file) !== 0) {
        const errno = koffi.errno();
        // Some network filesystems can report failure after a rename took effect.
        // Clean up only if the recovery name still identifies our staged inode.
        const left = fs.lstatSync(recovery, { throwIfNoEntry:false });
        if (left && (!left.ino || left.ino !== staged.ino || left.dev !== staged.dev)) throw statusConflict(recovery);
        if (left) fs.unlinkSync(recovery);
        throw new Error(`Could not exchange the status file ${file} (errno ${errno}).`);
      }
    };
  }
  return displaceStatus;
}
function statusConflict(recoveryPath) {
  return Object.assign(failure("CONFLICT", `Status refresh kept the displaced Line at ${recoveryPath}. Review it before continuing.`, 409), { conflict:{ recoveryPath } });
}
function replaceStatusFile(file, temp, expected, staged) {
  const recovery = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomUUID()}.recovery`);
  statusReplacement()(file, temp, recovery, staged);
  // Never decode the saved file or retry away its recovery location. Avoid reading
  // oversized files or following a link if an editor replaced the directory entry.
  try {
    const stat = fs.lstatSync(recovery);
    if (stat.isFile() && stat.size === expected.size && fs.readFileSync(recovery).equals(Buffer.from(expected.text))) {
      fs.unlinkSync(recovery);
      return;
    }
  } catch { /* Verification or cleanup failed. Keep the original accessible. */ }
  throw statusConflict(recovery);
}
function writeAtomic(file, data, { expected = null, generatedStatus = false, createOnly = false } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive:true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temp, data);
    const stat = fs.statSync(temp);
    if (expected) {
      const cur = fs.statSync(file, { throwIfNoEntry:false });
      const changed = expected.missing
        ? Boolean(cur)
        : !cur || cur.dev !== expected.dev || cur.ino !== expected.ino || cur.size !== expected.size || cur.mtimeMs !== expected.mtime || cur.ctimeMs !== expected.ctime;
      if (changed) throw failure("CONFLICT", "This file changed while you were editing it.", 409);
    }
    if (createOnly) { fs.linkSync(temp, file); try { fs.unlinkSync(temp); } catch {} }
    else if (generatedStatus) replaceStatusFile(file, temp, expected, stat);
    else fs.renameSync(temp, file);
    return stat;
  } catch (error) { try { fs.unlinkSync(temp); } catch {} throw error; }
}
function safeName(name, fallback = "file") {
  const clean = String(name || "").replace(/[\\/\0]/g, "-").replace(/^\.+/, "").trim().slice(0, 140);
  return clean || fallback;
}
// One system call, where fs.realpathSync looks at every folder on the way. Read for every file PenEcho opens, so it counts.
const realpath = fs.realpathSync.native || fs.realpathSync;
// New destinations may not exist yet. Resolve their nearest existing parent without caching;
// a dangling link or an unreadable parent is an error, never an empty destination.
function projectFolder(folder) {
  const tail = [];
  try {
    let at = folder;
    while (!fs.lstatSync(at, { throwIfNoEntry:false })) {
      tail.unshift(path.basename(at));
      const parent = path.dirname(at);
      if (parent === at) throw new Error("No existing parent");
      at = parent;
    }
    const real = realpath(at);
    if (!fs.statSync(real).isDirectory()) throw new Error("Not a directory");
    return path.join(real, ...tail);
  } catch { throw failure("BAD_FOLDER", "PenEcho cannot use this folder. Choose a folder with an accessible parent, not a file or a broken link."); }
}
const insideFolder = (root, folder) => {
  const rel = path.relative(root, folder);
  return !rel || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
};
function sameFolder(a, b) {
  if (a === b) return true;
  const one = fs.statSync(a, { throwIfNoEntry:false }), two = fs.statSync(b, { throwIfNoEntry:false });
  return Boolean(one && two && one.dev === two.dev && one.ino === two.ino);
}
function containsFolder(root, folder) {
  if (insideFolder(root, folder)) return true;
  // On a case-insensitive filesystem native realpath may retain the typed case.
  for (let at = folder; ; at = path.dirname(at)) {
    if (sameFolder(root, at)) return true;
    if (path.dirname(at) === at) return false;
  }
}
function isProjectFolder(folder) {
  const layout = L.readState(folder);
  if (layout && [1, 2].includes(layout.version)) return true;
  let memory;
  try { memory = fs.readFileSync(path.join(folder, "MEMORY.md"), "utf8"); }
  catch (error) { if (error.code === "ENOENT" || error.code === "ENOTDIR") return false; throw failure("BAD_FOLDER", "PenEcho cannot check this folder. Choose a folder you can read."); }
  return /^---\r?\n[\s\S]*?\bproject:[^\r\n]+[\s\S]*?\r?\n---/.test(memory) &&
    /^# Project memory\s*$/m.test(memory) && (memory.includes(".penecho/memory") ||
      [L.LINES, L.TOPICS].some(name => fs.statSync(path.join(folder, name), { throwIfNoEntry:false })?.isDirectory()));
}
// Even so it costs about 25 µs on macOS, and a project's state opens a thousand files: a folder's real path is kept for a second.
const FOLDER_MS = 1000, folders = new Map();
function realFolder(folder) {
  const hit = folders.get(folder), now = Date.now();
  if (hit && now - hit.at < FOLDER_MS) return hit.real;
  if (folders.size > 20000) folders.clear();
  const real = realpath(folder);
  folders.set(folder, { real, at:now });
  return real;
}
const lstatOf = file => fs.lstatSync(file, { throwIfNoEntry:false }) || null;
const sameFile = (entry, stat) => entry.mtime === stat.mtimeMs && entry.ctime === stat.ctimeMs && entry.size === stat.size && entry.ino === stat.ino && entry.dev === stat.dev;
// Where a file is, for a reader that only reads (`trust`): a name looked up less than TRUST_MS ago, about which the folder's watcher has said
// nothing since, neither of it nor of a folder it is in nor of the Line that decides whether it is in archive/ (folder-watch.js `mark`, `still`),
// is not looked up again. The file itself is still looked at, with one lstat, so its text is never older than the file, even in the moment
// before the watcher reports a change; a link put in its place is another file. The 3-second look and every page's state looked each Line
// and Work file up four or five times over: about 15,000 file checks a second on the PenEcho folder. Where nothing watches the folder (Linux,
// a drive that reports nothing) every name is looked up as before. TRUST_MS is the folder list's backstop.
const TRUST_MS = 30000, MOST_KNOWN = 50000;
// The texts read, by full path, and what is known of each name asked for. Emptying the texts forgets what is known too.
class TextCache extends Map {
  constructor() { super(); this.known = new Map(); }
  clear() { this.known.clear(); super.clear(); }
}
function clip(value, max = 4000) { return String(value ?? "").slice(0, max); }
// A folder as people write it on this computer: ~ inside the home folder on macOS and Linux,
// the whole path on Windows, where nobody writes ~.
function shortFolder(folder, { home = os.homedir(), platform = process.platform } = {}) {
  return platform !== "win32" && home && (folder === home || folder.startsWith(`${home}/`)) ? `~${folder.slice(home.length)}` : folder;
}
// Where a new project goes before there is any project to go beside.
function defaultBase({ home = os.homedir(), platform = process.platform } = {}) {
  return shortFolder((platform === "win32" ? path.win32 : path.posix).join(home, "Documents", "PenEcho"), { home, platform });
}

class Store {
  constructor({ directory, docsBase = null, maxEntries = MAX_ENTRIES, reconcile = true }) {
    this.directory = directory;
    this.maxEntries = maxEntries;
    // Where a project goes when nobody chose a folder for it.
    this.docsBase = docsBase || path.join(os.homedir(), "Documents", "PenEcho");
    this.file = path.join(directory, "projects.json");
    this.projects = [];
    this.cache = new TextCache();
    this.layouts = new Map();
    // { mark(folder), still(folder, names, at) } from the folders' watcher (service.js); without it every read looks at the disk.
    this.watch = null;
    this.deletedFile = path.join(directory, "deleted-lines.json");
    this.reload();
    if (reconcile) this.reconcileDeleted();
  }
  reload() {
    this.cache.clear();
    this.layouts.clear();
    try { this.deleted = JSON.parse(fs.readFileSync(this.deletedFile, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; this.deleted = {}; }
    const prevById = new Map(this.projects.map(p => [p.id, p]));
    this.fresh = false;
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (Array.isArray(saved.projects)) {
        // Update matching project objects in place so callers holding a project reference across takeover/reload never diverge from store.projects.
        this.projects = saved.projects.map(fresh => {
          const existing = fresh?.id && prevById.get(fresh.id);
          if (!existing) return fresh;
          for (const k of Object.keys(existing)) if (!(k in fresh)) delete existing[k];
          return Object.assign(existing, fresh);
        });
      } else {
        this.projects = [];
      }
      // Which version of the example projects this computer was given (examples.js).
      if (Number.isInteger(saved.examples)) this.examples = saved.examples;
    } catch (error) { if (error.code !== "ENOENT") throw failure("BAD_REGISTRY", "The project list could not be read.", 500); this.projects = []; this.fresh = true; }
  }
  isDeleted(project, slug) { return Boolean(this.deleted[`${project.id}:${slug}`]); }
  saveDeleted() { this.deletedVersion = (this.deletedVersion || 0) + 1; writeAtomic(this.deletedFile, JSON.stringify(this.deleted, null, 2)); }
  reconcileDeleted() {
    let changed = false;
    for (const record of Object.values(this.deleted)) {
      if (record.phase !== "pending") continue;
      const project = this.projects.find(p => p.id === record.projectId);
      if (!project || !fs.existsSync(project.docsPath)) continue;
      // Preserve failed pending records for retry if a project's docs path is broken (e.g. replaced by a regular file).
      try {
        const original = fs.existsSync(this.resolve(project, record.bundle ? L.linePath(record.slug) : record.original, { forWrite:true }));
        const trash = fs.existsSync(this.resolve(project, record.bundle ? `${record.trash}/${L.linePath(record.slug)}` : record.trash, { forWrite:true }));
        if (!original && trash) record.phase = "completed";
        else if (original && !trash) { delete this.deleted[`${record.projectId}:${record.slug}`]; }
        else { record.phase = "blocked"; record.error = "Deletion recovery found conflicting files. Check the original and recovery paths before restoring."; }
        changed = true;
      } catch { continue; }
    }
    if (changed) this.saveDeleted();
  }
  // A deleted line comes back from .trash to where it was, with its Works and files, as long as nothing has taken their place.
  restoreTopic(project, slug) {
    const key = `${project.id}:${slug}`, record = this.deleted[key];
    if (!record || record.phase !== "completed") throw failure("NOT_FOUND", "That line is not in Deleted any more.", 404);
    // A line deleted before its Works and files went with it (one file in .trash) comes back alone, to the Lines of today's layout.
    const parts = record.bundle ? (record.parts || []).map(name => [`${record.trash}/${name}`, name]) : [[record.trash, L.linePath(slug)]];
    const moves = parts.map(([from, name]) => [this.resolve(project, from, { forWrite:true }), this.resolve(project, name, { forWrite:true })]).filter(([from]) => fs.existsSync(from));
    if (!moves.length) throw failure("NOT_FOUND", "That line is not in Deleted any more.", 404);
    if (moves.some(([, to]) => fs.existsSync(to))) throw failure("CONFLICT", "A line with this file name is already here.", 409);
    this.onWrite?.(project, null);
    for (const [from, to] of moves) { fs.mkdirSync(path.dirname(to), { recursive:true }); fs.renameSync(from, to); this.cache.delete(to); }
    if (record.bundle) fs.rmSync(this.resolve(project, record.trash, { forWrite:true }), { recursive:true, force:true });
    delete this.deleted[key];
    this.saveDeleted();
    return { ok:true, slug };
  }
  // Deleted lines are kept for a week, then they are gone for good, with the Works and files that went with them.
  purgeDeleted(project, before) {
    let changed = false;
    for (const [key, record] of Object.entries(this.deleted)) {
      if (record.projectId !== project.id || record.phase !== "completed" || (record.deletedAt || 0) >= before) continue;
      try { fs.rmSync(this.resolve(project, record.trash, { forWrite:true }), { recursive:true, force:true }); } catch { continue; }
      delete this.deleted[key];
      changed = true;
    }
    if (changed) this.saveDeleted();
  }
  // A deleted line goes to .trash/lines/<slug>-<id>/ with its Works and its own files, in the same layout, and a note of
  // what it was, so it can be restored from the folder alone.
  deleteTopic(project, slug, { baseHash, bindings = [] } = {}) {
    if (this.isDeleted(project, slug)) throw failure("DELETED", "This line has already been deleted.", 410);
    const original = L.linePath(slug), entry = this.readText(project, original);
    if (baseHash !== entry.hash) throw failure("CONFLICT", "This line changed. Close this dialog and try again.", 409);
    const id = crypto.randomBytes(8).toString("hex"), trash = `${L.TRASH}/${slug}-${id}`, key = `${project.id}:${slug}`;
    const names = [original, L.worksDir(slug), ...(L.SHARED_FILES.has(slug) ? [] : [L.filesDir(slug)])].filter(name => fs.existsSync(this.resolve(project, name, { forWrite:true })));
    const record = { id, projectId:project.id, slug, deletedAt:Date.now(), original, trash, parts:names, bundle:true, bindings, phase:"pending" };
    this.deleted[key] = record;
    try { this.saveDeleted(); } catch (error) { delete this.deleted[key]; throw error; }
    this.onWrite?.(project, null);
    const done = [];
    try {
      // Every place is found before anything moves: an archived line's Works and files are in archive/ only while its line file is (PE-466).
      for (const [from, to] of names.map(name => [this.resolve(project, name, { forWrite:true }), this.resolve(project, `${trash}/${name}`, { forWrite:true })])) {
        fs.mkdirSync(path.dirname(to), { recursive:true });
        fs.renameSync(from, to);
        done.push([from, to]);
        this.cache.delete(from);
      }
      writeAtomic(path.join(this.resolve(project, trash, { forWrite:true }), "deleted.json"), JSON.stringify({ slug, title:F.parseLine(entry.text).title || slug, deletedAt:new Date(record.deletedAt).toISOString(), parts:names, restore:"Move each part back to the same place in the docs folder." }, null, 2));
    } catch (error) {
      for (const [from, to] of done.reverse()) { try { fs.renameSync(to, from); } catch { /* The note in deleted-lines.json says where it is. */ } }
      delete this.deleted[key];
      try { this.saveDeleted(); } catch { this.deleted[key] = record; throw failure("DELETE_RECOVERY", "The file could not be moved and its deletion record could not be cleared. Restart PenEcho to reconcile it.", 500); }
      throw failure("DELETE_FAILED", "The line could not be moved. It has not been deleted.", 500);
    }
    record.phase = "completed";
    let warning = "";
    try { this.saveDeleted(); } catch { warning = "The document was moved. PenEcho will finish its deletion record on restart."; }
    return { ok:true, recoveryPath:this.resolve(project, trash, { forWrite:true }), warning };
  }
  // ---------- Layout: which place on disk a name has (layout.js) ----------
  layoutOf(project, { strict = false } = {}) {
    const hit = this.layouts.get(project.docsPath), now = Date.now();
    if (!strict && hit && now - hit.at < FOLDER_MS) return hit.version;
    const version = strict ? L.versionOf(project.docsPath, { strict:true }) : (fs.existsSync(project.docsPath) ? L.versionOf(project.docsPath) : L.VERSION);
    this.layouts.set(project.docsPath, { version, at:now });
    return version;
  }
  forgetLayout(project) { this.layouts.delete(project.docsPath); this.cache.clear(); }
  // Is this line in the Archive folder? Only in layout 2.
  inArchive(project, slug, { trust = false } = {}) {
    const docs = project.docsPath, names = trust ? [L.linePath(slug), `${L.ARCHIVE}/${L.linePath(slug)}`] : null;
    const key = `${docs}\0archived\0${slug}`, known = trust ? this.cache.known.get(key) : null;
    if (known && this.watch && Date.now() - known.at < TRUST_MS && this.watch.still(docs, names, known.mark)) return known.archived;
    const mark = trust ? this.watch?.mark(docs) ?? null : null;
    const archived = Boolean(lstatOf(path.join(docs, L.ARCHIVE, L.linePath(slug)))) && !lstatOf(path.join(docs, L.linePath(slug)));
    if (mark !== null) this.remember(key, { archived, mark, at:Date.now() });
    return archived;
  }
  remember(key, known) {
    if (this.cache.known.size >= MOST_KNOWN) this.cache.known.clear();
    this.cache.known.set(key, known);
  }
  place(project, rel, { trust = false } = {}) {
    if (this.layoutOf(project) === 1) return L.toV1(rel);
    // A Work linked the way layout 1 linked it from its Line ("<slug>/work-1.md", as PenEcho Cloud still writes it) is in works/.
    if (/^lines\/[^/]+\/./.test(rel)) rel = `${L.WORKS}/${rel.slice(L.LINES.length + 1)}`;
    // A Line named the way layout 1 named it (an old link, a bookmark, a Canvas opened from one) is found where it is now.
    if (rel.startsWith(`${L.TOPICS}/`) && !lstatOf(path.join(project.docsPath, rel))) {
      const now = L.fromV1(rel), slug = L.ownerOf(now);
      if (slug && (lstatOf(path.join(project.docsPath, L.linePath(slug))) || this.inArchive(project, slug))) rel = now;
    }
    const slug = L.ownerOf(rel);
    return slug && !L.SHARED_FILES.has(slug) && this.inArchive(project, slug, { trust }) ? `${L.ARCHIVE}/${rel}` : rel;
  }
  // The full path of a name, for an agent or a program that is handed a path.
  full(project, rel) { return path.join(project.docsPath, this.place(project, String(rel).replace(/\\/g, "/"))); }
  // Archiving a line moves it, its Works and its files into archive/, in the same layout, so the folder and an agent's search
  // show only current work; unarchiving moves them back. Links in Topics and understanding.md follow. Nothing taken is overwritten.
  // `trust`: where the line is may be taken from what is known (TRUST_MS); a move still looks at every part on disk first.
  placeLine(project, slug, archived, { trust = false } = {}) {
    if (this.layoutOf(project) !== 2 || L.SHARED_FILES.has(slug) || this.inArchive(project, slug, { trust }) === archived) return false;
    const docs = project.docsPath, from = archived ? "" : `${L.ARCHIVE}/`, to = archived ? `${L.ARCHIVE}/` : "";
    if (!lstatOf(path.join(docs, from + L.linePath(slug)))) return false;
    const moves = [L.linePath(slug), L.worksDir(slug), L.filesDir(slug)].filter(name => lstatOf(path.join(docs, from + name))).map(name => [from + name, to + name]);
    if (moves.some(([, b]) => lstatOf(path.join(docs, b)))) return false;
    const done = [];
    try {
      for (const [a, b] of moves) { fs.mkdirSync(path.dirname(path.join(docs, b)), { recursive:true }); fs.renameSync(path.join(docs, a), path.join(docs, b)); done.push([a, b]); }
    } catch {
      for (const [a, b] of done.reverse()) { try { fs.renameSync(path.join(docs, b), path.join(docs, a)); } catch { /* Left where it is; nothing is lost. */ } }
      this.cache.clear(); this.onWrite?.(project);
      return false;
    }
    this.cache.clear();
    // Links to it in the Topics and understanding.md follow it. The line itself, its Works and other Lines are not rewritten: a Line
    // is the person's record, and archiving one changes no other. Its links to its own Works and files still hold (they moved with it);
    // PenEcho reads every link as a name either way (layout.js resolveFrom).
    const where = name => { for (const [a, b] of moves) { if (name === a) return b; if (name.startsWith(`${a}/`)) return b + name.slice(a.length); } return null; };
    const listMd = dir => { try { return fs.readdirSync(path.join(docs, dir)).filter(n => n.endsWith(".md")).map(n => `${dir}/${n}`); } catch { return []; } };
    for (const rel of [L.UNDERSTANDING, ...listMd(L.TOPICS)]) {
      try {
        const file = path.join(docs, rel), text = fs.readFileSync(file, "utf8"), next = L.rewriteLinks(text, rel, rel, where);
        if (next !== text) writeAtomic(file, next);
      } catch { /* Not there. */ }
    }
    this.onWrite?.(project, null);
    return true;
  }
  save() { writeAtomic(this.file, JSON.stringify({ version:1, ...(this.examples ? { examples:this.examples } : {}), projects:this.projects }, null, 2)); }
  // Canvases that belong to no project live in an ordinary project of their own, made the first time one is needed.
  // It is never archived or removed, so there is always somewhere for a Canvas to be.
  myCanvases({ create = true } = {}) {
    let project = this.projects.find(p => p.myCanvases);
    if (project || !create) return project || null;
    const docsPath = path.join(this.docsBase, MY_CANVASES);
    project = fs.existsSync(docsPath) && fs.readdirSync(docsPath).length ? this.importFolder({ docsPath }) : this.create({ name:MY_CANVASES, docsPath });
    Object.assign(project, { myCanvases:true, archived:false, pinned:false, offerSkill:false });
    delete project.archivedAt;
    this.save();
    return project;
  }
  get(id) {
    const project = id === MY_CANVASES_ID ? this.myCanvases({ create:false }) : this.projects.find(p => p.id === id);
    if (!project) throw failure("NOT_FOUND", "This project is not in PenEcho any more.", 404);
    return project;
  }
  checkFolder(value, label) {
    const folder = String(value || "").trim().replace(/^~(?=$|[\\/])/, () => os.homedir());
    if (!path.isAbsolute(folder)) throw failure("BAD_FOLDER", `${label} must be a full path.`);
    return path.resolve(folder);
  }
  codeOwner(codePath, { excludeId = null } = {}) {
    const code = this.checkFolder(codePath, "The code folder"), candidateReal = projectFolder(code);
    const folded = folder => {
      const normalized = path.resolve(folder);
      return process.platform === "darwin" || process.platform === "win32" ? normalized.toLowerCase() : normalized;
    };
    for (const other of this.projects) {
      if (other.id === excludeId) continue;
      for (const existing of other.codePaths || []) {
        let existingReal;
        try { existingReal = projectFolder(existing); }
        catch {
          // A damaged path on another project must never refuse a healthy project's folder.
          try { existingReal = path.resolve(existing); } catch { continue; }
        }
        try {
          if (sameFolder(existingReal, candidateReal)) return other;
          // Real paths cannot prove equality when either destination is not on disk yet.
          if ((!fs.existsSync(existingReal) || !fs.existsSync(candidateReal)) && folded(existingReal) === folded(candidateReal)) return other;
        } catch { /* An unreadable path on another project is skipped, too. */ }
      }
    }
    return null;
  }
  checkCodeFolder(codePath, { excludeId = null, docsPath = null } = {}) {
    const code = this.checkFolder(codePath, "The code folder"), candidateReal = projectFolder(code);
    if (docsPath && sameFolder(candidateReal, projectFolder(this.checkFolder(docsPath, "The docs folder")))) throw failure("BAD_FOLDER", "Choose a docs folder that is not the code folder itself. A subfolder such as docs/penecho works.");
    const other = this.codeOwner(code, { excludeId });
    if (other) {
      const archived = Boolean(other.archived), conflict = { id:other.id, name:other.name, archived };
      const message = archived
        ? `This code folder is already used by the archived project “${other.name}”. Restore or delete “${other.name}” in Settings › Archived, or choose another code folder.`
        : `This code folder is already used by the project “${other.name}”. Open that project instead, or unlink its code folder in Project settings first.`;
      throw Object.assign(failure("CODE_FOLDER_IN_USE", message, 409), { conflict });
    }
    return code;
  }
  create({ name, docsPath, codePath }) {
    if (!clip(name, 80).trim()) throw failure("BAD_NAME", "Give the project a name.");
    const docs = this.checkNewFolder(docsPath);
    return this.#initializeProject({ name, docsPath:docs, codePath });
  }
  #registeredFolder(folder) {
    try { return { root:projectFolder(folder), resolved:true }; }
    catch {
      try { return { root:path.resolve(folder), resolved:false }; }
      catch { return null; }
    }
  }
  projectAt(docs) {
    const real = projectFolder(docs);
    const fold = folder => (process.platform === "darwin" || process.platform === "win32" ? path.resolve(folder).toLowerCase() : path.resolve(folder));
    return this.projects.find(p => {
      const entry = this.#registeredFolder(p.docsPath);
      if (!entry) return false;
      if (entry.resolved && sameFolder(entry.root, real)) return true;
      return fold(entry.root) === fold(real) || fold(p.docsPath) === fold(docs);
    });
  }
  checkProjectLocation(docs) {
    const real = projectFolder(docs);
    const fold = folder => (process.platform === "darwin" || process.platform === "win32" ? path.resolve(folder).toLowerCase() : path.resolve(folder));
    for (const project of this.projects) {
      const entry = this.#registeredFolder(project.docsPath);
      if (!entry) continue;
      const { root, resolved } = entry;
      if ((resolved && sameFolder(root, real)) || fold(root) === fold(real) || fold(project.docsPath) === fold(docs)) throw failure("PROJECT_EXISTS", `This folder already belongs to the project “${project.name}”. Open that project, or use “Open existing docs folder”.`, 409);
      if ((resolved && containsFolder(root, real)) || insideFolder(root, real) || insideFolder(project.docsPath, docs)) throw failure("PROJECT_OVERLAP", `This folder is inside the project “${project.name}”. Choose an empty folder outside existing PenEcho projects.`, 409);
      if ((resolved && containsFolder(real, root)) || insideFolder(real, root) || insideFolder(docs, project.docsPath)) throw failure("PROJECT_OVERLAP", `This folder contains the project “${project.name}”. Choose an empty folder outside existing PenEcho projects.`, 409);
    }
    // Also protect projects not in this computer's registry, and the selected ancestry when a link points outside it.
    for (const start of new Set([docs, real])) {
      for (let at = start; ; at = path.dirname(at)) {
        if (isProjectFolder(at)) throw failure("PROJECT_OVERLAP", "This folder is already part of a PenEcho project. Choose an empty folder outside it, or use “Open existing docs folder” to open that project.", 409);
        if (path.dirname(at) === at) break;
      }
    }
  }
  checkNewFolder(value) {
    const docs = this.checkFolder(value, "The docs folder");
    this.checkProjectLocation(docs);
    if (fs.existsSync(docs) && fs.readdirSync(docs).length) throw failure("FOLDER_NOT_EMPTY", "This docs folder is not empty. Choose an empty folder or a new folder path. To reopen a PenEcho project, use “Open existing docs folder”.", 409);
    return docs;
  }
  // Only Cloud restoration calls this, after checking the empty destination and downloading its files.
  // It is not a creation option and is never selected by request JSON.
  restoreDownloadedProject({ name, docsPath }) {
    const docs = this.checkFolder(docsPath, "The docs folder");
    return this.#initializeProject({ name, docsPath:docs });
  }
  #initializeProject({ name, docsPath, codePath }) {
    const title = clip(name, 80).trim();
    if (!title) throw failure("BAD_NAME", "Give the project a name.");
    const docs = this.checkFolder(docsPath, "The docs folder");
    if (fs.existsSync(docs) && !fs.statSync(docs).isDirectory()) throw failure("BAD_FOLDER", "The docs folder path is a file.");
    const existing = this.projectAt(docs);
    if (existing) return existing;
    const code = codePath ? this.checkCodeFolder(codePath, { docsPath:docs }) : null;
    // A new folder, or one with no Lines in it yet, starts in today's layout. One made by an older PenEcho is moved when it is opened.
    const fresh = L.versionOf(docs) === L.VERSION;
    for (const folder of fresh ? [L.LINES, L.WORKS, L.TOPICS, L.FILES] : [L.FILES]) fs.mkdirSync(path.join(docs, folder), { recursive:true });
    if (fresh && !L.readState(docs)) L.markVersion(docs, L.VERSION);
    // An existing folder is adopted as it is. Nothing already there is overwritten.
    const prefix = (title.match(/[A-Za-z0-9]/g) || ["T"]).slice(0, 2).join("").toUpperCase().padEnd(2, "T");
    const memory = path.join(docs, "MEMORY.md");
    if (!fs.existsSync(memory)) writeAtomic(memory, Memory.initialMemory(title, prefix, L.versionOf(docs)));
    try { Memory.installTool(docs); require("../slides.js").installSlideRules(path.join(docs, Memory.TOOL_DIR)); require("../prototype-rules.js").installPrototypeRules(path.join(docs, Memory.TOOL_DIR)); require("./agent-help.js").install(path.join(docs, Memory.TOOL_DIR)); } catch { /* Put in place again on the next look at the folder. */ }
    const project = {
      id:`p${crypto.randomBytes(6).toString("hex")}`, name:title, color:COLORS[this.projects.length % COLORS.length], docsPath:docs, codePaths:code ? [code] : [],
      pinned:false, createdAt:Date.now(), lastOpenedAt:Date.now(), prefix, seq:1, defaultAgent:"", roles:{}, autoWake:true, offerSkill:true,
    };
    this.projects.unshift(project);
    this.save();
    return project;
  }
  // A docs folder PenEcho made before, on this computer or another, comes back as it was: its name, its code folder
  // if that is here, and Topic ids that carry on after the last one. A folder that was never a project is refused.
  importFolder({ docsPath }) {
    const docs = this.checkFolder(docsPath, "The docs folder");
    if (!fs.existsSync(docs) || !fs.statSync(docs).isDirectory()) throw failure("BAD_FOLDER", "That docs folder does not exist.");
    const existing = this.projectAt(docs);
    if (existing) { if (existing.archived) this.update(existing.id, { archived:false }); return existing; }
    const read = name => { try { return fs.readFileSync(path.join(docs, name), "utf8"); } catch { return ""; } };
    const field = (text, key) => F.splitFront(text).front[key] || "";
    // Lines are in lines/ and archive/lines/, or in topics/ in a folder an older PenEcho made.
    let topicFiles = [];
    for (const dir of L.versionOf(docs) === 1 ? [L.TOPICS] : [L.LINES, `${L.ARCHIVE}/${L.LINES}`]) {
      try { topicFiles.push(...fs.readdirSync(path.join(docs, dir)).filter(f => f.endsWith(".md") && !f.endsWith(".tasks.md")).map(f => `${dir}/${f}`)); } catch { /* Not there. */ }
    }
    const readme = read("README.md"), memory = read("MEMORY.md");
    const name = field(readme, "project") || field(memory, "project");
    if (!name && !topicFiles.length) throw failure("NOT_PROJECT", "This folder is not a PenEcho docs folder. Choose the folder that holds MEMORY.md and lines, or create a new project.");
    const isFolder = folder => { try { return path.isAbsolute(folder) && fs.statSync(folder).isDirectory(); } catch { return false; } };
    const ids = {}, codes = {};
    for (const file of topicFiles.slice(0, this.maxEntries)) {
      const text = read(file), id = field(text, "id").match(/^([A-Z0-9]+)-(\d+)$/), code = field(text, "code");
      if (id) ids[id[1]] = Math.max(ids[id[1]] || 0, Number(id[2]));
      if (code) codes[code] = (codes[code] || 0) + 1;
    }
    // The README says which code folder the project had; older folders only say it in their Topics.
    const named = field(readme, "code");
    const code = [named !== "none" && named, ...Object.keys(codes).sort((a, b) => codes[b] - codes[a])].find(folder => folder && folder !== docs && isFolder(folder));
    const owner = code ? this.codeOwner(code) : null;
    // Opening docs is still safe when their old code folder now belongs elsewhere: open them without linking it.
    const project = this.#initializeProject({ name:name || path.basename(docs), docsPath:docs, codePath:code && !owner ? code : undefined });
    if (owner) (this.importConflicts ||= new Map()).set(project.id, { path:code, id:owner.id, name:owner.name, archived:Boolean(owner.archived) });
    const prefix = Object.keys(ids).sort((a, b) => ids[b] - ids[a])[0];
    if (prefix) { project.prefix = prefix; project.seq = ids[prefix] + 1; this.save(); }
    return project;
  }
  importCodeConflict(project) {
    const conflict = this.importConflicts?.get(project.id) || null;
    this.importConflicts?.delete(project.id);
    return conflict;
  }
  setFavorite(project, file, on) {
    const kept = (project.favoriteFiles || []).filter(f => f !== file);
    project.favoriteFiles = on ? [file, ...kept].slice(0, 2000) : kept;
  }
  // A renamed file stays a favourite under its new name.
  moveFavorite(project, from, to) {
    if (!project.favoriteFiles?.includes(from)) return;
    project.favoriteFiles = project.favoriteFiles.map(f => (f === from ? to : f));
    this.save();
  }
  update(id, patch) {
    const project = this.get(id);
    // Validate folder changes before touching the in-memory project, not just before saving it.
    const nextDocs = patch.docsPath ? this.checkFolder(patch.docsPath, "The docs folder") : project.docsPath;
    if (patch.docsPath && (!fs.existsSync(nextDocs) || !fs.statSync(nextDocs).isDirectory())) throw failure("BAD_FOLDER", "That docs folder does not exist.");
    let nextCode;
    if (patch.codePath !== undefined && patch.codePath) nextCode = this.checkCodeFolder(patch.codePath, { excludeId:project.id, docsPath:nextDocs });
    else if (patch.docsPath && patch.codePath === undefined) {
      const docsReal = projectFolder(nextDocs);
      for (const existing of project.codePaths || []) {
        let existingReal;
        try { existingReal = projectFolder(existing); } catch { continue; }
        if (sameFolder(existingReal, docsReal)) throw failure("BAD_FOLDER", "Choose a docs folder that is not the code folder itself. A subfolder such as docs/penecho works.");
      }
    }
    if (typeof patch.name === "string" && patch.name.trim()) project.name = clip(patch.name, 80).trim();
    if (typeof patch.pinned === "boolean") project.pinned = patch.pinned;
    // Archived: out of the sidebar and the Canvas, folders untouched, back with Restore.
    if (project.myCanvases && patch.archived === true) throw failure("KEPT", "My Canvases stays where it is. It cannot be archived.");
    if (typeof patch.archived === "boolean" && patch.archived !== Boolean(project.archived)) { project.archived = patch.archived; if (patch.archived) { project.pinned = false; project.archivedAt = Date.now(); } else delete project.archivedAt; }
    if (typeof patch.autoWake === "boolean") project.autoWake = patch.autoWake;
    // Project memory (MEMORY.md) and Topics (topics/, understanding.md): on unless switched off in the project's settings.
    if (typeof patch.projectMemory === "boolean") project.projectMemory = patch.projectMemory;
    if (typeof patch.projectTopics === "boolean") project.projectTopics = patch.projectTopics;
    if (typeof patch.offerSkill === "boolean") project.offerSkill = patch.offerSkill;
    if (typeof patch.follow === "boolean") { if (patch.follow && project.follow === false) project.followSince = Date.now(); project.follow = patch.follow; }
    if (typeof patch.defaultAgent === "string") project.defaultAgent = clip(patch.defaultAgent, 40);
    // The order you dragged the lines into on the map, and whether the map follows it or the time each line started.
    if (Array.isArray(patch.lineOrder)) project.lineOrder = patch.lineOrder.slice(0, 1000).map(id => clip(id, 160)).filter(Boolean);
    if (["time", "mine", "topic"].includes(patch.lineSort)) project.lineSort = patch.lineSort;
    // Favourite files on Canvases & files: one is starred or unstarred at a time, so two pages starring at once keep both.
    if (patch.favorite && typeof patch.favorite.path === "string" && patch.favorite.path.trim()) this.setFavorite(project, clip(patch.favorite.path, 400), Boolean(patch.favorite.on));
    if (patch.roles && typeof patch.roles === "object") project.roles = Object.fromEntries(Object.entries(patch.roles).slice(0, 12).map(([k, v]) => [clip(k, 40), clip(v, 60)]));
    if (patch.opened) project.lastOpenedAt = Date.now();
    if (patch.codePath !== undefined) {
      const prevCode = (project.codePaths || [])[0] || "", nextList = patch.codePath ? [nextCode] : [];
      const same = !prevCode && !nextCode ? true : Boolean(prevCode && nextCode && (() => { try { return sameFolder(projectFolder(prevCode), projectFolder(nextCode)); } catch { return path.resolve(prevCode) === path.resolve(nextCode); } })());
      project.codePaths = nextList;
      project.followSince = Date.now();
      if (!same) project.synced = false;
    }
    if (patch.docsPath) project.docsPath = nextDocs;
    this.save();
    return project;
  }
  forget(id) { if (this.get(id).myCanvases) throw failure("KEPT", "My Canvases stays where it is. It cannot be removed."); this.projects = this.projects.filter(p => p.id !== id); this.save(); }
  nextId(project) { const id = ImportState.nextId(project); this.save(); return id; }

  // ---------- Files: every path stays inside the docs folder, even through links ----------
  resolve(project, relative, { forWrite = false, raw = false, trust = false } = {}) {
    const named = String(relative || "").replace(/\\/g, "/").replace(/^\.\//, "");
    if (!named || named.includes("\0") || path.isAbsolute(named) || named.split("/").some(seg => seg === ".." || seg === "")) throw failure("BAD_PATH", "That path is not inside the docs folder.");
    // A name is where layout.js says it is: in topics/ in a layout-1 folder, in archive/ for an archived line.
    const rel = raw ? named : this.place(project, named, { trust:trust && !forWrite });
    const root = realFolder(project.docsPath), full = path.resolve(root, rel);
    if (!full.startsWith(root + path.sep)) throw failure("BAD_PATH", "That path is not inside the docs folder.");
    let probe = full, kind = null;
    while (!(kind = lstatOf(probe))) { if (!forWrite) throw failure("NOT_FOUND", "That file is not in the docs folder.", 404); probe = path.dirname(probe); }
    // The file itself is looked at every time: a link is followed to where it goes. The folders it is in are known for a second.
    const real = kind.isSymbolicLink() ? realpath(probe) : kind.isDirectory() ? realFolder(probe) : path.join(realFolder(path.dirname(probe)), path.basename(probe));
    if (real !== root && !real.startsWith(root + path.sep)) throw failure("BAD_PATH", "That path leaves the docs folder.");
    return full;
  }
  // `trust`: the caller only reads, so where the file is, is not looked up again while the watcher says nothing of it; the file itself is (TRUST_MS).
  readText(project, relative, { trust = false } = {}) {
    const hit = trust ? this.trusted(project, relative) : null, kept = hit?.known.entry;
    if (kept && hit.stat?.isFile() && this.cache.get(hit.known.file) === kept && sameFile(kept, hit.stat)) return kept;
    const mark = trust ? this.watch?.mark(project.docsPath) ?? null : null;
    const file = this.resolveRead(project, relative, trust), stat = fs.statSync(file);
    if (!stat.isFile()) throw failure("NOT_FOUND", "That is not a file.", 404);
    if (stat.size > MAX_TEXT) throw failure("TOO_LARGE", "That file is too large to open as text.", 413);
    const cached = this.cache.get(file);
    if (cached && cached.mtime === stat.mtimeMs && cached.ctime === stat.ctimeMs && cached.size === stat.size && cached.ino === stat.ino && cached.dev === stat.dev) {
      if (mark !== null) this.know(project, relative, file, mark, true, cached);
      return cached;
    }
    const text = fs.readFileSync(file, "utf8");
    const after = fs.statSync(file, { throwIfNoEntry:false });
    const entry = { text, mtime:stat.mtimeMs, ctime:stat.ctimeMs, size:stat.size, ino:stat.ino, dev:stat.dev, hash:F.hashText(text) };
    if (after && after.mtimeMs === stat.mtimeMs && after.ctimeMs === stat.ctimeMs && after.size === stat.size && after.ino === stat.ino && after.dev === stat.dev) {
      this.cache.set(file, entry);
      if (mark !== null) this.know(project, relative, file, mark, true, entry);
    } else this.cache.delete(file);
    return entry;
  }
  // What is known of a name for a reader that only reads, while it can still be trusted, with the file's lstat now (null: not there); else null.
  // A file known not to be there is not there in archive/ (or out of it) either: a Line moved a moment ago is found where it went.
  // Any error looking (a link loop) leaves it to the full lookup and its own handling.
  trusted(project, relative) {
    if (!this.watch) return null;
    const known = this.cache.known.get(`${project.docsPath}\0${relative}`);
    if (!known || Date.now() - known.at >= TRUST_MS || !this.watch.still(project.docsPath, known.names, known.mark)) return null;
    try {
      const stat = lstatOf(known.file);
      if (!stat && known.twin && lstatOf(known.twin)) return null;
      return { known, stat };
    } catch { return null; }
  }
  // With `trust`, whether a Line's things are in archive/ comes from what is known; a file not found there is looked for as the disk says.
  resolveRead(project, relative, trust) {
    if (!trust) return this.resolve(project, relative);
    try { return this.resolve(project, relative, { trust:true }); }
    catch (error) { if (error.code !== "NOT_FOUND") throw error; return this.resolve(project, relative); }
  }
  // `mark` was taken before the disk was asked, so a change made while asking is newer than it and the next reader looks again.
  // The names whose change could change the answer: the file where it is, the name as asked, and the Line that decides whether it is in archive/.
  // Never throws: a read that worked is never made to fail by remembering it (scan passes over a Line whose read fails).
  know(project, relative, file, mark, isFile, entry = null, stat = null) {
    try {
      if (this.layoutOf(project) !== 2) return;
      const placed = path.relative(realFolder(project.docsPath), file).split(path.sep).join("/");
      if (!placed || placed.startsWith("..") || leftOut(placed)) return;
      const names = [placed, String(relative)], slug = L.ownerOf(String(relative)), root = realFolder(project.docsPath);
      if (slug) names.push(L.linePath(slug), `${L.ARCHIVE}/${L.linePath(slug)}`);
      // Where the file would be if its Line were (or were not) archived, and no longer trusted than the archive answer it was found by.
      const twin = slug && !L.SHARED_FILES.has(slug) ? path.join(root, placed.startsWith(`${L.ARCHIVE}/`) ? placed.slice(L.ARCHIVE.length + 1) : `${L.ARCHIVE}/${placed}`) : null;
      const at = Math.min(Date.now(), (slug && this.cache.known.get(`${project.docsPath}\0archived\0${slug}`)?.at) || Infinity);
      const meta = stat ? { mtime:stat.mtimeMs, ctime:stat.ctimeMs, size:stat.size, ino:stat.ino, dev:stat.dev }
        : entry ? { mtime:entry.mtime, ctime:entry.ctime, size:entry.size, ino:entry.ino, dev:entry.dev } : null;
      this.remember(`${project.docsPath}\0${relative}`, { file, twin, names, mark, at, isFile, entry, stat:meta });
    } catch { /* Looked at again next time. */ }
  }
  // exists() then readText(), in one look at the file when it is known (`trust`): the file's entry, or null when it is not a file there.
  readIfThere(project, relative, { trust = false } = {}) {
    const hit = trust ? this.trusted(project, relative) : null;
    if (hit && !hit.known.isFile && !hit.stat) return null;
    const kept = hit?.known.entry;
    if (kept && hit.stat?.isFile() && this.cache.get(hit.known.file) === kept && sameFile(kept, hit.stat)) return kept;
    return this.exists(project, relative, { trust }) ? this.readText(project, relative, { trust }) : null;
  }
  // For read-only version checks (pictures): returns { file, stat } for a regular file, or null when absent.
  statIfThere(project, relative, { trust = false } = {}) {
    const hit = trust ? this.trusted(project, relative) : null;
    if (hit) {
      if (!hit.known.isFile && !hit.stat) return null;
      if (hit.known.isFile && hit.stat?.isFile() && hit.known.stat && sameFile(hit.known.stat, hit.stat)) return { file:hit.known.file, stat:hit.stat };
    }
    const mark = trust ? this.watch?.mark(project.docsPath) ?? null : null;
    let file = null, stat = null;
    try { file = this.resolveRead(project, relative, trust); stat = fs.statSync(file); if (!stat.isFile()) stat = null; } catch { stat = null; }
    if (mark !== null && !stat) {
      try { file ||= this.resolve(project, relative, { forWrite:true }); } catch { file = null; }
    }
    if (mark !== null && file) {
      const kept = stat ? this.cache.get(file) : null, entry = kept && sameFile(kept, stat) ? kept : null;
      this.know(project, relative, file, mark, Boolean(stat), entry, stat);
    }
    return stat ? { file, stat } : null;
  }
  // A Markdown file parsed as a line, once for each time it changes. Nothing may change what it gives back. For reading only.
  parsed(project, relative) {
    const entry = this.readText(project, relative, { trust:true });
    return entry.doc || (entry.doc = F.parseLine(entry.text));
  }
  stepDetail(project, slug, step, { strict = false, trust = false } = {}) {
    const own = F.detailPath(slug, step.id);
    if (!step.detailHref) return own;
    const linked = L.fromLine(step.detailHref);
    return linked !== own && /^(?:works|lines)\/[^/]+\/[^/]+\.md$/.test(linked)
      && (strict ? this.strictExists(project, linked) : this.exists(project, linked, { trust }))
      ? linked : own;
  }
  exists(project, relative, { trust = false } = {}) {
    const hit = trust ? this.trusted(project, relative) : null;
    if (hit && (hit.known.isFile ? hit.stat?.isFile() && hit.known.stat && sameFile(hit.known.stat, hit.stat) : !hit.stat)) return hit.known.isFile;
    const mark = trust ? this.watch?.mark(project.docsPath) ?? null : null;
    let file = null, stat = null, isFile = false;
    try { file = this.resolveRead(project, relative, trust); stat = fs.statSync(file); isFile = stat.isFile(); } catch { /* Not there. */ }
    if (mark !== null && !isFile) {
      // Not there: known by where it would be.
      try { file ||= this.resolve(project, relative, { forWrite:true }); } catch { file = null; }
    }
    // Preserve cached text only if it still matches this exact file version.
    if (mark !== null && file) {
      const kept = isFile ? this.cache.get(file) : null, entry = kept && stat && sameFile(kept, stat) ? kept : null;
      this.know(project, relative, file, mark, isFile, entry, isFile ? stat : null);
    }
    return isFile;
  }
  // Fail-closed existence check for strict ratings scans: missing files return false, while I/O or permission errors propagate.
  strictExists(project, relative) {
    try { return fs.statSync(this.resolve(project, relative)).isFile(); }
    catch (error) {
      if (error?.code === "NOT_FOUND" || error?.code === "ENOENT" || error?.code === "ENOTDIR") return false;
      throw error;
    }
  }
  writeText(project, relative, text, { history = false, baseHash = null, generatedStatus = false, createOnly = false } = {}) {
    const normalized = path.posix.normalize(String(relative).replace(/\\/g, "/")), topic = normalized.match(/^lines\/([^/]+)\.md$/);
    if (topic && this.isDeleted(project, topic[1])) throw failure("DELETED", "This line was deleted. Create a new line to continue.", 410);
    if (!String(relative).endsWith(".md") && !String(relative).endsWith(".json")) throw failure("BAD_PATH", "Only Markdown can be edited as text.");
    const file = this.resolve(project, relative, { forWrite:true });
    let previous = null;
    if (!createOnly && fs.existsSync(file)) previous = this.readText(project, relative);
    if (generatedStatus && !previous) throw failure("CONFLICT", "The Line was removed during its status refresh.", 409);
    if (baseHash && previous && previous.hash !== baseHash) throw Object.assign(failure("CONFLICT", "This file changed while you were editing it.", 409), { current:previous.text, currentHash:previous.hash });
    if (topic && previous?.text !== text) text = keepArchiveTime(text, previous);
    if (previous?.text === text) return previous;
    if (history && previous) this.keepHistory(project, relative, previous.text);
    const expected = baseHash || generatedStatus ? (previous || { missing:true }) : null;
    let written;
    try { written = writeAtomic(file, text, { expected, generatedStatus, createOnly }); }
    catch (error) {
      if (error.code === "CONFLICT" && fs.existsSync(file)) {
        this.cache.delete(file);
        try { const fresh = this.readText(project, relative); error.current = fresh.text; error.currentHash = fresh.hash; } catch {}
      }
      throw error;
    }
    text = typeof text === "string" ? text.toWellFormed() : Buffer.from(text).toString("utf8");
    const stat = fs.statSync(file);
    // Never seed this.cache under a post-rename stat whose ctime could belong to a concurrent same-inode edit;
    // return the written entry directly (avoiding an eager readFileSync on write) and let the next readText() verify from disk.
    this.cache.delete(file);
    if (written.ino !== stat.ino || written.dev !== stat.dev || written.size !== stat.size || written.mtimeMs !== stat.mtimeMs) {
      this.onWrite?.(project, [this.place(project, normalized)]);
      return this.readText(project, relative);
    }
    const entry = { text, mtime:stat.mtimeMs, ctime:stat.ctimeMs, size:stat.size, ino:stat.ino, dev:stat.dev, hash:F.hashText(text) };
    const doc = topic ? (entry.doc = F.parseLine(text)) : null;
    if (doc?.isLine && this.placeLine(project, topic[1], L.ARCHIVED.has(doc.status))) return this.readText(project, relative);
    this.onWrite?.(project, [this.place(project, normalized)]);
    return stat.size > MAX_TEXT ? this.readText(project, relative) : entry;
  }
  keepHistory(project, relative, text) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-"), name = String(relative).replace(/\//g, "__");
    const dir = path.dirname(this.resolve(project, ".history/x", { forWrite:true }));
    try {
      writeAtomic(path.join(dir, `${stamp}__${name}`), text);
      const same = fs.readdirSync(dir).filter(file => file.endsWith(`__${name}`)).sort();
      const removed = same.slice(0, Math.max(0, same.length - HISTORY_KEEP));
      for (const old of removed) fs.unlinkSync(path.join(dir, old));
      this.onWrite?.(project, [`${stamp}__${name}`, ...removed].map(file => `.history/${file}`));
    } catch (error) { this.onWrite?.(project); throw error; }
  }
  writeBytes(project, relative, bytes) {
    const file = this.resolve(project, relative, { forWrite:true });
    writeAtomic(file, bytes);
    this.cache.delete(file);
    this.onWrite?.(project, [this.place(project, String(relative).replace(/\\/g, "/"))]);
  }
  uniquePath(project, dir, name) {
    const clean = safeName(name), ext = path.extname(clean), stem = clean.slice(0, clean.length - ext.length);
    if (!FILE_NAME.test(clean)) throw failure("BAD_NAME", "That file name is not allowed.");
    let candidate = `${dir}/${clean}`, n = 2;
    while (this.exists(project, candidate)) candidate = `${dir}/${stem}-${n++}${ext}`;
    return candidate;
  }
  // The lines are read first, then their files, then whatever else is in the folder, so nothing put beside them
  // (a program an agent installed held 7,650 files) can use up the count before the lines are reached.
  // In files/ each Line's folder gets its share first: one research folder of 3,399 logs hid every Line's files after it (PE-549).
  walk(project, { limit = this.maxEntries, strict = false, ratingOnly = false, holdFileStat = null } = {}) {
    const root = project.docsPath, out = [], seen = new Set();
    if (strict) {
      let stat;
      try { stat = fs.statSync(root); }
      catch (error) {
        if (error?.code === "ENOENT" || error?.code === "ENOTDIR") throw failure("FOLDER_MISSING", `PenEcho cannot find this project's docs folder at ${root}.`, 410);
        throw error;
      }
      if (!stat.isDirectory()) throw failure("FOLDER_MISSING", `PenEcho cannot find this project's docs folder at ${root}.`, 410);
    } else if (!fs.existsSync(root)) throw failure("FOLDER_MISSING", `PenEcho cannot find this project's docs folder at ${root}.`, 410);
    const visit = (dir, rel, cap = limit) => {
      if (out.length >= cap) { if (strict) throw failure("SCAN_TRUNCATED", "Project folder exceeded scan limit."); return; }
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes:true }); } catch (error) { if (strict) throw error; return; }
      if (!rel) entries.sort((a, b) => rootOrder(a) - rootOrder(b) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      // In archive/ keep Line and Work records ahead of attachments too.
      else if (rel === L.ARCHIVE) entries.sort((a, b) => (ARCHIVE_ORDER[a.name] ?? 3) - (ARCHIVE_ORDER[b.name] ?? 3));
      entries = entries.filter(entry => !(HIDDEN.has(entry.name) || (entry.name.startsWith(".") && entry.name !== ".history") || entry.isSymbolicLink() || entry.name.endsWith(".tmp")));
      // A Mac program is one thing to open, not thousands of files of the project.
      const into = entry => entry.isDirectory() && !BUNDLE.test(entry.name);
      if ((!strict || limit < Infinity) && (rel === L.FILES || rel === `${L.ARCHIVE}/${L.FILES}`)) for (const entry of entries) if (into(entry)) visit(path.join(dir, entry.name), `${rel}/${entry.name}`, Math.min(cap, out.length + FOLDER_SHARE));
      for (const entry of entries) {
        const full = path.join(dir, entry.name), next = rel ? `${rel}/${entry.name}` : entry.name;
        if (first.includes(next) || seen.has(next)) continue;
        if (into(entry)) { if (!ratingOnly) visit(full, next, cap); }
        else if (entry.isFile()) {
          if (out.length >= cap) { if (strict) throw failure("SCAN_TRUNCATED", "Project folder exceeded scan limit."); return; }
          try { const stat = fs.statSync(full); out.push(withFileGen({ path:next, size:stat.size, mtime:stat.mtimeMs }, stat)); seen.add(next); }
          catch (error) {
            if (holdFileStat?.(error)) { out.push({ path:next, size:null, mtime:0, skipped:"unreadable" }); seen.add(next); }
            else if (strict) throw error;
          }
        }
      }
    };
    // Every Line, then its Works, before attachments, archived ones too. Active
    // Lines can link archived Works. Omitting those at the count loses their
    // review state in Cloud: sync mistakes the omitted record for a deletion.
    // Rating-only strict scans inspect only Line folders (lines/ + archive/lines/, or topics/ in layout 1) so
    // unrelated attachments in files/ can never consume the entry cap or fail a ratings upload (PE-817).
    const seeds = ratingOnly
      ? (this.layoutOf(project, { strict }) === 1 ? [L.TOPICS] : [L.LINES, `${L.ARCHIVE}/${L.LINES}`])
      : [L.LINES, `${L.ARCHIVE}/${L.LINES}`, L.WORKS, `${L.ARCHIVE}/${L.WORKS}`];
    const first = seeds.filter(rel => {
      try { return fs.lstatSync(path.join(root, rel)).isDirectory(); }
      catch (error) { if (strict && error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error; return false; }
    });
    for (const rel of first) visit(path.join(root, rel), rel);
    if (!ratingOnly) visit(root, "");
    const real = out.map(f => f.path), listed = this.named(project, out);
    REAL_PATHS.set(listed, real);
    return listed;
  }
  // The last list with only the files the folder's watcher named looked at again (folder-watch.js), or null when that cannot be
  // right: a directory, an archive mapping, or a scan at the entry limit. Names walk() leaves out are passed over.
  lineOutputNames(project, slug) {
    const found = [];
    const visit = relative => {
      const dir = path.join(project.docsPath, relative);
      if (!fs.lstatSync(dir, { throwIfNoEntry:false })?.isDirectory()) return;
      for (const item of fs.readdirSync(dir, { withFileTypes:true })) {
        const name = `${relative}/${item.name}`;
        if (leftOut(item.isDirectory() ? `${name}/` : name)) continue;
        if (item.isDirectory()) visit(name); else if (item.isFile()) found.push(name);
      }
    };
    for (const relative of [L.filesDir(slug), L.worksDir(slug)]) {
      try { this.resolve(project, relative); visit(this.place(project, relative)); } catch { /* The directory may have been moved. */ }
    }
    return found;
  }
  relisted(project, files, names) {
    const real = REAL_PATHS.get(files);
    if (!real || files.length >= this.maxEntries || this.layoutOf(project) !== 2) return null;
    try { if (!fs.statSync(project.docsPath).isDirectory()) return null; } catch { return null; }
    let at = REAL_INDEX.get(real);
    if (!at) { at = new Map(real.map((p, i) => [p, i])); REAL_INDEX.set(real, at); }
    const next = files.slice(), removed = new Set();
    let paths = real;
    const addedLower = new Set();
    const caseInsensitive = process.platform === "darwin" || process.platform === "win32";
    const docsReal = caseInsensitive ? realFolder(project.docsPath).split(path.sep).join("/") : "";
    const exactCase = rel => {
      if (!caseInsensitive) return true;
      try {
        const actual = fs.realpathSync.native(path.join(project.docsPath, rel)).split(path.sep).join("/");
        return actual === `${docsReal}/${rel}`;
      } catch { return false; }
    };
    const pending = new Set(names);
    for (const name of pending) {
      const rel = name.split(path.sep).join("/");
      if (leftOut(rel)) continue;
      const i = at.get(rel);
      if (!rel || path.isAbsolute(rel) || rel.split("/").includes("..") || rel === L.ARCHIVE || rel.startsWith(`${L.ARCHIVE}/`)) return null;
      for (let parent = path.dirname(rel); parent !== "."; parent = path.dirname(parent)) {
        try { if (!fs.lstatSync(path.join(project.docsPath, parent)).isDirectory()) return null; } catch { return null; }
        if (!exactCase(parent)) return null;
      }
      let stat;
      try { stat = fs.lstatSync(path.join(project.docsPath, rel)); } catch (error) {
        if (error.code !== "ENOENT" || i === undefined || at.has(`${L.ARCHIVE}/${rel}`) || real.some(existing => existing.startsWith(`${rel}/`))) return null;
        removed.add(i); continue;
      }
      if (!stat.isFile()) return null;
      const line = /^lines\/([^/]+)\.md$/.exec(rel);
      if (line) {
        const cached = this.cache.get(path.join(project.docsPath, rel));
        if (!cached || cached.ino !== stat.ino || cached.dev !== stat.dev || cached.mtime !== stat.mtimeMs || cached.ctime !== stat.ctimeMs || cached.size !== stat.size) {
          for (const output of this.lineOutputNames(project, line[1])) pending.add(output);
        }
      }
      if (i === undefined) {
        if (next.length + 1 >= this.maxEntries || at.has(`${L.ARCHIVE}/${rel}`) || real.some(existing => existing.startsWith(`${rel}/`))) return null;
        if (caseInsensitive) {
          if (!exactCase(rel)) return null;
          let lower = REAL_LOWER.get(real);
          if (!lower) { lower = new Set(real.map(name => name.toLowerCase())); REAL_LOWER.set(real, lower); }
          const key = rel.toLowerCase();
          if (lower.has(key) || addedLower.has(key)) return null;
          addedLower.add(key);
        }
        if (paths === real) paths = real.slice();
        next.push(withFileGen({ path:rel, size:stat.size, mtime:stat.mtimeMs }, stat)); paths.push(rel); continue;
      }
      const nextGen = fileGenOf(stat);
      if (stat.mtimeMs !== files[i].mtime || stat.size !== files[i].size || files[i].gen !== nextGen) next[i] = withFileGen({ path:files[i].path, size:stat.size, mtime:stat.mtimeMs }, stat);
    }
    const listed = removed.size ? next.filter((_, index) => !removed.has(index)) : next;
    REAL_PATHS.set(listed, removed.size ? paths.filter((_, index) => !removed.has(index)) : paths);
    return listed;
  }
  // The folder's list as names (layout.js): layout-1 places as today's names, an archived line's things as if they were not archived.
  named(project, out) {
    if (this.layoutOf(project) === 1) { for (const f of out) f.path = L.fromV1(f.path); return out; }
    const archived = new Set(out.map(f => /^archive\/lines\/([^/]+)\.md$/.exec(f.path)?.[1]).filter(Boolean));
    if (!archived.size) return out;
    const real = new Set(out.map(f => f.path));
    for (const f of out) {
      if (!f.path.startsWith(`${L.ARCHIVE}/`)) continue;
      const name = f.path.slice(L.ARCHIVE.length + 1), slug = L.ownerOf(name);
      if (slug && archived.has(slug) && !L.SHARED_FILES.has(slug) && !real.has(name)) f.path = name;
    }
    return out;
  }
  // Reads the whole project from its files. Agents and editors change these directly, so this runs often and leans on the cache.
  // `files`: the folder's list when the caller has just taken it.
  scan(project, files = null, { strict = false, ratingOnly = false, trust = false } = {}) {
    files = files || this.walk(project, { strict, ratingOnly });
    const topics = [], notes = [];
    for (const file of files) {
      // Knowledge Topics (topics/) are never Lines, whatever their front matter says; they are listed with the notes.
      const knowledge = L.isTopicPath(file.path);
      if (!(L.isLinePath(file.path) || knowledge) || file.path.endsWith(".tasks.md")) continue;
      const slug = file.path.slice(file.path.indexOf("/") + 1, -3);
      if (!knowledge && this.isDeleted(project, slug)) continue;
      let entry;
      try { entry = this.readText(project, file.path, { trust:trust && !strict }); } catch (error) { if (strict) throw error; continue; }
      // A line file is parsed once for each time it changes: readText gives the same entry until its time or size moves. Nothing changes a parsed line.
      const text = entry.text, doc = entry.doc || (entry.doc = F.parseLine(text));
      if (doc.isLine && !knowledge) topics.push({ slug, title:doc.title || slug, doc, text, hash:entry.hash, path:file.path, mtime:file.mtime });
      else notes.push({ path:file.path, title:doc.title || slug, mtime:file.mtime, slug, excerpt:clip(text.replace(/^---[\s\S]*?---\n/, "").replace(/^#.*$/gm, "").replace(/[*_`>#-]/g, "").replace(/\s+/g, " ").trim(), 180) });
    }
    return { files, topics, notes };
  }
  ensureMemory(project) {
    if (!this.exists(project, "MEMORY.md")) this.writeText(project, "MEMORY.md", Memory.initialMemory(project.name, project.prefix, this.layoutOf(project)));
    try { Memory.installTool(project.docsPath); require("../slides.js").installSlideRules(path.join(project.docsPath, Memory.TOOL_DIR)); require("../prototype-rules.js").installPrototypeRules(path.join(project.docsPath, Memory.TOOL_DIR)); require("./agent-help.js").install(path.join(project.docsPath, Memory.TOOL_DIR)); } catch { /* A folder it cannot write to is left alone. */ }
  }
  // Keeps the parts PenEcho owns in step with the files: the README index and each Topic's status block.
  // Its reads are trusted (TRUST_MS): each status it writes is checked against the file on disk (baseHash), and a CONFLICT reads it again.
  syncGenerated(project, trunk, files = null) {
    const scan = this.scan(project, files, { trust:true });
    const statusOk = (this.statusOk ||= new WeakMap());
    for (const t of scan.topics) {
      let wrote = false;
      if (statusOk.get(t.doc) !== trunk) {
        for (let attempt = 0; attempt < 3; attempt++) {
          const next = F.replaceStatus(t.text, F.statusBlock(t.doc, trunk));
          if (next === t.text) { if (attempt === 0) statusOk.set(t.doc, trunk); break; }
          try {
            const saved = this.writeText(project, t.path, next, { baseHash:t.hash, generatedStatus:true });
            t.text = saved.text; t.hash = saved.hash;
            t.doc = saved.doc || (saved.doc = F.parseLine(saved.text)); t.title = t.doc.title || t.slug;
            statusOk.set(t.doc, trunk);
            wrote = true;
            break;
          } catch (error) {
            if (error.code !== "CONFLICT" || error.conflict?.recoveryPath || attempt === 2) throw error;
            const fresh = this.readText(project, t.path);
            t.text = fresh.text; t.hash = fresh.hash;
            t.doc = fresh.doc || (fresh.doc = F.parseLine(fresh.text)); t.title = t.doc.title || t.slug;
          }
        }
      }
      // A status changed by hand, by an agent or an app, puts the line where its status says too.
      if (!wrote) this.placeLine(project, t.slug, L.ARCHIVED.has(t.doc.status), { trust:true });
    }
    const whole = scan.files.find(f => /^files\/whole-picture\.(png|jpe?g|svg|webp)$/.test(f.path));
    const detailEntries = new Map();
    const hasDetailQuestions = t => !L.ARCHIVED.has(t.doc.status) && t.doc.steps.some(s => {
      if (!F.AGENT_LIKE(s)) return false;
      const detail = this.stepDetail(project, t.slug, s, { trust:true }), entry = this.readIfThere(project, detail, { trust:true });
      detailEntries.set(`${t.slug}\0${s.id}`, entry);
      if (!entry) return false;
      // Looked for once for each time the Work file changes (readText gives the same entry until then), not at every look at the project.
      const open = entry.openQuestions || (entry.openQuestions = new Map());
      if (!open.has(s.id)) open.set(s.id, F.parseDetailQuestions(entry.text, { workId:s.id }).some(q => !q.ticked));
      return open.get(s.id);
    });
    // Checked at most once per Line per pass (readmeIndex checks hasQuestions both for grouping and for stateText).
    const qMemo = new Map(), placeMemo = new Map();
    const hasQuestions = t => {
      let q = qMemo.get(t.slug);
      if (q === undefined) { q = t.doc.questions.some(x => !x.ticked) || hasDetailQuestions(t); qMemo.set(t.slug, q); }
      return q;
    };
    const placedOf = rel => {
      let p = placeMemo.get(rel);
      if (p === undefined) { p = this.place(project, rel, { trust:true }); placeMemo.set(rel, p); }
      return p;
    };
    const stateText = t => {
      const s = t.doc.status, cur = t.doc.steps.find(x => !x.done && x.kind !== "orch-review");
      const names = { working:"Working", waiting:"Needs you", ready:"Finished, not merged", stopped:"Stopped", landed:"Landed", done:"Done", closed:"Closed", "not-started":"Not started" };
      if (F.isOutdated(t.doc)) return "Outdated";
      if (s !== "waiting" && !["working", "stopped"].includes(s) && hasQuestions(t)) return "Needs you";
      return `${names[s] || s}${cur && !F.FINISHED.has(s) && s !== "not-started" ? `: ${cur.label}` : ""}`;
    };
    // Skip rebuilding README.md when its inputs are unchanged and the README.md on disk still matches its last verified stat.
    const readmeKey = `${project.name}\0${project.codePaths[0] || ""}\0${trunk || ""}\0${whole?.path || ""}\0`
      + scan.notes.map(n => `${n.path}\x01${n.title}\x01${placedOf(n.path)}`).join("\x02") + "\0"
      + scan.topics.map(t => `${t.slug}\x01${t.hash}\x01${placedOf(t.path)}\x01${hasQuestions(t) ? 1 : 0}`).join("\x02");
    const readmeFile = path.join(project.docsPath, "README.md");
    const readmeStat = lstatOf(readmeFile), readmeVer = readmeStat?.isFile() ? `${readmeStat.dev}:${readmeStat.ino}:${readmeStat.ctimeMs}:${readmeStat.mtimeMs}:${readmeStat.size}` : "";
    const readmeMemo = (this.readmeMemo ||= new Map()), lastReadme = readmeMemo.get(project.docsPath);
    if (!readmeVer || !lastReadme || lastReadme.key !== readmeKey || lastReadme.ver !== readmeVer) {
      const readme = F.readmeIndex({ name:project.name, code:project.codePaths[0], topics:scan.topics, notes:scan.notes.map(n => ({ ...n, path:placedOf(n.path) })), whole:whole?.path, stateText, hrefOf:t => placedOf(t.path), hasQuestions });
      const saved = this.writeText(project, "README.md", readme);
      const savedVer = saved ? `${saved.dev}:${saved.ino}:${saved.ctime}:${saved.mtime}:${saved.size}` : "";
      const after = lstatOf(readmeFile);
      const afterVer = after?.isFile() ? `${after.dev}:${after.ino}:${after.ctimeMs}:${after.mtimeMs}:${after.size}` : "";
      if (afterVer && afterVer === savedVer) {
        if (readmeMemo.size > 200) readmeMemo.clear();
        readmeMemo.set(project.docsPath, { key:readmeKey, ver:afterVer });
      } else readmeMemo.delete(project.docsPath);
    }
    this.refreshMemory(project);
    scan.detailEntries = detailEntries;
    return scan;
  }
  // An older MEMORY.md, or one whose rules were lost, gets them back. What people wrote in it stays.
  refreshMemory(project) {
    if (this.exists(project, "MEMORY.md")) {
      const memory = this.readText(project, "MEMORY.md").text, checked = Memory.checkedMemory(memory, project.name, project.prefix, { layout:this.layoutOf(project) });
      if (checked !== memory) this.writeText(project, "MEMORY.md", checked, { history:true });
      // The command agents change it with sits beside it, and stays current with this copy of PenEcho.
      try { Memory.installTool(project.docsPath); require("../slides.js").installSlideRules(path.join(project.docsPath, Memory.TOOL_DIR)); require("../prototype-rules.js").installPrototypeRules(path.join(project.docsPath, Memory.TOOL_DIR)); require("./agent-help.js").install(path.join(project.docsPath, Memory.TOOL_DIR)); } catch { /* A folder it cannot write to is left alone. */ }
    }
  }
}

module.exports = { Store, failure, writeAtomic, safeName, clip, shortFolder, defaultBase, toolsFolder, leftOut, MY_CANVASES_ID };
