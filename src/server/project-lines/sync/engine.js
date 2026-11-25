"use strict";
// One round of sync between a project's documents folder and its copy in PenEcho Cloud, in both directions.
//
// The round:  ask Cloud what it has (cheap when nothing moved)  →  plan (plan.js)  →  pull, merge or keep both, here
//             →  send what we changed to Cloud in ONE commit that names the revision we planned against
//             →  remember what both sides now agree on.
// If Cloud moved on while we worked, the commit is refused whole and nothing of ours was written there; what we pulled and merged
// stays, and the next round finishes the job. A round can be run again at any point without losing or doubling anything.
//
// This file does not know about disks or HTTP. The caller gives it three things:
//
//   local   list()                    → { path: { sha256, size, modified } }   the documents folder, without .history/ and .trash/
//           read(path)                → Buffer
//           write(path, bytes)        writes safely; a file it replaces goes to .history/ first
//           trash(path)               moves the file to .trash/
//           rename(from, to)          only used when the user keeps both versions
//           free(path)                → a path like `path` that no file has yet (plan.md → plan-2.md)
//           (Cloud's version of a file that cannot be merged is written under .history/, which is never synced)
//   remote  manifest({ since })       → { rev, changed:false } | { rev, changed:true, files:{ path: { sha256, size, modified } } }
//           download(sha256)          → Buffer
//           commit({ rev, put:[{ path, sha256, size, modified, bytes }], remove:[path] })  → { rev, held?:Set<path> } | { stale:true }
//   state   what both sides agreed on, kept by the caller OUTSIDE the user's folder and saved after each round:
//           { rev, base:{ path: sha256 }, remote:{…last listing…}, conflicts:[{ path, otherPath, theirs, at }] }
//           text(sha256) → Buffer | null     the agreed copy of a file that can be merged, kept so a merge has its starting point
//           keep(sha256, bytes)
//
// `merge(path, base, mine, theirs, { mineNewer })` → Buffer | null joins two versions; null means it cannot. The default merges a line's
// Markdown and other text (merge.js). The caller adds Canvases by passing its own function that falls back to `mergeBytes`.
// The owner's rule when it cannot (PE-578): "local first. Do not ask user." `merge` is asked again with { localFirst:true }: where the
// two clash this computer's part wins and the rest of Cloud's changes still come in; a file that cannot be joined even so (no starting
// copy, or a kind not merged) is this computer's whole. Either way the result goes to Cloud, and Cloud's version is kept here under
// .history/cloud-<time>/, so nothing is lost and nothing waits for a choice.
//
// `deleted` names what the person deleted on purpose, which the brakes below never hold back (a whole Line is many files):
//   here(path, agreed)    → for a file this computer lacks because the person deleted it here, and Cloud still has from before that
//                           (`agreed` is the agreed list), where its Line was put aside (a path for local.write); "" otherwise
//   there(paths, mine)    → of the paths Cloud no longer has (and this computer has, unchanged), the ones the caller put aside itself,
//                           as a deletion made in Cloud. `mine` is this computer's list.
const crypto = require("node:crypto");
const { plan, stampOf } = require("./plan.js");
const { mergeFile, kindOf } = require("./merge.js");

const KEEP_TEXT_BYTES = 2 * 1024 * 1024, KEEP_CANVAS_BYTES = 16 * 1024 * 1024;
// The most files one round moves to .trash/ because Cloud no longer has them, unless they are under a fifth of the project; and,
// the other way, the most it removes from Cloud because this computer no longer has them, unless under a fifth of Cloud's copy.
const MOST_TRASHED = 5, MOST_REMOVED = 5;
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const mergeable = (path, size) => Boolean(kindOf(path)) && kindOf(path) !== "canvas" && size <= KEEP_TEXT_BYTES;
// What is kept as the starting copy of a later merge: text up to 2 MB, and a Canvas up to 16 MB, which the caller's `merge` joins by its parts.
const keepable = (path, size) => mergeable(path, size) || (kindOf(path) === "canvas" && size <= KEEP_CANVAS_BYTES);

