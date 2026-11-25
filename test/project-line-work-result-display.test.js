'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('./helpers/dom.js');
const F = require('../src/server/project-lines/format.js');
const { Service } = require('../src/server/project-lines/service.js');

const readPublic = name => fs.readFileSync(path.join(__dirname, '../public/lines', name + '.js'), 'utf8');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const ic = (name, size = 18) => `<svg class="ic" data-icon="${name}" width="${size}" height="${size}"></svg>`;

function loadDocHarness({ apiImpl, partial = '' } = {}) {
  const S = { cur:'p', data:{}, docs:{}, route:{ view:'line', line:'demo' } };
  const p = { id:'p', name:'PenEcho', partial, lines:[], landed:[], backlog:[], files:[], knowledge:[], understanding:false };
  S.data.p = p;
  const c = vm.createContext({
    console, S, Map, Set, Number, Object, String, Boolean, Array, RegExp, Promise, encodeURIComponent,
    api:apiImpl,
    project:() => p,
    allLines:proj => [...(proj.lines || []), ...(proj.landed || []), ...(proj.backlog || [])],
    pathFor:id => `/projects/${encodeURIComponent(id)}`,
  });
  const stateSrc = readPublic('state');
  vm.runInContext(stateSrc.slice(stateSrc.indexOf('const listsFiles ='), stateSrc.indexOf('let stateRequest =')), c);
  vm.runInContext(stateSrc.slice(stateSrc.indexOf('const fileEntry ='), stateSrc.indexOf('// ---------- Topics that changed ----------')), c);
  return { c, S, p };
}

function panelHarness({ apiImpl, workFileEntry = null } = {}) {
  const { document, window } = parseHTML('<html><body><div id="lppTokens"></div><div id="lppResultTools"></div><div id="lppResult"></div></body></html>');
  const timers = [];
  let nextTimerId = 1;
  const p = {
    id:'p',
    name:'PenEcho',
    partial:'',
    vault:{ path:'/docs' },
    lines:[],
    landed:[],
    backlog:[],
    files:workFileEntry ? [workFileEntry] : [],
    knowledge:[],
    understanding:false,
  };
  const l = { id:'demo', slug:'demo', closed:false, asking:null, branch:'', stations:[] };
  p.lines.push(l);
  const S = { cur:'p', data:{ p }, docs:{}, route:{ view:'line', line:'demo' }, lineSel:null, resultMode:'read' };
  const toasts = [], copied = [];
  const allLines = proj => [...(proj.lines || []), ...(proj.landed || []), ...(proj.backlog || [])];
  const c = vm.createContext({
    document, window, console, S, ACT:{}, Map, Set, Number, Object, String, Boolean, Array, RegExp, Promise, Error, encodeURIComponent,
    HOSTED:false, EMBED:null,
    $:(selector, root = document) => root.querySelector(selector),
    $$:(selector, root = document) => [...root.querySelectorAll(selector)],
    esc, ic,
    setTimeout:(fn, ms) => { const id = nextTimerId++; timers.push({ id, fn, ms, cleared:false }); return id; },
    clearTimeout:id => { const t = timers.find(x => x.id === id); if (t) t.cleared = true; },
    api:apiImpl,
    project:() => p,
    lineById:(proj, id) => allLines(proj).find(x => x.id === id),
    stationById:(line, id) => line.stations.find(x => x.id === id),
    docsFile:(proj, rel) => `${proj.vault.path}/${rel}`,
    refreshLine:() => {},
    toast:msg => { toasts.push(msg); },
    copyText:async (text, ok) => { copied.push({ text, ok }); return true; },
    allLines,
    pathFor:id => `/projects/${encodeURIComponent(id)}`,
    resolvePath:(from, href) => href,
    linkedPath:(from, href) => href,
    isWork:s => s.kind === 'work',
    isOrchReview:s => Boolean(s && (s.kind === 'orch-review' || s.isOrchReview)),
    stopWhyWords:() => '',
    stopWhyOf:() => '',
    latestWork:() => l.stations[l.stations.length - 1],
    resultFiles:() => [],
    askOnly:x => x,
    askedHTML:() => '',
    topicChooserHTML:() => '',
    orchRateCardHTML:() => '',
    workReviewButtonHTML:() => '',
    rateBoxHTML:() => '',
    highlightSource:t => esc(t),
    workFileAnchor:() => '',
    holdMath:s => s,
    replaceMarkdownLinks:s => s,
    fileChip:() => '',
    picButton:() => '',
    filesApart:() => false,
    filesLabel:() => '',
    LINE_STATUS:{ markdownLinks:() => [] },
    navigator:{ platform:'MacIntel' },
  });
  const stateSrc = readPublic('state');
  vm.runInContext(stateSrc.slice(stateSrc.indexOf('const listsFiles ='), stateSrc.indexOf('let stateRequest =')), c);
  vm.runInContext(stateSrc.slice(stateSrc.indexOf('const fileEntry ='), stateSrc.indexOf('async function saveDoc(')), c);

  const lineSrc = readPublic('line');
  vm.runInContext(lineSrc.slice(lineSrc.indexOf('const MD_FENCE_OPEN ='), lineSrc.indexOf('// ---------- The line, down the side')), c);
  vm.runInContext(lineSrc.slice(lineSrc.indexOf('function resultParts('), lineSrc.indexOf('function panelInto(')), c);
  vm.runInContext(lineSrc.slice(lineSrc.indexOf('function sayInline('), lineSrc.indexOf('function toolRow(')), c);
  vm.runInContext('this.mdSection = mdSection; this.copyPartsOf = copyPartsOf;', c);

  return { c, S, p, l, document, timers, toasts, copied };
}

