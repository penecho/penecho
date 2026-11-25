// Back and forward, as in a browser, across projects: every page and every project is one step, so the line you left is one Back away.
// Where the browser can say whether there is a step to take, the arrow is dim when there is not.
const mayGo = dir => (typeof navigation === 'undefined' || navigation.canGoBack === undefined ? true : dir < 0 ? navigation.canGoBack : navigation.canGoForward);
const historyKey = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
const historyHTML = () => (EMBED ? '' : `<span class="nav-hist" role="group" aria-label="History">${[[-1, 'left', 'Back', '['], [1, 'right', 'Forward', ']']].map(([dir, icon, label, key]) => `<button type="button" class="icon-btn" data-act="history-go" data-dir="${dir}" aria-label="${label}" title="${label} (${historyKey}${key})" ${mayGo(dir) ? '' : 'disabled'}>${ic(icon, 18)}</button>`).join('')}</span>`);
const syncHistory = () => document.querySelectorAll('.nav-hist [data-dir]').forEach(b => { b.disabled = !mayGo(+b.dataset.dir); });
ACT['history-go'] = el => history.go(+el.dataset.dir);
if (typeof navigation !== 'undefined' && navigation.addEventListener) navigation.addEventListener('currententrychange', () => setTimeout(syncHistory, 0));
// Command or Control with [ and ], as every browser has them; the desktop app has no menu that does it.
document.addEventListener('keydown', e => {
  if (EMBED || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || (e.key !== '[' && e.key !== ']')) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable="true"]') || (typeof fvShown === 'function' && fvShown()) || $('dialog[open]')) return;
  e.preventDefault();
  history.go(e.key === '[' ? -1 : 1);
});
