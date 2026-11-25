'use strict';
// The sidebar (PE-399): every project opens on its newest Lines, each with its status sign; pinned lines of all projects are together at the top.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { parseHTML } = require('./helpers/dom.js');

const read = name => fs.readFileSync(path.join(__dirname, '..', 'public', 'lines', name), 'utf8');
const pages = read('pages.js');
const railSource = pages.slice(pages.indexOf('const RAIL_LINES ='), pages.indexOf("ACT['rail-new-line']"));
const esc = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const MIN = 60e3, NOW = Date.now();
// A line as the project's own page has it: `at` is minutes ago.
const line = (id, extra = {}) => ({ id, title:id, status:'notes', ago:0, ...extra });
// A line as the server's list has it, for a project that is not on screen.
const listed = (id, extra = {}) => ({ id, title:id, shown:'notes', ago:0, ...extra });
const at = ago => NOW - ago * MIN;
function rail({ lines = [], others = [], route = { view:'home' }, embed = null, choice = {}, reads = {}, positions = {}, deleted = [], landed = [], backlog = [], shown = null, storage = new Map(), hosted = false } = {}) {
  const mine = { id:'mine', name:'Mine', lastOpenedAt:3, lines:[] };
  const withDates = list => list.map(l => ({ ...l, createdAt:at(l.ago), at:at(l.ago) }));
  const full = { id:'mine', name:'Mine', lines:withDates(lines), landed:withDates(landed), backlog:withDates(backlog), deleted:{ lines:deleted } };
  const projects = [mine, ...others.map(([id, name, list, opened = 0, extra = {}]) => ({ id, name, lastOpenedAt:opened, ...extra, lines:list.map(l => ({ ...l, createdAt:at(l.ago), at:at(l.ago) })) }))];
  const writes = [], events = {};
  const context = vm.createContext({
    localStorage:{ getItem:key => storage.get(key) ?? null, setItem:(key, value) => storage.set(key, value) }, addEventListener:(key, listener) => { events[key] = listener; },
    LINE_ORDER_KEY:'penecho-rail-line-positions-v1', railLinePositions:positions,
    S:{ cur:'mine', route, projects, newPage:false, shelfPage:false }, EMBED:embed, HOSTED:hosted, project:() => full, Date, Object, Set, Array, Boolean, String,
    linePins:p => [...p.lines, ...p.backlog, ...p.landed].filter(l => l.pinned).map(l => l.id), rowFacts:l => ({ at:l.at }), lineUnread:(_p, l) => Boolean(l.unread),
    needsLook:(_p, l) => l.status === 'waiting', shownState:shown || (l => ({ notes:'notes', working:'working', waiting:'wait', ready:'review', done:'landed', closed:'landed', landed:'landed' }[l.status] || l.status)),
    lineReads:reads, STATE_TEXT:{ notes:'Notes', working:'Working', wait:'Needs you', review:'To review', todo:'Todo', error:'Stopped' },
    railChoice:choice, RAIL_KEY:'penecho-rail-open-v1',
    readLists:key => key.includes('line-positions') ? positions : JSON.parse(storage.get(key) || '{}'),
    writeLists:(key, value) => { writes.push([key, value]); storage.set(key, JSON.stringify(value)); },
    renderRail:() => { context.rendered = true; },
    summaryOf:id => projects.find(p => p.id === id), railOrder:() => projects, ACT:{},
    glyph:p => `<b class="pglyph">${p.name[0]}</b>`, esc, ic:(name = '', size = 18) => `<svg data-icon="${name}" width="${size}" height="${size}"></svg>`,
  });
  vm.runInContext(railSource, context);
  const toggleMore = (p = mine) => {
    const expanded = /class="rail-more"[^>]*aria-expanded="(true|false)"/.exec(context.railLines(p));
    assert.ok(expanded, 'the list length button is available');
    context.ACT['rail-more']({ dataset:{ p:p.id }, getAttribute:name => name === 'aria-expanded' ? expanded[1] : null });
  };
  return { full, context, projects, writes, events, mine, toggleMore, html:() => context.railLines(mine), pins:() => context.railPinned(), isOpen:id => vm.runInContext(`railIsOpen(summaryOf(${JSON.stringify(id)}))`, context) };
}
const titles = html => [...html.matchAll(/class="rail-title">([^<]*)</g)].map(m => m[1]);
const ids = html => [...html.matchAll(/data-line="([^"]+)"/g)].map(m => m[1]);
const SUBS_KEY = 'penecho-rail-subs-open-v1';
const key = (id, pid = 'mine') => JSON.stringify([pid, id]);
const parent = (id, extra) => line(id, { orchestratorRef:id, ...extra });
const child = (id, ref, extra) => line(id, { orchestratedBy:ref, ...extra });
const picked = ui => ui.context.railPick(ui.mine);
const members = rows => Array.from(rows, f => f.id);

