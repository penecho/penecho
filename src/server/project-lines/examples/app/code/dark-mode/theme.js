// Light, Dark or System. It runs in <head>, before the page paints, so a dark page never flashes white first.
// The choice is kept on this computer; System follows the computer, and changes with it.
(() => {
  const KEY = "timeline-theme", MODES = ["light", "dark", "system"], dark = matchMedia("(prefers-color-scheme: dark)");
  const read = () => { const mode = localStorage.getItem(KEY); return MODES.includes(mode) ? mode : "system"; };
  const apply = () => { const mode = read(); document.documentElement.dataset.theme = mode === "system" ? (dark.matches ? "dark" : "light") : mode; };
  apply();
  dark.addEventListener("change", apply);
  window.setTheme = mode => { localStorage.setItem(KEY, MODES.includes(mode) ? mode : "system"); apply(); };
  window.currentTheme = read;
})();
