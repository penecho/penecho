'use strict';
require('./helpers/safety.js');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('./helpers/dom.js');

const read = name => fs.readFileSync(path.join(__dirname, '../public/lines', name), 'utf8');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const ic = (name, size = 18) => `<svg class="ic" data-icon="${name}" width="${size}" height="${size}" aria-hidden="true"></svg>`;

function slice(source, start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `${start} -> ${end}`);
  return source.slice(from, to);
}

function headerHarness(opts = {}) {
  const { document, window } = parseHTML('<html><body><div id="projbar"></div></body></html>');
  const p = opts.project || {
    id:'p1', name:'PenEcho', canvasSkill:false, offerSkill:false, myCanvases:false,
    lines:[{ id:'l1', stations:[] }], landed:[], backlog:[],
    knowledge:[{ path:'topics/a.md', title:'Alpha', lines:[] }],
  };
  const S = {
    cur:p.id, route:{ view:opts.view || 'home' }, data:{ [p.id]:p },
    newPage:false, shelfPage:false, statsInMore:false, orchInMore:false, navFold:0,
    cloudAccount:{ signedIn:false }, cloudKept:{},
  };
  const went = [];
  window.HTMLElement.prototype.focus = function () {};
  window.HTMLElement.prototype.getClientRects = function () { return this.isConnected && !this.hidden ? [this.getBoundingClientRect()] : []; };
  window.HTMLElement.prototype.getBoundingClientRect = function () { return { left:300, top:10, right:380, bottom:42, width:80, height:32 }; };
  const c = vm.createContext({
    document, window, console, S, ACT:{}, HOSTED:opts.hosted || false, HOSTED_OFF:{ views:[] },
    $:(selector, root = document) => root.querySelector(selector),
    $$:(selector, root = document) => [...root.querySelectorAll(selector)],
    esc, ic, av:() => '',
    clamp:(v, lo, hi) => Math.max(lo, Math.min(hi, v)),
    innerWidth:1280, innerHeight:800,
    requestAnimationFrame:() => 1, cancelAnimationFrame() {},
    addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout,
    project:() => p, allLines:proj => proj.lines || [], underPage:() => true,
    viewHere:v => !opts.hosted || !(v === 'orchestrator' && !opts.hosted.onComputer),
    projectsToggleHTML:() => '', topicsGrew:() => false, SKILL_WHY:'why',
    go:route => { went.push({ ...route }); S.route = route; },
  });
  const core = read('core.js'), pages = read('pages.js');
  vm.runInContext(slice(core, '// Small anchored menu', '// Zoom between levels'), c);
  vm.runInContext(slice(pages, 'function renderProjbar()', 'function refreshChrome()'), c);
  vm.runInContext(slice(pages, 'const statsOnBar =', 'const welcomeHTML ='), c);
  return { c, p, S, document, went };
}

test('project header has 3 clear zones: identity, primary views (with Statistics and Canvases & files), and Ask AI + Share utilities only', () => {
  const h = headerHarness();
  h.c.renderProjbar();

  const bar = h.document.querySelector('#projbar');
  const tabs = [...bar.querySelectorAll('.subnav [data-view]')];
  assert.deepEqual(tabs.map(el => el.dataset.view), ['home', 'orchestrator', 'topics', 'files', 'stats']);
  assert.equal(tabs[3].textContent, 'Canvases & files');
  assert.equal(tabs[4].textContent, 'Statistics');

  const right = bar.querySelector('.bar-right');
  const rightButtons = [...right.querySelectorAll('button')];
  assert.equal(rightButtons.length, 2, 'only Ask AI and Share stay in the top-right utility zone');
  assert.equal(bar.querySelector('.bar-skill'), null, 'Add drawing skill is removed from the header');
  assert.equal(bar.querySelector('.bar-settings'), null, 'Project settings gear is removed from top-right');

  const search = right.querySelector('.bar-search');
  const share = right.querySelector('.bar-share');
  assert.equal(search.textContent, 'Ask AI');
  assert.equal(search.querySelector('span').textContent, 'Ask AI');
  assert.equal(search.getAttribute('aria-label'), 'Ask AI about this project');
  assert.equal(search.getAttribute('title'), 'Ask AI about this project');
  assert.equal(search.querySelector('svg').dataset.icon, 'navSearch');
  assert.equal(share.textContent, 'Share');
  assert.equal(share.querySelector('span').textContent, 'Share');
});

