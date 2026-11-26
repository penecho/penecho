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

function createHarness({ hashStart = '#p/line/alpha', embed = null, hosted = false } = {}) {
  const { document, window } = parseHTML(
    '<html><body><div id="app"><aside id="rail"></aside><div class="shell"><header id="projbar"></header><main id="view"></main></div></div>' +
    '<div id="switcher" hidden><div id="swList"></div><div id="swPreview"></div></div>' +
    '<div id="lightbox" hidden></div><div id="toast" hidden></div></body></html>'
  );
  let focused = document.body;
  Object.defineProperty(document, 'activeElement', { configurable:true, get:() => focused?.isConnected ? focused : document.body });
  window.HTMLElement.prototype.focus = function () { focused = this; };
  window.HTMLElement.prototype.select = function () {};
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.HTMLElement.prototype.scrollTo = function (opts, y) {
    if (opts && typeof opts === 'object' && opts.top != null) this.scrollTop = opts.top;
    else if (typeof y === 'number') this.scrollTop = y;
  };
  window.HTMLElement.prototype.getClientRects = function () {
    return this.isConnected && !this.hidden ? [this.getBoundingClientRect()] : [];
  };
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    const r = { left:120, top:80, right:280, bottom:114, width:160, height:34 };
    r.toJSON = () => ({ left:120, top:80, right:280, bottom:114, width:160, height:34 });
    return r;
  };

  const winListeners = new Map(), docListeners = new Map();
  const origDocAdd = document.addEventListener.bind(document);
  document.addEventListener = (type, fn, opts) => {
    if (!docListeners.has(type)) docListeners.set(type, []);
    docListeners.get(type).push({ fn, capture:Boolean(opts === true || opts?.capture) });
    return origDocAdd(type, fn, opts);
  };
  const addEventListener = (type, fn, opts) => {
    if (!winListeners.has(type)) winListeners.set(type, []);
    winListeners.get(type).push({ fn, capture:Boolean(opts === true || opts?.capture) });
  };
  const dispatchDocKey = key => {
    let defaultPrevented = false, propagationStopped = false;
    const ev = {
      key, target:focused,
      get defaultPrevented() { return defaultPrevented; },
      preventDefault() { defaultPrevented = true; },
      stopPropagation() { propagationStopped = true; },
      stopImmediatePropagation() { propagationStopped = true; },
    };
    for (const h of docListeners.get('keydown') || []) {
      if (h.capture && !propagationStopped) h.fn(ev);
    }
    if (!propagationStopped) {
      for (const h of winListeners.get('keydown') || []) h.fn(ev);
    }
    return ev;
  };
  const dispatchBackdropDown = () => {
    const ev = { target:document.querySelector('#lightbox'), stopPropagation() {} };
    for (const h of docListeners.get('pointerdown') || []) h.fn(ev);
  };

  let hash = hashStart;
  const session = new Map(), storage = new Map();
  const windowOpened = [], copiedTexts = [], postRequests = [];
  window.open = (...args) => { windowOpened.push(args); return null; };
  const historyObj = { state:null, replaceState(state, _t, value) { hash = value; this.state = state; } };
  const fireWin = name => { for (const h of winListeners.get(name) || []) h.fn({}); };
  const locationObj = {
    get hash() { return hash; },
    set hash(v) { hash = v; historyObj.state = null; fireWin('hashchange'); },
    origin:'http://127.0.0.1:3889', pathname:'/projects.html', search:'',
  };

  const docBodies = {
    'files/alpha/summary.md':'# Summary\n\nCompared **all** 6 pages.\n',
    'files/solo/note.md':'# Solo\n\nSingle output note.\n',
    'works/alpha/work-1.md':'# Work 1\n\n## Result\n\nSix pages and one summary.\n',
    'works/alpha/work-2.md':'# Work 2\n\n## Result\n\nSecond work.\n',
  };

  const alphaWork1 = {
    id:'work-1', index:0, kind:'work', label:'Work 1', state:'done', reviewed:false,
    off:'', agent:'claude', took:'3 min', out:'Done.', detail:'works/alpha/work-1.md',
    pictures:[], files:[], refers:[],
    outputs:[
      { kind:'artifact', path:'https://claude.ai/artifact/AbCdEf123456', title:'External Artifact' },
      { kind:'page', path:'files/alpha/p1.explorer.html', title:'Page 1' },
      { kind:'line', line:'beta', path:'lines/beta.md' },
      { kind:'page', path:'files/alpha/p2.explorer.html', title:'Page 2' },
      { kind:'page', path:'/repo/app/docs/proto.html', title:'Code Proto', code:true },
      { kind:'document', path:'files/alpha/missing.md', title:'Missing' },
      { kind:'document', path:'files/alpha/summary.md', title:'summary.md' },
    ],
  };
  const alphaWork2 = {
    id:'work-2', index:1, kind:'work', label:'Work 2', state:'done', reviewed:false,
    off:'', agent:'codex', took:'1 min', out:'Work 2 out.', detail:'works/alpha/work-2.md',
    pictures:[], files:[], refers:[],
    outputs:[
      { kind:'page', path:'files/alpha/work2.explorer.html', title:'Work 2 Page' },
    ],
  };
  const soloWork = {
    id:'work-1', index:0, kind:'work', label:'Work 1', state:'done', reviewed:false,
    off:'', agent:'claude', took:'1 min', out:'Solo.', detail:'',
    pictures:[], files:[], refers:[],
    outputs:[
      { kind:'artifact', path:'https://claude.ai/artifact/Solo000011', title:'Artifact' },
      { kind:'page', path:'files/solo/only.explorer.html', title:'Only Page' },
      { kind:'line', line:'alpha', path:'lines/alpha.md' },
    ],
  };
  const stackedWork = {
    id:'work-1', index:0, kind:'work', label:'Work 1', state:'done', reviewed:false,
    off:'', agent:'claude', took:'1 min', out:'Logs.', detail:'',
    pictures:[], files:[], refers:[],
    outputs:[
      { kind:'file', path:'files/stacked/a.bin', title:'a.bin' },
      { kind:'file', path:'files/stacked/b.bin', title:'b.bin' },
    ],
  };
  const drawWork = {
    id:'work-1', index:0, kind:'work', label:'Work 1', state:'done', reviewed:false,
    off:'', agent:'claude', took:'1 min', out:'Drew pages.', detail:'works/alpha/work-1.md',
    pictures:[
      { path:'files/draw/one.png', title:'Draw One' },
      { path:'files/draw/two.png', title:'Draw Two' },
    ],
    files:[], refers:[], outputs:[],
  };

  const now = Date.now();
  const baseProject = {
    id:'p', name:'PenEcho', trunk:'main', vault:{ path:'/docs', code:[{ path:'/repo/app' }] },
    files:[
      { path:'files/alpha/p1.explorer.html', kind:'page', by:'claude', line:'alpha', step:'work-1', mtime:now - 1000, size:1024 },
      { path:'files/alpha/p2.explorer.html', kind:'page', by:'claude', line:'alpha', step:'work-1', mtime:now - 2000, size:2048 },
      { path:'files/alpha/summary.md', kind:'document', by:'claude', line:'alpha', step:'work-1', mtime:now - 3000, size:512 },
      { path:'files/alpha/work2.explorer.html', kind:'page', by:'codex', line:'alpha', step:'work-2', mtime:now - 4000, size:1024 },
      { path:'files/solo/only.explorer.html', kind:'page', by:'claude', line:'solo', step:'work-1', mtime:now - 5000, size:1024 },
      { path:'files/solo/note.md', kind:'document', by:'claude', line:'solo', step:'work-1', mtime:now - 5500, size:400 },
      { path:'files/other/unrelated.txt', kind:'document', by:'you', line:'beta', step:'ask-1', mtime:now - 6000, size:300 },
      { path:'files/stacked/a.bin', kind:'file', by:'claude', line:'stacked', step:'work-1', mtime:now - 7000, size:200 },
      { path:'files/stacked/b.bin', kind:'file', by:'claude', line:'stacked', step:'work-1', mtime:now - 7100, size:200 },
      { path:'files/draw/one.png', kind:'picture', by:'claude', line:'draw', step:'work-1', mtime:now - 8000, size:500 },
      { path:'files/draw/one.explorer.html', kind:'page', by:'claude', line:'draw', step:'work-1', mtime:now - 8100, size:600 },
      { path:'files/draw/two.png', kind:'picture', by:'claude', line:'draw', step:'work-1', mtime:now - 8200, size:500 },
      { path:'files/draw/two.explorer.html', kind:'page', by:'claude', line:'draw', step:'work-1', mtime:now - 8300, size:600 },
      { path:'files/home/pic1.png', kind:'picture', by:'you', line:'beta', step:'ask-1', mtime:now - 9000, size:500 },
      { path:'files/home/pic2.png', kind:'picture', by:'claude', line:'beta', step:'work-1', mtime:now - 9100, size:500 },
    ],
    pictures:[
      { source:'files/draw/one.penecho.json', path:'files/draw/one.png', title:'Draw One', mtime:now - 8000 },
      { source:'files/draw/two.penecho.json', path:'files/draw/two.png', title:'Draw Two', mtime:now - 8200 },
    ],
    artifacts:[{ path:'https://claude.ai/artifact/AbCdEf123456', title:'External Artifact', by:'claude', line:'alpha', step:'work-1', mtime:now - 500 }],
    notes:[], knowledge:[], areas:[], branches:{},
    lines:[
      { id:'alpha', slug:'alpha', code:'PE-1', title:'Alpha', status:'done', landed:false, closed:false, archived:false, running:false, elsewhere:false, questions:[], labels:[], pictures:[], topicPath:'lines/alpha.md', ask:{ text:'Do alpha', when:'2026-11-21 10:00', files:[], later:[] }, result:{ text:'', files:[] }, stations:[alphaWork1, alphaWork2] },
      { id:'solo', slug:'solo', code:'PE-2', title:'Solo', status:'done', landed:false, closed:false, archived:false, running:false, elsewhere:false, questions:[], labels:[], pictures:[], topicPath:'lines/solo.md', ask:{ text:'Do solo', when:'2026-11-21 10:05', files:[], later:[] }, result:{ text:'', files:[] }, stations:[soloWork] },
      { id:'beta', slug:'beta', code:'PE-3', title:'Beta', status:'done', landed:false, closed:false, archived:false, running:false, elsewhere:false, questions:[], labels:[], pictures:[], topicPath:'lines/beta.md', ask:{ text:'Do beta', when:'2026-11-21 10:10', files:[], later:[] }, result:{ text:'', files:[] }, stations:[] },
      { id:'stacked', slug:'stacked', code:'PE-4', title:'Stacked', status:'done', landed:false, closed:false, archived:false, running:false, elsewhere:false, questions:[], labels:[], pictures:[], topicPath:'lines/stacked.md', ask:{ text:'Stack', when:'2026-11-21 10:15', files:[], later:[] }, result:{ text:'', files:[] }, stations:[stackedWork] },
      { id:'draw', slug:'draw', code:'PE-5', title:'Draw', status:'done', landed:false, closed:false, archived:false, running:false, elsewhere:false, questions:[], labels:[], pictures:[], topicPath:'lines/draw.md', ask:{ text:'Draw', when:'2026-11-21 10:20', files:[], later:[] }, result:{ text:'', files:[] }, stations:[
        { id:'canvas-1', kind:'canvas', label:'Canvas', pictures:[{ path:'files/draw/one.png', title:'Draw One' }] },
        drawWork,
      ] },
    ],
    landed:[], backlog:[],
  };

  let curWidth = 1440;
  const viewEl = document.querySelector('#view');
  Object.defineProperty(viewEl, 'clientWidth', { configurable:true, get:() => curWidth });
  const timeouts = [];
  const testSetTimeout = (fn, ms, ...args) => { const t = setTimeout(fn, ms, ...args); t.unref?.(); timeouts.push(t); return t; };

  const c = vm.createContext({
    document, window, Event:window.Event, console, Object, Array, Map, Set, Date, Promise, JSON, Math, Number, String, Boolean, RegExp, Error, Intl,
    encodeURIComponent, decodeURIComponent, performance,
    setTimeout:testSetTimeout, clearTimeout,
    requestAnimationFrame:fn => { testSetTimeout(fn, 0); return 1; },
    cancelAnimationFrame() {},
    matchMedia:() => ({ matches:true }),
    get innerWidth() { return curWidth; }, innerHeight:960,
    CSS:{ escape:s => String(s).replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~ ])/g, '\\$1') },
    navigator:{ platform:'MacIntel', clipboard:{ writeText:async text => { copiedTexts.push(text); } } },
    location:locationObj, history:historyObj,
    localStorage:{ getItem:k => (storage.has(k) ? storage.get(k) : null), setItem:(k, v) => storage.set(k, String(v)), removeItem:k => storage.delete(k) },
    sessionStorage:{ getItem:k => (session.has(k) ? session.get(k) : null), setItem:(k, v) => session.set(k, String(v)), removeItem:k => session.delete(k) },
    open:(...args) => { windowOpened.push(args); return null; },
    EMBED:embed, HOSTED:hosted, SEND:{}, Pano:{ sheet:null, mount() {}, update() {} }, SHEET:null,
    SET:{}, SETTINGS_PAGES:new Set(['settings', 'agents', 'providers', 'setup', 'archived']),
    LINE_STATUS:require('../public/lines/line-status.js'),
    WORK_PRICING:require('../public/lines/work-pricing.js'),
    STATE_COLOR:{ working:'#0d9488', review:'#d98a1f', ready:'#16a34a', landed:'#16a34a', error:'#b4232c', wait:'#d98a1f', todo:'#64748b', notes:'#64748b' },
    addEventListener, removeEventListener() {},
    getComputedStyle:() => ({ position:'static', fontSize:'18px' }),
    fetch:async (url, init = {}) => {
      const jsonRes = data => ({ ok:true, status:200, json:async () => data, text:async () => JSON.stringify(data), blob:async () => ({ size:0, text:async () => '' }) });
      if (init.method === 'POST') postRequests.push({ url, body:init.body ? JSON.parse(init.body) : {} });
      if (url.includes('/activity')) return jsonRes({ rows:[], seq:0, running:false, started:0, now:'' });
      if (url.includes('/diff')) return jsonRes({ files:[], truncated:false });
      if (url.includes('/doc?')) {
        const docPath = decodeURIComponent(url.split('path=')[1].split('&')[0]);
        return jsonRes({ md:docBodies[docPath] ?? '# Doc', hash:'h1', mtime:100 });
      }
      if (url.includes('/state')) {
        const curP = c.S.data.p;
        return jsonRes({ format:2, project:{ id:'p', name:'PenEcho', trunk:'main', vault:{ path:'/docs', code:[{ path:'/repo/app' }] } }, rev:'r1', lines:clone(curP.lines), landed:[], backlog:[], files:clone(curP.files), pictures:clone(curP.pictures), artifacts:clone(curP.artifacts) });
      }
      return jsonRes({});
    },
    pasteboard:async () => false,
    renderRail() {}, renderProjbar() {}, refreshChrome() {}, refreshDesk() {}, renderTray() {},
    refreshBelow() {}, refreshEmptyAgents() {},
    wireComposers() {}, syncComposer() {}, boxUrls() {},
    composerHTML:() => '<form class="composer" data-comp="c1"><textarea class="cmp-input"></textarea></form>',
    availableAgents:() => [{ id:'claude', name:'Claude', available:true }, { id:'codex', name:'Codex', available:true }],
    runPresets:() => [], runnablePresets:() => [], defaultPreset:() => null, presetById:() => null,
    nodeIcon:() => '', stateChip:(st, l) => `<span class="chip c-${st}">${l.status}</span>`,
    homeHTML:p => { c.fvBackTo?.(`${p.id}:home`); return '<div id="homePage"><div id="pano"></div></div>'; },
    docHTML:(_p, r) => `<div id="docPage" data-doc="${r.doc}"></div>`,
    topicsPageHTML:() => '', statsHTML:() => '', memoryHTML:() => '',
    vaultHTML:() => '', findHTML:() => '', archiveHTML:() => '', deletedHTML:() => '',
    settingsHTML:() => '', orchestratorHTML:() => '', markupHTML:() => '',
    embedRailOnly:() => false, embedKeeps:() => true, embedShown() {}, hostedAddress() {}, hostedBoot() {},
    rememberTabs() {}, rememberBoxes() {}, keepRail() {}, keepPage() {}, wireDrop() {},
    lacks:() => null, routeNeeds:() => ({}), holdFor:() => null, readLineFiles() {}, homeShape:() => 'code',
    showRow() {}, zoomIn() {}, zoomOutClone() {}, flightToLine:() => null, flightToHome:() => null,
    settingsUp:() => false, closeSettings() {}, dropSettingsModal() {}, finishEdit:async () => true,
    readOpenedLine() {}, boxKey:x => x, comp:() => ({ refers:[], files:[] }),
    mcGlyph:() => '', mcLinksFor:() => [], mcLinkChips:() => '', mcMinutes:md => md, mcActionsHTML:() => '', mcDiagramsHTML:() => '',
    mcIsExample:() => false, mcState:() => 'off', MC:{ one:{}, links:{} },
    tokenWorkHTML:() => '', tokenLineHTML:() => '',
    can:() => true, agoWords:() => 'Today', daysLeft:() => '7 days left',
    shortWhen:() => 'Today 12:00', wireImagePreview() {},
    pptDownloadButton:() => '', openCanvasPage() {}, canvasUrl:() => '',
    highlightSource:md => `<pre>${md}</pre>`,
    sayHTML:t => `<p>${t}</p>`,
    readLists:() => ({}),
    filesLabel:() => '1 file',
    IntersectionObserver:undefined, ResizeObserver:undefined,
  });

  const run = code => vm.runInContext(code, c);
  for (const file of ['core.js', 'state.js', 'navigation.js', 'markdown.js', 'pdf.js', 'pages.js', 'canvases.js', 'files.js', 'files-view.js', 'line.js', 'merge.js']) {
    run(read(file));
  }
  run(read('main.js').replace(/^boot\(\);$/m, ''));
  run("VIEWS.home = p => { fvBackTo(`${p.id}:home`); return '<div id=\"homePage\"><div id=\"pano\"></div></div>'; }; VIEWS.doc = (_p, r) => `<div id=\"docPage\" data-doc=\"${r.doc}\"></div>`;");
  Object.assign(c, run('({ S, FV, ACT, project, fvOpen, fvOpenHome, fvRefresh, fvList, fvShown, fvBackTo, fvPendingTry, flItems, flState, refreshLine, go, hashToRoute, render })'), {
    refreshChrome() {}, renderRail() {}, renderProjbar() {}, readOpenedLine() {}, boxUrls() {}, wireComposers() {}, syncComposer() {},
  });

  c.S.projects = [{ id:'p', name:'PenEcho' }];
  c.S.cur = 'p';
  c.S.thisComputer = true;
  c.S.data.p = clone(baseProject);
  const initialRoute = c.hashToRoute(hashStart)?.route || { view:'line', line:'alpha' };
  c.S.route = initialRoute;
  run('bindGlobal(); render()');

  const click = el => {
    assert.ok(el, 'expected element to exist for click');
    const act = el.dataset.act;
    assert.ok(c.ACT[act], `expected ACT['${act}']`);
    return c.ACT[act](el, { target:el, preventDefault() {} });
  };
  const backTo = async targetHash => {
    hash = targetHash;
    historyObj.state = null;
    fireWin('hashchange');
    await new Promise(r => setTimeout(r, 25));
  };

  return {
    c, S:c.S, FV:c.FV, document, window, run, click, dispatchDocKey, dispatchBackdropDown, backTo, fireWin,
    windowOpened, copiedTexts, postRequests, session, docBodies,
    $(sel, root = document) { return root.querySelector(sel); },
    $$(sel, root = document) { return [...root.querySelectorAll(sel)]; },
    goLine:(line, step) => { c.go(step ? { view:'line', line, step } : { view:'line', line }); fireWin('hashchange'); },
    goView:view => { c.go({ view }); fireWin('hashchange'); },
    get hash() { return hash; },
    cleanup() { for (const t of timeouts) clearTimeout(t); },
  };
}

