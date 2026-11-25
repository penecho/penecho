// Canvases & files (N3): everything a project holds on one page. Kinds to filter by, who made it, by time or by kind,
// cards with a picture where there is one. A card opens in the viewer over the page (files-view.js); a link opens in a sheet on the right.
// The server says what each file is, which line and step hold it and who made it (project-files.js). A Canvas keeps its own card menu (canvases.js).
// The design: docs/design/next/files.html.
Object.assign(ICONS, {
  page:'<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 8.5h17M6 6.5h.01M8 6.5h.01"/>',
  meeting:'<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5"/>',
  data:'<rect x="4" y="4.5" width="16" height="15" rx="1.5"/><path d="M4 9.5h16M4 14.5h16M10 4.5v15"/>',
  vault:'<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M12 9v-1M15 12h1"/>',
});
const FL_KINDS = [['all', 'All', 'files'], ['canvas', 'Canvases', 'canvas'], ['page', 'Pages and prototypes', 'page'], ['artifact', 'Claude Artifacts', 'link'], ['slides', 'Slides', 'slides'], ['document', 'Documents', 'doc'], ['picture', 'Pictures', 'image'], ['meeting', 'Meetings', 'meeting'], ['other', 'Other', 'data']];
const FL_LABEL = { canvas:'Canvas', page:'Page', artifact:'Claude Artifact', slides:'Slides', document:'Document', picture:'Picture', data:'Spreadsheet', media:'Media', meeting:'Meeting', file:'File' };
const FL_ICON = { canvas:'canvas', page:'page', artifact:'link', slides:'slides', document:'doc', picture:'image', data:'data', media:'play', meeting:'meeting' };
// Spreadsheets, media and any other file (a .zip, .dmg, .json…) are counted under Other.
const flGroup = kind => (kind === 'data' || kind === 'media' || kind === 'file' ? 'other' : kind);
const flState = () => (S.fl ||= { kind:'all', who:'all', by:'time', q:'', open:null, openPlace:'', entered:'' });
const flBytes = bytes => {
  if (!Number.isFinite(bytes)) return 'Size unavailable';
  const units = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return `${i ? Number(bytes.toFixed(1)) : bytes} ${units[i]}`;
};
// Only files worth a second look carry a word about their line; a file on a current line says nothing.
const flTag = it => ({ archived:'Archived Line', deleted:'Deleted Line', unlinked:'No Line' }[it.usage] || '');
const FL_SIZES = [['', 'Any size'], ['1048576', '1 MB or larger'], ['10485760', '10 MB or larger'], ['104857600', '100 MB or larger']];
const FL_USAGES = [['', 'All files'], ['review', 'Could be cleaned up'], ['archived', 'Archived Lines'], ['deleted', 'Deleted Line leftovers'], ['unlinked', 'No Line link'], ['active', 'In use']];
// What each Line status means, shown in its menu. A file is in use while a current Line or Work, a Topic, understanding.md or MEMORY.md
// links it or names its path, or while it is a Canvas of its own (project-files.js).
const FL_USAGE_NOTES = { review:'Nothing current links to it or names it', archived:'Only archived Lines use it', deleted:'Its Line was deleted; nothing else uses it', unlinked:'Nothing links to it or names it', active:'In current work, or a Canvas of its own' };
const FL_SORTS = [['time', 'Newest first'], ['kind', 'By kind'], ['size', 'Largest first']];
const flTotal = list => flBytes(list.reduce((n, it) => n + (Number.isFinite(it.size) ? it.size : 0), 0));
const flSelected = () => (flState().selected ||= new Set());
const flSelectable = it => it.kind !== 'artifact' && it.path?.startsWith('files/');
const flBase = file => file.split('/').pop();
// Favourites: the server keeps them with the project. A star shows at once; until the folder's next state agrees, the click wins.
const flFavPending = new Map();
function flIsFav(p, key) {
  const id = `${p.id}\n${key}`, saved = (p.favoriteFiles || []).includes(key);
  if (!flFavPending.has(id)) return saved;
  if (flFavPending.get(id).done && flFavPending.get(id).on === saved) { flFavPending.delete(id); return saved; }
  return flFavPending.get(id).on;
}
const flFavButton = (p, it, cls) => (can('favorites') ? `<button type="button" class="icon-btn ${cls}" data-act="file-fav" data-key="${esc(it.key)}" aria-pressed="${flIsFav(p, it.key)}" aria-label="${flIsFav(p, it.key) ? 'Remove from favourites' : 'Add to favourites'}" title="${flIsFav(p, it.key) ? 'Remove from favourites' : 'Add to favourites'}">${ic('star', cls.includes('tiny') ? 15 : 17)}</button>` : '');
const flStackName = it => `${it.items.length} ${it.kind === 'file' ? 'files' : 'pictures'}`;
// One file in a stack's strip: its picture, or its kind's mark and its name.
const flStripThumb = (p, x) => (x.pic ? `<img src="${esc(assetUrl(p, x.pic))}" alt="${esc(x.title)}" loading="lazy">` : `<span class="fl-strip-file">${ic(FILE_ICON(x.path), 16)}<small>${esc(x.title)}</small></span>`);

