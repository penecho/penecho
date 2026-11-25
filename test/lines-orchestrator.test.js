'use strict';
// PE-620: the Orchestrator asks a plain question and shows coordinated Works on ordinary Lines.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('./helpers/dom.js');

const source = ['orchestrator.js', 'prices.js'].map(file => fs.readFileSync(path.join(__dirname, '../public/lines', file), 'utf8')).join('\n;\n');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness({ platform = 'Mac', realLoad = false, timers = null, preferences = new Map(), session = new Map(), blobs = new Map() } = {}) {
  const { document, window } = parseHTML('<html><body><div id="orchBox"></div><div id="orchSessions"></div></body></html>');
  Object.defineProperty(document, 'activeElement', { configurable:true, get:() => null });
  const requests = [], toasts = [], uploads = [], previews = [], menus = [], settings = [];
  let ids = 0;
  if (!preferences.has('penecho-orchestrator-agent-v1')) preferences.set('penecho-orchestrator-agent-v1', 'saved');
  const c = vm.createContext({
    document, window, console, crypto:require("node:crypto").webcrypto, ACT:{}, HOSTED:false,
    S:{ comp:{}, route:{ view:'orchestrator' }, presets:{ default:'first', presets:[
      { id:'first', name:'First agent', agent:'first', available:true },
      { id:'saved', name:'Saved agent', agent:'saved', available:true },
    ] } },
    localStorage:{
      getItem:key => preferences.get(key) ?? null,
      setItem:(key, value) => preferences.set(key, value),
      removeItem:key => preferences.delete(key),
      get length() { return preferences.size; },
      key:i => [...preferences.keys()][i] ?? null,
    },
    sessionStorage:{
      getItem:key => session.get(key) ?? null,
      setItem:(key, value) => session.set(key, value),
      removeItem:key => session.delete(key),
    },
    $:(selector, root = document) => root.querySelector(selector),
    $$:(selector, root = document) => [...root.querySelectorAll(selector)],
    EMBED:false, ICONS:{}, navigator:{ platform }, addEventListener() {}, getComputedStyle:() => ({ lineHeight:'22', paddingTop:'4', paddingBottom:'4' }),
    esc, ic:() => '', av:() => '', fmtSize:n => `${Math.max(1, Math.round(n / 1024))} KB`, FILE_ICON:() => 'file', uid:p => `${p}${++ids}`,
    URL:{ createObjectURL:file => `blob:${file.name}` },
    can:() => true,
    uploadFiles:(p, files) => { const pending = deferred(); uploads.push({ files, ...pending }); return pending.promise; },
    openLightbox:(p, target, options) => previews.push([p, target, options]),
    project:() => ({ id:'project' }), pathFor:id => `/api/lines/projects/${id}`,
    toast:(message, action) => toasts.push({ message, action }), go() {},
    openMenu:(anchor, items, options) => menus.push({ anchor, items, options }),
    agentInfo:id => ({ name:id, mono:id.slice(0, 2).toUpperCase(), color:'#123456' }),
    LINE_STATUS:require('../public/lines/line-status.js'),
    allLines:p => p.lines || [], lineById:() => null, shownState:() => 'done', STATE_TEXT:{ done:'Done', working:'Working' }, plainOut:String,
    queueMicrotask:fn => fn(),
    ...(timers ? { setTimeout:(fn, ms) => timers.push({ fn, ms }), clearTimeout:id => { if (timers[id - 1]) timers[id - 1].fn = () => {}; } } : {}),
  });
  c.api = (url, options = {}) => {
    const pending = deferred();
    requests.push({ url, options, ...pending });
    return pending.promise;
  };
  const run = code => vm.runInContext(code, c);
  for (const file of ['composer.js', 'make.js', 'work-pricing.js', 'stats.js']) run(fs.readFileSync(path.join(__dirname, '../public/lines', file), 'utf8'));
  Object.assign(c, { WORK_PRICING:window.WORK_PRICING, computeProjectStats:window.computeProjectStats, agentShareHTML:window.agentShareHTML, projectAgentShareHTML:window.projectAgentShareHTML });
  run(source);
  c.ACT['open-agents'] = () => settings.push('agents');
  // Each harness is a new document. Only the browser's two storage areas survive.
  c.orchDraftFile = async (_mode, work) => work({
    put:(blob, key) => blobs.set(key, structuredClone(blob)),
    get:key => blobs.get(key),
    delete:key => blobs.delete(key),
  });
  run('orchUseProject(project())');
  // Starting is under test, not the refresh of the rest of the page that follows it.
  if (!realLoad) run('loadOrchestrator = async () => {}');
  const state = run('ORCH');
  const render = () => run("orchPaint('orchBox', orchBoxHTML(), true)");
  render();
  const openPicker = () => { c.ACT['orch-agent'](document.querySelector('#orchAgent')); return menus.at(-1).items; };
  return { c, run, state, document, window, requests, toasts, uploads, previews, render, openPicker, menus, settings };
}

const flush = async (times = 8) => { for (let i = 0; i < times; i++) await Promise.resolve(); };

function type(h, value) {
  const field = h.document.querySelector('#orchGoal');
  field.value = value;
  field.dispatchEvent(new h.window.Event('input', { bubbles:true }));
}

const OUTBOX = 'penecho-orchestrator-outbox-v1:';
const outbox = h => h.run('orchStored()');
const jobs = h => h.run('ORCH_JOBS');
const jobButton = (h, what) => h.document.querySelector(`[data-act="orch-job-${what}"]`);

function enter(h, modifier) {
  const event = new h.window.Event('keydown', { bubbles:true, cancelable:true });
  Object.assign(event, { key:'Enter', shiftKey:false, ctrlKey:false, metaKey:false, isComposing:false, ...modifier });
  h.document.querySelector('#orchGoal').dispatchEvent(event);
  return event;
}

test('the default composer is one question with the saved agent and Start, without a mode switch or review checkbox', () => {
  const h = harness(), box = h.document.querySelector('#orchBox');
  assert.equal(box.querySelectorAll('textarea').length, 1);
  assert.ok(box.querySelector('#orchGoal[placeholder="What should get done or discussed?"]'));
  assert.equal(box.querySelector('button#orchAgent').dataset.orchPreset, 'saved');
  assert.equal(box.querySelector('#orchReview'), null);
  assert.equal(box.querySelector('.orch-check'), null);
  assert.deepEqual([...h.run('ORCH_FIT_STEPS')], ['short-agent', 'tight-agent', 'icon-agent', 'icon-send']);
  assert.match(box.querySelector('[data-act="orch-start"]').textContent, /Start/);
  assert.equal(box.querySelectorAll('[role="tablist"], [role="tab"], [data-act="orch-mode"], #orchMode').length, 0);
  const buttonNames = [...box.querySelectorAll('button')].map(button => button.textContent.trim());
  assert.equal(buttonNames.some(name => name === 'Job' || name === 'Roundtable'), false);
});

test('the Start picker follows manual visibility even when a hidden preset was selected before', () => {
  const h = harness(), [manual, hidden] = h.c.S.presets.presets;
  manual.allowDelegation = false;
  hidden.showInPicker = false;
  h.render();
  const options = [...h.openPicker()].filter(item => 'checked' in item);
  assert.deepEqual(options.map(item => item.label), [`${manual.name} · Runner default model · Runner default effort`]);
  assert.equal(options[0].checked, true);
  manual.showInPicker = false;
  h.render();
  assert.equal(h.document.querySelector('#orchAgent'), null);
  assert.ok(h.document.querySelector('[data-act="open-agents"]'));
});

test('the Start picker sorts visible names without changing the coordinator precedence', () => {
  const h = harness();
  h.c.S.presets.presets = [
    { id:'first', name:'PenEcho', agent:'penecho', available:true },
    { id:'saved', name:'Codex 10', agent:'codex', available:true },
    { id:'open', name:'OpenCode', agent:'opencode', available:true },
    { id:'two', name:'Codex 2', agent:'codex', available:true },
    { id:'omp', name:'omp', agent:'omp', available:true },
  ];
  const selected = () => h.document.querySelector('#orchAgent').dataset.orchPreset;

  h.render();
  assert.deepEqual([...h.openPicker()].filter(item => 'checked' in item).map(item => item.label),
    ['Codex 2', 'Codex 10', 'omp', 'OpenCode', 'PenEcho'].map(name => `${name} · Runner default model · Runner default effort`));
  assert.equal(selected(), 'saved');
  assert.deepEqual(h.c.S.presets.presets.map(preset => preset.id), ['first', 'saved', 'open', 'two', 'omp']);

  h.c.localStorage.setItem('penecho-orchestrator-agent-v1', 'missing');
  h.c.S.presets.default = 'open';
  h.render();
  assert.equal(selected(), 'open');

  h.c.S.presets.default = 'missing';
  h.render();
  assert.equal(selected(), 'first');
});

test('the Start picker shows compact rows and ends with Manage agents without selecting or starting', () => {
  const h = harness();
  h.run("Object.assign(ORCHSET, { project:'project', data:{} })");
  h.c.S.presets.presets = [
    { id:'saved', name:'Codex', agent:'codex', available:true, effectiveModel:'configured-model', effectiveEffort:'xhigh' },
    { id:'pinned', name:'Claude Code · opus · high effort · full access', pickerName:'Claude Code', agent:'claude', available:true, model:'opus', effort:'high', access:'full' },
    { id:'auto:omp', name:'omp', agent:'omp', available:true, auto:true },
  ];
  h.render();
  type(h, 'Keep this draft');
  assert.match(h.document.querySelector('#orchAgent').getAttribute('aria-label'), /Codex · configured-model · xhigh effort/);
  const [auto, pinned, saved, omp, separator, manage] = h.openPicker();
  assert.equal(h.menus.at(-1).options.className, 'run-menu');
  assert.equal(auto.label, 'PenEcho Auto · Model and effort chosen automatically');
  assert.equal(pinned.label, 'Claude Code · opus · high effort · full access');
  assert.equal(saved.label, 'Codex · configured-model · xhigh effort');
  assert.equal(saved.checked, true);
  assert.equal(omp.label, 'omp · Runner default model · Runner default effort');
  assert.ok([auto, pinned, saved, omp].every(item => !item.note));
  assert.equal(separator.sep, true);
  assert.equal(manage.label, 'Manage agents…');
  assert.equal(manage.icon, 'gear');
  assert.equal(manage.checked, undefined);
  manage.fn();
  assert.deepEqual(h.settings, ['agents']);
  assert.equal(h.document.querySelector('#orchAgent').dataset.orchPreset, 'saved');
  assert.equal(h.state.draft.text, 'Keep this draft');
  assert.equal(h.requests.length, 0);
  pinned.fn();
  assert.equal(h.document.querySelector('#orchAgent').dataset.orchPreset, 'pinned');
  assert.equal(h.document.querySelector('#orchGoal').value, 'Keep this draft');
  assert.equal(h.requests.length, 0);
  h.c.HOSTED = true;
  assert.ok(h.openPicker().every(item => 'checked' in item));
});

test('Start posts the unprefixed question and saved preset, and ignores any stale reviewForYou draft flag', async () => {
  const h = harness();
  h.state.draft.flags.reviewForYou = true;
  h.c.rememberBoxes();
  assert.equal(h.c.sessionStorage.getItem('penecho-lines-boxes'), '{}');
  type(h, '  Should this stay one Line?\nDiscuss the trade-offs.  ');
  const starting = h.c.ACT['orch-start']();
  assert.equal(h.state.draft.text, '', 'the box is free for the next job at once');
  assert.equal(h.document.querySelector('#orchGoal').value, '');
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, '/api/lines/projects/project/orchestrator');
  assert.equal(h.requests[0].options.method, 'POST');
  assert.deepEqual({ ...h.requests[0].options.body }, {
    goal:'Should this stay one Line?\nDiscuss the trade-offs.', preset:'saved', requestId:jobs(h)[0].id,
  });
  h.requests[0].resolve({ line:'orchestrator-line' });
  await starting;
  assert.equal(h.state.draft.flags.reviewForYou, undefined);
  assert.equal(h.document.querySelector('#orchGoal').value, '');
});

test('a failed start keeps the job on a card with Retry, Edit and Discard, and never in two places', async () => {
  const preferences = new Map(), h = harness({ preferences }), question = 'Keep this question after the failure';
  type(h, question);
  const starting = h.c.ACT['orch-start']();
  type(h, 'The next job');
  h.requests[0].reject(Object.assign(new Error('Choose a runnable agent.'), { status:400, code:'BAD_AGENT' }));
  await starting;
  assert.equal(h.state.draft.text, 'The next job');
  assert.deepEqual(h.toasts.map(item => item.message), ['Choose a runnable agent.']);
  const card = h.document.querySelector('.orch-run');
  assert.match(card.textContent, /Not sent/);
  assert.match(card.querySelector('.orch-reason').textContent, /Choose a runnable agent/);
  assert.equal(outbox(h)[0].state, 'failed');
  // A fresh page shows it again and does not start it by itself.
  const next = harness({ preferences });
  next.c.orchPaintAll();
  assert.equal(next.requests.length, 0);
  assert.ok(jobButton(next, 'retry'));
  // Edit waits for the box to be free.
  h.c.ACT['orch-job-edit'](jobButton(h, 'edit'));
  assert.equal(h.state.draft.text, 'The next job');
  assert.equal(h.toasts.at(-1).message, 'Send or clear what is in the box first.');
  // Retry sends the same request.
  const again = h.c.ACT['orch-job-retry'](jobButton(h, 'retry'));
  assert.equal(h.requests[1].options.body.requestId, h.requests[0].options.body.requestId);
  h.requests[1].reject(Object.assign(new Error('No'), { status:400 }));
  await again;
  h.c.ACT['orch-job-discard'](jobButton(h, 'discard'));
  assert.equal(h.document.querySelector('.orch-run'), null);
  assert.equal(outbox(h).length, 0);
  h.toasts.at(-1).action.fn();
  assert.equal(outbox(h).length, 1, 'Undo keeps it again');
  type(h, '');
  h.c.ACT['orch-job-edit'](jobButton(h, 'edit'));
  assert.equal(h.document.querySelector('#orchGoal').value, question);
  assert.equal(outbox(h).length, 0);
  assert.equal(h.document.querySelector('.orch-run'), null);
});

