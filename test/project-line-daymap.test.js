'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const status = require('../public/lines/line-status.js');
const source = fs.readFileSync(path.join(__dirname, '../public/lines/panorama.js'), 'utf8');
const lineSource = fs.readFileSync(path.join(__dirname, '../public/lines/line.js'), 'utf8');
const esc = v => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
function filters(saved = {}) {
  let stored = JSON.stringify(saved);
  const context = vm.createContext({
    localStorage:{ getItem:() => stored, setItem:(_k, v) => { stored = v; } },
    lineState:status.lineState, lineNeedsYou:status.lineNeedsYou, isTodo:status.isTodo, toReview:status.toReview, toLookAt:status.toLookAt, isWork:status.isWork,
    lineHint:(_p, l) => l.unread ? 'unread' : '',
    rowFacts:l => ({ at:l.at || 0, text:`${l.title || ''} ${l.code || ''}`.toLowerCase() }),
    Pano:{ words:{}, kept:{} },
  });
  vm.runInContext(source.slice(source.indexOf('const hasWork ='), source.indexOf('// ---------- Days ----------')), context);
  vm.runInContext('globalThis.ui = { shownLines, setHomeChoice, homeChoice, mapFilter, normalizeHomeChoice };', context);
  return { ...context.ui, context, saved:() => JSON.parse(stored) };
}
const work = (reviewed, extra = {}) => ({ kind:'work', state:'done', reviewed, ...extra });
const line = (id, state, stations = [], extra = {}) => ({ id, title:id, status:state, stations, questions:[], ...extra });
test('legacy Finished preference becomes one selected status, with explicit status taking precedence', () => {
  const ui = filters({ a:{ done:true }, b:{ f:'review', done:true, topic:true }, c:{ f:'done' }, d:{ f:'invalid', done:true }, e:{ done:false } });
  assert.deepEqual(ui.saved(), { a:{ f:'done' }, b:{ f:'review', topic:true }, c:{ f:'done' }, d:{}, e:{} });
  assert.equal(ui.mapFilter({ id:'a' }), 'done');
  assert.equal(ui.mapFilter({ id:'b' }), 'review');
  assert.deepEqual(filters(ui.saved()).saved(), ui.saved());
});
test('each status is an exclusive predicate, including Finished; All resets it', () => {
  const ui = filters(), p = { id:'p', lines:[
    line('review', 'ready', [work(false)]), line('finished', 'ready', [work(true)]),
    line('todo', 'done', [work(false)], { todo:true }),
    line('working', 'working', [{ kind:'work', state:'active' }]), line('stopped', 'stopped', [{ kind:'work', state:'error' }]),
    line('notes', 'notes', [{ kind:'note' }]), line('needs-you', 'waiting', [{ kind:'work', state:'wait' }]),
    line('asking', 'ready', [work(false)], { asking:{ kind:'reply', questions:[{ text:'Which prototype?' }] } }),
    line('unread', 'notes', [{ kind:'note' }], { unread:true }),
  ] };
  for (const [f, expected] of [['you', ['asking', 'needs-you']], ['todo', ['todo']], ['review', ['review']], ['done', ['finished']], ['working', ['working']], ['stopped', ['stopped']], ['unread', ['unread']]]) {
    ui.setHomeChoice(p, { f });
    assert.deepEqual(Array.from(ui.shownLines(p), l => l.id).sort(), expected.sort());
  }
  ui.setHomeChoice(p, { f:'' });
  assert.equal(ui.shownLines(p).length, p.lines.length);
});
test('new or transitioned lines cannot bypass an active status, even if previously kept', () => {
  const ui = filters(), p = { id:'p', lines:[line('done', 'ready', [work(true)]), line('new', 'working', [{ kind:'work', state:'active' }])] };
  ui.context.Pano.kept.p = new Set(['new']);
  ui.setHomeChoice(p, { f:'done' });
  assert.deepEqual(Array.from(ui.shownLines(p), l => l.id), ['done']);
  p.lines.push(line('new-done', 'ready', [work(true)]));
  assert.deepEqual(Array.from(ui.shownLines(p), l => l.id), ['done', 'new-done']);
  p.lines[0] = line('done', 'working', [{ kind:'work', state:'active' }]);
  assert.deepEqual(Array.from(ui.shownLines(p), l => l.id), ['new-done']);
  ui.context.Pano.words.p = 'new';
  assert.deepEqual(Array.from(ui.shownLines(p), l => l.id), ['new-done']);
});
function preview(stations) {
  const context = vm.createContext({
    esc, LINE_STATUS:status, isWork:status.isWork, isYours:status.isYours, isEnd:s => ['merge', 'deliver'].includes(s.kind),
    STATE_TEXT:{ review:'To review' }, trackSteps:l => l.stations, rowFacts:() => ({ at:0 }),
    rowActions:() => '<button>Mark reviewed</button>',
    ic:n => `<svg data-icon="${n}"></svg>`, av:a => `<span class="av">${a}</span>`, assetUrl:(_p, name) => `/asset/${name}`,
    fileChip:f => `<button data-act="open-doc" data-doc="${esc(f.path)}">${esc(f.name)}</button>`,
  });
  vm.runInContext(lineSource.slice(lineSource.indexOf('const plainOut ='), lineSource.indexOf('const DIFF_LINES =')), context);
  vm.runInContext(lineSource.slice(lineSource.indexOf('const isOrchReview ='), lineSource.indexOf('const reviewStepId =')), context);
  vm.runInContext(lineSource.slice(lineSource.indexOf('const firstLine ='), lineSource.indexOf('// A finished Work says')), context);
  vm.runInContext(source.slice(source.indexOf('const FILE_SET ='), source.indexOf('// ---------- When each step happened')), context);
  vm.runInContext(source.slice(source.indexOf('function laneDetailHTML('), source.indexOf('const dayStart =')), context);
  const p = { files:[{ path:'files/picture.png' }], pictures:[] }, l = { id:'demo', slug:'demo', title:'Demo', tags:[], stations };
  context.p = p; context.l = l;
  return vm.runInContext('laneDetailHTML(p,l)', context);
}
test('hidden protocol Ask does not leave a blank shell and the previous real Ask remains visible', () => {
  const html = preview([
    { id:'ask-1', kind:'ask', text:'Please set it up.', files:[] },
    { id:'ask-2', kind:'ask', text:'<side-sessions-event>All workers finished.</side-sessions-event>', files:[] },
    { id:'work-2', kind:'work', state:'done', out:'Saved and verified.', agent:'codex' },
  ]);
  assert.match(html, /Please set it up\./);
  assert.match(html, /Saved and verified\./);
  assert.doesNotMatch(html, /side-sessions-event|All workers finished|<p><\/p>/);
});
test('structured question reply displays its extracted answer without leaking wrapper JSON', () => {
  const html = preview([
    { id:'ask-1', kind:'ask', text:'Please set it up.', files:[] },
    { id:'ask-2', kind:'ask', text:'<send_user_message_question_reply>\n[{"question":"Logged in?","answer":"登陆好了"}]\n</send_user_message_question_reply>', files:[] },
    { id:'work-2', kind:'work', state:'done', out:'Saved and verified.', agent:'codex' },
  ]);
  assert.match(html, /登陆好了/);
  assert.doesNotMatch(html, /question_reply|Logged in\?|"answer"/);
});
test('a wholly empty Ask or latest Work leaves no bubble and never substitutes an older result', () => {
  const html = preview([
    { id:'old', kind:'work', state:'done', out:'Old result' },
    { id:'ask', kind:'ask', text:'<agent-notification>Internal only</agent-notification>', files:[] },
    { id:'latest', kind:'work', state:'done', out:'' },
  ]);
  assert.doesNotMatch(html, /class="hd-ask|class="hd-result|Old result|Internal only/);
  assert.match(html, /Mark reviewed/);
  assert.match(html, /Open line/);
});
test('image-only and attachment-only Asks retain visible, directly accessible content', () => {
  const image = preview([{ id:'ask', kind:'ask', text:'', files:[{ path:'files/picture.png', name:'Picture', image:true }] }]);
  assert.match(image, /class="st-pic"/);
  assert.match(image, /data-act="home-picture"/);
  assert.match(image, /<img /);
  const file = preview([{ id:'ask', kind:'ask', text:'', files:[{ path:'files/brief.md', name:'brief.md', image:false }] }]);
  assert.match(file, /data-act="open-doc"/);
  assert.match(file, /brief\.md/);
});
function branches() {
  const context = vm.createContext({
    esc, ic:n => `<svg data-icon="${n}"></svg>`, plural:(n, one, many) => `${n} ${n === 1 ? one : many}`,
    newLineOn:(_p, name) => `<button data-branch="${esc(name)}">New line</button>`,
    archiveBranchOn:() => '',
  });
  vm.runInContext(source.slice(source.indexOf('function branchGroups('), source.indexOf('// ---------- Starting a line')), context);
  vm.runInContext('globalThis.ui = { branchGroups, branchHeadHTML, topicHeadHTML };', context);
  return context.ui;
}
test('a day keeps its order and gathers lines on one branch where the newest of them stands', () => {
  const ui = branches(), p = { trunk:'main' };
  const lines = [{ id:'a' }, { id:'b', branch:'feat/x' }, { id:'c', branch:'main' }, { id:'d', branch:'feat/y' }, { id:'e', branch:'feat/x' }, { id:'f' }];
  assert.deepEqual(JSON.parse(JSON.stringify(ui.branchGroups(p, lines).map(g => [g.branch, g.lines.map(l => l.id)]))),
    [['', ['a']], ['feat/x', ['b', 'e']], ['', ['c']], ['feat/y', ['d']], ['', ['f']]]);
});
test('lines on the trunk gather under their knowledge Topic like a branch; a branch wins over a Topic', () => {
  const ui = branches(), p = { trunk:'main' }, accounts = { path:'topics/accounts.md', title:'Accounts', lines:['a', 'c', 'e'] };
  const lines = [{ id:'a', knowledgeTopic:accounts }, { id:'b' }, { id:'c', knowledgeTopic:accounts }, { id:'e', branch:'feat/x', knowledgeTopic:accounts }];
  assert.deepEqual(JSON.parse(JSON.stringify(ui.branchGroups(p, lines).map(g => [g.branch || g.topic?.title || '', g.lines.map(l => l.id)]))),
    [['Accounts', ['a', 'c']], ['', ['b']], ['feat/x', ['e']]]);
  const head = ui.topicHeadHTML(p, accounts, 2);
  assert.match(head, /bh-topic" data-act="open-doc" data-doc="topics\/accounts\.md"/);
  assert.match(head, /Accounts/);
  assert.match(head, /2 lines/);
});
test('a branch head names the branch, counts its lines, says what Git says and offers a new line on it', () => {
  const ui = branches(), p = { trunk:'main', branches:{ 'feat/x':{ merged:true, note:'Merged into main' } }, lines:[{ id:'a', branch:'feat/x', diff:{ add:39, del:7 } }, { id:'b', branch:'feat/x', diff:{ add:3, del:1 } }] };
  const html = ui.branchHeadHTML(p, 'feat/x', 2);
  assert.match(html, /bh-pill[^>]*title="feat\/x"/);
  assert.match(html, /2 lines/);
  assert.match(html, /bh-note is-merged">Merged into main/);
  assert.match(html, /\+39<\/i> <u>−7/);
  assert.match(html, /data-branch="feat\/x"/);
  assert.doesNotMatch(ui.branchHeadHTML({ lines:[] }, 'feat/y', 1), /row-diff|bh-note/);
});

function trackUI(nowMs) {
  const vmMod = require('node:vm'), fsMod = require('node:fs'), pathMod = require('node:path');
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [nowMs])); }
    static now() { return nowMs; }
  }
  const agents = { claude:{ name:'Claude', color:'#d97757' }, codex:{ name:'Codex', color:'#10a37f' } };
  const lineStatus = require('../public/lines/line-status.js');
  const ctx = {
    Date:Clock, ACT:{}, S:{ plan:[], mapFilter:{} }, LINE_STATUS:lineStatus,
    esc:s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    ic:name => `<i>${name}</i>`,
    av:(id, size) => `<i class="av" style="width:${size}px;height:${size}px">${id}</i>`,
    agentInfo:id => agents[id] || { name:id, color:'#666' },
    isYours:s => s.kind === 'ask' || s.kind === 'note' || s.kind === 'meeting',
    isEnd:s => s.kind === 'end' || s.kind === 'merge',
    openQuestions:l => l.asking?.questions || (l.stations || []).filter(s => s.state === 'open'),
    lineState:l => l.state || lineStatus.statusOf(l),
    toReview:l => (l.state || lineStatus.statusOf(l)) === 'ready' && !l.reviewed,
    lineNeedsYou:l => (l.state || lineStatus.statusOf(l)) === 'wait' || Boolean(l.asking?.questions?.length),
    isTodo:() => false,
    isWork:s => s.kind === 'work',
    lineHint:() => '',
    plainOut:s => String(s || ''),
    stopWords:s => s?.text || '',
    project:() => null,
  };
  vmMod.createContext(ctx);
  vmMod.runInContext(lineSource.slice(lineSource.indexOf('const canStop ='), lineSource.indexOf('const waitingWhyOf =')), ctx);
  vmMod.runInContext(fsMod.readFileSync(pathMod.join(__dirname, '../public/lines/panorama.js'), 'utf8'), ctx);
  return ctx;
}

