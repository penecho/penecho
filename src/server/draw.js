"use strict";
const L = require("./project-lines/layout.js");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const F = require("./project-lines/format.js");
const { validateToolArguments } = require("./mcp/schema.js");
const { plotPage, plotRange } = require("./mcp/no-page.js");
const { pagePicture:defaultPagePicture } = require("./project-lines/page-picture.js");
const Slides = require("./slides.js");
const { checkPicture, relaxPicture, inkBox, sourceWidgetId, inCanvas } = require("./project-lines/canvas-file.js");
const { failure, MY_CANVASES_ID } = require("./project-lines/store.js");

// One stateless call puts a picture on a Canvas the person can see and edit, with no session and no open page:
// an agent sends one file it would otherwise drop in .penecho/drawings/ and its working folder, and gets back
// the Canvas's link and the absolute path of its picture. The folder decides the project; a folder in no
// project lands in My Canvases. The Canvas is made by the same code the file-drop uses (Service.pictureFrom).
//
// Only this computer's agents can call it: loopback only, no page from another site, and a token they read
// from ~/.penecho/draw.json, a file only this user can read.

const MAX_BODY = 64 * 1024 * 1024; // As the project upload route.
const KIND = /^(.+)\.(diagram\.json|explorer\.html|note\.json|slide-(\d{1,2})\.html)$/;
// A Widget already on the Canvas, named by its id (R9): `-F widget=widget-1`, or the file PenEcho wrote out for it, `<canvas>+widget-1.explorer.html`.
const WIDGET = /^widget-\d{1,15}$/, WIDGET_FILE = /(?:^|\+)(widget-\d{1,15})$/;
const TOKEN = /^[a-f0-9]{64}$/;
const LOOPBACK_NAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const pictureOf = source => source.replace(/\.penecho\.json$/, ".png");
const titleOf = value => String(value ?? "").replace(/[\x00-\x1f[\]]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
const nice = name => String(name).replace(/[-_]+/g, " ").replace(/^./, c => c.toUpperCase());
const bad = (code, message, status = 400) => failure(code, message, status);

function isLoopback(address) {
  const value = String(address || "").toLowerCase().split("%", 1)[0];
  const ip = value.startsWith("::ffff:") ? value.slice(7) : value;
  return ip === "::1" || ip === "127.0.0.1" || ip.startsWith("127.");
}
function hostOf(req) {
  const value = typeof req.headers.host === "string" ? req.headers.host.trim() : "";
  try { const url = new URL(`http://${value}`); return url.pathname === "/" && !url.username ? url : null; } catch { return null; }
}
function sameToken(given, token) {
  const a = Buffer.from(String(given || "")), b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function sendJson(res, status, value) {
  const data = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { "content-type":"application/json; charset=utf-8", "content-length":data.length, "cache-control":"no-store", "x-content-type-options":"nosniff" });
  res.end(data);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, done = false;
    req.on("data", chunk => { if (done) return; size += chunk.length; if (size > limit) { done = true; reject(bad("TOO_LARGE", "That file is too large.", 413)); req.resume(); return; } chunks.push(chunk); });
    req.on("end", () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    req.on("error", error => { if (!done) { done = true; reject(error); } });
  });
}
// What `curl -F` sends: text fields and one file.
function parseMultipart(body, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(String(contentType || ""));
  if (!/^multipart\/form-data/i.test(String(contentType || "")) || !m) throw bad("BAD_REQUEST", "Send the file as multipart/form-data, for example with curl -F file=@name.diagram.json.");
  const boundary = Buffer.from(`--${m[1] || m[2]}`), next = Buffer.concat([Buffer.from("\r\n"), boundary]), fields = {}, files = [];
  let at = body.indexOf(boundary);
  if (at < 0) throw bad("BAD_REQUEST", "The form could not be read.");
  for (let parts = 0; parts < 32; parts++) {
    at += boundary.length;
    if (body[at] === 45 && body[at + 1] === 45) return { fields, files };
    if (body[at] === 13 && body[at + 1] === 10) at += 2;
    const headEnd = body.indexOf("\r\n\r\n", at), end = headEnd < 0 ? -1 : body.indexOf(next, headEnd + 4);
    if (headEnd < 0 || end < 0) throw bad("BAD_REQUEST", "The form could not be read.");
    const head = body.subarray(at, headEnd).toString("utf8"), disposition = /content-disposition:\s*form-data\s*;([^\r\n]*)/i.exec(head)?.[1] || "";
    const name = /\bname="([^"]*)"/i.exec(disposition)?.[1], filename = /\bfilename="([^"]*)"/i.exec(disposition)?.[1], data = body.subarray(headEnd + 4, end);
    if (name !== undefined) { if (filename !== undefined) files.push({ field:name, filename, data }); else fields[name] = data.toString("utf8"); }
    at = end + 2;
  }
  throw bad("BAD_REQUEST", "The form has too many parts.");
}

