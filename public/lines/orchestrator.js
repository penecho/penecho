// The Orchestrator coordinates Works. Statistics shows the agent record and the prices used to choose agents.
const orchBoxKey = () => `orch-${boxKey(ORCH.project)}`;
const orchRequestId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
const ORCH = { project:'', data:null, stats:null, loading:false, last:0, timer:0, kind:'', recordSort:'works', recordOpen:new Set(), recordAll:false, ratingsAll:false, get draft() { return comp(orchBoxKey()); } };
const ORCH_AGENT = 'penecho-orchestrator-agent-v1', ORCH_EVERY = 3000;
const ORCH_PAGE_SIZE = 10;
const defaultOrchSessionView = { query:'', status:'', page:1 };
const orchSessionView = { ...defaultOrchSessionView };
const ORCH_KIND = { code:'Code', chat:'Chat', design:'Design', research:'Research', docs:'Docs' };
const orchKindKey = value => String(value || '').trim().toLowerCase();
const orchKind = value => {
  const k = orchKindKey(value);
  return k === 'fix' || k === 'test' ? 'code' : Object.hasOwn(ORCH_KIND, k) ? k : '';
};
const orchWorkKindLabel = value => {
  const kind = orchKind(value);
  return kind ? ORCH_KIND[kind] : '';
};
const ORCH_WORK = { done:'Finished', active:'Working', wait:'Needs you', todo:'Waiting its turn', off:'Stopped', error:'Error' };

// On penecho.ai these are the saved agents of the computers that sync the project (hosted.js hostedPresets).
const orchPresets = () => (S.presets?.presets || []).filter(x => x.available && x.showInPicker !== false);
function orchPreset() {
  const all = orchPresets();
  let kept = ''; try { kept = localStorage.getItem(ORCH_AGENT) || ''; } catch { /* Only a convenience. */ }
  return all.find(x => x.id === kept) || all.find(x => x.id === S.presets?.default) || all[0] || null;
}
const orchMoney = n => n == null ? '—' : n === 0 ? '$0' : n < 0.01 ? `$${n.toFixed(4)}` : n < 10 ? `$${n.toFixed(2)}` : `$${Math.round(n)}`;
const orchTokens = n => !n ? '—' : n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n);

function orchUseProject(p) {
  orchResume();
  if (ORCH.project === p.id) return;
  Object.assign(orchSessionView, defaultOrchSessionView);
  if (ORCH.timer) clearTimeout(ORCH.timer);
  Object.assign(ORCH, { project:p.id, data:null, stats:null, last:0, rev:null, loading:false, timer:0, error:'', kind:'', kinds:[],
    recordSort:'works', recordOpen:new Set(), recordAll:false, ratingsAll:false });
  ORCH.draft.project = p.id;
  delete ORCH.draft.flags.saveForLater;
}
const ORCH_GUIDE = 'penecho-orchestrator-guide-v2';
const ORCH_AGENTS_OPEN = 'penecho-orchestrator-agents-open-v1';
// The agents panel is shown on a first visit; hiding it is the person's choice, kept in this browser.
function orchAgentsShown() {
  try { return localStorage.getItem(ORCH_AGENTS_OPEN) !== 'closed'; } catch { return true; }
}
let orchGuideOpen;
function orchGuideVisible() {
  if (orchGuideOpen == null) { try { orchGuideOpen = localStorage.getItem(ORCH_GUIDE) !== 'dismissed'; } catch { orchGuideOpen = true; } }
  return orchGuideOpen;
}
// First visit: why hand a job to the Orchestrator, one small picture each, and starters that fill the box (PE-634, PE-639, PE-649).
const ORCH_STARTERS = [
  { text:'Make a short deck from the attached meeting notes that explains the decisions to the team.', make:'slides', label:'A deck from meeting notes' },
  { text:'Ask two agents for their view on this plan, compare their answers and recommend one.', label:'Two opinions, compared' },
  { text:'Find and fix the bug described below, add a test for it and report what changed.', label:'Fix a bug, with a test' },
];
// Each picture is drawn in the page's own colours: grey strokes, the accent for what the reason is about.
const ORCH_PIC = {
  split:'<rect x="4" y="16" width="18" height="16" rx="3" class="a"/><path d="M22 24h6M28 24c4 0 4-14 10-14M28 24h10M28 24c4 0 4 14 10 14"/><rect x="38" y="5" width="22" height="10" rx="2.5"/><rect x="38" y="19" width="22" height="10" rx="2.5"/><rect x="38" y="33" width="22" height="10" rx="2.5"/>',
  cost:'<rect x="4" y="6" width="26" height="9" rx="2.5" class="a"/><rect x="4" y="20" width="16" height="9" rx="2.5"/><rect x="4" y="34" width="10" height="9" rx="2.5"/><path d="M34 10.5h8M24 24.5h18M18 38.5h24" stroke-dasharray="2 3"/><circle cx="51" cy="10.5" r="6.5" class="a"/><circle cx="51" cy="24.5" r="5"/><circle cx="51" cy="38.5" r="3.5"/>',
  learn:'<path d="M4 44h56"/><rect x="9" y="28" width="9" height="16" rx="2"/><rect x="24" y="12" width="9" height="32" rx="2" class="a"/><rect x="39" y="22" width="9" height="22" rx="2"/><path d="M28.5 2.5l1.6 3.3 3.6.5-2.6 2.5.6 3.6-3.2-1.7-3.2 1.7.6-3.6-2.6-2.5 3.6-.5z" class="f"/>',
  watch:'<rect x="4" y="4" width="56" height="40" rx="5"/><path d="M11 15l3 3 5-6M11 27l3 3 5-6" class="a"/><circle cx="15" cy="37" r="3" class="dot"/><path d="M25 15h28M25 27h22M25 37h26"/>',
  lines:'<path d="M4 30h56"/><path d="M24 30c4 0 6-16 12-16h24" class="a"/><circle cx="12" cy="30" r="3.5" class="f"/><circle cx="24" cy="30" r="3.5" class="f"/><circle cx="44" cy="14" r="3.5" class="fa"/><circle cx="52" cy="30" r="3.5" class="f"/>',
  local:'<rect x="10" y="5" width="44" height="29" rx="3"/><path d="M4 40h56l-4 5H8z"/><circle cx="22" cy="19.5" r="4.5" class="a"/><circle cx="32" cy="19.5" r="4.5"/><circle cx="42" cy="19.5" r="4.5"/>',
};
const ORCH_WHY = [
  ['split', 'Splits big jobs', 'Breaks a large job into smaller ones when that helps, and runs them side by side.'],
  ['cost', 'The right agent for each part', 'Strong models on the hard parts, cheaper ones on the simple parts: the best result for what you spend.'],
  ['learn', 'Rates every finished job', 'Scores each agent’s work as it finishes, and uses those scores to choose agents for each kind of job.'],
  ['watch', 'Watches and checks', 'Follows every job, checks each result against your goal, and reports back once.'],
  ['lines', 'Nothing hidden', 'Every job is a Line you can open, steer or stop, with what it cost.'],
  ['local', 'Uses the agents you have', 'Works with the agents you already set up, on your own computer.'],
];
function orchGuideHTML() {
  return `<section id="orchGuide" class="orch-guide" aria-labelledby="orchGuideTitle" ${orchGuideVisible() ? '' : 'hidden'}>
    <h2 id="orchGuideTitle" tabindex="-1">Hand over the whole job. The Orchestrator puts the right agents on it and keeps watch.</h2>
    <ul class="orch-why">${ORCH_WHY.map(([pic, title, words]) => `<li><svg class="orch-why-pic" viewBox="0 0 64 48" aria-hidden="true">${ORCH_PIC[pic]}</svg><div><strong>${title}</strong><span>${words}</span></div></li>`).join('')}</ul>
    <button type="button" class="icon-btn orch-guide-x" data-act="orch-guide-dismiss" aria-label="Hide why to use it" title="Hide">${ic('x', 16)}</button></section>`;
}
function orchStartersHTML() {
  return `<div class="orch-starters" id="orchStarters" ${orchGuideVisible() ? '' : 'hidden'}>${ORCH_STARTERS.map((x, i) =>
    `<button type="button" class="orch-starter" data-act="orch-starter" data-i="${i}">${x.make ? ic('slides', 14) : ic('spark', 14)}${esc(x.label)}</button>`).join('')}</div>`;
}
function orchHowModelsLinkHTML() {
  return `<div class="orch-box-foot"><button type="button" class="orch-how-link" data-act="orch-how-models" aria-haspopup="dialog">${ic('hint', 14)}<span>How Orchestrator chooses models</span></button></div>`;
}
// Concise (<300 words) summary of the routing rules in src/server/project-lines/orchestrator.js (PE-660).
function orchHowModelsHTML() {
  return `<div class="orch-how-inner">
    <div class="orch-how-head">
      <h2 id="orchHowModelsTitle">How Orchestrator chooses models</h2>
      <button type="button" class="icon-btn orch-how-x" data-cancel aria-label="Close" title="Close">${ic('x', 16)}</button>
    </div>
    <div class="orch-how-body">
      <p>You or <strong>PenEcho Auto</strong> pick the coordinator. It does the job or hands parts to presets with <strong>Allow orchestrator assignments</strong>. Only presets in <strong>Settings → Agents</strong> are used: save a model at several efforts to find the best fit.</p>
      <h3>PenEcho Auto</h3>
      <ul>
        <li><strong>Kind of job:</strong> read from your words by keywords, with no model call: code, chat, design, research or docs.</li>
        <li><strong>First choice:</strong> the best rated for that kind, whatever it costs. A busy agent gives way to a free one within 10 points of 100.</li>
        <li><strong>Cheaper:</strong> if another is within 5 points and costs half or less, it starts instead.</li>
        <li><strong>Lower effort:</strong> otherwise, one time in three, the same model at your next lower saved effort, down to medium.</li>
        <li><strong>Skipped:</strong> at a usage limit, until it resets (3 hours if unknown, 5 at most); after an error, 3 hours. If all are, one still starts.</li>
      </ul>
      <h3>Sub-agents</h3>
      <ul>
        <li><strong>You first:</strong> the agents or views you ask for.</li>
        <li><strong>Under 5 minutes:</strong> the coordinator.</li>
        <li><strong>Plans:</strong> its own, or a higher-rated model's.</li>
        <li><strong>Doing:</strong> models within 5 points of it, or better, under half its cost: cheapest first, two parts each.</li>
        <li><strong>New models:</strong> with 5 jobs or fewer, now and then a part, until two poor ratings.</li>
        <li><strong>Fallback:</strong> the coordinator. A part stopped by a limit or error first goes to the next model once. Sub-agents start no others.</li>
      </ul>
      <h3>How agents are ranked (last 60 days)</h3>
      <ul>
        <li><strong>Record:</strong> by agent, model, effort and job kind (all kinds until 3 Works of that kind). Finish rate is not counted. Sub-agents: a model and effort is one across apps.</li>
        <li><strong>Quality:</strong> orchestrator scores (1–5) and your feedback (<strong>Good</strong> = 4.5, <strong>Not good</strong> = 2), where yours counts twice. Short records start cautiously.</li>
        <li><strong>Cost:</strong> of a usual Work here. Without a price, never picked as cheaper.</li>
      </ul>
    </div>
    <footer><button type="button" class="btn primary" data-cancel>Close</button></footer>
  </div>`;
}
function orchHowModelsOpen(el) {
  const existing = $('#orchHowModelsDialog');
  if (existing) { if (!existing.open) existing.showModal(); return; }
  const dialog = document.createElement('dialog');
  dialog.id = 'orchHowModelsDialog';
  dialog.className = 'line-command-dialog orch-how-dialog';
  dialog.setAttribute('aria-labelledby', 'orchHowModelsTitle');
  dialog.innerHTML = orchHowModelsHTML();
  document.body.append(dialog);
  dialog.addEventListener('click', e => {
    if (e.target === dialog || e.target.closest?.('[data-cancel]')) dialog.close();
  });
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (el?.isConnected) el.focus();
  }, { once:true });
  dialog.showModal();
  $('footer [data-cancel]', dialog)?.focus();
}
function orchestratorHTML(p) {
  orchUseProject(p);
  queueMicrotask(() => loadOrchestrator(p, true));
  ORCHSET.open = false;
  const agentsShown = !HOSTED && orchAgentsShown();
  const agentsToggle = HOSTED ? '' : `<button type="button" class="btn sm ghost-b orch-agents-toggle" data-act="orch-agents-toggle" aria-controls="orchAgentsPanel" aria-expanded="${agentsShown}" title="${agentsShown ? 'Hide the agents panel' : 'Show the agents panel'}">${ic('panel', 15)}<span>Agents</span></button>`;
  return `<div class="page orch-page${agentsShown ? '' : ' agents-hidden'}">
    <div class="orch-top"><h1>Orchestrator</h1><div class="orch-top-actions">${agentsToggle}<button type="button" class="btn sm ghost-b" data-act="orch-guide-show" aria-controls="orchGuide" ${orchGuideVisible() ? 'hidden' : ''}>Why use it</button>${!HOSTED && !p.myCanvases ? '<button type="button" class="btn sm ghost-b" data-act="go-view" data-view="stats" data-focus-id="statsRecord">Agent record &amp; prices</button>' : ''}</div></div>
    <div class="orch-layout">
      <div class="orch-main">
        <div class="orch-start">${orchGuideHTML()}
        <div class="orch-box-wrap"><div id="orchBox">${orchBoxHTML()}</div>${HOSTED ? '' : `<div class="orch-set-anchor"><div class="orch-set-panel" id="orchSetPanel" role="dialog" aria-label="Orchestrator settings" hidden></div></div><div class="orch-under"><div id="orchHint" aria-live="polite">${orchHintHTML()}</div>${orchHowModelsLinkHTML()}</div>`}</div>${HOSTED ? '' : orchStartersHTML()}</div>
        <div id="orchSessions">${orchSessionsHTML(p)}</div>
        <div id="orchTools">${orchToolsHTML()}</div>
      </div>
      ${HOSTED ? '' : `<aside class="orch-side" id="orchAgentsPanel" aria-labelledby="orchAgentsTitle"${agentsShown ? '' : ' hidden'}><div id="orchAgents">${orchAgentsHTML(p)}</div></aside>`}
    </div>
  </div>`;
}

