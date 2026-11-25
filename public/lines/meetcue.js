// MeetCue inside the Lines pages: its row in the rail right below My Canvases, the meetings of the connected account,
// one meeting's diagrams and minutes, a meeting added to a project as a line or as a meeting node on an existing line,
// its detail panel, cross-project links, disconnect/unlink, and a project sent to MeetCue.
// Meetings stay in MeetCue and are read through PenEcho Cloud. The server side is src/server/project-lines/meetcue.js.
// With no account, or no MeetCue connected, the page introduces PenEcho MeetCue and explains how to connect.
ICONS.meetcue = '<path d="M5 4.5h14a2.5 2.5 0 0 1 2.5 2.5v8.5A2.5 2.5 0 0 1 19 18h-7.2l-4.3 3.2V18H5A2.5 2.5 0 0 1 2.5 15.5V7A2.5 2.5 0 0 1 5 4.5Z"/><path d="M12 7.8l.95 2.45 2.45.95-2.45.95L12 14.6l-.95-2.45-2.45-.95 2.45-.95Z" fill="currentColor" stroke="none"/>';
ICONS.mic = ICONS.meetcue;
KIND.meeting = { label:'Meeting', icon:'meetcue' };
const MC_APP = 'https://apps.apple.com/app/id6822044727', MC_PLAY = 'https://play.google.com/store/apps/details?id=ai.penecho.meeting', MC_SITE = 'https://penecho.ai/meetcue.html', MC_PAGE = 50;
// MeetCue's own page on penecho.ai, from both of the MeetCue page's states.
const mcSiteLink = (label = 'About MeetCue') => `<a class="mc-site" href="${MC_SITE}" target="_blank" rel="noopener">${esc(label)}${ic('right', 13)}</a>`;
// status: what GET /meetcue said. meetings: the list, newest first. links: server-scanned { [meetingId]: [{ projectId, projectName, color, slug, title, ownLine, step }] }.
const MC = { status:null, meetings:null, links:{}, more:false, problem:false, loading:false, seq:0, one:{}, watch:0, diagramView:'all' };
// Built-in example meetings so users can explore the detail page, whole + topic diagrams, and composer linking before connecting.
const MC_EXAMPLES = [
  {
    id:'example-launch-sync',
    title:'Product launch & Q4 pricing sync',
    status:'ended',
    started_at:'2026-11-18T10:00:00.000Z',
    ended_at:'2026-11-18T10:38:00.000Z',
    duration_ms:2280000,
    minutes_ready:true,
    action_count:3,
    gist:'Aligned on Q4 Pro and Team pricing tiers, locked November 28 for the public beta launch, and assigned regional partner rollout owners.',
    example:true,
  },
  {
    id:'example-customer-discovery',
    title:'Customer discovery: onboarding friction',
    status:'ended',
    started_at:'2026-11-14T15:30:00.000Z',
    ended_at:'2026-11-14T15:54:00.000Z',
    duration_ms:1440000,
    minutes_ready:true,
    action_count:2,
    gist:'Reviewed interviews with 4 design-team leads; agreed to ship interactive example meetings and one-click diagram export to Canvas to shorten time-to-value.',
    example:true,
  },
];
const mcIsExample = id => MC_EXAMPLES.some(x => x.id === id);
const mcFindMeeting = id => (MC.meetings || []).find(x => x.id === id) || MC_EXAMPLES.find(x => x.id === id) || null;
// Official MeetCue logo (speech bubble with sparkle on purple-blue gradient).
const mcGlyph = (size = 22) => `<img class="mglyph" src="lines/meetcue-icon.png" width="${size}" height="${size}" style="--s:${size}px" alt="" aria-hidden="true">`;
// Cloud's own answers carry their words in `message`; PenEcho's in `error`.
const mcSay = error => error?.data?.message || error?.message || 'MeetCue is not answering.';

// ---------- Where the pages live: #meetcue and #meetcue/<meeting> ----------
const meetcueHash = hash => hash === '#meetcue' || /^#meetcue\/[A-Za-z0-9-]{1,80}$/.test(hash);
function mcAt() {
  const [page, id = ''] = typeof S.shelfPage === 'string' ? S.shelfPage.split('/') : [];
  return page === 'meetcue' ? { id } : null;
}
function mcRedraw() { if (mcAt()) render(); else renderRail(); }
ACT['open-meetcue'] = () => { closeSwitcher(); if (location.hash === '#meetcue') loadMeetcue(); else location.hash = 'meetcue'; };
ACT['open-meeting'] = el => {
  const id = el.dataset.m; if (!id) return;
  if (typeof HOSTED !== 'undefined' && HOSTED) { hostedTell({ go:`/dashboard.html#meetcue/${encodeURIComponent(id)}` }); return; }
  location.hash = `meetcue/${id}`;
};

// ---------- The rail: MeetCue directly below My Canvases ----------
function railMeetcueHTML() {
  mcFollowAccount();
  const on = Boolean(mcAt());
  return `<div class="rail-item rail-meetcue"><button type="button" class="rail-row ${on ? 'on' : ''}" data-act="open-meetcue" ${on ? 'aria-current="page"' : ''} title="MeetCue">${mcGlyph(22)}<span class="rail-name">MeetCue</span></button></div>`;
}

// Signing in or out changes what MeetCue answers, so it is asked again. The rail is redrawn whenever the account is read.
function mcFollowAccount() {
  const a = S.cloudAccount, signed = a ? Boolean(a.signedIn) : null;
  if (signed === null || signed === MC.signed) return;
  const first = MC.signed === undefined;
  MC.signed = signed;
  if (!first) setTimeout(loadMeetcue, 0);
}

