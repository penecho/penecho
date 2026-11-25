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

function navContext(projectOverrides = {}) {
  const { document, window } = parseHTML('<html><body><div id="projbar"></div></body></html>');
  const p = {
    id:'p1',
    name:'PenEcho',
    projectTopics:true,
    lines:[{ id:'line-1', slug:'line-1', stations:[] }],
    landed:[],
    backlog:[],
    knowledge:[{ path:'topics/orch.md', title:'Orchestrator', lines:['line-1'], sig:'s1' }],
    understanding:true,
    ...projectOverrides,
  };
  const S = { cur:'p1', route:{ view:'home' }, data:{ p1:p }, newPage:false, shelfPage:false, statsInMore:false, orchInMore:false, navFold:0 };
  let rendered = 0;
  const ctx = vm.createContext({
    document, window, console, S, HOSTED:false, HOSTED_OFF:{ views:[] },
    $:(selector, root = document) => root.querySelector(selector), esc, ic,
    addEventListener() {}, clearTimeout() {}, setTimeout() {},
    project:() => p, allLines:proj => proj.lines, underPage:() => true,
    projectsToggleHTML:() => '',
    memoryGrew:() => false, topicsGrew:proj => Boolean(proj && proj.projectTopics !== false), brandMark:() => '', SKILL_WHY:'',
    refreshChrome() {}, refreshReaders() {}, render() { rendered++; },
  });
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { configurable:true, get() { return 500; } });
  Object.defineProperty(window.HTMLElement.prototype, 'scrollWidth', { configurable:true, get() { return 100; } });
  const pages = read('pages');
  vm.runInContext(pages.slice(pages.indexOf('function renderProjbar()'), pages.indexOf('function refreshChrome()')), ctx);
  vm.runInContext(pages.slice(pages.indexOf('const statsOnBar ='), pages.indexOf("ACT['more-views']")), ctx);
  vm.runInContext(pages.slice(pages.indexOf('function refreshAfterChange()'), pages.indexOf('// ---------- Memory and files ----------')), ctx);
  vm.runInContext(pages.slice(pages.indexOf('function growNote(id)'), pages.indexOf("ACT['topic-note-open']")), ctx);
  vm.runInContext('globalThis.__moreViews = moreViews;', ctx);
  return {
    ctx, document, S, p,
    rendered:() => rendered,
    barViews:() => [...document.querySelectorAll('.subnav [data-view]')].map(el => el.dataset.view),
    moreViewKeys:() => Array.from(ctx.__moreViews(), ([k]) => k),
  };
}

test('project bar, More menu, and Topic update toast hide Topics entrance when projectTopics is false', () => {
  const h = navContext({ projectTopics:true });
  h.ctx.renderProjbar();
  assert.equal(h.barViews().includes('topics'), true);

  h.p.projectTopics = false;
  h.ctx.renderProjbar();
  assert.equal(h.barViews().includes('topics'), false);
  assert.equal(h.moreViewKeys().includes('topics'), false);

  // Even when folded into More on a narrow bar, Topics stays hidden.
  h.S.navFold = 2;
  h.ctx.renderProjbar();
  assert.equal(h.barViews().includes('topics'), false);
  assert.equal(h.moreViewKeys().includes('topics'), false);

  // Topic update toast is suppressed when projectTopics is false.
  h.ctx.announceTopics(h.p, [{ path:'topics/orch.md', title:'Orchestrator', status:'active', isNew:true }]);
  assert.equal(h.document.querySelector('#topicNote'), null);

  // If currently viewing topics when a poll turns projectTopics off, refreshAfterChange triggers render() to leave topics.
  h.S.route = { view:'topics' };
  h.ctx.refreshAfterChange();
  assert.equal(h.rendered(), 1);
});

test('Topics is reachable before the first Line in a local project', () => {
  const { ctx, S, p, barViews, moreViewKeys } = navContext({ lines:[], knowledge:[], understanding:false });
  ctx.renderProjbar();
  assert.equal(barViews().includes('topics'), true);
  S.navFold = 2;
  assert.equal(moreViewKeys().includes('topics'), true);
  S.thisComputer = false;
  assert.equal(moreViewKeys().includes('topics'), false);
  S.thisComputer = true;
  p.myCanvases = true;
  assert.equal(moreViewKeys().includes('topics'), false);
});

