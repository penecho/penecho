'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('./helpers/dom.js');

const read = name => fs.readFileSync(path.join(__dirname, '../public/lines', name + '.js'), 'utf8');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const ic = (name, size = 18) => `<svg class="ic" data-icon="${name}" width="${size}" height="${size}" aria-hidden="true"></svg>`;
const fragment = html => parseHTML(`<html><body>${html}</body></html>`).document.body;

function navHarness(overflow = '') {
  const { document, window } = parseHTML('<html><body><div id="projbar"></div></body></html>');
  const p = { id:'p', name:'PenEcho', lines:[{ id:'line', stations:[] }], landed:[], backlog:[] };
  const S = { cur:'p', route:{ view:'home' }, data:{ p }, newPage:false, shelfPage:false, statsInMore:false, orchInMore:false };
  const c = vm.createContext({
    document, window, console, S, HOSTED:false, HOSTED_OFF:{ views:[] },
    $:(selector, root = document) => root.querySelector(selector), esc, ic,
    addEventListener() {}, clearTimeout() {}, setTimeout() {},
    project:() => p, allLines:p => p.lines, underPage:() => true,
    projectsToggleHTML:() => '',
    memoryGrew:() => false, topicsGrew:() => false, brandMark:() => '', SKILL_WHY:'',
    refreshChrome() {}, refreshReaders() {},
  });
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { configurable:true, get() { return this.tagName === 'NAV' ? 100 : 0; } });
  Object.defineProperty(window.HTMLElement.prototype, 'scrollWidth', { configurable:true, get() {
    if (this.tagName !== 'NAV' || !overflow) return 100;
    const views = [...this.querySelectorAll('[data-view]')].map(el => el.dataset.view);
    if (overflow === 'stats' && views.includes('stats')) return 200;
    if (overflow === 'both' && (views.includes('stats') || views.includes('orchestrator'))) return 200;
    return 100;
  } });
  const run = code => vm.runInContext(code, c), pages = read('pages');
  run(pages.slice(pages.indexOf('function renderProjbar()'), pages.indexOf('function refreshChrome()')));
  run(pages.slice(pages.indexOf('const statsOnBar ='), pages.indexOf("ACT['more-views']")));
  run(pages.slice(pages.indexOf('function refreshAfterChange()'), pages.indexOf('// ---------- Memory and files ----------')));
  const views = () => [...document.querySelectorAll('.subnav [data-view]')].map(el => el.dataset.view);
  return { c, document, S, views };
}

test('renderProjbar places Orchestrator immediately after Home', () => {
  const h = navHarness();
  h.c.renderProjbar();
  assert.deepEqual(h.views(), ['home', 'orchestrator', 'topics', 'files', 'stats']);
  const search = h.document.querySelector('.bar-right [data-view="find"]');
  assert.equal(search.textContent, 'Ask AI');
  assert.equal(search.getAttribute('aria-label'), 'Ask AI about this project');
  assert.equal(search.getAttribute('title'), 'Ask AI about this project');
  assert.equal(search.querySelector('svg').dataset.icon, 'navSearch');
  h.S.route.view = 'find';
  h.c.renderProjbar();
  assert.equal(h.document.querySelector('.bar-search').getAttribute('aria-current'), 'page');
  const buttons = [...h.document.querySelectorAll('.subnav [data-view]')];
  assert.equal(buttons[0].textContent, 'Home');
  assert.equal(buttons[1].textContent, 'Orchestrator');
  assert.equal(buttons[1].querySelector('svg').dataset.icon, 'orchestrate');
});

test('project bar overflow spills Statistics first, then Orchestrator only when still needed', () => {
  const statsFirst = navHarness('stats');
  statsFirst.c.renderProjbar();
  assert.equal(statsFirst.S.statsInMore, true);
  assert.equal(statsFirst.S.orchInMore, false);
  assert.deepEqual(statsFirst.views().slice(0, 2), ['home', 'orchestrator']);
  assert.equal(statsFirst.views().includes('stats'), false);

  const both = navHarness('both');
  both.c.renderProjbar();
  assert.equal(both.S.statsInMore, true);
  assert.equal(both.S.orchInMore, true);
  assert.equal(both.views().includes('stats'), false);
  assert.equal(both.views().includes('orchestrator'), false);
});

test('the active project name is beside Home on Orchestrator, including after switching projects', () => {
  const h = navHarness();
  h.S.route.view = 'orchestrator'; h.c.renderProjbar();
  const name = () => h.document.querySelector('.project-name');
  assert.equal(name().textContent, 'PenEcho');
  assert.equal(name().nextElementSibling.firstElementChild.dataset.view, 'home');
  h.S.cur = 'other';
  h.c.project = () => ({ id:'other', name:'Design <A> & Research', lines:[] });
  h.c.renderProjbar();
  assert.equal(name().textContent, 'Design <A> & Research');
  assert.match(name().getAttribute('aria-label'), /Design <A> & Research/);
  assert.equal(name().dataset.act, 'open-switcher');
  h.c.HOSTED = { shared:true }; h.c.renderProjbar();
  assert.equal(name().tagName, 'SPAN'); assert.equal(name().textContent, 'Design <A> & Research');
  h.S.newPage = true; h.c.renderProjbar(); assert.equal(name(), null);
});

