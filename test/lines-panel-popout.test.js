'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('./helpers/dom.js');

const read = name => fs.readFileSync(path.join(__dirname, '../public/lines', name), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const turn = () => new Promise(resolve => setImmediate(resolve));

function createHarness({
  width = 1600,
  desktop = false,
  embed = null,
  lines = null,
  knowledge = [],
  files = [],
  docs = {},
  extraProjects = [],
} = {}) {
  const { document, window } = parseHTML(
    '<html><body><div id="app"><aside id="rail"></aside><div class="shell"><header id="projbar"></header><main id="view"></main></div></div>' +
    '<div id="switcher" hidden><div id="swList"></div><div id="swPreview"></div></div>' +
    '<div id="lightbox" hidden></div><div id="toast" hidden></div></body></html>'
  );
  document.querySelector('#app').inert = false;
  let focused = document.body;
  Object.defineProperty(document, 'activeElement', { configurable:true, get:() => focused?.isConnected ? focused : document.body });
  window.HTMLElement.prototype.focus = function () { focused = this; };
  window.HTMLElement.prototype.select = function () {};
  window.HTMLElement.prototype.scrollTo = function (opts, y) {
    if (opts && typeof opts === 'object' && opts.top != null) this.scrollTop = opts.top;
    else if (typeof y === 'number') this.scrollTop = y;
  };
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.HTMLElement.prototype.getClientRects = function () {
    return this.isConnected && !this.hidden ? [this.getBoundingClientRect()] : [];
  };
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return { left:120, top:80, right:280, bottom:114, width:160, height:34 };
  };

  const winListeners = new Map();
  const addEventListener = (type, fn, opts) => {
    if (!winListeners.has(type)) winListeners.set(type, []);
    winListeners.get(type).push({ fn, capture:Boolean(opts === true || opts?.capture) });
  };
  const dispatchWinKey = key => {
    let defaultPrevented = false, propagationStopped = false;
    const ev = {
      key,
      target:focused,
      get defaultPrevented() { return defaultPrevented; },
      preventDefault() { defaultPrevented = true; },
      stopPropagation() { propagationStopped = true; },
      stopImmediatePropagation() { propagationStopped = true; },
    };
    const docEv = new window.Event('keydown', { bubbles:true, cancelable:true });
    docEv.key = key;
    docEv.preventDefault = () => { defaultPrevented = true; };
    const origStop = docEv.stopPropagation.bind(docEv);
    docEv.stopPropagation = () => { propagationStopped = true; origStop(); };
    (focused || document.body).dispatchEvent(docEv);
    if (!propagationStopped) {
      for (const h of winListeners.get('keydown') || []) h.fn(ev);
    }
    return ev;
  };

  const storage = new Map();
  let hash = '#p/line/alpha';
  const historyObj = { state:null, replaceState(state, _t, value) { hash = value; this.state = state; } };
  const locationObj = {
    get hash() { return hash; },
    set hash(v) { hash = v; historyObj.state = null; },
    origin:'http://127.0.0.1:3889', pathname:'/projects.html', search:'',
  };

  const defaultWork1 = {
    id:'work-1', index:0, kind:'work', label:'Work 1', state:'done', reviewed:false,
    off:'', agent:'codex', took:'2 min', out:'First result', detail:'works/alpha/work-1.md',
    pictures:[], files:[], refers:[],
  };
  const defaultWork2 = {
    id:'work-2', index:1, kind:'work', label:'Work 2', state:'wait', reviewed:false,
    off:'', agent:'claude', took:'4 min', out:'Second result', detail:'works/alpha/work-2.md',
    pictures:[], files:[], refers:[],
  };
  const defaultLines = lines || [
    {
      id:'alpha', slug:'alpha', code:'PE-1', title:'Alpha line',
      status:'wait', landed:false, closed:false, archived:false, queued:false, todo:false,
      running:false, elsewhere:false, asking:null, questions:[], commit:'', branch:'feat/alpha',
      readRevision:'rev-alpha', createdAt:Date.parse('2026-11-20T03:00:00Z'), lastActivityAt:Date.parse('2026-11-20T05:00:00Z'),
      topicPath:'lines/alpha.md', workdir:'/repo/app',
      ask:{ text:'Build it', when:'2026-11-20 03:00', files:[], later:[] },
      result:{ text:'', files:[] }, pictures:[], stations:[defaultWork1, defaultWork2],
    },
    {
      id:'beta', slug:'beta', code:'PE-2', title:'Beta line',
      status:'done', landed:true, closed:false, archived:false, queued:false, todo:false,
      running:false, elsewhere:false, asking:null, questions:[], commit:'', branch:'',
      readRevision:'rev-beta', createdAt:Date.parse('2026-11-20T04:00:00Z'), lastActivityAt:Date.parse('2026-11-20T06:00:00Z'),
      topicPath:'lines/beta.md', workdir:'/repo/app',
      ask:{ text:'Second line', when:'2026-11-20 04:00', files:[], later:[] },
      result:{ text:'', files:[] }, pictures:[], stations:[{ ...defaultWork1, id:'work-1', out:'Beta result', detail:'' }],
    },
  ];
  const defaultFiles = [
    { path:'works/alpha/work-1.md', mtime:100, size:120 },
    { path:'works/alpha/work-2.md', mtime:100, size:240 },
    { path:'files/alpha/report.md', mtime:100, size:200 },
    ...files,
  ];
  const docBodies = {
    'works/alpha/work-1.md':'# Work 1\n\n## Result\n\nFirst full markdown result with [report](../../files/alpha/report.md).\n',
    'works/alpha/work-2.md':'# Work 2\n\n## Result\n\nSecond full markdown result.\n\n| Col | Val |\n| --- | --- |\n| A | 1 |\n',
    'files/alpha/report.md':'# Report\n\nDetailed report contents.\n',
    ...docs,
  };

  let curWidth = width;
  const viewEl = document.querySelector('#view');
  Object.defineProperty(viewEl, 'clientWidth', { configurable:true, get:() => curWidth });

  const rafTimers = new Map();
  let rafId = 0;
  const testSetTimeout = (fn, ms, ...args) => {
    const t = setTimeout(fn, ms, ...args);
    t.unref?.();
    return t;
  };
  const c = vm.createContext({
    document, window, Event:window.Event, console, Object, Array, Map, Set, Date, Promise, JSON, Math, Number, String, Boolean,
    Intl, encodeURIComponent, decodeURIComponent, RegExp, Error, performance,
    setTimeout:testSetTimeout, clearTimeout,
    requestAnimationFrame:fn => {
      const id = ++rafId;
      const t = testSetTimeout(() => { rafTimers.delete(id); fn(); }, 16);
      rafTimers.set(id, t);
      return id;
    },
    cancelAnimationFrame:id => {
      const t = rafTimers.get(id);
      if (t) { clearTimeout(t); rafTimers.delete(id); }
    },
    matchMedia:() => ({ matches:true }),
    get innerWidth() { return curWidth; },
    innerHeight:960,
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
    EMBED:embed, HOSTED:false, SEND:{}, Pano:{ sheet:null, mount() {}, update() {} }, SHEET:null,
    SET:{}, SETTINGS_PAGES:new Set(['settings', 'agents', 'providers', 'setup', 'archived']),
    LINE_STATUS:require('../public/lines/line-status.js'),
    WORK_PRICING:require('../public/lines/work-pricing.js'),
    STATE_COLOR:{ working:'#0d9488', review:'#d98a1f', ready:'#16a34a', landed:'#16a34a', error:'#b4232c', wait:'#d98a1f', todo:'#64748b', notes:'#64748b' },
    countsHTML:n => `<span class="tp-n">${n.open ? `<b>${n.open} open</b>` : ''}${n.done ? `<i>${n.done} done</i>` : ''}</span>`,
    topicCounts:() => () => ({ open:1, done:0 }),
    addEventListener, removeEventListener() {},
    getComputedStyle(el) {
      const narrow = curWidth <= 860;
      const overlays = el?.id === 'lpPanel' ? embed || (desktop && narrow) : narrow;
      return { position:overlays ? 'absolute' : 'static', fontSize:'18px' };
    },
    api:async url => {
      if (url.includes('/activity')) return { rows:[], seq:0, running:false, started:0, now:'' };
      if (url.includes('/diff')) return { files:[], truncated:false };
      if (url.includes('/doc?')) {
        const docPath = decodeURIComponent(url.split('path=')[1].split('&')[0]);
        return { md:docBodies[docPath] || '', hash:'h1', mtime:100 };
      }
      if (url.includes('/state')) return clone(storedById[c.S.cur] || storedP);
      return {};
    },
    fetch:async url => {
      const s = String(url || '');
      const data = s.includes('/activity') ? { rows:[], seq:0, running:false, started:0, now:'' }
        : s.includes('/diff') ? { files:[], truncated:false }
          : s.includes('/doc?') ? { md:docBodies[decodeURIComponent(s.split('path=')[1].split('&')[0])] || '', hash:'h1', mtime:100 }
            : s.includes('/state') ? clone(storedById[c.S.cur] || storedP)
              : {};
      return {
        ok:true, status:200,
        headers:{ get:k => (String(k).toLowerCase() === 'content-type' ? 'application/json' : null) },
        json:async () => data,
        text:async () => JSON.stringify(data),
        blob:async () => ({ size:0, text:async () => '' }),
      };
    },
    loadDoc:async (_p, docPath) => ({ path:docPath, mtime:100, md:docBodies[docPath] || '' }),
    docById:(docPath) => (docBodies[docPath] != null ? { path:docPath, mtime:100, md:docBodies[docPath] } : null),
    docByPath:(p, docPath) => (docBodies[docPath] != null ? { path:docPath, mtime:100, md:docBodies[docPath] } : null),
    fileEntry:(p, filePath) => (p.files || []).find(f => f.path === filePath) || null,
    fileUrl:(p, filePath) => `/api/lines/projects/${p.id}/file?path=${encodeURIComponent(filePath)}`,
    assetUrl:(p, filePath) => `/api/lines/projects/${p.id}/file?path=${encodeURIComponent(filePath)}`,
    canvasByPath:() => null, canvasUrl:() => '',
    renderRail() {}, renderProjbar() {}, refreshChrome() {}, refreshDesk() {}, renderTray() {},
    refreshBelow() {}, refreshEmptyAgents() {}, refreshFiles() {}, fvRefresh() {}, fvBackTo() {}, fvPendingTry() {},
    wireComposers() {}, syncComposer() {}, boxUrls() {},
    composerHTML:() => '<form class="composer" data-comp="c1"><textarea class="cmp-input"></textarea></form>',
    availableAgents:() => [{ id:'codex', name:'Codex', available:true }, { id:'claude', name:'Claude', available:true }],
    runPresets:() => [], runnablePresets:() => [], defaultPreset:() => null, presetById:() => null,
    nodeIcon:() => '', stateChip:(st, l) => `<span class="chip c-${st}">${l.status}</span>`,
    homeHTML:() => '<div id="homePage">Home</div>',
    docHTML:() => '<div id="docPage">Doc</div>',
    topicsPageHTML:() => '', canvasesHTML:() => '', statsHTML:() => '', memoryHTML:() => '',
    vaultHTML:() => '', findHTML:() => '', archiveHTML:() => '', deletedHTML:() => '',
    settingsHTML:() => '', orchestratorHTML:() => '', markupHTML:() => '',
    embedRailOnly:() => false, embedKeeps:() => true, embedShown() {}, hostedAddress() {}, hostedBoot() {},
    rememberTabs() {}, rememberBoxes() {}, keepRail() {}, keepPage() {}, wireDrop() {},
    lacks:() => null, routeNeeds:() => ({}), holdFor:() => null, readLineFiles() {}, homeShape:() => 'code',
    showRow() {}, zoomIn() {}, zoomOutClone() {}, flightToLine:() => null, flightToHome:() => null,
    settingsUp:() => false, closeSettings() {}, dropSettingsModal() {}, finishEdit:async () => true,
    readOpenedLine() {}, boxKey:x => x, comp:() => ({ refers:[], files:[] }),
    copyText:async () => true,
    mcGlyph:() => '<svg class="mc-ic"></svg>', mcLinksFor:() => [], mcLinkChips:() => '',
    mcMinutes:md => `<div class="mc-minutes">${md}</div>`, mcActionsHTML:() => '', mcDiagramsHTML:() => '',
    mcIsExample:() => false, mcState:() => 'off', MC:{ one:{}, links:{} },
    fvItem:() => null, fvIsText:() => false,
    tokenWorkHTML:() => '', tokenLineHTML:() => '',
    FILE_ICON:() => 'doc',
  });

  const run = code => vm.runInContext(code, c);
  run(read('core.js'));
  run(read('state.js'));
  run(read('navigation.js'));
  run(read('markdown.js'));
  run(read('line.js'));
  run(read('merge.js'));
  run(read('meetcue.js').replace(/^loadMeetcue\(\);$/m, ''));
  run(read('pages.js'));
  run(read('main.js').replace(/^boot\(\);$/m, ''));
  run('VIEWS.home = () => "<div id=\\"homePage\\">Home</div>";');
  Object.assign(c, run('({ ACT, adoptState, go, lineById, menuOutside, openMenu, project, refreshLine, render, switchProject })'), {
    refreshChrome() {}, renderRail() {}, renderProjbar() {}, readOpenedLine() {},
    boxUrls() {}, wireComposers() {}, syncComposer() {},
  });

  const storedP = {
    format:2, rev:'r1',
    project:{ id:'p', name:'PenEcho', trunk:'main', vault:{ path:'/docs', code:[] } },
    lines:clone(defaultLines), landed:[], backlog:[],
    files:clone(defaultFiles), pictures:[], notes:[], knowledge:clone(knowledge),
  };
  const storedById = { p:storedP };
  const S = run('S');
  S.projects = [{ id:'p', name:'PenEcho' }];
  for (const extra of extraProjects) {
    S.projects.push({ id:extra.id, name:extra.name || extra.id });
    storedById[extra.id] = {
      format:2, rev:'r1',
      project:{ id:extra.id, name:extra.name || extra.id, trunk:'main', vault:{ path:'/docs-' + extra.id, code:[] } },
      lines:clone(extra.lines || defaultLines), landed:[], backlog:[],
      files:clone(defaultFiles), pictures:[], notes:[], knowledge:[],
    };
    c.adoptState(clone(storedById[extra.id]));
  }
  S.cur = 'p';
  c.adoptState(clone(storedP));
  run('bindGlobal()');

  return {
    c, S, document, window, storedP,
    $:sel => document.querySelector(sel),
    $$:sel => [...document.querySelectorAll(sel)],
    setWidth:w => { curWidth = w; },
    dispatchWinKey,
    setFocus:el => { focused = el; },
    openLine:(lineId = 'alpha', stepId = '') => {
      c.go({ view:'line', line:lineId, ...(stepId ? { step:stepId } : {}) });
    },
  };
}

