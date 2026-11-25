// Canonical MeetCue meeting map layout, data adapter, SVG renderer, and interactive viewport.
// Ported from MeetCue (layout.js, kinds.js, MeetingCanvas.vue) using @dagrejs/dagre (MIT).
import dagre from '@dagrejs/dagre';

// ---------- Entity kinds & Lucide glyphs (ISC license, 24x24) ----------
export const GLYPH = {
  person: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
  org: 'M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18ZM6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2M10 6h4M10 10h4M10 14h4M10 18h4',
  project: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z',
  system: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM9 9h6v6H9zM9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3',
  concept: 'M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5M9 18h6M10 22h4',
  metric: 'M22 7 13.5 15.5 8.5 10.5 2 17M16 7h6v6',
  place: 'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0ZM12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  time: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20M12 6v6l4 2',
  doc: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7ZM14 2v4a2 2 0 0 0 2 2h4M16 13H8M16 17H8M10 9H8',
};
export const KINDS = Object.keys(GLYPH);
export const EDGE_KINDS = ['rel', 'flow', 'depends', 'owns', 'support', 'conflict'];

// ---------- Layout constants (exact MeetCue layout.js tokens) ----------
export const FONT = {
  label: { size: 13.5, weight: 600, lh: 18 },
  note: { size: 11, weight: 400, lh: 14 },
  edge: { size: 10.5, weight: 500, lh: 13 },
  title: { size: 17, weight: 800, lh: 22 },
  status: { size: 10.5, weight: 600, lh: 18 },
  card: { size: 12, weight: 450, lh: 16 },
  rootTitle: { size: 15, weight: 700, lh: 20 },
};
export const ICON = { x: 9, y: 11, size: 15 };
export const BRANCH = ['#2563eb', '#e11d48', '#d97706', '#7c3aed', '#0d9488', '#0284c7', '#c026d3', '#65a30d'];
export const ARROW = 9;

const PAD_X = 10, LABEL_X = 30, NODE_MIN = 84, NODE_MAX = 196, NOTE_LINES = 2, LABEL_LINES = 2;
const EDGE_LABEL_MAX = 112, EDGE_LABEL_LINES = 2;
const FRAME_PAD = 14, TITLE_Y = 26, BLOCK_MAX = 380, PART_GAP = 26, LOOSE_GAP = 14;
const STACK_GAP = 26, CARD_MIN = 300, FRAME_MIN = 220, TITLE_LINES = 3, CARD_LINES = 3;
const ROOT_W = 380, HUB_H = 34, PILL_H = 22;

const TOPIC_STATUS_LABELS = {
  active: 'In progress',
  upcoming: 'Upcoming',
  done: 'Discussed',
  parked: 'Parked',
};
const WORDS = {
  status: s => {
    const k = String(s || '').trim().toLowerCase();
    if (!k) return '';
    return TOPIC_STATUS_LABELS[k] || String(s).trim();
  },
};

const CJK = /[\u2E80-\u9FFF\uAC00-\uD7AF\uFF00-\uFFEF\u3000-\u303F]/;
const CLOSING = /^[，。、；：！？）》」』】,.;:!?)\]]/;

// Text width without a canvas: CJK is square, Latin about half as wide.
export function estimate(text, size, weight = 400) {
  let w = 0;
  for (const ch of String(text || '')) {
    w += CJK.test(ch) ? 1 : /[A-Z@#%&mwMW]/.test(ch) ? 0.68 : /[\s.,;:'!|ilIjtf()[\]]/.test(ch) ? 0.3 : 0.56;
  }
  return w * size * (weight >= 600 ? 1.04 : 1);
}

// Browser canvas text measurement matching MeetCue's SVG font when available, falling back to estimate().
const MM_DEFAULT_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Microsoft YaHei", sans-serif';
let _measureCtx = null;
const _measureCache = new Map();

export function createBrowserMeasure(fontFamily = '') {
  const family = fontFamily || MM_DEFAULT_FONT;
  return function measure(text, px, weight = 400) {
    if (typeof document === 'undefined') return estimate(text, px, weight);
    if (_measureCtx === null) {
      try {
        _measureCtx = document.createElement('canvas').getContext('2d') || false;
      } catch {
        _measureCtx = false;
      }
    }
    if (!_measureCtx) return estimate(text, px, weight);
    const key = `${family}|${weight}|${px}|${text}`;
    let w = _measureCache.get(key);
    if (w === undefined) {
      _measureCtx.font = `${weight} ${px}px ${family}`;
      w = _measureCtx.measureText(String(text || '')).width;
      if (_measureCache.size > 4000) _measureCache.clear();
      _measureCache.set(key, w);
    }
    return w;
  };
}

// Null-prototype dictionary helper so payload IDs like "constructor" or "__proto__" never collide with Object.prototype.
const dict = () => Object.create(null);
const fromPairs = pairs => {
  const o = Object.create(null);
  for (const [k, v] of pairs) o[k] = v;
  return o;
};
const hasKey = (o, k) => Boolean(o) && Object.prototype.hasOwnProperty.call(o, k);

// Lines of at most `width`; CJK breaks anywhere, other scripts between words. Past `maxLines`, the last line
// ends with an ellipsis.
export function wrap(text, font, width, maxLines, measure = estimate) {
  const size = s => measure(s, font.size, font.weight);
  const tokens = String(text || '').replace(/\s+/g, ' ').trim()
    .match(/[\u2E80-\u9FFF\uAC00-\uD7AF\uFF00-\uFFEF\u3000-\u303F]|[^\s\u2E80-\u9FFF\uAC00-\uD7AF\uFF00-\uFFEF\u3000-\u303F]+ ?| /g) || [];
  const lines = [];
  let line = '';
  for (let token of tokens) {
    if (!line && token === ' ') continue;
    if (size((line + token).trimEnd()) <= width || (line && CLOSING.test(token))) { line += token; continue; }
    if (line) lines.push(line.trimEnd());
    line = '';
    while (size(token.trimEnd()) > width) {
      const chars = [...token];
      let cut = 1;
      while (cut < chars.length && size(chars.slice(0, cut + 1).join('')) <= width) cut++;
      lines.push(chars.slice(0, cut).join(''));
      token = chars.slice(cut).join('');
    }
    line = token.trim() ? token : '';
  }
  if (line.trim()) lines.push(line.trimEnd());
  if (lines.length > maxLines) {
    lines.length = maxLines;
    const last = [...lines[maxLines - 1]];
    while (last.length && size(last.join('') + '…') > width) last.pop();
    lines[maxLines - 1] = last.join('').trimEnd() + '…';
  }
  return lines;
}

const widest = (lines, font, measure) => Math.max(0, ...lines.map(l => measure(l, font.size, font.weight)));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = v => Math.round(v * 10) / 10;

function nodeBox(node, measure) {
  const label = wrap(node.label, FONT.label, NODE_MAX - LABEL_X - PAD_X, LABEL_LINES, measure);
  const note = node.note ? wrap(node.note, FONT.note, NODE_MAX - PAD_X * 2, NOTE_LINES, measure) : [];
  const content = Math.max(LABEL_X + widest(label, FONT.label, measure) + PAD_X, PAD_X * 2 + widest(note, FONT.note, measure));
  const w = Math.ceil(clamp(content + 1, NODE_MIN, NODE_MAX));
  const rows = [];
  let y = 10;
  label.forEach(text => { rows.push({ t: 'label', text, x: LABEL_X, y: y + 13 }); y += FONT.label.lh; });
  if (note.length) y += 2;
  note.forEach(text => { rows.push({ t: 'note', text, x: PAD_X, y: y + 10.5 }); y += FONT.note.lh; });
  return { w, h: y + 9, rows };
}

function edgeLabel(text, measure) {
  if (!text) return null;
  const lines = wrap(text, FONT.edge, EDGE_LABEL_MAX, EDGE_LABEL_LINES, measure);
  if (!lines.length) return null;
  return { lines, w: Math.ceil(widest(lines, FONT.edge, measure) + 16), h: lines.length * FONT.edge.lh + 6 };
}

function block(ids, edges, boxes, order, measure) {
  const own = new Set(ids);
  const inner = edges.filter(e => own.has(e.from) && own.has(e.to));
  const parent = fromPairs(ids.map(id => [id, id]));
  const find = x => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (const e of inner) parent[find(e.from)] = find(e.to);
  const groups = dict();
  for (const id of ids) (groups[find(id)] ||= []).push(id);
  const parts = [], loose = [];
  for (const list of Object.values(groups).sort((a, b) => order[a[0]] - order[b[0]])) {
    if (list.length === 1) { loose.push(list[0]); continue; }
    const members = new Set(list);
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'TB', nodesep: 24, ranksep: 26, edgesep: 14, marginx: 0, marginy: 0 });
    g.setDefaultEdgeLabel(() => ({}));
    // Prefix internal dagre keys so prototype names like "constructor" or "__proto__" never collide inside dagre.
    const dk = id => `n:${id}`;
    const undk = k => k.slice(2);
    for (const id of list) g.setNode(dk(id), { width: boxes[id].w, height: boxes[id].h });
    const labels = dict();
    for (const e of inner) {
      if (!members.has(e.from)) continue;
      const label = labels[e.id] = edgeLabel(e.label, measure);
      g.setEdge(dk(e.from), dk(e.to), { id: e.id, width: label?.w || 0, height: label?.h || 0, labelpos: 'c' });
    }
    dagre.layout(g);
    const nodes = dict(), links = [];
    for (const id of list) { const v = g.node(dk(id)); nodes[id] = { x: v.x - boxes[id].w / 2, y: v.y - boxes[id].h / 2 }; }
    const at = id => ({ ...nodes[id], w: boxes[id].w, h: boxes[id].h });
    const keys = g.edges(), outs = dict(), ins = dict();
    for (const k of keys) { (outs[k.v] ||= []).push(k); (ins[k.w] ||= []).push(k); }
    for (const l of Object.values(outs)) l.sort((p, q) => g.node(p.w).x - g.node(q.w).x);
    for (const l of Object.values(ins)) l.sort((p, q) => g.node(p.v).x - g.node(q.v).x);
    for (const key of keys) {
      const l = g.edge(key), label = labels[l.id];
      const points = curve(at(undk(key.v)), at(undk(key.w)), outs[key.v].indexOf(key), outs[key.v].length, ins[key.w].indexOf(key), ins[key.w].length);
      const mid = bezierMid(points);
      links.push({ id: l.id, points, cubic: true, label: label && { ...label, x: mid.x - label.w / 2, y: mid.y - label.h / 2 } });
    }
    parts.push({ w: g.graph().width, h: g.graph().height, nodes, links });
  }
  if (loose.length) {
    const nodes = dict();
    let x = 0, y = 0, rowH = 0, w = 0;
    for (const id of loose) {
      if (x && x + boxes[id].w > BLOCK_MAX) { x = 0; y += rowH + LOOSE_GAP; rowH = 0; }
      nodes[id] = { x, y };
      x += boxes[id].w + LOOSE_GAP;
      rowH = Math.max(rowH, boxes[id].h);
      w = Math.max(w, x - LOOSE_GAP);
    }
    parts.push({ w, h: y + rowH, nodes, links: [], loose: true });
  }
  const out = { nodes: dict(), links: [], w: 0, h: 0 };
  let x = 0, y = 0, rowH = 0;
  for (const p of parts) {
    if (x && (x + p.w > BLOCK_MAX || p.loose)) { x = 0; y += rowH + PART_GAP; rowH = 0; }
    for (const [id, q] of Object.entries(p.nodes)) out.nodes[id] = { x: x + q.x, y: y + q.y };
    for (const l of p.links) {
      out.links.push({
        ...l,
        points: l.points.map(q => ({ x: q.x + x, y: q.y + y })),
        label: l.label && { ...l.label, x: l.label.x + x, y: l.label.y + y },
      });
    }
    x += p.w + PART_GAP;
    rowH = Math.max(rowH, p.h);
    out.w = Math.max(out.w, x - PART_GAP);
  }
  out.h = y + rowH;
  return out;
}