test('Statistics refresh also refreshes model prices when that loader is available', () => {
  const h = navHarness();
  let stats = 0, prices = 0;
  h.c.refreshStats = () => { stats++; };
  h.c.refreshStatsPrices = () => { prices++; };
  h.S.route.view = 'stats';
  h.c.refreshAfterChange();
  assert.equal(stats, 1);
  assert.equal(prices, 1);
  h.c.refreshStatsPrices = undefined;
  assert.doesNotThrow(() => h.c.refreshAfterChange());
  assert.equal(stats, 2);
  assert.equal(prices, 1);
});

function lineHarness() {
  const { document, window } = parseHTML('<html><body></body></html>');
  const c = vm.createContext({
    document, window, console, navigator:{ platform:'Mac' }, location:{ hash:'' },
    ACT:{}, SEND:{}, HOSTED:false, EMBED:null, STATE_COLOR:{},
    LINE_STATUS:require('../public/lines/line-status.js'),
    localStorage:{ getItem:() => null, setItem() {} }, addEventListener() {},
    $:(selector, root = document) => root.querySelector(selector),
    $$:(selector, root = document) => [...root.querySelectorAll(selector)],
    esc, ic, reducedMotion:() => true, toast() {},
  });
  const run = code => vm.runInContext(code, c);
  run(read('state'));
  run(read('line'));
  c.nodeIcon = () => '';
  const s = {
    id:'work-1', index:0, kind:'work', state:'done', label:'Build', out:'',
    reviewed:false, pictures:[], outputs:[], files:[], refers:[],
    rating:'good', ratingNote:'My own note', orchScore:4,
    orchNote:'<img src=x onerror="boom"> & "thorough"', orchBy:'PE-622', orchScoredAt:'2026-11-17T12:00:00Z',
  };
  const l = {
    id:'line', slug:'line', status:'done', stations:[s], questions:[], pictures:[],
    ask:{ files:[], later:[] }, closed:false, running:false,
  };
  const p = { id:'p', name:'PenEcho', files:[], pictures:[], lines:[l], landed:[], backlog:[] };
  return { c, p, l, s };
}

test('orchestrator rating helpers show the score, reference and escaped note', () => {
  const h = lineHarness(), badgeHTML = h.c.orchRatingBadge(h.s), badge = fragment(badgeHTML).querySelector('.lp-orch-badge');
  assert.ok(badge);
  assert.equal(badge.textContent, '4/5');
  assert.equal(badge.querySelector('svg').dataset.icon, 'orchestrate');
  assert.equal(badge.querySelector('svg').getAttribute('width'), '12');
  const tip = `Orchestrator: 4/5: ${h.s.orchNote}`;
  assert.equal(badge.getAttribute('title'), tip);
  assert.equal(badge.getAttribute('aria-label'), tip);
  assert.ok(badgeHTML.includes('&lt;img'));
  assert.equal(badge.querySelector('img'), null);

  const cardHTML = h.c.orchRateCardHTML(h.s), card = fragment(cardHTML).querySelector('.lpp-orch-rate');
  assert.ok(card);
  assert.equal(card.getAttribute('aria-label'), 'Orchestrator rating');
  assert.match(card.querySelector('.lpp-orch-rate-label').textContent, /Orchestrator rating/);
  assert.equal(card.querySelector('.lpp-orch-rate-label svg').dataset.icon, 'orchestrate');
  assert.equal(card.querySelector('.lpp-orch-rate-score').textContent, '4/5');
  assert.equal(card.querySelector('.lpp-orch-by').textContent, 'PE-622');
  assert.equal(card.querySelector('.lpp-orch-note').textContent, h.s.orchNote);
  assert.ok(cardHTML.includes('&lt;img'));
  assert.equal(card.querySelector('img'), null);
});

test('workItem and panelHead show orchestrator and user ratings side by side', () => {
  const h = lineHarness();
  for (const html of [h.c.workItem(h.p, h.l, h.s), h.c.panelHead(h.l, h.s)]) {
    const root = fragment(html), orch = root.querySelector('.lp-orch-badge'), own = root.querySelector('.lp-rate-badge.is-good');
    assert.ok(orch);
    assert.ok(own);
    assert.equal(orch.textContent, '4/5');
    assert.equal(orch.getAttribute('title'), `Orchestrator: 4/5: ${h.s.orchNote}`);
    assert.equal(own.getAttribute('title'), 'Good: My own note');
  }
});

