// These same pages on penecho.ai, for a project kept in PenEcho Cloud:
//   projects.html?hosted=<the project's key in Cloud>#<key>[/line/<line>[/<step>] | /canvases | /memory | /find/<words> …]
//   projects.html?shared=<a shared link's token>#<token>[/line/<line> …]   a shared link, read by anyone
// The dashboard there shows the page in a frame to the right of its own rail, and keeps its address (/lines/<key>#line/<line>) in step;
// the shared link's page (/l/<token>) does the same. A shared link only reads (HOSTED_READ).
// Three things differ from PenEcho on a computer, and all three are in this file:
//   where requests go: Cloud's own routes, which answer in the shapes of the local ones (hostedFetch);
//   what this home cannot do: listed once, in HOSTED_OFF, and never drawn;
//   an Ask that could not start (no credits, or its line is working on a computer) is told by the answer, not by the project's file (hostedHeld).
const HOSTED = (() => {
  const query = new URLSearchParams(location.search), key = query.get('hosted'), shared = query.get('shared');
  const fromMcp = query.get('from') === 'mcp';
  const copiedRaw = Number.parseInt(query.get('copied') || '0', 10);
  const mcpCopied = Number.isFinite(copiedRaw) && copiedRaw > 0 ? copiedRaw : 0;
  const rawReturn = query.get('mcpReturn') || '';
  const mcpReturn = /^\/canvas\/draft\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\?[^\s#]*)?$/i.test(rawReturn) ? rawReturn : '';
  const start = { csrf:'', first:null, held:{}, told:'', last:'', looks:0, runAt:0, askedAt:0, quiet:{}, read:false, shared:false, fromMcp, mcpHandoffKey: fromMcp ? key : '', mcpCopied, mcpReturn };
  if (shared && /^[0-9a-f-]{36}$/i.test(shared)) return { ...start, key:shared, base:`/api/v1/line-shares/${encodeURIComponent(shared)}`, read:true, shared:true, fromMcp:false, mcpHandoffKey:'', mcpCopied:0, mcpReturn:'' };
  return key && /^[A-Za-z0-9._:-]{1,128}$/.test(key) ? { ...start, key, base:`/api/v1/line-projects/${encodeURIComponent(key)}` } : null;
})();
if (HOSTED) document.documentElement.classList.add('is-hosted');
if (HOSTED?.read) document.documentElement.classList.add('is-read');

// ---------- What this home cannot do ----------
// penecho.ai works like PenEcho on a computer (PE-349), except what needs a computer: no agents installed there, no Git, no folders or apps,
// no clipboard of its own, and the dashboard around the page already has the projects, the account and MeetCue's own pages.
const HOSTED_OFF = {
  // Asked by name where words or a whole flow depend on it: can('canvas').
  can:['agents', 'paste', 'favorites', 'continue-work'],
  // These views use the computer's own tools. Synced Topics are available in Cloud.
  views:['markup'],
  // Buttons, by what they do.
  acts:[
    'build-topics', 'rebuild-topics', 'topics-recover', 'topic-merge', 'new-knowledge-topic', 'edit-knowledge-topic', 'delete-knowledge-topic', 'topic-menu', 'edit-topic-area', 'delete-topic-area', 'area-menu', 'open-archived', 'sw-relocate', 'sw-forget', 'sw-pin', 'shelf-restore', 'shelf-delete',   // Topics, and the computer's list of projects
    'np-recheck', 'setup-recheck', 'cloud-sign-in', 'cloud-keep', 'cloud-copy', 'cloud-open-web', // agents on a computer, the account row, Keep in Cloud
    'project-folder', 'fv-reveal', 'choose-folder', 'edit-code', 'how-it-works',
    'skill-add', 'skill-later', 'skill-remove', 'memory-skill-add', 'memory-skill-remove', 'ppt-skill', 'starter-prompt', 'copy-pointer', 'copy-prompt',   // the skills and prompts for agent apps
    'sync-recent', 'start-sync', 'track-ask', 'track-yes', 'track-no', 'box-branch', 'new-line-on', 'merge-line', 'merge-ask', 'merge-now', 'archive-branch', 'archive-branch-ask', 'archive-branch-no', 'open-changes', 'open-branch-doc',   // conversations in a code folder, Git
    'unsent-context', 'unsent-plain', 'unsent-paste-pick', 'unsent-files', 'copy-files', 'copy-path', 'copy-command', 'open-desktop', 'open-agent-note',   // pasting into an agent app, opening one
    'cmp-ppt', 'ppt-pick', 'hand-note', 'pick-agent',
    'resend-work', 'carry-on', 'continue-work',                                                                  // steps a run on penecho.ai cannot take yet (Retry works here: a stopped Work is tried again, or held for the computer)
    'meetcue-connect', 'meetcue-sign-in',                                                    // MeetCue's own pages and its link are the dashboard's
    'computer-asks-on', 'computer-asks-toggle',                                                                              // computer-only switch for running Asks sent from penecho.ai
  ],
  // The Orchestrator hands a job to the agents on a computer: here only for a project that lives on one (owner, 2026-11-22).
  needsComputer:{ views:['orchestrator'], acts:['review-tree', 'review-tree-menu', 'review-tree-apply', 'work-review', 'work-review-pick'] },
  // What penecho.ai refuses for a project that lives on a computer, or leaves to that computer: approving a step is the agent's there,
  // discarding its Work too, and sharing keeps the Cloud copy following the folder first.
  computer:['approve-step', 'discard-work', 'project-share'],
  // What My Canvases keeps: its name, and it is not shared as a project.
  system:['project-rename', 'project-share', 'project-archive', 'project-delete'],
  // Whole parts of a page, by where they are.
  parts:[
    '.where', '.rail-pin', '#railUpdate', '.skill-pair', '.skill-offer', '.sync-offer', '.empty-agents', '.start-code', '.node-legend p', '.starter',
    '.bar-keep', '.unsent-about', '.cmp-branch',
    '[data-verb="start"]',
    // Project settings: the skills for agents on a computer, and its conversations. Archive is the computer's project list.
    '.set-row[aria-label="Recent conversations"]', '.set-row[aria-label="Drawing skill"]', '.set-row[aria-label="Memory skill"]',
  ],
  // Rows of a menu, by what they say.
  menus:['Agent setup', 'Manage agents…', 'Use in MeetCue', 'Make slides from data', 'Copy branch name', 'Copy folder path', 'Copy Line file path', 'Move to project…', 'Move its line to…'],
};
// Read only: what changes the project is not drawn either. A state that says { readOnly:true } makes the page read only too.
const HOSTED_READ = {
  acts:[
    'cmp-draw', 'cmp-edit-draw', 'draw-line', 'draw-line-on', 'line-draw', 'draw-picture', 'draw-doc', 'add-visual',
    'new-canvas', 'my-new-canvas', 'canvas-library', 'hosted-library', 'canvas-group-project',
    'rail-new-line', 'new-line-here', 'start-idea', 'cmp-note', 'cmp-command', 'cmp-slash', 'cmp-unrefer', 'cmp-remove', 'line-refer',               // a new line, the box
    'line-menu', 'rail-line-menu', 'line-stop', 'archive-line', 'reopen-line', 'restore-node', 'answer-q', 'need-reply', 'held-credits',                                  // a line and its questions
    'unsent-run', 'unsent-run-pick', 'unsent-edit', 'unsent-drop', 'unsent-finish', 'note-edit', 'note-save', 'note-cancel', 'yours-drop',                              // an Ask not sent, a note
    'work-reviewed', 'all-reviewed', 'review-tree', 'review-tree-menu', 'review-tree-apply', 'work-review', 'work-review-pick', 'conflict-choose', 'reader-edit', 'canvas-menu', 'canvas-restore', 'shelf-delete', 'shelf-restore',               // reviews, a file, a Canvas
    'plan-run', 'plan-remove', 'plan-clear', 'meetcue-delete', 'meetcue-retry', 'conv-about',                                                           // and asking about a step
    'line-do', 'carry-on', 'lane-reviewed', 'fv-delete', 'cmp-send-pick', 'computer-asks-on', 'held-computer-back', 'lines-sort',                     // Retry, Stop, another agent, a file, the order
    'approve-step', 'discard-work', 'line-pin', 'line-outdated', 'restore-line', 'similar-merge', 'merge-accept', 'merge-undo', 'group-merge',                         // steps, pins, merging lines
    'file-add', 'file-menu', 'file-restore', 'cmp-attach', 'cmp-meeting', 'cmp-meeting-node', 'line-meeting', 'meetcue-add', 'new-note-quick', 'open-example',                             // adding files, notes, meetings, examples
    'open-setup', 'open-settings', 'open-keys', 'project-share', 'project-rename', 'project-archive', 'project-restore', 'project-delete', 'download-folder', // the project and its settings
    'line-todo', 'work-rate', 'work-rate-note', 'work-scope', 'memory-recover', 'topic-merge-accept', 'file-select', 'file-select-all', 'file-select-clear', 'file-delete-selected', // marks, ratings, restoring memory, deleting files
    'line-make', 'make-again', 'make-chip', 'make-paste', 'make-mc-add', 'make-mc-retry', 'make-mc-link', 'make-meetcue',                                               // making something from the box
  ],
  views:['settings', 'deleted'],
  parts:['.dock-wrap', '.composer', '.unsent-finish', '.unsent-actions', '.unsent-run', '.need-reply', '.start-panel', '.answer-box', '.examples', '.cmp-plus', '#dropOverlay', '.lpp-rate-box', '.lp-rate', '.rev-split'],
  menus:['Rename', 'Rename…', 'Delete', 'Delete line', 'Archive', 'Deleted', 'Project settings', 'Edit', 'Run', 'Mark reviewed', 'Mark reviewed…', 'Pin', 'Unpin', 'Add images or files', 'Add meeting notes from MeetCue', 'Add meeting node', 'Mark outdated', 'Quick starts'],
};
// A shared link: anyone with it may add a note to a line, or start a new line with a note (the box, saving notes only). Nothing runs,
// and nothing anyone wrote can be changed or deleted from here.
const HOSTED_GUEST = { may:['.composer', '.dock-wrap', 'cmp-remove'], hide:['.send-pick', '.cmp-plus', '.cmp-branch', '[data-act="cmp-send-pick"]', '.doc-dock', '.plan-tray'] };
const hostedGuestMay = what => Boolean(HOSTED?.shared) && HOSTED_GUEST.may.includes(what);
// Shared note pictures travel with the note. Project files and project Canvas writes require owner access.
// A page of the project bar that is here: on penecho.ai, not one for a computer only, and the Orchestrator only where the project lives on one.
const viewHere = v => !HOSTED || !(HOSTED_OFF.views.includes(v) || (HOSTED_OFF.needsComputer.views.includes(v) && !HOSTED.onComputer));
const orchHere = () => viewHere('orchestrator');
const can = what => !HOSTED || !(HOSTED_OFF.can.includes(what) || (HOSTED.shared && what === 'files' || HOSTED.read && what === 'canvas'));
// A menu without the rows this home cannot do, and without a heading or a rule left over nothing.
function hostedMenu(items) {
  if (!HOSTED) return items;
  const kept = items.filter(it => it.sep || it.head || !(HOSTED_OFF.menus.includes(it.label) || (HOSTED.read && HOSTED_READ.menus.includes(it.label))));
  return kept.filter((it, i) => !(it.sep && (i === 0 || i === kept.length - 1 || kept[i - 1].sep)) && !(it.head && (i === kept.length - 1 || kept[i + 1].sep)));
}
if (HOSTED) {
  // Not drawn: one rule made from the list above. (A style sheet built here needs no leave from the page's content policy.)
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`${[...HOSTED_OFF.acts.map(a => `[data-act="${a}"]`), ...HOSTED_OFF.views.map(v => `[data-act="go-view"][data-view="${v}"]`), ...HOSTED_OFF.parts].map(s => `html.is-hosted ${s}`).join(',')}{display:none !important}
    ${[...HOSTED_OFF.needsComputer.acts.map(a => `[data-act="${a}"]`), ...HOSTED_OFF.needsComputer.views.map(v => `[data-act="go-view"][data-view="${v}"]`)].map(s => `html.is-hosted:not(.is-on-computer) ${s}`).join(',')}{display:none !important}
    ${[...HOSTED_OFF.computer.map(a => `html.is-hosted.is-on-computer [data-act="${a}"]`), ...HOSTED_OFF.system.map(a => `html.is-hosted.is-system [data-act="${a}"]`)].join(',')}{display:none !important}
    ${[...HOSTED_READ.acts.filter(a => !hostedGuestMay(a)).map(a => `[data-act="${a}"]`), ...HOSTED_READ.views.map(v => `[data-act="go-view"][data-view="${v}"]`), ...HOSTED_READ.parts.filter(p => !hostedGuestMay(p))].map(s => `html.is-read ${s}`).join(',')}{display:none !important}
    ${HOSTED_GUEST.hide.map(s => `html.is-shared ${s}`).join(',')}{display:none !important}
    ${['#rail', '.proj-switch', '[data-act="toggle-projects"]', '.nav-hist'].map(s => `html.is-shared ${s}`).join(',')}{display:none !important}`);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}
