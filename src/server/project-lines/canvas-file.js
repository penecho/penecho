"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { validateArchitecture, architectureHtml } = require("../../architecture/schema.js");
const { validateSequence, sequenceHtml } = require("../../sequence/schema.js");
const { validateWorkflow, workflowHtml } = require("../../workflow/schema.js");
const { expandSlideCharts } = require("../slides.js");
const { isPrototypeHtml } = require("../prototype-rules.js");
const { pagePicture, pagePictureChecked, browserPath:chromePath } = require("./page-picture.js");
const NOTE_CARD = require("../../../public/note-card.js");

// Real Canvas files that an agent asks for by writing one small file. PenEcho, not the agent, makes the
// editable Canvas and the picture, so this works from any agent and inside any sandbox, with no browser open.
const SIZE = 20000, TILE = 512, WIDGET_W = 1800, START = 2000, MAX_SOURCE = 512 * 1024;
// What the Canvas keeps in one Widget. It drops anything larger when it opens, so a larger page is refused here, where the agent hears why.
const MAX_EXPLORER = 200000;
// A deck arrives as one file per slide (deck.slide-01.html …) and becomes one Canvas: 16:9 slides in a column, in order.
const SLIDE_FILE = /\.slide-(\d{1,2})\.html$/, SLIDE_W = 1280, SLIDE_H = 720, SLIDE_GAP = 140;
const pictureBase = source => source.replace(/\.(diagram\.json|explorer\.html|note\.json|slide-\d{1,2}\.html)$/, "");
// Note cards arrive as one file, name.note.json: one note object, or several ({ "cards": [...] } or a list) for flashcards. They stand side by side on one Canvas.
const NOTE_FILE = /\.note\.json$/, MAX_CARDS = 24, CARD_W = 900, CARD_H = 1200, CARD_GAP = 100;
const cardKey = (base, i) => (i ? `${base}#card-${i + 1}` : base);
// Several pictures on one Canvas: `<canvas>+<name>.diagram.json` is drawn as its own Widget onto `<canvas>.penecho.json`.
// Every other source file is drawn onto the Canvas of its own name.
const PLUS = /^(.*\/[^/+]+)\+[^/]+$/;
const canvasBase = source => { const base = pictureBase(source); return PLUS.exec(base)?.[1] || base; };
const slideNumber = source => Number(SLIDE_FILE.exec(source)?.[1] || 0);
const DIAGRAMS = {
  architecture:{ validate:validateArchitecture, html:architectureHtml },
  sequence:{ validate:validateSequence, html:sequenceHtml },
  workflow:{ validate:validateWorkflow, html:workflowHtml },
};
const ARCHITECTURE_NODES = ["frontend", "backend", "database", "cloud", "security", "messagebus", "external"], WORKFLOW_NODES = ["start", "process", "decision", "fork", "join", "end"], EDGE_KINDS = ["call", "data", "config", "optional", "return"];
const hash = text => crypto.createHash("sha256").update(text).digest("hex");
const load = file => import(pathToFileURL(path.join(__dirname, "../..", file)).href);