test('families use direct refs and creation order with the same tree for active and background projects', () => {
  const lines = [child('later', 'family', { ago:3 }), parent('family', { ago:2 }), child('earlier', 'family', { ago:1 }), line('plain')];
  const ui = rail({ lines, others:[['other', 'Other', lines.map(l => ({ ...l, shown:'notes' }))]] });
  for (const p of ui.projects) {
    const pick = ui.context.railPick(p);
    assert.deepEqual(members(pick.rest), ['plain', 'family']);
    assert.deepEqual(members(pick.byId.get('family').children), ['earlier', 'later']);
    assert.match(ui.context.railLines(p), /aria-expanded="false" aria-controls="rail-subs-/);
    assert.match(ui.context.railLines(p), /class="rail-sub-count"[^>]*>2</);
  }
});

test('five roots keep a selected nested child and its family visible, including on Canvas', () => {
  const lines = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, ago) => line(id, { ago }));
  lines.push(parent('root', { ago:7 }), parent('nested', { orchestratedBy:'root', ago:1 }), child('leaf', 'nested'), child('sibling', 'root', { ago:2 }));
  const storage = new Map([[SUBS_KEY, JSON.stringify({ [key('root')]:false, [key('nested')]:false })]]);
  for (const selection of [{ route:{ view:'line', line:'leaf' } }, { embed:{ rail:true, project:'mine', line:'leaf' } }]) {
    const ui = rail({ lines, storage, ...selection });
    assert.deepEqual(members(picked(ui).shown), ['a', 'b', 'c', 'd', 'e', 'root']);
    assert.deepEqual(ids(ui.html()), ['a', 'b', 'c', 'd', 'e', 'root', 'nested', 'leaf', 'sibling']);
    assert.match(ui.html(), /data-line="leaf"[^>]*aria-current="page"/);
    assert.match(ui.html(), /1 more top-level Lines or orchestrator groups/);
    assert.equal(ui.writes.length, 0);
  }
  assert.deepEqual(JSON.parse(storage.get(SUBS_KEY)), { [key('root')]:false, [key('nested')]:false });
});

test('manual fold wins over changing status and selected parents, survives reload and listens to other tabs', () => {
  const lines = [parent('root'), child('leaf', 'root', { status:'working' })];
  const storage = new Map([[SUBS_KEY, JSON.stringify({ [key('dormant')]:true })]]);
  const ui = rail({ lines, storage });
  assert.equal(picked(ui).byId.get('root').open, true);
  const toggle = expanded => ui.context.ACT['rail-subs-fold']({ dataset:{ railParent:key('root') }, getAttribute:() => String(expanded) });
  toggle(true);
  ui.full.lines[1].status = 'waiting';
  assert.equal(picked(ui).byId.get('root').open, false);
  assert.equal(picked(rail({ lines, storage, route:{ view:'line', line:'root' } })).byId.get('root').open, false);
  assert.deepEqual(JSON.parse(storage.get(SUBS_KEY)), { [key('dormant')]:true, [key('root')]:false });
  storage.set(SUBS_KEY, JSON.stringify({ [key('root')]:true }));
  ui.events.storage({ key:SUBS_KEY });
  assert.equal(picked(ui).byId.get('root').open, true);
  assert.equal(ui.writes.length, 1);
  assert.equal(ui.context.rendered, true);
  storage.clear();
  ui.events.storage({ key:null });
  ui.full.lines[1].status = 'review';
  assert.equal(picked(ui).byId.get('root').open, false, 'review does not auto-expand a quiet family');
});

test('collapsed parent counts visible direct children and rolls up all visible descendants by priority', () => {
  const lines = [parent('root'), parent('nested', { orchestratedBy:'root' }), child('needs', 'nested', { status:'waiting' }),
    child('stopped', 'nested', { status:'error' }), child('working', 'root', { status:'working' }), child('review', 'root', { status:'review' }),
    child('hidden', 'root', { archived:true, status:'waiting' })];
  const storage = new Map([[SUBS_KEY, JSON.stringify({ [key('root')]:false })]]);
  const ui = rail({ lines, storage });
  const mark = () => ui.html().match(/<i class="([^"]+)" aria-hidden="true"/)?.[1];
  assert.match(ui.html(), /3 sub-Lines, 1 awaiting reply, 1 stopped, 1 working, 1 to review/);
  assert.equal(mark(), 'rail-sign s-need');
  for (const [removed, expected] of [['needs', 'rail-sign s-bad'], ['stopped', 'spin'], ['working', 'rail-sign s-new'], ['review', undefined]]) {
    ui.full.lines = ui.full.lines.filter(l => l.id !== removed);
    assert.equal(mark(), expected);
  }
  ui.full.lines = ui.full.lines.filter(l => l.id !== 'nested');
  assert.doesNotMatch(ui.html(), /rail-disclosure|rail-sub-count|rail-sub-lines/);
});