// ---------- The box: the job, the agent that orchestrates ----------
// The tab keeps draft metadata in sessionStorage. Keep unsent file bytes locally too:
// a blob URL belongs to one document and cannot be reused after a trip to a Canvas.
let orchDraftDB, orchDraftSession;
const orchFileWrites = new Set();
function orchFileSession() {
  if (orchDraftSession !== undefined) return orchDraftSession;
  // A session cookie is shared by this browser's windows, including a tab
  // currently showing a Canvas. Protect every draft from that browser session.
  const name = 'penecho-draft-session', read = () => document.cookie?.split('; ').find(c => c.startsWith(name + '='))?.slice(name.length + 1);
  try {
    if (!read()) document.cookie = `${name}=${orchRequestId()}; Path=/projects.html; SameSite=Strict`;
    return orchDraftSession = read() || '';
  } catch { return orchDraftSession = ''; }
}
function openOrchDraftDB() {
  if (!orchDraftDB) orchDraftDB = new Promise((resolve, reject) => {
    const request = indexedDB.open('penecho-orchestrator-draft-files', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); orchDraftDB = null; };
      // A closed tab leaves no sessionStorage manifest. Reclaim old unclaimed
      // copies without reading their contents or expiring this tab's saved draft.
      const session = orchFileSession();
      if (session) {
        const kept = new Set([...Object.values(S.comp), ...orchStored()].flatMap(c => c.files.map(f => f.draftKey)));
        const files = db.transaction('files', 'readwrite').objectStore('files');
        const old = files.openKeyCursor(IDBKeyRange.upperBound(String(Date.now() - 30 * 86400000)));
        old.onsuccess = () => {
          const cursor = old.result;
          if (!cursor) return;
          if (!String(cursor.key).includes(`-${session}-`) && !kept.has(cursor.key)) files.delete(cursor.key);
          cursor.continue();
        };
      }
      resolve(db);
    };
  }).catch(error => { orchDraftDB = null; throw error; });
  return orchDraftDB;
}
async function orchDraftFile(mode, work) {
  const db = await openOrchDraftDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', mode), request = work(tx.objectStore('files'));
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error || new Error('Could not keep the draft attachment.'));
  });
}
function keepOrchFile(file) {
  const key = file.draftKey = `${Date.now()}-${orchFileSession()}-${orchRequestId()}`;
  const write = orchDraftFile('readwrite', store => store.put(file.blob, key)).catch(() => {
    if (file.draftKey !== key) return;
    delete file.draftKey;
    toast(`Keep this page open to send ${file.name}. Its draft copy could not be saved.`);
  }).finally(() => orchFileWrites.delete(write));
  orchFileWrites.add(write);
  return write;
}
function forgetOrchFile(file) {
  const key = file.draftKey;
  if (!key) return;
  delete file.draftKey;
  orchDraftFile('readwrite', store => store.delete(key)).catch(() => {});
}
async function restoreOrchFile(file) {
  const blob = await orchDraftFile('readonly', store => store.get(file.draftKey));
  if (!blob) throw new Error(`Reattach ${file.name} to send this job. Its draft copy is unavailable.`);
  file.blob = blob;
  if (file.type?.startsWith('image/')) file.url = URL.createObjectURL(blob);
}
const orchCantAdd = () => toast(HOSTED?.shared ? 'Only words can be added from a shared link.' : 'Add files in PenEcho on a computer.');
function orchBoxFile(f) {
  const isImage = Boolean(f.type?.startsWith('image/')), awaiting = isImage && typeof isPendingDrawingFile === 'function' && isPendingDrawingFile(orchBoxKey(), f);
  const picture = Boolean(f.url && isImage && !awaiting);
  const thumb = picture ? `<button type="button" class="orch-file-pic" data-act="orch-preview" data-file="${f.id}" aria-label="Preview ${esc(f.name)}" title="Preview ${esc(f.name)}"><img src="${esc(f.url)}" alt=""></button>`
    : isImage ? `<span class="orch-file-pic is-blank" aria-hidden="true"></span>`
    : `<span class="orch-file-ic">${ic(FILE_ICON(f.name), 18)}</span>`;
  const remove = `<button type="button" class="icon-btn tiny" data-act="orch-remove" data-file="${f.id}" aria-label="Remove ${esc(f.name)}">${ic('x', 14)}</button>`;
  const edit = can('canvas') && (f.source || ((picture || isImage) && DRAWABLE.test(f.type || ''))) ? `<button type="button" class="cmp-file-edit" data-act="cmp-edit-draw" data-file="${f.id}" aria-label="Draw on ${esc(f.name)}">${ic('pen', 13)}Click to draw on it</button>` : '';
  return `<div class="orch-file">${thumb}<div class="orch-file-text" title="${esc(f.name)}"><strong>${esc(f.label || f.name)}</strong>${edit || `<span>${fmtSize(f.size || 0)}</span>`}</div>${remove}</div>`;
}
const orchFilesHTML = () => ORCH.draft.files.map(orchBoxFile).join('');
// Only the chips are drawn again, so a file added while you type never moves the cursor.
function releaseOrchPreview(file) {
  if (!file?.url?.startsWith('blob:')) return;
  const box = $('#lightbox');
  if (box && !box.hidden && (box.querySelector('img')?.getAttribute('src') === file.url || (typeof LB !== 'undefined' && LB.list.some(item => item.url === file.url)))) {
    const released = () => URL.revokeObjectURL?.(file.url);
    box.addEventListener('penecho-lightbox-closed', released, { once:true });
  } else URL.revokeObjectURL?.(file.url);
}
function orchPaintFiles() {
  const row = $('#orchFiles'); if (!row) return;
  const html = orchFilesHTML();
  if (row.dataset.h !== html) row.innerHTML = row.dataset.h = html;
  if (typeof syncAttachmentImages === 'function') syncAttachmentImages(row);
  row.hidden = !ORCH.draft.files.length;
}
function orchAddFiles(list) {
  return addFiles(orchBoxKey(), list);
}
function orchAgentDetails(preset) {
  if (preset.id === ORCH_AUTO.id) return 'Model and effort chosen automatically';
  const model = preset.effectiveModel || preset.model || 'Runner default model';
  const level = preset.effectiveEffort || preset.effort;
  const effort = level ? `${level} effort${preset.effortUnsupported ? ' (not supported by this model)' : ''}` : 'Runner default effort';
  const accessNote = preset.pickerName && (preset.access === 'full' && preset.agent !== 'dsh' ? 'full access' : preset.access === 'folders' && preset.agent === 'dsh' ? 'project folders' : '');
  return [model, effort, accessNote].filter(Boolean).join(' · ');
}
function orchAgentLabel(preset) {
  return `${preset.pickerName || preset.name} · ${orchAgentDetails(preset)}`;
}
function orchAgentInnerHTML(chosen, label = orchAgentLabel(chosen)) {
  return `${chosen.id === ORCH_AUTO.id ? `<span class="orch-auto-av" aria-hidden="true">${ic('spark', 13)}</span>` : av(chosen.agent, 22)}<span class="orch-agent-name">${esc(label)}</span>${ic('down', 14)}`;
}
function orchPaintAgent() {
  const picker = $('#orchAgent'), chosen = orchChosen();
  if (!picker || !chosen) return false;
  const label = orchAgentLabel(chosen);
  picker.dataset.orchPreset = chosen.id;
  picker.setAttribute('aria-label', `Agent that orchestrates: ${label}`);
  picker.setAttribute('title', label);
  picker.innerHTML = orchAgentInnerHTML(chosen, label);
  const box = $('#orchBox'); if (box) delete box.dataset.h;
  const form = picker.closest?.('.composer'), bar = form && $('.cmp-bar', form);
  if (bar) { delete bar.dataset.fit; if (typeof fitBar === 'function') fitBar(form); }
  return true;
}
function orchRefreshBox() {
  const box = $('#orchBox'); if (!box) return;
  const hadGoal = Boolean($('#orchGoal', box));
  if (hadGoal && orchPresets().length && orchPaintAgent()) return;
  const active = document.activeElement;
  const idle = !active || active === document.body || active === document.documentElement || active === $('#view') || box.contains(active);
  orchPaint('orchBox', orchBoxHTML(), true);
  if (!hadGoal && idle && !S.underSettings && !S.shelfPage && !S.newPage &&
    !$('#sysModal') && !$('dialog[open]') && !$('#menu') && $('#switcher')?.hidden !== false && $('#lightbox')?.hidden !== false) {
    $('#orchGoal', box)?.focus({ preventScroll:true });
  }
}
function orchAgentMenu(anchor) {
  if (anchor.getAttribute('aria-expanded') === 'true') { closeMenu(); return; }
  const chosen = orchChosen();
  const presets = orchPresets().sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity:'base', numeric:true }) || left.name.localeCompare(right.name));
  if (orchSettings()) presets.unshift(ORCH_AUTO);
  const items = presets.map(preset => {
    const checked = preset.id === chosen?.id, auto = preset.id === ORCH_AUTO.id;
    return { label:orchAgentLabel(preset), checked, on:checked, ...(auto ? { icon:'spark' } : { av:preset.agent }), fn:() => {
      try { localStorage.setItem(ORCH_AGENT, preset.id); } catch { /* Only a convenience. */ }
      if (!orchPaintAgent()) orchPaint('orchBox', orchBoxHTML(), true);
      $('#orchAgent')?.focus({ preventScroll:true });
    } };
  });
  if (!HOSTED) items.push({ sep:true }, { label:'Manage agents…', icon:'gear', fn:() => ACT['open-agents']() });
  openMenu(anchor, items, { align:'right', className:'run-menu' });
}
function orchSubmit(saveForLater = false) {
  return orchStart(undefined, !HOSTED && Boolean(saveForLater));
}
ACT['orch-submit-pick'] = el => {
  if (el.getAttribute('aria-expanded') === 'true') { closeMenu(); return; }
  const modKey = typeof MOD_ENTER !== 'undefined' ? MOD_ENTER : (typeof MAC_KEYS !== 'undefined' && MAC_KEYS ? '⌘↵' : 'Ctrl ↵');
  openMenu(el, [
    { label:'Start', icon:'play', key:'↵', fn:() => orchSubmit(false) },
    { label:'Add for later', icon:'plus', key:modKey, fn:() => orchSubmit(true) },
  ], { align:'right' });
};
function orchBoxHTML() {
  const all = orchPresets(), chosen = orchChosen();
  if (!all.length) return `<div class="orch-box orch-none"><p>${HOSTED ? 'The orchestrator runs on your computer. Open PenEcho there to start a job from here.' : 'To choose an orchestrator, turn on “Show in agent pickers” for a preset that can run here.'}</p>${HOSTED ? '' : '<button type="button" class="btn sm" data-act="open-agents">Manage agents</button>'}</div>`;
  const label = orchAgentLabel(chosen);
  const key = orchBoxKey();
  const laterTitle = `Start (Enter) or Add for later (${typeof MAC_KEYS !== 'undefined' && MAC_KEYS ? 'Command' : 'Ctrl'}+Enter)`;
  return `<form class="orch-box composer" data-comp="${key}" data-on="orchestrator" data-preview="1" autocomplete="off">
    <div class="cmp-make" id="make-${key}" hidden></div>
    <div class="orch-files" id="orchFiles" ${ORCH.draft.files.length ? '' : 'hidden'}>${orchFilesHTML()}</div>
    <textarea class="cmp-input" id="orchGoal" rows="1" placeholder="What should get done or discussed?" aria-label="Job or question for the orchestrator">${esc(ORCH.draft.text)}</textarea>
    <div class="cmp-gives" id="gives-${key}" hidden></div>
    <input type="file" id="orchFilePick" class="orch-pick" multiple hidden aria-label="Add images or files">
    <div class="cmp-bar orch-bar">
      <span class="orch-gear-slot" id="orchGearSlot">${orchGearHTML()}</span>
      <button type="button" class="icon-btn cmp-plus" data-act="orch-attach" aria-haspopup="menu" aria-label="Add" title="Add">${ic('plus', 19)}</button>
      <div class="cmp-chips" id="chips-${key}" role="group" aria-label="What to make"></div>
      <div class="cmp-path"></div>
      <button type="button" id="orchAgent" class="orch-picker" data-act="orch-agent" data-orch-preset="${esc(chosen.id)}" aria-haspopup="menu" aria-expanded="false" aria-label="Agent that orchestrates: ${esc(label)}" title="${esc(label)}">${orchAgentInnerHTML(chosen, label)}</button>
      <span class="orch-submit"><button type="button" class="btn sm primary orch-go" data-act="orch-start" aria-label="Start" aria-keyshortcuts="Enter" title="Start (Enter)">${ic('play', 14)}<span>Start</span><kbd class="cmp-key" aria-hidden="true"><b>↵</b></kbd></button>${HOSTED ? '' : `<button type="button" class="btn sm primary orch-submit-pick" data-act="orch-submit-pick" aria-haspopup="menu" aria-expanded="false" aria-label="Start or add for later" title="${laterTitle}">${ic('down', 14)}</button>`}</span>
    </div>
    <div class="slash-menu" id="slash-${key}" hidden role="listbox" aria-label="Quick starts"></div>
  </form>`;
}
// Start takes the job out of the box at once and shows it at the top of the list; sending it goes on behind (below).
function orchStart(goal = ORCH.draft.text, save = false) {
  const p = project(), chosen = orchChosen(), draft = ORCH.draft, make = draft.flags.make;
  const words = String(goal || '').trim() || (make && draft.files.length ? `Create ${makeWords(make)} from the attached material.` : '');
  if (!p || !chosen) return;
  if (!words) { $('#orchGoal')?.focus(); return; }
  const job = { id:orchRequestId(), project:p.id, at:orchNextAt(), goal:words, preset:chosen.id, agent:chosen.agent || '', ...(chosen.computer ? { computer:chosen.computer } : {}),
    ...(make ? { make } : {}), save:Boolean(save), title:guessTitle(words, draft.files), files:[...draft.files], state:'sending' };
  // Kept before the box is emptied, and the box's own draft after: at no moment is the job in neither.
  job.stored = orchStore(job);
  ORCH_JOBS.push(job);
  takeBox(orchBoxKey());
  rememberBoxes();
  // A filter or a later page would hide the job just sent.
  Object.assign(orchSessionView, defaultOrchSessionView);
  const search = $('#orchSearch'); if (search) search.value = '';
  const sent = orchSend(job);
  orchPaintJobs(job);
  if (S.route.view === 'orchestrator') {
    const active = document.activeElement;
    if (!active || active === document.body || active === document.documentElement || $('#orchBox')?.contains(active)) $('#orchGoal')?.focus({ preventScroll:true });
  }
  return sent;
}

