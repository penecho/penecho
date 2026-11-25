'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { parseHTML } = require('./helpers/dom.js');
const read = name => fs.readFileSync(path.join(__dirname, '../public/lines', name), 'utf8');
function setup(saved = {}, failStorage = false) {
  const events = {}, documentEvents = {}, writes = [], S = { projects:[], cur:'r1' };
  for (let i = 1; i <= 3; i++) S.projects.push({ id:`p${i}`, name:`Pin ${i}`, pinned:true });
  for (let i = 1; i <= 9; i++) S.projects.push({ id:`r${i}`, name:`Recent ${i}`, lastOpenedAt:100 - i });
  S.projects.push({ id:'archive', archived:true }, { id:'canvases', myCanvases:true });
  const c = vm.createContext({ S, readLists:() => saved, writeLists:(_key, value) => { if (!failStorage) writes.push(JSON.parse(JSON.stringify(value))); },
    summaryOf:id => S.projects.find(p => p.id === id), document:{ addEventListener:(key, fn) => { documentEvents[key] = fn; } }, addEventListener:(key, fn) => { events[key] = fn; },
    renderRail:() => { c.rendered = true; }, clearTimeout:() => {}, cancelAnimationFrame:() => {},
  });
  vm.runInContext(read('project-order.js'), c);
  const pages = read('pages.js');
  vm.runInContext(pages.slice(pages.indexOf('function railGroups()'), pages.indexOf('// Under every project:')), c);
  const run = code => vm.runInContext(code, c), group = key => Array.from(run(`railGroups().${key}`), p => p.id);
  return { S, c, run, group, writes, events, documentEvents, move:(id, to, after = false) => c.moveRailProject(id, to, after) };
}
const unpinned = ['r1','r2','r3','r4','r5','r6','r7','r8','r9'];
test('first render saves every project in a stable order without an active-project cap', () => {
  const t = setup(); assert.deepEqual(t.group('pinned'), ['p1','p2','p3']);
  assert.deepEqual(t.group('recent'), unpinned);
  t.S.cur = 'r9'; assert.deepEqual(t.group('recent'), unpinned); assert.equal(t.writes.length, 2);
});
test('opening, server-side recency sorting, polling and reload never reorder the default list', () => {
  const t = setup(); assert.deepEqual(t.group('recent'), unpinned);
  t.S.projects.find(p => p.id === 'r9').lastOpenedAt = 999;
  t.S.cur = 'r9'; t.S.projects.sort((a,b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0));
  assert.deepEqual(t.group('recent'), unpinned);
  const reload = setup(t.writes.at(-1)); reload.S.projects.reverse();
  assert.deepEqual(reload.group('recent'), unpinned);
});
test('manual recent order survives opening an already visible project, refreshing and reload', () => {
  const t = setup(); assert.equal(t.move('r5', 'r1'), true);
  const expected = ['r5','r1','r2','r3','r4','r6','r7','r8','r9']; assert.deepEqual(t.group('recent'), expected);
  t.S.projects.find(p => p.id === 'r4').lastOpenedAt = 999; t.S.cur = 'r4';
  t.S.projects = t.S.projects.map(p => ({ ...p })); assert.deepEqual(t.group('recent'), expected);
  const saved = t.writes.at(-1); assert.equal(saved.recent.length, 9);
  const reload = setup(saved); reload.S.projects.find(p => p.id === 'r4').lastOpenedAt = 999;
  assert.deepEqual(reload.group('recent'), expected);
});
test('new projects append without displacing existing projects or their saved ranks', () => {
  const t = setup(); t.move('r5', 'r1'); t.S.cur = 'r9'; t.S.projects.find(p => p.id === 'r9').lastOpenedAt = 999;
  const expected = ['r5','r1','r2','r3','r4','r6','r7','r8','r9'];
  assert.deepEqual(t.group('recent'), expected);
  t.S.projects.unshift({ id:'new', lastOpenedAt:1000 });
  assert.deepEqual(t.group('recent'), [...expected,'new']);
});
test('pinned ordering is independent, with new pins at its end', () => {
  const t = setup(); t.move('p3', 'p1'); t.move('r3', 'r1');
  assert.deepEqual(t.group('pinned'), ['p3','p1','p2']); t.S.projects.find(p => p.id === 'r2').pinned = true;
  assert.deepEqual(t.group('pinned'), ['p3','p1','p2','r2']); assert.deepEqual(t.group('recent').slice(0, 2), ['r3','r1']);
  t.S.projects.find(p => p.id === 'p1').pinned = false;
  assert.deepEqual(t.group('pinned'), ['p3','p2','r2']);
});
test('boundary, invalid, cross-group and no-op moves never save', () => {
  const t = setup(); t.group('recent'); t.group('pinned'); t.writes.length = 0;
  for (const args of [['p1','r1'],['r1','p1'],['r1','r1'],['r1','r2'],['archive','r1'],['r1','archive'],['gone','r1'],['r1','canvases']]) assert.equal(t.move(...args), false, args.join(' -> '));
  assert.equal(t.writes.length, 0);
});
test('archive and deletion leave only eligible projects visible without losing survivors', () => {
  const t = setup(); t.move('r3','r1'); t.S.projects.find(p => p.id === 'r1').archived = true; t.S.projects = t.S.projects.filter(p => p.id !== 'r2');
  assert.deepEqual(t.group('recent'), ['r3','r4','r5','r6','r7','r8','r9']);
  t.move('r3', 'r4', true);
  assert.ok(!t.writes.at(-1).recent.includes('r1')); assert.ok(!t.writes.at(-1).recent.includes('r2'), 'the next explicit move cleans dormant ranks');
});
test('malformed preferences are sanitized and absent storage still permits this visit', () => {
  const t = setup({ pinned:'bad', recent:['r3',null,4,'r3','gone','r1'] });
  assert.deepEqual(t.group('pinned'), ['p1','p2','p3']);
  assert.deepEqual(t.group('recent'), ['r3','r1','r2','r4','r5','r6','r7','r8','r9']);
  const denied = setup({}, true); denied.move('p3','p1'); assert.deepEqual(denied.group('pinned'), ['p3','p1','p2']);
});
test('a preference from another tab redraws without writing it back', () => {
  const saved = { pinned:['p3','p2','p1'], recent:unpinned }, t = setup(saved);
  t.events.storage({ key:'penecho-project-order-v1' });
  assert.equal(t.c.rendered, true); assert.deepEqual(t.group('pinned'), ['p3','p2','p1']); assert.equal(t.writes.length, 0);
});
test('an early render before project data arrives never erases saved ordering', () => {
  const t = setup({ pinned:['p3','p1','p2'], recent:['r3','r1','r2','r4','r5','r6','r7','r8','r9'] }), all = t.S.projects;
  t.S.projects = []; assert.deepEqual(t.group('pinned'), []); assert.deepEqual(t.group('recent'), []); assert.equal(t.writes.length, 0);
  t.S.projects = all; assert.deepEqual(t.group('pinned'), ['p3','p1','p2']); assert.equal(t.group('recent')[0], 'r3');
});
test('a tab with an older project list cannot remove a newer tab\'s project rank', () => {
  const t = setup({ pinned:['p1','p2','p3'], recent:['new','r3','r1','r2','r4','r5','r6','r7','r8','r9'] });
  assert.deepEqual(t.group('recent'), ['r3','r1','r2','r4','r5','r6','r7','r8','r9']);
  assert.equal(t.writes.length, 0, 'rendering stale membership must not overwrite the shared preference');
  t.S.projects.push({ id:'new', lastOpenedAt:1000 });
  assert.equal(t.group('recent')[0], 'new'); assert.equal(t.writes.length, 0);
});