test('clicking .lp-out iterates strictly within that Work .lp-outs section in displayed order and supports .md Copy', async t => {
  const h = createHarness();
  t.after(() => h.cleanup());

  const work1 = h.$('#item-work-1');
  const cards = h.$$('.lp-outs .lp-out', work1);
  assert.equal(cards.length, 6); // missing.md is filtered by outputThere

  // Click Page 1 (viewer-backed index 0 of [p1, p2, summary.md])
  h.click(cards[1]);
  assert.equal(h.run('fvShown()'), true);
  assert.deepEqual(Array.from(h.run('fvList(project()).map(x => x.key)')), [
    'files/alpha/p1.explorer.html',
    'files/alpha/p2.explorer.html',
    'files/alpha/summary.md',
  ]);
  assert.equal(h.$('#lightbox .fv-count').textContent, '1 / 3');
  assert.equal(cards[1].classList.contains('fv-on'), true);

  // Step forward via Next button through p2 -> summary.md -> wrap to p1
  h.click(h.$('#lightbox .fv-nav.next'));
  assert.equal(h.FV.key, 'files/alpha/p2.explorer.html');
  assert.equal(h.$('#lightbox .fv-count').textContent, '2 / 3');
  assert.equal(cards[1].classList.contains('fv-on'), false);
  assert.equal(cards[3].classList.contains('fv-on'), true);

  h.click(h.$('#lightbox .fv-nav.next'));
  await turn();
  assert.equal(h.FV.key, 'files/alpha/summary.md');
  assert.equal(h.$('#lightbox .fv-count').textContent, '3 / 3');
  assert.match(h.$('#lightbox .fv-doc-in').innerHTML, /Compared/);
  assert.equal(cards[5].classList.contains('fv-on'), true);

  // Copy Markdown button copies the full Markdown source in .fv
  const copyBtn = h.$('#lightbox .fv-side [data-act="fv-copy"]');
  assert.equal(copyBtn.getAttribute('aria-label'), 'Copy Markdown');
  await h.click(copyBtn);
  await turn();
  assert.equal(h.copiedTexts.at(-1), h.docBodies['files/alpha/summary.md']);
  assert.equal(h.$('#toast span').textContent, 'Copied the Markdown');
  assert.equal(h.run('fvShown()'), true);

  // ArrowRight wraps back to Page 1; ArrowLeft goes back to summary.md
  h.dispatchDocKey('ArrowRight');
  assert.equal(h.FV.key, 'files/alpha/p1.explorer.html');
  assert.equal(h.$('#lightbox .fv-count').textContent, '1 / 3');

  h.dispatchDocKey('ArrowLeft');
  await turn();
  assert.equal(h.FV.key, 'files/alpha/summary.md');
  assert.equal(h.$('#lightbox .fv-count').textContent, '3 / 3');

  // Escape closes and restores focus to the current .lp-out card (summary.md), clearing FV.scope
  h.dispatchDocKey('Escape');
  assert.equal(h.run('fvShown()'), false);
  assert.equal(h.FV.scope, null);
  assert.equal(h.FV.home, null);
  assert.equal(h.document.activeElement, cards[5]);
  assert.equal(cards[5].classList.contains('fv-on'), false);

  // Clicking the .md card directly in .lp-outs ALSO opens scoped .fv at 3 / 3 (not unscoped showViewer)
  h.click(cards[5]);
  await turn();
  assert.equal(h.run('fvShown()'), true);
  assert.equal(h.$('#lightbox .fv-count').textContent, '3 / 3');
  h.dispatchDocKey('ArrowLeft');
  assert.equal(h.c.FV.key, 'files/alpha/p2.explorer.html');
  assert.equal(h.$('#lightbox .fv-count').textContent, '2 / 3');

  // Clicking backdrop closes and restores focus to Page 2 card
  h.dispatchBackdropDown();
  await new Promise(r => setTimeout(r, 15));
  assert.equal(h.run('fvShown()'), false);
  assert.equal(h.document.activeElement, cards[3]);
  assert.equal(h.c.FV.scope, null);

  // Non-viewer cards keep their own actions
  h.click(cards[0]);
  assert.deepEqual(h.windowOpened[0], ['https://claude.ai/artifact/AbCdEf123456', '_blank', 'noopener']);
  h.click(cards[4]);
  assert.equal(h.postRequests[0].body.path, '/repo/app/docs/proto.html');
  h.click(cards[2]);
  assert.equal(h.c.S.route.line, 'beta');
});

