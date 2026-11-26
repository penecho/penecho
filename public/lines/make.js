// What to make, chosen in the box (PE-404). The choices live inside + (alongside files and a new Canvas); only an active choice shows as a chip in the bar.
// A choice shows as itself, never as prompt text: the Ask keeps your own words and one line, `> Make · Slides · Investor update`,
// which the server turns into one exact instruction for the agent (format.js makeSay). MeetCue is the fifth chip: its meetings
// become a meeting node on this line, or a line of their own from the home.
ICONS.diagram = '<rect x="3" y="4" width="7" height="5" rx="1"/><rect x="14" y="4" width="7" height="5" rx="1"/><rect x="14" y="15" width="7" height="5" rx="1"/><path d="M10 6.500h4M17.500 9v6"/>';
ICONS.explorer = '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 16h10M7 12l3-3 3 2 4-4"/>';
ICONS.card = '<rect x="6" y="3" width="12" height="18" rx="1.500"/><path d="M9 8h6M9 12h6M9 16h3"/>';
ICONS.table = '<rect x="3" y="5" width="18" height="14" rx="1.500"/><path d="M3 10h18M9 5v14"/>';
ICONS.photo = '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 16l5-5 4 4 3-3 6 6"/>';

const MAKES = {
  diagram:{ label:'Diagram', icon:'diagram', kinds:[
    { id:'auto', label:'AI picks', ph:'What should the diagram show?', ex:'How sign-in works, end to end' },
    { id:'architecture', label:'Architecture', ph:'Which system, and its parts?', ex:'This project: app, server, Cloud, database' },
    { id:'workflow', label:'Workflow', ph:'Which process, step by step?', ex:'From sign-up to the first project' },
    { id:'sequence', label:'Sequence', ph:'Who talks to whom, and in what order?', ex:'Sign-in, from the app to the database' } ],
    gives:[['attach', 'clip', 'Add a file or screenshot'], ['sketch', 'pen', 'Start from a sketch']] },
  explorer:{ label:'Explorer', icon:'explorer', kinds:[
    { id:'explain', label:'Explain', ph:'What should it explain?', ex:'How compound interest grows' },
    { id:'try', label:'Let me try', ph:'What should you be able to change and see?', ex:'Change the rate and watch the savings grow' },
    { id:'prototype', label:'Prototype', ph:'Which screen, and what can be clicked?', ex:'The sign-in page on a tablet' } ],
    gives:[['attach', 'clip', 'Add a paper, PDF or notes'], ['sketch', 'pen', 'Sketch it first']] },
  slides:{ label:'Slides', icon:'slides', kinds:[
    { id:'auto', label:'AI picks' }, { id:'healthcare', label:'Healthcare report' }, { id:'investor', label:'Investor update' }, { id:'market', label:'Market chartbook' } ],
    ph:'What is the deck for, and who will see it?', ex:'Q3 results for the board',
    gives:[['paste', 'table', 'Paste a table from Excel'], ['sheet', 'clip', 'Add .xlsx or .csv']] },
  card:{ label:'Note card', icon:'card', kinds:[
    { id:'knowledge', label:'Knowledge card', ph:'What should the card keep?', ex:'The key points of the article I pasted' },
    { id:'flashcards', label:'Flashcards', ph:'Which topic, and how many cards?', ex:'10 cards from chapter 3' },
    { id:'work', label:'Work note', ph:'What happened? Decisions and to-dos come out.', ex:'Today’s stand-up' } ],
    gives:[['paste', 'note', 'Paste an article or notes'], ['meeting', 'meetcue', 'Meeting from MeetCue'], ['photo', 'photo', 'Add a photo']] },
};
const MAKE_ORDER = ['diagram', 'explorer', 'slides', 'card'];
const makeKind = (m, sub) => MAKES[m.kind || m]?.kinds.find(k => k.id === sub) || MAKES[m.kind || m]?.kinds[0];
const makeWords = make => { const m = MAKES[make?.kind]; if (!m) return ''; const k = makeKind(make.kind, make.sub); return k.id === 'auto' ? m.label : `${m.label} · ${k.label}`; };
// The thumbnails are the templates' own, as the slide rules have them. Relative, so penecho.ai finds them under /canvas/.
const SLIDE_ART = id => `lines/ppt/${id}.jpg`;