test('lane track status circles the agent circle across timed and even layouts, with fallback standalone end only when needed', () => {
  const t0 = new Date(2026, 10, 14, 9, 0).getTime();
  const now = new Date(2026, 10, 14, 12, 0).getTime();
  const ui = trackUI(now);
  const p = { id:'p', trunk:'main', lines:[] };
  const pad = n => String(n).padStart(2, '0');
  const fmt = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const mkWork = (id, state, agent, startMin, endMin, extra = {}) => ({
    id, state,
    stations:[
      { id:'a1', kind:'ask', when:fmt(t0 + (startMin - 2) * 60000) },
      { id:'w1', kind:'work', agent, state:state === 'working' ? 'active' : state === 'error' ? 'bad' : 'done', startedAt:t0 + startMin * 60000, ...(endMin != null ? { endedAt:t0 + endMin * 60000 } : {}) },
      ...(extra.stations || []),
    ],
    ...extra.line,
  });

  const cases = [
    ['working', 'e-run'],
    ['ready', 'e-review'],
    ['ready-reviewed', 'e-done'],
    ['error', 'e-bad'],
    ['wait', 'e-you'],
  ];
  const lines = cases.map(([kind, cls], i) => {
    const start = 20 + i * 25;
    if (kind === 'ready-reviewed') return mkWork(kind, 'ready', 'claude', start, start + 3, { line:{ reviewed:true } });
    if (kind === 'working') return mkWork(kind, 'working', 'claude', 175, null);
    return mkWork(kind, kind, 'claude', start, start + 3);
  });
  p.lines = lines;
  const clock = ui.dayClock('2026-11-14', lines, now, 360);

  for (let i = 0; i < cases.length; i++) {
    const [, cls] = cases[i], l = lines[i];
    for (const html of [ui.timedTrackHTML(p, l, clock), ui.evenTrackHTML(p, l, 360)]) {
      assert.match(html, new RegExp(`class="st dm dm-face has-end ${cls}"`), `${cases[i][0]} should circle .dm-face`);
      assert.doesNotMatch(html, /dm-end/, `${cases[i][0]} should not render standalone .dm-end`);
      assert.doesNotMatch(html, /dm-bar/, `${cases[i][0]} short Work should not render stubby .dm-bar`);
    }
  }

  // Long duration Work (> circle radius) still renders .dm-bar anchored inside the ringed .dm-face.
  const longDone = mkWork('long-done', 'ready', 'claude', 30, 120);
  const longRun = mkWork('long-run', 'working', 'codex', 60, null);
  const longClock = ui.dayClock('2026-11-14', [longDone, longRun], now, 360);
  for (const [l, cls] of [[longDone, 'e-review'], [longRun, 'e-run']]) {
    const html = ui.timedTrackHTML(p, l, longClock);
    assert.match(html, /class="dm-bar"/);
    assert.match(html, new RegExp(`class="st dm dm-face has-end ${cls}"`));
    assert.doesNotMatch(html, /dm-end/);
  }

  // Open question on an agent Work adds .dm-q (?) inside .dm-face and extends .dm-wait past the ring.
  const askedLine = mkWork('asked', 'wait', 'codex', 40, 43, { line:{ asking:{ questions:[{ text:'Which?' }] } } });
  const askClock = ui.dayClock('2026-11-14', [askedLine], now, 360);
  const askedTimed = ui.timedTrackHTML(p, askedLine, askClock);
  assert.match(askedTimed, /class="st dm dm-face has-end e-you is-asked"/);
  assert.match(askedTimed, /<b class="dm-q">\?<\/b>/);
  assert.match(askedTimed, /class="dm-wait"/);
  assert.doesNotMatch(askedTimed, /dm-end/);
  assert.match(ui.evenTrackHTML(p, askedLine, 360), /class="st dm dm-face has-end e-you is-asked"/);

  // Fallbacks keep standalone .dm-end when the line ends on a non-agent step or has no visible agent circle.
  const trailingNote = mkWork('note-after', 'ready', 'claude', 30, 34, { stations:[{ id:'n1', kind:'note', when:fmt(t0 + 60 * 60000) }] });
  const noAgentWork = { id:'no-agent', state:'ready', stations:[{ id:'a1', kind:'ask', when:fmt(t0 + 20 * 60000) }, { id:'w1', kind:'work', state:'done', startedAt:t0 + 22 * 60000, endedAt:t0 + 25 * 60000 }] };
  const yesterdayRun = { id:'old-run', state:'working', stations:[{ id:'w1', kind:'work', agent:'claude', state:'active', startedAt:t0 - 86400000 }] };
  const unsentOnly = { id:'unsent', state:'notes', stations:[{ id:'a1', kind:'ask', unsent:true, when:fmt(t0 + 25 * 60000) }] };
  const fbClock = ui.dayClock('2026-11-14', [trailingNote, noAgentWork, yesterdayRun, unsentOnly], now, 360);
  for (const l of [trailingNote, noAgentWork]) {
    assert.match(ui.timedTrackHTML(p, l, fbClock), /dm-end e-review/);
    assert.match(ui.evenTrackHTML(p, l, 360), /dm-end e-review/);
  }
  assert.match(ui.timedTrackHTML(p, yesterdayRun, fbClock), /dm-end e-run/);
  assert.doesNotMatch(ui.timedTrackHTML(p, trailingNote, fbClock), /dm-face has-end/);
  assert.doesNotMatch(ui.timedTrackHTML(p, unsentOnly, fbClock), /dm-end|has-end/);
});