test('reviewed, archived, deleted, missing, ambiguous, and cyclic parents keep eligible children once', () => {
  const lines = [
    parent('reviewed', { status:'ready' }), parent('deleted'), parent('duplicate'),
    child('reviewed-child', 'reviewed'), child('archived-child', 'archived'), child('deleted-child', 'deleted'), child('missing-child', 'missing'),
    child('ambiguous-child', 'duplicate'), parent('cycle-a', { orchestratedBy:'cycle-b' }), parent('cycle-b', { orchestratedBy:'cycle-a' }),
    parent('self', { orchestratedBy:'self' }), child('missing-child', 'missing'),
  ];
  const ui = rail({ lines, shown:l => l.status, deleted:[{ id:'deleted' }], landed:[parent('archived', { archived:true }), parent('old-duplicate', { orchestratorRef:'duplicate', archived:true })] });
  const { byId } = picked(ui);
  assert.equal(byId.size, 9);
  for (const [id, reason] of [
    ['reviewed-child', /reviewed/], ['archived-child', /archived/], ['deleted-child', /deleted/], ['missing-child', /not in this project/],
    ['ambiguous-child', /ambiguous/], ['cycle-a', /cyclic/], ['cycle-b', /cyclic/], ['self', /cyclic/],
  ]) {
    assert.ok(!byId.get(id).parent);
    assert.match(byId.get(id).orphan, reason);
  }
  ui.toggleMore();
  assert.equal(ids(ui.html()).length, 9);
  assert.equal(new Set(ids(ui.html())).size, 9);
  assert.match(ui.html(), /Sub-Line of missing \(parent not in this project\)/);
});

test('pinned ancestors carry their descendants while independently pinned children move once and return on unpin', () => {
  const lines = [parent('pin', { pinned:true }), parent('nested', { orchestratedBy:'pin' }), child('nested-child', 'nested', { pinned:true, status:'working' }),
    parent('ordinary'), child('loose', 'ordinary', { pinned:true }), child('stays', 'ordinary', { status:'working' })];
  const ui = rail({ lines });
  assert.deepEqual(ids(ui.pins()), ['loose', 'pin', 'nested', 'nested-child']);
  assert.deepEqual(ids(ui.html()), ['ordinary', 'stays']);
  assert.match(ui.pins(), /pinned separately from ordinary/);
  ui.full.lines.find(l => l.id === 'loose').pinned = false;
  assert.deepEqual(ids(ui.html()), ['ordinary', 'loose', 'stays']);
  assert.deepEqual(ids(ui.pins()), ['pin', 'nested', 'nested-child']);
});

test('deep groups keep their ancestry and retain row and disclosure elements through a sibling change', () => {
  const lines = Array.from({ length:5 }, (_, i) => parent(`parent-${i}`, { orchestratedBy:i ? `parent-${i - 1}` : '' }));
  lines.push(child('leaf', 'parent-4'));
  const ui = rail({ lines, route:{ view:'line', line:'leaf' } });
  const { document } = parseHTML('<body><nav id="railList"></nav></body>');
  const host = document.getElementById('railList'), draft = document.createElement('div');
  host.innerHTML = ui.html();
  const leaf = host.querySelector('[data-line="leaf"]');
  const disclosure = host.querySelector('[data-line="parent-4"]').previousElementSibling;
  assert.equal(host.querySelectorAll('[role="group"]').length, 5);
  assert.equal(leaf.parentElement.style.getPropertyValue('--rail-depth'), '3');
  assert.equal(document.getElementById(disclosure.getAttribute('aria-controls')).contains(leaf), true);
  ui.full.lines.push(child('new-sibling', 'parent-4', { createdAt:NOW + MIN }));
  ui.full.lines.at(-2).title = 'Updated leaf';
  draft.innerHTML = ui.html();
  vm.runInContext(pages.slice(pages.indexOf('// Keep keyed controls'), pages.indexOf('// ---------- The sidebar between pages')), ui.context);
  ui.context.railMorphChildren(host, draft);
  assert.strictEqual(host.querySelector('[data-line="leaf"]'), leaf);
  assert.strictEqual(host.querySelector('[data-line="parent-4"]').previousElementSibling, disclosure);
  assert.equal(leaf.querySelector('.rail-title').textContent, 'Updated leaf');
});

