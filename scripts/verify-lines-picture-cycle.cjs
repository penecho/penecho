#!/usr/bin/env node
"use strict";
// Real-browser check (PE-456): a picture opened from a Work or an Ask with several pictures goes round them with the buttons and ← →, and says 2 / 3.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { createProjectLines } = require('../src/server/project-lines/http.js');
const F = require('../src/server/project-lines/format.js');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'line-picture-cycle-'));
const shots = path.resolve(process.argv[2] || path.join(temp, 'shots')); fs.mkdirSync(shots, { recursive:true });
let browser, server, passed = 0;
const errors = [];
const check = (label, value) => { assert.ok(value, label); passed++; console.log(`ok ${label}`); };
const agents = { available:() => [{ id:'claude', name:'Claude', mono:'Cl', color:'#334155', available:false }], nameOf:() => 'Claude', desktop:() => null, terminal:() => '' };
const api = createProjectLines({ directory:path.join(temp, 'state'), agents, serviceOptions:{ autoWatch:false, memory:{ home:path.join(temp, 'home'), env:{} } }, isThisComputer:() => true, authorizeRead:() => null, authorizeWrite:() => null, readJson:async req => { let s = ''; for await (const b of req) s += b; return JSON.parse(s || '{}'); }, send:(res, status, data) => { res.writeHead(status, { 'content-type':'application/json' }); res.end(JSON.stringify(data)); } });
const s = api.service, p = s.store.create({ name:'Pictures', docsPath:path.join(temp, 'Project docs') }); p.follow = false; p.offerSkill = false; s.store.save();
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml' };
const pics = ['one', 'two', 'three'].map(n => `files/pic-${n}.png`);

(async () => {
  const sharp = require('sharp'), colors = ['#dbeafe', '#dcfce7', '#fee2e2', '#fef9c3'];
  for (const [i, file] of [...pics, 'files/alone.png'].entries()) s.store.writeBytes(p, file, await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="${colors[i]}"/><text x="600" y="420" font-size="160" text-anchor="middle">${i + 1}</text></svg>`)).png().toBuffer());
  s.writeDoc(p, 'pics', F.initialLine({ title:'Many pictures', status:'done', created:'2026-11-15 10:00', steps:[
    F.askStep({ words:'Look at these', when:'2026-11-15 10:00', refs:pics.map((f, i) => `![Picture ${i + 1}](../${f})`) }),
    F.askStep({ words:'And this one', when:'2026-11-15 10:05', refs:['![Alone](../files/alone.png)'] }),
  ] }));
  s.sync(p);
  server = http.createServer(async (req, res) => { const url = new URL(req.url, 'http://localhost'); if (await api.handle(req, res, url)) return; const file = path.resolve(root, 'public', '.' + url.pathname); if (!file.startsWith(path.join(root, 'public') + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type':mime[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res); });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel:'chrome' }); const page = await (await browser.newContext({ viewport:{ width:1440, height:900 }, reducedMotion:'reduce' })).newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/projects.html#${p.id}`); await page.waitForFunction(() => window.__lines?.project()?.lines.length === 1);
  await page.evaluate(() => window.__lines.go({ view:'line', line:'pics' })); await page.waitForSelector('#linePage');
  const name = () => page.locator('#lightbox .lb-image-card header strong').innerText(), count = () => page.locator('#lightbox .lb-count').innerText();
  await page.locator(`[data-act="preview-asset"][data-path="${pics[1]}"]`).click();
  await page.waitForFunction(() => document.querySelector('#lightbox .lb-image-viewport img')?.naturalWidth > 0);
  check('the second of three pictures opens as 2 / 3', await name() === 'pic-two.png' && await count() === '2 / 3');
  check('previous and next buttons are on the picture', await page.locator('#lightbox .fv-nav.prev').isVisible() && await page.locator('#lightbox .fv-nav.next').isVisible());
  await page.screenshot({ path:path.join(shots, 'picture-2-of-3.png') });
  await page.locator('#lightbox .fv-nav.next').click();
  check('Next goes to the third', await name() === 'pic-three.png' && await count() === '3 / 3');
  await page.locator('#lightbox .fv-nav.next').click();
  check('Next after the last goes round to the first', await name() === 'pic-one.png' && await count() === '1 / 3');
  await page.keyboard.press('ArrowLeft');
  check('← from the first goes round to the last', await name() === 'pic-three.png' && await count() === '3 / 3');
  await page.locator('#lightbox .lb-image-viewport').focus(); await page.keyboard.press('ArrowRight');
  check('→ goes on even with the picture focused', await name() === 'pic-one.png' && await count() === '1 / 3');
  await page.keyboard.press('ArrowRight');
  check('→ again goes to the second', await name() === 'pic-two.png' && await count() === '2 / 3');
  await page.keyboard.press('Escape');
  check('Escape closes it', await page.locator('#lightbox').isHidden());
  await page.locator('[data-act="preview-asset"][data-path="files/alone.png"]').click();
  await page.waitForFunction(() => document.querySelector('#lightbox .lb-image-viewport img')?.naturalWidth > 0);
  check('a picture alone has no count and no buttons', await page.locator('#lightbox .lb-count').count() === 0 && await page.locator('#lightbox .fv-nav').count() === 0);
  const alone = page.locator('#lightbox .lb-image-viewport img');
  await page.locator('#lightbox .lb-image-viewport').focus(); await page.keyboard.press('+'); await page.keyboard.press('+');
  const before = await alone.boundingBox(); await page.keyboard.press('ArrowRight');
  check('there ← → still move an enlarged picture', Math.abs((await alone.boundingBox()).x - before.x + 40) < 1);
  await page.keyboard.press('Escape');
  await page.goto(`${base}/projects.html#${p.id}/files`); await page.waitForSelector('.fl-page #flBody .fl-card');
  await page.locator('.fl-page #flBody .fl-card').first().click(); await page.waitForSelector('#lightbox .fv');
  const fvCount = () => page.locator('#lightbox .fv-count').innerText(), first = await fvCount();
  check('Canvases & files viewer says which picture it is', /^1 \/ 4$/.test(first));
  await page.keyboard.press('ArrowLeft');
  check('and ← goes round to the last, 4 / 4', await fvCount() === '4 / 4');
  await page.screenshot({ path:path.join(shots, 'files-viewer-4-of-4.png') });
  check('no browser errors', !errors.length);
  console.log(`${passed} browser checks passed; screenshots: ${shots}`);
})().catch(e => { console.error(e.stack); process.exitCode = 1; }).finally(async () => { await browser?.close(); api.close(); if (server?.listening) await new Promise(r => server.close(r)); fs.rmSync(temp, { recursive:true, force:true }); });