function setupFamilies() {
  const t = setup(), { c, S } = t, { document, window } = parseHTML('<body><nav id="railList"></nav></body>');
  const line = (id, createdAt, extra) => ({ id, title:id, createdAt, shown:'notes', ...extra });
  const root = line('root', 30, { orchestratorRef:'PE-1' });
  const nested = line('nested', 30, { orchestratorRef:'PE-2', orchestratedBy:'PE-1', shown:'working' });
  const sibling = line('sibling', 20, { orchestratedBy:'PE-1' });
  const leaf = line('leaf', 10, { orchestratedBy:'PE-2' });
  const unrelated = line('unrelated', 40);
  const pin = line('pin', 10, { pinned:true });
  const mine = { id:'r1', name:'Mine', lines:[root, nested, sibling, leaf, unrelated, pin] };
  const other = { id:'r2', name:'Other', lines:[line('other', 30), line('other-pin', 10, { pinned:true })] };
  S.projects = [mine, other]; S.route = { view:'home' };
  const host = document.getElementById('railList'), announced = [];
  let focus = null, hover = null;
  window.HTMLElement.prototype.focus = function () { focus = this; };
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this === host) return { left:0, top:0, right:300, bottom:300, width:300, height:300 };
    const height = this.classList.contains('rail-line-unit') ? 90 : 30;
    return { left:20, top:10, bottom:10 + height, right:280, width:260, height };
  };
  window.HTMLElement.prototype.setPointerCapture = () => {};
  window.HTMLElement.prototype.hasPointerCapture = () => false;
  document.elementFromPoint = () => hover;
  Object.assign(c, {
    document, HOSTED:false, EMBED:null, project:() => null, lineReads:{}, STATE_TEXT:{}, railChoice:{}, ACT:{},
    localStorage:{ getItem:() => null }, toast:msg => announced.push(msg), requestAnimationFrame:() => 1,
    $:sel => document.querySelector(sel), $$:(sel, scope = document) => [...scope.querySelectorAll(sel)],
    esc:text => String(text).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;'),
    ic:() => '<svg></svg>',
  });
  const pages = read('pages.js');
  t.run(pages.slice(pages.indexOf('const RAIL_LINES ='), pages.indexOf("ACT['rail-new-line']")));
  t.run(pages.slice(pages.indexOf('// Keep keyed controls'), pages.indexOf('// ---------- The sidebar between pages')));
  c.renderRail = () => {
    const draft = document.createElement('div');
    draft.innerHTML = c.railPinned() + S.projects.map(p => `<div class="rail-project" data-project="${p.id}" data-project-group="recent"><div class="rail-item has-fold is-open"><button type="button" class="rail-row" data-p="${p.id}">${p.name}</button></div>${c.railLines(p)}</div>`).join('');
    c.railMorphChildren(host, draft);
  };
  c.renderRail();
  t.writes.length = 0;
  const control = id => host.querySelector(`.rail-line[data-line="${id}"]`);
  const item = id => c.railOrderItem(control(id));
  const ids = scope => [...host.querySelectorAll(`${scope} .rail-line[data-line]`)].map(el => el.dataset.line);
  const keyboard = (id, direction) => t.documentEvents.keydown({
    target:control(id), key:`Arrow${direction}`, altKey:true, shiftKey:true, preventDefault() {}, stopImmediatePropagation() {},
  });
  function drag(from, to, { after = true, beforeRelease = () => {}, overEl = null } = {}) {
    const handlers = t.documentEvents, pointerId = 1, clientY = after ? 35 : 15;
    hover = overEl || control(to);
    handlers.pointerdown({ target:control(from), button:0, isPrimary:true, pointerId, clientX:30, clientY:30, pointerType:'mouse' });
    handlers.pointermove({ pointerId, clientX:50, clientY, preventDefault() {} });
    const gesture = t.run('railProjectGesture');
    beforeRelease(gesture);
    handlers.pointerup({ pointerId, clientX:50, clientY });
    return gesture;
  }
  return { ...t, mine, root, nested, leaf, sibling, unrelated, pin, host, announced, control, item, ids, keyboard, drag, focus:() => focus };
}

