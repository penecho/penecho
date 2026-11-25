'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('./helpers/dom.js');

const read = name => fs.readFileSync(path.join(__dirname, '../public/lines', `${name}.js`), 'utf8');
function section(name, start, end) {
  const source = read(name);
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `${name}: ${start} to ${end}`);
  return source.slice(from, to);
}

test('delta keeps file and token item identities, parsing only puts; force discards local mutations', async () => {
  const parses = [];
  const context = vm.createContext({ JSON:{ stringify:JSON.stringify, parse(text) { parses.push(text); return JSON.parse(text); } },
    HOSTED:false, EMBED:null, S:{ cur:'p', data:{} }, pathFor:() => '/projects/p',
    adoptState(state) { context.S.data.p = { ...state, id:'p', partial:'' }; },
  });
  const run = code => vm.runInContext(code, context);
  run(section('state', 'const stateView =', 'async function loadProjects()'));
  const file = { path:'a.md', size:1 }, record = { workId:'record', used:1 }, start = { workId:'start', at:1 };
  const initial = { tag:'one', rev:1, project:{ id:'p' }, lines:[], landed:[], backlog:[],
    files:[file, { path:'b.md', size:2 }],
    tokens:{ used:3, records:[record, { workId:'record-2', used:2 }], starts:[start, { workId:'start-2', at:2 }] },
  };
  const arrays = state => [state.files, state.tokens.records, state.tokens.starts];
  const names = ['files', 'tokens.records', 'tokens.starts'];
  const load = async (response, options) => {
    context.api = async () => structuredClone(response);
    assert.equal(await context.loadState('p', options), true);
    return context.S.data.p;
  };
  const first = await load(initial);
  let lookups = 0;
  for (const name of names) {
    const items = run(`sentStates.get('p').lists.get(${JSON.stringify(name)}).items`);
    const get = items.get.bind(items);
    items.get = key => { lookups++; return get(key); };
  }
  const second = await load({ delta:true, base:'one', tag:'two', rev:2, set:{ tokens:{ used:4 } } });
  assert.equal(lookups, 0);
  assert.deepEqual(parses.map(JSON.parse), [{ project:{ id:'p' }, rev:2, tokens:{ used:4 } }]);
  assert.notEqual(second.tokens, first.tokens);
  arrays(second).forEach((arr, index) => {
    assert.notEqual(arr, arrays(first)[index]);
    arr.forEach((item, row) => assert.equal(item, arrays(first)[index][row]));
  });

  parses.length = 0;
  const updated = [{ ...file, size:4 }, { ...record, used:4 }, { ...start, at:4 }];
  const delta = { delta:true, base:'two', tag:'three', rev:3, lists:Object.fromEntries(names.map((name, index) => [name, { put:[updated[index]] }])) };
  const third = await load(delta);
  assert.deepEqual(parses.slice(1).map(JSON.parse), updated);
  assert.deepEqual(parses.map(JSON.parse)[0], { project:{ id:'p' }, rev:3, tokens:{ used:4 } });
  arrays(third).forEach((arr, index) => {
    assert.notEqual(arr, arrays(second)[index]);
    assert.notEqual(arr[0], arrays(second)[index][0]);
    assert.equal(arr[1], arrays(second)[index][1]);
  });
  const { tag, ...whole } = structuredClone(initial);
  const expected = { ...whole, rev:3, tokens:{ ...whole.tokens, used:4 } };
  arrays(expected).forEach((arr, index) => { arr[0] = updated[index]; });
  assert.deepEqual(JSON.parse(JSON.stringify(run("sentState(sentStates.get('p'), S.data.p)"))), expected);
  assert.equal(context.sentWith('p', { base:'three', tag:'bad', rev:4, lists:{ files:{ put:[{ path:'missing.md' }] } } }), null);

  // P2-3: reused entries are immutable and page-owned array splices cannot corrupt subsequent delta polls.
  arrays(third).forEach(arr => {
    assert.equal(Object.isFrozen(arr[0]), true);
    assert.throws(() => { arr[0].localOnly = true; }, TypeError);
    arr.splice(0, 1);
  });
  assert.equal(third.files.length, 1);
  const fourth = await load({ delta:true, base:'three', tag:'four', rev:4, set:{ tokens:{ used:5 } } });
  assert.deepEqual(arrays(fourth).map(arr => arr.length), [2, 2, 2], 'revision-only delta restores authoritative list membership after page splice');
  assert.equal(fourth.files[0].path, 'a.md');
  assert.equal(fourth.files[1].path, 'b.md');
  const forced = await load({ same:true, tag:'four' }, { force:true });
  assert.deepEqual(JSON.parse(JSON.stringify(forced)), { ...expected, rev:4, tokens:{ ...expected.tokens, used:5 }, id:'p', partial:'' });
  arrays(forced).forEach((arr, index) => arr.forEach((item, row) => assert.notEqual(item, arrays(fourth)[index][row])));
});