test('Start shows the job at the top at once, and a reload mid-way sends it again under the same request (PE-830)', async () => {
  const preferences = new Map(), session = new Map(), h = harness({ preferences, session });
  h.state.data = { sessions:[{ line:'old', title:'Old', status:'working', running:true, askedAt:5, lines:[] }] };
  h.run('orchSessionView.status = "wait"');
  type(h, 'Fix the login');
  h.c.ACT['orch-start']();
  const titles = x => [...x.document.querySelectorAll('.orch-title')].map(el => el.textContent.trim());
  assert.deepEqual(titles(h), ['Fix the login', 'Old'], 'and no filter hides it');
  assert.match(h.document.querySelector('.orch-run').textContent, /Starting/);
  // The next job is typed and remembered: the one on its way is not lost with the old draft.
  type(h, 'Second'); h.c.rememberBoxes();
  const next = harness({ preferences, session });
  await next.c.restoreBoxes(); next.render();
  assert.equal(next.document.querySelector('#orchGoal').value, 'Second');
  assert.equal(next.requests.length, 1);
  assert.equal(next.requests[0].options.body.goal, 'Fix the login');
  assert.equal(next.requests[0].options.body.requestId, h.requests[0].options.body.requestId);
  next.requests[0].resolve({ line:'login' }); await flush();
  assert.equal(outbox(next).length, 0);
  // Accepted, and not in the list yet: the card stays, and the list then takes its place.
  next.state.data = { sessions:h.state.data.sessions }; next.run('orchSettle("project", ORCH.data.sessions)'); next.c.orchPaintAll();
  assert.deepEqual(titles(next), ['Fix the login', 'Old']);
  next.state.data = { sessions:[...h.state.data.sessions, { line:'login', title:'Fix the login', status:'not-started', running:false, askedAt:1, lines:[] }] };
  next.run('orchSettle("project", ORCH.data.sessions)'); next.c.orchPaintAll();
  assert.deepEqual([...next.document.querySelectorAll('.orch-title')].map(el => el.dataset.line), ['login', 'old'], 'it keeps its place before its first Work runs');
  assert.equal(jobs(next).length, 0);
  // Left long ago: it waits for Retry.
  const left = harness({ preferences:new Map([[OUTBOX + 'a'.repeat(32), JSON.stringify({ id:'a'.repeat(32), project:'project', at:Date.now() - 3600000, goal:'Old job', preset:'saved', title:'Old job', files:[], state:'sending' })]]) });
  left.c.orchPaintAll();
  assert.equal(left.requests.length, 0);
  assert.ok(jobButton(left, 'retry'));
});

test('a restarting PenEcho is tried again by itself, and a job its list already has is not shown twice (PE-830)', async () => {
  const timers = [], h = harness({ timers });
  type(h, 'Survive the restart');
  const starting = h.c.ACT['orch-start']();
  h.requests[0].reject(Object.assign(new Error('PenEcho is not answering.'), { offline:true }));
  await starting;
  assert.equal(h.toasts.length, 0);
  assert.equal(jobButton(h, 'retry'), null);
  assert.match(h.document.querySelector('.orch-run').textContent, /not answering/);
  assert.equal(outbox(h).length, 1);
  // An answer cut off half-way says nothing either.
  timers.at(-1).fn();
  h.requests[1].resolve(null); await flush();
  assert.equal(jobs(h)[0].state, 'waiting');
  timers.at(-1).fn();
  assert.equal(h.requests[2].options.body.requestId, h.requests[0].options.body.requestId);
  assert.equal(h.requests[1].options.body.requestId, h.requests[0].options.body.requestId);
  // A poll sees the Line before the answer comes.
  h.state.data = { sessions:[{ line:'made', requestId:jobs(h)[0].id, title:'Survive the restart', status:'not-started', running:false, lines:[] }] };
  h.run('orchSettle("project", ORCH.data.sessions)'); h.c.orchPaintAll();
  assert.equal(h.document.querySelectorAll('.orch-run').length, 1);
  assert.ok(h.document.querySelector('.orch-run.running'));
  // A definite no, with its Line there: the list has it, so there is nothing to send again.
  h.requests[2].reject(Object.assign(new Error('That agent cannot run.'), { status:400 }));
  h.run('loadOrchestrator = async () => { orchSettle("project", ORCH.data.sessions); orchPaintSessions(); }');
  await flush(20);
  assert.equal(jobs(h).length, 0);
  assert.equal(outbox(h).length, 0);
  assert.equal(h.document.querySelector('.orch-title').dataset.line, 'made');
  assert.equal(h.toasts.at(-1).message, 'That agent cannot run.');
});

test('two windows never send one job twice: the second waits its turn and finds it sent', async () => {
  const preferences = new Map(), h = harness({ preferences });
  type(h, 'One job');
  h.c.ACT['orch-start']();
  let turn;
  const other = harness({ preferences:new Map([['penecho-orchestrator-agent-v1', 'saved']]) });
  preferences.forEach((value, key) => other.c.localStorage.setItem(key, value));
  other.c.navigator.locks = { request:(_name, work) => new Promise(resolve => { turn = () => resolve(work()); }) };
  other.run('orchResume()'); other.c.orchPaintAll();
  assert.equal(other.document.querySelectorAll('.orch-run').length, 1);
  other.c.localStorage.removeItem(OUTBOX + jobs(h)[0].id);
  turn(); await flush(20);
  assert.equal(other.requests.length, 0);
  assert.equal(jobs(other).length, 0);
});

test('running jobs stay newest first, whatever they do, and one that asks keeps its place (PE-830)', () => {
  const h = harness(), at = n => 1000 * n, lines = () => [...h.document.querySelectorAll('.orch-title')].map(el => el.dataset.line);
  const run = (line, n, more = {}) => ({ line, title:line, ref:'PE-' + n, status:'working', running:true, askedAt:at(n), lines:[], ...more });
  const done = { line:'done', title:'done', status:'done', askedAt:at(99), lines:[] };
  h.state.data = { sessions:[run('one', 1), done, run('three', 3), run('two', 2)] };
  h.c.orchPaintAll();
  assert.deepEqual(lines(), ['three', 'two', 'one', 'done']);
  h.state.data = { sessions:[run('two', 2, { status:'waiting', running:false, questions:['Which?'] }), run('one', 1, { updatedAt:9e9 }), run('three', 3), done] };
  h.c.orchPaintAll();
  assert.deepEqual(lines(), ['three', 'two', 'one', 'done']);
  // The same minute: the later number is the newer job.
  h.state.data = { sessions:[run('a', 5, { ref:'PE-99', askedAt:at(5) }), run('b', 5, { ref:'PE-100', askedAt:at(5) })] };
  h.c.orchPaintAll();
  assert.deepEqual(lines(), ['b', 'a']);
});

test('the next question typed while a job is on its way survives the async response', async () => {
  const h = harness();
  type(h, 'Original question');
  const starting = h.c.ACT['orch-start']();
  assert.equal(h.requests[0].options.body.goal, 'Original question');
  type(h, 'Edited while the request was pending');
  h.requests[0].resolve({ line:'orchestrator-line' });
  await starting;
  assert.equal(h.state.draft.text, 'Edited while the request was pending');
  assert.equal(h.document.querySelector('#orchGoal').value, 'Edited while the request was pending');
});

test('one session shows one ordinary child Line linking to each of its multiple Works', () => {
  const h = harness();
  h.state.data = { tools:[], sessions:[{
    line:'orchestrator-line', title:'Coordination', status:'done', agent:'saved', reviewForYou:false,
    lines:[{ line:'child-line', ref:'PE-620', title:'A normal discussion Line', running:true, works:[
      { work:'work-first', agent:'first', state:'done', reviewed:true },
      { work:'work-second', agent:'saved', state:'active' },
      { work:'work-synthesis', agent:'first', state:'todo' },
    ] }],
  }] };
  h.document.querySelector('#orchSessions').innerHTML = h.run('orchSessionsHTML({ id:"project" })');
  const sessions = h.document.querySelector('#orchSessions');
  assert.equal(sessions.querySelectorAll('.orch-run').length, 1);
  assert.equal(sessions.querySelectorAll('.orch-line').length, 1);
  const line = sessions.querySelector('.orch-line-t');
  assert.equal(line.dataset.line, 'child-line');
  assert.match(line.textContent, /PE-620/);
  assert.match(line.textContent, /A normal discussion Line/);
  const works = [...sessions.querySelectorAll('.orch-work')];
  assert.deepEqual(works.map(work => work.dataset.step), ['work-first', 'work-second', 'work-synthesis']);
  assert.equal(works.every(work => work.dataset.act === 'open-step' && work.dataset.line === 'child-line'), true);
});

test('Start shows the Enter shortcut on the button across platforms, matching Project Home', () => {
  for (const platform of ['MacIntel', 'Win32']) {
    const button = harness({ platform }).document.querySelector('[data-act="orch-start"]');
    assert.equal(button.querySelector('kbd.cmp-key').textContent, '↵');
    assert.equal(button.title, 'Start (Enter)');
    assert.equal(button.getAttribute('aria-keyshortcuts'), 'Enter');
  }
});

test('Start omits the up-arrow icon at normal width, falls back to play when narrow, and never waits for a job on its way', async () => {
  const h = harness();
  h.c.ic = (name, size) => `<svg data-ic="${name}" width="${size}"></svg>`;
  h.render();
  const idle = h.document.querySelector('[data-act="orch-start"]');
  assert.equal(idle.querySelector('i.spin'), null);
  assert.equal(idle.querySelector('svg[data-ic="send"]'), null, 'up-arrow send icon is removed');
  assert.ok(idle.querySelector('svg[data-ic="play"]'), 'narrow icon-only fallback uses play');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'lines', 'orchestrator.css'), 'utf8');
  assert.match(css, /\.orch-bar \.orch-go > svg\s*\{\s*display:\s*none;\s*\}/);
  assert.match(css, /\.orch-bar\.icon-send \.orch-go > svg\s*\{\s*display:\s*block;\s*\}/);

  type(h, 'Start a job');
  const starting = h.c.ACT['orch-start']();
  assert.equal(h.document.querySelector('[data-act="orch-start"]').disabled, false);
  assert.equal(h.document.querySelector('[data-act="orch-start"] i.spin'), null);
  type(h, 'And another');
  const second = h.c.ACT['orch-start']();
  assert.deepEqual(h.requests.map(r => r.options.body.goal), ['Start a job', 'And another']);
  assert.deepEqual([...h.document.querySelectorAll('.orch-title')].map(el => el.textContent.trim()), ['And another', 'Start a job']);
  h.requests[1].resolve({ line:'b' }); h.requests[0].resolve({ line:'a' });
  await starting; await second;
  assert.deepEqual([...h.document.querySelectorAll('.orch-title')].map(el => el.textContent.trim()), ['And another', 'Start a job']);
});

test('Enter and the Start action call the same start path, while Shift+Enter and composition do not', () => {
  const h = harness();
  let calls = 0;
  h.c.orchStart = () => { calls += 1; };
  const plain = enter(h, {});
  assert.equal(calls, 1);
  assert.equal(plain.defaultPrevented, true);
  const shift = enter(h, { shiftKey:true });
  const composing = enter(h, { isComposing:true });
  assert.equal(calls, 1, 'Shift+Enter and composition do not start');
  assert.equal(shift.defaultPrevented, false);
  assert.equal(composing.defaultPrevented, false);
  h.c.ACT['orch-start']();
  assert.equal(calls, 2);
});

