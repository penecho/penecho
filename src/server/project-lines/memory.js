"use strict";

// MEMORY.md: what every agent on a project should know before it starts. Its own rules say what goes in, so an
// agent started anywhere, in PenEcho or in its own app, keeps it the same way.
//
// Agents change it only through this file, run as a command. PenEcho puts a copy in the docs folder's .penecho
// folder, next to MEMORY.md, with two small launchers: `memory` for macOS and Linux, `memory.cmd` for Windows.
// The command checks what a model can get wrong (length, the ending, the line limit, duplicates, keys, hidden
// characters) and refuses with the reason, so the agent fixes it while it still knows the details. A lock and a
// look at the file just before writing keep agents working at the same time from undoing each other.
//
// Nothing here needs more than Node itself, so the copy runs with PenEcho closed.

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const MAX_LINES = 60, MAX_CHARS = 200, HISTORY_KEEP = 20;
const RULES_HEADING = "Keeping this file";
const SECTIONS = ["Decisions", "Facts"];
const TOOL_DIR = ".penecho", TOOL_FILE = "memory.cjs", CHANGE_FILE = "memory-change.json";
const SKILL_NAME = "penecho-memory", SKILL_MARK = "<!-- PenEcho's memory skill.";

const RULES = `This file keeps only what no single Topic owns: rules and traps an agent needs whatever it works on. Agents read it only when their work changes how the whole product behaves or a tool misbehaves, and add to it rarely: most Works, and every small fix, add nothing. Change the lines below only with the memory command next to this file, never by editing it: \`sh .penecho/memory help\` on macOS and Linux, \`.penecho\\memory.cmd help\` on Windows. It refuses a line that breaks these rules and says why, and it keeps agents working at the same time from undoing each other.

- **Decisions**: standing rules the owner gave in their own words for the whole product or for how agents work, like "never auto-start a task" or "do not ask the user". Look for "always", "never", "every", "must". Not a plain request, what an agent built, an idea the owner only floated, your own suggestion, or text pasted from another agent. A rule about one page, feature or product goes in that Topic.
- **Facts**: things an agent confirmed by running them that cost time whatever the work: how the shell, sandbox, git, browsers and test tools really behave, how to run and test the project, ports, where tools and logs are, what must not be committed. A trap in a tool stays a fact even after our code works around it. How one feature or outside service behaves goes in that Topic.

Not here: progress, what was built or merged, fixed bugs, test results, commit ids, to-dos, guesses, setup never run, and anything quick to find in the code, git or a Topic.

How:

- One line each, at most ${MAX_CHARS} characters, in plain English. End with exactly the Line id and the date of the event: \`(PE-12, 2026-11-08)\`. State the rule or the cause, not the story. Quote the owner when the wording matters.
- Run \`show\` first. If a line already covers it, add nothing, or replace that line when yours is newer or more correct. A newer word replaces the old line; delete a decision the owner dropped and facts that turn out wrong. "For now" is not a standing rule.
- At most ${MAX_LINES} lines below. When the file is full, merge lines or remove the least useful one in the same \`apply\` as your new line.
- Never edit the text above "Decisions". Say in your final message what you changed here.`;
// PenEcho's earlier rule texts (sha256 of the trimmed text). A file that still has one gets the current rules; rules someone
// rewrote are left alone.
const OLD_RULES = new Set(["a2412eae0af465907e01638f933a3ba5e4fc3a8d859cefcd9e11d41b70d8c044", "94c3e5edb9ffb381d3776799e71af39f0dc95ea223c78da22555b11e051cfadb"]);

