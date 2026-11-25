// A project's Canvases in one place, My Canvases at the top of the rail, and what can be done with a Canvas:
// open it, rename it, move it to another project, take it off its line, delete it and bring it back.
// The server side is "Canvases in projects" in docs/project-lines.md.
const myCanvases = () => S.projects.find(p => p.myCanvases);
const onProject = id => id === S.cur && !S.newPage && !S.shelfPage;
// Every Canvas of the project, newest first: anything with a Canvas file behind it, on a line or not.
const projectCanvases = p => (p.pictures || []).filter(c => c.source).sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
const canvasLine = (p, c) => c.topic ? allLines(p).find(l => l.slug === c.topic || l.id === c.topic) : null;
// A server from before Canvases had folders of their own answers 404 to all of this.
const needsNewServer = error => error.status === 404 ? 'Restart PenEcho to finish this update.' : error.message;

// A Canvas that sat in an old Canvas project keeps that project's name as a label. There are no Canvas projects:
// the label filters My Canvases, and one click makes it a project.
const canvasGroups = p => p.myCanvases ? [...new Set(projectCanvases(p).map(c => c.group).filter(Boolean))].sort((a, b) => a.localeCompare(b)) : [];
// The page itself, with every other file of the project, is in files.js (Canvases & files).
ACT['canvas-group'] = el => { S.cvGroup = el.dataset.group || ''; render(); };
ACT['canvas-group-project'] = async el => {
  const name = S.cvGroup; if (!name) return;
  el.disabled = true;
  try {
    const made = await api('/projects', { method:'POST', body:{ name, fromGroup:name, ...(HOSTED ? { personalGroup:true } : {}) } });
    S.cvGroup = '';
    await loadProjects();
    const there = made.project && S.projects.find(x => x.id === made.project.id);
    if (there) await switchProject(there.id, { view:'canvases', fresh:true }); else { await loadState(project().id, { force:true }); render(); }
    toast(`${name} is a project now${made.moved ? `, with ${made.moved} ${made.moved === 1 ? 'Canvas' : 'Canvases'}` : ''}${made.left ? `. ${made.left} stayed in My Canvases.` : ''}`);
  } catch (error) { el.disabled = false; toast(needsNewServer(error)); }
};

// The old Library's Canvases that are not in My Canvases yet: this PenEcho's own, and the account's in Cloud when signed in.
// Each is copied in; the Library's copy stays where it is.
ACT['canvas-library'] = async el => {
  const p = project(); if (!p?.myCanvases) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'line-command-dialog cv-library';
  dialog.setAttribute('aria-labelledby', 'canvasLibraryTitle');
  dialog.innerHTML = `<h2 id="canvasLibraryTitle">Bring in from the Library</h2><div class="cv-lib-list" aria-live="polite"><p class="cv-lib-note">Looking…</p></div><p class="command-error" role="alert" hidden></p><footer><button type="button" class="btn" data-cancel>Close</button><button type="button" class="btn primary" data-all hidden>Bring in all</button></footer>`;
  document.body.append(dialog);
  let brought = 0;
  dialog.addEventListener('close', async () => { dialog.remove(); if (el?.isConnected) el.focus(); if (brought) await afterCanvasChange(p); });
  $('[data-cancel]', dialog).onclick = () => dialog.close();
  dialog.showModal();
  const list = $('.cv-lib-list', dialog), all = $('[data-all]', dialog), problem = $('.command-error', dialog);
  // Which Canvas could not come in leads the message: Bring in all goes on past it to the rest.
  const say = (error, row) => { const name = row && $('strong', row)?.textContent; problem.hidden = false; problem.textContent = `${name ? `${name}: ` : ''}${needsNewServer(error)}`; };
  const bring = async row => {
    const button = $('button', row); button.disabled = true;
    try {
      await api(`${pathFor(p.id)}/canvases`, { method:'POST', body:{ from:row.dataset.from } });
      brought++; row.classList.remove('failed'); row.classList.add('done'); button.textContent = 'Here';
      return true;
    } catch (error) { button.disabled = false; row.classList.add('failed'); say(error, row); return false; }
  };
  try {
    const found = await api('/library'), waiting = (found.canvases || []).filter(c => !c.imported);
    if (!waiting.length) { list.innerHTML = `<p class="cv-lib-note">${found.cloud?.error ? 'PenEcho Cloud did not answer. ' : ''}Every Canvas in the Library is already here.</p>`; return; }
    list.innerHTML = waiting.map(c => `<div class="cv-lib-row" data-from="${esc(c.from)}">${ic(c.kept === 'cloud' ? 'cloud' : 'canvas', 15)}<strong>${esc(c.title || 'Canvas')}</strong><span>${esc(c.project?.name || '')}</span><button type="button" class="btn sm">Bring in</button></div>`).join('');
    list.onclick = event => { const row = event.target.closest('button') && event.target.closest('.cv-lib-row'); if (row && !row.classList.contains('done')) bring(row); };
    all.hidden = waiting.length < 2;
    all.onclick = async () => { all.disabled = true; for (const row of list.querySelectorAll('.cv-lib-row:not(.done)')) await bring(row); all.hidden = !list.querySelector('.cv-lib-row:not(.done):not(.failed)'); all.disabled = false; };
  } catch (error) { list.innerHTML = ''; say(error); }
};