// ---------- Small pictures of each kind ----------
// On tokens, so the pictures stay clear in dark mode (dark.css).
const MK_O = 'var(--accent-label)', MK_G = 'var(--mk-line, #94a3b8)', MK_D = 'var(--mk-ink, #334155)', MK_W = 'var(--paper, #fff)';
function makePic(kind, sub) {
  const s = b => `<svg width="88" height="50" viewBox="0 0 88 50" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${b}</svg>`;
  if (kind === 'slides' && sub !== 'auto') return `<img src="${SLIDE_ART(sub)}" alt="" loading="lazy">`;
  const O = MK_O, G = MK_G, D = MK_D, W = MK_W;
  const P = {
    auto:`<path d="M44 12l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="${O}" opacity=".85"/><path d="M62 10l1.3 3.4 3.4 1.3-3.4 1.3L62 19.4l-1.3-3.4-3.4-1.3 3.4-1.3zM27 30l1 2.6 2.6 1-2.6 1L27 37.2l-1-2.6-2.6-1 2.6-1z" fill="${O}" opacity=".5"/>`,
    architecture:`<rect x="8" y="8" width="20" height="12" rx="3" stroke="${D}" stroke-width="1.4"/><rect x="34" y="19" width="20" height="12" rx="3" stroke="${O}" stroke-width="1.6"/><rect x="60" y="8" width="20" height="12" rx="3" stroke="${D}" stroke-width="1.4"/><ellipse cx="70" cy="33" rx="9" ry="3" stroke="${D}" stroke-width="1.4"/><path d="M61 33v8c0 1.7 4 3 9 3s9-1.3 9-3v-8" stroke="${D}" stroke-width="1.4"/><path d="M28 16l6 6M54 22l6-4M54 28l6 5" stroke="${G}" stroke-width="1.3"/>`,
    workflow:`<rect x="4" y="19" width="16" height="12" rx="6" stroke="${D}" stroke-width="1.4"/><rect x="26" y="19" width="16" height="12" rx="2" stroke="${D}" stroke-width="1.4"/><path d="M56 15l9 10-9 10-9-10z" stroke="${O}" stroke-width="1.6"/><rect x="70" y="19" width="15" height="12" rx="6" stroke="${D}" stroke-width="1.4"/><path d="M20 25h6M42 25h5M65 25h5" stroke="${G}" stroke-width="1.3"/>`,
    sequence:`<rect x="6" y="5" width="18" height="8" rx="2" stroke="${D}" stroke-width="1.3"/><rect x="35" y="5" width="18" height="8" rx="2" stroke="${D}" stroke-width="1.3"/><rect x="64" y="5" width="18" height="8" rx="2" stroke="${D}" stroke-width="1.3"/><path d="M15 13v33M44 13v33M73 13v33" stroke="${G}" stroke-width="1.1" stroke-dasharray="2 2"/><path d="M15 21h27m-3-2.5 3 2.5-3 2.5M44 29h27m-3-2.5 3 2.5-3 2.5" stroke="${O}" stroke-width="1.5"/><path d="M71 38H17m3-2.5-3 2.5 3 2.5" stroke="${D}" stroke-width="1.3"/>`,
    explain:`<rect x="10" y="6" width="68" height="38" rx="3" stroke="${D}" stroke-width="1.3"/><path d="M16 36c8-2 12-14 22-16s14 6 22-4 12-6 12-6" stroke="${O}" stroke-width="1.7"/><path d="M16 12h20M16 16h12" stroke="${G}" stroke-width="1.5"/>`,
    try:`<rect x="10" y="6" width="68" height="38" rx="3" stroke="${D}" stroke-width="1.3"/><path d="M18 34v-6M28 34v-10M38 34v-14M48 34v-9M58 34v-17M68 34v-12" stroke="${O}" stroke-width="4"/><path d="M18 40h52" stroke="${G}" stroke-width="1.5"/><circle cx="46" cy="40" r="3" fill="${W}" stroke="${D}" stroke-width="1.4"/>`,
    prototype:`<rect x="10" y="6" width="68" height="38" rx="3" stroke="${D}" stroke-width="1.3"/><path d="M10 13h68M26 13v31" stroke="${G}" stroke-width="1.2"/><path d="M14 19h8M14 24h8M14 29h6" stroke="${G}" stroke-width="1.5"/><rect x="32" y="19" width="40" height="9" rx="2" stroke="${D}" stroke-width="1.2"/><rect x="54" y="34" width="18" height="6" rx="3" fill="${O}" stroke="none"/>`,
    knowledge:`<rect x="30" y="4" width="28" height="42" rx="3" fill="${W}" stroke="${D}" stroke-width="1.3"/><rect x="30" y="4" width="28" height="9" rx="3" fill="${O}" opacity=".85" stroke="none"/><path d="M35 19h18M35 24h18M35 29h12M35 36h8" stroke="${G}" stroke-width="1.5"/>`,
    flashcards:`<rect x="22" y="10" width="26" height="36" rx="3" fill="${W}" stroke="${G}" stroke-width="1.2" transform="rotate(-8 35 28)"/><rect x="40" y="10" width="26" height="36" rx="3" fill="${W}" stroke="${G}" stroke-width="1.2" transform="rotate(8 53 28)"/><rect x="31" y="6" width="26" height="38" rx="3" fill="${W}" stroke="${D}" stroke-width="1.3"/><text x="44" y="31" text-anchor="middle" font-size="15" font-weight="700" fill="${O}" stroke="none" font-family="-apple-system,sans-serif">?</text>`,
    work:`<rect x="30" y="4" width="28" height="42" rx="3" fill="${W}" stroke="${D}" stroke-width="1.3"/><rect x="34" y="11" width="5" height="5" rx="1" stroke="${O}" stroke-width="1.3"/><rect x="34" y="21" width="5" height="5" rx="1" stroke="${O}" stroke-width="1.3"/><rect x="34" y="31" width="5" height="5" rx="1" stroke="${D}" stroke-width="1.2"/><path d="M42 13.5h12M42 23.5h10M42 33.5h11" stroke="${G}" stroke-width="1.5"/><path d="M35 13.5l1.2 1.2 2-2.4M35 23.5l1.2 1.2 2-2.4" stroke="${O}" stroke-width="1.2"/>`,
    meetcue:`<rect x="10" y="6" width="68" height="38" rx="3" stroke="${D}" stroke-width="1.3"/><rect x="15" y="13" width="18" height="15" rx="4" stroke="${O}" stroke-width="1.5"/><path d="M19 28v5l5-5" stroke="${O}" stroke-width="1.5"/><path d="M24 17.2l1 2.3 2.3 1-2.3 1-1 2.3-1-2.3-2.3-1 2.3-1z" fill="${O}" stroke="none"/><path d="M39 15h31M39 22h25M39 29h29M39 36h18" stroke="${G}" stroke-width="1.5"/>`,
  };
  return s(P[sub] || '');
}
// What each chip shows in the row of five that Make with AI opens.
const MAKE_FRONT = { diagram:'architecture', explorer:'try', slides:'investor', card:'knowledge', meetcue:'meetcue' };

