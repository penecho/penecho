#!/usr/bin/env node
"use strict";
// Makes the pictures and Canvases of the three example projects in src/server/project-lines/examples (examples.js):
//   Timeline app: the screenshot you marked up for the bug, the app on each branch, the hand-drawn homepage, Claude's prototype on a Canvas;
//   Calculus class notes: two pages of handwritten notes with Canvas AI's answers beside them, and the practice exam on a Canvas;
//   Sales review deck: the spreadsheet, the six slides on one Canvas, and pictures of the deck before and after the change.
// The results are checked in, so a new user's examples need no browser. Run it again after changing an example's pages or drawings.
// It needs Playwright with Chrome, sharp, and Python with openpyxl for the spreadsheet:
//   PLAYWRIGHT_PATH=/path/to/node_modules/playwright node scripts/build-project-line-examples.cjs
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { inCanvas, makePicture, newBundle, widgetId } = require("../src/server/project-lines/canvas-file.js");
const { expandSlide } = require("../src/server/slides.js");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const EXAMPLES = path.join(__dirname, "../src/server/project-lines/examples");
const TILE = 512, ORIGIN = 18 * TILE;
const INK = "#1e2b4a", BLUE = "#2457c5", RED = "#d6312b", GREEN = "#1f7a4c", GREY = "#6b7482", PENCIL = "#2a2f38";
const HAND = "'Bradley Hand', 'Noteworthy', 'Chalkboard SE', 'Segoe Print', 'Comic Sans MS', cursive";
const out = (...parts) => path.join(EXAMPLES, ...parts);
const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive:true }); fs.writeFileSync(file, data); console.log(`${path.relative(EXAMPLES, file)}  ${fs.statSync(file).size} bytes`); };
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------- A steady hand that is not a ruler ----------
let seed = 11;
const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const wob = (n = 3) => (rand() - .5) * 2 * n;
function stroke(points, { color = INK, width = 5, close = false } = {}) {
  const pts = points.map(([x, y]) => [x + wob(2), y + wob(2)]);
  if (close) pts.push(pts[0]);
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], mx = (x0 + x1) / 2 + wob(2.5), my = (y0 + y1) / 2 + wob(2.5);
    d += ` Q${mx.toFixed(1)} ${my.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
}
const line = (x0, y0, x1, y1, o) => stroke([[x0, y0], [(x0 * 2 + x1) / 3, (y0 * 2 + y1) / 3], [(x0 + x1 * 2) / 3, (y0 + y1 * 2) / 3], [x1, y1]], o);
const box = (x, y, w, h, o) => stroke([[x, y], [x + w / 2, y], [x + w, y], [x + w, y + h / 2], [x + w, y + h], [x + w / 2, y + h], [x, y + h], [x, y + h / 2]], { ...o, close:true });
function arrow(x0, y0, x1, y1, o = {}) {
  const a = Math.atan2(y1 - y0, x1 - x0), s = 26;
  return line(x0, y0, x1, y1, o) + stroke([[x1 - s * Math.cos(a - .45), y1 - s * Math.sin(a - .45)], [x1, y1], [x1 - s * Math.cos(a + .45), y1 - s * Math.sin(a + .45)]], o);
}
function curve(x0, y0, cx, cy, x1, y1, o = {}) {
  const pts = []; for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push([(1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t * t * x1, (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t * t * y1]); }
  const a = Math.atan2(y1 - pts[9][1], x1 - pts[9][0]), s = 24;
  return stroke(pts, o) + (o.head === false ? "" : stroke([[x1 - s * Math.cos(a - .45), y1 - s * Math.sin(a - .45)], [x1, y1], [x1 - s * Math.cos(a + .45), y1 - s * Math.sin(a + .45)]], o));
}
function ellipse(cx, cy, rx, ry, o) { const pts = []; for (let i = 0; i < 20; i++) { const t = i / 20 * Math.PI * 2 + .3; pts.push([cx + rx * Math.cos(t) * (1 + wob(.03)), cy + ry * Math.sin(t) * (1 + wob(.04))]); } pts.push([cx + rx * Math.cos(.3) + 14, cy + ry * Math.sin(.3) - 10]); return stroke(pts, o); }
const circle = (cx, cy, r, o) => ellipse(cx, cy, r, r, o);
// Handwritten words: ^x or ^{..} raise, _x or _{..} lower; each line leans a little.
function T(x, y, words, { size = 46, color = INK, anchor = "start", weight = 400 } = {}) {
  const body = esc(words).replace(/\^\{([^}]*)\}|\^(\S)/g, (_, a, b) => `<tspan baseline-shift="42%" font-size="66%">${a ?? b}</tspan>`).replace(/_\{([^}]*)\}|_(\S)/g, (_, a, b) => `<tspan baseline-shift="-24%" font-size="64%">${a ?? b}</tspan>`);
  return `<text x="${x}" y="${y}" transform="rotate(${wob(.7).toFixed(2)} ${x} ${y})" font-family="${HAND}" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}">${body}</text>`;
}
const lim = (x, y, sub, size = 56, color = INK) => T(x, y, "lim", { size, color }) + T(x + size * .78, y + size * .62, sub, { size:size * .52, color, anchor:"middle" });
function frac(cx, y, top, bottom, { size = 52, color = INK, width } = {}) {
  const w = width || Math.max(top.replace(/[\^_{}]/g, "").length, bottom.replace(/[\^_{}]/g, "").length) * size * .46 + 20;
  return T(cx, y - size * .42, top, { size, color, anchor:"middle" }) + line(cx - w / 2, y - size * .24, cx + w / 2, y - size * .2, { color, width:4 }) + T(cx, y + size * .62, bottom, { size, color, anchor:"middle" });
}
const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

