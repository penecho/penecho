"use strict";
// Canvases & files (N3): what each file of a project is, which line and step hold it, and who made it, decided here and nowhere else.
// Every file under files/ has a kind, so the page can list it and it can be deleted there; one kindByName does not know is a "file".
// Claude Artifacts are links in the lines, not files, and come back on their own list.
//   kind  canvas · slides · page · document · picture · data · media · meeting · file · artifact
//   line  the line's slug, step  the step's id on it ("" when only the line's folder holds it)
//   by    an agent's id when a Work made it, "you" when it came with your Ask, a note, a meeting or your own drawing
const path = require("node:path");

const YOURS = new Set(["ask", "note", "canvas", "meeting"]);
const PICTURE = /\.(png|jpe?g|webp|gif|svg)$/i;
const SLIDE_HTML = /\.slide-(\d{1,2})\.html$/i;
const SLIDE_PICTURE = /\.slide-\d{1,2}\.(png|jpe?g|webp)$/i;
const AGENT_SOURCE = [".explorer.html", ".diagram.json", ".note.json", ".slide-01.html"];
// Names a picture gets when it is pasted or dropped in, not drawn by an agent.
const PASTED = /^(picture|image|img[_-]|screenshot|screen shot|paste|clipboard|photo)/i;
const ARTIFACT = /https:\/\/claude\.ai\/(?:code\/)?artifact\/([A-Za-z0-9_-]{6,80})/;
const ARTIFACT_LINK = /\[([^\]\n]*)\]\((https:\/\/claude\.ai\/(?:code\/)?artifact\/([A-Za-z0-9_-]{6,80}))[^)\s]*\)/g;
const ARTIFACT_BARE = /https:\/\/claude\.ai\/(?:code\/)?artifact\/([A-Za-z0-9_-]{6,80})/g;

