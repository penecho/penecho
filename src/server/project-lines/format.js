"use strict";
// The Markdown format of a PenEcho project. Everything here works on plain text,
// so a file edited by hand or by any agent is read the same way as one PenEcho wrote.
const crypto = require("node:crypto");
const path = require("node:path");
const L = require("./layout.js");

const KIND_LABELS = {
  ask:"Ask", note:"Note", canvas:"Canvas", meeting:"Meeting", work:"Work", grill:"Grill me", prototype:"Prototype", review:"Review", "orch-review":"Orchestrator review", merge:"Merge", sketch:"Sketch",
  // Files written before a request became one run can still name these.
  discuss:"Discuss", spec:"Spec", build:"Build", check:"Self-review", read:"Read files", outline:"Outline", slides:"Slides", draft:"Draft", deploy:"Deploy", deliver:"Done",
};
const KIND_BY_LABEL = Object.fromEntries(Object.entries(KIND_LABELS).map(([kind, label]) => [label.toLowerCase(), kind]));
const QUESTIONS = "Questions for you", DECIDED = "Decided by you", HANDOFFS = "Handoffs between agents";
const FINISHED = new Set(["landed", "done", "closed"]);
// Outdated (PE-425): no longer valid, or replaced by newer work. Only an archived line is; its status stays closed or landed, so any reader still sees it archived.
const isOutdated = doc => ["closed", "landed"].includes(doc.status) && /^(?:yes|true)$/i.test(String(doc.front.outdated || ""));
const IMAGE =/\.(png|jpe?g|gif|webp|svg)$/i;

const hashText = text => crypto.createHash("sha256").update(String(text)).digest("hex").slice(0, 16);
function slugify(title, fallback = "topic") {
  const words = String(title).toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter(Boolean).slice(0, 5);
  return words.join("-").slice(0, 60).replace(/-+$/, "") || fallback;
}
// A title comes from the first line that says something (PE-302). A pasted path or link does not, nor a picture; a list's number or
// bullet is skipped ("0. system settings…" is not called "0"), a table row gives its first cell, and a title always holds a letter.
const PICTURE_REF = /!\[[^\]]*\]\([^)]*\)|\[Attached:[^\]]*\]|<img\b[^>]*>/gi, HAS_PICTURE = new RegExp(PICTURE_REF.source, "i");
const LIST_MARK = /^(?:(?:[-*+•▪◦‣]|\[[ xX]\]|\(?\d{1,3}[.)]|\(\d{1,3}\)|[a-z]\))\s+)+/;
const HAS_LETTER = /\p{L}/u;
function titleLine(line) {
  let words = line.trim().replace(PICTURE_REF, " ").trim();
  if (/^(?:[a-z][a-z0-9+.-]*:\/\/|\/|~\/)\S*$/i.test(words)) return "";
  // A table: its separator says nothing; a row says its first cell that has words.
  if (words.startsWith("|")) words = words.split("|").map(cell => cell.trim()).find(cell => HAS_LETTER.test(cell)) || "";
  words = words.replace(/^#+\s+/, "").replace(/^>\s*/, "").replace(LIST_MARK, "").replace(/^\/\w+\s*/, "").replace(/^(please|can you|could you)\s+/i, "").replace(/\*\*|__|`/g, "").trim();
  return HAS_LETTER.test(words) ? words : "";
}
// An Ask that is only a picture is called after the picture, unless its file name says nothing (image.png, a screenshot's stamp, a
// clipboard's number): then "Picture · Nov 12".
const SAYS_NOTHING = /^(?:image|img|photo|picture|pic|screenshot|screen shot|clipboard|codex clipboard|pasted|paste|untitled|file|download|scan)\b|^[\d\s_.:-]+$|^[0-9a-f-]{16,}$/i;
const TITLE_MAX = 120, LEGACY_TITLE_MAX = 56;
function clipTitle(text, max = TITLE_MAX) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 2), byWord = cut.replace(/\s+\S*$/, "");
  return `${byWord.length >= Math.floor(max / 2) ? byWord : cut.trimEnd()}…`;
}
const legacyClipTitle = text => (text.length > LEGACY_TITLE_MAX ? `${text.slice(0, LEGACY_TITLE_MAX - 2).replace(/\s+\S*$/, "")}…` : text);
function pictureTitle(names = [], { at = new Date(), clip = clipTitle } = {}) {
  const named = names.map(name => String(name || "").split(/[\\/]/).pop().replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim())
    .find(name => HAS_LETTER.test(name) && !SAYS_NOTHING.test(name));
  if (named) { const short = clip(named); return short[0].toUpperCase() + short.slice(1); }
  return `Picture · ${at.toLocaleDateString("en", { month:"short", day:"numeric" })}`;
}
const { unwrapReplies, markdownLinks } = require("../../../public/lines/line-status.js");
// What apps put before the person's words: an injected block (<artifact-view-context …>…</artifact-view-context>, <cross-session-message …>),
// a JSON object, "Background (from the session that started this one):". A tag with a dash or an underscore is an app's; <b> is a person's.
const INJECTED_SELF = /^<[a-z][\w]*[-_][\w-]*\b[^>]*\/>\s*/i, INJECTED_BLOCK = /^<([a-z][\w]*[-_][\w-]*)\b[^>]*>[\s\S]*?<\/\1\s*>\s*/i, INJECTED_TAG = /^<\/?[a-z][\w]*[-_][\w-]*\b[^>]*>\s*/i;
const PREAMBLE = /^(?:(?:background|context)\s*\(from the session that started this one\)\s*:?|#{1,3}\s*My request(?: for Codex)?\s*:)\s*/i;
function jsonEnd(text) {
  let depth = 0, quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === "\\") i++; else if (c === '"') quoted = false; continue; }
    if (c === '"') quoted = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") { depth--; if (!depth) return i + 1; }
  }
  return -1;
}
function withoutPreamble(text) {
  const source = unwrapReplies(text);
  let t = source.trim(), before;
  do {
    before = t;
    t = t.replace(INJECTED_SELF, "").replace(INJECTED_BLOCK, "").replace(INJECTED_TAG, "").replace(PREAMBLE, "").trim();
    if (t.startsWith("{")) { const end = jsonEnd(t); if (end > 0) t = t.slice(end).trim(); }
  } while (t !== before);
  // Nothing left but the block: its words, without the tags, are all there is.
  return t || source.replace(/<\/?[a-z][\w]*[-_][\w-]*\b[^>]*>/gi, " ").trim();
}
// A title that is still such a block or preamble was never really named.
const JUNK_TITLE = /^(?:<\/?[a-z][\w]*[-_]|\{|(?:background|context)\s*\(from the session|#{1,3}\s*My request(?: for Codex)?\s*:)/i;
const NEW_TITLE = "New Topic";
function titleFromText(text, { at = new Date(), clip = clipTitle } = {}) {
  const lines = withoutPreamble(text).split(/\n/).filter(line => line.trim());
  const first = lines.map(titleLine).find(Boolean) || "";
  // A sentence ends at a stop followed by a space (so "1.5" or "e.g" stays whole), or at a full-width stop.
  const sentence = first.split(/(?<=[.!?])\s+|(?<=[。！？])/)[0].replace(/[.!?。！？]+$/, "");
  const said = HAS_LETTER.test(sentence) ? sentence : first;
  const short = clip(said);
  if (short) return short[0].toUpperCase() + short.slice(1);
  // Nothing but a picture: called what it is, and when.
  if (HAS_PICTURE.test(String(text))) return pictureTitle([...String(text).matchAll(/\]\(([^)]*)\)|\[Attached:\s*([^\]]*)\]/g)].map(m => m[1] || m[2]), { at, clip });
  return NEW_TITLE;
}
// A note in LaTeX is called by what it says, not by its commands.
const withoutLatex = text => String(text || "").replace(/\\(documentclass|usepackage)(\[[^\]]*\])?\{[^}]*\}|\\(begin|end)\{document\}|\\maketitle\b/g, " ").replace(/\\(LaTeX|TeX)\b(\{\})?/g, "$1").trim();
// What a node would call a Line with no name of its own: its first words, a picture's file or a meeting's title. The one it gets today comes first.
function namesOf(step) {
  if (!step || !YOURS.has(step.kind)) return [];
  if (step.kind === "meeting") return [/^\*\*(.+?)\*\*/.exec(String(step.text || "").trim())?.[1]?.trim()].filter(Boolean);
  const text = step.text || "", pictures = [...(step.pictures || []), ...(step.files || [])].map(link => link.name);
  const names = [step.kind === "note" ? titleFromText(withoutLatex(text)) : titleFromText(text), titleFromText(text), titleFromText(text, { clip:legacyClipTitle }), step.kind === "ask" && pictures.length ? pictureTitle(pictures, { at:new Date(labelTime(step.when) || Date.now()) }) : ""];
  return [...new Set(names)].filter(name => name && name !== NEW_TITLE);
}
// What is left names a Line whose name went with a deleted node (PE-1144), as it would have begun.
const nameLeft = steps => ["ask", "note", "meeting"].map(kind => namesOf(steps.find(s => s.kind === kind))[0]).find(Boolean) || NEW_TITLE;
const setTitle = (md, title) => /^# .+$/m.test(md) ? md.replace(/^# .+$/m, () => `# ${title}`) : md.replace(/^(---\r?\n[\s\S]*?\r?\n---\r?\n)/, front => `${front}\n# ${title}\n`);
// Someone's words can hold a heading of their own. It must not end the section they are in, so it drops one level.
const safeWords = text => String(text).replace(/^( {0,3})##(\s)/gm, "$1###$2");
function nowLabel(at = new Date()) {
  const pad = n => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}
// "2026-11-12 09:30", as PenEcho writes times in a line (local time), to a moment. 0 when it is not one.
function labelTime(label) {
  const m = /^(\d{4})-(\d\d)-(\d\d)(?:[ T](\d\d):(\d\d))?/.exec(String(label || ""));
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)).getTime() : 0;
}
function archiveTime(front, mtime) {
  // A legacy "landed" date records a merge into the Archive. Closed Lines may still have an earlier finish or merge date.
  const stored = front?.["archived at"] || "";
  return (/^\d{4}-\d\d-\d\dT/.test(stored) ? Date.parse(stored) : 0) ||
    (String(front?.status || "").toLowerCase() === "landed" ? labelTime(front.landed) : 0) ||
    (Number.isFinite(mtime) && mtime > 0 ? Math.trunc(mtime) : 0) || labelTime(front?.created);
}

function orchestratorParents(fronts) {
  const byId = new Map(), parents = new Map();
  for (const [slug, front] of fronts) {
    if (front.id) byId.set(front.id, byId.has(front.id) ? "" : slug);
  }
  for (const [slug, front] of fronts) {
    const parent = front["orchestrated by slug"] || byId.get(front["orchestrated by"]);
    if (parent && /^(?:yes|true)$/i.test(String(fronts.get(parent)?.orchestrator || ""))) parents.set(slug, parent);
  }
  return parents;
}

// ---------- Front matter ----------
// YAML 1.2 single-line scalar quoting: quote values that start with a reserved/indicator character
// (such as @ in "@claude"), contain ": " or " #", end with ":", have outer whitespace, or contain control/line chars.
const YAML_UNSAFE_START = /^[,[\]{}#&*!|>'"%@`]|^[-?:](?:\s|$)|^(?:---|\.\.\.)(?:\s|$)/;
const YAML_UNSAFE_BODY = /:(?:\s|$)|\s#|[\r\n\t\x00-\x1f\x7f\u0085\u2028\u2029]|^\s|\s$/;
function formatFrontValue(value) {
  const s = String(value);
  if (!s) return '""';
  if (YAML_UNSAFE_START.test(s) || YAML_UNSAFE_BODY.test(s)) {
    return JSON.stringify(s).replace(/\u0085/g, "\\u0085").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  }
  return s;
}
function formatFrontLine(key, value) {
  return `${key}: ${formatFrontValue(value)}`;
}
function parseFrontValue(raw) {
  const s = String(raw || "").trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    try { return JSON.parse(s); } catch {
      if (/^"(?:[^"\\]|\\.)*"$/.test(s)) return s.slice(1, -1).replace(/\\(["\\])/g, "$1");
      return s;
    }
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}
function splitFront(md) {
  const text = String(md || "");
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { front:{}, order:[], body:text };
  const front = {}, order = [];
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w][\w -]*):\s*(.*)$/);
    if (kv) { front[kv[1]] = parseFrontValue(kv[2]); order.push(kv[1]); }
  }
  return { front, order, body:text.slice(m[0].length) };
}
function setFront(md, patch) {
  const { front, order, body } = splitFront(md);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === "") { delete front[key]; const i = order.indexOf(key); if (i >= 0) order.splice(i, 1); }
    else { if (!(key in front)) order.push(key); front[key] = String(value); }
  }
  const lines = order.map(key => formatFrontLine(key, front[key]));
  return `${lines.length ? `---\n${lines.join("\n")}\n---\n\n` : ""}${body.replace(/^\n+/, "")}`;
}