function mergeBytes(path, base, mine, theirs, options) {
  if (!base || !mergeable(path, Math.max(mine.length, theirs.length))) return null;
  const merged = mergeFile(path, base.toString("utf8"), mine.toString("utf8"), theirs.toString("utf8"), options);
  // `localFirst`: where the two clash, this computer's stretch is kept, and everything else Cloud changed still comes in.
  return merged && (merged.clean || options?.localFirst) ? Buffer.from(merged.text, "utf8") : null;
}

const NOTHING_DELETED = { here:() => "", there:async () => [] };
const FILE_READ_ERRORS = new Set(["EACCES", "EPERM", "EBUSY", "EAGAIN", "ENOENT", "NOT_FOUND", "EISDIR"]);
const fileReadFailure = error => FILE_READ_ERRORS.has(error?.code);

async function syncOnce({ local, remote, state, merge = mergeBytes, deleted = NOTHING_DELETED, hold = () => {}, now = () => new Date() }) {
  const seen = await remote.manifest({ since:state.rev });
  const theirs = seen.changed ? seen.files : state.remote || {};
  // `localWon`: files changed on both sides that could not be merged, where this computer's version went to Cloud. `conflicts` stays
  // empty: nothing waits for the person any more.
  const did = { pulled:0, pushed:0, merged:0, trashed:0, removed:0, kept:0, restored:0, localWon:[], settled:0, conflicts:[], ...(seen.remade ? { remade:true } : {}) };
  // An unpublished Cloud copy can be initialized from a stable snapshot. Its adapter
  // records the revision and exact merge bases before releasing the captured blobs.
  if (remote.publishFirst && seen.rev === 0 && seen.changed && !Object.keys(theirs).length) {
    did.pushed = await remote.publishFirst();
    return { ...did, rev:state.rev, stale:false };
  }
  const existingRemote = seen.rev > 0 || Object.keys(theirs).length > 0;
  const mine = await local.list({ remote:theirs, base:state.base, existingRemote });
  const defer = (path, reason) => {
    mine[path] = { ...mine[path], skipped:reason };
    hold({ path, size:mine[path]?.size ?? theirs[path]?.size }, reason);
  };
  const read = async (path, hash = mine[path]?.sha256) => {
    let bytes;
    try { bytes = await local.read(path); }
    catch (error) { if (!fileReadFailure(error)) throw error; defer(path, "unreadable"); return null; }
    if (hash && sha(bytes) !== hash) { defer(path, "changed"); return null; }
    return bytes;
  };
  const download = async path => {
    try { return await remote.download(theirs[path].sha256); }
    catch (error) { if (error?.code !== "SYNC_BLOB_UNAVAILABLE") throw error; defer(path, "download_failed"); return null; }
  };
  // Cloud's copy was made again (its revision went back): nothing is agreed with it, so whatever differs is sent, brought down or kept
  // both ways, and nothing is put aside or removed on the strength of an agreement with a copy that is gone.
  // Two versions an older PenEcho kept for the person to choose between: this computer's wins now, as "mine" would (settle below).
  const waited = (state.conflicts || []).filter(entry => !mine[entry.path]?.skipped);
  did.settled = waited.length;
  for (const entry of waited) await settle({ local, state, path:entry.path, keep:"mine" });
  const agreedBase = seen.remade ? {} : state.base;
  const { actions, settled } = plan({ base:agreedBase, local:mine, remote:theirs });
  // On first joining an existing Cloud copy, matching files are a known merge base.
  // Cloud-only files and differing versions still need the normal two-way plan.
  if (!state.rev && seen.rev > 0) {
    for (const [path, hash] of Object.entries(settled)) {
      if (!keepable(path, mine[path].size)) continue;
      const bytes = await read(path, hash);
      if (bytes) await state.keep(hash, bytes);
      else delete settled[path];
    }
  }
  // Cloud saying that much of a project is gone is far more likely a mistake (a copy that was emptied or made again) than a wish, and
  // obeying it puts the user's work out of sight. So one round puts aside at most a few of this computer's files. Past that, nothing
  // is put aside: those files are sent to Cloud again. A deletion the person made in Cloud is not such a mistake: the caller puts it
  // aside itself, and it is not counted.
  const away = actions.filter(action => action.op === "trash-local");
  const dropped = new Set(away.length ? await deleted.there(away.map(action => action.path), mine) : []);
  for (const action of away) if (dropped.has(action.path)) action.op = "dropped";
  const gone = away.filter(action => action.op === "trash-local");
  did.kept = gone.length > MOST_TRASHED && gone.length * 5 > Object.values(mine).filter(f => !f.out).length ? gone.length : 0;
  if (did.kept) for (const action of gone) action.op = "push";
  // The same the other way: this computer lacking much of the project (a drive not there, a folder moved or emptied) is far more likely
  // than a wish to remove it from Cloud. Past a few files and a fifth of Cloud's copy, those files are brought back instead. What the
  // person deleted here (a Line, with its Works and files) is removed from Cloud whatever its size.
  const leaving = actions.filter(action => action.op === "remove-remote" && !deleted.here(action.path, agreedBase));
  // A file of a Line deleted here that Cloud changed or added since: Cloud's version goes where the deleted Line is, so restoring the Line
  // brings the newest, and it leaves Cloud with the rest of the Line. Brought back to its place, it would hide in a deleted Line.
  for (const action of actions) if (action.op === "pull" && !mine[action.path] && deleted.here(action.path, agreedBase)) action.op = "pull-aside";
  did.restored = leaving.length > MOST_REMOVED && leaving.length * 5 > Object.keys(theirs).length ? leaving.length : 0;
  if (did.restored) for (const action of leaving) action.op = "pull";
  const base = { ...settled }, put = [], remove = [], afterCommit = new Map();
  const agreed = async (path, hash, bytes) => { base[path] = hash; if (keepable(path, bytes.length)) await state.keep(hash, bytes); };
  const unchanged = path => { if (agreedBase[path]) base[path] = agreedBase[path]; };

  for (const { op, path } of actions) {
    // Skipped is present but not transferable, never an agreement or a deletion.
    if (op === "held" || mine[path]?.skipped) { unchanged(path); continue; }
    // Already put aside by the caller; gone from both sides, so nothing is agreed on it any more.
    if (op === "dropped") { did.trashed++; continue; }
    if (op === "pull") {
      const bytes = await download(path);
      if (!bytes) { unchanged(path); continue; }
      await local.write(path, bytes);
      await agreed(path, theirs[path].sha256, bytes);
      did.pulled++;
    } else if (op === "pull-aside") {
      const bytes = await download(path);
      if (!bytes) { unchanged(path); continue; }
      await local.write(deleted.here(path, agreedBase), bytes);
      remove.push(path);
      unchanged(path);
      afterCommit.set(path, () => { delete base[path]; did.removed++; });
      did.pulled++;
    } else if (op === "trash-local") {
      await local.trash(path);
      did.trashed++;
    } else if (op === "push") {
      const bytes = await read(path);
      if (!bytes) { unchanged(path); continue; }
      put.push({ path, sha256:mine[path].sha256, size:bytes.length, modified:mine[path].modified, bytes });
      unchanged(path);
      afterCommit.set(path, async () => { await agreed(path, mine[path].sha256, bytes); did.pushed++; });
    } else if (op === "rehome-remote") {
      // Brand-new file/Line in Cloud whose path is occupied locally by an unsynced (archived / out-of-window) file:
      // keep local's out-of-scope file untouched, write Cloud's new file under a free local name, and move Cloud's path there.
      const bytes = await download(path);
      if (!bytes) { unchanged(path); continue; }
      const moved = typeof local.rehome === "function"
        ? await local.rehome(path, bytes, { remote:theirs, local:mine })
        : { path:await local.free(path), bytes };
      const nextPath = moved.path, nextBytes = moved.bytes, nextHash = sha(nextBytes);
      await local.write(nextPath, nextBytes);
      put.push({ path:nextPath, sha256:nextHash, size:nextBytes.length, modified:theirs[path].modified || now().toISOString(), bytes:nextBytes });
      remove.push(path);
      afterCommit.set(nextPath, async () => {
        await agreed(nextPath, nextHash, nextBytes);
        delete base[path];
        did.pulled++;
        did.pushed++;
      });
    } else if (op === "unshare") {
      // A file that stays on this computer only (sync-scope.js): out of Cloud on purpose, so no guard above counts it.
      remove.push(path);
      afterCommit.set(path, () => { delete base[path]; did.unshared = (did.unshared || 0) + 1; });
    } else if (op === "remove-remote") {
      remove.push(path);
      unchanged(path);
      afterCommit.set(path, () => { delete base[path]; did.removed++; });
    } else if (op === "both") {
      const ours = await read(path);
      const other = ours && await download(path);
      if (!other) { unchanged(path); continue; }
      const start = agreedBase[path] ? await state.text(agreedBase[path]) : null;
      const mineNewer = String(mine[path].modified) >= String(theirs[path].modified);
      let joined = await merge(path, start, ours, other, { mineNewer }), localFirst = false;
      if (!joined) {
        // Local first: where they clash ours wins; Cloud's version is kept here under .history/, which is not synced.
        localFirst = true;
        joined = await merge(path, start, ours, other, { mineNewer, localFirst }) || ours;
        const keptAt = `.history/cloud-${stampOf(now())}/${path}`;
        await local.write(keptAt, other);
        did.localWon.push({ path, keptAt, at:now().toISOString() });
      }
      // From here Cloud's version is what both sides started from: if our commit is refused, the next round merges again from it, not from the old copy.
      await agreed(path, theirs[path].sha256, other);
      const hash = sha(joined);
      if (hash !== mine[path].sha256) await local.write(path, joined);
      if (hash !== theirs[path].sha256) {
        const modified = hash === mine[path].sha256 ? mine[path].modified : now().toISOString();
        put.push({ path, sha256:hash, size:joined.length, modified, bytes:joined });
        afterCommit.set(path, () => agreed(path, hash, joined));
      }
      if (!localFirst) did.merged++;
    }
  }

  let rev = seen.rev, stale = false, held = null;
  if (put.length || remove.length) {
    const answer = await remote.commit({ rev:seen.rev, put, remove });
    if (answer.stale) stale = true;
    else { rev = answer.rev; held = answer.held; for (const [path, step] of afterCommit) if (!held?.has(path)) await step(); }
  }
  // After our own commit Cloud holds what we hold for those paths; a refused commit leaves Cloud as we saw it.
  const listing = { ...theirs };
  if (!stale) {
    for (const file of put) if (!held?.has(file.path)) listing[file.path] = { sha256:file.sha256, size:file.size, modified:file.modified };
    for (const path of remove) delete listing[path];
  }
  Object.assign(state, { rev:stale ? state.rev : rev, base, remote:stale ? state.remote : listing, conflicts:(state.conflicts || []).filter(entry => mine[entry.path]?.skipped) });
  return { ...did, stale, rev:state.rev, ...(existingRemote ? { joinedExisting:true } : {}) };
}

// A choice between two versions an older PenEcho kept. keep: "mine" | "theirs" | "both". The next round then sends or takes what is
// needed. A round settles any still waiting as "mine" itself; the route that lets the person choose stays for a page not yet reloaded.
async function settle({ local, state, path, keep }) {
  const entry = (state.conflicts || []).find(c => c.path === path);
  if (!entry) return null;
  let kept = null;
  if (keep === "theirs") {
    await local.write(path, await local.read(entry.otherPath));   // ours goes to .history/
    await local.trash(entry.otherPath);
  } else if (keep === "both") {
    kept = await local.free(path);
    await local.rename(entry.otherPath, kept);                    // Cloud's becomes a file of its own and is synced as a new one
  } else {
    await local.trash(entry.otherPath);
  }
  // Cloud's version is now the copy both sides started from: "mine" and "both" are sent as our change to it, "theirs" already equals it.
  state.base = { ...state.base, [path]:entry.theirs };
  state.conflicts = state.conflicts.filter(c => c !== entry);
  return { path, keep, kept };
}

module.exports = { syncOnce, settle, mergeBytes, keepable, fileReadFailure, KEEP_TEXT_BYTES };