test('panel pop-out button renders in .lpp-tools across Work, Merge, Finished, and MeetCue panels and toggles modal view', () => {
  const h = createHarness({
    lines:[
      {
        id:'alpha', slug:'alpha', code:'PE-1', title:'Alpha', status:'ready', landed:false, closed:false, archived:false,
        queued:false, todo:false, running:false, elsewhere:false, asking:null, questions:[], commit:'', branch:'feat',
        topicPath:'lines/alpha.md', ask:{ text:'Go', when:'2026-11-20 03:00', files:[], later:[] },
        result:{ text:'', files:[] }, pictures:[],
        stations:[
          { id:'work-1', index:0, kind:'work', label:'Work 1', state:'done', reviewed:false, off:'', agent:'codex', took:'2 min', out:'Done', pictures:[], files:[], refers:[] },
          { id:'meet-1', index:1, kind:'meeting', label:'Meeting', state:'done', text:'**Design sync** · 30 min\n\nNotes here.', pictures:[], files:[], refers:[] },
          { id:'merge-1', index:2, kind:'merge', label:'Merge', state:'wait', agent:'', out:'', pictures:[], files:[], refers:[] },
          { id:'finished', index:3, kind:'deliver', label:'Finished', state:'done', finished:true, agent:'', out:'', pictures:[], files:[], refers:[] },
        ],
      },
    ],
  });

  h.openLine('alpha', 'work-1');
  const assertToggle = label => {
    const btn = h.$('#lpPanel .lpp-tools [data-act="panel-pop"]');
    assert.ok(btn, `${label}: pop-out button exists inside .lpp-tools`);
    assert.equal(btn.getAttribute('aria-pressed'), 'false');
    assert.equal(btn.getAttribute('aria-label'), 'Larger view');
    assert.equal(btn.title, 'Larger view');
    assert.equal(btn.querySelector('svg').getAttribute('viewBox'), '0 0 24 24');
    assert.match(btn.innerHTML, /M4\.500 9V4\.500H9/);

    h.c.ACT['panel-pop'](btn);
    assert.equal(h.S.panelPopped, true, `${label}: S.panelPopped turns true`);
    assert.ok(h.$('#lpPanel').classList.contains('is-popped'));
    assert.ok(h.$('#linePage').classList.contains('panel-popped'));
    assert.equal(h.$('#lpPanel').getAttribute('role'), 'dialog');
    assert.equal(h.$('#lpPanel').getAttribute('aria-modal'), 'true');
    assert.equal(h.$('#lpPanelBackdrop').hidden, false);
    assert.equal(btn.getAttribute('aria-pressed'), 'true');
    assert.equal(btn.getAttribute('aria-label'), 'Back to side panel');
    assert.equal(btn.title, 'Back to side panel');
    assert.match(btn.innerHTML, /M9 4\.500V9H4\.500/);

    h.c.ACT['panel-pop'](btn);
    assert.equal(h.S.panelPopped, false, `${label}: second toggle collapses back`);
    assert.equal(h.$('#lpPanel').classList.contains('is-popped'), false);
    assert.equal(h.$('#linePage').classList.contains('panel-popped'), false);
    assert.equal(h.$('#lpPanelBackdrop').hidden, true);
    assert.equal(h.$('#lpPanel').getAttribute('role'), null);
    assert.equal(h.S.lineSel?.id, h.$('#lpPanel').dataset.step);
  };

  assertToggle('Work');
  h.openLine('alpha', 'meet-1');
  assertToggle('MeetCue');
  h.openLine('alpha', 'merge-1');
  assertToggle('Merge');
  h.openLine('alpha', 'finished');
  assertToggle('Finished');
});

