#!/usr/bin/env node
'use strict';
// PE-566: real app entry with fresh and legacy browser preferences, on isolated local data.
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'penecho-entry-'));
const shots = path.resolve(process.argv[2] || path.join(temp, 'shots'));
fs.mkdirSync(shots, { recursive:true });
const port = 16000 + Math.floor(Math.random() * 1000), base = `http://127.0.0.1:${port}`;
let server, browser, log = '', passed = 0;
const errors = [], check = (label, ok) => { assert.ok(ok, label); passed++; console.log(`ok ${label}`); };
async function waitFor(fn, label, timeout = 20000) {
  const until = Date.now() + timeout;
  while (!await fn()) {
    if (Date.now() > until) throw Error(`Timed out: ${label}\n${log.slice(-1500)}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
async function post(url, body) {
  const response = await fetch(base + url, { method:'POST', headers:{ 'content-type':'application/json', origin:base }, body:JSON.stringify(body) });
  if (!response.ok) throw Error(`HTTP ${response.status}: ${url}`);
  return response.json();
}
async function settledCanvas(page) {
  await page.waitForFunction(() => typeof window.PenEchoExamples?.openDialog === 'function');
  await page.locator('#projectLinesCover').waitFor({ state:'hidden' });
  await page.locator('#peOpening').waitFor({ state:'hidden' });
}
async function blankCanvas(context) {
  const mine = (await post('/api/lines/my-canvases', {})).project;
  const canvas = await post(`/api/lines/projects/${encodeURIComponent(mine.id)}/canvases`, { title:'Entry acceptance' });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/?${new URLSearchParams({ linesProject:mine.id, linesCanvas:canvas.source, linesTitle:canvas.title, linesBack:mine.id })}`);
  await page.waitForSelector('#viewport');
  await settledCanvas(page);
  return page;
}
const noRetiredUI = page => page.locator('#tourLayer, #changelogLayer, #researchForm, #settingsTourBtn, #settingsChangelogBtn, [data-help="tour"], [data-help="whats-new"], [data-more-help="tour"], [data-more-help="whats-new"]').count().then(n => n === 0);
(async () => {
  server = spawn(process.execPath, [path.join(root, 'server.js')], { cwd:root, stdio:['ignore','pipe','pipe'], env:{
    ...process.env, NODE_ENV:'test', PENECHO_TEST_OPEN_ACCESS:'1', PENECHO_STATE_DIR:path.join(temp,'state'), PENECHO_CLOUD_STATE_DIR:path.join(temp,'cloud'),
    PORT:String(port), HOST:'127.0.0.1', CLAUDE_CLI_PATH:'/nonexistent', CODEX_CLI_PATH:'/nonexistent', PATH:'/usr/bin:/bin',
  } });
  server.stdout.on('data', data => { log += data; }); server.stderr.on('data', data => { log += data; });
  await waitFor(() => log.includes('PenEcho:'), 'test server startup', 30000);
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : { headless:true });
  const fresh = await browser.newContext({ viewport:{ width:1440, height:900 }, reducedMotion:'reduce' });
  let page = await fresh.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/'); await page.waitForURL(/projects\.html#new$/);
  await page.waitForSelector('.np-page #startPanel [name=name]');
  check('fresh app entry reaches New project with no retired overlays', await noRetiredUI(page));
  await page.screenshot({ path:path.join(shots,'new-project.png') }); await page.close();
  page = await blankCanvas(fresh);
  check('a fresh Canvas has no release notes or tour', await noRetiredUI(page));
  check('startup leaves release-note preferences unset', await page.evaluate(() => localStorage.getItem('penecho-changelog-seen') === null));
  await page.locator('#canvasMoreBtn').click(); await page.locator('#moreHelpTrigger').click();
  check('Help retains shortcuts and feedback only', (await page.locator('#canvasMoreMenu [data-more-help]').allTextContents()).map(s => s.trim()).join('|') === 'Keyboard shortcuts|Send feedback');
  await page.keyboard.press('Escape'); await page.locator('#canvasMoreBtn').focus(); await page.keyboard.press('ArrowDown');
  await page.locator('#moreHelpTrigger').focus(); await page.keyboard.press('ArrowRight');
  check('keyboard opens Help with focus on shortcuts', await page.locator('#canvasMoreMenu [data-more-help="shortcuts"]').evaluate(el => el === document.activeElement));
  await page.keyboard.press('ArrowDown');
  check('keyboard reaches feedback after shortcuts', await page.locator('#canvasMoreMenu [data-more-help="feedback"]').evaluate(el => el === document.activeElement));
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter');
  await page.locator('#settingsLayer:not([hidden])').waitFor();
  check('the retained shortcut action opens its Settings page', await page.locator('#settingsPageShortcuts').isVisible());
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.PenEchoExamples.openDialog());
  await page.locator('#examplesDialog[open] .example-card').first().waitFor();
  check('examples still open after the tour is removed', await page.locator('#examplesDialog .example-card').count() > 0);
  await page.locator('#examplesDialogClose').click();
  await page.screenshot({ path:path.join(shots,'canvas-entry.png') }); await fresh.close();
  for (const [name, preferences] of Object.entries({
    upgraded:{ 'penecho-changelog-seen':'1.4.1', 'penecho-tour-progress':'{"seen":["core-effort-v1"]}' },
    older:{ 'penecho-tour-progress':'{}' },
    chinese:{ 'penecho-language':'zh', 'penecho-changelog-seen':'1.4.0' },
  })) {
    const context = await browser.newContext({ viewport:{ width:name === 'chinese' ? 390 : 1440, height:900 }, hasTouch:name === 'chinese', reducedMotion:'reduce' });
    await context.addInitScript(values => {
      // Playwright also runs this in sandboxed Widget previews, which have no storage.
      try { for (const [key,value] of Object.entries(values)) localStorage.setItem(key,value); } catch {}
    }, preferences);
    page = await blankCanvas(context);
    check(`${name} legacy preferences are loaded`, await page.evaluate(values => Object.entries(values).every(([key,value]) => localStorage.getItem(key) === value), preferences));
    check(`${name} preferences cannot restore release notes or a tour`, await noRetiredUI(page));
    check(`${name} does not receive the first-install hint`, await page.locator('#canvasAiHint').isHidden());
    await page.reload(); await settledCanvas(page);
    check(`${name} reload still has an unobstructed Canvas`, await noRetiredUI(page) && await page.locator('main').evaluate(el => !el.inert));
    if (name === 'chinese') {
      check('Chinese Help keeps its shortcut and feedback translations', (await page.locator('#canvasMoreMenu [data-more-help]').allTextContents()).map(s => s.trim()).join('|') === '键盘快捷键|发送反馈');
      await page.screenshot({ path:path.join(shots,'canvas-entry-zh-phone.png') });
    }
    await context.close();
  }
  check('no browser script errors', errors.length === 0);
  console.log(`${passed} app-entry browser checks passed; screenshots: ${shots}`);
})().catch(error => { console.error(error.stack); if (errors.length) console.error(errors); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  if (server && server.exitCode === null) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); }
  fs.rmSync(temp, { recursive:true, force:true });
});
