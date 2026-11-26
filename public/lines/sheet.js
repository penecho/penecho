// A drawable sheet. Content sits underneath; ink, shapes and notes sit on top and share its coordinates.
const INK_COLORS = ['#20242c', '#c94f3d', '#4f46e5', '#277a4c', '#c98a12'];
const NOTE_COLORS = ['#fff3bf', '#e4e7ff', '#dcf3e4', '#fde3dc'];

class Sheet {
  constructor(wrap, { marks, tool = 'cursor', tools, onChange, width = 1200, height = 800, blank = false }) {
    this.wrap = wrap; this.marks = marks; this.tool = tool; this.onChange = onChange;
    this.tools = tools;
    this.undoStack = []; this.redoStack = []; this.color = INK_COLORS[1]; this.size = 3.4;
    this.z = 1; this.tx = 0; this.ty = 0; this.cw = width; this.ch = height; this.blank = blank;
    this.stage = $('.sheet-stage', wrap); this.svg = $('.ink-layer', wrap); this.noteLayer = $('.note-layer', wrap);
    this.pointers = new Map(); this.selected = null; this.space = false;
    this.bind(); this.draw(); this.setTool(tool); requestAnimationFrame(() => this.fit());
  }
  apply() {
    this.stage.style.transform = `translate(${this.tx}px,${this.ty}px) scale(${this.z})`;
    const label = $('#zoomLabel'); if (label) label.textContent = Math.round(this.z * 100) + '%';
    if (this.blank) { this.wrap.style.backgroundSize = `${24 * this.z}px ${24 * this.z}px`; this.wrap.style.backgroundPosition = `${this.tx}px ${this.ty}px`; }
  }
  measure() {
    const c = $('.sheet-content', this.stage);
    if (c && !this.blank) { this.cw = c.offsetWidth; this.ch = c.offsetHeight; }
  }
  fit() {
    this.measure();
    // clientWidth ignores the zoom animation that may still be running on the page.
    const r = { width: this.wrap.clientWidth, height: this.wrap.clientHeight };
    if (!r.width) return;
    if (this.blank) {
      const b = this.bounds();
      const pad = 90, w = Math.max(240, b.w), h = Math.max(200, b.h);
      this.z = clamp(Math.min((r.width - pad * 2) / w, (r.height - pad * 2 - 40) / h), .2, 1.15);
      this.tx = (r.width - w * this.z) / 2 - b.x * this.z; this.ty = (r.height - 40 - h * this.z) / 2 - b.y * this.z;
    } else {
      this.z = clamp((r.width - (r.width < 700 ? 24 : 96)) / this.cw, .25, 1);
      this.tx = (r.width - this.cw * this.z) / 2; this.ty = 28;
    }
    this.apply();
  }
  bounds() {
    if (!this.marks.length) return { x: 0, y: 0, w: this.wrap.clientWidth || 800, h: (this.wrap.clientHeight || 600) };
    let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
    for (const m of this.marks) {
      if (m.pts) m.pts.forEach(p => { a = Math.min(a, p[0]); b = Math.min(b, p[1]); c = Math.max(c, p[0]); d = Math.max(d, p[1]); });
      else { a = Math.min(a, m.x); b = Math.min(b, m.y); c = Math.max(c, m.x + m.w); d = Math.max(d, m.y + m.h); }
    }
    return { x: a, y: b, w: c - a, h: d - b };
  }
  zoomAt(factor, cx, cy) {
    const z = typeof pageZoomScale === 'function' ? pageZoomScale() : 1, r = this.wrap.getBoundingClientRect(), x = (cx - r.left) / z, y = (cy - r.top) / z;
    const nz = clamp(this.z * factor, .2, 4);
    this.tx = x - (x - this.tx) * (nz / this.z); this.ty = y - (y - this.ty) * (nz / this.z);
    this.z = nz; this.apply();
  }
  zoomBy(f) { const r = this.wrap.getBoundingClientRect(); this.zoomAt(f, r.left + r.width / 2, r.top + r.height / 2); }
  world(e) { const z = typeof pageZoomScale === 'function' ? pageZoomScale() : 1, r = this.wrap.getBoundingClientRect(); return [((e.clientX - r.left) / z - this.tx) / this.z, ((e.clientY - r.top) / z - this.ty) / this.z]; }
  setTool(t) {
    if (this.tools && !this.tools.includes(t)) return;
    this.tool = t; this.wrap.dataset.tool = t; this.select(null);
    $$('.dock [data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
  }
  setColor(c) { this.color = c; $$('.dock [data-color]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.color === c))); }
  setSize(s) { this.size = s; $$('.dock [data-size]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.size === s))); }
  push(mark) { this.marks.push(mark); this.undoStack.push({ add: mark }); this.redoStack = []; this.changed(); }
  remove(mark) { const i = this.marks.indexOf(mark); if (i < 0) return; this.marks.splice(i, 1); this.undoStack.push({ del: mark, at: i }); this.redoStack = []; this.changed(); }
  changed() { this.draw(); this.onChange?.(); }
  undo() { const op = this.undoStack.pop(); if (!op) return; if (op.add) this.marks.splice(this.marks.indexOf(op.add), 1); else if (op.del) this.marks.splice(op.at, 0, op.del); else if (op.move) { op.mark.pts ? (op.mark.pts = op.before) : Object.assign(op.mark, op.before); } this.redoStack.push(op); this.changed(); }
  redo() { const op = this.redoStack.pop(); if (!op) return; if (op.add) this.marks.push(op.add); else if (op.del) this.marks.splice(this.marks.indexOf(op.del), 1); else if (op.move) { op.mark.pts ? (op.mark.pts = op.after) : Object.assign(op.mark, op.after); } this.undoStack.push(op); this.changed(); }
  markSVG(m) {
    const sel = this.selected === m ? ' selected' : '';
    if (m.type === 'ink') return `<path class="mk${sel}" data-id="${m.id}" fill="${m.color}" d="${strokePath(m.pts, m.size)}${m.arrow ? arrowHeadPath(m.pts, m.size) : ''}"/>`;
    if (m.type === 'hl') return `<path class="mk hl${sel}" data-id="${m.id}" fill="none" stroke="${m.color}" stroke-width="${m.size * 5}" stroke-linecap="round" stroke-linejoin="round" d="${linePath(m.pts)}"/>`;
    if (m.type === 'arrow') { const pts = wobbleLine(m.pts[0], m.pts[1]); return `<path class="mk${sel}" data-id="${m.id}" fill="${m.color}" d="${strokePath(pts, m.size)}${arrowHeadPath(pts, m.size)}"/>`; }
    if (m.type === 'box') return `<rect class="mk${sel}" data-id="${m.id}" x="${m.x}" y="${m.y}" width="${m.w}" height="${m.h}" rx="10" fill="${m.fill || 'transparent'}" stroke="${m.color}" stroke-width="${m.size || 3}"/>`;
    return '';
  }
  draw() {
    this.svg.innerHTML = this.marks.filter(m => m.type !== 'note').map(m => this.markSVG(m)).join('');
    const active = document.activeElement?.dataset?.note;
    const notes = this.marks.filter(m => m.type === 'note');
    const seen = new Set();
    for (const m of notes) {
      seen.add(m.id);
      let n = $(`[data-note="${m.id}"]`, this.noteLayer);
      if (!n) {
        n = document.createElement('div');
        n.className = 'sticky'; n.dataset.note = m.id; n.dataset.id = m.id; n.tabIndex = 0; n.setAttribute('role', 'textbox'); n.setAttribute('aria-label', 'Note');
        this.noteLayer.append(n);
      }
      n.style.cssText = `left:${m.x}px;top:${m.y}px;width:${m.w}px;min-height:${m.h}px;background:${m.color};font-size:${m.fs || 16}px;${m.bold ? 'font-weight:700;' : ''}${m.ink ? `color:${m.ink};` : ''}${m.plain && m.align === 'left' ? 'justify-content:flex-start;text-align:left;' : ''}`;
      n.classList.toggle('plain', !!m.plain);
      n.classList.toggle('selected', this.selected === m);
      if (active !== m.id && n.textContent !== m.text) n.textContent = m.text;
    }
    $$('[data-note]', this.noteLayer).forEach(n => { if (!seen.has(n.dataset.note)) n.remove(); });
  }
  select(m) { this.selected = m; this.draw(); }
  markAt(el) { const id = el?.dataset?.id; return id ? this.marks.find(m => m.id === id) : null; }
  editNote(m, el) {
    el.contentEditable = 'plaintext-only'; if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
    el.classList.add('editing'); el.focus();
    const sel = getSelection(); sel.selectAllChildren(el); sel.collapseToEnd();
    const done = () => {
      el.contentEditable = 'false'; el.classList.remove('editing'); el.removeEventListener('blur', done);
      m.text = el.textContent; if (!m.text.trim()) this.remove(m); else this.onChange?.();
    };
    el.addEventListener('blur', done);
  }
  bind() {
    const w = this.wrap;
    w.addEventListener('wheel', e => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) this.zoomAt(Math.exp(-e.deltaY * .01), e.clientX, e.clientY);
      else { this.tx -= e.deltaX; this.ty -= e.deltaY; this.apply(); }
    }, { passive: false });
    w.addEventListener('pointerdown', e => this.down(e));
    w.addEventListener('pointermove', e => this.move(e));
    w.addEventListener('pointerup', e => this.up(e));
    w.addEventListener('pointercancel', e => this.up(e));
    w.addEventListener('dblclick', e => {
      const n = e.target.closest('[data-note]'); if (!n) return;
      const m = this.markAt(n); if (m) this.editNote(m, n);
    });
    this.onKey = e => this.key(e);
    this.onKeyUp = e => { if (e.code === 'Space') { this.space = false; w.classList.remove('panning'); } };
    addEventListener('keydown', this.onKey); addEventListener('keyup', this.onKeyUp);
    this.onResize = () => this.apply();
    addEventListener('resize', this.onResize);
  }
  destroy() { removeEventListener('keydown', this.onKey); removeEventListener('keyup', this.onKeyUp); removeEventListener('resize', this.onResize); }
  key(e) {
    const t = e.target;
    if (t.closest?.('input,textarea,select,[contenteditable="true"],[contenteditable="plaintext-only"]')) return;
    const k = e.key.toLowerCase();
    if ((e.metaKey || e.ctrlKey) && k === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Space' && !this.space) { if (t.closest?.('button,a')) return; e.preventDefault(); this.space = true; this.wrap.classList.add('panning'); return; }
    const map = { v: 'cursor', p: 'pen', h: 'marker', a: 'arrow', r: 'box', n: 'note', e: 'eraser' };
    if (map[k]) { this.setTool(map[k]); return; }
    if ((k === 'delete' || k === 'backspace') && this.selected) { e.preventDefault(); const m = this.selected; this.selected = null; this.remove(m); }
    if (k === 'escape') this.setTool('cursor');
  }
  down(e) {
    this.pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (e.target.closest('.dock,.zoom,.sheet-float')) return;
    const tool = e.pointerType === 'pen' && (this.tool === 'cursor' || this.tool === 'hand') ? 'pen' : this.tool;
    if (this.pointers.size === 2) { this.cancelStroke(); const [a, b] = [...this.pointers.values()]; this.pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2 }; return; }
    const touchPan = e.pointerType === 'touch' && tool === 'cursor' && !e.target.closest('button,a,input,textarea,.mk,.sticky');
    if (e.button === 1 || this.space || tool === 'hand' || touchPan) { e.preventDefault(); this.pan = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty }; this.wrap.setPointerCapture(e.pointerId); this.wrap.classList.add('panning'); return; }
    const editing = e.target.closest('.sticky.editing'); if (editing) return;
    const [x, y] = this.world(e);
    if (tool === 'pen' || tool === 'marker') {
      e.preventDefault(); this.wrap.setPointerCapture(e.pointerId);
      const hl = tool === 'marker';
      this.cur = { id: uid('m'), type: hl ? 'hl' : 'ink', pts: [[x, y, e.pointerType === 'pen' ? e.pressure : undefined]], color: hl ? this.color + '55' : this.color, size: this.size };
      this.curEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      if (hl) { this.curEl.setAttribute('fill', 'none'); this.curEl.setAttribute('stroke', this.cur.color); this.curEl.setAttribute('stroke-width', this.size * 5); this.curEl.setAttribute('stroke-linecap', 'round'); this.curEl.setAttribute('stroke-linejoin', 'round'); this.curEl.classList.add('hl'); }
      else this.curEl.setAttribute('fill', this.color);
      this.svg.append(this.curEl); this.paintCur(); return;
    }
    if (tool === 'arrow') { e.preventDefault(); this.wrap.setPointerCapture(e.pointerId); this.cur = { id: uid('m'), type: 'arrow', pts: [[x, y], [x, y]], color: this.color, size: this.size }; this.curEl = document.createElementNS('http://www.w3.org/2000/svg', 'path'); this.curEl.setAttribute('fill', this.color); this.svg.append(this.curEl); return; }
    if (tool === 'box') { e.preventDefault(); this.wrap.setPointerCapture(e.pointerId); this.cur = { id: uid('m'), type: 'box', x, y, w: 0, h: 0, ox: x, oy: y, color: this.color, size: this.size * .8 }; this.curEl = document.createElementNS('http://www.w3.org/2000/svg', 'rect'); this.curEl.setAttribute('rx', 10); this.curEl.setAttribute('fill', 'transparent'); this.curEl.setAttribute('stroke', this.color); this.curEl.setAttribute('stroke-width', this.size * .8); this.svg.append(this.curEl); return; }
    if (tool === 'note') {
      e.preventDefault();
      const c = NOTE_COLORS[(INK_COLORS.indexOf(this.color) + 3) % NOTE_COLORS.length] || NOTE_COLORS[0];
      const m = { id: uid('m'), type: 'note', x: x - 10, y: y - 10, w: 220, h: 110, text: '', color: c };
      this.push(m); this.setTool('cursor');
      const n = $(`[data-note="${m.id}"]`, this.noteLayer); setTimeout(() => this.editNote(m, n), 0); return;
    }
    if (tool === 'eraser') { e.preventDefault(); this.wrap.setPointerCapture(e.pointerId); this.erasing = true; this.eraseAt(e); return; }
    // Select tool: marks can be moved. Everything else stays live, so prototypes keep working.
    const hit = e.target.closest('.mk,.sticky');
    if (hit) {
      const m = this.markAt(hit); if (!m) return;
      this.select(m);
      this.dragMark = { m, x, y, before: m.pts ? m.pts.map(p => p.slice()) : { x: m.x, y: m.y }, moved: false };
      this.wrap.setPointerCapture(e.pointerId);
    } else if (this.selected) this.select(null);
  }
  move(e) {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (this.pinch && this.pointers.size === 2) {
      const z = typeof pageZoomScale === 'function' ? pageZoomScale() : 1;
      const [a, b] = [...this.pointers.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      this.tx += (mx - this.pinch.mx) / z; this.ty += (my - this.pinch.my) / z;
      this.zoomAt(d / this.pinch.d, mx, my);
      this.pinch = { d, mx, my }; return;
    }
    if (this.pan) { const z = typeof pageZoomScale === 'function' ? pageZoomScale() : 1; this.tx = this.pan.tx + (e.clientX - this.pan.x) / z; this.ty = this.pan.ty + (e.clientY - this.pan.y) / z; this.apply(); return; }
    if (this.erasing) { this.eraseAt(e); return; }
    if (this.dragMark) {
      const [x, y] = this.world(e), dm = this.dragMark, dx = x - dm.x, dy = y - dm.y;
      if (Math.hypot(dx, dy) * this.z > 2) dm.moved = true;
      if (dm.moved) {
        if (dm.m.pts) dm.m.pts = dm.before.map(p => [p[0] + dx, p[1] + dy, p[2]]);
        else { dm.m.x = dm.before.x + dx; dm.m.y = dm.before.y + dy; }
        this.draw();
      }
      return;
    }
    if (!this.cur) return;
    const [x, y] = this.world(e);
    if (this.cur.type === 'ink' || this.cur.type === 'hl') {
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of (evs.length ? evs : [e])) {
        const [wx, wy] = this.world(ev), last = this.cur.pts[this.cur.pts.length - 1], pressure = ev.pointerType === 'pen' ? ev.pressure : undefined;
        // The ink reaches the pen itself, not the smoothed point behind it.
        this.cur.tip = [wx, wy, pressure];
        if (Math.hypot(wx - last[0], wy - last[1]) * this.z < 1.5) continue;
        // A little smoothing keeps a shaky hand looking steady.
        this.cur.pts.push([last[0] + (wx - last[0]) * .62, last[1] + (wy - last[1]) * .62, pressure]);
      }
      this.paintCur();
    } else if (this.cur.type === 'arrow') {
      this.cur.pts[1] = [x, y];
      const pts = wobbleLine(this.cur.pts[0], this.cur.pts[1]);
      this.curEl.setAttribute('d', strokePath(pts, this.cur.size) + arrowHeadPath(pts, this.cur.size));
    } else if (this.cur.type === 'box') {
      const c = this.cur; c.x = Math.min(x, c.ox); c.y = Math.min(y, c.oy); c.w = Math.abs(x - c.ox); c.h = Math.abs(y - c.oy);
      for (const k of ['x', 'y']) this.curEl.setAttribute(k, c[k]);
      this.curEl.setAttribute('width', c.w); this.curEl.setAttribute('height', c.h);
    }
  }
  paintCur() {
    const pts = this.cur.tip ? this.cur.pts.concat([this.cur.tip]) : this.cur.pts;
    if (this.cur.type === 'hl') this.curEl.setAttribute('d', linePath(pts));
    // The end tapers once the pen lifts. Tapered while drawing, the newest ink looked missing.
    else this.curEl.setAttribute('d', strokePath(pts, this.cur.size, true));
  }
  cancelStroke() { this.curEl?.remove(); this.cur = null; this.curEl = null; }
  up(e) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.pan) { this.pan = null; if (!this.space) this.wrap.classList.remove('panning'); return; }
    if (this.erasing) { this.erasing = false; return; }
    if (this.dragMark) {
      const dm = this.dragMark; this.dragMark = null;
      if (dm.moved) { this.undoStack.push({ move: true, mark: dm.m, before: dm.before, after: dm.m.pts ? dm.m.pts : { x: dm.m.x, y: dm.m.y } }); this.redoStack = []; this.onChange?.(); }
      return;
    }
    if (!this.cur) return;
    const c = this.cur; this.curEl?.remove(); this.cur = null; this.curEl = null;
    if ((c.type === 'ink' || c.type === 'hl') && c.pts.length > 1 && e.clientX != null) c.pts.push(this.world(e));
    if (c.type === 'box') { delete c.ox; delete c.oy; if (c.w < 6 || c.h < 6) return; }
    if (c.type === 'arrow' && Math.hypot(c.pts[0][0] - c.pts[1][0], c.pts[0][1] - c.pts[1][1]) < 8) return;
    this.push(c);
  }
  eraseAt(e) {
    // A generous tip: the eraser catches anything within a few pixels, so thin strokes are easy to hit.
    for (const [dx, dy] of [[0, 0], [6, 0], [-6, 0], [0, 6], [0, -6], [4, 4], [-4, -4], [4, -4], [-4, 4]]) {
      const hit = document.elementFromPoint(e.clientX + dx, e.clientY + dy)?.closest?.('.mk,.sticky');
      const m = hit && this.markAt(hit);
      if (m) { this.remove(m); return; }
    }
  }
}
function linePath(pts) {
  if (pts.length < 2) return `M${pts[0][0]},${pts[0][1]}l.1,.1`;
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) { const q = pts[i + 1]; d += `Q${pts[i][0].toFixed(1)},${pts[i][1].toFixed(1)} ${((pts[i][0] + q[0]) / 2).toFixed(1)},${((pts[i][1] + q[1]) / 2).toFixed(1)}`; }
  const e = pts[pts.length - 1];
  return d + `L${e[0].toFixed(1)},${e[1].toFixed(1)}`;
}
function wobbleLine(a, b) {
  const n = Math.max(6, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 14)), pts = [];
  const nx = -(b[1] - a[1]) * .05, ny = (b[0] - a[0]) * .05;
  for (let i = 0; i <= n; i++) { const t = i / n, c = Math.sin(t * Math.PI); pts.push([a[0] + (b[0] - a[0]) * t + nx * c, a[1] + (b[1] - a[1]) * t + ny * c]); }
  return pts;
}
function dockHTML() {
  const tools = [['cursor', 'cursor', 'Select (V)'], ['hand', 'hand', 'Move the view (Space)'], ['pen', 'pen', 'Pen (P)'], ['marker', 'marker', 'Highlighter (H)'], ['arrow', 'arrow', 'Arrow (A)'], ['box', 'box', 'Box (R)'], ['note', 'note', 'Note (N)'], ['eraser', 'eraser', 'Eraser (E)']];
  return `<div class="dock" role="toolbar" aria-label="Drawing tools">
    ${tools.map(([t, i, label]) => `<button type="button" data-act="sheet-tool" data-tool="${t}" aria-pressed="false" aria-label="${label}" title="${label}">${ic(i, 20)}</button>`).join('')}
    <span class="dock-sep"></span>
    ${INK_COLORS.map(c => `<button type="button" class="swatch" data-act="sheet-color" data-color="${c}" aria-pressed="${c === INK_COLORS[1]}" aria-label="Ink colour ${c}" style="--c:${c}"></button>`).join('')}
    <span class="dock-sep"></span>
    ${[[2.2, 'Thin'], [3.4, 'Medium'], [5.6, 'Thick']].map(([s, label]) => `<button type="button" class="size" data-act="sheet-size" data-size="${s}" aria-pressed="${s === 3.4}" aria-label="${label} line" title="${label}"><i style="width:${s * 2.4}px;height:${s * 2.4}px"></i></button>`).join('')}
    <span class="dock-sep"></span>
    <button type="button" data-act="sheet-undo" aria-label="Undo" title="Undo (⌘Z)">${ic('undo', 20)}</button>
    <button type="button" data-act="sheet-redo" aria-label="Redo" title="Redo (⇧⌘Z)">${ic('redo', 20)}</button>
  </div>
  <div class="zoom" role="group" aria-label="Zoom">
    <button type="button" data-act="sheet-zoom" data-z="0.85" aria-label="Zoom out">${ic('minus', 16)}</button>
    <span id="zoomLabel">100%</span>
    <button type="button" data-act="sheet-zoom" data-z="1.18" aria-label="Zoom in">${ic('plus', 16)}</button>
    <button type="button" data-act="sheet-fit" class="zoom-fit">Fit</button>
  </div>`;
}
let SHEET = null;
ACT['sheet-tool'] = el => SHEET?.setTool(el.dataset.tool);
ACT['sheet-color'] = el => SHEET?.setColor(el.dataset.color);
ACT['sheet-size'] = el => SHEET?.setSize(+el.dataset.size);
ACT['sheet-undo'] = () => SHEET?.undo();
ACT['sheet-redo'] = () => SHEET?.redo();
ACT['sheet-zoom'] = el => SHEET?.zoomBy(+el.dataset.z);
ACT['sheet-fit'] = () => SHEET?.fit();