// The same layout and drawing code the Canvas uses, so the picture matches what opens.
async function diagramSvg(type, semantic) {
  if (type === "sequence") {
    const [{ layoutSequence }, { renderSvg }] = await Promise.all([load("sequence/layout.mjs"), load("sequence/render.mjs")]);
    const layout = layoutSequence(semantic);
    return { svg:renderSvg(layout), width:layout.width, height:layout.height };
  }
  const ELK = require("elkjs/lib/elk.bundled.js"), elk = new (ELK.default || ELK)();
  const [layouts, { renderSvg }] = await Promise.all([load(`${type}/layout.mjs`), load(`${type}/render.mjs`)]);
  const layout = await (type === "architecture" ? layouts.layoutArchitecture(semantic, elk) : layouts.layoutWorkflow(semantic, elk));
  return { svg:renderSvg(layout), width:layout.width, height:layout.height };
}
async function svgToPng(svg) {
  const sharp = require("sharp");
  return sharp(Buffer.from(svg), { density:144 }).flatten({ background:"#ffffff" }).png({ compressionLevel:9 }).toBuffer();
}
async function previewAsset(png) {
  const sharp = require("sharp");
  const small = await sharp(png).resize(640, 426, { fit:"contain", background:"#ffffff" }).png().toBuffer();
  return { kind:"preview", contentType:"image/png", metadata:{ width:640, height:426 }, dataBase64:small.toString("base64") };
}
function newBundle({ id, name }) {
  const now = Date.now();
  return {
    version:2, bundleVersion:2, mode:"snapshot", formatVersion:1, extensions:{}, id, createdAt:now, updatedAt:now, name,
    manifest:{ format:"penecho-raster-tiles", formatVersion:1, canvasSize:{ width:SIZE, height:SIZE }, tileSize:TILE, view:{ scale:.5, panX:0, panY:0, navigationLocked:false }, animations:[], textBoxes:[], savedAt:new Date(now).toISOString(), extensions:{} },
    assets:[],
  };
}
const validBundle = b => b && b.bundleVersion === 2 && b.mode === "snapshot" && b.formatVersion === 1 && b.manifest?.format === "penecho-raster-tiles" && b.manifest?.formatVersion === 1 && Array.isArray(b.assets);
const widgetId = key => `widget-${BigInt(`0x${hash(`penecho-project-picture:${key}`).slice(0, 12)}`).toString()}`;
const decodeWidget = asset => JSON.parse(Buffer.from(asset.dataBase64, "base64").toString("utf8"));
// A clear spot on the Canvas, so a picture never lands on top of what is already there.
function clearSpot(bundle, others, w, h, view, beside) {
  const taken = [...others, ...(bundle.manifest.textBoxes || []), ...(bundle.manifest.animations || [])].filter(v => [v?.x, v?.y, v?.w, v?.h].every(Number.isFinite));
  for (const asset of bundle.assets) {
    const m = /^(\d+),(\d+)$/.exec(asset.kind === "tile" ? asset.metadata?.tileKey || "" : "");
    if (m) taken.push({ x:+m[1] * TILE, y:+m[2] * TILE, w:TILE, h:TILE });
    if (asset.kind === "resource" && asset.metadata?.resourceType === "image") { const v = asset.metadata; if ([v.x, v.y, v.w, v.h].every(Number.isFinite)) taken.push(v); }
  }
  const free = spot => spot.x >= 0 && spot.y >= 0 && spot.x + w <= SIZE && spot.y + h <= SIZE && !taken.some(b => spot.x < b.x + b.w && spot.x + w > b.x && spot.y < b.y + b.h && spot.y + h > b.y);
  const fitsView = p => !view || (p.x >= view.x && p.y >= view.y && p.x + w <= view.x + view.w && p.y + h <= view.y + view.h);
  const adjacent = b => [{ x:b.x + b.w + 32, y:b.y }, { x:b.x - w - 32, y:b.y }, { x:b.x, y:b.y + b.h + 32 }, { x:b.x, y:b.y - h - 32 }];
  const neighbors = beside ? adjacent(beside) : [];
  if (view) {
    const left = Math.max(0, view.x), top = Math.max(0, view.y);
    const right = Math.min(SIZE, view.x + view.w), bottom = Math.min(SIZE, view.y + view.h);
    const inset = Math.max(0, Math.min(32, (right - left - w) / 2, (bottom - top - h) / 2));
    const candidates = [...neighbors, ...taken.filter(b => b.x < right && b.y < bottom && b.x + b.w > left && b.y + b.h > top).flatMap(adjacent),
      { x:left + inset, y:top + inset }, { x:right - w - inset, y:top + inset }, { x:left + inset, y:bottom - h - inset }, { x:right - w - inset, y:bottom - h - inset }];
    const spot = candidates.map(p => ({ x:Math.round(p.x), y:Math.round(p.y) })).find(p => fitsView(p) && free(p));
    if (spot) return { ...spot, w, h };
  }
  const neighbor = neighbors.find(free);
  if (neighbor) return { ...neighbor, w, h };
  // Beside what is already there, where the person is looking, not far off at the Canvas's top-left (PE-539: a clock landed 6,000 px from the drawing it was for).
  if (taken.length) {
    const left = Math.min(...taken.map(b => b.x)), top = Math.min(...taken.map(b => b.y)), right = Math.max(...taken.map(b => b.x + b.w)), bottom = Math.max(...taken.map(b => b.y + b.h));
    for (const spot of [{ x:right + 120, y:top }, { x:left, y:bottom + 120 }]) if (free({ ...spot, w, h })) return { ...spot, w, h };
  }
  for (let row = 0; row < 40; row++) {
    const spot = { x:START, y:START + row * (h + 120), w, h };
    if (free(spot)) return spot;
  }
  return { x:START, y:START, w, h };
}
// The box around the person's ink, in Canvas units, from the tiles that hold it, each trimmed to its marks. null: nothing drawn.
async function inkBox(bundle) {
  const tiles = (Array.isArray(bundle?.assets) ? bundle.assets : []).filter(a => a?.kind === "tile" && /^\d+,\d+$/.test(a.metadata?.tileKey || "") && typeof a.dataBase64 === "string").slice(0, 400);
  if (!tiles.length) return null;
  const sharp = require("sharp");
  let box = null;
  for (const tile of tiles) {
    const [tx, ty] = tile.metadata.tileKey.split(",").map(Number);
    let part = { x:tx * TILE, y:ty * TILE, w:TILE, h:TILE };
    try {
      const { info } = await sharp(Buffer.from(tile.dataBase64, "base64")).ensureAlpha().trim({ threshold:10 }).toBuffer({ resolveWithObject:true });
      part = { x:tx * TILE - (info.trimOffsetLeft || 0), y:ty * TILE - (info.trimOffsetTop || 0), w:info.width, h:info.height };
    } catch { /* An empty or unreadable tile: the whole tile, then. */ }
    box = box ? { x:Math.min(box.x, part.x), y:Math.min(box.y, part.y), r:Math.max(box.r, part.x + part.w), b:Math.max(box.b, part.y + part.h) } : { x:part.x, y:part.y, r:part.x + part.w, b:part.y + part.h };
  }
  return { x:box.x, y:box.y, w:box.r - box.x, h:box.b - box.y };
}
// Adds the picture's Widget, or updates it in place. Everything else on that Canvas stays as it is.
function putWidget(bundle, { key, id = widgetId(key), title, html, contentW, contentH, sourceFormat, frameworkVersion, copyText, copyLabel, at, width = WIDGET_W, placement = {} }) {
  const index = bundle.assets.findIndex(a => a.kind === "widget" && a.metadata?.widgetId === id);
  const others = bundle.assets.filter((a, i) => a.kind === "widget" && i !== index).map(decodeWidget), existing = index >= 0 ? decodeWidget(bundle.assets[index]) : null;
  const { spot:explicit, view, beside } = placement;
  width = explicit?.w || beside?.w || width;
  if (!explicit && view && !beside) {
    width = Math.max(120, Math.min(width, Math.floor(view.w * .94), Math.floor(view.h * .94 * contentW / contentH)));
  }
  const h = !explicit && beside ? beside.h : Math.max(1, Math.round(width * contentH / contentW));
  const spot = existing ? { x:existing.x, y:existing.y, w:existing.w, h:existing.h }
    : explicit ? { x:Math.max(0, Math.min(explicit.x, SIZE - width)), y:Math.max(0, Math.min(explicit.y, SIZE - h)), w:width, h }
    : at ? { ...at(h), w:width, h } : clearSpot(bundle, others, width, h, view, beside);
  // A page in place of a diagram, or of anything else the Canvas knew how to copy, is a page now.
  const kept = existing && !sourceFormat ? (({ sourceFormat:_f, frameworkVersion:_v, copyLabel:_l, ...rest }) => rest)(existing) : existing;
  const widget = { ...(kept || {}), id, widgetType:"html_widget", pluginId:"general", ...spot, contentW:existing?.contentW || contentW, contentH:existing?.contentH || contentH, title:String(title).slice(0, 120), refreshSeconds:0, html, ...(sourceFormat ? { sourceFormat } : {}), ...(frameworkVersion ? { frameworkVersion } : {}), ...(copyLabel ? { copyLabel } : {}) };
  if (copyText && copyText.length <= 16000) widget.copyText = copyText; else delete widget.copyText;
  const asset = { kind:"widget", contentType:"application/json", metadata:{ widgetId:id, pluginId:"general" }, dataBase64:Buffer.from(JSON.stringify(widget)).toString("base64") };
  if (index >= 0) bundle.assets[index] = asset; else bundle.assets.push(asset);
  return widget;
}
// What PenEcho Lines keeps in a Canvas file about itself, in a field older versions ignore and the Canvas page hands back as it read it.
// `sources` says which text each agent-made Widget was last drawn from: { widgetId: sha256 of the source file }.
// `behind`: the Canvas's picture (<canvas>.png) does not show all of it yet, so the page that opens it next draws that picture again.
const LINES = "penecho.lines";
const plain = value => value && typeof value === "object" && !Array.isArray(value);
const linesOf = bundle => (plain(bundle?.manifest?.extensions?.[LINES]) ? bundle.manifest.extensions[LINES] : null);
function linesFor(bundle) {
  if (!plain(bundle.manifest)) bundle.manifest = {};
  if (!plain(bundle.manifest.extensions)) bundle.manifest.extensions = {};
  if (!plain(bundle.manifest.extensions[LINES])) bundle.manifest.extensions[LINES] = {};
  return bundle.manifest.extensions[LINES];
}
const sourcesOf = bundle => (plain(linesOf(bundle)?.sources) ? linesOf(bundle).sources : null);
const sourceKey = source => (SLIDE_FILE.test(source) ? `${pictureBase(source)}#slide-${slideNumber(source)}` : pictureBase(source));
// A Widget drawn on the Canvas itself (by Canvas AI or by hand) has no file of its own. Written out as `<canvas>+widget-12.explorer.html`
// (or .diagram.json), that file is the Widget's: sending it back changes that Widget where it stands, and never adds one (R9).
const OWN_WIDGET = /\+(widget-\d{1,15})$/;
const namedWidget = source => (SLIDE_FILE.test(source) || NOTE_FILE.test(source) ? "" : OWN_WIDGET.exec(pictureBase(source))?.[1] || "");
const sourceWidgetId = source => namedWidget(source) || widgetId(sourceKey(source));
function recordSource(bundle, id, text) {
  const lines = linesFor(bundle);
  if (!plain(lines.sources)) lines.sources = {};
  lines.sources[id] = hash(text);
}
const widgetAsset = (bundle, id) => bundle.assets.find(a => a?.kind === "widget" && a.metadata?.widgetId === id);
// A Widget that is all its Canvas holds: no ink, words, pictures or other Widgets. Its picture is then the Canvas's picture too.
const onlyWidget = (bundle, id) => bundle.assets.every(a => a?.kind === "preview" || (a?.kind === "widget" && a.metadata?.widgetId === id)) && !bundle.manifest.textBoxes?.length && !bundle.manifest.animations?.length;
// Whether a Canvas already holds a source file as it is written now. null: the Canvas was made before this was kept, so only the old way of telling is left.
function sourceApplied({ sources, widgets }, source, made) {
  const id = sourceWidgetId(source);
  if (sources && typeof sources[id] === "string") return sources[id] === made;
  if (sources && !widgets.includes(id)) return false;
  return null;
}
// A page saves the Canvas as it last read it. What an agent drew since then is in the folder's copy, so each such Widget
// goes into what the page saves, where and as large as the page has it. A Widget whose source did not change is the page's.
function keepSources(incoming, disk) {
  const mine = sourcesOf(disk), changed = [];
  if (!mine || !Array.isArray(incoming?.assets) || !Array.isArray(disk.assets)) return changed;
  const theirs = sourcesOf(incoming) || {};
  for (const [id, made] of Object.entries(mine)) {
    if (theirs[id] === made) continue;
    const asset = widgetAsset(disk, id), at = incoming.assets.findIndex(a => a?.kind === "widget" && a.metadata?.widgetId === id);
    if (asset) {
      let widget;
      try { widget = decodeWidget(asset); } catch { continue; }
      if (at >= 0) { try { const { x, y, w, h } = decodeWidget(incoming.assets[at]); if ([x, y, w, h].every(Number.isFinite)) Object.assign(widget, { x, y, w, h }); } catch { /* The folder's place for it stands. */ } }
      const next = { ...asset, dataBase64:Buffer.from(JSON.stringify(widget)).toString("base64") };
      if (at >= 0) incoming.assets[at] = next; else incoming.assets.push(next);
      changed.push(widget);
    }
    const lines = linesFor(incoming);
    if (!plain(lines.sources)) lines.sources = {};
    lines.sources[id] = made;
  }
  return changed;
}
// A name given outside the page (Rename) stays until a page that has read it saves another.
function keepName(incoming, disk) {
  const given = linesOf(disk)?.name;
  if (typeof given !== "string" || !given || linesOf(incoming)?.name === given) return "";
  incoming.name = String(disk.name || given);
  linesFor(incoming).name = given;
  return incoming.name;
}
function nameBundle(bundle, name) {
  bundle.name = name;
  linesFor(bundle).name = name;
}
// Widget ids come from where the source file is. When a Canvas and its source files move together, its Widgets keep being theirs.
// `names` are the `+<name>` parts of the other pictures drawn onto it.
function rekeySources(bundle, fromBase, toBase, names = []) {
  if (fromBase === toBase || !Array.isArray(bundle?.assets)) return bundle;
  const ids = new Map();
  for (const [from, to] of [[fromBase, toBase], ...names.map(name => [`${fromBase}+${name}`, `${toBase}+${name}`])]) {
    ids.set(widgetId(from), widgetId(to));
    for (let n = 0; n < 100; n++) ids.set(widgetId(`${from}#slide-${n}`), widgetId(`${to}#slide-${n}`));
    for (let n = 2; n <= MAX_CARDS; n++) ids.set(widgetId(`${from}#card-${n}`), widgetId(`${to}#card-${n}`));
  }
  bundle.assets = bundle.assets.map(asset => {
    const next = asset?.kind === "widget" ? ids.get(asset.metadata?.widgetId) : null;
    if (!next) return asset;
    try { return { ...asset, metadata:{ ...asset.metadata, widgetId:next }, dataBase64:Buffer.from(JSON.stringify({ ...decodeWidget(asset), id:next })).toString("base64") }; } catch { return asset; }
  });
  const sources = sourcesOf(bundle);
  if (sources) linesFor(bundle).sources = Object.fromEntries(Object.entries(sources).map(([id, made]) => [ids.get(id) || id, made]));
  return bundle;
}
// The small picture every Canvas file carries, as a PNG. It stands in for a Canvas nobody has opened in the project yet.
async function previewPng(bundle) {
  const asset = Array.isArray(bundle?.assets) ? bundle.assets.find(a => a?.kind === "preview" && typeof a.dataBase64 === "string") : null;
  if (!asset) return null;
  const bytes = Buffer.from(asset.dataBase64, "base64");
  if (bytes.subarray(0, 4).toString("latin1") === "\x89PNG") return bytes;
  try { return await require("sharp")(bytes).png().toBuffer(); } catch { return null; }
}
// A new Canvas opens looking at its picture, not at an empty stretch of paper.
function frameFirst(bundle, existing, widget) {
  if (!existing) bundle.manifest.view = { region:{ x:widget.x - 80, y:widget.y - 80, w:widget.w + 160, h:widget.h + 160 }, navigationLocked:false };
}
function setPreview(bundle, preview) {
  bundle.assets = [...bundle.assets.filter(a => a.kind !== "preview"), preview];
  bundle.updatedAt = Date.now();
  bundle.manifest.savedAt = new Date(bundle.updatedAt).toISOString();
}
// A page has no picture until something draws it: PenEcho's own Chromium in the desktop app, else an installed browser, cut off from the network.
const screenshot = (html, size) => pagePicture(html, size);
// The Canvas draws a page with a large default text size on html and body, put after the page's own styles (widget-host.js), so a body font-size
// of the page's own never holds. The picture is drawn the same way, at the Widget's size: it is what opens, not a nicer first look that changes when the Canvas does.
const CANVAS_BASE = "<style>html,body{font-size:clamp(36px,1.2cqw,52px)}</style>";
const inCanvas = html => (isPrototypeHtml(html) ? html : /<\/head>/i.test(html) ? html.replace(/<\/head>/i, () => `${CANVAS_BASE}</head>`) : `${CANVAS_BASE}${html}`);
const placeCard = title => `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="750" viewBox="0 0 1200 750"><rect width="1200" height="750" fill="#f8f9fb"/><text x="600" y="375" text-anchor="middle" font-family="Arial, sans-serif" font-size="44" fill="#20242c">${String(title).replace(/[<&>]/g, c => ({ "<":"&lt;", "&":"&amp;", ">":"&gt;" }[c]))}</text></svg>`;
const pageTitle = (html, fallback) => (/<title[^>]*>([^<]{1,120})<\/title>/i.exec(html)?.[1] || fallback).trim();
const nice = name => name.replace(/[-_]+/g, " ").replace(/^./, c => c.toUpperCase());