// ---------- Jobs on their way ----------
// A job is kept in this browser until PenEcho has it, so a reload, a closed window or a PenEcho that is restarting never loses it.
// Its id is the request id: sent again, it finds the Line it already made instead of making another.
const ORCH_OUTBOX = 'penecho-orchestrator-outbox-v1:';
// A job found unsent later than this waits for Retry instead of starting by itself.
const ORCH_RESEND_MS = 30 * 60000, ORCH_WAITS = [1000, 2000, 4000, 8000, 15000, 30000, 30000, 30000, 30000, 30000];
const ORCH_JOBS = [];
// Line → when its job was sent from this page: it keeps its place from then on, even before its first Work runs.
const orchFresh = new Map();
// Each job has a key of its own, so two windows never write over each other's.
function orchStored() {
  const list = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(ORCH_OUTBOX)) continue;
      try {
        const job = JSON.parse(localStorage.getItem(key));
        if (job?.id && job.project && Array.isArray(job.files)) list.push(job);
      } catch { /* Not one of these. */ }
    }
  } catch { /* A browser that keeps nothing. */ }
  return list.sort((a, b) => a.at - b.at);
}
const orchIsStored = job => orchStored().some(x => x.id === job.id);
function orchStore(job, keep = true) {
  try {
    if (!keep) { localStorage.removeItem(ORCH_OUTBOX + job.id); return false; }
    const { id, project:projectId, at, goal, preset, agent, computer, make, save, title, state, error } = job;
    localStorage.setItem(ORCH_OUTBOX + id, JSON.stringify({ id, project:projectId, at, goal, preset, agent, computer, make, save, title, state, error, files:job.files.map(({ blob, url, ...file }) => file) }));
  } catch { return false; }
  return orchIsStored(job);
}
// Later than every job shown, whatever the clocks of the computers they came from say.
const orchNextAt = () => Math.max(Date.now(), ...[...orchFresh.values(), ...ORCH_JOBS.map(j => j.at), ...(ORCH.data?.sessions || []).map(x => x.askedAt || 0)].map(at => at + 1));
const orchIsJob = (job, x) => Boolean((job.line && x.line === job.line) || (x.requestId && x.requestId === job.id));
function orchDropJob(job) {
  if (job.timer) { clearTimeout(job.timer); job.timer = 0; }
  const i = ORCH_JOBS.indexOf(job);
  if (i >= 0) ORCH_JOBS.splice(i, 1);
}
function orchPaintJobs(job) {
  if (S.route.view === 'orchestrator' && ORCH.project === job.project) orchPaintSessions();
}
async function orchReload(job) {
  const p = project();
  if (p?.id === job.project) await loadOrchestrator(p, true);
}
function orchSend(job) {
  if (job.run) return job.run;
  if (job.timer) { clearTimeout(job.timer); job.timer = 0; }
  Object.assign(job, { state:'sending', error:'' });
  // One window sends a job at a time.
  const alone = typeof navigator !== 'undefined' && navigator.locks?.request;
  return job.run = (alone ? navigator.locks.request(`penecho-orchestrator-${job.id}`, () => orchDeliver(job)) : orchDeliver(job)).finally(() => { job.run = null; });
}
const orchCutOff = () => Object.assign(new Error('PenEcho is not answering. Your job is safe. Trying again.'), { offline:true });
async function orchDeliver(job) {
  // Another window sent it, or it was discarded there.
  if (job.sentBefore && job.stored && !orchIsStored(job)) { orchDropJob(job); orchPaintJobs(job); await orchReload(job); return; }
  job.sentBefore = true;
  const p = { id:job.project };
  let r;
  try {
    const attachments = [];
    for (const file of job.files) {
      if (file.draftKey && !file.path && !file.blob) await restoreOrchFile(file);
      // The uploaded copy is kept with the job: sent again, it is the same request.
      if (!file.uploaded) {
        // A page being closed can cut an answer off after its first part: nothing was said about the file.
        const [saved] = await uploadFiles(p, [file]).catch(error => { throw error.name === 'TypeError' ? orchCutOff() : error; });
        file.uploaded = saved;
        if (job.stored) orchStore(job);
      }
      const { path, name, type } = file.uploaded;
      attachments.push({ path, name, type });
    }
    r = await api(`${pathFor(p.id)}/orchestrator${job.save ? '/save' : ''}`, { method:'POST', body:{ goal:job.goal, preset:job.preset, ...(job.computer ? { computer:job.computer } : {}), requestId:job.id, ...(job.make ? { make:job.make } : {}), ...(attachments.length ? { attachments } : {}) } });
    if (!r?.line) throw orchCutOff();
  } catch (error) { return orchNotSent(job, error); }
  orchArrived(job, r.line);
  orchPaintJobs(job);
  await orchReload(job);
  // PenEcho Auto says at once what it took the job to be and whom it started.
  const auto = r.auto?.agent ? ` · ${ORCH_KIND[r.auto.kind] ? `${ORCH_KIND[r.auto.kind]} job → ` : ''}${r.auto.agent}` : '';
  toast(job.save ? 'Task added for later' : HOSTED ? 'Sent to your computer' : `Orchestrator started${auto}`, { label:'Open', fn:() => switchProject(p.id, { route:{ view:'line', line:r.line } }) });
}
function orchArrived(job, line) {
  Object.assign(job, { line, state:'sent', sentAt:Date.now() });
  if (line) orchFresh.set(line, job.at);
  orchStore(job, false);
  for (const file of job.files) { releaseOrchPreview(file); forgetOrchFile(file); }
}
async function orchNotSent(job, error) {
  if (error.code === 'MISSING_UPLOAD') {
    const file = job.files.find(f => f.uploaded?.path === error.data?.current);
    if (file) {
      delete file.uploaded; if (file.blob) delete file.path;
      if (!file.again && (file.blob || file.draftKey)) { file.again = true; return orchDeliver(job); }
    }
  }
  // PenEcho restarting, or a network that comes and goes: tried again without asking.
  const passing = error.offline || error.status >= 500 || error.status === 408 || error.status === 429 || error.code === 'project_changed' || error.code === 'RUNTIME_BUSY';
  const wait = passing && typeof setTimeout === 'function' ? ORCH_WAITS[job.tries || 0] : 0;
  job.tries = (job.tries || 0) + 1;
  job.error = !HOSTED && error.status === 404 && !error.code ? 'Restart PenEcho to use the Orchestrator.' : error.message || 'This job was not sent.';
  if (wait) {
    job.state = 'waiting';
    job.timer = setTimeout(() => { job.timer = 0; orchSend(job); orchPaintJobs(job); }, wait);
    orchPaintJobs(job);
    return;
  }
  job.state = 'failed';
  if (job.stored) orchStore(job);
  orchPaintJobs(job);
  await orchReload(job);   // Its Line may be there already: the list shows that instead.
  if (ORCH_JOBS.includes(job) || error.code !== 'CONFLICT') toast(job.error, S.route.view === 'orchestrator' && project()?.id === job.project ? undefined : { label:'Open', fn:() => switchProject(job.project, { route:{ view:'orchestrator' } }) });
}
// The server's list holds a job by its Line or its request id: from then on the list shows it.
function orchSettle(projectId, sessions = []) {
  for (const job of ORCH_JOBS.filter(j => j.project === projectId)) {
    const x = sessions.find(session => orchIsJob(job, session));
    if (x) {
      orchFresh.set(x.line, job.at);
      if (job.state === 'sending' || job.state === 'waiting') continue;
      if (job.state === 'failed') orchArrived(job, x.line);
      orchDropJob(job);
    } else if (job.state === 'sent' && Date.now() - job.sentAt > 60000 && !lineById(project(projectId), job.line)) orchDropJob(job);
  }
}
// Jobs a closed page left behind.
function orchResume() {
  for (const saved of orchStored()) {
    if (ORCH_JOBS.some(j => j.id === saved.id) || (S.projects && !S.projects.some(p => p.id === saved.project))) continue;
    const job = { ...saved, stored:true, sentBefore:true };
    ORCH_JOBS.push(job);
    if (job.state !== 'failed' && Date.now() - job.at > ORCH_RESEND_MS) Object.assign(job, { state:'failed', error:'PenEcho closed before this job was sent.' });
    if (job.state !== 'failed') orchSend(job);
  }
}
// What another window did with a job both show.
if (typeof addEventListener === 'function') addEventListener('storage', e => {
  if (e.key && !e.key.startsWith(ORCH_OUTBOX)) return;
  const stored = new Map(orchStored().map(x => [x.id, x]));
  for (const job of ORCH_JOBS.filter(j => j.stored && !j.run && j.state !== 'sent')) {
    const x = stored.get(job.id);
    if (!x) orchDropJob(job);
    else if (x.state === 'failed' && !job.timer) Object.assign(job, { state:x.state, error:x.error });
    else continue;
    orchPaintJobs(job);
    if (!x) orchReload(job);
  }
});
const orchJobStep = job => (job.state === 'waiting' ? job.error : !job.save && job.files.some(f => !f.uploaded) ? 'Uploading files…' : job.save ? 'Adding…' : 'Starting…');
// What the list shows: the server's sessions, and the jobs it does not have yet.
function orchVisibleSessions(p) {
  const all = ORCH.data?.sessions, jobs = ORCH_JOBS.filter(j => j.project === p?.id);
  if (!all && !jobs.length) return undefined;
  const list = (all || []).filter(x => !x.archived).map(x => {
    const job = !x.running && jobs.find(j => !j.save && j.state !== 'failed' && orchIsJob(j, x));
    return job ? { ...x, running:true, canStop:false, progress:orchJobStep(job) } : x;
  });
  const waiting = jobs.filter(j => !(all || []).some(x => orchIsJob(j, x)));
  return [...waiting.map(job => ({ line:job.line || '', ref:'', title:job.title, status:'', agent:job.agent, askedAt:job.at, running:!job.save && job.state !== 'failed', lines:[], job })), ...list];
}
const orchJobState = job => (job.state === 'failed' ? 'error' : job.save ? 'backlog' : 'working');
function orchJobCard(job) {
  const failed = job.state === 'failed', act = (name, label, icon, cls = '') => `<button type="button" class="btn sm${cls}" data-act="orch-job-${name}" data-job="${esc(job.id)}" aria-label="${label} ${esc(job.title)}">${icon ? ic(icon, 14) : ''}${label}</button>`;
  return `<section class="orch-run${failed || job.save ? '' : ' running'}">
    <header><div class="orch-identity">${job.preset === ORCH_AUTO.id ? `<span class="orch-auto-av" aria-hidden="true">${ic('spark', 13)}</span>` : av(job.agent || 'agent', 22)}${job.line ? `<button type="button" class="orch-title" data-act="open-line" data-line="${esc(job.line)}" title="${esc(job.title)}"><span>${esc(job.title)}</span></button>` : `<span class="orch-title" title="${esc(job.title)}"><span>${esc(job.title)}</span></span>`}</div>
      <div class="orch-run-actions">${failed ? `<span class="fl-state s-error">Not sent</span>${act('discard', 'Discard')}${act('edit', 'Edit', 'pen')}${act('retry', 'Retry', 'retry', ' primary')}` : `<i class="spin" aria-hidden="true"></i>${job.save || job.state === 'waiting' ? '' : `<span class="fl-state s-working">${esc(STATE_TEXT.working || 'Working')}</span>`}`}</div></header>
    ${failed ? `<p class="orch-reason">${esc(job.error || 'This job was not sent.')}</p>` : job.state === 'sent' ? '' : `<div class="orch-activity"><span>${esc(orchJobStep(job))}</span></div>`}
  </section>`;
}
const orchFailedJob = el => ORCH_JOBS.find(j => j.id === el.dataset.job && j.state === 'failed');
ACT['orch-job-retry'] = el => {
  const job = orchFailedJob(el);
  if (!job) return;
  job.tries = 0;
  for (const file of job.files) delete file.again;
  const sent = orchSend(job);
  if (job.stored) orchStore(job);
  orchPaintJobs(job);
  return sent;
};
// Back in the box, with its files and what it makes, to change it or pick another agent.
ACT['orch-job-edit'] = el => {
  const job = orchFailedJob(el), draft = ORCH.draft;
  if (!job) return;
  if (draft.text.trim() || draft.files.length) { toast('Send or clear what is in the box first.'); return; }
  orchDropJob(job);
  draft.text = job.goal; draft.files = job.files;
  if (job.make) draft.flags.make = job.make;
  rememberBoxes();
  orchStore(job, false);
  for (const file of job.files) if (file.draftKey && !file.path && !file.blob) restoreOrchFile(file).then(orchPaintFiles, () => {});
  orchPaint('orchBox', orchBoxHTML(), true);
  orchPaintJobs(job);
  $('#orchGoal')?.focus();
};
ACT['orch-job-discard'] = el => {
  const job = orchFailedJob(el);
  if (!job) return;
  orchDropJob(job);
  orchStore(job, false);
  orchPaintJobs(job);
  toast('Job discarded', { label:'Undo', fn:() => { ORCH_JOBS.push(job); if (job.stored) orchStore(job); orchPaintJobs(job); } });
};

