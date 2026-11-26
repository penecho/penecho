"use strict";
const fs = require("node:fs");
const F = require("./format.js");
const STATUS = require("../../../public/lines/line-status.js");

// Find: the words on every line, as plain text. Your Asks and notes, each Work's result, and what the
// agents said while they worked. Nothing is indexed and no model is asked: a few hundred files are read
// in milliseconds, and the same letters are found in English and Chinese alike.
const HITS_PER_LINE = 12, LINES = 60, SNIPPET = 220, MAX_WORDS = 8;
const YOURS = new Set(["ask", "note", "canvas"]);

// A file is read again only when it has changed.
const files = new Map();
function readIfChanged(file, parse) {
  let stat;
  try { stat = fs.statSync(file); } catch { files.delete(file); return null; }
  const known = files.get(file);
  if (known && known.mtime === stat.mtimeMs && known.size === stat.size) return known.value;
  let value;
  try { value = parse(fs.readFileSync(file, "utf8")); } catch { return null; }
  files.set(file, { mtime:stat.mtimeMs, size:stat.size, value });
  return value;
}

// What apps wrap around a pasted message is not what you wrote, and Markdown marks are not words.
const askWords = STATUS.askOnly;
const plain = text => String(text || "").replace(/<!--[\s\S]*?-->/g, " ").replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\*\*|__|`/g, "").replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, "").replace(/\s+/g, " ").trim();

// What an agent said while it worked, by the Work it said it in.
const saidIn = raw => {
  const byStep = new Map();
  for (const line of raw.split("\n")) {
    if (!line.includes('"kind":"say"')) continue;
    let row; try { row = JSON.parse(line); } catch { continue; }
    if (row.kind !== "say" || !row.step || !row.text) continue;
    if (!byStep.has(row.step)) byStep.set(row.step, []);
    const list = byStep.get(row.step), text = plain(row.text);
    // A row is written again each time it changes. The latest version is enough.
    if (list[list.length - 1]?.i === row.i) list[list.length - 1] = { i:row.i, text }; else list.push({ i:row.i, text });
  }
  return new Map([...byStep].map(([step, list]) => [step, list.map(x => x.text)]));
};

// A step's own words, worked out once: a line's file is read again only when it changes.
const ownWords = new WeakMap();
function wordsIn(s) { let text = ownWords.get(s); if (text === undefined) ownWords.set(s, text = plain(askWords(s.text))); return text; }
// One record for each thing on a line that holds words.
function recordsOf(store, activity, project, topics = null) {
  const out = [];
  for (const t of topics || store.scan(project).topics) {
    const said = activity ? readIfChanged(activity.fileOf(project, t.slug), saidIn) || new Map() : new Map();
    for (const s of t.doc.steps) {
      if (YOURS.has(s.kind)) {
        const text = wordsIn(s);
        if (text) out.push({ slug:t.slug, title:t.title, kind:s.kind, step:s.id, label:s.label, who:"you", when:s.when || "", text, said:[] });
        continue;
      }
      if (s.kind === "merge" || s.kind === "deliver") continue;
      const detail = F.detailPath(t.slug, s.id), file = store.exists(project, detail) ? store.resolve(project, detail) : null;
      const info = file ? readIfChanged(file, raw => ({ front:F.splitFront(raw).front, result:plain(F.resultOf(F.sectionText(raw, "Result")).text) })) : null;
      out.push({ slug:t.slug, title:t.title, kind:"work", step:s.id, label:s.label, who:s.who || "", when:info?.front.started || s.when || "", text:info?.result || plain(s.text), said:said.get(s.id) || [] });
    }
  }
  return out;
}

function lineMetaOf(topics) {
  const map = new Map();
  for (const t of topics) {
    const front = t.doc.front || {};
    const code = String(front.id || "").trim();
    const orchestratedBy = String(front["orchestrated by"] || "").trim();
    const steps = t.doc.steps || [];
    const firstYours = steps.find(s => YOURS.has(s.kind) && wordsIn(s));
    const firstWork = steps.find(s => s.kind !== "merge" && s.kind !== "deliver" && !YOURS.has(s.kind));
    const first = firstYours || firstWork || null;
    const preview = firstYours ? wordsIn(firstYours) : plain(t.title || "");
    const when = first?.when || front.created || "";
    map.set(t.slug, { slug:t.slug, title:t.title, code, orchestratedBy, first, preview, when });
  }
  return map;
}

// In a sentence, words like "what" and "did" find everything, so they are left out.
const STOP = new Set("a about all also an and any are as at be but by can could did do does for from had has have how i if in is it its me my of on or our should so than that the their them then there these they this to us was we were what when where which who why will with would you your".split(" "));
function wordsOf(query) {
  const all = [...new Set(String(query || "").toLowerCase().split(/\s+/).map(w => w.replace(/^["'“‘(（]+|[?？!！.,，。;；:："'”’)）]+$/g, "")).filter(Boolean))];
  const kept = all.length > 2 ? all.filter(w => !STOP.has(w)) : all;
  return (kept.length ? kept : all).slice(0, MAX_WORDS);
}
// A few words are found together. A whole sentence finds what holds most of it.
const needed = words => words.length <= 2 ? words.length : Math.ceil(words.length / 2);
function snippet(text, words) {
  const low = text.toLowerCase(), at = Math.min(...words.map(w => { const i = low.indexOf(w); return i < 0 ? Infinity : i; }));
  let start = at === Infinity || at < 60 ? 0 : at - 60;
  if (start) { const space = text.lastIndexOf(" ", start + 20); start = space > start - 30 && space > 0 ? space + 1 : start; }
  const end = start + SNIPPET;
  return `${start ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

function find(store, activity, project, query, options = {}) {
  const tab = ["yours", "work"].includes(options.tab) ? options.tab : "all", status = Object.hasOwn(STATUS.filters, options.status) ? options.status : "all";
  const state = options.state || {}, bySlug = new Map([...(state.lines || []), ...(state.landed || []), ...(state.backlog || [])].map(l => [l.id, l]));
  const statusCounts = { all:0, working:0, stopped:0, you:0, todo:0, review:0, send:0 };
  const words = wordsOf(query);
  if (!words.length) return { q:String(query || ""), filterVersion:1, tab, status, statusCounts, words, total:0, yours:0, work:0, lineCount:0, lines:[] };
  const need = needed(words), groups = new Map();
  // A search as you type looks at the folder as the page's own state does (options.topics), not walking it again for each letter.
  const topics = options.topics || store.scan(project).topics, metas = lineMetaOf(topics);
  const idMatchBySlug = new Map();
  for (const [slug, meta] of metas) {
    const codeLow = meta.code.toLowerCase(), byLow = meta.orchestratedBy.toLowerCase();
    const codeWords = codeLow ? words.filter(w => codeLow.includes(w)) : [];
    const byWords = byLow ? words.filter(w => byLow.includes(w)) : [];
    const idWords = [...new Set([...codeWords, ...byWords])];
    if (idWords.length) idMatchBySlug.set(slug, { codeLow, byLow, codeWords, byWords, idWords });
  }
  const groupFor = (slug, title) => {
    if (!groups.has(slug)) {
      const meta = metas.get(slug);
      groups.set(slug, { slug, title, ...(meta?.code ? { code:meta.code } : {}), ...(meta?.orchestratedBy ? { orchestratedBy:meta.orchestratedBy } : {}), hits:[] });
    }
    return groups.get(slug);
  };
  for (const r of recordsOf(store, activity, project, topics)) {
    const own = r.text.toLowerCase(), mine = words.filter(w => own.includes(w));
    // A Work's own result comes first, then what its agent said on the way.
    let text = mine.length ? r.text : "", found = mine;
    if (r.kind === "work") {
      const spoken = r.said.map(x => [x, words.filter(w => x.toLowerCase().includes(w))]).filter(([, m]) => m.length);
      const all = new Set([...mine, ...spoken.flatMap(([, m]) => m)]);
      if (all.size >= need && (!mine.length || mine.length < need)) { const best = spoken.sort((a, b) => b[1].length - a[1].length)[0]; if (best && best[1].length > mine.length) text = best[0]; }
      found = [...all];
    }
    const idMatch = idMatchBySlug.get(r.slug);
    if (idMatch && found.length) found = [...new Set([...found, ...idMatch.idWords])];
    if (found.length < need || !text) continue;
    groupFor(r.slug, r.title).hits.push({ kind:r.kind, step:r.step, label:r.label, who:r.who, when:r.when, score:found.length, snippet:snippet(text, words), said:text !== r.text });
  }
  for (const [slug, idMatch] of idMatchBySlug) {
    const meta = metas.get(slug), titleLow = String(meta.title || "").toLowerCase();
    const titleWords = titleLow ? words.filter(w => titleLow.includes(w)) : [];
    const lineFound = [...new Set([...idMatch.idWords, ...titleWords])];
    if (lineFound.length < need) continue;
    const boost = idMatch.codeLow && words.includes(idMatch.codeLow) ? 2 : (idMatch.codeWords.length || (idMatch.byLow && words.includes(idMatch.byLow))) ? 1 : 0.5;
    const score = lineFound.length + boost;
    const first = meta.first, isMine = !first || YOURS.has(first.kind);
    const kind = first ? (isMine ? first.kind : "work") : "ask", step = first ? first.id : "";
    const g = groupFor(slug, meta.title);
    const existing = step && g.hits.find(h => h.step === step && h.kind === kind);
    if (existing) { existing.score = Math.max(existing.score, score); continue; }
    const prefix = idMatch.byWords.length && !idMatch.codeWords.length ? (meta.code ? `${meta.code} · from ${meta.orchestratedBy}` : `from ${meta.orchestratedBy}`) : meta.code || meta.orchestratedBy;
    const body = meta.preview || meta.title || "";
    g.hits.push({ kind, step, label:first ? first.label : "Line", who:isMine ? "you" : first.who || "", when:meta.when, score, snippet:snippet(`${prefix}${body ? ` · ${body}` : ""}`, words), said:false });
  }
  const order = (a, b) => b.score - a.score || String(b.when).localeCompare(String(a.when));
  const lines = [];
  let yours = 0, work = 0;
  for (const g of groups.values()) {
    const l = bySlug.get(g.slug), hits = g.hits.filter(h => tab === "all" || (tab === "yours") === YOURS.has(h.kind));
    // Status chips count unique lines for this content tab, across the whole query, before either cap.
    if (hits.length) {
      statusCounts.all++;
      for (const key of Object.keys(STATUS.filters)) if (STATUS.matches(l, key)) statusCounts[key]++;
    }
    if (!STATUS.matches(l, status)) continue;
    for (const h of g.hits) { if (YOURS.has(h.kind)) yours++; else work++; }
    if (hits.length) lines.push({ ...g, count:hits.length, hits:hits.sort(order) });
  }
  lines.sort((a, b) => order(a.hits[0], b.hits[0]));
  return { q:String(query), filterVersion:1, tab, status, statusCounts, words, total:yours + work, yours, work, lineCount:lines.length, lines:lines.slice(0, LINES).map(g => ({ ...g, hits:g.hits.slice(0, HITS_PER_LINE) })) };
}

module.exports = { find, wordsOf, recordsOf };