// Turns one agent's file into `<name>.penecho.json` and `<name>.png` beside it.
// Whether a file can become a picture, and why not, without drawing it.
function checkPicture(source, text) {
  if (NOTE_FILE.test(source)) {
    if (text.length > NOTE_CARD.MAX_SOURCE_CHARS) throw Error("The note file is too large.");
    let raw; try { raw = JSON.parse(text); } catch (error) { throw Error(`It is not valid JSON: ${error.message}`); }
    const list = Array.isArray(raw) ? raw : Array.isArray(raw?.cards) ? raw.cards : [raw];
    if (!list.length) throw Error('A note file needs one note object, or "cards" with 1 to 24 of them.');
    if (list.length > MAX_CARDS) throw Error(`At most ${MAX_CARDS} cards go in one note file; split them over two files.`);
    return { notes:list.map((card, i) => { try { return NOTE_CARD.normalize({ ...card, source:{ kind:"agent" } }); } catch (error) { throw Error(`${list.length > 1 ? `Card ${i + 1}: ` : ""}${error.message}`); } }) };
  }
  if (source.endsWith(".diagram.json")) {
    if (text.length > MAX_SOURCE) throw Error("The diagram file is too large.");
    let raw; try { raw = JSON.parse(text); } catch (error) { throw Error(`It is not valid JSON: ${error.message}`); }
    const { type, ...rest } = raw || {};
    if (!Object.hasOwn(DIAGRAMS, type)) throw Error('"type" must be architecture, sequence or workflow.');
    return { type, semantic:DIAGRAMS[type].validate({ version:1, ...rest }) };
  }
  if (SLIDE_FILE.test(source) && !/data-penecho-slide/i.test(text)) throw Error('A slide needs data-penecho-slide on its root element. Follow the slide rules in ppt-slides.md.');
  text = expandSlideCharts(text);
  if (text.length > MAX_EXPLORER) throw Error(`The page is too large: ${text.length} characters, and a Canvas holds ${MAX_EXPLORER}. Make it smaller, for example with smaller pictures or less data.`);
  if (!/<[a-z]/i.test(text)) throw Error("It is not an HTML page.");
  return {};
}
// Agents guess at small things, such as a node type of their own, and may be gone before anyone can tell them. A picture is worth more than that detail.
function relaxPicture(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!Array.isArray(raw?.nodes)) return null;
  for (const node of raw.nodes) {
    if (raw.type === "architecture" && node?.type !== undefined && !ARCHITECTURE_NODES.includes(node.type)) delete node.type;
    if (raw.type === "workflow" && !WORKFLOW_NODES.includes(node?.type)) node.type = "process";
  }
  for (const edge of Array.isArray(raw.edges) ? raw.edges : []) if (raw.type === "architecture" && edge?.kind !== undefined && !EDGE_KINDS.includes(edge.kind)) delete edge.kind;
  return JSON.stringify(raw);
}
async function renderPagePicture(renderPage, html, size, check) {
  if (typeof renderPage !== "function") {
    if (check) return pagePictureChecked(html, size);
    return { png:await screenshot(html, size), checks:null };
  }
  const out = await renderPage(html, size, { check:Boolean(check) });
  if (Buffer.isBuffer(out)) return { png:out, checks:null };
  if (out && typeof out === "object") return { png:out.png || null, checks:check ? out.checks ?? null : null };
  return { png:null, checks:null };
}
async function makePicture({ source, text, existing, name, placement = {}, renderPage = null }) {
  const base = pictureBase(source);
  let bundle = null;
  if (existing) { try { bundle = JSON.parse(existing); } catch { /* A broken Canvas file is replaced below only if there is none. */ } if (!validBundle(bundle)) throw Error(`${base}.penecho.json is not a Canvas file PenEcho can update.`); }
  let title, png = null, rendered = true, checks = null;
  const { type, semantic, notes } = checkPicture(source, text);
  if (notes) {
    title = notes.length > 1 ? nice(name.replace(NOTE_FILE, "")) : notes[0].title;
    const first = NOTE_CARD.documentFor(notes[0]);
    ({ png } = await renderPagePicture(renderPage, first, { width:CARD_W, height:CARD_H }, false));
    rendered = Boolean(png);
    png ||= await svgToPng(placeCard(notes[0].title));
    bundle ||= newBundle({ id:`lines-${hash(base).slice(0, 24)}`, name:title });
    // Fewer cards than last time: the ones left over go.
    const gone = new Set(Array.from({ length:MAX_CARDS - notes.length }, (_, k) => widgetId(cardKey(base, notes.length + k))));
    bundle.assets = bundle.assets.filter(a => !(a.kind === "widget" && gone.has(a.metadata?.widgetId)));
    const placed = notes.map((note, i) => putWidget(bundle, { key:cardKey(base, i), title:note.title, html:i ? NOTE_CARD.documentFor(note) : first, contentW:CARD_W, contentH:CARD_H, width:CARD_W, sourceFormat:NOTE_CARD.FORMAT, frameworkVersion:NOTE_CARD.FRAMEWORK_VERSION, copyText:NOTE_CARD.formatSource(note), copyLabel:NOTE_CARD.COPY_LABEL, at:() => ({ x:START + i * (CARD_W + CARD_GAP), y:START }), placement:i === 0 && placement.spot ? { spot:placement.spot } : {} }));
    if (!existing) { const last = placed[placed.length - 1]; bundle.manifest.view = { region:{ x:placed[0].x - 80, y:placed[0].y - 80, w:last.x + last.w - placed[0].x + 160, h:CARD_H + 160 }, navigationLocked:false }; }
  } else if (source.endsWith(".diagram.json")) {
    const { svg, width, height } = await diagramSvg(type, semantic);
    png = await svgToPng(svg);
    title = semantic.title;
    bundle ||= newBundle({ id:`lines-${hash(base).slice(0, 24)}`, name:title });
    const contentW = Math.max(900, Math.min(2400, Math.round(width) + 48)), contentH = Math.max(420, Math.min(Math.floor(contentW * 2600 / 1800), Math.round(height) + 120));
    const widget = putWidget(bundle, { key:base, id:sourceWidgetId(source), title, placement, html:DIAGRAMS[type].html(semantic), contentW, contentH, sourceFormat:`penecho-${type}+json`, copyText:JSON.stringify(semantic, null, 2) });
    frameFirst(bundle, existing, widget);
  } else if (SLIDE_FILE.test(source)) {
    const number = slideNumber(source), html = expandSlideCharts(text), deck = /\bdata-penecho-deck\s*=\s*["']([^"']{1,120})["']/i.exec(html)?.[1] || nice(name.replace(SLIDE_FILE, "").replace(/\.slide-\d{1,2}$/, ""));
    title = deck;
    // Every slide is drawn, but only the first one becomes the deck's picture.
    if (number === 1 || !existing) {
      ({ png } = await renderPagePicture(renderPage, html, { width:SLIDE_W, height:SLIDE_H }, false));
      rendered = Boolean(png);
      png ||= await svgToPng(placeCard(deck));
    }
    bundle ||= newBundle({ id:`lines-${hash(base).slice(0, 24)}`, name:deck });
    const widget = putWidget(bundle, { key:`${base}#slide-${number}`, title:`${String(number).padStart(2, "0")} · ${pageTitle(html, `Slide ${number}`)}`, html, contentW:SLIDE_W, contentH:SLIDE_H, at:h => ({ x:START, y:START + (number - 1) * (h + SLIDE_GAP) }), placement:{ spot:placement.spot } });
    if (!existing || number === 1) bundle.manifest.view = { region:{ x:widget.x - 80, y:widget.y - 80, w:widget.w + 160, h:widget.h + 160 }, navigationLocked:false };
  } else {
    const own = bundle ? widgetAsset(bundle, sourceWidgetId(source)) : null;
    let ownTitle = "";
    try { ownTitle = own ? String(decodeWidget(own).title || "") : ""; } catch { /* Named below. */ }
    title = pageTitle(text, ownTitle || nice(name));
    // A design prototype is also measured for the layout defects its small picture hides.
    ({ png, checks } = await renderPagePicture(renderPage, inCanvas(text), { width:1200, height:750 }, isPrototypeHtml(text)));
    rendered = Boolean(png);
    png ||= await svgToPng(placeCard(title));
    bundle ||= newBundle({ id:`lines-${hash(base).slice(0, 24)}`, name:title });
    frameFirst(bundle, existing, putWidget(bundle, { key:base, id:sourceWidgetId(source), title, placement, html:text, contentW:1200, contentH:750 }));
  }
  // Which text this Widget was drawn from, so the same file is not drawn again over what someone changed on the Canvas.
  recordSource(bundle, sourceWidgetId(source), text);
  if (png) setPreview(bundle, await previewAsset(png));
  else { bundle.updatedAt = Date.now(); bundle.manifest.savedAt = new Date(bundle.updatedAt).toISOString(); }
  return { base, title, png, rendered, checks, bundle };
}
// Whether this slide is already on its deck's Canvas exactly as written, so it need not be drawn again.
function slideUnchanged(existing, source, text) {
  let bundle;
  try { bundle = JSON.parse(existing); } catch { return false; }
  if (!validBundle(bundle)) return false;
  const id = widgetId(`${pictureBase(source)}#slide-${slideNumber(source)}`), asset = bundle.assets.find(a => a.kind === "widget" && a.metadata?.widgetId === id);
  try { return Boolean(asset) && decodeWidget(asset).html === expandSlideCharts(text); } catch { return false; }
}