test('All lines does not categorize trunk lines by topic when projectTopics is false, while keeping Git branch grouping', () => {
  const panorama = read('panorama');
  const ctx = vm.createContext({
    esc,
    ic:n => `<svg data-icon="${n}"></svg>`,
    plural:(n, one, many) => `${n} ${n === 1 ? one : many}`,
    newLineOn:(_p, name) => `<button data-branch="${esc(name)}">New line</button>`,
    archiveBranchOn:() => '',
    allLines:p => p.lines,
    rowFacts:l => ({ at:l.at, words:'', text:l.title.toLowerCase() }),
    dayStart:ms => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); },
    restsDone:() => false,
    dayClock:() => null,
    lineDayName:() => 'Sun 22',
    dayHeadHTML:(key, words, n) => `${key}:${words}:${n}`,
    offHeadHTML:() => 'off',
    ACT:{},
  });
  vm.runInContext(panorama.slice(panorama.indexOf('// ---------- Days ----------'), panorama.indexOf('// ---------- Off main ----------')), ctx);
  vm.runInContext(panorama.slice(panorama.indexOf('function sessionRootOf('), panorama.indexOf('// ---------- Days ----------')), ctx);
  vm.runInContext(panorama.slice(panorama.indexOf('function homeDayParts('), panorama.indexOf('const Pano = {')), ctx);

  const orch = { path:'topics/orch.md', title:'Orchestrator', lines:['a', 'c', 'd'] };
  const agents = { path:'topics/agents.md', title:'Agents and work execution', lines:['b'] };
  const t0 = new Date(2026, 10, 22, 10, 0).getTime();
  const lines = [
    { id:'a', slug:'a', title:'Line A', at:t0 + 4000, knowledgeTopic:orch },
    { id:'b', slug:'b', title:'Line B', at:t0 + 3000, knowledgeTopic:agents },
    { id:'c', slug:'c', title:'Line C', at:t0 + 2000, knowledgeTopic:orch },
    { id:'d', slug:'d', title:'Line D', at:t0 + 1000, branch:'claude/meetcue-google-play', knowledgeTopic:orch },
  ];

  // With projectTopics enabled: trunk lines group under Topics, branch lines group under branch.
  const onProject = { id:'p1', trunk:'main', projectTopics:true, lines };
  assert.deepEqual(
    JSON.parse(JSON.stringify(ctx.branchGroups(onProject, lines).map(g => [g.branch || g.topic?.title || '', g.lines.map(l => l.id)]))),
    [['Orchestrator', ['a', 'c']], ['Agents and work execution', ['b']], ['claude/meetcue-google-play', ['d']]]
  );

  // With projectTopics disabled: trunk lines are NOT grouped by Topic, while branch lines still group under branch.
  const offProject = { id:'p1', trunk:'main', projectTopics:false, lines };
  assert.deepEqual(
    JSON.parse(JSON.stringify(ctx.branchGroups(offProject, lines).map(g => [g.branch || g.topic?.title || '', g.lines.map(l => l.id)]))),
    [['', ['a']], ['', ['b']], ['', ['c']], ['claude/meetcue-google-play', ['d']]]
  );

  const day = ctx.homeDayParts(offProject, lines, {
    now:t0 + 5000, W:300, split:false, shownDone:true, opened:new Set(), all:40, collapsedIds:new Set(), rootOf:ctx.sessionRootOf(offProject),
  });
  assert.equal(day.parts.some(part => part.topic), false);
  assert.deepEqual(Array.from(day.parts.filter(part => part.bhead), part => part.bhead), ['claude/meetcue-google-play']);
  assert.deepEqual(Array.from(day.parts.filter(part => part.l), part => part.l.id), ['a', 'b', 'c', 'd']);
});