// ---------- Settings beside the box: the reviewer, and prices and ratings from penecho.ai ----------
// An older server has no settings route: then the gear, the hints, PenEcho Auto and the sync line are simply not drawn.
const ORCHSET = { project:'', data:null, loading:null, missing:false, open:false, openAfterLoad:false, syncing:'', from:'', said:'', error:'' };
const ORCH_AUTO = { id:'auto', name:'PenEcho Auto', auto:true };
const orchSettings = (p = typeof project === 'function' ? project() : null) => (p && !HOSTED && ORCHSET.project === p.id ? ORCHSET.data : null);
async function loadOrchSettings(p = project(), force = false) {
  if (!p || HOSTED) return null;
  if (ORCHSET.project !== p.id) Object.assign(ORCHSET, { project:p.id, data:null, loading:null, missing:false, open:false, syncing:'', from:'', said:'', error:'' });
  if (ORCHSET.loading) return ORCHSET.loading;
  if (ORCHSET.missing || (!force && ORCHSET.data)) return ORCHSET.data;
  const run = ORCHSET.loading = api(`${pathFor(p.id)}/orchestrator/settings`)
    .then(data => { if (ORCHSET.project === p.id) { ORCHSET.data = data && typeof data === 'object' ? data : null; ORCHSET.missing = !ORCHSET.data; } })
    .catch(error => { if (ORCHSET.project === p.id && error?.status === 404) ORCHSET.missing = true; })
    .finally(() => { if (ORCHSET.loading === run) ORCHSET.loading = null; });
  await run;
  if (ORCHSET.project === p.id) orchPaintSettings();
  return orchSettings(p);
}
// PenEcho Auto is one more entry in the agent list, never the first choice: only when you picked it last time.
function orchChosen() {
  let kept = ''; try { kept = localStorage.getItem(ORCH_AGENT) || ''; } catch { /* Only a convenience. */ }
  return kept === ORCH_AUTO.id && orchSettings() ? ORCH_AUTO : orchPreset();
}
function orchGearHTML() {
  const set = orchSettings();
  if (!set) return '';
  const fresh = set.seen === false;
  return `<button type="button" class="icon-btn orch-gear" data-act="orch-settings" aria-haspopup="dialog" aria-controls="orchSetPanel" aria-expanded="${ORCHSET.open}" aria-label="Orchestrator settings" title="Settings">${ic('gear', 18)}${fresh ? '<i class="orch-gear-dot" aria-hidden="true"></i>' : ''}</button>`;
}
const orchSyncDay = at => { const d = new Date(at); return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-US', { month:'short', day:'numeric' }) : ''; };
const orchPlural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
// What one sync brought, in one line: "18 prices and 16 agent ratings added".
function orchSyncSaid(r) {
  const prices = Number.isFinite(r?.addedPrices) ? r.addedPrices : Number(r?.sync?.prices) || 0, ratings = Number(r?.sync?.ratings) || 0;
  const parts = [prices > 0 && orchPlural(prices, 'price'), ratings > 0 && orchPlural(ratings, 'agent rating')].filter(Boolean);
  return parts.length ? `${parts.join(' and ')} added` : 'Prices and ratings are up to date';
}
const orchSyncButton = (label, cls = 'btn sm') => `<button type="button" class="${cls}" data-act="orch-sync" ${ORCHSET.syncing ? 'disabled' : ''}>${label}</button>`;
// The third row of the panel: when it last synced, and Sync.
function orchSyncStateHTML() {
  const set = orchSettings();
  if (!set) return '';
  if (ORCHSET.syncing === 'panel') return '<span class="orch-set-state"><i class="spin" aria-hidden="true"></i>Syncing…</span>';
  const said = ORCHSET.error && ORCHSET.syncing === '' && ORCHSET.from === 'panel' ? `<span class="orch-set-state is-error" role="alert">${esc(ORCHSET.error)}</span>`
    : `<span class="orch-set-state">${set.sync?.at ? `Synced ${esc(orchSyncDay(set.sync.at))}` : 'Not synced'}</span>`;
  return `${said}${orchSyncButton(set.sync?.at ? 'Sync again' : 'Sync')}`;
}
function orchSetPanelHTML() {
  const set = orchSettings();
  if (!set) return '';
  const reviewers = Array.isArray(set.reviewers) ? set.reviewers.filter(r => r && r.id) : [];
  const presets = Array.isArray(S?.presets?.presets) ? S.presets.presets : [];
  const reviewerOptionLabel = r => {
    const base = String(r.name || r.id || '').trim();
    const preset = presets.find(x => x && x.id === r.id);
    const model = String(r.model || preset?.model || preset?.effectiveModel || '').trim();
    const effort = String(r.effort || preset?.effort || preset?.effectiveEffort || '').trim();
    const low = base.toLowerCase();
    const escRe = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const extras = [
      model && !low.includes(model.toLowerCase()) ? model : '',
      effort && !new RegExp(`(?:^|[·\\s(])${escRe(effort)}\\s+effort(?:$|[·\\s)])`, 'i').test(base) ? `${effort} effort` : '',
    ].filter(Boolean);
    return extras.length ? [base, ...extras].join(' · ') : base;
  };
  // Each row says what it does, in one line under its name.
  const row = (name, what, control, forId = '') => `<div class="orch-set-row"><div class="orch-set-what">${forId ? `<label for="${forId}">${name}</label>` : `<span>${name}</span>`}<small>${what}</small></div>${control}</div>`;
  return `${row('Review first jobs', 'When an Orchestrator Line’s first job finishes, another agent checks it against your Ask and rates it out of 5.', `<input type="checkbox" role="switch" class="orch-switch" id="orchSetReview" ${set.review ? 'checked' : ''}>`, 'orchSetReview')}
    ${row('Reviewer', 'Who checks. Auto picks your best-rated coding agent that did not do the job.', `<select id="orchSetReviewer" class="orch-set-select"><option value="auto">Auto</option>${reviewers.map(r => `<option value="${esc(r.id)}" ${r.id === set.reviewer ? 'selected' : ''}>${esc(reviewerOptionLabel(r))}</option>`).join('')}</select>`, 'orchSetReviewer')}
    ${row('Prices and ratings', 'Model prices and starting ratings from penecho.ai. Your own ratings stay, and count more with every job.', `<span class="orch-set-sync" id="orchSetSync">${orchSyncStateHTML()}</span>`)}`;
}
// Under the box, at most one quiet line, never in the way of Start: no agent first, then no prices, then the first-use line.
function orchHintHTML() {
  const set = orchSettings();
  if (!set) return '';
  const line = (inner, extra = '') => `<p class="orch-hint${extra}">${inner}</p>`;
  if (ORCHSET.syncing === 'hint') return line('<i class="spin" aria-hidden="true"></i>Getting prices and ratings…');
  if (ORCHSET.from === 'hint' && ORCHSET.error) return line(`<span>${esc(ORCHSET.error)}</span> ${orchSyncButton('Get prices and ratings', 'link orch-hint-link')}`, ' is-error');
  if (ORCHSET.from === 'hint' && ORCHSET.said) return line(esc(ORCHSET.said));
  if (set.agents === 0) return line('<button type="button" class="link orch-hint-link" data-act="open-agents">Add an agent</button> so the Orchestrator has someone to hand work to');
  if (set.costsKnown === false && set.sync == null) return line(`The Orchestrator can’t compare costs yet. ${orchSyncButton('Get prices and ratings', 'link orch-hint-link')}`);
  if (set.seen === false) return line('Reviews are on. <button type="button" class="link orch-hint-link" data-act="orch-settings">Change in settings.</button>');
  return '';
}
function orchPaintSettings() {
  orchPaint('orchGearSlot', orchGearHTML);
  orchPaint('orchHint', orchHintHTML);
  orchPaint('orchSetSync', orchSyncStateHTML);
  const gear = $('#orchGearSlot [data-act="orch-settings"]'); if (gear) gear.setAttribute('aria-expanded', String(ORCHSET.open));
  if (orchSettings() && $('#orchAgent[data-orch-preset]:not([data-orch-preset="auto"])') && orchChosen()?.id === ORCH_AUTO.id) {
    if (typeof orchPaintAgent === 'function') orchPaintAgent();
    else orchPaint('orchBox', orchBoxHTML(), true);
  }
  // Opened from a Work panel's "Orchestrator settings…" menu item: pop the settings panel once the Orchestrator view is ready.
  if (ORCHSET.openAfterLoad && orchSettings() && $('#orchSetPanel') && !ORCHSET.open) {
    ORCHSET.openAfterLoad = false;
    ACT['orch-settings']();
  }
  if (S.route.view === 'line' && typeof refreshLine === 'function') refreshLine();
}
async function orchSaveSettings(body, quiet = false) {
  const p = project(), set = orchSettings(p);
  if (!set) return;
  Object.assign(set, body);
  try {
    const r = await api(`${pathFor(p.id)}/orchestrator/settings`, { method:'POST', body });
    if (ORCHSET.project === p.id && r && typeof r === 'object') ORCHSET.data = r;
  } catch (error) {
    if (!quiet) toast(error.message);
    if (ORCHSET.project === p.id) await loadOrchSettings(p, true);
    return;
  }
  orchPaintSettings();
}
async function orchSync(from) {
  const p = project();
  if (!p || ORCHSET.syncing || !orchSettings(p)) return;
  Object.assign(ORCHSET, { syncing:from, from, said:'', error:'' });
  orchPaintSettings();
  try {
    const r = await api(`${pathFor(p.id)}/orchestrator/sync`, { method:'POST', body:{} });
    if (ORCHSET.project !== p.id) return;
    ORCHSET.data = r?.settings && typeof r.settings === 'object' ? r.settings : { ...ORCHSET.data, sync:r?.sync || ORCHSET.data.sync };
    ORCHSET.said = orchSyncSaid(r);
    // The new prices show at once where they are listed.
    if (typeof loadPrices === 'function') loadPrices(true);
  } catch (error) {
    if (ORCHSET.project === p.id) ORCHSET.error = error.message || 'Could not sync.';
  } finally {
    if (ORCHSET.project === p.id) { ORCHSET.syncing = ''; orchPaintSettings(); }
  }
}
function orchCloseSettings(focusGear = false) {
  const panel = $('#orchSetPanel');
  ORCHSET.open = false;
  if (panel) panel.hidden = true;
  const gear = $('#orchGearSlot [data-act="orch-settings"]');
  if (gear) { gear.setAttribute('aria-expanded', 'false'); if (focusGear) gear.focus(); }
}
ACT['orch-settings'] = () => {
  const panel = $('#orchSetPanel'), set = orchSettings();
  if (!panel || !set) return;
  if (ORCHSET.open) { orchCloseSettings(true); return; }
  ORCHSET.open = true;
  if (ORCHSET.from === 'panel') Object.assign(ORCHSET, { from:'', said:'', error:'' });
  panel.innerHTML = panel.dataset.h = orchSetPanelHTML();
  panel.hidden = false;
  // Opening it once is enough: the dot and the first-use line go.
  if (set.seen === false) { set.seen = true; orchSaveSettings({ seen:true }, true); }
  orchPaintSettings();
  $('#orchSetReview', panel)?.focus();
};
ACT['orch-sync'] = el => orchSync(el.closest('#orchSetPanel') ? 'panel' : 'hint');
document.addEventListener('change', e => {
  if (e.target.id === 'orchSetReview') orchSaveSettings({ review:e.target.checked });
  if (e.target.id === 'orchSetReviewer') orchSaveSettings({ reviewer:e.target.value || 'auto' });
});
document.addEventListener('pointerdown', e => {
  if (ORCHSET.open && !e.target.closest?.('#orchSetPanel, [data-act="orch-settings"]')) orchCloseSettings();
});
document.addEventListener('keydown', e => {
  if (ORCHSET.open && e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); orchCloseSettings(true); }
});
// The Sessions list shows the reviewer's verdict/score quietly beside the state.
function orchReviewScoreHTML(x) {
  const words = typeof reviewScoreWords === 'function' ? reviewScoreWords(x.reviewScore, x.reviewVerdict) : '';
  return words ? `<span class="orch-review-score" title="Review">${esc(words)}</span>` : '';
}

