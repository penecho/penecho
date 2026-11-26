'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('./helpers/dom.js');

const read = name => fs.readFileSync(path.join(__dirname, '../public/lines', `${name}.js`), 'utf8');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const ic = (name, size = 18) => `<svg class="ic" data-icon="${name}" width="${size}" height="${size}" aria-hidden="true"></svg>`;

function slice(source, start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `${start} -> ${end}`);
  return source.slice(from, to);
}

function harness(view = 'orchestrator') {
  const { document, window } = parseHTML('<html><body><div id="projbar"></div><div id="view"></div></body></html>');
  let focused = document.body, nextFrame = 0, now = 100000, nextTimer = 1;
  const frames = new Map(), timers = new Map(), calls = {
    go: [], runFind: 0, refreshVault: 0, refreshReaders: 0, refreshLine: 0,
    refreshTopicsPage: 0, refreshStats: 0, refreshOrchestrator: 0, refreshFiles: 0, cloudRefresh: 0,
  };
  Object.defineProperty(document, 'activeElement', { configurable:true, get:() => focused?.isConnected ? focused : document.body });
  Object.defineProperty(document, 'hidden', { configurable:true, get:() => false });
  window.HTMLElement.prototype.focus = function () { focused = this; };
  window.HTMLElement.prototype.getClientRects = function () { return this.isConnected && !this.hidden ? [this.getBoundingClientRect()] : []; };
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    const left = this.dataset?.act === 'more-views' && document.querySelector('.subnav .grew') ? 420 : 400;
    return { left, top:12, right:left + 84, bottom:44, width:84, height:32 };
  };
  const p = {
    id:'p1', name:'PenEcho',
    lines:[{ id:'l1', title:'First line', stations:[] }], landed:[], backlog:[],
    knowledge:[{ path:'topics/a.md', title:'Alpha', sig:'sig-1', lines:[] }],
  };
  const S = { cur:'p1', route:{ view }, data:{ p1:p }, newPage:false, shelfPage:false, statsInMore:false, orchInMore:false };
  const store = new Map();
  const c = vm.createContext({
    document, window, console, S, ACT:{}, SEND:{}, STATE_COLOR:{},
    HOSTED:false, HOSTED_OFF:{ views:[] }, EMBED:null, navigationTransition:0,
    LINE_STATUS:require('../public/lines/line-status.js'),
    localStorage:{ getItem:k => store.get(k) ?? null, setItem:(k, v) => store.set(k, String(v)) },
    Date:{ now:() => now },
    setTimeout:(fn, ms) => { const id = nextTimer++; timers.set(id, { fn, at:now + ms }); return id; },
    clearTimeout:id => timers.delete(id),
    requestAnimationFrame:fn => { frames.set(++nextFrame, fn); return nextFrame; },
    cancelAnimationFrame:id => frames.delete(id),
    innerWidth:1200, innerHeight:800,
    clamp:(v, lo, hi) => Math.max(lo, Math.min(hi, v)),
    addEventListener() {},
    $:(selector, root = document) => root.querySelector(selector),
    $$:(selector, root = document) => [...root.querySelectorAll(selector)],
    esc, ic, av:() => '',
    project:() => p, allLines:proj => proj.lines, underPage:() => true,
    projectsToggleHTML:() => '', SKILL_WHY:'',
    refreshProjectsVisibility() {}, applyRoles() {}, renderRail() {},
    go:route => { calls.go.push(route); S.route = route; c.navigationTransition++; c.closeMenu(); },
    runFind:() => { calls.runFind++; },
    refreshVault:() => { calls.refreshVault++; },
    refreshReaders:() => { calls.refreshReaders++; },
    refreshLine:() => { calls.refreshLine++; },
    refreshTopicsPage:() => { calls.refreshTopicsPage++; },
    refreshStats:() => { calls.refreshStats++; },
    refreshOrchestrator:() => { calls.refreshOrchestrator++; },
    refreshFiles:() => { calls.refreshFiles++; },
    cloudRefresh:() => { calls.cloudRefresh++; },
    fvRefresh() {},
  });
  const core = read('core'), pages = read('pages'), state = read('state');
  vm.runInContext(slice(core, '// Small anchored menu', '// Zoom between levels'), c);
  vm.runInContext(slice(state, '// ---------- Topics that changed ----------', 'async function uploadFiles('), c);
  vm.runInContext(slice(pages, 'function renderProjbar()', '// ---------- Home ----------'), c);
  vm.runInContext(slice(pages, 'function refreshAfterChange()', '// ---------- Memory and files ----------'), c);
  vm.runInContext(slice(pages, 'const statsOnBar =', 'const welcomeHTML ='), c);

  const tick = () => { const list = [...frames.values()]; frames.clear(); list.forEach(fn => fn()); };
  const advance = ms => {
    now += ms;
    for (const [id, t] of [...timers.entries()]) {
      if (timers.has(id) && t.at <= now) { timers.delete(id); t.fn(); }
    }
  };
  const moreBtn = () => document.querySelector('#projbar [data-act="more-views"]');
  const menu = () => document.querySelector('#menu.more-views-menu');
  const key = (target, k) => {
    const e = new window.Event('keydown', { bubbles:true, cancelable:true });
    e.key = k;
    target.dispatchEvent(e);
  };
  return { c, p, S, document, calls, tick, advance, moreBtn, menu, key };
}

