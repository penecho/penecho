// Light, Dark or System, for the Projects pages only. It runs in the head, so a page never flashes the wrong colours.
// The Canvas pages never load it, so they stay as they are.
(() => {
  const KEY = 'penecho-lines-theme', MODES = ['light', 'dark', 'system'];
  try {
    const savedLang = localStorage.getItem('penecho-language');
    if (savedLang === 'zh' || savedLang === 'en') document.documentElement.lang = savedLang === 'zh' ? 'zh-CN' : 'en';
  } catch {}
  const dark = matchMedia('(prefers-color-scheme: dark)');
  const read = () => { try { const m = localStorage.getItem(KEY); return MODES.includes(m) ? m : 'system'; } catch { return 'system'; } };
  let mode = read();
  const desktop = window.penechoDesktop;
  if (desktop?.titleBarInset && desktop.platform) {
    document.documentElement.dataset.desktop = desktop.platform;
    desktop.onFullscreenChange?.(full => {
      document.documentElement.classList.toggle('is-desktop-fullscreen', Boolean(full));
      window.PenEchoCanvasShell?.syncChrome?.();
    });
    desktop.isFullscreen?.().then(full => {
      document.documentElement.classList.toggle('is-desktop-fullscreen', Boolean(full));
      window.PenEchoCanvasShell?.syncChrome?.();
    }).catch(() => {});
  }
  const apply = () => {
    const resolved = mode === 'system' ? (dark.matches ? 'dark' : 'light') : mode;
    document.documentElement.dataset.mode = resolved;
    try { desktop?.setTheme?.(mode); } catch {}
  };
  apply();
  dark.addEventListener('change', () => { if (mode === 'system') apply(); });
  // Another tab's choice follows here too.
  addEventListener('storage', e => { if (e.key === KEY) { mode = read(); apply(); } });
  window.linesTheme = {
    get: () => mode,
    set: next => { mode = MODES.includes(next) ? next : 'system'; try { localStorage.setItem(KEY, mode); } catch { /* Keep this visit's choice. */ } apply(); },
  };
})();