// Read only from now on: what changes the project does nothing, by a button or a key.
function hostedReadOnly() {
  if (!HOSTED) return;
  HOSTED.read = true;
  document.documentElement.classList.add('is-read');
  for (const act of HOSTED_READ.acts) if (!hostedGuestMay(act)) ACT[act] = () => {};
  delete VIEWS.newline;
  for (const view of HOSTED_READ.views) delete VIEWS[view];
}
// Called once every part of the page is loaded, before it starts: the pages and actions this home cannot do are not there to reach, by a link or a key either.
function hostedBoot() {
  if (!HOSTED) return;
  for (const view of HOSTED_OFF.views) delete VIEWS[view];
  for (const act of HOSTED_OFF.acts) ACT[act] = () => {};
  for (const act of HOSTED_OFF.needsComputer.acts) { const own = ACT[act]; ACT[act] = (...args) => (HOSTED.onComputer ? own?.(...args) : undefined); }
  // A page opened at the Orchestrator's address does not know yet where its project lives: it is drawn once that is known, or Home is.
  for (const view of HOSTED_OFF.needsComputer.views) {
    const own = VIEWS[view];
    VIEWS[view] = (p, r) => {
      if (HOSTED.onComputer) { if (view === 'orchestrator') hostedOrchAgents(); return own(p, r); }
      const key = HOSTED.key;
      Promise.resolve(hostedLives()).then(() => { if (key !== HOSTED.key || S.route.view !== view) return; if (!HOSTED.onComputer) S.route = { view:'home' }; render(); });
      return '<div class="page"></div>';
    };
  }
  for (const act of new Set([...HOSTED_OFF.computer, ...HOSTED_OFF.system])) {
    const own = ACT[act], off = (HOSTED_OFF.computer.includes(act) ? ['onComputer'] : []).concat(HOSTED_OFF.system.includes(act) ? ['system'] : []);
    ACT[act] = (...args) => (off.some(k => HOSTED[k]) ? undefined : own?.(...args));
  }
  // The rail is the app's own, with every project the account keeps in Cloud (hostedProjects). Another project opens in its own frame of
  // the dashboard, so its address and Back stay the dashboard's; the dashboard's own pages (Home, MeetCue, the account) are a click away.
  // A shared link's reader has none of the owner's projects: the page is the one project, as before.
  if (HOSTED.shared) { document.documentElement.classList.add('is-shared'); lineProjectsHidden = true; S.noteOnly = true; HOSTED.joining = hostedGuestJoin(); }
  const own = switchProject;
  switchProject = (id, options = {}) => (id === HOSTED.key || HOSTED.shared ? own(id, options) : hostedSwitch(own, id, options));
  ACT['cloud-account'] = () => hostedGo('/dashboard.html#dashboard');
  ACT['hosted-library'] = () => hostedGo('/dashboard.html#projects');
  ACT['open-meetcue'] = () => hostedGo('/dashboard.html#meetcue');
  ACT['open-shared'] = el => hostedOpenShared(el.dataset.token);
  ACT['shared-menu'] = el => openMenu(el, [{ label:'Remove from list', icon:'x', fn:() => hostedLeaveShared(el.dataset.token) }], { align:'right' });
  document.addEventListener('click', event => { if (event.target.closest?.('#rail .brand')) hostedGo('/dashboard.html#dashboard'); });
  // A Cloud project's rail uses the same Dashboard tile as the account sidebar.
  const mine = railMineHTML;
  railMineHTML = () => `<div class="rail-item"><button type="button" class="rail-row" data-act="hosted-home" title="Dashboard"><img src="/media/products/dashboard-icon.svg" alt="" width="22" height="22"><span class="rail-name">Dashboard</span></button></div>${mine()}`;
  ACT['hosted-home'] = () => hostedGo('/dashboard.html#dashboard');
  ACT['unsent-run-pick'] = hostedRunPick;
  // An example becomes a project of the account's own, as from the dashboard's Home, and opens there.
  ACT['open-example'] = async el => {
    el.disabled = true;
    try {
      const response = await hostedSaid(await hostedCall('/api/v1/line-projects', { method:'POST', headers:{ accept:'application/json', 'content-type':'application/json' }, body:JSON.stringify({ example:el.dataset.kind }) }));
      const made = await response.json();
      if (!response.ok) throw new Error(made.error);
      hostedGo(`/lines/${encodeURIComponent(made.project.key)}`);
    } catch (error) { el.disabled = false; toast(error.message); }
  };
  ACT['held-computer-back'] = el => { const l = lineById(project(), el.dataset.line); if (l) act(l, 'stop').then(refreshAfterChange).catch(error => toast(error.message)); };
  if (HOSTED.read) hostedReadOnly();
  hostedLives();
  COMMANDS.splice(0, COMMANDS.length, ...COMMANDS.filter(k => k.instant === 'canvas' || !k.instant && !['/explain', '/deck', '/prototype'].includes(k.cmd)));
  addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== window.parent || event.data?.source !== 'penecho-dashboard') return;
    // The dashboard's address changed under the page (Back, or a link to another line of this project).
    // It may name another project, after Back across a switch made here.
    if (typeof event.data.hash === 'string') { const key = typeof event.data.key === 'string' && event.data.key ? event.data.key : HOSTED.key, next = `#${hostedHash(event.data.hash, key)}`; if (next !== location.hash) location.hash = next; }
  });
}

