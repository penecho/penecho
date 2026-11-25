'use strict';
// The page side of the Orchestrator reviewer: the review card on a Line, the settings beside the box, its hints, sync and PenEcho Auto.
require('./helpers/safety.js');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('./helpers/dom.js');

const read = name => fs.readFileSync(path.join(__dirname, '../public/lines', name), 'utf8');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const ic = (name, size = 18) => `<svg class="ic" data-icon="${name}" width="${size}" height="${size}" aria-hidden="true"></svg>`;
const turn = () => new Promise(resolve => setImmediate(resolve));
function slice(source, start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `${start} -> ${end}`);
  return source.slice(from, to);
}

const REVIEW = {
  score:4, scale:5, asked:4, proven:3, safe:5, report:5,
  requirements:[{ text:'Hide Topics when turned off', state:'done' }, { text:'Add a test', state:'partly' }, { text:'renamed a helper', state:'extra' }],
  note:'Hid Topics when turned off and added a sidebar test, which passes. Proven is 3: the Home page has no test.',
  by:'Antigravity · gemini-4-hydrogen · xhigh effort', agent:'antigravity', model:'gemini-4-hydrogen', effort:'xhigh',
  mode:'auto', why:'Auto-picked: highest-rated available reviewer that did not do this work.',
  tools:true, took:'18s', files:['public/lines/pages.js', 'test/project-topics-off.test.js'], helpersCount:1,
  notes:'Checked the sidebar and Home page test files directly.',
  at:'2026-11-23T03:40:00.000Z',
  facts:{ files:3, added:48, removed:12, checks:2 },
};
const SETTINGS = () => ({ review:true, reviewer:'auto', reviewers:[{ id:'e689d552cf94', name:'Claude Code · claude-opus-5-5 · high effort' }], sync:null, costsKnown:false, agents:8, seen:false });

function cardHarness() {
  const { document } = parseHTML('<html><body><div id="host"></div><div id="list"></div><div id="panel"></div></body></html>');
  const sent = [], toasts = [], picked = [];
  const line = { id:'one', slug:'one', status:'done', archived:false, closed:false, stations:[], questions:[] };
  const AGENTS = {
    you:{ id:'you', name:'You', mono:'You', color:'#7a8190' },
    claude:{ id:'claude', name:'Claude Code', mono:'Cl', color:'#d97706' },
    codex:{ id:'codex', name:'Codex', mono:'Cx', color:'#10a37f' },
    antigravity:{ id:'antigravity', name:'Antigravity', mono:'Ag', color:'#4285f4' },
  };
  const agentInfo = id => AGENTS[id] || { id, name:String(id || 'Agent'), mono:String(id || 'Ag').slice(0, 2), color:'#5b6472' };
  const lineSrc = read('line.js');
  const reviewBlock = slice(lineSrc, "// The server takes a rating only for a Work that finished or was stopped", "function rateButtonsHTML(l, s, cls = '') {");
  const workBlock = slice(lineSrc, "function workItem(p, l, s) {", "// What a Work made besides its Canvases");
  const threadBlock = slice(lineSrc, "function kindLine(l, s) {", "// The real Canvas opens");
  const stopBlock = slice(lineSrc, "function stopWords(s) {", "// ---------- The head ----------");
  const actBlock = slice(lineSrc, "ACT['line-work'] = el => {", "ACT['panel-pop'] = el => {");
  const panelHeadBlock = slice(lineSrc, "function panelHead(l, s) {", "function panelBody(p, l, s) {");
  const c2 = vm.createContext({
    document, console, ACT:{}, HOSTED:false, EMBED:null, STATE_COLOR:{}, KIND:{ work:{ label:'Work' }, review:{ label:'Review' }, ask:{ label:'Ask' }, note:{ label:'Note' } },
    S:{ route:{ view:'line', line:'one' }, lineSel:null, presets:{ presets:[] } }, AGENTS, agentInfo,
    av:(id, size = 24) => `<span class="av" data-av="${esc(id)}" data-size="${size}">${esc(agentInfo(id).mono)}</span>`,
    esc, ic, isYours:s => ['ask', 'note', 'canvas', 'meeting'].includes(s.kind),
    isWork:s => !['ask', 'note', 'canvas', 'meeting', 'merge', 'deliver', 'orch-review'].includes(s.kind),
    isEnd:s => s.kind === 'merge' || s.kind === 'deliver',
    stepLabel:s => s.label || (s.kind === 'orch-review' ? 'Orchestrator review' : 'Work 1'),
    lineState:l => l.status || 'done', currentStation:l => l.stations[l.stations.length - 1] || {},
    dayOf:() => '', texInline:t => esc(t), plainOut:t => String(t || ''), askOnly:t => String(t || ''),
    offText:() => 'Stopped', stopWhyWords:() => '', stateWord:s => s.state || 'done', firstLine:t => String(t || ''),
    askVisible:() => true, fileEntry:() => null, reviewMark:() => '', nodeTools:() => '', deleteTool:() => '', nodeIcon:() => '',
    workWords:(_l, s) => s.out || '', inlineSay:t => esc(t), sayHTML:t => `<p>${esc(t)}</p>`,
    questionsHTML:() => '', continueButton:() => '', carryWork:() => null, carryButton:() => '',
    resendWork:() => null, resendButton:() => '', isQueued:() => false, unqueueButton:() => '',
    workAsking:() => null, workQuestions:() => [], workWaitingReply:() => false, answerAct:() => '',
    isReviewed:s => Boolean(s.reviewed), canReview:s => s.kind === 'work' && s.state === 'done',
    clockOf:iso => (iso ? '03:40' : ''), nodeWhen:w => w || '', workSubHTML:() => '', outputsHTML:() => '', canvasPages:() => [],
    askItem:() => '', noteItem:() => '', canvasItem:() => '', endItem:() => '', nextToReview:() => null,
    followedStopTarget:() => null, followedStopButton:() => '', panelExpandButton:() => '',
    project:() => ({ id:'p' }), lineById:(p, id) => (id === line.id ? line : null), stationById:(l, id) => l.stations.find(s => s.id === id),
    sendFeedback:async (l, body) => { sent.push({ line:l.id, ...body }); }, refreshAfterChange() {}, toast:msg => toasts.push(msg),
    pickStep:(l, s, opts) => { picked.push({ line:l.id, step:s.id, opts }); c2.S.lineSel = s; },
    $:(sel, root = document) => root.querySelector(sel), $$:(sel, root = document) => [...root.querySelectorAll(sel)],
  });
  for (const chunk of [stopBlock, reviewBlock, workBlock, threadBlock, panelHeadBlock, actBlock]) vm.runInContext(chunk, c2);
  const draw = s => { line.stations = [s]; document.querySelector('#host').innerHTML = c2.reviewCardHTML(line, s); return document.querySelector('#host'); };
  const drawThread = stations => {
    line.stations = stations;
    document.querySelector('#host').innerHTML = c2.threadHTML({ id:'p' }, line);
    document.querySelector('#list').innerHTML = c2.listHTML({ id:'p' }, line);
    return document.querySelector('#host');
  };
  const drawPanel = s => {
    const html = `<header id="lppHead">${c2.panelHead(line, s)}</header><div id="lppBody">${c2.orchReviewPanelHTML({ id:'p' }, line, s)}</div>`;
    document.querySelector('#panel').innerHTML = html;
    return document.querySelector('#panel');
  };
  return { c:c2, document, line, sent, toasts, picked, draw, drawThread, drawPanel };
}
const work = extra => ({ id:'work-1', index:0, kind:'work', state:'done', label:'Work 1', agent:'codex', took:'6 min', pictures:[], outputs:[], files:[], refers:[], ...extra });