// ---------- Pictures, drawn by Chrome ----------
let browser;
async function shot(html, { width, height, scale = 1, transparent = false, init = null }) {
  const context = await browser.newContext({ viewport:{ width, height }, deviceScaleFactor:scale });
  const page = await context.newPage();
  if (init) await page.addInitScript(init);
  if (/^file:/.test(html)) await page.goto(html); else await page.setContent(html, { waitUntil:"load" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  const png = await page.screenshot({ omitBackground:transparent, clip:{ x:0, y:0, width, height } });
  await context.close();
  return png;
}
const inkPng = (w, h, body) => shot(`<!doctype html><html><body style="margin:0;background:transparent">${svg(w, h, body)}</body></html>`, { width:w, height:h, transparent:true });

// ---------- A Canvas: the drawing as tiles, Widgets beside it, and a picture of the whole ----------
async function inkCanvas({ id, name, ink, w, h }) {
  const bundle = newBundle({ id, name });
  for (let ty = 0; ty < h / TILE; ty++) for (let tx = 0; tx < w / TILE; tx++) {
    const tile = await sharp(ink).extract({ left:tx * TILE, top:ty * TILE, width:TILE, height:TILE }).png({ compressionLevel:9 }).toBuffer();
    if ((await sharp(tile).stats()).channels[3].max === 0) continue;
    bundle.assets.push({ kind:"tile", contentType:"image/png", metadata:{ tileKey:`${ORIGIN / TILE + tx},${ORIGIN / TILE + ty}` }, dataBase64:tile.toString("base64") });
  }
  return bundle;
}
// A Widget as the Canvas keeps one: the page drawn at contentW x contentH, shown w wide at x, y (Canvas units, from the drawing's corner).
function addWidget(bundle, { key, title, html, x, y, w, contentW, contentH }) {
  const id = widgetId(key), h = Math.round(w * contentH / contentW);
  const widget = { id, widgetType:"html_widget", pluginId:"general", x:ORIGIN + x, y:ORIGIN + y, w, h, contentW, contentH, title, refreshSeconds:0, html };
  bundle.assets.push({ kind:"widget", contentType:"application/json", metadata:{ widgetId:id, pluginId:"general" }, dataBase64:Buffer.from(JSON.stringify(widget)).toString("base64") });
  return { ...widget, x, y };
}
// What the Canvas shows: paper, the ink, and each Widget in its frame.
async function canvasPicture({ ink, w, h, widgets = [], width = 2000 }) {
  const right = Math.max(w, ...widgets.map(g => g.x + g.w)) + 60, bottom = Math.max(h, ...widgets.map(g => g.y + g.h)) + 60;
  const layers = [{ input:ink, left:0, top:0 }];
  for (const g of widgets) {
    const page = await shot(inCanvas(g.html), { width:g.contentW, height:g.contentH, scale:g.w / g.contentW });
    const frame = await sharp({ create:{ width:g.w + 4, height:g.h + 4, channels:4, background:"#d5dae2" } }).png().toBuffer();
    layers.push({ input:frame, left:g.x - 2, top:g.y - 2 }, { input:page, left:g.x, top:g.y });
  }
  const full = await sharp({ create:{ width:right, height:bottom, channels:4, background:"#ffffff" } }).composite(layers).png().toBuffer();
  return sharp(full).resize({ width:Math.min(width, right) }).flatten({ background:"#ffffff" }).png({ compressionLevel:9 }).toBuffer();
}
async function finish(bundle, picture, region) {
  const small = await sharp(picture).resize(640, 426, { fit:"contain", background:"#ffffff" }).png().toBuffer();
  bundle.assets = [...bundle.assets.filter(a => a.kind !== "preview"), { kind:"preview", contentType:"image/png", metadata:{ width:640, height:426 }, dataBase64:small.toString("base64") }];
  bundle.manifest.view = { region:{ x:ORIGIN + region.x - 80, y:ORIGIN + region.y - 80, w:region.w + 160, h:region.h + 160 }, navigationLocked:false };
  return JSON.stringify(bundle);
}

// ---------- Timeline app: the code on each branch, and its pictures ----------
const CODE = out("app/code");
function branchFolder(names) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-example-app-"));
  for (const name of names) for (const file of fs.readdirSync(path.join(CODE, name))) {
    if (file === "_removed.txt") { for (const gone of fs.readFileSync(path.join(CODE, name, file), "utf8").split("\n").filter(Boolean)) fs.rmSync(path.join(dir, gone.trim()), { force:true }); continue; }
    fs.copyFileSync(path.join(CODE, name, file), path.join(dir, file));
  }
  return dir;
}
async function appPictures() {
  const docs = (...p) => out("app/docs/files", ...p);
  // The bug as you saw it, circled in red on the screenshot.
  const main = branchFolder(["main"]);
  const context = await browser.newContext({ viewport:{ width:960, height:440 }, deviceScaleFactor:2 });
  const page = await context.newPage();
  await page.goto(`file://${main}/index.html`);
  const spot = await page.evaluate(() => {
    const row = [...document.querySelectorAll(".line")].find(r => r.textContent.includes("Order form"));
    const boxes = [...row.querySelectorAll(".time")].slice(0, 4).map(t => t.getBoundingClientRect());
    return { x:Math.min(...boxes.map(b => b.left)), y:Math.min(...boxes.map(b => b.top)), r:Math.max(...boxes.map(b => b.right)), b:Math.max(...boxes.map(b => b.bottom)) };
  });
  const before = await page.screenshot();
  await context.close();
  const cx = (spot.x + spot.r) / 2, cy = (spot.y + spot.b) / 2;
  const marks = ellipse(cx * 2, cy * 2, (spot.r - spot.x) + 40, (spot.b - spot.y) + 26, { color:RED, width:6 }) + curve(cx * 2 + 330, cy * 2 - 150, cx * 2 + 200, cy * 2 - 140, cx * 2 + (spot.r - spot.x) + 30, cy * 2 - 30, { color:RED, width:6 }) + T(cx * 2 + 345, cy * 2 - 150, "can't read these!", { size:52, color:RED, weight:700 });
  const ink = await inkPng(1920, 880, marks);
  write(docs("time-labels-overlap/time-labels.png"), await sharp(before).composite([{ input:ink }]).png({ compressionLevel:9 }).toBuffer());

  // The homepage as you drew it: four areas, the trunk with its lines, and three notes to yourself.
  seed = 23;
  const W = 2048, H = 1024;
  let s = box(40, 40, 1460, 880, { color:PENCIL }) + line(40, 100, 1500, 100, { color:PENCIL, width:4 });
  for (const x of [72, 100, 128]) s += circle(x, 70, 8, { color:PENCIL, width:3 });
  s += line(300, 100, 300, 920, { color:PENCIL, width:4 }) + line(1180, 100, 1180, 920, { color:PENCIL, width:4 });
  s += T(70, 160, "Projects", { size:40, color:PENCIL });
  ["Bakery", "Recipes", "Shop"].forEach((name, i) => { s += box(75, 196 + i * 62, 22, 22, { color:PENCIL, width:3 }) + T(112, 217 + i * 62, name, { size:34, color:PENCIL }); });
  s += box(62, 184, 222, 48, { color:BLUE, width:3 });
  s += T(330, 160, "this week", { size:36, color:PENCIL });
  "MTWTF".split("").forEach((d, i) => { const x = 330 + i * 166; s += box(x, 180, 152, 84, { color:PENCIL, width:3.5 }) + T(x + 16, 222, d, { size:34, color:PENCIL }) + line(x + 128, 258, x + 128, 258 - [30, 54, 22, 40, 36][i], { color:BLUE, width:12 }); });
  s += line(345, 300, 345, 900, { color:PENCIL, width:9 });
  const rows = [[350, "Fri"], [430], [540, "Thu"], [620], [730, "Wed"], [810]];
  rows.forEach(([y, day], i) => {
    if (day) { s += T(375, y - 22, day, { size:26, color:GREY }); return; }
    s += stroke([[345, y - 28], [352, y - 4], [372, y]], { color:PENCIL, width:3.5 }) + stroke([[385, y], [430, y - 8], [470, y + 6], [515, y - 6], [560, y + 2]], { color:PENCIL, width:4 });
    const x0 = 600 + (i % 3) * 30, x1 = 1110 - (i % 2) * 60;
    s += line(x0, y, x1, y, { color:PENCIL, width:3.5 }) + circle(x0, y, 10, { color:BLUE, width:4 }) + box(x0 + 90, y - 10, 20, 20, { color:"#e9551f", width:6 }) + circle(x0 + 220, y, 15, { color:PENCIL, width:4 }) + T(x0 + 220, y + 9, "AI", { size:20, anchor:"middle", color:PENCIL }) + circle(x0 + 340, y, 10, { color:BLUE, width:4 });
    if (i % 2) s += circle(x1, y, 14, { color:GREEN, width:4 }) + stroke([[x1 - 7, y], [x1 - 2, y + 6], [x1 + 8, y - 7]], { color:GREEN, width:4 });
  });
  s += T(1205, 160, "latest files", { size:34, color:PENCIL });
  for (let i = 0; i < 4; i++) { const y = 190 + i * 110; s += box(1205, y, 92, 72, { color:PENCIL, width:3 }) + stroke([[1215, y + 60], [1240, y + 30], [1262, y + 52], [1278, y + 38], [1290, y + 60]], { color:PENCIL, width:3 }) + stroke([[1315, y + 26], [1360, y + 20], [1410, y + 28], [1450, y + 22]], { color:PENCIL, width:3 }) + stroke([[1315, y + 52], [1350, y + 48], [1390, y + 54]], { color:GREY, width:3 }); }
  s += T(1560, 210, "click a day =", { size:38, color:BLUE }) + T(1560, 255, "only its lines", { size:38, color:BLUE }) + curve(1550, 230, 1300, 120, 1160, 210, { color:BLUE, width:4 });
  s += T(1560, 470, "one line =", { size:38, color:BLUE }) + T(1560, 515, "one thing", { size:38, color:BLUE }) + curve(1550, 490, 1300, 480, 1125, 435, { color:BLUE, width:4 });
  s += T(1560, 760, "the trunk =", { size:38, color:BLUE }) + T(1560, 805, "the project", { size:38, color:BLUE }) + curve(1550, 780, 900, 980, 360, 860, { color:BLUE, width:4 });
  s += T(70, 990, "Homepage", { size:44, color:PENCIL, weight:700 }) + line(70, 1004, 270, 1000, { color:PENCIL, width:3 });
  const sketch = await inkPng(W, H, s), sketchCanvas = await inkCanvas({ id:"example-homepage-sketch", name:"Homepage sketch", ink:sketch, w:W, h:H });
  const sketchPicture = await canvasPicture({ ink:sketch, w:W, h:H, width:1800 });
  write(docs("homepage-from-my-drawing/sketch.png"), sketchPicture);
  write(docs("homepage-from-my-drawing/sketch.penecho.json"), await finish(sketchCanvas, sketchPicture, { x:0, y:0, w:W, h:H }));

  // Agent-built pages, each made into a Canvas with its HTML link the way PenEcho makes one from an agent's page.
  await explorerCanvas("app", "time-labels-overlap", "time-labels-fixed");
  await explorerCanvas("app", "homepage-from-my-drawing", "prototype");
  await explorerCanvas("app", "homepage-from-my-drawing", "homepage");
  await explorerCanvas("app", "dark-mode", "dark-mode");
}
async function explorerCanvas(kind, slug, name) {
  const rel = `files/${slug}/${name}.explorer.html`, text = fs.readFileSync(out(kind, "docs", rel), "utf8");
  const picture = await shot(inCanvas(text), { width:1200, height:750, scale:1.5 });
  const made = await makePicture({ source:rel, text, existing:null, name, renderPage:async () => picture });
  write(out(kind, "docs", `files/${slug}/${name}.png`), picture);
  write(out(kind, "docs", `files/${slug}/${name}.penecho.json`), JSON.stringify(made.bundle));
}

// ---------- Calculus class notes: handwriting, and Canvas AI's answers beside it ----------
const card = (title, body, { w = 520, h = 300 } = {}) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
  html, body { margin: 0; height: 100%; background: #fff; }
  .ai { box-sizing: border-box; width: ${w}px; height: ${h}px; padding: 16px 18px; color: #1f2937; font: 14px/1.45 -apple-system, "Segoe UI", system-ui, sans-serif; }
  .ai * { box-sizing: border-box; }
  .tag { display: inline-flex; align-items: center; gap: 6px; margin-bottom: 8px; color: #6d28d9; font-size: 11.5px; font-weight: 650; letter-spacing: .04em; text-transform: uppercase; }
  .tag i { width: 8px; height: 8px; border-radius: 50%; background: #8b5cf6; }
  h1 { margin: 0 0 8px; font-size: 18px; }
  p { margin: 0 0 8px; }
  .m { font-family: "Times New Roman", Georgia, serif; font-size: 17px; font-style: italic; }
  table { border-collapse: collapse; font-variant-numeric: tabular-nums; }
  td, th { padding: 3px 12px 3px 0; text-align: left; font-size: 13.5px; white-space: nowrap; }
  th { color: #6b7280; font-weight: 600; border-bottom: 1px solid #e5e7eb; }
  .key { color: #166534; font-weight: 700; }
  input[type=range] { width: 100%; }
</style></head><body><div class="ai"><div class="tag"><i></i>Canvas AI</div>${body}</div></body></html>`;
const SQUEEZE = card("Why sin x / x goes to 1", `<h1>Why sin x / x → 1</h1>
  <div style="display:flex;gap:14px">
    <svg width="230" height="190" viewBox="-1.75 -1.35 3.5 2.6" style="flex:none">
      <line x1="-1.7" y1="0" x2="1.7" y2="0" stroke="#cbd5e1" stroke-width=".02"/><line x1="0" y1="-1.3" x2="0" y2=".2" stroke="#cbd5e1" stroke-width=".02"/>
      <line x1="-1.6" y1="-1" x2="1.6" y2="-1" stroke="#16a34a" stroke-width=".03" stroke-dasharray=".08 .06"/>
      <path id="cos" fill="none" stroke="#94a3b8" stroke-width=".03"/><path id="sinc" fill="none" stroke="#2563eb" stroke-width=".045"/>
      <circle cx="0" cy="-1" r=".05" fill="#fff" stroke="#2563eb" stroke-width=".03"/>
      <text x="1.05" y="-1.07" font-size=".17" fill="#16a34a">y = 1</text><text x="-1.62" y="-.42" font-size=".17" fill="#2563eb">sin x / x</text><text x="1.1" y="-.12" font-size=".17" fill="#64748b">cos x</text>
    </svg>
    <div><p>For small <span class="m">x</span> ≠ 0:</p><p class="m" style="font-size:19px">cos x ≤ sin x / x ≤ 1</p><p>Both sides go to 1 as <span class="m">x</span> → 0, so the middle is squeezed to 1 too.</p><p>Check: sin(0.1) / 0.1 = <span class="key">0.99833</span></p></div>
  </div>
  <script>
    const f = (g, a, b) => { let d = ""; for (let i = 0; i <= 80; i++) { const x = a + (b - a) * i / 80; d += (i ? "L" : "M") + x.toFixed(3) + " " + (-g(x)).toFixed(3); } return d; };
    document.getElementById("cos").setAttribute("d", f(Math.cos, -1.57, 1.57));
    document.getElementById("sinc").setAttribute("d", f(x => Math.abs(x) < 1e-6 ? 1 : Math.sin(x) / x, -1.57, 1.57));
  </script>`, { h:260 });
const EULER = card("(1 + 1/n)^n goes to e", `<h1>(1 + 1/n)<sup>n</sup> → e</h1>
  <div style="display:flex;gap:22px;align-items:flex-start">
    <table><tr><th>n</th><th>(1 + 1/n)<sup>n</sup></th></tr><tr><td>1</td><td>2</td></tr><tr><td>10</td><td>2.594</td></tr><tr><td>100</td><td>2.705</td></tr><tr><td>1,000</td><td>2.717</td></tr><tr><td>1,000,000</td><td>2.71828</td></tr></table>
    <div><p>It grows, but more and more slowly, and never passes</p><p class="key" style="font-size:20px">e ≈ 2.71828</p><p>This is one way to define <span class="m">e</span>.</p></div>
  </div>`, { h:240 });
const TANGENT = card("Secant to tangent at x = 1", `<h1>Tangent to y = x² at x = 1</h1>
  <div style="display:flex;gap:18px;align-items:flex-start">
    <svg id="plot" width="250" height="330" viewBox="-0.5 -3.5 2.7 3.6" style="flex:none"></svg>
    <div style="flex:1;padding-top:8px">
      <p>Move h. The blue secant goes through x = 1 and x = 1 + h.</p>
      <label style="display:flex;align-items:center;gap:10px;margin:14px 0">h <input id="h" type="range" min="0.01" max="0.8" step="0.01" value="0.5"><b id="hv" style="width:40px">0.50</b></label>
      <p>Its slope is 2 + h = <b id="slope" class="key">2.50</b></p>
      <p>As h → 0 it becomes the tangent <span class="m">y = 2x − 1</span>, with slope <span class="key">f′(1) = 2</span>.</p>
    </div>
  </div>
  <script>
    const NS = "http://www.w3.org/2000/svg", plot = document.getElementById("plot");
    const add = (name, a) => { const e = document.createElementNS(NS, name); for (const k in a) e.setAttribute(k, a[k]); plot.append(e); return e; };
    add("line", { x1:-0.5, y1:0, x2:2.2, y2:0, stroke:"#cbd5e1", "stroke-width":0.02 }); add("line", { x1:0, y1:0.1, x2:0, y2:-3.5, stroke:"#cbd5e1", "stroke-width":0.02 });
    let d = ""; for (let i = 0; i <= 60; i++) { const x = -0.45 + 2.3 * i / 60; d += (i ? "L" : "M") + x.toFixed(3) + " " + (-x * x).toFixed(3); }
    add("path", { d, fill:"none", stroke:"#1f2937", "stroke-width":0.03 });
    add("line", { x1:0.45, y1:0.1, x2:2.2, y2:-3.4, stroke:"#16a34a", "stroke-width":0.025, "stroke-dasharray":"0.08 0.05" });
    const sec = add("line", { stroke:"#2563eb", "stroke-width":0.03 }), q = add("circle", { r:0.05, fill:"#2563eb" });
    add("circle", { cx:1, cy:-1, r:0.05, fill:"#d6312b" });
    const label = add("text", { x:1.66, y:-1.9, "font-size":0.16, fill:"#16a34a" }); label.textContent = "tangent";
    const show = () => { const h = Number(document.getElementById("h").value), m = 2 + h, a = 0.3, b = 2.2; sec.setAttribute("x1", a); sec.setAttribute("y1", -(1 + m * (a - 1))); sec.setAttribute("x2", b); sec.setAttribute("y2", -(1 + m * (b - 1))); q.setAttribute("cx", 1 + h); q.setAttribute("cy", -(1 + h) * (1 + h)); document.getElementById("hv").textContent = h.toFixed(2); document.getElementById("slope").textContent = m.toFixed(2); };
    document.getElementById("h").addEventListener("input", show); show();
  </script>`, { w:560, h:420 });

async function classPictures() {
  const W = 1536, H = 2048, docs = (...p) => out("class/docs/files", ...p);
  // Class 1: limits.
  seed = 5;
  let s = T(110, 130, "Limits", { size:88 }) + T(420, 128, "— class 1", { size:48, color:GREY }) + stroke([[100, 160], [300, 152], [520, 162], [700, 154]], { color:INK, width:4 });
  s += T(100, 260, "1. What is a limit?", { size:52, color:BLUE });
  s += lim(150, 355, "x→a", 60) + T(290, 355, "f(x) = L", { size:60 });
  s += T(150, 450, "f(x) gets as close to L as we like", { size:42 }) + T(150, 503, "when x is close enough to a", { size:42 }) + T(700, 503, "(x ≠ a !)", { size:42, color:RED });
  s += T(100, 615, "2. Plug in first", { size:52, color:BLUE });
  s += lim(150, 705, "x→2", 56) + T(290, 705, "(x^2 + 1) = 4 + 1 = 5", { size:56 });
  s += T(160, 775, "(works if f is continuous)", { size:38, color:GREY });
  s += T(100, 885, "3. 0/0  →  simplify!", { size:52, color:BLUE });
  s += lim(150, 1000, "x→1", 56) + frac(400, 1000, "x^2 − 1", "x − 1", { size:52 }) + T(540, 1000, "= 0/0 ?!", { size:52, color:RED });
  s += T(150, 1150, "=", { size:54 }) + lim(195, 1150, "x→1", 52) + frac(470, 1150, "(x−1)(x+1)", "(x−1)", { size:48, width:270 }) + T(625, 1150, "= x + 1 → 2", { size:54 });
  s += line(330, 1100, 395, 1078, { color:RED, width:4 }) + line(410, 1205, 470, 1182, { color:RED, width:4 }) + box(878, 1098, 74, 72, { color:RED, width:5 });
  // Its graph: the line y = x + 1 with a hole at x = 1.
  const gx = 1100, gy = 1080, u = 70;
  s += arrow(gx - 60, gy, gx + 340, gy, { color:GREY, width:4 }) + arrow(gx, gy + 40, gx, gy - 300, { color:GREY, width:4 }) + line(gx - .7 * u, gy - .3 * u, gx + 3.2 * u, gy - 4.2 * u, { width:5 }) + circle(gx + u, gy - 2 * u, 11, { color:RED, width:4 });
  s += T(gx + u + 30, gy - 2 * u + 55, "hole", { size:34, color:RED }) + T(gx + 330, gy + 40, "x", { size:32, color:GREY }) + T(gx - 40, gy - 290, "y", { size:32, color:GREY });
  s += T(100, 1330, "4. Two to remember", { size:52, color:BLUE });
  s += lim(150, 1445, "x→0", 56) + frac(370, 1445, "sin x", "x", { size:54 }) + T(470, 1445, "= 1", { size:58 });
  s += T(700, 1440, "why??", { size:52, color:RED }) + ellipse(762, 1425, 92, 48, { color:RED, width:5 }) + arrow(860, 1415, 1500, 1300, { color:RED, width:5 });
  s += lim(150, 1640, "n→∞", 56) + T(290, 1640, "(1 + 1/n)^n = ?", { size:56 }) + arrow(720, 1630, 1500, 1720, { color:RED, width:5 });
  s += T(100, 1860, "HW: p. 62  #3, 7, 12", { size:46 }) + T(100, 1935, "quiz on Friday!", { size:46, color:RED }) + stroke([[480, 1930], [492, 1900], [504, 1930], [474, 1912], [512, 1912], [480, 1930]], { color:RED, width:4 });
  const ink1 = await inkPng(W, H, s), c1 = await inkCanvas({ id:"example-class-1", name:"Class 1 · Limits", ink:ink1, w:W, h:H });
  const w1 = [addWidget(c1, { key:"class-1:squeeze", title:"Why sin x / x → 1", html:SQUEEZE, x:1560, y:1080, w:780, contentW:520, contentH:260 }),
    addWidget(c1, { key:"class-1:euler", title:"(1 + 1/n)^n → e", html:EULER, x:1560, y:1590, w:780, contentW:520, contentH:240 })];
  const p1 = await canvasPicture({ ink:ink1, w:W, h:H, widgets:w1 });
  write(docs("class-1-limits/class-1.png"), p1);
  write(docs("class-1-limits/class-1.penecho.json"), await finish(c1, p1, { x:0, y:0, w:2340, h:H }));

  // Class 2: derivatives.
  seed = 9;
  s = T(110, 130, "Derivatives", { size:88 }) + T(560, 128, "— class 2", { size:48, color:GREY }) + stroke([[100, 160], [380, 152], [640, 162], [840, 154]], { width:4 });
  s += T(100, 260, "1. Slope of a secant", { size:52, color:BLUE });
  s += frac(330, 380, "f(x+h) − f(x)", "h", { size:54 }) + T(540, 380, "= slope of PQ", { size:44, color:GREY });
  const ox = 960, oy = 590, k = 115, P = x => [ox + x * k, oy - x * x * k * .62], on = t => [P(1)[0] + (t - 1) * (P(2)[0] - P(1)[0]), P(1)[1] + (t - 1) * (P(2)[1] - P(1)[1])];
  s += arrow(ox - 40, oy, ox + 480, oy, { color:GREY, width:4 }) + arrow(ox, oy + 30, ox, oy - 420, { color:GREY, width:4 });
  s += stroke([0, .3, .6, .9, 1.2, 1.5, 1.8, 2.1, 2.3].map(P), { width:5 }) + line(...on(.55), ...on(2.45), { color:BLUE, width:4 });
  s += circle(...P(1), 9, { color:BLUE, width:5 }) + circle(...P(2), 9, { color:BLUE, width:5 }) + T(P(1)[0] - 50, P(1)[1] - 10, "P", { size:38, color:BLUE }) + T(P(2)[0] - 50, P(2)[1] - 12, "Q", { size:38, color:BLUE });
  s += stroke([[P(1)[0], oy + 30], [P(1)[0] + 20, oy + 44], [P(1.5)[0], oy + 46], [P(2)[0] - 20, oy + 44], [P(2)[0], oy + 30]], { width:3 }) + T(P(1.5)[0], oy + 90, "h", { size:38, anchor:"middle" });
  s += T(100, 560, "2. The derivative", { size:52, color:BLUE });
  s += T(150, 690, "f ′(x) =", { size:60 }) + lim(375, 690, "h→0", 56) + frac(650, 690, "f(x+h) − f(x)", "h", { size:52 }) + box(125, 610, 760, 150, { color:BLUE, width:5 });
  s += T(100, 870, "Ex:  f(x) = x^2", { size:52, color:BLUE });
  s += frac(300, 985, "(x+h)^2 − x^2", "h", { size:48 }) + T(465, 985, "=", { size:54 }) + frac(640, 985, "2xh + h^2", "h", { size:48 }) + T(790, 985, "= 2x + h", { size:54 });
  s += T(150, 1110, "h → 0 :", { size:52 }) + T(370, 1110, "(x^2)′ = 2x", { size:60 }) + box(350, 1050, 330, 82, { color:GREEN, width:5 });
  s += T(100, 1240, "3. Rules", { size:52, color:BLUE });
  s += T(150, 1330, "(x^n)′ = n · x^{n−1}", { size:54 }) + T(720, 1330, "e.g. (x^3)′ = 3x^2", { size:42, color:GREY });
  s += T(150, 1410, "(c · f)′ = c · f ′", { size:54 }) + T(150, 1490, "(f + g)′ = f ′ + g ′", { size:54 }) + T(150, 1570, "(f · g)′ = f ′g + f g′", { size:54 }) + T(720, 1570, "not f ′· g′ !!", { size:46, color:RED });
  s += T(100, 1720, "tangent to y = x^2 at x = 1 ??", { size:52, color:RED }) + arrow(830, 1700, 1500, 1620, { color:RED, width:5 });
  s += T(100, 1860, "HW: p. 88  #1–10", { size:46 });
  const ink2 = await inkPng(W, H, s), c2 = await inkCanvas({ id:"example-class-2", name:"Class 2 · Derivatives", ink:ink2, w:W, h:H });
  const w2 = [addWidget(c2, { key:"class-2:tangent", title:"Tangent to y = x² at x = 1", html:TANGENT, x:1560, y:1330, w:840, contentW:560, contentH:420 })];
  const p2 = await canvasPicture({ ink:ink2, w:W, h:H, widgets:w2 });
  write(docs("class-2-derivatives/class-2.png"), p2);
  write(docs("class-2-derivatives/class-2.penecho.json"), await finish(c2, p2, { x:0, y:0, w:2400, h:H }));

  // The practice exam, as an agent's page on a Canvas of its own.
  await explorerCanvas("class", "class-2-derivatives", "practice-exam");
}

// ---------- Sales review deck: the spreadsheet, the deck, and the deck before the change ----------
const XLSX = `
import sys
from openpyxl import Workbook
from openpyxl.styles import Font
wb = Workbook()
def sheet(ws, rows, money=True):
    for r in rows: ws.append(r)
    for c in ws[1]: c.font = Font(bold=True)
    ws.column_dimensions["A"].width = 16
    for col in "BCDE": ws.column_dimensions[col].width = 13
ws = wb.active; ws.title = "By region"
sheet(ws, [["Region", "Q1 2026", "Q2 2026", "Q3 2026", "Q4 target"], ["North", 420, 465, 510, 540], ["South", 310, 335, 372, 400], ["East", 380, 402, 455, 480], ["West", 260, 298, 341, 380]])
ws.append(["Total", "=SUM(B2:B5)", "=SUM(C2:C5)", "=SUM(D2:D5)", "=SUM(E2:E5)"]); ws["A7"] = "Revenue in thousands of dollars"
ws = wb.create_sheet("By product")
sheet(ws, [["Product", "Q1 2026", "Q2 2026", "Q3 2026"], ["Cloud plan", 520, 598, 690], ["Desktop app", 480, 495, 512], ["Support", 230, 255, 286], ["Training", 140, 152, 190]])
ws.append(["Total", "=SUM(B2:B5)", "=SUM(C2:C5)", "=SUM(D2:D5)"]); ws["A7"] = "Revenue in thousands of dollars"
ws = wb.create_sheet("Customers")
sheet(ws, [["Quarter", "New customers", "Lost customers", "At the end"], ["Q1 2026", 84, 12, 612], ["Q2 2026", 97, 15, 694], ["Q3 2026", 118, 14, 798]])
ws["A6"] = "540 customers at the start of Q1"
wb.properties.creator = "Brightline"
wb.save(sys.argv[1])
`;
const SLIDE_3_FIRST = `<!doctype html><html><head><meta charset="utf-8"><title>Regions</title><script src="penecho-slide-charts.js"></script></head><body>
<div class="slide" data-penecho-slide data-penecho-template="investor" data-penecho-deck="Q3 2026 sales review">
  <div class="hd"><h1><b>Regions:</b> Every region grew; West fastest at +31.2% since Q1</h1></div>
  <div class="body">
    <div class="col wide"><div class="bar">Revenue by region</div><div class="cap">Q1 and Q3 revenue ($K)</div><div id="c1" class="chart"></div></div>
    <div class="col"><div class="bar">Growth, Q1 to Q3</div><div class="cap">Change (%), West highlighted</div><div id="c2" class="chart"></div></div>
  </div>
  <div class="ft">Source: sales-2026.xlsx (By region sheet); growth computed<span class="co">Brightline</span><span class="pg">3</span></div>
</div>
<script>
SC.bar('#c1', {categories:['North','East','South','West'], series:[{name:'Q1 2026', values:[420,380,310,260], color:'#9CC3EE'},{name:'Q3 2026', values:[510,455,372,341], color:'#1F6FD1'}], axis:false, format:'{}'});
SC.bar('#c2', {categories:['North','East','South','West'], series:[{name:'Growth', values:[21.4,19.7,20.0,31.2], colors:['#A58BE0','#A58BE0','#A58BE0','#4B2A99']}], axis:false, format:'{}%'});
</script>
</body></html>`;
async function contactSheet(pages) {
  const tw = 640, th = 360, gap = 24, pad = 32, cols = 3, rows = Math.ceil(pages.length / cols);
  const layers = [];
  for (const [i, html] of pages.entries()) {
    const png = await sharp(await shot(expandSlide(html), { width:1280, height:720 })).resize(tw, th).png().toBuffer();
    const x = pad + (i % cols) * (tw + gap), y = pad + Math.floor(i / cols) * (th + gap);
    layers.push({ input:await sharp({ create:{ width:tw + 2, height:th + 2, channels:4, background:"#d5dae2" } }).png().toBuffer(), left:x - 1, top:y - 1 }, { input:png, left:x, top:y });
  }
  return sharp({ create:{ width:pad * 2 + cols * tw + (cols - 1) * gap, height:pad * 2 + rows * th + (rows - 1) * gap, channels:4, background:"#eef1f5" } }).composite(layers).flatten({ background:"#eef1f5" }).png({ compressionLevel:9 }).toBuffer();
}
async function deckPictures() {
  const dir = out("deck/docs/files/q3-sales-review-deck"), rel = n => `files/q3-sales-review-deck/sales-review.slide-0${n}.html`;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-example-xlsx-")), xlsx = path.join(temp, "sales-2026.xlsx");
  const made = spawnSync("python3", ["-I", "-c", XLSX, xlsx], { encoding:"utf8" });
  if (made.status !== 0) throw Error(`The spreadsheet needs Python with openpyxl: ${made.stderr}`);
  write(path.join(dir, "sales-2026.xlsx"), fs.readFileSync(xlsx));
  const slides = [1, 2, 3, 4, 5, 6].map(n => fs.readFileSync(path.join(dir, `sales-review.slide-0${n}.html`), "utf8"));
  // One Canvas with the six slides, in a column, as PenEcho makes one from an agent's slide files.
  let canvas = null;
  for (const [i, text] of slides.entries()) canvas = JSON.stringify((await makePicture({ source:rel(i + 1), text, existing:canvas, name:"sales-review" })).bundle);
  const after = await contactSheet(slides), bundle = JSON.parse(canvas), small = await sharp(after).resize(640, 426, { fit:"contain", background:"#ffffff" }).png().toBuffer();
  bundle.assets = [...bundle.assets.filter(a => a.kind !== "preview"), { kind:"preview", contentType:"image/png", metadata:{ width:640, height:426 }, dataBase64:small.toString("base64") }];
  write(path.join(dir, "sales-review.penecho.json"), JSON.stringify(bundle));
  write(path.join(dir, "sales-review.png"), after);
  write(path.join(dir, "first-version.png"), await contactSheet([slides[0], slides[1], SLIDE_3_FIRST, slides[3], slides[4]]));
}

(async () => {
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : { channel:"chrome" });
  try {
    const only = process.argv[2];
    if (!only || only === "app") await appPictures();
    if (!only || only === "class") await classPictures();
    if (!only || only === "deck") await deckPictures();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
