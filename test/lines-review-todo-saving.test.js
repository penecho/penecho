'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { parseHTML } = require('./helpers/dom.js');
const read = name => fs.readFileSync(path.join(__dirname, '../public/lines', name + '.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const turn = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  const { document, window } = parseHTML('<html><body><div id="linePage"><div id="lpHead"></div><div id="lpThread"></div></div><input id="elsewhere"></body></html>');
  let focused = document.body;
  Object.defineProperty(document, 'activeElement', { get:() => focused?.isConnected ? focused : document.body });
  window.HTMLElement.prototype.focus = function () { if (!this.disabled) focused = this; };
  const requests = [], errors = [];
  const c = vm.createContext({ document, window, console, navigator:{platform:'Mac'}, location:{hash:'#p/line/one'},
    ACT:{}, SEND:{}, HOSTED:false, EMBED:null, STATE_COLOR:{}, LINE_STATUS:require('../public/lines/line-status.js'),
    localStorage:{getItem:() => null}, addEventListener() {},
    $:(sel, root = document) => root.querySelector(sel), $$:(sel, root = document) => [...root.querySelectorAll(sel)],
    esc:String, ic:() => '', reducedMotion:() => true, toast:msg => errors.push(msg), renderRail() {},
  });
  const run = code => vm.runInContext(code, c);
  run(read('state')); run(read('line'));
  const S = run('S'); S.cur = 'p'; S.route = {view:'line',line:'one'};
  const raw = (project = 'p') => ({format:2, rev:'r1', project:{id:project}, landed:[], backlog:[], lines:[{
    id:'one',slug:'one',status:'done',todo:false,questions:[], stations:[
      {id:'work-1',index:0,kind:'work',state:'done',reviewed:false,out:'Keep this result'},
      {id:'finished',index:1,kind:'deliver',state:'done',label:'Finished'},
    ],
  }]});
  const stored = {p:raw(), other:raw('other')};
  c.api = (url, opts = {}) => new Promise((resolve, reject) => {
    const pid = url.split('/')[2], verb = opts.method === 'POST' ? url.split('/').at(-1) : 'state';
    const req = {pid,verb,body:opts.body,resolve,reject};
    req.ok = data => {
      if (verb === 'review-all') { stored[pid].lines[0].todo = false; stored[pid].lines[0].stations[0].reviewed = true; }
      if (verb === 'todo') stored[pid].lines[0].todo = opts.body.todo;
      resolve(data || (verb === 'state' ? clone(stored[pid]) : {ok:true}));
    };
    requests.push(req);
  });
  Object.assign(c, {
    boxWords:() => 'Ask', lineHeadHTML:(p,l) => c.shownStateForTest(l), selectedStep:() => null,
    paintProgress() {}, kindLine:() => '', questionsHTML:() => '', placeLegacyParts() {}, applyLineFilter() {},
    shownStateForTest:l => c.LINE_STATUS.shownState(l),
    workItem:(p,l,s) => `<article id="item-${s.id}" data-step="${s.id}" aria-checked="${s.reviewed}">${s.out}</article>`,
    refreshAfterChange:() => { if (S.route.view === 'line') c.refreshLine(); else document.querySelector('#lpThread').innerHTML = c.todoMark(S.data[S.cur].lines[0],S.data[S.cur]); },
  });
  c.adoptState(clone(stored.p)); c.refreshLine();
  const line = (pid = 'p') => S.data[pid].lines[0];
  const todo = () => document.querySelector('.lp-todo');
  const review = () => document.querySelector('.lp-all-reviewed');
  const click = verb => c.ACT[verb](verb === 'line-todo' ? todo() : review() || {dataset:{line:'one'}});
  return {c,S,run,document,requests,errors,stored,line,todo,review,click};
}

for (const stage of ['POST', 'refresh']) test(`Todo is immediately usable while review ${stage} is held; saves stay ordered`, async () => {
  const h = harness(), reviewed = h.click('all-reviewed');
  assert.equal(h.todo().disabled, false);
  assert.equal(h.line().stations[0].reviewed, true);
  await turn(); assert.equal(h.requests[0].verb, 'review-all');
  if (stage === 'refresh') { h.requests[0].ok(); await turn(); }
  const marked = h.click('line-todo');
  assert.equal(h.line().todo, true);
  assert.equal(h.todo().getAttribute('aria-pressed'), 'true');
  assert.equal(h.todo().disabled, true, 'duplicate Todo is blocked during its own save');
  assert.equal(h.document.querySelector('#lpHead').textContent, 'todo');
  await h.click('line-todo');
  assert.equal(h.requests.filter(r => r.verb === 'todo').length, 0);
  if (stage === 'POST') { h.requests[0].ok(); await turn(); }
  h.requests[1].ok(); await reviewed; await turn();
  assert.equal(h.line().todo, true, 'review refresh cannot erase queued Todo');
  assert.equal(h.requests[2].verb, 'todo');
  h.requests[2].ok(); await turn(); h.requests[3].ok(); await marked;
  assert.equal(h.line().todo, true); assert.equal(h.line().stations[0].reviewed, true);
  assert.equal(h.stored.p.lines[0].todo, true); assert.equal(h.stored.p.lines[0].stations[0].reviewed, true);
  assert.equal(h.todo().disabled, false); assert.equal(h.S.lineMarkSaving.size, 0);
  const reload = h.c.loadState('p', {force:true}); h.requests.at(-1).ok(); await reload;
  assert.equal(h.line().todo, true); assert.equal(h.line().stations[0].reviewed, true);
});

test('Todo is usable again once its save is acknowledged, before the read after it arrives (PE-595)', async () => {
  const h = harness(), marked = h.click('line-todo');
  await turn(); assert.equal(h.requests[0].verb, 'todo');
  assert.equal(h.todo().disabled, true, 'blocked only while its own save is on its way');
  h.requests[0].ok(); await turn();
  assert.equal(h.requests[1].verb, 'state', 'the read after the save is still on its way');
  assert.equal(h.todo().disabled, false);
  assert.equal(h.line().todo, true);
  h.requests[1].ok(); await marked;
  assert.equal(h.line().todo, true); assert.equal(h.todo().disabled, false);
});

for (const failed of ['review-all', 'todo']) test(`${failed} rejection rolls back only that choice`, async () => {
  const h = harness(), reviewed = h.click('all-reviewed'), marked = h.click('line-todo');
  await turn();
  if (failed === 'review-all') h.requests[0].reject(new Error('Review rejected'));
  else { h.requests[0].ok(); await turn(); h.requests[1].ok(); }
  await reviewed; await turn();
  assert.equal(h.line().todo, true, 'queued Todo survives review completion or failure');
  const todoRequest = h.requests.at(-1); assert.equal(todoRequest.verb, 'todo');
  if (failed === 'todo') todoRequest.reject(new Error('Todo rejected'));
  else { todoRequest.ok(); await turn(); h.requests.at(-1).ok(); }
  await marked;
  assert.equal(h.line().todo, failed === 'review-all');
  assert.equal(h.line().stations[0].reviewed, failed === 'todo');
  assert.equal(h.errors.length, 1); assert.equal(h.todo().disabled, false);
});

test('failed review restores existing Todo and review marks', async () => {
  const h = harness(); h.stored.p.lines[0].todo = true; h.c.adoptState(clone(h.stored.p)); h.c.refreshLine();
  const pending = h.click('all-reviewed'); await turn(); h.requests[0].reject(new Error('Review rejected')); await pending;
  assert.equal(h.line().todo, true); assert.equal(h.line().stations[0].reviewed, false);
  assert.equal(h.document.querySelector('#lpHead').textContent, 'todo');
});

for (const verb of ['review-all', 'todo']) test(`${verb} acknowledged write survives refresh failure and stale reads`, async () => {
  const h = harness(), stale = h.c.loadState('p', {force:true}), old = clone(h.stored.p);
  const pending = h.click(verb === 'todo' ? 'line-todo' : 'all-reviewed'); await turn();
  h.requests[1].ok(); await turn(); h.requests[2].reject(new Error('Refresh unavailable')); await pending;
  h.requests[0].ok(old); assert.equal(await stale, false);
  assert.equal(h.line().todo, verb === 'todo'); assert.equal(h.line().stations[0].reviewed, verb === 'review-all');
  assert.equal(h.todo().disabled, false); assert.equal(h.S.lineMarkSaving.size, 0);
  assert.equal(h.errors[0], 'Refresh unavailable');
  const poll = h.c.loadState('p', {force:true}); h.requests.at(-1).ok(); await poll;
  assert.equal(h.line().todo, verb === 'todo'); assert.equal(h.run('lineMarks.size'), 0);
});

test('polls between clicks and acknowledgments preserve pending marks, even when delivered late', async () => {
  const h = harness(), old = clone(h.stored.p), reviewed = h.click('all-reviewed'); await turn();
  const firstPoll = h.c.loadState('p', {force:true}); h.requests.at(-1).ok(old); await firstPoll; h.c.refreshLine();
  assert.equal(h.line().stations[0].reviewed, true); assert.equal(h.todo().disabled, false);
  const marked = h.click('line-todo');
  const nextPoll = h.c.loadState('p', {force:true}); h.requests.at(-1).ok(old); await nextPoll; h.c.refreshLine();
  assert.equal(h.line().todo, true); assert.equal(h.line().stations[0].reviewed, true);
  h.requests[0].ok(); await turn(); h.requests.at(-1).ok(); await reviewed; await turn();
  const todoRequest = h.requests.at(-1), late = h.c.loadState('p', {force:true}), lateRequest = h.requests.at(-1);
  const beforeTodo = clone(h.stored.p);
  todoRequest.ok(); await turn(); h.requests.at(-1).ok(); await marked;
  lateRequest.ok(beforeTodo); assert.equal(await late, false);
  assert.equal(h.line().todo, true); assert.equal(h.line().stations[0].reviewed, true);
});

test('navigation keeps queued writes on the original project without stealing focus', async () => {
  const h = harness(), reviewed = h.click('all-reviewed'), marked = h.click('line-todo'); await turn();
  h.c.adoptState(clone(h.stored.other)); h.S.cur = 'other'; h.c.refreshLine();
  const input = h.document.querySelector('#elsewhere'); input.focus();
  h.requests[0].ok(); await turn(); h.requests.at(-1).ok(); await reviewed; await turn();
  assert.equal(h.requests.at(-1).pid, 'p');
  h.requests.at(-1).ok(); await turn(); h.requests.at(-1).ok(); await marked;
  assert.equal(h.line().todo, true); assert.equal(h.line('other').todo, false);
  assert.equal(h.document.activeElement, input);
});

test('focused Todo control retains focus after reconciliation; moving focus away is respected', async () => {
  const h = harness(); h.todo().focus(); const marked = h.click('line-todo');
  assert.equal(h.document.activeElement, h.document.body, 'native disabled controls release focus');
  await turn(); h.requests[0].ok(); await turn(); h.requests[1].ok(); await marked;
  assert.equal(h.document.activeElement, h.todo());
  const clear = h.click('line-todo'); const input = h.document.querySelector('#elsewhere'); input.focus();
  await turn(); h.requests[2].ok(); await turn(); h.requests[3].ok(); await clear;
  assert.equal(h.document.activeElement, input); assert.equal(h.line().todo, false);
});

test('Home uses the same immediate Todo control and keeps its pending choice', async () => {
  const h = harness(); h.S.route = {view:'home'};
  const reviewed = h.click('all-reviewed'); assert.equal(h.todo().disabled, false);
  const marked = h.click('line-todo'); assert.equal(h.todo().getAttribute('aria-pressed'), 'true');
  await turn(); h.requests[0].ok(); await turn(); h.requests[1].ok(); await reviewed; await turn();
  h.requests[2].ok(); await turn(); h.requests[3].ok(); await marked;
  assert.equal(h.todo().getAttribute('aria-pressed'), 'true'); assert.equal(h.todo().disabled, false);
});
