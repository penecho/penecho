// ---------- The Topics tab (PE-461) ----------
// The project's knowledge drawn as its architecture. On the left a tree: the project (understanding.md) at its root, then each Topic
// with its Subtopics. On the right the one you pick, as a page of its own built from its Markdown: the goal, the requirements by status,
// which Lines built which requirement, what is left and how the thinking changed. The plain file stays one click away in the Vault.

const TPX = { loading:new Set(), fresh:new Set(), sig:new Map(), scrollMain:false };
// A requirement's status, from its emoji first and then its words. "Being built" is read before "built".
const TPX_STATUS = [
  { k:'problem', e:'🐞', w:/\bproblem\b/i, label:'Problem' },
  { k:'building', e:'🔨', w:/being built|in progress/i, label:'In progress' },
  { k:'built', e:'✅', w:/\bbuilt\b|deployed|\bdone\b/i, label:'Done' },
  { k:'agreed', e:'📐', w:/agreed/i, label:'Agreed' },
  { k:'proposed', e:'💡', w:/proposed/i, label:'Proposed' },
  { k:'open', e:'❓', w:/not settled|undecided|\bopen\b/i, label:'Open' },
  { k:'later', e:'⏳', w:/\blater\b/i, label:'Later' },
];
const TPX_ORDER = ['problem', 'built', 'building', 'agreed', 'proposed', 'open', 'later', 'none'];
function tpxStatus(text) {
  const s = String(text || ''), hit = TPX_STATUS.find(x => s.includes(x.e)) || TPX_STATUS.find(x => x.w.test(s));
  // What follows the status word, such as "reported local", is the requirement's limit.
  const note = s.replace(/^[^\p{L}\p{N}]*/u, '').replace(hit ? new RegExp(`^(?:${hit.w.source})`, 'i') : /^$/, '').replace(/^\s*[·:,-]\s*/, '').trim();
  return hit ? { k:hit.k, label:hit.label, note } : { k:'none', label:s.replace(/^[^\p{L}\p{N}]*/u, '') || 'No status', note:'' };
}
const tpxChip = st => `<span class="tpx-st st-${st.k}"><i></i>${esc(st.label)}</span>`;
// Only a complete, recognizable date immediately after "Status on" is metadata.
// Never search later prose for a colon: URLs and service names often contain one.
const TPX_STATUS_PREFIX = (() => {
  const month = '(?:January|Jan\\.?|February|Feb\\.?|March|Mar\\.?|April|Apr\\.?|May|June|Jun\\.?|July|Jul\\.?|August|Aug\\.?|September|Sep(?:t|tember)?\\.?|October|Oct\\.?|November|Nov\\.?|December|Dec\\.?)';
  const day = '(?:0?[1-9]|[12]\\d|3[01])';
  const date = `(?:\\d{4}-(?:0[1-9]|1[0-2])-${day}|${month}\\s+${day},?\\s+\\d{4}|${day}\\s+${month}\\s+\\d{4})`;
  return new RegExp(`^Status on\\s+(${date})(?:(?:\\s*[:.—–-]\\s*|\\s+)([\\s\\S]*))?$`, 'i');
})();
function tpxParseStatus(text) {
  const source = String(text ?? '').trim(), match = source.match(TPX_STATUS_PREFIX);
  if (match) return { date:match[1], body:String(match[2] || '').trim() };
  return { date:'', body:source.replace(/^Status on\b\s*/i, '').trim() };
}
// Words from a Topic: a link to a Topic stays on this page, a link to a Line opens the line, and struck-out text reads as struck out.
function tpxLinks(html, p) {
  return html.replace(/data-act="open-doc" data-doc="((?:topics\/[^"]+\.md)|understanding\.md)"/g, 'data-act="tp-show" data-topic="$1"')
    .replace(/data-act="open-doc" data-doc="lines\/([^"/]+)\.md"/g, (m, name) => { const l = allLines(p).find(x => x.slug === name); return l ? `data-act="open-line" data-line="${esc(l.id)}"` : m; });
}
const tpxInline = (text, p) => tpxLinks(inlineMd(text, p), p).replace(/~~([^~]+)~~/g, '<del>$1</del>');
const tpxBlocks = (blocks, p) => tpxLinks(blocks.map(b => blockHTML(b, p)).join(''), p);
const tpxPlain = s => String(s || '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`~]/g, '').trim();
const tpxRefs = s => {
  const out = new Set();
  for (const m of String(s || '').matchAll(/R(\d+)(?:\s*[–-]\s*R?(\d+))?/g)) { const a = +m[1], b = m[2] ? +m[2] : a; for (let i = a; i <= Math.min(b, a + 30); i++) out.add(`R${i}`); }
  return [...out];
};
const tpxSlugOf = href => (String(href || '').match(/(?:^|\/)lines\/([^/#?]+)\.md/) || [])[1] || '';
const tpxLink = s => String(s || '').match(/\[([^\]]+)\]\(([^)]+)\)/);

// ---------- Reading a Topic's Markdown ----------
// Every Topic follows topics-guide.md, but an older or hand-written one still reads: whatever is not recognised is drawn as it is.
function tpxParse(md) {
  const t = { meta:{}, title:'', goal:'', status:'', intro:[], sections:[] };
  let sec = null;
  for (const b of parseMd(String(md || '').replace(/\r\n/g, '\n'))) {
    if (b.t === 'meta') { for (const [k, v] of b.meta) t.meta[k.trim()] = v; continue; }
    if (b.t === 'h' && b.lvl === 1 && !t.title) { t.title = b.text; continue; }
    if (b.t === 'h' && b.lvl === 2) { sec = { title:b.text, blocks:[] }; t.sections.push(sec); continue; }
    if (sec) { sec.blocks.push(b); continue; }
    if (b.t === 'p') {
      const goal = b.text.match(/^\*\*([^*]+)\*\*$/);
      if (goal && !t.goal) { t.goal = goal[1]; continue; }
      if (/^\[Understanding\]\(/.test(b.text)) continue;   // the breadcrumb: here the tree is the way around
      if (/^Status on\b/i.test(b.text) && !t.status) { t.status = b.text; continue; }
    }
    if (b.t === 'quote' && b.kind === 'status') continue;
    t.intro.push(b);
  }
  return t;
}
const tpxTake = (t, re) => { const i = t.sections.findIndex(s => re.test(s.title)); return i < 0 ? null : t.sections.splice(i, 1)[0]; };
const tpxTable = sec => sec?.blocks.find(b => b.t === 'table') || null;
const tpxCol = (table, re) => table.head.findIndex(h => re.test(h));
// "### R1 · Name — ✅ Built · limit", then its words and its Asked, Done and Left.
function tpxRequirements(sec, glance) {
  const out = [];
  let r = null;
  for (const b of sec?.blocks || []) {
    if (b.t === 'h' && b.lvl === 3) {
      const m = b.text.match(/^(R\d+)\s*[·.:]\s*(.+?)(?:\s+[—–]\s+(.+))?$/);
      r = { id:m ? m[1] : '', name:m ? m[2] : b.text, st:tpxStatus(m?.[3] || ''), blocks:[], asked:[], done:[], left:[] };
      out.push(r); continue;
    }
    if (!r) continue;
    if (b.t === 'list') {
      const rest = b.items.filter(it => {
        const m = it.text.match(/^\*\*(Asked|Done|Left)\s*:\*\*\s*(.*)$/i);
        if (m) r[m[1].toLowerCase()].push(m[2]);
        return !m;
      });
      if (rest.length) r.blocks.push({ ...b, items:rest });
      continue;
    }
    r.blocks.push(b);
  }
  // The At a glance table says the status too, and is the only list when there are no written requirements.
  const rows = glance ? glance.rows.map(row => ({ id:(row[0] || '').trim(), name:tpxPlain(row[1]), st:tpxStatus(row[2]) })) : [];
  for (const row of rows) {
    const known = out.find(x => x.id && x.id === row.id);
    if (known && known.st.k === 'none') known.st = row.st;
    if (!known) out.push({ ...row, blocks:[], asked:[], done:[], left:[] });
  }
  return out;
}

// ---------- Pictures drawn from the Topic ----------
// The ring: how many requirements are in each status.
function tpxRingHTML(reqs) {
  if (!reqs.length) return '';
  const n = {}; reqs.forEach(r => { n[r.st.k] = (n[r.st.k] || 0) + 1; });
  const C = 2 * Math.PI * 42;
  let at = 0;
  const arcs = TPX_ORDER.filter(k => n[k]).map(k => { const len = C * n[k] / reqs.length, arc = `<circle class="rg-${k}" cx="50" cy="50" r="42" stroke-dasharray="${Math.max(0, len - (reqs.length > 1 ? 2 : 0)).toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-at).toFixed(2)}"/>`; at += len; return arc; }).join('');
  const legend = TPX_ORDER.filter(k => n[k]).map(k => `<li class="st-${k}"><i></i>${esc((TPX_STATUS.find(x => x.k === k) || { label:'Other' }).label)}<b>${n[k]}</b></li>`).join('');
  return `<figure class="tpx-ring" aria-label="${esc(`${n.built || 0} of ${reqs.length} requirements built`)}"><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="rg-bg" cx="50" cy="50" r="42"/><g transform="rotate(-90 50 50)">${arcs}</g><text x="50" y="49" class="rg-n">${n.built || 0}<tspan class="rg-of">/${reqs.length}</tspan></text><text x="50" y="64" class="rg-l">built</text></svg><ul>${legend}</ul></figure>`;
}
const tpxCut = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const tpxWrap = (s, n, most = 2) => {
  const lines = [''];
  for (const w of String(s).split(/\s+/)) { const cur = lines[lines.length - 1]; if (!cur || (cur + ' ' + w).length <= n) lines[lines.length - 1] = cur ? `${cur} ${w}` : w; else lines.push(w); }
  return lines.length > most ? [...lines.slice(0, most - 1), tpxCut(lines.slice(most - 1).join(' '), n)] : lines;
};
const tpxCurve = (x1, y1, x2, y2) => { const mx = (x1 + x2) / 2; return `M${x1} ${y1}C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`; };
// Lines on the left, requirements on the right, joined where the Lines table says a Line served a requirement.
function tpxTraceHTML(p, rows, reqs) {
  const traced = rows.filter(r => r.refs.some(id => reqs.some(q => q.id === id)));
  if (!traced.length || !reqs.some(q => q.id)) return '';
  const MOST = 18, lines = traced.slice(0, MOST), more = traced.length - lines.length, rq = reqs.filter(q => q.id);
  const LH = 34, RH = 42, W = 820, LX = 0, LW = 280, RX = 520, RW = 300;
  const H = Math.max(lines.length * LH + (more ? LH : 0), rq.length * RH) + 8;
  const ly = i => (H - (lines.length + (more ? 1 : 0)) * LH) / 2 + i * LH + LH / 2, ry = i => (H - rq.length * RH) / 2 + i * RH + RH / 2;
  const edges = lines.flatMap((r, i) => r.refs.map(id => { const j = rq.findIndex(q => q.id === id); return j < 0 ? '' : `<path class="tm-e st-${rq[j].st.k}" data-l="${i}" data-r="${esc(id)}" d="${tpxCurve(LX + LW, ly(i), RX, ry(j))}"/>`; })).join('');
  const lnode = (r, i) => {
    const y = ly(i), go = r.line ? ` data-act="open-line" data-line="${esc(r.line.id)}" tabindex="0" role="button"` : '';
    return `<g class="tm-n tm-l${r.line ? '' : ' is-gone'}" data-tm-l="${i}"${go} aria-label="${esc(r.title)}"><title>${esc(r.title)}</title><rect x="${LX}" y="${y - 13}" width="${LW}" height="26" rx="13"/><circle class="ls-${r.s}" cx="${LX + 14}" cy="${y}" r="4.5"/><text x="${LX + 26}" y="${y + 4}">${r.code ? `<tspan class="tm-code">${esc(r.code)}</tspan> ` : ''}${esc(tpxCut(r.title, r.code ? 30 : 36))}</text></g>`;
  };
  const rnode = (q, i) => { const y = ry(i); return `<g class="tm-n tm-r st-${q.st.k}" data-tm-r="${esc(q.id)}" data-act="tp-jump" data-to="tpx-${esc(q.id)}" tabindex="0" role="button" aria-label="${esc(`${q.id} ${q.name}`)}"><title>${esc(`${q.id} · ${q.name} — ${q.st.label}`)}</title><rect x="${RX}" y="${y - 16}" width="${RW}" height="32" rx="9"/><rect class="tm-bar" x="${RX}" y="${y - 16}" width="5" height="32" rx="2.5"/><text x="${RX + 16}" y="${y + 4}"><tspan class="tm-code">${esc(q.id)}</tspan> ${esc(tpxCut(tpxPlain(q.name), 33))}</text></g>`; };
  const tail = more ? `<text class="tm-more" x="${LX + 26}" y="${ly(lines.length) + 4}">+${more} more below</text>` : '';
  return `<div class="tpx-trace"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Which Lines built which requirements">${edges}${lines.map(lnode).join('')}${rq.map(rnode).join('')}${tail}</svg></div>`;
}
// The project as a tree, left to right: the project, its Topics, their Subtopics.
function tpxArchHTML(p) {
  const roots = tpxRoots(p), kids = t => tpxChildren(p, t), counts = topicCounts(p);
  if (!roots.length) return '';
  const hasKids = roots.some(t => kids(t).length), ROW = 62, NH = 48;
  const W = hasKids ? 900 : 620, RX = 0, RW = 170, TX = 250, TW = 280, CX = 610, CW = 280;
  const slots = roots.map(t => Math.max(1, kids(t).length)), H = slots.reduce((a, b) => a + b, 0) * ROW + 8;
  let y = 4;
  const nodes = [], edges = [], rootY = H / 2;
  const box = (t, x, w, cy, cls) => {
    const n = counts(t), words = tpxWrap(t.title, 30), lines = words.length;
    const facts = [n.open ? `${n.open} open` : '', n.done ? `${n.done} done` : ''].filter(Boolean).join(' · ') || 'No lines yet';
    const ty = cy - (lines - 1) * 8 - 2;
    return `<g class="tm-n ${cls}" data-act="tp-show" data-topic="${esc(t.path)}" tabindex="0" role="button" aria-label="${esc(t.title)}"><title>${esc(t.goal ? `${t.title}\n${t.goal}` : t.title)}</title><rect x="${x}" y="${cy - NH / 2 - (lines - 1) * 8}" width="${w}" height="${NH + (lines - 1) * 16}" rx="11"/><rect class="tm-bar" x="${x}" y="${cy - NH / 2 - (lines - 1) * 8}" width="5" height="${NH + (lines - 1) * 16}" rx="2.5"/>${words.map((w2, i) => `<text class="tm-t" x="${x + 16}" y="${ty + i * 16}">${esc(w2)}</text>`).join('')}<text class="tm-f${n.open ? ' is-open' : ''}" x="${x + 16}" y="${ty + lines * 16 - 1}">${esc(facts)}</text></g>`;
  };
  roots.forEach((t, i) => {
    const cy = y + slots[i] * ROW / 2;
    edges.push(`<path class="tm-e" d="${tpxCurve(RX + RW, rootY, TX, cy)}"/>`);
    nodes.push(box(t, TX, TW, cy, 'tm-t1'));
    kids(t).forEach((c, j) => { const ky = y + j * ROW + ROW / 2; edges.push(`<path class="tm-e is-kid" d="${tpxCurve(TX + TW, cy, CX, ky)}"/>`); nodes.push(box(c, CX, CW, ky, 'tm-c')); });
    y += slots[i] * ROW;
  });
  const name = tpxWrap(p.name, 18);
  const root = `<g class="tm-n tm-root"><rect x="${RX}" y="${rootY - 30 - (name.length - 1) * 9}" width="${RW}" height="${60 + (name.length - 1) * 18}" rx="14"/>${name.map((w, i) => `<text x="${RX + RW / 2}" y="${rootY + 1 - (name.length - 1) * 9 + i * 18}">${esc(w)}</text>`).join('')}<text class="tm-f" x="${RX + RW / 2}" y="${rootY + 19 + (name.length - 1) * 9}">${esc(plural((p.knowledge || []).length, 'Topic', 'Topics'))}</text></g>`;
  return `<div class="tpx-arch"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="The project's Topics and Subtopics">${edges.join('')}${root}${nodes.join('')}</svg></div>`;
}

// ---------- The tree ----------
const tpxCanEdit = projectData => typeof canCreateKnowledgeTopic === 'function' && canCreateKnowledgeTopic(projectData);
const tpxIsAreaRoute = path => typeof path === 'string' && path.startsWith('area:');
const tpxAreaFromRoute = path => (tpxIsAreaRoute(path) ? path.slice(5) : '');
const tpxAreaDetail = (p, name) => p?.areaDetails?.[name] || '';
const tpxIds = p => new Set((p.knowledge || []).map(t => t.id).filter(Boolean));
const tpxRoots = p => { const ids = tpxIds(p); return (p.knowledge || []).filter(t => !t.parent || !ids.has(t.parent)).sort((a, b) => a.title.localeCompare(b.title)); };
const tpxChildren = (p, t) => (t.id ? (p.knowledge || []).filter(c => c.parent === t.id && c !== t).sort((a, b) => a.title.localeCompare(b.title)) : []);
const tpxParent = (p, t) => (t.parent && (p.knowledge || []).find(x => x.id === t.parent && x !== t)) || null;
const tpxAreaNames = p => {
  const out = [], seen = new Set();
  for (const raw of [...(p.areas || []), ...tpxRoots(p).map(t => t.area)]) {
    const name = String(raw || '').trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out;
};
// Needs you, then working, then to review: the one dot a Topic's lines earn in the tree.
function tpxPulse(p, t) {
  const s = new Set(t.lines.map(slug => allLines(p).find(l => l.slug === slug)).filter(Boolean).map(l => topicNodeOf(p, l)));
  return s.has('you') ? 'you' : s.has('working') ? 'working' : s.has('review') ? 'review' : '';
}
function tpxSelected(p, r) {
  const want = r?.topic;
  if (want) {
    if (want === 'understanding.md' && p.understanding) return want;
    if (tpxIsAreaRoute(want) && tpxAreaNames(p).includes(tpxAreaFromRoute(want))) return want;
    if ((p.knowledge || []).some(t => t.path === want)) return want;
  }
  return p.understanding ? 'understanding.md' : tpxRoots(p)[0]?.path || (tpxAreaNames(p)[0] ? `area:${tpxAreaNames(p)[0]}` : '');
}
function tpxNewTopicButton(projectData, building, inRail = false) {
  if (!tpxCanEdit(projectData)) return '';
  const disabled = building ? ' disabled aria-describedby="tpxBuildBusy"' : '';
  return inRail
    ? `<button type="button" class="tpx-add-topic tpx-new-topic" data-act="new-knowledge-topic"${disabled}>${ic('plus', 15)}<span>New Topic</span></button><button type="button" class="tpx-add-tier1" data-act="new-knowledge-topic" data-tier="1"${disabled} title="Add Tier 1 group">${ic('plus', 14)}<span>Tier 1</span></button>`
    : `<button type="button" class="btn sm primary tpx-new-topic" data-act="new-knowledge-topic"${disabled}>New Topic</button><button type="button" class="btn sm tpx-new-tier1" data-act="new-knowledge-topic" data-tier="1"${disabled}>New Tier 1</button>`;
}
function tpxBuildingHTML(building) {
  return building ? `<button type="button" class="tpx-building" id="tpxBuildBusy" data-act="open-line" data-line="${esc(building.id)}"><i class="spin"></i><span>${esc(building.title)} in progress</span>${ic('right', 14)}</button>` : '';
}
const tpxHasLines = projectData => projectData.lines.some(line => line.job !== BUILD_TOPICS);
function tpxNavHTML(p, on) {
  const building = topicsBuilding(p), counts = topicCounts(p), topics = p.knowledge || [], canEdit = tpxCanEdit(p);
  const rowMenu = t => (canEdit && !building
    ? `<button type="button" class="icon-btn tpx-row-menu" data-act="topic-menu" data-path="${esc(t.path)}" title="${esc(`Options for ${t.title}`)}" aria-label="${esc(`Options for ${t.title}`)}">${ic('more', 14)}</button>`
    : '');
  const node = (t, kid) => {
    const n = counts(t), pulse = tpxPulse(p, t), fresh = (S.topicsNew?.[p.id] || []).some(x => x.path === t.path);
    return `<button type="button" class="tpx-node${kid ? ' is-kid' : ''}${fresh ? ' tpx-new' : ''}${canEdit && !building ? ' has-menu' : ''}" data-act="tp-show" data-topic="${esc(t.path)}"${on === t.path ? ' aria-current="page"' : ''} title="${esc(t.title)}"><i class="tpx-pulse ${pulse}"></i><span>${esc(t.title)}</span>${n.open ? `<em>${n.open}</em>` : ''}</button>${rowMenu(t)}`;
  };
  const branch = list => `<ul>${list.map(t => { const kids = tpxChildren(p, t); return `<li>${node(t, false)}${kids.length ? `<ul class="tpx-kids">${kids.map(c => `<li>${node(c, true)}</li>`).join('')}</ul>` : ''}</li>`; }).join('')}</ul>`;
  const action = building || !tpxHasLines(p) ? '' : topics.length
    ? `<button type="button" class="icon-btn" data-act="rebuild-topics" title="Rebuild Topics" aria-label="Rebuild Topics">${ic('retry', 15)}</button>`
    : '<button type="button" class="btn sm" data-act="build-topics">Build Topics</button>';
  const addTopic = tpxNewTopicButton(p, building, true);
  return `<div class="tpx-nav-head"><h1>Topics</h1>${topics.length ? `<span class="tp-total">${topics.length}</span>` : ''}<span class="tpx-nav-acts">${action}<button type="button" class="icon-btn" data-act="topics-recover" title="Recover earlier Topics" aria-label="Recover earlier Topics">${ic('undo', 15)}</button></span></div>
    ${tpxBuildingHTML(building)}
    <nav class="tpx-tree" aria-label="Topics">
      ${p.understanding ? `<div class="tpx-root-wrap"><button type="button" class="tpx-node is-root" data-act="tp-show" data-topic="understanding.md"${on === 'understanding.md' ? ' aria-current="page"' : ''}>${ic('home', 15)}<span>${esc(p.name)}</span><small class="tpx-root-tag">Overview</small></button></div>` : ''}
      ${tpxAreasHTML(p, branch, on, canEdit, building)}
    </nav>
    ${addTopic ? `<div class="tpx-nav-foot">${addTopic}</div>` : ''}`;
}

// The Topics under their Tier 1 areas (categories), in the order understanding.md lists them; Topics with no area last. No areas: one tree.
function tpxAreasHTML(p, branch, on = '', canEdit = false, building = null) {
  const roots = tpxRoots(p), named = tpxAreaNames(p);
  if (!named.length) return branch(roots);
  const namedHTML = named.map(a => {
    const list = roots.filter(t => t.area === a), route = `area:${a}`;
    const acts = canEdit && !building
      ? `<span class="tpx-area-acts"><button type="button" class="icon-btn tpx-area-act" data-act="new-knowledge-topic" data-area="${esc(a)}" title="${esc(`Add Topic in ${a}`)}" aria-label="${esc(`Add Topic in ${a}`)}">${ic('plus', 13)}</button><button type="button" class="icon-btn tpx-area-act" data-act="area-menu" data-area="${esc(a)}" title="${esc(`Options for ${a}`)}" aria-label="${esc(`Options for ${a}`)}">${ic('more', 13)}</button></span>`
      : '';
    return `<div class="tpx-area" data-area="${esc(a)}"><div class="tpx-area-row"><button type="button" class="tpx-area-btn" data-act="tp-show" data-topic="${esc(route)}"${on === route ? ' aria-current="page"' : ''} title="${esc(a)}"><span>${esc(a)}</span></button>${acts}</div>${list.length ? branch(list) : '<p class="tpx-area-empty">No topics yet</p>'}</div>`;
  }).join('');
  const other = roots.filter(t => !t.area || !named.includes(t.area));
  const otherHTML = other.length ? `<div class="tpx-area is-other"><h3>Other</h3>${branch(other)}</div>` : '';
  return namedHTML + otherHTML;
}

// ---------- A Topic's page ----------
const tpxHead = (title, icon, extra = '') => `<h2 class="tpx-h">${ic(icon, 17)}<span>${esc(title)}</span>${extra}</h2>`;
function tpxLinesRows(p, sec) {
  const table = tpxTable(sec);
  if (!table) return [];
  const iWhat = tpxCol(table, /what/i), iReq = tpxCol(table, /requirement/i), iOut = tpxCol(table, /outcome|result/i);
  return table.rows.map(row => {
    const link = tpxLink(row[0]), slug = tpxSlugOf(link?.[2]), line = slug ? allLines(p).find(l => l.slug === slug) : null;
    return { line, code:line?.code || (link ? tpxPlain(link[1]) : ''), title:line?.title || tpxPlain(row[iWhat] ?? row[1] ?? row[0]), what:iWhat >= 0 ? row[iWhat] : '', refs:iReq >= 0 ? tpxRefs(row[iReq]) : [], outcome:iOut >= 0 ? row[iOut] : '', s:line ? topicNodeOf(p, line) : 'quiet' };
  });
}
function tpxReqHTML(p, r) {
  // "The person's words" [PE-12](…) · date: the words in the bubble, where they were said under it.
  const said = r.asked.map(a => { const m = a.match(/^\s*[“"«]([\s\S]*?)[”"»]\s*(.*)$/); return `<blockquote class="tpx-asked"><p>${tpxInline(m ? m[1] : a, p)}</p>${m && m[2] ? `<cite>${tpxInline(m[2].replace(/^[·,\s]+/, ''), p)}</cite>` : ''}</blockquote>`; }).join('');
  const left = r.left.join(' '), nothing = /^nothing\b/i.test(tpxPlain(left));
  return `<article class="tpx-req st-${r.st.k}" id="tpx-${esc(r.id || slug(r.name))}">
    <header><span class="tpx-rid">${esc(r.id || '•')}</span><h3>${tpxInline(r.name, p)}</h3>${tpxChip(r.st)}</header>
    ${r.st.note ? `<p class="tpx-limit">${esc(r.st.note)}</p>` : ''}
    ${r.blocks.length ? `<div class="tpx-prose">${tpxBlocks(r.blocks, p)}</div>` : ''}
    ${said ? `<div class="tpx-said">${said}</div>` : ''}
    ${r.done.length || r.left.length ? `<div class="tpx-dl">${r.done.length ? `<div class="is-done"><span>${ic('check', 14)}Done</span><div>${r.done.map(d => `<p>${tpxInline(d, p)}</p>`).join('')}</div></div>` : ''}${r.left.length ? `<div class="is-left${nothing ? ' is-nothing' : ''}"><span>${ic('right', 14)}Left</span><div><p>${tpxInline(left, p)}</p></div></div>` : ''}</div>` : ''}
  </article>`;
}
function tpxTopicHTML(p, doc) {
  MDC.doc = doc; MDC.section = '';
  const k = (p.knowledge || []).find(t => t.path === doc.path) || { path:doc.path, title:'', lines:[] }, t = tpxParse(doc.md);
  const title = k.title || t.meta.title || t.title || doc.path, parent = tpxParent(p, k), kids = tpxChildren(p, k), n = topicCounts(p)(k);
  const glanceSec = tpxTake(t, /^At a glance/i), reqSec = tpxTake(t, /^Requirements?$/i), linesSec = tpxTake(t, /^Lines$/i), why = tpxTake(t, /^Why\b/i);
  const leftSec = tpxTake(t, /^What is left/i), thinking = tpxTake(t, /^How the thinking/i), traps = tpxTake(t, /^Traps/i), files = tpxTake(t, /^Files$/i);
  const reqs = tpxRequirements(reqSec, tpxTable(glanceSec)), rows = tpxLinesRows(p, linesSec);
  const notWanted = (glanceSec?.blocks || []).find(b => b.t === 'p' && /^Not wanted\s*:/i.test(b.text));
  const glanceRest = (glanceSec?.blocks || []).filter(b => b.t !== 'table' && b !== notWanted);
  const crumbs = `<nav class="tpx-crumbs" aria-label="Where this Topic is">${p.understanding ? `<button type="button" data-act="tp-show" data-topic="understanding.md">${esc(p.name)}</button>` : `<span>${esc(p.name)}</span>`}${k.area ? `${ic('right', 13)}<button type="button" data-act="tp-show" data-topic="${esc(`area:${k.area}`)}">${esc(k.area)}</button>` : ''}${parent ? `${ic('right', 13)}<button type="button" data-act="tp-show" data-topic="${esc(parent.path)}">${esc(parent.title)}</button>` : ''}</nav>`;
  const updated = t.meta.updated ? `<span class="tpx-when">Updated ${esc(t.meta.updated)}</span>` : '';
  const busy = topicsBuilding(p), editable = tpxCanEdit(p) && !busy;
  const merge = typeof topicMergeButton === 'function' && !busy ? topicMergeButton(p, k) : '';
  const editBtns = editable ? `<button type="button" class="btn sm" data-act="edit-knowledge-topic" data-topic="${esc(doc.path)}">${ic('pen', 14)}Rename</button>` : '';
  const delBtn = editable ? `<button type="button" class="btn sm tpx-danger-btn" data-act="delete-knowledge-topic" data-topic="${esc(doc.path)}">${ic('trash', 14)}Delete</button>` : '';
  const hero = `<header class="tpx-hero">
      <div class="tpx-hero-main">${crumbs}<h1>${esc(title)}</h1>${t.goal ? `<p class="tpx-goal">${tpxInline(t.goal, p)}</p>` : ''}
        <div class="tpx-facts">${!k.lines.length && !rows.length ? '<span class="tpx-when">No Lines yet</span>' : countsHTML(n)}${updated}<span class="tpx-acts">${editBtns}${merge}<button type="button" class="btn sm" data-act="open-doc" data-doc="${esc(doc.path)}">${ic('doc', 14)}Markdown</button>${delBtn}</span></div></div>
      ${tpxRingHTML(reqs)}
    </header>`;
  const statusParts = t.status ? tpxParseStatus(t.status) : null;
  const status = statusParts && (statusParts.body || statusParts.date) ? `<p class="tpx-status${statusParts.date ? ' has-time' : ''}"><i></i>${statusParts.body ? `<span>${tpxInline(statusParts.body, p)}</span>` : ''}${statusParts.date ? `<time>${esc(statusParts.date)}</time>` : ''}</p>` : '';
  const glance = reqs.length ? `<div class="tpx-glance">${reqs.map(r => `<button type="button" class="tpx-gl st-${r.st.k}" data-act="tp-jump" data-to="tpx-${esc(r.id || slug(r.name))}"><span class="tpx-rid">${esc(r.id || '•')}</span><span class="tpx-gl-name">${esc(tpxPlain(r.name))}</span>${tpxChip(r.st)}</button>`).join('')}</div>` : '';
  const noList = notWanted ? notWanted.text.replace(/^Not wanted\s*:\s*/i, '').replace(/\.$/, '') : '';
  const nos = noList ? `<div class="tpx-nots"><span>${ic('x', 14)}Not wanted</span>${(noList.includes(';') ? noList.split(/\s*;\s*/) : [noList]).filter(Boolean).map(x => `<em>${tpxInline(x, p)}</em>`).join('')}</div>` : '';
  const trace = tpxTraceHTML(p, rows, reqs);
  const leftItems = (leftSec?.blocks || []).filter(b => b.t === 'list').flatMap(b => b.items);
  const roadmap = leftItems.length ? `<ol class="tpx-road">${leftItems.map((it, i) => { const refs = tpxRefs((it.text.match(/\((R\d+[^)]*)\)\s*$/) || [])[1]); return `<li><b>${i + 1}</b><div><p>${tpxInline(it.text.replace(/\s*\((R\d+[^)]*)\)\s*$/, ''), p)}</p>${refs.map(id => `<button type="button" class="tpx-ref" data-act="tp-jump" data-to="tpx-${id}">${id}</button>`).join('')}</div></li>`; }).join('')}</ol>` : '';
  const thinkItems = (thinking?.blocks || []).filter(b => b.t === 'list').flatMap(b => b.items);
  const timeline = thinkItems.length ? `<ol class="tpx-time">${thinkItems.map(it => { const m = it.text.match(/^\*\*([^*]+)\*\*\s*[—–:-]?\s*(.*)$/); return `<li>${m ? `<time>${esc(m[1])}</time>` : ''}<p>${tpxInline(m ? m[2] : it.text, p)}</p></li>`; }).join('')}</ol>` : '';
  const trapItems = (traps?.blocks || []).filter(b => b.t === 'list').flatMap(b => b.items);
  const trapList = trapItems.length ? `<div class="tpx-traps">${trapItems.map(it => { const m = it.text.match(/^\*\*([^*]+)\*\*\s*[—–:-]?\s*(.*)$/); return `<div class="tpx-trap">${ic('hint', 16)}<div>${m ? `<strong>${tpxInline(m[1], p)}</strong>` : ''}<p>${tpxInline(m ? m[2] : it.text, p)}</p></div></div>`; }).join('')}</div>` : '';
  const related = (linesSec?.blocks || []).filter(b => b.t !== 'table');
  const lineList = rows.length ? `<div class="tpx-lines">${rows.map(r => `<${r.line ? `button type="button" data-act="open-line" data-line="${esc(r.line.id)}"` : 'div'} class="tpx-line"><i class="tpx-ls ls-${r.s}" title="${esc(TOPIC_WORDS[r.s] || '')}"></i><span class="tpx-line-main"><strong>${r.code ? `<code>${esc(r.code)}</code>` : ''}${esc(r.title)}</strong>${r.outcome ? `<small>${esc(tpxPlain(r.outcome))}</small>` : ''}</span>${r.refs.length ? `<span class="tpx-line-refs">${r.refs.slice(0, 4).map(id => `<span>${id}</span>`).join('')}</span>` : ''}</${r.line ? 'button' : 'div'}>`).join('')}</div>${related.length ? `<div class="tpx-prose tpx-related">${tpxBlocks(related, p)}</div>` : ''}` : '';
  const fileItems = (files?.blocks || []).filter(b => b.t === 'list').flatMap(b => b.items);
  const pics = [], others = [];
  for (const it of fileItems) { const link = tpxLink(it.text), path = link ? mdPath(link[2]) : ''; (path && isPicturePath(path) ? pics : others).push({ it, link, path }); }
  const fileList = fileItems.length ? `${pics.length ? `<div class="tpx-pics">${pics.map(f => `<button type="button" class="tpx-pic" data-act="open-asset" data-path="${esc(f.path)}"><img alt="" loading="lazy" src="${esc(assetUrl(p, f.path))}"><span>${tpxInline(f.it.text.replace(/^\[[^\]]*\]\([^)]*\)\s*[—–-]?\s*/, '') || f.link[1], p)}</span></button>`).join('')}</div>` : ''}${others.length ? `<ul class="tpx-files">${others.map(f => `<li>${tpxInline(f.it.text, p)}</li>`).join('')}</ul>` : ''}` : '';
  const kidCards = kids.length ? `<div class="tpx-kidcards">${kids.map(c => { const cn = topicCounts(p)(c); return `<button type="button" class="tpx-kidcard" data-act="tp-show" data-topic="${esc(c.path)}"><strong>${esc(c.title)}</strong>${c.goal ? `<p>${esc(c.goal)}</p>` : ''}${countsHTML(cn)}</button>`; }).join('')}</div>` : '';
  const section = (id, head, body) => (body ? `<section class="tpx-sec" id="${id}">${head}${body}</section>` : '');
  return `<article class="tpx-doc" data-doc="${esc(doc.path)}">
    ${hero}${status}
    ${glance || nos || glanceRest.length ? `<section class="tpx-sec">${glance}${nos}${glanceRest.length ? `<div class="tpx-prose">${tpxBlocks(glanceRest, p)}</div>` : ''}</section>` : ''}
    ${t.intro.length ? `<div class="tpx-prose">${tpxBlocks(t.intro, p)}</div>` : ''}
    ${section('tpx-why', tpxHead(why?.title || 'Why this exists', 'spark'), why?.blocks.length ? `<div class="tpx-prose tpx-why">${tpxBlocks(why.blocks, p)}</div>` : '')}
    ${section('tpx-trace', tpxHead('How the Lines built it', 'branch'), trace)}
    ${section('tpx-reqs', tpxHead(reqSec?.title || 'Requirements', 'check', `<em>${reqs.length}</em>`), reqs.some(r => r.blocks.length || r.asked.length || r.done.length || r.left.length) ? reqs.map(r => tpxReqHTML(p, r)).join('') : '')}
    ${section('tpx-left', tpxHead(leftSec?.title || 'What is left', 'right'), roadmap || (leftSec?.blocks.length ? `<div class="tpx-prose">${tpxBlocks(leftSec.blocks, p)}</div>` : ''))}
    ${section('tpx-kids', tpxHead('Subtopics', 'note', `<em>${kids.length}</em>`), kidCards)}
    ${section('tpx-thinking', tpxHead(thinking?.title || 'How the thinking changed', 'stats'), timeline || (thinking?.blocks.length ? `<div class="tpx-prose">${tpxBlocks(thinking.blocks, p)}</div>` : ''))}
    ${section('tpx-traps', tpxHead(traps?.title || 'Traps', 'hint'), trapList || (traps?.blocks.length ? `<div class="tpx-prose">${tpxBlocks(traps.blocks, p)}</div>` : ''))}
    ${section('tpx-lines', tpxHead('Lines', 'branch', `<em>${rows.length}</em>`), lineList)}
    ${section('tpx-files', tpxHead(files?.title || 'Files', 'files'), fileList || (files?.blocks.length ? `<div class="tpx-prose">${tpxBlocks(files.blocks, p)}</div>` : ''))}
    ${t.sections.map(s => section(`tpx-s-${slug(s.title)}`, tpxHead(s.title, 'doc'), s.blocks.length ? `<div class="tpx-prose">${tpxBlocks(s.blocks, p)}</div>` : '')).join('')}
  </article>`;
}

// ---------- The project's own page: understanding.md ----------
function tpxOverviewHTML(p, doc) {
  MDC.doc = doc; MDC.section = '';
  const t = tpxParse(doc.md), title = t.title || p.name;
  const parts = tpxTake(t, /^The parts/i), words = tpxTake(t, /^Words/i), stands = tpxTake(t, /^Where things stand/i), open = tpxTake(t, /^Open now/i), gone = tpxTake(t, /^Gone\b/i), topics = tpxTake(t, /^Topics$/i);
  const lead = t.intro.filter(b => b.t === 'quote' && !b.kind), rest = t.intro.filter(b => !lead.includes(b));
  const partsTable = tpxTable(parts);
  const partCards = partsTable ? `<div class="tpx-parts">${partsTable.rows.map(r => `<div class="tpx-part"><strong>${tpxInline(r[0] || '', p)}</strong>${r[1] ? `<p>${tpxInline(r[1], p)}</p>` : ''}${r[2] ? `<code>${esc(tpxPlain(r[2]))}</code>` : ''}</div>`).join('')}</div>` : '';
  const standItems = (stands?.blocks || []).filter(b => b.t === 'list').flatMap(b => b.items);
  const standCards = standItems.length ? `<div class="tpx-stands">${standItems.map(it => { const m = it.text.match(/^\*\*([^*]+)\*\*\s*(.*)$/), body = m ? m[2] : it.text, go = body.match(/\s*→\s*(.+)$/); return `<div class="tpx-stand">${m ? `<strong>${tpxInline(m[1], p)}</strong>` : ''}<p>${tpxInline(go ? body.slice(0, go.index) : body, p)}</p>${go ? `<div class="tpx-go">${tpxInline(go[1], p)}</div>` : ''}</div>`; }).join('')}</div>` : '';
  const openTable = tpxTable(open);
  const openRows = openTable ? `<div class="tpx-open">${openTable.rows.map(r => `<div class="tpx-open-row"><strong>${tpxInline(r[0] || '', p)}</strong><span class="tpx-open-state">${tpxInline(r[1] || '', p)}</span>${r[2] ? `<span class="tpx-open-wait">${ic('hint', 13)}${tpxInline(r[2], p)}</span>` : ''}${r[3] ? `<span class="tpx-open-read">${tpxInline(r[3], p)}</span>` : ''}</div>`).join('')}</div>` : '';
  const wordItems = (words?.blocks || []).filter(b => b.t === 'list').flatMap(b => b.items);
  const glossary = wordItems.length ? `<dl class="tpx-words">${wordItems.map(it => { const m = it.text.match(/^\*\*([^*]+)\*\*\s*[—–:-]?\s*(.*)$/); return `<div><dt>${tpxInline(m ? m[1] : it.text, p)}</dt>${m ? `<dd>${tpxInline(m[2], p)}</dd>` : ''}</div>`; }).join('')}</dl>` : '';
  const goneItems = (gone?.blocks || []).filter(b => b.t === 'list').flatMap(b => b.items);
  const goneList = goneItems.length ? `<ul class="tpx-gone">${goneItems.map(it => `<li>${ic('x', 14)}<span>${tpxInline(it.text, p)}</span></li>`).join('')}</ul>` : '';
  const notInTopic = (topics?.blocks || []).filter(b => b.t !== 'list' && !(b.t === 'p' && /^\*\*[^*\[\]\n]+?\*\*(?:\s*[—–:-]\s*.*)?$/.test(b.text.trim()) && !/^\*\*not in a topic\b/i.test(b.text.trim())));
  const section = (id, head, body) => (body ? `<section class="tpx-sec" id="${id}">${head}${body}</section>` : '');
  const date = (stands?.title.match(/\(([^)]+)\)/) || [])[1];
  return `<article class="tpx-doc is-overview" data-doc="understanding.md">
    <header class="tpx-hero"><div class="tpx-hero-main"><h1>${esc(title)}</h1>${t.goal ? `<p class="tpx-goal">${tpxInline(t.goal, p)}</p>` : ''}
      <div class="tpx-facts">${t.meta.updated ? `<span class="tpx-when">Updated ${esc(t.meta.updated)}</span>` : ''}<span class="tpx-acts"><button type="button" class="btn sm" data-act="open-doc" data-doc="understanding.md">${ic('doc', 14)}Markdown</button></span></div></div></header>
    ${lead.length ? `<div class="tpx-lead">${lead.map(b => tpxInline(b.lines.join(' '), p)).join('<br>')}</div>` : ''}
    ${section('tpx-arch', tpxHead('Architecture', 'branch'), `${tpxArchHTML(p)}${notInTopic.length ? `<div class="tpx-prose tpx-related">${tpxBlocks(notInTopic, p)}</div>` : ''}`)}
    ${section('tpx-stands', tpxHead('Where things stand', 'stats', date ? `<time>${esc(date)}</time>` : ''), standCards || (stands?.blocks.length ? `<div class="tpx-prose">${tpxBlocks(stands.blocks, p)}</div>` : ''))}
    ${section('tpx-parts', tpxHead(parts?.title || 'The parts', 'box'), partCards || (parts?.blocks.length ? `<div class="tpx-prose">${tpxBlocks(parts.blocks, p)}</div>` : ''))}
    ${section('tpx-opennow', tpxHead(open?.title || 'Open now', 'eye', openTable ? `<em>${openTable.rows.length}</em>` : ''), openRows || (open?.blocks.length ? `<div class="tpx-prose">${tpxBlocks(open.blocks, p)}</div>` : ''))}
    ${section('tpx-words', tpxHead(words?.title || 'Words', 'note'), glossary)}
    ${section('tpx-gone', tpxHead(gone?.title || 'Gone', 'trash'), goneList)}
    ${rest.length ? `<div class="tpx-prose">${tpxBlocks(rest, p)}</div>` : ''}
    ${t.sections.map(s => section(`tpx-s-${slug(s.title)}`, tpxHead(s.title, 'doc'), s.blocks.length ? `<div class="tpx-prose">${tpxBlocks(s.blocks, p)}</div>` : '')).join('')}
  </article>`;
}

// ---------- A Tier 1 area page ----------
function tpxAreaHTML(p, areaName) {
  const topics = tpxRoots(p).filter(t => t.area === areaName), counts = topicCounts(p);
  const allInArea = topics.flatMap(t => [t, ...tpxChildren(p, t)]);
  const total = allInArea.reduce((acc, t) => { const n = counts(t); acc.open += n.open; acc.done += n.done; return acc; }, { open:0, done:0 });
  const desc = tpxAreaDetail(p, areaName), busy = topicsBuilding(p), editable = tpxCanEdit(p) && !busy;
  const crumbs = `<nav class="tpx-crumbs" aria-label="Where this Tier 1 group is">${p.understanding ? `<button type="button" data-act="tp-show" data-topic="understanding.md">${esc(p.name)}</button>` : `<span>${esc(p.name)}</span>`}<span class="tpx-tier-pill">Tier 1</span></nav>`;
  const acts = editable
    ? `<span class="tpx-acts"><button type="button" class="btn sm primary" data-act="new-knowledge-topic" data-area="${esc(areaName)}">${ic('plus', 14)}New Topic</button><button type="button" class="btn sm" data-act="edit-topic-area" data-area="${esc(areaName)}">${ic('pen', 14)}Rename</button><button type="button" class="btn sm tpx-danger-btn" data-act="delete-topic-area" data-area="${esc(areaName)}">${ic('trash', 14)}Delete</button></span>`
    : '';
  const cards = topics.length
    ? `<div class="tpx-kidcards">${topics.map(c => { const cn = counts(c); return `<button type="button" class="tpx-kidcard" data-act="tp-show" data-topic="${esc(c.path)}"><strong>${esc(c.title)}</strong>${c.goal ? `<p>${esc(c.goal)}</p>` : ''}${countsHTML(cn)}</button>`; }).join('')}</div>`
    : `<div class="tpx-area-zero">${ic('note', 20)}<strong>No Tier 2 topics in ${esc(areaName)} yet</strong><p>Add a Topic under this Tier 1 group so future Lines can be filed here.</p>${editable ? `<button type="button" class="btn sm primary" data-act="new-knowledge-topic" data-area="${esc(areaName)}">${ic('plus', 14)}New Topic</button>` : ''}</div>`;
  return `<article class="tpx-doc is-area" data-area="${esc(areaName)}">
    <header class="tpx-hero">
      <div class="tpx-hero-main">${crumbs}<h1>${esc(areaName)}</h1>${desc ? `<p class="tpx-goal">${tpxInline(desc, p)}</p>` : ''}
        <div class="tpx-facts"><span class="tpx-when">${esc(topics.length ? plural(topics.length, 'Topic', 'Topics') : 'No Topics yet')}</span>${total.open || total.done ? countsHTML(total) : ''}${acts}</div></div>
    </header>
    <section class="tpx-sec" id="tpx-area-topics">${tpxHead('Topics', 'note', topics.length ? `<em>${topics.length}</em>` : '')}${cards}</section>
  </article>`;
}

// ---------- The page ----------
function tpxLoad(p, path, force = false) {
  if (TPX.loading.has(path)) return;
  TPX.loading.add(path);
  const before = docById(path, p)?.md;
  loadDoc(p, path, { force }).then(doc => {
    if (project()?.id === p.id && S.route.view === 'topics' && doc.md !== before) {
      refreshTopicsPage();
      if (TPX.scrollMain && tpxSelected(project(), S.route) === path) { TPX.scrollMain = false; $('#tpxMain')?.scrollIntoView({ block:'start', behavior:'smooth' }); }
    }
  }).catch(error => { if (S.route.view === 'topics') toast(error.message); }).finally(() => TPX.loading.delete(path));
}
function tpxMainHTML(p, path) {
  if (!path) return '';
  if (tpxIsAreaRoute(path)) return tpxAreaHTML(p, tpxAreaFromRoute(path));
  const doc = docById(path, p), sig = path === 'understanding.md' ? (p.knowledge || []).map(t => t.sig).join(',') : (p.knowledge || []).find(t => t.path === path)?.sig || '';
  // A copy from earlier shows at once; the file as it is now is read once each time the page opens, and when it changes.
  if (!TPX.fresh.has(path) || (doc && ((fileEntry(p, path)?.mtime || 0) > doc.mtime || (sig && TPX.sig.has(path) && TPX.sig.get(path) !== sig)))) { TPX.fresh.add(path); TPX.sig.set(path, sig); tpxLoad(p, path, Boolean(doc)); }
  if (!doc) return '<div class="tpx-wait" aria-busy="true"><i></i><i></i><i></i></div>';
  return path === 'understanding.md' ? tpxOverviewHTML(p, doc) : tpxTopicHTML(p, doc);
}
function topicsPageHTML(p, r) {
  const topics = p.knowledge || [], building = topicsBuilding(p);
  TPX.fresh.clear();
  TPX.sig.clear();
  if (!topics.length && !p.understanding && !(p.areas || []).length) return `<div class="page topics-page tpx-none" id="tpxEmpty">${tpxEmptyHTML(p, building)}</div>`;
  const on = tpxSelected(p, r);
  return `<div class="page topics-page tpx">
    <aside class="tpx-nav" id="tpxNav">${tpxNavHTML(p, on)}</aside>
    <main class="tpx-main" id="tpxMain">${tpxMainHTML(p, on)}</main>
  </div>`;
}
function tpxEmptyHTML(projectData, building = topicsBuilding(projectData)) {
  const canCreate = tpxCanEdit(projectData);
  const build = !building && tpxHasLines(projectData) ? `<button type="button" class="btn sm${canCreate ? '' : ' primary'}" data-act="build-topics">Build Topics</button>` : '';
  const description = canCreate ? 'Add Tier 1 groups and Tier 2 topics for parts of your project. Related Lines can be filed there later.' : typeof HOSTED !== 'undefined' && HOSTED ? 'Topics appear here once synced from PenEcho on a computer.' : 'Build Topics to organize this project’s Lines.';
  return `<div class="tpx-nav-head"><h1>Topics</h1><span class="tpx-nav-acts">${tpxNewTopicButton(projectData, building)}${build}<button type="button" class="icon-btn" data-act="topics-recover" title="Recover earlier Topics" aria-label="Recover earlier Topics">${ic('undo', 16)}</button></span></div>
    ${tpxBuildingHTML(building)}
    <div class="tp-empty">${ic('note', 22)}<strong>${building ? 'Your Topics are on their way.' : 'No Topics yet'}</strong>${building ? '' : `<p>${description}</p>`}</div>`;
}
function tpxAreaOptionsHTML(areas, selected = '') {
  const noneLabel = areas.length ? 'None (Other)' : 'None (ungrouped)';
  return `<option value=""${!selected ? ' selected' : ''}>${noneLabel}</option>${areas.map(a => `<option value="${esc(a)}"${a === selected ? ' selected' : ''}>${esc(a)}</option>`).join('')}<option value="__new__">+ New Tier 1…</option>`;
}
function tpxDropDocCaches(projectId, paths = []) {
  if (typeof S === 'undefined' || !S.docs || typeof docKey !== 'function') return;
  for (const p of paths) if (p) { delete S.docs[docKey(projectId, p)]; TPX.fresh.delete(p); TPX.sig.delete(p); }
}
function tpxDefaultAreaFor(projectData, opener) {
  const explicit = opener?.dataset?.area;
  if (explicit) return explicit;
  const cur = S.route?.topic || '';
  if (tpxIsAreaRoute(cur)) return tpxAreaFromRoute(cur);
  const active = (projectData.knowledge || []).find(t => t.path === cur);
  return active?.area || '';
}
function openNewTopicDialog(projectData, opener, { tier = 2, area = '' } = {}) {
  if (!tpxCanEdit(projectData) || topicsBuilding(projectData) || $('#newKnowledgeTopic')) return;
  const areas = tpxAreaNames(projectData);
  const initialTier = tier === 1 ? '1' : '2';
  const initialArea = area && areas.includes(area) ? area : '';
  const dialog = document.createElement('dialog');
  dialog.id = 'newKnowledgeTopic';
  dialog.className = 'line-command-dialog tpx-dialog';
  dialog.setAttribute('aria-labelledby', 'newKnowledgeTopicTitle');
  dialog.innerHTML = `<form><h2 id="newKnowledgeTopicTitle">${initialTier === '1' ? 'New Tier 1' : 'New Topic'}</h2>
    <div class="tpx-tier-switch" role="radiogroup" aria-label="Topic level">
      <label class="tpx-tier-opt"><input type="radio" name="tier" value="2"${initialTier === '2' ? ' checked' : ''}><span><strong>Tier 2</strong><small>Topic file</small></span></label>
      <label class="tpx-tier-opt"><input type="radio" name="tier" value="1"${initialTier === '1' ? ' checked' : ''}><span><strong>Tier 1</strong><small>Group heading</small></span></label>
    </div>
    <div class="tpx-field-area"${initialTier === '1' ? ' hidden' : ''}>
      <label>Tier 1<select name="area">${tpxAreaOptionsHTML(areas, initialArea)}</select></label>
      <label class="tpx-new-area-wrap" hidden>New Tier 1 name<input name="newArea" maxlength="80" placeholder="e.g. Cloud, Mobile"></label>
    </div>
    <label>Name<input name="title" required maxlength="${initialTier === '1' ? 80 : 120}" autofocus></label>
    <label><span class="tpx-goal-label">${initialTier === '1' ? 'Description' : 'Scope'}</span> <span class="tpx-optional">(optional)</span><input name="goal" maxlength="${initialTier === '1' ? 200 : 300}" placeholder="${initialTier === '1' ? 'What this Tier 1 group covers' : 'What belongs in this Topic?'}"></label>
    <p class="command-error" role="alert" hidden></p>
    <footer><button type="button" class="btn" data-cancel>Cancel</button><button type="submit" class="btn primary">${initialTier === '1' ? 'Create Tier 1' : 'Create Topic'}</button></footer></form>`;
  document.body.append(dialog);
  const cancel = $('[data-cancel]', dialog), submit = $('[type="submit"]', dialog), message = $('.command-error', dialog);
  const areaWrap = $('.tpx-field-area', dialog), areaSelect = $('[name="area"]', dialog), newAreaWrap = $('.tpx-new-area-wrap', dialog), newAreaInput = $('[name="newArea"]', dialog);
  const titleInput = $('[name="title"]', dialog), goalInput = $('[name="goal"]', dialog), goalLabel = $('.tpx-goal-label', dialog), heading = $('#newKnowledgeTopicTitle', dialog);
  const syncMode = () => {
    const isTier1 = $('input[name="tier"]:checked', dialog)?.value === '1';
    heading.textContent = isTier1 ? 'New Tier 1' : 'New Topic';
    areaWrap.hidden = isTier1;
    titleInput.maxLength = isTier1 ? 80 : 120;
    goalLabel.textContent = isTier1 ? 'Description' : 'Scope';
    goalInput.maxLength = isTier1 ? 200 : 300;
    goalInput.placeholder = isTier1 ? 'What this Tier 1 group covers' : 'What belongs in this Topic?';
    submit.textContent = isTier1 ? 'Create Tier 1' : 'Create Topic';
    const wantNewArea = !isTier1 && areaSelect.value === '__new__';
    newAreaWrap.hidden = !wantNewArea;
    newAreaInput.required = wantNewArea;
    message.hidden = true;
  };
  $$('input[name="tier"]', dialog).forEach(r => { r.onchange = () => { syncMode(); titleInput.focus(); }; });
  areaSelect.onchange = () => { syncMode(); if (areaSelect.value === '__new__') newAreaInput.focus(); };
  let created = false;
  dialog.addEventListener('cancel', event => { if (submit.disabled) event.preventDefault(); });
  dialog.addEventListener('close', () => { dialog.remove(); if (!created && opener?.isConnected) opener.focus(); });
  cancel.onclick = () => dialog.close();
  $('form', dialog).onsubmit = async event => {
    event.preventDefault();
    if (submit.disabled) return;
    const isTier1 = $('input[name="tier"]:checked', dialog)?.value === '1';
    const title = titleInput.value.trim(), goal = goalInput.value.trim();
    const chosenArea = areaSelect.value === '__new__' ? newAreaInput.value.trim() : areaSelect.value;
    message.hidden = true;
    cancel.disabled = submit.disabled = true;
    let made;
    try {
      made = isTier1
        ? await api(`${pathFor(projectData.id)}/create-topic-area`, { method:'POST', body:{ name:title, goal } })
        : await api(`${pathFor(projectData.id)}/create-knowledge-topic`, { method:'POST', body:{ title, goal, area:chosenArea } });
    } catch (error) {
      message.textContent = error.message; message.hidden = false; cancel.disabled = submit.disabled = false; return;
    }
    created = true;
    dialog.close();
    if (!isTier1 && made.path && typeof topicsMine !== 'undefined') topicsMine.add(`${projectData.id}:${made.path}`);
    tpxDropDocCaches(projectData.id, ['understanding.md', made.path]);
    try { await loadState(projectData.id, { force:true }); }
    catch { toast(isTier1 ? 'Tier 1 created. Reload the project to see it.' : 'Topic created. Reload the project to see it.'); return; }
    if (project()?.id === projectData.id && S.route.view === 'topics') {
      const refreshed = project();
      const target = isTier1 ? `area:${made.name}` : (refreshed.knowledge.find(item => item.id === made.id)?.path || made.path);
      go({ view:'topics', topic:target });
      $('#tpxNav [aria-current="page"]')?.focus();
    }
  };
  dialog.showModal();
}
function openEditKnowledgeTopicDialog(projectData, topicPath, opener) {
  if (!tpxCanEdit(projectData) || topicsBuilding(projectData) || $('#editKnowledgeTopic')) return;
  const topic = (projectData.knowledge || []).find(t => t.path === topicPath);
  if (!topic) return;
  const areas = tpxAreaNames(projectData);
  const dialog = document.createElement('dialog');
  dialog.id = 'editKnowledgeTopic';
  dialog.className = 'line-command-dialog tpx-dialog';
  dialog.setAttribute('aria-labelledby', 'editKnowledgeTopicTitle');
  dialog.innerHTML = `<form><h2 id="editKnowledgeTopicTitle">Rename Topic</h2>
    <label>Name<input name="title" required maxlength="120" value="${esc(topic.title)}" autofocus></label>
    <label>Tier 1<select name="area">${tpxAreaOptionsHTML(areas, topic.area || '')}</select></label>
    <label class="tpx-new-area-wrap" hidden>New Tier 1 name<input name="newArea" maxlength="80" placeholder="e.g. Cloud, Mobile"></label>
    <label>Scope <span class="tpx-optional">(optional)</span><input name="goal" maxlength="300" value="${esc(topic.goal || '')}" placeholder="What belongs in this Topic?"></label>
    <p class="command-error" role="alert" hidden></p>
    <footer><button type="button" class="btn" data-cancel>Cancel</button><button type="submit" class="btn primary">Save</button></footer></form>`;
  document.body.append(dialog);
  const cancel = $('[data-cancel]', dialog), submit = $('[type="submit"]', dialog), message = $('.command-error', dialog);
  const titleInput = $('[name="title"]', dialog), areaSelect = $('[name="area"]', dialog), newAreaWrap = $('.tpx-new-area-wrap', dialog), newAreaInput = $('[name="newArea"]', dialog), goalInput = $('[name="goal"]', dialog);
  areaSelect.onchange = () => {
    const wantNew = areaSelect.value === '__new__';
    newAreaWrap.hidden = !wantNew; newAreaInput.required = wantNew;
    if (wantNew) newAreaInput.focus();
  };
  let saved = false;
  dialog.addEventListener('cancel', event => { if (submit.disabled) event.preventDefault(); });
  dialog.addEventListener('close', () => { dialog.remove(); if (!saved && opener?.isConnected) opener.focus(); });
  cancel.onclick = () => dialog.close();
  $('form', dialog).onsubmit = async event => {
    event.preventDefault();
    if (submit.disabled) return;
    const title = titleInput.value.trim(), goal = goalInput.value.trim();
    const area = areaSelect.value === '__new__' ? newAreaInput.value.trim() : areaSelect.value;
    message.hidden = true;
    cancel.disabled = submit.disabled = true;
    let out;
    try { out = await api(`${pathFor(projectData.id)}/update-knowledge-topic`, { method:'POST', body:{ path:topicPath, title, area, goal } }); }
    catch (error) { message.textContent = error.message; message.hidden = false; cancel.disabled = submit.disabled = false; return; }
    saved = true;
    dialog.close();
    if (typeof topicsMine !== 'undefined') topicsMine.add(`${projectData.id}:${out.path}`);
    tpxDropDocCaches(projectData.id, ['understanding.md', out.path]);
    try { await loadState(projectData.id, { force:true }); }
    catch { toast('Topic updated. Reload the project to see it.'); return; }
    if (project()?.id === projectData.id && S.route.view === 'topics') refreshTopicsPage();
  };
  dialog.showModal();
  titleInput.select();
}
function openDeleteKnowledgeTopicDialog(projectData, topicPath, opener) {
  if (!tpxCanEdit(projectData) || topicsBuilding(projectData) || $('#deleteKnowledgeTopic')) return;
  const topic = (projectData.knowledge || []).find(t => t.path === topicPath);
  if (!topic) return;
  const kids = tpxChildren(projectData, topic).length, lineCount = (topic.lines || []).length;
  const copy = [
    lineCount ? `Only this Topic file is removed — its ${plural(lineCount, 'Line', 'Lines')} stay untouched.` : 'This removes the Topic file.',
    kids ? `Its ${plural(kids, 'Subtopic', 'Subtopics')} will move to top level.` : '',
    'Recover brings earlier Topics back.',
  ].filter(Boolean).join(' ');
  const dialog = document.createElement('dialog');
  dialog.id = 'deleteKnowledgeTopic';
  dialog.className = 'line-command-dialog tpx-dialog';
  dialog.setAttribute('aria-labelledby', 'deleteKnowledgeTopicTitle');
  dialog.innerHTML = `<form><h2 id="deleteKnowledgeTopicTitle">Delete “${esc(topic.title)}”?</h2>
    <p>${esc(copy)}</p>
    <p class="command-error" role="alert" hidden></p>
    <footer><button type="button" class="btn" data-cancel>Cancel</button><button type="submit" class="btn danger">Delete Topic</button></footer></form>`;
  document.body.append(dialog);
  const cancel = $('[data-cancel]', dialog), submit = $('[type="submit"]', dialog), message = $('.command-error', dialog);
  let deleted = false;
  dialog.addEventListener('cancel', event => { if (submit.disabled) event.preventDefault(); });
  dialog.addEventListener('close', () => { dialog.remove(); if (!deleted && opener?.isConnected) opener.focus(); });
  cancel.onclick = () => dialog.close();
  $('form', dialog).onsubmit = async event => {
    event.preventDefault();
    if (submit.disabled) return;
    message.hidden = true;
    cancel.disabled = submit.disabled = true;
    let res;
    try { res = await api(`${pathFor(projectData.id)}/delete-knowledge-topic`, { method:'POST', body:{ path:topicPath } }); }
    catch (error) { message.textContent = error.message; message.hidden = false; cancel.disabled = submit.disabled = false; return; }
    deleted = true;
    dialog.close();
    tpxDropDocCaches(projectData.id, ['understanding.md', topicPath]);
    try { await loadState(projectData.id, { force:true }); }
    catch { toast('Topic deleted. Reload the project to see it.'); return; }
    if (project()?.id === projectData.id && S.route.view === 'topics') {
      const refreshed = project();
      if (S.route.topic === topicPath) {
        const next = (topic.area && tpxAreaNames(refreshed).includes(topic.area)) ? `area:${topic.area}` : tpxSelected(refreshed, { view:'topics' });
        go({ view:'topics', ...(next ? { topic:next } : {}) });
      } else refreshTopicsPage();
    }
    toast(`Deleted “${topic.title}”.`, res.undo && typeof restoreTopics === 'function' ? { label:'Undo', fn:() => restoreTopics(project() || projectData, res.undo) } : undefined);
  };
  dialog.showModal();
}
function openEditTopicAreaDialog(projectData, areaName, opener) {
  if (!tpxCanEdit(projectData) || topicsBuilding(projectData) || $('#editTopicArea')) return;
  const desc = tpxAreaDetail(projectData, areaName);
  const dialog = document.createElement('dialog');
  dialog.id = 'editTopicArea';
  dialog.className = 'line-command-dialog tpx-dialog';
  dialog.setAttribute('aria-labelledby', 'editTopicAreaTitle');
  dialog.innerHTML = `<form><h2 id="editTopicAreaTitle">Rename Tier 1</h2>
    <label>Name<input name="newName" required maxlength="80" value="${esc(areaName)}" autofocus></label>
    <label>Description <span class="tpx-optional">(optional)</span><input name="goal" maxlength="200" value="${esc(desc)}" placeholder="What this Tier 1 group covers"></label>
    <p class="command-error" role="alert" hidden></p>
    <footer><button type="button" class="btn" data-cancel>Cancel</button><button type="submit" class="btn primary">Save</button></footer></form>`;
  document.body.append(dialog);
  const cancel = $('[data-cancel]', dialog), submit = $('[type="submit"]', dialog), message = $('.command-error', dialog);
  const nameInput = $('[name="newName"]', dialog), goalInput = $('[name="goal"]', dialog);
  let saved = false;
  dialog.addEventListener('cancel', event => { if (submit.disabled) event.preventDefault(); });
  dialog.addEventListener('close', () => { dialog.remove(); if (!saved && opener?.isConnected) opener.focus(); });
  cancel.onclick = () => dialog.close();
  $('form', dialog).onsubmit = async event => {
    event.preventDefault();
    if (submit.disabled) return;
    const newName = nameInput.value.trim(), goal = goalInput.value.trim();
    message.hidden = true;
    cancel.disabled = submit.disabled = true;
    let out;
    try { out = await api(`${pathFor(projectData.id)}/update-topic-area`, { method:'POST', body:{ name:areaName, newName, goal } }); }
    catch (error) { message.textContent = error.message; message.hidden = false; cancel.disabled = submit.disabled = false; return; }
    saved = true;
    dialog.close();
    const affected = (projectData.knowledge || []).filter(t => t.area === areaName).map(t => t.path);
    if (typeof topicsMine !== 'undefined') for (const p of affected) topicsMine.add(`${projectData.id}:${p}`);
    tpxDropDocCaches(projectData.id, ['understanding.md', ...affected]);
    try { await loadState(projectData.id, { force:true }); }
    catch { toast('Tier 1 updated. Reload the project to see it.'); return; }
    if (project()?.id === projectData.id && S.route.view === 'topics') {
      if (S.route.topic === `area:${areaName}`) go({ view:'topics', topic:`area:${out.name}` });
      else refreshTopicsPage();
    }
  };
  dialog.showModal();
  nameInput.select();
}
function openDeleteTopicAreaDialog(projectData, areaName, opener) {
  if (!tpxCanEdit(projectData) || topicsBuilding(projectData) || $('#deleteTopicArea')) return;
  const inside = (projectData.knowledge || []).filter(t => t.area === areaName);
  const choice = inside.length
    ? `<fieldset class="tpx-del-modes"><legend>What should happen to its ${esc(plural(inside.length, 'Topic', 'Topics'))}?</legend>
        <label class="tpx-radio-row"><input type="radio" name="mode" value="ungroup" checked><span><strong>Keep ${esc(plural(inside.length, 'Topic', 'Topics'))}</strong><small>Move them to Other</small></span></label>
        <label class="tpx-radio-row"><input type="radio" name="mode" value="delete-topics"><span><strong>Delete ${esc(plural(inside.length, 'Topic', 'Topics'))} too</strong><small>Removes their Topic files; Lines are never deleted</small></span></label>
      </fieldset>`
    : '<p>This removes the empty Tier 1 group. Recover brings earlier Topics back.</p>';
  const dialog = document.createElement('dialog');
  dialog.id = 'deleteTopicArea';
  dialog.className = 'line-command-dialog tpx-dialog';
  dialog.setAttribute('aria-labelledby', 'deleteTopicAreaTitle');
  dialog.innerHTML = `<form><h2 id="deleteTopicAreaTitle">Delete “${esc(areaName)}”?</h2>
    ${choice}
    ${inside.length ? '<p class="tpx-del-note">Lines are never deleted. Recover brings earlier Topics back.</p>' : ''}
    <p class="command-error" role="alert" hidden></p>
    <footer><button type="button" class="btn" data-cancel>Cancel</button><button type="submit" class="btn danger">Delete</button></footer></form>`;
  document.body.append(dialog);
  const cancel = $('[data-cancel]', dialog), submit = $('[type="submit"]', dialog), message = $('.command-error', dialog);
  let deleted = false;
  dialog.addEventListener('cancel', event => { if (submit.disabled) event.preventDefault(); });
  dialog.addEventListener('close', () => { dialog.remove(); if (!deleted && opener?.isConnected) opener.focus(); });
  cancel.onclick = () => dialog.close();
  $('form', dialog).onsubmit = async event => {
    event.preventDefault();
    if (submit.disabled) return;
    const mode = $('input[name="mode"]:checked', dialog)?.value || 'ungroup';
    message.hidden = true;
    cancel.disabled = submit.disabled = true;
    let res;
    try { res = await api(`${pathFor(projectData.id)}/delete-topic-area`, { method:'POST', body:{ name:areaName, mode } }); }
    catch (error) { message.textContent = error.message; message.hidden = false; cancel.disabled = submit.disabled = false; return; }
    deleted = true;
    dialog.close();
    tpxDropDocCaches(projectData.id, ['understanding.md', ...inside.map(t => t.path)]);
    try { await loadState(projectData.id, { force:true }); }
    catch { toast('Tier 1 deleted. Reload the project to see it.'); return; }
    if (project()?.id === projectData.id && S.route.view === 'topics') {
      const refreshed = project(), cur = S.route.topic;
      const goneTopic = mode === 'delete-topics' && inside.some(t => t.path === cur);
      if (cur === `area:${areaName}` || goneTopic) {
        const next = tpxSelected(refreshed, { view:'topics' });
        go({ view:'topics', ...(next ? { topic:next } : {}) });
      } else refreshTopicsPage();
    }
    toast(`Deleted “${areaName}”.`, res.undo && typeof restoreTopics === 'function' ? { label:'Undo', fn:() => restoreTopics(project() || projectData, res.undo) } : undefined);
  };
  dialog.showModal();
}
ACT['new-knowledge-topic'] = opener => {
  const projectData = project();
  const tier = opener?.dataset?.tier === '1' ? 1 : 2;
  openNewTopicDialog(projectData, opener, { tier, area:tier === 2 ? tpxDefaultAreaFor(projectData, opener) : '' });
};
ACT['edit-knowledge-topic'] = opener => openEditKnowledgeTopicDialog(project(), opener?.dataset?.topic, opener);
ACT['delete-knowledge-topic'] = opener => openDeleteKnowledgeTopicDialog(project(), opener?.dataset?.topic, opener);
ACT['edit-topic-area'] = opener => openEditTopicAreaDialog(project(), opener?.dataset?.area, opener);
ACT['delete-topic-area'] = opener => openDeleteTopicAreaDialog(project(), opener?.dataset?.area, opener);
ACT['topic-menu'] = el => {
  const p = project(), path = el?.dataset?.path || el?.dataset?.topic;
  if (!tpxCanEdit(p) || topicsBuilding(p) || !path) return;
  openMenu(el, [
    { label:'Rename / Move…', icon:'pen', fn:() => openEditKnowledgeTopicDialog(project(), path, el) },
    { sep:true },
    { label:'Delete…', icon:'trash', fn:() => openDeleteKnowledgeTopicDialog(project(), path, el) },
  ], { align:'right' });
};
ACT['area-menu'] = el => {
  const p = project(), area = el?.dataset?.area;
  if (!tpxCanEdit(p) || topicsBuilding(p) || !area) return;
  openMenu(el, [
    { label:'New Topic here', icon:'plus', fn:() => openNewTopicDialog(project(), el, { tier:2, area }) },
    { label:'Rename…', icon:'pen', fn:() => openEditTopicAreaDialog(project(), area, el) },
    { sep:true },
    { label:'Delete…', icon:'trash', fn:() => openDeleteTopicAreaDialog(project(), area, el) },
  ], { align:'right' });
};
// The Topics an agent changed shine once in the tree when you are here, and then they are no longer new.
let tpxSeenTimer = 0;
function seeChangedTopics() {
  const p = project();
  if (!topicsGrew(p) || S.route.view !== 'topics') return;
  renderProjbar();
  // Set once: the page repaints on every change in the folder, and each repaint must not put it off again.
  if (tpxSeenTimer) return;
  tpxSeenTimer = setTimeout(() => { tpxSeenTimer = 0; if (S.route.view !== 'topics' || project()?.id !== p.id) return; delete S.topicsNew[p.id]; refreshTopicsPage(); renderProjbar(); }, 3500);
}
// A change in the folder repaints the tree and the page in place, keeping where you were reading.
function refreshTopicsPage() {
  const p = project(), nav = $('#tpxNav'), main = $('#tpxMain');
  if (!p || S.route.view !== 'topics') return;
  const hasMap = Boolean(p.knowledge?.length || p.understanding || p.areas?.length);
  if (Boolean(nav) !== hasMap) { render(); return; }
  if (!hasMap) {
    const empty = $('#tpxEmpty'), html = tpxEmptyHTML(p);
    if (empty && empty._html !== html) { empty.innerHTML = html; empty._html = html; }
    return;
  }
  if (!main) return;
  const on = tpxSelected(p, S.route), navHTML = tpxNavHTML(p, on), mainHTML = tpxMainHTML(p, on);
  if (nav._html !== navHTML) { const top = nav.scrollTop; nav.innerHTML = navHTML; nav._html = navHTML; nav.scrollTop = top; }
  seeChangedTopics();
  if (main._html !== mainHTML) { const top = main.scrollTop, focus = document.activeElement?.closest?.('#tpxMain') ? document.activeElement : null; main.innerHTML = mainHTML; main._html = mainHTML; main.scrollTop = top; if (focus) $(`#tpxMain [data-act="${CSS.escape(focus.dataset.act || '')}"]`)?.focus({ preventScroll:true }); }
}
ACT['tp-show'] = el => {
  const path = el.dataset.topic;
  if (S.route.view !== 'topics') { go({ view:'topics', topic:path }); return; }
  const main = $('#tpxMain');
  if (tpxSelected(project(), S.route) === path) { main?.scrollTo({ top:0, behavior:'smooth' }); return; }
  S.route = { view:'topics', topic:path };
  syncHash(false);
  refreshTopicsPage();
  if (main) main.scrollTop = 0;
  // On a phone the tree sits above the page, so the page comes up to meet the click.
  if (main && main.getBoundingClientRect().top > innerHeight * .6) {
    TPX.scrollMain = !tpxIsAreaRoute(path) && !docById(path, project());
    main.scrollIntoView({ block:'start', behavior:'smooth' });
  }
};
ACT['tp-jump'] = el => {
  const target = document.getElementById(el.dataset.to);
  if (!target) return;
  target.scrollIntoView({ block:'start', behavior:'smooth' });
  target.classList.remove('is-lit'); void target.offsetWidth; target.classList.add('is-lit');
};
// Pointing at a Line or a requirement in the picture lights up the lines between them.
document.addEventListener('pointerover', e => {
  const svg = e.target.closest?.('.tpx-trace svg');
  if (!svg) return;
  const n = e.target.closest('[data-tm-l], [data-tm-r]');
  svg.classList.toggle('has-hot', Boolean(n));
  $$('.tm-e.is-hot, .tm-n.is-hot', svg).forEach(x => x.classList.remove('is-hot'));
  if (!n) return;
  const sel = n.dataset.tmL != null ? `.tm-e[data-l="${n.dataset.tmL}"]` : `.tm-e[data-r="${CSS.escape(n.dataset.tmR)}"]`;
  n.classList.add('is-hot');
  $$(sel, svg).forEach(edge => { edge.classList.add('is-hot'); $(`[data-tm-l="${edge.dataset.l}"]`, svg)?.classList.add('is-hot'); $(`[data-tm-r="${CSS.escape(edge.dataset.r)}"]`, svg)?.classList.add('is-hot'); });
});
document.addEventListener('pointerout', e => { const svg = e.target.closest?.('.tpx-trace svg'); if (svg && !svg.contains(e.relatedTarget)) { svg.classList.remove('has-hot'); $$('.is-hot', svg).forEach(x => x.classList.remove('is-hot')); } });
// Enter or Space on a node in a picture acts as a click, as on a button.
document.addEventListener('keydown', e => {
  if ((e.key !== 'Enter' && e.key !== ' ') || !e.target.closest?.('.tpx-doc svg [role="button"]')) return;
  e.preventDefault(); e.target.closest('[role="button"]').dispatchEvent(new MouseEvent('click', { bubbles:true }));
});