test('single-item .lp-outs hides prev/next/counter and ignores ArrowLeft/ArrowRight', t => {
  const h = createHarness({ hashStart:'#p/line/solo' });
  t.after(() => h.cleanup());

  const cards = h.$$('#item-work-1 .lp-outs .lp-out');
  assert.equal(cards.length, 3); // artifact + 1 explorer page + line
  h.click(cards[1]);
  assert.equal(h.run('fvShown()'), true);
  assert.deepEqual(Array.from(h.run('fvList(project()).map(x => x.key)')), ['files/solo/only.explorer.html']);
  assert.equal(h.$('#lightbox .fv-nav'), null);
  assert.equal(h.$('#lightbox .fv-count'), null);

  h.dispatchDocKey('ArrowRight');
  h.dispatchDocKey('ArrowLeft');
  assert.equal(h.c.FV.key, 'files/solo/only.explorer.html');

  h.click(h.$('#lightbox .fv-x'));
  assert.equal(h.run('fvShown()'), false);
  assert.equal(h.document.activeElement, cards[1]);
});

test('Work 2 .lp-outs is separate from Work 1, and Canvases & files + Home previews stay intact without scope leak', async t => {
  const h = createHarness();
  t.after(() => h.cleanup());

  // Set restrictive Canvases & files filter first — must NOT affect .lp-outs!
  h.run("Object.assign(flState(), { kind:'canvas', q:'nomatch' })");

  // Work 2 has only 1 output -> no nav arrows, does NOT mix Work 1 outputs
  const work2Card = h.$('#item-work-2 .lp-outs .lp-out');
  h.click(work2Card);
  assert.equal(h.run('fvShown()'), true);
  assert.deepEqual(Array.from(h.run('fvList(project()).map(x => x.key)')), ['files/alpha/work2.explorer.html']);
  assert.equal(h.$('#lightbox .fv-nav'), null);
  h.click(h.$('#lightbox .fv-x'));
  assert.equal(h.document.activeElement, work2Card);

  // Switch to Canvases & files -> filter was reset on entry, clicking a card iterates ALL shown project files
  h.goView('files');
  const firstFlCard = h.$('#flBody .fl-card[data-key="files/alpha/p1.explorer.html"]');
  h.click(firstFlCard);
  assert.equal(h.run('fvShown()'), true);
  assert.equal(h.c.FV.scope, null);
  assert.equal(h.c.FV.home, null);
  assert.ok(h.run('fvList(project()).length') > 5);
  h.dispatchDocKey('Escape');

  // Home picture preview (fvOpenHome) still works with its own scope
  h.goView('home');
  await h.c.fvOpenHome(h.c.project(), 'files/home/pic1.png');
  assert.equal(h.run('fvShown()'), true);
  assert.equal(h.c.FV.scope, null);
  assert.deepEqual(Array.from(h.run('fvList(project()).map(x => x.key)')), ['files/home/pic1.png']);
  h.dispatchDocKey('Escape');
  assert.equal(h.c.FV.home, null);
});