test('Escape, backdrop click, and Close button behave distinctly when popped out vs docked (including with Topic fallback)', () => {
  const topic = { title:'Reports', path:'topics/reports.md', lines:['alpha'], goal:'Keep reading.', left:['Step 1'] };
  const h = createHarness({ knowledge:[topic] });

  h.openLine('alpha', 'work-2');
  h.c.ACT['panel-pop']();
  assert.equal(h.S.panelPopped, true);

  // Escape collapses popped-out panel back to docked side panel without discarding selected Work.
  h.dispatchWinKey('Escape');
  assert.equal(h.S.panelPopped, false);
  assert.equal(h.$('#lpPanel').classList.contains('is-popped'), false);
  assert.equal(h.$('#lpPanelBackdrop').hidden, true);
  assert.equal(h.S.lineSel?.id, 'work-2');
  assert.equal(h.$('#lpPanel').hidden, false);
  assert.equal(h.S.panelShut, undefined);

  // Escape when docked closes the panel completely (falling back to Topic on this Line).
  h.dispatchWinKey('Escape');
  assert.equal(h.S.lineSel, null);
  assert.equal(h.S.panelShut, 'alpha');
  assert.match(h.$('#lpPanel').textContent, /Reports/);

  // Re-open Work, pop out, then click backdrop -> collapses back to docked keeping Work selected.
  h.c.ACT['line-work']({ dataset:{ line:'alpha', step:'work-1' } });
  h.c.ACT['panel-pop']();
  assert.equal(h.S.panelPopped, true);
  h.$('#lpPanelBackdrop').click();
  assert.equal(h.S.panelPopped, false);
  assert.equal(h.S.lineSel?.id, 'work-1');
  assert.equal(h.$('#lpPanelBackdrop').hidden, true);

  // Pop out again, then click X close button -> closes Work AND resets expanded state + backdrop.
  h.c.ACT['panel-pop']();
  assert.equal(h.S.panelPopped, true);
  h.c.ACT['panel-close']();
  assert.equal(h.S.panelPopped, false);
  assert.equal(h.S.lineSel, null);
  assert.equal(h.$('#lpPanel').classList.contains('is-popped'), false);
  assert.equal(h.$('#linePage').classList.contains('panel-popped'), false);
  assert.equal(h.$('#lpPanelBackdrop').hidden, true);
});