test('resetHomeFilters clears status, text, expansions and scroll back to default', () => {
  const filterBox = { value:'marzipan' }, view = { scrollTop:320 };
  let updated = 0, deskRefreshed = 0, stored = '{}';
  const p = { id:'p1' }, homeTop = { p1:320, other:90 };
  const context = vm.createContext({
    localStorage:{ getItem:() => stored, setItem:(_k, v) => { stored = v; } },
    $:(sel) => sel === '#homeFilter' ? filterBox : sel === '#view' ? view : null,
    $$:() => [],
    project:() => p,
    homeTop,
    refreshDesk:() => { deskRefreshed++; },
    lineState:status.lineState, lineNeedsYou:status.lineNeedsYou, isTodo:status.isTodo, toReview:status.toReview, toLookAt:status.toLookAt, isWork:status.isWork,
    ACT:{}, S:{ plan:[] }, document:{ addEventListener:() => {} }, esc, ic:() => '',
  });
  vm.runInContext(source, context);
  vm.runInContext('Object.assign(globalThis, { Pano, mapFilter, homeChoice });', context);
  context.Pano.update = () => { updated++; };
  context.setHomeChoice(p, { f:'review', needsFolded:true });
  context.Pano.kept.p1 = new Set(['a']);
  context.Pano.words.p1 = 'marzipan';
  context.Pano.whole.p1 = true;
  context.Pano.dayOpen.p1 = new Set(['2026-11-14']);
  context.Pano.opened.p1 = 'a';
  context.resetHomeFilters();

  assert.equal(context.mapFilter(p), '');
  assert.equal(context.homeChoice(p).needsFolded, true);
  for (const key of ['kept', 'words', 'whole', 'dayOpen', 'opened']) {
    assert.equal(context.Pano[key].p1, undefined, `Pano.${key} should be cleared`);
  }
  assert.equal(filterBox.value, '');
  assert.equal(view.scrollTop, 0);
  assert.equal(homeTop.p1, 0);
  assert.equal(homeTop.other, 90);
  assert.equal(updated, 1);
  assert.equal(deskRefreshed, 1);
});