// ---------- What each orchestrator started ----------
function orchIsUnsent(x, l) {
  if (!x || x.running || x.archived || x.status === 'closed' || l?.archived || l?.closed) return false;
  if (x.unsent || x.unsentStep) return true;
  return Boolean(l && !l.stations?.some(s => LINE_STATUS.isWork(s)) && l.stations?.some(s => s.kind === 'ask' && s.unsent));
}
function orchStateKey(x, l) {
  if (x.archived || x.status === 'closed' || l?.archived || l?.closed) return 'archived';
  if (orchIsUnsent(x, l)) return 'backlog';
  if (x.questions?.length || x.status === 'waiting') return 'wait';
  if (x.running) return 'working';
  if (l) return shownState(l);
  if (x.status === 'done') return 'ready';
  if (typeof LINE_STATUS !== 'undefined') return LINE_STATUS.lineState(x);
  const fallback = { stopped:'error', paused:'error', 'not-started':'backlog' };
  return fallback[x.status] || x.status || '';
}
function orchLineState(p, x, key = orchStateKey(x, lineById(p, x.line))) {
  if (x.running && key !== 'archived') {
    const saved = { stopped:'Stopped', done:'Finished', ready:'Finished', landed:'Finished' }[x.status];
    if (saved) return `<span class="fl-state s-error">${saved} · Work still running</span>`;
  }
  const l = lineById(p, x.line);
  const word = key === 'archived' ? 'Archived' : orchIsUnsent(x, l) ? 'Not sent' : key === 'reviewed' || (['ready', 'landed'].includes(key) && l && LINE_STATUS.lineReviewed(l)) ? 'Reviewed'
    : key === 'landed' ? 'Finished' : STATE_TEXT[key];
  return word ? `<span class="fl-state s-${esc(key)}">${esc(word)}</span>` : '';
}
function orchScore(value) {
  const n = Number(value);
  return value != null && value !== '' && n >= 1 && n <= 5 ? Math.round(n * 10) / 10 : null;
}

function orchRatingHTML(r, line, context) {
  const runner = r.runner || r.agent || 'agent', name = r.savedAgent || (r.runner ? r.agent : agentInfo(runner).name);
  return `<button type="button" class="orch-rating" data-act="open-step" data-line="${esc(line)}" data-step="${esc(r.work)}">
    ${av(runner, 18)}<span class="orch-rating-who">${esc(name)}</span><span class="orch-score" aria-label="Orchestrator score ${orchScore(r.score)} out of 5">${orchScore(r.score)}/5</span>
    ${context ? `<span class="orch-rating-context">${esc(context)}</span>` : ''}${r.note ? `<span class="orch-rating-note">${esc(r.note)}</span>` : ''}</button>`;
}
function orchWorkUnrecoveredError(w) {
  return w.reviewed !== true && w.off !== 'discarded' && w.off !== 'ended' && (w.state === 'error' || (w.state === 'off' && (w.stopWhy === 'error' || w.stopWhy === 'limit')));
}
function orchLineSettled(x, l, state) {
  return Boolean(state === 'reviewed' || state === 'archived' || x.archived || x.status === 'closed' || (l && (l.archived || l.closed || LINE_STATUS.lineReviewed(l))));
}
function orchChildError(x, l) {
  if (x.running || orchLineSettled(x, l)) return '';
  if (x.status === 'stopped') return 'stopped';
  return (x.works || []).some(orchWorkUnrecoveredError) ? 'error' : '';
}
function orchWorkHTML(line, w) {
  const agent = agentInfo(w.agent), score = orchKindKey(w.kind) === 'review' ? null : orchScore(w.score);
  const discarded = w.off === 'discarded';
  const errored = !discarded && (w.state === 'error' || (w.state === 'off' && (w.stopWhy === 'error' || w.stopWhy === 'limit')));
  const cls = errored ? 'error' : w.state;
  const state = discarded ? 'Discarded' : errored ? (w.stopWhy === 'limit' ? 'Limit' : 'Error') : (ORCH_WORK[w.state] || w.state);
  const kind = orchWorkKindLabel(w.kind);
  const title = [w.label || w.work, kind, agent.name, state, w.reviewed && 'Reviewed', score && `Score: ${score}/5`, score && w.note].filter(Boolean).join(' · ');
  return `<button type="button" class="orch-work w-${esc(cls)}${w.reviewed ? ' reviewed' : ''}" style="--a:${esc(agent.color)}" data-act="open-step" data-line="${esc(line)}" data-step="${esc(w.work)}" title="${esc(title)}" aria-label="${esc(title)}"><span class="orch-mono">${esc(agent.mono)}</span>${kind ? `<span class="orch-wkind">${esc(kind)}</span>` : ''}<span>${esc(state)}</span>${score ? `<b class="orch-wscore">${score}/5</b>` : ''}</button>`;
}
// Pages can refresh before the server that owns a long-running Work restarts.
function orchSessionLine(p, x) {
  if (x.canStop != null) return x;
  const l = lineById(p, x.line);
  if (!l) return x;
  const reviewing = typeof LINE_STATUS !== 'undefined' && Boolean(LINE_STATUS.lineReviewing?.(l));
  const station = l.stations?.find(s => s.state === 'active' || s.state === 'error' || s.state === 'wait');
  return { ...x, ...(reviewing ? { reviewing:true } : {}), canStop:Boolean((l.running && !l.elsewhere) || reviewing), lastActivityAt:l.lastActivityAt,
    progress:x.running && station?.now !== 'Working' ? station?.now : '', why:x.why || station?.why };
}
function orchActivityHTML(x) {
  const waiting = (x.waitingOn || []).map(l =>
    `<button type="button" class="orch-dependency" data-act="open-line" data-line="${esc(l.line)}">${esc(l.label)}</button>`).join(', ');
  const message = waiting ? `Waiting for ${waiting}` : esc(x.progress || '');
  const at = Number(x.lastActivityAt), time = at > 0 ? new Date(at) : null;
  const stamp = time && Number.isFinite(time.getTime())
    ? `<time datetime="${time.toISOString()}">Last activity ${esc(time.toLocaleString(undefined, { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }))}</time>` : '';
  return message || stamp ? `<div class="orch-activity">${message ? `<span>${message}</span>` : ''}${stamp}</div>` : '';
}
function orchStopHTML(x) {
  return (x.running || x.reviewing) && x.canStop ? `<button type="button" class="btn sm orch-stop" data-act="line-do" data-verb="stop" data-line="${esc(x.line)}" aria-label="Stop ${esc(x.title)}">${ic('stop', 14)}Stop</button>` : '';
}
// The reason a stopped session gives says Retry, so Retry is on its card.
function orchStartOrRetryHTML(x, state) {
  if (!HOSTED && !x.running && (x.unsentStep || x.status === 'not-started')) {
    if (x.unsentStep) {
      return `<button type="button" class="btn sm primary" data-act="orch-start-saved" data-line="${esc(x.line)}" data-step="${esc(x.unsentStep)}" data-preset="${esc(x.unsentPreset || '')}" aria-label="Start ${esc(x.title)}">${ic('play', 14)}Start</button>`;
    }
    return `<button type="button" class="btn sm primary" data-act="line-do" data-verb="start" data-line="${esc(x.line)}" aria-label="Start ${esc(x.title)}">${ic('play', 14)}Start</button>`;
  }
  return !x.running && state === 'error' && x.status === 'stopped' ? `<button type="button" class="btn sm primary orch-stop" data-act="line-do" data-verb="retry" data-line="${esc(x.line)}" aria-label="Retry ${esc(x.title)}">${ic('retry', 14)}Retry</button>` : '';
}
ACT['orch-start-saved'] = async el => {
  const p = project(), slug = el.dataset.line, step = el.dataset.step, preset = el.dataset.preset || '';
  if (!p || !slug || !step) return;
  el.disabled = true;
  try {
    const chosen = preset && preset !== ORCH_AUTO.id ? orchPresets().find(x => x.id === preset) || S.presets?.presets?.find(x => x.id === preset) : null;
    const body = { step, ...(preset ? { preset } : {}), ...(chosen?.agent ? { agent:chosen.agent } : {}) };
    const r = await api(`${pathFor(p.id)}/topics/${encodeURIComponent(slug)}/run-unsent`, { method:'POST', body });
    const auto = r?.auto?.agent ? ` · ${ORCH_KIND[r.auto.kind] ? `${ORCH_KIND[r.auto.kind]} job → ` : ''}${r.auto.agent}` : '';
    const title = el.closest?.('.orch-run')?.querySelector?.('.orch-title span')?.textContent || slug;
    toast(auto ? `Orchestrator started${auto}` : `Started ${title}`);
    if (typeof loadState === 'function') await loadState(p.id, { force:true }).catch(() => {});
    await loadOrchestrator(p, true);
    if (typeof refreshAfterChange === 'function') refreshAfterChange();
  } catch (error) {
    el.disabled = false;
    toast(error.message);
  }
};
function orchChildHTML(p, l) {
  const rated = l.works.filter(w => orchKindKey(w.kind) !== 'review' && orchScore(w.score));
  const label = w => [orchWorkKindLabel(w.kind), w.label || w.work.replace(/^work-(\d+)$/, 'Work $1')].filter(Boolean).join(' · ');
  return `<div class="orch-child"><div class="orch-line">
    <button type="button" class="orch-line-t" data-act="open-line" data-line="${esc(l.line)}" title="${esc(l.title)}">${l.ref ? `<code>${esc(l.ref)}</code>` : ''}<span>${esc(l.title)}</span></button>
    ${orchLineState(p, l)}${orchStopHTML(l)}<span class="orch-works">${l.works.map(w => orchWorkHTML(l.line, w)).join('')}</span></div>
    ${l.running ? orchActivityHTML(l) : ''}
    ${l.why ? `<p class="orch-reason">${esc(l.why)}</p>` : ''}
    ${rated.length ? `<div class="orch-ratings" role="group" aria-label="Orchestrator ratings"><span class="orch-rating-label">Orchestrator ratings</span>${rated.map(w => orchRatingHTML(w, l.line, label(w))).join('')}</div>` : ''}</div>`;
}
// The route its coordinator recorded with decide (PE-660), so a job kept to itself says why. A handoff reads as done only once a delegated Line exists.
function orchRouteHTML(x) {
  const label = typeof orchRouteLabel === 'function'
    ? orchRouteLabel(x.route, Boolean(x.lines?.length))
    : ({ self:['Worked alone', 'Worked alone'], delegate:['Delegation planned', 'Delegated'], split:['Split planned', 'Split'] }[x.route]?.[x.lines?.length ? 1 : 0] || '');
  if (!label) return '';
  return `<p class="orch-route"${x.routeParts ? ` title="${esc(x.routeParts)}"` : ''}><b>${esc(label)}</b>${x.routeWhy ? ` · ${esc(x.routeWhy)}` : ''}</p>`;
}
// What PenEcho Auto took the job to be, the words that said so, and why it started this agent (PE-1085).
function orchAutoHTML(x) {
  const a = x.auto;
  if (!a) return '';
  const kind = ORCH_KIND[a.kind] ? `${ORCH_KIND[a.kind]} job` : 'Kind of job not clear';
  return `<p class="orch-auto"><b>PenEcho Auto</b> · ${esc(kind)}${a.from ? ` (${esc(a.from)})` : ''}${a.why ? ` → ${esc(a.why)}` : ''}</p>`;
}
// What the job and its parts made, ready to open from its card (PE-1190).
function orchMadeHTML(p, x) {
  const items = x.made?.length && typeof madeItems === 'function' ? madeItems(p, x.made) : [];
  return items.length ? madeChips(p, items, `orch:${x.line}`) : '';
}
function orchSessionCard(p, session, state) {
  const x = orchSessionLine(p, session);
  const lines = x.lines.filter(l => !l.archived).map(l => orchSessionLine(p, l));
  const settled = orchLineSettled(x, lineById(p, x.line), state);
  const showErrors = !settled && !x.running && state !== 'error';
  const childErrors = showErrors ? lines.map(l => orchChildError(l, lineById(p, l.line))) : [];
  const stoppedLines = childErrors.filter(kind => kind === 'stopped').length;
  const erroredLines = childErrors.filter(kind => kind === 'error').length;
  const childErrorBadge = stoppedLines ? `<span class="fl-state s-error">${stoppedLines} ${stoppedLines === 1 ? 'Line' : 'Lines'} stopped</span>`
    : erroredLines ? `<span class="fl-state s-error">${erroredLines} ${erroredLines === 1 ? 'Line' : 'Lines'} with errors</span>`
    : (showErrors && x.stoppedWork ? '<span class="fl-state s-error">Work stopped</span>' : '');
  return `<section class="orch-run${state === 'wait' ? ' waiting' : x.running ? ' running' : ''}">
    <header><div class="orch-identity">${x.unsent && x.unsentPreset === ORCH_AUTO.id ? `<span class="orch-auto-av" aria-hidden="true">${ic('spark', 13)}</span>` : av(x.agent || 'agent', 22)}<button type="button" class="orch-title" data-act="open-line" data-line="${esc(x.line)}" title="${esc(x.title)}">${x.ref ? `<code>${esc(x.ref)}</code> ` : ''}<span>${esc(x.title)}</span></button></div>
      <div class="orch-run-actions">${orchReviewScoreHTML(x)}${x.reviewForYou ? '<span class="orch-tag" title="It marks the Works it accepts as reviewed">Marks reviewed for you</span>' : ''}${x.running ? '<i class="spin" aria-hidden="true"></i>' : ''}${childErrorBadge}${orchLineState(p, x, state)}${orchStopHTML(x)}${orchStartOrRetryHTML(x, state)}</div></header>
    ${orchActivityHTML(x)}
    ${orchAutoHTML(x)}
    ${orchRouteHTML(x)}
    ${!settled && x.why ? `<p class="orch-reason">${esc(x.why)}</p>` : ''}
    ${x.questions?.length ? `<button type="button" class="orch-ask" data-act="open-line" data-line="${esc(x.line)}">${ic('hint', 14)}<span>${esc(x.questions[0])}</span></button>` : ''}
    ${!settled && x.stoppedWork && !x.why ? `<p class="orch-reason">${esc(x.stoppedWork)} was stopped before it reported.</p>` : ''}
    ${x.report && !x.running ? `<button type="button" class="orch-report" data-act="open-step" data-line="${esc(x.line)}" data-step="${esc(x.reportWork || '')}"><strong>${x.reportLabel ? `Earlier report · ${esc(x.reportLabel)}` : 'Open report'} ${ic('right', 13)}</strong><span>${esc(plainOut(x.report))}</span></button>` : ''}
    ${orchMadeHTML(p, x)}
    ${lines.length ? `<div class="orch-lines">${lines.map(l => orchChildHTML(p, l)).join('')}</div>` : ''}
  </section>`;
}

