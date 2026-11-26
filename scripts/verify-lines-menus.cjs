'use strict';
// Isolated browser regression for anchored menus, including the hosted Run picker.
// Uses canonical public/ and isolated project data; never runs an agent or contacts Cloud.
// PLAYWRIGHT_PATH=/path/to/playwright node scripts/verify-lines-menus.cjs [screenshot-folder]
// MENU_MOTION=no-preference also checks the normal-motion layout (default: reduce).
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { createProjectLines } = require('../src/server/project-lines/http.js');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lines-menus-'));
const shots = path.resolve(process.argv[2] || path.join(temp, 'shots')); fs.mkdirSync(shots, { recursive:true });
const reducedMotion = process.env.MENU_MOTION || 'reduce';
const send = (res, status, data) => { res.writeHead(status, { 'content-type':'application/json' }); res.end(JSON.stringify(data)); };
const agents = { available:() => [], nameOf:id => id, desktop:() => null, terminal:() => '' };
const api = createProjectLines({ directory:path.join(temp, 'state'), agents,
  serviceOptions:{ autoWatch:false, memory:{ home:path.join(temp, 'home'), env:{} } },
  isThisComputer:() => true, authorizeRead:() => null, authorizeWrite:() => null,
  readJson:async req => { let body = ''; for await (const chunk of req) body += chunk; return JSON.parse(body || '{}'); }, send });
