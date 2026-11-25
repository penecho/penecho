#!/usr/bin/env node
'use strict';
// PE-576: empty-state examples must never cover Canvas content.
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

  const context = await browser.newContext({ viewport:{width:1440,height:900} });
  const source = fs.readFileSync(path.join(root,'public/app.js'),'utf8').replace(/\}\)\(\);\s*$/, 'window.emptyTest={state,importCommunityWidgetArtifact,deleteWidget};})();');
  await context.route('**/app.js*', route => route.fulfill({contentType:'application/javascript',body:source}));
  const page = await blankCanvas(context);
  await page.evaluate(() => { window.projectLinesWelcomeOpen=true; window.projectLinesWelcomeSync(); });
  check('empty Canvas shows examples', await page.locator('#canvasWelcome').isVisible());
  await page.evaluate(() => emptyTest.importCommunityWidgetArtifact({
    format:'penecho-widget',formatVersion:1,widget:{widgetType:'html_widget',pluginId:'general',title:'Clock',refreshSeconds:0,html:'<div style="font:80px sans-serif;text-align:center">🕘</div>',x:0,y:0,w:400,h:400,contentW:400,contentH:400}
  }));
  await page.locator('#canvasWelcome').waitFor({state:'hidden'});
  check('sidebar artifact import hides examples despite welcome flag', await page.evaluate(() => window.projectLinesWelcomeOpen && emptyTest.state.widgets.length===1));
  await page.screenshot({path:path.join(shots,'clock-without-hint.png')});
  await page.setViewportSize({width:390,height:844});
  check('narrow Canvas also hides examples', !await page.locator('#canvasWelcome').isVisible());
  await page.evaluate(() => emptyTest.deleteWidget(emptyTest.state.widgets[0]));
  await page.locator('#canvasWelcome').waitFor({state:'visible'});
  check('removing final object restores examples', await page.locator('#canvasWelcomeExamples').isVisible());
  check('no browser script errors', errors.length===0);
  console.log(`${passed} Canvas empty-state checks passed; screenshots: ${shots}`);
})().catch(error => { console.error(error.stack); if (errors.length) console.error(errors); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  if (server && server.exitCode === null) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); }
  fs.rmSync(temp, { recursive:true, force:true });
});
