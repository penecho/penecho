"use strict";
const F = require("../project-lines/format.js");

// penecho_draw, penecho_plot and penecho_present_widget with no PenEcho page to draw on: each becomes the one file
// POST /api/draw takes (a diagram, or a self-contained page), and goes on a Canvas in a project's folder instead.
const NO_PAGE_TOOLS = new Set(["penecho_draw", "penecho_plot", "penecho_present_widget"]);
const PLACE_KEYS = ["folder", "project", "canvas", "line"];
const escape = text => String(text).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const page = (title, body, width, height) => `<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title><style>html,body{margin:0;height:100%;overflow:hidden;background:#fff;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}svg{display:block;width:100%;height:100%}</style></head><body><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${body}</svg></body></html>`;

// The same small expression language the Canvas plots: numbers, x, pi, e, + - * / ^, and sin cos tan sqrt abs exp log log10 ln.
function compileExpression(source) {
  const text = String(source || "").trim().replace(/[−–—]/g, "-").replace(/[×·]/g, "*").replace(/÷/g, "/").replace(/\*\*/g, "^").replace(/^y\s*=\s*/i, "").replace(/^f\s*\(\s*x\s*\)\s*=\s*/i, "").replace(/Math\.PI\b/g, "pi").replace(/Math\.E\b/g, "e").replace(/Math\./g, "");
  if (!text || text.length > 180 || !/^[\d\sA-Za-z_+\-*/^().]+$/.test(text)) throw Error("Unsupported expression");
  const tokens = [], re = /\s*(\d*\.?\d+(?:e[+-]?\d+)?|[A-Za-z_][A-Za-z_0-9]*|[()+\-*/^])/gy;
  let at = 0, m;
  while ((m = re.exec(text))) { if (m.index !== at) throw Error("Invalid token"); tokens.push(m[1]); at = re.lastIndex; }
  if (text.slice(at).trim() || tokens.length > 100) throw Error("Expression too complex");
  const funcs = { sin:Math.sin, cos:Math.cos, tan:Math.tan, sqrt:Math.sqrt, abs:Math.abs, exp:Math.exp, log:Math.log, log10:Math.log10, ln:Math.log };
  let i = 0;
  const take = v => (tokens[i] === v ? (i++, true) : false);
  function primary() {
    const t = tokens[i++];
    if (t === "(") { const v = add(); if (!take(")")) throw Error("Unclosed parenthesis"); return v; }
    if (/^\d|^\./.test(t || "")) return () => Number(t);
    if (t === "x") return x => x;
    if (t === "pi") return () => Math.PI;
    if (t === "e") return () => Math.E;
    if (Object.hasOwn(funcs, t || "")) { if (!take("(")) throw Error("Function needs parentheses"); const arg = add(); if (!take(")")) throw Error("Unclosed function"); return x => funcs[t](arg(x)); }
    throw Error("Unknown identifier");
  }
  function unary() { if (take("+")) return unary(); if (take("-")) { const v = unary(); return x => -v(x); } return power(); }
  function power() { const left = primary(); if (take("^")) { const right = unary(); return x => left(x) ** right(x); } return left; }
  function multiply() { let left = unary(); while (tokens[i] === "*" || tokens[i] === "/") { const op = tokens[i++], right = unary(), old = left; left = op === "*" ? x => old(x) * right(x) : x => old(x) / right(x); } return left; }
  function add() { let left = multiply(); while (tokens[i] === "+" || tokens[i] === "-") { const op = tokens[i++], right = multiply(), old = left; left = op === "+" ? x => old(x) + right(x) : x => old(x) - right(x); } return left; }
  const result = add();
  if (i !== tokens.length) throw Error("Unexpected expression tail");
  return result;
}
const tick = (min, max) => { const raw = (max - min) / 8, step = 10 ** Math.floor(Math.log10(raw)), n = raw / step; return (n >= 5 ? 10 : n >= 2 ? 5 : n >= 1 ? 2 : 1) * step; };
const label = v => String(Math.abs(v) < 1e-9 ? 0 : Number(v.toPrecision(6)));
function ticks(min, max, step) {
  const first = Math.ceil(min / step - 1e-10);
  return Array.from({ length:Math.max(0, Math.min(40, Math.floor(max / step + 1e-10) - first + 1)) }, (_, i) => (first + i) * step);
}

