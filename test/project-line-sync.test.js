"use strict";
require("./helpers/safety.js");
// Sync in both directions for a project kept in Cloud: the merge, the plan and one whole round, with nothing but memory behind them.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { mergeText, mergeLineFile, mergeFile } = require("../src/server/project-lines/sync/merge.js");
const { plan, otherCopy } = require("../src/server/project-lines/sync/plan.js");
const { syncOnce, settle } = require("../src/server/project-lines/sync/engine.js");

const sha = text => crypto.createHash("sha256").update(text).digest("hex");
const LINE = `---
id: PE-1
status: open
created: 2026-11-09 02:26
---

# Dark mode

<!-- status: PenEcho keeps this current -->
> [!status] Waiting for you
<!-- /status -->

## Ask · 2026-11-09 02:26

Add a dark mode.

## [ ] Work 1 · @claude

Working on it.

`;
const ask = (when, text, work = "") => `## Ask · ${when}\n\n${text}\n\n${work ? `## [x] Work · @penecho · 1 min\n\n${work}\n\n` : ""}`;

test("text: lines added on both sides at the same place are both kept; one line changed two ways is a clash", () => {
  const base = "- one\n- two\n";
  const both = mergeText(base, `${base}- mine\n`, `${base}- theirs\n`);
  assert.deepEqual(both, { text:"- one\n- two\n- mine\n- theirs\n", clean:true });
  assert.equal(mergeText(base, "- one\n- two\n- mine", `${base}- theirs\n`).text, "- one\n- two\n- mine\n- theirs\n", "a last line with no newline is closed first");
  assert.deepEqual(mergeText(base, "- ONE\n- two\n", "- one\n- two\n- three\n"), { text:"- ONE\n- two\n- three\n", clean:true });
  assert.equal(mergeText(base, "- uno\n- two\n", "- eins\n- two\n").clean, false);
  assert.deepEqual(mergeText(base, base, "x\n"), { text:"x\n", clean:true });
  assert.deepEqual(mergeText(base, "x\n", "x\n"), { text:"x\n", clean:true });
});

