"use strict";
// What penecho.ai shows of a project this computer syncs, made here from this computer's own Lines state (owner, 2026-11-18: "Your Mac
// sends its built page data along with its normal sync … penecho.ai stores and serves that, and never builds a computer project on its
// own"). Cloud has only the synced files, so the view holds only those (sync-scope.js): no archived or deleted Lines Cloud does not
// have, no files that stay here, no paths on this computer, and nothing about runs on this computer, Git or conversations.
// The Orchestrator works on penecho.ai for a project that lives on a computer (owner, 2026-11-22): what its page shows goes with the
// view (`orchestrator`), and a job started there is a Line held for this computer like any Ask (computer.js). Cloud keeps what is its
// own: what was deleted on penecho.ai.
const crypto = require("node:crypto");
const os = require("node:os");

const SHARED_FILES = new Set(["canvases", "_incoming", "drawings"]);
const slugHash = slug => crypto.createHash("sha256").update(String(slug)).digest("hex").slice(0, 12);
function takenSlugHashesOf(state) {
  const taken = new Set();
  for (const list of [state?.lines, state?.landed, state?.backlog]) {
    for (const l of list || []) if (l?.slug) taken.add(l.slug);
  }
  for (const d of state?.deleted?.lines || []) if (d?.slug) taken.add(d.slug);
  for (const f of state?.files || []) {
    const m = /^(?:works|files)\/([^/]+)\//.exec(String(f?.path || ""));
    if (m && !SHARED_FILES.has(m[1])) taken.add(m[1]);
  }
  return [...taken].map(slugHash).sort();
}

// A Line's parts that describe this computer, as penecho.ai's own build leaves them.
const LINE_LOCAL = { topicAbsolutePath:"", folder:"", workdir:"", conversation:null, conversations:{}, activitySeq:0, diff:null };
// A step's parts that are this computer's.
const STATION_LOCAL = ["diff"];
// Words people and agents wrote: shown as written, as the synced files show them.
const WORDS = new Set(["text", "out", "words", "title", "summary", "excerpt", "md", "note", "why", "label", "result"]);
const EMPTY_DELETED = { lines:[], nodes:[], canvases:[], files:[], days:7 };
const STATION_TOKEN_RECORD = Symbol.for("penecho.stationTokenRecord");

function localRoots(project) {
  return [project?.docsPath, project?.code, ...(project?.vault?.code || []).map(c => c?.path), os.homedir()].filter(p => typeof p === "string" && p.length > 1);
}
// A value that is a path on this computer is not sent; words are, as written.
function scrub(value, roots, key = "") {
  if (typeof value === "string") return !WORDS.has(key) && roots.some(root => value === root || value.startsWith(`${root}/`)) ? "" : value;
  if (Array.isArray(value)) return value.map(item => scrub(item, roots, key));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = WORDS.has(k) ? v : scrub(v, roots, k);
    return out;
  }
  return value;
}
function station(s, roots, has) {
  const out = { ...s };
  for (const key of STATION_LOCAL) delete out[key];
  // A Work's own files that stay on this computer (an archived Line's Works) are not linked from Cloud, where they are not.
  for (const key of ["detail", "tokenEvidencePath"]) if (out[key] && !has(out[key])) out[key] = key === "detail" ? "" : null;
  if (Array.isArray(out.outputs)) out.outputs = out.outputs.filter(o => !roots.some(root => String(o?.path || "").startsWith(`${root}/`)));
  // What a run on this computer is doing right now names its commands and folders.
  if (typeof out.now === "string" && /\/|\\/.test(out.now)) out.now = "Working";
  if (out.detail && Object.hasOwn(s, STATION_TOKEN_RECORD)) Object.defineProperty(out, STATION_TOKEN_RECORD, { value:s[STATION_TOKEN_RECORD] });
  return out;
}