// The slides on a Canvas (Widgets marked data-penecho-slide), in reading order: deck by deck in the order they first
// appear, and inside a deck rows from top to bottom, left to right in a row, as the Canvas orders a deck.
const SLIDE_MARK = /\bdata-penecho-slide\b/i, MAX_SLIDES = 120;
const deckName = html => /\bdata-penecho-deck\s*=\s*["']([^"']{1,120})["']/i.exec(html)?.[1] || "";
function canvasSlides(text) {
  let bundle = text;
  if (typeof text === "string") { try { bundle = JSON.parse(text); } catch { return []; } }
  if (!validBundle(bundle)) return [];
  const slides = [];
  for (const asset of bundle.assets) {
    if (asset?.kind !== "widget" || typeof asset.dataBase64 !== "string") continue;
    let widget;
    try { widget = decodeWidget(asset); } catch { continue; }
    if (!widget || widget.pending || typeof widget.html !== "string" || !SLIDE_MARK.test(widget.html) || widget.html.length > MAX_EXPLORER) continue;
    slides.push({ title:String(widget.title || "").slice(0, 120), html:widget.html, deck:deckName(widget.html), x:Number(widget.x) || 0, y:Number(widget.y) || 0, h:Number(widget.h) || SLIDE_H });
  }
  const row = Math.max(1, Math.min(...slides.map(slide => slide.h), SLIDE_H) * 0.5), byPlace = (a, b) => Math.round((a.y - b.y) / row) || a.x - b.x || a.y - b.y;
  slides.sort(byPlace);
  const decks = [...new Set(slides.map(slide => slide.deck))];
  return slides.sort((a, b) => decks.indexOf(a.deck) - decks.indexOf(b.deck) || byPlace(a, b)).slice(0, MAX_SLIDES).map(({ title, html, deck }) => ({ title, html, deck }));
}