test('a full review is rendered in a separate node from the Work, shows auto/user reason, and opens reviewer detail in the right panel', async () => {
  const h = cardHarness();
  const w = work({ orchScore:4, orchBy:REVIEW.by, review:REVIEW });
  const host = h.drawThread([w]);
  // The Work node does not contain the review card inside itself.
  const workNode = host.querySelector('#item-work-1');
  assert.ok(workNode);
  assert.equal(workNode.querySelector('.lp-review-body'), null);
  assert.equal(workNode.querySelector('.lp-orch-review'), null);

  // A separate review node appears after Work 1, with the reviewer's own header (Antigravity, not Work's Codex).
  const kindLines = [...host.querySelectorAll('.lp-kl')];
  assert.equal(kindLines.length, 2);
  assert.match(kindLines[0].textContent, /Codex/);
  assert.match(kindLines[1].textContent, /Antigravity/);
  assert.match(kindLines[1].textContent, /Orchestrator review/);
  assert.equal(kindLines[1].querySelector('.av').dataset.av, 'antigravity');

  const rvNode = host.querySelector('#item-work-1--review');
  assert.ok(rvNode);
  assert.equal(rvNode.dataset.act, 'line-work');
  assert.equal(rvNode.dataset.step, 'work-1--review');
  assert.match(rvNode.querySelector('.lp-rv-head').textContent, /Orchestrator review/);
  assert.match(rvNode.querySelector('.lp-rv-head').textContent, /of Work 1/);
  assert.equal(rvNode.querySelector('.rv-mode').textContent, 'Auto reviewer');
  assert.equal(rvNode.querySelector('.rv-score').textContent, '4/5 · Minor gaps');
  assert.equal(rvNode.querySelector('.rv-agent-name').textContent, REVIEW.by);
  assert.equal(rvNode.querySelector('.rv-why').textContent, REVIEW.why);

  const reqs = [...rvNode.querySelectorAll('.rv-req')];
  assert.deepEqual(reqs.map(li => li.className), ['rv-req is-done', 'rv-req is-partly', 'rv-req is-extra']);
  assert.deepEqual(reqs.map(li => li.querySelector('.rv-state').textContent), ['done', 'partly', 'extra']);
  assert.match(reqs[2].querySelector('.rv-text').textContent, /^\(not asked\) renamed a helper$/);
  const bars = [...rvNode.querySelectorAll('.rv-bar')];
  assert.deepEqual(bars.map(b => b.querySelector('.rv-bar-head span').textContent), ['Asked', 'Proven', 'Safe', 'Report']);
  assert.deepEqual(bars.map(b => b.querySelector('.rv-n').textContent), ['4', '3', '5', '5']);
  assert.deepEqual(bars.map(b => b.className), ['rv-bar m-4', 'rv-bar m-3', 'rv-bar m-5', 'rv-bar m-5']);
  assert.equal(bars[0].getAttribute('aria-label'), 'Asked: 4 of 5');
  assert.equal(rvNode.querySelector('.rv-facts').textContent, '6 min · 3 files · +48 −12 · 2 checks run');
  // One review note in place of places to look and a next Ask.
  assert.equal(rvNode.querySelector('.rv-note').textContent, REVIEW.note);
  assert.equal(rvNode.querySelector('.rv-note').previousElementSibling.textContent, 'Review note');
  for (const sel of ['.rv-look', '.rv-next', '[data-act="review-send"]']) assert.equal(rvNode.querySelector(sel), null, sel);
  assert.equal(h.c.ACT['review-send'], undefined);

  // Left-rail stop list includes a distinct clickable row for the Orchestrator review node with compact title + score pill.
  const listStops = [...h.document.querySelectorAll('#list .lps')];
  assert.equal(listStops.length, 2);
  assert.equal(listStops[0].querySelector('.lps-title').textContent, 'Work 1');
  assert.equal(listStops[0].querySelector('.lps-badge').textContent, 'Unreviewed');
  assert.equal(listStops[1].dataset.step, 'work-1--review');
  assert.equal(listStops[1].querySelector('.lps-title').textContent, 'Review');
  assert.equal(listStops[1].querySelector('.lps-score').textContent, '4/5');
  assert.match(listStops[1].getAttribute('aria-label'), /Orchestrator review · 4\/5 · Minor gaps/);

  // Work 1's own Orchestrator review summary card includes a link to open the separate review node.
  const rateCard = h.c.orchRateCardHTML(w, h.line);
  assert.match(rateCard, /data-step="work-1--review"/);
  assert.match(rateCard, /View review details/);

  // Clicking the review node opens it via pickStep, and the right panel shows full reviewer details.
  h.c.ACT['line-work'](rvNode);
  assert.equal(h.picked.length, 1);
  assert.equal(h.picked[0].line, 'one');
  assert.equal(h.picked[0].step, 'work-1--review');
  assert.equal(h.picked[0].opts.scroll, false);
  const rvStation = h.c.lineStation(h.line, 'work-1--review');
  const panel = h.drawPanel(rvStation);
  assert.match(panel.querySelector('#lppHead h2').textContent, /Orchestrator review/);
  assert.equal(panel.querySelector('#lppHead .av').dataset.av, 'antigravity');
  assert.equal(panel.querySelector('.lpp-rv-verdict .rv-score').textContent, '4/5 · Minor gaps');
  assert.match(panel.querySelector('.lpp-rv-target').textContent, /Reviewing Work 1/);
  assert.equal(panel.querySelector('.lpp-rv-why-card .rv-mode').textContent, 'Auto reviewer');
  assert.match(panel.querySelector('.lpp-rv-dl').textContent, /Auto-picked: highest-rated available reviewer/);
  assert.match(panel.querySelector('.lpp-rv-dl').textContent, /Read-only workspace & check access/);
  assert.equal(panel.querySelector('.lpp-rv-notes').textContent, REVIEW.notes);
  assert.deepEqual([...panel.querySelectorAll('.lpp-rv-files code')].map(n => n.textContent), REVIEW.files);
  assert.equal(panel.querySelector('[aria-label="Review note"] .rv-note').textContent, REVIEW.note);
  assert.doesNotMatch(panel.textContent, /Look at|Suggested next/);
  // A review kept before notes shows its places to look at as the note, and never its next Ask.
  const kept = h.draw(work({ review:{ ...REVIEW, note:undefined, look:[{ where:'test/a.test.js', why:'Covers the sidebar only.' }], next:'Add the Home case.' } }));
  assert.equal(kept.querySelector('.rv-note').textContent, 'test/a.test.js — Covers the sidebar only.');
  assert.doesNotMatch(kept.textContent, /Add the Home case/);

  // User-assigned reviewer renders the User assigned badge and reason.
  const userWork = work({ id:'work-2', review:{ ...REVIEW, mode:'user', why:'Assigned by you in Orchestrator settings (Reviewer).' } });
  const userHost = h.drawThread([userWork]);
  assert.equal(userHost.querySelector('#item-work-2--review .rv-mode').textContent, 'User assigned');
  assert.match(userHost.querySelector('#item-work-2--review .rv-why').textContent, /Assigned by you in Orchestrator settings/);

  // A review kept before the 0 to 5 ratings had 0, 1 or 2.
  const old = [...h.draw(work({ review:{ ...REVIEW, scale:undefined, asked:1, proven:0, safe:2, report:2 } })).querySelectorAll('.rv-bar')];
  assert.deepEqual(old.map(b => b.className), ['rv-bar m-3', 'rv-bar m-0', 'rv-bar m-5', 'rv-bar m-5']);
  // Ratings to one decimal: the number as given, the bar as long as it, the words of the nearest step (5 only from 4.8).
  const fine = h.draw(work({ orchScore:4.6, review:{ ...REVIEW, score:4.6, asked:4.5, proven:4.2, safe:5, report:4.8 } }));
  assert.equal(fine.querySelector('.rv-score').textContent, '4.6/5 · Minor gaps');
  assert.ok(fine.querySelector('.rv-score').classList.contains('s-4'));
  const fineBars = [...fine.querySelectorAll('.rv-bar')];
  assert.deepEqual(fineBars.map(b => b.querySelector('.rv-n').textContent), ['4.5', '4.2', '5', '4.8']);
  assert.deepEqual(fineBars.map(b => b.getAttribute('style')), ['--w:90%', '--w:84%', '--w:100%', '--w:96%']);
  assert.deepEqual(fineBars.map(b => b.className), ['rv-bar m-5', 'rv-bar m-4', 'rv-bar m-5', 'rv-bar m-5']);
  assert.match(h.draw(work({ orchScore:4.8, review:{ ...REVIEW, score:4.8 } })).querySelector('.rv-score').textContent, /^4\.8\/5 · Complete and verified$/);

  assert.equal(h.c.reviewScoreWords(5), '5/5 · Complete and verified');
  assert.equal(h.c.reviewScoreWords(1), '1/5 · Unusable');
  assert.equal(h.c.reviewScoreWords(7), '');
});

test('an empty review leaves out every missing part, Reviewing… appears in its own node, and legacy reviews infer the agent avatar', () => {
  const h = cardHarness();
  let host = h.draw(work({ took:'', review:{ score:5, requirements:[], note:'', by:'', facts:{ files:0, added:0, removed:0 } } }));
  const card = host.querySelector('.lp-review');
  assert.equal(card.querySelector('.rv-by').textContent, 'Orchestrator review');
  assert.equal(card.querySelector('.rv-score').textContent, '5/5 · Complete and verified');
  for (const sel of ['.rv-reqs', '.rv-bars', '.rv-facts', '.rv-note']) assert.equal(card.querySelector(sel), null, sel);

  // Separate reviewing node shows who is reviewing and why while active.
  const pendingHost = h.drawThread([work({
    reviewing:true,
    reviewPending:{ by:'Codex · gpt-6.2-sol', agent:'codex', mode:'user', why:'Assigned by you in Orchestrator settings (Reviewer).', startedAt:'2026-11-23T03:40:00.000Z' },
  })]);
  assert.equal(pendingHost.querySelector('#item-work-1 .lp-review-wait'), null);
  const pendingNode = pendingHost.querySelector('#item-work-1--review');
  assert.ok(pendingNode.classList.contains('is-reviewing'));
  assert.equal(pendingNode.querySelector('.rv-mode').textContent, 'User assigned');
  assert.match(pendingNode.querySelector('.lp-review-wait').textContent, /Reviewing Work 1/);
  const pendingPanel = h.drawPanel(h.c.lineStation(h.line, 'work-1--review'));
  assert.match(pendingPanel.querySelector('.lpp-rv-verdict').textContent, /Reviewing Work 1/);

  // Legacy review without explicit `agent` field still resolves reviewer avatar from `by`.
  const legacyHost = h.drawThread([work({ agent:'antigravity', review:{ score:4, asked:4, proven:4, safe:4, report:4, requirements:[], by:'Codex · gpt-6.2-sol · xhigh effort', facts:{} } })]);
  const legacyKl = legacyHost.querySelectorAll('.lp-kl')[1];
  assert.equal(legacyKl.querySelector('.av').dataset.av, 'codex');

  assert.equal(h.draw(work({})).innerHTML, '', 'no review fields from an older server: no card');
  assert.equal(h.draw(work({ kind:'review', review:REVIEW })).innerHTML, '', 'a review Work is never itself reviewed');
});