test('the Orchestrator action picker keeps Start on Enter and Add for later on Cmd/Ctrl+Enter', async () => {
  for (const [platform, modifier] of [['Mac', 'metaKey'], ['Win32', 'ctrlKey']]) {
    const h = harness({ platform }), find = selector => h.document.querySelector(selector);
    const modKey = platform === 'Mac' ? '⌘↵' : 'Ctrl ↵';
    h.c.ACT['orch-submit-pick'](find('[data-act="orch-submit-pick"]'));
    const items = h.menus.at(-1).items;
    assert.deepEqual([...items].map(item => [item.label, item.key]), [
      ['Start', '↵'],
      ['Add for later', modKey],
    ]);
    assert.equal('checked' in items[0], false);
    assert.equal('checked' in items[1], false);
    // Clicking Add for later on an empty box focuses the input without sending.
    let focused = 0;
    find('#orchGoal').focus = () => { focused += 1; };
    items[1].fn();
    assert.equal(h.requests.length, 0);
    assert.equal(focused, 1);
    // Picking Add for later from the dropdown saves immediately and never changes the button or shortcuts.
    type(h, 'First task');
    items[1].fn();
    assert.match(h.requests[0].url, /orchestrator\/save$/);
    h.requests[0].resolve({ line:'first' });
    await flush();
    assert.equal(find('.orch-go').getAttribute('aria-label'), 'Start');
    assert.equal(find('.orch-go kbd.cmp-key').textContent, '↵');
    // Picking Start from the dropdown starts immediately.
    type(h, 'Direct start');
    items[0].fn();
    assert.match(h.requests[1].url, /orchestrator$/);
    h.requests[1].resolve({ line:'direct' });
    await flush();
    // Cmd/Ctrl+Enter always adds for later (even right after using the dropdown), while plain Enter always starts.
    type(h, 'Second task');
    enter(h, { [modifier]:true });
    assert.match(h.requests[2].url, /orchestrator\/save$/);
    h.requests[2].resolve({ line:'second' });
    await flush();
    type(h, 'Third task');
    enter(h, {});
    assert.match(h.requests[3].url, /orchestrator$/);
    h.requests[3].resolve({ line:'third' });
    await flush();
    // Stale saveForLater flags from older sessions cannot flip Cmd/Ctrl+Enter into Start.
    h.state.draft.flags.saveForLater = true;
    type(h, 'Fourth task');
    enter(h, { [modifier]:true });
    assert.match(h.requests[4].url, /orchestrator\/save$/);
    h.requests[4].resolve({ line:'fourth' });
    await flush();
    assert.equal(h.state.draft.flags.saveForLater, undefined);
    h.state.data = { sessions:[
      { line:'first', title:'First task', status:'waiting', unsent:true, unsentStep:'ask-1', unsentPreset:'saved', agent:'saved', lines:[] },
      { line:'auto-one', title:'Auto task', status:'waiting', unsent:true, unsentStep:'ask-1', unsentPreset:'auto', agent:'', lines:[] },
    ] };
    h.c.orchPaintAll();
    const startBtns = [...h.document.querySelectorAll('.orch-run [data-act="orch-start-saved"]')];
    assert.deepEqual(startBtns.map(b => [b.dataset.line, b.dataset.step, b.dataset.preset]), [
      ['first', 'ask-1', 'saved'],
      ['auto-one', 'ask-1', 'auto'],
    ]);
    assert.equal(find('.orch-run .fl-state.s-backlog').textContent, 'Not sent');
    // Clicking Start on an unsent saved session calls run-unsent with its step and saved preset (including Auto).
    h.c.ACT['orch-start-saved'](startBtns[1]);
    assert.match(h.requests[5].url, /\/topics\/auto-one\/run-unsent$/);
    assert.deepEqual({ ...h.requests[5].options.body }, { step:'ask-1', preset:'auto' });
    h.requests[5].resolve({ ok:true, agent:'saved', auto:{ agent:'Saved agent', kind:'code', from:'', why:'' } });
    await flush();
    assert.equal(h.toasts.at(-1).message, 'Orchestrator started · Code job → Saved agent');
    // Hosted mode hides the dropdown and keeps Cmd/Ctrl+Enter on the regular Start endpoint.
    h.c.HOSTED = true;
    h.render();
    assert.equal(find('[data-act="orch-submit-pick"]'), null);
    type(h, 'Hosted task');
    enter(h, { [modifier]:true });
    assert.match(h.requests[6].url, /orchestrator$/);
    h.requests[6].resolve({ line:'hosted' });
    await flush();
  }
});

test('the box has its own file picker and shows chosen pictures and files as chips', () => {
  const h = harness(), box = h.document.querySelector('#orchBox');
  const input = box.querySelector('#orchFilePick');
  assert.equal(input.type, 'file');
  assert.equal(input.hasAttribute('multiple'), true);
  assert.equal(box.querySelector('[data-act="orch-attach"]').getAttribute('aria-label'), 'Add');
  let opened = 0; input.click = () => { opened += 1; };
  let plusMenu = null;
  h.c.openMenu = (_el, items) => { plusMenu = items; };
  h.c.ACT['orch-attach'](box.querySelector('[data-act="orch-attach"]'));
  assert.equal(plusMenu[0].label, 'Add images or files');
  plusMenu[0].fn();
  assert.equal(opened, 1);
  assert.equal(h.document.querySelector('#orchFiles').hidden, true);
  Object.defineProperty(input, 'files', { value:[{ name:'plan.png', type:'image/png', size:2048 }, { name:'notes.pdf', type:'application/pdf', size:4096 }], configurable:true });
  input.dispatchEvent(new h.window.Event('change', { bubbles:true }));
  assert.equal(h.state.draft.files.length, 2);
  const row = h.document.querySelector('#orchFiles');
  assert.equal(row.hidden, false);
  const chips = [...row.querySelectorAll('.orch-file')];
  assert.equal(chips.length, 2);
  assert.equal(chips[0].querySelector('.orch-file-pic img').getAttribute('src'), 'blob:plan.png');
  assert.ok(chips[1].querySelector('.orch-file-ic'));
  assert.match(chips[0].textContent, /plan\.png/);
  assert.match(chips[0].textContent, /Click to draw on it/);
  assert.match(chips[1].textContent, /notes\.pdf/);
  h.c.ACT['orch-preview'](chips[0].querySelector('[data-act="orch-preview"]'));
  assert.equal(h.previews.length, 1);
  assert.equal(h.previews[0][1].name, 'plan.png');
  assert.equal(h.previews[0][2].list.length, 1);
  h.c.ACT['orch-remove'](chips[1].querySelector('[data-act="orch-remove"]'));
  assert.equal(h.state.draft.files.length, 1);
  assert.equal(row.querySelectorAll('.orch-file').length, 1);
  h.c.ACT['orch-remove'](row.querySelector('[data-act="orch-remove"]'));
  assert.equal(h.state.draft.files.length, 0);
  assert.equal(row.hidden, true);
});

test('a picture pasted into the job becomes a chip', () => {
  const h = harness();
  const event = new h.window.Event('paste', { bubbles:true, cancelable:true });
  Object.assign(event, { clipboardData:{ files:[{ name:'shot.png', type:'image/png', size:1024 }] } });
  h.document.querySelector('#orchGoal').dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(h.state.draft.files.length, 1);
  assert.match(h.document.querySelector('#orchFiles').textContent, /shot\.png/);
});

test('dropping on the shared job composer adds once and clears the page overlay', () => {
  const h = harness(), handlers = {};
  h.document.body.insertAdjacentHTML('beforeend', '<div id="dropOverlay" hidden></div><input id="filePick" type="file">');
  const form = h.document.querySelector('#orchBox .composer'), overlay = h.document.querySelector('#dropOverlay');
  Object.defineProperty(form, 'offsetParent', { value:h.document.body });
  h.c.addEventListener = (name, fn) => { handlers[name] = fn; };
  h.c.wireDrop();
  const dataTransfer = { types:['Files'], files:[{ name:'sketch.png', type:'image/png' }] };
  handlers.dragenter({ dataTransfer }); assert.equal(overlay.hidden, false);
  handlers.drop({ dataTransfer, preventDefault() {} });
  assert.equal(overlay.hidden, true);
  assert.equal(h.state.draft.files.length, 1);
  assert.ok(form.querySelector('[data-act="cmp-edit-draw"]'));
});

test('Slides and its template are job requirements, not text edits or a separate Line', async () => {
  const h = harness(), find = selector => h.document.querySelector(selector);
  assert.deepEqual([...h.document.querySelectorAll('.orch-bar [data-kind]')], []);
  assert.equal(find('.orch-bar .cmp-chips').hidden, true);
  let plusMenu = null;
  h.c.openMenu = (_el, items) => { plusMenu = items; };
  h.c.ACT['orch-attach'](find('[data-act="orch-attach"]'));
  assert.deepEqual(Array.from(plusMenu.filter(item => !item.sep), item => item.label), ['Add images or files', 'Diagram', 'Explorer', 'Slides', 'Note card', 'MeetCue']);
  type(h, 'Show the decision to the board.');
  plusMenu.find(item => item.label === 'Slides').fn();
  assert.deepEqual([...h.document.querySelectorAll('.orch-bar [data-kind]')].map(el => el.textContent), ['Slides']);
  h.c.ACT['make-kind'](find('[data-sub="investor"]'));
  assert.equal(find('#orchGoal').value, 'Show the decision to the board.');
  assert.equal(find('[data-sub="investor"]').getAttribute('aria-checked'), 'true');
  assert.equal(h.requests.length, 0);
  const first = h.c.orchStart(), id = h.requests[0].options.body.requestId;
  assert.deepEqual({ ...h.requests[0].options.body.make }, { kind:'slides', sub:'investor' });
  assert.equal(find('.orch-bar .cmp-chips').hidden, true);
  h.requests[0].reject(new Error('No')); await first;
  h.c.ACT['orch-job-edit'](jobButton(h, 'edit'));
  assert.equal(find('[data-kind="slides"]').getAttribute('aria-pressed'), 'true');
  h.c.ACT['make-kind'](find('[data-sub="market"]'));
  const again = h.c.orchStart();
  assert.notEqual(h.requests[1].options.body.requestId, id);
  h.requests[1].resolve({ line:'deck' }); await again;
  assert.equal(h.state.draft.flags.make, undefined);
  assert.equal(find('.orch-bar .cmp-chips').hidden, true);
});

test('the guide is visible on first entry, stays dismissed on reload, and reopens without changing the job', () => {
  const preferences = new Map();
  const visit = () => {
    const h = harness({ preferences });
    h.document.body.innerHTML = h.c.orchestratorHTML(h.c.project()); h.c.wireComposers(h.document);
    return h;
  };
  const first = visit(); assert.equal(first.document.querySelector('#orchGuide').hidden, false);
  first.c.ACT['orch-guide-dismiss']();
  const next = visit(), guide = next.document.querySelector('#orchGuide'), reopen = next.document.querySelector('[data-act="orch-guide-show"]');
  assert.equal(guide.hidden, true); assert.equal(reopen.hidden, false);
  type(next, 'Keep this draft');
  next.c.ACT['orch-guide-show'](reopen); assert.equal(guide.hidden, false);
  next.c.ACT['orch-guide-dismiss'](); assert.equal(next.document.querySelector('#orchGoal').value, 'Keep this draft');
  assert.equal(next.requests.length, 0);
});

test('a starter fills the box with editable words, picks its output, and hides with the guide', () => {
  const h = harness();
  h.document.body.innerHTML = h.c.orchestratorHTML(h.c.project()); h.c.wireComposers(h.document);
  const starters = h.document.querySelector('#orchStarters'), deck = h.document.querySelector('[data-act="orch-starter"]');
  assert.equal(starters.hidden, false);
  h.c.ACT['orch-starter'](deck);
  assert.match(h.document.querySelector('#orchGoal').value, /deck from the attached meeting notes/);
  assert.equal(h.state.draft.text, h.document.querySelector('#orchGoal').value);
  assert.equal(h.state.draft.flags.make.kind, 'slides');
  assert.equal(h.requests.length, 0, 'a starter never starts the job');
  h.c.ACT['orch-guide-dismiss']();
  assert.equal(starters.hidden, true);
});

test('only drawable attachments open Canvas and output plus an attachment can start without redundant words', async () => {
  const h = harness(); h.c.orchAddFiles([{ name:'plot.png', type:'image/png' }, { name:'art.svg', type:'image/svg+xml' }]);
  const edit = [...h.document.querySelectorAll('[data-act="cmp-edit-draw"]')];
  assert.equal(edit.length, 1);
  let opened;
  h.c.openDrawing = async (project, form, { file }) => { opened = [project.id, form.dataset.comp, file.name]; };
  h.c.ACT['cmp-edit-draw'](edit[0]); assert.deepEqual(opened, ['project', 'orch-project', 'plot.png']);
  h.c.chooseMake(h.document.querySelector('#orchBox .composer'), 'slides');
  assert.equal(h.requests.length, 0);
  const starting = h.c.orchStart();
  for (const [index, name] of ['plot.png', 'art.svg'].entries()) {
    h.uploads[index].resolve([{ name, path:`files/_incoming/${name}`, type:jobs(h)[0].files[index].type }]); await flush();
  }
  assert.match(h.requests[0].options.body.goal, /Slides.*attached material/);
  h.requests[0].resolve({ line:'deck' }); await starting;
});

test('files are refused when this PenEcho cannot take them', () => {
  const h = harness();
  h.c.can = () => false;
  h.c.orchAddFiles([{ name:'plan.txt', type:'text/plain', size:12 }]);
  assert.equal(h.state.draft.files.length, 0);
  assert.deepEqual(h.toasts.map(item => item.message), ['Add files in PenEcho on a computer.']);
});

test('Start takes the box files at once, uploads each once and posts their paths', async () => {
  const h = harness();
  h.c.orchAddFiles([{ name:'plan.txt', type:'text/plain', size:12 }]);
  type(h, 'Read the plan');
  const starting = h.c.ACT['orch-start']();
  assert.equal(h.uploads.length, 1);
  assert.equal(h.uploads[0].files.length, 1);
  assert.equal(h.state.draft.files.length, 0);
  assert.equal(h.document.querySelector('#orchFiles').hidden, true);
  assert.match(h.document.querySelector('.orch-run').textContent, /Uploading files/);
  h.uploads[0].resolve([{ path:'files/_incoming/plan.txt', name:'plan.txt', type:'text/plain', size:12 }]);
  await flush();
  assert.equal(h.requests.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(h.requests[0].options.body)), {
    goal:'Read the plan', preset:'saved', requestId:jobs(h)[0].id,
    attachments:[{ path:'files/_incoming/plan.txt', name:'plan.txt', type:'text/plain' }],
  });
  h.requests[0].resolve({ line:'orchestrator-line' });
  await starting;
  assert.equal(h.state.draft.files.length, 0);
  assert.equal(h.state.draft.text, '');
});

