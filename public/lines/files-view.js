// Canvases & files: the viewer (PE-323). A picture, a Canvas, a page or a document is looked at over the page, and Escape is back where you were.
// The picture zooms and moves as in every other preview (wireImagePreview, pages.js); the panel on its right says where it came from and what can be done.
// ← and → go through what the page shows. A link still opens in the sheet (files.js). Gone to a Canvas, a line or a document from here,
// the browser's Back, or the Canvas's way back, opens the viewer again on the same file.
const FV = { key:'', place:'', hash:'', mtime:0, i:0, opening:0, home:null, scope:null };
const FV_BACK = 'penecho-files-back';
const FV_ON_SEL = '.fl-card.fv-on, #panoRows .st-pic.fv-on, .lp-out.fv-on, .line-page-open.fv-on';
const fvEscape = s => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : String(s));
const fvShown = () => Boolean(FV.key && $('#lightbox:not([hidden]) > .fv'));
const fvIsPic = path => /\.(png|jpe?g|gif|webp|svg)$/i.test(path || '');
// Plain text is read as it is, in a fixed-width page; a very long file shows its start.
const fvIsText = path => /\.(txt|text|log)$/i.test(path || '');
const FV_TEXT_MAX = 1024 * 1024;
async function fvLoadText(p, path) {
  const res = await fetch(fileUrl(p, path), { credentials:'same-origin' });
  if (!res.ok) throw new Error('Could not read this file.');
  const blob = await res.blob(), cut = blob.size > FV_TEXT_MAX;
  return { text:await (cut ? blob.slice(0, FV_TEXT_MAX) : blob).text(), cut };
}
// What ← and → go through: everything the page shows, or the scoped section/Home list, a stack as its pictures, links left to the sheet.
function fvList(p) {
  const scoped = FV.home || FV.scope;
  if (!scoped) return flStacked(flShown(p)).flatMap(it => it.items || [it]).filter(it => it.kind !== 'artifact');
  const out = [], seen = new Set();
  for (const key of scoped.keys || []) {
    const it = fvItem(p, key);
    if (!it || it.kind === 'artifact' || seen.has(it.key)) continue;
    seen.add(it.key);
    out.push(it);
  }
  return out;
}
const fvItem = (p, key) => flItems(p).find(it => it.key === key || it.pic === key) || null;
// The other pictures pasted with this one, as the page stacks them.
const fvStack = (p, key) => (FV.home || FV.scope) ? [] : flStacked(flShown(p)).find(it => it.items?.some(x => x.key === key))?.items || [];

// Home starts with a lighter state, without the file's maker or its exact node. Read those only when a picture is opened.
async function fvOpenHome(p, key, { line = '', step = '' } = {}) {
  if (!p) return;
  const opening = ++FV.opening, hash = location.hash, transition = navigationTransition;
  const keys = line ? [...new Set($$('#panoRows .hl-detail .st-pic').map(el => el.dataset.path))] : [];
  if (!keys.includes(key)) keys.push(key);
  const current = () => opening === FV.opening && S.cur === p.id && S.route.view === 'home' && !S.newPage && !S.shelfPage && location.hash === hash && navigationTransition === transition;
  try {
    // Even a state that lists the files may have a newer Home poll in flight. This read supersedes it.
    await loadState(p.id, { force:true, needs:{ parts:['files'], lines:line ? [line] : [] } });
    if (!current()) return;
    const full = project(p.id);
    if (!fvItem(full, key)) { toast('This picture is no longer available.'); return; }
    fvOpen(full, key, { home:{ keys, origin:key, line, step } });
  } catch (error) { if (current()) toast(error.message); }
}