function curve(a, b, outK, outN, inK, inN) {
  const port = (box, k, n) => box.x + box.w / 2 + (n > 1 ? (k - (n - 1) / 2) * Math.min(18, box.w / (n + 1)) : 0);
  const pt = (x, y) => ({ x, y });
  if (b.y >= a.y + a.h - 1 || b.y + b.h <= a.y + 1) {
    const down = b.y >= a.y + a.h - 1;
    const p0 = pt(port(a, outK, outN), down ? a.y + a.h : a.y), p3 = pt(port(b, inK, inN), down ? b.y : b.y + b.h);
    const dx = p3.x - p0.x, dy = p3.y - p0.y;
    return [p0, pt(p0.x, p0.y + dy * 0.55), pt(p3.x - dx * 0.3, p3.y - dy * 0.3), p3];
  }
  const right = b.x >= a.x + a.w / 2;
  const p0 = pt(right ? a.x + a.w : a.x, a.y + a.h / 2), p3 = pt(right ? b.x : b.x + b.w, b.y + b.h / 2), dx = p3.x - p0.x;
  return [p0, pt(p0.x + dx * 0.45, p0.y), pt(p3.x - dx * 0.45, p3.y), p3];
}
const bezierMid = ([a, b, c, d]) => ({ x: (a.x + 3 * b.x + 3 * c.x + d.x) / 8, y: (a.y + 3 * b.y + 3 * c.y + d.y) / 8 });