// ---------- The address ----------
// Here a page's address starts with the project, as on a computer. The dashboard's has the project in its path, so it gets the rest.
const HOSTED_PLACES = ['line', 'step', 'find', 'doc', 'files', 'canvases', 'topics', 'stats', 'orchestrator', 'memory', 'vault', 'archive', 'deleted', 'newline'];
const HOSTED_OUTSIDE = ['settings', 'setup', 'archived', 'agents', 'providers', 'new'];
// "line/<line>", "memory" …, as the dashboard has it → this page's own. A bare "<line>" is a line too: links made before lines had "line/".
function hostedHash(rest, project = HOSTED.key) {
  const tail = String(rest || '').replace(/^#/, ''), first = tail.split('/')[0];
  const key = encodeURIComponent(project);
  if (!tail) return key;
  if (HOSTED_OUTSIDE.includes(first)) return tail;
  if (first === key || first === project) return tail;
  return `${key}/${HOSTED_PLACES.includes(first) ? tail : `line/${tail}`}`;
}
function hostedTell(message) { if (HOSTED && window.parent !== window) window.parent.postMessage({ source:'penecho-lines-hosted', key:HOSTED.key, ...message }, location.origin); }
// The page the address opens on, before the project is read.
function hostedFirstRoute() {
  let parts = []; try { parts = location.hash.replace(/^#/, '').split('/').map(decodeURIComponent); } catch { /* Home. */ }
  const [key, view, what = ''] = parts;
  if (key !== HOSTED.key || !view) return { view:'home' };
  return view === 'line' || view === 'step' ? { view:'line', line:what } : view === 'doc' || view === 'markup' ? { view, doc:what } : { view };
}
// Called whenever the page's address is written (main.js syncHash), and once the page is up.
function hostedAddress() {
  if (!HOSTED) return;
  const raw = location.hash.replace(/^#/, ''), [first, second = ''] = raw.split('/');
  // The project's own Settings keeps the project in its address: #settings alone is Settings for every project.
  const rest = HOSTED_OUTSIDE.includes(first) || HOSTED_OUTSIDE.includes(second) ? raw : raw.split('/').slice(1).join('/');
  const title = document.title.replace(/ · PenEcho Lines$/, '');
  const said = `${rest}\n${title}`;
  if (HOSTED.told === said) return;
  HOSTED.told = said;
  hostedTell({ hash:rest, title });
}
if (HOSTED) {
  // The frame is given the dashboard's form of the address; the page reads its own.
  const own = `#${hostedHash(location.hash)}`;
  if (own !== location.hash) history.replaceState(null, '', own);
  addEventListener('hashchange', () => setTimeout(hostedAddress, 0));
}
// A page of the dashboard around this one: Plan & credits, a meeting's minutes, sign-in.
function hostedGo(path) { if (typeof EMBED !== 'undefined' && EMBED) embedTell({ leave:path }); else if (window.parent !== window) hostedTell({ go:path }); else location.assign(path); }

// ---------- Where this project lives ----------
// A project made on penecho.ai (and My Canvases) works here, with PenEcho. Every other project lives on a computer: its Asks run there, with
// that computer's agents, and an Ask written here waits for it ("Waiting for your computer"). Nothing here reaches into a computer: the
// computer asks penecho.ai, and says on each round who it is, which agents it has and whether it runs Asks sent from here.
if (HOSTED) Object.assign(HOSTED, { onComputer:false, system:false, lives:null, computers:[], computersAt:0, runOn:{} });
// The marks of the agents a computer can have (the app's own, agents.js); any other agent gets its first letters.
const HOSTED_AGENTS = { penecho:['PenEcho', 'Pe', '#2563eb'], claude:['Claude Code', 'Cl', '#a8502a'], codex:['Codex', 'Cx', '#2b303a'], opencode:['OpenCode', 'Oc', '#3f4754'], pi:['Pi', 'Pi', '#0f766e'],
  omp:['omp', 'Om', '#7c3aed'], dsh:['dsh', 'Ds', '#3457c9'], kimi:['Kimi', 'Ki', '#16181d'], antigravity:['Antigravity', 'Ag', '#1a73e8'], workbuddy:['WorkBuddy', 'Wb', '#0052d9'] };
function hostedAgent(id, name) {
  const known = HOSTED_AGENTS[id], said = String(name || known?.[0] || id || 'Agent');
  return { id, name:said, mono:known?.[1] || said.slice(0, 2).replace(/^./, c => c.toUpperCase()), color:known?.[2] || '#5b6472', role:'', available:true, runs:true, ...(id === 'penecho' ? { builtIn:true } : {}) };
}
function hostedLivesFrom(list) {
  const mine = list.find(p => p.key === HOSTED.key);
  if (!mine) return false;
  HOSTED.onComputer = !mine.cloudMade && !mine.system;
  HOSTED.system = Boolean(mine.system);
  HOSTED.archived = Boolean(mine.archived);
  HOSTED.livesDone = true;
  document.documentElement.classList.toggle('is-on-computer', HOSTED.onComputer);
  document.documentElement.classList.toggle('is-system', HOSTED.system);
  hostedLivesShown();
  return true;
}
// The Orchestrator's box offers the saved agents of the project's computers: read when its page opens, and the box is drawn again with them.
function hostedOrchAgents() {
  const had = JSON.stringify(S.presets || null);
  Promise.resolve(hostedComputers()).then(() => HOSTED.computersAsk).then(() => {
    hostedPresets();
    if (S.route.view !== 'orchestrator' || JSON.stringify(S.presets || null) === had) return;
    if (typeof orchRefreshBox === 'function') orchRefreshBox();
    else if (typeof orchPaint === 'function') orchPaint('orchBox', orchBoxHTML(), true);
  }).catch(() => { /* The agents it had. */ });
}
// The project bar has the Orchestrator once the project is known to live on a computer.
function hostedLivesShown() { if (HOSTED.onComputer && S.cur) { try { renderProjbar(); } catch { /* Drawn with the page. */ } } }
function hostedLives() {
  // A shared link's reader has no account here: nothing of the owner's is asked for.
  if (HOSTED.shared) return HOSTED.lives ||= Promise.resolve();
  // After a switch the list the sidebar has is enough to know where the project lives.
  if (!HOSTED.lives && HOSTED.list && Date.now() - HOSTED.listAt < 60000 && hostedLivesFrom(HOSTED.list)) return HOSTED.lives = Promise.resolve();
  const key = HOSTED.key;
  return HOSTED.lives ||= hostedCall('/api/v1/line-projects', { headers:{ accept:'application/json' } }).then(r => (r.ok ? r.json() : null)).then(body => {
    if (key !== HOSTED.key) return;
    if (body?.projects) { HOSTED.list = body.projects; HOSTED.sharedList = body.shared || []; HOSTED.listAt = Date.now(); }
    const mine = (body?.projects || []).find(p => p.key === HOSTED.key);
    if (!mine) { HOSTED.lives = null; return; }
    HOSTED.onComputer = !mine.cloudMade && !mine.system;
    HOSTED.system = Boolean(mine.system);
    HOSTED.archived = Boolean(mine.archived);
    HOSTED.livesDone = true;
    document.documentElement.classList.toggle('is-on-computer', HOSTED.onComputer);
    document.documentElement.classList.toggle('is-system', HOSTED.system);
    hostedLivesShown();
  }).catch(() => { if (key === HOSTED.key) HOSTED.lives = null; });
}
// The account's computers, newest first: [{ id, name, agents:[{ id, name, ready }], runsAsks, lastSeenAt, open }]. Asked at most every 8 s.
// The Run menu opens from the list it has: once the page has read it, a newer one is asked for behind the menu, never before it.
async function hostedComputers(fresh = false) {
  if (HOSTED.shared) return HOSTED.computers;
  const ask = () => {
    HOSTED.computersAt = Date.now();
    return HOSTED.computersAsk ||= hostedCall('/api/v1/computers', { headers:{ accept:'application/json' } })
      .then(async r => { if (r.ok) { HOSTED.computers = (await r.json()).computers || []; HOSTED.computersRead = true; } })
      .catch(() => { /* The list it had. */ })
      .finally(() => { HOSTED.computersAsk = null; hostedPresets(); });
  };
  if (HOSTED.computersRead && !fresh) { if (Date.now() - HOSTED.computersAt >= 8000) ask(); return HOSTED.computers; }
  await ask();
  return HOSTED.computers;
}
// A project on a computer runs with that computer's saved agents, named as its Agents page names them ("Claude Code · opus · high
// effort"): the page's own Run button and menu read them as they read a computer's own list. Read only here; made on the computer.
function hostedPresets() {
  if (!HOSTED?.onComputer) { if (HOSTED) S.presets = null; return; }
  const presets = [], ready = c => new Set((c.agents || []).filter(a => a.ready).map(a => a.id));
  const owning = [...hostedOwning()].sort((a, b) => Number(b.open) - Number(a.open) || (b.lastSeenAt || 0) - (a.lastSeenAt || 0));
  for (const c of owning) { const here = ready(c); for (const x of c.presets || []) presets.push({ ...x, computer:c.id, available:here.has(x.agent), auto:false }); }
  const first = owning.flatMap(c => (c.presets || []).filter(x => x.default))[0];
  S.presets = presets.length ? { presets, default:first?.id || '' } : null;
}
// Cloud models available to PenEcho on penecho.ai (/api/v1/models). Cached up to 60 s so the Run button, Run with menu,
// and Settings show the active model(s) and their default effort without extra requests.
async function hostedModels(fresh = false) {
  if (!HOSTED || HOSTED.shared) return [];
  const ask = () => {
    HOSTED.modelsAt = Date.now();
    return HOSTED.modelsAsk ||= hostedCall('/api/v1/models', { headers:{ accept:'application/json' } })
      .then(async r => { if (r.ok) { HOSTED.models = (await r.json()).models || []; HOSTED.modelsRead = true; } })
      .catch(() => { /* Keep previous list. */ })
      .finally(() => { HOSTED.modelsAsk = null; });
  };
  if (HOSTED.modelsRead && !fresh) { if (Date.now() - (HOSTED.modelsAt || 0) >= 60000) ask(); return HOSTED.models || []; }
  await ask();
  return HOSTED.models || [];
}
function hostedWorkerModels() {
  const list = Array.isArray(HOSTED?.models) ? HOSTED.models : [];
  const workers = list.filter(m => m && m.worker === true);
  return [...workers].sort((a, b) => Number(Boolean(b.workerDefault)) - Number(Boolean(a.workerDefault)) || (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0));
}
function hostedModelLabel(model) {
  if (!model) return '';
  const effort = typeof model.defaultEffort === 'string' && model.defaultEffort.trim() ? `${model.defaultEffort.trim()} effort` : '';
  return [model.displayName || model.name || '', effort].filter(Boolean).join(' · ');
}
function hostedModelSelection(lineKey = '') {
  const workers = hostedWorkerModels();
  if (!workers.length) return null;
  const pickedId = lineKey ? HOSTED?.runModel?.[lineKey] : '';
  return (pickedId && workers.find(m => m.id === pickedId)) || workers[0];
}
// The agents an Ask of this project can be run with. Made here: PenEcho (with its active Cloud model & default effort).
// On a computer: the agents ready on one of the account's computers.
async function hostedAgents() {
  await hostedLives();
  if (!HOSTED.onComputer) {
    await hostedModels();
    const workers = hostedWorkerModels(), primary = workers[0] || null;
    return [{ ...hostedAgent('penecho'), workers, ...(primary ? { model:{ name:primary.displayName || '', effort:primary.defaultEffort || '', choices:workers.map(m => m.displayName || '').filter(Boolean) } } : {}) }];
  }
  await hostedComputers();
  if (!HOSTED.onComputer) {
    await hostedModels();
    const workers = hostedWorkerModels(), primary = workers[0] || null;
    return [{ ...hostedAgent('penecho'), workers, ...(primary ? { model:{ name:primary.displayName || '', effort:primary.defaultEffort || '', choices:workers.map(m => m.displayName || '').filter(Boolean) } } : {}) }];
  }
  const ready = new Map();
  for (const c of hostedOwning()) for (const a of c.agents || []) if (a.ready && !ready.has(a.id)) ready.set(a.id, hostedAgent(a.id, a.id === 'penecho' ? '' : a.name));
  return ready.size ? [...ready.values()] : [hostedAgent('penecho')];
}
// The computer an Ask is held for: the one picked in the Run menu, else one where that agent is ready (an open one first, then the one seen last).
// Only the computer that syncs this project runs its Asks (owner, 2026-11-18): another computer signed in to the same account is not
// offered them. A computer that has not said which projects it syncs counts as syncing it, as on penecho.ai's side.
function hostedSyncs(c) { return !Array.isArray(c?.projects) || !c.projects.length || c.projects.includes(HOSTED.key); }
function hostedOwning() { const all = HOSTED.computers || [], owning = all.filter(hostedSyncs); return owning.length ? owning : all; }
function hostedComputerFor(slug, agent) {
  const has = c => (c.agents || []).some(a => a.id === agent && a.ready), list = hostedOwning().filter(has);
  return list.find(c => c.id === HOSTED.runOn[slug]) || [...list].sort((a, b) => Number(b.open) - Number(a.open) || (b.lastSeenAt || 0) - (a.lastSeenAt || 0))[0] || null;
}

// ---------- Requests ----------
const hostedAnswer = (body, status = 200) => new Response(JSON.stringify(body), { status, headers:{ 'content-type':'application/json' } });
const hostedCookie = () => { const m = /(?:^|;\s*)penecho_csrf=([^;]+)/.exec(document.cookie); return m ? decodeURIComponent(m[1]) : ''; };
async function hostedSession() {
  // A shared link is read by anyone: nobody need be signed in.
  if (HOSTED.shared) return null;
  const response = await fetch('/api/v1/auth/session', { credentials:'same-origin', cache:'no-store', headers:{ accept:'application/json' } });
  const session = response.ok ? await response.json().catch(() => null) : null;
  HOSTED.csrf = session?.csrfToken || '';
  HOSTED.account = session?.account || null;
  // Signed out: the dashboard takes it from here.
  if (response.ok && !session?.account) hostedGo(`/auth.html?returnTo=${encodeURIComponent(`/lines/${encodeURIComponent(HOSTED.key)}`)}`);
  return session;
}
// One request to Cloud, with the token a change needs. A token that has gone stale is read again once.
async function hostedCall(url, init = {}, again = true) {
  const change = init.method && !['GET', 'HEAD'].includes(init.method);
  if (change && !HOSTED.csrf) HOSTED.csrf = hostedCookie() || (await hostedSession())?.csrfToken || '';
  const response = await fetch(url, { ...init, credentials:'same-origin', cache:'no-store', headers:{ ...(init.headers || {}), ...(change ? { 'x-penecho-csrf':HOSTED.csrf } : {}) } });
  if (response.status === 401) { await hostedSession(); return response; }
  if (response.status === 403 && change && again) {
    const body = await response.clone().json().catch(() => null);
    if (/csrf/i.test(`${body?.error} ${body?.message}`)) { HOSTED.csrf = ''; await hostedSession(); return hostedCall(url, init, false); }
  }
  return response;
}
// The project's state, as Cloud gives it, made this page's own: the project is known here by its key in Cloud, and the folder it is
// checked out in on the server is nobody's business.
// Of what changed since the last look (?base=), the parts and lines that did.
function hostedState(state, id = HOSTED.key) {
  if (!state) return state;
  if (state.delta) {
    if (state.set?.project) hostedProject(state.set.project, id);
    for (const list of Object.values(state.lists || {})) hostedLines(list.all || list.put);
    return state;
  }
  if (!state.project) return state;
  if (id === HOSTED.key && state.readOnly && !HOSTED.read) hostedReadOnly();
  hostedProject(state.project, id);
  for (const list of [state.lines, state.backlog, state.landed]) hostedLines(list);
  return state;
}
function hostedLines(list) { for (const l of list || []) if (l && typeof l === 'object' && Array.isArray(l.stations)) { l.topicAbsolutePath = ''; l.folder = ''; l.workdir = ''; } }
function hostedProject(p, id) {
  p.id = id;
  p.myCanvases = id === 'my-canvases' && !HOSTED.shared;
  p.docsPath = ''; p.code = ''; p.docsParent = '';
  p.vault = { ...(p.vault || {}), path:'', code:[] };
  p.offerSkill = false; p.canvasSkill = true; p.memorySkill = true; p.synced = true; p.follow = false;
  p.memoryCommand = '';
  p.archived = Boolean(HOSTED.archived);
}
const hostedSyncedAt = key => Number((HOSTED.list || []).find(c => c.key === key)?.computerSyncedAt) || 0;
const hostedSummary = state => {
  const cloudSyncedAt = HOSTED.onComputer ? hostedSyncedAt(HOSTED.key) : 0;
  return { id:HOSTED.key, name:state.project.name, color:hostedColor(HOSTED.key), pinned:false, archived:Boolean(HOSTED.archived), archivedAt:0, missing:false, example:'', myCanvases:!HOSTED.shared && HOSTED.key === 'my-canvases',
    lastOpenedAt:Date.now(), lines:[], landed:[], pictures:(state.pictures || []).length, notes:(state.notes || []).length, thumb:'', synced:Boolean(HOSTED.onComputer),
    ...(cloudSyncedAt ? { cloudSyncedAt } : {}) };
};
const hostedBaseOf = key => `/api/v1/line-projects/${encodeURIComponent(key)}`;
const hostedColor = key => (typeof cloudColor === 'function' ? cloudColor(key) : '#4f46e5');
// The account's projects in Cloud, asked for at most every 8 s: { key, name, cloudMade, system, archived, updatedAt, rail:[{ id, title, at, shown, questions, unsent }] }.
async function hostedList() {
  if (HOSTED.shared) return [];
  if (HOSTED.listAt && Date.now() - HOSTED.listAt < 8000) return HOSTED.list || [];
  HOSTED.listAt = Date.now();
  try { const r = await hostedCall('/api/v1/line-projects', { headers:{ accept:'application/json' } }); if (r.ok) { const body = await r.json(); HOSTED.list = body.projects || []; HOSTED.sharedList = body.shared || []; } } catch { /* The list it had. */ }
  return HOSTED.list || [];
}
// This project as the page knows it, and the others as the app's own list gives a project on a computer: the newest first, their lines
// with the state they are shown in, and a mark on those kept in step with a computer (cloud.js cloudRail).
async function hostedProjects(here) {
  if (HOSTED.lives) await HOSTED.lives;
  const list = await hostedList(), hereSynced = here.synced ? hostedSyncedAt(HOSTED.key) : 0;
  const current = hereSynced ? { ...here, cloudSyncedAt:hereSynced } : here;
  const others = list.filter(c => c.key !== HOSTED.key).map(c => {
    const synced = !c.cloudMade && !c.system, cloudSyncedAt = synced ? Number(c.computerSyncedAt) || 0 : 0;
    return { id:c.key, name:c.name, color:hostedColor(c.key), pinned:false, archived:Boolean(c.archived), archivedAt:c.archivedAt || 0,
      missing:false, example:'', myCanvases:c.system === 'my-canvases', lastOpenedAt:c.updatedAt || 0, landed:[], pictures:0, notes:0, thumb:'', synced,
      ...(cloudSyncedAt ? { cloudSyncedAt } : {}),
      lines:(c.rail || []).map(l => ({ id:l.id, title:l.title, createdAt:l.createdAt, started:l.started, code:l.code, at:l.at, shown:l.shown, questions:l.questions, unsent:l.unsent > 0, asking:false, pinned:Boolean(l.pinned), readRevision:'' })) };
  });
  return [current, ...others];
}
// ---------- Someone with a shared link ----------
// Signed in, they are who they are, and the project is listed in their dashboard ("Shared with you"). Without an account they give a name
// once, kept in this browser, and every note says it.
const HOSTED_GUEST_NAME = 'penecho-shared-name';
async function hostedGuestJoin() {
  try {
    const session = await (await fetch('/api/v1/auth/session', { credentials:'same-origin', cache:'no-store', headers:{ accept:'application/json' } })).json();
    HOSTED.account = session?.account || null; HOSTED.csrf = session?.csrfToken || '';
    // Joined, the dashboard around the page lists it under Shared with you at once.
    if (HOSTED.account && (await fetch(`${HOSTED.base}/join`, { method:'POST', credentials:'same-origin', headers:{ 'content-type':'application/json', 'x-penecho-csrf':HOSTED.csrf }, body:'{}' })).ok) hostedTell({ projects:true });
  } catch { /* Read as anyone; a note asks for a name. */ }
}
// Shared with you, from the account's side. A project opens in the dashboard beside its rail; one whose link no longer opens is taken out
// of the list as it is clicked, and ⋯ Remove from list takes one out by hand (opening its link again brings it back).
async function hostedOpenShared(token) {
  if (!/^[0-9a-f-]{36}$/i.test(token || '')) return;
  const check = await fetch(`/api/v1/line-shares/${encodeURIComponent(token)}`, { credentials:'same-origin', cache:'no-store', headers:{ accept:'application/json' } }).catch(() => null);
  if (check && (check.status === 404 || check.status === 410)) return hostedLeaveShared(token, { gone:true });
  hostedGo(`/dashboard.html#shared/${encodeURIComponent(token)}`);
}
async function hostedLeaveShared(token, { gone = false } = {}) {
  const response = await hostedCall(`/api/v1/line-shares/${encodeURIComponent(token)}/join`, { method:'DELETE', headers:{ accept:'application/json' } }).catch(() => null);
  if (!response?.ok && !gone) { toast('It could not be removed. Try again.'); return; }
  HOSTED.sharedList = (HOSTED.sharedList || []).filter(x => x.token !== token);
  renderRail();
  hostedTell({ projects:true });
  toast(gone ? 'This shared project no longer exists, so it was removed from your list.' : 'Removed from Shared with you.');
}
function hostedGuestName() {
  let kept = ''; try { kept = localStorage.getItem(HOSTED_GUEST_NAME) || ''; } catch { /* Asked each time. */ }
  if (kept) return Promise.resolve(kept);
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'line-command-dialog guest-name';
    dialog.innerHTML = `<form method="dialog"><h2>Your name</h2><p>It goes with your notes, so the project's owner knows who wrote them.</p><input name="name" maxlength="60" autocomplete="name" required><footer><button type="button" class="btn" data-cancel>Cancel</button><button type="submit" class="btn primary">Add note</button></footer></form>`;
    document.body.append(dialog);
    const form = $('form', dialog), field = form.elements.name;
    let said = '';
    $('[data-cancel]', dialog).onclick = () => dialog.close();
    form.onsubmit = event => { event.preventDefault(); said = field.value.trim().slice(0, 60); if (said) dialog.close(); };
    dialog.addEventListener('close', () => { dialog.remove(); if (said) { try { localStorage.setItem(HOSTED_GUEST_NAME, said); } catch { /* This note only. */ } } resolve(said); });
    dialog.showModal(); field.focus();
  });
}
async function hostedGuestNote(init) {
  let said = {}; try { said = JSON.parse(init.body || '{}'); } catch { said = {}; }
  if (said.kind && said.kind !== 'note') return hostedAnswer({ error:'Only notes can be added from a shared link.', code:'read_only' }, 403);
  return hostedSendNote(said);
}
const GUEST_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
function hostedPictureProblem(kept, added) {
  if (added.some(file => !GUEST_IMAGE_TYPES.includes(file.type) || !file.size)) return 'Choose a PNG, JPEG, WebP or GIF picture.';
  if (kept.length + added.length > 4) return 'A note can include up to four pictures.';
  if ([...kept, ...added].reduce((sum, file) => sum + file.size, 0) > 8 * 1024 * 1024) return 'Choose pictures totaling 8 MB or less for this note.';
  return '';
}
function hostedGuestBar() {
  return `<input type="file" accept="${GUEST_IMAGE_TYPES.join(',')}" multiple hidden aria-label="Choose pictures">
    <div class="guest-tools" role="group" aria-label="Add media to note">
      <button type="button" class="btn sm guest-media" data-pick-picture aria-label="Add picture" title="Add picture">${ic('image', 16)}<span>Add picture</span></button>
      <button type="button" class="btn sm guest-media" data-draw-note aria-label="Draw" title="Draw">${ic('pen', 16)}<span>Draw</span></button>
    </div>
    <button type="submit" class="send-btn has-word is-note" title="Save as note (Enter)"><span>Save as note</span><kbd class="cmp-key" aria-hidden="true"><b>↵</b></kbd></button>`;
}
function hostedDrawNote(key, opener) {
  const dialog = document.createElement('dialog');
  dialog.className = 'line-command-dialog guest-drawing';
  dialog.setAttribute('aria-labelledby', 'guestDrawingTitle');
  dialog.innerHTML = `<h2 id="guestDrawingTitle">Draw on canvas</h2>
    <div class="sheet-wrap blank" aria-label="Drawing surface"><div class="sheet-stage"><svg class="ink-layer" aria-hidden="true"></svg><div class="note-layer"></div></div></div>
    <footer><button type="button" class="btn" data-undo disabled>Undo</button><button type="button" class="btn" data-cancel>Cancel</button>
      <button type="button" class="btn primary" data-add disabled>Add to note</button></footer>`;
  document.body.append(dialog);
  dialog.showModal();
  const marks = [], undo = $('[data-undo]', dialog), add = $('[data-add]', dialog);
  const sheet = new Sheet($('.sheet-wrap', dialog), { marks, blank:true, tool:'pen', tools:['pen'], onChange:() => { undo.disabled = add.disabled = !marks.length; } });
  sheet.setColor(INK_COLORS[0]);
  undo.onclick = () => sheet.undo();
  $('[data-cancel]', dialog).onclick = () => dialog.close();
  add.onclick = async () => {
    add.disabled = true;
    try {
      const svg = marksSVG(marks, { background:'none' });
      const { bytes } = await rasterize('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), { background:null, maxWidth:1536, maxHeight:1536 });
      if (dialog.open && await addFiles(key, [new File([bytes], 'Drawing.png', { type:'image/png' })], { drawing:true })) dialog.close();
    } catch (error) { toast(error.message); }
    finally { add.disabled = !marks.length; }
  };
  dialog.addEventListener('close', () => { sheet.destroy(); dialog.remove(); if (opener.isConnected) opener.focus(); }, { once:true });
}
async function hostedSendNote(said, files = []) {
  await HOSTED.joining;
  const name = HOSTED.account ? '' : await hostedGuestName();
  if (!HOSTED.account && !name) return hostedAnswer({ error:'Add your name to leave a note.', code:'name_required' }, 400);
  const headers = { accept:'application/json', 'content-type':'application/json', ...(HOSTED.account && HOSTED.csrf ? { 'x-penecho-csrf':HOSTED.csrf } : {}) };
  const pictures = [];
  for (const file of files) {
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.slice(reader.result.indexOf(',') + 1));
      reader.onerror = () => reject(new Error('Could not read the picture. Choose it again.'));
      reader.readAsDataURL(file.blob);
    });
    pictures.push({ name:file.name, data, drawing:Boolean(file.drawing) });
  }
  const body = { topic:String(said.topic || 'new'), text:String(said.text || ''), ...(name ? { name } : {}), ...(pictures.length ? { pictures } : {}) };
  const response = await fetch(`${HOSTED.base}/yours${pictures.length ? '/pictures' : ''}`, { method:'POST', credentials:'same-origin', cache:'no-store', headers, body:JSON.stringify(body) });
  HOSTED.last = '';
  return hostedSaid(response);
}