// The Orchestrator's sessions for the Lines Cloud has: a job's Lines that stay here are not named, and neither is a command or a folder
// a run is at right now.
function sessionsFor(made, slugs) {
  const quiet = x => { const out = { ...x }; if (typeof out.progress === "string" && /\/|\\/.test(out.progress)) delete out.progress; return out; };
  const sessions = (made?.sessions || []).filter(x => slugs.has(x.line)).map(x => ({
    ...quiet(x),
    ...(x.waitingOn ? { waitingOn:x.waitingOn.filter(w => slugs.has(w.line)) } : {}),
    lines:(x.lines || []).filter(c => slugs.has(c.line)).map(quiet),
  }));
  return { sessions, kinds:Array.isArray(made?.kinds) ? made.kinds : [] };
}

// state: the Lines service's state of the project; keep: the files the sync takes to Cloud, by today's names (sync-scope.js);
// tokensOf(lines): the project's token counts for these Lines (service.projectTokens).
// orchestrator(): what the Orchestrator page shows, { sessions, kinds } (orchestrator.js sessions), asked for only when a Line here is one.
function cloudView(state, keep, { project = null, tokensOf = null, orchestrator = null } = {}) {
  const roots = localRoots(project), has = rel => typeof rel === "string" && keep.has(rel);
  const rawLine = l => ({ ...l, ...LINE_LOCAL, stations:(l.stations || []).map(s => station(s, roots, has)) });
  const pickRaw = list => (list || []).filter(l => has(l.topicPath)).map(rawLine);
  const rawLines = pickRaw(state.lines), rawLanded = pickRaw(state.landed), rawBacklog = pickRaw(state.backlog);
  const lines = rawLines.map(l => scrub(l, roots)), landed = rawLanded.map(l => scrub(l, roots)), backlog = rawBacklog.map(l => scrub(l, roots));
  const slugs = new Set([...lines, ...landed, ...backlog].map(l => l.slug));
  const files = (state.files || []).filter(f => has(f.path));
  let orchestrated = null;
  if (typeof orchestrator === "function" && [...lines, ...landed, ...backlog].some(l => l.orchestratorRef)) {
    try { orchestrated = sessionsFor(orchestrator(), slugs); } catch { orchestrated = null; }
  }
  return scrub({
    ...state,
    ...(orchestrated ? { orchestrator:orchestrated } : {}),
    takenSlugHashes:takenSlugHashesOf(state),
    deleted:EMPTY_DELETED, deletionWarnings:[], conflicts:[], branches:{},
    project:{ ...(state.project || {}), here:"", git:undefined, vault:{ path:"", code:[] } },
    tokens:typeof tokensOf === "function" ? tokensOf([...rawLines, ...rawLanded, ...rawBacklog]) : state.tokens,
    lines, landed, backlog, files,
    // Cloud reads the knowledge Topics on their own (state.knowledge), not as notes.
    notes:(state.notes || []).filter(n => has(n.path) && !String(n.path).startsWith("topics/")),
    pictures:(state.pictures || []).filter(p => has(p.source) || has(p.path)),
    artifacts:(state.artifacts || []).filter(a => !a.line || slugs.has(a.line)),
    latestFiles:(state.latestFiles || []).filter(f => has(f.path)),
  }, roots);
}

// Check that every in-scope Work station's tokens match the project token summary built for the same view,
// so a reused snapshot and a freshly read .tokens.json can never mix two versions into one Cloud view.
const TOKEN_FIELDS = ["inputTokens", "outputTokens", "cacheReadInputTokens", "cacheWriteInputTokens", "requests", "attempts", "coverage"];
function tokensMismatch(view) {
  const records = view?.tokens?.records;
  if (!Array.isArray(records)) return false;
  const byKey = new Map();
  for (const r of records) if (r?.lineId && r?.stepId) byKey.set(`${r.lineId}\u0000${r.stepId}`, r);
  for (const l of [...(view.lines || []), ...(view.landed || []), ...(view.backlog || [])]) {
    for (const s of l.stations || []) {
      if (!s.detail || s.unsent || s.state === "todo") continue;
      const r = byKey.get(`${l.slug}\u0000${s.id}`) || null, st = s.tokens || null;
      if (!r && !st) continue;
      if (!r || !st) return true;
      for (const field of TOKEN_FIELDS) if ((st[field] ?? null) !== (r[field] ?? null)) return true;
    }
  }
  return false;
}

