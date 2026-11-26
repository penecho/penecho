'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { parseHTML } = require('./helpers/dom.js');
const read = name => fs.readFileSync(path.join(__dirname, '../public/lines', name + '.js'), 'utf8');

function harness() {
  const { document, window } = parseHTML('<html><body><div id="view"><div id="linePage"><header id="lpHead"></header><div id="lpList"></div><div id="lpScroll"><div id="lpThread"></div></div></div></div></body></html>');
  let focused = document.body, nextFrame = 0;
  const frames = new Map(), calls = [];
  Object.defineProperty(document, 'activeElement', { get:() => focused?.isConnected ? focused : document.body });
  window.HTMLElement.prototype.focus = function () { focused = this; };
  window.HTMLElement.prototype.getClientRects = function () { return this.isConnected && !this.hidden ? [this.getBoundingClientRect()] : []; };
  window.HTMLElement.prototype.getBoundingClientRect = function () { return { left:100, top:100, right:300, bottom:140, width:200, height:40 }; };
  const line = { id:'line', slug:'line', stations:[{ id:'ask', kind:'ask', state:'done', unsent:true, index:0, text:'Test', when:'Today' }] };
  const p = { id:'p', defaultAgent:'codex', lines:[line], landed:[], backlog:[] };
  const agents = [{ id:'codex', name:'Codex' }, { id:'claude', name:'Claude' }];
  const c = vm.createContext({ document, window, navigator:{ platform:'Mac' }, console,
    S:{ cur:'p', route:{view:'line',line:'line'}, thisComputer:true }, location:{hash:'#p/line/line'}, navigationTransition:0,
    ACT:{}, SEND:{}, LINE_STATUS:require('../public/lines/line-status.js'), STATE_COLOR:{}, HOSTED:false, addEventListener() {},
    $:(sel, root = document) => root.querySelector(sel), $$:(sel, root = document) => [...root.querySelectorAll(sel)],
    innerWidth:1000, innerHeight:800, clamp:(v, lo, hi) => Math.max(lo, Math.min(hi, v)),
    requestAnimationFrame:fn => { frames.set(++nextFrame, fn); return nextFrame; }, cancelAnimationFrame:id => frames.delete(id),
    esc:String, ic:() => '', av:() => '', can:() => true, project:() => p,
    allLines:p => p.lines, lineById:(p, id) => p.lines.find(l => l.id === id), stationById:(l, id) => l.stations.find(s => s.id === id),
    availableAgents:() => agents, agentInfo:id => agents.find(a => a.id === id),
    runPresets:() => [], defaultPreset:() => null, presetById:() => null,
    fileEntry:() => null, reducedMotion:() => true,
  });
  const run = code => vm.runInContext(code, c);
  const core = read('core'); run(core.slice(core.indexOf('// Small anchored menu'), core.indexOf('// Zoom between levels')));
  run(read('line'));
  // Keep real controls, menu actions, mount and card reconciliation. Stub unrelated panel/layout work.
  Object.assign(c, {
    askItem:(p, l, s) => `<section id="item-${s.id}" data-step="${s.id}"><p>${s.text}</p>${s.unsent ? c.unsentFoot(p, l, s) : ''}</section>`,
    boxWords:() => 'Ask', lineState:() => 'notes', lineHeadHTML:() => '<h1>Line</h1>', listHTML:() => '',
    selectedStep:() => null, paintProgress() {}, spyLine() {}, panelInto() {}, placeLegacyParts() {}, applyLineFilter() {},
    scrollToLatest() {}, markHere() {}, pollActivity() {}, kindLine:() => '', questionsHTML:() => '',
    runUnsent:(p,l,step,agent,preset) => calls.push({ kind:'run',project:p.id,line:l.id,step,agent,preset }),
    pasteToAgent:async (l, step, agent, context) => calls.push({ kind:'paste',line:l.id,step,context:!!context }),
  });
  document.querySelector('#lpThread').innerHTML = c.threadHTML(p, line);
  c.mountLine(p, c.S.route);
  const tick = () => { const jobs = [...frames.values()]; frames.clear(); jobs.forEach(fn => fn()); };
  const picker = kind => document.querySelector(`[data-act="unsent-${kind}-pick"]`);
  const open = kind => c.ACT[`unsent-${kind}-pick`](picker(kind));
  const key = (target, key) => { const e = new window.Event('keydown', { bubbles:true, cancelable:true }); e.key = key; target.dispatchEvent(e); };
  return { c, document, p, line, run, tick, calls, picker, open, key, menu:() => document.querySelector('#menu') };
}

