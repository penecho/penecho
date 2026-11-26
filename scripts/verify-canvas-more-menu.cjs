#!/usr/bin/env node
'use strict';
// PE-584: Canvas submenu placement and removed detach action, using isolated local data.
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
  const mine = (await post('/api/lines/projects', {name:'Menu test',docsPath:path.join(temp,`docs-${Date.now()}`)})).project;
  const { newBundle } = require('../src/server/project-lines/canvas-file.js');
  const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
  const bundle = newBundle({id:'menu-test',name:'Menu acceptance'});
  bundle.assets.push({kind:'preview',contentType:'image/png',metadata:{width:1,height:1},dataBase64:pngBase64});
  const canvas = await post(`/api/lines/projects/${encodeURIComponent(mine.id)}/canvases`, {title:'Menu acceptance',source:bundle,png:`data:image/png;base64,${pngBase64}`});
  const line = await post(`/api/lines/projects/${mine.id}/unsent`, { text:'Menu test line' });
  await post(`/api/lines/projects/${mine.id}/canvases/attach`, { path:canvas.source, topic:line.slug });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/?${new URLSearchParams({ linesProject:mine.id, linesCanvas:canvas.source, linesTitle:canvas.title, linesDoc:`lines/${line.slug}.md`, linesBack:mine.id })}`);
  await page.waitForSelector('#viewport');
  await settledCanvas(page);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => document.querySelector('#canvasDocumentNameLabel')?.textContent.trim() === 'Menu acceptance');
  return page;
}
async function checkShare(page, label, { touch = false, badges = false } = {}) {
  const share = page.locator('#shareCanvasBtn');
  if (touch) await share.tap(); else await share.click();
  await page.locator('#canvasShareMenu').waitFor({state:'visible'});
  if (badges) await page.evaluate(() => {
    document.querySelector('#shareDrawTogetherState').hidden = false;
    document.querySelector('#shareViewLinkState').hidden = false;
  });
  await page.evaluate(() => document.fonts.ready);
  const geometry = await page.locator('#canvasShareMenu').evaluate(menu => {
    const rect = el => el.getBoundingClientRect().toJSON();
    return { menu:rect(menu), width:innerWidth, rows:[...menu.querySelectorAll('button')].map(row => ({
      row:rect(row), title:rect(row.querySelector('strong')), description:rect(row.querySelector('small')),
      parts:[...row.children].filter(el => !el.hidden).map(rect)
    })) };
  });
  check(label + ': Share text fits each row without overlapping', geometry.rows.every(({row,title,description,parts}) =>
    row.height >= 44 && title.top >= row.top && title.bottom <= description.top && description.bottom <= row.bottom - 4 &&
    parts.every(part => part.left >= row.left && part.right <= row.right + 1)));
  check(label + ': Share rows fit the menu and viewport', geometry.rows[0].row.bottom <= geometry.rows[1].row.top &&
    geometry.rows[1].row.bottom <= geometry.menu.bottom - 4 && geometry.menu.left >= 0 && geometry.menu.right <= geometry.width);
  await page.screenshot({path:path.join(shots,'share-' + label + '.png')});
  if (!touch) {
    await page.locator('#shareDrawTogetherBtn').focus(); await page.keyboard.press('ArrowDown');
    check(label + ': keyboard reaches View link', await page.locator('#shareViewLinkBtn').evaluate(el => el === document.activeElement));
    await page.keyboard.press('Escape');
    check(label + ': Escape closes Share and returns focus', await page.locator('#canvasShareMenu').isHidden() && await share.evaluate(el => el === document.activeElement));
  } else await share.tap();
}
(async () => {
  server = spawn(process.execPath, [path.join(root, 'server.js')], { cwd:root, stdio:['ignore','pipe','pipe'], env:{
    ...process.env, NODE_ENV:'test', PENECHO_TEST_OPEN_ACCESS:'1', PENECHO_STATE_DIR:path.join(temp,'state'), PENECHO_CLOUD_STATE_DIR:path.join(temp,'cloud'),
    PORT:String(port), HOST:'127.0.0.1', CLAUDE_CLI_PATH:'/nonexistent', CODEX_CLI_PATH:'/nonexistent', PATH:'/usr/bin:/bin',
  } });
  server.stdout.on('data', data => { log += data; }); server.stderr.on('data', data => { log += data; });
  await waitFor(() => log.includes('PenEcho:'), 'test server startup', 30000);
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : { headless:true });
  const context = await browser.newContext({ viewport:{ width:1440, height:1000 }, reducedMotion:'reduce' });
  const page = await blankCanvas(context);
  await checkShare(page, 'desktop');
  await checkShare(page, 'desktop-badges', {badges:true});
  const panel = name => page.locator(`[data-more-submenu="${name}"]`);
  for (const size of [{width:1440,height:1000}, {width:1024,height:600}]) {
    await page.setViewportSize(size);
    await page.locator('#canvasMoreBtn').click();
    check('linked Canvas has no Take off its line option', await page.locator('#moreDetachCanvasBtn').count() === 0);
    check('Move to Line remains available', await page.locator('#moreMoveCanvasBtn').isVisible());
    for (const name of ['help','download']) {
      const trigger = page.locator(`[data-more-sub="${name}"]`);
      await trigger.hover();
      await panel(name).waitFor({state:'visible'});
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const {row,box} = await page.evaluate(name => ({row:document.querySelector(`[data-more-sub="${name}"]`).getBoundingClientRect().toJSON(),box:document.querySelector(`[data-more-submenu="${name}"]`).getBoundingClientRect().toJSON()}), name);
      check(`${size.width}: ${name} stays inside viewport`, box.x >= 0 && box.x + box.width <= size.width && box.y >= 8 && box.y + box.height <= size.height - 7);
      check(`${size.width}: ${name} aligns to its row unless lifted to fit`, Math.abs(box.y - Math.max(8, Math.min(row.y - 7, size.height - box.height - 8))) < 2);
      if (name === 'help') await page.screenshot({path:path.join(shots,`help-${size.width}.png`)});
    }
    await page.locator('#canvasMoreBtn').click();
  }
  await page.locator('#canvasMoreBtn').focus(); await page.keyboard.press('ArrowDown');
  await page.locator('#moreHelpTrigger').focus(); await page.keyboard.press('ArrowRight');
  check('keyboard opens Help and focuses shortcuts', await panel('help').locator('[data-more-help="shortcuts"]').evaluate(el => el === document.activeElement));
  await page.keyboard.press('ArrowLeft');
  check('ArrowLeft returns focus to Help', await page.locator('#moreHelpTrigger').evaluate(el => el === document.activeElement));
  await page.keyboard.press('ArrowRight');
  await page.setViewportSize({width:390,height:844});
  check('resize changes open Help to narrow back navigation', await panel('help').locator('[data-more-back]').isVisible());
  await panel('help').locator('[data-more-back]').click();
  await page.keyboard.press('Escape');
  await context.close();
  const touch = await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:'reduce'});
  const phone = await blankCanvas(touch);
  await checkShare(phone, 'phone', {touch:true});
  await phone.locator('#canvasMoreBtn').tap(); await phone.locator('#moreHelpTrigger').tap();
  const help = phone.locator('[data-more-submenu="help"]');
  check('touch opens in-panel Help with both actions', await help.locator('[data-more-help="shortcuts"]').isVisible() && await help.locator('[data-more-help="feedback"]').isVisible());
  const box = await help.boundingBox();
  check('phone Help fits viewport', box.x >= 0 && box.x + box.width <= 390 && box.y + box.height <= 844);
  await phone.screenshot({path:path.join(shots,'help-phone.png')});
  await help.locator('[data-more-help="shortcuts"]').tap();
  check('touch shortcut action opens Settings', await phone.locator('#settingsPageShortcuts').isVisible());
  const zh = await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:'reduce'});
  await zh.addInitScript(() => { try { localStorage.setItem('penecho-language','zh'); } catch {} });
  const chinese = await blankCanvas(zh);
  await checkShare(chinese, 'phone-zh-badges', {touch:true,badges:true});
  await zh.close();
  check('no browser script errors', errors.length === 0);
  console.log(`${passed} Canvas menu checks passed; screenshots: ${shots}`);
})().catch(error => { console.error(error.stack); if (errors.length) console.error(errors); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  if (server && server.exitCode === null) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); }
  fs.rmSync(temp, { recursive:true, force:true });
});