test('clicking the current project in the left panel resets filters only when already on its home page', () => {
  const pagesSource = fs.readFileSync(path.join(__dirname, '../public/lines/pages.js'), 'utf8');
  const handler = pagesSource.slice(pagesSource.indexOf("ACT['switch-project']"), pagesSource.indexOf("// New project is a page:"));
  let goes = [], resets = 0, switched = [];
  const context = vm.createContext({
    ACT:{},
    S:{ cur:'p1', newPage:false, shelfPage:false, route:{ view:'home' } },
    summaryOf:id => ({ id }),
    go:route => goes.push(route),
    resetHomeFilters:() => { resets++; },
    switchProject:(id, opts) => switched.push([id, opts]),
  });
  vm.runInContext(handler, context);

  // On project home page -> clicking project in left panel resets filters.
  context.ACT['switch-project']({ dataset:{ p:'p1' } });
  assert.equal(resets, 1);
  assert.equal(goes.length, 0);

  // On another route of the same project -> navigates to home without resetting filters.
  context.S.route = { view:'line', line:'one' };
  context.ACT['switch-project']({ dataset:{ p:'p1' } });
  assert.equal(resets, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(goes)), [{ view:'home' }]);

  // On New project or a shelf page -> navigates to home without resetting filters.
  context.S.route = { view:'home' };
  context.S.newPage = true;
  context.ACT['switch-project']({ dataset:{ p:'p1' } });
  context.S.newPage = false; context.S.shelfPage = 'settings';
  context.ACT['switch-project']({ dataset:{ p:'p1' } });
  assert.equal(resets, 1);
  assert.equal(goes.length, 3);

  // Clicking a different project switches to it.
  context.S.shelfPage = false;
  context.ACT['switch-project']({ dataset:{ p:'p2' } });
  assert.equal(switched.length, 1);
  assert.equal(switched[0][0], 'p2');
});

