// A project opens where you left it. Only routes and the line-sidebar choice outlive this page.
const PROJECTS_HIDDEN_KEY = 'penecho-lines-projects-hidden';
let lineProjectsHidden = false, navigationTransition = 0;
const projectPositions = new Map();
try { lineProjectsHidden = !EMBED?.rail && localStorage.getItem(PROJECTS_HIDDEN_KEY) === '1'; } catch { /* Keep this visit's choice. */ }
function projectRoute(route) {
  if (!route || typeof route.view !== 'string' || !Object.hasOwn(VIEWS, route.view)) return { view:'home' };
  const r = { view:route.view };
  for (const key of r.view === 'line' ? ['line', 'step'] : r.view === 'doc' || r.view === 'markup' ? ['doc'] : r.view === 'find' ? ['q'] : []) {
    if (typeof route[key] === 'string') r[key] = route[key];
  }
  return r;
}
const lastProjectRoute = id => projectRoute(S.routes?.[id]);
// A Line can be visited from Home, Orchestrator, or a parent Orchestrator Line. Its return belongs to this history entry.
function lineOrchestratorOrigin(projectId, line) {
  if (typeof HOSTED !== 'undefined' && HOSTED) return null;
  const origin = history.state?.orchestratorOrigin;
  return origin && origin.project === projectId && origin.line === line ? origin : null;
}
function lineParentOrigin(projectId, line) {
  const origin = history.state?.lineOrigin;
  return origin && origin.project === projectId && origin.line === line && origin.fromLine ? origin : null;
}
function lineHomeLinesOrigin(projectId, line) {
  const origin = history.state?.homeLinesOrigin;
  return origin && origin.project === projectId && origin.line === line ? origin : null;
}
function currentHomeLinesOrigin(projectId, line) {
  if (!projectId || !line) return null;
  if (S.homeLinesOrigin?.project === projectId && S.homeLinesOrigin?.line === line) return S.homeLinesOrigin;
  return lineHomeLinesOrigin(projectId, line);
}
function copyLineFilter(filter, line) {
  return filter?.line === line ? { ...filter, known:new Set(filter.known || []), kept:new Set(filter.kept || []) } : null;
}
function projectLineFilter(id, route) {
  const saved = projectPositions.get(id);
  return route.view === 'line' && saved?.route.line === route.line ? copyLineFilter(saved.lineFilter, route.line) : null;
}
function rememberProjectRoute() {
  if (!S.cur || S.newPage || S.shelfPage || EMBED?.rail) return;
  (S.routes ||= Object.create(null))[S.cur] = projectRoute(S.route);
  rememberTabs();
}
function captureProjectPosition() {
  if (!S.cur || S.newPage || S.shelfPage || S.route.view !== 'line' || !$('#linePage')) return;
  projectPositions.set(S.cur, { route:projectRoute(S.route), panelShut:S.panelShut === S.route.line, lineFilter:copyLineFilter(S.lineFilter, S.route.line),
    main:$('#lpScroll')?.scrollTop || 0, list:$('#lpList')?.scrollTop || 0, panel:$('#lppScroll')?.scrollTop || 0 });
}
function projectPosition(id, route) {
  const saved = projectPositions.get(id);
  return saved && route.view === 'line' && saved.route.line === route.line && saved.route.step === route.step ? saved : null;
}
function restoreProjectPosition(saved) {
  if (!saved || !projectPosition(S.cur, S.route)) return;
  for (const [selector, top] of [['#lpScroll', saved.main], ['#lppScroll', saved.panel]]) {
    const el = $(selector); if (el) el.scrollTop = top;
  }
  spyLine();
  const list = $('#lpList'); if (list) list.scrollTop = saved.list;
}
const DOC_RETURN_LABELS = {
  files:'Canvases & files', canvases:'Canvases & files', stats:'Statistics', orchestrator:'Orchestrator',
  topics:'Topics', memory:'Memory', vault:'Vault', find:'Ask AI', archive:'Archive', deleted:'Deleted',
  settings:'Project settings', newline:'New line',
};
let docRouteProject = null;
function setDocRouteProject(id) { docRouteProject = id; }
const docBackTrail = (id = S.cur) => (id ? ((S.docTrails ||= Object.create(null))[id] ||= []) : []);
function docOriginEntry(toDoc, fromKey) {
  if (!S.cur || S.newPage || S.shelfPage || (docRouteProject && docRouteProject !== S.cur)) return null;
  const route = projectRoute(S.route);
  if (route.view === 'markup' || (route.view === 'doc' && route.doc === toDoc)) return null;
  const entry = { toDoc, route, fromKey, viewTop:$('#view')?.scrollTop || 0 };
  if (route.view === 'line') {
    entry.orchestratorOrigin = lineOrchestratorOrigin(S.cur, route.line);
    entry.lineOrigin = lineParentOrigin(S.cur, route.line);
    entry.homeLinesOrigin = currentHomeLinesOrigin(S.cur, route.line);
    entry.panelShut = S.panelShut === route.line;
    entry.lineFilter = copyLineFilter(S.lineFilter, route.line);
    entry.main = $('#lpScroll')?.scrollTop || 0;
    entry.list = $('#lpList')?.scrollTop || 0;
    entry.panel = $('#lppScroll')?.scrollTop || 0;
  }
  return entry;
}
// Remember where each document was opened from so top-left return goes back there rather than Home.
function recordDocNavigation(nextRoute, { from, back = false, docBack = null, keepDocTrail = false } = {}) {
  if (keepDocTrail || docBack) return;
  const trail = docBackTrail(), prevView = S.route?.view;
  if (nextRoute.view === 'doc') {
    if (prevView === 'markup' || back) return;
    const fromKey = from?.dataset?.step || from?.dataset?.line || from?.dataset?.card || from?.dataset?.path || from?.dataset?.doc;
    const entry = docOriginEntry(nextRoute.doc, fromKey);
    if (!entry) return;
    if (prevView !== 'doc') trail.length = 0;
    trail.push(entry);
    return;
  }
  if (nextRoute.view !== 'markup') trail.length = 0;
}
function syncDocTrailOnHash(cur, route) {
  const trail = docBackTrail(cur);
  if (!trail.length || (route.view !== 'doc' && route.view !== 'markup')) return;
  while (trail.length && trail[trail.length - 1].toDoc !== route.doc) trail.pop();
}
function docBackTarget(p, docPath) {
  const trail = docBackTrail(p.id);
  while (trail.length) {
    const entry = trail[trail.length - 1], rt = entry.route;
    if (entry.toDoc !== docPath) { trail.pop(); continue; }
    if (rt.view === 'line') {
      const l = typeof lineById === 'function' && lineById(p, rt.line);
      if (l) return { entry, label:l.title || p.name };
    } else if (rt.view === 'doc') {
      if (typeof fileEntry === 'function' && (fileEntry(p, rt.doc) || (typeof listsFiles === 'function' && !listsFiles(p)))) {
        const d = typeof docById === 'function' && docById(rt.doc, p);
        return { entry, label:d?.title || rt.doc.split('/').pop() || rt.doc };
      }
    } else if (rt.view === 'home') {
      return { entry, label:p.name };
    } else if (rt.view === 'topics' && p.projectTopics === false) {
      trail.pop(); continue;
    } else if (typeof VIEWS === 'object' && Object.hasOwn(VIEWS, rt.view)) {
      const label = rt.view === 'find' && typeof HOSTED !== 'undefined' && HOSTED ? 'Search' : DOC_RETURN_LABELS[rt.view] || p.name;
      return { entry, label };
    }
    trail.pop();
  }
  return null;
}
function restoreDocOriginState(entry) {
  if (!entry || entry.route.view !== 'line') return;
  S.panelShut = entry.panelShut ? entry.route.line : null;
  S.lineFilter = copyLineFilter(entry.lineFilter, entry.route.line);
}
function restoreDocOriginScroll(entry) {
  if (!entry) return;
  if (entry.route.view === 'line') {
    for (const [selector, top] of [['#lpScroll', entry.main], ['#lppScroll', entry.panel]]) {
      const el = $(selector); if (el) el.scrollTop = top || 0;
    }
    if (typeof spyLine === 'function') spyLine();
    const list = $('#lpList'); if (list) list.scrollTop = entry.list || 0;
  } else if (entry.route.view !== 'home') {
    const view = $('#view'); if (view) view.scrollTop = entry.viewTop || 0;
  }
}
// Projects hide from the top of their own sidebar on every page, and come back from the left edge, where the sidebar was: atop the line, or at the start of the bar above.
const projectsToggleHTML = (hide = false) => {
  const label = hide ? 'Hide projects' : 'Show projects';
  return `<button type="button" class="icon-btn ${hide ? 'rail-hide' : 'projects-show'}" data-act="toggle-projects" aria-controls="rail" aria-expanded="${hide}" aria-label="${label}" title="${label}">${ic('panel', 18)}</button>`;
};
function refreshProjectsVisibility() {
  document.body.classList.toggle('projects-hidden', lineProjectsHidden);
  window.PenEchoCanvasShell?.syncChrome?.();
}
ACT['toggle-projects'] = () => {
  // Beside a Canvas the rail is all this page shows: the Canvas page hides it, and brings it back.
  if (EMBED?.rail) { embedTell({ hide:true }); return; }
  lineProjectsHidden = !lineProjectsHidden;
  try { localStorage.setItem(PROJECTS_HIDDEN_KEY, lineProjectsHidden ? '1' : '0'); } catch { /* Keep this visit's choice. */ }
  refreshProjectsVisibility();
};
