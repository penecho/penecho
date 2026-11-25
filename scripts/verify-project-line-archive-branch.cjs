#!/usr/bin/env node
"use strict";
// Real-browser check of Archive all on a branch's head: hidden beside New line until hovered, a click asks once more, unmerged work asks too, takes the branch's lines and its sub-branches' lines, leaves the rest, and Undo brings them all back.
// PLAYWRIGHT_PATH=... node scripts/verify-project-line-archive-branch.cjs [folder for screenshots]
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { createProjectLines } = require('../src/server/project-lines/http.js');
const F = require('../src/server/project-lines/format.js');
const root = path.resolve(__dirname, '..'), temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'line-archive-branch-')));
const shots = path.resolve(process.argv[2] || path.join(temp, 'shots')); fs.mkdirSync(shots, { recursive:true });
let browser, server, passed = 0;
const errors = [], check = (label, value, more = '') => { assert.ok(value, `${label} ${more}`); passed++; console.log(`ok ${label}`); };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding:'utf8', stdio:['ignore', 'pipe', 'pipe'] }).trim();
const code = path.join(temp, 'code');
fs.mkdirSync(code);
git(code, 'init', '-q', '-b', 'main'); git(code, 'config', 'user.name', 'Test'); git(code, 'config', 'user.email', 'test@example.com');
fs.writeFileSync(path.join(code, 'README.md'), 'hello\n'); git(code, 'add', '-A'); git(code, 'commit', '-q', '-m', 'first');
const onBranch = (branch, from) => { git(code, 'checkout', '-q', '-b', branch, from); fs.writeFileSync(path.join(code, `${branch.replace(/\W/g, '-')}.txt`), branch); git(code, 'add', '-A'); git(code, 'commit', '-q', '-m', branch); };
onBranch('work/big', 'main'); onBranch('work/sub', 'work/big'); onBranch('work/other', 'main'); git(code, 'checkout', '-q', 'main');
const agents = { available:() => [{ id:'claude', name:'Claude', mono:'Cl', color:'#c2572f', available:true, app:'Claude', role:'Build' }], command:() => null, desktop:() => null, nameOf:id => id, terminal:() => '' };
const api = createProjectLines({ directory:path.join(temp, 'state'), agents, serviceOptions:{ autoWatch:false }, isThisComputer:() => true, authorizeRead:() => null, authorizeWrite:() => null, readJson:async req => { let s = ''; for await (const b of req) s += b; return JSON.parse(s); }, send:(res, status, data) => { res.writeHead(status, { 'content-type':'application/json' }); res.end(JSON.stringify(data)); } });
const s = api.service;
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.webp':'image/webp' };
const finished = (title, created, branch) => F.initialLine({ title, id:title.replace(/\W/g, ''), status:'ready', created, source:'Claude desktop', branch, base:'main', steps:[F.askStep({ words:title, via:'Claude desktop', when:created }), { ...F.workStep({ who:'claude' }), done:true, took:'1 min' }] });