// ---------- A page's picture ----------
// A Canvas made from a page (<name>.explorer.html) has only a stand-in picture here: penecho.ai has no browser to draw it. Its card shows the page
// itself, in a frame sandboxed to scripts only (no reach into penecho.ai), at the size the picture would have had, scaled to the card.
const HOSTED_PAGE_W = 1200, HOSTED_PAGE_H = 750, hostedPages = new Map();
function hostedLivePage(p, path) {
  if (!HOSTED || !/\.png$/.test(String(path || ''))) return '';
  const page = String(path).replace(/\.png$/, '.explorer.html');
  return typeof fileEntry === 'function' && fileEntry(p, page) ? page : '';
}
function hostedFitPage(frame) {
  const box = frame.parentElement; if (!box) return;
  // In a picture's place the box keeps its size and the page covers it; on its own the box is as tall as the page at its width.
  const fixed = box.classList.contains('is-in-place') && box.clientHeight > 0;
  const scale = fixed ? Math.max(box.clientWidth / HOSTED_PAGE_W, box.clientHeight / HOSTED_PAGE_H) : (box.clientWidth || HOSTED_PAGE_W) / HOSTED_PAGE_W;
  frame.style.transform = `scale(${scale})`;
  if (!fixed) box.style.height = `${Math.round(HOSTED_PAGE_H * scale)}px`;
}
// Any picture of a page, wherever it is drawn (a card, Home, the file viewer), becomes the page itself.
function hostedSwapPictures(root = document) {
  const p = typeof project === 'function' ? project() : null; if (!p) return;
  for (const img of root.querySelectorAll?.('img[src*="file?path="]:not([data-page-checked])') || []) {
    img.dataset.pageChecked = '1';
    let path = ''; try { path = new URL(img.src, location.href).searchParams.get('path') || ''; } catch { continue; }
    const page = hostedLivePage(p, path); if (!page) continue;
    const box = document.createElement('div'), was = getComputedStyle(img);
    box.className = 'pic-live is-in-place'; box.setAttribute('role', 'img'); box.setAttribute('aria-label', img.alt || 'Page');
    // It takes the picture's place exactly: where the picture filled a thumbnail, the page fills it.
    if (was.position === 'absolute') Object.assign(box.style, { position:'absolute', top:was.top, left:was.left, right:was.right, bottom:was.bottom, width:was.width, height:was.height });
    else Object.assign(box.style, { width:was.width, height:was.height });
    box.innerHTML = `<iframe sandbox="allow-scripts" tabindex="-1" aria-hidden="true" data-live-page="${esc(page)}" title="${esc(img.alt || 'Page')}"></iframe>`;
    img.replaceWith(box);
  }
}
function hostedFillPages(root = document) {
  hostedSwapPictures(root);
  for (const frame of root.querySelectorAll?.('iframe[data-live-page]:not([data-filled])') || []) {
    const page = frame.dataset.livePage;
    frame.dataset.filled = '1';
    hostedFitPage(frame);
    hostedPageFit.observe(frame.parentElement);
    const text = hostedPages.get(`${HOSTED.key}:${page}`) || fetch(`${HOSTED.base}/file?path=${encodeURIComponent(page)}`, { credentials:'same-origin', cache:'no-store' }).then(r => (r.ok ? r.text() : ''));
    hostedPages.set(`${HOSTED.key}:${page}`, text);
    // A page written into this frame would keep this page's content policy, which runs none of its scripts: it goes to a frame page of
    // its own (Cloud's /canvas/page-frame.html), which asks for it once it is ready.
    hostedPageText.set(frame, Promise.resolve(text));
    frame.src = 'page-frame.html';
  }
}
// Linear-time, quote-aware opening <html ...> root check matching src/server/prototype-rules.js.
function hostedIsPrototypeHtml(html) {
  const s = String(html || ''), len = s.length;
  let i = len > 0 && s.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (i < len) {
    while (i < len && s.charCodeAt(i) <= 32) i++;
    if (i >= len) return false;
    if (s.startsWith('<!--', i)) { const end = s.indexOf('-->', i + 4); if (end < 0) return false; i = end + 3; continue; }
    if (s[i] === '<' && s[i + 1] === '!' && s.slice(i + 2, i + 9).toLowerCase() === 'doctype') { const end = s.indexOf('>', i + 9); if (end < 0) return false; i = end + 1; continue; }
    break;
  }
  if (i + 5 > len || s[i] !== '<' || s.slice(i + 1, i + 5).toLowerCase() !== 'html') return false;
  i += 5;
  if (i < len && s.charCodeAt(i) > 32 && s[i] !== '>' && s[i] !== '/') return false;
  while (i < len) {
    while (i < len && (s.charCodeAt(i) <= 32 || s[i] === '/')) i++;
    if (i >= len || s[i] === '>') return false;
    const ns = i;
    while (i < len && s.charCodeAt(i) > 32 && s[i] !== '=' && s[i] !== '>' && s[i] !== '/') i++;
    const name = s.slice(ns, i).toLowerCase();
    while (i < len && s.charCodeAt(i) <= 32) i++;
    let val = '';
    if (i < len && s[i] === '=') {
      i++;
      while (i < len && s.charCodeAt(i) <= 32) i++;
      if (i < len && (s[i] === '"' || s[i] === "'")) {
        const q = s[i++], vs = i, close = s.indexOf(q, i);
        if (close < 0) return false;
        val = s.slice(vs, close); i = close + 1;
      } else {
        const vs = i;
        while (i < len && s.charCodeAt(i) > 32 && s[i] !== '>') i++;
        val = s.slice(vs, i);
      }
    }
    if (name === 'data-penecho-prototype') return !/^(?:0|false|no|off)$/i.test(val.trim());
  }
  return false;
}
function hostedPageHtml(html) {
  if (hostedIsPrototypeHtml(html)) return html;
  return `<style>html,body{font-size:clamp(36px,1.2cqw,52px)}</style>${html}`;
}
const hostedPageText = new WeakMap();
if (HOSTED) addEventListener('message', event => {
  if (!event.data?.penechoPageReady) return;
  const frame = [...document.querySelectorAll('iframe[data-live-page]')].find(f => f.contentWindow === event.source);
  const text = frame && hostedPageText.get(frame); if (!text) return;
  text.then(html => { if (html && frame.isConnected) event.source.postMessage({ penechoPage:hostedPageHtml(html) }, '*'); }).catch(() => {});
});
const hostedPageFit = typeof ResizeObserver === 'function' ? new ResizeObserver(entries => { for (const entry of entries) { const frame = entry.target.querySelector('iframe[data-live-page]'); if (frame) hostedFitPage(frame); } }) : { observe() {} };
// Once a frame at most, however many changes a redraw makes.
let hostedPagesAsked = false;
if (HOSTED) new MutationObserver(() => { if (hostedPagesAsked) return; hostedPagesAsked = true; requestAnimationFrame(() => { hostedPagesAsked = false; hostedFillPages(); }); }).observe(document.documentElement, { childList:true, subtree:true });

