// A Markdown reader that shows structure better than plain rendering, and always keeps the source one click away.
// ---------- LaTeX ----------
// Formulas stay as TeX in the page and MathJax draws them, loaded the first time one is on screen. Anything that looks like LaTeX is read as LaTeX: $…$, $$…$$, \(…\), \[…\], equation and align blocks, and a whole document pasted as it is.
const MATH_ENVS = 'equation|align|gather|multline|eqnarray|displaymath';
const MATH_BLOCK = new RegExp(`^\\s*(\\$\\$|\\\\\\[|\\\\begin\\{(?:${MATH_ENVS})\\*?\\})`);
const mathSpan = (tex, display) => `<span class="mx${display ? ' mx-d' : ''}" data-tex="${esc(String(tex).trim())}">${esc(String(tex).trim())}</span>`;
const LOGOS = { LaTeX:'<span class="tex-logo">L<sup>a</sup>T<sub>e</sub>X</span>', TeX:'<span class="tex-logo">T<sub>e</sub>X</span>' };
// What an equation or align block becomes inside $$…$$, where MathJax wants aligned and gathered.
const ENV_INSIDE = { align:'aligned', eqnarray:'aligned', gather:'gathered', multline:'gathered' };
function envToDisplay(env, star, body) {
  if (env === 'equation' || env === 'displaymath') return body;
  const inner = ENV_INSIDE[env] || env + star;
  return `\\begin{${inner}}${body}\\end{${inner}}`;
}
// A LaTeX document pasted as it is: its body, sections, emphasis and lists become Markdown, and its formulas are left for MathJax. Plain Markdown is returned untouched.
function texPrep(src) {
  let s = String(src ?? '');
  if (!/\\(documentclass|begin\{document\}|(sub)*section\*?\{|maketitle|usepackage|begin\{(itemize|enumerate)\})/.test(s)) return s;
  const held = [], hold = t => `\u0001${held.push(t) - 1}\u0001`;
  s = s.replace(new RegExp(`\\\\begin\\{(${MATH_ENVS})(\\*?)\\}([\\s\\S]*?)\\\\end\\{\\1\\2\\}`, 'g'), (_, env, star, body) => hold(`\n$$${envToDisplay(env, star, body)}$$\n`))
    .replace(/\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$[^$\n]+\$/g, m => hold(m));
  const body = s.match(/\\begin\{document\}([\s\S]*?)(?:\\end\{document\}|$)/);
  if (body) s = body[1];
  s = s.replace(/\\(documentclass|usepackage)(\[[^\]]*\])?\{[^}]*\}/g, '')
    .replace(/\\title\{([^}]*)\}/g, '\n# $1\n').replace(/\\(author|date)\{[^}]*\}/g, '').replace(/\\maketitle\b/g, '')
    .replace(/\\((?:sub)*)section\*?\{([^}]*)\}/g, (_, sub, t) => `\n\n${'#'.repeat(Math.min(4, 2 + sub.length / 3))} ${t}\n\n`)
    .replace(/\\textbf\{([^}]*)\}/g, '**$1**').replace(/\\(?:emph|textit)\{([^}]*)\}/g, '*$1*').replace(/\\texttt\{([^}]*)\}/g, '`$1`')
    .replace(/\\(begin|end)\{(itemize|enumerate)\}/g, '\n').replace(/\\item\s*/g, '\n- ')
    .replace(/\\\\\s*/g, '\n').replace(/\\par\b/g, '\n\n').replace(/\\(noindent|centering)\b/g, '');
  return s.replace(/\u0001(\d+)\u0001/g, (_, n) => held[+n]).replace(/[ \t]*\n[ \t]*(?=\$\$)/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
// Holds every formula in some words, so the rest can be escaped or read as Markdown.
function holdMath(s, hold, display = true) {
  return s.replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]/g, (_, a, b) => hold(mathSpan(a ?? b, display)))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, t) => hold(mathSpan(t, false)))
    .replace(/(^|[^\\$\w])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g, (_, pre, t) => pre + hold(mathSpan(t, false)))
    .replace(/\\(LaTeX|TeX)\b(\{\})?/g, (_, k) => hold(LOGOS[k]));
}
// Formulas in words that are not Markdown, such as the words under a stop on the map.
function texInline(text) {
  const held = [], hold = h => `\u0000${held.push(h) - 1}\u0000`;
  return esc(holdMath(String(text ?? ''), hold, false)).replace(/\u0000(\d+)\u0000/g, (_, n) => held[+n]);
}
const MathTex = {
  loading: null,
  load() {
    if (window.MathJax?.tex2svg) return Promise.resolve();
    if (this.loading) return this.loading;
    window.MathJax = { startup:{ typeset:false }, svg:{ fontCache:'none' } };
    this.loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/mathjax-3.2.2/es5/tex-svg.js'; s.async = true;
      s.onload = () => Promise.resolve(window.MathJax?.startup?.promise).then(resolve, reject);
      s.onerror = reject;
      document.head.append(s);
    });
    return this.loading;
  },
  run(root = document) {
    const list = [...root.querySelectorAll('.mx:not([data-done])')];
    if (!list.length) return;
    this.load().then(() => {
      for (const el of list) {
        if (el.dataset.done || !el.isConnected) continue;
        el.dataset.done = '1';
        try { const svg = window.MathJax.tex2svg(el.dataset.tex, { display:el.classList.contains('mx-d') }); el.textContent = ''; el.append(svg); el.title = el.dataset.tex; }
        catch { el.classList.add('mx-bad'); }
      }
    }).catch(() => { this.loading = null; });
  },
};
// Whatever draws a page, the formulas on it are drawn once it is there.
const mathWatch = typeof MutationObserver === 'function' ? new MutationObserver(() => { clearTimeout(mathWatch.t); mathWatch.t = setTimeout(() => MathTex.run(), 20); }) : null;
if (mathWatch && typeof document !== 'undefined') {
  if (document.body) mathWatch.observe(document.body, { childList:true, subtree:true });
  else addEventListener('DOMContentLoaded', () => mathWatch.observe(document.body, { childList:true, subtree:true }));
}