const orchStatusOrder = ['wait', 'working', 'error', 'review', 'todo', 'backlog', 'ready', 'notes'];

// Jobs under way come first, and one that asks stays in its place among them.
function orchPriority(session, state, projectLines) {
  if (session.job || state === 'wait' || state === 'working' || session.lines.some(l => !l.archived && l.running)) return 0;
  if (state === 'backlog' && orchFresh.has(session.line)) return 0;
  if (!orchLineSettled(session, projectLines?.get(session.line), state) &&
    (state === 'error' || session.stoppedWork || session.lines.some(l => orchChildError(l, projectLines?.get(l.line))))) return 2;
  return ['backlog', 'review', 'todo'].includes(state) ? 3 : 4;
}
// Newest job first, by when it was handed over: nothing a running job does moves it.
const orchAskedAt = (session, line) => orchFresh.get(session.line) || session.askedAt || line?.createdAt || 0;
const orchNumber = session => Number(/(\d+)$/.exec(session.ref || '')?.[1]) || 0;
const orchByOrder = (a, b) => a.priority - b.priority || (a.priority ? 0 : b.at - a.at || orchNumber(b.session) - orchNumber(a.session));

function orchPager(page, pages, position) {
  if (pages <= 1) return '';
  const number = n => `<button type="button" data-act="orch-page" data-page="${n}" aria-label="Page ${n}" ${n === page ? 'aria-current="page"' : ''}>${n}</button>`;
  const move = (by, label, icon, disabled) => `<button type="button" data-act="orch-page" data-move="${by}" aria-label="${label} page" ${disabled ? 'disabled' : ''}>${ic(icon, 15)}</button>`;
  const visible = [...new Set([1, page - 1, page, page + 1, pages])].filter(n => n >= 1 && n <= pages).sort((a, b) => a - b);
  const numbers = visible.map((n, i) => (i && n - visible[i - 1] > 1 ? '<span aria-hidden="true">…</span>' : '') + number(n));
  return `<nav class="orch-pager" id="orchPager-${position}" aria-label="Session pages, ${position}">${move(-1, 'Previous', 'left', page === 1)}${numbers.join('')}${move(1, 'Next', 'right', page === pages)}</nav>`;
}

function orchMatchesQuery(x, query) {
  if (!query) return true;
  const matches = line => [line.title, line.ref, line.line].some(v => v && v.toLowerCase().includes(query));
  return matches(x) || x.lines.some(l => !l.archived && matches(l));
}

function orchResultsHTML(p, sessions) {
  const { query, status } = orchSessionView, term = query.trim().toLowerCase();
  const counts = new Map(), matches = [];
  const projectLines = new Map(allLines(p).map(l => [l.id, l]));
  let total = 0;
  for (const session of sessions) {
    const line = projectLines.get(session.line), state = session.job ? orchJobState(session.job) : orchStateKey(session, line), key = state === 'landed' ? 'ready' : state;
    if (!counts.has(key)) counts.set(key, 0);
    if (!orchMatchesQuery(session, term)) continue;
    total++;
    counts.set(key, counts.get(key) + 1);
    if (!status || key === status) matches.push({ session, state, priority:orchPriority(session, state, projectLines), at:orchAskedAt(session, line) });
  }
  // The server already sends the sessions that are not under way in recent-first order.
  matches.sort(orchByOrder);
  const pages = Math.max(1, Math.ceil(matches.length / ORCH_PAGE_SIZE));
  const page = orchSessionView.page = Math.min(pages, Math.max(1, orchSessionView.page));
  const start = (page - 1) * ORCH_PAGE_SIZE, rows = matches.slice(start, start + ORCH_PAGE_SIZE);
  const filter = (key, label, count) => `<button type="button" data-act="orch-status" data-status="${esc(key)}" aria-pressed="${status === key}">${esc(label)} <span>${count}</span></button>`;
  const keys = orchStatusOrder.filter(key => counts.has(key) || key === status);
  const filters = filter('', 'All', total) + keys.map(key => filter(key, STATE_TEXT[key] || key, counts.get(key) || 0)).join('');
  const range = pages > 1 ? `${start + 1}–${start + rows.length} of ${matches.length} sessions` : `${matches.length} session${matches.length === 1 ? '' : 's'}`;
  return `<div class="orch-toolbar"><div class="orch-statuses" role="group" aria-label="Filter sessions by status">${filters}</div>
    <div class="orch-results-bar"><span class="orch-range" role="status">${range}</span>${orchPager(page, pages, 'top')}</div></div>
    ${rows.length ? `<div class="orch-list">${rows.map(({ session, state }) => (session.job ? orchJobCard(session.job) : orchSessionCard(p, session, state))).join('')}</div>`
    : '<div class="orch-empty"><h3>No matching sessions</h3><button type="button" class="btn sm" data-act="orch-clear">Clear filters</button></div>'}
    ${orchPager(page, pages, 'bottom')}`;
}

function orchSessionsHTML(p, sessions = orchVisibleSessions(p)) {
  if (!sessions) return `<p class="sx-muted" role="status">${esc(ORCH.error || 'Loading sessions…')}</p>`;
  if (!sessions.length) return `<section class="orch-empty"><h2>No sessions yet</h2><p>Give your agent a goal. It can split the work across Lines or run tasks in parallel on one Line. It uses the agent record in Statistics to choose agents, rates each Work from 1 to 5 and reports back here.</p></section>`;
  return `<div class="orch-session-head"><h2 id="orchSessionsTitle" tabindex="-1">Sessions</h2>
    <label class="orch-search">${ic('search', 16)}<input type="search" id="orchSearch" placeholder="Search sessions or Lines" aria-label="Search sessions or Lines by title or ID" value="${esc(orchSessionView.query)}"></label></div>
    <div id="orchResults">${orchResultsHTML(p, sessions)}</div>`;
}

function orchPaintSessions() {
  const p = project(), sessions = orchVisibleSessions(p);
  if (sessions?.length && $('#orchResults')) {
    orchPaint('orchResults', () => orchResultsHTML(p, sessions));
  } else orchPaint('orchSessions', () => orchSessionsHTML(p, sessions));
}

// ---------- Unified Agents table in Statistics (per agent, model, effort; expandable by kind of job) ----------
const ORCH_RECORD_SHOWN = 10, ORCH_RATINGS_SHOWN = 5;
const orchRateTone = n => n >= 4 ? 'is-high' : n >= 3 ? 'is-mid' : 'is-low';
function orchStatsDays() {
  return typeof periodDays === 'function' ? periodDays() : 0;
}
function orchStatsAgentFilter() {
  return typeof STATS_STATE !== 'undefined' && STATS_STATE.agent && STATS_STATE.agent !== 'all' ? STATS_STATE.agent : '';
}
function orchSyncStatsFilter(_period, _agent, reload) {
  if (S.route.view !== 'stats') return;
  if (reload) return loadOrchestrator(project(), true);
  orchPaint('statsRecord', orchRecordHTML, true);
}
const orchRecordTotals = () => ({
  works:0, running:0, good:0, bad:0, scoreSum:0, scoreW:0, ratingSum:0, ratingW:0, scored:0, rated:0,
  tokenSum:0, tokenW:0, costSum:0, costW:0, minSum:0, minW:0, findings:{}, sources:{},
});
function orchAddRecordTotals(g, r) {
  const works = r.works || 0;
  g.works += works;
  g.running += r.running || 0;
  g.good += r.good || 0;
  g.bad += r.bad || 0;
  if (Number.isFinite(r.score)) {
    const w = r.scored || 1;
    g.scoreSum += r.score * w; g.scoreW += w; g.scored += r.scored || 0;
  }
  const rowRating = Number.isFinite(r.rating) ? r.rating : Number.isFinite(r.score) ? r.score : null;
  if (rowRating != null) {
    const w = r.rated || r.scored || 1;
    g.ratingSum += rowRating * w; g.ratingW += w; g.rated += r.rated || 0;
  }
  if (r.tokensPerWork != null) {
    const w = r.tokensKnown || works || 1;
    g.tokenSum += r.tokensPerWork * w; g.tokenW += w;
  }
  if (r.costPerWork != null) {
    const w = r.costKnown || works || 1;
    const tot = r.totalCost != null ? r.totalCost : r.costPerWork * w;
    g.costSum += tot; g.costW += w;
  }
  if (r.medianMinutes > 0) {
    const w = works || 1;
    g.minSum += r.medianMinutes * w; g.minW += w;
  }
  if (r.findings && typeof r.findings === 'object') {
    for (const [k, n] of Object.entries(r.findings)) if (n > 0) g.findings[k] = (g.findings[k] || 0) + Number(n);
  }
  if (r.bySource && typeof r.bySource === 'object') {
    for (const [k, info] of Object.entries(r.bySource)) {
      if (!info || !(info.count > 0) || !Number.isFinite(info.score)) continue;
      const slot = g.sources[k] || (g.sources[k] = { sum:0, count:0 });
      slot.sum += info.score * info.count;
      slot.count += info.count;
    }
  }
}
function orchRecordSummary(g) {
  const findings = Object.fromEntries(Object.entries(g.findings || {}).filter(([, n]) => n > 0));
  const bySource = {};
  for (const [k, v] of Object.entries(g.sources || {})) {
    if (v?.count > 0) bySource[k] = { score:Math.round((v.sum / v.count) * 10) / 10, count:v.count };
  }
  return {
    works:g.works, running:g.running, good:g.good, bad:g.bad, scored:g.scored, rated:g.rated,
    score:g.scoreW ? Math.round((g.scoreSum / g.scoreW) * 10) / 10 : null,
    rating:g.ratingW ? Math.round((g.ratingSum / g.ratingW) * 10) / 10 : null,
    tokensPerWork:g.tokenW ? Math.round(g.tokenSum / g.tokenW) : null,
    costPerWork:g.costW ? Math.round((g.costSum / g.costW) * 10000) / 10000 : null,
    totalCost:g.costW ? Math.round(g.costSum * 10000) / 10000 : null,
    medianMinutes:g.minW ? Math.round((g.minSum / g.minW) * 10) / 10 : 0,
    ...(Object.keys(findings).length ? { findings } : {}),
    ...(Object.keys(bySource).length ? { bySource } : {}),
  };
}
function orchGroupRecordRows(rows) {
  const groups = new Map();
  for (const r of rows) {
    if (orchKindKey(r.kind) === 'review') continue;
    const key = JSON.stringify([r.runner || '', (r.model || '').toLowerCase(), r.effort || '', r.agent || '']);
    const g = groups.get(key) || {
      key, agent:r.agent, runner:r.runner || '', model:r.model || '', effort:r.effort || '',
      savedAgents:new Set(), byKind:new Map(), ...orchRecordTotals(),
    };
    for (const name of r.savedAgents || []) g.savedAgents.add(name);
    orchAddRecordTotals(g, r);
    const kind = orchKind(r.kind);
    if (kind) {
      const k = g.byKind.get(kind) || orchRecordTotals();
      orchAddRecordTotals(k, r);
      g.byKind.set(kind, k);
    }
    groups.set(key, g);
  }
  return [...groups.values()].map(g => {
    const byKind = [...g.byKind].map(([kind, k]) => ({ kind, ...orchRecordSummary(k) }))
      .sort((a, b) => b.works - a.works || a.kind.localeCompare(b.kind));
    return {
      key:g.key, agent:g.agent, runner:g.runner, model:g.model, effort:g.effort,
      savedAgents:[...g.savedAgents].sort(), ...orchRecordSummary(g), byKind,
    };
  });
}
const ORCH_RECORD_SORTS = {
  agent:r => r.agent.toLowerCase(),
  works:r => -r.works,
  rating:r => -(r.rating ?? -1),
  time:r => r.medianMinutes || Infinity,
  tokens:r => -(r.tokensPerWork ?? -1),
  cost:r => -(r.costPerWork ?? -1),
};
function orchRecordTitleHTML(r) {
  let main = r.agent || 'Agent';
  const meta = [];
  if (r.effort && main.endsWith(` · ${r.effort} effort`)) {
    main = main.slice(0, -(r.effort.length + 10));
    meta.push(`${r.effort} effort`);
  } else {
    if (r.model && !main.includes(r.model)) meta.push(r.model);
    if (r.effort && !main.includes(r.effort)) meta.push(`${r.effort} effort`);
  }
  if (!ORCH.kind && r.byKind.length > 1) meta.push(`${r.byKind.length} kinds`);
  else if (!ORCH.kind && r.byKind.length === 1 && r.byKind[0].works === r.works) meta.push(ORCH_KIND[r.byKind[0].kind] || r.byKind[0].kind);
  return `<span><b>${esc(main)}</b>${meta.length ? `<small>${esc(meta.join(' · '))}</small>` : ''}</span>`;
}
function orchRatingCellHTML(r) {
  const val = Number.isFinite(r.rating) ? r.rating : Number.isFinite(r.score) ? r.score : null;
  if (val == null) return '<span class="sx-muted">—</span>';
  const pct = Math.round(Math.max(0, Math.min(5, val)) / 5 * 100);
  return `<div class="sx-rating-cell"><span class="sx-rating-val">${orchRate(val)}</span><span class="sx-rbar" aria-hidden="true"><i class="${orchRateTone(val)}" style="width:${pct}%"></i></span></div>${orchRateDetail(r)}`;
}
function orchFindingsSummary(findings) {
  if (!findings || typeof findings !== 'object') return '';
  const labels = [['bug', 'bug', 'bugs'], ['gap', 'gap', 'gaps'], ['risk', 'risk', 'risks'], ['unverified', 'unverified', 'unverified']];
  return labels.map(([k, one, many]) => (findings[k] > 0 ? `${findings[k]} ${findings[k] === 1 ? one : many}` : '')).filter(Boolean).join(' · ');
}
function orchRecordExpandHTML(r) {
  const items = r.byKind.map(k => {
    const label = ORCH_KIND[k.kind] || k.kind;
    const pct = Number.isFinite(k.rating) ? Math.round(Math.max(0, Math.min(5, k.rating)) / 5 * 100) : 0;
    const src = [Number.isFinite(k.score) && `Orch ${k.score.toFixed(1)}`, (k.good || k.bad) && `${k.good} good${k.bad ? ` · ${k.bad} not` : ''}`].filter(Boolean).join(' · ');
    const facts = [`${k.works} Work${k.works === 1 ? '' : 's'}`, k.medianMinutes ? `${k.medianMinutes} min` : '', k.costPerWork != null ? `${orchMoney(k.costPerWork)}/Work` : ''].filter(Boolean).join(' · ');
    const ftags = orchFindingsSummary(k.findings);
    return `<div class="sx-kind-item">
      <div class="sx-kind-top"><b>${esc(label)}</b><span class="sx-num">${orchRate(k.rating)}</span></div>
      ${Number.isFinite(k.rating) ? `<div class="sx-rbar sx-rbar-wide" aria-hidden="true"><i class="${orchRateTone(k.rating)}" style="width:${pct}%"></i></div>` : ''}
      <small class="sx-num">${esc(facts)}${src ? ` · ${esc(src)}` : ''}${ftags ? ` · ${esc(ftags)}` : ''}</small>
    </div>`;
  }).join('');
  return `<tr class="sx-ex"><td colspan="6"><div class="sx-kind-grid">${items}</div></td></tr>`;
}
function orchRecordHTML() {
  const st = ORCH.stats, all = st?.rows || [], activeKind = orchKind(ORCH.kind);
  const kinds = [...new Set([...(ORCH.kinds || []), ...all.map(r => r.kind)].map(orchKind).filter(Boolean))];
  const agentFilter = orchStatsAgentFilter();
  const match = r => orchKindKey(r.kind) !== 'review' && (!activeKind || orchKind(r.kind) === activeKind) && (!agentFilter || r.runner === agentFilter);
  const seg = kinds.length > 1 || activeKind ? `<div class="seg sx-seg-sm" role="group" aria-label="Kind of job">${['', ...kinds].map(k => `<button type="button" aria-pressed="${activeKind === k}" data-act="orch-kind" data-kind="${esc(k)}">${esc(ORCH_KIND[k] || k || 'All')}</button>`).join('')}</div>` : '';
  const filtered = all.filter(match);
  const by = ORCH_RECORD_SORTS[ORCH.recordSort] || ORCH_RECORD_SORTS.works;
  const grouped = orchGroupRecordRows(filtered).sort((a, b) => { const x = by(a), y = by(b); return x < y ? -1 : x > y ? 1 : b.works - a.works || a.agent.localeCompare(b.agent); });
  const shown = ORCH.recordAll ? grouped : grouped.slice(0, ORCH_RECORD_SHOWN);
  const ratings = (st?.ratings || []).filter(r => match(r) && orchScore(r.score));
  const shownRatings = ORCH.ratingsAll ? ratings : ratings.slice(0, ORCH_RATINGS_SHOWN);
  const cols = [
    ['agent', 'Agent'],
    ['works', 'Works'],
    ['rating', 'Rating', '', "The orchestrator's score and yours, combined. Yours counts twice."],
    ['time', 'Time', 'sx-wide'],
    ['tokens', 'Tokens / Work', 'sx-wide'],
    ['cost', 'Cost', '', 'Average cost per Work'],
  ];
  const head = `<tr>${cols.map(([k, label, cls, tip]) => `<th class="${cls || ''}" aria-sort="${ORCH.recordSort === k ? 'ascending' : 'none'}"${tip ? ` title="${esc(tip)}"` : ''}><button type="button" class="sx-th${ORCH.recordSort === k ? ' on' : ''}" data-act="orch-record-sort" data-sort="${k}">${label}</button></th>`).join('')}</tr>`;
  const anyExpandable = !activeKind && shown.some(r => r.byKind.length > 1);
  const rowsHTML = shown.map(r => {
    const canExpand = !activeKind && r.byKind.length > 1;
    const open = canExpand && ORCH.recordOpen.has(r.key);
    const costCell = r.costPerWork == null
      ? '—'
      : `${orchMoney(r.costPerWork)}${r.works > 1 && r.totalCost != null ? `<small>${orchMoney(r.totalCost)} total</small>` : ''}`;
    const chev = anyExpandable ? `<span class="sx-chev" aria-hidden="true">${canExpand ? ic(open ? 'down' : 'right', 13) : ''}</span>` : '';
    const row = `<tr class="${canExpand ? `sx-ag${open ? ' open' : ''}` : ''}"${canExpand ? ` data-act="orch-record-open" data-key="${esc(r.key)}" aria-expanded="${open}"` : ''}>
      <td><span class="sx-who"${r.savedAgents.length ? ` title="${esc(r.savedAgents.join('\n'))}"` : ''}>${chev}${av(r.runner || 'agent', 22)}${orchRecordTitleHTML(r)}</span></td>
      <td class="sx-num">${r.works}${r.running ? `<small>${r.running} working</small>` : ''}</td>
      <td class="sx-num">${orchRatingCellHTML(r)}</td>
      <td class="sx-num sx-wide">${r.medianMinutes ? `${r.medianMinutes} min` : '—'}</td>
      <td class="sx-num sx-wide">${orchTokens(r.tokensPerWork)}</td>
      <td class="sx-num">${costCell}</td></tr>`;
    return open ? `${row}${orchRecordExpandHTML(r)}` : row;
  }).join('');
  const moreAgents = grouped.length > ORCH_RECORD_SHOWN ? `<button type="button" class="sx-showall" data-act="orch-record-all">${ORCH.recordAll ? 'Show fewer' : `Show all ${grouped.length} agents`}</button>` : '';
  const body = !st ? `<p class="sx-muted" role="status">${esc(ORCH.error || 'Loading agents…')}</p>` : grouped.length ? `<div class="sx-scroll"><table class="sx-table orch-table">${head}${rowsHTML}</table></div>${moreAgents}` : '<p class="sx-muted">No Works yet.</p>';
  const moreRatings = ratings.length > ORCH_RATINGS_SHOWN ? `<button type="button" class="sx-showall" data-act="orch-ratings-all">${ORCH.ratingsAll ? 'Show fewer' : `Show all ${ratings.length}`}</button>` : '';
  const recent = ratings.length ? `<div class="sx-orch-ratings"><div class="sx-orch-ratings-hd"><h3>Recent ratings <em class="sx-muted sx-num">${ratings.length}</em></h3>${moreRatings}</div><div class="sx-orch-ratings-list">${shownRatings.map(r => orchRatingHTML(r, r.line,
    [ORCH_KIND[orchKind(r.kind)], r.title || r.line, r.label || r.work].filter(Boolean).join(' · '))).join('')}</div></div>` : '';
  return `<section class="sx-card sx-agents"><header class="sx-hd"><div><p class="sx-eyebrow">${esc((typeof project === 'function' && project(ORCH.project)?.name) || 'This project')} only</p><h2>Agent record</h2><p class="sx-muted">Per agent, model and effort · combined rating, tokens and cost</p></div>${seg}</header>${body}${recent}</section>`;
}