test('same-day kind:file outputs stay scoped without Canvases & files stacks, and Open page is scoped too', t => {
  const h = createHarness({ hashStart:'#p/line/stacked' });
  t.after(() => h.cleanup());

  const cards = h.$$('#item-work-1 .lp-outs .lp-out');
  h.click(cards[0]);
  assert.equal(h.run('fvShown()'), true);
  assert.equal(h.$('#lightbox .fv-strip'), null, 'scoped Line viewer must not show Canvases & files stack strip');
  assert.equal(h.$('#lightbox .fv-count').textContent, '1 / 2');
  h.dispatchDocKey('Escape');

  // Open page on .lp-drawing (1 page -> no nav arrows) and in #lppResult .result-pics (2 pages -> scoped to 2)
  h.goLine('draw', 'work-1');
  const drawPageBtn = h.$('.lp-drawing [data-act="open-page"]');
  h.click(drawPageBtn);
  assert.equal(h.run('fvShown()'), true);
  assert.deepEqual(Array.from(h.run('fvList(project()).map(x => x.key)')), ['files/draw/one.explorer.html']);
  assert.equal(h.$('#lightbox .fv-nav'), null);
  h.dispatchDocKey('Escape');
  assert.equal(h.document.activeElement, drawPageBtn);

  const panelBtns = h.$$('#lppResult .result-pics [data-act="open-page"]');
  assert.equal(panelBtns.length, 2);
  h.click(panelBtns[0]);
  assert.equal(h.$('#lightbox .fv-count').textContent, '1 / 2');
  h.click(h.$('#lightbox .fv-nav.next'));
  assert.equal(h.c.FV.key, 'files/draw/two.explorer.html');
  assert.equal(h.$('#lightbox .fv-count').textContent, '2 / 2');
  h.dispatchDocKey('Escape');
  assert.equal(h.document.activeElement, panelBtns[1]);
});