// The Widgets on a Canvas that have no file to change them by, each with the file that would be theirs: a diagram's JSON, or any other page's HTML.
// Note cards are left out: their HTML is made from the card. `has(id)`: a file the Canvas is drawn from already makes that Widget.
const DIAGRAM_FORMAT = /^penecho-(architecture|sequence|workflow)\+json$/;
function widgetFiles(bundle, base, has = () => false) {
  if (!validBundle(bundle)) return [];
  const out = [];
  for (const asset of bundle.assets) {
    const id = asset?.kind === "widget" ? asset.metadata?.widgetId : "";
    if (!id || !/^widget-\d{1,15}$/.test(id) || has(id)) continue;
    let widget;
    try { widget = decodeWidget(asset); } catch { continue; }
    if (!widget || widget.pending || typeof widget.html !== "string" || !widget.html || widget.sourceFormat === NOTE_CARD.FORMAT) continue;
    const type = DIAGRAM_FORMAT.exec(widget.sourceFormat || "")?.[1];
    let text = "";
    if (type && typeof widget.copyText === "string") { try { const { version:_v, ...semantic } = JSON.parse(widget.copyText); text = JSON.stringify({ type, ...semantic }, null, 2); } catch { /* Its page, then. */ } }
    const source = text ? `${base}+${id}.diagram.json` : `${base}+${id}.explorer.html`;
    if (!text) text = widget.html;
    if (text.length > MAX_EXPLORER) continue;
    out.push({ id, title:String(widget.title || "").replace(/\s+/g, " ").trim().slice(0, 120), source, text });
  }
  return out;
}