function parseMd(src, { breaks = false } = {}) {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n'), out = [];
  let i = 0;
  const isStart = L => /^(<!--|#{1,4}\s|```|>\s?|\s*([-*]|\d+[.)])\s+|!\[[^\]]*\]\([^)]+\)\s*$|(-{3,}|\*{3,})\s*$)/.test(L) || /^\|.*\|\s*$/.test(L) || MATH_BLOCK.test(L);
  if (lines[0] === '---') {
    let j = 1; const meta = [];
    while (j < lines.length && lines[j] !== '---') { const m = lines[j].match(/^([\w ]+):\s*(.*)$/); if (m) meta.push([m[1], m[2].replace(/^"(.*)"$/, '$1')]); j++; }
    out.push({ t: 'meta', meta, a: 0, b: j }); i = j + 1;
  }
  while (i < lines.length) {
    const L = lines[i]; let m;
    if (!L.trim()) { i++; continue; }
    // HTML comments are for agents. Viewers hide them, so the reader does too.
    if (/^<!--/.test(L)) { while (i < lines.length && !lines[i].includes('-->')) i++; i++; continue; }
    if ((m = L.match(/^```(\w*)/))) {
      let j = i + 1; const code = [];
      while (j < lines.length && !lines[j].startsWith('```')) code.push(lines[j++]);
      out.push({ t: 'code', lang: m[1], code: code.join('\n'), a: i, b: j }); i = j + 1; continue;
    }
    if (MATH_BLOCK.test(L)) {
      // A formula on lines of its own, up to whatever closes it.
      const open = L.trim(), env = (open.match(/^\\begin\{([a-z]+)(\*?)\}/) || []), close = open.startsWith('$$') ? '$$' : open.startsWith('\\[') ? '\\]' : `\\end{${env[1]}${env[2]}}`;
      let j = i, text = env[1] ? open : open.slice(2);
      const closed = () => env[1] ? text.includes(close) : text.trimEnd().endsWith(close) && text.trim().length >= close.length;
      while (!closed() && ++j < lines.length) text += '\n' + lines[j];
      let tex = env[1] ? text.slice(open.indexOf('}') + 1, text.lastIndexOf(close)) : text.slice(0, text.lastIndexOf(close));
      if (env[1]) tex = envToDisplay(env[1], env[2], tex);
      out.push({ t: 'math', tex, a: i, b: Math.min(j, lines.length - 1) }); i = j + 1; continue;
    }
    if ((m = L.match(/^(#{1,4})\s+(.*)$/))) { out.push({ t: 'h', lvl: m[1].length, text: m[2], a: i, b: i }); i++; continue; }
    if (/^(-{3,}|\*{3,})\s*$/.test(L)) { out.push({ t: 'hr', a: i, b: i }); i++; continue; }
    if (/^>\s?/.test(L)) {
      let j = i; const q = [];
      while (j < lines.length && /^>\s?/.test(lines[j])) q.push(lines[j++].replace(/^>\s?/, ''));
      const cm = q[0] && q[0].match(/^\[!(\w+)\]\s*(.*)$/);
      out.push({ t: 'quote', kind: cm ? cm[1].toLowerCase() : null, title: cm ? cm[2] : null, lines: cm ? q.slice(1) : q, a: i, b: j - 1 }); i = j; continue;
    }
    if (/^\|.*\|\s*$/.test(L) && /^\|?[\s:|-]+\|?\s*$/.test(lines[i + 1] || '')) {
      const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = cells(L), rows = []; let j = i + 2;
      while (j < lines.length && /^\|.*\|\s*$/.test(lines[j])) rows.push(cells(lines[j++]));
      out.push({ t: 'table', head, rows, a: i, b: j - 1 }); i = j; continue;
    }
    if ((m = L.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/))) { out.push({ t: 'figure', alt: m[1], src: m[2], a: i, b: i }); i++; continue; }
    if (/^\s*([-*]|\d+[.)])\s+/.test(L)) {
      let j = i; const items = []; const ordered = /^\s*\d+[.)]/.test(L);
      while (j < lines.length) {
        const im = lines[j].match(/^(\s*)([-*]|\d+[.)])\s+(.*)$/);
        if (im) {
          const tm = im[3].match(/^\[( |x|X)\]\s+(.*)$/);
          items.push({ line: j, indent: im[1].length, text: tm ? tm[2] : im[3], rawText: tm ? tm[2] : null, task: tm ? tm[1].toLowerCase() === 'x' : null, marker: im[2] }); j++;
        } else if (lines[j].trim() && /^\s{2,}/.test(lines[j]) && items.length) { items[items.length - 1].text += ' ' + lines[j].trim(); j++; }
        else if (!lines[j].trim() && /^\s*([-*]|\d+[.)])\s+/.test(lines[j + 1] || '') && ordered) { j++; }
        else break;
      }
      let end = j - 1; while (end > i && !lines[end].trim()) end--;
      out.push({ t: 'list', ordered, items, a: i, b: end }); i = j; continue;
    }
    let j = i; const para = [];
    while (j < lines.length && lines[j].trim() && (j === i || !isStart(lines[j]))) para.push(lines[j++]);
    out.push({ t: 'p', text: para.join(breaks ? '\n' : ' '), a: i, b: j - 1 }); i = j;
  }
  return out;
}

const MDC = { doc: null, section: '', previewLinks:false, interactive:false, taskIndex:0, aboveSteps:true, questionText:'' };
const TASK_LIST_ITEM = /^(\s*(?:[-*]|\d+[.)])\s+\[)( |x|X)(\]\s+)(.*?)(\r?)$/;
const MD_STEP_HEAD = /^(?:(?:Ask|Note|Canvas)(?:\s*·\s*.*)?|(?:\[[ xX]\]\s+)?(?:Work|Grill|Prototype|Review|Discuss|Spec|Build|Check|Read|Outline|Slides|Draft|Deploy|Merge)(?:\s+\d+)?(?:\s*·\s*.*)?)$/i;
function toggleTaskInMd(text, index, checked, expected = '') {
  if (!Number.isInteger(index) || index < 0) return String(text ?? '');
  const lines = String(text ?? '').split('\n');
  const found = [];
  let fence = false, comment = false, mathClose = '', inList = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i], line = raw.replace(/\r$/, '');
    if (comment) { if (line.includes('-->')) comment = false; continue; }
    if (mathClose) { if (line.includes(mathClose)) mathClose = ''; continue; }
    if (!fence && /^<!--/.test(line)) { if (!line.includes('-->')) comment = true; inList = false; continue; }
    if (/^```/.test(line)) { fence = !fence; inList = false; continue; }
    if (fence) continue;
    if (!line.trim()) { inList = false; continue; }
    if (inList && /^\s{2,}/.test(line) && !/^\s*(?:[-*]|\d+[.)])\s+/.test(line)) continue;
    if (!inList && MATH_BLOCK.test(line)) {
      const open = line.trim(), env = open.match(/^\\begin\{([a-z]+)(\*?)\}/);
      const close = open.startsWith('$$') ? '$$' : open.startsWith('\\[') ? '\\]' : `\\end{${env[1]}${env[2]}}`;
      const rest = env ? open.slice(open.indexOf('}') + 1) : open.slice(2);
      if (!rest.includes(close)) mathClose = close;
      continue;
    }
    if (/^\s*(?:[-*]|\d+[.)])\s+/.test(line)) {
      inList = true;
      const m = raw.match(TASK_LIST_ITEM);
      if (m) found.push({ i, m, text: m[4].trim() });
      continue;
    }
    inList = false;
  }
  const want = typeof expected === 'string' ? expected.trim() : '';
  let hit = found[index] || null;
  if (want && (!hit || hit.text !== want)) {
    const matches = found.filter(t => t.text === want);
    hit = matches.length === 1 ? matches[0] : null;
  }
  if (!hit) return String(text ?? '');
  const m = hit.m;
  lines[hit.i] = `${m[1]}${checked ? 'x' : ' '}${m[3]}${m[4]}${m[5]}`;
  return lines.join('\n');
}
function toggleTaskLineInDoc(md, lineIndex, checked, expected = '') {
  const lines = String(md ?? '').split('\n');
  if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= lines.length) return null;
  const m = lines[lineIndex].match(TASK_LIST_ITEM);
  if (!m) return null;
  const want = typeof expected === 'string' ? expected.trim() : '';
  if (want && m[4].trim() !== want) return null;
  lines[lineIndex] = `${m[1]}${checked ? 'x' : ' '}${m[3]}${m[4]}${m[5]}`;
  return { line: `${m[1]}${checked ? 'x' : ' '}${m[3]}${m[4]}`, md: lines.join('\n') };
}
const mdPath = src => MDC.doc ? linkedPath(MDC.doc.path, src) : src;
const FILE_ICON = name => /\.(png|jpe?g|gif|webp|svg|heic)$/i.test(name) ? 'image' : /\.(pptx?|key)$/i.test(name) ? 'slides' : /\.(md|txt|docx?|pdf)$/i.test(name) ? 'doc' : 'file';

// Keep the bytes between links intact (code and math may already be held in slots).
function replaceMarkdownLinks(text, render) {
  let start = 0, out = '';
  for (const link of LINE_STATUS.markdownLinks(text)) {
    out += text.slice(start, link.start) + render(link);
    start = link.end;
  }
  return out + text.slice(start);
}
function workDocPath(p, detail, href) {
  const path = LINE_STATUS.linkedFilePath(href);
  if (!path) return '';
  const root = (p.vault?.path || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (/^(?:\/|[a-z]:\/|~\/)/i.test(path)) {
    const windows = /^[a-z]:\//i.test(root);
    const under = root && (windows ? path.toLowerCase().startsWith(root.toLowerCase() + '/') : path.startsWith(root + '/'));
    // Synced Works can still refer to their original absolute Work path after moving to Cloud.
    const rel = under ? path.slice(root.length + 1) : !root && path.endsWith('/' + detail) ? detail : '';
    return rel && fileEntry(p, rel) ? rel : '';
  }
  // Keep a leading marker so climbing above the docs folder cannot accidentally point to a different project file.
  const based = resolvePath('@/' + detail, path);
  const relative = based.startsWith('@/') ? based.slice(2) : '';
  return relative && fileEntry(p, relative) ? relative : fileEntry(p, path) ? path : '';
}
function workFileAnchor(label, href, p, doc) {
  if (!doc?.path) return '';
  const path = workDocPath(p, doc.path, href);
  if (path) {
    const url = /\.md$/i.test(path) && !EMBED ? '#' + routeToHash({ view:'doc', doc:path }) : fileUrl(p, path);
    return `<a href="${esc(url)}" target="_blank" rel="noopener" data-act="preview-work-file" data-path="${esc(path)}">${esc(label)}</a>`;
  }
  if (!doc.codeLinks?.has(href) || HOSTED) return '';
  const file = LINE_STATUS.linkedFilePath(href);
  const url = apiUrl(`${pathFor(p.id)}/result-file?doc=${encodeURIComponent(doc.path)}&href=${encodeURIComponent(href)}`);
  return `<a href="${esc(url)}" target="_blank" rel="noopener" data-act="preview-work-file" data-name="${esc(file.split('/').pop())}">${esc(label)}</a>`;
}
ACT['preview-work-file'] = async el => {
  const p = project(), path = el.dataset.path || el.dataset.doc, box = $('#lightbox');
  if (!box.contains(el)) {
    const app = $('#app'), wasInert = app.inert;
    app.inert = true;
    box.addEventListener('penecho-lightbox-closed', () => {
      app.inert = wasInert;
      el.focus({ preventScroll:true });
    }, { once:true });
  }
  if (!path) {
    openLightbox(p, { name:el.dataset.name, url:el.href, workFile:true });
  } else if (/\.md$/i.test(path)) {
    // Show the shell immediately so a later click or dismissal wins over a slow read.
    const title = path.split('/').pop();
    showViewer(title, '', true);
    const body = $('.viewer-body', box);
    $('.viewer-tools', box).hidden = true;
    body.setAttribute('role', 'status');
    body.textContent = 'Loading…';
    try {
      const doc = await loadDoc(p, path);
      if (body.isConnected) showViewer(title, doc.md, true, doc);
    } catch (error) { if (body.isConnected) body.textContent = error.message; }
  } else {
    openLightbox(p, path);
  }
};
function inlineMd(text, p, l) {
  const slots = [];
  const hold = html => { slots.push(html); return `\u0000${slots.length - 1}\u0000`; };
  let s = String(text);
  s = s.replace(/`([^`]+)`/g, (_, c) => hold(`<code>${esc(c)}</code>`));
  s = holdMath(s, hold);
  if (MDC.previewLinks || (MDC.doc?.kind === 'detail' && MDC.section === 'Result')) {
    s = replaceMarkdownLinks(s, link => {
      if (link.image) return s.slice(link.start, link.end);
      const html = /^https?:\/\//i.test(link.href)
        ? `<a href="${esc(link.href)}" target="_blank" rel="noopener">${esc(link.name)}</a>`
        : workFileAnchor(link.name, link.href, p, MDC.doc) || esc(link.name);
      return hold(html.replace(/\u0000(\d+)\u0000/g, (_, n) => slots[+n] || ''));
    });
  }
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => hold(`<img class="md-inline-img" alt="${esc(alt)}" src="${esc(assetUrl(p, mdPath(src)))}">`));
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    if (/^https?:/.test(href)) return hold(`<a href="${esc(href)}" target="_blank" rel="noopener">${esc(label)}</a>`);
    const path = mdPath(href), d = p && docByPath(p, path);
    if (d) return hold(`<button type="button" class="doc-ref" data-act="open-doc" data-doc="${esc(d.path)}">${ic('doc', 14)}<span>${esc(label)}</span></button>`);
    return hold(`<button type="button" class="file-ref" data-act="open-asset" data-path="${esc(path)}">${ic(FILE_ICON(path), 15)}<span>${esc(label)}</span></button>`);
  });
  s = esc(s);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/(^|[\s(])@([a-z][\w-]{1,30})\b/gi, (_, a, id) => `${a}<span class="mention">${av(id.toLowerCase(), 18)}${esc(agentInfo(id.toLowerCase()).name)}</span>`);
  s = s.replace(/\b([A-Z]{2}-\d{1,5})\b/g, (m, code) => {
    const line = p && allLines(p).find(x => x.code === code);
    if (line && MDC.previewLinks) return `<button type="button" class="line-ref" data-act="preview-work-file" data-path="${esc(line.topicPath)}">${code}</button>`;
    return line ? `<button type="button" class="line-ref" data-act="open-line" data-line="${esc(line.id)}">${code}</button>` : code;
  });
  return s.replace(/\u0000(\d+)\u0000/g, (_, n) => slots[+n]);
}

