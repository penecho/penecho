#!/usr/bin/env node
'use strict';
// PE-579: a project absent from this computer opens on the web, without creating a local copy.
// Real app/server with isolated data; only Cloud responses and window.open are intercepted.
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'penecho-cloud-web-'));
const shots = process.env.SHOTS || path.join(os.tmpdir(), 'penecho-cloud-web-shots');
fs.mkdirSync(shots, { recursive:true });
const port = 16000 + Math.floor(Math.random() * 1000), base = `http://127.0.0.1:${port}`, origin = 'https://cloud.example';
let server, browser, log = '', passed = 0;
const errors = [], copies = [], check = (label, ok) => { assert.ok(ok, label); passed++; console.log(`ok ${label}`); };
(async () => {
  server = spawn(process.execPath, [path.join(root, 'server.js')], { cwd:root, stdio:['ignore','pipe','pipe'], env:{
    ...process.env, NODE_ENV:'test', PENECHO_TEST_OPEN_ACCESS:'1', PENECHO_STATE_DIR:path.join(temp,'state'), PENECHO_CLOUD_STATE_DIR:path.join(temp,'cloud'),
    PORT:String(port), HOST:'127.0.0.1', CLAUDE_CLI_PATH:'/nonexistent', CODEX_CLI_PATH:'/nonexistent', PATH:'/usr/bin:/bin',
  } });
  server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
  const deadline = Date.now() + 30000;
  while (!log.includes('PenEcho:')) {
    if (Date.now() > deadline) throw Error(`Server startup timed out: ${log.slice(-1500)}`);
    await new Promise(r => setTimeout(r, 100));
  }
  browser = await chromium.launch({ headless:true, ...(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : {}) });
  const context = await browser.newContext({ viewport:{ width:1440, height:900 }, hasTouch:true });
  const response = await context.request.post(`${base}/api/lines/projects`, { headers:{ origin:base }, data:{ name:'Local project', docsPath:path.join(temp,'docs') } });
  assert.equal(response.status(), 200);
  const { project } = await response.json();
  const before = await (await context.request.get(`${base}/api/lines/projects`)).json();
  const remote = { key:'remote:project-1', name:'Cloud project on another computer', here:false, lines:500, sizeBytes:266 * 1048576, updatedAt:new Date().toISOString() };
  await context.route('**/api/lines/cloud/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/copy')) { copies.push(url.pathname); return route.fulfill({ status:409, json:{ error:'Copy is retired' } }); }
    if (url.pathname.endsWith('/account')) return route.fulfill({ json:{ signedIn:true, name:'Test account', plan:'plus', origin } });
    if (url.pathname.endsWith('/projects')) return route.fulfill({ json:{ projects:[remote], kept:1, limit:null } });
    return route.continue();
  });
  await context.addInitScript(() => { window.__opened = []; window.open = (...args) => { window.__opened.push(args); return null; }; });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/projects.html#${project.id}`);
  const row = page.locator('.rail-away .rail-row'); await row.waitFor();
  await row.click();
  check('one sidebar click opens the selected Cloud project', await page.evaluate(expected => window.__opened[0]?.[0] === expected, `${origin}/lines/remote%3Aproject-1`));
  check('web navigation uses a new window with noopener', await page.evaluate(() => window.__opened[0][1] === '_blank' && window.__opened[0][2] === 'noopener'));
  check('the local project remains open', new URL(page.url()).hash === `#${project.id}`);
  await row.focus(); await page.keyboard.press('Enter');
  check('keyboard activation opens the same web project', await page.evaluate(() => window.__opened.length === 2 && window.__opened[1][0] === window.__opened[0][0]));
  await page.goto(`${base}/projects.html#cloud/${encodeURIComponent(remote.key)}`);
  const action = page.getByRole('button', { name:'Open on penecho.ai', exact:true }); await action.waitFor();
  check('saved Cloud links offer only the web action', await page.locator('.cloud-page button').count() === 1 && await page.locator('[data-act="cloud-copy"]').count() === 0);
  check('the removed handler cannot create a copy', await page.evaluate(() => !ACT['cloud-copy']));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height:900 });
    check(`${width}px: web action is visible and fits`, await action.isVisible() && await action.evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && el.scrollWidth <= el.clientWidth + 1; }));
    check(`${width}px: no horizontal page overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path:path.join(shots, `cloud-web-${width}.png`) });
  }
  await action.tap();
  check('touch on the saved page opens the specific project', await page.evaluate(expected => window.__opened[0]?.[0] === expected, `${origin}/lines/remote%3Aproject-1`));
  await page.reload(); await action.waitFor();
  check('reload keeps the copy action absent', await page.locator('[data-act="cloud-copy"]').count() === 0);
  const after = await (await context.request.get(`${base}/api/lines/projects`)).json();
  check('no local project was created', JSON.stringify(before.projects.map(p => p.id)) === JSON.stringify(after.projects.map(p => p.id)));
  check('no copy request was sent', copies.length === 0);
  check('no browser exceptions', errors.length === 0);
  console.log(`${passed} checks passed. Screenshots: ${shots}`);
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  if (server && server.exitCode === null) { const stopped = new Promise(r => server.once('exit', r)); server.kill(); await stopped; }
  fs.rmSync(temp, { recursive:true, force:true });
});