// What the project's pages and the picture maker need to know of a Canvas file, read once for each version of the file.
function bundleInfo(text) {
  const none = { valid:false, id:"", name:"", renamed:"", from:"", group:"", rev:"", slides:0, sources:null, widgets:[] };
  let bundle;
  try { bundle = JSON.parse(text); } catch { return none; }
  if (!validBundle(bundle)) return { ...none, name:typeof bundle?.name === "string" ? bundle.name : "" };
  const lines = linesOf(bundle) || {};
  return {
    valid:true, id:typeof bundle.id === "string" ? bundle.id : "", name:typeof bundle.name === "string" ? bundle.name.trim() : "", renamed:typeof lines.name === "string" ? lines.name : "", from:typeof lines.from === "string" ? lines.from : "", group:typeof lines.group === "string" ? lines.group : "", rev:typeof lines.rev === "string" ? lines.rev : "",
    slides:canvasSlides(bundle).length, sources:sourcesOf(bundle), widgets:bundle.assets.filter(a => a?.kind === "widget" && a.metadata?.widgetId).map(a => a.metadata.widgetId),
  };
}

module.exports = { onlyWidget, inCanvas, isPrototypeHtml, inkBox, bundleInfo, linesOf, sourcesOf, sourceApplied, sourceWidgetId, namedWidget, widgetFiles, keepSources, keepName, nameBundle, rekeySources, previewPng, linesFor, sourceHash:hash, makePicture, canvasSlides, checkPicture, relaxPicture, slideUnchanged, pictureBase, canvasBase, slideNumber, diagramSvg, svgToPng, newBundle, validBundle, widgetId, chromePath, SOURCE:/^files\/.+\.(diagram\.json|explorer\.html|note\.json|slide-\d{1,2}\.html)$/, SLIDE_FILE, NOTE_FILE };