test('a failed start keeps the files with the job, and Edit puts them back in the box', async () => {
  const h = harness();
  h.c.orchAddFiles([{ name:'plan.txt', type:'text/plain', size:12 }]);
  type(h, 'Read the plan');
  const starting = h.c.ACT['orch-start']();
  h.uploads[0].resolve([{ path:'files/_incoming/plan.txt', name:'plan.txt', type:'text/plain' }]);
  await flush();
  h.requests[0].reject(new Error('Could not start'));
  await starting;
  assert.equal(h.state.draft.files.length, 0);
  assert.equal(outbox(h)[0].files[0].uploaded.path, 'files/_incoming/plan.txt');
  h.c.ACT['orch-job-edit'](jobButton(h, 'edit'));
  assert.equal(h.state.draft.files.length, 1);
  assert.equal(h.document.querySelector('#orchFiles').hidden, false);
  assert.match(h.document.querySelector('#orchFiles').textContent, /plan\.txt/);
  assert.deepEqual(h.toasts.map(item => item.message), ['Could not start']);
});

test('a failed upload starts nothing and keeps the files', async () => {
  const h = harness();
  h.c.orchAddFiles([{ name:'plan.txt', type:'text/plain', size:12 }]);
  type(h, 'Read the plan');
  const starting = h.c.ACT['orch-start']();
  h.uploads[0].reject(new Error('Upload failed'));
  await starting;
  assert.equal(h.requests.length, 0);
  assert.equal(outbox(h)[0].files.length, 1);
  assert.deepEqual(h.toasts.map(item => item.message), ['Upload failed']);
});

test('Look up the prices never attaches the box files', async () => {
  const h = harness();
  h.state.stats = { activePriceLookup:null };
  h.c.orchAddFiles([{ name:'plan.txt', type:'text/plain', size:12 }]);
  type(h, 'My own question');
  h.c.ACT['orch-prices-ai']();
  await flush(2);
  assert.equal(h.uploads.length, 0);
  assert.equal(h.requests.length, 1);
  assert.equal('attachments' in h.requests[0].options.body, false);
  assert.match(h.requests[0].options.body.goal, /^Look up the current list prices/);
  h.requests[0].resolve({ line:'orchestrator-line' });
  await flush();
  assert.equal(h.state.draft.files.length, 1);
});

test('Statistics shows hosted model names and keeps the price key for edits and lookups', async () => {
  const h = harness({ realLoad:true }), p = h.c.project();
  h.run(fs.readFileSync(path.join(__dirname, '../public/lines/settings.js'), 'utf8'));
  const key = '3ea3e82e-095e-4aa1-9c93-9eed1b963810';
  const missing = 'hosted:12345678-1234-1234-1234-123456789abc';
  h.c.S.route.view = 'stats';
  h.document.body.innerHTML = h.c.statsPricesHTML(p);
  const catalog = deferred();
  h.c.fetch = async url => {
    assert.equal(url, '/api/cloud/models');
    return { ok:true, json:() => catalog.promise };
  };
  const models = [{ model:key, input:0.3, output:1.2, cached:0.006 }, { model:'gpt-6.2-sol', input:2, output:10 }];
  const load = h.c.loadOrchestrator(p, true);
  h.requests[0].resolve({ rows:[], activePriceLookup:null, models });
  await flush();
  // The list itself is the computer's, read once Statistics says it has prices.
  assert.equal(h.requests[1].url, '/model-prices');
  h.requests[1].resolve({ models, agents:{}, missing:[{ model:missing, agents:[{ id:'first', name:'First agent', agent:'first' }] }], sync:null });
  await load; await flush();
  const action = name => h.document.querySelector(`[data-price-model="${key}"] [data-act="price-${name}"]`);
  const labels = () => [...h.document.querySelectorAll('.price-model')].map(el => el.textContent.replace(/ No price.*/, '').trim());
  assert.ok(labels().every(label => !label.includes(key)));
  catalog.resolve({ models:[
    { id:key, displayName:'DeepSeek V4.1 Flash', available:true, multiplier:1 },
    { id:missing.slice(7), name:'Another <model>', available:true, multiplier:1 },
  ] });
  await flush();
  assert.deepEqual(labels(), ['Another <model>', 'DeepSeek V4.1 Flash', 'gpt-6.2-sol']);
  assert.equal(action('edit').dataset.key, key);
  assert.equal(action('remove').getAttribute('aria-label'), 'Remove DeepSeek V4.1 Flash');
  h.c.ACT['price-edit'](action('edit'));
  assert.equal(h.document.querySelector(`[data-price-row="${key}"][data-price-field="cached"]`).getAttribute('value'), '0.006');
  h.run('loadOrchestrator = async () => {}');
  const lookup = h.c.ACT['orch-prices-ai']();
  const goal = h.requests.at(-1).options.body.goal;
  assert.ok(goal.includes(missing + ' (Another <model>)'));
  assert.match(goal, /original model key/);
  assert.match(goal, /real model names/);
  h.requests.at(-1).resolve({ line:'lookup', status:'working' });
  await lookup;
});

test('the AI price action submits once and opens the active lookup after the server accepts it', async () => {
  const h = harness(), p = h.c.project();
  h.c.S.route.view = 'stats';
  h.c.orchUseProject(p);
  h.state.stats = { activePriceLookup:null };
  h.run("PRICES.data = { models:[], agents:{}, missing:[] }");
  h.document.body.innerHTML = h.c.statsPricesHTML(p);
  const send = () => h.c.ACT['orch-prices-ai']();
  const button = () => h.document.querySelector('#statsPrices [data-act="orch-prices-ai"]');
  assert.equal(button().textContent.trim(), 'Look up with AI');
  const first = send();
  assert.equal(button().disabled, true);
  await send();
  assert.equal(h.requests.length, 1);
  h.requests[0].resolve({ line:'lookup', status:'working' });
  await first;
  await flush();
  assert.ok(h.document.querySelector('#statsPrices [data-act="open-line"][data-line="lookup"]'));
  await send();
  assert.equal(h.requests.length, 1);
});

test('a fresh Statistics page reads the active lookup and enables a new lookup when it ends', async () => {
  const h = harness({ realLoad:true }), p = h.c.project();
  // Statistics schedules its ordinary poll while a lookup is active.
  h.c.setTimeout = () => 1; h.c.clearTimeout = () => {};
  h.c.S.route.view = 'stats';
  h.run("PRICES.data = { models:[], agents:{}, missing:[] }");
  h.document.body.innerHTML = h.c.statsPricesHTML(p);
  const lookup = () => h.document.querySelector('#orchLookup');
  const load = async activePriceLookup => {
    const request = h.c.loadOrchestrator(p, true);
    h.requests.at(-1).resolve({ rows:[], models:[], activePriceLookup });
    await request;
  };
  assert.equal(lookup().querySelector('button').disabled, true);
  await h.c.ACT['orch-prices-ai']();
  assert.equal(h.requests.length, 0);
  await load({ line:'running-lookup', status:'waiting' });
  assert.match(lookup().textContent, /Needs you/);
  assert.ok(lookup().querySelector('[data-act="open-line"][data-line="running-lookup"]'));
  await load(null);
  assert.equal(lookup().querySelector('[data-act="orch-prices-ai"]').disabled, false);
  await load(undefined);
  assert.match(lookup().textContent, /Restart PenEcho/);
  assert.equal(lookup().querySelector('[data-act="orch-prices-ai"]').disabled, true);
});

test('an uncertain AI lookup retries the original request independently of a regular Orchestrator draft', async () => {
  const h = harness();
  h.state.stats = { activePriceLookup:null };
  type(h, 'Regular job');
  const first = h.c.ACT['orch-prices-ai'](), body = h.requests[0].options.body;
  assert.equal(body.purpose, 'model-prices');
  h.requests[0].reject(Error('Connection lost')); await first;
  const regular = h.c.ACT['orch-start']();
  assert.notEqual(h.requests[1].options.body.requestId, body.requestId);
  h.requests[1].resolve({ line:'regular' }); await regular;
  h.state.stats.models = [{ model:'new-model' }];
  const retry = h.c.ACT['orch-prices-ai']();
  assert.deepEqual(h.requests[2].options.body, body);
  h.requests[2].resolve({ line:'lookup', status:'done' }); await retry;
  const later = h.c.ACT['orch-prices-ai']();
  assert.notEqual(h.requests[3].options.body.requestId, body.requestId);
  h.requests[3].resolve({ line:'fresh', status:'working' }); await later;
});

test('Orchestrator keeps its composer, sessions and tools and points to Statistics', () => {
  const h = harness();
  h.document.body.innerHTML = h.run('orchestratorHTML(project())');
  assert.equal(h.document.querySelectorAll('#orchBox, #orchSessions, #orchTools').length, 3);
  assert.equal(h.document.querySelectorAll('#orchRecord, #orchPrices, .orch-two').length, 0);
  assert.match(h.document.querySelector('.orch-top [data-view="stats"]').textContent, /Agent record & prices/);
  h.state.data = { sessions:[], tools:[] };
  assert.match(h.run('orchSessionsHTML(project())'), /rates each Work from 1 to 5/);
  assert.doesNotMatch(h.run('orchestratorHTML({ id:"project", myCanvases:true })'), /data-view="stats"/);
  h.c.HOSTED = true;
  assert.doesNotMatch(h.run('orchestratorHTML(project())'), /orchAgentsPanel|orch-agents-toggle/, 'a hosted page shows no local agents panel');
  assert.match(h.run('orchestratorHTML(project())'), /class="page orch-page agents-hidden"/);
  h.c.HOSTED = false;
});

test('a rated Work displays its score and escaped note and opens the same step from either control', () => {
  const h = harness(), note = '<i title="quoted">fix & retry</i>';
  h.state.data = { sessions:[{ line:'plan', title:'Plan', lines:[{ line:'child', title:'Build', works:[
    { work:'work-1', agent:'first', state:'done', reviewed:true, score:3, note },
    { work:'work-2', agent:'saved', state:'active' },
  ] }] }] };
  const html = h.run('orchSessionsHTML(project())');
  h.document.querySelector('#orchSessions').innerHTML = html;
  assert.ok(html.includes(esc(note)));
  assert.equal(h.document.querySelector('.orch-rating-note').textContent, note);
  assert.equal(h.document.querySelectorAll('.orch-line + .orch-ratings .orch-rating').length, 1);
  for (const selector of ['.orch-work.w-done.reviewed', '.orch-rating']) {
    const el = h.document.querySelector(selector);
    assert.equal(el.dataset.act, 'open-step');
    assert.equal(el.dataset.line, 'child');
    assert.equal(el.dataset.step, 'work-1');
    assert.match(el.textContent, /3\/5/);
  }
  assert.match(h.document.querySelector('.orch-work').title, /Score: 3\/5/);
});

test('a stopped session offers Retry, names an earlier report, and says when a Work was stopped before it reported', () => {
  const h = harness();
  h.state.data = { sessions:[
    { line:'picks', title:'Picks', status:'stopped', why:'PenEcho closed while this was running. Retry to continue from the saved conversation and files.', report:'The first answer', reportWork:'work-1', reportLabel:'Work 1', lines:[] },
    { line:'lookup', title:'Lookup', status:'done', stoppedWork:'Work 1', lines:[] },
  ] };
  h.document.querySelector('#orchSessions').innerHTML = h.run('orchSessionsHTML(project())');
  const retry = h.document.querySelectorAll('[data-verb="retry"]');
  assert.equal(retry.length, 1);
  assert.equal(retry[0].dataset.line, 'picks');
  const report = h.document.querySelector('.orch-report');
  assert.match(report.textContent, /Earlier report · Work 1/);
  assert.equal(report.dataset.step, 'work-1');
  assert.ok([...h.document.querySelectorAll('.orch-reason')].some(p => p.textContent === 'Work 1 was stopped before it reported.'));
});