// ---------- The drawing skill, once for every project on this computer ----------
const USER_SKILL_HOMES = [[".claude", "skills"], [".agents", "skills"]];
function userSkillPlaces(home) { return USER_SKILL_HOMES.map(parts => path.join(home, ...parts, F.LOCAL_SKILL_NAME, "SKILL.md")); }
function legacyUserSkillPlaces(home) { return USER_SKILL_HOMES.map(parts => path.join(home, ...parts, F.SKILL_NAME, "SKILL.md")); }
function userSkillOptOutFile(home) { return path.join(home, ".penecho", "drawing-skill-removed"); }
function userSkillSuppressed(home) { return Boolean(home) && fs.existsSync(userSkillOptOutFile(home)); }
function userSkillStatus(home) {
  if (!home) return { installed:false, places:[] };
  const text = F.drawingSkill({ user:true }), places = userSkillPlaces(home).map(file => {
    let now = null;
    try { now = fs.readFileSync(file, "utf8"); } catch { /* Not there. */ }
    return { path:file, state:now === null ? "missing" : !now.includes(F.SKILL_MARK) ? "yours" : now === text ? "installed" : "outdated" };
  });
  return { installed:places.some(p => p.state === "installed" || p.state === "outdated"), places };
}
// PenEcho Cloud and a person's own skills also use penecho-canvas. Only a copy carrying our marker is ours to retire.
function removeMarkedSkill(file) {
  let now = "";
  try { now = fs.readFileSync(file, "utf8"); } catch { return; }
  if (now.includes(F.SKILL_MARK)) fs.rmSync(path.dirname(file), { recursive:true, force:true });
}
function installUserSkill(home, { force = true } = {}) {
  if (!home) return { installed:false, places:[] };
  if (!force && userSkillSuppressed(home)) return userSkillStatus(home);
  if (force) { try { fs.rmSync(userSkillOptOutFile(home), { force:true }); } catch { /* Already cleared. */ } }
  const text = F.drawingSkill({ user:true });
  for (const file of userSkillPlaces(home)) {
    let now = null;
    try { now = fs.readFileSync(file, "utf8"); } catch { /* Not there yet. */ }
    // A skill of your own with this name is yours, and stays as it is.
    if (now !== null && !now.includes(F.SKILL_MARK)) continue;
    fs.mkdirSync(path.dirname(file), { recursive:true });
    if (now !== text) fs.writeFileSync(file, text);
    Slides.installSlideRules(path.dirname(file));
    require("./prototype-rules.js").installPrototypeRules(path.dirname(file));
  }
  const status = userSkillStatus(home);
  // The new local name is live before any legacy local copy is removed. An unmarked Cloud skill is never touched.
  if (status.installed) for (const file of legacyUserSkillPlaces(home)) removeMarkedSkill(file);
  return status;
}
function removeUserSkill(home) {
  if (!home) return { installed:false, places:[] };
  for (const file of [...userSkillPlaces(home), ...legacyUserSkillPlaces(home)]) removeMarkedSkill(file);
  try {
    const marker = userSkillOptOutFile(home);
    fs.mkdirSync(path.dirname(marker), { recursive:true });
    fs.writeFileSync(marker, "1\n");
  } catch { /* Best-effort opt-out marker. */ }
  return userSkillStatus(home);
}