// The kind a path has by its name alone. Canvases, decks, meetings and page folders are settled in shelfOf, which sees the whole folder.
function kindByName(file) {
  const name = path.posix.basename(file).toLowerCase(), ext = path.posix.extname(name).slice(1);
  if (name.endsWith(".penecho.json")) return "canvas";
  if (SLIDE_HTML.test(name)) return "slides";
  if (ext === "html" || ext === "htm") return "page";
  if (PICTURE.test(name)) return "picture";
  if (["pptx", "key"].includes(ext)) return "slides";
  if (["md", "txt", "docx", "pdf"].includes(ext)) return "document";
  if (["xlsx", "csv"].includes(ext)) return "data";
  if (["mp4", "mov", "mp3", "m4a"].includes(ext)) return "media";
  return null;
}
const clean = text => String(text || "").replace(/[*_`]+/g, "").replace(/\s+/g, " ").trim();
const artifactTitle = (text, url) => { const t = clean(text); return t && !ARTIFACT.test(t) && t !== url ? t.slice(0, 160) : "Claude Artifact"; };

// Every docs-folder file a Markdown text names: its links, read from where the text is (`from`), and any files/… path written out
// in words or in `code`. A Work that says "see files/x/y.png" uses that file as much as one that links it. A folder comes back ending
// in "/" (files/x/): a link or `code` may name one as written, a bare word only with its slash, since a bare word stops at a space.
const MD_HREF = /\]\(\s*(?:<([^>\n]+)>|([^)\s]+))[^)\n]*\)/g;
const FILES_WORD = /(?:^|[^\w.-])(files\/[^\s()[\]<>"'`|*]+)/g;
const TICKED = /`([^`\n]*files\/[^`\n]*)`/g;
function pathsIn(text, from = "") {
  const body = String(text || ""), out = new Set();
  if (!body.includes("files/") && !body.includes("files%2F")) return [];
  const add = (raw, base = "", word = false) => {
    let href = String(raw || "").split(/[?#]/)[0];
    const folder = !word || /\/$/.test(href);
    if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href)) return;
    try { href = decodeURI(href); } catch { /* Kept as written. */ }
    let rel = base ? path.posix.normalize(path.posix.join(base, href)) : href;
    const at = rel.indexOf("files/"); if (at < 0) return;
    if (!rel.startsWith("files/")) rel = rel.slice(at);
    rel = path.posix.normalize(rel).replace(/[.,;:!?。，、）]+$/, "").replace(/\/+$/, "");
    if (!/^files\/[^/]/.test(rel) || rel.split("/").includes("..")) return;
    out.add(rel);
    if (folder) out.add(`${rel}/`);
  };
  const dir = from ? path.posix.dirname(from) : "";
  for (const m of body.matchAll(MD_HREF)) add(m[1] || m[2], dir);
  for (const m of body.matchAll(FILES_WORD)) add(m[1], "", true);
  for (const m of body.matchAll(TICKED)) add(m[1]);
  return [...out];
}

// files: the folder's list ({ path, mtime, size }); pictures: the state's Canvases; lines: every line as the state has it (with stations);
// topics: the scanned line files (doc.steps keep each step's own words); resultOf(station): a Work's result ({ text, links }) or null;
// timeOf(station): when a step happened, in ms. references: the files each text names ({ line, paths } from pathsIn): a line's own
// file and its Works carry its slug; Topics, understanding.md, MEMORY.md and notes carry line "", which keeps a file in use whatever its Line.
function shelfOf({ files = [], pictures = [], lines = [], topics = [], deletedLines = [], canvasParts = new Map(), references = [], resultOf = () => null, timeOf = () => 0 } = {}) {
  const names = new Set(files.map(f => f.path)), lineBySlug = new Map(lines.map(l => [l.slug, l]));
  const agentLike = s => !YOURS.has(s.kind) && s.kind !== "merge" && s.kind !== "deliver" && s.kind !== "orch-review";
  // Asked once for each file under files/: worked out once for each line.
  const agents = new Map();
  const agentOf = l => {
    if (!l) return "";
    if (!agents.has(l)) { const works = (l.stations || []).filter(s => agentLike(s) && s.agent && s.agent !== "you"); agents.set(l, works.length ? works[works.length - 1].agent : l.agent && l.agent !== "you" ? l.agent : ""); }
    return agents.get(l);
  };
  const whoOf = (l, s) => (!agentLike(s) ? "you" : s.agent && s.agent !== "you" ? s.agent : agentOf(l) || "agent");
  const folderLine = file => { const m = /^files\/([^/]+)\//.exec(file); return m && lineBySlug.has(m[1]) ? m[1] : ""; };

  // Every place a line names a file: a step's pictures and files, and the links in a Work's result.
  const mentions = new Map();
  const mention = (file, l, s, extra = {}) => {
    if (!names.has(file)) return;
    const list = mentions.get(file) || [];
    list.push({ line:l.slug, step:s.id, by:whoOf(l, s), at:timeOf(s) || 0, kind:s.kind, ...extra });
    mentions.set(file, list);
  };
  for (const l of lines) {
    for (const s of l.stations || []) {
      for (const x of [...(s.pictures || []), ...(s.files || [])]) if (x?.path) mention(x.path, l, s, s.kind === "meeting" && /\.md$/i.test(x.path) ? { meeting:s.text } : {});
      if (YOURS.has(s.kind) || !s.detail) continue;
      for (const link of resultOf(s)?.links || []) {
        if (/^[a-z]+:/i.test(link.href) || link.href.startsWith("#")) continue;
        let href = link.href.split(/[?#]/)[0];
        try { href = decodeURI(href); } catch { /* Kept as written. */ }
        mention(path.posix.normalize(path.posix.join(path.posix.dirname(s.detail), href)), l, s);
      }
    }
  }
  // The mention that says most: one on the line whose folder holds the file, else the first in time.
  const placeOf = file => {
    const list = mentions.get(file); if (!list) return null;
    const home = folderLine(file), own = list.filter(m => m.line === home), pick = (own.length ? own : list).slice().sort((a, b) => (a.at || Infinity) - (b.at || Infinity))[0];
    return pick;
  };

  const out = new Map();
  const canvasPictures = new Set(pictures.map(c => c.path)), canvasMembers = new Set([...canvasParts.values()].flat());
  // Folders that are one page: any folder under files/ with an index.html. Everything else inside one is part of that page.
  // A line's own folder, or the Canvases' folder, is never one page, whatever is in it.
  const pageFolders = new Set(files.filter(f => /^files\/.+\/index\.html?$/i.test(f.path)).map(f => path.posix.dirname(f.path)).filter(dir => !/^files\/[^/]+$/.test(dir) || !(lineBySlug.has(dir.slice(6)) || dir === "files/canvases")));
  const inPageFolder = file => { for (let dir = path.posix.dirname(file); dir.startsWith("files/"); dir = path.posix.dirname(dir)) if (pageFolders.has(dir) && !/\/index\.html?$/i.test(file.slice(dir.length))) return true; return false; };
  // A deck of slide pages is one card, on its first slide, unless a Canvas was made of it: then the Canvas is the deck.
  const decks = new Map();
  for (const f of files) { const m = SLIDE_HTML.exec(f.path); if (m) { const base = f.path.slice(0, m.index), d = decks.get(base) || []; d.push(f.path); decks.set(base, d); } }

  for (const c of pictures) {
    if (!names.has(c.source)) continue;
    const at = placeOf(c.path), line = at?.line || c.topic || folderLine(c.source);
    const madeFrom = AGENT_SOURCE.some(ext => names.has(c.source.replace(/\.penecho\.json$/, ext)));
    const by = at ? at.by : c.canvas ? "you" : madeFrom ? agentOf(lineBySlug.get(line)) || "agent" : "you";
    out.set(c.source, { kind:c.slides ? "slides" : "canvas", line, step:at?.step || "", by });
  }
  for (const f of files) {
    const file = f.path;
    if (out.has(file) || !file.startsWith("files/") || file.startsWith("files/_incoming/") || /(^|\/)merge-arrow\.svg$|my-marks/.test(file)) continue;
    let kind = kindByName(file) || "file", title = "";
    if (kind === "canvas" || canvasPictures.has(file) || SLIDE_PICTURE.test(file) || inPageFolder(file)) continue;
    if (kind === "file" && canvasMembers.has(file)) continue;   // a Canvas's own source (its .diagram.json…) goes with the Canvas's card
    if (kind === "picture" && /\.webp$/i.test(file) && names.has(file.replace(/\.webp$/i, ".png"))) continue;   // one picture kept twice counts once
    const deck = SLIDE_HTML.exec(file);
    if (deck) {
      const base = file.slice(0, deck.index), slides = decks.get(base).sort((a, b) => Number(SLIDE_HTML.exec(a)[1]) - Number(SLIDE_HTML.exec(b)[1]));
      if (slides[0] !== file || names.has(`${base}.penecho.json`)) continue;
      title = path.posix.basename(base).replace(/[-_]+/g, " ");
    }
    const folder = kind === "page" && /\/index\.html?$/i.test(file) && pageFolders.has(path.posix.dirname(file));
    if (folder) title = path.posix.basename(path.posix.dirname(file));
    const meeting = mentions.get(file)?.find(m => m.meeting !== undefined), at = meeting || placeOf(file), line = at?.line || folderLine(file);
    if (meeting) { kind = "meeting"; title = clean(String(meeting.meeting).split("\n")[0].split(" · ")[0]) || "Meeting"; }
    const name = path.posix.basename(file), lineAgent = agentOf(lineBySlug.get(line));
    const by = at ? at.by : !line ? "you" : kind === "page" || kind === "slides" ? lineAgent || "agent" : PASTED.test(name) ? "you" : lineAgent || "you";
    out.set(file, { kind, ...(title ? { title } : {}), ...(folder ? { folder:true } : {}), line, step:at?.step || "", by });
  }

  // Who names each file in words or links. A folder named (files/x/) names everything in it.
  const named = new Map(), byDir = new Map();
  for (const name of names) for (let dir = path.posix.dirname(name); /^files\/[^/]+/.test(dir); dir = path.posix.dirname(dir)) { const list = byDir.get(dir) || []; list.push(name); byDir.set(dir, list); }
  for (const { line = "", paths = [] } of references) for (const p of paths) for (const file of p.endsWith("/") ? byDir.get(p.slice(0, -1)) || [] : names.has(p) ? [p] : []) { const set = named.get(file) || new Set(); set.add(line); named.set(file, set); }
  // A Canvas of its own (files/<name>/canvas.penecho.json, its folder no Line's) is something someone made, never a leftover.
  const own = new Set(pictures.filter(c => c.canvas && !lineBySlug.has(c.folder)).map(c => c.source));

  // This is known association (folders, steps, links and paths written in Lines, Works, Topics and notes), not a proof that nothing else uses it.
  // A file still named archive/… is an archived Line's whose Line was not read (the folder has more files than PenEcho reads): archived, never "No Line".
  const deleted = new Set(deletedLines);
  for (const [file, entry] of out) {
    const deletion = canvasParts.has(file) ? { folder:"", files:canvasParts.get(file) } : partsOf(file, names, Boolean(entry.folder));
    const members = deletion.folder ? files.filter(f => f.path.startsWith(`${deletion.folder}/`)).map(f => f.path) : deletion.files;
    const owners = new Set([entry.line]);
    let wide = false;
    for (const member of members) {
      const owner = /^files\/([^/]+)\//.exec(member)?.[1];
      if (owner) owners.add(owner);
      for (const mention of mentions.get(member) || []) owners.add(mention.line);
      for (const line of named.get(member) || []) if (line) owners.add(line); else wide = true;
    }
    const known = [...owners].map(slug => lineBySlug.get(slug)).filter(Boolean);
    entry.usage = own.has(file) || wide || known.some(l => !l.archived) ? "active" : known.some(l => l.archived) || file.startsWith("archive/") ? "archived" : [...owners].some(slug => deleted.has(slug)) ? "deleted" : "unlinked";
    entry.deletion = deletion;
  }

  // Claude Artifacts: the links to them in a line's steps and its Works' results, each once, where it first came.
  const artifacts = new Map();
  const found = (url, id, text, l, s) => {
    const had = artifacts.get(id), title = artifactTitle(text, url);
    if (had) { if (had.title === "Claude Artifact" && title !== "Claude Artifact") had.title = title; return; }
    artifacts.set(id, { path:url, id, kind:"artifact", title, line:l.slug, step:s.id, by:whoOf(l, s), mtime:timeOf(s) || l.statusAt || 0 });
  };
  const scanText = (text, l, s) => {
    const body = String(text || "");
    if (!body.includes("claude.ai/")) return;
    for (const m of body.matchAll(ARTIFACT_LINK)) found(m[2], m[3], m[1], l, s);
    for (const m of body.replace(ARTIFACT_LINK, "").matchAll(ARTIFACT_BARE)) found(m[0], m[1], "", l, s);
  };
  for (const t of topics) {
    const l = lineBySlug.get(t.slug); if (!l) continue;
    const byId = new Map((l.stations || []).map(s => [s.id, s]));
    for (const step of t.doc.steps || []) {
      const s = byId.get(step.id); if (!s) continue;
      scanText(step.body, l, s);
      if (!YOURS.has(s.kind) && s.detail) scanText(resultOf(s)?.text, l, s);
    }
  }
  return { files:out, artifacts:[...artifacts.values()].sort((a, b) => b.mtime - a.mtime) };
}

// Home needs only three visual outputs. Reuse the classified files so their dates and origins agree with Canvases & files.
function latestFilesOf(files, pictures) {
  const byPath = new Map(files.map(f => [f.path, f])), items = new Map();
  for (const c of pictures) {
    if (!c.source || !c.hasPicture) continue;
    const file = byPath.get(c.source);
    items.set(c.source, { kind:"canvas", path:c.path, source:c.source, title:c.title, mtime:file?.mtime ?? c.mtime ?? 0, topic:file?.line || c.topic || "" });
  }
  for (const f of files) {
    if (f.kind !== "picture" || !/\.(png|jpe?g|gif|webp)$/i.test(f.path)) continue;
    items.set(f.path, { kind:"image", path:f.path, source:"", title:f.title || path.posix.basename(f.path), mtime:f.mtime || 0, topic:f.line || "" });
  }
  return [...items.values()].sort((a, b) => b.mtime - a.mtime || a.path.localeCompare(b.path)).slice(0, 3);
}

// The files that make up one shown file: a picture and its .webp copy, or a page folder's whole folder (as the folder itself).
function partsOf(file, names, folder = false) {
  if (folder) return { folder:path.posix.dirname(file), files:[path.posix.dirname(file)] };
  const twin = /\.png$/i.test(file) ? file.replace(/\.png$/i, ".webp") : "";
  return { folder:"", files:[file, ...(twin && names.has(twin) ? [twin] : [])] };
}

module.exports = { shelfOf, kindByName, partsOf, latestFilesOf, pathsIn, PASTED };