// New project on penecho.ai: a name makes a project in Cloud, and an example is copied in when it is clicked; either opens in the dashboard.
function hostedNewProject() {
  if (!HOSTED || HOSTED.read) return null;
  const make = async body => {
    const response = await hostedSaid(await hostedCall('/api/v1/line-projects', { method:'POST', headers:{ accept:'application/json', 'content-type':'application/json' }, body:JSON.stringify(body) }));
    const made = await response.json();
    if (!response.ok) throw new Error(made.error);
    HOSTED.listAt = 0;
    // The page opens a project it knows: the list is read again first, or the new project's address would leave New project on screen.
    try { await loadProjects(); } catch {}
    hostedGo(`/lines/${encodeURIComponent(made.project.key)}`);
  };
  return { create:name => make({ name }), makeExample:kind => make({ example:kind }) };
}
// Another project opens in this same page, as on a computer: what the page knows of this project is put aside for that one, and the
// dashboard is told, so its address follows.
function hostedRekey(id) {
  if (!HOSTED || HOSTED.shared || id === HOSTED.key) return null;
  Object.assign(HOSTED, { key:id, base:hostedBaseOf(id), first:null, last:'', told:'', askedAt:0, quiet:{}, lives:null, livesDone:false, archived:false, onComputer:false, system:false });
  try { HOSTED.held = JSON.parse(localStorage.getItem(HOSTED_HELD_KEY()) || '{}') || {}; } catch { HOSTED.held = {}; }
  S.presets = null;
  return hostedLives();
}
if (HOSTED) {
  const hostedWakePolls = () => { if (typeof document !== 'undefined' && document.hidden) return; HOSTED.askedAt = 0; HOSTED.quiet = {}; };
  addEventListener('focus', hostedWakePolls);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', hostedWakePolls);
}
// Where it lives, its agents and its state are asked for together, not one after another.
async function hostedSwitch(own, id, options = {}) {
  if (EMBED?.rail) return own(id, options);
  const route = options.route || (options.view ? { view:options.view } : lastProjectRoute(id)), lives = hostedRekey(id);
  const read = S.data[id] && !options.fresh ? null : loadState(id, { force:true, route }).catch(() => null);
  await lives;
  if (HOSTED.key !== id) return;
  // Its agents are asked of its computers: slow to answer, they fill in on the open page.
  let late = false;
  const agents = loadAgents().then(() => { if (late && HOSTED.key === id) refreshAfterChange(); }, () => { /* The next look asks again. */ });
  await Promise.all([read, Promise.race([agents, new Promise(resolve => setTimeout(resolve, 300))])]);
  late = true;
  if (HOSTED.key !== id) return;
  if (S.data[id]) S.data[id].archived = Boolean(HOSTED.archived);
  await own(id, read && S.data[id] ? { ...options, fresh:false } : options);
  if (HOSTED.key === id) hostedAddress();
}
// Back, Forward or a link to another project's page: the page reads it before main.js does (this file loads first).
if (HOSTED && !HOSTED.shared) addEventListener('hashchange', () => {
  let first = ''; try { first = decodeURIComponent(location.hash.slice(1).split('/')[0]); } catch { return; }
  if (first && first !== HOSTED.key && !HOSTED_OUTSIDE.includes(first) && !['cloud', 'meetcue'].includes(first) && /^[A-Za-z0-9._:-]{1,128}$/.test(first)) hostedRekey(first);
});
// What the account row of the local rail would ask a computer's own server, answered from Cloud.
async function hostedAccount() {
  const [session, summary] = await Promise.all([HOSTED.account ? { account:HOSTED.account } : hostedSession(), fetch('/api/v1/credits/summary', { credentials:'same-origin', cache:'no-store', headers:{ accept:'application/json' } }).then(r => (r.ok ? r.json() : null)).catch(() => null)]);
  if (!session?.account) return { signedIn:false };
  return { signedIn:true, name:session.account.name || session.account.email || '', plan:summary?.plan || '', origin:location.origin,
    credits:Number.isFinite(Number(summary?.available)) ? { available:Number(summary.available) } : null, kept:summary?.kept ? { projects:Number(summary.kept.projects) || 0, limit:summary.kept.limit ?? null } : null };
}
// Cloud's own words are in `message` and its code in `error`; this page reads the words from `error`.
async function hostedSaid(response) {
  if (response.ok || response.status === 402) return response;
  const body = await response.json().catch(() => null);
  return hostedAnswer({ ...(body || {}), error:body?.message || `PenEcho Cloud could not do that (${response.status}).`, code:body?.error || '' }, response.status);
}
// Keep the gateway error through the throttle interval so a skipped read cannot signal recovery.
function hostedStateRetry() {
  HOSTED.stateUnavailable = true;
  return hostedAnswer({ error:'PenEcho Cloud is temporarily unavailable. Trying again.' }, 503);
}
// What api() fetches here instead of /api/lines<path>.
async function hostedFetch(path, init) {
  const [, pid = '', rest = ''] = /^\/projects\/([^/?]+)(.*)$/.exec(path) || [], method = init.method || 'GET';
  // Which project a request is about is in its path: after a switch, a look still on its way for the last one is answered for that one.
  let id = HOSTED.key; try { if (pid) id = decodeURIComponent(pid); } catch { /* This project. */ }
  const base = HOSTED.shared || id === HOSTED.key ? HOSTED.base : hostedBaseOf(id);
  // Read only: nothing is sent that would change the project.
  // A note from someone with the link (the box saves notes only here): Cloud adds who wrote it.
  if (HOSTED.shared && method === 'POST' && rest === '/yours') return hostedGuestNote(init);
  // Opening a project is this browser's own navigation: nothing of it is kept on the server.
  if (method === 'PATCH' && rest === '?opened=1') return hostedAnswer({ ok:true });
  if (HOSTED.read && !['GET', 'HEAD'].includes(method)) return hostedAnswer({ error:HOSTED.shared ? 'This shared project is read only.' : 'Open PenEcho on a computer to change this project.', code:'read_only' }, 403);
  if (method === 'POST' && /^\/topics\/[^/]+\/continue$/.test(rest)) return hostedAnswer({ error:"Open PenEcho on the computer that owns this Work's saved session.", code:'local_only' }, 409);
  // The project itself.
  if (rest.startsWith('/state')) {
    const taken = id === HOSTED.key && HOSTED.first?.rest === rest ? HOSTED.first.state : null; HOSTED.first = null;
    // A look names what it has, a run or not: the revision Cloud gives folds in every run and hold it shows (withLive), so "the same"
    // means nothing changed. Looking whole while a line worked brought the whole state every two seconds (PE-692); a big one is megabytes.
    const named = /[?&]rev=/.test(rest), live = hostedLive();
    // Each look checks the project out on the server, so with nothing running the page looks half as often as on a computer.
    // On an idle cloud-only project with no active/recent run, skip polls while hidden and check only every 30s while visible.
    const background = named && !live && HOSTED.onComputer && id === HOSTED.key;
    const idleCloudOnly = Boolean(named && !live && HOSTED.livesDone && !HOSTED.onComputer && !HOSTED.shared && HOSTED.last && id === HOSTED.key);
    const hiddenTab = Boolean(named && !live && typeof document !== 'undefined' && document.hidden);
    const pollEveryMs = idleCloudOnly ? 30000 : 3500;
    if (named && !live && (hiddenTab || Date.now() - HOSTED.askedAt < pollEveryMs)) {
      return background && HOSTED.stateUnavailable ? hostedStateRetry() : hostedAnswer({ same:true });
    }
    HOSTED.askedAt = Date.now();
    let response;
    try {
      if (taken && !named) return hostedAnswer(hostedState(taken, id));
      response = await hostedCall(`${base}${rest}`, init);
    } catch (error) {
      if (!background || init.signal?.aborted) throw error;
      return hostedStateRetry();
    }
    if (background && [502, 503, 504].includes(response.status)) return hostedStateRetry();
    if (id === HOSTED.key) HOSTED.stateUnavailable = false;
    if (!response.ok) return hostedSaid(response);
    const text = await response.text();
    if (named && text === HOSTED.last) return hostedAnswer({ same:true });
    const state = JSON.parse(text);
    if (state.same) return hostedAnswer(state);
    HOSTED.last = text;
    return hostedAnswer(hostedState(state, id));
  }
  if (/^\/topics\/[^/]+\/run-unsent$/.test(rest)) return hostedRun(rest, init);
  // What the agent is doing: asked every second on a computer; here, with nothing running on the line, every ten (30s on idle cloud-only, 0 while hidden).
  if (/^\/topics\/[^/]+\/activity/.test(rest) && method === 'GET') {
    const kept = HOSTED.quiet[rest];
    const quietMs = HOSTED.livesDone && !HOSTED.onComputer && !HOSTED.shared ? 30000 : 10000;
    if (kept && !hostedLive() && ((typeof document !== 'undefined' && document.hidden) || Date.now() - kept.at < quietMs)) return hostedAnswer(kept.body);
    const response = await hostedCall(`${base}${rest}`, init);
    if (!response.ok) return hostedSaid(response);
    const body = await response.json();
    if (body.running) delete HOSTED.quiet[rest]; else HOSTED.quiet[rest] = { at:Date.now(), body };
    return hostedAnswer(body);
  }
  // Words added from a line's own file are one more Ask on it, kept Not sent as every Ask is here.
  if (/^\/topics\/[^/]+\/feedback$/.test(rest)) {
    let said = {}; try { said = JSON.parse(init.body || '{}'); } catch { /* Nothing to add. */ }
    return hostedSaid(await hostedCall(`${base}/unsent`, { ...init, body:JSON.stringify({ topic:decodeURIComponent(rest.split('/')[2]), text:String(said.text || '') }) }));
  }
  // Retry on a project that lives on a computer is held for that computer, as Run is.
  if (/^\/topics\/[^/]+\/retry$/.test(rest)) return hostedSaid(await hostedCall(`${base}${rest}`, await hostedNamed(decodeURIComponent(rest.split('/')[2]), init)));
  // Save all review marks in the same Cloud revision.
  if (/^\/topics\/[^/]+\/review-all$/.test(rest)) return hostedReviewAll(rest, init, base);
  // Share: the dialog asks what a computer knows of the project's copy in Cloud (share.js); here the project is that copy.
  if (rest === '/cloud' && method === 'GET') return hostedShare(await hostedCall(`${base}/share`, { headers:{ accept:'application/json' } }));
  if (rest === '/share') return hostedShare(await hostedCall(`${base}/share`, init));
  if (rest && rest !== '/') return hostedSaid(await hostedCall(`${base}${rest}`, init));
  // The project itself: its name. The dashboard's rail shows it too.
  if (path !== '/projects' && method === 'PATCH') {
    // Opening changes the browser's navigation, with no project content to rewrite on the server.
    if (init.body === JSON.stringify({ opened:true })) return hostedAnswer({ ok:true });
    const response = await hostedSaid(await hostedCall(base, init));
    if (response.ok) { let said = {}; try { said = JSON.parse(init.body || '{}'); } catch { said = {}; } if (said.archived !== undefined) HOSTED.archived = said.archived === true; HOSTED.last = ''; hostedTell({ projects:true }); }
    return response;
  }
  // What a computer's own server knows: its projects, its agents, the account it is signed in to, MeetCue.
  if (path === '/projects' && method === 'GET') {
    // This project, from what the page knows, and every other project the account keeps in Cloud, as the rail shows them.
    const known = typeof project === 'function' ? project(HOSTED.key) : null;
    let here = known ? hostedSummary({ project:known, pictures:known.pictures, notes:known.notes }) : null;
    // On its way from another project: that look brings the state, and the list has its name.
    const going = !here && S.cur && S.cur !== HOSTED.key ? (HOSTED.list || []).find(c => c.key === HOSTED.key) : null;
    if (going) here = hostedSummary({ project:{ name:going.name } });
    if (!here) {
      // Read exactly what loadState asks for next, so opening never downloads the project twice.
      const first = stateAsk(HOSTED.key, { force:true, route:hostedFirstRoute() }).path.replace(/^\/projects\/[^/]+/, '');
      const response = await hostedCall(`${base}${first}`, { headers:{ accept:'application/json' } });
      if (!response.ok) return hostedSaid(response);
      const state = await response.json();
      // As the page starts it asks for the state next; that is the one just read, when it asks for the same.
      HOSTED.first = { rest:first, state };
      here = hostedSummary(state);
    }
    return hostedAnswer({ projects:await hostedProjects(here), base:'' });
  }
  if (path === '/my-canvases' && method === 'POST') {
    const response = await hostedSaid(await hostedCall('/api/v1/my-canvases', init));
    if (response.ok) HOSTED.listAt = 0;
    return response;
  }
  if (path === '/library' && !HOSTED.shared) {
    const response = await hostedCall('/api/v1/my-canvases', { headers:{ accept:'application/json' } });
    if (!response.ok) return hostedSaid(response);
    const { library, canvases } = await response.json();
    const imported = new Set((canvases || []).map(c => c.from));
    return hostedAnswer({ canvases:library.map(c => ({ from:'cloud:' + c.id, title:c.title, kept:'cloud', project:{ name:c.group }, imported:imported.has('cloud:' + c.id) })) });
  }
  if (path === '/projects' && method === 'POST') {
    const response = await hostedSaid(await hostedCall('/api/v1/line-projects', init));
    if (!response.ok) return response;
    const made = await response.json();
    HOSTED.listAt = 0;
    return hostedAnswer({ ...made, project:{ ...made.project, id:made.project.key }, moved:made.moved?.copied || 0, left:made.moved?.left || 0 });
  }
  if (path === '/agents') return hostedAnswer({ agents:await hostedAgents(), thisComputer:false, openFolderLabel:'', revealFileLabel:'', computers:HOSTED.computers });
  if (path.startsWith('/agents/check')) return hostedAnswer({ unavailable:true });
  if (path === '/cloud/account') return hostedAnswer(HOSTED.shared ? { signedIn:false } : await hostedAccount());
  if (path === '/cloud/models') return HOSTED.shared ? hostedAnswer({ models:[] }) : hostedCall('/api/v1/models', { headers:{ accept:'application/json' } });
  if (path === '/cloud/projects') return hostedAnswer({ projects:[], kept:null, limit:null });
  if (path === '/settings' && method === 'GET') return hostedAnswer({ presets:[], keys:[], hostedOnly:true });
  // MeetCue through the account's own link (the dashboard's MeetCue page connects it). Which lines of every project a meeting is on is
  // something only a computer works out across its projects.
  if (path === '/meetcue/links') return hostedAnswer({ signedIn:!HOSTED.shared, links:{} });
  if (HOSTED.shared && /^\/meetcue(\/|\?|$)/.test(path)) return hostedAnswer({ signedIn:false, meetings:[] });
  if (/^\/meetcue(\/meetings(\/[A-Za-z0-9-]{1,80})?)?(\?|$)/.test(path) && (method === 'GET' || method === 'DELETE')) {
    const response = await hostedCall(`/api/v1${path}`, init);
    if (!response.ok) return hostedSaid(response);
    const body = await response.json().catch(() => ({}));
    return hostedAnswer(/^\/meetcue(\?|$)/.test(path) ? { ...body, signedIn:true } : body);
  }
  return hostedAnswer({ error:'This only works in PenEcho on a computer.', code:'local_only' }, 403);
}