test('More menu groups secondary views with dividers and includes Project settings at the bottom', () => {
  const h = headerHarness();
  h.c.renderProjbar();
  const moreBtn = h.document.querySelector('.subnav-more');
  assert.ok(moreBtn);

  h.c.ACT['more-views'](moreBtn);
  const menu = h.document.querySelector('#menu.more-views-menu');
  assert.ok(menu);

  const tokens = [...menu.children].map(el => (el.tagName === 'HR' ? '---' : el.textContent.trim()));
  assert.deepEqual(tokens, ['Memory', 'Vault', '---', 'Archive', 'Deleted', '---', 'Project settings']);

  const settingsBtn = [...menu.querySelectorAll('button')].find(b => b.textContent.trim() === 'Project settings');
  assert.equal(settingsBtn.querySelector('svg').dataset.icon, 'gear');
  settingsBtn.click();
  assert.deepEqual(h.went, [{ view:'settings' }]);

  // Active Project settings view highlights the More button with its label and icon.
  h.c.renderProjbar();
  const activeMore = h.document.querySelector('.subnav-more');
  assert.equal(activeMore.classList.contains('on'), true);
  assert.equal(activeMore.getAttribute('aria-current'), 'page');
  assert.equal(activeMore.textContent.trim(), 'Project settings');
  assert.equal(activeMore.querySelector('svg').dataset.icon, 'gear');
});

test('More menu handles overflowed Statistics, bare My Canvases, and read-only hosted links without dangling dividers', () => {
  // When Statistics spills into More (e.g. narrow viewport), it sits in the Insights & Context group above Memory and Vault.
  const spill = headerHarness();
  spill.S.statsInMore = true;
  spill.c.renderProjbar();
  spill.c.ACT['more-views'](spill.document.querySelector('.subnav-more'));
  const spillTokens = [...spill.document.querySelector('#menu').children].map(el => (el.tagName === 'HR' ? '---' : el.textContent.trim()));
  assert.deepEqual(spillTokens, ['Statistics', 'Memory', 'Vault', '---', 'Archive', 'Deleted', '---', 'Project settings']);

  // Bare My Canvases still offers Project settings under More.
  const bare = headerHarness({ project:{ id:'mine', name:'My Canvases', myCanvases:true, lines:[], landed:[], backlog:[] } });
  bare.c.renderProjbar();
  const bareMore = bare.document.querySelector('.subnav-more');
  assert.ok(bareMore);
  bare.c.ACT['more-views'](bareMore);
  const bareTokens = [...bare.document.querySelector('#menu').children].map(el => (el.tagName === 'HR' ? '---' : el.textContent.trim()));
  assert.deepEqual(bareTokens, ['Project settings']);

  // Read-only hosted link hides Deleted and Project settings without trailing dividers, and keeps Search where Ask AI is unavailable.
  const ro = headerHarness({ hosted:{ read:true, shared:true } });
  ro.c.renderProjbar();
  assert.equal(ro.document.querySelector('.bar-search').textContent, 'Search');
  assert.equal(ro.document.querySelector('.bar-search').getAttribute('aria-label'), 'Search project');
  assert.equal(ro.document.querySelector('.bar-search svg').dataset.icon, 'navSearch');
  ro.c.ACT['more-views'](ro.document.querySelector('.subnav-more'));
  const roTokens = [...ro.document.querySelector('#menu').children].map(el => (el.tagName === 'HR' ? '---' : el.textContent.trim()));
  assert.deepEqual(roTokens, ['Memory', 'Vault', '---', 'Archive']);
});

