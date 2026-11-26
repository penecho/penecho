'use strict';
// Run with and the other buttons that start an agent change the page at once; the server starts the agent behind it (PE-600).
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { parseHTML } = require('./helpers/dom.js');
const read = name => fs.readFileSync(path.join(__dirname, '../public/lines', name + '.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const turn = () => new Promise(resolve => setImmediate(resolve));

function harness() {
  const { document, window } = parseHTML('<html><body><div id="view"></div></body></html>');
  const requests = [], toasts = [], shown = [];
  const c = vm.createContext({ document, window, console, navigator:{ platform:'Mac' }, location:{ hash:'#p/line/one' },
    ACT:{}, SEND:{}, HOSTED:false, EMBED:null, STATE_COLOR:{}, LINE_STATUS:require('../public/lines/line-status.js'),
    localStorage:{ getItem:() => null }, addEventListener() {},
    $:(sel, root = document) => root.querySelector(sel), $$:(sel, root = document) => [...root.querySelectorAll(sel)],
    esc:String, ic:() => '', reducedMotion:() => true, toast:msg => toasts.push(msg), nowWhen:() => '2026-11-17 14:00',
  });
  const run = code => vm.runInContext(code, c);
  run(read('state')); run(read('line'));
  const S = run('S'); S.cur = 'p'; S.route = { view:'line', line:'one' };
  S.agents = [{ id:'codex', name:'Codex', available:true }];
  const stored = { format:2, rev:'r1', project:{ id:'p' }, landed:[], backlog:[], lines:[{
    id:'one', slug:'one', status:'done', running:false, questions:[], stations:[
      { id:'ask-1', index:0, kind:'ask', state:'done', text:'Fix it' },
      { id:'work-1', index:1, kind:'work', state:'done', out:'Done' },
      { id:'ask-2', index:2, kind:'ask', state:'todo', unsent:true, via:'Not sent', text:'Do more' },
      { id:'finished', index:3, kind:'deliver', state:'done', label:'Finished', finished:true },
    ],
  }] };
  c.api = (url, opts = {}) => new Promise((resolve, reject) => {
    const verb = opts.method === 'POST' ? url.split('/').at(-1) : 'state';
    requests.push({ verb, body:opts.body, resolve:data => resolve(data || (verb === 'state' ? clone(stored) : { ok:true })), reject });
  });
  Object.assign(c, { runnableAgents:() => S.agents, refreshAfterChange:() => { const l = S.data.p.lines[0]; shown.push({ status:l.status, ids:l.stations.map(s => s.id + (s.unsent ? '?' : '')) }); } });
  c.adoptState(clone(stored));
  const line = () => S.data.p.lines[0];
  return { c, S, requests, toasts, shown, stored, line };
}

test('Run with shows the Ask sent and its Work starting before the server answers', async () => {
  const h = harness();
  h.c.runUnsent(h.S.data.p, h.line(), 'ask-2', 'codex');
  // Before any answer: the page already changed.
  assert.deepEqual(h.shown[0], { status:'working', ids:['ask-1', 'work-1', 'ask-2', 'starting-ask-2', 'finished'] });
  assert.equal(h.line().running, true);
  assert.equal(h.line().stations[3].state, 'active');
  assert.equal(h.requests[0].verb, 'run-unsent');
  // A poll that arrives before the server wrote anything keeps the change.
  h.c.adoptState(clone(h.stored));
  assert.equal(h.line().status, 'working');
  assert.equal(h.line().stations.find(s => s.id === 'ask-2').unsent, false);
  // The server has it: its own state is shown.
  h.stored.lines[0] = { ...h.stored.lines[0], status:'working', running:true, stations:[...h.stored.lines[0].stations.slice(0, 2), { id:'ask-3', index:2, kind:'ask', state:'done', text:'Do more' }, { id:'work-2', index:3, kind:'work', state:'active' }, h.stored.lines[0].stations[3]] };
  h.requests[0].resolve({ ok:true, agent:'codex' });
  await turn();
  h.requests[1].resolve(); await turn(); await turn();
  assert.deepEqual(h.line().stations.map(s => s.id), ['ask-1', 'work-1', 'ask-3', 'work-2', 'finished']);
  assert.deepEqual(h.toasts, []);
});

test('A run that fails says why and shows the Ask Not sent again', async () => {
  const h = harness();
  h.c.runUnsent(h.S.data.p, h.line(), 'ask-2', 'codex');
  assert.equal(h.line().status, 'working');
  h.requests[0].reject(new Error('PenEcho cannot run Codex on this computer. Paste it instead.'));
  await turn();
  h.requests[1].resolve(); await turn(); await turn();
  assert.equal(h.line().status, 'done');
  assert.equal(h.line().stations.find(s => s.id === 'ask-2').unsent, true);
  assert.equal(h.line().stations.some(s => s.id === 'starting-ask-2'), false);
  assert.deepEqual(h.toasts, ['PenEcho cannot run Codex on this computer. Paste it instead.']);
});

test('Retry, Carry on with and Approve show the line working before the server answers', async () => {
  for (const [verb, start] of [['retry', h => h.c.ACT['line-do']({ dataset:{ line:'one', verb:'retry' }, disabled:false })],
    ['carry-on', h => h.c.carryOnWith(h.line(), h.line().stations[1], 'codex', '', 'Codex')],
    ['approve', h => h.c.ACT['approve-step']({ dataset:{ line:'one' }, disabled:false })]]) {
    const h = harness();
    start(h);
    assert.equal(h.shown[0]?.status, 'working', verb);
    assert.equal(h.requests[0].verb, verb);
    h.requests[0].resolve(); await turn();
    h.requests[1].resolve(); await turn(); await turn();
    assert.equal(h.line().status, 'done', `${verb}: the server's state comes back after the answer`);
  }
});

test('An answered question leaves at once', async () => {
  const h = harness();
  h.stored.lines[0].questions = [{ id:'q1', text:'Which one?', options:['A', 'B'] }];
  h.c.adoptState(clone(h.stored));
  h.c.ACT['answer-q']({ dataset:{ line:'one', q:'q1', a:'A' } });
  assert.equal(h.line().questions.length, 0);
  h.c.adoptState(clone(h.stored));
  assert.equal(h.line().questions.length, 0, 'a poll before the answer is saved keeps it answered');
  assert.equal(h.requests[0].verb, 'answer');
  h.requests[0].resolve(); await turn();
  h.stored.lines[0].questions = [];
  h.requests[1].resolve(); await turn(); await turn();
  assert.deepEqual(h.toasts, ['Recorded in one.md']);
});

test('Stop is at the top right as soon as Run with is pressed (with no Pause), and Stop lets the starting view go', async () => {
  const h = harness();
  const head = () => vm.runInContext('l => lineHeadActions(project(), l, lineState(l), currentStation(l))', h.c)(h.line());
  h.c.runUnsent(h.S.data.p, h.line(), 'ask-2', 'codex');
  assert.doesNotMatch(head(), /data-verb="pause"/);
  assert.match(head(), /data-verb="stop"/);
  h.c.ACT['line-do']({ dataset:{ line:'one', verb:'stop' }, disabled:false });
  assert.equal(h.requests[1].verb, 'stop', 'sent while the start is still on its way');
  // A state that arrives now is the server's own: the line is not kept looking as if it starts.
  h.c.adoptState(clone(h.stored));
  assert.equal(h.line().status, 'done');
});

test('a followed Work shows how to stop in its owning app from the Line and the open Work', async () => {
  const h = harness(), line = h.line(), work = line.stations[1];
  h.c.agentInfo = id => ({ name:id === 'antigravity' ? 'Antigravity' : id });
  h.c.av = () => '';
  h.S.thisComputer = true;
  Object.assign(line, { running:true, elsewhere:true, runAgent:'antigravity', status:'working',
    conversations:{ antigravity:{ agent:'antigravity', opensApp:'Antigravity' } } });
  Object.assign(work, { state:'active', agent:'antigravity' });
  const button = html => parseHTML('<html><body>' + html + '</body></html>').document.querySelector('.followed-stop');
  const panelButton = () => button(h.c.panelHead(line, work));
  // Both old Line-only data and the Work-specific live owner from newer servers.
  assert.equal(button(h.c.chatButtons(line)).textContent, 'Stop in Antigravity');
  work.stopIn = { agent:'antigravity', app:'Antigravity' };
  const control = panelButton();
  assert.equal(control.textContent, 'Stop in Antigravity');
  const opened = h.c.ACT[control.dataset.act](control);
  assert.equal(h.requests[0].verb, 'open-desktop');
  assert.deepEqual({ ...h.requests[0].body }, { agent:'antigravity', step:'work-1', forStop:true });
  h.requests[0].resolve(); await opened;
  assert.equal(work.state, 'active');
  h.S.thisComputer = false;
  const remote = panelButton();
  h.c.ACT[remote.dataset.act](remote);
  assert.match(h.toasts.at(-1), /computer where it is running/);
  h.S.thisComputer = true;
  work.stopIn = { agent:'antigravity', terminal:true };
  assert.match(panelButton().title, /original Antigravity terminal/);
  work.state = 'done';
  assert.equal(panelButton(), null);
  work.state = 'active';
  line.elsewhere = false;
  assert.equal(panelButton(), null);
});

test('Run with while a followed app conversation is live runs next and keeps the running app agent', async () => {
  const h = harness(), line = h.line(), work = line.stations[1];
  h.S.agents = [{ id:'codex', name:'Codex', available:true }, { id:'antigravity', name:'Antigravity', available:true }];
  h.c.agentInfo = id => ({ name:id === 'codex' ? 'Codex' : 'Antigravity' });
  Object.assign(line, { running:true, elsewhere:true, runAgent:'codex', status:'working' });
  Object.assign(work, { state:'active', agent:'codex' });
  assert.equal(h.c.runMode(line, 'antigravity', null), 'next');
  assert.equal(h.c.runMode(line, 'codex', null), 'next');
  h.c.runUnsent(h.S.data.p, line, 'ask-2', 'antigravity');
  assert.equal(line.runAgent, 'codex', 'optimistic update keeps the live external agent');
  const queued = line.stations.find(s => s.id === 'starting-ask-2');
  assert.equal(queued?.state, 'todo', 'queued Work starts in todo state, not active');
  assert.equal(queued?.agent, 'antigravity');
  assert.equal(vm.runInContext('isQueued', h.c)(line, queued), true, 'queued Work behind active external Work shows Remove from queue');
  assert.equal(h.requests[0].verb, 'run-unsent');
  assert.equal(h.requests[0].body.expectedMode, 'next');
  h.requests[0].resolve({ ok:true, agent:'antigravity', after:true, mode:'queued', next:'codex' });
  await turn();
  h.requests[1].resolve(); await turn(); await turn();
  assert.deepEqual(h.toasts, ['Runs with Antigravity when Codex finishes.']);
});

test('an unsent Ask without a code folder offers PenEcho Auto directly and first in Run with', async () => {
  const h = harness(), line = h.line(), draft = line.stations.at(-2), p = h.S.data.p;
  const manual = { id:'manual', agent:'codex', name:'Codex · gpt-6.2-astra · xhigh effort', available:true };
  p.vault = { code:[] };
  h.S.presets = { presets:[manual] };
  h.S.runWith = { one:'codex' };
  h.S.runPresetOn = { one:manual.id };
  let menu;
  Object.assign(h.c, {
    can:() => true, fileEntry:() => null, agentInfo:() => ({ name:'Codex' }),
    presetTitle:x => x.name, presetShouldShowFacts:() => false, openMenu:(_anchor, rows) => { menu = rows; },
  });
  const view = h.c.document.querySelector('#view');
  const render = () => { view.innerHTML = h.c.unsentFoot(p, line, draft); };
  const autoButton = () => view.querySelector('[data-act="unsent-run-auto"]');
  const picker = () => view.querySelector('[data-act="unsent-run-pick"]');

  render();
  assert.deepEqual([...view.querySelectorAll('.unsent-acts > *')].map(el => el.textContent), [
    `Run with ${manual.name}`, 'Run with PenEcho Auto', 'Paste with context',
  ]);
  h.S.presets.presets = [{ ...manual, showInPicker:false }]; render();
  assert.equal(Boolean(autoButton()), false);
  assert.equal(picker(), null);
  h.S.presets.presets = [manual];
  h.c.HOSTED = {}; render();
  assert.equal(Boolean(autoButton()), false);
  assert.equal(picker(), null);
  h.c.HOSTED = false;

  Object.assign(line, { running:true, runAgent:'codex', runSteers:true, runSetup:'|' });
  render();
  const auto = autoButton();
  h.c.refreshRunLabels();
  assert.equal(auto.textContent, 'Run with PenEcho Auto next');
  const saved = [];
  h.c.whenAskSaved = (_project, _line, _step, run) => saved.push(run);
  h.c.ACT['unsent-run-pick'](picker());
  const [autoRow, manualRow] = menu.filter(row => row.label);
  assert.equal(autoRow.label, 'PenEcho Auto');
  assert.equal(autoRow.note, 'Model and effort chosen automatically · Runs next');
  assert.equal(autoRow.on, false);
  assert.equal(manualRow.label, manual.name);
  assert.equal(manualRow.on, true);
  autoRow.fn();
  assert.equal(saved.length, 1);
  h.c.ACT['unsent-run-auto'](auto);
  assert.equal(saved.length, 2);
  assert.equal(h.requests.length, 0);
  for (const run of saved) run();
  assert.equal(h.requests.length, 1);
  assert.deepEqual({ ...h.requests[0].body }, { step:draft.id, agent:'', preset:'auto', expectedMode:'next' });
  assert.equal(h.S.runWith.one, 'codex');
  assert.equal(h.S.runPresetOn.one, manual.id);
  h.requests[0].resolve({ ok:true, mode:'queued', auto:{ agent:'Codex Fast' } });
  await turn();
  h.requests[1].resolve(); await turn(); await turn();
  assert.deepEqual(h.toasts, ['PenEcho Auto picked Codex Fast for the next Work.']);
});

test('Orchestrator unsent Asks use their saved preset or PenEcho Auto on pic2 and show Auto rationale on send', async () => {
  const h = harness();
  const presets = [
    { id:'p-codex', name:'Codex Fast', agent:'codex', available:true },
    { id:'p-agy', name:'Antigravity Neon', agent:'antigravity', available:true },
  ];
  h.S.agents = [{ id:'codex', name:'Codex', available:true }, { id:'antigravity', name:'Antigravity', available:true }];
  h.S.presets = { default:'p-codex', presets };
  h.S.thisComputer = true;
  const menus = [];
  Object.assign(h.c, {
    can:() => true,
    runPresets:() => presets,
    presetById:id => presets.find(x => x.id === id) || null,
    presetTitle:x => x.name,
    presetShouldShowFacts:() => false,
    defaultPreset:() => presets[0],
    agentInfo:id => ({ name:id === 'codex' ? 'Codex' : 'Antigravity' }),
    orchSettings:() => ({ review:true }),
    ORCH_KIND:{ code:'Code', docs:'Docs' },
    openMenu:(anchor, items, opts) => menus.push({ anchor, items, opts }),
    closeMenu:() => {},
    menuAnchorRect:() => ({ top:0, left:0, right:10, bottom:10 }),
  });

  // 1) Saved with a concrete non-default preset (Antigravity Neon): pic2 defaults Run with to Antigravity Neon.
  const line = {
    id:'orch-later', slug:'orch-later', orchestratorRef:'PE-1200', status:'waiting', why:'Not sent', running:false, questions:[],
    stations:[{ id:'ask-1', index:0, kind:'ask', state:'todo', unsent:true, via:'Not sent', savedAgentId:'p-agy', text:'Build widget' }],
  };
  h.stored.lines = [line];
  h.c.adoptState(clone(h.stored));
  const cur = () => h.S.data.p.lines[0];
  const savedChoice = h.c.runChoice(h.S.data.p, cur(), cur().stations[0]);
  assert.equal(savedChoice.preset.id, 'p-agy');
  assert.equal(savedChoice.name, 'Antigravity Neon');

  // 2) Saved with PenEcho Auto: pic2 shows Run with PenEcho Auto, dropdown lists PenEcho Auto selected, and sending posts preset:"auto".
  h.stored.lines = [{
    ...line,
    stations:[{ id:'ask-1', index:0, kind:'ask', state:'todo', unsent:true, via:'Not sent', savedAgentId:'auto', text:'Fix the failing login test' }],
  }];
  h.c.adoptState(clone(h.stored));
  const autoChoice = h.c.runChoice(h.S.data.p, cur(), cur().stations[0]);
  assert.equal(autoChoice.preset.id, 'auto');
  assert.equal(autoChoice.name, 'PenEcho Auto');
  const html = h.c.runSplit(h.S.data.p, cur(), cur().stations[0]);
  assert.match(html, /Run with PenEcho Auto/);
  assert.match(html, /data-preset="auto"/);

  h.c.document.querySelector('#view').innerHTML = html;
  h.c.ACT['unsent-run-pick'](h.c.document.querySelector('[data-act="unsent-run-pick"]'));
  const menuRows = menus.at(-1).items.filter(item => item.label);
  assert.equal(menuRows[0].label, 'PenEcho Auto');
  assert.equal(menuRows[0].on, true);

  h.c.runUnsent(h.S.data.p, cur(), 'ask-1', '', 'auto');
  assert.equal(h.requests[0].verb, 'run-unsent');
  assert.deepEqual({ ...h.requests[0].body }, { step:'ask-1', agent:'', preset:'auto' });
  h.requests[0].resolve({ ok:true, agent:'codex', auto:{ agent:'Codex Fast', kind:'code', from:'', why:'' } });
  await turn();
  h.requests[1].resolve(); await turn(); await turn();
  assert.equal(h.toasts.at(-1), 'Orchestrator started · Code job → Codex Fast');

  // 3) Clicking Edit on a lone Orchestrator unsent Ask returns it to the Orchestrator composer.
  const nav = [], boxed = [];
  Object.assign(h.c, {
    orchBoxKey:p => `orch-${p.id}`,
    act:async () => ({ text:'Build widget', alone:true, files:[] }),
    askIntoBox:(p, key, l, s, taken) => boxed.push({ key, line:l.id, text:taken.text }),
    rememberBoxes:() => {},
    go:route => nav.push(route),
    requestAnimationFrame:fn => fn(),
  });
  h.stored.lines = [line];
  h.c.adoptState(clone(h.stored));
  await h.c.ACT['unsent-edit']({ dataset:{ line:'orch-later', step:'ask-1' } });
  assert.deepEqual(boxed, [{ key:'orch-p', line:'orch-later', text:'Build widget' }]);
  assert.deepEqual(nav.map(r => ({ ...r })), [{ view:'orchestrator' }]);
});