function fvStageHTML(p, it) {
  const pic = it.pic && fvIsPic(it.pic) ? it.pic : '';
  if (pic) return `<div class="lb-image-viewport fv-view" tabindex="0" role="group" aria-label="${esc(it.title)}"><img src="${esc(assetUrl(p, pic))}" alt="${esc(it.title)}" draggable="false"></div>
    <div class="fv-zoom lb-image-controls"><button type="button" class="btn sm" data-zoom="out" aria-label="Zoom out">${ic('minus', 16)}</button><output aria-label="Zoom">100%</output><button type="button" class="btn sm" data-zoom="in" aria-label="Zoom in">${ic('plus', 16)}</button><button type="button" class="btn sm" data-zoom="fit">Fit</button></div>`;
  // A page runs where it cannot call anywhere, as it does in its own tab.
  if (it.kind === 'page') return `<iframe class="fv-frame" sandbox="allow-scripts" src="${esc(flPageUrl(p, it))}" title="${esc(it.title)}"></iframe>`;
  if (/\.md$/i.test(it.path)) return `<div class="fv-doc" tabindex="0"><div class="viewer-doc fv-doc-in" data-doc="${esc(it.path)}"></div></div>`;
  if (fvIsText(it.path)) return `<div class="fv-doc" tabindex="0"><pre class="fv-text" aria-label="${esc(it.title)}"></pre></div>`;
  return `<span class="fl-mark big">${ic(FL_ICON[it.kind] || FILE_ICON(it.path), 38)}</span>`;
}
const fvRevealLabel = () => (!HOSTED && S.thisComputer && (S.revealFileLabel || (/Finder/i.test(S.openFolderLabel || '') ? 'Reveal in Finder' : /Explorer/i.test(S.openFolderLabel || '') ? 'Show in File Explorer' : S.openFolderLabel ? 'Show in folder' : ''))) || '';
const fvDesktop = () => {
  if (HOSTED || typeof window === 'undefined') return false;
  if (window.penechoDesktop) return true;
  try { return Boolean(window.top && window.top !== window && window.top.penechoDesktop); } catch { return false; }
};
function fvSideHTML(p, it) {
  const md = /\.md$/i.test(it.path);
  const download = it.canvas?.slides ? pptDownloadButton(it.canvas, 'btn sm') : it.canvas && !it.canvas.hasPicture ? '' : `<a class="btn sm" href="${esc(fileUrl(p, it.canvas ? it.canvas.path : it.path, true))}" download>${ic('download', 15)}Download</a>`;
  const open = it.canvas ? `<button type="button" class="btn primary fv-open" data-act="fv-canvas">${ic('canvas', 16)}Open Canvas</button>`
    : it.kind === 'page' ? `<button type="button" class="btn primary fv-open" data-act="fv-tab">${fvDesktop() ? `Open in browser${ic('arrow', 15)}` : `${ic('expand', 16)}Open in a new tab`}</button>`
    : md ? `<button type="button" class="btn primary fv-open" data-act="fv-doc">${ic('doc', 16)}Open</button>` : '';
  const revealLabel = it.kind !== 'artifact' && it.path && !/^https?:\/\//i.test(it.path) ? fvRevealLabel() : '';
  const reveal = revealLabel ? `<button type="button" class="btn sm" data-act="fv-reveal" title="${esc(revealLabel)}">${ic('filesOpen', 15)}${esc(revealLabel)}</button>` : '';
  const stack = fvStack(p, it.key), strip = stack.length > 1 ? `<div class="fl-strip fv-strip">${stack.map(x => `<button type="button" class="${x.key === it.key ? 'on' : ''}" data-act="fv-go" data-key="${esc(x.key)}" title="${esc(x.title)}" aria-pressed="${x.key === it.key}">${flStripThumb(p, x)}</button>`).join('')}</div>` : '';
  return `<header class="fv-head"><h3>${esc(it.title)}</h3>${flFavButton(p, it, `fv-fav fl-fav${flIsFav(p, it.key) ? ' on' : ''}`)}<button type="button" class="icon-btn fv-more" data-act="fv-more" ${it.canvas ? `data-source="${esc(it.source)}"` : ''} aria-label="More for ${esc(it.title)}" title="More">${ic('more', 17)}</button><button type="button" class="icon-btn fv-x" data-act="fv-close" aria-label="Close">${ic('x', 18)}</button></header>
    <div class="fv-in"><div class="fl-meta">${esc(flMetaText(it))}</div>
    ${open}
    <div class="fl-acts fv-acts">${download}<button type="button" class="btn sm" data-act="fv-copy"${md ? ' aria-label="Copy Markdown" title="Copy Markdown"' : ''}>${ic('copy', 15)}Copy</button>${it.canvas || can('files') ? `<button type="button" class="btn sm" data-act="fv-delete" title="Move to Deleted">${ic('trash', 15)}Delete</button>` : ''}${reveal}</div>
    ${strip}${flFromHTML(p, it)}
    <dl class="fl-dl"><dt>Where</dt><dd class="fl-path">${esc(it.path)}</dd>${it.size ? `<dt>Size</dt><dd>${esc(fvSize(it.size))}</dd>` : ''}</dl></div>`;
}
const fvSize = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const fvNavHTML = (list, i) => (list.length > 1 && i >= 0
  ? `<button type="button" class="fv-nav prev" data-act="fv-step" data-d="-1" aria-label="Previous">${ic('left', 20)}</button><button type="button" class="fv-nav next" data-act="fv-step" data-d="1" aria-label="Next">${ic('right', 20)}</button><span class="fv-count" aria-label="${i + 1} of ${list.length}">${i + 1} / ${list.length}</span>`
  : '');