test("a line: an Ask added on each side stays, in time order, each with its own Work", () => {
  const mine = LINE + ask("2026-11-10 09:30", "Mine: also the map.", "Done here.");
  const theirs = LINE + ask("2026-11-10 09:10", "Theirs: and the charts.", "Done in Cloud.");
  const merged = mergeLineFile(LINE, mine, theirs);
  assert.equal(merged.clean, true);
  const order = ["Add a dark mode.", "Working on it.", "Theirs: and the charts.", "Done in Cloud.", "Mine: also the map.", "Done here."].map(piece => merged.text.indexOf(piece));
  assert.ok(order.every((at, index) => at > 0 && (index === 0 || at > order[index - 1])), "the earlier Ask first, and no piece lost");
  assert.equal(merged.text.match(/^## Ask/gm).length, 3);
  // Merging the result again with either side changes nothing more.
  assert.equal(mergeLineFile(theirs, merged.text, theirs).text, merged.text);
});

test("PE-582: extra section separators do not turn a Cloud Ask and a local note into a conflict", () => {
  for (const trailing of ["", "\n", "\n\n", "\n\n\n\n"]) {
    const base = LINE.trimEnd() + trailing;
    const mine = `${base}\n\n## Note · 2026-11-18 07:44\n\nKeep the local note.\n`;
    const theirs = `${base}\n\n## Ask · 2026-11-18 07:43 · Not sent\n\nAdd a tide table.\n`;
    const merged = mergeLineFile(base, mine, theirs);
    assert.equal(merged.clean, true);
    assert.match(merged.text, /Working on it\./);
    assert.match(merged.text, /Add a tide table\.[\s\S]*Keep the local note\./);
    assert.equal((merged.text.match(/Add a tide table\./g) || []).length, 1);
    assert.equal(mergeLineFile(theirs, merged.text, theirs).text, merged.text);
  }
});

test("a line: a Work finished on one side and a new Ask on the other; the rows PenEcho keeps follow the newer file", () => {
  const mine = LINE.replace("## [ ] Work 1 · @claude", "## [x] Work 1 · @claude · 3 min").replace("status: open", "status: review");
  const theirs = LINE.replace("status: open", "status: working") + ask("2026-11-10 08:00", "One more thing.");
  const newerHere = mergeLineFile(LINE, mine, theirs, { mineNewer:true });
  assert.equal(newerHere.clean, true);
  assert.match(newerHere.text, /^status: review$/m);
  assert.match(newerHere.text, /## \[x\] Work 1 · @claude · 3 min/);
  assert.match(newerHere.text, /One more thing\./);
  assert.match(mergeLineFile(LINE, mine, theirs, { mineNewer:false }).text, /^status: working$/m);
  assert.equal(newerHere.text.match(/^---$/gm).length, 2);
});

test("a line: the same note rewritten two ways cannot be merged, and other kinds of file are not merged here", () => {
  const mine = LINE.replace("Add a dark mode.", "Add a dark mode that follows the system.");
  const theirs = LINE.replace("Add a dark mode.", "Add a dark mode with a switch.");
  assert.equal(mergeLineFile(LINE, mine, theirs).clean, false);
  // Two different edits inside one piece do merge.
  const top = LINE.replace("Add a dark mode.", "Add a dark mode.\n\nAnd a light one.");
  const bottom = LINE.replace("## Ask · 2026-11-09 02:26\n", "## Ask · 2026-11-09 02:26\n\n(from my phone)\n");
  const inside = mergeLineFile(LINE, top, bottom);
  assert.equal(inside.clean, true);
  assert.match(inside.text, /\(from my phone\)[\s\S]*And a light one\./);
  assert.equal(mergeFile("files/a/canvas.penecho.json", "{}", "{1}", "{2}"), null);
  assert.equal(mergeFile("files/a/picture.png", "", "a", "b"), null);
  assert.equal(mergeFile("MEMORY.md", "a\n", "a\nb\n", "a\nc\n").text, "a\nb\nc\n");
});

test("the plan: each case of one file", () => {
  const file = hash => ({ sha256:hash, size:1, modified:"2026-11-10T00:00:00Z" });
  const op = (b, l, r, held = []) => plan({ base:b ? { f:b } : {}, local:l ? { f:file(l) } : {}, remote:r ? { f:file(r) } : {}, held }).actions.map(a => a.op).join();
  assert.equal(op("a", "a", "a"), "");
  assert.equal(op("a", "a", "b"), "pull");
  assert.equal(op("a", "b", "a"), "push");
  assert.equal(op(null, "b", null), "push");
  assert.equal(op(null, null, "b"), "pull");
  assert.equal(op("a", "a", null), "trash-local");
  assert.equal(op("a", null, "a"), "remove-remote");
  assert.equal(op("a", null, "b"), "pull", "removed here, changed there: the change wins");
  assert.equal(op("a", "b", null), "push");
  assert.equal(op("a", "b", "c"), "both");
  assert.equal(op(null, "b", "c"), "both");
  assert.equal(op("a", "b", "b"), "", "the same change on both sides");
  assert.equal(op("a", "b", "c", ["f"]), "held");
  assert.deepEqual(plan({ local:{ ".history/x":file("a"), ".trash/y":file("a"), "topics/p.cloud-20261110-093000.md":file("a") } }).actions, []);
  assert.equal(otherCopy("topics/plan.md", new Date("2026-11-10T09:30:00Z")), "topics/plan.cloud-20261110-093000.md");
  assert.equal(otherCopy("files/a/README", new Date("2026-11-10T09:30:00Z")), "files/a/README.cloud-20261110-093000");
});

// A folder, a Cloud copy and the agreed state, in memory.
function side() {
  const files = new Map(), aside = [];
  return {
    files, aside,
    set(path, text) { files.set(path, Buffer.from(text)); },
    text(path) { return files.has(path) ? files.get(path).toString() : null; },
    async list() { return Object.fromEntries([...files].filter(([path]) => !path.startsWith(".")).map(([path, bytes]) => [path, { sha256:sha(bytes), size:bytes.length, modified:"2026-11-10T00:00:00Z" }])); },
    async read(path) { return files.get(path); },
    async write(path, bytes) { if (files.has(path)) aside.push(`.history/${path}`); files.set(path, bytes); },
    async trash(path) { aside.push(`.trash/${path}`); files.delete(path); },
    async rename(from, to) { files.set(to, files.get(from)); files.delete(from); },
    async free(path) { return path.replace(/(\.[^.]+)$/, "-2$1"); },
  };
}
function cloud() {
  const files = new Map(), blobs = new Map();
  let rev = 1, refuseNext = false;
  const listing = () => Object.fromEntries([...files].map(([path, bytes]) => [path, { sha256:sha(bytes), size:bytes.length, modified:"2026-11-10T00:00:00Z" }]));
  return {
    files,
    set(path, text) { const bytes = Buffer.from(text); files.set(path, bytes); blobs.set(sha(bytes), bytes); rev++; },
    drop(path) { files.delete(path); rev++; },
    text(path) { return files.has(path) ? files.get(path).toString() : null; },
    refuseOnce() { refuseNext = true; },
    async manifest({ since }) { return since === rev ? { rev, changed:false } : { rev, changed:true, files:listing() }; },
    async download(hash) { return blobs.get(hash); },
    async commit({ rev:planned, put, remove }) {
      if (refuseNext || planned !== rev) { refuseNext = false; return { stale:true }; }
      for (const file of put) { files.set(file.path, file.bytes); blobs.set(file.sha256, file.bytes); }
      for (const path of remove) files.delete(path);
      return { rev:++rev };
    },
  };
}
function agreed() { const texts = new Map(); return { rev:0, base:{}, remote:{}, conflicts:[], async text(hash) { return texts.get(hash) || null; }, async keep(hash, bytes) { texts.set(hash, bytes); } }; }
const at = () => new Date("2026-11-10T09:30:00Z");

test("a round: a change on each side lands on the other, a second round does nothing, removals go to the trash", async () => {
  const local = side(), remote = cloud(), state = agreed();
  local.set("topics/a.md", "here\n"); remote.set("topics/b.md", "there\n");
  let did = await syncOnce({ local, remote, state, now:at });
  assert.deepEqual([did.pulled, did.pushed, did.stale], [1, 1, false]);
  assert.equal(local.text("topics/b.md"), "there\n");
  assert.equal(remote.text("topics/a.md"), "here\n");
  did = await syncOnce({ local, remote, state, now:at });
  assert.deepEqual([did.pulled, did.pushed, did.merged, did.trashed, did.removed], [0, 0, 0, 0, 0]);
  remote.drop("topics/a.md"); local.files.delete("topics/b.md");
  did = await syncOnce({ local, remote, state, now:at });
  assert.deepEqual([did.trashed, did.removed], [1, 1]);
  assert.deepEqual(local.aside, [".trash/topics/a.md"]);
  assert.equal(remote.text("topics/b.md"), null);
  assert.deepEqual(state.base, {});
});

test("a round: Cloud losing much of a project puts nothing aside here; this computer's files are sent again", async () => {
  const local = side(), remote = cloud(), state = agreed();
  for (let i = 1; i <= 12; i++) local.set(`topics/line-${i}.md`, `line ${i}\n`);
  let did = await syncOnce({ local, remote, state, now:at });
  assert.deepEqual([did.pushed, did.trashed], [12, 0]);
  // Cloud's copy is emptied behind our back (made again, or cleared): it says all twelve are gone.
  for (let i = 1; i <= 12; i++) remote.drop(`topics/line-${i}.md`);
  did = await syncOnce({ local, remote, state, now:at });
  assert.deepEqual([did.trashed, did.kept, did.pushed], [0, 12, 12]);
  assert.deepEqual(local.aside, []);
  assert.equal(local.text("topics/line-7.md"), "line 7\n");
  assert.equal(remote.text("topics/line-7.md"), "line 7\n");
  // A few files removed in Cloud are still removed here: five of twelve is past a fifth, so nothing; one of twelve goes to the trash.
  remote.drop("topics/line-1.md");
  did = await syncOnce({ local, remote, state, now:at });
  assert.deepEqual([did.trashed, did.kept], [1, 0]);
  assert.deepEqual(local.aside, [".trash/topics/line-1.md"]);
});

test("a round: a Line the person deleted, with more files than the brakes let go, is deleted on the other side all at once", async () => {
  const PLAN = ["topics/plan.md", "topics/plan/work-1.md", "topics/plan/work-2.md", "topics/plan/work-3.md", "files/plan/a.txt", "files/plan/b.txt"];
  const fresh = async () => {
    const local = side(), remote = cloud(), state = agreed();
    for (const rel of PLAN) local.set(rel, `${rel}\n`);
    for (let i = 0; i < 6; i++) local.set(`notes/n${i}.md`, `Note ${i}.\n`);
    await syncOnce({ local, remote, state, now:at });
    return { local, remote, state };
  };
  // Deleted here: all six leave Cloud in one round, and none comes back.
  let { local, remote, state } = await fresh();
  for (const rel of PLAN) local.files.delete(rel);
  const here = (rel, agreedList) => rel.includes("plan") && agreedList["topics/plan.md"] ? `.trash/lines/plan-1/${rel}` : "";
  let did = await syncOnce({ local, remote, state, deleted:{ here, there:async () => [] }, now:at });
  assert.deepEqual([did.removed, did.restored, did.pulled], [6, 0, 0]);
  assert.deepEqual(PLAN.filter(rel => remote.files.has(rel)), []);
  // Without saying so, the same is taken for a folder gone wrong, as before.
  ({ local, remote, state } = await fresh());
  for (const rel of PLAN) local.files.delete(rel);
  did = await syncOnce({ local, remote, state, now:at });
  assert.deepEqual([did.removed, did.restored], [0, 6]);
  // Deleted in Cloud: the caller put the Line aside itself, so nothing is sent back and nothing is agreed on it.
  ({ local, remote, state } = await fresh());
  for (const rel of PLAN) remote.drop(rel);
  let asked = null;
  const there = async (paths, mine) => { asked = [paths.length, Object.keys(mine).length]; for (const rel of PLAN) local.files.delete(rel); return paths; };
  did = await syncOnce({ local, remote, state, deleted:{ here:() => "", there }, now:at });
  assert.deepEqual(asked, [6, 12]);
  assert.deepEqual([did.trashed, did.kept, did.pushed], [6, 0, 0]);
  assert.deepEqual(PLAN.filter(rel => remote.files.has(rel) || state.base[rel]), []);
  // Changed in Cloud before the deletion reached it: Cloud's version goes where the deleted Line is, and leaves Cloud with the rest.
  ({ local, remote, state } = await fresh());
  remote.set("topics/plan.md", "topics/plan.md\nAn Ask from the phone.\n");
  remote.set("topics/plan/work-4.md", "new work\n");
  for (const rel of PLAN) local.files.delete(rel);
  did = await syncOnce({ local, remote, state, deleted:{ here, there:async () => [] }, now:at });
  assert.deepEqual([did.pulled, did.removed, did.restored], [2, 7, 0]);
  assert.equal(local.text(".trash/lines/plan-1/topics/plan.md"), "topics/plan.md\nAn Ask from the phone.\n");
  assert.equal(local.text(".trash/lines/plan-1/topics/plan/work-4.md"), "new work\n");
  assert.equal(local.text("topics/plan.md"), null);
  assert.deepEqual([...remote.files.keys()].filter(rel => rel.includes("plan")), []);
  // Once the deletion reached Cloud, the Line in Cloud again (restored elsewhere) comes back here.
  remote.set("topics/plan.md", "restored\n");
  did = await syncOnce({ local, remote, state, deleted:{ here, there:async () => [] }, now:at });
  assert.deepEqual([did.pulled, did.removed], [1, 0]);
  assert.equal(local.text("topics/plan.md"), "restored\n");
});

test("a round: the same line changed on both sides is merged on both; a refused commit is finished by the next round with nothing doubled", async () => {
  const local = side(), remote = cloud(), state = agreed();
  local.set("topics/dark.md", LINE);
  await syncOnce({ local, remote, state, now:at });
  local.set("topics/dark.md", LINE + ask("2026-11-10 09:30", "Mine."));
  remote.set("topics/dark.md", LINE + ask("2026-11-10 09:10", "Theirs."));
  remote.refuseOnce();
  let did = await syncOnce({ local, remote, state, now:at });
  assert.deepEqual([did.merged, did.stale], [1, true]);
  assert.match(local.text("topics/dark.md"), /Theirs\.[\s\S]*Mine\./);
  assert.doesNotMatch(remote.text("topics/dark.md"), /Mine\./, "the refused commit wrote nothing");
  did = await syncOnce({ local, remote, state, now:at });
  assert.equal(did.stale, false);
  assert.equal(remote.text("topics/dark.md"), local.text("topics/dark.md"));
  assert.equal(local.text("topics/dark.md").match(/Theirs\./g).length, 1);
  assert.equal(local.text("topics/dark.md").match(/Mine\./g).length, 1);
  did = await syncOnce({ local, remote, state, now:at });
  assert.deepEqual([did.pulled, did.pushed, did.merged], [0, 0, 0]);
});

test("two versions that cannot be merged: this computer's goes to Cloud, Cloud's is kept in .history/, nobody is asked (PE-578)", async () => {
  const local = side(), remote = cloud(), state = agreed();
  local.set("topics/n.md", LINE); local.set("MEMORY.md", "a\n");
  await syncOnce({ local, remote, state, now:at });
  const mine = LINE.replace("Add a dark mode.", "Mine."), theirs = LINE.replace("Add a dark mode.", "Theirs.");
  local.set("topics/n.md", mine); remote.set("topics/n.md", theirs);
  local.set("MEMORY.md", "a\nb\n");
  let did = await syncOnce({ local, remote, state, now:at });
  const kept = ".history/cloud-20261110-093000/topics/n.md";
  assert.deepEqual(did.localWon.map(w => [w.path, w.keptAt]), [["topics/n.md", kept]]);
  assert.deepEqual([did.conflicts.length, state.conflicts.length], [0, 0], "nothing waits for a choice");
  // The clashing piece is ours (a merged line file ends in one newline, as every merge writes it).
  assert.equal(local.text("topics/n.md"), mine.replace(/\n+$/, "\n"));
  assert.equal(local.text(kept), theirs, "Cloud's version is not lost");
  assert.equal(remote.text("topics/n.md"), local.text("topics/n.md"), "local first");
  assert.equal(remote.text("MEMORY.md"), "a\nb\n", "everything else still syncs");
  assert.equal(remote.text(kept), null, ".history/ is never synced");
  did = await syncOnce({ local, remote, state, now:at });
  assert.deepEqual([did.pulled, did.pushed, did.merged, did.localWon.length], [0, 0, 0, 0]);
  // Only the clashing stretch is ours: Cloud's change elsewhere in the same file still comes in.
  local.set("MEMORY.md", "top: mine\nmiddle\nend\n");
  await syncOnce({ local, remote, state, now:at });
  local.set("MEMORY.md", "top: here\nmiddle\nend\n"); remote.set("MEMORY.md", "top: there\nmiddle\nend: there\n");
  did = await syncOnce({ local, remote, state, now:at });
  assert.deepEqual(did.localWon.map(w => w.path), ["MEMORY.md"]);
  assert.equal(local.text("MEMORY.md"), "top: here\nmiddle\nend: there\n");
  assert.equal(remote.text("MEMORY.md"), "top: here\nmiddle\nend: there\n");
  assert.ok(local.aside.includes(".history/MEMORY.md"), "ours before the merge is kept too");
  // A refused commit: the next round sends ours again, and does not keep Cloud's twice.
  local.set("topics/n.md", LINE.replace("Add a dark mode.", "Mine again.")); remote.set("topics/n.md", LINE.replace("Add a dark mode.", "Theirs again."));
  remote.refuseOnce();
  did = await syncOnce({ local, remote, state, now:at });
  assert.deepEqual([did.stale, did.localWon.length], [true, 1]);
  did = await syncOnce({ local, remote, state, now:at });
  assert.deepEqual([did.pushed, did.localWon.length], [1, 0]);
  assert.match(remote.text("topics/n.md"), /Mine again\./);
});

test("two versions an older PenEcho kept waiting are settled as this computer's by the next round", async () => {
  const local = side(), remote = cloud(), state = agreed();
  local.set("topics/n.md", LINE);
  await syncOnce({ local, remote, state, now:at });
  const mine = LINE.replace("Add a dark mode.", "Mine."), theirs = LINE.replace("Add a dark mode.", "Theirs.");
  const copy = "topics/n.cloud-20261110-093000.md";
  local.set("topics/n.md", mine); local.set(copy, theirs); remote.set("topics/n.md", theirs);
  await state.keep(sha(Buffer.from(theirs)), Buffer.from(theirs));
  state.conflicts = [{ path:"topics/n.md", otherPath:copy, theirs:sha(Buffer.from(theirs)), at:"2026-11-10T09:30:00Z" }];
  const did = await syncOnce({ local, remote, state, now:at });
  assert.deepEqual([did.settled, did.pushed, state.conflicts.length], [1, 1, 0]);
  assert.equal(remote.text("topics/n.md"), mine);
  assert.equal(local.text(copy), null);
  assert.ok(local.aside.includes(`.trash/${copy}`), "the other copy goes to .trash, not away");
});

test("a choice an older page still sends ends where it should", async () => {
  for (const keep of ["mine", "theirs", "both"]) {
    const local = side(), remote = cloud(), state = agreed();
    local.set("topics/n.md", LINE);
    await syncOnce({ local, remote, state, now:at });
    const mine = LINE.replace("Add a dark mode.", "Mine."), theirs = LINE.replace("Add a dark mode.", "Theirs.");
    const copy = "topics/n.cloud-20261110-093000.md";
    local.set("topics/n.md", mine); local.set(copy, theirs); remote.set("topics/n.md", theirs);
    state.conflicts = [{ path:"topics/n.md", otherPath:copy, theirs:sha(Buffer.from(theirs)), at:"2026-11-10T09:30:00Z" }];
    const result = await settle({ local, state, path:"topics/n.md", keep });
    assert.equal(state.conflicts.length, 0);
    await syncOnce({ local, remote, state, now:at });
    if (keep === "mine") { assert.equal(remote.text("topics/n.md"), mine); assert.equal(local.text(copy), null); }
    if (keep === "theirs") { assert.equal(local.text("topics/n.md"), theirs); assert.equal(remote.text("topics/n.md"), theirs); assert.ok(local.aside.includes(".history/topics/n.md")); }
    if (keep === "both") { assert.equal(result.kept, "topics/n-2.md"); assert.equal(remote.text("topics/n.md"), mine); assert.equal(remote.text("topics/n-2.md"), theirs); assert.equal(local.text(copy), null); }
    const last = await syncOnce({ local, remote, state, now:at });
    assert.deepEqual([last.pulled, last.pushed, last.merged, last.localWon.length], [0, 0, 0, 0]);
  }
});

test("an Ask added at the end of a line on each side: the old last piece gains a blank line on both, and both Asks still stay", () => {
  const { mergeLineFile } = require("../src/server/project-lines/sync/merge.js");
  const line = asks => `---\nid: T-1\nstatus: done\n---\n\n# Menu\n\n${asks.map(([when, words]) => `## Ask · ${when}\n\n${words}\n`).join("\n")}`;
  const base = line([["2026-11-10 09:00", "Plan the menu."]]);
  const merged = mergeLineFile(base, line([["2026-11-10 09:00", "Plan the menu."], ["2026-11-10 10:30", "Add a dessert."]]), line([["2026-11-10 09:00", "Plan the menu."], ["2026-11-10 10:10", "No nuts, please."]]));
  assert.equal(merged.clean, true);
  assert.equal(merged.text, line([["2026-11-10 09:00", "Plan the menu."], ["2026-11-10 10:10", "No nuts, please."], ["2026-11-10 10:30", "Add a dessert."]]));
});

test("PE-585: skipped paths preserve old conflicts, side copies and baseline while unrelated conflicts settle", async () => {
  const local = side(), remote = cloud(), state = agreed();
  for (const name of ["large", "normal"]) {
    local.set(`files/${name}.bin`, "local"); remote.set(`files/${name}.bin`, "remote");
    local.set(`files/${name}.cloud-20261110-093000.bin`, "remote side copy");
    state.base[`files/${name}.bin`] = "original-base";
    state.conflicts.push({ path:`files/${name}.bin`, otherPath:`files/${name}.cloud-20261110-093000.bin`, theirs:sha(Buffer.from("remote")), at:at().toISOString() });
  }
  const list = local.list;
  local.list = async () => ({ ...await list(), "files/large.bin":{ size:237 * 1048576, skipped:"too_large" } });
  const did = await syncOnce({ local, remote, state, now:at });
  assert.equal(did.settled, 1);
  assert.equal(state.base["files/large.bin"], "original-base");
  assert.equal(state.conflicts.length, 1);
  assert.equal(state.conflicts[0].path, "files/large.bin");
  assert.equal(local.text("files/large.cloud-20261110-093000.bin"), "remote side copy");
  assert.equal(remote.text("files/large.bin"), "remote");
  assert.equal(local.text("files/large.bin"), "local");
  assert.equal(remote.text("files/normal.bin"), "local");
  assert.equal(local.text("files/normal.cloud-20261110-093000.bin"), null);
});