// Where the project's knowledge is. Nothing has to be read before a Work (PE-916). Topics are hidden in every project until
// they are redesigned (PE-1066, knowledge.js TOPICS), so the paragraph does not send agents to topics/ or understanding.md.
const knowledgeIntro = prefix => `Lines (\`lines/<name>.md\`) keep every Ask word for word; Work details are in \`works/<name>/work-N.md\`. Read only what your work needs: search with \`rg -n -i "word" lines\` rather than reading whole files. Find a Line by its id: \`rg -l "^id: ${prefix || "PE"}-12$" lines\`. Archived Lines are in \`archive/\`, outside that search.`;
// The same paragraph as a folder an older PenEcho made (layout 1) had it, with its Lines in topics/.
const oldIntro = prefix => `Every Ask is kept word for word in the \`topics\` folder next to this file: one Markdown file per line of work, \`## Ask ·\` headings, newest last, and Work results in \`topics/<line>/work-N.md\`. Search before you guess what the owner wants: \`rg -n -i "word" topics\`. Find a Topic by its id: \`rg -l "^id: ${prefix || "PE"}-12$" topics\`.`;
// Earlier PenEcho paragraphs above the rules, replaced in place: layout 1's, and layout 2's from before PE-916, which had every agent read first.
const OLD_INTRO = /^Every Ask is kept word for word in the `topics` folder next to this file:.*$/m, NEW_INTRO = /^(?:Then read `understanding\.md` next to this file:|Lines \(`lines\/<name>\.md`\) keep every Ask word for word;).*$/m;
const PREV_INTRO = /^Then read `understanding\.md` next to this file:.*$/m;
// Layout 2's paragraph since PE-916, kept current as the knowledge it points to changes (PE-1066).
const LINES_INTRO = /^Lines \(`lines\/<name>\.md`\) keep every Ask word for word;.*$/m;
const OPENING = name => `Rules for the whole of ${name} and tool traps that cost time, which can't quickly be found in the code, git or a Topic. Read it when your work changes how the whole product behaves or a tool misbehaves.`;
const OLD_OPENING = /^What every agent working on (.+) should know before starting, and can't quickly find in the code, git or a Topic\. Read it first\.$/m;
// PenEcho's own paragraphs above the rules say where Lines are, for the folder's layout (layout.js). Nothing else changes.
function introFor(md, layout, prefix) {
  let text = String(md || "").replace(OLD_OPENING, (all, name) => OPENING(name));
  const from = layout === 1 ? NEW_INTRO : text.match(PREV_INTRO) ? PREV_INTRO : text.match(LINES_INTRO) ? LINES_INTRO : OLD_INTRO, found = text.match(from);
  if (!found) return text;
  const own = prefix || (found[0].match(/"\^id: ([A-Z0-9]+)-12\$"/) || [])[1];
  return text.replace(from, () => (layout === 1 ? oldIntro(own) : knowledgeIntro(own)));
}
const YAML_UNSAFE_START = /^[,[\]{}#&*!|>'"%@`]|^[-?:](?:\s|$)|^(?:---|\.\.\.)(?:\s|$)/;
const YAML_UNSAFE_BODY = /:(?:\s|$)|\s#|[\r\n\t\x00-\x1f\x7f\u0085\u2028\u2029]|^\s|\s$/;
function yamlValue(value) {
  const s = String(value);
  if (!s) return '""';
  return YAML_UNSAFE_START.test(s) || YAML_UNSAFE_BODY.test(s)
    ? JSON.stringify(s).replace(/\u0085/g, "\\u0085").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029")
    : s;
}
function unquoteYaml(raw) {
  const s = String(raw || "").trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    try { return JSON.parse(s); } catch { return s; }
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  return s;
}
const intro = (name, prefix, layout = 2) => `---\nproject: ${yamlValue(name)}\n---\n\n# Project memory\n\n${OPENING(name)}\n\n${layout === 1 ? oldIntro(prefix) : knowledgeIntro(prefix)}`;
const head = (name, prefix, layout = 2) => `${intro(name, prefix, layout)}\n\n## ${RULES_HEADING}\n\n${RULES}`;
const EMPTY = "Nothing yet.";
const PLACEHOLDER = /^(nothing recorded yet\.?|nothing yet\.?)$/i;
const initialMemory = (name, prefix, layout = 2) => render({ head:head(name, prefix, layout), sections:Object.fromEntries(SECTIONS.map(s => [s, []])), tail:"" });

// ---------- The file as parts ----------
// Everything above the first entry section, the entry lines of each section, and anything after them under another heading.
// Other text inside a section is kept in `extra`, so nothing is written back that would lose it.
function parse(md) {
  const text = String(md || "").replace(/^﻿/, "").replace(/\r\n/g, "\n"), lines = text.split("\n"), sections = Object.fromEntries(SECTIONS.map(s => [s, []]));
  const at = name => lines.findIndex(l => l.trim().toLowerCase() === `## ${name.toLowerCase()}`);
  const starts = SECTIONS.map(at).filter(i => i >= 0);
  if (!starts.length) return { head:text.trimEnd(), sections, tail:"", extra:[], found:false };
  const first = Math.min(...starts), extra = [];
  let current = null, tailFrom = lines.length;
  for (let i = first; i < lines.length; i++) {
    const h = lines[i].match(/^##\s+(.+?)\s*$/);
    if (h) {
      current = SECTIONS.find(s => s.toLowerCase() === h[1].toLowerCase()) || null;
      if (!current) { tailFrom = i; break; }
      continue;
    }
    const entry = current && lines[i].match(/^[-*]\s+(.+?)\s*$/);
    if (entry) sections[current].push(entry[1]);
    else if (lines[i].trim() && !PLACEHOLDER.test(lines[i].trim())) extra.push(lines[i]);
  }
  return { head:lines.slice(0, first).join("\n").trimEnd(), sections, tail:lines.slice(tailFrom).join("\n").trim(), extra, found:true };
}
function render({ head:top, sections, tail }) {
  const body = SECTIONS.map(s => `## ${s}\n\n${sections[s]?.length ? sections[s].map(l => `- ${l}`).join("\n") : EMPTY}`).join("\n\n");
  return `${top.trimEnd()}\n\n${body}\n${tail ? `\n${tail}\n` : ""}`;
}
const count = m => SECTIONS.reduce((n, s) => n + m.sections[s].length, 0);
const tagOf = (section, i) => `${section[0]}${i + 1}`;
function listing(m) {
  return SECTIONS.map(s => `## ${s}\n${m.sections[s].length ? m.sections[s].map((l, i) => `[${tagOf(s, i)}] ${l}`).join("\n") : "(none yet)"}`).join("\n\n");
}

// ---------- What a line may not be ----------
const ENDING = /\((?:[A-Za-z0-9]+-\d+(?:\/\d+)*(?:[,;]\s*[A-Za-z0-9]+-\d+(?:\/\d+)*)*,\s*)?\d{4}-\d{2}-\d{2}\)$/;
const HIDDEN = /[­᠎​-‏‪-‮⁠-⁤⁦-⁩﻿]/;
const SECRETS = [
  /\bsk-[A-Za-z0-9_-]{16,}/, /\bgh[pousr]_[A-Za-z0-9]{20,}/, /\bgithub_pat_[A-Za-z0-9_]{20,}/, /\bAKIA[0-9A-Z]{16}\b/, /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{30,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/, /\b[a-f0-9]{32}\.[A-Za-z0-9]{12,}\b/,
  /\b(?:api[_-]?key|access[_-]?token|secret|password|passwd)\s*[:=]\s*["']?[^\s"']{8,}/i,
];
// A long run with capitals, small letters and digits all in it is most likely a key. Commit ids and paths are not.
const randomLooking = text => (text.match(/[A-Za-z0-9_\-+/=]{32,}/g) || []).some(t => /[A-Z]/.test(t) && /[a-z]/.test(t) && /\d/.test(t) && !t.includes("/"));
const INJECTION = [
  /\b(?:ignore|disregard|forget)\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier|other)\s+(?:instructions|rules|messages|prompts)\b/i,
  /\byou are now\b/i, /\bnew (?:system )?instructions?\s*:/i, /<\/?(?:system|assistant|user|instructions?)>/i,
  /\b(?:curl|wget)\b[^|\n]*\|\s*(?:sh|bash|zsh|powershell|iex)\b/i,
  /\b(?:send|post|upload|email)\b[^.]{0,40}\b(?:keys?|tokens?|credentials|secrets?|passwords?)\b[^.]{0,20}\bto\b/i,
];
const words = text => String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
function lineProblems(text) {
  const out = [], length = [...text].length;
  if (!text) return ["The line is empty."];
  if (/[\r\n]/.test(text)) out.push("Write it as one line.");
  if (length > MAX_CHARS) out.push(`It has ${length} characters; the limit is ${MAX_CHARS}. Shorten it.`);
  if (!ENDING.test(text)) out.push('End it with the Topic id and the date, like "(PE-12, 2026-11-09)", or only the date when there is no Topic.');
  if (HIDDEN.test(text)) out.push("It has hidden characters (zero-width or text-direction marks). Type it plainly.");
  if (SECRETS.some(re => re.test(text)) || randomLooking(text)) out.push("It looks like it holds a key, token or password. Never put one here: say where it is kept instead.");
  if (INJECTION.some(re => re.test(text))) out.push("It reads like instructions to override an agent's rules or send data away. That never belongs here.");
  return out;
}

// ---------- Changes ----------
// Every op names its line by a piece of its text (or a [D3] tag from the latest show), so changes worked out on one read
// still land on a newer one. All or nothing: if any op is refused, the file stays as it was.
const cleanText = value => String(value ?? "").trim().replace(/^[-*]\s+/, "").replace(/[ \t]+/g, " ");
function findLine(sections, ref) {
  const raw = String(ref ?? "").trim().replace(/^\[|\]$/g, "");
  if (!raw) return { error:"Say which line: a piece of its text, or its tag from show, like D3." };
  const tag = raw.match(/^([DF])(\d+)$/i);
  if (tag) {
    const section = SECTIONS.find(s => s[0] === tag[1].toUpperCase()), i = Number(tag[2]) - 1;
    return i >= 0 && i < sections[section].length ? { section, i } : { error:`There is no line ${raw.toUpperCase()}. Run show to see the current tags.`, list:true };
  }
  const want = words(raw), hits = [];
  for (const s of SECTIONS) sections[s].forEach((l, i) => { if (words(l).includes(want)) hits.push({ section:s, i }); });
  if (!hits.length) return { error:`No line contains "${raw}".`, list:true };
  if (hits.length > 1) return { error:`${hits.length} lines contain "${raw}" (${hits.map(h => tagOf(h.section, h.i)).join(", ")}). Give more of the line, or its tag.`, list:true };
  return hits[0];
}
function applyOps(m, ops) {
  const sections = Object.fromEntries(SECTIONS.map(s => [s, [...m.sections[s]]]));
  const errors = [], notes = [], applied = [], adds = [], edits = [];
  const list = Array.isArray(ops) ? ops : [];
  if (!list.length) errors.push({ text:"There is nothing to change." });
  // Lines are found on the file as it was read, so one op cannot shift another's target.
  for (const op of list) {
    const kind = String(op?.op || "").toLowerCase(), text = cleanText(op?.text), shown = text.length > 60 ? `${text.slice(0, 57)}…` : text;
    if (kind === "add" || kind === "replace") for (const p of lineProblems(text)) errors.push({ text:`${kind} "${shown}": ${p}` });
    if (kind === "add") {
      const section = SECTIONS.find(s => s.toLowerCase() === String(op?.section || "").trim().toLowerCase());
      if (!section) errors.push({ text:`add: say ${SECTIONS.join(" or ")}, not "${op?.section ?? ""}".` });
      else adds.push({ section, text });
    } else if (kind === "replace" || kind === "delete") {
      const found = findLine(m.sections, op?.old ?? op?.id ?? op?.line);
      if (found.error) errors.push({ text:`${kind}: ${found.error}`, list:found.list });
      else if (edits.some(e => e.section === found.section && e.i === found.i)) errors.push({ text:`${kind}: line ${tagOf(found.section, found.i)} is changed twice in one go.` });
      else edits.push({ kind, ...found, text, old:m.sections[found.section][found.i] });
    } else errors.push({ text:`Unknown change "${op?.op ?? ""}": use add, replace or delete.` });
  }
  if (errors.length) return { memory:m, applied, notes, errors };
  for (const e of edits) if (e.kind === "replace") sections[e.section][e.i] = e.text;
  for (const e of [...edits].filter(e => e.kind === "delete").sort((a, b) => b.i - a.i)) sections[e.section].splice(e.i, 1);
  for (const e of edits) applied.push(e.kind === "replace" ? { op:"replace", section:e.section, old:e.old, text:e.text } : { op:"delete", section:e.section, old:e.old });
  for (const a of adds) {
    const same = SECTIONS.flatMap(s => sections[s]).find(l => words(l) === words(a.text));
    if (same) { notes.push(`Already there: ${same}`); continue; }
    sections[a.section].push(a.text); applied.push({ op:"add", section:a.section, text:a.text });
  }
  const total = SECTIONS.reduce((n, s) => n + sections[s].length, 0);
  if (total > MAX_LINES) {
    return { memory:m, applied:[], notes:[], errors:[{ list:true, text:`MEMORY.md would have ${total} lines; the limit is ${MAX_LINES}. Merge or delete ${total - MAX_LINES} in the same apply as your new line.` }] };
  }
  return { memory:{ ...m, sections }, applied, notes, errors };
}

// ---------- The file on disk ----------
const hashOf = text => crypto.createHash("sha256").update(text).digest("hex");
function readState(file) {
  const raw = fs.readFileSync(file, "utf8"), bom = raw.startsWith("﻿"), text = bom ? raw.slice(1) : raw;
  return { raw, text, bom, crlf:/\r\n/.test(text), hash:hashOf(raw) };
}
const encoded = (text, { bom, crlf }) => `${bom ? "﻿" : ""}${crlf ? text.replace(/\r?\n/g, "\r\n") : text}`;
const pause = ms => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { const end = Date.now() + ms; while (Date.now() < end) { /* wait */ } } };
// Written beside the file and renamed over it, so a reader never sees half a file. Windows refuses the rename
// while another program holds the file open, so it tries again for a moment before writing in place.
function writeSafely(file, data, { atomicOnly = false } = {}) {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`);
  fs.writeFileSync(temp, data);
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(temp, file); return; } catch (error) {
      if (!["EPERM", "EACCES", "EBUSY"].includes(error.code) || attempt >= 10) {
        if (atomicOnly) {
          try { fs.unlinkSync(temp); } catch { /* Gone already. */ }
          throw error;
        }
        try { fs.writeFileSync(file, data); } finally { try { fs.unlinkSync(temp); } catch { /* Gone already. */ } }
        return;
      }
      pause(40 + attempt * 30);
    }
  }
}
// The same history PenEcho keeps for files you edit in it: the last 20 versions in the docs folder's .history.
function keepHistory(file, raw) {
  try {
    const dir = path.join(path.dirname(file), ".history"), name = path.basename(file), stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.mkdirSync(dir, { recursive:true });
    fs.writeFileSync(path.join(dir, `${stamp}__${name}`), raw);
    const same = fs.readdirSync(dir).filter(f => f.endsWith(`__${name}`) && !f.includes("__topics__") && !f.includes("__lines__")).sort();
    for (const old of same.slice(0, Math.max(0, same.length - HISTORY_KEEP))) fs.unlinkSync(path.join(dir, old));
  } catch { /* History is a convenience; the change still lands. */ }
}
// One writer at a time, across every agent and program on this computer. A lock left by a crashed run expires.
function withLock(file, fn, { waitMs = 10000, staleMs = 15000, lockFile = "" } = {}) {
  let lock = lockFile;
  if (!lock) {
    let real = path.resolve(file);
    try { real = fs.realpathSync.native(file); } catch { /* Not there yet. */ }
    if (process.platform === "win32" || process.platform === "darwin") real = real.toLowerCase();
    lock = path.join(os.tmpdir(), `penecho-memory-${hashOf(real).slice(0, 16)}.lock`);
  } else {
    fs.mkdirSync(path.dirname(lock), { recursive:true });
  }
  const until = Date.now() + waitMs;
  for (;;) {
    try { const fd = fs.openSync(lock, "wx"); fs.writeSync(fd, String(process.pid)); fs.closeSync(fd); break; } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > staleMs) { fs.unlinkSync(lock); continue; } } catch { continue; }
      if (Date.now() > until) throw new Error("Another agent is changing MEMORY.md right now. Run the command again in a moment.");
      pause(30 + Math.floor(Math.random() * 40));
    }
  }
  try { return fn(); } finally { try { fs.unlinkSync(lock); } catch { /* Someone cleared it. */ } }
}
// Reads, changes, and writes only if nobody else wrote since the read; otherwise does it again on the newer file.
function change(file, ops) {
  return withLock(file, () => {
    for (let round = 0; round < 3; round++) {
      const before = readState(file), m = parse(before.text);
      if (!m.found) return { ok:false, errors:[{ text:`${file} has no "## Decisions" or "## Facts" heading, so there is nowhere to put a line. Ask the owner.` }] };
      if (m.extra.length) return { ok:false, memory:m, errors:[{ text:`Under Decisions or Facts there is text that is not a "- " line, so writing could lose it: "${m.extra[0].trim().slice(0, 80)}". Make it one "- " line (or move it under another heading) by hand first.` }] };
      const step = applyOps(m, ops);
      if (step.errors.length) return { ok:false, memory:m, errors:step.errors };
      if (!step.applied.length) return { ok:true, memory:m, applied:[], notes:step.notes };
      const next = encoded(render(step.memory), before);
      if (readState(file).hash !== before.hash) continue;
      keepHistory(file, before.raw);
      writeSafely(file, next);
      return { ok:true, memory:step.memory, applied:step.applied, notes:step.notes };
    }
    return { ok:false, errors:[{ text:"MEMORY.md kept changing while this ran, so nothing was written. Run it again." }] };
  });
}

// ---------- The command ----------
function helpText(file) {
  return `PenEcho memory: changes ${file} by the rules in its "${RULES_HEADING}" part.

  show                           every line, tagged D1, D2 … and F1, F2 …
  add <Decisions|Facts> <line>   add a line
  replace <old> <new line>       replace the line that contains <old> (a piece of its text, or its tag)
  delete <old>                   delete the line that contains <old>
  apply [file]                   several changes at once, all or nothing, from a JSON file
                                 (default: ${path.join(path.dirname(file), TOOL_DIR, CHANGE_FILE)}, removed once applied)
                                 {"ops":[{"op":"delete","old":"…"},{"op":"replace","old":"…","text":"…"},{"op":"add","section":"Facts","text":"…"}]}

A line: one line, at most ${MAX_CHARS} characters, ending with the Topic id and date, like (PE-12, 2026-11-09).
Wrap a line in single quotes. If it has a quote mark in it, or you are in Windows PowerShell, use apply.`;
}
function said(result) {
  const out = [];
  for (const a of result.applied || []) out.push(a.op === "add" ? `Added to ${a.section}: ${a.text}` : a.op === "replace" ? `Replaced: ${a.old}\n     with: ${a.text}` : `Deleted: ${a.old}`);
  out.push(...(result.notes || []));
  if (!(result.applied || []).length && !(result.notes || []).length) out.push("Nothing changed.");
  if (result.memory) out.push(`MEMORY.md has ${count(result.memory)} of ${MAX_LINES} lines.`);
  return out.join("\n");
}
function opsFrom(args, file) {
  const [verb, ...rest] = args;
  if (verb === "add") return [{ op:"add", section:rest[0], text:rest.slice(1).join(" ") }];
  if (verb === "replace") return [{ op:"replace", old:rest[0], text:rest.slice(1).join(" ") }];
  if (verb === "delete") return [{ op:"delete", old:rest.join(" ") }];
  const source = rest[0] === "-" ? 0 : path.resolve(rest[0] || path.join(path.dirname(file), TOOL_DIR, CHANGE_FILE));
  let data;
  try { data = JSON.parse(fs.readFileSync(source, "utf8").replace(/^﻿/, "")); } catch (error) {
    throw new Error(error.code === "ENOENT" ? `There is no ${source}. Write the changes there as JSON first.` : `That is not valid JSON: ${error.message}`);
  }
  return { ops:Array.isArray(data) ? data : data?.ops, source };
}
function main(args = process.argv.slice(2), { file = path.join(__dirname, "..", "MEMORY.md"), out = s => process.stdout.write(`${s}\n`), err = s => process.stderr.write(`${s}\n`) } = {}) {
  const verb = String(args[0] || "help").toLowerCase();
  if (["help", "-h", "--help"].includes(verb)) { out(helpText(file)); return 0; }
  if (!fs.existsSync(file)) { err(`There is no ${file}. Open the project in PenEcho once to make it.`); return 1; }
  if (verb === "show") {
    const m = parse(readState(file).text);
    if (!m.found) { err(`${file} has no "## Decisions" or "## Facts" heading.`); return 1; }
    out(`${file}\n${count(m)} of ${MAX_LINES} lines, each at most ${MAX_CHARS} characters.\n\n${listing(m)}`);
    return 0;
  }
  if (!["add", "replace", "delete", "apply"].includes(verb)) { err(`Unknown command "${args[0]}".\n\n${helpText(file)}`); return 2; }
  let ops, source = null;
  try { const got = opsFrom([verb, ...args.slice(1)], file); ops = Array.isArray(got) ? got : got.ops; source = Array.isArray(got) ? null : got.source; } catch (error) { err(error.message); return 2; }
  let result;
  try { result = change(file, ops); } catch (error) { err(error.message); return 1; }
  if (!result.ok) {
    err(`Nothing was changed:\n- ${result.errors.map(e => e.text).join("\n- ")}`);
    if (result.memory && result.errors.some(e => e.list)) out(`The file now:\n\n${listing(result.memory)}`);
    return 1;
  }
  if (source && source !== 0) { try { fs.unlinkSync(source); } catch { /* Already gone. */ } }
  out(said(result));
  return 0;
}

// ---------- What PenEcho puts in place ----------
// The command, next to MEMORY.md, with launchers that use Node if the agent's shell has it, or else the program PenEcho
// last ran on (for the desktop app, Electron run as Node).
const shQuote = s => `'${String(s).replace(/'/g, "'\\''")}'`;
function launchers(runtime = process.execPath, toolFile = TOOL_FILE) {
  const shared = toolFile !== TOOL_FILE;
  const sh = `#!/bin/sh
# ${shared ? "PenEcho's shared memory command: resolves this folder's project, then follows its rules." : "PenEcho's memory command: changes MEMORY.md next to this folder by its rules."} Try: sh ${shared ? "~/.penecho/memory" : ".penecho/memory"} help
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if command -v node >/dev/null 2>&1; then exec node "$here/${toolFile}" "$@"; fi
run=${shQuote(runtime)}
if [ -x "$run" ]; then ELECTRON_RUN_AS_NODE=1 exec "$run" "$here/${toolFile}" "$@"; fi
echo "PenEcho's memory command needs Node.js or PenEcho on this computer." >&2
exit 127
`;
  const cmd = [
    "@echo off",
    `rem ${shared ? "PenEcho's shared memory command: resolves this folder's project, then follows its rules." : "PenEcho's memory command: changes MEMORY.md next to this folder by its rules."} Try: ${shared ? "%USERPROFILE%\\.penecho\\memory.cmd" : ".penecho\\memory.cmd"} help`,
    "setlocal",
    `set "RUN=${String(runtime).replace(/"/g, "")}"`,
    "where node >nul 2>nul",
    "if not errorlevel 1 goto node",
    'if exist "%RUN%" goto penecho',
    "echo PenEcho's memory command needs Node.js or PenEcho on this computer. 1>&2",
    "exit /b 127",
    ":node",
    `node "%~dp0${toolFile}" %*`,
    "exit /b %ERRORLEVEL%",
    ":penecho",
    'set "ELECTRON_RUN_AS_NODE=1"',
    `"%RUN%" "%~dp0${toolFile}" %*`,
    "exit /b %ERRORLEVEL%",
    "",
  ].join("\r\n");
  return { memory:sh, "memory.cmd":cmd };
}
// The rules for keeping understanding.md and the Topics, in one file of their own so a better version can replace it whole.
// Copied beside the memory command, so an agent finds it with PenEcho closed.
const GUIDE_FILE = "topics-guide.md";
// This file and the Topics guide, read again only when their files change: every project's 3-second look read both again.
const shipped = new Map();
function shippedText(file) {
  const stat = fs.statSync(file), version = `${stat.dev}:${stat.ino}:${stat.ctimeMs}:${stat.mtimeMs}:${stat.size}`, known = shipped.get(file);
  if (known?.version === version) return known.text;
  const text = fs.readFileSync(file, "utf8");
  shipped.set(file, { version, text });
  return text;
}
function topicsGuide() {
  try { return { [GUIDE_FILE]:shippedText(path.join(__dirname, GUIDE_FILE)) }; } catch { return {}; }
}
const written = new Map();
let lastKey = null;
function installTool(docs, { runtime = process.execPath } = {}) {
  const dir = path.join(docs, TOOL_DIR), files = { [TOOL_FILE]:shippedText(__filename), ...launchers(runtime), ...topicsGuide() };
  // The same texts give the same key; it is worked out again only when one of them was read again.
  const texts = Object.values(files), same = lastKey && lastKey.texts.length === texts.length && lastKey.texts.every((text, i) => text === texts[i]);
  const key = same ? lastKey.key : hashOf(JSON.stringify(files));
  if (!same) lastKey = { texts, key };
  if (written.get(dir) === key && Object.keys(files).every(name => fs.existsSync(path.join(dir, name)))) return false;
  fs.mkdirSync(dir, { recursive:true });
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(dir, name);
    let now = null;
    try { now = fs.readFileSync(file, "utf8"); } catch { /* Not there yet. */ }
    if (now !== text) writeSafely(file, text);
    if (name === "memory") { try { fs.chmodSync(file, 0o755); } catch { /* Windows has no mode bits; sh runs it anyway. */ } }
  }
  written.set(dir, key);
  return true;
}
// The command an agent types, on this computer.
function commandFor(docs, platform = process.platform) {
  const dir = path.join(docs, TOOL_DIR);
  if (platform === "win32") return `& ${shQuote(path.join(dir, "memory.cmd").replace(/\\/g, "/"))}`;
  return `sh ${shQuote(path.join(dir, "memory"))}`;
}
function skillText({ name, docs, platform = process.platform }) {
  const cmd = commandFor(docs, platform), file = path.join(docs, "MEMORY.md"), change = path.join(docs, TOOL_DIR, CHANGE_FILE);
  const shown = platform === "win32" ? file.replace(/\\/g, "/") : file;
  const desc = `Read and update the project memory (MEMORY.md) of "${String(name).replace(/\s+/g, " ").replace(/"/g, "'")}". Use when your work changes how the whole product behaves or a tool misbehaves, and before your final message only when the owner gave a rule for the whole product or for how agents work, or you confirmed a tool trap that costs time on any Topic.`;
  return `---
name: ${SKILL_NAME}
description: ${yamlValue(desc)}
---

${SKILL_MARK} Remove it in the settings of the project "${String(name).replace(/\s+/g, " ")}" in PenEcho. -->

# Project memory

The memory of this project is \`${shown}\`. Read it when your work changes how the whole product behaves or a tool misbehaves; its "${RULES_HEADING}" part says what belongs there.

Change it only with this command, never by editing the file:

\`\`\`
${cmd} show
${cmd} add Facts '<line>'
${cmd} replace '<part of the old line>' '<new line>'
${cmd} delete '<part of the old line>'
\`\`\`
${platform === "win32" ? "\nIn Git Bash, leave out the `& ` at the start.\n" : ""}
- It keeps only what no single Topic owns. A decision or trap about one feature, page, product or outside service goes in that Topic, not here. Most work adds nothing.
- One line each, at most ${MAX_CHARS} characters, ending with the Topic id and the date: \`(PE-12, 2026-11-09)\`.
- If the command refuses, it says why: fix the line and run it again. When the file is full it shows every line: merge or delete some in the same apply as your new line.
- Several changes at once, or a line with a quote mark in it${platform === "win32" ? " (always in Windows PowerShell)" : ""}: write \`{"ops":[{"op":"delete","old":"…"},{"op":"add","section":"Facts","text":"…"}]}\` to \`${platform === "win32" ? change.replace(/\\/g, "/") : change}\` with your file tool, then run \`${cmd} apply\`.
- Say in your final message what you changed.
`;
}