// The static SVG contains the complete curve. Interaction only reveals sampled coordinates.
function inspectPlot(values, xMin, xMax, yMin, yMax, width, height, pad) {
  const svg = document.querySelector("svg"), point = document.getElementById("point"), output = document.getElementById("coordinate");
  const last = values.length - 1;
  let index = Math.round(last / 2);
  function show(next) {
    index = Math.max(0, Math.min(last, next));
    const x = xMin + (xMax - xMin) * index / last, y = values[index];
    output.textContent = "x = " + Number(x.toPrecision(5)) + "   y = " + (y === null ? "undefined" : Number(y.toPrecision(5)));
    point.setAttribute("visibility", y !== null && y >= yMin && y <= yMax ? "visible" : "hidden");
    point.setAttribute("cx", pad + (width - 2 * pad) * index / last);
    if (y !== null) point.setAttribute("cy", height - pad - (height - 2 * pad) * (y - yMin) / (yMax - yMin));
  }
  function pointer(event) {
    const p = svg.createSVGPoint();
    p.x = event.clientX; p.y = event.clientY;
    const local = p.matrixTransform(svg.getScreenCTM().inverse());
    show(Math.round(last * (local.x - pad) / (width - 2 * pad)));
  }
  svg.addEventListener("pointermove", pointer);
  svg.addEventListener("pointerdown", pointer);
  svg.addEventListener("focus", () => show(index));
  svg.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    show(event.key === "Home" ? 0 : event.key === "End" ? last : index + (event.key === "ArrowRight" ? 1 : -1));
  });
}
function plotPage(args, { trigScale = false } = {}) {
  const f = compileExpression(args.expression), width = args.width || 800, height = args.height || 500, pad = 48;
  const formula = args.expression.replace(/\s|Math\./g, "").replace(/^y=/, "");
  const trig = /\b(?:sin|cos|tan)\(/.test(formula), tangent = /^(?:x\*)?tan\(x\)(?:\*x)?$/.test(formula);
  const envelope = /^(?:x\*(?:sin|cos)\(x\)|(?:sin|cos)\(x\)\*x)$/.test(formula);
  const xMin = args.xMin ?? (trigScale && trig ? -4 * Math.PI : -10), xMax = args.xMax ?? (trigScale && trig ? 4 * Math.PI : 10);
  const samples = 600, xs = Array.from({ length:samples + 1 }, (_, k) => xMin + (xMax - xMin) * k / samples);
  const ys = xs.map(x => tangent && Math.abs(Math.cos(x)) < 1e-12 ? NaN : f(x));
  const finite = ys.filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) throw Error("The expression has no finite value in that range.");
  let yMin = args.yMin, yMax = args.yMax;
  if (yMin === undefined) {
    if (trigScale && envelope) {
      yMax = Math.max(Math.abs(xMin), Math.abs(xMax)) * 1.075; yMin = -yMax;
    } else {
      yMin = finite[Math.floor(finite.length * 0.02)]; yMax = finite[Math.ceil(finite.length * 0.98) - 1];
      if (yMax - yMin < 1e-9) { const offset = Math.max(1, Math.abs(yMin) * .01); yMin -= offset; yMax += offset; }
      const room = (yMax - yMin) * 0.08; yMin -= room; yMax += room;
    }
  }
  if (!Number.isFinite(yMax - yMin) || yMax <= yMin) throw Error("Set an explicit finite y range for this expression.");
  const sx = x => pad + (x - xMin) / (xMax - xMin) * (width - 2 * pad), sy = y => height - pad - (y - yMin) / (yMax - yMin) * (height - 2 * pad);
  const grid = [], guides = [], dx = tick(xMin, xMax), dy = tick(yMin, yMax);
  const piTicks = trig && xMax - xMin >= Math.PI && xMax - xMin <= Math.PI * 32;
  const piStep = Math.PI * Math.max(1, Math.ceil((xMax - xMin) / (Math.PI * Math.max(3, Math.floor((width - 2 * pad) / 65)))));
  for (const x of ticks(xMin, xMax, piTicks ? piStep : dx)) {
    const n = Math.round(x / Math.PI), caption = !piTicks || !n ? label(x) : (n === 1 ? "" : n === -1 ? "−" : n) + "π";
    grid.push(`<line x1="${sx(x)}" y1="${pad}" x2="${sx(x)}" y2="${height - pad}" stroke="#e2e7eb"/><text x="${sx(x)}" y="${height - pad + 18}" font-size="13" text-anchor="middle" fill="#475569">${caption}</text>`);
  }
  for (const y of ticks(yMin, yMax, dy)) grid.push(`<line x1="${pad}" y1="${sy(y)}" x2="${width - pad}" y2="${sy(y)}" stroke="#e2e7eb"/><text x="${pad - 6}" y="${sy(y) + 4}" font-size="12" text-anchor="end" fill="#475569">${label(y)}</text>`);
  const axes = [xMin <= 0 && xMax >= 0 ? `<line x1="${sx(0)}" y1="${pad}" x2="${sx(0)}" y2="${height - pad}" stroke="#64748b"/>` : "", yMin <= 0 && yMax >= 0 ? `<line x1="${pad}" y1="${sy(0)}" x2="${width - pad}" y2="${sy(0)}" stroke="#64748b"/>` : ""].join("");
  if (envelope) for (const sign of [-1, 1]) guides.push(`<line x1="${sx(xMin)}" x2="${sx(xMax)}" y1="${sy(sign * xMin)}" y2="${sy(sign * xMax)}"/>`);
  if (tangent && (xMax - xMin) <= 32 * Math.PI) for (const x of ticks(xMin - Math.PI / 2, xMax - Math.PI / 2, Math.PI)) {
    const px = sx(x + Math.PI / 2);
    guides.push(`<line x1="${px}" x2="${px}" y1="${pad}" y2="${height - pad}"/>`);
  }
  const runs = [[]], branch = x => Math.floor(x / Math.PI + 0.5);
  for (let k = 0; k <= samples; k++) {
    const x = xs[k], y = ys[k];
    if (tangent && k && branch(x) !== branch(xs[k - 1]) && runs.at(-1).length) runs.push([]);
    if (!Number.isFinite(y) || y < yMin - (yMax - yMin) || y > yMax + (yMax - yMin)) { if (runs.at(-1).length) runs.push([]); continue; }
    runs.at(-1).push(`${sx(x).toFixed(2)},${sy(y).toFixed(2)}`);
  }
  const color = args.color || "#2563eb";
  const curve = runs.filter(r => r.length > 1).map(r => `<polyline points="${r.join(" ")}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"/>`).join("");
  const equation = "y = " + args.expression.replace(/^y\s*=\s*/i, "");
  const heading = args.title === equation || !args.title ? equation : args.title + " · " + equation;
  const body = `<rect width="${width}" height="${height}" fill="white"/>${grid.join("")}${axes}<clipPath id="c"><rect x="${pad}" y="${pad}" width="${width - 2 * pad}" height="${height - 2 * pad}"/></clipPath><g clip-path="url(#c)"><g stroke="#8796a5" stroke-dasharray="6 5">${guides.join("")}</g>${curve}<circle id="point" r="4" fill="${color}" visibility="hidden"/></g><text x="${pad}" y="28" font-size="17" font-weight="600" fill="#182536">${escape(heading)}</text><text id="coordinate" x="${width - pad}" y="${height - 6}" font-size="12" fill="#475569" text-anchor="end" aria-live="polite">Point or use ← → to inspect</text>`;
  const html = page(args.title, body, width, height).replace("<svg ", `<svg tabindex="0" role="group" aria-label="${escape(equation)}. Use the arrow keys to inspect coordinates." data-penecho-plot-range="${[xMin,xMax,yMin,yMax].join(",")}" `);
  return html.replace("</body>", () => `<script>(${inspectPlot.toString()})(${JSON.stringify(ys)},${[xMin,xMax,yMin,yMax,width,height,pad].join(",")})</script></body>`);
}
function plotRange(html) {
  const match = / data-penecho-plot-range="([\d.eE+,\-]+)"/.exec(html || "");
  if (!match) return {};
  const values = match[1].split(",").map(Number);
  if (values.length !== 4 || !values.every(Number.isFinite)) return {};
  const [xMin,xMax,yMin,yMax] = values;
  return { xMin,xMax,yMin,yMax };
}