function smooth(points, cubic = false) {
  if (cubic) {
    const [a, b, c, z] = points;
    return `M${r1(a.x)} ${r1(a.y)}C${r1(b.x)} ${r1(b.y)} ${r1(c.x)} ${r1(c.y)} ${r1(z.x)} ${r1(z.y)}`;
  }
  let d = `M${r1(points[0].x)} ${r1(points[0].y)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    d += `Q${r1(a.x)} ${r1(a.y)} ${r1((a.x + b.x) / 2)} ${r1((a.y + b.y) / 2)}`;
  }
  const z = points[points.length - 1];
  return d + `L${r1(z.x)} ${r1(z.y)}`;
}

const hit = (x, y, w, h, b) => x < b.x + b.w && b.x < x + w && y < b.y + b.h && b.y < y + h;
const near = (a, b) => Math.abs(a - b) < 0.01;

function clear(a, b, obstacles, skip) {
  const x = Math.min(a.x, b.x) - 1, y = Math.min(a.y, b.y) - 1, w = Math.abs(a.x - b.x) + 2, h = Math.abs(a.y - b.y) + 2;
  return !obstacles.some(o => o.id !== skip && hit(x, y, w, h, { x: o.x - 2, y: o.y - 2, w: o.w + 4, h: o.h + 4 }));
}

function approach(n, dir, edge, obstacles) {
  const cx = n.x + n.w / 2, above = n.y - 7, below = n.y + n.h + 7;
  const ways = [
    [{ x: dir > 0 ? n.x + n.w : n.x, y: n.y + n.h / 2 }, { x: edge, y: n.y + n.h / 2 }],
    [{ x: cx, y: n.y }, { x: cx, y: above }, { x: edge, y: above }],
    [{ x: cx, y: n.y + n.h }, { x: cx, y: below }, { x: edge, y: below }],
  ];
  return ways.find(points => points.every((q, i) => !i || clear(points[i - 1], q, obstacles, n.id))) || ways[0];
}

function rounded(points, radius = 8) {
  const p = [];
  for (const q of points) {
    const a = p[p.length - 2], b = p[p.length - 1];
    if (b && near(b.x, q.x) && near(b.y, q.y)) continue;
    if (a && ((near(a.x, b.x) && near(b.x, q.x)) || (near(a.y, b.y) && near(b.y, q.y)))) p.pop();
    p.push(q);
  }
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const toward = (from, to, k) => { const d = dist(from, to) || 1; return `${r1(from.x + (to.x - from.x) * k / d)} ${r1(from.y + (to.y - from.y) * k / d)}`; };
  let d = `M${r1(p[0].x)} ${r1(p[0].y)}`;
  for (let i = 1; i < p.length - 1; i++) {
    const k = Math.min(radius, dist(p[i - 1], p[i]) / 2, dist(p[i], p[i + 1]) / 2);
    d += `L${toward(p[i], p[i - 1], k)}Q${r1(p[i].x)} ${r1(p[i].y)} ${toward(p[i], p[i + 1], k)}`;
  }
  const z = p[p.length - 1];
  return { d: d + `L${r1(z.x)} ${r1(z.y)}`, points: p };
}

function placeLabel(label, points, obstacles, placed) {
  const spots = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], length = Math.hypot(a.x - b.x, a.y - b.y);
    for (const t of length > 160 ? [0.5, 0.3, 0.7] : [0.5]) spots.push({ length, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  spots.sort((a, b) => b.length - a.length);
  const boxAt = q => ({ x: r1(q.x - label.w / 2), y: r1(q.y - label.h / 2), w: label.w, h: label.h });
  const free = q => { const b = boxAt(q); return ![...obstacles, ...placed].some(o => hit(b.x - 2, b.y - 2, b.w + 4, b.h + 4, o)); };
  const box = boxAt(spots.find(free) || spots[0]);
  placed.push(box);
  return { ...label, ...box };
}

export function layoutMap(map, { previous = {}, measure = estimate, words: custom = {}, columns = false } = {}) {
  const words = { ...WORDS, ...custom };
  const topics = map.topics || [];
  const topicIndex = fromPairs(topics.map((t, i) => [t.id, i]));
  const all = (map.nodes || []).filter(n => n && n.id);
  const order = fromPairs(all.map((n, i) => [n.id, i]));
  const byId = fromPairs(all.map(n => [n.id, n]));
  const groupOf = id => (hasKey(topicIndex, byId[id].topic) ? byId[id].topic : '');
  const edges = (map.edges || []).filter(e => e && hasKey(byId, e.from) && hasKey(byId, e.to) && e.from !== e.to)
    .map((e, i) => (e.id ? e : { ...e, id: `e${i}` }));
  const edgeById = fromPairs(edges.map(e => [e.id, e]));
  const boxes = fromPairs(all.map(n => [n.id, nodeBox(n, measure)]));

  const core = block(all.filter(n => !groupOf(n.id)).map(n => n.id), edges, boxes, order, measure);
  const nodes = dict(), out = { frames: dict(), nodes, edges: [] };
  for (const [id, q] of Object.entries(core.nodes)) nodes[id] = { ...boxes[id], id, x: r1(q.x), y: r1(q.y), frame: '' };
  for (const l of core.links) out.edges.push({ id: l.id, d: smooth(l.points, l.cubic), label: l.label, frame: '' });

  const frames = [];
  for (const t of topics) {
    const ids = all.filter(n => groupOf(n.id) === t.id).map(n => n.id);
    const lines = [...(t.sofar || []).map(x => ['done', x]), ...(t.ahead || []).map(x => ['ask', x])].filter(([, x]) => x);
    const b = ids.length ? block(ids, edges, boxes, order, measure) : { nodes: dict(), links: [], w: 0, h: 0 };
    const status = words.status(t.status);
    const statusW = status ? Math.ceil(measure(status, FONT.status.size, FONT.status.weight) + 16) : 0;
    const inner = Math.max(b.w, lines.length ? CARD_MIN : 0, FRAME_MIN);
    const title = wrap(t.label, FONT.title, Math.max(160, inner - 34 - statusW), TITLE_LINES, measure);
    const w = Math.ceil(Math.max(inner, 34 + widest(title, FONT.title, measure) + (statusW ? 10 + statusW : 0)) + FRAME_PAD * 2);
    const last = TITLE_Y + Math.max(0, title.length - 1) * FONT.title.lh, rule = last + 11;
    let head = rule + 7;
    const card = [];
    for (const [kind, text] of lines) {
      const wrapped = wrap(text, FONT.card, w - FRAME_PAD * 2 - 22, CARD_LINES, measure);
      card.push({ t: 'mark', kind, x: FRAME_PAD + 7, y: head + 8 });
      wrapped.forEach((line, i) => card.push({ t: 'card', kind, text: line, x: FRAME_PAD + 20, y: head + 12 + i * FONT.card.lh }));
      head += wrapped.length * FONT.card.lh + 6;
    }
    if (lines.length && ids.length) head += 8;
    if (!ids.length) head -= lines.length ? 4 : 10;
    const displayIndex = Number.isInteger(t.displayIndex) ? t.displayIndex : topicIndex[t.id];
    const rows = [
      ...(lines.length ? [{ t: 'rule', x1: FRAME_PAD, x2: w - FRAME_PAD, y: rule }] : []),
      ...card,
      { t: 'index', x: FRAME_PAD + 10, y: TITLE_Y - 5, text: String(displayIndex + 1) },
      ...title.map((text, i) => ({ t: 'title', text, x: FRAME_PAD + 26, y: TITLE_Y + i * FONT.title.lh })),
      ...(status ? [{ t: 'status', text: status, x: w - FRAME_PAD - statusW, y: 10, w: statusW }] : []),
    ];
    frames.push({ id: t.id, label: t.label, status: t.status || '', index: displayIndex, color: t.color || '', w, h: Math.ceil(head + b.h + FRAME_PAD), head, b, rows });
  }

  if (!columns && frames.length) {
    return treeLayout({ ...map, edges, tree: map.tree && Array.isArray(map.tree.frames) ? map.tree : { frames: [] } }, frames, boxes, core, nodes, out, measure);
  }

  const sides = dict(), height = { right: 0, left: 0 };
  const linked = (id, side) => edges.filter(e => (groupOf(e.from) === id && sides[groupOf(e.to)] === side)
    || (groupOf(e.to) === id && sides[groupOf(e.from)] === side)).length;
  for (const f of frames) {
    const right = linked(f.id, 'right'), left = linked(f.id, 'left');
    const side = (previous.sides && hasKey(previous.sides, f.id) ? previous.sides[f.id] : '')
      || (right !== left ? (right > left ? 'right' : 'left') : height.right <= height.left ? 'right' : 'left');
    sides[f.id] = side;
    height[side] += f.h + STACK_GAP;
  }
  const inner = new Set(out.edges.map(e => e.id).concat(frames.flatMap(f => f.b.links.map(l => l.id))));
  const crossing = edges.filter(e => !inner.has(e.id));

  const place = (gap) => {
    const top = { right: core.h / 2 - (height.right - STACK_GAP) / 2, left: core.h / 2 - (height.left - STACK_GAP) / 2 };
    const placedFrames = dict(), placedNodes = Object.assign(dict(), nodes), links = [];
    for (const f of frames) {
      const side = sides[f.id];
      const x = Math.round(side === 'right' ? core.w + gap.right : -gap.left - f.w), y = Math.round(top[side]);
      top[side] += f.h + STACK_GAP;
      const { b, ...frame } = f;
      placedFrames[f.id] = { ...frame, x, y, side };
      const ox = x + FRAME_PAD + (f.w - FRAME_PAD * 2 - b.w) / 2, oy = y + f.head;
      for (const [id, q] of Object.entries(b.nodes)) placedNodes[id] = { ...boxes[id], id, x: r1(ox + q.x), y: r1(oy + q.y), frame: f.id };
      for (const l of b.links) {
        links.push({
          id: l.id, d: smooth(l.points.map(q => ({ x: q.x + ox, y: q.y + oy })), l.cubic), frame: f.id,
          label: l.label && { ...l.label, x: r1(l.label.x + ox), y: r1(l.label.y + oy) },
        });
      }
    }
    const obstacles = [...Object.values(placedNodes).map(n => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h })),
      ...Object.values(placedFrames).map(f => ({ x: f.x, y: f.y, w: f.w, h: f.head - 6 })),
      ...[...out.edges, ...links].filter(e => e.label).map(e => e.label)];
    return { frames: placedFrames, nodes: placedNodes, links, obstacles };
  };

  const route = (at, gap) => {
    const region = n => (n.frame ? sides[n.frame] : 'core');
    const channels = { right: { x0: core.w, x1: core.w + gap.right, lanes: [] }, left: { x0: -gap.left, x1: 0, lanes: [] } };
    if (!core.w) channels.left = channels.right = { x0: -gap.left, x1: gap.right, lanes: [] };
    const groupEdge = (n, dir) => (n.frame ? (dir > 0 ? at.frames[n.frame].x + at.frames[n.frame].w + 4 : at.frames[n.frame].x - 4) : (dir > 0 ? core.w + 4 : -4));
    const facing = (n, channel) => (region(n) === 'core' ? (channel === 'right' ? 1 : -1) : region(n) === 'right' ? -1 : 1);
    let over = 0, under = 0;
    const plans = crossing.map(e => {
      const A = at.nodes[e.from], B = at.nodes[e.to], ra = region(A), rb = region(B);
      const path = ra === rb || ra === 'core' || rb === 'core' || !core.w ? [ra === 'core' ? rb : ra] : [ra, rb];
      const a = approach(A, facing(A, path[0]), groupEdge(A, facing(A, path[0])), at.obstacles);
      const b = approach(B, facing(B, path[path.length - 1]), groupEdge(B, facing(B, path[path.length - 1])), at.obstacles);
      const ya = a[a.length - 1].y, yb = b[b.length - 1].y;
      let yc = null;
      if (path.length === 2) {
        const up = -18 - 9 * over, down = core.h + 18 + 9 * under;
        if (Math.abs(ya - up) + Math.abs(yb - up) <= Math.abs(ya - down) + Math.abs(yb - down)) { yc = up; over++; } else { yc = down; under++; }
      }
      const spans = path.length === 2 ? [[ya, yc], [yc, yb]] : [[ya, yb]];
      return { e, path, a, b, spans: spans.map(([p, q], i) => ({ channel: path[i], from: Math.min(p, q), to: Math.max(p, q) })), ya, yb, yc };
    });
    for (const span of plans.flatMap(p => p.spans).sort((a, b) => a.from - b.from)) {
      const lanes = channels[span.channel].lanes;
      let lane = lanes.findIndex(end => end + 14 < span.from);
      if (lane < 0) { lane = lanes.length; lanes.push(0); }
      lanes[lane] = span.to;
      span.lane = lane;
    }
    const laneX = (channel, lane) => {
      const c = channels[channel], n = c.lanes.length, step = Math.min(12, (c.x1 - c.x0 - 28) / Math.max(1, n - 1));
      return (c.x0 + c.x1) / 2 - (n - 1) * step / 2 + lane * step;
    };
    const placed = [], routes = [];
    for (const p of plans) {
      const xs = p.spans.map(sp => laneX(sp.channel, sp.lane));
      const middle = p.yc === null ? [{ x: xs[0], y: p.ya }, { x: xs[0], y: p.yb }]
        : [{ x: xs[0], y: p.ya }, { x: xs[0], y: p.yc }, { x: xs[1], y: p.yc }, { x: xs[1], y: p.yb }];
      const line = rounded([...p.a, ...middle, ...[...p.b].reverse()]);
      const label = edgeLabel(p.e.label, measure);
      routes.push({
        id: p.e.id, d: line.d, frame: '', cross: true, points: line.points,
        label: label && placeLabel(label, line.points, at.obstacles, placed),
      });
    }
    return { routes, placed, lanes: { right: channels.right.lanes.length, left: channels.left.lanes.length } };
  };

  const baseGap = core.w ? 56 : 13;
  const sized = lanes => (lanes ? Math.min(180, 70 + (lanes - 1) * 12) : baseGap) / (core.w ? 1 : 2);
  let gap = { right: 90, left: 90 };
  let at = place(gap), routed = route(at, gap);
  gap = core.w ? { right: sized(routed.lanes.right), left: sized(routed.lanes.left) }
    : { right: sized(routed.lanes.right), left: sized(routed.lanes.right) };
  at = place(gap);
  routed = route(at, gap);
  Object.assign(nodes, at.nodes);
  out.frames = at.frames;
  out.edges.push(...at.links, ...routed.routes);
  for (const e of out.edges) Object.assign(e, { kind: edgeById[e.id].kind || 'rel', from: edgeById[e.id].from, to: edgeById[e.id].to });

  const extents = [...Object.values(nodes), ...Object.values(out.frames), ...routed.placed,
    ...routed.routes.flatMap(r => r.points.map(q => ({ ...q, w: 0, h: 0 })))];
  out.bounds = extents.length ? {
    minX: Math.min(...extents.map(b => b.x)), minY: Math.min(...extents.map(b => b.y)),
    maxX: Math.max(...extents.map(b => b.x + b.w)), maxY: Math.max(...extents.map(b => b.y + b.h)),
  } : { minX: -100, minY: -100, maxX: 100, maxY: 100 };
  out.core = core.w ? { x: 0, y: 0, w: core.w, h: core.h } : null;
  out.memory = { sides };
  return out;
}

function treeLayout(map, frames, boxes, core, coreNodes, out, measure) {
  const tree = map.tree, byId = fromPairs(frames.map(f => [f.id, f]));
  const info = fromPairs((tree.frames || []).filter(f => f && hasKey(byId, f.id)).map(f => [f.id, f]));
  const hubs = (tree.hubs || []).filter(h => h && (h.frames || []).some(id => info[id]?.hub === h.id));
  const hubSet = new Set(hubs.map(h => h.id));

  // Guard against parent cycles in untrusted payloads.
  const hasCycle = (start, next) => {
    const seen = new Set([start]);
    let cur = next;
    while (cur && hasKey(byId, cur)) {
      if (seen.has(cur)) return true;
      seen.add(cur);
      cur = info[cur]?.parent || '';
    }
    return false;
  };
  const parentOf = id => {
    const p = info[id]?.parent;
    return p && p !== id && hasKey(byId, p) && !hasCycle(id, p) ? p : '';
  };
  const hubOf = id => (!parentOf(id) && hubSet.has(info[id]?.hub) ? info[id].hub : '');

  const titleLines = wrap(map.title || '', FONT.rootTitle, ROOT_W - 32, 2, measure);
  const thread = wrap(tree.thread || map.gist || '', FONT.card, ROOT_W - 32, 3, measure);
  const titleExtra = Math.max(0, titleLines.length - 1) * FONT.rootTitle.lh;
  const rootH = Math.max(46 + titleExtra + thread.length * 17, core.w ? core.h + 20 : 0);
  const rootW = ROOT_W + (core.w ? core.w + 28 : 0);

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 34, ranksep: 72, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  const tk = id => (id === '__root' ? 'r:__root' : `t:${id}`);
  const untk = k => (k === 'r:__root' ? '__root' : k.slice(2));
  g.setNode(tk('__root'), { width: rootW, height: rootH });
  for (const h of hubs) g.setNode(tk(h.id), { width: Math.ceil(measure(h.label, 13, 700) + 44), height: HUB_H });
  for (const f of frames) g.setNode(tk(f.id), { width: f.w, height: f.h });
  for (const h of hubs) g.setEdge(tk('__root'), tk(h.id));
  for (const f of frames) g.setEdge(tk(parentOf(f.id) || hubOf(f.id) || '__root'), tk(f.id));
  dagre.layout(g);

  const rows = dict();
  for (const id of g.nodes()) {
    const v = g.node(id), r = rows[Math.round(v.y)] ||= { top: v.y, bottom: v.y };
    r.top = Math.min(r.top, v.y - v.height / 2);
    r.bottom = Math.max(r.bottom, v.y + v.height / 2);
  }
  const rowOf = id => rows[Math.round(g.node(tk(id)).y)];
  const at = id => { const v = g.node(tk(id)); return { x: Math.round(v.x - v.width / 2), y: Math.round(rowOf(id).top), w: v.width, h: v.height }; };

  const tops = g.successors(tk('__root')).sort((a, b) => g.node(a).x - g.node(b).x).map(untk);
  const color = fromPairs(tops.map((id, i) => [id, BRANCH[i % BRANCH.length]]));
  const colorOf = (id, seen = new Set()) => {
    if (hasKey(color, id)) return color[id];
    if (seen.has(id)) return BRANCH[0];
    seen.add(id);
    return (color[id] = colorOf(parentOf(id) || hubOf(id) || tops[0], seen));
  };

  const root = at('__root'), cx = root.x + ROOT_W + 28, cy = root.y + 10;
  out.tree = {
    root: { ...root, title: map.title || '', titleLines, lines: thread, linesY: 50 + titleExtra, coreX: ROOT_W + 28 },
    hubs: [],
    branches: [],
  };
  for (const [id, q] of Object.entries(coreNodes)) out.nodes[id] = { ...q, x: r1(cx + q.x), y: r1(cy + q.y) };
  out.edges = core.links.map(l => ({
    id: l.id, d: smooth(l.points.map(q => ({ x: q.x + cx, y: q.y + cy })), l.cubic), frame: '',
    label: l.label && { ...l.label, x: r1(l.label.x + cx), y: r1(l.label.y + cy) },
  }));
  for (const h of hubs) out.tree.hubs.push({ ...at(h.id), id: h.id, label: h.label, color: colorOf(h.id) });
  for (const f of frames) {
    const { b, ...frame } = f, p = at(f.id);
    out.frames[f.id] = { ...frame, x: p.x, y: p.y, side: '', color: colorOf(f.id) };
    const ox = p.x + FRAME_PAD + (f.w - FRAME_PAD * 2 - b.w) / 2, oy = p.y + f.head;
    for (const [id, q] of Object.entries(b.nodes)) out.nodes[id] = { ...boxes[id], id, x: r1(ox + q.x), y: r1(oy + q.y), frame: f.id };
    for (const l of b.links) {
      out.edges.push({
        id: l.id, d: smooth(l.points.map(q => ({ x: q.x + ox, y: q.y + oy })), l.cubic), frame: f.id,
        label: l.label && { ...l.label, x: r1(l.label.x + ox), y: r1(l.label.y + oy) },
      });
    }
  }

  const blocks = [...frames.map(f => ({ id: f.id, ...at(f.id) })), ...hubs.map(h => ({ id: h.id, ...at(h.id) })), { id: '__root', ...root }];
  const point = ([p, q, s, z], t) => {
    const u = 1 - t, k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    return { x: k[0] * p.x + k[1] * q.x + k[2] * s.x + k[3] * z.x, y: k[0] * p.y + k[1] * q.y + k[2] * s.y + k[3] * z.y };
  };
  const placed = [];
  for (const edge of g.edges()) {
    const ev = untk(edge.v), ew = untk(edge.w);
    const a = at(ev), c = at(ew), col = colorOf(ew);
    const x1 = a.x + a.w / 2, x2 = c.x + c.w / 2, y2 = c.y;
    const shape = y1 => {
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, bx = x2 - dx / len * ARROW, by = y2 - dy / len * ARROW;
      return [{ x: x1, y: y1 }, { x: x1, y: y1 + dy * 0.55 }, { x: bx - dx * 0.3, y: by - dy * 0.3 }, { x: bx, y: by }];
    };
    const crosses = q => Array.from({ length: 25 }, (_, k) => point(q, k / 24)).some(p => blocks.some(o => o.id !== ev && o.id !== ew
      && p.x > o.x + 1 && p.x < o.x + o.w - 1 && p.y > o.y + 1 && p.y < o.y + o.h - 1));
    const stem = crosses(shape(a.y + a.h)) ? rowOf(ev).bottom : null;
    const cpts = shape(stem ?? a.y + a.h), [, c1, c2, z] = cpts;
    const d = `M${r1(x1)} ${r1(a.y + a.h)}${stem === null ? '' : `L${r1(x1)} ${r1(stem)}`}`
      + `C${r1(c1.x)} ${r1(c1.y)} ${r1(c2.x)} ${r1(c2.y)} ${r1(z.x)} ${r1(z.y)}`;
    const rel = info[ew]?.parent === ev ? info[ew].rel : '';
    const label = rel ? { text: rel, w: Math.ceil(measure(rel, 11.5, 700) + 20), h: PILL_H } : null;
    if (label) {
      const spot = t => { const p = point(cpts, t); return { x: r1(p.x - label.w / 2), y: r1(p.y - PILL_H / 2), w: label.w, h: PILL_H }; };
      const free = q => ![...blocks, ...placed].some(o => hit(q.x - 2, q.y - 2, q.w + 4, q.h + 4, o));
      const box = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8].map(spot).find(free) || spot(0.5);
      placed.push(box);
      Object.assign(label, { x: box.x, y: box.y });
    }
    out.tree.branches.push({ id: `${ev}>${ew}`, d, tip: { x: r1(x2), y: r1(y2) }, color: col, label, hub: hubSet.has(ew) });
  }

  const edgeById = fromPairs((map.edges || []).map(e => [e.id, e]));
  out.edges = out.edges.filter(e => hasKey(edgeById, e.id));
  for (const e of out.edges) Object.assign(e, { kind: edgeById[e.id].kind || 'rel', from: edgeById[e.id].from, to: edgeById[e.id].to });
  const extents = [...Object.values(out.nodes), ...Object.values(out.frames), ...out.edges.filter(e => e.label).map(e => e.label),
    out.tree.root, ...out.tree.hubs, ...out.tree.branches.filter(b => b.label).map(b => b.label)];
  out.bounds = {
    minX: Math.min(...extents.map(b => b.x)), minY: Math.min(...extents.map(b => b.y)),
    maxX: Math.max(...extents.map(b => b.x + b.w)), maxY: Math.max(...extents.map(b => b.y + b.h)),
  };
  out.core = null;
  out.memory = { sides: {} };
  return out;
}

// ---------- Data adapters: native MeetCue map & partner { meeting, whole_diagram, diagrams } ----------
const cleanList = list => (Array.isArray(list) ? list.map(x => String(x || '').trim()).filter(Boolean) : []);
const normKind = k => {
  const s = String(k || '').trim().toLowerCase();
  return s in GLYPH ? s : 'concept';
};
const normEdgeKind = k => {
  const s = String(k || '').trim().toLowerCase();
  return EDGE_KINDS.includes(s) ? s : 'rel';
};
const normStatus = s => {
  const v = String(s || '').trim().toLowerCase();
  return ['active', 'upcoming', 'done', 'parked'].includes(v) ? v : '';
};

export function normalizeMapPayload(data = {}) {
  if (!data || typeof data !== 'object') return null;

  // Shape A: Native MeetCue map payload (data.map)
  if (data.map && typeof data.map === 'object' && (Array.isArray(data.map.topics) || Array.isArray(data.map.nodes))) {
    const m = data.map;
    const topics = (Array.isArray(m.topics) ? m.topics : [])
      .filter(t => t && (t.id || t.label))
      .map((t, i) => ({
        id: String(t.id ?? `t${i + 1}`),
        label: String(t.label || t.topic || `Topic ${i + 1}`).trim(),
        status: normStatus(t.status),
        sofar: cleanList(t.sofar),
        ahead: cleanList(t.ahead),
      }));
    const nodes = (Array.isArray(m.nodes) ? m.nodes : [])
      .filter(n => n && String(n.label || '').trim())
      .map((n, i) => ({
        id: String(n.id ?? `n${i + 1}`),
        label: String(n.label).trim(),
        kind: normKind(n.kind),
        note: String(n.note || '').trim(),
        topic: String(n.topic || '').trim(),
      }));
    const nodeIds = new Set(nodes.map(n => n.id));
    const edges = (Array.isArray(m.edges) ? m.edges : [])
      .filter(e => e && nodeIds.has(String(e.from)) && nodeIds.has(String(e.to)) && String(e.from) !== String(e.to))
      .map((e, i) => ({
        id: String(e.id ?? `e${i + 1}`),
        from: String(e.from),
        to: String(e.to),
        label: String(e.label || '').trim(),
        kind: normEdgeKind(e.kind),
      }));
    if (!topics.length && !nodes.length) return null;
    return {
      title: String(m.title || data.meeting?.title || 'Full meeting map').trim(),
      gist: String(m.gist || data.meeting?.gist || '').trim(),
      topics,
      nodes,
      edges,
      tree: m.tree && typeof m.tree === 'object' ? m.tree : null,
      items: Array.isArray(m.items) ? m.items : [],
    };
  }

  // Shape B: Partner API payload ({ meeting, whole_diagram, diagrams })
  const meeting = data.meeting || {};
  const whole = data.whole_diagram || null;
  const diagrams = Array.isArray(data.diagrams) ? data.diagrams : [];

  const topics = [];
  const topicById = new Map();
  const topicIdByLabel = new Map();
  const ensureTopic = (rawLabel, extra = {}) => {
    const label = String(rawLabel || '').trim();
    if (!label) return '';
    if (topicById.has(label)) return label;
    if (topicIdByLabel.has(label)) return topicIdByLabel.get(label);
    const id = String(extra.id || `t${topics.length + 1}`);
    const entry = {
      id,
      label,
      status: normStatus(extra.status),
      sofar: cleanList(extra.sofar),
      ahead: cleanList(extra.ahead),
    };
    topics.push(entry);
    topicById.set(id, entry);
    topicIdByLabel.set(label, id);
    return id;
  };

  for (const d of diagrams) {
    if (!d || typeof d !== 'object') continue;
    const hasNodes = Array.isArray(d.nodes) && d.nodes.some(n => n && String(n.label || '').trim());
    const hasText = cleanList(d.sofar).length || cleanList(d.ahead).length;
    if (!hasNodes && !hasText && !String(d.topic || d.label || '').trim()) continue;
    ensureTopic(d.topic || d.label || `Topic ${topics.length + 1}`, d);
  }

  const nodesById = new Map();
  // When whole_diagram explicitly sets topic: "" on a node, it is a core entity — never let per-topic copies overwrite it.
  const explicitCoreIds = new Set();
  // When whole_diagram is absent (legacy diagrams-only payload), MeetCue's partner.py repeats unassigned core nodes in every
  // topic diagram they link to; classify any unassigned node ID appearing in 2+ distinct topics as a core entity.
  const inferredCoreIds = new Set();
  if (!whole || !Array.isArray(whole.nodes) || !whole.nodes.length) {
    const topicsPerNode = new Map();
    for (const d of diagrams) {
      if (!d || !Array.isArray(d.nodes)) continue;
      const tid = topicIdByLabel.get(String(d.topic || d.label || '').trim()) || '';
      if (!tid) continue;
      for (const n of d.nodes) {
        if (!n || !String(n.label || '').trim()) continue;
        if (String(n.topic || '').trim()) continue;
        const id = String(n.id ?? '');
        if (!id) continue;
        let set = topicsPerNode.get(id);
        if (!set) { set = new Set(); topicsPerNode.set(id, set); }
        set.add(tid);
      }
    }
    for (const [id, set] of topicsPerNode) {
      if (set.size > 1) inferredCoreIds.add(id);
    }
  }

  const addNode = (n, fallbackTopicId = '', fromWhole = false) => {
    if (!n || !String(n.label || '').trim()) return;
    const id = String(n.id ?? `n${nodesById.size + 1}`);
    const rawTopic = String(n.topic || '').trim();
    if (fromWhole && !rawTopic) explicitCoreIds.add(id);
    const isCore = explicitCoreIds.has(id) || (!rawTopic && inferredCoreIds.has(id));
    const resolvedTopic = isCore ? '' : (rawTopic ? ensureTopic(rawTopic) : fallbackTopicId);
    if (!nodesById.has(id)) {
      nodesById.set(id, {
        id,
        label: String(n.label).trim(),
        kind: normKind(n.kind),
        note: String(n.note || '').trim(),
        topic: resolvedTopic,
      });
    } else if (!explicitCoreIds.has(id) && !inferredCoreIds.has(id) && !nodesById.get(id).topic && resolvedTopic) {
      nodesById.get(id).topic = resolvedTopic;
    }
  };

  if (whole && Array.isArray(whole.nodes)) {
    for (const n of whole.nodes) addNode(n, '', true);
  }
  for (const d of diagrams) {
    if (!d || !Array.isArray(d.nodes)) continue;
    const tid = topicIdByLabel.get(String(d.topic || d.label || '').trim()) || '';
    for (const n of d.nodes) addNode(n, tid, false);
  }

  const nodes = [...nodesById.values()];
  if (!topics.length && !nodes.length) return null;

  const edges = [];
  const edgeKeys = new Set();
  const addEdges = list => {
    for (const e of (Array.isArray(list) ? list : [])) {
      if (!e || e.from == null || e.to == null) continue;
      const from = String(e.from), to = String(e.to);
      if (from === to || !nodesById.has(from) || !nodesById.has(to)) continue;
      const label = String(e.label || '').trim();
      const kind = normEdgeKind(e.kind);
      const key = `${from}|${to}|${label}`;
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push({ id: String(e.id || `e${edges.length + 1}`), from, to, label, kind });
    }
  };
  if (whole && Array.isArray(whole.edges)) addEdges(whole.edges);
  for (const d of diagrams) if (d && Array.isArray(d.edges)) addEdges(d.edges);

  // Remap tree frame IDs if a tree on whole_diagram referenced topic labels instead of generated t1..tN IDs.
  let tree = whole?.tree && typeof whole.tree === 'object' ? whole.tree : null;
  if (tree) {
    const mapTopicRef = ref => {
      const s = String(ref || '').trim();
      if (!s) return '';
      if (topicById.has(s)) return s;
      return topicIdByLabel.get(s) || s;
    };
    tree = {
      thread: String(tree.thread || '').trim(),
      hubs: (Array.isArray(tree.hubs) ? tree.hubs : []).map(h => ({
        id: String(h.id || ''),
        label: String(h.label || '').trim(),
        frames: (Array.isArray(h.frames) ? h.frames : []).map(mapTopicRef),
      })),
      frames: (Array.isArray(tree.frames) ? tree.frames : []).map(f => ({
        id: mapTopicRef(f.id),
        ...(f.parent ? { parent: mapTopicRef(f.parent) } : {}),
        ...(f.hub ? { hub: String(f.hub) } : {}),
        ...(f.rel ? { rel: String(f.rel).trim() } : {}),
      })),
    };
  }

  return {
    title: String(meeting.title || whole?.topic || 'Full meeting map').trim(),
    gist: String(meeting.gist || '').trim(),
    topics,
    nodes,
    edges,
    tree,
    items: Array.isArray(whole?.items) ? whole.items : [],
  };
}

export function normalizeTopicDiagram(d, topicIndex = 0) {
  if (!d || typeof d !== 'object') return null;
  const rawNodes = (Array.isArray(d.nodes) ? d.nodes : []).filter(n => n && String(n.label || '').trim());
  const sofar = cleanList(d.sofar);
  const ahead = cleanList(d.ahead);
  if (!rawNodes.length && !sofar.length && !ahead.length) return null;
  const tid = String(d.id || `t${topicIndex + 1}`);
  const nodes = rawNodes.map((n, i) => ({
    id: String(n.id ?? `n${i + 1}`),
    label: String(n.label).trim(),
    kind: normKind(n.kind),
    note: String(n.note || '').trim(),
    topic: tid,
  }));
  const nodeIds = new Set(nodes.map(n => n.id));
  const edges = (Array.isArray(d.edges) ? d.edges : [])
    .filter(e => e && nodeIds.has(String(e.from)) && nodeIds.has(String(e.to)) && String(e.from) !== String(e.to))
    .map((e, i) => ({
      id: String(e.id ?? `e${i + 1}`),
      from: String(e.from),
      to: String(e.to),
      label: String(e.label || '').trim(),
      kind: normEdgeKind(e.kind),
    }));
  const color = typeof d.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(d.color)
    ? d.color
    : BRANCH[topicIndex % BRANCH.length];
  return {
    title: String(d.topic || d.label || `Topic ${topicIndex + 1}`).trim(),
    gist: '',
    topics: [{
      id: tid,
      label: String(d.topic || d.label || `Topic ${topicIndex + 1}`).trim(),
      status: normStatus(d.status),
      sofar,
      ahead,
      displayIndex: topicIndex,
      color,
    }],
    nodes,
    edges,
    tree: null,
    items: Array.isArray(d.items) ? d.items : [],
  };
}

// Extract per-topic breakdown diagrams, preferring native `data.map` (which preserves edge kinds,
// linked core party nodes, and digest-only topics) and falling back to legacy `data.diagrams`.
export function extractTopicDiagrams(data = {}) {
  const m = data?.map;
  if (m && typeof m === 'object' && Array.isArray(m.topics) && m.topics.length) {
    const rawNodes = (Array.isArray(m.nodes) ? m.nodes : []).filter(n => n && String(n.label || '').trim());
    const nodeById = new Map(rawNodes.map(n => [String(n.id), n]));
    const rawEdges = (Array.isArray(m.edges) ? m.edges : []).filter(e =>
      e && nodeById.has(String(e.from)) && nodeById.has(String(e.to)) && String(e.from) !== String(e.to));
    const items = Array.isArray(m.items) ? m.items : [];
    const out = [];
    for (const t of m.topics) {
      if (!t || (!t.id && !t.label)) continue;
      const tid = String(t.id ?? '');
      const ownIds = new Set(rawNodes.filter(n => String(n.topic || '') === tid).map(n => String(n.id)));
      const mine = new Set(ownIds);
      // Include core party nodes (topic == '') directly linked to this topic's own nodes, matching MeetCue partner.py.
      for (const e of rawEdges) {
        const a = String(e.from), b = String(e.to);
        if (ownIds.has(a) && !String(nodeById.get(b)?.topic || '').trim()) mine.add(b);
        else if (ownIds.has(b) && !String(nodeById.get(a)?.topic || '').trim()) mine.add(a);
      }
      const tNodes = rawNodes.filter(n => mine.has(String(n.id)));
      const tEdges = rawEdges.filter(e => mine.has(String(e.from)) && mine.has(String(e.to)));
      const sofar = cleanList(t.sofar);
      const ahead = cleanList(t.ahead);
      if (!tNodes.length && !sofar.length && !ahead.length) continue;
      out.push({
        id: tid,
        topic: String(t.label || t.topic || 'Topic').trim(),
        status: normStatus(t.status),
        sofar,
        ahead,
        nodes: tNodes,
        edges: tEdges,
        items,
      });
    }
    if (out.length) return out;
  }
  if (Array.isArray(data?.diagrams) && data.diagrams.length) {
    return data.diagrams.filter(d => d && typeof d === 'object' && (
      (Array.isArray(d.nodes) && d.nodes.some(n => n && String(n.label || '').trim()))
      || cleanList(d.sofar).length
      || cleanList(d.ahead).length
    ));
  }
  return [];
}

// ---------- Strict XML/HTML escaping ----------
export function escXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const safeToken = (s, fallback = '') => {
  const clean = String(s || '').replace(/[^a-zA-Z0-9_-]/g, '');
  return clean || fallback;
};
const safeColor = c => (typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : '');

function computeBadges(items) {
  const out = dict();
  for (const i of (Array.isArray(items) ? items : [])) {
    if (!i || !Array.isArray(i.about)) continue;
    for (const id of i.about) {
      const key = String(id);
      const b = out[key] ||= { open: 0, done: 0 };
      if (i.list === 'open' || (i.list === 'asks' && !i.done)) b.open++;
      if (i.list === 'decided') b.done++;
    }
  }
  return out;
}

// Whether a map carries a MeetCue topic tree (thread, frames, or hubs).
// MeetCue's phone app uses treeLayout (with the dark root card + thread) whenever a native tree is present,
// even when all topic frames are flat children of the root. Only tree-free legacy payloads fall back to columns.
export function hasNativeTree(map) {
  const tree = map?.tree;
  if (!tree || typeof tree !== 'object') return false;
  if (String(tree.thread || '').trim()) return true;
  const topicIds = new Set((map.topics || []).map(t => t && t.id).filter(Boolean));
  const frames = Array.isArray(tree.frames) ? tree.frames.filter(f => f && topicIds.has(f.id)) : [];
  if (frames.length > 0) return true;
  const hubs = Array.isArray(tree.hubs) ? tree.hubs : [];
  return hubs.some(h => h && Array.isArray(h.frames) && h.frames.some(id => topicIds.has(id)));
}

// Whether a map carries explicit multi-level tree hierarchy (hubs or parented frames).
export function hasTreeHierarchy(map) {
  const tree = map?.tree;
  if (!tree || typeof tree !== 'object') return false;
  const topicIds = new Set((map.topics || []).map(t => t && t.id).filter(Boolean));
  const frames = Array.isArray(tree.frames) ? tree.frames.filter(f => f && topicIds.has(f.id)) : [];
  if (frames.some(f => (f.parent && topicIds.has(f.parent) && f.parent !== f.id) || Boolean(f.hub))) return true;
  const hubs = Array.isArray(tree.hubs) ? tree.hubs : [];
  return hubs.some(h => h && Array.isArray(h.frames) && h.frames.some(id => topicIds.has(id)));
}

// ---------- SVG renderer (exact MeetCue MeetingCanvas.vue markup) ----------
export function renderMapSvg(map, options = {}) {
  if (!map) return { html: '', layout: null };
  const uid = safeToken(options.uid, 'm0');
  const explicitColumns = typeof options.columns === 'boolean';
  const useColumns = explicitColumns
    ? options.columns
    : Boolean(options.isWhole && (map.topics || []).length > 1 && !hasNativeTree(map));
  const interactive = options.interactive !== false;
  const measure = options.measure || createBrowserMeasure();
  const layout = layoutMap(map, { measure, columns: useColumns, words: options.words });
  const bounds = layout.bounds;
  if (!bounds || !Number.isFinite(bounds.minX)) return { html: '', layout };

  const pad = 16;
  const bw = Math.max(1, Math.ceil(bounds.maxX - bounds.minX));
  const bh = Math.max(1, Math.ceil(bounds.maxY - bounds.minY));
  const vbX = Math.floor(bounds.minX - pad);
  const vbY = Math.floor(bounds.minY - pad);
  const vbW = bw + pad * 2;
  const vbH = bh + pad * 2;

  const arrowId = c => `mm-branch-${c.slice(1)}-${uid}`;
  const defs = [
    ...EDGE_KINDS.map(k => `<marker id="mm-arrow-${k}-${uid}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 1L10 5L0 9z" class="mm-arrow k-${k}"/></marker>`),
    ...BRANCH.map(c => `<marker id="${arrowId(c)}" viewBox="0 0 10 10" refX="0" refY="5" markerUnits="userSpaceOnUse" markerWidth="${ARROW}" markerHeight="${ARROW}" orient="auto"><path d="M0 1.2L10 5L0 8.8z" fill="${c}"/></marker>`),
  ].join('');

  const parts = [];
  const tree = layout.tree || null;
  if (tree) {
    for (const b of tree.branches) {
      const col = safeColor(b.color) || BRANCH[0];
      parts.push(`<path class="mm-branch" d="${escXml(b.d)}" style="stroke:${col}" marker-end="url(#${arrowId(col)})"/>`);
    }
    const r = tree.root;
    const titleLines = Array.isArray(r.titleLines) && r.titleLines.length ? r.titleLines : [r.title || ''];
    const titleSvg = titleLines.map((line, i) => `<text class="mm-root-title" x="16" y="${27 + i * FONT.rootTitle.lh}">${escXml(line)}</text>`).join('');
    const linesY = Number.isFinite(r.linesY) ? r.linesY : 50;
    const threadSvg = (r.lines || []).map((line, i) => `<text class="mm-root-line" x="16" y="${linesY + i * 17}">${escXml(line)}</text>`).join('');
    parts.push(`<g class="mm-root" transform="translate(${r.x} ${r.y})"><rect width="${r.w}" height="${r.h}" rx="18"/>${titleSvg}${threadSvg}</g>`);
    for (const h of tree.hubs) {
      const col = safeColor(h.color) || BRANCH[0];
      parts.push(`<g class="mm-hub" transform="translate(${h.x} ${h.y})"><rect width="${h.w}" height="${h.h}" rx="17" style="stroke:${col}"/><circle cx="17" cy="17" r="5" style="fill:${col}"/><text x="30" y="21.5">${escXml(h.label)}</text></g>`);
    }
  }

  for (const f of Object.values(layout.frames)) {
    const st = safeToken(f.status, '');
    const col = safeColor(f.color);
    const rectAttr = col ? ` class="branch" style="stroke:${col}"` : '';
    const rowsSvg = f.rows.map(r => {
      if (r.t === 'rule') return `<line class="mm-rule" x1="${r.x1}" x2="${r.x2}" y1="${r.y}" y2="${r.y}"/>`;
      if (r.t === 'index') return `<g class="mm-frame-index" transform="translate(${r.x} ${r.y})"><circle r="10"/><text y="3.8">${escXml(r.text)}</text></g>`;
      if (r.t === 'status') return `<g class="mm-frame-status" transform="translate(${r.x} ${r.y})"><rect width="${r.w}" height="18" rx="9"/><text x="${r.w / 2}" y="12.6">${escXml(r.text)}</text></g>`;
      if (r.t === 'mark') return `<g class="mm-mark ${r.kind === 'done' ? 'done' : 'ask'}" transform="translate(${r.x} ${r.y})"><circle r="6.5"/><text y="3.4">${r.kind === 'done' ? '✓' : '?'}</text></g>`;
      if (r.t === 'card') return `<text class="mm-card ${r.kind === 'done' ? 'done' : 'ask'}" x="${r.x}" y="${r.y}">${escXml(r.text)}</text>`;
      return `<text class="mm-frame-title" x="${r.x}" y="${r.y}">${escXml(r.text)}</text>`;
    }).join('');
    const frameTab = interactive ? ' tabindex="0"' : '';
    parts.push(`<g class="mm-frame${st ? ` st-${st}` : ''}" data-frame="${escXml(f.id)}" data-fx="${f.x}" data-fy="${f.y}" data-fw="${f.w}" data-fh="${f.h}" transform="translate(${f.x} ${f.y})"${frameTab}><rect width="${f.w}" height="${f.h}" rx="16"${rectAttr}/>${rowsSvg}</g>`);
  }

  if (tree) {
    for (const b of tree.branches) {
      if (!b.label) continue;
      const col = safeColor(b.color) || BRANCH[0];
      parts.push(`<g class="mm-branch-label" transform="translate(${b.label.x} ${b.label.y})"><rect width="${b.label.w}" height="${b.label.h}" rx="11" style="stroke:${col}"/><text x="${b.label.w / 2}" y="15" style="fill:${col}">${escXml(b.label.text)}</text></g>`);
    }
  }

  for (const e of layout.edges) {
    const k = normEdgeKind(e.kind);
    parts.push(`<g class="mm-edge k-${k}${e.cross ? ' cross' : ''}" data-from="${escXml(e.from)}" data-to="${escXml(e.to)}"><path d="${escXml(e.d)}" marker-end="url(#mm-arrow-${k}-${uid})"/></g>`);
  }
  for (const e of layout.edges) {
    if (!e.label) continue;
    const k = normEdgeKind(e.kind);
    const linesSvg = e.label.lines.map((line, i) => `<text x="${e.label.w / 2}" y="${13 + i * 13}">${escXml(line)}</text>`).join('');
    parts.push(`<g class="mm-edge-label k-${k}" data-from="${escXml(e.from)}" data-to="${escXml(e.to)}" transform="translate(${e.label.x} ${e.label.y})"><rect width="${e.label.w}" height="${e.label.h}" rx="9"/>${linesSvg}</g>`);
  }

  const badges = computeBadges(map.items);
  const rawById = fromPairs((map.nodes || []).map(n => [String(n.id), n]));
  const glyphScale = ICON.size / 24;
  for (const n of Object.values(layout.nodes)) {
    const raw = (hasKey(rawById, n.id) ? rawById[n.id] : null) || {};
    const kind = normKind(raw.kind);
    const glyph = GLYPH[kind] || GLYPH.concept;
    const b = (hasKey(badges, n.id) ? badges[n.id] : null) || { open: 0, done: 0 };
    const rowsSvg = n.rows.map(r => `<text class="mm-${r.t}" x="${r.x}" y="${r.y}">${escXml(r.text)}</text>`).join('');
    const openBadge = b.open ? `<g class="mm-badge open" transform="translate(${n.w - 2} 2)"><circle r="8.5"/><text y="3.5">${escXml(b.open)}</text></g>` : '';
    const doneBadge = b.done ? `<g class="mm-badge done" transform="translate(${n.w - (b.open ? 21 : 2)} 2)"><circle r="8.5"/><text y="3.5">✓</text></g>` : '';
    const nodeA11y = interactive ? ' tabindex="0" aria-pressed="false"' : '';
    parts.push(`<g class="mm-node k-${kind}" data-node="${escXml(n.id)}" transform="translate(${n.x} ${n.y})" role="button"${nodeA11y} aria-label="${escXml(raw.label || '')}"><rect class="mm-node-box" width="${n.w}" height="${n.h}" rx="11"/><path class="mm-glyph" d="${glyph}" transform="translate(${ICON.x} ${ICON.y}) scale(${glyphScale})"/>${rowsSvg}${openBadge}${doneBadge}</g>`);
  }

  // Normalized adjacency list so node selection highlights every linked neighbor (matching MeetCue MeetingCanvas.vue:107),
  // even when treeLayout intentionally omits cross-topic SVG edges.
  const allEdgePairs = (map.edges || [])
    .filter(e => e && hasKey(rawById, String(e.from)) && hasKey(rawById, String(e.to)) && String(e.from) !== String(e.to))
    .map(e => [String(e.from), String(e.to)]);
  const adjAttr = interactive && allEdgePairs.length ? ` data-edges="${escXml(JSON.stringify(allEdgePairs))}"` : '';

  const ariaLabel = escXml(map.title || 'Meeting diagram');
  const stageClass = options.isWhole ? 'mm-stage is-whole' : 'mm-stage is-topic';
  const stageHeight = options.isWhole
    ? Math.max(400, Math.min(620, bh + 64))
    : Math.max(200, Math.min(460, bh + 44));

  const controlsHtml = interactive ? `<div class="mm-zoom" aria-label="Map controls">
    <button type="button" data-mm-act="zoom-in" aria-label="Zoom in" title="Zoom in"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>
    <button type="button" data-mm-act="zoom-out" aria-label="Zoom out" title="Zoom out"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/></svg></button>
    <button type="button" data-mm-act="fit" class="on" aria-label="Fit map" title="Fit map"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg></button>
  </div>` : '';

  const svg = interactive
    ? `<div class="${stageClass}" data-mc-map="1" data-minx="${r1(bounds.minX)}" data-miny="${r1(bounds.minY)}" data-maxx="${r1(bounds.maxX)}" data-maxy="${r1(bounds.maxY)}"${adjAttr} style="height:${stageHeight}px">
        <div class="mm-canvas">
          <svg xmlns="http://www.w3.org/2000/svg" class="mm-svg" width="100%" height="100%" role="img" aria-label="${ariaLabel}">
            <defs>${defs}</defs>
            <g class="mm-world">${parts.join('')}</g>
          </svg>
          ${controlsHtml}
        </div>
      </div>`
    : `<div class="${stageClass} is-static">
        <svg xmlns="http://www.w3.org/2000/svg" class="mm-svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="${vbW}" height="${vbH}" role="img" aria-label="${ariaLabel}">
          <defs>${defs}</defs>
          <g class="mm-world">${parts.join('')}</g>
        </svg>
      </div>`;

  return { html: svg, layout };
}

// ---------- Safe DOM-only renderer (zero innerHTML; builds exact same MeetCue SVG & controls) ----------
const SVG_NS = 'http://www.w3.org/2000/svg';

export function renderMapDom(doc, map, options = {}) {
  if (!doc || !map) return { element: null, layout: null };
  const uid = safeToken(options.uid, 'm0');
  const explicitColumns = typeof options.columns === 'boolean';
  const useColumns = explicitColumns
    ? options.columns
    : Boolean(options.isWhole && (map.topics || []).length > 1 && !hasNativeTree(map));
  const interactive = options.interactive !== false;
  const measure = options.measure || createBrowserMeasure();
  const layout = layoutMap(map, { measure, columns: useColumns, words: options.words });
  const bounds = layout.bounds;
  if (!bounds || !Number.isFinite(bounds.minX)) return { element: null, layout };

  const el = (tag, attrs = {}, ...children) => {
    const node = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'text') node.textContent = String(v);
      else if (k === 'class') { node.className = String(v); node.setAttribute('class', String(v)); }
      else node.setAttribute(k, v === true ? '' : String(v));
    }
    for (const child of children.flat()) if (child != null && child !== false) node.append(child);
    return node;
  };
  const svgEl = (tag, attrs = {}, ...children) => {
    const node = doc.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'text') node.textContent = String(v);
      else node.setAttribute(k, v === true ? '' : String(v));
    }
    for (const child of children.flat()) if (child != null && child !== false) node.append(child);
    return node;
  };

  const pad = 16;
  const bw = Math.max(1, Math.ceil(bounds.maxX - bounds.minX));
  const bh = Math.max(1, Math.ceil(bounds.maxY - bounds.minY));
  const vbX = Math.floor(bounds.minX - pad);
  const vbY = Math.floor(bounds.minY - pad);
  const vbW = bw + pad * 2;
  const vbH = bh + pad * 2;

  const arrowId = c => `mm-branch-${c.slice(1)}-${uid}`;
  const defs = svgEl('defs', {},
    ...EDGE_KINDS.map(k => svgEl('marker', { id: `mm-arrow-${k}-${uid}`, viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto' },
      svgEl('path', { d: 'M0 1L10 5L0 9z', class: `mm-arrow k-${k}` }))),
    ...BRANCH.map(c => svgEl('marker', { id: arrowId(c), viewBox: '0 0 10 10', refX: '0', refY: '5', markerUnits: 'userSpaceOnUse', markerWidth: String(ARROW), markerHeight: String(ARROW), orient: 'auto' },
      svgEl('path', { d: 'M0 1.2L10 5L0 8.8z', fill: c }))),
  );

  const world = svgEl('g', { class: 'mm-world' });
  const tree = layout.tree || null;
  if (tree) {
    for (const b of tree.branches) {
      const col = safeColor(b.color) || BRANCH[0];
      world.append(svgEl('path', { class: 'mm-branch', d: b.d, style: `stroke:${col}`, 'marker-end': `url(#${arrowId(col)})` }));
    }
    const r = tree.root;
    const titleLines = Array.isArray(r.titleLines) && r.titleLines.length ? r.titleLines : [r.title || ''];
    const linesY = Number.isFinite(r.linesY) ? r.linesY : 50;
    world.append(svgEl('g', { class: 'mm-root', transform: `translate(${r.x} ${r.y})` },
      svgEl('rect', { width: String(r.w), height: String(r.h), rx: '18' }),
      ...titleLines.map((line, i) => svgEl('text', { class: 'mm-root-title', x: '16', y: String(27 + i * FONT.rootTitle.lh), text: line })),
      ...(r.lines || []).map((line, i) => svgEl('text', { class: 'mm-root-line', x: '16', y: String(linesY + i * 17), text: line })),
    ));
    for (const h of tree.hubs) {
      const col = safeColor(h.color) || BRANCH[0];
      world.append(svgEl('g', { class: 'mm-hub', transform: `translate(${h.x} ${h.y})` },
        svgEl('rect', { width: String(h.w), height: String(h.h), rx: '17', style: `stroke:${col}` }),
        svgEl('circle', { cx: '17', cy: '17', r: '5', style: `fill:${col}` }),
        svgEl('text', { x: '30', y: '21.5', text: h.label }),
      ));
    }
  }

  for (const f of Object.values(layout.frames)) {
    const st = safeToken(f.status, '');
    const col = safeColor(f.color);
    const frameAttrs = {
      class: `mm-frame${st ? ` st-${st}` : ''}`,
      'data-frame': f.id,
      'data-fx': String(f.x),
      'data-fy': String(f.y),
      'data-fw': String(f.w),
      'data-fh': String(f.h),
      transform: `translate(${f.x} ${f.y})`,
      ...(interactive ? { tabindex: '0' } : {}),
    };
    const frameGroup = svgEl('g', frameAttrs,
      svgEl('rect', { width: String(f.w), height: String(f.h), rx: '16', ...(col ? { class: 'branch', style: `stroke:${col}` } : {}) }),
    );
    for (const row of f.rows) {
      if (row.t === 'rule') frameGroup.append(svgEl('line', { class: 'mm-rule', x1: String(row.x1), x2: String(row.x2), y1: String(row.y), y2: String(row.y) }));
      else if (row.t === 'index') frameGroup.append(svgEl('g', { class: 'mm-frame-index', transform: `translate(${row.x} ${row.y})` }, svgEl('circle', { r: '10' }), svgEl('text', { y: '3.8', text: row.text })));
      else if (row.t === 'status') frameGroup.append(svgEl('g', { class: 'mm-frame-status', transform: `translate(${row.x} ${row.y})` }, svgEl('rect', { width: String(row.w), height: '18', rx: '9' }), svgEl('text', { x: String(row.w / 2), y: '12.6', text: row.text })));
      else if (row.t === 'mark') frameGroup.append(svgEl('g', { class: `mm-mark ${row.kind === 'done' ? 'done' : 'ask'}`, transform: `translate(${row.x} ${row.y})` }, svgEl('circle', { r: '6.5' }), svgEl('text', { y: '3.4', text: row.kind === 'done' ? '✓' : '?' })));
      else if (row.t === 'card') frameGroup.append(svgEl('text', { class: `mm-card ${row.kind === 'done' ? 'done' : 'ask'}`, x: String(row.x), y: String(row.y), text: row.text }));
      else frameGroup.append(svgEl('text', { class: 'mm-frame-title', x: String(row.x), y: String(row.y), text: row.text }));
    }
    world.append(frameGroup);
  }

  if (tree) {
    for (const b of tree.branches) {
      if (!b.label) continue;
      const col = safeColor(b.color) || BRANCH[0];
      world.append(svgEl('g', { class: 'mm-branch-label', transform: `translate(${b.label.x} ${b.label.y})` },
        svgEl('rect', { width: String(b.label.w), height: String(b.label.h), rx: '11', style: `stroke:${col}` }),
        svgEl('text', { x: String(b.label.w / 2), y: '15', style: `fill:${col}`, text: b.label.text }),
      ));
    }
  }

  for (const e of layout.edges) {
    const k = normEdgeKind(e.kind);
    world.append(svgEl('g', { class: `mm-edge k-${k}${e.cross ? ' cross' : ''}`, 'data-from': e.from, 'data-to': e.to },
      svgEl('path', { d: e.d, 'marker-end': `url(#mm-arrow-${k}-${uid})` })));
  }
  for (const e of layout.edges) {
    if (!e.label) continue;
    const k = normEdgeKind(e.kind);
    world.append(svgEl('g', { class: `mm-edge-label k-${k}`, 'data-from': e.from, 'data-to': e.to, transform: `translate(${e.label.x} ${e.label.y})` },
      svgEl('rect', { width: String(e.label.w), height: String(e.label.h), rx: '9' }),
      ...e.label.lines.map((line, i) => svgEl('text', { x: String(e.label.w / 2), y: String(13 + i * 13), text: line })),
    ));
  }

  const badges = computeBadges(map.items);
  const rawById = fromPairs((map.nodes || []).map(n => [String(n.id), n]));
  const glyphScale = ICON.size / 24;
  for (const n of Object.values(layout.nodes)) {
    const raw = (hasKey(rawById, n.id) ? rawById[n.id] : null) || {};
    const kind = normKind(raw.kind);
    const glyph = GLYPH[kind] || GLYPH.concept;
    const b = (hasKey(badges, n.id) ? badges[n.id] : null) || { open: 0, done: 0 };
    const nodeGroup = svgEl('g', {
      class: `mm-node k-${kind}`,
      'data-node': n.id,
      transform: `translate(${n.x} ${n.y})`,
      role: 'button',
      'aria-label': raw.label || '',
      ...(interactive ? { tabindex: '0', 'aria-pressed': 'false' } : {}),
    },
      svgEl('rect', { class: 'mm-node-box', width: String(n.w), height: String(n.h), rx: '11' }),
      svgEl('path', { class: 'mm-glyph', d: glyph, transform: `translate(${ICON.x} ${ICON.y}) scale(${glyphScale})` }),
      ...n.rows.map(row => svgEl('text', { class: `mm-${row.t}`, x: String(row.x), y: String(row.y), text: row.text })),
    );
    if (b.open) nodeGroup.append(svgEl('g', { class: 'mm-badge open', transform: `translate(${n.w - 2} 2)` }, svgEl('circle', { r: '8.5' }), svgEl('text', { y: '3.5', text: String(b.open) })));
    if (b.done) nodeGroup.append(svgEl('g', { class: 'mm-badge done', transform: `translate(${n.w - (b.open ? 21 : 2)} 2)` }, svgEl('circle', { r: '8.5' }), svgEl('text', { y: '3.5', text: '✓' })));
    world.append(nodeGroup);
  }

  const allEdgePairs = (map.edges || [])
    .filter(e => e && hasKey(rawById, String(e.from)) && hasKey(rawById, String(e.to)) && String(e.from) !== String(e.to))
    .map(e => [String(e.from), String(e.to)]);
  const ariaLabel = map.title || 'Meeting diagram';
  const stageClass = options.isWhole ? 'mm-stage is-whole' : 'mm-stage is-topic';
  const stageHeight = options.isWhole
    ? Math.max(400, Math.min(620, bh + 64))
    : Math.max(200, Math.min(460, bh + 44));
  const labels = options.labels || {};

  if (!interactive) {
    const svg = svgEl('svg', {
      class: 'mm-svg',
      viewBox: `${vbX} ${vbY} ${vbW} ${vbH}`,
      width: String(vbW),
      height: String(vbH),
      role: 'img',
      'aria-label': ariaLabel,
    }, defs, world);
    return { element: el('div', { class: `${stageClass} is-static` }, svg), layout };
  }

  const svg = svgEl('svg', {
    class: 'mm-svg',
    width: '100%',
    height: '100%',
    role: 'img',
    'aria-label': ariaLabel,
  }, defs, world);

  const zoomInIcon = svgEl('svg', { width: '16', height: '16', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'aria-hidden': 'true' },
    svgEl('path', { d: 'M12 5v14M5 12h14' }));
  const zoomOutIcon = svgEl('svg', { width: '16', height: '16', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'aria-hidden': 'true' },
    svgEl('path', { d: 'M5 12h14' }));
  const fitIcon = svgEl('svg', { width: '15', height: '15', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
    svgEl('polyline', { points: '15 3 21 3 21 9' }),
    svgEl('polyline', { points: '9 21 3 21 3 15' }),
    svgEl('line', { x1: '21', y1: '3', x2: '14', y2: '10' }),
    svgEl('line', { x1: '3', y1: '21', x2: '10', y2: '14' }));

  const controls = el('div', { class: 'mm-zoom', 'aria-label': labels.controls || 'Map controls' },
    el('button', { type: 'button', 'data-mm-act': 'zoom-in', 'aria-label': labels.zoomIn || 'Zoom in', title: labels.zoomIn || 'Zoom in' }, zoomInIcon),
    el('button', { type: 'button', 'data-mm-act': 'zoom-out', 'aria-label': labels.zoomOut || 'Zoom out', title: labels.zoomOut || 'Zoom out' }, zoomOutIcon),
    el('button', { type: 'button', 'data-mm-act': 'fit', class: 'on', 'aria-label': labels.fit || 'Fit map', title: labels.fit || 'Fit map' }, fitIcon),
  );

  const stage = el('div', {
    class: stageClass,
    'data-mc-map': '1',
    'data-minx': String(r1(bounds.minX)),
    'data-miny': String(r1(bounds.minY)),
    'data-maxx': String(r1(bounds.maxX)),
    'data-maxy': String(r1(bounds.maxY)),
    ...(allEdgePairs.length ? { 'data-edges': JSON.stringify(allEdgePairs) } : {}),
    style: `height:${stageHeight}px`,
  }, el('div', { class: 'mm-canvas' }, svg, controls));
  return { element: stage, layout };
}

