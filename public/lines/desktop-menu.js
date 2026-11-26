// The desktop app's menu bar, on the Projects page (desktop/menu.js builds it). The page tells it what can be done now,
// and carries out what is chosen. Browsers, penecho.ai and the panels beside a Canvas have no menu bar.
(() => {
  const desktop = !EMBED && !HOSTED && window.penechoDesktop;
  if (!desktop?.onMenuCommand || !desktop?.setMenuState) return;
  const VIEWS_BY_COMMAND = { 'view-home':'home', 'view-topics':'topics' };
  const onProject = () => Boolean(S.cur && project() && !S.newPage);
  const quiet = () => !document.querySelector('dialog[open]') && $('#lightbox').hidden;
  function menuState() {
    if (window.PenEchoCanvasShell?.active && !settingsUp()) {
      return window.PenEchoCanvasShell.menuState();
    }
    const p = onProject() ? project() : null, open = Boolean(p && quiet() && !settingsUp()), any = quiet();
    // The same pages the project bar offers: My Canvases is only its Canvases until one becomes a line.
    const work = open && allLines(p).length > 0, lines = open && !p.myCanvases;
    const enabled = {
      'new-line':lines, 'new-note':lines, 'lines-new-canvas':open, find:open, 'new-project':any,
      'view-home':lines || work, 'view-topics':work && p.projectTopics !== false, 'view-files':open,
      'go-back':any && mayGo(-1), 'go-forward':any && mayGo(1),
      'open-settings':any, 'open-agents':any, 'open-mcp':any, 'open-archived':any,
      'theme-light':true, 'theme-dark':true, 'theme-system':true,
    };
    return {
      page:'projects', enabled, topics:Boolean(p && p.projectTopics !== false), theme:window.linesTheme?.get() || 'system', current:p ? p.id : '',
      projects:railOrder().map(x => ({ id:x.id, name:x.name })),
      docsPath:p ? p.vault?.path || p.docsPath || '' : '', codePath:p ? (p.vault?.code?.[0] || {}).path || '' : '',
    };
  }
  let pending = false, previous = '';
  function sync() {
    pending = false;
    const value = menuState(), serialized = JSON.stringify(value);
    if (serialized !== previous) { previous = serialized; desktop.setMenuState(value); }
  }
  const schedule = () => { if (!pending) { pending = true; requestAnimationFrame(sync); } };
  window.PenEchoDesktopMenuSync = schedule;
  // Settings and dialogs close first, so the place chosen is what you see.
  const leaveOverlays = () => { if (settingsUp()) closeSettings(); };
  function perform(command) {
    if (window.PenEchoCanvasShell?.active && !settingsUp()) {
      switch (command) {
        case 'show-projects': {
          const target = window.PenEchoCanvasShell.target;
          const dest = target?.back ? `/projects.html#${target.back}` : target?.project ? `/projects.html#${encodeURIComponent(target.project)}` : '/projects.html';
          void window.PenEchoCanvasShell.close().then(closed => { if (closed) return window.PenEchoCanvasShell.navigateToDestination(dest); });
          return;
        }
        case 'new-project': void window.PenEchoCanvasShell.close().then(closed => { if (closed) ACT['new-project'](); }); return;
        case 'open-settings': window.PenEchoCanvasShell.openSettingsOverCanvas('#settings'); return;
        case 'open-agents': window.PenEchoCanvasShell.openSettingsOverCanvas('#agents'); return;
        case 'open-mcp': window.PenEchoCanvasShell.openSettingsOverCanvas('#agents/apps'); return;
        case 'open-archived': window.PenEchoCanvasShell.openSettingsOverCanvas('#archived'); return;
        default:
          window.PenEchoCanvasShell.sendMenuCommand(command);
          return;
      }
    }
    if (command.startsWith('project:')) { leaveOverlays(); switchProject(command.slice(8)); return; }
    if (command.startsWith('theme-')) { window.linesTheme?.set(command.slice(6)); return; }
    switch (command) {
      case 'go-back': history.go(-1); return;
      case 'go-forward': history.go(1); return;
      case 'new-project': ACT['new-project'](); return;
      case 'open-settings': ACT['open-settings'](); return;
      case 'open-agents': openAgents(); return;
      case 'open-mcp': openAgents('apps'); return;
      case 'open-archived': openSettings('archived'); return;
    }
    if (!onProject()) return;
    leaveOverlays();
    if (VIEWS_BY_COMMAND[command]) go({ view:VIEWS_BY_COMMAND[command] });
    else if (command === 'view-files') go({ view:project().myCanvases ? 'canvases' : 'files' });
    else if (command === 'new-line') { if (S.route.view !== 'home') go({ view:'home' }); requestAnimationFrame(() => ACT['new-line-here']()); }
    else if (command === 'new-note') ACT['new-note-quick']();
    else if (command === 'lines-new-canvas') ACT['new-canvas']();
    else if (command === 'find') { if (S.route.view !== 'find') go({ view:'find' }); requestAnimationFrame(() => $('#findInput')?.focus()); }
  }
  desktop.onMenuCommand(command => { if (typeof command === 'string') perform(command); schedule(); });
  for (const event of ['hashchange', 'popstate', 'focus', 'storage']) addEventListener(event, schedule);
  // Pages, Settings and dialogs are drawn into #app; watching it is enough to know what changed.
  new MutationObserver(schedule).observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['open', 'hidden', 'data-mode'] });
  new MutationObserver(schedule).observe(document.documentElement, { attributes:true, attributeFilter:['data-mode'] });
  schedule();
})();
