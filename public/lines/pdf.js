// Downloads. Markdown and zips come straight from the folder; the PDF is written here so its text stays real text.
function saveUrl(url, name) {
  const a = document.createElement('a');
  a.href = url; if (name) a.download = name; a.hidden = true;
  document.body.append(a); a.click(); a.remove();
}
function saveBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  saveUrl(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast(`Saved ${name}`);
}
const baseName = path => path.split('/').pop().replace(/\.md$/, '');
const fileUrl = (p, path, download) => apiUrl(`${pathFor(p.id)}/file?path=${encodeURIComponent(path)}${download ? '&download=1' : ''}`);
function zipUrl(p, paths, name) {
  const q = paths.map(x => `path=${encodeURIComponent(x)}`).join('&');
  return apiUrl(`${pathFor(p.id)}/zip?${q}${q ? '&' : ''}name=${encodeURIComponent(name)}`);
}
function downloadFolder(p) { saveUrl(zipUrl(p, [], folderLabel(p))); toast('Packing the folder'); }
async function downloadPdf(p, docs, name) {
  toast('Making the PDF');
  try { saveBlob(`${name}.pdf`, await buildPdf(p, docs)); }
  catch (error) { toast(`Could not make the PDF: ${error.message}`); }
}
function linkedPaths(doc) {
  const out = new Set([doc.path]);
  for (const m of doc.md.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const path = resolvePath(doc.path, m[1]);
    if (/^https?:/.test(path)) continue;
    out.add(path);
    if (/\.png$/.test(path)) out.add(path.replace(/\.png$/, '.penecho.json'));
  }
  return [...out];
}
async function downloadItems(p, doc) {
  const l = lineOfDoc(p, doc);
  let paths = linkedPaths(doc);
  // A Topic goes with the detail of each piece of work, and whatever those link to.
  if (l && l.topicPath === doc.path) { const details = l.stations.map(s => s.detail).filter(Boolean); paths = [...new Set([...paths, ...details, ...(await Promise.all(details.map(path => loadDoc(p, path).then(linkedPaths).catch(() => [])))).flat()])]; }
  const known = new Set(p.files.map(f => f.path));
  paths = paths.filter(x => known.has(x));
  return [
    { label:'PDF', icon:'doc', fn:() => downloadPdf(p, [doc], baseName(doc.path)) },
    { label:'Markdown', icon:'file', fn:() => saveUrl(fileUrl(p, doc.path, true), doc.path.split('/').pop()) },
    { label:l && l.topicPath === doc.path ? 'Topic, its details and pictures (.zip)' : 'Markdown with pictures (.zip)', icon:'archive', fn:() => saveUrl(zipUrl(p, paths, l ? l.slug : baseName(doc.path))) },
    { sep:1 },
    { label:'Copy the Markdown', icon:'copy', fn:() => copyText(doc.md, 'Copied the Markdown') },
  ];
}