// ---------- Sections ----------
const RESULT_OPEN = /^\s*<!--\s*result:[^\n]*-->\s*$/;
const RESULT_CLOSE = /^\s*<!--\s*\/result\s*-->\s*$/;
const PENECHO_WRAPPER_LINE = /^\s*<!--\s*(?:result:[^\n]*|\/result|penecho:[^\n]*)\s*-->\s*$/;
const FENCE_OPEN = /^\s*(`{3,}|~{3,})/;
function fenceCloserAfter(lines, start, ch, len) {
  for (let i = start + 1; i < lines.length; i++) {
    const clean = lines[i].replace(/\r$/, ""), m = FENCE_OPEN.exec(clean);
    if (m && m[1][0] === ch && m[1].length >= len && /^\s*$/.test(clean.slice(m[0].length))) return i;
  }
  return -1;
}
function resultCloserAfter(lines, start) {
  let unclosedFallback = -1;
  for (let i = start + 1; i < lines.length; i++) {
    const clean = lines[i].replace(/\r$/, "");
    if (RESULT_CLOSE.test(clean)) return i;
    const fm = FENCE_OPEN.exec(clean);
    if (fm) {
      const close = fenceCloserAfter(lines, i, fm[1][0], fm[1].length);
      if (close > i) {
        if (unclosedFallback < 0) {
          for (let j = i + 1; j < close; j++) {
            if (!RESULT_CLOSE.test(lines[j].replace(/\r$/, ""))) continue;
            let next = j + 1;
            while (next < lines.length && !lines[next].replace(/\r$/, "").trim()) next++;
            if (next >= lines.length || /^## /.test(lines[next].replace(/\r$/, ""))) {
              unclosedFallback = j;
              break;
            }
          }
        }
        i = close;
      }
    }
  }
  return unclosedFallback;
}
const ABOVE_SECTIONS = [QUESTIONS, DECIDED, HANDOFFS, "Parts"];
function scanTopHeadings(md, { recoverUnclosed = false } = {}) {
  const lines = String(md).split("\n"), heads = [], protectedLines = new Set();
  for (let i = 0; i < lines.length; i++) {
    const clean = lines[i].replace(/\r$/, "");
    const fence = FENCE_OPEN.exec(clean);
    if (fence || RESULT_OPEN.test(clean)) {
      const close = fence ? fenceCloserAfter(lines, i, fence[1][0], fence[1].length) : resultCloserAfter(lines, i);
      // A Work detail viewer can recover later report sections from an interrupted write.
      // Line edits always protect unfinished examples through EOF.
      if (close < 0 && recoverUnclosed) continue;
      const end = close < 0 ? lines.length - 1 : close;
      for (; i <= end; i++) protectedLines.add(i);
      i--;
      continue;
    }
    const m = clean.match(STEP_HEAD);
    if (m) heads.push({ kind:"step", at:i, m, name:clean.slice(3).trimEnd() });
    else if (clean.startsWith("## ")) {
      const name = clean.slice(3).trimEnd();
      heads.push({ kind:ABOVE_SECTIONS.includes(name) ? "above" : "other", at:i, name });
    }
  }
  return { lines, heads, protectedLines };
}
function findSections(md, name, source = scanTopHeadings(md)) {
  const { lines, heads, protectedLines } = source;
  return heads.flatMap((head, i) => {
    if (head.name !== name) return [];
    const at = head.at, end = heads[i + 1]?.at ?? lines.length;
    return [{ lines, at, end, protectedLines, text:lines.slice(at + 1, end).join("\n").replace(/\r\n/g, "\n").trim() }];
  });
}
const findSection = (md, name) => findSections(md, name, scanTopHeadings(md, { recoverUnclosed:!ABOVE_SECTIONS.includes(name) }))[0];
const sectionText = (md, name) => findSection(md, name)?.text ?? null;
const allSectionTexts = (md, name, source) => {
  const texts = findSections(md, name, source).map(s => s.text).filter(Boolean);
  return texts.length ? texts.join("\n\n") : null;
};
function setSection(md, name, text, before = []) {
  const cr = /\r\n/.test(md) ? "\r" : "", eol = cr ? "\r\n" : "\n";
  const found = findSection(md, name);
  const block = text == null ? [] : [`## ${name}${cr}`, cr, ...String(text).trim().split(/\r?\n/).map(l => `${l}${cr}`), cr];
  const spliceClean = (lines, start, del, ins) => {
    lines.splice(start, del, ...ins);
    // Collapse consecutive blank lines only at the splice boundaries so blank lines inside code blocks stay intact.
    const trimBoundary = idx => {
      while (idx > 0 && idx < lines.length && !lines[idx].replace(/\r$/, "") && !lines[idx - 1].replace(/\r$/, "")) lines.splice(idx, 1);
    };
    trimBoundary(start + ins.length);
    trimBoundary(start);
    return lines.join("\n");
  };
  if (found) return spliceClean(found.lines, found.at, found.end - found.at, block);
  if (text == null) return md;
  for (const other of before) {
    const hit = findSection(md, other);
    if (hit) return spliceClean(hit.lines, hit.at, 0, block);
  }
  return `${String(md).trimEnd()}${eol}${eol}${block.map(l => l.replace(/\r$/, "")).join(eol)}`;
}