test('Work panel header omits Earlier/Later work buttons, and switching works keeps larger view open across live refresh', async () => {
  const h = createHarness();
  h.openLine('alpha', 'work-2');
  await turn();
  assert.equal(h.$('#lpPanel .lpp-tools [data-act="panel-go"]'), null, 'no panel-go button in .lpp-tools');
  assert.equal(h.$('#lpPanel .lpp-tools [aria-label="Earlier work"]'), null, 'Earlier work button removed');
  assert.equal(h.$('#lpPanel .lpp-tools [aria-label="Later work"]'), null, 'Later work button removed');
  h.c.ACT['panel-pop']();
  assert.equal(h.S.panelPopped, true);

  // Switching to Work 1 via the thread card keeps larger view open.
  h.c.ACT['line-work']({ dataset:{ line:'alpha', step:'work-1' } });
  assert.equal(h.S.lineSel?.id, 'work-1');
  assert.equal(h.S.panelPopped, true);
  assert.ok(h.$('#lpPanel').classList.contains('is-popped'));
  assert.equal(h.$('#lpPanelBackdrop').hidden, false);
  assert.equal(h.$('#lpPanel [data-act="panel-pop"]').getAttribute('aria-pressed'), 'true');
  assert.equal(h.$('#lpPanel .lpp-tools [data-act="panel-go"]'), null);

  // Switching back to Work 2 keeps larger view open too.
  h.c.ACT['line-work']({ dataset:{ line:'alpha', step:'work-2' } });
  assert.equal(h.S.lineSel?.id, 'work-2');
  assert.equal(h.S.panelPopped, true);
  assert.ok(h.$('#lpPanel').classList.contains('is-popped'));

  // Interactive controls inside popped panel keep working and preserve popped state.
  await turn();
  const srcBtn = h.$('#lpPanel [data-act="result-mode"]');
  assert.ok(srcBtn, 'source toggle renders in popped panel');
  h.c.ACT['result-mode'](srcBtn);
  await turn();
  assert.ok(h.$('#lppResult .src'), 'toggles to Markdown source inside popped panel');
  assert.equal(h.S.panelPopped, true);
  h.c.ACT['result-mode'](h.$('#lpPanel [data-act="result-mode"]'));
  await turn();
  assert.ok(h.$('#lppResult .at-say'), 'toggles back to reading view inside popped panel');
  assert.equal(h.S.panelPopped, true);

  const footBtn = h.$('#lppFoot');
  assert.ok(footBtn);
  h.c.ACT['panel-details'](footBtn);
  assert.equal(h.$('#lppDetails').hidden, false, 'Details expands inside popped panel');
  assert.equal(h.S.panelPopped, true);
  h.c.ACT['panel-details'](footBtn);
  assert.equal(h.$('#lppDetails').hidden, true, 'Details collapses inside popped panel');
  assert.equal(h.S.panelPopped, true);

  // Scroll down inside #lppScroll and keep focus on the expand/collapse button.
  const scroller = h.$('#lppScroll');
  scroller.scrollTop = 210;
  const expandBtn = h.$('#lpPanel [data-act="panel-pop"]');
  expandBtn.focus();

  // Simulate background poll updating Work 2 status and result output, then refreshLine().
  const line = h.c.lineById(h.c.project(), 'alpha');
  line.stations[1].state = 'done';
  line.stations[1].out = 'Updated live output!';
  h.c.refreshLine();
  await turn();

  assert.equal(h.S.panelPopped, true);
  assert.ok(h.$('#lpPanel').classList.contains('is-popped'));
  assert.equal(h.$('#lpPanelBackdrop').hidden, false);
  assert.equal(h.$('#lppScroll'), scroller, 'scroller element is reused across refresh');
  assert.equal(scroller.scrollTop, 210, 'scrollTop is preserved across live refresh');
  assert.equal(h.document.activeElement.dataset.act, 'panel-pop', 'focus on toggle button survives head redraw');

  // Same-line full render() (e.g. wholeState arrival) preserves S.panelPopped too.
  h.c.render();
  await turn();
  assert.equal(h.S.panelPopped, true);
  assert.ok(h.$('#lpPanel').classList.contains('is-popped'));
  assert.equal(h.$('#lpPanelBackdrop').hidden, false);
});

