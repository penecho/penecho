// A newer PenEcho for this computer, shown above the sidebar's foot: Update, then the download, then Restart to update.
// Only the desktop app has one (desktop/canvas-preload.js and update-manager.js). The browser, penecho.ai and the
// Canvas's own frames never see it.
const desktopUpdateApi = !EMBED && window.penechoDesktopUpdate || null;
let desktopUpdateState = null;
// Shown only once the app has found a newer release it can install, as the Canvas's update button does.
const DESKTOP_UPDATE_SHOWN = ['available', 'checking', 'downloading', 'ready', 'installing', 'error'];
const desktopUpdateFound = () => Boolean(desktopUpdateState?.updateAvailable && DESKTOP_UPDATE_SHOWN.includes(desktopUpdateState.status));
const desktopUpdatePercent = s => (typeof s?.progress === 'number' && Number.isFinite(s.progress) ? clamp(Math.round(s.progress), 0, 100) : null);
const desktopUpdateReady = s => s?.status === 'ready' || (s?.ready && s.status !== 'installing');

function railUpdateHTML() {
  if (!desktopUpdateFound()) return '';
  const s = desktopUpdateState, v = esc(s.version), pct = desktopUpdatePercent(s);
  if (s.status === 'installing') return `<button type="button" class="rail-update is-busy" disabled title="Restarting to install PenEcho v${v}"><i class="spin" aria-hidden="true"></i><span>Restarting…</span></button>`;
  if (desktopUpdateReady(s)) return `<button type="button" class="rail-update is-ready" data-act="update-restart" title="PenEcho v${v} is ready. Restart to install it.">${ic('retry', 16)}<span>Restart to update</span></button>`;
  if (s.status === 'downloading') return `<button type="button" class="rail-update is-busy" data-act="update-details" title="Downloading PenEcho v${v}" aria-label="Downloading PenEcho v${v}${pct === null ? '' : `, ${pct}%`}" style="--p:${pct ?? 0}%">${ic('download', 16)}<span>Downloading update</span><em>${pct === null ? '' : `${pct}%`}</em><i class="rail-update-bar${pct === null ? ' is-unknown' : ''}" aria-hidden="true"></i></button>`;
  if (s.status === 'error') return `<button type="button" class="rail-update is-bad" data-act="update-details" title="${esc(s.error || 'The update could not be completed.')}">${ic('hint', 16)}<span>Update failed</span><em>Retry</em></button>`;
  return `<button type="button" class="rail-update" data-act="update-download" title="Download PenEcho v${v}. You can keep working while it downloads.">${ic('download', 16)}<span>Update to v${v}</span></button>`;
}
function railUpdateRender() {
  const host = $('#railUpdate'); if (!host) return;
  const next = railUpdateHTML();
  if (host.dataset.h !== next) { host.innerHTML = next; host.dataset.h = next; }
}

// Settings → About: the version this computer runs, and the one thing to do about updates now.
function desktopAboutHTML() {
  const s = desktopUpdateState;
  if (!desktopUpdateApi || !s) return '';
  const pct = desktopUpdatePercent(s), found = desktopUpdateFound();
  let note = 'Checks for updates every few hours.', act = '<button type="button" class="btn sm" data-act="update-check">Check for updates</button>';
  if (s.status === 'checking') { note = 'Checking for updates…'; act = ''; }
  else if (s.status === 'up-to-date') note = 'You have the latest version.';
  else if (s.status === 'installing') { note = `Installing v${esc(s.version)}…`; act = ''; }
  else if (found && desktopUpdateReady(s)) { note = `Version ${esc(s.version)} is ready to install.`; act = '<button type="button" class="btn sm primary" data-act="update-restart">Restart to update</button>'; }
  else if (s.status === 'downloading') { note = `Downloading v${esc(s.version)}${pct === null ? '…' : ` · ${pct}%`}`; act = ''; }
  else if (s.status === 'available') { note = `Version ${esc(s.version)} is available.`; act = '<button type="button" class="btn sm primary" data-act="update-download">Update</button>'; }
  else if (s.status === 'error') { note = esc(s.error || 'The update could not be completed.'); act = '<button type="button" class="btn sm" data-act="update-details">Try again</button>'; }
  const notes = s.version && s.status !== 'up-to-date' ? '<button type="button" class="btn sm" data-act="update-details">What’s new</button>' : '';
  const changelogUrl = typeof CHANGELOG_URL === 'string' ? CHANGELOG_URL : 'https://github.com/penecho/penecho/blob/main/CHANGELOG.md';
  return `<div class="sys-row sys-pref-row sys-update-row"><span class="sys-text"><strong>PenEcho ${esc(s.currentVersion)}</strong><small>${note}</small></span><span class="sys-acts">${notes}${act}<a class="btn sm" href="${changelogUrl}" target="_blank" rel="noopener noreferrer">Changelog</a></span></div>`;
}
const desktopAboutShown = () => typeof settingsUp === 'function' && settingsUp() && sysTabNow() === 'general';

// Every agent still working on this computer, across projects, so a restart is never a surprise.
function workingBeforeRestart() {
  return (S.projects || []).reduce((n, s) => n + (s.id === S.cur && typeof project === 'function' && project() ? working(project()) : summaryWorking(s)), 0);
}
ACT['update-download'] = () => { void desktopUpdateApi?.download(); };
ACT['update-details'] = () => { void desktopUpdateApi?.showWindow(); };
ACT['update-check'] = () => { void desktopUpdateApi?.check(); };
ACT['update-restart'] = () => {
  if (!desktopUpdateApi) return;
  const n = workingBeforeRestart();
  if (n && !confirm(`${n === 1 ? 'An agent is' : `${n} agents are`} still working. Restart PenEcho now? ${n === 1 ? 'It stops and picks' : 'They stop and pick'} up again after the update.`)) return;
  void desktopUpdateApi.install();
};

if (desktopUpdateApi) {
  const apply = state => {
    if (!state) return;
    desktopUpdateState = state;
    railUpdateRender();
    if (desktopAboutShown()) settingsRender();
  };
  desktopUpdateApi.onStateChange(apply);
  void desktopUpdateApi.getState().then(apply, () => {});
}