for (const kind of ['run', 'paste']) {
  test(`${kind}: first unchanged refresh retains the original control and menu`, () => {
    const h = harness(), anchor = h.picker(kind); h.open(kind);
    const menu = h.menu(), focus = h.document.activeElement;
    h.c.refreshLine(); h.tick();
    assert.ok(h.picker(kind) === anchor, 'unchanged control is retained');
    assert.ok(h.menu() === menu, 'open menu is retained'); assert.ok(h.document.activeElement === focus, 'focused item is retained');
  });
  test(`${kind}: changed Ask retains menu and focus, selection acts once on the same Ask`, () => {
    const h = harness(), anchor = h.picker(kind); h.open(kind);
    const menu = h.menu(); h.key(h.document.activeElement, 'ArrowDown'); const focused = h.document.activeElement;
    h.line.stations[0].text = 'Updated while open'; h.c.refreshLine(); h.tick();
    assert.notEqual(h.picker(kind), anchor);
    assert.ok(h.menu() === menu, 'open menu is retained'); assert.ok(h.document.activeElement === focused, 'focused item is retained');
    focused.click(); assert.equal(h.menu(), null); assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].line, 'line'); assert.equal(h.calls[0].step, 'ask');
    if (kind === 'run') assert.equal(h.calls[0].agent, 'codex');
    else assert.equal(h.calls[0].context, false);
    assert.ok(h.document.activeElement === h.picker(kind), 'focus returns to the current control');
  });
  test(`${kind}: Escape after refresh returns focus to the replacement`, () => {
    const h = harness(); h.open(kind); h.line.stations[0].text = 'Changed'; h.c.refreshLine(); h.tick();
    h.key(h.document.activeElement, 'Escape');
    assert.equal(h.menu(), null); assert.ok(h.document.activeElement === h.picker(kind), 'focus returns to the current control'); assert.equal(h.calls.length, 0);
  });
  test(`${kind}: same-route page redraw preserves menu and outside dismissal`, () => {
    const h = harness(); h.open(kind); const menu = h.menu(), focus = h.document.activeElement;
    const view = h.document.querySelector('#view'); view.innerHTML = view.innerHTML; h.tick();
    assert.ok(h.menu() === menu); assert.ok(h.document.activeElement === focus);
    h.c.menuOutside({target:h.document.querySelector('#lpHead')}); h.tick();
    assert.equal(h.menu(), null); assert.equal(h.calls.length, 0);
  });
  for (const why of ['removed', 'sent', 'disabled', 'offscreen', 'ambiguous', 'route', 'project']) test(`${kind}: ${why} closes without running a stale action`, () => {
    const h = harness(); h.open(kind); const button = h.menu().querySelector('button');
    if (why === 'removed') h.line.stations = [];
    if (why === 'sent') h.line.stations[0].unsent = false;
    if (why === 'disabled') h.picker(kind).disabled = true;
    if (why === 'offscreen') h.picker(kind).getClientRects = () => [];
    if (why === 'ambiguous') { const anchor = h.picker(kind); anchor.replaceWith(anchor.cloneNode(true), anchor.cloneNode(true)); }
    if (why === 'route') { h.c.S.route = {view:'line',line:'elsewhere'}; h.c.navigationTransition++; }
    if (why === 'project') h.c.S.cur = 'other';
    if (['removed', 'sent'].includes(why)) h.c.refreshLine();
    // Selection can happen before the next animation frame sees the replacement.
    button.click(); h.tick();
    assert.equal(h.menu(), null); assert.equal(h.calls.length, 0);
  });
}

