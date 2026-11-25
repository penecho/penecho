"use strict";
// Joining two versions of one file that both started from the same copy.
//
// A project kept in PenEcho Cloud can change on this computer and in Cloud between two rounds of sync. The owner's rule:
// merge; when that cannot be done, local first, without asking (PE-578): a clash keeps this computer's stretch (engine.js).
// This file is the "merge" half and writes nothing.
//
//   merge3        the engine: any two lists against the list they both came from
//   mergeText     a text file, line by line (MEMORY.md, a work's detail file, a note)
//   mergeLineFile a line's own Markdown file, piece by piece, so two Asks added on two sides both stay, in time order
//   mergeFile     picks one of them by the file's path; null when a file of that kind cannot be merged here
//
// What counts as a clash: both sides changed or removed the same stretch of the old copy, differently.
// What does not: both sides ADDED something at the same spot. For a list of lines or of Asks that is two additions, and both are kept.
const { diffArrays } = require("diff");

const same = (a, b) => a.length === b.length && a.every((item, index) => item === b[index]);

// What one side did, as replacements of stretches of the old copy: [{ from, to, items }].
function changes(base, side) {
  const out = [];
  let at = 0, open = null;
  for (const part of diffArrays(base, side)) {
    if (!part.added && !part.removed) { at += part.value.length; open = null; continue; }
    if (!open) { open = { from:at, to:at, items:[] }; out.push(open); }
    if (part.removed) { open.to += part.value.length; at += part.value.length; }
    else open.items.push(...part.value);
  }
  return out;
}

// One side's version of the old copy's stretch [from, to).
function sideOf(base, list, from, to) {
  const out = [];
  let at = from;
  for (const change of list) { out.push(...base.slice(at, change.from), ...change.items); at = change.to; }
  out.push(...base.slice(at, to));
  return out;
}

// `both({ was, mine, theirs })` is asked whenever the two sides touched the same stretch differently.
// It returns the items to keep, or nothing for a clash. A clash keeps `mine` in place and is listed in `conflicts`.
function merge3(base, mine, theirs, { both = null } = {}) {
  const A = changes(base, mine), B = changes(base, theirs), out = [], conflicts = [];
  let i = 0, j = 0, at = 0;
  while (i < A.length || j < B.length) {
    const from = Math.min(A[i] ? A[i].from : Infinity, B[j] ? B[j].from : Infinity);
    let to = from;
    const a = [], b = [];
    for (;;) {
      // A change belongs to this stretch when it starts inside it, or at its very start (two additions at one spot).
      const touches = change => change && (change.from < to || change.from === from);
      if (touches(A[i])) { to = Math.max(to, A[i].to); a.push(A[i++]); }
      else if (touches(B[j])) { to = Math.max(to, B[j].to); b.push(B[j++]); }
      else break;
    }
    out.push(...base.slice(at, from));
    const was = base.slice(from, to), m = sideOf(base, a, from, to), t = sideOf(base, b, from, to);
    if (!b.length || same(m, t)) out.push(...m);
    else if (!a.length) out.push(...t);
    else {
      const settled = both ? both({ was, mine:m, theirs:t }) : null;
      if (settled) out.push(...settled);
      else { conflicts.push({ at:out.length, was, mine:m, theirs:t }); out.push(...m); }
    }
    at = to;
  }
  out.push(...base.slice(at));
  return { items:out, conflicts };
}

const lines = text => text ? text.split(/(?<=\n)/) : [];
const closed = list => list.length && !list[list.length - 1].endsWith("\n") ? [...list.slice(0, -1), `${list[list.length - 1]}\n`] : list;

// Lines added by both sides at one spot are both kept, mine first.
function mergeText(base, mine, theirs) {
  if (mine === theirs || theirs === base) return { text:mine, clean:true };
  if (mine === base) return { text:theirs, clean:true };
  const merged = merge3(lines(base), lines(mine), lines(theirs), { both:({ was, mine:m, theirs:t }) => was.length ? null : [...closed(m), ...t] });
  return { text:merged.items.join(""), clean:merged.conflicts.length === 0 };
}