test('a project lists five lines by creation date, and says how many more there are', () => {
  const ui = rail({ lines:['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id, i) => line(id, { ago:10 + i * 10 })).reverse() });
  const html = ui.html();
  assert.deepEqual(ids(html), ['a', 'b', 'c', 'd', 'e']);
  assert.match(html, /aria-expanded="false" data-p="mine">2 more</);
  assert.match(html, /Lines in Mine/);
});

test('the line on screen stays listed even when it is older than the newest five', () => {
  const lines = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id, i) => line(id, { ago:10 + i * 10 }));
  const ui = rail({ lines, route:{ view:'line', line:'g' } });
  assert.deepEqual(ids(ui.html()), ['a', 'b', 'c', 'd', 'e', 'g']);
  assert.match(ui.html(), /class="rail-line on[^"]*"[^>]*data-line="g"[^>]*aria-current="page"/);
  // Beside a Canvas the line of that Canvas is the one on screen.
  const embedded = rail({ lines, embed:{ rail:true, project:'mine', line:'f' } });
  assert.deepEqual(ids(embedded.html()), ['a', 'b', 'c', 'd', 'e', 'f']);
});

test('Show more survives a smaller list, a reload and a change in recent projects until Show fewer', () => {
  const lines = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id, i) => line(id, { ago:i + 1 }));
  const opts = { lines, others:[['b', 'B', lines, 9], ['c', 'C', [], 8], ['d', 'D', [], 7]], storage:new Map() };
  const ui = rail(opts);
  ui.toggleMore();
  const removed = ui.full.lines.splice(3);
  assert.deepEqual(ids(ui.html()), ['a', 'b', 'c']);
  ui.full.lines.push(...removed);
  assert.equal(ids(ui.html()).length, 7);
  const next = rail(opts);
  assert.match(next.html(), /aria-expanded="true" data-p="mine">Show fewer</);
  next.context.S.cur = 'b';
  assert.ok(next.isOpen('mine'), 'an expanded project stays visible outside the three most recently opened');
  assert.equal(ids(next.context.railLines(next.projects[1])).length, 5, 'unrelated projects retain their own limit');
  next.context.ACT['rail-fold']({ dataset:{ p:'mine' } });
  assert.equal(next.isOpen('mine'), false);
  next.context.ACT['rail-fold']({ dataset:{ p:'mine' } });
  next.context.S.cur = 'mine';
  assert.equal(ids(next.html()).length, 7);
  next.toggleMore();
  assert.equal(ids(rail(opts).html()).length, 5);
});

test('another project lists its lines from the server list, with the same signs', () => {
  const ui = rail({ others:[['other', 'Other', [
    listed('work', { shown:'working', ago:5 }), listed('ask', { shown:'wait', ago:6 }), listed('new', { readRevision:'r2', ago:7 }), listed('seen', { readRevision:'r1', ago:8 }), listed('stopped', { shown:'error', ago:9 }), listed('plain', { ago:10 }),
  ]]], reads:{ 'other:seen':'r1', 'other:plain':'' } });
  const other = ui.projects[1], html = ui.context.railLines(other);
  assert.deepEqual(ids(html), ['work', 'ask', 'new', 'seen', 'stopped']);
  assert.match(html, /data-line="work"[^>]*>[^]*?<i class="spin"/);
  assert.match(html, /data-line="ask"[^>]*>[^]*?rail-sign s-need/);
  assert.match(html, /data-line="stopped"[^>]*>[^]*?rail-sign s-bad/);
  // New to this browser: its revision is not the one it has read. Only a line that has something to say shows it.
  assert.doesNotMatch(html.slice(html.indexOf('data-line="new"'), html.indexOf('data-line="seen"')), /rail-sign/);
  assert.match(html, /data-line="work"[^>]*data-rail-group="working" data-p="other"/);
});

test('a line that is new to you and waiting, working or to review shows a violet sign', () => {
  const ui = rail({ others:[['other', 'Other', [listed('new', { shown:'review', readRevision:'r2', ago:3 }), listed('old', { shown:'review', readRevision:'r1', ago:4 })]]], reads:{ 'other:old':'r1' } });
  const html = ui.context.railLines(ui.projects[1]);
  assert.match(html.slice(html.indexOf('data-line="new"'), html.indexOf('data-line="old"')), /rail-sign s-new/);
  assert.doesNotMatch(html.slice(html.indexOf('data-line="old"')), /rail-sign/);
  assert.match(html, /class="rail-line  unread"/);
});

test('an example nobody has opened has nothing new in it', () => {
  const lines = [listed('a', { shown:'review', readRevision:'r1', ago:5 }), listed('b', { shown:'wait', readRevision:'r1', ago:6 })];
  const ui = rail({ others:[['ex', 'Example', lines, 0, { example:'weather' }]] });
  assert.doesNotMatch(ui.context.railLines(ui.projects[1]), /unread|s-new/);
  // Once this browser has read something in it, it is a project like any other.
  const touched = rail({ others:[['ex', 'Example', lines, 0, { example:'weather' }]], reads:{ 'ex:other':'r0' } });
  assert.match(touched.context.railLines(touched.projects[1]), /class="rail-line  unread"/);
});

