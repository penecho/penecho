// Project Search matches Lines as you type. Ask sends the question to a saved agent.
// Earlier answers live on this computer and can be reopened without running an agent.
const FIND = { q:'', tab:'all', status:'all', seq:0, data:null, timer:0, open:new Set(), busy:false, refresh:false, answers:new Map(), asking:null, clock:0, history:null };
const FIND_RECENT = 'penecho-find-recent-v1', FIND_WAIT = 140, FIND_AGENT = 'penecho-ask-agent-v1';
const FIND_YOURS = new Set(['ask', 'note', 'canvas']);
const FIND_STATUSES = [['working', 'working'], ['stopped', 'stopped'], ['you', 'need you'], ['todo', 'todo'], ['review', 'to review'], ['send', 'to send']];
const findDay = w => { const m = String(w || '').match(/^(\d{4})-(\d\d)-(\d\d)/); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString([], { month:'short', day:'numeric' }) : ''; };

function findHTML(p, r) {
  const q = r.q || '';
  if (q !== FIND.q || (FIND.data && FIND.data.project !== p.id)) {
    clearTimeout(FIND.timer);
    FIND.seq++; FIND.busy = false; FIND.refresh = false;
    FIND.q = q; FIND.tab = 'all'; FIND.status = 'all'; FIND.data = null; FIND.open.clear();
  }
  if (FIND.q.trim() && (!FIND.data || FIND.data.project !== p.id)) queueMicrotask(() => runFind(p));
  if (!HOSTED && FIND.history?.project !== p.id) queueMicrotask(() => loadAsked(p));
  queueMicrotask(() => { const input = $('#findInput'); if (input && document.activeElement !== input && !matchMedia('(hover: none)').matches) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); } });
  const canAsk = askPresets().length > 0;
  const prompt = canAsk ? 'Ask a question about this project' : 'Search all lines';
  return `<div class="page find-page">
    <div class="find-box" role="search">${ic('search', 19)}<input id="findInput" type="text" value="${esc(FIND.q)}" placeholder="${prompt}" aria-label="${prompt}" autocomplete="off" spellcheck="false" enterkeyhint="${canAsk ? 'send' : 'search'}">${askControlHTML()}</div>
    <div id="findAnswer">${answerHTML(p)}</div>
    <div id="findBody" aria-live="polite">${findBodyHTML(p)}</div>
  </div>`;
}