// ---------- Agents sidebar: "Who did the work" card from Statistics (PE-706, PE-771) ----------
const orchRate = n => Number.isFinite(n) ? `${n.toFixed(1)}<small class="sx-inline"> /5</small>` : '—';
// Under a combined rating, its sources (reviewer vs coordinator when both exist, else Orchestrator) and the person's own good or not.
function orchRateDetail(r) {
  const rev = r.bySource?.reviewer, coord = r.bySource?.coordinator;
  const orchPart = rev && coord
    ? `Reviewer ${rev.score.toFixed(1)} · Coordinator ${coord.score.toFixed(1)}`
    : Number.isFinite(r.score) && Number.isFinite(r.rating) && `Orchestrator ${r.score.toFixed(1)}`;
  const ftags = orchFindingsSummary(r.findings);
  const d = [orchPart, (r.good || r.bad) && `${r.good} good · ${r.bad} not`, ftags].filter(Boolean).join(' · ');
  return d ? `<small>${esc(d)}</small>` : '';
}
function orchAgentsHTML(p = project()) {
  const hide = `<button type="button" class="icon-btn orch-agents-hide" data-act="orch-agents-toggle" aria-controls="orchAgentsPanel" aria-expanded="true" title="Hide the agents panel" aria-label="Hide the agents panel">${ic('x', 16)}</button>`;
  const empty = 'No Works yet. Each agent appears here once it has one.';
  if (typeof projectAgentShareHTML === 'function') {
    return projectAgentShareHTML(p, { period:'all', className:'orch-agents', titleId:'orchAgentsTitle', action:hide, empty });
  }
  return `<section class="sx-card sx-share orch-agents"><header class="sx-hd"><div><p class="sx-eyebrow">${esc(p?.name || 'This project')} · Agents</p><h2 id="orchAgentsTitle">Who did the work</h2></div>${hide}</header><p class="sx-muted">${empty}</p></section>`;
}

// ---------- Looking prices up with an agent; the list itself is prices.js ----------
function orchLookupHTML() {
  const active = ORCH.stats?.activePriceLookup;
  if (active?.line) {
    return `<span>${active.status === 'waiting' ? 'Needs you' : 'Looking up…'}</span> <button type="button" class="btn sm" data-act="open-line" data-line="${esc(active.line)}" aria-label="Open price lookup">Open</button>`;
  }
  if (!orchPresets().length) return '';
  const needsRestart = ORCH.stats && active === undefined;
  const busy = ORCH.draft.priceSending || active?.status === 'starting';
  const label = busy ? 'Starting…' : !ORCH.stats ? 'Loading…' : 'Look up with AI';
  return `<button type="button" class="btn sm" data-act="orch-prices-ai" title="Ask your agent to look up current model prices" ${busy || !ORCH.stats || needsRestart ? 'disabled' : ''}>${busy ? '<i class="spin" aria-hidden="true"></i>' : ic('spark', 14)}${label}</button>${needsRestart ? '<span>Restart PenEcho to enable lookup.</span>' : ''}`;
}

// ---------- What the orchestrator can do ----------
function orchToolsHTML() {
  const tools = ORCH.data?.tools || [];
  if (!tools.length) return '';
  return `<details class="orch-fns"><summary>What it can do</summary><table class="sx-table">${tools.filter(t => t.do !== 'help').map(t => `<tr><td><code>${esc(t.do)}</code></td><td class="sx-muted">${esc(t.args)}</td><td>${esc(t.does)}</td></tr>`).join('')}</table></details>`;
}

