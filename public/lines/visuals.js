// Turns marks made on a step or a file into a real image, so they can be saved as feedback.
const measureCtx = () => (measureCtx.c ||= document.createElement('canvas').getContext('2d'));
const SVG_FONT = '-apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif';
function wrapWords(text, width, fs, bold) {
  const c = measureCtx(), out = [];
  c.font = `${bold ? '700 ' : ''}${fs}px ${SVG_FONT}`;
  for (const para of String(text).split('\n')) {
    let line = '';
    // Chinese has no spaces, so it may break at any character.
    for (const word of para.match(/[⺀-鿿豈-﫿＀-￯]|[^\s⺀-鿿]+\s*|\s+/g) || ['']) {
      const test = line + word;
      if (c.measureText(test.trimEnd()).width > width && line.trim()) { out.push(line.trim()); line = word.trimStart(); } else line = test;
    }
    out.push(line.trim());
  }
  return out;
}
function marksBounds(marks) {
  let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
  for (const m of marks) {
    if (m.pts) m.pts.forEach(p => { a = Math.min(a, p[0]); b = Math.min(b, p[1]); c = Math.max(c, p[0]); d = Math.max(d, p[1]); });
    else { a = Math.min(a, m.x); b = Math.min(b, m.y); c = Math.max(c, m.x + m.w); d = Math.max(d, m.y + m.h); }
  }
  return marks.length ? { x: a, y: b, w: c - a, h: d - b } : { x: 0, y: 0, w: 400, h: 260 };
}
function noteSVG(m) {
  const fs = m.fs || 16, lh = fs * 1.34, plain = m.plain;
  const lines = wrapWords(m.text || '', Math.max(20, m.w - (plain ? 4 : 28)), fs, m.bold);
  const top = plain ? m.y + (m.h - lines.length * lh) / 2 + fs * .92 : m.y + 12 + fs * .95;
  const anchor = plain && m.align !== 'left' ? 'middle' : 'start';
  const x = plain ? (m.align === 'left' ? m.x : m.x + m.w / 2) : m.x + 14;
  const text = lines.map((t, i) => `<text x="${x}" y="${(top + i * lh).toFixed(1)}" font-size="${fs}" font-weight="${m.bold ? 700 : 400}" fill="${m.ink || '#20242c'}" text-anchor="${anchor}" font-family="${SVG_FONT}">${esc(t)}</text>`).join('');
  return (plain ? '' : `<rect x="${m.x}" y="${m.y}" width="${m.w}" height="${m.h}" rx="4" fill="${m.color}" stroke="rgba(31,36,45,.14)"/>`) + text;
}
// Paint order matches the Canvas: shapes, then ink, then notes on top.
function marksBody(marks) {
  const rank = m => m.type === 'box' ? 0 : m.type === 'note' ? 2 : 1;
  return [...marks].sort((a, b) => rank(a) - rank(b)).map(m => {
    if (m.type === 'note') return noteSVG(m);
    if (m.type === 'box') return `<rect x="${m.x}" y="${m.y}" width="${m.w}" height="${m.h}" rx="10" fill="${m.fill || 'none'}" stroke="${m.color}" stroke-width="${m.size || 3}"/>`;
    if (m.type === 'hl') return `<path d="${linePath(m.pts)}" fill="none" stroke="${m.color}" stroke-width="${m.size * 5}" stroke-linecap="round"/>`;
    if (m.type === 'arrow') { const pts = wobbleLine(m.pts[0], m.pts[1]); return `<path d="${strokePath(pts, m.size)}${arrowHeadPath(pts, m.size)}" fill="${m.color}"/>`; }
    return `<path d="${strokePath(m.pts, m.size)}${m.arrow ? arrowHeadPath(m.pts, m.size) : ''}" fill="${m.color}"/>`;
  }).join('');
}
function marksSVG(marks, { pad = 26, background = '#ffffff' } = {}) {
  const b = marksBounds(marks), w = Math.ceil(b.w + pad * 2), h = Math.ceil(b.h + pad * 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${b.x - pad} ${b.y - pad} ${w} ${h}"><rect x="${b.x - pad}" y="${b.y - pad}" width="${w}" height="${h}" fill="${background}"/>${marksBody(marks)}</svg>`;
}
const marksDataUri = marks => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(marksSVG(marks));
function marksThumb(marks, { pad = 26 } = {}) {
  const b = marksBounds(marks);
  return `<svg viewBox="${b.x - pad} ${b.y - pad} ${b.w + pad * 2} ${b.h + pad * 2}" class="thumb-svg" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${marksBody(marks)}</svg>`;
}
// Any picture to a real raster: used for PDF pages, PNG files and the zip.
function loadImage(url) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Image did not load')); i.src = url; });
}
async function rasterize(url, { type = 'image/png', scale = 2, quality = .92, maxWidth = 2400, maxHeight = Infinity, background = '#fff' } = {}) {
  const img = await loadImage(url);
  const nw = img.naturalWidth || 800, nh = img.naturalHeight || 500, s = Math.min(scale, maxWidth / nw, maxHeight / nh);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(nw * s)); c.height = Math.max(1, Math.round(nh * s));
  const x = c.getContext('2d');
  if (background) { x.fillStyle = background; x.fillRect(0, 0, c.width, c.height); }
  x.drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise(res => c.toBlob(res, type, quality));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w: c.width, h: c.height, naturalW: nw, naturalH: nh };
}

// Pictures an agent can be asked for. Your own drawing happens on the Canvas.
const PICTURE_ASKS = [
  { label:'Architecture diagram', icon:'files', text:'Draw an architecture diagram of this Topic. Show the main parts and what talks to what.' },
  { label:'Workflow diagram', icon:'branch', text:'Draw a workflow diagram of this Topic. Show the steps in order and any decisions.' },
  { label:'Sequence diagram', icon:'agents', text:'Draw a sequence diagram of this Topic. Show who says what to whom, in order.' },
  { label:'Visual Explorer', icon:'spark', text:'Make a Visual Explorer that explains this Topic as one self-contained HTML page: the main point first, then the key parts.' },
];