test('z-index layering and Escape stacking keep child menus, lightboxes, file previews, and dialogs above popped panel', async () => {
  const lineCss = read('line.css');
  const linesCss = read('lines.css');
  const zOf = (css, selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = css.match(new RegExp(`${escaped}\\s*\\{[^}]*?z-index:\\s*(\\d+)`));
    return m ? Number(m[1]) : NaN;
  };
  const zBackdrop = zOf(lineCss, '.lp-panel-backdrop');
  const zPopped = zOf(lineCss, '.lp-panel.is-popped');
  const zSwitcher = zOf(linesCss, '.sw-overlay');
  const zMenu = zOf(linesCss, '.menu');
  const zToast = zOf(linesCss, '#toast');
  const zLightbox = zOf(linesCss, '#lightbox');
  assert.ok(zBackdrop < zPopped, 'popped panel sits above its backdrop');
  assert.ok(zPopped < zSwitcher && zPopped < zMenu && zPopped < zToast && zPopped < zLightbox,
    `popped panel (${zPopped}) must sit below switcher (${zSwitcher}), menu (${zMenu}), toast (${zToast}), and lightbox (${zLightbox})`);

  const h = createHarness();
  h.openLine('alpha', 'work-1');
  await turn();
  h.c.ACT['panel-pop']();
  assert.equal(h.S.panelPopped, true);

  // 1. Dropdown menu opened from inside popped panel: Escape closes ONLY the menu.
  const copyBtn = h.$('#lppResultTools .lpp-src') || h.$('#lpPanel [data-act="panel-pop"]');
  h.c.openMenu(copyBtn, [{ label:'Copy text', fn() {} }]);
  assert.ok(h.$('#menu'));
  // Clicking backdrop while #menu is open closes only #menu first on pointerdown.
  h.$('#lpPanelBackdrop').dispatchEvent(new h.window.Event('pointerdown', { bubbles:true }));
  h.c.menuOutside({ target:h.$('#lpPanelBackdrop') });
  h.$('#lpPanelBackdrop').click();
  assert.equal(h.$('#menu'), null);
  assert.equal(h.S.panelPopped, true, 'first click outside menu does not collapse popped panel');

  h.c.openMenu(copyBtn, [{ label:'Copy text', fn() {} }]);
  h.setFocus(h.$('#menu button'));
  h.dispatchWinKey('Escape');
  assert.equal(h.$('#menu'), null, 'Escape closes child menu');
  assert.equal(h.S.panelPopped, true, 'popped panel stays open after menu Escape');

  // 2. File preview popup (preview-work-file) opens #lightbox and marks #app inert; Escape closes ONLY #lightbox.
  const link = h.$('#lppResult a[data-act="preview-work-file"]');
  assert.ok(link, 'Work 1 renders preview-work-file link');
  await h.c.ACT['preview-work-file'](link);
  assert.equal(h.$('#lightbox').hidden, false);
  assert.equal(h.$('#app').inert, true);
  h.dispatchWinKey('Escape');
  assert.equal(h.$('#lightbox').hidden, true, 'Escape closes lightbox first');
  assert.equal(h.$('#app').inert, false, 'closing lightbox restores #app inert=false');
  assert.equal(h.S.panelPopped, true, 'popped panel remains open after closing preview');

  // 3. Open native <dialog open> (e.g. token proof / confirm dialog) -> Escape does not collapse popped panel.
  const dlg = h.document.createElement('dialog');
  dlg.setAttribute('open', '');
  dlg.open = true;
  h.document.body.append(dlg);
  h.setFocus(dlg);
  h.dispatchWinKey('Escape');
  assert.equal(h.S.panelPopped, true, 'Escape while dialog[open] exists does not collapse popped panel');
  dlg.remove();

  // 4. Now Escape collapses the popped panel back to docked, then second Escape closes the panel.
  h.setFocus(h.$('#lpPanel [data-act="panel-pop"]'));
  h.dispatchWinKey('Escape');
  assert.equal(h.S.panelPopped, false);
  assert.equal(h.S.lineSel?.id, 'work-1');
  h.dispatchWinKey('Escape');
  assert.equal(h.S.lineSel, null);
});