test('pinned lines of every project are together under Pinned, each once, with no project icon and their project in the tooltip', () => {
  const ui = rail({ lines:[line('a', { ago:1 }), line('p1', { pinned:true, ago:900 })], others:[['other', 'Other', [listed('p2', { pinned:true, ago:30 }), listed('b', { ago:20 })]]] });
  const pins = ui.pins();
  assert.deepEqual(ids(pins), ['p2', 'p1']);
  assert.match(pins, /<div class="rail-sec">Pinned<\/div>/);
  assert.doesNotMatch(pins, /Projects/);
  assert.doesNotMatch(pins, /pglyph/);
  assert.match(pins, /title="p2 — Other/);
  assert.doesNotMatch(ui.html(), /data-line="p1"/);
  assert.doesNotMatch(ui.context.railLines(ui.projects[1]), /data-line="p2"/);
  assert.equal(rail({ lines:[line('a')] }).pins(), '');
});

test('New project is a larger + in the sticky Projects header, revealed across the sidebar list', () => {
  const chromeSource = pages.slice(pages.indexOf('function chromeHTML()'), pages.indexOf('function tabStatus('));
  assert.doesNotMatch(chromeSource, /rail-new|data-act="new-project"/, 'New project is no longer rendered at the bottom of the rail');
  const ui = rail({ lines:[line('a')] });
  const headOff = ui.context.railProjectsHead();
  assert.match(headOff, /<div class="rail-sec rail-sec-projects"><span>Projects<\/span><button type="button" class="rail-new " data-act="new-project"  aria-label="New project" title="New project"><svg data-icon="plus" width="20" height="20"><\/svg><\/button><\/div>/);
  assert.doesNotMatch(headOff, /<span>New project<\/span>/, 'no visible "New project" text label inside the button');
  assert.doesNotMatch(headOff, /aria-current="page"/);
  ui.context.S.newPage = true;
  const headOn = ui.context.railProjectsHead();
  assert.match(headOn, /class="rail-new on" data-act="new-project" aria-current="page"/);
  assert.match(pages, /draft\.innerHTML = railPinned\(projects, picks\) \+ railProjectsHead\(\)/);
  const linesCss = read('lines.css');
  assert.match(linesCss, /\.rail-sec-projects\s*\{[^}]*justify-content:\s*space-between/);
  assert.match(linesCss, /\.rail-sec-projects\s*\{[^}]*position:\s*sticky;\s*top:\s*0/);
  assert.match(linesCss, /\.rail-new\s*\{[^}]*opacity:\s*0/);
  assert.match(linesCss, /\.rail-list:is\(:hover,\s*:has\(:focus-visible\)\)\s*\.rail-new,\s*\.rail-new\.on\s*\{\s*opacity:\s*1;\s*\}/);
  assert.match(linesCss, /@media \(hover: none\), \(pointer: coarse\)\s*\{\s*\.rail-new\s*\{\s*opacity:\s*1;\s*\}\s*\}/);
  const lineCss = read('line.css');
  assert.match(lineCss, /\.rail-sec:not\(\.rail-sec-projects\),\s*\.rail-sec-projects > span/);
  assert.match(lineCss, /@media \(max-width: 1100px\)[\s\S]*?\.rail-new\s*\{[^}]*opacity:\s*1/);
});

test('a project is folded by your choice, and otherwise open when it is on screen or among the three opened last', () => {
  const others = [['b', 'B', [], 9], ['c', 'C', [], 8], ['d', 'D', [], 7], ['e', 'E', [], 1]];   // the project on screen, and the three opened last: b, c and d
  const ui = rail({ others });
  assert.deepEqual(['mine', 'b', 'c', 'd', 'e'].map(ui.isOpen), [true, true, true, true, false]);
  const chosen = rail({ others, choice:{ mine:false, e:true } });
  assert.deepEqual(['mine', 'e'].map(chosen.isOpen), [false, true]);
  ui.context.ACT['rail-fold']({ dataset:{ p:'b' } });
  assert.equal(ui.writes.at(-1)[0], 'penecho-rail-open-v1');
  assert.equal(JSON.stringify(ui.writes.at(-1)[1]), '{"b":false}');
});

test('the project name in the sidebar opens a project unfolded, and on its home folds and unfolds it like the folder', () => {
  const ui = rail({ others:[['b', 'B', [], 0], ['c', 'C', [], 0]] }), { context } = ui, goes = [], switched = [];
  let narrow = false, resets = 0;
  Object.assign(context, { matchMedia:() => ({ matches:narrow }), go:r => goes.push(r), switchProject:id => switched.push(id), resetHomeFilters:() => { resets++; } });
  vm.runInContext(pages.slice(pages.indexOf("ACT['switch-project']"), pages.indexOf('// New project is a page:')), context);
  const click = (p, inRail = true) => context.ACT['switch-project']({ dataset:{ p }, closest:sel => (inRail && sel.includes('#railList') ? {} : null) });
  click('mine');
  assert.equal(ui.isOpen('mine'), false);
  assert.equal(resets, 1);
  click('mine');
  assert.equal(ui.isOpen('mine'), true);
  // Another project opens with its lines showing; the name never shuts one you are going to.
  click('b');
  assert.equal(ui.isOpen('b'), true);
  assert.deepEqual(switched, ['b']);
  // Away from the home it goes home, unfolded.
  context.railChoice.mine = false; context.S.route = { view:'line', line:'x' };
  click('mine');
  assert.equal(ui.isOpen('mine'), true);
  assert.deepEqual(JSON.parse(JSON.stringify(goes)), [{ view:'home' }]);
  // Not in the sidebar, or where only the icons fit, the click only opens.
  context.S.route = { view:'home' };
  click('mine', false); narrow = true; click('mine');
  assert.equal(ui.isOpen('mine'), true);
});

test('the line you are starting is listed first, empty, and a project with no lines lists none', () => {
  assert.equal(rail().html(), '');
  const starting = rail({ lines:[line('a')], route:{ view:'newline' } }).html();
  assert.match(starting, /rail-line on is-new/);
  assert.deepEqual(titles(starting), ['New line', 'a']);
  const away = rail({ route:{ view:'newline' } });
  away.context.S.cur = 'another-project';
  assert.equal(away.html(), '');
});

test('line and project names are escaped in content and accessible labels', () => {
  const ui = rail({ lines:[line('a"<b', { title:'A "title" <script>' })] });
  ui.mine.name = 'A "project"';
  const html = ui.html();
  assert.match(html, /data-line="a&quot;&lt;b"/);
  assert.match(html, /aria-label="A &quot;title&quot; &lt;script> — A &quot;project&quot; · Notes"/);
  assert.match(html, /Lines in A &quot;project&quot;/);
  assert.doesNotMatch(html, /<script>/);
});


test('drag positions survive reload, new arrivals, equal creation dates and changes to activity', () => {
  const lines = [line('a', { ago:1 }), line('b', { ago:1 }), line('c', { ago:2 }), line('d', { ago:3 })];
  const ui = rail({ lines, others:[['other', 'Other', [listed('d', { ago:4 }), listed('a', { ago:1 })]]] });
  ui.full.lines[2].at = NOW + MIN;
  ui.full.lines[2].status = 'working';
  assert.deepEqual(ids(ui.html()), ['a', 'b', 'c', 'd']);
  const rows = ui.context.railPick(ui.mine).rest;
  assert.ok(ui.context.moveRailLine(rows, rows[3].key, rows[1].key, false));
  assert.deepEqual(ids(ui.html()), ['a', 'd', 'b', 'c']);
  assert.deepEqual(ids(ui.context.railLines(ui.projects[1])), ['a', 'd']);
  assert.deepEqual(ui.full.lines.map(l => l.createdAt), lines.map(l => at(l.ago)));
  const restored = rail({ lines:[...lines, line('new', { ago:-1 })], positions:ui.writes.at(-1)[1] });
  assert.deepEqual(ids(restored.html()), ['new', 'a', 'd', 'b', 'c']);
  const same = restored.context.railPick(restored.mine).rest;
  assert.equal(restored.context.moveRailLine(same, same[2].key, same[1].key, true), false);
});

test('a drop between identical legacy ranks keeps both families intact', () => {
  const lines = [parent('a'), parent('b'), parent('c', { ago:1 }), child('leaf', 'c', { status:'working' })];
  const ui = rail({ lines });
  const rows = picked(ui).rest;
  assert.equal(ui.context.moveRailLine(rows, key('c'), key('b'), false), true);
  assert.deepEqual(ids(ui.html()), ['a', 'c', 'leaf', 'b']);
  assert.equal(Object.hasOwn(ui.writes.at(-1)[1], key('leaf')), false);
});

test('finished, archived and deleted lines are not shown in the sidebar while open, review, todo and notes rules stay the same even when pinned', () => {
  const LINE_STATUS = require('../public/lines/line-status.js');
  const work = (reviewed, extra = {}) => [{ kind:'ask', state:'done' }, { kind:'work', state:'done', reviewed, ...extra }];
  const ui = rail({
    shown:LINE_STATUS.shownState,
    route:{ view:'line', line:'done-here' },
    deleted:[{ slug:'gone-slug' }],
    // Archived lines come in the archived list; even a pinned one stays out of the sidebar.
    landed:[line('archived-pinned', { status:'closed', archived:true, closed:true, pinned:true, ago:0 }), line('archived-quiet', { status:'closed', archived:true, closed:true, ago:0 })],
    lines:[
      line('open-work', { status:'working', ago:1, stations:[{ kind:'ask', state:'done' }, { kind:'work', state:'active' }] }),
      line('open-wait', { status:'waiting', ago:2, stations:[{ kind:'ask', state:'done' }, { kind:'work', state:'wait' }] }),
      line('open-review', { status:'done', ago:3, unread:true, stations:work(false) }),
      line('open-todo', { status:'done', todo:true, ago:4, stations:work(true) }),
      line('open-notes', { status:'notes', ago:5, stations:[{ kind:'note', state:'done' }] }),
      line('reopened-notes', { status:'done', ago:6, stations:[{ kind:'note', state:'done' }] }),
      line('done-unsent', { status:'done', ago:7, stations:[...work(true), { kind:'ask', state:'todo', unsent:true }] }),
      line('done-here', { status:'done', ago:0, stations:work(true) }),
      line('done-ready', { status:'ready', ago:0, stations:work(true) }),
      line('done-pinned', { status:'done', pinned:true, ago:0, stations:work(true) }),
      line('archived-line', { status:'closed', archived:true, closed:true, ago:0, stations:work(false) }),
      line('deleted-flag', { status:'working', deleted:true, ago:0 }),
      line('gone-slug', { status:'working', ago:0 }),
    ],
    others:[['other', 'Other', [
      listed('o-review', { shown:'review', ago:1, stations:[{ kind:'ask' }, { kind:'work' }] }),
      listed('o-todo', { shown:'todo', ago:2, stations:[{ kind:'ask' }, { kind:'work' }] }),
      listed('o-done', { shown:'landed', ago:0, stations:[{ kind:'ask' }, { kind:'work' }] }),
      listed('o-ready', { shown:'ready', ago:0, stations:[{ kind:'ask' }, { kind:'work' }] }),
      listed('o-done-pin', { shown:'landed', pinned:true, ago:0, stations:[{ kind:'ask' }, { kind:'work' }] }),
      listed('o-archived', { shown:'review', archived:true, ago:0 }),
      listed('o-deleted', { shown:'working', deletedAt:Date.now(), ago:0 }),
    ], 0, { archivedPins:[listed('o-archived-pin', { shown:'landed', archived:true, pinned:true, at:at(0) })] }]],
  });
  // First 5 visible lines under mine; 2 more remain (reopened-notes and done-unsent), excluding all finished/archived/deleted lines.
  assert.deepEqual(ids(ui.html()), ['open-work', 'open-wait', 'open-review', 'open-todo', 'open-notes']);
  assert.match(ui.html(), /aria-expanded="false" data-p="mine">2 more</);
  ui.toggleMore();
  assert.deepEqual(ids(ui.html()), ['open-work', 'open-wait', 'open-review', 'open-todo', 'open-notes', 'reopened-notes', 'done-unsent']);
  assert.deepEqual(ids(ui.context.railLines(ui.projects[1])), ['o-review', 'o-todo']);
  assert.deepEqual(ids(ui.pins()), []);
});

test('background summary ambiguousOrchestratorRefs keeps children as orphans even when the duplicate landed parent is omitted', () => {
  const ui = rail({
    lines: [line('active', { ago: 1 })],
    others: [['bg', 'Background', [
      listed('bg-parent', { shown: 'wait', ago: 1, orchestratorRef: 'PE-584' }),
      listed('bg-child', { shown: 'wait', ago: 2, orchestratedBy: 'PE-584' }),
    ], 0]],
  });
  ui.projects[1].ambiguousOrchestratorRefs = ['PE-584'];
  const bgHtml = ui.context.railLines(ui.projects[1]);
  assert.doesNotMatch(bgHtml, /rail-sub-lines/);
  assert.match(bgHtml, /Sub-Line of PE-584 \(ambiguous parent ref\)/);
});

test('forced-open parent disclosure explains deferred folding while viewing a child and folds once navigating away', () => {
  const ui = rail({
    route: { view: 'line', line: 'child' },
    lines: [
      line('parent', { ago: 1, status: 'notes', orchestratorRef: 'PE-700' }),
      line('child', { ago: 2, status: 'notes', orchestratedBy: 'PE-700' }),
      line('other', { ago: 3, status: 'notes' }),
    ],
  });
  const firstHtml = ui.html();
  assert.match(firstHtml, /data-forced-open="1"/);
  assert.match(firstHtml, /Fold 1 sub-Line of parent after leaving the selected sub-Line/);
  // Clicking disclosure while forced open records collapsed preference, stays open while child is selected
  ui.context.ACT['rail-subs-fold']({
    dataset: { railParent: '["mine","parent"]', forcedOpen: '1' },
    getAttribute: () => 'true',
  });
  assert.equal(ui.writes.at(-1)[0], 'penecho-rail-subs-open-v1');
  assert.deepEqual({ ...ui.writes.at(-1)[1] }, { '["mine","parent"]': false });
  assert.match(ui.html(), /Keep 1 sub-Line of parent open after leaving the selected sub-Line/);
  assert.match(ui.html(), /data-line="child"/);
  // Leaving the child applies the saved collapsed preference
  ui.context.S.route = { view: 'line', line: 'other' };
  const afterLeave = ui.html();
  assert.match(afterLeave, /aria-expanded="false"/);
  assert.doesNotMatch(afterLeave, /data-line="child"/);
});

test('orchestrator parent disclosure uses the simple monochrome orchestrate icon whether expanded or collapsed', () => {
  const lines = [parent('orch', { ago: 1, status: 'working' }), child('sub', 'orch', { ago: 2, status: 'working' })];
  const openUi = rail({ lines });
  const openHtml = openUi.html();
  assert.match(openHtml, /class="rail-disclosure"[^>]*aria-expanded="true"[^>]*><svg data-icon="orchestrate" width="14" height="14"><\/svg><\/button>/);
  const closedUi = rail({ lines, storage: new Map([[SUBS_KEY, JSON.stringify({ [key('orch')]: false })]]) });
  const closedHtml = closedUi.html();
  assert.match(closedHtml, /class="rail-disclosure"[^>]*aria-expanded="false"[^>]*><svg data-icon="orchestrate" width="14" height="14"><\/svg><\/button>/);
});

test('clicking a collapsed or deferred-fold orchestrator job in the sidebar expands it without disturbing already-expanded or plain rows', () => {
  const lines = [
    parent('quiet', { ago: 1, status: 'notes' }),
    child('quiet-sub', 'quiet', { ago: 2, status: 'notes' }),
    parent('active', { ago: 3, status: 'working' }),
    child('active-sub', 'active', { ago: 4, status: 'working' }),
    line('plain', { ago: 5, status: 'notes' }),
  ];
  const storage = new Map([[SUBS_KEY, JSON.stringify({ [key('quiet')]: false })]]);
  const ui = rail({ lines, storage });
  const lineJs = read('line.js');
  const openLineSource = lineJs.slice(lineJs.indexOf("ACT['open-line'] ="), lineJs.indexOf("ACT['open-step'] ="));
  const opened = [];
  Object.assign(ui.context, {
    go: route => { ui.context.S.route = route; opened.push(route); },
    switchProject: (id, opts) => opened.push({ switchTo: id, ...opts }),
    lastProjectRoute: () => ({ view: 'home' }),
    lineById: () => null,
    lineOrchestratorOrigin: () => null,
    $: () => null,
  });
  vm.runInContext(openLineSource, ui.context);

  // 1. Clicking a manually collapsed parent row in the sidebar expands and saves open state.
  let doc = parseHTML(`<body>${ui.html()}</body>`).document;
  assert.equal(doc.querySelector('[data-line="quiet-sub"]'), null);
  ui.context.ACT['open-line'](doc.querySelector('[data-line="quiet"]'));
  assert.equal(picked(ui).byId.get('quiet').open, true);
  assert.equal(JSON.parse(storage.get(SUBS_KEY))[key('quiet')], true);
  assert.equal(opened.at(-1).line, 'quiet');

  // 2. Clicking a quiet (un-saved, auto-collapsed) parent row expands it too.
  storage.clear();
  ui.events.storage({ key: null });
  ui.context.S.route = { view: 'home' };
  doc = parseHTML(`<body>${ui.html()}</body>`).document;
  assert.equal(doc.querySelector('[data-line="quiet-sub"]'), null);
  ui.context.ACT['open-line'](doc.querySelector('[data-line="quiet"]'));
  assert.equal(picked(ui).byId.get('quiet').open, true);
  assert.equal(JSON.parse(storage.get(SUBS_KEY))[key('quiet')], true);

  // 3. Clicking an already-expanded status-aware parent row does not pin it open in storage.
  const writesBefore = ui.writes.length;
  doc = parseHTML(`<body>${ui.html()}</body>`).document;
  ui.context.ACT['open-line'](doc.querySelector('[data-line="active"]'));
  assert.equal(ui.writes.length, writesBefore);

  // 4. Clicking a plain row or leaf child never writes to railSubsOpen.
  ui.context.ACT['open-line'](doc.querySelector('[data-line="plain"]'));
  ui.context.ACT['open-line'](doc.querySelector('[data-line="active-sub"]'));
  assert.equal(ui.writes.length, writesBefore);

  // 5. Clicking a forced-open parent (deferred fold while viewing its child) cancels the fold so it stays expanded.
  ui.context.S.route = { view: 'line', line: 'quiet-sub' };
  storage.set(SUBS_KEY, JSON.stringify({ [key('quiet')]: false }));
  ui.events.storage({ key: SUBS_KEY });
  doc = parseHTML(`<body>${ui.html()}</body>`).document;
  assert.equal(doc.querySelector('[data-rail-parent][data-forced-open="1"]').getAttribute('aria-expanded'), 'true');
  ui.context.ACT['open-line'](doc.querySelector('[data-line="quiet"]'));
  assert.equal(picked(ui).byId.get('quiet').open, true);
  assert.equal(JSON.parse(storage.get(SUBS_KEY))[key('quiet')], true);

  // 6. Opening a manually-folded orchestrator job from outside the sidebar (e.g. Home/Orchestrator) also expands it.
  storage.set(SUBS_KEY, JSON.stringify({ [key('quiet')]: false }));
  ui.events.storage({ key: SUBS_KEY });
  ui.context.ACT['open-line']({ dataset: { line: 'quiet' } });
  assert.equal(picked(ui).byId.get('quiet').open, true);
  assert.equal(JSON.parse(storage.get(SUBS_KEY))[key('quiet')], true);
});