// Everything the page shows, newest first. A server that does not say what files are (an older PenEcho, or penecho.ai) still shows its Canvases.
function flItems(p) {
  const cache = flItems.cache;
  if (cache?.p === p) return cache.items;
  const items = [], canvases = new Map((p.pictures || []).filter(c => c.source).map(c => [c.source, c])), told = (p.files || []).some(f => f.kind);
  for (const f of p.files || []) {
    if (!f.kind) continue;
    const c = canvases.get(f.path);
    if (c) { items.push({ key:f.path, path:f.path, kind:f.kind, title:c.title, pic:c.hasPicture ? c.path : '', source:c.source, canvas:c, by:f.by, line:f.line, step:f.step, mtime:c.mtime || f.mtime, size:f.size, usage:f.usage, deletion:f.deletion }); canvases.delete(f.path); continue; }
    items.push({ key:f.path, path:f.path, kind:f.kind, title:f.title || flBase(f.path), pic:f.kind === 'picture' ? f.path : '', by:f.by, line:f.line, step:f.step, mtime:f.mtime, size:f.size, usage:f.usage, deletion:f.deletion, folder:Boolean(f.folder) });
  }
  if (!told) for (const c of canvases.values()) items.push({ key:c.source, path:c.source, kind:c.slides ? 'slides' : 'canvas', title:c.title, pic:c.hasPicture ? c.path : '', source:c.source, canvas:c, by:'you', line:c.topic || '', step:'', mtime:c.mtime });
  for (const a of p.artifacts || []) items.push({ key:a.path, path:a.path, url:a.path, kind:'artifact', title:a.title, pic:'', by:a.by, line:a.line, step:a.step, mtime:a.mtime });
  items.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
  flItems.cache = { p, items };
  return items;
}
// The tab's count: everything the page shows. The Home's lighter state has no list of files, only this count (filesShown).
const flCount = p => (p.partial && p.filesShown !== undefined ? p.filesShown : flItems(p).length);
const flLine = (p, it) =>(it.line ? lineById(p, it.line) : null);
const flMade = it => it.by && it.by !== 'you';
function flShown(p) {
  const st = flState(), q = st.q.trim().toLowerCase();
  return flItems(p).filter(it => (st.kind === 'all' || flGroup(it.kind) === st.kind)
    && (st.who === 'all' || (st.who === 'ai' ? flMade(it) : !flMade(it)))
    && (!st.size || (Number.isFinite(it.size) && it.size >= Number(st.size)))
    && (!st.fav || flIsFav(p, it.key))
    && (!st.usage || (st.usage === 'review' ? ['archived', 'deleted', 'unlinked'].includes(it.usage) : it.usage === st.usage))
    && (!p.myCanvases || !S.cvGroup || it.canvas?.group === S.cvGroup)
    && (!q || `${it.title} ${flLine(p, it)?.title || ''}`.toLowerCase().includes(q))).sort((a, b) => st.by === 'size' ? (b.size ?? -1) - (a.size ?? -1) || a.path.localeCompare(b.path) : 0);
}
// Pictures pasted into one line on one day are one card with a count, so All stays readable, and so are other files (a build's
// .zip, .json and logs). Pictures alone, Other, a size or Line status filter and Largest first show them one by one.
function flStacked(list) {
  const st = flState();
  if (st.by === 'size' || st.size || st.usage || st.fav || flSelected().size) return list;
  const out = [], seen = new Map();
  for (const it of list) {
    if (!(it.kind === 'picture' && st.kind !== 'picture') && !(it.kind === 'file' && st.kind !== 'other')) { out.push(it); continue; }
    const key = `${it.kind}|${it.line}|${new Date(it.mtime).toDateString()}`, had = seen.get(key);
    if (had) { had.items.push(it); continue; }
    const stack = { ...it, key:`stack:${key}`, items:[it] };
    seen.set(key, stack); out.push(stack);
  }
  return out.map(it => (it.items?.length === 1 ? it.items[0] : it));
}
const flDay = ms => new Date(new Date(ms).toDateString()).getTime();
function flTimeGroup(ms) {
  const days = Math.round((flDay(Date.now()) - flDay(ms)) / 864e5);
  return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : days < 7 ? 'This week' : new Date(ms).toLocaleDateString([], { month:'long', year:'numeric' });
}
function flWhen(ms) {
  if (!ms) return '';
  const days = Math.round((flDay(Date.now()) - flDay(ms)) / 864e5), time = new Date(ms).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  return days <= 0 ? `Today ${time}` : days === 1 ? `Yesterday ${time}` : new Date(ms).toLocaleDateString([], { day:'numeric', month:'short', ...(new Date(ms).getFullYear() !== new Date().getFullYear() ? { year:'numeric' } : {}) });
}
const flWho = by => (by === 'you' ? av('you', 18) : av(by, 18));
const flThumbClass = kind => ({ artifact:'fl-art', page:'fl-pagek', document:'fl-docs', slides:'fl-docs', meeting:'fl-meet' }[kind] || '');

// A page is drawn at desktop size, then fitted into its card. Only visible cards run their pages.
// Keep the same opaque sandbox as the viewer: a preview cannot take focus or handle a card click.
const flPreviews = new Map();
let flPreviewIntersection = null, flPreviewResize = null, flPreviewDOM = null;
function flPreviewFit(el, frame) {
  const scale = el.clientWidth / 1280;
  frame.style.transform = `scale(${scale})`;
  frame.style.height = `${Math.max(800, Math.ceil(el.clientHeight / (scale || 1)))}px`;
}
function flPreviewShow(el, visible) {
  const state = flPreviews.get(el); if (!state) return;
  state.visible = visible;
  if (!visible || document.hidden) { state.frame?.remove(); state.frame = null; return; }
  if (state.frame) return;
  const frame = document.createElement('iframe');
  frame.className = 'fl-page-frame';
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('allow', "focus-without-user-activation 'none'");
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.title = 'Page preview';
  frame.referrerPolicy = 'no-referrer';
  flPreviewFit(el, frame);
  // Load is only a reveal signal: an opaque frame cannot report whether its page rendered successfully.
  frame.addEventListener('load', () => frame.classList.add('is-ready'), { once:true });
  frame.addEventListener('error', () => frame.remove(), { once:true });
  frame.src = el.dataset.pageUrl;
  state.frame = frame;
  el.append(frame);
}
function flPreviewForget(el) {
  flPreviewShow(el, false);
  flPreviewIntersection?.unobserve(el);
  flPreviewResize?.unobserve(el);
  flPreviews.delete(el);
}
function flPreviewMount() {
  if (typeof IntersectionObserver === 'undefined' || typeof ResizeObserver === 'undefined') return;
  flPreviewIntersection ||= new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.target.isConnected) flPreviewForget(entry.target);
      else flPreviewShow(entry.target, entry.isIntersecting);
    }
  });
  flPreviewResize ||= new ResizeObserver(entries => {
    for (const { target } of entries) {
      const frame = flPreviews.get(target)?.frame;
      if (frame) flPreviewFit(target, frame);
    }
  });
  for (const el of flPreviews.keys()) if (!el.isConnected) flPreviewForget(el);
  const cards = $$('#flBody .fl-page-preview');
  if (!cards.length) { flPreviewDOM?.disconnect(); flPreviewDOM = null; return; }
  // Leaving Files also releases offscreen cards, whose intersection was already false.
  if (!flPreviewDOM && $('#view')) {
    flPreviewDOM = new MutationObserver(flPreviewMount);
    flPreviewDOM.observe($('#view'), { childList:true });
  }
  for (const el of cards) {
    if (flPreviews.has(el)) continue;
    flPreviews.set(el, { visible:false, frame:null });
    flPreviewIntersection.observe(el);
    flPreviewResize.observe(el);
  }
}
// Older browsers may ignore the iframe focus policy. Recover only from a decorative preview taking the search's focus.
let flSearchEditing = null;
const flPreviewHasFocus = el => Boolean(el?.isConnected && [...flPreviews.values()].some(state => state.frame === el));
function flSearchRecover() {
  const edit = flSearchEditing;
  if (!edit || edit.pending) return;
  const input = edit.input, selection = [input.selectionStart, input.selectionEnd, input.selectionDirection];
  edit.pending = true;
  // After the focus has finished moving: a preview that takes it does so during the blur, and a refocus inside that event does not hold.
  setTimeout(() => {
    edit.pending = false;
    if (flSearchEditing !== edit) return;
    if (!input.isConnected || $('#flQ') !== input || S.cur !== edit.project || S.route.view !== edit.view || navigationTransition !== edit.navigation || S.newPage || S.shelfPage) { flSearchEditing = null; return; }
    if (document.hidden || !document.hasFocus()) return;
    // A preview takes the focus, or only the keys: one that calls window.focus() leaves the search as this page's active element.
    const active = document.activeElement;
    if (!flPreviewHasFocus(active) && active !== input) return;
    // Focusing a box that is already this page's active element does not bring the keys back; leaving it first does.
    if (active === input) input.blur();
    input.focus({ preventScroll:true });
    input.setSelectionRange(...selection);
  }, 0);
}
document.addEventListener('focusin', e => {
  if (e.target.id === 'flQ') flSearchEditing = { input:e.target, project:S.cur, view:S.route.view, navigation:navigationTransition };
  else if (!flPreviewHasFocus(e.target)) flSearchEditing = null;
});
document.addEventListener('focusout', e => { if (e.target === flSearchEditing?.input) flSearchRecover(); });
document.addEventListener('pointerdown', e => {
  const input = flSearchEditing?.input;
  if (input && e.target !== input && !input.closest('.fl-search')?.contains(e.target)) flSearchEditing = null;
}, true);
document.addEventListener('keydown', e => { if (e.key === 'Tab' || e.key === 'Escape') flSearchEditing = null; }, true);
addEventListener('blur', flSearchRecover);
document.addEventListener('visibilitychange', () => {
  for (const [el, state] of flPreviews) {
    if (!el.isConnected) flPreviewForget(el);
    else flPreviewShow(el, state.visible);
  }
});