function fvPaint(p, it) {
  const list = fvList(p), i = list.findIndex(x => x.key === it.key), b = $('#lightbox'), side = fvSideHTML(p, it), nav = fvNavHTML(list, i);
  Object.assign(FV, { key:it.key, mtime:it.mtime || 0, i:Math.max(0, i) });
  b.innerHTML = `<div class="fv" role="dialog" aria-modal="true" aria-label="${esc(it.title)}">
    <div class="fv-stage ${it.pic ? 'has-pic' : flThumbClass(it.kind)}">${fvStageHTML(p, it)}${nav}</div>
    <aside class="fv-side" aria-label="About ${esc(it.title)}">${side}</aside></div>`;
  b.hidden = false;
  $('.fv-side', b).dataset.h = side;
  const stage = $('.fv-stage', b);
  if (stage) stage.dataset.nav = nav;
  if ($('.fv-view', stage)) wireImagePreview(stage, { copyImage:true });
  const doc = $('.fv-doc-in', stage);
  if (doc) loadDoc(p, it.path).then(d => { if (doc.isConnected) doc.innerHTML = renderMd(d.md, p, { compact:true, doc:d }); }, error => { if (doc.isConnected) doc.textContent = error.message; });
  const text = $('.fv-text', stage);
  if (text) fvLoadText(p, it.path).then(({ text:t, cut }) => { if (text.isConnected) text.textContent = cut ? `${t}\n\n… Only the first 1 MB is shown. Download the file to read all of it.` : t; }, error => { if (text.isConnected) text.textContent = error.message; });
  // The card under it stays the one you are on, so closing lands there.
  $$(FV_ON_SEL).forEach(c => c.classList.remove('fv-on'));
  fvCard(it.key)?.classList.add('fv-on');
}
// A picture of a stack is not a card of its own: its stack is.
function fvCard(key, ctx = {}) {
  const p = project();
  const home = 'home' in ctx ? ctx.home : FV.home;
  const scope = 'scope' in ctx ? ctx.scope : FV.scope;
  if (home?.line) {
    const path = fvItem(p, key)?.pic || key, origin = key === home.origin || path === home.origin;
    const row = origin ? `.hl-row[data-row="${fvEscape(home.line)}"] ` : '';
    const step = origin ? `[data-step="${fvEscape(home.step)}"]` : '';
    const picture = $(`#panoRows ${row}.hl-detail .st-pic[data-path="${fvEscape(path)}"]${step}`);
    if (picture) return picture;
  }
  if (scope?.kind === 'outputs') {
    const path = fvItem(p, key)?.path || key;
    const work = scope.step ? `#lpThread .lp-work[data-step="${fvEscape(scope.step)}"] ` : '#lpThread ';
    return $(`${work}.lp-outs .lp-out[data-path="${fvEscape(path)}"]:not([data-code]):not([data-kind="artifact"]):not([data-kind="line"])`);
  }
  if (scope?.kind === 'made') return $(`.made .made-open[data-path="${fvEscape(fvItem(p, key)?.path || key)}"], .made .made-open[data-path="${fvEscape(fvItem(p, key)?.pic || key)}"]`);
  if (scope?.kind === 'pages') {
    const path = fvItem(p, key)?.path || key;
    const host = scope.container === 'panel'
      ? (scope.step ? `#lpPanel[data-step="${fvEscape(scope.step)}"] .result-pics ` : '#lpPanel .result-pics ')
      : (scope.step ? `#lpThread #item-${fvEscape(scope.step)} ` : '#lpThread ');
    return $(`${host}.line-page-open[data-act="open-page"][data-path="${fvEscape(path)}"]`);
  }
  const card = $(`.fl-card[data-key="${fvEscape(key)}"]`); if (card) return card;
  const stack = flStacked(flShown(p)).find(s => s.items?.some(x => x.key === key));
  return stack ? $(`.fl-card[data-key="${fvEscape(stack.key)}"]`) : null;
}
function fvFocusCard(key, ctx = {}) {
  const home = 'home' in ctx ? ctx.home : FV.home;
  const scope = 'scope' in ctx ? ctx.scope : FV.scope;
  const card = key && (fvCard(key, { home, scope }) || (home && fvCard(home.origin, { home, scope })) || (scope?.origin && fvCard(scope.origin, { home, scope })));
  if (card) { card.scrollIntoView({ block:'nearest' }); card.focus({ preventScroll:true }); }
}