// ---------- One call to draw, one call to look ----------
function createDraw({ service, stateDirectory, origin = () => "", drawFile = null, home = os.homedir(), pagePicture:customPagePicture = null }) {
  const { store } = service;
  const pagePicture = typeof customPagePicture === "function"
    ? customPagePicture
    : typeof service?.renderPage === "function"
      ? (html, size) => Promise.resolve(service.renderPage(html, size, { check:false })).then(r => Buffer.isBuffer(r) ? r : r?.png || null)
      : defaultPagePicture;
  const tokenFile = path.join(stateDirectory, "draw-token.json"), indexFile = path.join(stateDirectory, "draw-canvases.json");
  const homeFile = drawFile || path.join(home, ".penecho", "draw.json");
  // Made once and kept, so an agent that read it yesterday still has the right one.
  const token = (() => {
    try { const kept = JSON.parse(fs.readFileSync(tokenFile, "utf8")).token; if (TOKEN.test(kept)) return kept; } catch { /* Made below. */ }
    const made = crypto.randomBytes(32).toString("hex");
    fs.mkdirSync(stateDirectory, { recursive:true, mode:0o700 });
    fs.writeFileSync(tokenFile, JSON.stringify({ token:made }), { mode:0o600 });
    try { fs.chmodSync(tokenFile, 0o600); } catch { /* Windows keeps its own rights. */ }
    return made;
  })();
  // Where agents find this server: ~/.penecho/draw.json, readable only by this user.
  // Where agents find this server. Several PenEchos may run on one computer (an app and a checkout, say): the file is not taken from one
  // that is still answering, it is taken over once that one has gone (checked every minute), and it is removed on exit when it names
  // this one (review finding 8).
  const named = () => { try { return JSON.parse(fs.readFileSync(homeFile, "utf8")); } catch { return null; } };
  const answering = port => new Promise(resolve => {
    const socket = net.connect({ host:"127.0.0.1", port:Number(port) }), done = up => { socket.destroy(); resolve(up); };
    socket.setTimeout(800, () => done(false)); socket.once("connect", () => done(true)); socket.once("error", () => done(false));
  });
  let announcedPort = 0, retry = null;
  function writeHomeFile(port) {
    const temporary = `${homeFile}.${process.pid}.tmp`;
    fs.mkdirSync(path.dirname(homeFile), { recursive:true, mode:0o700 });
    fs.writeFileSync(temporary, `${JSON.stringify({ port, token, url:`http://127.0.0.1:${port}/api/draw`, pid:process.pid })}\n`, { mode:0o600 });
    try { fs.chmodSync(temporary, 0o600); } catch { /* Windows keeps its own rights. */ }
    fs.renameSync(temporary, homeFile);
  }
  async function announce(port) {
    announcedPort = port;
    const other = named();
    if (other && Number(other.port) !== Number(port) && other.token !== token && await answering(other.port)) {
      if (!retry) { retry = setInterval(() => { announce(announcedPort).catch(() => {}); }, 60_000); retry.unref?.(); }
      return { written:false, file:homeFile, port:Number(other.port) };
    }
    writeHomeFile(port);
    if (retry) { clearInterval(retry); retry = null; }
    return { written:true, file:homeFile, port };
  }
  // Gone: the file goes too, if it still says this server.
  function withdraw() {
    if (retry) { clearInterval(retry); retry = null; }
    const now = named();
    if (now && now.token === token && Number(now.port) === Number(announcedPort)) { try { fs.rmSync(homeFile, { force:true }); } catch { /* Next start writes it again. */ } }
  }
  process.once("exit", withdraw);

  // The name an agent gave a picture stays with the Canvas it made, so sending that name again updates it.
  function readIndex() { try { const kept = JSON.parse(fs.readFileSync(indexFile, "utf8")); return kept && typeof kept === "object" ? kept : {}; } catch { return {}; } }
  function remember(project, key, out) {
    const all = readIndex(), mine = all[project.id] && typeof all[project.id] === "object" ? all[project.id] : {};
    if (mine[key] === out) return;
    mine[key] = out; all[project.id] = mine;
    const temporary = `${indexFile}.${process.pid}.tmp`;
    fs.mkdirSync(stateDirectory, { recursive:true });
    fs.writeFileSync(temporary, JSON.stringify(all));
    fs.renameSync(temporary, indexFile);
  }
  const remembered = (project, key) => { const out = readIndex()[project.id]?.[key]; return typeof out === "string" && /^files\/.+\.penecho\.json$/.test(out) ? out : ""; };

  const real = folder => { try { return fs.realpathSync(folder); } catch { return ""; } };
  const inside = (child, parent) => {
    if (!child || !parent) return false;
    if (child === parent) return true;
    const prefix = parent.endsWith(path.sep) ? parent : parent + path.sep;
    return child.startsWith(prefix);
  };
  // The Lines project whose docs or code folders (or checkouts of its code) hold this folder, the closest one first.
  async function projectOfFolder(folder) {
    const where = real(folder);
    const scanRoots = pairs => {
      let best = null, depth = -1, ambiguous = false;
      for (const [project, root] of pairs) {
        const r = real(root);
        if (!inside(where, r)) continue;
        if (r.length > depth) { best = project; depth = r.length; ambiguous = false; }
        else if (r.length === depth && best && best.id !== project.id) ambiguous = true;
      }
      return { project:ambiguous ? null : best, ambiguous };
    };
    const projects = store.projects.filter(p => !p.archived);
    const directPairs = [];
    for (const project of projects) for (const root of [project.docsPath, ...project.codePaths]) directPairs.push([project, root]);
    const direct = scanRoots(directPairs);
    if (direct.ambiguous) return { project:null, ambiguous:true };
    if (direct.project) return { project:direct.project, ambiguous:false };
    const worktreePairs = [];
    for (const project of projects.filter(p => p.codePaths.length)) {
      for (const root of await service.conversations.rootsOf(project).catch(() => [])) worktreePairs.push([project, root]);
    }
    return scanRoots(worktreePairs);
  }
  // A folder PenEcho made for one line's run says which line, and otherwise one line at work there lately does.
  function lineOfFolder(project, folder) {
    const where = real(folder);
    let topics = [];
    try { topics = store.scan(project).topics; } catch { return ""; }
    const run = topics.find(t => inside(where, real(service.worktreeFor(project, t.slug))));
    if (run) return run.slug;
    const working = service.conversations.topicsWorkingIn?.(project, where) || [];
    return working.length === 1 && service.isLine(project, working[0]) ? working[0] : "";
  }
  function checkFolder(folder) {
    if (typeof folder !== "string" || !path.isAbsolute(folder)) throw bad("BAD_FOLDER", "Send folder: the absolute path of the folder you work in.");
    let stat;
    try { stat = fs.statSync(folder); } catch { throw bad("BAD_FOLDER", "That folder does not exist.", 404); }
    if (!stat.isDirectory()) throw bad("BAD_FOLDER", "That is not a folder.");
    return folder;
  }
  function myCanvases(create) {
    const had = store.myCanvases({ create:false });
    if (had || !create) return had;
    const made = store.myCanvases();
    store.syncGenerated(made, "Project");
    return made;
  }
  async function placeOf({ folder, project:id }, { create = true } = {}) {
    if (id) {
      if (id === MY_CANVASES_ID) { const project = myCanvases(create); if (!project) throw bad("NOT_FOUND", "There is no My Canvases yet.", 404); return { project, line:"" }; }
      const project = store.projects.find(p => p.id === id);
      if (!project) throw bad("NOT_FOUND", "There is no such project in PenEcho.", 404);
      return { project, line:"" };
    }
    checkFolder(folder);
    const found = await projectOfFolder(folder);
    if (found.ambiguous) throw bad("AMBIGUOUS_PROJECT", `More than one PenEcho project claims ${folder}. Pass project=<id> or separate the overlapping project folders in PenEcho.`, 409);
    if (found.project) return { project:found.project, line:lineOfFolder(found.project, folder), fromFolder:true };
    return { project:myCanvases(create), line:"" };
  }

  // A Canvas's short name: the folder of a Canvas of its own, or <line>/<picture> for one on a line.
  const nameOf = out => out.replace(/^files\//, "").replace(/\.penecho\.json$/, "").replace(/\/canvas$/, "");
  function cleanName(name) {
    const clean = String(name || "").replace(/^files\//, "").replace(/\.penecho\.json$/, "");
    if (!clean || clean.length > 300 || clean.split("/").some(part => !part || part === "." || part === ".." || part.startsWith(".")) || clean.startsWith("_incoming/")) throw bad("BAD_CANVAS", "That is not the name of a Canvas.");
    return clean;
  }
  function canvasSource(project, name) {
    const clean = cleanName(name);
    for (const out of [`files/${clean}/canvas.penecho.json`, `files/${clean}.penecho.json`]) {
      try { if (fs.statSync(store.resolve(project, out)).isFile()) return out; } catch { /* The other spelling. */ }
    }
    throw bad("NOT_FOUND", `There is no Canvas "${clean}" in ${project.name}. Leave out canvas to make a new one.`, 404);
  }
  const lineOf = (project, out) => { const slug = (/^files\/([^/]+)\//.exec(out) || [])[1] || ""; return slug && service.isLine(project, slug) ? slug : ""; };
  function answer(project, out) {
    const meta = service.metaOf(project, out), line = lineOf(project, out), picture = pictureOf(out), name = nameOf(out);
    const title = titleOf(meta.name) || nice(name.split("/").pop());
    let png = "", updatedAt = 0;
    try { png = store.resolve(project, picture); fs.statSync(png); } catch { png = ""; }
    try { updatedAt = Math.round(fs.statSync(store.resolve(project, out)).mtimeMs); } catch { /* Gone since. */ }
    const q = new URLSearchParams({ linesProject:project.id, linesCanvas:out, ...(line ? { linesDoc:L.linePath(line) } : {}), linesTitle:title });
    return { project:project.id, projectName:project.name, canvas:name, line, title, path:out, url:`${origin()}/?${q}`, png, updatedAt };
  }

  // The file as the agent sent it, checked before anything is written, with the small guesses the file-drop also forgives.
  function checked(name, text) {
    const m = KIND.exec(String(name || ""));
    if (!m || /[\\/]/.test(name) || name.startsWith(".")) throw bad("BAD_FILE", "The file must be named name.diagram.json, name.explorer.html, name.note.json or name.slide-01.html.");
    if (typeof text !== "string" || text.includes("\0")) throw bad("BAD_FILE", "The file is not text.");
    try { checkPicture(name, text); }
    catch (error) {
      const relaxed = name.endsWith(".diagram.json") ? relaxPicture(text) : null;
      try { if (!relaxed) throw error; checkPicture(name, relaxed); text = relaxed; }
      catch (still) { throw bad("BAD_PICTURE", still.message); }
    }
    const kind = m[3] ? `slide-${String(Number(m[3])).padStart(2, "0")}.html` : m[2];
    return { stem:m[1], kind, text };
  }

  function widgetOn(bundle, id) {
    const asset = bundle?.assets.find(a => a.kind === "widget" && a.metadata?.widgetId === id);
    return asset ? JSON.parse(Buffer.from(asset.dataBase64, "base64").toString("utf8")) : null;
  }
  function readPlot(raw) {
    let plot;
    try { plot = JSON.parse(raw); } catch { throw bad("BAD_PLOT", "plot must contain a JSON object."); }
    const keys = ["artifactId", "expression", "title", "width", "height", "color", "xMin", "xMax", "yMin", "yMax"];
    if (!plot || typeof plot !== "object" || Array.isArray(plot) || Object.keys(plot).some(k => !keys.includes(k))) throw bad("BAD_PLOT", "Unknown plot options.");
    if (typeof plot.artifactId !== "string" || !/^[a-z0-9][a-z0-9-]{0,59}$/.test(plot.artifactId) || WIDGET.test(plot.artifactId)) throw bad("BAD_PLOT", "Give the plot a stable artifactId of up to 60 lowercase letters, digits and hyphens (not a widget ID).");
    return plot;
  }
  function makePlot(plot, adjacent) {
    const inherited = plotRange(adjacent?.html);
    // Specifying an x range requests a fresh scale unless the caller also gives y limits.
    const defaults = {};
    if (inherited.xMin !== undefined && plot.xMin === undefined && plot.xMax === undefined) {
      Object.assign(defaults, { xMin:inherited.xMin, xMax:inherited.xMax });
      if (plot.yMin === undefined && plot.yMax === undefined && Math.max(Math.abs(inherited.yMin), Math.abs(inherited.yMax)) <= 1e6 && inherited.yMax - inherited.yMin >= 1e-6) {
        Object.assign(defaults, { yMin:inherited.yMin, yMax:inherited.yMax });
      }
    }
    try {
      const args = validateToolArguments("penecho_plot", { title:`y = ${String(plot.expression || "").replace(/^y\s*=\s*/i, "")}`, ...defaults, ...plot, sessionId:"lines", requestId:"draw" });
      return plotPage(args, { trigScale:true });
    } catch (error) { throw bad("BAD_PLOT", error.message); }
  }
  // Keep a rendered receipt apart from the Canvas overview, which the page may overwrite.
  // File names include the content so two simultaneous callers can inspect their own revision.
  let sweepPreviewsAt = 0;
  async function widgetPreview(widget, drawn) {
    const dir = path.join(stateDirectory, "draw-previews");
    const renderedHtml = inCanvas(widget.html);
    const key = crypto.createHash("sha256").update(JSON.stringify([widget.contentW, widget.contentH, renderedHtml])).digest("hex");
    const png = path.join(dir, key + ".png");
    try {
      fs.mkdirSync(dir, { recursive:true });
      if (Date.now() >= sweepPreviewsAt) {
        sweepPreviewsAt = Date.now() + 3600000;
        for (const name of fs.readdirSync(dir)) {
          if (/^[a-f0-9]{64}\.png$/.test(name) && Date.now() - fs.statSync(path.join(dir, name)).mtimeMs > 86400000) fs.rmSync(path.join(dir, name), { force:true });
        }
      }
      if (!fs.existsSync(png)) {
        let bytes = drawn?.rendered ? drawn.png : null;
        // An identical upload can skip makePicture; capture the saved widget if its receipt has expired.
        if (!drawn || !drawn.png) bytes = await pagePicture(renderedHtml, { width:widget.contentW, height:widget.contentH });
        if (bytes) fs.writeFileSync(png, bytes);
      }
      if (fs.existsSync(png)) return { kind:"widget", ready:true, png };
    } catch { /* A preview failure does not undo a saved drawing. */ }
    return { kind:"widget", ready:false, png:"" };
  }
  async function draw({ folder, project:id, name, text, title = "", canvas = "", line = "", fresh = false, widget = "", x, y, w, plot, beside = "" }) {
    if (plot && (!id || (!canvas && !(fresh && line)))) throw bad("BAD_CANVAS", "A plot needs its exact project and canvas, or line and new=1.");
    if (beside && (!plot || !WIDGET.test(beside) || fresh)) throw bad("BAD_PLACE", "Use beside with a plot and a widget ID on the target Canvas.");
    const file = plot ? { stem:plot.artifactId, kind:"explorer.html", text:"" } : checked(name, text), wanted = titleOf(title);
    // Where a new picture goes, in Canvas units, such as on what the person drew (GET ?canvas= gives `ink`, the box around it). Left out: beside what is there.
    const num = v => (v === undefined || v === null || String(v).trim() === "" ? null : Number(v));
    const spot = [num(x), num(y)].every(Number.isFinite) ? { x:Math.round(num(x)), y:Math.round(num(y)), w:Number.isFinite(num(w)) ? Math.round(num(w)) : 0 } : null;
    if (spot && (spot.x < 0 || spot.y < 0 || spot.x > 20000 || spot.y > 20000 || spot.w < 0 || spot.w > 20000 || (spot.w && spot.w < 120))) throw bad("BAD_PLACE", "x and y must be within the Canvas (0 to 20000), and w at least 120.");
    const own = String(widget || "").trim() || (WIDGET_FILE.exec(file.stem)?.[1] || "");
    if (own && (!WIDGET.test(own) || !/^(explorer\.html|diagram\.json)$/.test(file.kind))) throw bad("BAD_WIDGET", "widget takes the id of a Widget on the Canvas, such as widget-1, with a .explorer.html or .diagram.json file.");
    if (own && fresh) throw bad("BAD_WIDGET", "A Widget is changed on the Canvas it is on: leave out new=1.");
    const place = await placeOf({ folder, project:id });
    const { project } = place;
    // PenEcho-launched Works name their project explicitly. A standalone agent is bound by this project's switch.
    if (!id && place.fromFolder && project.canvasSkill === false) throw bad("SKILL_DISABLED", `The drawing skill is off for ${project.name}. Turn it on in PenEcho's Project settings, or draw in another enabled project.`, 403);
    if (line && !service.isLine(project, String(line))) throw bad("NOT_FOUND", `There is no line "${line}" in ${project.name}.`, 404);
    let out = "";
    // `fresh` (new=1): the person asked for a new Canvas, so it does not go on the Canvas the line's Ask came from. It is still on the line.
    const onLine = canvas ? "" : line || place.line, lineCanvas = onLine && !fresh ? service.lineCanvas(project, onLine) : "";
    // A name is remembered for the line it was drawn for (or for none), so one line's drawing never replaces another's (review finding 5).
    const key = `${onLine}\u0000${file.kind.startsWith("slide-") ? "slides" : "picture"}:${file.stem}`;
    if (canvas) out = canvasSource(project, canvas);
    // The line's Ask came from an open Canvas: that is where the person is looking.
    else if (lineCanvas) out = lineCanvas;
    else if (own) throw bad("BAD_WIDGET", "Say which Canvas the Widget is on, with canvas=<name>.");
    else {
      const known = remembered(project, key);
      if (known && store.exists(project, known)) out = known;
      else if (onLine) {
        out = `files/${onLine}/${F.slugify(file.stem, "picture")}.penecho.json`;
        // A new Canvas never lands on one the line already has, such as the Canvas its Ask came from.
        for (let n = 2; fresh && store.exists(project, out); n++) out = `files/${onLine}/${F.slugify(file.stem, "picture")}-${n}.penecho.json`;
      }
      else out = `files/${service.freeSlug(project, F.slugify(file.stem, "canvas"))}/canvas.penecho.json`;
    }
    // A file of the Canvas's own name is its picture; any other name is one more picture on it (`<canvas>+<name>.<kind>`), and that name again updates it.
    const base = out.replace(/\.penecho\.json$/, ""), stem = plot ? file.stem : F.slugify(file.stem, "picture"), plus = (Boolean(canvas) || Boolean(lineCanvas)) && nameOf(out).split("/").pop() !== stem;
    let from = plus ? `${base}+${stem}` : base;
    if (own) {
      const bundle = service.readBundle(project, out);
      if (!bundle?.assets.some(a => a?.kind === "widget" && a.metadata?.widgetId === own)) throw bad("NOT_FOUND", `There is no Widget ${own} on that Canvas. GET /api/draw?canvas=<name> lists them.`, 404);
      // It is written to the file the Widget already has, whatever name it was sent under: the Canvas's page stays its page.
      from = service.ownBase(project, `${base}+${own}.${file.kind}`);
      const slide = service.slideFile(project, out, own), kind = slide && KIND.exec(path.basename(slide));
      if (kind) { checked(path.basename(slide), file.text); from = slide.slice(0, -kind[2].length - 1); file.kind = kind[2]; }
    }
    // Slides sent to a Canvas that already holds one deck are that deck's next version, whatever the agent called the file this time:
    // slide 3 takes the place of slide 3. Under a new name they were added beside the old ones, so the Canvas showed the new slides
    // further down and Download PPT still began with the old ones.
    if (file.kind.startsWith("slide-") && store.exists(project, out)) {
      const folder = path.dirname(store.resolve(project, out)), own = path.basename(base), decks = new Set();
      let names = [];
      try { names = fs.readdirSync(folder); } catch { /* No folder yet: nothing is there. */ }
      for (const entry of names) { const m = /^(.+)\.slide-\d{1,2}\.html$/.exec(entry); if (m && (m[1] === own || m[1].startsWith(`${own}+`))) decks.add(m[1]); }
      if (decks.size === 1 && !decks.has(path.basename(from))) from = `${path.dirname(base)}/${[...decks][0]}`.replace(/^\.\//, "");
    }
    const source = `${from}.${file.kind}`, had = store.exists(project, out);
    // A diagram and a page drawn under one name are one Widget, so the newer one takes the older one's place.
    const other = file.kind === "diagram.json" ? `${from}.explorer.html` : file.kind === "explorer.html" ? `${from}.diagram.json` : "";
    const placed = sourceWidgetId(source);
    let receipt;
    await service.withCanvas(project, out, async () => {
      const before = service.readBundle(project, out), adjacent = beside && widgetOn(before, beside);
      if (beside && (!adjacent || beside === placed)) throw bad("BAD_PLACE", "beside must name another widget on this Canvas.");
      if (plot) file.text = makePlot(plot, adjacent);
      const open = service.openCanvas(project, out), savedView = before?.manifest?.view?.region;
      const view = open?.box || (savedView && [savedView.x,savedView.y,savedView.w,savedView.h].every(Number.isFinite) && savedView.w > 0 && savedView.h > 0 ? savedView : null);
      const placement = { spot, view, beside:adjacent };
      fs.mkdirSync(path.dirname(store.resolve(project, source, { forWrite:true })), { recursive:true });
      let now = null, otherBytes = null;
      try { now = fs.readFileSync(store.resolve(project, source), "utf8"); } catch { /* New. */ }
      if (other) { try { otherBytes = fs.readFileSync(store.resolve(project, other)); } catch { /* None. */ } }
      // A new call is a new try: what failed before is not answered again from memory (review finding 9).
      service.pictureProblems.delete(`${project.id}:${source}`);
      if (now !== file.text) store.writeBytes(project, source, Buffer.from(file.text));
      if (otherBytes) fs.rmSync(store.resolve(project, other), { force:true });
      let drawn;
      try {
        const problems = [];
        drawn = await service.pictureFrom(project, source, problems, { now:true, placement });
        if (problems.length) throw bad("BAD_PICTURE", problems[0].error);
        if (!store.exists(project, out)) throw bad("NOT_MADE", "PenEcho could not make that Canvas.", 500);
      } catch (error) {
        // A draw that fails leaves the folder as it found it.
        service.pictureProblems.delete(`${project.id}:${source}`);
        if (now === null) fs.rmSync(store.resolve(project, source), { force:true }); else if (now !== file.text) store.writeBytes(project, source, Buffer.from(now));
        if (otherBytes) store.writeBytes(project, other, otherBytes);
        throw error;
      }
      const actual = widgetOn(drawn?.bundle || service.readBundle(project, out), placed);
      if (actual) {
        const preview = await widgetPreview(actual, drawn);
        const { x, y, w, h } = actual, live = service.openCanvas(project, out), box = live?.box || null;
        const visible = box ? x < box.x + box.w && x + w > box.x && y < box.y + box.h && y + h > box.y : null;
        const fullyVisible = box ? x >= box.x && y >= box.y && x + w <= box.x + box.w && y + h <= box.y + box.h : null;
        receipt = { widgetId:placed, bounds:{ x, y, w, h }, view:live ? "live" : "saved", viewport:box, visible, fullyVisible, preview };
        // A design prototype's layout defects, measured while it was drawn, so the agent can fix them now.
        if (drawn?.checks?.length) receipt.layoutChecks = drawn.checks;
      }
    });
    if (wanted && !had) await service.renameCanvas(project, { path:out, title:wanted });
    if (!canvas && !lineCanvas) remember(project, key, out);
    service.sync(project);
    const made = answer(project, out);
    // One more picture on a Canvas: its own picture is what the agent drew; the Canvas's picture shows it once its page saves again.
    if (from !== base) { const pic = `${from}.png`; made.canvasPng = made.png; try { made.png = store.resolve(project, pic); fs.statSync(made.png); } catch { made.png = made.canvasPng; } }
    return { ...made, ...receipt };
  }

  async function look({ folder, project:id, canvas = "" }) {
    const { project } = await placeOf({ folder, project:id }, { create:false });
    if (canvas) {
      cleanName(canvas);
      if (!project) throw bad("NOT_FOUND", "There is no Canvas by that name.", 404);
      const source = canvasSource(project, canvas), { png, updatedAt, url, canvas:name, title, line, path:out } = answer(project, source);
      // Each Widget with the file that changes it in place; one drawn on the Canvas itself is written out first.
      const widgets = await service.withCanvas(project, source, async () => service.widgetSources(project, source)).catch(() => []);
      const ink = await inkBox(service.readBundle(project, source)).catch(() => null);
      return { png, updatedAt, url, name, title, line, path:out, project:project.id, widgets, ink };
    }
    if (!project) return { project:"", canvases:[] };
    const canvases = store.walk(project)
      .filter(f => /^files\/.+\.penecho\.json$/.test(f.path) && !f.path.startsWith("files/_incoming/"))
      .sort((a, b) => b.mtime - a.mtime)
      .map(f => { const { png, updatedAt, url, canvas:name, title, line, path:out } = answer(project, f.path); return { name, title, png, updatedAt, url, line, path:out }; });
    return { project:project.id, projectName:project.name, canvases };
  }

  // What the person sees on a Canvas open in PenEcho now, as a PNG with Canvas coordinates on a grid: that Canvas, else the one
  // of this project, else whichever is open in front. The open page makes the picture, so no browser is needed (PE-539).
  async function see({ folder, project:id, canvas = "" }) {
    if (!canvas && !folder && !id) return service.canvasView(null, "");
    const { project } = await placeOf({ folder, project:id }, { create:false });
    if (!project) return { png:"", why:"No PenEcho page has a Canvas of this project open in front right now." };
    return service.canvasView(project, canvas ? canvasSource(project, canvas) : "");
  }

  // Only this computer's own agents: loopback, a loopback name, no page of another site, and the token.
  function refused(req) {
    if (!isLoopback(req.socket?.remoteAddress)) return { status:403, code:"LOCAL_ONLY", error:"Drawing is only for agents on the computer running PenEcho." };
    const host = hostOf(req);
    if (!host || !LOOPBACK_NAMES.has(host.hostname.toLowerCase())) return { status:403, code:"LOCAL_ONLY", error:"Use http://127.0.0.1 to reach PenEcho." };
    const from = req.headers.origin, site = String(req.headers["sec-fetch-site"] || "").toLowerCase();
    if (from !== undefined) {
      let same = false;
      try { const o = new URL(String(from)); same = o.host === host.host && LOOPBACK_NAMES.has(o.hostname.toLowerCase()); } catch { /* Not an origin at all. */ }
      if (!same) return { status:403, code:"CROSS_SITE", error:"A page of another site cannot draw here." };
    }
    if (site === "cross-site" || site === "same-site") return { status:403, code:"CROSS_SITE", error:"A page of another site cannot draw here." };
    if (!sameToken(req.headers["x-penecho-token"], token)) return { status:401, code:"BAD_TOKEN", error:"Send the token from ~/.penecho/draw.json as the x-penecho-token header." };
    return null;
  }
  async function handle(req, res, url) {
    if (url.pathname !== "/api/draw") return false;
    const no = refused(req);
    if (no) { req.resume(); sendJson(res, no.status, { error:no.error, code:no.code }); return true; }
    try {
      if (req.method === "GET") {
        const q = url.searchParams;
        if (/^(1|true|yes)$/i.test(q.get("view") || "")) { sendJson(res, 200, await see({ folder:q.get("folder") || "", project:q.get("project") || "", canvas:q.get("canvas") || "" })); return true; }
        sendJson(res, 200, await look({ folder:q.get("folder") || "", project:q.get("project") || "", canvas:q.get("canvas") || "" }));
      } else if (req.method === "POST") {
        const form = parseMultipart(await readBody(req, MAX_BODY), req.headers["content-type"]);
        const f = form.fields, plotting = Object.hasOwn(f, "plot");
        if (form.files.length !== (plotting ? 0 : 1)) throw bad("BAD_FILE", "Send exactly one file or a plot JSON field.");
        const upload = form.files[0];
        sendJson(res, 200, await draw({ folder:f.folder, project:f.project, ...(plotting ? { plot:readPlot(f.plot), beside:f.beside } : { name:path.basename(upload.filename.replace(/\\/g, "/")), text:upload.data.toString("utf8") }), title:f.title, canvas:f.canvas, line:f.line, widget:f.widget, x:f.x, y:f.y, w:f.w, fresh:/^(1|true|yes)$/i.test(String(f.new || "")) }));
      } else { req.resume(); sendJson(res, 405, { error:"Use GET or POST.", code:"METHOD" }); }
    } catch (error) {
      if (!res.headersSent) sendJson(res, error.status || 500, { error:error.status ? error.message : "Something went wrong drawing this.", code:error.code || "FAILED" });
      else res.destroy();
    }
    return true;
  }
  return { handle, draw, look, see, announce, withdraw, token, homeFile, refused };
}

module.exports = { createDraw, parseMultipart, userSkillStatus, installUserSkill, removeUserSkill, userSkillPlaces, userSkillSuppressed };