test('Home Topics card, topic filter, Project settings Topics row, and Token savings period switch respect projectTopics=false', () => {
  const { document } = parseHTML('<html><body><div id="hmWeek"></div></body></html>');
  const p = {
    id:'p1',
    name:'PenEcho',
    projectTopics:false,
    lines:[{ id:'l1', slug:'l1', title:'First', stations:[] }],
    landed:[],
    backlog:[],
    knowledge:[{ path:'topics/orch.md', title:'Orchestrator', lines:['l1'] }],
    tokens:{ measuredWorks:1, starts:[], daily:[] },
  };
  const ctx = vm.createContext({
    document, ACT:{}, S:{ route:{ view:'home' }, tokenPeriod:'week', topicsNew:{ p1:p.knowledge } },
    Pano:{ topic:{ p1:'topics/orch.md' } }, HOSTED:false,
    $:s => document.querySelector(s), $$:s => [...document.querySelectorAll(s)],
    project:() => p, allLines:proj => proj.lines, topicsGrew:() => false, esc, ic,
    homeChoice:() => ({}), setHomeChoice() {}, rowFacts:() => ({ at:0 }), rowMark:() => 'done',
    addEventListener() {},
  });
  vm.runInContext(read('desk'), ctx);
  vm.runInContext('globalThis.__topicFilter = topicFilter;', ctx);

  assert.equal(ctx.topicsCardHTML(p), '');
  assert.equal(ctx.__topicFilter(p), '');
  assert.equal(ctx.topicsSettingsRow(p), '');
  assert.match(ctx.tokenProjectHTML(p), /class="tp-period"/, 'Token savings renders its own period selector when Topics card is hidden');

  p.projectTopics = true;
  assert.match(ctx.topicsCardHTML(p), /data-view="topics"/);
  assert.equal(ctx.__topicFilter(p), 'topics/orch.md');
  assert.match(ctx.topicsSettingsRow(p), /aria-label="Topics"/);
});

test('adoptState, checkTopics, topicsGrew, and line topicHere disable topic metadata and panel when projectTopics is false', () => {
  const ctx = vm.createContext({
    console, HOSTED:false, EMBED:null, ACT:{},
    LINE_STATUS:require('../public/lines/line-status.js'),
    localStorage:{ getItem:() => null, setItem() {} },
    addEventListener() {},
    document:{ querySelector:() => null, querySelectorAll:() => [] },
    esc, ic,
  });
  vm.runInContext(read('state'), ctx);
  vm.runInContext(read('merge'), ctx);
  vm.runInContext('globalThis.__api = { S, topicsGrew, topicHere, topicFirst };', ctx);

  const line = { id:'l1', slug:'l1', title:'Task', status:'ready', stations:[] };
  const state = {
    format:2,
    rev:1,
    project:{ id:'p1', name:'PenEcho', projectTopics:false },
    lines:[line],
    landed:[],
    backlog:[],
    knowledge:[{ path:'topics/orch.md', title:'Orchestrator', lines:['l1'], sig:'abc' }],
    understanding:true,
  };
  const adopted = ctx.adoptState(state);
  assert.equal(adopted.lines[0].knowledgeTopic, null);
  assert.deepEqual(Array.from(ctx.checkTopics(adopted)), []);
  ctx.__api.S.topicsNew = { p1:[{ path:'topics/orch.md' }] };
  assert.equal(ctx.__api.topicsGrew(adopted), false);
  assert.equal(ctx.__api.topicHere(adopted, adopted.lines[0]), false);
  assert.equal(ctx.__api.topicFirst(adopted, adopted.lines[0]), false);

  adopted.projectTopics = true;
  assert.equal(ctx.__api.topicsGrew(adopted), true);
  assert.equal(ctx.__api.topicHere(adopted, adopted.lines[0]), true);
  assert.equal(ctx.__api.topicFirst(adopted, adopted.lines[0]), true);
});

test('renderPage redirects topics view to home and docBackTarget skips topics when projectTopics is false', () => {
  const mainSrc = read('main');
  assert.match(mainSrc, /if \(r\.view === 'topics' && p\.projectTopics === false\) S\.route = \{ view:'home' \};/);

  const navCtx = vm.createContext({
    S:{ cur:'p1', route:{ view:'doc', doc:'README.md' }, docTrails:{ p1:[{ toDoc:'README.md', route:{ view:'topics' } }] } },
    VIEWS:{ home:() => '', topics:() => '', doc:() => '' },
    EMBED:null, localStorage:{ getItem:() => null, setItem() {} }, ACT:{},
  });
  vm.runInContext(read('navigation'), navCtx);
  assert.equal(navCtx.docBackTarget({ id:'p1', name:'PenEcho', projectTopics:false }, 'README.md'), null);
});
