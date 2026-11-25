"use strict";
// The knowledge layer (layout.js, topics-guide.md): understanding.md and the Topics in topics/. A Line's Topic is the Topic whose
// "## Lines" table links the Line; agents never have to edit a Line to say so. Agents running a Work neither read nor rewrite it:
// a requirement one names in its last message is filed here, by PenEcho, with no tokens (applyRequirement, PE-916).
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const L = require("./layout.js");
const F = require("./format.js");

const MAX_TOPICS = 400, MAX_AREAS = 40, MAX_BYTES = 1024 * 1024, MOST_CACHED_TOPICS = 2000, MOST_CACHED_AREAS = 500;
const LINKS = /\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g;
const AREA_HEADING = /^\*\*([^*\[\]\n]+?)\*\*(?:\s*[—–:-]\s*(.*))?$/;
const NOT_IN_TOPIC = /^\*\*not in a topic\b/i;
const nameKey = value => String(value ?? "").replace(/\s+/g, " ").trim().normalize("NFKC").toLowerCase();
const versionOf = stat => (stat ? `${stat.dev}:${stat.ino}:${stat.ctimeMs}:${stat.mtimeMs}:${stat.size}` : "");
// Topic files and understanding.md are read and parsed only when a file changes, instead of on every page state rebuild (PE-988).
const topicCache = new Map(), areasCache = new Map();
const cloneTopic = t => ({ ...t, left:[...t.left], lines:[...t.lines] });
function goalParagraph(goal) {
  return !goal ? "" : goal.includes("*") ? `Scope: ${goal}` : `**${goal}**`;
}
function emptyTopic({ id, title, area = "", goal = "", parentId = "", date }) {
  const front = [
    "record_type: topic",
    `id: ${id}`,
    F.formatFrontLine("title", title),
    ...(area ? [F.formatFrontLine("area", area)] : []),
    `parent_id: ${parentId ? F.formatFrontValue(parentId) : "null"}`,
    `updated: ${date}`,
  ].join("\n");
  const scope = goal ? `${goalParagraph(goal)}\n\n` : "";
  return `---\n${front}\n---\n\n# ${title}\n\n${scope}## Lines\n\n| Line | What it is | Requirements |\n| --- | --- | --- |\n`;
}
function updateTopicMarkdown(text, { title, area = "", hasArea = false, goal = "", hasGoal = false, parentId = "", hasParentId = false, date = "" } = {}) {
  const cr = /\r\n/.test(text);
  let md = String(text || "").replace(/\r\n/g, "\n");
  const patch = {};
  if (title) patch.title = title;
  if (hasArea) patch.area = area || null;
  if (hasParentId) patch.parent_id = parentId || "null";
  if (date) patch.updated = date;
  if (Object.keys(patch).length) md = F.setFront(md, patch);

  const { front, order, body } = F.splitFront(md);
  const head = order.length ? `---\n${order.map(k => F.formatFrontLine(k, front[k])).join("\n")}\n---\n\n` : "";
  const lines = body.replace(/^\n+/, "").split("\n");
  let fence = "", h1At = -1, firstH2 = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], m = line.match(/^(```|~~~)/);
    if (fence) { if (line.startsWith(fence)) fence = ""; continue; }
    if (m) { fence = m[1]; continue; }
    if (h1At < 0 && /^#\s+/.test(line)) h1At = i;
    if (/^##\s+/.test(line)) { firstH2 = i; break; }
  }
  if (title) {
    if (h1At >= 0) lines[h1At] = `# ${title}`;
    else { lines.unshift(`# ${title}`, ""); h1At = 0; firstH2 += 2; }
  }
  if (hasGoal) {
    let goalAt = -1;
    fence = "";
    for (let i = 0; i < firstH2; i++) {
      const line = lines[i], m = line.match(/^(```|~~~)/);
      if (fence) { if (line.startsWith(fence)) fence = ""; continue; }
      if (m) { fence = m[1]; continue; }
      if (/^\*\*[^*\n]+\*\*\s*$/.test(line.trim())) { goalAt = i; break; }
    }
    const nextGoal = goalParagraph(goal);
    if (goalAt >= 0) {
      if (nextGoal) lines[goalAt] = nextGoal;
      else {
        lines.splice(goalAt, 1);
        if (goalAt < lines.length && !lines[goalAt].trim() && (goalAt === 0 || !lines[goalAt - 1].trim())) lines.splice(goalAt, 1);
      }
    } else if (nextGoal) {
      const insertAt = h1At >= 0 ? h1At + 1 : 0;
      const beforeBlank = insertAt > 0 && lines[insertAt - 1].trim() !== "";
      const afterBlank = insertAt < lines.length && lines[insertAt].trim() !== "";
      const add = [...(beforeBlank ? [""] : []), nextGoal, ...(afterBlank ? [""] : [])];
      lines.splice(insertAt, 0, ...add);
    }
  }
  const out = `${head}${lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "")}`;
  return cr ? out.replace(/\n/g, "\r\n") : out;
}
function ensureUnderstanding(text, { projectName = "Project", date = "" } = {}) {
  const existing = String(text || "");
  if (existing.trim()) return existing;
  const front = [
    "record_type: project-understanding",
    F.formatFrontLine("project", projectName || "Project"),
    ...(date ? [`updated: ${date}`] : []),
  ].join("\n");
  return `---\n${front}\n---\n\n# ${projectName || "Project"}\n\n## Topics\n`;
}
function linkTargetOf(line) {
  const m = String(line || "").match(/^\s*[-*]\s+(?:\*\*)?\[[^\]]*\]\(([^)\s]+)\)/);
  return m ? decode(m[1].split("#")[0]).replace(/^\.\//, "") : "";
}
function trimBlankEdges(lines) {
  const out = [...lines];
  while (out.length && !out[0].trim()) out.shift();
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out;
}
function editTopicsSection(text, { projectName = "Project", date = "", createIfMissing = false } = {}, transform) {
  const raw = String(text || "");
  if (!raw.trim() && !createIfMissing) return raw;
  const cr = /\r\n/.test(raw);
  let md = ensureUnderstanding(raw, { projectName, date }).replace(/\r\n/g, "\n");
  const all = md.split("\n");
  let start = all.findIndex(line => /^##\s+Topics\s*$/i.test(line));
  if (start < 0) {
    if (!createIfMissing) return raw;
    if (all.length && all[all.length - 1].trim()) all.push("");
    start = all.length;
    all.push("## Topics", "");
  }
  let end = all.length;
  for (let i = start + 1; i < all.length; i++) {
    if (/^##\s+/.test(all[i])) { end = i; break; }
  }
  const body = all.slice(start + 1, end);
  const preamble = [], blocks = [], tail = [];
  let cur = null, inTail = false;
  for (const line of body) {
    if (inTail) { tail.push(line); continue; }
    if (NOT_IN_TOPIC.test(line.trim())) { inTail = true; tail.push(line); continue; }
    const heading = line.match(AREA_HEADING);
    if (heading && !NOT_IN_TOPIC.test(line.trim())) {
      cur = { name:heading[1].trim(), goal:String(heading[2] || "").trim(), rawHeading:line, lines:[] };
      blocks.push(cur);
      continue;
    }
    if (cur) cur.lines.push(line);
    else preamble.push(line);
  }
  const changed = transform({ preamble, blocks, tail });
  if (changed === false) return raw;
  const pieces = [];
  const pre = trimBlankEdges(preamble);
  if (pre.length) pieces.push(pre.join("\n"));
  for (const b of blocks) {
    const headingLine = b.rawHeading || (b.goal ? `**${b.name}** — ${b.goal}` : `**${b.name}**`);
    const bLines = trimBlankEdges(b.lines);
    pieces.push(bLines.length ? `${headingLine}\n\n${bLines.join("\n")}` : headingLine);
  }
  const tailLines = trimBlankEdges(tail);
  if (tailLines.length) pieces.push(tailLines.join("\n"));
  const rebuilt = pieces.join("\n\n").replace(/\n{3,}/g, "\n\n");
  const nextLines = [...all.slice(0, start + 1), ...(rebuilt ? ["", ...rebuilt.split("\n")] : []), ...(end < all.length ? ["", ...all.slice(end)] : [""])];
  md = nextLines.join("\n").replace(/\n{3,}/g, "\n\n");
  if (date && /^---\n[\s\S]*?\n---\n/.test(md)) md = F.setFront(md, { updated:date });
  return cr ? md.replace(/\n/g, "\r\n") : md;
}
function formatTopicBullet(title, relPath, goal) {
  return `- **[${title}](${relPath})**${goal ? ` — ${goal}` : ""}`;
}
function extractTopicBullet(lists, relPath) {
  for (const list of lists) {
    for (let i = 0; i < list.length; i++) {
      if (linkTargetOf(list[i]) === relPath) {
        const [removed] = list.splice(i, 1);
        while (i < list.length && /^\s{2,}[-*]\s+/.test(list[i])) {
          list[i] = list[i].replace(/^ {1,2}/, "");
          i++;
        }
        return removed;
      }
    }
  }
  return "";
}
function rewriteTopicBullet(line, { title, relPath, oldGoal = "", goal = "", hasGoal = false }) {
  let out = line.replace(/^(\s*[-*]\s+(?:\*\*)?)\[[^\]]*\](\([^)\s]+\))/, `$1[${title}](${relPath})`);
  if (hasGoal) {
    const escaped = relPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = out.match(new RegExp(`^(\\s*[-*]\\s+(?:\\*\\*)?\\[[^\\]]*\\]\\(${escaped}\\)(?:\\*\\*)?)(?:\\s*[—–-]\\s*(.*))?$`));
    if (m) {
      const rest = String(m[2] || "").trim();
      if (!rest || (oldGoal && rest === oldGoal)) out = `${m[1]}${goal ? ` — ${goal}` : ""}`;
    }
  }
  return out;
}
function upsertAreaInUnderstanding(text, { name, goal = "", hasGoal = false, projectName = "Project", date = "" }) {
  return editTopicsSection(text, { projectName, date, createIfMissing:true }, ({ blocks }) => {
    const found = blocks.find(b => nameKey(b.name) === nameKey(name));
    if (found) {
      found.name = name;
      if (hasGoal || goal) {
        found.goal = goal;
        found.rawHeading = goal ? `**${name}** — ${goal}` : `**${name}**`;
      } else {
        found.rawHeading = found.goal ? `**${name}** — ${found.goal}` : `**${name}**`;
      }
    } else {
      blocks.push({ name, goal, rawHeading:goal ? `**${name}** — ${goal}` : `**${name}**`, lines:[] });
    }
  });
}
function renameAreaInUnderstanding(text, { oldName, newName, goal = "", hasGoal = false, projectName = "Project", date = "" }) {
  return editTopicsSection(text, { projectName, date, createIfMissing:Boolean(String(text || "").trim() || hasGoal) }, ({ blocks }) => {
    const found = blocks.find(b => nameKey(b.name) === nameKey(oldName));
    if (found) {
      found.name = newName;
      if (hasGoal) found.goal = goal;
      found.rawHeading = found.goal ? `**${newName}** — ${found.goal}` : `**${newName}**`;
    } else {
      blocks.push({ name:newName, goal:hasGoal ? goal : "", rawHeading:hasGoal && goal ? `**${newName}** — ${goal}` : `**${newName}**`, lines:[] });
    }
  });
}
function deleteAreaInUnderstanding(text, { name, removeTopicPaths = [], date = "" }) {
  const removeSet = new Set(removeTopicPaths);
  return editTopicsSection(text, { date, createIfMissing:false }, ({ preamble, blocks }) => {
    const at = blocks.findIndex(b => nameKey(b.name) === nameKey(name));
    if (at >= 0) {
      const [gone] = blocks.splice(at, 1);
      for (const line of gone.lines) {
        const target = linkTargetOf(line);
        if (target && removeSet.has(target)) continue;
        if (target) preamble.push(line);
      }
    }
    for (const relPath of removeSet) extractTopicBullet([preamble, ...blocks.map(b => b.lines)], relPath);
  });
}
function upsertTopicInUnderstanding(text, { title, relPath, area = "", goal = "", projectName = "Project", date = "" }) {
  const hasExisting = Boolean(String(text || "").trim());
  const hasTopicsSection = /^##\s+Topics\s*$/im.test(String(text || ""));
  if (!area && (!hasExisting || !hasTopicsSection)) return String(text || "");
  return editTopicsSection(text, { projectName, date, createIfMissing:Boolean(area) }, ({ preamble, blocks }) => {
    extractTopicBullet([preamble, ...blocks.map(b => b.lines)], relPath);
    const bullet = formatTopicBullet(title, relPath, goal);
    if (area) {
      let block = blocks.find(b => nameKey(b.name) === nameKey(area));
      if (!block) {
        block = { name:area, goal:"", rawHeading:`**${area}**`, lines:[] };
        blocks.push(block);
      }
      block.lines.push(bullet);
    } else {
      preamble.push(bullet);
    }
  });
}
function updateTopicInUnderstanding(text, { relPath, title, area = "", hasArea = false, oldGoal = "", goal = "", hasGoal = false, projectName = "Project", date = "" }) {
  const raw = String(text || "");
  const needCreate = Boolean(hasArea && area);
  if (!raw.trim() && !needCreate) return raw;
  const hasTopicsSection = /^##\s+Topics\s*$/im.test(raw);
  if (!hasTopicsSection && !needCreate) return raw;
  return editTopicsSection(raw, { projectName, date, createIfMissing:needCreate }, ({ preamble, blocks }) => {
    const lists = [preamble, ...blocks.map(b => b.lines)];
    let foundList = null, foundIndex = -1;
    for (const list of lists) {
      const i = list.findIndex(line => linkTargetOf(line) === relPath);
      if (i >= 0) { foundList = list; foundIndex = i; break; }
    }
    if (!hasArea) {
      if (!foundList) return false;
      foundList[foundIndex] = rewriteTopicBullet(foundList[foundIndex], { title, relPath, oldGoal, goal, hasGoal });
      return true;
    }
    const existing = extractTopicBullet(lists, relPath);
    const bullet = existing ? rewriteTopicBullet(existing, { title, relPath, oldGoal, goal, hasGoal }) : formatTopicBullet(title, relPath, hasGoal ? goal : oldGoal);
    if (area) {
      let block = blocks.find(b => nameKey(b.name) === nameKey(area));
      if (!block) {
        block = { name:area, goal:"", rawHeading:`**${area}**`, lines:[] };
        blocks.push(block);
      }
      block.lines.push(bullet);
    } else {
      preamble.push(bullet);
    }
    return true;
  });
}
function removeTopicFromUnderstanding(text, { relPath, date = "" }) {
  if (!/^##\s+Topics\s*$/im.test(String(text || ""))) return String(text || "");
  return editTopicsSection(text, { date, createIfMissing:false }, ({ preamble, blocks }) => {
    const removed = extractTopicBullet([preamble, ...blocks.map(b => b.lines)], relPath);
    if (!removed) return false;
    return true;
  });
}
const STATUS_PREFIX = (() => {
  const month = "(?:January|Jan\\.?|February|Feb\\.?|March|Mar\\.?|April|Apr\\.?|May|June|Jun\\.?|July|Jul\\.?|August|Aug\\.?|September|Sep(?:t|tember)?\\.?|October|Oct\\.?|November|Nov\\.?|December|Dec\\.?)";
  const day = "(?:0?[1-9]|[12]\\d|3[01])";
  const date = `(?:\\d{4}-(?:0[1-9]|1[0-2])-${day}|${month}\\s+${day},?\\s+\\d{4}|${day}\\s+${month}\\s+\\d{4})`;
  return new RegExp(`^Status on\\s+(${date})(?:(?:\\s*[:.—–-]\\s*|\\s+)([\\s\\S]*))?$`, "i");
})();
// Only a complete, recognizable date immediately after "Status on" is metadata (mirrors tpxParseStatus in topics-page.js).
function parseStatus(text) {
  const source = String(text ?? "").trim(), match = source.match(STATUS_PREFIX);
  if (match) return { date:match[1], body:String(match[2] || "").trim() };
  return { date:"", body:source.replace(/^Status on\b\s*/i, "").trim() };
}
const field = (text, key) => F.splitFront(text).front[key] || "";
// The text under "## Lines", up to the next "## " heading.
function linesSection(text) {
  const lines = String(text).replace(/\r\n/g, "\n").split("\n"), at = lines.findIndex(l => /^##\s+Lines\s*$/i.test(l));
  if (at < 0) return "";
  const end = lines.findIndex((l, i) => i > at && /^##\s/.test(l));
  return lines.slice(at + 1, end < 0 ? lines.length : end).join("\n");
}
function decode(href) { try { return decodeURI(href); } catch { return href; } }
// The first few items under "## What is left, in order", as plain words: links keep their text, and "(R2, R5)" goes.
const LEFT_MOST = 4;
function leftOf(text) {
  const lines = String(text).replace(/\r\n/g, "\n").split("\n"), at = lines.findIndex(l => /^##\s+What is left\b/i.test(l));
  if (at < 0) return [];
  const out = [];
  for (const l of lines.slice(at + 1)) {
    if (/^##\s/.test(l) || out.length === LEFT_MOST) break;
    const m = l.match(/^\s*(?:\d+[.)]|[-*])\s+(.+)$/);
    if (!m) continue;
    const words = m[1].replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`~]/g, "").replace(/\s*\((?:R\d+[^)]*)\)/g, "").replace(/\s+/g, " ").trim();
    if (words) out.push(words);
  }
  return out;
}
// The first intro paragraph starting with "Status on", matching tpxParse in public/lines/topics-page.js:
// skips frontmatter, HTML comments, fenced code/math blocks, lists, blockquotes and tables, and stops at the first "## " heading.
function statusParagraphOf(text) {
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    if (end > 0) i = end + 1;
  }
  const isMathStart = line => /^(?:\$\$|\\\[|\\begin\{[a-z]+\*?\})/.test(line.trim());
  const isBlockStart = line => /^(?:<!--|```|~~~|#{1,4}\s+|(?:-{3,}|\*{3,})\s*$|>\s?|\|.*\|\s*$|!\[[^\]]*\]\([^)]+\)\s*$|\s*(?:[-*]|\d+[.)])\s+)/.test(line) || isMathStart(line);
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^<!--/.test(line)) { while (i < lines.length && !lines[i].includes("-->")) i++; i++; continue; }
    const fence = line.match(/^(```|~~~)/);
    if (fence) { i++; while (i < lines.length && !lines[i].startsWith(fence[1])) i++; i++; continue; }
    if (isMathStart(line)) {
      const open = line.trim(), env = open.match(/^\\begin\{([a-z]+)(\*?)\}/);
      const close = open.startsWith("$$") ? "$$" : open.startsWith("\\[") ? "\\]" : `\\end{${env[1]}${env[2]}}`;
      let block = env ? open : open.slice(2);
      const closed = () => env ? block.includes(close) : block.trimEnd().endsWith(close) && block.trim().length >= close.length;
      while (!closed() && ++i < lines.length) block += "\n" + lines[i];
      i++; continue;
    }
    if (/^##\s+/.test(line)) break;
    if (/^#{1,4}\s+/.test(line) || /^(-{3,}|\*{3,})\s*$/.test(line) || /^!\[[^\]]*\]\([^)]+\)\s*$/.test(line)) { i++; continue; }
    if (/^>\s?/.test(line)) { while (i < lines.length && /^>\s?/.test(lines[i])) i++; continue; }
    if (/^\|.*\|\s*$/.test(line) && /^\|?[\s:|-]+\|?\s*$/.test(lines[i + 1] || "")) { i += 2; while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) i++; continue; }
    if (/^\s*(?:[-*]|\d+[.)])\s+/.test(line)) {
      i++;
      while (i < lines.length && (/^\s*(?:[-*]|\d+[.)])\s+/.test(lines[i]) || (/^\s{2,}/.test(lines[i]) && lines[i].trim()))) i++;
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && (!para.length || !isBlockStart(lines[i]))) para.push(lines[i++]);
    const joined = para.join(" ");
    if (/^\*\*[^*]+\*\*$/.test(joined) || /^\[Understanding\]\(/.test(joined)) continue;
    if (/^Status on\b/i.test(joined)) return joined;
  }
  return "";
}
function statusOf(text) {
  const raw = statusParagraphOf(text);
  if (!raw) return "";
  return parseStatus(raw).body.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`~]/g, "").trim();
}
// Every Topic: its name in the docs folder, title, id, parent, and the Lines its Lines table links.
function topicsOf(docs) {
  let names = [];
  try { names = fs.readdirSync(path.join(docs, L.TOPICS)).filter(n => n.endsWith(".md")).slice(0, MAX_TOPICS); } catch { return []; }
  return names.flatMap(name => {
    const rel = `${L.TOPICS}/${name}`, file = path.join(docs, rel);
    let stat;
    try { stat = fs.statSync(file); if (stat.size > MAX_BYTES) return []; } catch { return []; }
    const before = versionOf(stat), cached = topicCache.get(file);
    if (cached && cached.version === before) return [cloneTopic(cached.topic)];
    let text;
    try { text = fs.readFileSync(file, "utf8"); } catch { return []; }
    // A Topic written without a "## Lines" table (an older shape) counts the Lines it links anywhere.
    const lines = [...(linesSection(text) || (/^##\s+Lines\s*$/im.test(text) ? "" : text)).matchAll(LINKS)].map(m => path.posix.normalize(path.posix.join(L.TOPICS, decode(m[1].split("#")[0]))))
      .map(target => target.replace(/^archive\//, "")).map(L.slugOfLine).filter(Boolean);
    // Its goal: the first paragraph that is one bold sentence, as topics-guide.md writes it.
    const goal = (text.replace(/^---[\s\S]*?\n---/, "").match(/^\*\*([^*\n]+)\*\*\s*$/m) || [])[1] || "";
    // Its dated status sentence, the Work that last changed it, and a mark of its text: the pages say when an agent changed a Topic.
    const status = statusOf(text);
    const by = field(text, "updated_by").split(",")[0].trim(), sig = crypto.createHash("sha1").update(text).digest("hex").slice(0, 12);
    const topic = { path:rel, id:field(text, "id"), area:field(text, "area"), goal, left:leftOf(text), title:field(text, "title") || (text.match(/^# (.+)$/m) || [])[1]?.trim() || name.slice(0, -3), parent:field(text, "parent_id").replace(/^null$/, ""), lines:[...new Set(lines)], status, by, sig };
    const after = versionOf(fs.statSync(file, { throwIfNoEntry:false }));
    if (after && after === before) {
      if (topicCache.size >= MOST_CACHED_TOPICS) topicCache.clear();
      topicCache.set(file, { version:after, topic });
    } else topicCache.delete(file);
    return [cloneTopic(topic)];
  });
}
// The Topic a Line is in, or null.
function topicOfLine(docs, slug) {
  return topicsOf(docs).find(t => t.lines.includes(slug)) || null;
}
// What PenEcho tells an agent it runs about the knowledge layer: one sentence, and nothing to read or write (PE-916).
// Owner: "for those small bug fixes we do not even [need] to update memory or topics."
// The names of the requirements this Line already holds go with it, so a change lands on the same requirement, not a copy.
function knowledgeNote(docs = "", slug = "") {
  const topic = docs && slug ? topicOfLine(docs, slug) : null;
  let held = [];
  try { if (topic) held = requirementsOf(fs.readFileSync(path.join(docs, topic.path), "utf8")).filter(r => r.lines.includes(slug)).slice(-4); } catch { /* None named. */ }
  return `Leave understanding.md and topics/ alone unless the request is about them. Only when an Ask here added or changed a requirement (not a fix, question, test or check), end your last message with <!-- penecho: requirement="<done|in progress|agreed|proposed|problem> | <name, 2-5 words> | <the need, one sentence, no double quotes>" -->; PenEcho files it in the Line's Topic.${held.length ? ` This Line's requirements there: ${held.map(r => `"${r.name}"`).join(", ")}; to change one, use its name.` : ""}`;
}

// ---------- A requirement an agent named, filed in its Line's Topic ----------
const STATUSES = { "done":"✅ Done", "in progress":"🔨 In progress", "agreed":"📐 Agreed", "proposed":"💡 Proposed", "open":"❓ Open", "later":"⏳ Later", "problem":"🐞 Problem" };
const oneLine = (text, most) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, most);
// "done | Short name | The need." → { status, name, need }, or null when it is not one.
function parseRequirement(said) {
  const parts = String(said || "").split("|").map(p => oneLine(p, 600));
  if (parts.length < 3) return null;
  const status = parts[0].toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  const name = oneLine(parts[1].replace(/[#*`[\]|]/g, ""), 80), need = oneLine(parts.slice(2).join(" | "), 600);
  return STATUSES[status] && name && need ? { status, name, need } : null;
}
// The person's words, as a requirement quotes them: their first sentence, at most a line.
function quoteOf(ask) {
  const text = oneLine(String(ask || "").replace(/!?\[[^\]]*\]\([^)]*\)/g, "").replace(/"/g, "'"), 400);
  const first = (text.match(/^.+?[.!?。！？](?=\s|$)/) || [text])[0];
  return first.length > 200 ? `${first.slice(0, 199).replace(/\s+\S*$/, "")}…` : first;
}
const HEAD = /^###\s+R(\d+)\b\s*[·:.\-–—]?\s*(.*?)(?:\s+[—–]\s+(.*))?\s*$/;
// Each requirement in a Topic: its number, name and the Lines its text links.
function requirementsOf(text) {
  const reqText = F.sectionText(String(text).replace(/\r\n/g, "\n"), "Requirements") || "";
  return reqText.split(/\n(?=###\s)/).flatMap(chunk => {
    const head = chunk.split("\n")[0].match(HEAD);
    return head ? [{ n:Number(head[1]), name:head[2].trim(), lines:[...chunk.matchAll(/lines\/([^)\s/#]+)\.md\)/g)].map(m => decode(m[1])) }] : [];
  });
}
const sameName = (a, b) => a.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim() === b.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
// Files { status, name, need } in a Topic's text, as topics-guide.md shapes it: the requirement the agent named, or else the one
// this Line already holds, is rewritten to the newest word; otherwise a new one is added. The Line goes in the Lines table.
// line: { id, slug, title }; work: { id, label }; ask: the person's newest words; summary: the result's first sentence.
function applyRequirement(text, { said, line, work, ask = "", summary = "", date = "" }) {
  const req = parseRequirement(said);
  if (!req || !line?.slug || !work?.id) return text;
  const cr = /\r\n/.test(text), ref = line.id || line.slug, lineHref = `../${L.linePath(line.slug)}`;
  let md = String(text).replace(/\r\n/g, "\n");
  const asked = quoteOf(ask), askedBullet = asked ? `- **Asked:** "${asked}" ([${ref}](${lineHref}))` : "";
  const done = oneLine(summary, 400), doneBullet = req.status !== "agreed" && done ? `- **Done:** ${done} ([${ref} ${String(work.label || work.id).replace(/^Work\s*/i, "W")}](../${L.detailPath(line.slug, work.id)}))` : "";
  const reqText = F.sectionText(md, "Requirements") || "";
  const chunks = reqText ? reqText.split(/\n(?=###\s)/) : [];
  const blocks = chunks.map(chunk => { const head = chunk.split("\n")[0].match(HEAD); return head ? { chunk, n:Number(head[1]), name:head[2].trim() } : { chunk }; });
  const numbered = blocks.filter(b => b.n);
  // Only by name (or its R number): a requirement the agent did not name is never rewritten, so nothing is lost; at worst one is added twice.
  const byNumber = req.name.match(/^R(\d+)$/i);
  const target = numbered.find(b => sameName(b.name, req.name)) || (byNumber ? numbered.find(b => b.n === Number(byNumber[1])) : null);
  const n = target ? target.n : Math.max(0, ...numbered.map(b => b.n)) + 1;
  if (target) {
    const rows = target.chunk.split("\n");
    rows[0] = `### R${n} · ${target.name || req.name} — ${STATUSES[req.status]}`;
    let body = rows.slice(1);
    // The statement: the first paragraph that is not a list. The newest word replaces it.
    const at = body.findIndex(r => r.trim() && !/^\s*[-*]\s/.test(r) && !/^Not wanted:/i.test(r));
    const firstBullet = body.findIndex(r => /^\s*[-*]\s/.test(r));
    if (at >= 0 && (firstBullet < 0 || at < firstBullet)) { let end = at; while (end + 1 < body.length && body[end + 1].trim() && !/^\s*[-*]\s/.test(body[end + 1])) end++; body.splice(at, end - at + 1, req.need); }
    else body = ["", req.need, ...body];
    if (askedBullet && !body.some(r => r.includes(`"${asked}"`))) {
      const lastAsked = body.map((r, i) => /^\s*-\s+\*\*Asked:\*\*/.test(r) ? i : -1).filter(i => i >= 0).pop();
      const bullet = body.findIndex(r => /^\s*[-*]\s/.test(r));
      body.splice(lastAsked != null ? lastAsked + 1 : bullet >= 0 ? bullet : body.length, 0, ...(lastAsked == null && bullet < 0 ? ["", askedBullet] : [askedBullet]));
    }
    if (doneBullet) {
      const dones = body.map((r, i) => /^\s*-\s+\*\*Done:\*\*/.test(r) ? i : -1).filter(i => i >= 0);
      if (dones.length) { body[dones.at(-1)] = doneBullet; for (const i of dones.slice(0, -1).reverse()) body.splice(i, 1); }
      else { const lastBullet = body.map((r, i) => /^\s*[-*]\s/.test(r) ? i : -1).filter(i => i >= 0).pop(); body.splice(lastBullet != null ? lastBullet + 1 : body.length, 0, doneBullet); }
    }
    if (req.status === "done") body = body.filter(r => !/^\s*-\s+\*\*Left:\*\*/.test(r));
    target.chunk = [rows[0], ...body].join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
  } else {
    blocks.push({ chunk:[`### R${n} · ${req.name} — ${STATUSES[req.status]}`, "", req.need, ...(askedBullet || doneBullet ? ["", askedBullet, doneBullet].filter((r, i) => i === 0 || r) : [])].join("\n") });
  }
  md = F.setSection(md, "Requirements", blocks.map(b => b.chunk.trimEnd()).join("\n\n"), ["Traps for agents", "Lines"]);
  // Done: it is no longer left.
  if (req.status === "done") {
    const left = F.sectionText(md, "What is left, in order");
    if (left != null) {
      let k = 0;
      const kept = left.split("\n").filter(r => !new RegExp(`^\\s*(?:\\d+[.)]|[-*])\\s.*\\(R${n}\\)\\s*$`).test(r)).map(r => /^\s*\d+[.)]\s/.test(r) ? r.replace(/^(\s*)\d+([.)])/, (all, pad, dot) => `${pad}${++k}${dot}`) : r);
      md = F.setSection(md, "What is left, in order", kept.join("\n").trim() || null);
    }
  }
  // The Line in the Lines table, with this requirement.
  const table = F.sectionText(md, "Lines");
  const row = `| [${ref}](${lineHref}) | ${oneLine(line.title || line.slug, 120).replace(/\|/g, "/")} | R${n} |`;
  if (table == null) md = F.setSection(md, "Lines", `| Line | What it is | Requirements |\n| --- | --- | --- |\n${row}`);
  else {
    const rows = table.split("\n"), at = rows.findIndex(r => r.startsWith("|") && r.includes(`lines/${line.slug}.md)`));
    if (at < 0) rows.push(row);
    else {
      const cells = rows[at].split("|");
      const last = cells.length - 2;
      if (last >= 1 && !new RegExp(`\\bR${n}\\b`).test(cells[last])) cells[last] = ` ${[cells[last].trim(), `R${n}`].filter(Boolean).join(", ")} `;
      rows[at] = cells.join("|");
    }
    md = F.setSection(md, "Lines", rows.join("\n").trim());
  }
  md = F.setFront(md, { ...(date ? { updated:date } : {}), updated_by:`${ref} ${work.label || work.id}` });
  return cr ? md.replace(/\n/g, "\r\n") : md;
}

// The areas (categories) in the order understanding.md lists them under "## Topics": its bold lines that are not links.
function readAreasEntry(docs) {
  const file = path.join(docs, L.UNDERSTANDING);
  const before = versionOf(fs.statSync(file, { throwIfNoEntry:false }));
  if (!before) return { areas:[], details:{} };
  const cached = areasCache.get(file);
  if (cached && cached.version === before) return cached;
  let text = "";
  try { text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n"); } catch { return { areas:[], details:{} }; }
  const at = text.search(/^##\s+Topics\s*$/m);
  const sec = at < 0 ? "" : text.slice(at).split(/\n##\s/)[0];
  const areas = [], details = {}, seen = new Set();
  if (at >= 0) {
    for (const line of sec.split("\n")) {
      const m = line.match(AREA_HEADING);
      if (!m) continue;
      const name = m[1].trim();
      if (!name || /^not in a topic/i.test(name)) continue;
      const key = nameKey(name);
      if (seen.has(key)) continue;
      seen.add(key);
      areas.push(name);
      const desc = String(m[2] || "").trim();
      if (desc) details[name] = desc;
      if (areas.length >= MAX_AREAS) break;
    }
  }
  const after = versionOf(fs.statSync(file, { throwIfNoEntry:false }));
  const entry = { version:after, areas, details };
  if (after && after === before) {
    if (areasCache.size >= MOST_CACHED_AREAS) areasCache.clear();
    areasCache.set(file, entry);
  } else areasCache.delete(file);
  return entry;
}
function areasOf(docs) {
  return [...readAreasEntry(docs).areas];
}
function areaDetailsOf(docs) {
  return { ...readAreasEntry(docs).details };
}
// Topics switched off in the project's settings: agents leave them alone, whatever MEMORY.md says.
const TOPICS_OFF = "This project keeps no Topics: do not read, create or update topics/ or understanding.md, whatever MEMORY.md says.";
// Topics are hidden in every project until they are redesigned: keeping them cost agents too many tokens (PE-1066).
// With hidden false each project's own Project Topics switch decides again, as the tests of the Topics themselves set it.
const TOPICS = { hidden:true };
const topicsOn = project => !TOPICS.hidden && Boolean(project) && project.projectTopics !== false;

module.exports = { TOPICS_OFF, TOPICS, topicsOn, MAX_TOPICS, MAX_AREAS, emptyTopic, updateTopicMarkdown, ensureUnderstanding, upsertAreaInUnderstanding, renameAreaInUnderstanding, deleteAreaInUnderstanding, upsertTopicInUnderstanding, updateTopicInUnderstanding, removeTopicFromUnderstanding, areasOf, areaDetailsOf, topicsOf, topicOfLine, knowledgeNote, parseRequirement, applyRequirement, requirementsOf, linesSection, leftOf, parseStatus, statusOf };