function clock() {
  let now = 100000, nextId = 1;
  const timers = new Map();
  return { timers, Date:class extends Date { static now() { return now; } },
    setTimeout(fn, delay) { const id = nextId++; timers.set(id, { fn, at:now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) if (timers.has(id) && timer.at <= now) { timers.delete(id); timer.fn(); }
    },
  };
}

function orchHarness(view = 'orchestrator') {
  const time = clock(), { document, window } = parseHTML('<html><body></body></html>');
  const project = { id:'p', rev:1, lines:[] }, ORCH = { project:'p', kind:'', last:0, loading:false, timer:0 }, requests = [];
  const context = vm.createContext({ ...time, document, ORCH, ORCH_EVERY:3000, ORCH_JOBS:[], orchSettle() {}, HOSTED:false, LIST_MS:Infinity,
    S:{ cur:'p', route:{ view } }, project:() => project, pathFor:id => `/projects/${id}`,
    api:url => new Promise((resolve, reject) => requests.push({ url, resolve, reject })),
    orchPaintAll() {}, orchPaintStats() {}, orchStatsDays:() => 30, orchUseProject() {}, orchCatalogId:() => '', orchUnpriced:() => [],
    checkTopics:() => [], allLines:p => p.lines, hostedRetry() {}, toast() {},
    refreshChrome() {}, refreshReaders() {}, refreshStats() {}, $:() => ({ hidden:true }),
  });
  const run = code => vm.runInContext(code, context);
  run(section('orchestrator', 'const orchHidden =', '// A part is drawn again'));
  run(section('orchestrator', 'function refreshOrchestrator()', '// Keep both Statistics cards'));
  run(section('orchestrator', 'function refreshStatsPrices(', '// ---------- Typing and clicking'));
  run(section('pages', 'function refreshAfterChange()', '// ---------- Memory and files'));
  run(section('main', 'let polling =', 'function bindGlobal()'));
  run(section('main', "  document.addEventListener('visibilitychange'", '  // Coming back from the Canvas'));
  const visibility = hidden => { document.hidden = hidden; document.dispatchEvent(new window.Event('visibilitychange')); };
  return { ...time, context, document, ORCH, project, requests, visibility };
}

const activeSession = { sessions:[{ archived:false, running:true, lines:[] }] };
const flush = () => new Promise(resolve => setImmediate(resolve));

test('hidden Orchestrator skips requests and timers; visibility resumes once with the state poll', async () => {
  const h = orchHarness();
  h.visibility(true);
  await h.context.loadOrchestrator(h.project, true);
  assert.equal(h.requests.length, 0);
  assert.equal(h.timers.size, 0);

  let completeState, stateReads = 0;
  h.context.loadState = () => new Promise(resolve => { stateReads++; completeState = resolve; });
  h.visibility(false);
  h.visibility(true);
  h.visibility(false);
  assert.equal(stateReads, 1, 'a visibility event during an in-flight state read does not start another');
  assert.equal(h.requests.length, 0, 'resume uses the pending state poll');
  completeState(true);
  await flush();
  assert.equal(h.requests.length, 1);
  h.advance(5000);
  await h.context.loadOrchestrator();
  assert.equal(h.requests.length, 1, 'an identical slow request is not superseded');
  assert.equal(h.ORCH.timer, 0, 'no redundant follow timer while request is in flight');

  h.requests[0].resolve(activeSession);
  await flush();
  assert.equal(h.timers.size, 1, 'active sessions still receive follow polls');
  h.document.hidden = true;
  h.advance(3000);
  assert.equal(h.requests.length, 1, 'timer also checks visibility if the event has not run');
  assert.equal(h.timers.size, 0);

  h.context.loadState = async () => false;
  h.visibility(false);
  await flush();
  assert.equal(h.requests.length, 2, 'unchanged state still resumes the Orchestrator');
  h.requests[1].resolve(activeSession);
  await flush();
  assert.equal(h.timers.size, 1);
  h.visibility(true);
  assert.equal(h.timers.size, 0, 'hiding cancels the pending follow timer');

  h.visibility(false);
  await flush();
  assert.equal(h.timers.size, 1, 'a recent request leaves one throttled resume');
  h.advance(3000);
  assert.equal(h.requests.length, 3);
  h.visibility(true);
  h.requests[2].resolve(activeSession);
  await flush();
  assert.equal(h.timers.size, 0, 'an in-flight response does not restart the loop while hidden');
});

test('P1-9: Orchestrator resumes independently when /state poll hangs, and a stuck Orchestrator request times out and retries', async () => {
  const h = orchHarness();
  // Start a hung /state poll that never resolves.
  h.context.loadState = () => new Promise(() => {});
  h.visibility(false);
  h.visibility(true);
  assert.equal(h.timers.size, 0, 'hiding cancels fallback resume timer too');

  // Return to visible while the prior /state poll is still stuck (`polling === true`).
  h.visibility(false);
  assert.equal(h.requests.length, 0, 'waits briefly to coalesce with a normal state poll');
  h.advance(1000);
  assert.equal(h.requests.length, 1, 'bounded fallback resumes Orchestrator even while /state hangs');

  // If the Orchestrator request itself hangs past 30s, it times out and retries cleanly.
  h.advance(5000);
  assert.equal(h.requests.length, 1, 'still deduplicated before stale threshold');
  h.advance(25000);
  assert.equal(h.requests.length, 2, 'stuck identical Orchestrator request times out and retries after 30s');
  // Resolving the stale first request must not overwrite the fresh retry.
  h.requests[0].resolve({ sessions:[{ archived:false, running:false, lines:[], stale:true }] });
  h.requests[1].resolve(activeSession);
  await flush();
  assert.equal(h.ORCH.data.sessions[0].running, true);
  assert.equal(h.timers.size, 1, 'follow timer restored once the fresh retry succeeds');
});

test('P1-6: hiding and reopening Orchestrator or Statistics within 30s restores the stale request timeout', async () => {
  for (const view of ['orchestrator', 'stats']) {
    const h = orchHarness(view);
    h.context.loadState = () => new Promise(() => {});
    h.visibility(false);
    h.advance(1000);
    assert.equal(h.requests.length, 1);
    // Hide at +2s (cancels timeout), return at +5s (still within 30s stale window).
    h.advance(2000);
    h.visibility(true);
    assert.equal(h.timers.size, 0, `${view}: hiding clears request timeout`);
    h.advance(3000);
    h.visibility(false);
    h.advance(1000);
    assert.equal(h.requests.length, 1, `${view}: still deduplicated against in-flight request within 30s`);
    // Remaining timeout (~24s) must fire and start a retry instead of staying stuck forever.
    h.advance(25000);
    assert.equal(h.requests.length, 2, `${view}: restored stale timeout retries the hung request`);
  }
});

test('passive Statistics retries stay throttled and fetch the latest revision without accepting stale responses', async () => {
  const h = orchHarness('stats');
  h.context.refreshStatsPrices();
  assert.equal(h.requests[0].url, '/projects/p/orchestrator/stats?days=30');
  h.requests[0].reject(new Error('Temporary failure'));
  await flush();
  h.context.refreshAfterChange();
  h.context.refreshAfterChange();
  assert.equal(h.requests.length, 1);
  assert.equal(h.timers.size, 1);
  h.advance(3000);
  assert.equal(h.requests.length, 2);
  h.project.rev = 2;
  h.context.refreshAfterChange();
  assert.equal(h.requests.length, 2);
  h.project.rev = 3;
  h.context.refreshAfterChange();
  h.advance(3000);
  assert.equal(h.requests.length, 3);
  h.requests[2].resolve({ rows:[], models:[], marker:'latest' });
  h.requests[1].resolve({ rows:[], models:[], marker:'old' });
  await flush();
  assert.equal(h.ORCH.rev, 3);
  assert.equal(h.ORCH.stats.marker, 'latest');
  assert.equal(h.timers.size, 0);
});

test('project bar keeps its DOM and skips layout until displayed inputs or width change', () => {
  const { document, window } = parseHTML('<html><body><div id="projbar"></div></body></html>');
  const time = clock(), p = { id:'p', name:'PenEcho', lines:[{}] }, bar = document.querySelector('#projbar');
  const S = { cur:p.id, route:{ view:'home' }, cloudKept:{}, cloudAccount:{ signedIn:false } }, events = new Map();
  const dimensions = { available:300, scrollReads:0, clientReads:0 };
  let writes = 0;
  const html = Object.getOwnPropertyDescriptor(window.Element.prototype, 'innerHTML');
  Object.defineProperty(bar, 'innerHTML', { get:html.get, set(value) { writes++; html.set.call(this, value); } });
  Object.defineProperty(window.HTMLElement.prototype, 'scrollWidth', { configurable:true, get() {
    dimensions.scrollReads++;
    return this.querySelector('[data-view="stats"]') ? 200 : 100;
  } });
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { configurable:true, get() {
    dimensions.clientReads++;
    return dimensions.available;
  } });
  const context = vm.createContext({ ...time, document, S, HOSTED:false, HOSTED_OFF:{ views:[] },
    project:() => p, allLines:p => p.lines, underPage:() => true,
    $:(selector, root = document) => root.querySelector(selector), $$:() => [], syncComposer() {},
    topicsGrew:() => Boolean(S.topicsTabFresh?.p), projectsToggleHTML:() => '', esc:String, ic:() => '', SKILL_WHY:'',
    addEventListener:(event, fn) => events.set(event, fn),
  });
  const run = code => vm.runInContext(code, context);
  run(section('pages', 'function renderProjbar()', 'function refreshChrome()'));
  run(section('pages', 'const statsOnBar =', "ACT['more-views']"));
  run(section('cloud', 'const cloudList =', 'function railAccountHTML()'));
  run(section('cloud', 'function cloudAgo(', '// Cloud\'s own words'));
  run(section('cloud', 'const keepable =', "ACT['share-menu']"));
  run(section('main', '  let projbarResizeTimer =', "  $('#lightbox').addEventListener"));
  const render = context.renderProjbar;
  const counts = () => [writes, dimensions.scrollReads, dimensions.clientReads];
  const stable = () => { const before = counts(); render(); assert.deepEqual(counts(), before); };
  const tab = view => bar.querySelector(`[data-view="${view}"]`);

  render();
  assert.deepEqual(counts(), [1, 1, 1]);
  assert.equal(tab('home').getAttribute('aria-current'), 'page');
  stable();
  p.name = 'Renamed project'; render();
  assert.equal(bar.querySelector('.project-name').textContent, 'Renamed project');
  S.route.view = 'orchestrator'; render();
  assert.equal(tab('orchestrator').getAttribute('aria-current'), 'page');

  S.topicsTabFresh = { p:{ at:0, done:false } }; render();
  const hint = tab('topics');
  assert.ok(hint.classList.contains('grew'));
  time.advance(3500);
  stable();
  assert.equal(tab('topics'), hint, 'a no-op poll leaves the animation on its original node');
  S.cloudAccount.signedIn = true; render();
  assert.equal(bar.querySelector('.bar-share').dataset.act, 'share-menu');
  assert.match(tab('topics').getAttribute('style'), /--grew-delay:-3500ms/);
  S.cloudKept.p = { sync:true }; render();
  assert.equal(bar.querySelector('.bar-share').dataset.keep, 'on');
  stable();
  time.advance(6600);
  assert.equal(tab('topics').classList.contains('grew'), false);
  assert.equal(tab('topics').querySelector('.grew-spark'), null);

  context.HOSTED = { onComputer:true, shared:false, key:'p', list:[{ key:'p', computerSyncedAt:time.Date.now() }] };
  render();
  assert.match(bar.querySelector('.bar-synced').textContent, /just now/);
  stable();
  time.advance(60000); render();
  assert.match(bar.querySelector('.bar-synced').textContent, /1 minute ago/);
  context.HOSTED.shared = true; render();
  assert.equal(bar.querySelector('.bar-synced'), null);

  dimensions.available = 150;
  events.get('resize')(); time.advance(150);
  assert.equal(tab('stats'), null);
  assert.equal(S.statsInMore, true);
  stable();
  dimensions.available = 300;
  events.get('resize')(); time.advance(150);
  assert.ok(tab('stats'));
  stable();
  S.newPage = true; render();
  assert.equal(bar.classList.contains('bare'), true);
  stable();
});