// The answer a computer gives about the project's copy in Cloud (cloud-share.js view), made from Cloud's own: the copy is this project.
async function hostedShare(response) {
  if (!response.ok) return hostedSaid(response);
  const { project:remote } = await response.json(), share = remote?.share || null;
  return hostedAnswer({ signedIn:true, name:HOSTED.account?.name || '', plus:Boolean(remote?.plus), remote, origin:location.origin, link:share ? `${location.origin}${share.url}` : '',
    maxBytes:Number(remote?.maxBytes) || 0, progress:null, error:'' });
}

// ---------- An Ask that could not start ----------
// On a computer the project's own file says why an Ask is held. Cloud says it in its answer to Run and leaves the file alone, so this page
// remembers it (for this browser) and shows it the same way. An Ask held for a busy line is tried again while the page is open.
const HOSTED_HELD_KEY = () => `penecho-hosted-held:${HOSTED.key}`;
if (HOSTED) { try { HOSTED.held = JSON.parse(localStorage.getItem(HOSTED_HELD_KEY()) || '{}') || {}; } catch { HOSTED.held = {}; } }
function hostedKeepHeld() { try { if (Object.keys(HOSTED.held).length) localStorage.setItem(HOSTED_HELD_KEY(), JSON.stringify(HOSTED.held)); else localStorage.removeItem(HOSTED_HELD_KEY()); } catch { /* This visit only. */ } }
function hostedHeld(state) {
  const live = new Set();
  for (const l of [...(state.lines || []), ...(state.backlog || []), ...(state.landed || [])]) for (const s of l.stations || []) {
    const mark = `${l.slug || l.id}/${s.id}`, held = s.unsent && HOSTED.held[mark];
    // A line that did not change is the same object as before: what this page put on it goes when it no longer holds.
    if (held) { s.held = held; s.heldHere = true; live.add(mark); }
    else if (s.heldHere) { s.held = null; s.heldHere = false; }
  }
  // An Ask that has gone, or was sent, is no longer held.
  let changed = false;
  for (const mark of Object.keys(HOSTED.held)) if (!live.has(mark)) { delete HOSTED.held[mark]; changed = true; }
  if (changed) hostedKeepHeld();
}
// A project on a computer: Run and Retry name the agent and the computer that has it, and the Ask is held for that computer (the hold is
// in the line's own file, and the state shows it). Without an agent named, the one Run would use on this line.
async function hostedNamed(slug, init) {
  if (!HOSTED.onComputer) {
    const pickedModelId = hostedModelSelection(slug)?.id || '';
    if (!pickedModelId) return init;
    let said = {}; try { said = JSON.parse(init.body || '{}') || {}; } catch { said = {}; }
    if (said.modelId) return init;
    return { ...init, body:JSON.stringify({ ...said, modelId:pickedModelId }) };
  }
  let said = {}; try { said = JSON.parse(init.body || '{}') || {}; } catch { said = {}; }
  await hostedComputers(Date.now() - HOSTED.computersAt > 30000);
  const p = typeof project === 'function' ? project() : null, l = p && lineById(p, slug);
  const agent = said.agent || (l && runAgent(p, l)?.id) || 'penecho';
  // A saved agent goes to the computer it was saved on; Retry, which names none, takes the one Run would use.
  const presets = S.presets?.presets || [], picked = said.preset ? presets.find(x => x.id === said.preset && x.agent === agent) : (l && typeof runPreset === 'function' ? runPreset(p, l) : null);
  const preset = picked?.agent === agent ? picked : null, on = (preset && (HOSTED.computers || []).find(c => c.id === preset.computer)) || hostedComputerFor(slug, agent);
  return { ...init, body:JSON.stringify({ ...said, agent, ...(preset ? { preset:preset.id } : { preset:undefined }), ...(on ? { computer:on.id } : {}) }) };
}
async function hostedRun(rest, init) {
  const slug = decodeURIComponent(rest.split('/')[2]);
  let step = ''; try { step = JSON.parse(init.body || '{}').step || ''; } catch { /* No step: the line's last Ask. */ }
  init = await hostedNamed(slug, init);
  const mark = `${slug}/${step}`, response = await hostedCall(`${HOSTED.base}${rest}`, init);
  const body = response.ok ? null : await response.clone().json().catch(() => null);
  if (response.status === 402 && body?.error === 'insufficient_credits') HOSTED.held[mark] = { reason:'credits', balance:body.balance, required:body.required };
  else if (response.status === 409 && body?.error === 'line_busy') HOSTED.held[mark] = { reason:'busy', where:body.where || body.details?.where || 'your computer', since:body.since || body.details?.since || 0 };
  else delete HOSTED.held[mark];
  hostedKeepHeld();
  // Kept, not failed: the page carries on as after any Run, and the Ask says why it waits.
  if (HOSTED.held[mark]?.reason === 'busy') return hostedAnswer({ ok:true, agent:'', held:true });
  if (response.ok) { HOSTED.runAt = Date.now(); HOSTED.quiet = {}; hostedCredits(); }
  return hostedSaid(response);
}
// The Run menu here says where the Ask runs. Made on penecho.ai: PenEcho, and the computers' agents are shown but cannot be chosen.
// On a computer: that computer's agents, under its name; with two computers, each under its own, and the choice names the computer.
let hostedRunOpening = null;
async function hostedRunPick(el) {
  const projectId = S.cur, lineId = el.dataset.line, step = el.dataset.step;
  if (cloudRunSending(project(), lineById(project(), lineId), step)) return;
  const target = unsentTarget(el), resolveAnchor = unsentMenuAnchor(el, target);
  if ($('#menu.run-menu') || (hostedRunOpening?.current() && hostedRunOpening.project === projectId && hostedRunOpening.line === lineId && hostedRunOpening.step === step)) { closeMenu(); return; }
  const current = beginMenuRequest(el);
  hostedRunOpening = { project:projectId, line:lineId, step, current };
  const computers = HOSTED.onComputer ? await hostedComputers() : [];
  if (!HOSTED.onComputer) await hostedModels();
  if (!current()) return;
  // A poll can replace the Ask while computers are loading. Resolve only this view's exact control.
  const at = target(), anchor = resolveAnchor();
  if (!at || !anchor || cloudRunSending(at.p, at.l, step)) { closeMenu(); return; }
  const { p, l } = at, now = runAgent(p, l)?.id;
  const run = (agent, computer, preset = '') => () => chooseUnsent(target, ({p, l, s}) => {
    if (cloudRunSending(p, l, s.id)) return;
    if (computer) HOSTED.runOn[l.slug] = computer;
    runUnsent(p, l, s.id, agent, preset);
  });
  let items;
  if (!HOSTED.onComputer) {
    const lineKey = l.slug || l.id, workers = hostedWorkerModels(), chosenId = hostedModelSelection(lineKey)?.id || '';
    items = workers.length
      ? [{ head:'Run with PenEcho Cloud' }, ...workers.map(m => ({
        label:`PenEcho · ${hostedModelLabel(m)}`,
        av:'penecho',
        on:m.id === chosenId,
        fn:() => chooseUnsent(target, ({ p, l, s }) => {
          if (cloudRunSending(p, l, s.id)) return;
          (HOSTED.runModel ||= {})[l.slug || l.id] = m.id;
          runUnsent(p, l, s.id, 'penecho');
        }),
      }))]
      : [{ head:'Run with' }, { label:'PenEcho', av:'penecho', on:true, fn:run('penecho') }];
  } else {
    const owning = computers.filter(hostedSyncs), shown = owning.length ? owning : computers;
    const groups = shown.map(c => ({ c, agents:(c.agents || []).filter(a => a.ready) })).filter(g => g.agents.length), on = hostedComputerFor(l.slug, now || 'penecho')?.id;
    // A computer with saved agents lists them, as its own Run menu does; one without lists its agents.
    const chosen = typeof runPreset === 'function' ? runPreset(p, l)?.id : '', ready = g => new Set(g.agents.map(a => a.id));
    const byAlpha = (a, b) => String(a.label || '').localeCompare(String(b.label || ''), undefined, { sensitivity:'base', numeric:true }) || String(a.label || '').localeCompare(String(b.label || ''));
    items = groups.length ? groups.flatMap((g, i) => [...(i ? [{ sep:1 }] : []), { head:`Run on ${g.c.name}${g.c.open ? '' : ' (PenEcho is closed there)'}` },
      ...((g.c.presets || []).some(x => ready(g).has(x.agent))
        ? (g.c.presets || []).filter(x => ready(g).has(x.agent)).map(x => ({ label:x.name, av:x.agent, on:x.id === chosen && (groups.length === 1 || g.c.id === on), fn:run(x.agent, g.c.id, x.id) }))
        : g.agents.map(a => ({ label:hostedAgent(a.id, a.id === 'penecho' ? '' : a.name).name, av:a.id, on:a.id === now && (groups.length === 1 || g.c.id === on), fn:run(a.id, g.c.id) }))).sort(byAlpha)])
      : [{ head:'Run on your computer' }, { label:'PenEcho', av:'penecho', on:true, fn:run('penecho') }];
  }
  openMenu(anchor, items, { align:'left', className:'run-menu', resolveAnchor });
  if (!HOSTED.onComputer && typeof runMenuCredits === 'function') runMenuCredits($('#menu'), runnableAgents());
}
// A run started from this page a moment ago, or a line that says it is working.
function hostedLive() {
  // A project on a computer runs there: its runs reach Cloud by sync, which moves the revision, so "anything new?" is enough. Looking
  // whole every few seconds would bring megabytes each time for a big project with a line at work.
  if (HOSTED.onComputer) return false;
  if (Date.now() - HOSTED.runAt < 20000) return true;
  const p = typeof project === 'function' ? project() : null;
  return Boolean(p && allLines(p).some(l => lineState(l) === 'working'));
}
async function hostedReviewAll(rest, init, base) {
  // The server knows every Work, even if this page has a partial state. Its
  // workspace commits the complete change once, or rejects that revision.
  return hostedSaid(await hostedCall(`${base}${rest}`, init));
}
// The balance under PenEcho in Run with follows what a run spent.
function hostedCredits() { if (typeof loadCloudAccount === 'function') setTimeout(loadCloudAccount, 4000); }
// Called with every look at the project (main.js poll): an Ask waiting for its line is sent as soon as the line is free.
let hostedTrying = false;
async function hostedRetry() {
  if (!HOSTED || hostedTrying) return;
  const waiting = Object.entries(HOSTED.held).filter(([, held]) => held.reason === 'busy' && Date.now() - (held.tried || 0) > 10000);
  if (!waiting.length) return;
  hostedTrying = true;
  try {
    for (const [mark, held] of waiting) {
      held.tried = Date.now();
      const [slug, step] = mark.split('/');
      await hostedRun(`/topics/${encodeURIComponent(slug)}/run-unsent`, { method:'POST', headers:{ accept:'application/json', 'content-type':'application/json' }, body:JSON.stringify({ step, agent:'penecho' }) });
      if (!HOSTED.held[mark]) { await loadState(HOSTED.key, { force:true }); refreshAfterChange(); }
    }
  } catch { /* Next time. */ }
  finally { hostedTrying = false; }
}
// Taking a held Ask back, or removing it, ends the wait.
function hostedLetGo(line, step) { if (HOSTED && HOSTED.held[`${line}/${step}`]) { delete HOSTED.held[`${line}/${step}`]; hostedKeepHeld(); } }