// A few simple shapes and words, laid out as the Canvas lays out penecho_draw items that give no place.
function drawPage(args) {
  const items = args.items.map(item => ({ ...item })), boxes = new Map();
  let auto = 0;
  for (const item of items) {
    if (!["text", "rect", "ellipse"].includes(item.type)) continue;
    const size = item.fontSize || (item.type === "text" ? 20 : 18);
    const w = item.width || (item.type === "text" ? Math.max(40, Math.min(1200, String(item.text || "").length * size * 0.6 + 8)) : 200);
    const h = item.height || (item.type === "text" ? size * 1.5 : 110);
    const x = item.x ?? 40 + (auto % 4) * 280, y = item.y ?? 60 + Math.floor(auto / 4) * 190;
    if (item.x === undefined) auto++;
    boxes.set(item.id, { x, y, w, h, size });
  }
  // Where a line from the middle of one box toward another leaves that box.
  const edge = (from, to) => {
    const cx = from.x + from.w / 2, cy = from.y + from.h / 2, tx = to.x + to.w / 2, ty = to.y + to.h / 2, dx = tx - cx, dy = ty - cy;
    const scale = Math.min(dx ? from.w / 2 / Math.abs(dx) : Infinity, dy ? from.h / 2 / Math.abs(dy) : Infinity);
    return { x:cx + dx * Math.min(1, scale), y:cy + dy * Math.min(1, scale) };
  };
  const parts = [], extent = { x:0, y:0 };
  const grow = (x, y) => { extent.x = Math.max(extent.x, x); extent.y = Math.max(extent.y, y); };
  for (const item of items) {
    const stroke = item.color || "#1f2937", fill = item.fill && item.fill !== "transparent" ? item.fill : "none", sw = item.strokeWidth || 2, box = boxes.get(item.id);
    if (item.type === "rect" || item.type === "ellipse") {
      parts.push(item.type === "rect" ? `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>` : `<ellipse cx="${box.x + box.w / 2}" cy="${box.y + box.h / 2}" rx="${box.w / 2}" ry="${box.h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`);
      if (item.text) parts.push(`<text x="${box.x + box.w / 2}" y="${box.y + box.h / 2}" font-size="${box.size}" text-anchor="middle" dominant-baseline="middle" fill="${stroke}">${escape(item.text)}</text>`);
      grow(box.x + box.w, box.y + box.h);
    } else if (item.type === "text") {
      parts.push(`<text x="${box.x}" y="${box.y + box.size}" font-size="${box.size}" fill="${stroke}">${escape(item.text)}</text>`);
      grow(box.x + box.w, box.y + box.h);
    } else {
      let points = item.points;
      if (item.from !== undefined) { const a = boxes.get(item.from), b = boxes.get(item.to); points = [edge(a, b), edge(b, a)]; }
      for (const p of points) grow(p.x, p.y);
      const head = item.type === "arrow" ? ` marker-end="url(#arrow-${escape(item.id)})"` : "";
      if (item.type === "arrow") parts.push(`<defs><marker id="arrow-${escape(item.id)}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${stroke}"/></marker></defs>`);
      parts.push(`<polyline points="${points.map(p => `${p.x},${p.y}`).join(" ")}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${head}/>`);
    }
  }
  const width = Math.max(320, Math.ceil(extent.x + 40)), height = Math.max(200, Math.ceil(extent.y + 40));
  return page(args.title, `<rect width="${width}" height="${height}" fill="#fff"/>${parts.join("")}`, width, height);
}
// A page that names itself, so its Canvas is called what the agent called it.
function titled(html, title) {
  if (/<title[^>]*>[^<]+<\/title>/i.test(html)) return html;
  const tag = `<title>${escape(title)}</title>`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, head => `${head}${tag}`) : `${tag}${html}`;
}
// The file for one call: `args` as the tool's validator returned them, `raw` as the agent sent them.
function fileFor(name, args, raw) {
  const stem = F.slugify(args.artifactId, "picture");
  if (name === "penecho_plot") return { name:`${stem}.explorer.html`, text:plotPage(args) };
  if (name === "penecho_draw") return { name:`${stem}.explorer.html`, text:drawPage(args) };
  for (const type of ["architecture", "sequence", "workflow"]) {
    if (raw[type] && typeof raw[type] === "object") return { name:`${stem}.diagram.json`, text:JSON.stringify({ title:args.title, ...raw[type], type }) };
  }
  return { name:`${stem}.explorer.html`, text:titled(args.html, args.title) };
}

module.exports = { NO_PAGE_TOOLS, PLACE_KEYS, fileFor, plotPage, plotRange, drawPage, compileExpression };