test('More dropdown stays open, focused and clickable across projbar redraws from background refreshes', () => {
  const h = harness('orchestrator');
  h.c.checkTopics(h.p);
  h.c.renderProjbar();
  const initialBtn = h.moreBtn();
  assert.ok(initialBtn);

  h.c.ACT['more-views'](initialBtn);
  const openMenu = h.menu();
  assert.ok(openMenu);
  h.key(h.document.activeElement, 'ArrowDown');
  const focusedItem = h.document.activeElement;
  assert.equal(focusedItem.textContent.trim(), 'Vault');

  // Unchanged background poll leaves both the More button and menu intact.
  h.c.refreshAfterChange();
  h.tick();
  assert.equal(h.moreBtn(), initialBtn);
  assert.equal(h.menu(), openMenu);
  assert.equal(h.document.activeElement, focusedItem);

  // A Topic update redraws #projbar (adding the fading highlight), replacing the More button node.
  h.p.knowledge[0].sig = 'sig-2';
  assert.equal(h.c.checkTopics(h.p).length, 1);
  h.c.refreshAfterChange();
  h.tick();
  const replacedBtn = h.moreBtn();
  assert.notEqual(replacedBtn, initialBtn, 'projbar redrew and replaced the More button');
  assert.equal(h.menu(), openMenu, 'More dropdown stays mounted across projbar redraw');
  assert.equal(h.document.activeElement, focusedItem, 'focused item inside More dropdown stays focused');

  // Fade completion redraws #projbar again after 10s; the menu still survives.
  h.advance(10100);
  h.tick();
  const afterFadeBtn = h.moreBtn();
  assert.notEqual(afterFadeBtn, replacedBtn);
  assert.equal(h.menu(), openMenu);
  assert.equal(h.document.activeElement, focusedItem);

  // Clicking the focused menu item navigates cleanly instead of being dropped.
  focusedItem.click();
  assert.equal(h.menu(), null);
  assert.deepEqual(h.calls.go.map(r => ({ ...r })), [{ view:'vault' }]);
});

test('More dropdown handles Escape, toggle click, outside click and navigation/project changes after projbar redraw', () => {
  const h = harness('orchestrator');
  h.c.renderProjbar();
  h.c.ACT['more-views'](h.moreBtn());
  h.p.name = 'PenEcho (renamed)';
  h.c.renderProjbar();
  h.tick();

  // Escape returns focus to the replacement More button.
  h.key(h.document.activeElement, 'Escape');
  assert.equal(h.menu(), null);
  assert.equal(h.document.activeElement, h.moreBtn());

  // Reopen, redraw #projbar, then click the replacement More button to toggle closed.
  h.c.ACT['more-views'](h.moreBtn());
  assert.ok(h.menu());
  h.p.name = 'PenEcho (v2)';
  h.c.renderProjbar();
  h.c.menuOutside({ target:h.moreBtn() });
  assert.ok(h.menu(), 'pointerdown on replacement More button does not prematurely close before click toggle');
  h.c.ACT['more-views'](h.moreBtn());
  assert.equal(h.menu(), null, 'clicking More while open toggles it closed');

  // Project switch or opening Settings closes the menu on the next check without running stale actions.
  for (const mode of ['project', 'view', 'newPage', 'shelfPage', 'navigation']) {
    const t = harness('orchestrator');
    t.c.renderProjbar();
    t.c.ACT['more-views'](t.moreBtn());
    const item = t.menu().querySelector('button');
    if (mode === 'project') t.S.cur = 'other';
    if (mode === 'view') t.S.route = { view:'home' };
    if (mode === 'newPage') t.S.newPage = true;
    if (mode === 'shelfPage') t.S.shelfPage = 'settings';
    if (mode === 'navigation') t.c.navigationTransition++;
    item.click();
    assert.equal(t.menu(), null, `${mode}: menu closes`);
    assert.equal(t.calls.go.length, 0, `${mode}: stale item click does not navigate`);
  }
});