// ---------- A Canvas ----------
// A Canvas of the project opens as its picture: the Canvas page on penecho.ai does not open a project's Canvas yet.
function hostedCanvas(url) {
  const p = project();
  let source = ''; try { source = new URL(url, location.href).searchParams.get('linesCanvas') || ''; } catch { /* Not a Canvas address. */ }
  const c = p && source ? canvasByPath(p, source) : null;
  if (c?.hasPicture && fileEntry(p, c.path)) openLightbox(p, c.path); else toast('Open this Canvas in PenEcho on a computer.');
}

// ---------- The look ----------
if (HOSTED) {
  // The dashboard is light, so the page inside it is too, whatever was chosen for PenEcho on a computer.
  const light = () => { document.documentElement.dataset.mode = 'light'; };
  light();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', light);
  addEventListener('storage', light);
  // The dashboard's tab carries this page's title.
  document.addEventListener('DOMContentLoaded', () => { const title = document.querySelector('title'); if (title) new MutationObserver(hostedAddress).observe(title, { childList:true, characterData:true, subtree:true }); });
}

// ---------- Delete a project from PenEcho Cloud ----------
// Only here: on a computer a project is its folder. The name has to be typed before Delete is offered, and Cloud checks it too.
// Made on penecho.ai, everything of it goes for good. From a computer, only Cloud's copy goes: the computer keeps every file and
// stops syncing it at its next round.
function hostedDeleteRow(p) {
  if (!HOSTED || HOSTED.system || !p) return '';
  const words = HOSTED.onComputer ? 'Removes the copy in PenEcho Cloud and its share links. The project on your computer stays as it is and stops syncing.'
    : 'Removes its lines, files, Canvases and share links from PenEcho Cloud for good.';
  return `<section class="set-row set-danger" aria-label="Delete"><div class="set-text"><strong>${HOSTED.onComputer ? 'Delete from PenEcho Cloud' : 'Delete this project'}</strong><p>${words}</p></div><button type="button" class="btn sm danger" data-act="project-delete">Delete…</button></section>`;
}
ACT['project-delete'] = el => {
  if (!HOSTED || HOSTED.system) return;
  const p = project(); if (!p) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'line-command-dialog';
  dialog.setAttribute('aria-labelledby', 'projectDeleteTitle');
  const lose = HOSTED.onComputer ? 'Only the copy in PenEcho Cloud is deleted, with its share links. The project on your computer keeps every file and stops syncing.'
    : 'Its lines, files, Canvases and share links are deleted for good. This cannot be undone.';
  dialog.innerHTML = `<form><h2 id="projectDeleteTitle">Delete “${esc(p.name)}” from PenEcho Cloud?</h2><p>${esc(lose)}</p><label for="projectDeleteInput">Type <strong>${esc(p.name)}</strong> to confirm</label><input id="projectDeleteInput" name="confirm" autocomplete="off" spellcheck="false"><p class="command-error" role="alert" hidden></p><footer><button type="button" class="btn" data-cancel>Cancel</button><button type="submit" class="btn danger" disabled>Delete</button></footer></form>`;
  document.body.append(dialog);
  const input = $('input', dialog), submit = $('button[type="submit"]', dialog), matches = () => input.value.trim() === String(p.name).trim();
  dialog.addEventListener('close', () => { dialog.remove(); if (el?.isConnected) el.focus(); });
  $('[data-cancel]', dialog).onclick = () => dialog.close();
  input.addEventListener('input', () => { submit.disabled = !matches(); });
  $('form', dialog).onsubmit = async e => {
    e.preventDefault();
    if (!matches()) return;
    submit.disabled = true;
    try {
      const response = await hostedSaid(await hostedCall(HOSTED.base, { method:'DELETE', headers:{ accept:'application/json', 'content-type':'application/json' }, body:JSON.stringify({ confirm:input.value.trim() }) }));
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'The project could not be deleted.');
      dialog.close();
      hostedTell({ projects:true });
      hostedGo('/dashboard.html');
    } catch (error) { const message = $('.command-error', dialog); message.hidden = false; message.textContent = error.message; submit.disabled = !matches(); }
  };
  dialog.showModal();
  input.focus();
};