// ---------- One skill and command for every project on this computer ----------
const USER_SKILL_HOMES = [[".claude", "skills"], [".agents", "skills"]], HOME_TOOL_FILE = "memory-home.cjs", HOME_CORE_FILE = "memory-core.cjs", REGISTRY_FILE = "memory-projects.json";
function userSkillPlaces(home) { return USER_SKILL_HOMES.map(parts => path.join(home, ...parts, SKILL_NAME, "SKILL.md")); }
function userSkillText(platform = process.platform) {
  const cmd = platform === "win32" ? '& "$env:USERPROFILE\\.penecho\\memory.cmd"' : "sh ~/.penecho/memory";
  return `---
name: ${SKILL_NAME}
description: Read and update the project memory (MEMORY.md) of the local PenEcho project containing the current folder, including a linked Git worktree. Use when your work changes how the whole product behaves or a tool misbehaves, and before your final message only when the owner gave a rule for the whole product or for how agents work, or you confirmed a tool trap that costs time on any Topic.
---

${SKILL_MARK} Installed by the local PenEcho desktop app. Manage it in each project's settings. -->

# Project memory

First run \`${cmd} where\`. It works offline, with PenEcho closed, and resolves the current folder (or \`--cwd <dir>\`) to its non-archived local PenEcho project. Read the resolved MEMORY.md, including its "${RULES_HEADING}" part, when your work changes how the whole product behaves or a tool misbehaves. If no project matches, or its memory or memory skill is disabled, the command says so and changes nothing.

Change memory only with this shared command, never by editing MEMORY.md by hand:

\`\`\`
${cmd} help
${cmd} where
${cmd} show
${cmd} add Facts '<line>'
${cmd} replace '<part of the old line>' '<new line>'
${cmd} delete '<part of the old line>'
${cmd} apply
\`\`\`

${platform === "win32" ? "In Windows PowerShell use the command above. In cmd.exe, omit the leading `& ` and call `%USERPROFILE%\\.penecho\\memory.cmd` instead.\n" : ""}- \`where\` prints the project name, docsPath, MEMORY.md path and command. \`show\` reads the entries with their tags.
- It keeps only what no single Topic owns. A decision or trap about one feature, page, product or outside service goes in that Topic, not here. Most work adds nothing.
- One line each, at most ${MAX_CHARS} characters, ending with the Topic id and the date: \`(PE-12, 2026-11-09)\`.
- If the command refuses, it says why: fix the line and run it again. When the file is full it shows every line: merge or delete some in the same apply as your new line.
- Several changes at once, or a line with a quote mark in it: write \`{"ops":[{"op":"delete","old":"…"},{"op":"add","section":"Facts","text":"…"}]}\` to the resolved project's \`.penecho/memory-change.json\` with your file tool, then run \`${cmd} apply\`. You can also pass an explicit JSON file after \`apply\`.
- The command preserves the project's validation, locking, history and apply-file semantics, with PenEcho open or closed.
- Say in your final message what you changed.
`;
}
function userSkillStatus(home) {
  const text = userSkillText(), places = userSkillPlaces(home).map(file => {
    let now = null;
    try { now = fs.readFileSync(file, "utf8"); } catch { /* Not there. */ }
    return { path:file, state:now === null ? "missing" : !now.includes(SKILL_MARK) ? "yours" : now === text ? "installed" : "outdated" };
  });
  return { installed:places.some(place => place.state === "installed" || place.state === "outdated"), places };
}
function registryList(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return (Array.isArray(data) ? data : Array.isArray(data?.projects) ? data.projects : []).filter(item => typeof item === "string" && item);
  } catch { return []; }
}
function installUserSkill(home, registryFiles = [], { runtime = process.execPath } = {}) {
  const text = userSkillText();
  for (const file of userSkillPlaces(home)) {
    let now = null;
    try { now = fs.readFileSync(file, "utf8"); } catch { /* Not there yet. */ }
    // Someone's own penecho-memory skill is never replaced.
    if (now !== null && !now.includes(SKILL_MARK)) continue;
    fs.mkdirSync(path.dirname(file), { recursive:true });
    if (now !== text) writeSafely(file, text);
  }
  const dir = path.join(home, TOOL_DIR), files = {
    [HOME_TOOL_FILE]:fs.readFileSync(path.join(__dirname, HOME_TOOL_FILE), "utf8"),
    [HOME_CORE_FILE]:fs.readFileSync(__filename, "utf8"),
    ...launchers(runtime, HOME_TOOL_FILE),
  };
  fs.mkdirSync(dir, { recursive:true });
  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(dir, name);
    let now = null;
    try { now = fs.readFileSync(file, "utf8"); } catch { /* Not there yet. */ }
    if (now !== contents) writeSafely(file, contents);
    if (name === "memory") { try { fs.chmodSync(file, 0o755); } catch { /* Windows has no mode bits; sh runs it anyway. */ } }
  }
  const registry = path.join(dir, REGISTRY_FILE), active = (Array.isArray(registryFiles) ? registryFiles : [registryFiles]).filter(file => typeof file === "string" && file);
  // Several PenEcho processes can share one home (even with different TMPDIRs). Lock beside the registry and rename atomically.
  withLock(registry, () => {
    const all = [...active, ...registryList(registry)].map(file => path.resolve(file)), seen = new Set(), merged = [];
    for (const file of all) {
      const key = process.platform === "darwin" || process.platform === "win32" ? file.toLowerCase() : file;
      if (!seen.has(key)) { seen.add(key); merged.push(file); }
    }
    const serialized = `${JSON.stringify(merged, null, 2)}\n`;
    let now = null;
    try { now = fs.readFileSync(registry, "utf8"); } catch { /* Not there yet. */ }
    if (now !== serialized) writeSafely(registry, serialized, { atomicOnly:true });
  }, { lockFile:path.join(dir, ".memory-projects.lock") });
  return userSkillStatus(home);
}