test('background refreshAfterChange does not refresh Search or More-dropdown pages (Memory, Vault, Archive, Deleted)', () => {
  for (const view of ['find', 'memory', 'vault', 'archive', 'deleted']) {
    const h = harness(view);
    h.c.renderProjbar();
    h.c.refreshAfterChange();
    assert.equal(h.calls.runFind, 0, `${view}: must not trigger runFind`);
    assert.equal(h.calls.refreshVault, 0, `${view}: must not trigger refreshVault`);
    assert.equal(h.calls.refreshReaders, 0, `${view}: must not trigger refreshReaders`);
    assert.equal(h.calls.cloudRefresh, 0, `${view}: must not trigger cloudRefresh`);
  }

  // Active live views continue refreshing normally on refreshAfterChange.
  const lineH = harness('line');
  lineH.c.refreshAfterChange();
  assert.equal(lineH.calls.refreshLine, 1);
  assert.equal(lineH.calls.refreshReaders, 1);
  assert.equal(lineH.calls.cloudRefresh, 1);

  const orchH = harness('orchestrator');
  assert.equal(orchH.c.refreshAfterChange(), true);
  assert.equal(orchH.calls.refreshOrchestrator, 1);

  const topicsH = harness('topics');
  topicsH.c.refreshAfterChange();
  assert.equal(topicsH.calls.refreshTopicsPage, 1);

  const filesH = harness('files');
  filesH.c.refreshAfterChange();
  assert.equal(filesH.calls.refreshFiles, 1);
});

test('Search page keeps rendered results and expanded groups across background polls without re-querying /find', async () => {
  const { document, window } = parseHTML('<html><body><div id="projbar"></div><div id="view"></div></body></html>');
  const requests = [];
  const p = {
    id:'p1', name:'PenEcho',
    lines:[{ id:'l1', title:'Refresh issue', status:'working', stations:[{ id:'ask-1', kind:'ask', text:'refresh dropdown' }], questions:[] }],
    landed:[], backlog:[], knowledge:[],
  };
  const S = { cur:'p1', route:{ view:'find', q:'refresh' }, data:{ p1:p }, newPage:false, shelfPage:false, statsInMore:false, orchInMore:false };
  const c = vm.createContext({
    document, window, console, S, ACT:{}, SEND:{}, STATE_COLOR:{},
    HOSTED:false, HOSTED_OFF:{ views:[] }, EMBED:null, MOD_ENTER:'⌘↵', AbortController, URLSearchParams,
    LINE_STATUS:require('../public/lines/line-status.js'),
    localStorage:{ getItem:() => null, setItem() {} },
    matchMedia:() => ({ matches:true }),
    setTimeout, clearTimeout, queueMicrotask, addEventListener() {},
    $:(selector, root = document) => root.querySelector(selector),
    $$:(selector, root = document) => [...root.querySelectorAll(selector)],
    esc, ic, av:() => '', wordsMd:x => x, askOnly:x => x, plainOut:x => x,
    stepLabel:() => 'Ask', STATE_TEXT:{ working:'Working', ready:'Finished', reviewed:'Reviewed', archived:'Archived' },
    project:() => p, allLines:proj => proj.lines, lineById:(proj, id) => proj.lines.find(l => l.id === id),
    shownState:require('../public/lines/line-status.js').shownState,
    lineReviewed:require('../public/lines/line-status.js').lineReviewed,
    pathFor:id => `/projects/${id}`, underPage:() => true,
    projectsToggleHTML:() => '', SKILL_WHY:'',
    refreshProjectsVisibility() {}, applyRoles() {}, renderRail() {}, refreshChrome() {}, syncHash() {}, toast() {},
    api:(url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })),
  });
  const pages = read('pages');
  vm.runInContext(read('find'), c);
  vm.runInContext(slice(pages, 'function refreshAfterChange()', '// ---------- Memory and files ----------'), c);

  document.querySelector('#view').innerHTML = c.findHTML(p, S.route);
  await new Promise(resolve => setImmediate(resolve));
  const findReq = requests.find(r => r.url.includes('/find?'));
  assert.ok(findReq, 'initial opening of Search with query requests /find');
  findReq.resolve({
    q:'refresh', filterVersion:1, tab:'all', status:'all', words:['refresh'],
    total:4, yours:4, work:0, lineCount:1,
    statusCounts:{ all:1, working:1, stopped:0, you:0, todo:0, review:0, send:0 },
    lines:[{
      slug:'l1', title:'Refresh issue', count:4,
      hits:[
        { kind:'ask', step:'ask-1', snippet:'refresh 1', score:1 },
        { kind:'ask', step:'ask-2', snippet:'refresh 2', score:1 },
        { kind:'ask', step:'ask-3', snippet:'refresh 3', score:1 },
        { kind:'ask', step:'ask-4', snippet:'refresh 4', score:1 },
      ],
    }],
  });
  await new Promise(resolve => setImmediate(resolve));

  // Expand "1 more" and mark a DOM node to confirm it is not replaced.
  const moreHitsBtn = document.querySelector('[data-act="find-more"]');
  assert.ok(moreHitsBtn);
  c.ACT['find-more'](moreHitsBtn);
  const firstHit = document.querySelector('#findBody .fh');
  assert.ok(firstHit);
  const requestCountBefore = requests.length;

  // Background state change from another Line runs refreshAfterChange().
  p.lines[0].status = 'ready';
  c.refreshAfterChange();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(requests.length, requestCountBefore, 'background refresh must not re-query /find');
  assert.equal(document.querySelector('#findBody .fh'), firstHit, 'existing Search result DOM node stays mounted');
  assert.equal(document.querySelectorAll('#findBody .fh').length, 4, 'expanded search matches remain open');
});
