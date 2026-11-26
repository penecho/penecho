'use strict';
// New-Line image space from the first paint through slow upload/save/image responses (PE-573).
// Canonical public/ and isolated project data; no agents or Cloud connections.
// PLAYWRIGHT_PATH=/path/to/playwright node scripts/verify-line-image-space.cjs [screenshot-folder]
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { createProjectLines } = require('../src/server/project-lines/http.js');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'line-image-space-'));
const shots = path.resolve(process.argv[2] || path.join(temp, 'shots')); fs.mkdirSync(shots, { recursive:true });
const send = (res, status, data) => { res.writeHead(status, { 'content-type':'application/json' }); res.end(JSON.stringify(data)); };
const agents = { available:() => ['codex', 'claude'].map(id => ({ id, name:id, available:true, runnable:true })), nameOf:id => id, desktop:() => null, terminal:() => '' };
const api = createProjectLines({ directory:path.join(temp, 'state'), agents,
  serviceOptions:{ autoWatch:false, memory:{ home:path.join(temp, 'home'), env:{} } },
  isThisComputer:() => true, authorizeRead:() => null, authorizeWrite:() => null,
  readJson:async req => { let body = ''; for await (const chunk of req) body += chunk; return JSON.parse(body || '{}'); }, send });
const s = api.service, p = s.store.create({ name:'Image space', docsPath:path.join(temp, 'docs') });
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
  const context = await browser.newContext({ viewport:{ width:1440, height:1000 }, reducedMotion:'reduce' });
  const page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message));
  const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const geometry = () => page.locator('#lpThread .lp-ask').last().evaluate(n => {
    const rect = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; };
    return { card:rect(n), words:rect(n.querySelector('.lp-words')), run:rect(n.querySelector('[data-act="unsent-run"]')), pics:[...n.querySelectorAll('.t-pic')].map(rect), previews:[...n.querySelectorAll('.pic-preview')].map(rect) };
  });
  const stable = (label, before, after) => {
    // Save acknowledgement can add the separate "Already completed elsewhere?" footer.
    // Measure the image slots, text and Run controls above it, which must never move.
    const diff = Math.max(...['words', 'run'].flatMap(k => ['x', 'y', 'width', 'height'].map(v => Math.abs(before[k][v] - after[k][v]))),
      ...before.pics.flatMap((r, i) => ['x', 'y', 'width', 'height'].map(v => Math.abs(r[v] - (after.pics[i]?.[v] ?? Infinity)))));
    console.log(JSON.stringify({ label, shift:diff }));
    check(label, diff <= 1 && before.pics.length === after.pics.length);
  };
  const image = i => ({ name:`${i ? 'portrait' : 'landscape'}.svg`, mimeType:'image/svg+xml', buffer:Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${i ? 120 : 400}" height="${i ? 400 : 120}"><rect width="100%" height="100%" fill="#93c5fd"/></svg>`) });
  for (const [label, width, count] of [['desktop', 1440, 1], ['phone', 390, 2]]) {
    await page.setViewportSize({ width, height:1000 });
    await page.goto(`${base}/projects.html#${p.id}/home`);
    await page.locator('.composer .cmp-input').waitFor();
    await page.waitForFunction(() => S.thisComputer && S.agents.length > 1);
    await page.locator('.composer .cmp-input').fill('Keep this Ask and its Run with buttons steady.');
    await page.locator('#filePick').setInputFiles([...Array.from({ length:count }, (_, i) => image(i)), { name:'notes.txt', mimeType:'text/plain', buffer:Buffer.from('Attached notes') }]);
    await page.locator('.cmp-file').nth(count - 1).waitFor();
    const upload = gate(), save = gate(), images = gate(), uploadStarted = gate(), saveStarted = gate();
    await page.route('**/upload?**', async route => { uploadStarted.release(); await upload.promise; await route.continue(); });
    await page.route('**/unsent', async route => { saveStarted.release(); await save.promise; await route.continue(); });
    await page.route('**/file?**', async route => { await images.promise; await route.continue(); });
    await page.locator('.composer [type="submit"]').click();
    await uploadStarted.promise;
    await page.locator('#lpThread .lp-ask [data-act="unsent-run"]').waitFor(); await frames();
    const first = await geometry();
    check(`${label}: all image slots exist while the upload is held`, first.pics.length === count);
    check(`${label}: each image reserves its complete 126px preview`, first.previews.every(r => r.height === 126));
    check(`${label}: mixed file attachments reserve their chip too`, await page.locator('#lpThread .ask-files .file-ref').count() === 1);
    check(`${label}: pending attachments cannot invoke file actions`, await page.locator('#lpThread .t-pic [data-act], #lpThread .ask-files [data-act]').count() === 0);
    await page.screenshot({ path:path.join(shots, `${label}-upload-pending.png`) });
    // A poll before the server has the Ask must keep its attachment slots too.
    await page.evaluate(async () => { await loadState(S.cur, { force:true }); refreshAfterChange(); }); await frames();
    stable(`${label}: polling during upload preserves the first layout`, first, await geometry());
    upload.release(); await saveStarted.promise; await frames();
    stable(`${label}: upload completion preserves the first layout`, first, await geometry());
    if (label === 'desktop') {
      await page.locator('#lpThread [data-act="unsent-run-pick"]').last().click();
      check('a chooser click before save is safely queued', await page.locator('#menu.run-menu').count() === 0);
    }
    save.release();
    await page.waitForFunction(() => !S.route.line.startsWith('saving-') && !SAVING.length);
    await page.waitForFunction(() => [...document.querySelectorAll('#lpThread .t-pic img')].every(n => !n.src.startsWith('blob:')));
    await frames();
    stable(`${label}: persisted state with images still held preserves layout`, first, await geometry());
    // The attachment declarations reserve space even if a file catalog response is incomplete.
    await page.evaluate(() => {
      window.imageSpaceFiles = project().files;
      const paths = new Set(lineById(project(), S.route.line).stations.filter(s => s.kind === 'ask').flatMap(s => s.files.filter(f => f.image).map(f => f.path)));
      project().files = project().files.filter(f => !paths.has(f.path)); refreshLine();
    }); await frames();
    stable(`${label}: missing file metadata does not collapse image slots`, first, await geometry());
    await page.evaluate(() => { project().files = imageSpaceFiles; refreshLine(); }); await frames();
    const picker = page.locator('#lpThread [data-act="unsent-run-pick"]').last();
    if (!await page.locator('#menu.run-menu').count()) await picker.click();
    await page.locator('#menu.run-menu').waitFor();
    await page.evaluate(() => { window.imageSpaceMenu = document.querySelector('#menu'); window.imageSpaceFocus = document.activeElement; });
    images.release();
    await page.waitForFunction(() => [...document.querySelectorAll('#lpThread .t-pic img')].every(n => n.complete && n.naturalWidth)); await frames();
    stable(`${label}: decoding saved images preserves layout`, first, await geometry());
    check(`${label}: image loading keeps the same menu and keyboard focus`, await page.evaluate(() => imageSpaceMenu === document.querySelector('#menu') && imageSpaceFocus === document.activeElement));
    await page.screenshot({ path:path.join(shots, `${label}-images-loaded.png`) });
    await page.evaluate(() => { window.imageSpaceRuns = []; runUnsent = (p, l, step, agent) => imageSpaceRuns.push({ line:l.id, step, agent }); });
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    check(`${label}: keyboard selection dispatches exactly once with saved IDs`, await page.evaluate(() => imageSpaceRuns.length === 1 && !imageSpaceRuns[0].line.startsWith('saving-') && !imageSpaceRuns[0].step.startsWith('saving-')));
    await page.unroute('**/upload?**'); await page.unroute('**/unsent'); await page.unroute('**/file?**');
  }
  check('no browser runtime errors', !errors.length);
  console.log(`${passed} checks passed. Screenshots: ${shots}`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (server) { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
  s.close?.(); fs.rmSync(temp, { recursive:true, force:true });
});
