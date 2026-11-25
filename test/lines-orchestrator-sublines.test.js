'use strict';
// PE-764 / PE-765: Orchestrator sub-Lines card, sub-Line parent bar & edge cases, lineOrigin back nav, and bulk Mark reviewed UI.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('./helpers/dom.js');

const read = name => fs.readFileSync(path.join(__dirname, '../public/lines', name), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const ic = (name, size = 16) => `<svg class="ic" data-icon="${name}" width="${size}" height="${size}"></svg>`;
const turn = () => new Promise(resolve => setImmediate(resolve));
const pages = read('pages.js');

function makeLine(overrides = {}) {
  const id = overrides.id || 'line-1';
  return {
    id, slug:id, code:overrides.code || id, title:overrides.title || id,
    status:'done', landed:true, closed:false, archived:false, queued:false, todo:false,
    running:false, elsewhere:false, asking:null, questions:[], commit:'', branch:'',
    readRevision:`rev-${id}`, createdAt:Date.parse('2026-11-20T03:00:00Z'), lastActivityAt:Date.parse('2026-11-20T05:00:00Z'),
    topicPath:`lines/${id}.md`, ask:{ text:'', when:'', files:[], later:[] }, result:{ text:'', files:[] }, pictures:[], stations:[],
    ...overrides,
  };
}
function work(id, overrides = {}) {
  return { id, index:0, kind:'work', label:`Work ${id.split('-').pop()}`, state:'done', reviewed:false, off:'', agent:'codex', out:'Done', pictures:[], files:[], refers:[], ...overrides };
}

function createHarness({ lines = [], landed = [], backlog = [], hosted = false, readOnly = false } = {}) {
  const { document, window } = parseHTML('<html><body><div id="view"></div><div id="toast" hidden></div><div id="lightbox" hidden></div></body></html>');
  window.HTMLElement.prototype.scrollTo = function (opts, y) {
    if (opts && typeof opts === 'object' && opts.top != null) this.scrollTop = opts.top;
    else if (typeof y === 'number') this.scrollTop = y;
  };
  const storage = new Map();
  let hash = '#p';
  const requests = [], toasts = [], openedMenus = [];
  const historyObj = {
    state:null,
    replaceState(state, _title, value) { hash = value; this.state = state; },
  };
  const locationObj = {
    get hash() { return hash; },
    set hash(value) { hash = value; historyObj.state = null; },
    search:'', origin:'http://127.0.0.1:3889', pathname:'/projects.html',
  };

  const c = vm.createContext({
    document, window, console, Object, Array, Map, Set, Date, Promise, JSON, Math, Number, String, Boolean, encodeURIComponent, decodeURIComponent,
    setTimeout, clearTimeout, requestAnimationFrame:fn => fn(), cancelAnimationFrame() {},
    innerWidth:1280, innerHeight:800,
    CSS:{ escape:x => String(x) },
    navigator:{ platform:'Mac' },
    location:locationObj,
    history:historyObj,
    localStorage:{
      getItem:k => (storage.has(k) ? storage.get(k) : null),
      setItem:(k, v) => storage.set(k, String(v)),
      removeItem:k => storage.delete(k),
    },
    sessionStorage:{ getItem:() => null, setItem() {}, removeItem() {} },
    ACT:{}, SEND:{}, EMBED:null, Pano:{ sheet:null }, SHEET:null, SET:{}, SETTINGS_PAGES:new Set(),
    HOSTED:hosted ? { key:'p', read:readOnly, shared:readOnly, base:'/api/v1/line-projects/p' } : false,
    STATE_COLOR:{ working:'#0d9488', review:'#d98a1f', landed:'#16a34a', error:'#b4232c', wait:'#d98a1f' },
    LINE_STATUS:require('../public/lines/line-status.js'),
    WORK_PRICING:require('../public/lines/work-pricing.js'),
    addEventListener() {},
    $:(sel, root = document) => root.querySelector(sel),
    $$:(sel, root = document) => [...root.querySelectorAll(sel)],
    esc, ic, clamp:(v, a, b) => Math.min(b, Math.max(a, v)),
    reducedMotion:() => true,
    toast:msg => toasts.push(msg),
    openMenu:(anchor, items, opts) => { openedMenus.push({ anchor, items, opts }); },
    closeMenu() {},
    renderRail() {}, refreshChrome() {}, wireComposers() {}, syncComposer() {}, boxUrls() {},
    composerHTML:() => '<form class="composer"><textarea class="cmp-input"></textarea></form>',
    availableAgents:() => [], carryButton:() => '', nodeIcon:() => '', av:() => '', agentInfo:id => ({ id, name:id }),
    questionsHTML:() => '', stateChip:(st, l) => `<span class="chip c-${st}">${l.status}</span>`,
    homeHTML:() => '<div id="homePage">Home</div>',
    orchestratorHTML:() => '<div id="orchPage"><button class="orch-title" data-act="open-line" data-line="parent">Parent</button></div>',
    docHTML:() => '<div id="docPage">Doc</div>',
    topicsPageHTML:() => '', canvasesHTML:() => '', statsHTML:() => '', memoryHTML:() => '', vaultHTML:() => '', findHTML:() => '', archiveHTML:() => '', deletedHTML:() => '', settingsHTML:() => '', markupHTML:() => '',
    embedRailOnly:() => false, embedKeeps:() => true, embedShown() {}, hostedAddress() {}, hostedBoot() {},
    rememberTabs() {}, renderTray() {}, refreshDesk() {}, lacks:() => null, routeNeeds:() => ({}), holdFor:() => null, readLineFiles() {}, homeShape:() => 'code',
    showRow() {}, zoomIn() {}, zoomOutClone() {}, flightToLine:() => null, flightToHome:() => null,
    settingsUp:() => false, dropSettingsModal() {}, finishEdit:async () => true,
    refreshAfterChange:() => { if (c.S.route.view === 'line') c.refreshLine(); },
    loadActivity:async () => false,
    inlineSay:esc, texInline:esc, wordsMd:esc, sayHTML:esc,
    replaceMarkdownLinks:text => String(text ?? ''), holdMath:text => String(text ?? ''),
  });

  const run = code => vm.runInContext(code, c);
  run(read('state.js'));
  run(read('navigation.js'));
  run(read('line.js'));
  run(read('main.js').replace(/^boot\(\);$/m, ''));
  const S = run('S');
  c.S = S;
  c.project = run('project');
  c.lineById = run('lineById');
  c.lineUnread = run('lineUnread');

  const stored = {
    format:2, rev:'r1',
    project:{ id:'p', name:'PenEcho', trunk:'main', vault:{ path:'/docs', code:[] } },
    lines:clone(lines), landed:clone(landed), backlog:clone(backlog),
    files:[], pictures:[], notes:[], knowledge:[],
  };
  S.projects = [{ id:'p', name:'PenEcho' }];
  S.cur = 'p';
  S.route = { view:'home' };
  c.adoptState(clone(stored));

  c.api = (url, opts = {}) => new Promise((resolve, reject) => {
    const req = { url, method:opts.method || 'GET', body:opts.body, resolve, reject };
    req.ok = data => resolve(data || (req.method === 'GET' ? clone(stored) : { ok:true }));
    requests.push(req);
  });

  return { c, document, window, storage, requests, toasts, openedMenus, stored, historyObj, locationObj };
}

test('the sidebar opens its existing review plan lazily for parents and keeps the Cloud and leaf menus ordinary', async () => {
  const parent = makeLine({ id:'root', orchestratorRef:'PE-1', status:'working', running:true, landed:false, stations:[work('work-1', { state:'active' })] });
  const leaf = makeLine({ id:'leaf', orchestratedBy:'PE-1', status:'stopped', landed:false, stations:[work('work-1', { state:'error' })] });
  const railMenu = (h, lines) => {
    const { c, document } = h, S = c.S;
    const summary = { id:'p', name:'PenEcho', lines:lines.map(l => ({ ...l, shown:c.LINE_STATUS.shownState(l) })) };
    S.projects = [summary]; S.cur = 'other'; delete S.data.p;
    Object.assign(c, { summaryOf:() => summary, railLinePositions:{}, currentMenuAnchor:() => null, isSaving:() => false });
    vm.runInContext(pages.slice(pages.indexOf('const RAIL_LINES ='), pages.indexOf("ACT['rail-new-line']")), c);
    const host = document.createElement('nav'); host.id = 'railList';
    host.innerHTML = c.railLines(summary);
    document.body.append(host);
    return id => {
      const anchor = host.querySelector(`[data-line="${id}"]`).nextElementSibling;
      c.ACT['rail-line-menu'](anchor);
      return h.openedMenus.at(-1).items;
    };
  };

  const h = createHarness({ lines:[parent, leaf] });
  const menu = railMenu(h, [parent, leaf]);
  assert.ok(!menu('leaf').some(i => i.label === 'Mark reviewed…'));
  const actions = menu('root');
  assert.equal(actions.find(i => i.label === 'Mark reviewed').disabled, true);
  const tree = actions.find(i => i.label === 'Mark reviewed…');
  assert.equal(tree.disabled, false);
  assert.equal(h.requests.length, 0);
  const opening = tree.fn();
  assert.deepEqual(h.requests.map(r => r.url), ['/projects/p/state?for=light&full=root&base=']);
  h.requests[0].ok({ ...h.stored, view:'light', full:['root'], parts:[] });
  await opening;
  const pop = h.document.querySelector('#lpReviewPop');
  assert.ok(pop.querySelector('[data-rp-stopped]'), 'local Stopped opt-in uses the shared review dialog');
  assert.match(pop.textContent, /Will skip \(working\):.*root/);
  assert.equal(h.requests.length, 1);

  const stale = createHarness({ lines:[parent, leaf] });
  const staleMenu = railMenu(stale, [parent, leaf]);
  const unavailable = staleMenu('root').find(i => i.label === 'Mark reviewed…').fn();
  // A sub-Line that needs you can be ended from this dialog (PE-922); one that started working again cannot.
  const working = { ...leaf, status:'working', running:true, stations:[work('work-1', { state:'active' })] };
  stale.requests[0].ok({ ...stale.stored, lines:[parent, working], view:'home' });
  await unavailable;
  assert.equal(stale.document.querySelector('#lpReviewPop'), null);
  assert.equal(staleMenu('root').find(i => i.label === 'Mark reviewed…').disabled, true);
  assert.equal(stale.requests.length, 1);

  const hosted = createHarness({ lines:[parent, leaf], hosted:true });
  assert.ok(!railMenu(hosted, [parent, leaf])('root').some(i => i.label === 'Mark reviewed…'));
  assert.equal(hosted.requests.length, 0);
});

test('Orchestrator Line renders #lpSubLines sorted attention-first, keeps #lpProg and #lpFilters parent-only, and handles >5 + archived disclosure', () => {
  const parent = makeLine({
    id:'parent', code:'PE-751', title:'MCP Companion Page Redesign', orchestratorRef:'PE-751', status:'done',
    stations:[work('work-1', { reviewed:false }), work('work-2', { reviewed:false }), work('work-3', { reviewed:false }), work('work-4', { reviewed:false })],
  });
  const subWait = makeLine({ id:'sub-wait', code:'PE-770', title:'Needs answer', orchestratedBy:'PE-751', status:'waiting', landed:false, questions:[{ id:'q1', text:'Pick one?' }], lastActivityAt:100 });
  const subRun = makeLine({ id:'sub-run', code:'PE-778', title:'Cloud sync', orchestratedBy:'PE-751', status:'working', landed:false, running:true, stations:[work('work-1', { state:'active', reviewed:false })], lastActivityAt:200 });
  const subStop = makeLine({ id:'sub-stop', code:'PE-760', title:'Sidebar fallback', orchestratedBy:'PE-751', status:'stopped', landed:false, stations:[work('work-1', { state:'error', reviewed:false })], lastActivityAt:300 });
  const subRev = makeLine({ id:'sub-rev', code:'PE-752', title:'Header layout', orchestratedBy:'PE-751', status:'done', stations:[work('work-1', { reviewed:false }), work('work-2', { reviewed:false })], lastActivityAt:400 });
  const subQueue = makeLine({ id:'sub-queue', code:'PE-779', title:'Queued docs', orchestratedBy:'PE-751', status:'not-started', landed:false, queued:true, lastActivityAt:500 });
  const subDone = makeLine({ id:'sub-done', code:'PE-753', title:'Done & checked', orchestratedBy:'PE-751', status:'done', stations:[work('work-1', { reviewed:true })], lastActivityAt:600 });
  const subArch = makeLine({ id:'sub-arch', code:'PE-748', title:'Old wireframe', orchestratedBy:'PE-751', status:'closed', archived:true, closed:true, stations:[] });

  const h = createHarness({ lines:[parent, subDone, subRev, subStop, subRun, subWait], backlog:[subQueue], landed:[subArch] });
  h.c.go({ view:'line', line:'parent' });

  // Header shows Orchestrator role badge; no parent bar on root Orchestrator Line.
  assert.ok(h.document.querySelector('#lpHead .lp-role-badge'));
  assert.equal(h.document.querySelector('#lpParentBar'), null);

  // #lpProg and #lpFilters stay strictly parent-only (0/4 and 4 to review), plus the sub-Lines jump pill.
  assert.equal(h.document.querySelector('#lpProg').textContent.trim(), '0/4');
  assert.match(h.document.querySelector('#lpFilters .sum-review').textContent, /4 to review/);
  assert.match(h.document.querySelector('#lpFilters .sum-subs').textContent, /7 sub-Lines/);

  // #lpSubLines sits between #lpFilters/#lpCloud and #lpThread, capped at 5 active rows initially, sorted attention-first.
  const subs = h.document.querySelector('#lpSubLines');
  assert.equal(subs.hidden, false);
  const rows = [...subs.querySelectorAll('.lp-sub-row')];
  assert.deepEqual(rows.map(r => r.dataset.line), ['sub-wait', 'sub-run', 'sub-stop', 'sub-rev', 'sub-queue']);
  assert.match(rows[1].textContent, /Work 1 running/);
  assert.match(rows[3].textContent, /0\/2 to review/);
  assert.ok(rows[3].querySelector('.lp-sub-unread'), 'unread dot shown before opening or bulk review');

  // Show all reveals the 6th active sub-Line; archived stays behind disclosure until opened.
  assert.ok(subs.querySelector('[data-act="sublines-more"]'));
  assert.match(subs.querySelector('[data-act="sublines-archived"]').textContent, /1 archived sub-Line/);
  h.c.ACT['sublines-more'](subs.querySelector('[data-act="sublines-more"]'));
  assert.deepEqual([...h.document.querySelectorAll('#lpSubLines .lp-sub-row')].map(r => r.dataset.line), ['sub-wait', 'sub-run', 'sub-stop', 'sub-rev', 'sub-queue', 'sub-done']);
  assert.match(h.document.querySelector('#lpSubLines .lp-sub-row[data-line="sub-done"]').textContent, /1\/1 reviewed/);

  // Expand archived disclosure: archived row shows Archived chip and NEVER fake 0/0.
  h.c.ACT['sublines-archived'](h.document.querySelector('[data-act="sublines-archived"]'));
  const archRow = h.document.querySelector('#lpSubLines .lp-sub-row[data-line="sub-arch"]');
  assert.ok(archRow);
  assert.match(archRow.textContent, /Archived/);
  assert.doesNotMatch(archRow.textContent, /0\/0/);

  // Fold card header hides list body; focus-sublines unfolds it again.
  h.c.ACT['sublines-fold'](h.document.querySelector('[data-act="sublines-fold"]'));
  assert.equal(h.document.querySelector('#lpSubLines .lp-sublines-body'), null);
  h.c.ACT['focus-sublines']();
  assert.ok(h.document.querySelector('#lpSubLines .lp-sublines-body'));
});

test('Orchestrator Line with 0 sub-Lines hides #lpSubLines; when ALL sub-Lines are archived, shows them directly', () => {
  const solo = makeLine({ id:'solo', code:'PE-800', title:'Direct research', orchestratorRef:'PE-800' });
  const hist = makeLine({ id:'hist', code:'PE-801', title:'Historical job', orchestratorRef:'PE-801' });
  const oldSub = makeLine({ id:'old-sub', code:'PE-802', title:'Old part', orchestratedBy:'PE-801', status:'closed', archived:true, closed:true, stations:[] });
  const h = createHarness({ lines:[solo, hist], landed:[oldSub] });

  h.c.go({ view:'line', line:'solo' });
  assert.equal(h.document.querySelector('#lpSubLines').hidden, true);
  assert.ok(h.document.querySelector('#lpHead .lp-role-badge'));

  h.c.go({ view:'line', line:'hist' });
  assert.equal(h.document.querySelector('#lpSubLines').hidden, false);
  const archRow = h.document.querySelector('#lpSubLines .lp-sub-row[data-line="old-sub"]');
  assert.ok(archRow, 'archived child shown directly when no active children exist');
  assert.equal(h.document.querySelector('[data-act="sublines-archived"]'), null);
});

test('sub-Line .lp-parent-bar sits outside .lp-meta and handles active, archived, missing, duplicate PE-584, and nested orchestrators', () => {
  const activeParent = makeLine({ id:'p-active', code:'PE-751', title:'Active Parent', orchestratorRef:'PE-751', status:'working', landed:false, running:true });
  const archParent = makeLine({ id:'p-arch', code:'PE-700', title:'Archived Parent', orchestratorRef:'PE-700', status:'closed', archived:true, closed:true });
  const dup1 = makeLine({ id:'dup-1', code:'PE-584', title:'First PE-584', orchestratorRef:'PE-584', topicPath:'lines/dup-1.md', createdAt:Date.parse('2026-11-17T01:00:00Z') });
  const dup2 = makeLine({ id:'dup-2', code:'PE-584', title:'Old PE-584', orchestratorRef:'PE-584', status:'closed', archived:true, closed:true, topicPath:'archive/lines/dup-2.md', createdAt:Date.parse('2026-11-16T01:00:00Z') });

  const childActive = makeLine({ id:'c-active', code:'PE-752', title:'Normal Child', orchestratedBy:'PE-751' });
  const childArch = makeLine({ id:'c-arch', code:'PE-701', title:'Child of Archived', orchestratedBy:'PE-700' });
  const childMissing = makeLine({ id:'c-missing', code:'PE-702', title:'Orphan Child', orchestratedBy:'PE-999' });
  const childDup = makeLine({ id:'c-dup', code:'PE-585', title:'Ambiguous Child', orchestratedBy:'PE-584' });
  const nested = makeLine({ id:'nested', code:'PE-755', title:'Mid Orchestrator', orchestratorRef:'PE-755', orchestratedBy:'PE-751' });
  const grandChild = makeLine({ id:'grand', code:'PE-756', title:'Grandchild', orchestratedBy:'PE-755' });

  const h = createHarness({ lines:[activeParent, dup1, childActive, childArch, childMissing, childDup, nested, grandChild], landed:[archParent, dup2] });

  // 1. Unique active parent: bar is sibling of .lp-head-row inside #lpHead (NOT inside .lp-meta!).
  h.c.go({ view:'line', line:'c-active' });
  const bar = h.document.querySelector('#lpHead > #lpParentBar');
  assert.ok(bar, '.lp-parent-bar is direct child of #lpHead, outside .lp-meta');
  assert.equal(h.document.querySelector('.lp-meta #lpParentBar'), null);
  const link = bar.querySelector('[data-act="open-line"]');
  assert.equal(link.dataset.line, 'p-active');
  assert.match(link.textContent, /PE-751.*Active Parent.*Working/s);

  // 2. Archived parent: still linkable with Archived pill.
  h.c.go({ view:'line', line:'c-arch' });
  const archLink = h.document.querySelector('#lpParentBar [data-act="open-line"]');
  assert.equal(archLink.dataset.line, 'p-arch');
  assert.match(archLink.textContent, /PE-700.*Archived Parent.*Archived/s);

  // 3. Missing / deleted parent: non-clickable muted message.
  h.c.go({ view:'line', line:'c-missing' });
  assert.equal(h.document.querySelector('#lpParentBar [data-act="open-line"]'), null);
  assert.match(h.document.querySelector('#lpParentBar').textContent, /PE-999.*Parent not in this project/s);

  // 4. Duplicate legacy PE IDs: chooser button opens menu with status, path & date.
  h.c.go({ view:'line', line:'c-dup' });
  const pickBtn = h.document.querySelector('#lpParentBar [data-act="parent-pick"]');
  assert.ok(pickBtn);
  assert.match(pickBtn.textContent, /PE-584.*2 matching Lines/s);
  h.c.ACT['parent-pick'](pickBtn);
  assert.equal(h.openedMenus.length, 1);
  const items = h.openedMenus[0].items.filter(it => !it.head);
  assert.equal(items.length, 2);
  assert.match(items[0].note, /Active · lines\/dup-1\.md · 2026-11-17/);
  assert.match(items[1].note, /Archived · archive\/lines\/dup-2\.md · 2026-11-16/);

  // 5. Nested orchestrator-of-orchestrator shows both parent bar and direct children without self-matching.
  h.c.go({ view:'line', line:'nested' });
  assert.equal(h.document.querySelector('#lpParentBar [data-act="open-line"]').dataset.line, 'p-active');
  assert.deepEqual([...h.document.querySelectorAll('#lpSubLines .lp-sub-row')].map(r => r.dataset.line), ['grand']);
});

test('Back button preserves lineOrigin across Orchestrator -> Parent -> Sub-Line -> Back -> Back and all 4 entry paths', () => {
  const parent = makeLine({ id:'parent', code:'PE-751', title:'MCP Companion Page Redesign', orchestratorRef:'PE-751' });
  const child = makeLine({ id:'child', code:'PE-752', title:'Header layout', orchestratedBy:'PE-751', stations:[work('work-1')] });
  const h = createHarness({ lines:[parent, child] });

  // Path 1: Orchestrator tab -> Parent -> Sub-Line -> step selection -> Back -> Parent (scroll + orchestratorOrigin restored) -> Back -> Orchestrator tab.
  h.c.go({ view:'orchestrator' });
  h.document.querySelector('#view').scrollTop = 240;
  h.c.ACT['open-line']({ dataset:{ line:'parent' } });
  assert.equal(h.document.querySelector('.lp-back').textContent.trim(), 'Orchestrator');
  h.document.querySelector('#lpScroll').scrollTop = 135;

  const subRow = h.document.querySelector('#lpSubLines .lp-sub-row[data-line="child"]');
  h.c.ACT['open-line'](subRow);
  assert.equal(h.document.querySelector('.lp-back').textContent.trim(), 'PE-751');
  assert.equal(h.document.querySelector('.lp-back').title, 'Back to MCP Companion Page Redesign');

  // Selecting a Work on the sub-Line preserves lineOrigin.
  h.c.S.route = { view:'line', line:'child', step:'work-1' };
  h.c.syncHash(true);
  assert.equal(h.c.lineParentOrigin('p', 'child').fromLine, 'parent');

  // Back returns to Parent Line with scroll and parent's orchestratorOrigin restored.
  h.c.ACT['line-back']();
  assert.equal(h.c.S.route.view, 'line');
  assert.equal(h.c.S.route.line, 'parent');
  assert.equal(h.document.querySelector('#lpScroll').scrollTop, 135);
  assert.equal(h.document.querySelector('.lp-back').textContent.trim(), 'Orchestrator');

  // Second Back returns to Orchestrator tab with its original scroll!
  h.c.ACT['line-back']();
  assert.equal(h.c.S.route.view, 'orchestrator');
  assert.equal(h.document.querySelector('#view').scrollTop, 240);

  // Path 2: Project Home -> Sub-Line -> Back goes to Home while .lp-parent-bar links to Parent.
  h.c.go({ view:'home' });
  h.c.ACT['open-line']({ dataset:{ line:'child' } });
  assert.equal(h.document.querySelector('.lp-back').textContent.trim(), 'PenEcho');
  assert.equal(h.document.querySelector('#lpParentBar [data-act="open-line"]').dataset.line, 'parent');
  h.c.ACT['line-back']();
  assert.equal(h.c.S.route.view, 'home');

  // Path 4: Orchestrator tab -> Sub-Line directly -> Back returns to Orchestrator.
  h.c.go({ view:'orchestrator' });
  h.c.ACT['open-line']({ dataset:{ line:'child' } });
  assert.equal(h.document.querySelector('.lp-back').textContent.trim(), 'Orchestrator');
  h.c.ACT['line-back']();
  assert.equal(h.c.S.route.view, 'orchestrator');
});

test('Bulk Mark reviewed popover handles running parent, stopped opt-in, local unread sync, HOSTED constraints, and error rollback', async () => {
  const parent = makeLine({
    id:'parent', code:'PE-751', title:'Parent', orchestratorRef:'PE-751', status:'working', landed:false, running:true,
    stations:[work('work-1', { reviewed:false }), work('work-2', { state:'active', reviewed:false })],
  });
  const childDone = makeLine({ id:'child-done', code:'PE-752', title:'Done child', orchestratedBy:'PE-751', stations:[work('work-1', { reviewed:false }), work('work-2', { reviewed:false })] });
  const childStop = makeLine({ id:'child-stop', code:'PE-760', title:'Stopped child', orchestratedBy:'PE-751', status:'stopped', landed:false, stations:[work('work-1', { state:'error', reviewed:false })] });
  const childWait = makeLine({ id:'child-wait', code:'PE-761', title:'Waiting child', orchestratedBy:'PE-751', status:'waiting', landed:false, questions:[{ id:'q1', text:'Which?' }] });

  const h = createHarness({ lines:[parent, childDone, childStop, childWait] });
  h.c.go({ view:'line', line:'parent' });

  // Unread before bulk review.
  assert.equal(h.c.lineUnread(h.c.project(), h.c.lineById(h.c.project(), 'child-done')), true);

  // Open popover from #lpSubLines header even while parent is working.
  const btn = h.document.querySelector('#lpSubLines [data-act="review-tree-menu"]');
  assert.ok(btn);
  h.c.ACT['review-tree-menu'](btn);

  const pop = h.document.querySelector('#lpReviewPop');
  assert.ok(pop);
  // Option A (This Line only) is disabled because parent is working; Option B is selected by default.
  assert.equal(pop.querySelector('input[value="parent"]').hasAttribute('disabled'), true);
  assert.equal(pop.querySelector('input[value="tree"]').hasAttribute('checked'), true);
  assert.match(pop.textContent, /Still working/);
  assert.match(pop.textContent, /PE-752 \(2 Works\)/);
  assert.match(pop.textContent, /Will skip \(working\):.*PE-751/);
  // PE-922: a sub-Line that needs you can be ticked in; it is not ended unless the person does.
  assert.equal(pop.querySelector('[data-rp-waiting]').hasAttribute('checked'), false);
  assert.match(pop.textContent, /Also end & mark 1 Line that needs you, clearing its questions \(PE-761\)/);
  assert.doesNotMatch(pop.textContent, /Will skip \(needs you\)/);
  assert.equal(pop.querySelector('[data-act="review-tree-apply"]').textContent.trim(), 'Mark 1 Line reviewed');

  // Toggle opt-in checkbox for stopped sub-Line -> updates preview & count!
  const stoppedBox = pop.querySelector('[data-rp-stopped]');
  assert.ok(stoppedBox);
  assert.equal(stoppedBox.hasAttribute('checked'), false);
  stoppedBox.checked = true;
  stoppedBox.dispatchEvent(new h.window.Event('change', { bubbles:true }));
  assert.equal(pop.querySelector('[data-act="review-tree-apply"]').textContent.trim(), 'Mark 2 Lines reviewed');

  // Apply bulk review -> posts review-tree with includeStopped: true.
  const applying = h.c.ACT['review-tree-apply'](pop.querySelector('[data-act="review-tree-apply"]'));
  assert.equal(h.document.querySelector('#lpReviewPop'), null, 'popover closes on apply');
  assert.equal(h.c.lineById(h.c.project(), 'child-done').stations[0].reviewed, true, 'optimistic review applied');
  await turn();
  const post = h.requests.find(r => r.url.endsWith('/review-tree'));
  assert.ok(post);
  assert.deepEqual(JSON.parse(JSON.stringify(post.body)), { includeParent:true, includeSubLines:true, includeStopped:true, includeWaiting:false });

  // Update stored state and resolve POST + single state reload.
  h.stored.lines[1].stations.forEach(s => { s.reviewed = true; });
  h.stored.lines[2].status = 'done'; h.stored.lines[2].landed = true; h.stored.lines[2].stations[0].state = 'off'; h.stored.lines[2].stations[0].off = 'stopped'; h.stored.lines[2].stations[0].reviewed = true;
  post.ok({
    ok:true,
    marked:[
      { slug:'child-done', code:'PE-752', role:'child', worksMarked:2, settled:false },
      { slug:'child-stop', code:'PE-760', role:'child', worksMarked:1, settled:true },
    ],
    skipped:[
      { slug:'parent', code:'PE-751', role:'parent', reason:'running' },
      { slug:'child-wait', code:'PE-761', role:'child', reason:'waiting' },
    ],
    errors:[],
  });
  await turn();
  h.requests.at(-1).ok();
  await applying;
  await turn();

  // Unread dots cleared in localStorage for marked sub-Lines; toast reports summary.
  assert.equal(h.c.lineUnread(h.c.project(), h.c.lineById(h.c.project(), 'child-done')), false);
  assert.equal(h.c.lineUnread(h.c.project(), h.c.lineById(h.c.project(), 'child-stop')), false);
  assert.match(h.toasts.at(-1), /Marked 2 Lines reviewed \(3 Works\) · 1 working \(PE-751\) and 1 waiting \(PE-761\) skipped\./);

  // Cloud (HOSTED): stopped opt-in checkbox is hidden and no Orchestrator back origin is set.
  const hostedH = createHarness({ lines:[parent, childDone, childStop], hosted:true, readOnly:false });
  hostedH.c.go({ view:'line', line:'parent' });
  hostedH.c.ACT['review-tree-menu'](hostedH.document.querySelector('#lpSubLines [data-act="review-tree-menu"]'));
  assert.equal(hostedH.document.querySelector('#lpReviewPop [data-rp-stopped]'), null, 'stopped opt-in hidden on Cloud');
  assert.match(hostedH.document.querySelector('#lpReviewPop').textContent, /Will skip \(stopped\):.*PE-760/);

  // Read-only Cloud: no Mark reviewed button rendered anywhere in #lpSubLines.
  const readOnlyH = createHarness({ lines:[parent, childDone], hosted:true, readOnly:true });
  readOnlyH.c.go({ view:'line', line:'parent' });
  assert.equal(readOnlyH.document.querySelector('#lpSubLines [data-act="review-tree-menu"]'), null);

  // Server failure rolls back optimistic marks cleanly.
  const errH = createHarness({ lines:[makeLine({ id:'p', code:'PE-1', orchestratorRef:'PE-1', stations:[work('work-1', { reviewed:false })] }), makeLine({ id:'c', code:'PE-2', orchestratedBy:'PE-1', stations:[work('work-1', { reviewed:false })] })] });
  errH.c.go({ view:'line', line:'p' });
  // .lp-end offers both single-Line Mark all reviewed and secondary Mark with sub-Lines…; header ⋯ offers Mark reviewed…
  assert.ok(errH.document.querySelector('#lpThread .lp-all-reviewed'));
  assert.ok(errH.document.querySelector('#lpThread .lp-tree-reviewed'));
  errH.c.ACT['line-menu']({ dataset:{ line:'p' } });
  const thisLineGroup = errH.openedMenus.at(-1).items.find(g => g.group === 'This Line');
  assert.ok(thisLineGroup.items.some(it => it.label === 'Mark reviewed…'));

  const failing = errH.c.markTreeReviewed(errH.c.project(), errH.c.lineById(errH.c.project(), 'p'));
  assert.equal(errH.c.lineById(errH.c.project(), 'c').stations[0].reviewed, true, 'optimistically marked');
  await turn();
  errH.requests.find(r => r.url.endsWith('/review-tree')).reject(new Error('Network error'));
  await failing;
  assert.equal(errH.c.lineById(errH.c.project(), 'c').stations[0].reviewed, false, 'rolled back on failure');
  assert.equal(errH.toasts.at(-1), 'Network error');
});

test('PE-922: ticking a sub-Line that needs you ends it with the bulk Mark reviewed', async () => {
  const parent = makeLine({ id:'parent', code:'PE-751', title:'Parent', orchestratorRef:'PE-751', stations:[work('work-1', { reviewed:true })] });
  const childWait = makeLine({ id:'child-wait', code:'PE-761', title:'Waiting child', orchestratedBy:'PE-751', status:'waiting', landed:false, questions:[{ id:'q1', text:'Which?' }], stations:[work('work-1', { reviewed:false })] });
  const childReplyOnly = makeLine({ id:'child-unsent', code:'PE-763', title:'Not sent child', orchestratedBy:'PE-751', status:'waiting', landed:false, stations:[] });
  const h = createHarness({ lines:[parent, childWait, childReplyOnly] });
  h.c.go({ view:'line', line:'parent' });
  const btn = h.document.querySelector('#lpSubLines [data-act="review-tree-menu"]');
  assert.ok(btn, 'a sub-Line that needs you is enough to offer the bulk Mark reviewed');
  h.c.ACT['review-tree-menu'](btn);
  const pop = h.document.querySelector('#lpReviewPop');
  assert.match(pop.textContent, /Will skip \(needs you\):.*PE-763/, 'a Line with nothing of an agent to end is still skipped');
  assert.equal(pop.querySelector('[data-act="review-tree-apply"]').hasAttribute('disabled'), true);
  const box = pop.querySelector('[data-rp-waiting]');
  box.checked = true;
  box.dispatchEvent(new h.window.Event('change', { bubbles:true }));
  assert.match(pop.textContent, /Will mark reviewed:.*PE-761 \(end\)/);
  assert.equal(pop.querySelector('[data-act="review-tree-apply"]').textContent.trim(), 'Mark 1 Line reviewed');
  const applying = h.c.ACT['review-tree-apply'](pop.querySelector('[data-act="review-tree-apply"]'));
  const shown = h.c.lineById(h.c.project(), 'child-wait');
  assert.equal(shown.stations[0].reviewed, true, 'optimistically reviewed');
  assert.equal(require('../public/lines/line-status.js').lineNeedsYou(shown), false, 'optimistically no longer needs you');
  await turn();
  const post = h.requests.find(r => r.url.endsWith('/review-tree'));
  assert.deepEqual(JSON.parse(JSON.stringify(post.body)), { includeParent:true, includeSubLines:true, includeStopped:false, includeWaiting:true });
  post.ok({ ok:true, marked:[{ slug:'child-wait', code:'PE-761', role:'child', worksMarked:1, settled:true }], skipped:[], errors:[] });
  await turn();
  h.requests.at(-1).ok();
  await applying;
});

test('HOSTED suppresses orchestratorOrigin back link while keeping lineOrigin parent return', () => {
  const parent = makeLine({ id:'parent', code:'PE-751', title:'Parent', orchestratorRef:'PE-751' });
  const child = makeLine({ id:'child', code:'PE-752', title:'Child', orchestratedBy:'PE-751' });
  const h = createHarness({ lines:[parent, child], hosted:true });
  h.locationObj.hash = '#p/orchestrator';
  h.c.go({ view:'line', line:'parent' });
  assert.equal(h.document.querySelector('.lp-back').textContent.trim(), 'PenEcho', 'no Orchestrator back on Cloud');
  h.c.ACT['open-line'](h.document.querySelector('#lpSubLines .lp-sub-row[data-line="child"]'));
  assert.equal(h.document.querySelector('.lp-back').textContent.trim(), 'PE-751', 'lineOrigin still works on Cloud');
  h.c.ACT['line-back']();
  assert.equal(h.c.S.route.line, 'parent');
});

test('PE-894: Line detail renders Orchestrator routing reason across all 6 states, multi-part disclosure, archived parity, and Cloud suppression', () => {
  const delegated = makeLine({
    id:'del', code:'PE-892', title:'Continue button', orchestratorRef:'PE-892',
    route:'delegate',
    routeWhy:'Delegating full-stack work is clearly cheaper than doing it directly ($0.34 vs $2.27).',
    routeParts:'Add Continue button → Claude Code · opus · medium',
  });
  const delChild = makeLine({ id:'del-c1', code:'PE-893', title:'Implement Continue', orchestratedBy:'PE-892', status:'working', landed:false, running:true });
  const delPlanned = makeLine({
    id:'del-plan', code:'PE-895', title:'Planned delegate', orchestratorRef:'PE-895',
    route:'delegate', routeWhy:'Handing off to cheaper coder once brief is ready.',
  });
  const splitActive = makeLine({
    id:'split-act', code:'PE-751', title:'MCP Redesign', orchestratorRef:'PE-751',
    route:'split',
    routeWhy:'Splitting backend and UI work lets two specialists run in parallel.',
    routeParts:'API endpoints → Codex · gpt-6.2-sol; Visual layout → Claude Code · opus; Docs update → self',
  });
  const splitChildArch = makeLine({ id:'split-c1', code:'PE-752', title:'Old part', orchestratedBy:'PE-751', status:'closed', archived:true, closed:true });
  const splitPlanned = makeLine({
    id:'split-plan', code:'PE-896', title:'Planned split', orchestratorRef:'PE-896',
    route:'split', routeWhy:'Two independent deliverables will be split.',
  });
  const soloRoute = makeLine({
    id:'solo-r', code:'PE-894', title:'Direct fix', orchestratorRef:'PE-894',
    route:'self', routeWhy:'Single cohesive change takes minutes, so keeping it avoids handoff overhead.',
    routeParts:'Small UI fix → self',
  });
  const noRoute = makeLine({ id:'no-r', code:'PE-897', title:'Legacy orch', orchestratorRef:'PE-897' });
  const badRoute = makeLine({ id:'bad-r', code:'PE-898', title:'Invalid route', orchestratorRef:'PE-898', route:'unknown', routeWhy:'Should not render.' });

  const h = createHarness({
    lines:[delegated, delChild, delPlanned, splitActive, splitPlanned, soloRoute, noRoute, badRoute],
    landed:[splitChildArch],
  });

  // 1. Delegated (≥1 sub-Line): integrated inside #lpSubLines above .lp-sub-list, single-part uses hover title only.
  h.c.go({ view:'line', line:'del' });
  const subEl = h.document.querySelector('#lpSubLines');
  assert.equal(subEl.hidden, false);
  assert.equal(subEl.classList.contains('is-route-only'), false);
  const band = subEl.querySelector('.lp-sublines-body > .lp-route-band');
  assert.ok(band, 'route band sits directly inside .lp-sublines-body');
  assert.ok(band.classList.contains('is-active'));
  assert.equal(band.getAttribute('title'), 'Add Continue button → Claude Code · opus · medium');
  assert.equal(band.querySelector('.lp-route-label').textContent, 'Delegated');
  assert.match(band.querySelector('.lp-route-why').textContent, /clearly cheaper/);
  assert.equal(band.querySelector('[data-act="route-parts-toggle"]'), null, 'single-part route has no toggle pill');

  // Folding #lpSubLines shows route label in header summary.
  h.c.ACT['sublines-fold'](subEl.querySelector('[data-act="sublines-fold"]'));
  assert.equal(h.document.querySelector('#lpSubLines .lp-route-band'), null);
  assert.match(h.document.querySelector('#lpSubLines .lp-sublines-sum').textContent, /Delegated · 1 working/);

  // 2. Delegation planned (0 sub-Lines): standalone calm is-route-only card, no Sub-Lines header.
  h.c.go({ view:'line', line:'del-plan' });
  assert.equal(h.document.querySelector('#lpSubLines').hidden, false);
  assert.equal(h.document.querySelector('#lpSubLines').classList.contains('is-route-only'), true);
  assert.equal(h.document.querySelector('#lpSubLines .lp-sublines-head'), null);
  assert.equal(h.document.querySelector('#lpSubLines .lp-route-label').textContent, 'Delegation planned');

  // 3. Split with archived sub-Line only: still reads "Split" (archived-child parity) + expandable 3 parts disclosure preserved across refreshLine().
  h.c.go({ view:'line', line:'split-act' });
  assert.equal(h.document.querySelector('#lpSubLines').classList.contains('is-route-only'), false);
  assert.equal(h.document.querySelector('#lpSubLines .lp-route-label').textContent, 'Split');
  const toggle = h.document.querySelector('#lpSubLines [data-act="route-parts-toggle"]');
  assert.ok(toggle, 'multi-part route renders N parts toggle');
  assert.match(toggle.textContent, /3 parts/);
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(h.document.querySelector('#lpSubLines .lp-route-parts'), null);
  h.c.ACT['route-parts-toggle'](toggle);
  const items = [...h.document.querySelectorAll('#lpSubLines .lp-route-parts li')];
  assert.equal(items.length, 3);
  assert.match(items[0].textContent, /API endpoints.*Codex · gpt-6\.2-sol/);
  assert.match(items[2].textContent, /Docs update.*self/);
  h.c.refreshLine();
  assert.equal(h.document.querySelectorAll('#lpSubLines .lp-route-parts li').length, 3, 'parts disclosure persists across refreshLine');

  // 4. Split planned (0 sub-Lines).
  h.c.go({ view:'line', line:'split-plan' });
  assert.equal(h.document.querySelector('#lpSubLines').classList.contains('is-route-only'), true);
  assert.equal(h.document.querySelector('#lpSubLines .lp-route-label').textContent, 'Split planned');

  // 5. Worked alone (0 sub-Lines).
  h.c.go({ view:'line', line:'solo-r' });
  assert.equal(h.document.querySelector('#lpSubLines').classList.contains('is-route-only'), true);
  assert.equal(h.document.querySelector('#lpSubLines .lp-route-label').textContent, 'Worked alone');
  assert.equal(h.document.querySelector('#lpSubLines .lp-route-band').getAttribute('title'), 'Small UI fix → self');

  // 6. Missing or invalid route with 0 sub-Lines keeps #lpSubLines hidden.
  h.c.go({ view:'line', line:'no-r' });
  assert.equal(h.document.querySelector('#lpSubLines').hidden, true);
  h.c.go({ view:'line', line:'bad-r' });
  assert.equal(h.document.querySelector('#lpSubLines').hidden, true);

  // 7. Cloud (HOSTED): route band is suppressed on both 0-child and N-child Orchestrator Lines (R9).
  const hostedH = createHarness({ lines:[delegated, delChild, soloRoute], hosted:true });
  hostedH.c.go({ view:'line', line:'del' });
  assert.equal(hostedH.document.querySelector('#lpSubLines').hidden, false);
  assert.equal(hostedH.document.querySelector('#lpSubLines .lp-route-band'), null);
  hostedH.c.go({ view:'line', line:'solo-r' });
  assert.equal(hostedH.document.querySelector('#lpSubLines').hidden, true);
});

test('PE-894: Service lineFrom exposes route/routeWhy/routeParts on Orchestrator Lines only and omits them from railLine', () => {
  const { Service } = require('../src/server/project-lines/service.js');
  const tmp = fs.mkdtempSync(path.join(__dirname, '../.tmp-route-'));
  const docs = path.join(tmp, 'docs'), stateDir = path.join(tmp, 'state');
  fs.mkdirSync(path.join(docs, 'lines'), { recursive:true });
  fs.writeFileSync(path.join(docs, 'lines', 'orch-ok.md'), [
    '---',
    'id: PE-901',
    'title: Delegated job',
    'orchestrator: yes',
    'route: delegate',
    'route why: Cheaper local coder handles the coupled change.',
    'route parts: Implement feature → Claude Code · opus',
    'status: done',
    '---',
    '',
    '## Ask · 2026-11-21 10:00',
    'Build it.',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(docs, 'lines', 'orch-bad.md'), [
    '---',
    'id: PE-902',
    'title: Invalid route',
    'orchestrator: yes',
    'route: bogus',
    'route why: Should be ignored.',
    'status: done',
    '---',
    '',
    '## Ask · 2026-11-21 10:00',
    'Check it.',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(docs, 'lines', 'plain.md'), [
    '---',
    'id: PE-903',
    'title: Non-orchestrator line',
    'route: self',
    'route why: Not an orchestrator line.',
    'status: done',
    '---',
    '',
    '## Ask · 2026-11-21 10:00',
    'Plain ask.',
    '',
  ].join('\n'));
  const svc = new Service({ directory:stateDir, keepAgents:false });
  try {
    const project = { id:'p-route', name:'RouteTest', docsPath:docs, codePaths:[], vault:{ path:docs, code:[] } };
    const full = svc.stateOf(project);
    const okLine = full.lines.find(l => l.slug === 'orch-ok');
    const badLine = full.lines.find(l => l.slug === 'orch-bad');
    const plainLine = full.lines.find(l => l.slug === 'plain');
    assert.equal(okLine.route, 'delegate');
    assert.equal(okLine.routeWhy, 'Cheaper local coder handles the coupled change.');
    assert.equal(okLine.routeParts, 'Implement feature → Claude Code · opus');
    assert.equal(badLine.route, undefined);
    assert.equal(badLine.routeWhy, undefined);
    assert.equal(plainLine.route, undefined);
    assert.equal(plainLine.routeWhy, undefined);

    // for=rail, for=home, and non-open lines in for=line omit route/routeWhy/routeParts so background polls stay slim,
    // while the open line in for=line keeps them.
    for (const view of ['rail', 'home']) {
      const slim = svc.stateFor(project, view).lines.find(l => l.slug === 'orch-ok');
      assert.equal(slim.orchestratorRef, 'PE-901');
      assert.equal(slim.route, undefined);
      assert.equal(slim.routeWhy, undefined);
      assert.equal(slim.routeParts, undefined);
    }

    const lineView = svc.stateFor(project, 'line', { line:'orch-ok' });
    const openOk = lineView.lines.find(l => l.slug === 'orch-ok');
    assert.equal(openOk.route, 'delegate');
    assert.equal(openOk.routeWhy, 'Cheaper local coder handles the coupled change.');
    assert.equal(openOk.routeParts, 'Implement feature → Claude Code · opus');

    const otherLineView = svc.stateFor(project, 'line', { line:'plain' });
    const closedOk = otherLineView.lines.find(l => l.slug === 'orch-ok');
    assert.equal(closedOk.route, undefined);
    assert.equal(closedOk.routeWhy, undefined);
    assert.equal(closedOk.routeParts, undefined);
  } finally {
    svc.close?.();
    fs.rmSync(tmp, { recursive:true, force:true });
  }
});