function hostedHarness(h = harness()) {
  let release;
  h.c.HOSTED = {onComputer:true,runOn:{}};
  h.c.hostedComputers = () => new Promise(resolve => { release = resolve; });
  h.c.hostedComputerFor = () => ({id:'mac'});
  h.c.hostedSyncs = () => true;
  h.c.hostedAgent = id => h.c.agentInfo(id);
  const hosted = read('hosted');
  h.run(hosted.slice(hosted.indexOf('let hostedRunOpening ='), hosted.indexOf('// A run started from this page')));
  return {...h, complete:() => release([{id:'mac',name:'Mac',open:true,agents:[{id:'codex',ready:true},{id:'claude',ready:true}]}])};
}
test('hosted Run survives refresh both while fetching its choices and after opening', async () => {
  const h = hostedHarness(), pending = h.c.hostedRunPick(h.picker('run'));
  h.line.stations[0].text = 'Arrived during loading'; h.c.refreshLine(); h.complete(); await pending;
  const menu = h.menu(); assert.ok(menu);
  h.line.stations[0].text = 'Arrived after loading'; h.c.refreshLine(); h.tick();
  assert.ok(h.menu() === menu);
  h.key(h.document.activeElement,'ArrowDown'); h.document.activeElement.click();
  assert.equal(h.calls.length,1); assert.equal(h.calls[0].agent,'codex'); assert.equal(h.calls[0].step,'ask');
  assert.equal(h.c.HOSTED.runOn.line,'mac');
});
for (const cancel of ['Escape','outside','navigation','another menu']) test(`hosted loading cannot reopen after ${cancel}`, async () => {
  const h = hostedHarness(), pending = h.c.hostedRunPick(h.picker('run'));
  if (cancel === 'Escape') h.key(h.document.body,'Escape');
  if (cancel === 'outside') h.c.menuOutside({target:h.document.querySelector('#lpHead')});
  if (cancel === 'navigation') h.c.S.route = {view:'home'};
  if (cancel === 'another menu') h.open('paste');
  h.complete(); await pending; h.tick();
  assert.equal(h.document.querySelector('#menu.run-menu'),null);
  assert.equal(h.calls.length,0);
  if (cancel === 'another menu') assert.ok(h.document.querySelector('#menu.paste-menu'));
});

