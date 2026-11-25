'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('./helpers/dom.js');

const read = name => fs.readFileSync(path.join(__dirname, '../public/lines', name), 'utf8');

function harness() {
  const { document, window } = parseHTML('<html><body></body></html>');
  const c = vm.createContext({
    document,
    window,
    ACT:{},
    SEND:{},
    HOSTED:false,
    EMBED:null,
    STATE_COLOR:{},
    LINE_STATUS:require('../public/lines/line-status.js'),
    localStorage:{ getItem:() => null },
    addEventListener() {},
    esc:String,
    ic:name => `<svg data-icon="${name}"></svg>`,
    av:() => '',
    nodeIcon:() => '',
    inlineSay:String,
    can:() => true,
    agentInfo:id => ({ id, name:id }),
    availableAgents:() => [{ id:'codex', name:'Codex' }],
    fileEntry:() => null,
    canvasByPath:() => null,
    navigator:{ platform:'Mac' },
  });
  vm.runInContext(read('state.js'), c);
  vm.runInContext(read('line.js'), c);
  return { c, document };
}

function renderCard(c, document, lineExtra, stationExtra) {
  const l = {
    id:'one',
    slug:'one',
    status:'stopped',
    archived:false,
    closed:false,
    running:false,
    questions:[],
    stations:[],
    ...lineExtra,
  };
  const s = {
    id:'work-2',
    index:1,
    kind:'work',
    label:'Work 2',
    agent:'antigravity',
    state:'off',
    off:'stopped',
    reviewed:false,
    refers:[],
    pictures:[],
    files:[],
    ...stationExtra,
  };
  l.stations = [{ id:'ask-1', index:0, kind:'ask', state:'done', text:'Test ask' }, s];
  const p = { id:'p', files:[], lines:[l], landed:[], backlog:[] };
  const host = document.createElement('div');
  host.innerHTML = c.workItem(p, l, s);
  return host.firstElementChild;
}

test('stopped Work card keeps Remove inside header .lp-work-tools beside Reviewed and before .lp-open', () => {
  const { c, document } = harness();
  const card = renderCard(c, document, {}, { off:'stopped', reviewed:false });
  const header = card.querySelector(':scope > header');
  assert.ok(header, 'header exists');
  assert.equal(card.querySelector(':scope > .lp-tools'), null, 'Remove toolbar is no longer an unanchored direct child overlaying .lp-open');

  const wrap = header.querySelector(':scope > .lp-work-tools');
  assert.ok(wrap, 'header contains .lp-work-tools');
  const tools = wrap.querySelector(':scope > .lp-tools');
  const drop = tools?.querySelector('[data-act="yours-drop"]');
  const mark = wrap.querySelector(':scope > .lp-mark');
  const open = header.querySelector(':scope > .lp-open');
  assert.ok(drop, 'Remove tool is inside .lp-work-tools');
  assert.ok(mark, 'Reviewed mark is inside .lp-work-tools');
  assert.ok(open, 'Open chevron is in header');

  const children = [...header.children];
  assert.ok(children.indexOf(wrap) < children.indexOf(open), '.lp-work-tools precedes .lp-open');
  const wrapChildren = [...wrap.children];
  assert.ok(wrapChildren.indexOf(tools) < wrapChildren.indexOf(mark), 'Remove precedes Reviewed inside .lp-work-tools');
});

test('discarded Work card omits Reviewed while keeping Remove inside .lp-work-tools before .lp-open', () => {
  const { c, document } = harness();
  const card = renderCard(c, document, {}, { off:'discarded', reviewed:false });
  const header = card.querySelector(':scope > header');
  const wrap = header.querySelector(':scope > .lp-work-tools');
  assert.ok(wrap);
  assert.ok(wrap.querySelector('[data-act="yours-drop"]'));
  assert.equal(wrap.querySelector('.lp-mark'), null);
  assert.ok(header.querySelector(':scope > .lp-open'));
});

test('archived or closed Line keeps Delete (PE-1144) and Reviewed in .lp-work-tools', () => {
  const { c, document } = harness();
  for (const flag of [{ archived:true }, { closed:true }]) {
    const card = renderCard(c, document, flag, { off:'stopped', reviewed:true });
    const wrap = card.querySelector(':scope > header > .lp-work-tools');
    assert.ok(wrap);
    assert.ok(wrap.querySelector('[data-act="yours-drop"]'));
    assert.ok(wrap.querySelector('.lp-mark'));
  }
});

test('line.css places .lp-work .lp-tools inline inside .lp-work-tools and avoids .can-carry opacity bleed', () => {
  const css = read('line.css');
  assert.match(css, /\.lp-work-tools\s*\{[^}]*position:\s*absolute;[^}]*right:\s*27px;/);
  assert.match(css, /\.lp-work\.is-reviewed\s+\.lp-work-tools\s*\{[^}]*position:\s*static;/);
  assert.match(css, /\.lp-work\s+\.lp-tools\s*\{[^}]*position:\s*static;/);
  assert.match(css, /\.lp-work:hover\s+\.lp-tools,\s*\.lp-work:focus-within\s+\.lp-tools/);
  assert.doesNotMatch(css, /\.lp-ask,\s*\.lp-note,\s*\.lp-drawing,\s*\.lp-work\.w-off\s*\{/);
});

test('review header keeps the score, Delete, and Open in non-overlapping flex order', () => {
  const { c, document } = harness();
  const l = { id:'one', slug:'one', status:'done', archived:false, closed:false, stations:[], questions:[] };
  const s = {
    id:'work-1--review', kind:'orch-review', state:'done', workId:'work-1', workLabel:'Work 1',
    review:{ schema:2, verdict:'ready', score:4.6, outcome:4.6, verification:5, safety:5, requirements:[], findings:[] },
  };
  const host = document.createElement('div');
  host.innerHTML = c.orchReviewItem({ id:'p', files:[] }, l, s);
  const header = host.querySelector('.lp-rv-head');
  const score = header.querySelector('.rv-score');
  const tools = header.querySelector('.lp-tools');
  const open = header.querySelector('.lp-open');
  assert.equal(score.textContent, 'Ready · 4.6/5');
  assert.ok(tools.querySelector('[data-act="yours-drop"]'));
  const children = [...header.children];
  assert.ok(children.indexOf(score) < children.indexOf(tools), 'Delete follows the score');
  assert.ok(children.indexOf(tools) < children.indexOf(open), 'Open follows Delete');

  const css = read('line.css');
  assert.match(css, /\.lp-rv-head\s+\.lp-tools\s*\{[^}]*position:\s*static;[^}]*flex:\s*none;/);
  assert.doesNotMatch(css, /\.lp-rv-head\s+\.lp-open\s*\{[^}]*position:\s*absolute;/);
});