test('fvRefresh updates nav count, live mtime, .fv-on after redraw, and Back/pagehide preserves scope', async t => {
  const h = createHarness();
  t.after(() => h.cleanup());

  const work1 = h.$('#item-work-1');
  const cards = h.$$('.lp-outs .lp-out', work1);
  h.click(cards[1]);
  assert.equal(h.$('#lightbox .fv-count').textContent, '1 / 3');

  // Redraw Work 1 via refreshLine -> fvRefresh restores .fv-on
  work1.dataset.h = 'stale';
  h.run('refreshLine(); fvRefresh();');
  const freshCard = h.$('#item-work-1 .lp-outs .lp-out[data-path="files/alpha/p1.explorer.html"]');
  assert.equal(freshCard.classList.contains('fv-on'), true);

  // Deleting sibling items updates counter and hides nav when 1 remains
  h.c.S.data.p.files = h.c.S.data.p.files.filter(f => f.path !== 'files/alpha/p2.explorer.html');
  h.run('flItems.cache = null; fvRefresh();');
  assert.equal(h.$('#lightbox .fv-count').textContent, '1 / 2');

  h.c.S.data.p.files = h.c.S.data.p.files.filter(f => f.path !== 'files/alpha/summary.md');
  h.run('flItems.cache = null; fvRefresh();');
  assert.equal(h.$('#lightbox .fv-nav'), null);
  assert.equal(h.$('#lightbox .fv-count'), null);

  // pagehide stores serializable scope
  h.fireWin('pagehide');
  const savedBack = JSON.parse(h.session.get('penecho-files-back'));
  assert.equal(savedBack.place, 'p:line');
  assert.equal(savedBack.hash, '#p/line/alpha');
  assert.deepEqual(savedBack.scope.keys, [
    'files/alpha/p1.explorer.html',
    'files/alpha/p2.explorer.html',
    'files/alpha/summary.md',
  ]);

  // Restore files and test hashchange Back from Doc restores scoped viewer
  h.c.S.data.p.files.push(
    { path:'files/alpha/p2.explorer.html', kind:'page', by:'claude', line:'alpha', step:'work-1', mtime:Date.now(), size:2048 },
    { path:'files/alpha/summary.md', kind:'document', by:'claude', line:'alpha', step:'work-1', mtime:Date.now(), size:512 }
  );
  h.run('flItems.cache = null;');
  h.dispatchDocKey('Escape');
  h.click(h.$('#item-work-1 .lp-outs .lp-out[data-path="files/alpha/summary.md"]'));
  h.click(h.$('#lightbox [data-act="fv-doc"]'));
  h.fireWin('hashchange');
  assert.equal(h.run('fvShown()'), false);
  assert.equal(h.c.S.route.view, 'doc');

  // Browser Back to #p/line/alpha restores .fv with exact scoped list
  await h.backTo('#p/line/alpha');
  assert.equal(h.run('fvShown()'), true);
  assert.equal(h.c.FV.key, 'files/alpha/summary.md');
  assert.equal(h.$('#lightbox .fv-count').textContent, '3 / 3');
  h.dispatchDocKey('Escape');

  // Canvases & files -> From the line -> Browser Back still restores Canvases & files viewer
  h.goView('files');
  await new Promise(r => setTimeout(r, 10));
  h.click(h.$('#flBody .fl-card[data-key="files/alpha/p1.explorer.html"]'));
  h.click(h.$('#lightbox .fl-line'));
  assert.equal(h.c.S.route.view, 'line');
  assert.equal(h.run('fvShown()'), false);
  await h.backTo('#p/files');
  assert.equal(h.run('fvShown()'), true);
  assert.equal(h.c.FV.scope, null);
  assert.ok(h.run('fvList(project()).length') > 5);
});