// ---------- The box ----------
const makeBox = form => comp(form.dataset.comp);
const chipsHere = form => form.dataset.preview === '1';
const chipsInBar = form => chipsHere(form) && (typeof EMBED === 'undefined' || !EMBED);
const meetcueHere = () => !HOSTED?.read;
function makeChipsHTML(form, c) {
  const on = c.flags.make?.kind, panel = c.panel === 'meetcue';
  const chip = (kind, label, icon, act, extra = '') => `<button type="button" class="cmp-chip on" data-act="${act}" data-kind="${kind}" aria-pressed="true" title="${esc(label)}"${extra}>${ic(icon, 16)}<span>${esc(label)}</span></button>`;
  if (on && MAKES[on]) return chip(on, MAKES[on].label, MAKES[on].icon, 'make-chip');
  if (panel && meetcueHere()) return chip('meetcue', 'MeetCue', 'meetcue', 'make-meetcue');
  return '';
}
// What to make and MeetCue live inside + so the composer bar stays uncluttered.
function makePlusItems(form) {
  const c = makeBox(form), on = c.flags.make?.kind, panel = c.panel === 'meetcue';
  return [
    { sep:true },
    ...MAKE_ORDER.map(k => ({
      label:MAKES[k].label,
      icon:MAKES[k].icon,
      on:on === k,
      fn:() => { if (c.flags.make?.kind === k) clearMake(form); else chooseMake(form, k); },
    })),
    ...(meetcueHere() ? [{
      label:'MeetCue',
      icon:'meetcue',
      on:panel,
      fn:() => ACT['make-meetcue'](form),
    }] : []),
  ];
}
const closeX = (label, act = 'make-close') => `<button type="button" class="cmp-make-x" data-act="${act}" aria-label="${esc(label)}" title="${esc(label)}">${ic('x', 15)}</button>`;
function makePanelHTML(form, c) {
  const m = c.flags.make;
  if (m) {
    const kinds = MAKES[m.kind].kinds;
    return `<div class="cmp-kinds" role="radiogroup" aria-label="${esc(MAKES[m.kind].label)}">${kinds.map(k => `<button type="button" class="cmp-kind ${k.id === makeKind(m.kind, m.sub).id ? 'on' : ''}" role="radio" aria-checked="${k.id === makeKind(m.kind, m.sub).id}" data-act="make-kind" data-sub="${k.id}"><span class="cmp-kind-pic">${makePic(m.kind, k.id)}</span><span>${esc(k.label)}</span></button>`).join('')}${closeX(`Clear ${MAKES[m.kind].label}`)}</div>`;
  }
  if (c.panel === 'pick') {
    const all = [...MAKE_ORDER.map(k => [k, MAKES[k].label, 'make-chip']), ...(meetcueHere() ? [['meetcue', 'MeetCue', 'make-meetcue']] : [])];
    return `<div class="cmp-kinds is-pick" aria-label="What to make">${all.map(([k, label, act]) => `<button type="button" class="cmp-kind" data-act="${act}" data-kind="${k}"><span class="cmp-kind-pic">${makePic(k, MAKE_FRONT[k])}</span><span>${esc(label)}</span></button>`).join('')}${closeX('Close', 'make-close')}</div>`;
  }
  if (c.panel === 'meetcue') return mcBoxHTML(form);
  return '';
}
// Grey text that asks a question, with an example Tab puts in.
function makeHint(c) {
  const m = c.flags.make; if (!m) return '';
  const k = makeKind(m.kind, m.sub), ph = k.ph || MAKES[m.kind].ph, ex = k.ex || MAKES[m.kind].ex;
  return `${ph} e.g. ${ex}`;
}
function makeGivesHTML(form, c) {
  const m = c.flags.make;
  if (!m || c.files.length || c.text.trim()) return '';
  const acts = { attach:'cmp-attach', sketch:'cmp-draw', meeting:'cmp-meeting', photo:'cmp-attach', sheet:'cmp-attach', paste:'make-paste' };
  return MAKES[m.kind].gives.map(([give, icon, label]) => `<button type="button" class="cmp-give" data-act="${acts[give]}" data-give="${give}">${ic(icon, 15)}<span>${esc(label)}</span></button>`).join('');
}
// Called by syncComposer each time the box changes.
function renderMake(form, c) {
  if (!chipsHere(form)) return;
  const key = form.dataset.comp, ta = $('.cmp-input', form);
  const set = (el, html) => { if (el && el.dataset.sig !== html) { el.dataset.sig = html; el.innerHTML = html; } if (el) el.hidden = !html; };
  set($(`#chips-${key}`, form), chipsInBar(form) ? makeChipsHTML(form, c) : '');
  set($(`#make-${key}`, form), makePanelHTML(form, c));
  set($(`#gives-${key}`, form), makeGivesHTML(form, c));
  form.classList.toggle('is-making', Boolean(c.flags.make));
  form.dataset.ph ||= ta.placeholder;
  const ph = makeHint(c) || form.dataset.ph;
  if (ta.placeholder !== ph) { ta.placeholder = ph; ta.setAttribute('aria-label', ph); }
  fitBar(form);
  barWatch?.observe(form);
}
// The bar is always one row (PE-519: "two lines are not acceptable"). When it does not all fit, it gives up room one step
// at a time, least useful first, and stops at the first step that fits (make.css):
//   no-keys       the ↵ on Send and the branch's arrow go
//   short-branch  a long branch name gives up letters from its start, only as many as it must, keeping its end
//                 (main and other short names stay whole)
//   icon-chips    the kinds keep only their pictures; the chosen one keeps its word too
//   icon-send     Send to AI is the round arrow, still with its own arrow for Save as note
//   fold-chips    the kinds go inside +; the chosen one stays in the bar
//   icon-branch   the branch is its sign only, its name in the tooltip and the menu
// Only the box's width and what is in the bar change the answer, so a key press that changes neither measures nothing.
const FIT_STEPS = ['no-keys', 'short-branch', 'icon-chips', 'icon-send', 'icon-branch'];
// The Orchestrator's bar has no branch; its agent name and Start words give way instead (orchestrator.css, PE-649).
const ORCH_FIT_STEPS = ['short-agent', 'tight-agent', 'icon-agent', 'icon-send'];
const barWatch = typeof ResizeObserver === 'function' ? new ResizeObserver(seen => seen.forEach(e => fitBar(e.target))) : null;
function fitBar(form) {
  const bar = $('.cmp-bar', form); if (!bar || !bar.clientWidth) return;
  const sig = `${bar.clientWidth}|${[...bar.querySelectorAll('[data-sig]')].map(el => `${el.hidden ? '' : el.dataset.sig}`).join('|')}`;
  if (bar.dataset.fit === sig) return;
  const rectOf = el => typeof pageRect === 'function' ? pageRect(el) : el.getBoundingClientRect();
  const edge = rectOf(bar).right - (parseFloat(getComputedStyle(bar).paddingRight) || 0) + .5;
  const over = () => Math.max(0, ...[...bar.children].map(el => rectOf(el).right - edge));
  const fits = () => over() === 0;
  // From short-branch on, a long name's start is cut by just what is missing; its min-width keeps seven letters.
  const steps = form.dataset.on === 'orchestrator' ? ORCH_FIT_STEPS : FIT_STEPS;
  const head = $('.bb-head', bar), cut = steps.indexOf('short-branch');
  let n = 0;
  const use = k => {
    steps.forEach((step, i) => bar.classList.toggle(step, i < k));
    if (!head) return;
    head.style.maxWidth = '';
    const missing = k > cut ? over() : 0;
    if (missing) head.style.maxWidth = `${Math.max(0, head.scrollWidth - Math.ceil(missing))}px`;
  };
  for (use(0); n < steps.length && !fits(); ) use(++n);
  bar.dataset.fit = sig;
}
const barFolded = form => Boolean($('.cmp-bar', form)?.classList.contains('fold-chips'));
document.fonts?.ready.then(() => $$('.composer').forEach(form => { const bar = $('.cmp-bar', form); if (bar) delete bar.dataset.fit; fitBar(form); }));
const liveBox = key => $$('.composer').find(x => x.dataset.comp === key);
function redrawBox(key, { focus = true } = {}) {
  const form = liveBox(key); if (!form) return;
  syncComposer(form);
  if (focus) $('.cmp-input', form).focus();
}
function chooseMake(form, kind, sub) {
  const key = form.dataset.comp, c = makeBox(form);
  if (!MAKES[kind]) return;
  c.flags.make = { kind, sub:makeKind(kind, sub).id };
  c.panel = null;
  if (typeof closeMenu === 'function') closeMenu();
  redrawBox(key);
}
function clearMake(form) {
  const c = makeBox(form);
  delete c.flags.make; c.panel = null;
  redrawBox(form.dataset.comp);
}
ACT['make-chip'] = el => {
  const form = el.closest('.composer'), c = makeBox(form), kind = el.dataset.kind;
  if (c.flags.make?.kind === kind && !el.closest('.cmp-kinds')) clearMake(form); else chooseMake(form, kind);
};
ACT['make-kind'] = el => { const form = el.closest('.composer'), c = makeBox(form); if (c.flags.make) chooseMake(form, c.flags.make.kind, el.dataset.sub); };
ACT['make-close'] = el => clearMake(el.closest('.composer'));
// Tab puts the example in, when nothing is written yet.
function makeTab(form, e) {
  const c = makeBox(form), ta = $('.cmp-input', form);
  if (e.key !== 'Tab' || e.shiftKey || !c.flags.make || ta.value.trim()) return false;
  e.preventDefault();
  const m = c.flags.make, k = makeKind(m.kind, m.sub);
  ta.value = c.text = k.ex || MAKES[m.kind].ex;
  syncComposer(form);
  ta.setSelectionRange(ta.value.length, ta.value.length);
  return true;
}