test('reviewed and archived sessions ignore stale stopped Work and child errors in cards and sorting', () => {
  const h = harness(), { c } = h;
  const stopped = { id:'work-1', work:'work-1', kind:'work', agent:'codex', state:'off', off:'stopped', stopWhy:'error', reviewed:false };
  const makeLine = (id, extra = {}) => ({ id, status:'done', stations:[stopped], ...extra });
  const reviewed = makeLine('reviewed', { branch:'main', stations:[{ ...stopped, reviewed:true }] });
  const pending = makeLine('pending');
  const archived = makeLine('archived', { archived:true });
  const projectLines = new Map([reviewed, pending, archived].map(line => [line.id, line]));
  const project = { lines:[...projectLines.values()] };
  Object.assign(c, { lineById:(_project, id) => projectLines.get(id), shownState:c.LINE_STATUS.shownState });
  Object.assign(c.STATE_TEXT, { ready:'Finished', review:'To review' });
  const makeSession = (line, lines = []) => ({ line, title:line, status:'done', stoppedWork:'Work 1', lines });
  const stoppedChild = { line:'child', title:'Child', status:'stopped', works:[stopped] };
  const erroredChild = { ...stoppedChild, status:'done' };
  const reviewedSession = makeSession('reviewed', [stoppedChild, erroredChild]);
  const pendingSession = makeSession('pending');
  const archivedSession = { ...makeSession('archived', [erroredChild]), archived:true };
  h.document.querySelector('#orchSessions').innerHTML = c.orchResultsHTML(project, [reviewedSession, archivedSession, pendingSession]);
  const cards = [...h.document.querySelectorAll('.orch-run')];
  assert.deepEqual(cards.map(card => card.querySelector('.orch-title').textContent), ['pending', 'reviewed', 'archived']);
  assert.match(cards[0].querySelector('.orch-run-actions').textContent, /Work stopped.*To review/);
  assert.equal(cards[0].querySelector('.orch-reason').textContent, 'Work 1 was stopped before it reported.');
  assert.match(cards[1].querySelector('.orch-run-actions').textContent, /Reviewed/);
  assert.match(cards[2].querySelector('.orch-run-actions').textContent, /Archived/);
  for (const card of cards.slice(1)) {
    assert.equal(card.querySelector('.orch-run-actions .s-error'), null);
    assert.equal(card.querySelector('.orch-reason'), null);
  }
  assert.equal(c.orchPriority(pendingSession, 'review', projectLines), 2);
  assert.equal(c.orchPriority(reviewedSession, 'ready', projectLines), 4, 'a reviewed Line also resolves errors on a stale ready card');
  assert.equal(c.orchPriority(reviewedSession, 'landed', projectLines), 4);
  for (const state of ['reviewed', 'archived']) {
    assert.equal(c.orchPriority(reviewedSession, state), 4);
    assert.doesNotMatch(c.orchSessionCard(project, reviewedSession, state), /(?:Lines? stopped|Lines? with errors|Work stopped|was stopped before it reported)/);
  }
  assert.doesNotMatch(c.orchSessionCard(project, reviewedSession, 'landed'), /(?:Lines? stopped|Lines? with errors|Work stopped|was stopped before it reported)/);
  // A finished parent with no reviewable Work (ended-only) must still surface unresolved child errors.
  const endedOnly = makeLine('ended-only', { stations:[{ ...stopped, off:'ended', reviewed:false }] });
  const commitPending = makeLine('commit-pending', { commit:'abc123', stations:[stopped] });
  projectLines.set(endedOnly.id, endedOnly);
  projectLines.set(commitPending.id, commitPending);
  project.lines.push(endedOnly, commitPending);
  const endedSession = { line:'ended-only', title:'Ended only', status:'done', lines:[stoppedChild] };
  assert.equal(c.orchStateKey(endedSession, endedOnly), 'landed');
  assert.equal(c.orchPriority(endedSession, 'landed', projectLines), 2);
  assert.match(c.orchSessionCard(project, endedSession, 'landed'), /1 Line stopped/);
  // A commit on a non-archived Line must not hide an unreviewed stopped Work.
  const commitSession = makeSession('commit-pending');
  assert.equal(c.orchStateKey(commitSession, commitPending), 'review');
  assert.equal(c.orchPriority(commitSession, 'review', projectLines), 2);
  assert.match(c.orchSessionCard(project, commitSession, 'review'), /Work stopped.*To review/);
  assert.match(c.orchSessionCard(project, commitSession, 'review'), /Work 1 was stopped before it reported\./);
  assert.equal(c.orchWorkUnrecoveredError(stopped), true);
  assert.equal(c.orchWorkUnrecoveredError({ ...stopped, reviewed:true }), false);
  assert.equal(c.orchWorkUnrecoveredError({ state:'error', reviewed:false }), true);
  assert.equal(c.orchWorkUnrecoveredError({ state:'error', reviewed:true }), false);
  const resolvedChildren = { ...pendingSession, stoppedWork:undefined, lines:[{ ...erroredChild, works:[{ ...stopped, reviewed:true }] }, { ...stoppedChild, line:'reviewed' }] };
  assert.equal(c.orchPriority(resolvedChildren, 'review', projectLines), 3);
  assert.doesNotMatch(c.orchSessionCard(project, resolvedChildren, 'review'), /Lines? with errors|Lines? stopped/);
});

test('a session shows the route its coordinator recorded, planned until a delegated Line exists, escaped (PE-660)', () => {
  const h = harness();
  h.state.data = { sessions:[
    { line:'alone', title:'Alone', status:'done', route:'self', routeWhy:'A <two-minute> fix.', lines:[] },
    { line:'split', title:'Split', status:'done', route:'split', routeWhy:'Two independent fixes.', routeParts:'fix A → you; fix B → Codex', lines:[{ line:'child', title:'Fix B', status:'done', works:[] }] },
    { line:'planned', title:'Planned', status:'working', running:true, route:'delegate', routeWhy:'Cheaper agent.', lines:[] },
    { line:'old', title:'Old', status:'done', route:'other', lines:[] },
  ] };
  h.document.querySelector('#orchSessions').innerHTML = h.run('orchSessionsHTML(project())');
  const routes = [...h.document.querySelectorAll('.orch-route')].map(p => p.textContent);
  assert.deepEqual(routes.sort(), ['Delegation planned · Cheaper agent.', 'Split · Two independent fixes.', 'Worked alone · A <two-minute> fix.']);
  assert.equal([...h.document.querySelectorAll('.orch-route')].find(p => p.textContent.startsWith('Split')).getAttribute('title'), 'fix A → you; fix B → Codex');
  assert.equal(h.document.querySelector('.orch-route b').textContent.length > 0, true);
  assert.equal(h.document.querySelector('#orchSessions').innerHTML.includes('<two-minute>'), false);
});

test('a job PenEcho Auto started says the kind it read, the words that said so and why this agent, escaped (PE-1085)', () => {
  const h = harness();
  h.state.data = { sessions:[
    { line:'read', title:'Read', status:'done', route:'self', routeWhy:'One small fix.', auto:{ kind:'code', from:'“fix”, “<test>”', why:'Ben: rated 4.3/5 on 3 code Works here. Passed over: Ada (its app is running 1 Work now).' }, lines:[] },
    { line:'unclear', title:'Unclear', status:'done', auto:{ kind:'', from:'', why:'Ada: not rated here yet, so it starts at 4/5.' }, lines:[] },
    { line:'usual', title:'Usual', status:'done', auto:{ kind:'docs', from:'like most jobs in this project', why:'' }, lines:[] },
    { line:'named', title:'Named', status:'done', route:'self', lines:[] },
  ] };
  h.document.querySelector('#orchSessions').innerHTML = h.run('orchSessionsHTML(project())');
  const said = line => h.document.querySelector(`[data-line="${line}"]`).closest('.orch-run').querySelector('.orch-auto')?.textContent;
  assert.equal(said('read'), 'PenEcho Auto · Code job (“fix”, “<test>”) → Ben: rated 4.3/5 on 3 code Works here. Passed over: Ada (its app is running 1 Work now).');
  assert.equal(said('unclear'), 'PenEcho Auto · Kind of job not clear → Ada: not rated here yet, so it starts at 4/5.');
  assert.equal(said('usual'), 'PenEcho Auto · Docs job (like most jobs in this project)');
  assert.equal(said('named'), undefined, 'an agent you picked yourself has no such line');
  assert.equal(h.document.querySelector('#orchSessions').innerHTML.includes('<test>'), false);
  // It stands over the route its coordinator recorded afterwards.
  const card = h.document.querySelector('[data-line="read"]').closest('.orch-run');
  assert.equal(card.querySelector('.orch-auto').nextElementSibling, card.querySelector('.orch-route'));
});

test('Start with PenEcho Auto says at once what it took the job to be and whom it started (PE-1085)', async () => {
  const h = harness();
  const start = async (words, result) => {
    type(h, words);
    const starting = h.c.ACT['orch-start']();
    h.requests.at(-1).resolve(result);
    await starting;
    return h.toasts.at(-1).message;
  };
  assert.equal(await start('Fix the failing login test', { line:'a', auto:{ agent:'Ada', kind:'code', from:['“fix”'], why:'Ada: rated 4.8/5 on 4 code Works here.' } }), 'Orchestrator started · Code job → Ada');
  assert.equal(await start('Do the thing we talked about', { line:'b', auto:{ agent:'Ada', kind:'', from:[], why:'' } }), 'Orchestrator started · Ada');
  assert.equal(await start('Fix the failing login test', { line:'c' }), 'Orchestrator started');
  h.c.HOSTED = true;
  assert.equal(await start('Fix the failing login test', { line:'d', auto:{ agent:'Ada', kind:'code' } }), 'Sent to your computer');
  h.c.HOSTED = false;
});

test('Statistics opening another project discards a late record from the previous project', async () => {
  const h = harness({ realLoad:true });
  h.c.S.route.view = 'stats';
  h.run("PRICES.data = { models:[], agents:{}, missing:[] }");
  const open = id => {
    const p = { id };
    h.c.project = () => p;
    h.document.body.innerHTML = h.c.statsRecordHTML(p) + h.c.statsPricesHTML(p);
    h.c.refreshStatsPrices(p);
  };
  open('first'); open('second');
  assert.deepEqual(h.requests.map(r => r.url), ['/api/lines/projects/first/orchestrator/stats', '/api/lines/projects/second/orchestrator/stats']);
  h.requests[1].resolve({ rows:[], models:[], ratings:[] });
  await flush();
  h.requests[0].resolve({ rows:[], models:[{ model:'first-model', input:1, output:2 }], ratings:[] });
  await flush();
  assert.equal(h.state.project, 'second');
  assert.doesNotMatch(h.document.body.textContent, /first-model|Loading/);
});

test('Agent record shows the individual scored Work and escaped note under its agent and kind', () => {
  const h = harness(), note = 'Check <a href="bad">this</a> & retry';
  h.state.project = 'project';
  h.state.stats = { models:[], rows:[{ agent:'Writer', runner:'saved', kind:'test', works:2, score:3.5 }], ratings:[
    { line:'child', title:'Coverage', work:'work-2', label:'Work 2', agent:'Writer', runner:'saved', kind:'test', score:3, note },
  ] };
  const html = h.c.statsRecordHTML({ id:'project' });
  h.document.body.innerHTML = html;
  const record = h.document.querySelector('#statsRecord');
  assert.match(record.querySelector('table').textContent, /3\.5 \/5/);
  const rating = record.querySelector('.sx-orch-ratings [data-act="open-step"]');
  assert.equal(rating.dataset.line, 'child');
  assert.equal(rating.dataset.step, 'work-2');
  assert.match(rating.textContent, /Writer.*3\/5/s);
  assert.match(rating.textContent, /Code · Coverage · Work 2/);
  assert.equal(rating.querySelector('.orch-rating-note').textContent, note);
  assert.equal(rating.querySelector('a'), null);
  assert.ok(html.includes(esc(note)));
});

test('loading Statistics updates the record while a price is being typed', async () => {
  const h = harness({ realLoad:true }), p = h.c.project();
  h.run("PRICES.data = { models:[], agents:{}, missing:[{ model:'nova', agents:[] }] }");
  h.c.S.route.view = 'stats';
  h.document.body.innerHTML = h.c.statsRecordHTML(p) + h.c.statsPricesHTML(p);
  h.c.refreshStatsPrices();
  const box = () => h.document.querySelector('[data-price-row="nova"][data-price-field="input"]'), field = box();
  let active = field;
  Object.defineProperty(h.document, 'activeElement', { get:() => active });
  h.run("PRICES.drafts.nova = { input:'3' }");
  const models = [{ model:'priced', input:1, output:2 }];
  h.requests[0].resolve({ rows:[], ratings:[], models });
  await flush();
  h.requests[1].resolve({ models, agents:{}, missing:[{ model:'nova', agents:[] }] });
  await flush();
  assert.match(h.document.querySelector('#statsRecord').textContent, /No Works yet/);
  assert.equal(box(), field);
  active = null;
  h.c.refreshStatsPrices();
  assert.equal(box().getAttribute('value'), '3');
  assert.ok(h.document.querySelector('#statsPrices [data-price-model="priced"]'));
});

test('switching projects during an upload keeps each draft, file and output choice with its job', async () => {
  const h = harness(), visit = id => { h.c.project = () => ({ id }); h.c.orchUseProject({ id }); h.render(); };
  visit('a');
  type(h, 'Same words');
  h.state.draft.flags.make = { kind:'slides', sub:'auto' };
  h.c.orchAddFiles([{ name:'brief.png', type:'image/png', size:8 }]);
  const starting = h.c.orchStart();
  visit('b');
  assert.equal(h.state.draft.text, '');
  assert.equal(h.state.draft.files.length, 0);
  assert.equal(Boolean(h.state.draft.flags.make), false);
  type(h, 'Same words');
  h.c.orchAddFiles([{ name:'other.png', type:'image/png', size:9 }]);
  h.uploads[0].resolve([{ name:'brief.png', path:'files/_incoming/brief.png', type:'image/png' }]);
  await flush();
  assert.match(h.requests[0].url, /projects\/a\/orchestrator$/);
  assert.deepEqual(JSON.parse(JSON.stringify(h.requests[0].options.body.make)), { kind:'slides', sub:'auto' });
  h.requests[0].resolve({ line:'job-a' }); await starting;
  assert.equal(h.state.draft.text, 'Same words');
  assert.equal(h.state.draft.files[0].name, 'other.png');
  visit('a');
  assert.equal(h.state.draft.text, '');
  assert.equal(h.state.draft.files.length, 0);
  visit('b');
  assert.equal(h.state.draft.files[0].name, 'other.png');
});