function blockHTML(b, p, opts) {
  const src = `data-a="${b.a}" data-b="${b.b}"`;
  if (b.t === 'p') {
    return `<p class="md-p" ${src}>${inlineMd(b.text, p).replace(/\n/g, '<br>')}</p>`;
  }
  if (b.t === 'math') return `<div class="md-math" ${src}>${mathSpan(b.tex, true)}</div>`;
  if (b.t === 'h') return `<h${b.lvl + 1} class="md-h${b.lvl}" ${src}>${inlineMd(b.text, p)}</h${b.lvl + 1}>`;
  if (b.t === 'hr') return `<hr ${src}>`;
  if (b.t === 'code') {
    return `<figure class="md-code" ${src}><figcaption><span>${esc(b.lang || 'text')}</span><button type="button" class="ghost tiny" data-act="copy-code">${ic('copy', 14)}Copy</button></figcaption><pre><code>${esc(b.code)}</code></pre></figure>`;
  }
  if (b.t === 'figure') {
    const path = mdPath(b.src), url = assetUrl(p, path), c = p && canvasByPath(p, path);
    if (c) return `<figure class="md-fig is-canvas" ${src}><button type="button" class="fig-img" data-act="open-canvas" data-canvas="${esc(c.source)}" data-doc="${esc(MDC.doc?.path || '')}" aria-label="Edit ${esc(b.alt)} on the Canvas"><img alt="${esc(b.alt)}" src="${esc(url)}"></button><figcaption><strong>${esc(b.alt)}</strong><span>${esc(path)}</span>${pptDownloadButton(c, 'btn sm fig-edit')}<button type="button" class="btn sm fig-edit" data-act="open-canvas" data-canvas="${esc(c.source)}" data-doc="${esc(MDC.doc?.path || '')}">${ic('pen', 14)}Edit on Canvas</button></figcaption></figure>`;
    return `<figure class="md-fig" ${src}>${url ? `<img alt="${esc(b.alt)}" src="${esc(url)}">` : `<div class="md-missing">${ic('image', 22)}${esc(path)}</div>`}<figcaption>${esc(b.alt)}<span>${esc(path)}</span></figcaption></figure>`;
  }
  if (b.t === 'table') {
    return `<div class="md-table" ${src}><table><thead><tr>${b.head.map(h => `<th>${inlineMd(h, p)}</th>`).join('')}</tr></thead><tbody>${b.rows.map(r => `<tr>${r.map(c => `<td>${inlineMd(c, p)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  if (b.t === 'quote') {
    if (b.kind === 'status') {
      const l = MDC.doc && p && lineOfDoc(p, MDC.doc), rest = l ? b.lines.filter(x => !/^(Finished|Next):/.test(x)) : b.lines;
      return `<aside class="callout c-status" ${src}><div class="c-body"><div class="c-title">${inlineMd(b.title || '', p)}</div>${l ? statusDots(l) : ''}${rest.map(x => `<p>${inlineMd(x, p)}</p>`).join('')}</div></aside>`;
    }
    if (b.kind) {
      const icon = { decision: 'check', note: 'hint', warning: 'hint' }[b.kind] || 'hint';
      const tail = (b.lines.join(' ').match(/((?:@\w+|[A-Z]{2}-\d+)(?:\s*·\s*(?:@\w+|[A-Z]{2}-\d+))*)\s*$/) || [])[1] || '';
      const body = tail ? b.lines.join(' ').slice(0, -tail.length).trim() : b.lines.join(' ');
      return `<aside class="callout c-${esc(b.kind)}" ${src}><div class="c-icon">${ic(icon, 16)}</div><div class="c-body"><div class="c-kind">${esc(b.kind[0].toUpperCase() + b.kind.slice(1))}</div><div class="c-title">${inlineMd(b.title || '', p)}</div>${body ? `<p>${inlineMd(body, p)}</p>` : ''}${tail ? `<div class="c-tail">${inlineMd(tail, p)}</div>` : ''}</div></aside>`;
    }
    return `<blockquote class="md-quote" ${src}>${inlineMd(b.lines.join(' '), p)}</blockquote>`;
  }
  if (b.t === 'list') {
    const defs = b.items.length > 1 && b.items.every(it => it.task == null && /^\*\*[^*]+:\*\*/.test(it.text));
    if (defs) {
      return `<dl class="md-defs" ${src}>${b.items.map(it => { const m = it.text.match(/^\*\*([^*]+):\*\*\s*(.*)$/); return `<div><dt>${inlineMd(m[1], p)}</dt><dd>${inlineMd(m[2], p)}</dd></div>`; }).join('')}</dl>`;
    }
    const tasks = b.items.some(it => it.task != null);
    const tag = b.ordered ? 'ol' : 'ul';
    const start = b.ordered ? (parseInt(b.items[0].marker, 10) || 1) : 1;
    const locked = !MDC.interactive || (MDC.doc?.generated && MDC.section !== 'Questions for you');
    return `<${tag} class="md-list ${tasks ? 'tasks' : ''}" ${b.ordered && start > 1 ? `start="${start}"` : ''} ${src}>${b.items.map(it => {
      if (it.task == null) return `<li>${inlineMd(it.text, p)}</li>`;
      const question = MDC.doc?.kind === 'topic' && MDC.questionLines?.get(it.line);
      const inQuestions = MDC.doc?.kind === 'topic' && MDC.section === 'Questions for you';
      const prompt = question?.text || (inQuestions ? MDC.questionText : '');
      const source = (question || inQuestions) && MDC.doc.hash;
      const disabled = locked || (inQuestions && MDC.questionLines && !question);
      return `<li class="task ${it.task ? 'done' : ''}"><label><input type="checkbox" data-task-line="${it.line}" data-task-index="${MDC.taskIndex++}" data-task-text="${esc(it.rawText ?? it.text)}"${prompt ? ` data-question-text="${esc(prompt)}"` : ''}${source ? ` data-question-source="${esc(source)}"` : ''} ${it.task ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span>${inlineMd(it.text, p)}</span></label></li>`;
    }).join('')}</${tag}>`;
  }
  return '';
}

function metaStrip(b, p) {
  return `<div class="md-meta" data-a="${b.a}" data-b="${b.b}">${b.meta.filter(([k]) => k !== 'topic' || /\.md$/.test(b.meta.find(x => x[0] === k)[1])).map(([k, v]) => `<div><span>${esc(k[0].toUpperCase() + k.slice(1))}</span><strong>${inlineMd(/\.md$/.test(v) ? `[${v}](${v})` : v, p)}</strong></div>`).join('')}</div>`;
}

// Words someone typed, such as an Ask or a note: Markdown and LaTeX, with the line breaks they typed. No sections, title or reading depth.
function wordsMd(text, p, { interactive = false } = {}) {
  MDC.doc = null; MDC.section = ''; MDC.previewLinks = false; MDC.interactive = Boolean(interactive); MDC.taskIndex = 0; MDC.aboveSteps = false; MDC.questionText = '';
  const blocks = parseMd(texPrep(text).replace(/^---\n/, '\n'), { breaks:true });
  const html = blocks.map(b => b.t === 'meta' ? '' : b.t === 'h' ? `<p class="md-p md-in-h md-in-h${b.lvl}" data-a="${b.a}" data-b="${b.b}"><strong>${inlineMd(b.text, p)}</strong></p>` : blockHTML(b, p)).join('');
  MDC.interactive = false;
  return html;
}
// Sections read as a page: the heading holds still on the left while its content scrolls beside it.
function renderMd(md, p, { compact = false, doc = null, status = true, previewLinks = false, interactive = false } = {}) {
  MDC.doc = doc; MDC.section = ''; MDC.previewLinks = previewLinks; MDC.interactive = Boolean(interactive); MDC.taskIndex = 0; MDC.aboveSteps = true; MDC.questionText = '';
  const line = doc?.kind === 'topic' && p && typeof lineOfDoc === 'function' ? lineOfDoc(p, doc) : null;
  MDC.questionLines = doc?.hash && doc.hash === line?.topicHash
    ? new Map((line.questions || []).flatMap(q => (q.optionLines || []).map(at => [at, q])))
    : null;
  const blocks = parseMd(md);
  // The overview leads with a Canvas picture when there is one, since those explain the Topic.
  const figs = blocks.filter(b => b.t === 'figure'), lead = figs.find(b => p && canvasByPath(p, mdPath(b.src))) || figs[0];
  let head = '', meta = '', html = '', section = null, leadDone = false, seenH1 = false;
  const close = () => { if (section) { html += `<section class="md-sec ${section.cls}" id="${section.id}"><div class="md-sec-h">${section.h}</div><div class="md-sec-b">${section.body}</div></section>`; section = null; } };
  blocks.forEach(b => {
    if (b.t === 'meta') { meta = metaStrip(b, p); return; }
    if (!status && b.t === 'quote' && b.kind === 'status') return;
    if (b.t === 'h' && b.lvl === 1) { head += `<h1 class="md-title" data-a="${b.a}" data-b="${b.b}">${inlineMd(b.text, p)}</h1>`; seenH1 = true; return; }
    if (!section && b.t === 'p' && !leadDone && seenH1) { head += `<p class="md-lead" data-a="${b.a}" data-b="${b.b}">${inlineMd(b.text, p)}</p>`; leadDone = true; return; }
    if (b.t === 'h' && b.lvl === 2) {
      close();
      MDC.section = b.text;
      if (MD_STEP_HEAD.test(b.text.trim())) MDC.aboveSteps = false;
      MDC.questionText = '';
      section = { id: 'sec-' + slug(b.text), cls: /^Ask\b/.test(b.text) ? 'words-sec' : '', h: `<h2 class="md-h2" data-a="${b.a}" data-b="${b.b}">${inlineMd(b.text.replace(/^\[[xX]\] /, '✓ ').replace(/^\[ \] /, ''), p)}</h2>`, body: '', count: 0 };
      return;
    }
    if (MDC.doc?.kind === 'topic' && MDC.section === 'Questions for you') {
      if (b.t === 'p') {
        const raw = b.text.trim();
        if (raw && raw !== 'Tick one here, in any Markdown editor, or in PenEcho.') {
          const qm = raw.match(/^\*\*(.+?)\*\*(?:\s*\(@([^)]+)\))?\s*$/);
          MDC.questionText = qm ? qm[1].trim() : raw.replace(/\s*\(@([^)]+)\)\s*$/, '').replace(/^\*\*(.+?)\*\*$/, '$1').trim();
        }
      } else if (b.t === 'h' && b.lvl >= 3) {
        MDC.questionText = b.text.trim().replace(/\s*\(@([^)]+)\)\s*$/, '').replace(/^\*\*(.+?)\*\*$/, '$1').trim();
      } else if (b.t === 'list' && b.ordered && !b.items.some(it => it.task != null) && b.items.length) {
        MDC.questionText = String(b.items[b.items.length - 1].text || '').trim().replace(/\s*\(@([^)]+)\)\s*$/, '').replace(/^\*\*(.+?)\*\*$/, '$1').trim();
      }
    }
    // Reading depth: k blocks show in Key points, and the first picture shows in Overview too.
    const isFig = b.t === 'figure', key = isFig || (b.t === 'quote' && b.kind) || (section && section.count === 0);
    const glance = b === lead; if (glance && section) section.cls += ' has-g';
    const wrapped = `<div class="mb ${key ? 'k' : ''} ${glance ? 'g' : ''}">${blockHTML(b, p)}</div>`;
    if (section) { section.body += wrapped; section.count++; } else html += wrapped;
  });
  close();
  MDC.previewLinks = false;
  MDC.interactive = false;
  MDC.questionText = '';
  return `<article class="md ${compact ? 'compact' : ''}">${head || meta ? `<header class="md-head">${head}${meta}</header>` : ''}${html}</article>`;
}
function statusDots(l) {
  const cur = currentStation(l), state = lineState(l);
  return `<ol class="sdots" aria-label="Steps">${l.stations.map(s => `<li class="sd sd-${s.state} ${s === cur && !l.landed ? 'on' : ''} st-${state}"><i></i>${esc(stepLabel(s))}</li>`).join('')}</ol>`;
}

function highlightSource(md) {
  let fence = false, front = md.startsWith('---\n');
  let frontEnded = !front;
  return md.split('\n').map((line, n) => {
    let cls = '', html = esc(line);
    if (/^<!--.*-->\s*$/.test(line)) cls = 'src-front';
    else if (front && !frontEnded) {
      cls = 'src-front';
      if (n > 0 && line === '---') frontEnded = true;
    } else if (/^```/.test(line)) { fence = !fence; cls = 'src-fence'; }
    else if (fence) cls = 'src-codeblock';
    else if (/^#{1,6}\s/.test(line)) cls = 'src-h';
    else if (/^>\s?/.test(line)) cls = 'src-q';
    else if (/^\|/.test(line)) cls = 'src-t';
    if (!fence && cls !== 'src-fence' && cls !== 'src-front') {
      html = html.replace(/^(\s*)([-*]|\d+[.)])(\s)/, '$1<i class="tk-m">$2</i>$3')
        .replace(/\*\*([^*]+)\*\*/g, '<b class="tk-b">**$1**</b>')
        .replace(/`([^`]+)`/g, '<i class="tk-c">`$1`</i>')
        .replace(/(!?\[[^\]]*\]\([^)]*\))/g, '<i class="tk-l">$1</i>')
        .replace(/(^|\s)(@\w+)/g, '$1<i class="tk-at">$2</i>');
    }
    return `<div class="src-line ${cls}" data-n="${n}"><span class="src-gut">${n + 1}</span><code>${html || ' '}</code></div>`;
  }).join('');
}

// In the Vault a Topic reads as a plain file: where it stands and how to add to it are on its own page.
const readerLineArchived = (p, doc) => {
  const line = doc?.kind === 'topic' && lineOfDoc(p, doc);
  return Boolean(line?.archived || line?.closed);
};
const readerBody = (md, p, doc, embedded) => renderMd(md, p, { compact: embedded, status: !embedded, doc, interactive: Boolean(doc && !doc.memory && !(typeof HOSTED !== 'undefined' && HOSTED?.read) && !readerLineArchived(p, doc)) });
// One reader for every document: Reading, Split and Source. Edits go straight back to the Markdown.
const Reader = {
  mode: 'read',
  html(doc, p, { mode, embedded = false } = {}) {
    // MEMORY.md is kept by agents with its command; here it is read, and an earlier version can come back (Recover).
    const archived = readerLineArchived(p, doc);
    const m = mode || this.mode, canEdit = !doc.generated && !doc.memory && !archived, line = embedded && lineOfDoc(p, doc);
    return `<div class="reader mode-${m} ${embedded ? 'embedded' : ''}" data-doc="${esc(doc.path)}">
      <div class="reader-bar">
        <div class="reader-path">${ic(doc.memory ? 'memory' : 'doc', 17)}<span>${esc(doc.path)}</span></div>
        <div class="seg" role="tablist" aria-label="Document view">
          ${[['read', 'Reading', 'read'], ['split', 'Split', 'split'], ['source', 'Source', 'code']].map(([k, label, icon]) => `<button type="button" role="tab" aria-selected="${m === k}" data-act="reader-mode" data-mode="${k}">${ic(icon, 15)}<span>${label}</span></button>`).join('')}
        </div>
        <div class="reader-tools">
          ${canEdit ? `${embedded ? '' : `<button type="button" class="ghost" data-act="add-visual" data-doc="${esc(doc.path)}">${ic('canvas', 15)}<span>Add picture</span></button>
          <button type="button" class="ghost" data-act="draw-doc" data-doc="${esc(doc.path)}">${ic('pen', 15)}<span>Draw on this</span></button>`}
          <button type="button" class="ghost" data-act="reader-edit" id="rdEdit">${ic('doc', 15)}<span>Edit</span></button>` : archived ? '' : `<span class="reader-kept">${doc.kind === 'readme' ? 'Kept by PenEcho' : 'Kept by agents'}</span>${doc.memory && !HOSTED ? `<button type="button" class="ghost" data-act="memory-recover" title="Recover an earlier version" aria-label="Recover an earlier version">${ic('undo', 15)}<span>Recover</span></button>` : ''}`}
          <button type="button" class="ghost" data-act="reader-download" data-doc="${esc(doc.path)}">${ic('down', 15)}<span>Download</span></button>
          ${line ? `<button type="button" class="btn sm vault-go" data-act="open-doc" data-doc="${esc(doc.path)}">Open this Topic${ic('right', 14)}</button>` : ''}
        </div>
      </div>
      <div class="reader-panes">
        <div class="rd-pane rd-rendered depth-all" id="rdRendered">
          <div class="depth seg" role="tablist" aria-label="How much to read">${[['glance', 'Overview'], ['key', 'Key points'], ['all', 'Everything']].map(([k, l]) => `<button type="button" role="tab" aria-selected="${k === 'all'}" data-act="reader-depth" data-depth="${k}"><span>${l}</span></button>`).join('')}</div>
          <div id="rdBody">${readerBody(doc.md, p, doc, embedded)}</div>
        </div>
        <div class="rd-pane rd-source" id="rdSource"><div class="src" id="rdSrc">${highlightSource(doc.md)}</div><textarea id="rdArea" class="src-edit" spellcheck="false" hidden aria-label="Edit Markdown source"></textarea></div>
      </div>
    </div>`;
  },
  refresh(el, doc, p) {
    const r = $('#rdBody', el), s = $('#rdSrc', el);
    if (r) { const pane = $('#rdRendered', el), top = pane.scrollTop; r.innerHTML = readerBody(doc.md, p, doc, el.classList.contains('embedded')); pane.scrollTop = top; }
    if (s && !$('#rdArea', el)?.matches(':focus')) s.innerHTML = highlightSource(doc.md);
    el._md = doc.md;
  },
  bind(el, doc, p, onChange) {
    el.addEventListener('change', e => {
      const box = e.target.closest('[data-task-line]'); if (!box || box.disabled) return;
      const n = +box.dataset.taskLine, checked = Boolean(box.checked);
      const expectedText = box.dataset.taskText || '', questionText = box.dataset.questionText || '';
      const area = $('#rdArea', el);
      // While editing in Split view, toggle inside the draft textarea instead of saving against stale doc.md.
      if (area && !area.hidden) {
        const patched = toggleTaskLineInDoc(area.value, n, checked, expectedText);
        if (patched) {
          area.value = patched.md;
          const r = $('#rdBody', el);
          if (r) { const pane = $('#rdRendered', el), top = pane.scrollTop; r.innerHTML = readerBody(area.value, p || project(), doc, el.classList.contains('embedded')); pane.scrollTop = top; }
          onChange?.();
        }
        return;
      }
      box.closest('li.task')?.classList.toggle('done', checked);
      const ownerProject = p || project();
      doc._taskPending = (doc._taskPending || 0) + 1;
      const prev = doc._taskQueue || Promise.resolve();
      const run = prev.catch(() => {}).then(async () => {
        try {
          if (doc.kind === 'topic') {
            await answerFromBox(el, doc, { line: n, checked, expectedText, questionText, questionSource:box.dataset.questionSource, ownerProject }, onChange);
            return;
          }
          const patched = toggleTaskLineInDoc(doc.md, n, checked, expectedText);
          if (!patched) throw new Error('That checkbox changed. Refresh and try again.');
          await saveDoc(ownerProject, doc, patched.md);
          onChange?.();
        } catch (error) {
          toast(error.message);
        } finally {
          doc._taskPending = Math.max(0, (doc._taskPending || 1) - 1);
          if (!doc._taskPending && el.isConnected) Reader.refresh(el, doc, ownerProject);
        }
      });
      doc._taskQueue = run;
      run.finally(() => { if (doc._taskQueue === run) doc._taskQueue = null; });
    });
    // Point at a block to find its source lines, in either direction.
    el.addEventListener('pointerover', e => {
      if (!el.classList.contains('mode-split')) return;
      const block = e.target.closest('[data-a]');
      $$('.src-line.hl', el).forEach(x => x.classList.remove('hl'));
      $$('.rd-rendered .hl', el).forEach(x => x.classList.remove('hl'));
      if (!block || !block.closest('.rd-rendered')) return;
      block.classList.add('hl');
      const a = +block.dataset.a, b = +block.dataset.b;
      for (let i = a; i <= b; i++) $(`.src-line[data-n="${i}"]`, el)?.classList.add('hl');
      const first = $(`.src-line[data-n="${a}"]`, el), pane = $('#rdSource', el);
      if (first && pane) {
        const pr = pane.getBoundingClientRect(), fr = first.getBoundingClientRect();
        if (fr.top < pr.top + 8 || fr.bottom > pr.bottom - 8) pane.scrollTop += fr.top - pr.top - 60;
      }
    });
    el.addEventListener('click', e => {
      const srcLine = e.target.closest('.src-line');
      if (!srcLine || !el.classList.contains('mode-split')) return;
      const n = +srcLine.dataset.n;
      const hit = $$('.rd-rendered [data-a]', el).find(b => n >= +b.dataset.a && n <= +b.dataset.b);
      if (hit) { hit.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' }); hit.classList.add('flash'); setTimeout(() => hit.classList.remove('flash'), 1100); }
    });
    const area = $('#rdArea', el);
    area?.addEventListener('input', () => {
      // The file is written when you press Done. Until then only the preview changes.
      const r = $('#rdBody', el);
      if (r) { const pane = $('#rdRendered', el), top = pane.scrollTop; r.innerHTML = readerBody(area.value, project(), doc, el.classList.contains('embedded')); pane.scrollTop = top; }
      onChange?.();
    });
  },
  flashEnd(el, doc) {
    const r = $('#rdBody', el), blocks = r ? $$('[data-a]', r) : [];
    if (!blocks.length) return;
    const lines = doc.md.split('\n'), cut = doc.lastAddedAt ?? lines.length - 1;
    const hits = blocks.filter(b => +b.dataset.a >= cut);
    (hits.length ? hits : [blocks[blocks.length - 1]]).forEach(b => { b.classList.add('flash'); setTimeout(() => b.classList.remove('flash'), 1800); });
    (hits[0] || blocks[blocks.length - 1]).scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
    const src = $('#rdSource', el), line = $(`.src-line[data-n="${cut}"]`, el);
    if (src && line) { src.scrollTop = line.offsetTop - 40; for (let i = cut; i < lines.length; i++) $(`.src-line[data-n="${i}"]`, el)?.classList.add('hl'); }
  },
};
ACT['reader-mode'] = el => {
  const m = el.dataset.mode, reader = el.closest('.reader');
  Reader.mode = m;
  reader.classList.remove('mode-read', 'mode-split', 'mode-source'); reader.classList.add('mode-' + m);
  $$('.seg button', reader).forEach(b => b.setAttribute('aria-selected', String(b.dataset.mode === m)));
};
ACT['reader-edit'] = async el => {
  const reader = el.closest('.reader'), area = $('#rdArea', reader), src = $('#rdSrc', reader), p = project();
  const doc = docById(reader.dataset.doc);
  if (readerLineArchived(p, doc)) { toast('Reopen this Line to edit it.'); return; }
  if (area.hidden) {
    if (reader.classList.contains('mode-read')) ACT['reader-mode']($('.seg button[data-mode="split"]', reader));
    area.value = doc.md; area.hidden = false; src.hidden = true; area.focus();
    el.innerHTML = `${ic('check', 15)}<span>Done</span>`;
    return;
  }
  await finishEdit(reader);
};
// Writes what you typed. If the file changed underneath you, nothing of yours is lost and you choose.
async function finishEdit(reader, { quiet = false } = {}) {
  const area = $('#rdArea', reader), src = $('#rdSrc', reader), p = project(), doc = docById(reader.dataset.doc), button = $('#rdEdit', reader);
  if (!area || area.hidden || !doc) return true;
  const text = area.value, changed = text !== doc.md;
  if (changed && readerLineArchived(p, doc)) { toast('Reopen this Line to save your edits.'); return false; }
  try {
    if (changed) {
      const saved = await saveDoc(p, doc, text);
      await loadState(p.id, { force:true });
      if (!quiet) toast(saved.picked ? `Saved. The agent will pick this up from ${doc.path.split('/').pop()}.` : `Saved ${doc.path.split('/').pop()}`);
    }
  } catch (error) {
    if (error.status !== 409) { toast(error.message); return false; }
    toast('This file changed while you were editing. Your text is still here.', { label:'Keep mine', fn:async () => { await saveDoc(p, doc, text, { baseHash:null }); await finishEdit(reader); } });
    doc.hash = error.data.currentHash;
    return false;
  }
  area.hidden = true; src.hidden = false;
  if (button) button.innerHTML = `${ic('doc', 15)}<span>Edit</span>`;
  Reader.refresh(reader, doc, p);
  if (!quiet) refreshAfterChange();
  return true;
}
ACT['reader-depth'] = el => {
  const pane = el.closest('.rd-rendered');
  pane.classList.remove('depth-glance', 'depth-key', 'depth-all'); pane.classList.add('depth-' + el.dataset.depth);
  $$('.depth button', pane).forEach(b => b.setAttribute('aria-selected', String(b === el)));
};
ACT['reader-download'] = async el => { const p = project(), doc = await loadDoc(p, el.dataset.doc); openMenu(el, await downloadItems(p, doc), { align:'right' }); };
// A new picture opens on the real Canvas. It is linked into the file when it is first saved, so no link ever points at nothing.
ACT['add-visual'] = el => {
  const p = project(), docPath = el.dataset.doc, l = allLines(p).find(x => x.topicPath === docPath);
  if (l?.archived || l?.closed) { toast('Reopen this Line to add a picture.'); return; }
  const draw = () => openCanvasPage(canvasUrl(p, { source:freeSource(p, l ? `files/${l.slug}` : 'files', 'canvas'), doc:docPath, title:'Canvas' }));
  const asks = l && availableAgents().length ? [{ head:`Ask ${agentInfo(l.agent || availableAgents()[0].id).name} to draw` }, ...PICTURE_ASKS.map(item => ({ label:item.label, icon:item.icon, fn:() => sendFeedback(l, { text:item.text }).then(() => { refreshAfterChange(); if (S.route.view !== 'line') go({ view:'line', line:l.id }); }).catch(error => toast(error.message)) })), { sep:1 }] : [];
  openMenu(el, [...asks, { label:'Draw it myself on the Canvas', icon:'canvas', fn:draw }], { align:'right' });
};
ACT['open-doc'] = el => openDoc(el.dataset.doc, el);
ACT['open-canvas'] = el => {
  // A drawing on a line keeps its button in a footer under the picture, so look in the whole card.
  const p = project(), c = canvasByPath(p, el.dataset.canvas), card = el.closest('.lp-pic, .result-pic, .lp-drawing'), from = (card && $('.pic-preview', card)) || el;
  if (c) openCanvasPage(canvasUrl(p, { source:c.source, doc:el.dataset.doc || (c.topic ? `lines/${c.topic}.md` : ''), title:c.title }), from);
};
function openDoc(path, from, opts) {
  const o = from ? { ...opts, from } : opts;
  if (path === 'MEMORY.md') go({ view:'memory' }, o);
  else go({ view:'doc', doc:path }, o);
}
// Turns what you typed and attached into real Markdown with real, relative references.
function appendedMd(doc, text, refs) {
  const parts = [];
  if (text.trim()) parts.push(text.trim());
  for (const f of refs) { const rel = relPath(doc.path, f.path); parts.push(/\.(png|jpe?g|gif|webp|svg)$/i.test(f.name) ? `![${f.name}](${rel})` : `[${f.name}](${rel})`); }
  const trimmed = doc.md.trimEnd();
  doc.lastAddedAt = trimmed.split('\n').length + 1;
  return `${trimmed}\n\n## Added by you, ${nowClock()}\n\n${parts.join('\n\n')}\n`;
}