function fvOpen(p, key, { home = null, scope = null } = {}) {
  ++FV.opening;
  const it = fvItem(p, key); if (!p || !it) return;
  closeMenu();
  Object.assign(FV, { place:`${p.id}:${S.route.view}`, hash:location.hash, home, scope });
  fvPaint(p, it);
  $('#lightbox .fv-x')?.focus({ preventScroll:true });
}
function fvClose({ focus = true } = {}) {
  ++FV.opening;
  const key = FV.key, home = FV.home, scope = FV.scope;
  FV.key = '';
  FV.home = null;
  FV.scope = null;
  closeLightbox();
  $$(FV_ON_SEL).forEach(c => c.classList.remove('fv-on'));
  if (focus) fvFocusCard(key, { home, scope });
}
function fvStep(d) {
  const p = project(), list = fvList(p); if (list.length < 2) return;
  const i = list.findIndex(x => x.key === FV.key), next = list[((i < 0 ? 0 : i + d) + list.length) % list.length];
  fvPaint(p, next);
  $(`#lightbox .fv-nav.${d < 0 ? 'prev' : 'next'}`)?.focus({ preventScroll:true });
}
// The folder changed: a file drawn again shows its new picture, a deleted one gives way to its neighbour.
function fvRefresh() {
  fvPendingTry();
  if (!fvShown()) return;
  const p = project(), it = fvItem(p, FV.key);
  if (!it) { const list = fvList(p), next = list[Math.min(FV.i, list.length - 1)]; if (next) fvPaint(p, next); else fvClose({ focus:false }); return; }
  if ((it.mtime || 0) !== FV.mtime) { fvPaint(p, it); return; }
  const card = fvCard(it.key);
  if (card && !card.classList.contains('fv-on')) { $$(FV_ON_SEL).forEach(c => c.classList.remove('fv-on')); card.classList.add('fv-on'); }
  const list = fvList(p), i = list.findIndex(x => x.key === it.key), stage = $('#lightbox .fv-stage'), nextNav = fvNavHTML(list, i);
  FV.i = Math.max(0, i);
  if (stage && stage.dataset.nav !== nextNav) {
    const focusedNav = stage.contains(document.activeElement) ? document.activeElement.classList.contains('prev') ? 'prev' : document.activeElement.classList.contains('next') ? 'next' : '' : '';
    $$('.fv-nav, .fv-count', stage).forEach(n => n.remove());
    if (nextNav) stage.insertAdjacentHTML('beforeend', nextNav);
    stage.dataset.nav = nextNav;
    if (focusedNav) $(`.fv-nav.${focusedNav}`, stage)?.focus({ preventScroll:true });
  }
  const side = $('#lightbox .fv-side'), html = fvSideHTML(p, it);
  if (!side || side.dataset.h === html || $('#menu')) return;
  // The button you were on is the one you are on after.
  const on = side.contains(document.activeElement) ? document.activeElement.dataset.act : '';
  side.innerHTML = html; side.dataset.h = html;
  if (on) $(`[data-act="${on}"]`, side)?.focus({ preventScroll:true });
}
// Copy: a picture as a picture, a Markdown file as Markdown, anything else as the file itself (as Finder copies it), else where it is.
async function fvCopy(p, it) {
  const pic = it.pic && /\.(png|jpe?g|webp|gif)$/i.test(it.pic) ? it.pic : '';
  if (pic && await writeImageClipboard(assetUrl(p, pic))) {
    toast('Copied the picture');
    return;
  }
  if (/\.md$/i.test(it.path) && typeof loadDoc === 'function' && typeof copyText === 'function') {
    try {
      const doc = await loadDoc(p, it.path);
      if (doc) { await copyText(doc.md, 'Copied the Markdown'); return; }
    } catch (error) { toast(error.message); return; }
  }
  const path = pic || it.path;
  if (!it.folder && await pasteboard({ paths:[path] })) { toast(`Copied ${flBase(path)}`); return; }
  toast(await writeClipboard(docsFile(p, path)) ? 'Copied where it is' : 'Could not copy');
}