// ---------- PDF ----------
const PDF_W = 595.28, PDF_H = 841.89, PDF_M = 54, PDF_CW = PDF_W - PDF_M * 2;
const WIN = { '–': 0x96, '—': 0x97, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '…': 0x85, '€': 0x80 };
const pdfSafe = t => String(t).replace(/→/g, '->').replace(/−/g, '-').replace(/⇄/g, '<->').replace(/ /g, ' ');
const isWin = t => /^[\x20-\x7e¡-ÿ–—‘’“”•…€]*$/.test(t);
const pdfEsc = t => {
  let out = '';
  for (const ch of t) {
    const code = WIN[ch] ?? ch.charCodeAt(0);
    if (code === 40 || code === 41 || code === 92) out += '\\' + ch;
    else if (code < 32 || code > 126) out += '\\' + code.toString(8).padStart(3, '0');
    else out += ch;
  }
  return out;
};
const FONT_CSS = { r: '12px Helvetica, Arial, sans-serif', b: 'bold 12px Helvetica, Arial, sans-serif', i: 'italic 12px Helvetica, Arial, sans-serif', m: '12px Courier, monospace' };
const FONT_RES = { r: 'F1', b: 'F2', i: 'F3', m: 'F4' };
function textWidth(t, f, s) { const c = measureCtx(); c.font = FONT_CSS[f]; return c.measureText(t).width * s / 12; }
const hex = c => { const n = parseInt(c.slice(1), 16); return `${((n >> 16) & 255) / 255} ${((n >> 8) & 255) / 255} ${(n & 255) / 255}`; };
// Inline Markdown as styled runs: bold, code, links and @names.
function pdfRuns(text, base = 'r') {
  const runs = []; const re = /(\*\*[^*]+\*\*|`[^`]+`|!?\[[^\]]*\]\([^)]*\)|@(?:opus|codex|deepseek|you)\b)/g; let last = 0, m;
  const push = (t, f, c) => { if (t) runs.push({ t: pdfSafe(t), f, c }); };
  while ((m = re.exec(text))) {
    push(text.slice(last, m.index), base);
    const tok = m[0];
    if (tok.startsWith('**')) push(tok.slice(2, -2), 'b');
    else if (tok.startsWith('`')) push(tok.slice(1, -1), 'm');
    else if (tok.startsWith('@')) push(agentInfo(tok.slice(1)).name, 'b');
    else if (tok.startsWith('[')) push(tok.match(/^\[([^\]]*)\]/)[1], base, '#3730a3');
    else if (tok.startsWith('!')) push(tok.match(/^!\[([^\]]*)\]/)[1], base, '#3730a3');
    last = m.index + tok.length;
  }
  push(text.slice(last), base);
  return runs;
}
function wrapRuns(runs, width, size) {
  const lines = []; let line = [], x = 0;
  for (const r of runs) {
    for (const word of r.t.match(/[⺀-鿿豈-﫿＀-￯]|\S+\s*|\s+/g) || []) {
      const w = textWidth(word, r.f, size);
      if (x + textWidth(word.trimEnd(), r.f, size) > width && line.length) { lines.push(line); line = []; x = 0; if (!word.trim()) continue; }
      const prev = line[line.length - 1];
      if (prev && prev.f === r.f && prev.c === r.c) prev.t += word; else line.push({ t: word, f: r.f, c: r.c });
      x += w;
    }
  }
  if (line.length) lines.push(line);
  return lines.length ? lines : [[{ t: '', f: 'r' }]];
}
// Draws text in a canvas: the fallback for Chinese and anything else outside the PDF's built-in fonts.
async function rasterRun(text, f, size, color) {
  const scale = 3, c = document.createElement('canvas'), x = c.getContext('2d');
  const font = `${f === 'b' ? 'bold ' : ''}${size * scale}px "PingFang SC", "Noto Sans SC", "Microsoft YaHei", Helvetica, Arial, sans-serif`;
  x.font = font;
  c.width = Math.ceil(x.measureText(text).width) + 4; c.height = Math.ceil(size * scale * 1.5);
  x.font = font; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = color || '#20242c'; x.textBaseline = 'alphabetic'; x.fillText(text, 2, size * scale * 1.12);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', .94));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w: c.width, h: c.height, ptW: c.width / scale, ptH: c.height / scale };
}
async function buildPdf(p, docs) {
  const pages = [[]], images = []; let y = PDF_H - PDF_M;
  const out = s => pages[pages.length - 1].push(s);
  const addImage = img => { images.push(img); return `Im${images.length}`; };
  const newPage = () => { pages.push([]); y = PDF_H - PDF_M; };
  const need = h => { if (y - h < PDF_M + 16) newPage(); };
  const rect = (x, yy, w, h, fill, stroke) => out(`q ${fill ? hex(fill) + ' rg ' : ''}${stroke ? hex(stroke) + ' RG .6 w ' : ''}${x.toFixed(2)} ${yy.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re ${fill && stroke ? 'B' : fill ? 'f' : 'S'} Q`);
  const rule = (x1, yy, x2, color = '#d6d9df') => out(`q ${hex(color)} RG .6 w ${x1.toFixed(2)} ${yy.toFixed(2)} m ${x2.toFixed(2)} ${yy.toFixed(2)} l S Q`);
  const drawRun = async (r, x, yy, size) => {
    if (!r.t) return x;
    if (isWin(r.t)) {
      out(`BT /${FONT_RES[r.f]} ${size} Tf ${hex(r.c || '#20242c')} rg ${x.toFixed(2)} ${yy.toFixed(2)} Td (${pdfEsc(r.t)}) Tj ET`);
      return x + textWidth(r.t, r.f, size);
    }
    // Mixed text: keep what the built-in fonts can show as real text, and draw the rest.
    let cx = x;
    for (const piece of r.t.match(/[\x20-\x7e¡-ÿ–—‘’“”•…€]+|[^\x20-\x7e¡-ÿ–—‘’“”•…€]+/g) || []) {
      if (isWin(piece)) { out(`BT /${FONT_RES[r.f]} ${size} Tf ${hex(r.c || '#20242c')} rg ${cx.toFixed(2)} ${yy.toFixed(2)} Td (${pdfEsc(piece)}) Tj ET`); cx += textWidth(piece, r.f, size); }
      else { const im = await rasterRun(piece, r.f, size, r.c); const name = addImage(im); out(`q ${im.ptW.toFixed(2)} 0 0 ${im.ptH.toFixed(2)} ${(cx - .6).toFixed(2)} ${(yy - im.ptH * .28).toFixed(2)} cm /${name} Do Q`); cx += im.ptW - 1.2; }
    }
    return cx;
  };
  const para = async (runs, { x = PDF_M, width = PDF_CW, size = 10.5, lead = 1.45, after = 7 } = {}) => {
    const lines = wrapRuns(runs, width, size), lh = size * lead;
    for (const line of lines) { need(lh); y -= lh; let cx = x; for (const r of line) cx = await drawRun(r, cx, y + size * .28, size); }
    y -= after;
  };
  const measure = (runs, width, size, lead = 1.45) => wrapRuns(runs, width, size).length * size * lead;
  const figure = async (b, doc) => {
    const url = assetUrl(p, resolvePath(doc.path, b.src));
    if (!url) { await para(pdfRuns(`Picture: ${b.alt || b.src}`, 'i')); return; }
    try {
      const im = await rasterize(url, { type: 'image/jpeg', scale: 2, quality: .9 });
      const s = Math.min(PDF_CW / im.w, 380 / im.h, .75 * im.naturalW / im.w);
      const w = im.w * s, h = im.h * s; need(h + 22);
      y -= h; const name = addImage(im);
      out(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${PDF_M} ${y.toFixed(2)} cm /${name} Do Q`);
      rect(PDF_M, y, w, h, null, '#d6d9df');
      y -= 13; if (b.alt) { out(`BT /F3 8.5 Tf ${hex('#4e5764')} rg ${PDF_M} ${y.toFixed(2)} Td (${pdfEsc(isWin(pdfSafe(b.alt)) ? pdfSafe(b.alt) : '')}) Tj ET`); }
      y -= 9;
    } catch { await para(pdfRuns(`Picture: ${b.alt || b.src}`, 'i')); }
  };
  const table = async b => {
    const cols = b.head.length, size = 9, pad = 5;
    const plain = c => c.replace(/\*\*|`/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    const longest = i => Math.max(plain(b.head[i]).length, ...b.rows.map(r => plain(r[i] || '').length), 4);
    const tot = Array.from({ length: cols }, (_, i) => Math.min(longest(i), 46)).reduce((a, n) => a + n, 0);
    const widths = Array.from({ length: cols }, (_, i) => PDF_CW * Math.min(longest(i), 46) / tot);
    const row = async (cells, head) => {
      const h = Math.max(...cells.map((c, i) => measure(pdfRuns(c || '', head ? 'b' : 'r'), widths[i] - pad * 2, size, 1.35))) + pad * 2;
      need(h); y -= h;
      if (head) rect(PDF_M, y, PDF_CW, h, '#f2f3f6');
      let x = PDF_M; rule(PDF_M, y, PDF_M + PDF_CW);
      for (let i = 0; i < cols; i++) {
        const top = y + h - pad; let ly = top;
        for (const line of wrapRuns(pdfRuns(cells[i] || '', head ? 'b' : 'r'), widths[i] - pad * 2, size)) { ly -= size * 1.35; let cx = x + pad; for (const r of line) cx = await drawRun(r, cx, ly + 2, size); }
        x += widths[i];
      }
    };
    await row(b.head, true); for (const r of b.rows) await row(r, false);
    y -= 10;
  };
  const callout = async b => {
    const kind = (b.kind || '')[0]?.toUpperCase() + (b.kind || '').slice(1), pad = 9, w = PDF_CW - pad * 2;
    const title = pdfRuns(b.title || '', 'b'), body = pdfRuns(b.lines.join(' '));
    const h = 12 + measure(title, w, 10.5) + (b.lines.length ? measure(body, w, 10) + 3 : 0) + pad * 2;
    need(h); y -= h;
    rect(PDF_M, y, PDF_CW, h, '#f8f9fb', '#d6d9df');
    let cy = y + h - pad - 8;
    out(`BT /F1 8 Tf ${hex('#697281')} rg ${PDF_M + pad} ${cy.toFixed(2)} Td (${pdfEsc(kind)}) Tj ET`);
    const save = y; y = cy - 2;
    await paraIn(title, PDF_M + pad, w, 10.5);
    if (b.lines.length) await paraIn(body, PDF_M + pad, w, 10);
    y = save - 9;
  };
  const paraIn = async (runs, x, width, size) => { for (const line of wrapRuns(runs, width, size)) { y -= size * 1.45; let cx = x; for (const r of line) cx = await drawRun(r, cx, y + size * .28, size); } };
  const code = async b => {
    const size = 8.5, lh = size * 1.4, max = Math.floor((PDF_CW - 14) / (size * .6));
    const lines = b.code.split('\n').flatMap(l => l.length ? (l.match(new RegExp(`.{1,${max}}`, 'g')) || ['']) : ['']);
    y -= 3;
    for (const l of lines) { need(lh); rect(PDF_M, y - lh, PDF_CW, lh, '#f2f3f6'); y -= lh; if (l.trim()) await drawRun({ t: pdfSafe(l), f: 'm' }, PDF_M + 7, y + 3, size); }
    y -= 10;
  };
  const list = async b => {
    for (let i = 0; i < b.items.length; i++) {
      const it = b.items[i], indent = PDF_M + 14 + Math.min(it.indent, 4) * 5, runs = pdfRuns(it.text);
      need(10.5 * 1.45);
      const mark = y - 10.5 * 1.45 + 3;
      if (it.task != null) {
        rect(indent - 13, mark - .5, 8, 8, it.task ? '#4f46e5' : null, it.task ? null : '#8a919e');
        if (it.task) out(`q 1 1 1 RG 1.1 w ${indent - 11.5} ${mark + 3.5} m ${indent - 9.6} ${mark + 1.4} l ${indent - 6.3} ${mark + 5.8} l S Q`);
      } else if (b.ordered) { out(`BT /F1 10.5 Tf ${hex('#4e5764')} rg ${indent - 16} ${(mark + .2).toFixed(2)} Td (${i + (parseInt(b.items[0].marker, 10) || 1)}.) Tj ET`); }
      else rect(indent - 10, mark + 2.5, 2.6, 2.6, '#697281');
      await para(runs, { x: indent, width: PDF_W - PDF_M - indent, after: 2 });
    }
    y -= 6;
  };
  const renderDoc = async doc => {
    const blocks = parseMd(doc.md);
    for (const b of blocks) {
      if (b.t === 'meta') { await para(pdfRuns(b.meta.map(([k, v]) => `${k}: ${v}`).join('   ·   '), 'r').map(r => ({ ...r, c: '#697281' })), { size: 8.5, after: 8 }); continue; }
      if (b.t === 'h') {
        const size = { 1: 22, 2: 14, 3: 11.5, 4: 10.5 }[b.lvl];
        need(size * 2.6 + 12); if (b.lvl === 2) { y -= 8; rule(PDF_M, y, PDF_W - PDF_M); y -= 4; } else if (b.lvl > 2) y -= 3;
        await para(pdfRuns(b.text, 'b'), { size, lead: 1.25, after: b.lvl === 1 ? 8 : 5 });
      } else if (b.t === 'p') await para(pdfRuns(b.text));
      else if (b.t === 'quote') {
        if (b.kind) await callout(b);
        else { const top = y; await para(pdfRuns(b.lines.join(' '), 'i'), { x: PDF_M + 12, width: PDF_CW - 12 }); if (pages[pages.length - 1].length) out(`q ${hex('#b8bdc7')} RG 1.2 w ${PDF_M + 3} ${Math.min(top, PDF_H - PDF_M).toFixed(2)} m ${PDF_M + 3} ${(y + 6).toFixed(2)} l S Q`); }
      } else if (b.t === 'list') await list(b);
      else if (b.t === 'code') await code(b);
      else if (b.t === 'table') await table(b);
      else if (b.t === 'figure') await figure(b, doc);
      else if (b.t === 'hr') { y -= 4; rule(PDF_M, y, PDF_W - PDF_M); y -= 8; }
    }
  };
  for (let i = 0; i < docs.length; i++) { if (i) newPage(); await renderDoc(docs[i]); }
  const label = pdfSafe(docs[0].path);
  pages.forEach((page, i) => {
    page.push(`BT /F1 8 Tf ${hex('#8a919e')} rg ${PDF_M} 30 Td (${pdfEsc(isWin(label) ? label : 'PenEcho')}) Tj ET`);
    const num = `${i + 1} / ${pages.length}`;
    page.push(`BT /F1 8 Tf ${hex('#8a919e')} rg ${(PDF_W - PDF_M - textWidth(num, 'r', 8)).toFixed(2)} 30 Td (${num}) Tj ET`);
  });
  return assemblePdf(pages, images, docs[0].title || label);
}
function assemblePdf(pages, images, title) {
  const enc = s => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; };
  const chunks = [], offsets = []; let pos = 0;
  const put = b => { const x = typeof b === 'string' ? enc(b) : b; chunks.push(x); pos += x.length; };
  const fonts = [['F1', 'Helvetica'], ['F2', 'Helvetica-Bold'], ['F3', 'Helvetica-Oblique'], ['F4', 'Courier']];
  // Numbering: 1 catalog, 2 pages, 3 info, then fonts, images, and a content and page object for each page.
  const fontBase = 4, imgBase = fontBase + fonts.length, pageBase = imgBase + images.length;
  const pageId = i => pageBase + i * 2 + 1, contentId = i => pageBase + i * 2;
  const obj = (id, body) => { offsets[id] = pos; put(`${id} 0 obj\n`); put(body); put('\nendobj\n'); };
  put('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] >>`);
  obj(3, `<< /Title (${pdfEsc(isWin(pdfSafe(title)) ? pdfSafe(title) : 'PenEcho document')}) /Producer (PenEcho) >>`);
  fonts.forEach(([, base], i) => obj(fontBase + i, `<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>`));
  images.forEach((im, i) => {
    offsets[imgBase + i] = pos;
    put(`${imgBase + i} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`);
    put(im.bytes); put('\nendstream\nendobj\n');
  });
  const resources = `<< /Font << ${fonts.map(([n], i) => `/${n} ${fontBase + i} 0 R`).join(' ')} >> /XObject << ${images.map((_, i) => `/Im${i + 1} ${imgBase + i} 0 R`).join(' ')} >> >>`;
  pages.forEach((ops, i) => {
    const content = ops.join('\n');
    obj(contentId(i), `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    obj(pageId(i), `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_W} ${PDF_H}] /Resources ${resources} /Contents ${contentId(i)} 0 R >>`);
  });
  const xref = pos, count = pageBase + pages.length * 2;
  put(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let id = 1; id < count; id++) put(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  put(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}