const s = api.service, p = s.store.create({ name:'Menu positioning', docsPath:path.join(temp, 'docs') });
Object.assign(p, { follow:false, autoWake:false, offerSkill:false }); s.store.save();
const computers = [{ id:'mac', name:'MacBook Air', open:true, agents:['claude', 'codex', 'opencode', 'pi', 'omp', 'dsh', 'kimi', 'antigravity', 'penecho'].map(id => ({ id, ready:true })) }];
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.webp':'image/webp' };
let browser, server, passed = 0;
const errors = [], check = (label, ok) => { assert.ok(ok, label); passed++; console.log(`ok ${label}`); };
(async () => {
  const line = await s.saveUnsent(p, { text:'Test the dropdown next to Run with Codex.', topic:'new' }); s.sync(p);
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/v1/computers') return send(res, 200, { computers });
    if (url.pathname === '/api/v1/line-projects') return send(res, 200, { projects:[{ key:p.id, cloudMade:false }] });
    if (url.pathname === '/api/v1/auth/session') return send(res, 200, { account:{ name:'Menu test' }, csrfToken:'fixture-csrf' });
    if (url.pathname === '/api/v1/credits/summary') return send(res, 200, { available:1000 });
    if (url.pathname === '/api/v1/models') return send(res, 200, { models:[] });
    if (url.pathname.startsWith(`/api/v1/line-projects/${p.id}/`)) url.pathname = url.pathname.replace('/api/v1/line-projects/', '/api/lines/projects/');
    if (await api.handle(req, res, url)) return;
    const file = path.resolve(root, 'public', '.' + url.pathname);
    if (!file.startsWith(path.join(root, 'public') + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type':mime[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : { channel:'chrome' });
  const context = await browser.newContext({ viewport:{ width:1440, height:950 }, reducedMotion }), page = await context.newPage();
  const viewport = async size => { await page.setViewportSize(size); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); };
  page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/projects.html?hosted=${p.id}#${p.id}/line/${line.slug}`);
  const picker = page.locator('#lpThread [data-act="unsent-run-pick"]'); await picker.waitFor();
  await page.waitForFunction(() => window.__lines && HOSTED.computers.length > 0);
  // A slow computer-list request overlaps a normal line repaint. The original button is detached.
  let release, requested;
  const held = new Promise(r => { release = r; }), started = new Promise(r => { requested = r; });
  await page.route('**/api/v1/computers', async route => { requested(); await held; await route.fulfill({ json:{ computers } }); });
  await page.evaluate(() => { HOSTED.computersAt = 0; window.oldPicker = document.querySelector('#lpThread [data-act="unsent-run-pick"]'); });
  await picker.click(); await started;
  await page.evaluate(() => { document.querySelector('#lpThread [id^="item-"]').dataset.h = ''; refreshLine(); });
  check('the real line refresh replaced the clicked button', await page.evaluate(() => !window.oldPicker.isConnected));
  release(); await page.locator('#menu.run-menu').waitFor();
  const geometry = await page.evaluate(() => {
    const rect = el => { const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; };
    return { old:rect(window.oldPicker), button:rect(document.querySelector('#lpThread [data-act="unsent-run-pick"]')), menu:rect(document.querySelector('#menu')) };
  });
  console.log(JSON.stringify(geometry));
  await page.screenshot({ path:path.join(shots, 'hosted-run-after-refresh.png') });
  check('the delayed hosted picker opens beside the current button', geometry.menu.x <= geometry.button.x + geometry.button.width && geometry.menu.x + geometry.menu.width >= geometry.button.x && Math.min(Math.abs(geometry.menu.y - geometry.button.y - geometry.button.height), Math.abs(geometry.button.y - geometry.menu.y - geometry.menu.height)) <= 8);
  await page.unroute('**/api/v1/computers');
  const absent = () => page.waitForFunction(() => !document.querySelector('#menu'));
  const back = async () => {
    await page.evaluate(slug => go({ view:'line', line:slug }), line.slug);
    await picker.waitFor();
  };
  const pendingPicker = async () => {
    let done, arrived;
    const response = new Promise(r => { done = r; }), request = new Promise(r => { arrived = r; });
    await page.route('**/api/v1/computers', async route => { arrived(); await response; await route.fulfill({ json:{ computers } }); });
    await page.evaluate(() => { closeMenu(); HOSTED.computersAt = 0; });
    // Keep the action's Promise so each check waits for the late response to be processed.
    await page.evaluate(() => { window.pendingPicker = hostedRunPick(document.querySelector('#lpThread [data-act="unsent-run-pick"]')); });
    await request;
    return async () => { done(); await page.evaluate(() => window.pendingPicker); await page.unroute('**/api/v1/computers'); };
  };
  // The menu's keyboard action still runs exactly the picked agent on the original Ask.
  await page.evaluate(() => {
    window.menuRuns = []; window.realRunUnsent = runUnsent;
    runUnsent = (p, l, step, agent) => window.menuRuns.push({ project:p.id, line:l.id, step, agent });
  });
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await absent();
  check('keyboard selection runs the intended agent and Ask exactly once', await page.evaluate(({ projectId, slug, step }) => window.menuRuns.length === 1 && window.menuRuns[0].project === projectId && window.menuRuns[0].line === slug && window.menuRuns[0].step === step && window.menuRuns[0].agent === 'codex', { projectId:p.id, slug:line.slug, step:line.step }));
  check('selection returns focus to the live picker', await picker.evaluate(n => n === document.activeElement));
  await picker.click(); await page.locator('#menu').waitFor(); await page.keyboard.press('Escape'); await absent();
  check('Escape returns focus to the live picker', await picker.evaluate(n => n === document.activeElement));

  for (const kind of ['outside click', 'Escape', 'navigation', 'navigation away and back', 'other menu', 'repeated activation', 'removed button', 'ambiguous replacement']) {
    const finish = await pendingPicker();
    if (kind === 'outside click') await page.locator('#lpHead h1, #lpHead h2, #lpHead .lp-title').first().click();
    if (kind === 'Escape') await page.keyboard.press('Escape');
    if (kind === 'navigation') await page.evaluate(() => go({ view:'home' }));
    if (kind === 'navigation away and back') { await page.evaluate(() => go({ view:'home' })); await back(); }
    if (kind === 'other menu') await page.locator('.lp-dock [data-act="cmp-send-pick"]').click();
    if (kind === 'repeated activation') await picker.click();
    if (kind === 'removed button') await picker.evaluate(n => n.remove());
    if (kind === 'ambiguous replacement') await picker.evaluate(n => n.parentNode.append(n.cloneNode(true)));
    await finish();
    check(`a late response cannot reopen the Run menu after ${kind}`, await page.locator('#menu.run-menu').count() === 0);
    if (kind === 'other menu') check('a late Run response leaves the newer menu alone', await page.locator('#menu').count() === 1 && (await page.locator('#menu').innerText()).includes('Save as note'));
    await back();
  }

  // Two requests complete in reverse order. Only the most recent intent may open a menu.
  const releases = [], arrivals = [];
  await page.route('**/api/v1/computers', async route => {
    const i = releases.length;
    await new Promise(resolve => { releases.push(resolve); arrivals[i]?.(); });
    await route.fulfill({ json:{ computers:[{ ...computers[0], name:i === 0 ? 'Old response' : 'New response' }] } });
  });
  const request = async index => {
    const arrived = new Promise(resolve => { arrivals[index] = resolve; });
    await page.evaluate(index => { closeMenu(); HOSTED.computersAt = 0; (window.menuRequests ||= [])[index] = hostedRunPick(document.querySelector('#lpThread [data-act="unsent-run-pick"]')); }, index);
    await arrived;
  };
  await request(0); await request(1);
  releases[1](); await page.evaluate(() => window.menuRequests[1]);
  check('the newer request opens first when its response arrives first', (await page.locator('#menu').innerText()).includes('New response'));
  releases[0](); await page.evaluate(() => window.menuRequests[0]);
  check('an older response cannot replace the newer menu', (await page.locator('#menu').innerText()).includes('New response'));
  await page.unroute('**/api/v1/computers');
  await page.evaluate(computers => { closeMenu(); HOSTED.computers = computers; HOSTED.computersAt = Date.now(); }, computers);

  // A real image response arrives after the Run menu is open. No DOM mutation
  // accompanies intrinsic sizing; keep the same menu, focus and selected action.
  let releaseImage;
  const imageHeld = new Promise(resolve => { releaseImage = resolve; });
  await page.route('**/delayed-menu-image.svg', async route => {
    await imageHeld;
    await route.fulfill({ contentType:'image/svg+xml', body:'<svg xmlns="http://www.w3.org/2000/svg" width="280" height="120"><rect width="280" height="120" fill="orange"/></svg>' });
  });
  await page.evaluate(() => {
    const img = document.createElement('img'); img.id = 'lateMenuImage'; img.style.display = 'block';
    img.src = '/delayed-menu-image.svg';
    document.querySelector('#lpThread [id^="item-"]').prepend(img);
  });
  await picker.click(); await page.locator('#menu').waitFor();
  await page.evaluate(() => {
    window.imageMenu = document.querySelector('#menu'); window.imageFocus = document.activeElement;
    window.imageAnchorTop = menuAnchor.getBoundingClientRect().top;
  });
  releaseImage();
  await page.waitForFunction(() => document.querySelector('#lateMenuImage').naturalHeight === 120);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  check('late image actually shifts the picker', await page.evaluate(() => Math.abs(document.querySelector('#lpThread [data-act="unsent-run-pick"]').getBoundingClientRect().top - window.imageAnchorTop) > 50));
  check('late image retains the same menu and keyboard focus', await page.evaluate(() => window.imageMenu.isConnected && document.activeElement === window.imageFocus));
  check('late image keeps menu beside its picker', await page.evaluate(() => {
    const m = imageMenu.getBoundingClientRect(), a = menuAnchor.getBoundingClientRect();
    return Math.min(Math.abs(m.top - a.bottom), Math.abs(a.top - m.bottom)) <= 8;
  }));
  await page.screenshot({ path:path.join(shots, 'late-image-open-menu.png') });
  await page.keyboard.press('Enter'); await absent();
  check('selection after image load runs exactly once', await page.evaluate(() => window.menuRuns.length === 2));
  await page.evaluate(() => document.querySelector('#lateMenuImage').remove());

  await picker.click(); await page.locator('#menu').waitFor();
  await page.evaluate(() => { document.querySelector('#lpThread [id^="item-"]').dataset.h = ''; refreshLine(); });
  await absent();
  check('an already-open menu closes when its button is replaced', true);
  await picker.click(); await page.locator('#menu').waitFor();
  const movement = await page.evaluate(() => {
    const card = document.querySelector('#lpThread [id^="item-"]'), anchor = document.querySelector('#lpThread [data-act="unsent-run-pick"]');
    const before = anchor.getBoundingClientRect().left; card.style.left = '30px';
    return anchor.getBoundingClientRect().left - before;
  });
  check('the movement fixture actually moves the button', movement > 25);
  await page.waitForFunction(() => { const a = menuAnchor.getBoundingClientRect(), m = document.querySelector('#menu')?.getBoundingClientRect(); return m && Math.abs(m.left - a.left) < 1; });
  check('a layout change keeps the menu attached', await page.locator('#menu').count() === 1);
  await page.keyboard.press('Escape');
  await page.evaluate(() => { document.querySelector('#lpThread [id^="item-"]').style.left = ''; });
  await picker.click(); await page.locator('#menu').waitFor();
  await page.evaluate(() => {
    document.querySelector('#lpThread').style.minHeight = '2200px';
    document.querySelector('#lpScroll').scrollTop = 100;
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  check('scrolling keeps the menu attached to a visible picker', await page.evaluate(() => { const m = document.querySelector('#menu')?.getBoundingClientRect(), a = menuAnchor?.getBoundingClientRect(); return m && a && Math.min(Math.abs(m.top - a.bottom), Math.abs(a.top - m.bottom)) <= 8; }));
  await page.evaluate(() => { document.querySelector('#lpScroll').scrollTop = 900; });
  await absent(); check('scrolling the picker out of view dismisses its menu', true);
  await page.evaluate(() => { document.querySelector('#lpScroll').scrollTop = 0; });
  await picker.click(); await page.locator('#menu').waitFor();
  await viewport({ width:1200, height:800 }); await absent();
  check('resizing dismisses an open menu', true);
  await picker.click(); await page.locator('#menu').waitFor();
  await page.screenshot({ path:path.join(shots, 'hosted-run-desktop.png') });
  await page.keyboard.press('Escape');
  await page.evaluate(() => { document.documentElement.dataset.mode = 'dark'; });
  await picker.click(); await page.locator('#menu').waitFor();
  await page.screenshot({ path:path.join(shots, 'hosted-run-dark.png') });

  await viewport({ width:390, height:620 }); await absent();
  await picker.click(); await page.locator('#menu').waitFor();
  check('the narrow Run menu stays within the viewport', await page.locator('#menu').evaluate(n => { const r = n.getBoundingClientRect(); return r.left >= 8 && r.top >= 8 && r.right <= innerWidth - 8 && r.bottom <= innerHeight - 8; }));
  await page.screenshot({ path:path.join(shots, 'hosted-run-narrow.png') });

  // Tall menus keep every choice reachable by keyboard and internal scrolling.
  await viewport({ width:390, height:420 }); await absent();
  await page.evaluate(() => openMenu(document.querySelector('#lpThread [data-act="unsent-run-pick"]'), Array.from({ length:24 }, (_, i) => ({ label:`Choice ${i + 1}`, fn:() => {} })), { className:'run-menu' }));
  check('a tall menu fits the short viewport and can scroll', await page.locator('#menu').evaluate(n => { const r = n.getBoundingClientRect(); return r.top >= 8 && r.bottom <= innerHeight - 8 && n.scrollHeight > n.clientHeight; }));
  await page.keyboard.press('ArrowUp');
  check('keyboard reaches the last choice without closing the scrolling menu', await page.locator('#menu button').last().evaluate(n => { const r = n.getBoundingClientRect(), m = n.closest('#menu').getBoundingClientRect(); return document.activeElement === n && r.top >= m.top && r.bottom <= m.bottom; }));
  await page.screenshot({ path:path.join(shots, 'tall-menu-keyboard.png') });
  await page.keyboard.press('Escape');

  // Other async menu callers must not create a menu from a detached or hidden node.
  for (const kind of ['detached', 'hidden', 'offscreen']) {
    await page.evaluate(kind => {
      const anchor = document.createElement('button'); document.body.append(anchor);
      if (kind === 'detached') anchor.remove();
      if (kind === 'hidden') anchor.hidden = true;
      if (kind === 'offscreen') { anchor.textContent = 'Offscreen'; anchor.style.cssText = 'position:fixed;left:-1000px;top:20px'; }
      openMenu(anchor, [{ label:'No floating menu', fn:() => {} }]); anchor.remove();
    }, kind);
    check(`the shared helper rejects a ${kind} anchor`, await page.locator('#menu').count() === 0);
  }

  // A credits note is added after opening. Its final height, including wrapping, is used for placement.
  await viewport({ width:390, height:620 });
  await page.evaluate(() => {
    HOSTED.onComputer = false; S.agents = [hostedAgent('penecho')];
    S.cloudAccount = { signedIn:true, credits:{ available:1000 } };
  });
  await picker.click(); await page.locator('#menu.run-menu').waitFor();
  await page.screenshot({ path:path.join(shots, 'hosted-credits.png') });
  check('the Cloud credits note is visible and the final menu fits', (await page.locator('#menu').innerText()).includes('1,000 credits') && await page.locator('#menu').evaluate(n => { const r = n.getBoundingClientRect(); return r.left >= 8 && r.right <= innerWidth - 8 && r.top >= 8 && r.bottom <= innerHeight - 8; }));
  check('the credits note keeps the menu beside the current button', await page.evaluate(() => { const m = document.querySelector('#menu').getBoundingClientRect(), a = document.querySelector('#lpThread [data-act="unsent-run-pick"]').getBoundingClientRect(); return m.left <= a.right && m.right >= a.left && Math.min(Math.abs(m.top - a.bottom), Math.abs(a.top - m.bottom)) <= 8; }));

  const local = await context.newPage(); local.on('pageerror', e => errors.push(e.message));
  await local.setViewportSize({ width:1440, height:950 });
  await local.goto(`${base}/projects.html#${p.id}/line/${line.slug}`);
  await local.waitForFunction(() => window.__lines?.project());
  const injectRunners = target => target.evaluate(() => {
    S.agents = ['codex', 'claude', 'penecho'].map(id => hostedAgent(id)); S.presets = null; applyRoles(project());
    S.cloudAccount = { signedIn:true, credits:{ available:1000 } }; refreshLine();
  });
  await injectRunners(local);
  const localPicker = local.locator('#lpThread [data-act="unsent-run-pick"]');
  await localPicker.click(); await local.locator('#menu.run-menu').waitFor();
  check('the local Run menu retains its agents and credits note', (await local.locator('#menu').innerText()).includes('Claude Code') && (await local.locator('#menu').innerText()).includes('1,000 credits'));
  await local.screenshot({ path:path.join(shots, 'local-run-desktop.png') });
  await local.keyboard.press('Escape');
  await local.locator('.lp-dock [data-act="cmp-send-pick"]').click(); await local.locator('#menu').waitFor();
  check('the shared composer menu keeps right alignment', await local.evaluate(() => { const m = document.querySelector('#menu').getBoundingClientRect(), a = document.querySelector('.lp-dock [data-act="cmp-send-pick"]').getBoundingClientRect(); return Math.abs(m.right - a.right) <= 1; }));
  await local.keyboard.press('Escape');
  const touch = await browser.newContext({ viewport:{ width:390, height:760 }, hasTouch:true, isMobile:true, reducedMotion }), phone = await touch.newPage();
  phone.on('pageerror', e => errors.push(e.message));
  await phone.goto(`${base}/projects.html#${p.id}/line/${line.slug}`);
  await phone.waitForFunction(() => window.__lines?.project()); await injectRunners(phone);
  await phone.locator('#lpThread [data-act="unsent-run-pick"]').tap(); await phone.locator('#menu.run-menu').waitFor();
  check('touch opens the local Run menu beside its button', await phone.evaluate(() => { const m = document.querySelector('#menu').getBoundingClientRect(), a = document.querySelector('#lpThread [data-act="unsent-run-pick"]').getBoundingClientRect(); return m.left <= a.right && m.right >= a.left && Math.min(Math.abs(m.top - a.bottom), Math.abs(a.top - m.bottom)) <= 8; }));
  await phone.screenshot({ path:path.join(shots, 'local-run-touch.png') });
  await phone.locator('#lpHead .lp-title, #lpHead h1, #lpHead h2').first().tap();
  check('touch outside dismisses the menu', await phone.locator('#menu').count() === 0);
  await touch.close();
  check('no browser errors', errors.length === 0);
  console.log(`${passed} checks passed. Screenshots: ${shots}`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close(); server?.close(); s.close(); fs.rmSync(temp, { recursive:true, force:true, maxRetries:3 });
});
