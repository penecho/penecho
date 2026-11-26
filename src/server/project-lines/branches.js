"use strict";
const { git } = require("./git.js");

// How the branches on a project's map relate, read from Git, so a branch from a branch hangs from its parent and not from main.
const WALK = 5000;
const ref = name => `refs/heads/${name}`;
async function tipsOf(repo) {
  const r = await git(repo, ["for-each-ref", "--format=%(refname)%09%(objectname)", "refs/heads/"]);
  const tips = new Map();
  if (r.ok) for (const line of r.stdout.split("\n").filter(Boolean)) { const [name, sha] = line.split("\t"); tips.set(name.replace(/^refs\/heads\//, ""), sha); }
  return tips;
}
const earlier = (a, b) => String(a).localeCompare(String(b));

// `lines` are { branch, started }. For each branch on them: its parent, whether it has been merged, whether there is anything to merge, how many commits it has that its parent (or main) lacks, and a few words on how it stands.
async function branchTree(repo, trunk, lines) {
  const tips = await tipsOf(repo), started = new Map();
  if (!tips.size) return {};
  for (const l of lines) {
    if (!l.branch || l.branch === trunk) continue;
    const at = l.started || "9";
    if (!started.has(l.branch) || earlier(at, started.get(l.branch)) < 0) started.set(l.branch, at);
  }
  const tree = {}, live = [...started.keys()].filter(name => tips.has(name));
  for (const name of started.keys()) tree[name] = { parent:null, merged:false, mergeable:tips.has(name), note:tips.has(name) ? "" : "Not in Git" };
  if (!tips.has(trunk)) return tree;

  const count = async (from, to) => { const r = await git(repo, ["rev-list", "--count", `${from}..${to}`]); return r.ok ? Number(r.stdout.trim()) || 0 : 0; };
  // A commit on a branch's own run of first parents was built there. Anywhere else, it came in through a merge.
  const runs = new Map();
  const builtOn = async (branch, sha) => {
    if (!runs.has(branch)) { const r = await git(repo, ["rev-list", "--first-parent", `--max-count=${WALK}`, ref(branch)]); runs.set(branch, new Set(r.ok ? r.stdout.split("\n") : [])); }
    return runs.get(branch).has(sha);
  };

  // What is already in main has nothing to do with other branches.
  const ahead = {}, own = [];
  for (const name of live) {
    ahead[name] = await count(ref(trunk), ref(name));
    if (ahead[name] > 0) { own.push(name); tree[name].ahead = ahead[name]; continue; }
    const merged = !await builtOn(trunk, tips.get(name));
    tree[name] = { parent:null, merged, mergeable:false, note:merged ? `Merged into ${trunk}` : "No commits of its own" };
  }

  // What each two branches have in common beyond main.
  const pairs = new Map(), between = (a, b) => pairs.get(`${a}\0${b}`);
  for (let i = 0; i < own.length; i++) for (let j = i + 1; j < own.length; j++) {
    const base = (await git(repo, ["merge-base", ref(own[i]), ref(own[j])])).stdout.trim(), entry = { base, shared:base ? await count(ref(trunk), base) : 0 };
    pairs.set(`${own[i]}\0${own[j]}`, entry); pairs.set(`${own[j]}\0${own[i]}`, entry);
  }

  // Merged into another branch: that branch holds it, and it did not build on it.
  for (const name of own) {
    const holders = [];
    for (const other of own) {
      if (other === name || tips.get(other) === tips.get(name) || between(name, other).base !== tips.get(name)) continue;
      if (!await builtOn(other, tips.get(name))) holders.push(other);
    }
    if (holders.length) { const into = holders.sort((a, b) => ahead[a] - ahead[b] || a.localeCompare(b))[0]; tree[name] = { parent:into, merged:true, mergeable:false, note:`Merged into ${into}` }; }
  }

  // Otherwise a branch hangs from the one it shares the most with. Git keeps no record of which of two came first, so the older line counts as the parent, which is also how the map reads: old at the top.
  const older = (a, b) => earlier(started.get(a), started.get(b)) || ahead[a] - ahead[b] || a.localeCompare(b);
  for (const name of own) {
    if (tree[name].merged) continue;
    const found = own.filter(other => other !== name && between(other, name).shared > 0 && tree[other].parent !== name && older(other, name) < 0);
    // When it shares as much with several: one it was really built on comes first, and of two on one commit, the newer is nearest. Of two that have both moved on, the newer is more likely a sibling.
    const builtFrom = other => between(other, name).base === tips.get(other);
    found.sort((a, b) => between(b, name).shared - between(a, name).shared || builtFrom(b) - builtFrom(a) || (builtFrom(a) ? earlier(started.get(b), started.get(a)) : earlier(started.get(a), started.get(b))) || a.localeCompare(b));
    if (found.length) tree[name].parent = found[0];
  }
  // A merge can point the other way from the lines' ages, and a map must end at main.
  for (const name of own) {
    const seen = new Set([name]);
    for (let up = tree[name].parent; up; up = tree[up]?.parent) { if (seen.has(up)) { tree[name] = { ...tree[name], parent:null, merged:false }; break; } seen.add(up); }
  }

  for (const name of own) {
    const entry = tree[name], parent = entry.parent;
    if (entry.merged || !parent) continue;
    if (tips.get(parent) === tips.get(name)) { entry.note = "Same commit"; entry.mergeable = false; entry.ahead = 0; continue; }
    const more = await count(ref(parent), ref(name));
    entry.mergeable = more > 0; entry.ahead = more;
    if (!more) entry.note = "No commits of its own";
    else if (between(parent, name).base === tips.get(parent)) entry.note = `${more} more ${more === 1 ? "commit" : "commits"}`;
  }
  return tree;
}

module.exports = { branchTree, tipsOf };