// ---------- One Topic, one file ----------
// A Topic is one Markdown file that reads from top to bottom: what was asked, what was done, what was asked next.
//   ## Ask · 2026-11-06 02:17 · Claude desktop
//   ## [x] Work 1 · @claude · 12 min
//   ## [ ] Work 2 · @claude
// Each piece of work has its own detail file, works/<slug>/work-1.md, so this one stays small enough for any agent to read.
const kindOf = label => KIND_BY_LABEL[String(label).toLowerCase()] || "work";
const normalizeWho = value => String(value || "").replace(/^@/, "").trim().toLowerCase();
// What you put on a line yourself: an Ask for an agent, a note, a drawing. None of them is work, and none has a checkbox.
const YOURS = new Set(["ask", "note", "canvas", "meeting"]);
// A meeting brought in from MeetCue is a note marked as one, so an app that does not know meetings shows it as a note:
//   ## Note · 2026-11-10 10:00 · Meeting
const MEETING_VIA = "Meeting";
const isYours = step => YOURS.has(step?.kind);
const OTHER_LABELS = Object.values(KIND_LABELS).filter(label => !["Ask", "Note", "Canvas", "Work"].includes(label)).join("|");
// A plain "## Review" in someone's notes is only a heading. Anything but Ask, Note, Canvas and Work has to carry a checkbox to count as a step.
const STEP_HEAD = new RegExp(`^## (?:(Ask|Note|Canvas)(?: · (.*?))?|(?:\\[( |x|X)\\] )?(Work)(?: (\\d+))?(?: · (.*?))?|\\[( |x|X)\\] (${OTHER_LABELS})(?: (\\d+))?(?: · (.*?))?)\\s*$`, "i");
const looksLikeTime = token => /^\d{4}-\d{2}-\d{2}\b/.test(token);
// Work you stopped, a stopped Work you discarded, or one that stopped and was carried on under your next Ask, stays on the line greyed out and counts for nothing:
//   ## [x] Work 6 · @claude · stopped
//   ## [x] Work 3 · @codex · 4 min · discarded
//   ## [x] Work 5 · @claude · ended
const OFF = new Set(["stopped", "discarded", "ended"]);
function stepFromHead(m, body) {
  const kind = m[1] ? m[1].toLowerCase() : m[4] ? "work" : kindOf(m[8]), box = m[3] ?? m[7] ?? "", tokens = String(m[2] ?? m[6] ?? m[10] ?? "").split(" · ").map(x => x.trim()).filter(Boolean);
  const step = { kind, num:Number(m[5] || m[9]) || 0, done:YOURS.has(kind) || box.toLowerCase() === "x", who:YOURS.has(kind) ? "you" : "", took:"", when:"", via:"", wait:false, body };
  for (const token of tokens) {
    if (token.startsWith("@")) step.who = normalizeWho(token);
    else if (token.toLowerCase() === "wait") step.wait = true;
    else if (!YOURS.has(kind) && OFF.has(token.toLowerCase())) step.off = token.toLowerCase();
    else if (YOURS.has(kind)) { if (looksLikeTime(token)) step.when = token; else step.via = token; }
    else if (!step.took) step.took = token;
    else step.via = token;
  }
  if (step.kind === "note" && step.via === MEETING_VIA) { step.kind = "meeting"; step.via = ""; }
  if (step.kind === "orch-review") {
    step.reviewOf = String(body || "").split("\n").map(line => line.match(REVIEW_OF)?.[1]).find(Boolean) || "";
  }
  return step;
}
const NUMBERED = new Set(["work"]);
// Numbers stay with their step, so its detail file keeps its name however the file is edited. A step with no number of its own is the
// first of its kind unless an earlier one is: a merged line (P4) whose own "Review" now comes after another line's "Review 2" keeps it.
function numberSteps(steps) {
  const high = {}, taken = {};
  for (const step of steps) {
    if (!step.num) continue;
    (taken[step.kind] ||= new Set()).add(step.num);
    high[step.kind] = Math.max(high[step.kind] || 0, step.num);
  }
  steps.forEach((step, index) => {
    const used = taken[step.kind] ||= new Set(), name = KIND_LABELS[step.kind] || "Work", n = step.num || (used.has(1) ? (high[step.kind] || 0) + 1 : 1);
    used.add(n);
    high[step.kind] = Math.max(high[step.kind] || 0, n);
    step.num = n; step.index = index;
    if (step.kind === "orch-review") {
      if (!step.reviewOf) step.reviewOf = String(step.body || "").split("\n").map(line => line.match(REVIEW_OF)?.[1]).find(Boolean) || "";
      step.label = name;
      step.id = step.reviewOf ? `${step.reviewOf}--review` : (n > 1 ? `orch-review-${n}` : "orch-review");
      return;
    }
    step.label = YOURS.has(step.kind) ? name : NUMBERED.has(step.kind) || n > 1 ? `${name} ${n}` : name;
    step.id = YOURS.has(step.kind) ? `${step.kind}-${n}` : slugify(step.label, step.kind);
  });
  return steps;
}
function isLinkOnly(line) {
  const text = line.trim();
  if (!text.startsWith("[") && !text.startsWith("![")) return false;
  const [link] = markdownLinks(text);
  return Boolean(link && link.start === 0 && link.end === text.length);
}
function linksIn(text) {
  return markdownLinks(text).map(({ image, name, href }) => ({ image, name, href }));
}
// An Ask can refer to something earlier on its line. Each one is a quote on a line of its own under the words, so it reads the same in any Markdown viewer.
const REFERS = /^>\s*Refers to \[([^\]]+)\]\(([^)]+)\)(?::\s*(.*))?$/;
const isReferLine = line => REFERS.test(line);
const refersIn = text => String(text || "").split("\n").map(line => line.match(REFERS)).filter(Boolean).map(m => ({ label:m[1], href:m[2], words:m[3] || "" }));
// An Ask sent beside an open Canvas says which Canvas, on a line of its own, so a later run, a retry and a follow-up still know it:
//   > On the Canvas [Login flow](../files/login-flow/canvas.penecho.json)
const ON_CANVAS = /^>\s*On the Canvas \[([^\]]*)\]\(([^)]+)\)\s*$/;
const isCanvasLine = line => ON_CANVAS.test(line);
// What the person chose to get back, picked in the box, never written as prompt text (PE-404). One line under the words:
//   > Make · Slides · Investor update
const MAKE_KINDS = {
  diagram:{ label:"Diagram", subs:{ auto:"AI picks", architecture:"Architecture", workflow:"Workflow", sequence:"Sequence" } },
  explorer:{ label:"Explorer", subs:{ explain:"Explain", try:"Let me try", prototype:"Prototype" } },
  slides:{ label:"Slides", subs:{ auto:"AI picks", healthcare:"Healthcare report", investor:"Investor update", market:"Market chartbook" } },
  card:{ label:"Note card", subs:{ knowledge:"Knowledge card", flashcards:"Flashcards", work:"Work note" } },
};
const MAKE = /^>\s*Make · ([^·\n]+?)(?: · ([^·\n]+?))?\s*$/;
const isMakeLine = line => MAKE.test(line);
function cleanMake(make) {
  const kind = MAKE_KINDS[make?.kind] ? make.kind : "", subs = kind ? MAKE_KINDS[kind].subs : {};
  return kind ? { kind, sub:Object.hasOwn(subs, make.sub) ? make.sub : Object.keys(subs)[0] } : null;
}
function makeLine(make) {
  const m = cleanMake(make);
  return m ? `> Make · ${MAKE_KINDS[m.kind].label} · ${MAKE_KINDS[m.kind].subs[m.sub]}` : "";
}
function makeOfBody(body) {
  const m = String(body || "").split("\n").map(line => line.match(MAKE)).find(Boolean); if (!m) return null;
  const kind = Object.keys(MAKE_KINDS).find(k => MAKE_KINDS[k].label.toLowerCase() === m[1].trim().toLowerCase()); if (!kind) return null;
  const subs = MAKE_KINDS[kind].subs, sub = Object.keys(subs).find(k => subs[k].toLowerCase() === String(m[2] || "").trim().toLowerCase()) || Object.keys(subs)[0];
  return { kind, sub, label:MAKE_KINDS[kind].label, subLabel:subs[sub] };
}
// The one instruction a choice turns into: exactly one kind of file, so the Canvas makes what was chosen.
function makeSay(make, dir, slideRules, noteContract = "", prototypeRules = "") {
  const m = cleanMake(make); if (!m) return "";
  const where = `in ${dir}`, only = "That is what they chose to get back, so make that and no other kind of picture.";
  if (m.kind === "diagram") return m.sub === "auto"
    ? `They chose a diagram. Write one name.diagram.json ${where}, of whichever type fits best (architecture, workflow or sequence), as the picture formats say. ${only}`
    : `They chose a ${m.sub} diagram. Write one name.diagram.json ${where} with "type":"${m.sub}", as the picture formats say. ${only}`;
  if (m.kind === "explorer") {
    if (m.sub === "prototype") {
      const protoRules = prototypeRules || (typeof slideRules === "string" && /ppt-slides\.md$/.test(slideRules) ? slideRules.replace(/ppt-slides\.md$/, "design-prototype.md") : "");
      const readProto = protoRules ? `Read ${protoRules} first, then write` : "Write";
      return `They chose a clickable prototype. ${readProto} it as one name.explorer.html ${where}, marked with <html data-penecho-prototype> and self-contained with no network requests, that they can click through like the real thing. Say when it is ready and stop, because the person looks at it first. ${only}`;
    }
    return m.sub === "try"
      ? `They chose a Visual Explorer they can try. Write one name.explorer.html ${where}, self-contained with no network requests, with controls (sliders, buttons, inputs) that change what it shows, so they learn by trying. ${only}`
      : `They chose a Visual Explorer that explains it. Write one name.explorer.html ${where}, self-contained with no network requests, that explains it step by step with pictures. ${only}`;
  }
  if (m.kind === "slides") return `They chose slides${m.sub === "auto" ? ", with the template left to you: pick the closest and say which" : ` in the ${m.sub} template`}. Read ${slideRules} first, then write name.slide-01.html, name.slide-02.html, … ${where}. Use only their data. ${only}`;
  const style = m.sub === "work" ? "a work note: one note object with \"style\":\"note\"" : m.sub === "flashcards" ? "flashcards: {\"cards\":[…]} with one note object per card, each with \"style\":\"card\" and a qa block (question and answer)" : "a knowledge card: one note object with \"style\":\"card\"";
  return `They chose ${style}. Write it as one name.note.json ${where}. ${noteContract ? `${noteContract} ` : ""}${only}`;
}
const canvasLine = (title, href) => `> On the Canvas [${String(title || "Canvas").replace(/[\[\]\n]/g, " ").trim() || "Canvas"}](${href})`;
function canvasOfBody(body) {
  const m = String(body || "").split("\n").map(line => line.match(ON_CANVAS)).find(Boolean);
  if (!m || /^[a-z]+:/i.test(m[2])) return null;
  const rel = L.fromLine(m[2]);
  return /^files\/.+\.penecho\.json$/.test(rel) ? { title:m[1], href:m[2], path:rel } : null;
}
// An Ask that went to run and was held back, back as Not sent, with why, so the page can say so and it can go again:
//   > Held · credits · balance 0 · required 40
//   > Held · busy · where penecho.ai · since 2026-11-10T19:20:00.000Z
const HELD = /^>\s*Held · ([a-z]+)((?: · [a-z]+ [^·]+)*)\s*$/;
const isHeldLine = line => HELD.test(line);
function heldLine(held) {
  const { reason, ...rest } = held;
  return `> Held · ${reason}${Object.entries(rest).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => ` · ${k} ${String(v).replace(/[·\n]/g, " ").trim()}`).join("")}`;
}
function heldOfBody(body) {
  const m = String(body || "").split("\n").map(line => line.match(HELD)).find(Boolean);
  if (!m) return null;
  const held = { reason:m[1] };
  for (const part of m[2].split(" · ").slice(1)) { const at = part.indexOf(" "), key = part.slice(0, at), value = part.slice(at + 1).trim(); held[key] = /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value; }
  return held;
}
const withoutHeld = body => String(body || "").split("\n").filter(line => !isHeldLine(line)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
// A step that came from another line when the two were merged (P4; merging lines is gone since PE-459, old merged lines still read) says so, on a line of its own at its end:
//   > From [Login page](login-page.md)
const FROM_LINE = /^>\s*From \[([^\]]*)\]\(([^)/]+)\.md\)\s*$/;
const isFromLine = line => FROM_LINE.test(line);
function fromOfBody(body) {
  const m = String(body || "").split("\n").map(line => line.match(FROM_LINE)).find(Boolean);
  return m ? { title:m[1], slug:m[2] } : null;
}
const TASK_MODE = /^<!-- penecho-task: (new|continue) -->$/;
const DRAFT_ID = /^<!-- penecho-draft: ([A-Za-z0-9-]{1,80}) -->$/;
const REPLACES = /^<!-- penecho-replaces: ([a-z0-9-]+) -->$/;
const IMPORT_EVENT = /^<!-- penecho-import(?:-through)?: [a-f0-9]{64} -->$/;
const MEETING_META = /^<!-- penecho-meeting: ([A-Za-z0-9-]{1,80}) -->$/;
// An Ask whose Work was deleted (PE-1144): no later Work takes it as its own.
const ANSWERED_MARK = "<!-- penecho-answered -->";
const REVIEW_OF = /^<!-- penecho-review-of: ([a-z0-9-]+) -->$/;
const ORCH_REVIEW_DATA = /^<!-- penecho-orch-review: (\{.*\}) -->$/m;
const withoutRefers = text => String(text || "").split("\n").filter(line => !isReferLine(line) && !isCanvasLine(line) && !isMakeLine(line) && !isHeldLine(line) && !isFromLine(line) && !TASK_MODE.test(line) && !DRAFT_ID.test(line) && !REPLACES.test(line) && !IMPORT_EVENT.test(line) && !MEETING_META.test(line) && line !== ANSWERED_MARK && !REVIEW_OF.test(line)).join("\n");
const withoutLinkLines = text => withoutRefers(text).split("\n").filter(line => !isLinkOnly(line)).join("\n").trim();
const firstPara = text => String(text || "").trim().split(/\n\s*\n/)[0].replace(/\s+/g, " ").trim();
function fill(step) {
  step.taskMode = String(step.body || "").split("\n").map(line => line.match(TASK_MODE)?.[1]).find(Boolean) || "";
  step.draftId = String(step.body || "").split("\n").map(line => line.match(DRAFT_ID)?.[1]).find(Boolean) || "";
  step.replaces = String(step.body || "").split("\n").map(line => line.match(REPLACES)?.[1]).find(Boolean) || "";
  step.meetingId = String(step.body || "").split("\n").map(line => line.match(MEETING_META)?.[1]).find(Boolean) || "";
  step.reviewOf = step.reviewOf || String(step.body || "").split("\n").map(line => line.match(REVIEW_OF)?.[1]).find(Boolean) || "";
  step.answered = step.kind === "ask" && String(step.body || "").split("\n").includes(ANSWERED_MARK);
  step.text = withoutLinkLines(step.body);
  step.out = YOURS.has(step.kind) ? "" : firstPara(step.text);
  step.refers = step.kind === "ask" || step.kind === "note" ? refersIn(step.body) : [];
  step.canvas = step.kind === "ask" ? canvasOfBody(step.body) : null;
  step.make = step.kind === "ask" ? makeOfBody(step.body) : null;
  step.held = step.kind === "ask" ? heldOfBody(step.body) : null;
  step.from = fromOfBody(step.body);
  const links = linksIn(withoutRefers(step.body));
  step.pictures = links.filter(link => link.image);
  step.files = links.filter(link => !link.image && !/^details$/i.test(link.name));
  // Where its detail file is, as its own link says: a step merged in from another line keeps the file it had there.
  step.detailHref = links.find(link => !link.image && /^details$/i.test(link.name) && /^[^:]+\.md$/.test(link.href))?.href || "";
  return step;
}
function splitSteps(md, source = scanTopHeadings(md)) {
  const { lines, heads } = source;
  const firstStepIdx = heads.findIndex(h => h.kind === "step");
  if (firstStepIdx < 0) return { before:lines.join("\n"), steps:[] };
  let before = lines.slice(0, heads[firstStepIdx].at).join("\n");
  const steps = [];
  for (let i = firstStepIdx; i < heads.length; i++) {
    const h = heads[i], end = heads[i + 1]?.at ?? lines.length;
    const chunk = lines.slice(h.at, end).join("\n");
    if (h.kind === "step") steps.push(stepFromHead(h.m, lines.slice(h.at + 1, end).join("\n").trim()));
    else if (h.kind === "above") before += "\n" + chunk;
    else steps.at(-1).body += "\n\n" + chunk;
  }
  return { before, steps:numberSteps(steps).map(fill) };
}
function stepLineRange(md, id) {
  const { lines, heads } = scanTopHeadings(md);
  const stepEntries = [];
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i];
    if (h.kind !== "step") continue;
    const end = heads[i + 1]?.at ?? lines.length;
    stepEntries.push({ step:stepFromHead(h.m, lines.slice(h.at + 1, end).join("\n").trim()), startLine:h.at + 1, endLine:end });
  }
  const numbered = numberSteps(stepEntries.map(x => x.step));
  const idx = numbered.findIndex(s => s.id === id);
  if (idx < 0) return null;
  return { step: numbered[idx], startLine: stepEntries[idx].startLine, endLine: stepEntries[idx].endLine };
}
function stepHead(step) {
  if (step.kind === "meeting") return `## Note${step.when ? ` · ${step.when}` : ""} · ${MEETING_VIA}`;
  const name = KIND_LABELS[step.kind] || "Work", number = step.kind === "orch-review" ? "" : NUMBERED.has(step.kind) || step.num > 1 ? ` ${step.num}` : "";
  if (YOURS.has(step.kind)) return `## ${name}${[step.when, step.via].filter(Boolean).map(x => ` · ${x}`).join("")}`;
  return `## [${step.done ? "x" : " "}] ${name}${number}${[step.who && `@${step.who}`, step.took, step.wait ? "wait" : "", step.via, step.off].filter(Boolean).map(x => ` · ${x}`).join("")}`;
}
const renderStep = step => `${stepHead(step)}\n${step.body ? `\n${step.body.trim()}\n` : ""}`;
const renderSteps = steps => numberSteps(steps).map(renderStep).join("\n");
function updateSteps(md, change) {
  const source = scanTopHeadings(md), { before, steps } = splitSteps(md, source);
  const original = renderSteps(steps);
  change(steps);
  // A deleted Work's number is never given to a later one, whose ratings, tokens and sessions are kept under it.
  const lastWork = Number(splitFront(md).front["last work"]) || 0;
  if (lastWork) {
    let high = Math.max(lastWork, ...steps.filter(s => s.kind === "work").map(s => s.num || 0));
    for (const s of steps) if (s.kind === "work" && !s.num) s.num = ++high;
  }
  if (original === renderSteps(steps)) return md;
  const next = `${before.trimEnd()}\n\n${renderSteps(unsentLast(steps))}`;
  const heads = source.heads, first = heads.find(h => h.kind === "step");
  if (!first || !heads.some(h => h.at > first.at && h.kind === "above" && h.name === QUESTIONS)) return next;
  return setAbove(next, QUESTIONS, renderQuestions(parseLine(md).questions));
}
// An Ask that has reached no agent yet says so in its heading, so it reads the same in any Markdown viewer. It waits at the end of the line.
const NOT_SENT = "Not sent";
const isUnsent = step => step?.kind === "ask" && step.via === NOT_SENT;
// A person can certify work completed elsewhere without inventing an agent run.
const FINISHED_ASK = "Finished & reviewed";
const isFinishedAsk = step => step?.kind === "ask" && step.via === FINISHED_ASK;
const isSentAsk = step => step?.kind === "ask" && !isUnsent(step) && !isFinishedAsk(step);
function finishUnsentAsk(md, id) {
  const range = stepLineRange(md, id);
  if (!range || !isUnsent(range.step)) return null;
  const { lines, protectedLines } = scanTopHeadings(md);
  const heading = range.startLine - 1;
  lines[heading] = lines[heading].replace(/ · Not sent(\s*)$/, ` · ${FINISHED_ASK}$1`);
  return lines.filter((line, i) => i <= heading || i >= range.endLine || protectedLines.has(i) || !isHeldLine(line)).join("\n");
}
function unsentLast(steps) {
  const waiting = steps.filter(isUnsent);
  if (!waiting.length) return steps;
  const rest = steps.filter(s => !isUnsent(s)), at = rest.findIndex(s => !s.done && s.kind === "merge");
  rest.splice(at < 0 ? rest.length : at, 0, ...waiting);
  return rest;
}
function removeAllSections(md, name) {
  const hits = findSections(md, name);
  if (!hits.length) return md;
  const { lines, protectedLines } = hits[0];
  for (const { at, end } of hits.reverse()) {
    const kept = lines.slice(at, end).filter((_, i) => protectedLines.has(at + i));
    lines.splice(at, end - at, ...kept);
  }
  return lines.join("\n");
}
function setAbove(md, name, text) {
  const clean = removeAllSections(md, name);
  if (text == null) return clean;
  const eol = md.includes("\r\n") ? "\r\n" : "\n";
  const { lines, heads, protectedLines } = scanTopHeadings(clean);
  const step = heads.find(h => h.kind === "step");
  let at = step?.at ?? lines.length;
  // Insert before a protected tail, which may be an unfinished fence or result.
  while (at > 0 && (protectedLines.has(at - 1) || !lines[at - 1].trim())) at--;
  const block = [`## ${name}`, "", ...String(text).trim().split(/\r?\n/), ""].join(eol);
  const prefix = lines.slice(0, at).join("\n");
  while (at < lines.length && !lines[at].trim() && !protectedLines.has(at)) at++;
  const suffix = lines.slice(at).join("\n");
  return (prefix ? prefix + (prefix.endsWith("\r") ? "\n" : eol) + eol : "") + block + (suffix ? eol + suffix : "");
}
const QUESTION_BOILERPLATE = "Tick one here, in any Markdown editor, or in PenEcho.";
function stripWhoAndBold(s) {
  let out = String(s || "").trim(), who = "";
  const wm = out.match(/^(.*?)\s*\(@([^)]+)\)\s*$/);
  if (wm) { out = wm[1].trim(); who = normalizeWho(wm[2]) || ""; }
  const bm = out.match(/^\*\*(.+?)\*\*\s*$/);
  if (bm) out = bm[1].trim();
  return { text:out, who };
}
function parseQuestions(text, { fallbackText = "", fallbackFrom = "agent", lineOffset = 0, protectedLines = null, defaultWorkId = "" } = {}) {
  const out = [];
  const defaultFrom = normalizeWho(fallbackFrom) || "agent";
  const defaultPrompt = String(fallbackText || "").trim() || "Choose an option";
  let current = null, promptLines = [], promptFrom = "", sawBlank = false, inComment = false, sectionWorkId = "", nextWorkId = "";
  const pushQ = (rawIdKey, qText, from) => {
    const wid = nextWorkId || sectionWorkId || defaultWorkId || "";
    current = { id:hashText(rawIdKey), text:qText.trim(), from:from || defaultFrom, explicitAuthor:from || "", ...(wid ? { workId:wid } : {}), options:[], ticked:null };
    out.push(current);
    promptLines = [];
    promptFrom = "";
    nextWorkId = "";
    sawBlank = false;
  };
  const lines = String(text || "").split("\n");
  const excluded = protectedLines || scanTopHeadings(text || "").protectedLines;
  for (const [index, rawLine] of lines.entries()) {
    if (excluded.has(index + lineOffset)) continue;
    const clean = rawLine.replace(/\r$/, ""), trimmed = clean.trim();
    const identity = trimmed.match(/^<!-- question-id: ([a-f0-9]{16}) -->$/);
    if (identity && current) { current.id = identity[1]; continue; }
    const workTag = trimmed.match(/^<!--\s*work:\s*([a-z0-9-]+)\s*-->$/i);
    if (workTag) {
      const wid = workTag[1].toLowerCase();
      if (current && current.options.length === 0) current.workId = wid;
      else if (!out.length && !current) sectionWorkId = wid;
      else nextWorkId = wid;
      continue;
    }
    if (inComment) { if (clean.includes("-->")) inComment = false; continue; }
    if (/^<!--/.test(trimmed)) { if (!clean.includes("-->")) inComment = true; continue; }
    if (!trimmed) { sawBlank = true; continue; }
    if (trimmed === QUESTION_BOILERPLATE) { sawBlank = true; continue; }

    const opt = trimmed.match(/^(?:[-*]|\d{1,3}[.)])\s+\[( |x|X)\]\s+(.+?)\s*$/);
    if (opt) {
      if (!current || promptLines.length) {
        const joined = promptLines.join(" ").trim();
        const qText = joined || defaultPrompt;
        pushQ(qText, qText, promptFrom);
      }
      current.options.push(opt[2]);
      (current.optionLines ||= []).push(index + lineOffset);
      if (opt[1] !== " ") {
        current.ticked = opt[2];
        (current.checkedOptions ||= []).push(current.options.length - 1);
      }
      sawBlank = false;
      continue;
    }

    const boldQ = trimmed.match(/^\*\*(.+?)\*\*(?:\s*\(@([^)]+)\))?\s*$/);
    if (boldQ) {
      pushQ(boldQ[1], boldQ[1], normalizeWho(boldQ[2]));
      continue;
    }

    const headQ = trimmed.match(/^#{2,6}\s+(.+?)\s*$/);
    if (headQ) {
      const parsed = stripWhoAndBold(headQ[1]);
      if (parsed.text) pushQ(parsed.text, parsed.text, parsed.who);
      continue;
    }

    const numQ = trimmed.match(/^\d{1,3}[.)]\s+(.+?)\s*$/);
    if (numQ) {
      const parsed = stripWhoAndBold(numQ[1]);
      if (parsed.text) pushQ(parsed.text, parsed.text, parsed.who);
      continue;
    }

    if (/^[-*_]{3,}$/.test(trimmed) || /^[-*]\s+/.test(trimmed) || /^>/.test(trimmed)) continue;
    if (current && current.options.length === 0) { sawBlank = false; continue; }
    if (sawBlank && promptLines.length) { promptLines = []; promptFrom = ""; }
    const parsed = stripWhoAndBold(trimmed);
    if (parsed.who) promptFrom = parsed.who;
    if (parsed.text) promptLines.push(parsed.text);
    sawBlank = false;
  }
  return identifyQuestions(out.filter(item => item.options.length));
}
function identifyQuestions(list) {
  const used = new Set();
  for (const q of list) {
    const original = q.id;
    for (let n = 2; used.has(q.id); n++) q.id = hashText(`${original}#${n}`);
    used.add(q.id);
  }
  return list;
}
function renderQuestions(list) {
  if (!list.length) return null;
  return `Tick one here, in any Markdown editor, or in PenEcho.\n\n${list.map(q => {
    const author = q.explicitAuthor ?? q.from;
    const head = `**${q.text}**${author ? ` (@${author})` : ""}`;
    const meta = [
      (q.rawId || q.id) && (q.rawId || q.id) !== hashText(q.text) ? `<!-- question-id: ${q.rawId || q.id} -->` : "",
      (q.workId || q.inlineWorkId) ? `<!-- work: ${q.workId || q.inlineWorkId} -->` : "",
    ].filter(Boolean);
    return `${[head, ...meta].join("\n")}\n\n${q.options.map((o, i) => `- [${(q.checkedOptions ? q.checkedOptions.includes(i) : o === q.ticked) ? "x" : " "}] ${o}`).join("\n")}`;
  }).join("\n\n")}`;
}
function parseDetailQuestions(md, { workId = "", fallbackText = "", fallbackFrom = "agent" } = {}) {
  const { front, body } = splitFront(md);
  const defaultFrom = normalizeWho(front.who) || normalizeWho(fallbackFrom) || "agent";
  const fallbackWhy = String(fallbackText || front.why || "").trim();
  const frontLines = String(md).slice(0, String(md).length - body.length).split("\n").length - 1;
  const source = scanTopHeadings(body);
  const qs = identifyQuestions(findSections(body, QUESTIONS, source).flatMap(({ lines, at, end, protectedLines }) =>
    parseQuestions(lines.slice(at + 1, end).join("\n"), { fallbackText:fallbackWhy, fallbackFrom:defaultFrom, lineOffset:at + 1, protectedLines, defaultWorkId:workId })));
  for (const q of qs) {
    q.optionLines = (q.optionLines || []).map(n => n + frontLines);
    if (workId) q.workId = workId;
    q.source = "work";
  }
  return qs;
}
function setDetailQuestions(md, list) {
  const clean = removeAllSections(md, QUESTIONS).replace(/\n{3,}$/g, "\n");
  if (!list || !list.length) return clean;
  const rendered = renderQuestions(list.map(q => ({ ...q, workId:"" })));
  return rendered ? setSection(clean, QUESTIONS, rendered) : clean;
}
const AGENT_STEPS = new Set(["work", "grill", "prototype", "review", "discuss", "spec", "build", "check", "read", "outline", "slides", "draft", "deploy"]);
const openSteps = steps => steps.filter(s => !s.done && s.kind !== "merge" && s.kind !== "orch-review");
const wantsWork = steps => {
  const rest = steps.filter(s => (s.kind !== "ask" || (isSentAsk(s) && !s.answered)) && s.kind !== "note" && s.kind !== "canvas" && s.kind !== "orch-review" && (s.done || s.kind === "merge"));
  return !openSteps(steps).length && rest[rest.length - 1]?.kind === "ask";
};
function cleanLegacyWhy(why) {
  const text = String(why || "").trim();
  if (!text) return null;
  if (/^not started\.\s*resume\b/i.test(text)) return text.replace(/^not started\.\s*resume\b/i, "Not started. Start");
  if (/^paused by you$/i.test(text)) return "Stopped by you";
  return text;
}
// Shared normalization rule for legacy `status: paused` (used by parseLine, V1 upgrade, and reopen).
function normalizeLegacyStatus({ status, why = "", front = {}, steps = [], questions = [], started = null } = {}) {
  const raw = String(status || "not-started").toLowerCase();
  const cleanWhy = cleanLegacyWhy(why);
  if (raw !== "paused") return { status:raw, why:why ? String(why) : null };
  const open = openSteps(steps);
  if (open.length) {
    const first = open[0];
    if (!AGENT_STEPS.has(first.kind) || first.who === "you") {
      return { status:"waiting", why:cleanWhy || `${first.label} is yours to do` };
    }
  }
  // Pending decisions always take precedence over legacy "Not started" reasons or awaiting first Work.
  if (questions.length) {
    return { status:"waiting", why:cleanWhy && !/^not started\b/i.test(cleanWhy) ? cleanWhy : "Your answer" };
  }
  if (open.length) {
    if (/^not started/i.test(String(why || "")) || started === false) {
      return { status:"not-started", why:cleanWhy };
    }
    return { status:"stopped", why:cleanWhy };
  }
  if (wantsWork(steps)) return { status:"not-started", why:cleanWhy };
  if (steps.some(isUnsent)) return { status:"waiting", why:cleanWhy || NOT_SENT };
  if (front["merge into"]) return { status:"ready", why:`Not merged into ${front["merge into"]} yet` };
  if (!steps.some(s => s.kind === "ask" || AGENT_LIKE(s))) return { status:"notes", why:null };
  return { status:"done", why:null };
}
// A knowledge Topic or the project's understanding may say where it stands, but it is never a Line.
const isLineFront = front => "status" in front && !/^(?:topic|project-understanding)$/i.test(String(front.record_type || "").trim());
// Everything PenEcho needs from a Line's file. Anything without a status is a note.
function parseLine(md) {
  const { front:rawFront, body } = splitFront(md), source = scanTopHeadings(body), { before, steps } = splitSteps(body, source), asks = steps.filter(s => s.kind === "ask");
  const docMeeting = String(rawFront.meeting || "").trim();
  if (docMeeting) steps.forEach(s => { if (s.kind === "meeting" && !s.meetingId) s.meetingId = docMeeting; });
  const fallbackFrom = normalizeWho(rawFront.who)
    || steps.find(s => !s.done && AGENT_STEPS.has(s.kind) && s.who && s.who !== "you")?.who
    || [...steps].reverse().find(s => AGENT_STEPS.has(s.kind) && s.who && s.who !== "you")?.who
    || "agent";
  const frontLines = String(md).slice(0, String(md).length - body.length).split("\n").length - 1;
  const rawStatus = String(rawFront.status || "not-started").toLowerCase();
  const docFinished = FINISHED.has(rawStatus);
  const stepHeads = [];
  for (let i = 0, si = 0; i < source.heads.length; i++) {
    const h = source.heads[i];
    if (h.kind === "step") stepHeads.push({ h, step:steps[si++] });
  }
  const firstStepAt = stepHeads[0]?.h.at ?? Infinity;
  const rawQuestions = findSections(body, QUESTIONS, source).flatMap(({ lines, at, end, protectedLines }) => {
    const parsed = parseQuestions(lines.slice(at + 1, end).join("\n"), { fallbackText:rawFront.why, fallbackFrom, lineOffset:at + 1, protectedLines });
    if (at <= firstStepAt) return parsed;
    const adjacentWork = stepHeads.filter(x => x.h.at < at && AGENT_LIKE(x.step)).map(x => x.step).at(-1) || null;
    if (!adjacentWork) return parsed;
    const worksAfter = stepHeads.filter(x => x.h.at > at && AGENT_LIKE(x.step)).map(x => x.step);
    return parsed.filter(q => {
      if (q.workId) return true;
      const ownerAgent = q.explicitAuthor || adjacentWork.who || "";
      const superseded = docFinished && worksAfter.some(w => w.done && !w.off && (!ownerAgent || w.who === ownerAgent));
      if (superseded) return false;
      if (!q.explicitAuthor || q.explicitAuthor === adjacentWork.who) q.inlineWorkId = adjacentWork.id;
      return true;
    });
  });
  const questions = identifyQuestions(rawQuestions);
  for (const q of questions) q.optionLines = q.optionLines.map(n => n + frontLines);
  const questionRev = hashText(JSON.stringify([rawFront.why || "", steps.find(s => !s.done && s.kind !== "merge")?.id || "", questions.map(({ id, workId, inlineWorkId, text, from, explicitAuthor, options, checkedOptions }) => [id, workId || "", inlineWorkId || "", text, from, explicitAuthor, options, checkedOptions])]));
  const normalized = normalizeLegacyStatus({ status:rawFront.status || "not-started", why:rawFront.why || "", front:rawFront, steps, questions });
  const front = { ...rawFront };
  if (String(rawFront.status || "").toLowerCase() === "paused") {
    if (normalized.why) front.why = normalized.why; else delete front.why;
  }
  const status = normalized.status;
  return {
    front,
    isLine:isLineFront(front),
    title:(before.match(/^# (.+)$/m) || [])[1]?.trim() || front.topic || "",
    status,
    steps, asks, questionRev,
    words:asks[0]?.text ?? null,
    pictures:steps.flatMap(s => s.pictures),
    questions,
    decided:String(allSectionTexts(body, DECIDED, source) || "").split("\n").map(line => line.match(/^\s*[-*]\s+(.+?)\s+\*\*(.+?)\*\*\s*$/)).filter(Boolean).map(m => ({ text:m[1], answer:m[2] })),
    handoffs:String(allSectionTexts(body, HANDOFFS, source) || "").split("\n").map(line => line.match(/^>\s*@(\S+)\s+to\s+@(\S+):\s*(.+)$/)).filter(Boolean).map(m => ({ from:normalizeWho(m[1]), to:normalizeWho(m[2]), text:m[3] })),
    parts:parseParts(allSectionTexts(body, PARTS, source)),
    parent:String(front.parent || "").trim(),
    hasStatus:/<!-- status:/.test(body),
  };
}
const topicFingerprint = doc => ({ asks:doc.asks.filter(isSentAsk).map(a => hashText(a.text)) });
function askStep({ words, refs = [], when = "", via = "", taskMode = "" }) {
  return { kind:"ask", num:0, done:true, who:"you", took:"", when:when || nowLabel(), via, wait:false, body:[safeWords(String(words ?? "").trim()), ...refs, ["new", "continue"].includes(taskMode) ? `<!-- penecho-task: ${taskMode} -->` : ""].filter(Boolean).join("\n\n") };
}
// A note is your words on the line, read by nobody unless you ask. A Canvas is a drawing, kept beside its picture so it opens again as you left it.
function noteStep({ words, refs = [], when = "" }) {
  return { kind:"note", num:0, done:true, who:"you", took:"", when:when || nowLabel(), via:"", wait:false, body:[safeWords(String(words ?? "").trim()), ...refs].filter(Boolean).join("\n\n") };
}
// A meeting: its title, when, how long, its gist, its minutes beside the line, and the pictures of MeetCue's diagrams.
function meetingStep({ title, when = "", length = "", gist = "", minutes, meetingId = "", pictures = [] }) {
  const head = [`**${String(title || "Meeting").replace(/\*/g, "").trim()}**`, when, length].filter(Boolean).join(" · ");
  const meta = /^[A-Za-z0-9-]{1,80}$/.test(String(meetingId || "")) ? `<!-- penecho-meeting: ${meetingId} -->` : "";
  const pics = pictures.map(p => `![${String(p.title || "Diagram").replace(/[\[\]\n]/g, " ").trim()}](${p.picture})`).join("\n");
  return { kind:"meeting", num:0, done:true, who:"you", took:"", when:nowLabel(), via:"", wait:false, body:[head, safeWords(String(gist || "").trim()), `[Minutes](${minutes})`, pics, meta].filter(Boolean).join("\n\n") };
}
function canvasStep({ picture, title = "Drawing", words = "", when = "" }) {
  return { kind:"canvas", num:0, done:true, who:"you", took:"", when:when || nowLabel(), via:"", wait:false, body:[`![${String(title).replace(/[\[\]]/g, "")}](${picture})`, safeWords(String(words ?? "").trim())].filter(Boolean).join("\n\n") };
}
// Your own words and drawings go after everything else that is done, before an Ask still waiting to be sent and a merge still to come.
function addYours(md, step) {
  return updateSteps(md, steps => {
    const at = steps.findIndex(s => isUnsent(s) || (!s.done && s.kind === "merge"));
    steps.splice(at < 0 ? steps.length : at, 0, step);
  });
}
const workStep = ({ kind = "work", who = "", wait = false, done = false, took = "", body = "", replaces = "" } = {}) => ({
  kind, num:0, done, who, took, when:"", via:"", wait,
  body:[String(body || "").trim(), replaces && /^[a-z0-9-]+$/.test(replaces) ? `<!-- penecho-replaces: ${replaces} -->` : ""].filter(Boolean).join("\n\n"),
});
function initialLine({ title, id, status = "not-started", who, branch, base, newBranchFrom, git, area, labels, priority, created, source, code, steps, parent, titleBy }) {
  const meta = [
    formatFrontLine("id", id),
    formatFrontLine("status", status),
    who ? formatFrontLine("who", `@${who}`) : "",
    parent ? formatFrontLine("parent", parent) : "",
    titleBy ? formatFrontLine("title by", titleBy) : "",
    branch ? formatFrontLine("branch", branch) : "",
    base ? formatFrontLine("base", base) : "",
    newBranchFrom ? formatFrontLine("new branch from", newBranchFrom) : "",
    git ? formatFrontLine("git", git) : "",
    area ? formatFrontLine("area", area) : "",
    labels?.length ? formatFrontLine("labels", labels.join(", ")) : "",
    priority ? formatFrontLine("priority", priority) : "",
    created ? formatFrontLine("created", created) : "",
    source ? formatFrontLine("source", source) : "",
    code ? formatFrontLine("code", code) : "",
  ].filter(Boolean).join("\n");
  return `---\n${meta}\n---\n\n# ${title}\n\n${renderSteps(steps)}`;
}
// A note someone handed over keeps all its words, with the request added below them.
function noteToLine(md, { id, status = "not-started", who, branch, base, area, labels, priority, created, source, code, steps, title }) {
  const front = { id, status, who:who ? `@${who}` : null, branch, base, area, labels:labels?.join(", "), priority, created, source, code };
  const body = /^# /m.test(splitFront(md).body) ? md : `# ${title}\n\n${md}`;
  return `${setFront(body, front).trimEnd()}\n\n${renderSteps(steps)}`;
}
// Words said while the agent is busy wait right after its work. Otherwise they go before the work that is about to start, so that work answers them too.
function insertAsk(md, ask, { running = false } = {}) {
  return updateSteps(md, steps => {
    const open = steps.findIndex(s => !s.done && s.kind !== "merge");
    if (open < 0) { const merge = steps.findIndex(s => !s.done && s.kind === "merge"); steps.splice(merge < 0 ? steps.length : merge, 0, ask); return; }
    if (running || steps[open].took) { let at = open + 1; while (steps[at]?.kind === "ask") at++; steps.splice(at, 0, ask); return; }
    steps.splice(open, 0, ask);
  });
}
// A step that stopped to wait for you has been answered. It is done, and the same kind of step carries on after your words.
function answerWait(md, who = "") {
  return updateSteps(md, steps => {
    const open = steps.findIndex(s => !s.done && s.kind !== "merge"), step = steps[open];
    if (!step?.wait || !step.took || steps[open + 1]?.kind !== "ask") return;
    step.done = true;
    let at = open + 1; while (steps[at]?.kind === "ask") at++;
    steps.splice(at, 0, workStep({ kind:step.kind, who:who || step.who, wait:true }));
  });
}
// An agent that stopped on a question of its own has its answer. That work is done, and the same kind of work carries on after your words,
// by the agent the line was just handed to, if any. The stopped Work keeps its own agent.
// Never steal Asks that belong to an already-queued following Work (nor cross unsent draft Asks).
function carryOn(md, who = "", { afterAsks = true, reply = null, stepId = "" } = {}) {
  return updateSteps(md, steps => {
    const open = stepId ? steps.findIndex(s => s.id === stepId) : steps.findIndex(s => !s.done && s.kind !== "merge");
    const step = steps[open];
    if (!step) return;
    if (step.done) {
      let at = steps.findIndex(s => isUnsent(s) || (!s.done && s.kind === "merge"));
      if (at < 0) at = steps.length;
      steps.splice(at, 0, ...(reply ? [reply] : []), workStep({ kind:step.kind, who:who || step.who, wait:step.wait, replaces:step.id }));
      return;
    }
    step.done = true;
    let at = open + 1;
    if (afterAsks) {
      while (steps[at]?.kind === "ask" && isSentAsk(steps[at])) at++;
      // If those sent Asks are immediately followed by a queued agent Work, they belong to that queued Work, not this continuation.
      if (at < steps.length && AGENT_LIKE(steps[at])) at = open + 1;
    }
    steps.splice(at, 0, ...(reply ? [reply] : []), workStep({ kind:step.kind, who:who || step.who, wait:step.wait, replaces:step.id }));
  });
}
// The asks a step answers: for a replacement Work (`replaces`), resolve the source Work's asks first
// and append any direct/trailing feedback asks owned by this step (deduplicated, never stealing asks owned by a following Work).
function asksFor(steps, step, seen = new Set()) {
  let at = steps.indexOf(step);
  if (at < 0 && step?.id) at = steps.findIndex(s => s.id === step.id);
  if (at < 0) return [];
  const own = [];
  for (let i = at - 1; i >= 0 && steps[i].kind === "ask"; i--) own.unshift(steps[i]);
  const trailing = [];
  let after = at + 1;
  while (after < steps.length && steps[after].kind === "ask") { trailing.push(steps[after]); after++; }
  if (trailing.length && !(after < steps.length && AGENT_LIKE(steps[after]))) own.push(...trailing);
  const direct = own.filter(a => isSentAsk(a) && !a.answered);
  if (step.replaces && !seen.has(step.id)) {
    seen.add(step.id);
    const source = steps.find(s => s.id === step.replaces && AGENT_LIKE(s));
    if (source) {
      const inherited = asksFor(steps, source, seen);
      const inheritedIds = new Set(inherited.map(a => a.id));
      return [...inherited, ...direct.filter(a => !inheritedIds.has(a.id))];
    }
  }
  return direct;
}
const SUMMARY_MAX = 600;
function summaryOf(text) {
  const para = firstPara(withoutLinkLines(takeMeta(text).text)), short = para.length > SUMMARY_MAX ? `${para.slice(0, SUMMARY_MAX - 1).replace(/\s+\S*$/, "")}…` : para;
  return safeWords(short);
}
const detailPath = L.detailPath;
// What came of a step, as it reads in the Topic: a few words, its pictures, and a link to the whole of it.
function closeStep(step, { slug, took, summary, hasDetail = true, done = true }) {
  const paras = String(step.body || "").split(/\n\s*\n/).map(x => x.trim()).filter(Boolean).filter(x => !/^\[details\]\(/i.test(x) && x !== summary), link = hasDetail ? `[Details](${L.detailHref(slug, step.id)})` : "";
  step.done = done;
  if (took) step.took = took;
  step.body = [summary, ...paras, link].filter(Boolean).join("\n\n");
  return step;
}
// Pictures go with the work they came from, or with the words if nothing has been done yet. Without word of which work that was, the latest.
const AGENT_LIKE = s => !YOURS.has(s.kind) && s.kind !== "merge" && s.kind !== "deliver" && s.kind !== "orch-review";
function addPicture(md, block, stepId = "") {
  const { front, body } = splitFront(md);
  if (!("status" in front) || !splitSteps(body).steps.length) {
    if (findSection(md, "Pictures")) { const current = sectionText(md, "Pictures"); return setSection(md, "Pictures", current ? `${current}\n\n${block}` : block); }
    return setSection(md, "Pictures", block);
  }
  return updateSteps(md, steps => {
    const target = steps.find(s => s.id === stepId && AGENT_LIKE(s)) || [...steps].reverse().find(AGENT_LIKE) || steps[steps.length - 1], at = target.body.search(/\n*\[details\]\(/i);
    target.body = at < 0 ? [target.body, block].filter(Boolean).join("\n\n") : `${target.body.slice(0, at).trimEnd()}\n\n${block}\n\n${target.body.slice(at).trim()}`;
  });
}

// ---------- A piece of work's detail file ----------
function initialDetail({ slug, title, label, who, started, asks = [], now = "Starting" }) {
  const asked = asks.map(a => withoutLinkLines(a.body)).filter(Boolean).map(text => text.slice(0, 4000).split("\n").map(line => `> ${line}`).join("\n")).join("\n>\n");
  const meta = [
    formatFrontLine("line", L.lineFromDetail(slug)),
    formatFrontLine("step", label),
    formatFrontLine("who", `@${who}`),
    formatFrontLine("started", started),
  ].join("\n");
  return `---\n${meta}\n---\n\n# ${label}: ${title}\n\n[Back to ${slug}.md](${L.lineFromDetail(slug)})\n\n${asked ? `## Asked\n\n${asked}\n\n` : ""}## Now\n\n${now}\n`;
}
const setNow = (md, text) => setSection(md, "Now", text, ["Result", "Changes", "How it was done"]);
// Words that joined a Work while it ran are asked too.
function addAsked(md, ask) {
  const text = withoutLinkLines(ask.body).slice(0, 4000);
  if (!text) return md;
  const quoted = text.split("\n").map(line => `> ${line}`).join("\n"), current = sectionText(md, "Asked");
  return setSection(md, "Asked", current ? `${current}\n>\n${quoted}` : quoted, ["Now", "Stopped", "Result", "Pictures", "Changes", "How it was done"]);
}
function replaceResultBlock(current, block) {
  const raw = String(current || "");
  if (!raw) return block;
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (RESULT_OPEN.test(lines[i])) {
      const close = resultCloserAfter(lines, i);
      if (close > i) return [...lines.slice(0, i), ...String(block).split(/\r?\n/), ...lines.slice(close + 1)].join("\n").trim();
    }
    const fm = FENCE_OPEN.exec(lines[i]);
    if (fm) { const close = fenceCloserAfter(lines, i, fm[1][0], fm[1].length); if (close > i) i = close; }
  }
  return [raw, block].filter(Boolean).join("\n\n");
}
// An Ask deleted from its Line leaves the Works that answered it too.
function removeAsked(md, ask) {
  const text = withoutLinkLines(ask.body).slice(0, 4000), current = sectionText(md, "Asked");
  if (!text || current == null) return md;
  const rows = value => String(value).trim().split(/\r?\n/).map(line => line.trimEnd()), all = rows(current), gone = rows(text.split("\n").map(line => `> ${line}`).join("\n"));
  const at = all.findIndex((_, i) => gone.every((line, j) => all[i + j] === line));
  if (at < 0) return md;
  all.splice(at, gone.length);
  if (all[at] === ">") all.splice(at, 1); else if (at === all.length && all[at - 1] === ">") all.pop();
  return setSection(md, "Asked", all.length ? all.join("\n") : null);
}
// The agent's last message, whole. Links an agent put under Result stay.
function setResult(md, text) {
  const block = `<!-- result: the agent's last message -->\n${String(text).trim().slice(0, 40000)}\n<!-- /result -->`;
  const current = sectionText(md, "Result");
  if (current == null) return setSection(md, "Result", block, ["Changes", "How it was done"]);
  return setSection(md, "Result", replaceResultBlock(current, block), ["Changes", "How it was done"]);
}
// What the result section says, without its markers, and what it links to.
function resultOf(raw) {
  const lines = String(raw || "").split(/\r?\n/), out = [];
  const skip = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (RESULT_OPEN.test(lines[i])) {
      skip.add(i);
      const close = resultCloserAfter(lines, i);
      if (close > i) skip.add(close);
      continue;
    }
    if (PENECHO_WRAPPER_LINE.test(lines[i])) skip.add(i);
    const fm = FENCE_OPEN.exec(lines[i]);
    if (fm) { const close = fenceCloserAfter(lines, i, fm[1][0], fm[1].length); if (close > i) i = close; }
  }
  for (let i = 0; i < lines.length; i++) if (!skip.has(i)) out.push(lines[i]);
  const text = out.join("\n").trim();
  return { text, links:linksIn(text) };
}
const HOW_MAX = 300;
// What was done, one line each. Enough for the next agent, without any tool's output.
function howBlock(rows) {
  const lines = [];
  for (const row of rows) {
    if (row.kind === "tool") { const target = String(row.target || "").split("\n")[0].replace(/`/g, "'").slice(0, 180); lines.push(`- ${row.verb}${target ? ` \`${target}\`` : ""}${row.state === "failed" ? " (failed)" : ""}`); }
    else if (row.kind === "error" || row.kind === "note") lines.push(`- ${String(row.text).split("\n")[0].slice(0, 240)}`);
  }
  if (!lines.length) return null;
  return lines.length > HOW_MAX ? `${lines.slice(-HOW_MAX).join("\n")}\n\n${lines.length - HOW_MAX} earlier steps are left out.` : lines.join("\n");
}
function changesBlock({ files = [], branch = "" }) {
  if (!files.length) return null;
  const add = files.reduce((n, f) => n + f.add, 0), del = files.reduce((n, f) => n + f.del, 0);
  return `${branch ? `On branch \`${branch}\`: ` : ""}+${add} −${del} in ${files.length} ${files.length === 1 ? "file" : "files"}.\n\n${files.slice(0, 60).map(f => `- \`${f.path}\` +${f.add} −${f.del}`).join("\n")}${files.length > 60 ? `\n\n${files.length - 60} more files.` : ""}`;
}

// ---------- Files and pictures ----------
// How any agent asks for a real Canvas picture: one small file, and PenEcho does the rest.
function pictureFormats(slideRules = "ppt-slides.md in this skill's folder", prototypeRules = "") {
  const protoRules = prototypeRules || String(slideRules).replace(/ppt-slides\.md\b/, "design-prototype.md");
  return [
    '- name.diagram.json for a diagram, one of: {"type":"architecture","title":"T","nodes":[{"id":"a","label":"A","type":"frontend"},{"id":"b","label":"B","type":"backend"}],"edges":[{"from":"a","to":"b","label":"calls"}]} or {"type":"workflow","title":"T","nodes":[{"id":"s","label":"Start","type":"start"},{"id":"d","label":"Ready?","type":"decision"},{"id":"e","label":"Done","type":"end"}],"edges":[{"from":"s","to":"d"},{"from":"d","to":"e","label":"yes"}]} or {"type":"sequence","title":"T","participants":[{"id":"a","label":"A"},{"id":"b","label":"B"}],"messages":[{"id":"m1","from":"a","to":"b","label":"Request"}]}.',
    "  Architecture node types are only frontend, backend, database, cloud, security, messagebus and external, and a node may have no type. Workflow node types are only start, process, decision, fork, join and end. Edge kinds are only call, data, config, optional and return.",
    `- name.explorer.html for a Visual Explorer: one self-contained HTML page with no network requests, that explains something or lets it be tried. For ordinary Explorers, the Canvas gives every page a large default text size on html and body, after the page's own styles, so a body font-size is overridden: put the layout and sizes in px on your own wrapper element. Only when asked to design or revise a clickable UI prototype or mockup, read ${protoRules} first (marked <html data-penecho-prototype> pages preserve normal typography and backgrounds).`,
    '- name.note.json for note cards (a knowledge card, flashcards or a work note): {"title":"T","style":"card","blocks":[{"type":"markdown","text":"…"}]} ("style":"note" for a work note), or {"cards":[…]} for several cards side by side, such as flashcards with {"type":"qa","question","answer"} blocks. Block types: markdown, formula, keypoints, callout, qa, checklist, code, quote, table, divider. PenEcho draws each card; never write HTML for it.',
    `- name.slide-01.html, name.slide-02.html, … for slides (a deck, PPT, a presentation, a report made from data such as an Excel table): one 1280x720 HTML page per slide, all with the same name. Read ${slideRules} first: it has the page format, the templates and the chart library. PenEcho puts the slides on one Canvas, where they can be downloaded as PowerPoint.`,
  ].join("\n");
}
function pictureHelp(dir, slideRules = "ppt-slides.md in this skill's folder", prototypeRules = "") {
  return [
    `If a picture is asked for or would explain this better than words, ask PenEcho's Canvas for it by writing one file in ${dir}. PenEcho turns it into an editable Canvas and a picture linked from the Topic. Do not draw it any other way or link it yourself.`,
    pictureFormats(slideRules, prototypeRules),
  ].join("\n");
}
// What an agent reads, in its own app, when it is asked to draw. The user copy has a distinct name so PenEcho
// Cloud's penecho-canvas skill can coexist with the local desktop Canvas skill. The project form remains only
// for reading and migrating copies made by older PenEcho versions.
const SKILL_NAME = "penecho-canvas", LOCAL_SKILL_NAME = "penecho-local-canvas", SKILL_MARK = "<!-- Written by PenEcho.";
function drawingSkill({ name = "", drop = "", user = false } = {}) {
  const skillName = user ? LOCAL_SKILL_NAME : SKILL_NAME;
  const description = user
    ? "Use when asked to draw, diagram or sketch something, to show an interactive explorer or explanation, to make a clickable UI prototype or mockup, note cards, or slides, a deck or a PPT (画图, 架构图, 流程图, 原型, 幻灯片, 演示文稿). Makes a real, editable picture, note or deck on the local PenEcho desktop Canvas for this computer's local projects, instead of text art, Mermaid, an image file or a .pptx written by hand."
    : "Use when asked to draw, diagram or sketch something or to show it as a picture, such as an architecture, workflow or sequence diagram, or an interactive explanation (画图, 架构图, 流程图), or a clickable UI prototype or mockup (原型, UI prototype), or to make slides, a deck or a PPT (幻灯片, 演示文稿). Makes a real, editable picture or deck on this project's PenEcho Canvas, instead of text art, Mermaid, an image file or a .pptx written by hand.";
  const where = user ? "PenEcho installed this local desktop skill for its projects on this computer. Manage it in each project's settings or PenEcho's Agent setup." : `Remove it in the settings of the project "${String(name).replace(/\s+/g, " ")}" in PenEcho.`;
  const fallback = user
    ? "If `~/.penecho/draw.json` is missing or the call cannot connect, PenEcho is not running. Tell the person to start PenEcho. Do not write a drop file into a project or Git repository, and do not draw it another way."
    : `If \`~/.penecho/draw.json\` is missing or the call cannot connect, PenEcho is not running: write the file in ${drop} instead. PenEcho takes it from there and shows it on this conversation's Topic. Wait about five seconds (for example \`sleep 5\`), then look in that folder: the file is gone when it has worked. If a file with the same name and \`.error.txt\` added is there instead, fix what that says and write the file again. To change that picture, write the same file name again.`;
  const filePlace = user
    ? "Name it for what it shows, and write it in the system's temporary folder, not in a project or Git repository:"
    : "Name it for what it shows, and write it outside \`.penecho/drawings/\` (for example in the system's temporary folder):";
  return `---
${formatFrontLine("name", skillName)}
${formatFrontLine("description", description)}
---

${SKILL_MARK} ${where} -->

# Draw on PenEcho's Canvas

If a picture is asked for or would explain this better than words, make it on PenEcho's Canvas: write one file, send it to PenEcho, and PenEcho makes an editable Canvas and a picture of it. Do not draw it any other way or link it yourself.

## The file

${filePlace}

${pictureFormats()}

## Send it

1. Read \`~/.penecho/draw.json\`. It holds \`port\` and \`token\`.
2. Send the file with the absolute path of the folder you work in:

   \`\`\`
   curl -s http://127.0.0.1:PORT/api/draw -H "x-penecho-token: TOKEN" -F folder="$PWD" -F file=@/tmp/name.diagram.json
   \`\`\`

   On Windows, use \`curl.exe\` with a temporary file in the system temp folder:

   - PowerShell: \`curl.exe -s http://127.0.0.1:PORT/api/draw -H "x-penecho-token: TOKEN" -F "folder=$($PWD.Path)" -F "file=@$env:TEMP\\name.diagram.json"\`
   - cmd.exe: \`curl.exe -s http://127.0.0.1:PORT/api/draw -H "x-penecho-token: TOKEN" -F "folder=%CD%" -F "file=@%TEMP%\\name.diagram.json"\`
3. The answer is JSON: \`{ "project", "canvas", "line", "url", "png" }\`. \`png\` is the absolute path of the picture: look at it to check it. \`url\` opens the Canvas in PenEcho: give it to the person.
4. An answer with \`error\` says what is wrong with the file. Fix it and send it again.

Sending a file with the same name again updates that picture and keeps everything the person drew. To put a file on a Canvas you were given (or the next slides of a deck), add \`-F canvas=CANVAS\` with its \`canvas\` name. \`-F line=LINE\` puts a new picture on that line of the project. \`-F title="Title"\` names a new Canvas.

## See what the person drew

\`\`\`
curl -s -G http://127.0.0.1:PORT/api/draw -H "x-penecho-token: TOKEN" --data-urlencode folder="$PWD" --data-urlencode canvas=CANVAS
\`\`\`

On Windows:

- PowerShell: \`curl.exe -s -G http://127.0.0.1:PORT/api/draw -H "x-penecho-token: TOKEN" --data-urlencode "folder=$($PWD.Path)" --data-urlencode "canvas=CANVAS"\`
- cmd.exe: \`curl.exe -s -G http://127.0.0.1:PORT/api/draw -H "x-penecho-token: TOKEN" --data-urlencode "folder=%CD%" --data-urlencode "canvas=CANVAS"\`

The answer's \`png\` is the Canvas as last saved, with the person's ink on it: look at it. Its \`widgets\` list what is on it, each with the \`file\` it is drawn from: to change one, edit that file and send it with \`-F canvas=CANVAS\`, and it changes in place. \`ink\` is the box around the person's drawing: to put a new picture on it, add \`-F x=… -F y=… -F w=…\` (top-left and width, in Canvas units); left out, it goes beside what is there. Never edit a \`.penecho.json\` file by hand: the open Canvas saves over it. Without \`canvas\` the answer lists the project's Canvases, newest first.

## If PenEcho cannot be reached

${fallback}

Tell the person it is on their Canvas in PenEcho. There is nothing else to open, render or link.
`;
}
function statusBlock(doc, trunk) {
  const cur = doc.steps.find(s => !s.done), who = cur?.who && cur.who !== "you" ? ` · @${cur.who}` : "", status = doc.status, label = cur?.label || "", why = doc.front.why;
  const head = isOutdated(doc) ? "Outdated and archived: no longer valid, or replaced by newer work" : status === "landed" ? `Landed on ${trunk || "main"}${doc.front.commit ? ` as ${doc.front.commit}` : ""}` : status === "closed" ? "Closed" : status === "done" ? "Done, in the docs folder"
    : status === "not-started" ? "Not started" : status === "ready" ? `Finished. The changes are on ${doc.front.branch || "their branch"}, not merged` : status === "waiting" ? `${label || "This"} needs you` : status === "stopped" ? `${label || "This"} stopped${who}` : status === "notes" ? "Notes and drawings, nothing sent to an agent" : `Working on ${label}${who}`;
  return `<!-- status: PenEcho keeps this current -->\n> [!status] ${head}${why && ["waiting", "stopped"].includes(status) ? `\n> ${why}` : ""}\n<!-- /status -->`;
}
function replaceStatus(md, block) {
  if (/<!-- status:[\s\S]*?<!-- \/status -->/.test(md)) return md.replace(/<!-- status:[\s\S]*?<!-- \/status -->/, () => block);
  const heading = md.match(/^# .*$/m);
  return heading ? md.replace(heading[0], () => `${heading[0]}\n\n${block}`) : `${block}\n\n${md}`;
}
// ---------- What the box hands to an agent's own app ----------
// A quote is told as background, each line marked, so an agent does not take the earlier words for a new request. Quotes pasted before this wording are still read back.
const QUOTE_MOST = 140, REFER_MOST = 1500, REFER_SAYS = "For context only, not a new request: this refers to", REFER_HEAD = /^(?:For context only, not a new request: this refers to|Refers to) (.+?) in (.+?)(?:, which said:|:|\.)$/;
const referLabel = step => YOURS.has(step.kind) ? [step.label, step.when, step.via].filter(Boolean).join(" · ") : step.label;
const stepWords = step => YOURS.has(step.kind) ? step.text : step.out;
// One more quote on an Ask: after its words and any other quote, above its pictures.
function withRefer(body, line) {
  const text = String(body || "");
  if (text.split("\n").includes(line)) return text;
  const paragraphs = text.split("\n\n"), pictures = paragraphs.findIndex(para => para.split("\n").every(isLinkOnly));
  paragraphs.splice(pictures < 0 ? paragraphs.length : pictures, 0, line);
  return paragraphs.join("\n\n");
}
function referLine(slug, step, hasDetail = false) {
  const said = firstPara(stepWords(step)), quote = said.length > QUOTE_MOST ? `${said.slice(0, QUOTE_MOST - 1).replace(/\s+\S*$/, "")}…` : said;
  return `> Refers to [${referLabel(step)}](${hasDetail ? step.detailHref || L.detailHref(slug, step.id) : `${slug}.md`})${quote ? `: ${quote}` : ""}`;
}
// The step a quote came from. Two Asks can share a minute, and then the quote's words tell them apart.
function referTarget(doc, ref) {
  const same = doc.steps.filter(s => !isUnsent(s) && referLabel(s) === ref.label), start = ref.words.replace(/…$/, "");
  return same.find(s => firstPara(stepWords(s)).startsWith(start)) || same[0] || null;
}
// What an agent is told about one: what it says and where the rest is. It stays one paragraph, so it can be recognised when the message comes back.
function referText({ label, file, words = "", pictures = [] }) {
  const said = String(words).replace(/\s*\n\s*\n\s*/g, "\n").trim(), short = said.length > REFER_MOST ? `${said.slice(0, REFER_MOST - 1).trimEnd()}…` : said;
  const quoted = [...(short ? short.split("\n") : []), ...pictures];
  return [`${REFER_SAYS} ${label} in ${file}${quoted.length ? ", which said:" : "."}`, ...quoted.map(line => `> ${line}`)].join("\n");
}
const APP_CARRIED = /\s*\[(?:Attached: [^\]\n]+|\d+ pictures?)\]$/;
const ATTACHED = "Attached:", READ_FIRST = "Read this first for context. It has my asks and a short note on each work; open a work's Details only if you need them: ", READ_FIRST_BEFORE = "Read this first, it has the whole story: ", FOR_PICTURE = "For a picture, follow \"For agents\" in ";
// Where the work goes, for an app that cannot be told a folder. Only an absolute path counts, so someone's own "Work in the kitchen" stays their words.
const workInText = (folder, branch) => `Work in ${folder}, on branch ${branch}.`;
const WORK_IN = /^Work in (?:[\\/]|[A-Za-z]:[\\/]).*, on branch \S+\.$/;
// Every Ask is already a file in the docs folder, so an agent finds what was said before with its own search. Nothing to install.
const SEARCH_ASKS = "Every Ask in this project is kept there as Markdown, one file for each line, under \"## Ask ·\" headings, newest last. To find what was said before, search them with your own tools, for example: ";
const searchHint = topics => `${SEARCH_ASKS}rg -n -i "word" ${topics}`;
// What PenEcho adds for the agent goes in one block after your words, so the agent sees where your words end, and the app's list still names the conversation by them.
// A tag, not a line of = or -, which Markdown would turn the line above into a heading with.
const CONTEXT_OPEN = "<penecho-context>", CONTEXT_CLOSE = "</penecho-context>";
const CONTEXT_BLOCK = /(?:^|\n[ \t]*\n?)[ \t]*<penecho-context>[ \t]*\n([\s\S]*?)\n[ \t]*<\/penecho-context>[ \t]*(?=\n|$)/;
// What it refers to comes first, so your own words are read last, as the request.
function handoffText({ words, files = [], refers = [], where = "", topic = "", readme = "", make = "" }) {
  const context = [where, make, topic ? `${READ_FIRST}${topic}` : "", topic ? searchHint(topic.replace(/[\\/][^\\/]+$/, "")) : "", readme ? `${FOR_PICTURE}${readme}, so it lands on PenEcho's Canvas.` : ""].filter(Boolean);
  return [...refers, String(words || "").trim(), files.length ? [ATTACHED, ...files].join("\n") : "", context.length ? [CONTEXT_OPEN, ...context, CONTEXT_CLOSE].join("\n") : ""].filter(Boolean).join("\n\n");
}
// The same message when it comes back from that app's transcript: your words, the files, and which Topic it names. Anything PenEcho did not write stays in the words.
function parseHandoff(text, docs) {
  const root = String(docs).replace(/[\\/]+$/, ""), inside = p => p.startsWith(`${root}/`) || p.startsWith(`${root}\\`), rel = p => p.slice(root.length + 1).replace(/\\/g, "/");
  const out = { words:String(text || "").trim(), files:[], topic:"" };
  // Codex adds its own note of what it carried after everything you sent. It says no more than PenEcho's list, when there is one.
  const carried = String(text || "").trimEnd().match(APP_CARRIED)?.[0] || "";
  let rest = String(text || "").trimEnd().slice(0, carried ? -carried.length : undefined);
  // PenEcho's block is only for the agent. The Topic it names says which line this is, and anything typed after it is still your words.
  const block = rest.match(CONTEXT_BLOCK);
  if (block) {
    for (const line of block[1].split("\n").map(x => x.trim())) {
      const first = [READ_FIRST, READ_FIRST_BEFORE].find(words => line.startsWith(words));
      if (first && inside(line.slice(first.length))) out.topic = (rel(line.slice(first.length)).match(/^(?:topics|lines)\/([^/]+)\.md$/) || [])[1] || "";
    }
    const after = rest.slice(block.index + block[0].length).trim();
    rest = [rest.slice(0, block.index).trimEnd(), after].filter(Boolean).join("\n\n");
  }
  // Quotes come before your words. Each is one paragraph and also says which line this is about.
  for (;;) {
    const cut = rest.indexOf("\n\n"), para = cut < 0 ? rest : rest.slice(0, cut), refer = para.split("\n")[0].match(REFER_HEAD);
    if (!refer || !inside(refer[2])) break;
    out.topic ||= (rel(refer[2]).match(/^(?:topics|lines|works)\/([^/]+?)(?:\.md$|\/)/) || [])[1] || "";
    rest = cut < 0 ? "" : rest.slice(cut + 2).trimStart();
  }
  while (rest) {
    const cut = rest.lastIndexOf("\n\n"), para = rest.slice(cut < 0 ? 0 : cut + 2).trim();
    // Conversations pasted before this wording changed are still read back.
    const first = [READ_FIRST, READ_FIRST_BEFORE].find(words => para.startsWith(words)), refer = para.split("\n")[0].match(REFER_HEAD);
    if (para.startsWith(FOR_PICTURE) || para.startsWith(SEARCH_ASKS) || WORK_IN.test(para)) { /* Only for the agent. */ }
    // Conversations pasted when quotes came after your words.
    else if (refer && inside(refer[2])) out.topic ||= (rel(refer[2]).match(/^(?:topics|lines|works)\/([^/]+?)(?:\.md$|\/)/) || [])[1] || "";
    else if (first && inside(para.slice(first.length))) out.topic = (rel(para.slice(first.length)).match(/^(?:topics|lines)\/([^/]+)\.md$/) || [])[1] || "";
    else if (para.startsWith(`${ATTACHED}\n`) && para.split("\n").slice(1).every(inside)) out.files = para.split("\n").slice(1).map(rel);
    else break;
    rest = cut < 0 ? "" : rest.slice(0, cut).trimEnd();
  }
  out.words = `${rest}${out.files.length ? "" : carried}`.trim();
  return out;
}
const plainWords = text => String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
const wordList = text => plainWords(text).match(/\p{Script=Han}|[\p{L}\p{N}_-]+/gu) || [];
function unsentSaying(doc, words) {
  const said = plainWords(safeWords(words));
  return doc.steps.filter(isUnsent).reverse().find(s => plainWords(s.text) === said) || null;
}
// Is this message an Ask still marked Not sent? Word for word, or with one of its pictures, or with most of its words: people change a few words before they press Send.
function unsentMatching(doc, words, files = []) {
  const waiting = doc.steps.filter(isUnsent).reverse(), exact = unsentSaying(doc, words);
  if (exact) return exact;
  const samePicture = files.length ? waiting.find(s => linksIn(s.body).some(link => files.includes(decodeURI(link.href).replace(/^(\.\.\/)+/, "")))) : null;
  if (samePicture) return samePicture;
  const theirs = wordList(words), have = new Set(theirs);
  return waiting.find(s => { const mine = wordList(s.text); return mine.length >= 3 && theirs.length <= mine.length * 2 && mine.filter(w => have.has(w)).length / mine.length >= .6; }) || null;
}
const linkLines = text => String(text || "").split("\n").filter(line => isLinkOnly(line) || isReferLine(line) || isCanvasLine(line) || isMakeLine(line));
function linkMd(name, relative, type = "") {
  const label = String(name).replace(/[\\[\]]/g, "\\$&"), href = /[\s()]/.test(relative) && !/[<>\n]/.test(relative) ? `<${relative}>` : String(relative).replace(/[\\()]/g, "\\$&");
  return `${/^image\//.test(type) || IMAGE.test(name) ? "!" : ""}[${label}](${href})`;
}
// Files a message names the way Claude Code and dsh write an attached file: @"/a path with spaces" or @/a/path. Only an absolute path counts. A relative one is someone pointing at their code, which is already in the project.
const MENTION = /(?:^|[\s(（])@(?:"((?:\/|~\/|[A-Za-z]:[\\/])[^"\n]+)"|((?:\/|~\/)[^\s"'`)]+))/g;
const mentionedFiles = text => [...new Set([...String(text || "").matchAll(MENTION)].map(m => m[1] || m[2].replace(/[.,;:!?]+$/, "")))];

// ---------- Project index ----------
function readmeIndex({ name, code, topics, notes, whole, stateText, hrefOf = t => L.linePath(t.slug), hasQuestions = t => t.doc.questions.some(q => !q.ticked) }) {
  const row = t => `| [${t.title}](${hrefOf(t)}) | ${stateText(t)} |`;
  const table = list => `| Line | Status |\n| --- | --- |\n${list.map(row).join("\n")}`;
  const groups = { need:[], run:[], later:[], finished:[], landed:[] };
  for (const t of topics) {
    const s = t.doc.status;
    if (!L.ARCHIVED.has(s) && hasQuestions(t)) groups.need.push(t);
    else if (FINISHED.has(s)) groups.landed.push(t);
    else if (s === "not-started") groups.later.push(t);
    else if (["waiting", "stopped"].includes(s)) groups.need.push(t);
    else if (s === "ready") groups.finished.push(t);
    else groups.run.push(t);
  }
  const parts = [`---\n${formatFrontLine("project", name)}\n${formatFrontLine("code", code || "none")}\n---\n\n# ${name}\n\nStart here. \`understanding.md\` says what the project is and where it stands; each Topic in topics/ is what is known about one subject. Each Line in lines/ is one task: what was asked, word for word, and what was done, in order. Each Work has a detail file in works/, for when you need the whole of it. Archived Lines are in archive/.\n\nConversations with agents in this project's folders are filed here under their Line, and what you write in a Line goes back to them.`];
  if (whole) parts.push(`## Whole picture\n\n![Whole picture](${whole})`);
  if (groups.need.length) parts.push(`## Needs you\n\n${table(groups.need)}`);
  if (groups.run.length) parts.push(`## In progress\n\n${table(groups.run)}`);
  if (groups.finished.length) parts.push(`## Finished, not merged\n\n${table(groups.finished)}`);
  if (groups.later.length) parts.push(`## Not started\n\n${table(groups.later)}`);
  if (notes.length) parts.push(`## Notes\n\n${notes.map(n => `- [${n.title}](${n.path})`).join("\n")}`);
  if (groups.landed.length) parts.push(`## Landed\n\n${table(groups.landed.slice(-8).reverse())}`);
  parts.push(`## For agents\n\n- Read only what your work needs: search \`lines/\` and \`topics/\` for its words rather than reading whole files. [MEMORY.md](MEMORY.md) holds rules for the whole project and tool traps; change it only with its memory command, as its \"Keeping this file\" part says.\n- PenEcho keeps the Topics and \`understanding.md\`: leave them alone unless the person asks about them. Follow a Details link only if you need it.\n- The \`status\` at the top of a Line and its steps say where things stand. PenEcho keeps them current.\n- Never rewrite the words under an "Ask" heading.\n- This folder is for reading. Never put builds, installers, archives, packages, dependencies (node_modules, venv), caches, logs, scratch scripts or run data in it.\n- ${pictureHelp("files/<line>/", ".penecho/ppt-slides.md").replace(/\n/g, "\n  ")}`);
  return `${parts.join("\n\n")}\n`;
}
// MEMORY.md and its rules live in memory.js.
const initialMemory = (name, prefix) => require("./memory.js").initialMemory(name, prefix);

// The question a reply ends on, if it ends on one.
// ---------- A line's title, from the agent ----------
// While a line has no name of its own, the prompt asks the agent to end its reply with one comment PenEcho reads and takes out of the result:
//   <!-- penecho: title="A short line title" -->
// Any comment of this kind is taken out, whatever else it holds (older replies also carried tags). The title goes in the line's file as its
// `# heading`, with `title by: <agent>`. Once an agent or the person named it (`title by: you`, written by Rename), later agent titles are ignored.
const META = /<!--\s*penecho:([\s\S]*?)-->/gi;
const metaValue = (body, name) => { const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|“([^”]*)”|'([^']*)')`, "i").exec(body); return m ? (m[1] ?? m[2] ?? m[3] ?? "").replace(/\s+/g, " ").trim() : ""; };
// requirement: one the agent says this Work added or changed, for PenEcho to file in the Line's Topic (Knowledge.applyRequirement, PE-916).
// ask / waiting: blocking question(s) for the person, so the agent does not have to edit Work/Line files by hand (PE-1097).
function takeMeta(text) {
  const raw = String(text ?? "");
  let title = "", requirement = "", waiting = "";
  const questions = [];
  const rest = raw.replace(META, (all, body) => {
    title = metaValue(body, "title").slice(0, 120) || title;
    requirement = metaValue(body, "requirement").slice(0, 800) || requirement;
    waiting = metaValue(body, "waiting").slice(0, 300) || waiting;
    const ask = metaValue(body, "ask").slice(0, 1200);
    if (ask) {
      const parts = ask.split(/\s*\|\s*/).map(s => s.trim()).filter(Boolean);
      if (parts.length) questions.push({ text:parts[0].slice(0, 300), options:parts.slice(1, 12).map(o => o.slice(0, 200)) });
    }
    return "";
  });
  return {
    text:rest === raw ? raw : rest.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim(),
    title,
    requirement,
    ...(waiting ? { waiting } : {}),
    ...(questions.length ? { questions } : {}),
  };
}
// Read-only compatibility for Parts sections written before split jobs were removed.
const PARTS = "Parts", PART_KINDS = ["quick", "normal", "hard"], PARTS_MOST = 12;
const oneLineOf = (text, most) => String(text ?? "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim().slice(0, most);
function cleanParts(list, most = PARTS_MOST) {
  if (!Array.isArray(list)) return [];
  return list.filter(p => p && typeof p === "object").map(p => {
    const title = oneLineOf(p.title, 120), words = String(p.words ?? "").replace(/\r/g, "").replace(/^( {0,3})##/gm, "$1###").trim().slice(0, 4000);
    const kind = PART_KINDS.includes(String(p.kind || "").toLowerCase()) ? String(p.kind).toLowerCase() : "normal";
    const agent = /^[a-z0-9][a-z0-9._-]{0,39}$/i.test(String(p.agent || "").replace(/^@/, "")) ? String(p.agent).replace(/^@/, "").toLowerCase() : "";
    const slug = /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,120}$/u.test(String(p.slug || "")) ? String(p.slug) : "";
    return { title:title || oneLineOf(firstPara(words), 60) || "Part", words:words || title, kind, agent, slug };
  }).filter(p => p.words).slice(0, most);
}
const PART_HEAD = /^\d{1,2}\.\s+\*\*(.+?)\*\*(.*)$/;
function parseParts(text) {
  const out = []; let cur = null;
  for (const line of String(text || "").split("\n")) {
    const m = line.match(PART_HEAD);
    if (m) {
      cur = { title:m[1].trim(), words:[], kind:"normal", agent:"", slug:"" };
      for (const bit of m[2].split(" · ").map(x => x.trim()).filter(Boolean)) {
        const link = bit.match(/^\[[^\]]*\]\(([^)]+?)\.md\)$/);
        if (link) cur.slug = path.posix.basename(link[1]);
        else if (bit.startsWith("@")) cur.agent = normalizeWho(bit);
        else if (PART_KINDS.includes(bit.toLowerCase())) cur.kind = bit.toLowerCase();
      }
      out.push(cur); continue;
    }
    if (cur) cur.words.push(line.replace(/^ {1,4}/, ""));
  }
  return cleanParts(out.map(p => ({ ...p, words:p.words.join("\n").trim() })));
}
// The one sentence at the end of a prompt while the line has no name of its own; nothing once it has one.
function metaAsk({ title = false } = {}) {
  return title ? `Choose this line's name yourself; do not ask the person. End with <!-- penecho: title="…" --> (2 to 6 words, like a chat's title, in the request's language). PenEcho reads and hides it.` : "";
}
function isLegacyAutoTitle(title, text) {
  if (!title.endsWith("…")) return false;
  const legacy = titleFromText(text, { clip:legacyClipTitle });
  return legacy === title && titleFromText(text) !== title;
}
// A line has no title of its own while it is still called by the first words of its first Ask, a picture's name, or a number.
function wantsTitle(doc) {
  if (doc.front["title by"]) return false;
  const title = String(doc.title || "").trim();
  if (!title || /^[\d\s#.-]+$/.test(title) || title === NEW_TITLE || /^Picture · /.test(title) || JUNK_TITLE.test(title)) return true;
  const first = doc.asks[0];
  return Boolean(first) && (titleFromText(first.text) === title || isLegacyAutoTitle(title, first.text));
}
// What a line is called on the page: its own title, or, while that is still an app's block, a preamble, a number or a legacy 56-char auto-title, its first real words.
const shownTitle = doc => {
  const title = String(doc.title || "").trim(), first = doc.asks[0] || doc.steps[0];
  return !doc.front["title by"] && first && (JUNK_TITLE.test(title) || /^[\d\s#.-]+$/.test(title) || isLegacyAutoTitle(title, first.text)) ? titleFromText(first.text) : title;
};
function questionIn(text) {
  const last = String(text || "").trim().split(/\n\s*\n/).pop().replace(/[*_`]/g, "");
  const end = last.split(/(?<=[.!?])\s+|(?<=[。！？])|\n/).filter(x => x.trim()).pop()?.replace(/^[\s\-•\d.)]+/, "").trim() || "";
  return /[?？]$/.test(end) ? end : "";
}
const safeFenceFor = text => {
  const runs = String(text || "").match(/`+/g) || [];
  const longest = runs.reduce((m, s) => Math.max(m, s.length), 2);
  return "`".repeat(Math.max(3, longest + 1));
};
const ORCH_VERDICT_LABELS = { ready:"Ready", caveats:"Check caveats", fix:"Fix needed", unverified:"Unverified" };
const ORCH_REQ_MARK = { done:"x", partly:"~", missed:" ", extra:"+" };
// An Orchestrator review node stored in lines/<slug>.md right after the Work it reviews, with its full report in works/<slug>/<workId>--review.md.
function orchReviewStep({ workId, who = "", done = false, took = "", off = "", summary = "", slug = "" }) {
  const cleanWork = String(workId || "").trim().toLowerCase();
  const detailLink = slug && cleanWork ? `[Details](${L.detailHref(slug, `${cleanWork}--review`)})` : "";
  const body = [safeWords(String(summary || "").trim()), detailLink, cleanWork ? `<!-- penecho-review-of: ${cleanWork} -->` : ""].filter(Boolean).join("\n\n");
  return {
    kind:"orch-review", num:0, done:Boolean(done), who:normalizeWho(who), took:String(took || "").trim(), when:"", via:"", wait:false,
    ...(off ? { off:String(off).trim().toLowerCase() } : {}),
    reviewOf:cleanWork,
    body,
  };
}
function upsertOrchReviewStep(md, opts = {}) {
  const cleanWork = String(opts.workId || "").trim().toLowerCase();
  if (!cleanWork) return md;
  const next = orchReviewStep({ ...opts, workId:cleanWork });
  return updateSteps(md, steps => {
    const existing = steps.findIndex(s => s.kind === "orch-review" && (s.reviewOf === cleanWork || s.id === `${cleanWork}--review`));
    if (existing >= 0) {
      const target = steps[existing];
      target.who = next.who;
      target.done = next.done;
      target.took = next.took;
      target.off = next.off || "";
      target.reviewOf = cleanWork;
      target.body = next.body;
      return;
    }
    const workIdx = steps.findIndex(s => s.id === cleanWork);
    if (workIdx >= 0) {
      steps.splice(workIdx + 1, 0, next);
      return;
    }
    const at = steps.findIndex(s => isUnsent(s) || (!s.done && s.kind === "merge"));
    steps.splice(at < 0 ? steps.length : at, 0, next);
  });
}
function removeOrchReviewStep(md, workId) {
  const cleanWork = String(workId || "").trim().toLowerCase();
  if (!cleanWork) return md;
  return updateSteps(md, steps => {
    for (let i = steps.length - 1; i >= 0; i -= 1) {
      if (steps[i].kind === "orch-review" && (steps[i].reviewOf === cleanWork || steps[i].id === `${cleanWork}--review`)) {
        steps.splice(i, 1);
      }
    }
  });
}
function renderOrchReviewDetail({ slug, title = "", workId, workLabel = "", state = "done", review = null, reviewPending = null, reviewStopped = null, how = "" }) {
  const cleanWork = String(workId || "").trim().toLowerCase();
  const label = String(workLabel || cleanWork || "Work").trim();
  const info = (state === "reviewing" ? reviewPending : state === "stopped" ? reviewStopped : review) || review || reviewPending || reviewStopped || {};
  const meta = [
    formatFrontLine("line", L.lineFromDetail(slug)),
    formatFrontLine("step", KIND_LABELS["orch-review"]),
    formatFrontLine("kind", "orch-review"),
    formatFrontLine("review of", cleanWork),
    formatFrontLine("state", state),
    info.agent ? formatFrontLine("who", `@${normalizeWho(info.agent)}`) : "",
    info.by ? formatFrontLine("by", info.by) : "",
    info.agent ? formatFrontLine("agent", info.agent) : "",
    info.model ? formatFrontLine("model", info.model) : "",
    info.effort ? formatFrontLine("effort", info.effort) : "",
    info.presetId ? formatFrontLine("preset id", info.presetId) : "",
    info.mode ? formatFrontLine("mode", info.mode) : "",
    review?.verdict ? formatFrontLine("verdict", review.verdict) : "",
    review?.score != null ? formatFrontLine("score", review.score) : "",
    review?.took ? formatFrontLine("took", review.took) : "",
    review?.at ? formatFrontLine("at", review.at) : "",
    review?.ignored ? formatFrontLine("ignored", "yes") : "",
    reviewPending?.startedAt ? formatFrontLine("started at", reviewPending.startedAt) : "",
    reviewStopped?.stopWhy ? formatFrontLine("stop why", reviewStopped.stopWhy) : "",
    reviewStopped?.stoppedAt ? formatFrontLine("stopped at", reviewStopped.stoppedAt) : "",
  ].filter(Boolean).join("\n");
  const modeWord = info.mode === "user" ? "User assigned" : info.mode === "auto" ? "Auto reviewer" : "";
  const sections = [
    `# Orchestrator review of ${label}${title ? `: ${title}` : ""}`,
    `[Back to ${slug}.md](${L.lineFromDetail(slug)})`,
  ];
  const byText = String(info.by || "").trim();
  const escRe = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const modelText = String(info.model || "").trim();
  const effortText = String(info.effort || "").trim();
  const extraSpecs = [
    modelText && (!byText || !byText.toLowerCase().includes(modelText.toLowerCase())) ? modelText : "",
    effortText && (!byText || !new RegExp(`(?:^|[·\\s(])${escRe(effortText)}\\s+effort(?:$|[·\\s)])`, "i").test(byText)) ? `${effortText} effort` : "",
  ].filter(Boolean);
  const reviewerLine = [byText, ...extraSpecs].filter(Boolean).join(" · ");
  const summaryMeta = [
    reviewerLine ? `**Reviewer:** ${reviewerLine}${modeWord ? ` (${modeWord})` : ""}` : "",
    info.why ? `**Why:** ${info.why}` : "",
  ];
  if (state === "reviewing") {
    summaryMeta.unshift("**Status:** Reviewing…");
    sections.push(summaryMeta.filter(Boolean).join("\n"));
    sections.push(`## Now\n\nReviewing ${label}…`);
  } else if (state === "stopped") {
    const whyLabel = reviewStopped?.stopWhy === "stopped" ? "Stopped by you" : reviewStopped?.stopWhy === "limit" ? "Stopped: usage limit" : "Stopped with an error";
    summaryMeta.unshift(`**Status:** ${whyLabel}`);
    sections.push(summaryMeta.filter(Boolean).join("\n"));
    sections.push(`## Stopped\n\n${safeWords(String(reviewStopped?.reason || whyLabel).trim())}`);
  } else if (review) {
    const verdictLabel = ORCH_VERDICT_LABELS[String(review.verdict || "").toLowerCase()] || "";
    const headline = verdictLabel
      ? (review.verdict === "unverified" ? verdictLabel : review.score != null ? `${verdictLabel} · ${review.score}/5` : verdictLabel)
      : (review.score != null ? `${review.score}/5` : "");
    if (headline) summaryMeta.unshift(`**Verdict:** ${headline}${review.ignored ? " (Ignored in stats)" : ""}`);
    sections.push(summaryMeta.filter(Boolean).join("\n"));
    if (Array.isArray(review.requirements) && review.requirements.length) {
      sections.push(`## What you asked\n\n${review.requirements.map(r => `- [${ORCH_REQ_MARK[r.state] || " "}] ${r.text} (${r.state})`).join("\n")}`);
    }
    const isV2 = review.schema === 2 || "outcome" in review || "verification" in review || "safety" in review;
    const ratingLines = isV2
      ? [["Outcome", review.outcome], ["Verification", review.verification], ["Safety & Scope", review.safety]]
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => `- ${k}: ${v === null ? "N/A" : `${v}/5`}`)
      : [["Asked", review.asked], ["Proven", review.proven], ["Safe", review.safe], ["Report", review.report]]
          .filter(([, v]) => typeof v === "number")
          .map(([k, v]) => `- ${k}: ${v}/5`);
    if (ratingLines.length) sections.push(`## Ratings\n\n${ratingLines.join("\n")}`);
    if (Array.isArray(review.findings) && review.findings.length) {
      sections.push(`## Findings\n\n${review.findings.map(f => `- **${f.kind}**${f.where ? ` \`${f.where}\`` : ""}: ${f.detail}`).join("\n")}`);
    }
    if (review.note) sections.push(`## Review note\n\n${safeWords(review.note)}`);
    if (review.notes) sections.push(`## Notes\n\n${safeWords(review.notes)}`);
    if (review.rawOutput) {
      const fence = safeFenceFor(review.rawOutput);
      sections.push(`## Original output\n\n${fence}text\n${String(review.rawOutput).trim()}\n${fence}`);
    }
  }
  const cleanHow = String(how || "").split(/\r?\n/).filter(line => !ORCH_REVIEW_DATA.test(line)).join("\n").trim();
  if (cleanHow) sections.push(`## How it was done\n\n${cleanHow}`);
  const payload = {
    version:1,
    work:cleanWork,
    state,
    ...(review ? { review } : {}),
    ...(reviewPending ? { reviewPending } : {}),
    ...(reviewStopped ? { reviewStopped } : {}),
  };
  const safeJson = JSON.stringify(payload).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
  sections.push(`<!-- penecho-orch-review: ${safeJson} -->`);
  return `---\n${meta}\n---\n\n${sections.join("\n\n")}\n`;
}
function parseOrchReviewDetail(md) {
  const text = String(md || "");
  const { front } = splitFront(text);
  const matches = [...text.matchAll(/^<!-- penecho-orch-review: (\{.*\}) -->$/gm)];
  const match = matches.at(-1);
  if (!match) return null;
  let data;
  try { data = JSON.parse(match[1]); } catch { return null; }
  if (!data || typeof data !== "object" || !data.work) return null;
  const review = data.review && typeof data.review === "object" ? { ...data.review } : null;
  if (review && /^(?:yes|true)$/i.test(String(front.ignored || ""))) review.ignored = true;
  return {
    version:Number(data.version) || 1,
    work:String(data.work).trim().toLowerCase(),
    state:String(data.state || (review ? "done" : data.reviewPending ? "reviewing" : data.reviewStopped ? "stopped" : "done")),
    review,
    reviewPending:data.reviewPending && typeof data.reviewPending === "object" ? { ...data.reviewPending } : null,
    reviewStopped:data.reviewStopped && typeof data.reviewStopped === "object" ? { ...data.reviewStopped } : null,
    front,
  };
}
module.exports = {
  AGENT_STEPS, openSteps, wantsWork, normalizeLegacyStatus, cleanLegacyWhy,
  parseParts,
  questionIn, takeMeta, metaAsk, wantsTitle, shownTitle, withoutPreamble,
  KIND_LABELS, FINISHED, isOutdated, QUESTIONS, DECIDED, HANDOFFS, AGENT_LIKE, YOURS, isYours, noteStep, canvasStep, addYours, stepWords,
  ANSWERED_MARK, removeAsked, orchReviewStep, upsertOrchReviewStep, removeOrchReviewStep, renderOrchReviewDetail, parseOrchReviewDetail,
  hashText, slugify, titleFromText, pictureTitle, withoutLatex, namesOf, nameLeft, setTitle, safeWords, nowLabel, labelTime, archiveTime, orchestratorParents, formatFrontValue, formatFrontLine, parseFrontValue, splitFront, setFront, isLineFront, findSection, sectionText, setSection, setAbove, kindOf, normalizeWho,
  splitSteps, stepLineRange, renderSteps, renderStep, stepHead, updateSteps, numberSteps, parseQuestions, parseDetailQuestions, setDetailQuestions, removeAllSections, renderQuestions, parseLine, topicFingerprint, askStep, workStep, initialLine, noteToLine, insertAsk, answerWait, carryOn, asksFor,
  summaryOf, firstPara, withoutLinkLines, detailPath, closeStep, addPicture, initialDetail, setNow, addAsked, replaceResultBlock, setResult, resultOf, howBlock, changesBlock,
  SKILL_NAME, LOCAL_SKILL_NAME, SKILL_MARK, drawingSkill, pictureFormats, meetingStep, canvasLine, isCanvasLine, MAKE_KINDS, cleanMake, makeLine, makeOfBody, makeSay, isMakeLine, heldLine, withoutHeld, NOT_SENT, isUnsent, FINISHED_ASK, isFinishedAsk, isSentAsk, finishUnsentAsk, isLinkOnly, referLine, refersIn, referTarget, referText, workInText, handoffText, parseHandoff, unsentSaying, unsentMatching, linkLines, pictureHelp, statusBlock, replaceStatus, linkMd, mentionedFiles, linksIn, readmeIndex, initialMemory, withRefer, searchHint,
};