// A new Canvas gets a folder of its own, so it can become a line later without moving.
async function newCanvasIn(p, from) {
  const title = `Canvas ${(p.pictures?.length || 0) + 1}`;
  try {
    const made = await api(`${pathFor(p.id)}/canvases`, { method:'POST', body:{ title, ...(HOSTED ? { blank:true } : {}) } });
    openCanvasPage(canvasUrl(p, { source:made.source, title:made.title }), from);
  } catch (error) {
    if (HOSTED || error.status !== 404) { toast(error.message); return; }
    openCanvasPage(canvasUrl(p, { source:freeSource(p, 'files/canvases', `canvas-${(p.pictures?.length || 0) + 1}`), title }), from);
  }
}
function newCanvas() { return newCanvasIn(project()); }
async function ensureMyCanvases() {
  if (myCanvases()) return myCanvases();
  await api('/my-canvases', { method:'POST' });
  await loadProjects();
  return myCanvases();
}
ACT['open-my-canvases'] = async el => {
  try {
    const mine = await ensureMyCanvases(); if (!mine) return;
    if (onProject(mine.id)) go({ view:'canvases' }); else switchProject(mine.id, { view:'canvases' });
  } catch (error) { toast(needsNewServer(error)); }
};
ACT['my-new-canvas'] = async () => {
  try {
    const mine = await ensureMyCanvases(); if (!mine) return;
    newCanvasIn(S.data[mine.id] || { id:mine.id, pictures:[], files:[] });
  } catch (error) { toast(needsNewServer(error)); }
};
ACT['open-canvas-card'] = el => {
  const p = project(), c = canvasByPath(p, el.dataset.source); if (!c) return;
  openCanvasPage(canvasUrl(p, { source:c.source, doc:c.topic ? `lines/${c.topic}.md` : '', title:c.title }), el.closest('.cv-card') || el);
};