// ---------- Asking the folder ----------
async function runFind(p = project(), quiet = false) {
  if (!p) return;
  if (quiet && FIND.busy) { FIND.refresh = true; return; }
  const q = FIND.q.trim(), tab = FIND.tab, status = FIND.status, seq = ++FIND.seq;
  if (!q) { FIND.data = null; showFind(); return; }
  if (!quiet) { FIND.busy = true; showFind(); }
  let data;
  try { data = await api(`${pathFor(p.id)}/find?${new URLSearchParams({ q, tab, status })}`); }
  catch (error) {
    // A server from before Find knows only what the page already has.
    if (error.status !== 404) toast(error.message);
    data = findHere(p, q);
  }
  if (seq !== FIND.seq || project()?.id !== p.id || FIND.q.trim() !== q || FIND.tab !== tab || FIND.status !== status) return;
  FIND.busy = false;
  FIND.data = { ...data, project:p.id, q, requestTab:tab, requestStatus:status };
  showFind();
  if (FIND.refresh && S.route.view === 'find') { FIND.refresh = false; runFind(project(), true); }
}
function showFind() {
  const body = $('#findBody'); if (!body || S.route.view !== 'find') return;
  const html = findBodyHTML(project());
  if (body.dataset.h === html) return;
  const held = body.contains(document.activeElement) ? { ...document.activeElement.dataset } : null;
  body.innerHTML = body.dataset.h = html;
  if (held) $$('[data-act]', body).find(el => ['act', 'tab', 'status', 'line', 'step'].every(key => el.dataset[key] === held[key]))?.focus({ preventScroll:true });
}
// The same search over what the page already holds: your words, each Work's first lines, and each Line's job ID.
function findHere(p, q) {
  const all = [...new Set(q.toLowerCase().split(/\s+/).map(w => w.replace(/^["'“‘(（]+|[?？!！.,，。;；:："'”’)）]+$/g, '')).filter(Boolean))];
  const words = all.slice(0, 8), need = words.length <= 2 ? words.length : Math.ceil(words.length / 2), groups = new Map();
  let yours = 0, work = 0;
  for (const l of allLines(p)) {
    const code = l.code && l.code !== l.id ? String(l.code).trim() : '';
    const by = String(l.orchestratedBy || '').trim();
    const codeLow = code.toLowerCase(), byLow = by.toLowerCase(), titleLow = String(l.title || '').toLowerCase();
    const codeWords = codeLow ? words.filter(w => codeLow.includes(w)) : [];
    const byWords = byLow ? words.filter(w => byLow.includes(w)) : [];
    const idWords = [...new Set([...codeWords, ...byWords])];
    const groupFor = () => {
      if (!groups.has(l.id)) groups.set(l.id, { slug:l.id, title:l.title, ...(code ? { code } : {}), ...(by ? { orchestratedBy:by } : {}), hits:[] });
      return groups.get(l.id);
    };
    for (const s of l.stations) {
      if (s.kind === 'merge' || s.kind === 'deliver' || s.finished) continue;
      const mine = FIND_YOURS.has(s.kind), text = String(mine ? askOnly(s.text) : plainOut(s.out || s.text || '')).replace(/\s+/g, ' ').trim(), low = text.toLowerCase();
      const matched = words.filter(w => low.includes(w));
      const found = matched.length && idWords.length ? [...new Set([...matched, ...idWords])] : matched;
      if (!text || found.length < need) continue;
      if (mine) yours++; else work++;
      groupFor().hits.push({ kind:s.kind, step:s.id, label:stepLabel(s), who:mine ? 'you' : s.agent, when:s.when || '', score:found.length, snippet:findSnippet(text, words) });
    }
    if (idWords.length) {
      const titleWords = titleLow ? words.filter(w => titleLow.includes(w)) : [];
      const lineFound = [...new Set([...idWords, ...titleWords])];
      if (lineFound.length >= need) {
        const boost = codeLow && words.includes(codeLow) ? 2 : (codeWords.length || (byLow && words.includes(byLow))) ? 1 : 0.5;
        const score = lineFound.length + boost;
        const firstYours = l.stations.find(s => FIND_YOURS.has(s.kind) && String(askOnly(s.text || '')).replace(/\s+/g, ' ').trim());
        const firstStep = firstYours || l.stations.find(s => s.kind !== 'merge' && s.kind !== 'deliver' && !s.finished) || null;
        const mine = !firstStep || FIND_YOURS.has(firstStep.kind);
        const kind = firstStep ? (mine ? firstStep.kind : 'work') : 'ask', step = firstStep ? firstStep.id : '';
        const g = groupFor();
        const existing = step && g.hits.find(h => h.step === step && h.kind === kind);
        if (existing) existing.score = Math.max(existing.score, score);
        else {
          const prefix = byWords.length && !codeWords.length ? (code ? `${code} · from ${by}` : `from ${by}`) : code || by;
          const preview = firstYours ? String(askOnly(firstYours.text)).replace(/\s+/g, ' ').trim() : String(l.title || '').trim();
          if (mine) yours++; else work++;
          g.hits.push({ kind, step, label:firstStep ? stepLabel(firstStep) : 'Line', who:mine ? 'you' : firstStep.agent, when:firstStep?.when || '', score, snippet:findSnippet(`${prefix}${preview ? ` · ${preview}` : ''}`, words) });
        }
      }
    }
  }
  const order = (a, b) => b.score - a.score || String(b.when).localeCompare(String(a.when));
  const lines = [...groups.values()].map(g => ({ ...g, count:g.hits.length, hits:g.hits.sort(order) })).sort((a, b) => order(a.hits[0], b.hits[0]));
  return { words, total:yours + work, yours, work, lineCount:lines.length, lines, here:true };
}
function findSnippet(text, words, size = 220) {
  const low = text.toLowerCase(), at = Math.min(...words.map(w => { const i = low.indexOf(w); return i < 0 ? Infinity : i; }));
  const start = at === Infinity || at < 60 ? 0 : Math.max(0, text.lastIndexOf(' ', at - 40) + 1 || at - 60);
  return `${start ? '…' : ''}${text.slice(start, start + size).trim()}${start + size < text.length ? '…' : ''}`;
}

// ---------- What it shows ----------
function findMarked(text, words) {
  const safe = esc(text);
  if (!words?.length) return safe;
  const re = new RegExp(`(${words.map(w => esc(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length).join('|')})`, 'gi');
  return safe.replace(re, '<mark>$1</mark>');
}
function findState(l) {
  if (!l) return '';
  const archived = l.archived || l.closed, key = archived ? 'archived' : shownState(l);
  const word = archived && l.outdated ? 'Outdated' : lineReviewed(l) ? STATE_TEXT.reviewed : STATE_TEXT[key] || '';
  return word ? `<span class="fl-state s-${esc(key)}">${esc(word)}</span>` : '';
}
function findHit(h, slug, words) {
  const mine = FIND_YOURS.has(h.kind), who = mine ? `<i class="fh-ring k-${esc(h.kind)}"></i><b>${esc(h.kind === 'ask' ? 'Ask' : h.kind === 'note' ? 'Note' : 'Drawing')}</b>` : `${av(h.who || 'agent', 18)}<b>${esc(h.label)}</b>`;
  return `<button type="button" class="fh ${mine ? 'fh-ask' : 'fh-work'}" data-act="find-open" data-line="${esc(slug)}" data-step="${esc(h.step)}">
    <span class="fh-who">${who}</span><span class="fh-text">${findMarked(h.snippet, words)}</span><time>${esc(findDay(h.when))}</time></button>`;
}
function findRecent(p) { try { return (JSON.parse(localStorage.getItem(FIND_RECENT) || '{}')[p.id] || []).slice(0, 6); } catch { return []; } }
function rememberFind(p, q) {
  if (!q.trim()) return;
  try { const all = JSON.parse(localStorage.getItem(FIND_RECENT) || '{}'); all[p.id] = [q.trim(), ...(all[p.id] || []).filter(x => x !== q.trim())].slice(0, 6); localStorage.setItem(FIND_RECENT, JSON.stringify(all)); } catch { /* Recent searches are only a convenience. */ }
}
function forgetFind(p, q) {
  const needle = String(q || '').trim();
  if (!p || !needle) return;
  try {
    const all = JSON.parse(localStorage.getItem(FIND_RECENT) || '{}');
    const list = Array.isArray(all[p.id]) ? all[p.id].filter(x => x !== q && String(x).trim() !== needle) : [];
    if (list.length) all[p.id] = list; else delete all[p.id];
    localStorage.setItem(FIND_RECENT, JSON.stringify(all));
  } catch { /* Recent searches are only a convenience. */ }
}
// Old servers and the local fallback can still filter what they returned. Never claim complete counts from capped data.
function findSelection(p, d) {
  if (d.filterVersion === 1) return d;
  const statusCounts = { all:0, working:0, stopped:0, you:0, todo:0, review:0, send:0 }, lines = [];
  let yours = 0, work = 0;
  const limited = !d.here && ((d.lineCount || d.lines.length) > d.lines.length || d.lines.some(g => g.count > g.hits.length));
  for (const g of d.lines) {
    const l = lineById(p, g.slug), hits = g.hits.filter(h => FIND.tab === 'all' || (FIND.tab === 'yours') === FIND_YOURS.has(h.kind));
    if (hits.length) { statusCounts.all++; for (const [key] of FIND_STATUSES) if (LINE_STATUS.matches(l, key)) statusCounts[key]++; }
    if (!LINE_STATUS.matches(l, FIND.status)) continue;
    for (const h of g.hits) { if (FIND_YOURS.has(h.kind)) yours++; else work++; }
    if (hits.length) lines.push({ ...g, count:hits.length, hits });
  }
  const counts = FIND.status === 'all' ? { total:d.total, yours:d.yours, work:d.work } : { total:yours + work, yours, work };
  return { ...d, ...counts, statusCounts, lineCount:lines.length, lines, limited, countsLimited:limited && FIND.status !== 'all' };
}
function findStatusHTML(counts, limited) {
  const icon = key => key === 'working' ? '<i class="spin" aria-hidden="true"></i>' : ic(key === 'stopped' ? 'x' : key === 'you' ? 'hint' : key === 'todo' ? 'box' : key === 'review' ? 'eye' : 'send', 14);
  return `<div class="find-status" role="group" aria-label="Filter lines by status">${FIND_STATUSES.map(([key, words]) => `<button type="button" data-act="find-status" data-status="${key}" aria-pressed="${FIND.status === key}" title="${words === 'to send' ? 'Lines with an Ask not sent yet' : words === 'need you' ? 'Lines waiting for your answer or choice' : words === 'todo' ? 'Finished lines marked Todo' : words === 'to review' ? 'Finished results to review' : `Lines ${words}`}">${icon(key)}${!limited && counts ? `${counts[key] || 0} ` : ''}${words}</button>`).join('')}${FIND.status !== 'all' ? '<button type="button" class="find-clear" data-act="find-status" data-status="all">Clear status</button>' : ''}</div>`;
}
function findBodyHTML(p) {
  if (!p) return '';
  if (!FIND.q.trim()) {
    const asked = askedList(p), seen = new Set(asked.map(x => x.question)), recent = findRecent(p).filter(q => !seen.has(q));
    return `${asked.length ? `<section class="find-recent find-asked"><h3>Saved answers</h3>${asked.map(x => `<div class="find-row asked"><button type="button" class="fr-open" data-act="find-asked" data-id="${esc(x.id)}">${av(x.agent || 'agent', 18)}<span class="fr-q">${esc(x.question)}</span><time>${esc(findDay(x.at))}</time></button><button type="button" class="icon-btn fr-del" data-act="find-asked-delete" data-id="${esc(x.id)}" title="Delete" aria-label="Delete ${esc(x.question)}">${ic('trash', 15)}</button></div>`).join('')}</section>` : ''}${recent.length ? `<section class="find-recent"><h3>Recent searches</h3>${recent.map(q => `<div class="find-row recent"><button type="button" class="fr-open" data-act="find-again" data-q="${esc(q)}">${ic('search', 15)}<span class="fr-q">${esc(q)}</span></button><button type="button" class="icon-btn fr-del" data-act="find-recent-delete" data-q="${esc(q)}" title="Delete" aria-label="Delete ${esc(q)}">${ic('trash', 15)}</button></div>`).join('')}</section>` : ''}`;
  }
  const raw = FIND.data, ready = raw && raw.project === p.id && raw.q === FIND.q.trim(), d = ready ? findSelection(p, raw) : null;
  const loading = FIND.busy || !ready || (raw.filterVersion === 1 && (raw.tab !== FIND.tab || raw.status !== FIND.status));
  const tabs = [['all', 'All', d?.total], ['yours', 'Your Asks', d?.yours], ['work', "Agents' work", d?.work]];
  const groups = d?.lines || [], n = d?.lineCount || 0;
  const controls = `<div class="find-tabs pills" role="group" aria-label="Show matches from">${tabs.map(([k, label, count]) => `<button type="button" aria-pressed="${FIND.tab === k}" data-act="find-tab" data-tab="${k}">${label}${!loading ? `<em>${d.countsLimited ? '≥' : ''}${count}</em>` : ''}</button>`).join('')}${!loading ? `<span class="find-count">${d.limited ? 'Available: ' : groups.length < n ? `${groups.length} of ` : ''}${n} ${n === 1 ? 'line' : 'lines'}</span>` : ''}</div>${findStatusHTML(!loading ? d.statusCounts : null, d?.limited)}`;
  if (loading) return `${controls}<p class="find-none" role="status" aria-label="Searching"><i class="spin" aria-hidden="true"></i></p>`;
  const limitNote = d.limited ? '<p class="find-limit">Showing part of the results. Filters apply to these matches; narrow your search to find more.</p>' : '';
  if (!groups.length) return `${controls}${limitNote}<div class="find-empty"><p>${d.limited ? 'No matches in the available results.' : FIND.status !== 'all' ? 'No matching lines with this status.' : FIND.tab !== 'all' ? 'No matches in this category.' : 'Nothing found'}</p>${FIND.status !== 'all' ? '<button type="button" class="btn sm" data-act="find-status" data-status="all">Show all statuses</button>' : ''}</div>`;
  return `${controls}${limitNote}
    ${groups.map(g => {
      const l = lineById(p, g.slug), open = FIND.open.has(g.slug), some = open ? g.hits : g.hits.slice(0, 3), more = g.hits.length - some.length;
      const code = (l?.code && l.code !== g.slug) ? l.code : g.code || '';
      const title = l?.title || g.title;
      return `<section class="fl" data-line="${esc(g.slug)}"><header>${code ? `<code class="fl-code">${findMarked(code, d.words)}</code>` : ''}<button type="button" class="fl-title" data-act="find-open" data-line="${esc(g.slug)}" title="${esc(title)}">${esc(title)}</button>${l?.branch ? `<code class="fl-branch">${ic('branch', 12)}<span>${esc(l.branch)}</span></code>` : ''}<span class="fl-grow"></span>${findState(l)}</header>
        ${some.map(h => findHit(h, g.slug, d.words)).join('')}
        ${more ? `<button type="button" class="fl-more" data-act="find-more" data-line="${esc(g.slug)}">${more} more</button>` : ''}${g.count > g.hits.length ? `<p class="find-limit">Showing ${some.length} of ${g.count} matches. Narrow your search to find more.</p>` : ''}</section>`;
    }).join('')}`;
}

// ---------- Typing and clicking ----------
document.addEventListener('input', e => {
  if (e.target.id !== 'findInput' || e.isComposing) return;
  findTyped(e.target.value);
});
// Chinese and Japanese input settles on compositionend, not on each key.
document.addEventListener('compositionend', e => { if (e.target.id === 'findInput') findTyped(e.target.value); });
document.addEventListener('keydown', e => {
  if (e.target.id !== 'findInput') return;
  if (e.key === 'Escape' && e.target.value) { e.preventDefault(); e.stopPropagation(); e.target.value = ''; findTyped(''); }
  if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  if (!e.altKey && !e.shiftKey && askPresets().length) {
    if (!e.repeat) findAsk();
    return;
  }
  rememberFind(project(), e.target.value);
  clearTimeout(FIND.timer);
  runFind();
});
function findTyped(value) {
  if (value === FIND.q) return;
  FIND.q = value; FIND.tab = 'all'; FIND.status = 'all'; FIND.busy = false; FIND.refresh = false; FIND.seq++; FIND.open.clear();
  // The address keeps what you looked for, so going back to Find finds it again.
  S.route = { view:'find', q:value }; syncHash(true);
  clearTimeout(FIND.timer);
  showAnswer();
  if (!value.trim()) { FIND.data = null; showFind(); return; }
  showFind();
  FIND.timer = setTimeout(() => runFind(), FIND_WAIT);
}
ACT['find-tab'] = el => { FIND.tab = el.dataset.tab; FIND.open.clear(); clearTimeout(FIND.timer); runFind(); };
ACT['find-status'] = el => { FIND.status = FIND.status === el.dataset.status ? 'all' : el.dataset.status; FIND.open.clear(); clearTimeout(FIND.timer); runFind(); };
ACT['find-more'] = el => { FIND.open.add(el.dataset.line); showFind(); };
ACT['find-again'] = el => { const input = $('#findInput'); if (input) input.value = el.dataset.q; findTyped(el.dataset.q); clearTimeout(FIND.timer); runFind(); };
ACT['find-recent-delete'] = el => {
  const p = project(), q = el.dataset.q;
  if (!p || !q) return;
  forgetFind(p, q);
  showFind();
};
ACT['find-open'] = el => {
  const p = project(), l = lineById(p, el.dataset.line);
  rememberFind(p, FIND.q);
  if (!l) { toast('This line is no longer here.'); return; }
  go({ view:'line', line:l.id, step:l.light || stationById(l, el.dataset.step) ? el.dataset.step : undefined }, { from:el });
};

// ---------- Asking an agent ----------
// The saved agents that can answer here: those whose agent has a quick answering mode (Claude Code, Codex, OpenCode, Pi, omp, Kimi, Antigravity).
const askPresets = () => (HOSTED ? [] : (S.presets?.presets || []).filter(x => x.available && x.answers && x.showInPicker !== false));
function askPreset() {
  const all = askPresets();
  let kept = ''; try { kept = localStorage.getItem(FIND_AGENT) || ''; } catch { /* Only a convenience. */ }
  return all.find(x => x.id === kept) || all.find(x => x.id === S.presets?.default) || all[0] || null;
}
function askControlHTML() {
  const all = askPresets(), chosen = askPreset();
  if (!chosen) return '';
  const pick = all.length > 1 ? `<select id="findAgent" class="find-agent" aria-label="Agent that answers">${all.map(x => `<option value="${esc(x.id)}" ${x.id === chosen.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>` : `<span class="find-agent one" title="${esc(chosen.name)}">${esc(chosen.name)}</span>`;
  return `${pick}<button type="button" class="btn sm primary find-ask" data-act="find-ask" aria-keyshortcuts="Enter" title="Ask the selected agent (Enter)">Ask <kbd class="cmp-key" aria-hidden="true"><b>↵</b></kbd></button>`;
}
const answerKey = (p, q) => `${p?.id || ''}\n${q}`;
// The answer to what is in the box: one asked on this page, else the one kept from before.
function answerFor(p, q = FIND.q.trim()) {
  if (!p) return null;
  const live = FIND.answers.get(answerKey(p, q));
  if (live) return live;
  const kept = askedList(p).find(x => x.question === q);
  return kept ? { id:kept.id, q:kept.question, agent:kept.agent, name:kept.name, status:'done', text:kept.answer, lines:kept.lines || [], took:kept.took, at:kept.at } : null;
}
const ASK_BADGE_KIND = new Map([
  ['finished', 'done'], ['done', 'done'], ['completed', 'done'], ['reviewed', 'done'], ['shipped', 'done'], ['landed', 'done'],
  ['已完成', 'done'], ['已审阅', 'done'], ['已合并', 'done'], ['已提交', 'done'],
  ['to do', 'todo'], ['todo', 'todo'], ['remaining', 'todo'], ['pending', 'todo'], ['not started', 'todo'], ['left to do', 'todo'],
  ['待办', 'todo'], ['未完成', 'todo'], ['待完成', 'todo'],
  ['to review', 'review'], ['needs review', 'review'], ['待审阅', 'review'], ['待评审', 'review'],
  ['needs you', 'wait'], ['waiting on you', 'wait'], ['action needed', 'wait'], ['需要你', 'wait'], ['待你确认', 'wait'],
  ['in progress', 'working'], ['working', 'working'], ['ongoing', 'working'], ['进行中', 'working'],
  ['blocked', 'blocked'], ['caveat', 'blocked'], ['caveats', 'blocked'], ['uncommitted', 'blocked'], ['unverified', 'blocked'],
  ['受阻', 'blocked'], ['注意', 'blocked'], ['未提交', 'blocked'],
]);
function askBadgeHTML(label) {
  const clean = String(label || '').trim().replace(/[:：]+$/, '').trim();
  const kind = ASK_BADGE_KIND.get(clean.toLowerCase());
  return kind ? `<span class="fa-badge is-${kind}">${clean}</span>` : '';
}
function decorateAskLabels(html) {
  return String(html || '')
    .replace(/<dt>([^<]+)<\/dt>/g, (all, label) => { const b = askBadgeHTML(label); return b ? `<dt class="fa-dt-badge">${b}</dt>` : all; })
    .replace(/(<li\b[^>]*>\s*)<strong>([^<]+)<\/strong>([:：]?)/g, (all, pre, label) => { const b = askBadgeHTML(label); return b ? `${pre}${b}` : all; })
    .replace(/(<p class="md-p"(?:\s+data-[ab]="\d+")*>\s*)<strong>([^<]+)<\/strong>([:：]?)/g, (all, pre, label) => { const b = askBadgeHTML(label); return b ? `${pre}${b}` : all; })
    .replace(/\[([^\[\]<>]{2,24})\]/g, (all, label) => askBadgeHTML(label) || all);
}
function answerHTML(p) {
  const a = answerFor(p);
  if (!a) return '';
  const again = askPresets().length ? `<button type="button" class="icon-btn" data-act="find-ask" title="Ask again" aria-label="Ask again">${ic('retry', 15)}</button>` : '';
  const head = `<header>${av(a.agent || 'agent', 20)}<b>${esc(a.name)}</b><span class="fa-grow"></span>${a.status === 'asking'
    ? `<span class="fa-time"><i class="spin" aria-hidden="true"></i><span>${Math.max(0, Math.round((Date.now() - a.started) / 1000))} s</span></span><button type="button" class="btn sm" data-act="find-ask-stop">Stop</button>`
    : `${a.at ? `<time title="${esc(new Date(a.at).toLocaleString())}">${esc(findDay(a.at))}</time>` : a.took ? `<time>${Math.max(1, Math.round(a.took / 1000))} s</time>` : ''}<button type="button" class="icon-btn" data-act="find-answer-copy" title="Copy answer" aria-label="Copy answer">${ic('copy', 15)}</button>${again}${a.id ? `<button type="button" class="icon-btn" data-act="find-asked-delete" data-id="${esc(a.id)}" title="Delete" aria-label="Delete this answer">${ic('trash', 15)}</button>` : ''}`}</header>`;
  if (a.status === 'asking') return `<section class="find-answer asking" aria-busy="true">${head}<p class="fa-wait">Reading the project's docs…</p></section>`;
  if (a.status === 'error') return `<section class="find-answer failed" role="alert">${head}<p class="fa-error">${esc(a.error)}</p></section>`;
  const refs = new Map((a.lines || []).map(l => [l.ref, l])), held = [];
  // Each [PE-12] the agent cited becomes a link to that Line; unknown ids stay as text.
  const marked = String(a.text || '').replace(/\[([A-Z][A-Z0-9]*-\d+|L\d+)\](?:\((?:[^()\s]*\/)?lines\/[^()\s]+\.md\))?/g, (all, ref) => refs.has(ref) ? `⁣${held.push(ref) - 1}⁣` : all);
  const html = decorateAskLabels(wordsMd(marked, p)).replace(/⁣(\d+)⁣/g, (all, i) => { const l = refs.get(held[Number(i)]), real = lineById(p, l.slug); return `<button type="button" class="fa-ref" data-act="find-open" data-line="${esc(l.slug)}" title="${esc(real?.title || l.title)}">${esc(/^L\d+$/.test(l.ref) ? (real?.title || l.title) : l.ref)}</button>`; });
  const cited = (a.lines || []).filter(l => l.cited);
  const lines = cited.length ? `<div class="fa-lines">${cited.map(l => { const real = lineById(p, l.slug); return `<button type="button" class="fa-line" data-act="find-open" data-line="${esc(l.slug)}">${/^L\d+$/.test(l.ref) ? '' : `<code>${esc(l.ref)}</code>`}<span>${esc(real?.title || l.title)}</span>${findState(real)}</button>`; }).join('')}</div>` : '';
  return `<section class="find-answer">${head}<div class="fa-body">${html}</div>${lines}</section>`;
}
function showAnswer() {
  const box = $('#findAnswer'); if (!box || S.route.view !== 'find') return;
  const html = answerHTML(project());
  if (box.dataset.h !== html) box.innerHTML = box.dataset.h = html;
  // Seconds go on while an agent answers on this page.
  const a = answerFor(project());
  if (a?.status === 'asking' && !FIND.clock) FIND.clock = setInterval(() => { if (S.route.view !== 'find' || !FIND.asking) { clearInterval(FIND.clock); FIND.clock = 0; } showAnswer(); }, 1000);
}
async function findAsk(p = project()) {
  const q = FIND.q.trim(), preset = askPreset();
  if (!p || !q || !preset) { if (!q) $('#findInput')?.focus(); return; }
  FIND.asking?.stop.abort();
  const key = answerKey(p, q), a = { q, agent:preset.agent, name:preset.name, status:'asking', started:Date.now(), stop:new AbortController() };
  FIND.answers.set(key, a); FIND.asking = a;
  rememberFind(p, q); showAnswer();
  try {
    const r = await api(`${pathFor(p.id)}/ask`, { method:'POST', body:{ question:q, preset:preset.id }, signal:a.stop.signal });
    Object.assign(a, { status:'done', id:r.id, text:r.answer, lines:r.lines || [], name:r.name || a.name, agent:r.agent || a.agent, took:r.took });
    if (r.id && FIND.history?.project === p.id) FIND.history.asks = [{ id:r.id, at:new Date().toISOString(), question:q, answer:r.answer, agent:a.agent, name:a.name, took:r.took, lines:a.lines }, ...FIND.history.asks.filter(x => x.question !== q)];
  } catch (error) {
    if (a.stop.signal.aborted) { if (FIND.answers.get(key) === a) FIND.answers.delete(key); }
    else Object.assign(a, { status:'error', error:error.status === 404 ? 'Restart PenEcho to ask questions here.' : error.message });
  }
  if (FIND.asking === a) FIND.asking = null;
  showAnswer();
}
ACT['find-ask'] = () => findAsk();
ACT['find-ask-stop'] = () => { FIND.asking?.stop.abort(); };
ACT['find-answer-copy'] = () => { const a = answerFor(project()); if (a?.text) writeClipboard(a.text).then(ok => toast(ok ? 'Copied the answer' : 'Could not copy')); };
document.addEventListener('change', e => {
  if (e.target.id !== 'findAgent') return;
  try { localStorage.setItem(FIND_AGENT, e.target.value); } catch { /* Only a convenience. */ }
  $('#findInput')?.focus();
});

// ---------- Asked before ----------
const askedList = p => (p && FIND.history?.project === p.id ? FIND.history.asks : []);
async function loadAsked(p) {
  if (FIND.history?.project === p.id && FIND.history.loading) return;
  FIND.history = { project:p.id, asks:[], loading:true };
  let asks = [];
  try { asks = (await api(`${pathFor(p.id)}/asks`)).asks || []; }
  catch (error) { if (error.status !== 404) toast(error.message); }
  if (FIND.history?.project !== p.id) return;
  FIND.history = { project:p.id, asks };
  showFind(); showAnswer();
}
ACT['find-asked'] = el => {
  const x = askedList(project()).find(a => a.id === el.dataset.id); if (!x) return;
  const input = $('#findInput'); if (input) input.value = x.question;
  findTyped(x.question); clearTimeout(FIND.timer); runFind();
};
ACT['find-asked-delete'] = async el => {
  const p = project(), id = el.dataset.id, x = askedList(p).find(a => a.id === id);
  if (!p || !x) return;
  if (el) el.disabled = true;
  try {
    const result = await api(`${pathFor(p.id)}/asks/${encodeURIComponent(id)}`, { method:'DELETE' });
    if (FIND.history?.project === p.id) FIND.history.asks = result.asks || [];
  }
  catch (error) { if (el) el.disabled = false; toast(error.message); return; }
  forgetFind(p, x.question);
  const live = FIND.answers.get(answerKey(p, x.question));
  if (live?.id === id) FIND.answers.delete(answerKey(p, x.question));
  showFind(); showAnswer();
};