// The global dispatcher must not queue opening a local menu behind the Ask's save.
// Use the real save/settle lifecycle as well as the menu and card reconciliation.
function savingHarness({ newLine = false } = {}) {
  const h = harness(), { c, line, p, run } = h;
  const composer = read('composer');
  run(composer.slice(composer.indexOf('const SAVING ='), composer.indexOf('// A drawing that starts a line of its own')));
  run(read('main').slice(read('main').indexOf('function routeToHash'), read('main').indexOf('function hashToRoute')));
  c.S.comp = {}; c.lineOpened = {}; c.OPENED_KEY = 'opened';
  const box = { text:'', files:[], refers:[], flags:{} };
  Object.assign(c, { boxKey:x => x, readLists:() => ({}), writeLists() {}, embedShown() {}, toast() {},
    comp:() => box, syncHash:() => { c.location.hash = '#' + c.routeToHash(c.S.route); },
    refreshAfterChange:() => c.refreshLine(), refreshBehind() {}, go:r => { c.S.route = r; c.closeMenu(); },
  });
  if (newLine) line.id = line.slug = c.S.route.line = 'saving-line';
  line.stations[0].id = 'saving-ask'; c.syncHash();
  h.document.querySelector('#lpThread').innerHTML = c.threadHTML(p, line);
  c.mountLine(p, c.S.route);
  const entry = { project:p.id, lineId:line.id, station:line.stations[0], line:newLine ? line : null };
  c.entry = entry; run('SAVING.push(entry)');
  let resolve, reject;
  const reply = new Promise((yes, no) => { resolve = yes; reject = no; });
  const pending = c.saveBehind(entry, 'box', { text:'Test', files:[], refers:[] }, () => reply);
  const flush = () => new Promise(done => setImmediate(done));
  return { ...h, entry, box, dispatch(kind) {
    const el = h.picker(kind), invoke = () => c.ACT[el.dataset.act](el);
    if (!c.whenSaved(el, invoke)) invoke();
  }, async finish() { resolve({slug:'line',step:'ask'}); await pending; await flush(); h.tick(); },
  async fail() { reject(new Error('Save failed')); await pending; await flush(); h.tick(); }, flush };
}
for (const kind of ['run', 'paste']) {
  for (const newLine of [false, true]) {
    test(`${kind}: opens before ${newLine ? 'new Line' : 'Ask'} save and survives saved IDs`, async () => {
      const h = savingHarness({newLine}); h.dispatch(kind);
      const menu = h.menu(); assert.ok(menu, 'choices appear before any save reply');
      h.key(h.document.activeElement, 'ArrowDown'); const focus = h.document.activeElement;
      await h.finish();
      assert.equal(h.menu(), menu, 'save does not close or rebuild the menu');
      assert.equal(h.document.activeElement, focus);
      focus.click(); await h.flush();
      assert.equal(h.calls.length, 1); assert.equal(h.calls[0].line, 'line'); assert.equal(h.calls[0].step, 'ask');
    });
    test(`${kind}: choosing before ${newLine ? 'new Line' : 'Ask'} save waits and uses saved IDs once`, async () => {
      const h = savingHarness({newLine}); h.dispatch(kind); assert.ok(h.menu());
      h.document.activeElement.click(); assert.equal(h.menu(), null); assert.equal(h.calls.length, 0);
      await h.finish();
      assert.equal(h.calls.length, 1); assert.equal(h.calls[0].line, 'line'); assert.equal(h.calls[0].step, 'ask');
    });
  }
  for (const cancel of ['failure', 'navigation', 'away and back', 'project', 'sent', 'removed', 'hash']) {
    test(`${kind}: selection while saving cannot act after ${cancel}`, async () => {
      const h = savingHarness(); h.dispatch(kind); assert.ok(h.menu()); h.document.activeElement.click();
      if (cancel === 'failure') { await h.fail(); assert.equal(h.box.text, 'Test', 'failed save restores the words'); }
      else {
        if (cancel === 'navigation') { h.c.S.route = {view:'home'}; h.c.navigationTransition++; }
        if (cancel === 'away and back') h.c.navigationTransition += 2;
        if (cancel === 'hash') h.c.location.hash = '#settings';
        if (cancel === 'project') h.c.S.cur = 'other';
        if (cancel === 'sent') h.line.stations[0].unsent = false;
        if (cancel === 'removed') h.line.stations = [];
        await h.finish();
      }
      assert.equal(h.calls.length, 0);
    });
  }
  for (const dismissal of ['Escape', 'outside']) test(`${kind}: ${dismissal} during saving never reopens`, async () => {
    const h = savingHarness(); h.dispatch(kind); assert.ok(h.menu());
    if (dismissal === 'Escape') h.key(h.document.activeElement, 'Escape');
    else h.c.menuOutside({target:h.document.querySelector('#lpHead')});
    await h.finish(); assert.equal(h.menu(), null); assert.equal(h.calls.length, 0);
  });
}

