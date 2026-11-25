#!/usr/bin/env node
'use strict';
// PE-458 / PE-566: exercise real mouse, keyboard and touch input against isolated project data.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { createProjectLines } = require('../src/server/project-lines/http.js'), F = require('../src/server/project-lines/format.js');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'project-order-'));
const shots = path.resolve(process.argv[2] || path.join(temp, 'shots')); fs.mkdirSync(shots, { recursive:true });
const errors = [], key = 'penecho-project-order-v1'; let browser, server, passed = 0;
const check = (label, value) => { assert.ok(value, label); passed++; console.log(`ok ${label}`); };
const agents = { available:() => [], nameOf:() => 'Unavailable', desktop:() => null, terminal:() => '' };
const api = createProjectLines({ directory:path.join(temp, 'state'), agents, serviceOptions:{ autoWatch:false, docsBase:path.join(temp, 'docs'), memory:{ home:path.join(temp, 'home'), env:{} } }, isThisComputer:() => true, authorizeRead:() => null, authorizeWrite:() => null,
  readJson:async req => { let text = ''; for await (const b of req) text += b; return JSON.parse(text || '{}'); }, send:(res, status, data) => { res.writeHead(status, { 'content-type':'application/json' }); res.end(JSON.stringify(data)); } });
const store = api.service.store, projects = [];
for (const [i, name] of ['Knowledge','Math Study','Meetcue','PenEcho','test','test1','penecho_cloud','3dModel','Mobile Communications','Linear algebra','Older project','Another project','Last project'].entries()) {
  const p = store.create({ name, docsPath:path.join(temp, name) }); Object.assign(p, { pinned:i < 4, lastOpenedAt:Date.now() - i * 10000, autoWake:false, follow:false, offerSkill:false }); projects.push(p);
  api.service.writeDoc(p, 'first', F.initialLine({ title:`${name}: project notes`, status:'notes', created:'2026-11-15 10:00', steps:[] }));
}
store.projects = [...projects, ...store.projects.filter(p => !projects.includes(p))]; store.save();
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml' };
const unit = (page, i) => page.locator(`#railList .rail-project[data-project="${projects[i].id}"]`);
const row = (page, i) => unit(page, i).locator('.rail-row');
const name = (page, i) => row(page, i).locator('.rail-name');
const order = (page, group) => page.locator(`#railList .rail-project[data-project-group="${group}"]`).evaluateAll(els => els.map(el => el.dataset.project));
const preference = page => page.evaluate(key => localStorage.getItem(key), key);
async function drag(page, from, to, { after = false, cancel = '', outside = false } = {}) {
  await name(page, from).scrollIntoViewIfNeeded(); const a = await name(page, from).boundingBox();
  await unit(page, to).scrollIntoViewIfNeeded(); const b = await unit(page, to).boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
  await page.mouse.move(outside ? 500 : a.x + a.width / 2, b.y + (after ? b.height - 3 : 3), { steps:10 });
  if (cancel === 'Escape') await page.keyboard.press('Escape');
  if (cancel === 'pointercancel') await page.evaluate(() => document.dispatchEvent(new PointerEvent('pointercancel', { pointerId:railProjectGesture.pointer, bubbles:true })));
  await page.mouse.up();
}
(async () => {
  server = http.createServer(async (req, res) => { const url = new URL(req.url, 'http://localhost'); if (await api.handle(req, res, url)) return; const file = path.resolve(root, 'public', '.' + url.pathname); if (!file.startsWith(path.join(root, 'public') + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type':mime[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : { headless:true });
  const context = await browser.newContext({ viewport:{ width:1440, height:1000 }, reducedMotion:'reduce' });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/projects.html#${projects[3].id}`); await page.waitForSelector('#railList .rail-row[data-p]');
  await page.evaluate(() => { for (const p of S.projects) railChoice[p.id] = p.name === 'PenEcho'; renderRail(); });
  check('no separate drag icon is shown in the sidebar', await page.locator('#railList .rail-grip').count() === 0);
  check('the default list keeps four pins and every other project', (await order(page, 'pinned')).join() === projects.slice(0,4).map(p => p.id).join() && (await order(page, 'recent')).length === projects.length - 4);
  const original = await order(page, 'recent');
  await row(page, 12).click(); await page.waitForFunction(id => S.cur === id, projects[12].id);
  await page.evaluate(async () => { await loadProjects(); renderRail(); });
  check('opening the last project does not move it or replace another row before any drag', (await order(page, 'recent')).join() === original.join());
  await page.reload(); await page.waitForSelector('#railList .rail-row[data-p]');
  check('default order survives reload after opening an older project', (await order(page, 'recent')).join() === original.join());
  await row(page, 3).click(); await page.waitForFunction(id => S.cur === id, projects[3].id);
  await page.evaluate(() => { for (const p of S.projects) railChoice[p.id] = p.name === 'PenEcho'; renderRail(); });
  const selected = await page.evaluate(() => S.cur);
  await drag(page, 3, 0);
  let pins = [projects[3].id, ...projects.slice(0,3).map(p => p.id)];
  check('mouse drag on the project name moves the last pinned project to the top', (await order(page, 'pinned')).join() === pins.join());
  check('expanded lines travel with their parent and selection stays', await unit(page, 3).locator('.rail-lines').isVisible() && await page.evaluate(() => S.cur) === selected);
  await page.screenshot({ path:path.join(shots, 'projects-reordered.png') });
  await drag(page, 9, 4); const recent = [projects[9].id, ...projects.slice(4).filter(p => p !== projects[9]).map(p => p.id)];
  check('dragging an inactive project name reorders without opening it', (await order(page, 'recent')).join() === recent.join() && await page.evaluate(() => S.cur) === selected);
  await row(page, 6).click(); await page.waitForFunction(id => S.cur === id, projects[6].id);
  await page.evaluate(async () => { await loadProjects(); renderRail(); });
  check('opening a visible project and refreshing keep both orders', (await order(page, 'recent')).join() === recent.join() && (await order(page, 'pinned')).join() === pins.join());
  await page.reload(); await page.waitForSelector('#railList .rail-row[data-p]');
  check('reload preserves both orders', (await order(page, 'recent')).join() === recent.join() && (await order(page, 'pinned')).join() === pins.join());
  await row(page, 3).focus(); await page.keyboard.press('Alt+Shift+ArrowDown'); pins = [projects[0].id,projects[3].id,projects[1].id,projects[2].id];
  check('keyboard moves one place, retains focus and announces position', (await order(page, 'pinned')).join() === pins.join() && await row(page,3).evaluate(el => el === document.activeElement) && /position 2 of 4/.test(await page.locator('#toast').innerText()));
  const second = await context.newPage(); await second.goto(`${base}/projects.html#${projects[0].id}`); await second.waitForSelector('#railList .rail-row[data-p]');
  await page.bringToFront(); await row(page, 3).focus(); await page.keyboard.press('Alt+Shift+ArrowUp'); pins = [projects[3].id,...projects.slice(0,3).map(p => p.id)];
  check('the source tab moves the project back to first', (await order(page, 'pinned')).join() === pins.join());
  await second.waitForFunction(ids => [...document.querySelectorAll('[data-project-group="pinned"]')].map(el => el.dataset.project).join() === ids.join(), pins);
  check('another tab sees the saved order', (await order(second, 'pinned')).join() === pins.join()); await second.close();
  const saved = await preference(page), locationBefore = page.url();
  await drag(page, 3, 2, { cancel:'Escape' }); check('Escape cancels without saving or navigating', await preference(page) === saved && page.url() === locationBefore);
  await drag(page, 3, 2, { cancel:'pointercancel' }); check('pointer cancellation never saves', await preference(page) === saved);
  await drag(page, 3, 4); check('cross-group drop does not move or unpin', await preference(page) === saved && (await order(page, 'pinned')).join() === pins.join());
  await drag(page, 3, 2, { outside:true }); check('outside drop never saves or navigates', await preference(page) === saved && page.url() === locationBefore);
  await drag(page, 3, 3); check('same-position drag never saves', await preference(page) === saved);
  const foldedBefore = await unit(page, 3).locator('.rail-fold').getAttribute('aria-expanded');
  await unit(page, 3).locator('.rail-fold').click(); check('fold remains independent', await unit(page, 3).locator('.rail-fold').getAttribute('aria-expanded') !== foldedBefore);
  await name(page, 0).click(); await page.waitForFunction(id => S.cur === id, projects[0].id); check('a normal click on the project name still opens it', await row(page,0).getAttribute('aria-current') === 'page');
  // Polls can refresh data, but must not replace a captured control or accept a stale membership snapshot.
  const a = await name(page, 3).boundingBox(); await page.mouse.move(a.x+10,a.y+10); await page.mouse.down(); await page.mouse.move(a.x+10,a.y+50);
  await page.evaluate(async () => { const before = railProjectGesture.control; await loadProjects(); renderRail(); if (railProjectGesture.control !== before || !before.isConnected) throw Error('poll replaced the drag source'); });
  await page.keyboard.press('Escape'); await page.mouse.up(); check('background refresh preserves the held element', await preference(page) === saved);

  const beforeFavourite = await order(page, 'recent');
  await unit(page, 6).hover(); await unit(page, 6).locator('.rail-pin').click();
  await page.waitForFunction(id => summaryOf(id).pinned, projects[6].id);
  check('favouriting moves only that project into the pinned group', (await order(page, 'pinned')).join() === [...pins, projects[6].id].join() && (await order(page, 'recent')).join() === beforeFavourite.filter(id => id !== projects[6].id).join());
  await unit(page, 6).hover(); await unit(page, 6).locator('.rail-pin').click();
  await page.waitForFunction(id => !summaryOf(id).pinned, projects[6].id);
  check('removing a favourite restores its saved position without reordering the others', (await order(page, 'pinned')).join() === pins.join() && (await order(page, 'recent')).join() === beforeFavourite.join());
  await page.evaluate(() => { document.documentElement.dataset.mode = 'dark'; });
  await page.screenshot({ path:path.join(shots, 'projects-dark.png') });

  // The compact rail keeps its existing dimensions. Real CDP touch events exercise browser scrolling arbitration.
  const mobile = await browser.newContext({ viewport:{ width:390, height:600 }, hasTouch:true, isMobile:true, deviceScaleFactor:1, reducedMotion:'reduce' });
  const phone = await mobile.newPage(); phone.on('pageerror', e => errors.push(e.message));
  await phone.goto(`${base}/projects.html#${projects[3].id}`); await phone.waitForSelector('#railList .rail-row');
  check('compact rail keeps its width and has no drag icon', (await phone.locator('#rail').boundingBox()).width === 52 && await phone.locator('#railList .rail-grip').count() === 0);
  await row(phone, 2).focus(); await phone.keyboard.press('Alt+Shift+ArrowUp');
  check('compact keyboard shortcut moves the focused project', (await order(phone,'pinned')).join() === [projects[0].id,projects[2].id,projects[1].id,projects[3].id].join() && await row(phone,2).evaluate(el => el === document.activeElement));
  const cdp = await mobile.newCDPSession(phone), touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints:type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x,y }] });
  let b = await row(phone, 2).boundingBox(), dest = await row(phone, 0).boundingBox();
  await touch('touchStart', b.x+b.width/2, b.y+b.height/2); await phone.waitForTimeout(400);
  check('holding the compact project starts a touch reorder', await phone.locator('.project-order-ghost').count() === 1);
  await touch('touchMove', dest.x+dest.width/2, dest.y+4); await touch('touchEnd');
  check('touch drag moves the project without opening it', (await order(phone,'pinned'))[0] === projects[2].id && await phone.evaluate(() => S.cur) === projects[3].id);
  const phoneSaved = await preference(phone);
  b = await row(phone, 0).boundingBox(); await touch('touchStart', b.x+20,b.y+20); await phone.waitForTimeout(400); await touch('touchCancel');
  check('touch cancellation does not change the order', await preference(phone) === phoneSaved && await phone.locator('.project-order-ghost').count() === 0);
  await phone.locator('#railList').evaluate(el => { el.scrollTop = 0; });
  const listBox = await phone.locator('#railList').boundingBox(), startY = listBox.y + listBox.height - 25;
  await touch('touchStart', 25,startY);
  for (let dy = 20; dy <= 120; dy += 20) { await touch('touchMove',25,startY-dy); await phone.waitForTimeout(20); }
  await touch('touchEnd'); await phone.waitForTimeout(300);
  check('swiping before the hold scrolls the rail without reordering', await phone.locator('#railList').evaluate(el => el.scrollTop) > 0 && await preference(phone) === phoneSaved);
  await phone.locator('#railList').evaluate(el => { el.scrollTop = 0; }); await row(phone, 0).tap(); await phone.waitForFunction(id => S.cur === id, projects[0].id);
  check('a short tap still opens the project', await row(phone,0).getAttribute('aria-current') === 'page');
  await phone.screenshot({ path:path.join(shots,'projects-compact.png') });
  await mobile.close(); check('no browser script errors', errors.length === 0);
  console.log(`${passed} browser checks passed; screenshots: ${shots}`);
})().catch(error => { console.error(error.stack); if (errors.length) console.error(errors); process.exitCode = 1; }).finally(async () => { await browser?.close(); api.close(); if (server?.listening) await new Promise(resolve => server.close(resolve)); fs.rmSync(temp, { recursive:true, force:true }); });
