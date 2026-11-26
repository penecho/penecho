// This page inside a frame of the Canvas page, in one of two ways.
// The Lines thread as a panel beside an open Canvas:
//   /projects.html?embed=panel&canvas=<the Canvas's file>#<project>/line/<line>   the line that Canvas is on
//   /projects.html?embed=panel&canvas=<the Canvas's file>#<project>/newline       a Canvas on no line yet
// The panel shows one line and its box, nothing else. A note or an Ask on a Canvas with no line makes its line, with that Canvas as the first thing on it.
// The rail, to the left of an open Canvas:
//   /projects.html?embed=rail&canvas=<the Canvas's file>#<project>[/line/<line>]
// Only the rail is drawn, as it is on every other page, with that project open and the Canvas's line marked. There is one rail, so a row added to it shows here too.
// Whatever would leave the line, or the rail, is handed to the Canvas page, which saves the Canvas first and then goes there.
const EMBED = (() => {
  const q = new URLSearchParams(location.search), mode = q.get('embed');
  if (mode !== 'panel' && mode !== 'rail') return null;
  let parts = [];
  try { parts = location.hash.slice(1).split('/').map(decodeURIComponent); } catch { /* A project that cannot be read is simply not marked. */ }
  return { rail:mode === 'rail', canvas:q.get('canvas') || '', project:parts[0] || '', line:parts[1] === 'line' ? parts[2] || '' : '', told:'' };
})();
if (EMBED) document.documentElement.classList.add(EMBED.rail ? 'is-rail' : 'is-embed');
function embedTell(message) { if (EMBED && window.parent !== window) window.parent.postMessage({ source:EMBED.rail ? 'penecho-lines-rail' : 'penecho-lines-panel', ...message }, location.origin); }
// What a line made here says about the Canvas it is beside.
const embedCanvas = () => EMBED?.canvas && !EMBED.rail ? { canvas:EMBED.canvas } : {};
// A line made here needs the Canvas to be a file. The Canvas page writes it when asked, just before the send, so a Canvas you only open writes nothing.
function embedCanvasReady() {
  if (!EMBED?.canvas || EMBED.rail || window.parent === window) return Promise.resolve();
  const ask = Math.random().toString(36).slice(2);
  return new Promise((resolve, reject) => {
    const heard = event => { if (event.origin === location.origin && event.source === window.parent && event.data?.source === 'penecho-canvas' && event.data.file === ask) done(event.data); };
    const done = (data = {}) => {
      removeEventListener('message', heard); clearTimeout(timer);
      if (data.error || (data.canvas && data.canvas !== EMBED.canvas)) reject(new Error(data.error || 'The open Canvas changed. Send again from its sidebar.'));
      else resolve(data.view || null);
    };
    // A Canvas page that does not answer: the send goes ahead and says what the server says.
    const timer = setTimeout(done, 8000);
    addEventListener('message', heard);
    embedTell({ want:'file', ask });
  });
}
const embedKeeps = route => !EMBED || !EMBED.rail && (route.view === 'line' || route.view === 'newline');
// The Canvas page keeps its address in step with the line it now belongs to.
function embedShown(p, route) {
  if (!EMBED || EMBED.rail) return;
  const line = route.view === 'line' ? route.line : '', key = `${p.id}:${line}`;
  if (EMBED.told === key) return;
  EMBED.told = key;
  embedTell({ project:p.id, line, canvas:EMBED.canvas });
}
// The Canvas the panel is beside is already open: its picture in the thread only brings the Canvas forward.
function embedOpens(url) {
  if (!EMBED) return false;
  let source = '', owner = '';
  try { const q = new URL(url, location.href).searchParams; source = q.get('linesCanvas') || ''; owner = q.get('linesProject') || ''; } catch { /* Not a Canvas address. */ }
  // Two projects can each have a Canvas under the same file name.
  embedTell(source && source === EMBED.canvas && (!EMBED.rail || owner === EMBED.project) ? { focus:true } : { leave:url });
  return true;
}