const fvNow = () => { const p = project(); return p && FV.key ? { p, it:fvItem(p, FV.key) } : {}; };
ACT['home-picture'] = el => fvOpenHome(project(), el.dataset.path, el.dataset);
ACT['fv-close'] = () => fvClose();
ACT['fv-step'] = el => fvStep(+el.dataset.d);
ACT['fv-go'] = el => { const p = project(), it = fvItem(p, el.dataset.key); if (it) fvPaint(p, it); };
ACT['fv-canvas'] = () => { const { p, it } = fvNow(); if (it?.canvas) openCanvasPage(canvasUrl(p, { source:it.source, doc:it.canvas.topic ? `lines/${it.canvas.topic}.md` : '', title:it.title }), $('#lightbox .fv-view img')); };
ACT['fv-tab'] = () => { const { p, it } = fvNow(); if (it) window.open(flPageUrl(p, it), '_blank', 'noopener'); };
ACT['fv-doc'] = () => { const { it } = fvNow(); if (it) openDoc(it.path); };
ACT['fv-copy'] = () => { const { p, it } = fvNow(); if (it) return fvCopy(p, it); };
ACT['fv-reveal'] = async el => {
  const { p, it } = fvNow();
  if (!it || HOSTED || !fvRevealLabel() || !it.path || it.kind === 'artifact' || el?.disabled) return;
  if (el) el.disabled = true;
  try {
    await api(`${pathFor(p.id)}/files/reveal`, { method:'POST', body:{ path:it.path } });
  } catch (error) {
    toast(error.status === 404 && !error.code ? 'Restart PenEcho to reveal files from here.' : error.message);
  } finally {
    if (el) el.disabled = false;
  }
};
ACT['fv-delete'] = async el => {
  const { p, it } = fvNow(); if (!it || (!it.canvas && !can('files')) || el.disabled) return;
  el.disabled = true;
  try {
    await (it.canvas ? canvasDelete(p, it.canvas) : fileDelete(p, it));
    fvRefresh();
  }
  finally {
    el.disabled = false;
    if (!el.isConnected) (fvShown() ? $('#lightbox .fv-x') : $('.subnav [data-view="deleted"], .subnav-more'))?.focus({ preventScroll:true });
  }
};
ACT['fv-more'] = el => {
  const { p, it } = fvNow(); if (!it) return;
  if (it.canvas) { ACT['canvas-menu'](el); return; }
  if (!can('files')) return;
  openMenu(el, [
    { label:'Show in Vault', icon:'files', fn:() => ACT['file-vault']({ dataset:{ key:it.key } }) },
    { label:'Rename', icon:'pen', fn:() => fileRename(p, it, el) },
  ], { align:'right' });
};

