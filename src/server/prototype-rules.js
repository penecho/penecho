"use strict";
// Single-source loader and installer for PenEcho's design-prototype guidance
// (same pattern as slides.js installSlideRules, kept lazy-loaded for prototype work only).
const fs = require("node:fs");
const path = require("node:path");

const RULES_FILE = path.join(__dirname, "canvas-agent/design-prototype-contract.md");
const RULES_NAME = "design-prototype.md";

let cachedContract = null;
let cachedCanvasPrompt = null;

function contractText() {
  cachedContract ??= fs.readFileSync(RULES_FILE, "utf8");
  return cachedContract;
}

// Linear-time, quote-aware opening <html ...> root scanner (zero backtracking / ReDoS safe).
// Skips leading UTF-8 BOM, whitespace, HTML comments, and <!doctype ...>, then inspects only
// the opening <html> tag's attributes so body/script mentions or <html-x> custom tags never match.
function isPrototypeHtml(html) {
  const s = String(html || "");
  const len = s.length;
  let i = len > 0 && s.charCodeAt(0) === 0xfeff ? 1 : 0;

  while (i < len) {
    while (i < len && s.charCodeAt(i) <= 32) i++;
    if (i >= len) return false;
    if (s.startsWith("<!--", i)) {
      const end = s.indexOf("-->", i + 4);
      if (end < 0) return false;
      i = end + 3;
      continue;
    }
    if (s[i] === "<" && s[i + 1] === "!" && s.slice(i + 2, i + 9).toLowerCase() === "doctype") {
      const end = s.indexOf(">", i + 9);
      if (end < 0) return false;
      i = end + 1;
      continue;
    }
    break;
  }

  if (i + 5 > len || s[i] !== "<" || s.slice(i + 1, i + 5).toLowerCase() !== "html") return false;
  i += 5;
  if (i < len) {
    const ch = s.charCodeAt(i);
    if (ch > 32 && ch !== 62 /* > */ && ch !== 47 /* / */) return false;
  }

  // Scan attributes inside <html ...> with quote awareness.
  while (i < len) {
    while (i < len && (s.charCodeAt(i) <= 32 || s[i] === "/")) i++;
    if (i >= len || s[i] === ">") return false;

    const nameStart = i;
    while (i < len && s.charCodeAt(i) > 32 && s[i] !== "=" && s[i] !== ">" && s[i] !== "/") i++;
    const attrName = s.slice(nameStart, i).toLowerCase();

    while (i < len && s.charCodeAt(i) <= 32) i++;
    let attrVal = "";
    if (i < len && s[i] === "=") {
      i++;
      while (i < len && s.charCodeAt(i) <= 32) i++;
      if (i < len && (s[i] === '"' || s[i] === "'")) {
        const quote = s[i++];
        const valStart = i;
        const close = s.indexOf(quote, i);
        if (close < 0) return false;
        attrVal = s.slice(valStart, close);
        i = close + 1;
      } else {
        const valStart = i;
        while (i < len && s.charCodeAt(i) > 32 && s[i] !== ">") i++;
        attrVal = s.slice(valStart, i);
      }
    }

    if (attrName === "data-penecho-prototype") {
      return !/^(?:0|false|no|off)$/i.test(attrVal.trim());
    }
  }
  return false;
}

// A copy is read and compared only when its file is not as PenEcho last left it, or the text changed: every project's 3-second look read
// each copy again (slides.js, prototype-rules.js and agent-help.js keep their copies the same way, each on its own for PenEcho Cloud's copy).
const versionOf = stat => (stat ? `${stat.dev}:${stat.ino}:${stat.ctimeMs}:${stat.mtimeMs}:${stat.size}` : "");
const copies = new Map();
function keepCopy(file, text) {
  const before = versionOf(fs.statSync(file, { throwIfNoEntry:false })), known = copies.get(file);
  if (before && known?.version === before && known.text === text) return false;
  let now = null;
  try { now = fs.readFileSync(file, "utf8"); } catch { /* Not there yet. */ }
  const write = now !== text;
  if (write) { fs.mkdirSync(path.dirname(file), { recursive:true }); fs.writeFileSync(file, text); copies.delete(file); return true; }
  // Remembered only once it was read holding the text and did not change while read; a copy just written is read at the next look.
  const after = versionOf(fs.statSync(file, { throwIfNoEntry:false }));
  if (after && after === before) { if (copies.size > 2000) copies.clear(); copies.set(file, { version:after, text }); } else copies.delete(file);
  return false;
}
function installPrototypeRules(dir) {
  return keepCopy(path.join(dir, RULES_NAME), contractText());
}

// Pen commands receive the supplied sketch or widget source but cannot open files or inspect a preview.
function canvasCommandPrompt() {
  cachedCanvasPrompt ??= contractText().split("\n## Working with project files and previews")[0].trimEnd();
  return cachedCanvasPrompt;
}

module.exports = {
  RULES_FILE,
  RULES_NAME,
  contractText,
  isPrototypeHtml,
  installPrototypeRules,
  canvasCommandPrompt,
};