// ---------- The rail beside a Canvas ----------
// render() asks this first. The rail is all there is to draw.
function embedRailOnly() {
  if (!EMBED?.rail) return false;
  // No page of the project is open here, so its own row still opens it.
  if (S.route.view !== 'canvas') S.route = { view:'canvas' };
  refreshChrome();
  embedRailMark();
  return true;
}
// The line this Canvas is on is the row you are on. A Canvas on no line has no row: its project's is lit.
function embedRailMark() {
  for (const row of $$('#rail .rail-line')) {
    const on = Boolean(EMBED.line) && row.dataset.act === 'open-line' && row.dataset.line === EMBED.line && row.dataset.p === EMBED.project && S.cur === EMBED.project;
    if (on !== row.classList.contains('on')) row.classList.toggle('on', on);
  }
}
if (EMBED && !EMBED.rail) {
  // The kept-alive Canvas can hot-switch which Canvas/line this Notes & AI panel shows, or pause it while hidden.
  addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== window.parent || event.data?.source !== 'penecho-canvas') return;
    if (typeof event.data.paused === 'boolean') {
      EMBED.paused = event.data.paused;
      return;
    }
    const next = event.data.switchPanel;
    if (!next || typeof next !== 'object' || !next.project) return;
    EMBED.paused = false;
    EMBED.canvas = String(next.canvas || '');
    EMBED.project = String(next.project);
    EMBED.line = String(next.line || '');
    EMBED.told = '';
    const route = EMBED.line ? { view:'line', line:EMBED.line, ...(next.step ? { step:String(next.step) } : {}) } : { view:'newline' };
    if (S.cur !== EMBED.project && typeof switchProject === 'function') {
      void switchProject(EMBED.project, { route, fresh:Boolean(next.step) });
    } else if (typeof go === 'function') {
      if (next.step && typeof loadState === 'function') {
        void loadState(EMBED.project, { force:true }).then(() => go(route, { replace:true })).catch(() => go(route, { replace:true }));
      } else {
        go(route, { replace:true });
      }
    }
  });
}

if (EMBED?.rail) {
  // A page that is no project's (New project, Archived, Settings, and any added later) is asked for by its address.
  // The frame's own address goes back to what it was, so the browser's Back still leaves the Canvas in one step.
  addEventListener('hashchange', event => {
    event.stopImmediatePropagation();
    if (EMBED.going) { const leave = EMBED.going; EMBED.going = ''; embedTell({ leave }); return; }
    EMBED.going = `/projects.html${location.hash}`;
    history.back();
    setTimeout(() => { if (EMBED.going) { const leave = EMBED.going; EMBED.going = ''; embedTell({ leave }); } }, 600);
  });
  // A plain link in the rail opens in the whole window, once the Canvas is saved.
  document.addEventListener('click', event => {
    const link = event.target.closest?.('a[href]');
    if (!link || link.dataset.act || link.target === '_blank') return;
    event.preventDefault();
    if (link.origin !== location.origin) { window.open(link.href, '_blank', 'noopener'); return; }
    embedTell({ leave:link.pathname === location.pathname ? `/projects.html${link.hash}` : link.pathname + link.search + link.hash });
  }, true);
  // The Canvas page tells the rail when its Canvas has become a line.
  addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== window.parent || event.data?.source !== 'penecho-canvas' || typeof event.data.line !== 'string') return;
    EMBED.line = event.data.line;
    if (typeof poll === 'function') poll();
    embedRailMark();
  });
  document.addEventListener('DOMContentLoaded', () => {
    const rail = $('#rail'), toastEl = $('#toast');
    if (!rail) return;
    new MutationObserver(embedRailMark).observe(rail, { childList:true, subtree:true });
    // The Canvas makes room for the rail as wide as it is: all of it, or only its icons on a narrow window.
    new ResizeObserver(() => embedTell({ width:Math.round(rail.getBoundingClientRect().width) })).observe(rail);
    // A menu or a dialog opened from the rail needs the whole window for as long as it is open.
    let over = false;
    const overNow = () => {
      const next = Boolean($('#menu, dialog[open], #switcher:not([hidden]), #lightbox:not([hidden])'));
      if (next !== over) { over = next; embedTell({ over }); }
    };
    new MutationObserver(overNow).observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['hidden', 'open'] });
    // What the rail has to say is said on the Canvas, where it can be read.
    if (toastEl) new MutationObserver(() => {
      if (toastEl.hidden) return;
      const words = $('span', toastEl)?.textContent || '';
      toastEl.hidden = true;
      if (words) embedTell({ say:words });
    }).observe(toastEl, { childList:true, attributes:true, attributeFilter:['hidden'] });
  });
}
if (EMBED && !EMBED.rail) {
  // Settings and other whole-window pages never open inside the narrow Canvas side panel.
  // Restore the panel's hash so Back still leaves the Canvas in one step, and ask the Canvas page to save and open them.
  addEventListener('hashchange', event => {
    if (EMBED.going) {
      event.stopImmediatePropagation();
      const leave = EMBED.going; EMBED.going = '';
      embedTell({ leave });
      return;
    }
    const hash = location.hash;
    const outside = hash === '#new' || (typeof outsidePage === 'function' && outsidePage(hash));
    const route = !outside && typeof hashToRoute === 'function' ? hashToRoute(hash) : null;
    if (!outside && (!route || embedKeeps(route.route))) return;
    event.stopImmediatePropagation();
    EMBED.going = `/projects.html${hash}`;
    history.back();
    setTimeout(() => { if (EMBED.going) { const leave = EMBED.going; EMBED.going = ''; embedTell({ leave }); } }, 600);
  });
}