// ---------- Pasting: a table from Excel is one file, and so is a long text when something is chosen ----------
const LONG_PASTE = 1500;
function tableOf(text) {
  const rows = String(text).replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
  if (rows.length < 2 || !rows.every(r => r.includes('\t'))) return null;
  const cells = rows.map(r => r.split('\t')), cols = Math.max(...cells.map(r => r.length));
  if (cols < 2) return null;
  const csv = cells.map(r => r.map(v => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',')).join('\n') + '\n';
  return { csv, rows:rows.length, cols };
}
let makePasteSeq = 0;
function pastedFile(key, text) {
  const c = comp(key), table = tableOf(text), words = String(text).trim().split(/\s+/).length;
  if (!table && (text.length < LONG_PASTE || !c.flags.make)) return false;
  const n = ++makePasteSeq;
  const file = table ? new File([table.csv], `table-${n}.csv`, { type:'text/csv' }) : new File([text], `pasted-${n}.md`, { type:'text/markdown' });
  addFiles(key, [file]);
  const added = c.files[c.files.length - 1];
  if (added?.name === file.name) added.label = table ? `Table · ${table.rows} rows × ${table.cols} columns` : `Pasted text · ${words} words`;
  syncComposer(liveBox(key));
  return true;
}
// Called from the box's paste: true when the paste became a file.
function makePaste(form, e) {
  if (!chipsHere(form) || !can('files') || e.clipboardData?.files?.length) return false;
  const text = e.clipboardData?.getData('text/plain') || '';
  if (!text || !(tableOf(text) || (text.length >= LONG_PASTE && makeBox(form).flags.make))) return false;
  e.preventDefault();
  return pastedFile(form.dataset.comp, text);
}
ACT['make-paste'] = async el => {
  const form = el.closest('.composer'), key = form.dataset.comp, ta = $('.cmp-input', form);
  let text = '';
  try { text = await navigator.clipboard.readText(); } catch { /* The browser asks first, or says no. */ }
  if (text && pastedFile(key, text)) return;
  if (text) { const c = comp(key); c.text = [c.text.trim(), text].filter(Boolean).join('\n\n'); ta.value = c.text; syncComposer(form); }
  else toast(`Copy it, then press ${MAC_KEYS ? '⌘V' : 'Ctrl+V'} here.`);
  ta.focus();
};
// The file picker takes only what was asked for, this once.
const GIVE_ACCEPT = { sheet:'.xlsx,.xls,.csv,.tsv', photo:'image/*' };
document.addEventListener('click', e => {
  const attach = e.target.closest?.('[data-act="cmp-attach"]'), pick = $('#filePick');
  if (attach && pick) pick.accept = GIVE_ACCEPT[attach.dataset.give] || '';
}, true);
addEventListener('focus', () => { const pick = $('#filePick'); if (pick?.accept) setTimeout(() => { pick.accept = ''; }, 300); });