test('CSS defines the identity-to-tabs vertical divider and keeps Search/Share clean (non-capsuled) with labels visible above phone width', () => {
  const css = read('lines.css');
  assert.match(css, /\.project-name \+ \.subnav \{[^}]*linear-gradient\(var\(--line\)/);
  assert.doesNotMatch(css, /\.bar-right \.bar-(?:search|share)[^{]*\{[^}]*border-radius:\s*999px/);
  assert.doesNotMatch(css, /\.bar-right \.bar-(?:search|share)[^{]*\{[^}]*box-shadow:/);
  assert.doesNotMatch(css, /@media \(max-width: 860px\) \{[^}]*\.canvas-link span \{ display: none; \}/);
});

test('project name stays single-line with max width and gradual fade instead of ellipsis', () => {
  const css = read('lines.css');
  assert.match(css, /\.project-name \{[^}]*(?:^|[;\s])max-width:\s*176px;/);
  assert.doesNotMatch(css, /\.project-name \{[^}]*(?:^|[;\s])width:/);
  assert.match(css, /\.project-name span \{[^}]*flex:\s*0 1 auto;[^}]*min-width:\s*0;[^}]*white-space:\s*nowrap;[^}]*text-overflow:\s*clip;/);
  assert.doesNotMatch(css, /\.project-name span \{[^}]*-webkit-line-clamp/);
  assert.doesNotMatch(css, /\.project-name span \{[^}]*text-overflow:\s*ellipsis/);
  assert.match(css, /\.project-name\.is-overflow span \{[^}]*mask-image:\s*linear-gradient\(to right,[^;]*transparent 100%\)/);

  const mobile = slice(css, '@media (max-width: 640px) {\n  .projbar', '@media (max-width: 480px)');
  assert.match(mobile, /\.project-name \{[^}]*(?:^|[;\s])max-width:/);
  assert.doesNotMatch(mobile, /\.project-name \{[^}]*(?:^|[;\s])width:/);
  assert.doesNotMatch(mobile, /\.project-name span \{[^}]*-webkit-line-clamp/);
});

test('syncProjectNameFade toggles is-overflow only when the name overflows in a visible bar', () => {
  const frames = [];
  const h = headerHarness({ project:{ id:'p1', name:'Calculus class notes (Demo)', lines:[{ id:'l1', stations:[] }], landed:[], backlog:[] } });
  h.c.requestAnimationFrame = fn => { frames.push(fn); return frames.length; };
  h.c.cancelAnimationFrame = () => {};
  h.c.renderProjbar();

  const nameEl = h.document.querySelector('.project-name');
  const textEl = nameEl.querySelector('span');
  let clientW = 146, scrollW = 198;
  Object.defineProperty(textEl, 'clientWidth', { configurable:true, get:() => clientW });
  Object.defineProperty(textEl, 'scrollWidth', { configurable:true, get:() => scrollW });

  assert.equal(nameEl.classList.contains('is-overflow'), false, 'initial render does not fade before measurement');
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(nameEl.classList.contains('is-overflow'), true, 'overflowing name enables fade mask');

  scrollW = 147; // within 1px subpixel tolerance
  h.c.syncProjectNameFade();
  assert.equal(nameEl.classList.contains('is-overflow'), false, 'fitting name disables fade mask');

  scrollW = 198;
  h.c.syncProjectNameFade();
  assert.equal(nameEl.classList.contains('is-overflow'), true, 're-overflowing name restores fade mask');

  clientW = 0; scrollW = 0;
  h.c.syncProjectNameFade();
  assert.equal(nameEl.classList.contains('is-overflow'), true, 'hidden bar leaves overflow state untouched');
});