// ---------- What MeetCue says ----------
const mcWhen = iso => {
  const d = new Date(iso), now = new Date(); if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day:'numeric', month:'short', ...(d.getFullYear() !== now.getFullYear() ? { year:'numeric' } : {}) });
};
const mcLong = ms => { const m = Math.round(Number(ms) / 60000); return Number.isFinite(m) && m > 0 ? (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`) : ''; };
const mcFacts = (m, actions = m.action_count) => [mcWhen(m.started_at), mcLong(m.duration_ms), m.minutes_ready === false ? 'No minutes yet' : actions ? `${actions} ${actions === 1 ? 'action' : 'actions'}` : ''].filter(Boolean).join(' · ');
const mcSignedOut = answer => answer?.signedIn === false;
async function loadMeetcue() {
  const seq = ++MC.seq;
  MC.loading = true;
  try {
    const status = await api('/meetcue');
    if (seq !== MC.seq) return;
    MC.status = status;
    if (status.signedIn === false) MC.links = {};
    else if (status.links) MC.links = status.links;
    let list = null;
    if (status.linked) {
      list = await api(`/meetcue/meetings?limit=${MC_PAGE}`);
      // Signed out between the two answers.
      if (mcSignedOut(list)) { status.signedIn = false; status.linked = false; MC.links = {}; list = null; }
    }
    if (seq !== MC.seq) return;
    MC.problem = false;
    MC.meetings = list ? list.meetings || [] : null; MC.more = Boolean(list) && MC.meetings.length >= MC_PAGE;
  } catch (error) {
    if (seq !== MC.seq) return;
    // The link was taken away on the other side: that is "not connected", not a failure.
    if (error.status === 404 && error.data?.error === 'not_linked') { MC.status = { ...(MC.status || {}), available:true, signedIn:true, linked:false }; MC.meetings = null; MC.problem = false; }
    else MC.problem = true;
  }
  MC.loading = false;
  mcRedraw();
  if (typeof refreshDesk === 'function' && !S.shelfPage && !S.newPage && S.route.view === 'home') refreshDesk();
}
async function refreshMcLinks() {
  try {
    const answer = await api('/meetcue/links');
    if (answer?.links) MC.links = answer.links;
    const at = mcAt();
    if (at?.id && MC.one[at.id]?.data) MC.one[at.id].data.links = MC.links[at.id] || [];
    mcRedraw();
  } catch { /* Non-fatal. */ }
}
ACT['meetcue-retry'] = () => { const at = mcAt(); if (at?.id) loadMeeting(at.id); else { MC.problem = false; MC.meetings = null; loadMeetcue(); } mcRedraw(); };
ACT['meetcue-more'] = async el => {
  const last = MC.meetings?.[MC.meetings.length - 1]; if (!last) return;
  el.disabled = true;
  try {
    const next = (await api(`/meetcue/meetings?${new URLSearchParams({ limit:MC_PAGE, before:last.started_at })}`)).meetings || [], known = new Set(MC.meetings.map(m => m.id));
    MC.meetings.push(...next.filter(m => !known.has(m.id))); MC.more = next.length >= MC_PAGE;
    mcRedraw();
  } catch (error) { el.disabled = false; toast(mcSay(error)); }
};
// Which of the page's states is showing: out (not signed in), off (not connected), on, wait, or problem.
function mcState() {
  const s = MC.status, account = S.cloudAccount;
  if (MC.problem) return account && !account.signedIn ? 'out' : 'problem';
  if (!s) return account?.signedIn ? 'wait' : 'out';
  if (s.signedIn === false) return 'out';
  return s.linked ? 'on' : 'off';
}

// ---------- Cross-project links ----------
function mcLinksFor(id) {
  const fromOne = mcAt()?.id === id ? MC.one[id]?.data?.links : null;
  const list = Array.isArray(fromOne) ? fromOne : (MC.links?.[id] || []);
  return list.map(link => {
    const p = summaryOf(link.projectId);
    if (!p) return link;
    if (p.archived || p.missing) return null;
    return { ...link, projectName:p.name || link.projectName, color:p.color || link.color };
  }).filter(Boolean);
}
function mcRememberLink(id, entry) {
  const cur = Array.isArray(MC.links?.[id]) ? MC.links[id] : [];
  const rest = cur.filter(x => !(x.projectId === entry.projectId && x.slug === entry.slug));
  MC.links = { ...(MC.links || {}), [id]:[entry, ...rest] };
}
function mcLinkChips(links, { detail = false } = {}) {
  if (!links.length) return '';
  return `<div class="mc-links">${links.map(x => {
    const step = !x.ownLine && x.step ? ` data-step="${esc(x.step)}"` : '';
    const dot = x.color ? `<i class="mc-proj-dot" style="--pc:${esc(x.color)}" aria-hidden="true"></i>` : '';
    const inner = detail
      ? `${dot}<span class="mc-link-proj">${esc(x.projectName)}</span><span class="mc-link-sep" aria-hidden="true">·</span><span class="mc-link-line">${esc(x.title)}</span><small class="mc-link-kind">${x.ownLine ? 'Meeting line' : 'On line'}</small>`
      : `${dot}<span>${esc(x.projectName)}${x.title ? ` · ${esc(x.title)}` : ''}</span>`;
    return `<button type="button" class="mc-link-chip" data-act="meetcue-open-line" data-p="${esc(x.projectId)}" data-slug="${esc(x.slug)}"${step} title="Open in ${esc(x.projectName)}: ${esc(x.title)}">${inner}</button>`;
  }).join('')}</div>`;
}

// ---------- The MeetCue page ----------
function mcRowHTML(m) {
  const isEx = Boolean(m.example || mcIsExample(m.id));
  const desc = m.gist ? `<span class="mc-row-gist">${esc(m.gist)}</span>` : '';
  return `<div class="shelf-row mc-row ${isEx ? 'is-example' : ''}"><div class="mc-row-main"><button type="button" class="shelf-open" data-act="open-meeting" data-m="${esc(m.id)}"><span class="shelf-text"><strong>${esc(m.title || 'Meeting')}${isEx ? '<span class="mc-ex-tag">Example</span>' : ''}</strong>${desc}<small>${esc(mcFacts(m))}</small></span></button>${mcLinkChips(mcLinksFor(m.id))}</div>${mcAddBtn(m.id)}</div>`;
}
function mcExamplesSectionHTML(heading = 'Try MeetCue with example meetings', subtitle = 'Open a sample meeting to explore the full map, topic diagrams, minutes and action items — or add it to any project.') {
  return `<section class="mc-examples" aria-labelledby="mcExamplesTitle"><div class="mc-examples-head"><h2 id="mcExamplesTitle">${esc(heading)}</h2><p>${esc(subtitle)}</p></div><div class="shelf-list mc-list">${MC_EXAMPLES.map(mcRowHTML).join('')}</div></section>`;
}
function mcConnectHTML(state) {
  // A Cloud that has no MeetCue link set up can only point at the app.
  const button = state === 'out' ? `<button type="button" class="btn primary" data-act="meetcue-sign-in">Sign in to connect</button>`
    : MC.status?.available === false ? '' : `<button type="button" class="btn primary" data-act="meetcue-connect">Connect MeetCue</button>`;
  return `<div class="page mc-page mc-connect-page"><section class="mc-connect" aria-labelledby="mcConnectTitle">
    <div class="mc-connect-hero">
      ${mcGlyph(60)}
      <span class="mc-eyebrow">PenEcho MeetCue · by PenEcho</span>
      <h1 id="mcConnectTitle">See your meeting as a live map.</h1>
      <p class="mc-lead"><strong>MeetCue</strong> is PenEcho&apos;s AI meeting copilot for iPhone, iPad and Android. It maps topics, people and decisions as people talk, suggests what to ask next, checks your project files in real time, and writes minutes ready for PenEcho Lines.</p>
      <div class="mc-connect-cta">
        ${button}
        <a class="btn ghost-b" href="${MC_APP}" target="_blank" rel="noopener">Get on the App Store</a>
        <a class="btn ghost-b" href="${MC_PLAY}" target="_blank" rel="noopener">Get on Google Play</a>
      </div>
      ${mcSiteLink('Learn more about PenEcho MeetCue')}
    </div>
    <ul class="mc-features" aria-label="What PenEcho MeetCue does">
      <li>${ic('check', 16)}<div><strong>Live meeting map &amp; diagrams</strong><span>Topics, people, decisions and topic diagrams built as you talk, viewable here and editable on PenEcho Canvas.</span></div></li>
      <li>${ic('check', 16)}<div><strong>Real-time cues &amp; your project files</strong><span>Suggestions for what to ask next, grounded in the PenEcho project memory and lines you send to MeetCue.</span></div></li>
      <li>${ic('check', 16)}<div><strong>Minutes, Asks &amp; shared PenEcho credits</strong><span>Turn any meeting into a line where action items become Asks, using your existing PenEcho credits.</span></div></li>
    </ul>
    <ol class="mc-steps" aria-label="How to connect">
      <li><strong>1. Get MeetCue</strong><span>Install PenEcho MeetCue on iPhone, iPad or Android and record a meeting.</span></li>
      <li><strong>2. Connect your account</strong><span>${state === 'out' ? 'Sign in to PenEcho Cloud, then link your MeetCue account in one step.' : 'Click Connect MeetCue above to link your MeetCue account to PenEcho.'}</span></li>
      <li><strong>3. Bring meetings to work</strong><span>Read minutes and diagrams here, or add any meeting directly to a project line.</span></li>
    </ol>
  </section>${mcExamplesSectionHTML()}</div>`;
}
const mcProblemHTML = words => `<p class="mc-line" role="status">${esc(words)}<button type="button" class="btn sm" data-act="meetcue-retry">Try again</button></p>`;
function mcAddBtn(id, { primary = false } = {}) {
  return `<button type="button" class="btn ${primary ? 'primary' : 'sm'} mc-add" data-act="meetcue-add" data-m="${esc(id)}" aria-haspopup="menu">${ic('files', 14)}<span>Add to project</span>${ic('down', 13)}</button>`;
}
function meetcueHTML() {
  const state = mcState();
  if (state === 'out' || state === 'off') return mcConnectHTML(state);
  const list = MC.meetings || [];
  const whoObj = MC.status?.link?.meetcueUser || {}, who = whoObj.email || whoObj.name || '';
  const body = state === 'problem' ? mcProblemHTML('MeetCue is not answering.')
    : state === 'wait' || !MC.meetings ? '<p class="mc-line" role="status">Getting your meetings…</p>'
    : !list.length ? `<p class="mc-line">No meetings recorded yet.</p>${mcExamplesSectionHTML('Explore with example meetings', 'Try an example below to see how MeetCue maps, minutes and project links work.')}`
    : `<div class="shelf-list mc-list">${list.map(mcRowHTML).join('')}</div>${MC.more ? '<button type="button" class="btn sm mc-more" data-act="meetcue-more">More</button>' : ''}`;
  const unlinkBtn = state === 'on' ? '<button type="button" class="btn sm mc-disconnect" data-act="meetcue-disconnect">Disconnect</button>' : '';
  return `<div class="page shelf-page mc-page"><div class="mc-head"><h1>${mcGlyph(26)}MeetCue</h1><div class="mc-head-acts">${who ? `<span class="mc-who" title="${esc(who)}">${esc(who)}</span>` : ''}${mcSiteLink()}${unlinkBtn}</div></div>${body}</div>`;
}
// Signing in is the rail's own action; the page then reads the meetings by itself.
ACT['meetcue-sign-in'] = () => cloudSignIn(ok => { if (ok) toast(`Signed in as ${S.cloudAccount.name}`); }).catch(error => toast(error.message));
// Connecting happens on penecho.ai. The page keeps looking for a while, and notices when it is done.
ACT['meetcue-connect'] = async () => {
  const origin = S.cloudAccount?.origin || (await loadCloudAccount())?.origin;
  if (!origin) { toast('PenEcho Cloud is not answering.'); return; }
  window.open(`${origin}/dashboard.html#meetcue`, '_blank', 'noopener');
  const started = Date.now();
  clearInterval(MC.watch);
  MC.watch = setInterval(async () => {
    if (Date.now() - started > 5 * 60 * 1000 || !mcAt() || MC.status?.linked) { clearInterval(MC.watch); return; }
    if (document.hidden) return;
    try { if ((await api('/meetcue')).linked) { clearInterval(MC.watch); toast('MeetCue is connected'); if (MC.back) mcBackToBox(); else loadMeetcue(); } } catch { /* The next look may answer. */ }
  }, 4000);
};
// Disconnect MeetCue from this PenEcho account; existing meeting lines keep their saved copies.
ACT['meetcue-disconnect'] = el => {
  const whoObj = MC.status?.link?.meetcueUser || {}, who = whoObj.email || whoObj.name || 'your MeetCue account';
  const dialog = document.createElement('dialog');
  dialog.className = 'line-command-dialog';
  dialog.setAttribute('aria-labelledby', 'meetcueDisconnectTitle');
  dialog.innerHTML = `<form><h2 id="meetcueDisconnectTitle">Disconnect MeetCue?</h2><p>Disconnect <strong>${esc(who)}</strong> from PenEcho? Meetings already added to your project lines stay where they are. You can reconnect any time.</p><p class="command-error" role="alert" hidden></p><footer><button type="button" class="btn" data-cancel>Cancel</button><button type="submit" class="btn danger">Disconnect</button></footer></form>`;
  document.body.append(dialog);
  dialog.addEventListener('close', () => { dialog.remove(); if (el?.isConnected) el.focus(); });
  $('[data-cancel]', dialog).onclick = () => dialog.close();
  $('form', dialog).onsubmit = async e => {
    e.preventDefault(); const submit = $('button[type="submit"]', dialog); submit.disabled = true;
    try {
      let res = null;
      try { res = await api('/meetcue/link', { method:'DELETE' }); }
      catch (error) { if (!(error.status === 404 && error.data?.error === 'not_linked')) throw error; }
      dialog.close();
      clearInterval(MC.watch);
      MC.status = { ...(MC.status || {}), available:true, signedIn:true, linked:false, link:null };
      MC.meetings = null; MC.more = false; MC.one = {}; MC.problem = false;
      mcRedraw();
      if (typeof refreshDesk === 'function' && !S.shelfPage && !S.newPage && S.route.view === 'home') refreshDesk();
      toast(res?.meetcueNotified === false ? 'Disconnected from PenEcho (MeetCue will sync next time it connects)' : 'MeetCue disconnected');
    } catch (error) { const message = $('.command-error', dialog); message.hidden = false; message.textContent = mcSay(error); submit.disabled = false; }
  };
  dialog.showModal();
};

// ---------- Meeting notes in the box ("Add meeting notes from MeetCue") & adding a meeting node on a line ----------
const MC_PICK = 8;
ACT['cmp-meeting'] = el => mcPickMeeting(el.closest('.composer')?.dataset.comp);
ACT['cmp-meeting-node'] = el => { const p = project(), l = lineById(p, S.route.line), key = el.closest('.composer')?.dataset.comp; if (p && l) mcPickMeetingNode(el, p, l, key); };
ACT['line-meeting'] = el => { const p = project(), l = lineById(p, S.route.line); if (p && l) mcPickMeetingNode(el, p, l); };

async function mcPickMeeting(key) {
  if (!key) return;
  // Asked again unless connected: it may have been connected since, in another tab.
  if (mcState() !== 'on' || !MC.meetings) await loadMeetcue();
  const state = mcState();
  if (state === 'problem') { toast('MeetCue is not answering.'); return; }
  // The page may have been drawn again while MeetCue answered.
  const anchor = $(`.composer[data-comp="${key}"] .cmp-plus`); if (!anchor) return;
  const realList = state === 'on' ? (MC.meetings || []).slice(0, MC_PICK) : [];
  const usingExamples = !realList.length;
  const list = usingExamples ? MC_EXAMPLES : realList;
  const connectAction = state !== 'on'
    ? [{ label:state === 'out' ? 'Sign in to connect MeetCue' : 'Connect MeetCue…', icon:'meetcue', fn:() => mcLinkFirst({ kind:'notes', hash:location.hash, key }, state) }]
    : [];
  openMenu(anchor, [
    { head:usingExamples ? 'MeetCue · Example meetings' : 'MeetCue' },
    ...list.map(m => ({
      label:m.title || 'Meeting', icon:'meetcue',
      note:m.minutes_ready === false ? 'No minutes yet' : [usingExamples ? 'Example' : mcWhen(m.started_at), mcLong(m.duration_ms)].filter(Boolean).join(' · '),
      disabled:m.minutes_ready === false,
      fn:() => mcNotesIntoBox(key, m),
    })),
    { sep:true },
    ...connectAction,
    { label:'All meetings', icon:'meetcue', fn:mcAllMeetings },
  ]);
}
async function mcPickMeetingNode(anchor, p, l, key = '') {
  if (!p || !l) return;
  if (mcState() !== 'on' || !MC.meetings) await loadMeetcue();
  const state = mcState();
  if (state === 'problem') { toast('MeetCue is not answering.'); return; }
  const liveAnchor = anchor?.isConnected ? anchor : (key ? $(`.composer[data-comp="${key}"] .cmp-plus`) : $('[data-act="line-meeting"]')) || $('[data-act="line-meeting"]');
  const liveLine = lineById(project(p.id), l.slug) || l;
  if (!liveAnchor) return;
  const onLine = new Set((liveLine.stations || []).filter(s => s.kind === 'meeting' && s.meetingId).map(s => s.meetingId));
  const realList = state === 'on' ? (MC.meetings || []).slice(0, MC_PICK) : [];
  const usingExamples = !realList.length;
  const list = usingExamples ? MC_EXAMPLES : realList;
  const connectAction = state !== 'on'
    ? [{ label:state === 'out' ? 'Sign in to connect MeetCue' : 'Connect MeetCue…', icon:'meetcue', fn:() => mcLinkFirst({ kind:'node', hash:location.hash, projectId:p.id, lineSlug:l.slug, key }, state) }]
    : [];
  openMenu(liveAnchor, [
    { head:usingExamples ? 'Add example meeting to this line' : 'Add meeting to this line' },
    ...list.map(m => ({
      label:m.title || 'Meeting', icon:'meetcue', on:onLine.has(m.id),
      note:m.minutes_ready === false ? 'No minutes yet' : [usingExamples ? 'Example' : mcWhen(m.started_at), mcLong(m.duration_ms), onLine.has(m.id) ? 'On this line' : ''].filter(Boolean).join(' · '),
      disabled:m.minutes_ready === false,
      fn:() => mcAddNodeToLine(p, liveLine, m),
    })),
    { sep:true },
    ...connectAction,
    { label:'All meetings', icon:'meetcue', fn:mcAllMeetings },
  ]);
}
// Every meeting, and connecting MeetCue: on penecho.ai, the dashboard's own MeetCue page (hosted.js).
function mcAllMeetings() { if (typeof HOSTED !== 'undefined' && HOSTED) hostedGo('/dashboard.html#meetcue'); else location.hash = 'meetcue'; }
function mcLinkFirst(back, state) {
  if (typeof HOSTED !== 'undefined' && HOSTED) { if (state === 'off' && MC.status?.available !== false) hostedGo('/dashboard.html#meetcue'); else toast('MeetCue is not available right now.'); return; }
  MC.back = back;
  location.hash = 'meetcue';
  if (state === 'off' && MC.status?.available !== false) ACT['meetcue-connect']();
}
// Connected: back where you were, with the meetings to choose from.
async function mcBackToBox() {
  const back = MC.back; MC.back = null;
  if (!back) return;
  location.hash = back.hash;
  if (back.kind === 'node') {
    const sel = back.key ? `.composer[data-comp="${back.key}"] .cmp-plus` : '[data-act="line-meeting"]';
    for (let i = 0; i < 40 && !$(sel); i++) await new Promise(resolve => { setTimeout(resolve, 75); });
    const p = project(back.projectId), l = p && lineById(p, back.lineSlug), el = $(sel);
    if (p && l && el) mcPickMeetingNode(el, p, l, back.key);
    return;
  }
  for (let i = 0; i < 40 && !$(`.composer[data-comp="${back.key}"] .cmp-plus`); i++) await new Promise(resolve => { setTimeout(resolve, 75); });
  mcPickMeeting(back.key);
}
async function mcAddNodeToLine(p, l, m) {
  const cur = lineById(project(p.id), l.slug) || l;
  const existing = (cur.stations || []).find(s => s.kind === 'meeting' && s.meetingId === m.id);
  if (existing) { pickStep(cur, existing); return; }
  try {
    const made = await api(`${pathFor(p.id)}/meetings`, { method:'POST', body:{ meetingId:m.id, topic:cur.slug } });
    mcRememberLink(m.id, { projectId:p.id, projectName:p.name, color:p.color || '', slug:made.slug, title:cur.title, status:cur.status, ownLine:false, step:made.step || '', updatedAt:Date.now() });
    await loadState(p.id, { force:true });
    const updated = lineById(project(p.id), made.slug || cur.slug);
    if (updated) {
      refreshLine();
      const step = (made.step && stationById(updated, made.step)) || updated.stations.find(s => s.kind === 'meeting' && s.meetingId === m.id);
      if (step) pickStep(updated, step);
    }
    toast(made.existed ? 'Already on this line' : 'Meeting added');
    refreshMcLinks();
  } catch (error) { toast(mcSay(error)); }
}
async function mcNotesIntoBox(key, m) {
  const c = comp(key), form = () => $(`.composer[data-comp="${key}"]`);
  if (c.files.some(f => f.meeting === m.id)) { focusBox(form()); return; }
  try {
    const answer = MC.one[m.id]?.data || await api(`/meetcue/meetings/${encodeURIComponent(m.id)}`);
    if (!answer.meeting) { toast('Sign in to PenEcho Cloud to use MeetCue.'); return; }
    MC.one[m.id] = { data:answer };
    const meeting = answer.meeting, title = meeting.title || m.title || 'Meeting', md = String(answer.markdown || '').trim();
    if (!md) { toast('This meeting has no minutes yet.'); return; }
    // When it was and how long, under the title, so the agent knows.
    const day = new Date(meeting.started_at), facts = [Number.isNaN(day.getTime()) ? '' : day.toLocaleString(undefined, { dateStyle:'long', timeStyle:'short' }), mcLong(meeting.duration_ms)].filter(Boolean).join(' · ');
    const heading = /^# [^\n]*/.exec(md)?.[0] || `# ${title}`, rest = md.replace(/^# [^\n]*\n*/, '');
    const name = `${title.replace(/[\\/:*?"<>|#%\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Meeting'}.md`;
    await addFiles(key, [new File([`${heading}\n\n${facts ? `${facts}\n\n` : ''}${rest}\n`], name, { type:'text/markdown' })]);
    const added = c.files[c.files.length - 1]; if (added?.name === name) added.meeting = m.id;
    focusBox(form());
  } catch (error) { toast(error.status === 404 ? 'This meeting is not in MeetCue any more.' : mcSay(error)); }
}

// ---------- One meeting ----------
async function loadMeeting(id) {
  const one = MC.one[id] ||= {};
  one.loading = true; one.problem = '';
  try {
    const answer = await api(`/meetcue/meetings/${encodeURIComponent(id)}`);
    // Signed out: the MeetCue page says what to do.
    if (!answer.meeting) { delete MC.one[id]; if (mcAt()?.id === id) location.replace('#meetcue'); return; }
    if (Array.isArray(answer.links)) MC.links = { ...(MC.links || {}), [id]:answer.links };
    one.data = answer;
  } catch (error) { one.problem = error.status === 404 ? 'gone' : 'down'; }
  one.loading = false;
  if (mcAt()?.id === id) render();
}
// The minutes carry their own title, which the page already shows; and nothing in them may point at a file here.
function mcMinutes(markdown) {
  const md = String(markdown || '').replace(/^\s*# [^\n]*\n+/, '').replace(/!\[([^\]]*)\]\((?!https?:)[^)]*\)/g, '$1').replace(/\[([^\]]+)\]\((?!https?:)[^)]*\)/g, '$1').trim();
  // The renderer the line page uses for a Work's detail.
  return md ? `<div class="mc-minutes viewer-doc">${renderMd(md, { id:'', files:[], pictures:[], lines:[], landed:[], backlog:[], notes:[] }, { compact:true, status:false })}</div>` : '<p class="mc-line">No minutes yet.</p>';
}
function mcActionsHTML(actions, markdown = '') {
  if (/(?:^|\n)#{1,6}\s+Actions\b/i.test(String(markdown || ''))) return '';
  const list = Array.isArray(actions) ? actions.filter(a => a && (a.task || a.owner || a.due)) : [];
  if (!list.length) return '';
  return `<section class="lpp-mc-actions" aria-label="Action items"><h3>Actions</h3><ul>${list.map(a => {
    const meta = [a.owner ? String(a.owner).trim() : '', a.due ? `by ${String(a.due).trim()}` : ''].filter(Boolean).join(', ');
    return `<li><span>${esc(a.task || 'Follow up')}</span>${meta ? `<small>${esc(meta)}</small>` : ''}</li>`;
  }).join('')}</ul></section>`;
}
// Extract a clean opening overview paragraph when meeting.gist is empty so the detail page always shows a description at the top.
function mcMeetingDescription(meeting, markdown = '') {
  const gist = String(meeting?.gist || '').trim();
  if (gist) return gist;
  const cleaned = String(markdown || '').replace(/^\s*# [^\n]*\n+/, '').trim();
  if (!cleaned) return '';
  for (const para of cleaned.split(/\n\s*\n/)) {
    const trimmed = para.trim();
    if (!trimmed || /^#{1,6}\s|^[-*+]\s|^\d+\.\s|^\|/.test(trimmed)) continue;
    const plain = trimmed.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
    if (plain) return plain.length > 320 ? `${plain.slice(0, 319)}…` : plain;
  }
  return '';
}

// MeetCue map rendering powered by public/lines/meetcue-map.js (MeetCue's exact dagre layout, Lucide glyphs, and SVG styling).
function mcWholeMapFrom(data) {
  const MM = typeof MeetCueMap !== 'undefined' ? MeetCueMap : null;
  if (!MM) return null;
  return MM.normalizeMapPayload(data);
}

function mcTopicListFrom(data) {
  const MM = typeof MeetCueMap !== 'undefined' ? MeetCueMap : null;
  if (MM && typeof MM.extractTopicDiagrams === 'function') return MM.extractTopicDiagrams(data);
  if (Array.isArray(data?.diagrams) && data.diagrams.length) {
    return data.diagrams.filter(d => d && (
      (Array.isArray(d.nodes) && d.nodes.some(n => n && String(n.label || '').trim()))
      || (Array.isArray(d.sofar) && d.sofar.some(x => String(x || '').trim()))
      || (Array.isArray(d.ahead) && d.ahead.some(x => String(x || '').trim()))
    ));
  }
  return [];
}

function mcWholeCardHTML(map, idx) {
  const MM = typeof MeetCueMap !== 'undefined' ? MeetCueMap : null;
  if (!MM || !map) return '';
  const { html } = MM.renderMapSvg(map, { uid: `mc-${idx}`, isWhole: true, interactive: true });
  if (!html) return '';
  const nodeCount = (map.nodes || []).length;
  const topicCount = (map.topics || []).length;
  const parts = ['Full map'];
  if (topicCount) parts.push(`${topicCount} ${topicCount === 1 ? 'topic' : 'topics'}`);
  if (nodeCount) parts.push(`${nodeCount} ${nodeCount === 1 ? 'node' : 'nodes'}`);
  const badge = `<span class="mc-diagram-status is-whole">${esc(parts.join(' · '))}</span>`;
  return `<div class="mc-diagram-card is-whole"><div class="mc-diagram-head"><strong>Full meeting map</strong>${badge}</div>${html}</div>`;
}

function mcTopicCardHTML(d, topicIndex, idx) {
  const MM = typeof MeetCueMap !== 'undefined' ? MeetCueMap : null;
  if (!MM || !d) return '';
  const singleMap = MM.normalizeTopicDiagram(d, topicIndex);
  if (!singleMap) return '';
  const { html } = MM.renderMapSvg(singleMap, { uid: `mc-${idx}`, columns: true, isWhole: false, interactive: true });
  if (!html) return '';
  const status = String(d.status || '').trim();
  const badge = status ? `<span class="mc-diagram-status">${esc(status)}</span>` : '';
  return `<div class="mc-diagram-card"><div class="mc-diagram-head"><strong>${esc(d.topic || d.label || 'Topic')}</strong>${badge}</div>${html}</div>`;
}

ACT['meetcue-diagram-view'] = el => {
  const next = el.dataset.view;
  if (!['all', 'whole', 'topics'].includes(next) || MC.diagramView === next) return;
  MC.diagramView = next;
  mcRedraw();
};

function mcDiagramsHTML(input, wholeDiagram = null, opts = {}) {
  // Accept either full meeting payload `one.data` or legacy `(diagrams, wholeDiagram, { showTabs })`.
  let payload, options;
  if (input && !Array.isArray(input) && typeof input === 'object') {
    payload = input;
    options = (wholeDiagram && typeof wholeDiagram === 'object' && !Array.isArray(wholeDiagram) && !('nodes' in wholeDiagram)) ? wholeDiagram : (opts || {});
  } else {
    payload = { diagrams: Array.isArray(input) ? input : [], whole_diagram: wholeDiagram || null };
    options = opts || {};
  }
  const showTabs = options.showTabs !== false;
  const validTopics = mcTopicListFrom(payload);
  const wholeMap = mcWholeMapFrom(payload);
  if (!wholeMap && !validTopics.length) return '';
  const hasBoth = Boolean(wholeMap) && validTopics.length > 0;
  const view = showTabs && hasBoth ? (MC.diagramView || 'all') : 'all';
  const tabs = showTabs && hasBoth
    ? `<div class="mc-seg" role="tablist" aria-label="Diagram view">
        <button type="button" role="tab" aria-selected="${view === 'all'}" class="${view === 'all' ? 'on' : ''}" data-act="meetcue-diagram-view" data-view="all">All</button>
        <button type="button" role="tab" aria-selected="${view === 'whole'}" class="${view === 'whole' ? 'on' : ''}" data-act="meetcue-diagram-view" data-view="whole">Whole map</button>
        <button type="button" role="tab" aria-selected="${view === 'topics'}" class="${view === 'topics' ? 'on' : ''}" data-act="meetcue-diagram-view" data-view="topics">By topic (${validTopics.length})</button>
      </div>`
    : '';
  const cards = [];
  if (wholeMap && (view === 'all' || view === 'whole')) cards.push(mcWholeCardHTML(wholeMap, 'whole'));
  if (validTopics.length && (view === 'all' || view === 'topics')) {
    const topicCards = validTopics.map((d, idx) => mcTopicCardHTML(d, idx, `t${idx}`));
    if (view === 'all' && wholeMap) {
      cards.push(`<div class="mc-topics-subhead">Topic breakdown (${validTopics.length})</div><div class="mc-diagram-list">${topicCards.join('')}</div>`);
    } else {
      cards.push(`<div class="mc-diagram-list">${topicCards.join('')}</div>`);
    }
  }
  return `<section class="mc-diagrams" aria-label="Meeting diagrams"><div class="mc-diagrams-bar"><h2>Meeting maps</h2>${tabs}</div>${cards.join('')}</section>`;
}
function mcDetailActionsHTML(actions) {
  const list = Array.isArray(actions) ? actions.filter(a => a && (a.task || a.owner || a.due)) : [];
  if (!list.length) return '';
  return `<aside class="mc-actions-card" aria-label="Action items"><div class="mc-card-head"><h2>Action items</h2><span class="mc-count-pill">${list.length}</span></div><ul class="mc-action-list">${list.map(a => {
    const owner = a.owner ? `<span class="mc-act-pill">${esc(String(a.owner).trim())}</span>` : '';
    const due = a.due ? `<span class="mc-act-pill is-due">Due ${esc(String(a.due).trim())}</span>` : '';
    return `<li><span class="mc-act-dot" aria-hidden="true"></span><div><p>${esc(a.task || 'Follow up')}</p>${owner || due ? `<div class="mc-act-meta">${owner}${due}</div>` : ''}</div></li>`;
  }).join('')}</ul></aside>`;
}
function meetingHTML(id) {
  const one = MC.one[id] || {}, m = one.data?.meeting || mcFindMeeting(id);
  const isEx = Boolean(m?.example || mcIsExample(id));
  const back = `<button type="button" class="ghost mc-back" data-act="open-meetcue">${ic('left', 16)}MeetCue</button>`;
  const links = mcLinksFor(id);
  const desc = one.data ? mcMeetingDescription(m, one.data.markdown) : String(m?.gist || '').trim();
  const topicCount = one.data ? mcTopicListFrom(one.data).length : 0;
  const factsParts = [
    m ? mcWhen(m.started_at) : '',
    m ? mcLong(m.duration_ms) : '',
    (one.data?.actions?.length ?? m?.action_count) ? `${one.data?.actions?.length ?? m?.action_count} ${(one.data?.actions?.length ?? m?.action_count) === 1 ? 'action' : 'actions'}` : '',
    topicCount ? `${topicCount} ${topicCount === 1 ? 'topic map' : 'topic maps'}` : '',
  ].filter(Boolean);
  const heroLinks = one.data || links.length
    ? `<div class="mc-hero-links"><span class="mc-hero-links-label">${links.length ? 'Linked lines' : 'Not linked yet'}</span>${links.length ? mcLinkChips(links, { detail:true }) : '<span class="mc-linked-empty">Use <strong>Add to project</strong> to turn this meeting into a line, or pick it from the input box.</span>'}</div>`
    : '';
  const hero = m ? `<header class="mc-hero">
    <div class="mc-hero-top">
      <span class="mc-hero-brand">${mcGlyph(18)}<span>${isEx ? 'Example meeting' : 'PenEcho MeetCue'}</span></span>
      ${factsParts.length ? `<span class="mc-facts">${esc(factsParts.join(' · '))}</span>` : ''}
    </div>
    <h1>${esc(m.title || 'Meeting')}</h1>
    ${desc ? `<p class="mc-hero-desc">${esc(desc)}</p>` : ''}
    ${heroLinks}
  </header>` : '';

  let body;
  if (one.data) {
    const diagramsBlock = mcDiagramsHTML(one.data);
    const actionsCard = mcDetailActionsHTML(one.data.actions);
    const minutesInner = mcMinutes(one.data.markdown);
    const minutesCard = `<section class="mc-minutes-card" aria-label="Meeting minutes"><div class="mc-card-head"><h2>Minutes</h2></div>${minutesInner}</section>`;
    body = `${diagramsBlock}<div class="mc-detail-grid ${actionsCard ? 'has-actions' : ''}">${minutesCard}${actionsCard}</div>`;
  } else if (one.problem === 'gone') {
    body = '<p class="mc-line">This meeting is not in MeetCue any more.</p>';
  } else if (one.problem) {
    body = mcProblemHTML('MeetCue is not answering.');
  } else {
    body = '<p class="mc-line" role="status">Getting the minutes…</p>';
  }

  const rightActs = one.data
    ? `<span class="mc-acts">${mcAddBtn(id, { primary:true })}${isEx ? '' : `<button type="button" class="icon-btn mc-delete" data-act="meetcue-delete" data-m="${esc(id)}" aria-label="Delete this meeting" title="Delete">${ic('trash', 17)}</button>`}</span>`
    : '';
  return `<div class="page mc-page mc-meeting"><div class="mc-bar">${back}${rightActs}</div><article class="mc-sheet">${hero}${body}</article></div>`;
}
// Deleting here deletes the meeting in MeetCue, so it asks first. A line made from it keeps its copy of the minutes.
ACT['meetcue-delete'] = el => {
  const id = el.dataset.m, m = MC.one[id]?.data?.meeting || {};
  const dialog = document.createElement('dialog');
  dialog.className = 'line-command-dialog';
  dialog.setAttribute('aria-labelledby', 'meetingDeleteTitle');
  dialog.innerHTML = `<form><h2 id="meetingDeleteTitle">Delete meeting?</h2><p><strong>${esc(m.title || 'This meeting')}</strong> will be deleted in MeetCue, with its recording and photos. This cannot be undone.</p><p class="command-error" role="alert" hidden></p><footer><button type="button" class="btn" data-cancel>Cancel</button><button type="submit" class="btn danger">Delete meeting</button></footer></form>`;
  document.body.append(dialog);
  dialog.addEventListener('close', () => { dialog.remove(); if (el.isConnected) el.focus(); });
  $('[data-cancel]', dialog).onclick = () => dialog.close();
  $('form', dialog).onsubmit = async e => {
    e.preventDefault(); const submit = $('button[type="submit"]', dialog); submit.disabled = true;
    try {
      await api(`/meetcue/meetings/${encodeURIComponent(id)}`, { method:'DELETE' });
      dialog.close();
      delete MC.one[id];
      if (MC.meetings) MC.meetings = MC.meetings.filter(x => x.id !== id);
      location.hash = 'meetcue';
      toast('Meeting deleted');
    } catch (error) { const message = $('.command-error', dialog); message.hidden = false; message.textContent = mcSay(error); submit.disabled = false; }
  };
  dialog.showModal();
};

// ---------- Add to project: the meeting becomes a line, its actions Asks that are not sent ----------
// A project opens where it was left, so the line is left there first.
function mcOpenLine(projectId, slug, step = '') {
  (S.routes ||= Object.create(null))[projectId] = step ? { view:'line', line:slug, step } : { view:'line', line:slug };
  return switchProject(projectId, { fresh:true });
}
ACT['meetcue-add'] = el => {
  const id = el.dataset.m, g = railGroups(), listed = new Set([...g.pinned, ...g.recent]);
  const projects = [...g.pinned, ...g.recent, ...S.projects.filter(p => !p.archived && !p.myCanvases && !listed.has(p)).sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0))].filter(p => !p.missing);
  if (!projects.length) { openMenu(el, [{ label:'New project', icon:'plus', fn:() => ACT['new-project']() }], { align:'right' }); return; }
  const byProject = new Map(mcLinksFor(id).map(x => [x.projectId, x]));
  openMenu(el, [{ head:'Add as a line in' }, ...projects.map(p => {
    const linked = byProject.get(p.id);
    return {
      label:p.name, icon:'files', on:Boolean(linked?.ownLine),
      ...(linked ? { note:linked.ownLine ? `On line: ${linked.title}` : `Node on: ${linked.title}` } : {}),
      fn:async () => {
        try {
          const made = await api(`${pathFor(p.id)}/meetings`, { method:'POST', body:{ meetingId:id } });
          const title = MC.one[id]?.data?.meeting?.title || mcFindMeeting(id)?.title || made.slug;
          mcRememberLink(id, { projectId:p.id, projectName:p.name, color:p.color || '', slug:made.slug, title, status:'waiting', ownLine:true, step:'', updatedAt:Date.now() });
          await mcOpenLine(p.id, made.slug);
          if (!made.existed) toast(`Added to ${p.name}`);
          refreshMcLinks();
        } catch (error) { toast(mcSay(error)); }
      },
    };
  })], { align:'right' });
};
ACT['meetcue-open-line'] = async el => {
  const p = el.dataset.p, slug = el.dataset.slug, step = el.dataset.step || '';
  if (!p || !slug) return;
  try {
    await loadState(p, { force:true });
    if (lineById(project(p), slug)) { await mcOpenLine(p, slug, step); return; }
  } catch { /* The project is gone too. */ }
  refreshMcLinks();
  toast('That line is gone.');
};

// ---------- The meeting step in a line's thread & its detail panel ----------
// The step's words are the meeting's title line (title, when, how long), then its gist.
function meetingParts(s) {
  const [head = '', ...rest] = String(s.text || '').split(/\n\s*\n/), m = /^\*\*(.+?)\*\*(?:\s*·\s*(.*))?$/.exec(head.trim());
  return { title:m ? m[1] : plainOut(head.trim()) || 'Meeting', facts:m ? (m[2] || '').split(/\s*·\s*/).filter(Boolean).map(x => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(x) ? nodeWhen(x) : x) : [], gist:rest.join('\n\n').trim() };
}
// MeetCue's diagrams, drawn by PenEcho when the meeting was added: each opens as a Canvas, as an agent's picture does.
function meetingPics(p, l, s) {
  const pics = (s.pictures || []).filter(pic => fileEntry(p, pic.path));
  return pics.length ? `<div class="lp-pics lp-pics-big lp-mc-pics">${pics.map(pic => { const c = canvasByPath(p, pic.path); return bigPic(p, pic.path, pic.title || 'Diagram', c && !l.closed ? `<button type="button" class="btn sm line-pic-edit" data-act="open-canvas" data-canvas="${esc(c.source)}" data-doc="${esc(l.topicPath)}" title="Edit on canvas">${ic('pen', 14)}<span>Edit on canvas</span></button>` : ''); }).join('')}</div>` : '';
}
const meetingWords = s => { const { title, facts } = meetingParts(s); return [title, ...facts].join(' · '); };
function meetingItem(p, l, s) {
  const step = esc(s.id), { title, facts, gist } = meetingParts(s), minutes = (s.files || []).find(f => /\.md$/i.test(f.path) && fileEntry(p, f.path));
  const on = S.lineSel?.id === s.id, line = esc(l.id), mid = s.meetingId || '';
  const openBtn = minutes ? `<button type="button" class="btn sm" data-act="open-doc" data-doc="${esc(minutes.path)}">Open the minutes</button>` : '';
  const cueBtn = mid ? `<button type="button" class="btn sm mc-link-btn" data-act="open-meeting" data-m="${esc(mid)}">${mcGlyph(15)}<span>MeetCue</span>${ic('right', 13)}</button>` : '';
  return `<section class="lp-meeting ${on ? 'on' : ''}" id="item-${step}" data-step="${step}" data-act="line-work" data-line="${line}" tabindex="0" role="button" aria-pressed="${on}" aria-label="Open ${esc(title)}"${typeof fromMark === 'function' ? fromMark(l, s) : ''}>
    <div class="lp-mc-head"><h4><strong>${esc(title)}</strong>${facts.length ? `<span>${esc(facts.join(' · '))}</span>` : ''}</h4><span class="lp-mc-go" aria-hidden="true">${ic('right', 15)}</span></div>
    ${gist ? `<div class="lp-note-words words md-words">${wordsMd(gist, p)}</div>` : ''}
    ${meetingPics(p, l, s)}
    ${openBtn || cueBtn ? `<footer>${openBtn}${cueBtn}</footer>` : ''}
    ${nodeTools(l, s, [l.closed ? '' : nodeTool('line-refer', 'refer', 'Refer to this in the box', s), deleteTool(l, s)])}
  </section>`;
}
function meetingPanelHead(l, s) {
  const { title } = meetingParts(s);
  return `<div class="lpp-title">${mcGlyph(20)}<h2>${esc(title)}</h2><span class="chip c-mc">MeetCue</span></div>
    <div class="lpp-tools">${typeof panelExpandButton === 'function' ? panelExpandButton() : ''}<button type="button" class="icon-btn" data-act="panel-close" aria-label="Close">${ic('x', 18)}</button></div>`;
}
const mcElseHTML = (mid, pid, slug) => {
  const linked = mid ? mcLinksFor(mid).filter(x => !(x.projectId === pid && x.slug === slug)) : [];
  return linked.length ? `<section class="mc-linked-box lpp-mc-else" aria-label="Also linked in"><h3>Also linked in</h3>${mcLinkChips(linked, { detail:true })}</section>` : '';
};
function meetingPanelBody(p, l, s) {
  const { facts, gist } = meetingParts(s), mid = s.meetingId || '', minutes = (s.files || []).find(f => /\.md$/i.test(f.path) && fileEntry(p, f.path));
  const cueBtn = mid ? `<button type="button" class="btn sm mc-link-btn" data-act="open-meeting" data-m="${esc(mid)}">${mcGlyph(15)}<span>Open in MeetCue</span>${ic('right', 13)}</button>` : '';
  const docBtn = minutes ? `<button type="button" class="btn sm" data-act="open-doc" data-doc="${esc(minutes.path)}">${ic('doc', 14)}<span>Open minutes file</span></button>` : '';
  const referBtn = !l.closed ? `<button type="button" class="btn sm" data-act="line-refer" data-line="${esc(l.id)}" data-step="${esc(s.id)}">${ic('refer', 14)}<span>Refer</span></button>` : '';
  return `<div class="lpp-scroll" id="lppScroll"><div class="lpp-mc" id="lppMeeting">
    ${facts.length ? `<p class="mc-facts">${esc(facts.join(' · '))}</p>` : ''}
    ${gist ? `<div class="lpp-mc-gist words md-words" id="lppMeetingGist">${wordsMd(gist, p)}</div>` : ''}
    ${cueBtn || docBtn || referBtn ? `<div class="lpp-mc-acts">${cueBtn}${docBtn}${referBtn}</div>` : ''}
    ${meetingPics(p, l, s)}
    <div id="lppMeetingDiagrams"></div>
    <div id="lppMeetingActions"></div>
    <div id="lppMeetingMinutes"><p class="mc-line" role="status">Getting the minutes…</p></div>
    <div id="lppMeetingElse">${mcElseHTML(mid, p.id, l.slug)}</div>
  </div></div>`;
}
async function fillMeetingPanel(p, l, s) {
  const stillHere = () => S.cur === p.id && S.lineSel?.id === s.id && S.route.view === 'line' && S.route.line === l.id;
  const minutesFile = (s.files || []).find(f => /\.md$/i.test(f.path) && fileEntry(p, f.path));
  const hasSavedPics = (s.pictures || []).some(pic => fileEntry(p, pic.path));
  const mid = s.meetingId || '', { gist } = meetingParts(s);
  let lastMd = '';
  const paintDiagrams = (remote) => {
    if (hasSavedPics || !remote) return;
    const host = $('#lppMeetingDiagrams'); if (!host) return;
    const next = mcDiagramsHTML(remote, { showTabs:false });
    if (host.dataset.h !== next) { window.MeetCueMap?.unmountAll(host); host.dataset.h = next; host.innerHTML = next; window.MeetCueMap?.mountAll(host); }
  };
  const paintMinutes = md => {
    lastMd = md || '';
    const host = $('#lppMeetingMinutes'), gistEl = $('#lppMeetingGist');
    if (gistEl && gist) gistEl.hidden = Boolean(lastMd && lastMd.includes(gist.split('\n')[0]));
    if (!host) return;
    const next = md ? mcMinutes(md) : '<p class="mc-line">No minutes yet.</p>';
    if (host.dataset.h !== next) { host.dataset.h = next; host.innerHTML = next; }
  };
  const paintActions = actions => {
    const host = $('#lppMeetingActions'); if (!host) return;
    const next = mcActionsHTML(actions, lastMd);
    if (host.dataset.h !== next) { host.dataset.h = next; host.innerHTML = next; }
  };
  const paintElse = () => {
    const host = $('#lppMeetingElse'); if (!host) return;
    const next = mcElseHTML(mid, p.id, l.slug);
    if (host.dataset.h !== next) { host.dataset.h = next; host.innerHTML = next; }
  };
  const cachedDoc = minutesFile ? docById(minutesFile.path, p) : null;
  const cachedRemote = mid ? MC.one[mid]?.data : null;
  if (cachedDoc?.md) paintMinutes(cachedDoc.md);
  else if (cachedRemote?.markdown) paintMinutes(cachedRemote.markdown);
  if (cachedRemote?.map || cachedRemote?.diagrams || cachedRemote?.whole_diagram) paintDiagrams(cachedRemote);
  if (cachedRemote?.actions) paintActions(cachedRemote.actions);
  if (minutesFile) {
    loadDoc(p, minutesFile.path).then(doc => {
      if (!stillHere() || !doc?.md) return;
      paintMinutes(doc.md);
      if (cachedRemote?.actions || MC.one[mid]?.data?.actions) paintActions(MC.one[mid]?.data?.actions || cachedRemote?.actions);
    }).catch(() => {
      if (stillHere() && !cachedRemote?.markdown) paintMinutes('');
    });
  }
  if (mid && (mcIsExample(mid) || mcState() === 'on' || !MC.status)) {
    try {
      const data = await api(`/meetcue/meetings/${encodeURIComponent(mid)}`);
      if (data.meeting) MC.one[mid] = { ...(MC.one[mid] || {}), data };
      if (Array.isArray(data.links)) MC.links = { ...(MC.links || {}), [mid]:data.links };
      if (!stillHere()) return;
      if (!minutesFile && !cachedDoc?.md && !lastMd) paintMinutes(data.markdown || '');
      else if (!$('#lppMeetingMinutes .mc-minutes') && data.markdown) paintMinutes(data.markdown);
      if (data.map || data.diagrams || data.whole_diagram) paintDiagrams(data);
      if (data.actions) paintActions(data.actions);
      paintElse();
    } catch {
      if (stillHere() && !minutesFile && !cachedRemote?.markdown) paintMinutes('');
    }
  } else if (!minutesFile && !cachedRemote?.markdown) {
    paintMinutes('');
  }
}

// ---------- Use in MeetCue: the project's memory (or one line you choose), sent to the MeetCue project of the same name ----------
// Only MEMORY.md by itself, never every line: many lines would cost too many tokens in MeetCue's meetings.
const mcLinked = () => Boolean(MC.status?.linked);
async function useInMeetcue(id, files) {
  const s = summaryOf(id); if (!s) return;
  toast(files ? 'Sending this line to MeetCue…' : `Sending ${s.name}'s memory to MeetCue…`);
  try {
    const { sent = [], skipped = [] } = await api(`${pathFor(id)}/meetcue`, { method:'POST', body:files ? { files } : {} });
    const all = [...sent, ...skipped], lines = all.filter(f => f !== 'MEMORY.md').length;
    const what = [all.includes('MEMORY.md') ? 'memory' : '', lines ? (lines === 1 ? 'line' : `${lines} lines`) : ''].filter(Boolean).join(' and ');
    toast(!what ? 'There is nothing to send to MeetCue yet.' : sent.length ? `MeetCue can now read this project's ${what}` : `MeetCue already has this project's ${what}`);
  } catch (error) { toast(mcSay(error)); }
}
// One line, chosen from its own menu.
const meetcueLineItems = (p, l) => mcLinked() && !p.myCanvases && l.topicPath ? [{ label:'Send this line to MeetCue', icon:'meetcue', fn:() => useInMeetcue(p.id, [l.topicPath]) }] : [];
// Offered once MeetCue is connected: in a project's menu in the rail.
const meetcueMenuItems = s => mcLinked() && !s.myCanvases ? [{ label:'Use in MeetCue', icon:'meetcue', fn:() => useInMeetcue(s.id) }] : [];

// ---------- The page itself, drawn by render() in main.js ----------
function renderMeetcue(view) {
  const at = mcAt(); if (!at) return false;
  document.body.classList.remove('is-full', 'has-desk', 'on-line');
  unmountLine(); SHEET?.destroy(); SHEET = null;
  refreshChrome();
  // Each time the page opens it asks again, so what MeetCue has now is what shows.
  const same = outsideShown.page === S.shelfPage;
  if (!same) { if (at.id) { loadMeeting(at.id); if (!MC.status && !MC.loading) loadMeetcue(); } else loadMeetcue(); }
  const next = at.id ? meetingHTML(at.id) : meetcueHTML();
  document.title = `${at.id ? MC.one[at.id]?.data?.meeting?.title || 'Meeting' : 'MeetCue'} · PenEcho Lines`;
  // Redrawn only when something changed, so a button you are on stays put.
  if (!same || outsideShown.html !== next) {
    window.MeetCueMap?.unmountAll(view);
    view.innerHTML = next;
    window.MeetCueMap?.mountAll(view);
  }
  if (!same) view.scrollTop = 0;
  outsideShown = { page:S.shelfPage, html:next };
  return true;
}
// Whether MeetCue is connected decides what a project offers, so it is asked once at the start.
loadMeetcue();