// ---------- Loading and drawing ----------
const orchHidden = () => typeof document !== 'undefined' && document.hidden;
const ORCH_STALE_MS = 30000;
function clearOrchestratorTimeout(request) {
  if (request?.timeout && typeof clearTimeout === 'function') { clearTimeout(request.timeout); request.timeout = 0; }
}
function armOrchestratorTimeout(request, p, delay = ORCH_STALE_MS) {
  if (!request || request.timeout || typeof setTimeout !== 'function') return;
  request.timeout = setTimeout(() => {
    request.timeout = 0;
    if (ORCH.loading !== request) return;
    ORCH.loading = false;
    request.abort?.abort();
    if (!orchHidden() && S.route.view === request.view && project()?.id === p.id) loadOrchestrator(p, false);
  }, Math.max(1, delay));
}
function pauseOrchestrator() {
  if (ORCH.timer && typeof clearTimeout === 'function') { clearTimeout(ORCH.timer); ORCH.timer = 0; }
  clearOrchestratorTimeout(ORCH.loading);
}
// At most one load every few seconds; a change that comes sooner is loaded when the time is up, so the last change always shows.
async function loadOrchestrator(p = project(), force = false) {
  if (orchHidden()) return;
  const view = S.route.view;
  // penecho.ai has the sessions of a project that lives on a computer; the agent record and the prices stay on the computer.
  if (!p || (HOSTED && !HOSTED.onComputer) || (HOSTED && view !== 'orchestrator') || ORCH.project !== p.id || (view !== 'stats' && view !== 'orchestrator')) return;
  const rev = p.rev, kind = view === 'stats' ? ORCH.kind : '', days = view === 'stats' ? orchStatsDays() : 0;
  const now = Date.now(), active = ORCH.loading;
  if (!force && active && active.view === view && active.rev === rev && active.kind === kind && active.days === days && now - (active.at || 0) < ORCH_STALE_MS) {
    // Re-arm the stale timeout if hiding cleared it while the request stayed pending.
    armOrchestratorTimeout(active, p, ORCH_STALE_MS - (now - (active.at || 0)));
    return;
  }
  const wait = ORCH_EVERY - (now - ORCH.last);
  if (!force && wait > 0) {
    if (!ORCH.timer && typeof setTimeout === 'function') ORCH.timer = setTimeout(() => {
      ORCH.timer = 0;
      if (!orchHidden() && S.route.view === view && project()?.id === p.id) loadOrchestrator();
    }, wait);
    return;
  }
  const abort = typeof AbortController === 'function' ? new AbortController() : null;
  const request = { view, rev, kind, days, at:now, abort, timeout:0 };
  pauseOrchestrator();
  if (active && active !== request) { clearOrchestratorTimeout(active); active.abort?.abort(); }
  ORCH.loading = request; ORCH.last = now;
  armOrchestratorTimeout(request, p, ORCH_STALE_MS);
  try {
    const params = [];
    if (kind) params.push(`kind=${encodeURIComponent(kind)}`);
    if (days > 0) params.push(`days=${days}`);
    const query = params.length ? `?${params.join('&')}` : '';
    const path = `${pathFor(p.id)}/orchestrator${view === 'stats' ? '/stats' + query : ''}`;
    const data = await (abort ? api(path, { signal:abort.signal }) : api(path));
    if (ORCH.loading !== request || project()?.id !== p.id) return;
    if (view === 'stats') {
      ORCH.stats = data; ORCH.rev = rev;
      if (S.route.view === view && !orchHidden()) {
        if (typeof refreshStats === 'function') refreshStats();
        // Prices an agent or another page saved meanwhile.
        if (typeof loadPrices === 'function' && !PRICES.old && JSON.stringify(data.models || []) !== JSON.stringify(PRICES.data?.models)) loadPrices(true);
      }
      if (data.activePriceLookup?.line && !ORCH.draft.priceSending) delete ORCH.draft.priceRequest;
      if (!kind) ORCH.kinds = [...new Set(data.rows.map(r => r.kind))];
    } else { ORCH.data = data; orchSettle(p.id, data.sessions); }
    ORCH.error = '';
  } catch (error) {
    if (error?.aborted || ORCH.loading !== request || project()?.id !== p.id) return;
    ORCH.error = error.message || 'Could not load orchestrator data.';
    if (error.status !== 404) toast(ORCH.error);
  } finally {
    clearOrchestratorTimeout(request);
    if (ORCH.loading === request) ORCH.loading = false;
  }
  if (S.route.view !== view || orchHidden()) return;
  if (view === 'stats') orchPaintStats();
  else orchPaintAll();
  // The settings beside the box and above the prices are read once the page's own data is in, afresh when the page is.
  if (!ORCH.error && typeof loadOrchSettings === 'function') loadOrchSettings(p, force);
  // An outstanding wait and a runner's heartbeat can change without a project revision.
  const follow = view === 'stats' ? ORCH.stats?.activePriceLookup : ORCH_JOBS.some(j => j.project === p.id && j.state !== 'failed') || ORCH.data?.sessions.some(s => !s.archived && (s.running || s.lines.some(l => !l.archived && l.running)));
  if (!ORCH.timer && follow) {
    ORCH.timer = setTimeout(() => {
      ORCH.timer = 0;
      if (!orchHidden() && S.route.view === view && project()?.id === p.id) loadOrchestrator();
    }, ORCH_EVERY);
  }
}
// A part is drawn again only when it changed, and never while you type in it.
function orchPaint(id, make, force = false) {
  const el = $(`#${id}`); if (!el) return;
  const active = document.activeElement, inside = Boolean(active && el.contains(active));
  const typing = inside && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName);
  if (typing && !force && id !== 'orchSessions') return;
  const html = typeof make === 'function' ? make() : make;
  if (force || el.dataset.h !== html) {
    const kind = id === 'statsRecord' && inside ? active.dataset.kind : null;
    const focused = id === 'orchResults' && inside ? active : null;
    const pager = focused?.closest('nav')?.id;
    const boxGoal = id === 'orchBox' && inside && active.id === 'orchGoal'
      ? { start:active.selectionStart, end:active.selectionEnd, dir:active.selectionDirection, top:active.scrollTop } : null;
    const boxFocusId = id === 'orchBox' && inside && !boxGoal ? active.id || '' : '';
    // The agents panel is read and scrolled like any list; a background refresh keeps its scroll position.
    const side = id === 'orchAgents' ? el.closest('.orch-side') : null, sideTop = side?.scrollTop || 0;
    el.innerHTML = el.dataset.h = html;
    if (side) side.scrollTop = sideTop;
    if (id === 'orchBox') {
      wireComposers(el);
      if (boxGoal) {
        const next = $('#orchGoal', el);
        if (next) {
          next.focus({ preventScroll:true });
          if (typeof boxGoal.start === 'number' && typeof boxGoal.end === 'number') {
            const len = next.value.length;
            next.setSelectionRange?.(Math.min(boxGoal.start, len), Math.min(boxGoal.end, len), boxGoal.dir || 'none');
          }
          if (typeof boxGoal.top === 'number') next.scrollTop = boxGoal.top;
        }
      } else if (boxFocusId) {
        const next = document.getElementById(boxFocusId);
        if (next && el.contains(next) && !next.disabled) next.focus({ preventScroll:true });
      }
    }
    if (focused?.dataset.act) {
      const group = pager ? document.getElementById(pager) : el;
      const [buttonClass] = focused.classList;
      const target = [...(group?.querySelectorAll('button:not(:disabled)') || [])].find(b =>
        (!buttonClass || b.classList.contains(buttonClass)) && Object.keys(focused.dataset).every(key => b.dataset[key] === focused.dataset[key]));
      (target || group?.querySelector('[aria-current="page"]') || $('#orchSessionsTitle'))?.focus({ preventScroll:true });
    }
    if (kind != null) [...el.querySelectorAll('[data-kind]')].find(b => b.dataset.kind === kind)?.focus({ preventScroll:true });
  }
}
function orchPaintAll() {
  if (S.route.view !== 'orchestrator') return;
  orchPaintSessions();
  orchPaint('orchAgents', () => orchAgentsHTML(project()));
  orchPaint('orchTools', orchToolsHTML);
}
function refreshOrchestrator() {
  if (S.route.view !== 'orchestrator') return;
  orchPaintAll();
  loadOrchestrator();
}
// Keep both Statistics cards outside the period/agent-filtered body (the prices' own is in prices.js).
function statsRecordHTML(p) {
  if (HOSTED) return '';
  orchUseProject(p);
  return `<div id="statsRecord" tabindex="-1" role="region" aria-label="Agent record">${orchRecordHTML()}</div>`;
}
function orchPaintStats() {
  orchPaint('statsRecord', orchRecordHTML);
  if (typeof paintPrices === 'function') paintPrices();
  // A price can keep keyboard focus while the lookup status changes.
  orchPaint('orchLookup', orchLookupHTML);
}
function refreshStatsPrices(p = project(), entering = false) {
  if (!p || HOSTED || S.route.view !== 'stats') return;
  orchUseProject(p);
  orchPaintStats();
  if (entering && typeof loadPrices === 'function') loadPrices(true);
  if (entering || !ORCH.stats || ORCH.rev !== p.rev) {
    loadOrchestrator(p, entering);
    return true;
  }
}

// ---------- Typing and clicking ----------
document.addEventListener('input', e => {
  if (e.target.id === 'orchSearch') {
    orchSessionView.query = e.target.value;
    orchSessionView.page = 1;
    orchPaintSessions();
  }
});
document.addEventListener('change', e => {
  if (e.target.id === 'orchFilePick') { orchAddFiles([...(e.target.files || [])]); e.target.value = ''; }
});
ACT['orch-agent'] = orchAgentMenu;
ACT['orch-status'] = el => {
  orchSessionView.status = el.dataset.status;
  orchSessionView.page = 1;
  orchPaintSessions();
};
ACT['orch-page'] = el => {
  const fromBottom = el.closest('nav')?.id === 'orchPager-bottom';
  orchSessionView.page = el.dataset.move ? orchSessionView.page + Number(el.dataset.move) : Number(el.dataset.page);
  orchPaintSessions();
  if (fromBottom) {
    $('#orchPager-top [aria-current="page"]')?.focus({ preventScroll:true });
    $('#orchSessionsTitle')?.scrollIntoView({ block:'start' });
  }
};
ACT['orch-clear'] = () => {
  Object.assign(orchSessionView, defaultOrchSessionView);
  const input = $('#orchSearch');
  input.value = '';
  orchPaintSessions();
  input.focus();
};
ACT['orch-start'] = () => orchSubmit(false);
ACT['orch-guide-dismiss'] = () => {
  orchGuideOpen = false;
  try { localStorage.setItem(ORCH_GUIDE, 'dismissed'); } catch { /* Keep this visit's choice. */ }
  $('#orchGuide').hidden = true;
  const starters = $('#orchStarters'); if (starters) starters.hidden = true;
  const show = $('[data-act="orch-guide-show"]'); show.hidden = false;
  ($('#orchGoal') || $('[data-act="open-agents"]', $('#orchBox')) || show).focus();
};
ACT['orch-guide-show'] = el => {
  orchGuideOpen = true; el.hidden = true; $('#orchGuide').hidden = false; $('#orchGuideTitle').focus();
  const starters = $('#orchStarters'); if (starters) starters.hidden = false;
};
ACT['orch-how-models'] = el => orchHowModelsOpen(el);
// A starter fills the box, choosing its output when it names one, and leaves the words to edit.
ACT['orch-starter'] = el => {
  const x = ORCH_STARTERS[Number(el.dataset.i)], form = $('#orchBox .composer'), ta = $('#orchGoal');
  if (!x || !form || !ta) return;
  ORCH.draft.text = ta.value = x.text;
  if (x.make && typeof chooseMake === 'function') chooseMake(form, x.make);
  syncComposer(form);
  ta.focus(); ta.setSelectionRange?.(ta.value.length, ta.value.length);
};
// + opens the menu for files and what to make, as on the home and line boxes.
ACT['orch-attach'] = el => {
  const pick = () => { if (!can('files')) { orchCantAdd(); return; } $('#orchFilePick')?.click(); };
  const form = el?.closest?.('.composer');
  if (!form || typeof makePlusItems !== 'function') { pick(); return; }
  openMenu(el, [{ label:'Add images or files', icon:'clip', fn:pick }, ...makePlusItems(form)]);
};
ACT['orch-remove'] = el => {
  const file = ORCH.draft.files.find(x => x.id === el.dataset.file);
  if (!file) return;
  forgetOrchFile(file);
  releaseOrchPreview(file);
  ORCH.draft.files = ORCH.draft.files.filter(x => x !== file);
  rememberBoxes();
  orchPaintFiles();
};
ACT['orch-preview'] = previewBoxImage;
ACT['orch-agents-toggle'] = el => {
  const page = el.closest('.orch-page'), panel = page?.querySelector('#orchAgentsPanel');
  if (!page || !panel) return;
  const show = page.classList.contains('agents-hidden'), fromPanel = panel.contains(el);
  page.classList.toggle('agents-hidden', !show);
  panel.hidden = !show;
  for (const button of page.querySelectorAll('[data-act="orch-agents-toggle"]')) {
    button.setAttribute('aria-expanded', String(show));
    button.title = show ? 'Hide the agents panel' : 'Show the agents panel';
  }
  try { localStorage.setItem(ORCH_AGENTS_OPEN, show ? 'open' : 'closed'); } catch { /* Only a convenience. */ }
  if (show) orchPaint('orchAgents', () => orchAgentsHTML(project()));
  else if (fromPanel) page.querySelector('[data-act="orch-agents-toggle"]')?.focus({ preventScroll:true });
};
ACT['orch-kind'] = el => {
  ORCH.kind = orchKind(el.dataset.kind);
  orchPaintStats();
  // The server returns the 50 most recent ratings for this kind, including older ones outside the unfiltered list.
  return loadOrchestrator(project(), true);
};
ACT['orch-record-sort'] = el => {
  ORCH.recordSort = el.dataset.sort || 'works';
  orchPaint('statsRecord', orchRecordHTML, true);
};
ACT['orch-record-open'] = el => {
  const key = el.dataset.key;
  if (!key) return;
  if (ORCH.recordOpen.has(key)) ORCH.recordOpen.delete(key); else ORCH.recordOpen.add(key);
  orchPaint('statsRecord', orchRecordHTML, true);
};
ACT['orch-record-all'] = () => {
  ORCH.recordAll = !ORCH.recordAll;
  orchPaint('statsRecord', orchRecordHTML, true);
};
ACT['orch-ratings-all'] = () => {
  ORCH.ratingsAll = !ORCH.ratingsAll;
  orchPaint('statsRecord', orchRecordHTML, true);
};
// An agent looks the prices up and saves them with set-price, the way the orchestrator calls every function.
ACT['orch-prices-ai'] = async () => {
  const p = project(), chosen = orchPreset(), draft = ORCH.draft;
  if (!p || !chosen || draft.priceSending || ORCH.stats?.activePriceLookup !== null) return;
  if (!draft.priceRequest) {
    const missing = orchUnpriced(), known = (ORCH.stats.models || []).map(m => m.model);
    const which = (missing.length ? missing : known).map(key => {
      const name = orchCatalogName(key);
      return name ? `${key} (${name})` : key;
    }).join(', ') || 'the models the saved agents use (see agents)';
    const goal = `Look up the current list prices, in US$ per million tokens (input, output, and cached input where the provider has one), for: ${which}. Use the providers' own pricing pages. Save each with set-price under its original model key, putting the page you read in source. Do not create Lines for this. Reply with a short table using the real model names. Resolve opaque IDs from the model catalog and keep them out of the table. If a name cannot be verified, say so.`;
    draft.priceRequest = { purpose:'model-prices', preset:chosen.id, goal, requestId:orchRequestId() };
  }
  draft.priceSending = true;
  orchPaint('orchLookup', orchLookupHTML);
  try {
    const r = await api(`${pathFor(p.id)}/orchestrator`, { method:'POST', body:draft.priceRequest });
    delete draft.priceRequest;
    if (ORCH.draft !== draft) return;
    if (ORCH.stats && (r.status === 'working' || r.status === 'waiting' || r.status === 'not-started')) ORCH.stats.activePriceLookup = r;
    orchPaint('orchLookup', orchLookupHTML);
    await loadOrchestrator(p, true);
  } catch (error) {
    if (error.status >= 400 && error.status < 500) delete draft.priceRequest;
    toast(error.message);
  } finally {
    draft.priceSending = false;
    if (ORCH.draft === draft) orchPaint('orchLookup', orchLookupHTML);
  }
};