test('My order tab and drag grips are removed and saved lineSort=mine falls back to By time', () => {
  const ui = filters();
  const p = {
    id:'p',
    lineSort:'mine',
    lineOrder:['older', 'newer'],
    lines:[
      line('older', 'ready', [work(true)], { at:100 }),
      line('newer', 'notes', [{ kind:'note' }], { at:200 }),
    ],
  };
  assert.deepEqual(Array.from(ui.shownLines(p), l => l.id), ['newer', 'older']);
  assert.doesNotMatch(source, /pano-sort|lines-sort|hl-grip|data-drag|>My order</);
});

test('Home renders spawned Lines once, inside their session, across days, filters and the first page boundary', () => {
  const { document } = require('./helpers/dom.js').parseHTML('<html><body><div id="panoResults"></div><section id="rows"></section></body></html>');
  const now = new Date(2026, 10, 18, 12).getTime(), ui = trackUI(now);
  const make = (id, at, extra = {}) => line(id, 'notes', [{ id:'n1', kind:'note', text:'A note' }], { lastActivityAt:at, ...extra });
  const parent = make('job', now - 86400000, { orchestratorRef:'PE-622' });
  const child = make('backend', now - 60000, { orchestratedBy:'PE-622', state:'error' });
  const sibling = make('navigation', now - 86400000, { orchestratedBy:'PE-622' });
  const unrelated = make('ordinary', now - 100000000);
  const latest = Array.from({ length:39 }, (_, i) => make('new-' + i, now - i));
  const p = { id:'p', lines:[...latest, unrelated, sibling, parent, child], landed:[], backlog:[], trunk:'main' };
  const $ = (selector, root = document) => root.querySelector(selector);
  Object.assign(ui, {
    document, $, CSS:{ escape:String }, allLines:p => [...p.lines, ...p.landed, ...p.backlog],
    project:() => p, lineState:l => l.state || status.lineState(l), toLookAt:status.toLookAt,
    working:() => 0, lineNeedsYou:status.lineNeedsYou, toReview:status.toReview, canReview:status.canReview, isPinned:() => false, topicFilter:() => '',
    lineHintTag:() => '', lineHintClass:() => '', shortWhen:at => new Date(at).toLocaleDateString(),
    plural:(n, one, many) => n + ' ' + (n === 1 ? one : many),
  });
  const pano = vm.runInContext('Pano', ui);
  pano.el = document.body;
  pano.sheet = pano.rowsEl = $('#rows');
  const render = () => pano.update();
  let openedLine;
  ui.go = route => { openedLine = route.line; };
  vm.runInContext(lineSource.slice(lineSource.indexOf("ACT['open-line'] ="), lineSource.indexOf("ACT['open-step'] =")), ui);
  document.addEventListener('click', e => {
    const button = e.target.closest('[data-act]');
    if (button) ui.ACT[button.dataset.act](button);
  });
  const fold = () => $('[data-act="session-fold"]').click();
  const rows = el => Array.from(el.querySelectorAll('[data-row]'), r => r.dataset.row);
  render();
  assert.deepEqual(rows($('#subs-job')), ['backend', 'navigation']);
  assert.equal($('#subs-job').previousElementSibling.dataset.row, 'job');
  assert.equal($('[data-row="backend"] .hl-state').textContent, 'Stopped');
  $('[data-row="backend"] .hl-main').click();
  assert.equal(openedLine, 'backend');
  assert.ok($('[data-row="job"] time.hl-session-date'));
  assert.equal(rows(document).length, new Set(rows(document)).size);
  assert.match($('.hl-foot').textContent, /1 earlier line/);
  fold();
  assert.equal($('[data-act="session-fold"]').getAttribute('aria-expanded'), 'false');
  assert.equal(rows($('#subs-job')).length, 0);
  render();
  assert.equal($('#subs-job').hidden, true);
  fold();
  assert.equal(rows($('#subs-job')).length, 2);
  ui.ACT['map-filter']({ dataset:{ f:'stopped' } });
  assert.deepEqual(rows(document), ['job', 'backend']);
  assert.ok($('[data-row="job"].hl-session-context'));
  assert.match($('#panoResults').textContent, /Stopped · 1 line\b/);
  pano.words.p = 'navigation';
  ui.ACT['map-filter']({ dataset:{ f:'stopped' } });
  assert.deepEqual(rows(document), ['job', 'navigation']);
  assert.equal($('[data-act="session-fold"]').getAttribute('aria-expanded'), 'true');
  // Neither an archived parent nor an ambiguous legacy reference absorbs a visible Line.
  p.landed.push({ id:'duplicate', archived:true, orchestratorRef:'PE-622' });
  render();
  assert.deepEqual(rows(document), ['navigation']);
  p.lines = p.lines.filter(l => l !== parent);
  render();
  assert.deepEqual(rows(document), ['navigation']);
});