// Escape, ← and → belong to the viewer while it is open, before the page and the picture take them.
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') ++FV.opening;
  if (!fvShown() || $('#menu') || $('dialog[open]') || e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fvClose(); return; }
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); fvStep(e.key === 'ArrowLeft' ? -1 : 1); }
}, true);
// A click beside it closes it, as with every preview, and the card you came from is where you are.
document.addEventListener('pointerdown', e => {
  if (e.target.id === 'lightbox' && fvShown()) {
    const { key, home, scope } = FV;
    fvClose({ focus:false });
    setTimeout(() => { if (!fvShown()) fvFocusCard(key, { home, scope }); }, 0);
  }
}, true);
// Leaving from the viewer, it is remembered, so Back opens it again.
addEventListener('hashchange', () => {
  ++FV.opening;
  S.flViaBack = location.hash !== S.hashWrite ? { hash:location.hash } : null;
  if (fvShown() && location.hash !== FV.hash) { S.flBack = { place:FV.place, key:FV.key, hash:FV.hash, scope:FV.scope }; fvClose({ focus:false }); }
});
// The Canvas is a page of its own: what was open is kept for its way back.
addEventListener('pagehide', () => { if (fvShown()) try { sessionStorage.setItem(FV_BACK, JSON.stringify({ place:FV.place, key:FV.key, hash:FV.hash, scope:FV.scope, at:Date.now() })); } catch { /* Back only opens the page. */ } });
addEventListener('pageshow', e => { if (e.persisted) { try { sessionStorage.removeItem(FV_BACK); } catch { /* Nothing kept. */ } setTimeout(fvRefresh, 800); } });
// Not in the rail or the panel beside the Canvas: they share this storage and would take it first.
if (!EMBED) try {
  const back = JSON.parse(sessionStorage.getItem(FV_BACK) || 'null');
  sessionStorage.removeItem(FV_BACK);
  if (back?.key && Date.now() - back.at < 36e5) { S.flBack = { place:back.place, key:back.key, hash:back.hash || '', scope:back.scope || null }; S.flViaBack = { hash:location.hash }; }
} catch { /* Back only opens the page. */ }
// Asked by Home, lineHTML and canvasesHTML when drawn anew: the file to open again, if you came back to it.
function fvBackTo(place) {
  const samePlace = S.flBack?.place === place && (!S.flBack.hash || S.flBack.hash === location.hash);
  const back = S.flViaBack?.hash === location.hash && samePlace ? S.flBack : null;
  if (back || S.flViaBack || samePlace) { S.flBack = null; S.flViaBack = null; }
  if (back?.key) FV.pending = { key:back.key, place, hash:back.hash || '', scope:back.scope || null, until:Date.now() + 15000 };
  return back?.key || '';
}
// A page loaded afresh first has the project without its files, so the file is opened once they are there.
function fvPendingTry() {
  const want = FV.pending, p = project(); if (!want || !p) return;
  if (Date.now() > want.until || `${p.id}:${S.route.view}` !== want.place || (want.hash && location.hash !== want.hash) || fvShown()) { FV.pending = null; return; }
  if (S.route.view === 'home' && ($('#pano') || $('#homeBelow'))) {
    FV.pending = null;
    fvOpenHome(p, want.key);
    return;
  }
  if (S.route.view === 'line') {
    if (!$('#linePage') || !fvItem(p, want.key)) return;
    FV.pending = null;
    fvOpen(p, want.key, want.scope ? { scope:want.scope } : {});
    return;
  }
  if (!$('#flBody') || !fvItem(p, want.key)) return;
  FV.pending = null;
  fvOpen(p, want.key);
}
