"use strict";
const L = require("./layout.js");
// What a Work made, as its result points to it: the deliverables its card on the line shows (H2 in NEXT-FEATURES.md, PE-365).
// An agent links what it made in its last message, or writes its path. A Canvas joins the line's pictures; anything else is a card of
// its own: a page, a document, a deck, a picture, a Claude Artifact, another line, or a page in the code folder (a prototype).
// Code, the files a drawing is made from, logs and what you attached are not deliverables, and nothing the line already shows is said twice.
const fs = require("node:fs");
const path = require("node:path");
const { kindByName, PASTED } = require("./project-files.js");

const SOURCE = /\.(diagram\.json|explorer\.html|note\.json|slide-\d{1,2}\.html)$/i;
const NOT_MADE = /\.(c?js|mjs|tsx?|jsx|json|jsonl|log|patch|diff|sh|py|rb|go|rs|java|kt|swift|css|scss|lock|ya?ml|toml|env|ini|cfg|webp)$/i;
// A page under one of these folders of the code is part of the app, not something made to be looked at.
const APP_PARTS = new Set(["public", "src", "app", "lib", "node_modules", "dist", "build", "release", "test", "tests", "vendor"]);
const ARTIFACT = /^https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9_-]{6,80}/;
// A path written as plain words: an absolute one (two folders deep at least, so "/api/draw" is not taken for one), or one in the docs folder's files folder.
const PLAIN_PATH = /(?:^|[\s`(（"'“*])((?:~\/|\/[^\s`)）<>"'“”，。；：、/]+\/)[^\s`)）<>"'“”，。；：、]+|files\/[^\s`)）<>"'“”，。；：、]+)/g;
const MOST = 12, MOST_PICTURES = 8;

// A page says what it is in its own <title>, better than the words of a link to it ("open the prototype").
function pageTitle(file) {
  let head = "";
  try { const fd = fs.openSync(file, "r"), buffer = Buffer.alloc(8192); try { head = buffer.toString("utf8", 0, fs.readSync(fd, buffer, 0, buffer.length, 0)); } finally { fs.closeSync(fd); } } catch { return ""; }
  const m = /<title[^>]*>([^<]{1,160})<\/title>/i.exec(head);
  return m ? m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/\s+/g, " ").trim() : "";
}
const inside = (child, parent) => Boolean(child && parent) && (child === parent || child.startsWith(parent + path.sep));
// Link words that only repeat the file's name say nothing more than the name.
function titleOf(words, file) {
  const t = String(words || "").replace(/[`*_]+/g, "").replace(/\s+/g, " ").trim();
  if (!t || /^[./~]/.test(t) || t.includes("/") || t === path.posix.basename(file)) return "";
  return t.slice(0, 120);
}

// detail: the Work's detail file (works/<line>/work-N.md); result: its Result as F.resultOf gives it ({ text, links }).
// exists(rel): a file of the docs folder is there. isFile(abs): a file outside it is there. real(abs): its real path.
// codeRoots: the real paths of the code folders this line works in. shown: pictures the line shows already (and fills).
// self: this line's slug. isLine(slug): a line of this project.
function workOutputs({ detail, result, docs, home = "", exists, isFile = () => false, real = p => p, codeRoots = [], shown = new Set(), self = "", isLine = () => false }) {
  const canvases = [], items = new Map();
  let pictures = 0;
  const add = (key, item) => {
    if (items.has(key) || items.size >= MOST) return;
    if (item.kind === "picture" && ++pictures > MOST_PICTURES) return;
    items.set(key, item);
  };
  // The Canvas a file of the docs folder belongs to, as the path of its picture: a Canvas file, a file it is drawn from, or its picture.
  const canvasOf = rel => {
    const base = rel.replace(/\.penecho\.json$/i, "").replace(SOURCE, "").replace(/\.png$/i, "");
    if (base === rel) return "";
    if (exists(`${base}.penecho.json`)) return `${base}.png`;
    // One more picture drawn onto a Canvas (`<canvas>+<name>`) is that Canvas.
    const plus = /^(.*)\+[^/]+$/.exec(base);
    return plus && exists(`${plus[1]}.penecho.json`) ? `${plus[1]}.png` : "";
  };
  const codePage = (abs, words) => {
    if (!/\.html?$/i.test(abs) || !isFile(abs)) return;
    const where = real(abs), root = codeRoots.find(r => inside(where, r));
    if (!root) return;
    // A worktree an agent made for itself (.claude/worktrees/<name>) is the code again.
    const parts = path.relative(root, where).split(path.sep), tree = parts[0] === ".claude" && parts[1] === "worktrees" ? parts.slice(3) : parts;
    if (tree.some(part => APP_PARTS.has(part) || part.startsWith("."))) return;
    add(where, { kind:"page", path:where, code:true, title:pageTitle(where) || titleOf(words, where) });
  };
  const consider = (href, words, { inDocs = false } = {}) => {
    href = String(href || "").trim().replace(/^<|>$/g, "");
    const artifact = ARTIFACT.exec(href);
    if (artifact) { add(artifact[0], { kind:"artifact", path:artifact[0], title:titleOf(words, artifact[0]) || "Claude Artifact" }); return; }
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^file:/i.test(href)) return;
    href = href.replace(/^file:\/\//i, "").split(/[?#]/)[0];
    try { href = decodeURI(href); } catch { /* Kept as written. */ }
    href = href.replace(/[.,;:!?]+$/, "");
    if (href.startsWith("~/") && home) href = path.join(home, href.slice(2));
    let rel;
    if (path.isAbsolute(href)) {
      if (!inside(href, docs)) { codePage(href, words); return; }
      rel = path.relative(docs, href).split(path.sep).join("/");
    } else {
      rel = inDocs ? path.posix.normalize(href) : L.resolveFrom(detail, href);
      // Agents also write a link from the docs folder, not from the Work's file: files/<line>/plan.md.
      const fromDocs = path.posix.normalize(href);
      if (/^(?:files|lines)\//.test(fromDocs) && !/^(?:files|lines)\//.test(rel)) rel = fromDocs;
    }
    const line = /^lines\/([^/]+)\.md$/.exec(rel);
    if (line) { if (line[1] !== self && isLine(line[1])) add(rel, { kind:"line", line:line[1], path:rel }); return; }
    // A folder is not one thing to open; the files in it that the result names are.
    if (!rel.startsWith("files/") || rel.startsWith("files/_incoming/") || !path.posix.extname(rel) || !exists(rel)) return;
    const canvas = canvasOf(rel);
    if (canvas) {
      if (!shown.has(canvas) && exists(canvas)) { shown.add(canvas); canvases.push({ title:titleOf(words, canvas) || "Canvas", path:canvas }); }
      return;
    }
    if (shown.has(rel) || NOT_MADE.test(rel)) return;
    const kind = kindByName(rel) || "file";
    if (kind === "picture" && PASTED.test(path.posix.basename(rel))) return;
    add(rel, { kind, path:rel, title:(kind === "page" && pageTitle(path.join(docs, rel))) || titleOf(words, rel) });
  };
  for (const link of result?.links || []) consider(link.href, link.name);
  for (const m of String(result?.text || "").matchAll(PLAIN_PATH)) consider(m[1], "", { inDocs:m[1].startsWith("files/") });
  return { canvases, outputs:[...items.values()] };
}

module.exports = { workOutputs };
