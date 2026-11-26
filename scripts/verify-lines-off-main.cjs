#!/usr/bin/env node
'use strict';
// PE-464: Off main lines are listed apart, below the whole of main, never on main's trunk.
// Uses this checkout's pages, isolated project data and no real agents.
// PLAYWRIGHT_PATH=/path/to/playwright node scripts/verify-lines-off-main.cjs [screenshot-folder]
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict'), { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { createProjectLines } = require('../src/server/project-lines/http.js');
const F = require('../src/server/project-lines/format.js');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lines-off-main-'));
const shots = path.resolve(process.argv[2] || path.join(temp, 'shots')); fs.mkdirSync(shots, { recursive:true });
const agents = { available:() => [], nameOf:id => id, desktop:() => null, terminal:() => '' };
const api = createProjectLines({ directory:path.join(temp, 'state'), agents,
  serviceOptions:{ autoWatch:false, docsBase:path.join(temp, 'docs'), memory:{ home:path.join(temp, 'home'), env:{} } },
  isThisComputer:() => true, authorizeRead:() => null, authorizeWrite:() => null,
  readJson:async req => { let body = ''; for await (const chunk of req) body += chunk; return JSON.parse(body || '{}'); },
  send:(res, status, data) => { res.writeHead(status, { 'content-type':'application/json' }); res.end(JSON.stringify(data)); } });
