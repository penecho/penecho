'use strict';
require('./helpers/safety.js');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const read = name => fs.readFileSync(path.join(__dirname, '../public/lines', name), 'utf8');
const lineSource = read('line.js');
const pinActions = lineSource.slice(lineSource.indexOf('async function toggleLinePin('), lineSource.indexOf('// Carry on with ▾'));
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

function pinUI(view = 'home') {
  const line = { id:'child', title:'Existing child', slug:'child', parent:'parent', pinned:false, topicPath:'lines/child.md' };
  const project = { id:'p', lines:[line] }, calls = [], notices = [], attrs = new Map();
  const oldButton = { dataset:{ line:'child' }, getAttribute:key => attrs.get(key), setAttribute:(k, v) => attrs.set(k, v), removeAttribute:k => attrs.delete(k) };
  const document = { activeElement:oldButton };
  const newButton = { dataset:{ line:'child' }, focus:options => { document.activeElement = newButton; calls.push(['focus', options.preventScroll]); } };
  const context = vm.createContext({
    ACT:{}, S:{ cur:project.id, route:{ view } }, EMBED:null, OUTDATED_SAY:'', document, project:() => project,
    lineById:(p, id) => p.lines.find(l => l.id === id), isPinned:(_p, l) => l.pinned,
    pinLine:async (_p, l, on) => { calls.push(['save', on]); l.pinned = on; },
    renderRail:() => calls.push(['rail']), Pano:{ update:() => calls.push(['home']) }, refreshLine:() => calls.push(['detail']),
    $$:() => [newButton], toast:text => notices.push(text), openMenu:(_el, items) => calls.push(['menu', items]),
  });
  vm.runInContext(pinActions, context);
  return { context, line, calls, notices, oldButton, newButton, attrs, document };
}

for (const view of ['home', 'line']) test(`${view} Pin toggles in one activation and restores focus after refreshing`, async () => {
  const h = pinUI(view);
  await h.context.ACT['line-pin'](h.oldButton);
  assert.equal(h.line.pinned, true);
  assert.deepEqual(h.calls.map(c => c[0]), ['save', 'rail', view === 'home' ? 'home' : 'detail', 'focus']);
  assert.deepEqual(h.calls.at(-1), ['focus', true]);
  assert.equal(h.document.activeElement, h.newButton);
  assert.deepEqual(h.notices, ['Pinned']);
  assert.equal(h.attrs.has('aria-busy'), false);
  await h.context.ACT['line-pin'](h.oldButton);
  assert.equal(h.line.pinned, false);
  assert.equal(h.notices.at(-1), 'Unpinned');
});

test('a pending Pin cannot submit twice, and a failed save remains retryable', async () => {
  const h = pinUI();
  let reject;
  h.context.pinLine = () => new Promise((_resolve, failed) => { reject = failed; });
  const pending = h.context.ACT['line-pin'](h.oldButton);
  assert.equal(h.attrs.get('aria-busy'), 'true');
  await h.context.ACT['line-pin'](h.oldButton);
  reject(Error('Could not save Pin'));
  await pending;
  assert.equal(h.line.pinned, false);
  assert.equal(h.calls.length, 0);
  assert.deepEqual(h.notices, ['Could not save Pin']);
  assert.equal(h.attrs.has('aria-busy'), false);
});

test('the line menu omits Split and Pin while preserving Rename and Archive', () => {
  const h = pinUI();
  h.context.ACT['line-menu'](h.oldButton);
  const labels = h.calls[0][1].flatMap(group => group.items.map(item => item.label));
  assert.ok(labels.includes('Rename'));
  assert.ok(labels.includes('Archive'));
  assert.ok(!labels.some(label => /^(Pin|Unpin|Plan and split)$/.test(label)));
});

test('a folded Home row includes the direct Pin and its accessible pressed state', () => {
  const source = read('panorama.js');
  const method = source.slice(source.indexOf('  rowHTML(p, l,'), source.indexOf('  // Nothing is written unless'));
  const context = vm.createContext({
    esc, rowFacts:() => ({ at:0 }), isPinned:(_p, l) => l.pinned,
    lineHintTag:() => '', lineHint:() => '', laneTrackHTML:() => '', laneStateHTML:() => '', laneDetailHTML:() => '', ic:() => '<svg></svg>',
  });
  const row = vm.runInContext(`({ isOpen:() => false, ${method} })`, context);
  for (const pinned of [false, true]) {
    const html = row.rowHTML({}, { id:'child', title:'A "saved" child', pinned });
    assert.match(html, new RegExp(`class="icon-btn hl-pin"[^>]+data-act="line-pin"[^>]+aria-pressed="${pinned}"`));
    assert.match(html, new RegExp(`aria-label="${pinned ? 'Unpin' : 'Pin'} A &quot;saved&quot; child"`));
  }
  assert.doesNotMatch(row.rowHTML({}, { id:'old', title:'Archived', archived:true }), /data-act="line-pin"/);
});

test('New project and empty Canvas show 8 equal points with simple images in both languages without advertising Split', () => {
  const context = vm.createContext({ window:{} });
  vm.runInContext(read('start.js'), context);
  for (const lang of ['en', 'zh']) {
    const html = context.window.PenEchoProjects.benefitsHTML(lang, [], { agentsRow:false, heading:false });
    assert.equal((html.match(/class="pls-point"/g) || []).length, 8);
    assert.equal((html.match(/class="pls-art pls-pt-svg"/g) || []).length, 8);
    assert.match(html, /class="pls-points"/);
    assert.doesNotMatch(html, /class="pls-main"|class="pls-gain"|See proof/);
    // penecho.ai has no Orchestrator: hosted copy keeps all 8 points while omitting Orchestrator mentions.
    const hosted = context.window.PenEchoProjects.benefitsHTML(lang, [], { agentsRow:false, heading:false, orchestrator:false });
    assert.equal((hosted.match(/class="pls-point"/g) || []).length, 8);
    assert.doesNotMatch(hosted, /Orchestrator/);
    assert.doesNotMatch(html, /class="pls-gives"|\{|\}/);
    assert.doesNotMatch(html, /data-gain="plan"|Plan, then hand out|先计划，再分派/);
  }
  const en = context.window.PenEchoProjects.benefitsHTML('en', [], { agentsRow:false });
  assert.match(en, /Agents collaborate on one task/);
  assert.match(en, /True token savings, with proof/);
  assert.match(en, /Every task shows why tokens were saved\./);
  assert.match(en, /Smarter Orchestrator &amp; real ratings/);
  assert.match(en, /Auto-sync across every agent/);
  assert.match(en, /Full job lifecycle at scale/);
  assert.match(en, /Work visually on PenEcho Canvas/);
  assert.match(en, /Plain Markdown Lines &amp; Topics/);
  assert.match(en, /Easy project &amp; Canvas sharing/);
  assert.match(en, /<h2 class="pls-gives">What one project gives you<\/h2>/);
});