for (const kind of ['run', 'paste']) {
  test(`${kind}: later saves do not hold up a selected Ask`, async () => {
    const h = savingHarness();
    const other = {project:'p', lineId:'line', station:{id:'saving-other'}};
    h.c.other = other; h.run('SAVING.push(other)');
    let release;
    const reply = new Promise(resolve => { release = resolve; });
    const later = h.c.saveBehind(other, 'box', {text:'Other',files:[],refers:[]}, () => reply);
    h.dispatch(kind); h.document.activeElement.click();
    await h.finish();
    assert.equal(h.calls.length, 1, 'target has acted while later save is unresolved');
    assert.equal(h.calls[0].step, 'ask');
    release({slug:'line',step:'other'}); await later;
  });
  test(`${kind}: scrolling after selection does not cancel it`, async () => {
    const h = savingHarness(); h.dispatch(kind); h.document.activeElement.click();
    h.c.window.HTMLElement.prototype.getClientRects = () => [];
    await h.finish(); assert.equal(h.calls.length, 1);
  });
  test(`${kind}: mapped IDs do not allow an unrelated hash`, async () => {
    const h = savingHarness({newLine:true}); h.dispatch(kind); await h.finish();
    h.c.location.hash = '#settings'; h.document.activeElement.click();
    assert.equal(h.calls.length, 0); assert.equal(h.menu(), null);
  });
  test(`${kind}: missing pending save cannot execute temporary IDs`, async () => {
    const h = savingHarness(); h.run('SAVING.length = 0'); h.dispatch(kind); h.document.activeElement.click();
    await h.finish(); assert.equal(h.calls.length, 0);
  });
}
for (const phase of ['loading', 'open', 'selected']) test(`hosted: new Line saves while menu is ${phase}`, async () => {
  const h = hostedHarness(savingHarness({newLine:true}));
  const pending = h.c.hostedRunPick(h.picker('run'));
  if (phase === 'loading') await h.finish();
  h.complete(); await pending; assert.ok(h.menu());
  if (phase === 'selected') {
    h.document.activeElement.click(); assert.equal(h.calls.length, 0); await h.finish();
  } else {
    if (phase === 'open') await h.finish();
    assert.ok(h.menu()); h.document.activeElement.click();
  }
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].line, 'line'); assert.equal(h.calls[0].step, 'ask');
  assert.equal(h.c.HOSTED.runOn.line, 'mac');
});
test('saving menu keeps the chosen saved-agent preset', async () => {
  const h = savingHarness();
  h.c.runPresets = () => [{id:'preset', agent:'claude', name:'Claude custom'}];
  h.c.presetShouldShowFacts = () => false;
  h.c.presetTitle = x => x.name;
  h.dispatch('run');
  [...h.menu().querySelectorAll('button')].find(button => button.textContent === 'Claude custom').click();
  await h.finish();
  assert.equal(h.calls[0].agent, 'claude'); assert.equal(h.calls[0].preset, 'preset');
});

for (const kind of ['run', 'paste']) test(`${kind}: new Line save preserves pending hash navigation`, async () => {
  const h = savingHarness({newLine:true}); h.dispatch(kind); h.document.activeElement.click();
  h.c.location.hash = '#settings'; await h.finish();
  assert.equal(h.c.S.route.line, 'line'); assert.equal(h.c.location.hash, '#settings'); assert.equal(h.calls.length, 0);
});
test('menu follows selected step as both line and step IDs are saved', async () => {
  const h = savingHarness({newLine:true}); h.c.S.route.step = 'saving-ask'; h.c.syncHash();
  h.dispatch('run'); const menu = h.menu(); await h.finish();
  assert.equal(h.c.location.hash, '#p/line/line/ask'); assert.equal(h.menu(), menu);
  h.document.activeElement.click(); assert.equal(h.calls[0].step, 'ask');
});

// PE-597: Mark finished & reviewed shows with the new Ask, not only after the state refresh; a click before the save lands waits for it.
test('a new unsent Ask shows Mark finished & reviewed at once, except on an archived Line', () => {
  const h = savingHarness();
  Object.assign(h.c, { scrollToItem() {}, refreshAfterChange() {}, KIND:{ ask:{ label:'Ask' }, note:{ label:'Note' } } });
  const took = { text:'More', files:[], refers:[] };
  const e = h.c.showAtOnce(h.p, { kind:'ask', text:'More', took, here:h.line });
  assert.equal(e.station.canFinishUnsent, true);
  assert.match(h.c.unsentFoot(h.p, h.line, e.station), /data-act="unsent-finish"/);
  assert.equal(h.c.showAtOnce(h.p, { kind:'ask', text:'Sent', took, here:h.line, sent:true }).station.canFinishUnsent, false);
  assert.equal(h.c.showAtOnce(h.p, { kind:'note', text:'Note', took, here:h.line }).station.canFinishUnsent, false);
  h.line.status = 'closed';
  assert.equal(h.c.showAtOnce(h.p, { kind:'ask', text:'Late', took, here:h.line }).station.canFinishUnsent, false);
});
for (const newLine of [false, true]) test(`Mark finished & reviewed before ${newLine ? 'new Line' : 'Ask'} save waits and uses saved IDs once`, async () => {
  const h = savingHarness({ newLine }), sent = [];
  h.line.stations[0].canFinishUnsent = true; h.c.refreshLine(); h.tick();
  h.c.act = async (l, action, body) => { sent.push({ line:l.id, action, step:body.step }); };
  const el = h.document.querySelector('[data-act="unsent-finish"]');
  assert.ok(el, 'the control is on the page while saving');
  assert.equal(h.c.whenSaved(el, () => h.c.ACT['unsent-finish'](el)), true);
  assert.deepEqual(sent, []);
  await h.finish(); await h.flush();
  assert.deepEqual(sent, [{ line:'line', action:'finish-unsent', step:'ask' }]);
});