// ---------- A line's file ----------
// ---                         front matter: one fact a row (status, who, finished…). PenEcho rewrites these.
// # Title, the status block   the head. PenEcho rewrites the status block.
// ## Ask · 2026-11-09 02:26   then one piece per "## " heading: an Ask, a note, a Work, an answer.
function pieces(text) {
  const front = /^---\n([\s\S]*?)\n---\n/.exec(text);
  const rest = front ? text.slice(front[0].length) : text;
  const cut = rest.search(/^## /m);
  // Each piece ends with one blank line. The last piece of a file has none, and gains one the moment anything is added after it:
  // on both sides at once that would read as one piece changed two ways, and two Asks added on two sides could not be joined.
  return { front:front ? front[1].split("\n") : null, head:cut < 0 ? rest : rest.slice(0, cut), blocks:cut < 0 ? [] : rest.slice(cut).split(/(?=^## )/m).map(apart) };
}

// The rows PenEcho keeps are not the user's words: where both sides changed one, the newer file's row is taken.
function mergeFront(base, mine, theirs, mineNewer) {
  const flat = list => list.every(row => /^[A-Za-z][\w-]*:/.test(row));
  if (!flat(mine) || !flat(theirs) || !flat(base)) {
    const merged = mergeText(base.join("\n"), mine.join("\n"), theirs.join("\n"));
    return merged.clean ? merged.text.split("\n") : mineNewer ? mine : theirs;
  }
  const key = row => row.slice(0, row.indexOf(":"));
  const rows = list => new Map(list.map(row => [key(row), row]));
  const B = rows(base), M = rows(mine), T = rows(theirs), out = [];
  for (const name of new Set([...M.keys(), ...T.keys(), ...B.keys()])) {
    const was = B.get(name), m = M.get(name), t = T.get(name);
    const row = m === t || t === was ? m : m === was ? t : mineNewer ? m : t;
    if (row !== undefined) out.push(row);
  }
  return out;
}

// When a piece was written: the date in its heading. A Work or an answer has none and stays with the Ask before it.
const stamp = block => { const found = /^## [^\n]*?(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/.exec(block); return found ? `${found[1]} ${found[2] || "00:00"}` : null; };
function runs(blocks) {
  const out = [];
  for (const block of blocks) { const at = stamp(block); if (at || !out.length) out.push({ at, blocks:[block] }); else out[out.length - 1].blocks.push(block); }
  return out;
}
// Appending a section may add several blank lines after the previous one.
// They are separators, not edits to that section that should hide new Asks.
const apart = block => `${block.replace(/\n*$/, "")}\n\n`;
function inTime(mine, theirs) {
  const a = runs(mine), b = runs(theirs), out = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    const theirsFirst = i >= a.length || (j < b.length && a[i].at && b[j].at && b[j].at < a[i].at);
    out.push(...(theirsFirst ? b[j++] : a[i++]).blocks.map(apart));
  }
  return out;
}

// `mineNewer`: whether this computer's copy was saved later than Cloud's. It only settles rows and the head PenEcho keeps itself.
function mergeLineFile(base, mine, theirs, { mineNewer = true } = {}) {
  if (mine === theirs || theirs === base) return { text:mine, clean:true };
  if (mine === base) return { text:theirs, clean:true };
  const B = pieces(base), M = pieces(mine), T = pieces(theirs);
  const front = M.front && T.front ? mergeFront(B.front || [], M.front, T.front, mineNewer) : (mineNewer ? M.front : T.front) || M.front || T.front;
  const head = mergeText(B.head, M.head, T.head);
  const body = merge3(B.blocks, M.blocks, T.blocks, { both({ was, mine:m, theirs:t }) {
    if (!was.length) return inTime(m, t);
    // One piece edited on both sides: try again inside it, line by line.
    if (was.length === 1 && m.length === 1 && t.length === 1) { const inner = mergeText(was[0], m[0], t[0]); return inner.clean ? [inner.text] : null; }
    return null;
  } });
  const text = `${front ? `---\n${front.join("\n")}\n---\n` : ""}${head.clean ? head.text : mineNewer ? M.head : T.head}${body.items.join("")}`.replace(/\n{2,}$/, "\n");
  return { text, clean:body.conflicts.length === 0 };
}

// Which files can be merged here, by where they are in the project's documents folder.
const kindOf = path => /^topics\/[^/]+\.md$/i.test(path) ? "line" : /\.(md|markdown|txt)$/i.test(path) ? "text" : /\.penecho\.json$/i.test(path) ? "canvas" : null;

// Returns { text, clean }, or null when the file is of a kind this cannot merge (a Canvas is merged by canvas-file.js; anything else is kept twice).
function mergeFile(path, base, mine, theirs, options = {}) {
  const kind = kindOf(path);
  if (kind === "line") return mergeLineFile(base, mine, theirs, options);
  if (kind === "text") return mergeText(base, mine, theirs);
  return null;
}

module.exports = { merge3, mergeText, mergeLineFile, mergeFile, kindOf };
