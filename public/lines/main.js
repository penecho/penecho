// Routing, global events, and the poll that keeps the page in step with the folder.
const VIEWS = { home:homeHTML, topics:(p, r) => topicsPageHTML(p, r), files:canvasesHTML, canvases:canvasesHTML, stats:statsHTML, orchestrator:(p, r) => orchestratorHTML(p, r), memory:memoryHTML, vault:vaultHTML, find:findHTML, archive:archiveHTML, deleted:deletedHTML, settings:settingsHTML, line:lineHTML, newline:newLineHTML, doc:docHTML, markup:markupHTML };
const FULLSCREEN = new Set(['markup']);
const POLL_MS = 2000, LIST_MS = 15000, ACTIVITY_MS = 1200;

function routeToHash(r) {
  const p = encodeURIComponent(S.cur || ''), e = encodeURIComponent;
  if (!S.cur) return '';
  if (r.view === 'line') return `${p}/line/${e(r.line)}${r.step ? `/${e(r.step)}` : ''}`;
  if (r.view === 'find') return `${p}/find${r.q ? `/${e(r.q)}` : ''}`;
  if (r.view === 'doc') return `${p}/doc/${e(r.doc)}`;
  if (r.view === 'markup') return `${p}/markup/${e(r.doc)}`;
  if (r.view === 'topics' && r.topic) return `${p}/topics/${e(r.topic)}`;
  return r.view === 'home' ? p : `${p}/${r.view}`;
}
function hashToRoute(hash) {
  let parts;
  try { parts = hash.replace(/^#/, '').split('/').map(decodeURIComponent); } catch { return null; }
  const id = parts[0];
  if (!id || !S.projects.some(p => p.id === id)) return null;
  const v = parts[1];
  if (!v) return { cur:id, route:{ view:'home' } };
  // A link saved before every click led to one page still opens at the right place.
  if (v === 'line' && (parts[3] === 'topic' || parts[3] === 'tasks' || parts[3] === 'overview')) return { cur:id, route:{ view:'line', line:parts[2] } };
  if (v === 'line') return { cur:id, route:{ view:'line', line:parts[2], step:parts[3] } };
  if (v === 'step') return { cur:id, route:{ view:'line', line:parts[2], step:parts[3] } };
  if (v === 'find') return { cur:id, route:{ view:'find', q:parts.slice(2).join('/') } };
  if (v === 'doc' || v === 'markup') return { cur:id, route:{ view:v, doc:parts[2] } };
  if (v === 'topics') return { cur:id, route:{ view:'topics', ...(parts[2] ? { topic:parts.slice(2).join('/') } : {}) } };
  return VIEWS[v] ? { cur:id, route:{ view:v } } : { cur:id, route:{ view:'home' } };
}
// Addresses that belong to no project. These open the Settings window over the page (settings.js), each on its tab: Agents
// (#agents[/prices|/canvas|/apps], and bare #settings), Providers, Settings (#settings/canvas, #settings/general) and Archived. Older Settings AI links open Agents;
// #setup opens its installed agents.
const OUTSIDE_PAGES = new Set(['#archived', '#agents', '#providers', '#settings', '#setup']);
const SETTINGS_TABS = new Set(['canvas', 'general']);
const agentsTabFromHash = hash => ({ '#agents':'agents', '#agents/prices':'prices', '#agents/canvas':'canvas', '#agents/apps':'apps', '#agents/mcp':'apps', '#settings':'agents', '#settings/agents':'agents', '#settings/apps':'apps', '#settings/mcp':'apps', '#setup':'agents' })[hash] || null;
const settingsTabFromHash = hash => {
  const m = String(hash || '').match(/^#settings\/([^/?#]+)/);
  return m && SETTINGS_TABS.has(m[1]) ? m[1] : null;
};
const settingsHash = hash => hash === '#settings' || hash.startsWith('#settings/');
// MeetCue's pages are outside pages too: #meetcue and #meetcue/<meeting> (meetcue.js).
const outsidePage = hash => OUTSIDE_PAGES.has(hash) || agentsTabFromHash(hash) !== null || settingsHash(hash) || (typeof meetcueHash === 'function' && meetcueHash(hash));
const parseShelfPage = hash => {
  if (!outsidePage(hash)) return false;
  const agentsTab = agentsTabFromHash(hash);
  if (agentsTab) {
    if (typeof SET === 'object' && SET) SET.agentsTab = agentsTab;
    return hash === '#setup' ? 'setup' : 'agents';
  }
  if (settingsHash(hash)) {
    const tab = settingsTabFromHash(hash);
    if (typeof SET === 'object' && SET) SET.tab = tab || (SETTINGS_TABS.has(SET.tab) ? SET.tab : 'canvas');
    return 'settings';
  }
  return hash.slice(1);
};
// Text you are editing is saved before the page moves on, so nothing typed is left behind.
let savingOpenEdit = null;
function saveOpenEdit() {
  const reader = $('.reader'), area = reader && $('#rdArea', reader);
  return area && !area.hidden ? (savingOpenEdit ||= finishEdit(reader, { quiet:true }).finally(() => { savingOpenEdit = null; })) : true;
}
let lastFrom = null;
const setRailGoing = (id, opts) => { if (typeof railGoing === 'function') railGoing(id, opts); };
function fromHomeLinesClick(from, lineId) {
  if (!from || !lineId || typeof from.closest !== 'function') return false;
  const row = from.closest('.hl-row');
  return Boolean(row && row.dataset?.row === lineId && row.closest?.('#pano'));
}
function hasHomeLinesOrigin(projectId, lineId) {
  if (!projectId || !lineId) return false;
  if (typeof currentHomeLinesOrigin === 'function') return Boolean(currentHomeLinesOrigin(projectId, lineId));
  return Boolean(S.homeLinesOrigin?.project === projectId && S.homeLinesOrigin?.line === lineId);
}
// What the next page shows is read before it opens, so nothing on it changes under the hand while more comes (PE-594). Read already, as
// what you point at is (readAhead), it opens at once; a slow one opens after this long as its outline, and fills when the rest is here.
const HOLD_MS = 160;
const holdFor = (p, route) => (lacks(p, routeNeeds(route)) ? Promise.race([readNeeds(p, routeNeeds(route)).catch(() => false), new Promise(resolve => setTimeout(resolve, HOLD_MS))]) : null);
function go(route, options = {}) {
  const { from, back, replace, savedEdit = false, docBack = null, keepDocTrail = false, lineOrigin = null, restoredOrigin = null, restoredHomeLinesOrigin = null, projectChanged = false, read = false } = options;
  // Beside a Canvas the panel holds one line. Anywhere else is a whole page, which the Canvas page opens once it has saved.
  if (!embedKeeps(route)) { embedTell({ leave:`/projects.html#${routeToHash(route)}` }); return; }
  const hold = read ? null : holdFor(project(), route);
  if (hold) {
    const transition = ++navigationTransition, row = from?.closest?.('[data-row]')?.dataset.row;
    from?.classList?.add('is-opening');
    void hold.then(() => {
      from?.classList?.remove('is-opening');
      if (transition !== navigationTransition) return;
      // The list may have been drawn again meanwhile: the line leaves from its row as it stands now.
      const start = from && !from.isConnected && row ? $(`.hl-row[data-row="${CSS.escape(row)}"] .hl-main`) || from : from;
      go(route, { ...options, from:start, read:true });
    });
    return;
  }
  if (typeof window !== 'undefined' && window.PenEchoCanvasShell?.active) {
    const transition = ++navigationTransition;
    void window.PenEchoCanvasShell.close().then(closed => {
      if (transition !== navigationTransition) return;
      // Not saved, the Canvas stays open and the sidebar goes back to it.
      if (!closed) { setRailGoing(null); return; }
      go(route, { from, back, replace, savedEdit, docBack, keepDocTrail, lineOrigin, restoredOrigin, restoredHomeLinesOrigin, projectChanged });
    });
    return;
  }
  ++navigationTransition;
  setRailGoing(null, { draw:false });
  if (!savedEdit) saveOpenEdit();
  if (typeof recordDocNavigation === 'function') recordDocNavigation(route, { from, back, docBack, keepDocTrail });
  const wasNewPage = Boolean(S.newPage), wasShelfPage = Boolean(S.shelfPage), wasView = S.route.view;
  S.newPage = false; S.shelfPage = false;
  const rectOf = el => typeof pageRect === 'function' ? pageRect(el) : (el?.getBoundingClientRect?.() || null);
  const prevNode = $('#view > *'), prevRect = prevNode ? rectOf(prevNode) : null, rect = from?.getBoundingClientRect ? rectOf(from) : null;
  const wasLine = !projectChanged && !wasNewPage && !wasShelfPage && wasView === 'line' ? S.route.line : null;
  const wasHome = !projectChanged && !wasNewPage && !wasShelfPage && wasView === 'home';
  const fromHomeLines = route.view === 'line' && wasHome && fromHomeLinesClick(from, route.line);
  const backToHomeLines = Boolean(back && wasLine && route.view === 'home' && hasHomeLinesOrigin(S.cur, wasLine));
  const interrupted = S.flightSnapshot?.();
  endFlight();
  // Only clicking a line from All lines on the project homepage (and returning back) animates.
  const flight = fromHomeLines ? flightToLine(route.line, from, interrupted) : backToHomeLines ? flightToHome(wasLine, interrupted) : null;
  const nextHomeLinesOrigin = route.view === 'line'
    ? (fromHomeLines ? { project:S.cur, line:route.line } : restoredHomeLinesOrigin || docBack?.homeLinesOrigin || (wasLine === route.line && hasHomeLinesOrigin(S.cur, route.line) ? { project:S.cur, line:route.line } : null))
    : null;
  closeMenu();
  if (typeof closeReviewTreePopover === 'function') closeReviewTreePopover();
  if (typeof walkOnGo === 'function') walkOnGo(route);   // the filtered list a line was opened from (line.js)
  if (S.route.view === 'line' && (route.view !== 'line' || route.line !== S.route.line)) S.panelPopped = false;
  S.route = route;
  S.homeLinesOrigin = nextHomeLinesOrigin;
  if (typeof setDocRouteProject === 'function') setDocRouteProject(S.cur);
  syncHash(replace, restoredOrigin || docBack?.orchestratorOrigin || null, lineOrigin || docBack?.lineOrigin || null, nextHomeLinesOrigin);
  render();
  readOpenedLine();
  if (typeof recordOpenedLine === 'function') recordOpenedLine();
  if (wasLine && S.route.view === 'home') showRow(wasLine);
  if (docBack && typeof restoreDocOriginScroll === 'function') restoreDocOriginScroll(docBack);
  const page = $('#view > *');
  if (flight) { lastFrom = null; flight(); return; }
  // Switching projects, clicking from the sidebar, or opening a line/home outside All lines shows the page directly without zooming out.
  const canZoomIn = Boolean(rect && !projectChanged && route.view !== 'line' && route.view !== 'home' && !from?.closest?.('#rail'));
  const canZoomOut = Boolean(back && !projectChanged && lastFrom && prevRect && (docBack || (!wasLine && route.view !== 'line')));
  if (canZoomIn) {
    lastFrom = { key:from.dataset?.step || from.dataset?.line || from.dataset?.card || from.dataset?.path || from.dataset?.doc };
    zoomIn(page, rect);
    return;
  }
  if (canZoomOut) {
    const key = CSS.escape(lastFrom.key || '');
    const target = key && $(`[data-step="${key}"],[data-line="${key}"],[data-card="${key}"],[data-path="${key}"],[data-doc="${key}"]`);
    if (target) zoomOutClone(prevRect, prevNode, rectOf(target));
  }
  if (projectChanged || route.view === 'line' || route.view === 'home' || wasLine) lastFrom = null;
}
ACT['doc-back'] = () => {
  const p = project(); if (!p) return;
  const hit = typeof docBackTarget === 'function' ? docBackTarget(p, S.route.doc) : null;
  if (!hit) { go({ view:'home' }, { back:true }); return; }
  const entry = docBackTrail(p.id).pop();
  lastFrom = entry.fromKey ? { key:entry.fromKey } : null;
  if (typeof restoreDocOriginState === 'function') restoreDocOriginState(entry);
  go(entry.route, { back:true, docBack:entry });
};
function syncHash(replace, restoredOrigin, restoredLineOrigin, restoredHomeLinesOrigin) {
  if (S.newPage || S.shelfPage || S.underSettings) return;
  rememberProjectRoute();
  const h = '#' + routeToHash(S.route);
  if (location.hash === h || h === '#') return;
  let origin = null, parentOrigin = null, homeLinesOrigin = null;
  if (S.route.view === 'line') {
    const hosted = Boolean(HOSTED && !HOSTED.onComputer);
    origin = !hosted && location.hash === '#' + routeToHash({ view:'orchestrator' })
      ? { project:S.cur, line:S.route.line, top:$('#view').scrollTop }
      : (!hosted && restoredOrigin) || lineOrchestratorOrigin(S.cur, S.route.line);
    parentOrigin = restoredLineOrigin || (typeof lineParentOrigin === 'function' ? lineParentOrigin(S.cur, S.route.line) : null);
    homeLinesOrigin = restoredHomeLinesOrigin || (typeof currentHomeLinesOrigin === 'function' ? currentHomeLinesOrigin(S.cur, S.route.line) : null);
  }
  S.hashWrite = h;
  if (!replace) location.hash = h;
  const state = origin || parentOrigin || homeLinesOrigin
    ? { ...(origin ? { orchestratorOrigin:origin } : {}), ...(parentOrigin ? { lineOrigin:parentOrigin } : {}), ...(homeLinesOrigin ? { homeLinesOrigin } : {}) }
    : null;
  if (replace || state) history.replaceState(state, '', h);
  hostedAddress();   // Hosted: the dashboard around the page keeps its address in step (hosted.js)
}
// The home keeps its place, so coming back from a line lands where you left it.
const homeTop = {};
let outsideShown = {};
// What #view holds now: a project's page or New project, or '' for anything else. Settings opens over it and leaves it be.
let viewShows = '';
const viewKey = () => (S.newPage ? 'new' : `${S.cur || ''}#${routeToHash(S.route)}`);
function render() {
  if (embedRailOnly()) return;
  if (settingsUp()) {
    // Opened by its address alone, the page beneath is drawn first, without taking the address.
    if (viewShows !== viewKey()) {
      const page = S.shelfPage;
      S.shelfPage = false; S.underSettings = true;
      try { renderPage(); } finally { S.shelfPage = page; S.underSettings = false; }
      viewShows = viewKey();
    }
    renderSettingsModal();
    renderRail();
    return;
  }
  // Closing Settings uncovers the page as it was, brought up to date rather than drawn again.
  const covered = Boolean(document.getElementById('sysModal'));
  dropSettingsModal();
  if (covered && viewShows && viewShows === viewKey() && !S.shelfPage) { refreshAfterChange(); syncHash(true); return; }
  renderPage();
  viewShows = S.shelfPage ? '' : viewKey();
}
function renderPage() {
  const p = project(), view = $('#view');
  if (Pano.sheet?.isConnected) homeTop[Pano.owner] = view.scrollTop;
  // New pages with a server still running the old code would only show errors.
  if (S.needsRestart) { view.innerHTML = '<div class="page"><p class="empty-line">Restart PenEcho to finish this update, then reload this page.</p></div>'; return; }
  if (typeof cloudPageRender === 'function' && cloudPageRender(view)) return;   // Cloud: a project that is only in PenEcho Cloud (cloud.js)
  // MeetCue's pages draw themselves (meetcue.js).
  if (typeof renderMeetcue === 'function' && renderMeetcue(view)) return;
  if (S.shelfPage) { S.shelfPage = false; S.hashWrite = ''; }   // no such page any more: the page beneath
  outsideShown = {};
  if (S.newPage) {
    document.body.classList.remove('is-full', 'on-line');
    unmountLine(); SHEET?.destroy(); SHEET = null;
    refreshChrome();
    document.title = 'New project · PenEcho Lines';
    // What you type into this form is yours, so a redraw for something else leaves it be.
    if (!view.querySelector('.np-page')) {
      view.innerHTML = newProjectHTML();
      view.scrollTop = 0;
      mountNewProject();
    }
    return;
  }
  if (!p) {
    document.body.classList.remove('is-full', 'on-line');
    unmountLine(); SHEET?.destroy(); SHEET = null;
    refreshChrome();
    document.title = 'Projects · PenEcho Lines';
    view.innerHTML = welcomeHTML();
    mountWelcome();
    return;
  }
  const r = S.route;
  // An old link never strands you: fall back to the nearest thing that still exists.
  if ((r.view === 'doc' || r.view === 'markup') && !fileEntry(p, r.doc) && listsFiles(p)) S.route = { view:'home' };
  if (r.view === 'topics' && p.projectTopics === false) S.route = { view:'home' };
  if (r.view === 'line') {
    const l = lineById(p, r.line);
    if (!l) { S.route = { view:'home' }; S.lineFilter = null; projectPositions.delete(S.cur); }
    else if (r.step && !l.light && !stationById(l, r.step)) S.route = { view:'line', line:r.line };
  }
  if (S.route.view !== 'line') unmountLine();
  if (!VIEWS[S.route.view]) S.route = { view:'home' };
  // Beside a Canvas there is the line, or the start of one.
  if (!embedKeeps(S.route)) S.route = { view:'newline' };
  // What this page shows that is not read yet is on its way: its outline stands until it is here.
  const missing = lacks(p, routeNeeds(S.route));
  S.outline = missing ? viewKey() : '';
  if (missing) void readNeeds(p, routeNeeds(S.route)).then(() => { if (S.outline && S.outline === viewKey()) render(); }, () => { /* The next look asks again. */ });
  embedShown(p, S.route);
  // My Canvases opens on its Canvases until one of them has become a line.
  if (p.myCanvases && S.route.view === 'home' && !allLines(p).length) S.route = { view:'canvases' };
  syncHash(true);
  document.body.classList.toggle('on-line', S.route.view === 'line' || S.route.view === 'newline');
  hideStopCard();
  const full = FULLSCREEN.has(S.route.view);
  document.body.classList.toggle('is-full', full);
  S.shapeShown = S.route.view === 'home' ? homeShape(p) : null;
  if (!full) { SHEET?.destroy(); SHEET = null; }
  refreshChrome();
  document.title = `${p.name} · PenEcho Lines`;
  if (S.outline) { unmountLine(); view.innerHTML = outlineHTML(p, S.route); view.scrollTop = 0; return; }
  const focusOrchGoal = S.route.view === 'orchestrator' && !S.underSettings &&
    (viewShows !== viewKey() || !$('#orchGoal', view) || document.activeElement?.id === 'orchGoal');
  view.innerHTML = VIEWS[S.route.view](p, S.route);
  view.scrollTop = 0;
  afterRender(p, S.route);
  if (S.route.view === 'line') readLineFiles(p, S.route.line);
  if (focusOrchGoal) $('#orchGoal', view)?.focus({ preventScroll:true });
  if (S.route.view === 'home') view.scrollTop = homeTop[p.id] || 0;
}
// An open line shows its own files; when its words link to any other file of the folder, the folder's list comes a moment later.
let filesSoon = 0;
function readLineFiles(p, id) {
  clearTimeout(filesSoon);
  if (!p.partial || S.noViews) return;
  const here = () => S.cur === p.id && S.route.view === 'line' && !S.newPage && !S.shelfPage, show = changed => { if (changed && here()) refreshAfterChange(); };
  if (!p.everyLine && !p.openLines.includes(id)) loadState(p.id).then(show, () => { /* The next look asks again. */ });
  if (!listsFiles(p)) filesSoon = setTimeout(() => { if (here() && !document.hidden && missedFiles.has(p.id)) readNeeds(project(), { parts:['files'] }).then(show, () => { /* Opened again, it is asked again. */ }); }, 1500);
}
// A page still being read: its line's name, and plain shapes with nothing to press.
function outlineHTML(p, r) {
  const l = r.view === 'line' ? lineById(p, r.line) : null;
  return `<div class="page sk-page is-outline" aria-busy="true">${l ? `<h1 class="sk-title">${esc(l.title)}</h1>` : ''}<div class="sk-sheet" aria-hidden="true">${Array.from({ length:6 }, (_, i) => `<div class="sk-row"><i></i><b${i % 2 ? ' class="is-mid"' : ''}></b><span></span></div>`).join('')}</div></div>`;
}
function afterRender(p, r) {
  wireComposers($('#view'));
  if (r.view === 'settings' && typeof mountProjectCloudSettings === 'function') mountProjectCloudSettings(p);
  if (r.view === 'home') {
    const root = $('#pano');
    if (root) Pano.mount(root); else Pano.sheet = null;
    renderTray();
    refreshDesk();
  }
  if (r.view === 'stats') {
    bindStatsPage($('#statsBody'));
    if (typeof refreshStatsPrices === 'function') refreshStatsPrices(p, true);
  }
  $$('#view .reader').forEach(el => {
    const doc = docById(el.dataset.doc, p);
    if (!doc) return;
    Reader.bind(el, doc, p, () => {});
    el._md = doc.md;
    if (S.freshDoc === doc.path) { S.freshDoc = null; ACT['reader-edit']($('#rdEdit', el)); }
  });
  if (r.view === 'topics' && typeof seeChangedTopics === 'function') seeChangedTopics();
  if (r.view === 'vault') vaultPreview(p);
  if (S.route.view === 'line') mountLine(p, S.route);
  // Beside a Canvas the panel opens with it, and the keys stay with the Canvas: P is still the pen.
  if (r.view === 'newline' && !EMBED) $('#view .lp-dock .cmp-input')?.focus();
  if (r.view === 'markup') mountMarkup(p, r);
}
// What you point at is read before you press it: a line not read yet, or another project in the rail. One at a time, the last one pointed at.
const AHEAD_MS = 90;
const ahead = { timer:0, busy:false, next:null };
function aheadOf(target) {
  if (EMBED?.rail || S.noViews) return null;
  const row = target.closest?.('[data-line]'), at = target.closest?.('.rail-row[data-p]'), other = row?.dataset.p || at?.dataset.p || '', p = project();
  if (other && other !== S.cur) return summaryOf(other)?.missing || S.data[other] ? null : () => loadState(other, { route:row ? { view:'line', line:row.dataset.line } : lastProjectRoute(other) });
  const id = row?.dataset.line;
  return p && id && lineById(p, id)?.light ? () => readLines(p, [id]) : null;
}
function readAhead(target, wait = AHEAD_MS) {
  clearTimeout(ahead.timer);
  ahead.timer = setTimeout(async () => {
    const read = document.hidden ? null : aheadOf(target);
    if (!read) return;
    ahead.next = read;
    if (ahead.busy) return;
    ahead.busy = true;
    try { while (ahead.next) { const now = ahead.next; ahead.next = null; await now(); } } catch { ahead.next = null; /* It is read when it is opened. */ } finally { ahead.busy = false; }
  }, wait);
}
// These open or fold something by themselves, or need no more than the line's name and marks. Anything else done to a line first reads it whole.
const LIGHT_ACTS = new Set(['open-line', 'open-step', 'peek-line', 'row-open', 'session-fold', 'find-open', 'file-line', 'viewer-line', 'line-pin', 'switch-project', 'rail-line-menu', 'reopen-line', 'orch-open', 'next-open', 'plan-remove']);
const lightLineOf = el => { const p = project(), id = el.dataset.line; return id && !LIGHT_ACTS.has(el.dataset.act) && (!el.dataset.p || el.dataset.p === S.cur) && p && lineById(p, id)?.light ? { p, id } : null; };
let polling = false, listed = 0, offline = false, outageSince = null, redrawProblem = '', resumeOrchestrator = false, resumeOrchestratorTimer = 0;
const ORCH_RESUME_MS = 1000;
function clearOrchestratorResume() {
  resumeOrchestrator = false;
  if (resumeOrchestratorTimer) { clearTimeout(resumeOrchestratorTimer); resumeOrchestratorTimer = 0; }
}
function finishOrchestratorResume(refreshed = false) {
  if (!resumeOrchestrator || document.hidden) { clearOrchestratorResume(); return; }
  clearOrchestratorResume();
  if (!refreshed && !S.newPage && !S.shelfPage && (S.route.view === 'orchestrator' || S.route.view === 'stats') && typeof loadOrchestrator === 'function') loadOrchestrator(project(), false);
}
function scheduleOrchestratorResume() {
  clearOrchestratorResume();
  if (document.hidden || (S.route.view !== 'orchestrator' && S.route.view !== 'stats')) return;
  resumeOrchestrator = true;
  // Do not stay paused behind a slow or hung /state poll; a normal fast poll cancels this timer and coalesces into one refresh.
  resumeOrchestratorTimer = setTimeout(() => {
    resumeOrchestratorTimer = 0;
    finishOrchestratorResume(false);
  }, ORCH_RESUME_MS);
}
async function poll() {
  if (polling || document.hidden || (typeof EMBED !== 'undefined' && EMBED?.paused)) return;
  polling = true;
  const asked = S.cur;
  let changed = false, topicsChanged = [];
  try {
    const known = project() ? new Set(allLines(project()).map(l => l.id)) : null;
    if (S.cur) changed = await loadState(S.cur);
    if (project() && typeof pendingDrawing === 'function' && pendingDrawing()?.project === S.cur) {
      await takeDrawing(project()).catch(() => {});
      boxUrls(project());
      changed = true;
    }
    if (project()) topicsChanged = checkTopics();
    // A conversation someone started in their agent's own app has just become a Topic.
    if (changed && known && !S.syncing) for (const l of allLines(project())) if (!known.has(l.id) && l.source) toast(`New in ${l.source}: ${l.title}`, { label:'Open', fn:() => go({ view:'line', line:l.id }) });
    if (Date.now() - listed > LIST_MS) {
      listed = Date.now();
      await Promise.all([loadProjects(), loadAgents()]);
      renderRail();
      if (!$('#switcher').hidden) renderSwitcher();
    }
    outageSince = null;
    if (offline) { offline = false; toast('Connected again.'); }
    hostedRetry();   // Hosted: an Ask waiting for its line goes out when the line is free (hosted.js)
  } catch (error) {
    if (error.status === 404 && S.cur && S.cur === asked) { S.cur = null; S.route = { view:'home' }; await loadProjects().catch(() => {}); render(); }
    else if (!offline) {
      const unavailable = error.offline || [502, 503, 504].includes(error.status);
      if (HOSTED?.onComputer && unavailable) {
        outageSince ??= Date.now();
        if (Date.now() - outageSince < 120000) { finishOrchestratorResume(); return; }
      }
      offline = true;
      toast(HOSTED?.onComputer && unavailable ? 'Could not refresh from PenEcho Cloud. Trying again.'
        : error.offline || error.status >= 502 ? 'PenEcho is not answering. Your files are safe. Trying again.' : error.message);
    }
    finishOrchestratorResume();
    return;
  } finally { polling = false; }
  if (topicsChanged.length && S.cur === asked) announceTopics(project(), topicsChanged);
  // Redrawing is the page's own work. A mistake in it is not a lost connection, so it says what it is, once.
  if (!changed) { finishOrchestratorResume(); return; }
  let orchRefreshed;
  try { orchRefreshed = refreshAfterChange(); if (!$('#switcher').hidden) renderSwitcher(); redrawProblem = ''; }
  catch (error) { console.error(error); if (redrawProblem !== error.message) { redrawProblem = error.message; toast(error.message); } }
  finally { finishOrchestratorResume(orchRefreshed); }
}
function bindGlobal() {
  document.addEventListener('load', e => {
    const img = e.target;
    if (img?.tagName === 'IMG' && img.matches?.('.cmp-file-pic img, .orch-file-pic img') && img.naturalWidth > 0) img.classList.add('is-loaded');
  }, true);
  document.addEventListener('error', e => {
    const img = e.target;
    if (img?.tagName === 'IMG' && img.matches?.('.cmp-file-pic img, .orch-file-pic img')) img.classList.remove('is-loaded');
  }, true);
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    if (el.matches('a[data-act="preview-work-file"], a[data-act="viewer-line"]') && (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey)) return;
    const handler = ACT[el.dataset.act];
    if (!handler) return;
    e.preventDefault();
    // Something just added and not saved yet acts once the server has named it (composer.js).
    if (typeof whenSaved === 'function' && whenSaved(el, () => handler(el, e))) return;
    const light = lightLineOf(el);
    if (light) { readLines(light.p, [light.id]).then(() => { if (project()?.id === light.p.id && !lineById(project(), light.id)?.light) handler(el, e); }, error => toast(error.message)); return; }
    handler(el, e);
    if (el.dataset.focusId) document.getElementById(el.dataset.focusId)?.focus();
  });
  document.addEventListener('pointerover', e => { if (e.pointerType !== 'touch') readAhead(e.target); }, { passive:true });
  document.addEventListener('pointerdown', e => readAhead(e.target, 0), { passive:true });
  document.addEventListener('focusin', e => readAhead(e.target));
  // Right-click a project in the sidebar to rename or pin it.
  document.addEventListener('contextmenu', e => {
    const row = e.target.closest('.rail-row[data-p]'), s = row && summaryOf(row.dataset.p);
    if (!s || s.missing) return;
    e.preventDefault();
    openMenu(row, [
      { label:'Rename', icon:'pen', fn:() => ACT['project-rename'](row) },
      { label:s.pinned ? 'Unpin' : 'Pin', icon:'star', fn:() => ACT['sw-pin'](row) },
      ...(typeof meetcueMenuItems === 'function' ? meetcueMenuItems(s) : []), // Use in MeetCue (meetcue.js)
    ]);
  });
  addEventListener('keydown', e => {
    if (e.altKey && /^Digit[1-9]$/.test(e.code)) {
      const id = railOrder()[+e.code.slice(5) - 1]?.id;
      if (id) { e.preventDefault(); switchProject(id); }
      return;
    }
    if (e.key === 'Escape') {
      if (e.defaultPrevented) return;
      if ($('#menu')) { closeMenu(); return; }
      if (document.querySelector('dialog[open]')) return;
      if ($('#lightbox') && !$('#lightbox').hidden) { if (typeof fvShown === 'function' && fvShown()) fvClose(); else closeLightbox(); return; }
      if ($('#switcher') && !$('#switcher').hidden) { closeSwitcher(); return; }
      if (settingsUp()) { closeSettings(); return; }
      if (S.route.view === 'line' && S.panelPopped) { if (typeof setPanelPopped === 'function') setPanelPopped(false, { focus:true }); else S.panelPopped = false; return; }
      if (S.lineSel && S.route.view === 'line' && !e.target.closest?.('.composer')) { ACT['panel-close'](); return; }
    }
  });
  const sw = $('#switcher');
  sw.addEventListener('pointerdown', e => { if (e.target === sw) closeSwitcher(); });
  sw.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); SW.i = (SW.i + 1) % Math.max(1, SW.list.length); renderSwitcher(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); SW.i = (SW.i - 1 + SW.list.length) % Math.max(1, SW.list.length); renderSwitcher(); }
  });
  $('#swList').addEventListener('pointermove', e => {
    const row = e.target.closest('.sw-row'); if (!row) return;
    const i = +row.dataset.i;
    if (i !== SW.i) { SW.i = i; $$('#swList .sw-row').forEach(r => { const on = +r.dataset.i === i; r.classList.toggle('on', on); r.setAttribute('aria-selected', on); }); $('#swPreview').innerHTML = previewHTML(SW.list[i]); }
  });
  addEventListener('hashchange', async () => {
    if (location.hash === S.hashWrite) return;
    const hash = location.hash;
    const canvasHash = window.PenEchoCanvasShell?.enabled?.() ? window.PenEchoCanvasShell.parseCanvasHash(hash) : null;
    if (canvasHash) {
      if (summaryOf(canvasHash.project) && !S.data[canvasHash.project]) {
        try { await loadState(canvasHash.project, { force:true }); } catch {}
      }
      S.hashWrite = hash;
      await window.PenEchoCanvasShell.openFromHash(hash, history.state?.canvasTarget || null);
      return;
    }
    const r = hashToRoute(hash), special = hash === '#new' || outsidePage(hash);
    if (!r && !special) return;
    const transition = ++navigationTransition;
    const shelfCandidate = special && hash !== '#new' ? parseShelfPage(hash) : false;
    const settingsOverCanvas = Boolean(window.PenEchoCanvasShell?.active && shelfCandidate && SETTINGS_PAGES.has(shelfCandidate));
    if (window.PenEchoCanvasShell?.active && !settingsOverCanvas) {
      const closed = await window.PenEchoCanvasShell.close();
      if (transition !== navigationTransition || !closed) return;
    }
    if (!await saveOpenEdit()) { if (transition === navigationTransition) { history.replaceState(null, '', S.hashWrite || '#' + routeToHash(S.route)); } return; }
    if (transition !== navigationTransition) return;
    captureProjectPosition(); rememberProjectRoute();
    if (special) {
      const shelf = hash !== '#new' && parseShelfPage(hash), over = SETTINGS_PAGES.has(shelf);
      // Settings opens over New project too, and a link that opened it is stepped back over when it closes.
      if (over && !settingsUp()) { SET.pushed = true; SET.from = document.activeElement; }
      S.newPage = hash === '#new' || (over && S.newPage); S.shelfPage = shelf; S.hashWrite = hash; render(); return;
    }
    if (r.cur !== S.cur || !project()) {
      if (r.cur !== S.cur && !S.data[r.cur]) setRailGoing(r.cur);
      try { await loadState(r.cur, { force:true, route:r.route }); } catch (error) { if (transition === navigationTransition) { setRailGoing(null); toast(error.message); history.replaceState(null, '', S.hashWrite || '#' + routeToHash(S.route)); } return; }
    }
    if (transition !== navigationTransition) return;
    await holdFor(project(r.cur), r.route);
    if (transition !== navigationTransition) return;
    setRailGoing(null, { draw:false });
    S.newPage = false; S.shelfPage = false; S.hashWrite = hash;
    // The browser's Back closes a line the same way the page's own button does.
    const wasLine = r.cur === S.cur && S.route.view === 'line' && r.route.view === 'home' ? S.route.line : null;
    const backToHomeLines = Boolean(wasLine && hasHomeLinesOrigin(S.cur, wasLine));
    endFlight();
    const flight = backToHomeLines ? flightToHome(wasLine) : null;
    if (S.cur !== r.cur) S.lineFilter = null;
    if (S.cur !== r.cur || S.route.view !== 'line' || r.route.view !== 'line' || r.route.line !== S.route.line) S.panelPopped = false;
    S.cur = r.cur; S.route = r.route; S.panelShut = null;
    S.homeLinesOrigin = r.route.view === 'line' && typeof lineHomeLinesOrigin === 'function' ? lineHomeLinesOrigin(r.cur, r.route.line) : null;
    if (typeof syncDocTrailOnHash === 'function') syncDocTrailOnHash(S.cur, S.route);
    if (typeof setDocRouteProject === 'function') setDocRouteProject(S.cur);
    boxUrls(project());
    if (!S.tabs.includes(S.cur)) S.tabs.push(S.cur);
    rememberTabs();
    render();
    readOpenedLine();
    if (typeof recordOpenedLine === 'function') recordOpenedLine();
    if (wasLine) { showRow(wasLine); flight?.(); }
  });
  let projbarResizeTimer = 0;
  addEventListener('resize', () => {
    clearTimeout(projbarResizeTimer);
    projbarResizeTimer = setTimeout(() => {
      S.projbarResize = (S.projbarResize || 0) + 1;
      S.statsInMore = false; S.orchInMore = false; S.navFold = 0;
      renderProjbar();
    }, 150);
    $$('.composer').forEach(syncComposer);
    if (S.route.view === 'line') refreshLine();
  });
  $('#lightbox').addEventListener('pointerdown', e => { if (e.target.id === 'lightbox') closeLightbox(); });
  document.addEventListener('change', e => {
    if (e.target.matches?.('select[data-model-agent]')) {
      const id = e.target.dataset.modelAgent;
      if (e.target.value === '__custom__') { S.setupCustomModel = { ...(S.setupCustomModel || {}), [id]:true }; render(); requestAnimationFrame(() => $(`input[data-model-agent="${id}"]`)?.focus()); return; }
      if (S.setupCustomModel) delete S.setupCustomModel[id];
      pickAgentModel(id, { model:e.target.value });
      return;
    }
    if (e.target.matches?.('select[data-effort-agent]')) { changeAgentEffort(e.target.dataset.effortAgent, e.target.value); return; }
    if (e.target.id === 'projectMemory' || e.target.id === 'projectTopics') {
      const on = e.target.checked, key = e.target.id, what = key === 'projectMemory' ? 'Project memory' : 'Project Topics';
      patchProject({ [key]:on }).then(() => {
        if (key === 'projectTopics') {
          if (!on && S.cur && Pano.topic) delete Pano.topic[S.cur];
          S.statsInMore = false; S.orchInMore = false; S.navFold = 0;
        }
        render();
        toast(`${what} ${on ? 'on' : 'off'}.`);
      }).catch(error => toast(error.message));
      return;
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearOrchestratorResume();
      if (typeof pauseOrchestrator === 'function') pauseOrchestrator();
      return;
    }
    if (S.topicsTabFresh?.[S.cur] && !S.topicsTabFresh[S.cur].at && !S.topicsTabFresh[S.cur].done) renderProjbar();
    scheduleOrchestratorResume();
    poll();
  });
  // Coming back from the Canvas restores this page from cache. Its picture may be new.
  addEventListener('pageshow', e => { $('#canvasZoom')?.remove(); $('#rail')?.classList.remove('rail-leaving'); if (e.persisted && S.cur) { S.docs = {}; loadState(S.cur, { force:true }).then(async () => { await takeDrawing(project()); boxUrls(project()); render(); }).catch(error => toast(error.message)); } });
  addEventListener('pagehide', rememberBoxes);
  addEventListener('pagehide', keepRail);
  addEventListener('pagehide', keepPage);
  addEventListener('beforeunload', e => {
    const reader = $('.reader'), area = reader && $('#rdArea', reader), doc = reader && docById(reader.dataset.doc);
    if (area && !area.hidden && doc && area.value !== doc.md) e.preventDefault();
  });
}
// The list of projects is enough to draw the sidebar, so it is drawn as soon as it comes, before the open project is read.
// It stays a picture until the page is ready (railLive): a click before then would be lost under what the page opens on.
function railFromList() {
  const was = { cur:S.cur, route:S.route }, r = hashToRoute(location.hash);
  if (EMBED?.rail) S.cur = summaryOf(EMBED.project) ? EMBED.project : null;
  else if (r) { S.cur = r.cur; S.route = r.route; }
  const rail = $('#rail');
  if (rail) rail.inert = true;
  railPictureOnly = false;
  try { renderRail(); } catch { /* The sidebar is drawn with the page. */ }
  finally { S.cur = was.cur; S.route = was.route; }
}
async function boot() {
  hostedBoot();   // Hosted: what penecho.ai cannot do is taken out before the page starts (hosted.js)
  $('#app').innerHTML = chromeHTML();
  const hasRail = showKeptRail() || (typeof showWarmRail === 'function' && showWarmRail());
  const hasPage = showKeptPage();
  if (typeof showColdSkeleton === 'function' && (!hasRail || !hasPage)) showColdSkeleton({ rail:!hasRail, view:!hasPage });
  try { if (sessionStorage.getItem('penecho-lines-zoomed')) { sessionStorage.removeItem('penecho-lines-zoomed'); document.body.classList.add('zoomed-in'); } } catch { /* Only the last part of the animation depends on this. */ }
  bindGlobal(); wireDrop();
  try { await Promise.all([restoreBoxes(), loadProjects().then(railFromList), loadAgents()]); }
  catch (error) {
    railPictureOnly = false; $('#railList').replaceChildren(); railLive();
    // Another PenEcho runs these Lines: open them there, or wait here; this page comes back by itself once this PenEcho has taken over.
    const busy = error.code === 'RUNTIME_BUSY', port = Number(error.data?.owner?.port) || 0;
    const there = busy && port && port !== Number(location.port) ? `${location.protocol}//${location.hostname}:${port}${location.pathname}${location.hash}` : '';
    $('#view').innerHTML = `<div class="page"><p class="empty-line">${esc(error.message)}</p>${there ? `<p><a class="btn sm primary" href="${esc(there)}">Open</a></p>` : ''}</div>`;
    window.PenEchoOpening?.ready();
    if (busy) { const wait = setInterval(() => api('/projects').then(() => { clearInterval(wait); location.reload(); }, () => {}), 3000); }
    return;
  }
  S.routes = Object.create(null);
  try {
    const saved = JSON.parse(localStorage.getItem('penecho-lines') || '{}');
    S.tabs = (Array.isArray(saved.tabs) ? saved.tabs : []).filter(id => summaryOf(id)); S.cur = summaryOf(saved.cur) ? saved.cur : null;
    for (const p of S.projects) if (saved.routes?.[p.id]) S.routes[p.id] = projectRoute(saved.routes[p.id]);
  } catch { /* Tabs simply start fresh. */ }
  const initialCanvasHash = window.PenEchoCanvasShell?.enabled?.() ? window.PenEchoCanvasShell.parseCanvasHash(location.hash) : null;
  if (initialCanvasHash && summaryOf(initialCanvasHash.project)) S.cur = initialCanvasHash.project;
  const lastProject = S.cur, r = hashToRoute(location.hash);
  if (r) { S.cur = r.cur; S.route = r.route; }
  S.newPage = location.hash === '#new'; S.shelfPage = parseShelfPage(location.hash);
  // Opened with nothing asked for while you have no project of your own (only My Canvases and the examples): New project, with the examples in the sidebar.
  if (!location.hash && !S.projects.some(p => !p.myCanvases && !p.example) && !HOSTED && !EMBED) { S.newPage = true; S.hashWrite = '#new'; history.replaceState(null, '', '#new'); }
  if (typeof cloudPageFromHash === 'function') cloudPageFromHash();   // Cloud: #cloud/<key> is a page too (cloud.js)
  // Open the last project, or the next one whose folder can still be found.
  const desktopStartup = !location.hash && window.PenEchoOpening?.desktopLaunch;
  const recent = S.projects.filter(p => !p.missing && (!desktopStartup || (!p.example && !p.myCanvases && !p.archived)))
    .sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0)).map(p => p.id);
  const wanted = S.cur;
  for (const id of [...new Set([S.cur, ...recent])].filter(Boolean)) {
    try { await loadState(id, { force:true, route:r?.cur === id ? r.route : lastProjectRoute(id) }); S.cur = id; applyRoles(project()); break; }
    catch { S.cur = null; S.route = { view:'home' }; }
  }
  if (!r || r.cur !== S.cur) S.route = lastProjectRoute(S.cur);
  S.homeLinesOrigin = S.route.view === 'line' && typeof lineHomeLinesOrigin === 'function' ? lineHomeLinesOrigin(S.cur, S.route.line) : null;
  if (typeof setDocRouteProject === 'function') setDocRouteProject(S.cur);
  if (S.cur && !S.tabs.includes(S.cur)) S.tabs.push(S.cur);
  // Old boxes did not include a project ID. Only the last project's explicitly open line identifies an owner.
  if (r?.cur === lastProject && S.cur === lastProject && S.route.view === 'line') {
    const name = 'conv-' + S.route.line, old = name.replace(/[^A-Za-z0-9_-]/g, ch => `_${ch.codePointAt(0).toString(36)}`);
    const nameWithProject = 'conv-' + S.cur + '-' + S.route.line, key = nameWithProject.replace(/[^A-Za-z0-9_-]/g, ch => `_${ch.codePointAt(0).toString(36)}`);
    if (S.comp[old] && !S.comp[key]) { S.comp[key] = S.comp[old]; S.comp[key].project = S.cur; delete S.comp[old]; }
  }
  if (project()) {
    if (!initialCanvasHash) await takeDrawing(project()).catch(error => toast(error.message));
    boxUrls(project());
  }
  if (wanted && S.cur !== wanted) toast('That project\'s folder could not be found. Choose it in the sidebar to fix it.');
  render();
  railLive();
  if (typeof saveWarmRail === 'function') saveWarmRail();
  if (initialCanvasHash && window.PenEchoCanvasShell?.enabled?.()) {
    void window.PenEchoCanvasShell.openFromHash(location.hash, history.state?.canvasTarget || null);
  }
  window.PenEchoOpening?.ready();   // An opening carried on from the Canvas page fades now that there is a page under it (opening.js)
  // Made by the Canvas page's New project, which comes here (start.js).
  try { const made = !EMBED && sessionStorage.getItem('penecho-lines-made'); if (made) { sessionStorage.removeItem('penecho-lines-made'); syncIfNew(made); } } catch { /* Sync conversations is still a click. */ }
  try {
    const raw = !EMBED && sessionStorage.getItem('penecho-lines-import-conflict');
    if (raw) {
      sessionStorage.removeItem('penecho-lines-import-conflict');
      const conflict = JSON.parse(raw);
      if (conflict && (!conflict.projectId || conflict.projectId === S.cur) && typeof toastCodeConflict === 'function') toastCodeConflict(conflict);
    }
  } catch { /* No stored import notice. */ }
  readOpenedLine();
  if (typeof recordOpenedLine === 'function') recordOpenedLine();
  syncHash(true);
  checkAgents();
  if (!EMBED && typeof orchResume === 'function') orchResume();   // A job handed over just before the page was closed is sent now (orchestrator.js)
  setInterval(poll, POLL_MS);
  setInterval(pollActivity, ACTIVITY_MS);
  setInterval(() => { if (!document.hidden && S.route?.view === 'home' && typeof tickRecentTimes === 'function') tickRecentTimes(); }, 20000);
  window.__lines = { S, project, go, poll, lineById, lineState };
  window.PenEchoCanvasShell?.warmSoon?.();
}
boot();