test('a fresh page restores each unsent Orchestrator image, and remove and successful Start clear its bytes', async () => {
  const session = new Map(), blobs = new Map(), preferences = new Map(), options = { session, blobs, preferences };
  const first = harness(options);
  const words = 'Compare these two pictures.\nKeep the original sizes.';
  type(first, words);
  const file = new File(['original bytes'], 'first.png', { type:'image/png' });
  await first.c.orchAddFiles([file, new File(['other bytes'], 'second.png', { type:'image/png' })]);
  first.c.orchUseProject({ id:'elsewhere' }); first.render();
  assert.equal(first.document.querySelector('#orchGoal').value, '');
  assert.equal(first.document.querySelector('#orchFiles img'), null);
  first.c.rememberBoxes(); // pagehide, even when viewing another project

  const next = harness(options);
  await next.c.restoreBoxes(); next.render();
  assert.equal(next.document.querySelector('#orchGoal').value, words);
  assert.equal(next.document.querySelectorAll('#orchFiles img').length, 2);
  assert.equal(await next.state.draft.files[0].blob.text(), 'original bytes');
  assert.equal(next.uploads.length, 0);
  next.c.ACT['orch-remove'](next.document.querySelector('[data-act="orch-remove"]'));
  assert.equal(blobs.size, 1);
  const start = next.c.orchStart();
  assert.equal(await next.uploads[0].files[0].blob.text(), 'other bytes');
  next.uploads[0].resolve([{ path:'files/_incoming/second.png', name:'second.png', type:'image/png' }]);
  await flush();
  next.requests[0].reject(new Error('No')); await start;
  assert.equal(blobs.size, 1);
  const retry = next.c.ACT['orch-job-retry'](jobButton(next, 'retry'));
  await flush();
  next.requests[1].resolve({ line:'job' }); await retry;
  assert.equal(blobs.size, 0);
  const done = harness(options); await done.c.restoreBoxes(); done.render();
  assert.equal(done.document.querySelector('#orchGoal').value, '');
  assert.equal(done.state.draft.files.length, 0);
});

test('file limit is reported while all previously accepted files remain in the draft', () => {
  const h = harness();
  h.c.orchAddFiles(Array.from({ length:20 }, (_, i) => ({ name:'brief-' + i, size:1 })));
  h.c.orchAddFiles([{ name:'extra', size:1 }]);
  assert.equal(h.state.draft.files.length, 20);
  assert.match(h.toasts.at(-1).message, /20 files/);
});

test('a session exposes its conflict, dependency, timestamp and direct Stop alongside its child progress', () => {
  const h = harness();
  const child = { line:'child', title:'Child Work', status:'working', running:true, canStop:false, progress:'Reading <file>', works:[] };
  const job = { line:'parent', title:'Coordinator', status:'stopped', running:true, canStop:true, lastActivityAt:1794938400000,
    why:'Restart recorded', waitingOn:[{ line:'child', label:'PE-42' }], lines:[child] };
  h.state.data = { sessions:[job] };
  const box = h.document.querySelector('#orchSessions');
  box.innerHTML = h.run('orchSessionsHTML({id:"project"})');
  assert.match(box.textContent, /Stopped · Work still running/);
  assert.match(box.textContent, /Restart recorded/);
  assert.match(box.textContent, /Waiting for PE-42/);
  assert.match(box.textContent, /Reading <file>/);
  assert.equal(box.querySelector('.orch-dependency').dataset.line, 'child');
  assert.equal(box.querySelector('time').dateTime || box.querySelector('time').getAttribute('datetime'), new Date(job.lastActivityAt).toISOString());
  const stops = [...box.querySelectorAll('button[data-act="line-do"][data-verb="stop"]')];
  assert.deepEqual(stops.map(b => b.dataset.line), ['parent']);
  assert.equal(stops[0].textContent, 'Stop');
  assert.equal(stops[0].getAttribute('aria-label'), 'Stop Coordinator');
  assert.equal(box.querySelector('file'), null);
  // penecho.ai shows this page only for a project that lives on a computer, and Stop there reaches that computer.
  h.c.HOSTED = { onComputer:true };
  box.innerHTML = h.run('orchSessionsHTML({id:"project"})');
  assert.equal(box.querySelector('.orch-stop').dataset.line, 'parent');
  h.c.HOSTED = false;
});

test('retry reuses a confirmed upload and request id, and keeps agent and Start together', async () => {
  const h = harness(), picker = h.document.querySelector('.orch-bar .orch-picker');
  assert.ok(picker.matches('#orchAgent') && picker.nextElementSibling.querySelector('[data-act="orch-start"]'));
  h.c.orchAddFiles([{ name:'a', type:'text/plain' }, { name:'b', type:'text/plain' }]);
  type(h, 'Read both');
  const retry = () => h.c.ACT['orch-job-retry'](jobButton(h, 'retry')), file = name => [{ name, type:'text/plain', path:'files/_incoming/' + name }];
  const first = h.c.orchStart(); h.uploads[0].resolve(file('a')); await flush();
  h.uploads[1].reject(Error('Temporary upload failure')); await first;
  const second = retry(); assert.equal(h.uploads[2].files[0].name, 'b');
  h.uploads[2].resolve(file('b')); await flush();
  const id = h.requests[0].options.body.requestId;
  h.requests[0].reject(Error('Temporary Start failure')); await second;
  const third = retry(); await flush();
  assert.equal(h.uploads.length, 3); assert.equal(h.requests[1].options.body.requestId, id);
  // An upload that is gone is sent again by itself.
  h.requests[1].reject(Object.assign(Error('Restage b'), { code:'MISSING_UPLOAD', data:{ current:'files/_incoming/b' } })); await flush();
  assert.equal(h.uploads[3].files[0].name, 'b');
  h.uploads[3].resolve(file('b')); await flush(); h.requests[2].resolve({ line:'ok' }); await third;
  assert.equal(outbox(h).length, 0);
});

test('session pages span the whole non-archived history and keep questions and active work first', () => {
  const h = harness(), find = s => h.document.querySelector(s);
  const history = Array.from({ length:22 }, (_, i) => ({ line:'job-' + i, title:'Job ' + i, status:'done', lines:[] }));
  const active = { line:'running', title:'Running', status:'working', running:true, canStop:true, lines:[] };
  const question = { line:'question', title:'Question', status:'waiting', questions:['Choose a date'], askedAt:2, lines:[] };
  h.state.data = { sessions:[...history, active, question, { ...active, line:'archive', archived:true }] };
  h.c.orchPaintAll();
  const titles = () => [...h.document.querySelectorAll('.orch-title')].map(b => b.dataset.line);
  assert.deepEqual(titles(), ['question', 'running', ...history.slice(0, 8).map(s => s.line)]);
  assert.equal(find('.orch-range').textContent, '1–10 of 24 sessions');
  assert.ok(find('#orchPager-top [data-move="-1"]').disabled);
  assert.equal(find('.orch-stop').dataset.line, 'running');
  assert.equal(find('.orch-ask').dataset.line, 'question');
  const seen = titles();
  h.c.ACT['orch-page'](find('#orchPager-top [data-move="1"]'));
  seen.push(...titles());
  h.c.ACT['orch-page'](find('#orchPager-top [data-page="3"]'));
  seen.push(...titles());
  assert.deepEqual(seen, ['question', 'running', ...history.map(s => s.line)]);
  assert.equal(find('.orch-range').textContent, '21–24 of 24 sessions');
  assert.ok(find('#orchPager-top [data-move="1"]').disabled);
  // A poll on the last page can lose that page when sessions are archived.
  h.state.data.sessions = history.slice(0, 11);
  h.c.orchPaintAll();
  assert.equal(find('#orchPager-top [aria-current="page"]').textContent, '2');
  assert.deepEqual(titles(), ['job-10']);
  h.state.data.sessions = history.slice(0, 10);
  h.c.orchPaintAll();
  assert.equal(find('.orch-pager'), null);
  assert.equal(titles().length, 10);
});

test('session search combines with status, reaches delegated Lines on later pages, and stays put on refresh', () => {
  const h = harness(), find = s => h.document.querySelector(s);
  Object.assign(h.c.STATE_TEXT, { ready:'Finished', wait:'Needs you', review:'To review' });
  const sessions = Array.from({ length:12 }, (_, i) => ({ line:'job-' + i, title:'Session ' + i, ref:'PE-' + i,
    status:'done', lines:[] }));
  const child = { ref:'PE-950', line:'release-notes', title:'Release checklist', works:[] };
  sessions.at(-1).lines = [child, { ...child, title:'Hidden memo', line:'hidden', archived:true }];
  sessions.unshift({ line:'urgent', title:'Release decision', status:'waiting', lines:[] });
  h.state.data = { sessions };
  h.c.orchPaintSessions();
  const input = find('#orchSearch'), search = query => {
    input.value = query; input.dispatchEvent(new h.window.Event('input', { bubbles:true }));
  };
  const status = key => h.c.ACT['orch-status'](find('[data-status="' + key + '"]'));
  h.c.ACT['orch-page'](find('#orchPager-top [data-page="2"]'));
  status('ready');
  assert.equal(find('#orchPager-top [aria-current="page"]').textContent, '1');
  search(' RELEASE ');
  assert.equal(find('[data-status="ready"][aria-pressed="true"]').textContent, 'Finished 1');
  assert.equal(find('[data-status=""]').textContent.trim(), 'All 2');
  assert.equal(find('.orch-title').dataset.line, 'job-11');
  assert.equal(find('.orch-line-t').dataset.line, 'release-notes');
  h.state.data.sessions.at(-1).report = 'Fresh report';
  Object.defineProperty(h.document, 'activeElement', { get:() => input, configurable:true });
  h.c.orchPaintAll();
  assert.equal(find('#orchSearch'), input);
  assert.equal(input.value, ' RELEASE ');
  assert.match(find('.orch-report').textContent, /Fresh report/);
  search('pe-950');
  assert.equal(find('.orch-title').dataset.line, 'job-11');
  search('hidden memo');
  assert.match(find('.orch-empty').textContent, /No matching sessions/);
  assert.equal(find('.orch-run'), null);
  h.c.ACT['orch-clear']();
  assert.equal(input.value, '');
  assert.equal(find('[data-status=""][aria-pressed="true"]').textContent.trim(), 'All 13');
  status('wait');
  search('<img src=x>');
  assert.equal(find('#orchResults img'), null);
  h.c.orchUseProject({ id:'another-project' });
  h.state.data = { sessions:[child] };
  child.lines = [];
  h.document.querySelector('#orchSessions').innerHTML = h.run('orchSessionsHTML({ id:"another-project" })');
  assert.equal(find('#orchSearch').value, '');
  assert.equal(find('[data-status=""][aria-pressed="true"]').textContent.trim(), 'All 1');
});

test('sessions of every coordinating agent are listed together, with no agent filter', () => {
  const h = harness();
  h.state.data = { sessions:['saved', 'retired'].map(agent => ({ line:agent, title:agent, status:'done', agent, lines:[] })) };
  h.c.orchPaintSessions();
  assert.equal(h.document.querySelector('.orch-session-head select'), null);
  assert.equal(h.document.querySelector('.orch-range').textContent, '2 sessions');
});

test('keyboard focus follows the same session control after a refresh or the last page', t => {
  const h = harness(), find = s => h.document.querySelector(s);
  h.state.data = { sessions:Array.from({ length:11 }, (_, i) => ({ line:'job-'+i, title:'Job '+i, status:'working', running:true,
    canStop:true, lines:[] })) };
  h.c.orchPaintSessions();
  let active = find('.orch-stop');
  Object.defineProperty(h.document, 'activeElement', { get:() => active });
  const originalFocus = h.window.HTMLElement.prototype.focus;
  t.after(() => { h.window.HTMLElement.prototype.focus = originalFocus; });
  h.window.HTMLElement.prototype.focus = function() { active = this; };
  h.state.data.sessions[0].progress = 'Updated progress';
  h.c.orchPaintSessions();
  assert.equal(active, find('.orch-stop'));
  active = find('#orchPager-top [data-move="1"]');
  h.c.ACT['orch-page'](active);
  assert.equal(active, find('#orchPager-top [aria-current="page"]'));
  assert.equal(active.textContent, '2');
  let scrolled = false;
  find('#orchSessionsTitle').scrollIntoView = () => { scrolled = true; };
  h.c.ACT['orch-page'](find('#orchPager-bottom [data-move="-1"]'));
  assert.equal(active, find('#orchPager-top [aria-current="page"]'));
  assert.equal(active.textContent, '1');
  assert.ok(scrolled);
});

test('Orchestrator sidebar shows the Who did the work share card ranked by Works with combined ratings (PE-771)', () => {
  const h = harness();
  const project = {
    id:'project',
    name:'PenEcho',
    lines:[
      { id:'l1', title:'First', status:'done', stations:[
        { id:'w1', kind:'work', agent:'claude', state:'done', orchScore:4, rating:'good' },
        { id:'w2', kind:'work', agent:'claude', state:'done', orchScore:4 },
        { id:'w3', kind:'work', agent:'claude', state:'done', orchScore:5 },
        { id:'w4', kind:'work', agent:'codex', state:'done', orchScore:4 },
      ] },
      { id:'l2', title:'Second', status:'done', stations:[
        { id:'w5', kind:'work', agent:'antigravity', state:'done', rating:'good' },
        { id:'w6', kind:'work', agent:'dsh', state:'done' },
      ] },
    ],
  };
  h.c.project = () => project;
  h.document.body.innerHTML = h.c.orchestratorHTML(project);
  const panel = h.document.querySelector('#orchAgentsPanel');
  assert.match(panel.querySelector('.sx-eyebrow').textContent, /PenEcho · Agents/);
  assert.equal(panel.querySelector('#orchAgentsTitle').textContent, 'Who did the work');
  const rows = [...panel.querySelectorAll('.sx-share-list li')];
  assert.equal(rows.length, 4);
  assert.ok(rows[0].querySelector('.sx-share-rank.medal-1'));
  assert.ok(rows[1].querySelector('.sx-share-rank.medal-2'));
  assert.ok(rows[2].querySelector('.sx-share-rank.medal-3'));
  assert.equal(rows[3].querySelector('.sx-share-rank').className, 'sx-share-rank');
  assert.match(rows[0].textContent, /1.*claude.*50%.*3 Works.*4\.4.*rating/s);
  assert.match(rows[3].textContent, /4.*dsh.*17%.*1 Work.*—.*rating/s);
  assert.equal(rows[0].querySelector('.sx-share-track i').getAttribute('style').includes('width:100.0%'), true);
  assert.equal(panel.querySelector('.orch-agent-item'), null, 'old expandable agents list is replaced');

  // Empty project shows a calm message inside the Who did the work card.
  const empty = { id:'empty', name:'Empty', lines:[] };
  h.document.body.innerHTML = `<div id="orchAgents">${h.c.orchAgentsHTML(empty)}</div>`;
  assert.equal(h.document.querySelector('#orchAgentsTitle').textContent, 'Who did the work');
  assert.match(h.document.querySelector('#orchAgents').textContent, /No Works yet/);
});

