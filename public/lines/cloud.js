// PenEcho Cloud inside the Lines pages: the account row at the foot of the rail, the projects that are in Cloud,
// Keep in Cloud on a project, a file that has two versions, an Ask that is held back, and the credits under PenEcho's own agent.
// Signed out, none of it shows. The server side is in src/server/project-lines/cloud-share.js; the hooks in the other files say "(cloud.js)".
ICONS.warn ||= '<path d="M12 4l9 15.500H3z"/><path d="M12 10v4.500M12 17.200v.100"/>';
const PLAN_NAME = { free:'Free', starter:'Starter', plus:'Plus', pro:'Pro', max:'Max' };
const planOf = a => PLAN_NAME[String(a?.plan || '').toLowerCase()] || 'Free';
const cloudNumber = n => Number(n).toLocaleString('en-US');
const cloudSize = bytes => bytes >= 1073741824 ? `${(bytes / 1073741824).toFixed(1).replace(/\.0$/, '')} GB` : bytes >= 1048576 ? `${Math.round(bytes / 1048576)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
function cloudAgo(when) {
  const at = typeof when === 'number' ? when : Date.parse(when || ''); if (!Number.isFinite(at)) return '';
  const min = Math.round((Date.now() - at) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  if (min < 24 * 60) { const h = Math.round(min / 60); return `${h} hour${h === 1 ? '' : 's'} ago`; }
  return new Date(at).toLocaleDateString([], { month:'short', day:'numeric' });
}
// Cloud's own words when it refused (project_limit, line_busy …), else PenEcho's.
const cloudSaid = error => error?.data?.message || error?.message || 'PenEcho Cloud did not answer.';
const cloudOrigin = () => S.cloudAccount?.origin || 'https://penecho.ai';
const cloudOpen = path => (HOSTED ? hostedGo(path) : window.open(`${cloudOrigin()}${path}`, '_blank', 'noopener'));   // Hosted: already on penecho.ai, so its page opens here (hosted.js)

// ---------- The account, and the projects it has in Cloud ----------
S.cloudAccount = S.cloudAccount || null;
S.cloudProjects = null;   // { projects:[{ key, name, lines, sizeBytes, updatedAt, here, id? }], kept, limit }
S.cloudKept = {};         // project id → what its own Cloud answer said last, newer than the list
async function loadCloudAccount() {
  let account = null;
  try { account = await api('/cloud/account'); } catch { account = null; }
  const previous = S.cloudAccount;
  S.cloudAccount = account;
  if (typeof refreshCloudSettings === 'function') refreshCloudSettings(previous, account);
  if (account && !account.unavailable) loadComputer();
  if (account?.signedIn) {
    // The list is left as it was when Cloud does not answer, so a row never flickers away.
    try { S.cloudProjects = await api('/cloud/projects'); S.cloudKept = {}; } catch { /* Next minute. */ }
  } else { S.cloudProjects = null; S.cloudKept = {}; }
  S.cloudLoaded = true;
  if (typeof renderRail === 'function') renderRail();
  if (typeof renderSwitcher === 'function' && !$('#switcher')?.hidden) renderSwitcher();
  cloudBar();
  if ((cloudPageKey() || S.shelfPage === 'providers' || (S.shelfPage === 'agents' && typeof SET !== 'undefined' && SET.agentsTab === 'agents')) && typeof render === 'function' && $('#view')) render();
  return account;
}
const cloudList = () => S.cloudAccount?.signedIn ? S.cloudProjects?.projects || [] : [];
const cloudAway = () => cloudList().filter(c => !c.here && !c.archived);
const cloudEntry = p => cloudList().find(c => c.here && c.id === p.id) || null;
// Kept means it syncs. A project whose copy is in Cloud but does not sync from here is not kept, and has no cloud beside its name.
const isKept = p => { const entry = cloudEntry(p); return S.cloudKept[p.id] ? S.cloudKept[p.id].sync : Boolean(entry && entry.syncing !== false); };

function railAccountHTML() {
  const a = S.cloudAccount;
  if (!a || a.unavailable) return '';
  if (!a.signedIn) return S.thisComputer ? `<button type="button" class="rail-shelf rail-account" data-act="cloud-sign-in" title="Sign in to PenEcho Cloud">${ic('cloud', 16)}<span>Sign in</span></button>` : '';
  const plan = planOf(a);
  return `<button type="button" class="rail-shelf rail-account" data-act="cloud-account" aria-haspopup="menu" title="${esc(a.name)}"><i class="acct-av" aria-hidden="true">${esc((a.name || '?')[0].toUpperCase())}</i><span>${esc(a.name)}</span><em class="acct-plan ${plan === 'Free' ? '' : 'paid'}">${plan}</em></button>`;
}
// Sign-in finishes in the browser; the page notices by itself.
async function cloudSignIn(onDone) {
  const { authorizationUrl } = await api('/cloud/sign-in', { method:'POST' });
  window.open(authorizationUrl, '_blank', 'noopener');
  const started = Date.now();
  clearInterval(cloudSignIn.timer);
  cloudSignIn.timer = setInterval(async () => {
    if (Date.now() - started > 5 * 60 * 1000) { clearInterval(cloudSignIn.timer); onDone?.(false); return; }
    const a = await loadCloudAccount();
    if (a?.signedIn) { clearInterval(cloudSignIn.timer); onDone?.(true); }
  }, 2000);
}
ACT['cloud-sign-in'] = () => cloudSignIn(ok => { if (ok) toast(`Signed in as ${S.cloudAccount.name}`); }).catch(error => toast(error.message));
ACT['cloud-account'] = el => {
  const a = S.cloudAccount; if (!a?.signedIn) return;
  const left = a.credits && Number.isFinite(Number(a.credits.available)) ? `${cloudNumber(a.credits.available)} credits left` : '';
  openMenu(el, [
    ...(left ? [{ head:left }] : []),
    { label:'Plan & credits', icon:'cloud', fn:() => cloudOpen('/dashboard.html#billing') },
    { sep:1 },
    { label:'Sign out', icon:'x', disabled:!S.thisComputer, fn:() => api('/cloud/sign-out', { method:'POST' }).then(loadCloudAccount).catch(error => toast(error.message)) },
  ]);
};

// ---------- The rail: a mark on a project kept in Cloud, and the projects that are only there ----------
// The same eight colours a project on this computer gets, picked by the Cloud key so a project keeps its colour.
const CLOUD_COLORS = ['#4f46e5', '#a8502a', '#277a4c', '#3457c9', '#7a5bb5', '#2b303a', '#9a5b12', '#b4232c'];
const cloudColor = key => CLOUD_COLORS[[...String(key)].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7) % CLOUD_COLORS.length];
const RECENT_SYNC_MS = 5 * 60 * 1000;
const syncRecent = at => Number.isFinite(at) && at > 0 && Date.now() - at <= RECENT_SYNC_MS;
const cloudMark = (p = null, { label = 'Kept in PenEcho Cloud', prefix = 'Synced ' } = {}) => {
  const at = Number(p?.cloudSyncedAt) || 0, fresh = syncRecent(at), when = at ? cloudAgo(at) : '';
  const text = when ? `${label} · ${prefix}${when}` : label;
  return `<span class="rail-cloud${fresh ? ' recent' : ''}" role="img" aria-label="${esc(text)}" title="${esc(text)}">${ic('cloud', 14)}</span>`;
};
// A project whose sync has been stuck long enough, or needs the person, says why on its mark (PE-581; cloud-share.js noticeFor).
// Only on the mark: no toast for sync trouble (owner, 2026-11-17).
const cloudStuck = p => (p?.cloudNotice ? `<span class="rail-cloud stuck" role="img" aria-label="Not syncing with PenEcho Cloud: ${esc(p.cloudNotice.message)}" title="Not syncing: ${esc(p.cloudNotice.message)}">${ic('cloud', 14)}</span>` : '');
function cloudRail(host) {
  // On penecho.ai every project is in Cloud: the mark is on those kept in step with a computer.
  if (typeof HOSTED !== 'undefined' && HOSTED) {
    for (const row of host?.querySelectorAll('.rail-row[data-p]') || []) {
      const p = summaryOf(row.dataset.p);
      if (p?.synced) row.querySelector('.rail-name')?.insertAdjacentHTML('afterend', cloudMark(p, { label:'Synced with your computer', prefix:'' }));
    }
    // Other people's projects whose link this account opened: they open in the dashboard beside its rail, and ⋯ takes one out of the list (hosted.js).
    const shared = HOSTED.sharedList || [];
    if (host && shared.length) host.insertAdjacentHTML('beforeend', `<div class="rail-sec">Shared with you</div>${shared.map(x => `<div class="rail-project rail-shared"><div class="rail-item has-fold"><span class="rail-fold" aria-hidden="true">${ic('link', 15)}</span><button type="button" class="rail-row" data-act="open-shared" data-token="${esc(x.token)}" title="${esc(`${x.name} · Shared by ${x.ownerName || 'someone'}`)}"><span class="rail-name">${esc(x.name)}</span></button><button type="button" class="rail-add rail-shared-more" data-act="shared-menu" data-token="${esc(x.token)}" aria-label="More for ${esc(x.name)}" aria-haspopup="menu" title="More">${ic('more', 14)}</button></div></div>`).join('')}`);
    return;
  }
  const list = cloudList(); if (!host || !S.cloudAccount?.signedIn) return;
  const rows = host.querySelectorAll('.rail-row[data-p]');
  for (const row of rows) if (isKept({ id:row.dataset.p })) { const p = summaryOf(row.dataset.p); row.querySelector('.rail-name')?.insertAdjacentHTML('afterend', cloudStuck(p) || cloudMark(p)); }
  const away = cloudAway(), open = cloudPageKey();
  if (away.length) host.insertAdjacentHTML('beforeend', `${rows.length ? '<hr>' : ''}${away.map(c => `<div class="rail-item rail-away" data-rail-key="cloud:${esc(c.key)}"><button type="button" class="rail-row ${open === c.key ? 'on' : ''}" data-act="open-cloud-project" data-key="${esc(c.key)}" ${open === c.key ? 'aria-current="page"' : ''} title="${esc(c.name)} · Open on penecho.ai">${glyph({ name:c.name || '?', color:cloudColor(c.key) }, 22)}<span class="rail-name">${esc(c.name)}</span>${cloudMark(null, { label:c.cloudMade ? 'Cloud-only project · Open on penecho.ai' : 'In PenEcho Cloud · Open on penecho.ai' })}</button></div>`).join('')}`);
}

// ---------- A project that is only in Cloud: a page of its own, like Archived and Settings (S.shelfPage is "cloud/<key>") ----------
const cloudKeyOf = hash => { const m = /^#cloud\/(.+)$/.exec(hash || ''); try { return m ? decodeURIComponent(m[1]) : ''; } catch { return ''; } };
const cloudPageKey = () => typeof S.shelfPage === 'string' && S.shelfPage.startsWith('cloud/') ? S.shelfPage.slice(6) : '';
function cloudPageFromHash() { const key = cloudKeyOf(location.hash); if (key) { S.newPage = false; S.shelfPage = `cloud/${key}`; } }
// Projects absent from this computer open on the web; they never become another local copy.
const cloudOpenProject = key => { if (key) cloudOpen(`/lines/${encodeURIComponent(key)}`); };
ACT['open-cloud-project'] = el => { closeSwitcher(); cloudOpenProject(el.dataset.key); };
addEventListener('hashchange', () => {
  const key = cloudKeyOf(location.hash); if (!key || !$('#view')) return;
  ++navigationTransition;
  saveOpenEdit(); captureProjectPosition(); rememberProjectRoute();
  S.newPage = false; S.shelfPage = `cloud/${key}`; S.hashWrite = location.hash;
  render();
});
function cloudPageHTML(c) {
  const facts = [Number.isFinite(c.lines) && c.lines !== null ? `${c.lines} line${c.lines === 1 ? '' : 's'}` : '', c.sizeBytes ? cloudSize(c.sizeBytes) : '', cloudAgo(c.updatedAt)].filter(Boolean);
  return `<div class="page shelf-page cloud-page">
    <h1>${glyph({ name:c.name || '?', color:cloudColor(c.key) }, 28)}<span>${esc(c.name)}</span></h1>
    <div class="cloud-banner">${ic('cloud', 17)}<span>This project is in PenEcho Cloud. Open it on the web to view it on this computer.</span><button type="button" class="btn primary sm" data-act="cloud-open-web" data-key="${esc(c.key)}">Open on penecho.ai</button></div>
    ${facts.length ? `<p class="cloud-facts">${esc(facts.join(' · '))}</p>` : ''}
  </div>`;
}
// Called by render() before its own outside pages: true when it drew the page. What is on screen is remembered in
// main.js's outsideShown, as Archived, Settings and MeetCue do, so moving between any of them always redraws.
function cloudPageRender(view) {
  const key = cloudPageKey();
  if (!key) return false;
  const c = cloudList().find(x => x.key === key);
  // Signed out, gone from Cloud, or on this computer by now: back to the project that was open.
  if (S.cloudLoaded && (!c || c.here)) { S.shelfPage = false; return false; }
  document.body.classList.remove('is-full', 'has-desk', 'on-line');
  unmountLine(); SHEET?.destroy(); SHEET = null;
  refreshChrome();
  const next = c ? cloudPageHTML(c) : '', same = outsideShown.page === S.shelfPage;
  document.title = `${c ? c.name : 'PenEcho Cloud'} · PenEcho Lines`;
  // Redrawn only when something changed, so a button you are on stays put.
  if (!same || outsideShown.html !== next) view.innerHTML = next;
  if (!same) view.scrollTop = 0;
  outsideShown = { page:S.shelfPage, html:next };
  return true;
}
ACT['cloud-open-web'] = el => cloudOpenProject(el.dataset.key || cloudPageKey());

// ---------- Keep in Cloud, under Share in the project bar ----------
// One switch and one line of state. The Share dialog is only about the link; this is the one place a project is kept or not.
// Signed in, Share becomes Share ▾ with the link and Keep in Cloud; a dot on it says the project is kept (PE-478).
const CLOUD_SYNC_DAY_OPTIONS = [['7', '7 days'], ['30', '30 days'], ['all', 'All']];
const CLOUD_SYNC_DAYS_DEFAULT = '30';
const normalizeSyncDays = value => {
  const s = String(value ?? '').trim().toLowerCase();
  return s === '7' || s === '30' || s === 'all' ? s : CLOUD_SYNC_DAYS_DEFAULT;
};
const syncDaysPayload = value => {
  const norm = normalizeSyncDays(value);
  return norm === 'all' ? 'all' : Number(norm);
};
const cloudHasRemote = s => Boolean(s?.remote && (s.remote.rev === undefined && s.remote.files === undefined ? true : Number(s.remote.rev) > 0 || Number(s.remote.files) > 0));
function cloudSyncRangeHTML(selected, { disabled = false, act = 'project-cloud-sync-days', attr = '' } = {}) {
  const current = normalizeSyncDays(selected);
  return `<div class="seg cloud-sync-seg" role="radiogroup" aria-label="First sync history">${CLOUD_SYNC_DAY_OPTIONS.map(([value, label]) =>
    `<button type="button" role="radio" aria-checked="${current === value}" tabindex="${current === value ? '0' : '-1'}" ${act ? `data-act="${act}"` : ''} ${attr} data-days="${value}" ${disabled ? 'disabled' : ''}><span>${label}</span></button>`
  ).join('')}</div>`;
}
document.addEventListener('keydown', e => {
  const radio = e.target?.closest?.('.cloud-sync-seg[role="radiogroup"] [role="radio"]');
  if (!radio || radio.disabled) return;
  const group = radio.closest('.cloud-sync-seg[role="radiogroup"]');
  const radios = [...group.querySelectorAll('[role="radio"]:not(:disabled)')];
  const at = radios.indexOf(radio);
  if (at < 0 || !radios.length) return;
  let next = -1;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (at + 1) % radios.length;
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (at - 1 + radios.length) % radios.length;
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = radios.length - 1;
  if (next < 0) return;
  e.preventDefault();
  radios[next].focus();
  radios[next].click();
});
function cloudSyncWindowNote(activity) {
  const raw = activity?.syncDays;
  if (raw === undefined || raw === null || raw === '') return '';
  const norm = normalizeSyncDays(raw);
  if (norm === 'all') return '<p class="project-cloud-note">First sync included all history. Synced work stays in Cloud as days grow.</p>';
  const since = Number(activity?.syncSince) || 0;
  const from = since ? ` (since ${esc(new Date(since).toLocaleDateString([], { dateStyle:'medium' }))})` : '';
  return `<p class="project-cloud-note">First sync included the last ${norm} days${from}. Uploaded work stays in Cloud as days grow.</p>`;
}
const KEEP = { id:'', status:null, busy:'', progress:null, error:'', limit:null, syncDays:CLOUD_SYNC_DAYS_DEFAULT };
// How far a first upload is: the share of its bytes sent (of its files when sizes are unknown), with a bar under the words.
const keepPercent = g => Math.max(0, Math.min(100, Math.floor(100 * (g.totalBytes > 0 ? g.bytes / g.totalBytes : g.total > 0 ? g.done / g.total : 0))));
function keepProgressHTML(g) {
  if (g?.phase !== 'uploading' || !g.total) return `<p class="keep-state"><i class="spin"></i>Getting the files ready</p><div class="keep-bar is-waiting" aria-hidden="true"><i></i></div>`;
  const pct = keepPercent(g);
  return `<p class="keep-state"><i class="spin"></i><span>Uploading ${cloudNumber(g.done)} of ${cloudNumber(g.total)} files</span><b class="keep-pct">${pct}%</b></p><div class="keep-bar" role="progressbar" aria-label="Uploading to PenEcho Cloud" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>`;
}

function projectCloudSettingsHTML(project) {
  if (project.myCanvases || project.readOnly || HOSTED?.read || HOSTED?.shared) return '';
  const message = HOSTED?.onComputer ? 'Manage sharing and sync in PenEcho on the computer that syncs this project.' : 'Checking PenEcho Cloud…';
  return `<section class="set-row project-cloud-settings" id="projectCloudSettings" aria-labelledby="projectCloudTitle">
    <h2 id="projectCloudTitle" tabindex="-1">${ic('cloud', 17)}Cloud and sharing</h2>
    <div class="project-cloud-body set-text"><p role="status">${message}</p></div>
  </section>`;
}

const cloudSettingButton = (action, label, style = '', disabled = false) => `<button type="button" class="btn sm ${style}" data-act="project-cloud-setting" data-command="${action}" ${disabled ? 'disabled' : ''}>${label}</button>`;
const cloudSettingsShared = status => Boolean(status?.remote?.share || status?.shared);
function cloudSettingsBody(model) {
  const { status, activity, busy, issue, problem, hosted } = model;
  const progress = activity?.progress;
  const transfer = progress || busy === 'enable' || (busy === 'create' && !hosted && !status?.remote);
  const moving = transfer ? keepProgressHTML(progress) : '';
  if (issue) return `<p role="status">Cloud status unavailable.</p><p class="project-cloud-error">${esc(problem || issue)}</p>${moving}${cloudSettingButton('refresh', 'Retry', '', Boolean(busy))}`;
  if (!status) return `<p role="status">Checking PenEcho Cloud…</p>${moving}`;
  if (!status.signedIn) return `<div class="project-cloud-row"><p>Sign in to check sharing status or sync this project.</p>${cloudSettingButton('signin', 'Sign in', 'primary')}</div>`;
  const share = status.remote?.share;
  const linked = Boolean(share && !share.ended && status.link);
  const sharing = linked ? 'Anyone with the link can read and add notes.' : share?.ended ? 'The old link no longer works.' : hosted ? 'Create a link so others can read and add notes.' : 'Creating a link also keeps this project synced to Cloud.';
  const when = Number(activity?.syncedAt) || 0;
  const synced = when ? `<p>Last successful sync this session: <time datetime="${new Date(when).toISOString()}">${esc(new Date(when).toLocaleString([], { dateStyle:'medium', timeStyle:'short' }))}</time></p>` : '<p>Last sync time unavailable.</p>';
  const syncOn = Boolean(activity?.sync);
  const firstSync = !hosted && !syncOn && !cloudHasRemote(status);
  const shared = cloudSettingsShared(status);
  const stopLabel = status.key ? 'Disconnect this computer' : 'Remove Cloud copy';
  const error = problem || activity?.error;
  const notice = typeof activity?.notice === 'string' ? activity.notice : activity?.notice?.message;
  return `<div class="project-cloud-row">
    <div><strong>Share link · ${linked ? 'Active' : share?.ended ? 'Expired' : 'Not shared'}</strong><p>${sharing}${linked && share.expiresAt ? ` Expires ${esc(shareDate(share.expiresAt))}.` : ''}</p></div>
    <div class="project-cloud-actions">${linked ? cloudSettingButton('copy', 'Copy link', 'primary', Boolean(busy)) : cloudSettingButton('create', share?.ended ? 'Share again' : 'Create link', 'primary', Boolean(busy))}${shared ? cloudSettingButton('stop', 'Stop sharing', '', Boolean(busy)) : ''}</div>
  </div>
  ${hosted ? '' : `<div class="project-cloud-row">
    <div><strong>Cloud sync · ${syncOn ? 'On' : transfer ? 'Starting' : 'Off'}</strong>${syncOn ? `${synced}${cloudSyncWindowNote(activity)}` : transfer ? '' : `<p>${status.key && cloudHasRemote(status) ? 'The Cloud project stays online. This computer is not syncing.' : 'This computer is not syncing the project to Cloud.'}</p>`}
      ${syncOn && shared ? `<p>Stop sharing before you ${status.key ? 'disconnect this computer' : 'remove the Cloud copy'}.</p>` : ''}</div>
    <div class="project-cloud-actions">${syncOn ? cloudSettingButton('remove', stopLabel, '', Boolean(busy || shared)) : cloudSettingButton('enable', 'Enable sync', '', Boolean(busy))}</div>
  </div>`}
  ${firstSync ? `<div class="project-cloud-row project-cloud-history">
    <div><strong>First sync history</strong><p>Only applies to the first upload. Synced work stays in Cloud as days grow; only new work syncs later.</p></div>
    <div class="project-cloud-actions">${cloudSyncRangeHTML(model.syncDays, { disabled:Boolean(busy || transfer), act:'project-cloud-sync-days' })}</div>
  </div>` : ''}
  ${moving ? `<div class="project-cloud-feedback" role="status">${moving}</div>` : busy ? `<p class="project-cloud-feedback" role="status">${{ create:'Creating link…', stop:'Stopping sharing…', remove:status.key ? 'Disconnecting this computer…' : 'Removing the Cloud copy…' }[busy] || 'Checking PenEcho Cloud…'}</p>` : ''}
  ${error ? `<p class="project-cloud-feedback project-cloud-error" role="alert">${esc(error)}</p>` : ''}
  ${notice && notice !== error ? `<p class="project-cloud-feedback">${esc(notice)}</p>` : ''}`;
}

let cloudSettings;
const cloudSettingsMounted = model => model === cloudSettings && model.root.isConnected && project()?.id === model.project.id;
function paintCloudSettings(model) {
  if (!cloudSettingsMounted(model)) return;
  const body = $('.project-cloud-body', model.root), next = cloudSettingsBody(model);
  if (body._html === next) return;
  const active = body.contains(document.activeElement) ? document.activeElement : null;
  const command = active?.dataset.command, days = active?.dataset.days;
  body.innerHTML = body._html = next;
  if (command) ($(`[data-command="${command}"]:not(:disabled)`, body) || $('[data-command]:not(:disabled)', body) || $('#projectCloudTitle', model.root))?.focus();
  else if (days) ($(`[data-days="${days}"]:not(:disabled)`, body) || $('#projectCloudTitle', model.root))?.focus();
}
async function readCloudSettings(model, { local = false } = {}) {
  const field = local ? 'activityRead' : 'statusRead';
  if (!cloudSettingsMounted(model) || model[field] || (!local && model.busy)) return;
  const revision = model.revision;
  model[field] = true;
  if (!local) model.checkedAt = Date.now();
  try {
    const next = await api(`${pathFor(model.project.id)}/cloud${local ? '?activity=1' : ''}`);
    if (!cloudSettingsMounted(model) || revision !== model.revision) return;
    if (!local) {
      model.revision++;
      model.status = model.activity = next;
      model.issue = next.statusError || '';
      if (!model.issue && !model.hosted) keepSeen(model.project, next);
    } else {
      const previous = model.activity;
      model.activity = next;
      if (previous && ['signedIn', 'accountVersion', 'sync', 'shared', 'key'].some(key => next[key] !== previous[key])) {
        if (next.signedIn !== previous.signedIn || next.accountVersion !== previous.accountVersion) {
          model.revision++;
          model.status = null;
          model.problem = '';
          model.issue = '';
          model.checkedAt = 0;
        }
        if (!model.busy) {
          if (model.status) model.issue = 'Checking for changes to this project.';
          void readCloudSettings(model);
        }
      }
    }
  } catch (error) {
    if (cloudSettingsMounted(model) && revision === model.revision && !local) model.issue = cloudSaid(error);
  } finally {
    model[field] = false;
    paintCloudSettings(model);
  }
}
function mountProjectCloudSettings(project) {
  const root = $('#projectCloudSettings');
  if (!root || HOSTED?.onComputer) return;
  if (cloudSettings?.project.id === project.id && cloudSettings.timer) {
    cloudSettings.root = root;
    paintCloudSettings(cloudSettings);
    return;
  }
  const model = cloudSettings = { root, project, hosted:Boolean(HOSTED), revision:0, checkedAt:0, syncDays:CLOUD_SYNC_DAYS_DEFAULT };
  model.poll = () => {
    clearTimeout(model.timer);
    if (!cloudSettingsMounted(model)) { model.timer = null; return; }
    if (!document.hidden) {
      if (!model.busy && Date.now() - model.checkedAt >= 45_000) void readCloudSettings(model);
      if (!model.hosted) void readCloudSettings(model, { local:true });
    }
    model.timer = setTimeout(model.poll, model.busy || model.activity?.progress ? 1000 : 3500);
  };
  model.poll();
}
async function changeCloudSettings(model, command) {
  if (!cloudSettingsMounted(model) || model.busy || model.issue || !model.status?.signedIn) return;
  model.revision++;
  model.busy = command;
  model.problem = '';
  paintCloudSettings(model);
  const syncing = command === 'enable' || command === 'remove';
  const firstSync = !model.hosted && !model.activity?.sync && !cloudHasRemote(model.status);
  const options = syncing
    ? { method:'POST', body:{ sync:command === 'enable', ...(command === 'enable' && firstSync ? { syncDays:syncDaysPayload(model.syncDays) } : {}) } }
    : command === 'create'
      ? { method:'POST', ...(firstSync ? { body:{ syncDays:syncDaysPayload(model.syncDays) } } : {}) }
      : { method:'DELETE' };
  try {
    const request = api(`${pathFor(model.project.id)}/${syncing ? 'cloud' : 'share'}`, options);
    model.poll();
    const next = await request;
    if (!model.hosted && model.activity && model.activity.accountVersion !== next.accountVersion) {
      model.checkedAt = 0;
      return;
    }
    model.revision++;
    model.status = model.activity = next;
    model.checkedAt = Date.now();
    if (!model.hosted) keepSeen(model.project, next);
  } catch (error) {
    model.revision++;
    model.problem = cloudSaid(error);
    model.issue = 'The change could not be confirmed.';
    model.checkedAt = 0;
  } finally {
    model.busy = '';
    if (!model.checkedAt) void readCloudSettings(model);
    paintCloudSettings(model);
  }
}
const cloudSettingsCanRemove = model => !model.hosted && !model.issue && !model.busy && model.status?.signedIn && model.activity?.sync && !cloudSettingsShared(model.status);
function confirmCloudSettingsRemoval(model, trigger) {
  const attached = model.status.key;
  const title = attached ? 'Disconnect this computer?' : 'Remove the Cloud copy?';
  const consequence = attached ? 'Sync stops on this computer. Your local files and the original Cloud project stay.' : 'Sync stops, and the Cloud copy is deleted and no longer accessible. Your files on this computer stay.';
  const dialog = document.createElement('dialog');
  dialog.className = 'line-command-dialog';
  dialog.setAttribute('aria-labelledby', 'cloudRemoveTitle');
  dialog.setAttribute('aria-describedby', 'cloudRemoveWhy');
  dialog.innerHTML = `<form><h2 id="cloudRemoveTitle">${title}</h2><p id="cloudRemoveWhy">${consequence}</p><footer><button type="button" class="btn" data-cancel autofocus>Cancel</button><button type="submit" class="btn danger">${attached ? 'Disconnect' : 'Remove Cloud copy'}</button></footer></form>`;
  document.body.append(dialog);
  $('[data-cancel]', dialog).onclick = () => dialog.close();
  dialog.addEventListener('close', () => { dialog.remove(); if (trigger.isConnected && !trigger.disabled) trigger.focus(); });
  $('form', dialog).onsubmit = event => {
    event.preventDefault();
    dialog.close();
    if (cloudSettingsMounted(model) && cloudSettingsCanRemove(model) && attached === model.status.key) void changeCloudSettings(model, 'remove');
  };
  dialog.showModal();
}
ACT['project-cloud-sync-days'] = (button) => {
  const model = cloudSettings;
  if (!model || !cloudSettingsMounted(model) || !model.root.contains(button) || model.busy) return;
  model.syncDays = normalizeSyncDays(button.dataset.days);
  paintCloudSettings(model);
};
ACT['project-cloud-setting'] = (button) => {
  const model = cloudSettings, command = button.dataset.command;
  if (!model || !cloudSettingsMounted(model) || !model.root.contains(button) || model.busy) return;
  if (command === 'refresh') return readCloudSettings(model);
  if (command === 'signin') return cloudSignIn(ok => { if (ok) void readCloudSettings(model); }).catch(error => toast(cloudSaid(error)));
  if (model.issue || !model.status?.signedIn) return;
  if (command === 'copy') return model.status.remote?.share && !model.status.remote.share.ended && model.status.link && copyText(model.status.link, 'Link copied');
  if (command === 'remove') return cloudSettingsCanRemove(model) && confirmCloudSettingsRemoval(model, button);
  if (command === 'create' || command === 'stop' || (command === 'enable' && !model.hosted)) return changeCloudSettings(model, command);
};

const keepable = p => Boolean(p && S.cloudAccount?.signedIn && !p.myCanvases && !p.archived && !HOSTED);
// penecho.ai: a project kept in step with a computer says, in its bar, when the computer last synced it (Cloud's computerSyncedAt).
function syncedTag(bar) {
  const right = bar && $('.bar-right', bar); if (!right) return;
  const at = HOSTED.onComputer && !HOSTED.shared ? Number((HOSTED.list || []).find(c => c.key === HOSTED.key)?.computerSyncedAt) || 0 : 0;
  let tag = $('.bar-synced', right);
  if (!at) { tag?.remove(); return; }
  if (!tag) { right.insertAdjacentHTML('afterbegin', `<span class="bar-synced">${ic('cloud', 14)}<span></span></span>`); tag = $('.bar-synced', right); }
  const words = `Synced from your computer ${cloudAgo(at)}`;
  if (tag.lastChild.textContent !== words) tag.lastChild.textContent = words;
  tag.title = `Last synced from your computer: ${new Date(at).toLocaleString([], { dateStyle:'medium', timeStyle:'short' })}`;
}
// Called after the project bar is drawn, and whenever what is known about Cloud changes.
function cloudBar(bar = $('#projbar'), p = project()) {
  if (typeof HOSTED !== 'undefined' && HOSTED) syncedTag(bar);
  const share = bar && $('.bar-share', bar); if (!share) return;
  const menu = keepable(p) && !S.newPage && underPage(), kept = menu && isKept(p);
  share.dataset.act = menu ? 'share-menu' : 'project-share';
  share.dataset.keep = menu ? (kept ? 'on' : 'off') : '';
  // Its words go away on a phone, so its name is said here whatever shows.
  share.title = kept ? 'Share project · Kept in PenEcho Cloud' : 'Share project';
  share.setAttribute('aria-label', kept ? 'Share project, kept in PenEcho Cloud' : 'Share project');
  if (menu) share.setAttribute('aria-haspopup', 'menu'); else share.removeAttribute('aria-haspopup');
  const caret = $('.bar-share-caret', share);
  if (menu && !caret) share.insertAdjacentHTML('beforeend', `<span class="bar-share-caret">${ic('down', 13)}</span>`);
  if (!menu) caret?.remove();
}
ACT['share-menu'] = el => {
  const p = project(); if (!p) return;
  const kept = isKept(p);
  openMenu(el, [
    { label:'Share link…', icon:'link', fn:() => ACT['project-share'](el) },
    { label:kept ? 'Kept in Cloud' : 'Keep in Cloud', icon:'cloud', on:kept, fn:() => ACT['cloud-keep'](el) },
  ], { align:'right' });
};
// What a project's own Cloud answer said: the Share dialog tells it too, since sharing keeps the project in Cloud.
function keepSeen(p, status) {
  if (!p || !status?.signedIn) return;
  S.cloudKept[p.id] = { sync:Boolean(status.sync || status.shared) };
  const summary = summaryOf(p.id);
  if (summary) {
    if (status.sync && status.syncedAt) summary.cloudSyncedAt = status.syncedAt;
    else if (!status.sync) delete summary.cloudSyncedAt;
  }
  if (KEEP.id === p.id) KEEP.status = status;
  cloudBar(); renderRail();
}
// A free account that already keeps all it can is told so before the switch is offered.
function keepLimit() {
  const a = S.cloudAccount, kept = a?.kept?.projects ?? S.cloudProjects?.kept, limit = a?.kept?.limit ?? S.cloudProjects?.limit;
  return planOf(a) === 'Free' && Number.isFinite(kept) && Number.isFinite(limit) && limit !== null && kept !== null && kept >= limit ? { kept, limit } : null;
}
const keepHasRemote = p => cloudHasRemote(KEEP.status) || (!KEEP.status && Boolean(cloudEntry(p)));
function keepPopHTML(p) {
  const on = isKept(p), limit = KEEP.limit || (!on && !KEEP.busy ? keepLimit() : null);
  if (limit) return `<strong>Free keeps ${limit.limit} project${limit.limit === 1 ? '' : 's'} in Cloud</strong><p class="keep-state">You have ${limit.kept}. Any plan keeps every project.</p><button type="button" class="btn primary sm" data-keep-plans>See the plans</button>`;
  // Turning it off deletes the copy in Cloud, so it asks first. The project on this computer is not touched.
  if (on && KEEP.asking && !KEEP.busy) return `<strong>Take it out of PenEcho Cloud?</strong><p class="keep-state">Its copy in Cloud is deleted. The project on this computer stays.</p><div class="keep-ask"><button type="button" class="btn sm" data-keep-stay>Keep it</button><button type="button" class="btn sm danger" data-keep-out>Take it out</button></div>`;
  const head = `<div class="keep-head"><strong>${on ? 'Kept in PenEcho Cloud' : 'Keep in PenEcho Cloud'}</strong><button type="button" class="switch ${on || KEEP.busy === 'on' ? 'on' : ''}" role="switch" aria-checked="${on}" aria-label="Keep in PenEcho Cloud" data-keep-switch ${KEEP.busy ? 'disabled' : ''}></button></div>`;
  const g = KEEP.progress, remote = KEEP.status?.remote || cloudEntry(p), problem = KEEP.error || (on && !KEEP.busy ? KEEP.status?.error : '');
  // A first upload that was cut off carries on by itself each minute: while it does, the box shows how far it is, under what happened.
  const going = on && !KEEP.busy && KEEP.status?.progress?.phase === 'uploading' ? KEEP.status.progress : null;
  const state = going ? `${problem ? `<p class="keep-state is-bad" role="alert">${esc(problem)}</p>` : ''}${keepProgressHTML(going)}`
    : problem ? `<p class="keep-state is-bad" role="alert">${esc(problem)}</p>`
    : KEEP.busy === 'on' ? keepProgressHTML(g)
    : KEEP.busy === 'off' ? `<p class="keep-state"><i class="spin"></i>Taking it out of PenEcho Cloud</p>`
    : on ? `<p class="keep-state">${esc([KEEP.status?.skipped?.length ? `Synced with ${KEEP.status.skipped.length} skipped file${KEEP.status.skipped.length === 1 ? '' : 's'}` : 'Up to date', cloudAgo(remote?.updatedAt), remote?.sizeBytes ? cloudSize(remote.sizeBytes) : ''].filter(Boolean).join(' · '))}</p>`
    : `<p class="keep-state">Your code stays on this computer.</p>`;
  const firstSyncRange = !on && !KEEP.busy && !keepHasRemote(p)
    ? `<div class="keep-range"><span class="keep-range-label">First sync</span>${cloudSyncRangeHTML(KEEP.syncDays, { act:'', attr:'data-keep-days' })}<p class="keep-range-note">Older work stays here; uploaded work stays in Cloud as days grow.</p></div>`
    : '';
  // What the last round with Cloud had to say, such as files it left alone.
  const notice = KEEP.status?.notice && !problem && !KEEP.busy ? `<p class="keep-state keep-notice">${esc(KEEP.status.notice)}${KEEP.status.noticeAt ? `<span>${esc(cloudAgo(new Date(KEEP.status.noticeAt).toISOString()))}</span>` : ''}</p>` : '';
  return `${head}${state}${firstSyncRange}${notice}${on && !KEEP.busy ? `<button type="button" class="btn sm" data-keep-open>${ic('link', 14)}Open on penecho.ai</button>` : ''}`;
}
function keepPaint() {
  const m = $('#menu.cloud-pop'), p = project(), anchor = $('.bar-share');
  if (!m) return;
  if (!p || p.id !== KEEP.id || !anchor) { closeMenu(); return; }
  const active = m.contains(document.activeElement) ? document.activeElement : null;
  const days = active?.hasAttribute('data-keep-days') ? active.dataset.days : '';
  const next = keepPopHTML(p);
  if (m.dataset.h !== next) {
    m.innerHTML = next; m.dataset.h = next;
    if (days) m.querySelector(`[data-keep-days][data-days="${days}"]:not([disabled])`)?.focus();
    else if (active) (m.querySelector('[data-keep-switch]:not([disabled])') || m.querySelector('button'))?.focus();
  }
  const vp = typeof pageViewport === 'function' ? pageViewport() : { width:innerWidth, height:innerHeight };
  const rectOf = el => typeof pageRect === 'function' ? pageRect(el) : el.getBoundingClientRect();
  const r = rectOf(anchor), mr = rectOf(m);
  m.style.left = clamp(r.right - mr.width, 8, Math.max(8, vp.width - mr.width - 8)) + 'px';
  m.style.top = clamp(r.bottom + 6, 8, Math.max(8, vp.height - mr.height - 8)) + 'px';
}
function keepOutside(e) {
  if (!$('#menu.cloud-pop')) { document.removeEventListener('pointerdown', keepOutside); return; }
  if (e.target.closest('#menu, .bar-share')) return;
  document.removeEventListener('pointerdown', keepOutside); closeMenu();
}
async function keepSet(p, on) {
  if (KEEP.busy) return;
  KEEP.busy = on ? 'on' : 'off'; KEEP.error = ''; KEEP.progress = null; keepPaint();
  // A first upload can take a while; it says how far along it is.
  const peek = on ? setInterval(async () => { try { const now = await api(`${pathFor(p.id)}/cloud`); if (KEEP.id === p.id && KEEP.busy) { KEEP.progress = now.progress; keepPaint(); } } catch { /* The request itself reports. */ } }, 1000) : 0;
  const firstSync = on && !keepHasRemote(p);
  try {
    const seen = await api(`${pathFor(p.id)}/cloud`, { method:'POST', body:{ sync:on, ...(firstSync ? { syncDays:syncDaysPayload(KEEP.syncDays) } : {}) } });
    keepSeen(p, seen);
    // Cut off part way, the switch stays on and the box says what happened; the upload carries on by itself.
    if (on && !seen?.error) toast(`${p.name} is kept in PenEcho Cloud`);
  } catch (error) {
    if (error.data?.error === 'project_limit') KEEP.limit = { kept:error.data.details?.kept ?? keepLimit()?.kept ?? 3, limit:error.data.details?.limit ?? 3 };
    else KEEP.error = cloudSaid(error);
  }
  clearInterval(peek);
  KEEP.busy = ''; KEEP.progress = null;
  keepPaint();
  loadCloudAccount().then(keepPaint);
}
ACT['cloud-keep'] = async el => {
  const p = project(); if (!p) return;
  if ($('#menu.cloud-pop')) { closeMenu(); return; }
  closeMenu();
  // A switch still turning keeps what it was saying when the box is opened again.
  if (KEEP.id !== p.id || !KEEP.busy) Object.assign(KEEP, { id:p.id, status:null, busy:'', progress:null, error:'', limit:null, syncDays:CLOUD_SYNC_DAYS_DEFAULT });
  KEEP.asking = false;
  const m = document.createElement('div');
  m.className = 'menu cloud-pop'; m.id = 'menu'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-label', 'Keep in PenEcho Cloud');
  document.body.append(m);
  m.addEventListener('click', e => {
    const days = e.target.closest('[data-keep-days]');
    if (days) { KEEP.syncDays = normalizeSyncDays(days.dataset.days); keepPaint(); }
    else if (e.target.closest('[data-keep-switch]')) { if (isKept(project())) { KEEP.asking = true; keepPaint(); } else keepSet(project(), true); }
    else if (e.target.closest('[data-keep-stay]')) { KEEP.asking = false; keepPaint(); }
    else if (e.target.closest('[data-keep-out]')) { KEEP.asking = false; keepSet(project(), false); }
    else if (e.target.closest('[data-keep-plans]')) { closeMenu(); cloudOpen('/dashboard.html#billing'); }
    else if (e.target.closest('[data-keep-open]')) { closeMenu(); cloudOpen('/dashboard.html#projects'); }
  });
  m.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); $('.bar-share')?.focus(); } });
  setTimeout(() => document.addEventListener('pointerdown', keepOutside), 0);
  keepPaint();
  m.querySelector('button')?.focus();
  try { keepSeen(p, await api(`${pathFor(p.id)}/cloud`)); } catch (error) { if (KEEP.id === p.id && !KEEP.busy) KEEP.error = cloudSaid(error); }
  keepPaint();
  keepFollow(p);
};
// While the box is open on a project whose upload carries on by itself, it is read again every 3 seconds.
function keepFollow(p) {
  clearTimeout(KEEP.follow);
  if (KEEP.id !== p.id || KEEP.busy || !$('#menu.cloud-pop') || !(KEEP.status?.progress || KEEP.status?.error)) return;
  KEEP.follow = setTimeout(async () => {
    if (KEEP.id !== p.id || KEEP.busy || !$('#menu.cloud-pop')) return;
    // Only the box follows each read; the rail and the bar hear once the upload has ended.
    try { const now = await api(`${pathFor(p.id)}/cloud`); if (now?.progress) { if (KEEP.id === p.id) KEEP.status = now; } else keepSeen(p, now); keepPaint(); } catch { /* Next time. */ }
    keepFollow(p);
  }, 3000);
}
addEventListener('resize', keepPaint);

// ---------- Two versions of a file ----------
// The state carries conflicts:[{ path, otherPath, line?, at }]. Cloud's version waits beside the file as a file of its own;
// it is not a line or a note until you keep both, so it is left out of the lists.
function cloudAdopt(p, state) {
  p.conflicts = Array.isArray(state.conflicts) ? state.conflicts : [];
  const others = new Set(p.conflicts.map(c => c.otherPath));
  if (!others.size) return;
  for (const k of ['lines', 'landed', 'backlog']) p[k] = (p[k] || []).filter(l => !others.has(l.topicPath));
  p.notes = (p.notes || []).filter(n => !others.has(n.path));
}
const conflictLine = (p, c) => allLines(p).find(l => l.topicPath === c.path) || null;
const conflictText = path => /\.(md|markdown|txt|csv|json|html?|svg|ya?ml)$/i.test(path) && !/\.penecho\.json$/i.test(path);
const conflictActs = c => `${conflictText(c.path) ? `<button type="button" class="btn sm" data-act="conflict-compare" data-path="${esc(c.path)}">Compare</button>` : ''}<button type="button" class="btn primary sm" data-act="conflict-choose" data-path="${esc(c.path)}" aria-haspopup="menu">Choose${ic('down', 13)}</button>`;
// On the line whose own file it is.
function lineConflictHTML(p, l) {
  const c = (p.conflicts || []).find(x => x.path === l.topicPath);
  return c ? `<div class="cloud-banner" role="status">${ic('warn', 17)}<span>This line changed here and on penecho.ai, and the two could not be joined.</span>${conflictActs(c)}</div>` : '';
}
// Any other file, on the project's home: one compact row each.
function cloudConflictsHTML(p) {
  return (p.conflicts || []).filter(c => !conflictLine(p, c)).map(c => `<div class="cloud-banner is-row" role="status">${ic('warn', 16)}<span><strong title="${esc(c.path)}">${esc(c.path.split('/').pop())}</strong> has two versions</span>${conflictActs(c)}</div>`).join('');
}
// Called when the open project changed: the banners follow the state.
function cloudRefresh() {
  const p = project(); if (!p) return;
  const paint = (el, html) => { if (el && el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; } };
  paint($('#cloudConflicts'), cloudConflictsHTML(p));
  const l = S.route.view === 'line' ? lineById(p, S.route.line) : null;
  if (l) paint($('#lpCloud'), lineConflictHTML(p, l));
}
const KEPT_SAID = { mine:'Kept this one', theirs:'Kept the other', both:'Kept both' };
async function settleConflict(p, path, keep) {
  await api(`${pathFor(p.id)}/conflicts`, { method:'POST', body:{ path, keep } });
  // The file may now hold the other version, so what was read of it is read again.
  delete S.docs[docKey(p.id, path)];
  await loadState(p.id, { force:true });
  await loadProjects().catch(() => {});
  if (S.cur === p.id) refreshAfterChange();
  toast(KEPT_SAID[keep]);
}
ACT['conflict-choose'] = el => {
  const p = project(), path = el.dataset.path;
  openMenu(el, Object.keys(KEPT_SAID).map(keep => ({ label:{ mine:'Keep this one', theirs:'Keep the other', both:'Keep both' }[keep], fn:() => settleConflict(p, path, keep).catch(error => toast(cloudSaid(error))) })), { align:'right' });
};
// Both files side by side, as plain text.
ACT['conflict-compare'] = async el => {
  const p = project(), c = (p.conflicts || []).find(x => x.path === el.dataset.path); if (!c) return;
  const l = conflictLine(p, c), dialog = document.createElement('dialog');
  dialog.className = 'line-command-dialog cloud-compare';
  dialog.setAttribute('aria-labelledby', 'cloudCompareTitle');
  dialog.innerHTML = `<h2 id="cloudCompareTitle">${esc(l ? l.title : c.path.split('/').pop())}</h2>
    <div class="compare-cols">
      <section aria-label="This one"><header><strong>This one</strong><button type="button" class="btn sm" data-keep="mine">Keep this one</button></header><pre data-side="mine" tabindex="0"></pre></section>
      <section aria-label="The other"><header><strong>The other</strong><button type="button" class="btn sm" data-keep="theirs">Keep the other</button></header><pre data-side="theirs" tabindex="0"></pre></section>
    </div>
    <p class="command-error" role="alert" hidden></p>
    <footer><button type="button" class="btn" data-keep="both">Keep both</button><button type="button" class="btn" data-cancel>Close</button></footer>`;
  document.body.append(dialog);
  dialog.addEventListener('close', () => { dialog.remove(); if (el?.isConnected) el.focus(); });
  const fail = error => { const box = $('.command-error', dialog); box.hidden = false; box.textContent = cloudSaid(error); };
  dialog.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.matches('[data-cancel]')) { dialog.close(); return; }
    if (!b.dataset.keep) return;
    $$('button', dialog).forEach(x => { x.disabled = true; });
    try { await settleConflict(p, c.path, b.dataset.keep); dialog.close(); }
    catch (error) { $$('button', dialog).forEach(x => { x.disabled = false; }); fail(error); }
  });
  dialog.showModal();
  for (const [side, path] of [['mine', c.path], ['theirs', c.otherPath]]) {
    try { const doc = await api(`${pathFor(p.id)}/doc?path=${encodeURIComponent(path)}`); $(`pre[data-side="${side}"]`, dialog).textContent = doc.md; }
    catch (error) { fail(error); }
  }
};

// ---------- An Ask that is held ----------
// held:{ reason:"busy", where, since } — on penecho.ai: its line is working on a computer, and the Ask goes by itself when that ends.
// held:{ reason:"credits", balance, required } — PenEcho's own agent had no credits; the Ask is still here, Not sent.
// held:{ reason:"computer", agent, computer?, name?, open?, blocked? } — written on penecho.ai for a project that lives on a computer. It runs
//   on that computer, which fetches it. penecho.ai says the computer's name and why it is not starting yet (blocked: "closed", "sync", "switch", "agent");
//   the app knows only itself (S.computer), and offers to run it now.
function heldComputerHTML(p, l, s) {
  const held = s.held, step = `data-line="${esc(l.id)}" data-step="${esc(s.id)}"`, agent = agentInfo(held.agent || 'penecho').name;
  let title, words, acts, waits = true;
  if (typeof HOSTED === 'object' && HOSTED) {
    const name = held.name || 'your computer';
    title = 'Waiting for your computer';
    // No computer has been seen yet: PenEcho there may be closed, signed out, or from before computers fetched their Asks.
    words = held.blocked === 'closed' ? (held.name ? `No recent check-in from ${name}. Check that PenEcho is open and signed in.` : 'Starts when the newest PenEcho is open on your computer, signed in.')
      : held.blocked === 'switch' ? `Turn on Run Asks sent from penecho.ai in PenEcho on ${name}.`
        : held.blocked === 'sync' ? `${name} does not sync this project, so it never gets this Ask. In PenEcho on ${name}, open this project and turn on Sync.`
        : held.blocked === 'agent' ? `${agent} is not ready on ${name}. Set it up in PenEcho there.`
          : `${name} checks about every 10 seconds. ${agent} starts after sync.`;
    waits = !held.blocked;
    acts = `<button type="button" class="btn sm" data-act="held-computer-back" ${step}>Take it back</button>`;
  } else {
    const me = S.computer, other = Boolean(held.computer && me?.id && held.computer !== me.id), ready = (me?.agents || []).some(a => a.id === held.agent && a.ready);
    title = 'Sent from penecho.ai';
    words = other ? 'It waits for another computer of yours.' : !me?.runsAsks ? 'It runs here when Run Asks sent from penecho.ai is on.'
      : !ready ? `${agent} is not ready on this computer.` : `${agent} starts after this project syncs.`;
    waits = Boolean(!other && me?.runsAsks && ready);
    const mine = runnableAgents().find(a => a.id === held.agent) || runAgent(p, l);
    acts = `${!other && me && !me.runsAsks && S.thisComputer ? '<button type="button" class="btn sm unsent-go" data-act="computer-asks-on">Turn on</button>' : ''}${waits || !mine ? '' : `<button type="button" class="btn sm" data-act="unsent-run" data-agent="${esc(mine.id)}" ${step}>Run it now</button>`}`;
  }
  return `<div class="held-wait held-computer" role="status">${waits ? '<i class="spin"></i>' : ic('hint', 15)}<span><strong>${esc(title)}</strong> ${esc(words)}</span>${acts}</div>
    <footer class="lp-from lp-unsent"><time>${esc(s.when)}</time></footer>`;
}
// This computer, as it tells penecho.ai: { id, name, runsAsks, agents:[{ id, name, ready }], signedIn }. Not asked on penecho.ai.
async function loadComputer() {
  if (typeof HOSTED === 'object' && HOSTED) return;
  try { S.computer = await api('/computer'); } catch { /* An older server: no switch. */ }
  if (typeof SET !== 'undefined' && ((S.shelfPage === 'settings' && SET.tab === 'general') || (S.shelfPage === 'agents' && SET.agentsTab === 'agents')) && typeof settingsRender === 'function' && $('#view')) settingsRender();
}
async function setComputerAsks(on) {
  if (S.computerBusy) return;
  S.computerBusy = true;
  if (typeof SET !== 'undefined' && ((S.shelfPage === 'settings' && SET.tab === 'general') || (S.shelfPage === 'agents' && SET.agentsTab === 'agents')) && typeof settingsRender === 'function' && $('#view')) settingsRender();
  try {
    S.computer = await api('/computer', { method:'POST', body:{ runsAsks:Boolean(on) } });
    toast(on ? 'Asks sent from penecho.ai now run on this computer.' : 'Asks sent from penecho.ai wait until you turn this on.');
    refreshAfterChange();
  } catch (error) { toast(error.message); }
  finally {
    S.computerBusy = false;
    if (typeof SET !== 'undefined' && ((S.shelfPage === 'settings' && SET.tab === 'general') || (S.shelfPage === 'agents' && SET.agentsTab === 'agents')) && typeof settingsRender === 'function' && $('#view')) settingsRender();
  }
}
ACT['computer-asks-on'] = () => setComputerAsks(true);
ACT['computer-asks-toggle'] = () => (S.computer ? setComputerAsks(!S.computer.runsAsks) : undefined);
function heldAskHTML(p, l, s) {
  const held = s.held, step = `data-line="${esc(l.id)}" data-step="${esc(s.id)}"`;
  if (held?.reason === 'computer') return heldComputerHTML(p, l, s);
  // On the computer nothing waits for Cloud (PE-583): an Ask an older app held back for a busy line is a plain Not sent, with Send.
  if (held?.reason === 'busy' && typeof HOSTED === 'object' && HOSTED) return `<div class="held-wait" role="status"><i class="spin"></i><span>This line is working on ${esc(held.where || 'penecho.ai')}. Your Ask is sent when it finishes.</span><button type="button" class="btn sm" data-act="unsent-edit" ${step}>Take it back</button></div>
    <footer class="lp-from lp-unsent"><time>${esc(s.when)}</time></footer>`;
  if (held?.reason !== 'credits') return '';
  // Under the ways to send it, above the line that says when it was written.
  // unsentFoot appends the completion control once outside this held card.
  const foot = unsentFoot(p, l, { ...s, held:null, canFinishUnsent:false }), at = foot.lastIndexOf('<footer');
  const said = `<div class="cloud-banner held-credits" role="status">${ic('warn', 17)}<span>You are out of credits. This Ask is kept, not sent.</span><button type="button" class="btn sm" data-act="held-credits">Get credits</button></div>`;
  return at < 0 ? foot + said : foot.slice(0, at) + said + foot.slice(at);
}
ACT['held-credits'] = () => cloudOpen('/dashboard.html#billing');
// Out of credits is a state, not a failure: the server has kept the Ask, Not sent, and answers 402 with Cloud's own body.
// Called by api() for a 402: what it returns is the answer the page carries on with, as if the Ask had been saved (it was).
async function cloudHeld(path, body, data) {
  if (data?.error !== 'insufficient_credits') return null;
  if (/^\/projects\/[^/]+\/topics\/[^/]+\/run-unsent$/.test(path)) return { ok:true, agent:'', held:true };
  const made = /^\/projects\/([^/]+)\/topics$/.exec(path); if (!made) return null;
  // A new Ask: Cloud's body does not say which line it is on, so it is the line whose Ask now waits for credits.
  const id = decodeURIComponent(made[1]);
  try { await loadState(id, { force:true }); } catch { return null; }
  const p = project(id), waits = l => l.stations.some(s => s.unsent && s.held?.reason === 'credits');
  const named = body?.topic && !['new', 'auto'].includes(body.topic) ? lineById(p, body.topic) : null;
  const line = named && waits(named) ? named : allLines(p).filter(waits).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
  return line ? { slug:line.id, added:false, held:true } : null;
}

// ---------- Run with: the balance under PenEcho's own agent ----------
// Only when it runs on Cloud's models: signed in, and Settings does not say it uses a key of your own.
function penechoRunsOn() {
  const a = S.cloudAccount; if (!a?.signedIn) return '';
  const m = S.agentCheck?.agents?.find(x => x.id === 'penecho')?.model;
  if (m && (!m.signedIn || (m.from && m.from !== 'PenEcho Cloud'))) return '';
  const left = a.credits?.available ?? m?.credits;
  return `PenEcho Cloud${left !== null && left !== undefined && Number.isFinite(Number(left)) ? ` · ${cloudNumber(left)} credits` : ''}`;
}
// `agents` are the menu's rows in order, after its heading.
function runMenuCredits(menu, agents) {
  const note = penechoRunsOn(), at = agents.findIndex(a => a.id === 'penecho');
  const row = note && at >= 0 ? menu?.querySelector(`button[data-i="${at + 1}"]`) : null;
  if (!row) return;
  row.classList.add('has-note');
  row.querySelector('span:not(.av)')?.insertAdjacentHTML('beforeend', `<small>${esc(note)}</small>`);
  // The note can change both width and height. Keep the final menu beside its button and inside the viewport.
  placeMenu(menu);
}

// Asked once now and then every minute, as the account row always was.
loadCloudAccount();
setInterval(loadCloudAccount, 60 * 1000);