test('dragging a root moves the entire family, and dropping after it marks the end of its subtree', () => {
  const t = setupFamilies(), originalDates = t.mine.lines.map(l => l.createdAt);
  assert.ok(t.item('root').unit.contains(t.control('leaf')));
  t.drag('root', 'unrelated', { after:false, beforeRelease:g => {
    assert.equal(g.unit.classList.contains('is-reordering'), true);
    assert.equal(g.mark.hidden, false);
  } });
  assert.deepEqual(t.ids('.rail-project[data-project="r1"]'), ['root', 'nested', 'leaf', 'sibling', 'unrelated']);
  assert.deepEqual(Object.keys(t.writes.at(-1)), [JSON.stringify(['r1', 'root'])]);
  assert.deepEqual(t.mine.lines.map(l => l.createdAt), originalDates);
  assert.equal(t.focus(), t.control('root'));
  assert.equal(t.announced.at(-1), 'root: position 1 of 2 in top-level Lines.');
  t.drag('unrelated', 'root', { beforeRelease:g => {
    assert.equal(g.mark.style.top, '99px');
  } });
});

test('keyboard and pointer moves stay among siblings and retain a nested parent’s subtree', () => {
  const t = setupFamilies(), leaf = t.control('leaf'), nested = t.control('nested');
  t.keyboard('nested', 'Down');
  assert.deepEqual(t.ids('.rail-project[data-project="r1"]'), ['unrelated', 'root', 'sibling', 'nested', 'leaf']);
  assert.equal(t.control('leaf'), leaf);
  assert.equal(t.focus(), nested);
  assert.equal(t.announced.at(-1), 'nested: position 2 of 2 in sub-Lines of root.');
  assert.equal(Object.hasOwn(t.writes.at(-1), JSON.stringify(['r1', 'leaf'])), false);
  t.keyboard('leaf', 'Down');
  assert.equal(t.writes.length, 1, 'the only child cannot move into the grandparent scope');
  t.drag('nested', 'sibling', { after:false });
  assert.deepEqual(t.ids('.rail-project[data-project="r1"]'), ['unrelated', 'root', 'nested', 'leaf', 'sibling']);
});