// ---------- Post-conversion handoff strip (?from=mcp) ----------
function hostedMcpHandoffDismissed() {
  if (!HOSTED?.fromMcp) return true;
  try { return sessionStorage.getItem(`penecho-mcp-handoff-dismissed:${HOSTED.key}`) === '1'; } catch { return false; }
}
function hostedMcpHandoffHTML(p) {
  if (!HOSTED?.fromMcp || HOSTED.shared || HOSTED.mcpHandoffKey !== HOSTED.key || !p || hostedMcpHandoffDismissed()) return '';
  const count = HOSTED.mcpCopied || (p.pictures || []).filter(item => item.canvas).length || 0;
  const sub = count > 0
    ? `${count} canvas snapshot${count === 1 ? '' : 's'} ready in Canvases & files.`
    : 'Your MCP canvas snapshots are ready in Canvases & files.';
  const backLink = HOSTED.mcpReturn
    ? `<a class="mcp-handoff-back" href="${esc(HOSTED.mcpReturn)}" target="_top">← Back to MCP Canvas <small>(reconnects MCP)</small></a>`
    : '';
  return `<section class="mcp-handoff-strip" aria-label="MCP canvases imported">
    <div class="mcp-handoff-head">
      <div>
        <strong>Your MCP canvases are now in ${esc(p.name)}</strong>
        <p>${esc(sub)}</p>
      </div>
      <div class="mcp-handoff-head-right">
        ${backLink}
        <button type="button" class="mcp-handoff-close" data-act="mcp-handoff-dismiss" aria-label="Dismiss welcome">×</button>
      </div>
    </div>
    <div class="mcp-handoff-steps">
      <div class="mcp-handoff-step">
        <b>1. Discuss on a Line</b>
        <span>Start a Line with your canvas attached and ask Hosted AI to refine, critique, or expand it.</span>
      </div>
      <div class="mcp-handoff-step">
        <b>2. Organize &amp; Share</b>
        <span>Group related work into Topics and share a clean read/comment link with teammates.</span>
      </div>
      <div class="mcp-handoff-step">
        <b>3. Need local folder sync &amp; Orchestrator?</b>
        <span><a href="https://penecho.ai/#desktop" target="_blank" rel="noopener">Get PenEcho Desktop ↗</a> for local folder projects and multi-agent runs (Cloud projects stay in Cloud).</span>
      </div>
    </div>
  </section>`;
}
ACT['mcp-handoff-dismiss'] = () => {
  if (!HOSTED) return;
  try { sessionStorage.setItem(`penecho-mcp-handoff-dismissed:${HOSTED.key}`, '1'); } catch {}
  document.querySelectorAll('.mcp-handoff-strip').forEach(node => node.remove());
};
