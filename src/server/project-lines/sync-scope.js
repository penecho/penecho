"use strict";
// Which of a project's files go to PenEcho Cloud (PE-581). Owner: "we should only include Lines/Lines related files. if the file will
// never be viewed by any active (not archived or deleted) Lines, it should not be synced" — "also for memory and topic files".
//
// In scope (today's names, layout 2):
//   - the knowledge: MEMORY.md, README.md, understanding.md, everything under topics/, and the project's notes;
//   - each current Line (not archived, not deleted): its file in lines/ and its Works in works/<line>/;
//   - every file a current Line shows (a step's pictures and files, the Ask's files, its Canvases with their own files);
//   - every file a current Line, its Works, the knowledge or a note links to by name (an archived Work it links too), and what a
//     linked page needs from its folder;
//   - a Canvas of its own (files/<name>/canvas.penecho.json, its folder no Line's): something the person made.
// Not in scope: archived and deleted Lines with their Works and files, and files no current Line shows or names (an agent's scratch
// output left in a Line's folder). They stay on the computer as they are; the sync only takes them out of Cloud (sync/plan.js).
const path = require("node:path");
const L = require("./layout.js");
const { pathsIn } = require("./project-files.js");

const KNOWLEDGE = new Set(["MEMORY.md", "README.md", "understanding.md"]);
const PAGE = /\.html?$/i, MARKDOWN = /\.md$/i, CANVAS = /\.penecho\.json$/i;
const OWN_CANVAS = /^files\/[^/]+\/canvas\.penecho\.json$/;
const LINE_FILE = /^lines\/([^/]+?)(?:\.[^/]*)?$/;

function lineSyncTime(line) {
  for (const value of [line?.lastActivityAt, line?.updatedAt, line?.statusAt, line?.createdAt]) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return 0;
}

// state: the Lines service's state of the project (service.stateOf); names: every file of the project, today's names; read(rel) → text.
// syncSince: fixed cutoff timestamp (ms) chosen on first sync; 0 means all current Lines.
// syncStartedAt: timestamp (ms) when first sync was configured; any manual edit/status change after it brings an older Line into sync.
// knownRemote: layout-2 paths already present in Cloud (or in the agreed sync base); active Lines already synced stay in scope so
// old uploaded data is never cleared from Cloud as days grow.
function scopeOf(state, names, read, onUnreadable = () => {}, { syncSince = 0, syncStartedAt = 0, knownRemote = null } = {}) {
  const all = new Set(names), keep = new Set(), texts = [];
  const allCurrent = [...(state.lines || []), ...(state.backlog || [])];
  const allLineSlugs = new Set([...allCurrent, ...(state.landed || [])].map(l => l.slug).filter(Boolean));
  const cutoff = Number(syncSince) > 0 ? Number(syncSince) : 0;
  const startedAt = Number(syncStartedAt) > 0 ? Number(syncStartedAt) : 0;
  const inWindow = l => !cutoff
    || Boolean(knownRemote && l.topicPath && knownRemote.has(l.topicPath))
    || lineSyncTime(l) >= cutoff
    || (startedAt > 0 && Number(l.updatedAt) > startedAt);
  const current = cutoff ? allCurrent.filter(inWindow) : allCurrent;
  const slugs = new Set(current.map(l => l.slug).filter(Boolean));
  const excludedSlugs = cutoff ? new Set(allCurrent.map(l => l.slug).filter(s => s && !slugs.has(s))) : null;
  const add = rel => { if (rel && all.has(rel)) { keep.add(rel); return true; } return false; };
  const notes = new Set((state.notes || []).map(n => n.path));
  for (const rel of all) {
    const work = /^works\/([^/]+)\//.exec(rel)?.[1], line = LINE_FILE.exec(rel)?.[1];
    if (KNOWLEDGE.has(rel) || rel.startsWith("topics/") || notes.has(rel)) { keep.add(rel); if (MARKDOWN.test(rel)) texts.push(rel); }
    else if (line && slugs.has(line)) { keep.add(rel); if (MARKDOWN.test(rel)) texts.push(rel); }
    else if (work && slugs.has(work)) { keep.add(rel); if (MARKDOWN.test(rel)) texts.push(rel); }
  }
  for (const l of current) {
    if (add(l.topicPath) && !texts.includes(l.topicPath)) texts.push(l.topicPath);
    for (const pic of l.pictures || []) { add(pic.path); add(pic.source); }
    for (const f of [...(l.ask?.files || []), ...(l.ask?.later || []).flatMap(x => x.files || [])]) add(f.path);
    for (const s of l.stations || []) for (const f of [...(s.files || []), ...(s.pictures || [])]) add(f.path);
  }
  // What the Lines service already found a current Line's step showing (project-files.js placeOf).
  for (const f of state.files || []) if (f.step && slugs.has(f.line)) add(f.path);
  for (const rel of all) if (OWN_CANVAS.test(rel) && !allLineSlugs.has(rel.split("/")[1])) keep.add(rel);
  // Links by name, and one step further from a linked text (a report a Work links, which links its pictures). A folder named alone
  // brings nothing: a Line that names a folder of thousands of outputs does not show them.
  const read1 = rel => { try { return read(rel); } catch { onUnreadable(rel); return ""; } };
  // pathsIn finds files/ paths however they are written; a Markdown link to anything else (an archived Work a current Line links,
  // ../archive/works/x/work-1.md) is followed by where it points.
  const linksIn = (text, rel) => {
    const out = new Set(pathsIn(text, rel)), dir = path.posix.dirname(rel);
    for (const m of String(text).matchAll(/\]\(<?([^)\s>]+)>?\)/g)) {
      let href = m[1].split(/[?#]/)[0];
      if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("/")) continue;
      try { href = decodeURI(href); } catch { /* Kept as written. */ }
      const at = path.posix.normalize(path.posix.join(dir, href));
      if (at.startsWith("..")) continue;
      out.add(at);
      // The project's list may name an archived file without archive/ (store.walk), and a link may be written either way.
      if (at.startsWith("archive/")) out.add(at.slice("archive/".length));
    }
    return out;
  };
  const ownerOfPath = rel => { const canonical = L.nameOf(rel); return L.ownerOf(canonical) || (LINE_FILE.exec(canonical)?.[1] || ""); };
  const isKnowledgeSource = rel => KNOWLEDGE.has(rel) || rel.startsWith("topics/");
  const skipExcludedLink = (fromKnowledge, target) => {
    if (!excludedSlugs?.size) return false;
    const canonical = L.nameOf(target), owner = ownerOfPath(canonical);
    if (!owner || !excludedSlugs.has(owner)) return false;
    // Never pull an excluded older Line back in via README/understanding/topics index tables (including 2-hop links) or via a direct line link.
    if (fromKnowledge || LINE_FILE.test(canonical)) return true;
    return false;
  };
  const linkedFrom = (rel, fromKnowledge = isKnowledgeSource(rel)) => {
    for (const p of linksIn(read1(rel), rel)) {
      if (!p.endsWith("/") && !skipExcludedLink(fromKnowledge, p) && add(p) && (MARKDOWN.test(p) || PAGE.test(p)) && !seen.has(p)) {
        seen.add(p);
        next.push([p, fromKnowledge]);
      }
    }
  };
  const seen = new Set(texts), next = [];
  for (const rel of texts) linkedFrom(rel, isKnowledgeSource(rel));
  for (const [rel, fromKnowledge] of next.splice(0)) {
    if (PAGE.test(rel)) { const dir = path.posix.dirname(rel); for (const other of all) if (other.startsWith(`${dir}/`) && !other.slice(dir.length + 1).includes("/")) keep.add(other); }
    else linkedFrom(rel, fromKnowledge);
  }
  // A Canvas comes with its picture and its own files (files/x/plan.penecho.json → plan.png, plan.diagram.json …).
  for (const rel of [...keep]) {
    if (!CANVAS.test(rel)) continue;
    const stem = rel.replace(CANVAS, "");
    for (const other of all) if (other.startsWith(`${stem}.`)) keep.add(other);
  }
  return keep;
}