test('the Markdown preview jumps to its file’s Line, not the currently open Line', () => {
  const { c, p, l } = panelHarness();
  const owner = { id:'other', slug:'another-line', title:'Another Line', topicPath:'lines/another-line.md' };
  p.landed.push(owner);
  const calls = [];
  Object.assign(c, {
    routeToHash:route => `p/${route.view}/${route.line}`,
    renderMd:md => esc(md),
    closeLightbox:() => calls.push('close'),
  });
  c.ACT['open-line'] = el => calls.push(el.dataset.line);
  const source = readPublic('line');
  vm.runInContext(source.slice(source.indexOf('function viewerHTML('), source.indexOf('// Quotes this in the line')), c);

  for (const [docPath, sourceMode] of [['works/another-line/work-2.md', false], ['works/another-line/work-2.md', true], [owner.topicPath, false]]) {
    const html = c.viewerHTML(docPath.split('/').pop(), '# Content', sourceMode, true, { path:docPath });
    const { document } = parseHTML(html);
    const link = document.querySelector('.viewer-header a');
    assert.equal(link.textContent, 'Jump to Line');
    assert.equal(link.getAttribute('href'), '#p/line/other');
    assert.notEqual(link.dataset.line, l.id);
    c.ACT[link.dataset.act](link);
  }
  assert.deepEqual(calls, ['close', 'other', 'close', 'other', 'close', 'other']);
  for (const doc of [null, { path:'files/demo/work-2.md' }, { path:'works/missing/work-2.md' }]) {
    assert.doesNotMatch(c.viewerHTML('work-2.md', '', false, true, doc), /Jump to Line/);
  }
});