test('Home filter matches job IDs on the Line itself and on spawned sub-Lines, including under To review', () => {
  const { document } = require('./helpers/dom.js').parseHTML('<html><body><div id="panoResults"></div><section id="rows"></section></body></html>');
  const now = new Date(2026, 10, 20, 6, 30).getTime(), ui = trackUI(now);
  const make = (id, at, stations, extra = {}) => line(id, 'done', stations, { lastActivityAt:at, ...extra });
  const job = make('fix-waiting', now - 120000, [{ id:'a1', kind:'ask', text:'the sub worker finished' }, work(true)], { code:'PE-775', orchestratorRef:'PE-775', title:'Fix waiting orchestrator premature exit' });
  const sub = make('check-watchdog', now - 60000, [{ id:'a1', kind:'ask', text:'Review watchdog parser' }, work(false)], { code:'PE-779', orchestratedBy:'PE-775', title:'Check watchdog transcript task detection', state:'ready', reviewed:false });
  const other = make('meetcue-port', now - 30000, [{ id:'a1', kind:'ask', text:'Port diagram rendering' }, work(false)], { code:'PE-795', orchestratedBy:'PE-793', title:'Port MeetCue diagram rendering', state:'ready', reviewed:false });
  const p = { id:'p', lines:[other, sub, job], landed:[], backlog:[], trunk:'main' };
  const $ = (selector, root = document) => root.querySelector(selector);
  Object.assign(ui, {
    document, $, CSS:{ escape:String }, allLines:p => [...p.lines, ...p.landed, ...p.backlog],
    project:() => p, lineState:l => l.state || status.lineState(l), toLookAt:status.toLookAt,
    working:() => 0, lineNeedsYou:status.lineNeedsYou, toReview:l => l.state === 'ready' && !l.reviewed, canReview:status.canReview, isPinned:() => false, topicFilter:() => '',
    lineReviewed:status.lineReviewed, STATE_TEXT:{ reviewed:'Reviewed', ready:'Finished' },
    lineHintTag:() => '', lineHintClass:() => '', shortWhen:at => new Date(at).toLocaleDateString(),
    plural:(n, one, many) => n + ' ' + (n === 1 ? one : many),
  });
  const pano = vm.runInContext('Pano', ui);
  pano.el = document.body;
  pano.sheet = pano.rowsEl = $('#rows');
  const rows = () => Array.from(document.querySelectorAll('[data-row]'), r => r.dataset.row);

  // Lowercase job ID matches parent PE-775 and its spawned sub-Line PE-779.
  pano.words.p = 'pe-775';
  pano.update();
  assert.deepEqual(rows(), ['fix-waiting', 'check-watchdog']);

  // Uppercase with surrounding whitespace and numeric suffix also match.
  pano.words.p = '  PE-795 ';
  pano.update();
  assert.deepEqual(rows(), ['meetcue-port']);
  pano.words.p = '779';
  pano.update();
  assert.deepEqual(rows(), ['fix-waiting', 'check-watchdog']);

  // With To review active (where PE-775 itself is reviewed but its sub-Line PE-779 is To review),
  // filtering by pe-775 still surfaces PE-779 grouped under PE-775.
  ui.ACT['map-filter']({ dataset:{ f:'review' } });
  pano.words.p = 'pe-775';
  pano.update();
  assert.deepEqual(rows(), ['fix-waiting', 'check-watchdog']);
  assert.ok($('[data-row="fix-waiting"].hl-session-context'));
  assert.match($('#panoResults').textContent, /To review · 1 line\b/);
});
