"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { syncOnce, settle:settleCore, mergeBytes, keepable } = require("./sync/engine.js");
const { aside } = require("./sync/plan.js");
const L = require("./layout.js");

// The disk and Cloud around the sync core (sync/engine.js, sync/plan.js, sync/merge.js), for one project kept in PenEcho Cloud.
// The core decides; this gives it three things (ARCHITECTURE.md, A):
//   local   the project's documents folder: hashes (cached by cloud-share.js), safe writes (a replaced file goes to .history/ first),
//           .trash/, a free name
//   remote  Cloud's device-sync routes: the manifest (?since), blobs, and one commit that names the revision it was planned against
//   state   what both sides agreed on, in PenEcho's state folder (never the user's): a JSON file and a folder of kept texts per project
// and a merge that adds Canvases (by their parts) to what the core merges, and keeps two Works made on two sides with the same detail
// file apart: Cloud's is renumbered, its file kept under the new name, and the link in Cloud's piece of the line follows it.

const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const stamp = (at = new Date()) => at.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");

// ---------- A Canvas by its parts ----------
// Each Widget, tile and picture, and the rest of the Canvas. A part changed on one side is taken from that side; one changed on both
// sides alike is one; one changed differently on each side cannot be decided (null), unless this computer goes first (below).
const partKey = asset => asset?.kind === "widget" ? `w:${asset.metadata?.widgetId}` : asset?.kind === "tile" ? `t:${asset.metadata?.tileKey}` : asset?.kind === "preview" ? "preview" : `${asset?.kind}:${asset?.metadata?.resourceId || asset?.metadata?.id || sha(JSON.stringify(asset))}`;
// `localFirst` (PE-578): a part changed differently on each side is taken from this computer, as is the rest of the Canvas.
function mergeCanvas(base, mine, theirs, { localFirst = false } = {}) {
  let O, A, B;
  try { [O, A, B] = [base, mine, theirs].map(text => JSON.parse(text)); } catch { return null; }
  if (![O, A, B].every(b => b && Array.isArray(b.assets) && b.manifest)) return null;
  const parts = bundle => new Map(bundle.assets.map(asset => [partKey(asset), asset]));
  const po = parts(O), pa = parts(A), pb = parts(B), assets = [], chose = new Map();
  for (const key of new Set([...pa.keys(), ...pb.keys(), ...po.keys()])) {
    if (key === "preview") continue;
    const o = JSON.stringify(po.get(key) ?? null), a = JSON.stringify(pa.get(key) ?? null), b = JSON.stringify(pb.get(key) ?? null);
    let side;
    if (a === o) side = "theirs"; else if (b === o || a === b || localFirst) side = "mine"; else return null;
    const asset = side === "mine" ? pa.get(key) : pb.get(key);
    chose.set(key, side);
    if (asset) assets.push(asset);
  }
  const rest = bundle => { const { savedAt, view, extensions, ...manifest } = bundle.manifest; const lines = { ...(extensions?.["penecho.lines"] || {}) }; delete lines.sources; delete lines.rev; delete lines.behind; return JSON.stringify({ manifest, extensions:{ ...(extensions || {}), "penecho.lines":lines }, name:bundle.name }); };
  const [ro, ra, rb] = [O, A, B].map(rest);
  if (ra !== ro && rb !== ro && ra !== rb && !localFirst) return null;
  const out = JSON.parse(JSON.stringify(ra === ro ? B : A));
  const preview = pa.get("preview") || pb.get("preview");
  out.assets = preview ? [...assets, preview] : assets;
  // Which source each agent-drawn Widget holds follows the side its Widget came from.
  const sources = {};
  for (const [key, side] of chose) {
    if (!key.startsWith("w:")) continue;
    const id = key.slice(2), from = (side === "mine" ? A : B).manifest.extensions?.["penecho.lines"]?.sources?.[id];
    if (typeof from === "string") sources[id] = from;
  }
  out.manifest.extensions = { ...(out.manifest.extensions || {}), "penecho.lines":{ ...(out.manifest.extensions?.["penecho.lines"] || {}), sources } };
  out.updatedAt = Math.max(Number(A.updatedAt) || 0, Number(B.updatedAt) || 0);
  return JSON.stringify(out);
}

