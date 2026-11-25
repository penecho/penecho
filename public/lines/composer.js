// One composer everywhere, at the bottom of the page. It grows to ten lines and takes images and files.
const comp = key => (S.comp[key] ||= { text: '', files: [], refers: [], flags: {}, cmd: null });
// File names and Topic names become element ids here, so only safe characters go in.
const boxKey = name => String(name).replace(/[^A-Za-z0-9_-]/g, ch => `_${ch.codePointAt(0).toString(36)}`);
function composerHTML(name, { placeholder = 'Ask for anything', preview = false, on = 'home', marks = 0, topic = '' } = {}) {
  const key = boxKey(name), c = comp(key);
  const sharedNote = typeof HOSTED !== 'undefined' && HOSTED?.shared;
  if (sharedNote) placeholder = topic ? 'Add a note to this line' : 'Start a line with a note';
  c.project = S.cur;
  // What this box goes back to after each message.
  c.defaults = topic ? { topic } : {};
  // A line's own box adds to that line. The home's box starts a new one.
  if (topic) c.flags.topic = topic; else delete c.flags.topic;
  return `<form class="composer" data-comp="${key}" data-on="${on}" data-preview="${preview ? 1 : 0}" ${sharedNote ? 'data-shared-note="1" data-note-first="1"' : ''} autocomplete="off">
    ${preview ? `<div class="cmp-make" id="make-${key}" hidden></div>` : ''}
    <div class="cmp-files" id="files-${key}" hidden></div>
    <textarea class="cmp-input" id="cmp-${key}" rows="1" aria-label="${esc(placeholder)}" placeholder="${esc(placeholder)}">${esc(c.text)}</textarea>
    ${preview ? `<div class="cmp-gives" id="gives-${key}" hidden></div>` : ''}
    <div class="cmp-bar">
      ${sharedNote ? hostedGuestBar() : `
      <button type="button" class="icon-btn cmp-plus" data-act="cmp-plus" aria-haspopup="menu" aria-label="Add" title="Add">${ic('plus', 19)}</button>
      ${preview ? `<div class="cmp-chips" id="chips-${key}" role="group" aria-label="What to make"></div>` : ''}
      <div class="cmp-path" id="path-${key}"></div>
      ${preview ? `<div class="cmp-end"><div class="cmp-branch" id="branch-${key}"></div><div class="cmp-send" id="send-${key}"></div></div>` : `<button type="submit" class="send-btn" aria-label="Send" title="Send (Enter)">${ic('send', 18)}</button>`}
      `}
    </div>
    <div class="slash-menu" id="slash-${key}" hidden role="listbox" aria-label="Quick starts"></div>
  </form>`;
}
function syncComposer(form) {
  if (!form) return;
  const key = form.dataset.comp, c = comp(key), ta = $('.cmp-input', form);
  ta.readOnly = Boolean(c.sending);
  ta.style.height = 'auto';
  const cs = getComputedStyle(ta), lh = parseFloat(cs.lineHeight) || 22, pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom), max = lh * 10 + pad;
  // A placeholder never makes the box taller. Ten lines of text is the most it grows.
  ta.style.height = (ta.value ? Math.min(ta.scrollHeight + 1, max) : lh + pad) + 'px';
  ta.style.overflowY = ta.value && ta.scrollHeight > max ? 'auto' : 'hidden';
  if (form.dataset.on === 'orchestrator') { orchPaintFiles(); renderMake(form, c); return; }
  const files = $(`#files-${key}`, form);
  const extra = form.dataset.on === 'markup' ? unsentMarks() : 0;
  const refers = c.refers || [];
  files.hidden = !c.files.length && !extra && !refers.length;
  const html = refers.map(referChip).join('') + (extra ? `<div class="cmp-marks">${ic('pen', 15)}${extra} new ${extra === 1 ? 'mark' : 'marks'}</div>` : '') + c.files.map(f => boxFile(form, f)).join('');
  if (files.dataset) { if (files.dataset.h !== html) files.innerHTML = files.dataset.h = html; } else files.innerHTML = html;
  syncAttachmentImages(files);
  if (form.dataset.sharedNote === '1') return;
  if (form.dataset.preview === '1') renderPathPreview(form, c);
  if (typeof renderMake === 'function') renderMake(form, c);   // What to make (make.js)
}
// Something earlier on the line, quoted: in the box until it is sent, then above the Ask's words.
const quoteInner = (label, words) => `${ic('refer', 14)}<strong>${esc(label)}</strong>${words ? `<span>${esc(words)}</span>` : ''}`;
const referChip = r => `<div class="cmp-refer"><button type="button" class="lp-quote" data-act="line-stop" data-line="${esc(r.line)}" data-step="${esc(r.step)}" title="Go to ${esc(r.label)}">${quoteInner(r.label, r.words)}</button><button type="button" class="icon-btn tiny" data-act="cmp-unrefer" data-step="${esc(r.step)}" aria-label="Stop referring to ${esc(r.label)}" title="Remove">${ic('x', 14)}</button></div>`;
// An Ask not sent yet going back to a box: its words after anything already typed there, its attachments, and what it refers to.
const IMAGE_TYPE = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp', gif:'image/gif', bmp:'image/bmp', svg:'image/svg+xml' };
function askIntoBox(p, key, l, s, { text, files }) {
  const c = comp(key);
  c.text = [c.text.trim(), text === 'See the picture.' ? '' : text].filter(Boolean).join('\n\n');
  for (const f of files) {
    if (c.files.some(x => x.path === f.path)) continue;
    const type = f.image ? IMAGE_TYPE[f.path.split('.').pop().toLowerCase()] || 'image/png' : '', source = f.image ? canvasByPath(p, f.path)?.source : '';
    c.files.push({ id:uid('a'), name:f.name, type, size:fileEntry(p, f.path)?.size || 0, path:f.path, url:assetUrl(p, f.path), ...(source ? { source } : {}) });
  }
  c.refers ||= [];
  for (const r of s.refers || []) if (r.step && !c.refers.some(x => x.step === r.step)) c.refers.push({ line:l.id, step:r.step, label:r.label, words:r.words });
  if (s?.make && !c.flags.make) c.flags.make = s.make;
}
function focusBox(form) {
  const input = form && $('.cmp-input', form); if (!input) return;
  input.value = comp(form.dataset.comp).text;
  syncComposer(form);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  input.scrollTop = input.scrollHeight;
}
// A picture in the box opens its preview on click; "Click to draw on it" opens the Canvas. The Canvas cannot open every kind of image, such as an SVG.
const DRAWABLE = /^image\/(png|jpe?g|webp|gif|bmp)$/i;
function syncAttachmentImages(root) {
  if (!root?.querySelectorAll) return;
  for (const img of root.querySelectorAll('.cmp-file-pic img, .orch-file-pic img')) {
    if (img.complete && img.naturalWidth > 0) img.classList.add('is-loaded');
  }
}
function isPendingDrawingFile(compKey, f) {
  const d = pendingDrawing();
  return Boolean(d && d.comp === compKey && ((d.file && f.id === d.file) || (d.source && f.source === d.source)));
}
const drawableBoxFile = (form, f) => form.dataset.sharedNote !== '1' && form.dataset.preview === '1' && (f.source || DRAWABLE.test(f.type || ''));
function boxFile(form, f) {
  const isImage = Boolean(f.type?.startsWith('image/')), awaiting = isImage && isPendingDrawingFile(form.dataset.comp, f);
  const picture = Boolean(f.url && isImage && !awaiting), drawable = drawableBoxFile(form, f);
  const thumb = picture ? `<button type="button" class="cmp-file-pic" data-act="cmp-preview" data-file="${f.id}" aria-label="Preview ${esc(f.name)}" title="Preview ${esc(f.name)}"><img src="${esc(f.url)}" alt=""></button>`
    : isImage ? `<span class="cmp-file-pic is-blank" aria-hidden="true"></span>`
    : `<span class="cmp-file-ic">${ic(FILE_ICON(f.name), 18)}</span>`;
  const sub = drawable ? `<button type="button" class="cmp-file-edit" data-act="cmp-edit-draw" data-file="${f.id}" title="Draw on it">${ic('pen', 12)}<span>Click to draw on it</span></button>` : `<span>${f.label ? esc(f.name) : fmtSize(f.size || 0)}</span>`;
  const remove = `<button type="button" class="icon-btn tiny" data-act="cmp-remove" data-file="${f.id}" aria-label="Remove ${esc(f.name)}">${ic('x', 14)}</button>`;
  return `<div class="cmp-file${drawable ? ` can-draw${f.source ? ' is-drawing' : ''}` : ''}">${thumb}<div class="cmp-file-text" title="${esc(f.name)}"><strong>${esc(f.label || f.name)}</strong>${sub}</div>${remove}</div>`;
}
// Only what would surprise you is said here. Everything else simply starts.
function renderPathPreview(form, c) {
  // Home also refreshes this preview when branches change. A shared note has a fixed destination.
  if (form.dataset.sharedNote === '1') return;
  const key = form.dataset.comp, host = $(`#path-${key}`, form), here = form.dataset.on === 'step', p = project(); if (!p) return;
  const plan = detectPath(c.text.trim(), c, p);
  const say = plan.kind === 'canvas' ? 'Opens the Canvas' : plan.kind === 'note' ? (plan.stay ? 'Adds a note' : 'Adds a Topic to the docs folder') : '';
  const hint = say ? `<span class="pv-note" title="${say}">${ic(plan.kind === 'canvas' ? 'canvas' : 'note', 15)}<span>${say}</span></span>` : '';
  // The placeholder already says where it goes: on this line, or a new line. The home's box says only which branch a new line goes on.
  const fresh = plan.kind === 'line' && !here, target = fresh ? boxTarget(c, p) : null;
  const next = hint;
  if (host.dataset.sig !== next) { host.dataset.sig = next; host.innerHTML = next; }
  const chip = $(`#branch-${key}`, form), picker = target ? branchPicker(p, target) : '';
  if (chip && chip.dataset.sig !== picker) { chip.dataset.sig = picker; chip.innerHTML = picker; }
  const label = plan.kind === 'line' ? (here ? 'Send to an agent, on this line' : 'Send to an agent, on a new line') : 'Send', send = $(`#send-${key}`, form);
  // One button. It says Send to AI and Enter does that, on every page. Its arrow offers Save as note, for this one message.
  const noting = plan.kind === 'line' && form.dataset.on !== 'markup', asNote = noting && (c.flags.prefer === 'note' || Boolean(S.noteOnly));
  const says = asNote ? 'Save as note' : 'Send to AI', why = asNote ? 'Save as note: your words on the line, read by no agent' : label;
  const btnCls = asNote ? 'is-note' : '';
  form.dataset.noteFirst = asNote ? '1' : '';
  delete form.dataset.steerMode;
  const button = c.sending ? `<button type="submit" class="send-btn has-word" disabled aria-busy="true"><span>Sending…</span></button>`
    : noting ? `<span class="send-split"><button type="submit" class="send-btn has-word ${btnCls}" aria-label="${esc(why)}" title="${esc(why)} (Enter)"><span>${says}</span><kbd class="cmp-key"><b>↵</b></kbd>${ic(asNote ? 'note' : 'send', 17)}</button><button type="button" class="send-pick ${btnCls}" data-act="cmp-send-pick" aria-haspopup="menu" aria-label="Send to AI, or save as a note" title="Send to AI, or save as a note">${ic('down', 14)}</button></span>`
    : `<button type="submit" class="send-btn" aria-label="${label}" title="${label} (Enter)">${ic('send', 18)}</button>`;
  if (send && send.dataset.sig !== button) { send.dataset.sig = button; send.innerHTML = button; }
}
// The other way out of the box has a key too: Command+Enter on a Mac, Ctrl+Enter elsewhere.
const MAC_KEYS = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
const MOD_ENTER = MAC_KEYS ? '⌘↵' : 'Ctrl ↵';
ACT['cmp-send-pick'] = el => {
  const form = el.closest('.composer'), c = comp(form.dataset.comp), asNote = c.flags.prefer === 'note';
  const choose = note => { c.preferVersion = (c.preferVersion || 0) + 1; if (note) c.flags.prefer = 'note'; else delete c.flags.prefer; const live = $$('.composer').find(x => x.dataset.comp === form.dataset.comp) || form; syncComposer(live); $('.cmp-input', live).focus(); };
  openMenu(el, [
    { label:'Send to AI', icon:'send', on:!asNote, key:asNote ? MOD_ENTER : '↵', fn:() => choose(false) },
    { label:'Save as note', icon:'note', on:asNote, key:asNote ? '↵' : MOD_ENTER, fn:() => choose(true) },
  ], { align:'right' });
};
// The things that go into a message, and what to make, behind one +. Typing / still opens the quick starts.
ACT['cmp-plus'] = el => {
  const form = el.closest('.composer'), whole = form.dataset.preview === '1', later = act => () => setTimeout(() => ACT[act](el), 0);
  const extra = whole && typeof makePlusItems === 'function' ? makePlusItems(form) : [];
  openMenu(el, [
    { label:'Add images or files', icon:'clip', fn:() => ACT['cmp-attach'](el) },
    ...(whole && can('canvas') ? [{ label:'Add new canvas', icon:'canvas', fn:later('cmp-draw') }] : []),
    ...extra,
  ]);
};
// Saved on the line as a note, or as the first thing on a new line. Nothing is copied and no agent is told.
// It is on the line at once; the folder is written behind it.
function saveNote(form) {
  const key = form.dataset.comp, c = comp(key), p = project(), text = c.text.trim();
  if (c.sending) return;
  if (!text && !c.files.length) { $('.cmp-input', form).focus(); return; }
  const here = form.dataset.on === 'step' ? lineById(p, S.route.line) : null, place = here ? {} : { ...targetBody(p, boxTarget(c, p)), ...embedCanvas() };
  const took = takeBox(key), e = showAtOnce(p, { kind:'note', text, took, here, offMain:Boolean(place.offMain) });
  saveBehind(e, key, took, async line => {
    if (form.dataset.sharedNote === '1') {
      const response = await hostedSendNote({ topic:here ? line : 'new', text }, took.files);
      const saved = await response.json();
      if (!response.ok) throw new Error(saved.error);
      return saved;
    }
    const attachments = took.files.length ? await uploadFiles(p, took.files) : [];
    if (!here) await embedCanvasReady();
    return api(`${pathFor(p.id)}/yours`, { method:'POST', body:{ kind:'note', text, attachments, refers:took.refers.map(r => savedId(r.step)), topic:here ? line : 'new', ...place } });
  });
}
// ---------- On the line at once, written behind it ----------
// What you add is on its line the moment you press Enter, and the box is free for the next thing. The folder is written behind it,
// one save after another in the order you pressed, and a new line takes the name the server gives it. A save that fails puts your
// words back in the box. Until the server's own state has it, each new thing is kept here and put back into every state that arrives.
const SAVING = [], SAVED = new Map(), SAVING_RUN = Date.now().toString(36);
let savingSeq = 0, savingQueue = Promise.resolve();
const isSaving = id => String(id || '').startsWith('saving-');
const savingId = () => `saving-${SAVING_RUN}-${++savingSeq}`;
const savedId = id => SAVED.get(id) || id;
const savingNow = () => SAVING.some(e => !e.saved);
const pad2 = n => String(n).padStart(2, '0');
const nowWhen = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
// As the server names a line from its first words. The name it gives takes over when it answers.
function guessTitle(text, files = []) {
  const first = String(text).split('\n').map(x => x.trim().replace(/!?\[[^\]]*\]\([^)]*\)/g, ' ').replace(/^#+\s+/, '').replace(/^>\s*/, '').replace(/^([-*+]|\d+[.)])\s+/, '').replace(/^\/\w+\s*/, '').replace(/^(please|can you|could you)\s+/i, '').replace(/\*\*|__|`/g, '').trim()).find(x => /\p{L}/u.test(x)) || '';
  const sentence = first.split(/(?<=[.!?])\s+|(?<=[。！？])/)[0].replace(/[.!?。！？]+$/, '') || first;
  const max = 120, cut = sentence.length > max ? sentence.slice(0, max - 2) : '', byWord = cut ? cut.replace(/\s+\S*$/, '') : '';
  const said = cut ? `${byWord.length >= Math.floor(max / 2) ? byWord : cut.trimEnd()}…` : sentence;
  return said ? said[0].toUpperCase() + said.slice(1) : files[0]?.name || 'New line';
}
// What the box held, and the box empty again for the next thing.
function takeBox(key) {
  const c = comp(key), took = { text:c.text, files:[...c.files], refers:[...(c.refers || [])], make:c.flags.make || null, prefer:c.flags.prefer, preferVersion:c.preferVersion };
  c.text = ''; c.files = []; c.refers = []; c.flags = { ...c.defaults }; c.cmd = null; c.panel = null; delete c.auto;
  const live = $$('.composer').find(x => x.dataset.comp === key);
  if (live) { $('.cmp-input', live).value = ''; syncComposer(live); }
  return took;
}
// A save that failed: what you wrote goes back in front of anything typed since, after anything put back before it.
function backInBox(key, took) {
  const c = comp(key), back = c.back && c.text.startsWith(c.back) ? c.back : '', since = c.text.slice(back.length).trim();
  c.back = [back.trim(), took.text.trim()].filter(Boolean).join('\n\n');
  c.text = [c.back, since].filter(Boolean).join('\n\n'); c.files = [...c.files.filter(f => !took.files.includes(f)), ...took.files]; c.refers = [...took.refers, ...(c.refers || [])];
  if (took.prefer && !c.flags.prefer && took.preferVersion === c.preferVersion) c.flags.prefer = took.prefer;
  if (took.make && !c.flags.make) c.flags.make = took.make;
  const live = $$('.composer').find(x => x.dataset.comp === key);
  if (live) { $('.cmp-input', live).value = c.text; syncComposer(live); }
}
function savingStation(kind, text, took, sent) {
  const when = nowWhen(), names = took.files.map(f => f.name).join(', ');
  return { id:savingId(), index:0, kind, label:KIND[kind]?.label || 'Note', canvas:'', held:null, state:kind === 'note' || sent ? 'done' : 'todo', off:'', asked:false, unsent:kind === 'ask' && !sent, canFinishUnsent:false, finishedAsk:false, reviewed:false,
    agent:'you', took:'', when, via:kind === 'ask' && !sent ? 'Not sent' : '', text:text || (kind === 'ask' ? 'See the picture.' : names), out:'', wait:false, refers:took.refers.map(r => ({ label:r.label, words:r.words, step:r.step })), make:kind === 'ask' ? took.make || null : null,
    // Presentation only: keep the final attachment space while uploads and the state refresh run behind the page.
    pendingFiles:took.files.map(f => ({ name:f.name, image:/^image\//.test(f.type || '') || /\.(png|jpe?g|gif|webp|svg)$/i.test(f.name), url:f.url || '' })),
    files:[], pictures:[], detail:'', diff:null, now:'', why:'' };
}
function savingLine(p, station, took, status, offMain = false) {
  const id = savingId(), at = Date.now(), ask = station.kind === 'ask';
  return { readRevision:'', createdAt:at, updatedAt:at, lastActivityAt:at, pinned:false, id, slug:id, code:'', title:guessTitle(station.text, took.files), parent:'', parts:[], partList:[], mergedInto:'', mergedFrom:[], titleBy:'',
    topicHash:'', area:'Work', priority:2, labels:['Work'], agent:'', branch:'', noBranch:true, offMain, base:'', newBranchFrom:'', commit:'', combined:'', mergeInto:'', mergeOf:'', landed:false, closed:false, archived:false,
    queued:status === 'not-started', status, statusAt:at, asking:null, diff:null, running:false, runAgent:'', runStarted:0, workdir:'', folder:p.docsPath || '', activitySeq:0, started:station.when, source:'', elsewhere:false,
    conversation:null, conversations:{}, ask:{ text:ask ? station.text : '', when:station.when, who:'you', via:station.via, files:[], later:[] }, stations:[], questions:[], decided:[], handoffs:[], result:{ text:'', files:[] }, pictures:[], topicPath:'', landedAt:'', arrow:'', removed:[] };
}
// A station goes before the line's Finished stop, as the server writes it.
function putStation(l, s) {
  const at = l.stations.findIndex(x => x.finished);
  l.stations.splice(at < 0 ? l.stations.length : at, 0, s);
  l.stations.forEach((x, i) => { x.index = i; });
  l.updatedAt = l.lastActivityAt = Math.max(l.updatedAt || 0, Date.now());
}
// On the page now: on the line you are on, or as the first thing on a new line, which opens.
// A new line chosen Off main stands there from the first moment.
function showAtOnce(p, { kind, text, took, here = null, sent = false, status = '', offMain = false, open = true }) {
  const station = savingStation(kind, text, took, sent), e = { project:p.id, station, line:null, lineId:here?.id || '', at:Date.now() };
  // Mark finished & reviewed shows with the rest of the card, as the server will say (not on an archived line); a click before the save lands waits for it (whenSaved).
  station.canFinishUnsent = station.unsent && !['closed', 'landed'].includes(here?.status);
  if (here) {
    putStation(here, station);
    SAVING.push(e);
    if (S.cur === p.id && S.route.view === 'line' && S.route.line === here.id) { refreshAfterChange(); scrollToItem(station.id); }
    return e;
  }
  const l = savingLine(p, station, took, status || (kind === 'ask' ? 'waiting' : 'notes'), offMain);
  putStation(l, station);
  withFinishedStop(l); settleEnd(l);
  e.line = l; e.lineId = l.id;
  p.lines = [l, ...p.lines];
  SAVING.push(e);
  if (open) go({ view:'line', line:l.id });
  return e;
}
// Every state that arrives, until it holds what was saved: lines and nodes still on their way are put back, so a poll never takes them off the page.
function keepSaving(p) {
  let landed = false;
  for (const e of [...SAVING]) {
    if (e.project !== p.id) continue;
    const l = allLines(p).find(x => x.id === e.lineId);
    // The server's own state holds it now, or it has been answered for long enough that the file must have been changed since.
    if (e.saved && l && (e.saved.step ? stationById(l, e.saved.step) : true) || (e.saved && Date.now() - e.saved.at > 20000)) {
      if (typeof HOSTED !== 'undefined' && HOSTED?.shared) {
        for (const file of e.station.pendingFiles || []) if (file.url?.startsWith('blob:')) URL.revokeObjectURL(file.url);
      }
      SAVING.splice(SAVING.indexOf(e), 1); landed = true; continue;
    }
    if (!l) { if (e.line) { e.line.stations = []; putStation(e.line, e.station); withFinishedStop(e.line); settleEnd(e.line); p.lines = [e.line, ...p.lines]; } continue; }
    if (!l.stations.includes(e.station) && !stationById(l, e.station.id)) putStation(l, e.station);
  }
  return landed;
}
function moveKey(map, from, to) { if (map && from in map) { map[to] = map[from]; delete map[from]; } }
// The server has it: the line and the node take the names it gave, on the page, in the address, and wherever this browser keeps them.
function settleSaving(e, saved, key) {
  const p = project(e.project), slug = saved.slug, step = saved.step || '', oldLine = e.lineId, oldStep = e.station.id;
  e.saved = { slug, step, at:Date.now() };
  SAVED.set(oldLine, slug); if (step) SAVED.set(oldStep, step);
  for (const x of SAVING) if (x.lineId === oldLine) x.lineId = slug;
  if (step) e.station.id = step;
  // The server may have put it on a line that is already here, such as the line of the Canvas it was said beside, or a poll may have brought the new line first.
  const there = p && oldLine !== slug ? lineById(p, slug) : null, shown = p && lineById(p, oldLine);
  if (p && shown && e.line === shown) {
    if (there) {
      for (const list of ['lines', 'landed', 'backlog']) p[list] = p[list].filter(l => l !== shown);
      for (const s of shown.stations) if (!s.finished && !stationById(there, s.id)) putStation(there, s);
    }
    Object.assign(shown, { id:slug, slug, topicPath:`lines/${slug}.md` });
    if (saved.added) toast(`Added to ${(there || shown).title}`);
  }
  const el = step && document.getElementById(`item-${oldStep}`);
  if (el) { el.id = `item-${step}`; el.dataset.step = step; }
  const was = `${oldLine}/${oldStep}`, now = `${slug}/${step || oldStep}`;
  delete S.handed?.[now];
  moveKey(S.handed, was, now); moveKey(S.askFor, was, now);
  if (oldLine !== slug) {
    if (typeof renameLineVisit === 'function') renameLineVisit(e.project, oldLine, slug);
    const from = boxKey(`conv-${e.project}-${oldLine}`), to = boxKey(`conv-${e.project}-${slug}`);
    if (S.comp[from] && !S.comp[to]) S.comp[to] = S.comp[from];
    // A box that goes to this line goes to it by its new name.
    for (const c of Object.values(S.comp)) for (const f of [c.flags, c.defaults]) if (f?.topic === oldLine) f.topic = slug;
  }
  if (S.cur === e.project && S.route.view === 'line') {
    // A hash change may be waiting for its handler. Saving must not replace that navigation intent.
    const onRoute = typeof location === 'undefined' || (typeof routeToHash === 'function' && location.hash === '#' + routeToHash(S.route));
    let renamed = false;
    if (S.route.line === oldLine && oldLine !== slug) { S.route.line = slug; renamed = true; }
    if (S.route.step === oldStep && step && oldStep !== step) { S.route.step = step; renamed = true; }
    if (renamed && onRoute) { syncHash(true); embedShown(p, S.route); }
  }
  if (S.cur === e.project) refreshAfterChange();
  refreshBehind(e.project);
}
// A save that failed takes its node off the page, and a line it started goes with it. What you wrote is back in the box.
function dropSaving(e, error, key, took) {
  SAVING.splice(SAVING.indexOf(e), 1);
  const p = project(e.project), l = p && lineById(p, e.lineId);
  if (l) l.stations = l.stations.filter(s => s !== e.station);
  const gone = Boolean(e.line && l === e.line);
  if (gone) for (const list of ['lines', 'landed', 'backlog']) p[list] = p[list].filter(x => x !== l);
  const onIt = S.cur === e.project && S.route.view === 'line' && S.route.line === e.lineId;
  backInBox(gone || !l ? `home-${e.project}` : key, took);
  if (onIt && gone) go({ view:'home' }, { replace:true });
  else if (S.cur === e.project) refreshAfterChange();
  toast(error.message);
}
// One save after another. A node on a line still being saved waits for that line's name.
function saveBehind(e, key, took, send) {
  const job = savingQueue.then(() => {
    const line = savedId(e.lineId);
    if (!e.line && isSaving(line)) throw new Error('Its line could not be saved, so this was not saved either.');
    return send(line);
  });
  savingQueue = job.catch(() => {});
  return e.done = job.then(saved => { settleSaving(e, saved, key); return saved; }, error => { dropSaving(e, error, key, took); return null; });
}
// Once the last save in a project is answered, its state and the project list are read again, behind the page.
const behind = {};
function refreshBehind(id) {
  if (SAVING.some(e => e.project === id && !e.saved)) return;
  if (behind[id]) { behind[id].again = true; return; }
  const run = behind[id] = { again:false };
  (async () => {
    try { do { run.again = false; await loadState(id, { force:true }); } while (run.again); } catch { /* The poll catches up. */ }
    delete behind[id];
    if (S.cur === id) { refreshAfterChange(); readOpenedLine(); }
    refreshSentProjects();
  })();
}
// A menu choice waits only for its own Ask, including settlement of the server's IDs.
// An unrelated later save must not hold up a choice whose Ask is already persisted.
function whenAskSaved(projectId, line, step, run) {
  const ready = () => { if (!isSaving(savedId(line)) && !isSaving(savedId(step))) run(); };
  const entry = SAVING.find(e => e.project === projectId && savedId(e.lineId) === savedId(line) && savedId(e.station.id) === savedId(step));
  if (entry && !entry.saved) {
    entry.done?.then(saved => { if (saved) ready(); }).catch(error => toast(error.message));
    return;
  }
  ready();
}
// A click on something not saved yet happens once it is, with the names the server gave. Going somewhere on the page never waits.
const GOES_ONLY = new Set(['open-line', 'open-step', 'row-open', 'peek-line', 'line-back', 'doc-back', 'next-open', 'find-open']);
function whenSaved(el, run) {
  if (GOES_ONLY.has(el.dataset.act) || ['unsent-run-auto', 'unsent-run-pick', 'unsent-paste-pick'].includes(el.dataset.act)) return false;
  const page = el.closest?.('#linePage'), waits = isSaving(el.dataset.line) || isSaving(el.dataset.step) || (page && !el.closest('.composer') && isSaving(S.route.line));
  if (!waits) return false;
  savingQueue.then(() => {
    for (const k of ['line', 'step']) if (el.dataset[k]) el.dataset[k] = savedId(el.dataset[k]);
    if (isSaving(el.dataset.line) || isSaving(el.dataset.step) || (page && isSaving(S.route.line))) return;
    run();
  });
  return true;
}
// A drawing that starts a line of its own: the Canvas opens, and what you draw comes back as that line's first node.
ACT['draw-line'] = el => {
  const p = project(), form = $(`.composer[data-comp="home-${p.id}"]`) || $('.composer');
  if (form) openDrawing(p, form, { from:el, asLine:true }).catch(error => toast(error.message));
};
// ---------- Which branch a new line goes on ----------
// The latest branch with a line on it that is not merged yet. A question asked on the trunk does not change it.
function latestBranch(p) {
  const on = (p.lines || []).filter(l => l.branch && l.branch !== p.trunk && !p.branches?.[l.branch]?.merged);
  return on.length ? on.reduce((a, b) => ((b.updatedAt || 0) > (a.updatedAt || 0) ? b : a)).branch : '';
}
const homeBox = p => comp(`home-${p.id}`);
// What you chose, or else your folder on the branch it is on, as a new conversation in an agent app works. A branch of its own only when you pick one. No answer means this project has no branches, or the server does not know about them yet.
function boxTarget(c, p) {
  if (p.git !== true) return null;
  const merged = t => t?.branch && p.branches?.[t.branch]?.merged;
  if (merged(c.flags.target)) delete c.flags.target;
  return c.flags.target || { main:true };
}
// The branch your code folder has checked out. The trunk is the project's main branch whatever that is (PE-520).
const folderBranch = p => p.here || p.trunk;
const targetName = (p, t) => t.off ? 'Off main' : t.branch || (t.main ? folderBranch(p) : t.new === p.trunk ? 'New branch' : `New branch from ${t.new}`);
// Your folder sends no branch: the server takes the one checked out there as the line starts.
const targetBody = (p, t) => (t?.off ? { offMain:true } : t?.branch ? { branch:t.branch } : t?.new ? { newFrom:t.new } : {});
// A long name is its start and its end. In a narrow box (make.js fitBar) the start gives up letters, the end never does,
// so claude/one-row-ask-box-design reads claude/one-ro…design. Short names, such as main, never shorten.
const nameParts = name => (name.length > 16 ? `<span class="bb-head">${esc(name.slice(0, -7))}</span><span class="bb-tail">${esc(name.slice(-7))}</span>` : esc(name));
const branchPicker = (p, t) => {
  const name = targetName(p, t), say = t.off ? 'A line with no Git: no branch and no merge' : t.new ? 'Starts when you paste this' : t.main ? `Works in your folder, on ${folderBranch(p)}` : `This new line works on ${name}`;
  return `<button type="button" class="box-branch ${t.off ? 'is-off' : t.new ? 'is-new' : t.main ? 'is-main' : ''}" data-act="box-branch" aria-haspopup="menu" aria-label="Branch: ${esc(name)}" title="${esc(`${name} · ${say}`)}">${ic(t.off ? 'note' : 'branch', 14)}<span class="bb-name">${nameParts(name)}</span>${ic('down', 13)}</button>`;
};
// From a branch on the map or from the menu: the box says so, and the cursor goes there.
function chooseTarget(target) {
  const p = project(), form = $(`.composer[data-comp="home-${p.id}"]`);
  homeBox(p).flags.target = target;
  closeMenu();
  if ($('#pano')) Pano.update(true);
  if (!form) return;
  syncComposer(form);
  const chip = $('.box-branch', form);
  if (chip) { chip.classList.remove('pulse'); void chip.offsetWidth; chip.classList.add('pulse'); }
  $('.cmp-input', form).focus();
}
const ageWords = at => { const days = (Date.now() - at) / 864e5; return days < 1 ? 'today' : days < 2 ? 'yesterday' : days < 14 ? `${Math.floor(days)} days ago` : days < 60 ? `${Math.floor(days / 7)} weeks ago` : `${Math.floor(days / 30)} months ago`; };
async function openBranchMenu(anchor) {
  const p = project(), c = homeBox(p), form = anchor.closest('.composer'), now = boxTarget(c, p); if (!now) return;
  // The menu opens at once if Git is slow, with the branches on the map.
  const listed = await Promise.race([api(`${pathFor(p.id)}/branches`).then(r => r.branches || []).catch(() => []), new Promise(resolve => { setTimeout(() => resolve([]), 1200); })]);
  if (!anchor.isConnected) return;
  closeMenu();
  const folder = folderBranch(p), trunkRow = folder !== p.trunk ? [p.trunk] : [];
  const onMap = [...new Set([...trunkRow, ...p.lines.filter(l => l.branch && l.branch !== p.trunk && l.branch !== folder && !p.branches?.[l.branch]?.merged).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).map(l => l.branch)])];
  const others = listed.filter(b => !onMap.includes(b.name) && b.name !== folder), count = onMap.length + others.length, here = now.branch || (now.new && now.new !== p.trunk ? now.new : '') || latestBranch(p);
  const same = t => JSON.stringify(t) === JSON.stringify(now), mark = (t, extra = '') => `role="menuitemradio" aria-checked="${same(t)}" class="${same(t) ? 'on' : ''} ${extra}"`;
  const row = (name, right, dot) => `<button type="button" ${mark({ branch:name })} data-branch="${esc(name)}">${ic('branch', 15)}<span><code title="${esc(name)}">${esc(name)}</code></span>${dot ? '<i class="branch-dot" title="Working"></i>' : ''}${right ? `<small>${esc(right)}</small>` : ''}</button>`;
  const rows = q => {
    const hit = name => !q || name.toLowerCase().includes(q), lines = name => p.lines.filter(l => l.branch === name);
    const html = onMap.filter(hit).map(name => (name === p.trunk ? row(name, '') : row(name, `${lines(name).length} ${lines(name).length === 1 ? 'line' : 'lines'}`, lines(name).some(l => lineState(l) === 'working')))).join('') + others.filter(b => hit(b.name)).map(b => row(b.name, ageWords(b.at))).join('');
    return html || '<p class="branch-none">No branch by that name</p>';
  };
  const m = document.createElement('div');
  m.className = 'menu branch-menu'; m.id = 'menu'; m.setAttribute('role', 'menu');
  const fresh = from => `<button type="button" ${mark({ new:from })} data-new="${esc(from)}">${ic('plus', 15)}<span>New branch from <code>${esc(from)}</code></span></button>`;
  // The search box comes first, and the trunk is the first row under it, like every other branch.
  m.innerHTML = `${count > 6 ? '<input class="branch-find" type="text" aria-label="Find a branch" placeholder="Find a branch" autocomplete="off">' : ''}
    <button type="button" ${mark({ main:true }, 'branch-trunk')} data-main="1">${ic('branch', 15)}<span><code>${esc(folder)}</code></span><small>In your folder</small></button>
    <div class="branch-new">${fresh(p.trunk)}${here ? fresh(here) : ''}</div>
    ${count ? `<hr><div class="branch-list">${rows('')}</div>` : ''}
    <hr><button type="button" ${mark({ off:true }, 'branch-off')} data-off="1">${ic('note', 15)}<span>Off main</span><small>No Git: notes, plans, drawings</small></button>`;
  document.body.append(m);
  const vp = typeof pageViewport === 'function' ? pageViewport() : { width:innerWidth, height:innerHeight };
  const rectOf = el => typeof pageRect === 'function' ? pageRect(el) : el.getBoundingClientRect();
  const box = rectOf(form), chip = rectOf(anchor), width = rectOf(m).width;
  m.style.left = `${clamp(chip.right - width, 8, Math.max(8, vp.width - width - 8))}px`;
  m.style.bottom = `${vp.height - box.top + 6}px`;
  m.style.maxHeight = `${Math.min(Math.max(220, box.top - 14), Math.max(120, vp.height - 16))}px`;
  m.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    chooseTarget(b.dataset.off ? { off:true } : b.dataset.branch ? { branch:b.dataset.branch } : b.dataset.new ? { new:b.dataset.new } : { main:true });
  });
  const find = $('.branch-find', m);
  find?.addEventListener('input', () => { $('.branch-list', m).innerHTML = rows(find.value.trim().toLowerCase()); });
  m.addEventListener('keydown', e => {
    const list = $$('button', m), i = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); (i <= 0 && find ? find : list[(i - 1 + list.length) % list.length])?.focus(); }
    if (e.key === 'Enter' && e.target === find) { e.preventDefault(); ($('.branch-list button', m) || list[0])?.click(); }
    if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); anchor.focus(); }
  });
  (find || $('button', m)).focus();
  setTimeout(() => document.addEventListener('pointerdown', menuOutside, { once:false }), 0);
}
ACT['box-branch'] = el => { if ($('#menu.branch-menu')) closeMenu(); else openBranchMenu(el).catch(error => toast(error.message)); };
ACT['new-line-on'] = el => chooseTarget(el.dataset.off ? { off:true } : el.dataset.branch === folderBranch(project()) ? { main:true } : { branch:el.dataset.branch });
// ---------- A folder with no Git yet ----------
ACT['track-ask'] = () => { S.trackAsk = project().id; Pano.update(true); };
ACT['track-no'] = () => { S.trackAsk = null; Pano.update(true); };
ACT['track-yes'] = async el => {
  const p = project();
  el.disabled = true; el.textContent = 'Tracking…';
  try {
    const saved = await api(`${pathFor(p.id)}/track`, { method:'POST', body:{} });
    S.trackAsk = null;
    await loadState(p.id, { force:true });
    refreshAfterChange();
    const form = $(`.composer[data-comp="home-${p.id}"]`);
    if (form) syncComposer(form);
    toast(`Tracking changes on ${saved.trunk}.`);
  } catch (error) { toast(error.message); el.disabled = false; el.textContent = 'Track changes'; }
};
// ---------- How the box sends ----------
const appName = agent => agent?.app || agent?.name || 'your agent';
// Only the browser check runs requests from here, because it has no app to paste into. Nobody else can reach this.
function testRuns() { try { return localStorage.getItem('penecho-lines-test-run') === '1'; } catch { return false; } }
function pasteAgent(form, c, p) {
  const list = availableAgents(), topic = c.flags.topic && c.flags.topic !== 'new' ? lineById(p, c.flags.topic) : null;
  const fallback = (typeof defaultPreset === 'function' && defaultPreset()?.agent) || p.defaultAgent;
  const wanted = c.flags.agent || topic?.conversation?.agent || topic?.agent || fallback;
  return list.find(a => a.id === wanted) || list.find(a => a.app) || list[0] || null;
}
// What you type never changes where it goes. Only something that is not a request at all, a Canvas or a note, has its own button.
function boxSends(form, c, p, plan) {
  if (form.dataset.preview !== '1' || plan.kind !== 'line') return { mode:'plain' };
  return testRuns() ? { mode:'run' } : { mode:'send', agent:pasteAgent(form, c, p) };
}
function replyOutcome(result, line) {
  if (result?.mode === 'continued') return 'Continuing with your reply.';
  if (result?.mode === 'queued') return 'Queued after this Work.';
  if (result?.mode === 'steered') return 'Steered into the running Work.';
  return `Recorded in ${line.slug}.md`;
}
// Every project's summary is read after the save, and a summary failure does not undo a saved request.
function refreshSentProjects() {
  loadProjects().then(() => {
    renderRail();
    const switcher = $('#switcher'); if (switcher && !switcher.hidden) renderSwitcher();
  }).catch(() => {});
}
// What you wrote goes in the Topic now, marked Not sent, and the box is free again. Pasting it is on the Ask itself, on the page it is on.
// It is on the line at once; the folder is written behind it.
function saveToTopic(form, how) {
  const key = form.dataset.comp, c = comp(key), p = project(), text = c.text.trim();
  const here = form.dataset.on === 'step' ? lineById(p, S.route.line) : null;
  const target = { ...(here ? {} : targetBody(p, boxTarget(c, p))), ...embedCanvas() };
  const show = (took, where = here, open = true) => {
    const e = showAtOnce(project(p.id) || p, { kind:'ask', text, took, here:where, offMain:Boolean(target.offMain), open });
    if (how.agent) (S.askFor ||= {})[`${e.lineId}/${e.station.id}`] = how.agent.id;
    return e;
  };
  const send = async (took, line, uploaded) => {
    const attachments = took.files.length ? await uploadFiles(p, took.files, undefined, uploaded) : [];
    if (target.canvas) {
      const view = await embedCanvasReady();
      if (view) target.canvasView = view;
    }
    return api(`${pathFor(p.id)}/unsent`, { method:'POST', body:{ text, attachments, refers:took.refers.map(r => savedId(r.step)), topic:here ? line : 'new', ...(took.make ? { make:took.make } : {}), ...target } });
  };
  if (typeof HOSTED !== 'undefined' && HOSTED) return saveCloudAsk(form, p, here, send, show);
  const took = takeBox(key), e = show(took);
  return saveBehind(e, key, took, line => send(took, line));
}
async function saveCloudAsk(form, p, here, send, show) {
  const key = form.dataset.comp, c = comp(key), route = S.route, hash = location.hash;
  const transition = typeof navigationTransition === 'undefined' ? 0 : navigationTransition;
  if (c.sending) return;
  const took = { text:c.text, files:[...c.files], refers:[...(c.refers || [])], make:c.flags.make || null };
  const live = () => $$('.composer').find(x => x.dataset.comp === key);
  c.sending = true;
  closeMenu();
  syncComposer(form);
  const job = savingQueue.then(() => {
    const line = here && savedId(here.id);
    if (line && isSaving(line)) throw new Error('Its line could not be saved, so this was not saved either.');
    return send(took, line, c.cloudUploads ||= new WeakMap());
  });
  savingQueue = job.catch(() => {});
  let saved;
  try { saved = await job; }
  catch (error) { toast(error.offline ? 'Could not confirm the send. Check the Line before trying again.' : error.message); return; }
  finally { delete c.sending; syncComposer(live()); }
  delete c.cloudUploads;
  const same = (items, sent) => items.length === sent.length && items.every((item, index) => item === sent[index]);
  if (c.text === took.text && same(c.files, took.files) && same(c.refers || [], took.refers) && (c.flags.make || null) === took.make) takeBox(key);
  const current = project(p.id), where = here && current && lineById(current, savedId(here.id));
  const stayed = S.cur === p.id && S.route === route && !S.newPage && !S.shelfPage && location.hash === hash
    && (typeof navigationTransition === 'undefined' || navigationTransition === transition);
  if (stayed && (!here || where)) {
    settleSaving(show(took, where, false), saved, key);
    if (!here) go({ view:'line', line:saved.slug });
  } else refreshBehind(p.id);
  return saved;
}
// Words and a picture never share a paste. Claude's box and OpenCode's keep only the picture and cancel the words, and Codex's keeps only the words. So the words go first, and the files get a paste of their own.
// Copies it. With context it then goes on to your agent if the server is sure of the place, and pressing Send there stays yours.
async function pasteToAgent(l, step, agent, context = false) {
  // Quotes alone in the box are waiting for this Ask. With words of yours beside them, they belong to those words.
  const form = $('.lp-dock .composer'), box = form ? comp(form.dataset.comp) : null, quotes = box && !box.text.trim() && !box.files.length ? (box.refers || []).filter(r => r.line === l.id) : [];
  const p = project(), sent = await api(topicApi(p, l, 'paste'), { method:'POST', body:{ step, agent:agent?.id || '', context, refers:quotes.map(r => r.step) } });
  if (sent.referred) {
    box.refers = box.refers.filter(r => !quotes.includes(r));
    syncComposer(form);
    await loadState(p.id, { force:true });
    l = lineById(project(), l.id) || l;
  }
  // A new branch has just started, so the line now has one.
  if (l.newBranchFrom) { await loadState(p.id, { force:true }); l = lineById(project(), l.id) || l; }
  const files = stationById(l, step)?.files || [];
  const copied = sent.copied || await copyText(sent.text, 'Copied');
  // Only once the words are on the clipboard. If this does not happen nothing is lost: it stays a copy.
  const going = context && copied && S.thisComputer && !(l.running && !l.elsewhere) ? openingAgent(project(), l, stationById(l, step)) : null;
  const went = going ? await api(topicApi(project(), l, 'open-agent'), { method:'POST', body:{ agent:going.id } }).catch(() => null) : null;
  // The hint follows the button you pressed, in the name that button shows.
  const done = (S.handed ||= {})[`${l.id}/${step}`] = context ? { agent:'', app:'', terminal:'', context:true, opened:went?.opened ? went.app : '', ...(went?.pick ? { pick:true, title:went.title || '', fresh:Boolean(went.fresh), folder:went.folder || '' } : {}) } : { agent:agent?.id || sent.agent, app:agent ? appName(agent) : sent.app, terminal:sent.terminal, context:false };
  // A terminal has no attachments, and the paths you pasted are all it needs.
  if (sent.copied && !done.terminal && done.opened !== 'Terminal') Object.assign(done, { attachments:sent.attachments || 0, what:files.length && files.every(f => f.image) ? 'picture' : 'file', filesCopied:false });
  // Files take a second press, and that button is on the line.
  if (S.route.view === 'line') refreshLine(); else if (done.attachments) go({ view:'line', line:l.id }); else if (sent.copied) toast(pasteHint(done));
}
// Words went first, and the files follow in a paste of their own. If this cannot happen, the paths in what you pasted still reach the agent.
async function copyAskFiles(l, step) {
  const sent = await api(topicApi(project(), l, 'paste-files'), { method:'POST', body:{ step } }), done = S.handed?.[`${l.id}/${step}`];
  if (!sent.copied) { toast('Could not copy the files. The agent can still read them from the paths you pasted.'); return; }
  if (done) done.filesCopied = true;
  refreshLine();
}
const filesLabel = done => done.attachments === 1 ? `the ${done.what}` : `${done.attachments} ${done.what}s`;
function pasteHint(done) {
  const key = /Mac/.test(navigator.platform) ? '⌘V' : 'Ctrl+V';
  if (done.filesCopied) return `Copied ${filesLabel(done)}. Press ${key} in the same box, then Send.`;
  const next = done.attachments ? `then copy ${filesLabel(done)}` : 'then Send';
  // An app that cannot be sent to a conversation came forward on whatever it was showing.
  if (done.context && done.pick) return `Copied with the path of this line's .md file. In ${done.opened}, ${done.fresh ? (done.folder ? `start a new session in “${done.folder}”` : 'start a new session') : done.title ? `open “${done.title}”` : "open this line's conversation"}, press ${key}, ${next}.`;
  if (done.context) return `Copied with the path of this line's .md file. ${done.opened ? `Press ${key} in ${done.opened}` : `Open your agent, press ${key}`}, ${done.opened === 'Terminal' ? 'then press Enter' : next}.`;
  return done.terminal ? `Copied. Run ${done.terminal}, paste, then press Enter.` : `Copied. Open ${done.app}, press ${key}, ${next}.`;
}
function renderSlash(form) {
  const key = form.dataset.comp, c = comp(key), menu = $(`#slash-${key}`, form);
  const q = c.text.startsWith('/') ? c.text.slice(1).toLowerCase() : null;
  if (form.dataset.preview !== '1' || (q === null && !form.dataset.slash) || (q !== null && q.includes(' '))) { menu.hidden = true; form.dataset.slash = ''; return; }
  const list = COMMANDS.filter(k => (form.dataset.on !== 'orchestrator' || k.make || k.meetcue) && (!q || k.cmd.slice(1).startsWith(q) || k.title.toLowerCase().includes(q)));
  menu.hidden = !list.length;
  form.dataset.sel = clamp(+form.dataset.sel || 0, 0, Math.max(0, list.length - 1));
  menu.innerHTML = list.map((k, i) => `<button type="button" role="option" aria-selected="${i === +form.dataset.sel}" data-act="cmp-command" data-cmd="${k.cmd}">${ic(k.icon, 17)}<span class="sl-cmd">${k.cmd}</span><span>${esc(k.title)}</span></button>`).join('');
}
// A new Topic starts from a template, and the box is where you choose. Nothing else on the page needs a button for it.
const startFrom = form => openMenu(form, [{ head:'Start from' }, ...TOPIC_TEMPLATES.map(t => ({ label:t.label, icon:t.icon, fn:() => newNote('', [], t).catch(error => toast(error.message)) }))]);
function applyCommand(form, cmd) {
  const k = COMMANDS.find(x => x.cmd === cmd), key = form.dataset.comp, c = comp(key), ta = $('.cmp-input', form);
  $(`#slash-${key}`, form).hidden = true; form.dataset.slash = '';
  if (k.instant === 'canvas') { c.text = ''; c.cmd = null; ta.value = ''; newCanvas(); return; }
  if (k.instant === 'topic') { c.text = ''; c.cmd = null; ta.value = ''; startFrom(form); return; }
  if (k.make || k.meetcue) { c.text = ''; c.cmd = null; ta.value = ''; if (k.make) chooseMake(form, k.make.kind, k.make.sub); else ACT['make-meetcue'](ta); return; }
  c.cmd = k.cmd.slice(1); c.text = k.text; ta.value = k.text; syncComposer(form);
  ta.focus(); ta.setSelectionRange(k.text.length, k.text.length);
}
async function addFiles(key, list, { drawing = false } = {}) {
  const c = comp(key), arr = [...list];
  if (c.sending) return;
  if (typeof HOSTED !== 'undefined' && HOSTED?.shared) {
    const problem = hostedPictureProblem(c.files, arr);
    if (problem) { toast(problem); return; }
  } else if (!can('files')) { toast('Add files in PenEcho on a computer.'); return; }
  if (key.startsWith('orch-') && c.files.length + arr.length > 20) { toast('A job can include up to 20 files.'); return; }
  const keeping = [];
  for (const f of arr) {
    // The file goes to the project folder when sent or opened for drawing.
    const item = { id: uid('a'), name: f.name || 'pasted-image.png', type: f.type, size: f.size, blob: f };
    if (drawing) item.drawing = true;
    if (f.type?.startsWith('image/')) item.url = URL.createObjectURL(f);
    c.files.push(item);
    if (key.startsWith('orch-')) keeping.push(keepOrchFile(item));
  }
  syncComposer($(`.composer[data-comp="${key}"]`));
  if (keeping.length) { await Promise.all(keeping); rememberBoxes(); }
  return true;
}
function activeComposer() {
  // The page fading out as you leave it is only a picture of a page.
  const forms = $$('.composer').filter(f => f.offsetParent !== null && !f.closest('.fly-ghost'));
  const focused = document.activeElement?.closest?.('.composer');
  return focused || forms[forms.length - 1] || null;
}
function wireComposers(root = document) {
  $$('.composer', root).forEach(form => {
    if (form.dataset.wired) { syncComposer(form); return; }
    form.dataset.wired = '1';
    const key = form.dataset.comp, c = comp(key), ta = $('.cmp-input', form);
    if (form.dataset.on === 'orchestrator') {
      ta.value = c.text;
      ta.addEventListener('blur', rememberBoxes);
    }
    const sharedNote = form.dataset.sharedNote === '1';
    if (sharedNote) {
      const pick = $('input[type=file]', form);
      $('[data-pick-picture]', form).onclick = () => pick.click();
      pick.onchange = () => { addFiles(key, pick.files); pick.value = ''; };
      $('[data-draw-note]', form).onclick = event => hostedDrawNote(key, event.currentTarget);
    }
    ta.addEventListener('input', () => {
      c.text = ta.value;
      if (!c.text.trim()) c.cmd = null;
      form.dataset.sel = 0;
      syncComposer(form); if (!sharedNote) renderSlash(form);
    });
    ta.addEventListener('keydown', e => {
      if (c.sending) { if (e.key === 'Enter') e.preventDefault(); return; }
      if (sharedNote) {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); saveNote(form); }
        return;
      }
      const menu = $(`#slash-${key}`, form);
      if (!menu.hidden) {
        const items = $$('button', menu), i = +form.dataset.sel || 0;
        if (e.key === 'ArrowDown') { e.preventDefault(); form.dataset.sel = (i + 1) % items.length; renderSlash(form); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); form.dataset.sel = (i - 1 + items.length) % items.length; renderSlash(form); return; }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); items[i] && applyCommand(form, items[i].dataset.cmd); return; }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); menu.hidden = true; form.dataset.slash = ''; return; }
      }
      if (typeof makeTab === 'function' && makeTab(form, e)) return;   // Tab puts the example in (make.js)
      if (form.dataset.on === 'orchestrator') {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); orchSubmit(Boolean(e.metaKey || e.ctrlKey)); }
        return;
      }
      // Enter does what the button says. With Command or Ctrl it does the other one, when the button has two.
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); const other = (e.metaKey || e.ctrlKey) && $('.send-pick', form); if ((form.dataset.noteFirst === '1') !== Boolean(other)) saveNote(form); else sendComposer(form); }
    });
    ta.addEventListener('paste', e => {
      if (c.sending) { e.preventDefault(); return; }
      const files = [...(e.clipboardData?.files || [])];
      if (files.length) { e.preventDefault(); addFiles(key, files); return; }
      if (!sharedNote && typeof makePaste === 'function') makePaste(form, e);   // A table from Excel is one file (make.js)
    });
    form.addEventListener('click', e => { if (c.sending && e.target.closest('button')) { e.preventDefault(); e.stopPropagation(); } }, true);
    form.addEventListener('submit', e => { e.preventDefault(); if (form.dataset.on === 'orchestrator') orchSubmit(); else if (form.dataset.noteFirst === '1') saveNote(form); else sendComposer(form); });
    syncComposer(form);
  });
}
function sendComposer(form) {
  const key = form.dataset.comp, c = comp(key), ta = $('.cmp-input', form), text = c.text.trim();
  const marks = form.dataset.on === 'markup' ? unsentMarks() : 0;
  if (!text && !c.files.length && !marks) { ta.focus(); return; }
  if (c.sending || form.dataset.busy) return;
  const how = boxSends(form, c, project(), detectPath(text, c, project()));
  if (how.mode === 'send') { saveToTopic(form, how); return; }
  form.dataset.busy = '1'; form.classList.add('busy');
  const payload = { text, files: c.files, refers: (c.refers || []).map(r => r.step), quotes: [...(c.refers || [])], box: key, flags: c.flags, cmd: c.cmd, marks };
  // Your words stay in the box until they have really been saved.
  Promise.resolve().then(() => SEND[form.dataset.on]?.(payload)).then(() => {
    c.text = ''; c.files = []; c.refers = []; c.flags = { ...c.defaults }; c.cmd = null;
    // Sending may have redrawn the page, so clear whichever box now shows these words.
    const live = $$('.composer').find(x => x.dataset.comp === form.dataset.comp);
    if (live) { const input = $('.cmp-input', live); input.value = ''; syncComposer(live); input.focus(); }
  }).catch(error => toast(error.message)).finally(() => { delete form.dataset.busy; form.classList.remove('busy'); });
}
const SEND = {};
// ---------- Drawing goes as far as the box, and never further by itself ----------
const BOXES_KEY = 'penecho-lines-boxes', DRAWING_KEY = 'penecho-lines-drawing';
const storedBox = c => ({ project:c.project, text:c.text || '', refers:c.refers || [], flags:c.flags || {}, cmd:c.cmd || null, files:c.files.filter(f => f.path || f.draftKey).map(({ blob, url, ...f }) => f) });
function pendingDrawing() {
  if (typeof EMBED !== 'undefined' && EMBED) return null;
  try { return JSON.parse(sessionStorage.getItem(DRAWING_KEY) || 'null'); } catch { return null; }
}
const boxesNeedFiles = id => !EMBED && (pendingDrawing()?.project === id || Object.values(S.comp).some(c => c.project === id && c.files.some(f => f.path)));
// The Canvas can be another page, so what is in the boxes has to outlive the trip. Files only you have so far go to the folder, one trip after another.
let boxesGoing = null;
const boxFilesGoing = new WeakMap();
function uploadBoxes(p) {
  const going = (boxesGoing || Promise.resolve()).catch(() => {}).then(async () => {
    for (const c of Object.values(S.comp)) if (!c.project || c.project === p.id) for (const f of c.files) if (f.blob && !f.path) {
      const saving = f.uploaded ? Promise.resolve(f.uploaded) : uploadFiles(p, [f]).then(saved => saved[0]);
      boxFilesGoing.set(f, saving);
      const saved = await saving;
      // Drawn on meanwhile, it is the drawing now.
      if (f.blob && !f.path) { f.path = saved.path; f.name = saved.name; }
    }
  });
  const done = going.finally(() => { if (boxesGoing === done) boxesGoing = null; });
  return boxesGoing = done;
}
function rememberBoxes() {
  if (EMBED) return;
  try {
    const boxes = {};
    for (const [key, c] of Object.entries(S.comp)) {
      const p = c.project && typeof project === 'function' ? project(c.project) : null;
      const line = p && c.flags?.topic && typeof lineById === 'function' ? lineById(p, c.flags.topic) : null;
      const saved = line?.asking?.isSecret ? storedBox({ ...c, text:'' }) : storedBox(c);
      if (saved.text || saved.files.length || c.refers?.length || c.flags?.target || c.flags?.make) boxes[key] = saved;
    }
    const snapshot = JSON.stringify(boxes);
    try { sessionStorage.setItem(BOXES_KEY, snapshot); } catch {
      // Give the unsent words and file references priority over the cached page picture.
      sessionStorage.removeItem('penecho-lines-page-kept');
      sessionStorage.setItem(BOXES_KEY, snapshot);
    }
  } catch { /* It only means typing it again. */ }
}
async function restoreBoxes() {
  if (EMBED) return;
  try {
    const boxes = JSON.parse(sessionStorage.getItem(BOXES_KEY) || '{}');
    const restoring = [];
    for (const [key, saved] of Object.entries(boxes)) {
      S.comp[key] = { project:saved.project, text:saved.text || '', files:saved.files || [], refers:saved.refers || [], flags:saved.flags || {}, cmd:saved.cmd || null };
      if (key.startsWith('orch-')) for (const file of S.comp[key].files) {
        if (file.draftKey && !file.path) restoring.push(restoreOrchFile(file).catch(() => toast(`Could not restore ${file.name}. Reattach it if needed.`)));
      }
    }
    await Promise.all(restoring);
  } catch { /* The boxes simply start empty. */ }
}
// A file that has gone from the folder in the meantime can no longer be sent.
function boxUrls(p) {
  for (const c of Object.values(S.comp)) {
    if (c.project && c.project !== p.id) continue;
    if (listsFiles(p)) c.files = c.files.filter(f => f.blob || (!f.path && f.draftKey) || fileEntry(p, f.path));
    for (const f of c.files) if (f.path && !f.blob && fileEntry(p, f.path)) f.url = assetUrl(p, f.path);
  }
}
// A Canvas kept beside a picture, so it reopens as you left it. For a PNG, the picture it makes is that same file.
function sourceBeside(p, path, { keepOriginal = false } = {}) {
  const known = !keepOriginal && canvasByPath(p, path);
  if (known) return known.source;
  const slash = path.lastIndexOf('/');
  const dir = keepOriginal && !path.startsWith('files/') ? 'files/canvases' : path.slice(0, slash);
  const base = path.slice(slash + 1).replace(/\.[^.]+$/, '') + (keepOriginal ? '-edited' : '');
  let name = base, n = 2;
  while (fileEntry(p, `${dir}/${name}.penecho.json`) || (`${dir}/${name}.png` !== path && fileEntry(p, `${dir}/${name}.png`))) name = `${base}-${n++}`;
  return `${dir}/${name}.penecho.json`;
}
async function openDrawing(p, form, { seed = '', file = null, ask = null, from = null, asLine = false, toLine = '', beforeOpen = null } = {}) {
  if (form.dataset.on === 'orchestrator' && comp(form.dataset.comp).starting) return;
  // In the shell this page stays under the Canvas with the boxes as they are: the Canvas opens now, and their files go to the folder behind it.
  const stays = !EMBED && typeof window !== 'undefined' && Boolean(window.PenEchoCanvasShell?.enabled?.()), uploads = uploadBoxes(p);
  if (!stays) await uploads;
  rememberBoxes();
  if (beforeOpen && !beforeOpen()) return;
  const noteCanvas = seed && from?.closest('.lp-note') && canvasByPath(p, seed);
  if (noteCanvas) {
    uploads.then(rememberBoxes, error => toast(error.message));
    return openCanvasPage(canvasUrl(p, { source:noteCanvas.source, title:noteCanvas.title, doc:noteCanvas.topic ? `lines/${noteCanvas.topic}.md` : '' }), from);
  }
  const key = form.dataset.comp, source = ask ? sourceBeside(p, ask.path) : file?.source || freeSource(p, 'files/_incoming', `drawing-${Date.now().toString(36)}`), picture = source.replace(/\.penecho\.json$/, '.png');
  const place = asLine ? targetBody(p, boxTarget(comp(key), p)) : null;
  const handoff = { project:p.id, comp:key, source, picture, before:fileEntry(p, picture)?.mtime || 0, file:file?.id || '', ask, asLine, toLine, place };
  const keepHandoff = () => { try { sessionStorage.setItem(DRAWING_KEY, JSON.stringify({ ...handoff, box:storedBox(comp(key)) })); } catch { /* Without this the drawing is still saved in the folder. */ } };
  keepHandoff();
  // A picture you attached is what you start drawing on. One you drew reopens as it was left.
  const start = ask ? (fileEntry(p, source) ? '' : ask.path) : file && !file.source ? file.path || '' : seed;
  const given = stays && file?.blob && !file.source ? { blob:file.blob, name:file.name } : null;
  if (stays) uploads.then(() => {
    rememberBoxes();
    if (pendingDrawing()?.source === source) keepHandoff();
    if (given && file.path) window.PenEchoCanvasShell.pictureSaved(p.id, source, file.path);
  }, error => toast(error.message));
  return openCanvasPage(canvasUrl(p, { source, title:'Drawing', seed:start, draft:true }), from, { seeded:Boolean(start || given), fresh:!ask && !file?.source, picture:given });
}
// Back from the Canvas: if something was drawn on an Ask not sent yet, that Ask's picture is what you drew. Otherwise it is in the box now, to edit again or send. Nothing has been sent.
let takingDrawing = null;
const canvasShellOpen = () => typeof window !== 'undefined' && window.PenEchoCanvasShell?.active;
function takeDrawing(p) {
  if (EMBED || !p || canvasShellOpen()) return Promise.resolve();
  return takingDrawing ||= (boxesGoing ? boxesGoing.catch(() => {}).then(() => reconcileDrawing(p)) : reconcileDrawing(p)).finally(() => { takingDrawing = null; });
}
async function reconcileDrawing(p) {
  const d = pendingDrawing();
  if (!d || d.project !== p.id) return;
  const raw = sessionStorage.getItem(DRAWING_KEY);
  const consumed = () => { if (sessionStorage.getItem(DRAWING_KEY) === raw) sessionStorage.removeItem(DRAWING_KEY); rememberBoxes(); };
  // A poll may have read the project before Done saved the drawing.
  await loadState(p.id, { force:true, needs:{ parts:['files'] } });
  p = project(p.id);
  if (canvasShellOpen() || sessionStorage.getItem(DRAWING_KEY) !== raw) return;
  if (d.box) {
    // The files as this page still has them, and one that could not be put in the folder.
    const kept = d.box.files || [], here = (S.comp[d.comp]?.files || []).filter(f => f.blob);
    S.comp[d.comp] = { ...d.box, files:[...kept.map(k => here.find(f => f.id === k.id) || k), ...here.filter(f => !f.path && !kept.some(k => k.id === f.id))] };
  }
  boxUrls(p);
  const entry = fileEntry(p, d.picture);
  // A blank Canvas never wrote either file. A missing PNG beside an existing Canvas can still arrive later.
  if (!entry) { if (!d.before && !fileEntry(p, d.source)) consumed(); return; }
  if (entry.mtime <= d.before) { consumed(); return; }
  if (d.asLine || d.toLine) {
    const saved = await api(`${pathFor(p.id)}/yours`, { method:'POST', body:{ kind:'canvas', picture:d.picture, topic:d.toLine || 'new', ...(d.asLine ? d.place || {} : {}) } });
    consumed();
    await loadState(p.id, { force:true }); await loadProjects(); go({ view:'line', line:saved.slug }); if (d.toLine) setTimeout(() => scrollToItem(saved.step), 400);
    return;
  }
  const asked = d.ask && lineById(p, d.ask.line), waiting = asked && stationById(asked, d.ask.step);
  if (waiting?.unsent) {
    if (d.picture !== d.ask.path) { await act(asked, 'unsent-picture', { step:waiting.id, from:d.ask.path, to:d.picture }); refreshAfterChange(); }
    consumed();
    return;
  }
  // What you drew takes the place of the picture you drew on.
  const c = comp(d.comp), known = c.files.find(f => f.source === d.source || (d.file && f.id === d.file)), drawing = { name:'Drawing', type:'image/png', size:entry.size, path:d.picture, source:d.source, url:assetUrl(p, d.picture) };
  if (known) { Object.assign(known, drawing, { editedAt:entry.mtime }); delete known.blob; delete known.uploaded; }
  else c.files.push({ id:uid('a'), ...drawing });
  consumed();
}
ACT['cmp-draw'] = el => openDrawing(project(), el.closest('.composer')).catch(error => toast(error.message));
function previewBoxImage(el) {
  const form = el.closest('.composer'), p = project(), key = form.dataset.comp;
  const files = comp(key).files, file = files.find(x => x.id === el.dataset.file);
  if (!file) return;
  const item = x => ({ id:x.id, path:x.path, url:x.url, name:x.name });
  const editImage = target => {
    const current = comp(key).files.find(x => x.id === target.id);
    const live = form.isConnected === false ? $(`.composer[data-comp="${CSS.escape(key)}"]`) : form;
    if (!current || !live || !drawableBoxFile(live, current) || isPendingDrawingFile(key, current)) return null;
    const from = $(`:is(.cmp-file-pic, .orch-file-pic)[data-file="${CSS.escape(target.id)}"]`, live) || el;
    return beforeOpen => openDrawing(p, live, { file:current, from, beforeOpen });
  };
  openLightbox(p, item(file), { list:files.filter(x => x.url && x.type?.startsWith('image/')).map(item), from:el, editImage });
}
ACT['cmp-preview'] = previewBoxImage;
ACT['cmp-edit-draw'] = el => {
  const f = el.closest('.composer'), file = comp(f.dataset.comp).files.find(x => x.id === el.dataset.file);
  const from = $('.cmp-file-pic, .orch-file-pic', el.closest('.cmp-file, .orch-file') || el) || el;
  if (file) openDrawing(project(), f, { file, from }).catch(error => toast(error.message));
};
ACT['cmp-attach'] = el => { const f = el.closest('.composer'); S.pickFor = f.dataset.comp; $('#filePick').click(); };
ACT['cmp-unrefer'] = el => { const f = el.closest('.composer'), c = comp(f.dataset.comp); c.refers = (c.refers || []).filter(r => r.step !== el.dataset.step); syncComposer(f); };
ACT['cmp-remove'] = el => {
  const f = el.closest('.composer'), c = comp(f.dataset.comp), file = c.files.find(x => x.id === el.dataset.file);
  if (f.dataset.sharedNote === '1' && file?.url?.startsWith('blob:')) URL.revokeObjectURL(file.url);
  c.files = c.files.filter(x => x !== file);
  syncComposer(f);
};
ACT['cmp-slash'] = el => {
  const f = el.closest('.composer'), menu = $(`#slash-${f.dataset.comp}`, f);
  if (!menu.hidden) { menu.hidden = true; f.dataset.slash = ''; return; }
  f.dataset.slash = '1'; f.dataset.sel = 0; renderSlash(f); $('.cmp-input', f).focus();
};
ACT['cmp-command'] = el => applyCommand(el.closest('.composer'), el.dataset.cmd);
function wireDrop() {
  let depth = 0;
  const overlay = $('#dropOverlay');
  addEventListener('dragenter', e => { if (![...(e.dataTransfer?.types || [])].includes('Files')) return; depth++; overlay.hidden = !activeComposer(); });
  addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) overlay.hidden = true; });
  addEventListener('dragover', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
  addEventListener('drop', e => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault(); depth = 0; overlay.hidden = true;
    const f = activeComposer(); if (f) addFiles(f.dataset.comp, e.dataTransfer.files);
  });
  $('#filePick').addEventListener('change', e => { const key = S.pickFor || activeComposer()?.dataset.comp; if (key) addFiles(key, e.target.files); S.pickFor = null; e.target.value = ''; });
}
