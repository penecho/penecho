'use strict';
// PE-757: the page itself must show Mark reviewed on a Finished Line whose Work was stopped, and remove it once saved.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { parseHTML } = require('./helpers/dom.js');
const read = name => fs.readFileSync(path.join(__dirname, '../public/lines', name + '.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const turn = () => new Promise(resolve => setImmediate(resolve));
const workStation = (extra = {}) => ({ id:'work-1', index:0, kind:'work', state:'done', reviewed:false, label:'Work 1', agent:'antigravity', took:'11 min', out:'Stopped before finishing.', refers:[], pictures:[], files:[], ...extra });
const finishedStop = () => ({ id:'finished', index:1, kind:'deliver', state:'done', label:'Finished', took:'2026-11-20 03:11' });
function harness(stations = [workStation({ state:'off', off:'stopped' }), finishedStop()], lineExtra = {}) {
  const { document, window } = parseHTML('<html><body><div id="linePage"><div id="lpHead"></div><main id="lpScroll"><div id="lpThread"></div></main></div><input id="elsewhere"></body></html>');
  let focused = document.body;
  Object.defineProperty(document, 'activeElement', { get:() => focused?.isConnected ? focused : document.body });
  window.HTMLElement.prototype.focus = function () { if (!this.disabled) focused = this; };
  const requests = [], errors = [];
  const c = vm.createContext({ document, window, console, navigator:{ platform:'Mac' }, location:{ hash:'#p/line/one' },
    ACT:{}, SEND:{}, HOSTED:false, EMBED:null, STATE_COLOR:{}, LINE_STATUS:require('../public/lines/line-status.js'),
    localStorage:{ getItem:() => null }, addEventListener() {},
    $:(sel, root = document) => root.querySelector(sel), $$:(sel, root = document) => [...root.querySelectorAll(sel)],
    esc:String, ic:() => '', reducedMotion:() => true, toast:msg => errors.push(msg), renderRail() {},
    availableAgents:() => [], carryButton:() => '',
  });
  const run = code => vm.runInContext(code, c);
  run(read('state')); run(read('line'));
  const S = run('S'); S.cur = 'p'; S.route = { view:'line', line:'one' };
  const raw = () => ({ format:2, rev:'r1', project:{ id:'p' }, landed:[], backlog:[], lines:[{
    id:'one', slug:'one', status:'done', landed:true, todo:false, questions:[], commit:'', stations:clone(stations), ...clone(lineExtra),
  }] });
  const stored = { p:raw(), other:(() => { const o = raw(); o.project.id = 'other'; return o; })() };
  c.api = (url, opts = {}) => new Promise((resolve, reject) => {
    const pid = url.split('/')[2], verb = opts.method === 'POST' ? url.split('/').at(-1) : 'state';
    const req = { pid, verb, body:opts.body, resolve, reject };
    req.ok = data => {
      if (verb === 'review-all') {
        const l = stored[pid].lines[0];
        l.status = 'done'; l.landed = true; l.todo = false; l.asking = null; l.questions = [];
        for (const station of l.stations) {
          if (station.kind === 'deliver') station.state = 'done';
          else if (station.kind !== 'ask') {
            if (station.state === 'error' || station.state === 'wait' || station.state === 'todo') { station.state = 'off'; station.off = 'stopped'; }
            station.reviewed = true;
          }
        }
      }
      if (verb === 'todo') {
        const l = stored[pid].lines[0];
        l.todo = Boolean(opts.body?.todo);
        if (l.todo) {
          l.status = 'done'; l.landed = true; l.asking = null; l.questions = [];
          for (const station of l.stations) {
            if (station.kind === 'deliver') station.state = 'done';
            else if (station.kind !== 'ask' && (station.state === 'error' || station.state === 'wait' || station.state === 'todo')) {
              station.state = 'off'; station.off = 'stopped';
            }
          }
        }
      }
      resolve(data || (verb === 'state' ? clone(stored[pid]) : { ok:true }));
    };
    requests.push(req);
  });
  Object.assign(c, {
    boxWords:() => 'Ask', lineHeadHTML:(p, l) => `${c.shownStateForTest(l)}|${c.lineHeadActions(p, l, c.LINE_STATUS.lineState(l), l.stations[0])}`, selectedStep:() => null,
    paintProgress() {}, kindLine:() => '', questionsHTML:() => '', placeLegacyParts() {}, applyLineFilter() {},
    shownStateForTest:l => c.LINE_STATUS.shownState(l),
    workItem:(p, l, s) => `<article id="item-${s.id}" data-step="${s.id}" aria-checked="${s.reviewed}">${s.out}</article>`,
    refreshAfterChange:() => { if (S.route.view === 'line') c.refreshLine(); },
  });
  c.adoptState(clone(stored.p)); c.refreshLine();
  const line = (pid = 'p') => S.data[pid].lines[0];
  const review = () => document.querySelector('[data-act="all-reviewed"]');
  const click = () => c.ACT['all-reviewed'](review() || { dataset:{ line:'one' } });
  return { c, S, document, requests, errors, stored, line, review, click };
}

test('a Finished Line whose Work was stopped shows Mark reviewed on the page', () => {
  const h = harness();
  assert.equal(h.line().status, 'done');
  assert.equal(h.c.LINE_STATUS.toReview(h.line()), true);
  const button = h.review();
  assert.ok(button, 'the page offers Mark reviewed');
  assert.match(button.textContent, /Mark all reviewed|Mark reviewed/);
  assert.equal(button.disabled, false);
  assert.match(h.document.querySelector('#lpThread').textContent, /To review/, 'the Finished stop says it is to review');
});

test('clicking Mark reviewed saves the stopped Work and leaves no duplicate control', async () => {
  const h = harness();
  const saved = h.click();
  assert.equal(h.line().stations[0].reviewed, true, 'the click shows at once');
  await turn();
  assert.equal(h.requests[0].verb, 'review-all');
  h.requests[0].ok(); await turn();
  h.requests.at(-1).ok(); await saved; await turn();
  assert.equal(h.line().stations[0].reviewed, true);
  assert.equal(h.c.LINE_STATUS.toReview(h.line()), false);
  assert.equal(h.review(), null, 'no Mark reviewed once the line is reviewed');
  assert.doesNotMatch(h.document.querySelector('#lpThread').textContent, /To review/);
  assert.equal(h.document.querySelector('#lpThread .lp-end strong').textContent, 'Reviewed');
});

test('a normal finished Work keeps the same Mark reviewed control and saves it', async () => {
  const h = harness([workStation(), finishedStop()]);
  assert.ok(h.review());
  const saved = h.click();
  await turn();
  h.requests[0].ok(); await turn();
  h.requests.at(-1).ok(); await saved; await turn();
  assert.equal(h.line().stations[0].reviewed, true);
  assert.equal(h.review(), null);
});

test('an already reviewed Line shows no Mark reviewed control', () => {
  const h = harness([workStation({ reviewed:true }), finishedStop()]);
  assert.equal(h.c.LINE_STATUS.toReview(h.line()), false);
  assert.equal(h.review(), null);
});

test('stopped, stale-working, and waiting Lines without working jobs show Mark reviewed and stay reviewed after click', async () => {
  for (const [status, state] of [['stopped', 'error'], ['working', 'todo'], ['waiting', 'wait']]) {
    const h = harness([
      workStation({ id:'work-1', state, reviewed:false }),
      { id:'finished', index:1, kind:'deliver', state:'todo', label:'Finished' },
    ], { status, landed:false, running:false });
    const button = h.review();
    assert.ok(button, `${status}: Mark reviewed button is offered`);
    const saved = h.click();
    assert.equal(h.line().status, 'done', `${status}: optimistic transition to done`);
    assert.equal(h.line().stations[0].reviewed, true, `${status}: optimistic reviewed`);
    await turn();
    assert.equal(h.requests[0].verb, 'review-all');
    h.requests[0].ok(); await turn();
    h.requests.at(-1).ok(); await saved; await turn();
    assert.equal(h.line().status, 'done');
    assert.equal(h.line().stations[0].reviewed, true);
    assert.equal(h.review(), null, `${status}: button gone once reviewed`);
  }
});

test('a Line with a working job does not offer Mark reviewed even when an earlier Work was stopped', () => {
  const h = harness([
    workStation({ id:'work-1', index:0, state:'off', off:'stopped', reviewed:false }),
    workStation({ id:'work-2', index:1, state:'active', reviewed:false }),
    { id:'finished', index:2, kind:'deliver', state:'todo', label:'Finished' },
  ], { status:'working', landed:false, running:true });
  assert.equal(h.c.LINE_STATUS.lineWorking(h.line()), true);
  assert.equal(h.c.LINE_STATUS.canMarkReviewed(h.line()), false);
  assert.equal(h.review(), null);
});

test('failed review-all on a stopped Line rolls back status and station state cleanly', async () => {
  const h = harness([
    workStation({ id:'work-1', state:'error', reviewed:false }),
    { id:'finished', index:1, kind:'deliver', state:'todo', label:'Finished' },
  ], { status:'stopped', landed:false, running:false });
  const saved = h.click();
  assert.equal(h.line().status, 'done');
  await turn();
  h.requests[0].reject(new Error('Server rejected'));
  await saved;
  assert.equal(h.line().status, 'stopped');
  assert.equal(h.line().stations[0].state, 'error');
  assert.equal(h.line().stations[0].reviewed, false);
  assert.ok(h.review(), 'Mark reviewed returns after failure');
});

test('non-working waiting, stopped, and stale-working Lines show Mark reviewed and Mark todo above Add new canvas in #lpThread', async () => {
  for (const [status, state, label] of [['waiting', 'done', 'Needs you'], ['stopped', 'error', 'Stopped'], ['working', 'todo', 'Not finished']]) {
    const h = harness([
      workStation({ id:'work-1', state, reviewed:false }),
      { id:'finished', index:1, kind:'deliver', state:'todo', label:'Finished' },
    ], { status, landed:false, running:false });
    const thread = h.document.querySelector('#lpThread');
    const bar = thread.querySelector('.lp-end.lp-end-pending');
    assert.ok(bar, `${status}: renders pending end bar inside #lpThread`);
    assert.equal(bar.querySelector('strong').textContent, label);
    const todoBtn = bar.querySelector('.lp-todo[data-act="line-todo"]');
    const reviewBtn = bar.querySelector('.lp-all-reviewed[data-act="all-reviewed"]');
    assert.ok(todoBtn, `${status}: offers Mark todo at bottom of thread`);
    assert.match(todoBtn.textContent, /Mark todo/);
    assert.ok(reviewBtn, `${status}: offers Mark reviewed at bottom of thread`);
    assert.match(reviewBtn.textContent, /Mark reviewed/);
    // Clicking Mark todo settles the Line to Todo while leaving the Work unreviewed.
    const saved = h.c.ACT['line-todo'](todoBtn);
    assert.equal(h.line().status, 'done', `${status}: optimistic settle on Mark todo`);
    assert.equal(h.line().todo, true, `${status}: optimistic todo`);
    assert.equal(h.line().stations[0].reviewed, false, `${status}: Work stays unreviewed`);
    await turn();
    assert.equal(h.requests[0].verb, 'todo');
    assert.equal(h.requests[0].body?.todo, true);
    h.requests[0].ok(); await turn();
    h.requests.at(-1).ok(); await saved; await turn();
    assert.equal(h.c.LINE_STATUS.shownState(h.line()), 'todo');
    assert.equal(h.line().stations[0].reviewed, false);
    assert.equal(thread.querySelector('.lp-end.lp-end-pending'), null, `${status}: transitions to settled .lp-end card`);
    assert.equal(thread.querySelector('.lp-end strong').textContent, 'Todo');
    assert.match(thread.querySelector('.lp-end .lp-todo').textContent, /Clear todo/);
  }
});

test('failed Mark todo on a waiting Line rolls back status and keeps pending end controls', async () => {
  const h = harness([
    workStation({ id:'work-1', state:'done', reviewed:false }),
    { id:'finished', index:1, kind:'deliver', state:'todo', label:'Finished' },
  ], { status:'waiting', landed:false, running:false });
  const todoBtn = h.document.querySelector('#lpThread .lp-end-pending .lp-todo');
  const saved = h.c.ACT['line-todo'](todoBtn);
  assert.equal(h.line().status, 'done');
  assert.equal(h.line().todo, true);
  await turn();
  h.requests[0].reject(new Error('Todo rejected'));
  await saved;
  assert.equal(h.line().status, 'waiting');
  assert.equal(h.line().todo, false);
  assert.ok(h.document.querySelector('#lpThread .lp-end-pending .lp-todo'));
  assert.ok(h.document.querySelector('#lpThread .lp-end-pending .lp-all-reviewed'));
});

test('a Line with an active working job shows no pending end bar in #lpThread', () => {
  const h = harness([
    workStation({ id:'work-1', index:0, state:'active', reviewed:false }),
    { id:'finished', index:1, kind:'deliver', state:'todo', label:'Finished' },
  ], { status:'working', landed:false, running:true });
  assert.equal(h.document.querySelector('#lpThread .lp-end'), null);
});

test('read-only Cloud hides Mark todo and Mark reviewed on pending and finished Lines', () => {
  const h = harness([
    workStation({ id:'work-1', state:'done', reviewed:false }),
    { id:'finished', index:1, kind:'deliver', state:'todo', label:'Finished' },
  ], { status:'waiting', landed:false, running:false });
  h.c.HOSTED = { read:true };
  h.c.refreshLine();
  assert.equal(h.document.querySelector('#lpThread .lp-end'), null);
  assert.equal(h.document.querySelector('#lpThread .lp-todo'), null);
  assert.equal(h.document.querySelector('#lpThread .lp-all-reviewed'), null);
});

test('a finished Line with an active Orchestrator review does not show To review in the end stop or count as finished', () => {
  const h = harness([
    workStation({ reviewing:true }),
    finishedStop(),
  ]);
  h.S.projects = [{ id:'p', lines:[] }];
  h.c.adoptState(clone(h.stored.p));
  h.c.refreshLine();
  const line = h.line();
  const run = code => vm.runInContext(code, h.c);
  assert.equal(h.c.LINE_STATUS.toReview(line), false);
  assert.equal(h.c.LINE_STATUS.shownState(line), 'working');
  assert.equal(run('working(project())'), 1);
  assert.equal(run('summaryWorking(S.projects[0])'), 1);
  assert.equal(h.S.projects[0].lines[0].shown, 'working');
  assert.equal(h.S.projects[0].lines[0].stations[0].reviewing, true);
  assert.doesNotMatch(h.document.querySelector('#lpThread').textContent, /To review/);
  assert.equal(h.document.querySelector('#lpThread .lp-end strong').textContent, 'Finished');

  // Once the review finishes, the end stop switches to To review.
  delete h.stored.p.lines[0].stations[0].reviewing;
  h.c.adoptState(clone(h.stored.p));
  h.c.refreshLine();
  assert.equal(h.c.LINE_STATUS.toReview(h.line()), true);
  assert.equal(h.c.LINE_STATUS.shownState(h.line()), 'review');
  assert.equal(run('working(project())'), 0);
  assert.equal(run('summaryWorking(S.projects[0])'), 0);
  assert.equal(h.document.querySelector('#lpThread .lp-end strong').textContent, 'To review');
});