// ---------- Two Works with one detail file ----------
// Both sides added "Work 1" to a line, each with topics/<line>/work-1.md. Before the line is merged, Cloud's new Works that clash with
// ours get the next free numbers, in its headings and its links; the round then keeps Cloud's detail file under that new name.
const WORK_HEAD = /^(## \[[ xX]\] Work )(\d+)\b/gm;
const workNumbers = text => new Set([...String(text).matchAll(WORK_HEAD)].map(m => Number(m[2])));
function renumberTheirs(slug, base, mine, theirs) {
  const b = workNumbers(base), m = workNumbers(mine), t = workNumbers(theirs), moves = new Map();
  let next = Math.max(0, ...m, ...t) + 1;
  for (const n of [...t].sort((x, y) => x - y)) if (!b.has(n) && m.has(n)) moves.set(n, next++);
  if (!moves.size) return { text:theirs, moves };
  const link = new RegExp(`\\]\\(${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/work-(\\d+)\\.md\\)`, "g");
  const text = String(theirs).replace(WORK_HEAD, (all, head, n) => moves.has(Number(n)) ? `${head}${moves.get(Number(n))}` : all).replace(link, (all, n) => moves.has(Number(n)) ? `](${slug}/work-${moves.get(Number(n))}.md)` : all);
  return { text, moves };
}

// More Lines than this deleted in Cloud in one round, and over half of them, is taken for a copy gone wrong, not a choice (deletions below).
const MOST_LINES = 3;

const cannotSync = () => Object.assign(new Error("PenEcho Cloud did not send this project's list of files, so nothing on this computer was changed. Keeping a project in step both ways needs the newer PenEcho Cloud."), { code:"cloud_cannot_sync", status:502 });

function createCloudSync({ store, directory, request, download, upload, publishFirst, localFiles, holdFile, summarize = () => null, onChanged = () => {}, logger = null, bulk = { files:100, bytes:8 * 1024 * 1024 } }) {
  const stateFile = project => path.join(directory, "cloud-sync", `${project.id}.json`);
  const textDir = project => path.join(directory, "cloud-sync", project.id);
  const stateMetadata = new Map();
  const statStamp = stat => ({ dev:stat.dev, ino:stat.ino, ctimeMs:stat.ctimeMs, mtimeMs:stat.mtimeMs, size:stat.size });
  const sameStat = (a, b) => Boolean(a && b && a.dev === b.dev && a.ino === b.ino && a.ctimeMs === b.ctimeMs && a.mtimeMs === b.mtimeMs && a.size === b.size);
  // ---------- state ----------
  function loadState(project) {
    let kept = {};
    try { kept = JSON.parse(fs.readFileSync(stateFile(project), "utf8")) || {}; } catch { /* First round. */ }
    const state = { rev:Number(kept.rev) || 0, base:kept.base || {}, remote:kept.remote || {}, conflicts:Array.isArray(kept.conflicts) ? kept.conflicts : [], exists:Boolean(kept.exists) };
    state.text = async hash => { try { return fs.readFileSync(path.join(textDir(project), hash)); } catch { return null; } };
    state.keep = async (hash, bytes) => { fs.mkdirSync(textDir(project), { recursive:true }); const to = path.join(textDir(project), hash); if (!fs.existsSync(to)) fs.writeFileSync(to, bytes); };
    return state;
  }
  function saveState(project, state) {
    const file = stateFile(project);
    fs.mkdirSync(path.dirname(file), { recursive:true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ rev:state.rev, base:state.base, remote:state.remote, conflicts:state.conflicts, exists:state.exists }));
    fs.renameSync(temporary, file);
    // Invalidate metadata cache instead of seeding an unverified post-rename stat; the next metadata() call parses once and caches
    // only after proving the on-disk generation stayed unchanged across the read.
    stateMetadata.delete(project.id);
    // Kept texts only for what is still agreed on or waiting for a choice.
    const keep = new Set([...Object.values(state.base), ...state.conflicts.map(c => c.theirs)]);
    let names = []; try { names = fs.readdirSync(textDir(project)); } catch { return; }
    for (const name of names) if (!keep.has(name)) fs.rmSync(path.join(textDir(project), name), { force:true });
  }
  function metadata(project) {
    const empty = { rev:0, conflicts:[], knownRemote:null };
    const file = stateFile(project);
    let before;
    try { before = fs.statSync(file, { throwIfNoEntry:false }); }
    catch { stateMetadata.delete(project.id); return empty; }
    if (!before) { stateMetadata.delete(project.id); return empty; }
    const cached = stateMetadata.get(project.id);
    if (sameStat(cached, before)) return cached;
    let kept;
    try { kept = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch { stateMetadata.delete(project.id); return empty; }
    if (!kept || typeof kept !== "object" || Array.isArray(kept)) { stateMetadata.delete(project.id); return empty; }
    const known = new Set();
    for (const rel of Object.keys(kept.base || {})) known.add(L.fromCloud(rel));
    for (const rel of Object.keys(kept.remote || {})) known.add(L.fromCloud(rel));
    const fresh = { rev:Number(kept.rev) || 0, conflicts:Array.isArray(kept.conflicts) ? kept.conflicts : [], knownRemote:known.size ? known : null };
    let after;
    try { after = fs.statSync(file, { throwIfNoEntry:false }); }
    catch { stateMetadata.delete(project.id); return fresh; }
    if (sameStat(before, after)) stateMetadata.set(project.id, { ...statStamp(after), ...fresh });
    else stateMetadata.delete(project.id);
    return fresh;
  }
  // ---------- local ----------
  function local(project, flags = null, access = null) {
    // The core works with Cloud's names (layout 1); each is turned into today's name here (layout.js).
    const at = rel => store.resolve(project, L.fromCloud(rel), { forWrite:true });
    const rehomedLines = new Map();
    const slugTaken = (candidate, remoteMap, localMap) => {
      if (!candidate || L.SHARED_FILES.has(candidate) || store.isDeleted?.(project, candidate)) return true;
      for (const rel of [
        L.linePath(candidate), L.worksDir(candidate), L.filesDir(candidate),
        `${L.ARCHIVE}/${L.linePath(candidate)}`, `${L.ARCHIVE}/${L.worksDir(candidate)}`, `${L.ARCHIVE}/${L.filesDir(candidate)}`,
      ]) {
        if (fs.existsSync(path.join(project.docsPath, rel))) return true;
      }
      const lineCloud = `${L.TOPICS}/${candidate}.md`, worksPrefix = `${L.TOPICS}/${candidate}/`, filesPrefix = `${L.FILES}/${candidate}/`;
      for (const map of [remoteMap, localMap]) {
        if (!map) continue;
        if (map[lineCloud]) return true;
        for (const k of Object.keys(map)) if (k.startsWith(worksPrefix) || k.startsWith(filesPrefix)) return true;
      }
      for (const used of rehomedLines.values()) if (used === candidate) return true;
      return false;
    };
    const moveAside = (rel, folder) => {
      const from = at(rel);
      if (!fs.existsSync(from)) return;
      const to = at(`${folder}/sync-${stamp()}/${rel}`);
      fs.mkdirSync(path.dirname(to), { recursive:true });
      fs.renameSync(from, to);
      store.onWrite?.(project);
      if (flags) flags.localMutated = true;
    };
    return {
      async list(context = null) {
        let knownRemote = null;
        if (context) {
          knownRemote = new Set();
          for (const rel of Object.keys(context.remote || {})) knownRemote.add(L.fromCloud(rel));
          for (const rel of Object.keys(context.base || {})) knownRemote.add(L.fromCloud(rel));
        }
        return Object.fromEntries(localFiles(project, { access, knownRemote, existingRemote:Boolean(context?.existingRemote) }).filter(f => !aside(f.path)).map(f => [f.path, f.out ? { out:true } : { sha256:f.sha256, size:f.size, modified:f.modified, ...(f.skipped ? { skipped:f.skipped } : {}) }]));
      },
      async read(rel) { return fs.readFileSync(store.resolve(project, L.fromCloud(rel))); },
      async write(rel, bytes) {
        const file = at(rel);
        if (fs.existsSync(file)) { const old = fs.readFileSync(file); if (old.equals(bytes)) return; const to = at(`.history/sync-${stamp()}/${rel}`); fs.mkdirSync(path.dirname(to), { recursive:true }); fs.writeFileSync(to, old); }
        fs.mkdirSync(path.dirname(file), { recursive:true });
        store.writeBytes(project, L.fromCloud(rel), bytes);
        if (flags) flags.localMutated = true;
      },
      async trash(rel) { moveAside(rel, ".trash"); },
      async rename(from, to) { fs.mkdirSync(path.dirname(at(to)), { recursive:true }); fs.renameSync(at(from), at(to)); store.onWrite?.(project); if (flags) flags.localMutated = true; },
      async free(rel) {
        const dot = rel.lastIndexOf("."), slash = rel.lastIndexOf("/"), stem = dot > slash + 1 ? rel.slice(0, dot) : rel, ext = dot > slash + 1 ? rel.slice(dot) : "";
        for (let n = 2; ; n++) { const candidate = `${stem}-${n}${ext}`; if (!fs.existsSync(at(candidate))) return candidate; }
      },
      async rehome(rel, bytes, { remote:remoteMap = {}, local:localMap = {} } = {}) {
        const today = L.fromCloud(rel), slug = !rel.startsWith(".knowledge/") ? L.ownerOf(today) : "";
        if (slug && !L.SHARED_FILES.has(slug)) {
          let nextSlug = rehomedLines.get(slug);
          if (!nextSlug) {
            let n = 2;
            while (slugTaken(`${slug}-${n}`, remoteMap, localMap)) n++;
            nextSlug = `${slug}-${n}`;
            rehomedLines.set(slug, nextSlug);
          }
          const nextToday = today === L.linePath(slug)
            ? L.linePath(nextSlug)
            : today.startsWith(`${L.WORKS}/${slug}/`)
              ? `${L.WORKS}/${nextSlug}/${today.slice(L.WORKS.length + slug.length + 2)}`
              : today.startsWith(`${L.FILES}/${slug}/`)
                ? `${L.FILES}/${nextSlug}/${today.slice(L.FILES.length + slug.length + 2)}`
                : today;
          let nextBytes = bytes;
          if (/\.md$/i.test(nextToday)) {
            const rewritten = bytes.toString("utf8")
              .split(`files/${slug}/`).join(`files/${nextSlug}/`)
              .split(`works/${slug}/`).join(`works/${nextSlug}/`)
              .split(`lines/${slug}.md`).join(`lines/${nextSlug}.md`)
              .split(`../${slug}.md`).join(`../${nextSlug}.md`)
              .split(`](${slug}/`).join(`](${nextSlug}/`);
            nextBytes = Buffer.from(rewritten, "utf8");
          }
          return { path:L.toCloud(nextToday), bytes:nextBytes };
        }
        const dot = rel.lastIndexOf("."), slash = rel.lastIndexOf("/"), stem = dot > slash + 1 ? rel.slice(0, dot) : rel, ext = dot > slash + 1 ? rel.slice(dot) : "";
        for (let n = 2; ; n++) {
          const candidate = `${stem}-${n}${ext}`;
          if (!fs.existsSync(at(candidate)) && !remoteMap[candidate] && !localMap[candidate]) return { path:candidate, bytes };
        }
      },
    };
  }
  // ---------- remote ----------
  // Cloud's answer is believed only in the shape that syncs both ways: a revision, and the whole list of files (or "nothing changed").
  // penecho.ai before the sync routes answered { project } alone; reading that as "Cloud has no files" put a whole project aside (PE-303).
  const listed = answer => Number.isSafeInteger(Number(answer?.rev)) && answer.rev !== null && (answer.changed === false || Array.isArray(answer.files));
  function remote(project, state, flags, access) {
    const call = (suffix, options) => request(project, suffix, options, access);
    return {
      async manifest({ since }) {
        let answer = await call(since ? `?since=${since}` : "");
        if (answer?.project === null) {
          // Removed in Cloud after this computer had it there: stop, and touch nothing here (an empty list would trash every file).
          if (state.rev || Object.keys(state.base).length) throw Object.assign(new Error("This project is no longer in PenEcho Cloud."), { code:"project_removed" });
          state.exists = false; return { rev:0, changed:true, files:{} };
        }
        if (!listed(answer)) throw cannotSync();
        state.exists = true;
        // A revision lower than the one agreed on: Cloud's copy is not the one this computer agreed with (removed and made again). Its
        // whole list is read, and the round treats nothing as agreed, so nothing is put aside here or removed there (engine.js).
        let remade = false;
        if (since && Number(answer.rev) < Number(since)) {
          remade = true;
          answer = await call("");
          if (!listed(answer) || answer.changed === false) throw cannotSync();
        }
        if (answer.changed === false) return { rev:Number(answer.rev), changed:false };
        const files = Object.fromEntries(answer.files.map(f => [f.path, { sha256:f.sha256, size:f.size, modified:f.modified }]));
        return { rev:Number(answer.rev), changed:true, files, running:answer.running || [], ...(remade ? { remade:true } : {}) };
      },
      async publishFirst() {
        await publishFirst(project, async (made, files, read) => {
          if (!Number.isSafeInteger(made?.rev) || made.rev < 1) throw cannotSync();
          state.rev = made.rev;
          state.exists = true;
          state.base = {};
          state.remote = {};
          state.conflicts = [];
          for (const file of files) {
            state.base[file.path] = file.sha256;
            state.remote[file.path] = { sha256:file.sha256, size:file.size, modified:file.modified };
            if (keepable(file.path, file.size)) await state.keep(file.sha256, read(file));
          }
        }, access);
        return Object.keys(state.base).length;
      },
      download:hash => download(project, hash, access),
      async commit({ rev, put, remove }) {
        // A commit that changes a line, Work detail, or synced file/Canvas carries the project's summary (its lines, steps, and last Work outputs), which Cloud's list and Home read (E2E L3).
        let summary = null;
        if ([...put.map(f => f.path), ...remove].some(p => /^(?:topics\/(?:[^/]+\/)?[^/]+\.md|files\/)/.test(p))) { try { summary = summarize(project, flags?.localMutated ? { fresh:true } : undefined) || null; } catch { /* The files still go. */ } }
        const held = new Set();
        const send = async files => {
          const rejected = await upload(project, files, access);
          for (const file of put) if (rejected?.has(file.sha256)) {
            held.add(file.path);
            holdFile?.(project, file, rejected.get(file.sha256));
          }
        };
        const commit = async () => {
          const accepted = put.filter(file => !held.has(file.path));
          if (!accepted.length && !remove.length) return { rev, held };
          const body = { rev, put:accepted.map(({ path:p, sha256, size, modified }) => ({ path:p, sha256, size, modified })), remove, ...(summary ? { summary } : {}) };
          try { const answer = await call("/commit", { method:"POST", body }); return { rev:Number(answer.rev), held }; }
          catch (error) { if (error.code === "stale" || error.status === 409 && /stale/.test(error.code || "")) return { stale:true }; throw error; }
        };
        const files = put.filter(f => f.bytes);
        // Many files (a first round, or one after a try that was cut off): Cloud is asked first, and only what it lacks goes up, so a
        // new try carries on where the last one stopped instead of sending every file again (PE-574). Cloud answers a commit naming
        // files it lacks with line_project_missing_files and writes nothing.
        if (files.length > bulk.files || files.reduce((sum, f) => sum + f.bytes.length, 0) > bulk.bytes) {
          try { return await commit(); }
          catch (error) {
            if (error.code !== "line_project_missing_files") throw error;
            // Each missing file once, however many paths hold it.
            const missing = new Set(error.details?.missing || []);
            await send(files.filter(f => missing.delete(f.sha256)));
            return commit();
          }
        }
        // A few files: the bytes go up first; then one commit, all of it or none.
        await send(files);
        return commit();
      },
    };
  }
  // ---------- merge ----------
  function merger(project, localSide) {
    const renamed = new Map(); // topics/<line>/work-N.md (Cloud's) → topics/<line>/work-M.md
    return async (rel, base, mine, theirs, options) => {
      const line = /^topics\/([^/]+)\.md$/.exec(rel);
      if (line) {
        if (!base) return null;
        const { text, moves } = renumberTheirs(line[1], base.toString("utf8"), mine.toString("utf8"), theirs.toString("utf8"));
        const joined = mergeBytes(rel, base, mine, Buffer.from(text), options);
        if (joined) for (const [from, to] of moves) renamed.set(`topics/${line[1]}/work-${from}.md`, `topics/${line[1]}/work-${to}.md`);
        return joined;
      }
      // Cloud's detail file of a Work that was renumbered: kept under its new name, and ours stays in place.
      if (renamed.has(rel)) { await localSide.write(renamed.get(rel), theirs); return mine; }
      if (/\.penecho\.json$/.test(rel)) { const joined = base ? mergeCanvas(base.toString("utf8"), mine.toString("utf8"), theirs.toString("utf8"), options) : null; return joined === null ? null : Buffer.from(joined); }
      return mergeBytes(rel, base, mine, theirs, options);
    };
  }
  // ---------- deleted Lines ----------
  // A Line deleted on either side is its line file, its Works and its files: often more than the few files a round's brakes let go
  // (engine.js), which brought the Line back. These are the deletions the person made, which the brakes do not hold back.
  function deletions(project, flags = null) {
    const lineOf = rel => { const slug = L.ownerOf(L.fromCloud(rel)); return slug && !L.SHARED_FILES.has(slug) ? slug : ""; };
    return {
      // Deleted here: the Line is in Deleted (store.js deleteTopic), in its own folder of .trash/ by today's names. Restored, it is
      // sent to Cloud again. Once the deletion has reached Cloud (the line file is no longer agreed), what Cloud has of it is the Line
      // restored or made again elsewhere, and it comes back here (cameBack below).
      here:(rel, agreed) => {
        const slug = lineOf(rel), record = store.deleted[`${project.id}:${slug}`];
        return record?.phase === "completed" && record.bundle && agreed[`${L.TOPICS}/${slug}.md`] ? `${record.trash}/${L.fromCloud(rel)}` : "";
      },
      // Deleted on penecho.ai: Cloud no longer has the line file, and nothing of that Line was changed here. It goes to Deleted, as one
      // deleted here does, so it can be restored for a week. Cloud's list losing most of the Lines at once is not taken for this.
      async there(paths, mine) {
        const away = new Set(paths), files = new Map();
        for (const rel of Object.keys(mine)) { const slug = lineOf(rel); if (slug) files.set(slug, [...(files.get(slug) || []), rel]); }
        const isLine = slug => { try { return Boolean(store.parsed(project, L.linePath(slug))?.isLine); } catch { return false; } };
        const lines = [...files.keys()].filter(slug => mine[`${L.TOPICS}/${slug}.md`] && isLine(slug));
        const whole = lines.filter(slug => files.get(slug).every(rel => away.has(rel)));
        if (whole.length > MOST_LINES && whole.length * 2 > lines.length) return [];
        const done = [];
        for (const slug of whole) {
          if (store.isDeleted(project, slug)) continue;
          try { store.deleteTopic(project, slug, { baseHash:store.readText(project, L.linePath(slug)).hash }); }
          catch (error) { logger?.({ type:"project-lines-cloud", event:"line-delete-failed", project:project.id, line:slug, message:error.message }); continue; }
          done.push(...paths.filter(rel => lineOf(rel) === slug));
        }
        if (flags && done.length) flags.localMutated = true;
        return done;
      },
    };
  }
  // A Line deleted here that a round brought back from Cloud is here again: it leaves Deleted, which would hide it, and could not be
  // restored over it. What was put aside stays in .trash/.
  function cameBack(project) {
    let changed = false;
    for (const [key, record] of Object.entries(store.deleted)) {
      if (record.projectId !== project.id || record.phase !== "completed" || !store.exists(project, L.linePath(record.slug))) continue;
      delete store.deleted[key]; changed = true;
    }
    if (changed) store.saveDeleted();
  }
  // ---------- rounds ----------
  const running = new Map(), dirty = new Map();
  async function round(project, access) {
    access?.check();
    const state = loadState(project), flags = { localMutated:false }, localSide = local(project, flags, access);
    const before = { base:{ ...state.base } };
    let did;
    try { did = await syncOnce({ local:localSide, remote:remote(project, state, flags, access), state, merge:merger(project, localSide), deleted:deletions(project, flags), hold:(file, reason) => holdFile?.(project, file, reason) }); }
    catch (error) {
      if (error.code === "project_removed") return { removed:true };
      if (error.status === 404 && error.code === "not_found" && !state.exists && !state.rev) throw Object.assign(cannotSync(), { cause:error });
      throw error;
    }
    access?.check();
    saveState(project, state);
    if (did.pulled) cameBack(project);
    // Local first (PE-578): a file that could not be merged went to Cloud as it is here; Cloud's version is in .history/.
    for (const won of did.localWon) logger?.({ type:"project-lines-cloud", event:"sync-local-first", project:project.id, path:L.fromCloud(won.path), kept:L.fromCloud(won.keptAt) });
    const changed = Boolean(did.pulled || did.merged || did.trashed || did.settled || did.localWon.length);
    if (changed) onChanged(project);
    return { ...did, changed, firstAgreed:!Object.keys(before.base).length };
  }
  function start(project, access, follow = null) {
    const job = round(project, access);
    running.set(project.id, job);
    job.catch(error => logger?.({ type:"project-lines-cloud", event:"sync-failed", project:project.id, code:error.code || "", status:error.status || 0, message:error.message })).finally(() => {
      if (running.get(project.id) !== job) return;
      running.delete(project.id);
      const next = dirty.get(project.id);
      if (next) { dirty.delete(project.id); start(next.project, next.access, next); }
    });
    if (follow) job.then(follow.resolve, follow.reject);
    return follow ? follow.promise : job;
  }
  function run(project, access) {
    if (!running.has(project.id)) return start(project, access);
    // Slow ticks coalesce into one dirty follow-up, not an ever-growing chain of back-to-back rounds.
    const queued = dirty.get(project.id);
    if (queued) {
      try {
        queued.access?.check();
        queued.project = project;
        if (access?.syncWindow) queued.access = access;
        return queued.promise;
      } catch (error) {
        dirty.delete(project.id);
        queued.reject(error);
      }
    }
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    dirty.set(project.id, { project, access, promise, resolve, reject });
    return promise;
  }
  // A file kept twice is shown by today's name (layout.js); Cloud's name stays in the state.
  const view = c => ({ path:L.fromCloud(c.path), otherPath:c.otherPath ? L.fromCloud(c.otherPath) : c.otherPath, ...(/^(?:topics|files)\/([^/.]+)/.exec(c.path) ? { line:/^(?:topics|files)\/([^/.]+)/.exec(c.path)[1] } : {}), at:Date.parse(c.at) || c.at });
  // The person chose between two versions: "mine", "theirs" or "both" (the core's settle).
  async function settle(project, { path:rel, keep } = {}) {
    if (!["mine", "theirs", "both"].includes(keep)) { const error = new Error('keep is "mine", "theirs" or "both".'); error.status = 400; error.code = "BAD_KEEP"; throw error; }
    const state = loadState(project);
    // The page names the file as it is here; the state keeps Cloud's name for it.
    // A Topic's today's name (topics/x.md) is also how Cloud names a Line, so a choice waiting under the name as given wins.
    const named = String(rel || ""), cloudRel = state.conflicts.some(c => c.path === named) ? named : L.toCloud(named) || named;
    const done = await settleCore({ local:local(project), state, path:cloudRel, keep });
    if (!done) { const error = new Error("There is no choice waiting for that file."); error.status = 404; error.code = "NOT_FOUND"; throw error; }
    saveState(project, state);
    onChanged(project);
    return { ok:true, ...(done.kept ? { kept:L.fromCloud(done.kept) } : {}), conflicts:state.conflicts.map(view) };
  }
  // A project just brought down from Cloud: what both have is agreed from the start.
  // `later`: files of Cloud's copy not written here yet (the knowledge, cloud-share.js copyToComputer): Cloud has them and nothing is
  // agreed, so the next round brings them down.
  async function adopt(project, { rev, files, later = [] }) {
    const state = loadState(project);
    state.rev = Number(rev) || 0; state.exists = true; state.conflicts = [];
    state.base = {}; state.remote = {};
    for (const f of later) state.remote[f.path] = { sha256:f.sha256, size:f.size, modified:f.modified };
    for (const f of files) {
      state.base[f.path] = f.sha256; state.remote[f.path] = { sha256:f.sha256, size:f.size, modified:f.modified };
      try { const file = store.resolve(project, L.fromCloud(f.path)); if (fs.statSync(file).size <= 16 * 1024 * 1024) await state.keep(f.sha256, fs.readFileSync(file)); } catch { /* Not written. */ }
    }
    saveState(project, state);
  }
  function forget(project) {
    stateMetadata.delete(project.id);
    fs.rmSync(stateFile(project), { force:true });
    fs.rmSync(textDir(project), { recursive:true, force:true });
  }
  // `rev`: the revision both sides last agreed on, which the computer's round names (R4, computer.js).
  return { run, pending:project => dirty.get(project.id)?.promise || running.get(project.id), settle, adopt, rev:project => metadata(project).rev, knownRemote:project => metadata(project).knownRemote, conflicts:project => metadata(project).conflicts.map(view), forget };
}

module.exports = { createCloudSync, mergeCanvas, renumberTheirs };