test('resultHTML puts the orchestrator rating directly above the separate user rating box', () => {
  const h = lineHarness(), html = h.c.resultHTML(h.p, h.l, h.s, ''), root = fragment(html);
  const orch = root.querySelector('.lpp-orch-rate'), own = root.querySelector('.lpp-rate-box');
  assert.ok(orch);
  assert.ok(own);
  assert.ok(html.indexOf('lpp-orch-rate') < html.indexOf('lpp-rate-box'));
  assert.equal(orch.querySelector('.lpp-orch-note').textContent, h.s.orchNote);
  assert.equal(orch.querySelector('.lpp-orch-by').textContent, 'PE-622');
  assert.match(own.textContent, /Was this work helpful\?/);
  assert.equal(own.querySelector('.rate-note-input').value, 'My own note');
  assert.equal(root.querySelector('img'), null);
});

test('orchestrator rating UI is omitted without a valid score, leaving user rating intact', () => {
  const h = lineHarness();
  delete h.s.orchScore;
  h.s.orchNote = 'This note has no score and must not appear';
  assert.equal(h.c.orchRatingBadge(h.s), '');
  assert.equal(h.c.orchRateCardHTML(h.s), '');
  for (const html of [h.c.workItem(h.p, h.l, h.s), h.c.panelHead(h.l, h.s)]) {
    const root = fragment(html);
    assert.equal(root.querySelector('.lp-orch-badge'), null);
    assert.ok(root.querySelector('.lp-rate-badge.is-good'));
    assert.equal(root.textContent.includes(h.s.orchNote), false);
  }
  const result = fragment(h.c.resultHTML(h.p, h.l, h.s, ''));
  assert.equal(result.querySelector('.lpp-orch-rate'), null);
  assert.ok(result.querySelector('.lpp-rate-box'));
  assert.equal(result.textContent.includes(h.s.orchNote), false);
  for (const orchScore of [0, 6, 'not-a-score']) {
    h.s.orchScore = orchScore;
    assert.equal(h.c.orchRatingBadge(h.s), '');
    assert.equal(h.c.orchRateCardHTML(h.s), '');
  }
});

test('ICONS.orchestrate renders the Option A Friendly Soft Octopus across UI icon sizes', () => {
  const c = vm.createContext({
    console, matchMedia: () => ({ matches: false }),
    document: { querySelector: () => null, querySelectorAll: () => [] },
  });
  vm.runInContext(`${read('core')}\nglobalThis.__core = { ICONS, ic };`, c);
  const { ICONS, ic: renderIcon } = c.__core;

  assert.equal(
    ICONS.orchestrate,
    '<path d="M7.6 12.2C6.5 11 6.1 9.4 6.4 7.9C6.8 5.3 9.1 3.5 12 3.5C14.9 3.5 17.2 5.3 17.6 7.9C17.9 9.4 17.5 11 16.4 12.2"/><path d="M7.6 12.2C6.5 14.5 4.4 16.1 3.3 14.4C2.9 13.7 3.1 12.8 3.8 12.5"/><path d="M16.4 12.2C17.5 14.5 19.6 16.1 20.7 14.4C21.1 13.7 20.9 12.8 20.2 12.5"/><path d="M10.2 12.8C10 16.3 8.8 19.6 6.8 19.8C5.9 19.9 5.3 19.3 5.4 18.5"/><path d="M13.8 12.8C14 16.3 15.2 19.6 17.2 19.8C18.1 19.9 18.7 19.3 18.6 18.5"/><circle cx="9.8" cy="9" r="1.05" fill="currentColor" stroke="none"/><circle cx="14.2" cy="9" r="1.05" fill="currentColor" stroke="none"/>'
  );
  assert.doesNotMatch(ICONS.orchestrate, /M12 8v8\.500|16\.700|r="2\.500"/);

  for (const size of [17, 14, 13, 12]) {
    const svg = fragment(renderIcon('orchestrate', size)).querySelector('svg.ic');
    assert.ok(svg);
    assert.equal(svg.getAttribute('width'), String(size));
    assert.equal(svg.getAttribute('height'), String(size));
    assert.equal(svg.getAttribute('viewBox'), '0 0 24 24');
    assert.equal(svg.getAttribute('fill'), 'none');
    assert.equal(svg.getAttribute('stroke'), 'currentColor');
    assert.equal(svg.getAttribute('stroke-width'), '1.8');
    assert.equal(svg.querySelectorAll('path').length, 5);
    const eyes = [...svg.querySelectorAll('circle')];
    assert.equal(eyes.length, 2);
    for (const eye of eyes) {
      assert.equal(eye.getAttribute('fill'), 'currentColor');
      assert.equal(eye.getAttribute('stroke'), 'none');
    }
  }
});

test('finished Review work hides rating actions and old rating badges', () => {
  const h = lineHarness();
  assert.ok(fragment(h.c.rateBoxHTML(h.l, h.s)).querySelector('[data-act="work-rate"]'));
  for (const review of [{ ...h.s, kind:'review' }, { ...h.s, isReview:true }]) {
    assert.equal(h.c.rateButtonsHTML(h.l, review), '');
    assert.equal(h.c.rateBoxHTML(h.l, review), '');
    assert.equal(h.c.ratingBadge(review), '');
    assert.equal(h.c.orchRatingBadge(review), '');
    assert.equal(h.c.orchRateCardHTML(review), '');
  }
});