(async () => {
  const p = s.store.create({ name:'Branches', docsPath:path.join(temp, 'docs'), codePath:code });
  p.follow = false; p.offerSkill = false; p.defaultAgent = 'claude'; s.store.save();
  for (const [slug, title, created, branch] of [['on-main', 'On main', '2026-11-01 09:00', ''], ['big-1', 'Big one', '2026-11-02 09:00', 'work/big'], ['big-2', 'Big two', '2026-11-02 10:00', 'work/big'], ['sub-1', 'Sub one', '2026-11-03 09:00', 'work/sub'], ['other-1', 'Other one', '2026-11-04 09:00', 'work/other']]) s.writeDoc(p, slug, finished(title, created, branch));
  s.sync(p);

  server = http.createServer(async (req, res) => { const url = new URL(req.url, 'http://localhost'); if (await api.handle(req, res, url)) return; const file = path.resolve(root, 'public', `.${url.pathname}`); if (!file.startsWith(path.join(root, 'public') + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type':mime[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  browser = await chromium.launch({ channel:'chrome' });
  const page = await (await browser.newContext({ viewport:{ width:1440, height:900 }, reducedMotion:'reduce' })).newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/projects.html#${p.id}`);
  await page.waitForFunction(id => window.__lines?.project()?.id === id && document.querySelector('.hl-bhead'), p.id);
  await page.waitForTimeout(250);
  const rows = () => page.locator('.hl-row').evaluateAll(rs => rs.map(r => r.dataset.row).sort().join());
  const ids = async () => (await rows()).split(',').map(x => x.replace(/.*?(on-main|big-1|big-2|sub-1|other-1)$/, '$1')).sort().join();

  const head = b => page.locator(`.hl-branch[data-branch="${b}"] > .hl-bhead`).first();
  const big = head('work/big'), btn = big.locator('[data-act="archive-branch-ask"]');
  check('every branch head off the trunk has Archive all', await page.locator('.hl-bhead [data-act="archive-branch-ask"]').count() >= 3, String(await page.locator('.hl-bhead [data-act="archive-branch-ask"]').count()));
  check('no line menu offers it any more', !/Archive all on/.test(fs.readFileSync(path.join(root, 'public/lines/line.js'), 'utf8')));
  check('work/sub hangs off work/big', await page.evaluate(() => window.__lines.project().branches?.['work/sub']?.parent === 'work/big'));
  await page.mouse.move(5, 5); await page.waitForTimeout(250);
  check('hidden until the head is hovered', await btn.evaluate(e => getComputedStyle(e).opacity) === '0');
  await big.hover(); await page.waitForTimeout(250);
  check('shown on hover', await btn.evaluate(e => getComputedStyle(e).opacity) === '1');
  const [b, nl] = [await btn.boundingBox(), await big.locator('[data-act="new-line-on"], [data-act="new-line-here"]').boundingBox()];
  check('right beside New line', b && nl && b.x > nl.x + nl.width && b.x - (nl.x + nl.width) < 16 && Math.abs(b.y - nl.y) < 3, JSON.stringify({ b, nl }));
  await page.screenshot({ path:path.join(shots, '1-hover.png') });

  await btn.click();
  const ask = big.locator('.bh-ask');
  await ask.waitFor();
  check('one click only asks, naming how many lines and the branch', /Archive 3 lines on work\/big\?/.test(await ask.innerText()) && await page.evaluate(() => window.__lines.project().landed.length) === 0, await ask.innerText());
  await page.mouse.move(5, 5); await page.waitForTimeout(250);
  check('the question stays visible off hover', await ask.locator('[data-act="archive-branch-no"]').evaluate(e => getComputedStyle(e).opacity) === '1');
  await page.screenshot({ path:path.join(shots, '1b-asks.png') });
  await ask.locator('[data-act="archive-branch-no"]').click();
  await page.waitForTimeout(150);
  check('Cancel archives nothing', await page.locator('.bh-ask').count() === 0 && await page.evaluate(() => window.__lines.project().landed.length) === 0);

  await big.hover(); await btn.click(); await ask.waitFor();
  await ask.locator('[data-act="archive-branch"]').click();
  const warn = page.locator('dialog.archive-warn');
  await warn.waitFor();
  const said = await warn.innerText();
  check('unmerged work still asks, naming each branch and where it merges to', /work\/big has 1 commit not in main/.test(said) && /work\/sub has 1 commit not in work\/big/.test(said), said);
  await warn.locator('button[type="submit"]').click();
  await page.waitForFunction(() => !document.querySelector('.hl-branch[data-branch="work/big"]'));
  await page.waitForTimeout(200);
  check('the branch and its sub-branch leave the map', await page.locator('.hl-branch[data-branch="work/big"], .hl-branch[data-branch="work/sub"]').count() === 0, await rows());
  check('the other lines stay', await ids() === 'on-main,other-1', await ids());
  check('the toast says so, with Undo', /Archived work\/big and its 3 lines/.test(await page.locator('.toast, #toast').first().innerText()));
  await page.screenshot({ path:path.join(shots, '2-archived.png') });

  await page.locator('.toast button, #toast button').filter({ hasText:'Undo' }).first().click();
  await page.waitForFunction(() => document.querySelector('.hl-branch[data-branch="work/sub"]'));
  await page.waitForTimeout(200);
  check('Undo brings them all back', await ids() === 'big-1,big-2,on-main,other-1,sub-1', await ids());

  check('no page errors', errors.length === 0, errors.join('\n'));
  console.log(`\n${passed} checks passed. Screenshots in ${shots}`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); server?.close(); fs.rmSync(temp, { recursive:true, force:true, maxRetries:3 }); });