// ---------- Interactive MeetCue viewport controller (pan, zoom, fit, select, keyboard, double-click frame) ----------
export function mountMap(stage) {
  if (!stage || stage.__mmMounted) return null;
  const canvas = stage.querySelector('.mm-canvas');
  const svg = stage.querySelector('svg.mm-svg');
  const world = stage.querySelector('.mm-world');
  if (!canvas || !svg || !world) return null;

  const bounds = {
    minX: Number(stage.dataset.minx) || 0,
    minY: Number(stage.dataset.miny) || 0,
    maxX: Number(stage.dataset.maxx) || 300,
    maxY: Number(stage.dataset.maxy) || 200,
  };
  let normalizedEdges = null;
  if (stage.dataset.edges) {
    try {
      const parsed = JSON.parse(stage.dataset.edges);
      if (Array.isArray(parsed)) normalizedEdges = parsed;
    } catch { /* ignore malformed attribute */ }
  }

  const PAD = 18;
  const FIT_MAX_K = 1.15;
  const MANUAL_MAX_K = 3;
  const CONTROLS = 44;

  let view = { k: 1, x: 0, y: 0 };
  let autoFitted = true;
  let selectedId = null;
  let lastClickTime = 0;
  let lastClickFrame = null;
  const pointers = new Map();
  let gesture = null;

  const fitBtn = stage.querySelector('[data-mm-act="fit"]');

  const getSize = () => ({
    w: Math.max(120, canvas.clientWidth || stage.clientWidth || 640),
    h: Math.max(120, canvas.clientHeight || stage.clientHeight || 400),
  });

  const scaleFor = b => {
    const { w, h } = getSize();
    const availW = Math.max(40, w - CONTROLS - PAD * 2);
    const availH = Math.max(40, h - PAD * 2);
    const bw = Math.max(1, b.maxX - b.minX);
    const bh = Math.max(1, b.maxY - b.minY);
    return Math.min(availW / bw, availH / bh);
  };

  // Shared manual zoom floor across buttons, wheel, and pinch: never zooms IN when zooming out of a large map.
  const minZoom = () => Math.max(0.02, Math.min(0.2, scaleFor(bounds) * 0.75, view.k));

  const applyView = (immediate = false) => {
    if (immediate) canvas.classList.add('dragging');
    world.style.transform = `translate(${r1(view.x)}px, ${r1(view.y)}px) scale(${Math.round(view.k * 1000) / 1000})`;
    if (fitBtn) fitBtn.classList.toggle('on', autoFitted);
    if (immediate) {
      void world.getBoundingClientRect();
      canvas.classList.remove('dragging');
    }
  };

  const fitBox = (b, immediate = false, markAuto = true) => {
    const { w, h } = getSize();
    const availW = Math.max(80, w - CONTROLS);
    const bw = Math.max(1, b.maxX - b.minX);
    const bh = Math.max(1, b.maxY - b.minY);
    const k = Math.max(0.02, Math.min(FIT_MAX_K, scaleFor(b)));
    view = {
      k,
      x: availW / 2 - (b.minX + bw / 2) * k,
      y: h / 2 - (b.minY + bh / 2) * k,
    };
    autoFitted = markAuto;
    applyView(immediate);
  };

  const fitAll = (immediate = false) => fitBox(bounds, immediate, true);

  const zoomAt = (factor, cx, cy) => {
    const floor = Math.max(0.02, Math.min(0.2, scaleFor(bounds) * 0.75));
    const minK = factor < 1 ? Math.min(floor, view.k) : floor;
    const k = Math.max(minK, Math.min(MANUAL_MAX_K, view.k * factor));
    const f = k / view.k;
    view = { k, x: cx - (cx - view.x) * f, y: cy - (cy - view.y) * f };
    autoFitted = false;
    applyView(false);
  };

  const zoomBy = factor => {
    const { w, h } = getSize();
    zoomAt(factor, (w - CONTROLS) / 2, h / 2);
  };

  const selectNode = id => {
    selectedId = id && id !== selectedId ? id : null;
    const related = selectedId ? new Set([selectedId]) : null;
    const edgeEls = world.querySelectorAll('.mm-edge, .mm-edge-label');
    if (related) {
      if (normalizedEdges) {
        for (const pair of normalizedEdges) {
          if (!Array.isArray(pair)) continue;
          const [from, to] = pair;
          if (from === selectedId) related.add(to);
          if (to === selectedId) related.add(from);
        }
      }
      for (const el of world.querySelectorAll('.mm-edge')) {
        const from = el.getAttribute('data-from'), to = el.getAttribute('data-to');
        if (from === selectedId) related.add(to);
        if (to === selectedId) related.add(from);
      }
    }
    for (const el of world.querySelectorAll('.mm-node')) {
      const nid = el.getAttribute('data-node');
      const isSel = Boolean(selectedId && nid === selectedId);
      el.classList.toggle('sel', isSel);
      el.classList.toggle('dim', Boolean(related && !related.has(nid)));
      el.setAttribute('aria-pressed', isSel ? 'true' : 'false');
    }
    for (const el of edgeEls) {
      const from = el.getAttribute('data-from'), to = el.getAttribute('data-to');
      el.classList.toggle('dim', Boolean(related && !(related.has(from) && related.has(to))));
    }
  };

  const focusFrameEl = frameEl => {
    if (!frameEl) return;
    const fx = Number(frameEl.dataset.fx), fy = Number(frameEl.dataset.fy);
    const fw = Number(frameEl.dataset.fw), fh = Number(frameEl.dataset.fh);
    if (Number.isFinite(fx) && Number.isFinite(fy) && fw > 0 && fh > 0) {
      fitBox({ minX: fx, minY: fy, maxX: fx + fw, maxY: fy + fh }, false, false);
    }
  };

  const localPt = event => {
    const r = svg.getBoundingClientRect();
    return { x: event.clientX - r.left, y: event.clientY - r.top };
  };

  const onPointerDown = event => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    svg.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, localPt(event));
    const pts = [...pointers.values()];
    gesture = pts.length === 1
      ? { kind: 'pan', start: pts[0], view: { ...view }, moved: 0, at: Date.now(), target: event.target }
      : {
          kind: 'pinch',
          dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
          view: { ...view },
          mid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
          moved: 99,
        };
  };

  const onPointerMove = event => {
    if (!gesture || !pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, localPt(event));
    const pts = [...pointers.values()];
    if (gesture.kind === 'pan' && pts.length === 1) {
      const dx = pts[0].x - gesture.start.x, dy = pts[0].y - gesture.start.y;
      gesture.moved = Math.max(gesture.moved, Math.hypot(dx, dy));
      if (gesture.moved > 5) {
        canvas.classList.add('dragging');
        autoFitted = false;
        view = { ...gesture.view, x: gesture.view.x + dx, y: gesture.view.y + dy };
        applyView(false);
      }
    } else if (pts.length >= 2) {
      if (gesture.kind !== 'pinch') {
        gesture = {
          kind: 'pinch',
          dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
          view: { ...view },
          mid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
          moved: 99,
        };
      }
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const v = gesture.view;
      const k = Math.max(minZoom(), Math.min(MANUAL_MAX_K, v.k * dist / (gesture.dist || 1)));
      const f = k / v.k;
      canvas.classList.add('dragging');
      autoFitted = false;
      view = { k, x: mid.x - (gesture.mid.x - v.x) * f, y: mid.y - (gesture.mid.y - v.y) * f };
      applyView(false);
    }
  };

  const onPointerCancel = event => {
    pointers.delete(event.pointerId);
    if (!pointers.size) {
      gesture = null;
      canvas.classList.remove('dragging');
    }
  };

  const onPointerUp = event => {
    pointers.delete(event.pointerId);
    const g = gesture;
    if (pointers.size) return;
    gesture = null;
    canvas.classList.remove('dragging');
    if (!g || g.kind !== 'pan' || g.moved > 5 || Date.now() - g.at > 450) return;

    const nodeEl = g.target?.closest?.('[data-node]');
    if (nodeEl) {
      selectNode(nodeEl.getAttribute('data-node'));
      return;
    }

    const now = Date.now();
    const frameEl = g.target?.closest?.('[data-frame]');
    const frameId = frameEl?.getAttribute('data-frame') || null;
    if (now - lastClickTime < 340) {
      if (frameEl && frameId === lastClickFrame) {
        focusFrameEl(frameEl);
      } else {
        fitAll(false);
      }
      lastClickTime = 0;
      lastClickFrame = null;
      return;
    }
    if (selectedId) selectNode(null);
    lastClickTime = now;
    lastClickFrame = frameId;
  };

  const onKeyDown = event => {
    if (event.key === 'Escape') {
      if (selectedId) selectNode(null);
      else fitAll(false);
      return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const nodeEl = event.target?.closest?.('[data-node]');
    if (nodeEl) {
      event.preventDefault();
      selectNode(nodeEl.getAttribute('data-node'));
      return;
    }
    const frameEl = event.target?.closest?.('[data-frame]');
    if (frameEl && event.key === 'Enter') {
      event.preventDefault();
      focusFrameEl(frameEl);
    }
  };

  // Do not hijack normal vertical page scrolling unless Ctrl/Cmd is held (or trackpad pinch).
  const onWheel = event => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const pt = localPt(event);
    zoomAt(Math.exp(-event.deltaY * 0.0025), pt.x, pt.y);
  };

  svg.addEventListener('pointerdown', onPointerDown);
  svg.addEventListener('pointermove', onPointerMove);
  svg.addEventListener('pointerup', onPointerUp);
  svg.addEventListener('pointercancel', onPointerCancel);
  svg.addEventListener('keydown', onKeyDown);
  svg.addEventListener('wheel', onWheel, { passive: false });

  const btnCleanups = [];
  for (const btn of stage.querySelectorAll('[data-mm-act]')) {
    const onClick = e => {
      e.stopPropagation();
      const act = btn.getAttribute('data-mm-act');
      if (act === 'zoom-in') zoomBy(1.25);
      else if (act === 'zoom-out') zoomBy(0.8);
      else if (act === 'fit') fitAll(false);
    };
    btn.addEventListener('click', onClick);
    btnCleanups.push(() => btn.removeEventListener('click', onClick));
  }

  let ro = null;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(() => {
      if (autoFitted && stage.isConnected) fitAll(true);
    });
    ro.observe(canvas);
  }

  const destroy = () => {
    ro?.disconnect();
    ro = null;
    svg.removeEventListener('pointerdown', onPointerDown);
    svg.removeEventListener('pointermove', onPointerMove);
    svg.removeEventListener('pointerup', onPointerUp);
    svg.removeEventListener('pointercancel', onPointerCancel);
    svg.removeEventListener('keydown', onKeyDown);
    svg.removeEventListener('wheel', onWheel);
    for (const off of btnCleanups) off();
    stage.__mmMounted = false;
    stage.__mmDestroy = null;
  };

  fitAll(true);
  stage.__mmMounted = true;
  stage.__mmDestroy = destroy;
  return { fitAll, fitBox, zoomBy, zoomAt, selectNode, getView: () => ({ ...view }), destroy };
}

export function unmountAll(root = typeof document !== 'undefined' ? document : null) {
  if (!root || typeof root.querySelectorAll !== 'function') return 0;
  let count = 0;
  for (const el of root.querySelectorAll('[data-mc-map="1"]')) {
    if (typeof el.__mmDestroy === 'function') {
      el.__mmDestroy();
      count++;
    }
  }
  return count;
}

export function mountAll(root = typeof document !== 'undefined' ? document : null) {
  if (!root || typeof root.querySelectorAll !== 'function') return 0;
  let count = 0;
  for (const el of root.querySelectorAll('[data-mc-map="1"]')) {
    if (!el.__mmMounted && mountMap(el)) count++;
  }
  return count;
}