async function afterCanvasChange(p) {
  await loadState(p.id, { force:true });
  await loadProjects().catch(() => {});
  // On Canvases & files the list is drawn again where it is, so the place on the page stays (files.js).
  if ($('#flBody') && project()?.id === p.id) { refreshChrome(); refreshFiles(); } else render();
}
function canvasRename(p, c, anchor) {
  const dialog = document.createElement('dialog');
  dialog.className = 'line-command-dialog';
  dialog.setAttribute('aria-labelledby', 'canvasCommandTitle');
  dialog.innerHTML = `<form><h2 id="canvasCommandTitle">Rename Canvas</h2><label for="canvasTitleInput">Name</label><input id="canvasTitleInput" maxlength="120" value="${esc(c.title)}" autocomplete="off" required><p class="command-error" role="alert" hidden></p><div class="command-actions"><button type="button" class="btn" data-cancel>Cancel</button><button type="submit" class="btn primary">Save</button></div></form>`;
  document.body.append(dialog);
  dialog.addEventListener('close', () => { dialog.remove(); if (anchor?.isConnected) anchor.focus(); });
  $('[data-cancel]', dialog).onclick = () => dialog.close();
  $('form', dialog).onsubmit = async e => {
    e.preventDefault(); const submit = $('button[type="submit"]', dialog); submit.disabled = true;
    try {
      await api(`${pathFor(p.id)}/canvases/rename`, { method:'POST', body:{ path:c.source, title:$('input', dialog).value } });
      dialog.close();
      await afterCanvasChange(p);
    } catch (error) { const message = $('.command-error', dialog); message.hidden = false; message.textContent = needsNewServer(error); submit.disabled = false; }
  };
  dialog.showModal();
  $('input', dialog).select();
}
// Where a line, or a Canvas on no line, can go: My Canvases and the projects in the sidebar now, in its order. One that is archived, or whose folder is gone, is not offered.
function moveTargets(p) {
  const others = railOrder().filter(x => !x.missing && x.id !== p.id);
  return [...(p.myCanvases ? [] : [{ id:'my-canvases', name:'My Canvases' }]), ...others];
}
// `slug` is the line's, or the folder of a Canvas that is on no line yet. The whole of it moves: its file, its pictures, its work details.
function moveMenu(p, slug, title, anchor, resolveAnchor) {
  const targets = moveTargets(p);
  if (!targets.length) { toast('There is no other project to move it to.'); return; }
  openMenu(anchor, [{ head:'Move to' }, ...targets.map(t => ({ label:t.name, icon:t.id === 'my-canvases' ? 'pen' : 'files', fn:async () => {
    try {
      await api(`${pathFor(p.id)}/topics/${encodeURIComponent(slug)}/move`, { method:'POST', body:{ to:t.id } });
      const onIt = S.route.view === 'line' && S.route.line === slug;
      await loadState(p.id, { force:true });
      await loadProjects().catch(() => {});
      const there = t.id === 'my-canvases' ? myCanvases() : t;
      if (onIt) go({ view:'home' }); else render();
      toast(`${title} is now in ${t.name}`, there ? { label:'Open', fn:() => switchProject(there.id, { view:there.myCanvases ? 'canvases' : 'home', fresh:true }) } : null);
    } catch (error) { toast(needsNewServer(error)); }
  } }))], { align:'right', resolveAnchor });
}
function moveLineMenu(l, anchor) { moveMenu(project(), l.id, l.title, anchor); }
// A Canvas on no line moves by itself: a copy in the other project, and this one to Deleted (canvas-move.js on the server).
function canvasMoveMenu(p, c, anchor, resolveAnchor) {
  const targets = moveTargets(p);
  if (!targets.length) { toast('There is no other project to move it to.'); return; }
  openMenu(anchor, [{ head:'Move to' }, ...targets.map(t => ({ label:t.name, icon:t.id === 'my-canvases' || t.myCanvases || t.name === 'My Canvases' ? 'pen' : 'files', fn:async () => {
    try {
      await api(`${pathFor(p.id)}/canvases/move`, { method:'POST', body:{ path:c.source, to:t.id } });
      await afterCanvasChange(p);
      await loadProjects().catch(() => {});
      const there = t.id === 'my-canvases' ? myCanvases() : summaryOf(t.id) || t;
      toast(`${c.title} is now in ${t.name}`, there ? { label:'Open', fn:() => switchProject(there.id, { view:there.myCanvases ? 'canvases' : 'files', fresh:true }) } : null);
    } catch (error) { toast(needsNewServer(error)); }
  } }))], { align:'right', resolveAnchor });
}
// Polling can replace a card, the file sheet, or the viewer. Follow only the
// same Canvas button in the surface where the menu was opened.
function canvasMenuAnchor(button, p, canvas, line) {
  const view = S.route.view, surface = button.closest('#flBody, #flSheet, #lightbox')?.id;
  const selector = surface && `#${surface} button[data-act="${CSS.escape(button.dataset.act)}"][data-source="${CSS.escape(canvas.source)}"]`;
  const moveDisabled = l => Boolean(l?.branch || l?.running);
  let checked = p;
  return () => {
    if (!onProject(p.id) || S.route.view !== view) return null;
    const latest = project();
    if (latest !== checked) {
      const item = canvasByPath(latest, canvas.source);
      if (!item) return null;
      const owner = canvasLine(latest, item);
      if (owner?.id !== line?.id || moveDisabled(owner) !== moveDisabled(line)) return null;
      checked = latest;
    }
    if (!button?.isConnected && selector) button = $(selector);
    return button;
  };
}
ACT['canvas-menu'] = el => {
  const p = project(), c = canvasByPath(p, el.dataset.source); if (!c) return;
  const line = canvasLine(p, c), resolveAnchor = canvasMenuAnchor(el, p, c, line);
  openMenu(el, [
    { label:'Open', icon:'canvas', fn:() => openCanvasPage(canvasUrl(p, { source:c.source, doc:c.topic ? `lines/${c.topic}.md` : '', title:c.title }), resolveAnchor()?.closest('.cv-card')) },
    ...(line ? [{ label:`Open its line`, icon:'right', fn:() => go({ view:'line', line:line.id }) }] : []),
    { sep:true },
    { label:'Rename', icon:'pen', fn:() => canvasRename(project(), canvasByPath(project(), c.source), resolveAnchor()) },
    line ? { label:'Move its line to…', icon:'swap', disabled:Boolean(line.branch) || Boolean(line.running), fn:() => moveMenu(p, line.id, line.title, el, resolveAnchor) }
      : { label:'Move to…', icon:'swap', fn:() => canvasMoveMenu(p, c, el, resolveAnchor) },
    ...(line ? [{ label:'Take off its line', icon:'split', fn:async () => { try { await api(`${pathFor(p.id)}/canvases/loose`, { method:'POST', body:{ path:c.source } }); await afterCanvasChange(p); } catch (error) { toast(needsNewServer(error)); } } }] : []),
    { sep:true },
    { label:'Delete', icon:'trash', fn:() => canvasDelete(p, c) },
  ], { align:'right', resolveAnchor });
};
async function canvasDelete(p, c) {
  try {
    const { removed } = await api(`${pathFor(p.id)}/canvases/delete`, { method:'POST', body:{ path:c.source } });
    await afterCanvasChange(p);
    toast('Canvas deleted', removed ? { label:'Undo', fn:() => restoreCanvas(p, removed) } : null);
  } catch (error) { toast(needsNewServer(error)); }
}
async function restoreCanvas(p, removed) {
  try { await api(`${pathFor(p.id)}/canvases/restore`, { method:'POST', body:{ removed } }); await afterCanvasChange(p); }
  catch (error) { toast(needsNewServer(error)); }
}
ACT['canvas-restore'] = el => restoreCanvas(project(), el.dataset.removed);

// ---------- The rail: My Canvases, with MeetCue right below it, above the projects ----------
function railMineHTML() {
  const mine = myCanvases(), on = Boolean(mine) && onProject(mine.id);
  const mc = typeof railMeetcueHTML === 'function' ? railMeetcueHTML() : '';
  return `<div class="rail-item rail-mine"><button type="button" class="rail-row ${on ? 'on' : ''}" data-act="open-my-canvases" ${on ? 'aria-current="page"' : ''} title="My Canvases"><span class="pglyph mine" style="--s:22px">${ic('pen', 13)}</span><span class="rail-name">My Canvases</span></button><button type="button" class="rail-add" data-act="my-new-canvas" aria-label="New canvas" title="New canvas">${ic('plus', 14)}</button></div>${mc}<hr class="rail-rule">`;
}