test('Agents panel is on the right and shown by default; the person can hide and show it, and the choice is kept (PE-706)', () => {
  const preferences = new Map();
  const page = () => {
    const h = harness({ preferences });
    h.document.body.innerHTML = h.c.orchestratorHTML(h.c.project());
    return { h, host:h.document.querySelector('.orch-page'), panel:h.document.querySelector('#orchAgentsPanel'), toggle:h.document.querySelector('[data-act="orch-agents-toggle"]') };
  };
  const first = page();
  assert.ok(first.panel, 'the agents panel is part of the page');
  assert.equal(first.host.classList.contains('agents-hidden'), false, 'shown on a first visit');
  assert.equal(first.panel.hidden, false);
  assert.equal(first.toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(first.toggle.title, 'Hide the agents panel');
  const firstHide = first.h.document.querySelector('.orch-agents-hide');
  assert.ok(firstHide, 'the panel itself can hide it');
  first.h.c.ACT['orch-agents-toggle'](first.toggle);
  assert.equal(first.host.classList.contains('agents-hidden'), true);
  assert.equal(first.panel.hidden, true);
  assert.equal(first.toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(firstHide.getAttribute('aria-expanded'), 'false');
  assert.equal(preferences.get('penecho-orchestrator-agents-open-v1'), 'closed');

  const reloaded = page();
  assert.equal(reloaded.host.classList.contains('agents-hidden'), true, 'a hidden panel stays hidden after a reload');
  assert.equal(reloaded.panel.hidden, true);
  assert.equal(reloaded.toggle.getAttribute('aria-expanded'), 'false');
  reloaded.h.c.ACT['orch-agents-toggle'](reloaded.toggle);
  assert.equal(reloaded.host.classList.contains('agents-hidden'), false);
  assert.equal(reloaded.panel.hidden, false);
  assert.equal(reloaded.toggle.title, 'Hide the agents panel');
  assert.equal(preferences.get('penecho-orchestrator-agents-open-v1'), 'open');

  const reloadedHide = reloaded.h.document.querySelector('.orch-agents-hide');
  reloaded.h.c.ACT['orch-agents-toggle'](reloadedHide);
  assert.equal(reloaded.host.classList.contains('agents-hidden'), true);
  assert.equal(reloaded.panel.hidden, true);
  assert.equal(reloaded.toggle.getAttribute('aria-expanded'), 'false', 'the top control follows the one in the panel');
  assert.equal(preferences.get('penecho-orchestrator-agents-open-v1'), 'closed');
});

test('Opening Orchestrator renders the sidebar locally without requesting /orchestrator/agents (PE-771)', async () => {
  const h = harness({ realLoad:true });
  h.run('orchUseProject({ id:"project" }); ORCH.last = 0;');
  h.c.project = () => ({ id:'project', name:'PenEcho', rev:1, lines:[] });
  h.c.loadOrchestrator({ id:'project', name:'PenEcho', rev:1, lines:[] }, true);
  assert.deepEqual(h.requests.map(r => r.url), ['/api/lines/projects/project/orchestrator']);
  h.requests[0].resolve({ sessions:[], tools:[], kinds:[] });
  await flush();
});

test('a single Line shows each task kind on its own Work pill and rating context (PE-721)', () => {
  const h = harness();
  h.state.data = { sessions:[{ line:'plan', title:'Ship feature', lines:[{ line:'feature', ref:'PE-730', title:'New feature', works:[
    { work:'work-1', label:'Work 1', kind:'research', agent:'first', state:'done', score:4, note:'Clear options' },
    { work:'work-2', label:'Work 2', kind:'chat', agent:'saved', state:'done' },
    { work:'work-3', label:'Work 3', kind:'test', agent:'first', state:'active' },
    { work:'work-4', label:'Work 4', kind:'other', agent:'saved', state:'done' },
  ] }] }] };
  h.document.querySelector('#orchSessions').innerHTML = h.run('orchSessionsHTML(project())');
  const works = [...h.document.querySelectorAll('.orch-work')];
  assert.deepEqual(works.map(w => w.querySelector('.orch-wkind')?.textContent || ''), ['Research', 'Chat', 'Code', '']);
  assert.match(works[0].title, /Work 1 · Research · /);
  assert.match(works[1].title, /Work 2 · Chat · /);
  assert.match(h.document.querySelector('.orch-rating-context').textContent, /Research · Work 1/);
});

test('a link under the Orchestrator box opens a concise (<300 words) popup on how models are chosen (PE-660)', () => {
  const h = harness();
  const rawCreate = h.document.createElement.bind(h.document);
  h.document.createElement = (tag, ...rest) => {
    const el = rawCreate(tag, ...rest);
    if (String(tag).toLowerCase() === 'dialog') {
      el.open = false;
      el.showModal = () => { el.open = true; };
      el.close = () => {
        if (!el.open) return;
        el.open = false;
        el.dispatchEvent(new h.window.Event('close'));
      };
    }
    return el;
  };
  h.document.body.innerHTML = h.c.orchestratorHTML(h.c.project());
  const wrap = h.document.querySelector('.orch-box-wrap');
  const link = wrap?.querySelector('[data-act="orch-how-models"]');
  assert.ok(wrap?.querySelector('#orchBox') && link, 'link sits with the Orchestrator input box');
  assert.equal(link.getAttribute('aria-haspopup'), 'dialog');

  // Dismissing the guide hides starters, but keeps the model-selection link visible.
  h.c.ACT['orch-guide-dismiss']();
  assert.equal(h.document.querySelector('#orchGuide').hidden, true);
  assert.equal(h.document.querySelector('#orchStarters').hidden, true);
  assert.equal(link.hidden, false);
  assert.equal(link.closest('[hidden]'), null);

  let focused = 0;
  link.focus = () => { focused += 1; };
  h.c.ACT['orch-how-models'](link);
  const dialog = h.document.querySelector('#orchHowModelsDialog');
  assert.ok(dialog && dialog.open === true);
  assert.equal(dialog.getAttribute('aria-labelledby'), 'orchHowModelsTitle');
  // Calling it again does not open a duplicate dialog.
  h.c.ACT['orch-how-models'](link);
  assert.equal(h.document.querySelectorAll('#orchHowModelsDialog').length, 1);

  const heading = dialog.querySelector('#orchHowModelsTitle').textContent.trim();
  const body = dialog.querySelector('.orch-how-body').textContent.replace(/\s+/g, ' ').trim();
  const words = `${heading} ${body}`.split(/\s+/).filter(Boolean);
  assert.ok(words.length > 60 && words.length < 300, `expected <300 words, got ${words.length}`);
  assert.match(body, /60 days/);
  assert.match(body, /Finish rate is not counted/i);
  assert.match(body, /Good\s*=\s*4\.5/);
  assert.match(body, /Not good\s*=\s*2/);
  // Sub-agents (PE-1190): who does a part, and that somebody always does.
  assert.match(body, /You first: the agents or views you ask for/);
  assert.match(body, /within 5 points of it, or better, under half its cost: cheapest first, two parts each/);
  assert.match(body, /with 5 jobs or fewer, now and then a part, until two poor ratings/);
  assert.match(body, /Fallback: the coordinator\. A part stopped by a limit or error first goes to the next model once\. Sub-agents start no others/);
  assert.match(body, /Sub-agents: a model and effort is one across apps/);
  assert.match(body, /Without a price, never picked as cheaper/);
  // PenEcho Auto (PE-1085): the kind is read with no model call, then the agent.
  const auto = [...dialog.querySelectorAll('.orch-how-body h3')].find(h3 => h3.textContent === 'PenEcho Auto')?.nextElementSibling.textContent.replace(/\s+/g, ' ');
  assert.match(auto, /by keywords, with no model call: code, chat, design, research or docs/);
  assert.match(auto, /best rated for that kind, whatever it costs. A busy agent gives way to a free one within 10 points of 100/);
  assert.match(auto, /if another is within 5 points and costs half or less, it starts instead/);
  assert.match(auto, /one time in three, the same model at your next lower saved effort, down to medium/);
  assert.match(auto, /usage limit, until it resets \(3 hours if unknown, 5 at most\); after an error, 3 hours. If all are, one still starts/);
  // Only the saved agents are used, and a model at several efforts is how it finds the best fit (PE-1190).
  assert.match(body, /Only presets in Settings → Agents are used: save a model at several efforts/);

  // Clicking inside the dialog content does not close it; clicking Close or backdrop does and restores focus.
  dialog.querySelector('.orch-how-body p').dispatchEvent(new h.window.Event('click', { bubbles:true }));
  assert.equal(dialog.open, true);
  dialog.querySelector('footer [data-cancel]').dispatchEvent(new h.window.Event('click', { bubbles:true }));
  assert.equal(h.document.querySelector('#orchHowModelsDialog'), null);
  assert.equal(focused, 1);

  // Backdrop click also closes the dialog.
  h.c.ACT['orch-how-models'](link);
  const again = h.document.querySelector('#orchHowModelsDialog');
  again.dispatchEvent(new h.window.Event('click', { bubbles:true }));
  assert.equal(h.document.querySelector('#orchHowModelsDialog'), null);
  assert.equal(focused, 2);

  h.c.HOSTED = true;
  assert.doesNotMatch(h.c.orchestratorHTML(h.c.project()), /orch-how-models/);
  h.c.HOSTED = false;
});

test('unified Statistics Agents table rolls up kinds per setup, expands per-kind breakdown, and caps long lists', () => {
  const h = harness();
  h.state.project = 'project';
  h.c.S.route.view = 'stats';
  const rows = [
    { agent:'Claude Code · claude-opus-5-5 · high effort', runner:'claude', model:'claude-opus-5-5', effort:'high', kind:'code', works:8, running:0, medianMinutes:6, tokensPerWork:200000, tokensKnown:8, costPerWork:2.0, costKnown:8, totalCost:16, score:4.5, scored:4, rating:4.6, rated:5, good:2, bad:0 },
    { agent:'Claude Code · claude-opus-5-5 · high effort', runner:'claude', model:'claude-opus-5-5', effort:'high', kind:'docs', works:2, running:0, medianMinutes:3, tokensPerWork:100000, tokensKnown:2, costPerWork:0.5, costKnown:2, totalCost:1, score:5.0, scored:1, rating:5.0, rated:1, good:0, bad:0 },
    ...Array.from({ length:11 }, (_, i) => ({
      agent:`Agent ${i + 1}`, runner:'codex', model:`m-${i + 1}`, effort:'', kind:'code', works:1, running:0, medianMinutes:2, tokensPerWork:50000, costPerWork:0.1, score:4, scored:1, rating:4, rated:1, good:0, bad:0,
    })),
  ];
  const ratings = Array.from({ length:7 }, (_, i) => ({
    line:`l-${i}`, title:`Line ${i}`, work:'work-1', label:'Work 1', agent:'Claude Code', runner:'claude', kind:'code', score:5, note:`Note ${i}`,
  }));
  h.state.stats = { models:[], rows, ratings };
  h.document.body.innerHTML = h.c.statsRecordHTML({ id:'project' });

  // Claude's 2 kinds roll up into 1 row (12 unique setups total), capped to 10 initially.
  const trs = () => [...h.document.querySelectorAll('#statsRecord tbody tr, #statsRecord table tr')].slice(1);
  assert.equal(trs().length, 10);
  assert.match(h.document.querySelector('#statsRecord [data-act="orch-record-all"]').textContent, /Show all 12 agents/);
  assert.match(trs()[0].textContent, /Claude Code · claude-opus-5-5/);
  assert.match(trs()[0].textContent, /high effort · 2 kinds/);
  assert.match(trs()[0].textContent, /10/);
  assert.match(trs()[0].textContent, /\$1\.70/);
  assert.match(trs()[0].textContent, /\$17 total/);

  // Expanding Claude shows both Code and Docs per-kind cards.
  h.c.ACT['orch-record-open'](trs()[0]);
  const kindCards = [...h.document.querySelectorAll('#statsRecord .sx-kind-item')];
  assert.equal(kindCards.length, 2);
  assert.match(kindCards[0].textContent, /Code/);
  assert.match(kindCards[1].textContent, /Docs/);

  // Show all agents reveals all 12 setups (plus the 1 expanded row = 13 rows).
  h.c.ACT['orch-record-all']();
  assert.equal(trs().length, 13);

  // Recent ratings shows 5 initially, then all 7 on Show all.
  assert.equal(h.document.querySelectorAll('#statsRecord .orch-rating').length, 5);
  h.c.ACT['orch-ratings-all']();
  assert.equal(h.document.querySelectorAll('#statsRecord .orch-rating').length, 7);
});

test('orchestrator card surfaces errored Work pills and stopped child Lines instead of looking cleanly finished (PE-792)', () => {
  const h = harness();
  h.state.data = { sessions:[
    { line:'clean', title:'Clean session', status:'done', lines:[] },
    { line:'has-err', title:'Deploy MeetCue', status:'done', report:'Done.', lines:[
      { line:'child-err', ref:'PE-760', title:'MeetCue Cloud', status:'stopped', why:'Agent crashed', works:[
        { work:'work-1', label:'Work 1', kind:'code', agent:'omp', state:'off', stopWhy:'error' },
        { work:'work-2', label:'Work 2', kind:'code', agent:'claude', state:'off', stopWhy:'limit' },
        { work:'work-3', label:'Work 3', kind:'review', agent:'codex', state:'done', score:5 },
      ] },
    ] },
  ] };
  h.document.querySelector('#orchSessions').innerHTML = h.run('orchSessionsHTML(project())');
  const cards = [...h.document.querySelectorAll('.orch-run')];
  assert.match(cards[0].textContent, /Deploy MeetCue/, 'session with stopped child Line sorts ahead of cleanly finished sessions');
  const badge = cards[0].querySelector('header .fl-state.s-error');
  assert.ok(badge, 'session header shows an error badge when a child Line is stopped');
  assert.match(badge.textContent, /1 Line stopped/);
  const pills = [...cards[0].querySelectorAll('.orch-work')];
  assert.ok(pills[0].classList.contains('w-error'), 'Work stopped with stopWhy:error renders with w-error');
  assert.match(pills[0].textContent, /Error/);
  assert.ok(pills[1].classList.contains('w-error'), 'Work stopped with stopWhy:limit renders with w-error');
  assert.match(pills[1].textContent, /Limit/);
  assert.ok(pills[2].classList.contains('w-done'));
});

test('orchestrator card distinguishes discarded and replaced Works from unrecovered errors', () => {
  const h = harness();
  h.state.data = { sessions:[
    { line:'discarded-session', title:'Discarded work session', status:'done', report:'Done.', lines:[
      { line:'child-disc', ref:'PE-801', title:'Child with discarded error', status:'done', works:[
        { work:'work-1', label:'Work 1', kind:'code', agent:'omp', state:'off', off:'discarded', stopWhy:'error' },
        { work:'work-2', label:'Work 2', kind:'code', agent:'codex', state:'done', score:5 },
      ] },
    ] },
    { line:'replaced-session', title:'Recovered PE-760 style', status:'done', report:'Done.', lines:[
      { line:'child-rec', ref:'PE-760', title:'MeetCue Cloud', status:'done', works:[
        { work:'work-1', label:'Work 1', kind:'code', agent:'omp', state:'off', off:'ended', stopWhy:'error' },
        { work:'work-2', label:'Work 2', kind:'code', agent:'antigravity', state:'done', score:5 },
      ] },
    ] },
    { line:'unrecovered-lane', title:'Unrecovered parallel error', status:'done', report:'Done.', lines:[
      { line:'child-lane', ref:'PE-802', title:'Child with stopped lane', status:'done', works:[
        { work:'work-1', label:'Work 1', kind:'code', agent:'claude', state:'off', off:'stopped', stopWhy:'error' },
        { work:'work-2', label:'Work 2', kind:'review', agent:'codex', state:'done', score:5 },
      ] },
    ] },
  ] };
  h.document.querySelector('#orchSessions').innerHTML = h.run('orchSessionsHTML(project())');
  const cards = [...h.document.querySelectorAll('.orch-run')];
  // Unrecovered parallel error sorts first and gets a header badge.
  assert.match(cards[0].textContent, /Unrecovered parallel error/);
  assert.match(cards[0].querySelector('header .fl-state.s-error')?.textContent || '', /1 Line with errors/);
  // Discarded work renders as Discarded (w-off), never Error/Limit, and has no header error badge.
  const discCard = cards.find(c => /Discarded work session/.test(c.textContent));
  assert.equal(discCard.querySelector('header .fl-state.s-error'), null);
  const discPill = discCard.querySelector('.orch-work');
  assert.ok(discPill.classList.contains('w-off'), 'discarded Work with stopWhy:error must render w-off, not w-error');
  assert.match(discPill.textContent, /Discarded/);
  // Replaced (off:ended) Work shows its Error pill on the child Line without false-positive session header badge.
  const recCard = cards.find(c => /Recovered PE-760 style/.test(c.textContent));
  assert.equal(recCard.querySelector('header .fl-state.s-error'), null);
  assert.ok(recCard.querySelector('.orch-work').classList.contains('w-error'));
});

test('PE-821: session and child Line titles stay on a single line across the full available width with full-title tooltips', () => {
  const h = harness();
  const longTitle = 'I need a sub title of PenEcho Lines, pls submit all your sub agents to give one, and then give me the final';
  const longChild = 'Investigate every sub-agent proposal and summarize the strongest candidates across the whole width';
  h.state.data = { sessions:[{
    line:'sub-title', ref:'PE-819', title:longTitle, status:'working', running:true, canStop:true, agent:'antigravity',
    lines:[{ line:'child-1', ref:'PE-820', title:longChild, status:'done', works:[{ work:'work-1', agent:'first', state:'done' }] }],
  }] };
  h.document.querySelector('#orchSessions').innerHTML = h.run('orchSessionsHTML(project())');
  const titleBtn = h.document.querySelector('.orch-title');
  assert.equal(titleBtn.getAttribute('title'), longTitle);
  assert.equal(titleBtn.querySelector('span').textContent, longTitle);
  const childBtn = h.document.querySelector('.orch-line-t');
  assert.equal(childBtn.getAttribute('title'), longChild);
  assert.equal(childBtn.querySelector('span').textContent, longChild);

  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'lines', 'orchestrator.css'), 'utf8');
  assert.match(css, /#orchSessions\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  assert.match(css, /#orchResults,\s*\.orch-list\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  assert.match(css, /\.orch-run\s*\{[^}]*min-width:\s*0;/);
  assert.match(css, /\.orch-title\s*\{[^}]*display:\s*inline-flex;[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/);
  assert.match(css, /\.orch-title span\s*\{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/);
  assert.match(css, /\.orch-line-t span\s*\{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/);
});

test('Agent record folds stale Fix and Test rows into Code, omits Review ratings, and never shows an Other kind', () => {
  const h = harness();
  h.state.project = 'project';
  h.state.kind = 'other'; // A selection left over from the earlier category set.
  h.state.kinds = ['review', 'fix', 'test', 'chat', 'other'];
  const codeRow = { agent:'Writer', runner:'saved', works:2, score:4, scored:2 };
  h.state.stats = { rows:[
    { ...codeRow, kind:'fix' }, { ...codeRow, kind:'test' }, { ...codeRow, kind:'chat', works:1 },
    { ...codeRow, kind:'other', works:3, score:null, scored:0 },
    { ...codeRow, kind:'review', works:100, score:1 },
  ], ratings:[
    { line:'child', title:'Legacy review task', work:'work-1', runner:'saved', kind:'review', score:1 },
    { line:'child', title:'Patch', work:'work-2', runner:'saved', kind:'fix', score:4 },
  ] };
  h.document.body.innerHTML = h.c.statsRecordHTML({ id:'project' });
  const tabs = [...h.document.querySelectorAll('[data-act="orch-kind"]')];
  assert.deepEqual(tabs.map(b => b.dataset.kind), ['', 'code', 'chat']);
  assert.equal(tabs[0].getAttribute('aria-pressed'), 'true');
  assert.doesNotMatch(h.document.body.textContent, /Legacy review task|100|\bOther\b/);
  const row = h.document.querySelector('[data-act="orch-record-open"]');
  assert.equal(row.children[1].textContent, '8');
  h.c.ACT['orch-record-open'](row);
  assert.deepEqual([...h.document.querySelectorAll('.sx-kind-top b')].map(el => el.textContent), ['Code', 'Chat']);
  assert.match(h.document.querySelector('.sx-kind-item > small').textContent, /4 Works/);
  h.state.kind = 'code';
  h.document.body.innerHTML = h.c.statsRecordHTML({ id:'project' });
  assert.equal(h.document.querySelector('table tr:nth-child(2) td:nth-child(2)').textContent, '4');
});

test('loading Orchestrator settings with PenEcho Auto remembered updates the picker while #orchGoal keeps focus and draft', async t => {
  const preferences = new Map([['penecho-orchestrator-agent-v1', 'auto']]);
  const h = harness({ preferences });
  h.document.body.innerHTML = h.c.orchestratorHTML(h.c.project());
  h.c.wireComposers(h.document);
  const goal = h.document.querySelector('#orchGoal');
  let active = goal;
  Object.defineProperty(h.document, 'activeElement', { configurable:true, get:() => active });
  const originalFocus = h.window.HTMLElement.prototype.focus;
  t.after(() => { h.window.HTMLElement.prototype.focus = originalFocus; });
  h.window.HTMLElement.prototype.focus = function() { active = this; };

  assert.equal(h.document.querySelector('#orchAgent').dataset.orchPreset, 'first', 'initial draw before settings load falls back to default preset');
  type(h, 'Typing before settings arrive');
  const bar = h.document.querySelector('.orch-bar');
  bar.dataset.fit = 'stale-fit';

  const loading = h.c.loadOrchSettings(h.c.project(), true);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, '/api/lines/projects/project/orchestrator/settings');
  h.requests[0].resolve({ review:true, reviewer:'auto', reviewers:[], agents:2, costsKnown:true, seen:true, sync:null });
  await loading;

  const picker = h.document.querySelector('#orchAgent');
  assert.equal(picker.dataset.orchPreset, 'auto', 'picker updates to PenEcho Auto even while #orchGoal has focus');
  assert.match(picker.getAttribute('aria-label'), /PenEcho Auto/);
  assert.equal(picker.getAttribute('title'), 'PenEcho Auto · Model and effort chosen automatically');
  assert.match(picker.textContent, /PenEcho Auto/);
  assert.equal(h.document.querySelector('#orchGoal'), goal, 'in-place picker update keeps the same textarea DOM node');
  assert.equal(active, goal, '#orchGoal stays focused');
  assert.equal(goal.value, 'Typing before settings arrive');
  assert.equal(bar.dataset.fit, undefined, 'bar fit cache is invalidated for the new picker label');
});

test('orchRefreshBox and forced orchPaint preserve #orchGoal focus and selection and focus newly available hosted composer only when idle', t => {
  const h = harness();
  const originalFocus = h.window.HTMLElement.prototype.focus;
  let active = null;
  Object.defineProperty(h.document, 'activeElement', { configurable:true, get:() => active });
  t.after(() => { h.window.HTMLElement.prototype.focus = originalFocus; });
  h.window.HTMLElement.prototype.focus = function() { active = this; };

  // 1. Forced orchPaint('orchBox', ..., true) preserves #orchGoal focus, selection range, and scrollTop.
  type(h, 'Hello world');
  const firstGoal = h.document.querySelector('#orchGoal');
  active = firstGoal;
  firstGoal.selectionStart = 2;
  firstGoal.selectionEnd = 5;
  firstGoal.selectionDirection = 'forward';
  firstGoal.scrollTop = 18;
  let restoredRange = null;
  const origSetSel = h.window.HTMLTextAreaElement.prototype.setSelectionRange;
  t.after(() => { h.window.HTMLTextAreaElement.prototype.setSelectionRange = origSetSel; });
  h.window.HTMLTextAreaElement.prototype.setSelectionRange = function(start, end, dir) {
    restoredRange = [start, end, dir];
    this.selectionStart = start;
    this.selectionEnd = end;
    this.selectionDirection = dir;
  };
  h.run("orchPaint('orchBox', orchBoxHTML(), true)");
  const replacedGoal = h.document.querySelector('#orchGoal');
  assert.notEqual(replacedGoal, firstGoal);
  assert.equal(active, replacedGoal, 'focus moves to the new #orchGoal');
  assert.deepEqual(restoredRange, [2, 5, 'forward']);
  assert.equal(replacedGoal.scrollTop, 18);

  // 2. orchRefreshBox updates #orchAgent in place when composer already exists and presets change.
  h.c.S.presets = { default:'newer', presets:[{ id:'newer', name:'Newer agent', agent:'claude', available:true }] };
  h.c.orchRefreshBox();
  assert.equal(h.document.querySelector('#orchGoal'), replacedGoal, 'textarea node is preserved when presets refresh');
  assert.equal(active, replacedGoal);
  assert.equal(h.document.querySelector('#orchAgent').dataset.orchPreset, 'newer');

  // 3. Presets disappear -> .orch-none; then presets return while idle -> #orchGoal gets focus.
  h.c.S.presets = null;
  h.c.orchRefreshBox();
  assert.equal(h.document.querySelector('#orchGoal'), null);
  active = h.document.body;
  h.c.S.presets = { default:'returned', presets:[{ id:'returned', name:'Returned agent', agent:'codex', available:true }] };
  h.c.orchRefreshBox();
  const returnedGoal = h.document.querySelector('#orchGoal');
  assert.ok(returnedGoal);
  assert.equal(active, returnedGoal, 'focuses #orchGoal when composer arrives and focus is idle');

  // 4. Presets arrive while another control has focus -> do not steal focus.
  h.c.S.presets = null;
  h.c.orchRefreshBox();
  const other = h.document.createElement('input');
  other.id = 'orchSearch';
  h.document.body.append(other);
  active = other;
  h.c.S.presets = { default:'returned', presets:[{ id:'returned', name:'Returned agent', agent:'codex', available:true }] };
  h.c.orchRefreshBox();
  assert.ok(h.document.querySelector('#orchGoal'));
  assert.equal(active, other, 'does not steal focus from another focused control');
});
