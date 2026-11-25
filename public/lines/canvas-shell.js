// Persistent Canvas host inside the top-level Projects shell.
// Keeps the sidebar (#rail) and in-memory project cache (S.data) alive across every Projects <-> Canvas transition
// and reuses one warm Canvas iframe so switching canvases never triggers a full page reload or blank screen.
(() => {
  const MAX_COLD_MS = 15000, MAX_SWITCH_MS = 10000, SLOW_LEAVE_MS = 6000, WARM_AFTER_MS = 1200;
  const targetCache = new Map();
  const state = {
    active:false,
    target:null,
    // For the Canvas being opened, what need not be read from the folder: a new Canvas (fresh), and the picture to draw on as this page has it.
    handed:null,
    frame:null,
    booted:false,
    openingId:0,
    // asked: the Canvas the frame was last told to open, and by which request. shown: the one it says is open in it now.
    askedKey:'',
    askedId:'',
    shown:null,
    closing:null,
    leaveWaiters:new Map(),
    veilTimer:0,
    canvasMenuState:null,
    lastRouteBeforeCanvas:null,
  };

  function enabled() {
    if (typeof window === 'undefined' || window.top !== window) return false;
    if (typeof EMBED !== 'undefined' && EMBED) return false;
    if (typeof HOSTED !== 'undefined' && HOSTED) return false;
    return true;
  }

  function cacheKey(projectId, source) {
    return `${projectId}\u0000${source}`;
  }

  const keyOf = target => target ? cacheKey(target.project, target.source) : '';

  function normalizeTarget(input) {
    if (!input) return null;
    if (typeof input === 'string') {
      try {
        const url = new URL(input, location.href);
        const q = url.searchParams;
        const projectId = q.get('linesProject') || '';
        const source = q.get('linesCanvas') || '';
        if (!projectId || !source) return null;
        return {
          project:projectId,
          source,
          doc:q.get('linesDoc') || '',
          title:q.get('linesTitle') || '',
          summary:q.get('linesSummary') || '',
          back:q.get('linesBack') || '',
          seed:q.get('linesSeed') || '',
          draft:q.get('linesDraft') === '1',
          originLine:q.get('linesOriginLine') || '',
          originLabel:q.get('linesOriginLabel') || '',
        };
      } catch { return null; }
    }
    if (typeof input === 'object' && input.project && input.source) {
      return {
        project:String(input.project),
        source:String(input.source),
        doc:String(input.doc || ''),
        title:String(input.title || ''),
        summary:String(input.summary || ''),
        back:String(input.back || ''),
        seed:String(input.seed || ''),
        draft:Boolean(input.draft),
        originLine:String(input.originLine || ''),
        originLabel:String(input.originLabel || ''),
      };
    }
    return null;
  }

  const handOver = ({ fresh = false, picture = null }) => fresh || picture?.blob ? { fresh:Boolean(fresh), picture:picture?.blob ? { blob:picture.blob, name:String(picture.name || '') } : null } : null;

  function canvasHashFor(target) {
    return `#${encodeURIComponent(target.project)}/canvas/${encodeURIComponent(target.source)}`;
  }

  function parseCanvasHash(hash) {
    const raw = String(hash || '').replace(/^#/, '');
    const parts = raw.split('/');
    if (parts.length < 3 || parts[1] !== 'canvas') return null;
    try {
      const projectId = decodeURIComponent(parts[0]);
      const source = decodeURIComponent(parts.slice(2).join('/'));
      return projectId && source ? { project:projectId, source } : null;
    } catch { return null; }
  }

  function lineSlugOf(target) {
    if (!target) return '';
    return (/^(?:lines|topics)\/([^/]+)\.md$/.exec(target.doc || '') || [])[1] || target.originLine || '';
  }

  function buildIframeSrc(target) {
    const q = new URLSearchParams({
      shell:'1',
      linesProject:target.project,
      linesCanvas:target.source,
    });
    if (target.doc) q.set('linesDoc', target.doc);
    if (target.title) q.set('linesTitle', target.title);
    if (target.summary) q.set('linesSummary', target.summary);
    if (target.back) q.set('linesBack', target.back);
    if (target.seed) q.set('linesSeed', target.seed);
    if (target.draft) q.set('linesDraft', '1');
    if (target.originLine) q.set('linesOriginLine', target.originLine);
    if (target.originLabel) q.set('linesOriginLabel', target.originLabel);
    return frameSrc(q);
  }
  function frameSrc(q) {
    const desktop = document.documentElement.dataset.desktop;
    if (desktop) q.set('desktopPlatform', desktop);
    if (typeof lineProjectsHidden !== 'undefined' && lineProjectsHidden) q.set('railHidden', '1');
    return `/index.html?${q.toString()}`;
  }

  function stageEl() { return document.getElementById('canvasStage'); }

  function clearVeil() {
    clearTimeout(state.veilTimer);
    state.veilTimer = 0;
    const stage = stageEl();
    if (!stage) return;
    const veil = stage.querySelector('.canvas-stage-veil');
    if (veil) {
      veil.classList.add('is-out');
      setTimeout(() => veil.remove(), 180);
    }
    state.frame?.classList.add('is-ready');
  }

  // at: where the Canvas will have this picture, so it only has to take its place. Anything else waits a moment (lines.css), so a quick opening shows none of it.
  function showVeil(target, thumbSrc, at) {
    const stage = stageEl();
    if (!stage) return;
    clearTimeout(state.veilTimer);
    stage.querySelector('.canvas-stage-veil')?.remove();
    const veil = document.createElement('div');
    veil.className = 'canvas-stage-veil';
    veil.setAttribute('aria-hidden', 'true');
    if (thumbSrc) {
      const pic = document.createElement('div');
      pic.className = at ? 'canvas-stage-thumb is-placed' : 'canvas-stage-thumb';
      const img = document.createElement('img');
      img.src = thumbSrc;
      img.alt = '';
      if (at) Object.assign(img.style, { left:`${at.left}px`, top:`${at.top}px`, width:`${at.width}px`, height:`${at.height}px` });
      pic.append(img);
      veil.append(pic);
    } else {
      const card = document.createElement('div');
      card.className = 'canvas-stage-loading';
      const spin = document.createElement('i');
      spin.className = 'spin';
      const label = document.createElement('span');
      label.textContent = target.title ? `Opening ${target.title}…` : 'Opening Canvas…';
      card.append(spin, label);
      veil.append(card);
    }
    stage.append(veil);
  }

  function thumbFromElement(from) {
    const img = from?.tagName === 'IMG' ? from : from?.querySelector?.('img');
    return img?.naturalWidth ? (img.currentSrc || img.src || '') : '';
  }
  function thumbPlace(from) {
    const img = from?.tagName === 'IMG' ? from : from?.querySelector?.('img');
    return img?.naturalWidth && typeof seedLanding === 'function' ? seedLanding(img.naturalWidth, img.naturalHeight) : null;
  }

  function postToFrame(payload) {
    if (!state.frame?.contentWindow) return false;
    state.frame.contentWindow.postMessage({ source:'penecho-shell', ...payload }, location.origin);
    return true;
  }

  function askToOpen(target) {
    state.askedKey = keyOf(target);
    state.askedId = `open-${++state.openingId}`;
    postToFrame({
      action:'open',
      requestId:state.askedId,
      target,
      handed:state.handed,
      railHidden:Boolean(typeof lineProjectsHidden !== 'undefined' && lineProjectsHidden),
      fullscreen:document.documentElement.classList.contains('is-desktop-fullscreen'),
    });
  }

  function syncChrome() {
    if (!state.frame?.contentWindow || !state.booted) return;
    postToFrame({
      action:'shell-ui',
      railHidden:Boolean(typeof lineProjectsHidden !== 'undefined' && lineProjectsHidden),
      fullscreen:document.documentElement.classList.contains('is-desktop-fullscreen'),
    });
  }

  function syncMenu() {
    if (typeof window.PenEchoDesktopMenuSync === 'function') window.PenEchoDesktopMenuSync();
  }

  function applyShellVisibility(active, draft = false) {
    const stage = stageEl();
    if (stage) {
      stage.hidden = !active;
      stage.inert = false;
      stage.classList.remove('is-warming');
    }
    document.body.classList.toggle('canvas-open', active);
    document.body.classList.toggle('canvas-draft', Boolean(active && draft));
    if (active) {
      if (typeof closeMenu === 'function') closeMenu();
      if (typeof closeSwitcher === 'function') closeSwitcher();
      if (typeof closeLightbox === 'function') closeLightbox();
    }
  }

  function makeFrame(src, title) {
    const frame = document.createElement('iframe');
    frame.id = 'canvasFrame';
    frame.className = 'canvas-stage-frame';
    frame.title = title;
    frame.setAttribute('allow', 'clipboard-read; clipboard-write');
    state.frame = frame;
    state.booted = false;
    frame.src = src;
    // An access page, or an error, is no Canvas: nothing in it answers.
    frame.addEventListener('load', () => {
      let canvas = false;
      try { canvas = frame.contentWindow.projectLinesInShell === true; } catch { /* Another page. */ }
      if (canvas) return;
      frameGone();
      if (state.active) { clearVeil(); return; }
      // Nobody has asked for it yet, so the one that is asked for starts afresh.
      if (state.frame === frame) { frame.remove(); state.frame = null; applyShellVisibility(false); }
    });
    stageEl().prepend(frame);
  }

  // The Canvas page is the slow part of opening a Canvas: about seventy files to load and run. It is started once, out of sight, while this
  // page is at rest, and opens nothing; the first Canvas then opens as quickly as the next ones do. Laid out (.is-warming), so it starts at its real size.
  function warm() {
    const stage = stageEl();
    if (state.frame || state.active || !stage || !enabled()) return;
    stage.inert = true;
    stage.classList.add('is-warming');
    stage.hidden = false;
    makeFrame(frameSrc(new URLSearchParams({ shell:'1', warm:'1' })), 'Canvas');
  }
  function warmSoon() {
    if (!enabled() || state.frame || navigator.connection?.saveData || matchMedia('(max-width: 700px)').matches) return;
    const idle = window.requestIdleCallback || (fn => setTimeout(fn, 200));
    const start = () => {
      if (document.hidden) document.addEventListener('visibilitychange', start, { once:true });
      else idle(warm, { timeout:3000 });
    };
    setTimeout(start, WARM_AFTER_MS);
  }

  async function open(urlOrTarget, { from = null, seeded = false, fresh = false, picture = null, pushHistory = true, replaceHistory = false } = {}) {
    const target = normalizeTarget(urlOrTarget);
    if (!target) {
      if (typeof urlOrTarget === 'string') location.assign(urlOrTarget);
      return false;
    }
    const stage = stageEl();
    if (!enabled() || !stage) {
      if (typeof urlOrTarget === 'string') location.assign(urlOrTarget);
      return false;
    }
    if (state.closing) await state.closing;
    if (!state.active) {
      state.lastRouteBeforeCanvas = location.hash || (S.cur ? `#${routeToHash(S.route)}` : '');
    }
    if (!target.back && state.lastRouteBeforeCanvas && !parseCanvasHash(state.lastRouteBeforeCanvas)) {
      target.back = state.lastRouteBeforeCanvas.replace(/^#/, '');
    }
    targetCache.set(cacheKey(target.project, target.source), { ...target });

    // Close any open Settings modal before revealing the Canvas.
    if (typeof settingsUp === 'function' && settingsUp() && typeof dropSettingsModal === 'function') {
      S.shelfPage = false;
      dropSettingsModal();
    }
    S.newPage = false;
    S.shelfPage = false;

    // Already open in the frame, with nothing else on its way there.
    const sameCanvas = state.active && state.booted && keyOf(state.shown) === keyOf(target) && state.askedKey === keyOf(target);
    state.active = true;
    state.target = target;
    state.handed = handOver({ fresh, picture });

    if (typeof summaryOf === 'function' && summaryOf(target.project)) {
      S.cur = target.project;
    }
    applyShellVisibility(true, target.draft);
    if (typeof renderRail === 'function') renderRail();
    document.title = `${target.title || 'Canvas'} · PenEcho`;

    const h = canvasHashFor(target);
    if (pushHistory || replaceHistory) {
      S.hashWrite = h;
      if (replaceHistory || location.hash === h) history.replaceState({ canvasTarget:target }, '', h);
      else history.pushState({ canvasTarget:target }, '', h);
    }

    if (sameCanvas && !seeded) {
      clearVeil();
      syncChrome();
      syncMenu();
      return true;
    }

    showVeil(target, thumbFromElement(from), seeded ? thumbPlace(from) : null);

    if (!state.frame) {
      // A picture that is handed over needs the page there to take it: it is asked to open once it has started.
      const take = Boolean(state.handed?.picture);
      state.askedKey = take ? '' : keyOf(target);
      makeFrame(take ? frameSrc(new URLSearchParams({ shell:'1', warm:'1' })) : buildIframeSrc(target), target.title || 'Canvas');
      state.veilTimer = setTimeout(clearVeil, MAX_COLD_MS);
    } else {
      state.frame.title = target.title || 'Canvas';
      state.frame.classList.remove('is-ready');
      // A frame still starting is asked as soon as it says it has (ready, below).
      if (state.booted) askToOpen(target);
      state.veilTimer = setTimeout(clearVeil, state.booted ? MAX_SWITCH_MS : MAX_COLD_MS);
    }

    syncMenu();
    return true;
  }

  // The picture a Canvas was handed is in the folder now. Loaded again before anything is drawn, the page finds it there.
  function pictureSaved(project, source, path) {
    const key = cacheKey(project, source), kept = targetCache.get(key);
    if (!kept || kept.seed) return;
    kept.seed = path;
    if (keyOf(state.target) !== key) return;
    state.target.seed = path;
    if (location.hash === canvasHashFor(state.target)) history.replaceState({ canvasTarget:state.target }, '', location.hash);
    postToFrame({ action:'picture-saved', project, canvas:source, path });
  }

  function openFromHash(hash, historyTarget = null) {
    const parsed = parseCanvasHash(hash);
    if (!parsed) return false;
    const cached = historyTarget || targetCache.get(cacheKey(parsed.project, parsed.source));
    let target = cached ? normalizeTarget({ ...cached, project:parsed.project, source:parsed.source }) : null;
    if (!target) {
      const p = typeof project === 'function' ? project(parsed.project) : null;
      const pic = p && typeof canvasByPath === 'function' ? canvasByPath(p, parsed.source) : null;
      target = normalizeTarget({
        project:parsed.project,
        source:parsed.source,
        doc:pic?.topic ? `lines/${pic.topic}.md` : '',
        title:pic?.title || '',
        back:parsed.project,
      });
    }
    return open(target, { pushHistory:false, replaceHistory:false });
  }

  // The Canvas could not be saved, so it is still the one open: the address, the title and the sidebar say so again.
  function stay(shown, why) {
    const target = shown || state.target;
    if (!target) return;
    state.target = state.shown = target;
    state.handed = null;
    state.askedKey = keyOf(target);
    if (typeof summaryOf === 'function' && summaryOf(target.project)) S.cur = target.project;
    const h = canvasHashFor(target);
    S.hashWrite = h;
    if (location.hash !== h) history.replaceState({ canvasTarget:target }, '', h);
    document.title = `${target.title || 'Canvas'} · PenEcho`;
    applyShellVisibility(true, target.draft);
    clearVeil();
    syncChrome();
    syncMenu();
    if (typeof renderRail === 'function') renderRail();
    if (why && typeof toast === 'function') toast(`This Canvas could not be saved, so it stays open. ${why}`);
  }

  // The page in the frame is being loaded again, or is another page. It is asked once more when it has started.
  function frameGone() {
    state.booted = false;
    state.shown = null;
    state.askedKey = '';
    for (const done of [...state.leaveWaiters.values()]) done(true);
  }

  // Resolves once the Canvas is in its folder and let go of: true, or false when it stays open.
  function waitForLeave() {
    if (!state.frame?.contentWindow || !state.booted) return Promise.resolve(true);
    const reqId = `leave-${++state.openingId}`;
    return new Promise(resolve => {
      const slow = setTimeout(() => { if (typeof toast === 'function') toast('Still saving this Canvas…'); }, SLOW_LEAVE_MS);
      state.leaveWaiters.set(reqId, left => {
        clearTimeout(slow);
        state.leaveWaiters.delete(reqId);
        resolve(left);
      });
      postToFrame({ action:'leave', requestId:reqId });
    });
  }

  function refreshAfterCanvasClose(closedProjectId) {
    const pid = closedProjectId || S.cur;
    if (!pid || typeof loadState !== 'function') return;
    const hasPending = typeof pendingDrawing === 'function' && pendingDrawing()?.project === pid;
    void loadState(pid, { force:true, ...(hasPending ? { needs:{ parts:['files'] } } : {}) }).then(async changed => {
      let took = false;
      const p = typeof project === 'function' ? project(pid) : null;
      if (p && typeof pendingDrawing === 'function' && pendingDrawing()?.project === p.id && typeof takeDrawing === 'function') {
        await takeDrawing(p).catch(() => {});
        if (typeof boxUrls === 'function') boxUrls(project());
        took = true;
      }
      if ((changed || took) && !state.active && S.cur === pid) {
        if (took && typeof render === 'function') render();
        else if (typeof refreshAfterChange === 'function') refreshAfterChange();
      }
      if (typeof renderRail === 'function') renderRail();
    }).catch(() => {});
  }

  // True once the Canvas is closed, false when it could not be saved: then it stays, and so does the page you are on.
  function close({ skipSave = false, refresh = true } = {}) {
    if (!state.active) return Promise.resolve(true);
    if (state.closing) return state.closing;
    const closedProjectId = state.target?.project || S.cur;
    state.closing = (async () => {
      if (!skipSave && !await waitForLeave()) return false;
      clearVeil();
      state.active = false;
      state.target = null;
      state.handed = null;
      state.shown = null;
      state.askedKey = '';
      state.canvasMenuState = null;
      applyShellVisibility(false, false);
      syncMenu();
      if (typeof renderRail === 'function') renderRail();
      if (refresh) refreshAfterCanvasClose(closedProjectId);
      return true;
    })().finally(() => { state.closing = null; });
    return state.closing;
  }

  function settingsTabForHash(hash) {
    const h = String(hash || '');
    if (h === '#settings/canvas') return 'canvas';
    if (h === '#settings/general') return 'general';
    if (h === '#agents/canvas') return 'canvas-ai';
    if (h === '#agents/apps' || h === '#agents/mcp' || h === '#settings/apps' || h === '#settings/mcp') return 'apps';
    if (h === '#providers') return 'providers';
    if (h === '#archived') return 'archived';
    return 'agents';
  }

  function openSettingsOverCanvas(hash) {
    if (typeof openSettings !== 'function') return;
    // Remember return label without forcing a full page reload on close.
    try { sessionStorage.removeItem('penecho-settings-return'); } catch {}
    openSettings(settingsTabForHash(hash), { sub:hash === '#agents/prices' ? 'prices' : '' });
    syncMenu();
  }

  function onSettingsClosed(pushed = false) {
    if (!state.active || !state.target) return false;
    const h = canvasHashFor(state.target);
    S.hashWrite = h;
    if (pushed) history.back();
    else history.replaceState({ canvasTarget:state.target }, '', h);
    document.title = `${state.target.title || 'Canvas'} · PenEcho`;
    postToFrame({ action:'sync-settings' });
    syncChrome();
    syncMenu();
    return true;
  }

  async function navigateToDestination(dest) {
    if (!dest) {
      if (await close({ skipSave:true }) && typeof render === 'function') render();
      return;
    }
    let url;
    try { url = new URL(dest, location.href); } catch { await close({ skipSave:true }); return; }
    if (url.origin !== location.origin) { location.assign(url.href); return; }
    // Destination is another Canvas -> hot-switch directly in-place.
    if (url.searchParams.get('linesProject') && url.searchParams.get('linesCanvas')) {
      await open(url.href, { pushHistory:true });
      return;
    }
    const hash = url.hash || '';
    // Settings / Agents / Providers / Archived open as an instant modal over the live Canvas.
    if (state.active && typeof outsidePage === 'function' && outsidePage(hash) && typeof parseShelfPage === 'function' && typeof SETTINGS_PAGES !== 'undefined' && SETTINGS_PAGES.has(parseShelfPage(hash))) {
      openSettingsOverCanvas(hash);
      return;
    }
    if (!await close({ skipSave:true, refresh:true })) return;
    if (hash === '#new') {
      S.newPage = true;
      S.shelfPage = false;
      S.hashWrite = '#new';
      history.pushState(null, '', '#new');
      if (typeof render === 'function') render();
      return;
    }
    if (hash && typeof outsidePage === 'function' && outsidePage(hash)) {
      S.newPage = false;
      S.shelfPage = typeof parseShelfPage === 'function' ? parseShelfPage(hash) : false;
      S.hashWrite = hash;
      history.pushState(null, '', hash);
      if (typeof render === 'function') render();
      return;
    }
    const resolved = hash && typeof hashToRoute === 'function' ? hashToRoute(hash) : null;
    if (resolved) {
      if (resolved.cur !== S.cur || !S.data[resolved.cur]) {
        await switchProject(resolved.cur, { route:resolved.route });
      } else {
        go(resolved.route);
      }
      return;
    }
    // Plain /projects.html with no hash: reveal current project home cleanly.
    S.newPage = false;
    S.shelfPage = false;
    if (typeof render === 'function') render();
    if (typeof syncHash === 'function') syncHash(true);
  }

  function sendMenuCommand(command) {
    if (!state.active || !state.frame?.contentWindow) return false;
    postToFrame({ action:'menu-command', command });
    return true;
  }

  function menuState() {
    if (state.canvasMenuState && typeof state.canvasMenuState === 'object') {
      return { ...state.canvasMenuState, page:'canvas' };
    }
    return { page:'canvas', enabled:{} };
  }

  // Receive events from the kept-alive Canvas iframe.
  if (typeof addEventListener === 'function') {
    addEventListener('message', event => {
      if (event.origin !== location.origin || !state.frame || event.source !== state.frame.contentWindow) return;
      const msg = event.data;
      if (!msg || msg.source !== 'penecho-canvas-shell') return;

      if (msg.ready) {
        state.booted = true;
        const shown = typeof msg.canvas === 'string' ? cacheKey(msg.project, msg.canvas) : state.askedKey;
        // Closed while it was still starting: what it opened is let go of again. Started before anything was asked for, it waits out of sight.
        if (!state.active) {
          if (msg.warm) applyShellVisibility(false);
          else postToFrame({ action:'leave', requestId:'' });
          return;
        }
        if (shown !== keyOf(state.target) || state.handed?.picture && !msg.requestId) {
          // Another Canvas was asked for before the frame could be told, or its picture. Told already, it is on its way there, and the veil stays.
          if (state.askedKey !== keyOf(state.target)) askToOpen(state.target);
          return;
        }
        state.shown = state.target;
        state.handed = null;
        state.askedKey = shown;
        clearVeil();
        syncChrome();
        syncMenu();
        return;
      }

      if (msg.gone) { frameGone(); return; }

      if (typeof msg.left === 'boolean') {
        if (msg.left) state.shown = null;
        state.leaveWaiters.get(msg.requestId)?.(msg.left);
        return;
      }

      if (msg.stayed) {
        const waiter = state.leaveWaiters.get(msg.requestId);
        // A Canvas asked for after this one answers for itself.
        if (waiter || msg.requestId === state.askedId) stay(targetCache.get(cacheKey(msg.project, msg.canvas)) || state.shown, msg.error);
        waiter?.(false);
        return;
      }

      if (msg.menuState && typeof msg.menuState === 'object') {
        state.canvasMenuState = msg.menuState;
        syncMenu();
        return;
      }

      if (msg.showRail === true && typeof ACT === 'object' && typeof ACT['toggle-projects'] === 'function') {
        if (typeof lineProjectsHidden !== 'undefined' && lineProjectsHidden) ACT['toggle-projects']();
        return;
      }

      if (typeof msg.openSettings === 'string' && msg.openSettings) {
        openSettingsOverCanvas(msg.openSettings);
        return;
      }

      if (msg.open && typeof msg.open === 'object') {
        void open(msg.open, { pushHistory:true });
        return;
      }

      if (typeof msg.leave === 'string') {
        state.shown = null;
        void navigateToDestination(msg.leave);
        return;
      }

      // Said by the Canvas that was open before, these are not about the one open now.
      if (state.target && typeof msg.canvas === 'string' && cacheKey(msg.project, msg.canvas) !== keyOf(state.target)) return;

      if (typeof msg.line === 'string' && state.target && (!msg.project || msg.project === state.target.project)) {
        state.target.doc = msg.line ? `lines/${msg.line}.md` : '';
        targetCache.set(cacheKey(state.target.project, state.target.source), { ...state.target });
        if (typeof renderRail === 'function') renderRail();
        if (typeof poll === 'function') void poll();
        return;
      }

      if (typeof msg.title === 'string' && state.target) {
        state.target.title = msg.title;
        targetCache.set(cacheKey(state.target.project, state.target.source), { ...state.target });
        if (state.active) document.title = `${msg.title || 'Canvas'} · PenEcho`;
      }
    });
  }

  window.PenEchoCanvasShell = {
    get active() { return state.active; },
    get target() { return state.target; },
    get booted() { return state.booted; },
    get activeLine() { return state.active ? lineSlugOf(state.target) : ''; },
    get activeProject() { return state.active ? state.target?.project || '' : ''; },
    enabled,
    parseCanvasUrl:normalizeTarget,
    canvasHashFor,
    parseCanvasHash,
    open,
    warmSoon,
    pictureSaved,
    openFromHash,
    close,
    navigateToDestination,
    openSettingsOverCanvas,
    onSettingsClosed,
    syncChrome,
    sendMenuCommand,
    menuState,
  };
})();
