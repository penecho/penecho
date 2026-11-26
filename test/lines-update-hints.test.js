'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('./helpers/dom.js');

const read = name => fs.readFileSync(path.join(__dirname, '../public/lines', name), 'utf8');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const ic = (name, size = 18) => `<svg class="ic" data-icon="${name}" width="${size}" height="${size}" aria-hidden="true"></svg>`;

function hintHarness() {
  const { document, window } = parseHTML('<html><body><div id="projbar"></div></body></html>');
  let now = 100000, nextId = 1, hidden = false;
  const timers = new Map();
  Object.defineProperty(document, 'hidden', { configurable:true, get:() => hidden });
  const p = {
    id:'p1', name:'PenEcho',
    lines:[{ id:'l1', stations:[] }], landed:[], backlog:[],
    knowledge:[{ path:'topics/a.md', title:'Alpha', sig:'sig-1', goal:'Goal A', lines:[] }],
  };
  let menuItems = null;
  const S = { cur:'p1', route:{ view:'home' }, data:{ p1:p }, newPage:false, shelfPage:false, statsInMore:false, orchInMore:false };
  const store = new Map();
  const c = vm.createContext({
    document, window, console, S, HOSTED:false, HOSTED_OFF:{ views:[] }, EMBED:null,
    ACT:{}, SEND:{}, STATE_COLOR:{},
    LINE_STATUS:require('../public/lines/line-status.js'),
    localStorage:{ getItem:k => store.get(k) ?? null, setItem:(k, v) => store.set(k, String(v)) },
    Date:{ now:() => now },
    setTimeout:(fn, ms) => { const id = nextId++; timers.set(id, { fn, at:now + ms }); return id; },
    clearTimeout:id => { timers.delete(id); },
    addEventListener() {},
    $:(selector, root = document) => root.querySelector(selector),
    $$:(selector, root = document) => [...root.querySelectorAll(selector)],
    esc, ic,
    project:() => p, allLines:proj => proj.lines, underPage:() => true,
    projectsToggleHTML:() => '', brandMark:() => '', SKILL_WHY:'',
    openMenu:(_el, items) => { menuItems = items; },
    go() {},
  });
  const pages = read('pages.js'), state = read('state.js');
  vm.runInContext(state.slice(state.indexOf('// ---------- Topics that changed ----------'), state.indexOf('async function uploadFiles(')), c);
  vm.runInContext(pages.slice(pages.indexOf('function renderProjbar()'), pages.indexOf('function refreshChrome()')), c);
  vm.runInContext(pages.slice(pages.indexOf('const statsOnBar ='), pages.indexOf('const welcomeHTML =')), c);

  const flushTimers = () => {
    for (const [id, t] of [...timers.entries()]) {
      if (t.at <= now) { timers.delete(id); t.fn(); }
    }
  };
  const topicsBtn = () => document.querySelector('.subnav [data-view="topics"]');
  const moreBtn = () => document.querySelector('.subnav .subnav-more');
  return {
    c, p, S, document, topicsBtn, moreBtn, flushTimers,
    setNow:v => { now = v; },
    advance:ms => { now += ms; flushTimers(); },
    setHidden:v => { hidden = v; },
    getMenuItems:() => menuItems,
  };
}

test('Memory update hint is removed from More button, More menu, state polling and main poll', () => {
  const h = hintHarness();
  h.S.memoryNew = { p1:[{ section:'Facts', text:'New fact' }] };
  h.c.renderProjbar();
  const more = h.moreBtn();
  assert.ok(more);
  assert.equal(more.classList.contains('grew'), false);
  assert.equal(more.querySelector('.grew-spark'), null);

  h.c.ACT['more-views'](more);
  const memItem = h.getMenuItems().find(item => item.label === 'Memory');
  assert.ok(memItem);
  assert.equal(memItem.note || '', '');

  for (const name of ['state.js', 'pages.js', 'main.js']) {
    const src = read(name);
    assert.doesNotMatch(src, /New from agents|memoryGrew|checkMemory|announceMemory|glowMemory/);
  }
});

