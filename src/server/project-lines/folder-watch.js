"use strict";
const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");

// Whether anything in a project's folder may have changed, without reading the folder each time a page asks (S1).
// Two signs, both in the key: a count the folder's watcher moves on every change it reports, and the folder's own list of files
// (path, time, size), taken again once it is older than the caller allows. The watcher makes a change show at once; the list
// is there for whatever a watcher misses (a folder it cannot watch, Linux, a drive that reports nothing), so nothing waits longer
// than the age the caller gives, which is how long an answer could be given again before.
// While the watcher works the list is that backup alone, so it is taken again only every WATCHED_MS, and at once after a change the
// watcher reports: a page asking every 2 s no longer lists a big folder each time (PE-549).
const WATCHES = process.platform === "darwin" || process.platform === "win32";
const MOST_FOLDERS = 200, WATCHED_MS = 30000, MOST_NAMED = 500, MOST_CHANGED = 20000;
// Which files changed since a reader last looked at them (`mark`, `still`), so a reader can trust what it read while the watcher says nothing
// about the file or a folder it is in. Every change any watcher reports, or PenEcho makes, takes the next number. Names are kept as the folder
// spells them with "/", and in one case on a Mac and Windows, where a name in another case is the same file.
let changes = 0;
const FOLDED = process.platform === "darwin" || process.platform === "win32";
const changeName = name => { const rel = String(name).split(path.sep).join("/"); return FOLDED ? rel.normalize("NFC").toLowerCase() : rel; };

// `ignore(name)`: a name the caller never lists (PenEcho's own .penecho folder, .git). A change there moves nothing: import locks made
// and removed there every 3 s gave every project a new key each time, so each page look made the whole state again.
function createFolderWatch({ watch = fs.watch, enabled = WATCHES, now = Date.now, watchedMs = WATCHED_MS, ignore = null } = {}) {
  const folders = new Map();
  function closeOne(entry) { try { entry.watcher?.close(); } catch { /* Already closed. */ } entry.watcher = null; entry.watching = false; }
  function entryOf(folder) {
    let entry = folders.get(folder);
    if (entry) return entry;
    if (folders.size >= MOST_FOLDERS) { for (const old of folders.values()) closeOne(old); folders.clear(); }
    entry = { count:0, watcher:null, watching:false, list:"", listedAt:0, walkedAt:0, listedCount:-1, files:null, named:new Set(), unnamed:false, since:++changes, allAt:0, changedAt:new Map() };
    folders.set(folder, entry);
    if (enabled) {
      try {
        // Which files the watcher says changed, so a list can be brought up to date without walking the folder (refresh).
        entry.watcher = watch(folder, { recursive:true, persistent:false }, (type, name) => {
          if (name && ignore?.(String(name))) return;
          entry.count++;
          if (!name || entry.named.size >= MOST_NAMED) entry.unnamed = true; else entry.named.add(String(name));
          changed(entry, name ? [name] : null);
        });
        entry.watching = true;
        // A watcher that fails says so once; from then on the folder's list is all there is.
        entry.watcher.on?.("error", () => { entry.count++; entry.unnamed = true; changed(entry, null); closeOne(entry); });
      } catch { entry.watching = false; }
    }
    return entry;
  }
  // { key, files }: files is the folder's list when it was taken just now, so the caller need not walk the folder again.
  // `refresh(files, names)` may give the last list again with only the named files looked at once more, or null when only a walk will do
  // (for example, a directory moved). While agents work they change a few files every second; walking a folder of 12,000 files each time
  // took half a second of the server's time for every change (PE-595).
  function key(folder, walk, maxAgeMs, refresh = null) {
    const entry = entryOf(folder);
    let files = null;
    const age = entry.watching ? Math.max(maxAgeMs, watchedMs) : maxAgeMs;
    if (entry.files && entry.listedCount === entry.count && !fs.existsSync(folder)) { entry.files = null; entry.listedAt = 0; }
    if (!entry.listedAt || entry.listedCount !== entry.count || now() - entry.listedAt >= age) {
      // The walk stays the backup for whatever the watcher missed: at least every `age`, as before.
      const names = entry.named, quick = refresh && entry.files && !entry.unnamed && now() - entry.walkedAt < age;
      if (quick && entry.scoped) for (const name of entry.scoped) names.add(name);
      entry.scoped = null;
      entry.named = new Set(); entry.unnamed = false;
      files = quick ? refresh(entry.files, names) : null;
      if (!files) { entry.files = null; entry.listedAt = 0; files = walk(); entry.walkedAt = now(); }
      entry.files = files;
      const hash = crypto.createHash("sha1");
      for (const f of files) hash.update(`${f.path}\0${f.mtime}\0${f.size}\0${f.gen || ""}\n`);
      entry.list = hash.digest("base64");
      entry.listedAt = now();
      entry.listedCount = entry.count;
    }
    // `listed`: the list this key stands for, taken now or earlier, for a caller that only needs it to be as fresh as the key.
    return { key:`${entry.count}:${entry.list}`, files, listed:entry.files };
  }
  // A change in the folder: with names, each of them; with none, anything in it.
  function changed(entry, names) {
    const at = ++changes;
    if (!names || entry.changedAt.size + names.length > MOST_CHANGED) { entry.changedAt.clear(); entry.allAt = at; return; }
    for (const name of names) entry.changedAt.set(changeName(name), at);
  }
  // Where a reader is before it looks at a file: null when no working watcher would tell it the file changed since.
  function mark(folder) { return folders.get(folder)?.watching ? changes : null; }
  // Whether nothing named, nor any folder it is in, changed since `mark` gave `at`. A folder moved or removed is reported by its own name only.
  function still(folder, names, at) {
    const entry = folders.get(folder);
    if (!entry?.watching || at == null || at < entry.since || at < entry.allAt) return false;
    for (const name of names) {
      for (let rel = changeName(name); rel && rel !== "."; ) {
        if ((entry.changedAt.get(rel) || 0) > at) return false;
        const cut = rel.lastIndexOf("/");
        rel = cut > 0 ? rel.slice(0, cut) : "";
      }
    }
    return true;
  }
  // A change PenEcho made itself: the next look takes the list again.
  // With no folder: every folder (a change through a route that may have written anywhere).
  // With `names`, the files it wrote: the next look brings only those up to date, as for a change the watcher named. An agent's
  // token record written every few seconds walked a folder of 5,000 files for each page's look (PE-692).
  function touch(folder = null, names = null, { scoped = false } = {}) {
    for (const [name, entry] of folders) {
      if (folder && name !== folder) continue;
      entry.count++; entry.listedAt = 0;
      changed(entry, folder && names ? names : null);
      if (scoped && entry.files && folder && names) { entry.scoped ||= new Set(); for (const name of names) entry.scoped.add(name); }
      else if (folder && names && entry.files && entry.named.size + names.length <= MOST_NAMED) { for (const n of names) entry.named.add(String(n)); }
      else entry.files = null;
    }
  }
  function watching(folder) { return Boolean(folders.get(folder)?.watching); }
  function close() { for (const entry of folders.values()) closeOne(entry); folders.clear(); }
  return { key, touch, watching, close, mark, still };
}

module.exports = { createFolderWatch, WATCHES };
