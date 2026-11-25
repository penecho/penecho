'use strict';
// Composer output colors and the + menu Canvas handoff (PE-577).
// Canonical public/ and isolated project data; no agents or Cloud connections.
// PLAYWRIGHT_PATH=/path/to/playwright node scripts/verify-composer-types.cjs [screenshot-folder]
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { createProjectLines } = require('../src/server/project-lines/http.js');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'composer-types-'));
const shots = path.resolve(process.argv[2] || path.join(temp, 'shots')); fs.mkdirSync(shots, { recursive:true });
const send = (res, status, data) => { res.writeHead(status, { 'content-type':'application/json' }); res.end(JSON.stringify(data)); };
const agents = { available:() => ['codex', 'claude'].map(id => ({ id, name:id, available:true, runnable:true })), nameOf:id => id, desktop:() => null, terminal:() => '' };
const api = createProjectLines({ directory:path.join(temp, 'state'), agents,
  serviceOptions:{ autoWatch:false, memory:{ home:path.join(temp, 'home'), env:{} } },
  isThisComputer:() => true, authorizeRead:() => null, authorizeWrite:() => null,
  readJson:async req => { let body = ''; for await (const chunk of req) body += chunk; return JSON.parse(body || '{}'); }, send });
const s = api.service, p = s.store.create({ name:'Composer types', docsPath:path.join(temp, 'docs') });
Object.assign(p, { follow:false, autoWake:false, offerSkill:false }); s.store.save();
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.webp':'image/webp' };
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
let browser, server, passed = 0;
const errors = [], check = (label, ok) => { assert.ok(ok, label); passed++; console.log(`ok ${label}`); };
(async () => {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (await api.handle(req, res, url)) return;
    const file = path.resolve(root, 'public', '.' + url.pathname);
    if (!file.startsWith(path.join(root, 'public') + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type':mime[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : { channel:'chrome' });
  const context = await browser.newContext({ viewport:{ width:1440, height:1000 }, reducedMotion:'reduce', hasTouch:true });
  const page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message)); 

  const box = '.dock-wrap .composer';
  await page.goto(`${base}/projects.html#${p.id}`);
  await page.locator(`${box} .cmp-plus`).waitFor();
  for (const mode of ['light', 'dark']) {
    await page.evaluate(mode => linesTheme.set(mode), mode);
    await page.waitForTimeout(200);
    for (const kind of ['diagram', 'explorer', 'slides', 'card']) {
      await page.locator(`${box} .cmp-chip[data-kind="${kind}"]`).click();
      const colors = await page.locator(box).evaluate(form => {
        const chip = form.querySelector('.cmp-chip.on'), sub = form.querySelector('.cmp-kind.on');
        const probe = document.createElement('span'); probe.style.color = 'var(--accent-label)'; form.append(probe);
        const expected = getComputedStyle(probe).color; probe.remove();
        return { chip:getComputedStyle(chip).color, sub:getComputedStyle(sub).color, expected };
      });
      check(`${mode}: ${kind} and its subtype use the blue label token`, colors.chip === colors.expected && colors.sub === colors.expected);
    }
    await page.locator(box).screenshot({ path:path.join(shots, `choices-${mode}.png`) });
    await page.locator(`${box} .cmp-chip.on`).click();
  }
  await page.evaluate(() => linesTheme.set('light'));
  await page.locator(`${box} .cmp-chip[data-kind="card"]`).click();
  await page.locator(`${box} .cmp-input`).fill('Make it according to this canvas');
  await page.locator(`${box} .send-btn`).click();
  await page.locator('.lp-make-tag').waitFor();
  await page.waitForFunction(() => !S.route.line.startsWith('saving-') && !SAVING.length);
  const lineURL = page.url();
  check('saved Ask keeps its Note card choice', (await page.locator('.lp-make-tag').innerText()).includes('Note card · Knowledge card'));
  for (const mode of ['light', 'dark']) {
    await page.evaluate(mode => linesTheme.set(mode), mode);
    await page.waitForTimeout(200);
    check(`${mode}: saved Ask choice uses blue`, await page.locator('.lp-make-tag').evaluate(n => {
      const probe = document.createElement('span'); probe.style.color = 'var(--accent-label)'; n.append(probe);
      const actual = getComputedStyle(n).color, expected = getComputedStyle(probe).color; probe.remove(); if (actual !== expected) console.error({actual, expected}); return actual === expected;
    }));
    await page.locator('.lp-ask').screenshot({ path:path.join(shots, `saved-choice-${mode}.png`) });
  }
  await page.evaluate(() => linesTheme.set('light'));
  // Inspect the real navigation and stored handoff without requiring Canvas's unrelated APIs in this isolated Lines harness.
  await page.route('**/?**', route => route.request().isNavigationRequest() && new URL(route.request().url()).pathname === '/' ? route.fulfill({ contentType:'text/html', body:'<title>Canvas handoff</title>' }) : route.continue());
  for (const [width, method, url] of [[1440, 'mouse', lineURL], [390, 'touch', lineURL], [320, 'keyboard', `${base}/projects.html#${p.id}`]]) {
    await page.goto(url); await page.setViewportSize({ width, height:900 });
    const form = page.locator('.composer'); await form.waitFor();
    await form.locator('.cmp-input').fill('Keep these draft words');
    const plus = form.locator('.cmp-plus');
    if (method === 'keyboard') { await plus.focus(); await page.keyboard.press('Enter'); }
    else if (method === 'touch') await plus.tap(); else await plus.click();
    const add = page.getByRole('menuitem', { name:'Add new canvas', exact:true });
    await add.waitFor();
    const menuText = await page.locator('#menu').innerText();
    check(`${width}px: + offers Canvas and files, with no meeting-notes entry`, menuText.includes('Add images or files') && !menuText.includes('Add meeting notes'));
    check(`${width}px: menu stays within viewport`, await page.locator('#menu').evaluate(n => { const r=n.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; }));
    await page.screenshot({ path:path.join(shots, `menu-${width}.png`) });
    if (method === 'keyboard') { await add.focus(); await page.keyboard.press('Enter'); }
    else if (method === 'touch') await add.tap(); else await add.click();
    await page.waitForURL(u => u.pathname === '/');
    const handoff = await page.evaluate(() => JSON.parse(sessionStorage.getItem('penecho-lines-drawing')));
    check(`${width}px: ${method} opens a fresh Canvas and preserves the draft`, new URL(page.url()).searchParams.get('linesCanvas') === handoff.source && handoff.project === p.id && handoff.box.text === 'Keep these draft words' && /files\/_incoming\/drawing-.*\.penecho\.json$/.test(handoff.source));
    await page.evaluate(() => sessionStorage.removeItem('penecho-lines-drawing'));
  }
  check('no browser runtime errors', !errors.length);
  console.log(`${passed} checks passed. Screenshots: ${shots}`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (server) { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
  s.close?.(); fs.rmSync(temp, { recursive:true, force:true });
});