// What to send penecho.ai now (cloud-share.js pushView): the whole view, or only what changed since the view tagged `base`, made by the
// Lines service's own stateSince on a holder of this project's sent views, so the pages' change rules hold here too. Only the view
// just made, and the one Cloud took last (`base`), are kept for the next time: a big project's view is megabytes. Cloud may not be
// sent an unchanged view, and then still knows only `base`; dropping it made every other idle round send the whole view (PE-692).
// scope(project, { files }) → the files the sync takes (sync-scope.js syncScope); keep can be that scope already made by this round.
function viewFor(service, project, holders, base, dbRev, scope, { keep = null, files = null } = {}) {
  const hasRealCache = service.states instanceof Map;
  // On a real Service, check cached rev & stateVersion without triggering a cold UI walk when `keep` is already available.
  const live = keep && hasRealCache ? (service.states.get(project.id)?.state || null) : (typeof service.stateOf === "function" ? service.stateOf(project) : null);
  const versionOk = !keep || keep.stateVersion == null || service.stateVersion == null || keep.stateVersion === service.stateVersion;
  const keepFresh = Boolean(keep && versionOk && (!keep.state || !live || keep.state.rev === live.rev || (keep.baseRev != null && keep.baseRev === live.rev)));
  const build = (scoped, fallbackState, { pinned = false } = {}) => cloudView(scoped.state || fallbackState, scoped, {
    project,
    tokensOf:lines => (pinned ? service.projectTokens(project, lines, { pinned:true }) : service.projectTokens(project, lines)),
    orchestrator:service.orchestrator?.sessions ? () => ({ sessions:service.orchestrator.sessions(project), kinds:service.orchestrator.KINDS }) : null,
  });
  // Only pass cached `files` when `keep` was not rejected as stale (rejected `keep` and its `files` come from the same older round).
  let scoped = keepFresh ? keep : scope(project, !keep && files ? { files } : undefined);
  let state = build(scoped, live || (scoped.state ? null : service.stateOf(project)));
  if (tokensMismatch(state)) {
    if (keepFresh || (!keep && files)) {
      scoped = scope(project);
      state = build(scoped, scoped.state || service.stateOf(project));
    }
    if (tokensMismatch(state) && typeof service.makeState === "function" && service.store?.walk) {
      const freshFiles = service.store.walk(project, { limit:Infinity });
      const freshState = service.makeState(project, freshFiles, { fresh:true }).state;
      scoped = scope(project, { files:freshFiles, state:freshState });
      state = build(scoped, freshState, { pinned:true });
    }
    if (tokensMismatch(state)) throw Object.assign(new Error("Project token snapshot changed during view build."), { code:"VIEW_SNAPSHOT_CHANGED" });
  }
  let holder = holders.get(project.id);
  if (!holder) holders.set(project.id, holder = { sentStates:new Map() });
  const known = base ? (holder.sentStates.get(project.id) || []).find(s => holder.tags?.get(s) === base) : null;
  const sent = Object.getPrototypeOf(service).stateSince.call(holder, { id:project.id }, state, base || "");
  (holder.tags ||= new WeakMap()).set(state, sent.tag);
  holder.sentStates.set(project.id, known ? [known, state] : [state]);
  if (sent.same) return { same:true, tag:sent.tag, body:{ v:1, dbRev, same:true, base:sent.base || base, tag:sent.tag } };
  if (sent.delta) return { tag:sent.tag, body:{ v:1, dbRev, delta:sent } };
  return { tag:sent.tag, body:{ v:1, dbRev, state:sent } };
}

module.exports = { cloudView, viewFor, scrub };