// ---------- Older files ----------
// PenEcho's older MEMORY.md, with What matters / Decisions / Landed, becomes the new one: lines people wrote stay,
// a Landed list of merged Topics goes, because the README already lists them. A file that has the sections but lost
// its rules gets them back above the sections. Anyone's own file, in any other shape, is left exactly as it is.
const OLD_SECTIONS = new Set(["what matters", "decisions", "landed"]);
function checkedMemory(md, name, prefix, { layout = 2 } = {}) {
  // PenEcho's own paragraph above the rules says where Lines are: once the folder is in layout 2, it says so (layout.js).
  md = introFor(md, layout, prefix);
  const text = String(md || "").replace(/\r\n/g, "\n"), headings = [...text.matchAll(/^##\s+(.+?)\s*$/gm)].map(m => m[1].toLowerCase());
  const hasRules = headings.includes(RULES_HEADING.toLowerCase()), m = parse(text);
  const old = /^# Project memory\s*$/m.test(text) && headings.length > 0 && headings.every(h => OLD_SECTIONS.has(h) || h === RULES_HEADING.toLowerCase()) && (headings.includes("what matters") || headings.includes("landed"));
  if (!old) {
    if (m.found && !hasRules && !m.extra.length) return render({ ...m, head:`${m.head.trimEnd()}\n\n## ${RULES_HEADING}\n\n${RULES}` });
    const rules = hasRules && text.match(new RegExp(`(^## ${RULES_HEADING}[ \\t]*\\n)([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m"));
    if (rules && OLD_RULES.has(hashOf(rules[2].trim()))) return text.replace(rules[0], () => `${rules[1]}\n${RULES}\n\n`);
    return String(md || "");
  }
  const own = [], seen = new Set();
  let section = "";
  for (const line of text.split("\n")) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) { section = h[1].toLowerCase(); continue; }
    if (!OLD_SECTIONS.has(section)) continue;
    const kept = line.replace(/^\s*[-*]\s+/, "").trim();
    if (!kept || PLACEHOLDER.test(kept)) continue;
    if (section === "landed" && /\]\(topics\/[^)]+\.md\)\s*$/.test(kept)) continue;
    if (!seen.has(kept)) { seen.add(kept); own.push(kept); }
  }
  const front = text.match(/^---\n[\s\S]*?\bproject:\s*(.+)\n[\s\S]*?---/);
  return render({ head:head(name || unquoteYaml(front?.[1]) || "this project", prefix, layout), sections:{ Decisions:own, Facts:[] }, tail:"" });
}

module.exports = {
  MAX_LINES, MAX_CHARS, SECTIONS, RULES, RULES_HEADING, TOOL_DIR, TOOL_FILE, CHANGE_FILE, SKILL_NAME, SKILL_MARK, GUIDE_FILE, HOME_TOOL_FILE, HOME_CORE_FILE, REGISTRY_FILE, knowledgeIntro, introFor,
  initialMemory, parse, render, listing, lineProblems, applyOps, change, main, checkedMemory, launchers, installTool, commandFor, skillText, userSkillPlaces, userSkillText, userSkillStatus, installUserSkill,
};

if (require.main === module) process.exitCode = main();