test('navigation, project switching, Refer, narrow viewports, and embed mode clean up popped state cleanly', async () => {
  const h = createHarness({
    extraProjects:[{ id:'other', name:'Other Project' }],
  });

  // Leaving to another Line resets S.panelPopped.
  h.openLine('alpha', 'work-1');
  h.c.ACT['panel-pop']();
  assert.equal(h.S.panelPopped, true);
  h.openLine('beta', 'work-1');
  assert.equal(h.S.panelPopped, false);
  assert.equal(h.$('#lpPanel').classList.contains('is-popped'), false);

  // Switching projects (even to a Line with the same slug) resets S.panelPopped.
  h.openLine('alpha', 'work-1');
  h.c.ACT['panel-pop']();
  assert.equal(h.S.panelPopped, true);
  await h.c.switchProject('other', { route:{ view:'line', line:'alpha', step:'work-1' } });
  assert.equal(h.S.cur, 'other');
  assert.equal(h.S.panelPopped, false);
  assert.equal(h.$('#lpPanel').classList.contains('is-popped'), false);

  // Returning to Home resets S.panelPopped.
  h.c.ACT['panel-pop']();
  assert.equal(h.S.panelPopped, true);
  h.c.go({ view:'home' });
  assert.equal(h.S.panelPopped, false);

  // Refer while popped out collapses back to docked so composer behind backdrop becomes accessible.
  h.openLine('alpha', 'work-1');
  h.c.ACT['panel-pop']();
  assert.equal(h.S.panelPopped, true);
  h.c.ACT['line-refer']({ dataset:{ step:'work-1' } });
  assert.equal(h.S.panelPopped, false);
  assert.equal(h.S.lineSel?.id, 'work-1');

  // Desktop windows keep Larger view available until the phone breakpoint.
  h.c.ACT['panel-pop']();
  assert.equal(h.S.panelPopped, true);
  h.setWidth(900);
  h.c.refreshLine();
  assert.equal(h.S.panelPopped, true);
  h.setWidth(860);
  h.c.refreshLine();
  assert.equal(h.S.panelPopped, false);
  assert.equal(h.$('#lpPanel').classList.contains('is-popped'), false);
  assert.equal(h.$('#lpPanel').dataset.step, 'work-1', 'switching layouts keeps the selected Work');
  h.c.ACT['panel-pop']();
  assert.equal(h.S.panelPopped, false, 'phone sheet mode does not pop out');

  // Embed mode also suppresses pop-out.
  const hEmbed = createHarness({ width:1600, embed:{ rail:false, canvas:'c.penecho.json' } });
  hEmbed.openLine('alpha', 'work-1');
  hEmbed.c.ACT['panel-pop']();
  assert.equal(hEmbed.S.panelPopped, false, 'embed mode does not pop out');
});

test('an unfiled Line opens its default Work on desktop and waits for a selection in compact views', () => {
  const desktop = createHarness({ width:900 });
  const phone = createHarness({ width:860 });
  const canvas = createHarness({ width:1400, embed:{ rail:false, canvas:'c.penecho.json' } });
  desktop.openLine('alpha');
  assert.equal(desktop.$('#lpPanel').dataset.step, 'work-2');
  for (const compact of [phone, canvas]) {
    compact.openLine('alpha');
    assert.equal(compact.$('#lpPanel').hidden, true);
    compact.openLine('alpha', 'work-1');
    assert.equal(compact.$('#lpPanel').dataset.step, 'work-1');
    assert.equal(compact.$('#lpPanel').hidden, false);
  }
});

test('Refer focuses the composer and keeps the narrow browser panel open', () => {
  for (const desktop of [false, true]) {
    const h = createHarness({ width:420, desktop });
    h.openLine('alpha', 'work-1');
    h.c.ACT['line-refer']({ dataset:{ step:'work-1' } });
    assert.equal(h.$('#lpPanel').hidden, desktop);
    assert.ok(h.document.activeElement === h.$('.cmp-input'));
  }
});
