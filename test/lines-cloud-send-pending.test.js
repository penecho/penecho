'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const { parseHTML } = require('./helpers/dom.js');

const read = name => fs.readFileSync(path.join(__dirname, '../public/lines', `${name}.js`), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const pending = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const answer = (status, data) => ({ ok:status < 400, status, json:async () => data });
const clash = () => answer(409, { code:'project_changed', error:'This project changed in Cloud at the same moment. Try again.' });

function harness(hosted) {
  const { document, window } = parseHTML('<main><div id="composer"></div><div id="actions"></div></main>');
  const ask = { id:'ask', kind:'ask', unsent:true, text:'Existing Ask', canFinishUnsent:true };
  const line = { id:'line', slug:'line', stations:[ask] }, project = { id:'project', lines:[line] };
  const agent = { id:'codex', name:'Codex', available:true }, events = [];
  const ctx = vm.createContext({ document, window, navigator:{ platform:'Mac' }, location:{ hash:'#project' }, ACT:{},
    S:{ cur:project.id, comp:{}, route:{ view:'home' }, agents:[agent] }, HOSTED:hosted, addEventListener() {},
    LINE_STATUS:require('../public/lines/line-status.js'), KIND:{ work:{ label:'Work' } },
    $:(selector, root = document) => root.querySelector(selector), $$:(selector, root = document) => [...root.querySelectorAll(selector)],
    getComputedStyle:() => ({ lineHeight:'22', paddingTop:'0', paddingBottom:'0' }), esc:String, ic:() => '',
    localStorage:{ getItem:() => null }, fileEntry:() => null, can:action => !hosted || action !== 'agents', FILE_ICON:() => 'files', fmtSize:() => '',
    project:() => project, lineById:(target, id) => target?.lines?.find(item => item.id === id) || null,
    stationById:(target, id) => target?.stations.find(step => step.id === id), agentInfo:() => agent,
    availableAgents:() => [agent], runPresets:() => [], defaultPreset:() => null, defaultPresetAgent:() => '', presetById:() => null,
    nowWhen:() => 'Today', closeMenu() {}, toast:message => events.push(['toast', message]), loadState:async () => {}, go:route => events.push(['open', route.line]),
    embedCanvas:() => ({ canvas:'files/chart/canvas.penecho.json' }), embedCanvasReady:async () => ({ png:'view' }),
    targetBody:() => ({}), detectPath:() => ({ kind:'line' }), pasteAgent:() => agent, syncAttachmentImages() {},
  });
  const run = js => vm.runInContext(js, ctx);
  const state = read('state');
  run(state.slice(state.indexOf('async function api('), state.indexOf('// The address of something read straight')));
  run(state.slice(state.indexOf('async function uploadFiles('), state.indexOf('async function act(')));
  run(read('composer'));
  run(read('line'));
  Object.assign(ctx, {
    viewProject:project, viewLine:line,
    showAtOnce:(_project, { took }) => { events.push(['show', took.text]); return { lineId:'line', station:ask }; },
    settleSaving:(_entry, saved) => events.push(['settled', saved.slug]),
    refreshBehind:id => events.push(['refresh', id]),
    refreshAfterChange:() => { document.querySelector('#actions').innerHTML = ask.unsent ? ctx.runSplit(project, line, ask) : ''; },
  });
  const redraw = () => {
    document.querySelector('#composer').innerHTML = ctx.composerHTML('home-project', { preview:true });
    ctx.wireComposers();
    return document.querySelector('form');
  };
  const box = run("comp('home-project')");
  box.text = 'Make a chart.';
  return { ctx, document, window, run, ask, line, project, box, events, redraw };
}

test('PE-911: Cloud keeps Sending and the draft through uploads and save; deliberate retry reuses each acknowledged upload', async () => {
  const { ctx, document, window, box, events, redraw } = harness(true);
  box.files.push({ id:'first', blob:'first', name:'first.txt' }, { id:'second', blob:'second', name:'second.txt' });
  const requests = [], upload = pending(), retry = pending(), save = pending();
  let secondAttempts = 0, askAttempts = 0;
  ctx.hostedFetch = async (route, init) => {
    requests.push({ route, init });
    if (init.body === 'first') return upload.promise;
    if (init.body === 'second') return ++secondAttempts === 1 ? clash() : retry.promise;
    return ++askAttempts === 1 ? save.promise : answer(200, { slug:'saved', step:'ask-1' });
  };
  let form = redraw();
  const submit = () => form.dispatchEvent(new window.Event('submit', { bubbles:true, cancelable:true }));
  const button = () => document.querySelector('button[type=submit]');
  submit(); submit();
  const enter = new window.Event('keydown', { bubbles:true, cancelable:true }); enter.key = 'Enter';
  form.querySelector('textarea').dispatchEvent(enter);
  assert.equal(enter.defaultPrevented, true);
  assert.equal(button().textContent, 'Sending…');
  assert.equal(button().disabled, true);
  assert.equal(form.querySelector('textarea').value, 'Make a chart.');
  form = redraw(); submit();
  assert.equal(button().disabled, true, 'a re-render does not unlock the box');
  await flush(); assert.equal(requests.length, 1);
  upload.resolve(answer(200, { path:'files/_incoming/first.txt', name:'first.txt' }));
  await flush();
  assert.deepEqual(requests.map(({ init }) => init.body), ['first', 'second', 'second']);
  assert.equal(button().disabled, true, 'the one upload retry keeps the composer locked');
  assert.equal(box.files.length, 2);

  submit(); retry.resolve(answer(200, { path:'files/_incoming/second.txt', name:'second.txt' })); await flush();
  assert.equal(button().textContent, 'Sending…');
  assert.equal(events.some(([kind]) => kind === 'show'), false);
  save.resolve(clash()); await flush();
  assert.equal(button().disabled, false);
  assert.equal(box.text, 'Make a chart.');
  assert.equal(askAttempts, 1, 'no automatic save replay');
  assert.ok(events.some(([kind, message]) => kind === 'toast' && message.includes('changed in Cloud')));

  submit(); await flush();
  assert.deepEqual(requests.filter(({ route }) => route.includes('/upload?')).map(({ init }) => init.body), ['first', 'second', 'second']);
  const saves = requests.filter(({ route }) => route.endsWith('/unsent')).map(({ init }) => JSON.parse(init.body));
  assert.deepEqual(saves[0], saves[1]);
  assert.deepEqual(saves[1].attachments.map(file => file.path), ['files/_incoming/first.txt','files/_incoming/second.txt']);
  assert.equal(saves[1].canvas, 'files/chart/canvas.penecho.json');
  assert.deepEqual(saves[1].canvasView, { png:'view' });
  assert.equal(box.text, '');
  assert.equal(box.cloudUploads, undefined, 'acknowledged Ask ends the staging cache');
  assert.deepEqual(events.filter(([kind]) => ['show','settled','open'].includes(kind)), [['show', 'Make a chart.'], ['settled', 'saved'], ['open', 'saved']]);
});

test('PE-911: only a confirmed upload conflict is retried, and at most once', async t => {
  for (const [name, response, attempts] of [
    ['second project conflict', clash, 2],
    ['unrelated 409', () => answer(409, { code:'line_busy' }), 1],
    ['wrong status', () => answer(500, { code:'project_changed' }), 1],
    ['unconfirmed transport', () => { throw new Error('Connection dropped'); }, 1],
  ]) await t.test(name, async () => {
    const { ctx, document, box, redraw } = harness(true);
    const requests = [];
    ctx.hostedFetch = async route => { requests.push(route); return response(); };
    box.files.push({ id:'upload', blob:'bytes', name:'chart.txt' });
    await ctx.sendComposer(redraw());
    await flush();
    assert.equal(requests.length, attempts);
    assert.ok(requests.every(route => route.includes('/upload?')));
    assert.equal(document.querySelector('button[type=submit]').disabled, false);
    assert.equal(box.text, 'Make a chart.');
    assert.equal(box.files.length, 1);
  });
});

test('PE-911: Cloud Run stays disabled across a poll; failure re-enables it without replay', async () => {
  const { ctx, document, run, line, ask, project, events } = harness(true);
  const response = pending(), reload = pending();
  let calls = 0;
  ctx.hostedFetch = async () => { calls++; return response.promise; };
  ctx.loadState = () => reload.promise;
  ctx.refreshAfterChange();
  const old = document.querySelector('[data-act="unsent-run"]');
  ctx.ACT['unsent-run'](old); ctx.ACT['unsent-run'](old);
  assert.equal(calls, 1);
  run('keepStarting(viewProject)'); ctx.refreshAfterChange(); ctx.refreshRunLabels();
  const button = () => document.querySelector('[data-act="unsent-run"]');
  assert.equal(button().textContent, 'Sending…'); assert.equal(button().disabled, true);
  assert.equal(document.querySelector('[data-act="unsent-run-pick"]'), null);
  assert.match(ctx.unsentSendHTML(project, line, ask), /disabled.*Sending/);
  assert.match(ctx.unsentFoot(project, line, ask), /Mark finished &amp; reviewed/);
  response.resolve(clash()); await flush();
  assert.equal(button().disabled, true, 'the latest state is being reconciled');
  reload.resolve(); await flush();
  assert.equal(calls, 1);
  assert.equal(button().disabled, false);
  assert.ok(document.querySelector('[data-act="unsent-run-pick"]'));
  assert.ok(events.some(([kind, message]) => kind === 'toast' && message.includes('changed in Cloud')));
});

test('PE-911: local Send remains optimistic and local Run provides Stop before the request resolves', async () => {
  const { ctx, run, box, line, ask, project, redraw, events } = harness(false);
  const response = pending();
  let posts = 0;
  ctx.fetch = async () => { posts++; return response.promise; };
  ctx.saveBehind = (_entry, _key, _took, send) => send('line');
  const form = redraw(); ctx.sendComposer(form);
  assert.equal(box.text, '');
  assert.deepEqual(events[0], ['show', 'Make a chart.']);
  assert.doesNotMatch(form.textContent, /Sending…/);
  const launch = ctx.runUnsent(project, line, ask.id, 'codex');
  await ctx.runUnsent(project, line, ask.id, 'codex');
  assert.equal(ask.unsent, false);
  assert.match(run('lineStopButton(viewLine)'), />Stop</);
  const skipped = await ctx.actAtOnce(line, 'continue', { step:'stale' }, () => false);
  assert.equal(skipped, false);
  await flush(); assert.equal(posts, 2, 'one save and one run');
  response.resolve(answer(200, { ok:true })); await launch;
});

test('PE-1094: refreshLine re-renders when loadState discovers the open Line was removed so Sending never stays frozen on screen', async () => {
  const { ctx, document, line, project } = harness(true);
  let rendered = 0;
  ctx.S.route = { view:'line', line:line.id };
  document.body.innerHTML = '<div id="linePage"><button data-act="unsent-run" disabled>Sending…</button></div>';
  ctx.render = () => { rendered++; document.body.innerHTML = ctx.lineHTML(project, ctx.S.route); };
  project.lines = [];
  ctx.refreshLine();
  assert.equal(rendered, 1);
  assert.match(document.body.textContent, /This Topic no longer exists/);
  assert.equal(document.querySelector('[data-act="unsent-run"]'), null);
});