function lineMenuHarness() {
  const h = harness();
  const anchor = h.document.createElement('button');
  anchor.dataset.line = h.line.id;
  h.document.body.append(anchor);
  const clipboard = [];
  h.c.navigator.clipboard = { writeText:async value => clipboard.push(value) };
  h.c.toast = () => {};
  h.p.name = 'Example project';
  Object.assign(h.line, { code:'PE-7', topicPath:'lines/line.md', topicAbsolutePath:'/Example docs/lines/line.md' });
  const pages = read('pages');
  h.run(pages.slice(pages.indexOf('async function writeClipboard('), pages.indexOf("ACT['copy-prompt']")));
  const hosted = read('hosted');
  h.run(hosted.slice(hosted.indexOf('const HOSTED_OFF ='), hosted.indexOf('if (HOSTED) {', hosted.indexOf('function hostedMenu('))));
  const show = () => h.c.ACT['line-menu'](anchor);
  const group = label => h.menu().querySelector(`[role="group"][aria-label="${label}"]`);
  return { ...h, anchor, show, group, clipboard };
}

function canvasCardMenuHarness({ attached = false } = {}) {
  const h = harness(), c = h.c, source = 'files/sketch/canvas.json';
  let current = { ...h.p, pictures:[{ title:'Sketch', source, mtime:1, topic:attached ? h.line.id : '' }] };
  c.S.route = { view:'files' };
  Object.assign(c, { ICONS:{}, CSS:{ escape:String }, project:() => current, shortWhen:String, fvRefresh() {},
    canvasByPath:(p, path) => p?.pictures.find(item => item.source === path),
    railOrder:() => [{ id:'other', name:'Other project' }],
    canvasUrl:(p, opts) => opts.source, openCanvasPage:(path, card) => h.calls.push({ path, card }) });
  h.run(read('canvases')); h.run(read('files'));
  h.document.querySelector('#view').innerHTML = '<div id="flBody"></div><aside id="flSheet"></aside>';
  c.refreshFiles();
  const button = () => h.document.querySelector(`.cv-more[data-source="${source}"]`);
  const refresh = (pictures = [...current.pictures, { title:'Another Canvas', source:'files/other.json', mtime:2 }]) => {
    current = { ...current, pictures }; c.refreshFiles();
  };
  return { ...h, source, button, refresh, open:() => c.ACT['canvas-menu'](button()) };
}

test('Canvas card menu keeps its focused action across a changed gallery and opens the original Canvas', () => {
  const h = canvasCardMenuHarness(), before = h.button();
  h.open(); const menu = h.menu(), focused = h.document.activeElement;
  h.refresh(); h.tick();
  assert.notEqual(h.button(), before);
  assert.ok(h.menu() === menu, 'the card menu remains open after the gallery redraws');
  assert.ok(h.document.activeElement === focused);
  focused.click();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].path, h.source);
  assert.ok(h.calls[0].card === h.button().closest('.cv-card'));
});

test('Canvas Move destinations survive gallery redraws and Escape returns focus to the current button', () => {
  const h = canvasCardMenuHarness(); h.open(); h.refresh();
  const move = [...h.menu().querySelectorAll('button')].find(el => el.textContent === 'Move to…');
  move.click();
  const menu = h.menu(); assert.ok(menu, 'Move destinations open after a redraw'); assert.match(menu.textContent, /Other project/);
  h.refresh([{ source:h.source, title:'Updated Canvas', mtime:3 }]);
  h.tick(); assert.ok(h.menu() === menu, 'the Move menu survives the next redraw');
  h.key(h.document.activeElement, 'Escape');
  assert.equal(h.menu(), null); assert.equal(h.document.activeElement, h.button());
});