test('mdSection and format.js preserve full LLM output with --- rules, fenced ## headings, and <!-- comments', () => {
  const md = [
    '---',
    'line: ../../lines/demo.md',
    'step: Work 3',
    '---',
    '',
    '# Work 3: Demo',
    '',
    '## Result',
    '',
    '<!-- result: the agent\'s last message -->',
    'Opening summary paragraph:',
    '',
    '---',
    '',
    '### Option 1',
    '',
    '```markdown',
    '## Heading inside fenced code',
    '<!-- literal comment inside code -->',
    '```',
    '',
    'Prose mentioning an unclosed `<!--` token should never erase what follows.',
    '',
    '---',
    '',
    '### Option 2',
    '',
    'Final recommendation paragraph.',
    '<!-- /result -->',
    '',
    '## How it was done',
    '',
    '- Read `line.js`',
  ].join('\n');

  const h = panelHarness({ apiImpl:async () => ({}) });
  const extractedUi = h.c.mdSection(md, 'Result');
  assert.match(extractedUi, /^Opening summary paragraph:/);
  assert.match(extractedUi, /## Heading inside fenced code/);
  assert.match(extractedUi, /<!-- literal comment inside code -->/);
  assert.match(extractedUi, /unclosed `<!--` token/);
  assert.match(extractedUi, /Final recommendation paragraph\.$/);
  assert.doesNotMatch(extractedUi, /How it was done/);
  assert.doesNotMatch(extractedUi, /<!-- result:/);
  assert.doesNotMatch(extractedUi, /<!-- \/result -->/);

  const html = h.c.sayHTML(extractedUi);
  assert.match(html, /<hr>/);
  assert.doesNotMatch(html, /<p>---<\/p>/);
  assert.match(html, /Final recommendation paragraph\./);

  const serverRaw = F.sectionText(md, 'Result');
  const serverParsed = F.resultOf(serverRaw).text;
  assert.equal(serverParsed, extractedUi);
  assert.equal(F.sectionText(md, 'How it was done'), '- Read `line.js`');
});

test('mdSection and findSection keep unescaped ## headings inside <!-- result --> wrapper and handle CRLF', () => {
  const md = [
    '## Result',
    '',
    '<!-- result: the agent\'s last message -->',
    'Intro line.',
    '',
    '## Unescaped Section Heading',
    '',
    'Body after heading.',
    '<!-- /result -->',
    '',
    '## Changes',
    '',
    '+1 -0 in 1 file.',
  ].join('\r\n');

  const h = panelHarness({ apiImpl:async () => ({}) });
  const ui = h.c.mdSection(md, 'Result');
  assert.match(ui, /## Unescaped Section Heading/);
  assert.match(ui, /Body after heading\.$/);
  assert.doesNotMatch(ui, /\+1 -0/);

  const server = F.resultOf(F.sectionText(md, 'Result')).text;
  assert.equal(server, ui);
  assert.equal(F.sectionText(md, 'Changes'), '+1 -0 in 1 file.');
});

test('loadDoc refuses stale cache for missing works/ entry and ignores slower out-of-order response', async () => {
  const detailPath = 'works/demo/work-3.md';
  const runningMd = '## Now\n\nWorking\n';
  const finishedMd = '## Result\n\n<!-- result: the agent\'s last message -->\nIntro:\n\n---\n\nFull body.\n<!-- /result -->\n';

  let resolveSlow;
  let callCount = 0;
  const h = loadDocHarness({
    apiImpl:async () => {
      callCount++;
      if (callCount === 1) return { md:runningMd, hash:'h1', mtime:100 };
      if (callCount === 2) return new Promise(r => { resolveSlow = r; });
      return { md:finishedMd, hash:'h3', mtime:300 };
    },
  });

  // 1. Initial load while running (no fileEntry in p.files yet)
  const first = await h.c.loadDoc(h.p, detailPath);
  assert.equal(first.mtime, 100);
  assert.equal(callCount, 1);

  // 2. Second load starts while entry is still missing -> must NOT reuse stale works/ cache
  const slowPromise = h.c.loadDoc(h.p, detailPath);
  assert.equal(callCount, 2);

  // 3. Third load starts with newer mtime and finishes FIRST
  h.p.files = [{ path:detailPath, mtime:300, size:120 }];
  const fastDoc = await h.c.loadDoc(h.p, detailPath);
  assert.equal(callCount, 3);
  assert.equal(fastDoc.mtime, 300);
  assert.match(fastDoc.md, /Full body\./);

  // 4. Slower earlier fetch finally resolves with older pre-result doc -> must NOT clobber!
  resolveSlow({ md:runningMd, hash:'h2', mtime:200 });
  const afterSlow = await slowPromise;
  assert.equal(afterSlow.mtime, 300);
  assert.match(h.S.docs['p:' + detailPath].md, /Full body\./);
});

test('fillPanel forces refresh when finished Work has stale cached doc without ## Result, and retries transient failures', async () => {
  const detailPath = 'works/demo/work-3.md';
  const runningMd = '## Now\n\nRunning\n';
  const finishedMd = [
    '## Result',
    '',
    '<!-- result: the agent\'s last message -->',
    'Based on the two issues, here is what I suggest:',
    '',
    '---',
    '',
    '### Option 1',
    '',
    'Move both skills to user-level.',
    '<!-- /result -->',
  ].join('\n');

  let attempts = 0;
  const h = panelHarness({
    workFileEntry:{ path:detailPath, mtime:100, size:20 },
    apiImpl:async () => {
      attempts++;
      if (attempts === 1) throw new Error('temporary restart');
      return { md:finishedMd, hash:'h2', mtime:200 };
    },
  });

  // Pre-seed stale cache from while Work 3 was active (same mtime=100 as stale p.files entry!)
  h.S.docs['p:' + detailPath] = { id:detailPath, path:detailPath, kind:'detail', md:runningMd, hash:'h1', mtime:100 };

  const s = {
    id:'work-3',
    kind:'work',
    label:'Work 3',
    state:'done',
    detail:detailPath,
    out:'Based on the two issues, here is what I suggest:',
    pictures:[],
    files:[],
    refers:[],
  };
  h.l.stations.push(s);
  h.S.lineSel = s;

  await h.c.fillPanel(h.p, h.l, s);
  await new Promise(r => setImmediate(r));
  // First attempt failed -> fallback s.out shown temporarily, retry timer scheduled
  assert.equal(attempts, 1);
  assert.match(h.document.querySelector('#lppResult').innerHTML, /Based on the two issues/);
  assert.doesNotMatch(h.document.querySelector('#lppResult').innerHTML, /Move both skills/);
  assert.equal(h.timers.filter(t => !t.cleared).length, 1);

  // Fire retry timer -> succeeds and paints the complete multi-section Result!
  const pending = h.timers.find(t => !t.cleared);
  await pending.fn();
  // Let microtasks flush
  await new Promise(r => setImmediate(r));
  assert.equal(attempts, 2);
  const finalHtml = h.document.querySelector('#lppResult').innerHTML;
  assert.match(finalHtml, /Based on the two issues/);
  assert.match(finalHtml, /<hr>/);
  assert.match(finalHtml, /Option 1/);
  assert.match(finalHtml, /Move both skills to user-level\./);
});

test('unclosed result wrapper and unclosed code fence inside wrapper never swallow later sections', () => {
  const unclosedWrapper = [
    '## Result',
    '',
    '<!-- result: the agent\'s last message -->',
    'Only the real result text.',
    '',
    '## What changed',
    '',
    '- file.js',
    '',
    '## How it was done',
    '',
    '- Read file.js',
  ].join('\n');

  const h = panelHarness({ apiImpl:async () => ({}) });
  assert.equal(h.c.mdSection(unclosedWrapper, 'Result'), 'Only the real result text.');
  assert.equal(F.resultOf(F.sectionText(unclosedWrapper, 'Result')).text, 'Only the real result text.');
  assert.equal(F.sectionText(unclosedWrapper, 'How it was done'), '- Read file.js');

  const unclosedFence = [
    '## Result',
    '',
    '<!-- result: the agent\'s last message -->',
    'Before fence.',
    '```js',
    'const x = 1;',
    '<!-- /result -->',
    '',
    '## How it was done',
    '',
    '- Checked output',
  ].join('\n');

  const uiFence = h.c.mdSection(unclosedFence, 'Result');
  assert.match(uiFence, /const x = 1;/);
  assert.doesNotMatch(uiFence, /<!-- \/result -->/);
  assert.doesNotMatch(uiFence, /How it was done/);
  assert.equal(F.resultOf(F.sectionText(unclosedFence, 'Result')).text, uiFence);
  assert.equal(F.sectionText(unclosedFence, 'How it was done'), '- Checked output');
});

test('findSection skips inner ## headings inside result wrapper and setSection preserves CRLF and code blank lines', () => {
  const md = [
    '## Result',
    '',
    '<!-- result: the agent\'s last message -->',
    'Intro',
    '',
    '## Changes',
    '',
    '```js',
    'a();',
    '',
    '',
    'b();',
    '```',
    '<!-- /result -->',
    '',
    '## Changes',
    '',
    '+2 -1 in 1 file.',
  ].join('\r\n');

  assert.equal(F.sectionText(md, 'Changes'), '+2 -1 in 1 file.');
  const updated = F.setSection(md, 'Pictures', '![pic](a.png)', ['Changes']);
  assert.ok(updated.includes('\r\n'), 'CRLF line endings should be preserved');
  assert.match(updated, /a\(\);\r\n\r\n\r\nb\(\);/, 'double blank lines inside code block should stay intact');
  assert.equal(F.sectionText(updated, 'Pictures'), '![pic](a.png)');
  assert.match(F.resultOf(F.sectionText(updated, 'Result')).text, /## Changes/);
});

test('sayHTML supports ~~~ fences and does not turn indented dashes or Setext underlines into <hr>', () => {
  const h = panelHarness({ apiImpl:async () => ({}) });
  const md = [
    '~~~md',
    '## Inside tilde fence',
    '---',
    '~~~',
    '',
    '    ---',
    '',
    'Setext title',
    '---',
    '',
    '---',
    '',
    'After rule',
  ].join('\n');
  const html = h.c.sayHTML(md);
  assert.match(html, /<pre>## Inside tilde fence\n---<\/pre>/);
  assert.equal((html.match(/<hr>/g) || []).length, 1);
  assert.match(html, /Setext title<br>---/);
});

test('fillPanel retries once when forced load succeeds with stale doc still lacking ## Result, and saveDoc invalidates earlier forced loadDoc', async () => {
  const detailPath = 'works/demo/work-4.md';
  const runningMd = '## Now\n\nRunning\n';
  const finishedMd = '## Result\n\n<!-- result: the agent\'s last message -->\nFull delayed output.\n<!-- /result -->\n';

  let calls = 0;
  const h = panelHarness({
    workFileEntry:{ path:detailPath, mtime:100, size:20 },
    apiImpl:async () => {
      calls++;
      if (calls === 1) return { md:runningMd, hash:'h1', mtime:100 };
      return { md:finishedMd, hash:'h2', mtime:200 };
    },
  });
  h.S.docs['p:' + detailPath] = { id:detailPath, path:detailPath, kind:'detail', md:runningMd, hash:'h1', mtime:100 };
  const s = { id:'work-4', kind:'work', label:'Work 4', state:'done', detail:detailPath, out:'Short summary', pictures:[], files:[], refers:[] };
  h.l.stations.push(s);
  h.S.lineSel = s;

  await h.c.fillPanel(h.p, h.l, s);
  await new Promise(r => setImmediate(r));
  assert.equal(calls, 1);
  const pending = h.timers.find(t => !t.cleared);
  assert.ok(pending, 'follow-up retry should be scheduled when forced read still lacks ## Result');
  await pending.fn();
  await new Promise(r => setImmediate(r));
  assert.equal(calls, 2);
  assert.match(h.document.querySelector('#lppResult').innerHTML, /Full delayed output\./);

  // saveDoc vs in-flight forced loadDoc
  let resolveOlderLoad;
  const sh = loadDocHarness({
    apiImpl:async (_path, init) => {
      if (init?.method === 'PUT') return { hash:'h-saved', mtime:500 };
      return new Promise(r => { resolveOlderLoad = r; });
    },
  });
  sh.c.topicsMine = new Set();
  const doc = { id:'notes/a.md', path:'notes/a.md', md:'v1', hash:'h1', mtime:100 };
  sh.S.docs['p:notes/a.md'] = doc;
  const olderForced = sh.c.loadDoc(sh.p, 'notes/a.md', { force:true });
  await sh.c.saveDoc(sh.p, doc, 'v2-saved');
  resolveOlderLoad({ md:'v1-stale', hash:'h1', mtime:100 });
  const after = await olderForced;
  assert.equal(after.md, 'v2-saved');
  assert.equal(sh.S.docs['p:notes/a.md'].md, 'v2-saved');
});

test('Copy surfaces failure instead of silently returning summary, and retries on next click after recovery', async () => {
  const detailPath = 'works/demo/work-5.md';
  const runningMd = '## Now\n\nRunning\n';
  const finishedMd = [
    '## Result',
    '',
    '<!-- result: the agent\'s last message -->',
    'Summary line.',
    '',
    'Full second paragraph that must be copied.',
    '<!-- /result -->',
  ].join('\n');

  let calls = 0;
  let failReads = true;
  const h = panelHarness({
    workFileEntry:{ path:detailPath, mtime:100, size:20 },
    apiImpl:async () => {
      calls++;
      if (failReads) throw new Error('network blip');
      return { md:finishedMd, hash:'h2', mtime:100 };
    },
  });
  h.S.docs['p:' + detailPath] = { id:detailPath, path:detailPath, kind:'detail', md:runningMd, hash:'h1', mtime:100 };
  const s = { id:'work-5', kind:'work', label:'Work 5', state:'done', detail:detailPath, out:'Summary line.', pictures:[], files:[], refers:[] };
  h.l.stations.push(s);

  // Attempt 1: detail request fails -> surfaces failure, does not copy summary, does not mark forced refresh complete
  await h.c.ACT['copy-step']({ dataset:{ step:'work-5' } });
  assert.equal(calls, 1);
  assert.equal(h.copied.length, 0);
  assert.equal(h.toasts.length, 1);
  assert.match(h.toasts[0], /Could not load/i);

  // Restore detail endpoint -> Attempt 2 retries with network read and copies full result
  failReads = false;
  await h.c.ACT['copy-step']({ dataset:{ step:'work-5' } });
  assert.equal(calls, 2);
  assert.equal(h.copied.length, 1);
  assert.match(h.copied[0].text, /Full second paragraph that must be copied\./);
  assert.equal(h.copied[0].ok, 'Copied');

  // Attempt 3: cached full result is reused without another network read
  await h.c.ACT['copy-step']({ dataset:{ step:'work-5' } });
  assert.equal(calls, 2);
  assert.equal(h.copied.length, 2);
  assert.match(h.copied[1].text, /Full second paragraph that must be copied\./);
});

test('fillPanel does not suppress forced retry when a poll interrupts a failed detail read', async () => {
  const detailPath = 'works/demo/work-6.md';
  const runningMd = '## Now\n\nRunning\n';
  const finishedMd = '## Result\n\n<!-- result: the agent\'s last message -->\nRecovered full output.\n<!-- /result -->\n';

  let calls = 0;
  let failReads = true;
  const h = panelHarness({
    workFileEntry:{ path:detailPath, mtime:100, size:20 },
    apiImpl:async () => {
      calls++;
      if (failReads) throw new Error('offline');
      return { md:finishedMd, hash:'h2', mtime:100 };
    },
  });
  h.S.docs['p:' + detailPath] = { id:detailPath, path:detailPath, kind:'detail', md:runningMd, hash:'h1', mtime:100 };
  const s = { id:'work-6', kind:'work', label:'Work 6', state:'done', detail:detailPath, out:'Short summary', pictures:[], files:[], refers:[] };
  h.l.stations.push(s);
  h.S.lineSel = s;

  await h.c.fillPanel(h.p, h.l, s);
  await new Promise(r => setImmediate(r));
  assert.equal(calls, 1);

  // Simulate a poll invoking fillPanel again after the server recovers (unchanged mtime)
  failReads = false;
  await h.c.fillPanel(h.p, h.l, s);
  await new Promise(r => setImmediate(r));
  assert.equal(calls, 2);
  assert.match(h.document.querySelector('#lppResult').innerHTML, /Recovered full output\./);
});

test('closeDetail and setResult preserve literal ## inside fenced code and avoid duplicating inline <!-- /result --> mentions on re-save', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'work-result-save-'));
  const directory = path.join(root, 'state');
  fs.mkdirSync(directory);
  const service = new Service({ directory, agents:{ available:() => [], desktop:() => null, terminal:() => '' }, autoWatch:false });
  t.after(() => { service.close(); fs.rmSync(root, { recursive:true, force:true }); });

  const project = service.store.create({ name:'SaveTest', docsPath:path.join(root, 'Docs') });
  service.writeDoc(project, 'sample', '---\nid: S-1\nstatus: working\ncreated: 2026-11-20 10:00\n---\n\n# Sample\n\n## Ask · 2026-11-20 10:00\n\nShow markdown.\n\n## [ ] Work 1 · @codex\n');

  const reply = [
    'Here is a literal Markdown example mentioning inline `<!-- /result -->` markers:',
    '',
    '```markdown',
    '## Sample',
    '<!-- /result -->',
    '```',
    '',
    '## Summary',
    '',
    'Everything stays verbatim.',
  ].join('\n');

  await service.closeDetail(project, 'sample', 'work-1', { result:reply, took:'1 min' });
  const rel = F.detailPath('sample', 'work-1');
  const savedOnce = service.store.readText(project, rel).text;
  assert.match(savedOnce, /```markdown\n## Sample\n<!-- \/result -->\n```/);
  assert.doesNotMatch(savedOnce, /### Sample/);

  const h = panelHarness({ apiImpl:async () => ({}) });
  assert.equal(F.resultOf(F.sectionText(savedOnce, 'Result')).text, reply);
  assert.equal(h.c.mdSection(savedOnce, 'Result'), reply);

  // Re-saving via closeDetail (or F.setResult) must replace cleanly without duplicating text after inline `<!-- /result -->`
  await service.closeDetail(project, 'sample', 'work-1', { result:reply, took:'2 min' });
  const savedTwice = service.store.readText(project, rel).text;
  assert.equal(F.resultOf(F.sectionText(savedTwice, 'Result')).text, reply);
  assert.equal(h.c.mdSection(savedTwice, 'Result'), reply);
  assert.equal(savedTwice.split('Everything stays verbatim.').length - 1, 1);

  const viaSetResult = F.setResult(savedTwice, reply);
  assert.equal(F.resultOf(F.sectionText(viaSetResult, 'Result')).text, reply);
  assert.equal(viaSetResult.split('Everything stays verbatim.').length - 1, 1);
});

test('literal <!-- /result --> in later sections or inside fenced code never hides Changes or How it was done', () => {
  const md = [
    '## Result',
    '',
    '<!-- result: the agent\'s last message -->',
    'Reply with a fenced marker:',
    '',
    '```markdown',
    '## Inside Result Code',
    '<!-- /result -->',
    '```',
    '',
    'Closing sentence of reply.',
    '<!-- /result -->',
    '',
    '## Changes',
    '',
    '+5 -1 in 2 files.',
    '',
    '## How it was done',
    '',
    '```markdown',
    '<!-- /result -->',
    '```',
  ].join('\n');

  const expectedResult = [
    'Reply with a fenced marker:',
    '',
    '```markdown',
    '## Inside Result Code',
    '<!-- /result -->',
    '```',
    '',
    'Closing sentence of reply.',
  ].join('\n');

  const h = panelHarness({ apiImpl:async () => ({}) });
  assert.equal(h.c.mdSection(md, 'Result'), expectedResult);
  assert.equal(F.resultOf(F.sectionText(md, 'Result')).text, expectedResult);
  assert.equal(F.sectionText(md, 'Changes'), '+5 -1 in 2 files.');
  assert.equal(h.c.mdSection(md, 'Changes'), '+5 -1 in 2 files.');
  assert.match(F.sectionText(md, 'How it was done'), /<!-- \/result -->/);
  assert.match(h.c.mdSection(md, 'How it was done'), /<!-- \/result -->/);

  // Unclosed code fence inside Result + later fenced block in How it was done
  const unclosedPlusLaterFence = [
    '## Result',
    '',
    '<!-- result: the agent\'s last message -->',
    'Before unclosed fence.',
    '```js',
    'const y = 2;',
    '<!-- /result -->',
    '',
    '## Changes',
    '',
    '+1 -0 in 1 file.',
    '',
    '## How it was done',
    '',
    '```text',
    'later fenced example',
    '```',
  ].join('\n');

  assert.equal(F.sectionText(unclosedPlusLaterFence, 'Changes'), '+1 -0 in 1 file.');
  assert.equal(h.c.mdSection(unclosedPlusLaterFence, 'Changes'), '+1 -0 in 1 file.');
  assert.doesNotMatch(h.c.mdSection(unclosedPlusLaterFence, 'Result'), /Changes/);
  assert.match(h.c.mdSection(unclosedPlusLaterFence, 'Result'), /const y = 2;/);
});