test('drops reject other parents, projects, pins, hidden groups, and stale family membership', () => {
  const t = setupFamilies();
  for (const [from, to] of [['leaf', 'sibling'], ['nested', 'unrelated'], ['root', 'other'], ['pin', 'other-pin'], ['root', 'pin']]) {
    t.drag(from, to, { beforeRelease:g => assert.equal(g.mark.hidden, true, `${from} → ${to}`) });
  }
  assert.equal(t.writes.length, 0);
  t.drag('nested', 'sibling', { beforeRelease:() => {
    t.run('railSubsOpen = { [railLineKey("r1", "root")]:false }');
  } });
  assert.equal(t.writes.length, 0, 'a fold since pointerdown invalidates the child drop');
  assert.equal(t.control('sibling'), null);
  t.run('railSubsOpen = {}');
  t.c.renderRail();
  t.drag('root', 'unrelated', { after:false, beforeRelease:() => {
    t.mine.lines.push({ id:'new-child', title:'New child', orchestratedBy:'PE-2', createdAt:15, shown:'notes' });
  } });
  assert.equal(t.writes.length, 0, 'a changed subtree invalidates the original gesture');
});

test('dragging a line onto its project header, rail margin, or parent header moves it to the top of its scope', () => {
  const t = setupFamilies();
  const mineHeader = t.host.querySelector('.rail-project[data-project="r1"] .rail-row');
  const otherHeader = t.host.querySelector('.rail-project[data-project="r2"] .rail-row');
  const mineLines = t.host.querySelector('.rail-project[data-project="r1"] .rail-lines');

  // Dragging root onto its own project header moves it above unrelated (to the top).
  t.drag('root', null, { overEl:mineHeader, after:false, beforeRelease:g => {
    assert.equal(g.mark.hidden, false);
    assert.deepEqual({ ...g.target }, { id:JSON.stringify(['r1', 'unrelated']), after:false });
  } });
  assert.deepEqual(t.ids('.rail-project[data-project="r1"]'), ['root', 'nested', 'leaf', 'sibling', 'unrelated']);

  // Dragging the already-top line onto its own project header is a valid no-op.
  const writesBefore = t.writes.length;
  t.drag('root', null, { overEl:mineHeader, after:false, beforeRelease:g => {
    assert.equal(g.mark.hidden, true);
    assert.equal(g.target, null);
  } });
  assert.equal(t.writes.length, writesBefore);

  // Dragging onto a different project's header is rejected.
  t.drag('unrelated', null, { overEl:otherHeader, after:false, beforeRelease:g => {
    assert.equal(g.mark.hidden, true);
    assert.equal(g.target, null);
  } });
  assert.equal(t.writes.length, writesBefore);

  // Dragging unrelated into the .rail-lines margin above the first item moves it back to the top.
  t.drag('unrelated', null, { overEl:mineLines, after:false, beforeRelease:g => {
    assert.equal(g.mark.hidden, false);
    assert.deepEqual({ ...g.target }, { id:JSON.stringify(['r1', 'root']), after:false });
  } });
  assert.deepEqual(t.ids('.rail-project[data-project="r1"]'), ['unrelated', 'root', 'nested', 'leaf', 'sibling']);

  // Dragging a sub-Line onto its parent header moves it to the top of its parent's sub-Lines.
  t.drag('sibling', 'root', { after:true, beforeRelease:g => {
    assert.equal(g.mark.hidden, false);
    assert.deepEqual({ ...g.target }, { id:JSON.stringify(['r1', 'nested']), after:false });
  } });
  assert.deepEqual(t.ids('.rail-project[data-project="r1"]'), ['unrelated', 'root', 'sibling', 'nested', 'leaf']);
});