test('every word from the server is escaped in both the separate review node and the right panel', () => {
  const h = cardHarness(), evil = '<img src=x onerror=alert(1)>';
  const w = work({ review:{ ...REVIEW, by:evil, why:evil, note:evil, notes:evil, files:[evil], requirements:[{ text:evil, state:'<b>done</b>' }], look:[{ where:evil, why:evil }] } });
  const host = h.drawThread([w]);
  assert.equal(host.querySelector('img'), null);
  assert.equal(host.querySelector('.lp-review-body b'), null);
  const rvNode = host.querySelector('#item-work-1--review');
  assert.equal(rvNode.querySelector('.rv-agent-name').textContent, evil);
  assert.equal(rvNode.querySelector('.rv-why').textContent, evil);
  assert.equal(rvNode.querySelector('.rv-note').textContent, evil);
  assert.equal(rvNode.querySelector('.rv-req').className, 'rv-req', 'an unknown state draws no mark word');
  const panel = h.drawPanel(h.c.lineStation(h.line, 'work-1--review'));
  assert.equal(panel.querySelector('img'), null);
  assert.match(panel.querySelector('.lpp-rv-dl').textContent, new RegExp(evil.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

function settingsHarness({ settings = SETTINGS(), view = 'orchestrator', fail = null, kept = '' } = {}) {
  const { document } = parseHTML(`<html><body><div class="orch-box-wrap"><span id="orchGearSlot"></span><div id="orchBox"><button id="orchAgent" data-orch-preset="a1">A</button></div>
    <div class="orch-set-anchor"><div class="orch-set-panel" id="orchSetPanel" hidden></div></div><div id="orchHint"></div></div></body></html>`);
  const calls = [], listeners = {}, store = { 'penecho-orchestrator-agent-v1':kept };
  const p = { id:'p1' };
  const c = vm.createContext({
    document, console, ACT:{}, HOSTED:false, esc, ic, S:{ route:{ view } }, ORCH:{ project:'p1' }, ORCH_AGENT:'penecho-orchestrator-agent-v1',
    project:() => p, pathFor:id => `/projects/${id}`, toast() {}, loadOrchestrator:(...a) => calls.push({ reload:a[1] }),
    localStorage:{ getItem:k => store[k] ?? null, setItem:(k, v) => { store[k] = v; } },
    orchPreset:() => ({ id:'a1', name:'A', agent:'claude' }), orchBoxHTML:() => '<button id="orchAgent" data-orch-preset="auto">PenEcho Auto</button>',
    $:(sel, root = document) => root.querySelector(sel),
    orchPaint:(id, make) => { const el = document.getElementById(id); if (el) el.innerHTML = typeof make === 'function' ? make() : make; },
  });
  c.document.addEventListener = (type, fn) => { (listeners[type] ||= []).push(fn); };
  c.api = async (url, opts = {}) => {
    calls.push({ url, method:opts.method || 'GET', body:opts.body });
    if (fail && url.endsWith(fail.route)) throw Object.assign(new Error(fail.message), { status:fail.status });
    if (url.endsWith('/orchestrator/settings') && opts.method === 'POST') return Object.assign(settings, opts.body);
    if (url.endsWith('/orchestrator/settings')) return settings;
    if (url.endsWith('/orchestrator/sync')) { settings.sync = { at:'2026-11-23T03:40:00.000Z', prices:18, ratings:16 }; settings.costsKnown = true; return { sync:settings.sync, addedPrices:18, settings }; }
    throw new Error(`unexpected ${url}`);
  };
  vm.runInContext(slice(read('orchestrator.js'), '// ---------- Settings beside the box', '// ---------- What each orchestrator started ----------'), c);
  c.get = name => vm.runInContext(name, c);
  const hint = () => document.querySelector('#orchHint').textContent.replace(/\s+/g, ' ').trim();
  return { c, document, calls, hint, listeners, settings };
}

test('hints show one at a time: no agent, then no prices, then the first-use line; none from an older server', async () => {
  let h = settingsHarness({ settings:{ ...SETTINGS(), agents:0 } });
  await h.c.loadOrchSettings();
  assert.equal(h.hint(), 'Add an agent so the Orchestrator has someone to hand work to');
  assert.ok(h.document.querySelector('#orchHint [data-act="open-agents"]'));

  h = settingsHarness();
  await h.c.loadOrchSettings();
  assert.equal(h.hint(), 'The Orchestrator can’t compare costs yet. Get prices and ratings');

  h = settingsHarness({ settings:{ ...SETTINGS(), costsKnown:true } });
  await h.c.loadOrchSettings();
  assert.equal(h.hint(), 'Reviews are on. Change in settings.');
  assert.ok(h.document.querySelector('.orch-gear-dot'), 'a dot on the gear while not seen');

  h = settingsHarness({ settings:{ ...SETTINGS(), costsKnown:true, seen:true } });
  await h.c.loadOrchSettings();
  assert.equal(h.hint(), '');
  assert.equal(h.document.querySelector('.orch-gear-dot'), null);

  h = settingsHarness({ fail:{ route:'/orchestrator/settings', status:404, message:'Not found' } });
  await h.c.loadOrchSettings();
  assert.equal(h.hint(), '');
  assert.equal(h.document.querySelector('#orchGearSlot').innerHTML, '', 'no gear from an older server');
  assert.equal(h.c.get('orchSettings()'), null, 'no PenEcho Auto from an older server');
});

test('the hint syncs in place and says what arrived; a failure shows the server message there and changes nothing else', async () => {
  let h = settingsHarness();
  await h.c.loadOrchSettings();
  const link = h.document.querySelector('#orchHint [data-act="orch-sync"]');
  link.closest = sel => (sel === '#orchSetPanel' ? null : link);
  await h.c.ACT['orch-sync'](link);
  assert.equal(h.hint(), '18 prices and 16 agent ratings added');
  assert.ok(h.calls.some(x => x.url === '/projects/p1/orchestrator/sync' && x.method === 'POST'));

  h = settingsHarness({ fail:{ route:'/orchestrator/sync', status:502, message:'penecho.ai did not answer.' } });
  await h.c.loadOrchSettings();
  await h.c.orchSync('hint');
  assert.equal(h.hint(), 'penecho.ai did not answer. Get prices and ratings');
  assert.equal(h.settings.sync, null);
  assert.equal(h.c.orchSyncSaid({ addedPrices:0, sync:{ prices:18, ratings:0 } }), 'Prices and ratings are up to date');
  assert.equal(h.c.orchSyncSaid({ addedPrices:1, sync:{ ratings:1 } }), '1 price and 1 agent rating added');
});

test('the settings panel has exactly three rows with working defaults; opening it once marks it seen', async () => {
  const h = settingsHarness({ settings:{ ...SETTINGS(), costsKnown:true } });
  await h.c.loadOrchSettings();
  h.c.ACT['orch-settings']();
  await turn();
  const panel = h.document.querySelector('#orchSetPanel');
  assert.equal(panel.hidden, false);
  const rows = [...panel.querySelectorAll('.orch-set-row')];
  assert.deepEqual(rows.map(r => r.querySelector('.orch-set-what > :first-child').textContent), ['Review first jobs', 'Reviewer', 'Prices and ratings']);
  assert.equal(panel.querySelector('#orchSetReview').hasAttribute('checked'), true);
  assert.deepEqual([...panel.querySelectorAll('#orchSetReviewer option')].map(o => o.textContent), ['Auto', 'Claude Code · claude-opus-5-5 · high effort']);
  assert.equal(panel.querySelector('#orchSetSync').textContent.replace(/\s+/g, ' ').trim(), 'Not syncedSync');
  assert.ok(h.calls.some(x => x.method === 'POST' && x.url.endsWith('/orchestrator/settings') && x.body.seen === true));
  assert.equal(h.hint(), '', 'the first-use line goes');
  assert.equal(h.document.querySelector('.orch-gear-dot'), null, 'the dot goes');
  assert.ok(rows.every(r => r.querySelector('.orch-set-what small').textContent.trim().length > 20), 'each row says what it does');
  assert.doesNotMatch(rows[0].querySelector('small').textContent, /Review button/i);
  assert.match(rows[2].querySelector('small').textContent, /Your own ratings stay/);

  await h.c.orchSync('panel');
  assert.equal(h.document.querySelector('#orchSetSync').textContent.replace(/\s+/g, ' ').trim(), 'Synced Nov 23Sync again');

  for (const fn of h.listeners.change) fn({ target:{ id:'orchSetReviewer', value:'e689d552cf94' } });
  await turn();
  assert.ok(h.calls.some(x => x.method === 'POST' && x.body?.reviewer === 'e689d552cf94'));
});

test('a sync beside the box also reads the model prices again', async () => {
  const h = settingsHarness();
  h.c.loadPrices = force => h.calls.push({ prices:force });
  await h.c.loadOrchSettings();
  await h.c.orchSync('hint');
  assert.ok(h.calls.some(x => x.prices === true));
});

test('PenEcho Auto is not the default, and Start sends preset "auto"', async () => {
  const h = settingsHarness();
  await h.c.loadOrchSettings();
  assert.equal(h.c.orchChosen().id, 'a1', 'not chosen by default');
  h.c.localStorage.setItem('penecho-orchestrator-agent-v1', 'auto');
  assert.equal(h.c.orchChosen().id, 'auto');

  const src = read('orchestrator.js');
  const start = slice(src, 'function orchStart(', '// ---------- Settings beside the box');
  assert.match(start, /chosen = orchChosen\(\)/);
  assert.match(start, /preset:chosen\.id/);
  // Run orchStart itself with Auto chosen.
  const bodies = [];
  const c = vm.createContext({
    ORCH:{ draft:{ text:'Fix it', files:[], flags:{} } }, project:() => ({ id:'p1' }), orchChosen:() => h.c.get('ORCH_AUTO'),
    pathFor:id => `/projects/${id}`, HOSTED:false, orchRequestId:() => 'r1', orchPaint() {}, orchBoxHTML:() => '', makeWords:() => '',
    api:async (url, opts) => { bodies.push({ url, body:opts.body }); return { line:'l1' }; },
    rememberBoxes() {}, loadOrchestrator:async () => {}, toast() {}, $:() => null, JSON,
    S:{ route:{ view:'home' } }, ACT:{}, guessTitle:String, takeBox() {}, orchBoxKey:() => 'orch-p1', orchSessionView:{}, defaultOrchSessionView:{}, localStorage:{ length:0, setItem() {}, removeItem() {} },
  });
  vm.runInContext(start, c);
  await c.orchStart();
  assert.equal(bodies[0].url, '/projects/p1/orchestrator');
  assert.equal(bodies[0].body.preset, 'auto');
  assert.equal('computer' in bodies[0].body, false);

  // Even when orchPaint enforces a typing guard, first-visit settings load with Auto remembered still updates the picker.
  const auto = settingsHarness({ kept:'auto' });
  let paintedForce = null;
  auto.c.orchPaint = (id, make, force = false) => {
    if (id === 'orchBox') paintedForce = force;
    const el = auto.document.getElementById(id);
    if (el) el.innerHTML = typeof make === 'function' ? make() : make;
  };
  await auto.c.loadOrchSettings();
  assert.equal(auto.document.querySelector('#orchAgent').dataset.orchPreset, 'auto');
  assert.equal(paintedForce, true);
});

test('Sessions show the review score quietly, and nothing for a row without one', () => {
  const h = settingsHarness();
  h.c.reviewScoreWords = n => (n === 4 ? '4 · Minor gaps' : '');
  assert.equal(h.c.orchReviewScoreHTML({ reviewScore:4 }), '<span class="orch-review-score" title="Review">4 · Minor gaps</span>');
  assert.equal(h.c.orchReviewScoreHTML({}), '');
});

test("the review's panel shows what the reviewer did under Details, live while it reads, as a Work's panel does", () => {
  const { document } = parseHTML('<html><body><div id="panel"></div></body></html>');
  const src = read('line.js'), live = [];
  const c = vm.createContext({
    document, console, esc, ic, S:{ lineSel:null, detailsShown:{} },
    av:id => `<span class="av">${esc(id)}</span>`, agentInfo:id => ({ name:id === 'codex' ? 'Codex' : String(id) }),
    shortWhen:() => 'now', sayHTML:t => `<p>${esc(t)}</p>`, shortPath:t => t, project:() => ({ id:'p', vault:{ path:'/docs' } }),
    apiUrl:u => u, topicApi:(p, l, v) => v, mdSection:() => '', docById:() => null, orchReviewPanelWhere:() => '',
    isOrchReview:s => s.kind === 'orch-review', paintLive:(band, agent, rows, started) => live.push({ agent, rows:rows.length, started }),
    $:(sel, root = document) => root.querySelector(sel), $$:(sel, root = document) => [...root.querySelectorAll(sel)],
  });
  vm.runInContext(`${slice(src, 'function panelBody(p, l, s) {', '// What the agent made that is not a picture.')}\n${slice(src, 'function toolRow(row, l) {', '// While a Topic is on screen')}`, c);
  const l = { id:'one', slug:'one', workdir:'/code' }, startedAt = '2026-11-23T06:00:00.000Z';
  const reviewing = { id:'w1--review', kind:'orch-review', state:'active', reviewing:true, agent:'codex', workId:'w1', workLabel:'Work 1', reviewPending:{ startedAt } };
  const a = { running:false, started:0, now:'', reviews:{ 'w1--review':'Running git diff' }, rows:new Map([
    [0, { i:0, step:'w1', kind:'tool', verb:'Edited', target:'/code/a.js', state:'done' }],
    [1, { i:1, step:'w1--review', kind:'start', agent:'codex', at:0 }],
    [2, { i:2, step:'w1--review', kind:'tool', verb:'Read', target:'/code/a.js', state:'done', output:'const a = 1;' }],
    [3, { i:3, step:'w1--review', kind:'tool', verb:'Ran', target:'git diff', code:true, state:'running' }],
  ]), seq:3 };
  c.activityOf = () => a;
  const panel = document.querySelector('#panel');
  panel.innerHTML = c.panelBody({ id:'p' }, l, reviewing);
  assert.ok(panel.querySelector('#lppOrchReview'), 'the review itself still has its place');
  assert.equal(panel.querySelector('#lppDetails').hidden, false, 'open while the reviewer reads');
  assert.equal(panel.querySelector('#lppFoot').dataset.act, 'panel-details');
  assert.equal(panel.querySelector('.lpp-rv-foot-label'), null, 'Details takes the place of the old label');
  c.S.lineSel = reviewing;
  c.paintRows({ id:'p' }, l, reviewing);
  const rows = panel.querySelector('#lppRows');
  assert.deepEqual([...rows.querySelectorAll('.at-verb')].map(x => x.textContent), ['Read', 'Git diff'], "only the reviewer's steps, not the Work's");
  assert.match(rows.querySelector('.at-start').textContent, /Codex started/);
  assert.equal(rows.querySelector('.at-now').textContent, 'Git diff');
  assert.equal(panel.querySelector('#lppCount').textContent, ' · 2 steps');
  assert.deepEqual(live, [{ agent:'codex', rows:3, started:Date.parse(startedAt) }], 'the live picture runs from when the review started');
  // Finished: the steps AND original reviewer output stay visible in Details, nothing says it is still going, and the panel opens closed.
  const done = { ...reviewing, state:'done', reviewing:false, reviewPending:null, review:{ score:4, rawOutput:'{"asked":4}' } };
  a.rows.get(3).state = 'done'; a.rows.set(4, { i:4, step:'w1--review', kind:'say', text:'{"asked":4}' }); a.seq = 4; a.reviews = {};
  panel.innerHTML = c.panelBody({ id:'p' }, l, done);
  assert.equal(panel.querySelector('#lppDetails').hidden, true);
  c.S.lineSel = done;
  c.paintRows({ id:'p' }, l, done);
  assert.equal(panel.querySelector('.at-live'), null);
  assert.equal(panel.querySelectorAll('#lppRows .at-verb').length, 2);
  assert.match(panel.querySelector('#lppRows .at-say pre').textContent, /\{"asked":4\}/, 'keeps the reviewer final say row visible in Details');

  // Tool-less review (only start + say): #lppCount still indicates entries and Details displays the original output.
  const toolless = { id:'w2--review', kind:'orch-review', state:'done', reviewing:false, agent:'kimi', workId:'w2', workLabel:'Work 2', review:{ verdict:'ready', score:5 } };
  const a2 = { running:false, started:0, now:'', reviews:{}, rows:new Map([
    [8, { i:8, step:'w2--review', kind:'start', agent:'codex', at:0 }],
    [9, { i:9, step:'w2--review', kind:'say', text:'OLD_REVIEW_SHOULD_NOT_SHOW' }],
    [10, { i:10, step:'w2--review', kind:'start', agent:'kimi', at:1 }],
    [11, { i:11, step:'w2--review', kind:'say', text:'{"verdict":"ready","outcome":5}' }],
  ]), seq:11 };
  c.activityOf = () => a2;
  panel.innerHTML = c.panelBody({ id:'p' }, l, toolless);
  c.S.lineSel = toolless;
  c.paintRows({ id:'p' }, l, toolless);
  assert.equal(panel.querySelector('#lppCount').textContent, ' · 1 entry');
  assert.match(panel.querySelector('#lppRows .at-say pre').textContent, /"verdict":"ready"/);
  assert.doesNotMatch(panel.querySelector('#lppRows').textContent, /OLD_REVIEW_SHOULD_NOT_SHOW/, 're-review Details hides earlier review attempts');
});

test('Work detail action bar shows quiet Refer + Review split button, picker, live reviewing state, and keeps Mark all reviewed intact', async () => {
  const { document } = parseHTML('<html><body><div id="lpPanel"><div id="host"></div></div><div id="thread"></div></body></html>');
  const posts = [], menus = [], toasts = [], picked = [], navigated = [];
  const line = { id:'one', slug:'one', status:'done', archived:false, closed:false, stations:[], questions:[] };
  const p = { id:'p1' };
  let settings = {
    review:true,
    reviewer:'auto',
    reviewers:[
      { id:'codex-1', name:'Codex', agent:'codex', model:'gpt-5.4', effort:'high' },
      { id:'claude-1', name:'Claude Code · sonnet', agent:'claude', model:'claude-sonnet-4-6', effort:'high' },
      { id:'ag-1', name:'Antigravity', agent:'antigravity', model:'gemini-4-neon', effort:'high' },
    ],
  };
  const lineSrc = read('line.js');
  const reviewBlock = slice(lineSrc, "// The server takes a rating only for a Work that finished or was stopped", "function rateButtonsHTML(l, s, cls = '') {");
  const compareRow = slice(lineSrc, "const compareRunMenuRow = (a, b) =>", "// The arrow picks who runs it.");
  const startAct = slice(lineSrc, "const WORK_REVIEW_BUSY = new Set();", "// From a picture to the box");
  const c = vm.createContext({
    document, console, ACT:{}, HOSTED:false, ORCHSET:{ openAfterLoad:false },
    S:{ route:{ view:'line', line:'one' }, lineSel:null, presets:{ presets:[] } },
    AGENTS:{ codex:{ id:'codex', name:'Codex', mono:'Cx', color:'#0f766e' }, claude:{ id:'claude', name:'Claude Code', mono:'Cl', color:'#c26138' }, antigravity:{ id:'antigravity', name:'Antigravity', mono:'Ag', color:'#2563eb' } },
    agentInfo:id => c.AGENTS[id] || { id, name:String(id), mono:'Ag', color:'#5b6472' },
    av:(id, size = 24) => `<span class="av" data-av="${esc(id)}" data-size="${size}">${esc(c.agentInfo(id).mono)}</span>`,
    esc, ic, isWork:s => !['ask', 'note', 'canvas', 'meeting', 'merge', 'deliver', 'orch-review'].includes(s.kind),
    stepLabel:s => s.label || 'Work 2',
    orchSettings:() => settings,
    project:() => p, pathFor:id => `/projects/${id}`,
    lineById:(_p, id) => (id === line.id ? line : null),
    stationById:(l, id) => l.stations.find(s => s.id === id),
    openMenu:(anchor, items, opts) => menus.push({ anchor, items, opts }),
    closeMenu() {}, menuAnchorRect:() => ({ left:0, top:0, width:100, height:30 }),
    refreshLine() {
      const s = line.stations[0];
      document.querySelector('#host').innerHTML = c.workReviewButtonHTML(p, line, s) + c.orchRateCardHTML(s, line);
    },
    refreshAfterChange() {},
    pickStep:(l, s) => picked.push({ line:l.id, step:s.id }),
    go:route => navigated.push(route),
    toast:(msg, act) => toasts.push({ msg, act }),
    api:async (url, opts) => {
      posts.push({ url, body:opts?.body });
      return {
        ok:true, line:line.id, work:opts.body.work, step:`${opts.body.work}--review`,
        reviewPending:{ by:'Codex', agent:'codex', mode:opts.body.reviewer === 'auto' ? 'auto' : 'user', why:'Auto-picked: best available reviewer.', manual:true, startedAt:'2026-11-23T07:40:00.000Z' },
      };
    },
    $:(sel, root = document) => root.querySelector(sel),
    $$:(sel, root = document) => [...root.querySelectorAll(sel)],
  });
  for (const chunk of [reviewBlock, compareRow, startAct]) vm.runInContext(chunk, c);

  // Work done by Antigravity: defaults to PenEcho Auto, excludes Antigravity from dropdown.
  const w2 = work({ id:'work-2', label:'Work 2', agent:'antigravity', savedAgentId:'ag-1', model:'gemini-4-neon' });
  line.stations = [w2];
  const host = document.querySelector('#host');
  host.innerHTML = c.workReviewButtonHTML(p, line, w2);
  assert.equal(host.querySelector('.rev-verb').textContent, 'Review with');
  assert.equal(host.querySelector('.rev-target').textContent, 'PenEcho Auto');
  assert.equal(host.querySelector('.rev-main').dataset.reviewer, 'auto');

  // Opening the picker lists PenEcho Auto, Codex, Claude Code (NOT Antigravity), and Orchestrator settings…
  c.ACT['work-review-pick'](host.querySelector('.rev-pick'));
  assert.equal(menus.length, 1);
  const labels = Array.from(menus[0].items.filter(x => x.label), x => x.label);
  assert.deepEqual(labels, ['PenEcho Auto', 'Claude Code · sonnet', 'Codex', 'Orchestrator settings…']);
  // Clicking Orchestrator settings… navigates to Orchestrator and schedules opening settings.
  menus[0].items.find(x => x.label === 'Orchestrator settings…').fn();
  assert.equal(c.ORCHSET.openAfterLoad, true);
  assert.deepEqual(JSON.parse(JSON.stringify(navigated)), [{ view:'orchestrator' }]);

  // If Orchestrator settings specifies Codex, the button defaults to Codex.
  settings = { ...settings, reviewer:'codex-1' };
  host.innerHTML = c.workReviewButtonHTML(p, line, w2);
  assert.equal(host.querySelector('.rev-target').textContent, 'Codex');
  assert.equal(host.querySelector('.rev-main').dataset.reviewer, 'codex-1');

  // If Orchestrator settings specifies the agent that did this Work, button falls back to PenEcho Auto.
  settings = { ...settings, reviewer:'ag-1' };
  host.innerHTML = c.workReviewButtonHTML(p, line, w2);
  assert.equal(host.querySelector('.rev-target').textContent, 'PenEcho Auto');
  assert.equal(host.querySelector('.rev-main').dataset.reviewer, 'auto');

  // Clicking main button posts to /orchestrator/review, flips button to Reviewing with …, disables picker, and shows Reviewing… card.
  await c.ACT['work-review'](host.querySelector('.rev-main'));
  await turn();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, '/projects/p1/orchestrator/review');
  assert.deepEqual(JSON.parse(JSON.stringify(posts[0].body)), { line:'one', work:'work-2', reviewer:'auto' });
  assert.equal(w2.reviewing, true);
  assert.ok(host.querySelector('.rev-split.is-busy'));
  assert.equal(host.querySelector('.rev-verb').textContent, 'Reviewing with');
  assert.equal(host.querySelector('.rev-target').textContent, 'Codex');
  assert.equal(host.querySelector('.rev-pick').disabled, true);
  assert.ok(host.querySelector('.lpp-orch-rate.is-reviewing'));
  assert.match(toasts[0].msg, /Started review with Codex/);

  // Clicking the spinning button opens the live review node (work-2--review).
  c.ACT['work-review'](host.querySelector('.rev-main'));
  assert.deepEqual(JSON.parse(JSON.stringify(picked)), [{ line:'one', step:'work-2--review' }]);

  // Once finished, the button becomes "Review again · …" and re-reviewing while already scored still shows Reviewing…
  w2.reviewing = false;
  w2.orchScore = 4;
  w2.review = REVIEW;
  host.innerHTML = c.workReviewButtonHTML(p, line, w2);
  assert.ok(host.querySelector('.rev-split.is-done'));
  assert.equal(host.querySelector('.rev-verb').textContent, 'Review again ·');
  w2.reviewing = true;
  assert.match(c.orchRateCardHTML(w2, line), /is-reviewing/);

  // Not shown on archived/closed Lines or non-done Works, and manual Mark all reviewed bar stays intact.
  assert.equal(c.workReviewButtonHTML(p, { ...line, archived:true }, w2), '');
  assert.equal(c.workReviewButtonHTML(p, line, { ...w2, state:'active' }), '');
  assert.match(lineSrc, /data-act="all-reviewed"/);
  assert.match(lineSrc, /Mark all reviewed/);
});

test('active review shows Stop button in card, panel header, and Work rate card; stopped review shows Continue and Send again and calls their endpoints', async () => {
  const h = cardHarness();
  const pendingWork = work({
    id:'work-3', label:'Work 3',
    reviewing:true,
    reviewPending:{ by:'Antigravity · gemini-4-neon · medium effort', agent:'antigravity', model:'gemini-4-neon', effort:'medium', mode:'user', why:'Assigned by you in Orchestrator settings (Reviewer).', startedAt:'2026-11-23T07:58:00.000Z' },
  });
  const host = h.drawThread([pendingWork]);
  const rvCard = host.querySelector('#item-work-3--review');
  const cardStop = rvCard.querySelector('[data-act="review-stop"]');
  assert.ok(cardStop, 'active review card shows Stop button');
  assert.equal(cardStop.dataset.work, 'work-3');
  assert.match(cardStop.textContent, /Stop/);

  const pendingStation = h.c.lineStation(h.line, 'work-3--review');
  const pendingPanel = h.drawPanel(pendingStation);
  const headStop = pendingPanel.querySelector('#lppHead [data-act="review-stop"]');
  assert.ok(headStop, 'active review right-panel header shows Stop button');
  assert.equal(headStop.dataset.work, 'work-3');
  assert.match(h.c.orchRateCardHTML(pendingWork, h.line), /data-act="review-stop"/, 'Work rate card offers Stop while reviewing');

  // Unexpectedly stopped review renders error state with Continue and Send again in card, panel header, panel body, and Work rate card.
  const stoppedWork = work({
    id:'work-3', label:'Work 3',
    reviewing:false,
    reviewStopped:{
      by:'Antigravity · gemini-4-neon · medium effort', agent:'antigravity', model:'gemini-4-neon', effort:'medium',
      mode:'user', why:'Assigned by you in Orchestrator settings (Reviewer).',
      startedAt:'2026-11-23T07:58:00.000Z', stoppedAt:'2026-11-23T07:59:00.000Z',
      stopWhy:'error', reason:'The agent gave no answer (exit 1): connection reset', canContinue:true,
    },
  });
  const stoppedHost = h.drawThread([stoppedWork]);
  const stoppedCard = stoppedHost.querySelector('#item-work-3--review');
  assert.ok(stoppedCard, 'stopped review stays visible as its own node');
  assert.ok(stoppedCard.classList.contains('is-error'));
  assert.match(stoppedCard.textContent, /Stopped with an error/);
  assert.match(stoppedCard.textContent, /connection reset/);
  assert.ok(stoppedCard.querySelector('[data-act="review-continue"]'), 'stopped review card shows Continue button');
  assert.ok(stoppedCard.querySelector('[data-act="review-resend"]'), 'stopped review card shows Send again button');

  const stoppedStation = h.c.lineStation(h.line, 'work-3--review');
  assert.equal(stoppedStation.state, 'error');
  assert.equal(stoppedStation.canContinue, true);
  const stoppedPanel = h.drawPanel(stoppedStation);
  assert.equal(stoppedPanel.querySelector('#lppHead .chip').textContent, 'Stopped');
  assert.ok(stoppedPanel.querySelector('#lppHead [data-act="review-continue"]'), 'panel header shows Continue');
  assert.ok(stoppedPanel.querySelector('#lppHead [data-act="review-resend"]'), 'panel header shows Send again');
  assert.ok(stoppedPanel.querySelector('#lppBody .at-error'), 'panel body shows error banner');
  assert.ok(stoppedPanel.querySelector('#lppBody [data-act="review-continue"]'), 'panel body shows Continue');
  assert.ok(stoppedPanel.querySelector('#lppBody [data-act="review-resend"]'), 'panel body shows Send again');
  const rateStopped = h.c.orchRateCardHTML(stoppedWork, h.line);
  assert.match(rateStopped, /data-act="review-continue"/);
  assert.match(rateStopped, /data-act="review-resend"/);

  // User-stopped review shows Stopped by you styling and still offers Continue and Send again.
  const userStoppedWork = work({
    id:'work-4', label:'Work 4',
    reviewStopped:{ by:'Codex', agent:'codex', mode:'auto', stopWhy:'stopped', reason:'Stopped by you', stoppedAt:'2026-11-23T08:00:00.000Z', canContinue:true },
  });
  const userStoppedHost = h.drawThread([userStoppedWork]);
  const userStoppedCard = userStoppedHost.querySelector('#item-work-4--review');
  assert.ok(userStoppedCard.classList.contains('is-off'));
  assert.match(userStoppedCard.textContent, /Stopped by you/);
  assert.ok(userStoppedCard.querySelector('[data-act="review-continue"]'));
  assert.ok(userStoppedCard.querySelector('[data-act="review-resend"]'));

  // Action handlers hit the stop, continue, and resend endpoints and update station state.
  const { document } = parseHTML('<html><body></body></html>');
  const posts = [], toasts = [];
  const line = { id:'one', slug:'one', status:'done', archived:false, closed:false, stations:[pendingWork] };
  const lineSrc = read('line.js');
  const reviewBlock = slice(lineSrc, "// The server takes a rating only for a Work that finished or was stopped", "function rateButtonsHTML(l, s, cls = '') {");
  const compareRow = slice(lineSrc, "const compareRunMenuRow = (a, b) =>", "// The arrow picks who runs it.");
  const startAct = slice(lineSrc, "const WORK_REVIEW_BUSY = new Set();", "// From a picture to the box");
  const actCtx = vm.createContext({
    document, console, ACT:{}, HOSTED:false, ORCHSET:{ openAfterLoad:false },
    S:{ route:{ view:'line', line:'one' }, lineSel:null, presets:{ presets:[] } },
    AGENTS:{ antigravity:{ id:'antigravity', name:'Antigravity', mono:'Ag', color:'#2563eb' } },
    agentInfo:id => actCtx.AGENTS[id] || { id, name:String(id), mono:'Ag', color:'#5b6472' },
    av:id => `<span class="av">${esc(id)}</span>`, esc, ic,
    isWork:s => !['ask', 'note', 'canvas', 'meeting', 'merge', 'deliver', 'orch-review'].includes(s.kind),
    stepLabel:s => s.label || 'Work 3', orchSettings:() => null,
    project:() => ({ id:'p1' }), pathFor:id => `/projects/${id}`,
    lineById:(_p, id) => (id === line.id ? line : null),
    stationById:(l, id) => l.stations.find(s => s.id === id),
    openMenu() {}, closeMenu() {}, menuAnchorRect:() => null,
    refreshLine() {}, refreshAfterChange() {}, pickStep() {}, go() {},
    toast:msg => toasts.push(msg),
    api:async (url, opts) => {
      posts.push({ url, body:opts?.body });
      if (url.endsWith('/review/stop')) return { ok:true, reviewStopped:{ by:'Antigravity', agent:'antigravity', stopWhy:'stopped', reason:'Stopped by you', canContinue:true } };
      return { ok:true, reviewPending:{ by:'Antigravity', agent:'antigravity', startedAt:'2026-11-23T08:01:00.000Z' } };
    },
    $:(sel, root = document) => root.querySelector(sel), $$:(sel, root = document) => [...root.querySelectorAll(sel)],
  });
  for (const chunk of [reviewBlock, compareRow, startAct]) vm.runInContext(chunk, actCtx);

  actCtx.ACT['review-stop']({ dataset:{ line:'one', work:'work-3' } });
  await turn();
  assert.equal(posts[0].url, '/projects/p1/orchestrator/review/stop');
  assert.equal(pendingWork.reviewing, false);
  assert.equal(pendingWork.reviewStopped.stopWhy, 'stopped');

  actCtx.ACT['review-continue']({ dataset:{ line:'one', work:'work-3' } });
  await turn();
  assert.equal(posts[1].url, '/projects/p1/orchestrator/review/continue');
  assert.equal(pendingWork.reviewing, true);
  assert.equal(pendingWork.reviewStopped, null);

  pendingWork.reviewing = false;
  pendingWork.reviewStopped = { by:'Antigravity', agent:'antigravity', stopWhy:'error', reason:'Boom', canContinue:true };
  actCtx.ACT['review-resend']({ dataset:{ line:'one', work:'work-3' } });
  await turn();
  assert.equal(posts[2].url, '/projects/p1/orchestrator/review/resend');
  assert.equal(pendingWork.reviewing, true);
  assert.equal(pendingWork.reviewStopped, null);
});

test('unified V2 review card renders verdicts, 3-dimension N/A bars, reportMismatch, findings, Send fixes only (as unsent Ask), and Unverified without score', async () => {
  const h = cardHarness();
  const evil = '<img src=x onerror=alert(1)>';

  // 1. Simple Ready review with N/A verification & safety.
  const readyWork = work({
    id:'work-ready', label:'Work 1', orchScore:5, orchBy:'Claude Code',
    review:{
      schema:2, verdict:'ready', score:5, scale:5, outcome:5, verification:null, safety:null,
      requirements:[{ text:'Greet the user', state:'done' }], findings:[],
      note:'Replied cleanly.', by:'Claude Code', agent:'claude', mode:'auto', tools:false, took:'2s',
      at:'2026-11-23T09:00:00.000Z', facts:{ files:0, added:0, removed:0, checks:0 },
    },
  });
  const readyHost = h.drawThread([readyWork]);
  const readyCard = readyHost.querySelector('#item-work-ready--review');
  assert.equal(readyCard.querySelector('.rv-score').textContent, 'Ready · 5/5');
  assert.ok(readyCard.querySelector('.rv-score').classList.contains('v-ready'));
  const readyBars = [...readyCard.querySelectorAll('.rv-bar')];
  assert.deepEqual(readyBars.map(b => b.querySelector('.rv-bar-head span').textContent), ['Outcome', 'Verification', 'Safety & Scope']);
  assert.deepEqual(readyBars.map(b => b.querySelector('.rv-n').textContent), ['5', 'N/A', 'N/A']);
  assert.equal(readyCard.querySelector('[data-act="review-send-fixes"]'), null, 'no Send fixes button when there are no issues');
  assert.equal(readyCard.querySelector('.rv-actions'), null, 'no finished review action bar when there are no actionable findings');

  // 2. Fix-needed review with findings + reportMismatch retains only Send fixes (no Ignore in stats or Re-review), escaping all text.
  const fixWork = work({
    id:'work-fix', label:'Work 2', orchScore:2, orchBy:'Codex',
    review:{
      schema:2, verdict:'fix', score:2, scale:5, outcome:4.5, verification:3, safety:1,
      reportMismatch:`Hid crash ${evil}`,
      requirements:[{ text:'Investigate startup', state:'done' }],
      findings:[{ kind:'risk', where:`server.js:3889 ${evil}`, detail:`Crashed live server ${evil}` }],
      note:'Investigation was thorough but restarted 3889.', by:'Codex', agent:'codex', mode:'auto', tools:true, took:'12s',
      at:'2026-11-23T09:05:00.000Z', facts:{ files:1, added:4, removed:1, checks:2 },
    },
  });
  const fixHost = h.drawThread([fixWork]);
  const fixCard = fixHost.querySelector('#item-work-fix--review');
  assert.equal(fixCard.querySelector('.rv-score').textContent, 'Fix needed · 2/5');
  assert.ok(fixCard.querySelector('.rv-score').classList.contains('v-fix'));
  assert.equal(fixCard.querySelector('img'), null, 'escapes legacy reportMismatch and findings');
  assert.match(fixCard.querySelector('.rv-mismatch').textContent, /Report note/);
  assert.doesNotMatch(fixCard.querySelector('.rv-mismatch').textContent, /−1\.0/);
  assert.equal(fixCard.querySelector('.rv-fkind').textContent, 'Risk');
  const cardBtns = [...fixCard.querySelectorAll('.rv-actions button')];
  assert.deepEqual(cardBtns.map(b => b.dataset.act), ['review-send-fixes'], 'finished review card retains only Send fixes');
  assert.equal(fixCard.querySelector('[data-act="review-ignore"]'), null, 'no Ignore in stats button on review card');
  assert.equal(fixCard.querySelector('[data-act="review-resend"]'), null, 'no Re-review button on finished review card');
  const fixPanel = h.drawPanel(h.c.lineStation(h.line, 'work-fix--review'));
  assert.equal(fixPanel.querySelector('[data-act="review-send-fixes"]'), null, 'finished review panel has no Send fixes button');
  assert.equal(fixPanel.querySelector('.rv-actions'), null, 'finished review panel has no action bar');
  assert.equal(fixPanel.querySelector('[data-act="review-ignore"]'), null, 'no Ignore in stats button in review panel');
  assert.equal(fixPanel.querySelector('[data-act="review-resend"]'), null, 'no Re-review button in finished review panel');

  // Review right panel offers Summary | Original output switcher, showing verbatim rawOutput (or activity fallback) with Copy.
  const rawWork = work({
    id:'work-raw', label:'Work 4', orchScore:4.8, orchBy:'Codex',
    review:{
      schema:2, verdict:'ready', score:4.8, scale:5, outcome:5, verification:4.5, safety:5,
      requirements:[{ text:'Deliver feature', state:'done' }], findings:[],
      note:'All checks passed.', rawOutput:'Checked everything.\n{"verdict":"ready","outcome":5,"verification":4.5,"safety":5}',
      by:'Codex', agent:'codex', mode:'auto', tools:true, took:'9s',
      at:'2026-11-23T09:15:00.000Z', facts:{ files:2, added:20, removed:4, checks:1 },
    },
  });
  h.drawThread([rawWork]);
  const rawStation = h.c.lineStation(h.line, 'work-raw--review');
  h.c.S.reviewPanelMode = 'summary';
  const sumPanel = h.drawPanel(rawStation);
  assert.equal(sumPanel.querySelector('[data-act="review-panel-mode"][data-mode="summary"]').getAttribute('aria-selected'), 'true');
  assert.equal(sumPanel.querySelector('[data-act="review-panel-mode"][data-mode="raw"]').getAttribute('aria-selected'), 'false');
  assert.ok(sumPanel.querySelector('[aria-label="Rating breakdown"]'));
  assert.equal(sumPanel.querySelector('.rv-actions'), null, 'no action bar in right panel when there are no actionable findings');

  // Reviews run with Line context show the updated Review access description in the right panel.
  const lineCtxWork = work({
    id:'work-linectx', label:'Work 6', orchScore:5, orchBy:'Kimi',
    review:{
      schema:2, verdict:'ready', score:5, scale:5, outcome:5, verification:5, safety:5,
      requirements:[{ text:'Review with Line context', state:'done' }], findings:[],
      note:'Checked directly in workspace.', by:'Kimi', agent:'kimi', mode:'auto', tools:true, contextMode:'line', took:'6s',
      at:'2026-11-23T09:25:00.000Z',
    },
  });
  h.drawThread([lineCtxWork]);
  const lineCtxPanel = h.drawPanel(h.c.lineStation(h.line, 'work-linectx--review'));
  assert.match(lineCtxPanel.querySelector('.lpp-rv-dl').textContent, /Same Line context and workspace access as a regular job/);

  h.c.S.reviewPanelMode = 'raw';
  const rawPanel = h.drawPanel(rawStation);
  assert.equal(rawPanel.querySelector('[data-act="review-panel-mode"][data-mode="raw"]').getAttribute('aria-selected'), 'true');
  assert.match(rawPanel.querySelector('.lpp-rv-raw-pre').textContent, /Checked everything\.\n\{"verdict":"ready"/);
  assert.ok(rawPanel.querySelector('[data-act="review-copy-raw"]'), 'offers Copy button in Original output view');

  // Legacy review without saved rawOutput falls back to the review step's latest activity say row.
  const legacyWork = work({
    id:'work-legacy', label:'Work 5', orchScore:4, orchBy:'Kimi',
    review:{
      schema:2, verdict:'caveats', score:4, scale:5, outcome:4, verification:4, safety:4,
      requirements:[{ text:'Check legacy fallback', state:'done' }], findings:[],
      note:'Legacy review without rawOutput field.', by:'Kimi', agent:'kimi', mode:'user', tools:false, took:'5s',
      at:'2026-11-23T09:20:00.000Z', facts:{ files:0, added:0, removed:0, checks:0 },
    },
  });
  h.drawThread([legacyWork]);
  const legacyStation = h.c.lineStation(h.line, 'work-legacy--review');
  h.c.activityOf = () => ({ rows:new Map([
    [1, { i:1, step:'work-legacy--review', kind:'start', agent:'opencode', at:0 }],
    [2, { i:2, step:'work-legacy--review', kind:'say', text:'{"verdict":"unverified"}' }],
    [3, { i:3, step:'work-legacy--review', kind:'start', agent:'kimi', at:1 }],
    [4, { i:4, step:'work-legacy--review', kind:'say', text:'{"verdict":"caveats","outcome":4,"note":"From Kimi activity log"}' }],
  ]) });
  h.c.rowsOfStep = (a, st) => [...a.rows.values()].filter(r => r.step === st.id).sort((x, y) => x.i - y.i);
  const legacyPanel = h.drawPanel(legacyStation);
  assert.match(legacyPanel.querySelector('.lpp-rv-raw-pre').textContent, /From Kimi activity log/);
  assert.doesNotMatch(legacyPanel.querySelector('.lpp-rv-raw-pre').textContent, /unverified/, 'uses latest attempt output');
  delete h.c.activityOf; delete h.c.rowsOfStep;
  h.c.S.reviewPanelMode = 'summary';

  // 3. Unverified review omits score completely and shows no finished-review action buttons.
  const unvWork = work({
    id:'work-unv', label:'Work 3',
    review:{
      schema:2, verdict:'unverified', scale:5, outcome:null, verification:null, safety:null,
      requirements:[{ text:'Verify benchmark', state:'partly' }],
      findings:[{ kind:'unverified', where:'bench.log', detail:'Benchmark output omitted.' }],
      note:'Attach benchmark output to verify.', by:'Codex', agent:'codex', mode:'auto', tools:false, took:'4s',
      at:'2026-11-23T09:10:00.000Z', facts:{ files:0, added:0, removed:0, checks:0 },
    },
  });
  const unvHost = h.drawThread([unvWork]);
  const unvCard = unvHost.querySelector('#item-work-unv--review');
  assert.equal(unvCard.querySelector('.rv-score').textContent, 'Unverified');
  assert.doesNotMatch(unvCard.querySelector('.rv-score').textContent, /\/5/);
  assert.equal(unvCard.querySelector('.rv-bars'), null, 'no bars for unverified review');
  assert.equal(unvCard.querySelector('[data-act="review-send-fixes"]'), null, 'unverified finding does not offer Send fixes');
  assert.equal(unvCard.querySelector('[data-act="review-ignore"]'), null, 'no Ignore in stats button');
  assert.equal(unvCard.querySelector('[data-act="review-resend"]'), null, 'no Re-review button on unverified card');
  const unvStop = h.document.querySelector('#list .lps:last-child');
  assert.ok(unvStop.classList.contains('is-unverified'));
  assert.equal(unvStop.querySelector('.lps-title').textContent, 'Review');
  assert.equal(unvStop.querySelector('.lps-badge').textContent, 'Unverified');
  assert.match(unvStop.getAttribute('aria-label'), /Orchestrator review · Unverified/);
  const unvRateCard = h.c.orchRateCardHTML(unvWork, h.line);
  assert.match(unvRateCard, /Unverified/);
  assert.doesNotMatch(unvRateCard, /\/5/);

  // 4. Action handler: Send fixes posts an unsent Ask via POST /unsent (same as normal Send to AI, never auto-starting via sendFeedback),
  //    adds the optimistic unsent Ask immediately when showAtOnce/saveBehind are wired, and ACT['review-ignore'] is removed.
  const { document } = parseHTML('<html><body></body></html>');
  const posts = [], sentFeedback = [], toasts = [], scrolled = [];
  const line = { id:'one', slug:'one', status:'done', archived:false, closed:false, stations:[fixWork] };
  const proj = { id:'p1', lines:[line], landed:[], backlog:[] };
  const lineSrc = read('line.js');
  const composerSrc = read('composer.js');
  const reviewBlock = slice(lineSrc, "// The server takes a rating only for a Work that finished or was stopped", "function rateButtonsHTML(l, s, cls = '') {");
  const compareRow = slice(lineSrc, "const compareRunMenuRow = (a, b) =>", "// The arrow picks who runs it.");
  const startAct = slice(lineSrc, "const WORK_REVIEW_BUSY = new Set();", "// From a picture to the box");
  const savingBlock = slice(composerSrc, "const comp = key =>", "function composerHTML(")
    + '\n' + slice(composerSrc, "// ---------- On the line at once, written behind it ----------", "// A drawing that starts a line of its own:");
  const actCtx = vm.createContext({
    document, console, ACT:{}, HOSTED:false, ORCHSET:{ openAfterLoad:false },
    KIND:{ ask:{ label:'Ask' }, note:{ label:'Note' } },
    S:{ cur:'p1', route:{ view:'line', line:'one' }, lineSel:null, panelPopped:true, presets:{ presets:[] }, comp:{} },
    AGENTS:{ codex:{ id:'codex', name:'Codex', mono:'Cx', color:'#10a37f' } },
    agentInfo:id => actCtx.AGENTS[id] || { id, name:String(id), mono:'Ag', color:'#5b6472' },
    av:id => `<span class="av">${esc(id)}</span>`, esc, ic,
    isWork:s => !['ask', 'note', 'canvas', 'meeting', 'merge', 'deliver', 'orch-review'].includes(s.kind),
    stepLabel:s => s.label || 'Work 2', orchSettings:() => null,
    project:() => proj, pathFor:id => `/projects/${id}`,
    allLines:p => [...(p.lines || []), ...(p.landed || []), ...(p.backlog || [])],
    lineById:(_p, id) => (id === line.id ? line : null),
    stationById:(l, id) => l.stations.find(s => s.id === id),
    openMenu() {}, closeMenu() {}, menuAnchorRect:() => null,
    refreshLine() {}, refreshAfterChange() {}, readOpenedLine() {}, refreshSentProjects() {},
    loadState:async () => {}, pickStep() {}, go() {},
    setPanelPopped:on => { actCtx.S.panelPopped = on; },
    scrollToItem:id => scrolled.push(id),
    syncComposer() {}, toast:msg => toasts.push(msg),
    sendFeedback:async (l, body) => { sentFeedback.push({ line:l.id, ...body }); },
    api:async (url, opts) => {
      posts.push({ url, method:opts?.method, body:opts?.body });
      return { slug:'one', added:true, step:'ask-2' };
    },
    $:(sel, root = document) => root.querySelector(sel), $$:(sel, root = document) => [...root.querySelectorAll(sel)],
  });
  for (const chunk of [savingBlock, reviewBlock, compareRow, startAct]) vm.runInContext(chunk, actCtx);

  assert.equal(actCtx.ACT['review-ignore'], undefined, 'ACT[review-ignore] is removed');
  actCtx.ACT['review-send-fixes']({ dataset:{ line:'one', work:'work-fix' } });
  await turn();
  await turn();
  assert.equal(sentFeedback.length, 0, 'Send fixes must NOT auto-start via sendFeedback');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, '/projects/p1/unsent');
  assert.equal(posts[0].method, 'POST');
  assert.equal(posts[0].body.topic, 'one');
  assert.deepEqual([...posts[0].body.attachments], []);
  assert.deepEqual([...posts[0].body.refers], []);
  assert.match(posts[0].body.text, /Please fix the issues flagged in the review of Work 2/);
  assert.match(posts[0].body.text, /\[Risk\]/);
  assert.match(posts[0].body.text, /Crashed live server/);
  assert.equal(actCtx.S.panelPopped, false, 'unpops fullscreen panel so the user sees the new unsent Ask');
  const addedAsk = line.stations.find(st => st.id === 'ask-2');
  assert.ok(addedAsk, 'adds the new Ask to the Line immediately and settles its server step id');
  assert.equal(addedAsk.kind, 'ask');
  assert.equal(addedAsk.unsent, true, 'added Ask stays unsent so the user must click Run with');
  assert.equal(addedAsk.via, 'Not sent');
  assert.equal(scrolled.length, 1, 'scrolls to the newly added unsent Ask');
  assert.match(toasts.at(-1), /Run with/);

  // 5. Sessions score badge and Statistics agent record detail handle verdicts, source split, and findings rollup.
  const sh = settingsHarness();
  sh.c.reviewScoreWords = h.c.reviewScoreWords;
  assert.equal(sh.c.orchReviewScoreHTML({ reviewVerdict:'unverified' }), '<span class="orch-review-score" title="Review">Unverified</span>');
  assert.equal(sh.c.orchReviewScoreHTML({ reviewScore:4.3, reviewVerdict:'caveats' }), '<span class="orch-review-score" title="Review">Check caveats · 4.3/5</span>');
  const orchSrc = read('orchestrator.js');
  const recCtx = vm.createContext({ esc, ic, ORCH_KIND:{ code:'Code' }, orchMoney:n => `$${n.toFixed(2)}`, orchRate:n => `${n.toFixed(1)}/5`, orchRateTone:() => 'is-high' });
  vm.runInContext(slice(orchSrc, 'function orchFindingsSummary(findings) {', 'function orchRecordHTML() {') + '\n' + slice(orchSrc, 'function orchRateDetail(r) {', 'function orchAgentsHTML('), recCtx);
  assert.equal(recCtx.orchRateDetail({ score:4.5, rating:4.5, bySource:{ reviewer:{ score:4.2, count:2 }, coordinator:{ score:4.8, count:2 } }, findings:{ bug:1, gap:2 }, good:1, bad:0 }),
    '<small>Reviewer 4.2 · Coordinator 4.8 · 1 good · 0 not · 1 bug · 2 gaps</small>');
  assert.match(recCtx.orchRecordExpandHTML({ byKind:[{ kind:'code', works:2, rating:4.3, score:4.3, good:0, bad:0, findings:{ bug:2, unverified:1 } }] }), /2 bugs · 1 unverified/);
});

test('left timeline rail uses opaque review markers, scannable structured Work/Review rows without prose dumps, and persists fold state', () => {
  const h = cardHarness();
  const askSt = { id:'ask-1', index:0, kind:'ask', state:'done', text:'add a section in settings about cloud sync', files:[], pictures:[], refers:[] };
  const workDone = work({ id:'work-1', index:1, label:'Work 1', out:'Long verbose markdown prose that should not clutter the rail.', reviewed:false, review:{ ...REVIEW, verdict:'caveats', score:4.4 } });
  const workReviewed = work({ id:'work-2', index:2, label:'Work 2', agent:'antigravity', took:'4 min', out:'Another verbose reply.', reviewed:true, reviewStopped:{ stopWhy:'error', reason:'Timeout', agent:'claude', mode:'auto' } });
  const workActive = work({ id:'work-3', index:3, label:'Work 3', state:'active', took:'', now:'Running checks…', out:'' });
  h.drawThread([askSt, workDone, workReviewed, workActive]);

  const rows = [...h.document.querySelectorAll('#list .lps')];
  assert.equal(rows.length, 6);
  // Ask keeps a single-line title anchor.
  assert.equal(rows[0].querySelector('.lps-yours').textContent, 'add a section in settings about cloud sync');
  // Work rows show step label + status pill + agent/duration metadata instead of truncated LLM prose.
  assert.equal(rows[1].querySelector('.lps-title').textContent, 'Work 1');
  assert.equal(rows[1].querySelector('.lps-badge').textContent, 'Unreviewed');
  assert.doesNotMatch(rows[1].textContent, /Long verbose markdown prose/);
  assert.match(rows[1].querySelector('.lps-meta').textContent, /Codex/);
  assert.match(rows[1].querySelector('.lps-meta').textContent, /6 min/);
  // Review row shows compact Review title + color-coded score pill, and keeps full verdict in aria-label.
  assert.equal(rows[2].querySelector('.lps-title').textContent, 'Review');
  assert.equal(rows[2].querySelector('.lps-score').textContent, '4.4/5');
  assert.ok(rows[2].querySelector('.lps-score').classList.contains('v-caveats'));
  assert.match(rows[2].getAttribute('aria-label'), /4\.4\/5/);
  // Reviewed Work + stopped Review + active Work badges.
  assert.equal(rows[3].querySelector('.lps-badge').textContent, 'Reviewed');
  assert.equal(rows[4].querySelector('.lps-badge').textContent, 'Stopped');
  assert.equal(rows[5].querySelector('.lps-badge').textContent, 'Working');

  // CSS guarantees the Orchestrator review marker uses an opaque fill (no translucent --accent-soft rail bleed-through)
  // and defines explicit error/off/unverified node styles.
  const lineCss = read('line.css');
  assert.match(lineCss, /\.lps\.k-orch-review:not\(\.st-active\)\s*\.lps-node\s*\{[^}]*color-mix\(in srgb,\s*var\(--accent\)\s*\d+%,\s*var\(--paper\)\)/);
  assert.doesNotMatch(lineCss, /\.lps\.k-orch-review:not\(\.st-active\)\s*\.lps-node\s*\{[^}]*background:\s*var\(--accent-soft\)/);
  assert.match(lineCss, /\.lps\.k-orch-review\.st-error\s*\.lps-node\s*\{[^}]*background:\s*var\(--red\)/);

  // Fold toggle persists preference to localStorage and updates button aria state.
  const { document: foldDoc } = parseHTML('<html><body><div id="linePage" class="lp"><button class="lp-fold" aria-label="Fold the line" aria-pressed="false"></button></div></body></html>');
  const store = {};
  const lineSrc = read('line.js');
  const foldBlock = slice(lineSrc, "ACT['line-fold'] = ", "ACT['line-side'] = ");
  const foldCtx = vm.createContext({
    ACT:{}, S:{ lineFolded:false }, LINE_FOLDED_KEY:'penecho-line-folded-v1',
    localStorage:{ getItem:k => store[k] ?? null, setItem:(k, v) => { store[k] = v; } },
    $:sel => foldDoc.querySelector(sel), hideStopCard() {},
  });
  vm.runInContext(foldBlock, foldCtx);
  const btn = foldDoc.querySelector('.lp-fold');
  foldCtx.ACT['line-fold'](btn);
  assert.equal(foldCtx.S.lineFolded, true);
  assert.equal(store['penecho-line-folded-v1'], '1');
  assert.ok(foldDoc.querySelector('#linePage').classList.contains('folded'));
  assert.equal(btn.getAttribute('aria-pressed'), 'true');
  assert.equal(btn.getAttribute('aria-label'), 'Expand the line');
  foldCtx.ACT['line-fold'](btn);
  assert.equal(foldCtx.S.lineFolded, false);
  assert.equal(store['penecho-line-folded-v1'], '0');
  assert.equal(foldDoc.querySelector('#linePage').classList.contains('folded'), false);
  assert.equal(btn.getAttribute('aria-pressed'), 'false');
});

test('a real server-stored orch-review station renders once without duplicating a synthetic review node', () => {
  const h = cardHarness();
  const w = work({ id:'work-1', index:0, orchScore:4, orchBy:REVIEW.by, review:REVIEW });
  const storedRv = {
    id:'work-1--review', index:1, kind:'orch-review', isOrchReview:true,
    workId:'work-1', workLabel:'Work 1', workAgent:'codex', workTook:'6 min',
    label:'Orchestrator review', state:'done', reviewing:false,
    review:REVIEW, reviewPending:null, reviewStopped:null,
    agent:'antigravity', took:'18s', when:REVIEW.at, out:REVIEW.note,
    text:REVIEW.note, files:[], pictures:[], refers:[], detail:'works/one/work-1--review.md',
  };
  const host = h.drawThread([w, storedRv]);
  assert.equal(host.querySelectorAll('.lp-orch-review').length, 1, 'renders exactly one review node card');
  assert.equal(h.document.querySelectorAll('#list .lps.k-orch-review').length, 1, 'renders exactly one review row in the left rail');
  assert.equal(host.querySelector('#item-work-1--review .rv-score').textContent, '4/5 · Minor gaps');
  assert.equal(h.c.lineStation(h.line, 'work-1--review').detail, 'works/one/work-1--review.md');
});

test('auto-assigned review card, rate card, panel, and reviewer settings list model & effort when available without duplication', async () => {
  const h = cardHarness();
  const evil = '<img src=x onerror=alert(1)>';

  // 1. Bare reviewer name ("Codex") with model + effort shows specs right beside the name and in the rate card.
  const bothWork = work({
    id:'work-1',
    orchScore:3.9,
    orchBy:'Codex',
    review:{
      schema:2, verdict:'fix', score:3.9, scale:5, outcome:4, verification:4, safety:3.5,
      requirements:[{ text:'Open drawings faster', state:'done' }], findings:[],
      note:'Checked.', by:'Codex', agent:'codex', model:'gpt-6.2-sol', effort:'xhigh',
      mode:'auto', why:'Your assigned reviewer (Claude Code · opus · medium effort · full access) did this work, so Auto picked the highest-rated coding agent that did not do this work.',
      took:'2 min', at:'2026-11-25T00:44:14.198Z',
    },
  });
  const host = h.drawThread([bothWork]);
  const rv = host.querySelector('#item-work-1--review');
  assert.equal(rv.querySelector('.rv-agent-name').textContent, 'Codex');
  assert.equal(rv.querySelector('.rv-agent-specs').textContent, 'gpt-6.2-sol · xhigh effort');
  assert.match(h.c.orchRateCardHTML(bothWork, h.line), /Codex · gpt-6\.2-sol · xhigh effort/);

  // 2. When `by` already contains model & effort (e.g. REVIEW), `.rv-agent-specs` is omitted so nothing is duplicated.
  const fullHost = h.drawThread([work({ id:'work-full', review:REVIEW })]);
  assert.equal(fullHost.querySelector('#item-work-full--review .rv-agent-name').textContent, REVIEW.by);
  assert.equal(fullHost.querySelector('#item-work-full--review .rv-agent-specs'), null);

  // 3. Partial or missing specs: only model, only effort, or neither.
  const modelOnly = h.drawThread([work({ id:'work-m', review:{ ...bothWork.review, effort:'' } })]);
  assert.equal(modelOnly.querySelector('#item-work-m--review .rv-agent-specs').textContent, 'gpt-6.2-sol');
  const effortOnly = h.drawThread([work({ id:'work-e', review:{ ...bothWork.review, model:'' } })]);
  assert.equal(effortOnly.querySelector('#item-work-e--review .rv-agent-specs').textContent, 'xhigh effort');
  const none = h.drawThread([work({ id:'work-n', review:{ ...bothWork.review, model:'', effort:'' } })]);
  assert.equal(none.querySelector('#item-work-n--review .rv-agent-specs'), null);

  // 4. Older saved review with empty model/effort falls back to the matching preset's effectiveModel & effectiveEffort.
  h.c.S.presets = { presets:[{ id:'44fdf903202c', name:'Codex', agent:'codex', model:'', effort:'', effectiveModel:'gpt-6.2-sol', effectiveEffort:'xhigh' }] };
  const legacyWork = work({ id:'work-legacy-preset', orchScore:3.9, orchBy:'Codex', review:{ ...bothWork.review, model:'', effort:'', presetId:'44fdf903202c' } });
  const legacyHost = h.drawThread([legacyWork]);
  assert.equal(legacyHost.querySelector('#item-work-legacy-preset--review .rv-agent-specs').textContent, 'gpt-6.2-sol · xhigh effort');
  const legacyPanel = h.drawPanel(h.c.lineStation(h.line, 'work-legacy-preset--review'));
  assert.equal(legacyPanel.querySelector('.lpp-rv-specs').textContent, 'gpt-6.2-sol · xhigh effort');
  assert.match(h.c.orchReviewPanelWhere(h.line, h.c.lineStation(h.line, 'work-legacy-preset--review')), /gpt-6\.2-sol.*xhigh effort/);

  // 5. Malicious model/effort strings are escaped.
  const evilHost = h.drawThread([work({ id:'work-xss', review:{ ...bothWork.review, model:evil, effort:evil } })]);
  assert.equal(evilHost.querySelector('img'), null);
  assert.match(evilHost.querySelector('#item-work-xss--review .rv-agent-specs').textContent, /<img src=x onerror=alert\(1\)>/);

  // 6. Reviewer dropdown in Orchestrator settings appends effective model & effort when omitted from preset name.
  const sh = settingsHarness({
    settings:{
      ...SETTINGS(),
      reviewers:[
        { id:'codex-def', name:'Codex', agent:'codex', model:'', effort:'' },
        { id:'claude-pin', name:'Claude Code · claude-opus-5-5 · high effort', agent:'claude', model:'claude-opus-5-5', effort:'high' },
      ],
    },
  });
  sh.c.S.presets = { presets:[{ id:'codex-def', name:'Codex', agent:'codex', model:'', effort:'', effectiveModel:'gpt-6.2-sol', effectiveEffort:'xhigh' }] };
  await sh.c.loadOrchSettings();
  sh.c.ACT['orch-settings']();
  await turn();
  assert.deepEqual([...sh.document.querySelectorAll('#orchSetReviewer option')].map(o => o.textContent), [
    'Auto',
    'Codex · gpt-6.2-sol · xhigh effort',
    'Claude Code · claude-opus-5-5 · high effort',
  ]);
});