test('Topics tab highlight preserves elapsed fade across redraws and clears without sticking red', () => {
  const h = hintHarness();
  // First check records baseline without flagging news.
  assert.equal(h.c.checkTopics(h.p).length, 0);
  h.c.renderProjbar();
  assert.equal(h.topicsBtn().classList.contains('grew'), false);

  // An agent updates a Topic: Topics tab lights up and begins fading.
  h.p.knowledge[0].sig = 'sig-2';
  assert.equal(h.c.checkTopics(h.p).length, 1);
  h.c.renderProjbar();
  assert.equal(h.topicsBtn().classList.contains('grew'), true);
  assert.ok(h.topicsBtn().querySelector('.grew-spark'));
  assert.equal(h.topicsBtn().getAttribute('style'), '--grew-ms:10000ms;--grew-delay:-0ms');

  // Unchanged polls mid-fade keep the existing node mounted so the CSS fade continues without restarting;
  // an actual redraw mid-fade preserves elapsed time instead of restarting from 0ms.
  const firstTopicsBtn = h.topicsBtn();
  h.advance(3500);
  h.c.renderProjbar();
  assert.equal(h.topicsBtn(), firstTopicsBtn, 'unchanged poll keeps existing Topics tab node mounted');
  assert.equal(h.topicsBtn().classList.contains('grew'), true);
  h.p.name = 'Demo (updated)';
  h.c.renderProjbar();
  assert.equal(h.topicsBtn().classList.contains('grew'), true);
  assert.equal(h.topicsBtn().getAttribute('style'), '--grew-ms:10000ms;--grew-delay:-3500ms');

  // After the fade duration, the timer clears the red highlight even if S.topicsNew still holds hidden topics.
  h.advance(6600);
  assert.equal(h.topicsBtn().classList.contains('grew'), false);
  assert.equal(h.topicsBtn().querySelector('.grew-spark'), null);
  assert.equal(h.S.topicsNew[h.p.id].length, 1, 'hidden Home tiles still remain in S.topicsNew');

  // Subsequent redraws stay calm and do not re-trigger red for the same update.
  h.c.renderProjbar();
  assert.equal(h.topicsBtn().classList.contains('grew'), false);

  // A later Topic update re-arms the fading highlight cleanly.
  h.p.knowledge[0].sig = 'sig-3';
  assert.equal(h.c.checkTopics(h.p).length, 1);
  h.c.renderProjbar();
  assert.equal(h.topicsBtn().classList.contains('grew'), true);
  assert.equal(h.topicsBtn().getAttribute('style'), '--grew-ms:10000ms;--grew-delay:-0ms');
});

test('Topics tab highlight waits while hidden and clears immediately when Topics is opened', () => {
  const h = hintHarness();
  h.c.checkTopics(h.p);
  h.setHidden(true);
  h.p.knowledge[0].sig = 'sig-2';
  h.c.checkTopics(h.p);
  h.c.renderProjbar();
  assert.equal(h.topicsBtn().classList.contains('grew'), true);
  assert.equal(h.topicsBtn().getAttribute('style'), '--grew-ms:10000ms;--grew-delay:-0ms');

  // Time passing while hidden does not consume the fade before the user returns.
  h.advance(20000);
  h.setHidden(false);
  h.c.renderProjbar();
  assert.equal(h.topicsBtn().classList.contains('grew'), true);
  assert.equal(h.topicsBtn().getAttribute('style'), '--grew-ms:10000ms;--grew-delay:-0ms');

  // Visiting Topics clears the tab hint immediately and leaving does not flash it back.
  h.S.route.view = 'topics';
  h.c.renderProjbar();
  assert.equal(h.topicsBtn().classList.contains('grew'), false);
  h.S.route.view = 'home';
  h.c.renderProjbar();
  assert.equal(h.topicsBtn().classList.contains('grew'), false);
});

test('lines.css fades the Topics tab highlight and sparkle gradually instead of looping forever', () => {
  const css = read('lines.css');
  assert.match(css, /\.subnav button\.grew\s*\{[^}]*animation:\s*grew-tab-fade\s+var\(--grew-ms,\s*10s\)[^}]*forwards/);
  assert.match(css, /\.subnav button\.grew > svg\s*\{[^}]*animation:\s*grew-icon-fade\s+var\(--grew-ms,\s*10s\)[^}]*forwards/);
  assert.match(css, /\.subnav button\.grew \.grew-spark\s*\{[^}]*animation:\s*grew-spark-fade\s+var\(--grew-ms,\s*10s\)[^}]*forwards/);
  assert.doesNotMatch(css, /\.subnav button\.grew > svg\s*\{[^}]*infinite/);
  assert.doesNotMatch(css, /\.memory-page \.reader li\.mem-glow/);
});