function flCardHTML(p, it) {
  const items = it.items || [it], many = items.length > 1, st = flState(), line = flLine(p, it);
  const page = it.kind === 'page' ? flPageUrl(p, it) : '';
  const preview = page ? `<div class="fl-page-preview" data-page-url="${esc(`${page}${page.includes('?') ? '&' : '?'}v=${Math.round(it.mtime || 0)}`)}" aria-hidden="true" inert></div>` : '';
  const ext = !many && !it.pic && !it.canvas && !it.folder && it.kind !== 'artifact' ? (/\.([^./]{1,5})$/.exec(it.path) || [])[1] : '';
  const thumb = it.pic ? `<img src="${esc(assetUrl(p, it.pic))}" alt="" loading="lazy">` : `<span class="fl-mark">${ic(FL_ICON[it.kind] || 'file', 26)}${ext ? `<small>${esc(ext)}</small>` : ''}</span>${preview}`;
  const where = line ? line.title : it.canvas ? (p.myCanvases && !S.cvGroup && it.canvas.group ? it.canvas.group : shortWhen(it.mtime)) : it.kind === 'artifact' ? '' : 'Project folder';
  const fav = many ? '' : flFavButton(p, it, `tiny fl-fav${flIsFav(p, it.key) ? ' on' : ''}`);
  const more = it.canvas ? `<button type="button" class="icon-btn tiny fl-more cv-more" data-act="canvas-menu" data-source="${esc(it.source)}" aria-label="More for ${esc(it.title)}" title="More">${ic('more', 16)}</button>` : '';
  const tags = new Set(items.map(flTag)), tag = tags.size === 1 ? [...tags][0] : 'Mixed Lines';
  const sized = items.every(x => Number.isFinite(x.size)), size = sized ? flBytes(items.reduce((n, x) => n + x.size, 0)) : '';
  const picked = items.every(x => flSelected().has(x.key));
  const check = can('files') && items.every(flSelectable) ? `<button type="button" class="fl-select" data-act="file-select" data-key="${esc(it.key)}" role="checkbox" aria-checked="${picked}" aria-label="Select ${esc(many ? flStackName(it) : it.title)}">${ic('check', 14)}</button>` : '';
  return `<div class="fl-card ${it.canvas ? 'cv-card' : ''} ${many ? 'fl-stack' : ''} ${st.open === it.key ? 'on' : ''} ${check && picked ? 'picked' : ''}" data-act="file-pick" data-key="${esc(it.key)}" ${it.canvas ? `data-source="${esc(it.source)}"` : ''} role="button" tabindex="0" aria-pressed="${st.open === it.key}">
    <div class="fl-thumb ${flThumbClass(it.kind)} ${it.pic ? 'has-pic' : ''}">${thumb}${many ? `<span class="fl-stack-n">${items.length}</span>` : ''}<span class="fl-k">${ic(FL_ICON[it.kind] || 'file', 12)}${esc(FL_LABEL[it.kind] || 'File')}</span>${tag ? `<span class="fl-tag">${esc(tag)}</span>` : ''}</div>
    ${check}
    <div class="fl-tx"><b>${esc(many ? flStackName(it) : it.title)}</b><div class="fl-by">${flWho(it.by)}<span class="fl-where">${esc(where)}</span>${size ? `<span class="fl-size" ${it.canvas || it.folder ? `title="${it.canvas ? 'The Canvas file' : 'The page’s index file'}"` : ''}>${esc(size)}</span>` : ''}${fav}${more}</div></div>
  </div>`;
}
const FL_SECTION_MOST = 60;
// Both Deleted lists identify an item from its preserved content, before Restore.
function deletedFileHTML(p, item, kind) {
  const image = item.preview?.kind === 'image' && item.preview.path, excerpt = item.preview?.kind === 'text' && item.preview.text;
  const title = item.title || 'File', type = item.fileType || (kind === 'canvases' ? 'Canvas' : 'File');
  const thumb = image ? `<button type="button" class="del-thumb" data-act="deleted-preview" data-kind="${kind}" data-removed="${esc(item.removed)}" aria-label="Preview ${esc(title)}"><img src="${esc(fileUrl(p, image))}" alt="" loading="lazy"><span class="del-thumb-missing" hidden>Preview unavailable</span></button>`
    : `<span class="del-kind" aria-hidden="true">${ic(kind === 'canvases' ? 'canvas' : FILE_ICON(item.path || ''), 24)}<small>${esc(type)}</small></span>`;
  const facts = [type, Number.isFinite(item.size) ? (item.size < 1024 ? `${item.size} B` : fvSize(item.size)) : '', `deleted ${agoWords(item.deletedAt)}`, daysLeft(item.goneAt)].filter(Boolean).join(' · ');
  return `<article class="del-row del-file-row">${thumb}<div class="del-main"><strong>${esc(title)}</strong>
    ${item.path || item.source ? `<span class="del-location">${esc(item.path || item.source)}</span>` : ''}
    ${excerpt ? `<p class="del-excerpt">${esc(excerpt)}</p>` : !image ? '<span class="del-unavailable">Preview unavailable</span>' : ''}
    <span>${esc(facts)}</span></div><div class="del-actions"><button type="button" class="btn sm" data-act="${kind === 'canvases' ? 'canvas-restore' : 'file-restore'}" data-removed="${esc(item.removed)}">Restore</button>
    ${!image && !excerpt && item.downloadPath ? `<a class="del-download" href="${esc(fileUrl(p, item.downloadPath, true))}" download>Download file</a>` : ''}</div></article>`;
}
let deletedPreviewAnchor = null;
function closeDeletedPreview() {
  closeLightbox();
  if (deletedPreviewAnchor?.isConnected) deletedPreviewAnchor.focus({ preventScroll:true });
  deletedPreviewAnchor = null;
}
ACT['deleted-preview'] = el => {
  const p = project(), item = ['files', 'canvases'].includes(el.dataset.kind) && p.deleted?.[el.dataset.kind]?.find(x => x.removed === el.dataset.removed);
  if (item?.preview?.kind !== 'image' || !item.preview.path) return;
  ++FV.opening;
  deletedPreviewAnchor = el;
  const b = $('#lightbox');
  b.innerHTML = `<div class="lb-card lb-image-card deleted-image-preview" role="dialog" aria-modal="true" aria-label="${esc(item.title)}"><header><strong>${esc(item.title)}</strong><button type="button" class="icon-btn" data-act="deleted-preview-close" aria-label="Close">${ic('x', 18)}</button></header>
    <div class="lb-image-viewport" tabindex="0" role="group" aria-label="Image preview. Scroll to zoom. Drag to move."><img src="${esc(fileUrl(p, item.preview.path))}" alt="${esc(item.title)}" draggable="false"></div>
    <div class="lb-image-tools"><span>Scroll to zoom · Drag to move</span><div class="lb-image-controls"><button type="button" class="btn sm" data-zoom="out" aria-label="Zoom out">${ic('minus', 16)}</button><output aria-label="Image zoom">100%</output><button type="button" class="btn sm" data-zoom="in" aria-label="Zoom in">${ic('plus', 16)}</button><button type="button" class="btn sm" data-zoom="fit">Fit</button></div></div></div>`;
  b.hidden = false;
  wireImagePreview($('.deleted-image-preview', b));
  $('[data-act="deleted-preview-close"]', b).focus();
};
ACT['deleted-preview-close'] = closeDeletedPreview;
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('.deleted-image-preview')) { e.preventDefault(); e.stopPropagation(); closeDeletedPreview(); }
}, true);
document.addEventListener('pointerdown', e => {
  if (e.target.id === 'lightbox' && $('.deleted-image-preview')) { e.stopPropagation(); closeDeletedPreview(); }
}, true);
document.addEventListener('error', e => {
  if (!e.target.matches?.('.del-thumb img')) return;
  e.target.hidden = true;
  const thumb = e.target.closest('.del-thumb'); thumb.disabled = true;
  $('.del-thumb-missing', thumb).hidden = false;
}, true);
function flBodyHTML(p) {
  const st = flState(), all = flItems(p), count = k => all.filter(it => k === 'all' || flGroup(it.kind) === k).length;
  const matching = new Set(flShown(p).map(it => it.key));
  for (const key of flSelected()) if (!matching.has(key)) flSelected().delete(key);
  const groups = new Map(), order = FL_KINDS.map(k => k[0]);
  const list = flStacked(flShown(p));
  for (const it of list) {
    const key = st.by === 'size' ? 'Largest first' : st.by === 'kind' ? flGroup(it.kind) : flTimeGroup(it.mtime);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  const entries = [...groups.entries()];
  if (st.by === 'kind') entries.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  const name = key => (st.by === 'kind' ? FL_KINDS.find(k => k[0] === key)?.[1] || key : key);
  const chips = FL_KINDS.map(([k, label, icon]) => { const n = count(k); return n || k === 'all' || st.kind === k ? `<button type="button" class="fl-chip ${st.kind === k ? 'on' : ''}" data-act="file-kind" data-kind="${k}" aria-pressed="${st.kind === k}">${ic(icon, 14)}${label} <em>${n}</em></button>` : ''; }).join('');
  const seg = (field, options) => `<div class="seg fl-seg" role="group">${options.map(([v, label]) => `<button type="button" data-act="file-${field}" data-v="${v}" aria-selected="${st[field] === v}" class="${st[field] === v ? 'on' : ''}">${label}</button>`).join('')}</div>`;
  // My Canvases: the names of old Canvas projects as a filter, as before (canvases.js).
  const labels = canvasGroups(p), cvGroups = labels.length && (st.kind === 'all' || st.kind === 'canvas') ? `<div class="cv-groups" role="group" aria-label="Show">
      <button type="button" class="cv-group ${S.cvGroup ? '' : 'on'}" data-act="canvas-group" data-group="" aria-pressed="${!S.cvGroup}">All</button>
      ${labels.map(g => `<button type="button" class="cv-group ${S.cvGroup === g ? 'on' : ''}" data-act="canvas-group" data-group="${esc(g)}" aria-pressed="${S.cvGroup === g}">${ic('files', 13)}${esc(g)}</button>`).join('')}
      ${S.cvGroup ? `<button type="button" class="btn sm cv-make" data-act="canvas-group-project">${ic('plus', 14)}Make ${esc(S.cvGroup)} a project</button>` : ''}</div>` : '';
  const sections = entries.map(([key, its]) => {
    const n = its.reduce((sum, it) => sum + (it.items ? it.items.length : 1), 0), open = st.openPlace === key, shown = open ? its : its.slice(0, FL_SECTION_MOST);
    return `<section class="fl-sec" data-group="${esc(key)}">${st.by === 'size' ? '' : `<h3>${esc(name(key))}<em>${n}</em></h3>`}<div class="fl-grid">${shown.map(it => flCardHTML(p, it)).join('')}</div>${its.length > shown.length ? `<button type="button" class="btn sm fl-all" data-act="file-section" data-group="${esc(key)}">Show all ${its.length}</button>` : ''}</section>`;
  }).join('');
  const goneCanvases = p.deleted?.canvases || [], goneFiles = p.deleted?.files || [];
  const gone = goneCanvases.length || goneFiles.length ? `<section class="cv-gone" aria-label="Deleted"><header class="sec-head"><h2>Deleted</h2></header>
    <p class="cv-gone-note">Each one leaves this list and is removed for good 7 days after it was deleted.</p>
    ${goneCanvases.map(g => deletedFileHTML(p, g, 'canvases')).join('')}
    ${goneFiles.map(g => deletedFileHTML(p, g, 'files')).join('')}</section>` : '';
  const shown = flShown(p), picked = flSelected().size, deletable = can('files') ? shown.filter(flSelectable) : [];
  const pick = (list, value) => list.find(([v]) => v === String(value || ''))?.[1];
  const filter = (id, field, label, list) => `<button type="button" id="${id}" class="fl-filter ${st[field] ? 'on' : ''}" data-act="file-filter" data-f="${field}" aria-haspopup="menu">${esc(st[field] ? pick(list, st[field]) : label)}${ic('down', 14)}</button>`;
  const sum = !picked && (st.size || st.usage || st.fav || st.q.trim()) ? `<div class="fl-sum"><span><b>${shown.length} ${shown.length === 1 ? 'file' : 'files'}</b> · ${flTotal(shown)}</span>${deletable.length ? `<button type="button" class="link" data-act="file-select-all">Select all</button>` : ''}</div>` : '';
  const chosen = flItems(p).filter(it => flSelected().has(it.key));
  const bar = picked ? `<div class="fl-selbar" role="region" aria-label="Selected files"><b>${picked} selected</b><span>${flTotal(chosen)}</span>
      ${deletable.some(it => !flSelected().has(it.key)) ? `<button type="button" class="btn sm ghost-b" data-act="file-select-all">Select all ${deletable.length}</button>` : ''}
      <button type="button" class="btn sm ghost-b" data-act="file-select-clear" ${st.deleting ? 'disabled' : ''}>Clear</button>
      <button type="button" class="btn sm fl-del" data-act="file-delete-selected" ${st.deleting ? 'disabled' : ''}>${ic('trash', 15)}${st.deleting ? 'Deleting…' : 'Delete'}</button></div>` : '';
  return `<div class="fl-kinds" role="group" aria-label="Kinds">${chips}</div>
    <div class="fl-tools">${seg('who', [['all', 'Everyone'], ['ai', 'Made by AI'], ['you', 'From you']])}
      ${can('favorites') ? `<button type="button" id="flFav" class="fl-filter fl-fav-filter ${st.fav ? 'on' : ''}" data-act="file-fav-filter" aria-pressed="${Boolean(st.fav)}">${ic('star', 14)}Favourites</button>` : ''}
      ${filter('flSize', 'size', 'Size', FL_SIZES)}${filter('flUsage', 'usage', 'Line status', FL_USAGES)}
      <span class="fl-sp"></span>
      <button type="button" id="flSort" class="fl-filter fl-sort" data-act="file-sort" aria-haspopup="menu">${esc(pick(FL_SORTS, st.by))}${ic('down', 14)}</button></div>
    ${sum}
    ${st.deleteError ? `<p class="fl-cleanup-note" role="alert">${esc(st.deleteError)}</p>` : ''}
    ${cvGroups}
    <div class="fl-list ${picked ? 'picking' : ''}">${sections || `<p class="empty-line">${flEmptyWords(p, all)}</p>`}</div>
    ${bar}
    ${gone}`;
}

// An empty list says why: a search or filter that matched nothing is not an empty collection.
function flEmptyWords(p, all) {
  const st = flState(), narrowed = st.q.trim() || st.size || st.usage || st.who !== 'all' || st.kind !== 'all';
  if (st.fav) return all.some(it => flIsFav(p, it.key)) ? 'No favourites match.' : 'No favourites yet.';
  return !all.length ? 'No Canvases or files yet.' : narrowed ? 'No files match.' : 'Nothing here.';
}
// The one chosen: as it is in the list (a stack included), or any single file, such as one picture of a stack.
function flChosen(p) {
  const key = flState().open; if (!key) return null;
  return flStacked(flShown(p)).find(it => it.key === key) || flItems(p).find(it => it.key === key) || null;
}
// Where the file came from on its line: its step among its neighbours, as small nodes.
function flMini(l, step) {
  const at = Math.max(0, l.stations.findIndex(s => s.id === step)), from = Math.max(0, Math.min(at - 3, l.stations.length - 7)), shown = l.stations.slice(from, from + 7);
  const colour = s => (s.kind === 'ask' || s.kind === 'note' || s.kind === 'canvas' || s.kind === 'meeting' ? 'var(--c-ask)' : 'var(--c-work)');
  return `<div class="fl-mini" aria-hidden="true">${shown.map((s, i) => `${i ? '<s></s>' : ''}<i class="${s.id === step ? 'hl' : ''}" style="border-color:${colour(s)}"></i>`).join('')}</div>`;
}
// Its kind, who made it and when, as the sheet and the viewer (files-view.js) say it.
function flMetaText(it) {
  const who = it.by === 'you' ? 'You' : agentInfo(it.by).name, verb = it.by === 'you' ? (it.kind === 'canvas' ? 'drew it' : 'added it') : 'made it';
  return `${FL_LABEL[it.kind] || 'File'} · ${who} ${verb} · ${flWhen(it.mtime)}`;
}
// The line and step it came from, a link to that step.
function flFromHTML(p, it) {
  const line = flLine(p, it), step = line && it.step ? stationById(line, it.step) : null;
  return line ? `<div class="fl-from"><span class="t">From the line</span><button type="button" class="link fl-line" data-act="file-line" data-line="${esc(line.id)}" data-step="${esc(step?.id || '')}">${esc(line.title)}</button>${step ? `${flMini(line, step.id)}<div class="fl-step">${esc(it.by === 'you' ? (step.kind === 'ask' ? 'Added with your Ask' : step.label) : `Made in ${step.label}`)}</div>` : ''}</div>` : '';
}
// A page opens from PenEcho: a folder at an address that keeps its shape, so what it loads by relative links is there.
const flPageUrl = (p, it) => (it.folder && !HOSTED ? `/api/lines/projects/${encodeURIComponent(p.id)}/page/${it.path.split('/').map(encodeURIComponent).join('/')}` : fileUrl(p, it.path));
// The sheet is for a link: what it is, where it was found, and the way to it. Everything else opens in the viewer.
function flSheetHTML(p, it) {
  const items = it.items || [it], many = items.length > 1;
  const big = it.pic ? `<img src="${esc(assetUrl(p, it.pic))}" alt="">` : `<span class="fl-mark big">${ic(FL_ICON[it.kind] || 'file', 38)}</span>`;
  const opens = it.canvas || it.kind === 'page' || it.kind === 'artifact' || it.kind === 'picture' || it.kind === 'meeting' || /\.(md|txt|html?)$/i.test(it.path);
  const openWord = it.kind === 'artifact' ? 'Open on claude.ai' : it.canvas ? 'Open Canvas' : 'Open';
  const acts = many ? '' : `<div class="fl-acts">
      ${opens ? `<button type="button" class="btn primary sm" data-act="file-open" data-key="${esc(it.key)}">${ic(it.kind === 'artifact' ? 'link' : it.canvas ? 'canvas' : 'eye', 15)}${openWord}</button>` : ''}
      ${it.kind === 'artifact' ? `<button type="button" class="btn sm" data-act="file-copy-link" data-key="${esc(it.key)}">${ic('copy', 15)}Copy link</button>` : it.canvas?.slides ? pptDownloadButton(it.canvas, 'btn sm') : `<a class="btn sm ${opens ? '' : 'primary'}" data-act="file-download" href="${esc(fileUrl(p, it.canvas ? it.canvas.path : it.path, true))}" download>${ic('download', 15)}Download</a>`}
      ${it.kind === 'artifact' ? '' : `<button type="button" class="btn sm" data-act="file-vault" data-key="${esc(it.key)}">${ic('vault', 15)}Show in Vault</button>`}
      ${flFavButton(p, it, `fl-dots fl-fav${flIsFav(p, it.key) ? ' on' : ''}`)}
      ${it.canvas ? `<button type="button" class="icon-btn fl-dots" data-act="canvas-menu" data-source="${esc(it.source)}" aria-label="More for ${esc(it.title)}" title="More">${ic('more', 17)}</button>` : it.kind === 'artifact' ? '' : `<button type="button" class="icon-btn fl-dots" data-act="file-menu" data-key="${esc(it.key)}" aria-label="More for ${esc(it.title)}" title="More">${ic('more', 17)}</button>`}
    </div>`;
  const strip = many ? `<div class="fl-strip">${items.map(x => `<button type="button" data-act="file-pick" data-key="${esc(x.key)}" title="${esc(x.title)}">${flStripThumb(p, x)}</button>`).join('')}</div>` : '';
  return `<div class="fl-big-wrap"><div class="fl-big ${it.pic ? 'has-pic' : flThumbClass(it.kind)}">${big}</div><button type="button" class="icon-btn fl-x" data-act="file-close" aria-label="Close">${ic('x', 16)}</button></div>
    <div class="fl-in"><h3>${esc(many ? flStackName(it) : it.title)}</h3><div class="fl-meta">${esc(flMetaText(it))}</div>
    ${acts}${strip}${flFromHTML(p, it)}
    ${many ? '' : `<dl class="fl-dl"><dt>${it.kind === 'artifact' ? 'Link' : 'Where'}</dt><dd class="fl-path">${esc(it.path)}</dd><dt>Kind</dt><dd>${esc(FL_LABEL[it.kind] || 'File')}</dd></dl>`}</div>`;
}

function canvasesHTML(p) {
  const st = flState(), place = `${p.id}:${S.route.view}`;
  // Coming in, not drawn again in place: #canvases opens on Canvases, the tab on everything.
  // Coming back to a file you were looking at (files-view.js), the page is as you left it and the viewer opens on it again.
  if (st.entered !== place || !$('#flBody')) {
    const back = fvBackTo(place);
    if (back && st.entered === place) st.open = null;
    else Object.assign(st, { kind:S.route.view === 'canvases' ? 'canvas' : 'all', open:null, q:'', openPlace:'', entered:place, selected:new Set(), size:'', usage:'', fav:false, deleteError:'' });
  }
  requestAnimationFrame(fvPendingTry);
  const chosen = flChosen(p);
  const body = flBodyHTML(p);
  requestAnimationFrame(() => {
    // Record the first drawing too, so an unchanged poll leaves running previews alone.
    if (project() === p && $('#flBody')) { $('#flBody').dataset.h ||= body; flPreviewMount(); }
  });
  requestAnimationFrame(flTop);
  if (!chosen) st.open = null;
  return `<div class="page canvases-page fl-page"><div class="fl-wrap">
    <div class="fl-main">
      <header class="fl-bar"><h2>${p.myCanvases ? 'My Canvases' : 'Canvases &amp; files'}</h2><label class="fl-search">${ic('search', 15)}<input id="flQ" type="text" inputmode="search" placeholder="Find a file" aria-label="Find a file" value="${esc(st.q)}" autocomplete="off" spellcheck="false"></label><span class="fl-sp"></span>
        ${p.myCanvases ? `<button type="button" class="btn sm" data-act="canvas-library">${ic('archive', 15)}Bring in from the Library</button>${HOSTED ? '<button type="button" class="btn sm" data-act="hosted-library">Open Library</button>' : ''}` : ''}
        ${can('files') ? `<button type="button" class="btn sm" data-act="file-add">${ic('plus', 15)}Add files</button>` : ''}
        <button type="button" class="btn primary sm" data-act="new-canvas">${ic('plus', 15)}New canvas</button></header>
      <div id="flBody">${body}</div>
    </div>
    <aside class="fl-sheet" id="flSheet" ${chosen ? '' : 'hidden'} aria-label="${esc(chosen?.title || 'File')}">${chosen ? flSheetHTML(p, chosen) : ''}</aside>
  </div></div>`;
}
function flRedraw({ body = true, sheet = true } = {}) {
  const p = project(), host = $('#flBody'); if (!p || !host) return;
  flItems.cache = null;
  if (body) { const next = flBodyHTML(p); if (host.dataset.h !== next) { host.innerHTML = next; host.dataset.h = next; } flPreviewMount(); }
  if (sheet) {
    const el = $('#flSheet'), it = flChosen(p);
    if (!it) flState().open = null;
    const next = it ? flSheetHTML(p, it) : '';
    if (el.dataset.h !== next) { el.innerHTML = next; el.dataset.h = next; }
    el.hidden = !it;
    if (it) el.setAttribute('aria-label', it.title);
  }
}
// The folder changed (the poll): the list is drawn again where it is, only if it differs, so the place and the search box stay.
function refreshFiles() { if ($('#flBody')) { flRedraw(); fvRefresh(); } }

// Size, Line status and order are menus, like every other choice in Lines.
ACT['file-filter'] = el => {
  const st = flState(), field = el.dataset.f, list = field === 'size' ? FL_SIZES : FL_USAGES;
  openMenu(el, list.map(([v, label]) => ({ label, note:field === 'usage' ? FL_USAGE_NOTES[v] || '' : '', on:String(st[field] || '') === v, fn:() => {
    st[field] = v; flSelected().clear(); st.openPlace = ''; flRedraw(); $(`#${el.id}`)?.focus({ preventScroll:true });
  } })));
};
ACT['file-sort'] = el => openMenu(el, FL_SORTS.map(([v, label]) => ({ label, on:flState().by === v, fn:() => { flState().by = v; flRedraw(); $('#flSort')?.focus({ preventScroll:true }); } })), { align:'right' });
ACT['file-select'] = el => {
  if (!can('files') || flState().deleting) return;
  const p = project(), it = flStacked(flShown(p)).find(x => x.key === el.dataset.key);
  if (!it) return;
  const items = (it.items || [it]).filter(flSelectable), selected = flSelected(), remove = items.every(x => selected.has(x.key));
  for (const item of items) { if (remove) selected.delete(item.key); else selected.add(item.key); }
  flRedraw(); $(`.fl-select[data-key="${CSS.escape(items[0]?.key || '')}"]`)?.focus();
};
ACT['file-select-all'] = () => { if (can('files') && !flState().deleting) { for (const it of flShown(project()).filter(flSelectable)) flSelected().add(it.key); flRedraw(); } };
ACT['file-select-clear'] = () => { if (!flState().deleting) { flSelected().clear(); flRedraw(); } };
// A successful operation can include another selected card (Canvas sources or page contents).
const flCovers = (operation, file) => operation.deletion?.folder
  ? file === operation.deletion.folder || file.startsWith(`${operation.deletion.folder}/`)
  : (operation.deletion?.files || [operation.path]).includes(file);
async function flUndoBatch(p, removed) {
  const failed = [];
  for (const item of [...removed].reverse()) {
    try { await api(`${pathFor(p.id)}/${item.kind}/restore`, { method:'POST', body:{ removed:item.removed } }); }
    catch (error) { failed.push(error.message); }
  }
  await afterCanvasChange(p);
  toast(failed.length ? `Some items could not be restored: ${failed.join('; ')}` : 'Selected files restored');
}
ACT['file-delete-selected'] = async () => {
  const p = project(), st = flState();
  if (!can('files') || st.deleting) return;
  const items = flItems(p).filter(it => flSelected().has(it.key) && flSelectable(it));
  const inUse = items.filter(it => it.usage === 'active').length;
  const them = inUse === 1 ? 'it' : 'them';
  const warn = !inUse ? 'Links from other files may stop working.' : `${items.length === 1 ? 'It is' : `${inUse} of ${items.length} ${inUse === 1 ? 'is' : 'are'}`} in use: Lines, Works and Topics that show ${them} will lose ${them}.`;
  if (!items.length || !confirm(`Delete ${items.length} selected item${items.length === 1 ? '' : 's'}? Associated Canvas source files and page-folder contents are included. Files remain recoverable in Deleted for 7 days. ${warn}`)) return;
  items.sort((a, b) => (a.canvas ? 0 : a.folder ? 1 : 2) - (b.canvas ? 0 : b.folder ? 1 : 2));
  st.deleting = true; st.deleteError = ''; flRedraw();
  const done = [], removed = []; let failure = '';
  try {
    for (const it of items) {
      const members = it.deletion?.files || [it.path];
      if (!it.folder && members.every(file => done.some(operation => flCovers(operation, file)))) { st.selected.delete(it.key); continue; }
      const kind = it.canvas ? 'canvases' : 'files';
      try {
        const result = await api(`${pathFor(p.id)}/${kind}/delete`, { method:'POST', body:{ path:it.path } });
        done.push(it); st.selected.delete(it.key);
        if (result.removed) removed.push({ kind, removed:result.removed });
      } catch (error) { failure = `${it.title}: ${needsNewServer(error)} Remaining items were not deleted.`; break; }
    }
    st.deleteError = failure;
    await afterCanvasChange(p);
    toast(failure || `${items.length} selected item${items.length === 1 ? '' : 's'} deleted`, removed.length ? { label:'Undo', fn:() => flUndoBatch(p, removed) } : null);
  } catch (error) { st.deleteError = `Refresh failed: ${error.message}`; }
  finally { st.deleting = false; flRedraw(); }
};
ACT['file-fav-filter'] = () => { const st = flState(); st.fav = !st.fav; flSelected().clear(); st.openPlace = ''; flRedraw(); $('#flFav')?.focus({ preventScroll:true }); };
async function flFavToggle(p, key) {
  if (!p || !key || !can('favorites')) return;
  const id = `${p.id}\n${key}`, on = !flIsFav(p, key), mark = { on, done:false };
  flFavPending.set(id, mark);
  flRedraw(); fvRefresh(); lbFavRefresh(p);
  try { await api(pathFor(p.id), { method:'PATCH', body:{ favorite:{ path:key, on } } }); mark.done = true; }
  catch (error) { if (flFavPending.get(id) === mark) flFavPending.delete(id); flRedraw(); fvRefresh(); lbFavRefresh(p); toast(needsNewServer(error)); }
}
// The star you pressed keeps the focus after the page is drawn again.
ACT['file-fav'] = el => {
  const scope = el.closest('.fv-side') ? '#lightbox .fv-side' : el.closest('.lb-fav') ? '#lightbox .lb-card > header' : el.closest('.fl-sheet') ? '#flSheet' : '#flBody', key = el.dataset.key;
  flFavToggle(project(), key);
  $(`${scope} [data-act="file-fav"][data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll:true });
};
ACT['file-kind'] = el => { flSelected().clear(); flState().kind = el.dataset.kind; flState().openPlace = ''; flRedraw(); };
ACT['file-who'] = el => { flSelected().clear(); flState().who = el.dataset.v; flRedraw(); };
ACT['file-by'] = el => { flState().by = el.dataset.v; flRedraw(); };
ACT['file-section'] = el => { flState().openPlace = el.dataset.group; flRedraw({ sheet:false }); };
ACT['file-pick'] = (el, e) => {
  if (e?.target?.closest?.('.fl-more, .fl-select, .fl-fav')) return;
  const p = project(), st = flState(), it = flStacked(flShown(p)).find(x => x.key === el.dataset.key) || flItems(p).find(x => x.key === el.dataset.key);
  // While choosing files, a click on a card chooses it too, as in a photo library.
  if (flSelected().size && it && can('files') && (it.items || [it]).every(flSelectable)) { ACT['file-select'](el); return; }
  // Anything but a link is looked at in the viewer, over the page (files-view.js); a stack opens on its first picture.
  if (it && it.kind !== 'artifact') {
    if (st.open) { st.open = null; flRedraw(); }
    fvOpen(p, (it.items?.[0] || it).key);
    return;
  }
  st.open = st.open === el.dataset.key && el.closest('.fl-grid') ? null : el.dataset.key;
  flRedraw();
  $('#flSheet:not([hidden]) .fl-x')?.focus({ preventScroll:true });
};
ACT['file-close'] = () => { const key = flState().open; flState().open = null; flRedraw(); if (key) $(`.fl-card[data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll:true }); };
const flByKey = key => flItems(project()).find(it => it.key === key) || flChosen(project());
function flOpen(p, it, from) {
  if (!it) return;
  if (it.canvas) { openCanvasPage(canvasUrl(p, { source:it.source, doc:it.canvas.topic ? `lines/${it.canvas.topic}.md` : '', title:it.title }), from); return; }
  if (it.kind === 'artifact') { window.open(it.url, '_blank', 'noopener'); return; }
  if (it.kind === 'page') { window.open(flPageUrl(p, it), '_blank', 'noopener'); return; }
  if (/\.md$/i.test(it.path)) { openDoc(it.path, from); return; }
  openLightbox(p, it.pic || it.path);
}
ACT['file-open'] = el => flOpen(project(), flByKey(el.dataset.key), el);
ACT['file-copy-link'] = el => { const it = flByKey(el.dataset.key); if (it?.url) writeClipboard(it.url).then(ok => toast(ok ? 'Copied the link' : 'Could not copy')); };
// A double-click on a card opens it, as on a desktop.
document.addEventListener('dblclick', e => {
  const card = e.target.closest?.('.fl-card'); if (!card || e.target.closest('button')) return;
  const p = project(), it = flByKey(card.dataset.key);
  if (it && !it.items) flOpen(p, it, card);
});
document.addEventListener('keydown', e => {
  const card = e.target.closest?.('.fl-card');
  if (card && (e.key === 'Enter' || e.key === ' ') && e.target === card) { e.preventDefault(); ACT['file-pick'](card, e); }
  if (e.key === 'Escape' && flState().open && $('#flSheet') && !$('#menu') && $('#lightbox').hidden && !$('dialog[open]')) { e.preventDefault(); ACT['file-close'](); }
});
document.addEventListener('input', e => {
  if (e.target.id !== 'flQ') return;
  flSelected().clear(); flState().q = e.target.value;
  flRedraw();
});
ACT['file-vault'] = el => {
  const p = project(), it = flByKey(el.dataset.key); if (!it) return;
  S.vaultSel[p.id] = it.canvas ? it.canvas.path : it.path;
  go({ view:'vault' });
  // The folders down to it open, and it comes into sight.
  const row = $(`#vaultTree .tree-file[data-path="${CSS.escape(S.vaultSel[p.id])}"]`);
  const dirs = ((S.vaultDirs ||= Object.create(null))[p.id] ||= Object.create(null));
  for (let d = row?.parentElement; d && d.id !== 'vaultTree'; d = d.parentElement) if (d.tagName === 'DETAILS') { d.open = true; if (d.dataset.dir) dirs[d.dataset.dir] = true; }
  row?.scrollIntoView({ block:'center' });
};
ACT['file-line'] = el => go({ view:'line', line:el.dataset.line, ...(el.dataset.step ? { step:el.dataset.step } : {}) });
ACT['file-download'] = () => {};   // The link downloads by itself; this only keeps the click from being taken for something else.
ACT['file-add'] = () => {
  const input = document.createElement('input');
  input.type = 'file'; input.multiple = true; input.hidden = true;
  input.onchange = async () => {
    const p = project(), picked = [...input.files].map(f => ({ name:f.name, blob:f, type:f.type }));
    input.remove();
    if (!picked.length) return;
    try {
      toast(picked.length === 1 ? `Adding ${picked[0].name}` : `Adding ${picked.length} files`);
      const saved = await uploadFiles(p, picked, 'files/added');
      await afterCanvasChange(p);
      if (saved.length === 1 && fvItem(project(), saved[0].path)) fvOpen(project(), saved[0].path);
      toast(saved.length === 1 ? `${saved[0].name} added` : `${saved.length} files added`);
    } catch (error) { toast(error.message); }
  };
  document.body.append(input);
  input.click();
};
function fileRename(p, it, anchor) {
  const dialog = document.createElement('dialog');
  dialog.className = 'line-command-dialog';
  dialog.setAttribute('aria-labelledby', 'fileCommandTitle');
  const ext = it.folder ? '' : (/\.[^./]+$/.exec(it.path) || [''])[0], stem = it.folder ? it.title : flBase(it.path).slice(0, flBase(it.path).length - ext.length);
  dialog.innerHTML = `<form><h2 id="fileCommandTitle">Rename</h2><label for="fileNameInput">Name</label><div class="fl-name-row"><input id="fileNameInput" maxlength="140" value="${esc(stem)}" autocomplete="off" required>${ext ? `<span class="fl-ext">${esc(ext)}</span>` : ''}</div><p class="command-error" role="alert" hidden></p><div class="command-actions"><button type="button" class="btn" data-cancel>Cancel</button><button type="submit" class="btn primary">Save</button></div></form>`;
  document.body.append(dialog);
  dialog.addEventListener('close', () => { dialog.remove(); if (anchor?.isConnected) anchor.focus(); });
  $('[data-cancel]', dialog).onclick = () => dialog.close();
  $('form', dialog).onsubmit = async e => {
    e.preventDefault(); const submit = $('button[type="submit"]', dialog); submit.disabled = true;
    try {
      const done = await api(`${pathFor(p.id)}/files/rename`, { method:'POST', body:{ path:it.path, name:$('input', dialog).value } });
      dialog.close();
      // Renamed from the viewer, the viewer stays on it under its new name.
      if (fvShown() && FV.key === it.path) FV.key = done.path; else if (flState().open) flState().open = done.path;
      await afterCanvasChange(p);
    } catch (error) { const message = $('.command-error', dialog); message.hidden = false; message.textContent = needsNewServer(error); submit.disabled = false; }
  };
  dialog.showModal();
  $('input', dialog).select();
}
async function restoreFile(p, removed) {
  try { await api(`${pathFor(p.id)}/files/restore`, { method:'POST', body:{ removed } }); await afterCanvasChange(p); }
  catch (error) { toast(needsNewServer(error)); }
}
ACT['file-restore'] = el => restoreFile(project(), el.dataset.removed);
ACT['file-menu'] = el => {
  const p = project(), it = flByKey(el.dataset.key); if (!it) return;
  if (!can('files')) return;
  openMenu(el, [
    { label:'Rename', icon:'pen', fn:() => fileRename(p, it, el) },
    { sep:true },
    { label:'Delete', icon:'trash', fn:() => fileDelete(p, it) },
  ], { align:'right' });
};
async function fileDelete(p, it) {
  try {
    const { removed } = await api(`${pathFor(p.id)}/files/delete`, { method:'POST', body:{ path:it.path } });
    flState().open = null;
    await afterCanvasChange(p);
    toast(`${it.title} deleted`, removed ? { label:'Undo', fn:() => restoreFile(p, removed) } : null);
  } catch (error) { toast(needsNewServer(error)); }
}
// The sheet sits under the project bar, as tall as the page that scrolls beside it.
const flTop = () => { const v = $("#view"); if (v) document.documentElement.style.setProperty("--fl-top", `${Math.round((typeof pageRect === "function" ? pageRect(v) : v.getBoundingClientRect()).top)}px`); };
addEventListener("resize", flTop);
addEventListener("penecho:page-scale-change", flTop);