const s = api.service, code = path.join(temp, 'code'); fs.mkdirSync(code);
const git = (...args) => execFileSync('git', args, { cwd:code, encoding:'utf8', stdio:['ignore', 'pipe', 'pipe'] }).trim();
git('init', '-q', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com');
fs.writeFileSync(path.join(code, 'README.md'), 'Off main test\n'); git('add', '.'); git('commit', '-qm', 'Initial'); git('branch', 'feature/search');
let browser, server, passed = 0;
const errors = [], check = (label, ok) => { assert.ok(ok, label); passed++; console.log(`ok ${label}`); };
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.webp':'image/webp' };
const stamp = (daysAgo, minute = 5) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(0, minute, 0, 0); return F.nowLabel(d); };
function seed(project, slug, { offMain = false, branch = '', done = false, daysAgo = 0, minute = 5, title = slug } = {}) {
  const when = stamp(daysAgo, minute), projectCode = project.codePaths?.[0] || '';
  s.writeDoc(project, slug, F.initialLine({ title, id:slug, status:done ? 'ready' : 'notes', created:when, code:projectCode, git:offMain ? 'no' : '', branch,
    steps:done ? [F.askStep({ words:title, when }), F.workStep({ who:'codex', done:true, took:'2 min', body:'The result is ready.' })] : [F.noteStep({ words:title, when })] }));
  if (done) s.store.writeText(project, `works/${slug}/work-1.md`, F.setFront(F.setResult(F.initialDetail({ slug, title, label:'Work 1', who:'codex', started:when }), 'The result is ready.'), { reviewed:when, ended:when }));
}
function makeProject(name, withCode = true) {
  const project = s.store.create({ name, docsPath:path.join(temp, name), ...(withCode ? { codePath:code } : {}) });
  Object.assign(project, { follow:false, autoWake:false, offerSkill:false }); s.store.save(); return project;
}
const OFF = ['test-off', 'topic-off', 'done-off', 'older-off'];
(async () => {
  const p = makeProject('Branch placement');
  await s.refreshTrunk(p);
  seed(p, 'test-main', { title:'Test', minute:50 }); seed(p, 'test-off', { title:'Test offmain', offMain:true, minute:51 });
  seed(p, 'topic-main', { title:'Main account settings', minute:20 }); seed(p, 'topic-off', { title:'Off main account notes', offMain:true, minute:21 });
  seed(p, 'feature', { title:'Account search', branch:'feature/search', minute:30 });
  seed(p, 'done-main', { title:'Main finished result', done:true }); seed(p, 'done-off', { title:'Off main finished result', done:true, offMain:true });
  seed(p, 'older-main', { title:'Yesterday on main', daysAgo:1 }); seed(p, 'older-off', { title:'Yesterday off main', offMain:true, daysAgo:1 });
  s.store.writeText(p, 'topics/accounts.md', `---\nrecord_type: topic\nid: topic-accounts\ntitle: Accounts\n---\n\n# Accounts\n\n**People can manage their accounts.**\n\n## Lines\n\n| Line | What |\n| --- | --- |\n${['topic-main', 'topic-off', 'feature'].map(slug => `| [${slug}](../lines/${slug}.md) | Accounts |`).join('\n')}\n`);
  const plain = makeProject('Notebook', false), many = makeProject('Many lines');
  seed(plain, 'plain-note');
  for (let i = 0; i < 60; i++) seed(many, `many-${String(i).padStart(2, '0')}`, { offMain:i % 4 === 0, minute:i });
  s.sync(p); s.sync(plain); s.sync(many);
  check('server marks Off main lines', s.stateOf(p).lines.filter(l => l.offMain).map(l => l.id).sort().join() === [...OFF].sort().join());
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost'); if (await api.handle(req, res, url)) return;
    const file = path.resolve(root, 'public', '.' + url.pathname);
    if (!file.startsWith(path.join(root, 'public') + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type':mime[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel:'chrome' });
  const context = await browser.newContext({ viewport:{ width:1440, height:1100 }, reducedMotion:'reduce' }), page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(12000);
  const ids = sel => page.locator(sel).evaluateAll(els => els.map(el => el.dataset.row));
  const mainRows = () => ids('#panoRows > .hl-card:not(.hl-off) .hl-row'), offRows = () => ids('#panoRows > .hl-off .hl-row');
  const open = async project => { await page.goto(`${base}/projects.html#${project.id}`); await page.waitForFunction(id => window.__lines?.project()?.id === id && document.querySelector('#panoRows .hl-row'), project.id); };
  await open(p);
  await page.evaluate(() => { readExample(project()); Pano.update(true); });
  await page.screenshot({ path:path.join(shots, 'home.png'), fullPage:true });
  check('main card has only main lines, Off main card only Off main lines', (await mainRows()).every(id => !OFF.includes(id)) && (await offRows()).every(id => OFF.includes(id)) && (await offRows()).length === 3);
  check('Off main stands below the whole of main', await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#panoRows > .hl-card')], head = document.querySelector('#panoRows > .hl-off-head');
    return cards.length === 2 && cards[1].matches('.hl-off') && head.getBoundingClientRect().top >= cards[0].getBoundingClientRect().bottom && cards[1].getBoundingClientRect().top >= head.getBoundingClientRect().bottom;
  }));
  check('main head counts main lines, Off main head counts its own', await page.locator('#panoStart .hl-count').innerText() === '4 lines open' && await page.locator('.hl-off-head .hl-count').innerText() === '3 lines open' && /Off main/.test(await page.locator('.hl-off-head .trunk-label').innerText()));
  check('each card has its own days', (await page.locator('.hl-card:not(.hl-off) .hl-day-w').allInnerTexts()).length === 2 && (await page.locator('.hl-off .hl-day-w').allInnerTexts()).length === 2);
  check('Off main trunk is dashed, main trunk solid', await page.evaluate(() => getComputedStyle(document.querySelector('.hl-off .hl-dayset'), '::before').borderLeftStyle === 'dashed' && getComputedStyle(document.querySelector('.hl-card:not(.hl-off) .hl-dayset'), '::before').borderLeftStyle !== 'dashed'));
  check('a Topic spanning both is grouped in each card with its own count; a branch still wins', await page.locator('.hl-card:not(.hl-off) .is-topic .bh-n').innerText() === '1 line' && await page.locator('.hl-off .is-topic .bh-n').innerText() === '1 line' && await page.locator('.hl-card:not(.hl-off) .hl-branch[data-branch="feature/search"] .hl-row[data-row="feature"]').count() === 1);
  check('clocks and tracks line up in both cards', await page.evaluate(() => [...document.querySelectorAll('.hl-dayset')].every(day => { const c = day.querySelector('.hl-clock').getBoundingClientRect(); return [...day.querySelectorAll('.hl-track')].every(el => Math.abs(el.getBoundingClientRect().x - c.x) < 2 && Math.abs(el.getBoundingClientRect().width - c.width) < 2); })));
  await page.locator('.hl-off .hl-fold-day').click();
  check('a finished Off main line unfolds inside the Off main card', (await offRows()).includes('done-off') && !(await mainRows()).includes('done-off'));
  await page.locator('#homeFilter').fill('Off main account notes');
  check('a search that finds only Off main says so in the main card', (await offRows()).join() === 'topic-off' && /Nothing matches/.test(await page.locator('#panoRows > .hl-card:not(.hl-off) .hl-none').innerText()));
  await page.locator('#homeFilter').fill('');
  await page.locator('.hl-off-head [data-act="new-line-on"]').click();
  check('Off main New line sets the box to Off main', await page.evaluate(() => homeBox(project()).flags.target.off === true && document.activeElement.classList.contains('cmp-input')));
  await page.evaluate(() => { openDrawing = async (_p, form, opts) => { window.drawingTarget = { ...comp(form.dataset.comp).flags.target, asLine:opts.asLine }; }; chooseTarget({ main:true }); });
  await page.locator('.hl-off-head [data-act="draw-line-on"]').click();
  check('Off main Start with a drawing sets Off main', await page.evaluate(() => window.drawingTarget.off === true && window.drawingTarget.asLine));
  await page.evaluate(() => chooseTarget({ main:true }));
  const beforeMain = await mainRows(), beforeOff = await offRows();
  await page.evaluate(() => { project().lineSort = 'mine'; project().lineOrder = ['test-off', 'test-main']; Pano.update(true); });
  check('My order tab and grips are removed, and saved lineSort=mine still renders By time', await page.locator('.pano-sort, [data-act="lines-sort"], .hl-grip').count() === 0 && (await mainRows()).join() === beforeMain.join() && (await offRows()).join() === beforeOff.join() && await page.locator('#panoRows .hl-clock').count() > 0);
  await page.locator('#panoSheet').screenshot({ path:path.join(shots, 'separate.png') });
  await page.evaluate(() => { document.documentElement.dataset.mode = 'dark'; });
  await page.locator('#panoSheet').screenshot({ path:path.join(shots, 'dark.png') });
  const darkLabel = await page.evaluate(() => {
    const probe = document.createElement('span'); probe.style.color = 'var(--ink)'; document.body.append(probe);
    const ink = getComputedStyle(probe).color; probe.remove();
    return { ink, color:getComputedStyle(document.querySelector('.hl-off-head .trunk-label')).color };
  });
  check(`Off main label is readable in dark mode (${darkLabel.color})`, darkLabel.color === darkLabel.ink);
  await page.evaluate(() => { document.documentElement.dataset.mode = 'light'; });
  await page.setViewportSize({ width:390, height:844 }); await page.waitForTimeout(500);
  await page.locator('.hl-off-head').scrollIntoViewIfNeeded();
  await page.screenshot({ path:path.join(shots, 'narrow.png') });
  check('narrow screen keeps Off main controls visible, no sideways scroll', await page.locator('.hl-off-head [data-act="new-line-on"]').isVisible() && await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.setViewportSize({ width:1440, height:1100 });
  await open(plain);
  check('a project with no code folder is one card, unchanged', await page.locator('#panoRows.is-split, .hl-off').count() === 0);
  await open(many);
  check('Off main is shown even when main fills its first 40 rows', (await mainRows()).length === 40 && (await offRows()).length === 15);
  await page.locator('#panoRows [data-act="rows-more"]').first().click();
  check('Show all lists every line once, each in its own card', (await mainRows()).length === 45 && (await offRows()).length === 15 && await page.evaluate(() => [...document.querySelectorAll('.hl-row')].every(el => Boolean(project().lines.find(l => l.id === el.dataset.row).offMain) === Boolean(el.closest('.hl-off')))));
  check('no browser errors', errors.length === 0);
  console.log(`${passed} checks passed. Screenshots: ${shots}`);
})().catch(error => { console.error(error); console.error(errors); process.exitCode = 1; }).finally(async () => {
  await browser?.close(); s.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  fs.rmSync(temp, { recursive:true, force:true, maxRetries:3 });
});