test('a Line-owned Canvas keeps the right Move action and project after a redraw in each menu', () => {
  const h = canvasCardMenuHarness({ attached:true });
  Object.assign(h.c, { pathFor:id => '/projects/' + id, api:async (url, options) => h.calls.push([url, options.body.to]),
    loadState:async () => {}, loadProjects:async () => {}, render() {}, toast() {} });
  h.open(); h.refresh(); h.tick();
  const item = label => [...h.menu().querySelectorAll('button')].find(el => el.textContent === label);
  item('Move its line to…').click();
  h.refresh([{ title:'New title', source:h.source, topic:h.line.id }]); h.tick();
  item('Other project').click();
  assert.deepEqual(h.calls, [['/projects/p/topics/line/move', 'other']]);
});

for (const why of ['removed', 'project switched', 'outside click']) test(`Canvas menu dismissal: ${why}`, () => {
  const h = canvasCardMenuHarness(); h.open(); const action = h.document.activeElement;
  if (why === 'removed') h.refresh([]);
  if (why === 'project switched') h.c.S.cur = 'other';
  if (why === 'outside click') h.c.menuOutside({ target:h.document.querySelector('#view') });
  if (why !== 'outside click') action.click();
  h.tick(); assert.equal(h.menu(), null); assert.equal(h.calls.length, 0);
});

test('Line actions group file, branch and working folder commands and copy the clicked Line despite a duplicate short ID', () => {
  const h = lineMenuHarness();
  const other = { ...h.line, id:'other', topicAbsolutePath:'/Example docs/lines/other.md', topicPath:'lines/other.md',
    branch:'feature/other', folder:'/Code folder', running:true, removed:[{kind:'note', words:'Earlier note'}] };
  h.p.lines.push(other); h.anchor.dataset.line = other.id; h.c.S.openFolderLabel = 'Open folder in Finder';
  h.show();
  assert.deepEqual([...h.menu().querySelectorAll('[role="group"]')].map(el => el.getAttribute('aria-label')),
    ['This Line', 'Git branch', 'Working folder', 'Restore Line items', 'Archive and delete']);
  assert.match(h.group('This Line').textContent, /Open Line fileother.md/);
  assert.match(h.group('This Line').textContent, /Copy Line file path/);
  assert.equal(h.group('Git branch').querySelector('button').textContent, 'Copy branch name');
  assert.deepEqual([...h.group('Working folder').querySelectorAll('button')].map(b => b.textContent), ['Copy folder path', 'Open folder in Finder']);
  assert.match(h.group('Restore Line items').textContent, /Earlier note/);
  assert.match(h.group('Archive and delete').querySelector('button[disabled]').textContent, /^Delete/);
  const first = h.document.activeElement;
  assert.match(first.textContent, /Copy Line reference.*another session/);
  h.key(first, 'ArrowDown'); assert.match(h.document.activeElement.textContent, /Open Line file/);
  h.key(h.document.activeElement, 'ArrowUp'); h.document.activeElement.click();
  assert.deepEqual(h.clipboard, ['PenEcho Line PE-7 (Example project)\n/Example docs/lines/other.md']);
  assert.equal(h.document.activeElement, h.anchor);
  h.show(); h.group('Git branch').querySelector('button').click();
  h.show(); h.group('Working folder').querySelector('button').click();
  assert.deepEqual(h.clipboard.slice(1), ['feature/other', '/Code folder']);
});

test('Line menu skips empty groups and uses a hosted Line link when local paths are unavailable', () => {
  const h = lineMenuHarness(); h.line.code = ''; h.line.topicAbsolutePath = '';
  h.show();
  assert.equal(h.group('Git branch'), null);
  assert.equal(h.group('Working folder'), null);
  assert.equal(h.group('Restore Line items'), null);
  h.document.activeElement.click();
  assert.equal(h.clipboard[0], 'PenEcho Line line (Example project)\nlines/line.md');
  h.c.HOSTED = { key:'cloud:example' }; h.c.location.origin = 'https://penecho.test'; h.line.branch = 'local-only';
  h.show();
  assert.equal(h.group('Git branch'), null);
  assert.doesNotMatch(h.menu().textContent, /Copy Line file path|Move to project/);
  h.document.activeElement.click();
  assert.equal(h.clipboard[1], 'PenEcho Line line (Example project)\nhttps://penecho.test/lines/cloud%3Aexample#line/line');
});
