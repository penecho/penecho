"use strict";
// What one round of sync does with each file of a project that is kept in PenEcho Cloud.
// It reads three lists and returns a list; it touches no file and no network, so every rule here can be tested by itself.
//
//   base    { path: sha256 }                      what both sides agreed on after the last round
//   local   { path: { sha256, size, modified } }  the project's documents folder now
//   remote  { path: { sha256, size, modified } }  Cloud's copy now
//   held    [path]                                files with two versions the user has not chosen between yet
//
// The rules, for one path (b, l, r are its hash in base, here and in Cloud; none means the file is not there):
//   l = r                 nothing to do
//   only Cloud changed    pull it; if Cloud removed it, move ours to .trash/
//   only we changed       push it; if we removed it, tell Cloud to remove it (Cloud keeps it in its own trash)
//   removed on one side and changed on the other: the change wins, so nothing is lost
//   changed on both       "both": merge, or keep ours and put Cloud's in .history/ (engine.js)
//   ours, not synced      (local[path].out: no current Line shows or names it, sync-scope.js) "unshare": Cloud's copy is taken out,
//                         ours is never touched and Cloud's is never brought down over it

// Never synced: what sync itself puts aside, and the second copy of a file whose two versions wait for the user.
const OTHER_COPY = /\.cloud-\d{8}-\d{6}(?=\.[^./]+$|$)/;
const aside = path => path.startsWith(".history/") || path.startsWith(".trash/") || OTHER_COPY.test(path);

// `topics/plan.md` kept beside Cloud's version as `topics/plan.cloud-20261110-093000.md`.
const stampOf = (at = new Date()) => at.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
function otherCopy(path, at = new Date()) {
  const stamp = stampOf(at);
  const dot = path.lastIndexOf("."), slash = path.lastIndexOf("/");
  return dot > slash + 1 ? `${path.slice(0, dot)}.cloud-${stamp}${path.slice(dot)}` : `${path}.cloud-${stamp}`;
}

const SHARED_FILES = new Set(["canvases", "_incoming", "drawings"]);
function cloudLineSlug(path) {
  const m = /^topics\/([^/]+)(?:\.md|\/)/.exec(path) || /^files\/([^/]+)\//.exec(path);
  return m && !SHARED_FILES.has(m[1]) ? m[1] : "";
}

function plan({ base = {}, local = {}, remote = {}, held = [] } = {}) {
  const waiting = new Set(held), actions = [], settled = {};
  const allPaths = [...new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])].sort();
  // A brand-new Line created in Cloud (`base` has no `topics/<slug>.md`) whose slug is already occupied by an
  // out-of-scope local Line (e.g. `archive/lines/<slug>.md`): rehome all of Cloud's files for that new Line to a
  // free local slug instead of deleting Cloud's new Line (`unshare`) or overwriting local's archived copy.
  const rehomedSlugs = new Set();
  for (const path of allPaths) {
    if (aside(path) || !local[path]?.out) continue;
    const slug = cloudLineSlug(path), lineRel = slug ? `topics/${slug}.md` : "";
    if (slug && base[lineRel] === undefined && remote[lineRel] !== undefined) rehomedSlugs.add(slug);
  }
  for (const path of allPaths) {
    if (aside(path)) continue;
    const b = base[path], l = local[path] ? local[path].sha256 : undefined, r = remote[path] ? remote[path].sha256 : undefined;
    const slug = cloudLineSlug(path);
    if (slug && rehomedSlugs.has(slug) && b === undefined && r !== undefined) {
      actions.push({ op:"rehome-remote", path });
      continue;
    }
    if (local[path]?.out) {
      if (r !== undefined) actions.push({ op:b === undefined ? "rehome-remote" : "unshare", path });
      continue;
    }
    if (waiting.has(path) || local[path]?.skipped) { actions.push({ op:"held", path }); continue; }
    if (l === r) { if (l) settled[path] = l; continue; }
    if (l === b) actions.push({ op:r ? "pull" : "trash-local", path });
    else if (r === b) actions.push({ op:l ? "push" : "remove-remote", path });
    else if (!l) actions.push({ op:"pull", path });
    else if (!r) actions.push({ op:"push", path });
    else actions.push({ op:"both", path });
  }
  return { actions, settled };
}

module.exports = { plan, otherCopy, stampOf, aside };
