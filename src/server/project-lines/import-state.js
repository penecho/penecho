"use strict";
// Coordination belongs to the docs folder, not an app's private registry. Nothing
// here runs on a page read; unchanged transcripts never enter the shared path.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const L = require("./layout.js");
const instances = new Set(), counters = new Map();
const hash = value => crypto.createHash("sha256").update(String(value)).digest("hex");
const rootOf = project => path.join(project.docsPath, ".penecho", "imports");
function read(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { if (e.code === "ENOENT") return null; throw e; } }
function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive:true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try { fs.writeFileSync(tmp, JSON.stringify(value)); fs.renameSync(tmp, file); }
  finally { try { fs.unlinkSync(tmp); } catch {} }
}
function alive(owner) {
  if (!owner || owner.host !== os.hostname()) return true;
  if (!Number.isInteger(owner.pid) || owner.pid <= 0) return false;
  if (owner.pid === process.pid && owner.instance) return instances.has(owner.instance);
  try { process.kill(owner.pid, 0); return true; } catch (e) { return e.code !== "ESRCH"; }
}
function lock(file, instance = "", depth = 0) {
  if (depth > 8) return null;
  fs.mkdirSync(path.dirname(file), { recursive:true });
  const owner = { pid:process.pid, host:os.hostname(), instance, token:crypto.randomUUID(), at:Date.now() };
  const take = () => {
    try { fs.writeFileSync(file, JSON.stringify(owner), { flag:"wx" }); }
    catch (e) { if (e.code === "EEXIST") return null; throw e; }
    return () => { const current = read(file); if (current?.token === owner.token) fs.unlinkSync(file); };
  };
  let release = take();
  if (release) return release;
  // Serialize dead-owner recovery. A live owner is never evicted by a timeout.
  const releaseReaper = lock(`${file}.reap`, instance, depth + 1);
  if (!releaseReaper) return null;
  try {
    let current;
    try { current = read(file); } catch (e) {
      if (e instanceof SyntaxError && Date.now() - fs.statSync(file).mtimeMs > 30000) current = { pid:-1, host:os.hostname() };
      else return null;
    }
    if (current && !alive(current)) fs.unlinkSync(file);
    release = take();
  } finally { releaseReaper(); }
  return release;
}
function claimSlug(project, base, available, owner = "") {
  const dir = path.join(rootOf(project), "names"); fs.mkdirSync(dir, { recursive:true });
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    if (!available(slug)) continue;
    try { fs.writeFileSync(path.join(dir, hash(slug)), owner || slug, { flag:"wx" }); return slug; }
    catch (e) { if (e.code !== "EEXIST") throw e; }
  }
}
function highest(project) {
  let max = Math.max(0, Number(project.seq || 1) - 1);
  // Once per process/project, and only Line headers. Never walk Works or files.
  for (const dir of [L.LINES, `${L.ARCHIVE}/${L.LINES}`, "topics"]) {
    let names; try { names = fs.readdirSync(path.join(project.docsPath, dir)); } catch { continue; }
    for (const name of names) {
      if (!name.endsWith(".md")) continue;
      let fd;
      try {
        fd = fs.openSync(path.join(project.docsPath, dir, name), "r");
        const b = Buffer.alloc(4096), size = fs.readSync(fd, b, 0, b.length, 0);
        const id = /^id:\s*(.+)$/m.exec(b.subarray(0, size).toString())?.[1];
        if (id?.startsWith(`${project.prefix}-`) && /^\d+$/.test(id.slice(project.prefix.length + 1))) max = Math.max(max, Number(id.slice(project.prefix.length + 1)));
      } catch (e) { if (e.code !== "ENOENT") throw e; } finally { if (fd !== undefined) fs.closeSync(fd); }
    }
  }
  return max;
}
// When each folder of Lines last had a file added or taken away. A Line that came with its id from elsewhere (PenEcho Cloud,
// another computer's sync, a file put there by hand) was never numbered here: two Lines made the same day were both PE-911.
// The headers are read again only when one of these folders changed, so a new id is never one a Line already has (PE-927).
const lineFolders = new Map();
function foldersMark(project) {
  return [L.LINES, `${L.ARCHIVE}/${L.LINES}`, "topics"].map(dir => { try { return fs.statSync(path.join(project.docsPath, dir)).mtimeMs; } catch { return 0; } }).join(":");
}
function nextId(project) {
  const dir = path.join(rootOf(project), "numbers", hash(project.prefix)), file = path.join(dir, "next.json");
  fs.mkdirSync(dir, { recursive:true });
  const key = fs.realpathSync(dir), mark = foldersMark(project);
  if (!counters.has(key) || lineFolders.get(key) !== mark) { counters.set(key, Math.max(counters.get(key) || 0, highest(project) + 1)); lineFolders.set(key, mark); }
  let n = Math.max(counters.get(key), Number(project.seq) || 1, Number(read(file)?.next) || 1);
  // Exclusive reservation is the authority. The hint may lag or race safely.
  for (;;) {
    try { fs.writeFileSync(path.join(dir, String(n)), "", { flag:"wx" }); break; }
    catch (e) { if (e.code !== "EEXIST") throw e; n++; }
  }
  counters.set(key, n + 1); project.seq = n + 1; atomic(file, { next:n + 1 });
  return `${project.prefix}-${n}`;
}
class ImportState {
  constructor(service) { this.service = service; this.instance = crypto.randomUUID(); instances.add(this.instance); this.active = new Map(); this.pendingBinds = new Map(); this.pendingEnds = new Map(); this.closed = false; }
  clearPending(map, file) { const timer = map.get(file); if (timer) { clearTimeout(timer); map.delete(file); } }
  file(project, rec) { return path.join(rootOf(project), "sessions", `${hash(`${rec.agent}:${rec.id}`)}.json`); }
  snapshot(project, rec) {
    const copy = JSON.parse(JSON.stringify(rec));
    const owner = this.service.store.projects.find(p => p.id === copy.projectId);
    const reader = this.service.store.projects.find(p => p.id === copy.readBy);
    delete copy.projectId; delete copy.readBy; delete copy.here; delete copy.importEvent; delete copy.resync; delete copy.previousEvent;
    return { version:1, writer:this.instance, owner:owner?.docsPath || project.docsPath, reader:reader?.docsPath || "", record:copy };
  }
  restore(project, rec, state) {
    if (!state?.record) return;
    const projects = this.service.store.projects;
    const find = folder => projects.find(p => p.docsPath === folder || (() => { try { return fs.realpathSync(p.docsPath) === fs.realpathSync(folder); } catch { return false; } })());
    const owner = find(state.owner) || project, reader = state.reader && find(state.reader);
    for (const key of Object.keys(rec)) delete rec[key];
    Object.assign(rec, state.record, { projectId:owner.id });
    if (reader && reader.id !== owner.id) rec.readBy = reader.id;
  }
  save(project, rec) { const state = this.snapshot(project, rec); atomic(this.file(project, rec), state); return state; }
  // Import progress comes from the shared file. A restarted managed Work can also
  // have newer evidence of messages already delivered directly to its activity log.
  recoveredState(local, shared) {
    const previous = local.record, saved = shared?.record, owner = saved?.runOwner;
    if (!previous.startedHere || !previous.interrupted || !previous.stepId || !saved?.startedHere ||
        shared.owner !== local.owner || saved.slug !== previous.slug || saved.stepId !== previous.stepId ||
        saved.agent !== previous.agent || saved.id !== previous.id || (owner && alive(owner))) return shared;
    const record = { ...saved }, former = previous.runOwner;
    if (former?.instance && shared.writer === former.instance && owner?.instance === former.instance &&
        former.pid === owner.pid && former.host === owner.host) {
      for (const key of ["interrupted", "active", "turnOpen", "asking", "now"]) record[key] = previous[key];
      delete record.runOwner;
    }
    const seen = previous.piCheckpoint, cursor = saved.piCheckpoint;
    if (seen && (!cursor || seen.at > cursor.at)) record.piCheckpoint = seen;
    else if (seen && seen.at === cursor?.at) record.piCheckpoint = { ...cursor, hashes:[...new Set([...(cursor.hashes || []), ...(seen.hashes || [])])] };
    return { ...shared, record };
  }
  async run(project, rec, fn) {
    if (!rec.agent || !rec.id || !project.docsPath) return fn();
    const file = this.file(project, rec);
    if (this.active.has(file)) return false; // Another task in this process owns it.
    const release = lock(`${file}.lock`, this.instance);
    if (!release) return false; // Try on the next scan; never stall another session.
    const before = this.snapshot(project, rec), owned = { projectId:rec.projectId, readBy:rec.readBy, here:rec.here };
    this.active.set(file, { project, rec });
    try {
      const state = read(file), resync = rec.resync;
      const live = {};
      if (state?.writer === this.instance) for (const key of ["lastAt", "mtime", "turnOpen", "active", "interrupted", "asking", "skipUntil", "staleSeen", "piCheckpoint"]) if (key in rec) live[key] = rec[key];
      const recovered = this.recoveredState(before, state);
      if (recovered !== state && JSON.stringify(recovered.record) !== JSON.stringify(state.record)) {
        // Commit the recovered checkpoint before reading new events. A failed
        // import may roll back its own cursor without losing the managed evidence.
        atomic(file, { ...recovered, writer:this.instance });
      }
      if (recovered) this.restore(project, rec, recovered);
      Object.assign(rec, live);
      if (resync && !rec.slug && !rec.reservedSlug) Object.assign(rec, { offset:0, size:0, seq:undefined, doneTurns:{}, openItems:{}, updated:undefined, settled:undefined, agStamp:undefined });
      delete rec.resync;
      if (rec.runOwner && rec.runOwner.instance !== this.instance && alive(rec.runOwner)) return false;
      if (rec.runOwner && rec.runOwner.instance === this.instance && !this.service.isSessionRunning?.(rec.agent, rec.id)) delete rec.runOwner;
      this.active.get(file).checkpoint = this.snapshot(project, rec);
      const initial = JSON.stringify(this.snapshot(project, rec));
      await fn();
      const after = this.snapshot(project, rec);
      if (JSON.stringify(after) !== initial || !state) atomic(file, after);
      const owner = this.service.store.projects.find(p => p.id === rec.projectId);
      if (owner && rec.slug && !this.service.sessions?.[`${owner.id}/${rec.slug}`]?.[rec.agent]) this.service.remember?.(owner, rec.slug, rec.agent, rec.id, "work", rec.cwd);
      return true;
    } catch (error) {
      // Retry from the last durable checkpoint. The Line's Ask markers make
      // replay after a write-before-checkpoint crash idempotent.
      const durable = read(file);
      this.restore(project, rec, durable || before);
      // Nothing was ever checkpointed: the conversation is as unowned as it was, not claimed by a project it failed to enter, so a later sync starts it clean.
      if (!durable) for (const [key, value] of Object.entries(owned)) { if (value === undefined) delete rec[key]; else rec[key] = value; }
      delete rec.updated; delete rec.agStamp; rec.size = 0;
      throw error;
    } finally { this.active.delete(file); release(); }
  }
  async writing(project, fn) {
    const file = path.join(rootOf(project), "writing.lock");
    const until = Date.now() + 30000;
    for (;;) {
      const release = lock(file, this.instance);
      if (release) { try { return await fn(); } finally { release(); } }
      if (Date.now() >= until) throw Object.assign(new Error("Another PenEcho is importing this project; retry on the next scan."), { code:"IMPORT_BUSY" });
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  reserve(project, rec, base, available) {
    if (rec.reservedSlug) return rec.reservedSlug;
    rec.reservedSlug = claimSlug(project, base, available, `${rec.agent}:${rec.id}`);
    // Reserve the destination before the first Line write, so a crash cannot
    // give the same session another filename on retry.
    const held = this.active.get(this.file(project, rec));
    const durable = held?.checkpoint ? JSON.parse(JSON.stringify(held.checkpoint)) : this.snapshot(project, rec);
    durable.record.reservedSlug = rec.reservedSlug;
    atomic(this.file(project, rec), durable);
    return rec.reservedSlug;
  }
  bind(project, rec, running = false) {
    const file = this.file(project, rec);
    if (running) this.clearPending(this.pendingEnds, file);
    const commit = (retrying = false) => {
      if (this.closed) return true;
      if (retrying && running && !this.service.isSessionRunning?.(rec.agent, rec.id)) return true;
      if (this.active.has(file)) return false; // The enclosing import commits it, or retry while running.
      const release = lock(`${file}.lock`, this.instance);
      if (!release) return false; // Existing importer owns its checkpoint; do not clobber it.
      try {
        const saved = read(file);
        if (saved && !running) return true;
        if (saved && running) {
          const binding = Object.fromEntries(["slug", "projectId", "readBy", "stepId", "appStep", "startedHere", "interrupted"].filter(k => k in rec).map(k => [k,rec[k]]));
          const skipUntil = Math.max(rec.skipUntil || 0, saved.record.skipUntil || 0);
          this.restore(project, rec, saved); Object.assign(rec, binding, { skipUntil });
        }
        if (running) { delete rec.runEndedAt; rec.runOwner = { pid:process.pid, host:os.hostname(), instance:this.instance }; }
        this.save(project, rec);
        return true;
      } finally { release(); }
    };
    if (commit(false) || !running) { if (running) this.clearPending(this.pendingBinds, file); return; }
    this.clearPending(this.pendingBinds, file);
    const retry = delay => {
      const timer = setTimeout(() => {
        this.pendingBinds.delete(file);
        try { if (!commit(true) && !this.closed) retry(Math.min(delay * 2, 500)); } catch {}
      }, delay);
      timer.unref?.();
      this.pendingBinds.set(file, timer);
    };
    retry(50);
  }
  ended(project, rec) {
    const file = this.file(project, rec);
    this.clearPending(this.pendingBinds, file);
    this.clearPending(this.pendingEnds, file);
    delete rec.runOwner;
    const endedAt = Date.now();
    rec.runEndedAt = endedAt;
    const commit = () => {
      if (this.closed || this.service.isSessionRunning?.(rec.agent, rec.id)) return true;
      if (this.active.has(file)) return false;
      const release = lock(`${file}.lock`, this.instance);
      if (!release) return false;
      try {
        const saved = read(file);
        if (saved?.record?.runOwner && saved.record.runOwner.instance !== this.instance && alive(saved.record.runOwner)) return true;
        delete rec.runOwner;
        rec.runEndedAt = Math.max(rec.runEndedAt || 0, endedAt);
        this.save(project, rec);
        return true;
      } finally { release(); }
    };
    if (commit()) return;
    const retry = delay => {
      const timer = setTimeout(() => {
        this.pendingEnds.delete(file);
        try { if (!commit() && !this.closed) retry(Math.min(delay * 2, 1000)); } catch {}
      }, delay);
      timer.unref?.();
      this.pendingEnds.set(file, timer);
    };
    retry(50);
  }
  holdRecords(project, records) {
    const files = new Set();
    for (const rec of records) {
      const reader = this.service.store.projects.find(p => p.id === rec.readBy) || project;
      files.add(this.file(project, rec)); files.add(this.file(reader, rec));
    }
    const held=[];
    try { for (const file of [...files].sort()) { const release=lock(`${file}.lock`,this.instance); if(!release) throw Object.assign(new Error("A conversation is being imported; try moving its Line again in a moment."),{code:"IMPORT_BUSY",status:409}); held.push(release); } }
    catch(e){held.reverse().forEach(release=>release());throw e;}
    return () => held.reverse().forEach(release=>release());
  }

  reconcile(records) {
    // A repair is explicit and small. Read its aliases once at startup, never
    // while loading pages or scanning unchanged transcripts.
    for (const project of this.service.store.projects) {
      // One broken or unreadable project folder (e.g. replaced by a file or corrupt repairs.json) never blocks startup for healthy projects.
      try {
        const repairs = read(path.join(rootOf(project), "repairs.json"));
        for (const pair of repairs?.pairs || []) {
          const rec = records[pair.session];
          if (rec && rec.projectId === project.id && [pair.keep, pair.gone].includes(rec.slug)) {
            const state = read(this.file(project, rec));
            if (state) this.restore(project, rec, state);
          }
          const sessions = this.service.sessions, from = `${project.id}/${pair.gone}`, into = `${project.id}/${pair.keep}`;
          if (sessions?.[from]) {
            const entries = Object.fromEntries(Object.entries(sessions[from]).map(([key,value]) => [key, { ...value, ...(value.workId && pair.stepMap[value.workId] ? { workId:pair.stepMap[value.workId] } : {}) }]));
            sessions[into] = { ...entries, ...sessions[into] }; delete sessions[from];
          }
        }
      } catch { /* Skipped for this project; healthy projects still start. */ }
    }
  }
  resumeAfterRepair() {
    // Resume only after this service owns the runtime, never from a passive reader.
    for (const project of this.service.store.projects) {
      try {
        const resumeFile = path.join(rootOf(project), "resume", hash(this.service.directory) + ".json"), resume = read(resumeFile);
        if (resume?.projectId === project.id && resume.follow === true) {
          project.follow = true; this.service.store.save(); fs.unlinkSync(resumeFile);
        }
      } catch { /* Left untouched for retry without blocking startup of healthy projects. */ }
    }
  }
  close() {
    this.closed = true;
    for (const timer of this.pendingBinds.values()) clearTimeout(timer);
    for (const timer of this.pendingEnds.values()) clearTimeout(timer);
    this.pendingBinds.clear(); this.pendingEnds.clear();
    instances.delete(this.instance);
  }
}
const eventKey = (rec, key, index) => hash(`${rec.agent}:${rec.id}:${key}:${index}`);
function events(rec, key, changes, extra = {}) {
  let sayId = "";
  return changes.map((change, i) => {
    const id = eventKey(rec, key, i);
    if (change.add?.kind === "say") sayId = change.add.id || id;
    return { ...change, ...extra, importEvent:id, ...(change.said && sayId ? { importSaidBy:sayId } : {}) };
  });
}
module.exports = { ImportState, nextId, claimSlug, eventKey, events, rootOf, read, atomic, lock };