// ---------- Make with AI, at the end of a line: the box opens on the five ----------
ACT['line-make'] = () => {
  const form = $('.lp-dock .composer'); if (!form) return;
  const c = makeBox(form);
  if (!c.flags.make) c.panel = c.panel === 'pick' ? null : 'pick';
  syncComposer(form);
  form.scrollIntoView({ block:'nearest', behavior:reducedMotion() ? 'auto' : 'smooth' });
  $('.cmp-input', form).focus();
};
// The tag on an Ask picks the same choice again.
ACT['make-again'] = el => {
  const form = $('.lp-dock .composer') || activeComposer(); if (!form || !MAKES[el.dataset.kind]) return;
  chooseMake(form, el.dataset.kind, el.dataset.sub);
};
const makeTagHTML = s => (s.make && MAKES[s.make.kind] ? `<button type="button" class="lp-make-tag" data-act="make-again" data-kind="${esc(s.make.kind)}" data-sub="${esc(s.make.sub || '')}" title="Choose ${esc(makeWords(s.make))} again">${ic(MAKES[s.make.kind].icon, 14)}<span>${esc(makeWords(s.make))}</span></button>` : '');

// ---------- MeetCue in the box ----------
// Not linked: say so, and link. Linked: the meetings, and one click adds it to this line as a meeting node (from the home, as a line of its own).
const MC_BOX = 12;
let mcBoxWatch = 0;
ACT['make-meetcue'] = el => {
  const form = el.closest('.composer'), c = makeBox(form);
  if (form.dataset.on === 'orchestrator') return mcPickMeeting(form.dataset.comp);
  if (c.panel === 'meetcue' && !el.closest('.cmp-kinds')) { c.panel = null; redrawBox(form.dataset.comp); return; }
  delete c.flags.make; c.panel = 'meetcue';
  redrawBox(form.dataset.comp, { focus:false });
  if (mcState() !== 'on' || !MC.meetings) loadMeetcue().then(() => redrawMeetcueBoxes());
};
function redrawMeetcueBoxes() {
  for (const form of $$('.composer')) { const c = S.comp[form.dataset.comp]; if (c?.panel === 'meetcue') syncComposer(form); }
}
function mcBoxHTML(form) {
  const state = mcState(), head = `<div class="cmp-mc-head">${mcGlyph(20)}<strong>MeetCue</strong>${closeX('Close MeetCue')}</div>`;
  if (MC.loading && !MC.meetings) return `<div class="cmp-mc">${head}<p class="cmp-mc-say" role="status">Getting your meetings…</p></div>`;
  if (state === 'problem') return `<div class="cmp-mc">${head}<p class="cmp-mc-say" role="status">MeetCue is not answering.<button type="button" class="btn sm" data-act="make-mc-retry">Try again</button></p></div>`;
  const p = project(), l = form.dataset.on === 'step' ? lineById(p, S.route.line) : null;
  const onLine = new Set((l?.stations || []).filter(s => s.kind === 'meeting' && s.meetingId).map(s => s.meetingId));
  const rowHTML = m => {
    const ready = m.minutes_ready !== false, here = onLine.has(m.id), isEx = Boolean(m.example || (typeof mcIsExample === 'function' && mcIsExample(m.id)));
    return `<button type="button" class="cmp-mc-row ${here ? 'on' : ''}" data-act="make-mc-add" data-m="${esc(m.id)}" ${ready ? '' : 'disabled'}><span class="cmp-mc-ic">${typeof mcGlyph === 'function' ? mcGlyph(16) : ic('meetcue', 15)}</span><span class="cmp-mc-text"><strong>${esc(m.title || 'Meeting')}${isEx ? '<span class="mc-ex-tag">Example</span>' : ''}</strong><small>${esc(ready ? [mcWhen(m.started_at), mcLong(m.duration_ms)].filter(Boolean).join(' · ') : 'No minutes yet')}</small></span>${here ? `<span class="cmp-mc-here">${ic('check', 14)}On this line</span>` : ''}</button>`;
  };
  const examples = typeof MC_EXAMPLES !== 'undefined' && Array.isArray(MC_EXAMPLES) ? MC_EXAMPLES : [];
  if (state === 'out' || state === 'off') {
    const button = state === 'out' ? '<button type="button" class="btn sm primary" data-act="meetcue-sign-in">Sign in to PenEcho Cloud</button>'
      : MC.status?.available === false ? '' : '<button type="button" class="btn sm primary" data-act="make-mc-link">Link MeetCue</button>';
    const exBlock = examples.length ? `<div class="cmp-mc-ex-head">Try with example meetings</div><div class="cmp-mc-list">${examples.map(rowHTML).join('')}</div>` : '';
    return `<div class="cmp-mc">${head}<p class="cmp-mc-say">${state === 'out' ? 'Sign in to connect your MeetCue meetings, or try an example below.' : 'Link MeetCue for your own meetings, or try an example below.'}${button}</p>${exBlock}</div>`;
  }
  if (state === 'wait' || !MC.meetings) return `<div class="cmp-mc">${head}<p class="cmp-mc-say" role="status">Getting your meetings…</p></div>`;
  const list = MC.meetings.slice(0, MC_BOX);
  const rows = list.length ? list.map(rowHTML).join('')
    : (examples.length ? `<div class="cmp-mc-ex-head">No meetings yet · Try an example</div>${examples.map(rowHTML).join('')}` : '<p class="cmp-mc-say">No meetings yet.</p>');
  return `<div class="cmp-mc">${head}<div class="cmp-mc-list">${rows}</div>${MC.meetings.length > MC_BOX ? '<button type="button" class="link cmp-mc-all" data-act="open-meetcue">All meetings</button>' : ''}</div>`;
}
ACT['make-mc-retry'] = () => { MC.problem = false; loadMeetcue().then(redrawMeetcueBoxes); redrawMeetcueBoxes(); };
// Linking happens on penecho.ai. The box keeps looking while it is open, and shows the meetings once it is done.
ACT['make-mc-link'] = async () => {
  const origin = S.cloudAccount?.origin || (await loadCloudAccount())?.origin;
  if (!origin) { toast('PenEcho Cloud is not answering.'); return; }
  window.open(`${origin}/dashboard.html#meetcue`, '_blank', 'noopener');
  const started = Date.now();
  clearInterval(mcBoxWatch);
  mcBoxWatch = setInterval(async () => {
    const open = Object.values(S.comp).some(c => c.panel === 'meetcue');
    if (Date.now() - started > 5 * 60 * 1000 || !open) { clearInterval(mcBoxWatch); return; }
    if (document.hidden) return;
    try { if ((await api('/meetcue')).linked) { clearInterval(mcBoxWatch); toast('MeetCue is linked'); await loadMeetcue(); redrawMeetcueBoxes(); } } catch { /* The next look may answer. */ }
  }, 4000);
};
ACT['make-mc-add'] = async el => {
  const form = el.closest('.composer'), c = makeBox(form), m = typeof mcFindMeeting === 'function' ? mcFindMeeting(el.dataset.m) : (MC.meetings || []).find(x => x.id === el.dataset.m), p = project();
  if (!m || !p) return;
  c.panel = null; redrawBox(form.dataset.comp, { focus:false });
  const l = form.dataset.on === 'step' ? lineById(p, S.route.line) : null;
  if (l) { await mcAddNodeToLine(p, l, m); return; }
  // From the home: the meeting is a line of its own in this project.
  try {
    const made = await api(`${pathFor(p.id)}/meetings`, { method:'POST', body:{ meetingId:m.id } });
    mcRememberLink(m.id, { projectId:p.id, projectName:p.name, color:p.color || '', slug:made.slug, title:m.title || made.slug, status:'waiting', ownLine:true, step:'', updatedAt:Date.now() });
    await mcOpenLine(p.id, made.slug);
    toast(made.existed ? 'Already in this project' : 'Meeting added');
    refreshMcLinks();
  } catch (error) { toast(mcSay(error)); }
};