function syncScope(service, project, { files = null, state = null, syncSince, syncStartedAt, knownRemote = null } = {}) {
  // A sync round can pass the inventory it just made. Otherwise list the folder now, so a Line changed a moment ago counts as it is.
  // Do not invalidate folderWatch here: Cloud's read must not make the next ordinary service state rebuild walk the folder again.
  const walked = Array.isArray(files) ? files : service.store.walk(project, { limit:Infinity });
  const hasRealCache = !state && service.states instanceof Map;
  // On a cold Service, build directly from the inventory we just walked instead of triggering a second UI walk via stateOf().
  const initial = state || (hasRealCache ? (service.states.get(project.id)?.state || null) : service.stateOf(project));
  let current = initial;
  // A direct editor write or deletion can beat the watcher. Compare the complete inventory in both directions (including file
  // generation identity) and rebuild from that same inventory (not another walk) whenever any file was added, changed, or removed.
  if (hasRealCache) {
    let stale = !current || !Array.isArray(current.files);
    if (!stale) {
      const known = new Map(current.files.map(file => [file.path, file])), names = new Set(walked.map(file => file.path));
      stale = walked.length !== current.files.length
        || walked.some(file => {
          const old = known.get(file.path);
          return !old || old.mtime !== file.mtime || old.size !== file.size || (file.gen && old.gen !== file.gen);
        })
        || current.files.some(file => !names.has(file.path))
        || [...(current.lines || []), ...(current.backlog || []), ...(current.landed || [])].some(line => line.topicPath && !names.has(line.topicPath))
        || (current.notes || []).some(note => note.path && !names.has(note.path));
    }
    if (stale) current = service.makeState(project, walked).state;
  }
  const cutoff = syncSince !== undefined ? (Number(syncSince) > 0 ? Number(syncSince) : 0) : (Number(project?.cloud?.syncSince) > 0 ? Number(project.cloud.syncSince) : 0);
  const startedAt = syncStartedAt !== undefined ? (Number(syncStartedAt) > 0 ? Number(syncStartedAt) : 0) : (Number(project?.cloud?.syncStartedAt) > 0 ? Number(project.cloud.syncStartedAt) : 0);
  let incomplete = false;
  const keep = scopeOf(current, walked.map(f => f.path), rel => service.store.readText(project, rel).text, () => { incomplete = true; }, { syncSince:cutoff, syncStartedAt:startedAt, knownRemote });
  // Keep the view on the same state as its scope, plus the service rev/version it was validated against. Non-enumerable: the
  // returned value is still just a Set of paths to every caller.
  Object.defineProperty(keep, "state", { value:current });
  Object.defineProperty(keep, "baseRev", { value:initial?.rev ?? null });
  Object.defineProperty(keep, "incomplete", { value:incomplete });
  Object.defineProperty(keep, "stateVersion", { value:service.stateVersion ?? null });
  return keep;
}

module.exports = { scopeOf, syncScope, lineSyncTime };
